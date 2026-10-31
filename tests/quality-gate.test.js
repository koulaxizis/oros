// Quality gate (.github/qa/smoke.js, workflow quality.yml): the parts that
// run without a browser.
//   - the CI tooling never ships: sw.js, apps.json and manifest never name
//     .github/, and the gate's package.json pins its Playwright version
//   - baseline.json is sorted, unique, well formed and names only apps that
//     exist (an app that is removed takes its entries with it)
//   - the key normaliser and the "reads as English" rule
//   - the sync convergence sweep catches the bugs it is meant to catch
//   - every fixture is a plain object with a source
//   - accessibility keeps only critical / serious, one entry per rule
//   - the size budget is well formed and its verdicts are right
// Run: node --test tests/

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
const QA = require("../.github/qa/smoke.js");

test("CI tooling is never part of the app", () => {
  for (const f of ["sw.js", "apps.json", "manifest.webmanifest", "shell.js", "index.html"]) {
    assert.ok(!/\.github\//.test(read(f)), f + " must not reference .github/");
  }
  const pkg = JSON.parse(read(".github/qa/package.json"));
  assert.ok(pkg.private, "private package");
  for (const [name, v] of Object.entries(pkg.devDependencies || {})) {
    assert.match(v, /^\d+\.\d+\.\d+$/, name + " is pinned to an exact version");
  }
});

test("baseline.json is sorted, unique and names real apps", () => {
  const b = JSON.parse(read(".github/qa/baseline.json"));
  const ids = new Set(JSON.parse(read("apps.json")).apps.map((a) => a.id).concat(["shell"]));
  const kinds = new Set(["error", "overflow", "help", "greek", "csp",
    "sync-throws", "sync-idempotent", "sync-diverge", "sync-loop", "sync-lost", "a11y"]);
  assert.deepEqual(b.entries, [...new Set(b.entries)].sort(), "sorted and unique");
  for (const e of b.entries) {
    const p = e.split(" | ");
    assert.equal(p.length, 5, "5 fields: " + e);
    assert.ok(ids.has(p[0]), "unknown app in baseline: " + e);
    assert.ok(kinds.has(p[1]), "unknown kind in baseline: " + e);
  }
});

test("sync fixtures name their source and hold a state object", () => {
  const dir = path.join(ROOT, ".github/qa/fixtures");
  for (const f of fs.readdirSync(dir)) {
    const fx = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"));
    assert.ok(fx.source, f + " names its source");
    assert.ok((fx.base && typeof fx.base === "object") || (fx.a !== undefined && fx.b !== undefined), f + " holds base or a/b");
  }
});

test("keys are stable across runs and releases", () => {
  assert.equal(QA.norm("console: boom at http://127.0.0.1:4711/todo/todo.js?v=2.64.00:12:34"),
    "console: boom at /todo/todo.js");
  assert.equal(QA.norm("took 1234 ms"), "took # ms");
  assert.equal(QA.key({ app: "todo", kind: "overflow", width: 360, lang: "el", detail: "" }), "todo | overflow | 360 | el | ");
});

test("English left in the Greek UI is spotted, names are not", () => {
  assert.ok(QA.readsEnglish("New page"));
  assert.ok(QA.readsEnglish("Search stations…"));
  assert.ok(!QA.readsEnglish("Νέα σελίδα"));
  assert.ok(!QA.readsEnglish("Dropbox"));
  assert.ok(!QA.readsEnglish("orOS PDF"));
  assert.ok(!QA.readsEnglish("12:30"));
  assert.ok(!QA.readsEnglish("en-US@posix"));   // one token of data, not a sentence
  assert.ok(!QA.readsEnglish("Σύνδεση με Dropbox account"));   // has Greek: a mixed label is not "missing"
});

// ---------- wave Q2: the convergence sweep itself (converge.js) ----------
const { sweepSlice } = require("../.github/qa/converge.js");

// Runs sweepSlice against a fake slice, as the shell page would.
async function sweep(merge, start, setFilter) {
  let store = JSON.parse(JSON.stringify(start));
  global.window = { __qaSlices: { s: {
    get: () => store,
    set: (x) => { store = setFilter ? setFilter(x) : x; },
    merge,
  } } };
  try { return (await sweepSlice({ name: "s", fixture: null })).map((r) => r.kind).sort(); }
  finally { delete global.window; }
}
const START = { items: [{ id: "a1", text: "milk", mtime: 10 }, { id: "a2", text: "bread", mtime: 10 }] };
// A correct merge: union by id, newer mtime wins, ties by text, sorted.
function goodMerge(l, r) {
  const by = {};
  for (const it of (l.items || []).concat(r.items || [])) {
    const cur = by[it.id];
    if (!cur || it.mtime > cur.mtime || (it.mtime === cur.mtime && it.text > cur.text)) by[it.id] = it;
  }
  return { items: Object.keys(by).sort().map((k) => by[k]) };
}

test("convergence sweep: a correct merge passes", async () => {
  assert.deepEqual(await sweep(goodMerge, START), []);
});

test("convergence sweep: a merge that keeps only the local side diverges and loses records", async () => {
  const kinds = await sweep((l) => l, START);
  assert.ok(kinds.includes("diverge") || kinds.includes("lost"), kinds.join());
});

test("convergence sweep: a merge that changes its output every time is an endless upload", async () => {
  let n = 0;
  const kinds = await sweep((l, r) => Object.assign(goodMerge(l, r), { stamp: ++n }), START);
  assert.ok(kinds.includes("loop") || kinds.includes("idempotent") || kinds.includes("diverge"), kinds.join());
});

test("convergence sweep: a merge that throws is reported", async () => {
  const kinds = await sweep(() => { throw new Error("boom"); }, START);
  assert.ok(kinds.includes("throws"), kinds.join());
});

test("convergence sweep: a record the app's own store refuses is not counted as lost", async () => {
  const onlyValid = (x) => ({ items: x.items.filter((it) => /^a\d+$/.test(it.id)) });
  assert.deepEqual(await sweep(goodMerge, { items: [{ id: "a1", text: "milk", mtime: 10 }, { id: "x-qa", text: "y", mtime: 1 }] }, onlyValid), []);
});

const A11Y = require("../.github/qa/a11y.js");
const BUD = require("../.github/qa/budget.js");

test("a11y keeps only critical and serious, one entry per rule", () => {
  const got = A11Y.pickViolations([
    { id: "color-contrast", impact: "serious", help: "c", nodes: [{ target: ["#a"] }, { target: ["#b"] }] },
    { id: "color-contrast", impact: "serious", help: "c", nodes: [{ target: ["#c"] }] },
    { id: "region", impact: "moderate", help: "r", nodes: [{ target: ["#d"] }] },
    { id: "button-name", impact: "critical", help: "b", nodes: [{ target: ["#e"] }] },
  ]);
  assert.deepEqual(got.map((v) => v.id + ":" + v.nodes).sort(), ["button-name:1", "color-contrast:3"]);
});

test("budget.json covers the precache and names real apps", () => {
  const b = JSON.parse(read(".github/qa/budget.json"));
  const ids = new Set(JSON.parse(read("apps.json")).apps.map((a) => a.id));
  assert.ok(b.precache.bytes > 0, "precache budget recorded");
  for (const [id, v] of Object.entries(b.apps)) {
    assert.ok(ids.has(id), "unknown app in budget: " + id);
    assert.ok(Number.isInteger(v.bytes) && v.bytes > 0 && Number.isInteger(v.ms), id + " has bytes and ms");
  }
  assert.deepEqual(Object.keys(b.apps), Object.keys(b.apps).slice().sort(), "apps sorted");
});

test("precache list is read from sw.js like the service worker", () => {
  const list = BUD.precacheList('var PRECACHE_URLS = [\n  "./",\n  "./todo/todo.js?v=1",\n  "./notes/"\n];');
  assert.deepEqual(list, ["index.html", "todo/todo.js", "notes/index.html"]);
  assert.ok(BUD.precacheList(read("sw.js")).length > 100);
});

test("precache verdict: 10 % slack, largest NEW files listed", () => {
  const sizes = { a: 100, b: 50, c: 70 };
  const ok = BUD.checkPrecache(["a", "b"], sizes, 140, null);
  assert.equal(ok.over, false);
  const over = BUD.checkPrecache(["a", "b", "c"], sizes, 140, ["a", "b"]);
  assert.equal(over.over, true);
  assert.deepEqual(over.largest.map((f) => f.path), ["c"], "only files new against the base");
  assert.equal(BUD.checkPrecache(["a"], sizes, 0, null).over, false, "no budget yet never fails");
});

test("first-open verdict: 20 % slack on bytes, time only warns", () => {
  const line = { bytes: 1000, ms: 100 };
  assert.equal(BUD.checkApp("x", { bytes: 1200, ms: 100 }, line).status, "ok");
  assert.equal(BUD.checkApp("x", { bytes: 1201, ms: 100 }, line).status, "over");
  assert.equal(BUD.checkApp("x", { bytes: 1000, ms: 500 }, line).status, "slow");
  assert.equal(BUD.checkApp("x", { bytes: 500, ms: 100 }, line).status, "shrunk");
  assert.equal(BUD.checkApp("x", { bytes: 500, ms: 100 }, undefined).status, "new");
});

const BOOT = require("../.github/qa/boot.js");

test("start-up verdict: JS bytes and scripts fail at +10 %, warm time only warns at +50 %", () => {
  const budget = { jsBytes: 1000, scripts: 10, warmMs: 1000 };
  const warm = (bytes, scripts, ms) => ({ js: { bytes, scripts }, readyMs: ms });
  assert.deepEqual(BOOT.checkBudget(warm(1100, 11, 1500), budget), { fails: [], warns: [] });
  assert.equal(BOOT.checkBudget(warm(1101, 10, 900), budget).fails.length, 1, "bytes over");
  assert.equal(BOOT.checkBudget(warm(900, 12, 900), budget).fails.length, 1, "scripts over");
  const slow = BOOT.checkBudget(warm(900, 9, 1501), budget);
  assert.equal(slow.fails.length, 0);
  assert.equal(slow.warns.length, 1, "slow warm open only warns");
  assert.deepEqual(BOOT.checkBudget(warm(5000, 50, 9000), null), { fails: [], warns: [] }, "no budget never fails");
});

test("start-up coverage counts the bytes that ran, innermost range wins, one line per script", () => {
  const origin = "https://h";
  const cov = BOOT.coverageOf([
    { url: origin + "/a.js?v=1", functions: [
      { ranges: [{ startOffset: 0, endOffset: 100, count: 1 }] },
      { ranges: [{ startOffset: 10, endOffset: 50, count: 0 }, { startOffset: 20, endOffset: 30, count: 2 }] },
    ] },
    { url: origin + "/a.js?v=1", functions: [{ ranges: [{ startOffset: 0, endOffset: 100, count: 1 }] }] },
    { url: "https://other/x.js", functions: [{ ranges: [{ startOffset: 0, endOffset: 5, count: 1 }] }] },
  ], origin);
  assert.deepEqual(cov, [{ src: "a.js", bytes: 100, used: 100, runs: 2 }]);
  const one = BOOT.coverageOf([{ url: origin + "/b.js", functions: [
    { ranges: [{ startOffset: 0, endOffset: 100, count: 1 }] },
    { ranges: [{ startOffset: 10, endOffset: 50, count: 0 }, { startOffset: 20, endOffset: 30, count: 2 }] },
  ] }], origin);
  assert.equal(one[0].used, 70);
});

test("boot.json, once written, holds the start-up budget", () => {
  const f = path.join(__dirname, "..", ".github/qa/boot.json");
  if (!fs.existsSync(f)) return;
  const b = JSON.parse(fs.readFileSync(f, "utf8"));
  assert.ok(Number.isInteger(b.jsBytes) && b.jsBytes > 0 && Number.isInteger(b.scripts) && b.scripts > 0 && b.warmMs > 0);
});
