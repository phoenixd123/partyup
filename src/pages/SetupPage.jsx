import { useState } from 'react';
import { LuDatabase, LuKeyRound, LuTerminal, LuShieldCheck } from 'react-icons/lu';
import Logo from '../components/Logo.jsx';
import { Button, Field, Input, InlineError } from '../components/ui.jsx';
import { checkPublicKey, saveBrowserConfig, config, clearBrowserConfig } from '../lib/supabase.js';

// Shown when no Supabase project is configured. Nothing here pretends to work:
// the app needs a real backend before sign-in or any data features run.
export default function SetupPage() {
  const desktop = window.location.protocol === 'file:';
  const [url, setUrl] = useState(config.url);
  const [key, setKey] = useState('');
  const [err, setErr] = useState(null);
  const save = (e) => {
    e.preventDefault();
    if (!/^https:\/\/.+/.test(url.trim()) && !/^http:\/\/(localhost|127\.0\.0\.1)/.test(url.trim())) return setErr(new Error('Enter your project URL, like https://abcd.supabase.co'));
    const problem = checkPublicKey(key.trim());
    if (problem) return setErr(new Error(problem));
    saveBrowserConfig(url, key);
    window.location.reload();
  };
  return (
    <div className="setup">
      <div className="setup-card">
        <Logo />
        <h1>Connect PartyUp to Supabase</h1>
        <p className="sub">PartyUp stores accounts, profiles, parties and messages in your own Supabase project. Sign-in and every other feature stay off until a project is connected.</p>
        {config.anonKey && checkPublicKey(config.anonKey) && (
          <p className="inline-error">The configured key was rejected: {checkPublicKey(config.anonKey)}</p>
        )}
        <ol className="setup-steps">
          <li><LuDatabase aria-hidden /><div><strong>Create a project</strong> at supabase.com (the free tier works).</div></li>
          <li><LuTerminal aria-hidden /><div><strong>Run the database setup.</strong> In the SQL Editor, run <code>supabase/schema.sql</code>. Optionally run <code>supabase/seed_demo.sql</code> for labelled demo players.</div></li>
          {desktop ? (
            <li><LuKeyRound aria-hidden /><div><strong>Paste your keys below.</strong> Find them in Project Settings → API. They're saved on this computer only.</div></li>
          ) : (
            <li><LuKeyRound aria-hidden /><div><strong>Add your keys</strong> to <code>.env.local</code> as <code>VITE_SUPABASE_URL</code> and <code>VITE_SUPABASE_ANON_KEY</code>, then restart <code>npm run dev</code>. Or paste them below to try it in this browser.</div></li>
          )}
          <li><LuShieldCheck aria-hidden /><div><strong>Set the redirect URL.</strong> In Authentication → URL Configuration, add {desktop ? 'the address of your hosted web version (if you have one)' : "this page's address"} so confirmation and password-reset emails open PartyUp.{desktop ? ' Or turn off "Confirm email" to sign up directly in the desktop app.' : ''}</div></li>
        </ol>
        <form className="setup-form" onSubmit={save}>
          <Field label="Project URL" htmlFor="sb-url"><Input id="sb-url" placeholder="https://your-project.supabase.co" value={url} onChange={(e) => setUrl(e.target.value)} /></Field>
          <Field label="Anon / publishable key" htmlFor="sb-key" hint="Public key only. The service_role or secret key is refused — it would bypass every security rule.">
            <Input id="sb-key" value={key} onChange={(e) => setKey(e.target.value)} autoComplete="off" spellCheck={false} />
          </Field>
          <InlineError error={err} />
          <div className="row gap-s">
            <Button type="submit" variant="primary">Save and connect</Button>
            {config.source === 'browser' && <Button variant="ghost" onClick={() => { clearBrowserConfig(); window.location.reload(); }}>Forget saved keys</Button>}
          </div>
        </form>
      </div>
    </div>
  );
}
