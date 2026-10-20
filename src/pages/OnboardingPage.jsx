import { useEffect, useState } from 'react';
import { LuCheck, LuLogOut } from 'react-icons/lu';
import * as api from '../lib/api.js';
import { useApp } from '../context/AppContext.jsx';
import { useAsync, useDebounced } from '../hooks/useAsync.js';
import {
  REGIONS, LANGUAGES, PLATFORMS, MIC_OPTIONS, PLAYSTYLES, LOOKING_FOR, TEAMMATE_TRAITS, TEAMMATE_MIC, GENRES,
} from '../lib/constants.js';
import { localTimeZone } from '../lib/availability.js';
import Logo from '../components/Logo.jsx';
import AvatarPicker from '../components/AvatarPicker.jsx';
import AvailabilityGrid from '../components/AvailabilityGrid.jsx';
import { Button, ChipSelect, Field, Input, InlineError, Select, Segmented, PageLoader, cx } from '../components/ui.jsx';
import { GameTag } from '../components/gaming.jsx';
import { useToast } from '../components/feedback.jsx';

const STEPS = ['Profile', 'Where you play', 'Games', 'Schedule', 'Playstyle', 'Teammates'];

export default function OnboardingPage() {
  const { profile, userId, updateProfile, signOut } = useApp();
  const toast = useToast();
  const games = useAsync(() => api.getGames(), []);
  const mine = useAsync(() => api.getMyGameProfiles(userId), [userId]);
  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const [f, setF] = useState(() => ({
    username: profile.username.startsWith('player_') ? '' : profile.username,
    avatar_url: profile.avatar_url, region: profile.region, languages: profile.languages, platforms: profile.platforms,
    availability: profile.availability, mic_preference: profile.mic_preference, playstyles: profile.playstyles,
    looking_for: profile.looking_for, teammate_traits: profile.teammate_traits, pref_teammate_mic: profile.pref_teammate_mic,
  }));
  const set = (k) => (v) => setF((s) => ({ ...s, [k]: v }));
  const [picked, setPicked] = useState({}); // game_id -> {rank, main_role, platform}
  const [gq, setGq] = useState('');
  const [genre, setGenre] = useState(null);

  useEffect(() => {
    if (mine.data) setPicked(Object.fromEntries(mine.data.map((g) => [g.game_id, { id: g.id, rank: g.rank, main_role: g.main_role, platform: g.platform }])));
  }, [mine.data]);

  const name = useDebounced(f.username.trim(), 350);
  const [nameState, setNameState] = useState(null); // null | 'checking' | 'ok' | 'taken' | 'invalid'
  useEffect(() => {
    if (!name) { setNameState(null); return; }
    if (!/^[A-Za-z0-9_]{3,20}$/.test(name)) { setNameState('invalid'); return; }
    setNameState('checking');
    api.isUsernameAvailable(name).then((ok) => setNameState(ok ? 'ok' : 'taken')).catch(() => setNameState(null));
  }, [name]);

  const saveStep = async () => {
    setErr(null);
    if (step === 0) {
      if (!/^[A-Za-z0-9_]{3,20}$/.test(f.username.trim())) throw new Error('Pick a username: 3–20 letters, numbers or underscores.');
      if (nameState === 'taken') throw new Error('That username is taken.');
      await updateProfile({ username: f.username.trim(), avatar_url: f.avatar_url });
    } else if (step === 1) {
      await updateProfile({ region: f.region, languages: f.languages, platforms: f.platforms, timezone: localTimeZone() });
    } else if (step === 2) {
      for (const [gid, g] of Object.entries(picked)) {
        const fields = { rank: g.rank || null, main_role: g.main_role || null, platform: g.platform || null };
        if (g.id) await api.updateGameProfile(g.id, fields);
        else {
          const row = await api.createGameProfile({ user_id: userId, game_id: gid, ...fields });
          setPicked((p) => ({ ...p, [gid]: { ...p[gid], id: row.id } }));
        }
      }
      for (const g of mine.data || []) if (!picked[g.game_id]) await api.deleteGameProfile(g.id);
      mine.reload({ quiet: true });
    } else if (step === 3) {
      await updateProfile({ availability: f.availability, timezone: localTimeZone() });
    } else if (step === 4) {
      await updateProfile({ mic_preference: f.mic_preference, playstyles: f.playstyles, looking_for: f.looking_for || 'both' });
    } else if (step === 5) {
      await updateProfile({ teammate_traits: f.teammate_traits, pref_teammate_mic: f.pref_teammate_mic || 'any' });
    }
  };

  const next = async () => {
    setBusy(true);
    try {
      await saveStep();
      if (step === STEPS.length - 1) {
        await updateProfile({ onboarded_at: new Date().toISOString() });
        toast(`Welcome to PartyUp, ${f.username.trim()}!`);
      } else setStep(step + 1);
    } catch (e) { setErr(e); } finally { setBusy(false); }
  };
  const skip = async () => {
    setErr(null);
    if (step === STEPS.length - 1) {
      setBusy(true);
      try { await updateProfile({ onboarded_at: new Date().toISOString() }); } catch (e) { setErr(e); } finally { setBusy(false); }
    } else setStep(step + 1);
  };

  if (games.loading || mine.loading) return <PageLoader />;

  return (
    <div className="onboard">
      <header className="onboard-head">
        <Logo />
        <Button variant="ghost" size="sm" icon={LuLogOut} onClick={signOut}>Sign out</Button>
      </header>
      <ol className="stepper" aria-label="Setup progress">
        {STEPS.map((s, i) => (
          <li key={s} className={cx(i === step && 'current', i < step && 'done')} aria-current={i === step ? 'step' : undefined}>
            <span className="step-dot">{i < step ? <LuCheck aria-hidden /> : i + 1}</span><span className="step-name">{s}</span>
          </li>
        ))}
      </ol>

      <div className="onboard-card">
        {step === 0 && (
          <>
            <h1>Pick your name and look</h1>
            <p className="sub">This is how other players will see you. Your email is never shown.</p>
            <Field label="Username" htmlFor="ob-name"
              error={nameState === 'taken' ? 'That username is taken.' : nameState === 'invalid' ? '3–20 letters, numbers or underscores.' : null}
              hint={nameState === 'ok' ? 'Available' : nameState === 'checking' ? 'Checking…' : 'You can change it later in Settings.'}>
              <Input id="ob-name" value={f.username} maxLength={20} onChange={(e) => set('username')(e.target.value)} autoComplete="username" data-autofocus />
            </Field>
            <Field label="Profile picture" optional><AvatarPicker userId={userId} username={f.username || 'you'} value={f.avatar_url} onChange={set('avatar_url')} /></Field>
          </>
        )}
        {step === 1 && (
          <>
            <h1>Where do you play?</h1>
            <p className="sub">Region keeps your ping low. Languages decide who you can talk to.</p>
            <Field label="Region" htmlFor="ob-region"><Select id="ob-region" options={REGIONS} value={f.region} onChange={set('region')} placeholder="Choose a region" /></Field>
            <Field label="Languages you can play in" hint="Up to 8."><ChipSelect options={LANGUAGES} value={f.languages} onChange={set('languages')} max={8} ariaLabel="Languages" /></Field>
            <Field label="Platforms"><ChipSelect options={PLATFORMS} value={f.platforms} onChange={set('platforms')} ariaLabel="Platforms" /></Field>
          </>
        )}
        {step === 2 && (
          <>
            <h1>What do you play?</h1>
            <p className="sub">Pick your games. Ranks are self-reported — PartyUp doesn't connect to game accounts or verify ranks. You can add modes and roles in detail later.</p>
            <div className="game-pick-tools">
              <Input type="search" placeholder={`Search ${games.data.length} games`} aria-label="Search games" value={gq} onChange={(e) => setGq(e.target.value)} />
              <Select aria-label="Genre" value={genre} onChange={setGenre} placeholder="All genres"
                options={Object.entries(GENRES).filter(([k]) => games.data.some((g) => g.genre === k)).map(([value, label]) => ({ value, label }))} />
              {Object.keys(picked).length > 0 && <span className="muted small">{Object.keys(picked).length} selected</span>}
            </div>
            <div className="game-pick">
              {games.data.filter((g) => picked[g.id] || ((!genre || g.genre === genre) && g.name.toLowerCase().includes(gq.trim().toLowerCase()))).map((g) => {
                const on = !!picked[g.id];
                return (
                  <div key={g.id} className={cx('game-pick-item', on && 'on')} style={{ '--gc': g.accent_color }}>
                    <button type="button" className="game-pick-toggle" aria-pressed={on}
                      onClick={() => setPicked((p) => { const n = { ...p }; if (on) delete n[g.id]; else n[g.id] = { platform: g.platforms.find((x) => f.platforms?.includes(x)) || null }; return n; })}>
                      <GameTag game={g} />{on && <LuCheck aria-hidden />}
                    </button>
                    {on && (
                      <div className="game-pick-fields">
                        {g.ranks.length > 0 ? <Select aria-label={`${g.name} rank`} options={g.ranks.map((r) => ({ value: r, label: r }))} value={picked[g.id].rank}
                          onChange={(v) => setPicked((p) => ({ ...p, [g.id]: { ...p[g.id], rank: v } }))} placeholder="Rank (optional)" /> : <span className="muted small" style={{ alignSelf: 'center' }}>No ranks</span>}
                        {g.roles.length > 0 ? <Select aria-label={`${g.name} main role`} options={g.roles.map((r) => ({ value: r, label: r }))} value={picked[g.id].main_role}
                          onChange={(v) => setPicked((p) => ({ ...p, [g.id]: { ...p[g.id], main_role: v } }))} placeholder="Main role" /> : <span />}
                        <Select aria-label={`${g.name} platform`} options={g.platforms.map((x) => PLATFORMS.find((pl) => pl.value === x))} value={picked[g.id].platform}
                          onChange={(v) => setPicked((p) => ({ ...p, [g.id]: { ...p[g.id], platform: v } }))} placeholder="Platform" />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </>
        )}
        {step === 3 && (
          <>
            <h1>When do you usually play?</h1>
            <p className="sub">We use this to find people who are online at the same times as you.</p>
            <AvailabilityGrid value={f.availability} onChange={set('availability')} />
          </>
        )}
        {step === 4 && (
          <>
            <h1>How do you play?</h1>
            <Field label="Microphone"><Segmented options={MIC_OPTIONS} value={f.mic_preference} onChange={set('mic_preference')} ariaLabel="Microphone" /></Field>
            <Field label="Your playstyle" hint="Up to 6."><ChipSelect options={PLAYSTYLES} value={f.playstyles} onChange={set('playstyles')} max={6} ariaLabel="Playstyle" /></Field>
            <Field label="Looking for"><Segmented options={LOOKING_FOR} value={f.looking_for} onChange={set('looking_for')} ariaLabel="Looking for" /></Field>
          </>
        )}
        {step === 5 && (
          <>
            <h1>What makes a good teammate?</h1>
            <p className="sub">We weigh these when ranking matches for you.</p>
            <Field label="Teammates who…" hint="Up to 8."><ChipSelect options={TEAMMATE_TRAITS} value={f.teammate_traits} onChange={set('teammate_traits')} max={8} ariaLabel="Teammate traits" /></Field>
            <Field label="Voice chat"><Segmented options={TEAMMATE_MIC} value={f.pref_teammate_mic} onChange={set('pref_teammate_mic')} ariaLabel="Teammate microphone" /></Field>
          </>
        )}
        <InlineError error={err} />
        <div className="onboard-actions">
          {step > 0 ? <Button variant="ghost" onClick={() => { setErr(null); setStep(step - 1); }} disabled={busy}>Back</Button> : <span />}
          <div className="row gap-s">
            {step > 0 && <Button variant="ghost" onClick={skip} disabled={busy}>{step === STEPS.length - 1 ? 'Skip and finish' : 'Skip for now'}</Button>}
            <Button variant="primary" onClick={next} loading={busy} disabled={step === 0 && (nameState === 'taken' || nameState === 'invalid')}>
              {step === STEPS.length - 1 ? 'Finish setup' : 'Continue'}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
