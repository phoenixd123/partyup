import { useState } from 'react';
import { LuShieldCheck, LuShieldX, LuArrowLeft, LuInbox } from 'react-icons/lu';
import * as api from '../lib/api.js';
import { useAsync } from '../hooks/useAsync.js';
import { useApp } from '../context/AppContext.jsx';
import { Link, navigate } from '../lib/router.jsx';
import { REPORT_CATEGORIES, label } from '../lib/constants.js';
import { timeAgo } from '../lib/format.js';
import { Badge, Button, EmptyState, ErrorState, Field, PageHeader, PageLoader, Panel, Segmented, Select, Textarea, InlineError, Input } from '../components/ui.jsx';
import { Avatar } from '../components/gaming.jsx';
import { useConfirm, useToast } from '../components/feedback.jsx';

const STATUS_TONE = { open: 'warn', in_review: 'info', resolved: 'good', dismissed: 'neutral' };
const statusText = (s) => s.replace('_', ' ');

export default function ModerationPage({ params }) {
  const { roles } = useApp();
  // The server enforces moderator access on every call; this check only avoids a confusing screen.
  if (!roles.moderator) {
    return <EmptyState icon={LuShieldX} title="Moderator access required" action={<Button onClick={() => navigate('/')}>Go home</Button>}>
      This area is only available to accounts with a moderator role.</EmptyState>;
  }
  return params.id ? <ReportDetail id={params.id} /> : <ReportQueue />;
}

function ReportQueue() {
  const [status, setStatus] = useState('active');
  const { data, error, loading, reload } = useAsync(() => api.modListReports(status), [status]);
  const c = data?.counts || {};
  return (
    <div>
      <PageHeader title="Moderation" sub="Review reports from players. Every action is logged." />
      <Segmented ariaLabel="Report status" value={status} onChange={setStatus} options={[
        { value: 'active', label: 'Needs review', count: (c.open || 0) + (c.in_review || 0) },
        { value: 'resolved', label: 'Resolved', count: c.resolved }, { value: 'dismissed', label: 'Dismissed', count: c.dismissed }, { value: 'all', label: 'All' },
      ]} />
      <div className="mt">
        {error ? <ErrorState error={error} onRetry={reload} /> : loading && !data ? <PageLoader /> : data.reports.length === 0 ? (
          <EmptyState icon={LuInbox} title="Nothing here">No reports with this status.</EmptyState>
        ) : (
          <div className="panel">
            <table className="table">
              <thead><tr><th>Reported player</th><th>Category</th><th>Summary</th><th>Reporter</th><th>Status</th><th>Filed</th></tr></thead>
              <tbody>
                {data.reports.map((r) => (
                  <tr key={r.id} onClick={() => navigate(`/moderation/${r.id}`)} className="click-row">
                    <td><Link to={`/moderation/${r.id}`}><strong>{r.reported_username}</strong></Link>{r.prior_reports > 0 && <span className="muted small block">{r.prior_reports} other report{r.prior_reports > 1 ? 's' : ''}</span>}</td>
                    <td>{label(REPORT_CATEGORIES, r.category)}</td>
                    <td className="clip">{r.description}</td>
                    <td>{r.reporter_username || <span className="muted">Deleted</span>}</td>
                    <td><Badge tone={STATUS_TONE[r.status]}>{statusText(r.status)}</Badge></td>
                    <td className="nowrap">{timeAgo(r.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function ReportDetail({ id }) {
  const { roles, refreshCounts } = useApp();
  const toast = useToast();
  const confirm = useConfirm();
  const { data: r, error, loading, reload } = useAsync(() => api.modGetReport(id), [id]);
  const [status, setStatus] = useState(null);
  const [action, setAction] = useState('none');
  const [days, setDays] = useState('3');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  if (loading && !r) return <PageLoader />;
  if (error) return <ErrorState error={error} onRetry={reload} />;
  if (!r) return <EmptyState title="Report not found" action={<Button onClick={() => navigate('/moderation')}>Back to queue</Button>} />;
  const st = status || (r.status === 'open' ? 'in_review' : r.status);

  const actions = [
    { value: 'none', label: 'No action' },
    { value: 'warning', label: 'Send a warning' },
    { value: 'remove_content', label: r.message_id ? 'Remove the reported message' : r.category === 'inappropriate_profile' ? 'Clear bio, picture and highlights' : 'Remove content', disabled: !r.message_id && r.category !== 'inappropriate_profile' },
    { value: 'suspend', label: 'Suspend account' },
    { value: 'ban', label: roles.admin ? 'Ban account' : 'Ban account (admins only)', disabled: !roles.admin },
  ];

  const submit = async () => {
    const run = async () => {
      await api.modUpdateReport({ p_report: r.id, p_status: st, p_action: action, p_note: note.trim() || null, p_suspend_days: action === 'suspend' ? Number(days) : null });
      toast('Report updated'); setAction('none'); setNote(''); setStatus(null); refreshCounts(); await reload({ quiet: true });
    };
    if (['suspend', 'ban', 'remove_content'].includes(action)) {
      const what = { suspend: `suspend ${r.reported_username} for ${days} day(s)`, ban: `permanently ban ${r.reported_username}`, remove_content: 'remove this content' }[action];
      await confirm({ title: 'Confirm moderation action', body: `You're about to ${what}. This is logged with your name.`, confirmLabel: 'Apply action', danger: true, action: run });
      return;
    }
    setBusy(true); setErr(null);
    try { await run(); } catch (e) { setErr(e); } finally { setBusy(false); }
  };

  const t = r.reported_profile;
  return (
    <div>
      <Link to="/moderation" className="back-link"><LuArrowLeft aria-hidden /> Report queue</Link>
      <PageHeader title={`Report: ${r.reported_username}`} sub={`${label(REPORT_CATEGORIES, r.category)}, filed ${timeAgo(r.created_at)} by ${r.reporter_username || 'a deleted account'}`}
        actions={<Badge tone={STATUS_TONE[r.status]}>{statusText(r.status)}</Badge>} />
      <div className="profile-grid">
        <div className="profile-main">
          <Panel title="Report">
            <div className="pad stack">
              <p className="pre">{r.description}</p>
              {r.message_snapshot && (
                <div><span className="field-label">Reported message</span><blockquote className="snapshot">{r.message_snapshot}</blockquote></div>
              )}
              {r.party_title && <p className="small">In party <Link to={`/parties/${r.party_id}`}>{r.party_title}</Link></p>}
              {r.resolution_note && <p className="small"><b>Moderator note:</b> {r.resolution_note}</p>}
              {r.action_taken !== 'none' && <p className="small"><b>Action taken:</b> {r.action_taken.replace('_', ' ')}</p>}
            </div>
          </Panel>
          <Panel title="Take action">
            <div className="form-body">
              <div className="field-pair">
                <Field label="Status" htmlFor="m-status"><Select id="m-status" value={st} onChange={setStatus} options={[
                  { value: 'open', label: 'Open' }, { value: 'in_review', label: 'In review' }, { value: 'resolved', label: 'Resolved' }, { value: 'dismissed', label: 'Dismissed' }]} /></Field>
                <Field label="Action" htmlFor="m-action"><Select id="m-action" value={action} onChange={(v) => setAction(v || 'none')} options={actions} /></Field>
              </div>
              {action === 'suspend' && <Field label="Suspension length (days)" htmlFor="m-days"><Input id="m-days" type="number" min={1} max={365} value={days} onChange={(e) => setDays(e.target.value)} /></Field>}
              <Field label="Internal note" htmlFor="m-note" optional hint="Visible to moderators only."><Textarea id="m-note" rows={3} maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} /></Field>
              <p className="muted small">The reported player is notified of warnings, removals and suspensions. The reporter is told when the report is resolved or dismissed, without details.</p>
              <InlineError error={err} />
              <div><Button variant="primary" icon={LuShieldCheck} loading={busy} onClick={submit}>Save</Button></div>
            </div>
          </Panel>
        </div>
        <aside className="profile-side">
          <Panel title="Reported account">
            {!t ? <p className="muted pad">This account has been deleted.</p> : (
              <div className="pad stack">
                <Link to={`/players/${t.id}`} className="row gap-s mini-link"><Avatar user={t} size={44} /><strong>{t.username}</strong></Link>
                {t.bio && <p className="small pre">{t.bio}</p>}
                {t.highlights?.length > 0 && <ul className="highlights">{t.highlights.map((h) => <li key={h}>{h}</li>)}</ul>}
                <p className="small muted">Joined {new Date(t.created_at).toLocaleDateString()}</p>
                {t.is_banned && <Badge tone="danger">Banned</Badge>}
                {t.suspended_until && new Date(t.suspended_until) > new Date() && <Badge tone="warn">Suspended until {new Date(t.suspended_until).toLocaleDateString()}</Badge>}
              </div>
            )}
          </Panel>
          <Panel title="Other reports about this player">
            {r.other_reports.length === 0 ? <p className="muted small pad">None.</p> : (
              <ul className="mini-list">{r.other_reports.map((o) => (
                <li key={o.id}><Link to={`/moderation/${o.id}`} className="grow mini-link">{label(REPORT_CATEGORIES, o.category)}<span className="muted small block">{timeAgo(o.created_at)}</span></Link><Badge tone={STATUS_TONE[o.status]}>{statusText(o.status)}</Badge></li>
              ))}</ul>
            )}
          </Panel>
          <Panel title="Action history">
            {r.actions.length === 0 ? <p className="muted small pad">No actions yet.</p> : (
              <ul className="activity">{r.actions.map((a, i) => (
                <li key={i}><span><b>{a.action.replace('_', ' ')}</b> by {a.moderator || 'a former moderator'}{a.note ? `: ${a.note}` : ''}</span><time>{timeAgo(a.created_at)}</time></li>
              ))}</ul>
            )}
          </Panel>
        </aside>
      </div>
    </div>
  );
}
