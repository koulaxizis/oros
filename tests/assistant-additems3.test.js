// Assistant: new items in Habits, Workouts, Garage, Plant Care, Pet
// Health Book and Media Shelf (wave 4, AS-ADD6, assistant/additems3.js).
// Each new record is what the app's own merge makes of it (byte for
// byte: opening the app rewrites nothing); texts longer than the app
// keeps are refused; a look-alike starts unticked; the vehicle or pet
// is named (or the only one); Undo only takes back what nobody
// changed or logged on since.
// Run: node --test tests/

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { webcrypto } = require("crypto");
const A = require("../assistant/additems.js");
require("../assistant/additems3.js");
const core = require("../assistant/core.js");
const HM = require("../habits/model.js");
const PL = require("../plants/core.js");
const PC = require("../petcare/core.js");
const GC = require("../garage/core.js");

const NOW = new Date(2026, 10, 3, 12, 0).getTime();   // local 2026-11-03
const T0 = NOW - 5 * 86400000;
const CTX = { today: "2026-11-03", lang: "en" };
const clone = (x) => JSON.parse(JSON.stringify(x));
const J = (x) => JSON.stringify(x);
function src(rel) { return fs.readFileSync(path.join(__dirname, "..", rel), "utf8"); }
function blockOf(s, from, to) {
  const i = s.indexOf(from), j = s.indexOf(to, i);
  if (i < 0 || j < 0) throw new Error("missing block " + from);
  return s.slice(i, j);
}
function items(app, list) { const n = A.normItems({ app, items: list }, CTX); assert.equal(n.ok, true, n.err); return n.items; }
function err(app, list) { const n = A.normItems({ app, items: list }, CTX); assert.equal(n.ok, false); return n.err; }
function add(app, d, list, skip) {
  const it = items(app, list);
  const p = A.plan(app, d, it, CTX);
  assert.equal(p.ok, true, p.err);
  // the card shows only field names of a-z (assistant.js crRow), each with its label
  p.rows.forEach((row) => row.fields.forEach((f) => { assert.match(f[0], /^[a-z]{1,12}$/); assert.ok(LABELS.has(f[0]), f[0]); }));
  const a = A.apply(app, d, it, NOW, skip || [], CTX);
  assert.equal(a.ok, true, a.err);
  return { p, a, it };
}

const AS = src("assistant/assistant.js");
const LABELS = new Set([...AS.matchAll(/"f\.([a-z]+)":/g)].map((m) => m[1]));
// The apps' own merges, cut out of the app files as their tests do.
const FS = src("fitness/fitness.js");
const FT = new Function("crypto", "var LANG = 'en';\n" + blockOf(FS, "  var STORAGE_KEY", "  // ---------- 1.") + blockOf(FS, "  var STRINGS", "  function newId(") +
  blockOf(FS, "  // ---------- 2. Ready", "  // ---------- 5. Storage") + "\nreturn { mergeFit };")(webcrypto);
const SS = src("shelf/shelf.js");
const SH = new Function("crypto", "var LANG = 'en';\n" + blockOf(SS, "  var STORAGE_KEY", "  // ---------- 1.") +
  blockOf(SS, "  function cmpStr(", "  // BOOT MARKER") + blockOf(SS, "  // ---------- 2. Model", "  // ---------- 5. Storage") +
  "\nreturn { mergeShelf };")(webcrypto);

test("the six apps are registered with their storage keys", () => {
  [["habits", "oros-habits-data"], ["fitness", "oros-fitness-data"], ["garage", "oros-garage-data"], ["plants", "oros-plants-data"],
   ["petcare", "oros-petcare-data"], ["shelf", "oros-shelf-data"]].forEach(([id, key]) => {
    assert.ok(A.APP_IDS.includes(id), id);
    assert.equal(A.storageKey(id), key);
  });
});

// ---------- Habits ----------
test("habits: days, times a week, a daily target and a reminder; canonical; look-alike; Undo refused once ticked", () => {
  const d = HM.canon({ ver: 2, habits: [HM.normHabit({ id: "habit00001", name: "Read", icon: "book", color: HM.COLORS[1], days: [], mtime: T0, del: false })], comps: [] });
  const r = add("habits", d, [
    { title: "Walk", days: [0, 2, 4], remind_at: "7:30" },
    { title: "Gym", per_week: 3 },
    { title: "Water", target: 8, unit: "glasses" },
    { title: "read" }
  ], [0, 0, 0, 1]);
  assert.equal(r.p.rows[3].dup.id, "habit00001");
  assert.deepEqual(r.p.rows[0].fields, [["days", "Mon, Wed, Fri"], ["reminder", "07:30"]]);
  assert.deepEqual(r.p.rows[1].fields, [["perweek", "3"]]);
  r.p.rows.forEach((row) => row.fields.forEach((f) => assert.match(f[0], /^[a-z]{1,12}$/)));
  const hs = r.a.data.habits.filter((h) => h.id !== "habit00001");
  assert.equal(hs.length, 3);
  const walk = hs.find((h) => h.name === "Walk"), gym = hs.find((h) => h.name === "Gym"), water = hs.find((h) => h.name === "Water");
  assert.deepEqual(walk.days, [0, 2, 4]);
  assert.equal(walk.rem, 450);
  assert.deepEqual(gym.per, ["w", 3]);
  assert.deepEqual(gym.days, []);
  assert.deepEqual(water.num, { u: "glasses", t: 8, c: "ge", s: 1 });
  assert.equal(J(HM.mergeData(clone(r.a.data), clone(r.a.data))), J(r.a.data));
  assert.equal(J(HM.normalize(clone(r.a.data))), J(r.a.data));
  // ticked since → refused; else tombstoned
  const ticked = clone(r.a.data);
  HM.setTick(ticked, walk.id, "2026-11-03", true, NOW + 5);
  assert.match(A.undo("habits", ticked, r.a.undo, NOW + 9).err, /ticked since/);
  const u = A.undo("habits", r.a.data, r.a.undo, NOW + 9);
  assert.equal(u.ok, true, u.err);
  assert.equal(u.data.habits.filter((h) => !h.del).length, 1);
});
test("habits: refusals", () => {
  assert.match(err("habits", [{ title: "x".repeat(201) }]), /keeps 200/);
  assert.match(err("habits", [{ title: "A", days: [7] }]), /0 \(Monday\) to 6/);
  assert.match(err("habits", [{ title: "A", days: [1], per_week: 2 }]), /not both/);
  assert.match(err("habits", [{ title: "A", unit: "km" }]), /needs a target/);
  assert.match(err("habits", [{ title: "A", remind_at: "25:00" }]), /HH:MM/);
});

// ---------- Workouts ----------
test("fitness: a finished workout, with an outdoor activity's done set; canonical; look-alike; Undo tombstones", () => {
  const d = FT.mergeFit({ ver: 1, ex: [], pg: [], wo: [], bm: [], set: null, tombs: {} }, null);
  const r = add("fitness", d, [
    { activity: "run", date: "2026-11-02", start: "07:00", minutes: 40, distance_km: 7.5, note: "Easy" },
    { title: "Yoga", date: "2026-11-03", start: "18:00", minutes: 30 }
  ]);
  assert.equal(r.a.data.wo.length, 2);
  const run = r.a.data.wo.find((w) => w.ti === "");          // the app names it (Workout + the activity)
  assert.deepEqual(run.x, [{ e: "x-run", tr: 0, tr2: 0, rest: 0, s: [[0, 0, 2400, 7500, 1]] }]);
  assert.equal(run.en - run.st, 40 * 60000);
  assert.equal(J(FT.mergeFit(clone(r.a.data), null)), J(r.a.data));
  // the same time again looks alike
  r.p.rows.forEach((row) => row.fields.forEach((f) => assert.match(f[0], /^[a-z]{1,12}$/)));
  const again = A.plan("fitness", r.a.data, items("fitness", [{ title: "Run", date: "2026-11-02", start: "07:10", minutes: 30 }]), CTX);
  assert.ok(again.rows[0].dup);
  const u = A.undo("fitness", r.a.data, r.a.undo, NOW + 1);
  assert.equal(u.ok, true, u.err);
  assert.equal(u.data.wo.length, 0);
  assert.equal(J(FT.mergeFit(r.a.data, u.data)), J(FT.mergeFit(u.data, r.a.data)));
  assert.equal(FT.mergeFit(r.a.data, u.data).wo.length, 0);
});
test("fitness: refusals (after today, a distance without an activity, no minutes)", () => {
  assert.match(err("fitness", [{ title: "Run", date: "2026-11-04", start: "07:00", minutes: 10 }]), /after today/);
  assert.match(err("fitness", [{ title: "Run", start: "07:00", minutes: 10, distance_km: 3 }]), /needs the activity/);
  assert.match(err("fitness", [{ title: "Run", start: "07:00" }]), /minutes/);
  assert.match(err("fitness", [{ activity: "ski", start: "07:00", minutes: 5 }]), /activity must be/);
});

// ---------- Garage ----------
function gData() {
  return GC.merge({ ver: 1, vehicles: [
    { id: "veh0000001", m: T0, name: "Golf", type: "car", fuel: "petrol", plate: "ΙΚΧ-1234" },
    { id: "veh0000002", m: T0, name: "Vespa", type: "scooter", fuel: "petrol", plate: "" }],
    service: [{ id: "srv0000001", m: T0, v: "veh0000001", d: "2026-10-01", km: 50000, items: ["oil"], c: 0, shop: "", n: "", bud: 0 }],
    renewals: [], fuel: [], plans: [], tyres: [], costs: [], odo: [], settings: { m: 0, cur: "EUR" }, tombs: {} }, null, NOW);
}
test("garage: a service by item name and a renewal by kind, on the vehicle named or its plate; canonical; Undo", () => {
  const d = gData();
  const r = add("garage", d, [
    { vehicle: "golf", record: "service", title: "Oil change", date: "2026-11-01", km: 61000, amount: 85.5, shop: "Kostas" },
    { vehicle: "ικχ 1234", record: "service", title: "Squeaky door fixed" },
    { vehicle: "Vespa", record: "renewal", title: "Insurance", date: "2027-05-01", amount: 120 },
    { vehicle: "Vespa", record: "renewal", title: "Parking card", date: "2027-01-01" }
  ]);
  const srv = r.a.data.service.filter((s) => s.id !== "srv0000001");
  assert.equal(srv.length, 2);
  const oil = srv.find((s) => s.km === 61000);
  assert.deepEqual(oil.items, ["oil"]);
  assert.equal(oil.c, 8550);
  const other = srv.find((s) => s.km === null);
  assert.deepEqual(other.items, ["other"]);
  assert.equal(other.n, "Squeaky door fixed");
  assert.equal(other.d, "2026-11-03");
  const ins = r.a.data.renewals.find((x) => x.kind === "ins"), park = r.a.data.renewals.find((x) => x.kind === "other");
  assert.equal(ins.v, "veh0000002");
  assert.equal(ins.every, 12);
  assert.deepEqual(ins.warn, [30, 7, 1]);
  assert.equal(park.label, "Parking card");
  assert.equal(J(GC.merge(clone(r.a.data), null, NOW)), J(r.a.data));
  assert.equal(r.a.made[0].target, "veh0000001");          // a service opens its vehicle (search.js)
  const u = A.undo("garage", r.a.data, r.a.undo, NOW + 1);
  assert.equal(u.ok, true, u.err);
  assert.equal(u.data.service.length, 1);
  assert.equal(u.data.renewals.length, 0);
});
test("garage: which vehicle, future service, a long label", () => {
  const d = gData();
  const p = A.plan("garage", d, items("garage", [{ record: "service", title: "Oil change" }]), CTX);
  assert.match(p.err, /2 vehicles: say which one \(Golf \(ΙΚΧ-1234\), Vespa\)/);
  assert.match(A.plan("garage", d, items("garage", [{ vehicle: "Polo", title: "Oil change" }]), CTX).err, /no vehicle called "Polo"/);
  assert.match(err("garage", [{ vehicle: "Golf", title: "Oil", date: "2026-12-01" }]), /after today/);
  assert.match(err("garage", [{ vehicle: "Golf", record: "renewal", title: "x".repeat(41), date: "2027-01-01" }]), /keeps 40/);
  assert.match(err("garage", [{ vehicle: "Golf", record: "renewal", title: "Insurance" }]), /date \(the day it expires\)/);
  assert.match(A.plan("garage", null, items("garage", [{ title: "Oil change" }]), CTX).err, /not been opened/);
});

// ---------- Plant Care ----------
test("plants: a ready species fills its care values, another is the scientific name; canonical; look-alike; Undo refused once watered", () => {
  const d = PL.merge({ ver: 1, plants: [], log: [], tombs: {} }, null, NOW);
  const r = add("plants", d, [
    { title: "Monty", species: "Monstera", location: "Living room" },
    { title: "Fern", species: "Nephrolepis exaltata", water_days: 3, note: "Likes the shower" },
    { species: "pothos" }
  ]);
  const ps = r.a.data.plants;
  const monty = ps.find((p) => p.name === "Monty"), fern = ps.find((p) => p.name === "Fern"), pothos = ps.find((p) => p.name === "Pothos");
  assert.equal(monty.sp, "monstera");
  assert.equal(monty.w, 7);
  assert.equal(monty.mi, 7);
  assert.equal(monty.st, "2026-11-03");
  assert.equal(fern.sci, "Nephrolepis exaltata");
  assert.equal(fern.w, 3);
  assert.equal(fern.em, "🪴");
  assert.ok(pothos);
  assert.equal(J(PL.merge(clone(r.a.data), null, NOW)), J(r.a.data));
  const again = A.plan("plants", r.a.data, items("plants", [{ title: "monty", location: "living room" }]), CTX);
  assert.equal(again.rows[0].dup.id, monty.id);
  const watered = clone(r.a.data);
  watered.log.push({ id: "log0000001", p: monty.id, k: "water", d: "2026-11-03", s: 0, m: NOW + 2 });
  assert.match(A.undo("plants", watered, r.a.undo, NOW + 3).err, /watered/);
  const u = A.undo("plants", r.a.data, r.a.undo, NOW + 3);
  assert.equal(u.ok, true, u.err);
  assert.equal(u.data.plants.length, 0);
  assert.match(err("plants", [{ title: "x".repeat(41) }]), /keeps 40/);
  assert.match(err("plants", [{ title: "A", water_days: 61 }]), /1 to 60/);
});

// ---------- Pet Health Book ----------
function pcData() {
  return PC.merge({ ver: 1, pets: [PC.normPet({ id: "petaaaa1", m: T0, name: "Rex", sp: "dog" }), PC.normPet({ id: "petaaaa2", m: T0, name: "Mia", sp: "cat" })].filter(Boolean),
                    recs: [], tombs: {} }, null, NOW);
}
test("petcare: vaccine, visit, medication and weight for the pet named; canonical; Undo", () => {
  const d = pcData();
  assert.equal(d.pets.length, 2);
  const r = add("petcare", d, [
    { pet: "rex", record: "vaccine", title: "Rabies", date: "2026-11-01", next_due: "2027-11-01", vet: "Dr. Papas" },
    { pet: "Rex", record: "visit", title: "Limping", amount: 45, note: "X-ray fine" },
    { pet: "Mia", record: "medication", title: "Antibiotic", dose: "1/2 tablet", until: "2026-11-10" },
    { pet: "Mia", record: "weight", weight_kg: 4.25 }
  ]);
  const recs = r.a.data.recs;
  assert.equal(recs.length, 4);
  const vac = recs.find((x) => x.k === "vacc"), vis = recs.find((x) => x.k === "visit"), med = recs.find((x) => x.k === "med"), wt = recs.find((x) => x.k === "weight");
  assert.equal(vac.nx, "2027-11-01");
  assert.equal(vac.v, "Dr. Papas");
  assert.equal(vis.c, 4500);
  assert.equal(vis.d, "2026-11-03");
  assert.equal(med.p, "petaaaa2");
  assert.equal(med.u, "2026-11-10");
  assert.equal(wt.g, 4250);
  assert.equal(J(PC.merge(clone(r.a.data), null, NOW)), J(r.a.data));
  assert.deepEqual(r.a.made[0].target, { pet: "petaaaa1", rec: vac.id });
  const u = A.undo("petcare", r.a.data, r.a.undo, NOW + 1);
  assert.equal(u.ok, true, u.err);
  assert.equal(u.data.recs.length, 0);
});
test("petcare: refusals (which pet, a kind it has no field for, next before date)", () => {
  const d = pcData();
  assert.match(A.plan("petcare", d, items("petcare", [{ record: "visit", title: "Check" }]), CTX).err, /2 pets: say which one/);
  assert.match(err("petcare", [{ pet: "Rex", record: "bath" }]), /record must be one of/);
  assert.match(err("petcare", [{ pet: "Rex", record: "vaccine" }]), /vaccine's name/);
  assert.match(err("petcare", [{ pet: "Rex", record: "weight" }]), /weight_kg is required/);
  assert.match(err("petcare", [{ pet: "Rex", record: "vaccine", title: "R", date: "2026-11-01", next_due: "2026-10-01" }]), /after date/);
});

// ---------- Media Shelf ----------
test("shelf: titles with their status' history entry; canonical; look-alike; Undo refused once progress is logged", () => {
  const d = SH.mergeShelf({ ver: 1, items: [{ id: "item000001", m: T0, a: T0, type: "book", title: "Dune", by: "Frank Herbert", year: 1965, size: 0, fmt: "p",
    plat: "", st: "done", prio: 0, rate: 0, fav: 0, tags: [], rev: "", src: "", col: 0 }], sess: [], goals: {}, tombs: {} }, null);
  const r = add("shelf", d, [
    { title: "The Hobbit", by: "J. R. R. Tolkien", year: 1937, status: "now", labels: ["fantasy", "Fantasy"] },
    { title: "Heat", media: "film", status: "done" },
    { title: "Hades", media: "game", platform: "Switch" },
    { title: "dune" }
  ], [0, 0, 0, 1]);
  assert.equal(r.p.rows[3].dup.id, "item000001");
  const its = r.a.data.items.filter((x) => x.id !== "item000001");
  assert.equal(its.length, 3);
  const hob = its.find((x) => x.title === "The Hobbit");
  assert.deepEqual(hob.tags, ["fantasy"]);
  assert.equal(hob.st, "now");
  assert.deepEqual(r.a.data.sess.map((s) => s.k).sort(), ["d", "s"]);
  assert.equal(its.find((x) => x.type === "game").plat, "Switch");
  assert.equal(J(SH.mergeShelf(clone(r.a.data), null)), J(r.a.data));
  const read = clone(r.a.data);
  read.sess.push({ id: "sess999999", m: NOW + 2, it: hob.id, k: "p", d: "2026-11-03", v: 50 });
  assert.match(A.undo("shelf", read, r.a.undo, NOW + 3).err, /Progress was logged/);
  const u = A.undo("shelf", r.a.data, r.a.undo, NOW + 3);
  assert.equal(u.ok, true, u.err);
  assert.equal(u.data.items.length, 1);
  assert.equal(u.data.sess.length, 0);
  assert.equal(SH.mergeShelf(r.a.data, u.data).items.length, 1);
  assert.match(err("shelf", [{ title: "A", platform: "PC" }]), /games only/);
  assert.match(err("shelf", [{ title: "A", status: "reading" }]), /want, now, done or dropped/);
});

test("create_items lists the six apps only when allowed, with their fields", () => {
  const tool = (creates) => core.toolsFor({ creates }).find((x) => x.name === "create_items");
  const t = tool(["habits", "garage", "shelf"]);
  assert.deepEqual(t.params.properties.app.enum, ["habits", "garage", "shelf"]);
  const p = t.params.properties.items.items.properties;
  ["days", "per_week", "target", "remind_at", "vehicle", "record", "km", "media", "status", "by"].forEach((k) => assert.ok(p[k], k));
  assert.ok(!p.pet && !p.weight_kg && !p.activity);
  const t2 = tool(["petcare", "fitness", "plants"]);
  const p2 = t2.params.properties.items.items.properties;
  ["pet", "record", "weight_kg", "next_due", "activity", "distance_km", "species", "water_days"].forEach((k) => assert.ok(p2[k], k));
});
