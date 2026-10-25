import { useState } from 'react';
import { LuCrown, LuMedal } from 'react-icons/lu';
import * as api from '../lib/api.js';
import { useAsync } from '../hooks/useAsync.js';
import { useApp } from '../context/AppContext.jsx';
import { Link } from '../lib/router.jsx';
import { EmptyState, ErrorState, PageHeader, Segmented, SkeletonCards, cx } from '../components/ui.jsx';
import { Avatar, Name } from '../components/gaming.jsx';
import { LevelBadge, ProgressPanel } from '../components/Progress.jsx';
import { CountUp } from '../components/Motion.jsx';

export default function LeaderboardPage() {
  const { userId } = useApp();
  const [scope, setScope] = useState('global');
  const res = useAsync(() => api.leaderboard(scope), [scope]);
  const list = res.data || [];
  const podium = list.slice(0, 3);
  return (
    <div className="lb">
      <PageHeader title="Leaderboard" icon={LuCrown} sub="Top players by XP — earned by actually playing together, not grinding."
        actions={<Segmented ariaLabel="Scope" value={scope} onChange={setScope} options={[{ value: 'global', label: 'Everyone' }, { value: 'friends', label: 'Friends' }]} />} />
      <div className="lb-grid">
        <div>
          {res.error ? <ErrorState error={res.error} onRetry={res.reload} /> : !res.data ? <SkeletonCards count={3} h={120} /> : list.length === 0 ? (
            <EmptyState icon={LuMedal} title="No one on the board yet">Join a party, chat or hop in a call to earn your first XP.</EmptyState>
          ) : (
            <>
              <div className="podium">
                {[1, 0, 2].map((i) => podium[i] && (
                  <Link key={podium[i].id} to={`/players/${podium[i].id}`} className={cx('podium-spot', `p${i + 1}`)} style={{ '--i': i }}>
                    {i === 0 && <LuCrown className="podium-crown" aria-hidden />}
                    <Avatar user={podium[i]} size={i === 0 ? 72 : 58} />
                    <Name user={podium[i]} className="podium-name" />
                    <LevelBadge level={podium[i].level} />
                    <span className="podium-xp"><CountUp value={podium[i].xp} /> XP</span>
                    <span className="podium-block">{i + 1}</span>
                  </Link>
                ))}
              </div>
              <ol className="lb-list">
                {list.slice(3).map((u) => (
                  <li key={u.id} className={cx(u.id === userId && 'me')}>
                    <span className="lb-rank">{u.rank}</span>
                    <Avatar user={u} size={32} />
                    <Link to={`/players/${u.id}`} className="grow mini-link"><Name user={u} /></Link>
                    <LevelBadge level={u.level} />
                    <span className="lb-xp">{u.xp.toLocaleString()} XP</span>
                  </li>
                ))}
              </ol>
            </>
          )}
        </div>
        <ProgressPanel />
      </div>
    </div>
  );
}
