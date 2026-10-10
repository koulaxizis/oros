// Shared read-only logic of Travel (travel/core.js): what the Calendar
// "Travel" feed shows and what the shell's reminder engine announces.
// Run: node --test tests/

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const C = require(path.join(__dirname, "..", "travel/core.js"));

function at(ymd, hm) {
  const [y, m, d] = ymd.split("-").map(Number), [h, mi] = hm.split(":").map(Number);
  return new Date(y, m - 1, d, h, mi).getTime();
}
function data(trips, tombs) { return { ver: 1, trips, tpls: [], tombs: tombs || {} }; }
function trip(o) {
  return Object.assign({ id: "trip-rome", name: "Rome", dest: "Rome, Italy", start: "2026-10-12", end: "2026-10-14",
    people: [], notes: "", f: {}, pack: [], plan: [] }, o);
}
function item(id, grp, done) { return { id, name: id, qty: 1, rule: null, grp, who: "", note: "", done, f: {} }; }
function entry(id, o) {
  return Object.assign({ id, kind: "flight", title: "", day: "2026-10-12", t1: "", day2: "", t2: "", place: "",
    from: "", to: "", ref: "", note: "", pos: 0, f: {} }, o);
}

test("trips: malformed rows and tombstoned trips, items and entries stay out", () => {
  const raw = data([
    trip({ pack: [item("sock", "@clothes", false), item("gone", "@clothes", false), item("pass", "@docs", true), item("keys", "@before", false)],
           plan: [entry("fl-1", { t1: "08:15" }), entry("dead", { t1: "09:00" }), { id: 5 }] }),
    trip({ id: "trip-gone" }), { id: "BAD ID" }, null, "x"
  ], { "trip-gone": 5, gone: 5, dead: 5 });
  const list = C.trips(raw);
  assert.equal(list.length, 1);
  assert.deepEqual(list[0].pack, { left: 1, before: 1, n: 3 });
  assert.deepEqual(list[0].plan.map((p) => p.id), ["fl-1"]);
  assert.deepEqual(C.trips(null), []);
  assert.deepEqual(C.trips({ trips: "no" }), []);
});

test("trips: bad dates and times are dropped, text is trimmed and cleaned", () => {
  const [t] = C.trips(data([trip({ name: "  Ro\u0007me  ", start: "2026-02-30", plan: [entry("ent-1", { t1: "25:00", day: "nope" })] })]));
  assert.equal(t.name, "Ro me");
  assert.equal(t.start, "");
  assert.equal(t.plan[0].t1, "");
  assert.equal(t.plan[0].day, "");
});

test("feed: one all-day row per trip day, timed entries at their time", () => {
  const rows = C.feedRows(C.trips(data([trip({ plan: [
    entry("fl-1", { from: "ATH", to: "FCO", t1: "08:15", t2: "10:05" }),
    entry("st-1", { kind: "stay", title: "Hotel", t1: "15:00", day2: "2026-10-14", t2: "11:00" }),
    entry("no-time", { kind: "activity" }),
    entry("night", { kind: "train", t1: "23:00", t2: "06:00" })
  ] })])));
  const days = rows.filter((r) => r.kind === "trip");
  assert.deepEqual(days.map((r) => [r.day, r.n, r.of]), [["2026-10-12", 1, 3], ["2026-10-13", 2, 3], ["2026-10-14", 3, 3]]);
  assert.ok(days.every((r) => r.start === null && r.trip === "trip-rome" && r.name === "Rome"));
  const timed = rows.filter((r) => r.kind !== "trip");
  assert.deepEqual(timed.map((r) => [r.entry.id, r.start, r.end]),
    [["fl-1", "08:15", "10:05"], ["st-1", "15:00", null], ["night", "23:00", null]]);
  assert.equal(C.entryTitle(timed[0].entry, "en"), "Flight ATH → FCO");
  assert.equal(C.entryTitle(timed[0].entry, "el"), "Πτήση ATH → FCO");
  assert.equal(C.entryTitle(timed[1].entry, "en"), "Hotel");
});

test("feed: no trip rows without valid dates, an unnamed trip uses its destination", () => {
  assert.equal(C.feedRows(C.trips(data([trip({ start: "", end: "" })]))).length, 0);
  assert.equal(C.feedRows(C.trips(data([trip({ start: "2026-10-14", end: "2026-10-12" })]))).length, 0);
  const rows = C.feedRows(C.trips(data([trip({ name: "", start: "2026-10-12", end: "2026-10-12" })])));
  assert.deepEqual(rows.map((r) => [r.name, r.of]), [["Rome, Italy", 1]]);
});

test("reminders: the evening before departure, from 18:00, with what is left", () => {
  const raw = data([trip({ pack: [item("a", "@clothes", false), item("b", "@clothes", false), item("c", "@before", false), item("d", "@docs", true)] })]);
  const list = C.trips(raw);
  assert.equal(C.due(list, at("2026-10-11", "17:59"), "en").length, 0);
  const [d] = C.due(list, at("2026-10-11", "18:00"), "en");
  assert.equal(d.key, "eve-trip-rome-2026-10-12");
  assert.equal(d.title, "Rome tomorrow");
  assert.equal(d.body, "2 items to pack, 1 thing to do before you leave");
  assert.equal(d.tab, "pack");
  assert.equal(C.due(list, at("2026-10-12", "07:00"), "en").length, 0);   // not on the day itself
  const [el] = C.due(list, at("2026-10-11", "21:00"), "el");
  assert.equal(el.title, "Rome αύριο");
  assert.equal(el.body, "2 είδη για τη βαλίτσα, 1 πράγμα πριν φύγεις");
  const done = C.trips(data([trip({ pack: [item("a", "@clothes", true)] })]));
  assert.equal(C.due(done, at("2026-10-11", "20:00"), "en")[0].body, "everything is packed");
  assert.equal(C.due(C.trips(data([trip()])), at("2026-10-11", "20:00"), "en")[0].body, "");
});

test("reminders: shortly before a timed departure (flight 3 h, train 1 h), never for a stay", () => {
  const list = C.trips(data([trip({ start: "2026-10-20", end: "2026-10-22", plan: [
    entry("fl-1", { from: "ATH", to: "FCO", t1: "08:15", ref: "XK12" }),
    entry("tr-1", { kind: "train", title: "To Florence", day: "2026-10-12", t1: "14:00" }),
    entry("st-1", { kind: "stay", day: "2026-10-12", t1: "15:00" })
  ] })]));
  assert.equal(C.due(list, at("2026-10-12", "05:14"), "en").length, 0);
  const [f] = C.due(list, at("2026-10-12", "05:15"), "en");
  assert.equal(f.key, "dep-fl-1-2026-10-12-0815");
  assert.equal(f.body, "Flight ATH → FCO at 08:15 · booking XK12");
  assert.equal(f.tab, "plan");
  assert.equal(C.due(list, at("2026-10-12", "08:15"), "en").length, 0);  // departed: nothing late
  assert.deepEqual(C.due(list, at("2026-10-12", "13:30"), "en").map((d) => d.key), ["dep-tr-1-2026-10-12-1400"]);
  assert.equal(C.due(list, at("2026-10-12", "14:30"), "en").length, 0);
});

test("pruneFired keeps recent keys only and survives garbage", () => {
  const now = at("2026-10-12", "12:00");
  const out = C.pruneFired({ a: now - 3600000, b: now - 4 * 86400000, c: "x", d: now + 5 * 86400000 }, now);
  assert.deepEqual(Object.keys(out), ["a"]);
  assert.deepEqual(C.pruneFired(null, now), {});
});
