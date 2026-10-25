// Voice / video calls: a small WebRTC mesh (everyone connects to everyone, fine
// for DMs, group chats and voice channels of a handful of people).
//
//   * Membership and "who is here" live in Postgres (voice_join / voice_heartbeat),
//     so the server decides who may be in a room.
//   * SDP offers/answers and ICE candidates travel over a private Supabase
//     Realtime broadcast topic "call:<room>", authorized by RLS on realtime.messages.
//   * Negotiation follows the "perfect negotiation" pattern (polite peer = higher id),
//     so either side can add a camera or screen share at any time.
import { supabase } from './supabase.js';
import * as api from './api.js';

const env = (typeof import.meta !== 'undefined' && import.meta.env) || {};

export function iceServers() {
  const servers = [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }];
  // Optional TURN relay for strict networks (set at build time).
  if (env.VITE_TURN_URLS) {
    servers.push({ urls: env.VITE_TURN_URLS.split(',').map((u) => u.trim()), username: env.VITE_TURN_USERNAME, credential: env.VITE_TURN_CREDENTIAL });
  }
  return servers;
}

const HEARTBEAT_MS = 8000;

export class CallSession {
  constructor({ room, me, onChange, onEnded }) {
    this.room = room;
    this.me = me;
    this.onChange = onChange;
    this.onEnded = onEnded;
    this.peers = new Map(); // id -> { pc, polite, makingOffer, ignoreOffer, stream, state }
    this.participants = [];
    this.local = null; // MediaStream (mic)
    this.videoTrack = null; // camera or screen track currently sent
    this.state = { muted: false, deafened: false, video: false, sharing: false };
    this.status = 'connecting';
    this.error = null;
    this.speaking = new Set();
    this.channel = null;
    this.timer = null;
    this.ended = false;
    this.analysers = new Map();
  }

  emit() { if (!this.ended) this.onChange?.(this); }

  async start() {
    try {
      this.local = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }, video: false });
    } catch (e) {
      // Still join so you can listen; explain why your mic is off.
      this.local = new MediaStream();
      this.state.muted = true;
      this.error = e?.name === 'NotAllowedError' ? 'Microphone access was blocked — you joined muted. Allow the microphone to talk.'
        : 'No microphone found — you joined muted.';
    }
    this.watchSpeaking(this.me, this.local);
    const res = await api.voiceJoin(this.room);
    this.participants = res.participants || [];
    await this.connectSignaling();
    this.timer = setInterval(() => this.beat(), HEARTBEAT_MS);
    this.status = 'connected';
    this.emit();
  }

  connectSignaling() {
    return new Promise((resolve) => {
      let done = false;
      const finish = () => { if (!done) { done = true; resolve(); } };
      this.channel = supabase.channel(`call:${this.room}`, { config: { private: true, broadcast: { self: false, ack: false } } });
      this.channel.on('broadcast', { event: 'signal' }, ({ payload }) => this.onSignal(payload));
      this.channel.subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          this.send({ type: 'hello' });
          for (const p of this.participants) if (p.id !== this.me) this.ensurePeer(p.id);
          finish();
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          this.error = "Couldn't connect the call. Check your connection and try again.";
          this.emit();
          finish();
        }
      });
      setTimeout(finish, 8000);
    });
  }

  send(msg) {
    if (!this.channel) return;
    this.channel.send({ type: 'broadcast', event: 'signal', payload: { ...msg, from: this.me } });
  }

  ensurePeer(id) {
    if (this.peers.has(id) || id === this.me || this.ended) return this.peers.get(id);
    const pc = new RTCPeerConnection({ iceServers: iceServers() });
    const peer = { pc, polite: this.me > id, makingOffer: false, ignoreOffer: false, stream: new MediaStream(), state: 'new' };
    this.peers.set(id, peer);
    // The impolite side (lower id) creates one audio and one video transceiver; the
    // polite side attaches its tracks to them when the offer arrives. Cameras and
    // screen shares then swap in with replaceTrack, without renegotiating.
    if (!peer.polite) {
      const a = pc.addTransceiver('audio', { direction: 'sendrecv' });
      const mic = this.local?.getAudioTracks()[0];
      if (mic) a.sender.replaceTrack(mic);
      const v = pc.addTransceiver('video', { direction: 'sendrecv' });
      if (this.videoTrack) v.sender.replaceTrack(this.videoTrack);
    }
    pc.onnegotiationneeded = async () => {
      try {
        peer.makingOffer = true;
        await pc.setLocalDescription();
        this.send({ type: 'sdp', to: id, description: pc.localDescription && { type: pc.localDescription.type, sdp: pc.localDescription.sdp } });
      } catch { /* retried on next negotiation */ } finally { peer.makingOffer = false; }
    };
    pc.onicecandidate = ({ candidate }) => { if (candidate) this.send({ type: 'ice', to: id, candidate: candidate.toJSON() }); };
    pc.ontrack = ({ track }) => {
      if (!peer.stream.getTracks().includes(track)) peer.stream.addTrack(track);
      track.onended = () => { peer.stream.removeTrack(track); this.emit(); };
      track.onmute = () => this.emit();
      track.onunmute = () => this.emit();
      if (track.kind === 'audio') this.watchSpeaking(id, peer.stream);
      this.emit();
    };
    pc.onconnectionstatechange = () => {
      peer.state = pc.connectionState;
      if (pc.connectionState === 'failed') pc.restartIce?.();
      this.emit();
    };
    this.emit();
    return peer;
  }

  dropPeer(id) {
    const p = this.peers.get(id);
    if (!p) return;
    p.pc.close();
    this.peers.delete(id);
    this.analysers.get(id)?.stop();
    this.analysers.delete(id);
    this.speaking.delete(id);
    this.emit();
  }

  async onSignal(msg) {
    if (!msg || msg.from === this.me || this.ended) return;
    if (msg.to && msg.to !== this.me) return;
    if (msg.type === 'hello') {
      this.ensurePeer(msg.from);
      if (!msg.to) this.send({ type: 'hello', to: msg.from });
      this.beat();
      return;
    }
    if (msg.type === 'bye') { this.dropPeer(msg.from); this.beat(); return; }
    if (msg.type === 'state') { this.beat(); return; }
    const peer = this.ensurePeer(msg.from);
    if (!peer) return;
    const { pc } = peer;
    try {
      if (msg.type === 'sdp' && msg.description) {
        const offerCollision = msg.description.type === 'offer' && (peer.makingOffer || pc.signalingState !== 'stable');
        peer.ignoreOffer = !peer.polite && offerCollision;
        if (peer.ignoreOffer) return;
        await pc.setRemoteDescription(msg.description);
        if (msg.description.type === 'offer') {
          this.attachTracks(pc);
          await pc.setLocalDescription();
          this.send({ type: 'sdp', to: msg.from, description: { type: pc.localDescription.type, sdp: pc.localDescription.sdp } });
        }
      } else if (msg.type === 'ice' && msg.candidate) {
        try { await pc.addIceCandidate(msg.candidate); } catch (e) { if (!peer.ignoreOffer) throw e; }
      }
    } catch { /* a bad message never breaks the call */ }
  }

  attachTracks(pc) {
    const mic = this.local?.getAudioTracks()[0] || null;
    for (const t of pc.getTransceivers()) {
      const kind = t.receiver.track?.kind;
      if (t.direction === 'recvonly' || t.direction === 'inactive') t.direction = 'sendrecv';
      if (kind === 'audio' && t.sender.track !== mic) t.sender.replaceTrack(mic).catch(() => {});
      if (kind === 'video' && t.sender.track !== this.videoTrack) t.sender.replaceTrack(this.videoTrack).catch(() => {});
    }
  }

  beat() {
    // Serialized so a heartbeat can never land after we've left the call.
    this.beatChain = (this.beatChain || Promise.resolve()).then(() => this.beatOnce());
    return this.beatChain;
  }

  async beatOnce() {
    if (this.ended) return;
    try {
      this.participants = await api.voiceHeartbeat(this.room, this.state);
      const ids = new Set(this.participants.map((p) => p.id));
      for (const id of [...this.peers.keys()]) if (!ids.has(id)) this.dropPeer(id);
      for (const id of ids) if (id !== this.me && !this.peers.has(id)) { this.ensurePeer(id); this.send({ type: 'hello', to: id }); }
      this.emit();
    } catch (e) {
      if (/no longer allowed|permission/i.test(e.message)) this.leave('removed');
    }
  }

  setMuted(muted) {
    this.state.muted = muted;
    for (const t of this.local?.getAudioTracks() || []) t.enabled = !muted;
    this.beat().then(() => this.send({ type: 'state' }));
    this.emit();
  }

  setDeafened(deafened) {
    this.state.deafened = deafened;
    if (deafened) this.setMuted(true); else this.beat();
    this.emit();
  }

  async setVideo(on, kind = 'camera') {
    if (!on) {
      this.videoTrack?.stop();
      await this.replaceVideo(null);
      this.state.video = false; this.state.sharing = false;
      this.beat().then(() => this.send({ type: 'state' })); this.emit();
      return;
    }
    let track;
    if (kind === 'screen') {
      const s = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 30 }, audio: false });
      track = s.getVideoTracks()[0];
    } else {
      const s = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 1280 }, height: { ideal: 720 } } });
      track = s.getVideoTracks()[0];
    }
    track.onended = () => { if (this.videoTrack === track) this.setVideo(false); };
    this.videoTrack?.stop();
    await this.replaceVideo(track);
    this.state.video = kind === 'camera'; this.state.sharing = kind === 'screen';
    this.beat().then(() => this.send({ type: 'state' })); this.emit();
  }

  async replaceVideo(track) {
    this.videoTrack = track;
    for (const { pc } of this.peers.values()) {
      const tr = pc.getTransceivers().find((t) => t.receiver.track?.kind === 'video');
      if (tr) await tr.sender.replaceTrack(track).catch(() => {});
    }
  }

  watchSpeaking(id, stream) {
    if (this.analysers.has(id) || !stream) return;
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    let ctx; let raf;
    const start = () => {
      if (!stream.getAudioTracks().length) { raf = setTimeout(start, 1000); return; }
      try {
        ctx = new Ctx();
        const src = ctx.createMediaStreamSource(stream);
        const an = ctx.createAnalyser(); an.fftSize = 512; src.connect(an);
        const buf = new Uint8Array(an.frequencyBinCount);
        const tick = () => {
          an.getByteFrequencyData(buf);
          let sum = 0; for (let i = 0; i < buf.length; i++) sum += buf[i];
          const loud = sum / buf.length > 18 && !(id === this.me && this.state.muted);
          if (loud !== this.speaking.has(id)) { if (loud) this.speaking.add(id); else this.speaking.delete(id); this.emit(); }
          raf = setTimeout(tick, 150);
        };
        tick();
      } catch { /* speaking indicator is optional */ }
    };
    start();
    this.analysers.set(id, { stop: () => { clearTimeout(raf); ctx?.close().catch(() => {}); } });
  }

  async leave(reason = 'left') {
    if (this.ended) return;
    this.send({ type: 'bye' });
    this.ended = true;
    clearInterval(this.timer);
    for (const id of [...this.peers.keys()]) { this.peers.get(id).pc.close(); }
    this.peers.clear();
    for (const a of this.analysers.values()) a.stop();
    this.local?.getTracks().forEach((t) => t.stop());
    this.videoTrack?.stop();
    if (this.channel) supabase.removeChannel(this.channel);
    await (this.beatChain || Promise.resolve()).catch(() => {});
    try { await api.voiceLeave(this.room); } catch { /* heartbeat expiry cleans up */ }
    this.onEnded?.(reason);
  }
}
