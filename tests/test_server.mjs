// TEST ONLY — serves the test bundle and executes shim requests against local
// Postgres as the requesting user (role "authenticated" + JWT claims), so the
// real RLS policies and functions decide what is allowed.
import http from 'node:http';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const PORT = Number(process.env.PORT || 5199);
const DIST = path.resolve(path.dirname(new URL(import.meta.url).pathname), 'dist');
const ENV = { ...process.env, PGHOST: process.env.PGHOST || '/tmp', PGPORT: process.env.PGPORT || '5433', PGUSER: process.env.PGUSER || 'postgres', PGDATABASE: 'partyup_test' };

const lit = (v) => {
  if (v === null || v === undefined) return 'NULL';
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (typeof v === 'number') return String(v);
  if (Array.isArray(v)) return `'{${v.map((x) => `"${String(x).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/'/g, "''")}"`).join(',')}}'`;
  if (typeof v === 'object') return `'${JSON.stringify(v).replace(/'/g, "''")}'::jsonb`;
  return `'${String(v).replace(/'/g, "''")}'`;
};
const ident = (s) => { if (!/^[a-z_][a-z0-9_]*$/.test(s)) throw new Error(`bad identifier ${s}`); return `"${s}"`; };

function sql(query, user) {
  const pre = user
    ? `set role authenticated; select set_config('request.jwt.claims', ${lit(JSON.stringify({ sub: user, role: 'authenticated' }))}, false);\n`
    : '';
  const r = spawnSync('psql', ['-X', '-q', '-At', '-v', 'ON_ERROR_STOP=1'], { input: pre + query, env: ENV, encoding: 'utf8' });
  const errLine = (r.stderr || '').split('\n').find((l) => l.includes('ERROR:'));
  if (r.status !== 0) return { error: { message: errLine ? errLine.split('ERROR:')[1].trim() : r.stderr.trim() || 'query failed' } };
  const line = r.stdout.split('\n').find((l) => l.startsWith('@@'));
  return { out: line === undefined ? null : line.slice(2) };
}

const retTypes = new Map();
function retType(name) {
  if (!retTypes.has(name)) {
    const r = sql(`select '@@' || prorettype::regtype::text from pg_proc where proname = ${lit(name)} and pronamespace = 'public'::regnamespace limit 1`);
    retTypes.set(name, r.out);
  }
  return retTypes.get(name);
}

function handleRpc({ name, args = {}, token }) {
  if (!token) return { error: { message: 'permission denied (anon)' } };
  ident(name);
  const named = Object.entries(args).map(([k, v]) => `${ident(k)} => ${lit(v)}`).join(', ');
  const t = retType(name);
  if (t === 'void') {
    const v = sql(`select public.${name}(${named}); select '@@null';`, token);
    return v.error ? v : { data: null };
  }
  const r = sql(`select '@@' || coalesce((public.${name}(${named}))::text, 'null');`, token);
  if (r.error) return r;
  if (r.out === 'null') return { data: null };
  if (t === 'jsonb' || t === 'json') return { data: JSON.parse(r.out) };
  if (t === 'boolean') return { data: r.out === 'true' };
  if (t === 'integer' || t === 'bigint') return { data: Number(r.out) };
  return { data: r.out };
}

function handleQuery({ op, token }) {
  if (!token && op.table !== 'games') return { error: { message: 'permission denied' } };
  const where = op.filters.length
    ? ' where ' + op.filters.map(([c, o, v]) => (o === 'in' ? `${ident(c)} = any(${lit(v)})` : `${ident(c)} = ${lit(v)}`)).join(' and ')
    : '';
  let q;
  if (op.kind === 'select') {
    const cols = op.columns === '*' ? '*' : op.columns.split(',').map((c) => ident(c.trim())).join(', ');
    const order = op.order.length ? ' order by ' + op.order.map(([c, asc]) => `${ident(c)} ${asc ? 'asc' : 'desc'}`).join(', ') : '';
    const limit = op.limit ? ` limit ${Number(op.limit)}` : '';
    q = `select '@@' || coalesce(jsonb_agg(to_jsonb(t)), '[]')::text from (select ${cols} from public.${ident(op.table)}${where}${order}${limit}) t;`;
  } else if (op.kind === 'insert') {
    const rows = Array.isArray(op.values) ? op.values : [op.values];
    const cols = Object.keys(rows[0]);
    q = `with t as (insert into public.${ident(op.table)} (${cols.map(ident).join(', ')}) values ${rows.map((r) => `(${cols.map((c) => lit(r[c])).join(', ')})`).join(', ')} returning *) select '@@' || coalesce(jsonb_agg(to_jsonb(t)), '[]')::text from t;`;
  } else if (op.kind === 'update') {
    const sets = Object.entries(op.values).map(([c, v]) => `${ident(c)} = ${lit(v)}`).join(', ');
    q = `with t as (update public.${ident(op.table)} set ${sets}${where} returning *) select '@@' || coalesce(jsonb_agg(to_jsonb(t)), '[]')::text from t;`;
  } else if (op.kind === 'delete') {
    q = `with t as (delete from public.${ident(op.table)}${where} returning *) select '@@' || coalesce(jsonb_agg(to_jsonb(t)), '[]')::text from t;`;
  }
  const r = sql(q, token || null);
  return r.error ? r : { data: JSON.parse(r.out) };
}

function handleAuth(kind, body) {
  if (kind === 'signup') {
    const r = sql(`with i as (insert into auth.users (email, encrypted_password) values (${lit(body.email.toLowerCase())}, crypt(${lit(body.password)}, gen_salt('bf'))) returning id) select '@@' || id from i;`);
    if (r.error) return { error: { message: /duplicate/.test(r.error.message) ? 'User already registered' : r.error.message } };
    const user = { id: r.out, email: body.email.toLowerCase() };
    return { user, session: { access_token: r.out, user } };
  }
  if (kind === 'signin') {
    const r = sql(`select '@@' || id from auth.users where email = ${lit((body.email || '').toLowerCase())} and encrypted_password = crypt(${lit(body.password || '')}, encrypted_password);`);
    if (r.error || !r.out) return { error: { message: 'Invalid login credentials' } };
    const user = { id: r.out, email: body.email.toLowerCase() };
    return { user, session: { access_token: r.out, user } };
  }
  if (kind === 'update') {
    if (!body.token) return { error: { message: 'Auth session missing' } };
    if (body.password) sql(`update auth.users set encrypted_password = crypt(${lit(body.password)}, gen_salt('bf')) where id = ${lit(body.token)};`);
    return { user: { id: body.token } };
  }
  return { error: { message: 'unknown' } };
}

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' };
http.createServer((req, res) => {
  if (req.method === 'POST') {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      let out;
      try {
        const b = JSON.parse(body || '{}');
        if (req.url === '/rpc') out = handleRpc(b);
        else if (req.url === '/query') out = handleQuery(b);
        else if (req.url.startsWith('/auth/')) out = handleAuth(req.url.slice(6), b);
        else out = { error: { message: 'not found' } };
      } catch (e) { out = { error: { message: String(e.message || e) } }; }
      res.writeHead(200, { 'content-type': 'application/json', 'access-control-allow-origin': '*' });
      res.end(JSON.stringify(out));
    });
    return;
  }
  if (req.method === 'OPTIONS') { res.writeHead(204, { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' }); return res.end(); }
  const file = path.join(DIST, decodeURIComponent(req.url.split('?')[0]) === '/' ? 'index.html' : decodeURIComponent(req.url.split('?')[0]));
  if (!file.startsWith(DIST) || !fs.existsSync(file)) { res.writeHead(404); return res.end('not found'); }
  res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
}).listen(PORT, () => console.log(`test server on http://localhost:${PORT}`));
