// Universal search, phase 2 — the "health" group providers:
// Mood, Cycle, Health, Baby, Habits, Workouts (fitness), Pet Health
// Book (petcare). Plain node, no DOM: providers read through
// ctx.readJSON over an in-memory storage. Water holds no user text
// and has no provider.
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const fs = require("fs");

const S = require(path.join(__dirname, "..", "search.js"));
const P = (id) => require(path.join(__dirname, "..", id, "search.js"));

function store(obj) {
  const m = new Map(Object.entries(obj).map(([k, v]) => [k, JSON.stringify(v)]));
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), m };
}
function ctxFor(storage, q, lang) {
  return { q, words: S.parseQuery(q), fold: S.fold, lang: lang || "en", limit: 50,
           readJSON: S.makeReader(storage) };
}
const byId = (hits, id) => hits.find((h) => h.id === id);
const noon = (y, m, d) => new Date(y, m - 1, d, 12).getTime();

// ---------- Mood ----------
test("mood: feelings as title, note + column labels as text, tombstones skipped, bridge", () => {
  const data = {
    ver: 3, sm: 0, om: 0, trigSeeded: true,
    entries: [
      { id: "e1", ts: 1700000000000, mtime: 1700000000000,
        emotions: [{ k: "happy", i: 4 }, { k: "calm", i: 3 }],
        loc: "seed-loc-0", person: "p9", trig: "t1", note: "Long walk by the sea" },
      { id: "e2", ts: 1700000100000, mtime: 1700000100000, emotions: [], note: "" },
      { id: "e3", ts: 1700000200000, mtime: 1700000200000,
        emotions: [{ k: "sad", i: 2 }], note: "secret deleted entry" }
    ],
    cols: {
      loc: [{ id: "seed-loc-0", label: "Σπίτι", bi: { en: "Home", el: "Σπίτι" }, mtime: 0, pos: 0 }],
      person: [{ id: "p9", label: "Maria", mtime: 5, pos: 0 }],
      trig: [{ id: "t1", label: "Weather", mtime: 5, pos: 0 }]
    },
    deleted: { e3: 1700000300000 }
  };
  const p = P("mood");
  assert.equal(p.id, "mood");
  assert.deepEqual(p.keys, ["oros-mood-data"]);
  const hits = p.search(ctxFor(store({ "oros-mood-data": data }), "sea"));
  assert.deepEqual(hits.map((h) => h.id), ["e1", "e2"]);
  const e1 = byId(hits, "e1");
  assert.equal(e1.title, "Happy, Calm");
  assert.equal(e1.text, "Long walk by the sea · Weather · Home · Maria");
  assert.equal(e1.when, 1700000000000);
  assert.equal(e1.target, "e1");
  assert.equal(byId(hits, "e2").title, "Mood entry");
  const el = p.search(ctxFor(store({ "oros-mood-data": data }), "x", "el"));
  assert.equal(byId(el, "e1").title, "Χαρούμενος, Ήρεμος");
  assert.ok(byId(el, "e1").text.includes("Σπίτι"));
  assert.equal(byId(el, "e2").title, "Καταγραφή διάθεσης");
  let opened = null;
  p.open("e1", { __orosOpenMood: (id) => { opened = id; } });
  assert.equal(opened, "e1");
  assert.deepEqual(p.search(ctxFor(store({}), "x")), []);
});

// ---------- Cycle ----------
test("cycle: one hit per day, note/symptoms/meds, tombstones skipped, deep-link target", () => {
  const data = {
    ver: 1, sm: 0, om: 0,
    periods: [{ id: "lq0abc", start: noon(2026, 3, 1), end: null, flow: 2, mtime: 1 }],
    days: [
      { id: "d-2026-03-02", day: new Date(2026, 2, 2).getTime(), mtime: 10,
        sym: ["seed-sym-0", "s7"], meds: [{ id: "i1", med: "m1", at: 1 }, { id: "i2", med: "m1", at: 2 }],
        note: "Cramps after lunch\nrested" },
      { id: "d-2026-03-03", day: new Date(2026, 2, 3).getTime(), mtime: 10, sym: ["s7"], meds: [], note: "" },
      { id: "d-2026-03-04", day: new Date(2026, 2, 4).getTime(), mtime: 10, sym: [], meds: [], note: "deleted day" }
    ],
    cols: {
      sym: [{ id: "seed-sym-0", label: "Κράμπες", bi: { en: "Cramps", el: "Κράμπες" }, mtime: 0, pos: 0 },
            { id: "s7", label: "Back pain", mtime: 3, pos: 1 }],
      med: [{ id: "m1", label: "Ibuprofen", mtime: 3, pos: 0 }]
    },
    deleted: { "d-2026-03-04": 20, i2: 15 }
  };
  const p = P("cycle");
  assert.deepEqual(p.keys, ["oros-cycle-data"]);
  const hits = p.search(ctxFor(store({ "oros-cycle-data": data }), "cramps"));
  assert.deepEqual(hits.map((h) => h.id), ["d-2026-03-02", "d-2026-03-03"]);
  const a = hits[0];
  assert.equal(a.title, "Cramps after lunch");
  assert.equal(a.text, "Cramps after lunch\nrested · Cramps, Back pain · Ibuprofen");
  assert.equal(a.when, new Date(2026, 2, 2).getTime());
  assert.deepEqual(a.target, { day: "d-2026-03-02" });
  assert.equal(hits[1].title, "Back pain");
  assert.equal(p.open, undefined);
  const el = p.search(ctxFor(store({ "oros-cycle-data": { days: [{ id: "d-2026-01-01", day: 1, mtime: 1, sym: [], meds: [], note: "" }] } }), "x", "el"));
  assert.equal(el[0].title, "Ημέρα κύκλου");
});

// ---------- Health ----------
test("health: readings with words, own kinds, tombstones + hidden kinds skipped, both opens", () => {
  const data = {
    ver: 1,
    en: [
      { id: "r1", m: 5, t: "bp", at: 1700000000000, v: [128, 82, 70], c: "", a: 1, p: 1, n: "After coffee", g: ["morning"] },
      { id: "r2", m: 5, t: "wt", at: 1700000100000, v: [78400], n: "", g: [] },
      { id: "r3", m: 5, t: "cchol", at: 1700000200000, v: [190000], n: "Fasting lab", g: [] },
      { id: "r4", m: 5, t: "chide", at: 1700000300000, v: [1000], n: "hidden kind note", g: [] },
      { id: "r5", m: 5, t: "gl", at: 1700000400000, v: [950], n: "deleted reading", g: [] },
      { id: "r6", m: 5, t: "cgone", at: 1700000500000, v: [1000], n: "orphan", g: [] }
    ],
    ty: [
      { id: "cchol", m: 3, n: "Cholesterol", u: "mg/dL", dc: 0, h: 0, lo: null, hi: null, lo2: null, hi2: null, r: [] },
      { id: "chide", m: 3, n: "Waist", u: "cm", dc: 0, h: 1, lo: null, hi: null, lo2: null, hi2: null, r: [] },
      { id: "cgone", m: 3, n: "Gone kind", u: "x", dc: 0, h: 0, lo: null, hi: null, lo2: null, hi2: null, r: [] }
    ],
    set: null,
    tombs: { "en:r5": 9, "ty:cgone": 9 }
  };
  const p = P("health");
  assert.deepEqual(p.keys, ["oros-health-data"]);
  const hits = p.search(ctxFor(store({ "oros-health-data": data }), "x"));
  assert.deepEqual(hits.map((h) => h.id).sort(), ["r1", "r3", "ty:cchol"]);
  const r1 = byId(hits, "r1");
  assert.equal(r1.title, "Blood pressure");
  assert.equal(r1.text, "After coffee · morning");
  assert.equal(r1.when, 1700000000000);
  assert.deepEqual(r1.target, { entry: "r1" });
  assert.equal(byId(hits, "r3").title, "Cholesterol");
  const ty = byId(hits, "ty:cchol");
  assert.equal(ty.title, "Cholesterol");
  assert.equal(ty.text, "mg/dL");
  assert.deepEqual(ty.target, { kind: "cchol" });
  assert.equal(byId(p.search(ctxFor(store({ "oros-health-data": data }), "x", "el")), "r1").title, "Πίεση");
  let kind = null, at = null;
  const win = { __orosOpenHealth: (k) => { kind = k; }, __orosOpenAt: (a, t) => { at = [a, t]; } };
  p.open({ kind: "cchol" }, win);
  assert.equal(kind, "cchol");
  p.open({ entry: "r1" }, win);
  assert.deepEqual(at, ["health", { entry: "r1" }]);
});

// ---------- Baby ----------
test("baby: children, events with text, marks; deleted child and tombstones skipped", () => {
  const data = {
    ver: 1,
    kids: [
      { id: "k1", n: "Eleni", b: "2026-01-10", s: "f", c: 0, m: 1 },
      { id: "k2", m: 4, del: 1 }
    ],
    ev: [
      { id: "v1", k: "k1", t: "med", ts: 1700000000000, tx: "Paracetamol 2.5 ml", m: 2 },
      { id: "v2", k: "k1", t: "diaper", ts: 1700000100000, x: "w", m: 2 },
      { id: "v3", k: "k1", t: "note", ts: 1700000200000, m: 5, del: 1 },
      { id: "v4", k: "k2", t: "note", ts: 1700000300000, tx: "deleted child note", m: 2 }
    ],
    gr: [{ id: "g1", k: "k1", d: "2026-02-01", g: 4200, m: 2 }],
    mk: [
      { id: "k1xsmile", k: "k1", t: "ms", key: "smile", d: "2026-02-20", nt: "At grandma's", m: 3 },
      { id: "x1", k: "k1", t: "vac", tx: "Hexavalent", d: "2026-03-10", m: 3 },
      { id: "k1xsit", k: "k1", t: "ms", key: "sit", d: "2026-06-01", m: 3 }
    ],
    prefs: { wu: "kg", tu: "c", vu: "ml" }, pm: 0
  };
  const p = P("baby");
  assert.deepEqual(p.keys, ["oros-baby-data"]);
  const hits = p.search(ctxFor(store({ "oros-baby-data": data }), "x"));
  assert.deepEqual(hits.map((h) => h.id), ["kid:k1", "ev:v1", "mk:k1xsmile", "mk:x1"]);
  assert.deepEqual(byId(hits, "kid:k1"), { id: "kid:k1", title: "Eleni", target: { kid: "k1" } });
  const v1 = byId(hits, "ev:v1");
  assert.equal(v1.title, "Medicine");
  assert.equal(v1.text, "Paracetamol 2.5 ml · Eleni");
  assert.equal(v1.when, 1700000000000);
  assert.deepEqual(v1.target, { kid: "k1", ev: "v1" });
  const ms = byId(hits, "mk:k1xsmile");
  assert.equal(ms.title, "Milestone");
  assert.equal(ms.text, "At grandma's · Eleni");
  assert.equal(ms.when, noon(2026, 2, 20));
  assert.deepEqual(byId(hits, "mk:x1").target, { kid: "k1", mk: "x1" });
  assert.equal(byId(hits, "mk:x1").title, "Hexavalent");
  const el = p.search(ctxFor(store({ "oros-baby-data": data }), "x", "el"));
  assert.equal(byId(el, "ev:v1").title, "Φάρμακο");
  assert.equal(byId(el, "mk:k1xsmile").title, "Ορόσημο");
  assert.equal(p.open, undefined);
});

// ---------- Habits ----------
test("habits: one hit per living habit, schedule as text, deleted skipped", () => {
  const data = {
    ver: 1,
    habits: [
      { id: "h1", name: "Read 20 pages", icon: "book", color: "#e06c75", days: [0, 1, 2, 3, 4, 5, 6], mtime: 1, del: false },
      { id: "h2", name: "Yoga", icon: "leaf", color: "#e06c75", days: [0, 2, 4], mtime: 1, del: false },
      { id: "h3", name: "Gone habit", icon: "check", color: "#e06c75", days: [], mtime: 2, del: true },
      { id: "h4", name: "Stretch", icon: "run", color: "#e06c75", days: [], mtime: 1, del: false }
    ],
    comps: [{ id: "h1|2026-10-01", habitId: "h1", date: "2026-10-01", mtime: 1, del: false }]
  };
  const p = P("habits");
  assert.deepEqual(p.keys, ["oros-habits-data"]);
  const hits = p.search(ctxFor(store({ "oros-habits-data": data }), "x"));
  assert.deepEqual(hits.map((h) => h.id), ["h1", "h2", "h4"]);
  assert.deepEqual(hits[0], { id: "h1", title: "Read 20 pages", text: "Every day", target: { habit: "h1" } });
  assert.equal(hits[1].text, "3 days / week");
  assert.equal(hits[2].text, "Any day");
  const el = p.search(ctxFor(store({ "oros-habits-data": data }), "x", "el"));
  assert.equal(el[0].text, "Καθημερινά");
  assert.equal(el[1].text, "3 ημέρες / εβδομάδα");
  assert.equal(p.open, undefined);
});

// ---------- Workouts (fitness) ----------
test("fitness: workouts + own programs, tombstones skipped, bridge + deep link", () => {
  const data = {
    ver: 1,
    ex: [{ id: "my-sled", m: 2, n: "Sled push", g: "legs", k: "dist", h: 0 },
         { id: "x-squat", m: 2, n: "", g: "legs", k: "wr", h: 0 }],
    pg: [
      { id: "pg1", m: 3, n: "Strongman", days: [{ id: "d1", n: "Heavy day", wd: [0], it: [] }, { id: "d2", n: "", wd: [], it: [] }] },
      { id: "pg2", m: 3, n: "Deleted program", days: [] }
    ],
    wo: [
      { id: "w1", m: 5, d: "2026-10-01", st: 1759300000000, en: 1759303600000, ti: "Heavy day", p: "pg1", pd: "d1",
        n: "Felt strong, knee ok", x: [{ e: "my-sled", tr: 0, tr2: 0, rest: 60, s: [] }, { e: "x-squat", tr: 5, tr2: 0, rest: 120, s: [] }] },
      { id: "w2", m: 5, d: "2026-10-02", st: 1759400000000, en: 0, ti: "", p: "", pd: "", n: "", x: [] },
      { id: "w3", m: 5, d: "2026-10-03", st: 1759500000000, en: 1759503600000, ti: "Deleted workout", p: "", pd: "", n: "", x: [] }
    ],
    bm: [], set: null,
    tombs: { "wo:w3": 6, "pg:pg2": 3 }
  };
  const p = P("fitness");
  assert.deepEqual(p.keys, ["oros-fitness-data"]);
  const hits = p.search(ctxFor(store({ "oros-fitness-data": data }), "x"));
  assert.deepEqual(hits.map((h) => h.id), ["pg:pg1", "wo:w1", "wo:w2"]);
  const pg = byId(hits, "pg:pg1");
  assert.equal(pg.title, "Strongman");
  assert.equal(pg.text, "Heavy day");
  assert.deepEqual(pg.target, { pg: "pg1" });
  const w1 = byId(hits, "wo:w1");
  assert.equal(w1.title, "Heavy day");
  assert.equal(w1.text, "Felt strong, knee ok · Strongman · Sled push");
  assert.equal(w1.when, 1759300000000);
  assert.equal(w1.target, "w1");
  assert.equal(byId(hits, "wo:w2").title, "Workout");
  assert.equal(byId(p.search(ctxFor(store({ "oros-fitness-data": data }), "x", "el")), "wo:w2").title, "Προπόνηση");
  let wo = null, at = null;
  const win = { __orosOpenFitness: (id) => { wo = id; }, __orosOpenAt: (a, t) => { at = [a, t]; } };
  p.open("w1", win);
  assert.equal(wo, "w1");
  p.open({ pg: "pg1" }, win);
  assert.deepEqual(at, ["fitness", { pg: "pg1" }]);
});

// ---------- Pet Health Book ----------
test("petcare: pets + records with words, tombstones skipped, bridge + deep link", () => {
  const data = {
    ver: 1,
    pets: [
      { id: "pet0001", m: 2, name: "Rex", sp: "dog", breed: "Labrador", sex: "m", neut: 1, birth: "2020",
        color: "", chip: "941000012345678", pass: "", ins: "", alg: "Chicken",
        vet: { n: "Dr Papadopoulos", c: "Kifisia Vet", ph: "" }, eph: "",
        food: { n: "Royal Canin", g: 300, ml: 2, bag: 12000, open: "" }, wmin: 0, wmax: 0,
        care: {}, cs: {}, gone: "", notes: "Afraid of thunder" },
      { id: "pet0002", m: 2, name: "Old cat", sp: "cat", notes: "" }
    ],
    recs: [
      { id: "rec0001", p: "pet0001", k: "visit", d: "2026-09-12", m: 3, n: "Limping", dg: "Sprain", tr: "Rest", c: 4500, nx: "", v: "", nt: "" },
      { id: "rec0002", p: "pet0001", k: "weight", d: "2026-09-12", m: 3, g: 31000, nt: "" },
      { id: "rec0003", p: "pet0001", k: "care", d: "2026-09-13", m: 3, c: "bath", nt: "Used the new shampoo" },
      { id: "rec0004", p: "pet0002", k: "vacc", d: "2026-01-01", m: 3, n: "Rabies", nt: "" },
      { id: "rec0005", p: "pet0001", k: "med", d: "2026-09-12", m: 3, n: "Deleted med", nt: "" }
    ],
    tombs: { pet0002: 5, rec0005: 4 }
  };
  const p = P("petcare");
  assert.deepEqual(p.keys, ["oros-petcare-data"]);
  const hits = p.search(ctxFor(store({ "oros-petcare-data": data }), "x"));
  assert.deepEqual(hits.map((h) => h.id), ["pet:pet0001", "rec:rec0001", "rec:rec0003"]);
  const rex = byId(hits, "pet:pet0001");
  assert.equal(rex.title, "Rex");
  assert.equal(rex.text, "Labrador · 941000012345678 · Chicken · Dr Papadopoulos · Kifisia Vet · Royal Canin · Afraid of thunder");
  assert.equal(rex.target, "pet0001");
  const visit = byId(hits, "rec:rec0001");
  assert.equal(visit.title, "Limping");
  assert.equal(visit.text, "Rex · Sprain · Rest");
  assert.equal(visit.when, noon(2026, 9, 12));
  assert.deepEqual(visit.target, { pet: "pet0001", rec: "rec0001" });
  assert.equal(byId(hits, "rec:rec0003").title, "Routine care");
  assert.equal(byId(p.search(ctxFor(store({ "oros-petcare-data": data }), "x", "el")), "rec:rec0003").title, "Φροντίδα ρουτίνας");
  let pet = null, at = null;
  const win = { __orosOpenPetcare: (id) => { pet = id; }, __orosOpenAt: (a, t) => { at = [a, t]; } };
  p.open("pet0001", win);
  assert.equal(pet, "pet0001");
  p.open({ pet: "pet0001", rec: "rec0001" }, win);
  assert.deepEqual(at, ["petcare", { pet: "pet0001", rec: "rec0001" }]);
});

// ---------- Through the core ----------
test("core run: a mood note is found and ranked through S.run", async () => {
  const storage = store({ "oros-mood-data": { entries: [
    { id: "e1", ts: 1, mtime: 1, emotions: [{ k: "tired", i: 2 }], note: "Ταξίδι στην Αθήνα" }
  ], cols: {}, deleted: {} } });
  const groups = await S.run([P("mood")], "αθηνα", { readJSON: S.makeReader(storage) });
  assert.equal(groups.length, 1);
  assert.equal(groups[0].hits[0].title, "Tired");
});

// ---------- Static checks ----------
const APPS = ["mood", "cycle", "health", "baby", "habits", "fitness", "petcare"];

test("every health-group provider file is read-only (no storage writes)", () => {
  APPS.forEach((id) => {
    const src = fs.readFileSync(path.join(__dirname, "..", id, "search.js"), "utf8");
    assert.ok(!/setItem|removeItem|registerSlice|innerHTML/.test(src), id);
  });
});

test("deep-link receivers exist where the generic link is used", () => {
  [["cycle", "cycle.js"], ["health", "health.js"], ["baby", "baby.js"], ["habits", "habits.js"],
   ["fitness", "fitness.js"], ["petcare", "petcare.js"]].forEach(([id, file]) => {
    const src = fs.readFileSync(path.join(__dirname, "..", id, file), "utf8");
    assert.ok(/function openSearchTarget\(t\)/.test(src), id);
    assert.ok(/window\.__orosOpenAt = openSearchTarget;/.test(src), id);
    assert.ok(src.includes('__orosTakeTarget("' + id + '")'), id);
  });
});
