// Assistant: change_item in Notes, Timesheet, Invoices (paid), Chore
// Wheel, Meal Planner, Travel, Split, Garage, Pet care, Workouts and
// Library (wave A3, assistant/edits2.js). Each change is written with
// the app's own stamps, and the stored copy is already what the app's
// own merge makes of it (byte for byte: opening the app rewrites and
// uploads nothing); texts longer than the app keeps are refused; Undo
// only takes back what nobody changed since.
// Run: node --test tests/

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { webcrypto } = require("crypto");
const E = require("../assistant/edits.js");
require("../assistant/edits2.js");

const NOW = 1790000000000;      // 2026-09-21
const T0 = NOW - 5 * 86400000;
const clone = (x) => JSON.parse(JSON.stringify(x));
const J = (x) => JSON.stringify(x);
function ok(args) { const r = E.normArgs(Object.assign({ ref: "r1" }, args)); assert.equal(r.ok, true, r.err); return r; }
function run(app, data, target, args, now) {
  const ch = ok(args);
  const p = E.plan(app, data, target, ch, now || NOW);
  if (!p.ok) return p;
  const a = E.apply(app, data, target, ch, now || NOW, p.before);
  assert.equal(a.ok, true, a.err);
  return Object.assign(a, { plan: p });
}
function src(rel) { return fs.readFileSync(path.join(__dirname, "..", rel), "utf8"); }
function blockOf(s, from, to) {
  const i = s.indexOf(from), j = s.indexOf(to, i);
  if (i < 0 || j < 0) throw new Error("missing block " + from);
  return s.slice(i, j);
}
const day = (ts) => { const t = new Date(ts); return t.getFullYear() + "-" + String(t.getMonth() + 1).padStart(2, "0") + "-" + String(t.getDate()).padStart(2, "0"); };
const TODAY = day(NOW);

test("edits2: the eleven apps are offered, loaded lazily, and need their cores", () => {
  ["notes", "timesheet", "invoices", "chores", "meals", "travel", "split", "garage", "petcare", "fitness", "library"].forEach((a) => {
    assert.ok(E.APP_IDS.includes(a), a);
    assert.deepEqual(E.editableApps([a]), [a]);
  });
  assert.deepEqual(E.actionsFor("invoices"), ["complete"]);
  assert.deepEqual(E.needs("todo"), []);
  assert.deepEqual(E.needs("chores"), [], "loaded here");
  assert.match(E.plan("chores", {}, { task: "x" }, ok({ action: "complete", date: "2026-09-20" })).err, /complete takes only ref/);
  assert.match(E.normArgs({ ref: "r1", action: "update", title: "x".repeat(301) }).err, /301 characters/);
  // Notes arrive whole (CT-N2K); each app refuses a note past its own limit.
  assert.equal(E.normArgs({ ref: "r1", action: "update", note: "x".repeat(1001) }).err, undefined);
});

// ---------- Notes ----------
const NS = src("notes/notes.js");
const NT = new Function(
  "var DATA_VER = 3, TOMB_PRUNE_DAYS = 30, DAY_MS = 864e5, SEED_NB_ID = 'nb-default';" +
  blockOf(NS, "  var H_MAX", "  function touchStruct") +
  blockOf(NS, "  // ---------- 7. Merge engine", "  function mergeNotesStates") +
  blockOf(NS, "  function mergeNotesStates", "\n  }\n") + "\n  }\n" +
  "return { canonNotes, mergeNotesStates };")();
function notesData() {
  return NT.canonNotes({
    ver: 3, notebooks: [{ id: "nb1", name: "Trips", mtime: T0, pos: 1 }],
    labels: [{ id: "l1", nb: "nb1", name: "Rome", color: 1, mtime: T0, pos: 1 }, { id: "l2", nb: "nb1", name: "Ideas", color: 2, mtime: T0, pos: 2 }],
    pages: [{ id: "p1", nb: "nb1", parent: null, title: "Rome", text: "Day 1: Colosseum", mtime: T0, pos: 1, labels: [], pinned: false, ct: T0, st: T0 },
            { id: "p2", nb: "nb1", parent: null, title: "Paris", text: "", mtime: T0 + 5, pos: 2, labels: [], pinned: false, ct: T0 + 5, st: T0 + 5 }],
    tombs: {}
  });
}
test("notes: text added, title, labels by name; NO-3 clocks; canonical; a newer edit elsewhere still wins; Undo", () => {
  const d = notesData();
  const r = run("notes", d, { page: "p1" }, { action: "update", text_add: "Day 2: Vatican", labels: ["rome"] });
  assert.deepEqual(r.plan.rows, [{ f: "labels", b: "", a: "Rome" }, { f: "text", b: "Day 1: Colosseum", a: "Day 1: Colosseum\n\nDay 2: Vatican" }]);
  const p = r.data.pages.find((x) => x.id === "p1");
  assert.equal(p.text, "Day 1: Colosseum\n\nDay 2: Vatican");
  assert.deepEqual([p.ct, p.st, p.mtime], [NOW, NOW, NOW]);
  assert.deepEqual(p.h, [T0]);
  assert.deepEqual(p.labels, ["l1"]);
  assert.equal(J(NT.canonNotes(clone(r.data))), J(r.data), "already canonical");
  assert.equal(J(NT.mergeNotesStates(r.data, d)), J(r.data), "the old copy merges in without a conflict copy");
  // a later edit of the same text on another device still wins, with no conflict copy
  const other = clone(r.data); const op = other.pages.find((x) => x.id === "p1");
  op.h = [T0, NOW]; op.text += "\nDay 3"; op.ct = op.mtime = NOW + 50;
  const m = NT.mergeNotesStates(r.data, other);
  assert.equal(m.pages.length, 2);
  assert.match(m.pages.find((x) => x.id === "p1").text, /Day 3$/);
  // limits, unknown labels
  assert.match(run("notes", d, { page: "p1" }, { action: "update", title: "x".repeat(201) }).err, /201 characters; a Notes title keeps 200/);
  assert.match(run("notes", d, { page: "p1" }, { action: "update", label: "Work" }).err, /no label named "Work".*Rome, Ideas/);
  assert.match(run("notes", d, { page: "p1" }, { action: "update", text: "Day 1: Colosseum" }).err, /Nothing would change/);
  // Undo
  const u = E.undo("notes", r.data, r.undo, NOW + 10);
  assert.equal(u.ok, true, u.err);
  const up = u.data.pages.find((x) => x.id === "p1");
  assert.equal(up.text, "Day 1: Colosseum");
  assert.deepEqual(up.labels, []);
  assert.equal(up.ct, NOW + 10);
  assert.equal(J(NT.canonNotes(clone(u.data))), J(u.data));
  assert.match(E.undo("notes", other, r.undo, NOW + 10).err, /changed since/);
});

// ---------- Timesheet ----------
const TS = require("../timesheet/core.js");
function tsData() {
  const s = new Date(2026, 8, 18, 9, 0).getTime();
  return TS.normalize({ ver: 1, clients: [], projects: [{ id: "proj01", name: "Site", client: "", color: 0, rate: 0, bill: 1, arch: 0, m: T0 }],
    entries: [{ id: "entry01", p: "proj01", desc: "Design", s: s, e: s + 2 * 3600000, billed: 0, m: T0 },
              { id: "entry02", p: "proj01", desc: "Running", s: NOW - 600000, e: 0, billed: 0, m: T0 }], prefs: {}, pm: 0 });
}
test("timesheet: an entry's text, day and hours in local time; a running one keeps its day; canonical; Undo", () => {
  const d = tsData();
  const r = run("timesheet", d, { entry: "entry01" }, { action: "reschedule", date: "2026-09-17", start: "10:00", end: "13:30" });
  assert.deepEqual(r.plan.rows, [{ f: "date", b: "2026-09-18", a: "2026-09-17" }, { f: "start", b: "09:00", a: "10:00" }, { f: "end", b: "11:00", a: "13:30" }]);
  const x = r.data.entries.find((e) => e.id === "entry01");
  assert.equal(x.s, new Date(2026, 8, 17, 10, 0).getTime());
  assert.equal(x.e, new Date(2026, 8, 17, 13, 30).getTime());
  assert.equal(x.m, NOW);
  assert.equal(J(TS.normalize(clone(r.data))), J(r.data));
  const r2 = run("timesheet", d, { entry: "entry01" }, { action: "reschedule", date: "2026-09-16" });
  assert.equal(r2.data.entries[0].e - r2.data.entries[0].s, 2 * 3600000, "the hours stay");
  assert.match(run("timesheet", d, { entry: "entry02" }, { action: "update", date: "2026-09-16" }).err, /still running/);
  assert.match(run("timesheet", d, { entry: "entry01" }, { action: "update", start: "12:00", end: "11:00" }).err, /end must be after start/);
  assert.match(run("timesheet", d, { project: "proj01" }, { action: "update", title: "x" }).err, /Only a Timesheet entry/);
  const u = E.undo("timesheet", r.data, r.undo, NOW + 1);
  assert.equal(u.ok, true, u.err);
  assert.equal(u.data.entries[0].s, d.entries[0].s);
  assert.equal(J(TS.normalize(clone(u.data))), J(u.data));
});

// ---------- Invoices ----------
const IV = require("../invoices/core.js");
function ivData() {
  const d = IV.empty();
  d.docs.push({ id: "doc0001", kind: "inv", st: "issued", ser: "inv", seq: 12, num: "12", date: "2026-09-01", due: "2026-09-15", cur: "EUR", cli: "",
    c: { name: "ACME" }, lines: [{ code: "", d: "Design", q: 1, unit: "", p: 10000, disc: 0, vat: 24 }], gDisc: 0, wht: 0, m: T0 });
  d.docs.push({ id: "doc0002", kind: "inv", st: "draft", cur: "EUR", cli: "", lines: [{ d: "x", q: 1, p: 100, vat: 0 }], m: T0 });
  return IV.normalize(d);
}
test("invoices: paid = a payment row as the app adds it, the rest owed or a part; drafts refused; Undo = a tombstone", () => {
  const d = ivData();
  assert.equal(IV.balance(d, IV.doc(d, "doc0001")), 12400);
  const r = run("invoices", d, { invoice: "doc0001" }, { action: "complete", date: "2026-09-20", how: "bank" });
  assert.deepEqual(r.plan.rows, [{ f: "status", b: "inv:overdue", a: "inv:paid" }, { f: "paid", b: "0.00 EUR", a: "124.00 EUR (2026-09-20)" }, { f: "owed", b: "124.00 EUR", a: "0.00 EUR" }]);
  assert.equal(r.data.pays.length, 1);
  const p = r.data.pays[0];
  assert.deepEqual([p.doc, p.date, p.amt, p.how, p.m], ["doc0001", "2026-09-20", 12400, "bank", NOW]);
  assert.equal(J(IV.normalize(clone(r.data))), J(r.data));
  const part = run("invoices", d, { invoice: "doc0001" }, { action: "complete", amount: 50 });
  assert.equal(IV.status(part.data, IV.doc(part.data, "doc0001"), TODAY), "overdue");
  assert.equal(part.data.pays[0].date, TODAY);
  assert.equal(part.data.pays[0].how, "other");
  assert.match(run("invoices", d, { invoice: "doc0001" }, { action: "complete", amount: 200 }).err, /more than what is owed/);
  assert.match(run("invoices", r.data, { invoice: "doc0001" }, { action: "complete" }).err, /already paid/);
  assert.match(run("invoices", d, { invoice: "doc0002" }, { action: "complete" }).err, /draft/);
  assert.match(E.normArgs({ ref: "r1", action: "complete", how: "cheque" }).err, /how must be one of/);
  const u = E.undo("invoices", r.data, r.undo, NOW + 5);
  assert.equal(u.ok, true, u.err);
  assert.deepEqual(u.data.pays, [{ id: p.id, m: NOW + 5, del: 1 }]);
  assert.equal(IV.balance(u.data, IV.doc(u.data, "doc0001")), 12400);
  assert.equal(J(IV.normalize(clone(u.data))), J(u.data));
});

// ---------- Chore Wheel ----------
const CH = require("../chores/core.js");
function chData() {
  return CH.mergeChores({ ver: 1, members: [{ id: "memaaa", m: T0, name: "Anna", color: 0, icon: "", order: 0, om: T0 }],
    tasks: [{ id: "taskaa", m: T0, name: "Dishes", icon: "", freq: { k: "d" }, weight: 1, mode: "rr", who: [], start: "2026-09-01", off: 0 }],
    done: {}, set: {}, tombs: {} }, null, NOW);
}
test("chores: done today by the one whose turn it is, as ticking the row; not done again; rename; canonical; Undo", () => {
  const d = chData();
  const r = run("chores", d, { task: "taskaa" }, { action: "complete" });
  assert.deepEqual(r.plan.rows, [{ f: "done", b: false, a: true }, { f: "by", b: "", a: "Anna" }]);
  assert.deepEqual(r.data.done["taskaa|" + TODAY], [1, "memaaa", NOW]);
  assert.equal(J(CH.mergeChores(clone(r.data), null, NOW)), J(r.data));
  assert.match(run("chores", r.data, { task: "taskaa" }, { action: "complete" }).err, /already done/);
  const back = run("chores", r.data, { task: "taskaa" }, { action: "reopen" }, NOW + 10);
  assert.deepEqual(back.data.done["taskaa|" + TODAY], [0, "", NOW + 10]);
  const rn = run("chores", d, { task: "taskaa" }, { action: "update", title: "Wash the dishes" });
  assert.equal(rn.data.tasks[0].name, "Wash the dishes");
  assert.match(run("chores", d, { task: "taskaa" }, { action: "update", title: "x".repeat(51) }).err, /keeps 50/);
  const u = E.undo("chores", r.data, r.undo, NOW + 20);
  assert.equal(u.ok, true, u.err);
  assert.deepEqual(u.data.done["taskaa|" + TODAY], [0, "", NOW + 20]);
});

// ---------- Meal Planner ----------
const ML = require("../meals/core.js").OrosMealsCore || require("../meals/core.js");
function mlData() { return ML.mergeMeals({ ver: 1, rc: [{ id: "rc-moussaka", m: T0, t: "Moussaka", sv: 4, ig: [], st: [] }], tombs: {} }, null); }
test("meals: a recipe's title, notes and servings; canonical; limits; Undo", () => {
  const d = mlData();
  const r = run("meals", d, { recipe: "rc-moussaka" }, { action: "update", servings: 6, note: "Less salt" });
  assert.deepEqual(r.plan.rows, [{ f: "servings", b: "4", a: "6" }, { f: "note", b: "", a: "Less salt" }]);
  assert.equal(r.data.rc[0].sv, 6);
  assert.equal(r.data.rc[0].m, NOW);
  assert.equal(J(ML.mergeMeals(clone(r.data), null)), J(r.data));
  assert.match(run("meals", d, { recipe: "rc-moussaka" }, { action: "update", servings: 80 }).err, /servings must be 1-50/);
  assert.match(run("meals", d, { day: "2026-09-21" }, { action: "update", title: "x" }).err, /Only a recipe/);
  const u = E.undo("meals", r.data, r.undo, NOW + 1);
  assert.equal(u.ok, true, u.err);
  assert.equal(u.data.rc[0].sv, 4);
});

// ---------- Travel ----------
const TVS = src("travel/travel.js");
const TV = new Function("crypto", "var LANG = 'en';\n" + blockOf(TVS, "  // ---------- 1. Constants", "  // ---------- 4. Storage") +
  "\nreturn { TRIP_F, PACK_F, PLAN_F, mergeTravel };")(webcrypto);
function stamps(fields, s) { const f = {}; fields.forEach((k) => { f[k] = s; }); return f; }
function tvData() {
  return TV.mergeTravel({ ver: 1, trips: [{ id: "trip-rome", name: "Rome", dest: "Rome", start: "2026-10-01", end: "2026-10-05", people: [], notes: "", f: stamps(TV.TRIP_F, T0),
    pack: [{ id: "item-pass", name: "Passport", qty: 1, rule: null, grp: "@docs", who: "", note: "", done: false, f: stamps(TV.PACK_F, T0) }],
    plan: [{ id: "plan-flight", kind: "flight", title: "To Rome", day: "2026-10-01", t1: "09:00", day2: "", t2: "11:00", place: "", from: "ATH", to: "FCO", ref: "", note: "", pos: 0, f: stamps(TV.PLAN_F, T0) }],
    docs: [], spend: [], jrnl: [] }], tpls: [], tombs: {} }, null);
}
test("travel: packed / unpacked, an itinerary entry, the trip's dates; one stamp per changed field; canonical; Undo", () => {
  const d = tvData();
  const r = run("travel", d, { trip: "trip-rome", tab: "pack", item: "item-pass" }, { action: "complete" });
  const it = r.data.trips[0].pack[0];
  assert.equal(it.done, true);
  assert.equal(it.f.done, NOW);
  assert.equal(it.f.name, T0, "only the changed field is stamped");
  assert.equal(J(TV.mergeTravel(clone(r.data), null)), J(r.data));
  // a name changed on another device meanwhile stays
  const other = clone(d); other.trips[0].pack[0].name = "Passports"; other.trips[0].pack[0].f.name = NOW - 1;
  const m = TV.mergeTravel(r.data, other).trips[0].pack[0];
  assert.deepEqual([m.name, m.done], ["Passports", true]);
  const pl = run("travel", d, { trip: "trip-rome", tab: "plan", item: "plan-flight" }, { action: "reschedule", date: "2026-10-02", start: "07:30" });
  assert.match(run("travel", d, { trip: "trip-rome", tab: "plan", item: "plan-flight" }, { action: "update", note: "x".repeat(1001) }).err, /an itinerary note keeps 1000/);
  assert.deepEqual(pl.plan.rows, [{ f: "date", b: "2026-10-01", a: "2026-10-02" }, { f: "start", b: "09:00", a: "07:30" }]);
  const tr = run("travel", d, { trip: "trip-rome", tab: null, item: null }, { action: "reschedule", end_date: "2026-10-06" });
  assert.equal(tr.data.trips[0].end, "2026-10-06");
  assert.match(run("travel", d, { trip: "trip-rome", tab: null, item: null }, { action: "reschedule", end_date: "2026-09-01" }).err, /end before it starts/);
  assert.match(run("travel", d, { trip: "trip-rome", tab: "pack", item: "item-pass" }, { action: "update", title: "x".repeat(81) }).err, /keeps 80/);
  const u = E.undo("travel", r.data, r.undo, NOW + 3);
  assert.equal(u.ok, true, u.err);
  assert.equal(u.data.trips[0].pack[0].done, false);
  assert.equal(u.data.trips[0].pack[0].f.done, NOW + 3);
  assert.equal(J(TV.mergeTravel(clone(u.data), null)), J(u.data));
});

// ---------- Split ----------
const SPS = src("split/split.js");
const SP = new Function(blockOf(SPS, "  var STORAGE_KEY", "  // ---------- 1.") + blockOf(SPS, "  function cmpStr(", "  function newId(") +
  blockOf(SPS, "  // ---------- 2. Money", "  // ---------- 6. Storage") + "\nreturn { mergeSplit };")();
function spData() {
  return SP.mergeSplit({ ver: 1, groups: [{ id: "grpaaa", m: T0, n: "Crete", col: 0, cur: "EUR", arch: 0 }],
    people: [{ id: "grpaaa.pa", m: T0, n: "Me" }, { id: "grpaaa.pb", m: T0, n: "Nick" }],
    exp: [{ id: "grpaaa.e1", m: T0, t: "Dinner", a: 6400, d: "2026-09-19", c: "food", by: { "grpaaa.pa": 6400 }, mode: "eq", w: { "grpaaa.pa": 1, "grpaaa.pb": 1 }, n: "" },
          { id: "grpaaa.e2", m: T0, t: "Hotel", a: 20000, d: "2026-09-19", c: "other", by: { "grpaaa.pa": 10000, "grpaaa.pb": 10000 }, mode: "eq", w: { "grpaaa.pa": 1, "grpaaa.pb": 1 }, n: "" }],
    pay: [], mine: [], tombs: {} }, null);
}
test("split: an expense's title, day, note, and the amount of a simple one; canonical; Undo", () => {
  const d = spData();
  const r = run("split", d, { group: "grpaaa", exp: "grpaaa.e1" }, { action: "update", amount: 70, note: "with wine" });
  assert.deepEqual(r.plan.rows, [{ f: "amount", b: "64.00 EUR", a: "70.00 EUR" }, { f: "note", b: "", a: "with wine" }]);
  const x = r.data.exp[0];
  assert.deepEqual([x.a, x.by["grpaaa.pa"], x.m], [7000, 7000, NOW]);
  assert.equal(J(SP.mergeSplit(clone(r.data), null)), J(r.data));
  assert.match(run("split", d, { group: "grpaaa", exp: "grpaaa.e2" }, { action: "update", amount: 210 }).err, /change its amount in Split/);
  assert.match(run("split", d, { group: "grpaaa", exp: "grpaaa.e1" }, { action: "update", title: "x".repeat(61) }).err, /keeps 60/);
  const u = E.undo("split", r.data, r.undo, NOW + 1);
  assert.equal(u.ok, true, u.err);
  assert.equal(u.data.exp[0].a, 6400);
  assert.equal(J(SP.mergeSplit(clone(u.data), null)), J(u.data));
});

// ---------- Garage ----------
const GA = require("../garage/core.js");
function gaData() {
  return GA.merge({ ver: 1, vehicles: [{ id: "vehicle1", m: T0, name: "Golf", type: "car", fuel: "petrol" }],
    odo: [{ id: "odoaaaa1", m: T0, v: "vehicle1", d: "2026-09-01", km: 81000 }], settings: { m: 0, cur: "EUR" }, tombs: {} }, null, NOW);
}
test("garage: the odometer as a new reading of today, name and notes; never lower; canonical; Undo", () => {
  const d = gaData();
  const r = run("garage", d, "vehicle1", { action: "update", km: 81500 });
  assert.deepEqual(r.plan.rows, [{ f: "km", b: "81000", a: "81500" }]);
  const o = r.data.odo.find((x) => x.km === 81500);
  assert.deepEqual([o.v, o.d, o.m], ["vehicle1", TODAY, NOW]);
  assert.equal(r.data.vehicles[0].m, T0, "the vehicle row itself is untouched");
  assert.equal(J(GA.merge(clone(r.data), null, NOW)), J(r.data));
  assert.match(run("garage", d, "vehicle1", { action: "update", km: 80000 }).err, /already shows 81000 km/);
  assert.match(run("garage", d, "nosuchid", { action: "update", title: "x" }).err, /Only a vehicle/);
  const u = E.undo("garage", r.data, r.undo, NOW + 1);
  assert.equal(u.ok, true, u.err);
  assert.equal(GA.currentKm(u.data, "vehicle1"), 81000);
  assert.equal(J(GA.merge(clone(u.data), null, NOW + 1)), J(u.data));
});

// ---------- Pet care ----------
const PC = require("../petcare/core.js");
function pcData() {
  return PC.merge({ ver: 1, pets: [{ id: "petaaaa1", m: T0, name: "Rex", sp: "dog" }],
    recs: [{ id: "recaaaa1", p: "petaaaa1", k: "vacc", d: "2026-03-01", m: T0, n: "Rabies", nx: "2027-03-01" }], tombs: {} }, null, NOW);
}
test("petcare: a record's day, next date and notes; next after the day; canonical; Undo", () => {
  const d = pcData();
  const r = run("petcare", d, { pet: "petaaaa1", rec: "recaaaa1" }, { action: "reschedule", next: "2027-02-15" });
  assert.deepEqual(r.plan.rows, [{ f: "next", b: "2027-03-01", a: "2027-02-15" }]);
  assert.equal(r.data.recs[0].nx, "2027-02-15");
  assert.equal(J(PC.merge(clone(r.data), null, NOW)), J(r.data));
  assert.match(run("petcare", d, { pet: "petaaaa1", rec: "recaaaa1" }, { action: "reschedule", next: "2026-01-01" }).err, /must be after/);
  const u = E.undo("petcare", r.data, r.undo, NOW + 1);
  assert.equal(u.ok, true, u.err);
  assert.equal(u.data.recs[0].nx, "2027-03-01");
});

// ---------- Workouts ----------
const FS = src("fitness/fitness.js");
const FT = new Function("crypto", "var LANG = 'en';\n" + blockOf(FS, "  var STORAGE_KEY", "  // ---------- 1.") + blockOf(FS, "  var STRINGS", "  function newId(") +
  blockOf(FS, "  // ---------- 2. Ready", "  // ---------- 5. Storage") + "\nreturn { mergeFit };")(webcrypto);
test("fitness: a workout's name and note; canonical; Undo", () => {
  const d = FT.mergeFit({ ver: 1, ex: [], pg: [], wo: [{ id: "wo-1", m: T0, d: "2026-09-20", st: T0, en: T0 + 3600000, ti: "Legs", n: "", x: [] }], bm: [], set: null, tombs: {} }, null);
  const r = run("fitness", d, "wo-1", { action: "update", note: "Knee felt fine" });
  assert.equal(r.data.wo[0].n, "Knee felt fine");
  assert.equal(J(FT.mergeFit(clone(r.data), null)), J(r.data));
  const u = E.undo("fitness", r.data, r.undo, NOW + 1);
  assert.equal(u.ok, true, u.err);
  assert.equal(u.data.wo[0].n, "");
  assert.match(run("fitness", d, "wo-1", { action: "update", note: "x".repeat(1001) }).err, /1001 characters; a workout's notes keeps 1000/);
});

// ---------- Library ----------
const LB = require("../library/core.js");
test("library: finished today / not finished, title, author, tags; canonical; Undo", () => {
  const d = LB.mergeLibrary({ ver: 1, books: [{ id: "b" + "a".repeat(16), m: T0, fmt: "epub", title: "Night Sea" }], pos: {}, marks: [], tombs: {} }, null);
  const id = d.books[0].id;
  const r = run("library", d, { book: id }, { action: "complete" });
  assert.deepEqual(r.plan.rows, [{ f: "done", b: false, a: true }]);
  assert.equal(r.data.books[0].fin, TODAY);
  assert.equal(J(LB.mergeLibrary(clone(r.data), null)), J(r.data));
  const a = run("library", d, { book: id }, { action: "update", author: "Ann Writer", labels: ["sea", "novel"] });
  assert.deepEqual([a.data.books[0].by, a.data.books[0].tags], ["Ann Writer", ["sea", "novel"]]);
  assert.equal(J(LB.mergeLibrary(clone(a.data), null)), J(a.data));
  assert.match(run("library", r.data, { book: id }, { action: "complete" }).err, /already marked finished/);
  const u = E.undo("library", r.data, r.undo, NOW + 1);
  assert.equal(u.ok, true, u.err);
  assert.equal(u.data.books[0].fin, undefined);
});
test("travel: a change that makes an old tombstone go prunes it as Travel's merge does", () => {
  const d = tvData();
  d.tombs = { "gone-item-1": NOW - 182 * 86400000 };
  const r = run("travel", TV.mergeTravel(d, null), { trip: "trip-rome", tab: "pack", item: "item-pass" }, { action: "complete" });
  assert.equal(r.data.tombs["gone-item-1"], undefined);
  assert.equal(J(TV.mergeTravel(clone(r.data), null)), J(r.data));
});
