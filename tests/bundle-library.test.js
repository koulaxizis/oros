// The .oroslibrary file (Library): the book records, reading places,
// highlights, notes, bookmarks and added catalogues through the shared
// kit (recordpkg.js) and bundle.js, never the book files; opening adds
// only what is missing, with its ids. Plus the app wiring (Save, Open,
// unzipped folder, "Open with", drop).
// Run: node --test tests/*.test.js
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const B = require(path.join(ROOT, "bundle.js"));
const K = require(path.join(ROOT, "recordpkg.js"));
const P = require(path.join(ROOT, "library/package.js"));
const C = require(path.join(ROOT, "library/core.js"));
const F = require(path.join(ROOT, "fileopen.js"));
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
const D = P.DESC;
const NOW = 1800000000000;
const clone = (x) => JSON.parse(JSON.stringify(x));

const B1 = "b0123456789abcdef", B2 = "bfedcba9876543210", B3 = "b00000000000000aa", BGONE = "b1111111111111111";
const H1 = "0123456789abcdef" + "0".repeat(48);

// The slice as sliceGet gives it (mergeLibrary canonical form).
function slice() {
  return C.mergeLibrary({
    ver: 1,
    books: [
      { id: B1, m: NOW - 900, h: H1, fmt: "epub", title: "Zorba the Greek", by: "N. Kazantzakis", year: 1946,
        path: "/internal/Books/zorba.epub", size: 400000, tags: ["novel"], added: NOW - 5000, fin: "2026-01-02" },
      { id: B2, m: NOW - 800, fmt: "pdf", title: "=HYPERLINK(\"x\")", pages: 12, path: "/internal/Books/x.pdf" }
    ],
    pos: { [B1]: { m: NOW - 700, loc: "e:3:120", pct: 455 }, [BGONE]: { m: NOW - 1, loc: "e:1:1", pct: 1 } },
    marks: [
      { id: "khl000001", m: NOW - 600, b: B1, k: "hl", loc: "e:3:10", end: "e:3:40", c: 1, q: "Boss, I said", n: "a note", lbl: "Chapter 3" },
      { id: "kbm000001", m: NOW - 500, b: B1, k: "bm", loc: "e:4:0", q: "start" },
      { id: "korphan01", m: NOW - 500, b: BGONE, k: "bm", loc: "e:1:0" }
    ],
    tombs: { [BGONE]: NOW - 100, kgone00001: NOW - 50 },
    cats: [
      { id: "cfeeds001", m: NOW - 400, url: "https://example.org/opds", name: "Mine" },
      { id: "csecret01", m: NOW - 400, url: "https://me:pw@example.org/opds" },
      { id: "csecret02", m: NOW - 400, url: "https://example.org/opds?apikey=123" }
    ],
    stats: { d: { "2026-10-01": { dev000001: 300 } }, b: { [B1]: { dev000001: 300 } } }
  }, null);
}

test("library: round trip through bundle.js; no tombstones, stats, orphans or secret catalogues; no book files", async () => {
  const o = K.pack(D, slice(), { title: "Library", lang: "en", now: NOW });
  assert.equal(o.mime, "application/x-oros-library");
  assert.deepEqual(Object.keys(o.content.data).sort(), ["books", "cats", "marks", "pos", "ver"]);
  assert.deepEqual(o.content.data.cats.map((c) => c.id), ["cfeeds001"]);
  assert.deepEqual(Object.keys(o.content.data.pos), [B1]);
  assert.deepEqual(o.content.data.marks.map((k) => k.id), ["kbm000001", "khl000001"]);
  assert.ok(!(o.files || []).length && !(o.media || []).length, "no media: never the book files");
  const bytes = await B.write(o);
  assert.equal(B.sniff(bytes.subarray(0, 128)), "application/x-oros-library");
  const r = await B.read(bytes, { mime: D.mime });
  assert.equal(r.content.kind, "oros-library-package");
  assert.deepEqual(r.content.data.books, slice().books);
  assert.ok(!JSON.stringify(r.content).includes("dev000001"), "no reading stats");
  assert.ok(!JSON.stringify(r.content).includes("pw@"), "no catalogue login");
  // previews: CSV with a formula guard, Markdown of the notes
  const csv = o.preview.find((p) => p.name === "books.csv").data;
  assert.match(csv, /^title,author,format,year,pages,progress %,finished,tags,highlights,bookmarks,notes\r\n/);
  assert.match(csv, /\r\nZorba the Greek,N\. Kazantzakis,EPUB,1946,,45,2026-01-02,novel,1,1,1\r\n/);
  assert.match(csv, /^"'=HYPERLINK\(""x""\)",,PDF,,12,0,,,0,0,0\r$/m);
  const md = o.preview.find((p) => p.name === "notes.md").data;
  assert.match(md, /^# Zorba the Greek/);
  assert.match(md, /> Boss, I said/);
  assert.match(md, /a note/);
  // into a device with one book of its own (scanned: the weak stamp 1)
  const fresh = C.mergeLibrary({ ver: 1, books: [{ id: B3, m: 1, title: "Mine", fmt: "epub" }], pos: {}, marks: [], tombs: {} }, null);
  const res = K.open(D, fresh, r.content, { now: NOW });
  assert.deepEqual(res.report, { added: 6, skipped: 0, updated: 0 });     // 2 books, 1 place, 2 marks, 1 catalogue
  const next = C.mergeLibrary(res.next, res.next);                        // what app.js stores
  assert.deepEqual(next.books.map((b) => b.id).sort(), [B3, B1, B2].sort());
  assert.deepEqual(next.pos[B1], { m: NOW - 700, loc: "e:3:120", pct: 455 });
  assert.equal(next.marks.length, 2);
  assert.equal(next.cats.length, 1);
  assert.equal(next.stats, undefined);
  // and again: nothing
  const again = K.open(D, next, r.content, { now: NOW });
  assert.equal(again.report.added, 0);
  assert.deepEqual(C.mergeLibrary(again.next, again.next), next);
});

test("library: a clash keeps the local record, a deleted one stays deleted, update takes newer", () => {
  const theirs = slice();
  theirs.books[0].title = "Changed elsewhere"; theirs.books[0].m = NOW - 10;
  theirs.pos[B1] = { m: NOW - 10, loc: "e:9:1", pct: 900 };
  theirs.marks.push({ id: "kgone00001", m: NOW - 60, b: B1, k: "bm", loc: "e:5:0" });   // deleted here
  theirs.marks.push({ id: "knew000001", m: NOW - 60, b: B1, k: "bm", loc: "e:6:0" });
  const mine = slice();
  const c = K.pack(D, theirs, { now: NOW }).content;
  const res = K.open(D, mine, c, { now: NOW });
  assert.deepEqual(res.addedIds, ["knew000001"]);
  const next = C.mergeLibrary(res.next, res.next);
  assert.equal(next.books.find((b) => b.id === B1).title, "Zorba the Greek");
  assert.equal(next.pos[B1].loc, "e:3:120");
  assert.ok(!next.marks.some((k) => k.id === "kgone00001"));
  assert.deepEqual(next.tombs, mine.tombs);
  assert.deepEqual(next.stats, mine.stats, "this device's reading time stays");
  const upd = K.open(D, mine, c, { update: true, now: NOW });
  assert.deepEqual(upd.updatedIds, [B1, B1]);                              // the book and its place
  const nu = C.mergeLibrary(upd.next, upd.next);
  assert.equal(nu.books.find((b) => b.id === B1).title, "Changed elsewhere");
  assert.equal(nu.pos[B1].loc, "e:9:1");
  assert.equal(P.kindOf(B1, nu), "book");
  assert.equal(P.kindOf("knew000001", nu), "mark");
  assert.equal(P.kindOf("cfeeds001", nu), "cat");
  assert.equal(P.kindOf("nope", nu), "");
});

test("library: hostile content is cut down", () => {
  const evil = {
    kind: "oros-library-package", ver: 1,
    data: {
      books: [
        { id: B1, m: NOW + 1e12, title: "a\u0000b" + "x".repeat(500), by: { x: 1 }, fmt: "exe", path: "/etc/passwd",
          added: NOW + 1e12, tags: ["t", 5, "t"], onclick: "alert(1)", "__proto__": { polluted: 1 }, bad_key: "x" },
        { id: "../../evil", m: NOW, title: "bad id" },
        { id: B2, m: 0, title: "no stamp" },
        "junk"
      ],
      pos: { [B1]: { m: NOW, loc: "javascript:1", pct: 5 }, "__proto__": { m: NOW, loc: "e:1:1" } },
      marks: [
        { id: "kxss00001", m: NOW, b: B1, k: "hl", loc: "e:1:9", end: "e:1:1", q: "backwards" },
        { id: "kok000001", m: NOW, b: B1, k: "hl", loc: "e:1:1", end: "e:1:9", c: 99, n: "n".repeat(10000) },
        { id: "korphan02", m: NOW, b: B2, k: "bm", loc: "e:1:1" }
      ],
      cats: [{ id: "cjs000001", m: NOW, url: "javascript:alert(1)" }, { id: "csid00001", m: NOW, url: "https://x.org/?token=abc" }],
      stats: { d: { "2026-10-01": { evil0001: 1e9 } } },
      tombs: {}
    }
  };
  const res = K.open(D, slice(), evil, { now: NOW });
  const n = C.mergeLibrary(res.next, res.next);
  assert.equal(Object.prototype.polluted, undefined);
  const b = res.next.books.find((x) => x.id === B1);
  assert.equal(b.title, "Zorba the Greek");                                 // B1 is here: kept as it is
  const fresh = K.open(D, C.emptyState(), evil, { now: NOW });
  const nb = fresh.next.books;
  assert.equal(nb.length, 1);
  assert.equal(nb[0].title.length, 200);
  assert.ok(!nb[0].title.includes("\u0000"));
  assert.equal(nb[0].m, NOW + 5 * 60 * 1000);
  assert.ok(nb[0].added <= Date.now() + 5 * 60 * 1000);
  assert.equal(nb[0].by, undefined);
  assert.equal(nb[0].fmt, "epub");
  assert.equal(nb[0].path, undefined);
  assert.deepEqual(nb[0].tags, ["t"]);
  assert.equal(nb[0].bad_key, undefined);
  assert.deepEqual(Object.keys(fresh.next.pos), []);
  assert.deepEqual(fresh.next.marks.map((k) => k.id), ["kok000001"]);
  assert.equal(fresh.next.marks[0].c, 0);
  assert.equal(fresh.next.marks[0].n.length, 4000);
  assert.ok(!(fresh.next.cats || []).length, "no unsafe catalogue");
  assert.equal(fresh.next.stats, undefined);
  assert.ok(n.books.length >= 2);
  assert.equal(P.safeCatUrl("https://a.org/opds?q=x"), true);
  assert.equal(P.safeCatUrl("https://u@a.org/"), false);
  assert.equal(P.safeCatUrl("https://a.org/x?access_token=1"), false);
  assert.throws(() => K.open(D, slice(), { kind: "oros-todo-package", ver: 1, data: {} }), /notpackage/);
  assert.equal(D.norm("x"), null);
});

test("library: wiring (scripts, menu, Open with, drop, Undo, help, file types)", () => {
  const html = read("library/index.html");
  ["core.js?v=", "../bundle.js?v=", "../recordpkg.js?v=", "package.js?v=", "app.js?v="].forEach((s) =>
    assert.ok(html.includes('src="' + s), s));
  assert.ok(html.indexOf('src="core.js') < html.indexOf('src="package.js'));
  assert.ok(html.indexOf("recordpkg.js") < html.indexOf('src="app.js'));
  assert.ok(html.indexOf('src="package.js') < html.indexOf('src="app.js'));
  const js = read("library/app.js");
  assert.match(js, /RP\.ui\(LPK\.DESC,/);
  ["openFile", "__orosTakeFile(", "window.__orosOpenAt =", '__orosTakeTarget("library")', "deleteIds:", "LIB.takeRecordFile(file)"]
    .forEach((s) => assert.ok(js.includes(s), s));
  assert.equal(js.split("window.__orosOpenAt =").length, 2);
  const home = read("library/home.js");
  ["LIB.recFile.save()", "LIB.recFile.open()", "LIB.recFile.openFolder()", "LIB.takeRecordFile(rec[0])"]
    .forEach((s) => assert.ok(home.includes(s), s));
  const str = read("library/strings.js");
  assert.ok(str.includes('"more.osave": "orOS file (.oroslibrary)", "more.oopen": "Open orOS file…", "more.ofolder": "Unzipped orOS folder…"'));
  assert.ok(str.includes('"more.osave": "Αρχείο orOS (.oroslibrary)", "more.oopen": "Άνοιγμα αρχείου orOS…", "more.ofolder": "Αποσυμπιεσμένος φάκελος orOS…"'));
  for (const f of ["library/help.en.txt", "library/help.el.txt"]) assert.ok(read(f).includes(".oroslibrary"), f);
  const heads = (f) => read(f).split("\n").filter((l) => /^#/.test(l)).length;
  assert.equal(heads("library/help.en.txt"), heads("library/help.el.txt"));
  assert.deepEqual(F.appsFor(".oroslibrary"), ["library"]);
  assert.deepEqual(B.TYPES[".oroslibrary"], { app: "library", mime: "application/x-oros-library" });
});
