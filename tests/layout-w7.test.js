// Layout W7 (LY-W7): footnotes and endnotes, lists, cross-references,
// links in PDF and EPUB, contents from styles in any document, books
// (page numbers on, styles the same), strings in EN/EL/DE, wiring.
// Run: node --test tests/layout-w7.test.js
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const M = require(path.join(ROOT, "designkit/model.js"));
const T = require(path.join(ROOT, "designkit/text.js"));
const R = require(path.join(ROOT, "designkit/render.js"));
const O = require(path.join(ROOT, "layout/outprof.js"));
const A = require(path.join(ROOT, "layout/autolay.js"));
const BK = require(path.join(ROOT, "layout/book.js"));
const B = require("./layout-ebooks.js");
const C = require(path.join(ROOT, "layout/epubcheck.js"));
const Z = require(path.join(ROOT, "atelier/zip.js"));
const read = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");

T.allKeys().forEach((k) => {
  const b = fs.readFileSync(path.join(ROOT, "vendor/noto", T.fontFile(k)));
  T.register(k, b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
});

const WORDS = "λόγια ".repeat(25);
function doc(pages, h) {
  const d = M.newDoc({ name: "W7", w: 300, h: h || 400, pages: pages || 1, facing: 0 }, 1000);
  return { d, pg: M.pagesInOrder(d) };
}
function frame(d, pg, i, story, h) {
  d.items.push({ id: "it-" + i, m: 1000, t: "text", pg: pg.id, x: 20, y: 20, w: 200, h: h || 300, story, seq: i + 1, z: 1 });
}
const lines = (L, id) => L.frames[id].lines;
const text = (ln) => ln.runs.map((r) => r.t).join("");
const flat = (ln) => text(ln).replace(/\s+/g, "");

test("footnotes: numbered, at the foot of the column under a rule, the text above them", () => {
  const { d, pg } = doc();
  d.stories.push({ id: "st-a", m: 1000, paras: [
    { ps: "ps-body", runs: [{ t: "Αρχή " + WORDS }, { t: "*", ext: { fn: "n1", ft: "Πρώτη σημείωση με αρκετό κείμενο για δύο γραμμές ίσως." } }, { t: " συνέχεια " + WORDS }] },
    { ps: "ps-body", runs: [{ t: "Άλλη " + WORDS }, { t: "*", ext: { fn: "n2", ft: "Δεύτερη." } }, { t: " τέλος." }] }] });
  frame(d, pg[0], 0, "st-a");
  const L = R.computeLayout(M.normDoc(d)), ls = lines(L, "it-0");
  const body = ls.filter((l) => !l.fn), notes = ls.filter((l) => l.fn);
  assert.ok(notes.length >= 3, "the rule and the notes' lines");
  assert.match(text(notes[1]), /^1 Πρώτη/);
  assert.match(text(notes[notes.length - 1]), /^2 Δεύτερη/);
  const refs = body.flatMap((l) => l.runs.filter((r) => r.fn));
  assert.deepEqual(refs.map((r) => [r.fn, r.t]), [["n1", "1"], ["n2", "2"]], "the references show the numbers");
  assert.ok(refs[0].y < body.find((l) => l.runs.includes(refs[0])).y, "the reference is raised");
  assert.ok(Math.max(...body.map((l) => l.y + l.d)) < notes[0].y, "the text ends above the notes");
  assert.ok(notes[notes.length - 1].y <= 300, "inside the frame");
  assert.ok(notes.every((l) => l.p === -1), "notes belong to no paragraph (the caret skips them)");
  assert.equal(L.overset["st-a"], undefined);
});

test("footnotes: a line whose note does not fit moves on with it; numbers run through the document", () => {
  const { d, pg } = doc(2, 200);
  const long = "Μια μεγάλη σημείωση. ".repeat(18);
  d.stories.push({ id: "st-a", m: 1000, paras: [{ ps: "ps-body", runs: [{ t: WORDS + WORDS.slice(0, 40) }, { t: "*", ext: { fn: "n1", ft: long } }, { t: " " + WORDS }] }] });
  d.stories.push({ id: "st-b", m: 1000, paras: [{ ps: "ps-body", runs: [{ t: "Β " }, { t: "*", ext: { fn: "m1", ft: "Άλλη ιστορία." } }] }] });
  frame(d, pg[0], 0, "st-a", 150);
  frame(d, pg[1], 1, "st-a", 150);
  d.items.push({ id: "it-b", m: 1000, t: "text", pg: pg[1].id, x: 20, y: 175, w: 200, h: 20, story: "st-b", seq: 1, z: 2 });
  const L = R.computeLayout(M.normDoc(d));
  const where = ["it-0", "it-1"].find((id) => lines(L, id).some((l) => l.runs.some((r) => r.fn === "n1")));
  const noteIn = ["it-0", "it-1"].find((id) => lines(L, id).some((l) => l.fn && /Μιαμεγάλη/.test(flat(l))));
  assert.equal(where, noteIn, "reference and note in the same frame");
  // st-b comes after st-a (reading order): its note is number 2
  assert.equal(lines(L, "it-b").flatMap((l) => l.runs).find((r) => r.fn === "m1").t, "2");
  // numbers from 1 in each story when asked
  const d2 = M.normDoc(Object.assign(JSON.parse(JSON.stringify(d)), {}));
  d2.setup.ext = { fn: { r: "story" } };
  const L2 = R.computeLayout(M.normDoc(d2));
  assert.equal(lines(L2, "it-b").flatMap((l) => l.runs).find((r) => r.fn === "m1").t, "1");
});

test("endnotes: after the story's last paragraph, numbered as the references", () => {
  const { d, pg } = doc();
  d.setup.ext = { fn: { kind: "end" } };
  d.stories.push({ id: "st-a", m: 1000, paras: [
    { ps: "ps-body", runs: [{ t: "Ένα" }, { t: "*", ext: { fn: "a", ft: "Η πρώτη." } }, { t: " δύο" }, { t: "*", ext: { fn: "b", ft: "Η δεύτερη.\nΜε δεύτερη παράγραφο." } }] },
    { ps: "ps-body", runs: [{ t: "Τέλος του κειμένου." }] }] });
  frame(d, pg[0], 0, "st-a");
  const L = R.computeLayout(M.normDoc(d)), ls = lines(L, "it-0");
  const ix = ls.findIndex((l) => /Τέλος/.test(text(l)));
  const after = ls.slice(ix + 1).map(flat);
  assert.deepEqual(after, ["1Ηπρώτη.", "2Ηδεύτερη.", "Μεδεύτερηπαράγραφο."]);
  assert.ok(ls.slice(ix + 1).every((l) => l.fn), "marked as notes");
  assert.equal(L.placed["st-a"], 2, "the story's own paragraphs only");
});

test("lists: formats, levels, a shared list, a new start; Greek numerals", () => {
  assert.deepEqual(T.LIST_FORMATS, ["1.", "1)", "(1)", "a.", "a)", "A.", "i.", "I.", "αʹ", "Αʹ", "•", "–"]);
  assert.deepEqual([1, 9, 10, 12, 99, 100, 999].map(T.greekNum), ["α", "θ", "ι", "ιβ", "ϟθ", "ρ", "ϡϟθ"].map((x) => x + "\u0374"));
  assert.equal(T.listLabel("I.", 14), "XIV.");
  assert.equal(T.listLabel("a)", 28), "ab)");
  const { d, pg } = doc();
  d.pstyles.push({ id: "ps-li", m: 1, name: "L1", base: "ps-body", ext: { list: { f: "αʹ", lv: 1 } } });   // the other keraia (NFC)
  d.pstyles.push({ id: "ps-li2", m: 1, name: "L2", base: "ps-body", li: 20, ext: { list: { f: "i.", lv: 2, g: "ps-li" } } });
  d.pstyles.push({ id: "ps-n", m: 1, name: "N", base: "ps-body", ext: { list: { f: "1.", s: 5 } } });
  d.pstyles.push({ id: "ps-nn", m: 1, name: "No list", base: "ps-n", ext: { list: null } });
  const P = (ps, t, ext) => Object.assign({ ps, runs: [{ t }] }, ext ? { ext } : {});
  d.stories.push({ id: "st-a", m: 1000, paras: [P("ps-li", "ένα"), P("ps-li", "δύο"), P("ps-li2", "υπό"), P("ps-li2", "υπό"), P("ps-li", "τρία"), P("ps-li2", "πάλι"),
    P("ps-n", "πέντε"), P("ps-n", "έξι"), P("ps-nn", "χωρίς"), P("ps-n", "ξανά", { lr: 1 })] });
  frame(d, pg[0], 0, "st-a");
  const L = R.computeLayout(M.normDoc(d));
  const labels = lines(L, "it-0").map((l) => (l.runs.find((r) => r.lbl) || { t: "" }).t);
  assert.deepEqual(labels, ["α\u0374", "β\u0374", "i.", "ii.", "γ\u0374", "i.", "5.", "6.", "", "1."]);
  const ln = lines(L, "it-0")[0], lbl = ln.runs.find((r) => r.lbl), word = ln.runs.find((r) => !r.lbl);
  assert.ok(lbl.x + lbl.w < word.x, "the number hangs before the text");
});

test("cross-references: the page, the text or both, set after the pages are known; a link in the PDF", () => {
  const { d, pg } = doc(3, 300);
  const filler = { ps: "ps-body", runs: [{ t: "λόγια ".repeat(60) }] };
  d.stories.push({ id: "st-a", m: 1000, paras: [
    { ps: "ps-body", runs: [{ t: "Δες " }, { t: "?", ext: { xr: { to: "a1" } } }, { t: ", " }, { t: "?", ext: { xr: { to: "a1", k: "t" } } }, { t: ", " }, { t: "?", ext: { xr: { to: "a1", k: "tp" } } }, { t: ", " }, { t: "?", ext: { xr: { to: "gone" } } }] },
    filler, filler, filler, { ps: "ps-body", ext: { aid: "a1" }, runs: [{ t: "Ο στόχος" }] }] });
  pg.forEach((p, i) => frame(d, p, i, "st-a", 250));
  const nd = M.normDoc(d), L = R.computeLayout(nd);
  const at = pg.findIndex((p, i) => lines(L, "it-" + i).some((l) => /^Οστόχος$/.test(flat(l))));
  assert.ok(at > 0);
  assert.deepEqual(L.xr.a1, { t: "Ο στόχος", pg: String(at + 1), pid: pg[at].id });
  const first = lines(L, "it-0")[0];
  assert.match(flat(first), new RegExp("^Δες" + (at + 1) + ",Οστόχος,Οστόχος\\(" + (at + 1) + "\\),\\?"));
  const links = O.urlLinks(nd, L).filter((x) => x.to);
  assert.equal(links.length, 3, "a reference to a lost anchor is no link");
  assert.ok(links.every((x) => x.pg === pg[0].id && x.to === pg[at].id && x.w > 0));
});

test("links on words: one PDF link per line, only http, https and mailto", () => {
  const { d, pg } = doc();
  d.stories.push({ id: "st-a", m: 1000, paras: [{ ps: "ps-body", runs: [{ t: "Δείτε " }, { t: "τη σελίδα μας", ext: { href: "https://useoros.online" } }, { t: " και " }, { t: "αυτό", ext: { href: "javascript:alert(1)" } }, { t: "." }] }] });
  frame(d, pg[0], 0, "st-a");
  const nd = M.normDoc(d), L = R.computeLayout(nd);
  const links = O.urlLinks(nd, L).filter((x) => x.url);
  assert.equal(links.length, 1);
  assert.equal(links[0].url, "https://useoros.online");
  const ln = lines(L, "it-0")[0], w = ln.runs.filter((r) => /σελίδα|μας|τη/.test(r.t));
  assert.ok(links[0].x <= 20 + Math.min(...w.map((r) => r.x)) + 0.01 && links[0].w > 40);
});

test("EPUB: notes as pop-up footnotes, links, cross-references to the paragraph; epubcheck clean", async () => {
  const d = B.novel();
  const c1 = d.stories.find((s) => s.id === "st-c1"), c3 = d.stories.find((s) => s.id === "st-c3");
  c1.paras[3].runs.push({ t: "*", ext: { fn: "n1", ft: "Μια σημείωση & <κάτι>." } }, { t: " Δες " }, { t: "?", ext: { xr: { to: "end", k: "t" } } }, { t: " και " }, { t: "τη σελίδα", ext: { href: "https://useoros.online/?a=1&b=2" } }, { t: "." });
  c3.paras[1].ext = { aid: "end" };
  const r = await B.epub(M.normDoc(d));
  const z = Z.open(r.bytes), out = {};
  for (const n of z.names) out[n] = new TextDecoder().decode(await z.bytes(n));
  const all = z.names.filter((n) => /text\/c\d+\.xhtml$/.test(n)).map((n) => out[n]).join("\n");
  assert.match(all, /<sup><a epub:type="noteref" role="doc-noteref" id="fn1r" href="#fn1">1<\/a><\/sup>/);
  assert.match(all, /<aside epub:type="footnote" role="doc-footnote" id="fn1"><p><a href="#fn1r">1<\/a> Μια σημείωση &amp; &lt;κάτι&gt;\.<\/p><\/aside>/);
  assert.match(all, /<a href="https:\/\/useoros.online\/\?a=1&amp;b=2">τη σελίδα<\/a>/);
  const file = z.names.find((n) => /text\/c\d+\.xhtml$/.test(n) && out[n].includes('id="a-end"'));
  assert.ok(file, "the anchor has an id");
  assert.match(all, new RegExp('<a href="' + path.basename(file).replace(".", "\\.") + '#a-end">Και έτσι τελείωσε το καλοκαίρι\\.</a>'));
  const chk = await C.check(r.bytes, Z);
  assert.deepEqual(chk.errors, []);
});

test("contents from styles in any document: levels, entries' styles, «Τίτλος | σελ. N»", () => {
  const { d, pg } = doc(3, 300);
  d.pstyles.push({ id: "ps-h1", m: 1, name: "H1", base: "ps-body", size: 16 }, { id: "ps-h2", m: 1, name: "H2", base: "ps-body", size: 13 }, { id: "ps-toc2", m: 1, name: "Toc 2", base: "ps-body", li: 12 });
  d.setup.ext = { toc: { ps: [["ps-h1", 1], ["ps-h2", 2], ["ps-none", 1]], eps: ["", "ps-toc2"], sep: " | σελ. " } };
  d.stories.push({ id: "st-toc", m: 1000, ext: { hs: "toc" }, paras: [{ ps: "ps-h1", runs: [{ t: "Περιεχόμενα" }] }, { ps: "ps-body", runs: [{ t: "…\t1" }] }] });
  frame(d, pg[0], 0, "st-toc");
  const filler = { ps: "ps-body", runs: [{ t: "λόγια ".repeat(70) }] };
  d.stories.push({ id: "st-a", m: 1000, paras: [{ ps: "ps-h1", runs: [{ t: "Πρώτο" }, { t: "*", ext: { fn: "x", ft: "σημ." } }] }, { ps: "ps-h2", runs: [{ t: "Ενότητα" }] }, filler, { ps: "ps-h1", runs: [{ t: "Δεύτερο" }] }] });
  frame(d, pg[1], 1, "st-a", 250);
  frame(d, pg[2], 2, "st-a", 250);
  const nd = M.normDoc(d);
  assert.deepEqual(A.tocCfg(nd).heads, { "ps-h1": 1, "ps-h2": 2 }, "a style that is gone is left out");
  const n = A.toc(nd);
  const toc = nd.stories.find((s) => s.id === "st-toc");
  assert.equal(n, 3);
  assert.deepEqual(toc.paras.map((p) => [p.ps, p.runs.map((r) => r.t).join("")]), [["ps-h1", "Περιεχόμενα"], ["ps-body", "Πρώτο | σελ. 2"], ["ps-toc2", "Ενότητα | σελ. 2"], ["ps-body", "Δεύτερο | σελ. 3"]]);
  assert.equal(A.toc(nd), 3, "made again, the same");
  assert.equal(nd.stories.find((s) => s.id === "st-toc").paras.length, 4);
});

test("books: members in order, page numbers on (odd starts), styles made the same", () => {
  const mk = (id, name, pages, n, extra) => {
    const d = M.newDoc({ name, w: 300, h: 400, pages, facing: 1 }, 1);
    d.id = id;
    d.setup.ext = Object.assign({ bk: { id: "bk-a1", name: "Βιβλίο", n } }, extra || {});
    return M.normDoc(d);
  };
  const a = mk("doc-a", "Αρχή", 5, 0, { pnStart: 1 }), b = mk("doc-b", "Κεφάλαιο", 7, 2), c = mk("doc-c", "Τέλος", 3, 1);
  const other = M.normDoc(M.newDoc({ name: "Άλλο", w: 300, h: 400, pages: 1, facing: 0 }, 1));
  assert.equal(BK.bookOf(other), null);
  assert.equal(BK.bookOf(Object.assign({}, a, { setup: { ext: { bk: { id: "x" } } } })), null, "a bad id is no book");
  const list = BK.members([b, other, a, c], "bk-a1");
  assert.deepEqual(list.map((d) => d.id), ["doc-a", "doc-c", "doc-b"]);
  assert.deepEqual(BK.numbering(list, false).map((x) => x.start), [1, 6, 9]);
  assert.deepEqual(BK.numbering(list, true).map((x) => x.start), [1, 7, 11]);
  a.pstyles.push({ id: "ps-h", m: 5, name: "Τίτλος", base: "ps-body", size: 20 });
  a.swatches.push({ id: "sw-x", m: 5, name: "X", mode: "rgb", v: [1, 2, 3] });
  b.pstyles.find((s) => s.id === "ps-body").size = 99;
  b.pstyles.push({ id: "ps-own", m: 5, name: "Δικό του", base: "ps-body" });
  const n = BK.syncStyles(a, b, 77);
  assert.equal(n, 3, "body changed, title and colour added");
  assert.equal(b.pstyles.find((s) => s.id === "ps-body").size, a.pstyles.find((s) => s.id === "ps-body").size);
  assert.equal(b.pstyles.find((s) => s.id === "ps-h").m, 77);
  assert.ok(b.pstyles.find((s) => s.id === "ps-own"), "its own styles stay");
  assert.equal(BK.syncStyles(a, b, 78), 0, "nothing more the second time");
  assert.ok(M.normDoc(b));
  assert.match(BK.newBookId(), /^bk-[a-z0-9]+$/);
});

test("W7: strings in EN/EL/DE, wiring, help", () => {
  const LYJS = read("layout/layout.js"), at = LYJS.indexOf('"home.new": "Νέο έγγραφο"');
  const de = read("i18n/de/layout.js");
  const keys = ["note.menu", "note.ins", "note.settings", "note.kind", "note.foot", "note.end", "xr.ins", "xr.k.p", "xr.k.t", "xr.k.tp", "link.ins", "link.bad",
    "more.contents", "more.notes", "more.book", "toc.title", "toc.sepSel", "sty.list", "sty.listF", "sty.listHint", "book.title", "book.number", "book.sync", "book.pdf"];
  keys.forEach((k) => {
    assert.ok(LYJS.slice(0, at).includes('"' + k + '": '), "EN " + k);
    assert.ok(LYJS.slice(at).includes('"' + k + '": '), "EL " + k);
    assert.ok(de.includes('"' + k + '": '), "DE " + k);
  });
  const html = read("layout/index.html"), sw = read("sw.js");
  ["notes.js", "book.js"].forEach((f) => {
    assert.match(html, new RegExp('src="' + f.replace(".", "\\.") + '\\?v='), f);
    assert.ok(sw.includes('"layout/' + f + '"'), "sw " + f);
    assert.ok(html.indexOf(f) > html.indexOf("story.js") && html.indexOf(f) > html.indexOf("autolay.js"), f + " after story.js and autolay.js");
  });
  assert.match(read("layout/help.en.txt"), /## Notes, lists, cross-references and books/);
  assert.match(read("layout/help.el.txt"), /## Σημειώσεις, λίστες, παραπομπές και βιβλία/);
  assert.match(read("i18n/de/help/layout.txt"), /## Fußnoten, Listen, Querverweise und Bücher/);
  // the caret never stops in a note
  assert.match(read("layout/caret.js"), /if \(!ln\.fn\) out\.push/);
});
