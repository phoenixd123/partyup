import { useState } from 'react';
import { LuLink2Off } from 'react-icons/lu';
import * as api from '../lib/api.js';
import { useAsync } from '../hooks/useAsync.js';
import { useApp } from '../context/AppContext.jsx';
import { navigate } from '../lib/router.jsx';
import { Button, EmptyState, ErrorState, PageLoader, DemoBadge, InlineError } from '../components/ui.jsx';
import { GameTag } from '../components/gaming.jsx';
import { CommunityIcon } from '../components/CommunityDialogs.jsx';

export default function InvitePage({ params }) {
  const { refreshCounts } = useApp();
  const inv = useAsync(() => api.getInvite(params.code), [params.code]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  if (inv.loading) return <PageLoader />;
  if (inv.error) return <ErrorState error={inv.error} onRetry={inv.reload} />;
  const d = inv.data;
  if (!d.valid) {
    return <EmptyState icon={LuLink2Off} title="Invite not available" action={<Button onClick={() => navigate('/explore')}>Explore communities</Button>}>{d.reason}</EmptyState>;
  }
  const c = d.community;
  const accept = async () => {
    setBusy(true); setErr(null);
    try { const id = await api.acceptInvite(params.code); refreshCounts(); navigate(`/c/${id}`, { replace: true }); }
    catch (e) { setErr(e); setBusy(false); }
  };
  return (
    <div className="invite-card">
      <p className="muted small">{d.inviter ? `${d.inviter} invited you to join` : "You've been invited to join"}</p>
      <CommunityIcon community={c} size={72} radius={18} />
      <h1>{c.name} {c.is_demo && <DemoBadge />}</h1>
      {c.description && <p className="muted">{c.description}</p>}
      {c.game && <GameTag game={c.game} />}
      <p className="small muted"><span className="dot-on" />{c.online_count} online <span className="dot-off" style={{ marginLeft: 10 }} />{c.member_count} members</p>
      {d.is_member ? <Button variant="primary" size="lg" onClick={() => navigate(`/c/${c.id}`)}>Open community</Button>
        : <Button variant="primary" size="lg" loading={busy} onClick={accept}>Accept invite</Button>}
      <InlineError error={err} />
    </div>
  );
}
