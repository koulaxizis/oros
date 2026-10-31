// orOS quality gate: start-up time on a phone. CI / local tool only,
// never shipped.
//
// How long does the shell take to be usable on a low-end Android phone,
// and what does it parse to get there? The real shell is served over
// HTTP/2 (like GitHub Pages) by a local server that imitates a mobile
// network (--rtt ms per request, --kbps shared download bandwidth), in a
// 360 px touch context with CDP CPU throttling (--cpu, 4 = a low-end
// phone next to a desktop CPU; Lighthouse's mobile profile).
//
// Visits, all in one browser profile with the service worker on:
//   first    a first visit: nothing cached, every file from the network
//            while the service worker installs in the background
//   warm     an ordinary later open: the service worker answers from
//            the precache (taken after the precache is complete)
//   release  the first open after a new release: the server now serves
//            a new version (APP_VERSION and every ?v= changed); timed
//            until the shell of the NEW version is ready
//   app      from the warm shell, the time until the first app (--app,
//            Notes) is loaded and painted
// "Ready" is: the splash is gone, the menu holds the apps and the clock
// shows the time. Each visit also reports the bytes downloaded, the
// JavaScript the page evaluated and how much of it ran during start-up
// (V8 block coverage), the script time (CDP ScriptDuration) and the
// slowest scripts (gap between consecutive script load events).
//
// The budget (boot.json) holds the start-up JavaScript bytes and script
// count (deterministic, they fail the gate at +10 %) and the warm ready
// time (a warning only, runners differ in speed).
//
// Usage: node .github/qa/boot.js [--cpu 4] [--rtt 150] [--kbps 1600]
//                                [--app notes] [--runs 1] [--only first,warm,release,app]
//                                [--late-worker] [--update-budget] [--out file.json]
"use strict";

const fs = require("fs");
const path = require("path");
const os = require("os");
const http2 = require("http2");
const crypto = require("crypto");
const zlib = require("zlib");
const { execFileSync } = require("child_process");
const QA = require("./smoke.js");

const ROOT = QA.ROOT;
const BUDGET = path.join(__dirname, "boot.json");
const BYTES_SLACK = 1.10;
const MS_SLACK = 1.50;

function opts(argv) {
  const o = { lateWorker: false, cpu: 4, rtt: 150, kbps: 1600, app: "notes", runs: 1, only: null, update: false, out: null };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    if (k === "--cpu") o.cpu = +argv[++i] || 1;
    else if (k === "--rtt") o.rtt = +argv[++i] || 0;
    else if (k === "--kbps") o.kbps = +argv[++i] || 0;
    else if (k === "--app") o.app = argv[++i];
    else if (k === "--runs") o.runs = Math.max(1, +argv[++i] || 1);
    else if (k === "--only") o.only = (argv[++i] || "").split(",").filter(Boolean);
    else if (k === "--update-budget") o.update = true;
    else if (k === "--late-worker") o.lateWorker = true;
    else if (k === "--out") o.out = argv[++i];
  }
  return o;
}

function appVersion() {
  const m = /var APP_VERSION = "([^"]+)"/.exec(fs.readFileSync(path.join(ROOT, "shell.js"), "utf8"));
  if (!m) throw new Error("APP_VERSION not found in shell.js");
  return m[1];
}

// ---------- server: HTTP/2, mobile network ----------
// Every response waits one round trip, then its body shares one
// download pipe of `kbps` (a token bucket drained in 16 KB slices, so
// parallel streams split the bandwidth like a real link). In release
// mode the version is rewritten in the text files that carry it, so
// the browser sees a new release with the same files otherwise.
function selfSigned(dir) {
  const key = path.join(dir, "key.pem"), crt = path.join(dir, "crt.pem");
  execFileSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", key, "-out", crt,
    "-days", "2", "-subj", "/CN=127.0.0.1"], { stdio: "ignore" });
  return { key: fs.readFileSync(key), cert: fs.readFileSync(crt) };
}

function serve(net) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "oros-boot-"));
  const tls = selfSigned(dir);
  const MIME = { ".html": "text/html; charset=utf-8", ".js": "application/javascript", ".css": "text/css",
    ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg",
    ".webp": "image/webp", ".woff2": "font/woff2", ".txt": "text/plain; charset=utf-8", ".wasm": "application/wasm",
    ".webmanifest": "application/manifest+json", ".mp3": "audio/mpeg", ".ogg": "audio/ogg", ".ico": "image/x-icon" };
  const st = { release: null, version: appVersion(), bytes: 0, requests: 0 };
  let pipeFree = 0;   // when the shared download pipe is next free (ms)
  function slice(n) {
    const bps = net.kbps > 0 ? net.kbps * 1000 / 8 : 0;
    if (!bps) return 0;
    const now = Date.now();
    pipeFree = Math.max(pipeFree, now) + n / bps * 1000;
    return pipeFree - now;
  }
  // A release changes the version in every file that carries it, and
  // the stamp writes new content hashes into sw.js (SW-U1), so the new
  // worker fetches exactly the files that changed.
  function released(f) {
    const b = fs.readFileSync(f);
    if (!/\.(html|js|json|webmanifest)$/i.test(f)) return b;
    const s = b.toString("utf8");
    return s.indexOf(st.version) >= 0 ? Buffer.from(s.split(st.version).join(st.release)) : b;
  }
  let swCache = null;
  function releaseSw() {
    if (swCache && swCache.v === st.release) return swCache.body;
    let src = released(path.join(ROOT, "sw.js")).toString("utf8");
    const pc = /var PRECACHE_URLS = \[([\s\S]*?)\n\];/.exec(src);
    const hashes = {};
    for (const m of pc[1].matchAll(/"([^"]+)"/g)) {
      let q = m[1].split(/[?#]/)[0].replace(/^\.\//, "");
      if (q === "" || q.endsWith("/")) q += "index.html";
      try { hashes[m[1]] = crypto.createHash("sha256").update(released(path.join(ROOT, q))).digest("hex").slice(0, 16); } catch (e) {}
    }
    src = src.replace(/^var PRECACHE_HASH = \{.*\};$/m, () => "var PRECACHE_HASH = " + JSON.stringify(hashes) + ";");
    swCache = { v: st.release, body: Buffer.from(src) };
    return swCache.body;
  }
  const srv = http2.createSecureServer(Object.assign({ allowHTTP1: true }, tls), (req, rsp) => {
    let p;
    try { p = decodeURIComponent(req.url.split(/[?#]/)[0]); } catch (e) { rsp.writeHead(400); return rsp.end(); }
    if (p.endsWith("/")) p += "index.html";
    if (st.noWorker && p === "/sw.js") { rsp.writeHead(404); return rsp.end(); }
    const f = path.join(ROOT, p);
    if (!f.startsWith(ROOT + path.sep) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { rsp.writeHead(404); return rsp.end("not found"); }
    const ext = path.extname(f).toLowerCase();
    let body = st.release ? (p === "/sw.js" ? releaseSw() : released(f)) : fs.readFileSync(f);
    // GitHub Pages sends text gzipped; so does this server.
    const gz = /^(\.html|\.js|\.css|\.json|\.svg|\.txt|\.webmanifest)$/.test(ext) && /\bgzip\b/.test(req.headers["accept-encoding"] || "");
    if (gz) body = zlib.gzipSync(body, { level: 6 });
    st.requests++;
    st.bytes += body.length;
    setTimeout(() => {
      if (rsp.destroyed || rsp.writableEnded) return;
      const h = { "content-type": MIME[ext] || "application/octet-stream", "cache-control": "no-cache" };
      if (gz) h["content-encoding"] = "gzip";
      rsp.writeHead(200, h);
      let off = 0;
      (function next() {
        if (rsp.destroyed) return;
        if (off >= body.length) return rsp.end();
        const n = Math.min(16384, body.length - off);
        const chunk = body.subarray(off, off + n);
        off += n;
        setTimeout(() => { if (!rsp.destroyed) { rsp.write(chunk); next(); } }, slice(n));
      })();
    }, net.rtt);
  });
  srv.on("sessionError", () => {});
  return new Promise((res) => srv.listen(0, "127.0.0.1", () => res({ srv, st, net, port: srv.address().port })));
}

// ---------- in-page probes ----------
// Runs before any orOS script: records when each script element
// finished (load fires after it ran) and when the shell became ready.
function initProbe() {
  const T = (window.__boot = { scripts: [], ready: 0, menu: 0, clock: 0, splash: 0, dcl: 0 });
  document.addEventListener("DOMContentLoaded", () => { T.dcl = performance.now(); });
  document.addEventListener("load", (e) => {
    const s = e.target;
    if (s && s.tagName === "SCRIPT" && s.src) T.scripts.push({ src: s.src.replace(location.origin + "/", "").split("?")[0], at: performance.now() });
  }, true);
  const tick = () => {
    const now = performance.now();
    const m = document.getElementById("app-menu");
    if (!T.menu && m && m.children.length) T.menu = now;
    const c = document.getElementById("bar-time");
    if (!T.clock && c && /\d/.test(c.textContent || "")) T.clock = now;
    if (!T.splash && document.readyState !== "loading" && !document.getElementById("oro-splash")) T.splash = now;
    if (T.menu && T.clock && T.splash) { T.ready = Math.max(T.menu, T.clock, T.splash); return; }
    setTimeout(tick, 10);
  };
  tick();
}

function frontReady(url) {
  const f = document.getElementById("app-frame");
  if (!f || f.style.display === "none") return false;
  let w, d;
  try { w = f.contentWindow; d = f.contentDocument; } catch (e) { return false; }
  if (!w || !d || d.readyState !== "complete") return false;
  if (w.location.pathname.indexOf("/" + url.replace(/^\/|index\.html$/g, "")) < 0) return false;
  if (!w.__qaPainted) {
    w.__qaPainted = 1;
    w.requestAnimationFrame(() => w.requestAnimationFrame(() => { w.__qaPainted = 2; }));
    return false;
  }
  return w.__qaPainted === 2;
}

// V8 block coverage -> bytes of each script that ran. Ranges come outer
// first, so painting them in order leaves each byte with its innermost count.
function coverageOf(result, origin) {
  const out = [];
  for (const s of result) {
    if (!s.url || s.url.indexOf(origin) !== 0) continue;
    const fns = s.functions;
    if (!fns.length || !fns[0].ranges.length) continue;
    const len = fns[0].ranges[0].endOffset;
    const used = new Uint8Array(len);
    for (const fn of fns) for (const r of fn.ranges) used.fill(r.count > 0 ? 1 : 0, r.startOffset, Math.min(r.endOffset, len));
    let u = 0;
    for (let i = 0; i < len; i++) u += used[i];
    const src = s.url.slice(origin.length + 1).split("?")[0];
    const had = out.find((x) => x.src === src);
    if (had) { had.runs++; had.used = Math.max(had.used, u); continue; }
    out.push({ src, bytes: len, used: u, runs: 1 });
  }
  return out;
}

const pause = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitReady(page, ms) {
  const t0 = Date.now();
  for (;;) {
    const r = await page.evaluate(() => window.__boot && window.__boot.ready).catch(() => 0);
    if (r) return;
    if (Date.now() - t0 > ms) throw new Error("shell not ready after " + ms + " ms");
    await pause(100);
  }
}

// One timed open of the shell. `nav` starts it; `untilVersion` waits
// for a reload into that version first (release visit).
async function openShell(ctx, url, o, srvSt, untilVersion) {
  const page = await ctx.newPage();
  page.on("dialog", (d) => d.dismiss().catch(() => {}));
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e.message || e).split("\n")[0].slice(0, 160)));
  const cdp = await ctx.newCDPSession(page);
  await cdp.send("Performance.enable");
  await cdp.send("Profiler.enable");
  await cdp.send("Profiler.startPreciseCoverage", { callCount: false, detailed: true });
  if (o.cpu > 1) await cdp.send("Emulation.setCPUThrottlingRate", { rate: o.cpu });
  const b0 = srvSt.bytes, r0 = srvSt.requests;
  const wall = Date.now();
  let reloads = 0;
  page.on("framenavigated", (f) => { if (f === page.mainFrame()) reloads++; });
  await page.goto(url, { waitUntil: "commit", timeout: 120000 });
  let readyAt, oldReadyAt = 0;
  for (;;) {
    await waitReady(page, 120000);
    const v = await page.evaluate(() => (document.querySelector('script[src*="shell.js"]') || {}).src || "");
    if (!untilVersion || v.indexOf("v=" + untilVersion) >= 0) { readyAt = Date.now() - wall; break; }
    oldReadyAt = Date.now() - wall;
    await page.waitForFunction((ver) => {
      const s = document.querySelector('script[src*="shell.js"]');
      return s && s.src.indexOf("v=" + ver) >= 0;
    }, untilVersion, { timeout: 180000, polling: 200 });
  }
  // Settle so the JavaScript totals do not depend on how fast "ready" came.
  await pause(3000);
  const boot = await page.evaluate(() => window.__boot);
  const metrics = Object.fromEntries((await cdp.send("Performance.getMetrics")).metrics.map((m) => [m.name, m.value]));
  const cov = coverageOf((await cdp.send("Profiler.takePreciseCoverage")).result, new URL(url).origin);
  await cdp.send("Profiler.stopPreciseCoverage");
  // Scripts of the page itself, in order, before DOMContentLoaded: the
  // gap to the previous one is mostly its own run time once cached.
  const parsed = boot.scripts.filter((s) => !boot.dcl || s.at <= boot.dcl);
  const scripts = parsed.map((s, i) => ({ src: s.src, ms: Math.round(s.at - (i ? parsed[i - 1].at : 0)) }));
  const pageNet = await page.evaluate(() => {
    const all = performance.getEntriesByType("navigation").concat(performance.getEntriesByType("resource"));
    return { bytes: all.reduce((a, e) => a + (e.transferSize || 0), 0), requests: all.filter((e) => e.transferSize > 0).length,
      timeline: all.filter((e) => e.transferSize > 0).sort((a, b) => a.startTime - b.startTime)
        .map((e) => ({ name: e.name.replace(location.origin + "/", "").split("?")[0], start: Math.round(e.startTime), end: Math.round(e.responseEnd), kb: Math.round(e.transferSize / 1024), type: e.initiatorType })) };
  });
  return {
    page, cdp, errors,
    res: {
      readyMs: readyAt,
      oldVersionReadyMs: oldReadyAt || undefined,
      inPage: { dcl: Math.round(boot.dcl), menu: Math.round(boot.menu), clock: Math.round(boot.clock), splashGone: Math.round(boot.splash) },
      pageNet,
      reloads: Math.max(0, reloads - 1),
      serverBytes: srvSt.bytes - b0, serverRequests: srvSt.requests - r0,
      scriptMs: Math.round(metrics.ScriptDuration * 1000), taskMs: Math.round(metrics.TaskDuration * 1000),
      jsHeap: metrics.JSHeapUsedSize,
      js: { scripts: cov.length, bytes: cov.reduce((a, c) => a + c.bytes, 0), used: cov.reduce((a, c) => a + c.used, 0), evaluated: cov.reduce((a, c) => a + c.bytes * c.runs, 0) },
      coverage: cov.sort((a, b) => b.bytes - a.bytes),
      slowest: scripts.slice().sort((a, b) => b.ms - a.ms).slice(0, 12),
    },
  };
}

async function precacheDone(page, ms) {
  const t0 = Date.now();
  for (;;) {
    const ok = await page.evaluate(async () => {
      const r = await navigator.serviceWorker.getRegistration();
      if (!r || !r.active || r.installing || r.waiting) return false;
      const names = await caches.keys();
      return names.some((n) => /^oros-shell-/.test(n));
    }).catch(() => false);
    if (ok) return Date.now() - t0;
    if (Date.now() - t0 > ms) throw new Error("service worker not active after " + ms + " ms");
    await pause(500);
  }
}

async function run(o, browser) {
  const want = (k) => !o.only || o.only.includes(k);
  const net = await serve({ rtt: o.rtt, kbps: o.kbps });
  const base = "https://127.0.0.1:" + net.port + "/";
  const ctx = await browser.newContext({
    viewport: { width: 360, height: 780 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true,
    ignoreHTTPSErrors: true,
    userAgent: "Mozilla/5.0 (Linux; Android 11; moto g power) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36",
  });
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1[:/])/, (r) => r.abort("internetdisconnected"));
  await ctx.addInitScript(() => {
    try {
      localStorage.setItem("oros-lang", "en");
      localStorage.setItem("oros-tour-done", "1");
    } catch (e) {}
  });
  await ctx.addInitScript(initProbe);
  const out = { version: net.st.version };

  // first: nothing cached. The service worker installs meanwhile
  // (--late-worker: what if it registered only after the shell is ready).
  net.st.noWorker = o.lateWorker;
  let v = await openShell(ctx, base, o, net.st);
  if (o.lateWorker) {
    net.st.noWorker = false;
    await v.page.evaluate(() => navigator.serviceWorker.register("sw.js").catch(() => {}));
  }
  if (want("first")) out.first = v.res;
  out.errors = v.errors;
  // Let the precache finish at full speed (it is not what is measured).
  net.net.rtt = 0; net.net.kbps = 0;
  await v.cdp.send("Emulation.setCPUThrottlingRate", { rate: 1 });
  out.precacheWaitMs = await precacheDone(v.page, 600000);
  net.net.rtt = o.rtt; net.net.kbps = o.kbps;
  await v.page.close();

  // warm: an ordinary later open.
  v = await openShell(ctx, base, o, net.st);
  if (want("warm")) out.warm = v.res;
  if (want("app")) {
    const appUrl = (QA.listApps().find((a) => a.id === o.app) || {}).url;
    await pause(1500);
    const t0 = Date.now();
    await v.page.evaluate((id) => window.__orosOpenApp(id), o.app);
    await v.page.waitForFunction(frontReady, appUrl, { timeout: 120000, polling: 50 });
    out.app = { id: o.app, openMs: Date.now() - t0 };
  }
  await v.page.close();

  // release: the server now serves a new version.
  if (want("release")) {
    const parts = net.st.version.split(".");
    parts[parts.length - 1] = String(Number(parts[parts.length - 1]) + 50).padStart(2, "0");
    net.st.release = parts.join(".");
    v = await openShell(ctx, base, o, net.st, net.st.release);
    out.release = Object.assign({ to: net.st.release }, v.res);
    await v.page.close();
  }
  await ctx.close();
  net.srv.close();
  return out;
}

const kb = (n) => (n / 1024).toFixed(0) + " KB";
const sec = (ms) => (ms / 1000).toFixed(2) + " s";

function readBudget() {
  return fs.existsSync(BUDGET) ? JSON.parse(fs.readFileSync(BUDGET, "utf8")) : null;
}

// Budget verdict, pure (unit-tested): JS bytes and script count fail at +10 %,
// the warm ready time only warns at +50 %.
function checkBudget(warm, budget) {
  const fails = [], warns = [];
  if (!budget || !warm) return { fails, warns };
  const lim = (x) => Math.round(x * BYTES_SLACK);
  if (budget.jsBytes && warm.js.bytes > lim(budget.jsBytes))
    fails.push("start-up JavaScript " + kb(warm.js.bytes) + " > " + kb(lim(budget.jsBytes)) + " (budget " + kb(budget.jsBytes) + " + 10 %)");
  if (budget.scripts && warm.js.scripts > lim(budget.scripts))
    fails.push("start-up scripts " + warm.js.scripts + " > " + lim(budget.scripts) + " (budget " + budget.scripts + " + 10 %)");
  if (budget.warmMs && warm.readyMs > budget.warmMs * MS_SLACK)
    warns.push("warm ready " + sec(warm.readyMs) + " > " + sec(budget.warmMs * MS_SLACK) + " (budget " + sec(budget.warmMs) + " + 50 %)");
  return { fails, warns };
}

function median(xs) { const s = xs.slice().sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; }

async function main() {
  const o = opts(process.argv.slice(2));
  const { chromium } = QA.loadPlaywright();
  const launch = QA.launchOptions();
  launch.args = (launch.args || []).concat(["--ignore-certificate-errors"]);
  const browser = await chromium.launch(launch);
  const runs = [];
  for (let i = 0; i < o.runs; i++) runs.push(await run(o, browser));
  await browser.close();
  const r = runs[runs.length - 1];
  const pick = (k) => runs.map((x) => x[k] && x[k].readyMs).filter(Boolean);
  const summary = {
    profile: { cpu: o.cpu, rttMs: o.rtt, kbps: o.kbps, width: 360, runs: o.runs },
    version: r.version,
    firstMs: median(pick("first")), warmMs: median(pick("warm")), releaseMs: median(pick("release")),
    appMs: r.app && median(runs.map((x) => x.app.openMs)),
  };
  console.log("orOS start-up, " + o.cpu + "x CPU, " + o.rtt + " ms RTT, " + o.kbps + " kbps, 360 px, " + o.runs + " run(s), v" + r.version);
  for (const k of ["first", "warm", "release"]) {
    const x = r[k];
    if (!x) continue;
    console.log("  " + k.padEnd(8) + sec(summary[k + "Ms"]).padStart(8) + "  page fetched " + kb(x.pageNet.bytes) + " (" + x.pageNet.requests + " req), with the worker " + kb(x.serverBytes) + ", " +
      "JS " + kb(x.js.bytes) + " in " + x.js.scripts + " scripts, " + Math.round(x.js.used / x.js.bytes * 100) + " % of it ran, " +
      "script time " + sec(x.scriptMs) + ", DOMContentLoaded " + sec(x.inPage.dcl) +
      (x.oldVersionReadyMs ? ", old version ready at " + sec(x.oldVersionReadyMs) : "") + (x.reloads ? ", " + x.reloads + " reload(s)" : ""));
  }
  if (r.app) console.log("  app      " + sec(summary.appMs).padStart(8) + "  " + r.app.id + " from the warm shell");
  if (r.warm) {
    console.log("  largest start-up scripts (warm), KB evaluated / KB that ran:");
    for (const c of r.warm.coverage.slice(0, 12)) console.log("    " + c.src.padEnd(26) + kb(c.bytes).padStart(8) + kb(c.used).padStart(8));
    console.log("  slowest scripts (warm), ms from the previous script:");
    for (const s of r.warm.slowest.slice(0, 8)) console.log("    " + s.src.padEnd(26) + String(s.ms).padStart(6));
  }
  if (r.errors && r.errors.length) console.log("  page errors: " + r.errors.join(" | "));

  let budget = readBudget();
  if (o.update && r.warm) {
    budget = { note: "Start-up budget of the quality gate (.github/qa/boot.js), warm open at 360 px. jsBytes and scripts fail the gate at +10 %; warmMs warns at +50 %. Lower it with every lazy-load wave; raise it only for an intended growth and say why in the PR: node .github/qa/boot.js --update-budget.",
      profile: summary.profile, jsBytes: r.warm.js.bytes, scripts: r.warm.js.scripts, warmMs: summary.warmMs };
    fs.writeFileSync(BUDGET, JSON.stringify(budget, null, 2) + "\n");
    console.log("budget written: " + path.relative(ROOT, BUDGET));
  }
  const verdict = checkBudget(r.warm, budget);
  for (const w of verdict.warns) console.log("WARN " + w);
  for (const f of verdict.fails) console.log("FAIL " + f);
  if (o.out) fs.writeFileSync(o.out, JSON.stringify({ summary, runs, verdict }, null, 2));
  if (verdict.fails.length) process.exitCode = 1;
}

if (require.main === module) main().catch((e) => { console.error(e); process.exit(2); });
module.exports = { checkBudget, coverageOf, serve };
