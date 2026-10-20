import { useEffect, useState } from 'react';
import { LuZap, LuGamepad2, LuLightbulb, LuPlus, LuSearch } from 'react-icons/lu';
import * as api from '../lib/api.js';
import { useAsync } from '../hooks/useAsync.js';
import { useApp } from '../context/AppContext.jsx';
import { navigate } from '../lib/router.jsx';
import { Button, EmptyState, ErrorState, PageHeader, Panel, Select, SkeletonCards } from '../components/ui.jsx';
import PlayerCard from '../components/PlayerCard.jsx';
import PartyCard from '../components/PartyCard.jsx';

export default function QuickMatchPage({ query }) {
  const { userId } = useApp();
  const games = useAsync(() => api.getGames(), []);
  const mine = useAsync(() => api.getMyGameProfiles(userId), [userId]);
  const [game, setGame] = useState(query.game || null);
  useEffect(() => { if (!game && mine.data?.length) setGame(mine.data[0].game_id); }, [mine.data, game]);
  const res = useAsync(() => api.quickMatch(game), [game], { enabled: !!game });

  if (mine.data && mine.data.length === 0) {
    return (
      <div>
        <PageHeader title="Quick Match" />
        <EmptyState icon={LuGamepad2} title="Add a game first" action={<Button variant="primary" onClick={() => navigate('/games')}>Add a game profile</Button>}>
          Quick Match uses your game profile — rank, role and platform — to find teammates and open parties.
        </EmptyState>
      </div>
    );
  }

  const myGames = (mine.data || []).map((g) => ({ value: g.game_id, label: games.data?.find((x) => x.id === g.game_id)?.name || g.game_id }));
  const r = res.data;
  const nothing = r && r.players.length === 0 && r.parties.length === 0;

  return (
    <div>
      <PageHeader title="Quick Match" sub="The best fits for one game right now, using your profile. Only players scoring 60+ are shown."
        actions={<>
          <Select aria-label="Game" options={myGames} value={game} onChange={(v) => v && setGame(v)} />
          <Button icon={LuZap} onClick={() => res.reload()} loading={res.loading}>Run again</Button>
        </>} />

      {res.error ? <ErrorState error={res.error} onRetry={res.reload} /> : !r || (res.loading && !r) ? <SkeletonCards count={3} /> : (
        <>
          {nothing && (
            <EmptyState icon={LuSearch} title={`No strong ${r.game_name} matches yet`}
              action={<span className="row gap-s wrap center">
                <Button variant="primary" icon={LuPlus} onClick={() => navigate('/parties/new')}>Create a public party</Button>
                <Button onClick={() => navigate(`/players?game=${r.game_id}`)}>Browse all {r.game_name} players</Button>
              </span>}>
              We don't show filler results. Here's what's limiting your matches:
            </EmptyState>
          )}
          {(r.tips.length > 0 || nothing) && (
            <Panel title="Why you might see fewer matches" className="tips-panel">
              {r.diagnostics?.length > 0 && (
                <ol className="funnel" aria-label="Player pool">
                  {r.diagnostics.map((d) => (
                    <li key={d.key}><span className="funnel-n">{d.count}</span><span>{d.label}</span></li>
                  ))}
                </ol>
              )}
              <ul className="tips">{r.tips.map((t) => <li key={t}><LuLightbulb aria-hidden />{t}</li>)}</ul>
            </Panel>
          )}
          {r.players.length > 0 && (
            <Panel title={`Teammates for ${r.game_name}`}>
              <div className="card-grid">{r.players.map((p) => <PlayerCard key={p.id} player={p} gameId={r.game_id} onChanged={() => res.reload({ quiet: true })} />)}</div>
            </Panel>
          )}
          {r.parties.length > 0 && (
            <Panel title="Open parties that fit you">
              <div className="card-grid two">{r.parties.map((p) => <PartyCard key={p.id} party={p} />)}</div>
            </Panel>
          )}
        </>
      )}
    </div>
  );
}
