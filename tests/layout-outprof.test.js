// Layout output profiles (LY-OUT, wave L7 E1): profiles in
// setup.ext.out, the pages of an edition, the edition's ISBN from the
// Publishing title, the book's language, heading levels, the contents
// as links, and the e-book PDF (RGB, /Lang, links, bookmarks).
// Synthetic documents only.
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
const O = require(path.join(ROOT, "layout/outprof.js"));
T.allKeys().forEach((k) => {
  const b = fs.readFileSync(path.join(ROOT, "vendor/noto", T.fontFile(k)));
  T.register(k, b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
});

const zlib = require("zlib");
// the PDF with every page stream inflated (jsPDF compresses them)
function pdfText(pdf) {
  const buf = Buffer.from(pdf.output("arraybuffer"));
  let out = buf.toString("latin1"), at = 0;
  for (;;) {
    const s = buf.indexOf("stream", at);
    if (s < 0) break;
    const e = buf.indexOf("endstream", s + 6);
    if (e < 0) break;
    let a = s + 6;
    if (buf[a] === 13) a++;
    if (buf[a] === 10) a++;
    try { out += "\n" + zlib.inflateSync(buf.subarray(a, e)).toString("latin1"); } catch (x) { void x; }
    at = e + 9;
  }
  return out;
}
const PB = "9786185321005", EB = "9786185321012";
function pubData() {
  return { titles: [{ id: "t1", m: 5, t: "Το βιβλίο", lang: "Ελληνικά",
    fmts: [{ id: "f-pb", k: "pb", isbn: PB, price: 14 }, { id: "f-eb", k: "eb", isbn: EB, price: 6.99 }] }],
    set: { cur: "EUR" }, tombs: {} };
}
// 6 pages: colophon, contents, part, chapter 1, chapter 2, an empty page
function book(ext) {
  const d = M.newDoc({ name: "Book", w: 400, h: 600, pages: 6, facing: 1 }, 1);
  const pg = M.pagesInOrder(d);
  d.pstyles.push({ id: "ps-hspart", m: 1, name: "Part", base: "ps-base", size: 20 });
  d.pstyles.push({ id: "ps-chap", m: 1, name: "Chapter", base: "ps-base", size: 16, ext: { sec: 1 } });
  d.pstyles.push({ id: "ps-plain", m: 1, name: "Plain", base: "ps-chap", ext: { lvl: 0 } });
  const add = (i, id, paras, ext) => {
    d.stories.push(Object.assign({ id: "st-" + id, m: 1, paras }, ext ? { ext } : {}));
    d.items.push({ id: "it-" + id, m: 1, t: "text", pg: pg[i].id, x: 40, y: 40, w: 320, h: 500, story: "st-" + id, seq: 1, z: i + 1 });
  };
  add(0, "col", [{ ps: "ps-body", runs: [{ t: "ISBN 978-618-5321-00-5 · {price}" }] }]);
  add(1, "toc", [{ ps: "ps-body", runs: [{ t: "Μέρος πρώτο\t3" }] }, { ps: "ps-body", runs: [{ t: "Η αρχή\t4" }] }, { ps: "ps-body", runs: [{ t: "Το τέλος\t5" }] }], { hs: "toc" });
  add(2, "part", [{ ps: "ps-hspart", runs: [{ t: "Μέρος πρώτο" }] }]);
  add(3, "c1", [{ ps: "ps-chap", runs: [{ t: "Η αρχή" }] }, { ps: "ps-body", runs: [{ t: "Κείμενο. ".repeat(30) }] }]);
  add(4, "c2", [{ ps: "ps-chap", runs: [{ t: "Το τέλος" }] }, { ps: "ps-plain", runs: [{ t: "Όχι τίτλος" }] }]);
  d.items.push({ id: "it-empty", m: 1, t: "text", pg: pg[5].id, x: 40, y: 40, w: 100, h: 100, story: "st-none", seq: 1, z: 9 });
  d.stories.push({ id: "st-none", m: 1, paras: [{ ps: "ps-body", runs: [] }] });
  d.swatches.push({ id: "sw-cmyk", m: 1, name: "Ink", mode: "cmyk", v: [0, 100, 100, 0] });
  d.items.push({ id: "it-box", m: 1, t: "rect", pg: pg[3].id, x: 10, y: 10, w: 20, h: 20, fill: "sw-cmyk", z: 20 });
  if (ext) d.setup.ext = ext;
  return M.normDoc(d);
}

test("profiles: defaults until changed, cleaned when stored, kept by the model", () => {
  const d = book();
  assert.deepEqual(O.list(d).map((p) => p.k), ["print", "ebook"]);
  assert.equal(O.stored(d), null);
  const s = JSON.parse(JSON.stringify(d.setup));
  O.save(s, [{ id: "op-x", k: "weird", n: "  Mine\u0007 ", drop: ["pg-a", "pg-a", 3], bleed: 1 }, { id: "op-x", k: "ebook" }, { id: "BAD" }]);
  const n = O.norm(s.ext.out);
  assert.equal(n.list.length, 1, "duplicate and bad ids dropped");
  assert.deepEqual(n.list[0], { id: "op-x", n: "Mine", k: "print", fmt: "", blank: 0, toc: 0, q: "print", drop: ["pg-a"], bleed: 1, marks: 0, spreads: 0 });
  // the model keeps it verbatim (R39: inside ext), also through a merge with a stripped copy
  const d2 = M.normDoc(Object.assign(JSON.parse(JSON.stringify(d)), { setup: s }));
  assert.deepEqual(d2.setup.ext.out, s.ext.out);
  const plain = JSON.parse(JSON.stringify(d2)); delete plain.setup.ext;
  const m = M.mergeDoc(plain, d2);
  assert.deepEqual(m.setup.ext.out, s.ext.out, "equal m: the copy with ext wins");
  O.save(s, []);
  assert.equal(s.ext, undefined, "an empty list removes it");
  assert.equal(O.newId([{ id: "op-1" }, { id: "op-2" }]), "op-3");
});

test("pages: empty pages, contents pages and a range left out", () => {
  const d = book(), pg = M.pagesInOrder(d).map((p) => p.id);
  assert.deepEqual(O.pagesFor(d, { blank: 0, toc: 0 }), pg);
  assert.deepEqual(O.pagesFor(d, { blank: 1, toc: 0 }), pg.slice(0, 5));
  assert.deepEqual(O.pagesFor(d, { blank: 1, toc: 1, drop: [pg[0]] }), [pg[2], pg[3], pg[4]]);
});

test("language: the document's own, else the Publishing title's", () => {
  assert.equal(O.lang(book({ lang: "de" }), { lang: "el" }), "de");
  assert.equal(O.lang(book(), { lang: "Ελληνικά" }), "el");
  assert.equal(O.lang(book(), { lang: "en-GB" }), "en-GB");
  assert.equal(O.lang(book({ lang: "<x>" }), { lang: "klingon" }), "");
  assert.equal(O.okLang("grc"), "grc");
});

test("headings: levels set, inherited and guessed; contents lines link to them", () => {
  const d = book();
  assert.equal(O.level(d, "ps-hspart"), 1);
  assert.equal(O.level(d, "ps-chap"), 2, "running-head titles are chapters");
  assert.equal(O.level(d, "ps-plain"), 0, "its own lvl 0 wins over the inherited sec");
  assert.equal(O.level(d, "ps-h3"), 3);
  assert.equal(O.level(d, "ps-body"), 0);
  const L = R.computeLayout(d), heads = O.headings(d, L), pg = M.pagesInOrder(d).map((p) => p.id);
  assert.deepEqual(heads.map((h) => [h.t, h.lvl, h.pg]), [["Μέρος πρώτο", 1, pg[2]], ["Η αρχή", 2, pg[3]], ["Το τέλος", 2, pg[4]]]);
  const links = O.tocLinks(d, L, heads);
  assert.deepEqual(links.map((l) => [l.pg, l.to]), [[pg[1], pg[2]], [pg[1], pg[3]], [pg[1], pg[4]]]);
  links.forEach((l) => assert.ok(l.w > 100 && l.h > 5 && l.y >= 40));
  assert.ok(links[1].y > links[0].y);
});

test("edition: the format's ISBN replaces the other's as written, fields filled, the original untouched", () => {
  const d = book({ pub: "t1" }), before = JSON.stringify(d);
  const ed = O.edition(d, { k: "ebook", fmt: "" }, pubData());
  assert.equal(ed.isbn, EB);
  assert.equal(ed.doc.stories.find((s) => s.id === "st-col").paras[0].runs[0].t, "ISBN 978-618-5321-01-2 · 6,99 €");
  assert.equal(JSON.stringify(d), before);
  const pr = O.edition(d, { k: "print", fmt: "" }, pubData());
  assert.equal(pr.isbn, PB);
  assert.equal(pr.doc.stories.find((s) => s.id === "st-col").paras[0].runs[0].t, "ISBN 978-618-5321-00-5 · 14,00 €");
  const none = O.edition(book(), { k: "ebook" }, pubData());
  assert.equal(none.isbn, "", "not linked: nothing changes");
  assert.equal(none.changed, 0);
  const gone = O.edition(d, { k: "ebook" }, Object.assign(pubData(), { tombs: { t1: 9 } }));
  assert.equal(gone.pub, null, "a deleted title is not used");
});

test("e-book PDF: RGB only, /Lang, links from the contents, bookmarks", () => {
  global.window = global.window || global;
  const { jsPDF } = require(path.join(ROOT, "vendor/jspdf.umd.min.js"));
  const d = book({ lang: "el" }), L = R.computeLayout(d), heads = O.headings(d, L);
  const pages = O.pagesFor(d, { blank: 1 });
  const pdf = P.build(d, { pages, rgb: true, lang: "el" }, { jsPDF, layout: L, outline: heads, links: O.tocLinks(d, L, heads) });
  const out = pdfText(pdf);
  assert.equal(pdf.getNumberOfPages(), 5);
  assert.ok(/\/Lang \(el\)/.test(out), "/Lang");
  assert.equal((out.match(/\/Subtype \/Link/g) || []).length, 3, "three contents links");
  assert.ok(/\/Outlines/.test(out), "bookmarks");
  assert.equal(pdf.outline.root.children.length, 1, "the part");
  assert.equal(pdf.outline.root.children[0].children.length, 2, "its two chapters under it");
  assert.ok(/ rg\n/.test(out), "RGB fill");
  assert.ok(!/ k\n/.test(out) && !/ K\n/.test(out), "no CMYK colour operators");
  const print = pdfText(P.build(d, {}, { jsPDF, layout: L }));
  assert.ok(/ k\n/.test(print), "the print PDF keeps CMYK");
  assert.ok(!/\/Subtype \/Link/.test(print) && !/\/Lang/.test(print));
});
