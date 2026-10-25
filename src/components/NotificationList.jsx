import { useEffect } from 'react';
import { LuBellOff, LuShieldAlert, LuCheckCheck } from 'react-icons/lu';
import * as api from '../lib/api.js';
import { useAsync } from '../hooks/useAsync.js';
import { useApp } from '../context/AppContext.jsx';
import { navigate } from '../lib/router.jsx';
import { timeAgo } from '../lib/format.js';
import { Avatar } from './gaming.jsx';
import { Button, cx, EmptyState, ErrorState, Skeleton } from './ui.jsx';
import { useToast } from './feedback.jsx';

export function describe(n) {
  const who = n.actor?.username || 'Someone';
  const party = n.data?.party_title ? `“${n.data.party_title}”` : 'a party';
  switch (n.type) {
    case 'friend_request': return { text: <><b>{who}</b> sent you a friend request</>, to: '/friends?tab=requests' };
    case 'friend_accepted': return { text: <><b>{who}</b> accepted your friend request</>, to: n.actor ? `/players/${n.actor.id}` : '/friends' };
    case 'party_invite': return { text: <><b>{who}</b> invited you to {party}</>, to: `/parties/${n.party_id}` };
    case 'party_invite_accepted': return { text: <><b>{who}</b> accepted your invite to {party}</>, to: `/parties/${n.party_id}` };
    case 'join_request': return { text: <><b>{who}</b> asked to join {party}{n.data?.role ? ` as ${n.data.role}` : ''}</>, to: `/parties/${n.party_id}` };
    case 'join_accepted': return { text: <>You're in — <b>{who}</b> accepted you into {party}</>, to: `/parties/${n.party_id}` };
    case 'join_rejected': return { text: <>Your request to join {party} wasn't accepted</>, to: '/parties' };
    case 'party_removed': return { text: <>You were removed from {party}</>, to: '/parties' };
    case 'party_leadership': return { text: <>You're now the leader of {party}</>, to: `/parties/${n.party_id}` };
    case 'party_closed': return { text: <>{party} was closed by the leader</>, to: n.party_id ? `/parties/${n.party_id}` : '/parties' };
    case 'message': {
      const where = n.data?.kind === 'party' ? <> in {party}</> : n.data?.kind === 'group' ? <> in {n.data.group_name ? <b>{n.data.group_name}</b> : 'a group'}</> : null;
      return {
        text: <><b>{n.count > 1 ? `${n.count} new messages` : 'New message'}</b> from <b>{who}</b>{where}</>,
        preview: n.data?.preview, to: `/messages/${n.conversation_id}`,
      };
    }
    case 'mention': {
      const where = n.data?.kind === 'channel' ? <> in <b>#{n.data.channel_name}</b> ({n.data.community_name})</>
        : n.data?.kind === 'group' ? <> in {n.data.group_name ? <b>{n.data.group_name}</b> : 'a group'}</> : n.data?.kind === 'party' ? <> in {party}</> : null;
      const to = n.data?.kind === 'channel' ? `/c/${n.data.community_id}/${n.data.channel_id}` : `/messages/${n.conversation_id}`;
      return { text: <><b>{who}</b> {n.data?.reply ? 'replied to you' : 'mentioned you'}{where}</>, preview: n.data?.preview, to };
    }
    case 'group_added': return { text: <><b>{who}</b> added you to {n.data?.group_name ? <b>{n.data.group_name}</b> : 'a group DM'}</>, to: `/messages/${n.conversation_id}` };
    case 'call': {
      const where = n.data?.kind === 'group' ? <> in {n.data.group_name ? <b>{n.data.group_name}</b> : 'a group'}</> : n.data?.kind === 'party' ? <> in {party}</> : null;
      return { text: <><b>{who}</b> started a call{where}</>, to: `/messages/${n.conversation_id}` };
    }
    case 'tournament': {
      const title = <b>{n.data?.title || 'a tournament'}</b>;
      const to = `/tournaments/${n.data?.tournament_id}`;
      const ev = n.data?.event;
      const text = ev === 'added_to_team' ? <><b>{who}</b> added you to their team in {title}</>
        : ev === 'started' ? <>{title} has started — check the bracket</>
        : ev === 'match_ready' ? <>Your next match in {title} is ready</>
        : ev === 'result_reported' ? <><b>{who}</b> reported a result in {title} — confirm it</>
        : ev === 'disputed' ? <>A match in {title} is disputed and needs you</>
        : ev === 'completed' ? <>{title} is over — see the results</>
        : ev === 'cancelled' ? <>{title} was cancelled</>
        : ev === 'prize_sent' ? <>The host of {title} says your prize was sent — confirm when it arrives</>
        : ev === 'prize_not_received' ? <>A winner of {title} reported their prize as not received</>
        : <>Update in {title}</>;
      return { text, to };
    }
    case 'beacon': return { text: <><b>{who}</b> is ready to play <b>{n.data?.game_name}</b> now{n.data?.note ? ` — “${n.data.note}”` : ''}</>, to: n.actor ? `/players/${n.actor.id}` : '/ready' };
    case 'endorsed': {
      const k = { great_comms: 'Great comms', clutch: 'Clutch', positive: 'Positive vibes', shotcaller: 'Shotcaller', teamplayer: 'Team player', chill: 'Chill' }[n.data?.kind] || 'GG';
      return { text: <><b>{who}</b> endorsed you: <b>{k}</b> 🙌</>, to: '/players/me' };
    }
    case 'level_up': return { text: <>Level up! You reached <b>level {n.data?.level}</b> 🎉</>, to: '/leaderboard', system: true };
    case 'report_update': return { text: n.data?.message || 'A moderator reviewed your report.', to: '/settings/safety', system: true };
    case 'moderation': return { text: n.data?.message || 'A moderator took action on your account.', to: null, system: true };
    default: return { text: n.type, to: null };
  }
}

export default function NotificationList({ compact, limit = 30, unreadOnly = false, onNavigate, onChange }) {
  const { onNotify, refreshCounts } = useApp();
  const toast = useToast();
  const { data, error, loading, reload, setData } = useAsync(() => api.listNotifications(limit, 0, unreadOnly), [limit, unreadOnly]);
  useEffect(() => onNotify(() => reload({ quiet: true })), [onNotify, reload]);

  const markRead = async (ids) => {
    setData((list) => list?.map((n) => (ids === null || ids.includes(n.id) ? { ...n, read_at: n.read_at || new Date().toISOString() } : n)));
    try { await api.markNotificationsRead(ids); refreshCounts(); onChange?.(); } catch (e) { toast(e, 'error'); }
  };
  const open = (n) => {
    const d = describe(n);
    if (!n.read_at) markRead([n.id]);
    if (d.to) { onNavigate?.(); navigate(d.to); }
  };
  const respondFriend = async (n, accept) => {
    try {
      await api.respondFriendRequest(n.actor.id, accept);
      toast(accept ? `You and ${n.actor.username} are now friends` : 'Request declined');
      reload({ quiet: true }); refreshCounts();
    } catch (e) { toast(e, 'error'); }
  };

  if (loading && !data) return <div className="notif-list">{[1, 2, 3].map((i) => <Skeleton key={i} h={52} r={10} />)}</div>;
  if (error) return <ErrorState error={error} onRetry={reload} />;
  const unread = data.filter((n) => !n.read_at).length;

  return (
    <div className={cx('notif-list', compact && 'compact')}>
      {compact && (
        <div className="notif-head">
          <strong>Notifications</strong>
          {unread > 0 && <Button variant="link" size="sm" icon={LuCheckCheck} onClick={() => markRead(null)}>Mark all read</Button>}
        </div>
      )}
      {data.length === 0 ? (
        <EmptyState icon={LuBellOff} title={unreadOnly ? 'No unread notifications' : 'No notifications yet'}>
          Friend requests, party invites, join requests and new messages show up here.
        </EmptyState>
      ) : (
        <ul>
          {data.map((n) => {
            const d = describe(n);
            return (
              <li key={n.id} className={cx('notif', !n.read_at && 'unread')}>
                <button type="button" className="notif-main" onClick={() => open(n)}>
                  {d.system ? <span className="notif-sys"><LuShieldAlert aria-hidden /></span> : <Avatar user={n.actor || { username: '?' }} size={34} />}
                  <span className="notif-text">
                    <span>{d.text}</span>
                    {d.preview && <span className="notif-preview">{d.preview}</span>}
                    <time dateTime={n.created_at}>{timeAgo(n.created_at)}</time>
                  </span>
                  {!n.read_at && <span className="unread-dot" aria-label="Unread" />}
                </button>
                {n.type === 'friend_request' && !n.read_at && n.actor && (
                  <div className="notif-actions">
                    <Button size="sm" variant="primary" onClick={() => respondFriend(n, true)}>Accept</Button>
                    <Button size="sm" variant="ghost" onClick={() => respondFriend(n, false)}>Decline</Button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
