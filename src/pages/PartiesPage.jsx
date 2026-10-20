import { useMemo, useState } from 'react';
import { LuPlus, LuUsers, LuHistory } from 'react-icons/lu';
import * as api from '../lib/api.js';
import { useAsync, useDebounced } from '../hooks/useAsync.js';
import { navigate } from '../lib/router.jsx';
import { useApp } from '../context/AppContext.jsx';
import { REGIONS, LANGUAGES, gameOptions } from '../lib/constants.js';
import { Button, EmptyState, ErrorState, Input, PageHeader, Segmented, Select, SkeletonCards, Toggle, InlineError } from '../components/ui.jsx';
import PartyCard from '../components/PartyCard.jsx';

const SORTS = [{ value: 'fit', label: 'Best fit' }, { value: 'newest', label: 'Newest' }, { value: 'soonest', label: 'Starting soonest' }];

export default function PartiesPage({ query }) {
  const { counts } = useApp();
  const [tab, setTab] = useState(query.tab === 'mine' ? 'mine' : query.tab === 'history' ? 'history' : 'browse');
  const games = useAsync(() => api.getGames(), []);
  const [game, setGame] = useState(null);
  const [type, setType] = useState(null);
  const [lang, setLang] = useState(null);
  const [region, setRegion] = useState(null);
  const [full, setFull] = useState(false);
  const [sort, setSort] = useState('fit');
  const [search, setSearch] = useState('');
  const q = useDebounced(search, 300);
  const args = useMemo(() => ({ p_scope: tab, p_game: game, p_play_type: type, p_language: lang, p_region: region, p_include_full: full,
    p_sort: sort, p_search: q || null }), [tab, game, type, lang, region, full, sort, q]);
  const [extra, setExtra] = useState([]);
  const list = useAsync(async () => { setExtra([]); return api.listParties({ ...args, p_limit: 12 }); }, [args]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const parties = [...(list.data?.parties || []), ...extra];
  const more = async () => {
    setBusy(true); setErr(null);
    try { const r = await api.listParties({ ...args, p_limit: 12, p_offset: parties.length }); setExtra((x) => [...x, ...r.parties]); }
    catch (e) { setErr(e); } finally { setBusy(false); }
  };

  return (
    <div>
      <PageHeader title="Parties" sub="Join a squad that needs your role, or start your own."
        actions={<Button variant="primary" icon={LuPlus} onClick={() => navigate('/parties/new')}>Create party</Button>} />
      <div className="toolbar">
        <Segmented ariaLabel="Party list" value={tab} onChange={setTab}
          options={[{ value: 'browse', label: 'Browse' }, { value: 'mine', label: 'My parties', count: counts.party_invites || 0 }, { value: 'history', label: 'Closed' }]} />
        <div className="toolbar-filters">
          <Input type="search" placeholder="Search parties" aria-label="Search parties" value={search} onChange={(e) => setSearch(e.target.value)} />
          <Select aria-label="Game" options={gameOptions(games.data)} value={game} onChange={setGame} placeholder="All games" />
          {tab === 'browse' && <>
            <Select aria-label="Play type" options={[{ value: 'casual', label: 'Casual' }, { value: 'competitive', label: 'Competitive' }]} value={type} onChange={setType} placeholder="Any type" />
            <Select aria-label="Language" options={LANGUAGES} value={lang} onChange={setLang} placeholder="Any language" />
            <Select aria-label="Region" options={REGIONS} value={region} onChange={setRegion} placeholder="Any region" />
            <Select aria-label="Sort" options={SORTS} value={sort} onChange={(v) => setSort(v || 'fit')} />
            <Toggle checked={full} onChange={setFull} label="Show full" />
          </>}
        </div>
      </div>
      {tab === 'mine' && counts.party_invites > 0 && <p className="muted small">You have pending invites — they're listed on your Home page and in notifications.</p>}

      {list.error ? <ErrorState error={list.error} onRetry={list.reload} /> : list.loading && !list.data ? <SkeletonCards count={6} h={210} /> :
        parties.length === 0 ? (
          tab === 'browse' ? (
            <EmptyState icon={LuUsers} title="No open parties match" action={<Button variant="primary" icon={LuPlus} onClick={() => navigate('/parties/new')}>Create a party</Button>}>
              {game || type || lang || region || q ? 'Try clearing a filter, or start a party for others to join.' : 'Nobody has opened a public party yet. Start one and players can request to join.'}
            </EmptyState>
          ) : tab === 'mine' ? (
            <EmptyState icon={LuUsers} title="You're not in any open parties" action={<Button onClick={() => setTab('browse')}>Browse parties</Button>}>Parties you lead or join appear here.</EmptyState>
          ) : <EmptyState icon={LuHistory} title="No closed parties">Parties you were in show up here after they close.</EmptyState>
        ) : (
          <>
            <div className="card-grid">{parties.map((p) => <PartyCard key={p.id} party={p} />)}</div>
            <div className="load-more">
              <span className="muted small">Showing {parties.length} of {list.data.total}</span>
              {parties.length < list.data.total && <Button onClick={more} loading={busy}>Load more</Button>}
            </div>
            <InlineError error={err} />
          </>
        )}
    </div>
  );
}
