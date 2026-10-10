// Universal search, phase 2 — the "life" group providers:
// travel, chores, meals, plants, shelf, familytree, garage.
// Plain node, no DOM: providers read through ctx.readJSON over an
// in-memory storage, in the real stored shape of each app.
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const S = require(path.join(__dirname, "..", "search.js"));
const P = (id) => require(path.join(__dirname, "..", id, "search.js"));
const IDS = ["travel", "chores", "meals", "plants", "shelf", "familytree", "garage"];

function store(obj) {
  const m = new Map(Object.entries(obj).map(([k, v]) => [k, JSON.stringify(v)]));
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), m };
}
function ctxFor(storage, q, lang) {
  return { q, words: S.parseQuery(q), fold: S.fold, lang: lang || "en", limit: 50,
           readJSON: S.makeReader(storage) };
}
const byId = (hits) => Object.fromEntries(hits.map((h) => [h.id, h]));
function noon(y, m, d) { return new Date(y, m - 1, d, 12).getTime(); }
// Hits found through the shell core (matching + ranking), for one provider.
async function find(id, storage, q, lang) {
  const g = await S.run([P(id)], q, { readJSON: S.makeReader(storage), lang: lang || "en" });
  return g.length ? g[0].hits : [];
}

// ---------- travel ----------
test("travel: trips, itinerary and packing; tombstones hide; deep-link targets", async () => {
  const f = (n) => ({ name: n, dest: n, start: n, end: n, people: n, notes: n });
  const st = store({ "oros-travel-data": { ver: 1,
    trips: [
      { id: "trip1", name: "Crete in June", dest: "Chania", start: "2026-06-10", end: "2026-06-17",
        people: ["Maria", "Nikos"], notes: "Book the boat to Balos", f: f(100),
        pack: [
          { id: "pk01", name: "Snorkel mask", qty: 1, rule: null, grp: "Beach stuff", who: "Nikos", note: "the blue one", done: false, f: { name: 100 } },
          { id: "pk02", name: "Old sunscreen", qty: 1, rule: null, grp: "@toilet", who: "", note: "", done: false, f: { name: 100 } },
          { id: "pk03", name: "Passport", qty: 1, rule: null, grp: "@docs", who: "", note: "", done: false, f: { name: 100 } }
        ],
        plan: [
          { id: "pl01", kind: "ferry", title: "", day: "2026-06-10", t1: "21:00", day2: "2026-06-11", t2: "06:00",
            place: "", from: "Piraeus", to: "Souda", ref: "MNX42", note: "Cabin 214", pos: 0, f: { title: 100 } },
          { id: "pl02", kind: "stay", title: "Villa Ariadne", day: "2026-06-11", t1: "", day2: "2026-06-17", t2: "",
            place: "Kalyves", from: "", to: "", ref: "", note: "", pos: 0, f: { title: 100 } }
        ] },
      { id: "trip2", name: "", dest: "Lisbon", start: "", end: "", people: [], notes: "", f: f(50), pack: [], plan: [] },
      { id: "trip3", name: "Deleted trip Chania", dest: "", start: "", end: "", people: [], notes: "",
        f: f(10), pack: [{ id: "pk09", name: "Passport", grp: "@docs", f: { name: 10 } }], plan: [] }
    ],
    tpls: [{ id: "tpl1", m: 5, name: "Passport kit", items: [{ name: "Passport" }] }],
    tombs: { trip3: 20, pk02: 150 } } });
  const hits = P("travel").search(ctxFor(st, "x"));
  const h = byId(hits);
  assert.deepEqual(Object.keys(h).sort(), ["pk01", "pk03", "pl01", "pl02", "trip1", "trip2"]);
  assert.equal(h.trip1.title, "Crete in June");
  assert.equal(h.trip1.text, "Chania · Maria, Nikos · Book the boat to Balos");
  assert.equal(h.trip1.when, noon(2026, 6, 10));
  assert.deepEqual(h.trip1.target, { trip: "trip1", tab: null, item: null });
  assert.equal(h.trip2.title, "Lisbon");                      // no name → destination
  assert.equal(h.trip2.when, 0);
  assert.equal(h.pl01.title, "Ferry");                        // no title → kind
  assert.equal(h.pl01.text, "Piraeus → Souda · MNX42 · Cabin 214 · Crete in June");
  assert.equal(h.pl01.when, noon(2026, 6, 10));
  assert.deepEqual(h.pl01.target, { trip: "trip1", tab: "plan", item: "pl01" });
  assert.equal(h.pl02.text, "Stay · Kalyves · Crete in June");
  assert.equal(h.pk01.text, "the blue one · Nikos · Beach stuff · Crete in June");
  assert.deepEqual(h.pk01.target, { trip: "trip1", tab: "pack", item: "pk01" });
  assert.equal(P("travel").search(ctxFor(st, "x", "el")).find((x) => x.id === "pl01").title, "Πλοίο");
  // templates are not searched; the deleted trip's passport is gone
  const pass = await find("travel", st, "passport");
  assert.deepEqual(pass.map((x) => x.id), ["pk03"]);
  assert.deepEqual(P("travel").search(ctxFor(store({}), "x")), []);
  assert.equal(P("travel").open, undefined);                  // generic deep link
});

// ---------- chores ----------
test("chores: chores and members, tombstones hide, targets", async () => {
  const st = store({ "oros-chores-data": { ver: 1,
    members: [
      { id: "mem001", m: 10, name: "Eleni", color: 0, icon: "", away: null, order: 0, om: 0 },
      { id: "mem002", m: 10, name: "Kostas", color: 1, icon: "", away: null, order: 1, om: 0 },
      { id: "mem003", m: 10, name: "Gone Guest", color: 2, icon: "", away: null, order: 2, om: 0 }
    ],
    tasks: [
      { id: "tsk001", m: 10, name: "Dishes", icon: "🍽️", freq: { k: "d" }, weight: 1, mode: "rr", who: ["mem001"], start: "2026-01-01", off: 0 },
      { id: "tsk002", m: 10, name: "Take out recycling", icon: "♻️", freq: { k: "n", n: 3 }, weight: 1, mode: "rr", who: [], start: "2026-01-01", off: 0 },
      { id: "tsk003", m: 10, name: "Old dishes chore", icon: "", freq: { k: "w" }, weight: 1, mode: "rr", who: [], start: "2026-01-01", off: 0 }
    ],
    done: { "tsk001|2026-10-01": [1, "mem001", 5] }, set: {},
    tombs: { tsk003: 10, mem003: 20 } } });
  const h = byId(P("chores").search(ctxFor(st, "x")));
  assert.deepEqual(Object.keys(h).sort(), ["mem001", "mem002", "tsk001", "tsk002"]);
  assert.equal(h.tsk001.title, "Dishes");
  assert.equal(h.tsk001.text, "Every day · Eleni");
  assert.deepEqual(h.tsk001.target, { task: "tsk001" });
  assert.equal(h.tsk002.text, "Every 3 days");
  assert.equal(h.mem001.text, "Dishes, Take out recycling");
  assert.equal(h.mem002.text, "Take out recycling");          // empty who[] = everyone
  assert.deepEqual(h.mem002.target, { member: "mem002" });
  const el = byId(P("chores").search(ctxFor(st, "x", "el")));
  assert.equal(el.tsk002.text, "Κάθε 3 μέρες");
  const dishes = await find("chores", st, "dishes");
  assert.deepEqual(dishes.map((x) => x.id), ["tsk001", "mem001"]);
});

test("chores: a member tombstoned after its last edit is hidden", () => {
  const st = store({ "oros-chores-data": { ver: 1,
    members: [{ id: "mem009", m: 10, name: "Left", order: 0, om: 15 }], tasks: [], done: {}, set: {},
    tombs: { mem009: 15 } } });
  assert.deepEqual(P("chores").search(ctxFor(st, "left")), []);
});

// ---------- meals ----------
test("meals: stored recipes and free-text plan items; tombstones hide", async () => {
  const st = store({ "oros-meals-data": { ver: 1,
    rc: [
      { id: "r-moussaka", m: 50, t: "Moussaka", e: "🍆", c: "main", sv: 6, pt: 40, ct: 60, dt: [],
        tg: ["Sunday", "oven"], ig: [{ q: 3, u: "", n: "eggplants", x: "large", g: "" },
                                     { q: 500, u: "g", n: "minced beef", x: "", g: "" }],
        st: ["Fry the eggplants.", "Bake 45 minutes."], no: "Yiayia's version", src: "https://example.org/m", fv: 1 },
      { id: "r-old", m: 10, t: "Old eggplant dip", e: "", c: "", sv: 4, pt: 0, ct: 0, dt: [], tg: [], ig: [], st: [], no: "", src: "", fv: 0 }
    ],
    pl: {
      "2026-10-12|d": { m: 60, it: [{ r: "r-moussaka", sv: 4 }, { t: "Salad from the garden" }] },
      "2026-10-13|l": { m: 60, it: [{ t: "Leftover moussaka" }] },
      "bad-key": { m: 1, it: [{ t: "Nope" }] }
    },
    ck: {}, mn: [{ id: "n20261012-abcd", m: 5, w: "2026-10-12", t: "Eggplants extra", d: 0 }],
    ai: {}, pn: {}, set: { m: 0, dt: [], sl: ["b", "l", "d"], nm: {}, ws: 1 },
    tombs: { "r-old": 20, "r-greek-salad": 30 } } });
  const h = byId(P("meals").search(ctxFor(st, "x")));
  assert.deepEqual(Object.keys(h).sort(), ["2026-10-12|d#1", "2026-10-13|l#0", "r-moussaka"]);
  assert.equal(h["r-moussaka"].title, "Moussaka");
  assert.equal(h["r-moussaka"].text,
    "Sunday, oven · eggplants large, minced beef · Yiayia's version · Fry the eggplants. Bake 45 minutes. · https://example.org/m");
  assert.deepEqual(h["r-moussaka"].target, { recipe: "r-moussaka" });
  assert.equal(h["r-moussaka"].when, undefined);
  assert.equal(h["2026-10-12|d#1"].title, "Salad from the garden");
  assert.equal(h["2026-10-12|d#1"].when, noon(2026, 10, 12));
  assert.deepEqual(h["2026-10-12|d#1"].target, { day: "2026-10-12" });
  const egg = await find("meals", st, "eggplant");
  assert.deepEqual(egg.map((x) => x.id), ["r-moussaka"]);     // deleted recipe and shopping items: no
  const mous = await find("meals", st, "moussaka");
  assert.deepEqual(mous.map((x) => x.id), ["r-moussaka", "2026-10-13|l#0"]);
});

// ---------- plants ----------
test("plants: one hit per plant, tombstones hide, opens through __orosOpenPlants", () => {
  const st = store({ "oros-plants-data": { ver: 1,
    plants: [
      { id: "plant1aa", m: 10, name: "Kitchen basil", sp: "basil", room: "Kitchen", out: 1, em: "🌿",
        w: 2, ww: 3, f: 14, mi: 0, r: 0, st: "2026-09-01", sn: {}, notes: "Pinch the flowers" },
      { id: "plant2bb", m: 10, name: "Fern", sp: "", room: "", out: 0, em: "", w: 3, ww: 5, f: 0, mi: 0, r: 0,
        st: "2026-09-01", sn: {}, notes: "" },
      { id: "plant3cc", m: 10, name: "Dead cactus", sp: "cactus", room: "", out: 0, em: "", w: 14, ww: 30, f: 0, mi: 0, r: 0,
        st: "2026-09-01", sn: {}, notes: "" }
    ],
    log: [{ id: "log1aaaa", p: "plant1aa", k: "water", d: "2026-10-01", m: 5 }],
    tombs: { plant3cc: 12 } } });
  const hits = P("plants").search(ctxFor(st, "x"));
  assert.deepEqual(hits.map((x) => x.id), ["plant1aa", "plant2bb"]);
  assert.equal(hits[0].title, "Kitchen basil");
  assert.equal(hits[0].text, "Kitchen · Outdoors · Pinch the flowers");   // no core in node: no species name
  assert.equal(hits[0].target, "plant1aa");
  assert.equal(hits[1].text, "");
  // with OrosPlantsCore (the shell loads it) the species name is text too
  globalThis.OrosPlantsCore = require(path.join(__dirname, "..", "plants", "core.js"));
  try {
    assert.equal(P("plants").search(ctxFor(st, "x", "el"))[0].text, "Kitchen · Βασιλικός · Εξωτερικό · Pinch the flowers");
  } finally { delete globalThis.OrosPlantsCore; }
  let got = null;
  P("plants").open("plant1aa", { __orosOpenPlants: (t) => { got = t; } });
  assert.equal(got, "plant1aa");
});

// ---------- shelf ----------
test("shelf: items with creator, tags, review; tombstones hide; target", async () => {
  const st = store({ "oros-shelf-data": { ver: 1,
    items: [
      { id: "book01", m: 20, a: 1, type: "book", title: "The Odyssey", by: "Homer", year: 1996, size: 560, fmt: "p",
        plat: "", st: "now", prio: 0, rate: 9, fav: 1, tags: ["classics", "epic"], rev: "Wine-dark sea, again.", src: "", col: 0 },
      { id: "game01", m: 20, a: 1, type: "game", title: "Hades", by: "Supergiant", year: 2020, size: 0, fmt: "",
        plat: "Switch", st: "want", prio: 0, rate: 0, fav: 0, tags: [], rev: "", src: "Nikos", col: 1 },
      { id: "film01", m: 20, a: 1, type: "film", title: "Odyssey remake", by: "", year: 0, size: 0, fmt: "",
        plat: "", st: "want", prio: 0, rate: 0, fav: 0, tags: [], rev: "", src: "", col: 2 }
    ],
    sess: [{ id: "sess01", it: "book01", k: "s", d: "2026-09-01", v: 0, m: 5 }],
    goals: {}, tombs: { film01: 25 } } });
  const h = byId(P("shelf").search(ctxFor(st, "x")));
  assert.deepEqual(Object.keys(h).sort(), ["book01", "game01"]);
  assert.equal(h.book01.text, "Book · Homer · 1996 · classics, epic · Wine-dark sea, again.");
  assert.deepEqual(h.book01.target, { item: "book01" });
  assert.equal(h.game01.text, "Game · Supergiant · 2020 · Switch · Nikos");
  assert.equal(byId(P("shelf").search(ctxFor(st, "x", "el"))).game01.text.split(" · ")[0], "Παιχνίδι");
  const od = await find("shelf", st, "odyssey");
  assert.deepEqual(od.map((x) => x.id), ["book01"]);
});

// ---------- familytree ----------
test("familytree: people with years, places, note, tree; deleted tree / person hidden", async () => {
  const ev = (d, place) => ({ d: d, q: "", place: place || "" });
  const st = store({ "oros-familytree-data": { ver: 1,
    trees: [{ id: "t1", m: 5, name: "Papadopoulos", home: "p1" }, { id: "t2", m: 5, name: "Old tree", home: "" }],
    people: [
      { id: "p1", m: 10, tree: "t1", given: "Georgios", family: "Papadopoulos", birthName: "", sex: "m",
        birth: ev("1931-03-02", "Smyrna"), death: ev("2004", "Athens"), dead: true, note: "Fisherman in Piraeus",
        photo: "data:image/png;base64,AAAA", contact: "", parents: [] },
      { id: "p2", m: 10, tree: "t1", given: "", family: "", birthName: "Vlachou", sex: "f",
        birth: ev(""), death: ev(""), dead: false, note: "", photo: "", contact: "", parents: [] },
      { id: "p3", m: 10, tree: "t2", given: "Georgios", family: "Old", birthName: "", sex: "m",
        birth: ev(""), death: ev(""), dead: false, note: "", photo: "", contact: "", parents: [] },
      { id: "p4", m: 10, tree: "t1", given: "Georgios", family: "Removed", birthName: "", sex: "m",
        birth: ev(""), death: ev(""), dead: false, note: "", photo: "", contact: "", parents: [] }
    ],
    unions: [{ id: "u1", m: 10, tree: "t1", a: "p1", b: "p2", kind: "married", start: ev(""), end: ev("") }],
    tombs: { t2: 6, p4: 10 } } });
  const h = byId(P("familytree").search(ctxFor(st, "x")));
  assert.deepEqual(Object.keys(h).sort(), ["p1", "p2"]);
  assert.equal(h.p1.title, "Georgios Papadopoulos");
  assert.equal(h.p1.text, "1931–2004 · Smyrna · Athens · Fisherman in Piraeus · Papadopoulos");
  assert.ok(!/base64/.test(JSON.stringify(h)));
  assert.deepEqual(h.p1.target, { tree: "t1", person: "p1" });
  assert.equal(h.p2.title, "(no name)");
  assert.equal(h.p2.text, "Vlachou · Papadopoulos");
  assert.equal(byId(P("familytree").search(ctxFor(st, "x", "el"))).p2.title, "(χωρίς όνομα)");
  const g = await find("familytree", st, "georgios");
  assert.deepEqual(g.map((x) => x.id), ["p1"]);
});

// ---------- garage ----------
test("garage: vehicles, renewals, plans, tyres, visits, fill-ups, costs; archived and deleted hidden", async () => {
  const st = store({ "oros-garage-data": { ver: 1,
    vehicles: [
      { id: "veh001", m: 10, name: "Family Golf", type: "car", fuel: "diesel", make: "VW", model: "Golf", year: 2017,
        plate: "IKY-1234", tank: 50, col: 0, arch: 0, notes: "Spare key in the drawer" },
      { id: "veh002", m: 10, name: "Old Vespa", type: "scooter", fuel: "petrol", make: "Piaggio", model: "", year: 0,
        plate: "", tank: 0, col: 0, arch: 1, notes: "" }
    ],
    renewals: [
      { id: "ren001", m: 10, v: "veh001", kind: "ins", exp: "2027-03-31", every: 12, label: "", c: 32000,
        prov: "Interamerican", ref: "POL-778", warn: [30, 7, 1], n: "" },
      { id: "ren002", m: 10, v: "veh002", kind: "ins", exp: "2027-01-01", every: 12, label: "", c: 0,
        prov: "Interamerican", ref: "", warn: [], n: "" }
    ],
    plans: [{ id: "pln001", m: 10, v: "veh001", item: "timing", km: 100000, mo: 60, sd: "2024-01-01", skm: 0, label: "" }],
    tyres: [{ id: "tyr001", m: 10, v: "veh001", label: "Winter set", season: "w", size: "205/55 R16", brand: "Michelin",
              dot: "4021", tread: 70, km: 0, on: 0, okm: null, n: "Stored at Kostas' shop" }],
    service: [
      { id: "srv001", m: 10, v: "veh001", d: "2026-05-20", km: 98000, items: ["oil", "ofilter"], c: 18000,
        shop: "Kostas' shop", n: "Next time: brakes", bud: 0 },
      { id: "srv002", m: 10, v: "veh001", d: "2026-01-20", km: 90000, items: ["oil"], c: 9000, shop: "", n: "", bud: 0 }
    ],
    fuel: [
      { id: "ful001", m: 10, v: "veh001", d: "2026-10-01", km: 99000, q: 40000, c: 6800, e: "f", full: 1, mis: 0,
        st: "Shell Kifisias", n: "", bud: 0 },
      { id: "ful002", m: 10, v: "veh001", d: "2026-10-05", km: 99500, q: 30000, c: 5000, e: "f", full: 1, mis: 0,
        st: "", n: "", bud: 0 }
    ],
    costs: [
      { id: "cst001", m: 10, v: "veh001", d: "2026-08-14", cat: "park", c: 1500, km: null, n: "Airport parking, Crete trip", bud: 0 },
      { id: "cst002", m: 10, v: "veh001", d: "2026-08-15", cat: "toll", c: 300, km: null, n: "", bud: 0 }
    ],
    odo: [], settings: { m: 0, cur: "EUR" },
    tombs: { srv002: 11 } } });
  const h = byId(P("garage").search(ctxFor(st, "x")));
  assert.deepEqual(Object.keys(h).sort(),
    ["cst001", "ful001", "pln001", "ren001", "srv001", "tyr001", "veh001"]);
  assert.equal(h.veh001.title, "Family Golf");
  assert.equal(h.veh001.text, "VW Golf · 2017 · IKY-1234 · Spare key in the drawer");
  assert.equal(h.veh001.target, "veh001");
  assert.equal(h.ren001.title, "ins");                         // no core in node: the id
  assert.equal(h.ren001.text, "Interamerican · POL-778 · Family Golf");
  assert.equal(h.ren001.when, noon(2027, 3, 31));
  assert.equal(h.ren001.target, "ren001");
  assert.equal(h.tyr001.text, "Michelin · 205/55 R16 · Stored at Kostas' shop · Family Golf");
  assert.equal(h.srv001.text, "Kostas' shop · Next time: brakes · Family Golf");
  assert.equal(h.srv001.when, noon(2026, 5, 20));
  assert.equal(h.srv001.target, "veh001");                     // visits open their vehicle
  assert.equal(h.ful001.title, "Shell Kifisias");
  assert.equal(h.cst001.title, "Airport parking, Crete trip");
  assert.equal(h.cst001.target, "veh001");
  // with OrosGarageCore (the shell loads it) item / renewal names are shown
  globalThis.OrosGarageCore = require(path.join(__dirname, "..", "garage", "core.js"));
  try {
    const el = byId(P("garage").search(ctxFor(st, "x", "el")));
    assert.equal(el.ren001.title, "Ασφάλεια");
    assert.equal(el.pln001.title, "Ιμάντας χρονισμού");
    assert.equal(el.srv001.title, "Λάδια, Φίλτρο λαδιού");
    const ins = await find("garage", st, "interamerican");
    assert.deepEqual(ins.map((x) => x.id), ["ren001"]);       // archived vehicle's renewal: no
  } finally { delete globalThis.OrosGarageCore; }
  let got = null;
  P("garage").open("tyr001", { __orosOpenGarage: (t) => { got = t; } });
  assert.equal(got, "tyr001");
});

// ---------- all ----------
test("life providers: ids, keys, empty storage", () => {
  IDS.forEach((id) => {
    const p = P(id);
    assert.equal(p.id, id);
    assert.deepEqual(p.keys, ["oros-" + id + "-data"]);
    assert.deepEqual(p.search(ctxFor(store({}), "ab")), [], id);
    assert.deepEqual(p.search(ctxFor(store({ ["oros-" + id + "-data"]: "garbage" }), "ab")), [], id);
  });
});

test("every life provider file is read-only (no storage writes, no markup)", () => {
  IDS.forEach((id) => {
    const src = fs.readFileSync(path.join(__dirname, "..", id, "search.js"), "utf8");
    assert.ok(!/setItem|removeItem|registerSlice|innerHTML/.test(src), id);
  });
});
