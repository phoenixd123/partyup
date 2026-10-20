import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { LuMessageCircle, LuUser } from 'react-icons/lu';
import * as api from '../lib/api.js';
import { navigate } from '../lib/router.jsx';
import { useApp } from '../context/AppContext.jsx';
import { Avatar, Presence } from './gaming.jsx';
import { Button, DemoBadge } from './ui.jsx';
import { useToast } from './feedback.jsx';

const ROLE = { owner: 'Owner', admin: 'Admin' };

/** Small profile card anchored near a clicked name or avatar. */
export default function ProfilePopover({ user, x, y, onClose }) {
  const { userId } = useApp();
  const toast = useToast();
  const ref = useRef(null);
  const [pos, setPos] = useState({ left: x, top: y });
  const [busy, setBusy] = useState(false);
  useLayoutEffect(() => {
    const el = ref.current; if (!el) return;
    const w = el.offsetWidth; const h = el.offsetHeight;
    let left = x; let top = y;
    if (left + w > window.innerWidth - 8) left = Math.max(8, x - w - 60);
    if (top + h > window.innerHeight - 8) top = Math.max(8, window.innerHeight - h - 8);
    setPos({ left, top });
  }, [x, y]);
  useEffect(() => {
    const close = (e) => { if (!ref.current?.contains(e.target)) onClose(); };
    const key = (e) => { if (e.key === 'Escape') onClose(); };
    setTimeout(() => document.addEventListener('mousedown', close), 0);
    document.addEventListener('keydown', key);
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', key); };
  }, [onClose]);
  const message = async () => {
    setBusy(true);
    try { const id = await api.openDirectConversation(user.id); onClose(); navigate(`/messages/${id}`); }
    catch (e) { toast(e, 'error'); setBusy(false); }
  };
  return createPortal(
    <div className="pop-card" ref={ref} style={pos} role="dialog" aria-label={`${user.username} profile card`}>
      <div className="pop-band" style={{ background: '#2a2c31' }} />
      <div className="pop-body">
        <Avatar user={user} size={64} status={user.status} />
        <div>
          <div className="pop-name">{user.username} {user.is_demo && <DemoBadge />}</div>
          {user.role && ROLE[user.role] && <span className="badge">{ROLE[user.role]}</span>}
          {user.custom_status && <div className="custom-status">{user.custom_status}</div>}
          {user.status !== undefined && <Presence user={user} />}
        </div>
        <div className="pop-row">
          {user.id !== userId && <Button size="sm" variant="primary" icon={LuMessageCircle} loading={busy} onClick={message}>Message</Button>}
          <Button size="sm" icon={LuUser} onClick={() => { onClose(); navigate(`/players/${user.id}`); }}>View profile</Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
