// orOS quality gate, wave Q1: open every app of apps.json in a real
// Chromium and fail on NEW problems (anything not in baseline.json).
// CI only: Playwright is installed by .github/workflows/quality.yml into
// .github/qa/node_modules and never reaches the app (not precached, not in
// apps.json, nothing outside .github/ references this folder).
//
// For every app, with ?standalone, in a fresh browser context, offline
// (every host but the local server is blocked, like a first open with no
// network):
//   error     console.error / uncaught exception (360 + 1280, EN + EL)
//   overflow  horizontal scroll of the document at 360 px (EN + EL)
//   help      help.en.txt / help.el.txt missing
//   greek     text shown identically in EN and EL that reads as English
//             (strings built in code, which tests/i18n.test.js cannot see)
//   csp       securitypolicyviolation event (ready for wave Q6)
// Plus the shell (index.html) at both widths and languages.
//
// A new problem is retried once in a fresh context and counts only if it
// shows again (a race is not a regression). Baseline entries that no longer
// happen are listed as "fixed" so the baseline can shrink.
//
// Usage: node .github/qa/smoke.js [--shard i/n] [--only id,id]
//                                 [--update-baseline] [--runs n] [--out file]
// Env: QA_CHROMIUM = Chromium executable (default: Playwright's own).
"use strict";

const fs = require("fs");
const path = require("path");
const http = require("http");

const ROOT = path.resolve(__dirname, "..", "..");
const BASELINE = path.join(__dirname, "baseline.json");

function loadPlaywright() {
  const tries = [path.join(__dirname, "node_modules", "playwright"), "playwright"];
  for (const t of tries) { try { return require(t); } catch (e) {} }
  throw new Error("playwright not found: npm install --prefix .github/qa");
}

// ---------- args ----------
function parseArgs(argv) {
  const a = { shard: [1, 1], only: null, update: false, runs: 1, out: null };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    if (k === "--shard") { const m = /^(\d+)\/(\d+)$/.exec(argv[++i] || ""); if (m) a.shard = [+m[1], +m[2]]; }
    else if (k === "--only") a.only = (argv[++i] || "").split(",").filter(Boolean);
    else if (k === "--update-baseline") a.update = true;
    else if (k === "--runs") a.runs = Math.max(1, parseInt(argv[++i], 10) || 1);
    else if (k === "--out") a.out = argv[++i];
  }
  return a;
}

// ---------- static server (the repo root, like GitHub Pages) ----------
const MIME = { ".html": "text/html; charset=utf-8", ".js": "application/javascript", ".mjs": "application/javascript",
  ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png",
  ".jpg": "image/jpeg", ".webp": "image/webp", ".gif": "image/gif", ".woff2": "font/woff2", ".woff": "font/woff",
  ".ttf": "font/ttf", ".otf": "font/otf", ".txt": "text/plain; charset=utf-8", ".wasm": "application/wasm",
  ".webmanifest": "application/manifest+json", ".mp3": "audio/mpeg", ".ogg": "audio/ogg", ".wav": "audio/wav",
  ".xml": "application/xml", ".pdf": "application/pdf", ".ico": "image/x-icon" };

function serve() {
  return new Promise((res) => {
    const srv = http.createServer((req, rsp) => {
      let p;
      try { p = decodeURIComponent(req.url.split(/[?#]/)[0]); } catch (e) { rsp.writeHead(400); return rsp.end(); }
      if (p.endsWith("/")) p += "index.html";
      const f = path.join(ROOT, p);
      if (!f.startsWith(ROOT + path.sep) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { rsp.writeHead(404); return rsp.end("not found"); }
      rsp.writeHead(200, { "Content-Type": MIME[path.extname(f).toLowerCase()] || "application/octet-stream", "Cache-Control": "no-store" });
      fs.createReadStream(f).pipe(rsp);
    });
    srv.listen(0, "127.0.0.1", () => res(srv));
  });
}

// ---------- normalisation (stable baseline keys) ----------
// Numbers, ?v= stamps, ports and line:col change from run to run and
// release to release; the message itself does not.
function norm(s) {
  return String(s)
    .replace(/https?:\/\/127\.0\.0\.1:\d+/g, "")
    .replace(/\?v=[^\s'")&]+/g, "")
    .replace(/:\d+:\d+/g, "")
    .replace(/\d+/g, "#")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 240);
}
const OWN_KINDS = new Set(["error", "overflow", "help", "greek", "csp"]);
const key = (e) => [e.app, e.kind, e.width || "", e.lang || "", e.detail || ""].join(" | ");

// Ignored console noise: the blocked network itself (we run offline on
// purpose) and Chromium's own warnings that are not the app's doing.
const NOISE = [
  /Failed to load resource/i,
  /net::ERR_/i,
  /ERR_BLOCKED_BY_CLIENT/i,
];

// Words that stay the same in Greek (names, formats, units).
const KEEP = new Set(("oros oros's dropbox google github lichess chess.com wikipedia openstreetmap osm pdf png jpg jpeg svg csv json " +
  "xml html css js zip epub mp3 mp4 webm ogg wav midi url urls api http https www email e-mail id ok wifi bluetooth usb qr " +
  "rss opml ical ics vcard vcf markdown md txt ko-fi kofi mit gpl cc nasa ai webllm ollama openai anthropic claude mistral groq " +
  "gemini deepseek tavily searxng jina woocommerce stripe hubspot pipedrive notion trello todoist raindrop odoo adobe canva " +
  "photoshop scribus mydata timologisi invoice ninja nextcloud webdav lastfm last.fm spotify youtube tmdb radio-browser " +
  "ios android windows linux macos chromium chrome firefox safari edge pwa apk f-droid fdroid play store wasm webgpu " +
  "kb mb gb tb kg km cm mm ml kcal bpm fps rgb hex hsl cmyk dpi utc gmt iso").split(/\s+/));

// A fresh offline browser context at a width and UI language: every host
// but the local server is blocked, no service worker, splash and tour off.
// Shared by smoke.js, a11y.js and budget.js.
async function newContext(browser, width, lang) {
  const ctx = await browser.newContext({
    viewport: { width, height: width <= 400 ? 780 : 800 },
    deviceScaleFactor: 1,
    serviceWorkers: "block",
    isMobile: width <= 400, hasTouch: width <= 400,
  });
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1[:/])/, (r) => r.abort("internetdisconnected"));
  await ctx.addInitScript((lang) => {
    try {
      localStorage.setItem("oros-lang", lang);
      localStorage.setItem("oros-tour-done", "1");
      sessionStorage.setItem("oros-skip-splash", "1");
    } catch (e) {}
    document.addEventListener("securitypolicyviolation", (e) => {
      (window.__qaCsp = window.__qaCsp || []).push(e.violatedDirective + " " + (e.blockedURI || ""));
    });
  }, lang);
  return ctx;
}

// Internal apps of apps.json that have a folder, in file order.
function listApps() {
  return JSON.parse(fs.readFileSync(path.join(ROOT, "apps.json"), "utf8")).apps
    .filter((a) => a.type === "internal" && a.url && fs.existsSync(path.join(ROOT, a.url, "index.html")));
}

function launchOptions() {
  const launch = { args: ["--no-sandbox", "--lang=en-US"] };
  if (process.env.QA_CHROMIUM) launch.executablePath = process.env.QA_CHROMIUM;
  return launch;
}

// ---------- page probes (run inside the app document) ----------
function probeLayout() {
  const de = document.documentElement, b = document.body;
  const W = de.clientWidth;
  return { W, sw: Math.max(de.scrollWidth, b ? b.scrollWidth : 0) };
}
function probeText() {
  // Visible text nodes + placeholders/titles/aria-labels, deduplicated.
  const out = new Set();
  const vis = (el) => {
    for (let n = el; n && n.nodeType === 1; n = n.parentElement) {
      const s = getComputedStyle(n);
      if (s.display === "none" || s.visibility === "hidden") return false;
    }
    return true;
  };
  if (document.body) {
    const tw = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let n; (n = tw.nextNode());) {
      const p = n.parentElement;
      if (!p || /^(SCRIPT|STYLE|NOSCRIPT|TEXTAREA|CODE|PRE|KBD|OPTION)$/.test(p.tagName)) continue;
      if (p.closest("[contenteditable=true],[translate=no],.notranslate")) continue;
      const t = n.nodeValue.replace(/\s+/g, " ").trim();
      if (t && vis(p)) out.add(t);
    }
    for (const el of document.querySelectorAll("[placeholder],[title],[aria-label]")) {
      if (!vis(el)) continue;
      for (const a of ["placeholder", "title", "aria-label"]) { const v = (el.getAttribute(a) || "").trim(); if (v) out.add(v); }
    }
  }
  return [...out].slice(0, 4000);
}

// Reads as English: at least two space-separated Latin words (2+ letters,
// some lowercase) that are not names/formats, and no Greek letter at all.
// Single tokens such as "en-US@posix" or "me@example.org" are data, not UI.
function readsEnglish(t) {
  if (/[\u0370-\u03ff\u1f00-\u1fff]/.test(t)) return false;
  if (t.length > 160) return false;   // long free text is usually sample content
  const words = t.split(/\s+/)
    .map((w) => w.replace(/^[("'“‘«]+|[)"'”’».,:;!?…]+$/g, ""))
    .filter((w) => /^[A-Za-z][A-Za-z'’-]*[A-Za-z]$/.test(w) && /[a-z]/.test(w) && !KEEP.has(w.toLowerCase()));
  return words.length >= 2;
}

// ---------- runner ----------
async function main() {
  const args = parseArgs(process.argv.slice(2));
  const { chromium } = loadPlaywright();
  const apps = listApps();
  let mine = apps.filter((a, i) => i % args.shard[1] === args.shard[0] - 1);
  if (args.only) mine = apps.filter((a) => args.only.includes(a.id));
  const doShell = !args.only && args.shard[0] === 1 || (args.only && args.only.includes("shell"));

  const srv = await serve();
  const base = "http://127.0.0.1:" + srv.address().port + "/";
  const browser = await chromium.launch(launchOptions());

  // One fresh context per visit: no state leaks between apps.
  async function visit(url, width, lang) {
    const ctx = await newContext(browser, width, lang);
    const page = await ctx.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push("uncaught: " + String(e.message || e).split("\n")[0]));
    page.on("console", (m) => {
      if (m.type() !== "error") return;
      const t = m.text();
      if (NOISE.some((r) => r.test(t))) return;
      errors.push("console: " + t.split("\n")[0]);
    });
    page.on("dialog", (d) => d.dismiss().catch(() => {}));
    let layout = null, text = [], csp = [];
    try {
      await page.goto(url, { waitUntil: "load", timeout: 30000 });
      await page.waitForTimeout(1200);
      layout = await page.evaluate(probeLayout);
      text = await page.evaluate(probeText);
      csp = await page.evaluate(() => window.__qaCsp || []);
    } catch (e) {
      errors.push("load: " + String(e.message || e).split("\n")[0]);
    }
    await ctx.close().catch(() => {});
    return { errors, layout, text, csp };
  }

  async function checkApp(app) {
    const url = base + app.url + "?standalone";
    const found = [];
    const add = (e) => found.push(Object.assign({ app: app.id }, e));
    for (const f of ["help.en.txt", "help.el.txt"]) {
      if (!fs.existsSync(path.join(ROOT, app.url, f))) add({ kind: "help", detail: f });
    }
    const texts = {};
    for (const width of [360, 1280]) {
      for (const lang of ["en", "el"]) {
        const r = await visit(url, width, lang);
        for (const m of new Set(r.errors.map(norm))) add({ kind: "error", width, lang, detail: m });
        for (const m of new Set(r.csp.map(norm))) add({ kind: "csp", width, lang, detail: m });
        if (width === 360 && r.layout && r.layout.sw > r.layout.W + 1) add({ kind: "overflow", width, lang, detail: "" });
        if (width === 1280) texts[lang] = r.text;
      }
    }
    if (texts.en && texts.el) {
      const en = new Set(texts.en);
      for (const t of new Set(texts.el)) if (en.has(t) && readsEnglish(t)) add({ kind: "greek", lang: "el", detail: norm(t) });
    }
    return found;
  }

  async function checkShell() {
    const found = [];
    for (const width of [360, 1280]) for (const lang of ["en", "el"]) {
      const r = await visit(base + "index.html", width, lang);
      for (const m of new Set(r.errors.map(norm))) found.push({ app: "shell", kind: "error", width, lang, detail: m });
      for (const m of new Set(r.csp.map(norm))) found.push({ app: "shell", kind: "csp", width, lang, detail: m });
      if (width === 360 && r.layout && r.layout.sw > r.layout.W + 1) found.push({ app: "shell", kind: "overflow", width, lang, detail: "" });
    }
    return found;
  }

  const baseline = fs.existsSync(BASELINE) ? JSON.parse(fs.readFileSync(BASELINE, "utf8")) : { entries: [] };
  const known = new Set(baseline.entries);
  const ids = new Set(mine.map((a) => a.id).concat(doShell ? ["shell"] : []));

  const seen = new Map();   // key -> entry
  const t0 = Date.now();
  for (let run = 0; run < args.runs; run++) {
    if (doShell) for (const e of await checkShell()) seen.set(key(e), e);
    for (const app of mine) {
      const t = Date.now();
      const found = await checkApp(app);
      for (const e of found) seen.set(key(e), e);
      process.stdout.write(app.id + " " + found.length + " (" + ((Date.now() - t) / 1000).toFixed(1) + "s)\n");
    }
  }

  // New problems get one fresh retry; only a repeat counts.
  let fresh = [...seen.keys()].filter((k) => !known.has(k));
  if (!args.update && fresh.length) {
    const again = new Set();
    const apps2 = new Set(fresh.map((k) => seen.get(k).app));
    for (const id of apps2) {
      const found = id === "shell" ? await checkShell() : await checkApp(apps.find((a) => a.id === id));
      for (const e of found) again.add(key(e));
    }
    fresh = fresh.filter((k) => again.has(k));
  }
  // Only this script's own kinds: converge.js (sync-*) and a11y.js (a11y)
  // keep their entries in the same file.
  const isMine = (k) => { const p = k.split(" | "); return ids.has(p[0]) && OWN_KINDS.has(p[1]); };
  const fixed = baseline.entries.filter((k) => isMine(k) && !seen.has(k));

  if (args.update) {
    // Replace this shard's apps in the baseline, keep everything else.
    const keep = baseline.entries.filter((k) => !isMine(k));
    const next = [...new Set(keep.concat([...seen.keys()]))].sort();
    fs.writeFileSync(BASELINE, JSON.stringify({
      note: "Known failures of the quality gate (.github/qa/smoke.js, converge.js, a11y.js). This list may only shrink: fix a problem, then delete its line. Format: app | kind | width | lang | detail.",
      entries: next,
    }, null, 2) + "\n");
  }

  const report = { apps: mine.length + (doShell ? 1 : 0), seconds: Math.round((Date.now() - t0) / 1000), new: fresh, fixed };
  if (args.out) fs.writeFileSync(args.out, JSON.stringify(report, null, 2));
  const lines = [];
  lines.push("### orOS quality gate (shard " + args.shard.join("/") + ")", "");
  lines.push(report.apps + " pages checked in " + report.seconds + " s. New problems: " + fresh.length + ". Fixed baseline entries: " + fixed.length + ".", "");
  if (fresh.length) { lines.push("**New problems** (fix them, or if intended add the exact line to `.github/qa/baseline.json`):", "", "```"); lines.push(...fresh); lines.push("```", ""); }
  if (fixed.length) { lines.push("**No longer happening** (delete these lines from `.github/qa/baseline.json`):", "", "```"); lines.push(...fixed); lines.push("```", ""); }
  const md = lines.join("\n");
  console.log("\n" + md);
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, md + "\n");

  await browser.close();
  srv.close();
  if (!args.update && fresh.length) process.exitCode = 1;
}

if (require.main === module) main().catch((e) => { console.error(e); process.exit(2); });

module.exports = { norm, readsEnglish, key, serve, loadPlaywright, newContext, listApps, launchOptions, parseArgs, NOISE, ROOT };
