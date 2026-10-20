import { useState } from 'react';

// Safe, tiny message formatter: ```code blocks```, `inline code`, **bold**, *italic*,
// ~~strike~~, ||spoilers||, links and @mentions. Never uses innerHTML.
const INLINE = /(`[^`\n]+`)|(\*\*[^*\n]+\*\*)|(~~[^~\n]+~~)|(\|\|[^|\n]+\|\|)|(\*[^*\n]+\*|_[^_\n]+_)|(https?:\/\/[^\s<>()]+[^\s<>().,!?;:'"])|(@[A-Za-z0-9_]{3,20})/g;

function Spoiler({ children }) {
  const [open, setOpen] = useState(false);
  return <span className={`spoiler${open ? ' open' : ''}`} role="button" tabIndex={0} aria-label={open ? undefined : 'Spoiler, click to reveal'}
    onClick={() => setOpen(true)} onKeyDown={(e) => { if (e.key === 'Enter') setOpen(true); }}>{children}</span>;
}

function inline(text, keyBase, me) {
  const out = [];
  let last = 0; let m; let i = 0;
  INLINE.lastIndex = 0;
  while ((m = INLINE.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const k = `${keyBase}-${i++}`;
    const [tok] = m;
    if (m[1]) out.push(<code key={k}>{tok.slice(1, -1)}</code>);
    else if (m[2]) out.push(<strong key={k}>{tok.slice(2, -2)}</strong>);
    else if (m[3]) out.push(<s key={k}>{tok.slice(2, -2)}</s>);
    else if (m[4]) out.push(<Spoiler key={k}>{tok.slice(2, -2)}</Spoiler>);
    else if (m[5]) out.push(<em key={k}>{tok.slice(1, -1)}</em>);
    else if (m[6]) out.push(<a key={k} href={tok} target="_blank" rel="noopener noreferrer nofollow">{tok}</a>);
    else if (m[7]) out.push(<span key={k} className={`mention-tag${me && tok.slice(1).toLowerCase() === me.toLowerCase() ? ' me' : ''}`}>{tok}</span>);
    last = m.index + tok.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export function renderMessage(body, me) {
  if (!body) return null;
  const parts = body.split(/```/);
  return parts.map((p, idx) => (idx % 2 === 1
    ? <pre key={`c${idx}`}>{p.replace(/^\w*\n/, '').replace(/\n$/, '')}</pre>
    : <span key={`t${idx}`}>{inline(p, `t${idx}`, me)}</span>));
}
