"""End-to-end UI test: two users sign up, onboard, discover each other, form a
party, chat, message, report, and a moderator resolves the report.

Requires tests/test_server.mjs running on :5199 against a freshly seeded DB.
    python3 tests/e2e.py
"""
import os, re, subprocess, sys, time
from playwright.sync_api import sync_playwright, expect

BASE = "http://localhost:5199/"
SHOTS = os.path.join(os.path.dirname(__file__), "shots")
os.makedirs(SHOTS, exist_ok=True)
ENV = dict(os.environ, PGHOST=os.environ.get("PGHOST", "/tmp"), PGPORT=os.environ.get("PGPORT", "5433"),
           PGUSER=os.environ.get("PGUSER", "postgres"), PGDATABASE="partyup_test")
errors = []
steps = []


def db(sql):
    return subprocess.run(["psql", "-X", "-At", "-c", sql], env=ENV, capture_output=True, text=True).stdout.strip()


def step(name):
    steps.append(name)
    print(f"  · {name}")


def watch(page, who):
    page.on("console", lambda m: errors.append(f"[{who}] console {m.type}: {m.text}") if m.type == "error" else None)
    page.on("pageerror", lambda e: errors.append(f"[{who}] pageerror: {e}"))
    page.route(re.compile(r"https://fonts\.(googleapis|gstatic)\.com/.*"), lambda r: r.abort())


def shot(page, name):
    page.screenshot(path=os.path.join(SHOTS, f"{name}.png"), full_page=False)


def signup(page, email):
    page.goto(BASE)
    expect(page.get_by_role("heading", name="Sign in")).to_be_visible()
    page.get_by_role("link", name="Create an account").click()
    page.get_by_label("Email").fill(email)
    page.get_by_label("Password", exact=True).fill("password123")
    page.get_by_label("Confirm password").fill("password123")
    page.get_by_role("button", name="Create account").click()
    expect(page.get_by_role("heading", name="Pick your name and look")).to_be_visible()


def toast(page, text):
    expect(page.locator(".toast", has_text=text).first).to_be_visible(timeout=8000)


with sync_playwright() as p:
    browser = p.chromium.launch()
    ctx = browser.new_context(viewport={"width": 1440, "height": 900})
    rosa = ctx.new_page(); watch(rosa, "rosa")

    print("User 1: sign up + full onboarding")
    signup(rosa, "rosa@test.dev"); step("sign up")
    shot(rosa, "01-onboarding")
    rosa.get_by_label("Username").fill("RosaQueue")
    expect(rosa.get_by_text("Available")).to_be_visible()
    rosa.locator(".preset").nth(2).click()
    rosa.get_by_role("button", name="Continue").click()
    expect(rosa.get_by_role("heading", name="Where do you play?")).to_be_visible()
    rosa.get_by_label("Region").select_option("na-east")
    rosa.get_by_role("group", name="Languages").get_by_role("button", name="English").click()
    rosa.get_by_role("group", name="Platforms").get_by_role("button", name="PC").click()
    rosa.get_by_role("button", name="Continue").click()
    expect(rosa.get_by_role("heading", name="What do you play?")).to_be_visible()
    rosa.locator(".game-pick-toggle", has_text="Valorant").click()
    rosa.get_by_label("Valorant rank").select_option("Platinum")
    rosa.get_by_label("Valorant main role").select_option("Controller")
    rosa.locator(".game-pick-toggle", has_text="Overwatch 2").click()
    shot(rosa, "02-onboarding-games")
    rosa.get_by_role("button", name="Continue").click()
    expect(rosa.get_by_role("heading", name="When do you usually play?")).to_be_visible()
    rosa.get_by_role("button", name="Weeknights").click()
    rosa.get_by_role("button", name="Continue").click()
    rosa.get_by_role("radio", name="Always on mic").click()
    rosa.get_by_role("group", name="Playstyle").get_by_role("button", name="Strategic").click()
    rosa.get_by_role("button", name="Continue").click()
    rosa.get_by_role("group", name="Teammate traits").get_by_role("button", name="Clear callouts").click()
    rosa.get_by_role("button", name="Finish setup").click()
    expect(rosa.get_by_role("heading", name="Ready to queue, RosaQueue?")).to_be_visible(timeout=10000)
    step("onboarding saved and dashboard shown")
    assert db("select count(*) from user_game_profiles g join profiles p on p.id=g.user_id where p.username='RosaQueue'") == "2"
    assert db("select rank from user_game_profiles g join profiles p on p.id=g.user_id where p.username='RosaQueue' and game_id='valorant'") == "Platinum"
    assert int(db("select cardinality(availability) from profiles where username='RosaQueue'")) == 40
    expect(rosa.locator(".player-card").first).to_be_visible(timeout=10000)
    rosa.wait_for_timeout(400)
    shot(rosa, "03-dashboard")

    print("Find players")
    rosa.get_by_role("link", name="Find Players").first.click()
    expect(rosa.locator(".player-card").first).to_be_visible()
    rosa.get_by_label("Game", exact=True).select_option("valorant")
    expect(rosa.get_by_label("Min rank")).to_be_visible()
    rosa.wait_for_timeout(800)
    n_val = rosa.locator(".player-card").count()
    assert n_val >= 5, n_val
    scores = [int(s) for s in rosa.locator(".player-card .signal-num").all_inner_texts()]
    assert scores == sorted(scores, reverse=True), scores
    step(f"valorant filter: {n_val} players, sorted by score {scores[:5]}")
    shot(rosa, "04-find-players")
    rosa.get_by_label("Language").select_option("ja")
    rosa.wait_for_timeout(800)
    assert rosa.locator(".player-card").count() == 1
    rosa.get_by_label("Region").select_option("oce")
    expect(rosa.get_by_text("No players match these filters")).to_be_visible()
    step("empty state suggests relaxing filters")
    shot(rosa, "05-find-empty")
    rosa.get_by_role("button", name=re.compile("^Remove Oceania")).click()
    expect(rosa.locator(".player-card")).to_have_count(1)
    rosa.get_by_role("button", name="Reset").click()
    rosa.wait_for_timeout(600)

    # compatibility breakdown dialog
    rosa.locator(".compat-btn").first.click()
    expect(rosa.get_by_role("dialog").get_by_text("not a guarantee")).to_be_visible()
    shot(rosa, "06-compat-breakdown")
    rosa.keyboard.press("Escape")
    step("compatibility breakdown dialog")

    print("Player profile")
    rosa.locator(".top-search input").fill("NovaStrike")
    rosa.keyboard.press("Enter")
    expect(rosa.locator(".player-card")).to_have_count(1)
    rosa.locator(".player-card .pc-id").click()
    expect(rosa.get_by_role("heading", name=re.compile("NovaStrike"))).to_be_visible()
    expect(rosa.get_by_text("Self-reported").first).to_be_visible()
    rosa.get_by_role("button", name="Add Friend").click()
    toast(rosa, "Friend request sent")
    expect(rosa.get_by_role("button", name="Requested")).to_be_visible()
    step("profile + friend request to demo player")
    shot(rosa, "07-profile")

    print("Create party")
    rosa.goto(BASE + "#/parties/new")
    rosa.get_by_label("Game").select_option("valorant")
    rosa.get_by_label("Title").fill("Rosa's evening ranked")
    rosa.get_by_label("Describe the session").fill("Chill comms, trying to climb out of Plat.")
    rosa.get_by_label("Party size").select_option("2")
    rosa.get_by_role("group", name="Needed roles").get_by_role("button", name="Duelist").click()
    shot(rosa, "08-create-party")
    rosa.get_by_role("button", name="Create party").click()
    toast(rosa, "Party created")
    expect(rosa.get_by_role("heading", name="Rosa's evening ranked")).to_be_visible()
    expect(rosa.locator(".slots-row")).to_contain_text("1/2")
    party_url = rosa.url
    step("party created")

    print("User 2: sign up, skip onboarding, request to join")
    ctx2 = browser.new_context(viewport={"width": 390, "height": 844}, is_mobile=True, has_touch=True)
    bravo = ctx2.new_page(); watch(bravo, "bravo")
    signup(bravo, "bravo@test.dev")
    bravo.get_by_label("Username").fill("TeamBravo")
    expect(bravo.get_by_text("Available")).to_be_visible()
    bravo.get_by_role("button", name="Continue").click()
    for _ in range(4):
        bravo.get_by_role("button", name="Skip for now").click()
    bravo.get_by_role("button", name="Skip and finish").click()
    expect(bravo.get_by_role("heading", name="Ready to queue, TeamBravo?")).to_be_visible()
    shot(bravo, "09-mobile-dashboard")
    step("second user onboarded with skips (mobile viewport)")

    bravo.locator(".bottom-nav").get_by_role("link", name="Parties").click()
    bravo.get_by_placeholder("Search parties").fill("Rosa")
    expect(bravo.locator(".party-card")).to_have_count(1, timeout=8000)
    shot(bravo, "10-mobile-parties")
    bravo.locator(".party-card .party-link").click()
    bravo.get_by_role("button", name="Request to join").click()
    bravo.get_by_label("Message to the leader").fill("Duelist main, gold-plat.")
    bravo.get_by_role("button", name="Send request").click()
    toast(bravo, "Request sent")
    expect(bravo.get_by_text("waiting for the leader")).to_be_visible()
    step("join request sent")

    print("Leader accepts")
    rosa.goto(party_url); rosa.reload()
    expect(rosa.get_by_text("Duelist main, gold-plat.")).to_be_visible()
    rosa.get_by_role("button", name="Accept", exact=True).click()
    toast(rosa, "TeamBravo joined")
    expect(rosa.locator(".slots-row")).to_contain_text("2/2")
    expect(rosa.locator(".party-hero .party-status")).to_have_text("Full")
    assert db("select member_count from parties where title = 'Rosa''s evening ranked'") == "2"
    step("request accepted; party shows Full 2/2")

    print("Party chat (polling fallback)")
    bravo.reload()
    expect(bravo.get_by_text("Updating every few seconds")).to_be_visible(timeout=8000)
    bravo.get_by_label("Message", exact=True).fill("gl hf! ready when you are")
    bravo.get_by_role("button", name="Send").click()
    expect(bravo.locator(".msg-text", has_text="gl hf! ready when you are")).to_be_visible()
    expect(rosa.locator(".msg-text", has_text="gl hf! ready when you are")).to_be_visible(timeout=9000)
    step("party chat delivered to other member via polling")
    shot(rosa, "11-party-page")
    shot(bravo, "12-mobile-party-chat")

    print("Direct messages + unread badge")
    rosa.goto(BASE + "#/friends")
    rosa.goto(BASE + "#/players?q=TeamBravo")
    expect(rosa.locator(".player-card")).to_have_count(1, timeout=8000)
    rosa.locator(".player-card").get_by_role("button", name="Add friend").click()
    toast(rosa, "Friend request sent to TeamBravo")
    rosa.locator(".player-card .pc-id").click()
    rosa.get_by_role("button", name="Message").click()
    expect(rosa).to_have_url(re.compile(r"#/messages/"))
    rosa.get_by_label("Message", exact=True).fill("Nice games tonight. Same time tomorrow?")
    rosa.keyboard.press("Enter")
    expect(rosa.locator(".msg-text", has_text="Same time tomorrow?")).to_be_visible()
    shot(rosa, "13-messages")
    bravo.goto(BASE + "#/")
    bravo.reload()
    expect(bravo.locator(".bottom-nav .dot-badge").first).to_be_visible(timeout=20000)
    bravo.locator(".bell .icon-btn").click()
    expect(bravo.locator(".bell-pop")).to_contain_text("RosaQueue")
    shot(bravo, "14-mobile-notifications")
    bravo.locator(".bell-pop .notif", has_text="friend request").get_by_role("button", name="Accept").click()
    toast(bravo, "now friends")
    bravo.locator(".bell-pop .notif-main", has_text="New message").click()
    expect(bravo.locator(".msg-text", has_text="Same time tomorrow?")).to_be_visible()
    step("DM + notifications + friend accept from bell")

    print("Leadership transfer + leave")
    rosa.goto(party_url)
    rosa.get_by_role("button", name="Manage TeamBravo").click()
    rosa.get_by_role("menuitem", name="Make leader").click()
    rosa.get_by_role("dialog").get_by_role("button", name="Transfer leadership").click()
    toast(rosa, "TeamBravo is now the leader")
    expect(rosa.get_by_role("button", name="Edit")).to_have_count(0)
    bravo.goto(party_url); bravo.reload()
    bravo.get_by_role("button", name="Leave").click()
    expect(bravo.get_by_role("dialog")).to_contain_text("Leadership passes to RosaQueue")
    assert not bravo.evaluate("document.documentElement.scrollWidth > window.innerWidth + 1"), "party page overflows on mobile"
    bravo.get_by_role("dialog").get_by_role("button", name="Leave party").click()
    toast(bravo, "You left the party")
    rosa.reload()
    expect(rosa.get_by_role("button", name="Edit")).to_be_visible()
    expect(rosa.locator(".party-hero .party-status")).to_have_text("Open")
    step("leadership transfer, leave hands leadership back, slot reopens")

    print("Quick Match + game profile edit")
    rosa.goto(BASE + "#/match")
    expect(rosa.locator(".player-card").first).to_be_visible(timeout=8000)
    shot(rosa, "15a-quick-match")
    rosa.goto(BASE + "#/games")
    rosa.locator(".gp-card", has_text="Valorant").get_by_role("button", name="Edit").click()
    rosa.get_by_label("Current rank").select_option("Diamond")
    rosa.get_by_role("group", name="Modes").get_by_role("button", name="Premier").click()
    rosa.get_by_role("button", name="Save changes").click()
    toast(rosa, "Game profile saved")
    assert db("select rank || ':' || rank_index || ':' || array_to_string(preferred_modes, ',') from user_game_profiles g join profiles p on p.id = g.user_id where p.username = 'RosaQueue' and game_id = 'valorant'") == "Diamond:5:Premier"
    shot(rosa, "15b-game-profiles")
    step("quick match results; game profile edit persisted")

    print("Report flow + moderation")
    bravo.goto(BASE + f"#/players/{db("select id from profiles where username = 'RosaQueue'")}")
    bravo.get_by_role("button", name="More actions").click()
    bravo.get_by_role("menuitem", name="Report Player").click()
    bravo.get_by_text("Spam or scams").click()
    bravo.get_by_label("What happened?").fill("Testing the report flow end to end.")
    bravo.get_by_role("button", name="Submit report").click()
    expect(bravo.get_by_text("Report sent")).to_be_visible()
    bravo.get_by_role("button", name="Done").click()
    step("report submitted")
    # non-moderator cannot open moderation
    bravo.goto(BASE + "#/moderation")
    expect(bravo.get_by_text("Moderator access required")).to_be_visible()

    mod = ctx.new_page(); watch(mod, "mod")
    db("insert into user_roles select id, 'moderator' from profiles where username = 'RosaQueue' on conflict do nothing")
    # Rosa can't review the report about herself, so seed one about Bravo for her to handle
    bid = db("select id from profiles where username='TeamBravo'"); rid_ = db("select id from profiles where username='RosaQueue'")
    db(f"insert into reports (reporter_id, reported_user_id, reported_username, category, description) values ('{rid_}', '{bid}', 'TeamBravo', 'harassment', 'Seed report to test the moderator flow.')")
    rosa.goto(BASE); rosa.reload()
    rosa.get_by_role("link", name="Moderation").first.click()
    expect(rosa.get_by_role("cell", name=re.compile("TeamBravo")).first).to_be_visible()
    shot(rosa, "15-moderation-queue")
    rosa.get_by_role("cell", name=re.compile("TeamBravo")).first.click()
    rosa.get_by_label("Status", exact=True).select_option("resolved")
    rosa.get_by_label("Action", exact=True).select_option("warning")
    rosa.get_by_label("Internal note").fill("First offence, warned.")
    rosa.get_by_role("button", name="Save").click()
    toast(rosa, "Report updated")
    expect(rosa.locator(".page-head .badge")).to_have_text("resolved")
    expect(rosa.get_by_text("First offence, warned.").first).to_be_visible()
    shot(rosa, "16-moderation-detail")
    assert db(f"select count(*) from notifications where user_id='{bid}' and type='moderation'") == "1"
    # moderator cannot act on a report about themselves
    own = db("select id from reports where reported_username='RosaQueue'")
    rosa.goto(BASE + f"#/moderation/{own}")
    rosa.get_by_label("Status", exact=True).select_option("dismissed")
    rosa.get_by_role("button", name="Save").click()
    expect(rosa.get_by_text("can't moderate a report about yourself")).to_be_visible()
    step("moderator queue, warning action, self-report guard")

    print("Settings: privacy + block")
    rosa.goto(BASE + "#/settings/privacy")
    rosa.get_by_text("Ranks", exact=True).click()
    rosa.get_by_role("button", name="Save changes").click()
    toast(rosa, "Settings saved")
    assert db("select show_ranks from profiles where username='RosaQueue'") == "f"
    shot(rosa, "17-settings-privacy")
    bravo.goto(BASE + f"#/players/{rid_}")
    expect(bravo.locator(".gp-card").first).not_to_contain_text("Platinum")
    bravo.get_by_role("button", name="More actions").click()
    bravo.get_by_role("menuitem", name="Block").click()
    bravo.get_by_role("dialog").get_by_role("button", name="Block").click()
    expect(bravo.get_by_text("You blocked RosaQueue")).to_be_visible()
    rosa.goto(BASE + f"#/players/{bid}")
    expect(rosa.get_by_text("Player not found")).to_be_visible()
    step("privacy toggle hides rank; block hides profile both ways")

    print("Delete account")
    bravo.goto(BASE + "#/settings/account")
    bravo.get_by_role("button", name="Delete account").click()
    bravo.get_by_role("dialog").get_by_role("textbox").fill("TeamBravo")
    bravo.get_by_role("button", name="Delete my account").click()
    expect(bravo.get_by_role("heading", name="Sign in")).to_be_visible(timeout=10000)
    assert db("select count(*) from profiles where username='TeamBravo'") == "0"
    step("account deleted after typed confirmation")

    print("Responsive screenshots")
    tab = browser.new_context(viewport={"width": 820, "height": 1180}).new_page(); watch(tab, "tablet")
    tab.goto(BASE); tab.evaluate("t => localStorage.setItem('shim.session', t)", rosa.evaluate("localStorage.getItem('shim.session')"))
    tab.reload(); tab.goto(BASE + "#/players"); expect(tab.locator(".player-card").first).to_be_visible(); shot(tab, "18-tablet-find")
    m = browser.new_context(viewport={"width": 390, "height": 844}, is_mobile=True).new_page(); watch(m, "mobile")
    m.goto(BASE); m.evaluate("t => localStorage.setItem('shim.session', t)", rosa.evaluate("localStorage.getItem('shim.session')"))
    m.reload(); m.goto(BASE + "#/players"); expect(m.locator(".player-card").first).to_be_visible(); shot(m, "20-mobile-find")
    m.get_by_role("button", name=re.compile("^Filters")).click(); m.wait_for_timeout(400); shot(m, "21-mobile-filters")
    m.goto(BASE + "#/settings/availability"); m.wait_for_timeout(500); shot(m, "22-mobile-availability")
    for route in ["#/", "#/players", "#/match", "#/parties", "#/parties/new", "#/" + party_url.split("#/")[1], "#/friends",
                  "#/messages", "#/games", "#/notifications", "#/settings/profile", "#/settings/privacy", "#/settings/safety",
                  "#/settings/account", "#/moderation", f"#/players/{rid_}"]:
        m.goto(BASE + route); m.wait_for_timeout(700)
        wide = m.evaluate("[...document.querySelectorAll('body *')].filter(e => e.getBoundingClientRect().right > window.innerWidth + 1 && !e.closest('.sidebar,.filters,.toasts,.settings-nav')).slice(0,3).map(e => e.className || e.tagName)")
        assert not wide, f"horizontal overflow on mobile at {route}: {wide}"
    step("no horizontal overflow on 16 mobile routes")
    browser.close()

real_errors = [e for e in errors if "fonts.g" not in e and "ERR_FAILED" not in e]
print(f"\n{len(steps)} steps passed")
if real_errors:
    print("Console errors:"); [print("  ", e) for e in real_errors[:30]]
    sys.exit(1)
