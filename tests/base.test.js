// orOS Base: the data model (base/core.js) and its sync rules
// (OROS_BIBLE.md Part I R5, R16, R17, R26, R27; Part VI "Base").
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const C = require("../base/core.js");

const NAMES = { field: "Name", grid: "Grid", cards: "Cards" };
const IDS = { t: "t1", f: "fname", v1: "v1", v2: "v2" };

function seed() {
  let d = C.addBase(C.empty(), "Books", 100, "b1");
  d = C.addTable(d, "b1", "Titles", 110, NAMES, IDS);
  d = C.addField(d, "t1", "Pages", "number", { dec: 0 }, 120, "fpages");
  d = C.addField(d, "t1", "Status", "select", { ch: [{ id: "o1", n: "Idea", c: "gray" }, { id: "o2", n: "Published", c: "green" }] }, 121, "fstat");
  d = C.addField(d, "t1", "Out", "date", {}, 122, "fdate");
  d = C.addField(d, "t1", "Tags", "multi", { ch: [{ id: "ta", n: "Poetry", c: "red" }, { id: "tb", n: "Novel", c: "blue" }] }, 123, "ftags");
  d = C.addField(d, "t1", "No.", "auto", {}, 124, "fauto");
  d = C.addRecord(d, "t1", { fname: "Ποιήματα", fpages: 120, fstat: "o2", fdate: "2026-03-01", ftags: ["ta"] }, 200, "r1").data;
  d = C.addRecord(d, "t1", { fname: "Night train", fpages: 340, fstat: "o1", ftags: ["tb", "ta"] }, 210, "r2").data;
  d = C.addRecord(d, "t1", { fname: "Ένα", fpages: 80 }, 220, "r3").data;
  return d;
}
const S = (d) => C.serialize(d);
const rec = (d, id) => d.recs.find((r) => r.id === id);

test("a fresh table has a primary field and two views", () => {
  const d = seed();
  const ix = C.index(d);
  assert.equal(C.primary(ix, "t1").id, "fname");
  assert.deepEqual(ix.tbViews.t1.map((v) => v.kind), ["grid", "cards"]);
  assert.equal(d.recs.length, 3);
});

test("merge is symmetric, idempotent and canonical (R5, R26)", () => {
  const a = C.setValues(seed(), "r1", { fpages: 125 }, 300);
  const b = C.remove(C.setValues(seed(), "r2", { fname: "Night bus" }, 310), "r3", 320);
  const ab = S(C.merge(a, b)), ba = S(C.merge(b, a));
  assert.equal(ab, ba);
  assert.equal(S(C.merge(JSON.parse(ab), JSON.parse(ab))), ab);
  assert.equal(S(C.merge(JSON.parse(ab), null)), ab);
  assert.equal(S(C.normalize(JSON.parse(ab))), ab);
});

test("two devices changing different fields of one record keep both", () => {
  const a = C.setValues(seed(), "r1", { fpages: 130 }, 300);
  const b = C.setValues(seed(), "r1", { fname: "Poems" }, 305);
  const m = C.merge(a, b);
  assert.equal(rec(m, "r1").v.fpages, 130);
  assert.equal(rec(m, "r1").v.fname, "Poems");
  assert.equal(rec(m, "r1").m, 305);
});

test("the same field on two devices: the newer time wins, a tie the larger JSON", () => {
  const a = C.setValues(seed(), "r1", { fpages: 130 }, 300);
  const b = C.setValues(seed(), "r1", { fpages: 140 }, 301);
  assert.equal(rec(C.merge(a, b), "r1").v.fpages, 140);
  const c = C.setValues(seed(), "r1", { fpages: 150 }, 300);
  assert.equal(rec(C.merge(a, c), "r1").v.fpages, 150);
  assert.equal(rec(C.merge(c, a), "r1").v.fpages, 150);
});

test("a cleared value beats an older value and stays cleared", () => {
  const a = C.setValues(seed(), "r1", { fstat: null }, 400);
  const m = C.merge(seed(), a);
  assert.equal(rec(m, "r1").v.fstat, undefined);
  assert.ok(rec(m, "r1").fm.fstat >= 400);
});

test("only a real change moves a time (R27)", () => {
  const d = seed();
  const same = C.setValues(d, "r1", { fpages: 120, fname: "Ποιήματα" }, 999);
  assert.equal(S(same), S(d));
  const row = C.index(d).tables.t1;
  assert.equal(S(C.putRow(d, "tables", row, 999)), S(d));
});

test("a deleted record goes; a newer edit elsewhere brings it back (R17)", () => {
  const del = C.remove(seed(), "r2", 500);
  assert.equal(rec(C.merge(seed(), del), "r2"), undefined);
  const edited = C.setValues(seed(), "r2", { fpages: 1 }, 600);
  assert.equal(rec(C.merge(del, edited), "r2").v.fpages, 1);
});

test("Undo of a delete wins on the other device too", () => {
  const d = seed();
  const rows = C.rowsUnder(d, "t1");
  const del = C.remove(d, "t1", 500);
  assert.equal(del.tables.length, 0);
  assert.equal(del.recs.length, 0);
  const back = C.restore(del, rows, 600);
  const other = C.merge(seed(), del);           // a device that only saw the delete
  const m = C.merge(other, back);
  assert.equal(m.tables.length, 1);
  assert.equal(m.recs.length, 3);
  assert.equal(m.fields.length, 6);
});

test("a deleted base takes its tables, fields, views and records", () => {
  const m = C.merge(seed(), C.remove(seed(), "b1", 500));
  assert.deepEqual([m.bases.length, m.tables.length, m.fields.length, m.views.length, m.recs.length], [0, 0, 0, 0, 0]);
});

test("a deleted field takes its values; a field not seen yet keeps them", () => {
  const del = C.remove(seed(), "fpages", 500);
  const m = C.merge(seed(), del);
  assert.equal(rec(m, "r1").v.fpages, undefined);
  assert.equal(m.fields.find((f) => f.id === "fpages"), undefined);
  // a record that arrives with a value of a field this copy lacks
  const d = seed();
  const r = JSON.parse(JSON.stringify(rec(d, "r1")));
  r.v.fnew = "x"; r.fm.fnew = 700;
  const lone = C.normalize({ bases: d.bases, tables: d.tables, fields: d.fields, views: d.views, recs: [r] });
  assert.equal(rec(lone, "r1").v.fnew, "x");
  const later = C.merge(lone, C.addField(d, "t1", "New", "text", {}, 710, "fnew"));
  assert.equal(rec(later, "r1").v.fnew, "x");
});

test("values are typed by their field; bad ones are dropped, computed ones never stored", () => {
  let d = seed();
  d = C.setValues(d, "r3", { fpages: "lots", fdate: "2026-02-30", fstat: "zz zz", ftags: ["tb", "tb", 7], fauto: 9 }, 800);
  const r = rec(d, "r3");
  assert.equal(r.v.fpages, 80);
  assert.equal(r.v.fdate, undefined);
  assert.equal(r.v.fstat, undefined);
  assert.deepEqual(r.v.ftags, ["tb"]);
  assert.equal(r.v.fauto, undefined);
  assert.equal(C.normalize({ recs: [{ id: "x", t: "t1", v: { a: 1 } }] }).recs.length, 0);   // no table
});

test("a field type this code does not know keeps its options and values", () => {
  const d = seed();
  const f = { id: "fx", m: 900, tb: "t1", name: "Future", type: "geo", ord: 9, opt: { via: "fz", deep: { a: [1, 2] } } };
  const r = JSON.parse(JSON.stringify(rec(d, "r1")));
  r.v.fx = [{ any: "shape" }]; r.fm.fx = 900;
  const m = C.normalize({ bases: d.bases, tables: d.tables, fields: d.fields.concat([f]), views: d.views, recs: [r] });
  assert.deepEqual(m.fields.find((x) => x.id === "fx").opt, f.opt);
  assert.deepEqual(rec(m, "r1").v.fx, [{ any: "shape" }]);
});

test("autonumber follows creation order and is the same on every device", () => {
  const a = seed();
  const b = C.addRecord(seed(), "t1", { fname: "Later" }, 900, "r0").data;
  const ix = C.index(C.merge(a, b));
  assert.deepEqual(["r1", "r2", "r3", "r0"].map((id) => ix.auto[id]), [1, 2, 3, 4]);
});

test("filters, search, sorting with empty values last", () => {
  const d = seed();
  const ix = C.index(d);
  const v = (cfg) => Object.assign({}, ix.views.v1, { cfg: Object.assign({ conj: "and", filters: [], sorts: [], groups: [], hidden: [], order: [] }, cfg) });
  const ids = (cfg, q) => C.query(ix, v(cfg), { today: "2026-11-13", q }).map((r) => r.id);
  assert.deepEqual(ids({ filters: [{ f: "fpages", op: "gt", v: 100 }] }), ["r1", "r2"]);
  assert.deepEqual(ids({ filters: [{ f: "fstat", op: "eq", v: "o1" }, { f: "fpages", op: "lt", v: 100 }], conj: "or" }), ["r2", "r3"]);
  assert.deepEqual(ids({ filters: [{ f: "ftags", op: "has", v: "ta" }] }), ["r1", "r2"]);
  assert.deepEqual(ids({ filters: [{ f: "fdate", op: "past" }] }), ["r1"]);
  assert.deepEqual(ids({ filters: [{ f: "fdate", op: "empty" }] }), ["r2", "r3"]);
  assert.deepEqual(ids({ filters: [{ f: "fname", op: "has", v: "ποιημα" }] }), ["r1"]);   // no accents, no case
  assert.deepEqual(ids({ filters: [{ f: "fpages", op: "gt" }] }), ["r1", "r2", "r3"]);     // unfinished: no effect
  assert.deepEqual(ids({}, "night"), ["r2"]);
  assert.deepEqual(ids({ sorts: [{ f: "fpages", d: -1 }] }), ["r2", "r1", "r3"]);
  assert.deepEqual(ids({ sorts: [{ f: "fdate", d: -1 }] }).slice(0, 1), ["r1"]);
  assert.deepEqual(ids({ sorts: [{ f: "fdate", d: 1 }] }).slice(0, 1), ["r1"]);              // empty last both ways
  assert.deepEqual(ids({ sorts: [{ f: "fstat", d: 1 }] }), ["r2", "r1", "r3"]);              // choice order
});

test("groups: headers in order, collapsing hides the rows", () => {
  const d = seed();
  const ix = C.index(d);
  const view = Object.assign({}, ix.views.v1, { cfg: Object.assign({}, ix.views.v1.cfg, { groups: [{ f: "fstat", d: 1 }] }) });
  const recs = C.query(ix, view, { today: "2026-11-13" });
  const rows = C.layout(ix, view, recs, {});
  assert.deepEqual(rows.map((r) => r.group ? "G" + r.count : r.rec.id), ["G1", "r2", "G1", "r1", "G1", "r3"]);
  const shut = C.layout(ix, view, recs, { [rows[0].path]: 1 });
  assert.deepEqual(shut.map((r) => r.group ? "G" : r.rec.id), ["G", "G", "r1", "G", "r3"]);
});

test("summary of a number field", () => {
  const d = seed();
  const ix = C.index(d);
  const s = C.summary(ix, d.recs, ix.fields.fpages);
  assert.deepEqual([s.sum, s.min, s.max, s.avg, s.filled], [540, 80, 340, 180, 3]);
});

test("changing a field's type converts the values and counts what did not fit", () => {
  let d = seed();
  d = C.addField(d, "t1", "Kind", "text", {}, 130, "fkind");
  d = C.setValues(d, "r1", { fkind: "Poetry" }, 140);
  d = C.setValues(d, "r2", { fkind: "novel" }, 141);
  d = C.setValues(d, "r3", { fkind: "Novel" }, 142);
  const r = C.convert(d, "fkind", "select", {}, 900);
  const ix = C.index(r.data);
  const f = ix.fields.fkind;
  assert.equal(f.type, "select");
  assert.equal(f.opt.ch.length, 2);                                  // "novel" and "Novel" are one choice
  assert.equal(C.text(ix, ix.recs.r2, f), C.text(ix, ix.recs.r3, f));
  const n = C.convert(d, "fname", "number", { dec: 0 }, 900);
  assert.equal(n.lost, 3);
  const back = C.convert(r.data, "fkind", "text", {}, 950);
  assert.equal(C.index(back.data).recs.r1.v.fkind, "Poetry");
});

test("numbers and dates are read in the usual European and English forms", () => {
  assert.equal(C.parseNum("1.234,5"), 1234.5);
  assert.equal(C.parseNum("1,234.5"), 1234.5);
  assert.equal(C.parseNum("12,5 €"), 12.5);
  assert.equal(C.parseNum("abc"), null);
  assert.equal(C.parseDate("13/11/2026"), "2026-11-13");
  assert.equal(C.parseDate("2026-11-13 9:05"), "2026-11-13T09:05");
  assert.equal(C.parseDate("31/02/2026"), "");
});

test("CSV import guesses the types and keeps the order", () => {
  const csv = "Title;Pages;Price;Out;Read;Mail;Genre\n" +
    "\"A; b\";12;€ 5,50;01/02/2026;yes;a@b.gr;Poetry\n" +
    "C;300;€ 12,00;2026-05-03;no;c@d.gr;Novel\n" +
    "D;7;€ 1,00;;no;e@f.gr;Poetry\nE;8;€ 2,00;;;g@h.gr;Poetry\n";
  const rows = C.parseCsv(csv);
  assert.equal(rows[1][0], "A; b");
  let d = C.addBase(C.empty(), "Import", 100, "b9");
  const r = C.importRows(d, "b9", "Books", rows, 1000, NAMES);
  const ix = C.index(r.data);
  const types = ix.tbFields[r.table].map((f) => f.type);
  assert.deepEqual(types, ["text", "number", "currency", "date", "check", "email", "select"]);
  assert.equal(r.count, 4);
  const recs = ix.tbRecs[r.table];
  const price = ix.tbFields[r.table][2];
  assert.equal(C.value(ix, recs[0], price), 5.5);
  assert.equal(C.value(ix, recs[0], ix.tbFields[r.table][3]), "2026-02-01");
  // and back out: a formula-looking text is defused
  d = C.setValues(r.data, recs[1].id, { [ix.tbFields[r.table][0].id]: "=HYPERLINK(\"x\")" }, 2000);
  const ix2 = C.index(d);
  const out = C.toCsv(ix2, ix2.tbFields[r.table], ix2.tbRecs[r.table]);
  assert.match(out, /"'=HYPERLINK\(""x""\)"/);
  assert.match(out, /^﻿Title,Pages,Price/);
});

test("the record cap holds on import", () => {
  const rows = [["Name"]];
  for (let i = 0; i < 30; i++) rows.push(["n" + i]);
  let d = C.addBase(C.empty(), "x", 1, "b");
  const big = { recs: [] };
  d = C.addTable(d, "b", "t", 2, NAMES, { t: "tt", f: "ff", v1: "va", v2: "vb" });
  for (let i = 0; i < C.MAX_RECS - 10; i++) big.recs.push({ id: "r" + i, t: "tt", c: 5, m: 5, v: {}, fm: {} });
  d = C.normalize(Object.assign({}, d, { recs: big.recs }));
  const r = C.importRows(d, "b", "more", rows, 10, NAMES);
  assert.equal(r.count, 10);
  assert.equal(r.skipped, 20);
});

test("rows for Open in Spreadsheet keep numbers as numbers", () => {
  const d = seed();
  const ix = C.index(d);
  const rows = C.toTable(ix, ix.tbFields.t1.slice(0, 3), ix.tbRecs.t1);
  assert.deepEqual(rows[0], ["Name", "Pages", "Status"]);
  assert.deepEqual(rows[1], ["Ποιήματα", 120, "Published"]);
});

test("the search provider finds records by their text and skips deleted ones", () => {
  const P = require("../base/search.js");
  const d = JSON.parse(S(C.remove(seed(), "r3", 900)));
  const hits = P.search({ readJSON: () => d, q: "poihmata", words: ["ποιηματα"], fold: C.fold, lang: "en", limit: 20 });
  assert.ok(hits.some((h) => h.target.rec === "r1"));
  const all = P.search({ readJSON: () => d, q: "", words: [], fold: C.fold, lang: "en", limit: 50 });
  assert.ok(!all.some((h) => h.target.rec === "r3"));
});

test("broken input never throws and never invents ids or times", () => {
  const junk = [null, 5, "x", { bases: "no", recs: [null, { id: "bad id!", t: "t" }, { id: "r", t: "t1", fm: { a: "x" } }] },
    { tables: [{ id: "t1", base: "nope" }], tombs: { "": 5, ok: -1 } }];
  for (const j of junk) {
    const d = C.normalize(j);
    assert.equal(S(C.normalize(d)), S(d));
  }
  assert.deepEqual(C.normalize({ bases: [{ id: "b", name: 7 }] }).bases, [{ id: "b", m: 0, name: "", color: "blue" }]);
});
