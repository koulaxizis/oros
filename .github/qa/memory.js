// orOS multitasking, wave M1: how much memory does an app cost while it
// stays open inside the shell? CI / local tool only, never shipped.
//
// One Chromium per shard, 1280 px, EN, offline, empty data. The repo is
// served cross-origin isolated (COOP + COEP headers, only by this local
// server) so performance.measureUserAgentSpecificMemory() works: it
// reports JS heap + DOM bytes PER FRAME, attributed by URL. Apps are
// opened one after the other in the real shell (window.__orosOpenApp),
// each left alone for --hold seconds (default 6), then measured:
//   bytes    JS + DOM of the app's frame and its workers
//   canvas   backing store of its canvases (width x height x 4), which
//            the API does not count (bitmap / GPU memory)
//   nodes    DOM nodes of the app document
//   gl       WebGL contexts it created; media = <audio>/<video> elements
//   retained earlier apps still in the breakdown after another app
//            replaced them in the frame (a closed app that is not freed:
//            Bible lesson "functions of a closed iframe keep running")
// Offline and with no data, so it is a FLOOR: Maps without tiles, the
// Assistant without a model, Studio without a project. Heavy apps are
// therefore also declared by hand (HEAVY_DECLARED).
//
// Usage: node .github/qa/memory.js [--shard i/n] [--only id,id]
//                                  [--hold s] [--out file.json]
//        node .github/qa/memory.js --report a.json b.json ... > report.md
//        node .github/qa/memory.js --stack id,id,... [--visible]
//   --stack keeps the listed apps open TOGETHER, each in its own extra
//   frame over the shell (hidden with display:none after it settles,
//   unless --visible), and prints the growth of the whole browser's
//   process memory (PSS of every Chromium process, Linux /proc) after
//   each one: the real price of keeping apps alive, including layout,
//   style and compositor memory that the per-frame API leaves out.
// Env: QA_CHROMIUM = Chromium executable (default: Playwright's own).
"use strict";

const fs = require("fs");
const path = require("path");
const QA = require("./smoke.js");

const MB = 1048576;

// Apps whose real use costs far more than an offline, empty open shows.
const HEAVY_DECLARED = {
  studio: "audio engine, JSFX, tracks",
  atelier: "large canvases, AI tools",
  maps: "map tiles, vector layers",
  assistant: "WebLLM model on the GPU",
  photolab: "full-size photo canvases",
  montage: "video decoding",
  layout: "PDF.js, page canvases",
  scanpdf: "camera, OCR worker, PDF pages",
};

// The repo root over HTTP like smoke.js, plus the isolation headers.
function serveIsolated() {
  const http = require("http");
  const MIME = { ".html": "text/html; charset=utf-8", ".js": "application/javascript", ".mjs": "application/javascript",
    ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg",
    ".webp": "image/webp", ".gif": "image/gif", ".woff2": "font/woff2", ".woff": "font/woff", ".ttf": "font/ttf",
    ".otf": "font/otf", ".txt": "text/plain; charset=utf-8", ".wasm": "application/wasm",
    ".webmanifest": "application/manifest+json", ".mp3": "audio/mpeg", ".ogg": "audio/ogg", ".wav": "audio/wav",
    ".xml": "application/xml", ".pdf": "application/pdf", ".ico": "image/x-icon" };
  return new Promise((res) => {
    const srv = http.createServer((req, rsp) => {
      let p;
      try { p = decodeURIComponent(req.url.split(/[?#]/)[0]); } catch (e) { rsp.writeHead(400); return rsp.end(); }
      if (p.endsWith("/")) p += "index.html";
      const f = path.join(QA.ROOT, p);
      if (!f.startsWith(QA.ROOT + path.sep) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { rsp.writeHead(404); return rsp.end(); }
      rsp.writeHead(200, {
        "Content-Type": MIME[path.extname(f).toLowerCase()] || "application/octet-stream", "Cache-Control": "no-store",
        "Cross-Origin-Opener-Policy": "same-origin", "Cross-Origin-Embedder-Policy": "require-corp",
        "Cross-Origin-Resource-Policy": "same-origin",
      });
      fs.createReadStream(f).pipe(rsp);
    });
    srv.listen(0, "127.0.0.1", () => res(srv));
  });
}

// Runs in the shell page: bytes per app folder + facts of the frame.
async function probe() {
  const r = await performance.measureUserAgentSpecificMemory();
  const per = {};
  for (const e of r.breakdown) {
    const a = e.attribution && e.attribution[0];
    const u = a && a.url ? a.url.replace(/^https?:\/\/[^/]+\//, "").split(/[?#]/)[0] : "";
    const k = u.indexOf("/") > 0 ? u.split("/")[0] : "(shell)";
    per[k] = (per[k] || 0) + e.bytes;
  }
  const f = document.getElementById("app-frame");
  let d = null;
  try { d = f && f.contentDocument; } catch (e) {}
  let canvas = 0, canvases = 0;
  if (d) for (const c of d.querySelectorAll("canvas")) { canvases++; canvas += (c.width || 0) * (c.height || 0) * 4; }
  return {
    per, total: r.bytes,
    path: d ? d.location.pathname : "",
    nodes: d ? d.getElementsByTagName("*").length : 0,
    canvases, canvas,
    gl: (d && d.defaultView && d.defaultView.__qaGl) || 0,
    media: d ? d.querySelectorAll("audio,video").length : 0,
  };
}

// ---------- verdicts (pure, unit-tested) ----------
// Weight of an app in multitasking "slots": 2 when it is heavy (declared,
// or measured over HEAVY_BYTES even offline and empty, or using WebGL),
// else 1.
const HEAVY_BYTES = 20 * MB;
function costOf(r) { return (r.bytes || 0) + (r.canvas || 0); }
function weightOf(r) {
  if (HEAVY_DECLARED[r.id]) return 2;
  if (costOf(r) > HEAVY_BYTES || r.gl > 0) return 2;
  return 1;
}
function summarize(rows) {
  const ok = rows.filter((r) => r.opened);
  const costs = ok.map(costOf).sort((a, b) => a - b);
  const at = (q) => (costs.length ? costs[Math.min(costs.length - 1, Math.floor(costs.length * q))] : 0);
  return {
    apps: rows.length, opened: ok.length,
    median: at(0.5), p90: at(0.9), max: costs.length ? costs[costs.length - 1] : 0,
    heavy: rows.filter((r) => weightOf(r) === 2).map((r) => r.id).sort(),
    retained: rows.filter((r) => r.retained && r.retained.length).map((r) => r.id + " (" + r.retained.join(", ") + ")"),
    failed: rows.filter((r) => !r.opened).map((r) => r.id),
  };
}
function report(rows, shellBytes) {
  const s = summarize(rows);
  const f = (n) => (n / MB).toFixed(1);
  const L = [];
  L.push("# orOS: memory per open app (wave M1)", "");
  L.push("Measured by `.github/qa/memory.js`: Chromium, 1280 px, EN, offline, empty data, each app opened in the real shell and left alone for a few seconds. Cost = JS + DOM of the app's frame (`measureUserAgentSpecificMemory`) + its canvases' pixels. A floor, not real use.", "");
  if (shellBytes) L.push("- The shell itself: " + f(shellBytes) + " MB");
  L.push("- Apps measured: " + s.apps + " (opened: " + s.opened + ")");
  L.push("- Cost per app: median " + f(s.median) + " MB, 90th percentile " + f(s.p90) + " MB, largest " + f(s.max) + " MB");
  L.push("- Heavy (2 slots): " + s.heavy.join(", "));
  L.push("- Closed but not freed: " + (s.retained.length ? s.retained.join("; ") : "none"));
  if (s.failed.length) L.push("- Did not open: " + s.failed.join(", "));
  L.push("", "| App | Total MB | JS+DOM MB | Canvas MB | DOM nodes | WebGL | Weight |", "|---|---|---|---|---|---|---|");
  for (const r of rows.slice().sort((a, b) => costOf(b) - costOf(a))) {
    L.push("| " + [r.id, f(costOf(r)), f(r.bytes), f(r.canvas), r.nodes, r.gl, weightOf(r)].join(" | ") + " |");
  }
  L.push("", "Declared heavy (real use, not visible offline): " + Object.keys(HEAVY_DECLARED).map((k) => k + " (" + HEAVY_DECLARED[k] + ")").join(", ") + ".");
  return L.join("\n") + "\n";
}

function pssOf(pids) {
  let total = 0;
  for (const pid of pids) {
    try {
      const m = /^Pss:\s+(\d+) kB/m.exec(fs.readFileSync("/proc/" + pid + "/smaps_rollup", "utf8"));
      if (m) total += +m[1] * 1024;
    } catch (e) {}
  }
  return total;
}

async function stack(ids, visible) {
  const { chromium } = QA.loadPlaywright();
  const srv = await QA.serve();
  const base = "http://127.0.0.1:" + srv.address().port;
  const byId = {};
  for (const x of QA.listApps()) byId[x.id] = x;
  const browser = await chromium.launch(QA.launchOptions());
  const bcdp = await browser.newBrowserCDPSession();
  const pids = async () => (await bcdp.send("SystemInfo.getProcessInfo")).processInfo.map((x) => x.id);
  const ctx = await QA.newContext(browser, 1280, "en");
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  const settle = async () => { await cdp.send("HeapProfiler.collectGarbage"); await page.waitForTimeout(1500); };
  await page.goto(base + "/index.html", { waitUntil: "load" });
  await page.waitForFunction(() => window.__orosOpenApp, null, { timeout: 20000 });
  await page.waitForTimeout(3000);
  await settle();
  const p0 = pssOf(await pids());
  const line = [];
  for (const id of ids) {
    if (!byId[id]) { line.push(id + ": unknown"); continue; }
    await page.evaluate((u) => {
      const f = document.createElement("iframe");
      f.src = u;
      f.style.cssText = "position:fixed;inset:0;width:100%;height:100%;border:0;z-index:5;background:#fff";
      document.body.appendChild(f);
      window.__qaLast = f;
    }, byId[id].url);
    await page.waitForTimeout(5000);
    if (!visible) await page.evaluate(() => { window.__qaLast.style.display = "none"; });
    await settle();
    line.push(id + " +" + ((pssOf(await pids()) - p0) / MB).toFixed(0) + " MB");
  }
  console.log((visible ? "visible: " : "hidden: ") + line.join(", "));
  await browser.close();
  srv.close();
}

async function main() {
  const argv = process.argv.slice(2);
  if (argv[0] === "--stack") return stack((argv[1] || "").split(",").filter(Boolean), argv.includes("--visible"));
  if (argv[0] === "--report") {
    const outs = argv.slice(1).map((p) => JSON.parse(fs.readFileSync(p, "utf8")));
    process.stdout.write(report([].concat(...outs.map((o) => o.rows)), outs[0] ? outs[0].shell : 0));
    return;
  }
  const a = QA.parseArgs(argv);
  const hi = argv.indexOf("--hold");
  const hold = hi >= 0 ? Math.max(1, +argv[hi + 1] || 6) : 6;
  const { chromium } = QA.loadPlaywright();
  const srv = await serveIsolated();
  const base = "http://127.0.0.1:" + srv.address().port;
  let apps = QA.listApps();
  if (a.only) apps = apps.filter((x) => a.only.includes(x.id));
  const [i, n] = a.shard;
  apps = apps.filter((_, k) => k % n === i - 1);

  // Measure at once instead of at the next natural GC (up to ~20 s).
  const launch = QA.launchOptions();
  launch.args = launch.args.concat(["--enable-blink-features=ForceEagerMeasureMemory"]);
  const browser = await chromium.launch(launch);
  const ctx = await QA.newContext(browser, 1280, "en");
  // WebGL contexts an app creates (the init script runs in every frame).
  await ctx.addInitScript(() => {
    const orig = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (kind) {
      const r = orig.apply(this, arguments);
      if (r && /webgl/.test(String(kind)) && !this.__qaGlSeen) { this.__qaGlSeen = 1; window.__qaGl = (window.__qaGl || 0) + 1; }
      return r;
    };
  });
  const page = await ctx.newPage();
  await page.goto(base + "/index.html", { waitUntil: "load" });
  await page.waitForFunction(() => window.__orosOpenApp && window.orosSync && self.crossOriginIsolated, null, { timeout: 20000 });
  await page.waitForTimeout(1500);
  const shell = await page.evaluate(probe);

  const rows = [], seen = new Set();
  for (const app of apps) {
    const dir = app.url.replace(/^\.?\//, "").split("/")[0];
    let r;
    try {
      await page.evaluate((id) => window.__orosOpenApp(id), app.id);
      await page.waitForTimeout(hold * 1000);
      const m = await page.evaluate(probe);
      r = {
        id: app.id, opened: m.path.split("/")[1] === dir, bytes: m.per[dir] || 0,
        canvas: m.canvas, canvases: m.canvases, nodes: m.nodes, gl: m.gl, media: m.media,
        retained: Object.keys(m.per).filter((k) => k !== dir && seen.has(k)),
      };
    } catch (e) {
      r = { id: app.id, opened: false, bytes: 0, canvas: 0, canvases: 0, nodes: 0, gl: 0, media: 0, retained: [],
        error: String(e.message || e).slice(0, 200) };
    }
    seen.add(dir);
    rows.push(r);
    console.log(app.id.padEnd(14), (costOf(r) / MB).toFixed(1).padStart(6), "MB",
      r.retained.length ? "retained " + r.retained.join(",") : "", r.opened ? "" : "NOT OPENED " + (r.error || ""));
  }
  await browser.close();
  srv.close();
  const out = { shell: shell.per["(shell)"] || 0, rows, summary: summarize(rows) };
  if (a.out) fs.writeFileSync(a.out, JSON.stringify(out, null, 2) + "\n");
}

if (require.main === module) main().catch((e) => { console.error(e); process.exit(1); });

module.exports = { weightOf, costOf, summarize, report, HEAVY_DECLARED, HEAVY_BYTES };
