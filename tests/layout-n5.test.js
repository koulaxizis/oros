// Layout W12 rest + N5 (LY-W12 review, LY-N5): tracked changes
// (layout/track.js: marks, accept, reject, the caret through them,
// text.js leaving deletions out), comments pinned on the page and the
// proof PDF (layout/comments.js), strings in EN/EL/DE and the wiring.
// Synthetic documents only.
// Run: node --test tests/layout-n5.test.js
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const read = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");
const TR = require(path.join(ROOT, "layout/track.js"));
const CM = require(path.join(ROOT, "layout/comments.js"));
const T = require(path.join(ROOT, "designkit/text.js"));
const M = require(path.join(ROOT, "designkit/model.js"));
const R = require(path.join(ROOT, "designkit/render.js"));
const PDFLib = require(path.join(ROOT, "vendor/pdf-lib/pdf-lib.min.js"));
T.allKeys().forEach((k) => {
  const b = fs.readFileSync(path.join(ROOT, "vendor/noto", T.fontFile(k)));
  T.register(k, b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
});
const P = (...runs) => ({ ps: "ps-body", runs });
const old = () => [P({ t: "Ο φύλακας κοιμόταν νωρίς." }), P({ t: "Δεύτερη παράγραφος." })];

test("mark: a changed word is a deletion and an insertion, by whom and when", () => {
  const r = TR.mark(old(), [P({ t: "Ο φύλακας ξύπνησε νωρίς." }), P({ t: "Δεύτερη παράγραφος." })], "Χρ", 5, [{ p: 0, o: 17 }]);
  assert.deepEqual(r.paras[0].runs, [{ t: "Ο φύλακας " }, { t: "κοιμόταν", ext: { del: { by: "Χρ", at: 5 } } }, { t: "ξύπνησε", ext: { ins: { by: "Χρ", at: 5 } } }, { t: " νωρίς." }]);
  assert.deepEqual(r.pos, [{ p: 0, o: 25 }], "the caret stays after the typed word");
  assert.deepEqual(TR.count(r.paras), { ins: 1, del: 1, by: ["Χρ"] });
  assert.deepEqual(TR.list(r.paras).map((x) => [x.k, x.t, x.o]), [["del", "κοιμόταν", 10], ["ins", "ξύπνησε", 18]]);
});

test("mark: own insertions vanish when deleted, deletions stay, unchanged text keeps its mark", () => {
  const r = TR.mark(old(), [P({ t: "Ο φύλακας ξύπνησε νωρίς." }), P({ t: "Δεύτερη παράγραφος." })], "Χρ", 5);
  // the editor dropped a deletion and the insertion's mark: both come back
  const typed = [P({ t: "Ο φύλακας ξύπνησε νωρίς." }), P({ t: "Δεύτερη παράγραφος." })];
  assert.deepEqual(TR.mark(r.paras, typed, "Χρ", 6).paras, r.paras);
  // the inserted word deleted again: gone, not struck
  const back = TR.mark(r.paras, [P({ t: "Ο φύλακας " }, { t: "κοιμόταν", ext: { del: { by: "Χρ", at: 5 } } }, { t: " νωρίς." }), P({ t: "Δεύτερη παράγραφος." })], "Χρ", 7);
  assert.deepEqual(back.paras[0].runs, [{ t: "Ο φύλακας " }, { t: "κοιμόταν", ext: { del: { by: "Χρ", at: 5 } } }, { t: " νωρίς." }]);
  // paragraph breaks are not tracked; the text around them is
  const split = TR.mark(old(), [P({ t: "Ο φύλακας" }), P({ t: " κοιμόταν νωρίς." }), P({ t: "Δεύτερη παράγραφος." })], "x", 1, [{ p: 1, o: 0 }]);
  assert.equal(split.paras.length, 3);
  assert.equal(TR.hasMarks(split.paras), false);
  assert.deepEqual(split.pos, [{ p: 1, o: 0 }]);
  // a caret in the middle of an unchanged word stays there
  assert.deepEqual(TR.mark(old(), [P({ t: "Ο φύλακας κοιμόταν νωρίς!" }), P({ t: "Δεύτερη παράγραφος." })], "x", 1, [{ p: 0, o: 4 }]).pos, [{ p: 0, o: 4 }]);
  // fields and notes are tracked as one piece
  const f = TR.mark([P({ t: "Σελίδα " }, { f: "pn" })], [P({ t: "Σελίδα " })], "x", 1);
  assert.deepEqual(f.paras[0].runs[1], { f: "pn", ext: { del: { by: "x", at: 1 } } });
});

test("accept and reject: in a range or all", () => {
  const r = TR.mark(old(), [P({ t: "Ο φύλακας ξύπνησε νωρίς." }), P({ t: "Δεύτερη και τρίτη παράγραφος." })], "Χρ", 5).paras;
  const a = TR.accept(r, null);
  assert.equal(a.n, 3);
  assert.equal(a.paras.map((p) => p.runs.map((x) => x.t).join("")).join("|"), "Ο φύλακας ξύπνησε νωρίς.|Δεύτερη και τρίτη παράγραφος.");
  assert.equal(TR.hasMarks(a.paras), false);
  const j = TR.reject(r, null);
  assert.equal(j.paras.map((p) => p.runs.map((x) => x.t).join("")).join("|"), "Ο φύλακας κοιμόταν νωρίς.|Δεύτερη παράγραφος.");
  // only the first paragraph's changes
  const one = TR.accept(r, { a: { p: 0, o: 0 }, b: { p: 0, o: 30 } });
  assert.equal(one.n, 2);
  assert.equal(TR.count(one.paras).ins, 1);
  // a caret inside a change settles it
  assert.equal(TR.reject(r, { a: { p: 0, o: 20 }, b: { p: 0, o: 20 } }).n, 1);
});

test("text.js and the outputs leave a deletion out; its offsets stay", () => {
  const d = M.newDoc({ name: "Δ", w: 300, h: 300, pages: 1, facing: 0 }, 1);
  const marked = TR.mark(old(), [P({ t: "Ο φύλακας ξύπνησε νωρίς." }), P({ t: "Δεύτερη παράγραφος." })], "Χρ", 5).paras;
  d.stories.push({ id: "st-a", m: 1, paras: marked });
  d.items.push({ id: "it-a", m: 1, t: "text", pg: M.pagesInOrder(d)[0].id, x: 20, y: 20, w: 260, h: 260, story: "st-a", seq: 1, z: 1 });
  const L = R.computeLayout(M.normDoc(d)), ln = L.frames["it-a"].lines[0];
  const set = ln.runs.map((r) => r.t || "").join("");
  assert.ok(!set.includes("κοιμόταν") && set.includes("ξύπνησε"));
  assert.equal(ln.runs.find((r) => (r.t || "").includes("ξύπνησε")).o, 18, "offsets count the deletion");
  assert.equal(T.plainText(d.stories[0]).split("\n")[0], "Ο φύλακας ξύπνησε νωρίς.");
  const E = require(path.join(ROOT, "layout/epub.js"));
  const html = E.compose(M.normDoc(d), { L }).chapters.map((c) => c.html.join("")).join("");
  assert.ok(!html.includes("κοιμόταν") && html.includes("ξύπνησε"));
  assert.equal(require(path.join(ROOT, "layout/versions.js")).paraText(marked[0]), "Ο φύλακας ξύπνησε νωρίς.");
});

test("comments: clean, listed in page order, notes in a proof PDF", async () => {
  const n = CM.norm([{ id: "cabc12", x: 900, y: -4, t: "  Κόψε αυτή τη γραμμή  ", by: "Χρ", at: 7, ok: 1 }, { id: "cabc12", t: "διπλό" }, { id: "bad", t: "x" }, { id: "cxyz99", t: "" }], 400, 600);
  assert.deepEqual(n, [{ id: "cabc12", x: 400, y: 0, t: "Κόψε αυτή τη γραμμή", by: "Χρ", at: 7, ok: 1 }]);
  assert.equal(CM.norm(Array.from({ length: 30 }, (_, i) => ({ id: "c" + String(i).padStart(5, "0"), t: "σ" + i }))).length, 20);
  const d = M.newDoc({ name: "Δ", w: 300, h: 400, pages: 2, facing: 0 }, 1);
  const pg = M.pagesInOrder(d);
  pg[1].ext = { cm: [{ id: "cbbbb1", x: 10, y: 20, t: "Δεύτερη σελίδα", by: "Α", at: 1 }] };
  pg[0].ext = { cm: [{ id: "caaaa1", x: 50, y: 60, t: "Πρώτη σελίδα", by: "Β", at: 2 }] };
  const nd = M.normDoc(d);
  assert.deepEqual(CM.list(nd, M).map((x) => [x.n, x.c.t]), [[1, "Πρώτη σελίδα"], [2, "Δεύτερη σελίδα"]], "comments survive the model");
  const doc = await PDFLib.PDFDocument.create();
  doc.addPage([300, 400]); doc.addPage([300, 400]);
  const bytes = await doc.save();
  const out = await CM.annotate(PDFLib, bytes, [{ page: 0, x: 50, y: 60, t: "Πρώτη σελίδα", by: "Β", at: Date.UTC(2026, 10, 22) }, { page: 1, x: 10, y: 20, t: "Ναι", by: "Α" }, { page: 9, t: "χαμένο" }], { title: "Δ" });
  assert.equal(out.n, 2);
  const back = await PDFLib.PDFDocument.load(out.bytes);
  const ann = back.getPages()[0].node.lookup(PDFLib.PDFName.of("Annots"));
  const a0 = back.context.lookup(ann.get(0));
  assert.equal(a0.get(PDFLib.PDFName.of("Subtype")).toString(), "/Text");
  assert.equal(a0.lookup(PDFLib.PDFName.of("Contents")).decodeText(), "Πρώτη σελίδα");
  const rect = a0.lookup(PDFLib.PDFName.of("Rect")).asArray().map((x) => x.asNumber());
  assert.deepEqual(rect, [50, 322, 68, 340], "y from the top");
  assert.match(a0.lookup(PDFLib.PDFName.of("M")).decodeText(), /^D:20261122/);
});

test("proof notes for tracked changes sit beside their lines", () => {
  const d = M.newDoc({ name: "Δ", w: 300, h: 300, pages: 1, facing: 0 }, 1);
  d.stories.push({ id: "st-a", m: 1, paras: TR.mark(old(), [P({ t: "Ο φύλακας ξύπνησε νωρίς." }), P({ t: "Δεύτερη παράγραφος." })], "Χρ", 5).paras });
  d.items.push({ id: "it-a", m: 1, t: "text", pg: M.pagesInOrder(d)[0].id, x: 20, y: 20, w: 200, h: 260, story: "st-a", seq: 1, z: 1 });
  const nd = M.normDoc(d), notes = CM.changeNotes(nd, R.computeLayout(nd), M, { ins: "Προστέθηκε", del: "Διαγράφηκε" });
  assert.deepEqual(notes.map((x) => [x.kind, x.t, x.page, x.x]), [["del", "Διαγράφηκε: κοιμόταν", 0, 224], ["ins", "Προστέθηκε: ξύπνησε", 0, 224]]);
  assert.ok(notes[0].y >= 20 && notes[0].y < 40);
});

test("wiring: Story Editor, in-frame typing, menu, scripts, offline list, styles, strings and help in EN/EL/DE", () => {
  const st = read("layout/story.js");
  assert.ok(/LY\.track\.mark\(st0\.paras, paras/.test(st) && /data-f", "del"/.test(st) && /S\.noTrack = true/.test(st));
  assert.ok(/LY\.track\.mark\(st0\.paras, norm\(F\.paras\)/.test(read("layout/inframe.js")));
  assert.ok(/t\(LY\.comments && LY\.comments\.on\(\) \? "more\.commentsOff" : "more\.comments"\)/.test(read("layout/panels.js")));
  const idx = read("layout/index.html");
  assert.ok(/<script src="track\.js\?v=[0-9.]+"><\/script>/.test(idx) && /<script src="comments\.js\?v=[0-9.]+"><\/script>/.test(idx));
  const sw = read("sw.js");
  assert.ok(sw.includes('"layout/track.js"') && sw.includes('"layout/comments.js"'));
  const css = read("layout/layout.css");
  assert.ok(/\.story-ed \.sdel/.test(css) && /\.cm-pin/.test(css) && /\.cm-bar/.test(css));
  assert.ok(/revName/.test(read("layout/layout.js")));
  const lay = read("layout/layout.js"), de = read("i18n/de/layout.js"), src = read("layout/track.js") + read("layout/comments.js") + st;
  const keys = Array.from(new Set(src.match(/["(](?:trk|cm)\.[a-zA-Z]+"/g).map((m) => m.slice(1, -1)))).concat(["more.comments", "more.commentsOff"]);
  assert.ok(keys.length > 35, String(keys.length));
  keys.forEach((k) => {
    assert.equal((lay.match(new RegExp('"' + k.replace(/\./g, "\\.") + '": "', "g")) || []).length, 2, k + " EN + EL");
    assert.ok(de.includes('"' + k + '": "'), k + " DE");
  });
  assert.ok(!/\bconfirm\(|\balert\(|\bprompt\(/.test(read("layout/comments.js") + read("layout/track.js").replace(/LY\.prompt\(/g, "")), "no browser dialogs");
  assert.ok(read("layout/help.en.txt").includes("## Review: tracked changes and comments"));
  assert.ok(read("layout/help.el.txt").includes("## Διόρθωση: αλλαγές και σχόλια"));
  assert.ok(read("i18n/de/help/layout.txt").includes("## Korrektur: Änderungen und Kommentare"));
});
