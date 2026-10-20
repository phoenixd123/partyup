import { createClient } from '@supabase/supabase-js';

// Config comes from Vite env vars (VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY) or,
// for quick local trials, from values saved on the Setup screen in this browser.
const STORAGE_KEY = 'partyup.supabase';

function readSaved() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null'); } catch { return null; }
}

const env = (typeof import.meta !== 'undefined' && import.meta.env) || {};
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

/** URL Supabase should send people back to after email links (confirm / reset). */
export function appUrl(hashPath = '/') {
  // The desktop app runs from file://, which email links can't open — use the hosted site if one is configured.
  const site = env.VITE_SITE_URL || (window.location.protocol === 'file:' ? '' : `${window.location.origin}${window.location.pathname}`);
  return site ? `${site.replace(/#.*$/, '')}#${hashPath}` : `#${hashPath}`;
}
