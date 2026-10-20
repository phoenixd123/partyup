// Option lists shared by forms and filters. Values must match the CHECK
// constraints in supabase/schema.sql.

export const REGIONS = [
  { value: 'na-east', label: 'North America East' },
  { value: 'na-central', label: 'North America Central' },
  { value: 'na-west', label: 'North America West' },
  { value: 'sa', label: 'South America' },
  { value: 'eu-west', label: 'Europe West' },
  { value: 'eu-central', label: 'Europe Central' },
  { value: 'eu-east', label: 'Europe East' },
  { value: 'me', label: 'Middle East' },
  { value: 'af', label: 'Africa' },
  { value: 'asia-east', label: 'East Asia' },
  { value: 'asia-se', label: 'Southeast Asia' },
  { value: 'asia-south', label: 'South Asia' },
  { value: 'oce', label: 'Oceania' },
];

export const LANGUAGES = [
  ['en', 'English'], ['es', 'Spanish'], ['pt', 'Portuguese'], ['fr', 'French'], ['de', 'German'],
  ['it', 'Italian'], ['nl', 'Dutch'], ['pl', 'Polish'], ['sv', 'Swedish'], ['ru', 'Russian'],
  ['uk', 'Ukrainian'], ['tr', 'Turkish'], ['ar', 'Arabic'], ['hi', 'Hindi'], ['ja', 'Japanese'],
  ['ko', 'Korean'], ['zh', 'Chinese'], ['tl', 'Filipino'], ['vi', 'Vietnamese'], ['id', 'Indonesian'], ['th', 'Thai'],
].map(([value, label]) => ({ value, label }));

export const PLATFORMS = [
  { value: 'pc', label: 'PC' },
  { value: 'playstation', label: 'PlayStation' },
  { value: 'xbox', label: 'Xbox' },
  { value: 'switch', label: 'Switch' },
  { value: 'mobile', label: 'Mobile' },
];

export const MIC_OPTIONS = [
  { value: 'always', label: 'Always on mic' },
  { value: 'usually', label: 'Usually on mic' },
  { value: 'sometimes', label: 'Mic sometimes' },
  { value: 'text_only', label: 'Text chat only' },
];

export const PLAYSTYLES = [
  { value: 'chill', label: 'Chill' },
  { value: 'competitive', label: 'Competitive' },
  { value: 'strategic', label: 'Strategic' },
  { value: 'aggressive', label: 'Aggressive' },
  { value: 'supportive', label: 'Supportive' },
  { value: 'shotcaller', label: 'Shotcaller' },
  { value: 'communicative', label: 'Talkative' },
  { value: 'flexible', label: 'Flexible' },
  { value: 'learning', label: 'Still learning' },
  { value: 'grinder', label: 'Grinder' },
];

export const TEAMMATE_TRAITS = [
  { value: 'has_mic', label: 'Uses a mic' },
  { value: 'good_comms', label: 'Clear callouts' },
  { value: 'positive', label: 'Stays positive' },
  { value: 'patient', label: 'Patient' },
  { value: 'competitive', label: 'Plays to win' },
  { value: 'chill', label: 'Keeps it chill' },
  { value: 'shotcaller', label: 'Makes the calls' },
  { value: 'follows_calls', label: 'Follows calls' },
  { value: 'consistent_schedule', label: 'Regular schedule' },
  { value: 'beginner_friendly', label: 'Beginner friendly' },
];

export const TEAMMATE_MIC = [
  { value: 'any', label: "Doesn't matter" },
  { value: 'preferred', label: 'Prefer teammates on mic' },
  { value: 'required', label: 'Teammates must use a mic' },
];

export const LOOKING_FOR = [
  { value: 'casual', label: 'Casual' },
  { value: 'competitive', label: 'Competitive' },
  { value: 'both', label: 'Either' },
];

export const EXPERIENCE = [
  { value: 'new', label: 'New to the game' },
  { value: 'casual', label: 'Casual player' },
  { value: 'ranked', label: 'Plays ranked regularly' },
  { value: 'tournament', label: 'Plays tournaments / scrims' },
  { value: 'semi_pro', label: 'Semi-pro' },
];

export const SESSION_LENGTHS = [
  { value: 'under_1h', label: 'Under an hour' },
  { value: '1_2h', label: '1–2 hours' },
  { value: '2_4h', label: '2–4 hours' },
  { value: '4h_plus', label: '4+ hours' },
];

export const STATUSES = [
  { value: 'online', label: 'Online', hint: 'Shown as online' },
  { value: 'away', label: 'Away', hint: 'Shown as away' },
  { value: 'busy', label: 'Busy', hint: 'Shown as busy' },
  { value: 'invisible', label: 'Invisible', hint: 'Appear offline to everyone' },
];

export const REPORT_CATEGORIES = [
  { value: 'harassment', label: 'Harassment or hate', hint: 'Insults, threats, slurs, targeted abuse' },
  { value: 'cheating', label: 'Cheating', hint: 'Suspected cheats, boosting or exploits' },
  { value: 'spam', label: 'Spam or scams', hint: 'Advertising, repeated messages, phishing links' },
  { value: 'inappropriate_profile', label: 'Inappropriate profile', hint: 'Offensive name, picture or bio' },
  { value: 'suspicious', label: 'Suspicious behavior', hint: 'Impersonation, account selling, grooming concerns' },
  { value: 'other', label: 'Something else', hint: '' },
];

export const label = (list, value) => list.find((o) => o.value === value)?.label ?? value;
export const regionLabel = (v) => (v ? label(REGIONS, v) : null);
export const languageLabel = (v) => label(LANGUAGES, v);
export const platformLabel = (v) => label(PLATFORMS, v);

// Avatar presets rendered locally (no third-party image hosts).
export const AVATAR_PRESETS = Array.from({ length: 12 }, (_, i) => `preset:${i + 1}`);

export const GENRES = {
  shooter: 'Shooters', moba: 'MOBAs', battle_royale: 'Battle royale', extraction: 'Extraction', coop: 'Co-op', horror: 'Horror',
  arpg: 'Action RPG', mmo: 'MMO', rpg: 'RPG', survival: 'Survival', sandbox: 'Sandbox', fighting: 'Fighting', racing: 'Racing',
  sports: 'Sports', strategy: 'Strategy', party: 'Party', open_world: 'Open world',
};
/** Game list → Select options grouped by genre */
export const gameOptions = (games) => (games || []).map((g) => ({ value: g.id, label: g.name, group: GENRES[g.genre] || 'Other' }))
  .sort((a, b) => Object.values(GENRES).indexOf(a.group) - Object.values(GENRES).indexOf(b.group));
export const REACTIONS = ['👍', '👎', '❤️', '😂', '😮', '😢', '🔥', '🎉', '👀', '💯', '🙏', '🤝'];
export const COMMUNITY_COLORS = ['#f26b38', '#e5484d', '#d6409f', '#8e4ec6', '#3e63dd', '#0090ff', '#12a594', '#30a46c', '#ad7f58', '#6f6e77'];
