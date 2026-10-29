// orOS Layout — line fitting (layout/linefit.js) and break
// opportunities inside words (designkit/text.js: soft hyphen U+00AD,
// zero-width space U+200B). A paragraph is laid out at one tracking
// to give the "PDF" line breaks, then fitted at another: every line
// must break where the PDF did, through a few character styles.
// Synthetic text only.
// Run: node --test tests/layout-linefit.test.js
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const T = require(path.join(ROOT, "designkit/text.js"));
const M = require(path.join(ROOT, "designkit/model.js"));
const R = require(path.join(ROOT, "designkit/render.js"));
const F = require(path.join(ROOT, "layout/linefit.js"));
T.allKeys().forEach((k) => {
  const b = fs.readFileSync(path.join(ROOT, "vendor/noto", T.fontFile(k)));
  T.register(k, b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
});

const STY = { ps: [{ id: "p", m: 1, name: "P", font: "serif", size: 10, align: "j" }], cs: [] };
function lines(t, w) {
  return T.layoutChain({ paras: [{ ps: "p", runs: [{ t }] }] }, [{ id: "a", w, h: 500 }], STY).frames.a.lines;
}
const text = (ls) => ls.map((l) => l.runs.map((r) => r.t).join("|"));

test("a soft hyphen breaks a word with a hyphen; unbroken it is nothing", () => {
  const t = "είναι πολυ\u00ADτελέ\u00ADστατο και ανα\u200Bγνώσιμο εδώ.";
  const w1 = T.measure("serif-r", "είναι πολυ-", 10, 0) + 0.5;
  const a = lines(t, w1);
  assert.equal(text(a)[0], "είναι|πολυ|-");
  // the hyphen sits after the fragment, at the soft hyphen's offset, and the line is justified to the edge
  const hy = a[0].runs[2];
  assert.equal(hy.o, t.indexOf("\u00AD"));
  assert.ok(Math.abs(hy.x + hy.w - w1) < 1e-6);
  // wide enough: the word is whole, its parts touch, no hyphen
  const b = lines(t, 400);
  assert.deepEqual(text(b), ["είναι|πολυ|τελέ|στατο|και|ανα|γνώσιμο|εδώ."]);
  const r = b[0].runs;
  assert.ok(Math.abs(r[1].x + r[1].w - r[2].x) < 1e-9 && Math.abs(r[2].x + r[2].w - r[3].x) < 1e-9);
  // a zero-width space breaks with no hyphen
  const z = lines("και ανα\u200Bγνώ", T.measure("serif-r", "και ανα", 10, 0) + 1);
  assert.deepEqual(text(z), ["και|ανα", "γνώ"]);
});

test("the hyphen must fit: else the line ends one break earlier", () => {
  // room for "ab cd" but not "ab cd-": the line breaks at the space
  const w = T.measure("serif-r", "ab cd", 10, 0) + 0.2;
  assert.equal(text(lines("ab cd\u00ADef", w))[0], "ab");
  // documents without these characters lay out as before
  assert.deepEqual(text(lines("one two three", 400)), ["one|two|three"]);
});

// paragraphs of plain words in one frame
function mk(track, extra) {
  const words = "the sea was quiet that night and the gulls slept on the old pier while the town lights went out one by one along the shore".split(" ");
  const d = M.newDoc({ name: "F", pages: 1 }, 1);
  d.pstyles.push({ id: "ps-b", m: 1, name: "B", base: "ps-base", font: "serif", size: 10, lead: 14, align: "j", track });
  const paras = [];
  for (let p = 0; p < 6; p++) {
    const a = [];
    for (let i = 0; i < 70; i++) a.push(words[(i * 7 + p * 5) % words.length]);
    paras.push({ ps: "ps-b", runs: [{ t: a.join(" ") + "." }] });
  }
  if (extra) extra(paras);
  d.stories.push({ id: "st-a", m: 1, paras });
  d.items.push({ id: "it-a", m: 1, t: "text", pg: M.pagesInOrder(d)[0].id, x: 40, y: 40, w: 300, h: 700, story: "st-a", seq: 1, z: 1 });
  return M.normDoc(d);
}
function targetsOf(d) {
  const L = R.computeLayout(d);
  return d.stories[0].paras.map((p, i) => ({ sid: "st-a", p: i, br: F.breaks(L, d, "st-a", i) }));
}

test("fit: every line breaks where the target did, with few styles", () => {
  const want = targetsOf(mk(25)), d = mk(0);
  const before = targetsOf(d);
  assert.ok(before.some((t, i) => JSON.stringify(t.br) !== JSON.stringify(want[i].br)), "the two trackings break differently");
  const st = F.fit(d, want, { name: "Line fit", now: 2 });
  assert.equal(st.inPlace, st.lines);
  assert.ok(st.fitted > 0 && st.styles > 0 && st.styles <= 4, JSON.stringify(st));
  assert.deepEqual(targetsOf(d), want);
  const fit = d.cstyles.filter((c) => c.ext && c.ext.fit);
  fit.forEach((c) => { assert.match(c.name, /^Line fit [+−]?\d/); assert.ok(Math.abs(c.track) <= 60); });
  // the text is unchanged, and the document is one Layout keeps as it is
  assert.deepEqual(d.stories[0].paras.map((p) => p.runs.map((r) => r.t).join("")), mk(0).stories[0].paras.map((p) => p.runs.map((r) => r.t).join("")));
  assert.deepEqual(M.normDoc(JSON.parse(JSON.stringify(d))), d);
  // fitting again changes nothing
  const again = JSON.stringify(d);
  F.fit(d, want, { name: "Line fit", now: 3 });
  assert.equal(JSON.stringify(d), again);
});

test("fit: a run with its own character style keeps it under the fit style", () => {
  const strong = (paras) => { const t = paras[2].runs[0].t; paras[2].runs = [{ t: t.slice(0, 40) }, { t: t.slice(40, 120), cs: "cs-strong" }, { t: t.slice(120) }]; };
  const want = targetsOf(mk(25, strong)), d = mk(0, strong);
  const st = F.fit(d, want, { name: "Line fit", now: 2 });
  assert.equal(st.inPlace, st.lines);
  const csMap = T.byId(d.cstyles);
  d.stories[0].paras[2].runs.forEach((r) => {
    const a = T.resolveCs(csMap, r.cs || "x");
    if (r.cs && csMap[r.cs].ext && csMap[r.cs].base === "cs-strong") assert.equal(a.b, 1);
  });
  assert.ok(d.stories[0].paras[2].runs.some((r) => r.cs === "cs-strong" || (csMap[r.cs] && csMap[r.cs].base === "cs-strong")));
});

// The same text in two frames (the second with two columns) on two
// pages, as another program's file (no soft hyphens) and as its print
// PDF (set at another tracking, hyphenated): the file takes the PDF's
// line breaks.
const RB = require(path.join(ROOT, "layout/rebuild.js"));
function twoPages(track, soft, lead) {
  lead = lead || 0;
  const words = "ο γλάρος πετούσε πάνω από την ακροθαλασσιά ενώ η πόλη κοιμόταν ήσυχα και τα φώτα έσβηναν ένα ένα στην παραλία".split(" ");
  const d = M.newDoc({ name: "S", pages: 2 + lead }, 1), pg = M.pagesInOrder(d).slice(lead);
  d.pstyles.push({ id: "ps-b", m: 1, name: "B", base: "ps-base", font: "serif", size: 10, lead: 14, align: "j", track });
  const paras = [];
  for (let p = 0; p < 8; p++) {
    const a = [];
    for (let i = 0; i < 60; i++) a.push(words[(i * 5 + p * 3) % words.length]);
    let t = a.join(" ") + ".";
    // (the PDF's program hyphenated: a break after the 3rd letter of long words)
    if (soft) t = t.replace(/(\p{L}{3})(\p{L}{3,})/gu, "$1\u00AD$2");
    paras.push({ ps: "ps-b", runs: [{ t }] });
  }
  d.stories.push({ id: "st-s", m: 1, paras });
  d.items.push({ id: "it-1", m: 1, t: "text", pg: pg[0].id, x: 50, y: 50, w: 260, h: 700, story: "st-s", seq: 1, z: 1 });
  d.items.push({ id: "it-2", m: 1, t: "text", pg: pg[1].id, x: 50, y: 50, w: 480, h: 700, cols: 2, gut: 14, story: "st-s", seq: 2, z: 1 });
  return M.normDoc(d);
}
function pdfOf(doc) {
  const L = R.computeLayout(doc);
  return M.pagesInOrder(doc).map((p) => ({ spans: [].concat(...doc.items.filter((it) => it.pg === p.id && it.t === "text").map((it) =>
    (L.frames[it.id] || { lines: [] }).lines.flatMap((ln) => ln.runs.filter((r) => r.t.trim()).map((r) =>
      ({ t: r.t, x: it.x + r.x, x1: it.x + r.x + r.w, y: it.y + ln.y, size: r.size, fam: "serif", b: 0, i: 0, font: "X", color: null, rot: 0 }))))) }));
}

test("matchPdf: another program's file takes its print PDF's line breaks, hyphens and columns included", () => {
  const pdf = pdfOf(twoPages(30, true));
  assert.ok(pdf[0].spans.some((s) => s.t === "-"), "the PDF has hyphenated lines");
  const d = twoPages(0, false), before = d.stories[0].paras.map((p) => p.runs.map((r) => r.t).join(""));
  const rep = RB.matchPdf(d, pdf, { fitName: "Line fit", lang: "en", now: 2 });
  assert.equal(rep.matched, rep.lines);
  assert.ok(rep.checked > 60);
  assert.equal(rep.inPlace, rep.checked, JSON.stringify(rep));
  // soft hyphens only where the PDF broke a word; the text reads the same
  const after = d.stories[0].paras.map((p) => p.runs.map((r) => r.t).join(""));
  assert.deepEqual(after.map((t) => t.replace(/\u00AD/g, "")), before);
  assert.ok(after.join("").includes("\u00AD"));
  // and it lays out like the PDF, line by line
  const again = pdfOf(d);
  const lineTexts = (pp) => pp.map((p) => RB.toLines(p.spans).map((l) => l.text));
  assert.deepEqual(lineTexts(again).map((x) => x.length), lineTexts(pdf).map((x) => x.length));
});

test("matchPdf: a PDF whose text comes out without accents still lines up", () => {
  // (Greek fonts with the tonos as a glyph of its own: "καλά" reads "καλα")
  const bare = (t) => t.normalize("NFD").replace(/[̀-ͯ]/g, "");
  const pdf = pdfOf(twoPages(30, true)).map((p) => ({ spans: p.spans.map((s) => Object.assign({}, s, { t: bare(s.t) })) }));
  assert.ok(pdf[0].spans.every((s) => s.t === bare(s.t)) && pdf[0].spans.some((s) => /[α-ω]/.test(s.t)));
  const d = twoPages(0, false), before = d.stories[0].paras.map((p) => p.runs.map((r) => r.t).join(""));
  const rep = RB.matchPdf(d, pdf, { fitName: "Line fit", lang: "en", now: 2 });
  assert.equal(rep.matched, rep.lines);
  assert.equal(rep.inPlace, rep.checked, JSON.stringify(rep));
  // the story keeps its accents
  const after = d.stories[0].paras.map((p) => p.runs.map((r) => r.t).join(""));
  assert.deepEqual(after.map((t) => t.replace(/­/g, "")), before);
});

test("matchPdf: a print PDF without the file's first pages (covers) still lines up", () => {
  const pdf = pdfOf(twoPages(30, false));
  const d = twoPages(0, false, 3);
  assert.equal(M.pagesInOrder(d).length, pdf.length + 3);
  const rep = RB.matchPdf(d, pdf, { fitName: "Line fit", lang: "en", now: 2 });
  assert.equal(rep.shift, 3);
  assert.equal(rep.matched, rep.lines);
  assert.equal(rep.inPlace, rep.checked, JSON.stringify(rep));
  // pages that line up need no shift
  assert.equal(RB.pageShift(twoPages(0, false), M.pagesInOrder(twoPages(0, false)), pdf), 0);
});

test("matchPdf: a PDF of other text changes nothing", () => {
  const d = twoPages(0, false), json = JSON.stringify(d);
  const other = [{ spans: [{ t: "Something else entirely", x: 60, x1: 200, y: 80, size: 10, fam: "serif", b: 0, i: 0, font: "X", color: null, rot: 0 }] }];
  const rep = RB.matchPdf(d, other, { fitName: "Line fit", now: 2 });
  assert.equal(rep.matched, 0);
  assert.equal(JSON.stringify(d), json);
});
