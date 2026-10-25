import { useEffect, useState } from 'react';
import {
  LuMic, LuZap, LuSmile, LuMegaphone, LuHandshake, LuCoffee, LuRadio, LuCheck, LuSparkles, LuTarget, LuGift, LuX,
} from 'react-icons/lu';
import * as api from '../lib/api.js';
import { useApp } from '../context/AppContext.jsx';
import { useAsync } from '../hooks/useAsync.js';
import { Link, navigate } from '../lib/router.jsx';
import { celebrate, bigCelebrate } from '../lib/confetti.js';
import { Avatar, Name } from './gaming.jsx';
import GameIcon from './GameIcon.jsx';
import { Button, Field, Input, InlineError, Modal, Panel, Segmented, Select, cx } from './ui.jsx';
import { useToast } from './feedback.jsx';
import { CountUp } from './Motion.jsx';

export const ENDORSEMENTS = [
  { kind: 'great_comms', label: 'Great comms', icon: LuMic, color: '#3ddcff' },
  { kind: 'clutch', label: 'Clutch', icon: LuZap, color: '#ffd166' },
  { kind: 'positive', label: 'Positive vibes', icon: LuSmile, color: '#6fd3a0' },
  { kind: 'shotcaller', label: 'Shotcaller', icon: LuMegaphone, color: '#ff8a3d' },
  { kind: 'teamplayer', label: 'Team player', icon: LuHandshake, color: '#b18cff' },
  { kind: 'chill', label: 'Chill', icon: LuCoffee, color: '#ff9ad5' },
];

const tier = (lvl) => (lvl >= 30 ? 'mythic' : lvl >= 20 ? 'diamond' : lvl >= 10 ? 'gold' : lvl >= 5 ? 'silver' : 'bronze');

export function LevelBadge({ level, size }) {
  if (!level) return null;
  return <span className={cx('lvl', `lvl-${tier(level)}`, size === 'lg' && 'lvl-lg')} title={`Level ${level}`}>Lv {level}</span>;
}

/** Remaining time like "1h 20m left". */
export function timeLeft(iso) {
  const ms = new Date(iso).getTime() - Date.now();
  if (ms <= 0) return 'ending';
  const m = Math.round(ms / 60000);
  return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60 ? `${m % 60}m ` : ''}left` : `${m}m left`;
}

// ---------- XP + daily quests ----------
export function ProgressPanel() {
  const toast = useToast();
  const { onNotify } = useApp();
  const res = useAsync(() => api.myProgress(), []);
  useEffect(() => onNotify(() => res.reload({ quiet: true })), [onNotify, res.reload]); // eslint-disable-line
  const p = res.data;
  useEffect(() => {
    if (!p) return;
    let last = 0;
    try { last = Number(localStorage.getItem('partyup.level') || 0); localStorage.setItem('partyup.level', String(p.level)); } catch { /* ignore */ }
    if (last && p.level > last) { bigCelebrate(); toast(`Level up! You're now level ${p.level} 🎉`); }
  }, [p?.level]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!p) return <Panel title="Your level"><div className="xp-skel" /></Panel>;
  const pct = Math.min(100, Math.round(((p.xp - p.level_floor) / Math.max(1, p.next_level_at - p.level_floor)) * 100));
  const claim = async (q) => {
    try { const xp = await api.claimQuest(q.id); toast(`Quest complete! +${xp} XP`); celebrate({ count: 90 }); res.reload({ quiet: true }); }
    catch (e) { toast(e, 'error'); }
  };
  return (
    <Panel title="Your level" action={<Link to="/leaderboard" className="small">Leaderboard</Link>}>
      <div className="xp-box">
        <div className="xp-head">
          <LevelBadge level={p.level} size="lg" />
          <div className="grow">
            <div className="xp-bar" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="Progress to next level">
              <span style={{ width: `${pct}%` }} />
            </div>
            <small className="muted"><CountUp value={p.xp} /> XP · {p.next_level_at - p.xp} to level {p.level + 1}</small>
          </div>
        </div>
        <h3 className="sub-h"><LuTarget aria-hidden /> Today's quests</h3>
        <ul className="quests">
          {p.quests.map((q) => {
            const done = q.progress >= q.target;
            return (
              <li key={q.id} className={cx(done && 'done', q.claimed && 'claimed')}>
                <span className="q-check">{q.claimed ? <LuCheck aria-hidden /> : done ? <LuGift aria-hidden /> : null}</span>
                <span className="grow"><span className="q-label">{q.label}</span>
                  <span className="q-bar"><span style={{ width: `${(q.progress / q.target) * 100}%` }} /></span></span>
                {q.claimed ? <span className="muted small">+{q.xp}</span>
                  : done ? <Button size="sm" variant="primary" onClick={() => claim(q)}>Claim +{q.xp}</Button>
                  : <span className="muted small">{q.progress}/{q.target}</span>}
              </li>
            );
          })}
        </ul>
        <p className="muted small">New quests every day at midnight UTC. XP comes from playing with people — parties, chats, calls, tournaments and endorsements.</p>
      </div>
    </Panel>
  );
}

// ---------- GG endorsements ----------
export function EndorsePicker({ user, partyId, onDone }) {
  const toast = useToast();
  const [busy, setBusy] = useState(null);
  const give = async (kind) => {
    setBusy(kind);
    try { await api.endorse(user.id, partyId, kind); toast(`GG sent to ${user.username}! +10 XP`); celebrate({ count: 50 }); onDone?.(kind); }
    catch (e) { toast(e, 'error'); setBusy(null); }
  };
  return (
    <div className="gg-picker" role="group" aria-label={`Endorse ${user.username}`}>
      {ENDORSEMENTS.map((e) => (
        <button key={e.kind} type="button" className="gg-chip" style={{ '--gg': e.color }} disabled={!!busy} onClick={() => give(e.kind)}>
          <e.icon aria-hidden />{e.label}
        </button>
      ))}
    </div>
  );
}

export function GgPanel() {
  const res = useAsync(() => api.endorsableTeammates(), []);
  const [done, setDone] = useState({});
  const list = (res.data || []).filter((t) => !done[`${t.party_id}:${t.user.id}`]);
  if (!res.data || list.length === 0) return null;
  return (
    <Panel title="GG your teammates" className="gg-panel">
      <p className="muted small" style={{ margin: '0 16px' }}>Who made your last games better? Endorsements show on their profile.</p>
      <ul className="gg-list">
        {list.slice(0, 4).map((t) => (
          <li key={`${t.party_id}:${t.user.id}`}>
            <div className="row gap-s"><Avatar user={t.user} size={30} /><div className="grow" style={{ minWidth: 0 }}><Name user={t.user} /><small className="muted ellipsis"> in {t.party_title}</small></div></div>
            <EndorsePicker user={t.user} partyId={t.party_id} onDone={() => setDone((d) => ({ ...d, [`${t.party_id}:${t.user.id}`]: true }))} />
          </li>
        ))}
      </ul>
    </Panel>
  );
}

export function EndorsementBadges({ summary }) {
  if (!summary || !summary.total) return <p className="muted small pad">No endorsements yet. Teammates can give them after playing together.</p>;
  return (
    <div className="endorse-badges">
      {ENDORSEMENTS.filter((e) => summary.by_kind[e.kind]).map((e) => (
        <span key={e.kind} className="endorse-badge" style={{ '--gg': e.color }}>
          <e.icon aria-hidden /><b>{summary.by_kind[e.kind]}</b> {e.label}
        </span>
      ))}
    </div>
  );
}

// ---------- Ready beacons ----------
export function BeaconDialog({ onClose }) {
  const { userId } = useApp();
  const toast = useToast();
  const mine = useAsync(() => api.getMyGameProfiles(userId), [userId]);
  const games = useAsync(() => api.getGames(), []);
  const [game, setGame] = useState(null);
  const [minutes, setMinutes] = useState('60');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  useEffect(() => { if (!game && mine.data?.length) setGame(mine.data[0].game_id); }, [mine.data]); // eslint-disable-line
  const options = (mine.data?.length ? mine.data.map((g) => g.game_id) : (games.data || []).map((g) => g.id))
    .map((id) => ({ value: id, label: games.data?.find((g) => g.id === id)?.name || id }));
  const go = async () => {
    setBusy(true); setErr(null);
    try { await api.setBeacon(game, Number(minutes), note); toast('Beacon lit 📡 Friends who play it were notified'); celebrate({ count: 60, colors: ['#6fd3a0', '#3ddcff', '#ffffff'] }); onClose(true); }
    catch (e) { setErr(e); setBusy(false); }
  };
  return (
    <Modal open onClose={() => onClose(false)} title="Light your Ready beacon" size="sm"
      footer={<><Button variant="ghost" onClick={() => onClose(false)}>Cancel</Button><Button variant="primary" icon={LuRadio} loading={busy} disabled={!game} onClick={go}>Go live</Button></>}>
      <div className="stack">
        <p className="muted small">Let people know you're free to play right now. You show up on the Ready Now board until the timer runs out.</p>
        <Field label="Game"><Select aria-label="Game" options={options} value={game} onChange={setGame} /></Field>
        <Field label="For how long?"><Segmented ariaLabel="Duration" value={minutes} onChange={setMinutes}
          options={[{ value: '30', label: '30m' }, { value: '60', label: '1h' }, { value: '120', label: '2h' }, { value: '240', label: '4h' }]} /></Field>
        <Field label="Note" optional htmlFor="b-note"><Input id="b-note" maxLength={80} value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. need a duo for ranked, mic on" /></Field>
        <InlineError error={err} />
      </div>
    </Modal>
  );
}

export function BeaconCard({ b }) {
  const toast = useToast();
  const message = async () => {
    try { navigate(`/messages/${await api.openDirectConversation(b.id)}`); } catch (e) { toast(e, 'error'); }
  };
  return (
    <article className="beacon-card">
      <span className="beacon-pulse" aria-hidden />
      <div className="row gap-s">
        <Avatar user={b} size={42} status={b.status} />
        <div className="grow" style={{ minWidth: 0 }}>
          <div className="row gap-s"><Link to={`/players/${b.id}`} className="mini-link"><Name user={b} /></Link><LevelBadge level={b.level} />{b.is_friend && <span className="badge badge-good">Friend</span>}</div>
          <small className="muted">{timeLeft(b.until)}{b.compatibility ? ` · ${b.compatibility.score}% fit` : ''}</small>
        </div>
        {b.game && <GameIcon game={b.game} size={34} />}
      </div>
      {b.note && <p className="beacon-note">“{b.note}”</p>}
      <div className="row gap-s">
        <Button size="sm" variant="primary" onClick={message}>Message</Button>
        <Button size="sm" onClick={() => navigate(`/players/${b.id}`)}>Profile</Button>
      </div>
    </article>
  );
}

export function ReadyNowPanel() {
  const { profile, refreshProfile, onNotify } = useApp();
  const toast = useToast();
  const res = useAsync(() => api.listBeacons(), []);
  useEffect(() => onNotify(() => res.reload({ quiet: true })), [onNotify, res.reload]); // eslint-disable-line
  const [lighting, setLighting] = useState(false);
  const live = profile.beacon_until && new Date(profile.beacon_until) > new Date();
  const stop = async () => { try { await api.clearBeacon(); await refreshProfile(); toast('Beacon off'); } catch (e) { toast(e, 'error'); } };
  return (
    <Panel id="ready-now" title={<span className="row gap-s"><span className="live-dot" aria-hidden />Ready now</span>} action={<Link to="/ready" className="small">See all</Link>}>
      <div className="ready-mini">
        {live ? (
          <div className="my-beacon"><LuRadio aria-hidden /><span className="grow">You're live · {timeLeft(profile.beacon_until)}</span>
            <Button size="sm" variant="ghost" icon={LuX} onClick={stop}>Stop</Button></div>
        ) : <Button variant="primary" icon={LuRadio} onClick={() => setLighting(true)} className="w-full">I'm ready to play</Button>}
        {(res.data || []).slice(0, 3).map((b) => (
          <Link key={b.id} to={`/players/${b.id}`} className="ready-row">
            <Avatar user={b} size={28} status={b.status} /><span className="grow ellipsis"><Name user={b} /></span>
            {b.game && <GameIcon game={b.game} size={22} />}
          </Link>
        ))}
        {res.data && res.data.length === 0 && <p className="muted small">{live ? "You're the first one live — friends who play it were pinged." : "Nobody's live yet — be the first."}</p>}
      </div>
      {lighting && <BeaconDialog onClose={(ok) => { setLighting(false); if (ok) { refreshProfile(); res.reload({ quiet: true }); } }} />}
    </Panel>
  );
}

export { LuSparkles };
