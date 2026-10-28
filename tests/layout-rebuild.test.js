// orOS Layout — Rebuild a print PDF, pure part (layout/rebuild.js):
// the text and pictures of a printed book → a Layout document that
// sets every line where it was. The PDF.js / pdf-lib part runs in the
// browser. Fixtures are synthetic: a small book is laid out by Layout
// itself and given back as the pieces a PDF would hold.
// Run: node --test tests/layout-rebuild.test.js
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const T = require(path.join(ROOT, "designkit/text.js"));
const M = require(path.join(ROOT, "designkit/model.js"));
const R = require(path.join(ROOT, "designkit/render.js"));
const RB = require(path.join(ROOT, "layout/rebuild.js"));

T.allKeys().forEach((k) => {
  const b = fs.readFileSync(path.join(ROOT, "vendor/noto", T.fontFile(k)));
  T.register(k, b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
});

const span = (t, x, y, size, o) => Object.assign({ t, x, y, x1: x + T.measure("serif-r", t, size, 0), size, fam: "serif", b: 0, i: 0, font: "NotoSerif", color: null, rot: 0 }, o || {});

test("rebuild: pieces on one baseline join into a line; a gap is a word space", () => {
  const ls = RB.toLines([span("Hello", 50, 100, 10), span("world", 50 + T.measure("serif-r", "Hello", 10, 0) + 2.6, 100, 10), span("Next", 50, 114, 10)]);
  assert.equal(ls.length, 2);
  assert.equal(ls[0].text, "Hello world");
  // pieces that touch stay one word
  assert.equal(RB.toLines([span("Hel", 50, 100, 10), span("lo", 50 + T.measure("serif-r", "Hel", 10, 0), 100, 10)])[0].text, "Hello");
});

test("rebuild: a title beside a date on its baseline is two lines; spaced letters become tracking", () => {
  const ls = RB.toLines([span("TITLE", 50, 100, 34), span("2026", 200, 100, 16)]);
  assert.equal(ls.length, 2);
  const sp = RB.toLines([Object.assign(span("N a m e", 50, 200, 20), { x1: 150 })])[0];
  assert.equal(sp.text, "Name");
  assert.ok(sp.track > 100, "spread letters get a positive tracking: " + sp.track);
});

// A small book laid out by Layout, read back as a PDF would give it.
function book() {
  const doc = M.newDoc({ name: "Book", w: 420, h: 595, unit: "mm", bleed: 8.5, facing: 1, pages: 4, mt: 50, mb: 60, mi: 57, mo: 40, preset: "custom" }, 1);
  const pages = M.pagesInOrder(doc);
  doc.pages.forEach((p) => { p.ms = ""; });
  doc.pstyles.push({ id: "ps-tbody", m: 1, name: "Body", base: "ps-base", font: "serif", size: 10, lead: 15, align: "j", fi: 12 });
  doc.pstyles.push({ id: "ps-tfirst", m: 1, name: "First", base: "ps-tbody", fi: 0 });
  doc.pstyles.push({ id: "ps-thead", m: 1, name: "Head", base: "ps-base", font: "serif", size: 16, lead: 20, align: "c", b: 1 });
  doc.pstyles.push({ id: "ps-tnum", m: 1, name: "Num", base: "ps-base", font: "serif", size: 7, lead: 8, align: "c", i: 1 });
  const words = "the sea was quiet that night and the gulls slept on the old pier while the town lights went out one by one along the shore".split(" ");
  const text = (n, k) => { const a = []; for (let i = 0; i < n; i++) a.push(words[(i * 7 + k * 3) % words.length]); const s = a.join(" "); return s[0].toUpperCase() + s.slice(1) + "."; };
  pages.forEach((p, i) => {
    const L = i % 2 === 0 ? 57 : 40, Wd = 420 - 57 - 40;
    const paras = [];
    if (i === 0) paras.push({ ps: "ps-thead", runs: [{ t: "Chapter One" }] });
    paras.push({ ps: "ps-tfirst", runs: [{ t: text(60, i) }] });
    paras.push({ ps: "ps-tbody", runs: [{ t: text(45, i + 1) }] });
    paras.push({ ps: "ps-tbody", runs: [] });
    paras.push({ ps: "ps-tbody", runs: [{ t: text(50, i + 2) }] });
    doc.stories.push({ id: "st-p" + i, m: 1, paras });
    doc.items.push({ id: "it-p" + i, m: 1, t: "text", pg: p.id, x: L, y: 50, w: Wd, h: 470, story: "st-p" + i, seq: 1, z: 10 });
    doc.stories.push({ id: "st-n" + i, m: 1, paras: [{ ps: "ps-tnum", runs: [{ t: String(i + 5) }] }] });
    doc.items.push({ id: "it-n" + i, m: 1, t: "text", pg: p.id, x: 180, y: 560, w: 60, h: 12, story: "st-n" + i, seq: 1, z: 11 });
  });
  // a picture on page 2 with the text wrapping beside it
  doc.items.push({ id: "it-img", m: 1, t: "img", pg: pages[1].id, x: 40, y: 200, w: 120, h: 90, a: "a".repeat(64) + ".jpg", iw: 1200, ih: 900, fit: "fill", wrap: "box", wo: 10, z: 20 });
  return M.normDoc(doc);
}
// Layout's own lines → the pieces of a PDF (a word each), in page order
function asPdf(doc) {
  const L = R.computeLayout(doc), order = M.pagesInOrder(doc);
  return {
    w: doc.setup.w, h: doc.setup.h, bleed: doc.setup.bleed,
    pages: order.map((p) => {
      const spans = [];
      doc.items.filter((it) => it.pg === p.id && it.t === "text").forEach((it) => {
        (L.frames[it.id] || { lines: [] }).lines.forEach((ln) => ln.runs.forEach((r) => {
          if (!r.t.trim()) return;
          spans.push({ t: r.t, x: it.x + r.x, x1: it.x + r.x + r.w, y: it.y + ln.y, size: r.size, fam: "serif", b: /b/.test(r.key.split("-")[1]) ? 1 : 0, i: /i/.test(r.key.split("-")[1]) ? 1 : 0, font: "NotoSerif", color: null, rot: 0 });
        }));
      });
      const imgs = doc.items.filter((it) => it.pg === p.id && it.t === "img").map((it) => ({ x: it.x, y: it.y, w: it.w, h: it.h, rot: 0, vis: null, a: it.a, iw: it.iw, ih: it.ih, nm: "photo.jpg", original: true }));
      return { spans, imgs, bg: null };
    })
  };
}

test("rebuild: a book comes back with its measures, styles, page numbers and every line in place", () => {
  const src = asPdf(book());
  const res = RB.build(src, { now: 5, name: "Book", lang: "en" });
  const d = res.doc, rep = res.report;
  // the page, the bleed, facing pages and their text column
  assert.equal(d.setup.w, 420);
  assert.equal(d.setup.bleed, 8.5);
  assert.equal(d.setup.facing, 1);
  assert.equal(rep.body, 10);
  assert.equal(rep.pitch, 15);
  assert.equal(Math.round(d.setup.mi), 57);
  // page numbers 5, 6, 7, 8: their own frames, one style
  assert.equal(rep.numberStart, 5);
  const pn = d.pstyles.find((s) => s.id === "ps-rbpn");
  assert.ok(pn && pn.size === 7 && pn.i === 1);
  assert.equal(d.stories.filter((st) => st.paras[0].ps === "ps-rbpn").length, 4);
  // ... as page-number fields from the PDF's first number (LY-PN)
  assert.ok(d.stories.filter((st) => st.paras[0].ps === "ps-rbpn").every((st) => st.paras[0].runs.length === 1 && st.paras[0].runs[0].f === "pn"));
  assert.equal(d.setup.ext.pnStart, 5);
  assert.equal(M.firstNumber(d), 5);
  // the body style is the commonest one and named so; the first-line indent is a style of its own
  const body = d.pstyles.find((s) => s.name === "Body text");
  assert.ok(body);
  assert.equal(body.size, 10);
  assert.equal(body.lead, 15);
  assert.equal(body.align, "j");
  assert.ok(d.pstyles.some((s) => s.fi === 12 && s.align === "j"));
  assert.ok(d.pstyles.some((s) => s.size === 16 && s.align === "c" && s.b === 1));
  // the empty line between paragraphs is an empty paragraph again
  assert.ok(d.stories.some((st) => st.paras.some((p) => !p.runs.length || p.runs.every((r) => !r.t))));
  // the picture keeps its place and the text wraps around it
  const img = d.items.find((it) => it.t === "img");
  assert.equal(img.x, 40);
  assert.equal(img.wrap, "box");
  assert.equal(rep.pictures, 1);
  assert.equal(rep.originals, 1);
  // laid out again, every line lands where it was
  assert.ok(rep.check.lines > 40, "lines: " + rep.check.lines);
  assert.equal(rep.check.moved, 0, JSON.stringify(rep.framesOff));
  assert.equal(rep.check.extra, 0);
  // the document is one Layout normalizes to itself
  assert.deepEqual(M.normDoc(JSON.parse(JSON.stringify(d))), d);
});

test("rebuild: Greek style names; a hyphen at a line end joins a word the text knows", () => {
  const H = 595;
  const s = (t, x, y) => span(t, x, y, 10);
  const src = { w: 420, h: H, bleed: 0, pages: [{ imgs: [], spans: [
    s("Ήταν μια ήσυχη", 57, 100), s("θάλασ-", 57 + T.measure("serif-r", "Ήταν μια ήσυχη ", 10, 0), 100), s("σα και η πόλη κοιμόταν.", 57, 115),
    s("Η θάλασσα έμεινε ήσυχη.", 57, 130), s("Ένα μοντέλο-", 57, 160), s("ηθοποιός μίλησε.", 57, 175)
  ] }] };
  const res = RB.build(src, { now: 5, lang: "el" });
  const all = res.doc.stories.map((st) => st.paras.map((p) => p.runs.map((r) => r.t).join("")).join("¶")).join("|");
  // the word is whole, with a soft hyphen where the line broke
  assert.ok(/θάλασ\u00ADσα και/.test(all), all);
  // a word the text does not know keeps its hyphen and may break after it
  assert.ok(/μοντέλο-\u200Bηθοποιός/.test(all), all);
  assert.ok(res.doc.pstyles.some((p) => p.name === "Σώμα κειμένου"));
});

test("rebuild: rotated text (a spine) is its own turned frame", () => {
  const src = { w: 856, h: 595, bleed: 14, pages: [{ imgs: [], bg: { a: "b".repeat(64) + ".jpg", iw: 3000, ih: 2000 }, spans: [
    Object.assign(span("SPINE TITLE", 430, 400, 10), { rot: -90, w: T.measure("serif-r", "SPINE TITLE", 10, 0) })
  ] }] };
  const d = RB.build(src, { now: 5 }).doc;
  const fr = d.items.find((it) => it.t === "text");
  assert.equal(fr.rot, -90);
  // the page's drawings: one locked picture over the whole bleed, behind everything
  const bg = d.items.find((it) => it.t === "img");
  assert.deepEqual([bg.x, bg.y, bg.w, bg.h, bg.lock], [-14, -14, 884, 623, 1]);
  assert.equal(d.setup.facing, 0);
});

// An article whose text goes on over three pages (one story through
// three frames), then a new chapter under its heading on page 4.
function article() {
  const doc = M.newDoc({ name: "Article", w: 420, h: 595, unit: "mm", bleed: 0, facing: 1, pages: 4, mt: 50, mb: 60, mi: 57, mo: 40, preset: "custom" }, 1);
  const pages = M.pagesInOrder(doc);
  doc.pages.forEach((p) => { p.ms = ""; });
  doc.pstyles.push({ id: "ps-tbody", m: 1, name: "Body", base: "ps-base", font: "serif", size: 10, lead: 15, align: "j", fi: 12 });
  doc.pstyles.push({ id: "ps-tfirst", m: 1, name: "First", base: "ps-tbody", fi: 0 });
  doc.pstyles.push({ id: "ps-thead", m: 1, name: "Head", base: "ps-base", font: "serif", size: 16, lead: 20, align: "c", b: 1 });
  const words = "the sea was quiet that night and the gulls slept on the old pier while the town lights went out one by one along the shore".split(" ");
  const text = (n, k) => { const a = []; for (let i = 0; i < n; i++) a.push(words[(i * 7 + k * 3) % words.length]); const s = a.join(" "); return s[0].toUpperCase() + s.slice(1) + "."; };
  const paras = [{ ps: "ps-tfirst", runs: [{ t: text(70, 0) }] }];
  for (let k = 1; k < 12; k++) paras.push({ ps: "ps-tbody", runs: [{ t: text(80 + k * 9, k) }] });
  doc.stories.push({ id: "st-a", m: 1, paras });
  pages.slice(0, 3).forEach((p, i) => {
    doc.items.push({ id: "it-a" + i, m: 1, t: "text", pg: p.id, x: i % 2 === 0 ? 57 : 40, y: 50, w: 323, h: 470, story: "st-a", seq: i + 1, z: 10 });
  });
  doc.stories.push({ id: "st-h", m: 1, paras: [{ ps: "ps-thead", runs: [{ t: "Chapter Two" }] }] });
  doc.items.push({ id: "it-h", m: 1, t: "text", pg: pages[3].id, x: 40, y: 50, w: 323, h: 30, story: "st-h", seq: 1, z: 10 });
  doc.stories.push({ id: "st-b", m: 1, paras: [{ ps: "ps-tfirst", runs: [{ t: text(120, 5) }] }] });
  doc.items.push({ id: "it-b", m: 1, t: "text", pg: pages[3].id, x: 40, y: 95, w: 323, h: 425, story: "st-b", seq: 1, z: 10 });
  return M.normDoc(doc);
}
const storyText = (d, sid) => M.story(d, sid).paras.map((p) => p.runs.map((r) => r.t || "").join("").replace(/[­​]/g, ""));

test("rebuild: frames per page by default; with thread, an article goes on across pages (LY-THR)", () => {
  const src = asPdf(article());
  const per = RB.build(src, { now: 5, lang: "en" });
  assert.equal(per.report.threads, undefined);
  assert.ok(per.doc.items.filter((it) => it.t === "text").every((it) => M.chain(per.doc, it.story).length === 1));
  const res = RB.build(asPdf(article()), { now: 5, lang: "en", thread: true });
  const d = res.doc, rep = res.report;
  assert.deepEqual(rep.threads, { stories: 1, frames: 2 });
  const order = M.pagesInOrder(d);
  const body = (pi) => d.items.filter((it) => it.t === "text" && it.pg === order[pi].id).sort((a, b) => b.h - a.h)[0];
  const ch = M.chain(d, body(0).story);
  assert.deepEqual(ch.map((f) => order.findIndex((p) => p.id === f.pg)), [0, 1, 2]);
  assert.deepEqual(ch.map((f) => f.seq), [1, 2, 3]);
  // a paragraph cut by the page is one paragraph again
  const want = M.story(article(), "st-a").paras.map((p) => p.runs[0].t);
  const got = storyText(d, ch[0].story).filter((t) => t);
  // (the last one goes on past page 3, where the PDF stops)
  assert.deepEqual(got.slice(0, -1), want.slice(0, got.length - 1));
  assert.equal(want[got.length - 1].indexOf(got[got.length - 1]), 0);
  assert.ok(got.length > 6, "paragraphs: " + got.length);
  // the new chapter under its heading is a story of its own
  assert.equal(M.chain(d, body(3).story).length, 1);
  // a frame that goes on is as tall as its lines; every line lands where it was
  const perOrder = M.pagesInOrder(per.doc), perH = (pi) => Math.max.apply(null, per.doc.items.filter((it) => it.t === "text" && it.pg === perOrder[pi].id).map((it) => it.h));
  assert.ok(ch[0].h < perH(0) - 30 && ch[1].h < perH(1) - 30, "h " + ch[0].h + " " + perH(0));
  assert.equal(ch[2].h, perH(2));
  assert.equal(rep.check.moved, 0, JSON.stringify(rep.framesOff));
  assert.equal(rep.check.extra, 0);
  assert.deepEqual(M.normDoc(JSON.parse(JSON.stringify(d))), d);
});

test("rebuild: with thread, a page that breaks after a full stop keeps two paragraphs", () => {
  const src = asPdf(article());
  // page 1 ends a sentence on a full line, page 2 starts a new one
  const p1 = src.pages[0].spans, p2 = src.pages[1].spans;
  const lastY = Math.max.apply(null, p1.map((s) => s.y)), lastSp = p1.filter((s) => s.y === lastY).pop();
  lastSp.t = lastSp.t.slice(0, -1) + ".";
  const firstY = Math.min.apply(null, p2.map((s) => s.y)), firstSp = p2.filter((s) => s.y === firstY)[0];
  firstSp.t = firstSp.t[0].toUpperCase() + firstSp.t.slice(1);
  const res = RB.build(src, { now: 5, lang: "en", thread: true });
  const d = res.doc, order = M.pagesInOrder(d);
  const fr = d.items.filter((it) => it.t === "text" && it.pg === order[0].id).sort((a, b) => b.h - a.h)[0];
  const ch = M.chain(d, fr.story);
  assert.equal(ch.length, 3);
  const paras = storyText(d, fr.story).filter((t) => t);
  assert.ok(paras.some((t) => /\.$/.test(t) && t.slice(-lastSp.t.length) === lastSp.t), "page 1's last words end a paragraph");
  assert.ok(paras.some((t) => t.indexOf(firstSp.t) === 0), "page 2's first words start one");
  assert.equal(res.report.check.moved, 0, JSON.stringify(res.report.framesOff));
});
