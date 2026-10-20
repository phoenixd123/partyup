import { useEffect, useState } from 'react';
import { LuHash, LuMegaphone, LuUsers, LuLock } from 'react-icons/lu';
import * as api from '../lib/api.js';
import { useAsync, useInterval } from '../hooks/useAsync.js';
import { useApp } from '../context/AppContext.jsx';
import { Redirect, navigate } from '../lib/router.jsx';
import { Button, EmptyState, ErrorState, PageLoader, DemoBadge } from '../components/ui.jsx';
import { GameTag } from '../components/gaming.jsx';
import { useToast } from '../components/feedback.jsx';
import { useCommunity } from '../components/layout/AppShell.jsx';
import { CommunityIcon } from '../components/CommunityDialogs.jsx';
import ConversationView, { MemberList } from '../components/ConversationView.jsx';

export default function CommunityPage({ params }) {
  const { community } = useCommunity();
  const { refreshCounts, realtime } = useApp();
  const toast = useToast();
  const [joining, setJoining] = useState(false);
  const c = community.data;
  const members = useAsync(() => (c ? api.listCommunityMembers(params.id) : Promise.resolve([])), [params.id, !!c, c?.member_count]);
  useInterval(() => members.reload({ quiet: true }), realtime ? 60_000 : 20_000, !!c);

  if (community.loading && !c) return <PageLoader />;
  if (community.error) return <div className="content"><ErrorState error={community.error} onRetry={community.reload} /></div>;
  if (!c) {
    return <div className="content"><EmptyState icon={LuLock} title="Community not found" action={<Button onClick={() => navigate('/explore')}>Explore communities</Button>}>
      It may be private, deleted, or you were banned from it.</EmptyState></div>;
  }
  if (!params.channel && c.channels.length) return <Redirect to={`/c/${c.id}/${c.channels[0].id}`} />;
  const channel = c.channels.find((ch) => ch.id === params.channel);
  if (!channel) return <div className="content"><EmptyState icon={LuHash} title="Channel not found">It may have been deleted.</EmptyState></div>;

  const join = async () => {
    setJoining(true);
    try { await api.joinCommunity(c.id); toast(`Joined ${c.name}`); await community.reload({ quiet: true }); refreshCounts(); }
    catch (e) { toast(e, 'error'); } finally { setJoining(false); }
  };

  if (!c.is_member) {
    return (
      <div className="content">
        <div className="invite-card">
          <CommunityIcon community={c} size={72} radius={18} />
          <h1>{c.name} {c.is_demo && <DemoBadge />}</h1>
          {c.description && <p className="muted">{c.description}</p>}
          {c.game && <GameTag game={c.game} />}
          <p className="small muted"><span className="dot-on" />{c.online_count} online <span className="dot-off" style={{ marginLeft: 10 }} />{c.member_count} members</p>
          <Button variant="primary" size="lg" loading={joining} onClick={join}>Join community</Button>
          <p className="muted small">Join to read and post in #{channel.name} and the other channels.</p>
        </div>
      </div>
    );
  }
  return <ChannelChat community={c} channel={channel} members={members.data || []} onChanged={() => { community.reload({ quiet: true }); refreshCounts(); }} />;
}

function ChannelChat({ community, channel, members, onChanged }) {
  const conv = useAsync(() => api.getConversation(channel.conversation_id), [channel.conversation_id]);
  useEffect(() => { /* keep sidebar unread state fresh when switching channels */ onChanged(); }, [channel.id]); // eslint-disable-line
  if (conv.loading && !conv.data) return <PageLoader />;
  if (conv.error) return <div className="content"><ErrorState error={conv.error} onRetry={conv.reload} /></div>;
  if (!conv.data) return <div className="content"><EmptyState title="Can't open this channel" /></div>;
  const Icon = channel.kind === 'announcement' ? LuMegaphone : LuHash;
  return (
    <ConversationView key={channel.id} conv={conv.data} onChanged={() => { conv.reload({ quiet: true }); onChanged(); }}
      title={<><Icon aria-hidden className="hash" style={{ width: 18, height: 18 }} /><span>{channel.name}</span></>}
      topic={channel.topic} members={members} defaultPanel="members"
      memberPanel={<MemberList members={members} />}
      emptyTitle={`Welcome to #${channel.name}`}
      emptyText={channel.kind === 'announcement' ? 'Admins post news here. Everyone can read and react.' : `This is the start of #${channel.name} in ${community.name}.`}
      tools={<span className="muted small" style={{ marginRight: 6 }}><LuUsers aria-hidden style={{ width: 13, verticalAlign: -2 }} /> {community.member_count}</span>} />
  );
}
