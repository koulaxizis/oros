// Layout automations (layout/recipesteps.js, wave A2): the catalog
// through recipes/core.js, find / replace across runs and around
// fields, paragraph styles and masters by id or name, margins in mm,
// the same recipe twice changes nothing more, preflight counts.
// Run: node --test tests/

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const T = require(path.join(ROOT, "designkit/text.js"));
const M = require(path.join(ROOT, "designkit/model.js"));
const R = require(path.join(ROOT, "designkit/render.js"));
const C = require(path.join(ROOT, "recipes/core.js"));
const S = require(path.join(ROOT, "layout/recipesteps.js"));

T.allKeys().forEach((k) => {
  const b = fs.readFileSync(path.join(ROOT, "vendor/noto", T.fontFile(k)));
  T.register(k, b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
});

const MM = 72 / 25.4;

function doc() {
  const d = M.newDoc({ name: "News", pages: 4, facing: 1 }, 1000);
  const pg = M.pagesInOrder(d);
  d.pstyles.push({ id: "ps-custom12ab", m: 1000, name: "Pull quote", base: "ps-base", i: 1 });
  d.masters.push({ id: "ms-bbbbbbbbbbbb", m: 1000, name: "B-Cover", pre: "B" });
  d.stories.push({ id: "st-a", m: 1000, paras: [
    { ps: "ps-h1", runs: [{ t: "orOS News" }] },
    { ps: "ps-body", runs: [{ t: "Read or" }, { t: "OS today", b: 1 }, { t: " and more orOS." }] },
    { ps: "ps-body", runs: [{ t: "Page " }, { f: "pn" }, { t: " of orOS" }] },
    { ps: "ps-base", runs: [{ t: "colorOSity is not a word" }] }
  ] });
  d.items.push({ id: "it-a", m: 1000, t: "text", pg: pg[0].id, x: 40, y: 40, w: 400, h: 600, story: "st-a", seq: 1, z: 1 });
  return M.normDoc(d);
}
function text(d) { return d.stories[0].paras.map((p) => p.runs.map((r) => r.t !== undefined ? r.t : "[" + r.f + "]").join("")); }
function run(d, st, now) {
  const c = C.normStep(st, S.CATALOG);
  assert.ok(c, "step passes the catalog: " + JSON.stringify(st));
  return S.apply(d, c, now || 2000);
}

test("catalog: every op in ORDER, required fields enforced", () => {
  assert.deepEqual(S.ORDER.slice().sort(), Object.keys(S.CATALOG).sort());
  assert.equal(C.normStep({ op: "text", find: "" }, S.CATALOG), null, "find is required");
  assert.equal(C.normStep({ op: "pstyle", from: "" }, S.CATALOG), null, "to is required");
  assert.equal(C.normStep({ op: "margins", t: 10, b: 10, i: 10 }, S.CATALOG), null, "every margin");
  const m = C.normStep({ op: "margins", t: 900, b: -3, i: 12.345, o: 0 }, S.CATALOG);
  assert.deepEqual([m.t, m.b, m.i, m.o], [500, 0, 12.35, 0]);
  const e = C.normStep({ op: "export", q: "huge" }, S.CATALOG);
  assert.equal(e.q, "print");
  assert.equal(C.normStep({ op: "script", code: "alert(1)" }, S.CATALOG), null, "no unknown ops");
});

test("text: across runs with the first run's formatting, around fields, case and whole words", () => {
  const d = doc();
  const n = run(d, { op: "text", find: "oros", repl: "orOS 3", cs: 0, word: 1 });
  assert.equal(n, 4, "whole words only: 'colorOSity' is not touched");
  assert.deepEqual(text(d), ["orOS 3 News", "Read orOS 3 today and more orOS 3.", "Page [pn] of orOS 3", "colorOSity is not a word"]);
  const p1 = d.stories[0].paras[1].runs;
  assert.equal(p1[0].t, "Read orOS 3", "the match spanning two runs lands in the first run");
  assert.equal(p1[1].t, " today", "the second run keeps what is left");
  assert.equal(p1[1].b, 1);
  assert.equal(d.stories[0].paras[2].runs[1].f, "pn", "a field run is kept and splits the search");
  assert.ok(d.stories[0].m >= 2000 && d.stories[0].h[0] === 1000, "the story is stamped with history");
  assert.ok(d.m >= 2000, "the document is stamped");
  assert.equal(run(d, { op: "text", find: "OROS", repl: "x", cs: 1 }), 0, "match case finds nothing");
  const d2 = doc();
  assert.equal(run(d2, { op: "text", find: "OS", repl: "", cs: 1 }), 5, "not whole words: inside words too");
  assert.equal(text(d2)[3], "colority is not a word");
  assert.ok(M.normDoc(d2), "still a valid document");
});

test("text: regex characters are literal, the same recipe twice changes nothing more", () => {
  const d = doc();
  d.stories[0].paras.push({ ps: "ps-base", runs: [{ t: "Price (EUR) 3.50 + tax?" }] });
  assert.equal(run(d, { op: "text", find: "(EUR) 3.50 +", repl: "€3,50 +" }), 1);
  assert.equal(text(d)[4], "Price €3,50 + tax?");
  assert.equal(run(d, { op: "text", find: "a.b", repl: "x" }), 0);
  const e = doc();
  run(e, { op: "text", find: "News", repl: "Newsletter", word: 1 });
  const once = JSON.stringify(e);
  assert.equal(run(e, { op: "text", find: "Newsletter", repl: "Newsletter", word: 1 }), 1, "same text counts a match");
  assert.deepEqual(text(e), JSON.parse(once).stories[0].paras.map((p) => p.runs.map((r) => r.t !== undefined ? r.t : "[" + r.f + "]").join("")));
});

test("pstyle and master: by id or name, missing ones skip the document", () => {
  const d = doc();
  assert.equal(run(d, { op: "pstyle", from: "ps-body", to: "pull QUOTE" }), 2, "by name, any case");
  assert.deepEqual(d.stories[0].paras.map((p) => p.ps), ["ps-h1", "ps-custom12ab", "ps-custom12ab", "ps-base"]);
  assert.equal(run(d, { op: "pstyle", from: "ps-body", to: "Pull quote" }), 0, "again: nothing more");
  assert.equal(run(d, { op: "pstyle", from: "Heading 1", to: "ps-base" }), 1, "seeded style by its English name");
  assert.equal(run(d, { op: "pstyle", from: "", to: "ps-base" }), 2, "any style");
  assert.equal(run(d, { op: "pstyle", from: "", to: "No such style" }), 0, "unknown style: skipped");
  assert.equal(run(d, { op: "pstyle", from: "No such", to: "ps-base" }), 0);

  const e = doc();
  assert.equal(run(e, { op: "master", ms: "b-cover", on: "odd" }), 2, "pages 1 and 3");
  assert.deepEqual(M.pagesInOrder(e).map((p) => p.ms), ["ms-bbbbbbbbbbbb", "ms-a", "ms-bbbbbbbbbbbb", "ms-a"]);
  assert.equal(run(e, { op: "master", ms: "", on: "even" }), 2, "none on even pages");
  assert.deepEqual(M.pagesInOrder(e).map((p) => p.ms), ["ms-bbbbbbbbbbbb", "", "ms-bbbbbbbbbbbb", ""]);
  assert.equal(run(e, { op: "master", ms: "Z-Missing", on: "all" }), 0);
  assert.ok(M.pagesInOrder(e).every((p) => p.m >= 1000));
});

test("margins: mm to pt, normalized, unchanged margins change nothing", () => {
  const d = doc();
  assert.equal(run(d, { op: "margins", t: 20, b: 25, i: 15, o: 10 }), 1);
  assert.ok(Math.abs(d.setup.mt - 20 * MM) < 0.01);
  assert.ok(Math.abs(d.setup.mb - 25 * MM) < 0.01);
  assert.ok(Math.abs(d.setup.mo - 10 * MM) < 0.01);
  const m = d.m;
  assert.equal(run(d, { op: "margins", t: 20, b: 25, i: 15, o: 10 }, 3000), 0);
  assert.equal(d.m, m, "no stamp without a change");
});

test("problems: counts preflight errors and warnings", () => {
  const d = doc();
  const p = S.problems(d, R, () => false);
  assert.equal(typeof p.err, "number");
  assert.equal(typeof p.warn, "number");
  // an image whose picture is missing is an error
  const pg = M.pagesInOrder(d)[0];
  d.items.push({ id: "it-img", m: 1000, t: "img", pg: pg.id, x: 10, y: 10, w: 50, h: 50, a: "a".repeat(64) + ".jpg", iw: 100, ih: 100, z: 3 });
  const q = S.problems(M.normDoc(d), R, () => true);
  assert.ok(q.err + q.warn > p.err + p.warn, "the missing picture is reported");
});

test("resolve: id first, then any language's name", () => {
  const d = doc();
  assert.equal(S.resolve(d.pstyles, "ps-h1").id, "ps-h1");
  assert.equal(S.resolve(d.pstyles, "Τίτλος 1").id, "ps-h1");
  assert.equal(S.resolve(d.masters, "  a-master ").id, "ms-a");
  assert.equal(S.resolve(d.masters, ""), null);
});

// ---------- Q5: the Layout command catalog (pages, numbering, bleed,
// fit, pictures, more of a style) ----------
const IMG = "a".repeat(64) + ".jpg", IMG2 = "b".repeat(64) + ".png";
function longDoc(paras) {
  const d = M.newDoc({ name: "Book", pages: 2, facing: 1 }, 1000);
  const pg = M.pagesInOrder(d);
  const words = "Lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod tempor incididunt ut labore. ".repeat(6);
  d.stories.push({ id: "st-l", m: 1000, paras: Array.from({ length: paras }, () => ({ ps: "ps-body", runs: [{ t: words }] })) });
  d.items.push({ id: "it-l", m: 1000, t: "text", pg: pg[0].id, x: 40, y: 40, w: 300, h: 400, story: "st-l", seq: 1024, z: 1 });
  d.items.push({ id: "it-p1", m: 1000, t: "img", pg: pg[0].id, x: 40, y: 500, w: 100, h: 80, a: IMG, fit: "fill", z: 2 });
  d.items.push({ id: "it-p2", m: 1000, t: "img", pg: pg[1].id, x: 40, y: 40, w: 100, h: 80, a: IMG2, fit: "fill", z: 2 });
  return M.normDoc(d);
}
function overset(d) { return !!R.computeLayout(M.normDoc(JSON.parse(JSON.stringify(d)))).overset["st-l"]; }

test("Q5 style: bold, italic, capitals, spaces, indent, where it starts, hyphenation; -1 and \"\" leave them", () => {
  const d = doc();
  assert.equal(run(d, { op: "style", name: "ps-body", bold: "on", caps: "on", sb: 6, fi: 12, brk: "page", hyph: "on" }), 1);
  const ps = d.pstyles.find((p) => p.id === "ps-body");
  assert.equal(ps.b, 1); assert.equal(ps.caps, 1); assert.equal(ps.sb, 6); assert.equal(ps.fi, 12);
  assert.equal(ps.ext.brk, "page"); assert.equal(ps.ext.hyph, 1);
  assert.equal(ps.i, undefined, "italic left as it was");
  assert.equal(run(d, { op: "style", name: "ps-body", bold: "on", caps: "on", sb: 6, fi: 12, brk: "page", hyph: "on" }, 3000), 0, "twice changes nothing more");
  assert.equal(run(d, { op: "style", name: "ps-body", bold: "off", brk: "any", hyph: "off" }, 3000), 1);
  assert.equal(ps.b, 0); assert.equal(ps.ext.brk, ""); assert.equal(ps.ext.hyph, 0); assert.equal(ps.sb, 6, "-1 leaves it");
  assert.equal(C.normStep({ op: "style", name: "ps-body", brk: "nowhere" }, S.CATALOG).brk, "", "an unknown value is dropped");
});

test("Q5 pages: at the end, before / after a page, text runs on into them", () => {
  const d = longDoc(12);
  const ids = M.pagesInOrder(d).map((p) => p.id);
  assert.equal(run(d, { op: "pages", n: 2, flow: false }), 2);
  assert.equal(M.pagesInOrder(d).length, 4);
  assert.deepEqual(M.pagesInOrder(d).slice(0, 2).map((p) => p.id), ids, "added at the end");
  assert.equal(run(d, { op: "pages", n: 1, at: "before", page: 1, flow: false }), 1);
  assert.notEqual(M.pagesInOrder(d)[0].id, ids[0], "a new first page");
  assert.equal(run(d, { op: "pages", n: 1, at: "after", page: 2, flow: false }), 1);
  assert.deepEqual(M.pagesInOrder(d).slice(1, 4).map((p) => ids.indexOf(p.id)), [0, -1, 1], "after the second page (the old first)");
  assert.equal(M.pagesInOrder(d).length, 6);
  // flow: the overflowing story runs on into the new pages
  const e = longDoc(12);
  assert.ok(overset(e));
  const before = e.items.filter((it) => it.story === "st-l").length;
  assert.equal(run(e, { op: "pages", n: 3 }), 3);
  assert.equal(e.items.filter((it) => it.story === "st-l").length, before + 3, "a frame on each new page");
  const L = R.computeLayout(M.normDoc(JSON.parse(JSON.stringify(e))));
  const ch = M.chain(e, "st-l");
  assert.ok((L.frames[ch[1].id].lines || []).length > 0, "the text runs on");
});

test("Q5 fit: as many pages as the text needs, none left empty; delpages with tombstones", () => {
  const d = longDoc(30);
  assert.ok(overset(d));
  const added = run(d, { op: "fit" });
  assert.ok(added > 0);
  assert.ok(!overset(d), "everything fits");
  const L = R.computeLayout(M.normDoc(JSON.parse(JSON.stringify(d))));
  const frames = M.chain(d, "st-l");
  assert.ok((L.frames[frames[frames.length - 1].id].lines || []).length > 0, "the last frame is not empty");
  assert.equal(run(d, { op: "fit" }, 3000), 0, "twice changes nothing more");
  // delpages: the pages and what is on them go, as tombstones
  const n0 = M.pagesInOrder(d).length, gone = M.pagesInOrder(d)[1];
  const onIt = d.items.filter((it) => it.pg === gone.id).map((it) => it.id);
  assert.equal(run(d, { op: "delpages", first: 2 }, 4000), 1);
  assert.equal(M.pagesInOrder(d).length, n0 - 1);
  assert.ok(d.tombs[gone.id] >= 4000);
  onIt.forEach((id) => { assert.ok(d.tombs[id] >= 4000); assert.ok(!d.items.some((it) => it.id === id)); });
  assert.deepEqual(M.pagesInOrder(d).map((p) => p.pos), M.pagesInOrder(d).map((p, i) => (i + 1) * 1024));
  assert.equal(run(d, { op: "delpages", first: 1, last: 9999 }, 5000), 0, "a document keeps one page");
  assert.equal(run(d, { op: "delpages", first: 900 }, 5000), 0, "past the end: nothing");
  assert.equal(C.normStep({ op: "delpages" }, S.CATALOG), null, "first is required");
});

test("Q5 numbering and bleed", () => {
  const d = doc();
  assert.equal(M.firstNumber(d), 1);
  assert.equal(run(d, { op: "numbering", n: 5 }), 1);
  assert.equal(M.firstNumber(d), 5);
  assert.equal(run(d, { op: "numbering", mode: "shift", n: -2 }), 1);
  assert.equal(M.firstNumber(d), 3);
  assert.equal(run(d, { op: "numbering", n: 3 }), 0);
  assert.equal(run(d, { op: "bleed", mm: 5 }), 1);
  assert.ok(Math.abs(d.setup.bleed - 5 * MM) < 0.01);
  assert.equal(run(d, { op: "bleed", mm: 5 }), 0);
});

test("Q5 pictures: pages as all / odd / even / positions, fit or fill, black and white copies", () => {
  assert.ok(S.pageTest("")(7) && S.pageTest("odd")(3) && !S.pageTest("odd")(2) && S.pageTest("even")(2));
  const r = S.pageTest(" 3-5, 9 ");
  assert.deepEqual([2, 3, 5, 6, 9].map(r), [false, true, true, false, true]);
  assert.equal(S.pageTest("first page"), null);
  const d = longDoc(1);
  assert.equal(run(d, { op: "imgfit", mode: "fit", pages: "2" }), 1);
  assert.equal(d.items.find((it) => it.id === "it-p2").fit, "fit");
  assert.equal(d.items.find((it) => it.id === "it-p1").fit, "fill");
  assert.equal(run(d, { op: "imgfit", mode: "fit", pages: "nonsense" }), 0);
  assert.deepEqual(S.greyAssets(d, { pages: "odd" }), [IMG]);
  assert.deepEqual(S.greyAssets(d, { pages: "" }).sort(), [IMG, IMG2]);
  const G = "c".repeat(64) + ".jpg";
  assert.equal(S.apply(d, { op: "grey", pages: "" }, 2000, { grey: { [IMG]: G } }), 1, "only pictures with a copy change");
  assert.equal(d.items.find((it) => it.id === "it-p1").a, G);
  assert.equal(d.items.find((it) => it.id === "it-p2").a, IMG2);
  assert.equal(S.apply(d, { op: "grey", pages: "" }, 2000), 0, "no copies, no change");
});
