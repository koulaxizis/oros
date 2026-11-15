// Writer book translation, pure part (writer/catcore.js, WR-CAT T1):
// cutting a document into segments with numbered tags, building the
// translated document back with the source's markup, the per-device
// rows and their merge, progress, and reading files from the disk.
// Run: node --test tests/

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const C = require(path.join(__dirname, "..", "writer/catcore.js"));

const BOOK = {
  title: "The Sea",
  html: '<h1>Chapter <i>One</i></h1>' +
    '<p style="text-align:justify">Hello <b>big world</b>. Dr. Smith came.<sup class="fn-ref" data-fn="f1">1</sup> He said: <i>no. Never.</i> The end</p>' +
    '<p><img src="data:image/png;base64,AA" style="width:50px"> A picture.</p>' +
    '<ul><li>One. Two<ul><li>Inner</li></ul></li></ul>' +
    '<p>Line one<br>Line two</p>' +
    '<table><tr><th>Head</th><td>  </td></tr></table>' +
    '<div class="page-break-marker"></div>' +
    '<h2>Two</h2><p>Tom &amp; Jerry&nbsp;ran. <a href="https://example.org">A link</a>.</p>',
  header: "Running head",
  footer: "",
  footnotes: [{ id: "f1", text: "A note. Second line." }]
};

function texts(src) { return src.segs.map(s => s.s); }

test("extract: one segment per sentence, tags numbered per segment", () => {
  const src = C.extract(BOOK, "en");
  assert.deepEqual(texts(src), [
    "The Sea",
    "Chapter ⟦1⟧One⟦/1⟧",
    "Hello ⟦1⟧big world⟦/1⟧.",
    "Dr. Smith came.",
    "He said: ⟦1⟧no. Never.⟦/1⟧",
    "The end",
    "A picture.",
    "One.", "Two", "Inner",
    "Line one", "Line two",
    "Head",
    "Two",
    "Tom & Jerry ran.",
    "⟦1⟧A link⟦/1⟧.",
    "Running head",
    "A note.", "Second line."
  ]);
  // the footnote number sits between two sentences: kept between them
  const dr = src.segs[3];
  assert.equal(dr.sep, '<sup class="fn-ref" data-fn="f1">1</sup> ');
  // a picture at the start of a paragraph is not part of its text
  assert.equal(src.blocks[src.segs[6].b].lead, '<img src="data:image/png;base64,AA" style="width:50px"> ');
  // headings carry their level, for chapters
  assert.equal(src.blocks[src.segs[1].b].h, 1);
  assert.deepEqual(C.chapters(src).map(c => c.title), ["Chapter One", "Two"]);
  assert.equal(src.segs[2].w, 3);
});

test("build with no translations gives the source back, byte for byte", () => {
  const src = C.extract(BOOK, "en");
  const out = C.build(src, {});
  assert.equal(out.html, BOOK.html);
  assert.equal(out.title, BOOK.title);
  assert.equal(out.header, BOOK.header);
  assert.deepEqual(out.footnotes, BOOK.footnotes);
  // through JSON (as src.json on the disk) too
  const back = C.readSrc(JSON.parse(JSON.stringify(src)));
  assert.equal(C.build(back, {}).html, BOOK.html);
});

test("build puts the source's markup around the translated words", () => {
  const src = C.extract(BOOK, "en");
  const at = s => texts(src).indexOf(s);
  const rows = {};
  rows[at("Hello ⟦1⟧big world⟦/1⟧.")] = ["Γεια σου, ⟦1⟧μεγάλε κόσμε⟦/1⟧.", 2, 10];
  rows[at("He said: ⟦1⟧no. Never.⟦/1⟧")] = ["Είπε: ⟦1⟧όχι. Ποτέ.⟦/1⟧", 2, 10];
  rows[at("⟦1⟧A link⟦/1⟧.")] = ["Ένας ⟦1⟧σύνδεσμος⟦/1⟧ <script>.", 2, 10];
  rows[at("A note.")] = ["Μια σημείωση.", 2, 10];
  rows[at("The Sea")] = ["Η θάλασσα", 2, 10];
  const out = C.build(src, rows);
  assert.match(out.html, /<p style="text-align:justify">Γεια σου, <b>μεγάλε κόσμε<\/b>\. Dr\. Smith came\.<sup class="fn-ref" data-fn="f1">1<\/sup> Είπε: <i>όχι\. Ποτέ\.<\/i> The end<\/p>/);
  // typed markup is text, never html
  assert.match(out.html, /Ένας <a href="https:\/\/example.org">σύνδεσμος<\/a> &lt;script&gt;\./);
  assert.equal(out.title, "Η θάλασσα");
  assert.deepEqual(out.footnotes, [{ id: "f1", text: "Μια σημείωση. Second line." }]);
  // blank: untranslated segments are left empty
  const blank = C.build(src, rows, { blank: true });
  assert.ok(!/Line one/.test(blank.html));
});

test("segOut: wrong, missing, crossed and doubled tags never break the book", () => {
  const doc = { html: '<p>A <b>bold</b> and <i>it</i> word<sup class="fn-ref" data-fn="x">1</sup> here</p>' };
  const src = C.extract(doc, "en");
  assert.equal(src.segs.length, 1);
  assert.equal(src.segs[0].s, "A ⟦1⟧bold⟦/1⟧ and ⟦2⟧it⟦/2⟧ word⟦3/⟧ here");
  const o = t => C.segOut(src, 0, t);
  // the footnote number was dropped: it comes back at the end
  assert.equal(o("Ένα ⟦1⟧έντονο⟦/1⟧"), 'Ένα <b>έντονο</b><sup class="fn-ref" data-fn="x">1</sup>');
  // twice: once only
  assert.equal(o("x⟦3/⟧ y⟦3/⟧"), 'x<sup class="fn-ref" data-fn="x">1</sup> y');
  // crossed pairs come out nested
  assert.equal(o("⟦1⟧a⟦2⟧b⟦/1⟧c⟦/2⟧⟦3/⟧"), '<b>a<i>b</i></b><i>c</i><sup class="fn-ref" data-fn="x">1</sup>');
  // an unknown number or a wrong kind is dropped (never left in the book)
  assert.equal(o("⟦9⟧z ⟦1/⟧⟦3/⟧"), 'z <sup class="fn-ref" data-fn="x">1</sup>');
  // and so are marks typed into a segment that has no tags at all
  const h = C.extract({ html: "<h1>Plain title</h1>" }, "en");
  assert.equal(C.build(h, { 0: ["Τίτλος ⟦1⟧μόνο⟦/1⟧", 2, 5] }).html, "<h1>Τίτλος μόνο</h1>");
  // a pair left open closes at the end; a lone closer is dropped
  assert.equal(o("⟦/2⟧⟦1⟧open⟦3/⟧"), '<b>open<sup class="fn-ref" data-fn="x">1</sup></b>');
  assert.deepEqual(C.checkTags(src, 0, "⟦1⟧a⟦/1⟧"), { missing: [2, 3], twice: [], order: false });
  assert.deepEqual(C.checkTags(src, 0, "⟦1⟧a⟦2⟧⟦/1⟧⟦/2⟧⟦3/⟧⟦3/⟧"), { missing: [], twice: [3], order: true });
});

test("a pair across two sentences keeps them in one segment", () => {
  const src = C.extract({ html: "<p>One. <b>Two. Three.</b> Four.</p>" }, "en");
  assert.deepEqual(texts(src), ["One.", "⟦1⟧Two. Three.⟦/1⟧", "Four."]);
  const src2 = C.extract({ html: "<p>One <b>two. Three</b> four.</p>" }, "en");
  assert.deepEqual(texts(src2), ["One ⟦1⟧two. Three⟦/1⟧ four."]);
  assert.equal(C.build(src2, {}).html, "<p>One <b>two. Three</b> four.</p>");
});

test("sentences: Greek question mark, abbreviations, initials, numbers", () => {
  const g = C.extract({ html: "<p>Πού πας; Στο σπίτι. Π.χ. αύριο. Ο κ. Παπάς ήρθε.</p>" }, "el");
  assert.deepEqual(texts(g), ["Πού πας;", "Στο σπίτι.", "Π.χ. αύριο.", "Ο κ. Παπάς ήρθε."]);
  const e = C.extract({ html: "<p>J. R. R. Tolkien wrote it. It cost 3.50 euros. Really?! Yes…</p>" }, "en");
  assert.deepEqual(texts(e), ["J. R. R. Tolkien wrote it.", "It cost 3.50 euros.", "Really?!", "Yes…"]);
});

test("tracked deletions are left out, insertions and comment marks unwrapped", () => {
  const src = C.extract({ html: '<p><del class="tc" data-tc="1">old </del>New <ins class="tc" data-tc="2">text</ins> <mark class="cmt-mark" data-cmt="c">here</mark>.</p>' }, "en");
  assert.deepEqual(texts(src), ["New text here."]);
  assert.equal(C.build(src, {}).html, "<p>New text here.</p>");
});

test("nothing to translate: no segments, the html is kept", () => {
  const html = '<p><br></p><p><img src="a.png"></p><hr><pre>code. More.</pre><p>  </p>';
  const src = C.extract({ html: html }, "en");
  assert.equal(src.segs.length, 0);
  assert.equal(C.build(src, {}).html, html);
});

test("source characters that look like tags or markers stay harmless", () => {
  const src = C.extract({ html: "<p>Odd ⟦1⟧ text5 here.</p>" }, "en");
  assert.deepEqual(texts(src), ["Odd [1] text5 here."]);
});

test("mergeRows: the newer stamp wins per segment, in any order (a join)", () => {
  const a = { 0: ["A", 2, 100], 1: ["B", 1, 50], 2: ["bad", 9, 0] };
  const b = { 0: ["A2", 1, 90], 1: ["B2", 2, 60], 3: ["D", 3, 10], x: ["no", 1, 5] };
  const c = { 1: ["B3", 2, 60] };
  const ab = C.mergeRows([a, b, c]);
  assert.deepEqual(ab, { 0: ["A", 2, 100], 1: ["B3", 2, 60], 3: ["D", 3, 10] });
  assert.deepEqual(C.mergeRows([c, b, a]), ab);
  assert.deepEqual(C.mergeRows([ab, ab]), ab);
  // a row that is too long is cut, a bad status reads as new
  const long = C.mergeRows([{ 0: ["x".repeat(C.MAX_TEXT + 5), 7, 1] }]);
  assert.equal(long[0][0].length, C.MAX_TEXT);
  assert.equal(long[0][1], 0);
});

test("rows files: names, chunks, only the chunk's own rows are read", () => {
  assert.deepEqual(C.rowsName("rows-abc123-0.json"), { dev: "abc123", chunk: 0 });
  assert.equal(C.rowsName("rows-AB-0.json"), null);
  assert.equal(C.rowsName("rows-abc123-x.json"), null);
  assert.equal(C.metaName("meta-abc123.json"), "abc123");
  assert.equal(C.chunkOf(199), 0);
  assert.equal(C.chunkOf(200), 1);
  const f = C.rowsFile("abc123", { 205: ["b", 2, 3], 201: ["a", 1, 2] });
  assert.deepEqual(Object.keys(f.r), ["201", "205"]);
  assert.deepEqual(C.readRowsFile(JSON.parse(JSON.stringify(f)), "abc123", 1), { 201: ["a", 1, 2], 205: ["b", 2, 3] });
  assert.deepEqual(C.readRowsFile(f, "abc123", 0), {});
  assert.deepEqual(C.readRowsFile({ v: 2, r: {} }, "abc123", 0), {});
  assert.deepEqual(C.readRowsFile(null, "abc123", 0), {});
});

test("mergeMeta: name and translated document, newer wins per field", () => {
  const m = C.mergeMeta([{ name: "A", nm: 5, out: "d1", om: 2 }, { name: "B", nm: 7 }, { out: "d2", om: 1 }, null, { name: 3, nm: 9 }]);
  assert.deepEqual(m, { name: "B", nm: 7, out: "d1", om: 2, tm: "", tmm: 0, gl: "", glm: 0 });
  assert.equal(C.mergeMeta([{ tm: "tmaaaaaa1", tmm: 3 }, { tm: "tmbbbbbb2", tmm: 4 }]).tm, "tmbbbbbb2");
});

test("stats and repeats", () => {
  const src = C.extract({ html: "<p>Yes. No. Yes.</p><p>Maybe so.</p>" }, "en");
  const st = C.stats(src, { 0: ["Ναι.", 2, 1], 1: ["Όχι.", 1, 1], 3: ["Ίσως.", 3, 1], 2: ["  ", 2, 1] });
  // a segment marked translated with no text is empty on purpose (joined)
  assert.deepEqual(st, { segs: 4, words: 5, done: 3, doneWords: 4, draft: 1, reviewed: 1, pct: 80 });
  assert.equal(C.build(src, { 0: ["Ναι, όχι.", 2, 1], 1: ["", 2, 1], 2: ["", 1, 1] }).html, "<p>Ναι, όχι. Yes.</p><p>Maybe so.</p>");
  assert.deepEqual(C.repeats(src), { 2: 0 });
});

test("readSrc and readProject refuse what is not theirs", () => {
  assert.equal(C.readSrc(null), null);
  assert.equal(C.readSrc({ v: 1, tpl: "", blocks: [{ k: "x", lead: "", trail: "", tags: [] }], segs: [] }), null);
  assert.equal(C.readSrc({ v: 1, tpl: "", blocks: [], segs: [{ b: 0, s: "a", t: [] }] }), null);
  const s = C.readSrc({ v: 1, tpl: "0", blocks: [{ k: "h", lead: "", trail: "", tags: [["p", "<b>", "</b>", "b"], "junk"] }],
    segs: [{ b: 0, s: "⟦1⟧a⟦/1⟧", t: [0, 5, 1.5], sep: 3, w: "2" }] });
  assert.deepEqual(s.segs[0], { b: 0, s: "⟦1⟧a⟦/1⟧", t: [0], sep: "", w: 2 });
  assert.deepEqual(s.blocks[0].tags[1], ["v", "", "", ""]);
  assert.equal(C.build(s, {}).html, "<b>a</b>");
  assert.equal(C.readProject({ v: 1, id: "../x" }), null);
  const p = C.readProject({ v: 1, id: C.newId(1700000000000, 0.5), name: "N", from: "en", to: "el-GR", at: 5, src: "d" });
  assert.equal(p.to, "el-GR");
  assert.equal(C.readProject({ v: 1, id: "trabcdefg", from: "english" }).from, "");
  assert.match(C.newId(1700000000000, 0.123), C.ID_RX);
});

// ---------- the disk (writer/catstore.js) with a fake orosFS ----------
const S = require(path.join(__dirname, "..", "writer/catstore.js"));
function fakeFs() {
  const files = new Map();
  let clock = 1;
  const norm = p => p.replace(/\/+$/, "");
  const api = {
    files,
    writeText(p, t) { files.set(norm(p), { data: String(t), mtime: clock++ }); return Promise.resolve(); },
    write(p, b) { files.set(norm(p), { data: b, mtime: clock++ }); return Promise.resolve(); },
    readText(p) { const f = files.get(norm(p)); return f ? Promise.resolve(String(f.data)) : Promise.reject(Object.assign(new Error("ENOENT"), { code: "ENOENT" })); },
    stat(p) { const f = files.get(norm(p)); return f ? Promise.resolve({ path: p, dir: false, size: String(f.data).length, mtime: f.mtime }) : Promise.reject(new Error("ENOENT")); },
    ls(dir) {
      dir = norm(dir) + "/";
      const seen = new Map();
      for (const k of files.keys()) {
        if (!k.startsWith(dir)) continue;
        const rest = k.slice(dir.length), i = rest.indexOf("/");
        seen.set(i < 0 ? rest : rest.slice(0, i), i >= 0);
      }
      return Promise.resolve([...seen].sort().map(([name, d]) => ({ name, dir: d })));
    },
    mv(a, b) {
      a = norm(a); b = norm(b);
      for (const k of [...files.keys()]) if (k === a || k.startsWith(a + "/")) { files.set(b + k.slice(a.length), files.get(k)); files.delete(k); }
      return Promise.resolve();
    },
    rm(p) { p = norm(p); for (const k of [...files.keys()]) if (k === p || k.startsWith(p + "/")) files.delete(k); return Promise.resolve(); }
  };
  return api;
}

test("store: create, list, open; two devices merge per segment, never the same file", async () => {
  const fs = fakeFs();
  let t = 1000;
  const A = new S.Store(fs, "deva01", () => t), B = new S.Store(fs, "devb02", () => t);
  const data = C.extract(BOOK, "en");
  const p = await A.create({ name: "The Sea", from: "en", to: "el", src: "doc1", data, orig: "bytes", origName: "sea.DOCX" });
  assert.ok(fs.files.has(S.dirOf(p.id) + "/original.docx"));
  assert.deepEqual((await B.list()).map(x => x.name), ["The Sea"]);
  const a = await A.open(p.id), b = await B.open(p.id);
  assert.equal(a.src.segs.length, data.segs.length);
  t = 2000; await A.saveRows(p.id, { 1: ["Κεφάλαιο ⟦1⟧Ένα⟦/1⟧", 2, 2000], 250: ["far", 1, 2000] });
  t = 3000; await B.saveRows(p.id, { 1: ["Κεφάλαιο ⟦1⟧Πρώτο⟦/1⟧", 2, 3000], 2: ["Γεια", 1, 3000] });
  const names = [...fs.files.keys()].map(k => k.split("/").pop()).filter(n => n.startsWith("rows-")).sort();
  assert.deepEqual(names, ["rows-deva01-0.json", "rows-deva01-1.json", "rows-devb02-0.json"]);
  const ra = await A.reload(p.id), rb = await B.reload(p.id);
  assert.deepEqual(ra.rows, rb.rows);
  assert.equal(ra.rows[1][0], "Κεφάλαιο ⟦1⟧Πρώτο⟦/1⟧");
  assert.equal(ra.rows[250][0], "far");
  // A edits again later: its own file now carries the newer row
  t = 4000; await A.saveRows(p.id, { 1: ["Κεφάλαιο Α", 3, 4000] });
  assert.equal((await B.reload(p.id)).rows[1][0], "Κεφάλαιο Α");
  // the signature moves when another device writes
  const s1 = await A.sig(p.id);
  t = 5000; await B.saveRows(p.id, { 3: ["x", 1, 5000] });
  assert.notEqual(await A.sig(p.id), s1);
});

test("store: a second window of the same device never drops the other's rows", async () => {
  const fs = fakeFs();
  const W1 = new S.Store(fs, "deva01"), W2 = new S.Store(fs, "deva01");
  const p = await W1.create({ name: "N", from: "en", to: "el", data: C.extract(BOOK, "en") });
  await W1.open(p.id); await W2.open(p.id);
  await W1.saveRows(p.id, { 0: ["one", 2, 10] });
  await W2.saveRows(p.id, { 2: ["two", 2, 11] });   // W2 never saw row 0
  const rows = (await new S.Store(fs, "devc03").open(p.id)).rows;
  assert.deepEqual(Object.keys(rows), ["0", "2"]);
});

test("store: meta per device, half-made folders are not listed, delete goes to the Trash", async () => {
  const fs = fakeFs();
  let t = 100;
  const A = new S.Store(fs, "deva01", () => t), B = new S.Store(fs, "devb02", () => t);
  const p = await A.create({ name: "Old", from: "en", to: "el", data: C.extract({ html: "<p>Hi.</p>" }, "en") });
  t = 200; await A.saveMeta(p.id, { name: "New" });
  t = 300; await B.saveMeta(p.id, { out: "doc9" });
  const l = await A.list();
  assert.equal(l[0].name, "New");
  assert.equal(l[0].out, "doc9");
  // a folder whose project.json never arrived
  await fs.writeText(S.ROOT + "/trzzzzzzzz/src.json", "{}");
  assert.equal((await A.list()).length, 1);
  // a missing src.json is reported, not a crash
  await fs.writeText(S.ROOT + "/tryyyyyyyy/project.json", JSON.stringify({ v: 1, id: "tryyyyyyyy", name: "x" }));
  await assert.rejects(A.open("tryyyyyyyy"), e => e.code === "nosrc");
  await assert.rejects(A.open("../etc"));
  // delete: a Files Trash record, then the folder under the Trash
  t = 400; await A.trash(p.id);
  const keys = [...fs.files.keys()];
  assert.ok(!keys.some(k => k.startsWith(S.dirOf(p.id) + "/")));
  const rec = keys.find(k => /^\/internal\/\.trash\/[0-9a-z]{9}-[0-9a-z]+\.json$/.test(k));
  assert.deepEqual(JSON.parse(fs.files.get(rec).data), { v: 1, path: S.dirOf(p.id), name: p.id, dir: true, at: 400 });
  assert.ok(keys.some(k => k.startsWith(rec.replace(/\.json$/, "") + "/" + p.id + "/project.json")));
});
