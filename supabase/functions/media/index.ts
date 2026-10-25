// PartyUp "media" Edge Function — live streams and top videos for a game.
//
//   POST { game: "valorant" }  (signed-in users only; verify_jwt is on)
//   → { configured: { twitch, youtube }, twitch_live, twitch_clips, youtube_live, youtube_top, updated }
//
// Results are cached in public.media_cache and refreshed when stale, so the
// API keys stay on the server and quota is shared by everyone:
//   Twitch live 3 min · Twitch clips 1 h · YouTube live 30 min · YouTube top 12 h
//
// Secrets (Supabase → Edge Functions → Secrets):
//   TWITCH_CLIENT_ID, TWITCH_CLIENT_SECRET   (dev.twitch.tv → Your Console → Applications)
//   YOUTUBE_API_KEY                          (Google Cloud → YouTube Data API v3 → API key)
import { createClient } from 'npm:@supabase/supabase-js@2';

const TTL: Record<string, number> = {
  twitch_live: 3 * 60_000, twitch_clips: 60 * 60_000, youtube_live: 30 * 60_000, youtube_top: 12 * 60 * 60_000,
  twitch_category: 30 * 24 * 60 * 60_000,
};

// Twitch category names that differ from ours
const TWITCH_NAME: Record<string, string> = {
  cs2: 'Counter-Strike', 'ea-fc-26': 'EA Sports FC 26', 'smash-ultimate': 'Super Smash Bros. Ultimate', 'gta-online': 'Grand Theft Auto V',
  pubg: 'PUBG: BATTLEGROUNDS', 'mobile-legends': 'Mobile Legends: Bang Bang', 'call-of-duty': 'Call of Duty: Warzone',
  'final-fantasy-xiv': 'Final Fantasy XIV Online', 'diablo-4': 'Diablo IV', 'world-of-warcraft': 'World of Warcraft',
};

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
const TW_ID = Deno.env.get('TWITCH_CLIENT_ID') || '';
const TW_SECRET = Deno.env.get('TWITCH_CLIENT_SECRET') || '';
const YT_KEY = Deno.env.get('YOUTUBE_API_KEY') || '';

let twitchToken: { token: string; exp: number } | null = null;
async function twitchAuth() {
  if (twitchToken && twitchToken.exp > Date.now() + 60_000) return twitchToken.token;
  const r = await fetch(`https://id.twitch.tv/oauth2/token?client_id=${TW_ID}&client_secret=${TW_SECRET}&grant_type=client_credentials`, { method: 'POST' });
  if (!r.ok) throw new Error(`Twitch auth failed (${r.status})`);
  const j = await r.json();
  twitchToken = { token: j.access_token, exp: Date.now() + j.expires_in * 1000 };
  return twitchToken.token;
}
async function helix(path: string) {
  const r = await fetch(`https://api.twitch.tv/helix/${path}`, { headers: { 'Client-Id': TW_ID, Authorization: `Bearer ${await twitchAuth()}` } });
  if (!r.ok) throw new Error(`Twitch ${path.split('?')[0]} failed (${r.status})`);
  return r.json();
}
async function yt(path: string) {
  const r = await fetch(`https://www.googleapis.com/youtube/v3/${path}&key=${YT_KEY}`);
  const j = await r.json();
  if (!r.ok) {
    const reason = j?.error?.errors?.[0]?.reason || j?.error?.status || r.status;
    throw new Error(`YouTube ${reason}`);
  }
  return j;
}

type Row = { game_id: string; kind: string; payload: any; fetched_at: string; error: string | null };

async function cached(game: string, kind: string, fetcher: () => Promise<any>, rows: Map<string, Row>) {
  const row = rows.get(kind);
  if (row && Date.now() - new Date(row.fetched_at).getTime() < TTL[kind]) return row.payload;
  try {
    const payload = await fetcher();
    await db.from('media_cache').upsert({ game_id: game, kind, payload, fetched_at: new Date().toISOString(), error: null });
    return payload;
  } catch (e) {
    // Keep serving the old list; retry after a short back-off
    await db.from('media_cache').upsert({ game_id: game, kind, payload: row?.payload ?? [], error: String((e as Error).message).slice(0, 200),
      fetched_at: new Date(Date.now() - TTL[kind] + 5 * 60_000).toISOString() });
    return row?.payload ?? [];
  }
}

async function twitchCategory(game: string, name: string, rows: Map<string, Row>) {
  const v = await cached(game, 'twitch_category', async () => {
    const q = TWITCH_NAME[game] || name;
    const exact = await helix(`games?name=${encodeURIComponent(q)}`);
    if (exact.data?.[0]) return { id: exact.data[0].id, name: exact.data[0].name };
    const s = await helix(`search/categories?query=${encodeURIComponent(q)}&first=1`);
    return s.data?.[0] ? { id: s.data[0].id, name: s.data[0].name } : {};
  }, rows);
  return v?.id ? v : null;
}

const thumb = (u: string, w: number, h: number) => u.replace('{width}', String(w)).replace('{height}', String(h)).replace('%{width}', String(w)).replace('%{height}', String(h));

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  try {
    const { game } = await req.json().catch(() => ({}));
    if (typeof game !== 'string' || !/^[a-z0-9-]{1,40}$/.test(game)) return json({ error: 'Unknown game' }, 400);
    const { data: g } = await db.from('games').select('id, name').eq('id', game).maybeSingle();
    if (!g) return json({ error: 'Unknown game' }, 404);

    const { data: list } = await db.from('media_cache').select('*').eq('game_id', game);
    const rows = new Map<string, Row>((list || []).map((r: Row) => [r.kind, r]));
    const out: Record<string, unknown> = { game: g.id, configured: { twitch: !!(TW_ID && TW_SECRET), youtube: !!YT_KEY } };

    const jobs: Promise<void>[] = [];
    if (TW_ID && TW_SECRET) {
      jobs.push((async () => {
        const cat = await twitchCategory(game, g.name, rows);
        out.twitch_category = cat?.name || null;
        if (!cat) { out.twitch_live = []; out.twitch_clips = []; return; }
        const since = new Date(Date.now() - 7 * 86400_000).toISOString();
        const [live, clips] = await Promise.all([
          cached(game, 'twitch_live', async () => (await helix(`streams?game_id=${cat.id}&first=24`)).data.map((s: any) => ({
            id: s.id, channel: s.user_login, name: s.user_name, title: s.title, viewers: s.viewer_count, language: s.language,
            started_at: s.started_at, thumbnail: thumb(s.thumbnail_url, 440, 248),
          })), rows),
          cached(game, 'twitch_clips', async () => (await helix(`clips?game_id=${cat.id}&first=24&started_at=${since}`)).data.map((c: any) => ({
            id: c.id, channel: c.broadcaster_name, title: c.title, views: c.view_count, created_at: c.created_at, duration: c.duration,
            thumbnail: c.thumbnail_url,
          })), rows),
        ]);
        out.twitch_live = live; out.twitch_clips = clips;
      })());
    }
    if (YT_KEY) {
      jobs.push((async () => {
        const q = encodeURIComponent(g.name);
        const enrich = async (items: any[]) => {
          const ids = items.map((i) => i.id?.videoId).filter(Boolean);
          if (!ids.length) return [];
          const v = await yt(`videos?part=snippet,statistics,liveStreamingDetails&id=${ids.join(',')}`);
          return v.items.map((x: any) => ({
            id: x.id, title: x.snippet.title, channel: x.snippet.channelTitle, published_at: x.snippet.publishedAt,
            thumbnail: x.snippet.thumbnails?.medium?.url || x.snippet.thumbnails?.default?.url,
            views: Number(x.statistics?.viewCount || 0), viewers: Number(x.liveStreamingDetails?.concurrentViewers || 0),
          }));
        };
        const since = new Date(Date.now() - 7 * 86400_000).toISOString();
        const [live, top] = await Promise.all([
          cached(game, 'youtube_live', async () => (await enrich((await yt(`search?part=id&type=video&eventType=live&videoCategoryId=20&order=viewCount&maxResults=18&q=${q}`)).items))
            .sort((a: any, b: any) => b.viewers - a.viewers), rows),
          cached(game, 'youtube_top', async () => (await enrich((await yt(`search?part=id&type=video&videoCategoryId=20&order=viewCount&maxResults=18&publishedAfter=${since}&q=${q}`)).items))
            .sort((a: any, b: any) => b.views - a.views), rows),
        ]);
        out.youtube_live = live; out.youtube_top = top;
      })());
    }
    await Promise.all(jobs);
    out.updated = new Date().toISOString();
    return json(out);
  } catch (e) {
    return json({ error: String((e as Error).message || e) }, 500);
  }
});
