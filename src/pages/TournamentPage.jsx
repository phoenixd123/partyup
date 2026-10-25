import { useEffect } from 'react';
import { celebrate, bigCelebrate } from '../lib/confetti.js';
import { useState } from 'react';
import {
  LuTrophy, LuCalendarClock, LuUsers, LuFlag, LuPlay, LuX, LuShieldCheck, LuCrown, LuCircleAlert, LuCheck, LuSend, LuDoorOpen,
} from 'react-icons/lu';
import * as api from '../lib/api.js';
import { useAsync, useInterval } from '../hooks/useAsync.js';
import { useApp } from '../context/AppContext.jsx';
import { Link, navigate } from '../lib/router.jsx';
import { regionLabel, platformLabel } from '../lib/constants.js';
import { sessionTime, timeAgo } from '../lib/format.js';
import { AGREEMENT_VERSION } from '../lib/tournamentAgreement.js';
import { Badge, Button, ChipSelect, EmptyState, ErrorState, Field, Input, InlineError, Modal, PageLoader, Panel, Segmented, Select, Textarea, cx } from '../components/ui.jsx';
import { Avatar, Name } from '../components/gaming.jsx';
import GameIcon from '../components/GameIcon.jsx';
import { useConfirm, useToast } from '../components/feedback.jsx';
import { AgreementText } from './TournamentAgreementPage.jsx';
import { prizeLabel, STATUS_LABEL } from './TournamentsPage.jsx';

const ROUND_NAME = (r, total) => (r === total ? 'Final' : r === total - 1 ? 'Semifinals' : r === total - 2 ? 'Quarterfinals' : `Round ${r}`);
const PLACE = { 1: '1st', 2: '2nd', 3: '3rd' };
const money = (t, amount) => {
  if (amount == null) return null;
  try { return new Intl.NumberFormat(undefined, { style: 'currency', currency: t.prize_currency || 'USD' }).format(amount); } catch { return `${amount} ${t.prize_currency || ''}`; }
};

export default function TournamentPage({ params }) {
  const { userId } = useApp();
  const toast = useToast();
  const confirm = useConfirm();
  const res = useAsync(() => api.getTournament(params.id), [params.id]);
  const t = res.data;
  useInterval(() => res.reload({ quiet: true }), 10_000, t?.status === 'in_progress' || t?.status === 'registration');
  const [tab, setTab] = useState(null);
  const [registering, setRegistering] = useState(false);
  const [reporting, setReporting] = useState(null); // match
  const [flagging, setFlagging] = useState(false);
  if (res.loading && !t) return <PageLoader />;
  if (res.error) return <ErrorState error={res.error} onRetry={res.reload} />;
  if (!t) return <EmptyState icon={LuTrophy} title="Tournament not found" action={<Button onClick={() => navigate('/tournaments')}>All tournaments</Button>}>It may have been removed.</EmptyState>;

  const view = tab || (t.status === 'registration' ? 'overview' : 'bracket');
  const entrants = Object.fromEntries(t.entrants.map((e) => [e.id, e]));
  const isEntered = !!t.my_entrant;
  const full = t.entrant_count >= t.max_entrants;
  const act = async (fn, msg) => { try { await fn(); if (msg) toast(msg); res.reload({ quiet: true }); } catch (e) { toast(e, 'error'); } };

  const start = () => confirm({
    title: 'Start the tournament?', confirmLabel: 'Start now',
    body: `Sign-ups close and a bracket is drawn for ${t.entrant_count} ${t.team_size > 1 ? 'teams' : 'players'}. Incomplete teams are removed.`,
    action: () => act(() => api.startTournament(t.id), 'Bracket is live 🔥'),
  });
  const cancel = () => confirm({
    title: 'Cancel this tournament?', danger: true, confirmLabel: 'Cancel tournament', requireText: null,
    body: 'Everyone who entered is notified. This shows on your host record.',
    action: () => act(() => api.cancelTournament(t.id, 'Cancelled by the host'), 'Tournament cancelled'),
  });
  const withdraw = () => confirm({
    title: t.am_captain ? 'Withdraw your team?' : 'Leave your team?', danger: true, confirmLabel: 'Withdraw',
    body: t.am_captain ? 'Your whole team is removed from the tournament.' : "Your captain will need to find a replacement before it starts.",
    action: () => act(() => api.withdrawTournament(t.id), 'Withdrawn'),
  });

  const prize = prizeLabel(t);
  const champion = t.status === 'completed' && t.entrants.find((e) => e.final_place === 1);
  const rounds = Math.max(0, ...t.matches.map((m) => m.round));
  return (
    <div className="tourney">
      <section className="t-hero">
        <GameIcon game={t.game} size={64} />
        <div className="grow" style={{ minWidth: 0 }}>
          <div className="row gap-s wrap"><Badge tone={t.status === 'in_progress' ? 'accent' : t.status === 'registration' ? 'good' : t.status === 'cancelled' ? 'bad' : 'neutral'}>{STATUS_LABEL[t.status]}</Badge>
            <span className="muted small">{t.game?.name}</span></div>
          <h1>{t.title}</h1>
          <div className="row gap-m wrap muted small">
            <span><LuCalendarClock aria-hidden /> {sessionTime(t.starts_at)}</span>
            <span><LuUsers aria-hidden /> {t.entrant_count}/{t.max_entrants} {t.team_size > 1 ? `teams of ${t.team_size}` : 'players'}</span>
            {t.region && <span>{regionLabel(t.region)}</span>}
            {t.platform && <span>{t.platform === 'crossplay' ? 'Crossplay' : platformLabel(t.platform)}</span>}
            {t.community && <Link to={`/c/${t.community.id}`}>{t.community.name}</Link>}
          </div>
        </div>
        <div className="t-actions">
          {t.status === 'registration' && !t.am_host && !isEntered && (
            <Button variant="primary" size="lg" icon={LuTrophy} disabled={full} onClick={() => setRegistering(true)}>{full ? 'Full' : t.team_size > 1 ? 'Enter a team' : 'Enter'}</Button>
          )}
          {t.status === 'registration' && isEntered && <Button icon={LuDoorOpen} onClick={withdraw}>{t.am_captain ? 'Withdraw' : 'Leave team'}</Button>}
          {t.status === 'registration' && t.am_host && <Button variant="primary" icon={LuPlay} disabled={t.entrant_count < 2} onClick={start} title={t.entrant_count < 2 ? 'Needs at least 2 entrants' : undefined}>Start tournament</Button>}
          {(t.am_host || t.is_moderator) && ['registration', 'in_progress'].includes(t.status) && <Button variant="ghost" icon={LuX} onClick={cancel}>Cancel</Button>}
          {!t.am_host && <Button variant="ghost" icon={LuFlag} onClick={() => setFlagging(true)}>Report</Button>}
        </div>
      </section>
      {champion && <ChampionBanner t={t} champ={champion} mine={champion.members.some((u) => u.id === userId)} />}
      {t.status === 'cancelled' && <p className="banner banner-warn">This tournament was cancelled{t.cancel_reason ? `: ${t.cancel_reason}` : '.'}</p>}

      <Segmented ariaLabel="Section" value={view} onChange={setTab} options={[
        { value: 'overview', label: 'Overview' }, { value: 'bracket', label: 'Bracket' },
        { value: 'teams', label: `${t.team_size > 1 ? 'Teams' : 'Players'} (${t.entrant_count})` }, { value: 'rules', label: 'Rules' },
      ]} />

      {view === 'overview' && (
        <div className="t-grid">
          <div className="stack-l">
            <Panel title="About">{t.description ? <p className="pre">{t.description}</p> : <p className="muted">No description.</p>}</Panel>
            {t.status === 'completed' && <Results t={t} userId={userId} onChanged={() => res.reload({ quiet: true })} />}
          </div>
          <div className="stack-l">
            <Panel title="Prize">
              {prize ? (
                <div className="t-prize-box">
                  <div className="t-prize-big"><LuTrophy aria-hidden /> {prize}</div>
                  {t.prize_split?.length > 0 && <ul className="t-split">{t.prize_split.map((x) => <li key={x.place}><span>{PLACE[x.place]}</span><b>{money(t, x.amount)}</b></li>)}</ul>}
                  {t.prize_description && t.prize_total && <p className="small">{t.prize_description}</p>}
                  {t.payout_method && <p className="small"><b>Paid by:</b> {t.payout_method}{t.payout_deadline_days ? `, within ${t.payout_deadline_days} days` : ''}</p>}
                  <p className="notice-inline"><LuShieldCheck aria-hidden /> Provided and paid by the host. PartyUp doesn't hold prize money. Never pay to enter.</p>
                </div>
              ) : <p className="muted">No prize — for glory.</p>}
            </Panel>
            <Panel title="Host">
              <div className="row gap-s">
                <Avatar user={t.host} size={40} />
                <div><Link to={t.host ? `/players/${t.host.id}` : '#'} className="mini-link"><Name user={t.host} /></Link>
                  {t.host_contact && <div className="small muted">{t.host_contact}</div>}</div>
              </div>
              <div className="host-record">
                <span><b>{t.host_stats.completed}</b> completed</span>
                <span className="good"><b>{t.host_stats.prizes_received}</b> prizes confirmed paid</span>
                <span className={t.host_stats.prizes_not_received ? 'bad' : ''}><b>{t.host_stats.prizes_not_received}</b> reported unpaid</span>
              </div>
              {t.host_stats.hosted <= 1 && <p className="muted small">New host — no track record yet.</p>}
            </Panel>
          </div>
        </div>
      )}

      {view === 'bracket' && (
        t.matches.length === 0 ? <EmptyState icon={LuTrophy} title="Bracket not drawn yet">The bracket appears when the host starts the tournament.</EmptyState> : (
          <div className="bracket" style={{ '--rounds': rounds }}>
            {Array.from({ length: rounds }, (_, i) => i + 1).map((r) => (
              <div key={r} className="bracket-round">
                <h3>{ROUND_NAME(r, rounds)}</h3>
                <div className="bracket-matches">
                  {t.matches.filter((m) => m.round === r).map((m) => (
                    <MatchCard key={m.id} m={m} t={t} entrants={entrants} userId={userId} onReport={() => setReporting(m)} />
                  ))}
                </div>
              </div>
            ))}
          </div>
        )
      )}

      {view === 'teams' && (
        t.entrants.length === 0 ? <EmptyState icon={LuUsers} title="No one has entered yet">Share the tournament with your community.</EmptyState> : (
          <div className="card-grid">
            {t.entrants.map((e) => (
              <article key={e.id} className={cx('t-team', e.eliminated && 'out')}>
                <div className="row between"><h3>{e.team_name}</h3>{e.final_place ? <Badge tone={e.final_place === 1 ? 'accent' : 'neutral'}>{PLACE[e.final_place]}</Badge> : e.seed ? <span className="muted small">Seed {e.seed}</span> : null}</div>
                <ul className="t-roster">
                  {e.members.map((u) => <li key={u.id}><Avatar user={u} size={24} /><Link to={`/players/${u.id}`}><Name user={u} /></Link>{u.id === e.captain_id && t.team_size > 1 && <LuCrown aria-label="Captain" className="cap" />}</li>)}
                  {e.members.length < t.team_size && <li className="muted small">{t.team_size - e.members.length} spot(s) open</li>}
                </ul>
              </article>
            ))}
          </div>
        )
      )}

      {view === 'rules' && (
        <div className="stack-l">
          <Panel title="Rules">{t.rules ? <p className="pre">{t.rules}</p> : <p className="muted">The host didn't post extra rules. The Tournament Agreement still applies.</p>}</Panel>
          <Panel title="Results & disputes">
            <p className="small">Team captains report each match. When both captains report the same winner, it's final. If they disagree the match is marked <b>disputed</b> and the host decides. The host can also report results directly.</p>
          </Panel>
          <Panel title="Tournament Agreement"><AgreementText /></Panel>
        </div>
      )}

      {registering && <RegisterDialog t={t} onClose={(ok) => { setRegistering(false); if (ok) res.reload({ quiet: true }); }} />}
      {reporting && <ReportMatchDialog t={t} m={reporting} entrants={entrants} userId={userId} onClose={(ok) => { setReporting(null); if (ok) res.reload({ quiet: true }); }} />}
      {flagging && <ReportTournamentDialog t={t} onClose={() => setFlagging(false)} />}
    </div>
  );
}

function ChampionBanner({ t, champ, mine }) {
  useEffect(() => {
    const key = `partyup.champ.${t.id}`;
    try { if (localStorage.getItem(key)) return; localStorage.setItem(key, '1'); } catch { /* ignore */ }
    if (mine) bigCelebrate(); else celebrate({ count: 90 });
  }, [t.id, mine]);
  return (
    <div className={cx('champ-banner', mine && 'mine')}>
      <span className="champ-trophy" aria-hidden><LuTrophy /></span>
      <div><small>{mine ? 'You won!' : 'Champion'}</small><strong>{champ.team_name}</strong></div>
    </div>
  );
}

function MatchCard({ m, t, entrants, userId, onReport }) {
  const a = entrants[m.entrant_a]; const b = entrants[m.entrant_b];
  const mine = [a, b].some((e) => e?.captain_id === userId);
  const canReport = t.status === 'in_progress' && ['ready', 'reported', 'disputed'].includes(m.status) && (t.am_host || t.is_moderator || (mine && m.status !== 'disputed'));
  const row = (e) => (
    <div className={cx('bm-row', m.winner && e && m.winner === e.id && 'win', m.winner && e && m.winner !== e.id && 'lose')}>
      <span className="bm-seed">{e?.seed ?? ''}</span>
      <span className="bm-name">{e ? e.team_name : m.status === 'done' && m.round === 1 ? 'Bye' : 'TBD'}</span>
      {m.winner && e && m.winner === e.id && <LuCheck aria-label="Winner" />}
    </div>
  );
  return (
    <div className={cx('bm', `st-${m.status}`, mine && 'mine')}>
      {row(a)}{row(b)}
      <div className="bm-foot">
        {m.status === 'done' ? <span>{m.score || 'Final'}</span>
          : m.status === 'reported' ? <span className="warn">Reported: {entrants[m.reported_winner]?.team_name} won — waiting for confirmation</span>
          : m.status === 'disputed' ? <span className="bad"><LuCircleAlert aria-hidden /> Disputed{m.dispute_reason ? `: ${m.dispute_reason}` : ''}</span>
          : m.status === 'ready' ? <span className="good">Ready to play</span> : <span className="muted">Waiting</span>}
        {canReport && <Button size="sm" onClick={onReport}>{m.status === 'reported' && m.reported_by !== userId && !t.am_host ? 'Confirm' : 'Report'}</Button>}
      </div>
    </div>
  );
}

function RegisterDialog({ t, onClose }) {
  const toast = useToast();
  const friends = useAsync(() => (t.team_size > 1 ? api.listFriends() : Promise.resolve(null)), []);
  const [name, setName] = useState('');
  const [mates, setMates] = useState([]);
  const [agree, setAgree] = useState(false);
  const [reading, setReading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const need = t.team_size - 1;
  const options = (friends.data?.friends || friends.data || []).filter?.((f) => f.id) ?? [];
  const submit = async () => {
    setErr(null);
    if (!agree) return setErr(new Error('Accept the Tournament Agreement to enter.'));
    setBusy(true);
    try { await api.registerTournament(t.id, name.trim(), mates, AGREEMENT_VERSION); toast("You're in!"); onClose(true); }
    catch (e) { setErr(e); setBusy(false); }
  };
  if (reading) {
    return (
      <Modal open onClose={() => setReading(false)} title="Tournament Agreement" size="lg"
        footer={<Button variant="primary" onClick={() => { setAgree(true); setReading(false); }}>I agree</Button>}>
        <AgreementText />
      </Modal>
    );
  }
  return (
    <Modal open onClose={() => onClose(false)} title={`Enter ${t.title}`}
      footer={<><Button variant="ghost" onClick={() => onClose(false)}>Cancel</Button><Button variant="primary" loading={busy} onClick={submit} disabled={!name.trim() || mates.length !== need}>Enter tournament</Button></>}>
      <div className="stack">
        <Field label={t.team_size > 1 ? 'Team name' : 'Name in the bracket'} htmlFor="r-name"><Input id="r-name" maxLength={32} value={name} onChange={(e) => setName(e.target.value)} data-autofocus /></Field>
        {need > 0 && (
          <Field label={`Teammates (${mates.length}/${need})`} hint="Pick from your friends list. They're notified and can leave the team.">
            {friends.loading ? <p className="muted small">Loading friends…</p> : options.length === 0 ? <p className="muted small">Add friends first — teammates must be on your friends list.</p> : (
              <ChipSelect ariaLabel="Teammates" options={options.map((f) => ({ value: f.id, label: f.username }))} value={mates} onChange={setMates} max={need} />
            )}
          </Field>
        )}
        <label className="agree-row">
          <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} />
          <span>I agree to the <button type="button" className="link-btn" onClick={() => setReading(true)}>Tournament Agreement</button> and the host's rules. I won't pay to enter.</span>
        </label>
        <InlineError error={err} />
      </div>
    </Modal>
  );
}

function ReportMatchDialog({ t, m, entrants, userId, onClose }) {
  const toast = useToast();
  const [winner, setWinner] = useState(m.reported_winner || null);
  const [score, setScore] = useState(m.score || '');
  const [dispute, setDispute] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const a = entrants[m.entrant_a]; const b = entrants[m.entrant_b];
  const isCaptain = [a, b].some((e) => e?.captain_id === userId);
  const submit = async () => {
    setBusy(true); setErr(null);
    try {
      if (dispute) { await api.disputeMatch(m.id, reason); toast('Dispute sent to the host'); }
      else {
        const r = await api.reportMatch(m.id, winner, score);
        toast(r === 'done' ? 'Result confirmed' : r === 'disputed' ? "Results don't match — the host will decide" : 'Result reported — waiting for the other captain');
      }
      onClose(true);
    } catch (e) { setErr(e); setBusy(false); }
  };
  return (
    <Modal open onClose={() => onClose(false)} title={dispute ? 'Dispute this match' : 'Report result'} size="sm"
      footer={<><Button variant="ghost" onClick={() => onClose(false)}>Cancel</Button>
        <Button variant={dispute ? 'danger' : 'primary'} loading={busy} disabled={dispute ? reason.trim().length < 5 : !winner} onClick={submit}>{dispute ? 'Send dispute' : 'Submit'}</Button></>}>
      {dispute ? (
        <Field label="What happened?" htmlFor="d-reason"><Textarea id="d-reason" rows={3} maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. They used a banned map, screenshots in DMs" /></Field>
      ) : (
        <div className="stack">
          {m.status === 'reported' && <p className="small">{entrants[m.reported_winner]?.team_name} was reported as the winner{m.score ? ` (${m.score})` : ''}. Pick the same team to confirm.</p>}
          <Field label="Winner">
            <Segmented ariaLabel="Winner" value={winner} onChange={setWinner} options={[a, b].filter(Boolean).map((e) => ({ value: e.id, label: e.team_name }))} />
          </Field>
          <Field label="Score" optional htmlFor="r-score"><Input id="r-score" maxLength={40} value={score} onChange={(e) => setScore(e.target.value)} placeholder="13-9 or 2-1" /></Field>
          {t.am_host && <p className="muted small">As host, your result is final.</p>}
        </div>
      )}
      {isCaptain && !t.am_host && m.status !== 'disputed' && (
        <Button variant="link" onClick={() => setDispute((d) => !d)}>{dispute ? 'Report a result instead' : 'Something went wrong? Dispute this match'}</Button>
      )}
      <InlineError error={err} />
    </Modal>
  );
}

function Results({ t, userId, onChanged }) {
  const toast = useToast();
  const placed = t.entrants.filter((e) => e.final_place).sort((x, y) => x.final_place - y.final_place);
  const act = async (e, status, msg) => { try { await api.setPrizeStatus(e.id, status); toast(msg); onChanged(); } catch (ex) { toast(ex, 'error'); } };
  const deadline = t.completed_at && t.payout_deadline_days ? new Date(new Date(t.completed_at).getTime() + t.payout_deadline_days * 86400000) : null;
  return (
    <Panel title="Results">
      <ul className="t-results">
        {placed.map((e) => {
          const onTeam = e.members.some((u) => u.id === userId);
          return (
            <li key={e.id} className={`place-${e.final_place}`}>
              <span className="t-place">{e.final_place === 1 ? <LuCrown aria-hidden /> : null}{PLACE[e.final_place]}</span>
              <span className="grow"><b>{e.team_name}</b>{e.prize_amount != null && <> · {money(t, e.prize_amount)}</>}</span>
              {e.prize_status !== 'none' && <Badge tone={e.prize_status === 'received' ? 'good' : e.prize_status === 'not_received' ? 'bad' : 'neutral'}>
                {e.prize_status === 'pending' ? 'Prize pending' : e.prize_status === 'sent' ? 'Host says sent' : e.prize_status === 'received' ? 'Prize received' : 'Reported unpaid'}</Badge>}
              {t.am_host && ['pending', 'not_received'].includes(e.prize_status) && <Button size="sm" icon={LuSend} onClick={() => act(e, 'sent', 'Marked as sent')}>Mark sent</Button>}
              {onTeam && ['pending', 'sent'].includes(e.prize_status) && (
                <>
                  <Button size="sm" variant="primary" icon={LuCheck} onClick={() => act(e, 'received', 'Thanks for confirming')}>I got it</Button>
                  <Button size="sm" variant="ghost" onClick={() => act(e, 'not_received', 'Reported to moderators')}>Not received</Button>
                </>
              )}
            </li>
          );
        })}
      </ul>
      {deadline && placed.some((e) => e.prize_status === 'pending') && <p className="muted small">The host promised payment by {deadline.toLocaleDateString()}. Completed {timeAgo(t.completed_at)}.</p>}
    </Panel>
  );
}

function ReportTournamentDialog({ t, onClose }) {
  const toast = useToast();
  const [category, setCategory] = useState('scam');
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const submit = async () => {
    setBusy(true); setErr(null);
    try { await api.reportTournament(t.id, category, text); toast('Report sent to moderators'); onClose(); }
    catch (e) { setErr(e); setBusy(false); }
  };
  return (
    <Modal open onClose={onClose} title="Report this tournament" size="sm"
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="danger" loading={busy} disabled={text.trim().length < 10} onClick={submit}>Send report</Button></>}>
      <div className="stack">
        <Field label="Reason"><Select aria-label="Reason" value={category} onChange={(v) => setCategory(v || 'scam')} options={[
          { value: 'scam', label: 'Scam or asking for money' }, { value: 'cheating', label: 'Cheating or rigged results' },
          { value: 'harassment', label: 'Harassment' }, { value: 'spam', label: 'Spam' }, { value: 'other', label: 'Something else' },
        ]} /></Field>
        <Field label="What happened?" htmlFor="rt-text" hint="At least 10 characters. Moderators see the tournament and the host."><Textarea id="rt-text" rows={4} maxLength={900} value={text} onChange={(e) => setText(e.target.value)} /></Field>
        <InlineError error={err} />
      </div>
    </Modal>
  );
}
