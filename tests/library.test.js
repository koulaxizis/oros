// Pure logic of Library / Βιβλιοθήκη: the model and its merge (sync
// slice "library"), locations, accent-free search and re-anchoring,
// EPUB packaging (container, OPF, nav, NCX), the shelf view, the
// Markdown export and the universal search provider.
// Run: node --test tests/

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const C = require("../library/core.js");
const P = require("../library/search.js");
const ROOT = path.join(__dirname, "..");

const H1 = "0123456789abcdef".repeat(4);
const H2 = "fedcba9876543210".repeat(4);
const B1 = C.bookIdOf(H1), B2 = C.bookIdOf(H2);

function book(id, m, extra) { return Object.assign({ id, m, fmt: "epub", title: "T " + id }, extra || {}); }
function hl(id, b, m, extra) {
  return Object.assign({ id, b, m, k: "hl", loc: "e:1:10", end: "e:1:20", c: 1, q: "quoted" }, extra || {});
}
function state(over) { return Object.assign(C.emptyState(), over || {}); }

test("book id is b + 16 hex of the hash", () => {
  assert.equal(B1, "b0123456789abcdef");
  assert.match(B1, C.BOOK_ID_RE);
  assert.match(C.newMarkId(), C.MARK_ID_RE);
});

test("normBook keeps known fields, cleans the rest", () => {
  const n = C.normBook({ id: B1, m: 5, h: H1, fmt: "pdf", title: "  A  title ", by: "X", lang: "el",
    year: 1821, pages: 300, path: "/internal/Books/a.pdf", tags: ["b", "a", "a", ""], fin: "2026-10-12",
    future: "keep", nested: { no: 1 } });
  assert.equal(n.fmt, "pdf");
  assert.equal(n.title, "A  title", "trimmed");
  assert.deepEqual(n.tags, ["b", "a"], "deduplicated, order kept");
  assert.equal(n.path, "/internal/Books/a.pdf");
  assert.equal(n.future, "keep", "forward-compatible scalar extras are kept");
  assert.equal(n.nested, undefined, "objects are not");
  assert.equal(C.normBook({ id: B1, m: 5, h: H2 }).h, undefined, "hash must match the id");
  assert.equal(C.normBook({ id: B1, m: 5, path: "/internal/../x" }).path, undefined);
  assert.equal(C.normBook({ id: B1, m: 5, path: "/external/x" }).path, undefined);
  assert.equal(C.normBook({ id: "nope", m: 5 }), null);
  assert.equal(C.normBook({ id: B1 }), null, "no stamp, no record");
  assert.equal(C.normBook({ id: B1, m: 1, lang: "<script>" }).lang, undefined);
});

test("normMark: highlights need a forward range, notes are capped", () => {
  assert.ok(C.normMark(hl("kaaaaaa1", B1, 3)));
  assert.equal(C.normMark(hl("kaaaaaa1", B1, 3, { end: "e:1:5" })), null);
  assert.equal(C.normMark(hl("kaaaaaa1", B1, 3, { loc: "x:1:2" })), null);
  const bm = C.normMark({ id: "kbbbbbb1", b: B1, m: 2, k: "bm", loc: "p:3:y250", n: "x".repeat(9000) });
  assert.equal(bm.n.length, C.NOTE_LEN);
  assert.equal(bm.end, undefined);
  assert.equal(C.normMark(hl("kaaaaaa1", B1, 3, { c: 9 })).c, 0);
});

test("merge is symmetric, idempotent and canonical", () => {
  const a = state({
    books: [book(B2, 10), book(B1, 4, { title: "old" })],
    pos: { [B1]: { m: 7, loc: "e:2:40", pct: 120 } },
    marks: [hl("kaaaaaa1", B1, 3)]
  });
  const b = state({
    books: [book(B1, 6, { title: "new" })],
    pos: { [B1]: { m: 9, loc: "e:3:0", pct: 200 } },
    marks: [hl("kaaaaaa2", B1, 5), hl("kaaaaaa1", B1, 8, { c: 3 })]
  });
  const ab = C.mergeLibrary(a, b), ba = C.mergeLibrary(b, a);
  assert.equal(JSON.stringify(ab), JSON.stringify(ba));
  assert.equal(JSON.stringify(C.mergeLibrary(ab, ab)), JSON.stringify(ab));
  assert.equal(JSON.stringify(C.mergeLibrary(ab, a)), JSON.stringify(ab));
  assert.deepEqual(ab.books.map((x) => x.id), [B1, B2], "sorted by id");
  assert.equal(ab.books[0].title, "new");
  assert.equal(ab.pos[B1].loc, "e:3:0");
  assert.equal(ab.marks.find((k) => k.id === "kaaaaaa1").c, 3);
  // equal stamps: the larger canonical JSON wins on both sides
  const x = state({ books: [book(B1, 5, { title: "Alpha" })] });
  const y = state({ books: [book(B1, 5, { title: "Beta" })] });
  assert.equal(JSON.stringify(C.mergeLibrary(x, y)), JSON.stringify(C.mergeLibrary(y, x)));
  // associative
  const z = state({ books: [book(B1, 5, { title: "Gamma" })], tombs: { kaaaaaa2: 6 } });
  assert.equal(JSON.stringify(C.mergeLibrary(C.mergeLibrary(a, b), z)),
               JSON.stringify(C.mergeLibrary(a, C.mergeLibrary(b, z))));
});

test("merge leaves its inputs untouched", () => {
  const a = state({ books: [book(B1, 4)] });
  const snap = JSON.stringify(a);
  C.mergeLibrary(a, state({ books: [book(B1, 9)], tombs: { [B1]: 2 } }));
  assert.equal(JSON.stringify(a), snap);
});

test("tombstones hide older records, never newer ones", () => {
  const a = state({ books: [book(B1, 4)], marks: [hl("kaaaaaa1", B1, 3)] });
  const removed = state({ tombs: { [B1]: 5, kaaaaaa1: 5 } });
  const m = C.mergeLibrary(a, removed);
  assert.equal(m.books.length, 0);
  assert.equal(m.marks.length, 0);
  assert.equal(m.tombs[B1], 5);
  // re-added later on another device: stamp above the tomb survives
  const again = C.mergeLibrary(m, state({ books: [book(B1, 6)] }));
  assert.equal(again.books.length, 1);
  // tombs keep the max, junk keys dropped
  const t = C.mergeLibrary(state({ tombs: { [B1]: 3, junk: 9 } }), state({ tombs: { [B1]: 8 } }));
  assert.deepEqual(t.tombs, { [B1]: 8 });
});

test("merge drops malformed input instead of failing", () => {
  const m = C.mergeLibrary({ books: "x", marks: [null, 3, {}], pos: { bad: 1, [B1]: { m: 1, loc: "nope" } } }, null);
  assert.deepEqual(m, C.emptyState());
});

test("locations parse, build and order", () => {
  assert.deepEqual(C.parseLoc("e:3:120"), { f: "e", s: 3, y: false, o: 120 });
  assert.deepEqual(C.parseLoc("p:12:y500"), { f: "p", s: 12, y: true, o: 500 });
  assert.equal(C.parseLoc("e:3"), null);
  assert.equal(C.makeLoc("p", 4, 250.7, true), "p:4:y250");
  assert.ok(C.cmpLoc("e:2:900", "e:10:0") < 0, "spine compares as a number");
  assert.ok(C.cmpLoc("e:2:5", "e:2:40") < 0);
  const sorted = C.sortMarks([{ id: "k2", loc: "e:3:0" }, { id: "k1", loc: "e:1:9" }, { id: "k0", loc: "e:3:0" }]);
  assert.deepEqual(sorted.map((k) => k.id), ["k1", "k0", "k2"]);
});

test("findAll ignores case, accents and Greek final sigma", () => {
  const text = "Ο Οδυσσέας ταξίδεψε. ΟΔΥΣΣΕΑΣ ξανά, και οδυσσεας.";
  const hits = C.findAll(text, "οδυσσεας");
  assert.equal(hits.length, 3);
  assert.equal(text.slice(hits[0].o, hits[0].o + hits[0].len), "Οδυσσέας");
  assert.equal(C.findAll("a  b\nc", "b c").length, 1, "query spaces match any whitespace run");
  assert.equal(C.findAll("x(y)", "(y)").length, 1, "regex characters are literal");
  assert.equal(C.findAll("aaaa", "a", 2).length, 2, "respects the cap");
  assert.deepEqual(C.findAll("abc", "   "), []);
  // combining accents: offsets still point into the source
  const dec = "café bar";
  const h = C.findAll(dec, "bar")[0];
  assert.equal(dec.slice(h.o, h.o + h.len), "bar");
});

test("snippet puts a space back between joined blocks", () => {
  const t = "Τέλος.Αρχή του Οδυσσέα.Επόμενο";
  const h = C.findAll(t, "οδυσσεα")[0];
  const sn = C.snippet(t, h.o, h.len);
  assert.equal(sn.pre, "Τέλος. Αρχή του ");
  assert.equal(sn.hit, "Οδυσσέα");
  assert.equal(sn.post, ". Επόμενο");
  assert.equal(C.snippet("v1.2 x", 0, 1).post, "1.2 x", "numbers stay as they are");
});

test("reanchor finds a highlight after the text moved", () => {
  const t = "one two three. one two four.";
  assert.equal(C.reanchor(t, "one two", "", "", 15), 15, "stored offset still right");
  const moved = "PREFACE. " + t;
  assert.equal(C.reanchor(moved, "one two", "three. ", " four", 15), 24, "context picks the second");
  assert.equal(C.reanchor(moved, "zzz", "", "", 0), -1);
  const ctx = C.contextOf(t, 15, 22);
  assert.equal(ctx.q, "one two");
  assert.equal(C.reanchor("X " + t, ctx.q, ctx.pre, ctx.suf, 15), 17);
});

test("resolvePath stays inside the book", () => {
  assert.deepEqual(C.resolvePath("OEBPS/text/ch1.xhtml", "../img/a.png"), { path: "OEBPS/img/a.png", frag: "" });
  assert.deepEqual(C.resolvePath("OEBPS/ch1.xhtml", "ch2.xhtml#n%201"), { path: "OEBPS/ch2.xhtml", frag: "n 1" });
  assert.deepEqual(C.resolvePath("OEBPS/ch1.xhtml", "#fn3"), { path: "OEBPS/ch1.xhtml", frag: "fn3" });
  assert.equal(C.resolvePath("a.xhtml", "../../etc/passwd"), null);
  assert.equal(C.resolvePath("a.xhtml", "https://x.org/"), null);
  assert.equal(C.resolvePath("a.xhtml", "javascript:alert(1)"), null);
  assert.equal(C.resolvePath("a.xhtml", "//evil.org/x"), null);
});

const CONTAINER = `<?xml version="1.0"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>`;
const OPF = `<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:title>Η &amp; Οδύσσεια</dc:title>
    <dc:creator>Όμηρος</dc:creator><dc:creator>Translator</dc:creator>
    <dc:language>el</dc:language>
    <dc:date>1890-05-01</dc:date>
    <dc:description>&lt;p&gt;An &lt;b&gt;epic&lt;/b&gt;&lt;/p&gt;</dc:description>
    <meta name="cover" content="cov"/>
  </metadata>
  <manifest>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    <item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>
    <item id="c1" href="text/ch1.xhtml" media-type="application/xhtml+xml"/>
    <item id="c2" href="text/ch%202.xhtml" media-type="application/xhtml+xml"/>
    <item id="cov" href="img/cover.jpg" media-type="image/jpeg"/>
    <item id="css" href="style.css" media-type="text/css"/>
  </manifest>
  <spine toc="ncx" page-progression-direction="ltr">
    <itemref idref="c1"/><itemref idref="css"/><itemref idref="c2" linear="no"/><itemref idref="missing"/>
  </spine>
</package>`;
const NAV = `<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><body>
<nav epub:type="landmarks"><ol><li><a href="text/ch1.xhtml">Start</a></li></ol></nav>
<nav epub:type="toc"><ol>
  <li><a href="text/ch1.xhtml">Ραψωδία Α</a><ol><li><a href="text/ch1.xhtml#s2">Μέρος <i>2</i></a></li></ol></li>
  <li><span>Group</span><ol><li><a href="text/ch%202.xhtml">B</a></li></ol></li>
</ol></nav></body></html>`;
const NCX = `<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/"><navMap>
<navPoint id="a"><navLabel><text>One</text></navLabel><content src="text/ch1.xhtml"/>
  <navPoint id="b"><navLabel><text>One.1</text></navLabel><content src="text/ch1.xhtml#x"/></navPoint>
</navPoint>
<navPoint id="c"><navLabel><text>Two</text></navLabel><content src="text/ch%202.xhtml"/></navPoint>
</navMap></ncx>`;

test("parseContainer finds the package", () => {
  assert.equal(C.parseContainer(CONTAINER), "OEBPS/content.opf");
  assert.equal(C.parseContainer("<container/>"), null);
});

test("parseOpf reads metadata, manifest and spine", () => {
  const p = C.parseOpf(OPF, "OEBPS/content.opf");
  assert.equal(p.meta.title, "Η & Οδύσσεια");
  assert.equal(p.meta.by, "Όμηρος, Translator");
  assert.equal(p.meta.lang, "el");
  assert.equal(p.meta.year, 1890);
  assert.equal(p.meta.desc, "An epic", "markup in the description is stripped");
  assert.deepEqual(p.spine.map((s) => s.path), ["OEBPS/text/ch1.xhtml", "OEBPS/text/ch 2.xhtml"]);
  assert.equal(p.spine[1].linear, false);
  assert.equal(p.navPath, "OEBPS/nav.xhtml");
  assert.equal(p.ncxPath, "OEBPS/toc.ncx");
  assert.equal(p.coverPath, "OEBPS/img/cover.jpg");
  assert.equal(p.byPath["OEBPS/style.css"], "css");
  assert.equal(p.dir, "ltr");
});

test("parseNav takes the toc nav with depth", () => {
  const t = C.parseNav(NAV, "OEBPS/nav.xhtml");
  assert.deepEqual(t.map((x) => [x.t, x.d]), [["Ραψωδία Α", 0], ["Μέρος 2", 1], ["Group", 0], ["B", 1]]);
  assert.equal(t[1].frag, "s2");
  assert.equal(t[2].path, "", "a span heading has no target");
  assert.equal(t[3].path, "OEBPS/text/ch 2.xhtml");
});

test("parseNcx walks nested navPoints", () => {
  const t = C.parseNcx(NCX, "OEBPS/toc.ncx");
  assert.deepEqual(t.map((x) => [x.t, x.d, x.frag]), [["One", 0, ""], ["One.1", 1, "x"], ["Two", 0, ""]]);
});

test("xmlParse survives broken or hostile input", () => {
  assert.doesNotThrow(() => C.parseOpf("<package><metadata><dc:title>x", "a.opf"));
  assert.doesNotThrow(() => C.parseNav("<<<>>>&&&", "n.xhtml"));
  assert.doesNotThrow(() => C.parseNcx("", "t.ncx"));
  assert.equal(C.decodeEnt("&#x1F600;&#0;&lt;"), "😀<");
});

test("viewBooks filters, searches and sorts", () => {
  const s = C.mergeLibrary(state({
    books: [
      book(B1, 3, { title: "Ζορμπάς", by: "Καζαντζάκης", tags: ["κλασικά"], added: 10 }),
      book(B2, 3, { title: "Alpha", fmt: "pdf", fin: "2026-01-02", added: 20 })
    ],
    pos: { [B1]: { m: 50, loc: "e:1:0", pct: 400 } }
  }), null);
  assert.deepEqual(C.viewBooks(s, {}).map((b) => b.id), [B1, B2], "recent: last read first");
  assert.deepEqual(C.viewBooks(s, { sort: "title" }).map((b) => b.id), [B2, B1]);
  assert.deepEqual(C.viewBooks(s, { filter: "reading" }).map((b) => b.id), [B1]);
  assert.deepEqual(C.viewBooks(s, { filter: "done" }).map((b) => b.id), [B2]);
  assert.deepEqual(C.viewBooks(s, { filter: "unread" }).map((b) => b.id), []);
  assert.deepEqual(C.viewBooks(s, { filter: "pdf" }).map((b) => b.id), [B2]);
  assert.deepEqual(C.viewBooks(s, { q: "καζαντζακης κλασικα" }).map((b) => b.id), [B1]);
  assert.deepEqual(C.continueList(s).map((b) => b.id), [B1]);
});

test("exportMarkdown lists notes in book order", () => {
  const b = C.normBook(book(B1, 1, { title: "Book", by: "Me" }));
  const md = C.exportMarkdown(b, [
    hl("kaaaaaa2", B1, 1, { loc: "e:2:0", end: "e:2:5", q: "second", c: 2, n: "my note", lbl: "Chapter 2" }),
    hl("kaaaaaa1", B1, 1, { q: "first", lbl: "Chapter 1" }),
    { id: "kaaaaaa3", b: B2, m: 1, k: "bm", loc: "e:0:0" }
  ], "en");
  assert.equal(md, "# Book\n\n*Me*\n\n## Chapter 1\n\n> first\n\n*Green*\n\n## Chapter 2\n\n> second\n\n*Blue*\n\nmy note\n");
  assert.match(C.exportMarkdown(b, [], "el"), /Δεν υπάρχουν σημειώσεις/);
});

test("file helpers", () => {
  assert.equal(C.formatOf("A.EPUB"), "epub");
  assert.equal(C.formatOf("a.pdf"), "pdf");
  assert.equal(C.formatOf("a.txt"), null);
  assert.equal(C.titleFromName("my_great-book.epub"), C.titleFromName("my_great-book.epub"));
  assert.ok(C.titleFromName("my_great-book.epub").length > 0);
  assert.deepEqual(C.parseTags(" b, a ,, A"), ["b", "a"]);
});

test("search provider: books and marks, tombs respected", () => {
  const data = C.mergeLibrary(state({
    books: [book(B1, 3, { title: "Ζορμπάς", by: "Καζαντζάκης" }), book(B2, 3, { title: "Gone" })],
    marks: [hl("kaaaaaa1", B1, 3, { q: "λευτεριά" }), { id: "kaaaaaa2", b: B1, m: 3, k: "bm", loc: "e:0:0" },
            { id: "kaaaaaa3", b: B1, m: 3, k: "bm", loc: "e:0:9", n: "remember" }],
    tombs: { [B2]: 3 }
  }), null);
  // a stale copy with the removed book still in it: the provider hides it too
  data.books.push(book(B2, 2, { title: "Gone" }));
  const hits = P.search({ readJSON: (k) => (k === "oros-library-data" ? data : null), lang: "el" });
  assert.deepEqual(hits.map((h) => h.id).sort(), [B1, "kaaaaaa1", "kaaaaaa3"].sort());
  const h = hits.find((x) => x.id === "kaaaaaa1");
  assert.deepEqual(h.target, { book: B1, loc: "e:1:10" });
  assert.match(h.title, /Υπογράμμιση/);
  assert.deepEqual(P.search({ readJSON: () => null, lang: "en" }), []);
  assert.deepEqual(P.keys, ["oros-library-data"]);
});

test("app files: palette contract, strings in both languages", () => {
  const js = ["app.js", "home.js", "reader.js", "epub.js", "pdfview.js", "store.js"]
    .map((f) => fs.readFileSync(path.join(ROOT, "library", f), "utf8")).join("\n");
  assert.ok(js.includes("inheritPalette") && js.includes("watchPalette"), "G3 palette contract");
  global.window = {};
  require("../library/strings.js");
  const S = global.window.LIB_STRINGS;
  delete global.window;
  const en = Object.keys(S.en).sort(), el = Object.keys(S.el).sort();
  assert.deepEqual(el, en, "same keys in EN and EL");
  const used = new Set();
  for (const m of js.matchAll(/\bt\("([a-z]+\.[A-Za-z]+)"/g)) used.add(m[1]);
  for (const k of used) assert.ok(S.en[k] !== undefined, "missing string " + k);
});

test("the EPUB frame is locked down by CSP", () => {
  const src = fs.readFileSync(path.join(ROOT, "library/epub.js"), "utf8");
  assert.match(src, /Content-Security-Policy/);
  assert.match(src, /default-src 'none'/);
  assert.doesNotMatch(src, /script-src/, "no script source is ever allowed");
});

test("Media Shelf link: find the linked item, build the add target", () => {
  const shelf = { ver: 1, items: [
    { id: "item000001", m: 5, type: "book", title: "Other" },
    { id: "item000002", m: 6, type: "book", title: "Linked", lib: B1 },
    { id: "item000003", m: 7, type: "book", title: "Removed", lib: B2 }
  ], sess: [], goals: {}, tombs: { item000003: 7 } };
  const snap = JSON.stringify(shelf);
  assert.equal(C.shelfItemOf(shelf, B1), "item000002");
  assert.equal(C.shelfItemOf(shelf, B2), null, "a deleted Shelf item is not a link");
  assert.equal(C.shelfItemOf(null, B1), null);
  assert.equal(C.shelfItemOf({ items: "x" }, B1), null);
  assert.equal(JSON.stringify(shelf), snap, "Shelf data is only read");
  assert.deepEqual(C.shelfTarget(C.normBook(book(B1, 1, { title: "Ζορμπάς", by: "Ν. Κ.", year: 1946, pages: 320 }))),
    { addBook: { lib: B1, title: "Ζορμπάς", by: "Ν. Κ.", year: 1946, size: 320 } });
  assert.deepEqual(C.shelfTarget(C.normBook(book(B1, 1, { title: "T" }))), { addBook: { lib: B1, title: "T" } });
  assert.equal(C.estPagesBytes(240000), 100);
  assert.equal(C.estPagesBytes(0), 1);
});
