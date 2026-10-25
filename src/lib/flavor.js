// Personality: loading-screen tips, gaming trivia, greetings and seasonal themes.
// Facts are kept to well-documented gaming history.

const PREFS_KEY = 'partyup.flavor';

function readPrefs() {
  try { return JSON.parse(localStorage.getItem(PREFS_KEY) || '{}') || {}; } catch { return {}; }
}
export function getFlavorPrefs() {
  const p = readPrefs();
  return { seasonal: p.seasonal !== false, tips: p.tips !== false };
}
export function setFlavorPref(key, value) {
  const p = { ...readPrefs(), [key]: value };
  try { localStorage.setItem(PREFS_KEY, JSON.stringify(p)); } catch { /* private mode */ }
  applySeason();
  window.dispatchEvent(new Event('partyup:flavor'));
}

/** 'halloween' from Oct 1 to Nov 1 (local time), unless the user turned decorations off. */
export function currentSeason(date = new Date()) {
  const forced = typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('season');
  if (forced) return forced === 'none' ? null : forced;
  if (!getFlavorPrefs().seasonal) return null;
  const m = date.getMonth(); const d = date.getDate();
  if (m === 9 || (m === 10 && d === 1)) return 'halloween';
  return null;
}

export function applySeason() {
  if (typeof document === 'undefined') return;
  const s = currentSeason();
  document.body.classList.toggle('season-halloween', s === 'halloween');
}

export const TIPS = [
  'Tip: Quick Match explains exactly why it found nobody — and what to loosen.',
  'Tip: press ↑ in an empty message box to edit your last message.',
  'Tip: wrap text in ||double bars|| to hide spoilers.',
  'Tip: set your playtimes so matches line up with when you are actually online.',
  'Tip: your rank only counts for the game it belongs to — add a profile per game.',
  'Tip: @mention someone in a community channel to ping them.',
  'Tip: blocked players can’t see you, message you or join your parties.',
  'Tip: hide your rank or region any time in Settings → Privacy.',
  'Tip: invite links can expire or be limited to a number of uses.',
  'Tip: a party leader can hand the crown to someone else before leaving.',
  'Tip: mute a noisy chat without leaving it.',
  'Tip: custom statuses show up on your profile card.',
];

export const FACTS = [
  'Fun fact: Tetris was created in 1984 by Alexey Pajitnov in Moscow.',
  'Fun fact: Pac-Man was first released in Japan as “Puck Man”.',
  'Fun fact: Pac-Man’s ghosts are Blinky, Pinky, Inky and Clyde.',
  'Fun fact: Counter-Strike started in 1999 as a mod for Half-Life.',
  'Fun fact: Dota began as a custom map for Warcraft III.',
  'Fun fact: Rocket League’s predecessor was “Supersonic Acrobatic Rocket-Powered Battle-Cars” (2008).',
  'Fun fact: Minecraft is the best-selling video game of all time.',
  'Fun fact: one of the first video game tournaments was held at Stanford in 1972, for Spacewar!',
  'Fun fact: Space Invaders came out in 1978.',
  'Fun fact: the Game Boy launched in 1989.',
  'Fun fact: League of Legends launched in 2009.',
  'Fun fact: Among Us came out in 2018 and blew up two years later.',
];

export const SPOOKY = [
  'Spooky fact: the first jack-o’-lanterns were carved from turnips and potatoes in Ireland.',
  'Spooky tip: Phasmophobia, Lethal Company and Dead by Daylight parties fill up fast this month.',
  'Spooky fact: Pac-Man’s ghosts each chase you in a different way.',
  'Spooky tip: a full party is the best protection against things that go bump in the night.',
  'Spooky fact: “Halloween” comes from “All Hallows’ Eve”, the night before All Saints’ Day.',
  'Spooky tip: never split the party. Never.',
  'Spooky fact: black cats are considered good luck in Scotland and Japan.',
];

const LOADING_QUIPS = [
  'Warming up the lobby…', 'Finding your squad…', 'Polishing the controllers…', 'Queueing up…',
  'Respawning…', 'Loading the next round…', 'Checking who’s online…',
];
const SPOOKY_QUIPS = ['Summoning your squad…', 'Carving pumpkins…', 'Waking the ghosts…', 'Brewing something…'];

const pick = (list) => list[Math.floor(Math.random() * list.length)];

/** One line for a loading screen or a "did you know" card. */
export function randomLine() {
  const pool = currentSeason() === 'halloween' ? [...TIPS, ...FACTS, ...SPOOKY, ...SPOOKY] : [...TIPS, ...FACTS];
  return pick(pool);
}
export function loadingQuip() {
  return pick(currentSeason() === 'halloween' ? [...SPOOKY_QUIPS, ...LOADING_QUIPS] : LOADING_QUIPS);
}

export function greeting(name, date = new Date()) {
  const h = date.getHours();
  if (currentSeason() === 'halloween') {
    return pick([`Happy haunting, ${name}`, `Trick or treat, ${name}?`, `Boo! Welcome back, ${name}`]);
  }
  if (h < 5) return pick([`Still up, ${name}?`, `Late-night grind, ${name}?`]);
  if (h < 12) return pick([`Morning, ${name}`, `Rise and queue, ${name}`]);
  if (h < 18) return pick([`Afternoon, ${name}`, `Ready to queue, ${name}?`]);
  return pick([`Evening, ${name}`, `Prime time, ${name}`, `Ready to queue, ${name}?`]);
}

export function heroLine() {
  if (currentSeason() === 'halloween') return 'Spooky season is here. Round up a squad for a horror night — or start a party and let the brave ones find you.';
  return pick([
    'Find people who fit your game, rank and schedule — or start a party and let them find you.',
    'No more solo queue roulette. Find teammates who actually fit.',
    'Your next duo is probably online right now.',
  ]);
}
