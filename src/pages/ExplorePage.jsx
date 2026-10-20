import { useState } from 'react';
import { LuCompass, LuPlus } from 'react-icons/lu';
import * as api from '../lib/api.js';
import { useAsync, useDebounced } from '../hooks/useAsync.js';
import { useApp } from '../context/AppContext.jsx';
import { navigate } from '../lib/router.jsx';
import { gameOptions } from '../lib/constants.js';
import { Button, DemoBadge, EmptyState, ErrorState, Input, PageHeader, Select, SkeletonCards, InlineError } from '../components/ui.jsx';
import { GameTag } from '../components/gaming.jsx';
import { useToast } from '../components/feedback.jsx';
import { CommunityIcon, CreateCommunityDialog } from '../components/CommunityDialogs.jsx';

export default function ExplorePage() {
  const { refreshCounts } = useApp();
  const toast = useToast();
  const games = useAsync(() => api.getGames(), []);
  const [q, setQ] = useState('');
  const [game, setGame] = useState(null);
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState(null);
  const [extra, setExtra] = useState([]);
  const [moreErr, setMoreErr] = useState(null);
  const search = useDebounced(q, 300);
  const res = useAsync(async () => { setExtra([]); return api.exploreCommunities(search, game); }, [search, game]);
  const items = [...(res.data?.communities || []), ...extra];
  const join = async (c) => {
    setBusy(c.id);
    try { await api.joinCommunity(c.id); refreshCounts(); toast(`Joined ${c.name}`); navigate(`/c/${c.id}`); }
    catch (e) { toast(e, 'error'); setBusy(null); }
  };
  const more = async () => {
    setMoreErr(null);
    try { const r = await api.exploreCommunities(search, game, items.length); setExtra((x) => [...x, ...r.communities]); } catch (e) { setMoreErr(e); }
  };
  return (
    <div>
      <PageHeader title="Explore communities" sub="Public groups for your games: LFG channels, scrims, and regulars."
        actions={<Button variant="primary" icon={LuPlus} onClick={() => setCreating(true)}>Create community</Button>} />
      <div className="toolbar">
        <div className="toolbar-filters">
          <Input type="search" placeholder="Search communities" aria-label="Search communities" value={q} onChange={(e) => setQ(e.target.value)} />
          <Select aria-label="Game" options={gameOptions(games.data)} value={game} onChange={setGame} placeholder="All games" />
        </div>
      </div>
      {res.error ? <ErrorState error={res.error} onRetry={res.reload} /> : res.loading && !res.data ? <SkeletonCards count={6} h={150} /> : items.length === 0 ? (
        <EmptyState icon={LuCompass} title="No communities found" action={<Button variant="primary" icon={LuPlus} onClick={() => setCreating(true)}>Create one</Button>}>
          {q || game ? 'Try a different search or game.' : 'No public communities yet. Start the first one.'}
        </EmptyState>
      ) : (
        <>
          <div className="card-grid">
            {items.map((c) => (
              <article key={c.id} className="comm-card">
                <div className="top">
                  <span className="comm-badge"><CommunityIcon community={c} /></span>
                  <div className="grow" style={{ minWidth: 0 }}><h3>{c.name}</h3>{c.game && <GameTag game={c.game} compact />} {c.is_demo && <DemoBadge />}</div>
                </div>
                <p>{c.description || 'No description.'}</p>
                <div className="foot">
                  <span><span className="dot-on" />{c.online_count} online <span className="dot-off" style={{ marginLeft: 8 }} />{c.member_count} members</span>
                  {c.my_role ? <Button size="sm" onClick={() => navigate(`/c/${c.id}`)}>Open</Button>
                    : <Button size="sm" variant="primary" loading={busy === c.id} onClick={() => join(c)}>Join</Button>}
                </div>
              </article>
            ))}
          </div>
          <div className="load-more">
            <span className="muted small">Showing {items.length} of {res.data.total}</span>
            {items.length < res.data.total && <Button onClick={more}>Load more</Button>}
          </div>
          <InlineError error={moreErr} />
        </>
      )}
      {creating && <CreateCommunityDialog onClose={() => setCreating(false)} />}
    </div>
  );
}
