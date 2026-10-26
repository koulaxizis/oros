// Assistant: new items in Timesheet, Meal Planner, Travel (a trip's
// itinerary and packing list) and Sticky Notes (wave A4,
// assistant/additems2.js), and the longer content that opens in an
// app's own "Send to…" receiver (propose_entry flashcards,
// wiki_article, document, mind_map). Each new record is what the
// app's own merge makes of it (byte for byte: opening the app
// rewrites nothing); texts longer than the app keeps are refused;
// a look-alike starts unticked; Undo only takes back what nobody
// changed since.
// Run: node --test tests/

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { webcrypto } = require("crypto");
const A = require("../assistant/additems.js");
require("../assistant/additems2.js");
const core = require("../assistant/core.js");
const TS = require("../timesheet/core.js");
const ML = require("../meals/core.js").OrosMealsCore || require("../meals/core.js");
const SN = require("../stickies/core.js");
const MAKE = require("../flashcards/make.js");

const NOW = 1790000000000;      // 2026-09-21
const T0 = NOW - 5 * 86400000;
const clone = (x) => JSON.parse(JSON.stringify(x));
const J = (x) => JSON.stringify(x);
function src(rel) { return fs.readFileSync(path.join(__dirname, "..", rel), "utf8"); }
function blockOf(s, from, to) {
  const i = s.indexOf(from), j = s.indexOf(to, i);
  if (i < 0 || j < 0) throw new Error("missing block " + from);
  return s.slice(i, j);
}
const lt = (ymd, hm) => { const p = ymd.split("-"); return new Date(+p[0], +p[1] - 1, +p[2], +hm.slice(0, 2), +hm.slice(3)).getTime(); };
function items(app, list, ctx) { const n = A.normItems({ app, items: list }, ctx); assert.equal(n.ok, true, n.err); return n.items; }
function err(app, list) { const n = A.normItems({ app, items: list }); assert.equal(n.ok, false); return n.err; }

test("the new apps are registered with their storage keys", () => {
  ["timesheet", "meals", "travel_plan", "travel_pack", "stickies"].forEach((id) => assert.ok(A.APP_IDS.includes(id), id));
  assert.equal(A.storageKey("travel_plan"), "oros-travel-data");
  assert.equal(A.storageKey("stickies"), "oros-stickies-data");
});

// ---------- Timesheet ----------
function tsData() {
  return TS.normalize({ ver: 1, clients: [], extras: [],
    projects: [{ id: "projglaro", name: "Glarolykoi", client: "", color: 0, rate: 0, bill: 1, arch: 0, m: T0 },
               { id: "projold01", name: "Old job", client: "", color: 1, rate: 0, bill: 0, arch: 1, m: T0 }],
    entries: [{ id: "entry00001", p: "projglaro", desc: "Cover", s: lt("2026-09-20", "09:00"), e: lt("2026-09-20", "10:00"), billed: 0, m: T0 }] });
}
test("timesheet: time worked with start and end or minutes, a project by name; canonical; look-alike; Undo", () => {
  const d = tsData();
  const it = items("timesheet", [
    { title: "Layout", date: "2026-09-21", start: "09:00", end: "11:30", project: "glarolykoi", task: "Book 3", labels: ["print"] },
    { title: "Cover", date: "2026-09-20", start: "09:00", minutes: 60, project: "Glarolykoi" },
    { title: "Admin", date: "2026-09-21", start: "23:30", minutes: 90 }
  ]);
  assert.equal(it[2].e - it[2].s, 90 * 60000, "minutes may run past midnight");
  const p = A.plan("timesheet", d, it, {});
  assert.equal(p.ok, true, p.err);
  assert.deepEqual(p.rows[0].fields, [["date", "2026-09-21"], ["start", "09:00"], ["end", "11:30"], ["minutes", "150"], ["project", "Glarolykoi"], ["task", "Book 3"], ["labels", "print"]]);
  assert.equal(p.rows[1].dup.target.entry, "entry00001", "the same project and times start unticked");
  assert.equal(p.rows[2].fields[2][1], "2026-09-22 01:00");
  const r = A.apply("timesheet", d, it, NOW, { 1: 1 }, {});
  assert.equal(r.ok, true, r.err);
  assert.equal(r.made.length, 2);
  const x = r.data.entries.find((e) => e.id === r.made[0].id);
  assert.deepEqual([x.p, x.desc, x.billed, x.task, x.tags, x.m], ["projglaro", "Layout", 0, "Book 3", ["print"], NOW]);
  assert.equal(J(TS.normalize(clone(r.data))), J(r.data), "stored = what Timesheet's merge makes of it");
  assert.equal(r.made[0].target.entry, x.id);
  // Undo: tombstones with a newer stamp; refused once changed
  const changed = clone(r.data);
  changed.entries.find((e) => e.id === x.id).desc = "Layout v2";
  assert.match(A.undo("timesheet", changed, r.undo, NOW + 1).err, /changed since/);
  const u = A.undo("timesheet", r.data, r.undo, NOW + 1);
  assert.equal(u.ok, true, u.err);
  r.made.forEach((m) => assert.deepEqual(u.data.entries.find((e) => e.id === m.id), { id: m.id, m: NOW + 1, del: 1 }));
  assert.equal(J(TS.normalize(clone(u.data))), J(u.data));
});
test("timesheet: refusals (no cut, no made-up project, archived, end before start)", () => {
  const d = tsData();
  assert.match(err("timesheet", [{ title: "x".repeat(501), date: "2026-09-21", start: "09:00", minutes: 10 }]), /keeps 500/);
  assert.match(err("timesheet", [{ title: "x", date: "2026-09-21", minutes: 10 }]), /start is required/);
  assert.match(err("timesheet", [{ title: "x", date: "2026-09-21", start: "09:00" }]), /end \(HH:MM\) or minutes/);
  assert.match(err("timesheet", [{ title: "x", date: "2026-09-21", start: "09:00", end: "08:00" }]), /end must be after start/);
  assert.match(err("timesheet", [{ title: "x", date: "2026-09-21", start: "09:00", end: "10:00", minutes: 30 }]), /don't agree/);
  assert.match(err("timesheet", [{ date: "2026-09-21", start: "09:00", minutes: 30 }]), /title .* or a project/);
  assert.match(A.plan("timesheet", d, items("timesheet", [{ title: "x", date: "2026-09-21", start: "09:00", minutes: 5, project: "Nope" }]), {}).err, /no project named "Nope".*Glarolykoi/);
  assert.match(A.plan("timesheet", d, items("timesheet", [{ title: "x", date: "2026-09-21", start: "09:00", minutes: 5, project: "Old job" }]), {}).err, /archived/);
  assert.match(A.plan("timesheet", {}, items("timesheet", [{ title: "x", date: "2026-09-21", start: "09:00", minutes: 5 }]), {}).err, /has not been opened/);
});

// ---------- Meal Planner ----------
test("meals: a recipe with ingredients read by the app's own parser; canonical; seed look-alike; Undo", () => {
  const d = ML.mergeMeals(ML.emptyData(), null);
  const it = items("meals", [
    { title: "Lentil soup", servings: 6, prep_minutes: 10, cook_minutes: 40, ingredients: ["250 g lentils", "1 onion, chopped", "2 tbsp olive oil"],
      steps: ["Rinse the lentils.", "Simmer 40 minutes."], note: "Better the next day.", labels: ["winter"], url: "https://example.org/soup" },
    { title: "Greek salad (horiatiki)" }
  ]);
  assert.deepEqual(it[0].ig[1], { q: 1, u: "", n: "onion", x: "chopped", g: "" });
  const p = A.plan("meals", d, it, { lang: "en" });
  assert.equal(p.ok, true, p.err);
  assert.equal(p.rows[0].fields.find((f) => f[0] === "minutes")[1], "50");
  assert.ok(p.rows[1].dup, "a ready recipe with that name starts unticked");
  const r = A.apply("meals", d, it, NOW, { 1: 1 }, { lang: "en" });
  assert.equal(r.ok, true, r.err);
  const x = r.data.rc.find((q) => q.id === r.made[0].id);
  assert.deepEqual([x.t, x.sv, x.pt, x.ct, x.ig.length, x.st.length, x.no, x.tg, x.src, x.m], ["Lentil soup", 6, 10, 40, 3, 2, "Better the next day.", ["winter"], "https://example.org/soup", NOW]);
  assert.match(x.id, ML.ID_RE);
  assert.equal(J(ML.mergeMeals(clone(r.data), null)), J(r.data));
  // nothing stored yet (Meal Planner saves only on a change): its empty data
  const r0 = A.apply("meals", null, it.slice(0, 1), NOW, {}, { lang: "en" });
  assert.equal(r0.ok, true, r0.err);
  assert.equal(J(ML.mergeMeals(clone(r0.data), null)), J(r0.data));
  const u = A.undo("meals", r.data, r.undo, NOW + 1);
  assert.equal(u.ok, true, u.err);
  assert.equal(u.data.rc.length, 0);
  assert.equal(u.data.tombs[x.id], NOW + 1);
  assert.equal(J(ML.mergeMeals(clone(u.data), null)), J(u.data));
});
test("meals: a name or note the parser would cut is refused, as are too many steps", () => {
  assert.match(err("meals", [{ title: "x", ingredients: ["1 " + "a".repeat(70)] }]), /under 60/);
  assert.match(err("meals", [{ title: "x", ingredients: ["1 egg, " + "b".repeat(90)] }]), /under 80/);
  assert.match(err("meals", [{ title: "x", steps: Array.from({ length: 51 }, (v, i) => "step " + i) }]), /keeps 50/);
  assert.match(err("meals", [{ title: "x".repeat(81) }]), /keeps 80/);
});

// ---------- Travel ----------
const TVS = src("travel/travel.js");
const TV = new Function("crypto", "var LANG = 'en';\n" + blockOf(TVS, "  // ---------- 1. Constants", "  // ---------- 4. Storage") +
  "\nreturn { TRIP_F, PACK_F, PLAN_F, mergeTravel, ID_RE };")(webcrypto);
function stamps(fields, s) { const f = {}; fields.forEach((k) => { f[k] = s; }); return f; }
function tvData(tombs) {
  return TV.mergeTravel({ ver: 1, trips: [{ id: "trip-rome", name: "Rome", dest: "Rome", start: "2026-10-01", end: "2026-10-05", people: [], notes: "", f: stamps(TV.TRIP_F, T0),
    pack: [{ id: "item-pass", name: "Passport", qty: 1, rule: null, grp: "@docs", who: "", note: "", done: false, f: stamps(TV.PACK_F, T0) }],
    plan: [{ id: "plan-flight", kind: "flight", title: "To Rome", day: "2026-10-01", t1: "09:00", day2: "", t2: "11:00", place: "", from: "ATH", to: "FCO", ref: "", note: "", pos: 0, f: stamps(TV.PLAN_F, T0) }],
    docs: [], spend: [], jrnl: [] }], tpls: [], tombs: tombs || {} }, null);
}
const withTrip = (list) => list.map((o) => Object.assign(o, { tripId: "trip-rome" }));
test("travel_plan / travel_pack: on a trip, every field stamped, at the end of its day; canonical; look-alike; Undo", () => {
  const old = { "gone-item-1": NOW - 182 * 86400000 };     // 177 days before the newest stamp; 182 once the new items are in
  const d = tvData(old);
  assert.ok(d.tombs["gone-item-1"], "kept while nothing newer is there");
  const pl = withTrip(items("travel_plan", [
    { trip: "r2", title: "Colosseum", type: "ticket", date: "2026-10-01", start: "15:00", location: "Piazza del Colosseo", note: "Bring the QR" },
    { trip: "r2", title: "Hotel Roma", type: "stay", date: "2026-10-01", end_date: "2026-10-05" }
  ]));
  const p = A.plan("travel_plan", d, pl, {});
  assert.equal(p.ok, true, p.err);
  assert.deepEqual(p.rows[0].fields.slice(0, 3), [["trip", "Rome"], ["kind", "ticket"], ["date", "2026-10-01"]]);
  const r = A.apply("travel_plan", d, pl, NOW, {}, {});
  assert.equal(r.ok, true, r.err);
  const trip = r.data.trips[0];
  const col = trip.plan.find((e) => e.title === "Colosseum"), ho = trip.plan.find((e) => e.title === "Hotel Roma");
  assert.deepEqual([col.kind, col.t1, col.place, col.note, col.pos, ho.pos, ho.day2], ["ticket", "15:00", "Piazza del Colosseo", "Bring the QR", 1, 2, "2026-10-05"]);
  assert.ok(TV.PLAN_F.every((k) => col.f[k] === NOW), "every field stamped, as newEntry");
  assert.match(col.id, TV.ID_RE);
  assert.equal(J(TV.mergeTravel(clone(r.data), null)), J(r.data), "stored = what Travel's merge makes of it");
  assert.equal(r.data.tombs["gone-item-1"], undefined, "pruned as Travel prunes");
  assert.deepEqual(r.made[0].target, { trip: "trip-rome", tab: "plan", item: col.id });
  // packing items: look-alike unticked, group and quantity
  const pk = withTrip(items("travel_pack", [{ trip: "r2", title: "passport" }, { trip: "r2", title: "Charger", qty: 2, group: "tech", who: "Anna" }]));
  const pp = A.plan("travel_pack", r.data, pk, {});
  assert.equal(pp.rows[0].dup.target.item, "item-pass");
  const rp = A.apply("travel_pack", r.data, pk, NOW + 1, { 0: 1 }, {});
  const ch = rp.data.trips[0].pack.find((e) => e.name === "Charger");
  assert.deepEqual([ch.qty, ch.grp, ch.who, ch.done, ch.rule], [2, "@tech", "Anna", false, null]);
  assert.equal(J(TV.mergeTravel(clone(rp.data), null)), J(rp.data));
  // Undo: tombstones, only while unchanged
  const moved = clone(r.data);
  moved.trips[0].plan.find((e) => e.id === col.id).t1 = "16:00";
  assert.match(A.undo("travel_plan", moved, r.undo, NOW + 2).err, /changed since/);
  const u = A.undo("travel_plan", r.data, r.undo, NOW + 2);
  assert.equal(u.ok, true, u.err);
  assert.deepEqual(u.data.trips[0].plan.map((e) => e.id), ["plan-flight"]);
  assert.equal(u.data.tombs[col.id], NOW + 2);
  assert.equal(J(TV.mergeTravel(clone(u.data), null)), J(u.data));
});
test("travel: refusals (a trip's ref is required, no cut, a trip that is gone)", () => {
  assert.match(err("travel_plan", [{ title: "x" }]), /trip is required/);
  assert.match(err("travel_plan", [{ trip: "r1", title: "x".repeat(101) }]), /keeps 100/);
  assert.match(err("travel_plan", [{ trip: "r1", title: "x", type: "rocket" }]), /type must be one of/);
  assert.match(err("travel_pack", [{ trip: "r1", title: "x", group: "shoes" }]), /group must be one of/);
  const it = items("travel_pack", [{ trip: "r1", title: "x" }]);
  it[0].tripId = "trip-paris";
  assert.match(A.plan("travel_pack", tvData(), it, {}).err, /no longer in Travel/);
});

// ---------- Sticky Notes ----------
test("stickies: StickiesCore.create (+ a reminder); canonical; look-alike; full; Undo", () => {
  const d = SN.create(SN.empty(), { text: "Milk", color: "yellow" }, T0).data;
  const at = Date.now() + 86400000, ymd = new Date(at);
  const date = ymd.getFullYear() + "-" + String(ymd.getMonth() + 1).padStart(2, "0") + "-" + String(ymd.getDate()).padStart(2, "0");
  const it = items("stickies", [{ text: "Call the printer\nabout the proofs", color: "pink", date, start: "10:00" }, { text: "milk" }]);
  const p = A.plan("stickies", d, it, {});
  assert.equal(p.ok, true, p.err);
  assert.ok(p.rows[1].dup);
  assert.deepEqual(p.rows[0].fields.slice(0, 2), [["color", "pink"], ["reminder", date + " 10:00"]]);
  const r = A.apply("stickies", d, it, NOW, { 1: 1 }, { stickyColor: "green" });
  assert.equal(r.ok, true, r.err);
  const n = SN.find(r.data, r.made[0].id);
  assert.deepEqual([n.text, n.color, n.ring.at], ["Call the printer\nabout the proofs", "pink", new Date(+date.slice(0, 4), +date.slice(5, 7) - 1, +date.slice(8), 10).getTime()]);
  assert.equal(J(SN.merge(clone(r.data), null)), J(r.data));
  assert.deepEqual(r.made[0].target, { note: n.id });
  const r2 = A.apply("stickies", d, items("stickies", [{ text: "Plain" }]), NOW, {}, { stickyColor: "green" });
  assert.equal(SN.find(r2.data, r2.made[0].id).color, "green", "the user's own colour");
  const u = A.undo("stickies", r.data, r.undo, NOW + 1);
  assert.equal(u.ok, true, u.err);
  assert.equal(SN.find(u.data, n.id), null);
  assert.deepEqual(u.ids, [n.id]);
  assert.match(err("stickies", [{ text: "x".repeat(1001) }]), /keeps 1000/);
  assert.match(err("stickies", [{ text: "x", start: "10:00" }]), /needs date/);
  assert.match(A.plan("stickies", d, items("stickies", [{ text: "x", date: "2020-01-01" }]), {}).err, /in the past/);
  let full = SN.empty();
  for (let i = 0; i < SN.MAX_NOTES; i++) full = SN.create(full, { text: "n" + i }, T0 + i).data;
  assert.match(A.plan("stickies", full, items("stickies", [{ text: "one more" }]), {}).err, /keeps 60/);
});

// ---------- The tool ----------
test("create_items lists the new apps only when allowed, with their fields", () => {
  const tool = (creates) => core.toolsFor({ creates }).find((x) => x.name === "create_items");
  const t1 = tool(["todo"]);
  assert.equal(t1.params.properties.items.items.properties.ingredients, undefined);
  const t2 = tool(["timesheet", "meals", "travel_plan", "travel_pack", "stickies"]);
  assert.deepEqual(t2.params.properties.app.enum, ["timesheet", "meals", "travel_plan", "travel_pack", "stickies"]);
  const props = t2.params.properties.items.items.properties;
  ["trip", "project", "task", "minutes", "ingredients", "steps", "type", "qty", "group", "color", "start", "end", "text"].forEach((k) => assert.ok(props[k], k));
  assert.deepEqual(props.type.enum, require("../assistant/additems2.js").TV_KINDS);
  assert.deepEqual(props.group.enum, require("../assistant/additems2.js").TV_GROUPS);
  assert.deepEqual(props.color.enum, SN.COLORS);
});

// ---------- Longer content in the app's own receiver ----------
const entry = (args) => core.normEntry(args, { from: "Assistant", has: () => true });
test("propose_entry flashcards: one line per card, read back by Flashcards' own parser", () => {
  const e = entry({ kind: "flashcards", title: "Greek verbs", cards: [{ front: "to write", back: "γράφω" }, { front: "to read", back: "διαβάζω", both: true },
                                                                    { cloze: "The capital of Greece is ==Athens==." }] });
  assert.equal(e.ok, true, e.err);
  assert.equal(e.app, "flashcards");
  const tgt = e.call.args[1];
  assert.equal(tgt.make.title, "Greek verbs");
  assert.deepEqual(MAKE.fromTarget(tgt.make).cards, [
    { k: "basic", f: { q: "to write", a: "γράφω" } },
    { k: "rev", f: { q: "to read", a: "διαβάζω" } },
    { k: "cloze", f: { x: "The capital of Greece is {{c1::Athens}}.", e: "" } }
  ]);
  assert.match(entry({ kind: "flashcards", title: "x", cards: [{ front: "a :: b", back: "c" }] }).err, /can't hold/);
  assert.match(entry({ kind: "flashcards", title: "x", cards: [{ front: "a" }] }).err, /front and back/);
  assert.match(entry({ kind: "flashcards", title: "x", cards: [{ cloze: "no gap" }] }).err, /==gap==/);
  assert.match(entry({ kind: "flashcards", title: "x", cards: Array.from({ length: 501 }, () => ({ front: "a", back: "b" })) }).err, /At most 500/);
});
test("propose_entry wiki_article, document, mind_map: the receivers' targets; longer is refused", () => {
  const w = entry({ kind: "wiki_article", title: "Olive trees", text: "## Care\nWater **little**." });
  assert.deepEqual(w.call, { fn: "openAt", args: ["wiki", { addArticle: { t: "Olive trees", x: "## Care\nWater **little**." } }] });
  assert.match(entry({ kind: "wiki_article", text: "x" }).err, /needs a title/);
  const d = entry({ kind: "document", title: "Letter", text: "Dear Ann,\n\nThanks." });
  assert.deepEqual(d.call.args, ["writer", { newDoc: { title: "Letter", text: "Dear Ann,\n\nThanks." } }]);
  assert.match(entry({ kind: "document", title: "x", text: "a".repeat(500001) }).err, /keeps 500000/);
  const m = entry({ kind: "mind_map", title: "Book launch", outline: "Posts\n  Mastodon\nPress" });
  assert.deepEqual(m.call.args, ["mindmap", { pasteText: { text: "Book launch\n  Posts\n    Mastodon\n  Press" } }]);
  assert.match(entry({ kind: "mind_map", title: "x", outline: "a".repeat(20001) }).err, /keeps 20000/);
});
