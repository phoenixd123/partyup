import { useEffect, useState } from 'react';
import {
  LuCrown, LuLogOut, LuPencil, LuUserPlus, LuX, LuCheck, LuLock, LuGlobe, LuMic, LuCalendar, LuEllipsis, LuUserMinus, LuArrowRightLeft, LuCircleOff, LuFlag, LuUsers,
} from 'react-icons/lu';
import * as api from '../lib/api.js';
import { useAsync } from '../hooks/useAsync.js';
import { useApp } from '../context/AppContext.jsx';
import { Link, navigate } from '../lib/router.jsx';
import { regionLabel, languageLabel, platformLabel } from '../lib/constants.js';
import { sessionTime, timeAgo } from '../lib/format.js';
import { Button, DemoBadge, EmptyState, ErrorState, Field, IconButton, Input, Menu, Modal, PageLoader, Panel, Select, Textarea, InlineError } from '../components/ui.jsx';
import { Avatar, CompatBreakdown, GameTag, PartyStatus, Pips, Presence, SignalMeter } from '../components/gaming.jsx';
import { useConfirm, useToast } from '../components/feedback.jsx';
import ChatThread from '../components/ChatThread.jsx';
import PartyForm from '../components/PartyForm.jsx';
import { ReportDialog } from '../components/PlayerActions.jsx';

export default function PartyDetailPage({ params }) {
  const { userId, refreshCounts, onNotify } = useApp();
  const toast = useToast();
  const confirm = useConfirm();
  const { data: p, error, loading, reload } = useAsync(() => api.getParty(params.id), [params.id]);
  const [editing, setEditing] = useState(false);
  const [inviting, setInviting] = useState(false);
  const [joining, setJoining] = useState(false);
  const [reporting, setReporting] = useState(null);
  const [busy, setBusy] = useState(null);

  useEffect(() => onNotify((ev) => { if (ev?.new?.party_id === params.id) reload({ quiet: true }); }), [onNotify, params.id, reload]);
  useEffect(() => api.subscribe(`party-${params.id}`, [
    { event: '*', table: 'party_members', filter: `party_id=eq.${params.id}` },
    { event: '*', table: 'parties', filter: `id=eq.${params.id}` },
  ], () => reload({ quiet: true })), [params.id, reload]);

  if (loading && !p) return <PageLoader />;
  if (error) return <ErrorState error={error} onRetry={reload} />;
  if (!p) return <EmptyState icon={LuUsers} title="Party not found" action={<Button onClick={() => navigate('/parties')}>Browse parties</Button>}>It may be invite only, or the leader has blocked you.</EmptyState>;

  const isLeader = p.my_relation === 'leader';
  const isMember = isLeader || p.my_relation === 'member';
  const act = async (key, fn, msg, after) => {
    setBusy(key);
    try { await fn(); if (msg) toast(msg); await reload({ quiet: true }); refreshCounts(); after?.(); }
    catch (e) { toast(e, 'error'); } finally { setBusy(null); }
  };
  const ask = (opts, fn, msg, after) => confirm({ ...opts, action: async () => { await fn(); toast(msg); await reload({ quiet: true }); refreshCounts(); after?.(); } });
  const rank = p.min_rank || p.max_rank ? `${p.min_rank || 'Any'} – ${p.max_rank || 'Any'}` : 'Any rank';
  const leaderMembers = p.members.filter((m) => m.id !== userId);

  return (
    <div className="party-page" style={{ '--gc': p.game.accent_color }}>
      <section className="party-hero">
        <div className="row between wrap gap-s">
          <span className="row gap-s wrap"><GameTag game={p.game} /><PartyStatus status={p.status} />{p.is_demo && <DemoBadge />}</span>
          <span className="row gap-s wrap party-hero-actions">
            {isLeader && p.status !== 'closed' && (
              <>
                <Button icon={LuUserPlus} onClick={() => setInviting(true)} disabled={p.status === 'full'}>Invite</Button>
                <Button icon={LuPencil} onClick={() => setEditing(true)}>Edit</Button>
                <Button variant="danger-ghost" icon={LuCircleOff} onClick={() => ask({ title: 'Close this party?', body: 'Members are notified, pending requests are cancelled, and nobody new can join. Chat history stays available to members.', confirmLabel: 'Close party', danger: true },
                  () => api.closeParty(p.id), 'Party closed')}>Close</Button>
              </>
            )}
            {isMember && <Button variant="ghost" icon={LuLogOut} onClick={() => ask({
              title: 'Leave this party?', body: isLeader ? (leaderMembers.length ? `Leadership passes to ${leaderMembers[0].username}.` : "You're the only member, so the party will close.") : 'You can ask to join again later if it is still open.',
              confirmLabel: 'Leave party', danger: true }, () => api.leaveParty(p.id), 'You left the party', () => navigate('/parties'))}>Leave</Button>}
          </span>
        </div>
        <h1>{p.title}</h1>
        {p.description && <p className="party-hero-desc">{p.description}</p>}
        <ul className="party-meta big">
          <li className={`ptype ptype-${p.play_type}`}>{p.play_type === 'competitive' ? 'Competitive' : 'Casual'}</li>
          {p.game.ranks.length > 0 && <li>{rank}</li>}
          {p.language && <li>{languageLabel(p.language)}</li>}
          {p.region && <li>{regionLabel(p.region)}</li>}
          {p.platform && <li>{platformLabel(p.platform)}</li>}
          {p.mic_required && <li><LuMic aria-hidden />Mic required</li>}
          {p.scheduled_for && <li><LuCalendar aria-hidden />{sessionTime(p.scheduled_for)}</li>}
          <li>{p.visibility === 'public' ? <><LuGlobe aria-hidden />Public</> : <><LuLock aria-hidden />Invite only</>}</li>
        </ul>
        <div className="slots-row">
          <Pips filled={p.member_count} total={p.max_size} />
          <strong>{p.member_count}/{p.max_size}</strong>
          <span className="muted">{p.status === 'open' ? `${p.open_slots} open ${p.open_slots === 1 ? 'slot' : 'slots'}` : p.status === 'full' ? 'Party is full' : 'Party is closed'}</span>
          {p.needed_roles.length > 0 && p.status === 'open' && <span className="needed">Needs {p.needed_roles.map((r) => <span key={r} className="role-chip">{r}</span>)}</span>}
        </div>

        {!isMember && p.status !== 'closed' && (
          <div className="join-box">
            {p.my_relation === 'invited' ? (
              <>
                <span><strong>{p.leader?.username}</strong> invited you.</span>
                <Button variant="primary" icon={LuCheck} loading={busy === 'inv'} disabled={p.status === 'full'} onClick={() => act('inv', () => api.respondInvite(p.invite_id, true), `Joined ${p.title}`)}>Accept invite</Button>
                <Button variant="ghost" onClick={() => act('inv', () => api.respondInvite(p.invite_id, false), 'Invite declined', () => navigate('/parties'))}>Decline</Button>
              </>
            ) : p.my_relation === 'requested' ? (
              <>
                <span>Your request is waiting for the leader.</span>
                <Button variant="ghost" loading={busy === 'cancel'} onClick={() => act('cancel', () => api.cancelJoinRequest(p.request_id), 'Request cancelled')}>Cancel request</Button>
              </>
            ) : p.status === 'full' ? <span className="muted">This party is full. Check back if a slot opens.</span>
              : p.visibility === 'invite_only' ? <span className="muted">Invite only — ask the leader for an invite.</span>
              : <Button variant="primary" size="lg" onClick={() => setJoining(true)}>Request to join</Button>}
          </div>
        )}
      </section>

      <div className="party-grid">
        <div className="party-col">
          <Panel title={`Members (${p.member_count}/${p.max_size})`}>
            <ul className="member-list">
              {p.members.map((m) => (
                <li key={m.id}>
                  <Link to={`/players/${m.id}`} className="row gap-s grow mini-link">
                    <Avatar user={m} size={38} status={m.status} />
                    <span>
                      <strong>{m.username}{m.id === userId && ' (you)'} {m.id === p.leader_id && <LuCrown aria-label="Leader" className="crown" />}</strong>
                      <span className="muted small block">{m.role ? `${m.role}, ` : ''}<Presence user={m} /></span>
                    </span>
                  </Link>
                  {isLeader && m.id !== userId && p.status !== 'closed' && (
                    <Menu trigger={({ toggle, open }) => <IconButton icon={LuEllipsis} label={`Manage ${m.username}`} onClick={toggle} aria-expanded={open} />}
                      items={[
                        { label: 'Make leader', icon: LuArrowRightLeft, onClick: () => ask({ title: `Make ${m.username} the leader?`, body: "You'll stay in the party as a member and lose leader controls.", confirmLabel: 'Transfer leadership' }, () => api.transferLeadership(p.id, m.id), `${m.username} is now the leader`) },
                        { label: 'Remove from party', icon: LuUserMinus, danger: true, onClick: () => ask({ title: `Remove ${m.username}?`, body: 'They lose access to the party chat and are notified.', confirmLabel: 'Remove', danger: true }, () => api.removeMember(p.id, m.id), `Removed ${m.username}`) },
                        { label: 'Report', icon: LuFlag, danger: true, onClick: () => setReporting(m) },
                      ]} />
                  )}
                  {!isLeader && m.id !== userId && isMember && (
                    <IconButton icon={LuFlag} label={`Report ${m.username}`} onClick={() => setReporting(m)} />
                  )}
                </li>
              ))}
              {Array.from({ length: p.status === 'closed' ? 0 : p.open_slots }, (_, i) => (
                <li key={`open-${i}`} className="open-slot"><span className="slot-ring" aria-hidden />Open slot{p.needed_roles[i] ? ` — ${p.needed_roles[i]}` : ''}</li>
              ))}
            </ul>
          </Panel>

          {isLeader && (
            <Panel title={`Join requests${p.join_requests?.length ? ` (${p.join_requests.length})` : ''}`}>
              {!p.join_requests?.length ? <p className="muted small pad">{p.visibility === 'public' ? 'No pending requests. Public parties show up in Browse and Quick Match.' : 'Invite-only parties only get members you invite.'}</p> : (
                <ul className="request-list">
                  {p.join_requests.map((r) => (
                    <li key={r.id}>
                      <div className="row gap-s">
                        <Link to={`/players/${r.user.id}`} className="row gap-s grow mini-link">
                          <Avatar user={r.user} size={36} status={r.user.status} />
                          <span><strong>{r.user.username}</strong><span className="muted small block">{r.role ? `Wants to play ${r.role}, ` : ''}{timeAgo(r.created_at)}</span></span>
                        </Link>
                        {r.fit && <SignalMeter score={r.fit.score} label="Fit for this party" />}
                      </div>
                      {r.message && <p className="req-msg">“{r.message}”</p>}
                      <div className="row gap-s">
                        <Button size="sm" variant="primary" icon={LuCheck} loading={busy === r.id} disabled={p.status !== 'open'} onClick={() => act(r.id, () => api.respondJoinRequest(r.id, true), `${r.user.username} joined`)}>Accept</Button>
                        <Button size="sm" variant="ghost" icon={LuX} onClick={() => act(r.id, () => api.respondJoinRequest(r.id, false), 'Request declined')}>Decline</Button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
              {p.invites?.length > 0 && (
                <>
                  <h3 className="sub-h">Pending invites</h3>
                  <ul className="mini-list">
                    {p.invites.map((i) => (
                      <li key={i.id}>
                        <span className="row gap-s grow"><Avatar user={i.user} size={28} /><span>{i.user.username}</span><span className="muted small">{timeAgo(i.created_at)}</span></span>
                        <Button size="sm" variant="ghost" onClick={() => act(`ci-${i.id}`, () => api.cancelInvite(i.id), 'Invite cancelled')}>Cancel</Button>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </Panel>
          )}

          {!isMember && p.fit && (
            <Panel title="How this party fits you"><CompatBreakdown compat={p.fit} title="Party requirements vs your profile" /></Panel>
          )}
        </div>

        <div className="party-col chat-col">
          <Panel title="Party chat" className="chat-panel">
            {isMember ? (
              <PartyChat conversationId={p.conversation_id} members={p.members} />
            ) : (
              <p className="muted pad">Party chat is visible to members only.</p>
            )}
          </Panel>
        </div>
      </div>

      {editing && (
        <Modal open onClose={() => setEditing(false)} title="Edit party" size="lg">
          <EditParty party={p} onDone={() => { setEditing(false); reload({ quiet: true }); toast('Party updated'); }} onCancel={() => setEditing(false)} />
        </Modal>
      )}
      {inviting && <InviteFriends party={p} onClose={() => { setInviting(false); reload({ quiet: true }); }} />}
      {joining && <JoinDialog party={p} onClose={() => setJoining(false)} onJoined={() => { setJoining(false); reload({ quiet: true }); }} />}
      {reporting && <ReportDialog player={reporting} partyId={p.id} onClose={() => setReporting(null)} />}
    </div>
  );
}

function EditParty({ party, onDone, onCancel }) {
  const games = useAsync(() => api.getGames(), []);
  if (!games.data) return <PageLoader />;
  return (
    <PartyForm mode="edit" games={games.data} initial={party} onCancel={onCancel}
      onSubmit={async (v) => {
        await api.updateParty({ p_party: party.id, p_title: v.title.trim(), p_description: v.description.trim(), p_needed_roles: v.needed_roles,
          p_visibility: v.visibility, p_max_size: v.max_size, p_scheduled_for: v.scheduled_for, p_clear_schedule: !v.scheduled_for });
        onDone();
      }} />
  );
}

function JoinDialog({ party, onClose, onJoined }) {
  const toast = useToast();
  const { userId } = useApp();
  const mine = useAsync(() => api.getMyGameProfiles(userId), [userId]);
  const gp = mine.data?.find((g) => g.game_id === party.game_id);
  const [role, setRole] = useState(null);
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  useEffect(() => {
    if (gp) setRole(party.needed_roles.includes(gp.main_role) ? gp.main_role : gp.secondary_roles?.find((r) => party.needed_roles.includes(r)) || gp.main_role);
  }, [gp, party.needed_roles]);
  const submit = async (e) => {
    e.preventDefault(); setBusy(true); setErr(null);
    try { await api.requestJoin(party.id, role, msg.trim()); toast('Request sent to the leader'); onJoined(); }
    catch (ex) { setErr(ex); setBusy(false); }
  };
  return (
    <Modal open onClose={onClose} title={`Ask to join ${party.title}`} size="sm"
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" loading={busy} onClick={submit}>Send request</Button></>}>
      <form onSubmit={submit} className="stack">
        {!gp && <p className="muted small">You don't have a {party.game.name} game profile yet. Adding one helps the leader decide. <Link to="/games">Add it</Link></p>}
        {party.game.roles.length > 0 && (
          <Field label="Role you'll play" htmlFor="jd-role" optional>
            <Select id="jd-role" options={party.game.roles.map((r) => ({ value: r, label: party.needed_roles.includes(r) ? `${r} (needed)` : r }))} value={role} onChange={setRole} placeholder="Any" />
          </Field>
        )}
        <Field label="Message to the leader" htmlFor="jd-msg" optional hint={`${msg.length}/200`}>
          <Textarea id="jd-msg" rows={2} maxLength={200} value={msg} onChange={(e) => setMsg(e.target.value)} placeholder="Rank, what you main, when you can play" />
        </Field>
        <InlineError error={err} />
      </form>
    </Modal>
  );
}

function InviteFriends({ party, onClose }) {
  const toast = useToast();
  const friends = useAsync(() => api.listFriends(), []);
  const [q, setQ] = useState('');
  const [sent, setSent] = useState(new Set(party.invites?.map((i) => i.user.id) || []));
  const [busy, setBusy] = useState(null);
  const [err, setErr] = useState(null);
  const memberIds = new Set(party.members.map((m) => m.id));
  const list = (friends.data?.friends || []).filter((f) => !memberIds.has(f.id) && f.username.toLowerCase().includes(q.toLowerCase()));
  const invite = async (f) => {
    setBusy(f.id); setErr(null);
    try { await api.inviteToParty(party.id, f.id); setSent((s) => new Set(s).add(f.id)); toast(`Invited ${f.username}`); }
    catch (e) { setErr(e); } finally { setBusy(null); }
  };
  return (
    <Modal open onClose={onClose} title="Invite friends" size="sm">
      <Input type="search" placeholder="Search friends" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search friends" />
      {friends.loading ? <PageLoader /> : friends.error ? <ErrorState error={friends.error} onRetry={friends.reload} /> : list.length === 0 ? (
        <EmptyState title={friends.data.friends.length ? 'No matching friends' : 'No friends to invite yet'}>
          You can also invite anyone from their profile or player card.
        </EmptyState>
      ) : (
        <ul className="pick-list">
          {list.map((f) => (
            <li key={f.id}>
              <span className="row gap-s grow"><Avatar user={f} size={32} status={f.status} /><strong>{f.username}</strong></span>
              {sent.has(f.id) ? <span className="muted small">Invited</span> : <Button size="sm" variant="primary" loading={busy === f.id} onClick={() => invite(f)}>Invite</Button>}
            </li>
          ))}
        </ul>
      )}
      <InlineError error={err} />
      <p className="muted small">Players who only accept invites from friends, or who blocked you, can't be invited.</p>
    </Modal>
  );
}

function PartyChat({ conversationId, members }) {
  const conv = useAsync(() => api.getConversation(conversationId), [conversationId]);
  if (!conv.data) return conv.error ? <ErrorState error={conv.error} onRetry={conv.reload} /> : <PageLoader />;
  return <ChatThread conv={conv.data} members={members} emptyTitle="Party chat" emptyText="Plan the session here. Only party members can see it." />;
}
