"""End-to-end test for the Discord-style features: communities, channels, invites,
roles, mentions, replies, reactions, edits, deletes, pins, search, typing, group DMs,
custom status and muting. Run after tests/restart.sh (fresh seeded DB)."""
import os, re, subprocess, sys
from playwright.sync_api import sync_playwright, expect

BASE = "http://localhost:5199/"
SHOTS = os.path.join(os.path.dirname(__file__), "shots")
os.makedirs(SHOTS, exist_ok=True)
ENV = dict(os.environ, PGHOST=os.environ.get("PGHOST", "/tmp"), PGPORT=os.environ.get("PGPORT", "5433"),
           PGUSER=os.environ.get("PGUSER", "postgres"), PGDATABASE="partyup_test")
errors, steps = [], []


def db(sql):
    return subprocess.run(["psql", "-X", "-At", "-c", sql], env=ENV, capture_output=True, text=True).stdout.strip()


def step(name):
    steps.append(name); print(f"  · {name}")


def shot(page, name):
    page.screenshot(path=os.path.join(SHOTS, f"{name}.png"))


def watch(page, who):
    page.on("console", lambda m: errors.append(f"[{who}] {m.text}") if m.type == "error" else None)
    page.on("pageerror", lambda e: errors.append(f"[{who}] pageerror: {e}"))
    page.route(re.compile(r"https://fonts\.(googleapis|gstatic)\.com/.*"), lambda r: r.abort())


def toast(page, text):
    expect(page.locator(".toast", has_text=text).first).to_be_visible(timeout=8000)


def new_user(browser, email, username, viewport=(1440, 900)):
    ctx = browser.new_context(viewport={"width": viewport[0], "height": viewport[1]})
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
    expect(page.get_by_role("heading", name=f"Ready to queue, {username}?")).to_be_visible()
    return page


def composer(page):
    return page.get_by_label("Message", exact=True)


def send(page, text):
    composer(page).fill(text)
    composer(page).press("Enter")
    expect(page.locator(".msg-text", has_text=text).last).to_be_visible()


with sync_playwright() as p:
    browser = p.chromium.launch()
    kai = new_user(browser, "kai@test.dev", "KaiRanked")
    lena = new_user(browser, "lena@test.dev", "LenaFlex")
    step("two users onboarded")

    print("Explore and join a public community")
    kai.get_by_role("link", name="Explore communities").click()
    expect(kai.locator(".comm-card")).to_have_count(3)
    shot(kai, "s01-explore")
    kai.locator(".comm-card", has_text="Valorant NA Grind").get_by_role("button", name="Join").click()
    toast(kai, "Joined Valorant NA Grind")
    expect(kai.get_by_role("link", name="general")).to_be_visible()
    expect(kai.locator(".msg-text", has_text="Post your rank and main")).to_be_visible()
    expect(kai.locator(".rail-item.active")).to_have_count(1)
    shot(kai, "s02-channel")
    step("joined demo community; channel history visible")

    print("Reply, react, edit (Up arrow), delete")
    target = kai.locator(".msg", has_text="new map rotation")
    target.hover()
    target.get_by_role("button", name="Reply").click()
    expect(kai.locator(".reply-bar")).to_contain_text("SoftReset")
    send(kai, "agreed, B site is rough")
    reply = kai.locator(".msg", has_text="agreed, B site is rough")
    expect(reply.locator(".reply-ref")).to_contain_text("SoftReset")
    reply.hover(); reply.get_by_role("button", name="Add reaction").click()
    kai.get_by_role("menuitem", name="React 🔥").click()
    expect(reply.get_by_role("button", name=re.compile("🔥 1, you reacted"))).to_be_visible()
    composer(kai).press("ArrowUp")
    kai.get_by_label("Edit message").fill("agreed, B site is really rough")
    kai.get_by_label("Edit message").press("Enter")
    expect(kai.locator(".msg", has_text="really rough").locator(".edited")).to_be_visible()
    send(kai, "oops wrong channel")
    m = kai.locator(".msg", has_text="oops wrong channel"); m.hover()
    m.get_by_role("button", name="Delete message").click()
    kai.get_by_role("dialog").get_by_role("button", name="Delete").click()
    expect(kai.locator(".msg-text", has_text="Message deleted")).to_be_visible()
    expect(kai.locator(".msg-text", has_text="oops wrong channel")).to_have_count(0)
    assert db("select count(*) from message_reactions r join messages m on m.id = r.message_id where m.body like 'agreed%'") == "1"
    step("reply, reaction, edit via Up arrow, delete")

    print("Announcements are admin-only")
    kai.get_by_role("link", name="announcements").click()
    expect(kai.get_by_text("Only admins can post in announcement channels.")).to_be_visible()
    step("announcement channel blocks members")

    print("Private community + invite code")
    kai.get_by_role("button", name="Create or join a community").click()
    kai.get_by_label("Name").fill("Kai's Squad")
    kai.get_by_role("radio", name="#3e63dd").click()
    kai.get_by_text("Public", exact=True).click()
    kai.get_by_role("dialog").get_by_role("button", name="Create community").click()
    toast(kai, "Community created")
    expect(kai.locator(".side-head-btn")).to_contain_text("Kai's Squad")
    kai.locator(".side-head-btn").click()
    kai.get_by_role("menuitem", name="Invite people").click()
    kai.get_by_role("button", name="Create invite").click()
    code = kai.get_by_label("Invite code").input_value()
    assert re.fullmatch(r"[a-z0-9]{8}", code), code
    kai.keyboard.press("Escape")
    lena.get_by_role("button", name="Create or join a community").click()
    lena.get_by_role("radio", name="I have an invite").click()
    lena.get_by_label("Invite code or link").fill(f"https://example.com/#/invite/{code}")
    lena.get_by_role("dialog").get_by_role("button", name="Continue").click()
    expect(lena.get_by_role("heading", name=re.compile("Kai's Squad"))).to_be_visible()
    shot(lena, "s03-invite")
    lena.get_by_role("button", name="Accept invite").click()
    expect(lena.get_by_role("link", name="general")).to_be_visible()
    step("private community joined with pasted invite link")

    print("Mentions + typing indicator")
    kai.get_by_role("link", name="general").click()
    expect(lena.locator(".side-panel")).to_contain_text("KaiRanked")
    composer(lena).press_sequentially("hey @Kai")
    try:
        expect(lena.locator(".mention-pop")).to_contain_text("KaiRanked")
    except Exception:
        shot(lena, "zz-mention"); print("PANEL", lena.locator(".side-panel").inner_text() if lena.locator(".side-panel").count() else None, "VAL", composer(lena).input_value(), lena.url); raise
    composer(lena).press("Enter")  # pick suggestion
    expect(composer(lena)).to_have_value("hey @KaiRanked ")
    expect(kai.locator(".typing")).to_contain_text("LenaFlex is typing", timeout=8000)
    composer(lena).press_sequentially("want to queue?")
    composer(lena).press("Enter")
    expect(kai.locator(".msg.mention", has_text="want to queue?")).to_be_visible(timeout=9000)
    shot(kai, "s04-mention")
    kai.get_by_role("link", name="Home", exact=True).first.click()
    expect(kai.locator(".rail-mention")).to_have_count(0, timeout=6000)  # read on view
    step("@mention autocomplete, typing indicator, highlighted mention")

    print("Roles, pins, search, channels")
    kai.goto(BASE + "#/")
    kai.locator(".rail-btn[title=\"Kai's Squad\"]").click()
    kai.locator(".side-head-btn").click()
    kai.get_by_role("menuitem", name="Community settings").click()
    kai.get_by_role("button", name="Members").click()
    kai.get_by_role("button", name="Manage LenaFlex").click()
    kai.get_by_role("menuitem", name="Make admin").click()
    toast(kai, "LenaFlex is now an admin")
    kai.get_by_role("button", name="Channels").click()
    kai.locator(".panel").get_by_role("button", name="Create channel").click()
    kai.get_by_role("dialog").get_by_role("textbox").first.fill("Clips & Highlights")
    expect(kai.get_by_text("Will be #clips-highlights")).to_be_visible()
    kai.get_by_role("dialog").get_by_role("button", name="Create channel").click()
    toast(kai, "Channel created")
    expect(kai.locator(".chan-row", has_text="clips-highlights")).to_be_visible()
    shot(kai, "s05-community-settings")
    lena.reload()
    lena.get_by_role("link", name="announcements").click()
    send(lena, "Scrims Friday 9pm ET")
    lena.get_by_role("link", name="general").click()
    msg = lena.locator(".msg", has_text="want to queue?"); msg.hover()
    msg.get_by_role("button", name="Pin message").click()
    toast(lena, "Message pinned")
    lena.get_by_role("button", name=re.compile("^Pinned messages")).click()
    expect(lena.locator(".side-panel .result", has_text="want to queue?")).to_be_visible()
    lena.get_by_role("button", name="Search messages").click()
    lena.locator(".side-panel").get_by_label("Search messages").fill("queue")
    lena.locator(".side-panel").get_by_label("Search messages").press("Enter")
    expect(lena.locator(".side-panel .result")).to_have_count(1)
    lena.locator(".side-panel .result").click()
    shot(lena, "s06-pins-search")
    step("admin promotion, channel creation, admin announcement post, pin, search")

    print("Group DM")
    cara = new_user(browser, "cara@test.dev", "CaraHeals", viewport=(390, 844))
    for other in ("LenaFlex", "CaraHeals"):
        kai.goto(BASE + "#/friends")
        kai.get_by_label("Username to add").fill(other)
        kai.get_by_role("button", name="Send request").click()
        toast(kai, f"Friend request sent to {other}")
    for page in (lena, cara):
        page.goto(BASE + "#/friends?tab=requests"); page.reload()
        page.get_by_role("button", name="Accept").first.click()
        toast(page, "now friends")
    kai.goto(BASE + "#/"); kai.reload()
    kai.get_by_role("button", name="New group DM").click()
    kai.get_by_label("Group name").fill("Friday stack")
    kai.get_by_role("dialog").get_by_text("LenaFlex").click()
    kai.get_by_role("dialog").get_by_text("CaraHeals").click()
    kai.get_by_role("button", name="Create group (3)").click()
    expect(kai.locator(".conv-head")).to_contain_text("Friday stack")
    send(kai, "group check, 8pm?")
    cara.goto(BASE + "#/messages"); cara.reload()
    cara.locator(".conv", has_text="Friday stack").click()
    expect(cara.locator(".msg-text", has_text="group check, 8pm?")).to_be_visible()
    send(cara, "works for me")
    expect(kai.locator(".msg-text", has_text="works for me")).to_be_visible(timeout=9000)
    shot(kai, "s07-group-dm")
    shot(cara, "s08-mobile-group")
    step("group DM created from sidebar, messages both ways (mobile + desktop)")

    print("Custom status + mute")
    kai.get_by_role("button", name="Your status and account").click()
    kai.get_by_role("menuitem", name="Set a custom status").click()
    kai.get_by_role("textbox", name="Custom status").fill("scrimming till 11")
    kai.get_by_role("dialog").get_by_role("button", name="Save").click()
    toast(kai, "Custom status set")
    squad = db("select id from communities where name = 'Kai''s Squad'")
    lena.goto(BASE + f"#/c/{squad}"); lena.reload()
    expect(lena.locator(".side-panel .member-row", has_text="KaiRanked")).to_contain_text("scrimming till 11", timeout=8000)
    lena.get_by_role("button", name="Mute conversation").click()
    toast(lena, "Muted")
    assert db("select count(*) from conversation_members cm join profiles p on p.id = cm.user_id where p.username='LenaFlex' and cm.muted") == "1"
    step("custom status shown in member list; conversation mute persisted")

    print("Leave group, mobile overflow")
    cara.get_by_role("button", name="Group options").click()
    cara.get_by_role("menuitem", name="Leave group").click()
    cara.get_by_role("dialog").get_by_role("button", name="Leave group").click()
    toast(cara, "Left the group")
    cid = db("select id from communities where name = 'Valorant NA Grind'")
    for route in ["#/explore", f"#/c/{cid}", "#/messages", "#/friends", "#/settings/notifications"]:
        cara.goto(BASE + route); cara.wait_for_timeout(700)
        wide = cara.evaluate("[...document.querySelectorAll('body *')].filter(e => e.getBoundingClientRect().right > window.innerWidth + 1 && !e.closest('.nav-drawer,.filters,.toasts,.settings-nav,.side-panel')).slice(0,3).map(e => e.className || e.tagName)")
        assert not wide, f"overflow at {route}: {wide}"
    shot(cara, "s09-mobile-community")
    step("left group; no mobile overflow on community routes")
    browser.close()

real = [e for e in errors if "fonts.g" not in e and "ERR_FAILED" not in e]
print(f"\n{len(steps)} steps passed")
if real:
    print("Console errors:"); [print("  ", e) for e in real[:20]]; sys.exit(1)
