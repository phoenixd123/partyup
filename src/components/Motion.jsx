import { useEffect, useRef, useState } from 'react';

const reduced = () => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

/** Number that counts up when it first appears or changes. */
export function CountUp({ value = 0, duration = 900 }) {
  const [shown, setShown] = useState(reduced() ? value : 0);
  const from = useRef(0);
  useEffect(() => {
    if (reduced()) { setShown(value); return undefined; }
    const start = performance.now(); const a = from.current; const b = Number(value) || 0;
    let raf;
    const step = (t) => {
      const k = Math.min(1, (t - start) / duration);
      const eased = 1 - (1 - k) ** 3;
      setShown(Math.round(a + (b - a) * eased));
      if (k < 1) raf = requestAnimationFrame(step); else from.current = b;
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [value, duration]);
  return <span className="count-up">{shown.toLocaleString()}</span>;
}

/** Radar sweep shown while Quick Match is searching. */
export function Radar({ label = 'Scanning for teammates…', blips = 5 }) {
  return (
    <div className="radar-wrap" role="status" aria-live="polite">
      <div className="radar" aria-hidden>
        <span className="radar-ring r1" /><span className="radar-ring r2" /><span className="radar-ring r3" />
        <span className="radar-sweep" />
        {Array.from({ length: blips }, (_, i) => (
          <span key={i} className="radar-blip" style={{ '--a': `${i * 73 + 20}deg`, '--d': `${30 + ((i * 17) % 55)}%`, animationDelay: `${i * 0.4}s` }} />
        ))}
      </div>
      <p>{label}</p>
    </div>
  );
}
