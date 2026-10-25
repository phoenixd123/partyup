import { useEffect, useMemo, useState } from 'react';
import { LuTv, LuRadio, LuFlame, LuEye, LuExternalLink, LuX, LuRefreshCw, LuPlay } from 'react-icons/lu';
import * as api from '../lib/api.js';
import { useAsync, useInterval } from '../hooks/useAsync.js';
import { useApp } from '../context/AppContext.jsx';
import { navigate } from '../lib/router.jsx';
import { gameOptions } from '../lib/constants.js';
import { timeAgo } from '../lib/format.js';
import { Button, EmptyState, ErrorState, IconButton, PageHeader, Segmented, Select, SkeletonCards, cx } from '../components/ui.jsx';
import GameIcon from '../components/GameIcon.jsx';

const REFRESH_MS = 120_000;
const compact = (n) => (n >= 1e6 ? `${(n / 1e6).toFixed(1).replace(/\.0$/, '')}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1).replace(/\.0$/, '')}K` : String(n || 0));
const host = () => window.location.hostname || 'localhost';

export function embedUrl(item) {
  if (item.platform === 'twitch' && item.type === 'live') return `https://player.twitch.tv/?channel=${encodeURIComponent(item.channel)}&parent=${host()}&autoplay=true&muted=false`;
  if (item.platform === 'twitch') return `https://clips.twitch.tv/embed?clip=${encodeURIComponent(item.id)}&parent=${host()}&autoplay=true`;
  return `https://www.youtube-nocookie.com/embed/${encodeURIComponent(item.id)}?autoplay=1&rel=0&modestbranding=1`;
}
export function watchUrl(item) {
  if (item.platform === 'twitch' && item.type === 'live') return `https://www.twitch.tv/${item.channel}`;
  if (item.platform === 'twitch') return `https://clips.twitch.tv/${item.id}`;
  return `https://www.youtube.com/watch?v=${item.id}`;
}

function normalize(data) {
  if (!data) return { live: [], top: [] };
  const live = [
    ...(data.twitch_live || []).map((s) => ({ ...s, key: `tw-${s.id}`, platform: 'twitch', type: 'live', author: s.name, count: s.viewers })),
    ...(data.youtube_live || []).map((v) => ({ ...v, key: `yt-${v.id}`, platform: 'youtube', type: 'live', author: v.channel, count: v.viewers })),
  ].sort((a, b) => b.count - a.count);
  const top = [
    ...(data.twitch_clips || []).map((c) => ({ ...c, key: `twc-${c.id}`, platform: 'twitch', type: 'clip', author: c.channel, count: c.views })),
    ...(data.youtube_top || []).map((v) => ({ ...v, key: `ytv-${v.id}`, platform: 'youtube', type: 'video', author: v.channel, count: v.views })),
  ].sort((a, b) => b.count - a.count);
  return { live, top };
}

function MediaCard({ item, active, onPlay }) {
  return (
    <button type="button" className={cx('media-card', active && 'active')} onClick={() => onPlay(item)} aria-label={`Play ${item.title}`}>
      <span className="media-thumb">
        {item.thumbnail && <img src={item.thumbnail} alt="" loading="lazy" referrerPolicy="no-referrer" />}
        <span className={cx('plat-tag', item.platform)}>{item.platform === 'twitch' ? 'Twitch' : 'YouTube'}</span>
        {item.type === 'live' ? <span className="live-tag"><span className="rec" />LIVE · {compact(item.count)}</span>
          : <span className="views-tag"><LuEye aria-hidden /> {compact(item.count)}</span>}
        <span className="play-hover"><LuPlay aria-hidden /></span>
      </span>
      <span className="media-meta">
        <strong title={item.title}>{item.title}</strong>
        <small>{item.author}{item.type !== 'live' && (item.created_at || item.published_at) ? ` · ${timeAgo(item.created_at || item.published_at)}` : ''}</small>
      </span>
    </button>
  );
}

export function Theater({ item, onClose }) {
  if (!item) return null;
  return (
    <section className="theater" aria-label="Now playing">
      <div className="theater-frame">
        <iframe key={item.key} src={embedUrl(item)} title={item.title} allowFullScreen referrerPolicy="strict-origin-when-cross-origin"
          allow="autoplay; encrypted-media; picture-in-picture; fullscreen; clipboard-write" />
      </div>
      <div className="theater-bar">
        <div className="grow" style={{ minWidth: 0 }}>
          <strong className="ellipsis">{item.title}</strong>
          <small className="muted">{item.author} · {item.platform === 'twitch' ? 'Twitch' : 'YouTube'}{item.type === 'live' ? ` · ${compact(item.count)} watching` : ''}</small>
        </div>
        <a className="btn btn-ghost btn-sm" href={watchUrl(item)} target="_blank" rel="noreferrer"><LuExternalLink aria-hidden /> Open</a>
        <IconButton icon={LuX} label="Close player" onClick={onClose} />
      </div>
    </section>
  );
}

export default function WatchPage({ params }) {
  const { userId } = useApp();
  const games = useAsync(() => api.getGames(), []);
  const mine = useAsync(() => api.getMyGameProfiles(userId), [userId]);
  const game = params.game || mine.data?.[0]?.game_id || 'valorant';
  const res = useAsync(() => api.getMedia(game), [game]);
  useInterval(() => res.reload({ quiet: true }), REFRESH_MS, true);
  const [tab, setTab] = useState('live');
  const [platform, setPlatform] = useState('all');
  const [playing, setPlaying] = useState(null);
  useEffect(() => { setPlaying(null); }, [game]);
  const [, tick] = useState(0);
  useInterval(() => tick((t) => t + 1), 30_000, true); // keeps "updated x ago" fresh

  const g = games.data?.find((x) => x.id === game);
  const { live, top } = useMemo(() => normalize(res.data), [res.data]);
  const list = (tab === 'live' ? live : top).filter((i) => platform === 'all' || i.platform === platform);
  const quick = [...new Set([...(mine.data || []).map((x) => x.game_id), 'valorant', 'fortnite', 'league-of-legends', 'minecraft', 'cs2'])].slice(0, 8);
  const configured = res.data?.configured;
  const none = configured && !configured.twitch && !configured.youtube;

  const play = (item) => { setPlaying(item); window.scrollTo({ top: 0, behavior: 'smooth' }); };
  return (
    <div className="watch">
      <PageHeader title="Watch" icon={LuTv} sub="Live streams and the week's top clips and videos for every game. Updates on its own."
        actions={<>
          <Select aria-label="Game" options={gameOptions(games.data)} value={game} onChange={(v) => v && navigate(`/watch/${v}`)} />
          <IconButton icon={LuRefreshCw} label="Refresh now" onClick={() => res.reload()} className={cx(res.loading && 'spin')} />
        </>} />
      <div className="watch-games" role="list">
        {quick.map((id) => {
          const gg = games.data?.find((x) => x.id === id);
          if (!gg) return null;
          return (
            <button key={id} type="button" role="listitem" className={cx('watch-game', id === game && 'on')} onClick={() => navigate(`/watch/${id}`)}>
              <GameIcon game={gg} size={26} label={false} /><span>{gg.short_name || gg.name}</span>
            </button>
          );
        })}
      </div>

      <Theater item={playing} onClose={() => setPlaying(null)} />

      <div className="toolbar">
        <Segmented ariaLabel="Section" value={tab} onChange={setTab} options={[
          { value: 'live', label: <><LuRadio aria-hidden /> Live now</>, count: live.length },
          { value: 'top', label: <><LuFlame aria-hidden /> Top this week</>, count: top.length },
        ]} />
        <Segmented ariaLabel="Platform" value={platform} onChange={setPlatform} options={[
          { value: 'all', label: 'All' }, { value: 'twitch', label: 'Twitch' }, { value: 'youtube', label: 'YouTube' },
        ]} />
        {res.data?.updated && <span className="muted small watch-updated"><span className="live-dot" aria-hidden /> Updated {timeAgo(res.data.updated)}</span>}
      </div>

      {res.error ? <ErrorState error={res.error} onRetry={res.reload} title="Couldn't load streams" />
        : !res.data ? <SkeletonCards count={8} h={210} />
        : none ? (
          <EmptyState icon={LuTv} title="Streams aren't switched on yet">
            The PartyUp team still needs to connect Twitch and YouTube. Check back soon.
          </EmptyState>
        ) : list.length === 0 ? (
          <EmptyState icon={tab === 'live' ? LuRadio : LuFlame} title={tab === 'live' ? `Nobody is live in ${g?.name || 'this game'} right now` : 'No top videos found this week'}>
            {tab === 'live' ? 'Try another platform, or check the top videos.' : 'Try another platform or game.'}
          </EmptyState>
        ) : (
          <div className="media-grid">
            {list.map((item) => <MediaCard key={item.key} item={item} active={playing?.key === item.key} onPlay={play} />)}
          </div>
        )}
      {configured && (!configured.twitch || !configured.youtube) && !none && (
        <p className="muted small" style={{ marginTop: 12 }}>{!configured.twitch ? 'Twitch' : 'YouTube'} isn't connected yet, so only {configured.twitch ? 'Twitch' : 'YouTube'} results are shown.</p>
      )}
    </div>
  );
}
