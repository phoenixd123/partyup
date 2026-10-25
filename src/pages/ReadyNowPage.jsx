import { useEffect, useState } from 'react';
import { LuRadio, LuX } from 'react-icons/lu';
import * as api from '../lib/api.js';
import { useAsync, useInterval } from '../hooks/useAsync.js';
import { useApp } from '../context/AppContext.jsx';
import { gameOptions } from '../lib/constants.js';
import { Button, EmptyState, ErrorState, PageHeader, Select, SkeletonCards } from '../components/ui.jsx';
import { useToast } from '../components/feedback.jsx';
import { BeaconCard, BeaconDialog, timeLeft } from '../components/Progress.jsx';

export default function ReadyNowPage() {
  const { profile, refreshProfile, onNotify } = useApp();
  const toast = useToast();
  const games = useAsync(() => api.getGames(), []);
  const [game, setGame] = useState(null);
  const [lighting, setLighting] = useState(false);
  const res = useAsync(() => api.listBeacons(game), [game]);
  useEffect(() => onNotify(() => res.reload({ quiet: true })), [onNotify, res.reload]); // eslint-disable-line
  useInterval(() => res.reload({ quiet: true }), 20_000, true);
  const live = profile.beacon_until && new Date(profile.beacon_until) > new Date();
  const stop = async () => { try { await api.clearBeacon(); await refreshProfile(); toast('Beacon off'); res.reload({ quiet: true }); } catch (e) { toast(e, 'error'); } };
  return (
    <div>
      <PageHeader title="Ready Now" icon={LuRadio} sub="People who are free to play right now. Light your beacon and friends who play that game get a ping."
        actions={live
          ? <Button icon={LuX} onClick={stop}>Stop beacon · {timeLeft(profile.beacon_until)}</Button>
          : <Button variant="primary" icon={LuRadio} onClick={() => setLighting(true)}>I'm ready to play</Button>} />
      <div className="toolbar"><div className="toolbar-filters">
        <Select aria-label="Game" options={gameOptions(games.data)} value={game} onChange={setGame} placeholder="All games" />
      </div></div>
      {res.error ? <ErrorState error={res.error} onRetry={res.reload} /> : !res.data ? <SkeletonCards count={6} h={150} /> : res.data.length === 0 ? (
        <EmptyState icon={LuRadio} title="Nobody's live right now" action={<Button variant="primary" icon={LuRadio} onClick={() => setLighting(true)}>Go live first</Button>}>
          Beacons last up to 4 hours. Check back at prime time, or light yours so others can find you.
        </EmptyState>
      ) : <div className="card-grid">{res.data.map((b) => <BeaconCard key={b.id} b={b} />)}</div>}
      {lighting && <BeaconDialog onClose={(ok) => { setLighting(false); if (ok) { refreshProfile(); res.reload({ quiet: true }); } }} />}
    </div>
  );
}
