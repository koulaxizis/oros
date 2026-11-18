// orOS Base wave B4: the Forms bridge (addFromForms, formSpec) and the
// Calendar feed (base/feed.js). OROS_BIBLE.md Part VI "Base" B4.
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const C = require("../base/core.js");
const F = require("../base/feed.js");
const L = require("../forms/links.js");
const read = (f) => fs.readFileSync(path.join(__dirname, "..", f), "utf8");

const NAMES = { field: "Name", grid: "Grid", cards: "Cards" };
function seed() {
  let d = C.addBase(C.empty(), "Events", 100, "b1");
  d = C.addTable(d, "b1", "Guests", 110, NAMES, { t: "t1", f: "fname", v1: "v1", v2: "v2" });
  d = C.addField(d, "t1", "Email", "email", {}, 120, "fmail");
  d = C.addField(d, "t1", "Seats", "number", { dec: 0 }, 121, "fseat");
  d = C.addField(d, "t1", "Menu", "select", { ch: [{ id: "o1", n: "Meat", c: "red" }, { id: "o2", n: "Fish", c: "blue" }] }, 122, "fmenu");
  d = C.addField(d, "t1", "Needs", "multi", { ch: [{ id: "n1", n: "Parking", c: "gray" }] }, 123, "fneed");
  d = C.addField(d, "t1", "Comes", "check", {}, 124, "fyes");
  d = C.addField(d, "t1", "Day", "date", {}, 125, "fday");
  d = C.addField(d, "t1", "Stars", "rating", { max: 5 }, 126, "fstar");
  d = C.addField(d, "t1", "Total", "formula", { expr: "{Seats}*2" }, 127, "ftot");
  d = C.addField(d, "t1", "Photo", "file", {}, 128, "fpic");
  return d;
}
const K = (n) => "frm:form1:abcdefghij123456." + n;

test("formSpec gives Forms the fields a question can ask, with their choices", () => {
  const ix = C.index(seed());
  const spec = C.formSpec(ix, "t1");
  assert.equal(spec.base, "b1");
  assert.equal(spec.table, "t1");
  assert.deepEqual(spec.fields.map((f) => f.id), ["fname", "fmail", "fseat", "fmenu", "fneed", "fyes", "fday", "fstar"]);
  assert.deepEqual(spec.fields.find((f) => f.id === "fmenu").opts, { ch: [{ id: "o1", n: "Meat" }, { id: "o2", n: "Fish" }] });
  assert.deepEqual(spec.fields.find((f) => f.id === "fstar").opts, { max: 5 });
  // and Forms makes a form from it (the real forms/links.js)
  const form = L.fromTable(spec);
  assert.equal(form.qs.length, 8);
  assert.equal(form.set.base.b, "b1");
});

test("answers become records once, with labels turned into choices", () => {
  const d = seed();
  const r = C.addFromForms(d, { base: "b1", table: "t1", from: "forms", rows: [
    { key: K(1), values: { fname: "Ann", fmail: "a@b.gr", fseat: 2, fmenu: "Fish", fneed: ["Parking", "Wheelchair"], fyes: true, fday: "2026-12-01", fstar: 4 } },
    { key: K(2), values: { fname: "Bob", fmenu: "Vegan", fyes: false, ftot: 5, fpic: "x", gone: 1, fseat: "many" } },
    { key: "bad key", values: { fname: "X" } }
  ] }, 1000);
  assert.equal(r.added, 2);
  assert.equal(r.failed, 1);
  assert.equal(r.table, "t1");
  const ix = C.index(r.data);
  const recs = r.data.recs;
  assert.equal(recs.length, 2);
  const ann = recs.find((x) => x.v.fname === "Ann"), bob = recs.find((x) => x.v.fname === "Bob");
  assert.equal(ann.id, C.keyId(K(1)));
  assert.equal(C.text(ix, ann, ix.fields.fmenu), "Fish");
  assert.equal(C.text(ix, ann, ix.fields.fneed), "Parking, Wheelchair");
  assert.equal(ann.v.fyes, true);
  assert.equal(ann.v.fday, "2026-12-01");
  assert.equal(C.text(ix, bob, ix.fields.fmenu), "Vegan");                // "Other" → a new choice
  assert.equal(bob.v.fyes, undefined);                                    // no = not ticked, not skipped
  assert.deepEqual(r.rows[1].skipped.sort(), ["fpic", "fseat", "ftot", "gone"]);
  assert.deepEqual(r.rows[0].skipped, []);
  assert.ok(ann.c < bob.c);                                               // order kept
  // sent again: nothing new; a deleted answer stays deleted
  const again = C.addFromForms(C.remove(r.data, bob.id, 2000), { base: "b1", table: "t1", rows: [{ key: K(1), values: { fname: "Ann 2" } }, { key: K(2), values: { fname: "Bob" } }] }, 3000);
  assert.equal(again.added, 0);
  assert.equal(again.dup, 2);
  assert.equal(again.data.recs.find((x) => x.id === ann.id).v.fname, "Ann");
});

test("two devices that receive the same answers agree (same ids, same new choices)", () => {
  const ar = { base: "b1", table: "t1", rows: [{ key: K(7), values: { fname: "Cy", fmenu: "Vegan", fneed: ["Dog"] } }] };
  const a = C.addFromForms(seed(), ar, 5000).data;
  const b = C.addFromForms(seed(), ar, 6000).data;
  const m = C.merge(a, b), ix = C.index(m);
  assert.equal(m.recs.length, 1);
  assert.equal(C.text(ix, m.recs[0], ix.fields.fmenu), "Vegan");
  assert.equal(C.text(ix, m.recs[0], ix.fields.fneed), "Dog");
  assert.equal(C.serialize(C.merge(a, b)), C.serialize(C.merge(b, a)));
});

test("a wrong table, base or shape changes nothing; the cap is kept", () => {
  const d = seed();
  assert.equal(C.addFromForms(d, { base: "b1", table: "nope", rows: [] }, 1).error, "table");
  assert.equal(C.addFromForms(d, { base: "b2", table: "t1", rows: [] }, 1).error, "table");
  assert.equal(C.addFromForms(d, null, 1).error, "bad");
  const rows = Array.from({ length: 600 }, (_, i) => ({ key: K(i), values: { fname: "n" + i } }));
  const r = C.addFromForms(d, { base: "b1", table: "t1", rows }, 1);
  assert.equal(r.added, C.FORM_BATCH);
  const hostile = C.addFromForms(d, { base: "b1", table: "t1", rows: [{ key: K(9), values: { fname: { toString: 1 }, fmail: ["x"], fday: "2026-02-30", "__proto__": 1 } }] }, 1);
  assert.equal(hostile.added, 1);
  assert.deepEqual(hostile.data.recs[0].v, {});
});

test("the Calendar feed shows only date fields with Show in Calendar on, and survives an older device", () => {
  let d = seed();
  d = C.addRecord(d, "t1", { fname: "Ann", fday: "2026-12-01" }, 200, "r1").data;
  assert.deepEqual(F.byDay(d), {});                                       // off by default
  const f = d.fields.find((x) => x.id === "fday");
  d = C.putRow(d, "fields", Object.assign({}, f, { opt: { cal: true } }), 300);
  assert.equal(d.fields.find((x) => x.id === "fday").opt.cal, true);
  const days = F.byDay(d);
  assert.deepEqual(days["2026-12-01"], [{ rec: "r1", base: "b1", table: "t1", title: "Ann", fid: "fday", field: "Day", tname: "Guests", time: null }]);
  // a device before B4 keeps the field without cal at the same stamp: cal wins the tie
  const old = JSON.parse(JSON.stringify(d));
  old.fields.find((x) => x.id === "fday").opt = {};
  assert.equal(C.merge(d, old).fields.find((x) => x.id === "fday").opt.cal, true);
  assert.equal(C.merge(old, d).fields.find((x) => x.id === "fday").opt.cal, true);
  // a deleted record or table is not shown
  assert.deepEqual(F.byDay(C.remove(d, "r1", 400)), {});
  assert.deepEqual(F.byDay(C.remove(d, "t1", 400)), {});
  assert.deepEqual(F.byDay(null), {});
});

test("the app wires the bridge, the switch and the Calendar chip", () => {
  const app = read("base/app.js");
  assert.match(app, /if \(tg\.addRecords\) \{ closeAllDialogs\(\); takeForms\(tg\.addRecords\); return; \}/);
  assert.match(app, /__orosOpenAt\("forms", \{ fromTable: spec \}\)/);
  assert.match(app, /t\("cal\.feed"\)/);
  const cal = read("calendar/calendar.js");
  assert.match(cal, /\.concat\(baseFeedOn\(dateStr\)\)/);
  assert.match(cal, /"lbl-feed-base"/);
  const html = read("calendar/index.html");
  assert.ok(html.indexOf("../base/feed.js") > 0 && html.indexOf("../base/feed.js") < html.indexOf('src="calendar.js'));
  assert.match(read("sw.js"), /"base\/feed\.js",/);
  assert.ok(read("i18n/de/calendar.js").includes('"lbl.feed.base"'));
});
