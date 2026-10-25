import { useEffect, useState } from 'react';
import { LuMessagesSquare, LuArrowLeft, LuUsers, LuBan, LuGamepad2, LuUserPlus, LuPencil, LuLogOut, LuUserMinus, LuEllipsis } from 'react-icons/lu';
import * as api from '../lib/api.js';
import { useAsync } from '../hooks/useAsync.js';
import { useApp } from '../context/AppContext.jsx';
import { Link, navigate } from '../lib/router.jsx';
import { timeAgo } from '../lib/format.js';
import { Button, EmptyState, ErrorState, Skeleton, cx, DemoBadge, IconButton, Menu, Modal, Input, InlineError, PageLoader } from '../components/ui.jsx';
import { Avatar, Presence } from '../components/gaming.jsx';
import { useConfirm, useToast } from '../components/feedback.jsx';
import ConversationView, { MemberList } from '../components/ConversationView.jsx';
import { NewGroupDialog } from '../components/CommunityDialogs.jsx';
import { CallStage } from '../components/CallUI.jsx';
import { useCall } from '../context/CallContext.jsx';
import { LuPhone, LuVideo } from 'react-icons/lu';

const titleOf = (c) => (c.kind === 'party' ? c.party?.title : c.kind === 'group' ? (c.name || (c.members || []).map((m) => m.username).join(', ') || 'Group') : c.other?.username);

export default function MessagesPage({ params }) {
  return params.id ? <Thread id={params.id} /> : <ConversationList />;
}

function ConversationList() {
  const { userId, conversations, refreshCounts } = useApp();
  const [newGroup, setNewGroup] = useState(false);
  useEffect(() => { refreshCounts(); }, [refreshCounts]);
  return (
    <div className="narrow-wide">
      <div className="page-head">
        <div className="page-head-text"><h1>Messages</h1><p className="sub">Direct messages, group DMs and party chats.</p></div>
        <div className="page-actions"><Button icon={LuUsers} onClick={() => setNewGroup(true)}>New group DM</Button></div>
      </div>
      <div className="panel">
        {conversations === null ? <div className="stack pad">{[1, 2, 3].map((i) => <Skeleton key={i} h={48} />)}</div> : conversations.length === 0 ? (
          <EmptyState icon={LuMessagesSquare} title="No conversations yet" action={<Button onClick={() => navigate('/players')}>Find players</Button>}>
            Message a player from their profile, start a group with friends, or join a party to use its chat.
          </EmptyState>
        ) : (
          <ul className="conv-list" style={{ border: 0, listStyle: 'none', margin: 0, padding: 6 }}>
            {conversations.map((c) => {
              const last = c.last_message;
              const preview = !last ? 'No messages yet' : last.removed ? 'Message deleted' : `${last.sender_id === userId ? 'You: ' : ''}${last.body}`;
              return (
                <li key={c.id}>
                  <Link to={`/messages/${c.id}`} className={cx('conv', c.unread > 0 && !c.muted && 'has-unread')}>
                    {c.kind === 'direct' ? <Avatar user={c.other} size={36} status={c.other?.status} />
                      : c.kind === 'group' ? <span className="group-icon"><LuUsers aria-hidden /></span> : <span className="conv-party"><LuGamepad2 aria-hidden /></span>}
                    <span className="conv-text">
                      <span className="conv-top"><strong>{titleOf(c)}</strong>{last && <time dateTime={last.created_at}>{timeAgo(last.created_at)}</time>}</span>
                      <span className="conv-prev">{c.kind === 'group' ? `${(c.members?.length || 0) + 1} members — ` : ''}{preview}</span>
                    </span>
                    {c.unread > 0 && !c.muted && <span className="nav-badge" aria-label={`${c.unread} unread`}>{c.unread}</span>}
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </div>
      {newGroup && <NewGroupDialog onClose={() => setNewGroup(false)} />}
    </div>
  );
}

function Thread({ id }) {
  const { userId, refreshCounts, counts } = useApp();
  const call = useCall();
  const toast = useToast();
  const confirm = useConfirm();
  const conv = useAsync(() => api.getConversation(id), [id]);
  const [adding, setAdding] = useState(false);
  const [renaming, setRenaming] = useState(false);
  if (conv.loading && !conv.data) return <PageLoader />;
  if (conv.error) return <div className="content"><ErrorState error={conv.error} onRetry={conv.reload} /></div>;
  const c = conv.data;
  if (!c) return <div className="content"><EmptyState title="Conversation not found">You're not a member of this conversation.</EmptyState></div>;
  const refresh = () => { conv.reload({ quiet: true }); refreshCounts(); };
  const other = c.other;
  const isOwner = c.kind === 'group' && c.owner_id === userId;

  const back = <Link to="/messages" className="icon-btn menu-toggle" aria-label="Back to messages"><LuArrowLeft /></Link>;
  let title; let tools = null; let memberPanel = null;
  if (c.kind === 'direct') {
    title = (<>{back}<Link to={`/players/${other.id}`} className="row gap-s mini-link"><Avatar user={other} size={26} status={other.status} />
      <span>{other.username}</span></Link>{other.is_demo && <DemoBadge />}
      {other.unavailable ? <span className="muted small">Unavailable</span> : <Presence user={other} />}
      {c.blocked && <span className="muted small"><LuBan aria-hidden style={{ width: 13, verticalAlign: -2 }} /> Blocked</span>}</>);
  } else if (c.kind === 'party') {
    title = <>{back}<span className="conv-party" style={{ width: 26, height: 26 }}><LuGamepad2 aria-hidden /></span><Link to={`/parties/${c.party.id}`} className="mini-link">{c.party.title}</Link></>;
  } else {
    title = <>{back}<span className="group-icon" style={{ width: 26, height: 26 }}><LuUsers aria-hidden /></span><span>{titleOf({ ...c, members: c.members.filter((m) => m.id !== userId) })}</span></>;
    tools = (
      <>
        <IconButton icon={LuUserPlus} label="Add people" onClick={() => setAdding(true)} />
        <Menu trigger={({ toggle, open }) => <IconButton icon={LuEllipsis} label="Group options" onClick={toggle} aria-expanded={open} />}
          items={[
            { label: 'Rename group', icon: LuPencil, onClick: () => setRenaming(true) },
            { label: 'Leave group', icon: LuLogOut, danger: true, onClick: () => confirm({
              title: 'Leave this group?', body: isOwner ? 'Ownership passes to the next member.' : "You won't get its messages unless someone adds you back.",
              confirmLabel: 'Leave group', danger: true,
              action: async () => { await api.leaveGroupDm(c.id); refreshCounts(); navigate('/messages'); toast('Left the group'); } }) },
          ]} />
      </>
    );
    memberPanel = (
      <>
        <MemberList members={c.members} />
        {isOwner && c.members.length > 1 && (
          <div className="pad">
            <h3 style={{ padding: '0 0 6px' }}>Remove someone</h3>
            {c.members.filter((m) => m.id !== userId).map((m) => (
              <div key={m.id} className="row between" style={{ padding: '3px 0' }}>
                <span className="small">{m.username}</span>
                <IconButton icon={LuUserMinus} label={`Remove ${m.username}`} onClick={() => confirm({ title: `Remove ${m.username}?`, confirmLabel: 'Remove', danger: true,
                  action: async () => { await api.removeGroupMember(c.id, m.id); refresh(); toast(`Removed ${m.username}`); } })} />
              </div>
            ))}
          </div>
        )}
      </>
    );
  }

  // Voice / video call for this chat
  const room = `conv:${c.id}`;
  const callTitle = c.kind === 'direct' ? other?.username : titleOf({ ...c, members: (c.members || []).filter((m) => m.id !== userId) });
  const ringing = (counts.calls || []).find((x) => x.room === room);
  const canCall = !(c.kind === 'direct' && (c.blocked || other?.unavailable || other?.is_demo));
  const callTools = canCall && !call.inRoom(room) && (
    <>
      <IconButton icon={LuPhone} label="Start voice call" onClick={() => call.join(room, { title: callTitle, to: `/messages/${c.id}` })} />
      <IconButton icon={LuVideo} label="Start video call" onClick={() => call.join(room, { title: callTitle, to: `/messages/${c.id}`, video: true })} />
    </>
  );
  tools = <>{callTools}{tools}</>;
  const stage = (call.inRoom(room) || ringing) && (
    <CallStage room={room} title={callTitle} to={`/messages/${c.id}`} people={ringing?.participants || []} kind="call" />
  );

  return (
    <>
      {c.is_demo_partner && <p className="banner banner-info">This is a demo profile — sample data for development. Messages are saved, but nobody will reply.</p>}
      <ConversationView key={c.id} conv={c} onChanged={refresh} title={title} members={c.members} memberPanel={memberPanel} tools={tools} stage={stage}
        defaultPanel={c.kind === 'group' ? 'members' : null}
        emptyTitle={c.kind === 'direct' ? `This is the start of your messages with ${other.username}` : c.kind === 'group' ? 'Welcome to the group' : 'Party chat'}
        emptyText={c.kind === 'direct' ? 'Only the two of you can see this conversation.' : 'Everyone in here can see these messages.'} />
      {adding && <NewGroupDialog existing={c} onClose={(changed) => { setAdding(false); if (changed) refresh(); }} />}
      {renaming && <RenameDialog conv={c} onClose={(changed) => { setRenaming(false); if (changed) refresh(); }} />}
    </>
  );
}

function RenameDialog({ conv, onClose }) {
  const [name, setName] = useState(conv.name || '');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const save = async () => {
    setBusy(true); setErr(null);
    try { await api.renameGroupDm(conv.id, name); onClose(true); } catch (e) { setErr(e); setBusy(false); }
  };
  return (
    <Modal open onClose={() => onClose(false)} title="Rename group" size="sm"
      footer={<><Button variant="ghost" onClick={() => onClose(false)}>Cancel</Button><Button variant="primary" loading={busy} onClick={save}>Save</Button></>}>
      <Input value={name} maxLength={40} onChange={(e) => setName(e.target.value)} placeholder="Group name" aria-label="Group name" data-autofocus
        onKeyDown={(e) => { if (e.key === 'Enter') save(); }} />
      <p className="muted small">Leave empty to show member names instead.</p>
      <InlineError error={err} />
    </Modal>
  );
}
