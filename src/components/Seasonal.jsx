import { useEffect, useState } from 'react';
import Logo from './Logo.jsx';
import { currentSeason, getFlavorPrefs, loadingQuip, randomLine } from '../lib/flavor.js';

export function useSeason() {
  const [season, setSeason] = useState(() => currentSeason());
  useEffect(() => {
    const on = () => setSeason(currentSeason());
    window.addEventListener('partyup:flavor', on);
    return () => window.removeEventListener('partyup:flavor', on);
  }, []);
  return season;
}

/** A simple carved pumpkin. */
export function Pumpkin({ size = 40, className }) {
  return (
    <svg viewBox="0 0 64 64" width={size} height={size} className={className} aria-hidden>
      <path d="M32 14c-2-5 1-9 5-10l1 3c-3 1-4 3-3 7z" fill="#5c8a3a" />
      <ellipse cx="20" cy="37" rx="14" ry="19" fill="#e2672c" />
      <ellipse cx="44" cy="37" rx="14" ry="19" fill="#e2672c" />
      <ellipse cx="32" cy="37" rx="12" ry="20" fill="#f07a35" />
      <path d="M20 31l6 4h-8zM44 31l-6 4h8z" fill="#2a1406" />
      <path d="M21 44c4 5 18 5 22 0l-4 1-2 3-3-3-3 3-3-3-2 3z" fill="#2a1406" />
    </svg>
  );
}

function Bat({ style }) {
  return (
    <svg viewBox="0 0 40 18" className="bat" style={style} aria-hidden>
      <path d="M20 6c1-2 2-3 2-3l1 3c3-1 6-4 8-6 0 3 3 5 9 5-3 1-5 4-5 7-2-2-5-2-7 0-1-2-3-3-5-3h-6c-2 0-4 1-5 3-2-2-5-2-7 0 0-3-2-6-5-7 6 0 9-2 9-5 2 2 5 5 8 6l1-3s1 1 2 3z" fill="currentColor" />
    </svg>
  );
}

/** Decorations shown only during the Halloween season. */
export function SeasonalDecor() {
  const season = useSeason();
  if (season !== 'halloween') return null;
  return (
    <div className="season-decor" aria-hidden>
      <svg className="web" viewBox="0 0 100 100">
        <g fill="none" stroke="currentColor" strokeWidth="1">
          <path d="M0 0L100 100M0 0L50 100M0 0L100 50M0 0L20 100M0 0L100 20" />
          <path d="M18 0Q20 10 0 18M38 0Q40 22 0 38M60 0Q62 36 0 60M82 0Q84 52 0 82" />
        </g>
      </svg>
      <div className="bats">
        <Bat style={{ animationDelay: '0s', top: '12%' }} />
        <Bat style={{ animationDelay: '-7s', top: '22%', width: 22 }} />
        <Bat style={{ animationDelay: '-15s', top: '8%', width: 16 }} />
      </div>
    </div>
  );
}

/** Loading screen with a rotating tip / fact. */
export function FunLoader({ label, full }) {
  const season = useSeason();
  const showTips = getFlavorPrefs().tips;
  const [line, setLine] = useState(() => randomLine());
  const [quip] = useState(() => label || loadingQuip());
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const show = setTimeout(() => setVisible(true), 350); // quick loads stay calm
    const rotate = setInterval(() => setLine(randomLine()), 4500);
    return () => { clearTimeout(show); clearInterval(rotate); };
  }, []);
  return (
    <div className={full ? 'fun-loader full' : 'fun-loader'} role="status" aria-live="polite">
      {full && <Logo />}
      {season === 'halloween' ? <Pumpkin size={full ? 64 : 44} className="bob" /> : <span className="spinner" style={{ width: full ? 30 : 26, height: full ? 30 : 26 }} />}
      <p className="fun-loader-quip">{quip}</p>
      {showTips && visible && <p className="fun-loader-line" key={line}>{line}</p>}
    </div>
  );
}
