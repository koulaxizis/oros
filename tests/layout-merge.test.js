// Layout data merge (layout/merge.js): CSV parsing, {{fields}} in
// stories (also across formatting runs), image fields (item.mf in
// designkit/model.js), one card per page or N-up sheets with cut
// marks, and a PDF made in parts (designkit/pdf.js deps.pdf + clip).
// Run: node --test tests/

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const T = require(path.join(ROOT, "designkit/text.js"));
const M = require(path.join(ROOT, "designkit/model.js"));
const R = require(path.join(ROOT, "designkit/render.js"));
const P = require(path.join(ROOT, "designkit/pdf.js"));
const G = require(path.join(ROOT, "layout/merge.js"));

T.allKeys().forEach((k) => {
  const b = fs.readFileSync(path.join(ROOT, "vendor/noto", T.fontFile(k)));
  T.register(k, b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
});

const MM = 72 / 25.4;
const A = "a".repeat(64) + ".jpg";

function card() {
  const d = M.newDoc({ name: "Badge", w: 85 * MM, h: 55 * MM, pages: 2, facing: 0 }, 1000);
  const pg = M.pagesInOrder(d);
  d.stories.push({ id: "st-a", m: 1000, paras: [
    { ps: "ps-h1", runs: [{ t: "Hello {{Name}}" }] },
    { ps: "ps-body", runs: [{ t: "{{Ti" }, { t: "tle}}", b: 1 }] },
    { ps: "ps-body", runs: [{ t: "{{ Company }}" }] },
    { ps: "ps-body", runs: [{ t: "Room {{Room}} · {{nope}}" }] }
  ] });
  d.stories.push({ id: "st-b", m: 1000, paras: [{ ps: "ps-body", runs: [{ t: "Back of {{name}}" }] }] });
  d.items.push({ id: "it-a", m: 1000, t: "text", pg: pg[0].id, x: 10, y: 10, w: 150, h: 120, story: "st-a", seq: 1, z: 2 });
  d.items.push({ id: "it-p", m: 1000, t: "img", pg: pg[0].id, x: 170, y: 10, w: 60, h: 60, mf: " Photo ", fit: "custom", isc: 2, z: 1 });
  d.items.push({ id: "it-r", m: 1000, t: "rect", pg: pg[0].id, x: -10, y: -10, w: 30, h: 30, fill: "sw-red", z: 3 });
  d.items.push({ id: "it-b", m: 1000, t: "text", pg: pg[1].id, x: 10, y: 10, w: 150, h: 120, story: "st-b", seq: 1, z: 1 });
  return M.normDoc(d);
}

test("model: the image data field is kept, cleaned, and absent when unset", () => {
  const d = card();
  assert.equal(M.find(d.items, "it-p").mf, "Photo");
  const it = M.normDoc(Object.assign({}, d, { items: [Object.assign({}, M.find(d.items, "it-p"), { mf: "{{x}}\n" })] })).items[0];
  assert.equal(it.mf, "x");
  const plain = M.normDoc(Object.assign({}, d, { items: [Object.assign({}, M.find(d.items, "it-p"), { mf: "  " })] })).items[0];
  assert.ok(!("mf" in plain), "no empty field written");
  assert.ok(!("mf" in M.find(d.items, "it-a")), "only image frames");
});

test("csv: separators, quotes, BOM, blank rows, repeated names, limits", () => {
  const r = G.parseCSV('﻿Name;City;Photo\r\nΆννα;"Αθή""να";anna.JPG\n\n"Bob\nB";Rome;\n  ;  ;\n');
  assert.equal(r.delim, ";");
  assert.deepEqual(r.head, ["Name", "City", "Photo"]);
  assert.deepEqual(r.rows, [["Άννα", 'Αθή"να', "anna.JPG"], ["Bob\nB", "Rome", ""]]);
  assert.equal(G.parseCSV("a\tb\n1\t2").delim, "\t");
  assert.deepEqual(G.parseCSV("a,a,,A\n1,2,3,4").head, ["a", "a 2", "#3", "A 3"]);
  assert.deepEqual(G.parseCSV("x,y\n1").rows, [["1", ""]], "short rows are padded");
  const big = "n\n" + Array.from({ length: G.MAX_ROWS + 50 }, (_, i) => "r" + i).join("\n");
  const b = G.parseCSV(big);
  assert.equal(b.rows.length, G.MAX_ROWS);
  assert.ok(b.cut);
  assert.equal(G.parseCSV("").rows.length, 0);
});

test("fields: found on the chosen pages, matched without case or accents", () => {
  const d = card(), pages = M.pagesInOrder(d).map((p) => p.id);
  assert.deepEqual(G.fieldsOf(d, [pages[0]]), { text: ["Name", "Title", "Company", "Room", "nope"], img: ["Photo"] });
  assert.deepEqual(G.fieldsOf(d, pages).text, ["Name", "Title", "Company", "Room", "nope"], "{{name}} on page 2 is the same field");
  assert.equal(G.colOf(["Όνομα", "ΕΤΑΙΡΕΊΑ"], "ονομα"), 0);
  assert.equal(G.colOf(["Όνομα", "ΕΤΑΙΡΕΊΑ"], "Εταιρεία"), 1);
  assert.equal(G.colOf(["a"], "b"), -1);
});

test("fill: values replace fields, across runs; empty-only lines go; unknown fields stay", () => {
  const paras = M.story(card(), "st-a").paras;
  const vals = { name: "Άννα", title: "Chief <b>", company: "", room: "12" };
  const out = G.fillParas(paras, (n) => (G.fold(n) in vals ? vals[G.fold(n)] : null));
  const text = out.map((p) => p.runs.map((r) => r.t).join(""));
  assert.deepEqual(text, ["Hello Άννα", "Chief <b>", "Room 12 · {{nope}}"]);
  assert.equal(out[1].runs.length, 1, "the value takes the run where the field starts");
  assert.ok(!out[1].runs[0].b);
  assert.equal(paras[0].runs[0].t, "Hello {{Name}}", "the source is not changed");
  // a value with a line break stays one paragraph with a forced break
  const two = G.fillParas([{ ps: "ps-body", runs: [{ t: "{{a}}" }] }], () => "x\ny");
  assert.equal(two.length, 1);
  assert.equal(two[0].runs[0].t, "x\ny");
  // page numbers survive
  const pn = G.fillParas([{ ps: "ps-body", runs: [{ f: "pn" }, { t: " {{a}}" }] }], () => "");
  assert.equal(pn.length, 1);
});

test("build: one card per page, every chosen page per row, images by file name", () => {
  const d = card(), pages = M.pagesInOrder(d).map((p) => p.id);
  const csv = G.parseCSV("Name,Title,Company,Room,Photo\nΆννα,CEO,Acme,1,photos/Anna.jpg\nBob,CTO,,2,missing.png\n");
  const images = { "anna.jpg": { a: A, iw: 800, ih: 600, nm: "Anna.jpg" } }, before = JSON.stringify(d);
  const res = G.build(d, pages, csv.head, csv.rows, { now: 5, images });
  const out = res.doc;
  assert.equal(out.pages.length, 4, "2 rows × 2 pages");
  assert.deepEqual(res.missing, { "missing.png": "missing.png" });
  const pics = out.items.filter((it) => it.t === "img");
  assert.equal(pics[0].a, A);
  assert.equal(pics[0].fit, "fill", "a custom crop is reset for the new picture");
  assert.equal(pics[1].a, "");
  const ids = new Set(out.items.map((it) => it.id).concat(out.stories.map((s) => s.id), out.pages.map((p) => p.id)));
  assert.equal(ids.size, out.items.length + out.stories.length + out.pages.length, "ids are unique");
  out.items.concat(out.stories, out.pages).forEach((e) => assert.match(e.id, /^[a-z]{1,4}-[a-z0-9]{1,24}$/));
  // text is laid out and filled
  const L = R.computeLayout(out);
  const txt = (it) => (L.frames[it.id].lines || []).map((ln) => ln.runs.map((r) => r.t || "").join(" ")).join(" ");
  const texts = out.items.filter((it) => it.t === "text").map(txt);
  assert.ok(texts[0].includes("Hello Άννα") && texts[0].includes("CEO") && texts[0].includes("Acme"));
  assert.ok(texts[1].includes("Back of Άννα"));
  assert.ok(texts[2].includes("Hello Bob") && !texts[2].includes("{{ Company") && texts[2].includes("{{nope}}"));
  // the source document is unchanged
  assert.equal(JSON.stringify(d), before);
});

test("build: N-up fills sheets row by row, clips cards, draws cut marks", () => {
  const d = card(), pg = M.pagesInOrder(d)[0].id;
  const s = G.bestSheet("a4", d.setup.w, d.setup.h, 0, 10 * MM);
  assert.equal(s.g.cols * s.g.rows, 10, "ten 85 × 55 mm cards on A4");
  const g = G.grid(100, 100, 30, 30, 5, 5);
  assert.deepEqual(g, { cols: 2, rows: 2, x0: (100 - 65) / 2, y0: (100 - 65) / 2 });
  const rows = Array.from({ length: 13 }, (_, i) => ["P" + i, "", "", "", ""]);
  const res = G.build(d, [pg], ["Name", "Title", "Company", "Room", "Photo"], rows, { now: 5, nup: { sheet: "a4", gap: 0, margin: 10 * MM, marks: 1 } });
  const out = res.doc;
  assert.equal(out.pages.length, 2);
  assert.equal(res.perSheet, 10);
  assert.equal(Math.round(out.setup.w), Math.round(210 * MM));
  const reds = out.items.filter((it) => it.t === "rect");
  assert.equal(reds.length, 13);
  reds.forEach((it) => {
    const c = res.clip[it.id];
    assert.ok(c && c.w === d.setup.w && c.h === d.setup.h, "each card item is cut to its card");
  });
  const cuts = out.items.filter((it) => it.t === "line");
  assert.ok(cuts.length > 0 && cuts.every((l) => l.stroke === "sw-black" && !res.clip[l.id]));
  // the sheet's cards do not overlap
  const firsts = reds.slice(0, 10).map((it) => [it.x + 10, it.y + 10]);
  assert.equal(new Set(firsts.map(String)).size, 10);
});

test("pdf: parts add up in one PDF; fonts once; clip and text work", () => {
  const { jsPDF } = require(path.join(ROOT, "vendor/jspdf.umd.min.js"));
  const d = card(), pg = M.pagesInOrder(d)[0].id;
  const head = ["Name", "Title", "Company", "Room", "Photo"];
  const rows = Array.from({ length: 5 }, (_, i) => ["Πρόσωπο " + i, "", "", "", ""]);
  let pdf = null;
  for (let i = 0; i < rows.length; i += 2) {
    const res = G.build(d, [pg], head, rows.slice(i, i + 2), { now: 5 });
    pdf = P.build(res.doc, {}, { jsPDF, pdf, clip: res.clip });
  }
  assert.equal(pdf.getNumberOfPages(), 5);
  const raw = Buffer.from(pdf.output("arraybuffer")).toString("latin1");
  const fonts = raw.match(/\/FontFile2/g) || [];
  assert.ok(fonts.length >= 1 && fonts.length <= 3, "each font embedded once, not per part: " + fonts.length);
  const nup = G.build(d, [pg], head, rows, { now: 5, nup: { sheet: "a4", gap: 4 * MM, margin: 10 * MM, marks: 1 } });
  const p2 = P.build(nup.doc, {}, { jsPDF, clip: nup.clip });
  assert.equal(p2.getNumberOfPages(), 1);
});
