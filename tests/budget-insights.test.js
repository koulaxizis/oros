// Budget Charts by period (C2): the pure numbers of budget/insights.js
// (periods, sums, compare, payees, calendar) and the string tables of
// insightsui.js. Run: node --test tests/

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const I = require("../budget/insights.js");
const tx = (d, a, k, c, n) => ({ id: "t" + d + a, m: 1, d, a, k: k || "o", c: c || "food", n: n || "" });

test("periods: month, quarter, year and own dates, each with the period before", () => {
  assert.deepEqual(I.period("m", "2026-03"), { kind: "m", from: "2026-03-01", to: "2026-03-31", days: 31, pFrom: "2026-02-01", pTo: "2026-02-28" });
  const q = I.period("q", "2026-02");
  assert.equal(q.from + "|" + q.to + "|" + q.pFrom + "|" + q.pTo, "2026-01-01|2026-03-31|2025-10-01|2025-12-31");
  const y = I.period("y", "2026-07");
  assert.equal(y.from + "|" + y.to + "|" + y.days + "|" + y.pFrom, "2026-01-01|2026-12-31|365|2025-01-01");
  const c = I.period("c", "2026-07", "2026-07-20", "2026-07-11");    // reversed: swapped
  assert.equal(c.from + "|" + c.to + "|" + c.days + "|" + c.pFrom + "|" + c.pTo, "2026-07-11|2026-07-20|10|2026-07-01|2026-07-10");
  assert.equal(I.period("c", "2026-07", "2026-02-30", "2026-07-01").kind, "m");   // not a date: the month
  assert.ok(I.period("c", "2026-07", "2000-01-01", "2026-07-01").days <= 3 * 366);
});

test("sum: income, expenses, per category and per day, both ends included", () => {
  const txs = [tx("2026-03-01", 100), tx("2026-03-31", 200, "o", "rent"), tx("2026-03-15", 900, "i", "pay"), tx("2026-04-01", 5)];
  const s = I.sum(txs, "2026-03-01", "2026-03-31");
  assert.equal(s.inc, 900);
  assert.equal(s.out, 300);
  assert.deepEqual(s.byCat, { "o:food": 100, "o:rent": 200, "i:pay": 900 });
  assert.deepEqual(s.byDay, { "2026-03-01": 100, "2026-03-31": 200 });
});

test("compare: categories of either period, biggest change first, % null when new", () => {
  const cur = I.sum([tx("2026-03-02", 500, "o", "a"), tx("2026-03-02", 100, "o", "b")], "2026-03-01", "2026-03-31");
  const prev = I.sum([tx("2026-02-02", 400, "o", "a"), tx("2026-02-02", 900, "o", "c")], "2026-02-01", "2026-02-28");
  const r = I.compare(cur, prev, "o");
  assert.deepEqual(r.map((x) => x.c + ":" + x.d), ["c:-900", "a:100", "b:100"]);
  assert.equal(r[2].pct, null);
  assert.equal(r[1].pct, 25);
  assert.equal(r[0].pct, -100);
});

test("payees: folded names, newest text shown, expenses of the period only", () => {
  assert.equal(I.payeeKey("LIDL 1234 Athens"), "lidl athens");
  assert.equal(I.payeeKey("Σκλαβενίτης"), "σκλαβενιτης");
  assert.equal(I.payeeKey("42"), "");
  const txs = [tx("2026-03-02", 1000, "o", "g", "LIDL"), tx("2026-03-09", 500, "o", "g", "Lidl"),
               tx("2026-03-05", 2000, "o", "r", "Rent"), tx("2026-03-05", 9000, "i", "p", "Rent"), tx("2026-02-05", 7000, "o", "g", "Lidl")];
  const p = I.payees(txs, "2026-03-01", "2026-03-31", 5);
  assert.deepEqual(p.map((x) => x.name + ":" + x.a + ":" + x.n), ["Rent:2000:1", "Lidl:1500:2"]);
});

test("calendar: Monday first, shades 0–4 against the dearest day", () => {
  const c = I.calendar({ "2026-10-01": 400, "2026-10-02": 100, "2026-10-31": 300 }, "2026-10");
  assert.equal(c.max, 400);
  assert.equal(c.weeks[0].slice(0, 3).every((x) => x === null), true);   // 1 Oct 2026 is a Thursday
  assert.equal(c.weeks[0][3].d, "2026-10-01");
  assert.equal(c.weeks[0][3].lvl, 4);
  assert.equal(c.weeks[0][4].lvl, 1);
  assert.equal(c.weeks[0][5].lvl, 0);
  assert.ok(c.weeks.every((w) => w.length === 7));
});

test("insightsui.js: English and Greek have the same keys, none twice; index.html loads it", () => {
  const s = fs.readFileSync(path.join(__dirname, "..", "budget/insightsui.js"), "utf8");
  const keys = (lang) => {
    const i = s.indexOf("    " + lang + ": {"), j = s.indexOf("\n    }", i);
    return [...s.slice(i, j).matchAll(/"(in\.[^"]+)":/g)].map((m) => m[1]);
  };
  const en = keys("en"), el = keys("el");
  assert.equal(new Set(en).size, en.length);
  assert.deepEqual(en.slice().sort(), el.slice().sort());
  for (const m of s.matchAll(/\bt\("(in\.[^"]+)"/g)) assert.ok(en.includes(m[1]), "missing string " + m[1]);
  const html = fs.readFileSync(path.join(__dirname, "..", "budget/index.html"), "utf8");
  const at = (f) => html.indexOf('src="' + f);
  assert.ok(at("insights.js") > 0 && at("insightsui.js") > at("insights.js") && at("budget.js") > at("insightsui.js"));
  assert.equal(new Set(["en", "el"].map((l) => S_wd(s, l))).size, 2);
});
function S_wd(s, lang) { const i = s.indexOf("    " + lang + ": {"); return s.slice(i).match(/"in\.wd": "([^"]+)"/)[1]; }
