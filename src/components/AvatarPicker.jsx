import { useRef, useState } from 'react';
import { LuUpload } from 'react-icons/lu';
import * as api from '../lib/api.js';
import { AVATAR_PRESETS } from '../lib/constants.js';
import { Avatar } from './gaming.jsx';
import { Button, cx, InlineError } from './ui.jsx';

export default function AvatarPicker({ userId, username, value, onChange }) {
  const file = useRef(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const upload = async (e) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    setBusy(true); setErr(null);
    try { onChange(await api.uploadAvatar(userId, f)); } catch (ex) { setErr(ex); } finally { setBusy(false); }
  };
  return (
    <div className="avatar-picker">
      <Avatar user={{ username, avatar_url: value }} size={72} />
      <div className="grow">
        <div className="preset-row" role="radiogroup" aria-label="Preset avatars">
          {AVATAR_PRESETS.map((p) => (
            <button key={p} type="button" role="radio" aria-checked={value === p} className={cx('preset', value === p && 'on')} onClick={() => onChange(p)}>
              <Avatar user={{ username, avatar_url: p }} size={36} />
            </button>
          ))}
        </div>
        <div className="row gap-s">
          <Button size="sm" icon={LuUpload} loading={busy} onClick={() => file.current?.click()}>Upload image</Button>
          {value && <Button size="sm" variant="ghost" onClick={() => onChange(null)}>Use initials</Button>}
          <input ref={file} type="file" accept="image/png,image/jpeg,image/webp,image/gif" hidden onChange={upload} />
        </div>
        <p className="muted small">PNG, JPG, WebP or GIF up to 2 MB.</p>
        <InlineError error={err} />
      </div>
    </div>
  );
}
