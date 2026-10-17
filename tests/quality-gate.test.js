// Quality gate (.github/qa/smoke.js, workflow quality.yml): the parts that
// run without a browser.
//   - the CI tooling never ships: sw.js, apps.json and manifest never name
//     .github/, and the gate's package.json pins its Playwright version
//   - baseline.json is sorted, unique, well formed and names only apps that
//     exist (an app that is removed takes its entries with it)
//   - the key normaliser and the "reads as English" rule
//   - the sync convergence sweep catches the bugs it is meant to catch
//   - every fixture is a plain object with a source
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
    "sync-throws", "sync-idempotent", "sync-diverge", "sync-loop", "sync-lost"]);
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
