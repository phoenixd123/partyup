// Tiny dependency-free confetti burst for celebrations (party created, wins, etc.).
const COLORS = ['#f26b38', '#ffd166', '#3ddcff', '#ff4fd8', '#6fd3a0', '#b18cff', '#ffffff'];
const reduced = () => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

export function celebrate({ x = 0.5, y = 0.35, count = 140, spread = 70, colors } = {}) {
  if (typeof document === 'undefined' || reduced()) return;
  const canvas = document.createElement('canvas');
  canvas.className = 'confetti-canvas';
  canvas.setAttribute('aria-hidden', 'true');
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = window.innerWidth * dpr; canvas.height = window.innerHeight * dpr;
  document.body.appendChild(canvas);
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);
  const pal = colors || COLORS;
  const ox = window.innerWidth * x; const oy = window.innerHeight * y;
  const parts = Array.from({ length: count }, () => {
    const angle = (-90 + (Math.random() - 0.5) * spread * 2) * (Math.PI / 180);
    const speed = 7 + Math.random() * 9;
    return {
      x: ox, y: oy, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed,
      w: 5 + Math.random() * 6, h: 8 + Math.random() * 8, r: Math.random() * Math.PI, vr: (Math.random() - 0.5) * 0.35,
      color: pal[(Math.random() * pal.length) | 0], shape: Math.random() < 0.3 ? 'circle' : 'rect', life: 0,
    };
  });
  let frame = 0;
  const tick = () => {
    frame += 1;
    ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
    let alive = 0;
    for (const p of parts) {
      p.vy += 0.28; p.vx *= 0.985; p.vy *= 0.985; p.x += p.vx; p.y += p.vy; p.r += p.vr; p.life += 1;
      if (p.y > window.innerHeight + 40) continue;
      alive += 1;
      ctx.save();
      ctx.globalAlpha = Math.max(0, 1 - p.life / 180);
      ctx.translate(p.x, p.y); ctx.rotate(p.r);
      ctx.fillStyle = p.color;
      if (p.shape === 'circle') { ctx.beginPath(); ctx.arc(0, 0, p.w / 2, 0, Math.PI * 2); ctx.fill(); }
      else ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h * Math.abs(Math.cos(p.r * 2)) + 1);
      ctx.restore();
    }
    if (alive && frame < 260) requestAnimationFrame(tick); else canvas.remove();
  };
  requestAnimationFrame(tick);
}

/** Two bursts from the sides — for big wins. */
export function bigCelebrate() {
  celebrate({ x: 0.15, y: 0.6, spread: 45, count: 120 });
  setTimeout(() => celebrate({ x: 0.85, y: 0.6, spread: 45, count: 120 }), 180);
  setTimeout(() => celebrate({ x: 0.5, y: 0.4, spread: 90, count: 160 }), 420);
}
