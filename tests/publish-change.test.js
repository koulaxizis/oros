// PB-CHG (Chris 2026-11-08): change_item on an existing Publishing
// title (assistant/edits4.js): fields, people per role, editions by
// ISBN or kind (added when none matches, never removed), royalty terms
// as a whole list, through publish/core.js put. Undo restores it.
// Run: node --test tests/
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const E = require("../assistant/edits.js");
const E4 = require("../assistant/edits4.js");
const C = require("../publish/core.js");

const NOW = 1790000000000;
function ok(args) { const r = E.normArgs(Object.assign({ ref: "r1", action: "update" }, args)); assert.equal(r.ok, true, r.err); return r; }
function data() {
  let d = C.empty();
  d = C.put(d, "titles", { id: "t1", t: "Ψίθυρος", st: "out", ppl: [{ r: "a", n: "Γαντζούδης", crm: "c1" }],
                           fmts: [{ id: "f1", k: "pb", isbn: "9786185775643", price: 15, pages: 120 }] }, NOW - 1000);
  d = C.put(d, "titles", { id: "t2", t: "Άλλο", fmts: [{ id: "f2", k: "pb", isbn: "9786185321000" }] }, NOW - 1000);
  return JSON.parse(JSON.stringify(d));
}
const T = { title: "t1" };
function run(d, args) {
  const ch = ok(args);
  const p = E.plan("publish", d, T, ch, NOW);
  if (!p.ok) return p;
  const a = E.apply("publish", d, T, ch, NOW, p.before);
  assert.equal(a.ok, true, a.err);
  return Object.assign(a, { plan: p });
}
const title = (d) => C.find(C.normalize(d), "titles", "t1");

test("publish is a change_item app", () => {
  assert.ok(E.APP_IDS.includes("publish"));
  assert.equal(E.storageKey("publish"), "oros-publish-data");
  assert.deepEqual(E.actionsFor("publish"), ["update"]);
  assert.ok(E4.MODS.publish);
});

test("fields, release date, status and people; a CRM link stays", () => {
  const d = data();
  const r = run(d, { date: "2026-12-01", status: "production", subtitle: "Ποιήματα", language: "Greek", keywords: "ποίηση",
                     by: "Γαντζούδης, Β. Βασάλος", editor: "Στάμου", bio: "Γεννήθηκε…" });
  const t = title(r.data);
  assert.equal(t.rel, "2026-12-01");
  assert.equal(t.st, "prod");
  assert.equal(t.sub, "Ποιήματα");
  assert.deepEqual(t.ppl.filter((p) => p.r === "a"), [{ r: "a", n: "Γαντζούδης", crm: "c1" }, { r: "a", n: "Β. Βασάλος" }]);
  assert.deepEqual(t.ppl.filter((p) => p.r === "e").map((p) => p.n), ["Στάμου"]);
  assert.ok(t.m > NOW - 1000);
  const f = r.rows.map((x) => x.f);
  ["release", "status", "sub", "lang", "kw", "by", "editor", "bio"].forEach((k) => assert.ok(f.includes(k), k));
  const u = E.undo("publish", r.data, r.undo, NOW + 1);
  assert.equal(u.ok, true, u.err);
  assert.equal(title(u.data).rel, "");
  assert.equal(title(u.data).st, "out");
});

test("editions: by ISBN, by kind, a new one; dimensions and weight", () => {
  const d = data();
  const r = run(d, { formats: [
    { isbn: "978-618-57756-4-3", width: 140, height: 210, spine: 9.5, weight: 180, binding: "Paperback, sewn", price: 15.9 },
    { format: "ebook", price: 6.99 }
  ] });
  const t = title(r.data);
  assert.equal(t.fmts.length, 2);
  const pb = t.fmts.find((f) => f.id === "f1");
  assert.deepEqual([pb.w, pb.h, pb.sp, pb.wt, pb.bind, pb.price, pb.pages], [140, 210, 9.5, 180, "Paperback, sewn", 15.9, 120]);
  assert.equal(t.fmts.find((f) => f.k === "eb").price, 6.99);
  // the only paperback, by kind
  const r2 = run(r.data, { formats: [{ format: "paperback", pages: 128 }] });
  assert.equal(title(r2.data).fmts.find((f) => f.id === "f1").pages, 128);
});

test("refused: another title's ISBN, a bad ISBN, wc_id without a shop, unknown fields", () => {
  const d = data();
  let p = E.plan("publish", d, T, ok({ formats: [{ format: "hardback", isbn: "9786185321000" }] }), NOW);
  assert.equal(p.ok, false);
  assert.match(p.err, /Άλλο/);
  p = E.plan("publish", d, T, ok({ formats: [{ isbn: "9786185775644" }] }), NOW);
  assert.match(p.err, /check digit/);
  E4.setCache("woo", []);
  p = E.plan("publish", d, T, ok({ formats: [{ isbn: "9786185775643", wc_id: 81145 }] }), NOW);
  assert.match(p.err, /Connected services/);
  p = E.plan("publish", d, T, ok({ formats: [{ isbn: "9786185775643", print_run: 500 }] }), NOW);
  assert.match(p.err, /print_run/);
  p = E.plan("publish", d, T, ok({ status: "now" }), NOW);
  assert.equal(p.ok, false);
  p = E.plan("publish", d, T, ok({ phone: "2101234567" }), NOW);
  assert.equal(p.ok, false);
  p = E.plan("publish", d, T, ok({ date: "2026-12-01" }), NOW);
  assert.equal(p.ok, true);
  p = E.plan("shelf", { items: [] }, { item: "x" }, ok({ status: "released" }), NOW);
  assert.equal(p.ok, false);
});

test("wc_id with one connected shop links the edition", () => {
  E4.setCache("woo", [{ id: "w1", name: "glarolykoi", site: "https://glarolykoi.net" }]);
  const r = run(data(), { formats: [{ isbn: "9786185775643", wc_id: 81145 }] });
  assert.deepEqual(title(r.data).fmts[0].wp, { a: "w1", id: 81145 });
  E4.setCache("woo", []);
});

test("royalty terms replace the list; a kept term keeps its id", () => {
  const r = run(data(), { royalties: [{ name: "Γαντζούδης", percent: 10 }, { name: "Στάμου", percent: 5, base: "net", format: "ebook", advance: 100 }] });
  const roy = title(r.data).roy;
  assert.equal(roy.length, 2);
  assert.deepEqual(roy.map((x) => [x.n, x.pct, x.base, x.k, x.adv]), [["Γαντζούδης", 10, "list", "", 0], ["Στάμου", 5, "net", "eb", 100]].sort((a, b) => 0));
  const id = roy.find((x) => x.n === "Γαντζούδης").id;
  const r2 = run(r.data, { royalties: [{ name: "Γαντζούδης", percent: 12 }] });
  assert.deepEqual(title(r2.data).roy.map((x) => [x.id, x.pct]), [[id, 12]]);
  assert.equal(E.plan("publish", r2.data, T, ok({ royalties: [{ name: "X", percent: 120 }] }), NOW).ok, false);
});

test("nothing to change is refused", () => {
  const p = E.plan("publish", data(), T, ok({ language: "" }), NOW);
  assert.equal(p.ok, false);
  assert.match(p.err, /Nothing would change/);
});
