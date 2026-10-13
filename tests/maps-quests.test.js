// Pure logic of the Maps quests (maps/quests-core.js, OSM upgrade
// wave 5): which elements each quest applies to, re-survey by age,
// answers → tags (validation), the Overpass query and parsing, and
// the sync merge of the "mapsquests" slice.
// Run: node --test tests/

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const fs = require("fs");

const Q = require(path.join(__dirname, "..", "maps/quests-core.js"));
const NOW = Date.UTC(2026, 9, 13, 9);
const node = (id, tags, ts) => ({ t: "n", id, lat: 37.98, lon: 23.72, tags, ts: ts || NOW - 86400000 });
const way = (id, tags, ts) => ({ t: "w", id, lat: 37.98, lon: 23.72, tags, ts: ts || NOW - 86400000 });
const ids = (els, opts) => Q.openQuests(els, Object.assign({ now: NOW }, opts)).map((x) => x.el.t + x.el.id + ":" + x.q.id + ":" + x.mode);

test("36 quests (16 + 20 in wave 8), unique ids, every text in EN and EL, every option tag valid", () => {
  assert.equal(Q.QUESTS.length, 36);
  const seen = new Set();
  Q.QUESTS.forEach((q) => {
    assert.ok(!seen.has(q.id)); seen.add(q.id);
    assert.match(q.id, /^[a-z_]{2,40}$/);
    ["title", "q"].forEach((f) => { assert.ok(q[f].en && q[f].el, q.id + " " + f); });
    assert.ok(q.sel.length && q.sel.every((s) => /^(node|way|nwr)\[/.test(s)), q.id);
    (q.options || []).concat(q.none ? [q.none] : []).forEach((o) => {
      assert.ok(o.en && o.el && Object.keys(o.set).length, q.id + " " + o.v);
      Object.keys(o.set).forEach((k) => assert.match(k, /^[a-z_:]+$/));
    });
    if (q.kind !== "multi") assert.ok(q.key, q.id);
    assert.ok(Q.CAT_BY[q.cat], q.id + " category");
  });
});

test("which quests apply: shops, benches, crossings, ways, buildings", () => {
  const els = [
    node(1, { shop: "bakery", name: "Φούρνος" }),
    node(2, { shop: "bakery" }),                                  // no name: no hours / wheelchair
    node(3, { amenity: "bench" }),
    node(4, { amenity: "bench", backrest: "no" }),
    node(5, { highway: "crossing" }),
    node(6, { highway: "crossing", crossing: "informal" }),
    way(7, { highway: "residential", name: "Οδός Α" }),
    way(8, { building: "house" }),
    node(9, { highway: "bus_stop", shelter: "yes" }),
    node(10, { amenity: "recycling", recycling_type: "container", "recycling:glass_bottles": "yes" }),
    node(11, { amenity: "recycling", recycling_type: "container" }),
    node(12, { shop: "vacant", name: "x" })
  ];
  const got = ids(els);
  ["n1:opening_hours:new", "n1:wheelchair:new", "n3:bench_backrest:new", "n5:crossing_type:new",
    "w7:way_lit:new", "w7:way_surface:new", "w8:building_levels:new", "w8:housenumber:new",
    "n9:bus_bench:new", "n11:recycling:new"].forEach((x) => assert.ok(got.includes(x), x));
  ["n2:opening_hours:new", "n4:bench_backrest:new", "n6:crossing_type:new", "n9:bus_shelter:new",
    "n10:recycling:new", "n12:opening_hours:new"].forEach((x) => assert.ok(!got.some((g) => g.startsWith(x.replace(/:new$/, ""))), x));
  // off + hidden
  const off = ids(els, { off: ["way_lit", "way_surface"], hide: { "n3:bench_backrest": NOW } });
  assert.ok(!off.some((x) => /way_lit|way_surface|n3:/.test(x)));
});

test("re-survey: old answers come back, check_date wins over the edit time", () => {
  const old = NOW - 2 * 365.25 * 86400000;
  const shop = node(1, { shop: "kiosk", name: "K", opening_hours: "Mo-Su 08:00-22:00" }, old);
  assert.ok(ids([shop]).includes("n1:opening_hours:recheck"), "1 year → asked again");
  const fresh = node(1, { shop: "kiosk", name: "K", opening_hours: "Mo-Su 08:00-22:00", "check_date:opening_hours": "2026-06-01" }, old);
  assert.ok(!ids([fresh]).some((x) => x.includes("opening_hours")));
  const generic = node(1, { shop: "kiosk", name: "K", opening_hours: "24/7", check_date: "2026-03" }, old);
  assert.ok(!ids([generic]).some((x) => x.includes("opening_hours")), "check_date YYYY-MM counts");
  // a quest without recheck never comes back
  assert.ok(!ids([node(2, { amenity: "bench", backrest: "yes" }, 0)]).length);
  // unsigned hours: not asked
  assert.ok(!ids([node(3, { shop: "kiosk", name: "K", "opening_hours:signed": "no" })]).some((x) => x.includes("opening_hours")));
  assert.equal(Q.parseDay("2026-02-30") > 0, true);
  assert.equal(Q.parseDay("13/10/2026"), 0);
  assert.equal(Q.today(NOW), "2026-10-13");
});

test("answers → tags: choice, multi, hours, number, text, same", () => {
  const B = Q.BY_ID;
  const bench = node(3, { amenity: "bench" });
  assert.deepEqual(Q.answerSet(B.bench_backrest, bench, "yes", NOW), { set: { backrest: "yes" }, was: { backrest: "" } });
  assert.equal(Q.answerSet(B.bench_backrest, bench, "maybe", NOW), null);
  assert.equal(Q.answerSet(B.bench_backrest, bench, "same", NOW), null, "same only for a re-survey");
  const cr = node(5, { highway: "crossing" });
  assert.deepEqual(Q.answerSet(B.crossing_type, cr, "marked", NOW).set, { crossing: "uncontrolled", "crossing:markings": "yes" });
  const rec = node(11, { amenity: "recycling", recycling_type: "container" });
  assert.deepEqual(Q.answerSet(B.recycling, rec, ["paper", "cans", "bogus"], NOW).set, { "recycling:cans": "yes", "recycling:paper": "yes" });
  assert.equal(Q.answerSet(B.recycling, rec, [], NOW), null);
  const shop = node(1, { shop: "bakery", name: "F" });
  assert.deepEqual(Q.answerSet(B.opening_hours, shop, "Mo-Fr 07:00-15:00; Sa 08:00-13:00", NOW).set, { opening_hours: "Mo-Fr 07:00-15:00; Sa 08:00-13:00" });
  assert.deepEqual(Q.answerSet(B.opening_hours, shop, "24/7", NOW).set, { opening_hours: "24/7" });
  assert.deepEqual(Q.answerSet(B.opening_hours, shop, "unsigned", NOW).set, { "opening_hours:signed": "no" });
  assert.equal(Q.answerSet(B.opening_hours, shop, "<script>", NOW), null);
  assert.equal(Q.answerSet(B.opening_hours, shop, "", NOW), null);
  const b = way(8, { building: "house" });
  assert.deepEqual(Q.answerSet(B.building_levels, b, "3", NOW).set, { "building:levels": "3" });
  ["0", "201", "2.5", "two", "", "-1"].forEach((v) => assert.equal(Q.answerSet(B.building_levels, b, v, NOW), null, v));
  assert.deepEqual(Q.answerSet(B.housenumber, b, "12Α", NOW).set, { "addr:housenumber": "12Α" });
  assert.deepEqual(Q.answerSet(B.housenumber, b, "none", NOW).set, { nohousenumber: "yes" });
  ["abc", "", "1<b>"].forEach((v) => assert.equal(Q.answerSet(B.housenumber, b, v, NOW), null, v));
  // re-survey: same → only check_date; a changed value also stamps check_date
  const old = node(1, { shop: "bakery", name: "F", wheelchair: "no" }, NOW - 5 * 365.25 * 86400000);
  assert.deepEqual(Q.answerSet(B.wheelchair, old, "same", NOW), { set: { "check_date:wheelchair": "2026-10-13" }, was: { "check_date:wheelchair": "" } });
  assert.deepEqual(Q.answerSet(B.wheelchair, old, "limited", NOW).set, { wheelchair: "limited", "check_date:wheelchair": "2026-10-13" });
  assert.deepEqual(Q.answerSet(B.wheelchair, old, "no", NOW).set, { "check_date:wheelchair": "2026-10-13" }, "unchanged value: only the date");
});

test("Overpass: one query for the enabled quests, strict parsing with edit time", () => {
  const q = Q.overpassQuery(37.97, 23.71, 37.99, 23.73, ["building_levels", "housenumber", "building_type"]);
  assert.match(q, /^\[out:json\]\[timeout:25\];\(/);
  assert.match(q, /node\["amenity"="bench"\]\(37\.970000,23\.710000,37\.990000,23\.730000\);/);
  assert.ok(!/building/.test(q), "turned-off quests not fetched");
  assert.equal((q.match(/node\["highway"="bus_stop"\]/g) || []).length, 1, "shared selectors once");
  assert.match(q, /out meta center qt 3000;$/);
  const els = Q.parseOverpass({ elements: [
    { type: "node", id: 1, lat: 37.98, lon: 23.72, timestamp: "2024-01-02T03:04:05Z", tags: { amenity: "bench" } },
    { type: "way", id: 2, center: { lat: 37.981, lon: 23.721 }, tags: { highway: "footway" } },
    { type: "way", id: 3, tags: { highway: "footway" } },
    { type: "node", id: -4, lat: 1, lon: 1, tags: {} },
    { type: "area", id: 5, lat: 1, lon: 1 },
    { type: "node", id: 6, lat: 99, lon: 1 }
  ] });
  assert.deepEqual(els.map((e) => e.t + e.id), ["n1", "w2"]);
  assert.equal(els[0].ts, Date.UTC(2024, 0, 2, 3, 4, 5));
  assert.equal(els[1].ts, 0);
});

test("slice: normalize drops bad answers, hide keys, settings; done per device and day", () => {
  const d = Q.normalize({
    answers: {
      abcdef1: { id: "abcdef1", m: 5, dev: "dev1", q: "bench_backrest", t: "n", oid: 3, lat: 37.98, lon: 23.72, set: { backrest: "yes" }, was: {}, name: "<b>x</b>" },
      abcdef2: { id: "abcdef2", m: 5, dev: "dev1", q: "nope", t: "n", oid: 3, lat: 1, lon: 1, set: { a: "b" } },
      abcdef3: { id: "abcdef3", m: 5, dev: "dev1", q: "bench_backrest", t: "n", oid: 3, lat: 1, lon: 1, set: {} },
      abcdef4: { id: "abcdef4", m: 5, dev: "dev1", q: "bench_backrest", t: "x", oid: 3, lat: 1, lon: 1, set: { a: "b" } }
    },
    hide: { "n3:bench_backrest": 9, "n3:nope": 9, "x3:bench_backrest": 9, "n0:bench_backrest": 9 },
    set: { m: 3, off: ["way_lit", "way_lit", "bogus"] },
    done: { dev1: { "2026-10-13": 4, "bad": 1, "2026-10-12": -1 }, "BAD DEV": { "2026-10-13": 1 } }
  });
  assert.deepEqual(Object.keys(d.answers), ["abcdef1"]);
  assert.equal(d.answers.abcdef1.name, "<b>x</b>", "kept as text; the UI uses textContent");
  assert.deepEqual(d.answers.abcdef1.was, { backrest: "" });
  assert.deepEqual(Object.keys(d.hide), ["n3:bench_backrest"]);
  assert.deepEqual(d.set, { m: 3, off: ["way_lit"] });
  assert.deepEqual(d.done, { dev1: { "2026-10-13": 4 } });
  assert.equal(JSON.stringify(Q.normalize(d)), JSON.stringify(d), "canonical");
});

test("merge: LWW answers + tombs, hide max, settings LWW, done counters never double count", () => {
  const a = { answers: { abcdef1: { id: "abcdef1", m: 5, dev: "dev1", q: "bench_backrest", t: "n", oid: 3, lat: 1, lon: 1, set: { backrest: "yes" } } },
    done: { dev1: { "2026-10-13": 3 } }, set: { m: 2, off: ["smoking"] }, hide: { "n1:smoking": 4 } };
  const b = { tombs: { abcdef1: 6 }, done: { dev1: { "2026-10-13": 2 }, dev2: { "2026-10-13": 5 } }, set: { m: 7, off: [] }, hide: { "n1:smoking": 9 } };
  const m = Q.merge(a, b);
  assert.deepEqual(m.answers, {});
  assert.equal(m.tombs.abcdef1, 6);
  assert.deepEqual(m.done, { dev1: { "2026-10-13": 3 }, dev2: { "2026-10-13": 5 } });
  assert.deepEqual(m.set, { m: 7, off: [] });
  assert.equal(m.hide["n1:smoking"], 9);
  assert.deepEqual(Q.doneStats(m, NOW), { total: 8, today: 8, streak: 1 });
  // streak counts back from yesterday when nothing today yet
  const s = Q.doneStats({ done: { dev1: { "2026-10-12": 1, "2026-10-11": 2, "2026-10-09": 1 } } }, NOW);
  assert.deepEqual(s, { total: 4, today: 0, streak: 2 });
});

test("merge fuzz: symmetric, idempotent, associative, canonical", () => {
  let seed = 7;
  const rnd = (n) => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % n; };
  const qs = Q.QUESTS.map((q) => q.id);
  function make() {
    const d = { answers: {}, tombs: {}, hide: {}, set: { m: rnd(5), off: [qs[rnd(16)]] }, done: {} };
    for (let i = 0; i < 4; i++) {
      const id = "ans" + rnd(6) + "xyz";
      d.answers[id] = { id, m: rnd(9), dev: "dev" + rnd(3), q: qs[rnd(16)], t: "n", oid: 1 + rnd(5), lat: 1, lon: 2, set: { k: "v" + rnd(3) } };
      if (rnd(3) === 0) d.tombs["ans" + rnd(6) + "xyz"] = rnd(10);
      d.hide["n" + (1 + rnd(4)) + ":" + qs[rnd(16)]] = rnd(10);
      (d.done["dev" + rnd(3)] = d.done["dev" + rnd(3)] || {})["2026-10-1" + rnd(4)] = 1 + rnd(5);
    }
    return d;
  }
  for (let r = 0; r < 2000; r++) {
    const x = make(), y = make(), z = make();
    const xy = Q.merge(x, y);
    assert.deepEqual(xy, Q.merge(y, x));
    assert.deepEqual(Q.merge(xy, xy), xy);
    assert.deepEqual(Q.merge(Q.merge(x, y), z), Q.merge(x, Q.merge(y, z)));
    assert.equal(JSON.stringify(Q.normalize(xy)), JSON.stringify(xy));
  }
});

test("wiring: scripts in order, slice registered, changeset tags, notes prefill, precache", () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "maps/index.html"), "utf8");
  const order = ["poi-core.js", "quests-core.js", "quests.js"].map((f) => html.indexOf('src="' + f + "?v="));
  order.forEach((i) => assert.ok(i > 0));
  for (let i = 1; i < order.length; i++) assert.ok(order[i] > order[i - 1]);
  const ui = fs.readFileSync(path.join(__dirname, "..", "maps/quests.js"), "utf8");
  assert.match(ui, /registerSlice\("mapsquests", sliceGet, sliceSet, DATA_KEY, Q\.merge\)/);
  assert.match(ui, /"orOS:quest_type": qid/);
  assert.match(ui, /source: "survey"/);
  assert.ok(!/\.innerHTML\s*=\s*(?!\s|ICON|'<svg)/.test(ui), "innerHTML only for static icons");
  const notes = fs.readFileSync(path.join(__dirname, "..", "maps/notes.js"), "utf8");
  assert.match(notes, /function newNote\(lat, lon, text\)/);
  const sw = fs.readFileSync(path.join(__dirname, "..", "sw.js"), "utf8");
  ["maps/quests-core.js", "maps/quests.js"].forEach((f) => assert.ok(sw.includes('"' + f + '"'), f));
});

// ---------- maps wave 8 ----------
test("wave 8 quests apply where they should", () => {
  const els = [
    way(20, { highway: "residential", name: "Οδός Β" }),
    way(21, { highway: "residential" }),
    way(22, { highway: "residential", noname: "yes", maxspeed: "30" }),
    way(23, { highway: "steps" }),
    node(24, { highway: "crossing", crossing: "traffic_signals", tactile_paving: "yes" }),
    node(25, { highway: "bus_stop" }),
    node(26, { railway: "level_crossing" }),
    node(27, { amenity: "parking", parking: "surface", access: "private" }),
    node(28, { amenity: "bicycle_parking" }),
    node(29, { amenity: "restaurant", name: "Ταβέρνα" }),
    node(30, { amenity: "restaurant", name: "Χορτοφάγος", "diet:vegetarian": "only" }),
    node(31, { shop: "kiosk", name: "Περίπτερο", "payment:cash": "yes" }),
    node(32, { amenity: "toilets" }),
    node(33, { emergency: "defibrillator" }),
    node(34, { emergency: "fire_hydrant" }),
    node(35, { amenity: "post_box" }),
    way(36, { building: "yes" })
  ];
  const got = ids(els);
  ["w20:maxspeed:new", "w21:road_name:new", "w21:maxspeed:new", "w23:steps_count:new", "w23:steps_handrail:new",
    "n25:stop_name:new", "n25:bus_shelter:new", "n26:level_crossing_barrier:new",
    "n28:bike_parking_capacity:new", "n28:bike_parking_covered:new", "n29:diet_vegetarian:new", "n29:payment:new",
    "n29:internet_access:new", "n30:diet_vegan:new", "n32:toilets_wheelchair:new", "n32:toilets_fee:new",
    "n33:aed_indoor:new", "n34:fire_hydrant_type:new", "n35:postbox_times:new", "w36:building_type:new"]
    .forEach((x) => assert.ok(got.includes(x), x));
  ["w20:road_name", "w22:road_name", "n27:parking_type", "w22:maxspeed", "n24:tactile_paving", "n27:parking_fee", "n29:diet_vegan",
    "n31:payment", "n30:diet_vegetarian"].forEach((x) => assert.ok(!got.some((g) => g.startsWith(x + ":")), x));
});

test("wave 8 answers: name, none, collection times, speed, multi payment", () => {
  const B = Q.BY_ID;
  const road = way(21, { highway: "residential" });
  assert.deepEqual(Q.answerSet(B.road_name, road, "  Οδός Ερμού ", NOW).set, { name: "Οδός Ερμού" });
  assert.deepEqual(Q.answerSet(B.road_name, road, "none", NOW).set, { noname: "yes" });
  assert.equal(Q.answerSet(B.road_name, road, "1234", NOW), null);              // letters required
  assert.equal(Q.answerSet(B.road_name, road, "<b>x</b>", NOW), null);
  assert.equal(Q.answerSet(B.road_name, road, "see https://x.y", NOW), null);
  assert.deepEqual(Q.answerSet(B.stop_name, node(25, { highway: "bus_stop" }), "none", NOW).set, { "name:signed": "no" });
  const pb = node(35, { amenity: "post_box" });
  assert.deepEqual(Q.answerSet(B.postbox_times, pb, "Mo-Fr 18:00; Sa 12:00", NOW).set, { collection_times: "Mo-Fr 18:00; Sa 12:00" });
  assert.deepEqual(Q.answerSet(B.postbox_times, pb, "unsigned", NOW).set, { "collection_times:signed": "no" });
  assert.deepEqual(Q.answerSet(B.maxspeed, road, "50", NOW).set, { maxspeed: "50" });
  assert.equal(Q.answerSet(B.maxspeed, road, "500", NOW), null);
  assert.deepEqual(Q.answerSet(B.payment, node(29, { amenity: "restaurant", name: "T" }), ["cash", "contactless"], NOW).set,
    { "payment:cash": "yes", "payment:contactless": "yes" });
  // opening hours still behave as before
  assert.deepEqual(Q.answerSet(B.opening_hours, node(1, { shop: "bakery", name: "Φ" }), "24/7", NOW).set, { opening_hours: "24/7" });
});

test("achievements: categories, levels, unlocked links, level-ups", () => {
  let s = Q.normStats(null);
  assert.ok(Q.achievements(s).every((c) => c.level === 0 && c.links.length === 0));
  s = Q.addCount(s, "dev1", "way_lit", 9);
  s = Q.addCount(s, "dev1", "maxspeed", 1);
  s = Q.addCount(s, "dev2", "opening_hours", 1);
  const a = Q.achievements(s), st = a.find((c) => c.id === "streets");
  assert.equal(st.n, 10);
  assert.equal(st.level, 2);
  assert.equal(st.next, 20);
  assert.equal(st.links.length, 1);
  assert.equal(a.find((c) => c.id === "places").level, 1);
  const ups = Q.levelUps(Q.addCount(s, "dev1", "way_lit", -5), Q.addCount(s, "dev1", "way_surface", 20));
  assert.deepEqual(ups.map((c) => [c.id, c.level]), [["streets", 3]]);
  // unknown quest ids (from a newer version) are kept but count nowhere
  const k = Q.normStats({ cnt: { dev1: { future_quest: 4, "Bad!": 2 } } });
  assert.deepEqual(k.cnt, { dev1: { future_quest: 4 } });
});

test("stats slice: normalize, merge max per device, team LWW, fuzz", () => {
  assert.deepEqual(Q.normStats({ cnt: { "x": { way_lit: 2 }, dev1: { way_lit: -1, way_surface: 1.5 } }, team: { m: 5, size: 13, idx: 0 } }),
    { ver: 1, cnt: {}, team: { m: 0, size: 1, idx: 0 } });
  const A = { cnt: { dev1: { way_lit: 5 } }, team: { m: 10, size: 3, idx: 1 } };
  const B = { cnt: { dev1: { way_lit: 3, maxspeed: 2 }, dev2: { way_lit: 1 } }, team: { m: 20, size: 4, idx: 3 } };
  const m = Q.mergeStats(A, B);
  assert.deepEqual(m.cnt, { dev1: { maxspeed: 2, way_lit: 5 }, dev2: { way_lit: 1 } });
  assert.deepEqual(m.team, { m: 20, size: 4, idx: 3 });
  const rnd = (i) => ({ cnt: { ["dev" + (i % 3 + 1)]: { way_lit: i % 7 + 1, maxspeed: i % 5 + 1 } }, team: { m: i * 3 % 11, size: i % 4 + 1, idx: 0 } });
  for (let i = 0; i < 200; i++) {
    const x = rnd(i), y = rnd(i * 7 + 1), z = rnd(i * 13 + 2);
    assert.deepEqual(Q.mergeStats(x, y), Q.mergeStats(y, x));
    assert.deepEqual(Q.mergeStats(x, x), Q.normStats(x));
    assert.deepEqual(Q.mergeStats(Q.mergeStats(x, y), z), Q.mergeStats(x, Q.mergeStats(y, z)));
  }
});

test("team mapping: every element goes to exactly one member, stable", () => {
  const els = []; for (let i = 1; i <= 300; i++) els.push(node(i, { amenity: "bench" }));
  const size = 4, per = [0, 0, 0, 0];
  els.forEach((e) => {
    const owners = [0, 1, 2, 3].filter((idx) => Q.teamKeeps(e, { size, idx }));
    assert.equal(owners.length, 1);
    per[owners[0]]++;
  });
  assert.ok(per.every((n) => n > 40), "roughly even: " + per);
  assert.equal(Q.teamOf("n123", 5), Q.teamOf("n123", 5));
  assert.ok(Q.teamKeeps(els[0], { size: 1, idx: 0 }) && Q.teamKeeps(els[0], null));
});

test("wave 8 wiring: stats slice registered, badges and team in the UI", () => {
  const js = fs.readFileSync(path.join(__dirname, "..", "maps/quests.js"), "utf8");
  assert.match(js, /registerSlice\("mapsqstats", statsGet, statsSet, STATS_KEY, Q\.mergeStats\)/);
  assert.match(js, /countDone\(used\.length, qid\)/);
  assert.match(js, /Q\.teamKeeps\(x\.el, stats\.team\)/);
  (js.match(/innerHTML\s*=\s*[^;]+;/g) || []).forEach((m) => assert.match(m, /innerHTML = ('<svg[^']*'|ICON);/, "innerHTML only from fixed icons: " + m.slice(0, 60)));
});
