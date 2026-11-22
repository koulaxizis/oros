// Layout W13 (LY-W13): the book's index. layout/bookindex.js (marks,
// whole-word marking in any case and accents, the index built from the
// pages: order for the language, letter headings, sub-topics, page
// labels and runs, update keeps the title), the `index` command for the
// Assistant and orOS Gate, strings in EN/EL/DE and the wiring.
// Synthetic documents only.
// Run: node --test tests/layout-w13.test.js
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const read = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");
const IX = require(path.join(ROOT, "layout/bookindex.js"));
const T = require(path.join(ROOT, "designkit/text.js"));
const M = require(path.join(ROOT, "designkit/model.js"));
const R = require(path.join(ROOT, "designkit/render.js"));
T.allKeys().forEach((k) => {
  const b = fs.readFileSync(path.join(ROOT, "vendor/noto", T.fontFile(k)));
  T.register(k, b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
});
const P = (...runs) => ({ ps: "ps-body", runs });

// three pages, a story on each
function doc() {
  const d = M.newDoc({ name: "Ευρετήριο", w: 300, h: 300, pages: 3, facing: 0 }, 1);
  const pg = M.pagesInOrder(d);
  const texts = [
    [P({ t: "Ο Φάρος της Αλεξάνδρειας. Ο φάρος φώτιζε τη θάλασσα." }), P({ t: "Η Θάλασσα ήταν ήσυχη, ο φαρος σβηστός." })],
    [P({ t: "Ο φάρος ξανά, και ο φαροφύλακας." }), P({ t: "Ωκεανός και " }, { t: "άλφα", ext: { del: { by: "A", at: 1 } } }, { t: " βήτα." })],
    [P({ t: "Ο φάρος στην τρίτη σελίδα. 1821 ήταν η χρονιά." })],
  ];
  texts.forEach((paras, i) => {
    d.stories.push({ id: "st-" + i, m: 1, paras });
    d.items.push({ id: "it-" + i, m: 1, t: "text", pg: pg[i].id, x: 20, y: 20, w: 260, h: 260, story: "st-" + i, seq: 1, z: 1 });
  });
  return M.normDoc(d);
}
const marks = (d) => {
  const out = [];
  d.stories.forEach((s) => s.paras.forEach((p) => p.runs.forEach((r) => { if (r.ext && r.ext.ix) out.push([r.t, r.ext.ix.t || "", r.ext.ix.s || ""]); })));
  return out;
};
const textOf = (st) => st.paras.map((p) => p.runs.map((r) => r.t || "").join(""));

test("terms, folding, letters and page runs", () => {
  assert.deepEqual(IX.parseTerm("φάρος"), { w: "φάρος" });
  assert.deepEqual(IX.parseTerm(" φάρος = Φάροι / Αλεξάνδρεια "), { w: "φάρος", t: "Φάροι", s: "Αλεξάνδρεια" });
  assert.equal(IX.parseTerm("  = x"), null);
  assert.equal(IX.fold("Φάρος"), "φαρος");
  assert.equal(IX.fold("ΐ"), "ι");
  assert.equal(IX.letterOf("Ώρα"), "Ω");
  assert.equal(IX.letterOf("«Άλφα»"), "Α");
  assert.equal(IX.letterOf("1821"), "0–9");
  const lab = ["i", "ii", "1", "2", "3", "4", "6"];
  assert.equal(IX.pagesText([2, 3, 4, 6, 0, 1, 3], lab, ", "), "i, ii, 1–3, 6");
  assert.equal(IX.pagesText([4, 5], lab, ", "), "3–4");
  assert.equal(IX.pagesText([5, 6], lab, ", "), "4, 6", "pages in a row are a run only when their numbers follow each other");
});

test("markAll: whole words in any case and accents, never twice; unmark", () => {
  const d = doc();
  assert.equal(IX.markAll(d, [{ w: "φάρος" }], 5), 5, "Φάρος, φάρος, φαρος, φάρος, φάρος; not φαροφύλακας");
  assert.ok(marks(d).every((m) => IX.fold(m[0]) === "φαρος" && m[1] === ""));
  assert.equal(IX.markAll(d, [{ w: "φάρος" }], 6), 0, "a marked word is not marked again");
  assert.equal(IX.markAll(d, [IX.parseTerm("θάλασσα = Θάλασσα / Μεσόγειος")], 7), 2);
  assert.equal(IX.markAll(d, [{ w: "άλφα" }], 8), 0, "a deleted word (tracked change) is not marked");
  assert.equal(d.stories[0].paras[0].runs.map((r) => r.t).join(""), "Ο Φάρος της Αλεξάνδρειας. Ο φάρος φώτιζε τη θάλασσα.", "the text is unchanged");
  assert.equal(d.stories[0].m, 7);
  assert.equal(IX.unmark(d, "ΘΑΛΑΣΣΑ", 9), 2, "by topic, any case");
  assert.equal(IX.unmark(d, null, 9), 5);
  assert.equal(marks(d).length, 0);
  assert.ok(d.stories.every((s) => s.paras.every((p) => p.runs.every((r) => !r.ext || Object.keys(r.ext).length))), "no empty ext left");
});

test("place and update: a new last page, sorted for Greek, letters, sub-topics, pages; update keeps the title", () => {
  const d = doc();
  IX.markAll(d, [{ w: "φάρος", t: "Φάρος" }, IX.parseTerm("θάλασσα = Θάλασσα / Μεσόγειος"), { w: "ωκεανός" }, { w: "αλεξάνδρειας", t: "Αλεξάνδρεια" }, { w: "1821" }], 5);
  assert.equal(IX.update(d, 6), null, "no index story yet");
  const st = IX.place(d, 6, "Ευρετήριο", (k) => k + "-ix");
  assert.equal(M.pagesInOrder(d).length, 4);
  assert.equal(st.ext.hs, "idx");
  const fr = d.items.filter((it) => it.story === st.id)[0];
  assert.equal(fr.cols, 2);
  assert.equal(fr.pg, M.pagesInOrder(d)[3].id);
  const res = IX.update(d, 7);
  assert.deepEqual(res, { topics: 5, marks: 10 });
  const lines = textOf(st);
  assert.deepEqual(lines, ["Ευρετήριο", "0–9", "1821, 3", "Α", "Αλεξάνδρεια, 1", "Θ", "Θάλασσα", " Μεσόγειος, 1", "Φ", "Φάρος, 1–3", "Ω", "Ωκεανός, 2"]);
  assert.ok(st.paras.slice(1).every((p) => p.ext && p.ext.ixg), "made paragraphs are marked as made");
  assert.equal(st.paras[1].runs[0].b, 1, "a letter without its own style is bold");
  // the index's own story is never indexed; a second update gives the same
  const again = IX.update(d, 8);
  assert.deepEqual(again, res);
  assert.deepEqual(textOf(st), lines);
  // the title stays, a new title paragraph too; settings: no letters, a style, a separator
  st.paras[0].runs[0].t = "Ευρετήριο ονομάτων";
  d.setup.ext = Object.assign({}, d.setup.ext, { ix: { heads: 0, sep: " — ", ps: "ps-body" } });
  IX.update(d, 9);
  assert.deepEqual(textOf(st), ["Ευρετήριο ονομάτων", "1821 — 3", "Αλεξάνδρεια — 1", "Θάλασσα", " Μεσόγειος — 1", "Φάρος — 1–3", "Ωκεανός — 2"]);
  assert.equal(IX.cfg(d).head, "");
  // pages as the pages show them: a section in roman numerals
  d.pages = M.pagesInOrder(d);
  const p0 = d.pages[0];
  p0.sec = { st: 1, ns: "i" };
  const lab = M.pageLabels(d).map((x) => String(x.label));
  IX.update(d, 10);
  assert.ok(textOf(st).includes("Φάρος — " + IX.pagesText([0, 1, 2], lab, ", ")), JSON.stringify([lab, textOf(st)]));
  // the model keeps the marks, the index story and its settings
  const n = M.normDoc(JSON.parse(JSON.stringify(d)));
  assert.equal(n.stories.filter((s) => s.ext && s.ext.hs === "idx").length, 1);
  assert.ok(n.stories[0].paras[0].runs.some((r) => r.ext && r.ext.ix && r.ext.ix.t === "Αλεξάνδρεια"));
  assert.equal(n.setup.ext.ix.sep, " — ");
});

test("index command: checked, marks, places and makes the index, unmarks", () => {
  const C = require(path.join(ROOT, "layout/commands.js"));
  const ok = C.check([{ op: "index", terms: ["φάρος = Φάρος", "θάλασσα = Θάλασσα / Μεσόγειος", "ωκεανός"] }]);
  assert.equal(ok.ok, true, ok.err);
  assert.equal(ok.steps[0].build, 1, "build is on by default");
  const d = doc(), notes = [];
  const n = C.apply(d, ok.steps[0], { now: 5, notes });
  assert.equal(n, 5 + 2 + 1 + 1 + 1, "marks, a new index page, the index made");
  assert.deepEqual(notes, []);
  const st = IX.idxStory(d);
  assert.equal(st.paras[0].runs[0].t, "Ευρετήριο", "the title in the document's language");
  assert.ok(textOf(st).includes("Φάρος, 1–3"));
  // again: no new page, the index made again with the new marks
  const more = C.check([{ op: "index", terms: ["1821"], title: "Index" }]).steps[0];
  assert.equal(C.apply(d, more, { now: 6 }), 2);
  assert.equal(M.pagesInOrder(d).length, 4);
  assert.ok(textOf(st).includes("1821, 3"));
  // unmark one topic, all, without building
  assert.equal(C.apply(d, C.check([{ op: "index", unmark: "φάρος", build: false }]).steps[0], { now: 7 }), 5);
  assert.equal(C.apply(d, C.check([{ op: "index", unmark: "*", build: false }]).steps[0], { now: 8 }), 4);
  assert.equal(marks(d).length, 0);
  // a new document in English: an English title
  const e = doc();
  e.setup.ext = Object.assign({}, e.setup.ext, { lang: "en" });
  C.apply(e, C.check([{ op: "index", terms: ["φάρος"] }]).steps[0], { now: 9 });
  assert.equal(IX.idxStory(e).paras[0].runs[0].t, "Index");
  assert.ok(/\nindex: /.test(C.GUIDE) && /`title`/.test(C.GUIDE));
  const big = C.check([{ op: "index", terms: Array.from({ length: 201 }, (_, i) => "w" + i) }]);
  assert.ok(!big.ok || big.steps[0].terms.length <= 200, "at most 200 terms");
});

test("wiring: Story Editor, menu, scripts, offline list, Assistant, styles, strings and help in EN/EL/DE", () => {
  const st = read("layout/story.js");
  assert.ok(/label: t\("ix\.ins"\), fn: insertIx/.test(st) && /ext\.ix/.test(st) && /"six"|\bsix\b/.test(st));
  assert.ok(/t\("more\.index"\), disabled: !LY\.bookIndex, fn: function \(\) \{ LY\.bookIndex\.dialog\(\); \}/.test(read("layout/panels.js")));
  assert.ok(/<script src="bookindex\.js\?v=[0-9.]+"><\/script>/.test(read("layout/index.html")));
  assert.ok(/<script src="\.\.\/layout\/bookindex\.js\?v=[0-9.]+"><\/script>\s*<script src="\.\.\/layout\/commands\.js/.test(read("assistant/index.html")), "the Assistant counts marks in its preview");
  assert.ok(read("sw.js").includes('"layout/bookindex.js"'));
  const css = read("layout/layout.css");
  assert.ok(/\.story-ed \.six/.test(css) && /\.ix-row/.test(css) && /\.ix-terms/.test(css));
  const lay = read("layout/layout.js"), de = read("i18n/de/layout.js"), src = read("layout/bookindex.js") + st;
  const keys = Array.from(new Set(src.match(/["(]ix\.[a-zA-Z]+"/g).map((m) => m.slice(1, -1)))).concat(["more.index"]);
  assert.ok(keys.length > 25, String(keys.length));
  keys.forEach((k) => {
    assert.equal((lay.match(new RegExp('"' + k.replace(/\./g, "\\.") + '": "', "g")) || []).length, 2, k + " EN + EL");
    assert.ok(de.includes('"' + k + '": "'), k + " DE");
  });
  const as = read("assistant/assistant.js"), ade = read("i18n/de/assistant.js");
  ["ed.op.index", "ed.f.terms", "ed.f.unmark", "ed.f.build", "ed.note.indexLater"].forEach((k) => {
    assert.equal((as.match(new RegExp('"' + k.replace(/\./g, "\\.") + '": "', "g")) || []).length, 2, k);
    assert.ok(ade.includes('"' + k + '": "'), k + " DE");
  });
  assert.ok(!/\bconfirm\(|\balert\(|\bprompt\(/.test(read("layout/bookindex.js")), "no browser dialogs");
  assert.ok(read("layout/help.en.txt").includes("## Index\n"));
  assert.ok(read("layout/help.el.txt").includes("## Ευρετήριο\n"));
  assert.ok(read("i18n/de/help/layout.txt").includes("## Register\n"));
});
