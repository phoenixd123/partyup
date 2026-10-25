// TEST ONLY — a tiny stand-in for @supabase/supabase-js used by the end-to-end
// tests in this sandbox (which has no network access to a real Supabase).
// Requests go to tests/test_server.mjs, which runs them against a real local
// Postgres with the real schema, as the signed-in user (RLS enforced).
// Realtime is deliberately reported as unavailable so the polling fallback is exercised.

const SESSION_KEY = 'shim.session';

export function createClient(url) {
  const base = url.replace(/\/$/, '');
  const listeners = new Set();
  const getSession = () => { try { return JSON.parse(localStorage.getItem(SESSION_KEY) || 'null'); } catch { return null; } };
  const setSession = (s, event) => {
    if (s) localStorage.setItem(SESSION_KEY, JSON.stringify(s)); else localStorage.removeItem(SESSION_KEY);
    listeners.forEach((cb) => setTimeout(() => cb(event, s), 0));
  };
  const post = async (path, body) => {
    const res = await fetch(`${base}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...body, token: getSession()?.access_token }) });
    return res.json();
  };

  const auth = {
    getSession: async () => ({ data: { session: getSession() }, error: null }),
    onAuthStateChange: (cb) => { listeners.add(cb); return { data: { subscription: { unsubscribe: () => listeners.delete(cb) } } }; },
    signInWithPassword: async ({ email, password }) => {
      const r = await post('/auth/signin', { email, password });
      if (r.error) return { data: {}, error: r.error };
      setSession(r.session, 'SIGNED_IN');
      return { data: r, error: null };
    },
    signUp: async ({ email, password }) => {
      const r = await post('/auth/signup', { email, password });
      if (r.error) return { data: {}, error: r.error };
      setSession(r.session, 'SIGNED_IN');
      return { data: r, error: null };
    },
    signOut: async () => { setSession(null, 'SIGNED_OUT'); return { error: null }; },
    resetPasswordForEmail: async () => ({ data: {}, error: null }),
    resend: async () => ({ data: {}, error: null }),
    verifyOtp: async () => ({ data: {}, error: { message: 'Token has expired or is invalid' } }),
    updateUser: async (attrs) => {
      const r = await post('/auth/update', attrs);
      return r.error ? { data: {}, error: r.error } : { data: { user: r.user }, error: null };
    },
  };

  class Query {
    constructor(table) { this.op = { table, kind: 'select', columns: '*', filters: [], order: [] }; }
    select(columns = '*') { if (this.op.kind === 'select') this.op.columns = columns; else this.op.returning = true; return this; }
    insert(values) { this.op.kind = 'insert'; this.op.values = values; return this; }
    update(values) { this.op.kind = 'update'; this.op.values = values; return this; }
    delete() { this.op.kind = 'delete'; return this; }
    eq(col, val) { this.op.filters.push([col, 'eq', val]); return this; }
    in(col, val) { this.op.filters.push([col, 'in', val]); return this; }
    order(col, opts = {}) { this.op.order.push([col, opts.ascending !== false]); return this; }
    limit(n) { this.op.limit = n; return this; }
    single() { this.op.single = 'one'; return this; }
    maybeSingle() { this.op.single = 'maybe'; return this; }
    then(resolve, reject) {
      return post('/query', { op: this.op }).then((r) => {
        if (r.error) return { data: null, error: r.error };
        let data = r.data;
        if (this.op.single) {
          if (data.length > 1 || (this.op.single === 'one' && data.length === 0)) return { data: null, error: { message: 'JSON object requested, multiple (or no) rows returned', code: 'PGRST116' } };
          data = data[0] ?? null;
        }
        return { data, error: null };
      }).then(resolve, reject);
    }
  }

  return {
    auth,
    from: (t) => new Query(t),
    rpc: async (name, args) => {
      const r = await post('/rpc', { name, args });
      return r.error ? { data: null, error: r.error } : { data: r.data, error: null };
    },
    // Broadcast-only channels (call signaling) are relayed by the test server over SSE.
    // Channels that listen for postgres_changes report an error so the polling fallback runs.
    channel: (topic) => {
      const handlers = []; let pg = false; let es = null;
      const cid = Math.random().toString(36).slice(2);
      const ch = {
        on: (type, filter, cb) => { if (type === 'broadcast') handlers.push([filter?.event, cb]); else pg = true; return ch; },
        subscribe: (cb) => {
          if (pg || !topic.startsWith('call:')) { setTimeout(() => cb?.('CHANNEL_ERROR'), 10); return ch; }
          es = new EventSource(`${base}/broadcast/stream?topic=${encodeURIComponent(topic)}&token=${getSession()?.access_token || ''}&cid=${cid}`);
          es.onopen = () => cb?.('SUBSCRIBED');
          es.onerror = () => { if (es.readyState === 2) cb?.('CHANNEL_ERROR'); };
          es.onmessage = (e) => { const m = JSON.parse(e.data); handlers.forEach(([ev, h]) => { if (!ev || ev === m.event) h({ event: m.event, payload: m.payload }); }); };
          return ch;
        },
        send: async ({ event, payload }) => { await post('/broadcast', { topic, event, payload, cid }); return 'ok'; },
        unsubscribe: () => { es?.close(); es = null; },
        _close: () => { es?.close(); es = null; },
      };
      return ch;
    },
    removeChannel: (ch) => { ch?._close?.(); },
    functions: {
      invoke: async (name, { body } = {}) => {
        const r = await post(`/functions/${name}`, body || {});
        return r.error ? { data: null, error: { message: r.error.message } } : { data: r.data, error: null };
      },
    },
    storage: {
      from: () => ({
        upload: async () => ({ data: null, error: { message: 'Storage is not available in the local test harness' } }),
        getPublicUrl: () => ({ data: { publicUrl: '' } }),
      }),
    },
  };
}
