// Publisher wave P14: the Assistant as a publisher's helper. Posts for
// a book (propose_entry post → Publishing's post window), a consignment
// settlement (propose_entry settlement → Stock), and what sold in a
// month per product and per place (app_summary stock).
// Run: node --test tests/
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const A = require("../assistant/core.js");
const S = require("../assistant/summary.js");
const P = require("../publish/core.js");

test("post card: text, day, hour and networks for Publishing; checked", () => {
  const e = A.normEntry({ kind: "post", text: "Night Sea is out today! #books", date: "2026-03-15", start: "10:00",
    networks: ["bluesky", "x", "myspace", "x"], title: "Night Sea" }, { from: "Assistant" });
  assert.equal(e.ok, true, e.err);
  assert.equal(e.app, "publish");
  assert.deepEqual(e.call.args, ["publish", { asNew: { post: 1, tx: "Night Sea is out today! #books", d: "2026-03-15", at: "10:00",
    nets: ["bluesky", "x"], book: "Night Sea", from: "Assistant" } }]);
  assert.equal(e.view.text, "Night Sea is out today! #books");
  assert.ok(P.POST_NETS.indexOf("bluesky") >= 0 && P.POST_NETS.indexOf("x") >= 0);
  assert.equal(A.normEntry({ kind: "post", date: "2026-03-15" }).ok, false);
  assert.equal(A.normEntry({ kind: "post", text: "x", date: "2026-02-30" }).ok, false);
  assert.equal(A.normEntry({ kind: "post", text: "x", date: "2026-03-15", start: "25:00" }).ok, false);
  assert.equal(A.normEntry({ kind: "post", text: "x", date: "2026-03-15" }, { has: (a) => a !== "publish" }).ok, false);
});

test("settlement card: the shop's name to Stock", () => {
  const e = A.normEntry({ kind: "settlement", shop: "Corner Books" });
  assert.equal(e.ok, true, e.err);
  assert.deepEqual(e.call.args, ["stock", { asNew: { settle: "Corner Books" } }]);
  assert.equal(A.normEntry({ kind: "settlement" }).ok, false);
  assert.ok(A.entryKinds().indexOf("post") >= 0 && A.entryKinds().indexOf("settlement") >= 0);
});

test("the prompt tells the model how to write posts and where sales are, only with those kinds", () => {
  const all = A.systemPrompt({ entries: A.entryKinds(), lang: "en" });
  assert.match(all, /propose_entry post per post/);
  assert.match(all, /app_summary with app stock/);
  const none = A.systemPrompt({ entries: ["todo"], lang: "en" });
  assert.doesNotMatch(none, /propose_entry post per post/);
  assert.doesNotMatch(none, /app_summary with app stock/);
});

test("app_summary stock: a month's sales per product and place, returns off, voided and deleted out", () => {
  const raw = {
    settings: { m: 1, cur: "EUR" },
    items: [{ id: "book01", m: 1, name: "Sea Wolves", sku: "978" }, { id: "book02", m: 1, name: "Salt" }, { id: "gone01", m: 1, name: "Gone" }],
    whs: [{ id: "whshop1", m: 1, name: "Corner Books" }],
    moves: [
      { id: "mv1", m: 1, t: "out", d: "2026-09-02", lines: [{ i: "book01", q: -3000, p: 1600 }, { i: "book02", q: -1000, p: 1200 }] },
      { id: "mv2", m: 1, t: "out", d: "2026-09-20", w: "whshop1", lines: [{ i: "book01", q: -4000, p: 1600 }] },
      { id: "mv3", m: 1, t: "ret", d: "2026-09-21", lines: [{ i: "book01", q: 1000, p: 1600 }] },
      { id: "mv4", m: 1, t: "out", d: "2026-09-22", v: 1, lines: [{ i: "book01", q: -9000, p: 1600 }] },
      { id: "mv5", m: 1, t: "out", d: "2026-10-01", lines: [{ i: "book01", q: -9000, p: 1600 }] },
      { id: "mv6", m: 1, t: "in", d: "2026-09-01", lines: [{ i: "book01", q: 9000, c: 900 }] },
      { id: "mv7", m: 1, t: "out", d: "2026-09-05", lines: [{ i: "book01", q: -5000, p: 1600 }] },
      { id: "mv8", m: 1, t: "out", d: "2026-09-06", lines: [{ i: "gone01", q: -5000, p: 100 }] }
    ],
    tombs: { mv7: 2, gone01: 2 }
  };
  const s = S.stockMonth(raw, "2026-09", "en");
  assert.deepEqual([s.units, s.amount, s.sales, s.currency], [7, 108, 3, "EUR"]);
  assert.deepEqual(s.products, [
    { name: "Sea Wolves", sku: "978", units: 6, amount: 96, places: [{ name: "Corner Books", units: 4 }, { name: "Own stock", units: 2 }] },
    { name: "Salt", units: 1, amount: 12, places: [{ name: "Own stock", units: 1 }] }
  ]);
  assert.deepEqual(s.places, [{ name: "Corner Books", units: 4, amount: 64 }, { name: "Own stock", units: 3, amount: 44 }]);
  const lines = S.preview(S.stockMonth(raw, "2026-09", "el"), "el");
  assert.match(lines[0], /^2026-09 · 7 πουλήθηκαν · 108\.00 EUR$/);
  assert.match(lines.join("\n"), /Sea Wolves: 6 · 96\.00 EUR \(Corner Books 4, Δικό σου απόθεμα 2\)/);
  assert.equal(S.OWN.stock, "month");
  assert.equal(S.stockMonth(null, "2026-09", "en").products.length, 0);
});

test("the apps open the cards: Publishing's post window, Stock's settlement by shop name", () => {
  const pub = fs.readFileSync(path.join(__dirname, "..", "publish/app.js"), "utf8");
  assert.match(pub, /target\.asNew\.post === 1/);
  const st = fs.readFileSync(path.join(__dirname, "..", "stock/stock.js"), "utf8");
  assert.match(st, /typeof target\.asNew\.settle === "string"\) \{ settleByName/);
  const as = fs.readFileSync(path.join(__dirname, "..", "assistant/assistant.js"), "utf8");
  assert.match(as, /a\.app === "stock" \? S\.stockMonth\(readStore\("oros-stock-data"\)/);
});
