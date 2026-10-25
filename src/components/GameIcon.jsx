import {
  LuCrosshair, LuSwords, LuTarget, LuTrophy, LuBox, LuPickaxe, LuTent, LuFlame, LuCarFront, LuFlag, LuScroll, LuWandSparkles,
  LuGhost, LuSkull, LuUsers, LuPartyPopper, LuCastle, LuShield, LuRocket, LuZap, LuMountain, LuShip, LuBomb, LuHammer, LuGem,
  LuSparkles, LuDices, LuBug, LuTreePine, LuCompass, LuRadar, LuBot, LuEgg, LuCircleDot, LuVolleyball, LuDribbble, LuSword,
  LuAxe, LuMoon, LuStar, LuCrown, LuWaves, LuPalette, LuGlobe, LuHexagon, LuSnowflake, LuOrbit, LuGamepad2, LuGauge, LuCat,
} from 'react-icons/lu';

// Simple original icons for each game: the game's colour plus a symbol for what
// you do in it. These are not the publishers' logos (those are trademarks).
const BY_GAME = {
  valorant: LuCrosshair, cs2: LuBomb, 'league-of-legends': LuCastle, 'overwatch-2': LuShield, 'marvel-rivals': LuZap,
  'apex-legends': LuTarget, fortnite: LuHammer, 'rocket-league': LuCarFront, 'rainbow-six-siege': LuRadar, deadlock: LuOrbit,
  minecraft: LuPickaxe, 'call-of-duty': LuTarget, 'dota-2': LuSwords, 'teamfight-tactics': LuDices, 'mobile-legends': LuSword,
  'pokemon-unite': LuCircleDot, pubg: LuCrosshair, 'pubg-mobile': LuCrosshair, 'free-fire': LuFlame, 'halo-infinite': LuHexagon,
  'the-finals': LuSparkles, 'battlefield-6': LuMountain, 'arc-raiders': LuBot, 'escape-from-tarkov': LuCompass, 'destiny-2': LuMoon,
  warframe: LuStar, 'helldivers-2': LuRocket, 'monster-hunter-wilds': LuAxe, 'deep-rock-galactic': LuGem, 'lethal-company': LuBug,
  phasmophobia: LuGhost, 'sea-of-thieves': LuShip, 'dead-by-daylight': LuSkull, 'diablo-4': LuFlame, 'path-of-exile-2': LuScroll,
  'world-of-warcraft': LuCrown, 'final-fantasy-xiv': LuWandSparkles, 'genshin-impact': LuSnowflake, roblox: LuBox, 'among-us': LuUsers,
  rust: LuTent, valheim: LuTreePine, palworld: LuEgg, 'gta-online': LuGauge, 'street-fighter-6': LuZap, 'tekken-8': LuFlame,
  'smash-ultimate': LuStar, brawlhalla: LuSword, 'mario-kart-world': LuFlag, 'splatoon-3': LuPalette, 'ea-fc-26': LuDribbble,
  'nba-2k26': LuVolleyball, 'brawl-stars': LuStar,
};
const BY_GENRE = {
  shooter: LuCrosshair, moba: LuSwords, battle_royale: LuTarget, extraction: LuCompass, coop: LuUsers, horror: LuGhost,
  arpg: LuSword, mmo: LuGlobe, rpg: LuScroll, survival: LuTent, sandbox: LuBox, fighting: LuZap, racing: LuFlag,
  sports: LuTrophy, strategy: LuCastle, party: LuPartyPopper, open_world: LuWaves,
};

export function gameGlyph(game) {
  return BY_GAME[game?.id || game?.game_id] || BY_GENRE[game?.genre] || (game?.id === 'cat' ? LuCat : LuGamepad2);
}

export default function GameIcon({ game, size = 32, radius, className, label = true }) {
  const Glyph = gameGlyph(game);
  const color = game?.accent_color || '#6f6e77';
  return (
    <span className={`game-icon${className ? ` ${className}` : ''}`} role={label ? 'img' : undefined} aria-label={label ? game?.name : undefined}
      aria-hidden={label ? undefined : true}
      style={{ '--gc': color, width: size, height: size, borderRadius: radius ?? Math.round(size * 0.28), fontSize: size * 0.5 }}>
      <Glyph aria-hidden />
    </span>
  );
}
