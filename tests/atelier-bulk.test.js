"use strict";
// Atelier "Bulk create" (atelier/bulk.js): fields, list parsing,
// column matching, filling with shrink to fit, copies and one design.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const T = require(path.join(ROOT, "designkit/text.js"));
const M = require(path.join(ROOT, "designkit/model.js"));
const AX = require(path.join(ROOT, "atelier/ax.js"));
const B = require(path.join(ROOT, "atelier/bulk.js"));
T.allKeys().forEach((k) => {
  const b = fs.readFileSync(path.join(ROOT, "vendor/noto", T.fontFile(k)));
  T.register(k, b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
});
const textH = (it) => AX.textHeight(M.normItem(it));
let n = 0;
const newId = (p) => M.newId ? M.newId(p) : p + "-" + (++n);

function design() {
  const d = AX.newDesign({ name: "Award", w: 1080, h: 760 }, 1000);
  const pg = d.pages[0].id;
  AX.addItem(d, pg, { k: "text", tx: "Certificate", size: 60, x: 40, y: 40, w: 1000 }, 1000);
  AX.addItem(d, pg, { k: "text", tx: "{Όνομα}", size: 72, x: 140, y: 300, w: 800, al: "c" }, 1000);
  AX.addItem(d, pg, { k: "text", tx: "{date} · {Course}", size: 24, x: 140, y: 600, w: 800 }, 1000);
  AX.addItem(d, pg, { k: "shape", shp: "star", fc: "#ff0000", x: 10, y: 10, w: 80, h: 80 }, 1000);
  return M.normDoc(d);
}

test("bulk: fields in page order, once each, case and accents ignored", () => {
  const d = design();
  assert.deepEqual(B.fields(d), ["Όνομα", "date", "Course"]);
  assert.equal(B.key(" ΌΝΟΜΑ "), "ονομα");
  // table cells count too
  const t = { items: [{ pg: "p", y: 0, x: 0, ax: { k: "table", tb: { rows: [["{a}", "x"], ["{b}", "{A}"]] } } }], pages: [{ id: "p", pos: 1 }] };
  assert.deepEqual(B.fields(t), ["a", "b"]);
  assert.deepEqual(B.fields({ items: [], pages: [] }), []);
});

test("bulk: lists from a spreadsheet, CSV with quotes, semicolons, one name per line", () => {
  assert.deepEqual(B.parseTable("name\tdate\nAnn\t1/2\n\nBob\t3/4\n"), [["name", "date"], ["Ann", "1/2"], ["Bob", "3/4"]]);
  assert.deepEqual(B.parseTable('﻿name,course\n"Papa, Maria","Say ""hi"""\n'), [["name", "course"], ["Papa, Maria", 'Say "hi"']]);
  assert.deepEqual(B.parseTable("a;b\n1;2"), [["a", "b"], ["1", "2"]]);
  assert.deepEqual(B.parseTable("Ann\nBob"), [["Ann"], ["Bob"]]);
  assert.ok(B.parseTable("x\n".repeat(500)).length <= B.LIM.rows + 2);
});

test("bulk: columns go to the field with the same name; one field takes a lone column", () => {
  const f = ["Όνομα", "date", "Course"];
  const m = B.autoMap(f, ["course", "ονομα", "email"]);
  assert.deepEqual(m, { "ονομα": 1, date: -1, course: 0 });
  assert.deepEqual(B.autoMap(["name"], ["Full name"]), { name: 0 });
  const v = B.values([["Math", "Ann", "a@x"], ["Art", "Bob"]], m);
  assert.deepEqual(v, [{ "ονομα": "Ann", course: "Math" }, { "ονομα": "Bob", course: "Art" }]);
  // unmapped fields stay as written
  assert.equal(B.fillText("{date} · {Course}", v[0]), "{date} · Math");
});

test("bulk: a long name shrinks to fit its box (not below 60%), a short one keeps its size", () => {
  const d = design();
  const name = d.items.find((it) => it.ax && it.ax.tx === "{Όνομα}");
  const h0 = name.h;
  const long = B.fillItems(JSON.parse(JSON.stringify([name])), { "ονομα": "Αικατερίνη Κωνσταντινοπούλου-Παπαγεωργίου" }, textH)[0];
  assert.ok(long.ax.size < 72 && long.ax.size >= 72 * 0.6, String(long.ax.size));
  const short = B.fillItems(JSON.parse(JSON.stringify([name])), { "ονομα": "Ann" }, textH)[0];
  assert.equal(short.ax.size, 72);
  assert.equal(short.h, h0);
  assert.equal(short.ax.tx, "Ann");
  // much too long: 60%, then the box grows
  const huge = B.fillItems(JSON.parse(JSON.stringify([name])), { "ονομα": "Word ".repeat(60) }, textH)[0];
  assert.ok(huge.ax.size >= 72 * 0.6 - 0.01);
  assert.ok(huge.h > h0);
});

test("bulk: a design per row, named after the first field; or one design with a page per row", () => {
  const d = design();
  const rows = [{ "ονομα": "Ann", date: "1 May", course: "Math" }, { "ονομα": "Bob", date: "2 May", course: "Art" }, { "ονομα": "", date: "3 May", course: "X" }];
  const list = B.makeCopies(d, B.fields(d), rows, textH);
  assert.equal(list.length, 3);
  assert.deepEqual(list.map((c) => c.name), ["Award · Ann", "Award · Bob", "Award · 3 May"]);
  assert.ok(list[1].items.some((it) => it.ax && it.ax.tx === "2 May · Art"));
  // the original is untouched
  assert.ok(d.items.some((it) => it.ax && it.ax.tx === "{Όνομα}"));
  const one = M.normDoc(B.makeOne(d, rows, textH, newId));
  assert.equal(one.pages.length, 3);
  assert.equal(one.items.length, d.items.length * 3);
  const ids = new Set(one.items.map((it) => it.id));
  assert.equal(ids.size, one.items.length, "new item ids");
  const pg = new Set(one.pages.map((p) => p.id));
  assert.ok(one.items.every((it) => pg.has(it.pg)));
  const byPage = one.pages.slice().sort((a, b) => a.pos - b.pos).map((p) => one.items.filter((it) => it.pg === p.id && it.ax && it.ax.k === "text").sort((a, b) => a.y - b.y).map((it) => it.ax.tx).join("|"));
  assert.deepEqual(byPage, ["Certificate|Ann|1 May · Math", "Certificate|Bob|2 May · Art", "Certificate||3 May · X"]);
  assert.ok(B.fits(d, 200));
  assert.ok(!B.fits(d, 2000));
});

test("bulk: wired into Atelier (script, menu, strings, help)", () => {
  const html = fs.readFileSync(path.join(ROOT, "atelier/index.html"), "utf8");
  assert.ok(html.indexOf("bulk.js") > html.indexOf("editpic.js") && html.indexOf("bulk.js") < html.indexOf('"ai.js'));
  assert.ok(fs.readFileSync(path.join(ROOT, "atelier/io.js"), "utf8").includes('t("more.bulk")'));
  const src = fs.readFileSync(path.join(ROOT, "atelier/bulk.js"), "utf8");
  const en = [...src.slice(src.indexOf("en: {"), src.indexOf("el: {")).matchAll(/"(bulk\.[a-zA-Z0-9]+)":/g)].map((m) => m[1]).sort();
  const el = [...src.slice(src.indexOf("el: {")).matchAll(/"(bulk\.[a-zA-Z0-9]+)":/g)].map((m) => m[1]).sort();
  assert.deepEqual(el, en);
  for (const m of src.matchAll(/\bt\("(bulk\.[a-zA-Z0-9]+)"/g)) assert.ok(en.includes(m[1]), m[1]);
  ["en", "el"].forEach((l) => assert.ok(/## (Bulk create|Μαζική δημιουργία)/.test(fs.readFileSync(path.join(ROOT, "atelier/help." + l + ".txt"), "utf8"))));
});
