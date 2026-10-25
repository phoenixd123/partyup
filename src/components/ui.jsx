import { LuSearch, LuUsers, LuPartyPopper, LuHeartHandshake, LuGamepad2, LuBell, LuSettings, LuZap, LuTrophy, LuSwords, LuCompass, LuShieldCheck, LuScale, LuMessageCircle, LuCrown, LuRadio } from 'react-icons/lu';
import { FunLoader } from './Seasonal.jsx';
import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { LuX, LuTriangleAlert, LuRefreshCw, LuCheck, LuChevronDown } from 'react-icons/lu';

const cx = (...c) => c.filter(Boolean).join(' ');
export { cx };

export function Button({ variant = 'secondary', size, loading, icon: Icon, children, className, disabled, type = 'button', ...rest }) {
  return (
    <button type={type} className={cx('btn', `btn-${variant}`, size && `btn-${size}`, className)} disabled={disabled || loading} aria-busy={loading || undefined} {...rest}>
      {loading ? <Spinner size={14} /> : Icon ? <Icon aria-hidden /> : null}
      {children && <span>{children}</span>}
    </button>
  );
}

export function IconButton({ icon: Icon, label, className, badge, ...rest }) {
  return (
    <button type="button" className={cx('icon-btn', className)} aria-label={label} title={label} {...rest}>
      <Icon aria-hidden />
      {badge ? <span className="count-badge">{badge > 99 ? '99+' : badge}</span> : null}
    </button>
  );
}

export function Spinner({ size = 18, label }) {
  return <span className="spinner" style={{ width: size, height: size }} role={label ? 'status' : undefined} aria-label={label} />;
}

// Loading screen with a rotating tip, fun fact or (in season) something spooky.
export function PageLoader({ label, full }) {
  return <div className={full ? 'page-loader full' : 'page-loader'}><FunLoader label={label} full={full} /></div>;
}

export function Skeleton({ h = 16, w = '100%', r, className }) {
  return <span className={cx('skeleton', className)} style={{ height: h, width: w, borderRadius: r }} aria-hidden />;
}

export function SkeletonCards({ count = 6, h = 190 }) {
  return <div className="card-grid" aria-busy="true">{Array.from({ length: count }, (_, i) => <Skeleton key={i} h={h} r={14} />)}</div>;
}

export function Badge({ tone = 'neutral', children, className, title }) {
  return <span className={cx('badge', `badge-${tone}`, className)} title={title}>{children}</span>;
}

export function DemoBadge() {
  return <Badge tone="demo" title="Sample profile for development — not a real player">Demo</Badge>;
}

/** Multi- or single-select chips. value: array (multi) or string (single) */
export function ChipSelect({ options, value, onChange, multi = true, max, size, ariaLabel }) {
  const selected = multi ? new Set(value || []) : new Set(value ? [value] : []);
  const toggle = (v) => {
    if (!multi) return onChange(selected.has(v) ? null : v);
    const next = new Set(selected);
    if (next.has(v)) next.delete(v);
    else { if (max && next.size >= max) return; next.add(v); }
    onChange([...next]);
  };
  return (
    <div className={cx('chips', size === 'sm' && 'chips-sm')} role="group" aria-label={ariaLabel}>
      {options.map((o) => {
        const on = selected.has(o.value);
        return (
          <button key={o.value} type="button" className={cx('chip', on && 'chip-on')} aria-pressed={on} onClick={() => toggle(o.value)}
            disabled={!on && multi && max && selected.size >= max}>
            {on && <LuCheck aria-hidden className="chip-check" />}{o.label}
          </button>
        );
      })}
    </div>
  );
}

export function Field({ label, hint, error, children, htmlFor, optional, className }) {
  return (
    <div className={cx('field', error && 'field-error', className)}>
      {label && <label className="field-label" htmlFor={htmlFor}>{label}{optional && <span className="optional"> optional</span>}</label>}
      {children}
      {error ? <p className="field-msg error-text" role="alert">{error}</p> : hint ? <p className="field-msg">{hint}</p> : null}
    </div>
  );
}

export function Input({ className, ...rest }) { return <input className={cx('input', className)} {...rest} />; }
export function Textarea({ className, ...rest }) { return <textarea className={cx('input textarea', className)} {...rest} />; }

function renderOptions(options) {
  if (!options.some((o) => o.group)) return options.map((o) => <option key={o.value} value={o.value} disabled={o.disabled}>{o.label}</option>);
  const groups = [];
  for (const o of options) {
    let g = groups.find((x) => x.name === o.group);
    if (!g) { g = { name: o.group, items: [] }; groups.push(g); }
    g.items.push(o);
  }
  return groups.map((g) => <optgroup key={g.name} label={g.name}>{g.items.map((o) => <option key={o.value} value={o.value} disabled={o.disabled}>{o.label}</option>)}</optgroup>);
}

export function Select({ options, value, onChange, placeholder, className, ...rest }) {
  return (
    <div className={cx('select-wrap', className)}>
      <select className="input select" value={value ?? ''} onChange={(e) => onChange(e.target.value || null)} {...rest}>
        {placeholder !== undefined && <option value="">{placeholder}</option>}
        {renderOptions(options)}
      </select>
      <LuChevronDown className="select-caret" aria-hidden />
    </div>
  );
}

export function Toggle({ checked, onChange, label, hint, disabled }) {
  const id = useId();
  return (
    <label className={cx('toggle-row', disabled && 'is-disabled')} htmlFor={id}>
      <span className="toggle-text"><span>{label}</span>{hint && <small>{hint}</small>}</span>
      <span className="toggle">
        <input id={id} type="checkbox" role="switch" checked={!!checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
        <span className="toggle-track"><span className="toggle-thumb" /></span>
      </span>
    </label>
  );
}

export function Segmented({ options, value, onChange, ariaLabel }) {
  return (
    <div className="segmented" role="radiogroup" aria-label={ariaLabel}>
      {options.map((o) => (
        <button key={o.value} type="button" role="radio" aria-checked={value === o.value} className={cx(value === o.value && 'on')} onClick={() => onChange(o.value)}>
          {o.label}{o.count ? <span className="seg-count">{o.count}</span> : null}
        </button>
      ))}
    </div>
  );
}

export function EmptyState({ icon: Icon, title, children, action }) {
  return (
    <div className="empty">
      {Icon && <span className="empty-icon"><Icon aria-hidden /></span>}
      <h3>{title}</h3>
      {children && <div className="empty-body">{children}</div>}
      {action && <div className="empty-action">{action}</div>}
    </div>
  );
}

export function ErrorState({ error, onRetry, title = "Couldn't load this" }) {
  return (
    <div className="empty error-state" role="alert">
      <span className="empty-icon"><LuTriangleAlert aria-hidden /></span>
      <h3>{title}</h3>
      <div className="empty-body">{error?.message || String(error)}</div>
      {onRetry && <div className="empty-action"><Button icon={LuRefreshCw} onClick={() => onRetry()}>Try again</Button></div>}
    </div>
  );
}

export function InlineError({ error }) {
  if (!error) return null;
  return <p className="inline-error" role="alert"><LuTriangleAlert aria-hidden /> {error.message || String(error)}</p>;
}

export function Modal({ open, onClose, title, children, footer, size = 'md', labelledBy }) {
  const ref = useRef(null);
  const tid = useId();
  useEffect(() => {
    if (!open) return undefined;
    const prev = document.activeElement;
    const onKey = (e) => { if (e.key === 'Escape') onClose?.(); };
    document.addEventListener('keydown', onKey);
    document.body.classList.add('no-scroll');
    setTimeout(() => {
      const el = ref.current?.querySelector('[data-autofocus], input, select, textarea, button:not(.modal-x)');
      el?.focus();
    }, 20);
    return () => { document.removeEventListener('keydown', onKey); document.body.classList.remove('no-scroll'); prev?.focus?.(); };
  }, [open, onClose]);
  if (!open) return null;
  return createPortal(
    <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose?.(); }}>
      <div className={cx('modal', `modal-${size}`)} role="dialog" aria-modal="true" aria-labelledby={labelledBy || tid} ref={ref}>
        <header className="modal-head">
          <h2 id={tid}>{title}</h2>
          <button type="button" className="icon-btn modal-x" aria-label="Close" onClick={onClose}><LuX /></button>
        </header>
        <div className="modal-body">{children}</div>
        {footer && <footer className="modal-foot">{footer}</footer>}
      </div>
    </div>,
    document.body,
  );
}

/** Small dropdown menu. items: [{label, icon, onClick, danger, hidden}] */
export function Menu({ trigger, items, align = 'right' }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const close = (e) => { if (!ref.current?.contains(e.target)) setOpen(false); };
    const key = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', key);
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', key); };
  }, [open]);
  return (
    <div className="menu-wrap" ref={ref}>
      {trigger({ open, toggle: () => setOpen((o) => !o) })}
      {open && (
        <div className={cx('menu', `menu-${align}`)} role="menu">
          {items.filter((i) => !i.hidden).map((i) => (
            <button key={i.label} type="button" role="menuitem" className={cx('menu-item', i.danger && 'danger')}
              onClick={() => { setOpen(false); i.onClick(); }}>
              {i.icon && <i.icon aria-hidden />}{i.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

const HEADER_ICONS = {
  'Find Players': LuSearch, Parties: LuUsers, 'Create a party': LuPartyPopper, Friends: LuHeartHandshake, 'Game Profiles': LuGamepad2,
  Notifications: LuBell, Settings: LuSettings, 'Quick Match': LuZap, Tournaments: LuTrophy, 'Host a tournament': LuSwords,
  'Explore communities': LuCompass, Leaderboard: LuCrown, 'Ready Now': LuRadio, Moderation: LuShieldCheck, 'PartyUp Tournament Agreement': LuScale, Messages: LuMessageCircle,
};

export function PageHeader({ title, sub, actions, children, icon }) {
  const Icon = icon || (typeof title === 'string' ? HEADER_ICONS[title] : null);
  return (
    <div className="page-head">
      <div className="page-head-text">
        <h1>{Icon && <span className="head-icon" aria-hidden><Icon /></span>}{title}</h1>
        {sub && <p className="sub">{sub}</p>}
      </div>
      {actions && <div className="page-actions">{actions}</div>}
      {children}
    </div>
  );
}

export function Panel({ title, action, children, className, id }) {
  return (
    <section className={cx('panel', className)} aria-labelledby={title ? `${id || title}-h` : undefined}>
      {(title || action) && (
        <div className="panel-head">
          {title && <h2 id={`${id || title}-h`}>{title}</h2>}
          {action}
        </div>
      )}
      {children}
    </section>
  );
}
