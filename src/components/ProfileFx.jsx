// Profile customization visuals: banners, theme colours and animated effects.
export const BANNER_PRESETS = [
  { id: 'preset:1', name: 'Ember', css: 'linear-gradient(120deg, #f26b38, #b3245b)' },
  { id: 'preset:2', name: 'Deep sea', css: 'linear-gradient(120deg, #0b3d91, #19a7a7)' },
  { id: 'preset:3', name: 'Aurora', css: 'linear-gradient(120deg, #1d976c, #6a3dd6)' },
  { id: 'preset:4', name: 'Synthwave', css: 'linear-gradient(120deg, #ff3cac, #784ba0 50%, #2b86c5)' },
  { id: 'preset:5', name: 'Gold rush', css: 'linear-gradient(120deg, #f7b733, #8a5a00)' },
  { id: 'preset:6', name: 'Night grid', css: 'repeating-linear-gradient(90deg, rgba(110,168,255,.25) 0 1px, transparent 1px 24px), repeating-linear-gradient(0deg, rgba(110,168,255,.25) 0 1px, transparent 1px 24px), linear-gradient(#0d1020, #1b1f3a)' },
  { id: 'preset:7', name: 'Pumpkin patch', css: 'radial-gradient(circle at 20% 120%, #f26b38 0 30%, transparent 31%), radial-gradient(circle at 75% 130%, #e2672c 0 28%, transparent 29%), linear-gradient(#2a1240, #120a1c)' },
  { id: 'preset:8', name: 'Slime', css: 'linear-gradient(120deg, #a8ff78, #2f8f3d)' },
];

export const NAME_STYLES = [
  { value: 'plain', label: 'Plain' }, { value: 'sunset', label: 'Sunset' }, { value: 'ocean', label: 'Ocean' },
  { value: 'toxic', label: 'Toxic' }, { value: 'royal', label: 'Royal' }, { value: 'candy', label: 'Candy' },
  { value: 'gold', label: 'Gold' }, { value: 'glow', label: 'Glow' }, { value: 'spooky', label: 'Spooky' },
];
export const DECORATIONS = [
  { value: 'none', label: 'None' }, { value: 'pulse', label: 'Pulse' }, { value: 'orbit', label: 'Orbit' },
  { value: 'flames', label: 'Flames' }, { value: 'sparkle', label: 'Sparkle' }, { value: 'neon', label: 'Neon ring' },
  { value: 'crown', label: 'Crown' }, { value: 'halo', label: 'Halo' }, { value: 'pumpkin', label: 'Pumpkin' }, { value: 'bats', label: 'Bats' },
];
export const EFFECTS = [
  { value: 'none', label: 'None' }, { value: 'sparkles', label: 'Sparkles' }, { value: 'snow', label: 'Snow' },
  { value: 'embers', label: 'Embers' }, { value: 'stars', label: 'Stars' }, { value: 'confetti', label: 'Confetti' }, { value: 'bats', label: 'Bats' },
];

export function bannerBackground(user) {
  const b = user?.banner_url;
  if (b?.startsWith('preset:')) return BANNER_PRESETS.find((p) => p.id === b)?.css || BANNER_PRESETS[0].css;
  if (b) return `center / cover no-repeat url("${b.replace(/"/g, '%22')}")`;
  if (user?.theme_color) return `linear-gradient(120deg, ${user.theme_color}, ${user.theme_color_2 || user.theme_color})`;
  return '#2a2c31';
}

/** Theme colours as CSS variables for a profile surface. */
export function themeVars(user) {
  if (!user?.theme_color) return undefined;
  return { '--pt1': user.theme_color, '--pt2': user.theme_color_2 || user.theme_color };
}

const PARTICLES = 14;
export function ProfileEffect({ effect }) {
  if (!effect || effect === 'none') return null;
  if (typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return null;
  return (
    <span className={`profile-fx fx-${effect}`} aria-hidden>
      {Array.from({ length: PARTICLES }, (_, i) => (
        <i key={i} style={{ left: `${(i * 71) % 100}%`, animationDelay: `${-(i * 0.73) % 6}s`, animationDuration: `${4 + (i % 5)}s` }} />
      ))}
    </span>
  );
}
