// AS-SUM8 (gap review proposal 8, 2026-11-17): app_summary reads eight
// more apps whole, read only, the same for the Assistant and orOS Gate
// (the gate's frame runs assistant/summary.js; GATE-PAR).
const test = require("node:test");
const assert = require("node:assert/strict");
global.window = global.window || {};
const S = require("../assistant/summary.js");
const G = require("../gate/gate.js");
const C = require("../assistant/core.js");
require("../meals/core.js");
const ML = global.window.OrosMealsCore;
const TR = require("../travel/core.js");
const PL = require("../plants/core.js");
const GA = require("../garage/core.js");
const HB = require("../habits/core.js");
const TS = require("../transfer/search.js");

const TODAY = "2026-11-17";   // a Tuesday
const NOW = Date.UTC(2026, 10, 17, 10);

test("AS-SUM8: the eight apps have a summary of their own", () => {
  ["meals", "travel", "plants", "garage", "habits", "scanpdf", "transfer", "whiteboard"].forEach((id) => assert.ok(S.OWN[id], id));
  assert.equal(S.normArgs({ app: "whiteboard", board: "  Plan  " }, TODAY).board, "Plan");
  assert.equal(S.normArgs({ app: "todo", board: "x" }, TODAY).board, undefined);
});

test("AS-SUM8 meals: stored recipes with a ref, the plan of this and next week, pantry near best-before", () => {
  const raw = {
    ver: 1,
    rc: [{ id: "rc-fasolada", m: 5, t: "Φασολάδα", tg: ["σούπα", "νηστίσιμο"], sv: 4, pt: 15, ct: 90, ig: [{ n: "φασόλια" }, { n: "καρότο" }], st: [], fv: 1 },
         { id: "rc-gone1", m: 1, t: "Deleted", tg: [], ig: [], st: [] }],
    pl: { "2026-11-17|d": { m: 3, it: [{ r: "rc-fasolada" }, { t: "Σαλάτα" }] }, "2026-12-10|l": { m: 3, it: [{ t: "too far" }] } },
    pa: [{ id: "pa-milk1", m: 2, n: "Γάλα", l: "fridge", bb: "2026-11-16" }, { id: "pa-rice1", m: 2, n: "Ρύζι", l: "cupboard", bb: "2027-05-01" }],
    set: { m: 1, dt: [], sl: ["b", "l", "d"], nm: {}, ws: 1 },
    tombs: { "rc-gone1": 9 }
  };
  const s = S.mealsPlan(ML, raw, { today: TODAY, lang: "el" });
  assert.equal(s.recipes, 1);
  assert.ok(s.ready_recipes > 0);
  assert.deepEqual(s.items[0], { title: "Φασολάδα", labels: ["σούπα", "νηστίσιμο"], servings: 4, minutes: 105, ingredients: 2, favorite: true, target: { recipe: "rc-fasolada" } });
  assert.equal(s.week_from, "2026-11-16");
  assert.deepEqual(s.plan, [{ date: "2026-11-17", meals: ["Dinner: Φασολάδα, Σαλάτα"] }], "only the 14 days from this week's start");
  assert.equal(s.pantry_items, 2);
  assert.deepEqual(s.pantry_soon, [{ name: "Γάλα", best_before: "2026-11-16", where: "fridge", late: true }]);
  assert.equal(S.mealsPlan(null, raw, { today: TODAY }).ok, false);
  const lines = S.preview(s, "el");
  assert.equal(lines[0], "1 συνταγές · " + s.ready_recipes + " έτοιμες συνταγές · 2 στο ντουλάπι");
});

test("AS-SUM8 travel: trips with their state and packing, the itinerary of trips not over", () => {
  const raw = {
    trips: [
      { id: "trip-rome", name: "Ρώμη", dest: "Rome", start: "2026-11-20", end: "2026-11-24",
        pack: [{ id: "pk-1", name: "Passport", done: true }, { id: "pk-2", name: "Charger" }, { id: "pk-3", name: "Book hotel", grp: "@before" }],
        plan: [{ id: "plan-fl1", kind: "flight", from: "ATH", to: "FCO", day: "2026-11-20", t1: "07:10", ref: "XK12Q" }] },
      { id: "trip-old1", name: "Βόλος", start: "2026-06-01", end: "2026-06-03", plan: [{ id: "plan-old1", kind: "stay", title: "Hotel", day: "2026-06-01" }] },
      { id: "trip-gone", name: "Deleted", start: "2026-12-01" }
    ],
    tombs: { "trip-gone": 5 }
  };
  const s = S.travelTrips(TR, raw, { today: TODAY, lang: "en" });
  assert.deepEqual(s.trips, [
    { name: "Ρώμη", state: "upcoming", destination: "Rome", from: "2026-11-20", to: "2026-11-24", packing_items: 3, to_pack: 1, before_leaving: 1, plan_entries: 1 },
    { name: "Βόλος", state: "past", from: "2026-06-01", to: "2026-06-03", packing_items: 0, plan_entries: 1 }
  ]);
  assert.deepEqual(s.items, [{ title: "Flight ATH → FCO", kind: "flight", by: "Ρώμη", date: "2026-11-20", time: "07:10", text: "booking XK12Q",
                               target: { trip: "trip-rome", tab: "plan", item: "plan-fl1" } }], "a past trip's itinerary stays out");
  assert.match(S.preview(s, "el")[0], /^Ρώμη: 2026-11-20 → 2026-11-24 · έρχεται · 1 για τη βαλίτσα$/);
});

test("AS-SUM8 plants: each plant with its next care days and late ones", () => {
  const raw = {
    ver: 1,
    plants: [{ id: "pl0001", m: 1, name: "Monstera", room: "Σαλόνι", w: 7, st: "2026-11-01", f: 0, mi: 0, r: 0 },
             { id: "pl0002", m: 1, name: "Βασιλικός", room: "Μπαλκόνι", out: 1, w: 2, st: "2026-11-16", notes: "Ήλιος" }],
    log: [{ id: "lg0001", p: "pl0001", k: "water", d: "2026-11-08", m: 1 }],
    tombs: {}
  };
  const s = S.plantsList(PL, raw, { today: TODAY, hemi: "n", lang: "el", now: NOW });
  assert.equal(s.plants, 2);
  assert.equal(s.late, 1);
  const mon = s.items.find((x) => x.title === "Monstera");
  assert.deepEqual(mon, { title: "Monstera", room: "Σαλόνι", water_every_days: 7, last_watered: "2026-11-08", next: { water: "2026-11-15" }, late: true, target: "pl0001" });
  const bas = s.items.find((x) => x.title === "Βασιλικός");
  assert.equal(bas.outdoors, true);
  assert.equal(bas.next.water, "2026-11-18");
  assert.equal(bas.note, "Ήλιος");
  assert.deepEqual(s.rooms, [{ name: "Μπαλκόνι", n: 1 }, { name: "Σαλόνι", n: 1 }]);
});

test("AS-SUM8 garage: vehicles with km and this year's costs, renewals and plans with levels", () => {
  const raw = {
    ver: 1,
    vehicles: [{ id: "car001", m: 1, name: "Yaris", type: "car", make: "Toyota", model: "Yaris", year: 2015, plate: "ΙΚΧ-1234" },
               { id: "car002", m: 1, name: "Old", type: "car", arch: 1 }],
    fuel: [{ id: "fu0001", m: 1, v: "car001", d: "2026-03-01", km: 100000, q: 40000, c: 6000 },
           { id: "fu0002", m: 1, v: "car001", d: "2025-12-01", km: 98000, q: 40000, c: 5000 }],
    service: [], costs: [], tyres: [], odo: [],
    plans: [{ id: "pn0001", m: 1, v: "car001", item: "oil", km: 10000, mo: 12, sd: "2025-11-01", skm: 95000 }],
    renewals: [{ id: "rn0001", m: 1, v: "car001", kind: "ins", exp: "2026-11-30", every: 12, warn: [30, 7], prov: "Interamerican", ref: "POL-9" },
               { id: "rn0002", m: 1, v: "car002", kind: "kteo", exp: "2026-12-01", warn: [30] }],
    settings: { m: 1, cur: "EUR" }, tombs: {}
  };
  const s = S.garageVehicles(GA, raw, { today: TODAY, lang: "en", now: NOW });
  assert.equal(s.vehicles.length, 1, "archived vehicles stay out");
  assert.deepEqual(s.vehicles[0], { name: "Yaris", model: "Toyota Yaris", year: 2015, plate: "ΙΚΧ-1234", km: 100000, costs_this_year: { fuel: 60, service: 0, other: 0, total: 60 } });
  assert.equal(s.items.length, 2);
  const oil = s.items.find((x) => x.target === "pn0001");
  assert.equal(oil.level, "due");
  assert.equal(oil.date, "2026-11-01");
  const ins = s.items.find((x) => x.target === "rn0001");
  assert.equal(ins.level, "soon");
  assert.equal(ins.days_left, 13);
  assert.ok(!JSON.stringify(s).includes("POL-9"), "no policy number");
  assert.equal(s.needs_attention, 2);
});

test("AS-SUM8 habits: schedule, today, streak and score (Habits' own rules)", () => {
  const raw = {
    ver: 2,
    habits: [{ id: "h1", name: "Νερό", days: [0, 1, 2, 3, 4, 5, 6], mtime: 1, num: { u: "ποτήρια", t: 8, c: "ge", s: 1 } },
             { id: "h2", name: "Γυμναστική", days: [], per: ["w", 3], mtime: 1 },
             { id: "h3", name: "Διάβασμα", days: [1], mtime: 1 },
             { id: "h4", name: "Old", days: [], mtime: 1, del: true }],
    comps: [{ id: "h3|2026-11-17", habitId: "h3", date: "2026-11-17", mtime: 5 },
            { id: "h3|2026-11-10", habitId: "h3", date: "2026-11-10", mtime: 5 },
            { id: "h2|2026-11-16", habitId: "h2", date: "2026-11-16", mtime: 5 }]
  };
  const s = S.habitsList(HB, raw, { today: TODAY });
  assert.equal(s.habits, 3);
  assert.equal(s.done_today, 1);
  const r = s.items.find((x) => x.title === "Διάβασμα");
  assert.equal(r.schedule, "Tue");
  assert.equal(r.today, "done");
  assert.equal(r.streak, "2 days");
  const w = s.items.find((x) => x.title === "Νερό");
  assert.equal(w.schedule, "every day");
  assert.equal(w.goal, "at least 8 ποτήρια");
  assert.equal(w.today, "to do");
  const g = s.items.find((x) => x.title === "Γυμναστική");
  assert.equal(g.schedule, "3 times a week");
  assert.equal(g.this_period, "1 of 3");
  assert.deepEqual(r.target, { habit: "h3" });
  assert.equal(S.preview(s, "el")[0], "3 συνήθειες · 1 από 3 έγιναν σήμερα");
});

test("AS-SUM8 scanpdf: signature requests with status, never an e-mail, link code or key", () => {
  const raw = { v: 1, items: {
    aaaaaaaaaaaaaaaaaaaaaa: { id: "aaaaaaaaaaaaaaaaaaaaaa", a: Date.UTC(2026, 10, 10), x: Date.UTC(2026, 11, 10), c: "q1.SECRETCODE", d: "REVOKESECRET",
      b: { id: "box", k: "KEY", r: "READ" }, q: { n: "Συμβόλαιο", to: "Μαρία", te: "maria@example.com", be: "me@example.com" } },
    bbbbbbbbbbbbbbbbbbbbbb: { id: "bbbbbbbbbbbbbbbbbbbbbb", a: Date.UTC(2026, 10, 1), x: Date.UTC(2026, 10, 5), q: { n: "Old", to: "Πέτρος" } },
    cccccccccccccccccccccc: { id: "cccccccccccccccccccccc", a: Date.UTC(2026, 10, 2), q: { n: "Lease", to: "Νίκος" }, got: { at: Date.UTC(2026, 10, 3), st: "signed", nm: "Νίκος" }, g: { id: "g1", i: 1, n: 2 } },
    dddddddddddddddddddddd: { id: "dddddddddddddddddddddd", a: 1, gone: 5 }
  } };
  const s = S.scanpdfSigns(raw, { now: NOW });
  assert.equal(s.requests, 3);
  assert.deepEqual([s.waiting, s.signed, s.expired], [1, 1, 1]);
  assert.deepEqual(s.items[0], { title: "Συμβόλαιο", signer: "Μαρία", status: "waiting", sent: "2026-11-10", expires: "2026-12-10", target: { signList: 1 } });
  assert.deepEqual(s.items[1], { title: "Lease", signer: "Νίκος", status: "signed", sent: "2026-11-02", answered: "2026-11-03", signer_place: "2 of 2", target: { signList: 1 } });
  const txt = JSON.stringify(s);
  assert.ok(!/@|SECRET|KEY|READ|box/.test(txt), "no e-mail, code, secret or box");
});

test("AS-SUM8 transfer: the History, never where files went; Transfer is searchable so it can be allowed", () => {
  const raw = { ver: 1, items: [
    { id: "t0000001", at: Date.UTC(2026, 10, 16, 9), dir: "recv", n: 3, bytes: 5242880, what: "photos, a.pdf +1", dev: "Chrome · Android", bad: 1, mode: "relay", dest: "disk", end: "done", folder: "/internal/Transfers/2026-11-16 11.00" },
    { id: "t0000002", at: Date.UTC(2026, 10, 15, 9), dir: "sent", n: 1, bytes: 1048576, what: "song.wav", dev: "", mode: "direct", end: "stopped" },
    { id: "t0000003", at: Date.UTC(2026, 10, 14), dir: "sent", n: 1, bytes: 1, what: "gone" }
  ], tombs: { t0000003: 9 } };
  const s = S.transferHistory(raw);
  assert.deepEqual([s.sent, s.received, s.sent_mb, s.received_mb], [1, 1, 1, 5]);
  assert.deepEqual(s.items[0], { title: "photos, a.pdf +1", date: "2026-11-16", direction: "received", files: 3, mb: 5, path: "orOS relay", device: "Chrome · Android", saved: "orOS disk", files_not_whole: 1, target: { tab: "hist" } });
  assert.equal(s.items[1].stopped, true);
  assert.ok(!JSON.stringify(s).includes("/internal/"), "no folder path");
  const apps = require("../apps.json");
  const tr = (apps.apps || apps).find((a) => a.id === "transfer");
  assert.equal(tr.search, "search.js");
  const hits = TS.search({ lang: "el", readJSON: () => raw });
  assert.equal(hits.length, 2);
  assert.equal(hits[0].text, "Λήφθηκε · Chrome · Android · 3 αρχεία");
  assert.deepEqual(hits[0].target, { tab: "hist" });
});

test("AS-SUM8 whiteboard: boards with counts and the texts of notes and shapes; one board by name", () => {
  const raw = { ver: 1,
    boards: [{ id: "b1", name: "Σχέδιο βιβλίου", m: Date.UTC(2026, 10, 1) }, { id: "b2", name: "Ροή", m: Date.UTC(2026, 10, 2) }, { id: "b3", name: "Gone", m: 1 }],
    objs: [{ id: "o1", b: "b1", k: "note", z: 2, m: Date.UTC(2026, 10, 5), tx: "Κεφάλαιο 1:\n  η αρχή" },
           { id: "o2", b: "b1", k: "image", z: 1, m: 1, src: "data:image/png;base64,AAAA" },
           { id: "o3", b: "b2", k: "shape", sym: "decision", z: 1, m: 1, tx: "OK?" },
           { id: "o4", b: "b2", k: "pen", z: 2, m: 1, pts: [0, 0] },
           { id: "o5", b: "b3", k: "note", z: 1, m: 1, tx: "of a deleted board" },
           { id: "o6", b: "b1", k: "note", z: 3, m: 1, tx: "deleted note" }],
    tombs: { b3: 5, o6: 5 } };
  const s = S.whiteboardBoards(raw, {});
  assert.deepEqual(s.boards.map((b) => [b.name, b.objects, b.notes, b.pictures, b.shapes, b.drawings, b.last_changed]),
    [["Σχέδιο βιβλίου", 2, 1, 1, 0, 0, "2026-11-05"], ["Ροή", 2, 0, 0, 1, 1, "2026-11-02"]]);
  assert.deepEqual(s.items.map((x) => [x.title, x.kind, x.by]), [["OK?", "shape (decision)", "Ροή"], ["Κεφάλαιο 1: η αρχή", "note", "Σχέδιο βιβλίου"]]);
  assert.ok(!JSON.stringify(s).includes("base64"), "no picture");
  const one = S.whiteboardBoards(raw, { board: "σχέδιο βιβλίου" });
  assert.equal(one.board, "Σχέδιο βιβλίου");
  assert.equal(one.items.length, 1);
  assert.match(S.whiteboardBoards(raw, { board: "Nope" }).err, /Σχέδιο βιβλίου, Ροή/);
  assert.equal(S.preview(s, "el")[0], "Σχέδιο βιβλίου: 2 αντικείμενα");
});

test("AS-SUM8: the gate offers app_summary for all eight (read only for the three outside ACT), and both sides describe them", async () => {
  ["meals", "travel", "plants", "garage", "habits", "scanpdf", "transfer", "whiteboard"].forEach((id) => assert.ok(G.toolsOf(id).indexOf("app_summary") >= 0, id));
  ["scanpdf", "transfer"].forEach((id) => assert.equal(G.writable(id), false, id + " stays read only"));
  const as = C.toolsFor({ data: 1, summary: 1 }).filter((t) => t.name === "app_summary")[0];
  ["meals (", "travel (", "plants (", "garage (", "habits (", "scanpdf (", "transfer (", "whiteboard ("].forEach((w) => assert.ok(as.description.includes(w), w));
  const R = await import("../relay/gate.js");
  const rg = R.TOOLS.filter((t) => t.name === "app_summary")[0];
  ["meals (", "scanpdf (", "transfer (", "whiteboard ("].forEach((w) => assert.ok(rg.description.includes(w), w));
  // never apps stay never
  ["passwords", "assistant"].forEach((id) => assert.ok(G.NEVER ? G.NEVER.indexOf(id) >= 0 : true));
});
