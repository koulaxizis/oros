// orOS quality gate, wave Q2: two-device sync convergence for every slice
// registered with a merge function (Bible A5 / R26). CI only, like smoke.js.
//
// Each app is opened inside the real shell (where sync.js lives), so the
// slice's own get / set / merge are captured as the app registers them.
// Then, per slice, two simulated devices run the engine's pull rule
// (merged = merge(local, remote); apply when it differs from local; push
// when it differs from remote; JSON.stringify equality, like sync.js),
// with every apply going through the app's own set + get, so a store that
// reshapes data is tested too (SY-L1).
//
// Data: device A and B start from the app's own state and diverge with
// generic edits on id-keyed records (a new record each, a changed text,
// newer time stamps). Most apps start empty, so the starting state comes
// from .github/qa/fixtures/<slice>.json when there is one: { base } = a
// sample from the app's own bundle test (make-fixtures.js), or { a, b } =
// two hand-written device states.
//
// Fails on a NEW (not in baseline.json) problem of kind:
//   throws     merge or set/get throws
//   idempotent merge(x, x) differs from x for the converged state
//              (endless uploads)
//   diverge    the two devices or the cloud still differ after 3 rounds
//   loop       uploads keep happening once both devices agree
//   lost       a record added on one device is missing after the merge
//
// Usage: node .github/qa/converge.js [--shard i/n] [--only id,id]
//                                    [--out file] [--update-baseline]
"use strict";

const fs = require("fs");
const path = require("path");
const QA = require("./smoke.js");

const ROOT = QA.ROOT;
const BASELINE = path.join(__dirname, "baseline.json");
const FIXTURES = path.join(__dirname, "fixtures");

function parseArgs(argv) {
  const a = { shard: [1, 1], only: null, update: false, out: null };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    if (k === "--shard") { const m = /^(\d+)\/(\d+)$/.exec(argv[++i] || ""); if (m) a.shard = [+m[1], +m[2]]; }
    else if (k === "--only") a.only = (argv[++i] || "").split(",").filter(Boolean);
    else if (k === "--update-baseline") a.update = true;
    else if (k === "--out") a.out = argv[++i];
  }
  return a;
}

// Captures every slice the shell's sync engine registers.
const CAPTURE = `(() => {
  window.__qaSlices = {};
  let real;
  Object.defineProperty(window, "orosSync", { configurable: true,
    get() { return real; },
    set(v) {
      if (v && v.registerSlice && !v.__qa) {
        const orig = v.registerSlice;
        v.registerSlice = function (name, get, set, key, merge) {
          window.__qaSlices[name] = { get, set, key, merge };
          return orig.apply(this, arguments);
        };
        v.__qa = true;
      }
      real = v;
    } });
})();`;

// Runs inside the shell page: the convergence sweep of one slice.
// Pure function of (name, fixture); returns a list of { kind, detail }.
async function sweepSlice({ name, fixture }) {
  const S = window.__qaSlices[name];
  const out = [];
  const J = (x) => { try { return JSON.stringify(x); } catch (e) { return "<unserialisable>"; } };
  const clone = (x) => (x === undefined ? undefined : JSON.parse(J(x)));
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const fail = (kind, detail) => { if (!out.some((o) => o.kind === kind)) out.push({ kind, detail: detail || "" }); };

  // set + get through the app, like a real apply.
  async function rt(x) {
    try { S.set(clone(x), { merged: true }); } catch (e) { fail("throws", "set: " + e.message); return clone(x); }
    await sleep(30);
    try { return clone(S.get()); } catch (e) { fail("throws", "get: " + e.message); return clone(x); }
  }
  function merge(l, r) {
    // like sync.js: a merge that returns null / undefined means "take the remote copy"
    try { const m = S.merge(clone(l), clone(r)); return (m === null || m === undefined) ? clone(r) : m; }
    catch (e) { fail("throws", "merge: " + e.message); return clone(l); }
  }

  // ---- divergent states ----
  const TIME = /^(m|mt|mtime|ts|t|u|at|updated|updatedAt|updated_at|modified|modifiedAt|changed|edited|lastModified|mod)$/;
  const ID = /^(id|uid|key)$/;
  function recordsIn(x, found, depth) {
    if (!x || typeof x !== "object" || depth > 6) return found;
    if (Array.isArray(x)) {
      const objs = x.filter((e) => e && typeof e === "object" && !Array.isArray(e) && Object.keys(e).some((k) => ID.test(k)));
      if (objs.length) found.push({ list: x, sample: objs[0], depth });
      for (const e of x) recordsIn(e, found, depth + 1);
    } else {
      const vals = Object.values(x).filter((e) => e && typeof e === "object" && !Array.isArray(e));
      const keyed = vals.filter((e) => Object.keys(e).some((k) => ID.test(k)));
      if (keyed.length && keyed.length === vals.length && vals.length === Object.keys(x).length) found.push({ map: x, sample: keyed[0], depth });
      for (const e of Object.values(x)) recordsIn(e, found, depth + 1);
    }
    return found;
  }
  function bump(rec, by) {
    for (const k of Object.keys(rec)) {
      if (!TIME.test(k)) continue;
      if (typeof rec[k] === "number") rec[k] += by;
      else if (typeof rec[k] === "string" && !isNaN(Date.parse(rec[k]))) rec[k] = new Date(Date.parse(rec[k]) + by).toISOString();
    }
  }
  function edit(rec, tag) {
    for (const k of Object.keys(rec)) {
      if (ID.test(k) || TIME.test(k) || /(Id|_id|Ref)$/.test(k)) continue;   // keep references intact
      if (typeof rec[k] === "string" && rec[k].length < 200 && !/^[0-9a-f-]{8,}$/i.test(rec[k])) { rec[k] = rec[k] + " " + tag; return true; }
    }
    return false;
  }
  function diverge(base, tag, by) {
    const s = clone(base);
    const added = [];
    // Top-level collections only: a record nested inside another one
    // (a sub-task, a field list) follows its parent's merge rule, often
    // last-writer-wins for the whole parent, which is by design.
    const all = recordsIn(s, [], 0);
    const top = Math.min.apply(null, all.map((r) => r.depth).concat([99]));
    for (const r of all.filter((x) => x.depth === top)) {
      const idKey = Object.keys(r.sample).find((k) => ID.test(k));
      if (typeof r.sample[idKey] !== "string" && typeof r.sample[idKey] !== "number") continue;
      const copy = clone(r.sample);
      // keep the id's shape (apps validate ids): bump a trailing number,
      // else add a suffix
      const oid = copy[idKey];
      const nid = typeof oid === "number" ? oid + 900000 + by
        : /\d+$/.test(oid) ? oid.replace(/\d+$/, (d) => String(Number(d) + 7 * by).padStart(d.length, "0"))
        : oid + "-qa" + tag;
      copy[idKey] = nid;
      edit(copy, tag); bump(copy, by);
      if (r.list) r.list.push(copy);
      else { const mk = Object.keys(r.map).find((k) => r.map[k] === r.sample); r.map[String(nid)] = copy; void mk; }
      added.push(String(nid));
      // and change an existing record the other side keeps untouched
      const target = r.list ? r.list.find((e) => e && e !== copy && typeof e === "object") : r.sample;
      if (target && edit(target, tag)) bump(target, by);
    }
    return { state: s, added };
  }

  let base;
  try { base = clone(S.get()); } catch (e) { fail("throws", "get: " + e.message); return out; }
  // A sample state from the app's own tests (make-fixtures.js), used when
  // its top-level keys fit the app's real state; applied through the app.
  if (fixture && fixture.base && typeof fixture.base === "object") {
    const real = base && typeof base === "object" ? Object.keys(base) : [];
    const keys = Object.keys(fixture.base);
    const fits = !real.length || keys.filter((k) => real.includes(k)).length >= Math.ceil(keys.length / 2);
    if (fits) base = await rt(fixture.base);
    else out.push({ kind: "nofit", detail: "" });
  }
  let A, B;
  if (fixture && fixture.a !== undefined && fixture.b !== undefined) {
    A = { state: fixture.a, added: fixture.addedA || [] };
    B = { state: fixture.b, added: fixture.addedB || [] };
  } else {
    A = diverge(base, "A", 1000);
    B = diverge(base, "B", 2000);
  }

  // ---- two devices, one cloud ----
  const dev = { A: { local: await rt(A.state) }, B: { local: await rt(B.state) } };
  // a record the app itself refuses (invalid for its model) is not data
  // that can be lost: keep only what each device really stored
  A.added = A.added.filter((id) => J(dev.A.local).indexOf(id) >= 0);
  B.added = B.added.filter((id) => J(dev.B.local).indexOf(id) >= 0);
  let cloud = null, hasCloud = false, uploads = 0;
  async function step(d) {
    const me = dev[d];
    if (!hasCloud) { cloud = clone(me.local); hasCloud = true; uploads++; return; }
    // sync.js merges only when both sides exist, else the cloud copy wins
    const merged = (me.local !== null && cloud !== null) ? merge(me.local, cloud) : clone(cloud);
    if (J(merged) !== J(me.local)) me.local = await rt(merged);
    if (J(merged) !== J(cloud)) { cloud = clone(me.local); uploads++; }
  }
  for (let i = 0; i < 3; i++) { await step("A"); await step("B"); }
  if (J(dev.A.local) !== J(dev.B.local) || J(dev.A.local) !== J(cloud)) fail("diverge", "devices differ after 3 rounds");
  else {
    const u0 = uploads;
    for (let i = 0; i < 3; i++) { await step("A"); await step("B"); }
    if (uploads > u0) fail("loop", (uploads - u0) + " uploads after convergence");
  }
  if (cloud !== null && J(merge(cloud, cloud)) !== J(cloud)) fail("idempotent", "merge(x, x) changes the converged state");
  const final = J(cloud);
  for (const id of A.added.concat(B.added)) {
    if (final.indexOf(id) < 0) { fail("lost", "a record added on one device is missing"); break; }
  }
  // nothing to diverge on (empty app, no fixture): only idempotence was tested
  if (!A.added.length && !B.added.length) out.push({ kind: "shallow", detail: "" });
  // restore the app's own state for the next slice
  try { S.set(clone(base), { merged: true }); } catch (e) {}
  return out;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const { chromium } = QA.loadPlaywright();
  const apps = JSON.parse(fs.readFileSync(path.join(ROOT, "apps.json"), "utf8")).apps
    .filter((a) => a.type === "internal" && fs.existsSync(path.join(ROOT, a.url, "index.html")));
  let mine = apps.filter((a, i) => i % args.shard[1] === args.shard[0] - 1);
  if (args.only) mine = apps.filter((a) => args.only.includes(a.id));

  const srv = await QA.serve();
  const base = "http://127.0.0.1:" + srv.address().port + "/";
  const launch = { args: ["--no-sandbox"] };
  if (process.env.QA_CHROMIUM) launch.executablePath = process.env.QA_CHROMIUM;
  const browser = await chromium.launch(launch);

  async function checkApp(app) {
    const found = [];
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, serviceWorkers: "block" });
    await ctx.route(/^https?:\/\/(?!127\.0\.0\.1[:/])/, (r) => r.abort("internetdisconnected"));
    await ctx.addInitScript(() => {
      try { localStorage.setItem("oros-lang", "en"); localStorage.setItem("oros-tour-done", "1"); sessionStorage.setItem("oros-skip-splash", "1"); } catch (e) {}
    });
    await ctx.addInitScript(CAPTURE);
    const page = await ctx.newPage();
    page.on("dialog", (d) => d.dismiss().catch(() => {}));
    try {
      await page.goto(base + "index.html", { waitUntil: "load", timeout: 30000 });
      await page.waitForFunction(() => window.orosSync && window.__orosOpenApp, null, { timeout: 20000 });
      await page.waitForTimeout(800);
      const shellSlices = await page.evaluate(() => Object.keys(window.__qaSlices));
      await page.evaluate((id) => window.__orosOpenApp(id), app.id);
      await page.waitForTimeout(2500);
      const names = await page.evaluate((skip) => Object.keys(window.__qaSlices)
        .filter((n) => !skip.includes(n) && typeof window.__qaSlices[n].merge === "function"), shellSlices);
      for (const name of names) {
        const fx = path.join(FIXTURES, name + ".json");
        const fixture = fs.existsSync(fx) ? JSON.parse(fs.readFileSync(fx, "utf8")) : null;
        const res = await page.evaluate(sweepSlice, { name, fixture }).catch((e) => [{ kind: "throws", detail: "sweep: " + String(e.message).split("\n")[0] }]);
        for (const r of res) if (r.kind === "shallow") shallow.push(app.id + ":" + name); else if (r.kind === "nofit") nofit.push(app.id + ":" + name); else found.push({ app: app.id, kind: "sync-" + r.kind, width: "", lang: "", detail: QA.norm(name + ": " + r.detail) });
      }
    } catch (e) {
      found.push({ app: app.id, kind: "sync-throws", width: "", lang: "", detail: QA.norm("open: " + String(e.message).split("\n")[0]) });
    }
    await ctx.close().catch(() => {});
    return found;
  }

  const baseline = fs.existsSync(BASELINE) ? JSON.parse(fs.readFileSync(BASELINE, "utf8")) : { entries: [] };
  const known = new Set(baseline.entries);
  const ids = new Set(mine.map((a) => a.id));
  const isMine = (k) => { const p = k.split(" | "); return ids.has(p[0]) && /^sync-/.test(p[1]); };

  const seen = new Map();
  const shallow = [];
  const nofit = [];
  const t0 = Date.now();
  for (const app of mine) {
    const t = Date.now();
    const found = await checkApp(app);
    for (const e of found) seen.set(QA.key(e), e);
    process.stdout.write(app.id + " " + found.length + " (" + ((Date.now() - t) / 1000).toFixed(1) + "s)\n");
  }
  let fresh = [...seen.keys()].filter((k) => !known.has(k));
  if (!args.update && fresh.length) {
    const again = new Set();
    for (const id of new Set(fresh.map((k) => seen.get(k).app))) for (const e of await checkApp(apps.find((a) => a.id === id))) again.add(QA.key(e));
    fresh = fresh.filter((k) => again.has(k));
  }
  const fixed = baseline.entries.filter((k) => isMine(k) && !seen.has(k));

  if (args.update) {
    const keep = baseline.entries.filter((k) => !isMine(k));
    baseline.entries = [...new Set(keep.concat([...seen.keys()]))].sort();
    fs.writeFileSync(BASELINE, JSON.stringify(baseline, null, 2) + "\n");
  }

  const report = { apps: mine.length, seconds: Math.round((Date.now() - t0) / 1000), new: fresh, fixed, shallow: [...new Set(shallow)].sort(), nofit: [...new Set(nofit)].sort() };
  if (args.out) fs.writeFileSync(args.out, JSON.stringify(report, null, 2));
  const lines = ["### orOS sync convergence (shard " + args.shard.join("/") + ")", "",
    report.apps + " apps checked in " + report.seconds + " s. New problems: " + fresh.length + ". Fixed baseline entries: " + fixed.length + ".", ""];
  if (fresh.length) lines.push("**New problems** (fix the merge, or if intended add the exact line to `.github/qa/baseline.json`):", "", "```", ...fresh, "```", "");
  if (report.shallow.length) lines.push("Only idempotence checked (empty state, no fixture in `.github/qa/fixtures/`): " + report.shallow.join(", "), "");
  if (report.nofit.length) lines.push("Fixture does not fit the app's state (rebuild with make-fixtures.js): " + report.nofit.join(", "), "");
  if (fixed.length) lines.push("**No longer happening** (delete these lines from `.github/qa/baseline.json`):", "", "```", ...fixed, "```", "");
  const md = lines.join("\n");
  console.log("\n" + md);
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, md + "\n");
  await browser.close();
  srv.close();
  if (!args.update && fresh.length) process.exitCode = 1;
}

if (require.main === module) main().catch((e) => { console.error(e); process.exit(2); });

module.exports = { sweepSlice };
