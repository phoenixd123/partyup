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
    channel: () => {
      const ch = { on: () => ch, subscribe: (cb) => { setTimeout(() => cb?.('CHANNEL_ERROR'), 10); return ch; } };
      return ch;
    },
    removeChannel: () => {},
    storage: {
      from: () => ({
        upload: async () => ({ data: null, error: { message: 'Storage is not available in the local test harness' } }),
        getPublicUrl: () => ({ data: { publicUrl: '' } }),
      }),
    },
  };
}
