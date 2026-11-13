// Forms (wave 1): the form engine (forms/engine.js) and the synced
// slice (forms/core.js): normalizing, references, show-if, jumps, the
// answer checks, submit, and the merge rules (R26 canonical, R27).
// Run: node --test tests/

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const E = require(path.join(__dirname, "..", "forms", "engine.js"));
const C = require(path.join(__dirname, "..", "forms", "core.js"));

function form(qs, extra) { return E.normForm(Object.assign({ id: "f1", title: "T", qs: qs }, extra || {})); }

test("normItem: unknown types, bad ids and junk fields are dropped", () => {
  assert.equal(E.normItem({ id: "a", t: "nope" }), null);
  assert.equal(E.normItem({ id: "A B", t: "text" }), null);
  const q = E.normItem({ id: "a", t: "text", label: "  Hi\u0000 there \u202e ", req: true, evil: "<b>", minL: 5, maxL: 2 });
  assert.deepEqual(q, { id: "a", t: "text", label: "Hi there", req: 1, minL: 5 });
  const c = E.normItem({ id: "c", t: "choice", opts: [{ id: "x", label: "X" }, { id: "x", label: "dup" }, { id: "_o", label: "o" }, "junk"] });
  assert.deepEqual(c.opts, [{ id: "x", label: "X" }]);
  assert.equal(E.normItem({ id: "p", t: "page", req: 1 }).req, undefined);
  assert.equal(E.normItem({ id: "i", t: "info", req: 1 }).req, undefined);
  const s = E.normItem({ id: "s", t: "scale", lo: 7, hi: 99 });
  assert.equal(s.lo, 1); assert.equal(s.hi, 10);
  const m = E.normItem({ id: "m", t: "matrix" });
  assert.equal(m.rows.length, 1); assert.equal(m.opts.length, 1);
});

test("normForm: ids unique, show only on earlier questions, jumps only forward", () => {
  const f = form([
    { id: "a", t: "choice", opts: [{ id: "y", label: "Y" }, { id: "n", label: "N" }], go: { y: "p2", n: "end", zz: "p2" } },
    { id: "a", t: "text" },
    { id: "b", t: "text", show: { q: "a", op: "eq", v: "y" } },
    { id: "c", t: "text", show: { q: "d", op: "set" } },           // d is later → dropped
    { id: "p2", t: "page", next: "p2" },                            // self → dropped
    { id: "d", t: "yesno", go: { yes: "p2" } },                     // backward → dropped
    { id: "e", t: "text", show: { q: "a", op: "eq", v: "nope" } },  // not an option → dropped
    { id: "g", t: "number", show: { q: "a", op: "gt", v: 3 } }      // gt on a choice → dropped
  ]);
  assert.deepEqual(f.qs.map((q) => q.id), ["a", "b", "c", "p2", "d", "e", "g"]);
  assert.deepEqual(f.qs[0].go, { n: "end", y: "p2" });
  assert.deepEqual(f.qs[1].show, { q: "a", op: "eq", v: "y" });
  assert.equal(f.qs[2].show, undefined);
  assert.equal(f.qs[3].next, undefined);
  assert.equal(f.qs[4].go, undefined);
  assert.equal(f.qs[5].show, undefined);
  assert.equal(f.qs[6].show, undefined);
  // idempotent
  assert.deepEqual(E.normForm(f), f);
});

test("checkOne: every type", () => {
  const q = (o) => E.normItem(Object.assign({ id: "q" }, o));
  assert.equal(E.checkOne(q({ t: "text", req: 1 }), "  "), "req");
  assert.equal(E.checkOne(q({ t: "text" }), ""), "");
  assert.equal(E.checkOne(q({ t: "text", minL: 3 }), "ab"), "short");
  assert.equal(E.checkOne(q({ t: "para", maxL: 3 }), "abcd"), "long");
  assert.equal(E.checkOne(q({ t: "email" }), "a@b"), "email");
  assert.equal(E.checkOne(q({ t: "email" }), "a@b.gr"), "");
  assert.equal(E.checkOne(q({ t: "phone" }), "+30 210 123"), "");
  assert.equal(E.checkOne(q({ t: "phone" }), "call me"), "phone");
  assert.equal(E.checkOne(q({ t: "number" }), "abc"), "num");
  assert.equal(E.checkOne(q({ t: "number" }), "3,5"), "");
  assert.equal(E.checkOne(q({ t: "number", int: 1 }), "3.5"), "int");
  assert.equal(E.checkOne(q({ t: "number", min: 1, max: 5 }), "0"), "min");
  assert.equal(E.checkOne(q({ t: "number", min: 1, max: 5 }), 6), "max");
  assert.equal(E.checkOne(q({ t: "date" }), "2026-02-30"), "date");
  assert.equal(E.checkOne(q({ t: "date", min: "2026-01-01" }), "2025-12-31"), "min");
  assert.equal(E.checkOne(q({ t: "time" }), "24:00"), "time");
  assert.equal(E.checkOne(q({ t: "time" }), "09:30"), "");
  const ch = { t: "choice", opts: [{ id: "a", label: "A" }], other: 1 };
  assert.equal(E.checkOne(q(ch), "zz"), "opt");
  assert.equal(E.checkOne(q(ch), "_o", ""), "other");
  assert.equal(E.checkOne(q(ch), "_o", "mine"), "");
  const mu = { t: "multi", opts: [{ id: "a" }, { id: "b" }, { id: "c" }], minC: 2, maxC: 2 };
  assert.equal(E.checkOne(q(mu), ["a"]), "few");
  assert.equal(E.checkOne(q(mu), ["a", "b", "c"]), "many");
  assert.equal(E.checkOne(q(mu), ["a", "zz", "b"]), "");
  assert.equal(E.checkOne(q(Object.assign({ req: 1 }, mu)), ["zz"]), "req");
  assert.equal(E.checkOne(q({ t: "scale", lo: 0, hi: 10 }), 0), "");
  assert.equal(E.checkOne(q({ t: "stars", hi: 5 }), 6), "opt");
  assert.equal(E.checkOne(q({ t: "yesno" }), "maybe"), "opt");
  const mx = { t: "matrix", req: 1, rows: [{ id: "r1" }, { id: "r2" }], opts: [{ id: "c1" }] };
  assert.equal(E.checkOne(q(mx), { r1: "c1" }), "rows");
  assert.equal(E.checkOne(q(mx), { r1: "c1", r2: "c1" }), "");
  assert.equal(E.checkOne(q({ t: "info", req: 1 }), undefined), "");
});

const event = () => form([
  { id: "name", t: "text", req: 1 },
  { id: "come", t: "yesno", req: 1, go: { no: "end" } },
  { id: "p2", t: "page", label: "Details" },
  { id: "n", t: "number", int: 1, min: 1, req: 1 },
  { id: "diet", t: "multi", opts: [{ id: "v" }, { id: "g" }], other: 1 },
  { id: "why", t: "para", show: { q: "diet", op: "has", v: "g" }, req: 1 },
  { id: "p3", t: "page", label: "End" },
  { id: "more", t: "text", show: { q: "why", op: "set" } }
]);

test("pages, nextPage, path follow jumps", () => {
  const f = event();
  assert.equal(E.pages(f).length, 3);
  assert.deepEqual(E.path(f, { name: "A", come: "no" }), [0]);
  assert.deepEqual(E.path(f, { name: "A", come: "yes" }), [0, 1, 2]);
  assert.deepEqual(E.path(f, {}), [0, 1, 2]);
  const g = form([{ id: "a", t: "text" }, { id: "p", t: "page", next: "end" }, { id: "b", t: "text" }, { id: "q", t: "page" }]);
  assert.deepEqual(E.path(g, {}), [0, 1]);
});

test("shownMap: conditions, chains through hidden questions, unset", () => {
  const f = event();
  let s = E.shownMap(f, { diet: ["v"] });
  assert.equal(s.why, false);
  assert.equal(s.more, false);
  s = E.shownMap(f, { diet: ["g"], why: "x" });
  assert.equal(s.why, true);
  assert.equal(s.more, true);
  // why answered but then hidden: "more" (depends on why) hides too
  s = E.shownMap(f, { diet: ["v"], why: "x" });
  assert.equal(s.more, false);
  const g = form([{ id: "a", t: "number" }, { id: "b", t: "text", show: { q: "a", op: "gt", v: 10 } },
    { id: "c", t: "text", show: { q: "a", op: "unset" } }, { id: "d", t: "text" },
    { id: "e", t: "text", show: { q: "d", op: "eq", v: "Yes" } }]);
  assert.equal(E.shownMap(g, { a: "11" }).b, true);
  assert.equal(E.shownMap(g, { a: 10 }).b, false);
  assert.equal(E.shownMap(g, {}).c, true);
  assert.equal(E.shownMap(g, { a: 1 }).c, false);
  assert.equal(E.shownMap(g, { d: "yes" }).e, true);      // text compares without case
});

test("checkPage and submit: hidden questions are never required or kept", () => {
  const f = event();
  assert.deepEqual(E.checkPage(f, 0, {}), { name: "req", come: "req" });
  assert.deepEqual(E.checkPage(f, 1, { n: 2, diet: ["v"] }), {});
  assert.deepEqual(E.checkPage(f, 1, { n: 2, diet: ["g"] }), { why: "req" });
  const r = E.submit(f, { name: " Ann ", come: "yes", n: "2", diet: ["v", "_o"], "diet.o": " nuts ", why: "hidden", more: "x" });
  assert.equal(r.ok, true);
  assert.deepEqual(r.answers, { name: "Ann", come: "yes", n: 2, diet: ["v", "_o"], "diet.o": "nuts" });
  // "no" ends after page 1: page 2 answers are not kept
  const r2 = E.submit(f, { name: "B", come: "no", n: 5 });
  assert.deepEqual(r2.answers, { name: "B", come: "no" });
  const r3 = E.submit(f, { name: "B", come: "yes" });
  assert.equal(r3.ok, false);
  assert.equal(r3.page, 1);
  assert.equal(r3.errs.n, "req");
  assert.equal(r3.answers, null);
});

test("blank and reid", () => {
  const taken = {};
  const q = E.blank("matrix", taken, { row1: "R", col1: "C" });
  assert.equal(q.rows[0].label, "R");
  const items = [{ id: "a", t: "yesno", go: { no: "p" } }, { id: "p", t: "page" }, { id: "b", t: "text", show: { q: "a", op: "eq", v: "yes" } }];
  const out = E.reid(items, {});
  assert.notEqual(out[0].id, "a");
  assert.equal(out[0].go.no, out[1].id);
  assert.equal(out[2].show.q, out[0].id);
  for (const t of E.TYPES) assert.ok(E.blank(t, {}), t);
});

test("core: normalize is canonical and merge(a, a) = a (R26)", () => {
  const a = C.normalize({ forms: [
    { id: "zz", m: 5, c: 1, title: "Z", qs: [{ id: "q", t: "text" }] },
    { id: "aa", m: 3, title: "A", qs: [], x: { pub: { k: "abc" } } },
    { id: "dd", m: 9, del: 1, title: "gone" }
  ] });
  assert.deepEqual(a.forms.map((f) => f.id), ["aa", "dd", "zz"]);
  assert.deepEqual(a.forms[1], { id: "dd", m: 9, del: 1 });
  assert.deepEqual(a.forms[0].x, { pub: { k: "abc" } });
  assert.equal(JSON.stringify(C.merge(a, a)), JSON.stringify(a));
  assert.equal(JSON.stringify(C.normalize(a)), JSON.stringify(a));
});

test("core: newer wins per form, tombstone wins a tie, both orders agree", () => {
  const A = { forms: [{ id: "f1", m: 10, title: "old", qs: [] }, { id: "f2", m: 4, title: "keep", qs: [] }] };
  const B = { forms: [{ id: "f1", m: 12, title: "new", qs: [] }, { id: "f3", m: 1, title: "b only", qs: [] }] };
  const ab = C.merge(A, B), ba = C.merge(B, A);
  assert.equal(JSON.stringify(ab), JSON.stringify(ba));
  assert.equal(C.find(ab, "f1").title, "new");
  assert.ok(C.find(ab, "f2") && C.find(ab, "f3"));
  const T = { forms: [{ id: "f1", m: 12, del: 1 }] };
  assert.equal(C.find(C.merge(B, T), "f1").del, 1);
  assert.equal(C.find(C.merge(T, B), "f1").del, 1);
  const L = { forms: [{ id: "f1", m: 13, title: "later edit", qs: [] }] };
  assert.equal(C.find(C.merge(T, L), "f1").title, "later edit");
});

test("core: put stamps only real changes (R27); remove and restore", () => {
  let d = C.normalize({});
  let r = C.put(d, { id: "f1", title: "One", qs: [] }, 1000);
  assert.equal(r.changed, true);
  d = r.data;
  const m1 = C.find(d, "f1").m;
  r = C.put(d, JSON.parse(JSON.stringify(C.find(d, "f1"))), 2000);
  assert.equal(r.changed, false);
  assert.equal(C.find(r.data, "f1").m, m1);
  r = C.put(d, Object.assign({}, C.find(d, "f1"), { title: "Two" }), 1500);
  assert.equal(r.changed, true);
  assert.ok(C.find(r.data, "f1").m > m1);
  assert.equal(C.find(r.data, "f1").c, 1000);
  d = r.data;
  const del = C.remove(d, "f1", 1600);
  assert.equal(C.find(del.data, "f1").del, 1);
  assert.equal(C.live(del.data).length, 0);
  const back = C.restore(del.data, del.old, 1700);
  assert.equal(C.find(back, "f1").title, "Two");
  assert.ok(C.find(back, "f1").m > C.find(del.data, "f1").m);
});

test("core: an over-sized opaque x is not kept; the form cap keeps the newest", () => {
  const big = { s: "x".repeat(200001) };
  assert.equal(C.normalize({ forms: [{ id: "a", m: 1, title: "", qs: [], x: big }] }).forms[0].x, undefined);
  const many = [];
  for (let i = 0; i < C.MAX_FORMS + 3; i++) many.push({ id: "f" + i, m: i + 1, title: "", qs: [] });
  const n = C.normalize({ forms: many });
  assert.equal(n.forms.length, C.MAX_FORMS);
  assert.equal(C.find(n, "f0"), null);
  assert.ok(C.find(n, "f" + (C.MAX_FORMS + 2)));
});
