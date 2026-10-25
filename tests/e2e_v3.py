"""End-to-end test for v1.3 features: profile styles, game icons, official game
communities, voice channels and DM calls (real WebRTC between two browsers with
fake media devices), tournaments with the agreement, bracket, result reporting and
prize tracking, email-code screens, seasonal theme, and mobile layout.
Run after tests/restart.sh (fresh seeded DB)."""
import os, re, subprocess, sys, time
from playwright.sync_api import sync_playwright, expect

BASE = "http://localhost:5199/"
SHOTS = os.path.join(os.path.dirname(__file__), "shots")
os.makedirs(SHOTS, exist_ok=True)
ENV = dict(os.environ, PGHOST=os.environ.get("PGHOST", "/tmp"), PGPORT=os.environ.get("PGPORT", "5433"),
           PGUSER=os.environ.get("PGUSER", "postgres"), PGDATABASE="partyup_test")
errors, steps = [], []
IGNORED = re.compile(r"Failed to load resource.*(404|403)|net::ERR_FAILED|ERR_ABORTED")


def db(sql):
    return subprocess.run(["psql", "-X", "-At", "-c", sql], env=ENV, capture_output=True, text=True).stdout.strip()


def as_user(user, sql):
    pre = f"set role authenticated; select set_config('request.jwt.claims', '{{\"sub\": \"{user}\", \"role\": \"authenticated\"}}', false);"
    out = subprocess.run(["psql", "-X", "-At", "-v", "ON_ERROR_STOP=1"], input=pre + "\n" + sql, env=ENV, capture_output=True, text=True)
    assert out.returncode == 0, out.stderr
    return out.stdout.strip().splitlines()[-1]


def step(name):
    steps.append(name); print(f"  · {name}", flush=True)


def shot(page, name):
    page.screenshot(path=os.path.join(SHOTS, f"v3-{name}.png"))


def watch(page, who):
    page.on("console", lambda m: errors.append(f"[{who}] {m.text}") if m.type == "error" and not IGNORED.search(m.text) else None)
    page.on("pageerror", lambda e: errors.append(f"[{who}] pageerror: {e}"))
    page.route(re.compile(r"https://fonts\.(googleapis|gstatic)\.com/.*"), lambda r: r.abort())


def toast(page, text):
    expect(page.locator(".toast", has_text=text).first).to_be_visible(timeout=10000)


def new_user(browser, email, username, viewport=(1440, 900)):
    ctx = browser.new_context(viewport={"width": viewport[0], "height": viewport[1]}, permissions=["microphone", "camera"])
    page = ctx.new_page(); watch(page, username)
    page.goto(BASE)
    page.get_by_role("link", name="Create an account").click()
    page.get_by_label("Email").fill(email)
    page.get_by_label("Password", exact=True).fill("password123")
    page.get_by_label("Confirm password").fill("password123")
    page.get_by_role("button", name="Create account").click()
    page.get_by_label("Username").fill(username)
    expect(page.get_by_text("Available")).to_be_visible()
    page.get_by_role("button", name="Continue").click()
    page.get_by_label("Region").select_option("na-east")
    page.get_by_role("group", name="Languages").get_by_role("button", name="English").click()
    page.get_by_role("button", name="Continue").click()
    for _ in range(3):
        page.get_by_role("button", name="Skip for now").click()
    page.get_by_role("button", name="Skip and finish").click()
    expect(page.locator(".dash-hero h1", has_text=username)).to_be_visible()
    return page


def uid(username):
    return db(f"select id from profiles where username = '{username}'")


def peers_connected(page):
    return page.evaluate("""() => [...document.querySelectorAll('audio[data-peer-audio]')]
        .filter(a => a.srcObject && a.srcObject.getAudioTracks().some(t => t.readyState === 'live')).length""")


def wait_for(fn, timeout=25, what="condition"):
    end = time.time() + timeout
    while time.time() < end:
        try:
            if fn():
                return
        except Exception:  # noqa
            pass
        time.sleep(0.5)
    raise AssertionError(f"timed out waiting for {what}")


with sync_playwright() as p:
    browser = p.chromium.launch(args=["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", "--autoplay-policy=no-user-gesture-required"])

    print("Email code screens")
    ctx = browser.new_context(); anon = ctx.new_page(); watch(anon, "anon")
    anon.goto(BASE + "#/forgot")
    anon.get_by_label("Email").fill("someone@test.dev")
    anon.get_by_role("button", name="Send reset code").click()
    expect(anon.get_by_label("Reset code")).to_be_visible()
    anon.get_by_label("Reset code").fill("123456")
    anon.get_by_role("button", name="Continue").click()
    expect(anon.get_by_text("That code didn't work")).to_be_visible()
    shot(anon, "01-reset-code")
    step("reset-by-code screen shows big code entry and a clear error for a wrong code")
    anon.goto(BASE + "#/login")
    expect(anon.locator(".auth-fact p")).to_be_visible()
    step("sign-in page shows rotating tips / facts")
    ctx.close()

    ava = new_user(browser, "ava@test.dev", "AvaHost")
    ben = new_user(browser, "ben@test.dev", "BenFrag")
    cid = new_user(browser, "cid@test.dev", "CidClutch")
    A, B, C = uid("AvaHost"), uid("BenFrag"), uid("CidClutch")
    db(f"insert into friendships (requester_id, addressee_id, status, responded_at) values ('{A}', '{B}', 'accepted', now()), ('{B}', '{C}', 'accepted', now())")
    step("three users onboarded; Ava↔Ben and Ben↔Cid are friends")

    print("Seasonal theme & personality")
    expect(ava.locator("body.season-halloween")).to_have_count(1)
    expect(ava.locator(".season-decor .bat").first).to_be_attached()
    expect(ava.locator(".season-banner")).to_be_visible()
    expect(ava.get_by_role("heading", name="Did you know?")).to_be_visible()
    shot(ava, "02-dashboard-halloween")
    ava.goto(BASE + "#/settings/account")
    ava.get_by_role("switch", name="Seasonal decorations").uncheck(force=True)
    expect(ava.locator("body.season-halloween")).to_have_count(0)
    ava.get_by_role("switch", name="Seasonal decorations").check(force=True)
    expect(ava.locator("body.season-halloween")).to_have_count(1)
    ava.goto(BASE + "#/does-not-exist")
    expect(ava.get_by_role("heading", name="This page ghosted you")).to_be_visible()
    step("Halloween decorations, banner, did-you-know card, toggle, playful 404")

    print("Profile style")
    ava.goto(BASE + "#/settings/style")
    ava.get_by_role("radiogroup", name="Name style").get_by_role("radio", name="Sunset").click()
    ava.get_by_role("radiogroup", name="Avatar decoration").get_by_role("radio", name="Orbit").click()
    ava.get_by_role("radiogroup", name="Profile effect").get_by_role("radio", name="Sparkles").click()
    ava.get_by_role("radiogroup", name="Banner").get_by_role("radio", name="Synthwave").click()
    ava.get_by_role("radiogroup", name="Status emoji").get_by_role("radio", name="🎮").click()
    expect(ava.locator(".style-preview .ns-sunset")).to_be_visible()
    shot(ava, "03-style-settings")
    ava.get_by_role("button", name="Save changes").click()
    toast(ava, "Settings saved")
    assert db(f"select name_style || avatar_decoration || profile_effect || banner_url || status_emoji from profiles where id = '{A}'") == "sunsetorbitsparklespreset:4🎮"
    ben.goto(BASE + f"#/players/{A}")
    expect(ben.locator(".profile-id .ns-sunset")).to_be_visible()
    expect(ben.locator(".profile-hero .deco-orbit")).to_be_attached()
    expect(ben.locator(".profile-banner .fx-sparkles")).to_be_attached()
    shot(ben, "04-styled-profile")
    step("profile style saved and shown to other players (name, decoration, effect, banner, emoji)")

    print("Game icons & official communities")
    ava.goto(BASE + "#/explore")
    first = ava.locator(".comm-card").first
    expect(first.locator(".official-check")).to_be_visible()
    expect(first.locator(".game-icon")).to_be_visible()
    shot(ava, "05-explore-official")
    ava.get_by_label("Search communities").fill("Valorant")
    card = ava.locator(".comm-card", has_text="Valorant").first
    card.get_by_role("button", name="Join").click()
    expect(ava.get_by_role("link", name="lobby")).to_be_visible()
    expect(ava.get_by_text("Official PartyUp community")).to_be_visible()
    val = db("select id from communities where is_official and game_id = 'valorant'")
    ben.goto(BASE + f"#/c/{val}")
    ben.get_by_role("button", name="Join community").click()
    expect(ben.get_by_role("link", name="lobby")).to_be_visible()
    step("official Valorant community with game icon, text and voice channels; joined by two users")

    print("Voice channel call (WebRTC)")
    lobby = db(f"select id from channels where community_id = '{val}' and name = 'lobby'")
    ava.goto(BASE + f"#/c/{val}/{lobby}")
    ava.get_by_role("button", name="Join voice").click()
    expect(ava.locator(".call-bar")).to_be_visible()
    expect(ava.locator(".call-tile")).to_have_count(1)
    ben.goto(BASE + f"#/c/{val}/{lobby}")
    expect(ben.get_by_text("is in voice")).to_be_visible(timeout=15000)
    ben.get_by_role("button", name="Join voice").click()
    expect(ben.locator(".call-tile")).to_have_count(2, timeout=15000)
    expect(ava.locator(".call-tile")).to_have_count(2, timeout=20000)
    wait_for(lambda: peers_connected(ava) >= 1 and peers_connected(ben) >= 1, 30, "audio to flow both ways")
    wait_for(lambda: ava.locator(".call-tile-state").count() == 0 and ben.locator(".call-tile-state").count() == 0, 30, "peers connected")
    expect(ava.locator(".voice-people .voice-person")).to_have_count(2, timeout=15000)
    step("two users in a voice channel: peer connection up, remote audio tracks live, sidebar shows who's in voice")
    ava.locator(".call-stage").get_by_role("button", name="Turn on camera").click()
    expect(ben.locator(".call-tile.has-video video")).to_have_count(1, timeout=25000)
    wait_for(lambda: ben.evaluate("() => { const v = document.querySelector('.call-tile.has-video video'); return v && v.videoWidth > 0; }"), 25, "remote video frames")
    shot(ben, "06-voice-video")
    ava.locator(".call-stage").get_by_role("button", name="Mute").click()
    expect(ben.locator(".call-tile", has_text="AvaHost").get_by_label("Muted")).to_be_visible(timeout=20000)
    step("camera turns on mid-call (renegotiation) and mute state reaches the other side")
    ava.goto(BASE + "#/players")
    expect(ava.locator(".call-bar")).to_be_visible()
    step("call keeps running while navigating; sidebar call bar")
    ava.locator(".call-bar").get_by_role("button", name="Leave call").click()
    expect(ava.locator(".call-bar")).to_have_count(0)
    expect(ben.locator(".call-tile")).to_have_count(1, timeout=20000)
    ben.locator(".call-stage").get_by_role("button", name="Leave call").click()
    step("leaving updates the other side")

    print("DM call with ringing")
    ava.goto(BASE + f"#/players/{B}")
    ava.get_by_role("button", name="Message").click()
    expect(ava.get_by_label("Start voice call")).to_be_visible()
    ava.get_by_label("Start voice call").click()
    expect(ava.locator(".call-bar")).to_be_visible()
    ben.goto(BASE + "#/")
    ring = ben.locator(".incoming-call", has_text="AvaHost is calling")
    expect(ring).to_be_visible(timeout=25000)
    shot(ben, "07-incoming-call")
    ring.get_by_role("button", name="Join").click()
    expect(ben.locator(".call-tile")).to_have_count(2, timeout=20000)
    wait_for(lambda: peers_connected(ben) >= 1 and peers_connected(ava) >= 1, 30, "DM call audio")
    step("DM call rings the other person, they join from the incoming-call card, audio connects")
    ben.locator(".call-bar").get_by_role("button", name="Leave call").click()
    ava.locator(".call-bar").get_by_role("button", name="Leave call").click()
    wait_for(lambda: db("select count(*) from voice_participants") == "0", 10, "call rows cleared")

    print("Tournaments")
    ava.goto(BASE + "#/tournaments")
    expect(ava.get_by_text("Never pay to enter a tournament")).to_be_visible()
    ava.get_by_role("button", name="Host a tournament").click()
    ava.get_by_label("Game").select_option("valorant")
    ava.get_by_label("Title").fill("Spooky Night Cup")
    ava.get_by_role("radiogroup", name="Bracket size").get_by_role("radio", name="4", exact=True).click()
    ava.get_by_role("radiogroup", name="Prize type").get_by_role("radio", name="Item").click()
    ava.get_by_label("Prize details").fill("Signed mousepad")
    ava.get_by_label("Rules").fill("Best of 1, Ascent. Screenshot the scoreboard.")
    ava.get_by_role("button", name="Create tournament").click()
    expect(ava.get_by_text("Read and accept the Tournament Agreement")).to_be_visible()
    ava.get_by_role("button", name="PartyUp Tournament Agreement").click()
    expect(ava.get_by_role("heading", name="2. No entry fees, buy-ins or gambling")).to_be_visible()
    ava.get_by_role("button", name="I agree").click()
    shot(ava, "08-create-tournament")
    ava.get_by_role("button", name="Create tournament").click()
    expect(ava.get_by_role("heading", name="Spooky Night Cup")).to_be_visible()
    tid = db("select id from tournaments where title = 'Spooky Night Cup'")
    assert db(f"select count(*) from tournament_agreements where tournament_id = '{tid}' and role = 'host'") == "1"
    step("host must accept the agreement; tournament created with an item prize")

    for page, name in ((ben, "Ben Squad"), (cid, "Cid Solo")):
        page.goto(BASE + f"#/tournaments/{tid}")
        page.get_by_role("button", name="Enter", exact=True).click()
        page.get_by_label("Name in the bracket").fill(name)
        page.get_by_role("button", name="Enter tournament").click()
        expect(page.get_by_text("Accept the Tournament Agreement to enter.")).to_be_visible()
        page.locator(".agree-row input").check()
        page.get_by_role("button", name="Enter tournament").click()
        toast(page, "You're in!")
    step("two players entered after accepting the agreement")

    ava.reload()
    ava.get_by_role("button", name="Start tournament").click()
    ava.get_by_role("button", name="Start now").click()
    toast(ava, "Bracket is live")
    expect(ava.locator(".bm")).to_have_count(1)
    shot(ava, "09-bracket")
    ben.reload()
    expect(ben.locator(".bm .bm-name", has_text="Ben Squad")).to_be_visible()
    ben.locator(".bm").get_by_role("button", name="Report").click()
    ben.get_by_role("radiogroup", name="Winner").get_by_role("radio", name="Ben Squad").click()
    ben.get_by_label("Score").fill("13-9")
    ben.get_by_role("button", name="Submit").click()
    toast(ben, "waiting for the other captain")
    cid.reload()
    expect(cid.get_by_text("waiting for confirmation")).to_be_visible()
    cid.locator(".bm").get_by_role("button", name="Confirm").click()
    cid.get_by_role("radiogroup", name="Winner").get_by_role("radio", name="Ben Squad").click()
    cid.get_by_role("button", name="Submit").click()
    toast(cid, "Result confirmed")
    step("captain reports, opponent confirms, bracket completes")

    ava.reload()
    ava.get_by_role("radio", name="Overview").click()
    expect(ava.locator(".t-results li.place-1", has_text="Ben Squad")).to_be_visible()
    ava.locator(".t-results li.place-1").get_by_role("button", name="Mark sent").click()
    toast(ava, "Marked as sent")
    ben.reload()
    ben.get_by_role("radio", name="Overview").click()
    ben.locator(".t-results li.place-1").get_by_role("button", name="I got it").click()
    toast(ben, "Thanks for confirming")
    assert db(f"select prize_status from tournament_entrants where tournament_id = '{tid}' and final_place = 1") == "received"
    shot(ben, "10-results")
    ben.goto(BASE + f"#/players/{A}")
    expect(ben.get_by_text("prizes confirmed paid")).to_be_visible()
    step("host marks prize sent, winner confirms, host record shows it")

    cid.goto(BASE + f"#/tournaments/{tid}")
    cid.get_by_role("button", name="Report").click()
    cid.get_by_label("What happened?").fill("Testing the report flow for this tournament")
    cid.get_by_role("button", name="Send report").click()
    toast(cid, "Report sent to moderators")
    assert db(f"select count(*) from reports where tournament_id = '{tid}'") == "1"
    step("tournament can be reported to moderators")

    print("Notifications")
    ben.goto(BASE + "#/notifications")
    expect(ben.get_by_text("started a call")).to_be_visible()
    expect(ben.get_by_text("Spooky Night Cup").first).to_be_visible()
    step("call and tournament notifications are readable")


    print("Ready beacons, XP, quests, GG, leaderboard")
    as_user(B, "insert into user_game_profiles (user_id, game_id) values (auth.uid(), 'valorant') on conflict do nothing")
    as_user(A, "insert into user_game_profiles (user_id, game_id) values (auth.uid(), 'valorant') on conflict do nothing")
    ava.goto(BASE + "#/")
    ava.locator("#ready-now-h").locator("..").locator("..").get_by_role("button", name="I'm ready to play").click()
    ava.get_by_label("Game").select_option("valorant")
    ava.get_by_label("Note").fill("ranked duo, mic on")
    ava.get_by_role("button", name="Go live").click()
    toast(ava, "Beacon lit")
    expect(ava.get_by_text("You're live")).to_be_visible()
    ben.goto(BASE + "#/ready")
    expect(ben.locator(".beacon-card", has_text="AvaHost")).to_be_visible()
    expect(ben.locator(".beacon-card", has_text="ranked duo, mic on")).to_be_visible()
    shot(ben, "12-ready-now")
    ben.goto(BASE + "#/notifications")
    expect(ben.get_by_text("is ready to play")).to_be_visible()
    step("Ready beacon goes live, shows on the board and pings friends who play the game")

    pid = as_user(A, "select create_party(p_game => 'valorant', p_title => 'GG Squad', p_max_size => 5)")
    inv = as_user(A, f"select invite_to_party('{pid}', '{B}')")
    as_user(B, f"select respond_party_invite('{inv}', true)")
    ben.goto(BASE + f"#/parties/{pid}")
    ben.locator(".member-list li", has_text="AvaHost").get_by_role("button", name="GG").click()
    ben.get_by_role("button", name="Clutch").click()
    toast(ben, "GG sent to AvaHost")
    ava.goto(BASE + "#/players/me")
    expect(ava.locator(".endorse-badge", has_text="Clutch")).to_be_visible()
    step("GG endorsement from the party page shows on the profile")

    ava.goto(BASE + "#/")
    expect(ava.locator(".xp-box .lvl").first).to_be_visible()
    expect(ava.locator(".quests li")).to_have_count(3)
    q = db("select x ->> 'id' from jsonb_array_elements(public._todays_quests()) x limit 1")
    kind = db(f"select x ->> 'kind' from jsonb_array_elements(public._todays_quests()) x where x ->> 'id' = '{q}'")
    target = int(db(f"select x ->> 'target' from jsonb_array_elements(public._todays_quests()) x where x ->> 'id' = '{q}'"))
    for i in range(target):
        db(f"select public._award('{A}', '{kind}', 'e2e{i}', 1)")
    ava.reload()
    ava.locator(".quests li.done").first.get_by_role("button", name=re.compile("^Claim")).click()
    toast(ava, "Quest complete")
    shot(ava, "13-quests")
    ava.goto(BASE + "#/leaderboard")
    expect(ava.locator(".podium-spot").first).to_be_visible()
    shot(ava, "14-leaderboard")
    step("XP bar, daily quest claim, leaderboard podium")

    print("Mobile layout")
    m = browser.new_context(viewport={"width": 390, "height": 844}, is_mobile=True).new_page(); watch(m, "mobile")
    m.goto(BASE); m.evaluate("t => localStorage.setItem('shim.session', t)", ava.evaluate("localStorage.getItem('shim.session')"))
    m.reload()
    for route in ["#/ready", "#/leaderboard", "#/", "#/tournaments", "#/tournaments/new", f"#/tournaments/{tid}", "#/settings/style", f"#/c/{val}/{lobby}", "#/explore", "#/tournaments/agreement"]:
        m.goto(BASE + route); m.wait_for_timeout(800)
        wide = m.evaluate("[...document.querySelectorAll('body *')].filter(e => e.getBoundingClientRect().right > window.innerWidth + 1 && !e.closest('.nav-drawer,.filters,.toasts,.settings-nav,.side-panel,.season-decor,.bracket,.segmented')).slice(0,3).map(e => e.className || e.tagName)")
        assert not wide, f"overflow at {route}: {wide}"
    shot(m, "11-mobile-tournament")
    step("no horizontal overflow on new screens at phone width")

    browser.close()

print(f"\n{len(steps)} steps passed")
if errors:
    print("Console errors:")
    for e in errors[:30]:
        print("  ", e)
    sys.exit(1)
