import { createClient } from '@supabase/supabase-js';

// Config is baked in at build time from VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY
// (.env.production for release builds). Only development builds (`npm run dev`) can
// fall back to values saved on the developer Setup screen — shipped builds never
// show that screen or read saved overrides.
const STORAGE_KEY = 'partyup.supabase';

const env = (typeof import.meta !== 'undefined' && import.meta.env) || {};
export const isDevBuild = Boolean(env.DEV);

function readSaved() {
  if (!isDevBuild) return null;
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null'); } catch { return null; }
}

const saved = readSaved();
export const config = {
  url: env.VITE_SUPABASE_URL || saved?.url || '',
  anonKey: env.VITE_SUPABASE_ANON_KEY || saved?.anonKey || '',
  source: env.VITE_SUPABASE_URL ? 'env' : saved ? 'browser' : 'none',
};

/** Returns an error message if the key must not be used in a browser. */
export function checkPublicKey(key) {
  if (!key) return 'Add your Supabase anon (public) key.';
  if (key.startsWith('sb_secret_')) return 'That is a secret key. Use the publishable/anon key — secret keys must never be in a web app.';
  if (key.startsWith('sb_publishable_')) return null;
  const parts = key.split('.');
  if (parts.length === 3) {
    try {
      const payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')));
      if (payload.role === 'service_role') return 'That is the service_role key. It bypasses all security rules — never put it in a web app. Use the anon key.';
      return null;
    } catch { /* fall through */ }
  }
  return 'This does not look like a Supabase anon or publishable key.';
}

export const isConfigured = Boolean(config.url && config.anonKey && !checkPublicKey(config.anonKey));

export const supabase = isConfigured
  ? createClient(config.url, config.anonKey, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: 'pkce' },
      realtime: { params: { eventsPerSecond: 5 } },
    })
  : null;

export function saveBrowserConfig(url, anonKey) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ url: url.trim().replace(/\/+$/, ''), anonKey: anonKey.trim() }));
}
export function clearBrowserConfig() {
  localStorage.removeItem(STORAGE_KEY);
}

/** Desktop bridge exposed by desktop/preload.cjs (undefined in browsers). */
export const desktop = typeof window !== 'undefined' ? window.partyupDesktop : undefined;
export const isDesktop = Boolean(desktop);

/**
 * Where Supabase sends people back to after Google sign-in and email links
 * (confirm / reset / email change). The desktop app registers the partyup://
 * link scheme so those links reopen the app; the web app uses its own address.
 * No #route here: the PASSWORD_RECOVERY event (not the URL) opens the reset form.
 */
export function authRedirect() {
  if (isDesktop) return 'partyup://auth-callback';
  return `${window.location.origin}${window.location.pathname}`;
}

/**
 * Shareable link to a route (community invites). The desktop app runs from a
 * local address nobody else can open, so it shares partyup:// links that open
 * PartyUp on the recipient's computer — or the hosted web app if VITE_SITE_URL is set.
 */
export function appUrl(hashPath = '/') {
  if (!isDesktop && window.location.protocol !== 'file:') return `${window.location.origin}${window.location.pathname}#${hashPath}`;
  if (env.VITE_SITE_URL) return `${env.VITE_SITE_URL.replace(/#.*$/, '')}#${hashPath}`;
  return `partyup:/${hashPath}`;
}
