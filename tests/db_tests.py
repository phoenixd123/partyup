"""Database security & flow tests for PartyUp.

Runs schema.sql + seed_demo.sql on a local Postgres that emulates Supabase's
auth.uid() / roles (tests/supabase_stub.sql), then exercises RLS policies,
column grants and server functions as different users.

    python3 tests/db_tests.py
"""
import json, os, subprocess, sys, threading, uuid

ENV = dict(os.environ, PGHOST=os.environ.get("PGHOST", "/tmp"), PGPORT=os.environ.get("PGPORT", "5433"),
           PGUSER=os.environ.get("PGUSER", "postgres"), PGDATABASE="partyup_test")
HERE = os.path.dirname(os.path.abspath(__file__))
passed, failed = 0, []


def psql(sql, user=None, role="authenticated"):
    pre = ""
    if user is not None or role == "anon":
        claims = json.dumps({"sub": user or "", "role": role})
        pre = f"set role {role}; select set_config('request.jwt.claims', '{claims}', false);\n"
    p = subprocess.run(["psql", "-X", "-q", "-At", "-v", "ON_ERROR_STOP=1"], input=pre + sql, text=True,
                       capture_output=True, env=ENV)
    out = p.stdout.strip().splitlines()
    # drop the set_config echo line
    if pre and out:
        out = out[1:]
    err = ""
    for line in p.stderr.splitlines():
        if "ERROR:" in line:
            err = line.split("ERROR:", 1)[1].strip()
            break
    return p.returncode == 0, "\n".join(out), err


def ok(sql, user=None, role="authenticated"):
    good, out, err = psql(sql, user, role)
    if not good:
        raise AssertionError(f"expected success, got error: {err}\nSQL: {sql[:300]}")
    return out


def fails(sql, user=None, contains="", role="authenticated"):
    good, out, err = psql(sql, user, role)
    if good:
        raise AssertionError(f"expected failure but succeeded. SQL: {sql[:300]} -> {out[:200]}")
    if contains and contains.lower() not in err.lower():
        raise AssertionError(f"error {err!r} does not contain {contains!r}")
    return err


def j(sql, user=None):
    out = ok(sql, user)
    return json.loads(out) if out else None


def test(name):
    def deco(fn):
        global passed
        try:
            fn()
            passed += 1
            print(f"  PASS  {name}")
        except Exception as e:  # noqa
            failed.append((name, str(e)))
            print(f"  FAIL  {name}\n        {e}")
        return fn
    return deco


def make_user(username, **fields):
    uid = str(uuid.uuid4())
    ok(f"insert into auth.users (id, email, raw_user_meta_data) values ('{uid}', '{username.lower()}@example.com', "
       f"'{json.dumps({'username': username})}')")
    sets = {"onboarded_at": "now()", "region": "'na-east'", "languages": "'{en}'", "platforms": "'{pc}'",
            "mic_preference": "'always'", "availability": "array[0,1,2,3,23,24,25,26]::smallint[]"}
    sets.update(fields)
    ok("update profiles set " + ", ".join(f"{k} = {v}" for k, v in sets.items()) + f" where id = '{uid}'", uid)
    return uid


print("Resetting database…")
r = subprocess.run([os.path.join(HERE, "reset_db.sh"), "--seed"], capture_output=True, text=True)
if r.returncode != 0:
    print(r.stdout, r.stderr)
    sys.exit(1)

A = make_user("alice_test")
B = make_user("bob_test")
C = make_user("cara_test")
D = make_user("dan_test")
MOD = make_user("mod_test")
ADMIN = make_user("admin_test")
ok(f"insert into user_roles values ('{MOD}', 'moderator'), ('{ADMIN}', 'admin')")
DEMO1 = "d0000000-0000-4000-8000-000000000001"

print("\nAuth & profiles")


@test("sign-up trigger creates a profile with the requested username")
def _():
    assert ok(f"select username from profiles where id = '{A}'") == "alice_test"


@test("anonymous visitors cannot read profiles or call RPCs")
def _():
    fails("select count(*) from profiles", role="anon", contains="permission denied")
    fails("select count(*) from public_profiles", role="anon", contains="permission denied")
    fails("select find_players()", role="anon", contains="permission denied")
    assert int(ok("select count(*) from games", role="anon")) >= 50


@test("users can only read their own row from the profiles table")
def _():
    assert ok("select count(*) from profiles", A) == "1"
    assert ok(f"select count(*) from profiles where id = '{B}'", A) == "0"


@test("public_profiles never exposes email and masks private fields")
def _():
    cols = ok("select string_agg(column_name, ',') from information_schema.columns where table_name = 'public_profiles'")
    assert "email" not in cols
    ok("update profiles set show_region = false, show_languages = false, bio = 'secret bio', show_bio = false where id = auth.uid()", B)
    row = ok(f"select coalesce(region,'NULL') || '|' || cardinality(languages) || '|' || bio from public_profiles where id = '{B}'", A)
    assert row == "NULL|0|", row
    # the owner still sees their real data
    assert ok("select region from profiles where id = auth.uid()", B) == "na-east"
    ok("update profiles set show_region = true, show_languages = true, show_bio = true where id = auth.uid()", B)


@test("users cannot edit another user's profile")
def _():
    out = ok(f"update profiles set bio = 'hacked' where id = '{B}' returning id", A)
    assert out == "", out
    assert ok(f"select bio from profiles where id = '{B}'") != "hacked"


@test("users cannot change protected columns (demo flag, ban, suspension, stats)")
def _():
    fails("update profiles set is_banned = false where id = auth.uid()", A, "permission denied")
    fails("update profiles set is_demo = true where id = auth.uid()", A, "permission denied")
    fails("update profiles set suspended_until = null where id = auth.uid()", A, "permission denied")
    fails("update profiles set stat_parties_created = 99 where id = auth.uid()", A, "permission denied")


@test("username rules: format and case-insensitive uniqueness")
def _():
    fails("update profiles set username = 'Bob_Test' where id = auth.uid()", A, "duplicate")
    fails("update profiles set username = 'no spaces!' where id = auth.uid()", A, "check")
    assert ok("select is_username_available('BOB_TEST')", A) == "f"
    assert ok("select is_username_available('fresh_name')", A) == "t"


@test("users cannot grant themselves moderator")
def _():
    fails(f"insert into user_roles values ('{A}', 'admin')", A, "permission denied")
    assert j("select am_i_moderator()", A)["moderator"] is False
    assert j("select am_i_moderator()", MOD)["moderator"] is True


print("\nGame profiles")


@test("game profile: own insert works, rank validated, rank_index derived")
def _():
    ok("insert into user_game_profiles (user_id, game_id, platform, rank, main_role) values (auth.uid(), 'valorant', 'pc', 'Diamond', 'Controller')", A)
    assert ok("select rank_index from user_game_profiles where user_id = auth.uid() and game_id = 'valorant'", A) == "5"
    fails("insert into user_game_profiles (user_id, game_id, rank) values (auth.uid(), 'cs2', 'Diamond')", A, "not a valid")
    fails("insert into user_game_profiles (user_id, game_id, main_role) values (auth.uid(), 'cs2', 'Healer')", A, "invalid role")
    fails("insert into user_game_profiles (user_id, game_id, platform) values (auth.uid(), 'cs2', 'xbox')", A, "not available")
    fails("insert into user_game_profiles (user_id, game_id, rank) values (auth.uid(), 'minecraft', 'Gold')", A, "does not have ranks")


@test("game profile: cannot create or edit one for another user")
def _():
    fails(f"insert into user_game_profiles (user_id, game_id) values ('{B}', 'valorant')", A, "row-level security")
    ok("insert into user_game_profiles (user_id, game_id, rank, main_role, platform) values (auth.uid(), 'valorant', 'Platinum', 'Duelist', 'pc')", B)
    assert ok(f"update user_game_profiles set rank = 'Radiant' where user_id = '{B}' returning id", A) == ""
    fails("update user_game_profiles set rank_index = 8 where user_id = auth.uid()", A, "permission denied")


@test("hidden ranks are masked in public_game_profiles")
def _():
    ok("update profiles set show_ranks = false where id = auth.uid()", B)
    assert ok(f"select coalesce(rank,'NULL') from public_game_profiles where user_id = '{B}'", A) == "NULL"
    ok("update profiles set show_ranks = true where id = auth.uid()", B)


print("\nDiscovery & compatibility")


@test("find_players returns scored results with a factor breakdown")
def _():
    res = j("select find_players(p_game => 'valorant')", A)
    assert res["total"] >= 5, res["total"]
    p = res["players"][0]
    c = p["compatibility"]
    assert 0 <= c["score"] <= 100 and c["factors"]
    tw = sum(f["weight"] for f in c["factors"]); tp = sum(f["points"] for f in c["factors"])
    assert round(100 * tp / tw) == c["score"], (tp, tw, c["score"])
    scores = [x["compatibility"]["score"] for x in res["players"]]
    assert scores == sorted(scores, reverse=True), scores
    assert all(any(g["game_id"] == "valorant" for g in x["games"]) for x in res["players"])


@test("compatibility is deterministic and rank-aware")
def _():
    s1 = j(f"select get_compatibility('{B}', 'valorant')", A)
    s2 = j(f"select get_compatibility('{B}', 'valorant')", A)
    assert s1 == s2
    rank = next(f for f in s1["factors"] if f["key"] == "rank")
    assert rank["weight"] == 20 and "1 tier" in rank["detail"], rank
    ok("update user_game_profiles set rank = 'Iron' where user_id = auth.uid() and game_id = 'valorant'", B)
    s3 = j(f"select get_compatibility('{B}', 'valorant')", A)
    assert s3["score"] < s1["score"], (s3["score"], s1["score"])
    ok("update user_game_profiles set rank = 'Platinum' where user_id = auth.uid() and game_id = 'valorant'", B)


@test("unranked games do not include a rank factor")
def _():
    s = j(f"select get_compatibility('d0000000-0000-4000-8000-000000000019', 'minecraft')", A)
    assert not any(f["key"] == "rank" for f in s["factors"])


@test("filters: region, language, rank range, role, mic, search, pagination")
def _():
    eu = j("select find_players(p_region => 'eu-west')", A)
    assert eu["total"] > 0 and all(p["region"] == "eu-west" for p in eu["players"])
    de = j("select find_players(p_language => 'de')", A)
    assert de["total"] > 0 and all("de" in p["languages"] for p in de["players"])
    hi = j("select find_players(p_game => 'valorant', p_min_rank => 6, p_max_rank => 8)", A)
    assert hi["total"] >= 1 and all(any(g["game_id"] == "valorant" and g["rank"] in ("Ascendant", "Immortal", "Radiant") for g in p["games"]) for p in hi["players"])
    sup = j("select find_players(p_game => 'overwatch-2', p_role => 'Support')", A)
    assert sup["total"] >= 1
    txt = j("select find_players(p_mic => 'text_only')", A)
    assert all(p["mic_preference"] == "text_only" for p in txt["players"])
    s = j("select find_players(p_search => 'nova')", A)
    assert s["total"] == 1 and s["players"][0]["username"] == "NovaStrike"
    pct = j("select find_players(p_search => '%')", A)
    assert pct["total"] == 0, "LIKE wildcards must be escaped"
    page1 = j("select find_players(p_limit => 5, p_offset => 0)", A)
    page2 = j("select find_players(p_limit => 5, p_offset => 5)", A)
    ids1 = {p["id"] for p in page1["players"]}; ids2 = {p["id"] for p in page2["players"]}
    assert len(ids1) == 5 and not ids1 & ids2 and page1["total"] == page2["total"]


@test("filtering on a hidden field does not reveal it")
def _():
    ok("update profiles set show_region = false, region = 'oce' where id = auth.uid()", C)
    res = j("select find_players(p_region => 'oce', p_include_demo => false)", A)
    assert all(p["id"] != C for p in res["players"])
    ok("update profiles set show_region = true, region = 'na-east' where id = auth.uid()", C)


@test("demo players can be hidden; non-discoverable users are excluded")
def _():
    withd = j("select find_players()", A)["total"]
    nod = j("select find_players(p_include_demo => false)", A)["total"]
    assert withd > nod and nod >= 4
    ok("update profiles set discoverable = false where id = auth.uid()", D)
    assert all(p["id"] != D for p in j("select find_players(p_include_demo => false, p_limit => 48)", A)["players"])
    ok("update profiles set discoverable = true where id = auth.uid()", D)


@test("quick match explains empty results instead of inventing them")
def _():
    ok("insert into user_game_profiles (user_id, game_id) values (auth.uid(), 'minecraft')", D)
    ok("update profiles set region = 'af', languages = '{th}' where id = auth.uid()", D)
    qm = j("select quick_match('minecraft')", D)
    assert qm["game_id"] == "minecraft" and isinstance(qm["tips"], list) and qm["diagnostics"]
    assert any("region" in t for t in qm["tips"]), qm["tips"]
    ok("update profiles set region = 'na-east', languages = '{en}' where id = auth.uid()", D)


print("\nParties")
P = {}


@test("create party; leader becomes first member; chat created")
def _():
    P["a"] = ok("select create_party(p_game => 'valorant', p_title => 'Test squad', p_max_size => 2, p_needed_roles => '{Duelist}', p_my_role => 'Controller')", A)
    pj = j(f"select get_party('{P['a']}')", A)
    assert pj["member_count"] == 1 and pj["my_relation"] == "leader" and pj["status"] == "open" and pj["conversation_id"]


@test("party validation: size limited by game, ranks valid")
def _():
    fails("select create_party(p_game => 'apex-legends', p_title => 'Too big', p_max_size => 5)", A, "between 2 and 3")
    fails("select create_party(p_game => 'valorant', p_title => 'Bad', p_max_size => 5, p_min_rank => 6, p_max_rank => 2)", A, "minimum rank")
    fails("select create_party(p_game => 'minecraft', p_title => 'Bad', p_max_size => 5, p_min_rank => 1)", A, "no ranks")


@test("direct writes to party tables are blocked (must use server functions)")
def _():
    fails(f"insert into party_members (party_id, user_id) values ('{P['a']}', auth.uid())", C, "permission denied")
    fails(f"update parties set max_size = 10 where id = '{P['a']}'", A, "permission denied")
    fails(f"delete from party_members where party_id = '{P['a']}'", A, "permission denied")


@test("join request → accept; party becomes full and blocks more members")
def _():
    rid = ok(f"select request_join_party('{P['a']}', 'Duelist', 'hi!')", B)
    assert j(f"select get_party('{P['a']}')", B)["my_relation"] == "requested"
    fails(f"select respond_join_request('{rid}', true)", B, "only the party leader")
    rid_c = ok(f"select request_join_party('{P['a']}', null, 'me too')", C)
    ok(f"select respond_join_request('{rid}', true)", A)
    pj = j(f"select get_party('{P['a']}')", A)
    assert pj["member_count"] == 2 and pj["status"] == "full" and pj["open_slots"] == 0
    fails(f"select respond_join_request('{rid_c}', true)", A, "full")
    fails(f"select request_join_party('{P['a']}')", D, "full")
    n = ok(f"select count(*) from notifications where user_id = '{B}' and type = 'join_accepted'")
    assert n == "1"


@test("rank range enforced on join requests")
def _():
    pid = ok("select create_party(p_game => 'valorant', p_title => 'High elo', p_max_size => 5, p_min_rank => 6, p_max_rank => 8)", MOD)
    fails(f"select request_join_party('{pid}')", B, "outside")
    fails(f"select request_join_party('{pid}')", C, "add your")


@test("only the leader can remove, transfer or close; members can leave")
def _():
    fails(f"select remove_party_member('{P['a']}', '{A}')", B, "only the party leader")
    fails(f"select transfer_party_leadership('{P['a']}', '{B}')", B, "only the party leader")
    fails(f"select close_party('{P['a']}')", B, "only the party leader")
    ok(f"select transfer_party_leadership('{P['a']}', '{B}')", A)
    assert j(f"select get_party('{P['a']}')", B)["my_relation"] == "leader"
    ok(f"select leave_party('{P['a']}')", B)  # leader leaves → A inherits
    pj = j(f"select get_party('{P['a']}')", A)
    assert pj["my_relation"] == "leader" and pj["member_count"] == 1 and pj["status"] == "open"


@test("removed members lose access to party chat")
def _():
    rid = ok(f"select request_join_party('{P['a']}')", D)
    ok(f"select respond_join_request('{rid}', true)", A)
    conv = j(f"select get_party('{P['a']}')", D)["conversation_id"]
    ok(f"select send_message('{conv}', 'gl hf')", D)
    ok(f"select remove_party_member('{P['a']}', '{D}')", A)
    fails(f"select get_messages('{conv}')", D, "not found")
    assert ok(f"select count(*) from messages where conversation_id = '{conv}'", D) == "0"


@test("invite-only parties are hidden and cannot be joined by request")
def _():
    pid = ok("select create_party(p_game => 'overwatch-2', p_title => 'Private', p_max_size => 5, p_visibility => 'invite_only')", A)
    P["priv"] = pid
    assert j(f"select get_party('{pid}')", C) is None
    assert ok(f"select count(*) from parties where id = '{pid}'", C) == "0"
    fails(f"select request_join_party('{pid}')", C, "not found")
    iid = ok(f"select invite_to_party('{pid}', '{C}')", A)
    assert j(f"select get_party('{pid}')", C)["my_relation"] == "invited"
    fails(f"select respond_party_invite('{iid}', true)", B, "not found")
    ok(f"select respond_party_invite('{iid}', true)", C)
    assert j(f"select get_party('{pid}')", C)["my_relation"] == "member"


@test("concurrent accepts cannot overfill a party")
def _():
    pid = ok("select create_party(p_game => 'rocket-league', p_title => 'Race', p_max_size => 2)", MOD)
    i1 = ok(f"select invite_to_party('{pid}', '{B}')", MOD)
    i2 = ok(f"select invite_to_party('{pid}', '{D}')", MOD)
    results = {}
    def accept(uid, iid):
        results[uid] = psql(f"select pg_sleep(0.2); select respond_party_invite('{iid}', true)", uid)[0]
    t1 = threading.Thread(target=accept, args=(B, i1)); t2 = threading.Thread(target=accept, args=(D, i2))
    t1.start(); t2.start(); t1.join(); t2.join()
    assert sorted(results.values()) == [False, True], results
    assert ok(f"select member_count || '/' || max_size from parties where id = '{pid}'") == "2/2"


@test("closing a party marks it closed and cancels pending requests")
def _():
    pid = ok("select create_party(p_game => 'fortnite', p_title => 'Closing soon', p_max_size => 4)", A)
    rid = ok(f"select request_join_party('{pid}')", B)
    ok(f"select close_party('{pid}')", A)
    assert j(f"select get_party('{pid}')", A)["status"] == "closed"
    assert ok(f"select status from party_join_requests where id = '{rid}'") == "cancelled"
    fails(f"select request_join_party('{pid}')", C, "closed")


print("\nFriends, blocks, messaging")


@test("friend request → accept, with notifications")
def _():
    assert ok(f"select send_friend_request('{B}')", A) == "outgoing"
    assert j("select list_friends()", B)["incoming"][0]["id"] == A
    ok(f"select respond_friend_request('{A}', true)", B)
    assert any(f["id"] == B for f in j("select list_friends()", A)["friends"])
    assert ok(f"select count(*) from notifications where user_id = '{A}' and type = 'friend_accepted'") == "1"


@test("users only see their own friendships")
def _():
    assert ok("select count(*) from friendships", C) == "0"


@test("direct messages: participants only")
def _():
    conv = ok(f"select get_or_create_direct_conversation('{B}')", A)
    P["dm"] = conv
    ok(f"select send_message('{conv}', 'hey want to queue?')", A)
    msgs = j(f"select get_messages('{conv}')", B)
    assert msgs[-1]["body"] == "hey want to queue?"
    assert j("select list_conversations()", B)[0]["unread"] == 1
    assert j("select get_counts()", B)["messages"] == 1
    ok(f"select mark_conversation_read('{conv}')", B)
    assert j("select get_counts()", B)["messages"] == 0
    fails(f"select get_messages('{conv}')", C, "not found")
    fails(f"select send_message('{conv}', 'let me in')", C, "not found")
    assert ok(f"select count(*) from messages where conversation_id = '{conv}'", C) == "0"
    fails(f"insert into messages (conversation_id, sender_id, body) values ('{conv}', auth.uid(), 'x')", C, "permission denied")


@test("spam protection: burst rate limit and duplicate messages")
def _():
    conv = P["dm"]
    ok(f"select send_message('{conv}', 'same text')", B)
    ok(f"select send_message('{conv}', 'same text')", B)
    fails(f"select send_message('{conv}', 'same text')", B, "same message")
    sql = "".join(f"select send_message('{conv}', 'msg {i}');" for i in range(12))
    fails(sql, B, "slow down")


@test("message privacy: 'friends only' blocks strangers")
def _():
    ok("update profiles set allow_messages = 'friends' where id = auth.uid()", D)
    fails(f"select get_or_create_direct_conversation('{D}')", C, "only accepts messages from friends")
    ok("update profiles set allow_messages = 'everyone' where id = auth.uid()", D)


@test("blocking prevents messages, invites and friend requests (both directions)")
def _():
    conv = ok(f"select get_or_create_direct_conversation('{C}')", D)
    ok(f"select send_message('{conv}', 'hello')", D)
    ok(f"select block_user('{D}')", C)
    fails(f"select send_message('{conv}', 'hello again')", D, "can't message")
    fails(f"select send_message('{conv}', 'hi')", C, "can't message")
    fails(f"select send_friend_request('{C}')", D, "can't add")
    fails(f"select send_friend_request('{D}')", C, "can't add")
    pid = ok("select create_party(p_game => 'valorant', p_title => 'D party', p_max_size => 5)", D)
    fails(f"select invite_to_party('{pid}', '{C}')", D, "can't invite")
    assert j(f"select get_party('{pid}')", C) is None, "blocked user's public party should be hidden"
    assert all(p["id"] != C for p in j("select find_players(p_limit => 48)", D)["players"])
    assert j(f"select get_player_profile('{C}')", D) is None
    ok(f"select unblock_user('{D}')", C)
    ok(f"select send_message('{conv}', 'unblocked now')", D)


@test("blocking removes an existing friendship")
def _():
    ok(f"select block_user('{B}')", A)
    assert not any(f["id"] == B for f in j("select list_friends()", A)["friends"])
    ok(f"select unblock_user('{B}')", A)


@test("muting hides notifications from that player")
def _():
    ok(f"select mute_user('{C}')", B)
    before = ok(f"select count(*) from notifications where user_id = '{B}' and type = 'friend_request'")
    ok(f"select send_friend_request('{B}')", C)
    after = ok(f"select count(*) from notifications where user_id = '{B}' and type = 'friend_request'")
    assert before == after
    ok(f"select unmute_user('{C}')", B)


print("\nNotifications")


@test("notification preferences are respected")
def _():
    count = f"select count(*) from notifications where user_id = '{B}' and type = 'party_invite'"
    before = ok(count)
    ok("update profiles set notify_party_invites = false where id = auth.uid()", B)
    pid = ok("select create_party(p_game => 'valorant', p_title => 'Pref test', p_max_size => 5)", D)
    ok(f"select invite_to_party('{pid}', '{B}')", D)
    assert ok(count) == before
    ok("update profiles set notify_party_invites = true where id = auth.uid()", B)
    pid2 = ok("select create_party(p_game => 'valorant', p_title => 'Pref test 2', p_max_size => 5)", A)
    ok(f"select invite_to_party('{pid2}', '{B}')", A)
    assert int(ok(count)) == int(before) + 1


@test("users can only read/mark their own notifications, and only read_at")
def _():
    assert int(ok("select count(*) from notifications", A)) == int(ok(f"select count(*) from notifications where user_id = '{A}'"))
    nid = ok(f"select id from notifications where user_id = '{A}' limit 1")
    assert ok(f"update notifications set read_at = now() where id = {nid} returning id", B) == ""
    fails(f"update notifications set type = 'moderation' where id = {nid}", A, "permission denied")
    ok("select mark_notifications_read()", A)
    assert j("select get_counts()", A)["notifications"] == 0


print("\nModeration")
R = {}


@test("report submission validates input and snapshots the reported message")
def _():
    mid = ok(f"select id from messages where conversation_id = '{P['dm']}' and sender_id = '{B}' order by id limit 1")
    fails(f"select submit_report('{A}', 'spam', 'reporting myself')", A, "yourself")
    fails(f"select submit_report('{B}', 'spam', 'short')", A, "at least 10")
    fails(f"select submit_report('{B}', 'spam', 'not my message', {mid})", C, "can't be reported")
    R["id"] = ok(f"select submit_report('{B}', 'harassment', 'Sent me repeated spam messages', {mid})", A)
    assert ok(f"select message_snapshot from reports where id = '{R['id']}'") == "same text"


@test("non-moderators cannot see or act on reports")
def _():
    assert ok("select count(*) from reports", A) == "0"
    fails("select mod_list_reports()", A, "moderator access")
    fails(f"select mod_get_report('{R['id']}')", A, "moderator access")
    fails(f"select mod_update_report('{R['id']}', 'resolved', 'warning')", A, "moderator access")
    fails(f"update reports set status = 'dismissed' where id = '{R['id']}'", MOD, "permission denied")


@test("moderators review reports; suspension blocks social actions")
def _():
    lst = j("select mod_list_reports()", MOD)
    assert any(r["id"] == R["id"] for r in lst["reports"])
    det = j(f"select mod_get_report('{R['id']}')", MOD)
    assert det["reported_profile"]["username"] == "bob_test" and "email" not in json.dumps(det)
    fails(f"select mod_update_report('{R['id']}', 'resolved', 'ban')", MOD, "only admins")
    ok(f"select mod_update_report('{R['id']}', 'resolved', 'suspend', 'repeat spam', 3)", MOD)
    fails(f"select send_message('{P['dm']}', 'am I suspended?')", B, "suspended")
    fails(f"select send_friend_request('{C}')", B, "suspended")
    assert ok(f"select count(*) from notifications where user_id = '{A}' and type = 'report_update'") == "1"
    assert ok(f"select count(*) from moderation_actions where report_id = '{R['id']}'") == "1"
    assert j("select my_reports()", A)[0]["status"] == "resolved"


@test("remove_content hides the message for everyone")
def _():
    mid = ok(f"select id from messages where conversation_id = '{P['dm']}' and body = 'hey want to queue?'")
    rid = ok(f"insert into reports (reporter_id, reported_user_id, reported_username, category, description, message_id) values "
           f"('{B}', '{A}', 'alice_test', 'other', 'test removal of content', {mid}) returning id")
    ok(f"select mod_update_report('{rid}', 'resolved', 'remove_content')", ADMIN)
    m = [x for x in j(f"select get_messages('{P['dm']}')", A) if x["id"] == int(mid)][0]
    assert m["removed"] is True and m["body"] is None


print("\nCommunities")
K = {}
ok(f"update profiles set suspended_until = null where id = '{B}'"); ok(f"delete from rate_events where user_id = '{B}'")
E = make_user("eve_test")
F = make_user("finn_test")


@test("create community: owner role, default channels, channel chats created")
def _():
    K["c"] = ok("select create_community('Test Squad Hub', 'for tests', true, 'valorant', '#336699')", E)
    g = j(f"select get_community('{K['c']}')", E)
    assert g["my_role"] == "owner" and g["member_count"] == 1
    names = [c["name"] for c in g["channels"]]
    assert names == ["general", "looking-for-group", "announcements"], names
    K["general"] = g["channels"][0]["conversation_id"]
    K["ann"] = g["channels"][2]["conversation_id"]
    K["ann_channel"] = g["channels"][2]["id"]


@test("public communities: explore, preview without messages, join syncs channel access")
def _():
    ex = j("select explore_communities('Squad Hub')", F)
    assert ex["total"] == 1 and ex["communities"][0]["my_role"] is None
    prev = j(f"select get_community('{K['c']}')", F)
    assert prev["is_member"] is False
    fails(f"select get_messages('{K['general']}')", F, "not found")
    ok(f"select join_community('{K['c']}')", F)
    assert j(f"select get_community('{K['c']}')", F)["member_count"] == 2
    ok(f"select send_message('{K['general']}', 'hello hub')", F)
    assert j(f"select get_messages('{K['general']}')", E)[-1]["body"] == "hello hub"


@test("announcement channels: only admins post")
def _():
    fails(f"select send_message('{K['ann']}', 'can I post?')", F, "only admins")
    ok(f"select send_message('{K['ann']}', 'Welcome to the hub')", E)


@test("private communities need an invite; invites track uses and expire")
def _():
    priv = ok("select create_community('Secret Club', '', false)", E)
    K["priv"] = priv
    assert j(f"select get_community('{priv}')", F) is None
    fails(f"select join_community('{priv}')", F, "invite only")
    fails(f"select create_invite('{priv}')", F, "community not found")
    code = ok(f"select create_invite('{priv}', 1, 24)", E)
    assert len(code) == 8
    info = j(f"select get_invite('{code}')", F)
    assert info["valid"] and info["community"]["name"] == "Secret Club"
    assert ok(f"select accept_invite('{code}')", F) == priv
    assert j(f"select get_invite('{code}')", A)["valid"] is False
    fails(f"select accept_invite('{code}')", A, "use limit")
    code2 = ok(f"select create_invite('{priv}', null, 1)", E)
    ok(f"update community_invites set expires_at = now() - interval '1 minute' where code = '{code2}'")
    assert "expired" in j(f"select get_invite('{code2}')", A)["reason"]


@test("roles: only owner sets roles; admins kick lower roles only")
def _():
    ok(f"select join_community('{K['c']}')", A)
    fails(f"select set_member_role('{K['c']}', '{A}', 'admin')", F, "only the owner")
    ok(f"select set_member_role('{K['c']}', '{F}', 'admin')", E)
    fails(f"select kick_community_member('{K['c']}', '{E}')", F, "lower role")
    ok(f"select kick_community_member('{K['c']}', '{A}')", F)
    assert ok(f"select count(*) from community_members where community_id = '{K['c']}' and user_id = '{A}'") == "0"
    fails(f"select get_messages('{K['general']}')", A, "not found")
    fails(f"select kick_community_member('{K['c']}', '{F}')", B, "only community admins")


@test("community bans block rejoining; channels are admin-managed")
def _():
    ok(f"select join_community('{K['c']}')", B)
    ok(f"select ban_community_member('{K['c']}', '{B}', 'spam')", F)
    fails(f"select join_community('{K['c']}')", B, "banned")
    assert j(f"select list_community_bans('{K['c']}')", E)[0]["reason"] == "spam"
    fails(f"select create_channel('{K['c']}', 'clips')", D, "only community admins")
    chid = ok(f"select create_channel('{K['c']}', 'Clips & Highlights', 'best plays')", F)
    assert ok(f"select name from channels where id = '{chid}'") == "clips-highlights"
    assert ok(f"select count(*) from conversation_members cm join conversations cv on cv.id = cm.conversation_id where cv.channel_id = '{chid}'") == "2"
    ok(f"select delete_channel('{chid}')", E)
    ok(f"select unban_community_member('{K['c']}', '{B}')", E)
    ok(f"select join_community('{K['c']}')", B)


@test("owner can't leave without transfer; transfer and delete with confirmation")
def _():
    fails(f"select leave_community('{K['priv']}')", E, "transfer ownership")
    ok(f"select transfer_community_ownership('{K['priv']}', '{F}')", E)
    assert j(f"select get_community('{K['priv']}')", F)["my_role"] == "owner"
    ok(f"select leave_community('{K['priv']}')", E)
    fails(f"select delete_community('{K['priv']}', 'wrong')", F, "type the community name")
    ok(f"select delete_community('{K['priv']}', 'secret club')", F)
    assert ok(f"select count(*) from communities where id = '{K['priv']}'") == "0"


@test("rail list shows unread and mention counts per community")
def _():
    ok(f"select send_message('{K['general']}', 'hey @eve_test check this')", B)
    rail = j("select list_my_communities()", E)
    me_c = next(c for c in rail if c["id"] == K["c"])
    assert me_c["unread"] is True and me_c["mentions"] == 1, me_c
    ok(f"select mark_conversation_read('{K['general']}')", E)
    me_c = next(c for c in j("select list_my_communities()", E) if c["id"] == K["c"])
    assert me_c["unread"] is False and me_c["mentions"] == 0


print("\nMessaging features")


@test("replies, mentions and reply pings")
def _():
    msgs = j(f"select get_messages('{K['general']}')", E)
    target = next(m for m in msgs if m["body"] == "hello hub")
    m = j(f"select send_message('{K['general']}', 'welcome!', {target['id']})", E)
    assert m["reply"]["id"] == target["id"] and m["reply"]["sender_name"] == "finn_test"
    assert ok(f"select count(*) from notifications where user_id = '{F}' and type = 'mention' and data->>'reply' = 'true'") == "1"
    foreign = ok(f"select max(id) from messages where conversation_id = '{P['dm']}'")
    fails(f"select send_message('{K['general']}', 'bad reply', {foreign})", E, "can't reply")


@test("edit and delete own messages; admins delete in their channels")
def _():
    m = j(f"select send_message('{K['general']}', 'typo mesage')", B)
    fails(f"select edit_message({m['id']}, 'hacked')", E, "your own")
    e = j(f"select edit_message({m['id']}, 'typo message')", B)
    assert e["body"] == "typo message" and e["edited_at"]
    m2 = j(f"select send_message('{K['general']}', 'rule-breaking text')", B)
    ok(f"select join_community('{K['c']}')", D)
    fails(f"select delete_message({m['id']})", D, "your own")
    ok(f"select delete_message({m2['id']})", F)  # F is admin
    got = [x for x in j(f"select get_messages('{K['general']}')", B) if x["id"] == m2["id"]][0]
    assert got["deleted"] is True and got["body"] is None
    fails(f"select edit_message({m2['id']}, 'undo')", B, "deleted")


@test("reactions toggle and aggregate; invalid emoji rejected")
def _():
    m = j(f"select send_message('{K['general']}', 'gg everyone')", F)
    assert ok(f"select toggle_reaction({m['id']}, '🔥')", E) == "t"
    assert ok(f"select toggle_reaction({m['id']}, '🔥')", B) == "t"
    got = [x for x in j(f"select get_messages('{K['general']}')", E) if x["id"] == m["id"]][0]
    assert got["reactions"] == [{"emoji": "🔥", "count": 2, "me": True}], got["reactions"]
    assert ok(f"select toggle_reaction({m['id']}, '🔥')", E) == "f"
    fails(f"select toggle_reaction({m['id']}, 'x')", E, "isn't available")
    fails(f"select toggle_reaction({m['id']}, '👍')", A, "not found")
    K["gg"] = m["id"]


@test("pins: channel admins only; listed in pins")
def _():
    fails(f"select pin_message({K['gg']}, true)", B, "permission")
    ok(f"select pin_message({K['gg']}, true)", E)
    pins = j(f"select list_pins('{K['general']}')", B)
    assert len(pins) == 1 and pins[0]["body"] == "gg everyone"
    ok(f"select pin_message({K['gg']}, false)", F)
    assert j(f"select list_pins('{K['general']}')", B) == []


@test("search within a conversation, members only")
def _():
    res = j(f"select search_messages('{K['general']}', 'hub')", E)
    assert any("hello hub" == r["body"] for r in res)
    fails(f"select search_messages('{K['general']}', 'hub')", A, "not found")


@test("typing indicator visible to others for a few seconds")
def _():
    ok(f"select set_typing('{K['general']}')", B)
    assert j(f"select get_typing('{K['general']}')", E) == ["bob_test"]
    assert j(f"select get_typing('{K['general']}')", B) == []
    ok(f"update conversation_typing set updated_at = now() - interval '10 seconds'")
    assert j(f"select get_typing('{K['general']}')", E) == []


@test("muting a conversation stops message notifications but not mentions")
def _():
    conv = P["dm"]
    ok(f"select set_conversation_muted('{conv}', true)", A)
    before = ok(f"select count(*) from notifications where user_id = '{A}' and type = 'message' and read_at is null")
    ok(f"select mark_notifications_read()", A)
    ok(f"delete from rate_events where user_id = '{B}'")
    ok(f"select send_message('{conv}', 'muted ping')", B)
    assert ok(f"select count(*) from notifications where user_id = '{A}' and type = 'message' and read_at is null") == "0"
    ok(f"select send_message('{conv}', 'hey @alice_test')", B)
    assert ok(f"select count(*) from notifications where user_id = '{A}' and type = 'mention' and read_at is null") == "1"
    ok(f"select set_conversation_muted('{conv}', false)", A)


print("\nGroup DMs")


@test("group DMs: friends only, 2+ people, owner manages, leaving hands off ownership")
def _():
    ok(f"select send_friend_request('{E}')", A); ok(f"select respond_friend_request('{A}', true)", E)
    ok(f"select send_friend_request('{F}')", A); ok(f"select respond_friend_request('{A}', true)", F)
    fails(f"select create_group_dm(array['{E}']::uuid[])", A, "at least two")
    fails(f"select create_group_dm(array['{E}','{D}']::uuid[])", A, "only add friends")
    g = ok(f"select create_group_dm(array['{E}','{F}']::uuid[], 'Night squad')", A)
    assert ok(f"select count(*) from notifications where type = 'group_added' and conversation_id = '{g}'") == "2"
    ok(f"select send_message('{g}', 'group hello')", E)
    assert j(f"select get_messages('{g}')", F)[-1]["body"] == "group hello"
    fails(f"select get_messages('{g}')", D, "not found")
    ok(f"select rename_group_dm('{g}', 'Late night squad')", F)
    fails(f"select remove_group_member('{g}', '{E}')", F, "only the group owner")
    lst = j("select list_conversations()", F)
    assert any(c["id"] == g and c["name"] == "Late night squad" and c["kind"] == "group" for c in lst)
    ok(f"select leave_group_dm('{g}')", A)
    assert ok(f"select owner_id from conversations where id = '{g}'") in (E, F)
    K["group"] = g


@test("custom status shows on public cards")
def _():
    ok("update profiles set custom_status = 'grinding ranked' where id = auth.uid()", E)
    members = j(f"select list_community_members('{K['c']}')", B)
    assert next(m for m in members if m["id"] == E)["custom_status"] == "grinding ranked"
    fails("update profiles set custom_status = repeat('x', 61) where id = auth.uid()", E, "check")


@test("demo communities are flagged and listed")
def _():
    ex = j("select explore_communities()", A)
    assert sum(1 for c in ex["communities"] if c["is_demo"]) == 3


print("\nAccount deletion")


@test("delete account requires typed confirmation and hands off parties")
def _():
    pid = ok("select create_party(p_game => 'valorant', p_title => 'Handoff', p_max_size => 5)", C)
    iid = ok(f"select invite_to_party('{pid}', '{A}')", C)
    ok(f"select respond_party_invite('{iid}', true)", A)
    fails("select delete_my_account('wrong')", C, "type your username")
    ok("select delete_my_account('cara_test')", C)
    assert ok(f"select count(*) from auth.users where id = '{C}'") == "0"
    assert ok(f"select count(*) from profiles where id = '{C}'") == "0"
    assert ok(f"select leader_id from parties where id = '{pid}'") == A


print("\nDemo data")


@test("demo accounts are flagged, have no password, and never show online")
def _():
    assert ok("select count(*) from profiles where is_demo") == "28"
    assert ok("select count(*) from auth.users where email like '%@partyup.invalid' and coalesce(encrypted_password,'') <> ''") == "0"
    assert ok("select count(*) from public_profiles where is_demo and status <> 'offline'", A) == "0"


@test("remove_demo.sql deletes demo data only")
def _():
    real_before = ok("select count(*) from profiles where not is_demo")
    r = subprocess.run(["psql", "-X", "-q", "-v", "ON_ERROR_STOP=1", "-f", os.path.join(HERE, "..", "supabase", "remove_demo.sql")],
                       env=ENV, capture_output=True, text=True)
    assert r.returncode == 0, r.stderr
    assert ok("select count(*) from profiles where is_demo") == "0"
    assert ok("select count(*) from parties where is_demo") == "0"
    assert ok("select count(*) from profiles where not is_demo") == real_before


print(f"\n{passed} passed, {len(failed)} failed")
sys.exit(1 if failed else 0)
