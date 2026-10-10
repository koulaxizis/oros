// Budget's read-only Calendar feed (budget/feed.js): it must give the
// very same occurrence days as budget.js, the same ready category
// names, and leave out the past, deleted entries and deleted days.
// Run: node --test tests/

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const F = require(path.join(ROOT, "budget/feed.js"));

const src = fs.readFileSync(path.join(ROOT, "budget/budget.js"), "utf8");
function block(from, to) {
  const i = src.indexOf(from), j = src.indexOf(to, i);
  if (i < 0 || j < 0) throw new Error("missing block " + from);
  return src.slice(i, j);
}
const B = new Function(
  block("  var STORAGE_KEY", "  // ---------- 1.") +
  block("  function cmpStr(", "  function newId(") +
  block("  // ---------- 2. Money", "  // ---------- 6. Storage") +
  "\nreturn { occurrences, addDays, SEED_NAMES };")();

function rec(extra) {
  return Object.assign({ id: "r1", m: 1, k: "o", a: 50000, c: "o-home", n: "", f: "m", s: "2026-01-31", e: "" }, extra || {});
}
function data(recs, extra) {
  return Object.assign({ ver: 1, tx: [], cats: [], bud: [], rec: recs, acc: [], xfer: [], set: { m: 0, cur: "EUR" }, tombs: {} }, extra || {});
}

test("feed: occurrence days equal budget.js occurrences() for every frequency", () => {
  const starts = ["2024-02-29", "2026-01-31", "2026-03-30", "2026-10-10", "2025-12-31", "2026-06-15"];
  const ends = ["", "2027-02-28", "2026-11-30", "2026-10-10"];
  const ranges = [["2026-01-01", "2028-12-31"], ["2026-10-10", "2026-10-10"], ["2026-02-28", "2026-03-01"],
    ["2027-02-01", "2027-03-31"], ["2020-01-01", "2026-12-31"], ["2028-02-29", "2028-02-29"]];
  let n = 0;
  for (const f of ["m", "w", "y"]) for (const s of starts) for (const e of ends) {
    if (e && e < s) continue;
    for (const [from, to] of ranges) {
      const r = rec({ f, s, e });
      assert.deepEqual(F.occurrences(r, from, to), B.occurrences(r, from, to), JSON.stringify([f, s, e, from, to]));
      n++;
    }
  }
  // Day by day over two years, as the Calendar asks.
  for (const f of ["m", "w", "y"]) {
    const r = rec({ f, s: "2024-02-29" });
    for (let d = "2026-01-01"; d <= "2027-12-31"; d = B.addDays(d, 1)) {
      assert.deepEqual(F.occurrences(r, d, d), B.occurrences(r, d, d), f + " " + d);
    }
  }
  assert.ok(n > 300);
});

test("feed: ready category names equal budget.js", () => {
  assert.deepEqual(F.SEED_NAMES, B.SEED_NAMES);
});

test("feed: rows from today on, with note or category name and currency", () => {
  const d = data([rec(), rec({ id: "r2", k: "i", a: 120000, c: "i-salary", n: "", s: "2026-01-25" }),
    rec({ id: "r3", n: "Netflix", a: 1299, c: "o-fun", f: "m", s: "2026-01-12" })], { set: { m: 0, cur: "USD" } });
  assert.deepEqual(F.rowsOn(d, "2026-09-30", "2026-10-10", "en"), [], "past days give nothing");
  assert.deepEqual(F.rowsOn(d, "2026-10-31", "2026-10-10", "en"), [{ id: "r1", k: "o", a: 50000, name: "Rent & home", cur: "USD" }]);
  assert.deepEqual(F.rowsOn(d, "2026-11-30", "2026-10-10", "el"), [{ id: "r1", k: "o", a: 50000, name: "Ενοίκιο & σπίτι", cur: "USD" }], "31st clamped to 30");
  assert.deepEqual(F.rowsOn(d, "2026-10-25", "2026-10-10", "el")[0].name, "Μισθός");
  assert.deepEqual(F.rowsOn(d, "2026-10-12", "2026-10-10", "en")[0].name, "Netflix");
  assert.deepEqual(F.rowsOn(d, "2026-10-10", "2026-10-10", "en"), []);
});

test("feed: own and renamed categories, unknown category", () => {
  const d = data([rec({ c: "o-home" }), rec({ id: "r2", c: "abc123", s: "2026-01-31" }), rec({ id: "r3", c: "zzz", s: "2026-01-31" })],
    { cats: [{ id: "o-home", m: 1, k: "o", name: "Σπίτι", col: 3 }, { id: "abc123", m: 1, k: "o", name: "Γυμναστήριο", col: 1 }] });
  assert.deepEqual(F.rowsOn(d, "2026-10-31", "2026-10-10", "el").map((r) => r.name), ["Σπίτι", "Γυμναστήριο", ""]);
});

test("feed: deleted entries, deleted days, end date, bad rows", () => {
  const d = data([rec(), rec({ id: "r2", s: "2026-01-31", e: "2026-10-31" }),
    rec({ id: "r3", s: "2026-01-31" }),
    rec({ id: "BAD", s: "2026-01-31" }), rec({ id: "r5", a: -5 }), rec({ id: "r6", f: "d" }), rec({ id: "r7", s: "2026-02-30" }),
    rec({ id: "r8", e: "2025-01-01" }), null, "x"],
    { tombs: { "rec:r1": 5, "tx:rr3-20261031": 6 } });
  assert.deepEqual(F.rowsOn(d, "2026-10-31", "2026-10-10", "en").map((r) => r.id), ["r2"]);
  assert.deepEqual(F.rowsOn(d, "2026-11-30", "2026-10-10", "en").map((r) => r.id), ["r3"], "r2 ended, r3's deleted day was only Oct 31");
  assert.deepEqual(F.rowsOn(null, "2026-10-31", "2026-10-10", "en"), []);
  assert.deepEqual(F.rowsOn({ rec: "x" }, "2026-10-31", "2026-10-10", "en"), []);
  assert.deepEqual(F.rowsOn(data([rec()]), "2026-13-01", "2026-10-10", "en"), []);
  assert.equal(F.rowsOn(data([rec()], { set: { cur: "<b>" } }), "2026-10-31", "2026-10-10", "en")[0].cur, "EUR");
});

test("feed: control characters in notes become spaces", () => {
  const d = data([rec({ n: "Rent\n<b>x</b>" })]);
  assert.equal(F.rowsOn(d, "2026-10-31", "2026-10-10", "en")[0].name, "Rent <b>x</b>");
});

test("feed: Calendar loads feed.js before calendar.js and knows the Budget chip", () => {
  const html = fs.readFileSync(path.join(ROOT, "calendar/index.html"), "utf8");
  const i = html.indexOf("../budget/feed.js"), j = html.indexOf('src="calendar.js');
  assert.ok(i > 0 && j > i);
  const cal = fs.readFileSync(path.join(ROOT, "calendar/calendar.js"), "utf8");
  assert.equal((cal.match(/"lbl\.feed\.budget":/g) || []).length, 2, "EN + EL label");
  assert.ok(cal.includes('{ id: "lbl-feed-budget"'));
  assert.ok(cal.includes(".concat(budgetFeedOn(dateStr))"));
  assert.ok(cal.includes('p.__orosOpenAt("budget", { rec: ev._budgetRec })'));
});

test("budget.js takes { rec } and { tx } deep links", () => {
  assert.ok(src.includes("window.__orosOpenAt = openTarget;"));
  assert.ok(/takeStagedNew\(\);\s*takeTarget\(\);/.test(src));
});
