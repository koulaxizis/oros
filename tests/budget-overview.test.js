// Budget Overview (C1): the pure numbers of budget/overview.js (pace,
// safe to spend, upcoming recurring entries, top categories, card
// order) and the synced set.ov field of budget.js. Run: node --test tests/

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const O = require("../budget/overview.js");

const src = fs.readFileSync(path.join(__dirname, "..", "budget/budget.js"), "utf8");
function block(from, to) {
  const i = src.indexOf(from), j = src.indexOf(to, i);
  if (i < 0 || j < 0) throw new Error("missing block " + from);
  return src.slice(i, j);
}
const B = new Function(
  block("  var STORAGE_KEY", "  // ---------- 1.") +
  block("  function cmpStr(", "  function newId(") +
  block("  // ---------- 2. Money", "  // ---------- 6. Storage") +
  "\nreturn { normSet, mergeBudget, emptyData };")();

const tx = (d, a, k, c) => ({ id: "t" + d + a, m: 1, d, a, k: k || "o", c: c || "food", n: "" });

test("pace: cumulative day by day, to today in the current month, all days in a past one", () => {
  const txs = [tx("2026-11-01", 1000), tx("2026-11-03", 500), tx("2026-11-03", 250, "i"), tx("2026-11-10", 99)];
  const p = O.pace(txs, "2026-11", "2026-11-05");
  assert.equal(p.days, 30);
  assert.equal(p.upto, 5);
  assert.deepEqual(p.cur, [1000, 1000, 1500, 1500, 1500]);   // income never counts, the 10th is ahead
  const past = O.pace(txs, "2026-11", "2026-12-02");
  assert.equal(past.upto, 30);
  assert.equal(past.cur[29], 1599);
  assert.equal(O.pace(txs, "2026-11", "2026-10-31").upto, 0);   // a month ahead: nothing drawn
});

test("pace: last month holds its last value on longer days; the average uses months with expenses only", () => {
  const txs = [tx("2026-02-28", 2800), tx("2026-01-31", 100), tx("2026-01-01", 900)];
  const p = O.pace(txs, "2026-03", "2026-03-31");
  assert.equal(p.prev.length, 31);
  assert.equal(p.prev[27], 2800);
  assert.equal(p.prev[30], 2800);         // February has 28 days: day 31 holds its total
  assert.equal(p.avgN, 2);                // Feb + Jan; December had nothing
  assert.equal(p.avg[0], Math.round((0 + 900) / 2));
  assert.equal(p.avg[30], Math.round((2800 + 1000) / 2));
  assert.equal(O.pace([], "2026-03", "2026-03-31").avg.length, 0);
});

test("upcoming: every occurrence in the window, deleted recurring entries left out, sorted by date", () => {
  const d = {
    rec: [
      { id: "w", k: "o", a: 500, c: "food", n: "Market", f: "w", s: "2026-10-01", e: "" },
      { id: "m", k: "i", a: 200000, c: "salary", n: "Salary", f: "m", s: "2026-01-06", e: "" },
      { id: "gone", k: "o", a: 1, c: "", n: "x", f: "m", s: "2026-01-04", e: "" },
      { id: "ended", k: "o", a: 1, c: "", n: "y", f: "m", s: "2026-01-04", e: "2026-10-31" }
    ],
    tombs: { "rec:gone": 5 }
  };
  const u = O.upcoming(d, "2026-11-02", "2026-11-12");
  assert.deepEqual(u.map((o) => o.id + "@" + o.d), ["w@2026-11-05", "m@2026-11-06", "w@2026-11-12"]);
});

test("safe to spend: under the limit, out of the income, over, past and ahead", () => {
  const rest = [{ k: "o", a: 3000 }, { k: "i", a: 10000 }];
  const lim = O.safe({ inc: 50000, out: 20000 }, 40000, rest, "2026-11", "2026-11-21");
  assert.equal(lim.when, "now");
  assert.equal(lim.mode, "limit");
  assert.equal(lim.days, 10);                      // 21st to 30th
  assert.equal(lim.left, 40000 - 20000 - 3000);
  assert.equal(lim.perDay, 1700);
  const inc = O.safe({ inc: 50000, out: 20000 }, 0, rest, "2026-11", "2026-11-30");
  assert.equal(inc.mode, "income");
  assert.equal(inc.days, 1);
  assert.equal(inc.left, 50000 + 10000 - 20000 - 3000);
  const over = O.safe({ inc: 0, out: 5000 }, 4000, [], "2026-11", "2026-11-10");
  assert.equal(over.left, -1000);
  assert.equal(over.perDay, 0);
  assert.equal(O.safe({ inc: 1, out: 0 }, 0, [], "2026-10", "2026-11-10").when, "past");
  const ahead = O.safe({ inc: 0, out: 0 }, 0, rest, "2026-12", "2026-11-10");
  assert.equal(ahead.when, "ahead");
  assert.equal(ahead.days, 31);
});

test("top categories: biggest first, change against last month, null when new", () => {
  const txs = [tx("2026-11-02", 3000, "o", "food"), tx("2026-10-02", 2000, "o", "food"),
               tx("2026-11-04", 5000, "o", "rent"), tx("2026-11-05", 100, "i", "salary"),
               tx("2026-10-09", 900, "o", "fun"), tx("2026-11-09", 600, "o", "fun")];
  const t = O.topCats(txs, "2026-11", 5);
  assert.deepEqual(t.map((r) => r.c), ["rent", "food", "fun"]);
  assert.equal(t[0].pct, null);
  assert.equal(t[1].pct, 50);
  assert.equal(t[2].pct, -33);
  assert.equal(O.topCats(txs, "2026-11", 1).length, 1);
});

test("card order: defaults, hidden cards, unknown cards kept, missing ones added", () => {
  assert.equal(O.cardString(O.cardList("")), O.CARDS.join(","));
  const l = O.cardList("pace,-safe,future,pace,Bad!,top");
  assert.deepEqual(l.slice(0, 4).map((c) => c.id + (c.on ? "" : "-") + (c.known ? "" : "?")), ["pace", "safe-", "future?", "top"]);
  assert.equal(l.length, O.CARDS.length + 1);
  assert.equal(O.cardString(l).split(",")[2], "future");
  assert.equal(O.normOv("pace,-safe"), "pace,-safe");
  assert.equal(O.normOv("pace,,safe"), "");
  assert.equal(O.normOv(5), "");
});

test("set.ov: kept when valid, dropped when not, same canonical JSON for an older device", () => {
  assert.equal(B.normSet({ m: 1, cur: "EUR", ov: "pace,-safe" }).ov, "pace,-safe");
  assert.equal(B.normSet({ m: 1, cur: "EUR", ov: "pace;drop" }).ov, undefined);
  assert.equal(B.normSet({ m: 1, cur: "EUR", ov: 3 }).ov, undefined);
  // An older Budget keeps ov as an unknown flat extra, in name order with env/envs.
  const s = B.normSet({ m: 2, cur: "EUR", ov: "top,pace", env: true, envs: "2026-01" });
  assert.deepEqual(Object.keys(s), ["m", "cur", "env", "envs", "ov"]);
  const d = Object.assign(B.emptyData(), { set: { m: 2, cur: "EUR", ov: "top" } });
  const merged = B.mergeBudget(d, Object.assign(B.emptyData(), { set: { m: 1, cur: "EUR" } }));
  assert.equal(merged.set.ov, "top");   // later stamp wins, field rides along
});

test("index.html loads the Overview after plan.js and before budget.js", () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "budget/index.html"), "utf8");
  const at = (f) => html.indexOf('src="' + f);
  assert.ok(at("plan.js") > 0 && at("overview.js") > at("plan.js") && at("overviewui.js") > at("overview.js") && at("budget.js") > at("overviewui.js"));
  assert.ok(html.indexOf('id="tab-ov"') > 0 && html.indexOf('id="p-ov"') > 0);
});

test("overviewui.js: English and Greek have the same keys, none twice", () => {
  const s = fs.readFileSync(path.join(__dirname, "..", "budget/overviewui.js"), "utf8");
  const keys = (lang) => {
    const i = s.indexOf("    " + lang + ": {"), j = s.indexOf("\n    }", i);
    return [...s.slice(i, j).matchAll(/"(ov\.[^"]+)":/g)].map((m) => m[1]);
  };
  const en = keys("en"), el = keys("el");
  assert.equal(new Set(en).size, en.length);
  assert.equal(new Set(el).size, el.length);
  assert.deepEqual(en.slice().sort(), el.slice().sort());
  for (const m of s.matchAll(/\bt\("(ov\.[^"]+)"/g)) assert.ok(en.includes(m[1]), "missing string " + m[1]);
});
