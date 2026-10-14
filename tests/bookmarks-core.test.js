// Bookmarks wave 35: nested folders (effective tree, cycle guard,
// moves), address keys + duplicate merge, link-check verdicts, side
// records that merge on their own, Netscape export/import with TAGS
// and <DD>, Pocket (HTML, CSV) and Raindrop (CSV, HTML) imports, the
// saved-copy file format. bookmarks/core.js is pure.
// Run: node --test tests/
const test = require("node:test");
const assert = require("node:assert/strict");
const C = require("../bookmarks/core.js");

function F(list) {
  const o = { unsorted: { id: "unsorted", name: "unsorted", pos: 0, modified: 0 } };
  list.forEach((f, i) => { o[f[0]] = { id: f[0], name: f[0].toUpperCase(), pos: f[2] != null ? f[2] : i + 1, modified: 1 }; if (f[1]) o[f[0]].parent = f[1]; });
  return o;
}

test("tree: old flat folders are all top level, unchanged", () => {
  const fs = F([["a"], ["b"], ["c"]]);
  assert.deepEqual(C.childrenOf(fs, ""), ["unsorted", "a", "b", "c"]);
  assert.equal(C.parentOf(fs, "a"), "");
  assert.deepEqual(C.treeList(fs).map((x) => x.id + x.depth), ["unsorted0", "a0", "b0", "c0"]);
});

test("tree: nesting, paths, depth-first list", () => {
  const fs = F([["a"], ["b", "a"], ["c", "b"], ["d", "a"]]);
  assert.deepEqual(C.pathIds(fs, "c"), ["a", "b", "c"]);
  assert.deepEqual(C.childrenOf(fs, "a"), ["b", "d"]);
  assert.deepEqual(C.treeList(fs).map((x) => x.id + x.depth), ["unsorted0", "a0", "b1", "c2", "d1"]);
  assert.deepEqual(C.treeList(fs, "b").map((x) => x.id), ["unsorted", "a", "d"]);
  assert.equal(C.isInside(fs, "c", "a"), true);
  assert.equal(C.isInside(fs, "a", "c"), false);
});

test("tree: missing parent, the root folder or itself as parent = top level", () => {
  const fs = F([["a", "gone"], ["b", "unsorted"], ["c", "c"]]);
  assert.equal(C.parentOf(fs, "a"), "");
  assert.equal(C.parentOf(fs, "b"), "");
  assert.equal(C.parentOf(fs, "c"), "");
  fs.unsorted.parent = "a";
  assert.equal(C.parentOf(fs, "unsorted"), "");
});

test("cycle guard: a loop from two devices breaks at its smallest id, same on both", () => {
  const fs = F([["x", "y"], ["y", "x"], ["z", "y"]]);
  assert.equal(C.parentOf(fs, "x"), "");     // smallest of the loop
  assert.equal(C.parentOf(fs, "y"), "x");
  assert.equal(C.parentOf(fs, "z"), "y");
  assert.deepEqual(C.pathIds(fs, "z"), ["x", "y", "z"]);
  assert.deepEqual(C.treeList(fs).map((x) => x.id + x.depth), ["unsorted0", "x0", "y1", "z2"]);
  const three = F([["p", "r"], ["q", "p"], ["r", "q"]]);
  assert.deepEqual(C.treeList(three).map((x) => x.id + x.depth), ["unsorted0", "p0", "q1", "r2"]);
});

test("canMoveFolder: never into itself, below itself, or into Unsorted", () => {
  const fs = F([["a"], ["b", "a"], ["c", "b"], ["d"]]);
  assert.equal(C.canMoveFolder(fs, "a", "c"), false);
  assert.equal(C.canMoveFolder(fs, "a", "a"), false);
  assert.equal(C.canMoveFolder(fs, "a", "unsorted"), false);
  assert.equal(C.canMoveFolder(fs, "unsorted", "a"), false);
  assert.equal(C.canMoveFolder(fs, "c", "d"), true);
  assert.equal(C.canMoveFolder(fs, "c", ""), true);
  assert.equal(C.canMoveFolder(fs, "a", "nope"), false);
});

test("dupeKey: scheme, www, case, port, fragment, slash, trackers and query order", () => {
  const k = C.dupeKey("https://www.Example.com:443/a/?utm_source=x&b=2&a=1#top");
  assert.equal(k, "example.com/a?a=1&b=2");
  assert.equal(C.dupeKey("http://example.com/a?b=2&a=1&fbclid=Z"), k);
  assert.notEqual(C.dupeKey("https://example.com/a?a=2&b=2"), k);
  assert.notEqual(C.dupeKey("https://example.com/A"), C.dupeKey("https://example.com/a"));
  assert.equal(C.dupeKey("example.com/"), "example.com");
});

test("normUrl: http(s) only, scheme added", () => {
  assert.equal(C.normUrl("example.com/x/"), "https://example.com/x");
  assert.equal(C.normUrl("javascript:alert(1)"), null);
  assert.equal(C.normUrl("ftp://x"), null);
  assert.equal(C.normUrl(""), null);
});

test("dupeGroups + mergeInto: oldest kept, tags, notes, star, visits joined", () => {
  const items = {
    b: { id: "b", url: "https://x.org/p?utm_medium=m", added: 20, tags: ["Two", "one"], note: "second", fav: true, visits: 2, lastVisit: 9 },
    a: { id: "a", url: "http://www.x.org/p/", added: 10, tags: ["one"], note: "first", fav: false, visits: 1, lastVisit: 5,
         chk: { s: "dead", at: 3 } },
    c: { id: "c", url: "https://other.org", added: 1, tags: [], note: "" }
  };
  const g = C.dupeGroups(items);
  assert.equal(g.length, 1);
  assert.deepEqual(g[0].map((x) => x.id), ["a", "b"]);
  const m = C.mergeInto(g[0][0], g[0].slice(1));
  assert.deepEqual(m.tags, ["one", "Two"]);
  assert.equal(m.note, "first\n\nsecond");
  assert.equal(m.fav, true);
  assert.equal(m.visits, 3);
  assert.equal(m.lastVisit, 9);
  assert.deepEqual(m.chk, { s: "dead", at: 3 });
});

test("classify: dead, moved, ok, not proven", () => {
  const u = "https://example.com/a";
  assert.deepEqual(C.classify(u, { status: 404 }), { s: "dead", code: 404 });
  assert.deepEqual(C.classify(u, { status: 410 }), { s: "dead", code: 410 });
  assert.deepEqual(C.classify(u, { status: 200, finalUrl: "https://www.example.com/a/" }), { s: "ok", code: 200 });
  assert.deepEqual(C.classify(u, { status: 200, finalUrl: "https://example.org/b" }), { s: "moved", code: 200, to: "https://example.org/b" });
  assert.deepEqual(C.classify(u, { status: 403 }), { s: "err", code: 403 });
  assert.deepEqual(C.classify(u, { status: 503 }), { s: "err", code: 503 });
  assert.deepEqual(C.classify(u, { err: "network" }), { s: "dead", code: 0 });
  assert.deepEqual(C.classify(u, { err: "type" }), { s: "ok" });
  assert.deepEqual(C.classify(u, { err: "host" }), { s: "skip" });
  assert.deepEqual(C.classify(u, { err: "timeout" }), { s: "err" });
});

test("side records: sanitised, newest at wins, symmetric", () => {
  assert.equal(C.sanChk({ s: "weird", at: 5 }), null);
  assert.equal(C.sanChk({ s: "ok" }), null);
  assert.deepEqual(C.sanChk({ s: "moved", at: 5, to: "javascript:x" }), { s: "ok", at: 5 });
  assert.deepEqual(C.sanChk({ s: "moved", at: 5, code: 200, to: "https://a.b/c", x: 1 }), { s: "moved", at: 5, code: 200, to: "https://a.b/c" });
  assert.deepEqual(C.sanArch({ at: 7, f: "../x.html" }), { at: 7, f: "" });
  assert.deepEqual(C.sanArch({ at: 7, f: "Page [abc].html", n: 120, img: 1 }), { at: 7, f: "Page [abc].html", n: 120, img: 1 });
  const a = { s: "ok", at: 5 }, b = { s: "dead", at: 6 }, c = { s: "err", at: 6 };
  assert.equal(C.sideMerge(a, b), b);
  assert.equal(C.sideMerge(b, a), b);
  assert.equal(C.sideMerge(null, a), a);
  assert.deepEqual(C.sideMerge(b, c), C.sideMerge(c, b));
});

test("CSV: quotes, commas and newlines inside cells, BOM, CRLF", () => {
  const rows = C.parseCsv("﻿a,b,c\r\n\"x, y\",\"he said \"\"hi\"\"\",\"two\nlines\"\r\n");
  assert.deepEqual(rows, [["a", "b", "c"], ["x, y", "he said \"hi\"", "two\nlines"]]);
});

test("Netscape: nested folders, TAGS, ADD_DATE, <DD> description, entities", () => {
  const html = `<!DOCTYPE NETSCAPE-Bookmark-file-1>
<DL><p>
  <DT><H3>Work &amp; Life</H3>
  <DL><p>
    <DT><H3>Docs</H3>
    <DL><p>
      <DT><A HREF="https://a.example/x?a=1&amp;b=2" ADD_DATE="1700000000" TAGS="js,web">A &lt;title&gt;</A>
      <DD>Line one<br>line two
      <DT><A HREF="https://b.example/">B</A>
    </DL><p>
    <DT><A HREF="https://c.example/" ADD_DATE="1700000000000000">C</A>
  </DL><p>
  <DT><A HREF="https://d.example/">D</A>
</DL><p>`;
  const e = C.parseNetscape(html);
  assert.equal(e.length, 4);
  assert.equal(e[0].url, "https://a.example/x?a=1&b=2");
  assert.equal(e[0].title, "A <title>");
  assert.deepEqual(e[0].path, ["Work & Life", "Docs"]);
  assert.deepEqual(e[0].tags, ["js", "web"]);
  assert.equal(e[0].note, "Line one\nline two");
  assert.equal(e[0].added, 1700000000000);
  assert.equal(e[1].note, "");
  assert.deepEqual(e[2].path, ["Work & Life"]);
  assert.equal(e[2].added, 1700000000000);
  assert.deepEqual(e[3].path, []);
});

test("Netscape: export then import gives the same tree, tags and notes", () => {
  const tree = {
    items: [{ url: "https://top.example/", title: "Top", tags: [], note: "", added: 1700000000000 }],
    folders: [{ name: "Outer <1>", items: [{ url: "https://o.example/?q=\"x\"", title: "O & co", tags: ["a,b", "c"], note: "n1\nn2", added: 1700000001000, modified: 1700000002000 }],
                folders: [{ name: "Inner", items: [{ url: "https://i.example/", title: "I", tags: [], note: "", added: 0 }], folders: [] }] }]
  };
  const out = C.buildNetscape(tree);
  assert.equal(out.count, 3);
  assert.match(out.text, /TAGS="a b,c"/);
  assert.match(out.text, /<DD>n1<br>n2/);
  const back = C.parseImport(out.text, "x.html");
  assert.equal(back.kind, "netscape");
  const by = Object.fromEntries(back.entries.map((x) => [x.title, x]));
  assert.deepEqual(by.Top.path, []);
  assert.deepEqual(by["O & co"].path, ["Outer <1>"]);
  assert.equal(by["O & co"].url, "https://o.example/?q=\"x\"");
  assert.deepEqual(by["O & co"].tags, ["a b", "c"]);
  assert.equal(by["O & co"].note, "n1\nn2");
  assert.equal(by["O & co"].added, 1700000001000);
  assert.deepEqual(by.I.path, ["Outer <1>", "Inner"]);
});

test("Pocket HTML: unread to Pocket, archive below it, tags and dates", () => {
  const html = `<!DOCTYPE html><html><head><title>Pocket Export</title></head><body>
<h1>Unread</h1><ul><li><a href="https://p.example/1" time_added="1600000000" tags="read,later">One</a></li></ul>
<h1>Read Archive</h1><ul><li><a href="https://p.example/2" time_added="1600000001" tags="">Two</a></li></ul></body></html>`;
  const r = C.parseImport(html, "ril_export.html", { pocket: "Pocket", archive: "Archive" });
  assert.equal(r.kind, "pocket");
  assert.deepEqual(r.entries.map((x) => x.path.join("/")), ["Pocket", "Pocket/Archive"]);
  assert.deepEqual(r.entries[0].tags, ["read", "later"]);
  assert.equal(r.entries[0].added, 1600000000000);
});

test("Pocket CSV: tags split by |, status archive", () => {
  const csv = "title,url,time_added,tags,status\nHello,https://p.example/a,1600000000,x|y,unread\n\"Comma, title\",https://p.example/b,1600000005,,archive\n";
  const r = C.parseImport(csv, "part_000000.csv", { pocket: "Pocket", archive: "Archiv" });
  assert.equal(r.kind, "pocket");
  assert.equal(r.entries.length, 2);
  assert.deepEqual(r.entries[0].tags, ["x", "y"]);
  assert.deepEqual(r.entries[1].path, ["Pocket", "Archiv"]);
  assert.equal(r.entries[1].title, "Comma, title");
});

test("Raindrop CSV: folders (nested by /), tags, note else excerpt, created, favorite", () => {
  const csv = "id,title,note,excerpt,url,folder,tags,created,cover,highlights,favorite\n" +
    "1,R1,My note,An excerpt,https://r.example/1,Dev / Tools,\"js, css\",2023-01-05T10:00:00.000Z,,,true\n" +
    "2,R2,,Only excerpt,https://r.example/2,Unsorted,,2023-01-06T10:00:00.000Z,,,false\n";
  const r = C.parseImport(csv, "export.csv");
  assert.equal(r.kind, "raindrop");
  assert.deepEqual(r.entries[0].path, ["Dev", "Tools"]);
  assert.deepEqual(r.entries[0].tags, ["js", "css"]);
  assert.equal(r.entries[0].note, "My note");
  assert.equal(r.entries[0].fav, true);
  assert.equal(r.entries[0].added, Date.parse("2023-01-05T10:00:00.000Z"));
  assert.deepEqual(r.entries[1].path, []);
  assert.equal(r.entries[1].note, "Only excerpt");
  assert.equal(r.entries[1].fav, false);
});

test("Raindrop HTML is a Netscape file", () => {
  const html = "<!DOCTYPE NETSCAPE-Bookmark-file-1><!-- raindrop --><DL><p><DT><H3>Col</H3><DL><p>" +
    "<DT><A HREF=\"https://r.example/\" ADD_DATE=\"1690000000\" TAGS=\"a,b\" DATA-IMPORTANT=\"true\">R</A><DD>Note</DL><p></DL><p>";
  const r = C.parseImport(html, "raindrop.html");
  assert.equal(r.entries.length, 1);
  assert.deepEqual(r.entries[0].path, ["Col"]);
  assert.equal(r.entries[0].note, "Note");
  assert.equal(r.entries[0].fav, true);
});

test("import: unknown text gives nothing", () => {
  assert.deepEqual(C.parseImport("hello world", "x.txt").entries, []);
  assert.deepEqual(C.parseImport("a,b\n1,2", "x.csv").entries, []);
});

test("saved copy: file name, id back, document round trip", () => {
  const it = { id: "abc-123", title: "Ελληνικά & Café: a/b?" };
  const name = C.archiveName(it);
  assert.match(name, /^[A-Za-z0-9-]+ \[abc-123\]\.html$/);
  assert.equal(C.archiveId(name), "abc-123");
  assert.equal(C.archiveId("other.html"), "");
  assert.deepEqual(C.sanArch({ at: 1, f: name }).f, name);
  const doc = C.archiveDoc({ id: "abc-123", url: "https://e.example/?a=1&b=\"2\"", title: "T <x>", at: 1700000000000, html: "<p>Hi</p>", img: 0 });
  assert.match(doc, /img-src data:"/);
  const back = C.readArchive(doc);
  assert.equal(back.id, "abc-123");
  assert.equal(back.url, "https://e.example/?a=1&b=\"2\"");
  assert.equal(back.title, "T <x>");
  assert.equal(back.at, 1700000000000);
  assert.equal(back.html, "<p>Hi</p>");
  assert.equal(C.readArchive("<html>nothing</html>"), null);
});
