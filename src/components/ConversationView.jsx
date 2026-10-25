import { useRef, useState } from 'react';
import { LuPin, LuSearch, LuUsers, LuBell, LuBellOff, LuX } from 'react-icons/lu';
import * as api from '../lib/api.js';
import { useApp } from '../context/AppContext.jsx';
import { useAsync } from '../hooks/useAsync.js';
import { clockTime, dayLabel } from '../lib/format.js';
import { renderMessage } from '../lib/markdown.jsx';
import { cx, IconButton, Input, Skeleton } from './ui.jsx';
import { useToast } from './feedback.jsx';
import { Avatar } from './gaming.jsx';
import ChatThread from './ChatThread.jsx';
import ProfilePopover from './ProfilePopover.jsx';

function ResultList({ items, onPick, empty }) {
  const { profile } = useApp();
  if (!items) return <div className="pad"><Skeleton h={50} /></div>;
  if (items.length === 0) return <p className="muted small pad">{empty}</p>;
  return (
    <div className="result-list">
      {items.map((m) => (
        <button key={m.id} type="button" className="result" onClick={() => onPick(m)}>
          <div className="meta"><b>{m.sender?.username || 'Deleted account'}</b> {dayLabel(m.created_at)} {clockTime(m.created_at)}</div>
          <div className="msg-text">{renderMessage(m.body, profile.username)}</div>
        </button>
      ))}
    </div>
  );
}

export function MemberList({ members, title = 'Members' }) {
  const [pop, setPop] = useState(null);
  const groups = [
    ['Owner', members.filter((m) => m.role === 'owner' || m.is_owner)],
    ['Admins', members.filter((m) => m.role === 'admin')],
    ['Online', members.filter((m) => !['owner', 'admin'].includes(m.role) && !m.is_owner && m.status !== 'offline')],
    ['Offline', members.filter((m) => !['owner', 'admin'].includes(m.role) && !m.is_owner && m.status === 'offline')],
  ].filter(([, l]) => l.length);
  return (
    <>
      {groups.map(([label, list]) => (
        <div key={label}>
          <h3>{label} ({list.length})</h3>
          {list.map((m) => (
            <button key={m.id} type="button" className={cx('member-row', m.status === 'offline' && label !== 'Owner' && label !== 'Admins' && 'offline', m.role && `role-${m.role}`, m.is_owner && 'role-owner')}
              onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); setPop({ user: m, x: r.left - 290, y: r.top }); }}>
              <Avatar user={m} size={30} status={m.status} />
              <span className="who"><strong>{m.username}</strong>{m.custom_status && <small>{m.custom_status}</small>}</span>
            </button>
          ))}
        </div>
      ))}
      {members.length === 0 && <p className="muted small pad">{title} will show up here.</p>}
      {pop && <ProfilePopover user={pop.user} x={Math.max(8, pop.x)} y={pop.y} onClose={() => setPop(null)} />}
    </>
  );
}

/**
 * Header + chat + optional side panel (pins, search, members) for one conversation.
 * `title` is the header content; `memberPanel` renders the member list when available.
 */
export default function ConversationView({ conv, onChanged, title, topic, members = [], memberPanel, tools, emptyTitle, emptyText, defaultPanel = null, stage }) {
  const toast = useToast();
  const [panel, setPanel] = useState(defaultPanel && window.innerWidth > 1100 ? defaultPanel : null);
  const [q, setQ] = useState('');
  const [results, setResults] = useState(null);
  const thread = useRef(null);
  const pins = useAsync(() => (panel === 'pins' ? api.listPins(conv.id) : Promise.resolve(null)), [panel, conv.id, conv.pin_count]);
  const toggle = (p) => { setPanel((cur) => (cur === p ? null : p)); };
  const search = async (e) => {
    e.preventDefault();
    if (q.trim().length < 2) return;
    setResults(null);
    try { setResults(await api.searchMessages(conv.id, q.trim())); } catch (ex) { toast(ex, 'error'); setResults([]); }
  };
  const mute = async () => {
    try { await api.setConversationMuted(conv.id, !conv.muted); toast(conv.muted ? 'Notifications on' : 'Muted — no message notifications (mentions still notify)'); onChanged?.(); }
    catch (e) { toast(e, 'error'); }
  };
  const jump = (m) => { thread.current?.jumpTo(m.id); if (window.innerWidth <= 960) setPanel(null); };

  return (
    <div className="conv-layout">
      <div className="conv-main">
        <header className="conv-head">
          <div className="title">{title}</div>
          {topic && <div className="topic" title={topic}>{topic}</div>}
          <div className="tools">
            {tools}
            <IconButton icon={conv.muted ? LuBellOff : LuBell} label={conv.muted ? 'Unmute conversation' : 'Mute conversation'} onClick={mute} className={cx(conv.muted && 'on')} />
            <IconButton icon={LuPin} label={`Pinned messages${conv.pin_count ? ` (${conv.pin_count})` : ''}`} onClick={() => toggle('pins')} className={cx(panel === 'pins' && 'on')} />
            <IconButton icon={LuSearch} label="Search messages" onClick={() => toggle('search')} className={cx(panel === 'search' && 'on')} />
            {memberPanel && <IconButton icon={LuUsers} label="Member list" onClick={() => toggle('members')} className={cx(panel === 'members' && 'on')} />}
          </div>
        </header>
        {stage}
        <ChatThread ref={thread} conv={conv} members={members} onRead={onChanged} emptyTitle={emptyTitle} emptyText={emptyText} />
      </div>
      {panel && (
        <aside className="side-panel" aria-label={panel === 'pins' ? 'Pinned messages' : panel === 'search' ? 'Search' : 'Members'}>
          <div className="side-panel-head">
            <span>{panel === 'pins' ? 'Pinned messages' : panel === 'search' ? 'Search' : 'Members'}</span>
            <IconButton icon={LuX} label="Close panel" onClick={() => setPanel(null)} />
          </div>
          {panel === 'pins' && <div style={{ paddingTop: 10 }}><ResultList items={pins.data} onPick={jump} empty={conv.can_pin ? 'Nothing pinned yet. Hover a message and pick the pin icon.' : 'Nothing pinned yet.'} /></div>}
          {panel === 'search' && (
            <>
              <form className="search-box" onSubmit={search}>
                <Input type="search" placeholder="Search this conversation" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search messages" autoFocus />
              </form>
              {results !== null ? <ResultList items={results} onPick={jump} empty="No messages found." /> : <p className="muted small pad">Type at least 2 characters and press Enter.</p>}
            </>
          )}
          {panel === 'members' && memberPanel}
        </aside>
      )}
    </div>
  );
}
