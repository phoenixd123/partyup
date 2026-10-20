import { useState } from 'react';
import { LuArrowLeft, LuHash, LuMegaphone, LuPlus, LuTrash2, LuEllipsis, LuCrown, LuShieldCheck, LuUserMinus, LuBan, LuArrowUp, LuArrowDown } from 'react-icons/lu';
import * as api from '../lib/api.js';
import { useAsync } from '../hooks/useAsync.js';
import { useApp } from '../context/AppContext.jsx';
import { Link, navigate } from '../lib/router.jsx';
import { COMMUNITY_COLORS, gameOptions } from '../lib/constants.js';
import { timeAgo } from '../lib/format.js';
import { Badge, Button, EmptyState, ErrorState, Field, IconButton, Input, InlineError, Menu, PageLoader, Panel, Select, Textarea, Toggle, cx } from '../components/ui.jsx';
import { Avatar } from '../components/gaming.jsx';
import { useConfirm, useToast } from '../components/feedback.jsx';
import { useCommunity, CreateChannelDialog } from '../components/layout/AppShell.jsx';
import { CommunityIcon, InviteDialog } from '../components/CommunityDialogs.jsx';

const TABS = [['overview', 'Overview'], ['channels', 'Channels'], ['members', 'Members'], ['invites', 'Invites'], ['bans', 'Bans'], ['danger', 'Delete or leave']];

export default function CommunitySettingsPage({ params, query }) {
  const { community } = useCommunity();
  const [tab, setTab] = useState(query.tab || 'overview');
  const c = community.data;
  if (community.loading && !c) return <PageLoader />;
  if (community.error) return <ErrorState error={community.error} onRetry={community.reload} />;
  if (!c || !['owner', 'admin'].includes(c.my_role)) {
    return <EmptyState icon={LuShieldCheck} title="Admins only" action={<Button onClick={() => navigate(`/c/${params.id}`)}>Back to community</Button>}>
      Only community owners and admins can open settings.</EmptyState>;
  }
  const reload = () => community.reload({ quiet: true });
  return (
    <div>
      <Link to={`/c/${c.id}`} className="back-link"><LuArrowLeft aria-hidden /> Back to {c.name}</Link>
      <div className="page-head"><div className="page-head-text row gap-m"><CommunityIcon community={c} size={44} radius={12} /><div><h1>{c.name} settings</h1><p className="sub">{c.member_count} members, you're {c.my_role}</p></div></div></div>
      <div className="settings">
        <nav className="settings-nav" aria-label="Community settings">
          {TABS.map(([id, label]) => <button key={id} type="button" className={cx('settings-link', tab === id && 'active')} onClick={() => setTab(id)}>{label}</button>)}
        </nav>
        <div className="settings-body">
          {tab === 'overview' && <Overview c={c} onSaved={reload} />}
          {tab === 'channels' && <Channels c={c} onChanged={reload} />}
          {tab === 'members' && <Members c={c} onChanged={reload} />}
          {tab === 'invites' && <Invites c={c} />}
          {tab === 'bans' && <Bans c={c} />}
          {tab === 'danger' && <Danger c={c} />}
        </div>
      </div>
    </div>
  );
}

function Overview({ c, onSaved }) {
  const toast = useToast();
  const { refreshCounts } = useApp();
  const games = useAsync(() => api.getGames(), []);
  const [f, setF] = useState({ name: c.name, description: c.description, icon_color: c.icon_color, game_id: c.game?.id || null, is_public: c.is_public });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const set = (k) => (v) => setF((s) => ({ ...s, [k]: v }));
  const save = async () => {
    setBusy(true); setErr(null);
    try { await api.updateCommunity(c.id, f); toast('Community updated'); onSaved(); refreshCounts(); } catch (e) { setErr(e); } finally { setBusy(false); }
  };
  return (
    <Panel title="Overview">
      <div className="form-body">
        <div className="row gap-m"><CommunityIcon community={{ ...c, ...f }} size={56} radius={14} />
          <Field label="Name" htmlFor="co-name" className="grow"><Input id="co-name" maxLength={40} value={f.name} onChange={(e) => set('name')(e.target.value)} /></Field></div>
        <Field label="Color"><div className="color-row">{COMMUNITY_COLORS.map((col) => (
          <button key={col} type="button" aria-label={col} className={cx('color-swatch', f.icon_color === col && 'on')} style={{ background: col }} onClick={() => set('icon_color')(col)} />))}</div></Field>
        <Field label="Description" htmlFor="co-desc" hint={`${f.description.length}/300`}><Textarea id="co-desc" rows={3} maxLength={300} value={f.description} onChange={(e) => set('description')(e.target.value)} /></Field>
        <Field label="Main game" htmlFor="co-game"><Select id="co-game" options={gameOptions(games.data)} value={f.game_id} onChange={set('game_id')} placeholder="Any games" /></Field>
        <Toggle checked={f.is_public} onChange={set('is_public')} label="Public" hint="Shown in Explore; anyone can join. Private communities need an invite." />
        <InlineError error={err} />
        <div><Button variant="primary" loading={busy} onClick={save}>Save changes</Button></div>
      </div>
    </Panel>
  );
}

function Channels({ c, onChanged }) {
  const toast = useToast();
  const confirm = useConfirm();
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState(null);
  const move = async (ch, dir) => {
    const list = [...c.channels];
    const i = list.findIndex((x) => x.id === ch.id); const j = i + dir;
    if (j < 0 || j >= list.length) return;
    try {
      await api.updateChannel(list[i].id, { position: j });
      await api.updateChannel(list[j].id, { position: i });
      for (let k = 0; k < list.length; k++) if (k !== i && k !== j && list[k].position !== k) await api.updateChannel(list[k].id, { position: k });
      onChanged();
    } catch (e) { toast(e, 'error'); }
  };
  return (
    <Panel title="Channels" action={<Button size="sm" icon={LuPlus} onClick={() => setCreating(true)}>Create channel</Button>}>
      <div style={{ padding: '6px 6px 10px' }}>
        {c.channels.map((ch, i) => (
          <div key={ch.id} className="chan-row">
            {ch.kind === 'announcement' ? <LuMegaphone aria-hidden className="muted" /> : <LuHash aria-hidden className="muted" />}
            <span className="grow"><strong>{ch.name}</strong>{ch.topic && <span className="muted small block">{ch.topic}</span>}</span>
            {ch.kind === 'announcement' && <Badge>Admins post</Badge>}
            <IconButton icon={LuArrowUp} label={`Move ${ch.name} up`} onClick={() => move(ch, -1)} disabled={i === 0} />
            <IconButton icon={LuArrowDown} label={`Move ${ch.name} down`} onClick={() => move(ch, 1)} disabled={i === c.channels.length - 1} />
            <Button size="sm" onClick={() => setEditing(ch)}>Edit</Button>
            <IconButton icon={LuTrash2} label={`Delete #${ch.name}`} onClick={() => confirm({
              title: `Delete #${ch.name}?`, body: 'All of its messages are deleted for everyone. This cannot be undone.', confirmLabel: 'Delete channel', danger: true,
              action: async () => { await api.deleteChannel(ch.id); toast(`Deleted #${ch.name}`); onChanged(); } })} />
          </div>
        ))}
      </div>
      {creating && <CreateChannelDialog community={c} onClose={(id) => { setCreating(false); if (id) { toast('Channel created'); onChanged(); } }} />}
      {editing && <EditChannel ch={editing} onClose={(changed) => { setEditing(null); if (changed) onChanged(); }} />}
    </Panel>
  );
}

function EditChannel({ ch, onClose }) {
  const toast = useToast();
  const [f, setF] = useState({ name: ch.name, topic: ch.topic, kind: ch.kind });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const save = async () => {
    setBusy(true); setErr(null);
    try { await api.updateChannel(ch.id, f); toast('Channel saved'); onClose(true); } catch (e) { setErr(e); setBusy(false); }
  };
  return (
    <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(false); }}>
      <div className="modal modal-sm" role="dialog" aria-modal="true" aria-label={`Edit #${ch.name}`}>
        <header className="modal-head"><h2>Edit #{ch.name}</h2></header>
        <div className="modal-body">
          <Field label="Name" htmlFor="ec-name"><Input id="ec-name" value={f.name} maxLength={40} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
          <Field label="Topic" htmlFor="ec-topic" optional><Input id="ec-topic" value={f.topic} maxLength={200} onChange={(e) => setF({ ...f, topic: e.target.value })} /></Field>
          <Toggle checked={f.kind === 'announcement'} onChange={(v) => setF({ ...f, kind: v ? 'announcement' : 'text' })} label="Announcement channel" hint="Only admins can post" />
          <InlineError error={err} />
        </div>
        <footer className="modal-foot"><Button variant="ghost" onClick={() => onClose(false)}>Cancel</Button><Button variant="primary" loading={busy} onClick={save}>Save</Button></footer>
      </div>
    </div>
  );
}

function Members({ c, onChanged }) {
  const { userId } = useApp();
  const toast = useToast();
  const confirm = useConfirm();
  const list = useAsync(() => api.listCommunityMembers(c.id), [c.id]);
  const [q, setQ] = useState('');
  const rank = { owner: 3, admin: 2, member: 1 };
  const mine = rank[c.my_role];
  const act = (opts, fn, msg) => confirm({ ...opts, action: async () => { await fn(); toast(msg); list.reload({ quiet: true }); onChanged(); } });
  const run = async (fn, msg) => { try { await fn(); toast(msg); list.reload({ quiet: true }); onChanged(); } catch (e) { toast(e, 'error'); } };
  const rows = (list.data || []).filter((m) => m.username.toLowerCase().includes(q.toLowerCase()));
  return (
    <Panel title={`Members (${c.member_count})`}>
      <div className="pad"><Input type="search" placeholder="Search members" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search members" /></div>
      {list.loading && !list.data ? <PageLoader /> : list.error ? <ErrorState error={list.error} onRetry={list.reload} /> : (
        <ul className="mini-list">
          {rows.map((m) => (
            <li key={m.id}>
              <Link to={`/players/${m.id}`} className="row gap-s grow mini-link"><Avatar user={m} size={30} status={m.status} />
                <span><strong>{m.username}</strong><span className="muted small block">Joined {timeAgo(m.joined_at)}</span></span></Link>
              {m.role !== 'member' && <Badge tone={m.role === 'owner' ? 'warn' : 'info'}>{m.role === 'owner' ? <><LuCrown aria-hidden /> Owner</> : 'Admin'}</Badge>}
              {m.id !== userId && rank[m.role] < mine && (
                <Menu trigger={({ toggle, open }) => <IconButton icon={LuEllipsis} label={`Manage ${m.username}`} onClick={toggle} aria-expanded={open} />}
                  items={[
                    { label: 'Make admin', icon: LuShieldCheck, hidden: c.my_role !== 'owner' || m.role === 'admin', onClick: () => run(() => api.setMemberRole(c.id, m.id, 'admin'), `${m.username} is now an admin`) },
                    { label: 'Remove admin', icon: LuShieldCheck, hidden: c.my_role !== 'owner' || m.role !== 'admin', onClick: () => run(() => api.setMemberRole(c.id, m.id, 'member'), `${m.username} is now a member`) },
                    { label: 'Transfer ownership', icon: LuCrown, hidden: c.my_role !== 'owner', onClick: () => act({ title: `Make ${m.username} the owner?`, body: "You'll become an admin and lose owner-only controls.", confirmLabel: 'Transfer ownership', danger: true }, () => api.transferCommunity(c.id, m.id), `${m.username} now owns ${c.name}`) },
                    { label: 'Kick', icon: LuUserMinus, danger: true, onClick: () => act({ title: `Kick ${m.username}?`, body: 'They can rejoin if the community is public or they get a new invite.', confirmLabel: 'Kick', danger: true }, () => api.kickMember(c.id, m.id), `Kicked ${m.username}`) },
                    { label: 'Ban', icon: LuBan, danger: true, onClick: () => act({ title: `Ban ${m.username}?`, body: "They're removed and can't rejoin until unbanned.", confirmLabel: 'Ban', danger: true }, () => api.banMember(c.id, m.id, ''), `Banned ${m.username}`) },
                  ]} />
              )}
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

function Invites({ c }) {
  const toast = useToast();
  const list = useAsync(() => api.listInvites(c.id), [c.id]);
  const [creating, setCreating] = useState(false);
  return (
    <Panel title="Invites" action={<Button size="sm" icon={LuPlus} onClick={() => setCreating(true)}>Create invite</Button>}>
      {list.loading && !list.data ? <PageLoader /> : list.error ? <ErrorState error={list.error} onRetry={list.reload} /> : list.data.length === 0 ? (
        <p className="muted small pad">No invites yet.</p>
      ) : (
        <table className="table">
          <thead><tr><th>Code</th><th>Created by</th><th>Uses</th><th>Expires</th><th /></tr></thead>
          <tbody>{list.data.map((i) => (
            <tr key={i.code}>
              <td className="code">{i.code} {!i.active && <Badge>Inactive</Badge>}</td>
              <td>{i.created_by || 'Deleted account'}</td>
              <td className="tabular">{i.uses}{i.max_uses ? ` / ${i.max_uses}` : ''}</td>
              <td>{i.expires_at ? new Date(i.expires_at).toLocaleString() : 'Never'}</td>
              <td><Button size="sm" variant="danger-ghost" onClick={async () => { try { await api.revokeInvite(i.code); toast('Invite revoked'); list.reload({ quiet: true }); } catch (e) { toast(e, 'error'); } }}>Revoke</Button></td>
            </tr>))}</tbody>
        </table>
      )}
      {creating && <InviteDialog community={c} onClose={() => { setCreating(false); list.reload({ quiet: true }); }} />}
    </Panel>
  );
}

function Bans({ c }) {
  const toast = useToast();
  const list = useAsync(() => api.listBans(c.id), [c.id]);
  return (
    <Panel title="Banned players">
      {list.loading && !list.data ? <PageLoader /> : list.error ? <ErrorState error={list.error} onRetry={list.reload} /> : list.data.length === 0 ? (
        <p className="muted small pad">Nobody is banned.</p>
      ) : (
        <ul className="mini-list">{list.data.map((b) => (
          <li key={b.id}>
            <span className="row gap-s grow"><Avatar user={b} size={28} /><span><strong>{b.username}</strong><span className="muted small block">by {b.banned_by || 'unknown'} {timeAgo(b.created_at)}{b.reason ? `: ${b.reason}` : ''}</span></span></span>
            <Button size="sm" onClick={async () => { try { await api.unbanMember(c.id, b.id); toast(`Unbanned ${b.username}`); list.reload({ quiet: true }); } catch (e) { toast(e, 'error'); } }}>Unban</Button>
          </li>))}</ul>
      )}
    </Panel>
  );
}

function Danger({ c }) {
  const { refreshCounts } = useApp();
  const toast = useToast();
  const confirm = useConfirm();
  return (
    <Panel title={c.my_role === 'owner' ? 'Delete community' : 'Leave community'} className="danger-zone">
      <div className="form-body">
        {c.my_role === 'owner' ? (
          <>
            <p className="muted small">Deletes every channel and message for all {c.member_count} members. To leave without deleting, transfer ownership in Members first.</p>
            <div><Button variant="danger" onClick={() => confirm({ title: `Delete ${c.name}?`, body: 'This permanently deletes the community, its channels and messages.', confirmLabel: 'Delete community', danger: true,
              requireText: c.name, action: async () => { await api.deleteCommunity(c.id, c.name); refreshCounts(); navigate('/'); toast('Community deleted'); } })}>Delete community</Button></div>
          </>
        ) : (
          <div><Button variant="danger" onClick={() => confirm({ title: `Leave ${c.name}?`, confirmLabel: 'Leave', danger: true,
            action: async () => { await api.leaveCommunity(c.id); refreshCounts(); navigate('/'); } })}>Leave community</Button></div>
        )}
      </div>
    </Panel>
  );
}
