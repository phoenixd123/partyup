import { useState } from 'react';
import { LuPlus, LuPencil, LuTrash2, LuGamepad2, LuEyeOff } from 'react-icons/lu';
import * as api from '../lib/api.js';
import { useAsync } from '../hooks/useAsync.js';
import { useApp } from '../context/AppContext.jsx';
import { EXPERIENCE, SESSION_LENGTHS, PLAYSTYLES, LOOKING_FOR, PLATFORMS, label, gameOptions } from '../lib/constants.js';
import { Badge, Button, ChipSelect, EmptyState, ErrorState, Field, InlineError, Modal, PageHeader, Segmented, Select, SkeletonCards, Textarea, Toggle } from '../components/ui.jsx';
import { GameTag, PlatformIcon } from '../components/gaming.jsx';
import { useConfirm, useToast } from '../components/feedback.jsx';

export default function GameProfilesPage() {
  const { userId } = useApp();
  const toast = useToast();
  const confirm = useConfirm();
  const games = useAsync(() => api.getGames(), []);
  const mine = useAsync(() => api.getMyGameProfiles(userId), [userId]);
  const [editing, setEditing] = useState(null); // {gp?} or {game}
  const byId = Object.fromEntries((games.data || []).map((g) => [g.id, g]));
  const available = (games.data || []).filter((g) => !mine.data?.some((m) => m.game_id === g.id));

  const remove = (gp) => confirm({
    title: `Remove ${byId[gp.game_id]?.name}?`, body: "Your rank and role for this game are deleted, and you won't show up in its searches.",
    confirmLabel: 'Remove game', danger: true,
    action: async () => { await api.deleteGameProfile(gp.id); toast('Game removed'); mine.reload({ quiet: true }); },
  });

  return (
    <div>
      <PageHeader title="Game Profiles" sub="A separate profile for each game you play. Ranks are self-reported — PartyUp never connects to game accounts or verifies ranks."
        actions={available.length > 0 && <Button variant="primary" icon={LuPlus} onClick={() => setEditing({})}>Add game</Button>} />
      {games.error || mine.error ? <ErrorState error={games.error || mine.error} onRetry={() => { games.reload(); mine.reload(); }} /> :
        !mine.data || !games.data ? <SkeletonCards count={3} h={200} /> : mine.data.length === 0 ? (
          <EmptyState icon={LuGamepad2} title="No games yet" action={<Button variant="primary" icon={LuPlus} onClick={() => setEditing({})}>Add your first game</Button>}>
            Add the games you play so we can match you on rank, roles and modes.
          </EmptyState>
        ) : (
          <div className="card-grid">
            {mine.data.map((gp) => {
              const g = byId[gp.game_id];
              if (!g) return null;
              return (
                <article key={gp.id} className="gp-card editable" style={{ '--gc': g.accent_color }}>
                  <div className="gp-head">
                    <GameTag game={g} />
                    {!gp.is_visible && <Badge title="Hidden from your public profile and search"><LuEyeOff aria-hidden /> Hidden</Badge>}
                  </div>
                  <dl className="gp-facts">
                    {g.ranks.length > 0 && <><dt>Rank</dt><dd>{gp.rank ? <>{gp.rank} <Badge>Self-reported</Badge></> : <span className="muted">Not set</span>}</dd></>}
                    <dt>Main role</dt><dd>{gp.main_role || <span className="muted">Not set</span>}</dd>
                    {gp.secondary_roles.length > 0 && <><dt>Also plays</dt><dd>{gp.secondary_roles.join(', ')}</dd></>}
                    <dt>Experience</dt><dd>{label(EXPERIENCE, gp.experience)}</dd>
                    {gp.platform && <><dt>Platform</dt><dd><PlatformIcon platform={gp.platform} /></dd></>}
                    {gp.preferred_modes.length > 0 && <><dt>Modes</dt><dd>{gp.preferred_modes.join(', ')}</dd></>}
                    {gp.session_length && <><dt>Sessions</dt><dd>{label(SESSION_LENGTHS, gp.session_length)}</dd></>}
                    <dt>Looking for</dt><dd>{label(LOOKING_FOR, gp.looking_for)}</dd>
                    {gp.playstyles.length > 0 && <><dt>Style</dt><dd>{gp.playstyles.map((s) => label(PLAYSTYLES, s)).join(', ')}</dd></>}
                  </dl>
                  {gp.notes && <p className="gp-notes">{gp.notes}</p>}
                  <div className="row gap-s gp-actions">
                    <Button size="sm" icon={LuPencil} onClick={() => setEditing({ gp })}>Edit</Button>
                    <Button size="sm" variant="danger-ghost" icon={LuTrash2} onClick={() => remove(gp)}>Remove</Button>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      {editing && (
        <GameProfileEditor games={games.data} available={available} gp={editing.gp} userId={userId}
          onClose={() => setEditing(null)} onSaved={() => { setEditing(null); mine.reload({ quiet: true }); toast(editing.gp ? 'Game profile saved' : 'Game added'); }} />
      )}
    </div>
  );
}

function GameProfileEditor({ games, available, gp, userId, onClose, onSaved }) {
  const [gameId, setGameId] = useState(gp?.game_id || available[0]?.id);
  const g = games.find((x) => x.id === gameId);
  const [v, setV] = useState(() => ({
    platform: gp?.platform ?? null, rank: gp?.rank ?? null, experience: gp?.experience ?? 'casual', main_role: gp?.main_role ?? null,
    secondary_roles: gp?.secondary_roles ?? [], preferred_modes: gp?.preferred_modes ?? [], session_length: gp?.session_length ?? null,
    playstyles: gp?.playstyles ?? [], looking_for: gp?.looking_for ?? 'both', notes: gp?.notes ?? '', is_visible: gp?.is_visible ?? true,
  }));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const set = (k) => (val) => setV((s) => ({ ...s, [k]: val }));
  const changeGame = (id) => { setGameId(id); setV((s) => ({ ...s, rank: null, main_role: null, secondary_roles: [], preferred_modes: [], platform: null })); };

  const save = async (e) => {
    e?.preventDefault(); setBusy(true); setErr(null);
    const fields = { ...v, secondary_roles: v.secondary_roles.filter((r) => r !== v.main_role) };
    try {
      if (gp) await api.updateGameProfile(gp.id, fields);
      else await api.createGameProfile({ user_id: userId, game_id: gameId, ...fields });
      onSaved();
    } catch (ex) { setErr(ex); setBusy(false); }
  };
  const opts = (arr) => arr.map((x) => ({ value: x, label: x }));

  return (
    <Modal open onClose={onClose} title={gp ? `Edit ${g?.name}` : 'Add a game'} size="lg"
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" loading={busy} onClick={save}>{gp ? 'Save changes' : 'Add game'}</Button></>}>
      <form onSubmit={save} className="stack">
        {!gp && <Field label="Game" htmlFor="ge-game"><Select id="ge-game" options={gameOptions(available)} value={gameId} onChange={changeGame} /></Field>}
        {g && (
          <>
            <div className="field-pair">
              {g.ranks.length > 0 && (
                <Field label="Current rank" htmlFor="ge-rank" optional hint="Self-reported. Never shown as verified.">
                  <Select id="ge-rank" options={opts(g.ranks)} value={v.rank} onChange={set('rank')} placeholder="Not set" />
                </Field>
              )}
              <Field label="Platform" htmlFor="ge-plat" optional>
                <Select id="ge-plat" options={PLATFORMS.filter((p) => g.platforms.includes(p.value))} value={v.platform} onChange={set('platform')} placeholder="Not set" />
              </Field>
            </div>
            <Field label="Competitive experience"><Segmented ariaLabel="Experience" options={EXPERIENCE} value={v.experience} onChange={set('experience')} /></Field>
            {g.roles.length > 0 && (
              <>
                <Field label="Main role" htmlFor="ge-main" optional><Select id="ge-main" options={opts(g.roles)} value={v.main_role} onChange={set('main_role')} placeholder="Not set" /></Field>
                <Field label="Secondary roles" optional hint="Up to 4.">
                  <ChipSelect options={opts(g.roles.filter((r) => r !== v.main_role))} value={v.secondary_roles} onChange={set('secondary_roles')} max={4} ariaLabel="Secondary roles" />
                </Field>
              </>
            )}
            <Field label="Preferred modes" optional><ChipSelect options={opts(g.modes)} value={v.preferred_modes} onChange={set('preferred_modes')} max={8} ariaLabel="Modes" /></Field>
            <div className="field-pair">
              <Field label="Typical session" htmlFor="ge-sess" optional><Select id="ge-sess" options={SESSION_LENGTHS} value={v.session_length} onChange={set('session_length')} placeholder="Not set" /></Field>
              <Field label="Looking for"><Segmented ariaLabel="Looking for" options={LOOKING_FOR} value={v.looking_for} onChange={set('looking_for')} /></Field>
            </div>
            <Field label={`Playstyle in ${g.name}`} optional hint="Up to 6."><ChipSelect options={PLAYSTYLES} value={v.playstyles} onChange={set('playstyles')} max={6} ariaLabel="Playstyle" /></Field>
            <Field label="Notes" htmlFor="ge-notes" optional hint={`${v.notes.length}/280`}>
              <Textarea id="ge-notes" rows={2} maxLength={280} value={v.notes} onChange={(e) => set('notes')(e.target.value)} placeholder="Agents/heroes you play, what you're working on" />
            </Field>
            <Toggle checked={v.is_visible} onChange={set('is_visible')} label="Show on my profile and in search" hint="Turn off to keep this game private." />
          </>
        )}
        <InlineError error={err} />
      </form>
    </Modal>
  );
}
