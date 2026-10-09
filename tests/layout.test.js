// Layout (desktop publishing) + the shared designkit core: font
// metrics and typesetting (designkit/text.js), the LAYOUT v1 model and
// its merge (designkit/model.js: canonical, idempotent, symmetric,
// tombstones, concurrent story edits kept as Recovered text), the
// frame layout (render.js), a vector PDF smoke test (pdf.js + jsPDF)
// and the app's EN/EL string coverage.
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
const P = require(path.join(ROOT, "designkit/pdf.js"));

T.allKeys().forEach((k) => {
  const b = fs.readFileSync(path.join(ROOT, "vendor/noto", T.fontFile(k)));
  T.register(k, b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
});

const J = (x) => JSON.stringify(x);
const STYLES = { ps: [{ id: "body", m: 1, name: "Body", size: 10 }], cs: [] };
function words(n) { return "Το κείμενο ρέει από στήλη σε στήλη, lorem ipsum dolor. ".repeat(n); }

function sampleDoc(now) {
  const d = M.newDoc({ name: "Test", w: M.preset("a5").w, h: M.preset("a5").h, pages: 3, facing: 1 }, now || 1000);
  const pg = M.pagesInOrder(d);
  d.stories.push({ id: "st-main", m: 1000, paras: [{ ps: "ps-h1", runs: [{ t: "Καλημέρα κόσμε" }] }, { ps: "ps-body", runs: [{ t: words(60) }] }] });
  d.items.push({ id: "it-t1", m: 1000, t: "text", pg: pg[0].id, x: 30, y: 40, w: 200, h: 300, story: "st-main", seq: 1, cols: 2, gut: 10, z: 1 });
  d.items.push({ id: "it-t2", m: 1000, t: "text", pg: pg[1].id, x: 30, y: 40, w: 200, h: 300, story: "st-main", seq: 2, rot: 5, z: 1 });
  d.items.push({ id: "it-r1", m: 1000, t: "rect", pg: pg[0].id, x: 100, y: 150, w: 80, h: 60, fill: "sw-yellow", wrap: "box", wo: 6, z: 2 });
  d.stories.push({ id: "st-pn", m: 1000, paras: [{ ps: "ps-cap", runs: [{ t: "Σελίδα " }, { f: "pn" }, { t: " / " }, { f: "pc" }] }] });
  d.items.push({ id: "it-mf", m: 1000, t: "text", pg: "ms-a", side: "R", x: 300, y: 560, w: 100, h: 20, story: "st-pn", seq: 1, z: 1 });
  return M.normDoc(d);
}

// ---------- text.js ----------
test("fonts: Latin and Greek glyphs measure from the TTF, bold is wider", () => {
  const a = T.measure("serif-r", "Καλημέρα", 10), b = T.measure("serif-b", "Καλημέρα", 10);
  assert.ok(a > 20 && a < 80, "plausible width " + a);
  assert.ok(b > a);
  assert.equal(T.measure("serif-r", "ab", 20), 2 * T.measure("serif-r", "ab", 10));
  assert.ok(T.ascent("sans-r", 10) > 0 && T.descent("sans-r", 10) > 0);
});

test("typesetting: a story flows frame to frame and reports overset", () => {
  const story = { paras: [{ ps: "body", runs: [{ t: words(30) }] }] };
  const r1 = T.layoutChain(story, [{ id: "a", w: 150, h: 60 }, { id: "b", w: 150, h: 60 }], STYLES);
  assert.ok(r1.frames.a.lines.length > 2 && r1.frames.b.lines.length > 2);
  assert.equal(r1.overset, true);
  const r2 = T.layoutChain(story, [{ id: "a", w: 150, h: 2000 }], STYLES);
  assert.equal(r2.overset, false);
  // every line fits its column
  r2.frames.a.lines.forEach((ln) => ln.runs.forEach((run) => assert.ok(run.x + run.w <= 150 + 0.01)));
  // nothing lost: the placed text is the story text (spaces aside)
  const placed = r2.frames.a.lines.map((ln) => ln.runs.map((r) => r.t).join("")).join("").replace(/\s+/g, "");
  assert.equal(placed, words(30).replace(/\s+/g, ""));
});

test("typesetting: columns, wrap exclusions and page fields", () => {
  const story = { paras: [{ ps: "body", runs: [{ t: words(20) }] }] };
  const two = T.layoutChain(story, [{ id: "a", w: 300, h: 80, cols: 2, gut: 12 }], STYLES);
  const cols = new Set(two.frames.a.lines.map((l) => l.col));
  assert.deepEqual([...cols].sort(), [0, 1]);
  const ex = T.layoutChain(story, [{ id: "a", w: 300, h: 400, excl: [{ x: 0, y: 0, w: 150, h: 60, shape: "box" }] }], STYLES);
  const top = ex.frames.a.lines.filter((l) => l.y < 50);
  assert.ok(top.length > 0);
  top.forEach((l) => l.runs.forEach((r) => assert.ok(r.x >= 150 - 0.01, "text clears the exclusion")));
  const pn = T.layoutChain({ paras: [{ ps: "body", runs: [{ t: "p. " }, { f: "pn" }, { t: "/" }, { f: "pc" }] }] },
    [{ id: "a", w: 200, h: 40, ctx: { pageLabel: 7, pageCount: 12 } }], STYLES);
  assert.equal(pn.frames.a.lines[0].runs.map((r) => r.t).join(""), "p.7/12", "spaces are gaps between runs");
});

// ---------- model.js ----------
test("model: normalization is canonical and idempotent", () => {
  const d = sampleDoc();
  assert.equal(J(M.normDoc(d)), J(d));
  const data = M.normData({ ver: 1, docs: [d], dt: {} });
  assert.equal(J(M.normData(JSON.parse(J(data)))), J(data));
  // hostile input is dropped, not trusted
  const bad = M.normDoc(Object.assign({}, d, { items: d.items.concat([{ id: "it-x", t: "script", x: 1 }, { id: "<img>", t: "rect" }]) }));
  assert.equal(bad.items.length, d.items.length);
  const img = M.normItem({ id: "it-i", m: 1, t: "img", pg: "pg-a", a: "../../etc/passwd", x: 0, y: 0, w: 10, h: 10 });
  assert.ok(img === null || img.a === "", "an image id is a hash, never a path");
});

test("merge: symmetric, idempotent, per-entity last-writer-wins", () => {
  const base = sampleDoc();
  const a = JSON.parse(J(base)), b = JSON.parse(J(base));
  const ia = M.find(a.items, "it-r1"); ia.x = 10; ia.m = 2000;
  const ib = M.find(b.items, "it-t1"); ib.w = 180; ib.m = 2100;
  const da = { ver: 1, docs: [M.normDoc(a)], dt: {} }, db = { ver: 1, docs: [M.normDoc(b)], dt: {} };
  const ab = M.mergeData(da, db), ba = M.mergeData(db, da);
  assert.equal(J(ab), J(ba));
  assert.equal(J(M.mergeData(ab, ab)), J(ab));
  assert.equal(J(M.mergeData(ab, da)), J(ab));
  const doc = ab.docs[0];
  assert.equal(M.find(doc.items, "it-r1").x, 10);
  assert.equal(M.find(doc.items, "it-t1").w, 180);
});

test("merge: a deletion beats an older edit, a newer edit survives it", () => {
  const base = sampleDoc();
  const del = JSON.parse(J(base));
  del.items = del.items.filter((i) => i.id !== "it-r1"); del.tombs["it-r1"] = 3000;
  const older = JSON.parse(J(base)); M.find(older.items, "it-r1").x = 5; M.find(older.items, "it-r1").m = 2000;
  const m1 = M.mergeDoc(M.normDoc(del), M.normDoc(older));
  assert.equal(M.find(m1.items, "it-r1"), null);
  const newer = JSON.parse(J(base)); M.find(newer.items, "it-r1").x = 6; M.find(newer.items, "it-r1").m = 4000;
  const m2 = M.mergeDoc(M.normDoc(del), M.normDoc(newer));
  assert.equal(M.find(m2.items, "it-r1").x, 6);
  // a whole document deleted on one device stays deleted
  const gone = M.mergeData({ ver: 1, docs: [], dt: { [base.id]: 5000 } }, { ver: 1, docs: [base], dt: {} });
  assert.equal(gone.docs.length, 0);
});

test("merge: concurrent story edits keep the losing text in Recovered text", () => {
  const base = sampleDoc();
  function edit(doc, text, m) {
    const d = JSON.parse(J(doc)), st = M.find(d.stories, "st-main");
    st.h = [st.m].concat(st.h); st.m = m; st.paras = [{ ps: "ps-body", runs: [{ t: text }] }];
    return M.normDoc(d);
  }
  const a = edit(base, "Version A", 2000), b = edit(base, "Version B", 2001);
  const ab = M.mergeDoc(a, b), ba = M.mergeDoc(b, a);
  assert.equal(J(ab), J(ba));
  assert.equal(T.plainText(M.find(ab.stories, "st-main")), "Version B");
  assert.equal(ab.rec.length, 1);
  assert.equal(ab.rec[0].t, "Version A");
  assert.equal(J(M.mergeDoc(ab, a)), J(ab), "re-merging the loser adds nothing");
  // a sequential edit (B made on top of A) is not a conflict
  const seq = edit(a, "A then B", 2500);
  const m = M.mergeDoc(a, seq);
  assert.equal(m.rec.length, 0);
  assert.equal(T.plainText(M.find(m.stories, "st-main")), "A then B");
});

// ---------- render.js ----------
test("layout: threaded frames, wrap and master page numbers", () => {
  const d = sampleDoc();
  const L = R.computeLayout(d);
  assert.ok(L.frames["it-t1"].lines.length > 10 && L.frames["it-t2"].lines.length > 5);
  const pg = M.pagesInOrder(d);
  // page 1 is a right page in a facing document: the R master frame shows "1 / 3"
  const mf = L.master[pg[0].id]["it-mf"];
  assert.equal(mf.lines[0].runs.map((r) => r.t).join(""), "Σελίδα1/3");
  assert.equal(L.master[pg[1].id]["it-mf"], undefined, "page 2 is a left page");
});

// ---------- pdf.js ----------
test("pdf: a vector PDF with embedded fonts, bleed boxes and spreads", () => {
  global.window = global.window || global;
  const { jsPDF } = require(path.join(ROOT, "vendor/jspdf.umd.min.js"));
  const d = sampleDoc();
  const pdf = P.build(d, { bleed: true, marks: true }, { jsPDF });
  const out = Buffer.from(pdf.output("arraybuffer")).toString("latin1");
  assert.ok(out.startsWith("%PDF-"));
  assert.equal((out.match(/\/Type \/Page\b/g) || []).length, 3);
  assert.ok(/\/TrimBox/.test(out) && /\/BleedBox/.test(out));
  assert.ok(/FontFile2/.test(out), "fonts embedded");
  const sp = P.build(d, { spreads: true }, { jsPDF });
  assert.equal(sp.getNumberOfPages(), 2, "1 | 2-3");
  assert.ok(Math.abs(sp.internal.pageSize.getWidth() - 2 * d.setup.w) < 0.5);
  assert.ok(P.fontsUsed(d, R.computeLayout(d), M.pagesInOrder(d)).includes("serif-r"), "only the fonts in use are embedded");
});

// ---------- strings ----------
test("i18n: every key the app uses exists in English and Greek", () => {
  const src = fs.readFileSync(path.join(ROOT, "layout/layout.js"), "utf8");
  const i = src.indexOf("  var STRINGS = {"), j = src.indexOf("\n  };\n", i);
  const STRINGS = new Function("return " + src.slice(i + "  var STRINGS = ".length, j + 4).replace(/;\s*$/, ""))();
  const en = Object.keys(STRINGS.en).sort(), el = Object.keys(STRINGS.el).sort();
  assert.deepEqual(el, en, "same keys in both languages");
  const used = new Set();
  ["layout.js", "editor.js", "panels.js", "story.js", "io.js"].forEach((f) => {
    const s = fs.readFileSync(path.join(ROOT, "layout", f), "utf8");
    for (const m of s.matchAll(/\bt\("([a-zA-Z0-9.]+)"/g)) used.add(m[1]);
    for (const m of s.matchAll(/data-i18n="([a-zA-Z0-9.]+)"/g)) used.add(m[1]);
  });
  const html = fs.readFileSync(path.join(ROOT, "layout/index.html"), "utf8");
  for (const m of html.matchAll(/data-i18n="([a-zA-Z0-9.]+)"/g)) used.add(m[1]);
  // keys built at run time ("tool." + id, ...)
  ["select", "text", "image", "rect", "ell", "line", "hand"].forEach((k) => used.add("tool." + k));
  ["props", "pages", "styles", "colors"].forEach((k) => used.add("tab." + k));
  ["front", "fwd", "bwd", "back", "al", "ac", "ar", "at", "am", "ab", "dh", "dv"].forEach((k) => used.add("props." + k));
  Object.keys(M.PT_PER).forEach((k) => used.add("unit." + k));
  ["b", "i", "u", "caps", "bul"].forEach((k) => used.add("sty." + k));
  M.PRESETS.forEach((p) => used.add("preset." + p[0]));
  const missing = [...used].filter((k) => !k.endsWith(".") && !(k in STRINGS.en));
  assert.deepEqual(missing, []);
});
