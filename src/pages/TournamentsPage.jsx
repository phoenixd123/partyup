import { useState } from 'react';
import { LuTrophy, LuPlus, LuCalendarClock, LuUsers, LuShieldCheck } from 'react-icons/lu';
import * as api from '../lib/api.js';
import { useAsync, useDebounced } from '../hooks/useAsync.js';
import { navigate, Link } from '../lib/router.jsx';
import { gameOptions, regionLabel } from '../lib/constants.js';
import { sessionTime } from '../lib/format.js';
import { Badge, Button, EmptyState, ErrorState, Input, PageHeader, Segmented, Select, SkeletonCards } from '../components/ui.jsx';
import GameIcon from '../components/GameIcon.jsx';

export function prizeLabel(t) {
  if (!t || t.prize_type === 'none') return null;
  if (t.prize_total) {
    try { return new Intl.NumberFormat(undefined, { style: 'currency', currency: t.prize_currency || 'USD', maximumFractionDigits: 2 }).format(t.prize_total); }
    catch { return `${t.prize_total} ${t.prize_currency || ''}`; }
  }
  return t.prize_description || 'Prize';
}

export const STATUS_LABEL = { registration: 'Sign-ups open', in_progress: 'Live', completed: 'Finished', cancelled: 'Cancelled' };
const STATUS_TONE = { registration: 'good', in_progress: 'accent', completed: 'neutral', cancelled: 'bad' };

export function TournamentCard({ t }) {
  const prize = prizeLabel(t);
  return (
    <Link to={`/tournaments/${t.id}`} className="t-card">
      <div className="t-card-top">
        <GameIcon game={t.game} size={40} />
        <div className="grow" style={{ minWidth: 0 }}>
          <h3>{t.title}</h3>
          <span className="muted small">{t.game?.name}</span>
        </div>
        <Badge tone={STATUS_TONE[t.status]}>{STATUS_LABEL[t.status]}</Badge>
      </div>
      <div className="t-card-facts">
        <span><LuCalendarClock aria-hidden /> {sessionTime(t.starts_at)}</span>
        <span><LuUsers aria-hidden /> {t.entrant_count}/{t.max_entrants} {t.team_size > 1 ? `teams of ${t.team_size}` : 'players'}</span>
        {t.region && <span>{regionLabel(t.region)}</span>}
      </div>
      <div className="t-card-foot">
        {prize ? <span className="t-prize"><LuTrophy aria-hidden /> {prize}</span> : <span className="muted small">For glory</span>}
        <span className="muted small">by {t.host?.username || 'deleted account'}</span>
        {t.my_entrant && <Badge tone="good">Entered</Badge>}
        {t.am_host && <Badge>Hosting</Badge>}
      </div>
    </Link>
  );
}

export default function TournamentsPage({ query }) {
  const games = useAsync(() => api.getGames(), []);
  const [scope, setScope] = useState(query?.scope || 'upcoming');
  const [game, setGame] = useState(query?.game || null);
  const [q, setQ] = useState('');
  const search = useDebounced(q, 300);
  const res = useAsync(() => api.listTournaments({ scope, game, search }), [scope, game, search]);
  return (
    <div>
      <PageHeader title="Tournaments" sub="Free-to-enter brackets hosted by players. Prizes are paid by hosts — check their record before you play."
        actions={<Button variant="primary" icon={LuPlus} onClick={() => navigate('/tournaments/new')}>Host a tournament</Button>} />
      <div className="t-safety">
        <LuShieldCheck aria-hidden />
        <p>Never pay to enter a tournament. Entry fees aren't allowed on PartyUp. <Link to="/tournaments/agreement">Read the Tournament Agreement</Link>.</p>
      </div>
      <div className="toolbar">
        <Segmented ariaLabel="Show" value={scope} onChange={setScope} options={[
          { value: 'upcoming', label: 'Upcoming' }, { value: 'live', label: 'Live' }, { value: 'completed', label: 'Finished' }, { value: 'mine', label: 'Mine' },
        ]} />
        <div className="toolbar-filters">
          <Input type="search" placeholder="Search tournaments" aria-label="Search tournaments" value={q} onChange={(e) => setQ(e.target.value)} />
          <Select aria-label="Game" options={gameOptions(games.data)} value={game} onChange={setGame} placeholder="All games" />
        </div>
      </div>
      {res.error ? <ErrorState error={res.error} onRetry={res.reload} /> : res.loading && !res.data ? <SkeletonCards count={6} h={170} /> : res.data.tournaments.length === 0 ? (
        <EmptyState icon={LuTrophy} title={scope === 'mine' ? "You haven't joined any tournaments" : 'No tournaments here yet'}
          action={<Button variant="primary" icon={LuPlus} onClick={() => navigate('/tournaments/new')}>Host one</Button>}>
          {scope === 'upcoming' ? 'Be the first to run a bracket for your game.' : 'Try another tab or game.'}
        </EmptyState>
      ) : (
        <div className="card-grid">{res.data.tournaments.map((t) => <TournamentCard key={t.id} t={t} />)}</div>
      )}
    </div>
  );
}
