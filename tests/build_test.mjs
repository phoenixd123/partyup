// TEST ONLY: bundle the app with the Supabase shim so it can run in this sandbox.
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
let esbuild;
try { esbuild = require('esbuild'); } catch { esbuild = require('/opt/npm-tools/node_modules/esbuild/lib/main.js'); }
const { build } = esbuild;
import fs from 'node:fs';
const root = new URL('..', import.meta.url).pathname;
const out = `${root}tests/dist`;
fs.mkdirSync(out, { recursive: true });
await build({
  entryPoints: [`${root}src/main.jsx`], bundle: true, outdir: out, format: 'esm', jsx: 'automatic', sourcemap: true,
  loader: { '.js': 'jsx' }, nodePaths: [process.env.GLOBAL_NODE_MODULES, `${root}node_modules`].filter(Boolean),
  alias: { '@supabase/supabase-js': `${root}tests/supabase-shim.js` },
  define: { 'import.meta.env': JSON.stringify({ VITE_SUPABASE_URL: 'http://localhost:5199', VITE_SUPABASE_ANON_KEY: 'sb_publishable_localtest' }), 'process.env.NODE_ENV': '"development"' },
  logLevel: 'warning',
});
let html = fs.readFileSync(`${root}index.html`, 'utf8')
  .replace('<script type="module" src="./src/main.jsx"></script>', '<link rel="stylesheet" href="./main.css" /><script type="module" src="./main.js"></script>');
fs.writeFileSync(`${out}/index.html`, html);
fs.copyFileSync(`${root}public/favicon.svg`, `${out}/favicon.svg`);
console.log('built', out);
