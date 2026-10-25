// Publisher wave P13: what Publishing and Stock put in Today. Posts on
// their day and hour, release-plan steps and release days, review
// copies to follow up, manuscripts waiting too long, and consignment
// shops due for a settlement. Read-only.
// Run: node --test tests/
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const C = require("../publish/core.js");
require("../publish/feed.js");
const T = require("../publish/today.js");
const A = require("../today/agg.js");
const SC = require("../stock/core.js");

const TODAY = "2026-03-10";
function ctxOf(store, lang) {
  return {
    today: TODAY, horizon: A.HORIZON, now: Date.UTC(2026, 2, 10, 9), lang: lang || "en",
    readJSON: (key) => (key in store ? JSON.parse(JSON.stringify(store[key])) : null),
    readRaw: (key) => (key in store ? JSON.stringify(store[key]) : null), addDays: A.addDays, diff: A.diff
  };
}
function pub() {
  let d = C.empty();
  d = C.put(d, "titles", { id: "t1", t: "Night Sea", rel: "2026-03-12", plan: [
    { id: "s1", k: "print", d: "2026-03-01" }, { id: "s2", k: "pres", d: "2026-03-20" }, { id: "s3", k: "p1", d: "2026-02-01", done: 1 }],
    rc: [{ id: "r1", n: "Ann Critic", d: "2026-02-01", st: "sent" }, { id: "r2", n: "Bob", d: "2026-03-01", st: "sent" }] }, 1);
  d = C.put(d, "titles", { id: "t2", t: "Old Book", rel: "2025-01-01" }, 2);
  d = C.put(d, "posts", { id: "p1", d: "2026-03-09", at: "18:00", tx: "Pre-orders open", ti: "t1" }, 3);
  d = C.put(d, "posts", { id: "p2", d: "2026-03-12", at: "10:00", tx: "Out today!" }, 4);
  d = C.put(d, "posts", { id: "p3", d: "2026-03-20", tx: "Too far" }, 5);
  d = C.put(d, "posts", { id: "p4", d: "2026-03-08", tx: "Posted", done: "2026-03-08" }, 6);
  d = C.put(d, "subs", { id: "u1", n: "Writer", d: "2025-10-01", st: "new" }, 7);
  d = C.put(d, "subs", { id: "u2", n: "Writer 2", d: "2026-03-01", st: "new" }, 8);
  return JSON.parse(C.serialize(d));
}

test("Publishing in Today: posts, steps, releases, follow-ups and late manuscripts; read-only", () => {
  const store = { "oros-publish-data": pub() };
  const before = JSON.stringify(store);
  const rows = T.collect(ctxOf(store));
  assert.equal(JSON.stringify(store), before);
  assert.deepEqual(rows.map((r) => [r.id, r.kind, r.due, r.time || null]), [
    ["step-s1", "task", "2026-03-01", null],
    ["post-p1", "task", "2026-03-09", "18:00"],
    ["rel-t1", "event", "2026-03-12", null],
    ["post-p2", "task", "2026-03-12", "10:00"],
    ["rc-r1", "task", null, null],
    ["subs", "info", null, null]
  ]);
  const by = Object.fromEntries(rows.map((r) => [r.id, r]));
  assert.equal(by["post-p1"].title, "Post 18:00 · Pre-orders open");
  assert.equal(by["post-p1"].text, "Night Sea");
  assert.deepEqual(by["post-p1"].target, { post: "p1" });
  assert.equal(by["rel-t1"].title, "Release: Night Sea");
  assert.deepEqual(by["step-s1"].target, { title: "t1" });
  assert.equal(by["rc-r1"].title, "Follow up the review copy: Ann Critic");
  assert.deepEqual(by["subs"].target, { view: "subs" });
  const el = T.collect(ctxOf(store, "el"));
  assert.equal(el.find((r) => r.id === "subs").title, "Χειρόγραφα που περιμένουν απάντηση: 1");
  // every row passes Today's own checks
  rows.forEach((r) => {
    const c = A.cleanRow(r, "publish");
    assert.deepEqual([c.due, c.kind, c.title, c.target], [r.due, r.kind, r.title, r.target]);
  });
  assert.deepEqual(T.collect(ctxOf({})), []);
});

test("Stock in Today: a consignment shop due for a settlement opens the shops", () => {
  globalThis.OrosStockCore = SC;
  delete require.cache[require.resolve("../stock/today.js")];
  const ST = require("../stock/today.js");
  const raw = {
    items: [{ id: "book01", m: 1, name: "Sea Wolves", unit: "pcs", price: 1500, vat: 6 }],
    cats: [], units: [], sups: [], tombs: {},
    whs: [{ id: "whshop1", m: 1, name: "Corner Books", arch: 0 }],
    cons: [{ id: "whshop1", m: 1, on: 1, disc: 35, every: 3, who: "" }],
    moves: [
      { id: "mv0001", m: 1, t: "in", d: "2025-11-01", lines: [{ i: "book01", q: 50000 }] },
      { id: "mv0002", m: 1, t: "xfer", d: "2025-11-10", w2: "whshop1", lines: [{ i: "book01", q: 10000 }] }
    ]
  };
  const rows = ST.collect(ctxOf({ "oros-stock-data": raw }, "el"));
  const r = rows.find((x) => x.id === "cons-whshop1");
  assert.deepEqual([r.kind, r.due, r.title, r.target], ["task", "2026-02-10", "Εκκαθάριση με Corner Books", { view: "cons" }]);
  const js = fs.readFileSync(path.join(__dirname, "..", "stock/stock.js"), "utf8");
  assert.match(js, /target\.view === "cons"\) \{ openConsign\(\)/);
});

test("Publishing is registered for Today and precached", () => {
  const apps = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "apps.json"), "utf8"));
  const list = Array.isArray(apps) ? apps : apps.apps;
  assert.deepEqual(list.find((a) => a.id === "publish").today, ["core.js", "feed.js", "today.js"]);
  assert.match(fs.readFileSync(path.join(__dirname, "..", "sw.js"), "utf8"), /"publish\/today\.js"/);
});
