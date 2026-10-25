import { useEffect, useRef } from 'react';
import {
  LuMic, LuMicOff, LuHeadphones, LuHeadphoneOff, LuVideo, LuVideoOff, LuScreenShare, LuScreenShareOff, LuPhoneOff,
  LuPhone, LuPhoneIncoming, LuX, LuVolume2,
} from 'react-icons/lu';
import { useCall } from '../context/CallContext.jsx';
import { useApp } from '../context/AppContext.jsx';
import { navigate } from '../lib/router.jsx';
import { Avatar } from './gaming.jsx';
import { Button, IconButton, cx } from './ui.jsx';

function Video({ stream, track, mirrored, muted = true }) {
  const ref = useRef(null);
  useEffect(() => {
    if (!ref.current) return;
    ref.current.srcObject = track ? new MediaStream([track]) : stream || null;
  }, [stream, track]);
  return <video ref={ref} autoPlay playsInline muted={muted} className={cx('call-video', mirrored && 'mirror')} />;
}

/** Plays everyone else's audio. Lives once at the app root so calls survive page changes. */
export function CallAudio() {
  const call = useCall();
  const s = call?.session;
  if (!s) return null;
  return (
    <div hidden>
      {[...s.peers.entries()].map(([id, p]) => <PeerAudio key={id} stream={p.stream} muted={s.state.deafened} />)}
    </div>
  );
}
function PeerAudio({ stream, muted }) {
  const ref = useRef(null);
  useEffect(() => { if (ref.current) { ref.current.srcObject = stream; ref.current.play?.().catch(() => {}); } }, [stream]);
  useEffect(() => { if (ref.current) ref.current.muted = muted; }, [muted]);
  return <audio ref={ref} autoPlay data-peer-audio />;
}

export function CallControls({ compact }) {
  const call = useCall();
  const s = call.session;
  if (!s) return null;
  const { muted, deafened, video, sharing } = s.state;
  return (
    <div className={cx('call-controls', compact && 'compact')}>
      <IconButton icon={muted ? LuMicOff : LuMic} label={muted ? 'Unmute' : 'Mute'} onClick={call.toggleMute} className={cx(muted && 'danger-on')} />
      <IconButton icon={deafened ? LuHeadphoneOff : LuHeadphones} label={deafened ? 'Undeafen' : 'Deafen'} onClick={call.toggleDeafen} className={cx(deafened && 'danger-on')} />
      <IconButton icon={video ? LuVideoOff : LuVideo} label={video ? 'Turn off camera' : 'Turn on camera'} onClick={call.toggleVideo} className={cx(video && 'on')} />
      {navigator.mediaDevices?.getDisplayMedia && (
        <IconButton icon={sharing ? LuScreenShareOff : LuScreenShare} label={sharing ? 'Stop sharing' : 'Share your screen'} onClick={call.toggleScreen} className={cx(sharing && 'on')} />
      )}
      <IconButton icon={LuPhoneOff} label="Leave call" onClick={call.leave} className="leave" />
    </div>
  );
}

/** Small "Voice connected" panel above your name in the sidebar. */
export function CallBar() {
  const call = useCall();
  const s = call?.session;
  if (!s) return null;
  const connected = s.status === 'connected';
  const others = s.participants.filter((p) => p.id !== s.me).length;
  return (
    <div className="call-bar" role="region" aria-label="Current call">
      <button type="button" className="call-bar-info" onClick={() => call.meta?.to && navigate(call.meta.to)}>
        <span className={cx('call-signal', connected && 'ok')}><LuVolume2 aria-hidden /></span>
        <span className="call-bar-text">
          <strong>{connected ? 'Voice connected' : 'Connecting…'}</strong>
          <small>{call.meta?.title || 'Call'}{connected ? ` · ${others ? `${others + 1} in call` : 'waiting for others'}` : ''}</small>
        </span>
      </button>
      <CallControls compact />
    </div>
  );
}

function Tile({ person, me, session, speaking }) {
  const peer = session?.peers.get(person.id);
  const isMe = person.id === me;
  const videoTrack = isMe ? session?.videoTrack : peer?.stream.getVideoTracks().find((t) => t.readyState === 'live' && !t.muted);
  const showVideo = (person.video || person.sharing || (isMe && (session?.state.video || session?.state.sharing))) && videoTrack;
  const state = isMe && session ? session.state : person;
  return (
    <div className={cx('call-tile', speaking && 'speaking', showVideo && 'has-video')}>
      {showVideo ? <Video track={videoTrack} mirrored={isMe && state.video} /> : <Avatar user={person} size={72} />}
      <span className="call-tile-name">
        {state.muted ? <LuMicOff aria-label="Muted" /> : null}
        {state.deafened ? <LuHeadphoneOff aria-label="Deafened" /> : null}
        {person.sharing || (isMe && state.sharing) ? <LuScreenShare aria-label="Sharing screen" /> : null}
        {person.username}{isMe ? ' (you)' : ''}
      </span>
      {!isMe && peer && peer.state !== 'connected' && peer.state !== 'new' && <span className="call-tile-state">{peer.state === 'failed' ? 'Connection failed' : 'Connecting…'}</span>}
    </div>
  );
}

/**
 * The call area for a room: participant tiles when you're in it, otherwise who's
 * there and a Join button. `people` are the room's current participants from the server.
 */
export function CallStage({ room, title, to, people = [], kind = 'voice', onJoined }) {
  const call = useCall();
  const { userId, profile } = useApp();
  const inIt = call.inRoom(room);
  const s = inIt ? call.session : null;
  const list = s ? s.participants : people;
  const shown = s && !list.some((p) => p.id === userId) ? [{ ...profile, id: userId }, ...list] : list;
  const join = async (video) => { await call.join(room, { title, to, video }); onJoined?.(); };
  if (!inIt) {
    return (
      <div className="call-stage idle">
        <div className="call-idle">
          {people.length > 0 ? (
            <>
              <div className="call-idle-avatars">{people.slice(0, 6).map((p) => <Avatar key={p.id} user={p} size={40} />)}</div>
              <p><b>{people.map((p) => p.username).slice(0, 3).join(', ')}{people.length > 3 ? ` +${people.length - 3}` : ''}</b> {people.length === 1 ? 'is' : 'are'} in {kind === 'voice' ? 'voice' : 'the call'}</p>
            </>
          ) : <p className="muted">{kind === 'voice' ? 'No one is in this voice channel yet.' : 'No call right now.'}</p>}
          <div className="row gap-s">
            <Button variant="primary" icon={LuPhone} loading={call.joining === room} onClick={() => join(false)}>{kind === 'voice' ? 'Join voice' : people.length ? 'Join call' : 'Start call'}</Button>
            <Button icon={LuVideo} onClick={() => join(true)} disabled={call.joining === room}>With video</Button>
          </div>
        </div>
      </div>
    );
  }
  return (
    <div className="call-stage">
      <div className={cx('call-grid', `n${Math.min(shown.length, 6)}`)}>
        {shown.map((p) => <Tile key={p.id} person={p} me={userId} session={s} speaking={s.speaking.has(p.id)} />)}
      </div>
      {shown.length <= 1 && <p className="muted small center">Waiting for others to join…</p>}
      <CallControls />
    </div>
  );
}

/** "X is calling" cards for calls happening in your chats. */
export function IncomingCalls() {
  const call = useCall();
  const items = call?.incoming || [];
  useEffect(() => {
    if (!items.length) return undefined;
    let ctx;
    const ring = () => {
      try {
        ctx = ctx || new (window.AudioContext || window.webkitAudioContext)();
        const o = ctx.createOscillator(); const g = ctx.createGain();
        o.frequency.value = 660; g.gain.setValueAtTime(0.0001, ctx.currentTime);
        g.gain.exponentialRampToValueAtTime(0.08, ctx.currentTime + 0.05);
        g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.6);
        o.connect(g).connect(ctx.destination); o.start(); o.stop(ctx.currentTime + 0.65);
      } catch { /* no audio, no ring */ }
    };
    ring();
    const t = setInterval(ring, 2500);
    const stop = setTimeout(() => clearInterval(t), 30000);
    return () => { clearInterval(t); clearTimeout(stop); ctx?.close().catch(() => {}); };
  }, [items.length]);
  if (!items.length) return null;
  return (
    <div className="incoming-calls" role="alert">
      {items.slice(0, 3).map((c) => {
        const who = c.participants?.[0];
        const label = c.kind === 'direct' ? `${who?.username || 'Someone'} is calling` : `Call in ${c.name || c.party_title || 'your group'}`;
        return (
          <div key={c.room} className="incoming-call">
            <span className="ring"><Avatar user={who} size={44} /></span>
            <div className="grow"><strong><LuPhoneIncoming aria-hidden /> {label}</strong>
              <small>{c.participants?.length || 1} in call</small></div>
            <Button variant="primary" icon={LuPhone} onClick={() => { call.join(c.room, { title: c.kind === 'direct' ? who?.username : (c.name || c.party_title || 'Group call'), to: `/messages/${c.conversation_id}` }); navigate(`/messages/${c.conversation_id}`); }}>Join</Button>
            <IconButton icon={LuX} label="Ignore" onClick={() => call.dismiss(c)} />
          </div>
        );
      })}
    </div>
  );
}
