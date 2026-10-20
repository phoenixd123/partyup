import { forwardRef, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  LuSend, LuFlag, LuEyeOff, LuWifi, LuWifiOff, LuReply, LuPencil, LuTrash2, LuPin, LuPinOff, LuSmilePlus, LuX, LuCornerUpLeft,
} from 'react-icons/lu';
import * as api from '../lib/api.js';
import { useApp } from '../context/AppContext.jsx';
import { useInterval } from '../hooks/useAsync.js';
import { clockTime, dayLabel } from '../lib/format.js';
import { renderMessage } from '../lib/markdown.jsx';
import { REACTIONS } from '../lib/constants.js';
import { Avatar } from './gaming.jsx';
import { Button, ErrorState, Skeleton, cx, IconButton } from './ui.jsx';
import { useConfirm, useToast } from './feedback.jsx';
import { ReportDialog } from './PlayerActions.jsx';
import ProfilePopover from './ProfilePopover.jsx';

const GROUP_GAP = 5 * 60e3;

/**
 * Discord-style message list + composer for any conversation (DM, group, party, channel).
 * Realtime when available; otherwise polls every few seconds and says so.
 * `conv` comes from get_conversation. `members` are cards used for @mention autocomplete.
 */
const ChatThread = forwardRef(function ChatThread({ conv, members = [], onRead, emptyTitle, emptyText }, ref) {
  const conversationId = conv.id;
  const { userId, profile, refreshCounts } = useApp();
  const toast = useToast();
  const confirm = useConfirm();
  const [messages, setMessages] = useState(null);
  const [error, setError] = useState(null);
  const [live, setLive] = useState(null);
  const [hasMore, setHasMore] = useState(false);
  const [olderBusy, setOlderBusy] = useState(false);
  const [body, setBody] = useState('');
  const [replyTo, setReplyTo] = useState(null);
  const [editing, setEditing] = useState(null);
  const [editText, setEditText] = useState('');
  const [sending, setSending] = useState(false);
  const [sendErr, setSendErr] = useState(null);
  const [typing, setTypingUsers] = useState([]);
  const [emojiFor, setEmojiFor] = useState(null);
  const [revealed, setRevealed] = useState(new Set());
  const [reporting, setReporting] = useState(null);
  const [highlight, setHighlight] = useState(null);
  const [pop, setPop] = useState(null);
  const [mention, setMention] = useState(null); // { query, start, index }
  const listRef = useRef(null);
  const inputRef = useRef(null);
  const stick = useRef(true);
  const lastTypingSent = useRef(0);
  const readAt = useRef(conv.last_read_at);

  const markRead = useCallback(() => {
    api.markConversationRead(conversationId).then(() => { refreshCounts(); onRead?.(); }).catch(() => {});
  }, [conversationId, refreshCounts, onRead]);

  const load = useCallback(async () => {
    try {
      const list = await api.getMessages(conversationId);
      setMessages((prev) => [...(prev || []).filter((m) => list.length && m.id < list[0].id), ...list]);
      setError(null);
      return list;
    } catch (e) { setError(e); return null; }
  }, [conversationId]);

  const loadTyping = useCallback(() => { api.getTyping(conversationId).then(setTypingUsers).catch(() => {}); }, [conversationId]);

  useEffect(() => {
    setMessages(null); setError(null); setBody(''); setSendErr(null); setReplyTo(null); setEditing(null); stick.current = true;
    readAt.current = conv.last_read_at;
    load().then((l) => { if (l) { setHasMore(l.length >= 50); markRead(); } });
  }, [conversationId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => api.subscribe(`conv-${conversationId}`, [
    { event: '*', table: 'messages', filter: `conversation_id=eq.${conversationId}` },
    { event: '*', table: 'message_reactions' },
    { event: '*', table: 'conversation_typing', filter: `conversation_id=eq.${conversationId}` },
  ], (ev) => {
    if (ev?.table === 'conversation_typing') return loadTyping();
    load().then(() => markRead());
  }, setLive), [conversationId, load, markRead, loadTyping]);

  // Fallback polling when Realtime isn't connected; typing is cheap to poll either way.
  useInterval(() => { load().then((l) => { if (l?.length && l[l.length - 1].sender_id !== userId) markRead(); }); }, 4000, live !== true);
  useInterval(loadTyping, 3000, live !== true);

  useLayoutEffect(() => {
    const el = listRef.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [messages]);
  const onScroll = () => { const el = listRef.current; stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80; };

  const older = async () => {
    if (!messages?.length) return [];
    setOlderBusy(true);
    const el = listRef.current; const prevH = el.scrollHeight;
    try {
      const list = await api.getMessages(conversationId, messages[0].id);
      setHasMore(list.length >= 50);
      stick.current = false;
      setMessages((m) => [...list, ...m]);
      requestAnimationFrame(() => { el.scrollTop = el.scrollHeight - prevH; });
      return list;
    } catch (e) { setError(e); return []; } finally { setOlderBusy(false); }
  };

  const scrollToMessage = (id) => {
    const node = listRef.current?.querySelector(`[data-mid="${id}"]`);
    if (node) {
      stick.current = false;
      node.scrollIntoView({ block: 'center', behavior: 'smooth' });
      setHighlight(id); setTimeout(() => setHighlight(null), 1800);
      return true;
    }
    return false;
  };
  useImperativeHandle(ref, () => ({
    jumpTo: async (id) => {
      if (scrollToMessage(id)) return;
      toast('That message is further back. Scroll up and use "Load earlier messages".', 'info');
    },
    reload: load,
  }));

  // ---------- composer ----------
  const memberNames = useMemo(() => members.filter((m) => m.id !== userId && !m.unavailable), [members, userId]);
  const onBodyChange = (e) => {
    const v = e.target.value;
    setBody(v);
    const now = Date.now();
    if (v && now - lastTypingSent.current > 3000) { lastTypingSent.current = now; api.setTyping(conversationId).catch(() => {}); }
    const caret = e.target.selectionStart;
    const before = v.slice(0, caret);
    const m = before.match(/(^|\s)@([A-Za-z0-9_]{0,20})$/);
    setMention(m && memberNames.length ? { query: m[2].toLowerCase(), start: caret - m[2].length - 1, index: 0 } : null);
  };
  const suggestions = mention ? memberNames.filter((m) => m.username.toLowerCase().startsWith(mention.query)).slice(0, 8) : [];
  const pickMention = (u) => {
    const start = mention.start;
    const end = start + 1 + mention.query.length;
    const next = `${body.slice(0, start)}@${u.username} ${body.slice(end)}`;
    setBody(next); setMention(null);
    requestAnimationFrame(() => { const el = inputRef.current; if (el) { el.focus(); const pos = start + u.username.length + 2; el.setSelectionRange(pos, pos); } });
  };

  const send = async () => {
    const text = body.trim();
    if (!text || sending) return;
    setSending(true); setSendErr(null);
    try {
      const m = await api.sendMessage(conversationId, text, replyTo?.id);
      setBody(''); setReplyTo(null); stick.current = true; lastTypingSent.current = 0;
      setMessages((list) => (list?.some((x) => x.id === m.id) ? list : [...(list || []), m]));
    } catch (ex) { setSendErr(ex); } finally { setSending(false); }
  };
  const onKeyDown = (e) => {
    if (mention && suggestions.length) {
      if (e.key === 'ArrowDown') { e.preventDefault(); setMention((s) => ({ ...s, index: (s.index + 1) % suggestions.length })); return; }
      if (e.key === 'ArrowUp') { e.preventDefault(); setMention((s) => ({ ...s, index: (s.index - 1 + suggestions.length) % suggestions.length })); return; }
      if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); pickMention(suggestions[mention.index]); return; }
      if (e.key === 'Escape') { setMention(null); return; }
    }
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); return; }
    if (e.key === 'Escape' && replyTo) { setReplyTo(null); return; }
    if (e.key === 'ArrowUp' && !body) {
      const mine = [...(messages || [])].reverse().find((m) => m.sender_id === userId && !m.deleted && !m.removed);
      if (mine) { e.preventDefault(); startEdit(mine); }
    }
  };

  // ---------- message actions ----------
  const replace = (m) => setMessages((list) => list.map((x) => (x.id === m.id ? m : x)));
  const startEdit = (m) => { setEditing(m.id); setEditText(m.body); setEmojiFor(null); };
  const saveEdit = async () => {
    const text = editText.trim();
    const orig = messages.find((m) => m.id === editing);
    if (!text || text === orig?.body) { setEditing(null); return; }
    try { replace(await api.editMessage(editing, text)); setEditing(null); } catch (e) { toast(e, 'error'); }
  };
  const remove = (m) => confirm({
    title: 'Delete message?', body: <p className="msg-text" style={{ maxHeight: 160, overflow: 'auto' }}>{m.body}</p>,
    confirmLabel: 'Delete', danger: true,
    action: async () => { await api.deleteMessage(m.id); await load(); },
  });
  const react = async (m, emoji) => {
    setEmojiFor(null);
    try { await api.toggleReaction(m.id, emoji); await load(); } catch (e) { toast(e, 'error'); }
  };
  const pin = async (m) => {
    try { await api.pinMessage(m.id, !m.pinned); toast(m.pinned ? 'Message unpinned' : 'Message pinned'); await load(); } catch (e) { toast(e, 'error'); }
  };
  const openProfile = (e, user) => {
    if (!user?.id) return;
    const r = e.currentTarget.getBoundingClientRect();
    setPop({ user: members.find((m) => m.id === user.id) || user, x: r.right + 8, y: r.top });
  };

  let lastDay = null; let newShown = false;
  const typingText = typing.length === 0 ? null : typing.length === 1 ? `${typing[0]} is typing` : typing.length <= 3 ? `${typing.join(', ')} are typing` : 'Several people are typing';

  return (
    <div className="chat">
      <div className="chat-status" aria-live="polite">
        {live === true ? <span className="live"><LuWifi aria-hidden /> Live</span>
          : live === false ? <span className="polling" title="Realtime is unavailable, so new messages are checked every 4 seconds."><LuWifiOff aria-hidden /> Updating every few seconds</span>
          : null}
      </div>
      <div className="chat-list" ref={listRef} onScroll={onScroll} aria-label="Messages" role="log">
        {error && !messages ? <ErrorState error={error} onRetry={load} /> : messages === null ? (
          <div className="stack pad">{[60, 40, 70].map((w, i) => <Skeleton key={i} h={34} w={`${w}%`} />)}</div>
        ) : (
          <>
            {hasMore ? <div className="center pad"><Button size="sm" variant="ghost" loading={olderBusy} onClick={older}>Load earlier messages</Button></div>
              : <div className="chat-empty"><h3>{emptyTitle || 'Start of the conversation'}</h3><p>{emptyText || 'Say hi and plan your next session.'}</p></div>}
            {messages.map((m, i) => {
              const mine = m.sender_id === userId;
              const sender = m.sender || { username: 'Deleted account' };
              const day = dayLabel(m.created_at);
              const showDay = day !== lastDay; lastDay = day;
              const prev = messages[i - 1];
              const grouped = !showDay && !m.reply && prev && prev.sender_id === m.sender_id && !prev.deleted
                && new Date(m.created_at) - new Date(prev.created_at) < GROUP_GAP;
              const showNew = !newShown && !mine && readAt.current && new Date(m.created_at) > new Date(readAt.current);
              if (showNew) newShown = true;
              const hidden = m.sender_muted && !revealed.has(m.id);
              const canEdit = mine && !m.deleted && !m.removed;
              const canDelete = !m.deleted && !m.removed && (mine || conv.can_moderate);
              return (
                <div key={m.id}>
                  {showDay && <div className="day-sep"><span>{day}</span></div>}
                  {showNew && <div className="new-sep">New</div>}
                  <div data-mid={m.id} className={cx('msg', grouped && 'grouped', m.mentions_me && 'mention', highlight === m.id && 'highlight', emojiFor === m.id && 'menu-open')}>
                    <div className="msg-gutter">
                      {grouped ? <time dateTime={m.created_at}>{clockTime(m.created_at)}</time>
                        : <button type="button" className="avatar-btn" onClick={(e) => openProfile(e, sender)} aria-label={`${sender.username} profile`}><Avatar user={sender} size={40} /></button>}
                    </div>
                    <div className="msg-body">
                      {m.reply && (
                        <button type="button" className="reply-ref" onClick={() => m.reply.id && scrollToMessage(m.reply.id)}>
                          <LuCornerUpLeft aria-hidden /><b>{m.reply.missing ? 'Deleted message' : m.reply.sender_name || 'Unknown'}</b>
                          <span>{m.reply.body || 'Original message was deleted'}</span>
                        </button>
                      )}
                      {!grouped && (
                        <div className="msg-meta">
                          <button type="button" className={cx('msg-author', mine && 'mine')} onClick={(e) => openProfile(e, sender)}>{mine ? profile.username : sender.username}</button>
                          {sender.is_demo && <span className="badge badge-demo">Demo</span>}
                          <time dateTime={m.created_at} title={new Date(m.created_at).toLocaleString()}>{clockTime(m.created_at)}</time>
                          {m.pinned && <span className="badge"><LuPin aria-hidden /> Pinned</span>}
                        </div>
                      )}
                      {editing === m.id ? (
                        <div className="edit-box">
                          <textarea value={editText} autoFocus maxLength={2000} aria-label="Edit message" onChange={(e) => setEditText(e.target.value)}
                            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); saveEdit(); } if (e.key === 'Escape') setEditing(null); }} />
                          <div className="edit-hint">Enter to save, Esc to cancel</div>
                        </div>
                      ) : m.removed ? <p className="msg-text removed">Message removed by a moderator</p>
                        : m.deleted ? <p className="msg-text deleted">Message deleted</p>
                        : hidden ? <button type="button" className="btn btn-sm btn-ghost" onClick={() => setRevealed((s) => new Set(s).add(m.id))}><LuEyeOff aria-hidden /> Hidden message from a muted or blocked player — show</button>
                        : <div className="msg-text">{renderMessage(m.body, profile.username)}{m.edited_at && <span className="edited" title={new Date(m.edited_at).toLocaleString()}>(edited)</span>}</div>}
                      {m.reactions?.length > 0 && (
                        <div className="reactions">
                          {m.reactions.map((r) => (
                            <button key={r.emoji} type="button" className={cx('reaction', r.me && 'me')} onClick={() => react(m, r.emoji)}
                              aria-pressed={r.me} aria-label={`${r.emoji} ${r.count}${r.me ? ', you reacted' : ''}`}>{r.emoji} {r.count}</button>
                          ))}
                        </div>
                      )}
                    </div>
                    {!m.deleted && !m.removed && editing !== m.id && (
                      <div className="msg-tools" role="toolbar" aria-label="Message actions">
                        {conv.can_send && <IconButton icon={LuSmilePlus} label="Add reaction" onClick={() => setEmojiFor(emojiFor === m.id ? null : m.id)} />}
                        {conv.can_send && <IconButton icon={LuReply} label="Reply" onClick={() => { setReplyTo(m); inputRef.current?.focus(); }} />}
                        {canEdit && <IconButton icon={LuPencil} label="Edit message" onClick={() => startEdit(m)} />}
                        {conv.can_pin && <IconButton icon={m.pinned ? LuPinOff : LuPin} label={m.pinned ? 'Unpin message' : 'Pin message'} onClick={() => pin(m)} />}
                        {canDelete && <IconButton icon={LuTrash2} label="Delete message" onClick={() => remove(m)} />}
                        {!mine && m.sender_id && <IconButton icon={LuFlag} label="Report message" onClick={() => setReporting(m)} />}
                        {emojiFor === m.id && (
                          <div className="emoji-pop" role="menu" aria-label="Reactions">
                            {REACTIONS.map((e) => <button key={e} type="button" role="menuitem" aria-label={`React ${e}`} onClick={() => react(m, e)}>{e}</button>)}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </>
        )}
      </div>
      <div className="typing" aria-live="polite">{typingText && <><span className="dots" aria-hidden><i /><i /><i /></span>{typingText}…</>}</div>
      {conv.can_send ? (
        <div className="composer-wrap">
          {suggestions.length > 0 && (
            <div className="mention-pop" role="listbox" aria-label="Mention someone">
              <div className="head">Members</div>
              {suggestions.map((u, i) => (
                <button key={u.id} type="button" role="option" aria-selected={i === mention.index} className={cx(i === mention.index && 'sel')}
                  onMouseDown={(e) => { e.preventDefault(); pickMention(u); }}>
                  <Avatar user={u} size={22} /><span>{u.username}</span>
                </button>
              ))}
            </div>
          )}
          {replyTo && (
            <div className="reply-bar">
              <span>Replying to <b>{replyTo.sender?.username || 'message'}</b></span>
              <IconButton icon={LuX} label="Cancel reply" onClick={() => setReplyTo(null)} />
            </div>
          )}
          <form className="composer" onSubmit={(e) => { e.preventDefault(); send(); }}>
            <textarea ref={inputRef} rows={1} value={body} maxLength={2000} aria-label="Message"
              placeholder={conv.kind === 'channel' ? `Message #${conv.channel?.name}` : conv.kind === 'direct' ? `Message @${conv.other?.username}` : 'Write a message'}
              onChange={onBodyChange} onKeyDown={onKeyDown} onBlur={() => setTimeout(() => setMention(null), 150)} />
            <Button type="submit" variant="primary" icon={LuSend} loading={sending} disabled={!body.trim()} aria-label="Send" />
          </form>
          {(sendErr || body.length > 1800) && (
            <p className={cx('composer-note', sendErr && 'error-text')} role={sendErr ? 'alert' : undefined}>{sendErr ? sendErr.message : `${body.length}/2000`}</p>
          )}
        </div>
      ) : <p className="composer-off">{conv.send_block_reason || "You can't send messages here."}</p>}
      {reporting && <ReportDialog player={reporting.sender || { id: reporting.sender_id, username: 'this player' }} messageId={reporting.id} partyId={conv.party_id} onClose={() => setReporting(null)} />}
      {pop && <ProfilePopover user={pop.user} x={pop.x} y={pop.y} onClose={() => setPop(null)} />}
    </div>
  );
});

export default ChatThread;
