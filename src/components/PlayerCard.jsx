import { LevelBadge } from './Progress.jsx';
import { Name } from './gaming.jsx';
import { LuUserPlus, LuUserCheck, LuClock, LuMessageCircle, LuCalendarClock, LuMapPin } from 'react-icons/lu';
import { Link, navigate } from '../lib/router.jsx';
import { regionLabel, languageLabel } from '../lib/constants.js';
import { Avatar, CompatButton, GameTag, MicLabel, Presence, PlatformIcon } from './gaming.jsx';
import { Button, DemoBadge } from './ui.jsx';
import { usePlayerActions } from './PlayerActions.jsx';

export default function PlayerCard({ player, gameId, onChanged }) {
  const actions = usePlayerActions(player, onChanged);
  const games = gameId ? player.games.filter((g) => g.game_id === gameId) : player.games;
  const others = gameId ? 0 : Math.max(0, player.games.length - 2);
  const shownGames = gameId ? games : games.slice(0, 2);
  const rel = player.relationship;

  return (
    <article className="player-card">
      <div className="pc-top">
        <Link to={`/players/${player.id}`} className="pc-id">
          <Avatar user={player} size={48} status={player.status} />
          <span className="pc-name">
            <strong><Name user={player} /> <LevelBadge level={player.level} />{player.beacon_game && <span className="live-dot" title="Ready to play now" />}</strong>
            <Presence user={player} />
          </span>
        </Link>
        <CompatButton compat={player.compatibility} />
      </div>
      {player.is_demo && <div className="pc-demo"><DemoBadge /><span className="muted small">Sample profile</span></div>}
      <div className="pc-games">
        {shownGames.map((g) => <GameTag key={g.game_id} game={g} rank={g.rank} role={g.main_role} />)}
        {others > 0 && <span className="muted small">+{others} more</span>}
      </div>
      <ul className="pc-meta">
        {player.region && <li><LuMapPin aria-hidden />{regionLabel(player.region)}</li>}
        {player.languages?.length > 0 && <li>{player.languages.slice(0, 3).map(languageLabel).join(', ')}</li>}
        {player.has_schedule && (
          <li className={player.overlap_hours > 0 ? 'overlap' : ''}>
            <LuCalendarClock aria-hidden />{player.overlap_hours > 0 ? `${player.overlap_hours} h/week overlap` : 'No schedule overlap'}
          </li>
        )}
        <li><MicLabel mic={player.mic_preference} /></li>
        {player.platforms?.slice(0, 2).map((p) => <li key={p}><PlatformIcon platform={p} /></li>)}
      </ul>
      <div className="pc-actions">
        {rel === 'friends' ? (
          <Button size="sm" icon={LuMessageCircle} onClick={actions.message} loading={actions.pending === 'message'}>Message</Button>
        ) : rel === 'outgoing' ? (
          <Button size="sm" icon={LuClock} disabled>Requested</Button>
        ) : rel === 'incoming' ? (
          <Button size="sm" variant="primary" icon={LuUserCheck} onClick={actions.accept} loading={actions.pending === 'friend'}>Accept request</Button>
        ) : (
          <Button size="sm" icon={LuUserPlus} onClick={actions.addFriend} loading={actions.pending === 'friend'}>Add friend</Button>
        )}
        <Button size="sm" variant="ghost" onClick={actions.invite}>Invite</Button>
        <Button size="sm" variant="ghost" onClick={() => navigate(`/players/${player.id}`)}>Profile</Button>
      </div>
      {actions.dialogs}
    </article>
  );
}
