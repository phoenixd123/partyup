import { useState } from 'react';
import { LuMic, LuMicOff, LuMessageSquareText, LuInfo, LuMonitor, LuGamepad2, LuSmartphone } from 'react-icons/lu';
import { cx, Modal } from './ui.jsx';
import { platformLabel } from '../lib/constants.js';
import { presence } from '../lib/format.js';

// ---------- Avatar ----------
const PRESETS = [
  ['#c2552f', 'hex'], ['#2f6fd6', 'bolt'], ['#8a3fbf', 'ring'], ['#2e8a5f', 'tri'],
  ['#b8862b', 'diamond'], ['#4d5bd1', 'chevron'], ['#1f8a99', 'cross'], ['#a8325e', 'hex'],
  ['#55606e', 'tri'], ['#c4472f', 'bolt'], ['#3b7d3b', 'diamond'], ['#6a4fb3', 'ring'],
];
const GLYPH = {
  hex: <path d="M32 16l13.9 8v16L32 48l-13.9-8V24z" fill="none" stroke="#fff" strokeWidth="4" strokeLinejoin="round" />,
  bolt: <path d="M35 13L21 35h10l-3 16 15-23H33z" fill="#fff" />,
  ring: <><circle cx="32" cy="32" r="13" fill="none" stroke="#fff" strokeWidth="4" /><circle cx="32" cy="32" r="4" fill="#fff" /></>,
  tri: <path d="M32 17l15 27H17z" fill="none" stroke="#fff" strokeWidth="4" strokeLinejoin="round" />,
  diamond: <path d="M32 15l15 17-15 17-15-17z" fill="#fff" />,
  chevron: <path d="M19 25l13 9 13-9M19 35l13 9 13-9" fill="none" stroke="#fff" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />,
  cross: <path d="M27 18h10v9h9v10h-9v9H27v-9h-9V27h9z" fill="#fff" />,
};
const INITIAL_COLORS = ['#c2552f', '#2f6fd6', '#8a3fbf', '#2e8a5f', '#b8862b', '#4d5bd1', '#1f8a99', '#a8325e', '#55606e'];

function hash(s = '') { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return Math.abs(h); }

export function Avatar({ user, size = 40, status, className }) {
  const url = user?.avatar_url;
  const name = user?.username || '?';
  let inner;
  if (url?.startsWith('preset:')) {
    const [bg, glyph] = PRESETS[(parseInt(url.slice(7), 10) - 1) % PRESETS.length] || PRESETS[0];
    inner = (
      <svg viewBox="0 0 64 64" aria-hidden>
        <rect width="64" height="64" fill={bg} />{GLYPH[glyph]}
      </svg>
    );
  } else if (url) {
    inner = <img src={url} alt="" loading="lazy" referrerPolicy="no-referrer" />;
  } else {
    const bg = INITIAL_COLORS[hash(name) % INITIAL_COLORS.length];
    inner = <span className="avatar-initials" style={{ background: bg, fontSize: size * 0.4 }}>{name.slice(0, 1).toUpperCase()}</span>;
  }
  return (
    <span className={cx('avatar', className)} style={{ width: size, height: size }} role="img" aria-label={name}>
      {inner}
      {status && <StatusDot status={status} className="avatar-dot" />}
    </span>
  );
}

export function StatusDot({ status = 'offline', className }) {
  return <span className={cx('status-dot', `st-${status}`, className)} aria-label={status} title={status[0].toUpperCase() + status.slice(1)} />;
}

export function Presence({ user }) {
  return <span className={cx('presence', `pr-${user.status || 'offline'}`)}>{presence(user.status, user.last_active_at)}</span>;
}

// ---------- Game tag ----------
export function GameTag({ game, rank, role, compact }) {
  const color = game.accent_color || '#8b5cf6';
  return (
    <span className={cx('game-tag', compact && 'compact')} style={{ '--gc': color }}>
      <span className="game-mark">{game.short_name || game.name?.slice(0, 3)}</span>
      {!compact && <span className="game-name">{game.name}</span>}
      {rank && <span className="game-rank" title="Self-reported rank">{rank}</span>}
      {role && <span className="game-role">{role}</span>}
    </span>
  );
}

export function PlatformIcon({ platform }) {
  const I = platform === 'pc' ? LuMonitor : platform === 'mobile' ? LuSmartphone : LuGamepad2;
  return <span className="plat" title={platformLabel(platform)}><I aria-hidden /><span>{platformLabel(platform)}</span></span>;
}

export function MicLabel({ mic }) {
  if (!mic) return null;
  const I = mic === 'text_only' ? LuMessageSquareText : mic === 'sometimes' ? LuMicOff : LuMic;
  const text = { always: 'Mic on', usually: 'Mostly mic', sometimes: 'Mic sometimes', text_only: 'Text only' }[mic];
  return <span className="mic"><I aria-hidden />{text}</span>;
}

// ---------- Compatibility: signal meter ----------
export function scoreTone(score) {
  if (score >= 80) return 'great';
  if (score >= 65) return 'good';
  if (score >= 50) return 'fair';
  return 'low';
}

export function SignalMeter({ score, size = 'md', showLabel = true, label }) {
  if (score === null || score === undefined) return null;
  const filled = Math.max(1, Math.ceil(score / 20));
  return (
    <span className={cx('signal', `signal-${size}`, `tone-${scoreTone(score)}`)} title={`${label || 'Compatibility'} estimate: ${score}/100`}>
      <span className="signal-bars" aria-hidden>
        {[1, 2, 3, 4, 5].map((i) => <span key={i} className={cx('bar', i <= filled && 'on')} style={{ height: `${30 + i * 14}%` }} />)}
      </span>
      <span className="signal-num">{score}</span>
      {showLabel && <span className="sr-only">{label || 'compatibility'} out of 100</span>}
    </span>
  );
}

export function CompatBreakdown({ compat, title = 'Why this score' }) {
  if (!compat) return null;
  return (
    <div className="breakdown">
      <div className="breakdown-head">
        <SignalMeter score={compat.score} size="lg" />
        <div>
          <strong>{compat.label}</strong>
          <p className="muted small">{title}. An estimate from profile details — not a guarantee you'll play well together.</p>
        </div>
      </div>
      <ul className="factor-list">
        {compat.factors.map((f) => (
          <li key={f.key} className="factor">
            <div className="factor-top">
              <span>{f.label}</span>
              <span className="factor-pts">{Math.round(f.points)}<span className="muted">/{f.weight}</span></span>
            </div>
            <div className="factor-bar"><span style={{ width: `${(f.points / f.weight) * 100}%` }} /></div>
            <span className="factor-detail">{f.detail}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Score + button that opens the breakdown in a dialog */
export function CompatButton({ compat, label = 'Compatibility' }) {
  const [open, setOpen] = useState(false);
  if (!compat) return null;
  return (
    <>
      <button type="button" className="compat-btn" onClick={(e) => { e.preventDefault(); e.stopPropagation(); setOpen(true); }}
        aria-label={`${label} ${compat.score} out of 100, show breakdown`}>
        <SignalMeter score={compat.score} showLabel={false} />
        <LuInfo aria-hidden className="compat-info" />
      </button>
      <Modal open={open} onClose={() => setOpen(false)} title={label} size="sm">
        <CompatBreakdown compat={compat} />
        <MatchingWeights />
      </Modal>
    </>
  );
}

export function MatchingWeights() {
  return (
    <details className="weights">
      <summary>How matching works</summary>
      <p>Each factor has a weight. We add up the points you share and divide by the weights that apply, so missing info counts as neutral instead of zero.</p>
      <ul>
        <li><b>Shared game</b> 15, <b>Playtime overlap</b> 15, <b>Language</b> 12, <b>Role fit</b> 12</li>
        <li><b>Rank</b> 0–20, set per game (e.g. Valorant 20, Fortnite 8, Minecraft 0)</li>
        <li><b>Platform</b> 10, <b>Region</b> 10, <b>Playstyle</b> 10, <b>Voice chat</b> 8</li>
      </ul>
      <p>Ranks are self-reported and never verified. Hidden profile details are treated as unknown.</p>
    </details>
  );
}

export function Pips({ filled, total }) {
  return (
    <span className="pips" aria-label={`${filled} of ${total} slots filled`}>
      {Array.from({ length: total }, (_, i) => <span key={i} className={cx('pip', i < filled && 'on')} />)}
    </span>
  );
}

export function PartyStatus({ status }) {
  const label = { open: 'Open', full: 'Full', closed: 'Closed' }[status] || status;
  return <span className={cx('party-status', `ps-${status}`)}>{label}</span>;
}
