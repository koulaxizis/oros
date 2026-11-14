// Forms wave 2 (FORMS-2), the pure parts: the published form record
// (core.js normX, fingerprint), the answers slice (cleanAnswers,
// addAnswers, mergeAnswers R26/R27, unread, markSeen, dropOrphans,
// answerLines), the link and crypto of forms/pub.js, engine validBack,
// the Today provider (forms/today.js) and the shell notifier's pure
// helpers (forms/host.js).
// Run: node --test tests/
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const E = require(path.join(__dirname, "..", "forms", "engine.js"));
const C = require(path.join(__dirname, "..", "forms", "core.js"));
const P = require(path.join(__dirname, "..", "forms", "pub.js"));
const TODAY = require(path.join(__dirname, "..", "forms", "today.js"));
const H = require(path.join(__dirname, "..", "forms", "host.js"));

let KEYS = null;
async function keys() { return KEYS || (KEYS = await P.newKeys()); }
function xOf(k, extra) { return Object.assign({ k: k.k, sec: k.sec, key: k.key, priv: k.priv, open: 1, close: 0, at: 5 }, extra || {}); }

test("pub.js: keys have the relay's shapes; the link carries k and key and parses back", async () => {
  const k = await keys();
  assert.match(k.k, /^[a-z0-9]{16}$/);
  assert.match(k.sec, /^[A-Za-z0-9]{32}$/);
  assert.match(k.key, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(k.pub.alg, "RSA-OAEP-256");
  assert.equal(k.pub.d, undefined);                                  // never the private half
  const link = P.link(k.k, k.key);
  assert.equal(link, "https://useoros.online/forms/f/#" + k.k + "." + k.key);
  assert.deepEqual(P.parse(link), { k: k.k, key: k.key });
  assert.deepEqual(P.parse("#" + k.k + "." + k.key), { k: k.k, key: k.key });
  assert.equal(P.parse("#" + k.k), null);
  assert.equal(P.parse("#" + k.k.toUpperCase() + "." + k.key), null);
});

test("pub.js: the form opens only with its key and its k; answers open only with the form's private key", async () => {
  const k = await keys();
  const def = await P.encDef(k.key, k.k, { v: 1, form: { title: "Ω" }, pub: k.pub });
  assert.match(def, /^[A-Za-z0-9_-]+$/);
  assert.equal((await P.decDef(k.key, k.k, def)).form.title, "Ω");
  await assert.rejects(P.decDef(k.key, "a".repeat(16), def), (e) => e.code === "bad");
  await assert.rejects(P.decDef(k.key, k.k, def.slice(0, -4) + "AAAA"), (e) => e.code === "bad");
  const v = await P.seal(k.pub, { a: { q1: "ναι" } });
  assert.deepEqual((await P.open(k.priv, v)).a, { q1: "ναι" });
  const other = await P.newKeys();
  await assert.rejects(P.open(other.priv, v));
});

test("engine: set.back is an https link only, set.once a flag", () => {
  assert.equal(E.validBack("https://shop.example/thanks?a=1"), true);
  for (const bad of ["http://x.gr", "javascript:alert(1)", "https://a:b@x.gr", "https://x", "https://x.gr/a b", "https://x.gr/\"", "x".repeat(600)]) {
    assert.equal(E.validBack(bad), false, bad);
  }
  assert.deepEqual(E.normForm({ title: "a", set: { back: "javascript:1", once: "yes" } }).set, { once: 1 });
});

test("core: x is kept only when it is a real published form; fingerprint follows what people see", async () => {
  const k = await keys();
  const rec = C.normRecord({ id: "f1", m: 2, title: "T", qs: [], x: xOf(k, { dev: "abcdef12", pubH: "zz1", evil: "<b>" }) });
  assert.equal(rec.x.k, k.k);
  assert.equal(rec.x.dev, "abcdef12");
  assert.equal(rec.x.evil, undefined);
  assert.deepEqual(Object.keys(rec.x.priv).sort(), ["alg", "d", "dp", "dq", "e", "kty", "n", "p", "q", "qi"]);
  assert.equal(C.normRecord({ id: "f1", m: 2, title: "T", qs: [], x: xOf(k, { sec: "short" }) }).x, undefined);
  assert.equal(C.normRecord({ id: "f1", m: 2, title: "T", qs: [], x: xOf(k, { priv: { kty: "RSA" } }) }).x, undefined);
  const a = C.fingerprint({ title: "T", qs: [{ id: "q", t: "text", label: "A" }] });
  assert.equal(a, C.fingerprint({ title: "T", qs: [{ id: "q", t: "text", label: "A" }], m: 99, x: { k: 1 } }));
  assert.notEqual(a, C.fingerprint({ title: "T", qs: [{ id: "q", t: "text", label: "B" }] }));
  assert.notEqual(a, C.fingerprint({ title: "T", qs: [{ id: "q", t: "text", label: "A" }], set: { once: 1 } }));
});

test("core: answers from strangers are cleaned to plain values under question keys", () => {
  const a = C.cleanAnswers({ q1: "hi\u0000", "q1.o": "x", q2: 3, q3: ["a", 5, "b"], q4: { r1: "c1", r2: ["c1", "c2"], "R!": "x", r3: { deep: 1 } },
                              "__proto__": "x", "Bad Key": "x", q5: Infinity, q6: true, q7: null });
  assert.deepEqual(a, { q1: "hi", "q1.o": "x", q2: 3, q3: ["a", "b"], q4: { r1: "c1", r2: ["c1", "c2"] }, q6: 1 });
  assert.deepEqual(C.cleanAnswers("x"), {});
  assert.deepEqual(C.cleanAnswers({ q: "x".repeat(6000) }).q.length, E.LIM.para);
});

test("core: addAnswers dedupes and keeps R27; merge is a union with tombstones winning (R26)", () => {
  const K = "abcdefgh12345678";
  let d = C.normAnswers(null);
  const r1 = C.addAnswers(d, "f1", [{ id: K + ".1", at: 10, a: { q: "a" } }, { id: K + ".2", at: 20, a: { q: "b" }, w: 1, l: "el" }]);
  assert.equal(r1.added, 2);
  const r2 = C.addAnswers(r1.data, "f1", [{ id: K + ".1", at: 10, a: { q: "a" } }]);
  assert.equal(r2.added, 0);
  assert.equal(JSON.stringify(r2.data), JSON.stringify(r1.data));
  assert.equal(C.addAnswers(r1.data, "f1", [{ id: "bad", at: 1 }, { id: K + ".3", at: 0 }]).added, 0);
  const other = C.normAnswers({ rs: [{ id: K + ".1", f: "f1", del: 1 }, { id: K + ".9", f: "f2", at: 30, a: {} }], seen: { f1: 15 } });
  const m = C.mergeAnswers(r1.data, other);
  assert.deepEqual(m.rs.map((r) => r.id + (r.del ? "-" : "")), [K + ".1-", K + ".2", K + ".9"]);
  assert.equal(JSON.stringify(C.mergeAnswers(m, m)), JSON.stringify(m));
  assert.equal(JSON.stringify(C.mergeAnswers(other, r1.data)), JSON.stringify(m));
  assert.deepEqual(m.seen, { f1: 15 });
  assert.equal(C.answersOf(m, "f1").length, 1);
  assert.equal(C.answersOf(m, "f1")[0].w, 1);
});

test("core: unread, markSeen, dropOrphans", () => {
  const K = "abcdefgh12345678";
  let d = C.addAnswers(null, "f1", [{ id: K + ".1", at: 10, a: {} }, { id: K + ".2", at: 20, a: {} }]).data;
  d = C.addAnswers(d, "f2", [{ id: K + ".3", at: 30, a: {} }]).data;
  assert.equal(C.unread(d, "f1"), 2);
  const s = C.markSeen(d, "f1", 99);
  assert.equal(s.changed, true);
  assert.equal(C.unread(s.data, "f1"), 0);
  assert.equal(C.markSeen(s.data, "f1", 100).changed, false);           // R27
  assert.equal(C.unread(s.data, "f2"), 1);
  const o = C.dropOrphans(s.data, { forms: [{ id: "f2", m: 5, del: 1 }] });
  assert.equal(o.changed, true);
  assert.deepEqual(o.data.rs.map((r) => r.f), ["f1", "f1"]);
  assert.equal(C.dropOrphans(o.data, { forms: [] }).changed, false);
});

test("core: the caps keep the newest answers, per form and in all", () => {
  const K = "abcdefgh12345678";
  const rows = [];
  for (let i = 1; i <= C.MAX_PER_FORM + 3; i++) rows.push({ id: K + "." + i, at: i, a: {} });
  const d = C.addAnswers(null, "f1", rows).data;
  assert.equal(C.answersOf(d, "f1").length, C.MAX_PER_FORM);
  assert.equal(C.answersOf(d, "f1").slice(-1)[0].at, 4);                // the 3 oldest went
});

test("core: answerLines shows an answer by the form's own labels, text only", () => {
  const form = E.normForm({ id: "f1", title: "T", qs: [
    { id: "a", t: "text", label: "Name" },
    { id: "b", t: "choice", label: "Pick", opts: [{ id: "x", label: "Ex" }, { id: "y", label: "Why" }], other: 1 },
    { id: "c", t: "multi", label: "Many", opts: [{ id: "x", label: "One" }, { id: "y", label: "Two" }] },
    { id: "d", t: "yesno", label: "OK?" },
    { id: "e", t: "stars", label: "Stars", hi: 5 },
    { id: "g", t: "matrix", label: "Grid", rows: [{ id: "r1", label: "Row" }], opts: [{ id: "c1", label: "Col" }] },
    { id: "i", t: "info", label: "Just text" },
    { id: "h", t: "number", label: "Count" }
  ] });
  const W = { yes: "Yes", no: "No", other: (x) => "Other: " + x };
  const lines = C.answerLines(form, { a: "<b>Ann</b>", b: "_o", "b.o": "mine", c: ["y", "zz"], d: "no", e: 4, g: { r1: "c1" }, h: "7" }, W);
  assert.deepEqual(lines.map((l) => [l.label, l.text]), [
    ["Name", "<b>Ann</b>"], ["Pick", "Other: mine"], ["Many", "Two"], ["OK?", "No"], ["Stars", "4 / 5"], ["Grid", "Row: Col"], ["Count", "7"]
  ]);
  // "zz" is no longer a choice: the engine drops it, the rest stays
  assert.equal(C.answerLines(form, { c: ["y"] }, W)[2].text, "Two");
});

test("today.js: one line per form with new answers here or waiting at the relay", () => {
  const store = {
    "oros-forms-data": { forms: [{ id: "f1", title: "Survey" }, { id: "f2", title: "" }, { id: "f3", del: 1 }] },
    "oros-forms-answers": { rs: [{ id: "a", f: "f1", at: 10 }, { id: "b", f: "f1", at: 30 }, { id: "c", f: "f3", at: 40 }], seen: { f1: 20 } },
    "oros-forms-wait": { f1: { n: 2 }, f2: { n: 1 } }
  };
  const rows = TODAY.collect({ lang: "en", readJSON: (k) => store[k] || null });
  assert.deepEqual(rows.map((r) => [r.title, r.text, r.target.form, r.target.tab]),
    [["3 new answers", "Survey", "f1", "resp"], ["1 new answer", "Untitled form", "f2", "resp"]]);
  assert.deepEqual(TODAY.collect({ lang: "el", readJSON: () => null }), []);
  assert.equal(TODAY.collect({ lang: "el", readJSON: (k) => store[k] })[0].title, "3 νέες απαντήσεις");
});

test("host.js: only this device's published forms are checked; a notice only when more wait", () => {
  const S32 = "S".repeat(32);
  const data = { forms: [
    { id: "a", title: "A", x: { dev: "dev111", k: "a".repeat(16), sec: S32 } },
    { id: "b", title: "B", x: { dev: "other1", k: "b".repeat(16), sec: S32 } },
    { id: "c", title: "C" },
    { id: "d", del: 1, x: { dev: "dev111", k: "d".repeat(16), sec: S32 } },
    { id: "e", x: { dev: "dev111", k: "BAD", sec: S32 } }
  ] };
  assert.deepEqual(H.mine(data, "dev111").map((f) => f.id), ["a"]);
  assert.deepEqual(H.mine(null, "dev111"), []);
  assert.equal(H.shouldTell(null, 0), false);
  assert.equal(H.shouldTell(null, 1), true);
  assert.equal(H.shouldTell({ n: 3 }, 3), false);
  assert.equal(H.shouldTell({ n: 3 }, 4), true);
});
