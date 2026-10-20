import { useEffect, useMemo, useState } from 'react';
import { LuSlidersHorizontal, LuSearchX, LuX, LuZap } from 'react-icons/lu';
import * as api from '../lib/api.js';
import { useAsync, useDebounced } from '../hooks/useAsync.js';
import { REGIONS, LANGUAGES, PLATFORMS, PLAYSTYLES, regionLabel, languageLabel, platformLabel, label, gameOptions } from '../lib/constants.js';
import { navigate } from '../lib/router.jsx';
import { Button, EmptyState, ErrorState, Field, Input, PageHeader, Select, SkeletonCards, Toggle, cx, InlineError } from '../components/ui.jsx';
import PlayerCard from '../components/PlayerCard.jsx';
import { MatchingWeights } from '../components/gaming.jsx';

const EMPTY = { game: null, region: null, platform: null, language: null, minRank: null, maxRank: null, role: null,
  mic: null, playstyle: null, availability: 'any', online: false, search: '' };
const MIC_FILTERS = [
  { value: 'has_mic', label: 'Uses a mic' }, { value: 'always', label: 'Always on mic' }, { value: 'text_only', label: 'Text chat only' },
];
const AVAIL = [{ value: 'any', label: 'Any time' }, { value: 'overlap', label: 'Overlaps my schedule' }, { value: 'now', label: 'Usually plays now' }];
const SORTS = [{ value: 'compatibility', label: 'Best match' }, { value: 'activity', label: 'Most active' }, { value: 'recent', label: 'Recently online' }];
const PAGE = 12;
const STORE = 'partyup.playerFilters';

export default function FindPlayersPage({ query }) {
  const games = useAsync(() => api.getGames(), []);
  const [filters, setFilters] = useState(() => {
    let saved = {};
    try { saved = JSON.parse(sessionStorage.getItem(STORE) || '{}'); } catch { /* ignore */ }
    return { ...EMPTY, ...saved, ...(query.q ? { search: query.q } : {}), ...(query.game ? { game: query.game } : {}) };
  });
  const [sort, setSort] = useState('compatibility');
  const [panel, setPanel] = useState(false);
  const set = (k) => (v) => setFilters((f) => ({ ...f, [k]: v, ...(k === 'game' ? { minRank: null, maxRank: null, role: null } : {}) }));
  useEffect(() => { try { sessionStorage.setItem(STORE, JSON.stringify(filters)); } catch { /* ignore */ } }, [filters]);
  useEffect(() => { if (query.q !== undefined) setFilters((f) => ({ ...f, search: query.q })); }, [query.q]);

  const game = games.data?.find((g) => g.id === filters.game);
  const search = useDebounced(filters.search, 350);
  const args = useMemo(() => ({
    p_game: filters.game, p_region: filters.region, p_platform: filters.platform, p_language: filters.language,
    p_min_rank: filters.minRank === null ? null : Number(filters.minRank), p_max_rank: filters.maxRank === null ? null : Number(filters.maxRank),
    p_role: filters.role, p_mic: filters.mic, p_playstyle: filters.playstyle, p_availability: filters.availability,
    p_online_only: filters.online, p_search: search || null, p_sort: sort,
  }), [filters, search, sort]);

  const [pages, setPages] = useState(1);
  useEffect(() => setPages(1), [args]);
  const first = useAsync(() => api.findPlayers({ ...args, p_limit: PAGE, p_offset: 0 }), [args]);
  const [more, setMore] = useState([]);
  const [moreBusy, setMoreBusy] = useState(false);
  const [moreErr, setMoreErr] = useState(null);
  useEffect(() => setMore([]), [first.data]);
  const loadMore = async () => {
    setMoreBusy(true); setMoreErr(null);
    try { const r = await api.findPlayers({ ...args, p_limit: PAGE, p_offset: pages * PAGE }); setMore((m) => [...m, ...r.players]); setPages((p) => p + 1); }
    catch (e) { setMoreErr(e); } finally { setMoreBusy(false); }
  };
  const players = [...(first.data?.players || []), ...more];
  const total = first.data?.total ?? 0;

  const active = [
    filters.game && ['game', `Game: ${game?.name || filters.game}`],
    filters.region && ['region', regionLabel(filters.region)],
    filters.platform && ['platform', platformLabel(filters.platform)],
    filters.language && ['language', languageLabel(filters.language)],
    (filters.minRank !== null || filters.maxRank !== null) && ['rank', 'Rank range'],
    filters.role && ['role', `Role: ${filters.role}`],
    filters.mic && ['mic', label(MIC_FILTERS, filters.mic)],
    filters.playstyle && ['playstyle', label(PLAYSTYLES, filters.playstyle)],
    filters.availability !== 'any' && ['availability', label(AVAIL, filters.availability)],
    filters.online && ['online', 'Online now'],
    filters.search && ['search', `“${filters.search}”`],
  ].filter(Boolean);
  const clear = (key) => setFilters((f) => {
    if (key === 'rank') return { ...f, minRank: null, maxRank: null };
    if (key === 'availability') return { ...f, availability: 'any' };
    if (key === 'online') return { ...f, online: false };
    if (key === 'search') return { ...f, search: '' };
    if (key === 'game') return { ...f, game: null, minRank: null, maxRank: null, role: null };
    return { ...f, [key]: null };
  });

  const rankOpts = game?.ranks.map((r, i) => ({ value: String(i), label: r })) || [];

  return (
    <div>
      <PageHeader title="Find Players" sub={first.data ? `${total} ${total === 1 ? 'player matches' : 'players match'} your filters` : 'Filter by game, rank, schedule and more'}
        actions={<>
          <Button icon={LuSlidersHorizontal} className="filters-toggle" onClick={() => setPanel(true)}>Filters{active.length ? ` (${active.length})` : ''}</Button>
          <Select aria-label="Sort players" options={SORTS} value={sort} onChange={(v) => setSort(v || 'compatibility')} />
          <Button variant="primary" icon={LuZap} onClick={() => navigate(`/match${filters.game ? `?game=${filters.game}` : ''}`)}>Quick Match</Button>
        </>} />

      <div className="finder">
        <aside className={cx('filters', panel && 'open')} aria-label="Filters">
          <div className="filters-head">
            <strong>Filters</strong>
            <span className="row gap-s">
              {active.length > 0 && <Button size="sm" variant="link" onClick={() => setFilters(EMPTY)}>Reset</Button>}
              <button type="button" className="icon-btn filters-x" aria-label="Close filters" onClick={() => setPanel(false)}><LuX /></button>
            </span>
          </div>
          <Field label="Username" htmlFor="f-search"><Input id="f-search" type="search" placeholder="Search" value={filters.search} onChange={(e) => set('search')(e.target.value)} /></Field>
          <Field label="Game" htmlFor="f-game"><Select id="f-game" options={gameOptions(games.data)} value={filters.game} onChange={set('game')} placeholder="Any game" /></Field>
          {game && game.ranks.length > 0 && (
            <div className="field-pair">
              <Field label="Min rank" htmlFor="f-min"><Select id="f-min" options={rankOpts} value={filters.minRank} onChange={set('minRank')} placeholder="Any" /></Field>
              <Field label="Max rank" htmlFor="f-max"><Select id="f-max" options={rankOpts} value={filters.maxRank} onChange={set('maxRank')} placeholder="Any" /></Field>
            </div>
          )}
          {game && <Field label="Role" htmlFor="f-role"><Select id="f-role" options={game.roles.map((r) => ({ value: r, label: r }))} value={filters.role} onChange={set('role')} placeholder="Any role" /></Field>}
          {!game && <p className="muted small">Pick a game to filter by rank and role.</p>}
          <Field label="Region" htmlFor="f-region"><Select id="f-region" options={REGIONS} value={filters.region} onChange={set('region')} placeholder="Any region" /></Field>
          <Field label="Platform" htmlFor="f-plat"><Select id="f-plat" options={PLATFORMS} value={filters.platform} onChange={set('platform')} placeholder="Any platform" /></Field>
          <Field label="Language" htmlFor="f-lang"><Select id="f-lang" options={LANGUAGES} value={filters.language} onChange={set('language')} placeholder="Any language" /></Field>
          <Field label="Microphone" htmlFor="f-mic"><Select id="f-mic" options={MIC_FILTERS} value={filters.mic} onChange={set('mic')} placeholder="Any" /></Field>
          <Field label="Playstyle" htmlFor="f-style"><Select id="f-style" options={PLAYSTYLES} value={filters.playstyle} onChange={set('playstyle')} placeholder="Any playstyle" /></Field>
          <Field label="Availability" htmlFor="f-avail"><Select id="f-avail" options={AVAIL} value={filters.availability} onChange={(v) => set('availability')(v || 'any')} /></Field>
          <Toggle checked={filters.online} onChange={set('online')} label="Online now" />
          <Button variant="primary" className="filters-done" onClick={() => setPanel(false)}>Show {total} players</Button>
          <MatchingWeights />
        </aside>
        {panel && <div className="drawer-scrim filters-scrim" onClick={() => setPanel(false)} aria-hidden />}

        <section className="results" aria-live="polite" aria-busy={first.loading}>
          {active.length > 0 && (
            <div className="active-filters">
              {active.map(([k, l]) => (
                <button key={k} type="button" className="filter-pill" onClick={() => clear(k)} aria-label={`Remove filter ${l}`}>{l}<LuX aria-hidden /></button>
              ))}
            </div>
          )}
          {first.error ? <ErrorState error={first.error} onRetry={first.reload} /> :
            first.loading && !first.data ? <SkeletonCards count={6} /> :
            players.length === 0 ? (
              <EmptyState icon={LuSearchX} title="No players match these filters">
                {active.length > 0 ? (
                  <>
                    <p>Try removing one of these — each one narrows the pool:</p>
                    <div className="active-filters center">
                      {active.map(([k, l]) => <button key={k} type="button" className="filter-pill" onClick={() => clear(k)}>Remove {l}<LuX aria-hidden /></button>)}
                    </div>
                  </>
                ) : <p>No other players have finished setting up a profile yet. Create a public party so new players can find you.</p>}
              </EmptyState>
            ) : (
              <>
                <div className={cx('card-grid', first.loading && 'is-stale')}>
                  {players.map((p) => <PlayerCard key={p.id} player={p} gameId={filters.game} onChanged={() => first.reload({ quiet: true })} />)}
                </div>
                <div className="load-more">
                  <span className="muted small">Showing {players.length} of {total}</span>
                  {players.length < total && <Button onClick={loadMore} loading={moreBusy}>Load more</Button>}
                </div>
                <InlineError error={moreErr} />
              </>
            )}
        </section>
      </div>
    </div>
  );
}
