// Spreadsheet commands for the Assistant (spreadsheet/commands.js,
// AS-EDIT, wave SS1): the catalog and its guide, checking, every
// command on a real workbook (values and filled formulas, replace,
// clear, formats, sizes, inserting and removing rows and columns with
// the references in every sheet, rules and charts following, sorting
// with a heading, merging, freezing, renaming), that the same list
// twice changes nothing more, which sheets a request is for, the
// preview counts, the outline for the AI; and the wiring in
// Spreadsheet (assist.js) and the Assistant (source, card words in
// EN, EL and DE).
// Run: node --test tests/

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.join(__dirname, "..");
const CMD = require(path.join(ROOT, "spreadsheet/commands.js"));
const FX = require(path.join(ROOT, "spreadsheet/functions.js"));
const C = require(path.join(ROOT, "assistant/core.js"));
const J = (x) => JSON.stringify(x);
const read = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");

// A workbook as the app stores it: Sheet1 (untouched seed name) with a
// small price list and a total, a sheet "Totals" whose formula points
// into Sheet1, a rule and a chart on Sheet1.
function book() {
  const cell = (v, f) => (f ? { v, mtime: 1, f } : { v, mtime: 1 });
  return {
    ver: 2,
    sheets: [{ id: "s-main", name: null, bi: { en: "Sheet1", el: "Φύλλο1" }, rows: 100, cols: 26, pos: 0, mtime: 0, cw: {} },
      { id: "s-two", name: "Totals", rows: 100, cols: 26, pos: 1, mtime: 5, cw: { 0: 120 } }],
    cells: {
      "s-main|0|0": cell("Item", { b: 1 }), "s-main|0|1": cell("Price"),
      "s-main|1|0": cell("Pear"), "s-main|1|1": cell("3"),
      "s-main|2|0": cell("Apple 2025"), "s-main|2|1": cell("1.5"),
      "s-main|3|0": cell("Fig 2025"), "s-main|3|1": cell("2"),
      "s-main|4|0": cell("Total"), "s-main|4|1": cell("=SUM(B2:B4)"),
      "s-two|0|0": cell("=Sheet1!B5*2")
    },
    deleted: {},
    cf: { r1: { id: "r1", sid: "s-main", mtime: 1, pos: 0, rg: "B2:B4", k: "gt", a: "2", st: "g" } },
    charts: { c1: { id: "c1", sid: "s-main", mtime: 1, t: "col", src: "A1:B4", lg: 1, at: { r: 6, c: 0, x: 0, y: 0 }, w: 420, h: 260 } }
  };
}
function run(steps, b, sid) {
  const chk = CMD.check(steps);
  assert.ok(chk.ok, chk.err);
  const w = CMD.work(b || book()), env = { notes: [], lang: "en" };
  let n = 0;
  chk.steps.forEach((st) => { n += CMD.apply(w, sid || "s-main", st, env); });
  return { w, n, notes: env.notes };
}
const v = (w, k) => (w.cells[k] ? w.cells[k].v : "");
const f = (w, k) => (w.cells[k] && w.cells[k].f) || {};

test("the guide names every command and field; the tool declares every field with one type", () => {
  CMD.ORDER.forEach((op) => {
    assert.match(CMD.GUIDE, new RegExp("\\b" + op + ":"), op);
    Object.keys(CMD.CATALOG[op].args).forEach((k) => assert.match(CMD.GUIDE, new RegExp("\\b" + k + "\\b"), op + "." + k));
  });
  const tool = C.editTool({ spreadsheet: CMD });
  const props = tool.params.properties.steps.items.properties;
  CMD.ORDER.forEach((op) => Object.keys(CMD.CATALOG[op].args).forEach((k) => assert.ok(props[k], k)));
  assert.equal(props.range.type, "string");
  assert.equal(props.desc.type, "boolean");
  assert.match(tool.description, /Spreadsheet the documents are sheets/);
  assert.match(C.readAppTool(["spreadsheet"]).description, /for Spreadsheet a sheet/);
});

test("check: ranges, cells, columns and the rows or cols of insert and remove go back to the model when wrong", () => {
  assert.ok(CMD.check([{ op: "set", range: "B2:D9", text: "x" }, { op: "format", range: "B:D", bold: "on" }, { op: "format", range: "3", fill: "#FFEE00" },
    { op: "clear", range: "3-5" }, { op: "insert", rows: "end", n: 2 }, { op: "remove", cols: "C-E" }, { op: "freeze", cell: "$B$2" }]).ok);
  const e = CMD.check([{ op: "set", range: "A1:", text: "x" }, { op: "insert", rows: "2", cols: "B" }, { op: "remove", rows: "x" },
    { op: "sort", by: "B1" }, { op: "format", range: "A1" }, { op: "format", c: "red" }]).err;
  assert.match(e, /command 1 set: range "A1:" is not a cell range/);
  assert.match(e, /command 2 insert: give rows or cols/);
  assert.match(e, /command 3 remove: rows "x" is not allowed/);
  assert.match(e, /command 4 sort: by "B1" is not a column letter/);
  assert.match(e, /command 5 format: give bold/);
  assert.match(e, /command 6 format: c "red" is not allowed/);
  assert.match(CMD.check([{ op: "size", range: "A" }]).err, /give w or h/);
  assert.match(CMD.check([{ op: "chart" }]).err, /unknown command "chart"/);
});

test("set writes a table from its top-left cell, fills one formula like the fill handle and grows the sheet", () => {
  const r = run([{ op: "set", range: "C1", text: "Qty\n4\n5\n6" }, { op: "set", range: "D2:D4", text: "=B2*C2" }, { op: "set", range: "A120", text: "far" }]);
  assert.equal(r.n, 4 + 3 + 1);
  assert.deepEqual(["C1", "C2", "C3", "C4"].map((x, i) => v(r.w, "s-main|" + i + "|2")), ["Qty", "4", "5", "6"]);
  assert.deepEqual([1, 2, 3].map((i) => v(r.w, "s-main|" + i + "|3")), ["=B2*C2", "=B3*C3", "=B4*C4"]);
  assert.equal(v(r.w, "s-main|119|0"), "far");
  assert.equal(r.w.sheets[0].rows, 120, "the sheet grows to hold it");
  const r2 = run([{ op: "set", range: "A1:B1", text: "Name\tCost" }, { op: "set", range: "A2", text: "\tz" }]);
  assert.equal(v(r2.w, "s-main|0|1"), "Cost");
  assert.deepEqual(f(r2.w, "s-main|0|0"), { b: 1 }, "formats stay");
  assert.ok(!r2.w.cells["s-main|1|0"], "an empty value empties the cell");
  assert.equal(v(r2.w, "s-main|1|1"), "z");
});

test("replace leaves formulas alone; clear clears values, formats, fills or borders", () => {
  const r = run([{ op: "replace", find: "2025", repl: "2026" }, { op: "replace", find: "B2", repl: "B3" }]);
  assert.equal(r.n, 2);
  assert.equal(v(r.w, "s-main|2|0"), "Apple 2026");
  assert.equal(v(r.w, "s-main|4|1"), "=SUM(B2:B4)");
  assert.deepEqual(r.notes, ["formulas"]);
  const w = run([{ op: "replace", find: "fig", repl: "Plum", word: true }]).w;
  assert.equal(v(w, "s-main|3|0"), "Plum 2025", "match case is off unless cs");
  const c = run([{ op: "format", range: "A1:B1", fill: "#ffee00", border: "all" }, { op: "clear", range: "A1:B1", part: "fill" }, { op: "clear", range: "A2:B5", has: "apple" }]);
  assert.deepEqual(f(c.w, "s-main|0|0"), { b: 1, bd: "tblr" });
  assert.ok(!c.w.cells["s-main|2|0"], "has picks only the cells with the words");
  assert.equal(v(c.w, "s-main|2|1"), "1.5");
  const vals = run([{ op: "clear", range: "A1", part: "values" }]).w;
  assert.deepEqual(vals.cells["s-main|0|0"], { v: "", f: { b: 1 } }, "the format stays on the empty cell");
});

test("format sets every field, outer and bottom borders follow the range, whole columns cover the cells in use", () => {
  const r = run([{ op: "format", range: "A1:B5", border: "outer", align: "c", valign: "m", c: "#112233", ital: "on", wrap: "on" },
    { op: "format", range: "B", numfmt: "eur", bold: "off" }, { op: "format", range: "A1", bold: "off", under: "on" }]);
  assert.deepEqual(f(r.w, "s-main|0|0"), { i: 1, u: 1, al: "c", co: "#112233", bd: "tl", wr: 1, va: "m" });
  assert.equal(f(r.w, "s-main|4|1").bd, "br");
  assert.equal(f(r.w, "s-main|2|0").bd, "l");
  assert.ok(!f(r.w, "s-main|0|0").b && f(r.w, "s-main|0|0").u === 1);
  assert.equal(f(r.w, "s-main|4|1").nf, "€");
  assert.ok(!r.w.cells["s-main|5|1"], "column B stops at the last row in use");
  const b = run([{ op: "format", range: "A1:B2", border: "bottom" }]).w;
  assert.equal(f(b, "s-main|1|0").bd, "b");
  assert.ok(!f(b, "s-main|0|0").bd);
  const h = run([{ op: "format", has: "2025", fill: "#fecaca" }]);
  assert.equal(h.n, 2);
});

test("size sets column widths and row heights; the default leaves the sheet's map", () => {
  const r = run([{ op: "size", range: "A:B", w: 140 }, { op: "size", range: "A1", h: 40 }]);
  assert.equal(r.n, 3);
  assert.deepEqual(r.w.sheets[0].cw, { 0: 140, 1: 140 });
  assert.deepEqual(r.w.sheets[0].rh, { 0: 40 });
  const back = run([{ op: "size", range: "A:B", w: 140 }, { op: "size", range: "A", w: 88 }]);
  assert.deepEqual(back.w.sheets[0].cw, { 1: 140 });
});

test("insert and remove move cells, references in every sheet, widths, rules and charts", () => {
  const r = run([{ op: "insert", rows: "2", n: 2 }]);
  assert.equal(r.n, 2);
  assert.equal(v(r.w, "s-main|3|0"), "Pear");
  assert.equal(v(r.w, "s-main|6|1"), "=SUM(B4:B6)");
  assert.equal(v(r.w, "s-two|0|0"), "=Sheet1!B7*2", "the other sheet's reference follows");
  assert.equal(r.w.sheets[0].rows, 102);
  assert.equal(r.w.cf.r1.rg, "B4:B6");
  assert.equal(r.w.charts.c1.src, "A1:B6");
  assert.equal(r.w.charts.c1.at.r, 8);
  const c = run([{ op: "remove", cols: "A" }]);
  assert.equal(v(c.w, "s-main|4|0"), "=SUM(A2:A4)");
  assert.equal(v(c.w, "s-two|0|0"), "=Sheet1!A5*2");
  const d = run([{ op: "remove", rows: "2-4" }]);
  assert.equal(d.n, 3);
  assert.equal(v(d.w, "s-main|1|1"), "=SUM(#REF!)", "a formula over the removed rows shows #REF!");
  assert.ok(!d.w.cf.r1, "a rule wholly removed goes");
  assert.equal(d.w.sheets[0].rows, 100, "removing keeps the sheet's size, as the app does");
  const end = run([{ op: "insert", cols: "end", n: 3 }]);
  assert.equal(end.w.sheets[0].cols, 29);
  assert.equal(v(end.w, "s-main|4|1"), "=SUM(B2:B4)");
  const full = run([{ op: "insert", rows: "1", n: 1000 }], Object.assign(book(), { sheets: [Object.assign(book().sheets[0], { rows: 9500 })] }));
  assert.equal(full.n, 0);
  assert.deepEqual(full.notes, ["maxDims"]);
  const wide = run([{ op: "insert", cols: "B", n: 2 }]);
  assert.deepEqual(wide.w.sheets[1].cw, { 0: 120 }, "another sheet's widths stay");
});

test("sort keeps the heading, moves whole rows and keeps formulas pointing at their own row", () => {
  const b = book();
  b.cells["s-main|1|2"] = { v: "=B2*2", mtime: 1 };
  b.cells["s-main|2|2"] = { v: "=B3*2", mtime: 1 };
  b.cells["s-main|3|2"] = { v: "=B4*2", mtime: 1 };
  const r = run([{ op: "sort", range: "A1:C4", by: "B" }], b);
  assert.deepEqual([1, 2, 3].map((i) => v(r.w, "s-main|" + i + "|0")), ["Apple 2025", "Fig 2025", "Pear"]);
  assert.deepEqual([1, 2, 3].map((i) => v(r.w, "s-main|" + i + "|2")), ["=B2*2", "=B3*2", "=B4*2"]);
  assert.equal(v(r.w, "s-main|0|0"), "Item", "a bold first row is a heading");
  assert.equal(r.n, 3);
  const d = run([{ op: "sort", range: "A2:B4", by: "A", desc: true, head: "off" }]);
  assert.deepEqual([1, 2, 3].map((i) => v(d.w, "s-main|" + i + "|0")), ["Pear", "Fig 2025", "Apple 2025"]);
  const out = run([{ op: "sort", range: "A1:A4", by: "B" }]);
  assert.equal(out.n, 0);
  assert.deepEqual(out.notes, ["sortBy"]);
});

test("merge keeps the top-left value, merges each row or column, unmerge splits; freeze and rename", () => {
  const r = run([{ op: "merge", range: "A2:B2" }]);
  assert.equal(r.n, 1);
  assert.deepEqual(f(r.w, "s-main|1|0"), { mc: 2 });
  assert.ok(!r.w.cells["s-main|1|1"]);
  assert.deepEqual(r.notes, ["mergeLost"]);
  const e = run([{ op: "merge", range: "D1:E3", each: "row" }]);
  assert.equal(e.n, 3);
  assert.deepEqual(f(e.w, "s-main|2|3"), { mc: 2 });
  const u = run([{ op: "merge", range: "A2:B3" }, { op: "unmerge", range: "B3" }]);
  assert.deepEqual(f(u.w, "s-main|1|0"), {});
  const fz = run([{ op: "freeze", cell: "B2" }]);
  assert.deepEqual(fz.w.sheets[0].fz, { r: 1, c: 1 });
  assert.equal(run([{ op: "freeze", cell: "B2" }, { op: "freeze", cell: "A1" }]).w.sheets[0].fz, undefined);
  const rn = run([{ op: "rename", title: "Fruit" }]);
  assert.equal(rn.w.sheets[0].name, "Fruit");
  assert.ok(!rn.w.sheets[0].bi);
  assert.deepEqual(rn.notes, ["sheetRefs"], "Totals names Sheet1 in a formula");
});

test("the same list twice changes nothing more", () => {
  const steps = [{ op: "set", range: "C1", text: "Qty\n4" }, { op: "replace", find: "2025", repl: "2026" }, { op: "format", range: "A1:B1", bold: "on", border: "outer", fill: "#bfdbfe" },
    { op: "size", range: "A", w: 150 }, { op: "merge", range: "A7:B7" }, { op: "freeze", cell: "A2" }, { op: "rename", title: "Fruit" }, { op: "sort", range: "A2:B4", by: "B" }];
  const once = run(steps);
  const w2 = JSON.parse(J(once.w)), env = { notes: [], lang: "en" };
  let n2 = 0;
  CMD.check(steps).steps.forEach((st) => { n2 += CMD.apply(w2, "s-main", st, env); });
  assert.ok(once.n >= 8);
  assert.equal(n2, 0);
  assert.equal(J(w2), J(once.w));
});

test("view, targets, preview and the outline for the AI", () => {
  const data = book();
  const vw = CMD.view(data, "el");
  assert.deepEqual(vw.docs.map((d) => d.name), ["Φύλλο1", "Totals"]);
  assert.ok(!J(vw.docs).includes("cells"), "the workbook is not copied");
  assert.deepEqual(CMD.targets(vw, null, "s-two", "open", "").docs, [{ id: "s-two", name: "Totals" }]);
  assert.deepEqual(CMD.targets(vw, null, "", "open", "").docs.map((d) => d.id), ["s-main"], "no stored sheet: the first, as the app opens");
  assert.deepEqual(CMD.targets(vw, null, "", "named", "sheet1").docs.map((d) => d.id), ["s-main"], "a seed sheet answers to its English and Greek names");
  assert.match(CMD.targets(vw, null, "", "named", "budget").err, /no sheet is called "budget"; sheets: "Φύλλο1", "Totals"/);
  assert.match(CMD.targets(vw, null, "", "folder", "x").err, /no folders/);
  assert.match(CMD.targets(vw, null, "", "new", "").err, /added in Spreadsheet itself/);
  assert.equal(CMD.targets(vw, null, "", "all", "").docs.length, 2);
  const steps = CMD.check([{ op: "replace", find: "2025", repl: "2026" }, { op: "format", range: "Z1:Z2", bold: "on" }]).steps;
  const pv = CMD.preview(CMD.view(data, "en"), ["s-main", "s-two"], steps);
  assert.deepEqual(pv, { n: 6, d: 2, per: [{ id: "s-main", name: "Sheet1", n: 4 }, { id: "s-two", name: "Totals", n: 2 }], cut: 0, notes: [] });
  assert.equal(data.cells["s-main|2|0"].v, "Apple 2025", "preview works on copies");
  const o = CMD.outline(CMD.view(data, "en").docs[0]);
  assert.equal(o.name, "Sheet1");
  assert.equal(o.used, "A1:B5");
  assert.deepEqual(o.sheets, ["Sheet1", "Totals"]);
  assert.deepEqual(o.cells[0], { ref: "A1", v: "Item", f: { b: 1 } });
  assert.deepEqual(o.cells[9], { ref: "B5", v: "=SUM(B2:B4)", shows: 6.5 });
  assert.deepEqual(o.charts, [{ type: "col", data: "A1:B4" }]);
  assert.equal(o.rules, 1);
  assert.equal(CMD.outline(CMD.view(data, "en").docs[1]).cells[0].shows, 13, "a formula into another sheet is worked out");
});

test("wiring: Spreadsheet loads the catalog on the first request and writes through its own state", () => {
  const app = read("spreadsheet/spreadsheet.js");
  assert.match(app, /if \(tg\.edit \|\| tg\.editUndo\) \{ assistRun\(tg\); return; \}/);
  assert.match(app, /then\(function \(\) \{ return load\("commands\.js"\); \}\)\.then\(function \(\) \{ return load\("assist\.js"\); \}\)/);
  assert.match(app, /window\.SheetAssistHost = \{/);
  const as = read("spreadsheet/assist.js");
  assert.match(as, /K\.check\(rq && rq\.steps\)/, "Spreadsheet checks the commands again");
  assert.match(as, /H\.rawSet\(/, "cells are written per field, as the app does");
  assert.match(as, /fp\(stateOf\(rec\)\) !== rec\.fp/, "a changed workbook is not undone");
  assert.match(as, /H\.push\(entries\)/, "the change is one step of the app's own Undo");
  const sw = read("sw.js");
  ["spreadsheet/commands.js", "spreadsheet/assist.js"].forEach((x) => assert.ok(sw.includes('"' + x + '"'), x));
  assert.ok(!read("spreadsheet/index.html").includes("commands.js"), "loaded on first use");
  const de = read("i18n/de/spreadsheet.js");
  ["as.done", "as.done1", "as.done0", "as.bad", "as.undone", "as.changed", "as.gone"].forEach((k) => {
    assert.equal((app.match(new RegExp('"' + k.replace(".", "\\.") + '":', "g")) || []).length, 2, k);
    assert.ok(de.includes('"' + k + '":'), k);
  });
});

test("wiring: the Assistant reads Spreadsheet, and the card speaks of sheets and cells in EN, EL and DE", () => {
  assert.ok(!read("assistant/index.html").includes("../spreadsheet/"), "loaded on first use");
  const as = read("assistant/assistant.js");
  assert.match(as, /spreadsheet: \["\.\.\/spreadsheet\/functions\.js", "\.\.\/spreadsheet\/sheetkit\.js", "\.\.\/spreadsheet\/commands\.js"\]/);
  assert.match(as, /spreadsheet: \{ mod: "SheetCommands", data: "oros-spreadsheet-data", prefs: "oros-spreadsheet-active", raw: 1, view: 1 \}/);
  assert.match(as, /if \(s\.raw\) \{ try \{ open = localStorage\.getItem\(s\.prefs\)/);
  assert.equal(C.EDIT_APP.spreadsheet.noun, "sheet");
  const de = read("i18n/de/assistant.js");
  const has = (k) => (as.match(new RegExp('"' + k.replace(/\./g, "\\.") + '":', "g")) || []).length === 2;
  const keys = ["ed.will.spreadsheet", "ed.did.spreadsheet", "ed.sureDel.spreadsheet", "ed.f.insert.end.rows", "ed.f.insert.end.cols"];
  ["noCells", "maxDims", "formulas", "sortBy", "mergeLost", "sheetRefs", "big"].forEach((n) => keys.push("ed.note." + n));
  CMD.ORDER.forEach((op) => keys.push(has("ed.op." + op + ".spreadsheet") ? "ed.op." + op + ".spreadsheet" : "ed.op." + op));
  CMD.ORDER.forEach((op) => Object.keys(CMD.CATALOG[op].args).forEach((k) => keys.push(has("ed.f." + k + ".spreadsheet") ? "ed.f." + k + ".spreadsheet" : "ed.f." + k)));
  Object.keys(CMD.CATALOG).forEach((op) => Object.keys(CMD.CATALOG[op].args).forEach((k) => {
    const spec = CMD.CATALOG[op].args[k];
    if (spec.t === "enum") spec.v.filter(Boolean).forEach((x) => keys.push("ed.v." + k + "." + x));
  }));
  keys.forEach((k) => {
    assert.ok(has(k), "EN + EL " + k);
    assert.ok(de.includes('"' + k + '":'), "DE " + k);
  });
  assert.match(as, /\|part\|numfmt\|wrap\|border\|head\|each\|[a-z|]*\)\$\/\.test\(k\)\) return edT\(app, "ed\.v\."/, "the card names these values");
});

test("the catalog runs where the Assistant loads it (browser globals, no Node)", () => {
  const ctx = { window: {}, console, Intl };
  ctx.window.window = ctx.window;
  vm.createContext(ctx);
  ["recipes/core.js", "spreadsheet/functions.js", "spreadsheet/sheetkit.js", "spreadsheet/commands.js"].forEach((x) => vm.runInContext(read(x), ctx, { filename: x }));
  const K = ctx.window.SheetCommands;
  assert.ok(K && typeof K.preview === "function");
  const vw = K.view(book(), "en");
  assert.equal(K.preview(vw, ["s-main"], K.check([{ op: "insert", rows: "1" }]).steps).n, 1);
  assert.equal(typeof FX.adjustFormula, "function");
});
