import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { CallSession } from '../lib/callEngine.js';
import { useApp } from './AppContext.jsx';
import { useToast } from '../components/feedback.jsx';

const Ctx = createContext(null);
export const useCall = () => useContext(Ctx);

/** Keeps the one active call alive across page changes (like Discord). */
export function CallProvider({ children }) {
  const { userId, counts } = useApp();
  const toast = useToast();
  const [session, setSession] = useState(null);
  const [meta, setMeta] = useState(null); // { title, to }
  const [tick, setTick] = useState(0);
  const [joining, setJoining] = useState(null);
  const [dismissed, setDismissed] = useState(() => new Set());
  const ref = useRef(null);

  const leave = useCallback(async () => { await ref.current?.leave(); }, []);

  const join = useCallback(async (room, info = {}) => {
    if (ref.current?.room === room) return;
    if (ref.current) await ref.current.leave('switched');
    if (!navigator.mediaDevices || typeof RTCPeerConnection === 'undefined') {
      toast("Calls aren't supported in this browser.", 'error');
      return;
    }
    setJoining(room);
    const s = new CallSession({
      room, me: userId,
      onChange: () => setTick((t) => t + 1),
      onEnded: (reason) => {
        if (ref.current === s) { ref.current = null; setSession(null); setMeta(null); }
        if (reason === 'removed') toast('You were removed from the call.', 'error');
      },
    });
    ref.current = s; setSession(s); setMeta(info);
    try {
      await s.start();
      if (s.error) toast(s.error, 'error');
      if (info.video) s.setVideo(true).catch(() => toast("Couldn't turn on your camera.", 'error'));
    } catch (e) {
      toast(e, 'error');
      await s.leave('failed');
    } finally { setJoining(null); }
  }, [userId, toast]);

  // Leave cleanly when the window closes or the user signs out.
  useEffect(() => {
    const bye = () => { ref.current?.leave('closed'); };
    window.addEventListener('pagehide', bye);
    return () => window.removeEventListener('pagehide', bye);
  }, []);
  useEffect(() => { if (!userId) ref.current?.leave('signed_out'); }, [userId]);

  const incoming = (counts.calls || []).filter((c) => c.room !== session?.room && !dismissed.has(`${c.room}:${c.started_at}`));
  const dismiss = useCallback((c) => setDismissed((d) => new Set(d).add(`${c.room}:${c.started_at}`)), []);

  const value = useMemo(() => ({
    session, meta, joining, join, leave, incoming, dismiss,
    inRoom: (room) => session?.room === room,
    toggleMute: () => session && session.setMuted(!session.state.muted),
    toggleDeafen: () => session && session.setDeafened(!session.state.deafened),
    toggleVideo: () => session && session.setVideo(!session.state.video, 'camera').catch(() => toast("Couldn't turn on your camera.", 'error')),
    toggleScreen: () => session && session.setVideo(!session.state.sharing, 'screen').catch((e) => { if (e?.name !== 'NotAllowedError') toast("Couldn't share your screen.", 'error'); }),
  }), [session, meta, joining, join, leave, incoming, dismiss, toast, tick]); // eslint-disable-line react-hooks/exhaustive-deps

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
