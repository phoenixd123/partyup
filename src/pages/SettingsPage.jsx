import { useEffect, useMemo, useState } from 'react';
import { LuUser, LuCalendarClock, LuUsers, LuLock, LuBell, LuShield, LuKeyRound, LuGamepad2 } from 'react-icons/lu';
import * as api from '../lib/api.js';
import { supabase, authRedirect } from '../lib/supabase.js';
import { FcGoogle } from 'react-icons/fc';
import { LuMail, LuSparkles, LuUpload } from 'react-icons/lu';
import { BANNER_PRESETS, NAME_STYLES, DECORATIONS, EFFECTS, bannerBackground, ProfileEffect, themeVars } from '../components/ProfileFx.jsx';
import { Name } from '../components/gaming.jsx';
import { useRef } from 'react';
import { getFlavorPrefs, setFlavorPref } from '../lib/flavor.js';
import { useApp } from '../context/AppContext.jsx';
import { useAsync, useDebounced } from '../hooks/useAsync.js';
import { Link, navigate } from '../lib/router.jsx';
import {
  REGIONS, LANGUAGES, PLATFORMS, MIC_OPTIONS, PLAYSTYLES, LOOKING_FOR, TEAMMATE_TRAITS, TEAMMATE_MIC, REPORT_CATEGORIES, label,
} from '../lib/constants.js';
import { localTimeZone } from '../lib/availability.js';
import { timeAgo } from '../lib/format.js';
import { Badge, Button, ChipSelect, EmptyState, ErrorState, Field, Input, InlineError, PageHeader, Panel, Segmented, Select, Skeleton, Textarea, Toggle, cx } from '../components/ui.jsx';
import { Avatar } from '../components/gaming.jsx';
import AvatarPicker from '../components/AvatarPicker.jsx';
import AvailabilityGrid from '../components/AvailabilityGrid.jsx';
import { useConfirm, useToast } from '../components/feedback.jsx';

const TABS = [
  { id: 'profile', label: 'Profile', icon: LuUser },
  { id: 'style', label: 'Profile style', icon: LuSparkles },
  { id: 'availability', label: 'Availability', icon: LuCalendarClock },
  { id: 'teammates', label: 'Teammate preferences', icon: LuUsers },
  { id: 'privacy', label: 'Privacy', icon: LuLock },
  { id: 'notifications', label: 'Notifications', icon: LuBell },
  { id: 'safety', label: 'Blocked & reports', icon: LuShield },
  { id: 'account', label: 'Account', icon: LuKeyRound },
];

/** Local copy of profile fields with dirty tracking and a save action. */
function useProfileForm(keys) {
  const { profile, updateProfile } = useApp();
  const toast = useToast();
  const pick = () => Object.fromEntries(keys.map((k) => [k, profile[k]]));
  const [v, setV] = useState(pick);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const dirty = JSON.stringify(v) !== JSON.stringify(pick());
  const set = (k) => (val) => setV((s) => ({ ...s, [k]: val }));
  const save = async (extra = {}) => {
    setBusy(true); setErr(null);
    try { await updateProfile({ ...v, ...extra }); toast('Settings saved'); } catch (e) { setErr(e); } finally { setBusy(false); }
  };
  const reset = () => { setV(pick()); setErr(null); };
  return { v, set, setV, dirty, busy, err, save, reset };
}

function SaveBar({ form, onSave }) {
  return (
    <div className={cx('save-bar', form.dirty && 'dirty')}>
      <InlineError error={form.err} />
      <span className="muted small">{form.dirty ? 'Unsaved changes' : 'All changes saved'}</span>
      <Button variant="ghost" onClick={form.reset} disabled={!form.dirty || form.busy}>Discard</Button>
      <Button variant="primary" onClick={onSave || (() => form.save())} loading={form.busy} disabled={!form.dirty}>Save changes</Button>
    </div>
  );
}

export default function SettingsPage({ params }) {
  const tab = TABS.find((t) => t.id === params.tab)?.id || 'profile';
  return (
    <div>
      <PageHeader title="Settings" />
      <div className="settings">
        <nav className="settings-nav" aria-label="Settings sections">
          {TABS.map((t) => (
            <Link key={t.id} to={`/settings/${t.id}`} className={cx('settings-link', tab === t.id && 'active')} aria-current={tab === t.id ? 'page' : undefined}>
              <t.icon aria-hidden />{t.label}
            </Link>
          ))}
          <Link to="/games" className="settings-link"><LuGamepad2 aria-hidden />Game profiles</Link>
        </nav>
        <div className="settings-body">
          {tab === 'profile' && <ProfileSection />}
          {tab === 'style' && <StyleSection />}
          {tab === 'availability' && <AvailabilitySection />}
          {tab === 'teammates' && <TeammatesSection />}
          {tab === 'privacy' && <PrivacySection />}
          {tab === 'notifications' && <NotificationsSection />}
          {tab === 'safety' && <SafetySection />}
          {tab === 'account' && <AccountSection />}
        </div>
      </div>
    </div>
  );
}

function ProfileSection() {
  const { userId, profile } = useApp();
  const form = useProfileForm(['username', 'avatar_url', 'custom_status', 'bio', 'region', 'languages', 'platforms', 'mic_preference', 'playstyles', 'looking_for', 'highlights']);
  const { v, set } = form;
  const name = useDebounced(v.username.trim(), 350);
  const [taken, setTaken] = useState(false);
  useEffect(() => {
    if (name === profile.username || !/^[A-Za-z0-9_]{3,20}$/.test(name)) { setTaken(false); return; }
    api.isUsernameAvailable(name).then((ok) => setTaken(!ok)).catch(() => {});
  }, [name, profile.username]);
  const nameErr = !/^[A-Za-z0-9_]{3,20}$/.test(v.username.trim()) ? '3–20 letters, numbers or underscores.' : taken ? 'That username is taken.' : null;
  const [hl, setHl] = useState('');
  const addHl = () => { const t = hl.trim(); if (t && v.highlights.length < 5) { set('highlights')([...v.highlights, t.slice(0, 80)]); setHl(''); } };
  return (
    <>
      <Panel title="Public profile">
        <div className="form-body">
          <Field label="Username" htmlFor="s-name" error={nameErr}><Input id="s-name" maxLength={20} value={v.username} onChange={(e) => set('username')(e.target.value)} /></Field>
          <Field label="Profile picture"><AvatarPicker userId={userId} username={v.username} value={v.avatar_url} onChange={set('avatar_url')} /></Field>
          <Field label="Custom status" htmlFor="s-cs" optional hint={`${(v.custom_status || '').length}/60. Shown next to your name in member lists.`}>
            <Input id="s-cs" maxLength={60} value={v.custom_status || ''} onChange={(e) => set('custom_status')(e.target.value)} placeholder="e.g. grinding ranked, back at 9" />
          </Field>
          <Field label="Bio" htmlFor="s-bio" optional hint={`${v.bio.length}/500`}><Textarea id="s-bio" rows={3} maxLength={500} value={v.bio} onChange={(e) => set('bio')(e.target.value)} placeholder="What you play, what you're working on, what kind of teammate you are" /></Field>
          <div className="field-pair">
            <Field label="Region" htmlFor="s-region"><Select id="s-region" options={REGIONS} value={v.region} onChange={set('region')} placeholder="Not set" /></Field>
            <Field label="Looking for"><Segmented ariaLabel="Looking for" options={LOOKING_FOR} value={v.looking_for} onChange={set('looking_for')} /></Field>
          </div>
          <Field label="Languages" hint="Up to 8."><ChipSelect options={LANGUAGES} value={v.languages} onChange={set('languages')} max={8} ariaLabel="Languages" /></Field>
          <Field label="Platforms"><ChipSelect options={PLATFORMS} value={v.platforms} onChange={set('platforms')} ariaLabel="Platforms" /></Field>
          <Field label="Microphone"><Segmented ariaLabel="Microphone" options={MIC_OPTIONS} value={v.mic_preference} onChange={set('mic_preference')} /></Field>
          <Field label="Playstyle" hint="Up to 6."><ChipSelect options={PLAYSTYLES} value={v.playstyles} onChange={set('playstyles')} max={6} ariaLabel="Playstyle" /></Field>
          <Field label="Highlights" optional hint="Up to 5 short lines, shown as self-reported (e.g. “Reached Diamond 2 last season”).">
            <div className="row gap-s">
              <Input value={hl} maxLength={80} onChange={(e) => setHl(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addHl(); } }} placeholder="Add a highlight" disabled={v.highlights.length >= 5} />
              <Button onClick={addHl} disabled={!hl.trim() || v.highlights.length >= 5}>Add</Button>
            </div>
            <ul className="hl-edit">{v.highlights.map((h, i) => <li key={`${h}-${i}`}>{h}<Button size="sm" variant="link" onClick={() => set('highlights')(v.highlights.filter((_, j) => j !== i))}>Remove</Button></li>)}</ul>
          </Field>
        </div>
      </Panel>
      <SaveBar form={form} onSave={() => (nameErr ? null : form.save({ username: v.username.trim() }))} />
    </>
  );
}

function AvailabilitySection() {
  const form = useProfileForm(['availability']);
  return (
    <>
      <Panel title="Usual playtimes">
        <p className="muted pad-x">Used for “plays when you do” matching and the overlap shown on player cards.</p>
        <div className="pad"><AvailabilityGrid value={form.v.availability} onChange={form.set('availability')} /></div>
      </Panel>
      <SaveBar form={form} onSave={() => form.save({ timezone: localTimeZone() })} />
    </>
  );
}

function TeammatesSection() {
  const form = useProfileForm(['teammate_traits', 'pref_teammate_mic']);
  return (
    <>
      <Panel title="What you look for in teammates">
        <div className="form-body">
          <Field label="Teammates who…" hint="Up to 8. These shape your compatibility scores."><ChipSelect options={TEAMMATE_TRAITS} value={form.v.teammate_traits} onChange={form.set('teammate_traits')} max={8} ariaLabel="Teammate traits" /></Field>
          <Field label="Voice chat"><Segmented ariaLabel="Teammate mic" options={TEAMMATE_MIC} value={form.v.pref_teammate_mic} onChange={form.set('pref_teammate_mic')} /></Field>
          <p className="muted small">Per-game settings like rank, roles and modes live in <Link to="/games">Game profiles</Link>.</p>
        </div>
      </Panel>
      <SaveBar form={form} />
    </>
  );
}

function PrivacySection() {
  const form = useProfileForm(['discoverable', 'show_bio', 'show_region', 'show_languages', 'show_platforms', 'show_availability', 'show_ranks',
    'show_highlights', 'show_online_status', 'allow_friend_requests', 'allow_party_invites', 'allow_messages', 'show_demo_players']);
  const { v, set } = form;
  return (
    <>
      <Panel title="Discovery">
        <div className="form-body">
          <Toggle checked={v.discoverable} onChange={set('discoverable')} label="Show me in Find Players and Quick Match" hint="When off, people can still see your profile from parties and chats." />
          <Toggle checked={v.show_demo_players} onChange={set('show_demo_players')} label="Include demo players" hint="Demo profiles are sample data for development and are always labelled." />
        </div>
      </Panel>
      <Panel title="What other players can see">
        <div className="form-body">
          <p className="muted small">Your email is never shown. Hidden details are also left out of other players' compatibility scores and filters.</p>
          <Toggle checked={v.show_online_status} onChange={set('show_online_status')} label="Online status and last active" />
          <Toggle checked={v.show_bio} onChange={set('show_bio')} label="Bio" />
          <Toggle checked={v.show_region} onChange={set('show_region')} label="Region" />
          <Toggle checked={v.show_languages} onChange={set('show_languages')} label="Languages" />
          <Toggle checked={v.show_platforms} onChange={set('show_platforms')} label="Platforms" />
          <Toggle checked={v.show_availability} onChange={set('show_availability')} label="Playtimes" />
          <Toggle checked={v.show_ranks} onChange={set('show_ranks')} label="Ranks" />
          <Toggle checked={v.show_highlights} onChange={set('show_highlights')} label="Highlights" />
        </div>
      </Panel>
      <Panel title="Who can contact you">
        <div className="form-body">
          <Field label="Friend requests"><Segmented ariaLabel="Friend requests" value={v.allow_friend_requests} onChange={set('allow_friend_requests')} options={[{ value: 'everyone', label: 'Everyone' }, { value: 'nobody', label: 'Nobody' }]} /></Field>
          <Field label="Party invites"><Segmented ariaLabel="Party invites" value={v.allow_party_invites} onChange={set('allow_party_invites')} options={[{ value: 'everyone', label: 'Everyone' }, { value: 'friends', label: 'Friends' }, { value: 'nobody', label: 'Nobody' }]} /></Field>
          <Field label="Direct messages" hint="Party chat always works for party members."><Segmented ariaLabel="Direct messages" value={v.allow_messages} onChange={set('allow_messages')} options={[{ value: 'everyone', label: 'Everyone' }, { value: 'friends', label: 'Friends' }, { value: 'nobody', label: 'Nobody' }]} /></Field>
        </div>
      </Panel>
      <SaveBar form={form} />
    </>
  );
}

function NotificationsSection() {
  const form = useProfileForm(['notify_friend_requests', 'notify_party_invites', 'notify_join_requests', 'notify_request_updates', 'notify_messages', 'notify_mentions']);
  const { v, set } = form;
  return (
    <>
      <Panel title="In-app notifications">
        <div className="form-body">
          <Toggle checked={v.notify_friend_requests} onChange={set('notify_friend_requests')} label="Friend requests" hint="New requests and accepted requests" />
          <Toggle checked={v.notify_party_invites} onChange={set('notify_party_invites')} label="Party invites" />
          <Toggle checked={v.notify_join_requests} onChange={set('notify_join_requests')} label="Join requests" hint="When someone asks to join a party you lead" />
          <Toggle checked={v.notify_request_updates} onChange={set('notify_request_updates')} label="Party updates" hint="Accepted or declined requests, leadership changes, removals, closed parties" />
          <Toggle checked={v.notify_messages} onChange={set('notify_messages')} label="New messages" hint="Direct, group and party chats. Mute single conversations from their header." />
          <Toggle checked={v.notify_mentions} onChange={set('notify_mentions')} label="Mentions and replies" hint="When someone @mentions you or replies to your message, including in community channels" />
          <p className="muted small">Moderation notices are always delivered. Muted and blocked players never notify you.</p>
        </div>
      </Panel>
      <SaveBar form={form} />
    </>
  );
}

function SafetySection() {
  const toast = useToast();
  const lists = useAsync(() => api.listBlockedAndMuted(), []);
  const reports = useAsync(() => api.myReports(), []);
  const act = async (fn, msg) => { try { await fn(); toast(msg); lists.reload({ quiet: true }); } catch (e) { toast(e, 'error'); } };
  const statusTone = { open: 'neutral', in_review: 'warn', resolved: 'good', dismissed: 'neutral' };
  const block = (title, rows, empty, onRemove, removeLabel) => (
    <Panel title={title}>
      {rows.length === 0 ? <p className="muted small pad">{empty}</p> : (
        <ul className="mini-list">
          {rows.map((u) => (
            <li key={u.id}>
              <span className="row gap-s grow"><Avatar user={u} size={30} /><strong>{u.username}</strong><span className="muted small">since {timeAgo(u.since)}</span></span>
              <Button size="sm" onClick={() => onRemove(u)}>{removeLabel}</Button>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
  return (
    <>
      {lists.error ? <ErrorState error={lists.error} onRetry={lists.reload} /> : !lists.data ? <Skeleton h={120} /> : (
        <>
          {block('Blocked players', lists.data.blocked, "You haven't blocked anyone. Blocked players can't message, invite or friend you, and can't see your profile.",
            (u) => act(() => api.unblockUser(u.id), `Unblocked ${u.username}`), 'Unblock')}
          {block('Muted players', lists.data.muted, "You haven't muted anyone. Muting hides someone's messages and notifications without blocking them.",
            (u) => act(() => api.unmuteUser(u.id), `Unmuted ${u.username}`), 'Unmute')}
        </>
      )}
      <Panel title="Your reports">
        {reports.error ? <ErrorState error={reports.error} onRetry={reports.reload} /> : !reports.data ? <Skeleton h={60} /> : reports.data.length === 0 ? (
          <p className="muted small pad">Reports you submit appear here with their review status. Report a player from their profile, a party, or a message.</p>
        ) : (
          <ul className="mini-list">
            {reports.data.map((r) => (
              <li key={r.id}>
                <span className="grow"><strong>{r.reported_username}</strong><span className="muted small block">{label(REPORT_CATEGORIES, r.category)}, {timeAgo(r.created_at)}</span></span>
                <Badge tone={statusTone[r.status]}>{r.status.replace('_', ' ')}</Badge>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </>
  );
}

const STATUS_EMOJI = ['', '🎮', '🔥', '🏆', '🎧', '😴', '🍕', '👻', '🎃', '💀', '⚔️', '🚀', '🌙', '💜'];

function StyleSection() {
  const { profile, userId } = useApp();
  const form = useProfileForm(['banner_url', 'theme_color', 'theme_color_2', 'name_style', 'avatar_decoration', 'profile_effect', 'status_emoji']);
  const { v, set } = form;
  const file = useRef(null);
  const [upBusy, setUpBusy] = useState(false);
  const [upErr, setUpErr] = useState(null);
  const preview = { ...profile, ...v };
  const upload = async (e) => {
    const f = e.target.files?.[0]; e.target.value = '';
    if (!f) return;
    setUpBusy(true); setUpErr(null);
    try { set('banner_url')(await api.uploadBanner(userId, f)); } catch (ex) { setUpErr(ex); } finally { setUpBusy(false); }
  };
  const pick = (list, key, label) => (
    <Field label={label}>
      <div className="style-grid" role="radiogroup" aria-label={label}>
        {list.map((o) => (
          <button key={o.value} type="button" role="radio" aria-checked={v[key] === o.value} className={cx('style-opt', v[key] === o.value && 'on')} onClick={() => set(key)(o.value)}>
            {key === 'name_style' ? <Name user={{ name_style: o.value }}>{o.label}</Name>
              : key === 'avatar_decoration' ? <><Avatar user={{ ...profile, avatar_decoration: o.value }} size={36} /><small>{o.label}</small></>
              : <><span className="fx-swatch"><ProfileEffect effect={o.value} /></span><small>{o.label}</small></>}
          </button>
        ))}
      </div>
    </Field>
  );
  return (
    <>
      <Panel title="Preview">
        <div className={`style-preview${preview.theme_color ? ' themed' : ''}`} style={themeVars(preview)}>
          <div className="style-preview-band" style={{ background: bannerBackground(preview) }}><ProfileEffect effect={preview.profile_effect} /></div>
          <div className="style-preview-body">
            <Avatar user={preview} size={72} status="online" />
            <div><div className="pop-name"><Name user={preview} /></div>
              <div className="custom-status">{preview.status_emoji} {preview.custom_status || 'Your custom status shows here'}</div></div>
          </div>
        </div>
        <p className="muted small">All of this is free. Animated GIF avatars and banners play everywhere your profile shows.</p>
      </Panel>
      <Panel title="Banner & theme">
        <div className="form-body">
          <div className="banner-presets" role="radiogroup" aria-label="Banner">
            <button type="button" role="radio" aria-checked={!v.banner_url} className={cx('banner-opt', !v.banner_url && 'on')} onClick={() => set('banner_url')(null)}
              style={{ background: v.theme_color ? `linear-gradient(120deg, ${v.theme_color}, ${v.theme_color_2 || v.theme_color})` : '#2a2c31' }}><small>Theme colours</small></button>
            {BANNER_PRESETS.map((b) => (
              <button key={b.id} type="button" role="radio" aria-checked={v.banner_url === b.id} className={cx('banner-opt', v.banner_url === b.id && 'on')}
                style={{ background: b.css }} onClick={() => set('banner_url')(b.id)}><small>{b.name}</small></button>
            ))}
          </div>
          <div className="row gap-s wrap">
            <Button size="sm" icon={LuUpload} loading={upBusy} onClick={() => file.current?.click()}>Upload banner (GIF works)</Button>
            <input ref={file} type="file" accept="image/png,image/jpeg,image/webp,image/gif" hidden onChange={upload} />
            <label className="color-field">Theme <input type="color" value={v.theme_color || '#f26b38'} onChange={(e) => set('theme_color')(e.target.value)} aria-label="Primary theme colour" /></label>
            <label className="color-field">Accent <input type="color" value={v.theme_color_2 || v.theme_color || '#b3245b'} onChange={(e) => set('theme_color_2')(e.target.value)} aria-label="Secondary theme colour" /></label>
            {(v.theme_color || v.theme_color_2) && <Button size="sm" variant="ghost" onClick={() => { set('theme_color')(null); set('theme_color_2')(null); }}>Clear colours</Button>}
          </div>
          <InlineError error={upErr} />
        </div>
      </Panel>
      <Panel title="Name, avatar & effects">
        <div className="form-body">
          {pick(NAME_STYLES, 'name_style', 'Name style')}
          {pick(DECORATIONS, 'avatar_decoration', 'Avatar decoration')}
          {pick(EFFECTS, 'profile_effect', 'Profile effect')}
          <Field label="Status emoji">
            <div className="emoji-row" role="radiogroup" aria-label="Status emoji">
              {STATUS_EMOJI.map((e) => (
                <button key={e || 'none'} type="button" role="radio" aria-checked={v.status_emoji === e} className={cx('emoji-opt', v.status_emoji === e && 'on')} onClick={() => set('status_emoji')(e)}>{e || '∅'}</button>
              ))}
            </div>
          </Field>
        </div>
      </Panel>
      <SaveBar form={form} />
    </>
  );
}

function FunPanel() {
  const [p, setP] = useState(() => getFlavorPrefs());
  const set = (k) => (v) => { setFlavorPref(k, v); setP(getFlavorPrefs()); };
  return (
    <Panel title="Fun stuff">
      <div className="form-body">
        <Toggle checked={p.seasonal} onChange={set('seasonal')} label="Seasonal decorations" hint="Pumpkins, bats and spooky tips in October. Saved on this device." />
        <Toggle checked={p.tips} onChange={set('tips')} label="Tips and fun facts on loading screens" />
      </div>
    </Panel>
  );
}

function AccountSection() {
  const { user, profile, signOut } = useApp();
  const toast = useToast();
  const confirm = useConfirm();
  const [email, setEmail] = useState(user.email || '');
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [busy, setBusy] = useState(null);
  const [err, setErr] = useState(null);
  const changeEmail = async (e) => {
    e.preventDefault(); setErr(null); setBusy('email');
    const { error } = await supabase.auth.updateUser({ email: email.trim() }, { emailRedirectTo: authRedirect() });
    setBusy(null);
    if (error) setErr(error); else { setPendingEmail(email.trim()); toast('Check your inbox for a confirmation code'); }
  };
  const [pendingEmail, setPendingEmail] = useState(null);
  const [emailCode, setEmailCode] = useState('');
  const confirmEmail = async (e) => {
    e.preventDefault(); setErr(null); setBusy('code');
    const { error } = await supabase.auth.verifyOtp({ email: pendingEmail, token: emailCode.replace(/\D/g, ''), type: 'email_change' });
    setBusy(null);
    if (error) setErr(error); else { setPendingEmail(null); setEmailCode(''); toast('Email updated'); }
  };
  const changePw = async (e) => {
    e.preventDefault(); setErr(null);
    if (pw.length < 8) return setErr(new Error('Use at least 8 characters.'));
    if (pw !== pw2) return setErr(new Error("Passwords don't match."));
    setBusy('pw');
    const { error } = await supabase.auth.updateUser({ password: pw });
    setBusy(null);
    if (error) setErr(error); else { setPw(''); setPw2(''); toast('Password updated'); }
  };
  const providers = user.app_metadata?.providers || [user.app_metadata?.provider].filter(Boolean);
  const hasPassword = providers.includes('email');
  const del = () => confirm({
    title: 'Delete your account?',
    body: <>This permanently deletes your profile, game profiles, friendships and party memberships. Messages you sent stay in those chats, shown as from a deleted account. Parties you lead pass to another member. <b>This can't be undone.</b></>,
    confirmLabel: 'Delete my account', danger: true, requireText: profile.username,
    action: async () => { await api.deleteMyAccount(profile.username); await supabase.auth.signOut(); navigate('/login', { replace: true }); },
  });
  return (
    <>
      <Panel title="Sign-in methods">
        <div className="form-body">
          <div className="signin-methods">
            {hasPassword && <span className="signin-method"><LuMail aria-hidden />Email and password</span>}
            {providers.includes('google') && <span className="signin-method"><FcGoogle aria-hidden />Google</span>}
          </div>
          {!hasPassword && <p className="muted small">You sign in with Google. Add a password below to also sign in with your email address.</p>}
        </div>
      </Panel>
      <Panel title="Email">
        <form className="form-body" onSubmit={changeEmail}>
          <p className="muted small">Private — only you can see it.</p>
          <Field label="Email address" htmlFor="a-email"><Input id="a-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
          <div><Button type="submit" loading={busy === 'email'} disabled={email.trim() === user.email}>Change email</Button></div>
        </form>
        {pendingEmail && (
          <form className="form-body" onSubmit={confirmEmail}>
            <Field label={`Code sent to ${pendingEmail}`} htmlFor="a-email-code" hint="Or press the button in that email.">
              <Input id="a-email-code" className="otp-input" inputMode="numeric" autoComplete="one-time-code" maxLength={10} value={emailCode} onChange={(e) => setEmailCode(e.target.value)} />
            </Field>
            <div><Button type="submit" variant="primary" loading={busy === 'code'} disabled={emailCode.replace(/\D/g, '').length < 6}>Confirm new email</Button></div>
          </form>
        )}
      </Panel>
      <Panel title={hasPassword ? 'Password' : 'Add a password'}>
        <form className="form-body" onSubmit={changePw}>
          <div className="field-pair">
            <Field label="New password" htmlFor="a-pw"><Input id="a-pw" type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} /></Field>
            <Field label="Confirm" htmlFor="a-pw2"><Input id="a-pw2" type="password" autoComplete="new-password" value={pw2} onChange={(e) => setPw2(e.target.value)} /></Field>
          </div>
          <div><Button type="submit" loading={busy === 'pw'} disabled={!pw}>Update password</Button></div>
        </form>
      </Panel>
      <InlineError error={err} />
      <FunPanel />
      <Panel title="Session">
        <div className="form-body"><div><Button onClick={signOut}>Sign out</Button></div></div>
      </Panel>
      <Panel title="Delete account" className="danger-zone">
        <div className="form-body">
          <p className="muted small">Permanently remove your PartyUp account and data. Reports you filed are kept for moderation without your name.</p>
          <div><Button variant="danger" onClick={del}>Delete account</Button></div>
        </div>
      </Panel>
    </>
  );
}
