// Availability is stored as UTC hour-of-week numbers (0 = Monday 00:00 UTC … 167).
// The UI works in the viewer's local time with 4-hour blocks, so two players in
// different time zones are compared on the same clock.

export const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
export const BLOCKS = [
  { start: 0, label: 'Late night', short: 'Late', range: '12–4am' },
  { start: 4, label: 'Early', short: 'Early', range: '4–8am' },
  { start: 8, label: 'Morning', short: 'Morn', range: '8am–12' },
  { start: 12, label: 'Afternoon', short: 'Aftn', range: '12–4pm' },
  { start: 16, label: 'Evening', short: 'Eve', range: '4–8pm' },
  { start: 20, label: 'Night', short: 'Night', range: '8pm–12' },
];

export const localOffsetHours = () => -new Date().getTimezoneOffset() / 60;
export const localTimeZone = () => {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone; } catch { return null; }
};

const mod = (n, m) => ((n % m) + m) % m;

export function localToUtcHour(day, hour, offset = localOffsetHours()) {
  return mod(Math.floor(day * 24 + hour - offset), 168);
}

/** Set of "day:block" keys → sorted UTC hour array */
export function blocksToSlots(keys, offset = localOffsetHours()) {
  const out = new Set();
  for (const key of keys) {
    const [d, b] = key.split(':').map(Number);
    for (let h = 0; h < 4; h++) out.add(localToUtcHour(d, BLOCKS[b].start + h, offset));
  }
  return [...out].sort((a, b) => a - b);
}

/** UTC hour array → Set of "day:block" keys in local time (block counts if ≥2 of its hours are set) */
export function slotsToBlocks(slots, offset = localOffsetHours()) {
  const have = new Set(slots || []);
  const keys = new Set();
  DAYS.forEach((_, d) => {
    BLOCKS.forEach((blk, b) => {
      let n = 0;
      for (let h = 0; h < 4; h++) if (have.has(localToUtcHour(d, blk.start + h, offset))) n++;
      if (n >= 2) keys.add(`${d}:${b}`);
    });
  });
  return keys;
}

export const hoursPerWeek = (slots) => (slots ? slots.length : 0);
