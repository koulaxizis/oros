// Quality gate (.github/qa/smoke.js, workflow quality.yml): the parts that
// run without a browser.
//   - the CI tooling never ships: sw.js, apps.json and manifest never name
//     .github/, and the gate's package.json pins its Playwright version
//   - baseline.json is sorted, unique, well formed and names only apps that
//     exist (an app that is removed takes its entries with it)
//   - the key normaliser and the "reads as English" rule
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
  const kinds = new Set(["error", "overflow", "help", "greek", "csp"]);
  assert.deepEqual(b.entries, [...new Set(b.entries)].sort(), "sorted and unique");
  for (const e of b.entries) {
    const p = e.split(" | ");
    assert.equal(p.length, 5, "5 fields: " + e);
    assert.ok(ids.has(p[0]), "unknown app in baseline: " + e);
    assert.ok(kinds.has(p[1]), "unknown kind in baseline: " + e);
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
  assert.ok(!QA.readsEnglish("Σύνδεση με Dropbox account"));   // has Greek: a mixed label is not "missing"
});
