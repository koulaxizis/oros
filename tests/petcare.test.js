// Pure logic of the Pet Health Book (petcare/core.js): dates and
// ages, normalizers, what is due (vaccines, deworming, rechecks,
// medicine, routine care, food), the reminder stages and the sync
// merge (slice "petcare").
// Run: node --test tests/

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const C = require(path.join(__dirname, "..", "petcare/core.js"));

const NOW = Date.UTC(2026, 9, 9, 10, 0, 0);   // 2026-10-09
const TODAY = "2026-10-09";

function pet(id, extra) {
  return Object.assign({ id, m: 1000, name: "Pet " + id, sp: "dog", care: {}, cs: {}, food: {}, vet: {} }, extra || {});
}
function rec(id, p, k, d, extra) { return Object.assign({ id, p, k, d, m: 2000 }, extra || {}); }
function data(pets, recs, tombs) { return { ver: 1, pets: pets || [], recs: recs || [], tombs: tombs || {} }; }
function m(a, b) { return C.merge(a, b, NOW); }
function keys(list) { return list.map((x) => x.key + "@" + x.due); }

test("dates: whole-day arithmetic, birth formats", () => {
  assert.equal(C.addDays("2026-02-27", 2), "2026-03-01");
  assert.equal(C.addDays("2026-10-24", 2), "2026-10-26");     // EU fall-back weekend
  assert.equal(C.addDays("2026-12-31", 1), "2027-01-01");
  assert.ok(C.isBirth("2019"));
  assert.ok(C.isBirth("2019-05"));
  assert.ok(C.isBirth("2020-02-29"));
  assert.ok(!C.isBirth("2019-13"));
  assert.ok(!C.isBirth("2021-02-29"));
  assert.ok(!C.isBirth("1890"));
  assert.ok(!C.isBirth("2019-5"));
  assert.ok(!C.isBirth(2019));
});

test("age: full and rough births", () => {
  assert.deepEqual(C.age("2020-10-09", TODAY), { y: 6, mo: 0, approx: false });
  assert.deepEqual(C.age("2020-10-10", TODAY), { y: 5, mo: 11, approx: false });
  assert.deepEqual(C.age("2026-08-20", TODAY), { y: 0, mo: 1, approx: false });
  assert.deepEqual(C.age("2019", TODAY), { y: 7, mo: 9, approx: true });
  assert.deepEqual(C.age("2024-03", TODAY), { y: 2, mo: 7, approx: true });
  assert.equal(C.age("2027-01-01", TODAY), null);
  assert.equal(C.age("", TODAY), null);
});

test("birthdayOn: full dates only, 29 Feb on 28 Feb", () => {
  assert.equal(C.birthdayOn({ birth: "2020-10-09" }, TODAY), 6);
  assert.equal(C.birthdayOn({ birth: "2026-10-09" }, TODAY), 0);       // the birth day itself
  assert.equal(C.birthdayOn({ birth: "2020-10" }, TODAY), 0);
  assert.equal(C.birthdayOn({ birth: "2020-02-29" }, "2025-02-28"), 5);
  assert.equal(C.birthdayOn({ birth: "2020-02-29" }, "2028-02-29"), 8);
  assert.equal(C.birthdayOn({ birth: "2020-02-29" }, "2028-02-28"), 0);
});

test("normPet drops invalid rows and cleans every field", () => {
  assert.equal(C.normPet(pet("bad id!")), null);
  assert.equal(C.normPet(pet("abc123", { name: "  " })), null);
  assert.equal(C.normPet(pet("abc123", { m: -1 })), null);
  const p = C.normPet(pet("abc123", {
    name: " Rex\u0000  the dog\n", sp: "dragon", sex: "x", neut: true, birth: "2019-02-30",
    chip: "<b>941</b>000-12", vet: { n: "Dr A", ph: "javascript:alert(1) +30 210" },
    eph: "+30 (210) 555-12", food: { n: "Brand", g: 250.5, bag: -3, open: "2026-10-01", ml: 2 },
    wmin: 9000, wmax: 5000, care: { bath: 30, nails: 21, fly: 3 }, cs: { bath: "2026-10-01" },
    ph: "data:image/png;base64,AAAA", gone: "nope", notes: "a\u0007b\n\n\n\nc", extra: 1
  }));
  assert.equal(p.name, "Rex the dog");
  assert.equal(p.sp, "other");
  assert.equal(p.sex, "");
  assert.equal(p.neut, 0);
  assert.equal(p.birth, "");
  assert.equal(p.chip, "b941b000-12");
  assert.equal(p.vet.ph, "(1) +30 210");          // letters and ":" gone: a harmless tel:
  assert.equal(p.vet.c, "");
  assert.equal(p.eph, "+30 (210) 555-12");
  assert.deepEqual(p.food, { n: "Brand", g: 0, ml: 2, bag: 0, open: "2026-10-01" });
  assert.equal(p.wmin, 0);
  assert.equal(p.wmax, 0);
  assert.deepEqual(p.care, { bath: 30 });                 // nails has no start day → off
  assert.deepEqual(p.cs, { bath: "2026-10-01" });
  assert.equal(p.ph, "");
  assert.equal(p.gone, "");
  assert.equal(p.notes, "ab\n\nc");
  assert.ok(!("extra" in p));
  const big = "data:image/jpeg;base64," + "A".repeat(C.PHOTO_MAX);
  assert.equal(C.normPet(pet("abc123", { ph: big })).ph, "");
  const ok = "data:image/jpeg;base64,/9j/AAAA";
  assert.equal(C.normPet(pet("abc123", { ph: ok })).ph, ok);
});

test("normRec: kind-specific rules", () => {
  assert.equal(C.normRec(rec("r00001", "pt0001", "nope", TODAY)), null);
  assert.equal(C.normRec(rec("r00001", "pt0001", "vacc", TODAY)), null);              // vaccine needs a name
  assert.equal(C.normRec(rec("r00001", "pt0001", "weight", TODAY, { g: 0 })), null);
  assert.equal(C.normRec(rec("r00001", "pt0001", "weight", TODAY, { g: 1.5 })), null);
  assert.equal(C.normRec(rec("r00001", "pt0001", "care", TODAY, { c: "dance" })), null);
  assert.equal(C.normRec(rec("r00001", "pt0001", "med", TODAY, { n: "" })), null);
  assert.deepEqual(C.normRec(rec("r00001", "pt0001", "vacc", TODAY, { n: " Rabies ", nx: "2026-10-01", b: "L1", x: 1 })),
    { id: "r00001", p: "pt0001", k: "vacc", d: TODAY, m: 2000, n: "Rabies", nx: "", b: "L1", v: "", nt: "" });
  assert.equal(C.normRec(rec("r00001", "pt0001", "deworm", TODAY, { t: "zzz" })).t, "int");
  const v = C.normRec(rec("r00001", "pt0001", "visit", TODAY, { n: "Limp", c: -5, nx: "2026-10-20" }));
  assert.equal(v.c, 0);
  assert.equal(v.nx, "2026-10-20");
  assert.equal(C.normRec(rec("r00001", "pt0001", "med", TODAY, { n: "Ab", u: "2026-10-01" })).u, "");
});

test("vaccines: the newest dose of each name carries the next date", () => {
  const d = m(data([pet("pt0001")], [
    rec("r00001", "pt0001", "vacc", "2025-10-01", { n: "Rabies", nx: "2026-10-01" }),
    rec("r00002", "pt0001", "vacc", "2026-10-02", { n: "rabies ", nx: "2027-10-02" }),
    rec("r00003", "pt0001", "vacc", "2025-11-01", { n: "DHPPi/L", nx: "2026-10-15" }),
    rec("r00004", "pt0001", "vacc", "2025-11-01", { n: "Leish" })          // no next dose → nothing
  ]));
  const it = C.items(d, TODAY);
  assert.deepEqual(keys(it), ["pt0001:vacc:dhppi/l@2026-10-15", "pt0001:vacc:rabies@2027-10-02"]);
  assert.equal(it[0].diff, 6);
  assert.equal(it[0].label, "DHPPi/L");
});

test("deworming: internal and external, 'both' counts for each", () => {
  let d = m(data([pet("pt0001")], [
    rec("r00001", "pt0001", "deworm", "2026-07-01", { t: "int", nx: "2026-10-01" }),
    rec("r00002", "pt0001", "deworm", "2026-09-20", { t: "ext", nx: "2026-10-20" })
  ]));
  assert.deepEqual(keys(C.items(d, TODAY)), ["pt0001:deworm:int@2026-10-01", "pt0001:deworm:ext@2026-10-20"]);
  d = m(d, data([], [rec("r00003", "pt0001", "deworm", "2026-10-05", { t: "both", nx: "2026-11-05" })]));
  assert.deepEqual(keys(C.items(d, TODAY)), ["pt0001:deworm:both@2026-11-05"]);
  d = m(d, data([], [rec("r00004", "pt0001", "deworm", "2026-10-08", { t: "ext", nx: "2026-11-08" })]));
  assert.deepEqual(keys(C.items(d, TODAY)), ["pt0001:deworm:int@2026-11-05", "pt0001:deworm:ext@2026-11-08"]);
});

test("recheck: only the newest visit; medicine: courses ending today or later", () => {
  const d = m(data([pet("pt0001")], [
    rec("r00001", "pt0001", "visit", "2026-09-01", { n: "Ear", nx: "2026-09-15" }),
    rec("r00002", "pt0001", "visit", "2026-10-01", { n: "Limp", nx: "2026-10-12" }),
    rec("r00003", "pt0001", "med", "2026-10-01", { n: "Antibiotic", u: "2026-10-09" }),
    rec("r00004", "pt0001", "med", "2026-09-01", { n: "Old", u: "2026-09-10" }),
    rec("r00005", "pt0001", "med", "2026-10-01", { n: "Forever" })
  ]));
  assert.deepEqual(keys(C.items(d, TODAY)), ["pt0001:med:r00003@2026-10-09", "pt0001:visit@2026-10-12"]);
});

test("routine care: start day or last done + days; food runs out", () => {
  const p = pet("pt0001", { care: { nails: 21, bath: 30 }, cs: { nails: "2026-09-01", bath: "2026-10-01" },
    food: { n: "Kibble", g: 300, bag: 12000, open: "2026-09-01" } });
  let d = m(data([p], [rec("r00001", "pt0001", "care", "2026-09-10", { c: "nails" })]));
  assert.deepEqual(keys(C.items(d, TODAY)), ["pt0001:care:nails@2026-10-01", "pt0001:food@2026-10-11", "pt0001:care:bath@2026-10-31"]);
  assert.equal(C.foodOut(d.pets[0]), "2026-10-11");
  d = m(d, data([], [rec("r00002", "pt0001", "care", TODAY, { c: "nails" })]));
  assert.equal(C.items(d, TODAY)[0].key, "pt0001:food");
});

test("a pet that is gone has no due dates", () => {
  const d = m(data([pet("pt0001", { gone: "2026-10-01" })],
    [rec("r00001", "pt0001", "vacc", "2025-10-01", { n: "Rabies", nx: "2026-10-01" })]));
  assert.deepEqual(C.items(d, TODAY), []);
});

test("reminders: once ahead, once when due, weekly while overdue", () => {
  const d = m(data([pet("pt0001", { care: { bath: 30 }, cs: { bath: "2026-09-09" } })], [
    rec("r00001", "pt0001", "vacc", "2025-10-16", { n: "Rabies", nx: "2026-10-16" }),
    rec("r00002", "pt0001", "vacc", "2025-10-30", { n: "Leish", nx: "2026-10-30" })
  ]));
  // 7 days before the rabies dose; bath due today; leish too far
  let r = C.reminders(d, TODAY, 7, {});
  assert.deepEqual(keys(r.items), ["pt0001:care:bath@2026-10-09", "pt0001:vacc:rabies@2026-10-16"]);
  // same day again → nothing new
  r = C.reminders(d, TODAY, 7, r.fired);
  assert.deepEqual(r.items, []);
  // the next days: silent until the rabies day
  let f = r.fired;
  for (let i = 1; i <= 6; i++) {
    const day = C.addDays(TODAY, i);
    const x = C.reminders(d, day, 7, f);
    if (i < 7) assert.ok(!x.items.some((it) => it.kind === "vacc"), day);
    f = x.fired;
  }
  r = C.reminders(d, "2026-10-16", 7, f);
  assert.ok(r.items.some((it) => it.key === "pt0001:vacc:rabies"));
  // overdue: silent for 6 days, then again
  f = r.fired;
  assert.ok(!C.reminders(d, "2026-10-22", 7, f).items.some((it) => it.kind === "vacc"));
  assert.ok(C.reminders(d, "2026-10-23", 7, f).items.some((it) => it.key === "pt0001:vacc:rabies"));
  // lead 0: nothing ahead of time
  assert.deepEqual(keys(C.reminders(d, TODAY, 0, {}).items), ["pt0001:care:bath@2026-10-09"]);
  // a missed heads-up day still announces once (first time seen)
  assert.ok(C.reminders(d, "2026-10-14", 7, {}).items.some((it) => it.kind === "vacc"));
  // the map keeps only open keys
  const done = m(d, data([], [rec("r00003", "pt0001", "vacc", "2026-10-16", { n: "Rabies", nx: "2027-10-16" })]));
  const g = C.reminders(done, "2026-10-17", 7, f).fired;
  assert.ok(!Object.keys(g).some((k) => k.indexOf("rabies@2026-10-16") >= 0));
  // garbage in the map is ignored
  assert.equal(C.reminders(d, TODAY, 7, { "pt0001:care:bath@2026-10-09": { s: "x", d: 5 } }).items.length, 2);
});

test("leadFor: food 5, care and medicine on the day", () => {
  assert.equal(C.leadFor("vacc", 7), 7);
  assert.equal(C.leadFor("vacc", 99), 7);
  assert.equal(C.leadFor("food", 7), 5);
  assert.equal(C.leadFor("food", 2), 2);
  assert.equal(C.leadFor("care", 7), 0);
  assert.equal(C.leadFor("med", 7), 0);
  assert.deepEqual(C.readPrefs({ remind: 30, lead: 40 }), { remind: 9, lead: 7, doses: true });
  assert.deepEqual(C.readPrefs({ remind: -1, lead: 0 }), { remind: -1, lead: 0, doses: true });
});

test("weights and costs", () => {
  const d = m(data([pet("pt0001")], [
    rec("w00001", "pt0001", "weight", "2026-08-01", { g: 10000 }),
    rec("w00002", "pt0001", "weight", "2026-09-05", { g: 10400 }),
    rec("w00003", "pt0001", "weight", "2026-10-01", { g: 10900 }),
    rec("v00001", "pt0001", "visit", "2026-03-01", { c: 4500 }),
    rec("v00002", "pt0001", "visit", "2025-03-01", { c: 9900 }),
    rec("v00003", "pt0001", "visit", "2026-05-01", { c: 1250 })
  ]));
  const w = C.weights(d, "pt0001");
  assert.deepEqual(w.map((x) => x.g), [10000, 10400, 10900]);
  assert.equal(C.weightDelta(w), 900);           // against 2026-08-01 (the newest ≥ 30 days older)
  assert.equal(C.weightDelta(w.slice(0, 1)), null);
  assert.equal(C.costYear(d, "pt0001", 2026), 5750);
});

test("merge: symmetric, idempotent, canonical", () => {
  const A = data([pet("pt0001", { m: 5 }), pet("pt0002")],
    [rec("r00001", "pt0001", "weight", "2026-10-01", { g: 5000 })], { zz0001: NOW - 1000 });
  const B = data([pet("pt0001", { m: 9, name: "Newer" }), pet("pt0003")],
    [rec("r00001", "pt0001", "weight", "2026-10-01", { g: 5100, m: 2500 }),
     rec("r00002", "pt0003", "care", TODAY, { c: "bath" })]);
  const ab = m(A, B), ba = m(B, A);
  assert.deepEqual(ab, ba);
  assert.deepEqual(m(ab, ab), ab);
  assert.equal(JSON.stringify(m(ab, null)), JSON.stringify(ab));
  assert.equal(ab.pets[0].name, "Newer");
  assert.equal(ab.recs.find((r) => r.id === "r00001").g, 5100);
  assert.deepEqual(ab.pets.map((p) => p.id), ["pt0001", "pt0002", "pt0003"]);
  // equal m: the larger canonical JSON wins on both sides
  const x1 = data([pet("pt0009", { m: 7, name: "Aaa" })]), x2 = data([pet("pt0009", { m: 7, name: "Bbb" })]);
  assert.deepEqual(m(x1, x2), m(x2, x1));
});

test("merge: tombstones delete pets with their records, newer edits resurrect", () => {
  const T = NOW - 86400000;
  const live = data([pet("pt0001", { m: T + 100 })], [rec("r00001", "pt0001", "weight", TODAY, { g: 5000, m: T + 100 })]);
  const del = data([], [], { pt0001: T + 200 });
  let x = m(live, del);
  assert.deepEqual(x.pets, []);
  assert.deepEqual(x.recs, []);                    // the pet's records go with it
  assert.deepEqual(m(del, live), x);
  // a newer edit of the pet resurrects it (its records too: no tomb on them)
  x = m(x, data([pet("pt0001", { m: T + 300 })], [rec("r00001", "pt0001", "weight", TODAY, { g: 5000, m: T + 100 })]));
  assert.equal(x.pets.length, 1);
  assert.equal(x.recs.length, 1);
  // delete wins a tie
  assert.deepEqual(m(data([pet("pt0002", { m: T + 50 })]), data([], [], { pt0002: T + 50 })).pets, []);
  // tombstones older than TOMB_DAYS are pruned
  const old = NOW - (C.TOMB_DAYS + 1) * 86400000;
  assert.deepEqual(m(data([], [], { pt0003: old }), null).tombs, {});
});

test("merge: caps pets and keeps the newest records when over the cap", () => {
  const pets = [];
  for (let i = 0; i < C.MAX_PETS + 5; i++) pets.push(pet("pt" + String(1000 + i)));
  assert.equal(m(data(pets), null).pets.length, C.MAX_PETS);
  const recs = [];
  for (let i = 0; i < C.MAX_RECS + 3; i++) {
    recs.push(rec("r" + String(100000 + i), "pt1000", "weight", C.addDays("2000-01-01", i), { g: 1000 }));
  }
  const out = m(data([pet("pt1000")], recs), null);
  assert.equal(out.recs.length, C.MAX_RECS);
  assert.ok(!out.recs.some((r) => r.id === "r100000"));          // the oldest went
  assert.deepEqual(out, m(out, out));
});

test("merge: per-field groups, two devices editing different fields keep both edits", () => {
  const base = C.normPet(pet("pt0001", { m: 100, breed: "Mix", color: "" }));
  const onA = C.normPet(JSON.parse(JSON.stringify(base)));
  onA.breed = "Labrador";
  assert.equal(C.touch(onA, base, NOW - 2000), true);
  const onB = C.normPet(JSON.parse(JSON.stringify(base)));
  onB.color = "Black";
  onB.vet = { n: "Dr B", c: "", ph: "" };
  C.touch(onB, base, NOW - 1000);
  assert.deepEqual(Object.keys(onB.fm).filter((g) => onB.fm[g] !== 100).sort(), ["color", "vet"]);
  const ab = m(data([onA]), data([onB])), ba = m(data([onB]), data([onA]));
  assert.deepEqual(ab, ba);
  assert.equal(ab.pets[0].color, "Black");
  assert.equal(ab.pets[0].breed, "Labrador");
  assert.equal(ab.pets[0].vet.n, "Dr B");
  assert.equal(ab.pets[0].m, NOW - 1000);
  // the same field on both: the newer edit wins
  const onD = C.normPet(JSON.parse(JSON.stringify(base)));
  onD.breed = "Beagle";
  C.touch(onD, base, NOW - 100);
  assert.equal(m(data([onA]), data([onD])).pets[0].breed, "Beagle");
  assert.equal(m(data([onD]), data([onA])).pets[0].breed, "Beagle");
  // different groups: both survive
  const onC = C.normPet(JSON.parse(JSON.stringify(base)));
  onC.food = { n: "Kibble", g: 200, ml: 2, bag: 0, open: "" };
  C.touch(onC, base, NOW - 500);
  const x = m(data([onA]), data([onC]));
  assert.equal(x.pets[0].breed, "Labrador");
  assert.equal(x.pets[0].food.n, "Kibble");
  assert.deepEqual(x, m(data([onC]), data([onA])));
  assert.deepEqual(m(x, x), x);
  // no change → no stamp (R27)
  const same = C.normPet(JSON.parse(JSON.stringify(x.pets[0])));
  assert.equal(C.touch(same, x.pets[0], NOW), false);
  assert.equal(same.m, x.pets[0].m);
  // fm above m is clamped; missing fm = m
  const odd = C.normPet(pet("pt0002", { m: 50, fm: { name: 999, chip: "x" } }));
  assert.equal(odd.fm.name, 50);
  assert.equal(odd.fm.chip, 50);
});

test("medicine dose times: cleaned, optional, older records unchanged", () => {
  const r = C.normRec(rec("rc0001", "pt0001", "med", "2026-10-05", { n: "Amoxicillin", tm: ["20:00", "08:00", "08:00", "8:00", "24:00", 7, "07:30"] }));
  assert.deepEqual(r.tm, ["07:30", "08:00", "20:00"]);
  const old = C.normRec(rec("rc0002", "pt0001", "med", "2026-10-05", { n: "Old" }));
  assert.equal("tm" in old, false);
  assert.equal("tm" in C.normRec(rec("rc0003", "pt0001", "med", "2026-10-05", { n: "Empty", tm: [] })), false);
  const many = C.normRec(rec("rc0004", "pt0001", "med", "2026-10-05", { n: "Many", tm: ["01:00", "02:00", "03:00", "04:00", "05:00", "06:00", "07:00"] }));
  assert.equal(many.tm.length, C.MAX_TIMES);
  // tm only on medicine
  assert.equal("tm" in C.normRec(rec("rc0005", "pt0001", "vacc", "2026-10-05", { n: "Rabies", tm: ["08:00"] })), false);
  // an older bundle that dropped tm (same m) does not win the merge
  const withTm = C.normRec(rec("rc0006", "pt0001", "med", "2026-10-05", { n: "A", tm: ["08:00"] }));
  const without = C.normRec(rec("rc0006", "pt0001", "med", "2026-10-05", { n: "A" }));
  const p = pet("pt0001");
  assert.deepEqual(m(data([p], [withTm]), data([p], [without])).recs[0].tm, ["08:00"]);
  assert.deepEqual(m(data([p], [without]), data([p], [withTm])).recs[0].tm, ["08:00"]);
});

test("dosesDue: each dose once, in its window, only on course days", () => {
  const recs = [
    rec("rc0001", "pt0001", "med", "2026-10-05", { n: "Amoxicillin", ds: "1 tablet", u: "2026-10-12", tm: ["08:00", "20:00"] }),
    rec("rc0002", "pt0002", "med", "2026-10-01", { n: "Drops", tm: ["08:00"] }),                   // ongoing
    rec("rc0003", "pt0001", "med", "2026-10-10", { n: "Future", tm: ["08:00"] }),                  // starts tomorrow
    rec("rc0004", "pt0001", "med", "2026-09-01", { n: "Ended", u: "2026-10-08", tm: ["08:00"] }),  // ended
    rec("rc0005", "pt0003", "med", "2026-10-01", { n: "Gone pet", tm: ["08:00"] })
  ];
  const d = m(data([pet("pt0001"), pet("pt0002"), pet("pt0003", { gone: "2026-10-02" })], recs), data());
  assert.equal(C.dosesDue(d, TODAY, 7 * 60 + 59, {}).items.length, 0);           // before
  const a = C.dosesDue(d, TODAY, 8 * 60 + 10, {});
  assert.deepEqual(a.items.map((x) => x.key), ["rc0001@2026-10-09T08:00", "rc0002@2026-10-09T08:00"]);
  assert.equal(a.items[0].rec.ds, "1 tablet");
  // same window again: nothing new
  assert.equal(C.dosesDue(d, TODAY, 8 * 60 + 40, a.fired).items.length, 0);
  // window passed while closed: skipped, not announced late
  assert.equal(C.dosesDue(d, TODAY, 8 * 60 + 91, {}).items.length, 0);
  // evening dose; the morning keys stay for today
  const b = C.dosesDue(d, TODAY, 20 * 60, a.fired);
  assert.deepEqual(b.items.map((x) => x.key), ["rc0001@2026-10-09T20:00"]);
  assert.equal(Object.keys(b.fired).length, 3);
  // next day: yesterday's keys are dropped (the map never grows)
  const c = C.dosesDue(d, "2026-10-10", 8 * 60, b.fired);
  assert.deepEqual(c.items.map((x) => x.key).sort(), ["rc0001@2026-10-10T08:00", "rc0002@2026-10-10T08:00", "rc0003@2026-10-10T08:00"]);
  assert.equal(Object.keys(c.fired).length, 3);
  // junk in the fired map is ignored
  assert.equal(C.dosesDue(d, TODAY, 8 * 60, { x: 1, "rc0001@2026-10-09T08:00": "y" }).items.length, 2);
});

test("readPrefs: dose reminders on unless switched off", () => {
  assert.equal(C.readPrefs(null).doses, true);
  assert.equal(C.readPrefs({ doses: false }).doses, false);
  assert.equal(C.readPrefs({ doses: "no" }).doses, true);
});
