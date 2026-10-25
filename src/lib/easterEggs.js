import { useEffect } from 'react';
import { bigCelebrate } from './confetti.js';

const CODE = ['ArrowUp', 'ArrowUp', 'ArrowDown', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ArrowLeft', 'ArrowRight', 'b', 'a'];

/** ↑↑↓↓←→←→BA — a little secret. */
export function useKonami() {
  useEffect(() => {
    let i = 0;
    const on = (e) => {
      if (e.target?.closest?.('input, textarea, [contenteditable]')) return;
      i = e.key === CODE[i] || e.key.toLowerCase() === CODE[i] ? i + 1 : (e.key === CODE[0] ? 1 : 0);
      if (i === CODE.length) {
        i = 0;
        bigCelebrate();
        document.body.classList.add('konami');
        setTimeout(() => document.body.classList.remove('konami'), 4000);
      }
    };
    window.addEventListener('keydown', on);
    return () => window.removeEventListener('keydown', on);
  }, []);
}
