export function LogoMark({ size = 24 }) {
  return (
    <svg viewBox="0 0 64 64" width={size} height={size} aria-hidden style={{ overflow: 'visible' }}>
      {/* pumpkin stem + leaf, shown only during Halloween (see .season-halloween) */}
      <g className="logo-mark-stem"><path d="M30 2c0-6 3-9 8-10l2 4c-4 1-5 3-5 6z" fill="#5c8a3a" /><path d="M38 0c6-4 12-3 14 1-5 2-9 2-14-1z" fill="#76a84a" /></g>
      <rect width="64" height="64" rx="14" fill="#f26b38" />
      <path d="M21 49V15h12.5a10.5 10.5 0 0 1 0 21H21" fill="none" stroke="#fff" strokeWidth="7" strokeLinejoin="round" />
      <rect x="38" y="41" width="8" height="8" rx="1.5" fill="#fff" />
    </svg>
  );
}

export default function Logo({ small }) {
  return (
    <span className={`logo${small ? ' logo-sm' : ''}`}>
      <LogoMark size={small ? 22 : 26} />
      <span className="logo-word">PartyUp</span>
    </span>
  );
}
