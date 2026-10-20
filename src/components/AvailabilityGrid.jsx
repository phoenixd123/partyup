import { useMemo, useRef, useState } from 'react';
import { DAYS, BLOCKS, slotsToBlocks, blocksToSlots, localTimeZone } from '../lib/availability.js';
import { cx, Button } from './ui.jsx';

/**
 * Weekly schedule in the viewer's local time. Editable (drag to paint) or read-only.
 * `value` / `onChange` use UTC hour-of-week slots. `compare` highlights overlap.
 */
export default function AvailabilityGrid({ value, onChange, readOnly, compare }) {
  const keys = useMemo(() => slotsToBlocks(value), [value]);
  const other = useMemo(() => (compare ? slotsToBlocks(compare) : null), [compare]);
  const painting = useRef(null);
  const [, force] = useState(0);

  const apply = (key, on) => {
    const next = new Set(keys);
    if (on) next.add(key); else next.delete(key);
    onChange(blocksToSlots(next));
  };
  const down = (key) => { if (readOnly) return; painting.current = !keys.has(key); apply(key, painting.current); force((n) => n + 1); };
  const enter = (key) => { if (readOnly || painting.current === null) return; if (keys.has(key) !== painting.current) apply(key, painting.current); };
  const up = () => { painting.current = null; };
  const preset = (fn) => {
    const next = new Set();
    DAYS.forEach((_, d) => BLOCKS.forEach((_, b) => { if (fn(d, b)) next.add(`${d}:${b}`); }));
    onChange(blocksToSlots(next));
  };

  return (
    <div className="avail" onMouseUp={up} onMouseLeave={up}>
      <div className="avail-grid" role="grid" aria-label="Weekly availability" style={{ '--cols': BLOCKS.length }}>
        <span />
        {BLOCKS.map((b) => <span key={b.start} className="avail-col" role="columnheader"><span>{b.label}</span><small>{b.range}</small></span>)}
        {DAYS.map((day, d) => (
          <div key={day} className="avail-row" role="row">
            <span className="avail-day" role="rowheader">{day}</span>
            {BLOCKS.map((b, bi) => {
              const k = `${d}:${bi}`;
              const on = keys.has(k);
              const shared = other && on && other.has(k);
              const theirs = other && !on && other.has(k);
              return (
                <button key={k} type="button" role="gridcell" aria-pressed={on}
                  aria-label={`${day} ${b.label}${on ? ', available' : ''}${shared ? ', overlaps' : ''}`}
                  className={cx('avail-cell', on && 'on', shared && 'shared', theirs && 'theirs', readOnly && 'ro')}
                  onMouseDown={(e) => { e.preventDefault(); down(k); }} onMouseEnter={() => enter(k)}
                  onKeyDown={(e) => { if (!readOnly && (e.key === ' ' || e.key === 'Enter')) { e.preventDefault(); apply(k, !on); } }}
                  tabIndex={readOnly ? -1 : 0} />
              );
            })}
          </div>
        ))}
      </div>
      <div className="avail-foot">
        <span className="muted small">Times shown in your time zone{localTimeZone() ? ` (${localTimeZone()})` : ''}. {readOnly ? '' : 'Click or drag to paint.'}</span>
        {other && <span className="legend"><span className="lg lg-shared" /> Both free <span className="lg lg-on" /> Only them <span className="lg lg-cmp" /> Only you</span>}
        {!readOnly && (
          <span className="avail-presets">
            <Button size="sm" variant="ghost" onClick={() => preset((d, b) => d < 5 && b >= 4)}>Weeknights</Button>
            <Button size="sm" variant="ghost" onClick={() => preset((d, b) => d >= 5 && b >= 3)}>Weekends</Button>
            <Button size="sm" variant="ghost" onClick={() => onChange([])}>Clear</Button>
          </span>
        )}
      </div>
    </div>
  );
}
