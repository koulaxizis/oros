// Library wave 33: online catalogues (OPDS 1.x Atom, Atom feeds with
// enclosures, OPDS 2.0 JSON, OpenSearch), the catalogue list in the
// synced slice, CBR comics as a kind, and the Markdown export of a
// book's highlights and notes (download and Notes page).
// Run: node --test tests/

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const C = require("../library/core.js");
const O = require("../library/opds.js");

const H1 = "0123456789abcdef".repeat(4);
const B1 = C.bookIdOf(H1);

const GUT_SEARCH = `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom" xmlns:opds="http://opds-spec.org/2010/catalog" xml:base="https://www.gutenberg.org/ebooks/search.opds/?query=austen">
  <title>Books: austen (sorted by popularity)</title>
  <link rel="search" type="application/opensearchdescription+xml" href="/catalog/osd-books.xml"/>
  <link rel="start" type="application/atom+xml;profile=opds-catalog" href="/ebooks.opds/"/>
  <link rel="next" type="application/atom+xml;profile=opds-catalog" href="/ebooks/search.opds/?query=austen&amp;start_index=26"/>
  <entry>
    <title>Pride and Prejudice</title>
    <content type="text">Jane Austen</content>
    <link type="application/atom+xml;profile=opds-catalog" rel="subsection" href="/ebooks/1342.opds"/>
    <link type="image/jpeg" rel="http://opds-spec.org/image/thumbnail" href="https://www.gutenberg.org/cache/epub/1342/pg1342.cover.small.jpg"/>
  </entry>
  <entry>
    <title>Sort Alphabetically by Title</title>
    <link type="application/atom+xml;profile=opds-catalog" rel="http://opds-spec.org/sort/new" href="/ebooks/search.opds/?query=austen&amp;sort_order=title"/>
  </entry>
  <entry><title>Only an alternate page</title><link rel="alternate" type="text/html" href="/x"/></entry>
</feed>`;

const GUT_BOOK = `<feed xmlns="http://www.w3.org/2005/Atom" xmlns:dcterms="http://purl.org/dc/terms/">
  <title>Pride and Prejudice by Jane Austen</title>
  <entry>
    <title>Pride and Prejudice</title>
    <author><name>Austen, Jane</name></author>
    <dcterms:language>en</dcterms:language>
    <dcterms:issued>1998-06-01</dcterms:issued>
    <content type="xhtml"><div xmlns="http://www.w3.org/1999/xhtml"><p>Downloads: 70000 &amp; more</p><script>alert(1)</script></div></content>
    <link type="application/epub+zip" rel="http://opds-spec.org/acquisition" title="EPUB3 (E-readers incl. Send-to-Kindle)" length="24860000" href="/ebooks/1342.epub3.images"/>
    <link type="application/epub+zip" rel="http://opds-spec.org/acquisition" href="/ebooks/1342.epub.noimages"/>
    <link type="application/x-mobipocket-ebook" rel="http://opds-spec.org/acquisition" href="/ebooks/1342.kf8.images"/>
    <link type="application/pdf" rel="http://opds-spec.org/acquisition/buy" href="/buy.pdf"/>
    <link type="application/pdf" rel="http://opds-spec.org/acquisition/open-access" href="javascript:alert(1)"/>
    <link type="image/jpeg" rel="http://opds-spec.org/image" href="http://www.gutenberg.org/cover.jpg"/>
  </entry>
</feed>`;

const SE_ATOM = `<?xml version="1.0" encoding="utf-8"?>
<?xml-stylesheet href="/feeds/atom/style" type="text/xsl"?>
<feed xmlns="http://www.w3.org/2005/Atom" xmlns:media="http://search.yahoo.com/mrss/">
  <title>Standard Ebooks - New Releases</title>
  <entry>
    <id>https://standardebooks.org/ebooks/henry-seton-merriman/the-sowers</id>
    <title>The Sowers</title>
    <author><name>Henry Seton Merriman</name></author>
    <published>2026-10-13T17:47:53Z</published>
    <summary type="text">A novel about &lt;i&gt;Russia&lt;/i&gt;.</summary>
    <media:thumbnail url="https://standardebooks.org/images/covers/the-sowers-cover.jpg" height="525" width="350"/>
    <link href="https://standardebooks.org/ebooks/henry-seton-merriman/the-sowers" rel="alternate" title="This ebook's page at Standard Ebooks" type="application/xhtml+xml"/>
    <link href="https://standardebooks.org/ebooks/henry-seton-merriman/the-sowers/downloads/henry-seton-merriman_the-sowers.epub?source=feed" length="644041" rel="enclosure" title="Recommended compatible epub" type="application/epub+zip"/>
    <link href="https://standardebooks.org/ebooks/henry-seton-merriman/the-sowers/downloads/henry-seton-merriman_the-sowers_advanced.epub?source=feed" length="1409784" rel="enclosure" title="Advanced epub" type="application/epub+zip"/>
    <link href="https://standardebooks.org/ebooks/henry-seton-merriman/the-sowers/downloads/henry-seton-merriman_the-sowers.kepub.epub?source=feed" rel="enclosure" type="application/kepub+zip"/>
    <link href="https://standardebooks.org/ebooks/henry-seton-merriman/the-sowers/downloads/henry-seton-merriman_the-sowers.azw3?source=feed" rel="enclosure" type="application/x-mobipocket-ebook"/>
  </entry>
</feed>`;

const OPDS2 = JSON.stringify({
  metadata: { title: "Example Library" },
  links: [
    { rel: "self", href: "/opds", type: "application/opds+json" },
    { rel: "search", href: "/search{?query,title,author}", type: "application/opds+json", templated: true },
    { rel: ["next"], href: "/opds?page=2", type: "application/opds+json" }
  ],
  navigation: [{ href: "/new", title: "New books", type: "application/opds+json", rel: "current" }],
  publications: [{
    metadata: { title: "Moby-Dick", author: [{ name: "Herman Melville" }, "Anon"], language: ["en"], published: "1851",
                description: "<p>The whale.</p>" },
    links: [{ rel: "http://opds-spec.org/acquisition/open-access", href: "/moby.epub", type: "application/epub+zip" },
            { rel: "http://opds-spec.org/acquisition", href: "/moby.pdf", type: "application/pdf" },
            { rel: "http://opds-spec.org/acquisition/borrow", href: "/moby.cbz", type: "application/vnd.comicbook+zip" }],
    images: [{ href: "/big.jpg", width: 1200 }, { href: "https://img.example.org/small.jpg", width: 200 }, { href: "data:image/png;base64,AAAA" }]
  }],
  groups: [{ metadata: { title: "Comics" }, links: [{ rel: "self", href: "/comics" }],
             publications: [{ metadata: { title: { fr: "Tintin" } }, links: [{ rel: "http://opds-spec.org/acquisition", href: "/t.cbr", type: "application/x-cbr" }] }] }]
});

test("OPDS 1 search results: navigation entries, next page, OpenSearch link, thumbnails", () => {
  const f = O.parseFeed(GUT_SEARCH, "https://www.gutenberg.org/ebooks/search.opds/?query=austen");
  assert.equal(f.title, "Books: austen (sorted by popularity)");
  assert.equal(f.next, "https://www.gutenberg.org/ebooks/search.opds/?query=austen&start_index=26");
  assert.equal(f.start, "https://www.gutenberg.org/ebooks.opds/");
  assert.equal(f.osd, "https://www.gutenberg.org/catalog/osd-books.xml");
  assert.equal(f.search, "");
  assert.equal(f.entries.length, 2, "an entry with nothing to open or download is left out");
  const e = f.entries[0];
  assert.equal(e.kind, "nav");
  assert.equal(e.nav, "https://www.gutenberg.org/ebooks/1342.opds");
  assert.equal(e.summary, "Jane Austen");
  assert.equal(e.thumb, "https://www.gutenberg.org/cache/epub/1342/pg1342.cover.small.jpg");
  assert.equal(f.entries[1].nav, "https://www.gutenberg.org/ebooks/search.opds/?query=austen&sort_order=title");
});

test("OPDS 1 book page: one link per format, buy / unsafe / other formats left out, text only", () => {
  const f = O.parseFeed(GUT_BOOK, "https://www.gutenberg.org/ebooks/1342.opds");
  assert.equal(f.entries.length, 1);
  const b = f.entries[0];
  assert.equal(b.kind, "book");
  assert.equal(b.by, "Austen, Jane");
  assert.equal(b.lang, "en");
  assert.equal(b.year, 1998);
  assert.deepEqual(b.links, [{ url: "https://www.gutenberg.org/ebooks/1342.epub3.images", fmt: "epub",
                               type: "application/epub+zip", size: 24860000 }]);
  assert.doesNotMatch(b.summary, /</);
  assert.match(b.summary, /Downloads: 70000 & more/);
  assert.equal(b.thumb, "", "http pictures are not used (the page is https)");
});

test("Atom feed with ebook enclosures (Standard Ebooks new releases)", () => {
  const f = O.parseFeed("﻿" + SE_ATOM, "https://standardebooks.org/feeds/atom/new-releases");
  assert.equal(f.entries.length, 1);
  const b = f.entries[0];
  assert.equal(b.kind, "book");
  assert.equal(b.title, "The Sowers");
  assert.equal(b.by, "Henry Seton Merriman");
  assert.equal(b.year, 2026);
  assert.equal(b.summary, "A novel about Russia.");
  assert.equal(b.thumb, "https://standardebooks.org/images/covers/the-sowers-cover.jpg");
  assert.equal(b.links.length, 1, "kepub and azw3 are not offered; the first EPUB wins");
  assert.match(b.links[0].url, /the-sowers\.epub\?source=feed$/);
  assert.equal(b.links[0].size, 644041);
});

test("OPDS 2 JSON: navigation, publications, groups, templated search, images", () => {
  const f = O.parseFeed(OPDS2, "https://books.example.org/opds");
  assert.equal(f.title, "Example Library");
  assert.equal(f.next, "https://books.example.org/opds?page=2");
  assert.equal(f.search, "https://books.example.org/search{?query,title,author}");
  assert.equal(O.searchUrl(f.search, "white whale"), "https://books.example.org/search?query=white%20whale");
  const kinds = f.entries.map((e) => e.kind);
  assert.deepEqual(kinds, ["nav", "book", "head", "book"]);
  assert.equal(f.entries[0].nav, "https://books.example.org/new");
  const m = f.entries[1];
  assert.equal(m.by, "Herman Melville, Anon");
  assert.equal(m.year, 1851);
  assert.equal(m.summary, "The whale.");
  assert.equal(m.thumb, "https://img.example.org/small.jpg", "the smallest https picture");
  assert.deepEqual(m.links.map((l) => l.fmt), ["epub", "pdf"], "borrowing needs an account: left out");
  assert.equal(f.entries[2].title, "Comics");
  assert.equal(f.entries[2].nav, "https://books.example.org/comics");
  assert.equal(f.entries[3].title, "Tintin");
  assert.deepEqual(f.entries[3].links.map((l) => l.fmt), ["cbr"]);
});

test("not a catalogue: null; broken input never throws", () => {
  assert.equal(O.parseFeed("hello", "https://x.org/"), null);
  assert.equal(O.parseFeed("{not json", "https://x.org/"), null);
  assert.equal(O.parseFeed("[1,2]", "https://x.org/"), null);
  assert.equal(O.parseFeed("<html><body>404</body></html>", "https://x.org/"), null);
  assert.deepEqual(O.parseFeed("<feed><entry><title>x", "https://x.org/").entries, []);
});

test("OpenSearch description and search templates", () => {
  const osd = `<OpenSearchDescription xmlns="http://a9.com/-/spec/opensearch/1.1/">
    <Url type="text/html" template="https://www.gutenberg.org/ebooks/search/?query={searchTerms}"/>
    <Url type="application/atom+xml;profile=opds-catalog" template="/ebooks/search.opds/?query={searchTerms}&amp;start_index={startIndex?}"/>
  </OpenSearchDescription>`;
  const tpl = O.parseOsd(osd, "https://www.gutenberg.org/catalog/osd-books.xml");
  assert.equal(tpl, "https://www.gutenberg.org/ebooks/search.opds/?query={searchTerms}&start_index={startIndex?}");
  assert.equal(O.searchUrl(tpl, " Καζαντζάκης & co "), "https://www.gutenberg.org/ebooks/search.opds/?query=%CE%9A%CE%B1%CE%B6%CE%B1%CE%BD%CF%84%CE%B6%CE%AC%CE%BA%CE%B7%CF%82%20%26%20co&start_index=");
  assert.equal(O.searchUrl(tpl, "   "), "");
  assert.equal(O.searchUrl("javascript:{searchTerms}", "x"), "");
  const gut = O.BUILTIN.filter((b) => b.id === "gutenberg")[0];
  assert.equal(O.searchUrl(gut.search, "dickens"), "https://www.gutenberg.org/ebooks/search.opds/?query=dickens");
  assert.equal(O.BUILTIN.filter((b) => b.id === "stdebooks")[0].search, "", "Standard Ebooks' free feed has no search");
});

test("addresses: http(s) only, no credentials, catalogue URL typed by the user", () => {
  assert.equal(O.absUrl("/a", "https://x.org/b/c"), "https://x.org/a");
  assert.equal(O.absUrl("javascript:alert(1)", "https://x.org/"), "");
  assert.equal(O.absUrl("data:text/html,x", "https://x.org/"), "");
  assert.equal(O.absUrl("https://u:p@x.org/", null), "");
  assert.equal(O.absUrl("http://x.org/a.jpg", null, true), "");
  assert.equal(O.catUrl("bookserver.example.org/opds"), "https://bookserver.example.org/opds");
  assert.equal(O.catUrl("ftp://x.org/"), "");
  assert.equal(O.catUrl(""), "");
});

test("formats, file sniffing and file names", () => {
  assert.equal(O.fmtOfType("application/epub+zip; charset=x"), "epub");
  assert.equal(O.fmtOfType("application/octet-stream", "https://x.org/a/book.PDF?dl=1"), "pdf");
  assert.equal(O.fmtOfType("", "https://x.org/a.kepub.epub"), null);
  assert.equal(O.fmtOfType("application/x-mobipocket-ebook", "https://x.org/a.epub"), null);
  const zip = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0]), pdf = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]);
  const rar = new Uint8Array([0x52, 0x61, 0x72, 0x21, 0x1a]);
  const html = new TextEncoder().encode("<!DOCTYPE html><html>");
  assert.ok(O.sniffOk("epub", zip));
  assert.ok(O.sniffOk("cbz", zip));
  assert.ok(O.sniffOk("pdf", pdf));
  assert.ok(O.sniffOk("cbr", rar));
  assert.ok(!O.sniffOk("epub", html), "an error page is not a book");
  assert.ok(!O.sniffOk("pdf", zip));
  assert.equal(O.sniff(html), "html");
  assert.ok(O.sniffOk("fb2", new TextEncoder().encode('<?xml version="1.0"?><FictionBook xmlns="x">')));
  assert.equal(O.fileName('A/B: "C"?', "epub"), "A B C .epub".replace(" .", "."));
  assert.equal(O.fileName("...", "pdf"), "book.pdf");
  assert.equal(O.fileName("Ζορμπάς", "cbr"), "Ζορμπάς.cbr");
});

test("catalogues in the slice: normalized, LWW, tombstones, left out while empty", () => {
  const c1 = { id: "cabc12345", m: 5, url: " https://books.example.org/opds ", name: "  Mine " };
  assert.deepEqual(C.normCat(c1), { id: "cabc12345", m: 5, url: "https://books.example.org/opds", name: "Mine" });
  assert.equal(C.normCat({ id: "cabc12345", m: 5, url: "javascript:alert(1)" }), null);
  assert.equal(C.normCat({ id: "kabc12345", m: 5, url: "https://x.org/" }), null);
  assert.equal(C.normCat({ id: "cabc12345", m: 0, url: "https://x.org/" }), null);
  const a = Object.assign(C.emptyState(), { cats: [c1] });
  const b = Object.assign(C.emptyState(), { cats: [{ id: "cabc12345", m: 7, url: "https://books.example.org/v2", name: "Mine" }] });
  const m = C.mergeLibrary(a, b);
  assert.equal(m.cats.length, 1);
  assert.equal(m.cats[0].url, "https://books.example.org/v2");
  assert.deepEqual(C.mergeLibrary(b, a), m);
  assert.deepEqual(C.mergeLibrary(m, m), m);
  const gone = Object.assign(C.emptyState(), { tombs: { cabc12345: 7 } });
  const m2 = C.mergeLibrary(m, gone);
  assert.equal(m2.cats, undefined, "left out while empty");
  assert.equal(m2.tombs.cabc12345, 7);
  assert.equal("cats" in C.mergeLibrary(C.emptyState(), C.emptyState()), false, "an old library keeps its bytes");
});

test("CBR comics: kind, size limit, 'Comics' filter, kind back from the path", () => {
  assert.equal(C.kindOf("x.CBR"), "cbr");
  assert.equal(C.formatOf("x.cbr"), "epub");
  assert.equal(C.maxBytesOf("x.cbr"), C.MAX_COMIC);
  assert.equal(C.fmtLabel({ fmt: "epub", kind: "cbr" }), "CBR");
  const b = C.normBook({ id: B1, m: 3, fmt: "epub", title: "Comic", kind: "cbr" });
  assert.equal(b.kind, "cbr");
  // an older device dropped the kind it did not know: the path tells
  const old = C.normBook({ id: B1, m: 3, fmt: "epub", title: "Comic", path: "/internal/Books/Comic.cbr" });
  assert.equal(old.kind, "cbr");
  const s = C.mergeLibrary(Object.assign(C.emptyState(), { books: [b] }), null);
  assert.equal(C.viewBooks(s, { q: "", filter: "cbz", sort: "title" }).length, 1, "Comics shows CBR too");
  assert.equal(C.viewBooks(s, { q: "", filter: "epub", sort: "title" }).length, 0);
});

function hl(id, m, extra) {
  return Object.assign({ id, b: B1, m, k: "hl", loc: "e:1:10", end: "e:1:20", c: 1, q: "quoted" }, extra || {});
}

test("Markdown export: header with author, counts and date; place in the book; sections", () => {
  const b = C.normBook({ id: B1, m: 1, fmt: "epub", title: "Book", by: "Me" });
  const marks = [
    hl("kaaaaaa2", 1, { loc: "e:2:0", end: "e:2:5", q: "second\nline", c: 2, n: "my note", lbl: "Chapter 2", pct: 425 }),
    hl("kaaaaaa1", 1, { q: "first", lbl: "Chapter 1" }),
    { id: "kaaaaaa3", b: B1, m: 1, k: "bm", loc: "e:3:0", q: "a page", lbl: "Chapter 2", pct: 610 }
  ];
  const md = C.exportMarkdown(b, marks, "en", null, { date: "2026-10-14" });
  assert.equal(md, "# Book\n\n- Author: Me\n- Highlights: 2 · Notes: 1\n- Exported: 2026-10-14 from orOS Library\n\n" +
    "## Chapter 1\n\n> first\n\n*Green*\n\n## Chapter 2\n\n> second line\n\n*Blue · 42%*\n\nmy note\n\n🔖 Bookmark: a page · 61%\n");
  // without options: the earlier format (title, author in italics)
  assert.match(C.exportMarkdown(b, marks, "en"), /^# Book\n\n\*Me\*\n\n## Chapter 1/);
  assert.match(C.exportMarkdown(b, [], "el", null, { date: "2026-10-14" }), /- Εξαγωγή: 2026-10-14 από τη Βιβλιοθήκη του orOS\n\nΔεν υπάρχουν σημειώσεις\./);
});

test("Markdown for a Notes page: no title line, fits 20,000 characters, the rest counted", () => {
  const b = C.normBook({ id: B1, m: 1, fmt: "epub", title: "Βιβλίο", by: "Ν. Καζαντζάκης" });
  const r = C.notesMarkdown(b, [hl("kaaaaaa1", 1, { q: "πρώτο", lbl: "Α", n: "σημείωση" })], "el", { date: "2026-10-14" });
  assert.equal(r.left, 0);
  assert.equal(r.text, "- Συγγραφέας: Ν. Καζαντζάκης\n- Υπογραμμίσεις: 1 · Σημειώσεις: 1\n- Εξαγωγή: 2026-10-14 από τη Βιβλιοθήκη του orOS\n\n## Α\n\n> πρώτο\n\n*Πράσινο*\n\nσημείωση\n");
  const many = [];
  for (let i = 0; i < 300; i++) many.push(hl("k" + String(100000 + i), 1, { loc: "e:" + i + ":0", end: "e:" + i + ":5", q: "x".repeat(200) }));
  const big = C.notesMarkdown(b, many, "en", { date: "2026-10-14", max: 20000 });
  assert.ok(big.text.length <= 20000);
  assert.ok(big.left > 0);
  assert.match(big.text, new RegExp("and " + big.left + " more"));
  // Notes' own bridge takes { add: { title, text } } up to 20,000 characters (notes/notes.js)
  const src = require("fs").readFileSync(require("path").join(__dirname, "..", "notes/notes.js"), "utf8");
  assert.match(src, /t\.add\.text \|\| ""\)\.slice\(0, 20000\)/);
});
