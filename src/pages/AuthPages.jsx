import { useEffect, useState } from 'react';
import { LuMailCheck, LuExternalLink } from 'react-icons/lu';
import { FcGoogle } from 'react-icons/fc';
import { supabase, config, authRedirect, desktop } from '../lib/supabase.js';
import { Link, navigate } from '../lib/router.jsx';
import { useApp } from '../context/AppContext.jsx';
import Logo from '../components/Logo.jsx';
import { Button, Field, Input, InlineError } from '../components/ui.jsx';
import { useToast } from '../components/feedback.jsx';

function AuthLayout({ title, sub, children, foot }) {
  return (
    <div className="auth">
      <div className="auth-side" aria-hidden>
        <div className="auth-pitch">
          <Logo />
          <p className="auth-line">Stop solo queueing. Find people who play your game, at your rank, when you're online.</p>
          <ul className="auth-points">
            <li>Match on rank, roles, language, region and schedule</li>
            <li>Build parties with open slots and needed roles</li>
            <li>Block, mute and report built in</li>
          </ul>
        </div>
      </div>
      <div className="auth-main">
        <div className="auth-card">
          <div className="auth-logo-m"><Logo /></div>
          <h1>{title}</h1>
          {sub && <p className="sub">{sub}</p>}
          {children}
          {foot && <div className="auth-foot">{foot}</div>}
        </div>
      </div>
    </div>
  );
}

// Which OAuth providers the Supabase project has switched on (public endpoint).
let providersPromise = null;
function enabledProviders() {
  if (!providersPromise) {
    providersPromise = fetch(`${config.url}/auth/v1/settings`, { headers: { apikey: config.anonKey } })
      .then((r) => (r.ok ? r.json() : null))
      .then((s) => s?.external || null)
      .catch(() => null);
  }
  return providersPromise;
}

function GoogleButton({ label = 'Continue with Google' }) {
  const { authError, setAuthError } = useApp();
  const [available, setAvailable] = useState(null); // null = unknown → show button
  const [busy, setBusy] = useState(false);
  const [waiting, setWaiting] = useState(false); // desktop: finishing in the browser
  useEffect(() => { enabledProviders().then((p) => setAvailable(p ? Boolean(p.google) : null)); }, []);
  useEffect(() => { if (authError) { setWaiting(false); setBusy(false); } }, [authError]);
  if (available === false) return null;
  const start = async () => {
    setBusy(true); setAuthError(null);
    const { data, error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: authRedirect(), skipBrowserRedirect: Boolean(desktop), queryParams: { prompt: 'select_account' } },
    });
    if (error) { setBusy(false); setAuthError(authError(error)); return; }
    if (desktop) {
      // Sign in happens in the user's normal browser; it hands back to the app via partyup://
      try { await desktop.openExternal(data.url); setWaiting(true); }
      catch (e) { setAuthError(e); }
      setBusy(false);
    }
    // Web: the browser is now navigating to Google.
  };
  if (waiting) {
    return (
      <div className="notice" role="status">
        <LuExternalLink aria-hidden />
        <div className="stack-xs">
          <p>Finish signing in with Google in your browser. PartyUp will pick it up automatically.</p>
          <div className="row gap-s">
            <Button size="sm" onClick={start}>Open the browser again</Button>
            <Button size="sm" variant="ghost" onClick={() => setWaiting(false)}>Cancel</Button>
          </div>
        </div>
      </div>
    );
  }
  return (
    <>
      <Button size="lg" className="btn-oauth" icon={FcGoogle} onClick={start} loading={busy}>{label}</Button>
      <div className="or-sep" role="separator"><span>or</span></div>
    </>
  );
}

function authError(e) {
  const m = e?.message || '';
  if (/invalid login credentials/i.test(m)) return new Error('Email or password is incorrect.');
  if (/email not confirmed/i.test(m)) return new Error('Confirm your email first — check your inbox for the link.');
  if (/user already registered/i.test(m)) return new Error('An account with this email already exists. Sign in instead.');
  if (/rate limit/i.test(m)) return new Error('Too many attempts. Wait a minute and try again.');
  if (/Failed to fetch|NetworkError/i.test(m)) return new Error("Can't reach PartyUp right now. Check your internet connection and try again.");
  return e;
}

export function LoginPage() {
  const { authError: redirectError } = useApp();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const submit = async (e) => {
    e.preventDefault(); setBusy(true); setErr(null);
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    setBusy(false);
    if (error) setErr(authError(error));
  };
  return (
    <AuthLayout title="Sign in" foot={<>New to PartyUp? <Link to="/signup">Create an account</Link></>}>
      <InlineError error={redirectError} />
      <GoogleButton />
      <form onSubmit={submit} className="stack">
        <Field label="Email" htmlFor="li-email"><Input id="li-email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
        <Field label="Password" htmlFor="li-pass">
          <Input id="li-pass" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
        </Field>
        <div className="row between"><Link to="/forgot" className="small">Forgot password?</Link></div>
        <InlineError error={err} />
        <Button type="submit" variant="primary" size="lg" loading={busy}>Sign in</Button>
      </form>
    </AuthLayout>
  );
}

export function SignupPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const [sent, setSent] = useState(false);
  const submit = async (e) => {
    e.preventDefault(); setErr(null);
    if (password.length < 8) return setErr(new Error('Use at least 8 characters for your password.'));
    if (password !== confirm) return setErr(new Error("Passwords don't match."));
    setBusy(true);
    const { data, error } = await supabase.auth.signUp({ email: email.trim(), password, options: { emailRedirectTo: authRedirect() } });
    setBusy(false);
    if (error) return setErr(authError(error));
    if (!data.session) setSent(true); // email confirmation is on
  };
  if (sent) {
    return (
      <AuthLayout title="Check your email" foot={<Link to="/login">Back to sign in</Link>}>
        <div className="notice"><LuMailCheck aria-hidden /><p>We sent a confirmation link to <b>{email}</b>. Open it on this device to finish creating your account.{desktop ? ' The link reopens the PartyUp app.' : ''}</p></div>
      </AuthLayout>
    );
  }
  return (
    <AuthLayout title="Create your account" sub="You'll pick a username and set up your gaming profile next."
      foot={<>Already have an account? <Link to="/login">Sign in</Link></>}>
      <GoogleButton label="Sign up with Google" />
      <form onSubmit={submit} className="stack">
        <Field label="Email" htmlFor="su-email" hint="Never shown to other players."><Input id="su-email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
        <Field label="Password" htmlFor="su-pass" hint="At least 8 characters."><Input id="su-pass" type="password" autoComplete="new-password" required value={password} onChange={(e) => setPassword(e.target.value)} /></Field>
        <Field label="Confirm password" htmlFor="su-pass2"><Input id="su-pass2" type="password" autoComplete="new-password" required value={confirm} onChange={(e) => setConfirm(e.target.value)} /></Field>
        <InlineError error={err} />
        <Button type="submit" variant="primary" size="lg" loading={busy}>Create account</Button>
      </form>
    </AuthLayout>
  );
}

export function ForgotPage() {
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const [sent, setSent] = useState(false);
  const submit = async (e) => {
    e.preventDefault(); setBusy(true); setErr(null);
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo: authRedirect() });
    setBusy(false);
    if (error) setErr(authError(error)); else setSent(true);
  };
  return (
    <AuthLayout title="Reset your password" sub={sent ? null : "Enter your email and we'll send you a reset link."} foot={<Link to="/login">Back to sign in</Link>}>
      {sent ? (
        <div className="notice"><LuMailCheck aria-hidden /><p>If an account exists for <b>{email}</b>, a reset link is on its way. The link opens {desktop ? 'PartyUp' : 'a page'} where you choose a new password.</p></div>
      ) : (
        <form onSubmit={submit} className="stack">
          <Field label="Email" htmlFor="fp-email"><Input id="fp-email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
          <InlineError error={err} />
          <Button type="submit" variant="primary" size="lg" loading={busy}>Send reset link</Button>
        </form>
      )}
    </AuthLayout>
  );
}

export function ResetPage() {
  const { session, setRecovery } = useApp();
  const toast = useToast();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  if (!session) {
    return (
      <AuthLayout title="Reset link expired" foot={<Link to="/login">Back to sign in</Link>}>
        <p>This reset link is invalid or has expired. Request a new one.</p>
        <Button variant="primary" onClick={() => navigate('/forgot')}>Request a new link</Button>
      </AuthLayout>
    );
  }
  const submit = async (e) => {
    e.preventDefault(); setErr(null);
    if (password.length < 8) return setErr(new Error('Use at least 8 characters.'));
    if (password !== confirm) return setErr(new Error("Passwords don't match."));
    setBusy(true);
    const { error } = await supabase.auth.updateUser({ password });
    setBusy(false);
    if (error) return setErr(authError(error));
    toast('Password updated');
    setRecovery(false);
    navigate('/', { replace: true });
  };
  return (
    <AuthLayout title="Choose a new password">
      <form onSubmit={submit} className="stack">
        <Field label="New password" htmlFor="rp-pass" hint="At least 8 characters."><Input id="rp-pass" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} /></Field>
        <Field label="Confirm new password" htmlFor="rp-pass2"><Input id="rp-pass2" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} /></Field>
        <InlineError error={err} />
        <Button type="submit" variant="primary" size="lg" loading={busy}>Update password</Button>
      </form>
    </AuthLayout>
  );
}
