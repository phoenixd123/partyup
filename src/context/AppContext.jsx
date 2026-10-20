import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase.js';
import * as api from '../lib/api.js';
import { navigate } from '../lib/router.jsx';
import { useInterval } from '../hooks/useAsync.js';

const Ctx = createContext(null);

export function AppProvider({ children }) {
  const [session, setSession] = useState(undefined); // undefined = still checking
  const [profile, setProfile] = useState(null);
  const [profileError, setProfileError] = useState(null);
  const [counts, setCounts] = useState({ notifications: 0, messages: 0, friend_requests: 0, party_invites: 0 });
  const [roles, setRoles] = useState({ moderator: false, admin: false });
  const [realtime, setRealtime] = useState(null); // true | false | null (unknown)
  const [recovery, setRecovery] = useState(false);
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
    // Clean the ?code= left by email links (PKCE) from the address bar
    if (window.location.search.includes('code=')) {
      setTimeout(() => window.history.replaceState(null, '', window.location.pathname + window.location.hash), 1500);
    }
    return () => { alive = false; data?.subscription?.unsubscribe(); };
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
      counts, refreshCounts, communities, conversations, roles, realtime, onNotify, signOut, recovery, setRecovery,
    }}>
      {children}
    </Ctx.Provider>
  );
}

export const useApp = () => useContext(Ctx);
