import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { supabase, desktop } from '../lib/supabase.js';
import * as api from '../lib/api.js';
import { navigate } from '../lib/router.jsx';
import { useInterval } from '../hooks/useAsync.js';

const Ctx = createContext(null);

function readRedirectError(query) {
  const p = new URLSearchParams(query);
  const code = p.get('error_code') || p.get('error');
  if (!code) return null;
  const desc = (p.get('error_description') || '').replace(/\+/g, ' ');
  if (code === 'access_denied' && !/expired|invalid/i.test(desc)) return new Error('Sign-in was cancelled.');
  if (/otp_expired|expired/i.test(code + desc)) return new Error('That link has expired. Request a new one.');
  if (/provider is not enabled/i.test(desc)) return new Error('Google sign-in is not available right now.');
  return new Error(desc || 'Sign-in failed. Try again.');
}

export function AppProvider({ children }) {
  const [session, setSession] = useState(undefined); // undefined = still checking
  const [profile, setProfile] = useState(null);
  const [profileError, setProfileError] = useState(null);
  const [counts, setCounts] = useState({ notifications: 0, messages: 0, friend_requests: 0, party_invites: 0 });
  const [roles, setRoles] = useState({ moderator: false, admin: false });
  const [realtime, setRealtime] = useState(null); // true | false | null (unknown)
  const [recovery, setRecovery] = useState(false);
  // Error from a sign-in redirect (Google / email link), shown on the sign-in page.
  const [authError, setAuthError] = useState(() => readRedirectError(window.location.search + '&' + window.location.hash.replace(/^#[^?]*\??/, '')));
  const userId = session?.user?.id;

  useEffect(() => {
    let alive = true;
    supabase.auth.getSession().then(({ data, error }) => {
      if (!alive) return;
      if (error) setProfileError(error);
      setSession(data?.session ?? null);
    });
    const { data } = supabase.auth.onAuthStateChange((event, s) => {
      setSession(s ?? null);
      if (event === 'PASSWORD_RECOVERY') { setRecovery(true); navigate('/reset', { replace: true }); }
      if (event === 'SIGNED_OUT') { setProfile(null); setRoles({ moderator: false, admin: false }); }
    });
    // Clean the ?code= / ?error= left by sign-in redirects (PKCE) from the address bar
    if (/[?&](code|error)=/.test(window.location.search)) {
      setTimeout(() => window.history.replaceState(null, '', window.location.pathname + window.location.hash), 1500);
    }
    return () => { alive = false; data?.subscription?.unsubscribe(); };
  }, []);

  // Desktop: Google sign-in and email links return as partyup://auth-callback?code=…
  useEffect(() => {
    if (!desktop) return undefined;
    const handled = new Set();
    return desktop.onAuthCallback(async (url) => {
      if (handled.has(url)) return;
      handled.add(url);
      // partyup://invite/CODE — a community invite link shared from the desktop app
      const invite = url.match(/^partyup:\/\/invite\/([A-Za-z0-9_-]+)/i);
      if (invite) {
        const to = `/invite/${invite[1]}`;
        try { sessionStorage.setItem('partyup.after', to); } catch { /* ignore */ }
        navigate(to);
        return;
      }
      const q = url.includes('?') ? url.slice(url.indexOf('?') + 1).replace('#', '&') : url.slice(url.indexOf('#') + 1);
      const params = new URLSearchParams(q);
      const err = readRedirectError(params.toString());
      if (err) { setAuthError(err); return; }
      const code = params.get('code');
      if (!code) return;
      const flowId = params.get('sb_flow_id');
      const { error } = await supabase.auth.exchangeCodeForSession(code, flowId ? { flowId } : undefined);
      if (error) {
        setAuthError(new Error(/code verifier|flow state/i.test(error.message)
          ? 'That sign-in link was started somewhere else or has already been used. Start again from this app.'
          : error.message));
      } else setAuthError(null);
    });
  }, []);

  const refreshProfile = useCallback(async () => {
    if (!userId) return null;
    try {
      const p = await api.getMyProfile(userId);
      setProfile(p); setProfileError(null);
      return p;
    } catch (e) { setProfileError(e); return null; }
  }, [userId]);

  useEffect(() => {
    if (!userId) { setProfile(null); return; }
    refreshProfile();
    api.amIModerator().then(setRoles).catch(() => {});
    api.heartbeat().catch(() => {});
  }, [userId, refreshProfile]);

  const [communities, setCommunities] = useState(null);
  const [conversations, setConversations] = useState(null);
  const refreshCounts = useCallback(() => {
    if (!userId || !profile?.onboarded_at) return;
    api.getCounts().then(setCounts).catch(() => {});
    api.listMyCommunities().then(setCommunities).catch(() => {});
    api.listConversations().then(setConversations).catch(() => {});
  }, [userId, profile?.onboarded_at]);
  useEffect(() => { refreshCounts(); }, [refreshCounts]);

  // Presence heartbeat (last_seen) while the tab is open.
  useInterval(() => api.heartbeat().catch(() => {}), 60_000, !!userId);
  // Counts: realtime nudges refreshes instantly; polling is the safety net.
  useInterval(refreshCounts, realtime ? 45_000 : 12_000, !!profile?.onboarded_at);

  const listeners = useRef(new Set());
  const onNotify = useCallback((fn) => { listeners.current.add(fn); return () => listeners.current.delete(fn); }, []);
  useEffect(() => {
    if (!userId || !profile?.onboarded_at) return undefined;
    return api.subscribe(`user-${userId}`, [
      { event: '*', table: 'notifications', filter: `user_id=eq.${userId}` },
      { event: '*', table: 'community_members', filter: `user_id=eq.${userId}` },
    ], (payload) => {
      refreshCounts();
      listeners.current.forEach((fn) => fn(payload));
    }, setRealtime);
  }, [userId, profile?.onboarded_at, refreshCounts]);

  const updateProfile = useCallback(async (fields) => {
    const p = await api.updateMyProfile(userId, fields);
    setProfile(p);
    return p;
  }, [userId]);

  const signOut = useCallback(async () => {
    await supabase.auth.signOut();
    setProfile(null);
    navigate('/login', { replace: true });
  }, []);

  return (
    <Ctx.Provider value={{
      session, user: session?.user ?? null, userId, profile, profileError, refreshProfile, updateProfile,
      counts, refreshCounts, communities, conversations, roles, realtime, onNotify, signOut, recovery, setRecovery, authError, setAuthError,
    }}>
      {children}
    </Ctx.Provider>
  );
}

export const useApp = () => useContext(Ctx);
