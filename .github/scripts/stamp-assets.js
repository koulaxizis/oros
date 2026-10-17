// Cache-bust app assets + offline & palette guards (G2-G5), run by
// .github/workflows/bump-version.yml after every push to main.
// OROS_CHECK=1 runs the guards only and writes nothing: the test
// tests/release-guards.test.js does that on every PR, so a guard
// failure shows up before the merge, not after it. A failed run on
// main stamps nothing (sw.js CACHE_VERSION, ?v= in app pages), and
// then installed apps keep old code while the version toast says
// they updated (Bible Part X-B).
const fs = require('fs');

const check = process.env.OROS_CHECK === '1';
const ver = process.env.OROS_VERSION ||
  (check ? (fs.readFileSync('shell.js', 'utf8').match(/APP_VERSION\s*=\s*"([^"]+)"/) || [])[1] : '');
if (!ver) { console.error('ERROR: OROS_VERSION env missing'); process.exit(1); }

// Every index.html: root + each app folder (directory scan).
const SKIP_DIRS = new Set(['.', '..', 'icons', 'fonts', 'vendor']);
const files = ['index.html'];
const appDirs = [];
for (const d of fs.readdirSync('.', { withFileTypes: true })) {
  if (!d.isDirectory()) continue;
  if (SKIP_DIRS.has(d.name) || d.name.startsWith('.')) continue;
  const f = `${d.name}/index.html`;
  if (fs.existsSync(f)) { files.push(f); appDirs.push(d.name); }
}
console.log('App folders found:', appDirs.join(', ') || '(none)');

const safe = (p) => p.startsWith('http') || p.startsWith('//') || p.startsWith('/');

let touched = 0;
for (const f of files) {
  let html;
  try { html = fs.readFileSync(f, 'utf8'); }
  catch (e) { console.warn(`skip (unreadable): ${f}`); continue; }

  const next = html
    .replace(/(href=")([^"#?]+\.css)(\?v=[^"]*)?"/g,
      (mm, a, p) => safe(p) ? mm : `${a}${p}?v=${ver}"`)
    .replace(/(src=")([^"#?]+\.js)(\?v=[^"]*)?"/g,
      (mm, a, p) => safe(p) ? mm : `${a}${p}?v=${ver}"`);

  if (next !== html) {
    if (!check) fs.writeFileSync(f, next);
    touched++;
    console.log(`stamped: ${f} -> ?v=${ver}`);
  } else {
    console.log(`already current: ${f}`);
  }
}
console.log(`Cache-bust done: ${touched}/${files.length} file(s) updated with ?v=${ver}`);

// ---- Q6: CSP meta in every page (hashes follow the inline scripts) ----
// Written here so an edited inline snippet ships with its new hash;
// tests/csp.test.js fails the PR first when it was not refreshed.
if (!check) {
  const csp = require('./csp.js').run(false, process.cwd());
  console.log(`CSP refreshed in ${csp.written} page(s).`);
}

// ---- G2: OFFLINE COVERAGE GUARD ----
const sw = fs.readFileSync('sw.js', 'utf8');
const pc = sw.match(/PRECACHE_URLS\s*=\s*\[([\s\S]*?)\]/);
if (!pc) {
  console.error('ERROR: PRECACHE_URLS array not found in sw.js');
  process.exit(1);
}
// Only REGISTERED apps (internal apps.json entries) must be
// precached. A folder merged before its release PR is not in
// the menu yet; requiring it here failed every push after an
// app-only merge, and a failed run stamps nothing, so no
// device got the update. Its release PR adds the precache
// lines together with the apps.json entry.
let registered = [];
try {
  registered = (JSON.parse(fs.readFileSync('apps.json', 'utf8')).apps || [])
    .filter(a => a.type !== 'external').map(a => a.id);
} catch (e) { /* G4 below reports a missing or invalid apps.json */ }
const unreleased = appDirs.filter(d => !registered.includes(d));
if (unreleased.length) {
  console.log('G2: not in apps.json yet, precache not required: ' + unreleased.join(', '));
}
const missing = appDirs.filter(
  d => registered.includes(d) && pc[1].indexOf('"' + d + '/') === -1
);
if (missing.length) {
  console.error('ERROR: app folder(s) MISSING from sw.js PRECACHE_URLS:');
  missing.forEach(d => console.error(`  - ${d}/  → add its files to PRECACHE_URLS in sw.js`));
  process.exit(1);
}
console.log('Offline coverage: all registered app folders present in PRECACHE_URLS.');

// ---- G5: ROOT FILES GUARD ----
// Every root-level .js/.css that index.html loads must be in
// PRECACHE_URLS too. G2 only looks at app folders, so a new
// core module (dialogs.js, vault.js, …) could ship without
// offline coverage and nothing would say so.
const rootHtml = fs.readFileSync('index.html', 'utf8');
const rootRefs = [...rootHtml.matchAll(/(?:src|href)="([^"#?]+\.(?:js|css))(?:\?[^"]*)?"/g)]
  .map(m => m[1]).filter(p => !safe(p) && p.indexOf('/') === -1);
const rootMissing = rootRefs.filter(
  f => pc[1].indexOf('"./' + f + '"') === -1 && pc[1].indexOf('"' + f + '"') === -1
);
if (rootMissing.length) {
  console.error('ERROR: root file(s) loaded by index.html but MISSING from sw.js PRECACHE_URLS:');
  rootMissing.forEach(f => console.error(`  - ${f}  → add "./${f}" to PRECACHE_URLS in sw.js`));
  process.exit(1);
}
console.log('Root coverage: ' + rootRefs.length + ' root file(s) of index.html present in PRECACHE_URLS.');

// ---- G4: apps.json <-> folder cross-check ----
let appsList;
try {
  appsList = JSON.parse(fs.readFileSync('apps.json', 'utf8')).apps || [];
} catch (e) {
  console.error('ERROR: apps.json missing or invalid JSON');
  process.exit(1);
}
const internal = appsList.filter(a => a.type !== 'external');
const noDir = internal.filter(a => !appDirs.includes(a.id));
if (noDir.length) {
  console.error('ERROR: apps.json entry(s) without a matching folder:');
  noDir.forEach(a => console.error(`  - ${a.id} (url: ${a.url || 'n/a'})`));
  process.exit(1);
}
const orphans = appDirs.filter(d => !internal.some(a => a.id === d));
if (orphans.length) {
  console.warn('WARNING: folder(s) present but not listed in apps.json:');
  orphans.forEach(d => console.warn(`  - ${d}/`));
}
console.log('apps.json <-> folders: consistent.');

// ---- G3: PALETTE CONTRACT GUARD ----
// Only REGISTERED apps, as in G2. A standalone page (download/,
// share/, …) never runs inside the shell; requiring the palette there
// failed every push from 2.26.00 to 2.40.00, and no device updated.
for (const dir of appDirs.filter(d => internal.some(a => a.id === d))) {
  const html = fs.readFileSync(`${dir}/index.html`, 'utf8');
  const jsSrcs = [...html.matchAll(/src="([^"#?]+\.js)(?:\?[^"]*)?"/g)]
    .map(m => m[1]).filter(p => !safe(p));
  let hasInherit = false, hasWatch = false;
  for (const j of jsSrcs) {
    try {
      const code = fs.readFileSync(`${dir}/${j}`, 'utf8');
      if (code.indexOf('inheritPalette') !== -1) hasInherit = true;
      if (code.indexOf('watchPalette')   !== -1) hasWatch   = true;
    } catch (e) { console.warn(`skip (unreadable): ${dir}/${j}`); }
  }
  if (!(hasInherit && hasWatch)) {
    console.error(`ERROR: ${dir}/ does not inherit the shell palette.`);
    console.error(`  Expected inheritPalette + watchPalette in its JS (${jsSrcs.join(', ') || 'no scripts'}).`);
    process.exit(1);
  }
}
console.log('Palette contract: all registered apps inherit shell palette.');
