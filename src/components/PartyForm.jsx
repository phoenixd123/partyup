import { useMemo, useState } from 'react';
import { LANGUAGES, REGIONS, PLATFORMS, gameOptions } from '../lib/constants.js';
import { Button, ChipSelect, Field, Input, InlineError, Segmented, Select, Textarea, Toggle } from './ui.jsx';

function toLocalInput(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * Create or edit a party. In edit mode only fields the server allows to change are shown.
 * onSubmit(values) must throw on failure.
 */
export default function PartyForm({ games, initial, mode = 'create', myProfile, myGameProfiles = [], onSubmit, onCancel }) {
  const [v, setV] = useState(() => ({
    game: initial?.game_id || myGameProfiles[0]?.game_id || null,
    title: initial?.title || '', description: initial?.description || '',
    max_size: initial?.max_size || null, needed_roles: initial?.needed_roles || [],
    play_type: initial?.play_type || 'casual', min_rank: initial?.min_rank_index ?? null, max_rank: initial?.max_rank_index ?? null,
    language: initial?.language ?? myProfile?.languages?.[0] ?? null, region: initial?.region ?? myProfile?.region ?? null,
    platform: initial?.platform ?? null, mic_required: initial?.mic_required ?? false,
    visibility: initial?.visibility || 'public', scheduled: toLocalInput(initial?.scheduled_for),
    my_role: myGameProfiles.find((g) => g.game_id === (initial?.game_id || myGameProfiles[0]?.game_id))?.main_role || null,
  }));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const [touched, setTouched] = useState(false);
  const set = (k) => (val) => setV((s) => ({ ...s, [k]: val }));
  const game = games.find((g) => g.id === v.game);
  const edit = mode === 'edit';

  const changeGame = (id) => {
    const g = games.find((x) => x.id === id);
    const gp = myGameProfiles.find((x) => x.game_id === id);
    setV((s) => ({ ...s, game: id, needed_roles: [], min_rank: null, max_rank: null, max_size: g ? Math.min(g.max_party_size, 5) : null,
      platform: g && s.platform && !g.platforms.includes(s.platform) ? null : s.platform, my_role: gp?.main_role || null }));
  };

  const size = v.max_size ?? (game ? Math.min(game.max_party_size, 5) : null);
  const errors = useMemo(() => {
    const e = {};
    if (!v.game) e.game = 'Choose a game.';
    if (v.title.trim().length < 3) e.title = 'Give your party a title (3–60 characters).';
    if (game && (size < 2 || size > game.max_party_size)) e.size = `Between 2 and ${game.max_party_size} for ${game.name}.`;
    if (edit && initial && size < initial.member_count) e.size = `The party already has ${initial.member_count} members.`;
    if (v.min_rank !== null && v.max_rank !== null && Number(v.min_rank) > Number(v.max_rank)) e.rank = 'Minimum rank must be at or below the maximum.';
    if (v.scheduled && new Date(v.scheduled) < new Date(Date.now() - 3600e3) && !edit) e.scheduled = 'Pick a time in the future.';
    return e;
  }, [v, game, size, edit, initial]);

  const submit = async (e) => {
    e.preventDefault(); setTouched(true);
    if (Object.keys(errors).length) return;
    setBusy(true); setErr(null);
    try { await onSubmit({ ...v, max_size: size, scheduled_for: v.scheduled ? new Date(v.scheduled).toISOString() : null }); }
    catch (ex) { setErr(ex); setBusy(false); }
  };
  const show = (k) => (touched ? errors[k] : null);
  const rankOpts = game?.ranks.map((r, i) => ({ value: String(i), label: r })) || [];
  const sizes = game ? Array.from({ length: game.max_party_size - 1 }, (_, i) => ({ value: String(i + 2), label: `${i + 2} players` })) : [];

  return (
    <form className="party-form" onSubmit={submit} noValidate>
      {!edit && (
        <Field label="Game" htmlFor="pf-game" error={show('game')}>
          <Select id="pf-game" options={gameOptions(games)} value={v.game} onChange={changeGame} placeholder="Choose a game" />
        </Field>
      )}
      <Field label="Title" htmlFor="pf-title" error={show('title')}>
        <Input id="pf-title" maxLength={60} value={v.title} onChange={(e) => set('title')(e.target.value)} placeholder="e.g. Plat+ ranked, need a Controller" />
      </Field>
      <Field label="Describe the session" htmlFor="pf-desc" optional hint={`${v.description.length}/500`}>
        <Textarea id="pf-desc" rows={3} maxLength={500} value={v.description} onChange={(e) => set('description')(e.target.value)}
          placeholder="What you're playing, the vibe, how long you'll be on" />
      </Field>
      {game && (
        <>
          <div className="field-pair">
            <Field label="Party size" htmlFor="pf-size" error={show('size')}>
              <Select id="pf-size" options={sizes} value={String(size)} onChange={(x) => set('max_size')(Number(x))} />
            </Field>
            {!edit && (
              <Field label="Play type">
                <Segmented ariaLabel="Play type" options={[{ value: 'casual', label: 'Casual' }, { value: 'competitive', label: 'Competitive' }]} value={v.play_type} onChange={set('play_type')} />
              </Field>
            )}
          </div>
          {game.roles.length > 0 && (
            <Field label="Roles you need" optional hint="Shown as open slots players can fill.">
              <ChipSelect options={game.roles.map((r) => ({ value: r, label: r }))} value={v.needed_roles} onChange={set('needed_roles')} max={10} ariaLabel="Needed roles" />
            </Field>
          )}
          {!edit && game.roles.length > 0 && (
            <Field label="Your role in this party" htmlFor="pf-myrole" optional>
              <Select id="pf-myrole" options={game.roles.map((r) => ({ value: r, label: r }))} value={v.my_role} onChange={set('my_role')} placeholder="Not set" />
            </Field>
          )}
          {!edit && game.ranks.length > 0 && (
            <div className="field-pair">
              <Field label="Minimum rank" htmlFor="pf-min" optional error={show('rank')}>
                <Select id="pf-min" options={rankOpts} value={v.min_rank === null ? null : String(v.min_rank)} onChange={(x) => set('min_rank')(x === null ? null : Number(x))} placeholder="Any" />
              </Field>
              <Field label="Maximum rank" htmlFor="pf-max" optional>
                <Select id="pf-max" options={rankOpts} value={v.max_rank === null ? null : String(v.max_rank)} onChange={(x) => set('max_rank')(x === null ? null : Number(x))} placeholder="Any" />
              </Field>
            </div>
          )}
          {!edit && (
            <div className="field-pair three">
              <Field label="Language" htmlFor="pf-lang" optional><Select id="pf-lang" options={LANGUAGES} value={v.language} onChange={set('language')} placeholder="Any" /></Field>
              <Field label="Region" htmlFor="pf-region" optional><Select id="pf-region" options={REGIONS} value={v.region} onChange={set('region')} placeholder="Any" /></Field>
              <Field label="Platform" htmlFor="pf-plat" optional>
                <Select id="pf-plat" options={PLATFORMS.filter((p) => game.platforms.includes(p.value))} value={v.platform} onChange={set('platform')} placeholder="Any" />
              </Field>
            </div>
          )}
        </>
      )}
      <Field label="Who can join">
        <Segmented ariaLabel="Visibility" value={v.visibility} onChange={set('visibility')}
          options={[{ value: 'public', label: 'Public — anyone can request' }, { value: 'invite_only', label: 'Invite only' }]} />
      </Field>
      <div className="field-pair">
        <Field label="Planned start" htmlFor="pf-time" optional error={show('scheduled')} hint="Leave empty if you're playing now.">
          <Input id="pf-time" type="datetime-local" value={v.scheduled} onChange={(e) => set('scheduled')(e.target.value)} />
        </Field>
        {!edit && <div className="field"><span className="field-label">&nbsp;</span><Toggle checked={v.mic_required} onChange={set('mic_required')} label="Mic required" /></div>}
      </div>
      {!edit && myProfile && game && game.ranks.length > 0 && v.min_rank !== null && !myGameProfiles.find((g) => g.game_id === game.id)?.rank && (
        <p className="muted small">Tip: add your own {game.name} rank in Game Profiles so others can check the range fits.</p>
      )}
      <InlineError error={err} />
      <div className="form-actions">
        {onCancel && <Button variant="ghost" onClick={onCancel} disabled={busy}>Cancel</Button>}
        <Button type="submit" variant="primary" loading={busy}>{edit ? 'Save changes' : 'Create party'}</Button>
      </div>
    </form>
  );
}
