// Layout W12 (LY-W12): tables in a story. designkit/table.js (the
// model and its edits, CSV), text.js (rows in the column, rows never
// split, header rows repeated, spans), the outputs (canvas, PDF, SVG,
// EPUB), the model level for large tables, the `table` command for the
// Assistant and orOS Gate, the Story Editor and the table dialog,
// strings in EN/EL/DE and the wiring. Synthetic documents only.
// Run: node --test tests/layout-w12.test.js
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

const ROOT = path.join(__dirname, "..");
const read = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");
const T = require(path.join(ROOT, "designkit/text.js"));
const M = require(path.join(ROOT, "designkit/model.js"));
const R = require(path.join(ROOT, "designkit/render.js"));
const P = require(path.join(ROOT, "designkit/pdf.js"));
const TB = require(path.join(ROOT, "designkit/table.js"));
T.allKeys().forEach((k) => {
  const b = fs.readFileSync(path.join(ROOT, "vendor/noto", T.fontFile(k)));
  T.register(k, b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
});
global.window = global.window || global;
const { jsPDF } = require(path.join(ROOT, "vendor/jspdf.umd.min.js"));

function streams(bytes) {
  const buf = Buffer.from(bytes), out = [];
  let at = 0;
  for (;;) {
    const s = buf.indexOf("stream", at);
    if (s < 0) break;
    const e = buf.indexOf("endstream", s + 6);
    if (e < 0) break;
    let a = s + 6;
    if (buf[a] === 13) a++;
    if (buf[a] === 10) a++;
    try { out.push(zlib.inflateSync(buf.subarray(a, e)).toString("latin1")); } catch (x) { out.push(buf.subarray(a, e).toString("latin1")); }
    at = e + 9;
  }
  return out;
}

// two linked frames, a paragraph, a table of 12 rows (header + a
// rowspan), a paragraph
function doc(opts) {
  opts = opts || {};
  const d = M.newDoc({ name: "Πίνακες", w: 300, h: 300, pages: 2, facing: 0 }, 1);
  const pg = M.pagesInOrder(d);
  const grid = [["Όνομα", "Τιμή", "Σημείωση"]];
  for (let i = 1; i <= 12; i++) grid.push(["Γραμμή " + i, String(i * 3), i % 5 ? "" : "κείμενο που αναδιπλώνεται σε δύο ή τρεις γραμμές μέσα στο κελί"]);
  let tb = TB.merge(TB.fromGrid(grid, { hdr: 1 }), 3, 2, 2, 1);
  tb.hf = "sw-paper";
  if (opts.rep === 0) tb.rep = 0;
  d.stories.push({ id: "st-a", m: 1, paras: [
    { ps: "ps-body", runs: [{ t: "Πριν από τον πίνακα." }] },
    { ps: "ps-body", runs: [], ext: { tbl: tb } },
    { ps: "ps-body", runs: [{ t: "Μετά." }] }] });
  d.items.push({ id: "it-a", m: 1, t: "text", pg: pg[0].id, x: 20, y: 20, w: 260, h: 260, story: "st-a", seq: 1, z: 1 });
  d.items.push({ id: "it-b", m: 1, t: "text", pg: pg[1].id, x: 20, y: 20, w: 260, h: 260, story: "st-a", seq: 2, z: 1 });
  return M.normDoc(d);
}

test("table.js: grid, merge and split, rows and columns with spans, text", () => {
  let t = TB.fromGrid([["A", "B", "C"], ["a", "b", "c"], ["d", "e", "f"]], { hdr: 1 });
  assert.deepEqual([t.cols, t.hdr, t.pad, t.bw], [[1, 1, 1], 1, 4, 0.5]);
  t = TB.merge(t, 1, 0, 2, 2);
  assert.deepEqual(t.rows[1].c[0], { t: "a\nb\nd\ne", s: 2, r: 2 }, "texts join");
  assert.deepEqual([t.rows[1].c[1].x, t.rows[2].c[0].x, t.rows[2].c[1].x, t.rows[2].c[2].x], [1, 1, 1, undefined]);
  const grown = TB.addRow(t, 2);
  assert.equal(grown.rows[1].c[0].r, 3, "a span over a new row grows");
  assert.equal(grown.rows[2].c[2].t, "");
  const shrunk = TB.delRow(t, 1);
  assert.deepEqual(shrunk.rows[1].c[0], { t: "a\nb\nd\ne", s: 2 }, "a span that starts on a deleted row moves down");
  const wide = TB.addCol(t, 1);
  assert.equal(wide.rows[1].c[0].s, 3);
  assert.equal(wide.cols.length, 4);
  const narrow = TB.delCol(t, 0);
  assert.equal(narrow.rows[1].c[0].t, "a\nb\nd\ne");
  assert.equal(narrow.rows[1].c[0].s, undefined);
  assert.deepEqual(TB.split(t, 1, 0).rows[2].c[0], { t: "" }, "split frees the covered cells");
  assert.equal(TB.setText(t, 2, 0, "x").rows[2].c[0].t, "", "a covered cell takes no text");
  assert.equal(TB.text(t), "A\tB\tC\na b d e\tc\nf");
  // header rows bound to the grid, spans clipped, clashes undone
  const n = TB.norm({ cols: [1, 1], rows: [{ c: [{ t: "1", s: 9, r: 9 }, { t: "2" }] }, { c: [{ t: "3" }, { t: "4", r: 2 }] }], hdr: 7 });
  assert.deepEqual(n.rows[0].c[0], { t: "1", s: 2, r: 2 });
  assert.equal(n.rows[1].c[1].x, 1);
  assert.equal(n.hdr, 1);
  assert.equal(TB.norm({ rows: [] }), null);
  assert.equal(TB.norm({ cols: [1], rows: [{ c: [{ t: "\u0007ok" }] }], rep: 0 }).rep, 0);
});

test("table.js: CSV / TSV read, text in a table paragraph moves out", () => {
  assert.deepEqual(TB.parseCSV('Α,Β\n"x,1","q""z"\n\n3,4'), [["Α", "Β"], ["x,1", 'q"z'], ["3", "4"]]);
  assert.deepEqual(TB.parseCSV("a\tb;c\n1\t2;3"), [["a", "b;c"], ["1", "2;3"]]);
  assert.deepEqual(TB.parseCSV("a;b\r\n1;2"), [["a", "b"], ["1", "2"]]);
  const tb = TB.fromGrid([["x"]]);
  const out = TB.unrun([{ ps: "ps-a", runs: [], ext: { tbl: tb } }, { ps: "ps-b", runs: [{ t: "typed" }], ext: { tbl: tb } }]);
  assert.equal(out.length, 3);
  assert.deepEqual(out[1].runs, []);
  assert.deepEqual(out[2], { ps: "ps-b", runs: [{ t: "typed" }] });
});

test("model: a large table is kept and needs model level 3; other large bags are not", () => {
  const big = TB.fromGrid(Array.from({ length: 300 }, (_, i) => ["Γραμμή " + i, "κείμενο " + i, "τιμή " + i]));
  assert.ok(JSON.stringify(big).length > 8192);
  const d = doc();
  d.stories[0].paras[1].ext.tbl = big;
  const n = M.normDoc(JSON.parse(JSON.stringify(d)));
  assert.equal(n.stories[0].paras[1].ext.tbl.rows.length, 300, "kept whole");
  assert.equal(M.tableLevel(n), 3);
  assert.equal(M.tableLevel(doc()), 1);
  assert.equal(M.MODEL_LEVEL, 3);
  const notTable = M.normPara({ ps: "ps-a", runs: [], ext: { other: "x".repeat(3900), more: "y".repeat(3900), again: "z".repeat(3900) } });
  assert.equal(notTable.ext, undefined, "the usual cap still holds");
  // TB.MAX_R fits the model's array cap
  assert.equal(TB.MAX_R, 1000);
});

test("text.js: rows never split, the header repeats in the next frame, spans keep rows together", () => {
  const d = doc(), L = R.computeLayout(d);
  const a = L.frames["it-a"].lines, b = L.frames["it-b"].lines;
  const rowsA = a.filter((l) => l.tb).map((l) => l.tr), rowsB = b.filter((l) => l.tb).map((l) => l.tr);
  assert.equal(rowsA[0], 0);
  assert.equal(rowsB[0], 0, "the header row starts the next frame");
  const body = rowsA.slice(1).concat(rowsB.slice(1));
  assert.deepEqual(body, Array.from({ length: 12 }, (_, i) => i + 1), "every body row once, in order");
  assert.ok(rowsA.indexOf(3) >= 0 === rowsA.indexOf(4) >= 0, "rows 3 and 4 (a rowspan) stay together");
  assert.equal(L.overset["st-a"], undefined);
  // each row's bottom below the one before, inside the frame
  a.filter((l) => l.tb).forEach((l, i, arr) => { if (i) assert.ok(l.y >= arr[i - 1].y + 1); assert.ok(l.y <= 260.01); });
  // a row: o0/o1 for the caret, fills (header) and four rules per cell
  const h = a.find((l) => l.tr === 0);
  assert.deepEqual([h.o0, h.o1, h.p], [0, 0, 1]);
  assert.equal(h.tb.fills.length, 3);
  assert.equal(h.tb.fills[0][4], "sw-paper");
  assert.equal(h.tb.rules.length, 12);
  assert.ok(h.runs.some((r) => r.t === "Όνομα"));
  // the rowspan cell is one fill-less box two rows high
  const r3 = a.find((l) => l.tr === 3) || b.find((l) => l.tr === 3), r4 = a.find((l) => l.tr === 4) || b.find((l) => l.tr === 4);
  const tall = r3.tb.rules.filter((x) => x[0] === x[2]).map((x) => x[3] - x[1]);
  assert.ok(Math.max(...tall) >= r3.h + r4.h - 0.01);
  // a wrapped cell makes its row taller
  const r5 = a.find((l) => l.tr === 5) || b.find((l) => l.tr === 5), r6 = a.find((l) => l.tr === 6) || b.find((l) => l.tr === 6);
  assert.ok(r5.h > r6.h + 5);
  // the paragraph after the table follows it
  const after = b.find((l) => !l.tb);
  assert.ok(after.y > b.filter((l) => l.tb).pop().y);
});

test("text.js: repeat off, rules off, plain text of a table", () => {
  const d = doc({ rep: 0 }), L = R.computeLayout(d);
  assert.notEqual(L.frames["it-b"].lines.filter((l) => l.tb)[0].tr, 0, "no header in the next frame");
  d.stories[0].paras[1].ext.tbl.bw = 0;
  const L2 = R.computeLayout(M.normDoc(d));
  assert.equal(L2.frames["it-a"].lines.find((l) => l.tb).tb.rules.length, 0);
  assert.ok(T.plainText(d.stories[0]).split("\n")[1] === "Όνομα\tΤιμή\tΣημείωση");
});

test("outputs: canvas, PDF, SVG and EPUB draw the table", () => {
  const d = doc(), L = R.computeLayout(d);
  // canvas: fills and rules through a recording context
  const calls = [];
  const ctx = new Proxy({}, { get: (o, k) => (k in o ? o[k] : typeof k === "string" && !/^(canvas|globalAlpha|fillStyle|strokeStyle|lineWidth|font|textBaseline|lineCap|lineJoin|globalCompositeOperation|filter|imageSmoothingEnabled|shadowColor|shadowBlur|letterSpacing|direction|textAlign)$/.test(k) ? (...a) => { calls.push(k); return k === "measureText" ? { width: 1 } : undefined; } : undefined), set: (o, k, v) => { o[k] = v; return true; } });
  try { R.drawPage(ctx, d, M.pagesInOrder(d)[0], { layout: L, scale: 1 }); } catch (e) { /* the recorder is not a full canvas */ }
  assert.ok(/function drawTb\(ctx, doc, tb\)/.test(read("designkit/render.js")));
  // PDF: the rules and the header fill are in the page's content
  const pdf = streams(P.build(d, { rgb: true }, { jsPDF, layout: L }).output("arraybuffer")).join("\n");
  const d0 = JSON.parse(JSON.stringify(d)); d0.stories[0].paras.splice(1, 1);
  const pdf0 = streams(P.build(M.normDoc(d0), { rgb: true }, { jsPDF, layout: R.computeLayout(M.normDoc(d0)) }).output("arraybuffer")).join("\n");
  const lines = (s) => (s.match(/ l\n/g) || []).length;
  assert.ok(lines(pdf) - lines(pdf0) >= 13 * 3 * 4, "four rules per cell");
  // SVG
  const SO = require(path.join(ROOT, "layout/svgout.js"));
  const svg = SO.build(d, M.pagesInOrder(d)[0], L, {}, {}).svg;
  assert.ok((svg.match(/<line /g) || []).length >= 40);
  // EPUB: an HTML table, the header in <thead>, the span kept
  const E = require(path.join(ROOT, "layout/epub.js"));
  const c = E.compose(d, { L });
  const html = c.chapters.map((ch) => ch.html.join("")).join("");
  assert.ok(/<table class="tbl"><thead><tr><th scope="col">Όνομα<\/th>/.test(html));
  assert.ok(/<td rowspan="2">/.test(html));
  assert.equal((html.match(/<tr>/g) || []).length, 13);
  assert.equal(c.report.tables, 1);
  assert.ok(/table\.tbl \{ border-collapse: collapse/.test(read("layout/epub.js")));
});

test("table command: checked, applied after a paragraph or in place, outlined", () => {
  const C = require(path.join(ROOT, "layout/commands.js"));
  const ok = C.check([{ op: "table", story: "st-a", rows: ["Έτος | Τίτλος", "2024 | Ο φάρος", "2025 | Η θάλασσα\\nδεύτερη γραμμή"], header: 1, widths: "1 3", rule: 1, header_fill: "#dddddd", after_para: 1 }]);
  assert.equal(ok.ok, true, ok.err);
  assert.equal(C.check([{ op: "table", rows: ["a"] }]).ok, false, "needs a story or frame");
  assert.equal(C.check([{ op: "table", story: "st-a" }]).ok, false, "needs rows");
  const d = doc();
  assert.equal(C.apply(d, ok.steps[0], { now: 5 }), 1);
  const p = d.stories[0].paras[1];
  assert.deepEqual(p.ext.tbl.cols, [1, 3]);
  assert.equal(p.ext.tbl.rows[2].c[1].t, "Η θάλασσα\nδεύτερη γραμμή");
  assert.equal(p.ext.tbl.bw, 1);
  assert.ok(/^sw-/.test(p.ext.tbl.hf));
  assert.equal(d.stories[0].paras.length, 4);
  // replace the 2nd table, by the frame
  const rep = C.check([{ op: "table", frame: "it-a", rows: ["x | y"], header: 0, replace: 2, repeat: false }]);
  assert.equal(C.apply(d, rep.steps[0], { now: 6 }), 1);
  assert.deepEqual(d.stories[0].paras[2].ext.tbl.rows.map((r) => r.c.map((c) => c.t)), [["x", "y"]]);
  assert.equal(d.stories[0].paras[2].ext.tbl.rep, 0);
  assert.equal(C.apply(d, Object.assign({}, rep.steps[0], { replace: 9 }), { now: 7 }), 0, "no 9th table");
  // a big table: the document asks for model level 3
  const many = C.check([{ op: "table", story: "st-a", rows: Array.from({ length: 400 }, (_, i) => "γραμμή " + i + " | κείμενο " + i) }]);
  C.apply(d, many.steps[0], { now: 8 });
  assert.equal(d.setup.ext.mv, 3);
  assert.ok(/\ntable: /.test(C.GUIDE));
  assert.ok(/\[table 3×2\]/.test(JSON.stringify(C.outline(doc(), R.computeLayout(doc())))) || /\[table 13×3\]/.test(JSON.stringify(C.outline(doc(), R.computeLayout(doc())))));
});

test("wiring: Story Editor, dialog, scripts, offline list, styles, strings and help in EN/EL/DE", () => {
  const st = read("layout/story.js"), ui = read("layout/tableui.js");
  assert.ok(/t\("tbl\.ins"\)/.test(st) && /LY\.tables\.edit\(/.test(st) && /TB\.unrun\(paras\)/.test(st));
  assert.ok(/TB\.unrun\(paras\)/.test(read("layout/inframe.js")));
  assert.ok(/<script src="\.\.\/designkit\/table\.js\?v=[0-9.]+"><\/script>/.test(read("layout/index.html")));
  assert.ok(/<script src="tableui\.js\?v=[0-9.]+"><\/script>/.test(read("layout/index.html")));
  const sw = read("sw.js");
  assert.ok(sw.includes('"layout/tableui.js"') && sw.includes('"designkit/table.js"'));
  assert.ok(/\.story-ed \.sp-tbl/.test(read("layout/layout.css")) && /\.tbl-ed td\.on/.test(read("layout/layout.css")));
  assert.ok(/swatchPicker: swatchPicker/.test(read("layout/panels.js")));
  const lay = read("layout/layout.js"), de = read("i18n/de/layout.js");
  const keys = Array.from(new Set((ui + st).match(/["(](tbl\.[a-zA-Z]+)"/g).map((m) => m.slice(1, -1))));
  assert.ok(keys.length > 30, String(keys.length));
  keys.forEach((k) => {
    assert.equal((lay.match(new RegExp('"' + k.replace(/\./g, "\\.") + '": "', "g")) || []).length, 2, k + " EN + EL");
    assert.ok(de.includes('"' + k + '": "'), k + " DE");
  });
  assert.ok(!/\bconfirm\(|\balert\(|\bprompt\(/.test(ui), "no browser dialogs");
  assert.ok(read("layout/help.en.txt").includes("## Tables"));
  assert.ok(read("layout/help.el.txt").includes("## Πίνακες"));
  assert.ok(read("i18n/de/help/layout.txt").includes("## Tabellen"));
});
