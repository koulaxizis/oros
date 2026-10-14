// Atelier tables and charts (atelier/objects.js + ax.js), the vector
// PDF with real text (atelier/pdfout.js + jsPDF), and the template
// library (categories, search, the sampler order).
// Run: node --test tests/

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const T = require(path.join(ROOT, "designkit/text.js"));
const M = require(path.join(ROOT, "designkit/model.js"));
const AX = require(path.join(ROOT, "atelier/ax.js"));
const OB = require(path.join(ROOT, "atelier/objects.js"));
const PDF = require(path.join(ROOT, "atelier/pdfout.js"));
const K = require(path.join(ROOT, "spreadsheet/sheetkit.js"));
const TPL = require(path.join(ROOT, "atelier/templates.js"));
require(path.join(ROOT, "atelier/templates-more.js"));

T.allKeys().forEach((k) => {
  const b = fs.readFileSync(path.join(ROOT, "vendor/noto", T.fontFile(k)));
  T.register(k, b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
});

const J = (x) => JSON.stringify(x);

function design() {
  const d = AX.newDesign({ name: "Objects", w: 1080, h: 1080, bg: "#ffeedd" }, 1000);
  const pg = d.pages[0].id;
  AX.addItem(d, pg, { k: "table", x: 100, y: 100, w: 600, h: 300, sw: 1, tb: { rows: [["Item", "Price"], ["Καφές", "2,50 €"], ["Tea", "2.00"]], bd: 1 } }, 1000);
  AX.addItem(d, pg, { k: "chart", x: 100, y: 500, w: 600, h: 400, ch: { t: "line", ttl: "Sales", rows: [["", "2024", "2025"], ["Q1", "12", "18"], ["Q2", "15", "22"]] } }, 1000);
  AX.addItem(d, pg, { k: "text", tx: "Καλημέρα κόσμε", size: 60, x: 40, y: 40, w: 600, fc: "#112233" }, 1000);
  return M.normDoc(d);
}

// ---------- normalisers ----------
test("tables: canonical, idempotent, defaults left out, limits kept", () => {
  const tb = OB.normTable({ rows: [["a", 1, null], ["b\r\nc"]], hd: true, hc: 1, bd: 0, ln: "all", ac: "#2B4C7E", bf: "#abc", cw: [10, 10, 10] });
  assert.deepEqual(tb, { rows: [["a", "1", ""], ["b\nc", "", ""]], hc: 1, bf: "#aabbcc" });
  assert.equal(J(OB.normTable(tb)), J(tb), "idempotent");
  assert.deepEqual(OB.normTable({ rows: [["x"]], hd: 0, ln: "box", cw: [3] }), { rows: [["x"]], hd: 0, ln: "box" });
  assert.deepEqual(OB.normTable({ rows: [["x", "y"]], cw: [1, 300] }).cw, [1, 100]);
  assert.equal(OB.normTable({ rows: [] }), null);
  assert.equal(OB.normTable(null), null);
  const big = OB.normTable({ rows: Array.from({ length: 50 }, () => Array.from({ length: 20 }, () => "z".repeat(900))) });
  assert.equal(big.rows.length, OB.MAX_R);
  assert.equal(big.rows[0].length, OB.MAX_C);
  assert.equal(big.rows[0][0].length, OB.MAX_CELL);
});

test("charts: canonical, idempotent, single-line cells, unknown type → column", () => {
  const ch = OB.normChart({ t: "radar", rows: [["", "A"], ["x\ny", 3]], ttl: "  Τίτλος ", lg: false, by: "q", tc: "#1f2328", co: ["#f00", "#00ff00"] });
  assert.deepEqual(ch, { t: "col", rows: [["", "A"], ["x y", "3"]], ttl: "Τίτλος", lg: 0, co: ["#ff0000", "#00ff00"] });
  assert.equal(J(OB.normChart(ch)), J(ch));
  assert.equal(OB.normChart({ t: "pie", rows: [["a"]], co: ["#f00", "nope"] }).co, undefined, "a bad colour drops the list");
});

test("items: tables and charts survive normalization and merge", () => {
  const d = design();
  const tb = d.items.find((it) => it.ax.k === "table"), ch = d.items.find((it) => it.ax.k === "chart");
  assert.equal(tb.t, "rect");
  assert.equal(tb.ax.tb.rows[1][0], "Καφές");
  assert.equal(ch.ax.ch.t, "line");
  assert.equal(J(M.normDoc(JSON.parse(J(d)))), J(d), "canonical");
  const m = M.mergeData({ docs: [d] }, { docs: [d] });
  assert.equal(J(m.docs[0]), J(d), "merge with itself is a no-op");
});

test("numbers: Greek and English forms", () => {
  assert.equal(OB.num("1.234,5"), 1234.5);
  assert.equal(OB.num("1,234.5"), 1234.5);
  assert.equal(OB.num("12,5"), 12.5);
  assert.equal(OB.num("50%"), 50);
  assert.equal(OB.num("€ 3"), 3);
  assert.equal(OB.num("abc"), null);
  assert.equal(OB.num(""), null);
});

test("paste: tab, semicolon and quoted CSV text become rows", () => {
  assert.deepEqual(OB.rowsFromText("a\tb\n1\t2\n"), [["a", "b"], ["1", "2"]]);
  assert.deepEqual(OB.rowsFromText('a;b\n"x;y";"say ""hi"""'), [["a", "b"], ["x;y", 'say "hi"']]);
  assert.deepEqual(OB.rowsFromText("a,b,c\n1"), [["a", "b", "c"], ["1", "", ""]]);
  assert.equal(OB.rowsFromText(""), null);
});

test("table look and lines", () => {
  const it = design().items.find((x) => x.ax.k === "table");
  assert.deepEqual(OB.cellLook(it, 0, 0), { head: true, fill: OB.HEAD, ink: "#ffffff", b: 1 });
  assert.equal(OB.cellLook(it, 2, 0).fill, OB.BAND, "banded rows");
  assert.equal(OB.cellLook(it, 1, 0).fill, "");
  const g = OB.tableGrid(it);
  assert.equal(g.R, 3); assert.equal(g.C, 2);
  assert.equal(OB.tableRules(it).length, 4 + 2 + 1);
  const lay = AX.tableLayout(it);
  assert.equal(lay.cells.length, 6);
  lay.cells.forEach((c) => c.lines.forEach((ln) => ln.runs.forEach((r) => assert.ok(r.x + r.w <= c.tw + 0.5, "cell text fits its cell"))));
  // a lot of text: one shrink factor for the whole table, nothing spills
  const crowded = JSON.parse(J(it));
  crowded.ax.tb.rows[1][1] = "Πάρα πολύ μεγάλο κείμενο ".repeat(12);
  const l2 = AX.tableLayout(crowded);
  assert.ok(l2.k < 1);
  l2.cells.forEach((c) => {
    const h = c.lines.length ? c.lines[c.lines.length - 1].y + c.lines[c.lines.length - 1].d : 0;
    assert.ok(h <= c.h + 1, "text stays inside its row");
  });
});

test("charts: the picture spec and SVG via the Spreadsheet engine", () => {
  const it = design().items.find((x) => x.ax.k === "chart");
  const spec = OB.chartSpec(it, { pageBg: "#ffeedd", lang: "el" });
  assert.equal(spec.t, "line");
  assert.equal(spec.lang, "el");
  assert.equal(spec.pal.bg, "none", "see-through by default");
  assert.ok(spec.w >= 160 && spec.h >= 120);
  assert.equal(OB.chartKey(spec), OB.chartKey(JSON.parse(J(spec))), "stable key");
  assert.notEqual(OB.chartKey(spec), OB.chartKey(Object.assign({}, spec, { t: "col" })));
  const grid = OB.chartGrid(spec.rows);
  assert.equal(grid[0][1].n, null, "an empty corner makes the first row names, even numbers");
  assert.equal(grid[1][1].n, 12);
  const model = K.chartModel(grid, { t: "line" });
  assert.deepEqual(model.series.map((s) => s.name), ["2024", "2025"]);
  assert.deepEqual(model.cats, ["Q1", "Q2"]);
  const svg = OB.chartSvg(K, spec, { empty: "-", series: "S", other: "O" });
  assert.match(svg, /^<svg[\s>]/);
  assert.ok(svg.includes("Sales"));
  assert.ok(!/<script/i.test(svg));
});

// ---------- PDF ----------
test("pdf: plan picks vector, text or picture per element", () => {
  const d = design(), pg = d.pages[0].id;
  const d2 = JSON.parse(J(d));
  AX.addItem(d2, pg, { k: "text", tx: "emoji \u{1F600}", size: 40, x: 40, y: 640, w: 600 }, 1000);
  AX.addItem(d2, pg, { k: "text", tx: "glow", size: 40, x: 40, y: 700, w: 600, tfx: { type: "shadow" } }, 1000);
  const plan = PDF.plan(M.normDoc(d2), [pg]);
  const kinds = plan.map((p) => p.kind);
  assert.ok(kinds.includes("text"));
  assert.ok(kinds.includes("raster"), "a glyph the fonts lack: a picture of that element");
  assert.ok(kinds.includes("textfx"), "a blurred effect: picture behind real text");
  const tb = plan.find((p) => d2.items.find((x) => x.id === p.id).ax.k === "table");
  assert.equal(tb.kind, "vector", "a table is drawn as vectors and text");
  assert.ok(plan.filter(PDF.needsPicture).length >= 2);
});

test("pdf: real, selectable text in the embedded fonts", () => {
  const { jsPDF } = require(path.join(ROOT, "vendor/jspdf.umd.min.js"));
  const d = design(), pg = d.pages[0].id;
  const plan = PDF.plan(d, [pg]);
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64");
  const pics = {};
  plan.filter(PDF.needsPicture).forEach((p) => { pics[p.id] = { data: new Uint8Array(png), fmt: "PNG", x: -p.pad, y: -p.pad, w: 10, h: 10 }; });
  const pdf = PDF.build(d, { pages: [pg], title: "T" }, { jsPDF, pictures: pics, plan });
  assert.equal(pdf.getNumberOfPages(), 1);
  const raw = Buffer.from(pdf.output("arraybuffer")).toString("latin1");
  assert.ok(/\/FontFile2/.test(raw), "fonts embedded");
  assert.ok(/\/ToUnicode/.test(raw), "text can be copied out");
});

// ---------- template library ----------
test("library: at least 40 templates, every category used, search folds accents", () => {
  assert.ok(TPL.list.length >= 40, "templates: " + TPL.list.length);
  const cats = new Set(TPL.CATS.map((c) => c[0]));
  TPL.list.forEach((t) => {
    assert.ok(cats.has(t.cat), t.id + " category");
    assert.ok(t.tags && t.tags.en && t.tags.el, t.id + " tags");
  });
  assert.equal(TPL.usedCats(TPL.list).length, TPL.CATS.length, "no empty category");
  assert.ok(TPL.match(TPL.list, "", "αφισα").every((t) => t.cat === "poster" || /αφίσ/i.test(t.el + t.tags.el)));
  assert.ok(TPL.match(TPL.list, "", "ΑΦΊΣΑ").length > 0);
  assert.ok(TPL.match(TPL.list, "cv", "").length >= 3);
  assert.equal(TPL.match(TPL.list, "cv", "wedding").length, 0);
  assert.equal(TPL.match(TPL.list, "", "zzzz").length, 0);
  const mixed = TPL.mix(TPL.list);
  assert.equal(mixed.length, TPL.list.length);
  assert.equal(new Set(mixed.map((t) => t.id)).size, TPL.list.length);
  const firstCats = mixed.slice(0, TPL.CATS.length).map((t) => t.cat);
  assert.equal(new Set(firstCats).size, TPL.CATS.length, "the sampler shows one of each kind first");
});

test("library: template files stay small (precached)", () => {
  ["templates.js", "templates-more.js"].forEach((f) => {
    const n = fs.statSync(path.join(ROOT, "atelier", f)).size;
    assert.ok(n < 120 * 1024, f + " " + n + " bytes");
  });
});
