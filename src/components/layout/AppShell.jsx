import { createContext, useContext, useEffect, useRef, useState } from 'react';
import {
  LuHouse, LuSearch, LuUsers, LuUserPlus, LuMessageCircle, LuGamepad2, LuSettings, LuShieldCheck, LuBell, LuLogOut,
  LuChevronDown, LuCheck, LuMenu, LuX, LuZap, LuPlus, LuCompass, LuHash, LuMegaphone, LuLink, LuDoorOpen, LuBellOff,
  LuSmile, LuUser, LuVolume2, LuMicOff, LuBadgeCheck, LuTrophy,
} from 'react-icons/lu';
import { useCall } from '../../context/CallContext.jsx';
import * as api from '../../lib/api.js';
import { Link, navigate } from '../../lib/router.jsx';
import { useApp } from '../../context/AppContext.jsx';
import { STATUSES } from '../../lib/constants.js';
import { useAsync, useInterval } from '../../hooks/useAsync.js';
import { Avatar, StatusDot } from '../gaming.jsx';
import { cx, IconButton, Button, Input, Modal, InlineError, DemoBadge, Segmented } from '../ui.jsx';
import { useConfirm, useToast } from '../feedback.jsx';
import NotificationList from '../NotificationList.jsx';
import { CallBar } from '../CallUI.jsx';
import Logo, { LogoMark } from '../Logo.jsx';
import { CommunityIcon, CreateCommunityDialog, InviteDialog, NewGroupDialog } from '../CommunityDialogs.jsx';

// ---------- community data shared by the sidebar and the channel page ----------
const CommunityCtx = createContext(null);
export const useCommunity = () => useContext(CommunityCtx);

function useCommunityData(id) {
  const { onNotify, realtime } = useApp();
  const res = useAsync(() => (id ? api.getCommunity(id) : Promise.resolve(null)), [id]);
  const stale = res.data && res.data.id !== id;
  useEffect(() => onNotify(() => res.reload({ quiet: true })), [onNotify, res.reload]); // eslint-disable-line
  useInterval(() => res.reload({ quiet: true }), realtime ? 30_000 : 8_000, !!id);
  return stale ? { ...res, data: undefined, loading: true } : res;
}

const HOME_NAV = (counts, roles) => [
  { to: '/', label: 'Home', icon: LuHouse, exact: true },
  { to: '/players', label: 'Find Players', icon: LuSearch },
  { to: '/parties', label: 'Parties', icon: LuUsers, badge: counts.party_invites },
  { to: '/tournaments', label: 'Tournaments', icon: LuTrophy },
  { to: '/friends', label: 'Friends', icon: LuUserPlus, badge: counts.friend_requests },
  { to: '/messages', label: 'Messages', icon: LuMessageCircle, badge: counts.messages },
  { to: '/games', label: 'Game Profiles', icon: LuGamepad2 },
  { to: '/notifications', label: 'Notifications', icon: LuBell, badge: counts.mentions },
  { to: '/settings', label: 'Settings', icon: LuSettings },
  ...(roles.moderator ? [{ to: '/moderation', label: 'Moderation', icon: LuShieldCheck, badge: counts.open_reports }] : []),
];
const isActive = (item, path) => (item.exact ? path === item.to : path === item.to || path.startsWith(`${item.to}/`));

function Rail({ path, onCreate }) {
  const { communities, counts } = useApp();
  const inCommunity = path.startsWith('/c/');
  const activeId = inCommunity ? path.split('/')[2] : null;
  return (
    <nav className="rail" aria-label="Communities">
      <div className={cx('rail-item', !inCommunity && path !== '/explore' && 'active', counts.messages > 0 && 'unread')}>
        <Link to="/" className="rail-btn home" aria-label="Home" title="Home"><LogoMark size={26} /></Link>
        {counts.messages > 0 && <span className="rail-mention">{counts.messages > 99 ? '99+' : counts.messages}</span>}
      </div>
      <span className="rail-sep" />
      {(communities || []).map((c) => (
        <div key={c.id} className={cx('rail-item', activeId === c.id && 'active', c.unread && 'unread')}>
          <Link to={`/c/${c.id}`} className="rail-btn" aria-label={`${c.name}${c.mentions ? `, ${c.mentions} mentions` : ''}`} title={c.name}>
            <CommunityIcon community={c} />
          </Link>
          {c.mentions > 0 && <span className="rail-mention">{c.mentions}</span>}
        </div>
      ))}
      <div className="rail-item">
        <button type="button" className="rail-btn tool" aria-label="Create or join a community" title="Create or join a community" onClick={onCreate}><LuPlus /></button>
      </div>
      <div className={cx('rail-item', path === '/explore' && 'active')}>
        <Link to="/explore" className="rail-btn tool" aria-label="Explore communities" title="Explore communities"><LuCompass /></Link>
      </div>
    </nav>
  );
}

function convTitle(c, meId) {
  if (c.kind === 'party') return c.party?.title || 'Party chat';
  if (c.kind === 'group') return c.name || (c.members || []).map((m) => m.username).join(', ') || 'Group';
  return c.other?.username || 'Direct message';
}

function HomeSidebar({ path, onNewGroup }) {
  const { counts, roles, conversations, userId } = useApp();
  const nav = HOME_NAV(counts, roles);
  return (
    <>
      <div className="side-head"><Link to="/" className="brand"><Logo /></Link></div>
      <div className="side-scroll">
        {nav.map((item) => (
          <Link key={item.to} to={item.to} className={cx('side-link', isActive(item, path) && 'active')} aria-current={isActive(item, path) ? 'page' : undefined}>
            <item.icon aria-hidden /><span className="lbl">{item.label}</span>
            {item.badge ? <span className="nav-badge">{item.badge > 99 ? '99+' : item.badge}</span> : null}
          </Link>
        ))}
        <div className="side-section"><span>Direct messages</span><IconButton icon={LuPlus} label="New group DM" onClick={onNewGroup} /></div>
        {(conversations || []).slice(0, 30).map((c) => {
          const to = `/messages/${c.id}`;
          return (
            <Link key={c.id} to={to} className={cx('side-link dm', path === to && 'active', c.unread > 0 && !c.muted && 'unread', c.muted && 'muted-conv')}>
              {c.kind === 'direct' ? <Avatar user={c.other} size={30} status={c.other?.status} />
                : c.kind === 'group' ? <span className="group-icon"><LuUsers aria-hidden /></span>
                : <span className="conv-party"><LuGamepad2 aria-hidden /></span>}
              <span className="lbl">{convTitle(c, userId)}</span>
              {c.unread > 0 && !c.muted && <span className="nav-badge">{c.unread}</span>}
            </Link>
          );
        })}
        {conversations && conversations.length === 0 && <p className="muted small pad-x">No conversations yet.</p>}
      </div>
    </>
  );
}

function CommunitySidebar({ path }) {
  const { community: cres } = useCommunity();
  const call = useCall();
  const { refreshCounts } = useApp();
  const toast = useToast();
  const confirm = useConfirm();
  const [open, setOpen] = useState(false);
  const [inviting, setInviting] = useState(false);
  const [creating, setCreating] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const close = (e) => { if (!ref.current?.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);
  const c = cres.data;
  if (!c) return <div className="side-head"><span className="muted small">{cres.loading ? 'Loading…' : 'Community not found'}</span></div>;
  const admin = c.my_role === 'owner' || c.my_role === 'admin';
  const channelId = path.split('/')[3];
  const leave = () => confirm({
    title: `Leave ${c.name}?`, body: "You'll lose access to its channels until you join again.", confirmLabel: 'Leave community', danger: true,
    action: async () => { await api.leaveCommunity(c.id); refreshCounts(); navigate('/'); toast(`Left ${c.name}`); },
  });
  return (
    <>
      <div className="side-head" ref={ref} style={{ position: 'relative' }}>
        <button type="button" className="side-head-btn" onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-haspopup="menu">
          <span>{c.name}</span><LuChevronDown aria-hidden className={cx('caret', open && 'up')} />
        </button>
        {open && c.is_member && (
          <div className="menu menu-left" role="menu" style={{ left: 8, right: 8, top: 'calc(100% + 4px)' }}>
            <button type="button" role="menuitem" className="menu-item" onClick={() => { setOpen(false); setInviting(true); }} disabled={!c.is_public && !admin}><LuLink aria-hidden />Invite people</button>
            {admin && <Link to={`/c/${c.id}/settings`} className="menu-item" role="menuitem" onClick={() => setOpen(false)}><LuSettings aria-hidden />Community settings</Link>}
            {admin && <button type="button" role="menuitem" className="menu-item" onClick={() => { setOpen(false); setCreating(true); }}><LuPlus aria-hidden />Create channel</button>}
            {c.my_role !== 'owner' && <><div className="menu-sep" /><button type="button" role="menuitem" className="menu-item danger" onClick={() => { setOpen(false); leave(); }}><LuDoorOpen aria-hidden />Leave community</button></>}
          </div>
        )}
      </div>
      <div className="side-scroll">
        {c.is_demo && <p className="small muted pad-x" style={{ padding: '6px 8px' }}><DemoBadge /> Sample community</p>}
        {c.is_official && <p className="small muted pad-x official-note"><LuBadgeCheck aria-hidden /> Official PartyUp community</p>}
        <div className="side-section"><span>Text channels</span>{admin && <IconButton icon={LuPlus} label="Create channel" onClick={() => setCreating(true)} />}</div>
        {c.channels.filter((ch) => ch.kind !== 'voice').map((ch) => {
          const to = `/c/${c.id}/${ch.id}`;
          const active = channelId === ch.id;
          return (
            <Link key={ch.id} to={to} className={cx('side-link', active && 'active', ch.unread && !ch.muted && 'unread', ch.muted && 'muted-conv')}>
              {ch.kind === 'announcement' ? <LuMegaphone aria-hidden className="hash" /> : <LuHash aria-hidden className="hash" />}
              <span className="lbl">{ch.name}</span>
              {ch.muted && <LuBellOff aria-label="Muted" style={{ width: 14, height: 14 }} />}
              {ch.mentions > 0 && <span className="nav-badge">{ch.mentions}</span>}
            </Link>
          );
        })}
        {c.channels.some((ch) => ch.kind === 'voice') && <div className="side-section"><span>Voice channels</span></div>}
        {c.channels.filter((ch) => ch.kind === 'voice').map((ch) => {
          const to = `/c/${c.id}/${ch.id}`;
          const room = `channel:${ch.id}`;
          const people = call?.inRoom(room) ? call.session.participants : (ch.voice || []);
          return (
            <div key={ch.id}>
              <Link to={to} className={cx('side-link', channelId === ch.id && 'active')}>
                <LuVolume2 aria-hidden className="hash" /><span className="lbl">{ch.name}</span>
                {people.length > 0 && <span className="voice-count">{people.length}</span>}
              </Link>
              {people.length > 0 && (
                <div className="voice-people">
                  {people.map((p) => (
                    <span key={p.id} className={cx('voice-person', call?.inRoom(room) && call.session.speaking.has(p.id) && 'speaking')}>
                      <Avatar user={p} size={20} /><span>{p.username}</span>{p.muted && <LuMicOff aria-label="Muted" />}
                    </span>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
      {inviting && <InviteDialog community={c} onClose={() => setInviting(false)} />}
      {creating && <CreateChannelDialog community={c} onClose={(id) => { setCreating(false); if (id) { cres.reload({ quiet: true }); navigate(`/c/${c.id}/${id}`); } }} />}
    </>
  );
}

export function CreateChannelDialog({ community, onClose }) {
  const [name, setName] = useState('');
  const [topic, setTopic] = useState('');
  const [kind, setKind] = useState('text');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const submit = async (e) => {
    e?.preventDefault(); setBusy(true); setErr(null);
    try { onClose(await api.createChannel(community.id, name, topic, kind)); }
    catch (ex) { setErr(ex); setBusy(false); }
  };
  const preview = name.toLowerCase().trim().replace(/[\s_]+/g, '-').replace(/[^a-z0-9-]/g, '').replace(/-{2,}/g, '-').replace(/^-|-$/g, '').slice(0, 30);
  return (
    <Modal open onClose={() => onClose()} title="Create channel" size="sm"
      footer={<><Button variant="ghost" onClick={() => onClose()}>Cancel</Button><Button variant="primary" loading={busy} disabled={!preview} onClick={submit}>Create channel</Button></>}>
      <form onSubmit={submit} className="stack">
        <label className="field"><span className="field-label">Channel name</span>
          <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={40} placeholder="new-channel" data-autofocus />
          {preview && <span className="field-msg">Will be #{preview}</span>}
        </label>
        <label className="field"><span className="field-label">Topic <span className="optional">optional</span></span>
          <Input value={topic} onChange={(e) => setTopic(e.target.value)} maxLength={200} /></label>
        <div className="field"><span className="field-label">Type</span>
          <Segmented value={kind} onChange={setKind} options={[{ value: 'text', label: 'Text' }, { value: 'voice', label: 'Voice' }, { value: 'announcement', label: 'Announcements' }]} />
          <span className="field-msg">{kind === 'voice' ? 'Hang out with voice, video and screen share.' : kind === 'announcement' ? 'Only admins can post.' : 'Chat with messages, replies and reactions.'}</span>
        </div>
        <InlineError error={err} />
      </form>
    </Modal>
  );
}

function StatusPicker() {
  const { profile, updateProfile, signOut } = useApp();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const close = (e) => { if (!ref.current?.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);
  const shown = profile.status === 'invisible' ? 'offline' : profile.status;
  const set = async (status) => {
    setOpen(false);
    try { await updateProfile({ status }); toast(status === 'invisible' ? 'You now appear offline' : `Status set to ${status}`); }
    catch (e) { toast(e, 'error'); }
  };
  return (
    <div className="status-picker" ref={ref}>
      <button type="button" className="me-btn" onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-haspopup="menu" aria-label="Your status and account">
        <Avatar user={profile} size={32} status={shown} />
        <span className="me-text">
          <strong>{profile.username}</strong>
          <small>{profile.custom_status || STATUSES.find((s) => s.value === profile.status)?.label}</small>
        </span>
        <LuChevronDown aria-hidden className={cx('caret', open && 'up')} />
      </button>
      {open && (
        <div className="menu menu-up" role="menu">
          {STATUSES.map((s) => (
            <button key={s.value} type="button" role="menuitemradio" aria-checked={profile.status === s.value} className="menu-item" onClick={() => set(s.value)}>
              <StatusDot status={s.value === 'invisible' ? 'offline' : s.value} />
              <span className="grow">{s.label}</span>
              {profile.status === s.value && <LuCheck aria-hidden />}
            </button>
          ))}
          <div className="menu-sep" />
          <button type="button" role="menuitem" className="menu-item" onClick={() => { setOpen(false); setEditing(true); }}><LuSmile aria-hidden />{profile.custom_status ? 'Edit custom status' : 'Set a custom status'}</button>
          <Link to={`/players/${profile.id}`} role="menuitem" className="menu-item" onClick={() => setOpen(false)}><LuUser aria-hidden />View my profile</Link>
          <button type="button" role="menuitem" className="menu-item" onClick={signOut}><LuLogOut aria-hidden />Sign out</button>
        </div>
      )}
      {editing && <CustomStatusDialog onClose={() => setEditing(false)} />}
    </div>
  );
}

function CustomStatusDialog({ onClose }) {
  const { profile, updateProfile } = useApp();
  const toast = useToast();
  const [text, setText] = useState(profile.custom_status || '');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const save = async (value) => {
    setBusy(true); setErr(null);
    try { await updateProfile({ custom_status: value.trim() }); toast(value.trim() ? 'Custom status set' : 'Custom status cleared'); onClose(); }
    catch (e) { setErr(e); setBusy(false); }
  };
  return (
    <Modal open onClose={onClose} title="Custom status" size="sm"
      footer={<>{profile.custom_status && <Button variant="ghost" onClick={() => save('')} disabled={busy}>Clear</Button>}
        <Button variant="primary" loading={busy} onClick={() => save(text)}>Save</Button></>}>
      <Input value={text} maxLength={60} onChange={(e) => setText(e.target.value)} placeholder="e.g. grinding ranked, back at 9" aria-label="Custom status" data-autofocus
        onKeyDown={(e) => { if (e.key === 'Enter') save(text); }} />
      <p className="muted small">{text.length}/60. Shown next to your name in member lists and on your profile.</p>
      <InlineError error={err} />
    </Modal>
  );
}

function Bell() {
  const { counts, refreshCounts } = useApp();
  const [open, setOpen] = useState(false);
  const [ring, setRing] = useState(0);
  const prev = useRef(counts.notifications);
  useEffect(() => {
    if (counts.notifications > (prev.current || 0)) setRing((r) => r + 1);
    prev.current = counts.notifications;
  }, [counts.notifications]);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const close = (e) => { if (!ref.current?.contains(e.target)) setOpen(false); };
    const key = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', key);
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', key); };
  }, [open]);
  return (
    <div className={cx('bell', ring > 0 && 'ringing')} ref={ref} key={`bell-${ring}`}>
      <IconButton icon={LuBell} label={`Notifications${counts.notifications ? ` (${counts.notifications} unread)` : ''}`}
        badge={counts.notifications} onClick={() => setOpen((o) => !o)} aria-expanded={open} />
      {open && (
        <div className="popover bell-pop">
          <NotificationList compact limit={8} onNavigate={() => setOpen(false)} onChange={refreshCounts} />
          <Link to="/notifications" className="popover-foot" onClick={() => setOpen(false)}>All notifications</Link>
        </div>
      )}
    </div>
  );
}

const FLUSH = (path) => (path.startsWith('/c/') && !path.endsWith('/settings')) || path.startsWith('/messages/');

export default function AppShell({ path, children }) {
  const { counts, roles, profile } = useApp();
  const [drawer, setDrawer] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newGroup, setNewGroup] = useState(false);
  const [q, setQ] = useState('');
  useEffect(() => { setDrawer(false); }, [path]);
  const communityId = path.startsWith('/c/') ? path.split('/')[2] : null;
  const community = useCommunityData(communityId);
  const suspended = profile.suspended_until && new Date(profile.suspended_until) > new Date();
  const nav = HOME_NAV(counts, roles);
  const bottom = [nav[0], nav[1], nav[2], nav[5], nav[3]];

  return (
    <CommunityCtx.Provider value={{ community }}>
      <div className="shell">
        <div className={cx('nav-drawer', drawer && 'open')}>
          <Rail path={path} onCreate={() => setCreating(true)} />
          <aside className="sidebar" aria-label={communityId ? 'Channels' : 'Navigation'}>
            <button type="button" className="icon-btn drawer-x" style={{ position: 'absolute', right: 6, top: 10, zIndex: 2 }} aria-label="Close menu" onClick={() => setDrawer(false)}><LuX /></button>
            {communityId ? <CommunitySidebar path={path} /> : <HomeSidebar path={path} onNewGroup={() => setNewGroup(true)} />}
            <div className="side-foot"><CallBar /><StatusPicker /></div>
          </aside>
        </div>
        {drawer && <div className="drawer-scrim" onClick={() => setDrawer(false)} aria-hidden />}
        <div className="main-col">
          <header className="topbar">
            <IconButton icon={LuMenu} label="Open menu" className="menu-toggle" onClick={() => setDrawer(true)} />
            <Link to="/" className="brand brand-mobile" aria-label="PartyUp home"><Logo small /></Link>
            <form className="top-search" role="search" onSubmit={(e) => { e.preventDefault(); navigate(`/players${q.trim() ? `?q=${encodeURIComponent(q.trim())}` : ''}`); }}>
              <LuSearch aria-hidden />
              <input type="search" placeholder="Search players" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search players" />
            </form>
            <div className="top-actions">
              <Button variant="primary" icon={LuZap} className="find-btn" onClick={() => navigate('/match')}>Find Teammates</Button>
              <Bell />
            </div>
          </header>
          {suspended && (
            <div className="banner banner-warn" role="status">
              Your account is suspended until {new Date(profile.suspended_until).toLocaleString()}. You can browse, but you can't message, invite or join parties.
            </div>
          )}
          <main className={cx('content', FLUSH(path) && 'flush')} id="main"><div className="page-enter" key={path.split('/').slice(0, 3).join('/')}>{children}</div></main>
        </div>
        <nav className="bottom-nav" aria-label="Main">
          {bottom.map((item) => (
            <Link key={item.to} to={item.to} className={cx('bn-link', isActive(item, path) && 'active')} aria-current={isActive(item, path) ? 'page' : undefined}>
              <span className="bn-icon"><item.icon aria-hidden />{item.badge ? <span className="dot-badge" /> : null}</span>
              <span>{item.label === 'Find Players' ? 'Players' : item.label}</span>
            </Link>
          ))}
        </nav>
        {creating && <CreateCommunityDialog onClose={() => setCreating(false)} />}
        {newGroup && <NewGroupDialog onClose={() => setNewGroup(false)} />}
      </div>
    </CommunityCtx.Provider>
  );
}
