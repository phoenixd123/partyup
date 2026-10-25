import { celebrate } from '../lib/confetti.js';
import { useEffect, useState } from 'react';
import { LuMessageCircle, LuUserMinus, LuUserPlus, LuUsers, LuInbox, LuEllipsis, LuBan } from 'react-icons/lu';
import * as api from '../lib/api.js';
import { useAsync } from '../hooks/useAsync.js';
import { useApp } from '../context/AppContext.jsx';
import { Link, navigate } from '../lib/router.jsx';
import { timeAgo } from '../lib/format.js';
import { Button, EmptyState, ErrorState, IconButton, Input, Menu, PageHeader, Segmented, Skeleton } from '../components/ui.jsx';
import { Avatar, Presence } from '../components/gaming.jsx';
import { useConfirm, useToast } from '../components/feedback.jsx';
import { InviteDialog } from '../components/PlayerActions.jsx';

export default function FriendsPage({ query }) {
  const { refreshCounts, onNotify } = useApp();
  const toast = useToast();
  const confirm = useConfirm();
  const [tab, setTab] = useState(query.tab === 'requests' ? 'requests' : 'friends');
  const [q, setQ] = useState('');
  const [inviting, setInviting] = useState(null);
  const { data, error, loading, reload } = useAsync(() => api.listFriends(), []);
  useEffect(() => onNotify(() => reload({ quiet: true })), [onNotify, reload]);

  const act = async (fn, msg) => { try { await fn(); toast(msg); reload({ quiet: true }); refreshCounts(); } catch (e) { toast(e, 'error'); } };
  const message = async (u) => { try { navigate(`/messages/${await api.openDirectConversation(u.id)}`); } catch (e) { toast(e, 'error'); } };

  const [addName, setAddName] = useState('');
  const [adding, setAdding] = useState(false);
  const addByName = async (e) => {
    e.preventDefault();
    const name = addName.trim();
    if (!name) return;
    setAdding(true);
    try {
      const r = await api.findPlayers({ p_search: name, p_limit: 10, p_include_demo: true });
      const hit = r.players.find((p) => p.username.toLowerCase() === name.toLowerCase());
      if (!hit) throw new Error(`No player named ${name}. Check the spelling — usernames are exact.`);
      const res = await api.sendFriendRequest(hit.id);
      toast(res === 'friends' ? `You and ${hit.username} are now friends 🤝` : `Friend request sent to ${hit.username}`);
      if (res === 'friends') celebrate({ count: 80 });
      setAddName(''); reload({ quiet: true });
    } catch (ex) { toast(ex, 'error'); } finally { setAdding(false); }
  };
  const friends = (data?.friends || []).filter((f) => f.username.toLowerCase().includes(q.toLowerCase()));
  const online = friends.filter((f) => f.status !== 'offline');
  const offline = friends.filter((f) => f.status === 'offline');
  const reqCount = (data?.incoming.length || 0);

  const row = (f) => (
    <li key={f.id} className="friend-row">
      <Link to={`/players/${f.id}`} className="row gap-s grow mini-link">
        <Avatar user={f} size={42} status={f.status} />
        <span><strong>{f.username}</strong><span className="block small"><Presence user={f} /></span></span>
      </Link>
      <span className="row gap-xs">
        <Button size="sm" icon={LuMessageCircle} onClick={() => message(f)}>Message</Button>
        <Button size="sm" variant="ghost" onClick={() => setInviting(f)}>Invite</Button>
        <Menu trigger={({ toggle, open }) => <IconButton icon={LuEllipsis} label={`More for ${f.username}`} onClick={toggle} aria-expanded={open} />}
          items={[
            { label: 'Remove friend', icon: LuUserMinus, danger: true, onClick: () => confirm({ title: `Remove ${f.username}?`, body: 'You can add each other again later.', confirmLabel: 'Remove friend', danger: true, action: async () => { await api.removeFriend(f.id); reload({ quiet: true }); } }) },
            { label: 'Block', icon: LuBan, danger: true, onClick: () => confirm({ title: `Block ${f.username}?`, body: 'This removes the friendship and stops them contacting you.', confirmLabel: 'Block', danger: true, action: async () => { await api.blockUser(f.id); reload({ quiet: true }); } }) },
          ]} />
      </span>
    </li>
  );

  return (
    <div className="narrow-wide">
      <PageHeader title="Friends" actions={<Button icon={LuUserPlus} onClick={() => navigate('/players')}>Find players</Button>} />
      <div className="toolbar">
        <Segmented ariaLabel="Friends view" value={tab} onChange={setTab}
          options={[{ value: 'friends', label: 'Friends', count: data?.friends.length }, { value: 'requests', label: 'Requests', count: reqCount }]} />
        {tab === 'friends' && <Input type="search" placeholder="Search friends" aria-label="Search friends" value={q} onChange={(e) => setQ(e.target.value)} />}
      </div>
      <div className="panel" style={{ marginBottom: 14 }}>
        <h2 className="list-h">Add friend</h2>
        <form className="add-friend" onSubmit={addByName}>
          <Input value={addName} onChange={(e) => setAddName(e.target.value)} placeholder="Enter a username" aria-label="Username to add" maxLength={20} />
          <Button type="submit" variant="primary" loading={adding} disabled={!addName.trim()}>Send request</Button>
        </form>
      </div>
      {error ? <ErrorState error={error} onRetry={reload} /> : loading && !data ? <div className="stack">{[1, 2, 3].map((i) => <Skeleton key={i} h={62} r={12} />)}</div> :
        tab === 'friends' ? (
          data.friends.length === 0 ? (
            <EmptyState icon={LuUsers} title="No friends yet" action={<Button variant="primary" onClick={() => navigate('/players')}>Find players</Button>}>
              Add players you get along with so you can see when they're online and invite them in one click.
            </EmptyState>
          ) : (
            <div className="panel">
              {online.length > 0 && <><h2 className="list-h">Online ({online.length})</h2><ul className="friend-list">{online.map(row)}</ul></>}
              {offline.length > 0 && <><h2 className="list-h">Offline ({offline.length})</h2><ul className="friend-list">{offline.map(row)}</ul></>}
              {friends.length === 0 && <p className="muted pad">No friends match “{q}”.</p>}
            </div>
          )
        ) : (
          <div className="stack">
            <div className="panel">
              <h2 className="list-h">Received</h2>
              {data.incoming.length === 0 ? <p className="muted small pad">No pending requests.</p> : (
                <ul className="friend-list">
                  {data.incoming.map((u) => (
                    <li key={u.id} className="friend-row">
                      <Link to={`/players/${u.id}`} className="row gap-s grow mini-link"><Avatar user={u} size={42} /><span><strong>{u.username}</strong><span className="muted small block">{timeAgo(u.requested_at)}</span></span></Link>
                      <span className="row gap-xs">
                        <Button size="sm" variant="primary" onClick={() => { act(() => api.respondFriendRequest(u.id, true), `You and ${u.username} are now friends 🤝`); celebrate({ count: 80 }); }}>Accept</Button>
                        <Button size="sm" variant="ghost" onClick={() => act(() => api.respondFriendRequest(u.id, false), 'Request declined')}>Decline</Button>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div className="panel">
              <h2 className="list-h">Sent</h2>
              {data.outgoing.length === 0 ? <p className="muted small pad"><LuInbox aria-hidden /> No outgoing requests.</p> : (
                <ul className="friend-list">
                  {data.outgoing.map((u) => (
                    <li key={u.id} className="friend-row">
                      <Link to={`/players/${u.id}`} className="row gap-s grow mini-link"><Avatar user={u} size={42} /><span><strong>{u.username}</strong><span className="muted small block">Sent {timeAgo(u.requested_at)}</span></span></Link>
                      <Button size="sm" variant="ghost" onClick={() => act(() => api.removeFriend(u.id), 'Request cancelled')}>Cancel</Button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        )}
      {inviting && <InviteDialog player={inviting} onClose={() => setInviting(null)} />}
    </div>
  );
}
