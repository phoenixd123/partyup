import { useEffect, useState } from 'react';
import { LuMailCheck, LuExternalLink, LuTriangleAlert } from 'react-icons/lu';
import { FcGoogle } from 'react-icons/fc';
import { supabase, config, authRedirect, desktop } from '../lib/supabase.js';
import { Link, navigate } from '../lib/router.jsx';
import { useApp } from '../context/AppContext.jsx';
import Logo from '../components/Logo.jsx';
import { Button, Field, Input, InlineError } from '../components/ui.jsx';
import { useToast } from '../components/feedback.jsx';
import { Pumpkin, useSeason } from '../components/Seasonal.jsx';
import { randomLine } from '../lib/flavor.js';

function AuthFact() {
  const season = useSeason();
  const [line, setLine] = useState(() => randomLine());
  useEffect(() => { const t = setInterval(() => setLine(randomLine()), 7000); return () => clearInterval(t); }, []);
  return (
    <div className="auth-fact">
      {season === 'halloween' && <Pumpkin size={40} className="bob" />}
      <p key={line}>{line}</p>
    </div>
  );
}

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
            <li>Communities, DMs and group chats</li>
            <li>Block, mute and report built in</li>
          </ul>
          <AuthFact />
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
  if (/email not confirmed/i.test(m)) return new Error('Confirm your email first — use the code or button in the email we sent.');
  if (/user already registered/i.test(m)) return new Error('An account with this email already exists. Sign in instead.');
  if (/rate limit/i.test(m)) return new Error('Too many attempts. Wait a minute and try again.');
  if (/Failed to fetch|NetworkError/i.test(m)) return new Error("Can't reach PartyUp right now. Check your internet connection and try again.");
  return e;
}

// Enter the code from the email (works anywhere, no link needed) — or click the email's button.
function VerifyCode({ email, kind, onBack }) {
  const { setRecovery } = useApp();
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const [cooldown, setCooldown] = useState(45);
  const [resent, setResent] = useState(false);
  useEffect(() => {
    if (cooldown <= 0) return undefined;
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);
  const verify = async (e) => {
    e?.preventDefault(); setErr(null);
    const token = code.replace(/\D/g, '');
    if (token.length < 6) return setErr(new Error('Enter the code from the email.'));
    setBusy(true);
    const { error } = await supabase.auth.verifyOtp({ email, token, type: kind === 'recovery' ? 'recovery' : 'signup' });
    setBusy(false);
    if (error) {
      setErr(/expired|invalid/i.test(error.message) ? new Error("That code didn't work — it may have expired. Check the newest email or send a new code.") : authError(error));
      return;
    }
    if (kind === 'recovery') { setRecovery(true); navigate('/reset', { replace: true }); }
    // signup: the new session signs them in and the app moves on to onboarding
  };
  const resend = async () => {
    setErr(null); setResent(false);
    const { error } = kind === 'recovery'
      ? await supabase.auth.resetPasswordForEmail(email, { redirectTo: authRedirect() })
      : await supabase.auth.resend({ type: 'signup', email, options: { emailRedirectTo: authRedirect() } });
    if (error) return setErr(authError(error));
    setResent(true); setCooldown(60);
  };
  return (
    <div className="stack">
      <div className="notice"><LuMailCheck aria-hidden /><p>We sent a code to <b>{email}</b>. Type it below, or press the button in the email{desktop ? ' — it reopens PartyUp' : ''}.</p></div>
      <div className="notice notice-warn" role="note"><LuTriangleAlert aria-hidden /><p><b>Don't see it?</b> Check your <b>spam or junk folder</b> — new emails from PartyUp often land there. Marking it "Not spam" makes sure future emails reach your inbox.</p></div>
      <form onSubmit={verify} className="stack">
        <Field label={kind === 'recovery' ? 'Reset code' : 'Verification code'} htmlFor="otp">
          <Input id="otp" className="otp-input" inputMode="numeric" autoComplete="one-time-code" maxLength={10} placeholder="••••••"
            value={code} onChange={(e) => setCode(e.target.value.replace(/[^\d ]/g, ''))} autoFocus />
        </Field>
        <InlineError error={err} />
        <Button type="submit" variant="primary" size="lg" loading={busy}>{kind === 'recovery' ? 'Continue' : 'Verify and continue'}</Button>
      </form>
      <p className="small muted">
        Still nothing after a few minutes?{' '}
        {cooldown > 0 ? <span>send a new code in {cooldown}s</span> : <Button variant="link" onClick={resend}>send a new code</Button>}
        {resent && ' — sent!'}
        {onBack && <> · <Button variant="link" onClick={onBack}>use a different email</Button></>}
      </p>
    </div>
  );
}

export function LoginPage() {
  const { authError: redirectError } = useApp();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const [unconfirmed, setUnconfirmed] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const submit = async (e) => {
    e.preventDefault(); setBusy(true); setErr(null); setUnconfirmed(false);
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    setBusy(false);
    if (error) { setErr(authError(error)); setUnconfirmed(/email not confirmed/i.test(error.message)); }
  };
  const startVerify = async () => {
    await supabase.auth.resend({ type: 'signup', email: email.trim(), options: { emailRedirectTo: authRedirect() } });
    setVerifying(true);
  };
  if (verifying) {
    return (
      <AuthLayout title="Verify your email" foot={<Link to="/login" onClick={() => setVerifying(false)}>Back to sign in</Link>}>
        <VerifyCode email={email.trim()} kind="signup" onBack={() => setVerifying(false)} />
      </AuthLayout>
    );
  }
  return (
    <AuthLayout title="Welcome back" foot={<>New to PartyUp? <Link to="/signup">Create an account</Link></>}>
      <InlineError error={redirectError} />
      <GoogleButton />
      <form onSubmit={submit} className="stack">
        <Field label="Email" htmlFor="li-email"><Input id="li-email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
        <Field label="Password" htmlFor="li-pass">
          <Input id="li-pass" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
        </Field>
        <div className="row between"><Link to="/forgot" className="small">Forgot password?</Link></div>
        <InlineError error={err} />
        {unconfirmed && <Button onClick={startVerify}>Send me a verification code</Button>}
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
      <AuthLayout title="Check your email" sub="One quick step and you're in." foot={<Link to="/login">Back to sign in</Link>}>
        <VerifyCode email={email.trim()} kind="signup" onBack={() => setSent(false)} />
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
    <AuthLayout title="Reset your password" sub={sent ? 'If an account exists for that email, a code is on its way.' : "Enter your email and we'll send you a reset code."} foot={<Link to="/login">Back to sign in</Link>}>
      {sent ? (
        <VerifyCode email={email.trim()} kind="recovery" onBack={() => setSent(false)} />
      ) : (
        <form onSubmit={submit} className="stack">
          <Field label="Email" htmlFor="fp-email"><Input id="fp-email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
          <InlineError error={err} />
          <Button type="submit" variant="primary" size="lg" loading={busy}>Send reset code</Button>
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
