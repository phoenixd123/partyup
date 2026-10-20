import { useState } from 'react';
import { LuCopy, LuCheck, LuUsers } from 'react-icons/lu';
import * as api from '../lib/api.js';
import { navigate } from '../lib/router.jsx';
import { appUrl } from '../lib/supabase.js';
import { useApp } from '../context/AppContext.jsx';
import { useAsync } from '../hooks/useAsync.js';
import { COMMUNITY_COLORS, gameOptions } from '../lib/constants.js';
import { Button, Field, Input, InlineError, Modal, Segmented, Select, Textarea, Toggle, cx, EmptyState, PageLoader } from './ui.jsx';
import { useToast } from './feedback.jsx';
import { Avatar } from './gaming.jsx';

export function CommunityIcon({ community, size = 44, radius }) {
  const initials = (community?.name || '?').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase();
  return (
    <span className="comm-icon" style={{ background: community?.icon_color || '#3e63dd', width: size, height: size, borderRadius: radius, fontSize: size * 0.34 }} aria-hidden>
      {initials}
    </span>
  );
}

/** Pull an 8-char code out of a pasted code or invite link */
export const parseInviteCode = (text) => {
  const m = String(text || '').trim().toLowerCase().match(/([a-z0-9]{8})\/?$/);
  return m ? m[1] : null;
};

export function CreateCommunityDialog({ onClose }) {
  const { refreshCounts } = useApp();
  const toast = useToast();
  const games = useAsync(() => api.getGames(), []);
  const [mode, setMode] = useState('create');
  const [f, setF] = useState({ name: '', description: '', icon_color: COMMUNITY_COLORS[0], game_id: null, is_public: true });
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const set = (k) => (v) => setF((s) => ({ ...s, [k]: v }));

  const submit = async (e) => {
    e?.preventDefault(); setErr(null);
    if (mode === 'create') {
      if (f.name.trim().length < 2) return setErr(new Error('Give your community a name (2–40 characters).'));
      setBusy(true);
      try {
        const id = await api.createCommunity({ ...f, name: f.name.trim() });
        refreshCounts(); toast('Community created'); onClose(); navigate(`/c/${id}`);
      } catch (ex) { setErr(ex); setBusy(false); }
    } else {
      const c = parseInviteCode(code);
      if (!c) return setErr(new Error('Paste an invite code or link, like 3k9x2mq7.'));
      onClose(); navigate(`/invite/${c}`);
    }
  };

  return (
    <Modal open onClose={onClose} title={mode === 'create' ? 'Create a community' : 'Join a community'} size="md"
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button variant="primary" loading={busy} onClick={submit}>{mode === 'create' ? 'Create community' : 'Continue'}</Button></>}>
      <Segmented ariaLabel="Create or join" value={mode} onChange={(v) => { setMode(v); setErr(null); }}
        options={[{ value: 'create', label: 'Create new' }, { value: 'join', label: 'I have an invite' }]} />
      <form onSubmit={submit} className="stack">
        {mode === 'create' ? (
          <>
            <div className="row gap-m">
              <CommunityIcon community={{ name: f.name || 'New', icon_color: f.icon_color }} size={56} radius={14} />
              <Field label="Name" htmlFor="cc-name" className="grow"><Input id="cc-name" maxLength={40} value={f.name} onChange={(e) => set('name')(e.target.value)} placeholder="e.g. Late Night Ranked" data-autofocus /></Field>
            </div>
            <Field label="Color">
              <div className="color-row" role="radiogroup" aria-label="Icon color">
                {COMMUNITY_COLORS.map((c) => (
                  <button key={c} type="button" role="radio" aria-checked={f.icon_color === c} aria-label={c} className={cx('color-swatch', f.icon_color === c && 'on')}
                    style={{ background: c }} onClick={() => set('icon_color')(c)} />
                ))}
              </div>
            </Field>
            <Field label="Description" htmlFor="cc-desc" optional hint={`${f.description.length}/300`}>
              <Textarea id="cc-desc" rows={2} maxLength={300} value={f.description} onChange={(e) => set('description')(e.target.value)} placeholder="What's this community for?" />
            </Field>
            <Field label="Main game" htmlFor="cc-game" optional>
              <Select id="cc-game" options={gameOptions(games.data)} value={f.game_id} onChange={set('game_id')} placeholder="Any games" />
            </Field>
            <Toggle checked={f.is_public} onChange={set('is_public')} label="Public" hint="Public communities show up in Explore and anyone can join. Private ones need an invite." />
            <p className="muted small">You'll start with #general, #looking-for-group and an #announcements channel only admins can post in.</p>
          </>
        ) : (
          <Field label="Invite code or link" htmlFor="cc-code" hint="Ask a member for an invite. Codes are 8 letters and numbers.">
            <Input id="cc-code" value={code} onChange={(e) => setCode(e.target.value)} placeholder="3k9x2mq7" data-autofocus />
          </Field>
        )}
        <InlineError error={err} />
      </form>
    </Modal>
  );
}

export function InviteDialog({ community, onClose }) {
  const [maxUses, setMaxUses] = useState('');
  const [hours, setHours] = useState('168');
  const [code, setCode] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const [copied, setCopied] = useState(null);
  const make = async () => {
    setBusy(true); setErr(null);
    try { setCode(await api.createInvite(community.id, maxUses ? Number(maxUses) : null, hours === 'never' ? null : Number(hours))); }
    catch (e) { setErr(e); } finally { setBusy(false); }
  };
  const copy = async (text, which) => {
    try { await navigator.clipboard.writeText(text); setCopied(which); setTimeout(() => setCopied(null), 1500); } catch { setCopied(null); }
  };
  const link = code ? appUrl(`/invite/${code}`) : '';
  return (
    <Modal open onClose={onClose} title={`Invite people to ${community.name}`} size="sm">
      {!code ? (
        <>
          <div className="field-pair">
            <Field label="Expires after" htmlFor="iv-exp">
              <Select id="iv-exp" value={hours} onChange={(v) => setHours(v || '168')} options={[
                { value: '1', label: '1 hour' }, { value: '24', label: '1 day' }, { value: '168', label: '7 days' }, { value: '720', label: '30 days' }, { value: 'never', label: 'Never' }]} />
            </Field>
            <Field label="Max uses" htmlFor="iv-max">
              <Select id="iv-max" value={maxUses} onChange={(v) => setMaxUses(v || '')} placeholder="No limit"
                options={['1', '5', '10', '25', '100'].map((n) => ({ value: n, label: `${n} use${n === '1' ? '' : 's'}` }))} />
            </Field>
          </div>
          <InlineError error={err} />
          <Button variant="primary" onClick={make} loading={busy}>Create invite</Button>
        </>
      ) : (
        <>
          <Field label="Invite code">
            <div className="row gap-s"><Input readOnly value={code} className="code" aria-label="Invite code" /><Button icon={copied === 'code' ? LuCheck : LuCopy} onClick={() => copy(code, 'code')}>{copied === 'code' ? 'Copied' : 'Copy'}</Button></div>
          </Field>
          <Field label="Invite link" hint="Links open PartyUp in the browser. In the desktop app, share the code and use Join a community.">
            <div className="row gap-s"><Input readOnly value={link} aria-label="Invite link" /><Button icon={copied === 'link' ? LuCheck : LuCopy} onClick={() => copy(link, 'link')}>{copied === 'link' ? 'Copied' : 'Copy'}</Button></div>
          </Field>
        </>
      )}
    </Modal>
  );
}

export function NewGroupDialog({ onClose, existing }) {
  const toast = useToast();
  const { refreshCounts } = useApp();
  const friends = useAsync(() => api.listFriends(), []);
  const [picked, setPicked] = useState(new Set());
  const [name, setName] = useState('');
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const already = new Set((existing?.members || []).map((m) => m.id));
  const list = (friends.data?.friends || []).filter((f) => !already.has(f.id) && f.username.toLowerCase().includes(q.toLowerCase()));
  const limit = existing ? 10 - already.size : 9;
  const toggle = (id) => setPicked((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else if (n.size < limit) n.add(id); return n; });
  const submit = async () => {
    setBusy(true); setErr(null);
    try {
      if (existing) {
        for (const id of picked) await api.addGroupMember(existing.id, id);
        toast(picked.size === 1 ? 'Added to the group' : `Added ${picked.size} people`); onClose(true);
      } else {
        const id = await api.createGroupDm([...picked], name.trim());
        refreshCounts(); onClose(); navigate(`/messages/${id}`);
      }
    } catch (e) { setErr(e); setBusy(false); }
  };
  return (
    <Modal open onClose={() => onClose()} title={existing ? 'Add people' : 'New group DM'} size="sm"
      footer={<><Button variant="ghost" onClick={() => onClose()}>Cancel</Button>
        <Button variant="primary" loading={busy} disabled={existing ? picked.size < 1 : picked.size < 2} onClick={submit}>
          {existing ? 'Add' : `Create group${picked.size ? ` (${picked.size + 1})` : ''}`}</Button></>}>
      {!existing && <Field label="Group name" htmlFor="ng-name" optional><Input id="ng-name" maxLength={40} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Friday stack" /></Field>}
      <Input type="search" placeholder="Search friends" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search friends" />
      {friends.loading ? <PageLoader /> : list.length === 0 ? (
        <EmptyState icon={LuUsers} title={friends.data?.friends?.length ? 'No friends match' : 'Add friends first'}>Group DMs are for friends. {existing ? '' : 'Pick at least two.'}</EmptyState>
      ) : (
        <ul className="pick-list">
          {list.map((f) => (
            <li key={f.id}>
              <label className="row gap-s grow">
                <input type="checkbox" checked={picked.has(f.id)} onChange={() => toggle(f.id)} disabled={!picked.has(f.id) && picked.size >= limit} />
                <Avatar user={f} size={28} status={f.status} /><span>{f.username}</span>
              </label>
            </li>
          ))}
        </ul>
      )}
      <p className="muted small">{existing ? `Groups hold up to 10 people.` : 'Pick 2–9 friends. Groups hold up to 10 people including you.'}</p>
      <InlineError error={err} />
    </Modal>
  );
}
