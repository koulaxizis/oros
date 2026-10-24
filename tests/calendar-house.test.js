// Calendars shared with a household (calendar/house.js, BR-HH): a
// calendar built from a household document projects back to exactly
// that document (no endless uploads), reminders stay personal, edits
// from two people meet field by field through household/core.js, and
// the device-local mirror for the shell is written only on a change.
// Run: node --test tests/

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
globalThis.OrosCalOccur = require("../calendar/occur.js");
const H = require("../calendar/house.js");
const C = require("../household/core.js");

function ev(id, title, more) {
  return Object.assign({ id, date: "2026-11-02", dateEnd: null, start: null, end: null, title, note: "", location: "",
                         labelId: "lbl-x", recur: null, remindMin: null, mtime: 1 }, more || {});
}
const LABEL = { id: "lbl-x", name: "Home", color: "#9ece6a" };
// What calendar.js does: share = apply the projection; edit = apply the diff.
function share(events, t, by) {
  const p = H.project(LABEL, events);
  return C.apply(C.empty("cal"), { set: p.items, m: { t: p.m.t, c: p.m.c } }, t, by);
}
function edit(doc, before, after, t, by) {
  const d = C.diffItems(H.project(LABEL, before).items, H.project(LABEL, after).items, H.FIELDS);
  return d ? C.apply(doc, { set: d.set, del: d.del }, t, by) : doc;
}
function memLS() {
  const m = {};
  return { m, getItem: (k) => (k in m ? m[k] : null), setItem: (k, v) => { m[k] = String(v); }, removeItem: (k) => { delete m[k]; } };
}

test("a built calendar projects back to its document: nothing to send", () => {
  const doc = share([
    ev("a", "Dentist", { start: "09:30", end: "10:00", location: "Main st 4", note: "bring card", tz: "Europe/Athens" }),
    ev("b", "Bins out", { recur: { freq: "W", interval: 1, byday: [1], until: null, count: null, exdates: [] } }),
    ev("c", "Trip", { dateEnd: "2026-11-05" })
  ], 10, "m1");
  const v = C.view(doc, ["o"]);
  const built = H.build(v, "D1", {});
  assert.equal(built.label.id, "hh-D1");
  assert.equal(built.label.name, "Home");
  assert.equal(built.label.color, "#9ece6a");
  assert.equal(built.events.length, 3);
  built.events.forEach((e) => assert.equal(e.labelId, "hh-D1"));
  assert.equal(built.events.find((e) => e.id === "a").tz, "Europe/Athens");
  assert.equal(built.events.find((e) => e.id === "a").hhBy, "m1");
  assert.equal(C.diffItems(H.project(built.label, built.events).items, H.project(LABEL, C.view(doc).items).items, H.FIELDS), null);
  const p = H.project(built.label, built.events);
  assert.deepEqual(p.m, { t: "Home", c: "#9ece6a" });
  const fromDoc = {};
  v.items.forEach((it) => { fromDoc[it.id] = {}; H.FIELDS.forEach((f) => { fromDoc[it.id][f] = it[f] === undefined ? null : it[f]; }); });
  assert.equal(C.diffItems(fromDoc, p.items, H.FIELDS), null);
});

test("reminders stay on this device and never reach the document", () => {
  const doc = share([ev("a", "Dentist", { start: "09:30", remindMin: 60 })], 10, "m1");
  assert.equal(JSON.stringify(doc).indexOf("remind"), -1);
  const built = H.build(C.view(doc), "D1", { a: 15 });
  assert.equal(built.events[0].remindMin, 15);
  assert.equal(H.build(C.view(doc), "D1", { a: 7 }).events[0].remindMin, null);   // not a preset
  assert.equal(H.build(C.view(doc), "D1", null).events[0].remindMin, null);
});

test("two people edit at once: both edits stay", () => {
  const base = share([ev("a", "Dentist"), ev("b", "Bins out")], 10, "m1");
  const calA = H.build(C.view(base), "D1", {}).events, calB = H.build(C.view(base), "D1", {}).events;
  const a2 = JSON.parse(JSON.stringify(calA)); a2[0].start = "09:00";
  const b2 = JSON.parse(JSON.stringify(calB)); b2[0].location = "Clinic"; b2.push(ev("c", "Party", { date: "2026-11-07" }));
  const docA = edit(base, calA, a2, 20, "m1"), docB = edit(base, calB, b2, 21, "m2");
  const m1 = C.merge(docA, docB), m2 = C.merge(docB, docA);
  assert.deepEqual(m1, m2);
  const got = H.build(C.view(m1), "D1", {}).events;
  const a = got.find((e) => e.id === "a");
  assert.equal(a.start, "09:00");
  assert.equal(a.location, "Clinic");
  assert.ok(got.find((e) => e.id === "c"));
});

test("a delete on one side and an edit on the other: the edit's fields do not bring it back half", () => {
  const base = share([ev("a", "Dentist")], 10, "m1");
  const cal = H.build(C.view(base), "D1", {}).events;
  const gone = edit(base, cal, [], 20, "m1");
  assert.equal(H.build(C.view(gone), "D1", {}).events.length, 0);
});

test("bad values from someone else's device are cleaned, an event without a day is left out", () => {
  const doc = C.apply(C.empty("cal"), { set: {
    a: { date: "2026-11-02", start: "9:30", end: "10:00", title: "x".repeat(200), tz: "bad zone" },
    b: { date: "not a day", title: "lost" },
    c: { date: "2026-11-03", dateEnd: "2026-11-01", title: "back" }
  }, m: { t: "Home", c: "#123456" } }, 10, "m2");
  const built = H.build(C.view(doc), "D1", {});
  assert.equal(built.label.color, "#7aa2f7");             // not a Calendar colour → the default
  assert.deepEqual(built.events.map((e) => e.id).sort(), ["a", "c"]);
  const a = built.events.find((e) => e.id === "a");
  assert.equal(a.start, null);
  assert.equal(a.title.length, 80);
  assert.equal(a.tz, undefined);
  assert.equal(built.events.find((e) => e.id === "c").dateEnd, null);
});

test("the own copy keeps the event ids, stamps them now and carries no reminders", () => {
  const doc = share([ev("a", "Dentist"), ev("b", "Bins out")], 10, "m1");
  const c = H.copyOf(C.view(doc), "D1", 5000);
  assert.equal(c.label.id, "lbc-D1");
  assert.equal(c.label.mtime, 5000);
  assert.deepEqual(c.events.map((e) => e.id).sort(), ["a", "b"]);
  c.events.forEach((e) => { assert.equal(e.labelId, "lbc-D1"); assert.equal(e.mtime, 5000); assert.equal(e.remindMin, null); assert.equal(e.hhBy, undefined); });
});

test("ids the household does not take are left out of the projection", () => {
  const p = H.project(LABEL, [ev("ok_1", "a"), ev("bad id/1", "b"), ev("x".repeat(80), "c")]);
  assert.deepEqual(Object.keys(p.items), ["ok_1"]);
  assert.ok(H.ID_RE.test("mh3k2abcde"));
});

test("the mirror for the shell is written only when it changed, and removed when nothing is shared", () => {
  let doc = share([ev("a", "Dentist", { start: "09:30" })], 10, "m1");
  let docs = [{ box: "B", id: "D1", kind: "cal", ready: true }];
  const Hh = { docs: () => docs, view: (box, id, q) => C.view(doc, q) };
  const ls = memLS();
  ls.setItem(H.REM_KEY, JSON.stringify({ a: 30 }));
  assert.equal(H.mirror(Hh, ls), true);
  const m = JSON.parse(ls.getItem(H.MIRROR_KEY));
  assert.equal(m.ver, 1);
  assert.equal(m.events[0].remindMin, 30);
  assert.equal(m.events[0].hhBy, undefined);
  assert.equal(m.labels[0].id, "hh-D1");
  assert.equal(H.mirror(Hh, ls), false);                    // same → no write
  doc = C.apply(doc, { set: { a: { title: "Dentist 2" } } }, 20, "m2");
  assert.equal(H.mirror(Hh, ls), true);
  docs = [];
  assert.equal(H.mirror(Hh, ls), true);
  assert.equal(ls.getItem(H.MIRROR_KEY), null);
  assert.equal(H.mirror(Hh, ls), false);
});

test("the shell's readers see the shared events next to the own ones", () => {
  const OCC = globalThis.OrosCalOccur;
  const doc = share([ev("a", "Dentist", { start: "09:30" })], 10, "m1");
  const evs = H.collect({ docs: () => [{ box: "B", id: "D1", kind: "cal", ready: true }, { box: "B", id: "D2", kind: "cal", ready: false }],
                          view: () => C.view(doc, ["o"]) }, {});
  assert.equal(evs.length, 1);
  assert.equal(OCC.eventsOn({ events: evs }, "2026-11-02").length, 1);
});
