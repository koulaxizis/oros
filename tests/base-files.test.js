// orOS Base wave B2b: several tables at once (Airtable CSVs, workbooks)
// with their links, Excel / ODS cells, the .orosbase file (bundle.js +
// recordpkg.js, add-only open), and Base as a Send target.
// Run: node --test tests/
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const C = require(path.join(ROOT, "base/core.js"));
const P = require(path.join(ROOT, "base/package.js"));
const K = require(path.join(ROOT, "recordpkg.js"));
const B = require(path.join(ROOT, "bundle.js"));
const F = require(path.join(ROOT, "fileopen.js"));
const S = require(path.join(ROOT, "send/core.js"));
const X = require(path.join(ROOT, "vendor/xlsx.full.min.js"));
const read = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");

const NOW = 1763000000000;
function base() { return C.addBase(C.normalize({}), "Press", NOW, "b1"); }
// every table's records as "cell | cell" lines (text as shown)
function shown(d, tables) {
  const ix = C.index(d);
  return tables.map((tb) => d.recs.filter((r) => r.t === tb).map((r) => ix.tbFields[tb].map((f) => C.text(ix, r, f)).join(" | ")));
}

const BOOKS = [["Name", "Authors", "Price"], ["Poems", "Smith, J.", "10"], ["Night train", "\"Smith, J.\",Doe", "12"], ["Alone", "", "5"]];
const AUTHORS = [["Name", "Books", "Country"], ["Smith, J.", "Poems,Night train", "GR"], ["Doe", "Night train", "US"]];

test("base files: Airtable CSVs of two tables become one link field pair", () => {
  const r = C.importTables(base(), "b1", [{ name: "Books", rows: BOOKS }, { name: "Authors", rows: AUTHORS }], NOW, {});
  assert.equal(r.tables.length, 2);
  assert.equal(r.count, 5);
  assert.equal(r.links, 1);                           // one pair, not two
  const f = r.data.fields;
  const a = f.find((x) => x.name === "Authors"), b = f.find((x) => x.name === "Books");
  assert.equal(a.type, "link"); assert.equal(b.type, "link");
  assert.equal(a.opt.inv, b.id); assert.equal(b.opt.inv, a.id);
  assert.equal(a.opt.to, r.tables[1]); assert.equal(b.opt.to, r.tables[0]);
  assert.equal(r.data.links.length, 3);               // both sides told the same links once
  for (const rec of r.data.recs) assert.ok(!(a.id in rec.v) && !(b.id in rec.v), "no text left under a link field");
  const [books, authors] = shown(r.data, r.tables);
  assert.equal(books[0], "Poems | Smith, J. | 10");
  assert.match(books[1], /^Night train \| (Doe, Smith, J\.|Smith, J\., Doe) \| 12$/);
  assert.equal(books[2], "Alone |  | 5");
  assert.equal(authors[0], "Smith, J. | Poems, Night train | GR");
  assert.equal(f.find((x) => x.name === "Price").type, "number");
  assert.equal(f.find((x) => x.name === "Country").type, "text");
  // the link rows follow the slice's rules: deterministic ids, stored once
  for (const l of r.data.links) assert.equal(l.id, C.linkId(l.f, l.a, l.b));
  assert.equal(C.serialize(C.normalize(r.data)), C.serialize(r.data));
});

test("base files: one side only gets a partner field named after the table", () => {
  const authors = [["Name", "Country"], ["Smith, J.", "GR"], ["Doe", "US"]];
  const r = C.importTables(base(), "b1", [{ name: "Books", rows: BOOKS }, { name: "Authors", rows: authors }], NOW, {});
  const inv = r.data.fields.find((x) => x.tb === r.tables[1] && x.type === "link");
  assert.equal(inv.name, "Books");
  assert.equal(r.data.links.length, 3);
});

test("base files: what is not a link stays text", () => {
  // a column with one name the other table does not have, no heading match
  const notes = [["Name", "Seen with"], ["a", "Doe"], ["b", "Somebody else"]];
  const people = [["Name"], ["Doe"], ["Smith"]];
  let r = C.importTables(base(), "b1", [{ name: "Notes", rows: notes }, { name: "People", rows: people }], NOW, {});
  assert.equal(r.links, 0);
  assert.equal(r.data.fields.find((x) => x.name === "Seen with").type, "text");
  // a single matching cell without a heading match is too little
  r = C.importTables(base(), "b1", [{ name: "Notes", rows: [["Name", "Who"], ["a", "Doe"]] }, { name: "People", rows: people }], NOW, {});
  assert.equal(r.links, 0);
  // the heading names the table: 4 of 5 is enough
  const tasks = [["Name", "People"], ["t1", "Doe"], ["t2", "Smith"], ["t3", "Doe"], ["t4", "Smith"], ["t5", "Nobody"]];
  r = C.importTables(base(), "b1", [{ name: "Tasks", rows: tasks }, { name: "People", rows: people }], NOW, {});
  assert.equal(r.links, 1);
  assert.equal(r.data.links.length, 4);               // "Nobody" is not invented
  // numbers never link to a table named by numbers
  r = C.importTables(base(), "b1", [{ name: "A", rows: [["Name", "Year"], ["x", "2020"], ["y", "2021"]] },
    { name: "Years", rows: [["Name"], ["2020"], ["2021"]] }], NOW, {});
  assert.equal(r.links, 0);
  // the primary column is never a link
  r = C.importTables(base(), "b1", [{ name: "A", rows: [["Name"], ["Doe"], ["Smith"]] }, { name: "People", rows: people }], NOW, {});
  assert.equal(r.links, 0);
});

test("base files: names in a link cell (quotes, commas inside names)", () => {
  const known = { "smith, j.": ["r1"], doe: ["r2"], "a,b": ["r3"] };
  assert.deepEqual(C.splitNames("Smith, J.", known), ["smith, j."]);
  assert.deepEqual(C.splitNames("\"Smith, J.\",Doe", known), ["smith, j.", "doe"]);
  assert.deepEqual(C.splitNames("Doe, Smith, J.", known), ["doe", "smith, j."]);
  assert.deepEqual(C.splitNames("a,b", known), ["a,b"]);
  assert.deepEqual(C.splitNames("", known), []);
  assert.equal(C.splitNames("Doe, Nobody", known), null);
});

test("base files: Excel and ODS cells as the importer's text", () => {
  const ws = X.utils.aoa_to_sheet([["Name", "When", "At", "Pct", "Price", "Done", "Plain"],
    ["a", 46027, 46027.5, 0.125, 12.5, true, 1234.5]]);
  ws.B2.z = "m/d/yy"; ws.C2.z = "yyyy-mm-dd hh:mm"; ws.D2.z = "0.0%"; ws.E2.z = "#,##0.00 \"€\""; ws.G2.z = "#,##0.0";
  const wb = X.utils.book_new();
  X.utils.book_append_sheet(wb, ws, "Books");
  for (const bookType of ["xlsx", "ods"]) {
    const rd = X.read(new Uint8Array(X.write(wb, { type: "array", bookType })), { type: "array", cellNF: true });
    const s = rd.Sheets.Books;
    const row = ["A2", "B2", "C2", "D2", "E2", "F2", "G2"].map((k) => C.sheetCell(s[k], X.SSF));
    assert.equal(row[0], "a", bookType);
    assert.equal(row[1], "2026-01-05", bookType);     // m/d/yy is never read day-first
    assert.equal(row[2], "2026-01-05T12:00", bookType);
    assert.equal(row[3], "12.5%", bookType);
    assert.match(row[4], bookType === "xlsx" ? /^12[.,]50 €$/ : /^12\.5$/, bookType);   // SheetJS writes no currency into ODS
    assert.equal(row[5], "true", bookType);
    assert.equal(row[6], "1234.5", bookType);       // no thousands separator to misread
  }
  assert.equal(C.sheetCell({ t: "e", v: 7, w: "#DIV/0!" }, X.SSF), "");
  assert.equal(C.sheetCell(null, X.SSF), "");
  assert.equal(C.sheetCell({ t: "s", v: "=HACK()" }, X.SSF), "=HACK()");   // text, never run
  // through the importer: a date field and a percent field
  const r = C.importTables(base(), "b1", [{ name: "S", rows: [["Name", "When", "Pct"], ["a", "2026-01-05", "12.5%"], ["b", "2026-02-01", "50%"]] }], NOW, {});
  const types = r.data.fields.map((f) => f.type);
  assert.deepEqual(types, ["text", "date", "percent"]);
});

test("base files: one base as a file; opening adds only what is missing", async () => {
  let d = base();
  d = C.importTables(d, "b1", [{ name: "Books", rows: BOOKS }, { name: "Authors", rows: AUTHORS }], NOW, {}).data;
  d = C.addBase(d, "Other", NOW, "b2");
  d = C.importTables(d, "b2", [{ name: "Secret", rows: [["Name"], ["not in the file"]] }], NOW, {}).data;
  const one = C.onlyBase(d, "b1");
  assert.deepEqual(one.bases.map((b) => b.id), ["b1"]);
  assert.equal(one.recs.length, 5);
  assert.deepEqual(one.tombs, {});
  const o = K.pack(P.DESC, one, { title: "Press", now: NOW });
  assert.equal(o.mime, "application/x-oros-base");
  assert.deepEqual(o.preview.map((x) => x.name).sort(), ["Authors.csv", "Books.csv"]);
  const bytes = await B.write(o);
  assert.equal(B.sniff(bytes.subarray(0, 128)), "application/x-oros-base");
  const rd = await B.read(bytes, { mime: P.DESC.mime });
  assert.equal(rd.content.kind, "oros-base-package");
  assert.ok(!JSON.stringify(rd.content).includes("not in the file"));
  // a new device gets the base with its links
  const res = K.open(P.DESC, C.normalize({}), rd.content, { now: NOW + 1 });
  const next = P.settle(res.next, C.normalize({}), res.addedIds);
  assert.equal(next.recs.length, 5);
  assert.equal(next.links.length, 3);
  assert.deepEqual(shown(next, one.tables.map((t) => t.id)), shown(one, one.tables.map((t) => t.id)));
  // opening it again adds nothing
  assert.equal(K.open(P.DESC, next, rd.content, { now: NOW + 2 }).report.added, 0);
  // a record edited here stays; a record deleted here stays deleted
  const ix = C.index(next), price = next.fields.find((f) => f.name === "Price");
  const poems = next.recs.find((r) => C.text(ix, r, ix.tbFields[r.t][0]) === "Poems");
  let mine = C.setValues(next, poems.id, { [price.id]: 99 }, NOW + 10);
  mine = C.remove(mine, next.recs.find((r) => r.id !== poems.id).id, NOW + 11);
  const again = K.open(P.DESC, mine, rd.content, { now: NOW + 12 });
  const after = P.settle(again.next, mine, again.addedIds);
  assert.equal(after.recs.find((r) => r.id === poems.id).v[price.id], 99);
  assert.equal(after.recs.length, mine.recs.length);
  // a base deleted here stays deleted, and its rows are not counted as new
  const gone = C.remove(next, "b1", NOW + 15);
  const D = P.descFor(() => gone);
  const back = K.open(D, gone, rd.content, { now: NOW + 16 });
  assert.deepEqual(back.report, { added: 0, skipped: 0, updated: 0 });   // "Nothing to add"
  assert.equal(P.settle(back.next, gone, back.addedIds).recs.length, 0);
  // another base here is untouched, and a fresh device still gets everything
  assert.equal(K.open(P.descFor(() => C.normalize({})), C.normalize({}), rd.content, { now: NOW + 17 }).report.added, res.report.added);
  // Undo of an open: tombstones, the cascade takes the rest
  const undone = P.undo(next, res.addedIds, NOW + 20);
  assert.equal(undone.bases.length, 0);
  assert.equal(undone.recs.length, 0);
  assert.equal(undone.links.length, 0);
});

test("base files: hostile content is cleaned, stamps clamped, the cap holds", () => {
  const evil = { kind: "oros-base-package", ver: 1, data: {
    bases: [{ id: "b9", m: NOW * 10, name: "<img src=x onerror=alert(1)>" }],
    tables: [{ id: "t9", m: 1, base: "b9", name: "T", ord: 0, pf: "" }],
    fields: [{ id: "f9", m: 1, tb: "t9", name: "F", type: "formula", ord: 0, opt: { expr: "{f9}", junk: { deep: 1 } } }, { id: "__proto__", m: 1, tb: "t9" }],
    recs: [{ id: "r9", t: "t9", c: 1, m: 1, v: { f9: "stored?" }, fm: { f9: NOW * 10 } }],
    links: [{ id: "lforged", m: 1, f: "f9", a: "r9", b: "r9" }],
    tombs: { other: 1 } } };
  const res = K.open(P.DESC, C.normalize({}), evil, { now: NOW });
  const d = P.settle(res.next, C.normalize({}), res.addedIds);
  assert.ok(d.bases[0].m <= NOW + 5 * 60000);
  assert.equal(d.bases[0].name, "<img src=x onerror=alert(1)>");   // text; the app shows it with textContent
  assert.ok(!("f9" in d.recs[0].v), "a formula value is never stored");
  assert.equal(d.links.length, 0);                    // not a link field, forged id
  assert.ok(!d.fields.some((f) => f.id === "__proto__"));
  // the cap: the file's records over 20,000 are left out, never this device's
  const many = { bases: [{ id: "b1", m: 1, name: "B" }], tables: [{ id: "t1", m: 1, base: "b1", name: "T", ord: 0, pf: "" }], fields: [], views: [], links: [], tombs: {},
    recs: Array.from({ length: 30 }, (_, i) => ({ id: "x" + i, t: "t1", c: 1, m: 1, v: {}, fm: {} })) };
  const local = { bases: [{ id: "b1", m: 1, name: "B" }], tables: [{ id: "t1", m: 1, base: "b1", name: "T", ord: 0, pf: "" }],
    recs: Array.from({ length: C.MAX_RECS - 10 }, (_, i) => ({ id: "l" + i, t: "t1", c: 1, m: 1, v: {}, fm: {} })) };
  const r2 = K.open(P.DESC, C.normalize(local), { kind: "oros-base-package", ver: 1, data: many }, { now: NOW });
  const s2 = P.settle(r2.next, C.normalize(local), r2.addedIds);
  assert.equal(s2.recs.length, C.MAX_RECS);
  assert.equal(s2.recs.filter((r) => r.id[0] === "l").length, C.MAX_RECS - 10);
});

test("base files: Send to Base, Open with, file type, scripts", () => {
  const tg = S.target("base", "table", { name: "Sheet", rows: [["Name", "Price"], ["a", "1"]] });
  assert.deepEqual(tg, { newTable: { name: "Sheet", rows: [["Name", "Price"], ["a", "1"]] } });
  assert.equal(S.accepts("base", "table", { rows: [["only a heading"]] }), false);
  assert.ok(S.appsFor("table", { rows: [["Name"], ["a"]] }, ["base", "spreadsheet"]).includes("base"));
  assert.deepEqual(F.appsFor(".orosbase"), ["base"]);
  assert.deepEqual(B.TYPES[".orosbase"], { app: "base", mime: "application/x-oros-base" });
  const html = read("base/index.html");
  const at = (s) => html.indexOf('src="' + s);
  for (const s of ["core.js", "../bundle.js", "../recordpkg.js", "package.js", "app.js"]) assert.ok(at(s) > 0, s);
  assert.ok(at("core.js") < at("package.js") && at("package.js") < at("app.js"));
  assert.match(html, /data-app="base,recordpkg"/);
  const js = read("base/app.js");
  assert.match(js, /RP\.ui\(BPK\.descFor\(function \(\) \{ return data; \}\),/);
  assert.match(js, /if \(target\.openFile\) \{ if \(recFile\) recFile\.openTarget\(target\.openFile\); return; \}/);
  assert.match(js, /BPK\.undo\(data, ids, Date\.now\(\)\)/);
  assert.match(js, /BPK\.settle\(next, data,/);
  assert.match(js, /\.\.\/vendor\/xlsx\.full\.min\.js/);
  assert.doesNotMatch(js, /cellHTML: true|innerHTML\s*=\s*[a-z]+\.(name|rows)/);
  const en = read("base/help.en.txt"), el = read("base/help.el.txt");
  for (const h of [en, el]) { assert.ok(h.includes(".orosbase")); assert.ok(h.includes("Airtable")); }
});
