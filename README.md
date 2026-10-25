# PartyUp

<img src="build/icon.png" width="72" alt="PartyUp icon" align="right" />

Find teammates who play your game, at your rank, in your language, on your schedule.
PartyUp is a React + Supabase app (web and desktop) with real accounts, per-game profiles,
compatibility-scored player discovery, parties with open slots, Discord-style communities
with channels, direct and group messages, notifications, and safety tools (block, mute,
report, moderator queue).

**Download:** Windows, macOS and Linux installers are on the [Releases page](../../releases).

Nothing in the app is faked: there are no invented live player counts, no "verified" ranks,
and no connected game accounts. Ranks are labelled **self-reported** everywhere.

---

## Quick start

### 1. Create a Supabase project
Sign up at [supabase.com](https://supabase.com) and create a project (the free tier works).

### 2. Run the database setup
Open **SQL Editor → New query**, paste the contents of [`supabase/schema.sql`](supabase/schema.sql), and run it.
This creates every table, constraint, index, Row Level Security policy, server function,
the Realtime publication entries and the `avatars` storage bucket, and loads the game catalog.
The script is safe to run again after edits.

Optional: run [`supabase/seed_demo.sql`](supabase/seed_demo.sql) to add 28 **demo** players,
8 demo parties and 3 demo communities so discovery has something to show during development. See [Demo data](#demo-data).

### 3. Configure auth
- **Authentication → URL Configuration**: set *Site URL* to where the app runs (e.g. `http://localhost:5173`)
  and add the same URL to *Redirect URLs*. Confirmation and password-reset emails return there.
- **Authentication → Providers → Email**: email sign-up is on by default. If "Confirm email" is on,
  new users must click the link before signing in (the app tells them so).
- Supabase's built-in email sender is rate-limited; add your own SMTP under
  **Authentication → Emails** before launch.

### 4. Add your keys and run
```bash
cp .env.example .env.local      # then fill in the two values
npm install
npm run dev                     # http://localhost:5173
```
Use the **anon / publishable** key from **Project Settings → API**. The app refuses a
`service_role` or `sb_secret_…` key if you paste one — those bypass every security rule and must
never be shipped to browsers.

No `.env.local`? In development (`npm run dev`) the app opens a setup screen where you can paste
the URL and anon key for the current browser. Release builds never show that screen: they use the
project in `.env.production`.

### 5. Make yourself a moderator (optional)
Moderator access is never self-service. In the SQL Editor:
```sql
insert into public.user_roles (user_id, role)
select id, 'admin' from public.profiles where username = 'YourUsername';
-- use 'moderator' instead of 'admin' for moderators who must not ban accounts
```
Reload the app; **Moderation** appears in the sidebar.

### Desktop app
Installers for every release are built by GitHub Actions and attached to the
[Releases page](../../releases). To build one locally:
```bash
npm install
npm run desktop   # run the desktop app from source
npm run dist      # build an installer for your OS into release/
```
Release builds connect to the project in `.env.production` (public URL + publishable key; the
release workflow fails if they're missing). The desktop app registers the `partyup://` link
scheme: Google sign-in opens in the user's browser and returns to the app through
`partyup://auth-callback`, and email confirmation / password-reset links do the same. Community
invite links shared from the desktop app look like `partyup://invite/CODE`.
Bump `version` in package.json on main to publish a new release.

### Email templates
Branded templates (welcome email with a big verification code + a one-click button, password
reset, email change) are in `supabase/email-templates/` — paste them into **Authentication →
Emails → Templates**. Supabase's built-in mailer only delivers to your own team's addresses, so add
a custom SMTP sender (Authentication → Emails → SMTP Settings) before launching to the public.

### Watch (Twitch & YouTube)
Listings come from the `media` Edge Function (`supabase/functions/media`), which caches results in
`media_cache` so API keys stay on the server and quota is shared. Add these secrets in Supabase →
Edge Functions → Secrets: `TWITCH_CLIENT_ID`, `TWITCH_CLIENT_SECRET` (dev.twitch.tv → Console →
Register Your Application) and `YOUTUBE_API_KEY` (Google Cloud → enable "YouTube Data API v3" →
Credentials → API key). Either platform can be left out.

### Calls
Voice/video calls are peer-to-peer WebRTC with signaling over private Supabase Realtime channels
(authorized by policies on `realtime.messages`). Public STUN servers are used by default. Some
strict networks need a TURN relay — set `VITE_TURN_URLS`, `VITE_TURN_USERNAME` and
`VITE_TURN_CREDENTIAL` at build time to add one.

### Supabase Auth settings for release builds
In **Authentication → URL Configuration**: set **Site URL** to `partyup://auth-callback` and add
`partyup://**` (plus `http://localhost:5173/**` for development, and your web host if you deploy
one) to **Redirect URLs**.

**Google sign-in:** create an OAuth client (type *Web application*) in Google Cloud Console →
APIs & Services → Credentials, with authorized redirect URI
`https://<project-ref>.supabase.co/auth/v1/callback`. Paste its client ID and secret into
**Authentication → Sign In / Providers → Google** and enable it. The Google button appears in the
app automatically once the provider is on — no new release needed.

Installers aren't code-signed: Windows SmartScreen and macOS Gatekeeper will warn on first
launch. Add signing certificates to electron-builder when you're ready to distribute widely.

### Build and deploy
```bash
npm run build      # outputs dist/
```
`dist/` is a static site (hash-based routing, relative asset paths), so it runs on Vercel,
Netlify, Cloudflare Pages, GitHub Pages or any static host without rewrite rules. Set
`VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` in the host's build environment, and add the
deployed URL to Supabase's redirect URLs.

---

## What's in the app

| Area | What works |
|---|---|
| Calls | DM / group / party calls with ringing, community voice channels, camera, screen share, mute/deafen, speaking indicators |
| Tournaments | Single-elimination brackets, teams up to 6, custom prize pools and splits, captain reporting + confirmation, disputes, payout tracking, host records, Tournament Agreement, reports |
| Auth | Sign up, sign in, Google sign-in (web and desktop), email codes, sign out, password reset by email, change email/password, delete account (typed confirmation) |
| Onboarding | Username (live availability check), avatar (12 presets or upload), region, languages, platforms, games with rank/role/platform, weekly schedule, mic, playstyle, teammate preferences. Every step after the username can be skipped and edited later |
| Dashboard | Recommended teammates, your parties, suggested sessions, incoming party invites, friend requests, friends online, recent activity, profile-completion prompts, Find Teammates + Quick Match |
| Find Players | Filters: game, rank range (per game), role, region, platform, language, mic, playstyle, availability (any / overlaps mine / usually plays now), online now, username search. Sort by best match, most active, recently online. Load more. Empty states name the filters to relax |
| Compatibility | Calculated in Postgres from real profile data, with a factor-by-factor breakdown in the UI (see below) |
| Quick Match | Best players (60+) and open parties for one game; when there are none it shows the player pool narrowing step by step and concrete tips instead of filler |
| Profiles | Bio, games with self-reported ranks, roles, modes, sessions, playtimes (overlap highlighted against yours), languages, platforms, teammate preferences, achievements earned from real activity, self-reported highlights. Add Friend, Message, Invite to Party, Mute, Block, Report |
| Game Profiles | One profile per game: platform, rank, experience, main + secondary roles, modes, session length, playstyle, looking for, notes, visibility |
| Parties | Create with game, size (capped per game), needed roles, casual/competitive, min/max rank, language, region, platform, mic required, public/invite-only, planned start. Join requests with role + message, accept/decline, invites, remove member, transfer leadership, leave, close, edit. Open / Full / Closed status. Capacity enforced in the database with row locks |
| Friends | Add by username, requests, accept/decline/cancel, friends list with online status, remove, block. Custom status text |
| Communities | Public or private servers with text and announcement channels, Explore page, invite codes with expiry/use limits, owner/admin/member roles, transfer ownership, kick, ban/unban, create/rename/reorder/delete channels, member list with online status, per-channel unread and mention badges on the server rail |
| Messages | Direct messages, group DMs (up to 10 friends: rename, add, remove, leave), party chat and channels. Replies, reactions, edit (Up arrow edits your last message), delete, pins, search, @mention autocomplete and notifications, typing indicator, "New" unread divider, Markdown (bold, italic, strike, code, code blocks, spoilers, links), profile cards on click, per-conversation mute, report a message, muted/blocked senders hidden |
| Notifications | Friend requests, accepted requests, party invites, join requests, request results, removals, leadership changes, closed parties, new messages (collapsed per conversation), moderation notices. Bell with unread count, mark read, preferences |
| Safety | Block (hides you both ways and cuts every contact path), mute, report (6 categories, message snapshot, optional block), privacy controls per profile field, contact controls for friend requests / invites / DMs, rate limits |
| Moderation | Queue by status, report detail with message snapshot, reported account, other reports and action history; warn, remove content, suspend (1–365 days), ban (admins only); every action logged; reporters notified without details |

---

## How compatibility works

Each factor has a weight. The score is the points earned divided by the weights of the factors
that apply, times 100 — so missing information counts as neutral rather than as a mismatch.
Hidden profile fields are treated as unknown, so privacy settings can't be inferred from scores.

| Factor | Weight | Full points when |
|---|---|---|
| Shared game | 15 | You both list the game (or share your games when no game is selected) |
| Rank | 0–20, **per game** (`games.rank_weight`) | Same rank; falls off over `games.rank_tolerance` tiers. Valorant/CS2/LoL 20, Fortnite 8, Minecraft 0 (no ranks) |
| Role fit | 12 | Their main role differs from yours (complementary) |
| Platform | 10 | Same platform for that game |
| Language | 12 | You share a language |
| Region | 10 | Same region (nearby regions get partial credit) |
| Playtime overlap | 15 | Your weekly schedules overlap |
| Voice chat | 8 | Each of you meets the other's mic expectations |
| Playstyle | 10 | Same casual/competitive intent and similar playstyle tags |

Labels: 80+ great, 65+ good, 50+ fair. The UI always says it's an estimate, not a guarantee.
Party fit uses the same approach against party requirements (game, rank range, needed roles,
language, region, platform, play type, mic).

The logic lives in `_compat`, `_best_compat` and `_party_score` in `schema.sql`. Scores are
computed per request, which is comfortable into the low thousands of active profiles; beyond
that, pre-filter candidates harder or cache scores in a table.

---

## Security model

- **RLS on every table.** Users can read their own `profiles` row only; everyone else is seen
  through `public_profiles`, a view that masks fields according to each user's privacy settings,
  hides banned users, hides people in a block relationship with you, and has no email column.
- **Least-privilege grants.** Supabase's default "API roles can do everything, RLS decides" grants
  are revoked and replaced: e.g. users may only `UPDATE` listed columns of their own profile,
  so they can't flip `is_banned`, `is_demo`, `suspended_until` or stats; notifications only allow
  updating `read_at`.
- **Server functions for anything multi-user.** Parties, invites, join requests, friendships,
  blocks, messages, reports and moderation are `SECURITY DEFINER` functions that check
  `auth.uid()`, leadership, membership, blocks, privacy settings, suspension, capacity and rate
  limits before writing. Direct writes to those tables are denied.
- **Party capacity** is enforced by a trigger that locks the party row, so two simultaneous
  accepts can't overfill a party (covered by a concurrency test).
- **Moderator tools** check `user_roles` on the server for every call; roles can only be granted in SQL.
- **Spam protection:** per-user rate limits on messages (8 per 10 s, 80 per 5 min), duplicate
  messages, friend requests, invites, join requests, new conversations, party creation and reports.
- **Realtime** streams `messages`, `notifications`, `parties`, `party_members`,
  `party_join_requests` and `friendships`; Supabase Realtime applies the same RLS select
  policies to each event.
- Only the public anon key is used client-side. No secret ever ships in the bundle.

## Realtime and its fallback
Chats and notifications subscribe through Supabase Realtime. If the connection can't be
established, the chat header says **"Updating every few seconds"** and the app polls the
database (every 4 s for an open chat, 15 s for counts) — messages still arrive, just with a
short delay. When Realtime connects the header shows **Live**.

## Games
53 games ship in the catalog, grouped by genre: shooters (Valorant, Counter-Strike 2, Overwatch 2,
Marvel Rivals, Rainbow Six Siege, Call of Duty, Halo Infinite, The Finals, Battlefield 6,
Destiny 2, Splatoon 3), MOBAs (League of Legends, Dota 2, Deadlock, Mobile Legends, Pokémon UNITE,
Brawl Stars), battle royale (Apex Legends, Fortnite, PUBG, PUBG Mobile, Free Fire), extraction
(Escape from Tarkov, ARC Raiders), co-op (Helldivers 2, Deep Rock Galactic, Monster Hunter Wilds,
Warframe, Lethal Company, Phasmophobia, Sea of Thieves), plus survival, sandbox, MMO, ARPG,
fighting, sports, racing and party games. Rank ladders are stored as editable tier labels.

## Adding a game
Games are rows, not code:
```sql
insert into public.games (id, name, short_name, accent_color, platforms, roles, modes, ranks, rank_weight, rank_tolerance, max_party_size, sort_order)
values ('helldivers-2', 'Helldivers 2', 'HD2', '#f5c518', '{pc,playstation,xbox}',
        '{Assault,Support,Anti-Tank,Scout}', '{Operations,Defense}', '{}', 0, 2, 4, 130);
```
Rank lists are ordered lowest → highest. Edit tiers whenever a game changes its ladder; set
`is_active = false` to retire a game.

## Demo data
`seed_demo.sql` creates clearly separated sample data:
- every row is flagged `is_demo = true` (set through `raw_app_meta_data`, which users can't edit);
- demo accounts have no password, so nobody can sign in as them, and use `@partyup.invalid` emails;
- they never appear online (last activity is always at least an hour old);
- they're shown with a **Demo** badge, and each user can hide them in **Settings → Privacy**;
- messages and requests to them are saved but never answered (the UI says so).

Remove all of it at any time with [`supabase/remove_demo.sql`](supabase/remove_demo.sql). Real accounts are untouched.

---

## Project structure
```
desktop/main.cjs      Electron shell for the desktop app
build/icon.svg        app icon source (icon.png is generated from it)
.github/workflows/    CI tests and the installer release pipeline
supabase/
  schema.sql          tables, RLS, grants, server functions, realtime, storage, game catalog
  seed_demo.sql       optional demo players and parties (generated by tests/gen_seed.py)
  remove_demo.sql     deletes demo data only
src/
  lib/                supabase client + key checks, API layer, router, constants, availability math
  context/            session, profile, unread counts, realtime notification stream
  components/         design system (ui.jsx, feedback.jsx), gaming widgets, cards, chat, forms
  pages/              one file per screen
  styles.css          design tokens and all styles
tests/                database and end-to-end tests (see below)
```

## Tests
GitHub Actions runs every test below on each push (see `.github/workflows/ci.yml`).

`tests/db_tests.py` runs `schema.sql` and the seed on a local PostgreSQL that emulates Supabase's
`auth.uid()` and API roles (`tests/supabase_stub.sql`), then checks 45 security and flow cases as
different users: RLS isolation, column grants, privacy masking (including that filters can't reveal
hidden fields), validation, scoring, party permissions and capacity under concurrency, invites,
blocks across every contact path, message access, rate limits, notification preferences,
moderator-only access, suspension, content removal and account deletion — plus communities
(roles, kicks, bans, invites with limits and expiry, announcement channels, channel sync),
replies, edits, deletes, reactions, pins, search, typing, muting and group DMs (63 checks).

`tests/e2e.py` drives the real UI with Playwright: two users sign up and onboard (one on a
phone-sized screen), discover each other, request/accept a party slot, chat, DM, accept a friend
request from the bell, transfer leadership, edit a game profile, report, moderate, change privacy,
block, delete an account, and sweep 16 routes for mobile overflow. `tests/e2e_social.py` covers
the Discord-style features: joining from Explore, reply/react/edit/delete, a private community
joined by pasted invite link, @mention autocomplete and typing indicator, admin promotion,
channel creation, pins and search, a three-person group DM across desktop and phone, custom
status and muting. It runs the app bundle against
`tests/test_server.mjs`, a small stand-in for Supabase's REST/auth API that executes every request
on that Postgres as the signed-in user, so RLS is enforced. Realtime is reported unavailable there
on purpose, which exercises the polling fallback.

```bash
./tests/reset_db.sh --seed && python3 tests/db_tests.py
```
