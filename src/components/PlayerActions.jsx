import { useState } from 'react';
import { LuUsers, LuPlus, LuFlag } from 'react-icons/lu';
import * as api from '../lib/api.js';
import { navigate } from '../lib/router.jsx';
import { useApp } from '../context/AppContext.jsx';
import { useAsync } from '../hooks/useAsync.js';
import { REPORT_CATEGORIES } from '../lib/constants.js';
import { Button, EmptyState, ErrorState, Field, InlineError, Modal, Skeleton, Textarea, cx, Toggle } from './ui.jsx';
import { useConfirm, useToast } from './feedback.jsx';
import { GameTag, Pips } from './gaming.jsx';

/** Shared actions for a player (friend, message, invite, report, block). */
export function usePlayerActions(player, onChanged) {
  const toast = useToast();
  const confirm = useConfirm();
  const { refreshCounts } = useApp();
  const [pending, setPending] = useState(null);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);

  const run = async (key, fn, ok) => {
    setPending(key);
    try { const r = await fn(); if (ok) toast(typeof ok === 'function' ? ok(r) : ok); onChanged?.(); refreshCounts(); return r; }
    catch (e) { toast(e, 'error'); return undefined; }
    finally { setPending(null); }
  };

  return {
    pending,
    addFriend: () => run('friend', () => api.sendFriendRequest(player.id),
      (r) => (r === 'friends' ? `You and ${player.username} are now friends` : `Friend request sent to ${player.username}`)),
    accept: () => run('friend', () => api.respondFriendRequest(player.id, true), `You and ${player.username} are now friends`),
    removeFriend: () => confirm({
      title: `Remove ${player.username}?`, body: player.relationship === 'outgoing' ? 'This cancels your friend request.' : 'You can add each other again later.',
      confirmLabel: player.relationship === 'outgoing' ? 'Cancel request' : 'Remove friend', danger: true,
      action: async () => { await api.removeFriend(player.id); onChanged?.(); },
    }),
    message: async () => {
      setPending('message');
      try { const id = await api.openDirectConversation(player.id); navigate(`/messages/${id}`); }
      catch (e) { toast(e, 'error'); }
      finally { setPending(null); }
    },
    invite: () => setInviteOpen(true),
    report: () => setReportOpen(true),
    mute: () => run('mute', () => (player.muted_by_me ? api.unmuteUser(player.id) : api.muteUser(player.id)),
      player.muted_by_me ? `Unmuted ${player.username}` : `Muted ${player.username}. Their messages are hidden and they won't notify you.`),
    block: () => confirm({
      title: `Block ${player.username}?`,
      body: <>They won't be able to message you, invite you, send friend requests or see your profile and public parties. Any friendship between you is removed. You can unblock them in Settings → Safety.</>,
      confirmLabel: 'Block', danger: true,
      action: async () => { await api.blockUser(player.id); toast(`Blocked ${player.username}`); onChanged?.(); },
    }),
    unblock: () => run('block', () => api.unblockUser(player.id), `Unblocked ${player.username}`),
    dialogs: (
      <>
        {inviteOpen && <InviteDialog player={player} onClose={() => setInviteOpen(false)} />}
        {reportOpen && <ReportDialog player={player} onClose={() => setReportOpen(false)} onBlocked={onChanged} />}
      </>
    ),
  };
}

export function InviteDialog({ player, onClose }) {
  const toast = useToast();
  const { userId } = useApp();
  const { data, error, loading, reload } = useAsync(() => api.listParties({ p_scope: 'mine', p_limit: 24 }), []);
  const [busy, setBusy] = useState(null);
  const [err, setErr] = useState(null);
  const parties = (data?.parties || []).filter((p) => p.status === 'open' && (p.leader_id === userId || p.visibility === 'public'));
  const invite = async (p) => {
    setBusy(p.id); setErr(null);
    try { await api.inviteToParty(p.id, player.id); toast(`Invited ${player.username} to ${p.title}`); onClose(); }
    catch (e) { setErr(e); } finally { setBusy(null); }
  };
  return (
    <Modal open onClose={onClose} title={`Invite ${player.username}`} size="sm">
      {loading ? <Skeleton h={64} /> : error ? <ErrorState error={error} onRetry={reload} /> : parties.length === 0 ? (
        <EmptyState icon={LuUsers} title="You're not in an open party"
          action={<Button variant="primary" icon={LuPlus} onClick={() => { onClose(); navigate('/parties/new'); }}>Create a party</Button>}>
          Create a party first, then invite {player.username} to it.
        </EmptyState>
      ) : (
        <ul className="pick-list">
          {parties.map((p) => (
            <li key={p.id}>
              <div className="grow">
                <strong>{p.title}</strong>
                <div className="row gap-s"><GameTag game={p.game} compact /><Pips filled={p.member_count} total={p.max_size} /><span className="muted small">{p.open_slots} open</span></div>
              </div>
              <Button size="sm" variant="primary" loading={busy === p.id} onClick={() => invite(p)}>Invite</Button>
            </li>
          ))}
        </ul>
      )}
      <InlineError error={err} />
    </Modal>
  );
}

export function ReportDialog({ player, messageId, partyId, onClose, onBlocked }) {
  const toast = useToast();
  const [category, setCategory] = useState(null);
  const [desc, setDesc] = useState('');
  const [alsoBlock, setAlsoBlock] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const [done, setDone] = useState(false);
  const submit = async (e) => {
    e.preventDefault();
    if (!category) return setErr(new Error('Choose what you are reporting.'));
    if (desc.trim().length < 10) return setErr(new Error('Describe what happened (at least 10 characters).'));
    setBusy(true); setErr(null);
    try {
      await api.submitReport({ p_user: player.id, p_category: category, p_description: desc, p_message_id: messageId ?? null, p_party_id: partyId ?? null });
      if (alsoBlock) { await api.blockUser(player.id); onBlocked?.(); }
      setDone(true);
    } catch (ex) { setErr(ex); } finally { setBusy(false); }
  };
  if (done) {
    return (
      <Modal open onClose={onClose} title="Report sent" size="sm" footer={<Button variant="primary" onClick={() => { onClose(); toast('Report submitted'); }}>Done</Button>}>
        <p>Thanks. A moderator will review your report about <b>{player.username}</b>. You'll get a notification when it's been reviewed.</p>
        <p className="muted small">If anyone is in immediate danger, contact local emergency services.</p>
      </Modal>
    );
  }
  return (
    <Modal open onClose={onClose} title={`Report ${player.username}`} size="md"
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="danger" icon={LuFlag} loading={busy} onClick={submit}>Submit report</Button></>}>
      <form onSubmit={submit} className="stack">
        {messageId && <p className="muted small">The reported message will be attached so moderators can see it.</p>}
        <fieldset className="radio-cards">
          <legend className="field-label">What's the problem?</legend>
          {REPORT_CATEGORIES.map((c) => (
            <label key={c.value} className={cx('radio-card', category === c.value && 'on')}>
              <input type="radio" name="cat" value={c.value} checked={category === c.value} onChange={() => setCategory(c.value)} />
              <span><strong>{c.label}</strong>{c.hint && <small>{c.hint}</small>}</span>
            </label>
          ))}
        </fieldset>
        <Field label="What happened?" hint={`${desc.length}/1000. Include the game, time and what was said or done.`} htmlFor="rep-desc">
          <Textarea id="rep-desc" rows={4} maxLength={1000} value={desc} onChange={(e) => setDesc(e.target.value)} />
        </Field>
        <Toggle checked={alsoBlock} onChange={setAlsoBlock} label={`Also block ${player.username}`} hint="They won't be able to contact you." />
        <InlineError error={err} />
      </form>
    </Modal>
  );
}
