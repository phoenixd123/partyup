"""Generates supabase/seed_demo.sql — clearly-labelled DEMO data for development.

Demo accounts:
  * have is_demo = true (set via raw_app_meta_data, which users cannot edit)
  * have no password, so nobody can sign in as them
  * use @partyup.invalid emails (a reserved, non-routable domain)
  * are shown with a "Demo" badge in the app and can be hidden in Settings
  * never appear online (last_seen is always at least an hour in the past)
Remove everything with supabase/remove_demo.sql.
"""
import json, random

random.seed(42)

REGION_UTC = {"na-east": -4, "na-central": -5, "na-west": -7, "sa": -3, "eu-west": 1, "eu-central": 2,
              "eu-east": 3, "me": 3, "asia-east": 9, "asia-se": 8, "oce": 10, "asia-south": 5}

# (username, region, languages, platforms, mic, playstyles, traits, pref_mic, looking_for, bio, schedule, games)
# schedule: list of (days, start_hour_local, end_hour_local); days 0=Mon..6=Sun
# games: list of (game_id, platform, rank, main, secondary, modes, experience, session, looking_for)
EVEN = [(0, 19, 23), (1, 19, 23), (2, 19, 23), (3, 19, 23), (4, 20, 24)]
WKND = [(5, 13, 23), (6, 13, 22)]
LATE = [(d, 21, 24) for d in range(7)] + [(d, 0, 2) for d in range(7)]
DAY = [(d, 10, 16) for d in range(5)]

PLAYERS = [
 ("NovaStrike", "na-east", ["en"], ["pc"], "always", ["competitive", "communicative"], ["good_comms", "competitive"], "required", "competitive",
  "Diamond duelist grinding to Ascendant. Calm comms, no tilt.", EVEN + WKND,
  [("valorant", "pc", "Diamond", "Duelist", ["Initiator"], ["Competitive", "Premier"], "ranked", "2_4h", "competitive")]),
 ("LunaHeals", "na-east", ["en", "es"], ["pc", "playstation"], "usually", ["supportive", "chill"], ["positive", "patient"], "preferred", "both",
  "Support main. I keep everyone alive and the vibes good.", EVEN,
  [("overwatch-2", "pc", "Platinum", "Support", ["Tank"], ["Competitive Role Queue", "Quick Play"], "ranked", "1_2h", "both"),
   ("marvel-rivals", "playstation", "Gold", "Strategist", [], ["Quick Match", "Competitive"], "casual", "1_2h", "casual")]),
 ("FragTheory", "eu-west", ["en", "fr"], ["pc"], "always", ["strategic", "shotcaller"], ["follows_calls", "good_comms"], "required", "competitive",
  "IGL looking for a consistent five-stack for Premier.", EVEN + WKND,
  [("cs2", "pc", "Premier 15k–20k", "In-Game Leader", ["Rifler"], ["Premier", "Third-party leagues"], "tournament", "2_4h", "competitive")]),
 ("Mochi_IGL", "asia-east", ["ja", "en"], ["pc"], "usually", ["strategic", "communicative"], ["good_comms", "consistent_schedule"], "preferred", "competitive",
  "Shotcaller for weekend scrims. JP/EN.", WKND + LATE[:4],
  [("valorant", "pc", "Ascendant", "Controller", ["Sentinel"], ["Competitive", "Premier"], "tournament", "2_4h", "competitive"),
   ("league-of-legends", "pc", "Emerald", "Mid", ["Support"], ["Ranked Flex"], "ranked", "1_2h", "both")]),
 ("quietcarry", "na-west", ["en"], ["pc"], "sometimes", ["chill", "flexible"], ["chill", "positive"], "any", "casual",
  "Mostly text chat. Happy to play whatever the team needs.", LATE,
  [("deadlock", "pc", "Archon", "Carry", ["Flex"], ["Standard"], "casual", "2_4h", "both"),
   ("apex-legends", "pc", "Gold", "Recon", ["Support"], ["Trios"], "casual", "1_2h", "casual")]),
 ("TiltProof", "na-central", ["en"], ["xbox", "pc"], "always", ["competitive", "grinder"], ["competitive", "has_mic"], "required", "competitive",
  "Ranked grinder. If you can stay positive after a loss, we'll get along.", EVEN + WKND,
  [("call-of-duty", "xbox", "Diamond", "Slayer", ["Objective"], ["Ranked Play", "Warzone"], "ranked", "2_4h", "competitive"),
   ("rocket-league", "xbox", "Champion", "Striker", ["Midfield"], ["Ranked 3v3", "Ranked 2v2"], "ranked", "1_2h", "competitive")]),
 ("ByteKnight", "eu-central", ["de", "en"], ["pc"], "always", ["strategic", "supportive"], ["good_comms", "follows_calls"], "required", "competitive",
  "Anchor player, love the slow strategic rounds.", EVEN,
  [("rainbow-six-siege", "pc", "Emerald", "Anchor", ["Support"], ["Ranked"], "ranked", "2_4h", "competitive"),
   ("cs2", "pc", "Premier 10k–15k", "Support", ["Lurker"], ["Premier", "Wingman"], "ranked", "1_2h", "both")]),
 ("SableRush", "eu-west", ["en", "pt"], ["playstation"], "usually", ["aggressive", "competitive"], ["competitive"], "preferred", "competitive",
  "Entry on R6, duelist everywhere else.", EVEN + WKND,
  [("rainbow-six-siege", "playstation", "Platinum", "Entry Fragger", ["Flex"], ["Ranked", "Quick Match"], "ranked", "2_4h", "competitive"),
   ("valorant", "playstation", "Gold", "Duelist", [], ["Competitive", "Swiftplay"], "casual", "1_2h", "both")]),
 ("KiraSupports", "oce", ["en"], ["pc"], "always", ["supportive", "communicative"], ["positive", "beginner_friendly"], "preferred", "both",
  "Happy to help newer players learn. OCE evenings.", EVEN + WKND,
  [("league-of-legends", "pc", "Platinum", "Support", ["Jungle"], ["Ranked Flex", "Normal Draft", "ARAM"], "ranked", "1_2h", "both"),
   ("overwatch-2", "pc", "Gold", "Support", [], ["Quick Play"], "casual", "1_2h", "casual")]),
 ("OrbitDrift", "na-east", ["en"], ["switch", "pc"], "sometimes", ["chill", "learning"], ["patient", "chill"], "any", "casual",
  "Learning ranked Rocket League, mostly here for fun.", WKND,
  [("rocket-league", "switch", "Gold", "Midfield", ["Goalkeeper"], ["Ranked 2v2", "Casual"], "casual", "1_2h", "casual"),
   ("fortnite", "switch", "Silver", "Builder", ["Support"], ["Zero Build", "Reload"], "casual", "1_2h", "casual")]),
 ("GhostPeak", "na-west", ["en", "ko"], ["pc"], "always", ["aggressive", "competitive"], ["competitive", "good_comms"], "required", "competitive",
  "Apex pred last split. Looking for serious trios.", LATE + WKND,
  [("apex-legends", "pc", "Master", "Skirmisher", ["Assault"], ["Ranked"], "tournament", "4h_plus", "competitive"),
   ("valorant", "pc", "Immortal", "Duelist", ["Initiator"], ["Competitive"], "ranked", "2_4h", "competitive")]),
 ("ZenAnchor", "eu-east", ["pl", "en"], ["pc"], "usually", ["strategic", "chill"], ["patient", "follows_calls"], "preferred", "both",
  "Sentinel/anchor. I will hold that site forever.", EVEN,
  [("valorant", "pc", "Platinum", "Sentinel", ["Controller"], ["Competitive", "Unrated"], "ranked", "1_2h", "both"),
   ("rainbow-six-siege", "pc", "Gold", "Anchor", ["Roamer"], ["Standard", "Ranked"], "casual", "1_2h", "both")]),
 ("RookieRaccoon", "na-central", ["en"], ["playstation"], "sometimes", ["learning", "chill"], ["beginner_friendly", "patient"], "any", "casual",
  "New to shooters! Looking for patient people to learn with.", EVEN[:3] + WKND,
  [("marvel-rivals", "playstation", "Bronze", "Vanguard", ["Strategist"], ["Quick Match"], "new", "under_1h", "casual"),
   ("fortnite", "playstation", "Bronze", "Support", [], ["Battle Royale", "LEGO Fortnite"], "new", "1_2h", "casual")]),
 ("VelvetAim", "eu-west", ["en", "es"], ["pc"], "always", ["competitive", "communicative"], ["good_comms", "competitive"], "required", "competitive",
  "AWPer. EU West. Looking for a Premier team with regular practice.", EVEN + WKND,
  [("cs2", "pc", "Premier 20k–25k", "AWPer", ["Rifler"], ["Premier", "Third-party leagues"], "tournament", "2_4h", "competitive")]),
 ("CopperFox", "sa", ["pt", "es"], ["pc"], "usually", ["aggressive", "flexible"], ["positive"], "preferred", "both",
  "BR/LATAM, flex player.", LATE,
  [("valorant", "pc", "Silver", "Initiator", ["Duelist", "Controller"], ["Competitive", "Swiftplay"], "casual", "1_2h", "both"),
   ("cs2", "pc", "Premier 5k–10k", "Entry Fragger", ["Rifler"], ["Competitive", "Casual"], "casual", "1_2h", "both")]),
 ("HexWard", "na-east", ["en"], ["pc"], "always", ["strategic", "supportive"], ["good_comms", "shotcaller"], "required", "competitive",
  "Deadlock support. I call rotations and track souls.", EVEN + WKND,
  [("deadlock", "pc", "Oracle", "Support", ["Frontline"], ["Ranked", "Standard"], "ranked", "2_4h", "competitive"),
   ("league-of-legends", "pc", "Diamond", "Jungle", ["Top"], ["Ranked Solo/Duo", "Clash"], "ranked", "2_4h", "competitive")]),
 ("JunoJungle", "na-west", ["en", "tl"], ["pc"], "usually", ["aggressive", "shotcaller"], ["competitive", "follows_calls"], "preferred", "competitive",
  "Jungle main looking for a mid laner who pings.", LATE,
  [("league-of-legends", "pc", "Diamond", "Jungle", ["Mid"], ["Ranked Flex", "Clash"], "ranked", "2_4h", "competitive")]),
 ("AstraNoodle", "eu-central", ["de", "en"], ["pc", "playstation"], "usually", ["chill", "communicative"], ["positive", "chill"], "any", "both",
  "Controller main, smokes on point, jokes not so much.", EVEN + WKND,
  [("valorant", "pc", "Gold", "Controller", ["Sentinel"], ["Competitive", "Unrated"], "ranked", "1_2h", "both"),
   ("overwatch-2", "playstation", "Platinum", "Tank", ["Damage"], ["Competitive Role Queue"], "ranked", "1_2h", "both")]),
 ("RedstoneRae", "na-east", ["en"], ["pc"], "sometimes", ["chill", "strategic"], ["chill", "consistent_schedule"], "any", "casual",
  "Technical Minecraft builder. Running a small survival world.", EVEN + WKND,
  [("minecraft", "pc", None, "Redstoner", ["Builder", "Technical"], ["Survival", "Modded"], "casual", "4h_plus", "casual")]),
 ("BrickByBrick", "eu-west", ["en", "nl"], ["pc", "switch"], "text_only", ["chill", "learning"], ["chill", "patient"], "any", "casual",
  "Builder. Text chat only, but I'm friendly!", WKND + DAY[:2],
  [("minecraft", "pc", None, "Builder", ["Explorer"], ["Creative", "Survival"], "casual", "2_4h", "casual"),
   ("fortnite", "pc", None, "Builder", [], ["Creative", "LEGO Fortnite"], "casual", "1_2h", "casual")]),
 ("FlankCat", "na-central", ["en", "es"], ["pc"], "always", ["aggressive", "flexible"], ["competitive", "good_comms"], "preferred", "competitive",
  "Flank DPS on Rivals and OW. Can flex tank if needed.", EVEN + LATE[:3],
  [("marvel-rivals", "pc", "Diamond", "Duelist", ["Vanguard"], ["Competitive"], "ranked", "2_4h", "competitive"),
   ("overwatch-2", "pc", "Diamond", "Damage", ["Tank"], ["Competitive Role Queue"], "ranked", "2_4h", "competitive")]),
 ("PixelPilot", "asia-se", ["en", "vi"], ["mobile", "pc"], "usually", ["chill", "communicative"], ["positive"], "any", "both",
  "SEA evenings. Fortnite & Apex.", EVEN,
  [("fortnite", "mobile", "Gold", "Fragger", ["Builder"], ["Battle Royale", "Ranked"], "casual", "1_2h", "both"),
   ("apex-legends", "pc", "Silver", "Support", ["Controller"], ["Trios", "Mixtape"], "casual", "1_2h", "casual")]),
 ("StaticSage", "eu-west", ["en"], ["pc"], "always", ["strategic", "communicative"], ["good_comms", "consistent_schedule"], "required", "competitive",
  "Strategist main. Weekly schedule, scrims Tue/Thu.", [(1, 19, 23), (3, 19, 23), (5, 15, 21)],
  [("marvel-rivals", "pc", "Grandmaster", "Strategist", ["Vanguard"], ["Competitive"], "tournament", "2_4h", "competitive"),
   ("overwatch-2", "pc", "Master", "Support", [], ["Competitive Role Queue"], "ranked", "2_4h", "competitive")]),
 ("DuneRider", "me", ["ar", "en"], ["playstation"], "usually", ["competitive", "flexible"], ["competitive"], "preferred", "competitive",
  "ME server, CoD and Apex on PS5.", LATE,
  [("call-of-duty", "playstation", "Platinum", "Objective", ["Support"], ["Ranked Play", "Multiplayer"], "ranked", "1_2h", "both"),
   ("apex-legends", "playstation", "Platinum", "Assault", ["Skirmisher"], ["Ranked"], "ranked", "2_4h", "competitive")]),
 ("MapleMacro", "na-east", ["en", "fr"], ["pc"], "sometimes", ["learning", "supportive"], ["beginner_friendly", "positive"], "any", "both",
  "Returning to League after a break. Toronto.", EVEN[2:] + WKND,
  [("league-of-legends", "pc", "Silver", "Top", ["Fill"], ["Normal Draft", "ARAM", "Ranked Flex"], "casual", "1_2h", "both"),
   ("deadlock", "pc", "Seeker", "Frontline", ["Carry"], ["Standard"], "new", "1_2h", "casual")]),
 ("TurboTern", "eu-central", ["de", "en"], ["xbox"], "always", ["competitive", "grinder"], ["competitive", "has_mic"], "required", "competitive",
  "Rocket League 3s, aiming for GC this season.", EVEN + WKND,
  [("rocket-league", "xbox", "Grand Champion", "Goalkeeper", ["Midfield"], ["Ranked 3v3"], "ranked", "2_4h", "competitive")]),
 ("SoftReset", "na-west", ["en"], ["pc", "playstation"], "usually", ["chill", "supportive"], ["positive", "chill"], "any", "casual",
  "After-work chill games. No sweats please.", EVEN,
  [("valorant", "pc", "Silver", "Initiator", ["Sentinel"], ["Unrated", "Swiftplay"], "casual", "1_2h", "casual"),
   ("fortnite", "playstation", "Gold", "Support", ["Fragger"], ["Zero Build", "Reload"], "casual", "1_2h", "casual"),
   ("minecraft", "pc", None, "Explorer", ["Farmer"], ["Survival"], "casual", "2_4h", "casual")]),
 ("IronLotus", "asia-south", ["hi", "en"], ["pc"], "always", ["competitive", "strategic"], ["good_comms", "follows_calls"], "required", "competitive",
  "Valorant & CS2, India servers.", LATE + WKND,
  [("valorant", "pc", "Platinum", "Initiator", ["Controller"], ["Competitive", "Premier"], "ranked", "2_4h", "competitive"),
   ("cs2", "pc", "Premier 10k–15k", "Rifler", ["Entry Fragger"], ["Premier"], "ranked", "1_2h", "competitive")]),
]

def slots(region, schedule):
    off = REGION_UTC[region]
    out = set()
    for day, start, end in schedule:
        for h in range(start, end):
            utc = (day * 24 + h - off) % 168
            out.add(utc)
    return sorted(out)

def q(v):
    if v is None:
        return "null"
    if isinstance(v, bool):
        return "true" if v else "false"
    if isinstance(v, (int, float)):
        return str(v)
    if isinstance(v, list):
        return "array[" + ",".join(q(x) for x in v) + "]::text[]" if v else "'{}'::text[]"
    return "'" + str(v).replace("'", "''") + "'"

def uid(n):
    return f"d0000000-0000-4000-8000-{n:012d}"

lines = [
    "-- =============================================================================",
    "-- PartyUp DEMO DATA — for development only. Generated by tests/gen_seed.py.",
    "-- Every row here is flagged is_demo = true. Demo accounts have no password",
    "-- (nobody can sign in as them), use @partyup.invalid emails, never appear",
    "-- online, and are labelled \"Demo\" in the UI. Remove with remove_demo.sql.",
    "-- Run AFTER schema.sql, in the Supabase SQL Editor.",
    "-- =============================================================================",
    "begin;",
]
for i, p in enumerate(PLAYERS, start=1):
    (name, region, langs, plats, mic, styles, traits, pmic, look, bio, sched, games) = p
    lines.append(
        f"insert into auth.users (id, instance_id, aud, role, email, encrypted_password, raw_app_meta_data, raw_user_meta_data, "
        f"confirmation_token, recovery_token, email_change_token_new, email_change, created_at, updated_at) values "
        f"({q(uid(i))}, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'demo-{i:02d}@partyup.invalid', '', "
        f"'{{\"provider\":\"demo\",\"partyup_demo\":true}}'::jsonb, {q(json.dumps({'username': name}))}::jsonb, '', '', '', '', "
        f"now() - interval '{random.randint(20, 400)} days', now()) on conflict (id) do nothing;")
    hours_ago = random.randint(1, 240)
    av = "array[" + ",".join(str(s) for s in slots(region, sched)) + "]::smallint[]"
    lines.append(
        f"update public.profiles set username = {q(name)}, avatar_url = 'preset:{(i % 12) + 1}', bio = {q(bio)}, region = {q(region)}, "
        f"languages = {q(langs)}, platforms = {q(plats)}, mic_preference = {q(mic)}, playstyles = {q(styles)}, "
        f"teammate_traits = {q(traits)}, pref_teammate_mic = {q(pmic)}, looking_for = {q(look)}, availability = {av}, "
        f"timezone = 'UTC{REGION_UTC[region]:+d}', status = 'online', last_seen_at = now() - interval '{hours_ago} hours', "
        f"onboarded_at = now(), is_demo = true where id = {q(uid(i))};")
    for (gid, plat, rank, main, sec, modes, exp, sess, glook) in games:
        lines.append(
            f"insert into public.user_game_profiles (user_id, game_id, platform, rank, experience, main_role, secondary_roles, preferred_modes, "
            f"session_length, playstyles, looking_for) values ({q(uid(i))}, {q(gid)}, {q(plat)}, {q(rank)}, {q(exp)}, {q(main)}, {q(sec)}, "
            f"{q(modes)}, {q(sess)}, {q(styles[:2])}, {q(glook)}) on conflict (user_id, game_id) do nothing;")

idx = {p[0]: i for i, p in enumerate(PLAYERS, start=1)}
# (id_suffix, leader, members[(name, role)], game, title, desc, size, needed, play_type, min, max, lang, region, platform, mic, hours_ahead)
PARTIES = [
 (1, "NovaStrike", [("ZenAnchor", "Sentinel")], "valorant", "Plat+ ranked grind", "Two spots for Initiator/Controller. Comms required, no rage.",
  5, ["Initiator", "Controller"], "competitive", 4, 6, "en", "na-east", "pc", True, 3),
 (2, "FragTheory", [("VelvetAim", "AWPer"), ("ByteKnight", "Support")], "cs2", "EU Premier team tryouts", "Building a regular Premier five. Weeknight practice.",
  5, ["Entry Fragger", "Lurker"], "competitive", 2, 4, "en", "eu-west", "pc", True, 26),
 (3, "LunaHeals", [], "overwatch-2", "Chill Quick Play, any skill", "Learning new heroes, no pressure.",
  5, ["Tank", "Damage"], "casual", None, None, "en", "na-east", "pc", False, None),
 (4, "RedstoneRae", [("SoftReset", "Explorer")], "minecraft", "Technical survival world", "Small whitelisted survival world. Farms, builds, chill vibes.",
  8, ["Builder", "Farmer"], "casual", None, None, "en", "na-east", "pc", False, 48),
 (5, "TurboTern", [("TiltProof", "Striker"), ("OrbitDrift", "Midfield")], "rocket-league", "3s grind — full", "Full for tonight.",
  3, [], "competitive", None, None, "en", "eu-central", None, True, None),
 (6, "HexWard", [], "deadlock", "Deadlock ranked, need a carry", "Need a carry and a frontline who listen to rotations.",
  6, ["Carry", "Frontline"], "competitive", 5, 9, "en", "na-east", "pc", True, 5),
 (7, "RookieRaccoon", [], "marvel-rivals", "New players welcome", "Brand new to Rivals. Let's learn together!",
  6, ["Strategist", "Duelist"], "casual", None, None, "en", "na-central", "playstation", False, None),
 (8, "KiraSupports", [("MapleMacro", "Top")], "league-of-legends", "Flex queue, learning-friendly", "Friendly flex games. Happy to explain matchups.",
  5, ["Jungle", "Mid", "Bot"], "casual", None, None, "en", "oce", "pc", False, 10),
]
lines.append("-- demo parties")
for (n, leader, members, gid, title, desc, size, needed, ptype, mn, mx, lang, reg, plat, mic, ahead) in PARTIES:
    pid = f"d1000000-0000-4000-8000-{n:012d}"
    sched = f"now() + interval '{ahead} hours'" if ahead else "null"
    lines.append(
        f"insert into public.parties (id, leader_id, game_id, title, description, max_size, needed_roles, play_type, min_rank_index, max_rank_index, "
        f"language, region, platform, mic_required, visibility, scheduled_for, is_demo, created_at) values ({q(pid)}, {q(uid(idx[leader]))}, {q(gid)}, "
        f"{q(title)}, {q(desc)}, {size}, {q(needed)}, {q(ptype)}, {q(mn)}, {q(mx)}, {q(lang)}, {q(reg)}, {q(plat)}, {q(mic)}, 'public', {sched}, true, "
        f"now() - interval '{random.randint(1, 30)} hours') on conflict (id) do nothing;")
    lines.append(f"insert into public.conversations (kind, party_id) values ('party', {q(pid)}) on conflict (party_id) do nothing;")
    for who, role in [(leader, None)] + members:
        lines.append(f"insert into public.party_members (party_id, user_id, role) values ({q(pid)}, {q(uid(idx[who]))}, {q(role)}) on conflict do nothing;")
    lines.append(f"update public.profiles set stat_parties_created = stat_parties_created + 1 where id = {q(uid(idx[leader]))};")

lines.append("-- a few demo friendships between demo players (affects achievements only)")
for a, b in [("NovaStrike", "ZenAnchor"), ("FragTheory", "VelvetAim"), ("FragTheory", "ByteKnight"), ("TurboTern", "TiltProof"),
             ("LunaHeals", "KiraSupports"), ("RedstoneRae", "SoftReset")]:
    lines.append(f"insert into public.friendships (requester_id, addressee_id, status, responded_at) values ({q(uid(idx[a]))}, {q(uid(idx[b]))}, 'accepted', now()) on conflict do nothing;")

lines.append("-- demo communities (servers) with a few demo messages")
COMMS = [
 (1, "Valorant NA Grind", "Ranked five-stacks, VOD reviews and LFG for North America.", "#ff4655", "valorant",
  ["NovaStrike", "ZenAnchor", "SoftReset", "AstraNoodle", "IronLotus", "GhostPeak", "CopperFox"],
  [("general", "Talk about anything", "text"), ("looking-for-group", "Post your rank, role and when you're on", "text"),
   ("vod-review", "Share a match and ask for feedback", "text"), ("announcements", "News from the admins", "announcement")],
  [("general", "NovaStrike", "Welcome! Post your rank and main in #looking-for-group so people can find you."),
   ("general", "SoftReset", "anyone else think the new map rotation is rough for sentinels"),
   ("general", "ZenAnchor", "@SoftReset holding B on that map is pain"),
   ("looking-for-group", "NovaStrike", "Plat/Diamond, need a Controller tonight 8pm ET. Comms required."),
   ("looking-for-group", "AstraNoodle", "Gold Controller here, free after 9 if that works"),
   ("announcements", "NovaStrike", "Weekly in-house customs are Fridays at 9pm ET. Sign up in #general.")]),
 (2, "Co-op Night Crew", "Helldivers, Deep Rock, Lethal Company — chill co-op sessions most evenings.", "#e8c547", None,
  ["RedstoneRae", "SoftReset", "BrickByBrick", "OrbitDrift", "quietcarry", "PixelPilot"],
  [("general", "Say hi", "text"), ("tonight", "Who's playing what tonight", "text"), ("announcements", "", "announcement")],
  [("general", "RedstoneRae", "New here? Tell us what co-op games you're into."),
   ("tonight", "quietcarry", "Deep Rock at 10pm PT, need two more dwarves"),
   ("tonight", "BrickByBrick", "I'm in, text chat only but I can scout")]),
 (3, "EU Premier Scrims", "CS2 Premier teams and players in Europe looking for scrims.", "#f5a623", "cs2",
  ["FragTheory", "VelvetAim", "ByteKnight", "SableRush", "ZenAnchor"],
  [("general", "", "text"), ("scrim-requests", "Team, average rating, available times", "text")],
  [("scrim-requests", "FragTheory", "Looking for 15k+ teams for Tue/Thu scrims, 20:00 CET. DM me."),
   ("general", "VelvetAim", "Anyone tried the new Ancient changes yet?")]),
]
for (n, name, desc, color, gid, members, chans, msgs) in COMMS:
    cid = f"d2000000-0000-4000-8000-{n:012d}"
    owner = uid(idx[members[0]])
    lines.append(f"insert into public.communities (id, name, description, icon_color, owner_id, game_id, is_public, is_demo, created_at) values "
                 f"({q(cid)}, {q(name)}, {q(desc)}, {q(color)}, {q(owner)}, {q(gid)}, true, true, now() - interval '60 days') on conflict (id) do nothing;")
    for i, who in enumerate(members):
        role = "owner" if i == 0 else ("admin" if i == 1 else "member")
        lines.append(f"insert into public.community_members (community_id, user_id, role, joined_at) values ({q(cid)}, {q(uid(idx[who]))}, {q(role)}, now() - interval '{50 - i} days') on conflict do nothing;")
    for pos, (cname, topic, kind) in enumerate(chans):
        lines.append(f"insert into public.channels (community_id, name, topic, kind, position) values ({q(cid)}, {q(cname)}, {q(topic)}, {q(kind)}, {pos}) on conflict do nothing;")
    for k, (cname, who, body) in enumerate(msgs):
        hours = (len(msgs) - k) * 7 + 2
        lines.append(f"insert into public.messages (conversation_id, sender_id, body, created_at) select cv.id, {q(uid(idx[who]))}, {q(body)}, now() - interval '{hours} hours' "
                     f"from public.channels ch join public.conversations cv on cv.channel_id = ch.id where ch.community_id = {q(cid)} and ch.name = {q(cname)};")
lines.append("update public.conversations cv set last_message_at = (select max(created_at) from public.messages m where m.conversation_id = cv.id) where cv.kind = 'channel';")
lines.append("update public.conversation_members cm set last_read_at = now() from public.profiles p where p.id = cm.user_id and p.is_demo;")
lines.append("commit;")
open("supabase/seed_demo.sql", "w").write("\n".join(lines) + "\n")
print(len(PLAYERS), "players,", len(PARTIES), "parties")
