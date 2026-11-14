// orOS Base wave B2: links between tables, lookups, rollups, counts and
// formulas (base/core.js). Sync rules: OROS_BIBLE.md Part I R5, R16,
// R17, R26, R27; Part VI "orOS Base (BASE-1)".
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const C = require("../base/core.js");

const NAMES = { field: "Name", grid: "Grid", cards: "Cards" };

// Books ⇄ Authors, with prices and dates to roll up
function seed() {
  let d = C.addBase(C.empty(), "Press", 100, "b1");
  d = C.addTable(d, "b1", "Books", 110, NAMES, { t: "tb", f: "bname", v1: "bv1", v2: "bv2" });
  d = C.addTable(d, "b1", "Authors", 111, NAMES, { t: "ta", f: "aname", v1: "av1", v2: "av2" });
  d = C.addField(d, "tb", "Price", "currency", { dec: 2, sym: "€" }, 120, "bprice");
  d = C.addField(d, "tb", "Out", "date", {}, 121, "bout");
  d = C.addField(d, "tb", "Done", "check", {}, 122, "bdone");
  d = C.addLinkField(d, "tb", "Authors", "ta", 130, "Books", { a: "blink", b: "alink" });
  d = C.addRecord(d, "tb", { bname: "Ποιήματα", bprice: 12.5, bout: "2026-03-01", bdone: true }, 200, "r1").data;
  d = C.addRecord(d, "tb", { bname: "Night train", bprice: 18, bout: "2025-10-01" }, 210, "r2").data;
  d = C.addRecord(d, "tb", { bname: "Ένα", bprice: 9.9 }, 220, "r3").data;
  d = C.addRecord(d, "ta", { aname: "Κ. Π." }, 230, "a1").data;
  d = C.addRecord(d, "ta", { aname: "A. B." }, 240, "a2").data;
  d = C.setLinks(d, "blink", "r1", ["a1"], 300);
  d = C.setLinks(d, "blink", "r2", ["a1", "a2"], 310);
  return d;
}
const S = (d) => C.serialize(d);
const val = (d, recId, fid) => { const ix = C.index(d); return C.value(ix, ix.recs[recId], ix.fields[fid]); };
const txt = (d, recId, fid, o) => { const ix = C.index(d); return C.text(ix, ix.recs[recId], ix.fields[fid], o); };

test("a link field pairs with a field on the other table; links read both ways", () => {
  const d = seed();
  const ix = C.index(d);
  assert.deepEqual(ix.fields.blink.opt, { to: "ta", inv: "alink" });
  assert.deepEqual(ix.fields.alink.opt, { to: "tb", inv: "blink" });
  assert.deepEqual(val(d, "r2", "blink"), ["a1", "a2"]);
  assert.deepEqual(val(d, "a1", "alink"), ["r1", "r2"]);
  assert.equal(txt(d, "r2", "blink"), "Κ. Π., A. B.");
  // stored once, under the smaller field id, with an id made of (f, a, b)
  assert.equal(d.links.length, 3);
  d.links.forEach((L) => { assert.equal(L.f, "alink"); assert.equal(L.id, C.linkId(L.f, L.a, L.b)); });
  // nothing in rec.v for a link field
  d.recs.forEach((r) => assert.ok(!("blink" in r.v) && !("alink" in r.v)));
});

test("editing from either side is the same link (R16) and only real changes move time (R27)", () => {
  const d = seed();
  const fromAuthor = C.setLinks(d, "alink", "a2", ["r2"], 400);
  assert.equal(S(fromAuthor), S(d));                     // already linked: nothing changes
  const e = C.setLinks(d, "alink", "a2", ["r2", "r3"], 400);
  assert.deepEqual(val(e, "r3", "blink"), ["a2"]);
  const again = C.setLinks(e, "blink", "r3", ["a2"], 500);
  assert.equal(S(again), S(e));
});

test("two devices adding different links to one record keep both; merge is symmetric", () => {
  const a = C.setLinks(seed(), "blink", "r3", ["a1"], 400);
  const b = C.setLinks(seed(), "blink", "r3", ["a2"], 401);
  const ab = C.merge(a, b), ba = C.merge(b, a);
  assert.equal(S(ab), S(ba));
  assert.equal(S(C.merge(ab, ab)), S(ab));
  assert.deepEqual(val(ab, "r3", "blink").slice().sort(), ["a1", "a2"]);
  // the same link made on two devices is one row
  const c = C.setLinks(seed(), "blink", "r3", ["a1"], 450);
  assert.equal(C.merge(a, c).links.filter((L) => L.b === "r3" || L.a === "r3").length, 1);
});

test("unlinking is a tombstone; a later link wins it back on every device", () => {
  const d = seed();
  const off = C.setLinks(d, "blink", "r2", ["a2"], 400);
  assert.deepEqual(val(off, "r2", "blink"), ["a2"]);
  assert.deepEqual(val(C.merge(d, off), "r2", "blink"), ["a2"]);
  const on = C.setLinks(off, "blink", "r2", ["a2", "a1"], 500);
  assert.deepEqual(val(C.merge(off, on), "r2", "blink").slice().sort(), ["a1", "a2"]);
  assert.deepEqual(val(C.merge(on, d), "r2", "blink").slice().sort(), ["a1", "a2"]);
});

test("a single-record link keeps one; a table linked to itself uses one field both ways", () => {
  let d = C.addLinkField(seed(), "tb", "Main author", "ta", 400, "Main of", { a: "bmain", b: "amain" }, true);
  d = C.setLinks(d, "bmain", "r1", ["a2", "a1"], 410);
  assert.deepEqual(val(d, "r1", "bmain"), ["a2"]);
  let s = C.addLinkField(seed(), "tb", "Series", "tb", 400, "", { a: "bser" });
  assert.equal(C.index(s).fields.bser.opt.inv, "bser");
  s = C.setLinks(s, "bser", "r1", ["r2", "r1"], 410);           // not to itself
  assert.deepEqual(val(s, "r1", "bser"), ["r2"]);
  assert.deepEqual(val(s, "r2", "bser"), ["r1"]);
  assert.equal(S(C.setLinks(s, "bser", "r2", ["r1"], 420)), S(s));
});

test("deleting a record, a link field or a table takes its links; Undo brings them back", () => {
  const d = seed();
  const noA1 = C.remove(d, "a1", 400);
  assert.deepEqual(val(noA1, "r2", "blink"), ["a2"]);
  assert.equal(noA1.links.length, 1);
  const back = C.restore(noA1, C.rowsUnder(d, "a1"), 500);
  assert.deepEqual(val(back, "r2", "blink").slice().sort(), ["a1", "a2"]);
  assert.deepEqual(val(C.merge(noA1, back), "a1", "alink").slice().sort(), ["r1", "r2"]);
  // a link field goes with its other side
  const noF = C.remove(d, "blink", 400);
  assert.ok(!C.index(noF).fields.alink && !noF.links.length);
  const backF = C.restore(noF, C.rowsUnder(d, "blink"), 500);
  assert.deepEqual(val(backF, "a1", "alink").slice().sort(), ["r1", "r2"]);
  // a table takes the link fields of other tables pointing at it
  const noT = C.remove(d, "ta", 400);
  assert.ok(!C.index(noT).fields.blink && !noT.links.length);
  const backT = C.restore(noT, C.rowsUnder(d, "ta"), 500);
  assert.deepEqual(val(backT, "r2", "blink").slice().sort(), ["a1", "a2"]);
  assert.deepEqual(val(C.merge(noT, backT), "a2", "alink"), ["r2"]);
});

test("a link to a record this copy has not seen yet is kept; a forged link id is dropped", () => {
  const d = seed();
  const later = C.addRecord(seed(), "ta", { aname: "New" }, 400, "a9");
  const linked = C.setLinks(later.data, "blink", "r3", ["a9"], 410);
  const L = linked.links.find((x) => x.a === "a9" || x.b === "a9");
  const partial = C.normalize(Object.assign({}, d, { links: d.links.concat([L]) }));
  assert.ok(partial.links.some((x) => x.id === L.id));          // a9 not here yet: kept
  assert.deepEqual(val(C.merge(partial, later.data), "r3", "blink"), ["a9"]);
  const bad = Object.assign({}, L, { id: "lforged" });
  assert.ok(!C.normalize(Object.assign({}, d, { links: [bad] })).links.length);
});

test("lookup, count and rollup read through the link", () => {
  let d = seed();
  d = C.addField(d, "ta", "Titles", "lookup", { via: "alink", f: "bname" }, 400, "atitles");
  d = C.addField(d, "ta", "Books #", "count", { via: "alink" }, 401, "acount");
  d = C.addField(d, "ta", "Total", "rollup", { via: "alink", f: "bprice", fn: "SUM" }, 402, "asum");
  d = C.addField(d, "ta", "Average", "rollup", { via: "alink", f: "bprice", fn: "AVG" }, 403, "aavg");
  d = C.addField(d, "ta", "Latest", "rollup", { via: "alink", f: "bout", fn: "MAX" }, 404, "alast");
  d = C.addField(d, "ta", "All done", "rollup", { via: "alink", f: "bdone", fn: "AND" }, 405, "aand");
  d = C.addField(d, "ta", "Names", "rollup", { via: "alink", f: "bname", fn: "CONCAT" }, 406, "acat");
  const o = { locale: "en-GB" };
  assert.equal(txt(d, "a1", "atitles"), "Ποιήματα, Night train");
  assert.equal(val(d, "a1", "acount"), 2);
  assert.equal(val(d, "a2", "acount"), 1);
  assert.equal(val(d, "a1", "asum"), 30.5);
  assert.equal(txt(d, "a1", "asum", o), "30.50 €");
  assert.equal(val(d, "a1", "aavg"), 15.25);
  assert.equal(val(d, "a1", "alast"), "2026-03-01");
  assert.equal(val(d, "a1", "aand"), false);              // r2 is not ticked
  assert.equal(val(C.setValues(d, "r2", { bdone: true }, 500), "a1", "aand"), true);
  assert.equal(txt(d, "a1", "acat"), "Ποιήματα, Night train");
  // filters, sorts and groups use what the values are
  const ix = C.index(d);
  assert.equal(C.kindOf(ix, ix.fields.asum), "num");
  assert.equal(C.kindOf(ix, ix.fields.alast), "date");
  const v = Object.assign({}, ix.views.av1, { cfg: { conj: "and", filters: [{ f: "asum", op: "gt", v: 20 }], sorts: [], groups: [], hidden: [], order: [] } });
  assert.deepEqual(C.query(ix, v, {}).map((r) => r.id), ["a1"]);
  const v2 = Object.assign({}, v, { cfg: Object.assign({}, v.cfg, { filters: [], sorts: [{ f: "acount", d: -1 }] }) });
  assert.deepEqual(C.query(ix, v2, {}).map((r) => r.id), ["a1", "a2"]);
  const v3 = Object.assign({}, v, { cfg: Object.assign({}, v.cfg, { filters: [{ f: "atitles", op: "has", v: "night" }] }) });
  assert.deepEqual(C.query(ix, v3, {}).map((r) => r.id), ["a1", "a2"]);
  assert.equal(C.summary(ix, ix.tbRecs.ta, ix.fields.asum).sum, 48.5);
  // nothing computed is stored
  d.recs.forEach((r) => ["atitles", "acount", "asum", "aavg", "alast", "aand", "acat"].forEach((k) => assert.ok(!(k in r.v))));
});

test("formulas use {Field} names, the Spreadsheet's functions, and links", () => {
  let d = seed();
  d = C.addField(d, "tb", "Qty", "number", {}, 400, "bqty");
  d = C.setValues(d, "r1", { bqty: 3 }, 410);
  let ix = C.index(d);
  const ids = C.exprIds(ix, "tb", '{Price} * {Qty} + IF({Done}, 1, 0)');
  assert.deepEqual(ids, { expr: "{bprice} * {bqty} + IF({bdone}, 1, 0)" });
  assert.equal(C.exprNames(ix, "tb", ids.expr), "{Price} * {Qty} + IF({Done}, 1, 0)");
  assert.deepEqual(C.exprIds(ix, "tb", "{Nope} + 1"), { bad: "Nope" });
  // braces inside "strings" are text
  assert.deepEqual(C.exprIds(ix, "tb", '"{Nope}" & {Name}'), { expr: '"{Nope}" & {bname}' });
  d = C.addField(d, "tb", "Total", "formula", { expr: ids.expr, dec: 2 }, 420, "btot");
  d = C.addField(d, "tb", "Label", "formula", { expr: C.exprIds(ix, "tb", 'UPPER({Name}) & " – " & {Authors}').expr }, 421, "blab");
  d = C.addField(d, "tb", "Year", "formula", { expr: C.exprIds(ix, "tb", "YEAR({Out})").expr }, 422, "byear");
  d = C.addField(d, "tb", "Week later", "formula", { expr: C.exprIds(ix, "tb", "{Out} + 7").expr, as: "date" }, 423, "bweek");
  d = C.addField(d, "tb", "Bad", "formula", { expr: "{bprice} / 0" }, 424, "bbad");
  d = C.addField(d, "tb", "Cell", "formula", { expr: "A1 + 1" }, 425, "bcell");
  ix = C.index(d);
  assert.equal(val(d, "r1", "btot"), 38.5);
  assert.equal(txt(d, "r1", "btot", { locale: "en-GB" }), "38.50");
  assert.equal(val(d, "r2", "btot"), 0);
  assert.equal(val(d, "r1", "blab"), "ΠΟΙΉΜΑΤΑ – Κ. Π.");
  assert.equal(val(d, "r2", "byear"), 2025);
  assert.equal(val(d, "r1", "bweek"), "2026-03-08");
  assert.equal(val(d, "r1", "bbad"), "#DIV/0!");
  assert.equal(val(d, "r1", "bcell"), "#REF!");                  // no cell references
  assert.equal(C.kindOf(ix, ix.fields.btot), "num");
  assert.equal(C.kindOf(ix, ix.fields.blab), "text");
  assert.equal(C.kindOf(ix, ix.fields.bweek), "date");
  // a renamed field keeps the formula working
  d = C.putRow(d, "fields", Object.assign({}, ix.fields.bqty, { name: "Copies" }), 430);
  assert.equal(val(d, "r1", "btot"), 38.5);
  assert.equal(C.exprNames(C.index(d), "tb", ix.fields.btot.opt.expr), "{Price} * {Copies} + IF({Done}, 1, 0)");
  d.recs.forEach((r) => ["btot", "blab", "byear"].forEach((k) => assert.ok(!(k in r.v))));
});

test("a formula or rollup that reads itself gives #CYC!, never a hang", () => {
  let d = seed();
  d = C.addField(d, "tb", "A", "formula", { expr: "{bfb} + 1" }, 400, "bfa");
  d = C.addField(d, "tb", "B", "formula", { expr: "{bfa} + 1" }, 401, "bfb");
  assert.equal(val(d, "r1", "bfa"), "#CYC!");
  // across tables: a book's formula reads an author rollup that reads the formula
  d = C.addField(d, "tb", "C", "formula", { expr: "{bcalc}" }, 402, "bcalc");
  d = C.addField(d, "ta", "Sum C", "rollup", { via: "alink", f: "bloop", fn: "SUM" }, 403, "aloop");
  d = C.addField(d, "tb", "Loop", "lookup", { via: "blink", f: "aloop" }, 404, "bloop2");
  d = C.putRow(d, "fields", Object.assign({}, C.index(d).fields.bcalc, { opt: { expr: "{bloop2} + 1" } }), 405);
  d = C.addField(d, "tb", "Loop src", "formula", { expr: "{bcalc}" }, 406, "bloop");
  const v = val(d, "r1", "bcalc");
  assert.ok(typeof v === "string" && v.charAt(0) === "#", String(v));
});

test("lookups and rollups of a removed link field show nothing; old copies without links merge", () => {
  let d = seed();
  d = C.addField(d, "ta", "Titles", "lookup", { via: "alink", f: "bname" }, 400, "atitles");
  const gone = C.remove(d, "blink", 500);
  assert.equal(val(gone, "a1", "atitles"), undefined);
  // a copy from a device without links (wave B1) loses none of them in a merge
  const b1 = JSON.parse(JSON.stringify(d));
  delete b1.links;
  assert.equal(S(C.merge(d, b1)), S(C.merge(b1, d)));
  assert.equal(C.merge(d, b1).links.length, 3);
});

test("CSV and Spreadsheet rows carry computed values as text and numbers", () => {
  let d = seed();
  d = C.addField(d, "ta", "Total", "rollup", { via: "alink", f: "bprice", fn: "SUM" }, 400, "asum");
  const ix = C.index(d);
  const fields = ix.tbFields.ta;
  const csv = C.toCsv(ix, fields, ix.tbRecs.ta);
  assert.match(csv, /Κ\. Π\.,"Ποιήματα, Night train",30\.5/);
  const rows = C.toTable(ix, fields, ix.tbRecs.ta);
  assert.equal(rows[1][2], 30.5);
});

test("junk links and options are cleaned, never thrown on", () => {
  const d = seed();
  const junk = Object.assign({}, d, {
    links: [null, 5, { id: 1 }, { f: "blink", a: "r1", b: "a1" }, { id: C.linkId("x", "y", "z"), f: "x", a: "y", b: "z", m: "soon" }],
    fields: d.fields.concat([{ id: "fj", tb: "tb", name: "J", type: "formula", opt: { expr: 5, dec: "x", as: "time" } },
      { id: "fk", tb: "tb", name: "K", type: "rollup", opt: { via: 3, fn: "DROP" } }])
  });
  const n = C.normalize(junk);
  assert.ok(n.links.every((L) => L.id === C.linkId(L.f, L.a, L.b)));
  const ix = C.index(n);
  assert.deepEqual(ix.fields.fj.opt, { expr: "" });
  assert.deepEqual(ix.fields.fk.opt, { via: "", f: "", fn: "SUM" });
  assert.equal(val(n, "r1", "fj"), undefined);
  assert.equal(val(n, "r1", "fk"), undefined);
});
