// designkit forward compatibility (wave L0, model level 2): the
// extension bag `ext`, Atelier `axu`, the equal-m tie rule and the
// per-document model level (setup.ext.mv). The "old client" is a
// frozen byte copy of designkit/model.js as it was before L0
// (tests/fixtures/designkit-model-2.56.js): every later wave is
// checked against it here. Synthetic documents only.
// Run: node --test tests/

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const M = require(path.join(ROOT, "designkit/model.js"));
const OLD = require(path.join(__dirname, "fixtures/designkit-model-2.56.js"));
const AX = require(path.join(ROOT, "atelier/ax.js"));          // registers the hook on M
const TPL = require(path.join(ROOT, "atelier/templates.js"));
require(path.join(ROOT, "atelier/templates-more.js"));

const J = (x) => JSON.stringify(x);
const clone = (x) => JSON.parse(J(x));
// The pre-L0 Atelier: the old model with the same extras normalizer.
OLD.setItemExt(AX.normAx);

function layoutDoc(now) {
  const d = M.newDoc({ name: "Compat", w: M.preset("a5").w, h: M.preset("a5").h, pages: 3, facing: 1 }, now || 1000);
  const pg = M.pagesInOrder(d);
  d.stories.push({ id: "st-main", m: 1000, paras: [
    { ps: "ps-h1", runs: [{ t: "Καλημέρα " }, { t: "κόσμε", b: 1 }] },
    { ps: "ps-body", runs: [{ t: "Lorem ipsum dolor sit amet. ".repeat(20) }] }] });
  d.items.push({ id: "it-t1", m: 1000, t: "text", pg: pg[0].id, x: 30, y: 40, w: 200, h: 300, story: "st-main", seq: 1, cols: 2, gut: 10, z: 1 });
  d.items.push({ id: "it-r1", m: 1000, t: "rect", pg: pg[1].id, x: 100, y: 150, w: 80, h: 60, fill: "sw-yellow", wrap: "box", wo: 6, z: 2 });
  d.items.push({ id: "it-e1", m: 1000, t: "ell", pg: pg[2].id, x: 10, y: 10, w: 50, h: 50, z: 3 });
  d.guides.push({ id: "gd-a", m: 1000, pg: pg[0].id, o: "h", p: 120 });
  return M.normDoc(d);
}
function atelierDocs() {
  const out = [];
  TPL.list.forEach((tpl) => ["en", "el"].forEach((lang) => out.push(AX.fromTemplate(tpl, lang, 1))));
  return out;
}
function allDocs() {
  const docs = [layoutDoc()].concat(atelierDocs());
  M.PRESETS.forEach((p, i) => docs.push(M.newDoc({ name: "P" + i, preset: p.id, w: p.w, h: p.h, pages: 2 }, 500 + i)));
  return docs;
}

// The sync engine (sync.js v0.7): merged = merge(local, remote);
// local takes merged; merged ≠ remote → upload merged.
function syncOnce(model, dev, cloud) {
  const merged = model.mergeData(dev.data, cloud.data);
  dev.data = merged;
  if (J(merged) !== J(cloud.data)) { cloud.data = merged; cloud.uploads++; return true; }
  return false;
}
function settle(devs, cloud, rounds) {
  let uploads = 0;
  for (let r = 0; r < (rounds || 6); r++) {
    let any = false;
    devs.forEach((d) => { if (syncOnce(d.model, d, cloud)) { any = true; uploads++; } });
    if (!any) return uploads;
  }
  return uploads;
}

// A level-2 document with `ext` on every kind of entity.
const EXT = { sh: { b: 4, c: "sw-black", x: 2, y: 2 }, lang: "el-GR", list: [1, "a", true, null, { k: [0] }] };
function extDoc() {
  const d = clone(layoutDoc());
  d.setup.ext = { cover: { spine: 12.5 } };
  d.cstyles.push({ id: "cs-em", m: 1000, name: "Emphasis", i: 1 });
  [d.pages[0], d.masters[0], d.items[0], d.items[1], d.stories[0], d.pstyles[0], d.cstyles[0], d.swatches[0], d.guides[0]]
    .forEach((e) => { e.ext = clone(EXT); });
  d.stories[0].paras[0].ext = { lang: "en" };
  d.stories[0].paras[0].runs[1].ext = { ff: "Noto Serif" };
  return M.normDoc(d);
}
function countExt(doc) {
  let n = 0;
  (function walk(v) {
    if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === "object") Object.keys(v).forEach((k) => { if (k === "ext") n++; walk(v[k]); });
  })(doc);
  return n;
}

test("model level and exports", () => {
  assert.equal(M.MODEL_LEVEL, 2);
  assert.equal(OLD.MODEL_LEVEL, undefined);
  assert.equal(M.DATA_VER, OLD.DATA_VER);
});

test("byte-identical: every existing kind of document normalizes as before", () => {
  const docs = allDocs();
  assert.ok(docs.length > 20);
  docs.forEach((d) => {
    const raw = clone(d);
    assert.equal(J(M.normDoc(raw)), J(OLD.normDoc(clone(d))), d.name);
  });
  const data = { ver: 1, docs: docs, dt: {} };
  assert.equal(J(M.normData(clone(data))), J(OLD.normData(clone(data))));
  assert.equal(J(M.mergeData(clone(data), clone(data))), J(OLD.mergeData(clone(data), clone(data))));
});

test("ext survives normData, mergeData (both orders), copyDoc and a package round trip", () => {
  const d = extDoc();
  const n = countExt(d);
  assert.equal(n, 12);
  assert.equal(J(M.normDoc(clone(d))), J(d));
  const data = { ver: 1, docs: [d], dt: {} };
  assert.equal(countExt(M.normData(clone(data)).docs[0]), n);
  const plain = { ver: 1, docs: [OLD.normDoc(clone(d))], dt: {} };   // the same doc, stripped
  assert.equal(countExt(plain.docs[0]), 0);
  assert.equal(countExt(M.mergeData(clone(data), clone(plain)).docs[0]), n);
  assert.equal(countExt(M.mergeData(clone(plain), clone(data)).docs[0]), n);
  assert.equal(countExt(M.copyDoc(d, 5000)), n);
  const pkg = JSON.parse(J({ kind: "oros-layout", ver: 1, doc: d }));
  assert.equal(J(M.normDoc(pkg.doc)), J(d));
  // runs with a different ext never coalesce, the same ext does
  const p = M.normPara({ ps: "ps-body", runs: [{ t: "a", ext: { ff: "A" } }, { t: "b", ext: { ff: "B" } }, { t: "c", ext: { ff: "B" } }] });
  assert.equal(p.runs.length, 2);
  assert.equal(p.runs[1].t, "bc");
});

test("the old client strips ext, and loses: sync sequences never erase it", () => {
  const d = extDoc();
  const n = countExt(d);
  [["new", "old"], ["old", "new"]].forEach((order) => {
    const devNew = { model: M, data: { ver: 1, docs: [clone(d)], dt: {} } };
    const devOld = { model: OLD, data: { ver: 1, docs: [], dt: {} } };
    const cloud = { data: { ver: 1, docs: [], dt: {} }, uploads: 0 };
    const devs = order[0] === "new" ? [devNew, devOld] : [devOld, devNew];
    for (let i = 0; i < 4; i++) devs.forEach((dv) => syncOnce(dv.model, dv, cloud));
    // the old device really does strip it (this is K1)
    assert.equal(countExt(devOld.data.docs[0]), 0, order.join(">"));
    assert.equal(countExt(devNew.data.docs[0]), n, order.join(">"));
  });
});

test("an untouched old device that pulls first cannot win the cloud", () => {
  const d = extDoc();
  const devOld = { model: OLD, data: { ver: 1, docs: [clone(d)], dt: {} } };   // stripped on its next normalize
  devOld.data = OLD.normData(devOld.data);
  assert.equal(countExt(devOld.data.docs[0]), 0);
  const cloud = { data: { ver: 1, docs: [], dt: {} }, uploads: 0 };
  syncOnce(OLD, devOld, cloud);                  // the stripped copy reaches the cloud first
  const devNew = { model: M, data: { ver: 1, docs: [clone(d)], dt: {} } };
  syncOnce(M, devNew, cloud);
  assert.equal(countExt(devNew.data.docs[0]), countExt(d));
  assert.equal(countExt(cloud.data.docs[0]), countExt(d));
});

test("two level-2 devices settle with zero idle uploads", () => {
  const d = extDoc();
  const a = { model: M, data: { ver: 1, docs: [clone(d)], dt: {} } };
  const b = { model: M, data: { ver: 1, docs: [], dt: {} } };
  const cloud = { data: { ver: 1, docs: [], dt: {} }, uploads: 0 };
  settle([a, b], cloud);
  assert.equal(settle([a, b], cloud), 0);
  assert.equal(J(a.data), J(b.data));
  // and without any ext (today's documents) the same holds
  const c = { model: M, data: { ver: 1, docs: allDocs(), dt: {} } };
  const o = { model: OLD, data: { ver: 1, docs: [], dt: {} } };
  const cl2 = { data: { ver: 1, docs: [], dt: {} }, uploads: 0 };
  settle([c, o], cl2);
  assert.equal(settle([c, o], cl2), 0);
  assert.equal(J(c.data), J(o.data));
});

test("equal-m ties: the copy with ext wins, then the larger JSON", () => {
  const a = M.normItem({ id: "it-a", m: 9, t: "rect", pg: "pg-a", x: 1, y: 1, w: 9, h: 9, ext: { sh: 1 } });
  const b = M.normItem({ id: "it-a", m: 9, t: "rect", pg: "pg-a", x: 2, y: 1, w: 9, h: 9 });
  assert.ok(M.keepsMore(a) && !M.keepsMore(b));
  const doc = (it) => ({ id: "doc-a", m: 1, name: "T", setup: {}, items: [it], pages: [{ id: "pg-a", m: 1, pos: 0 }] });
  assert.equal(M.mergeDoc(doc(a), doc(b)).items[0].x, 1);
  assert.equal(M.mergeDoc(doc(b), doc(a)).items[0].x, 1);
  const c = M.normItem({ id: "it-a", m: 9, t: "rect", pg: "pg-a", x: 1, y: 1, w: 9, h: 9, ext: { sh: 2 } });
  const w1 = M.mergeDoc(doc(a), doc(c)).items[0], w2 = M.mergeDoc(doc(c), doc(a)).items[0];
  assert.equal(J(w1), J(w2));
  // a higher m still wins, ext or not
  const newer = Object.assign(clone(b), { m: 10 });
  assert.equal(J(M.mergeDoc(doc(a), doc(newer)).items[0]), J(newer));
  // stories: ext in a run decides the tie and makes no Recovered text
  const s1 = { id: "st-a", m: 5, h: [], paras: [{ ps: "ps-body", runs: [{ t: "x", ext: { ff: "A" } }] }] };
  const s2 = { id: "st-a", m: 5, h: [], paras: [{ ps: "ps-body", runs: [{ t: "x" }] }] };
  const sd = (s) => ({ id: "doc-a", m: 1, name: "T", setup: {}, stories: [s] });
  [M.mergeDoc(sd(s1), sd(s2)), M.mergeDoc(sd(s2), sd(s1))].forEach((m) => {
    assert.deepEqual(m.stories[0].paras[0].runs[0].ext, { ff: "A" });
    assert.equal(m.rec.length, 0);
  });
  // doc meta: setup.ext decides an equal-m tie of name/setup
  const d1 = { id: "doc-a", m: 3, name: "A", setup: { ext: { cover: 1 } } };
  const d2 = { id: "doc-a", m: 3, name: "Z", setup: {} };
  assert.deepEqual(M.mergeDoc(d2, d1).setup.ext, { cover: 1 });
  assert.deepEqual(M.mergeDoc(d1, d2).setup.ext, { cover: 1 });
});

test("caps and hostile input drop the whole bag, never throw, never pollute", () => {
  const deep = (n) => { let v = 1; for (let i = 0; i < n; i++) v = { a: v }; return v; };
  assert.ok(M.normX(deep(6)));
  assert.equal(M.normX(deep(7)), null);
  assert.ok(M.normX({ s: "a".repeat(4000) }));
  assert.equal(M.normX({ s: "a".repeat(4001) }), null);
  assert.equal(M.normX({ s: "a".repeat(3000), t: "b".repeat(3000), u: "c".repeat(3000) }), null);   // > 8 KB
  assert.ok(M.normX({ s: "a".repeat(3000), t: "b".repeat(3000), u: "c".repeat(3000) }, 65536));
  assert.equal(M.normX({ arr: new Array(1001).fill(0) }), null);
  [{ Bad: 1 }, { "1a": 1 }, { "a-b": 1 }, { a: NaN }, { a: Infinity }, { a: () => 1 }, { a: undefined },
    { a: "x\u0001" }, { a: new Date(0) }, { a: [1, NaN] }, [1], "s", 5, null, {}].forEach((v) => {
    assert.equal(M.normX(v), null, J(v));
  });
  const hostile = JSON.parse('{"__proto__":{"polluted":1},"a":1}');
  assert.equal(M.normX(hostile), null);
  assert.equal({}.polluted, undefined);
  const ctor = M.normX({ constructor: { prototype: { polluted: 1 } } });
  assert.deepEqual(ctor, { constructor: { prototype: { polluted: 1 } } });
  assert.equal({}.polluted, undefined);
  assert.equal(J(M.normX({ b: 1, a: { d: 1, c: 2 } })), '{"a":{"c":2,"d":1},"b":1}');
  assert.equal(M.normX({ t: "line\nnext\ttab" }).t, "line\nnext\ttab");
  // an item with a bad bag keeps everything else
  const it = M.normItem({ id: "it-a", m: 1, t: "rect", pg: "pg-a", x: 5, y: 6, w: 7, h: 8, ext: { a: NaN } });
  assert.equal(it.ext, undefined);
  assert.equal(it.x, 5);
  // an item's x stays its position (the bag is `ext`, never `x`)
  assert.equal(M.keepsMore(M.normItem({ id: "it-a", m: 1, t: "rect", pg: "pg-a", x: 5, y: 6, w: 7, h: 8 })), false);
  assert.deepEqual(M.unknownX({ ext: { a: 1, b: 2 } }, ["a"]), ["b"]);
  assert.deepEqual(M.unknownX({}, ["a"]), []);
});

test("axu: an Atelier element of a kind this copy does not know is kept", () => {
  const raw = { id: "it-z", m: 4, t: "rect", pg: "pg-a", x: 1, y: 2, w: 30, h: 40, ax: { k: "qr", data: "https://example.org", fc: "#000000" } };
  const it = M.normItem(raw);
  assert.equal(it.ax, undefined);
  assert.deepEqual(it.axu, { data: "https://example.org", fc: "#000000", k: "qr" });
  assert.equal(J(M.normItem(clone(it))), J(it));                   // stable
  // a known kind is unchanged, and a known kind on the wrong item is dropped as before
  const shape = M.normItem({ id: "it-s", m: 4, t: "rect", pg: "pg-a", x: 1, y: 2, w: 3, h: 4, ax: { k: "shape" } });
  assert.deepEqual(shape.ax, { k: "shape", shp: "rect" });
  assert.equal(shape.axu, undefined);
  const wrong = M.normItem({ id: "it-w", m: 4, t: "rect", pg: "pg-a", x: 1, y: 2, w: 3, h: 4, ax: { k: "photo" } });
  assert.equal(wrong.ax, undefined);
  assert.equal(wrong.axu, undefined);
  // axu turns back into ax on a copy that knows the kind
  const back = M.normItem({ id: "it-b", m: 4, t: "rect", pg: "pg-a", x: 1, y: 2, w: 3, h: 4, axu: { k: "shape" } });
  assert.deepEqual(back.ax, { k: "shape", shp: "rect" });
  assert.equal(back.axu, undefined);
  // and it wins an equal-m tie against a copy that lost it
  const doc = (i) => ({ id: "doc-a", m: 1, name: "T", setup: {}, items: [i] });
  const lost = Object.assign(clone(raw), { ax: undefined });
  assert.deepEqual(M.mergeDoc(doc(lost), doc(raw)).items[0].axu, it.axu);
  assert.deepEqual(M.mergeDoc(doc(raw), doc(lost)).items[0].axu, it.axu);
});

test("model level: a document that needs a newer orOS is recognised and kept", () => {
  const d = clone(layoutDoc());
  assert.equal(M.minLevel(d), 1);
  assert.equal(M.needsNewer(d), false);
  d.setup.ext = { mv: 3 };
  const n = M.normDoc(d);
  assert.equal(M.minLevel(n), 3);
  assert.equal(M.needsNewer(n), true);
  const m = M.mergeData({ ver: 1, docs: [n], dt: {} }, { ver: 1, docs: [OLD.normDoc(clone(n))], dt: {} });
  assert.equal(m.docs[0].setup.ext.mv, 3);
  ["2", 2.5, -4, 1, 0].forEach((v) => assert.equal(M.minLevel({ setup: { ext: { mv: v } } }), 1, String(v)));
  assert.equal(M.needsNewer({ setup: { ext: { mv: 2 } } }), false);
});
