// orOS quality gate, wave Q3: size budget. CI only, never shipped.
//
//   --precache   (no browser) sum the bytes of every file in sw.js
//                PRECACHE_URLS. Fails when the total is more than 10 % over
//                budget.json "precache.bytes", listing the largest files
//                that are new compared to --base-sw (the base branch's
//                sw.js), or the largest files overall without it.
//   (default)    open every app of apps.json with ?standalone in a fresh,
//                empty context at 360 px EN, offline like smoke.js, and
//                count the bytes downloaded until the page settles. Fails
//                when an app downloads more than 20 % over its line in
//                budget.json "apps". Time to the load event is reported
//                and only warned about (runners differ in speed). An app
//                with no line yet is reported, not failed.
//
// --update-budget rewrites the measured values (for this shard's apps, or
// the precache total) into budget.json: do that only when the growth is
// intended, and say why in the PR.
//
// Usage: node .github/qa/budget.js --precache [--base-sw file] [--update-budget]
//        node .github/qa/budget.js [--shard i/n] [--only id,id] [--update-budget] [--out file]
"use strict";

const fs = require("fs");
const path = require("path");
const QA = require("./smoke.js");

const ROOT = QA.ROOT;
const BUDGET = path.join(__dirname, "budget.json");
const PRECACHE_SLACK = 1.10;
const APP_SLACK = 1.20;

function parse(argv) {
  const a = QA.parseArgs(argv);
  a.precache = argv.includes("--precache");
  a.updateBudget = argv.includes("--update-budget");
  const i = argv.indexOf("--base-sw");
  a.baseSw = i >= 0 ? argv[i + 1] : null;
  return a;
}

// The PRECACHE_URLS list of a sw.js source, as repo paths.
function precacheList(src) {
  const m = /var PRECACHE_URLS = \[([\s\S]*?)\n\];/.exec(src);
  if (!m) throw new Error("PRECACHE_URLS not found in sw.js");
  return [...m[1].matchAll(/"([^"]+)"/g)].map((x) => {
    let p = x[1].split(/[?#]/)[0].replace(/^\.\//, "");
    if (p === "" || p.endsWith("/")) p += "index.html";
    return p;
  });
}

function sizeOf(p) { try { return fs.statSync(path.join(ROOT, p)).size; } catch (e) { return 0; } }

function readBudget() {
  return fs.existsSync(BUDGET) ? JSON.parse(fs.readFileSync(BUDGET, "utf8")) : { precache: { bytes: 0 }, apps: {} };
}
function writeBudget(b) {
  const apps = {};
  for (const k of Object.keys(b.apps).sort()) apps[k] = b.apps[k];
  b.apps = apps;
  b.note = "Size budget of the quality gate (.github/qa/budget.js). The gate fails at precache.bytes + 10 % and at an app's bytes + 20 % (ms is a warning only). Raise a value only for an intended growth: node .github/qa/budget.js [--precache] --update-budget.";
  fs.writeFileSync(BUDGET, JSON.stringify({ note: b.note, precache: b.precache, apps: b.apps }, null, 2) + "\n");
}

const kb = (n) => (n / 1024).toFixed(0) + " KB";
const mb = (n) => (n / 1048576).toFixed(2) + " MB";

// Precache verdict, pure (unit-tested).
function checkPrecache(list, sizes, budgetBytes, baseList) {
  const uniq = [...new Set(list)];
  const total = uniq.reduce((s, p) => s + (sizes[p] || 0), 0);
  const limit = Math.round(budgetBytes * PRECACHE_SLACK);
  const before = baseList ? new Set(baseList) : null;
  const pool = before ? uniq.filter((p) => !before.has(p)) : uniq;
  const largest = pool.map((p) => ({ path: p, bytes: sizes[p] || 0 })).sort((a, b) => b.bytes - a.bytes).slice(0, 15);
  const missing = uniq.filter((p) => !sizes[p]);
  return { files: uniq.length, total, limit, over: budgetBytes > 0 && total > limit, largest, newOnly: !!before, missing };
}

function report(md, out, data) {
  console.log("\n" + md);
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, md + "\n");
  if (out) fs.writeFileSync(out, JSON.stringify(data, null, 2));
}

function runPrecache(args) {
  const list = precacheList(fs.readFileSync(path.join(ROOT, "sw.js"), "utf8"));
  const sizes = {};
  for (const p of list) sizes[p] = sizeOf(p);
  const baseList = args.baseSw && fs.existsSync(args.baseSw) ? precacheList(fs.readFileSync(args.baseSw, "utf8")) : null;
  const b = readBudget();
  let r = checkPrecache(list, sizes, b.precache.bytes || 0, baseList);
  if (args.updateBudget) { b.precache = { bytes: r.total }; writeBudget(b); r = checkPrecache(list, sizes, r.total, baseList); }
  const lines = ["### orOS precache budget", "",
    r.files + " files, " + mb(r.total) + " (budget " + mb(b.precache.bytes || 0) + ", limit " + mb(r.limit) + ").", ""];
  if (r.missing.length) lines.push("Listed in sw.js but not in the repo: " + r.missing.join(", "), "");
  if (r.over) {
    lines.push("**Over budget.** " + (r.newOnly ? "Largest files new in this PR:" : "Largest files:"), "", "```",
      ...r.largest.map((f) => kb(f.bytes).padStart(9) + "  " + f.path), "```", "",
      "Shrink or lazy-load them, or if the growth is intended run `node .github/qa/budget.js --precache --update-budget` and say why in the PR.", "");
  }
  report(lines.join("\n"), args.out, r);
  if (!args.updateBudget && (r.over || r.missing.length)) process.exitCode = 1;
}

// App verdict, pure (unit-tested).
function checkApp(id, measured, line) {
  if (!line) return { id, status: "new", measured };
  const limit = Math.round(line.bytes * APP_SLACK);
  if (measured.bytes > limit) return { id, status: "over", measured, limit, line };
  const slow = line.ms > 0 && measured.ms > line.ms * APP_SLACK;
  const shrunk = measured.bytes < line.bytes / APP_SLACK;
  return { id, status: slow ? "slow" : shrunk ? "shrunk" : "ok", measured, limit, line };
}

async function runApps(args) {
  const { chromium } = QA.loadPlaywright();
  const apps = QA.listApps();
  let mine = apps.filter((a, i) => i % args.shard[1] === args.shard[0] - 1);
  if (args.only) mine = apps.filter((a) => args.only.includes(a.id));
  const srv = await QA.serve();
  const base = "http://127.0.0.1:" + srv.address().port + "/";
  const browser = await chromium.launch(QA.launchOptions());

  async function measure(app) {
    const ctx = await QA.newContext(browser, 360, "en");
    const page = await ctx.newPage();
    page.on("dialog", (d) => d.dismiss().catch(() => {}));
    const files = new Map();
    const pending = [];
    page.on("requestfinished", (req) => {
      if (!req.url().startsWith(base)) return;
      pending.push(req.sizes().then((s) => {
        const u = req.url().slice(base.length).split(/[?#]/)[0];
        files.set(u, (files.get(u) || 0) + s.responseBodySize);
      }).catch(() => {}));
    });
    let ms = 0;
    try {
      await page.goto(base + app.url + "?standalone", { waitUntil: "load", timeout: 30000 });
      ms = await page.evaluate(() => { const n = performance.getEntriesByType("navigation")[0]; return n ? Math.round(n.loadEventStart) : 0; });
      await page.waitForTimeout(1500);
    } catch (e) {}
    await Promise.all(pending);
    await ctx.close().catch(() => {});
    const bytes = [...files.values()].reduce((s, n) => s + n, 0);
    const top = [...files.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);
    return { bytes, ms, top };
  }

  const b = readBudget();
  const results = [];
  const t0 = Date.now();
  for (const app of mine) {
    let m = await measure(app);
    let r = checkApp(app.id, m, b.apps[app.id]);
    if (r.status === "over") { m = await measure(app); r = checkApp(app.id, m, b.apps[app.id]); }
    results.push(r);
    if (args.updateBudget) b.apps[app.id] = { bytes: m.bytes, ms: m.ms };
    process.stdout.write(app.id + " " + kb(m.bytes) + " " + m.ms + "ms " + r.status + "\n");
  }
  if (args.updateBudget) writeBudget(b);
  await browser.close();
  srv.close();

  const by = (s) => results.filter((r) => r.status === s);
  const lines = ["### orOS first-open budget (shard " + args.shard.join("/") + ")", "",
    results.length + " apps opened with an empty cache in " + Math.round((Date.now() - t0) / 1000) + " s. Over budget: " + by("over").length + ".", ""];
  if (by("over").length) {
    lines.push("**Over budget** (more than 20 % over `.github/qa/budget.json`):", "", "```");
    for (const r of by("over")) lines.push(r.id + ": " + kb(r.measured.bytes) + " > " + kb(r.limit) + "  largest: " + r.measured.top.map(([u, n]) => u + " " + kb(n)).join(", "));
    lines.push("```", "", "Lazy-load or shrink, or if intended run `node .github/qa/budget.js --only <id> --update-budget` and say why in the PR.", "");
  }
  if (by("slow").length) lines.push("Warning, slower to load than recorded (not a failure): " + by("slow").map((r) => r.id + " " + r.measured.ms + " ms (was " + r.line.ms + ")").join(", "), "");
  if (by("new").length) lines.push("No budget line yet (add with `--update-budget`): " + by("new").map((r) => r.id + " " + kb(r.measured.bytes)).join(", "), "");
  if (by("shrunk").length) lines.push("Much smaller than recorded, the budget line can be lowered: " + by("shrunk").map((r) => r.id).join(", "), "");
  report(lines.join("\n"), args.out, results.map((r) => ({ id: r.id, status: r.status, bytes: r.measured.bytes, ms: r.measured.ms, limit: r.limit })));
  if (!args.updateBudget && by("over").length) process.exitCode = 1;
}

if (require.main === module) {
  const args = parse(process.argv.slice(2));
  (args.precache ? Promise.resolve(runPrecache(args)) : runApps(args)).catch((e) => { console.error(e); process.exit(2); });
}

module.exports = { precacheList, checkPrecache, checkApp, PRECACHE_SLACK, APP_SLACK };
