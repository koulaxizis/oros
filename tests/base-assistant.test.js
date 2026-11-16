// orOS Base wave B4b: the Assistant and orOS Gate add records to Base
// (create_items base, assistant/additems3.js) and read it (app_summary
// base, assistant/summary.js baseTables). OROS_BIBLE.md Part VI "Base" B4.
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
global.window = global.window || {};
const C = require("../base/core.js");
const N = require("../assistant/additems.js");
require("../assistant/additems3.js");
const S = require("../assistant/summary.js");
const AC = require("../assistant/core.js");
const G = require("../gate/gate.js");

const NAMES = { field: "Name", grid: "Grid", cards: "Cards" };
function seed() {
  let d = C.addBase(C.empty(), "Events", 100, "b1");
  d = C.addTable(d, "b1", "Guests", 110, NAMES, { t: "t1", f: "fname", v1: "v1", v2: "v2" });
  d = C.addField(d, "t1", "Seats", "number", { dec: 0 }, 121, "fseat");
  d = C.addField(d, "t1", "Menu", "select", { ch: [{ id: "o1", n: "Meat", c: "red" }] }, 122, "fmenu");
  d = C.addField(d, "t1", "Needs", "multi", { ch: [{ id: "n1", n: "Parking", c: "gray" }] }, 123, "fneed");
  d = C.addField(d, "t1", "Comes", "check", {}, 124, "fyes");
  d = C.addField(d, "t1", "Day", "date", {}, 125, "fday");
  d = C.addField(d, "t1", "Total", "formula", { expr: "{fseat}*2" }, 126, "ftot");
  d = C.addField(d, "t1", "Photo", "file", {}, 127, "fpic");
  d = C.addRecord(d, "t1", { fname: "Ann", fseat: 2 }, 130, "r1").data;
  return JSON.parse(JSON.stringify(d));
}
const norm = (items) => N.normItems({ app: "base", items }, {});

test("create_items base: values by field name, choices by label, a look-alike starts unticked", () => {
  const nm = norm([
    { fields: [{ name: "name", value: "Ann" }, { name: "Seats", value: "3" }] },
    { table: "guests", fields: [{ name: "Name", value: "Bob" }, { name: "menu", value: "Vegan" }, { name: "Needs", choices: ["parking", "Ramp"] },
                                 { name: "Comes", value: "yes" }, { name: "Day", value: "2026-12-01" }] }
  ]);
  assert.equal(nm.ok, true, nm.err);
  const d = seed(), before = JSON.stringify(d);
  const pl = N.plan("base", d, nm.items, {});
  assert.equal(pl.ok, true, pl.err);
  assert.equal(JSON.stringify(d), before, "plan never changes the data (a new choice stays in its copy)");
  assert.equal(pl.rows[0].title, "Ann");
  assert.deepEqual(pl.rows[0].dup.target, { base: "b1", table: "t1", rec: "r1" });
  assert.equal(pl.rows[1].dup, null);
  assert.deepEqual(pl.rows[1].fields[0], ["table", "Guests"]);
  assert.match(pl.rows[1].fields[1][1], /Menu: Vegan/);
  pl.rows.forEach((r) => r.fields.forEach((f) => assert.match(f[0], /^[a-z]{1,12}$/, "card labels are f.* keys")));

  const ap = N.apply("base", d, nm.items, 5000, { 0: 1 }, {});
  assert.equal(ap.ok, true, ap.err);
  assert.equal(ap.made.length, 1);
  const out = C.index(C.normalize(ap.data));
  const rec = out.recs[ap.made[0].id];
  assert.equal(rec.v.fname, "Bob");
  assert.equal(rec.v.fyes, true);
  assert.equal(rec.v.fday, "2026-12-01");
  const menu = out.fields.fmenu.opt.ch.find((c) => c.n === "Vegan");
  assert.ok(menu, "a label not there yet becomes a choice");
  assert.equal(rec.v.fmenu, menu.id);
  assert.equal(rec.v.fneed.length, 2);
  assert.ok(rec.v.fneed.indexOf("n1") >= 0, "an existing label is matched however it is written");
  assert.deepEqual(ap.made[0].target, { base: "b1", table: "t1", rec: ap.made[0].id });
  // the same label makes the same choice id on every device (Forms' rule)
  const again = N.apply("base", seed(), nm.items, 9000, { 0: 1 }, {});
  assert.equal(C.index(C.normalize(again.data)).fields.fmenu.opt.ch.find((c) => c.n === "Vegan").id, menu.id);

  const un = N.undo("base", ap.data, ap.undo, 6000);
  assert.equal(un.ok, true, un.err);
  assert.equal(C.index(un.data).recs[ap.made[0].id], undefined);
  assert.ok(C.index(un.data).recs.r1, "the record that was there stays");
  // a record changed in Base since is not taken back
  const changed = C.setValues(ap.data, ap.made[0].id, { fseat: 9 }, 7000);
  assert.equal(N.undo("base", changed, ap.undo, 8000).ok, false);
});

test("create_items base: refused, never dropped", () => {
  const d = seed();
  const err = (items) => { const nm = norm(items); return nm.ok ? N.plan("base", d, nm.items, {}).err : nm.err; };
  assert.match(err([{ fields: [{ name: "Total", value: "3" }] }]), /worked out by Base/);
  assert.match(err([{ fields: [{ name: "Photo", value: "a.jpg" }] }]), /attachments/);
  assert.match(err([{ fields: [{ name: "Nope", value: "1" }] }]), /no field Nope\. Its fields: Name, Seats/);
  assert.match(err([{ fields: [{ name: "Day", value: "soon" }] }]), /YYYY-MM-DD/);
  assert.match(err([{ fields: [{ name: "Seats", value: "many" }] }]), /does not fit/);
  assert.match(err([{ table: "Hosts", fields: [{ name: "Name", value: "x" }] }]), /table Hosts is not in/);
  assert.match(err([{ fields: [] }]), /fields .*required/);
  assert.match(err([{ fields: [{ name: "Name", value: "a" }, { name: "name", value: "b" }] }]), /twice/);
  assert.match(N.plan("base", null, norm([{ fields: [{ name: "Name", value: "x" }] }]).items, {}).err, /open Base once/);
  // two bases: the base must be named
  const two = C.addBase(d, "Shop", 200, "b2");
  assert.match(N.plan("base", two, norm([{ fields: [{ name: "Name", value: "x" }] }]).items, {}).err, /several bases/);
  assert.equal(N.plan("base", two, norm([{ base: "events", fields: [{ name: "Name", value: "x" }] }]).items, {}).ok, true);
});

test("app_summary base: bases, tables, fields; with table its records with refs", () => {
  const d = seed();
  const a = S.normArgs({ app: "base", table: "Guests", base: "Events" }, "2026-11-15");
  assert.equal(a.table, "Guests");
  assert.equal(a.base, "Events");
  const all = S.baseTables(C, d, {});
  assert.equal(all.bases[0].tables[0].records, 1);
  const f = all.bases[0].tables[0].fields;
  assert.deepEqual(f.find((x) => x.name === "Menu").choices, ["Meat"]);
  assert.equal(f.find((x) => x.name === "Total").read_only, true);
  assert.equal(f.find((x) => x.name === "Photo").type, "attachments");
  const one = S.baseTables(C, d, a);
  assert.equal(one.items.length, 1);
  assert.equal(one.items[0].title, "Ann");
  assert.equal(one.items[0].values.Seats, "2");
  assert.deepEqual(one.items[0].target, { base: "b1", table: "t1", rec: "r1" });
  assert.match(S.baseTables(C, d, { table: "x" }).err, /Events › Guests/);
  assert.deepEqual(S.preview(one, "en").slice(0, 2), ["Events › Guests: 1 record", "Ann"]);
  assert.equal(S.baseTables(C, null, {}).bases.length, 0);
  assert.ok(S.OWN.base, "list_apps marks Base with a summary");
});

test("Assistant and orOS Gate both offer Base (GATE-PAR)", () => {
  assert.ok(N.APP_IDS.indexOf("base") >= 0);
  assert.ok(G.ACT.indexOf("base") >= 0, "the gate changes Base through the Assistant's own tools");
  const t = AC.toolsFor({ data: true, summary: true, creates: ["base"] });
  const cr = t.find((x) => x.name === "create_items");
  assert.ok(cr.params.properties.app.enum.indexOf("base") >= 0);
  const props = cr.params.properties.items.items.properties;
  assert.deepEqual(Object.keys(props).sort(), ["base", "fields", "table"], "only Base's own fields");
  assert.deepEqual(Object.keys(props.fields.items.properties).sort(), ["choices", "name", "value"]);
  assert.match(t.find((x) => x.name === "app_summary").description, /base \(Base/);
  assert.deepEqual(AC.crUnknown("base", [{ fields: [{ name: "a", value: "b", extra: 1 }] }]).bad, ["items[0].fields[0].extra"]);
});
