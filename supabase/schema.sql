-- =============================================================================
-- PartyUp — database schema, security policies and server-side functions
-- Run this whole file once in the Supabase SQL Editor (or `supabase db push`).
-- It is idempotent for functions/policies; tables are created if missing.
--
-- Security model
--   * Every table has Row Level Security enabled.
--   * Table privileges for the API roles are revoked and re-granted narrowly
--     (e.g. users may UPDATE only specific columns of their own profile).
--   * Anything that touches more than one user's data (friends, parties,
--     messages, reports, moderation) goes through SECURITY DEFINER functions
--     that check auth.uid(), blocks, privacy settings, capacity and rate limits
--     on the server. The UI hiding a button is never the only protection.
--   * Other users' profiles are only readable through the `public_profiles`
--     view, which masks fields according to each user's privacy settings and
--     never contains email addresses (those live only in auth.users).
-- =============================================================================

set client_min_messages = warning;
create extension if not exists pgcrypto;

-- -----------------------------------------------------------------------------
-- GAMES (catalog; add new games with an INSERT — no code changes needed)
-- -----------------------------------------------------------------------------
create table if not exists public.games (
  id              text primary key check (id ~ '^[a-z0-9-]{2,40}$'),
  name            text not null unique check (char_length(name) between 2 and 60),
  short_name      text check (char_length(short_name) <= 12),
  accent_color    text not null default '#7c5cff' check (accent_color ~ '^#[0-9a-fA-F]{6}$'),
  platforms       text[] not null default '{}',
  roles           text[] not null default '{}',
  modes           text[] not null default '{}',
  ranks           text[] not null default '{}',   -- ordered lowest → highest; empty = unranked game
  rank_weight     int  not null default 10 check (rank_weight between 0 and 30),
  rank_tolerance  int  not null default 2  check (rank_tolerance between 1 and 10),
  max_party_size  int  not null default 5  check (max_party_size between 2 and 20),
  is_active       boolean not null default true,
  sort_order      int not null default 100,
  created_at      timestamptz not null default now(),
  constraint games_platforms_valid check (platforms <@ array['pc','playstation','xbox','switch','mobile'])
);

-- -----------------------------------------------------------------------------
-- PROFILES (one per auth user; created automatically on sign-up)
-- -----------------------------------------------------------------------------
create table if not exists public.profiles (
  id                     uuid primary key references auth.users(id) on delete cascade,
  username               text not null check (username ~ '^[A-Za-z0-9_]{3,20}$'),
  avatar_url             text check (avatar_url is null or (char_length(avatar_url) <= 500 and avatar_url ~ '^(https://|preset:)')),
  bio                    text not null default '' check (char_length(bio) <= 500),
  region                 text check (region is null or region in
                           ('na-east','na-central','na-west','sa','eu-west','eu-central','eu-east','me','af','asia-east','asia-se','asia-south','oce')),
  languages              text[] not null default '{}' check (cardinality(languages) <= 8 and languages <@ array
                           ['en','es','pt','fr','de','it','nl','pl','sv','ru','uk','tr','ar','hi','ja','ko','zh','tl','vi','id','th']),
  platforms              text[] not null default '{}' check (platforms <@ array['pc','playstation','xbox','switch','mobile']),
  mic_preference         text check (mic_preference is null or mic_preference in ('always','usually','sometimes','text_only')),
  playstyles             text[] not null default '{}' check (cardinality(playstyles) <= 6 and playstyles <@ array
                           ['chill','competitive','strategic','aggressive','supportive','shotcaller','communicative','flexible','learning','grinder']),
  teammate_traits        text[] not null default '{}' check (cardinality(teammate_traits) <= 8 and teammate_traits <@ array
                           ['has_mic','good_comms','positive','patient','competitive','chill','shotcaller','follows_calls','consistent_schedule','beginner_friendly']),
  pref_teammate_mic      text not null default 'any' check (pref_teammate_mic in ('any','preferred','required')),
  looking_for            text not null default 'both' check (looking_for in ('casual','competitive','both')),
  highlights             text[] not null default '{}' check (cardinality(highlights) <= 5 and char_length(array_to_string(highlights, '')) <= 400),
  availability           smallint[] not null default '{}' check (cardinality(availability) <= 168 and 0 <= all(availability) and 167 >= all(availability)),
  timezone               text check (char_length(timezone) <= 64),
  status                 text not null default 'online' check (status in ('online','away','busy','invisible')),
  last_seen_at           timestamptz not null default now(),
  -- privacy
  discoverable           boolean not null default true,
  show_bio               boolean not null default true,
  show_region            boolean not null default true,
  show_languages         boolean not null default true,
  show_platforms         boolean not null default true,
  show_availability      boolean not null default true,
  show_ranks             boolean not null default true,
  show_highlights        boolean not null default true,
  show_online_status     boolean not null default true,
  allow_friend_requests  text not null default 'everyone' check (allow_friend_requests in ('everyone','nobody')),
  allow_party_invites    text not null default 'everyone' check (allow_party_invites in ('everyone','friends','nobody')),
  allow_messages         text not null default 'everyone' check (allow_messages in ('everyone','friends','nobody')),
  -- notification preferences
  notify_friend_requests boolean not null default true,
  notify_party_invites   boolean not null default true,
  notify_join_requests   boolean not null default true,
  notify_request_updates boolean not null default true,
  notify_messages        boolean not null default true,
  show_demo_players      boolean not null default true,
  -- system-managed (not writable by users; see column grants below)
  onboarded_at           timestamptz,
  is_demo                boolean not null default false,
  suspended_until        timestamptz,
  is_banned              boolean not null default false,
  stat_parties_created   int not null default 0,
  stat_parties_joined    int not null default 0,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);
create unique index if not exists profiles_username_lower_key on public.profiles (lower(username));
create index if not exists profiles_region_idx on public.profiles (region);
create index if not exists profiles_last_seen_idx on public.profiles (last_seen_at desc);
create index if not exists profiles_languages_idx on public.profiles using gin (languages);
create index if not exists profiles_availability_idx on public.profiles using gin (availability);

create table if not exists public.user_roles (
  user_id    uuid primary key references public.profiles(id) on delete cascade,
  role       text not null check (role in ('moderator','admin')),
  granted_at timestamptz not null default now()
);

-- -----------------------------------------------------------------------------
-- GAME PROFILES (self-reported, never "verified")
-- -----------------------------------------------------------------------------
create table if not exists public.user_game_profiles (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references public.profiles(id) on delete cascade,
  game_id          text not null references public.games(id) on update cascade on delete cascade,
  platform         text check (platform is null or platform in ('pc','playstation','xbox','switch','mobile')),
  rank             text check (char_length(rank) <= 40),
  rank_index       int,                       -- set by trigger from games.ranks
  experience       text not null default 'casual' check (experience in ('new','casual','ranked','tournament','semi_pro')),
  main_role        text check (char_length(main_role) <= 40),
  secondary_roles  text[] not null default '{}' check (cardinality(secondary_roles) <= 4),
  preferred_modes  text[] not null default '{}' check (cardinality(preferred_modes) <= 8),
  session_length   text check (session_length is null or session_length in ('under_1h','1_2h','2_4h','4h_plus')),
  playstyles       text[] not null default '{}' check (cardinality(playstyles) <= 6 and playstyles <@ array
                     ['chill','competitive','strategic','aggressive','supportive','shotcaller','communicative','flexible','learning','grinder']),
  looking_for      text not null default 'both' check (looking_for in ('casual','competitive','both')),
  notes            text not null default '' check (char_length(notes) <= 280),
  is_visible       boolean not null default true,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (user_id, game_id)
);
create index if not exists ugp_game_idx on public.user_game_profiles (game_id, rank_index);

-- -----------------------------------------------------------------------------
-- PARTIES
-- -----------------------------------------------------------------------------
create table if not exists public.parties (
  id              uuid primary key default gen_random_uuid(),
  leader_id       uuid not null references public.profiles(id) on delete cascade,
  game_id         text not null references public.games(id) on update cascade,
  title           text not null check (char_length(btrim(title)) between 3 and 60),
  description     text not null default '' check (char_length(description) <= 500),
  max_size        int  not null check (max_size between 2 and 20),
  needed_roles    text[] not null default '{}' check (cardinality(needed_roles) <= 10),
  play_type       text not null default 'casual' check (play_type in ('casual','competitive')),
  min_rank_index  int check (min_rank_index >= 0),
  max_rank_index  int check (max_rank_index >= 0),
  language        text check (char_length(language) <= 5),
  region          text check (char_length(region) <= 20),
  platform        text check (platform is null or platform in ('pc','playstation','xbox','switch','mobile')),
  mic_required    boolean not null default false,
  visibility      text not null default 'public' check (visibility in ('public','invite_only')),
  scheduled_for   timestamptz,
  status          text not null default 'open' check (status in ('open','closed')),
  member_count    int not null default 0,
  is_demo         boolean not null default false,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  closed_at       timestamptz,
  constraint parties_rank_range check (min_rank_index is null or max_rank_index is null or min_rank_index <= max_rank_index),
  constraint parties_capacity check (member_count <= max_size)
);
create index if not exists parties_game_status_idx on public.parties (game_id, status, created_at desc);
create index if not exists parties_leader_idx on public.parties (leader_id);

create table if not exists public.party_members (
  party_id   uuid not null references public.parties(id) on delete cascade,
  user_id    uuid not null references public.profiles(id) on delete cascade,
  role       text check (char_length(role) <= 40),
  joined_at  timestamptz not null default now(),
  primary key (party_id, user_id)
);
create index if not exists party_members_user_idx on public.party_members (user_id);

create table if not exists public.party_join_requests (
  id            uuid primary key default gen_random_uuid(),
  party_id      uuid not null references public.parties(id) on delete cascade,
  user_id       uuid not null references public.profiles(id) on delete cascade,
  role          text check (char_length(role) <= 40),
  message       text not null default '' check (char_length(message) <= 200),
  status        text not null default 'pending' check (status in ('pending','accepted','rejected','cancelled')),
  created_at    timestamptz not null default now(),
  responded_at  timestamptz
);
create unique index if not exists pjr_one_pending on public.party_join_requests (party_id, user_id) where status = 'pending';
create index if not exists pjr_user_idx on public.party_join_requests (user_id);

create table if not exists public.party_invites (
  id            uuid primary key default gen_random_uuid(),
  party_id      uuid not null references public.parties(id) on delete cascade,
  inviter_id    uuid references public.profiles(id) on delete set null,
  invitee_id    uuid not null references public.profiles(id) on delete cascade,
  status        text not null default 'pending' check (status in ('pending','accepted','declined','cancelled')),
  created_at    timestamptz not null default now(),
  responded_at  timestamptz
);
create unique index if not exists pinv_one_pending on public.party_invites (party_id, invitee_id) where status = 'pending';
create index if not exists pinv_invitee_idx on public.party_invites (invitee_id, status);

-- -----------------------------------------------------------------------------
-- FRIENDS, BLOCKS, MUTES
-- -----------------------------------------------------------------------------
create table if not exists public.friendships (
  id            uuid primary key default gen_random_uuid(),
  requester_id  uuid not null references public.profiles(id) on delete cascade,
  addressee_id  uuid not null references public.profiles(id) on delete cascade,
  status        text not null default 'pending' check (status in ('pending','accepted')),
  created_at    timestamptz not null default now(),
  responded_at  timestamptz,
  check (requester_id <> addressee_id)
);
create unique index if not exists friendships_pair_key on public.friendships (least(requester_id, addressee_id), greatest(requester_id, addressee_id));
create index if not exists friendships_addressee_idx on public.friendships (addressee_id, status);
create index if not exists friendships_requester_idx on public.friendships (requester_id, status);

create table if not exists public.blocks (
  blocker_id  uuid not null references public.profiles(id) on delete cascade,
  blocked_id  uuid not null references public.profiles(id) on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (blocker_id, blocked_id),
  check (blocker_id <> blocked_id)
);
create index if not exists blocks_blocked_idx on public.blocks (blocked_id);

create table if not exists public.mutes (
  muter_id   uuid not null references public.profiles(id) on delete cascade,
  muted_id   uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (muter_id, muted_id),
  check (muter_id <> muted_id)
);

-- -----------------------------------------------------------------------------
-- MESSAGING
-- -----------------------------------------------------------------------------
create table if not exists public.conversations (
  id               uuid primary key default gen_random_uuid(),
  kind             text not null check (kind in ('direct','party')),
  party_id         uuid unique references public.parties(id) on delete cascade,
  direct_key       text unique,
  created_at       timestamptz not null default now(),
  last_message_at  timestamptz,
  check ((kind = 'party' and party_id is not null and direct_key is null)
      or (kind = 'direct' and direct_key is not null and party_id is null))
);

create table if not exists public.conversation_members (
  conversation_id  uuid not null references public.conversations(id) on delete cascade,
  user_id          uuid not null references public.profiles(id) on delete cascade,
  joined_at        timestamptz not null default now(),
  last_read_at     timestamptz not null default now(),
  primary key (conversation_id, user_id)
);
create index if not exists conv_members_user_idx on public.conversation_members (user_id);

create table if not exists public.messages (
  id               bigint generated always as identity primary key,
  conversation_id  uuid not null references public.conversations(id) on delete cascade,
  sender_id        uuid references public.profiles(id) on delete set null,
  body             text not null check (char_length(btrim(body)) between 1 and 2000),
  created_at       timestamptz not null default now(),
  removed_at       timestamptz
);
create index if not exists messages_conv_idx on public.messages (conversation_id, id desc);

-- -----------------------------------------------------------------------------
-- NOTIFICATIONS
-- -----------------------------------------------------------------------------
create table if not exists public.notifications (
  id               bigint generated always as identity primary key,
  user_id          uuid not null references public.profiles(id) on delete cascade,
  type             text not null check (type in ('friend_request','friend_accepted','party_invite','party_invite_accepted',
                     'join_request','join_accepted','join_rejected','party_removed','party_leadership','party_closed',
                     'message','report_update','moderation')),
  actor_id         uuid references public.profiles(id) on delete set null,
  party_id         uuid references public.parties(id) on delete cascade,
  conversation_id  uuid references public.conversations(id) on delete cascade,
  data             jsonb not null default '{}',
  count            int not null default 1,
  read_at          timestamptz,
  created_at       timestamptz not null default now()
);
create index if not exists notifications_user_idx on public.notifications (user_id, created_at desc);
create index if not exists notifications_unread_idx on public.notifications (user_id) where read_at is null;

-- -----------------------------------------------------------------------------
-- SAFETY & MODERATION
-- -----------------------------------------------------------------------------
create table if not exists public.reports (
  id                 uuid primary key default gen_random_uuid(),
  reporter_id        uuid references public.profiles(id) on delete set null,
  reported_user_id   uuid references public.profiles(id) on delete set null,
  reported_username  text not null,
  category           text not null check (category in ('harassment','cheating','spam','inappropriate_profile','suspicious','other')),
  description        text not null check (char_length(btrim(description)) between 10 and 1000),
  message_id         bigint references public.messages(id) on delete set null,
  message_snapshot   text,
  party_id           uuid references public.parties(id) on delete set null,
  status             text not null default 'open' check (status in ('open','in_review','resolved','dismissed')),
  assigned_moderator uuid references public.profiles(id) on delete set null,
  resolution_note    text check (char_length(resolution_note) <= 1000),
  action_taken       text not null default 'none' check (action_taken in ('none','warning','remove_content','suspend','ban')),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  resolved_at        timestamptz
);
create index if not exists reports_status_idx on public.reports (status, created_at desc);
create index if not exists reports_reported_idx on public.reports (reported_user_id);

create table if not exists public.moderation_actions (
  id              bigint generated always as identity primary key,
  report_id       uuid references public.reports(id) on delete set null,
  moderator_id    uuid references public.profiles(id) on delete set null,
  target_user_id  uuid references public.profiles(id) on delete set null,
  action          text not null,
  note            text,
  created_at      timestamptz not null default now()
);

-- Generic per-user action log used for rate limiting (spam protection)
create table if not exists public.rate_events (
  id          bigint generated always as identity primary key,
  user_id     uuid not null references public.profiles(id) on delete cascade,
  kind        text not null,
  created_at  timestamptz not null default now()
);
create index if not exists rate_events_idx on public.rate_events (user_id, kind, created_at desc);

-- -----------------------------------------------------------------------------
-- COMMUNITIES (Discord-style servers with text channels)
-- -----------------------------------------------------------------------------
create table if not exists public.communities (
  id            uuid primary key default gen_random_uuid(),
  name          text not null check (char_length(btrim(name)) between 2 and 40),
  description   text not null default '' check (char_length(description) <= 300),
  icon_color    text not null default '#3d7eff' check (icon_color ~ '^#[0-9a-fA-F]{6}$'),
  owner_id      uuid references public.profiles(id) on delete set null,
  game_id       text references public.games(id) on update cascade on delete set null,
  is_public     boolean not null default true,
  member_count  int not null default 0,
  is_demo       boolean not null default false,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists communities_public_idx on public.communities (is_public, member_count desc);

create table if not exists public.community_members (
  community_id  uuid not null references public.communities(id) on delete cascade,
  user_id       uuid not null references public.profiles(id) on delete cascade,
  role          text not null default 'member' check (role in ('owner','admin','member')),
  joined_at     timestamptz not null default now(),
  primary key (community_id, user_id)
);
create index if not exists community_members_user_idx on public.community_members (user_id);

create table if not exists public.community_bans (
  community_id  uuid not null references public.communities(id) on delete cascade,
  user_id       uuid not null references public.profiles(id) on delete cascade,
  banned_by     uuid references public.profiles(id) on delete set null,
  reason        text not null default '' check (char_length(reason) <= 200),
  created_at    timestamptz not null default now(),
  primary key (community_id, user_id)
);

create table if not exists public.community_invites (
  code          text primary key check (code ~ '^[a-z0-9]{8}$'),
  community_id  uuid not null references public.communities(id) on delete cascade,
  created_by    uuid references public.profiles(id) on delete set null,
  max_uses      int check (max_uses is null or max_uses between 1 and 1000),
  uses          int not null default 0,
  expires_at    timestamptz,
  created_at    timestamptz not null default now()
);
create index if not exists community_invites_comm_idx on public.community_invites (community_id);

create table if not exists public.channels (
  id            uuid primary key default gen_random_uuid(),
  community_id  uuid not null references public.communities(id) on delete cascade,
  name          text not null check (name ~ '^[a-z0-9][a-z0-9-]{0,29}$'),
  topic         text not null default '' check (char_length(topic) <= 200),
  kind          text not null default 'text' check (kind in ('text','announcement','voice')),
  position      int not null default 0,
  created_at    timestamptz not null default now(),
  unique (community_id, name)
);

-- -----------------------------------------------------------------------------
-- v2 columns on existing tables (idempotent)
-- -----------------------------------------------------------------------------
alter table public.games add column if not exists genre text;
alter table public.profiles add column if not exists custom_status text not null default '' check (char_length(custom_status) <= 60);
alter table public.profiles add column if not exists notify_mentions boolean not null default true;
alter table public.profiles add column if not exists stat_messages_sent int not null default 0;
-- v3: profile customization (free for everyone)
alter table public.profiles add column if not exists banner_url text check (banner_url is null or (char_length(banner_url) <= 500 and banner_url ~ '^(https://|preset:)'));
alter table public.profiles add column if not exists theme_color text check (theme_color is null or theme_color ~ '^#[0-9a-fA-F]{6}$');
alter table public.profiles add column if not exists theme_color_2 text check (theme_color_2 is null or theme_color_2 ~ '^#[0-9a-fA-F]{6}$');
alter table public.profiles add column if not exists name_style text not null default 'plain'
  check (name_style in ('plain','sunset','ocean','toxic','royal','candy','gold','glow','spooky'));
alter table public.profiles add column if not exists avatar_decoration text not null default 'none'
  check (avatar_decoration in ('none','pulse','orbit','flames','sparkle','neon','crown','pumpkin','halo','bats'));
alter table public.profiles add column if not exists profile_effect text not null default 'none'
  check (profile_effect in ('none','snow','sparkles','embers','bats','confetti','stars'));
alter table public.profiles add column if not exists status_emoji text not null default '' check (char_length(status_emoji) <= 8);
-- v4: XP & levels (server-awarded only), Ready-to-play beacon
alter table public.profiles add column if not exists xp int not null default 0;
alter table public.profiles add column if not exists beacon_game text references public.games(id) on update cascade on delete set null;
alter table public.profiles add column if not exists beacon_until timestamptz;
alter table public.profiles add column if not exists beacon_note text not null default '' check (char_length(beacon_note) <= 80);

alter table public.conversations add column if not exists name text check (char_length(name) <= 40);
alter table public.conversations add column if not exists owner_id uuid references public.profiles(id) on delete set null;
alter table public.conversations add column if not exists channel_id uuid unique references public.channels(id) on delete cascade;
alter table public.conversations drop constraint if exists conversations_kind_check;
alter table public.conversations add constraint conversations_kind_check check (kind in ('direct','party','group','channel'));
alter table public.conversations drop constraint if exists conversations_check;
alter table public.conversations drop constraint if exists conversations_shape;
alter table public.conversations add constraint conversations_shape check (
     (kind = 'direct'  and direct_key is not null and party_id is null and channel_id is null)
  or (kind = 'party'   and party_id is not null and direct_key is null and channel_id is null)
  or (kind = 'group'   and party_id is null and direct_key is null and channel_id is null)
  or (kind = 'channel' and channel_id is not null and party_id is null and direct_key is null));

alter table public.conversation_members add column if not exists muted boolean not null default false;
alter table public.channels drop constraint if exists channels_kind_check;
alter table public.channels add constraint channels_kind_check check (kind in ('text','announcement','voice'));
-- v3: official per-game communities (no owner; run by PartyUp moderators)
alter table public.communities add column if not exists is_official boolean not null default false;
create unique index if not exists communities_official_game_idx on public.communities (game_id) where is_official;

alter table public.messages add column if not exists reply_to bigint references public.messages(id) on delete set null;
alter table public.messages add column if not exists edited_at timestamptz;
alter table public.messages add column if not exists deleted_at timestamptz;
alter table public.messages add column if not exists mentions uuid[] not null default '{}';
alter table public.messages add column if not exists pinned_at timestamptz;
alter table public.messages add column if not exists pinned_by uuid references public.profiles(id) on delete set null;
create index if not exists messages_pinned_idx on public.messages (conversation_id) where pinned_at is not null;

alter table public.notifications drop constraint if exists notifications_type_check;
alter table public.notifications add constraint notifications_type_check check (type in ('friend_request','friend_accepted','party_invite',
  'party_invite_accepted','join_request','join_accepted','join_rejected','party_removed','party_leadership','party_closed',
  'message','mention','group_added','report_update','moderation','call','tournament','beacon','endorsed','level_up'));

create table if not exists public.message_reactions (
  message_id  bigint not null references public.messages(id) on delete cascade,
  user_id     uuid not null references public.profiles(id) on delete cascade,
  emoji       text not null check (emoji in ('👍','👎','❤️','😂','😮','😢','🔥','🎉','👀','💯','🙏','🤝')),
  created_at  timestamptz not null default now(),
  primary key (message_id, user_id, emoji)
);

create table if not exists public.conversation_typing (
  conversation_id  uuid not null references public.conversations(id) on delete cascade,
  user_id          uuid not null references public.profiles(id) on delete cascade,
  updated_at       timestamptz not null default now(),
  primary key (conversation_id, user_id)
);

-- =============================================================================
-- HELPERS
-- =============================================================================
create or replace function public.touch_updated_at() returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end $$;

drop trigger if exists trg_profiles_touch on public.profiles;
create trigger trg_profiles_touch before update on public.profiles for each row execute function public.touch_updated_at();
drop trigger if exists trg_ugp_touch on public.user_game_profiles;
create trigger trg_ugp_touch before update on public.user_game_profiles for each row execute function public.touch_updated_at();
drop trigger if exists trg_parties_touch on public.parties;
create trigger trg_parties_touch before update on public.parties for each row execute function public.touch_updated_at();
drop trigger if exists trg_reports_touch on public.reports;
create trigger trg_reports_touch before update on public.reports for each row execute function public.touch_updated_at();

create or replace function public.is_moderator(p_user uuid default null) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from user_roles where user_id = coalesce(p_user, auth.uid()) and role in ('moderator','admin'))
$$;

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from user_roles where user_id = auth.uid() and role = 'admin')
$$;

create or replace function public._blocked(a uuid, b uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from blocks where (blocker_id = a and blocked_id = b) or (blocker_id = b and blocked_id = a))
$$;

-- Callable from policies; only answers questions about the caller's own relationships.
create or replace function public.is_blocked_between(a uuid, b uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select case when auth.uid() in (a, b) then public._blocked(a, b) else false end
$$;

create or replace function public._are_friends(a uuid, b uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from friendships where status = 'accepted'
                 and least(requester_id, addressee_id) = least(a, b) and greatest(requester_id, addressee_id) = greatest(a, b))
$$;

create or replace function public._mutes(muter uuid, muted uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from mutes where muter_id = muter and muted_id = muted)
$$;

create or replace function public.is_party_member(p_party uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from party_members where party_id = p_party and user_id = auth.uid())
$$;

create or replace function public.is_party_leader(p_party uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from parties where id = p_party and leader_id = auth.uid())
$$;

create or replace function public.has_party_invite(p_party uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from party_invites where party_id = p_party and invitee_id = auth.uid() and status = 'pending')
$$;

create or replace function public.is_conversation_member(p_conv uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from conversation_members where conversation_id = p_conv and user_id = auth.uid())
$$;

create or replace function public._require_user() returns uuid
language plpgsql stable security definer set search_path = public as $$
declare v uuid := auth.uid();
begin
  if v is null then raise exception 'You need to be signed in.' using errcode = '28000'; end if;
  return v;
end $$;

-- Raises unless the caller may take social actions (not banned / suspended).
create or replace function public._require_active() returns uuid
language plpgsql stable security definer set search_path = public as $$
declare v uuid := public._require_user(); p profiles;
begin
  select * into p from profiles where id = v;
  if not found then raise exception 'Profile not found.'; end if;
  if p.is_banned then raise exception 'This account has been banned.' using errcode = '42501'; end if;
  if p.suspended_until is not null and p.suspended_until > now() then
    raise exception 'Your account is suspended until %.', to_char(p.suspended_until at time zone 'utc', 'YYYY-MM-DD HH24:MI "UTC"') using errcode = '42501';
  end if;
  if p.onboarded_at is null then raise exception 'Finish setting up your profile first.'; end if;
  return v;
end $$;

-- Spam protection: at most p_max events of p_kind per p_window per user.
create or replace function public._rate_limit(p_kind text, p_max int, p_window interval, p_label text default 'actions')
returns void language plpgsql security definer set search_path = public as $$
declare v uuid := auth.uid(); n int;
begin
  select count(*) into n from rate_events where user_id = v and kind = p_kind and created_at > now() - p_window;
  if n >= p_max then
    raise exception 'Slow down — too many % in a short time. Try again shortly.', p_label using errcode = '54000';
  end if;
  insert into rate_events (user_id, kind) values (v, p_kind);
  if random() < 0.02 then delete from rate_events where created_at < now() - interval '2 days'; end if;
end $$;

create or replace function public._display_status(p profiles) returns text
language sql stable as $$
  select case
    when not p.show_online_status or p.status = 'invisible' then 'offline'
    when p.last_seen_at < now() - interval '5 minutes' then 'offline'
    else p.status end
$$;

create or replace function public._slot_now() returns int language sql stable as $$
  select ((extract(isodow from (now() at time zone 'utc'))::int - 1) * 24 + extract(hour from (now() at time zone 'utc'))::int)
$$;

-- Level curve: level n needs 50·(n-1)² XP (1 → 0, 2 → 50, 3 → 200, 5 → 800, 10 → 4050 …)
create or replace function public._level(p_xp int) returns int language sql immutable as $$
  select floor(sqrt(greatest(coalesce(p_xp, 0), 0) / 50.0))::int + 1
$$;

create or replace function public._overlap(a smallint[], b smallint[]) returns int language sql immutable as $$
  select count(*)::int from (select unnest(a) intersect select unnest(b)) x
$$;

-- =============================================================================
-- PUBLIC VIEWS (privacy-masked, block-aware). Owned by the migration role, so
-- they intentionally bypass the underlying RLS and apply their own filters.
-- =============================================================================
drop view if exists public.public_game_profiles cascade;
drop view if exists public.public_profiles cascade;

create view public.public_profiles with (security_barrier = true) as
select p.id,
       p.username,
       p.avatar_url,
       case when p.show_bio then p.bio else '' end                           as bio,
       case when p.show_region then p.region end                             as region,
       case when p.show_languages then p.languages else '{}'::text[] end      as languages,
       case when p.show_platforms then p.platforms else '{}'::text[] end      as platforms,
       p.mic_preference,
       p.playstyles,
       p.teammate_traits,
       p.pref_teammate_mic,
       p.looking_for,
       case when p.show_highlights then p.highlights else '{}'::text[] end    as highlights,
       case when p.show_availability then p.availability else '{}'::smallint[] end as availability,
       public._display_status(p)                                              as status,
       case when p.show_online_status and p.status <> 'invisible' then p.last_seen_at end as last_active_at,
       p.custom_status,
       p.status_emoji,
       p.banner_url,
       p.theme_color,
       p.theme_color_2,
       p.name_style,
       p.avatar_decoration,
       p.profile_effect,
       p.xp,
       public._level(p.xp) as level,
       case when p.discoverable and p.beacon_until > now() then p.beacon_game end as beacon_game,
       case when p.discoverable and p.beacon_until > now() then p.beacon_until end as beacon_until,
       case when p.discoverable and p.beacon_until > now() then p.beacon_note end as beacon_note,
       p.discoverable,
       p.allow_friend_requests,
       p.allow_party_invites,
       p.allow_messages,
       p.is_demo,
       p.stat_parties_created,
       p.stat_parties_joined,
       p.created_at
from public.profiles p
where p.onboarded_at is not null
  and not p.is_banned
  and (auth.uid() is null or not public.is_blocked_between(p.id, auth.uid()));

create view public.public_game_profiles with (security_barrier = true) as
select g.id, g.user_id, g.game_id, g.platform,
       case when p.show_ranks then g.rank end        as rank,
       case when p.show_ranks then g.rank_index end  as rank_index,
       g.experience, g.main_role, g.secondary_roles, g.preferred_modes, g.session_length,
       g.playstyles, g.looking_for, g.notes, g.updated_at
from public.user_game_profiles g
join public.profiles p on p.id = g.user_id
where g.is_visible and p.onboarded_at is not null and not p.is_banned
  and (auth.uid() is null or not public.is_blocked_between(p.id, auth.uid()));

-- Compact public card used inside many JSON responses
create or replace function public._card(p_user uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('id', pp.id, 'username', pp.username, 'avatar_url', pp.avatar_url,
                            'status', pp.status, 'last_active_at', pp.last_active_at, 'is_demo', pp.is_demo,
                            'region', pp.region, 'custom_status', pp.custom_status, 'status_emoji', pp.status_emoji,
                            'name_style', pp.name_style, 'avatar_decoration', pp.avatar_decoration,
                            'banner_url', pp.banner_url, 'theme_color', pp.theme_color, 'theme_color_2', pp.theme_color_2,
                            'profile_effect', pp.profile_effect, 'level', pp.level)
  from public_profiles pp where pp.id = p_user
$$;

create or replace function public._relationship(a uuid, b uuid) returns text
language sql stable security definer set search_path = public as $$
  select coalesce((
    select case when f.status = 'accepted' then 'friends'
                when f.requester_id = a then 'outgoing' else 'incoming' end
    from friendships f
    where least(f.requester_id, f.addressee_id) = least(a, b) and greatest(f.requester_id, f.addressee_id) = greatest(a, b)
  ), 'none')
$$;

-- =============================================================================
-- TRIGGERS
-- =============================================================================

-- New auth user → profile with a temporary username (chosen during onboarding)
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  wanted text := new.raw_user_meta_data ->> 'username'; uname text;
  -- OAuth providers (Google) supply a profile picture; keep it if it is a safe https URL.
  pic text := coalesce(new.raw_user_meta_data ->> 'avatar_url', new.raw_user_meta_data ->> 'picture');
begin
  if pic is not null and (pic !~ '^https://' or char_length(pic) > 500) then pic := null; end if;
  if wanted ~ '^[A-Za-z0-9_]{3,20}$' and not exists (select 1 from profiles where lower(username) = lower(wanted)) then
    uname := wanted;
  else
    loop
      uname := 'player_' || substr(md5(random()::text), 1, 8);
      exit when not exists (select 1 from profiles where lower(username) = lower(uname));
    end loop;
  end if;
  insert into profiles (id, username, avatar_url, is_demo)
  values (new.id, uname, pic, coalesce((new.raw_app_meta_data ->> 'partyup_demo')::boolean, false));
  return new;
end $$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user();

-- Validate game profile values against the game catalog; derive rank_index
create or replace function public.validate_game_profile() returns trigger
language plpgsql set search_path = public as $$
declare g games;
begin
  select * into g from games where id = new.game_id;
  if not found or not g.is_active then raise exception 'Unknown game.'; end if;
  if new.rank is not null and new.rank = '' then new.rank := null; end if;
  if new.rank is not null then
    if cardinality(g.ranks) = 0 then raise exception '% does not have ranks.', g.name; end if;
    new.rank_index := array_position(g.ranks, new.rank) - 1;
    if new.rank_index is null then raise exception 'Rank "%" is not a valid % rank.', new.rank, g.name; end if;
  else
    new.rank_index := null;
  end if;
  if new.main_role = '' then new.main_role := null; end if;
  if new.main_role is not null and not (new.main_role = any(g.roles)) then raise exception 'Invalid role for %.', g.name; end if;
  if not (new.secondary_roles <@ g.roles) then raise exception 'Invalid secondary role for %.', g.name; end if;
  new.secondary_roles := array(select r from unnest(new.secondary_roles) r where r is distinct from new.main_role);
  if not (new.preferred_modes <@ g.modes) then raise exception 'Invalid mode for %.', g.name; end if;
  if new.platform is not null and not (new.platform = any(g.platforms)) then raise exception '% is not available on that platform.', g.name; end if;
  return new;
end $$;
drop trigger if exists trg_validate_game_profile on public.user_game_profiles;
create trigger trg_validate_game_profile before insert or update on public.user_game_profiles
for each row execute function public.validate_game_profile();

-- Party capacity guard. Locks the party row so concurrent joins cannot overfill it.
create or replace function public.guard_party_capacity() returns trigger
language plpgsql security definer set search_path = public as $$
declare p parties;
begin
  select * into p from parties where id = new.party_id for update;
  if p.status = 'closed' then raise exception 'This party is closed.'; end if;
  if (select count(*) from party_members where party_id = new.party_id) >= p.max_size then
    raise exception 'This party is full.' using errcode = '23514';
  end if;
  return new;
end $$;
drop trigger if exists trg_guard_party_capacity on public.party_members;
create trigger trg_guard_party_capacity before insert on public.party_members
for each row execute function public.guard_party_capacity();

-- Keep member_count and the party chat membership in sync
create or replace function public.sync_party_membership() returns trigger
language plpgsql security definer set search_path = public as $$
declare pid uuid := coalesce(new.party_id, old.party_id); conv uuid;
begin
  update parties set member_count = (select count(*) from party_members where party_id = pid) where id = pid;
  select id into conv from conversations where party_id = pid;
  if conv is not null then
    if tg_op = 'INSERT' then
      insert into conversation_members (conversation_id, user_id) values (conv, new.user_id) on conflict do nothing;
    elsif tg_op = 'DELETE' then
      delete from conversation_members where conversation_id = conv and user_id = old.user_id;
    end if;
  end if;
  if tg_op = 'INSERT' then
    update profiles set stat_parties_joined = stat_parties_joined + 1 where id = new.user_id;
  end if;
  return null;
end $$;
drop trigger if exists trg_sync_party_membership on public.party_members;
create trigger trg_sync_party_membership after insert or delete on public.party_members
for each row execute function public.sync_party_membership();

-- =============================================================================
-- NOTIFICATIONS (created only by server functions; respects prefs, blocks, mutes)
-- =============================================================================
create or replace function public._notify(p_user uuid, p_type text, p_actor uuid,
  p_party uuid default null, p_conv uuid default null, p_data jsonb default '{}')
returns void language plpgsql security definer set search_path = public as $$
declare pr profiles;
begin
  if p_user is null or p_user = p_actor then return; end if;
  select * into pr from profiles where id = p_user;
  if not found or pr.is_demo then return; end if;
  if p_type not in ('moderation','report_update') and p_actor is not null then
    if _blocked(p_user, p_actor) or _mutes(p_user, p_actor) then return; end if;
  end if;
  if (p_type in ('friend_request','friend_accepted') and not pr.notify_friend_requests)
     or (p_type = 'party_invite' and not pr.notify_party_invites)
     or (p_type = 'join_request' and not pr.notify_join_requests)
     or (p_type in ('join_accepted','join_rejected','party_invite_accepted','party_removed','party_leadership','party_closed') and not pr.notify_request_updates)
     or (p_type = 'message' and not pr.notify_messages)
     or (p_type = 'mention' and not pr.notify_mentions)
     or (p_type = 'group_added' and not pr.notify_messages)
     or (p_type = 'call' and not pr.notify_messages)
     or (p_type = 'tournament' and not pr.notify_request_updates)
     or (p_type = 'beacon' and not pr.notify_party_invites)
     or (p_type = 'message' and p_conv is not null
         and exists (select 1 from conversation_members cm where cm.conversation_id = p_conv and cm.user_id = p_user and cm.muted)) then
    return;
  end if;
  if p_type = 'message' then
    update notifications set count = count + 1, created_at = now(), actor_id = p_actor, data = p_data
    where user_id = p_user and type = 'message' and conversation_id = p_conv and read_at is null;
    if found then return; end if;
  end if;
  insert into notifications (user_id, type, actor_id, party_id, conversation_id, data)
  values (p_user, p_type, p_actor, p_party, p_conv, p_data);
end $$;

-- =============================================================================
-- PROFILE & PRESENCE
-- =============================================================================
create or replace function public.heartbeat() returns void
language sql security definer set search_path = public as $$
  update profiles set last_seen_at = now() where id = auth.uid();
$$;

create or replace function public.is_username_available(p_username text) returns boolean
language sql stable security definer set search_path = public as $$
  select p_username ~ '^[A-Za-z0-9_]{3,20}$'
     and not exists (select 1 from profiles where lower(username) = lower(p_username) and id <> auth.uid())
$$;

create or replace function public.am_i_moderator() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('moderator', public.is_moderator(), 'admin', public.is_admin())
$$;

-- Achievements are computed from real activity on PartyUp (never fabricated)
create or replace function public._achievements(p_user uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  with s as (
    select p.stat_parties_created c, p.stat_parties_joined j, p.created_at,
      (select count(*) from friendships f where f.status = 'accepted' and p_user in (f.requester_id, f.addressee_id)) fr,
      (select count(*) from user_game_profiles g where g.user_id = p_user) gp,
      (p.region is not null and cardinality(p.languages) > 0 and cardinality(p.availability) > 0 and p.mic_preference is not null and p.bio <> '') complete
    from profiles p where p.id = p_user
  )
  select coalesce(jsonb_agg(a) filter (where (a ->> 'earned')::boolean), '[]'::jsonb) from s,
  lateral (values
    (jsonb_build_object('key','party_starter','label','Party Starter','description','Created a party','earned', s.c >= 1)),
    (jsonb_build_object('key','squad_builder','label','Squad Builder','description','Created 10 parties','earned', s.c >= 10)),
    (jsonb_build_object('key','team_player','label','Team Player','description','Joined 5 parties','earned', s.j >= 5)),
    (jsonb_build_object('key','social','label','Social','description','Has 5 friends','earned', s.fr >= 5)),
    (jsonb_build_object('key','well_connected','label','Well Connected','description','Has 25 friends','earned', s.fr >= 25)),
    (jsonb_build_object('key','multi_gamer','label','Multi-Gamer','description','Plays 3+ games','earned', s.gp >= 3)),
    (jsonb_build_object('key','profile_pro','label','Profile Pro','description','Completed every profile section','earned', s.complete)),
    (jsonb_build_object('key','veteran','label','Veteran','description','Member for a year','earned', s.created_at < now() - interval '1 year'))
  ) v(a)
$$;

-- =============================================================================
-- COMPATIBILITY SCORING
-- Score = sum(points) / sum(weights of factors that apply) × 100.
-- Uses only the candidate's *public* (privacy-masked) data. It is an estimate,
-- not a guarantee — the factor breakdown is returned so the UI can explain it.
-- =============================================================================
create or replace function public._factor(p_key text, p_label text, p_weight numeric, p_ratio numeric, p_detail text)
returns jsonb language sql immutable as $$
  select jsonb_build_object('key', p_key, 'label', p_label, 'weight', p_weight,
                            'points', round(p_weight * greatest(0, least(1, p_ratio)), 1), 'detail', p_detail)
$$;

create or replace function public._mic_fit(pref text, mic text) returns numeric language sql immutable as $$
  select case
    when pref = 'required' then case mic when 'always' then 1 when 'usually' then 0.9 when 'sometimes' then 0.4 when 'text_only' then 0 else 0.5 end
    when pref = 'preferred' then case mic when 'always' then 1 when 'usually' then 1 when 'sometimes' then 0.7 when 'text_only' then 0.3 else 0.6 end
    else 1 end
$$;

create or replace function public._compat(p_viewer uuid, p_cand uuid, p_game text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v profiles; c public_profiles; g games;
  vg user_game_profiles; cg public_game_profiles;
  f jsonb := '[]'::jsonb; r numeric; d text; diff int; ov int; shared int; vcount int;
  v_look text; c_look text; jac numeric; trait numeric; vstyles text[]; cstyles text[];
  tw numeric := 0; tp numeric := 0; item jsonb; score int;
begin
  select * into v from profiles where id = p_viewer;
  select * into c from public_profiles where id = p_cand;
  if v.id is null or c.id is null then return null; end if;
  if p_game is not null then
    select * into g from games where id = p_game;
    select * into vg from user_game_profiles where user_id = p_viewer and game_id = p_game;
    select * into cg from public_game_profiles where user_id = p_cand and game_id = p_game;
  end if;

  -- 1. Shared game
  if p_game is not null then
    f := f || _factor('game', 'Plays ' || coalesce(g.name, 'this game'), 15, case when cg.id is not null then 1 else 0 end,
                      case when cg.id is not null then 'Both play ' || g.name else 'Doesn''t list ' || g.name end);
  else
    select count(*) into vcount from user_game_profiles where user_id = p_viewer;
    select count(*) into shared from user_game_profiles a join public_game_profiles b on b.game_id = a.game_id and b.user_id = p_cand
      where a.user_id = p_viewer;
    f := f || _factor('game', 'Shared games', 15, case when vcount = 0 then 0 else least(1, shared::numeric / least(vcount, 2)) end,
                      shared || ' game' || case when shared = 1 then '' else 's' end || ' in common');
  end if;

  -- 2. Rank proximity (weighted per game)
  if g.id is not null and cardinality(g.ranks) > 0 and g.rank_weight > 0 then
    if vg.rank_index is not null and cg.rank_index is not null then
      diff := abs(vg.rank_index - cg.rank_index);
      r := 1 - diff::numeric / (g.rank_tolerance + 1);
      d := case when diff = 0 then 'Same rank (' || cg.rank || ')'
                else cg.rank || ' — ' || diff || ' tier' || case when diff = 1 then '' else 's' end || ' from you' end;
    else
      r := 0.5; d := case when vg.rank_index is null then 'Add your rank for a better estimate' else 'Rank not shared' end;
    end if;
    f := f || _factor('rank', 'Rank', g.rank_weight, r, d);
  end if;

  -- 3. Role fit
  if g.id is not null and cardinality(g.roles) > 0 then
    if vg.main_role is not null and cg.main_role is not null then
      if cg.main_role <> vg.main_role then r := 1; d := 'Mains ' || cg.main_role || ' — complements your ' || vg.main_role;
      elsif exists (select 1 from unnest(cg.secondary_roles) s where s <> vg.main_role) then r := 0.6; d := 'Same main role, but flexes other roles';
      else r := 0.25; d := 'Same main role as you (' || cg.main_role || ')'; end if;
    else r := 0.5; d := 'Role not set'; end if;
    f := f || _factor('role', 'Role fit', 12, r, d);
  end if;

  -- 4. Platform
  if vg.platform is not null and cg.platform is not null then
    r := case when vg.platform = cg.platform then 1 else 0.4 end;
    d := case when vg.platform = cg.platform then 'Same platform' else 'Different platform — check cross-play' end;
  elsif cardinality(v.platforms) > 0 and cardinality(c.platforms) > 0 then
    r := case when v.platforms && c.platforms then 1 else 0.3 end;
    d := case when v.platforms && c.platforms then 'Shares a platform with you' else 'No shared platform' end;
  else r := 0.5; d := 'Platform unknown'; end if;
  f := f || _factor('platform', 'Platform', 10, r, d);

  -- 5. Language
  if cardinality(v.languages) > 0 and cardinality(c.languages) > 0 then
    r := case when v.languages && c.languages then 1 else 0 end;
    d := case when v.languages && c.languages then 'Speaks a language you speak' else 'No shared language' end;
  else r := 0.5; d := 'Languages unknown'; end if;
  f := f || _factor('language', 'Language', 12, r, d);

  -- 6. Region (ping)
  if v.region is not null and c.region is not null then
    r := case when v.region = c.region then 1 when split_part(v.region, '-', 1) = split_part(c.region, '-', 1) then 0.6 else 0 end;
    d := case when r = 1 then 'Same region' when r > 0 then 'Nearby region' else 'Different region — expect higher ping' end;
  else r := 0.5; d := 'Region unknown'; end if;
  f := f || _factor('region', 'Region', 10, r, d);

  -- 7. Playtime overlap
  if cardinality(v.availability) > 0 and cardinality(c.availability) > 0 then
    ov := _overlap(v.availability, c.availability);
    r := least(1, ov::numeric / least(cardinality(v.availability), cardinality(c.availability)) * 1.25);
    d := '~' || ov || ' h/week overlap';
  else r := 0.4; d := 'Schedule not shared'; end if;
  f := f || _factor('schedule', 'Playtime overlap', 15, r, d);

  -- 8. Microphone (mutual)
  r := least(_mic_fit(v.pref_teammate_mic, c.mic_preference), _mic_fit(c.pref_teammate_mic, v.mic_preference));
  d := case when r >= 0.9 then 'Mic expectations line up' when r >= 0.5 then 'Mic expectations partly line up' else 'Mic expectations differ' end;
  f := f || _factor('mic', 'Voice chat', 8, r, d);

  -- 9. Playstyle & intent
  v_look := coalesce(vg.looking_for, v.looking_for); c_look := coalesce(cg.looking_for, c.looking_for);
  vstyles := v.playstyles || coalesce(vg.playstyles, '{}'); cstyles := c.playstyles || coalesce(cg.playstyles, '{}');
  if cardinality(vstyles) > 0 and cardinality(cstyles) > 0 then
    jac := (select count(*) from (select unnest(vstyles) intersect select unnest(cstyles)) x)::numeric
         / nullif((select count(*) from (select unnest(vstyles) union select unnest(cstyles)) y), 0);
  else jac := 0.5; end if;
  trait := case when cardinality(v.teammate_traits) = 0 then 0.5
                when (v.teammate_traits && array['competitive'] and 'competitive' = any(cstyles))
                  or (v.teammate_traits && array['chill'] and 'chill' = any(cstyles))
                  or (v.teammate_traits && array['shotcaller'] and 'shotcaller' = any(cstyles))
                  or (v.teammate_traits && array['good_comms'] and 'communicative' = any(cstyles)) then 1
                else 0.4 end;
  r := 0.5 * (case when v_look = c_look or 'both' in (v_look, c_look) then 1 else 0 end)
     + 0.5 * least(1, greatest(jac * 1.5, trait * 0.8));
  d := case when not (v_look = c_look or 'both' in (v_look, c_look)) then 'Wants ' || c_look || ' play, you want ' || v_look
            when jac >= 0.34 then 'Similar playstyle' else 'Compatible intent, different styles' end;
  f := f || _factor('playstyle', 'Playstyle', 10, r, d);

  for item in select * from jsonb_array_elements(f) loop
    tw := tw + (item ->> 'weight')::numeric; tp := tp + (item ->> 'points')::numeric;
  end loop;
  score := case when tw = 0 then 0 else round(100 * tp / tw) end;
  return jsonb_build_object('score', score, 'game_id', p_game,
    'label', case when score >= 80 then 'Great match' when score >= 65 then 'Good match' when score >= 50 then 'Fair match' else 'Low match' end,
    'factors', f);
end $$;

-- Without a game context: score every shared game and keep the best one.
create or replace function public._best_compat(p_viewer uuid, p_cand uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare best jsonb; cur jsonb; gid text;
begin
  for gid in select a.game_id from user_game_profiles a join public_game_profiles b on b.game_id = a.game_id and b.user_id = p_cand
             where a.user_id = p_viewer loop
    cur := _compat(p_viewer, p_cand, gid);
    if best is null or (cur ->> 'score')::int > (best ->> 'score')::int then best := cur; end if;
  end loop;
  return coalesce(best, _compat(p_viewer, p_cand, null));
end $$;

create or replace function public.get_compatibility(p_user uuid, p_game text default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare me uuid := _require_user();
begin
  if p_user = me then return null; end if;
  return case when p_game is null then _best_compat(me, p_user) else _compat(me, p_user, p_game) end;
end $$;

-- =============================================================================
-- PLAYER DISCOVERY
-- =============================================================================
create or replace function public._player_json(p_viewer uuid, pp public_profiles, p_compat jsonb) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'id', pp.id, 'username', pp.username, 'avatar_url', pp.avatar_url, 'bio', pp.bio,
    'region', pp.region, 'languages', pp.languages, 'platforms', pp.platforms,
    'mic_preference', pp.mic_preference, 'playstyles', pp.playstyles, 'looking_for', pp.looking_for,
    'status', pp.status, 'last_active_at', pp.last_active_at, 'is_demo', pp.is_demo,
    'level', pp.level, 'name_style', pp.name_style, 'avatar_decoration', pp.avatar_decoration,
    'beacon_game', pp.beacon_game, 'beacon_until', pp.beacon_until,
    'overlap_hours', (select _overlap(v.availability, pp.availability) from profiles v where v.id = p_viewer),
    'has_schedule', cardinality(pp.availability) > 0,
    'relationship', _relationship(p_viewer, pp.id),
    'compatibility', p_compat,
    'games', coalesce((select jsonb_agg(jsonb_build_object('game_id', g.game_id, 'name', gm.name, 'short_name', gm.short_name,
                         'accent_color', gm.accent_color, 'rank', g.rank, 'main_role', g.main_role,
                         'secondary_roles', g.secondary_roles, 'platform', g.platform) order by gm.sort_order)
                       from public_game_profiles g join games gm on gm.id = g.game_id where g.user_id = pp.id), '[]'::jsonb))
$$;

create or replace function public.find_players(
  p_game text default null, p_region text default null, p_platform text default null, p_language text default null,
  p_min_rank int default null, p_max_rank int default null, p_role text default null, p_mic text default null,
  p_playstyle text default null, p_availability text default 'any', p_online_only boolean default false,
  p_search text default null, p_sort text default 'compatibility', p_limit int default 12, p_offset int default 0,
  p_include_demo boolean default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare me uuid := _require_user(); v profiles; demo boolean; slot int := _slot_now(); total int; result jsonb; pat text;
begin
  select * into v from profiles where id = me;
  demo := coalesce(p_include_demo, v.show_demo_players);
  p_limit := least(greatest(coalesce(p_limit, 12), 1), 48);
  p_offset := greatest(coalesce(p_offset, 0), 0);
  pat := case when nullif(btrim(p_search), '') is null then null
              else '%' || replace(replace(replace(btrim(p_search), '\', '\\'), '%', '\%'), '_', '\_') || '%' end;

  with cand as (
  select pp.id,
         case when p_game is null then _best_compat(me, pp.id) else _compat(me, pp.id, p_game) end as compat,
         pp.last_active_at as last_active,
         (select count(*) from rate_events re where re.user_id = pp.id and re.created_at > now() - interval '14 days')::int
           + (select count(*) from party_members pm where pm.user_id = pp.id and pm.joined_at > now() - interval '14 days')::int as activity
  from public_profiles pp
  where pp.id <> me and pp.discoverable and (demo or not pp.is_demo)
    and (p_game is null or exists (select 1 from public_game_profiles g where g.user_id = pp.id and g.game_id = p_game))
    and (p_region is null or pp.region = p_region)
    and (p_platform is null or p_platform = any(pp.platforms)
         or exists (select 1 from public_game_profiles g where g.user_id = pp.id and g.platform = p_platform and (p_game is null or g.game_id = p_game)))
    and (p_language is null or p_language = any(pp.languages))
    and (p_game is null or (p_min_rank is null and p_max_rank is null)
         or exists (select 1 from public_game_profiles g where g.user_id = pp.id and g.game_id = p_game
                    and g.rank_index between coalesce(p_min_rank, 0) and coalesce(p_max_rank, 999)))
    and (p_role is null or exists (select 1 from public_game_profiles g where g.user_id = pp.id and (p_game is null or g.game_id = p_game)
                                   and (g.main_role = p_role or p_role = any(g.secondary_roles))))
    and (p_mic is null or (p_mic = 'has_mic' and pp.mic_preference in ('always','usually','sometimes')) or pp.mic_preference = p_mic)
    and (p_playstyle is null or p_playstyle = any(pp.playstyles)
         or exists (select 1 from public_game_profiles g where g.user_id = pp.id and p_playstyle = any(g.playstyles) and (p_game is null or g.game_id = p_game)))
    and (coalesce(p_availability, 'any') = 'any'
         or (p_availability = 'overlap' and pp.availability && v.availability)
         or (p_availability = 'now' and slot::smallint = any(pp.availability)))
    and (not coalesce(p_online_only, false) or pp.status <> 'offline')
    and (pat is null or pp.username ilike pat)
  ), scored as (
    select c.*, (c.compat ->> 'score')::int as score from cand c
  )
  select (select count(*) from scored),
         coalesce((select jsonb_agg(_player_json(me, pp, x.compat) order by x.ord)
                   from (select s.*, row_number() over (order by
                             case when p_sort = 'recent' then s.last_active end desc nulls last,
                             case when p_sort = 'activity' then s.activity end desc nulls last,
                             s.score desc nulls last, s.last_active desc nulls last, s.id) ord
                         from scored s order by ord limit p_limit offset p_offset) x
                   join public_profiles pp on pp.id = x.id), '[]'::jsonb)
    into total, result;

  return jsonb_build_object('total', total, 'limit', p_limit, 'offset', p_offset, 'players', result);
end $$;

create or replace function public.get_player_profile(p_user uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare me uuid := _require_user(); pp public_profiles; out jsonb;
begin
  select * into pp from public_profiles where id = p_user;
  if not found then
    if exists (select 1 from blocks where blocker_id = me and blocked_id = p_user) then
      return jsonb_build_object('blocked_by_me', true, 'id', p_user,
        'username', (select username from profiles where id = p_user));
    end if;
    return null;
  end if;
  out := _player_json(me, pp, case when p_user = me then null else _best_compat(me, p_user) end);
  return out || jsonb_build_object(
    'teammate_traits', pp.teammate_traits, 'pref_teammate_mic', pp.pref_teammate_mic,
    'highlights', pp.highlights, 'availability', pp.availability, 'created_at', pp.created_at,
    'achievements', _achievements(p_user),
    'custom_status', pp.custom_status, 'status_emoji', pp.status_emoji, 'banner_url', pp.banner_url,
    'theme_color', pp.theme_color, 'theme_color_2', pp.theme_color_2, 'name_style', pp.name_style,
    'avatar_decoration', pp.avatar_decoration, 'profile_effect', pp.profile_effect,
    'tournament_stats', _tournament_host_stats(p_user),
    'xp', pp.xp, 'level', pp.level, 'endorsements', _endorsement_summary(p_user),
    'beacon', case when pp.beacon_game is not null then jsonb_build_object('game', pp.beacon_game, 'until', pp.beacon_until, 'note', pp.beacon_note) end,
    'is_self', p_user = me,
    'muted_by_me', _mutes(me, p_user),
    'can_message', p_user <> me and (pp.allow_messages = 'everyone' or (pp.allow_messages = 'friends' and _are_friends(me, p_user))),
    'can_friend', p_user <> me and pp.allow_friend_requests = 'everyone',
    'can_invite', p_user <> me and (pp.allow_party_invites = 'everyone' or (pp.allow_party_invites = 'friends' and _are_friends(me, p_user))),
    'game_profiles', coalesce((select jsonb_agg(to_jsonb(g) || jsonb_build_object('name', gm.name, 'short_name', gm.short_name,
                         'accent_color', gm.accent_color, 'rank_count', cardinality(gm.ranks),
                         'compatibility', case when p_user = me then null else _compat(me, p_user, g.game_id) end) order by gm.sort_order)
                       from public_game_profiles g join games gm on gm.id = g.game_id where g.user_id = p_user), '[]'::jsonb),
    'friend_count', (select count(*) from friendships f where f.status = 'accepted' and p_user in (f.requester_id, f.addressee_id))
  );
end $$;

-- =============================================================================
-- PARTIES
-- =============================================================================
create or replace function public._party_status(p parties) returns text language sql stable as $$
  select case when p.status = 'closed' then 'closed' when p.member_count >= p.max_size then 'full' else 'open' end
$$;

create or replace function public._party_score(p_user uuid, p parties) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare me profiles; gp user_game_profiles; g games; f jsonb := '[]'; r numeric; d text; tw numeric := 0; tp numeric := 0; item jsonb; score int;
begin
  select * into me from profiles where id = p_user;
  select * into gp from user_game_profiles where user_id = p_user and game_id = p.game_id;
  select * into g from games where id = p.game_id;
  f := f || _factor('game', 'Game', 15, case when gp.id is not null then 1 else 0 end,
                    case when gp.id is not null then 'You play ' || g.name else 'Not in your game profiles' end);
  if p.min_rank_index is not null or p.max_rank_index is not null then
    if gp.rank_index is null then r := 0.3; d := 'Add your rank to check eligibility';
    elsif gp.rank_index between coalesce(p.min_rank_index, 0) and coalesce(p.max_rank_index, 999) then r := 1; d := 'Your rank fits the range';
    else r := 0; d := 'Your rank is outside the range'; end if;
    f := f || _factor('rank', 'Rank range', g.rank_weight, r, d);
  end if;
  if cardinality(p.needed_roles) > 0 then
    if gp.main_role = any(p.needed_roles) then r := 1; d := 'Needs your main role (' || gp.main_role || ')';
    elsif gp.secondary_roles && p.needed_roles then r := 0.7; d := 'Needs one of your secondary roles';
    else r := 0.15; d := 'Looking for ' || array_to_string(p.needed_roles, ', '); end if;
    f := f || _factor('role', 'Roles needed', 12, r, d);
  end if;
  if p.language is not null then
    f := f || _factor('language', 'Language', 12, case when p.language = any(me.languages) then 1 else 0 end,
                      case when p.language = any(me.languages) then 'Speaks your language' else 'Party language differs' end);
  end if;
  if p.region is not null then
    r := case when p.region = me.region then 1 when split_part(p.region, '-', 1) = split_part(coalesce(me.region, ''), '-', 1) then 0.6 else 0 end;
    f := f || _factor('region', 'Region', 10, r, case when r = 1 then 'Same region' when r > 0 then 'Nearby region' else 'Different region' end);
  end if;
  if p.platform is not null then
    r := case when p.platform = gp.platform or p.platform = any(me.platforms) then 1 else 0.2 end;
    f := f || _factor('platform', 'Platform', 10, r, case when r = 1 then 'Your platform' else 'Different platform' end);
  end if;
  r := case when coalesce(gp.looking_for, me.looking_for) in ('both', p.play_type) then 1 else 0.2 end;
  f := f || _factor('playstyle', 'Play type', 8, r, initcap(p.play_type) || ' session');
  if p.mic_required then
    r := case when me.mic_preference in ('always','usually') then 1 when me.mic_preference = 'sometimes' then 0.5 else 0 end;
    f := f || _factor('mic', 'Mic required', 8, r, case when r >= 1 then 'You use a mic' else 'Party requires a mic' end);
  end if;
  for item in select * from jsonb_array_elements(f) loop
    tw := tw + (item ->> 'weight')::numeric; tp := tp + (item ->> 'points')::numeric;
  end loop;
  score := case when tw = 0 then 0 else round(100 * tp / tw) end;
  return jsonb_build_object('score', score, 'factors', f,
    'label', case when score >= 80 then 'Great fit' when score >= 65 then 'Good fit' when score >= 50 then 'Fair fit' else 'Low fit' end);
end $$;

create or replace function public._party_json(p_user uuid, p parties, p_with_score boolean default true) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'id', p.id, 'title', p.title, 'description', p.description, 'game_id', p.game_id,
    'game', jsonb_build_object('id', g.id, 'name', g.name, 'short_name', g.short_name, 'accent_color', g.accent_color,
                               'ranks', g.ranks, 'roles', g.roles, 'max_party_size', g.max_party_size),
    'max_size', p.max_size, 'member_count', p.member_count, 'open_slots', greatest(p.max_size - p.member_count, 0),
    'needed_roles', p.needed_roles, 'play_type', p.play_type,
    'min_rank', case when p.min_rank_index is not null then g.ranks[p.min_rank_index + 1] end,
    'max_rank', case when p.max_rank_index is not null then g.ranks[p.max_rank_index + 1] end,
    'min_rank_index', p.min_rank_index, 'max_rank_index', p.max_rank_index,
    'language', p.language, 'region', p.region, 'platform', p.platform, 'mic_required', p.mic_required,
    'visibility', p.visibility, 'scheduled_for', p.scheduled_for, 'status', _party_status(p),
    'is_demo', p.is_demo, 'created_at', p.created_at, 'leader_id', p.leader_id,
    'leader', _card(p.leader_id),
    'members', coalesce((select jsonb_agg(_card(m.user_id) || jsonb_build_object('role', m.role, 'joined_at', m.joined_at) order by m.joined_at)
                         from party_members m where m.party_id = p.id), '[]'::jsonb),
    'my_relation', case when p.leader_id = p_user then 'leader'
                        when exists (select 1 from party_members m where m.party_id = p.id and m.user_id = p_user) then 'member'
                        when exists (select 1 from party_invites i where i.party_id = p.id and i.invitee_id = p_user and i.status = 'pending') then 'invited'
                        when exists (select 1 from party_join_requests r where r.party_id = p.id and r.user_id = p_user and r.status = 'pending') then 'requested'
                        else 'none' end,
    'fit', case when p_with_score then _party_score(p_user, p) end)
  from games g where g.id = p.game_id
$$;

create or replace function public._can_see_party(p_user uuid, p parties) returns boolean
language sql stable security definer set search_path = public as $$
  select p.leader_id = p_user
      or exists (select 1 from party_members m where m.party_id = p.id and m.user_id = p_user)
      or exists (select 1 from party_invites i where i.party_id = p.id and i.invitee_id = p_user and i.status = 'pending')
      or (p.visibility = 'public' and not _blocked(p.leader_id, p_user))
      or is_moderator(p_user)
$$;

create or replace function public.create_party(
  p_game text, p_title text, p_max_size int, p_description text default '', p_needed_roles text[] default '{}',
  p_play_type text default 'casual', p_min_rank int default null, p_max_rank int default null,
  p_language text default null, p_region text default null, p_platform text default null,
  p_mic_required boolean default false, p_visibility text default 'public', p_scheduled_for timestamptz default null,
  p_my_role text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare me uuid := _require_active(); g games; pid uuid;
begin
  perform _rate_limit('create_party', 10, interval '1 day', 'parties created');
  select * into g from games where id = p_game and is_active;
  if not found then raise exception 'Choose a game.'; end if;
  if p_max_size is null or p_max_size < 2 or p_max_size > g.max_party_size then
    raise exception 'Party size for % must be between 2 and %.', g.name, g.max_party_size;
  end if;
  if not (coalesce(p_needed_roles, '{}') <@ g.roles) then raise exception 'Invalid role for %.', g.name; end if;
  if p_my_role is not null and not (p_my_role = any(g.roles)) then raise exception 'Invalid role for %.', g.name; end if;
  if (p_min_rank is not null or p_max_rank is not null) and cardinality(g.ranks) = 0 then raise exception '% has no ranks.', g.name; end if;
  if p_min_rank is not null and (p_min_rank < 0 or p_min_rank >= cardinality(g.ranks)) then raise exception 'Invalid minimum rank.'; end if;
  if p_max_rank is not null and (p_max_rank < 0 or p_max_rank >= cardinality(g.ranks)) then raise exception 'Invalid maximum rank.'; end if;
  if p_min_rank is not null and p_max_rank is not null and p_min_rank > p_max_rank then raise exception 'Minimum rank must be below maximum rank.'; end if;
  if p_platform is not null and not (p_platform = any(g.platforms)) then raise exception '% is not on that platform.', g.name; end if;
  if p_scheduled_for is not null and p_scheduled_for < now() - interval '1 hour' then raise exception 'Scheduled time is in the past.'; end if;
  if p_visibility not in ('public','invite_only') then raise exception 'Invalid visibility.'; end if;

  insert into parties (leader_id, game_id, title, description, max_size, needed_roles, play_type, min_rank_index, max_rank_index,
                       language, region, platform, mic_required, visibility, scheduled_for)
  values (me, p_game, btrim(p_title), coalesce(p_description, ''), p_max_size, coalesce(p_needed_roles, '{}'), p_play_type,
          p_min_rank, p_max_rank, nullif(p_language, ''), nullif(p_region, ''), nullif(p_platform, ''), coalesce(p_mic_required, false),
          p_visibility, p_scheduled_for)
  returning id into pid;
  insert into conversations (kind, party_id) values ('party', pid);
  insert into party_members (party_id, user_id, role) values (pid, me, p_my_role);
  update profiles set stat_parties_created = stat_parties_created + 1 where id = me;
  return pid;
end $$;

create or replace function public.update_party(p_party uuid, p_title text default null, p_description text default null,
  p_needed_roles text[] default null, p_visibility text default null, p_max_size int default null,
  p_scheduled_for timestamptz default null, p_clear_schedule boolean default false)
returns void language plpgsql security definer set search_path = public as $$
declare me uuid := _require_active(); p parties; g games;
begin
  select * into p from parties where id = p_party for update;
  if not found or p.leader_id <> me then raise exception 'Only the party leader can edit this party.' using errcode = '42501'; end if;
  if p.status = 'closed' then raise exception 'This party is closed.'; end if;
  select * into g from games where id = p.game_id;
  if p_max_size is not null and (p_max_size < greatest(2, p.member_count) or p_max_size > g.max_party_size) then
    raise exception 'Party size must be between % and %.', greatest(2, p.member_count), g.max_party_size;
  end if;
  if p_needed_roles is not null and not (p_needed_roles <@ g.roles) then raise exception 'Invalid role.'; end if;
  update parties set
    title = coalesce(nullif(btrim(p_title), ''), title),
    description = coalesce(p_description, description),
    needed_roles = coalesce(p_needed_roles, needed_roles),
    visibility = coalesce(p_visibility, visibility),
    max_size = coalesce(p_max_size, max_size),
    scheduled_for = case when p_clear_schedule then null else coalesce(p_scheduled_for, scheduled_for) end
  where id = p_party;
end $$;

create or replace function public.list_parties(p_game text default null, p_play_type text default null, p_language text default null,
  p_region text default null, p_scope text default 'browse', p_search text default null, p_include_full boolean default false,
  p_sort text default 'fit', p_limit int default 12, p_offset int default 0)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare me uuid := _require_user(); v profiles; total int; result jsonb; pat text;
begin
  select * into v from profiles where id = me;
  p_limit := least(greatest(coalesce(p_limit, 12), 1), 48);
  pat := case when nullif(btrim(p_search), '') is null then null
              else '%' || replace(replace(replace(btrim(p_search), '\', '\\'), '%', '\%'), '_', '\_') || '%' end;
  with base as (
    select p.id from parties p
    where case
            when p_scope = 'mine' then exists (select 1 from party_members m where m.party_id = p.id and m.user_id = me)
            when p_scope = 'history' then p.status = 'closed' and exists (select 1 from party_members m where m.party_id = p.id and m.user_id = me)
            else p.visibility = 'public' and p.status = 'open' and not _blocked(p.leader_id, me)
                 and (v.show_demo_players or not p.is_demo)
                 and (coalesce(p_include_full, false) or p.member_count < p.max_size)
          end
      and (p_scope <> 'mine' or p.status = 'open')
      and (p_game is null or p.game_id = p_game)
      and (p_play_type is null or p.play_type = p_play_type)
      and (p_language is null or p.language = p_language)
      and (p_region is null or p.region = p_region)
      and (pat is null or p.title ilike pat or p.description ilike pat)
  ), scored as (
    select p.id, p.created_at, p.scheduled_for, (_party_score(me, p) ->> 'score')::int as score
    from base b join parties p on p.id = b.id
  )
  select (select count(*) from scored),
         coalesce((select jsonb_agg(_party_json(me, p, true) order by x.ord)
                   from (select sc.id, row_number() over (order by
                             case when p_sort = 'newest' or p_scope <> 'browse' then sc.created_at end desc nulls last,
                             case when p_sort = 'soonest' then sc.scheduled_for end asc nulls last,
                             sc.score desc, sc.created_at desc) ord
                         from scored sc order by ord limit p_limit offset greatest(coalesce(p_offset, 0), 0)) x
                   join parties p on p.id = x.id), '[]'::jsonb)
    into total, result;
  return jsonb_build_object('total', total, 'parties', result);
end $$;

create or replace function public.get_party(p_party uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare me uuid := _require_user(); p parties; out jsonb;
begin
  select * into p from parties where id = p_party;
  if not found or not _can_see_party(me, p) then return null; end if;
  out := _party_json(me, p, true);
  if p.leader_id = me or is_moderator(me) then
    out := out || jsonb_build_object(
      'join_requests', coalesce((select jsonb_agg(jsonb_build_object('id', r.id, 'role', r.role, 'message', r.message, 'created_at', r.created_at,
                         'user', _card(r.user_id), 'fit', _party_score(r.user_id, p)) order by r.created_at)
                       from party_join_requests r where r.party_id = p.id and r.status = 'pending' and _card(r.user_id) is not null), '[]'::jsonb),
      'invites', coalesce((select jsonb_agg(jsonb_build_object('id', i.id, 'created_at', i.created_at, 'user', _card(i.invitee_id)) order by i.created_at)
                       from party_invites i where i.party_id = p.id and i.status = 'pending' and _card(i.invitee_id) is not null), '[]'::jsonb));
  end if;
  if exists (select 1 from party_members m where m.party_id = p.id and m.user_id = me) then
    out := out || jsonb_build_object('conversation_id', (select id from conversations where party_id = p.id));
  end if;
  if out ->> 'my_relation' = 'invited' then
    out := out || jsonb_build_object('invite_id', (select id from party_invites where party_id = p.id and invitee_id = me and status = 'pending'));
  end if;
  if out ->> 'my_relation' = 'requested' then
    out := out || jsonb_build_object('request_id', (select id from party_join_requests where party_id = p.id and user_id = me and status = 'pending'));
  end if;
  return out;
end $$;

-- Internal: add a member (capacity enforced by trigger) and tidy pending invites/requests
create or replace function public._add_member(p_party uuid, p_user uuid, p_role text) returns void
language plpgsql security definer set search_path = public as $$
begin
  insert into party_members (party_id, user_id, role) values (p_party, p_user, p_role);
  update party_invites set status = 'cancelled', responded_at = now() where party_id = p_party and invitee_id = p_user and status = 'pending';
  update party_join_requests set status = 'cancelled', responded_at = now() where party_id = p_party and user_id = p_user and status = 'pending';
end $$;

create or replace function public.request_join_party(p_party uuid, p_role text default null, p_message text default '')
returns uuid language plpgsql security definer set search_path = public as $$
declare me uuid := _require_active(); p parties; g games; gp user_game_profiles; rid uuid;
begin
  select * into p from parties where id = p_party;
  if not found or not _can_see_party(me, p) then raise exception 'Party not found.'; end if;
  if p.visibility <> 'public' then raise exception 'This party is invite only.'; end if;
  if p.status = 'closed' then raise exception 'This party is closed.'; end if;
  if p.member_count >= p.max_size then raise exception 'This party is full.'; end if;
  if exists (select 1 from party_members where party_id = p_party and user_id = me) then raise exception 'You are already in this party.'; end if;
  if exists (select 1 from party_join_requests where party_id = p_party and user_id = me and status = 'pending') then
    raise exception 'You already asked to join this party.';
  end if;
  select * into g from games where id = p.game_id;
  if p_role is not null and not (p_role = any(g.roles)) then raise exception 'Invalid role for %.', g.name; end if;
  if p.min_rank_index is not null or p.max_rank_index is not null then
    select * into gp from user_game_profiles where user_id = me and game_id = p.game_id;
    if gp.rank_index is null then raise exception 'This party has a rank range. Add your % rank in Game Profiles first.', g.name; end if;
    if gp.rank_index not between coalesce(p.min_rank_index, 0) and coalesce(p.max_rank_index, 999) then
      raise exception 'Your rank (%) is outside this party''s range.', gp.rank;
    end if;
  end if;
  perform _rate_limit('join_request', 20, interval '1 hour', 'join requests');
  insert into party_join_requests (party_id, user_id, role, message) values (p_party, me, p_role, left(coalesce(p_message, ''), 200))
  returning id into rid;
  perform _notify(p.leader_id, 'join_request', me, p_party, null, jsonb_build_object('party_title', p.title, 'role', p_role));
  return rid;
end $$;

create or replace function public.cancel_join_request(p_request uuid) returns void
language plpgsql security definer set search_path = public as $$
declare me uuid := _require_user();
begin
  update party_join_requests set status = 'cancelled', responded_at = now()
  where id = p_request and user_id = me and status = 'pending';
  if not found then raise exception 'Request not found.'; end if;
end $$;

create or replace function public.respond_join_request(p_request uuid, p_accept boolean) returns void
language plpgsql security definer set search_path = public as $$
declare me uuid := _require_active(); r party_join_requests; p parties;
begin
  select * into r from party_join_requests where id = p_request for update;
  if not found then raise exception 'Request not found.'; end if;
  select * into p from parties where id = r.party_id for update;
  if p.leader_id <> me then raise exception 'Only the party leader can respond to join requests.' using errcode = '42501'; end if;
  if r.status <> 'pending' then raise exception 'This request was already handled.'; end if;
  if p_accept then
    if _blocked(me, r.user_id) then raise exception 'You can''t add this player.'; end if;
    perform _add_member(p.id, r.user_id, r.role);  -- raises if full or closed
    update party_join_requests set status = 'accepted', responded_at = now() where id = p_request;
    perform _notify(r.user_id, 'join_accepted', me, p.id, null, jsonb_build_object('party_title', p.title));
  else
    update party_join_requests set status = 'rejected', responded_at = now() where id = p_request;
    perform _notify(r.user_id, 'join_rejected', me, p.id, null, jsonb_build_object('party_title', p.title));
  end if;
end $$;

create or replace function public.invite_to_party(p_party uuid, p_user uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare me uuid := _require_active(); p parties; t profiles; iid uuid;
begin
  select * into p from parties where id = p_party;
  if not found then raise exception 'Party not found.'; end if;
  if p.leader_id <> me and not (p.visibility = 'public' and exists (select 1 from party_members where party_id = p_party and user_id = me)) then
    raise exception 'Only the party leader can invite to this party.' using errcode = '42501';
  end if;
  if p.status = 'closed' then raise exception 'This party is closed.'; end if;
  if p.member_count >= p.max_size then raise exception 'This party is full.'; end if;
  select * into t from profiles where id = p_user;
  if not found or t.onboarded_at is null or t.is_banned or _blocked(me, p_user) then raise exception 'You can''t invite this player.'; end if;
  if t.allow_party_invites = 'nobody' or (t.allow_party_invites = 'friends' and not _are_friends(me, p_user)) then
    raise exception '% isn''t accepting party invites from you.', t.username;
  end if;
  if exists (select 1 from party_members where party_id = p_party and user_id = p_user) then raise exception '% is already in this party.', t.username; end if;
  if exists (select 1 from party_invites where party_id = p_party and invitee_id = p_user and status = 'pending') then
    raise exception '% already has an invite.', t.username;
  end if;
  perform _rate_limit('party_invite', 30, interval '1 hour', 'invites');
  insert into party_invites (party_id, inviter_id, invitee_id) values (p_party, me, p_user) returning id into iid;
  perform _notify(p_user, 'party_invite', me, p_party, null, jsonb_build_object('party_title', p.title, 'game_id', p.game_id));
  return iid;
end $$;

create or replace function public.respond_party_invite(p_invite uuid, p_accept boolean, p_role text default null) returns void
language plpgsql security definer set search_path = public as $$
declare me uuid := _require_active(); i party_invites; p parties;
begin
  select * into i from party_invites where id = p_invite for update;
  if not found or i.invitee_id <> me then raise exception 'Invite not found.'; end if;
  if i.status <> 'pending' then raise exception 'This invite is no longer active.'; end if;
  select * into p from parties where id = i.party_id;
  if p_accept then
    if p_role is not null and not exists (select 1 from games where id = p.game_id and p_role = any(roles)) then raise exception 'Invalid role.'; end if;
    perform _add_member(p.id, me, p_role);  -- raises if full or closed; also marks invite cancelled
    update party_invites set status = 'accepted', responded_at = now() where id = p_invite;
    perform _notify(p.leader_id, 'party_invite_accepted', me, p.id, null, jsonb_build_object('party_title', p.title));
  else
    update party_invites set status = 'declined', responded_at = now() where id = p_invite;
  end if;
end $$;

create or replace function public.cancel_party_invite(p_invite uuid) returns void
language plpgsql security definer set search_path = public as $$
declare me uuid := _require_user();
begin
  update party_invites i set status = 'cancelled', responded_at = now()
  where i.id = p_invite and i.status = 'pending'
    and (i.inviter_id = me or exists (select 1 from parties p where p.id = i.party_id and p.leader_id = me));
  if not found then raise exception 'Invite not found.'; end if;
end $$;

create or replace function public.leave_party(p_party uuid) returns void
language plpgsql security definer set search_path = public as $$
declare me uuid := _require_user(); p parties; heir uuid;
begin
  select * into p from parties where id = p_party for update;
  if not found or not exists (select 1 from party_members where party_id = p_party and user_id = me) then
    raise exception 'You are not in this party.';
  end if;
  delete from party_members where party_id = p_party and user_id = me;
  if p.leader_id = me then
    select user_id into heir from party_members where party_id = p_party order by joined_at limit 1;
    if heir is null then
      update parties set status = 'closed', closed_at = now() where id = p_party;
      update party_join_requests set status = 'cancelled', responded_at = now() where party_id = p_party and status = 'pending';
      update party_invites set status = 'cancelled', responded_at = now() where party_id = p_party and status = 'pending';
    else
      update parties set leader_id = heir where id = p_party;
      perform _notify(heir, 'party_leadership', me, p_party, null, jsonb_build_object('party_title', p.title));
    end if;
  end if;
end $$;

create or replace function public.remove_party_member(p_party uuid, p_user uuid) returns void
language plpgsql security definer set search_path = public as $$
declare me uuid := _require_user(); p parties;
begin
  select * into p from parties where id = p_party for update;
  if not found or p.leader_id <> me then raise exception 'Only the party leader can remove members.' using errcode = '42501'; end if;
  if p_user = me then raise exception 'Use Leave party instead.'; end if;
  delete from party_members where party_id = p_party and user_id = p_user;
  if not found then raise exception 'That player is not in this party.'; end if;
  perform _notify(p_user, 'party_removed', me, p_party, null, jsonb_build_object('party_title', p.title));
end $$;

create or replace function public.transfer_party_leadership(p_party uuid, p_user uuid) returns void
language plpgsql security definer set search_path = public as $$
declare me uuid := _require_user(); p parties;
begin
  select * into p from parties where id = p_party for update;
  if not found or p.leader_id <> me then raise exception 'Only the party leader can transfer leadership.' using errcode = '42501'; end if;
  if p_user = me then raise exception 'You are already the leader.'; end if;
  if not exists (select 1 from party_members where party_id = p_party and user_id = p_user) then raise exception 'That player is not in this party.'; end if;
  update parties set leader_id = p_user where id = p_party;
  perform _notify(p_user, 'party_leadership', me, p_party, null, jsonb_build_object('party_title', p.title));
end $$;

create or replace function public.close_party(p_party uuid) returns void
language plpgsql security definer set search_path = public as $$
declare me uuid := _require_user(); p parties; m record;
begin
  select * into p from parties where id = p_party for update;
  if not found or (p.leader_id <> me and not is_moderator(me)) then raise exception 'Only the party leader can close this party.' using errcode = '42501'; end if;
  if p.status = 'closed' then return; end if;
  update parties set status = 'closed', closed_at = now() where id = p_party;
  update party_join_requests set status = 'cancelled', responded_at = now() where party_id = p_party and status = 'pending';
  update party_invites set status = 'cancelled', responded_at = now() where party_id = p_party and status = 'pending';
  for m in select user_id from party_members where party_id = p_party and user_id <> me loop
    perform _notify(m.user_id, 'party_closed', me, p_party, null, jsonb_build_object('party_title', p.title));
  end loop;
end $$;

-- =============================================================================
-- FRIENDS, BLOCKS, MUTES
-- =============================================================================
create or replace function public.send_friend_request(p_user uuid) returns text
language plpgsql security definer set search_path = public as $$
declare me uuid := _require_active(); t profiles; f friendships;
begin
  if p_user = me then raise exception 'You can''t add yourself.'; end if;
  select * into t from profiles where id = p_user;
  if not found or t.onboarded_at is null or t.is_banned or _blocked(me, p_user) then raise exception 'You can''t add this player.'; end if;
  select * into f from friendships where least(requester_id, addressee_id) = least(me, p_user) and greatest(requester_id, addressee_id) = greatest(me, p_user);
  if found then
    if f.status = 'accepted' then return 'friends'; end if;
    if f.requester_id = me then return 'outgoing'; end if;
    update friendships set status = 'accepted', responded_at = now() where id = f.id;   -- they already asked us
    perform _notify(p_user, 'friend_accepted', me);
    return 'friends';
  end if;
  if t.allow_friend_requests = 'nobody' then raise exception '% isn''t accepting friend requests.', t.username; end if;
  perform _rate_limit('friend_request', 20, interval '1 hour', 'friend requests');
  insert into friendships (requester_id, addressee_id) values (me, p_user);
  perform _notify(p_user, 'friend_request', me);
  return 'outgoing';
end $$;

create or replace function public.respond_friend_request(p_user uuid, p_accept boolean) returns void
language plpgsql security definer set search_path = public as $$
declare me uuid := _require_user(); f friendships;
begin
  select * into f from friendships where requester_id = p_user and addressee_id = me and status = 'pending' for update;
  if not found then raise exception 'Friend request not found.'; end if;
  if p_accept then
    perform _require_active();
    update friendships set status = 'accepted', responded_at = now() where id = f.id;
    perform _notify(p_user, 'friend_accepted', me);
  else
    delete from friendships where id = f.id;
  end if;
  update notifications set read_at = now() where user_id = me and type = 'friend_request' and actor_id = p_user and read_at is null;
end $$;

-- Cancels an outgoing request or removes an existing friend
create or replace function public.remove_friend(p_user uuid) returns void
language plpgsql security definer set search_path = public as $$
declare me uuid := _require_user();
begin
  delete from friendships where least(requester_id, addressee_id) = least(me, p_user) and greatest(requester_id, addressee_id) = greatest(me, p_user)
    and (status = 'accepted' or requester_id = me);
  if not found then raise exception 'Nothing to remove.'; end if;
end $$;

create or replace function public.list_friends() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare me uuid := _require_user();
begin
  return jsonb_build_object(
    'friends', coalesce((select jsonb_agg(_card(o) || jsonb_build_object('since', f.responded_at,
                 'games', (select coalesce(jsonb_agg(g.game_id), '[]'::jsonb) from public_game_profiles g where g.user_id = o))
                 order by (_card(o) ->> 'status') = 'offline', _card(o) ->> 'username')
               from friendships f, lateral (select case when f.requester_id = me then f.addressee_id else f.requester_id end o) x
               where f.status = 'accepted' and me in (f.requester_id, f.addressee_id) and _card(o) is not null), '[]'::jsonb),
    'incoming', coalesce((select jsonb_agg(_card(f.requester_id) || jsonb_build_object('requested_at', f.created_at) order by f.created_at desc)
               from friendships f where f.addressee_id = me and f.status = 'pending' and _card(f.requester_id) is not null), '[]'::jsonb),
    'outgoing', coalesce((select jsonb_agg(_card(f.addressee_id) || jsonb_build_object('requested_at', f.created_at) order by f.created_at desc)
               from friendships f where f.requester_id = me and f.status = 'pending' and _card(f.addressee_id) is not null), '[]'::jsonb));
end $$;

create or replace function public.block_user(p_user uuid) returns void
language plpgsql security definer set search_path = public as $$
declare me uuid := _require_user();
begin
  if p_user = me then raise exception 'You can''t block yourself.'; end if;
  if not exists (select 1 from profiles where id = p_user) then raise exception 'Player not found.'; end if;
  insert into blocks (blocker_id, blocked_id) values (me, p_user) on conflict do nothing;
  delete from friendships where least(requester_id, addressee_id) = least(me, p_user) and greatest(requester_id, addressee_id) = greatest(me, p_user);
  update party_invites set status = 'cancelled', responded_at = now()
    where status = 'pending' and ((inviter_id = me and invitee_id = p_user) or (inviter_id = p_user and invitee_id = me));
  update party_join_requests r set status = 'cancelled', responded_at = now()
    where r.status = 'pending' and r.user_id = p_user and exists (select 1 from parties p where p.id = r.party_id and p.leader_id = me);
  delete from notifications where user_id = me and actor_id = p_user and read_at is null;
end $$;

create or replace function public.unblock_user(p_user uuid) returns void
language sql security definer set search_path = public as $$
  delete from blocks where blocker_id = auth.uid() and blocked_id = p_user;
$$;

create or replace function public.mute_user(p_user uuid) returns void
language plpgsql security definer set search_path = public as $$
declare me uuid := _require_user();
begin
  if p_user = me then raise exception 'You can''t mute yourself.'; end if;
  insert into mutes (muter_id, muted_id) values (me, p_user) on conflict do nothing;
end $$;

create or replace function public.unmute_user(p_user uuid) returns void
language sql security definer set search_path = public as $$
  delete from mutes where muter_id = auth.uid() and muted_id = p_user;
$$;

create or replace function public.list_blocked_and_muted() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare me uuid := _require_user();
begin
  return jsonb_build_object(
    'blocked', coalesce((select jsonb_agg(jsonb_build_object('id', b.blocked_id, 'username', p.username, 'avatar_url', p.avatar_url, 'since', b.created_at) order by b.created_at desc)
                from blocks b join profiles p on p.id = b.blocked_id where b.blocker_id = me), '[]'::jsonb),
    'muted', coalesce((select jsonb_agg(jsonb_build_object('id', m.muted_id, 'username', p.username, 'avatar_url', p.avatar_url, 'since', m.created_at) order by m.created_at desc)
                from mutes m join profiles p on p.id = m.muted_id where m.muter_id = me), '[]'::jsonb));
end $$;

-- =============================================================================
-- MESSAGING
-- =============================================================================
create or replace function public.get_or_create_direct_conversation(p_user uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare me uuid := _require_active(); t profiles; k text; cid uuid;
begin
  if p_user = me then raise exception 'You can''t message yourself.'; end if;
  select * into t from profiles where id = p_user;
  if not found or t.onboarded_at is null or t.is_banned or _blocked(me, p_user) then raise exception 'You can''t message this player.'; end if;
  k := least(me, p_user)::text || ':' || greatest(me, p_user)::text;
  select id into cid from conversations where direct_key = k;
  if cid is null then
    if t.allow_messages = 'nobody' or (t.allow_messages = 'friends' and not _are_friends(me, p_user)) then
      raise exception '% only accepts messages from %.', t.username, case when t.allow_messages = 'friends' then 'friends' else 'nobody' end;
    end if;
    perform _rate_limit('new_conversation', 20, interval '1 hour', 'new conversations');
    insert into conversations (kind, direct_key) values ('direct', k) on conflict (direct_key) do nothing returning id into cid;
    if cid is null then select id into cid from conversations where direct_key = k; end if;
    insert into conversation_members (conversation_id, user_id) values (cid, me), (cid, p_user) on conflict do nothing;
  end if;
  return cid;
end $$;

drop function if exists public.send_message(uuid, text);

-- Role of a user inside a conversation: owner | admin | member (null = no access).
-- Channels use the community role, parties map the leader to owner, groups use conversations.owner_id.
create or replace function public._conv_role(p_conv uuid, p_user uuid) returns text
language sql stable security definer set search_path = public as $$
  select case
    when not exists (select 1 from conversation_members m where m.conversation_id = c.id and m.user_id = p_user) then null
    when c.kind = 'channel' then (select cm.role from channels ch join community_members cm on cm.community_id = ch.community_id and cm.user_id = p_user where ch.id = c.channel_id)
    when c.kind = 'party' then case when exists (select 1 from parties p where p.id = c.party_id and p.leader_id = p_user) then 'owner' else 'member' end
    when c.kind = 'group' then case when c.owner_id = p_user then 'owner' else 'member' end
    else 'member' end
  from conversations c where c.id = p_conv
$$;

-- Why p_user can't post in conversation c right now (null = allowed).
create or replace function public._post_block_reason(p_conv uuid, p_user uuid) returns text
language plpgsql stable security definer set search_path = public as $$
declare c conversations; other profiles; ch channels; r text;
begin
  select * into c from conversations where id = p_conv;
  r := _conv_role(p_conv, p_user);
  if r is null then return 'You are not a member of this conversation.'; end if;
  if c.kind = 'direct' then
    select p.* into other from conversation_members cm join profiles p on p.id = cm.user_id where cm.conversation_id = c.id and cm.user_id <> p_user;
    if other.id is null or _blocked(p_user, other.id) or other.is_banned then return 'You can''t message this player.'; end if;
    if other.allow_messages = 'nobody' or (other.allow_messages = 'friends' and not _are_friends(p_user, other.id)) then
      return other.username || ' isn''t accepting messages from you right now.';
    end if;
  elsif c.kind = 'channel' then
    select * into ch from channels where id = c.channel_id;
    if ch.kind = 'announcement' and r not in ('owner','admin') then return 'Only admins can post in announcement channels.'; end if;
  end if;
  return null;
end $$;

create or replace function public._message_json(m messages, p_me uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'id', m.id, 'conversation_id', m.conversation_id, 'sender_id', m.sender_id, 'created_at', m.created_at,
    'sender', (select jsonb_build_object('id', p.id, 'username', p.username, 'avatar_url', p.avatar_url, 'is_demo', p.is_demo) from profiles p where p.id = m.sender_id),
    'body', case when m.removed_at is not null or m.deleted_at is not null then null else m.body end,
    'removed', m.removed_at is not null, 'deleted', m.deleted_at is not null, 'edited_at', m.edited_at,
    'pinned', m.pinned_at is not null, 'mentions_me', p_me = any(m.mentions),
    'sender_muted', m.sender_id is not null and m.sender_id <> p_me and (_mutes(p_me, m.sender_id) or _blocked(p_me, m.sender_id)),
    'reply', case when m.reply_to is not null then coalesce((select jsonb_build_object('id', r.id, 'sender_id', r.sender_id,
                 'sender_name', (select username from profiles where id = r.sender_id),
                 'body', case when r.deleted_at is null and r.removed_at is null then left(r.body, 140) end)
               from messages r where r.id = m.reply_to), jsonb_build_object('id', m.reply_to, 'missing', true)) end,
    'reactions', coalesce((select jsonb_agg(jsonb_build_object('emoji', x.emoji, 'count', x.n, 'me', x.mine) order by x.first_at)
                 from (select emoji, count(*) n, bool_or(user_id = p_me) mine, min(created_at) first_at
                       from message_reactions where message_id = m.id group by emoji) x), '[]'::jsonb))
$$;

create or replace function public.send_message(p_conversation uuid, p_body text, p_reply_to bigint default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare me uuid := _require_active(); c conversations; v_body text := btrim(coalesce(p_body, '')); msg messages; m record;
  reason text; v_mentions uuid[]; reply_author uuid; ctx jsonb; u uuid;
begin
  select * into c from conversations where id = p_conversation;
  if not found or not exists (select 1 from conversation_members where conversation_id = p_conversation and user_id = me) then
    raise exception 'Conversation not found.' using errcode = '42501';
  end if;
  if char_length(v_body) = 0 then raise exception 'Message is empty.'; end if;
  if char_length(v_body) > 2000 then raise exception 'Messages can be up to 2000 characters.'; end if;
  reason := _post_block_reason(c.id, me);
  if reason is not null then raise exception '%', reason; end if;
  if p_reply_to is not null then
    select sender_id into reply_author from messages where id = p_reply_to and conversation_id = c.id and deleted_at is null and removed_at is null;
    if not found then raise exception 'You can''t reply to that message.'; end if;
  end if;
  -- spam protection
  perform _rate_limit('message', 8, interval '10 seconds', 'messages');
  perform _rate_limit('message_5m', 80, interval '5 minutes', 'messages');
  if (select count(*) from messages m2 where m2.sender_id = me and m2.conversation_id = c.id and m2.body = v_body
      and m2.created_at > now() - interval '1 minute') >= 2 then
    raise exception 'Please don''t send the same message repeatedly.';
  end if;
  v_mentions := coalesce(array(select distinct p.id from regexp_matches(v_body, '@([A-Za-z0-9_]{3,20})', 'g') r
                  join profiles p on lower(p.username) = lower(r[1])
                  join conversation_members cm on cm.conversation_id = c.id and cm.user_id = p.id
                  where p.id <> me), '{}');
  insert into messages (conversation_id, sender_id, body, reply_to, mentions) values (c.id, me, v_body, p_reply_to, v_mentions) returning * into msg;
  update conversations set last_message_at = msg.created_at where id = c.id;
  update conversation_members set last_read_at = msg.created_at where conversation_id = c.id and user_id = me;
  delete from conversation_typing where conversation_id = c.id and user_id = me;
  update profiles set stat_messages_sent = stat_messages_sent + 1 where id = me;

  ctx := jsonb_build_object('preview', left(v_body, 120), 'kind', c.kind, 'group_name', c.name);
  if c.kind = 'party' then ctx := ctx || jsonb_build_object('party_title', (select title from parties where id = c.party_id)); end if;
  if c.kind = 'channel' then
    ctx := ctx || (select jsonb_build_object('channel_name', ch.name, 'channel_id', ch.id, 'community_id', co.id, 'community_name', co.name)
                   from channels ch join communities co on co.id = ch.community_id where ch.id = c.channel_id);
  end if;
  if c.kind <> 'channel' then
    for m in select user_id from conversation_members where conversation_id = c.id and user_id <> me and not muted
             and not (user_id = any(v_mentions)) and user_id is distinct from reply_author loop
      perform _notify(m.user_id, 'message', me, c.party_id, c.id, ctx);
    end loop;
  end if;
  foreach u in array v_mentions loop
    perform _notify(u, 'mention', me, c.party_id, c.id, ctx);
  end loop;
  if reply_author is not null and reply_author <> me and not (reply_author = any(v_mentions))
     and exists (select 1 from conversation_members where conversation_id = c.id and user_id = reply_author) then
    perform _notify(reply_author, 'mention', me, c.party_id, c.id, ctx || jsonb_build_object('reply', true));
  end if;
  return _message_json(msg, me);
end $$;

create or replace function public.edit_message(p_message bigint, p_body text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare me uuid := _require_active(); msg messages; v_body text := btrim(coalesce(p_body, ''));
begin
  select * into msg from messages where id = p_message for update;
  if not found or msg.sender_id is distinct from me then raise exception 'You can only edit your own messages.' using errcode = '42501'; end if;
  if msg.deleted_at is not null or msg.removed_at is not null then raise exception 'This message was deleted.'; end if;
  if not exists (select 1 from conversation_members where conversation_id = msg.conversation_id and user_id = me) then raise exception 'Conversation not found.'; end if;
  if char_length(v_body) = 0 then raise exception 'Message is empty.'; end if;
  if char_length(v_body) > 2000 then raise exception 'Messages can be up to 2000 characters.'; end if;
  perform _rate_limit('edit', 20, interval '1 minute', 'edits');
  update messages set body = v_body, edited_at = now() where id = p_message returning * into msg;
  return _message_json(msg, me);
end $$;

create or replace function public.delete_message(p_message bigint) returns void
language plpgsql security definer set search_path = public as $$
declare me uuid := _require_user(); msg messages; r text;
begin
  select * into msg from messages where id = p_message for update;
  if not found then raise exception 'Message not found.'; end if;
  r := _conv_role(msg.conversation_id, me);
  if msg.sender_id is distinct from me and not is_moderator(me)
     and not (r in ('owner','admin') and (select kind from conversations where id = msg.conversation_id) = 'channel') then
    raise exception 'You can only delete your own messages.' using errcode = '42501';
  end if;
  if r is null and not is_moderator(me) then raise exception 'Conversation not found.'; end if;
  update messages set deleted_at = now(), body = '[deleted]', pinned_at = null, pinned_by = null where id = p_message and deleted_at is null;
  delete from message_reactions where message_id = p_message;
end $$;

create or replace function public.toggle_reaction(p_message bigint, p_emoji text) returns boolean
language plpgsql security definer set search_path = public as $$
declare me uuid := _require_active(); msg messages;
begin
  select * into msg from messages where id = p_message;
  if not found or not exists (select 1 from conversation_members where conversation_id = msg.conversation_id and user_id = me) then
    raise exception 'Message not found.';
  end if;
  if msg.deleted_at is not null or msg.removed_at is not null then raise exception 'This message was deleted.'; end if;
  if p_emoji not in ('👍','👎','❤️','😂','😮','😢','🔥','🎉','👀','💯','🙏','🤝') then raise exception 'That reaction isn''t available.'; end if;
  delete from message_reactions where message_id = p_message and user_id = me and emoji = p_emoji;
  if found then return false; end if;
  perform _rate_limit('reaction', 30, interval '20 seconds', 'reactions');
  if (select count(distinct emoji) from message_reactions where message_id = p_message) >= 12 then raise exception 'Too many reactions on this message.'; end if;
  insert into message_reactions (message_id, user_id, emoji) values (p_message, me, p_emoji);
  return true;
end $$;

create or replace function public.pin_message(p_message bigint, p_pinned boolean) returns void
language plpgsql security definer set search_path = public as $$
declare me uuid := _require_active(); msg messages; c conversations; r text;
begin
  select * into msg from messages where id = p_message for update;
  if not found then raise exception 'Message not found.'; end if;
  select * into c from conversations where id = msg.conversation_id;
  r := _conv_role(c.id, me);
  if r is null then raise exception 'Message not found.'; end if;
  if (c.kind = 'channel' and r not in ('owner','admin')) or (c.kind = 'party' and r <> 'owner') then
    raise exception 'You don''t have permission to pin messages here.' using errcode = '42501';
  end if;
  if msg.deleted_at is not null or msg.removed_at is not null then raise exception 'This message was deleted.'; end if;
  if p_pinned and msg.pinned_at is null and (select count(*) from messages where conversation_id = c.id and pinned_at is not null) >= 50 then
    raise exception 'This conversation already has 50 pinned messages.';
  end if;
  update messages set pinned_at = case when p_pinned then coalesce(pinned_at, now()) end, pinned_by = case when p_pinned then me end where id = p_message;
end $$;

create or replace function public.list_pins(p_conversation uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare me uuid := _require_user();
begin
  if not exists (select 1 from conversation_members where conversation_id = p_conversation and user_id = me) then raise exception 'Conversation not found.'; end if;
  return coalesce((select jsonb_agg(_message_json(m, me) order by m.pinned_at desc) from messages m
                   where m.conversation_id = p_conversation and m.pinned_at is not null and m.deleted_at is null and m.removed_at is null), '[]'::jsonb);
end $$;

create or replace function public.search_messages(p_conversation uuid, p_query text, p_limit int default 25) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare me uuid := _require_user(); pat text;
begin
  if not exists (select 1 from conversation_members where conversation_id = p_conversation and user_id = me) then raise exception 'Conversation not found.'; end if;
  if char_length(btrim(coalesce(p_query, ''))) < 2 then return '[]'::jsonb; end if;
  pat := '%' || replace(replace(replace(btrim(p_query), '\', '\\'), '%', '\%'), '_', '\_') || '%';
  return coalesce((select jsonb_agg(x.j order by x.id desc) from (
    select m.id, _message_json(m, me) j from messages m
    where m.conversation_id = p_conversation and m.deleted_at is null and m.removed_at is null and m.body ilike pat
    order by m.id desc limit least(greatest(coalesce(p_limit, 25), 1), 50)) x), '[]'::jsonb);
end $$;

create or replace function public.get_messages(p_conversation uuid, p_before bigint default null, p_limit int default 50) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare me uuid := _require_user();
begin
  if not exists (select 1 from conversation_members where conversation_id = p_conversation and user_id = me) then
    raise exception 'Conversation not found.' using errcode = '42501';
  end if;
  return coalesce((select jsonb_agg(x.j order by x.id) from (
    select m.id, _message_json(m, me) j
    from messages m where m.conversation_id = p_conversation and (p_before is null or m.id < p_before)
    order by m.id desc limit least(greatest(coalesce(p_limit, 50), 1), 100)) x), '[]'::jsonb);
end $$;

create or replace function public.set_typing(p_conversation uuid) returns void
language plpgsql security definer set search_path = public as $$
declare me uuid := _require_user();
begin
  if not exists (select 1 from conversation_members where conversation_id = p_conversation and user_id = me) then return; end if;
  insert into conversation_typing (conversation_id, user_id, updated_at) values (p_conversation, me, now())
  on conflict (conversation_id, user_id) do update set updated_at = now();
end $$;

create or replace function public.get_typing(p_conversation uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare me uuid := _require_user();
begin
  if not exists (select 1 from conversation_members where conversation_id = p_conversation and user_id = me) then return '[]'::jsonb; end if;
  return coalesce((select jsonb_agg(p.username order by t.updated_at) from conversation_typing t join profiles p on p.id = t.user_id
                   where t.conversation_id = p_conversation and t.user_id <> me and t.updated_at > now() - interval '6 seconds'
                     and not _mutes(me, t.user_id) and not _blocked(me, t.user_id)), '[]'::jsonb);
end $$;

create or replace function public.set_conversation_muted(p_conversation uuid, p_muted boolean) returns void
language plpgsql security definer set search_path = public as $$
declare me uuid := _require_user();
begin
  update conversation_members set muted = coalesce(p_muted, false) where conversation_id = p_conversation and user_id = me;
  if not found then raise exception 'Conversation not found.'; end if;
end $$;

create or replace function public.get_conversation(p_conversation uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare me uuid := _require_user(); c conversations; other uuid; r text; reason text; cm conversation_members;
begin
  select * into c from conversations where id = p_conversation;
  select * into cm from conversation_members where conversation_id = p_conversation and user_id = me;
  if c.id is null or cm.user_id is null then return null; end if;
  r := _conv_role(c.id, me);
  reason := _post_block_reason(c.id, me);
  select user_id into other from conversation_members where conversation_id = c.id and user_id <> me and c.kind = 'direct' limit 1;
  return jsonb_build_object('id', c.id, 'kind', c.kind, 'party_id', c.party_id, 'name', c.name, 'owner_id', c.owner_id,
    'my_role', r, 'muted', cm.muted, 'last_read_at', cm.last_read_at,
    'can_send', reason is null, 'send_block_reason', reason,
    'can_pin', c.kind in ('direct','group') or (c.kind = 'channel' and r in ('owner','admin')) or (c.kind = 'party' and r = 'owner'),
    'can_moderate', (c.kind = 'channel' and r in ('owner','admin')) or is_moderator(me),
    'pin_count', (select count(*) from messages where conversation_id = c.id and pinned_at is not null and deleted_at is null),
    'party', case when c.kind = 'party' then (select jsonb_build_object('id', p.id, 'title', p.title, 'game_id', p.game_id, 'status', _party_status(p))
                                              from parties p where p.id = c.party_id) end,
    'channel', case when c.kind = 'channel' then (select jsonb_build_object('id', ch.id, 'name', ch.name, 'topic', ch.topic, 'kind', ch.kind,
                    'community', jsonb_build_object('id', co.id, 'name', co.name, 'icon_color', co.icon_color))
                    from channels ch join communities co on co.id = ch.community_id where ch.id = c.channel_id) end,
    'other', case when other is not null then coalesce(_card(other), jsonb_build_object('id', other, 'username', 'Unavailable player', 'unavailable', true)) end,
    'blocked', other is not null and _blocked(me, other),
    'muted_user', other is not null and _mutes(me, other),
    'is_demo_partner', other is not null and coalesce((select is_demo from profiles where id = other), false),
    'members', case when c.kind = 'channel' then '[]'::jsonb else coalesce((select jsonb_agg(
                 coalesce(_card(m.user_id), jsonb_build_object('id', m.user_id, 'username', 'Unavailable player', 'unavailable', true))
                 || jsonb_build_object('is_owner', m.user_id = c.owner_id) order by m.joined_at)
                 from conversation_members m where m.conversation_id = c.id), '[]'::jsonb) end);
end $$;

create or replace function public.list_conversations() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare me uuid := _require_user();
begin
  return coalesce((select jsonb_agg(x.j order by x.sort_at desc nulls last) from (
    select coalesce(c.last_message_at, c.created_at) sort_at, jsonb_build_object(
      'id', c.id, 'kind', c.kind, 'name', c.name, 'last_message_at', c.last_message_at, 'muted', cm.muted,
      'party', case when c.kind = 'party' then (select jsonb_build_object('id', p.id, 'title', p.title, 'game_id', p.game_id, 'status', _party_status(p))
                                                from parties p where p.id = c.party_id) end,
      'other', case when c.kind = 'direct' then (select coalesce(_card(o.user_id), jsonb_build_object('id', o.user_id, 'username', 'Unavailable player', 'unavailable', true))
                                                 from conversation_members o where o.conversation_id = c.id and o.user_id <> me limit 1) end,
      'members', case when c.kind = 'group' then coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'username', p.username, 'avatar_url', p.avatar_url) order by o.joined_at)
                   from conversation_members o join profiles p on p.id = o.user_id where o.conversation_id = c.id and o.user_id <> me), '[]'::jsonb) end,
      'last_message', (select jsonb_build_object('body', case when m.removed_at is null and m.deleted_at is null then left(m.body, 140) end, 'sender_id', m.sender_id,
                              'created_at', m.created_at, 'removed', m.removed_at is not null or m.deleted_at is not null)
                       from messages m where m.conversation_id = c.id order by m.id desc limit 1),
      'unread', (select count(*) from messages m where m.conversation_id = c.id and m.created_at > cm.last_read_at
                 and m.sender_id is distinct from me and (m.sender_id is null or not _mutes(me, m.sender_id)))) j
    from conversation_members cm join conversations c on c.id = cm.conversation_id
    where cm.user_id = me and (c.kind in ('party','group') or (c.kind = 'direct' and c.last_message_at is not null))) x), '[]'::jsonb);
end $$;

create or replace function public.mark_conversation_read(p_conversation uuid) returns void
language plpgsql security definer set search_path = public as $$
declare me uuid := _require_user();
begin
  update conversation_members set last_read_at = now() where conversation_id = p_conversation and user_id = me;
  update notifications set read_at = now() where user_id = me and type in ('message','mention') and conversation_id = p_conversation and read_at is null;
end $$;

create or replace function public.get_counts() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare me uuid := _require_user();
begin
  return jsonb_build_object(
    'notifications', (select count(*) from notifications where user_id = me and read_at is null),
    'messages', (select count(*) from conversation_members cm join conversations c on c.id = cm.conversation_id
                 join messages m on m.conversation_id = cm.conversation_id
                 where cm.user_id = me and c.kind <> 'channel' and not cm.muted and m.created_at > cm.last_read_at
                   and m.sender_id is distinct from me and (m.sender_id is null or not _mutes(me, m.sender_id))),
    'mentions', (select count(*) from notifications where user_id = me and type = 'mention' and read_at is null),
    'friend_requests', (select count(*) from friendships where addressee_id = me and status = 'pending'),
    'party_invites', (select count(*) from party_invites where invitee_id = me and status = 'pending'),
    'open_reports', case when is_moderator(me) then (select count(*) from reports where status in ('open','in_review')) end);
end $$;

-- =============================================================================
-- GROUP DMs
-- =============================================================================
create or replace function public.create_group_dm(p_users uuid[], p_name text default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare me uuid := _require_active(); users uuid[]; u uuid; cid uuid; t profiles;
begin
  users := coalesce(array(select distinct x from unnest(p_users) x where x is not null and x <> me), '{}');
  if cardinality(users) < 2 then raise exception 'Pick at least two friends for a group. For one person, send a direct message.'; end if;
  if cardinality(users) > 9 then raise exception 'Group DMs can have up to 10 people.'; end if;
  foreach u in array users loop
    select * into t from profiles where id = u;
    if not found or t.onboarded_at is null or t.is_banned or _blocked(me, u) or not _are_friends(me, u) then
      raise exception 'You can only add friends to a group DM.';
    end if;
  end loop;
  perform _rate_limit('group_dm', 10, interval '1 hour', 'new groups');
  insert into conversations (kind, name, owner_id) values ('group', nullif(btrim(coalesce(p_name, '')), ''), me) returning id into cid;
  insert into conversation_members (conversation_id, user_id) select cid, x from unnest(users || me) x;
  foreach u in array users loop
    perform _notify(u, 'group_added', me, null, cid, jsonb_build_object('group_name', nullif(btrim(coalesce(p_name, '')), '')));
  end loop;
  return cid;
end $$;

create or replace function public.rename_group_dm(p_conversation uuid, p_name text) returns void
language plpgsql security definer set search_path = public as $$
declare me uuid := _require_active();
begin
  if char_length(btrim(coalesce(p_name, ''))) > 40 then raise exception 'Group names can be up to 40 characters.'; end if;
  update conversations c set name = nullif(btrim(coalesce(p_name, '')), '')
  where c.id = p_conversation and c.kind = 'group' and exists (select 1 from conversation_members m where m.conversation_id = c.id and m.user_id = me);
  if not found then raise exception 'Group not found.'; end if;
end $$;

create or replace function public.add_group_member(p_conversation uuid, p_user uuid) returns void
language plpgsql security definer set search_path = public as $$
declare me uuid := _require_active(); c conversations; t profiles;
begin
  select * into c from conversations where id = p_conversation and kind = 'group';
  if not found or not exists (select 1 from conversation_members where conversation_id = c.id and user_id = me) then raise exception 'Group not found.'; end if;
  select * into t from profiles where id = p_user;
  if not found or t.onboarded_at is null or t.is_banned or _blocked(me, p_user) or not _are_friends(me, p_user) then
    raise exception 'You can only add your friends.';
  end if;
  if exists (select 1 from conversation_members where conversation_id = c.id and user_id = p_user) then raise exception '% is already in this group.', t.username; end if;
  if (select count(*) from conversation_members where conversation_id = c.id) >= 10 then raise exception 'Group DMs can have up to 10 people.'; end if;
  insert into conversation_members (conversation_id, user_id) values (c.id, p_user);
  perform _notify(p_user, 'group_added', me, null, c.id, jsonb_build_object('group_name', c.name));
end $$;

create or replace function public.remove_group_member(p_conversation uuid, p_user uuid) returns void
language plpgsql security definer set search_path = public as $$
declare me uuid := _require_user(); c conversations;
begin
  select * into c from conversations where id = p_conversation and kind = 'group';
  if not found or c.owner_id is distinct from me then raise exception 'Only the group owner can remove people.' using errcode = '42501'; end if;
  if p_user = me then raise exception 'Use Leave group instead.'; end if;
  delete from conversation_members where conversation_id = c.id and user_id = p_user;
  if not found then raise exception 'That person is not in this group.'; end if;
end $$;

create or replace function public.leave_group_dm(p_conversation uuid) returns void
language plpgsql security definer set search_path = public as $$
declare me uuid := _require_user(); c conversations; heir uuid;
begin
  select * into c from conversations where id = p_conversation and kind = 'group' for update;
  if not found then raise exception 'Group not found.'; end if;
  delete from conversation_members where conversation_id = c.id and user_id = me;
  if not found then raise exception 'You are not in this group.'; end if;
  select user_id into heir from conversation_members where conversation_id = c.id order by joined_at limit 1;
  if heir is null then delete from conversations where id = c.id;
  elsif c.owner_id = me then update conversations set owner_id = heir where id = c.id; end if;
end $$;

-- =============================================================================
-- COMMUNITIES
-- =============================================================================
-- PartyUp moderators act as admins of the official game communities.
create or replace function public._community_role(p_community uuid, p_user uuid) returns text
language sql stable security definer set search_path = public as $$
  select coalesce(
    (select case when m.role = 'member' and c.is_official and public.is_moderator(p_user) then 'admin' else m.role end
       from community_members m join communities c on c.id = m.community_id
      where m.community_id = p_community and m.user_id = p_user),
    (select 'admin' from communities c where c.id = p_community and c.is_official and public.is_moderator(p_user)))
$$;

create or replace function public.is_community_member(p_community uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from community_members where community_id = p_community and user_id = auth.uid())
$$;

create or replace function public._role_rank(r text) returns int language sql immutable as $$
  select case r when 'owner' then 3 when 'admin' then 2 when 'member' then 1 else 0 end
$$;

create or replace function public._require_community_admin(p_community uuid) returns uuid
language plpgsql stable security definer set search_path = public as $$
declare me uuid := _require_active();
begin
  if coalesce(_community_role(p_community, me), '') not in ('owner','admin') then
    raise exception 'Only community admins can do that.' using errcode = '42501';
  end if;
  return me;
end $$;

-- Membership keeps channel chats and member_count in sync
create or replace function public.sync_community_membership() returns trigger
language plpgsql security definer set search_path = public as $$
declare cid uuid := coalesce(new.community_id, old.community_id);
begin
  if tg_op = 'INSERT' then
    insert into conversation_members (conversation_id, user_id, last_read_at)
    select cv.id, new.user_id, now() from channels ch join conversations cv on cv.channel_id = ch.id where ch.community_id = cid
    on conflict do nothing;
  elsif tg_op = 'DELETE' then
    delete from conversation_members cm using conversations cv, channels ch
    where cm.conversation_id = cv.id and cv.channel_id = ch.id and ch.community_id = cid and cm.user_id = old.user_id;
  end if;
  update communities set member_count = (select count(*) from community_members where community_id = cid) where id = cid;
  return null;
end $$;
drop trigger if exists trg_sync_community_membership on public.community_members;
create trigger trg_sync_community_membership after insert or delete on public.community_members
for each row execute function public.sync_community_membership();

create or replace function public.create_channel_conversation() returns trigger
language plpgsql security definer set search_path = public as $$
declare cid uuid;
begin
  insert into conversations (kind, channel_id) values ('channel', new.id) returning id into cid;
  insert into conversation_members (conversation_id, user_id, last_read_at)
  select cid, m.user_id, now() from community_members m where m.community_id = new.community_id;
  return null;
end $$;
drop trigger if exists trg_channel_conversation on public.channels;
create trigger trg_channel_conversation after insert on public.channels
for each row execute function public.create_channel_conversation();

drop trigger if exists trg_communities_touch on public.communities;
create trigger trg_communities_touch before update on public.communities for each row execute function public.touch_updated_at();

create or replace function public._clean_channel_name(p text) returns text language sql immutable as $$
  select left(trim(both '-' from regexp_replace(regexp_replace(regexp_replace(lower(btrim(coalesce(p, ''))), '[\s_]+', '-', 'g'), '[^a-z0-9-]', '', 'g'), '-{2,}', '-', 'g')), 30)
$$;

create or replace function public.create_community(p_name text, p_description text default '', p_is_public boolean default true,
  p_game text default null, p_icon_color text default '#3d7eff') returns uuid
language plpgsql security definer set search_path = public as $$
declare me uuid := _require_active(); cid uuid;
begin
  perform _rate_limit('create_community', 5, interval '1 day', 'communities created');
  if char_length(btrim(coalesce(p_name, ''))) < 2 then raise exception 'Give your community a name (2–40 characters).'; end if;
  if p_game is not null and not exists (select 1 from games where id = p_game) then raise exception 'Unknown game.'; end if;
  insert into communities (name, description, is_public, game_id, icon_color, owner_id)
  values (btrim(p_name), coalesce(p_description, ''), coalesce(p_is_public, true), p_game, coalesce(p_icon_color, '#3d7eff'), me)
  returning id into cid;
  insert into community_members (community_id, user_id, role) values (cid, me, 'owner');
  insert into channels (community_id, name, topic, kind, position) values
    (cid, 'general', 'Talk about anything', 'text', 0),
    (cid, 'looking-for-group', 'Post when you want to play', 'text', 1),
    (cid, 'announcements', 'News from the admins', 'announcement', 2);
  return cid;
end $$;

create or replace function public.update_community(p_community uuid, p_name text default null, p_description text default null,
  p_is_public boolean default null, p_game text default null, p_icon_color text default null, p_clear_game boolean default false) returns void
language plpgsql security definer set search_path = public as $$
declare me uuid := _require_community_admin(p_community);
begin
  if p_game is not null and not exists (select 1 from games where id = p_game) then raise exception 'Unknown game.'; end if;
  update communities set
    name = coalesce(nullif(btrim(p_name), ''), name), description = coalesce(p_description, description),
    is_public = coalesce(p_is_public, is_public), icon_color = coalesce(p_icon_color, icon_color),
    game_id = case when p_clear_game then null else coalesce(p_game, game_id) end
  where id = p_community;
end $$;

create or replace function public.delete_community(p_community uuid, p_confirm_name text) returns void
language plpgsql security definer set search_path = public as $$
declare me uuid := _require_user(); co communities;
begin
  select * into co from communities where id = p_community;
  if not found or co.is_official or co.owner_id is distinct from me then raise exception 'Only the owner can delete this community.' using errcode = '42501'; end if;
  if lower(btrim(coalesce(p_confirm_name, ''))) <> lower(co.name) then raise exception 'Type the community name exactly to confirm.'; end if;
  delete from communities where id = p_community;
end $$;

create or replace function public._community_json(p_me uuid, co communities) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('id', co.id, 'name', co.name, 'description', co.description, 'icon_color', co.icon_color,
    'is_public', co.is_public, 'member_count', co.member_count, 'is_demo', co.is_demo, 'created_at', co.created_at,
    'owner_id', co.owner_id, 'my_role', _community_role(co.id, p_me), 'is_official', co.is_official,
    'game', (select jsonb_build_object('id', g.id, 'name', g.name, 'short_name', g.short_name, 'accent_color', g.accent_color) from games g where g.id = co.game_id),
    'online_count', (select count(*) from community_members m join public_profiles pp on pp.id = m.user_id where m.community_id = co.id and pp.status <> 'offline'))
$$;

create or replace function public.get_community(p_community uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare me uuid := _require_user(); co communities; is_member boolean;
begin
  select * into co from communities where id = p_community;
  if not found then return null; end if;
  is_member := exists (select 1 from community_members where community_id = co.id and user_id = me);
  if not is_member and (not co.is_public or exists (select 1 from community_bans where community_id = co.id and user_id = me)) then return null; end if;
  return _community_json(me, co) || jsonb_build_object(
    'is_member', is_member,
    'banned', exists (select 1 from community_bans where community_id = co.id and user_id = me),
    'channels', coalesce((select jsonb_agg(jsonb_build_object('id', ch.id, 'name', ch.name, 'topic', ch.topic, 'kind', ch.kind, 'position', ch.position,
         'conversation_id', cv.id,
         'unread', is_member and exists (select 1 from messages m join conversation_members cm on cm.conversation_id = m.conversation_id and cm.user_id = me
                                          where m.conversation_id = cv.id and m.created_at > cm.last_read_at and m.sender_id is distinct from me),
         'muted', coalesce((select muted from conversation_members where conversation_id = cv.id and user_id = me), false),
         'mentions', (select count(*) from notifications n where n.user_id = me and n.type = 'mention' and n.conversation_id = cv.id and n.read_at is null),
         'voice', case when ch.kind = 'voice' then _voice_people('channel:' || ch.id) end)
       order by ch.position, ch.created_at)
       from channels ch join conversations cv on cv.channel_id = ch.id where ch.community_id = co.id), '[]'::jsonb));
end $$;

create or replace function public.list_my_communities() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare me uuid := _require_user();
begin
  return coalesce((select jsonb_agg(jsonb_build_object('id', co.id, 'name', co.name, 'icon_color', co.icon_color, 'is_demo', co.is_demo, 'role', m.role,
      'is_official', co.is_official, 'game_id', co.game_id,
      'unread', exists (select 1 from channels ch join conversations cv on cv.channel_id = ch.id
                        join conversation_members cm on cm.conversation_id = cv.id and cm.user_id = me and not cm.muted
                        join messages msg on msg.conversation_id = cv.id
                        where ch.community_id = co.id and msg.created_at > cm.last_read_at and msg.sender_id is distinct from me),
      'mentions', (select count(*) from notifications n join conversations cv on cv.id = n.conversation_id join channels ch on ch.id = cv.channel_id
                   where n.user_id = me and n.type = 'mention' and n.read_at is null and ch.community_id = co.id))
      order by m.joined_at)
    from community_members m join communities co on co.id = m.community_id where m.user_id = me), '[]'::jsonb);
end $$;

create or replace function public.explore_communities(p_search text default null, p_game text default null, p_limit int default 24, p_offset int default 0)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare me uuid := _require_user(); v profiles; pat text; total int; result jsonb;
begin
  select * into v from profiles where id = me;
  pat := case when nullif(btrim(p_search), '') is null then null
              else '%' || replace(replace(replace(btrim(p_search), '\', '\\'), '%', '\%'), '_', '\_') || '%' end;
  select count(*) into total from communities co
  where co.is_public and (v.show_demo_players or not co.is_demo) and (p_game is null or co.game_id = p_game)
    and (pat is null or co.name ilike pat or co.description ilike pat)
    and not exists (select 1 from community_bans b where b.community_id = co.id and b.user_id = me);
  select coalesce(jsonb_agg(_community_json(me, x) order by x.is_official desc, x.member_count desc, x.created_at), '[]'::jsonb) into result from (
    select co.* from communities co
    where co.is_public and (v.show_demo_players or not co.is_demo) and (p_game is null or co.game_id = p_game)
      and (pat is null or co.name ilike pat or co.description ilike pat)
      and not exists (select 1 from community_bans b where b.community_id = co.id and b.user_id = me)
    order by co.is_official desc, co.member_count desc, co.created_at limit least(greatest(coalesce(p_limit, 24), 1), 60) offset greatest(coalesce(p_offset, 0), 0)) x;
  return jsonb_build_object('total', total, 'communities', result);
end $$;

create or replace function public.join_community(p_community uuid) returns void
language plpgsql security definer set search_path = public as $$
declare me uuid := _require_active(); co communities;
begin
  select * into co from communities where id = p_community;
  if not found or not co.is_public then raise exception 'This community is invite only.'; end if;
  if exists (select 1 from community_bans where community_id = co.id and user_id = me) then raise exception 'You are banned from this community.'; end if;
  perform _rate_limit('join_community', 20, interval '1 hour', 'joins');
  insert into community_members (community_id, user_id) values (co.id, me) on conflict do nothing;
end $$;

create or replace function public.leave_community(p_community uuid) returns void
language plpgsql security definer set search_path = public as $$
declare me uuid := _require_user();
begin
  if _community_role(p_community, me) = 'owner' then raise exception 'Transfer ownership or delete the community before leaving.'; end if;
  delete from community_members where community_id = p_community and user_id = me;
  if not found then raise exception 'You are not in this community.'; end if;
end $$;

create or replace function public.create_invite(p_community uuid, p_max_uses int default null, p_expires_hours int default 168) returns text
language plpgsql security definer set search_path = public as $$
declare me uuid := _require_active(); co communities; v_code text; r text;
begin
  select * into co from communities where id = p_community;
  r := _community_role(p_community, me);
  if not found or r is null then raise exception 'Community not found.'; end if;
  if not co.is_public and r not in ('owner','admin') then raise exception 'Only admins can create invites for private communities.' using errcode = '42501'; end if;
  if p_max_uses is not null and (p_max_uses < 1 or p_max_uses > 1000) then raise exception 'Max uses must be between 1 and 1000.'; end if;
  if p_expires_hours is not null and (p_expires_hours < 1 or p_expires_hours > 24 * 30) then raise exception 'Invites can last up to 30 days.'; end if;
  perform _rate_limit('create_invite', 20, interval '1 hour', 'invites');
  loop
    v_code := substr(translate(encode(gen_random_bytes(12), 'base64'), '+/=ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz0123'), 1, 8);
    v_code := regexp_replace(v_code, '[^a-z0-9]', 'x', 'g');
    exit when not exists (select 1 from community_invites where code = v_code);
  end loop;
  insert into community_invites (code, community_id, created_by, max_uses, expires_at)
  values (v_code, p_community, me, p_max_uses, case when p_expires_hours is null then null else now() + make_interval(hours => p_expires_hours) end);
  return v_code;
end $$;

create or replace function public.get_invite(p_code text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare me uuid := _require_user(); i community_invites; co communities;
begin
  select * into i from community_invites where code = lower(btrim(coalesce(p_code, '')));
  if not found then return jsonb_build_object('valid', false, 'reason', 'This invite is invalid or was revoked.'); end if;
  select * into co from communities where id = i.community_id;
  if i.expires_at is not null and i.expires_at < now() then return jsonb_build_object('valid', false, 'reason', 'This invite has expired.'); end if;
  if i.max_uses is not null and i.uses >= i.max_uses then return jsonb_build_object('valid', false, 'reason', 'This invite has reached its use limit.'); end if;
  if exists (select 1 from community_bans where community_id = co.id and user_id = me) then return jsonb_build_object('valid', false, 'reason', 'You are banned from this community.'); end if;
  return jsonb_build_object('valid', true, 'code', i.code, 'is_member', exists (select 1 from community_members where community_id = co.id and user_id = me),
    'inviter', (select username from profiles where id = i.created_by), 'community', _community_json(me, co));
end $$;

create or replace function public.accept_invite(p_code text) returns uuid
language plpgsql security definer set search_path = public as $$
declare me uuid := _require_active(); i community_invites; info jsonb;
begin
  info := get_invite(p_code);
  if not (info ->> 'valid')::boolean then raise exception '%', info ->> 'reason'; end if;
  select * into i from community_invites where code = lower(btrim(p_code)) for update;
  if not exists (select 1 from community_members where community_id = i.community_id and user_id = me) then
    insert into community_members (community_id, user_id) values (i.community_id, me);
    update community_invites set uses = uses + 1 where code = i.code;
  end if;
  return i.community_id;
end $$;

create or replace function public.list_invites(p_community uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare me uuid := _require_community_admin(p_community);
begin
  return coalesce((select jsonb_agg(jsonb_build_object('code', i.code, 'uses', i.uses, 'max_uses', i.max_uses, 'expires_at', i.expires_at,
     'created_at', i.created_at, 'created_by', (select username from profiles where id = i.created_by),
     'active', (i.expires_at is null or i.expires_at > now()) and (i.max_uses is null or i.uses < i.max_uses)) order by i.created_at desc)
   from community_invites i where i.community_id = p_community), '[]'::jsonb);
end $$;

create or replace function public.revoke_invite(p_code text) returns void
language plpgsql security definer set search_path = public as $$
declare me uuid := _require_user(); i community_invites;
begin
  select * into i from community_invites where code = p_code;
  if not found then raise exception 'Invite not found.'; end if;
  if i.created_by is distinct from me and coalesce(_community_role(i.community_id, me), '') not in ('owner','admin') then
    raise exception 'Only admins can revoke this invite.' using errcode = '42501';
  end if;
  delete from community_invites where code = p_code;
end $$;

create or replace function public.list_community_members(p_community uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare me uuid := _require_user(); co communities;
begin
  select * into co from communities where id = p_community;
  if not found or (not co.is_public and not exists (select 1 from community_members where community_id = co.id and user_id = me)) then
    raise exception 'Community not found.';
  end if;
  return coalesce((select jsonb_agg(_card(m.user_id) || jsonb_build_object('role', m.role, 'joined_at', m.joined_at,
            'custom_status', (select custom_status from profiles where id = m.user_id))
          order by _role_rank(m.role) desc, (_card(m.user_id) ->> 'status') = 'offline', lower(_card(m.user_id) ->> 'username'))
     from (select * from community_members where community_id = p_community limit 1000) m where _card(m.user_id) is not null), '[]'::jsonb);
end $$;

create or replace function public.set_member_role(p_community uuid, p_user uuid, p_role text) returns void
language plpgsql security definer set search_path = public as $$
declare me uuid := _require_active();
begin
  if _community_role(p_community, me) is distinct from 'owner' then raise exception 'Only the owner can change roles.' using errcode = '42501'; end if;
  if p_role not in ('admin','member') then raise exception 'Invalid role.'; end if;
  if p_user = me then raise exception 'Transfer ownership to change your own role.'; end if;
  update community_members set role = p_role where community_id = p_community and user_id = p_user;
  if not found then raise exception 'That player is not a member.'; end if;
end $$;

create or replace function public.transfer_community_ownership(p_community uuid, p_user uuid) returns void
language plpgsql security definer set search_path = public as $$
declare me uuid := _require_active();
begin
  if _community_role(p_community, me) is distinct from 'owner' then raise exception 'Only the owner can transfer ownership.' using errcode = '42501'; end if;
  if p_user = me or _community_role(p_community, p_user) is null then raise exception 'Pick another member of this community.'; end if;
  update community_members set role = 'admin' where community_id = p_community and user_id = me;
  update community_members set role = 'owner' where community_id = p_community and user_id = p_user;
  update communities set owner_id = p_user where id = p_community;
end $$;

create or replace function public.kick_community_member(p_community uuid, p_user uuid) returns void
language plpgsql security definer set search_path = public as $$
declare me uuid := _require_community_admin(p_community);
begin
  if p_user = me then raise exception 'Use Leave community instead.'; end if;
  if _role_rank(_community_role(p_community, p_user)) >= _role_rank(_community_role(p_community, me)) then
    raise exception 'You can only remove members with a lower role than yours.' using errcode = '42501';
  end if;
  delete from community_members where community_id = p_community and user_id = p_user;
end $$;

create or replace function public.ban_community_member(p_community uuid, p_user uuid, p_reason text default '') returns void
language plpgsql security definer set search_path = public as $$
declare me uuid := _require_community_admin(p_community);
begin
  if p_user = me then raise exception 'You can''t ban yourself.'; end if;
  if _role_rank(coalesce(_community_role(p_community, p_user), 'member')) >= _role_rank(_community_role(p_community, me)) then
    raise exception 'You can only ban members with a lower role than yours.' using errcode = '42501';
  end if;
  delete from community_members where community_id = p_community and user_id = p_user;
  insert into community_bans (community_id, user_id, banned_by, reason) values (p_community, p_user, me, left(coalesce(p_reason, ''), 200))
  on conflict (community_id, user_id) do update set reason = excluded.reason, banned_by = me, created_at = now();
end $$;

create or replace function public.unban_community_member(p_community uuid, p_user uuid) returns void
language plpgsql security definer set search_path = public as $$
declare me uuid := _require_community_admin(p_community);
begin
  delete from community_bans where community_id = p_community and user_id = p_user;
end $$;

create or replace function public.list_community_bans(p_community uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare me uuid := _require_community_admin(p_community);
begin
  return coalesce((select jsonb_agg(jsonb_build_object('id', b.user_id, 'username', p.username, 'avatar_url', p.avatar_url, 'reason', b.reason,
      'created_at', b.created_at, 'banned_by', (select username from profiles where id = b.banned_by)) order by b.created_at desc)
    from community_bans b join profiles p on p.id = b.user_id where b.community_id = p_community), '[]'::jsonb);
end $$;

create or replace function public.create_channel(p_community uuid, p_name text, p_topic text default '', p_kind text default 'text') returns uuid
language plpgsql security definer set search_path = public as $$
declare me uuid := _require_community_admin(p_community); v_name text := _clean_channel_name(p_name); chid uuid;
begin
  if v_name = '' then raise exception 'Channel names use letters, numbers and dashes.'; end if;
  if p_kind not in ('text','announcement','voice') then raise exception 'Invalid channel type.'; end if;
  if (select count(*) from channels where community_id = p_community) >= 50 then raise exception 'Communities can have up to 50 channels.'; end if;
  if exists (select 1 from channels where community_id = p_community and name = v_name) then raise exception 'A channel called #% already exists.', v_name; end if;
  insert into channels (community_id, name, topic, kind, position)
  values (p_community, v_name, left(coalesce(p_topic, ''), 200), p_kind, coalesce((select max(position) + 1 from channels where community_id = p_community), 0))
  returning id into chid;
  return chid;
end $$;

create or replace function public.update_channel(p_channel uuid, p_name text default null, p_topic text default null, p_kind text default null,
  p_position int default null) returns void
language plpgsql security definer set search_path = public as $$
declare ch channels; me uuid; v_name text;
begin
  select * into ch from channels where id = p_channel;
  if not found then raise exception 'Channel not found.'; end if;
  me := _require_community_admin(ch.community_id);
  v_name := case when p_name is null then ch.name else _clean_channel_name(p_name) end;
  if v_name = '' then raise exception 'Channel names use letters, numbers and dashes.'; end if;
  if p_kind is not null and p_kind not in ('text','announcement','voice') then raise exception 'Invalid channel type.'; end if;
  if v_name <> ch.name and exists (select 1 from channels where community_id = ch.community_id and name = v_name) then
    raise exception 'A channel called #% already exists.', v_name;
  end if;
  update channels set name = v_name, topic = coalesce(left(p_topic, 200), topic), kind = coalesce(p_kind, kind), position = coalesce(p_position, position)
  where id = p_channel;
end $$;

create or replace function public.delete_channel(p_channel uuid) returns void
language plpgsql security definer set search_path = public as $$
declare ch channels; me uuid;
begin
  select * into ch from channels where id = p_channel;
  if not found then raise exception 'Channel not found.'; end if;
  me := _require_community_admin(ch.community_id);
  if (select count(*) from channels where community_id = ch.community_id) <= 1 then raise exception 'A community needs at least one channel.'; end if;
  delete from channels where id = p_channel;
end $$;

-- =============================================================================
-- NOTIFICATIONS API
-- =============================================================================
create or replace function public.list_notifications(p_limit int default 30, p_offset int default 0, p_unread_only boolean default false)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare me uuid := _require_user();
begin
  return coalesce((select jsonb_agg(x.j order by x.created_at desc) from (
    select n.created_at, jsonb_build_object('id', n.id, 'type', n.type, 'data', n.data, 'count', n.count, 'read_at', n.read_at,
             'created_at', n.created_at, 'party_id', n.party_id, 'conversation_id', n.conversation_id,
             'actor', case when n.actor_id is not null then _card(n.actor_id) end) j
    from notifications n where n.user_id = me and (not coalesce(p_unread_only, false) or n.read_at is null)
    order by n.created_at desc limit least(greatest(coalesce(p_limit, 30), 1), 100) offset greatest(coalesce(p_offset, 0), 0)) x), '[]'::jsonb);
end $$;

create or replace function public.mark_notifications_read(p_ids bigint[] default null) returns void
language sql security definer set search_path = public as $$
  update notifications set read_at = now()
  where user_id = auth.uid() and read_at is null and (p_ids is null or id = any(p_ids));
$$;

-- =============================================================================
-- DASHBOARD & MATCHMAKING
-- =============================================================================
create or replace function public.quick_match(p_game text default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare me uuid := _require_user(); v profiles; vg user_game_profiles; g games; v_game text := p_game;
  players jsonb; parties_out jsonb; diag jsonb := '[]'; n_game int; n int; tips jsonb := '[]';
begin
  select * into v from profiles where id = me;
  if v_game is null then select ugp.game_id into v_game from user_game_profiles ugp where user_id = me order by created_at limit 1; end if;
  if v_game is null then
    return jsonb_build_object('game_id', null, 'players', '[]'::jsonb, 'parties', '[]'::jsonb,
      'tips', jsonb_build_array('Add a game profile so Quick Match knows what you want to play.'));
  end if;
  select * into g from games where id = v_game;
  select * into vg from user_game_profiles where user_id = me and user_game_profiles.game_id = v_game;

  select coalesce(jsonb_agg(p order by (p -> 'compatibility' ->> 'score')::int desc, (p ->> 'status') = 'offline'), '[]'::jsonb) into players
  from jsonb_array_elements(find_players(p_game => v_game, p_limit => 48) -> 'players') p
  where (p -> 'compatibility' ->> 'score')::int >= 60;
  players := coalesce((select jsonb_agg(e) from (select e from jsonb_array_elements(players) e limit 8) s), '[]'::jsonb);

  select coalesce(jsonb_agg(pt), '[]'::jsonb) into parties_out
  from jsonb_array_elements(list_parties(p_game => v_game, p_limit => 20) -> 'parties') pt
  where (pt -> 'fit' ->> 'score')::int >= 60;
  parties_out := coalesce((select jsonb_agg(e) from (select e from jsonb_array_elements(parties_out) e limit 4) s), '[]'::jsonb);

  -- Explain the pool so we can suggest which filter to relax (no fake results)
  select count(*) into n_game from public_profiles pp
    where pp.id <> me and pp.discoverable and (v.show_demo_players or not pp.is_demo)
      and exists (select 1 from public_game_profiles x where x.user_id = pp.id and x.game_id = v_game);
  diag := diag || jsonb_build_object('key', 'game', 'label', 'Players who list ' || g.name, 'count', n_game);
  if n_game > 0 then
    if v.region is not null then
      select count(*) into n from public_profiles pp where pp.id <> me and pp.discoverable and (v.show_demo_players or not pp.is_demo) and pp.region = v.region
        and exists (select 1 from public_game_profiles x where x.user_id = pp.id and x.game_id = v_game);
      diag := diag || jsonb_build_object('key', 'region', 'label', '…in your region', 'count', n);
      if n = 0 then tips := tips || to_jsonb('Nobody in your region lists ' || g.name || ' yet — try players in nearby regions.'::text); end if;
    end if;
    if cardinality(v.languages) > 0 then
      select count(*) into n from public_profiles pp where pp.id <> me and pp.discoverable and (v.show_demo_players or not pp.is_demo) and pp.languages && v.languages
        and exists (select 1 from public_game_profiles x where x.user_id = pp.id and x.game_id = v_game);
      diag := diag || jsonb_build_object('key', 'language', 'label', '…who share a language', 'count', n);
      if n = 0 then tips := tips || to_jsonb('No one shares your languages for this game — consider adding English or another language you can play in.'::text); end if;
    end if;
    if vg.rank_index is not null and cardinality(g.ranks) > 0 then
      select count(*) into n from public_profiles pp where pp.id <> me and pp.discoverable and (v.show_demo_players or not pp.is_demo)
        and exists (select 1 from public_game_profiles x where x.user_id = pp.id and x.game_id = v_game
                    and abs(x.rank_index - vg.rank_index) <= g.rank_tolerance);
      diag := diag || jsonb_build_object('key', 'rank', 'label', '…within ' || g.rank_tolerance || ' ranks of you', 'count', n);
      if n = 0 then tips := tips || to_jsonb('No one near your rank yet — try a casual session or widen the rank range.'::text); end if;
    end if;
    if cardinality(v.availability) > 0 then
      select count(*) into n from public_profiles pp where pp.id <> me and pp.discoverable and (v.show_demo_players or not pp.is_demo) and pp.availability && v.availability
        and exists (select 1 from public_game_profiles x where x.user_id = pp.id and x.game_id = v_game);
      diag := diag || jsonb_build_object('key', 'schedule', 'label', '…who play when you do', 'count', n);
      if n = 0 then tips := tips || to_jsonb('No schedule overlap — adding more playtimes widens your matches.'::text); end if;
    end if;
  else
    tips := tips || to_jsonb('No one else lists ' || g.name || ' yet. Create a public party so new players can find you.'::text);
  end if;
  if vg.id is not null and vg.rank is null and cardinality(g.ranks) > 0 then tips := tips || to_jsonb('Add your ' || g.name || ' rank for more accurate matches.'::text); end if;
  if v.region is null then tips := tips || to_jsonb('Set your region so we can avoid high-ping matches.'::text); end if;
  if cardinality(v.availability) = 0 then tips := tips || to_jsonb('Add your usual playtimes to match with people on your schedule.'::text); end if;
  if jsonb_array_length(players) = 0 and n_game > 0 then
    tips := tips || to_jsonb('Players exist for this game but none scored 60+. Browse Find Players to see lower matches.'::text);
  end if;

  return jsonb_build_object('game_id', v_game, 'game_name', g.name, 'players', players, 'parties', parties_out,
                            'diagnostics', diag, 'tips', tips);
end $$;

create or replace function public.get_dashboard() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare me uuid := _require_user(); v profiles; missing jsonb := '[]';
begin
  select * into v from profiles where id = me;
  if v.region is null then missing := missing || '"region"'; end if;
  if cardinality(v.languages) = 0 then missing := missing || '"languages"'; end if;
  if cardinality(v.availability) = 0 then missing := missing || '"availability"'; end if;
  if v.mic_preference is null then missing := missing || '"mic"'; end if;
  if v.bio = '' then missing := missing || '"bio"'; end if;
  if not exists (select 1 from user_game_profiles where user_id = me) then missing := missing || '"games"'; end if;
  return jsonb_build_object(
    'missing_profile', missing,
    'recommended_players', find_players(p_limit => 6) -> 'players',
    'my_parties', list_parties(p_scope => 'mine', p_limit => 6) -> 'parties',
    'suggested_parties', list_parties(p_limit => 4) -> 'parties',
    'friend_requests', list_friends() -> 'incoming',
    'friends_online', coalesce((select jsonb_agg(f) from jsonb_array_elements(list_friends() -> 'friends') f where f ->> 'status' <> 'offline'), '[]'::jsonb),
    'party_invites', coalesce((select jsonb_agg(jsonb_build_object('id', i.id, 'created_at', i.created_at, 'inviter', _card(i.inviter_id),
                       'party', _party_json(me, p, false)) order by i.created_at desc)
                     from party_invites i join parties p on p.id = i.party_id
                     where i.invitee_id = me and i.status = 'pending' and p.status = 'open'), '[]'::jsonb),
    'pending_join_requests', (select count(*) from party_join_requests r join parties p on p.id = r.party_id
                              where p.leader_id = me and r.status = 'pending'),
    'recent_activity', list_notifications(8, 0, false));
end $$;

-- =============================================================================
-- REPORTS & MODERATION
-- =============================================================================
create or replace function public.submit_report(p_user uuid, p_category text, p_description text,
  p_message_id bigint default null, p_party_id uuid default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare me uuid := _require_user(); t profiles; snap text; rid uuid;
begin
  if p_user = me then raise exception 'You can''t report yourself.'; end if;
  select * into t from profiles where id = p_user;
  if not found then raise exception 'Player not found.'; end if;
  if p_category not in ('harassment','cheating','spam','inappropriate_profile','suspicious','other') then raise exception 'Choose a category.'; end if;
  if char_length(btrim(coalesce(p_description, ''))) < 10 then raise exception 'Please describe what happened (at least 10 characters).'; end if;
  if p_message_id is not null then
    select m.body into snap from messages m
      where m.id = p_message_id and m.sender_id = p_user
        and exists (select 1 from conversation_members cm where cm.conversation_id = m.conversation_id and cm.user_id = me);
    if snap is null then raise exception 'That message can''t be reported.'; end if;
  end if;
  if p_party_id is not null and not exists (select 1 from parties p where p.id = p_party_id and _can_see_party(me, p)) then
    p_party_id := null;
  end if;
  perform _rate_limit('report', 10, interval '1 day', 'reports');
  insert into reports (reporter_id, reported_user_id, reported_username, category, description, message_id, message_snapshot, party_id)
  values (me, p_user, t.username, p_category, left(btrim(p_description), 1000), p_message_id, snap, p_party_id)
  returning id into rid;
  return rid;
end $$;

create or replace function public.my_reports() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', id, 'reported_username', reported_username, 'category', category,
           'status', status, 'created_at', created_at) order by created_at desc), '[]'::jsonb)
  from reports where reporter_id = auth.uid()
$$;

create or replace function public._require_moderator() returns uuid
language plpgsql stable security definer set search_path = public as $$
declare me uuid := _require_user();
begin
  if not is_moderator(me) then raise exception 'Moderator access required.' using errcode = '42501'; end if;
  return me;
end $$;

create or replace function public.mod_list_reports(p_status text default 'active', p_limit int default 25, p_offset int default 0) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare me uuid := _require_moderator();
begin
  return jsonb_build_object(
    'counts', (select jsonb_object_agg(s, (select count(*) from reports r where r.status = s)) from unnest(array['open','in_review','resolved','dismissed']) s),
    'reports', coalesce((select jsonb_agg(x.j order by x.created_at desc) from (
       select r.created_at, jsonb_build_object('id', r.id, 'category', r.category, 'status', r.status, 'created_at', r.created_at,
         'reported_user_id', r.reported_user_id, 'reported_username', r.reported_username,
         'reporter_username', (select username from profiles where id = r.reporter_id),
         'description', left(r.description, 200), 'action_taken', r.action_taken,
         'prior_reports', (select count(*) from reports r2 where r2.reported_user_id = r.reported_user_id and r2.id <> r.id)) j
       from reports r
       where case when p_status = 'active' then r.status in ('open','in_review') when p_status = 'all' then true else r.status = p_status end
       order by r.created_at desc limit least(greatest(coalesce(p_limit, 25), 1), 100) offset greatest(coalesce(p_offset, 0), 0)) x), '[]'::jsonb));
end $$;

create or replace function public.mod_get_report(p_report uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare me uuid := _require_moderator(); r reports; t profiles;
begin
  select * into r from reports where id = p_report;
  if not found then return null; end if;
  select * into t from profiles where id = r.reported_user_id;
  return to_jsonb(r) || jsonb_build_object(
    'reporter_username', (select username from profiles where id = r.reporter_id),
    'party_title', (select title from parties where id = r.party_id),
    'reported_profile', case when t.id is not null then jsonb_build_object('id', t.id, 'username', t.username, 'avatar_url', t.avatar_url,
        'bio', t.bio, 'highlights', t.highlights, 'created_at', t.created_at, 'suspended_until', t.suspended_until, 'is_banned', t.is_banned) end,
    'other_reports', coalesce((select jsonb_agg(jsonb_build_object('id', o.id, 'category', o.category, 'status', o.status, 'created_at', o.created_at) order by o.created_at desc)
                     from reports o where o.reported_user_id = r.reported_user_id and o.id <> r.id), '[]'::jsonb),
    'actions', coalesce((select jsonb_agg(jsonb_build_object('action', a.action, 'note', a.note, 'created_at', a.created_at,
                 'moderator', (select username from profiles where id = a.moderator_id)) order by a.created_at desc)
               from moderation_actions a where a.target_user_id = r.reported_user_id), '[]'::jsonb));
end $$;

create or replace function public.mod_update_report(p_report uuid, p_status text, p_action text default 'none',
  p_note text default null, p_suspend_days int default null) returns void
language plpgsql security definer set search_path = public as $$
declare me uuid := _require_moderator(); r reports;
begin
  select * into r from reports where id = p_report for update;
  if not found then raise exception 'Report not found.'; end if;
  if r.reported_user_id = me then raise exception 'You can''t moderate a report about yourself.'; end if;
  if p_status not in ('open','in_review','resolved','dismissed') then raise exception 'Invalid status.'; end if;
  if p_action not in ('none','warning','remove_content','suspend','ban') then raise exception 'Invalid action.'; end if;
  if p_action = 'ban' and not is_admin() then raise exception 'Only admins can ban accounts.' using errcode = '42501'; end if;
  if p_action = 'suspend' and (p_suspend_days is null or p_suspend_days not between 1 and 365) then raise exception 'Choose a suspension length (1–365 days).'; end if;
  if p_action <> 'none' and r.reported_user_id is null then raise exception 'The reported account no longer exists.'; end if;
  if p_action <> 'none' and exists (select 1 from user_roles where user_id = r.reported_user_id) and not is_admin() then
    raise exception 'Only admins can take action against moderators.' using errcode = '42501';
  end if;

  update reports set status = p_status, assigned_moderator = me,
    action_taken = case when p_action <> 'none' then p_action else action_taken end,
    resolution_note = coalesce(nullif(btrim(p_note), ''), resolution_note),
    resolved_at = case when p_status in ('resolved','dismissed') then now() else null end
  where id = p_report;

  if p_action = 'warning' then
    perform _notify(r.reported_user_id, 'moderation', null, null, null,
      jsonb_build_object('action', 'warning', 'message', 'A moderator reviewed a report about your account and issued a warning. Please follow the community guidelines.'));
  elsif p_action = 'remove_content' then
    if r.message_id is not null then update messages set removed_at = now() where id = r.message_id; end if;
    if r.category = 'inappropriate_profile' then
      update profiles set bio = '', avatar_url = null, highlights = '{}' where id = r.reported_user_id;
    end if;
    perform _notify(r.reported_user_id, 'moderation', null, null, null,
      jsonb_build_object('action', 'remove_content', 'message', 'A moderator removed content from your account that broke the community guidelines.'));
  elsif p_action = 'suspend' then
    update profiles set suspended_until = now() + make_interval(days => p_suspend_days), status = 'invisible' where id = r.reported_user_id;
    perform _notify(r.reported_user_id, 'moderation', null, null, null,
      jsonb_build_object('action', 'suspend', 'days', p_suspend_days, 'message', 'Your account is suspended for ' || p_suspend_days || ' day(s) after a moderator review.'));
  elsif p_action = 'ban' then
    update profiles set is_banned = true where id = r.reported_user_id;
  end if;
  if p_action <> 'none' or p_status in ('resolved','dismissed') then
    insert into moderation_actions (report_id, moderator_id, target_user_id, action, note)
    values (r.id, me, r.reported_user_id, case when p_action = 'none' then p_status else p_action end, nullif(btrim(p_note), ''));
  end if;
  if p_status in ('resolved','dismissed') and r.status not in ('resolved','dismissed') and r.reporter_id is not null then
    perform _notify(r.reporter_id, 'report_update', null, null, null,
      jsonb_build_object('reported_username', r.reported_username, 'status', p_status,
                         'message', 'Thanks — a moderator reviewed your report about ' || r.reported_username || '.'));
  end if;
end $$;

-- =============================================================================
-- ACCOUNT DELETION
-- =============================================================================
create or replace function public.delete_my_account(p_confirm_username text) returns void
language plpgsql security definer set search_path = public, auth as $$
declare me uuid := _require_user(); p profiles; pt record; heir uuid;
begin
  select * into p from profiles where id = me;
  if lower(coalesce(p_confirm_username, '')) <> lower(p.username) then raise exception 'Type your username exactly to confirm.'; end if;
  -- Hand parties to another member so they survive; otherwise close them.
  for pt in select id from parties where leader_id = me and status = 'open' loop
    select user_id into heir from party_members where party_id = pt.id and user_id <> me order by joined_at limit 1;
    if heir is not null then
      update parties set leader_id = heir where id = pt.id;
      perform _notify(heir, 'party_leadership', null, pt.id, null, jsonb_build_object('party_title', (select title from parties where id = pt.id)));
    end if;
  end loop;
  -- Communities pass to the most senior remaining member; empty ones are deleted.
  for pt in select id from communities where owner_id = me loop
    select user_id into heir from community_members where community_id = pt.id and user_id <> me
      order by _role_rank(role) desc, joined_at limit 1;
    if heir is null then delete from communities where id = pt.id;
    else
      update community_members set role = 'owner' where community_id = pt.id and user_id = heir;
      update communities set owner_id = heir where id = pt.id;
    end if;
  end loop;
  for pt in select id from conversations where kind = 'group' and owner_id = me loop
    select user_id into heir from conversation_members where conversation_id = pt.id and user_id <> me order by joined_at limit 1;
    if heir is null then delete from conversations where id = pt.id; else update conversations set owner_id = heir where id = pt.id; end if;
  end loop;
  delete from auth.users where id = me;   -- cascades to profile and all owned rows
end $$;

-- =============================================================================
-- ROW LEVEL SECURITY
-- =============================================================================
alter table public.games                enable row level security;
alter table public.profiles             enable row level security;
alter table public.user_roles           enable row level security;
alter table public.user_game_profiles   enable row level security;
alter table public.parties              enable row level security;
alter table public.party_members        enable row level security;
alter table public.party_join_requests  enable row level security;
alter table public.party_invites        enable row level security;
alter table public.friendships          enable row level security;
alter table public.blocks               enable row level security;
alter table public.mutes                enable row level security;
alter table public.conversations        enable row level security;
alter table public.conversation_members enable row level security;
alter table public.messages             enable row level security;
alter table public.notifications        enable row level security;
alter table public.reports              enable row level security;
alter table public.moderation_actions   enable row level security;
alter table public.rate_events          enable row level security;
alter table public.communities          enable row level security;
alter table public.community_members    enable row level security;
alter table public.community_bans       enable row level security;
alter table public.community_invites    enable row level security;
alter table public.channels             enable row level security;
alter table public.message_reactions    enable row level security;
alter table public.conversation_typing  enable row level security;

do $$ declare r record; begin
  for r in select policyname, tablename from pg_policies where schemaname = 'public' loop
    execute format('drop policy if exists %I on public.%I', r.policyname, r.tablename);
  end loop;
end $$;

create policy games_read on public.games for select using (true);

create policy profiles_own_read on public.profiles for select to authenticated using (id = auth.uid() or public.is_moderator());
create policy profiles_own_update on public.profiles for update to authenticated
  using (id = auth.uid() and not is_banned) with check (id = auth.uid());

create policy roles_own_read on public.user_roles for select to authenticated using (user_id = auth.uid() or public.is_moderator());

create policy ugp_own_read on public.user_game_profiles for select to authenticated using (user_id = auth.uid() or public.is_moderator());
create policy ugp_own_insert on public.user_game_profiles for insert to authenticated with check (user_id = auth.uid());
create policy ugp_own_update on public.user_game_profiles for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy ugp_own_delete on public.user_game_profiles for delete to authenticated using (user_id = auth.uid());

-- Parties/membership are readable when the party is visible to you (needed for Realtime);
-- all writes go through the functions above.
create policy parties_read on public.parties for select to authenticated using (
  leader_id = auth.uid() or public.is_party_member(id) or public.has_party_invite(id)
  or (visibility = 'public' and not public.is_blocked_between(leader_id, auth.uid())) or public.is_moderator());
create policy party_members_read on public.party_members for select to authenticated using (
  exists (select 1 from public.parties p where p.id = party_id));
create policy join_requests_read on public.party_join_requests for select to authenticated using (
  user_id = auth.uid() or public.is_party_leader(party_id));
create policy invites_read on public.party_invites for select to authenticated using (
  invitee_id = auth.uid() or inviter_id = auth.uid() or public.is_party_leader(party_id));

create policy friendships_read on public.friendships for select to authenticated using (auth.uid() in (requester_id, addressee_id));
create policy blocks_read on public.blocks for select to authenticated using (blocker_id = auth.uid());
create policy mutes_read on public.mutes for select to authenticated using (muter_id = auth.uid());

create policy conversations_read on public.conversations for select to authenticated using (public.is_conversation_member(id));
create policy conv_members_read on public.conversation_members for select to authenticated using (public.is_conversation_member(conversation_id));
create policy messages_read on public.messages for select to authenticated using (public.is_conversation_member(conversation_id));

create policy notifications_read on public.notifications for select to authenticated using (user_id = auth.uid());
create policy notifications_update on public.notifications for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy notifications_delete on public.notifications for delete to authenticated using (user_id = auth.uid());

create policy reports_mod_read on public.reports for select to authenticated using (public.is_moderator());
create policy mod_actions_read on public.moderation_actions for select to authenticated using (public.is_moderator());
create policy communities_read on public.communities for select to authenticated using (is_public or public.is_community_member(id));
create policy community_members_read on public.community_members for select to authenticated using (
  exists (select 1 from public.communities c where c.id = community_id));
create policy channels_read on public.channels for select to authenticated using (
  exists (select 1 from public.communities c where c.id = community_id));
create policy community_bans_read on public.community_bans for select to authenticated using (
  user_id = auth.uid() or coalesce(public._community_role(community_id, auth.uid()), '') in ('owner','admin'));
create policy reactions_read on public.message_reactions for select to authenticated using (
  exists (select 1 from public.messages m where m.id = message_id));
create policy typing_read on public.conversation_typing for select to authenticated using (public.is_conversation_member(conversation_id));
-- community_invites: no direct access (use get_invite / list_invites)
-- rate_events: no policies → no direct access

-- =============================================================================
-- PRIVILEGES (least privilege for the API roles)
-- =============================================================================
revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;

grant select on public.games to anon, authenticated;
grant select on public.profiles to authenticated;
grant update (username, avatar_url, bio, region, languages, platforms, mic_preference, playstyles, teammate_traits,
              pref_teammate_mic, looking_for, highlights, availability, timezone, status, discoverable,
              show_bio, show_region, show_languages, show_platforms, show_availability, show_ranks, show_highlights,
              show_online_status, allow_friend_requests, allow_party_invites, allow_messages,
              notify_friend_requests, notify_party_invites, notify_join_requests, notify_request_updates, notify_messages,
              show_demo_players, onboarded_at, custom_status, notify_mentions,
              banner_url, theme_color, theme_color_2, name_style, avatar_decoration, profile_effect, status_emoji)
  on public.profiles to authenticated;
grant select on public.user_roles to authenticated;
grant select, delete on public.user_game_profiles to authenticated;
grant insert (game_id, user_id, platform, rank, experience, main_role, secondary_roles, preferred_modes, session_length, playstyles, looking_for, notes, is_visible)
  on public.user_game_profiles to authenticated;
grant update (platform, rank, experience, main_role, secondary_roles, preferred_modes, session_length, playstyles, looking_for, notes, is_visible)
  on public.user_game_profiles to authenticated;
grant select on public.parties, public.party_members, public.party_join_requests, public.party_invites to authenticated;
grant select on public.friendships, public.blocks, public.mutes to authenticated;
grant select on public.conversations, public.conversation_members, public.messages to authenticated;
grant select, delete on public.notifications to authenticated;
grant update (read_at) on public.notifications to authenticated;
grant select on public.reports, public.moderation_actions to authenticated;
grant select on public.public_profiles, public.public_game_profiles to authenticated;
grant select on public.communities, public.community_members, public.channels, public.community_bans,
  public.message_reactions, public.conversation_typing to authenticated;

revoke execute on all functions in schema public from public, anon, authenticated;
do $$
declare fn text;
begin
  foreach fn in array array[
    -- used inside RLS policies (must be executable by the caller)
    'is_moderator(uuid)','is_blocked_between(uuid,uuid)','is_party_member(uuid)','is_party_leader(uuid)',
    'has_party_invite(uuid)','is_conversation_member(uuid)',
    -- used by the public views
    '_display_status(public.profiles)','_level(integer)',
    -- client API
    'heartbeat()','is_username_available(text)','am_i_moderator()','get_compatibility(uuid,text)',
    'find_players(text,text,text,text,integer,integer,text,text,text,text,boolean,text,text,integer,integer,boolean)',
    'get_player_profile(uuid)',
    'create_party(text,text,integer,text,text[],text,integer,integer,text,text,text,boolean,text,timestamptz,text)',
    'update_party(uuid,text,text,text[],text,integer,timestamptz,boolean)',
    'list_parties(text,text,text,text,text,text,boolean,text,integer,integer)',
    'get_party(uuid)','request_join_party(uuid,text,text)','cancel_join_request(uuid)','respond_join_request(uuid,boolean)',
    'invite_to_party(uuid,uuid)','respond_party_invite(uuid,boolean,text)','cancel_party_invite(uuid)','leave_party(uuid)',
    'remove_party_member(uuid,uuid)','transfer_party_leadership(uuid,uuid)','close_party(uuid)',
    'send_friend_request(uuid)','respond_friend_request(uuid,boolean)','remove_friend(uuid)','list_friends()',
    'block_user(uuid)','unblock_user(uuid)','mute_user(uuid)','unmute_user(uuid)','list_blocked_and_muted()',
    'get_or_create_direct_conversation(uuid)','send_message(uuid,text,bigint)','get_messages(uuid,bigint,integer)',
    'edit_message(bigint,text)','delete_message(bigint)','toggle_reaction(bigint,text)','pin_message(bigint,boolean)',
    'list_pins(uuid)','search_messages(uuid,text,integer)','set_typing(uuid)','get_typing(uuid)','set_conversation_muted(uuid,boolean)',
    'create_group_dm(uuid[],text)','rename_group_dm(uuid,text)','add_group_member(uuid,uuid)','remove_group_member(uuid,uuid)','leave_group_dm(uuid)',
    'is_community_member(uuid)','_community_role(uuid,uuid)',
    'create_community(text,text,boolean,text,text)','update_community(uuid,text,text,boolean,text,text,boolean)','delete_community(uuid,text)',
    'get_community(uuid)','list_my_communities()','explore_communities(text,text,integer,integer)','join_community(uuid)','leave_community(uuid)',
    'create_invite(uuid,integer,integer)','get_invite(text)','accept_invite(text)','list_invites(uuid)','revoke_invite(text)',
    'list_community_members(uuid)','set_member_role(uuid,uuid,text)','transfer_community_ownership(uuid,uuid)','kick_community_member(uuid,uuid)',
    'ban_community_member(uuid,uuid,text)','unban_community_member(uuid,uuid)','list_community_bans(uuid)',
    'create_channel(uuid,text,text,text)','update_channel(uuid,text,text,text,integer)','delete_channel(uuid)',
    'get_conversation(uuid)','list_conversations()','mark_conversation_read(uuid)','get_counts()',
    'list_notifications(integer,integer,boolean)','mark_notifications_read(bigint[])',
    'quick_match(text)','get_dashboard()',
    'submit_report(uuid,text,text,bigint,uuid)','my_reports()',
    'mod_list_reports(text,integer,integer)','mod_get_report(uuid)','mod_update_report(uuid,text,text,text,integer)',
    'delete_my_account(text)'
  ] loop
    execute format('grant execute on function public.%s to authenticated', fn);
  end loop;
end $$;

-- =============================================================================
-- REALTIME (Supabase) — messages, notifications and party changes stream to
-- clients; Realtime applies the SELECT policies above to every event.
-- =============================================================================
do $$
declare t text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach t in array array['messages','notifications','party_members','parties','party_join_requests','friendships',
                            'message_reactions','conversation_typing','community_members','channels'] loop
      if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
        execute format('alter publication supabase_realtime add table public.%I', t);
      end if;
    end loop;
  end if;
end $$;

-- =============================================================================
-- STORAGE (avatar uploads). Public bucket; users may only write in their own folder.
-- =============================================================================
do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'storage') then
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values ('avatars', 'avatars', true, 2097152, array['image/png','image/jpeg','image/webp','image/gif'])
    on conflict (id) do update set public = true, file_size_limit = 2097152,
      allowed_mime_types = array['image/png','image/jpeg','image/webp','image/gif'];
    execute 'drop policy if exists "avatars_public_read" on storage.objects';
    execute 'drop policy if exists "avatars_own_insert" on storage.objects';
    execute 'drop policy if exists "avatars_own_update" on storage.objects';
    execute 'drop policy if exists "avatars_own_delete" on storage.objects';
    execute $p$create policy "avatars_public_read" on storage.objects for select using (bucket_id = 'avatars')$p$;
    execute $p$create policy "avatars_own_insert" on storage.objects for insert to authenticated
               with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text)$p$;
    execute $p$create policy "avatars_own_update" on storage.objects for update to authenticated
               using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text)$p$;
    execute $p$create policy "avatars_own_delete" on storage.objects for delete to authenticated
               using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text)$p$;
  end if;
end $$;

-- =============================================================================
-- GAME CATALOG (rank tiers are self-reported labels; edit freely as games change)
-- =============================================================================
insert into public.games (id, name, short_name, accent_color, platforms, roles, modes, ranks, rank_weight, rank_tolerance, max_party_size, sort_order) values
('valorant', 'Valorant', 'VAL', '#ff4655', '{pc,playstation,xbox}', '{Duelist,Initiator,Controller,Sentinel,Flex}',
  '{Competitive,Unrated,Swiftplay,Premier,Spike Rush,Deathmatch}',
  '{Iron,Bronze,Silver,Gold,Platinum,Diamond,Ascendant,Immortal,Radiant}', 20, 2, 5, 10),
('cs2', 'Counter-Strike 2', 'CS2', '#f5a623', '{pc}', '{Entry Fragger,AWPer,Rifler,Support,Lurker,In-Game Leader}',
  '{Premier,Competitive,Wingman,Casual,Deathmatch,Third-party leagues}',
  '{"Premier <5k","Premier 5k–10k","Premier 10k–15k","Premier 15k–20k","Premier 20k–25k","Premier 25k–30k","Premier 30k+"}', 20, 1, 5, 20),
('league-of-legends', 'League of Legends', 'LoL', '#c8aa6e', '{pc}', '{Top,Jungle,Mid,Bot,Support,Fill}',
  '{Ranked Solo/Duo,Ranked Flex,Normal Draft,ARAM,Arena,Clash}',
  '{Iron,Bronze,Silver,Gold,Platinum,Emerald,Diamond,Master,Grandmaster,Challenger}', 20, 2, 5, 30),
('overwatch-2', 'Overwatch 2', 'OW2', '#f99e1a', '{pc,playstation,xbox,switch}', '{Tank,Damage,Support,Flex}',
  '{Competitive Role Queue,Competitive Open Queue,Quick Play,Stadium,Arcade}',
  '{Bronze,Silver,Gold,Platinum,Diamond,Master,Grandmaster,Champion,"Top 500"}', 18, 2, 5, 40),
('marvel-rivals', 'Marvel Rivals', 'Rivals', '#e62429', '{pc,playstation,xbox}', '{Vanguard,Duelist,Strategist,Flex}',
  '{Competitive,Quick Match,Arcade}',
  '{Bronze,Silver,Gold,Platinum,Diamond,Grandmaster,Celestial,Eternity,"One Above All"}', 18, 2, 6, 50),
('apex-legends', 'Apex Legends', 'Apex', '#da292a', '{pc,playstation,xbox,switch}', '{Assault,Skirmisher,Recon,Support,Controller}',
  '{Ranked,Trios,Duos,Mixtape}',
  '{Rookie,Bronze,Silver,Gold,Platinum,Diamond,Master,"Apex Predator"}', 15, 2, 3, 60),
('fortnite', 'Fortnite', 'FN', '#9d4dff', '{pc,playstation,xbox,switch,mobile}', '{IGL,Fragger,Builder,Support}',
  '{Battle Royale,Zero Build,Ranked,Reload,Creative,LEGO Fortnite,Festival}',
  '{Bronze,Silver,Gold,Platinum,Diamond,Elite,Champion,Unreal}', 8, 2, 4, 70),
('rocket-league', 'Rocket League', 'RL', '#1f8fff', '{pc,playstation,xbox,switch}', '{Striker,Midfield,Goalkeeper,Flex}',
  '{Ranked 3v3,Ranked 2v2,Ranked 1v1,Casual,Extra Modes,Tournaments}',
  '{Bronze,Silver,Gold,Platinum,Diamond,Champion,"Grand Champion","Supersonic Legend"}', 18, 1, 3, 80),
('rainbow-six-siege', 'Rainbow Six Siege', 'R6', '#4ea3ff', '{pc,playstation,xbox}', '{Entry Fragger,Hard Breacher,Support,Anchor,Roamer,Flex,In-Game Leader}',
  '{Ranked,Standard,Quick Match,Dual Front}',
  '{Copper,Bronze,Silver,Gold,Platinum,Emerald,Diamond,Champion}', 18, 2, 5, 90),
('deadlock', 'Deadlock', 'DL', '#c9b37e', '{pc}', '{Carry,Support,Frontline,Flex}',
  '{Standard,Ranked}',
  '{Initiate,Seeker,Alchemist,Arcanist,Ritualist,Emissary,Archon,Oracle,Phantom,Ascendant,Eternus}', 12, 2, 6, 100),
('minecraft', 'Minecraft', 'MC', '#5fa33a', '{pc,playstation,xbox,switch,mobile}', '{Builder,Redstoner,Explorer,Farmer,PvP,Technical}',
  '{Survival,Creative,Hardcore,Minigame Servers,Modded}', '{}', 0, 2, 10, 110),
('call-of-duty', 'Call of Duty', 'CoD', '#9ac43f', '{pc,playstation,xbox}', '{Slayer,Objective,Support,Sniper,Anchor}',
  '{Ranked Play,Multiplayer,Warzone,Zombies}',
  '{Bronze,Silver,Gold,Platinum,Diamond,Crimson,Iridescent,"Top 250"}', 10, 2, 4, 120)
on conflict (id) do nothing;

-- More games (v2). Ranks are self-reported tier labels; edit as games change their ladders.
insert into public.games (id, name, short_name, accent_color, platforms, roles, modes, ranks, rank_weight, rank_tolerance, max_party_size, sort_order, genre) values
('dota-2', 'Dota 2', 'Dota', '#c23c2a', '{pc}', '{Carry,Mid,Offlane,Soft Support,Hard Support}', '{Ranked,Unranked,Turbo,Battle Cup}',
  '{Herald,Guardian,Crusader,Archon,Legend,Ancient,Divine,Immortal}', 20, 2, 5, 130, 'moba'),
('teamfight-tactics', 'Teamfight Tactics', 'TFT', '#d1a046', '{pc,mobile}', '{}', '{Ranked,Double Up,Hyper Roll,Normal}',
  '{Iron,Bronze,Silver,Gold,Platinum,Emerald,Diamond,Master,Grandmaster,Challenger}', 12, 2, 2, 140, 'strategy'),
('mobile-legends', 'Mobile Legends: Bang Bang', 'MLBB', '#2f6fd6', '{mobile}', '{Roam,Jungle,Mid,Gold Lane,EXP Lane}', '{Ranked,Classic,Brawl}',
  '{Warrior,Elite,Master,Grandmaster,Epic,Legend,Mythic,"Mythical Honor","Mythical Glory","Mythical Immortal"}', 18, 2, 5, 150, 'moba'),
('pokemon-unite', 'Pokémon UNITE', 'UNITE', '#f2a91d', '{switch,mobile}', '{Attacker,All-Rounder,Speedster,Defender,Supporter}', '{Ranked,Standard,Quick Battle}',
  '{Beginner,Great,Expert,Veteran,Ultra,Master}', 15, 1, 5, 160, 'moba'),
('pubg', 'PUBG: Battlegrounds', 'PUBG', '#f2a900', '{pc,playstation,xbox}', '{Fragger,Support,Scout,Sniper,IGL}', '{Ranked Squads,Normal,Arcade}',
  '{Bronze,Silver,Gold,Platinum,Crystal,Diamond,Master}', 15, 2, 4, 170, 'battle_royale'),
('pubg-mobile', 'PUBG Mobile', 'PUBGM', '#e8a33d', '{mobile}', '{Fragger,Support,Scout,Sniper,IGL}', '{Classic,Ranked,Arena,Payload}',
  '{Bronze,Silver,Gold,Platinum,Diamond,Crown,Ace,"Ace Master","Ace Dominator",Conqueror}', 15, 2, 4, 180, 'battle_royale'),
('free-fire', 'Free Fire', 'FF', '#ff7a00', '{mobile}', '{Rusher,Support,Sniper,IGL}', '{Battle Royale,Clash Squad,Ranked}',
  '{Bronze,Silver,Gold,Platinum,Diamond,Heroic,Grandmaster}', 15, 2, 4, 190, 'battle_royale'),
('halo-infinite', 'Halo Infinite', 'Halo', '#4a8b3e', '{pc,xbox}', '{Slayer,Objective,Support,Sniper}', '{Ranked Arena,Quick Play,Big Team Battle,Firefight}',
  '{Bronze,Silver,Gold,Platinum,Diamond,Onyx}', 15, 1, 4, 200, 'shooter'),
('the-finals', 'The Finals', 'FINALS', '#d7263d', '{pc,playstation,xbox}', '{Light,Medium,Heavy}', '{Ranked Tournament,Quick Cash,Bank It,World Tour}',
  '{Bronze,Silver,Gold,Platinum,Diamond,Ruby}', 15, 1, 3, 210, 'shooter'),
('battlefield-6', 'Battlefield 6', 'BF6', '#e65c2b', '{pc,playstation,xbox}', '{Assault,Engineer,Support,Recon}', '{Conquest,Breakthrough,Rush,Battle Royale}',
  '{}', 0, 2, 4, 220, 'shooter'),
('arc-raiders', 'ARC Raiders', 'ARC', '#d94f2a', '{pc,playstation,xbox}', '{Scout,Fighter,Looter,Support}', '{Raids,Solo,Duos,Trios}',
  '{}', 0, 2, 3, 230, 'extraction'),
('escape-from-tarkov', 'Escape from Tarkov', 'EFT', '#9b8a61', '{pc}', '{Rifleman,Sniper,Medic,Looter}', '{PMC Raids,Scav Raids,Arena}',
  '{}', 0, 2, 5, 240, 'extraction'),
('destiny-2', 'Destiny 2', 'D2', '#8aa3b8', '{pc,playstation,xbox}', '{Titan,Hunter,Warlock}', '{Raids,Dungeons,Crucible,Trials,Gambit,Seasonal}',
  '{Copper,Bronze,Silver,Gold,Platinum,Adept,Ascendant}', 6, 2, 6, 250, 'shooter'),
('warframe', 'Warframe', 'WF', '#3fb4c9', '{pc,playstation,xbox,switch,mobile}', '{Damage,Support,Tank,Crowd Control}', '{Missions,Steel Path,Archon Hunts,Railjack}',
  '{}', 0, 2, 4, 260, 'coop'),
('helldivers-2', 'Helldivers 2', 'HD2', '#e8c547', '{pc,playstation,xbox}', '{Anti-Tank,Support,Assault,Scout}', '{Operations,Defense,Eradicate}',
  '{}', 0, 2, 4, 270, 'coop'),
('monster-hunter-wilds', 'Monster Hunter Wilds', 'MHW', '#b5652b', '{pc,playstation,xbox}', '{Melee,Ranged,Support}', '{Hunts,Event Quests,Optional Quests}',
  '{}', 0, 2, 4, 280, 'coop'),
('deep-rock-galactic', 'Deep Rock Galactic', 'DRG', '#d48a1f', '{pc,playstation,xbox}', '{Driller,Engineer,Gunner,Scout}', '{Missions,Deep Dives,Elite Deep Dives}',
  '{}', 0, 2, 4, 290, 'coop'),
('lethal-company', 'Lethal Company', 'LC', '#c9372c', '{pc}', '{Scavenger,Navigator,Lookout}', '{Contracts,Challenge Moons}',
  '{}', 0, 2, 4, 300, 'coop'),
('phasmophobia', 'Phasmophobia', 'Phasmo', '#6f7fa8', '{pc,playstation,xbox}', '{Investigator,Hunter Bait,Equipment}', '{Contracts,Challenge Mode}',
  '{}', 0, 2, 4, 310, 'coop'),
('sea-of-thieves', 'Sea of Thieves', 'SoT', '#2d9c8f', '{pc,playstation,xbox}', '{Captain,Helmsman,Gunner,Repair,Lookout}', '{Adventure,Hourglass,Safer Seas}',
  '{}', 0, 2, 4, 320, 'coop'),
('dead-by-daylight', 'Dead by Daylight', 'DBD', '#a61b1b', '{pc,playstation,xbox,switch}', '{Survivor,Killer}', '{Survive with Friends,Public Match,Custom Match}',
  '{Ash,Bronze,Silver,Gold,Iridescent}', 6, 2, 4, 330, 'horror'),
('diablo-4', 'Diablo IV', 'D4', '#9e2316', '{pc,playstation,xbox}', '{Barbarian,Druid,Necromancer,Rogue,Sorcerer,Spiritborn}', '{Pit,Helltide,Dungeons,Season}',
  '{}', 0, 2, 4, 340, 'arpg'),
('path-of-exile-2', 'Path of Exile 2', 'PoE2', '#a38552', '{pc,playstation,xbox}', '{Damage,Support,Aura}', '{Campaign,Maps,Bossing}',
  '{}', 0, 2, 6, 350, 'arpg'),
('world-of-warcraft', 'World of Warcraft', 'WoW', '#f2b134', '{pc}', '{Tank,Healer,DPS}', '{Mythic+,Raids,Arena,Battlegrounds,Delves}',
  '{}', 0, 2, 20, 360, 'mmo'),
('final-fantasy-xiv', 'Final Fantasy XIV', 'FFXIV', '#5b7bd5', '{pc,playstation,xbox}', '{Tank,Healer,DPS}', '{Raids,Trials,Dungeons,Crystalline Conflict}',
  '{}', 0, 2, 8, 370, 'mmo'),
('genshin-impact', 'Genshin Impact', 'GI', '#62a7d9', '{pc,playstation,mobile}', '{Main DPS,Sub DPS,Support,Healer}', '{Co-op Domains,Bosses,Exploration}',
  '{}', 0, 2, 4, 380, 'rpg'),
('roblox', 'Roblox', 'RBX', '#cfd3d9', '{pc,playstation,xbox,mobile}', '{}', '{Experiences}',
  '{}', 0, 2, 10, 390, 'sandbox'),
('among-us', 'Among Us', 'AU', '#c51111', '{pc,playstation,xbox,switch,mobile}', '{Crewmate,Impostor}', '{Classic,Hide and Seek}',
  '{}', 0, 2, 15, 400, 'party'),
('rust', 'Rust', 'Rust', '#cd412b', '{pc,playstation,xbox}', '{Builder,Farmer,PvP,Electrician}', '{Vanilla,Modded,Wipe Day}',
  '{}', 0, 2, 8, 410, 'survival'),
('valheim', 'Valheim', 'VH', '#6a8f3a', '{pc,xbox}', '{Builder,Fighter,Farmer,Explorer}', '{Survival,Bosses}',
  '{}', 0, 2, 10, 420, 'survival'),
('palworld', 'Palworld', 'PAL', '#3fa7d6', '{pc,playstation,xbox}', '{Builder,Explorer,Breeder,Fighter}', '{Co-op,Dedicated Server}',
  '{}', 0, 2, 4, 430, 'survival'),
('gta-online', 'GTA Online', 'GTAO', '#5f9e3b', '{pc,playstation,xbox}', '{Driver,Gunner,Hacker,Pilot}', '{Heists,Races,Free Roam,Adversary}',
  '{}', 0, 2, 4, 440, 'open_world'),
('street-fighter-6', 'Street Fighter 6', 'SF6', '#e2501d', '{pc,playstation,xbox}', '{}', '{Ranked,Casual,Battle Hub,Lobbies}',
  '{Rookie,Iron,Bronze,Silver,Gold,Platinum,Diamond,Master}', 18, 1, 2, 450, 'fighting'),
('tekken-8', 'Tekken 8', 'T8', '#c4231f', '{pc,playstation,xbox}', '{}', '{Ranked,Player Match,Lobbies}',
  '{"Beginner–Dan","Initiate–Eliminator","Garyu–Fujin","Raijin–Tekken King","Tekken Emperor+"}', 15, 1, 2, 460, 'fighting'),
('smash-ultimate', 'Super Smash Bros. Ultimate', 'SSBU', '#d43b3b', '{switch}', '{}', '{Elite Smash,Quickplay,Arenas}',
  '{}', 0, 2, 4, 470, 'fighting'),
('brawlhalla', 'Brawlhalla', 'BH', '#3c8ed6', '{pc,playstation,xbox,switch,mobile}', '{}', '{Ranked 1v1,Ranked 2v2,Casual}',
  '{Tin,Bronze,Silver,Gold,Platinum,Diamond,Valhallan}', 15, 1, 2, 480, 'fighting'),
('mario-kart-world', 'Mario Kart World', 'MKW', '#e3312d', '{switch}', '{}', '{Knockout Tour,VS Race,Battle,Free Roam}',
  '{}', 0, 2, 12, 490, 'racing'),
('splatoon-3', 'Splatoon 3', 'SPL3', '#f2e01b', '{switch}', '{Slayer,Support,Anchor,Skirmisher}', '{Anarchy Battle,Turf War,Salmon Run,X Battle}',
  '{C,B,A,S,"S+"}', 12, 1, 4, 500, 'shooter'),
('ea-fc-26', 'EA SPORTS FC 26', 'FC26', '#2bd67b', '{pc,playstation,xbox,switch}', '{Goalkeeper,Defender,Midfielder,Attacker}', '{Rivals,Clubs,Champions,Co-op Seasons}',
  '{"Division 10","Division 9","Division 8","Division 7","Division 6","Division 5","Division 4","Division 3","Division 2","Division 1",Elite}', 10, 2, 11, 510, 'sports'),
('nba-2k26', 'NBA 2K26', '2K26', '#e4342d', '{pc,playstation,xbox,switch}', '{Point Guard,Shooting Guard,Small Forward,Power Forward,Center}', '{Park,Pro-Am,The Rec,MyTeam}',
  '{}', 0, 2, 5, 520, 'sports'),
('brawl-stars', 'Brawl Stars', 'BS', '#f5c518', '{mobile}', '{Damage,Tank,Support,Controller,Assassin}', '{Ranked,Gem Grab,Brawl Ball,Showdown}',
  '{Bronze,Silver,Gold,Diamond,Mythic,Legendary,Masters,Pro}', 12, 1, 3, 530, 'moba')
on conflict (id) do nothing;

-- Genre tags for filtering
update public.games set genre = v.genre from (values
  ('valorant','shooter'),('cs2','shooter'),('league-of-legends','moba'),('overwatch-2','shooter'),('marvel-rivals','shooter'),
  ('apex-legends','battle_royale'),('fortnite','battle_royale'),('rocket-league','sports'),('rainbow-six-siege','shooter'),
  ('deadlock','moba'),('minecraft','sandbox'),('call-of-duty','shooter')) v(id, genre)
where games.id = v.id and games.genre is null;


-- #############################################################################
-- v3: VOICE & VIDEO CALLS, TOURNAMENTS, OFFICIAL GAME COMMUNITIES
-- #############################################################################

-- =============================================================================
-- VOICE & VIDEO CALLS
-- Media flows peer-to-peer (WebRTC). Signaling uses private Supabase Realtime
-- broadcast topics "call:<room>", authorized by the policies further down.
-- Rooms: "conv:<conversation id>" (DMs, group DMs, party chats) and
--        "channel:<voice channel id>" (community voice channels).
-- =============================================================================
create table if not exists public.voice_participants (
  room       text not null check (room ~ '^(channel|conv):[0-9a-f-]{36}$'),
  user_id    uuid not null references public.profiles(id) on delete cascade,
  joined_at  timestamptz not null default now(),
  last_seen  timestamptz not null default now(),
  muted      boolean not null default false,
  deafened   boolean not null default false,
  video      boolean not null default false,
  sharing    boolean not null default false,
  primary key (room, user_id)
);
create index if not exists voice_participants_user_idx on public.voice_participants (user_id);
alter table public.voice_participants enable row level security;

create or replace function public._room_ok(p_room text, p_user uuid) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare k text := split_part(coalesce(p_room, ''), ':', 1); rid uuid; ch channels; c conversations;
begin
  if p_user is null or coalesce(p_room, '') !~ '^(channel|conv):[0-9a-f-]{36}$' then return false; end if;
  rid := split_part(p_room, ':', 2)::uuid;
  if k = 'conv' then
    select * into c from conversations where id = rid and kind in ('direct','group','party');
    if not found or not exists (select 1 from conversation_members where conversation_id = rid and user_id = p_user) then return false; end if;
    if c.kind = 'direct' and exists (select 1 from conversation_members o where o.conversation_id = rid and o.user_id <> p_user and _blocked(o.user_id, p_user)) then
      return false;
    end if;
    return true;
  else
    select * into ch from channels where id = rid and kind = 'voice';
    if not found then return false; end if;
    return exists (select 1 from community_members where community_id = ch.community_id and user_id = p_user);
  end if;
end $$;

-- Exposed to policies: only answers for the caller.
create or replace function public.can_use_room(p_room text) returns boolean
language sql stable security definer set search_path = public as $$
  select public._room_ok(p_room, auth.uid())
$$;

create or replace function public._voice_people(p_room text) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(_card(v.user_id) || jsonb_build_object('muted', v.muted, 'deafened', v.deafened, 'video', v.video,
           'sharing', v.sharing, 'joined_at', v.joined_at) order by v.joined_at), '[]'::jsonb)
  from voice_participants v where v.room = p_room and v.last_seen > now() - interval '40 seconds' and _card(v.user_id) is not null
$$;

create or replace function public.voice_join(p_room text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare me uuid := _require_active(); others int; rid uuid; c conversations; m record;
begin
  if not _room_ok(p_room, me) then raise exception 'You can''t join this call.' using errcode = '42501'; end if;
  perform _rate_limit('voice_join', 40, interval '10 minutes', 'call joins');
  delete from voice_participants where user_id = me and room <> p_room; -- one call at a time
  select count(*) into others from voice_participants where room = p_room and user_id <> me and last_seen > now() - interval '40 seconds';
  insert into voice_participants (room, user_id) values (p_room, me)
  on conflict (room, user_id) do update set last_seen = now();
  -- Starting a call in a chat rings everyone else in it
  if others = 0 and p_room like 'conv:%' then
    rid := split_part(p_room, ':', 2)::uuid;
    select * into c from conversations where id = rid;
    for m in select user_id from conversation_members where conversation_id = rid and user_id <> me loop
      perform _notify(m.user_id, 'call', me, c.party_id, rid, jsonb_build_object('room', p_room, 'kind', c.kind, 'group_name', c.name));
    end loop;
  end if;
  return jsonb_build_object('room', p_room, 'participants', _voice_people(p_room));
end $$;

create or replace function public.voice_heartbeat(p_room text, p_muted boolean default false, p_deafened boolean default false,
  p_video boolean default false, p_sharing boolean default false) returns jsonb
language plpgsql security definer set search_path = public as $$
declare me uuid := _require_user();
begin
  if not _room_ok(p_room, me) then
    delete from voice_participants where room = p_room and user_id = me;
    raise exception 'You are no longer allowed in this call.' using errcode = '42501';
  end if;
  insert into voice_participants (room, user_id, muted, deafened, video, sharing)
  values (p_room, me, coalesce(p_muted, false), coalesce(p_deafened, false), coalesce(p_video, false), coalesce(p_sharing, false))
  on conflict (room, user_id) do update set last_seen = now(), muted = excluded.muted, deafened = excluded.deafened,
    video = excluded.video, sharing = excluded.sharing;
  if random() < 0.05 then delete from voice_participants where last_seen < now() - interval '10 minutes'; end if;
  return _voice_people(p_room);
end $$;

create or replace function public.voice_leave(p_room text) returns void
language sql security definer set search_path = public as $$
  delete from voice_participants where room = p_room and user_id = auth.uid()
$$;

create or replace function public.voice_state(p_room text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare me uuid := _require_user();
begin
  if not _room_ok(p_room, me) then return '[]'::jsonb; end if;
  return _voice_people(p_room);
end $$;

-- Calls going on in my chats that I'm not part of (drives the "incoming call" bar)
create or replace function public.my_calls() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(x order by x ->> 'started_at' desc), '[]'::jsonb) from (
    select jsonb_build_object('room', v.room, 'conversation_id', c.id, 'kind', c.kind, 'name', c.name,
             'party_title', (select title from parties where id = c.party_id),
             'started_at', min(v.joined_at), 'participants', _voice_people(v.room)) as x
    from voice_participants v
    join conversations c on v.room = 'conv:' || c.id::text
    join conversation_members cm on cm.conversation_id = c.id and cm.user_id = auth.uid() and not cm.muted
    where v.last_seen > now() - interval '40 seconds'
      and not exists (select 1 from voice_participants mine where mine.room = v.room and mine.user_id = auth.uid())
      and not exists (select 1 from voice_participants v2 where v2.room = v.room and v2.user_id <> auth.uid() and _blocked(v2.user_id, auth.uid()))
    group by v.room, c.id
    limit 5) q
$$;

-- =============================================================================
-- TOURNAMENTS
-- Hosts run single-elimination brackets and may offer prizes. PartyUp never
-- holds or moves money: prizes are paid by the host, every participant accepts
-- the Tournament Agreement, entry fees are not allowed, and payout status is
-- tracked publicly so hosts build (or lose) a reputation.
-- =============================================================================
create table if not exists public.tournaments (
  id                   uuid primary key default gen_random_uuid(),
  host_id              uuid references public.profiles(id) on delete set null,
  game_id              text not null references public.games(id) on update cascade,
  community_id         uuid references public.communities(id) on delete set null,
  title                text not null check (char_length(btrim(title)) between 3 and 80),
  description          text not null default '' check (char_length(description) <= 2000),
  rules                text not null default '' check (char_length(rules) <= 4000),
  format               text not null default 'single_elimination' check (format in ('single_elimination')),
  team_size            int not null default 1 check (team_size between 1 and 6),
  max_entrants         int not null check (max_entrants in (4, 8, 16, 32, 64)),
  region               text check (region is null or char_length(region) <= 20),
  platform             text check (platform is null or platform in ('pc','playstation','xbox','switch','mobile','crossplay')),
  starts_at            timestamptz not null,
  status               text not null default 'registration' check (status in ('registration','in_progress','completed','cancelled')),
  prize_type           text not null default 'none' check (prize_type in ('none','cash','gift_card','item','other')),
  prize_total          numeric(12,2) check (prize_total is null or (prize_total >= 0 and prize_total <= 100000)),
  prize_currency       text check (prize_currency is null or prize_currency ~ '^[A-Z]{3}$'),
  prize_description    text not null default '' check (char_length(prize_description) <= 500),
  prize_split          jsonb not null default '[]',
  payout_method        text not null default '' check (char_length(payout_method) <= 200),
  payout_deadline_days int check (payout_deadline_days is null or payout_deadline_days between 1 and 60),
  host_contact         text not null default '' check (char_length(host_contact) <= 120),
  agreement_version    int not null,
  cancel_reason        text check (char_length(cancel_reason) <= 300),
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  started_at           timestamptz,
  completed_at         timestamptz
);
create index if not exists tournaments_status_idx on public.tournaments (status, starts_at);
create index if not exists tournaments_game_idx on public.tournaments (game_id, starts_at);

create table if not exists public.tournament_entrants (
  id             uuid primary key default gen_random_uuid(),
  tournament_id  uuid not null references public.tournaments(id) on delete cascade,
  captain_id     uuid references public.profiles(id) on delete set null,
  team_name      text not null check (char_length(btrim(team_name)) between 2 and 32),
  members        uuid[] not null default '{}',
  seed           int,
  final_place    int,
  eliminated     boolean not null default false,
  prize_amount   numeric(12,2),
  prize_status   text not null default 'none' check (prize_status in ('none','pending','sent','received','not_received')),
  created_at     timestamptz not null default now()
);
create unique index if not exists tournament_entrants_name_idx on public.tournament_entrants (tournament_id, lower(team_name));
create index if not exists tournament_entrants_members_idx on public.tournament_entrants using gin (members);

create table if not exists public.tournament_matches (
  id               bigint generated always as identity primary key,
  tournament_id    uuid not null references public.tournaments(id) on delete cascade,
  round            int not null,
  slot             int not null,
  entrant_a        uuid references public.tournament_entrants(id) on delete set null,
  entrant_b        uuid references public.tournament_entrants(id) on delete set null,
  winner           uuid references public.tournament_entrants(id) on delete set null,
  score            text not null default '' check (char_length(score) <= 40),
  status           text not null default 'pending' check (status in ('pending','ready','reported','disputed','done')),
  reported_by      uuid references public.profiles(id) on delete set null,
  reported_winner  uuid references public.tournament_entrants(id) on delete set null,
  dispute_reason   text check (char_length(dispute_reason) <= 300),
  updated_at       timestamptz not null default now(),
  unique (tournament_id, round, slot)
);

create table if not exists public.tournament_agreements (
  tournament_id  uuid not null references public.tournaments(id) on delete cascade,
  user_id        uuid not null references public.profiles(id) on delete cascade,
  role           text not null check (role in ('host','entrant')),
  version        int not null,
  accepted_at    timestamptz not null default now(),
  primary key (tournament_id, user_id, role)
);

alter table public.tournaments enable row level security;
alter table public.tournament_entrants enable row level security;
alter table public.tournament_matches enable row level security;
alter table public.tournament_agreements enable row level security;
drop trigger if exists trg_tournaments_touch on public.tournaments;
create trigger trg_tournaments_touch before update on public.tournaments for each row execute function public.touch_updated_at();

alter table public.reports add column if not exists tournament_id uuid references public.tournaments(id) on delete set null;
alter table public.reports drop constraint if exists reports_category_check;
alter table public.reports add constraint reports_category_check
  check (category in ('harassment','cheating','spam','inappropriate_profile','suspicious','scam','other'));

-- Bump when the agreement text in src/lib/tournamentAgreement.js changes.
create or replace function public.tournament_agreement_version() returns int language sql immutable as $$ select 1 $$;

create or replace function public._tournament_host_stats(p_user uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'hosted', (select count(*) from tournaments t where t.host_id = p_user and t.status <> 'cancelled'),
    'completed', (select count(*) from tournaments t where t.host_id = p_user and t.status = 'completed'),
    'cancelled', (select count(*) from tournaments t where t.host_id = p_user and t.status = 'cancelled' and t.started_at is not null),
    'prizes_received', (select count(*) from tournament_entrants e join tournaments t on t.id = e.tournament_id where t.host_id = p_user and e.prize_status = 'received'),
    'prizes_not_received', (select count(*) from tournament_entrants e join tournaments t on t.id = e.tournament_id where t.host_id = p_user and e.prize_status = 'not_received'),
    'prizes_pending', (select count(*) from tournament_entrants e join tournaments t on t.id = e.tournament_id where t.host_id = p_user and e.prize_status in ('pending','sent')))
$$;

create or replace function public._tournament_visible(t tournaments, p_me uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select t.host_id is null or not _blocked(t.host_id, p_me)
$$;

create or replace function public._entrant_json(e tournament_entrants) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('id', e.id, 'team_name', e.team_name, 'captain_id', e.captain_id, 'seed', e.seed,
    'final_place', e.final_place, 'eliminated', e.eliminated, 'prize_amount', e.prize_amount, 'prize_status', e.prize_status,
    'members', coalesce((select jsonb_agg(_card(u) order by array_position(e.members, u)) from unnest(e.members) u where _card(u) is not null), '[]'::jsonb))
$$;

create or replace function public._tournament_summary(t tournaments, p_me uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('id', t.id, 'title', t.title, 'status', t.status, 'starts_at', t.starts_at, 'team_size', t.team_size,
    'max_entrants', t.max_entrants, 'region', t.region, 'platform', t.platform, 'prize_type', t.prize_type, 'prize_total', t.prize_total,
    'prize_currency', t.prize_currency, 'prize_description', t.prize_description, 'created_at', t.created_at,
    'entrant_count', (select count(*) from tournament_entrants e where e.tournament_id = t.id),
    'host', _card(t.host_id), 'am_host', t.host_id = p_me,
    'my_entrant', (select e.id from tournament_entrants e where e.tournament_id = t.id and p_me = any(e.members)),
    'game', (select jsonb_build_object('id', g.id, 'name', g.name, 'short_name', g.short_name, 'accent_color', g.accent_color, 'genre', g.genre) from games g where g.id = t.game_id))
$$;

create or replace function public.create_tournament(p_game text, p_title text, p_starts_at timestamptz, p_max_entrants int,
  p_team_size int default 1, p_description text default '', p_rules text default '', p_region text default null, p_platform text default null,
  p_prize_type text default 'none', p_prize_total numeric default null, p_prize_currency text default null, p_prize_description text default '',
  p_prize_split jsonb default '[]', p_payout_method text default '', p_payout_deadline_days int default null, p_host_contact text default '',
  p_community uuid default null, p_agreement_version int default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare me uuid := _require_active(); pr profiles; tid uuid; split_sum numeric := 0; item jsonb; places int[] := '{}'; txt text;
begin
  if coalesce(p_agreement_version, 0) <> tournament_agreement_version() then
    raise exception 'Read and accept the Tournament Agreement to host.';
  end if;
  perform _rate_limit('create_tournament', 3, interval '1 day', 'tournaments created');
  if not exists (select 1 from games where id = p_game and is_active) then raise exception 'Unknown game.'; end if;
  if char_length(btrim(coalesce(p_title, ''))) < 3 then raise exception 'Give the tournament a title (3–80 characters).'; end if;
  if p_max_entrants not in (4, 8, 16, 32, 64) then raise exception 'Bracket size must be 4, 8, 16, 32 or 64.'; end if;
  if coalesce(p_team_size, 1) not between 1 and 6 then raise exception 'Team size must be 1 to 6.'; end if;
  if p_starts_at is null or p_starts_at < now() + interval '10 minutes' then raise exception 'Start time must be at least 10 minutes from now.'; end if;
  if p_starts_at > now() + interval '90 days' then raise exception 'Start time must be within 90 days.'; end if;
  txt := lower(coalesce(p_title, '') || ' ' || coalesce(p_description, '') || ' ' || coalesce(p_rules, '') || ' ' || coalesce(p_prize_description, ''));
  if txt ~ '(entry fee|entry-fee|buy[- ]?in|pay to (enter|join|play)|registration fee)' then
    raise exception 'Entry fees and buy-ins aren''t allowed on PartyUp tournaments.';
  end if;
  if p_community is not null and not exists (select 1 from community_members where community_id = p_community and user_id = me) then
    raise exception 'You can only link a community you are in.';
  end if;
  if coalesce(p_prize_type, 'none') not in ('none','cash','gift_card','item','other') then raise exception 'Invalid prize type.'; end if;

  if p_prize_type = 'none' then
    p_prize_total := null; p_prize_currency := null; p_prize_split := '[]'; p_payout_method := ''; p_payout_deadline_days := null;
  else
    if p_prize_type in ('cash','gift_card') then
      select * into pr from profiles where id = me;
      if pr.created_at > now() - interval '3 days' then
        raise exception 'Accounts must be at least 3 days old to host a tournament with a cash or gift card prize.';
      end if;
      if (_tournament_host_stats(me) ->> 'prizes_not_received')::int >= 2 then
        raise exception 'You can''t host prize tournaments while winners report unpaid prizes. Contact support.';
      end if;
      if coalesce(p_prize_total, 0) <= 0 then raise exception 'Enter the total prize pool.'; end if;
      if p_prize_currency is null or p_prize_currency !~ '^[A-Z]{3}$' then raise exception 'Choose a currency.'; end if;
      if char_length(btrim(coalesce(p_payout_method, ''))) < 3 then raise exception 'Say how winners will be paid (for example PayPal or a gift card code).'; end if;
      if p_payout_deadline_days is null then raise exception 'Say how many days winners will wait for payment.'; end if;
      if jsonb_typeof(p_prize_split) <> 'array' or jsonb_array_length(p_prize_split) = 0 then raise exception 'Split the prize pool between places.'; end if;
      for item in select * from jsonb_array_elements(p_prize_split) loop
        if (item ->> 'place')::int not between 1 and 3 or (item ->> 'place')::int = any(places) then raise exception 'Prize places must be 1st, 2nd or 3rd, once each.'; end if;
        if coalesce((item ->> 'amount')::numeric, -1) < 0 then raise exception 'Prize amounts can''t be negative.'; end if;
        places := places || (item ->> 'place')::int;
        split_sum := split_sum + (item ->> 'amount')::numeric;
      end loop;
      if split_sum <> p_prize_total then raise exception 'The prize split (%) must add up to the prize pool (%).', split_sum, p_prize_total; end if;
    else
      p_prize_total := null; p_prize_currency := null; p_prize_split := '[]';
    end if;
    if char_length(btrim(coalesce(p_prize_description, ''))) < 3 and p_prize_type <> 'cash' then raise exception 'Describe the prize.'; end if;
  end if;

  insert into tournaments (host_id, game_id, community_id, title, description, rules, team_size, max_entrants, region, platform, starts_at,
    prize_type, prize_total, prize_currency, prize_description, prize_split, payout_method, payout_deadline_days, host_contact, agreement_version)
  values (me, p_game, p_community, btrim(p_title), coalesce(p_description, ''), coalesce(p_rules, ''), coalesce(p_team_size, 1), p_max_entrants,
    nullif(p_region, ''), nullif(p_platform, ''), p_starts_at, coalesce(p_prize_type, 'none'), p_prize_total, p_prize_currency,
    coalesce(p_prize_description, ''), coalesce(p_prize_split, '[]'), coalesce(p_payout_method, ''), p_payout_deadline_days,
    coalesce(p_host_contact, ''), p_agreement_version)
  returning id into tid;
  insert into tournament_agreements (tournament_id, user_id, role, version) values (tid, me, 'host', p_agreement_version);
  return tid;
end $$;

create or replace function public._tournament_in_scope(t tournaments, p_scope text, p_me uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select case coalesce(p_scope, 'upcoming')
    when 'upcoming' then t.status = 'registration'
    when 'live' then t.status = 'in_progress'
    when 'completed' then t.status = 'completed'
    when 'mine' then t.host_id = p_me or exists (select 1 from tournament_entrants e where e.tournament_id = t.id and p_me = any(e.members))
    else t.status <> 'cancelled' end
$$;

create or replace function public.list_tournaments(p_game text default null, p_scope text default 'upcoming', p_search text default null,
  p_limit int default 24, p_offset int default 0) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare me uuid := _require_user(); pat text; total int; result jsonb;
begin
  pat := case when nullif(btrim(p_search), '') is null then null
              else '%' || replace(replace(replace(btrim(p_search), '\', '\\'), '%', '\%'), '_', '\_') || '%' end;
  select count(*) into total from tournaments t
  where _tournament_visible(t, me) and (p_game is null or t.game_id = p_game) and (pat is null or t.title ilike pat)
    and _tournament_in_scope(t, p_scope, me);
  select coalesce(jsonb_agg(_tournament_summary(x, me) order by
           case when p_scope in ('completed','mine') then -extract(epoch from x.starts_at) else extract(epoch from x.starts_at) end), '[]'::jsonb)
    into result
  from (
    select t.* from tournaments t
    where _tournament_visible(t, me) and (p_game is null or t.game_id = p_game) and (pat is null or t.title ilike pat)
      and _tournament_in_scope(t, p_scope, me)
    order by case when p_scope in ('completed','mine') then -extract(epoch from t.starts_at) else extract(epoch from t.starts_at) end
    limit least(greatest(coalesce(p_limit, 24), 1), 50) offset greatest(coalesce(p_offset, 0), 0)) x;
  return jsonb_build_object('total', total, 'tournaments', result);
end $$;

create or replace function public.get_tournament(p_tournament uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare me uuid := _require_user(); t tournaments; my_e tournament_entrants;
begin
  select * into t from tournaments where id = p_tournament;
  if not found or not _tournament_visible(t, me) then return null; end if;
  select * into my_e from tournament_entrants where tournament_id = t.id and me = any(members);
  return _tournament_summary(t, me) || jsonb_build_object(
    'description', t.description, 'rules', t.rules, 'format', t.format, 'prize_split', t.prize_split,
    'payout_method', t.payout_method, 'payout_deadline_days', t.payout_deadline_days, 'host_contact', t.host_contact,
    'cancel_reason', t.cancel_reason, 'started_at', t.started_at, 'completed_at', t.completed_at,
    'agreement_version', t.agreement_version, 'current_agreement_version', tournament_agreement_version(),
    'host_stats', _tournament_host_stats(t.host_id),
    'is_moderator', is_moderator(me),
    'community', (select jsonb_build_object('id', c.id, 'name', c.name, 'icon_color', c.icon_color) from communities c where c.id = t.community_id),
    'my_entrant', case when my_e.id is null then null else _entrant_json(my_e) end,
    'am_captain', my_e.captain_id = me,
    'entrants', coalesce((select jsonb_agg(_entrant_json(e) order by e.final_place nulls last, e.seed nulls last, e.created_at)
                          from tournament_entrants e where e.tournament_id = t.id), '[]'::jsonb),
    'matches', coalesce((select jsonb_agg(jsonb_build_object('id', m.id, 'round', m.round, 'slot', m.slot, 'entrant_a', m.entrant_a,
                          'entrant_b', m.entrant_b, 'winner', m.winner, 'score', m.score, 'status', m.status,
                          'reported_winner', m.reported_winner, 'reported_by', m.reported_by, 'dispute_reason', m.dispute_reason)
                          order by m.round, m.slot) from tournament_matches m where m.tournament_id = t.id), '[]'::jsonb));
end $$;

create or replace function public._tournament_notify(p_tournament uuid, p_event text, p_actor uuid, p_only uuid[] default null)
returns void language plpgsql security definer set search_path = public as $$
declare t tournaments; u uuid;
begin
  select * into t from tournaments where id = p_tournament;
  for u in select distinct m from tournament_entrants e, unnest(e.members) m where e.tournament_id = p_tournament
           union select t.host_id where t.host_id is not null loop
    if p_only is null or u = any(p_only) then
      perform _notify(u, 'tournament', p_actor, null, null, jsonb_build_object('tournament_id', t.id, 'title', t.title, 'event', p_event));
    end if;
  end loop;
end $$;

create or replace function public.register_tournament(p_tournament uuid, p_team_name text, p_members uuid[] default '{}',
  p_agreement_version int default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare me uuid := _require_active(); t tournaments; mates uuid[]; u uuid; eid uuid;
begin
  if coalesce(p_agreement_version, 0) <> tournament_agreement_version() then
    raise exception 'Read and accept the Tournament Agreement to enter.';
  end if;
  select * into t from tournaments where id = p_tournament for update;
  if not found or not _tournament_visible(t, me) then raise exception 'Tournament not found.'; end if;
  if t.status <> 'registration' then raise exception 'Registration is closed.'; end if;
  if t.host_id = me then raise exception 'Hosts can''t enter their own tournament.'; end if;
  if exists (select 1 from tournament_entrants where tournament_id = t.id and me = any(members)) then raise exception 'You''re already entered.'; end if;
  if (select count(*) from tournament_entrants where tournament_id = t.id) >= t.max_entrants then raise exception 'This tournament is full.'; end if;
  mates := array(select distinct x from unnest(coalesce(p_members, '{}')) x where x is not null and x <> me);
  if cardinality(mates) <> t.team_size - 1 then
    raise exception 'Pick % teammate(s) for a team of %.', t.team_size - 1, t.team_size;
  end if;
  foreach u in array mates loop
    if not _are_friends(me, u) then raise exception 'Teammates must be on your friends list.'; end if;
    if _blocked(u, t.host_id) then raise exception 'One of your teammates can''t join this tournament.'; end if;
    if exists (select 1 from tournament_entrants where tournament_id = t.id and u = any(members)) then
      raise exception '% is already entered.', (select username from profiles where id = u);
    end if;
    if u = t.host_id then raise exception 'The host can''t play in their own tournament.'; end if;
  end loop;
  if char_length(btrim(coalesce(p_team_name, ''))) < 2 then raise exception 'Pick a team name (2–32 characters).'; end if;
  perform _rate_limit('register_tournament', 20, interval '1 day', 'tournament sign-ups');
  begin
    insert into tournament_entrants (tournament_id, captain_id, team_name, members)
    values (t.id, me, btrim(p_team_name), array[me] || mates) returning id into eid;
  exception when unique_violation then raise exception 'That team name is taken in this tournament.';
  end;
  insert into tournament_agreements (tournament_id, user_id, role, version) values (t.id, me, 'entrant', p_agreement_version)
  on conflict (tournament_id, user_id, role) do update set version = excluded.version, accepted_at = now();
  if cardinality(mates) > 0 then perform _tournament_notify(t.id, 'added_to_team', me, mates); end if;
  return eid;
end $$;

create or replace function public.withdraw_tournament(p_tournament uuid) returns void
language plpgsql security definer set search_path = public as $$
declare me uuid := _require_user(); t tournaments; e tournament_entrants;
begin
  select * into t from tournaments where id = p_tournament for update;
  if not found then raise exception 'Tournament not found.'; end if;
  if t.status <> 'registration' then raise exception 'You can only withdraw before the tournament starts.'; end if;
  select * into e from tournament_entrants where tournament_id = t.id and me = any(members);
  if not found then raise exception 'You''re not entered.'; end if;
  if e.captain_id = me then
    delete from tournament_entrants where id = e.id;
  else
    update tournament_entrants set members = array_remove(members, me) where id = e.id;
  end if;
end $$;

create or replace function public._advance(p_match bigint) returns void
language plpgsql security definer set search_path = public as $$
declare m tournament_matches; nxt tournament_matches; t tournaments; loser uuid; rounds int; place2 uuid; amt numeric;
begin
  select * into m from tournament_matches where id = p_match;
  select * into t from tournaments where id = m.tournament_id;
  loser := case when m.winner = m.entrant_a then m.entrant_b else m.entrant_a end;
  if loser is not null then update tournament_entrants set eliminated = true where id = loser; end if;
  select max(round) into rounds from tournament_matches where tournament_id = t.id;
  if m.round = rounds then
    -- Final: champion, runner-up, and both semifinal losers share 3rd
    update tournament_entrants set final_place = 1 where id = m.winner;
    if loser is not null then update tournament_entrants set final_place = 2 where id = loser; end if;
    update tournament_entrants e set final_place = 3
    from tournament_matches sm
    where sm.tournament_id = t.id and sm.round = rounds - 1 and sm.status = 'done'
      and e.id = case when sm.winner = sm.entrant_a then sm.entrant_b else sm.entrant_a end and e.final_place is null;
    -- Prize amounts from the split (3rd place shared equally)
    if t.prize_type in ('cash','gift_card') then
      update tournament_entrants e set
        prize_amount = round((select (x ->> 'amount')::numeric from jsonb_array_elements(t.prize_split) x where (x ->> 'place')::int = e.final_place)
                       / greatest(1, (select count(*) from tournament_entrants e2 where e2.tournament_id = t.id and e2.final_place = e.final_place)), 2),
        prize_status = 'pending'
      where e.tournament_id = t.id and e.final_place is not null
        and exists (select 1 from jsonb_array_elements(t.prize_split) x where (x ->> 'place')::int = e.final_place and (x ->> 'amount')::numeric > 0);
    elsif t.prize_type in ('item','other') then
      update tournament_entrants set prize_status = 'pending' where tournament_id = t.id and final_place = 1;
    end if;
    update tournaments set status = 'completed', completed_at = now() where id = t.id;
    perform _tournament_notify(t.id, 'completed', t.host_id);
    return;
  end if;
  select * into nxt from tournament_matches where tournament_id = t.id and round = m.round + 1 and slot = (m.slot + 1) / 2 for update;
  if m.slot % 2 = 1 then update tournament_matches set entrant_a = m.winner, updated_at = now() where id = nxt.id;
  else update tournament_matches set entrant_b = m.winner, updated_at = now() where id = nxt.id; end if;
  select * into nxt from tournament_matches where id = nxt.id;
  if nxt.entrant_a is not null and nxt.entrant_b is not null then
    update tournament_matches set status = 'ready', updated_at = now() where id = nxt.id;
    perform _tournament_notify(t.id, 'match_ready', null,
      (select array_agg(c) from (select captain_id c from tournament_entrants where id in (nxt.entrant_a, nxt.entrant_b)) z));
  end if;
end $$;

create or replace function public.start_tournament(p_tournament uuid) returns void
language plpgsql security definer set search_path = public as $$
declare me uuid := _require_active(); t tournaments; n int; size int := 2; rounds int := 1; seeds int[] := array[1]; nxt int[]; s int;
        ids uuid[]; i int; a uuid; b uuid; r int; mid bigint;
begin
  select * into t from tournaments where id = p_tournament for update;
  if not found then raise exception 'Tournament not found.'; end if;
  if t.host_id is distinct from me then raise exception 'Only the host can start the tournament.' using errcode = '42501'; end if;
  if t.status <> 'registration' then raise exception 'This tournament already started.'; end if;
  -- Teams that lost members since signing up can't play
  delete from tournament_entrants where tournament_id = t.id and cardinality(members) < t.team_size;
  select count(*) into n from tournament_entrants where tournament_id = t.id;
  if n < 2 then raise exception 'You need at least 2 entrants to start.'; end if;
  while size < n loop size := size * 2; rounds := rounds + 1; end loop;
  -- Standard bracket order (1 v 8, 4 v 5, 2 v 7, 3 v 6 …); byes go to the top seeds
  while cardinality(seeds) < size loop
    nxt := '{}';
    foreach s in array seeds loop nxt := nxt || s || (cardinality(seeds) * 2 + 1 - s); end loop;
    seeds := nxt;
  end loop;
  ids := array(select id from tournament_entrants where tournament_id = t.id order by random());
  for i in 1..n loop update tournament_entrants set seed = i where id = ids[i]; end loop;
  for r in 1..rounds loop
    for i in 1..(size / (2 ^ r))::int loop
      insert into tournament_matches (tournament_id, round, slot) values (t.id, r, i);
    end loop;
  end loop;
  update tournaments set status = 'in_progress', started_at = now() where id = t.id;
  for i in 1..(size / 2) loop
    a := case when seeds[2 * i - 1] <= n then ids[seeds[2 * i - 1]] end;
    b := case when seeds[2 * i] <= n then ids[seeds[2 * i]] end;
    update tournament_matches set entrant_a = a, entrant_b = b,
      status = case when a is not null and b is not null then 'ready' else 'done' end,
      winner = case when a is null then b when b is null then a end
    where tournament_id = t.id and round = 1 and slot = i returning id into mid;
    if a is null or b is null then perform _advance(mid); end if;
  end loop;
  perform _tournament_notify(t.id, 'started', me);
end $$;

create or replace function public.report_match(p_match bigint, p_winner uuid, p_score text default '') returns text
language plpgsql security definer set search_path = public as $$
declare me uuid := _require_active(); m tournament_matches; t tournaments; side uuid; other_captain uuid;
begin
  select * into m from tournament_matches where id = p_match for update;
  if not found then raise exception 'Match not found.'; end if;
  select * into t from tournaments where id = m.tournament_id;
  if t.status <> 'in_progress' then raise exception 'This tournament isn''t running.'; end if;
  if m.status not in ('ready','reported','disputed') then raise exception 'This match can''t be reported.'; end if;
  if p_winner is null or p_winner not in (m.entrant_a, m.entrant_b) then raise exception 'Pick the winner from this match.'; end if;
  if t.host_id = me or is_moderator(me) then
    update tournament_matches set winner = p_winner, score = left(coalesce(p_score, ''), 40), status = 'done',
      reported_by = me, reported_winner = p_winner, updated_at = now() where id = m.id;
    perform _advance(m.id);
    return 'done';
  end if;
  select e.id into side from tournament_entrants e where e.id in (m.entrant_a, m.entrant_b) and e.captain_id = me;
  if side is null then raise exception 'Only team captains or the host can report this match.' using errcode = '42501'; end if;
  other_captain := (select captain_id from tournament_entrants where id = case when side = m.entrant_a then m.entrant_b else m.entrant_a end);
  if m.status = 'disputed' then raise exception 'This match is disputed — the host will decide the result.'; end if;
  if m.status = 'reported' and m.reported_by is distinct from me then
    if m.reported_winner = p_winner then
      update tournament_matches set winner = p_winner, status = 'done', updated_at = now(),
        score = case when coalesce(p_score, '') = '' then score else left(p_score, 40) end where id = m.id;
      perform _advance(m.id);
      return 'done';
    end if;
    update tournament_matches set status = 'disputed', dispute_reason = 'Captains reported different winners.', updated_at = now() where id = m.id;
    perform _tournament_notify(t.id, 'disputed', me, array[t.host_id]);
    return 'disputed';
  end if;
  update tournament_matches set status = 'reported', reported_by = me, reported_winner = p_winner,
    score = left(coalesce(p_score, ''), 40), updated_at = now() where id = m.id;
  perform _tournament_notify(t.id, 'result_reported', me, array[other_captain]);
  return 'reported';
end $$;

create or replace function public.dispute_match(p_match bigint, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
declare me uuid := _require_active(); m tournament_matches; t tournaments;
begin
  select * into m from tournament_matches where id = p_match for update;
  if not found then raise exception 'Match not found.'; end if;
  select * into t from tournaments where id = m.tournament_id;
  if not exists (select 1 from tournament_entrants e where e.id in (m.entrant_a, m.entrant_b) and e.captain_id = me) then
    raise exception 'Only the captains in this match can dispute it.' using errcode = '42501';
  end if;
  if m.status not in ('ready','reported') or t.status <> 'in_progress' then raise exception 'This match can''t be disputed now.'; end if;
  if char_length(btrim(coalesce(p_reason, ''))) < 5 then raise exception 'Explain the problem in a few words.'; end if;
  update tournament_matches set status = 'disputed', dispute_reason = left(btrim(p_reason), 300), updated_at = now() where id = m.id;
  perform _tournament_notify(t.id, 'disputed', me, array[t.host_id]);
end $$;

create or replace function public.cancel_tournament(p_tournament uuid, p_reason text default '') returns void
language plpgsql security definer set search_path = public as $$
declare me uuid := _require_user(); t tournaments;
begin
  select * into t from tournaments where id = p_tournament for update;
  if not found then raise exception 'Tournament not found.'; end if;
  if t.host_id is distinct from me and not is_moderator(me) then raise exception 'Only the host can cancel.' using errcode = '42501'; end if;
  if t.status not in ('registration','in_progress') then raise exception 'This tournament is already over.'; end if;
  update tournaments set status = 'cancelled', cancel_reason = left(coalesce(p_reason, ''), 300) where id = t.id;
  perform _tournament_notify(t.id, 'cancelled', me);
end $$;

-- Payout tracking: host marks a prize sent; the winning team confirms it arrived (or didn't).
create or replace function public.set_prize_status(p_entrant uuid, p_status text) returns void
language plpgsql security definer set search_path = public as $$
declare me uuid := _require_user(); e tournament_entrants; t tournaments;
begin
  select * into e from tournament_entrants where id = p_entrant for update;
  if not found then raise exception 'Entry not found.'; end if;
  select * into t from tournaments where id = e.tournament_id;
  if t.status <> 'completed' or e.prize_status = 'none' then raise exception 'There is no prize to update for this team.'; end if;
  if p_status = 'sent' then
    if t.host_id is distinct from me then raise exception 'Only the host can mark a prize as sent.' using errcode = '42501'; end if;
    if e.prize_status not in ('pending','not_received') then raise exception 'This prize is already marked %.', e.prize_status; end if;
  elsif p_status in ('received','not_received') then
    if not (me = any(e.members)) then raise exception 'Only the winning team can confirm this.' using errcode = '42501'; end if;
    if p_status = 'not_received' and t.completed_at > now() - make_interval(days => coalesce(t.payout_deadline_days, 7)) and e.prize_status <> 'sent' then
      raise exception 'The host has until % to pay. You can report it after that.', to_char(t.completed_at + make_interval(days => coalesce(t.payout_deadline_days, 7)), 'Mon DD');
    end if;
  else
    raise exception 'Invalid prize status.';
  end if;
  update tournament_entrants set prize_status = p_status where id = e.id;
  if p_status = 'sent' then
    perform _tournament_notify(t.id, 'prize_sent', me, e.members);
  elsif p_status = 'not_received' and t.host_id is not null then
    -- Unpaid prizes go straight to the moderators
    insert into reports (reporter_id, reported_user_id, reported_username, category, description, tournament_id)
    values (me, t.host_id, (select username from profiles where id = t.host_id), 'scam',
            'Prize not received for tournament "' || t.title || '" (' || coalesce(e.prize_amount::text || ' ' || coalesce(t.prize_currency, ''), t.prize_description) || ').', t.id);
    perform _tournament_notify(t.id, 'prize_not_received', me, array[t.host_id]);
  end if;
end $$;

create or replace function public.report_tournament(p_tournament uuid, p_category text, p_description text) returns uuid
language plpgsql security definer set search_path = public as $$
declare me uuid := _require_user(); t tournaments; rid uuid;
begin
  select * into t from tournaments where id = p_tournament;
  if not found or t.host_id is null then raise exception 'Tournament not found.'; end if;
  if t.host_id = me then raise exception 'You can''t report your own tournament.'; end if;
  if p_category not in ('scam','cheating','harassment','spam','other') then raise exception 'Choose a category.'; end if;
  if char_length(btrim(coalesce(p_description, ''))) < 10 then raise exception 'Please describe what happened (at least 10 characters).'; end if;
  perform _rate_limit('report', 10, interval '1 day', 'reports');
  insert into reports (reporter_id, reported_user_id, reported_username, category, description, tournament_id)
  values (me, t.host_id, (select username from profiles where id = t.host_id), p_category,
          left('[Tournament: ' || t.title || '] ' || btrim(p_description), 1000), t.id)
  returning id into rid;
  return rid;
end $$;

-- =============================================================================
-- OFFICIAL GAME COMMUNITIES (one per game, created idempotently)
-- =============================================================================
do $$
declare g games; cid uuid;
begin
  for g in select * from games where is_active order by sort_order loop
    if not exists (select 1 from communities where is_official and game_id = g.id) then
      insert into communities (name, description, icon_color, owner_id, game_id, is_public, is_official)
      values (left(g.name, 40), left('The official PartyUp community for ' || g.name || ' players. Find teammates, share clips, hop in voice and join tournaments.', 300),
              g.accent_color, null, g.id, true, true)
      returning id into cid;
      insert into channels (community_id, name, topic, kind, position) values
        (cid, 'announcements', 'News, events and tournaments', 'announcement', 0),
        (cid, 'general', left('Talk about ' || g.name, 200), 'text', 1),
        (cid, 'looking-for-group', 'Post when you want to play', 'text', 2),
        (cid, 'clips-and-highlights', 'Show off your best plays', 'text', 3),
        (cid, 'tournaments', 'Find or organize tournaments', 'text', 4),
        (cid, 'lobby', 'Hang out in voice', 'voice', 5),
        (cid, 'squad-up', 'Voice for your squad', 'voice', 6);
    end if;
  end loop;
end $$;

-- Counts now include calls ringing in my chats
create or replace function public.get_counts() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare me uuid := _require_user();
begin
  return jsonb_build_object(
    'notifications', (select count(*) from notifications where user_id = me and read_at is null),
    'messages', (select count(*) from conversation_members cm join conversations c on c.id = cm.conversation_id
                 join messages m on m.conversation_id = cm.conversation_id
                 where cm.user_id = me and c.kind <> 'channel' and not cm.muted and m.created_at > cm.last_read_at
                   and m.sender_id is distinct from me and (m.sender_id is null or not _mutes(me, m.sender_id))),
    'mentions', (select count(*) from notifications where user_id = me and type = 'mention' and read_at is null),
    'friend_requests', (select count(*) from friendships where addressee_id = me and status = 'pending'),
    'party_invites', (select count(*) from party_invites where invitee_id = me and status = 'pending'),
    'open_reports', case when is_moderator(me) then (select count(*) from reports where status in ('open','in_review')) end,
    'calls', my_calls());
end $$;

-- =============================================================================
-- v3 privileges, realtime authorization for call signaling
-- =============================================================================
revoke all on public.voice_participants, public.tournaments, public.tournament_entrants, public.tournament_matches,
  public.tournament_agreements from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke execute on function public._room_ok(text, uuid), public._voice_people(text), public._tournament_host_stats(uuid),
  public._tournament_visible(public.tournaments, uuid), public._entrant_json(public.tournament_entrants),
  public._tournament_summary(public.tournaments, uuid), public._tournament_in_scope(public.tournaments, text, uuid), public._tournament_notify(uuid, text, uuid, uuid[]), public._advance(bigint)
  from public, anon, authenticated;
do $$
declare fn text;
begin
  foreach fn in array array[
    'can_use_room(text)','voice_join(text)','voice_heartbeat(text,boolean,boolean,boolean,boolean)','voice_leave(text)',
    'voice_state(text)','my_calls()','get_counts()','tournament_agreement_version()',
    'create_tournament(text,text,timestamptz,integer,integer,text,text,text,text,text,numeric,text,text,jsonb,text,integer,text,uuid,integer)',
    'list_tournaments(text,text,text,integer,integer)','get_tournament(uuid)','register_tournament(uuid,text,uuid[],integer)',
    'withdraw_tournament(uuid)','start_tournament(uuid)','report_match(bigint,uuid,text)','dispute_match(bigint,text)',
    'cancel_tournament(uuid,text)','set_prize_status(uuid,text)','report_tournament(uuid,text,text)'
  ] loop
    execute format('revoke execute on function public.%s from public, anon', fn);
    execute format('grant execute on function public.%s to authenticated', fn);
  end loop;
end $$;

-- Private Realtime channels "call:<room>": only people allowed in the room may listen or send.
do $$
begin
  if exists (select 1 from pg_tables where schemaname = 'realtime' and tablename = 'messages') then
    execute 'drop policy if exists "partyup_call_read" on realtime.messages';
    execute 'drop policy if exists "partyup_call_write" on realtime.messages';
    execute $p$create policy "partyup_call_read" on realtime.messages for select to authenticated
               using (realtime.topic() like 'call:%' and public.can_use_room(substr(realtime.topic(), 6)))$p$;
    execute $p$create policy "partyup_call_write" on realtime.messages for insert to authenticated
               with check (realtime.topic() like 'call:%' and public.can_use_room(substr(realtime.topic(), 6)))$p$;
  end if;
end $$;


-- #############################################################################
-- v4: XP, LEVELS & DAILY QUESTS · GG ENDORSEMENTS · READY-TO-PLAY BEACONS
-- #############################################################################

-- XP is only ever granted by the server (triggers / functions below). Each award
-- has a unique (user, kind, ref) so the same action can't be farmed.
create table if not exists public.xp_events (
  id          bigint generated always as identity primary key,
  user_id     uuid not null references public.profiles(id) on delete cascade,
  kind        text not null,
  ref         text not null,
  amount      int not null check (amount between 0 and 1000),
  created_at  timestamptz not null default now(),
  unique (user_id, kind, ref)
);
create index if not exists xp_events_user_day_idx on public.xp_events (user_id, created_at desc);
alter table public.xp_events enable row level security;

create or replace function public._award(p_user uuid, p_kind text, p_ref text, p_amount int) returns void
language plpgsql security definer set search_path = public as $$
declare before_xp int; got int;
begin
  if p_user is null then return; end if;
  if exists (select 1 from profiles where id = p_user and (is_demo or is_banned)) then return; end if;
  insert into xp_events (user_id, kind, ref, amount) values (p_user, p_kind, left(p_ref, 120), p_amount)
  on conflict (user_id, kind, ref) do nothing;
  get diagnostics got = row_count;
  if got = 0 then return; end if;
  update profiles set xp = xp + p_amount where id = p_user returning xp - p_amount into before_xp;
  if _level(before_xp + p_amount) > _level(before_xp) then
    insert into notifications (user_id, type, data)
    values (p_user, 'level_up', jsonb_build_object('level', _level(before_xp + p_amount)));
  end if;
end $$;

create or replace function public._xp_on_party_member() returns trigger language plpgsql security definer set search_path = public as $$
begin perform _award(new.user_id, 'party_join', new.party_id::text, 30); return null; end $$;
drop trigger if exists trg_xp_party_member on public.party_members;
create trigger trg_xp_party_member after insert on public.party_members for each row execute function public._xp_on_party_member();

create or replace function public._xp_on_party() returns trigger language plpgsql security definer set search_path = public as $$
begin perform _award(new.leader_id, 'party_create', new.id::text, 40); return null; end $$;
drop trigger if exists trg_xp_party on public.parties;
create trigger trg_xp_party after insert on public.parties for each row execute function public._xp_on_party();

create or replace function public._xp_on_message() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.sender_id is not null then
    perform _award(new.sender_id, 'message', to_char(now() at time zone 'utc', 'YYYY-MM-DD') || ':' || new.conversation_id, 5);
  end if;
  return null;
end $$;
drop trigger if exists trg_xp_message on public.messages;
create trigger trg_xp_message after insert on public.messages for each row execute function public._xp_on_message();

create or replace function public._xp_on_friend() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'accepted' and (tg_op = 'INSERT' or old.status is distinct from 'accepted') then
    perform _award(new.requester_id, 'friend', new.addressee_id::text, 25);
    perform _award(new.addressee_id, 'friend', new.requester_id::text, 25);
  end if;
  return null;
end $$;
drop trigger if exists trg_xp_friend on public.friendships;
create trigger trg_xp_friend after insert or update on public.friendships for each row execute function public._xp_on_friend();

create or replace function public._xp_on_community() returns trigger language plpgsql security definer set search_path = public as $$
begin perform _award(new.user_id, 'community_join', new.community_id::text, 10); return null; end $$;
drop trigger if exists trg_xp_community on public.community_members;
create trigger trg_xp_community after insert on public.community_members for each row execute function public._xp_on_community();

create or replace function public._xp_on_voice() returns trigger language plpgsql security definer set search_path = public as $$
begin perform _award(new.user_id, 'voice', to_char(now() at time zone 'utc', 'YYYY-MM-DD') || ':' || new.room, 15); return null; end $$;
drop trigger if exists trg_xp_voice on public.voice_participants;
create trigger trg_xp_voice after insert on public.voice_participants for each row execute function public._xp_on_voice();

create or replace function public._xp_on_entrant() returns trigger language plpgsql security definer set search_path = public as $$
declare u uuid;
begin
  if tg_op = 'INSERT' then
    foreach u in array new.members loop perform _award(u, 'tournament_enter', new.tournament_id::text, 30); end loop;
  elsif new.final_place is distinct from old.final_place and new.final_place is not null then
    foreach u in array new.members loop
      perform _award(u, 'tournament_place', new.tournament_id::text, case new.final_place when 1 then 250 when 2 then 120 else 60 end);
    end loop;
  end if;
  return null;
end $$;
drop trigger if exists trg_xp_entrant on public.tournament_entrants;
create trigger trg_xp_entrant after insert or update on public.tournament_entrants for each row execute function public._xp_on_entrant();

-- -----------------------------------------------------------------------------
-- GG ENDORSEMENTS — only for people you actually partied with
-- -----------------------------------------------------------------------------
create table if not exists public.party_member_log (
  party_id   uuid not null references public.parties(id) on delete cascade,
  user_id    uuid not null references public.profiles(id) on delete cascade,
  joined_at  timestamptz not null default now(),
  primary key (party_id, user_id)
);
alter table public.party_member_log enable row level security;
insert into public.party_member_log (party_id, user_id, joined_at)
select party_id, user_id, joined_at from public.party_members on conflict do nothing;

create or replace function public._log_party_member() returns trigger language plpgsql security definer set search_path = public as $$
begin insert into party_member_log (party_id, user_id) values (new.party_id, new.user_id) on conflict do nothing; return null; end $$;
drop trigger if exists trg_log_party_member on public.party_members;
create trigger trg_log_party_member after insert on public.party_members for each row execute function public._log_party_member();

create table if not exists public.endorsements (
  id          bigint generated always as identity primary key,
  giver_id    uuid not null references public.profiles(id) on delete cascade,
  receiver_id uuid not null references public.profiles(id) on delete cascade,
  party_id    uuid not null references public.parties(id) on delete cascade,
  kind        text not null check (kind in ('great_comms','clutch','positive','shotcaller','teamplayer','chill')),
  created_at  timestamptz not null default now(),
  unique (giver_id, receiver_id, party_id),
  check (giver_id <> receiver_id)
);
create index if not exists endorsements_receiver_idx on public.endorsements (receiver_id);
alter table public.endorsements enable row level security;

create or replace function public._endorsement_summary(p_user uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('total', (select count(*) from endorsements where receiver_id = p_user),
    'by_kind', coalesce((select jsonb_object_agg(kind, n) from (select kind, count(*) n from endorsements where receiver_id = p_user group by kind) k), '{}'::jsonb))
$$;

create or replace function public.endorse(p_user uuid, p_party uuid, p_kind text) returns void
language plpgsql security definer set search_path = public as $$
declare me uuid := _require_active();
begin
  if p_user = me then raise exception 'You can''t endorse yourself.'; end if;
  if p_kind not in ('great_comms','clutch','positive','shotcaller','teamplayer','chill') then raise exception 'Pick an endorsement.'; end if;
  if not exists (select 1 from party_member_log where party_id = p_party and user_id = me)
     or not exists (select 1 from party_member_log where party_id = p_party and user_id = p_user) then
    raise exception 'You can only endorse people you partied with.';
  end if;
  if _blocked(me, p_user) then raise exception 'You can''t endorse this player.'; end if;
  perform _rate_limit('endorse', 30, interval '1 day', 'endorsements');
  begin
    insert into endorsements (giver_id, receiver_id, party_id, kind) values (me, p_user, p_party, p_kind);
  exception when unique_violation then raise exception 'You already endorsed them for this party.';
  end;
  perform _award(me, 'endorse_give', p_user::text || ':' || p_party::text, 10);
  perform _award(p_user, 'endorsed', me::text || ':' || p_party::text, 15);
  perform _notify(p_user, 'endorsed', me, p_party, null, jsonb_build_object('kind', p_kind));
end $$;

-- Recent teammates you haven't endorsed yet (last 14 days of parties)
create or replace function public.endorsable_teammates() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(x order by x ->> 'joined_at' desc), '[]'::jsonb) from (
    select jsonb_build_object('party_id', p.id, 'party_title', p.title, 'game_id', p.game_id, 'joined_at', greatest(mine.joined_at, them.joined_at),
                              'user', _card(them.user_id)) x
    from party_member_log mine
    join party_member_log them on them.party_id = mine.party_id and them.user_id <> mine.user_id
    join parties p on p.id = mine.party_id
    where mine.user_id = auth.uid() and greatest(mine.joined_at, them.joined_at) > now() - interval '14 days'
      and not exists (select 1 from endorsements e where e.giver_id = auth.uid() and e.receiver_id = them.user_id and e.party_id = p.id)
      and _card(them.user_id) is not null and not _blocked(auth.uid(), them.user_id)
    order by greatest(mine.joined_at, them.joined_at) desc limit 12) q
$$;

-- -----------------------------------------------------------------------------
-- READY-TO-PLAY BEACON — "I'm free for the next N minutes for <game>"
-- -----------------------------------------------------------------------------
create or replace function public.set_beacon(p_game text, p_minutes int default 60, p_note text default '') returns void
language plpgsql security definer set search_path = public as $$
declare me uuid := _require_active(); was_on boolean; f uuid;
begin
  if not exists (select 1 from games where id = p_game and is_active) then raise exception 'Pick a game.'; end if;
  if coalesce(p_minutes, 0) not between 15 and 240 then raise exception 'Beacons last 15 minutes to 4 hours.'; end if;
  perform _rate_limit('beacon', 12, interval '1 day', 'beacons');
  select beacon_until > now() into was_on from profiles where id = me;
  update profiles set beacon_game = p_game, beacon_until = now() + make_interval(mins => p_minutes),
    beacon_note = left(btrim(coalesce(p_note, '')), 80) where id = me;
  perform _award(me, 'beacon', to_char(now() at time zone 'utc', 'YYYY-MM-DD'), 10);
  -- Tell friends who play that game (once per beacon, not on extensions)
  if not coalesce(was_on, false) then
    for f in select case when fr.requester_id = me then fr.addressee_id else fr.requester_id end
             from friendships fr where fr.status = 'accepted' and me in (fr.requester_id, fr.addressee_id) loop
      if exists (select 1 from user_game_profiles g where g.user_id = f and g.game_id = p_game) then
        perform _notify(f, 'beacon', me, null, null, jsonb_build_object('game', p_game,
          'game_name', (select name from games where id = p_game), 'note', left(btrim(coalesce(p_note, '')), 80), 'minutes', p_minutes));
      end if;
    end loop;
  end if;
end $$;

create or replace function public.clear_beacon() returns void
language sql security definer set search_path = public as $$
  update profiles set beacon_until = null where id = auth.uid()
$$;

create or replace function public.list_beacons(p_game text default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare me uuid := _require_user(); v profiles;
begin
  select * into v from profiles where id = me;
  return coalesce((select jsonb_agg(x order by (x ->> 'is_friend')::boolean desc, coalesce((x -> 'compatibility' ->> 'score')::int, 0) desc, x ->> 'until')
    from (
      select _card(pp.id) || jsonb_build_object('game_id', pp.beacon_game, 'until', pp.beacon_until, 'note', pp.beacon_note,
               'is_friend', _are_friends(me, pp.id),
               'game', (select jsonb_build_object('id', g.id, 'name', g.name, 'short_name', g.short_name, 'accent_color', g.accent_color, 'genre', g.genre) from games g where g.id = pp.beacon_game),
               'compatibility', case when exists (select 1 from user_game_profiles g where g.user_id = me and g.game_id = pp.beacon_game)
                                     then _compat(me, pp.id, pp.beacon_game) end) x
      from public_profiles pp
      where pp.beacon_game is not null and pp.id <> me
        and (p_game is null or pp.beacon_game = p_game)
        and (v.show_demo_players or not pp.is_demo)
      limit 60) q), '[]'::jsonb);
end $$;

-- -----------------------------------------------------------------------------
-- DAILY QUESTS — 3 per day for everyone, picked from the pool by date
-- -----------------------------------------------------------------------------
create or replace function public._quest_pool() returns jsonb language sql immutable as $$
  select '[
    {"id":"party_join","kind":"party_join","target":1,"label":"Join a party","xp":50},
    {"id":"chat_3","kind":"message","target":3,"label":"Chat in 3 different conversations","xp":40},
    {"id":"endorse_2","kind":"endorse_give","target":2,"label":"Give 2 GG endorsements","xp":60},
    {"id":"voice","kind":"voice","target":1,"label":"Hop into a voice channel or call","xp":50},
    {"id":"friend","kind":"friend","target":1,"label":"Make a new friend","xp":50},
    {"id":"community","kind":"community_join","target":1,"label":"Join a community","xp":40},
    {"id":"beacon","kind":"beacon","target":1,"label":"Light your Ready beacon","xp":30},
    {"id":"host","kind":"party_create","target":1,"label":"Host a party","xp":60}
  ]'::jsonb
$$;

create or replace function public._todays_quests() returns jsonb language sql stable as $$
  select coalesce(jsonb_agg(q order by o), '[]'::jsonb) from (
    select q, row_number() over (order by md5(to_char(now() at time zone 'utc', 'YYYY-MM-DD') || (q ->> 'id'))) o
    from jsonb_array_elements(public._quest_pool()) q) z where o <= 3
$$;

create or replace function public.my_progress() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare me uuid := _require_user(); x int; lvl int; day text := to_char(now() at time zone 'utc', 'YYYY-MM-DD');
begin
  select xp into x from profiles where id = me;
  lvl := _level(x);
  return jsonb_build_object('xp', x, 'level', lvl,
    'level_floor', 50 * (lvl - 1) * (lvl - 1), 'next_level_at', 50 * lvl * lvl,
    'day', day,
    'quests', coalesce((select jsonb_agg(q || jsonb_build_object(
        'progress', least((q ->> 'target')::int, (select count(*) from xp_events e where e.user_id = me and e.kind = q ->> 'kind'
                                                    and e.created_at >= (date_trunc('day', now() at time zone 'utc') at time zone 'utc'))::int),
        'claimed', exists (select 1 from xp_events e where e.user_id = me and e.kind = 'quest' and e.ref = day || ':' || (q ->> 'id'))))
      from jsonb_array_elements(_todays_quests()) q), '[]'::jsonb),
    'recent', coalesce((select jsonb_agg(jsonb_build_object('kind', kind, 'amount', amount, 'at', created_at) order by created_at desc)
      from (select * from xp_events where user_id = me order by created_at desc limit 8) r), '[]'::jsonb));
end $$;

create or replace function public.claim_quest(p_quest text) returns int
language plpgsql security definer set search_path = public as $$
declare me uuid := _require_active(); q jsonb; day text := to_char(now() at time zone 'utc', 'YYYY-MM-DD'); n int;
begin
  select x into q from jsonb_array_elements(_todays_quests()) x where x ->> 'id' = p_quest;
  if q is null then raise exception 'That quest isn''t available today.'; end if;
  select count(*) into n from xp_events e where e.user_id = me and e.kind = q ->> 'kind'
    and e.created_at >= (date_trunc('day', now() at time zone 'utc') at time zone 'utc');
  if n < (q ->> 'target')::int then raise exception 'Finish the quest first (% of %).', n, q ->> 'target'; end if;
  if exists (select 1 from xp_events where user_id = me and kind = 'quest' and ref = day || ':' || p_quest) then raise exception 'Already claimed.'; end if;
  perform _award(me, 'quest', day || ':' || p_quest, (q ->> 'xp')::int);
  return (q ->> 'xp')::int;
end $$;

-- Leaderboard: top players by XP (optionally among your friends)
create or replace function public.leaderboard(p_scope text default 'global') returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare me uuid := _require_user(); v profiles;
begin
  select * into v from profiles where id = me;
  return coalesce((select jsonb_agg(_card(pp.id) || jsonb_build_object('xp', pp.xp, 'rank', r) order by r) from (
      select pp.*, row_number() over (order by pp.xp desc, pp.created_at) r from public_profiles pp
      where pp.xp > 0 and (v.show_demo_players or not pp.is_demo)
        and (p_scope <> 'friends' or pp.id = me or _are_friends(me, pp.id))
      order by pp.xp desc limit 50) pp), '[]'::jsonb);
end $$;

-- Achievements now include endorsements, levels and tournaments
create or replace function public._achievements(p_user uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  with s as (
    select p.stat_parties_created c, p.stat_parties_joined j, p.created_at, p.xp,
      (select count(*) from friendships f where f.status = 'accepted' and p_user in (f.requester_id, f.addressee_id)) fr,
      (select count(*) from user_game_profiles g where g.user_id = p_user) gp,
      (select count(*) from endorsements e where e.receiver_id = p_user) en,
      (select count(*) from tournament_entrants e where p_user = any(e.members) and e.final_place = 1) wins,
      (p.region is not null and cardinality(p.languages) > 0 and cardinality(p.availability) > 0 and p.mic_preference is not null and p.bio <> '') complete
    from profiles p where p.id = p_user
  )
  select coalesce(jsonb_agg(a) filter (where (a ->> 'earned')::boolean), '[]'::jsonb) from s,
  lateral (values
    (jsonb_build_object('key','party_starter','label','Party Starter','description','Created a party','earned', s.c >= 1)),
    (jsonb_build_object('key','squad_builder','label','Squad Builder','description','Created 10 parties','earned', s.c >= 10)),
    (jsonb_build_object('key','team_player','label','Team Player','description','Joined 5 parties','earned', s.j >= 5)),
    (jsonb_build_object('key','social','label','Social','description','Has 5 friends','earned', s.fr >= 5)),
    (jsonb_build_object('key','well_connected','label','Well Connected','description','Has 25 friends','earned', s.fr >= 25)),
    (jsonb_build_object('key','multi_gamer','label','Multi-Gamer','description','Plays 3+ games','earned', s.gp >= 3)),
    (jsonb_build_object('key','profile_pro','label','Profile Pro','description','Completed every profile section','earned', s.complete)),
    (jsonb_build_object('key','good_teammate','label','Good Teammate','description','Received 10 GG endorsements','earned', s.en >= 10)),
    (jsonb_build_object('key','fan_favourite','label','Fan Favourite','description','Received 50 GG endorsements','earned', s.en >= 50)),
    (jsonb_build_object('key','level_10','label','Double Digits','description','Reached level 10','earned', public._level(s.xp) >= 10)),
    (jsonb_build_object('key','champion','label','Champion','description','Won a tournament','earned', s.wins >= 1)),
    (jsonb_build_object('key','veteran','label','Veteran','description','Member for a year','earned', s.created_at < now() - interval '1 year'))
  ) v(a)
$$;

revoke all on public.xp_events, public.party_member_log, public.endorsements from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke execute on function public._award(uuid, text, text, integer), public._endorsement_summary(uuid), public._quest_pool(), public._todays_quests()
  from public, anon, authenticated;
do $$
declare fn text;
begin
  foreach fn in array array[
    'endorse(uuid,uuid,text)','endorsable_teammates()','set_beacon(text,integer,text)','clear_beacon()','list_beacons(text)',
    'my_progress()','claim_quest(text)','leaderboard(text)','_level(integer)'
  ] loop
    execute format('revoke execute on function public.%s from public, anon', fn);
    execute format('grant execute on function public.%s to authenticated', fn);
  end loop;
end $$;

-- Pin search_path on every remaining PartyUp function (Supabase security advisor 0011).
do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prokind = 'f' and p.proconfig is null
      and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
  loop
    execute format('alter function %s set search_path = public', r.sig);
  end loop;
end $$;
