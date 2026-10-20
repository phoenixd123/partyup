import { createContext, useCallback, useContext, useRef, useState } from 'react';
import { LuCircleCheck, LuCircleAlert, LuInfo, LuX } from 'react-icons/lu';
import { Button, Input, Modal } from './ui.jsx';

const ToastCtx = createContext(null);
const ConfirmCtx = createContext(null);

export function FeedbackProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const idRef = useRef(0);
  const dismiss = useCallback((id) => setToasts((t) => t.filter((x) => x.id !== id)), []);
  const toast = useCallback((message, tone = 'success') => {
    const id = ++idRef.current;
    setToasts((t) => [...t.slice(-3), { id, message: message?.message || message, tone }]);
    setTimeout(() => dismiss(id), tone === 'error' ? 6000 : 3500);
  }, [dismiss]);

  const [dlg, setDlg] = useState(null);
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  /** confirm({title, body, confirmLabel, danger, requireText, action}) → resolves true/false.
   *  If `action` is given it runs inside the dialog and errors are shown there. */
  const confirm = useCallback((opts) => new Promise((resolve) => {
    setTyped(''); setErr(null); setBusy(false);
    setDlg({ ...opts, resolve });
  }), []);
  const close = (result) => { dlg?.resolve(result); setDlg(null); };
  const accept = async () => {
    if (!dlg.action) return close(true);
    setBusy(true); setErr(null);
    try { await dlg.action(); close(true); }
    catch (e) { setErr(e); setBusy(false); }
  };
  const blocked = dlg?.requireText && typed.trim().toLowerCase() !== dlg.requireText.toLowerCase();

  const Icon = { success: LuCircleCheck, error: LuCircleAlert, info: LuInfo };
  return (
    <ToastCtx.Provider value={toast}>
      <ConfirmCtx.Provider value={confirm}>
        {children}
        <Modal open={!!dlg} onClose={() => !busy && close(false)} title={dlg?.title} size="sm"
          footer={<>
            <Button variant="ghost" onClick={() => close(false)} disabled={busy}>Cancel</Button>
            <Button variant={dlg?.danger ? 'danger' : 'primary'} onClick={accept} loading={busy} disabled={blocked} data-autofocus={!dlg?.requireText || undefined}>
              {dlg?.confirmLabel || 'Confirm'}
            </Button>
          </>}>
          {dlg?.body && <div className="confirm-body">{dlg.body}</div>}
          {dlg?.requireText && (
            <label className="field">
              <span className="field-label">Type <strong>{dlg.requireText}</strong> to confirm</span>
              <Input value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" data-autofocus />
            </label>
          )}
          {err && <p className="inline-error" role="alert">{err.message}</p>}
        </Modal>
        <div className="toasts" aria-live="polite">
          {toasts.map((t) => {
            const I = Icon[t.tone] || LuInfo;
            return (
              <div key={t.id} className={`toast toast-${t.tone}`} role={t.tone === 'error' ? 'alert' : 'status'}>
                <I aria-hidden /><span>{t.message}</span>
                <button type="button" className="toast-x" aria-label="Dismiss" onClick={() => dismiss(t.id)}><LuX /></button>
              </div>
            );
          })}
        </div>
      </ConfirmCtx.Provider>
    </ToastCtx.Provider>
  );
}

export const useToast = () => useContext(ToastCtx);
export const useConfirm = () => useContext(ConfirmCtx);
