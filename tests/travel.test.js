// Pure logic of Travel: normalization, the per-field merge (sync slice
// "travel"), templates and quantities, days and nights without a stay,
// the text and iCalendar builders.
// Run: node --test tests/
//
// The app is a browser IIFE with no exports, so sections 1–3 are cut
// out of the source and evaluated on their own.

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { webcrypto } = require("crypto");

const src = fs.readFileSync(path.join(__dirname, "..", "travel/travel.js"), "utf8");
function block(from, to) {
  const i = src.indexOf(from), j = src.indexOf(to, i);
  if (i < 0 || j < 0) throw new Error("missing block " + from);
  return src.slice(i, j);
}
function build(lang) {
  return new Function("crypto",
    "var LANG = " + JSON.stringify(lang) + ";\n" +
    block("  // ---------- 1. Constants", "  // ---------- 4. Storage") +
    "\nreturn { TRIP_F, PACK_F, PLAN_F, SEEDS, SEED_IDS, DEFAULT_TPLS, GROUPS, KINDS, TOMB_TTL, DAY_MS, NO_DATE_DAYS," +
    " mergeTravel, normEnt, NORM, tplList, seedTpl, ruleQty, tripDays, tripNights, combineTpls, missingFrom," +
    " tripDayList, stayGaps, sortEntries, planSections, packGroups, tripPhase, countdown, tripText, tripIcs, icsFold," +
    " addDays, dayDiff, isYmd, newId, normGrp, fuelCost, parseDec," +
    " DOC_F, SPEND_F, JRNL_F, budget, parseCents, dayPoints, needsGeo, geoQuery, tripGpx, decodePoly, sketchPath," +
    " jrnlId, splitTarget, normGeo, fmtMoney };")(webcrypto);
}
const T = build("en");
const TEL = build("el");

let seq = 0;
function id(p) { return (p || "x") + "id" + String(++seq).padStart(4, "0"); }
function stamps(fields, s) { const f = {}; fields.forEach((k) => { f[k] = s; }); return f; }
function trip(o, s) {
  return Object.assign({ id: id("t"), name: "Rome", dest: "Rome, Italy", start: "2026-10-12", end: "2026-10-15",
    people: [], notes: "", pack: [], plan: [] }, o, { f: Object.assign(stamps(T.TRIP_F, s || 1000), (o && o.f) || {}) });
}
function item(o, s) {
  return Object.assign({ id: id("p"), name: "Socks", qty: 1, rule: null, grp: "@clothes", who: "", note: "", done: false },
    o, { f: Object.assign(stamps(T.PACK_F, s || 1000), (o && o.f) || {}) });
}
function entry(o, s) {
  return Object.assign({ id: id("e"), kind: "activity", title: "Museum", day: "2026-10-13", t1: "", day2: "", t2: "",
    place: "", from: "", to: "", ref: "", note: "", pos: 0 }, o, { f: Object.assign(stamps(T.PLAN_F, s || 1000), (o && o.f) || {}) });
}
function data(trips, tpls, tombs) { return { ver: 1, trips: trips || [], tpls: tpls || [], tombs: tombs || {} }; }
const J = JSON.stringify;
const M = (a, b) => T.mergeTravel(a, b);

test("normalize: invalid fields fall back, unknown keys drop, every stamp spelled out", () => {
  const raw = { id: "abcd1234", name: "  A   trip ", dest: 5, start: "2026-02-30", end: "2026-03-01",
    people: ["Ann", "ann", " ", "Bob", 7], notes: "a\u0000b\nc", evil: "<script>", f: { name: 9, start: -1 } };
  const x = T.normEnt(raw, T.TRIP_F, T.NORM.trip);
  assert.deepEqual(x, { id: "abcd1234", name: "A trip", dest: "", start: "", end: "2026-03-01",
    people: ["Ann", "Bob"], notes: "ab\nc", cur: "", bplan: {}, geo: null,     // wave 31 fields: defaults
    f: { name: 9, dest: 0, start: 0, end: 0, people: 0, notes: 0, cur: 0, bplan: 0, geo: 0 } });
  assert.equal(T.normEnt({ id: "BAD ID" }, T.TRIP_F, T.NORM.trip), null);
  const p = T.normEnt({ id: "item0001", name: "x", qty: 500, rule: { m: "every", n: 1 }, grp: "@nope", done: "yes" },
    T.PACK_F, T.NORM.pack);
  assert.equal(p.qty, 99);
  assert.equal(p.rule, null);                          // "every 1 day" is not a rule
  assert.equal(p.grp, "nope");                         // unknown built-in → a custom group, @ stripped
  assert.equal(p.done, false);
  assert.equal(T.normGrp("@before"), "@before");
  assert.equal(T.normGrp(""), "@misc");
  const e = T.normEnt({ id: "entr0001", kind: "rocket", t1: "25:00", t2: "09:05" }, T.PLAN_F, T.NORM.plan);
  assert.equal(e.kind, "other");
  assert.equal(e.t1, "");
  assert.equal(e.t2, "09:05");
});

test("merge: symmetric, idempotent, canonical (R5, R26)", () => {
  const p1 = item({ name: "Socks" }), p2 = item({ name: "Hat", grp: "@clothes" });
  const a = data([trip({ id: "trip0001", pack: [p1], plan: [entry({ id: "entr0001" })] })], [{ id: "tplm0001", m: 5, name: "Mine", items: [{ name: "x", grp: "@misc", qty: 2, rule: null }] }]);
  const b = data([trip({ id: "trip0001", pack: [p2] }), trip({ id: "trip0002", name: "Paris" })], [], { gone0001: 50 });
  const ab = M(a, b), ba = M(b, a);
  assert.equal(J(ab), J(ba));
  assert.equal(J(M(ab, ab)), J(ab));
  assert.equal(J(M(ab, {})), J(ab));
  assert.deepEqual(ab.trips.map((x) => x.id), ["trip0001", "trip0002"]);
  assert.equal(ab.trips[0].pack.length, 2);
  assert.deepEqual(Object.keys(ab.trips[0]), ["id", "name", "dest", "start", "end", "people", "notes", "cur", "bplan", "geo", "f",
    "pack", "plan", "docs", "spend", "jrnl"]);
  assert.deepEqual(Object.keys(ab), ["ver", "trips", "tpls", "tombs"]);
  // order of items in the input never matters
  const c = data([trip({ id: "trip0001", pack: [p2, p1] })]);
  const d = data([trip({ id: "trip0001", pack: [p1, p2] })]);
  assert.equal(J(M(c, c)), J(M(d, d)));
});

test("merge: field by field, the newer stamp wins (phone ticks, desktop changes the quantity)", () => {
  const base = item({ id: "item0001", name: "Socks", qty: 3 }, 1000);
  const phone = Object.assign({}, base, { done: true, f: Object.assign({}, base.f, { done: 2000 }) });
  const desk = Object.assign({}, base, { qty: 5, f: Object.assign({}, base.f, { qty: 2100 }) });
  const t1 = trip({ id: "trip0001", pack: [phone] }), t2 = trip({ id: "trip0001", pack: [desk] });
  const m = M(data([t1]), data([t2]));
  const x = m.trips[0].pack[0];
  assert.equal(x.done, true);
  assert.equal(x.qty, 5);
  assert.equal(x.f.done, 2000);
  assert.equal(x.f.qty, 2100);
  // equal stamps: the larger serialization, on both sides
  const y1 = trip({ id: "trip0002", name: "Alpha" }, 3000), y2 = trip({ id: "trip0002", name: "Beta" }, 3000);
  assert.equal(M(data([y1]), data([y2])).trips[0].name, "Beta");
  assert.equal(M(data([y2]), data([y1])).trips[0].name, "Beta");
});

test("merge: tombstones (R17): delete wins ties, a newer edit resurrects, items die with their id", () => {
  const tr = trip({ id: "trip0001" }, 1000);
  assert.equal(M(data([tr]), data([], [], { trip0001: 1000 })).trips.length, 0);       // tie → deleted
  const edited = trip({ id: "trip0001", f: { notes: 1500 } }, 1000);
  assert.equal(M(data([edited]), data([], [], { trip0001: 1200 })).trips.length, 1);    // newer edit lives
  const p = item({ id: "item0001" }, 1000);
  const withItem = trip({ id: "trip0002", pack: [p] });
  const m = M(data([withItem]), data([], [], { item0001: 1100 }));
  assert.equal(m.trips[0].pack.length, 0);
  assert.equal(m.tombs.item0001, 1100);
});

test("merge: old tombstones prune against the newest stamp in the data, never a hidden ready template", () => {
  const now = 400 * T.DAY_MS;
  const d = data([trip({ id: "trip0001" }, now)], [], { olditem1: now - T.TOMB_TTL - 1, newitem1: now - 1000, "tpl-ski": 5 });
  const m = M(d, d);
  assert.ok(!("olditem1" in m.tombs));
  assert.ok("newitem1" in m.tombs);
  assert.equal(m.tombs["tpl-ski"], 5);
  assert.equal(J(M(m, m)), J(m));
});

test("two devices converge whatever the order of the pulls", () => {
  const shared = trip({ id: "trip0001", pack: [item({ id: "item0001" }), item({ id: "item0002", name: "Hat" })] }, 1000);
  const A = M(data([shared]), {}), B = M(data([shared]), {});
  // A ticks item0001 and deletes item0002; B renames the trip and adds an entry
  const a = JSON.parse(J(A));
  a.trips[0].pack[0].done = true; a.trips[0].pack[0].f.done = 2000;
  a.tombs.item0002 = 2001;
  const b = JSON.parse(J(B));
  b.trips[0].name = "Roma"; b.trips[0].f.name = 2002;
  b.trips[0].plan.push(entry({ id: "entr0009" }, 2003));
  const x = M(a, b), y = M(b, M(a, b));
  assert.equal(J(x), J(y));
  assert.equal(x.trips[0].name, "Roma");
  assert.deepEqual(x.trips[0].pack.map((p) => [p.id, p.done]), [["item0001", true]]);
  assert.equal(x.trips[0].plan.length, 1);
});

test("templates: ready ones bilingual, ids fixed, hidden by a tombstone, restored by a seed marker", () => {
  assert.equal(T.SEED_IDS.length, 10);
  T.SEED_IDS.forEach((sid) => {
    const s = T.SEEDS[sid];
    assert.ok(s.en && s.el, sid);
    s.items.forEach((it) => {
      assert.ok(it[0] && it[1], sid + " " + it[0]);
      assert.ok(T.GROUPS.indexOf(it[2]) >= 0, sid + " group " + it[2]);
      assert.ok(Number.isInteger(it[3]) && it[3] >= 1);
      if (it[4]) assert.ok(it[4] === "day" ? it[5] >= 1 && it[5] <= 20 : it[5] >= 2 && it[5] <= 14, sid + " rule");
    });
    const keys = s.items.map((it) => it[2] + "|" + it[0].toLowerCase());
    assert.equal(new Set(keys).size, keys.length, sid + " duplicates");
  });
  assert.equal(TEL.seedTpl("tpl-beach").name, "Παραλία");
  assert.equal(T.seedTpl("tpl-beach").items[0].name, "Swimsuit");
  const empty = M({}, {});
  assert.equal(T.tplList(empty).length, 10);
  const hidden = M(data([], [], { "tpl-ski": 10 }), {});
  assert.ok(!T.tplList(hidden).some((x) => x.id === "tpl-ski"));
  const restored = M(hidden, data([], [{ id: "tpl-ski", m: 11, seed: 1 }]));
  const ski = T.tplList(restored).find((x) => x.id === "tpl-ski");
  assert.equal(ski.kind, "seed");
  const edited = M({}, data([], [{ id: "tpl-ski", m: 12, name: "My ski", items: [{ name: "Skis", grp: "@gear", qty: 1, rule: null }] }]));
  assert.equal(T.tplList(edited).find((x) => x.id === "tpl-ski").kind, "edited");
  // a seed marker on a user id is not a template
  assert.equal(M({}, data([], [{ id: "abcd1234", m: 1, seed: 1 }])).tpls.length, 0);
});

test("quantities follow the trip's days; templates combine by name + group, the larger wins", () => {
  const tr = trip({ start: "2026-10-12", end: "2026-10-15" });
  assert.equal(T.tripDays(tr), 4);
  assert.equal(T.tripNights(tr), 3);
  assert.equal(T.tripDays(trip({ start: "", end: "" })), T.NO_DATE_DAYS);
  assert.equal(T.tripDays(trip({ start: "2026-10-12", end: "" })), 1);
  assert.equal(T.ruleQty({ m: "day", n: 1 }, 4), 4);
  assert.equal(T.ruleQty({ m: "day", n: 6 }, 30), 99);
  assert.equal(T.ruleQty({ m: "every", n: 2 }, 5), 3);
  assert.equal(T.ruleQty({ m: "every", n: 4 }, 1), 1);
  const a = { items: [{ name: "Socks", grp: "@clothes", qty: 1, rule: { m: "day", n: 1 } }, { name: "Hat", grp: "@clothes", qty: 1, rule: null }] };
  const b = { items: [{ name: "socks", grp: "@clothes", qty: 7, rule: null }, { name: "Hat", grp: "@misc", qty: 1, rule: null }] };
  const c = T.combineTpls([a, b], 4);
  assert.deepEqual(c.map((x) => [x.name, x.grp, x.qty, !!x.rule]),
    [["Socks", "@clothes", 7, false], ["Hat", "@clothes", 1, false], ["Hat", "@misc", 1, false]]);
  const have = trip({ pack: [item({ name: "HAT", grp: "@clothes" })] });
  assert.deepEqual(T.missingFrom(have, c).map((x) => x.name + x.grp), ["Socks@clothes", "Hat@misc"]);
  // the essentials for a 4-day trip
  const basic = T.combineTpls([T.seedTpl("tpl-basic")], 4);
  assert.equal(basic.find((x) => x.name === "Underwear").qty, 4);
  assert.equal(basic.find((x) => x.name === "T-shirts").qty, 2);
});

test("days, nights without a stay, overnight transport", () => {
  const tr = trip({ start: "2026-10-12", end: "2026-10-16" });
  assert.deepEqual(T.tripDayList(tr), ["2026-10-12", "2026-10-13", "2026-10-14", "2026-10-15", "2026-10-16"]);
  assert.deepEqual(T.stayGaps(tr), ["2026-10-12", "2026-10-13", "2026-10-14", "2026-10-15"]);
  tr.plan = [entry({ kind: "stay", title: "Hotel", day: "2026-10-12", day2: "2026-10-14" }),
             entry({ kind: "ferry", day: "2026-10-14", day2: "2026-10-15", t1: "22:00", t2: "07:00" })];
  assert.deepEqual(T.stayGaps(tr), ["2026-10-15"]);
  // DST: the last Sunday of October still counts as one day
  assert.equal(T.dayDiff("2026-10-24", "2026-10-26"), 2);
  assert.equal(T.addDays("2026-03-28", 2), "2026-03-30");
  assert.equal(T.isYmd("2026-02-29"), false);
  assert.equal(T.isYmd("2028-02-29"), true);
});

test("itinerary order: timed by time, then the untimed in their order; sections", () => {
  const e1 = entry({ id: "entr0001", t1: "18:00" }), e2 = entry({ id: "entr0002", t1: "09:00" });
  const e3 = entry({ id: "entr0003", pos: 1 }), e4 = entry({ id: "entr0004", pos: 0 });
  assert.deepEqual(T.sortEntries([e1, e3, e2, e4]).map((x) => x.id), ["entr0002", "entr0001", "entr0004", "entr0003"]);
  const tr = trip({ start: "2026-10-12", end: "2026-10-13",
    plan: [e1, entry({ id: "entr0005", day: "2026-11-01" }), entry({ id: "entr0006", day: "" })] });
  const s = T.planSections(tr);
  assert.deepEqual(s.map((x) => [x.day, x.items.length, !!x.other, !!x.undated]),
    [["2026-10-12", 0, false, false], ["2026-10-13", 1, false, false], ["2026-11-01", 1, true, false], ["", 1, false, true]]);
});

test("phases and countdown", () => {
  const tr = trip({ start: "2026-10-12", end: "2026-10-15" });
  assert.equal(T.tripPhase(tr, "2026-10-01"), "next");
  assert.equal(T.countdown(tr, "2026-10-01"), "In 11 days");
  assert.equal(T.countdown(tr, "2026-10-11"), "Tomorrow");
  assert.equal(T.countdown(tr, "2026-10-12"), "Leaving today");
  assert.equal(T.countdown(tr, "2026-10-13"), "Day 2 of 4");
  assert.equal(T.tripPhase(tr, "2026-10-16"), "past");
  assert.equal(T.tripPhase(trip({ start: "" }), "2026-10-16"), "idea");
  assert.equal(TEL.countdown(tr, "2026-10-01"), "Σε 11 μέρες");
});

test("packing groups: built-in order, custom groups by name, Before I leave last", () => {
  const g = T.packGroups([item({ grp: "@before", name: "Water" }), item({ grp: "Camera bag" }), item({ grp: "@docs" }),
    item({ grp: "@clothes", name: "b" }), item({ grp: "@clothes", name: "A" })]);
  assert.deepEqual(g.map((x) => x.grp), ["@clothes", "@docs", "Camera bag", "@before"]);
  assert.deepEqual(g[0].items.map((x) => x.name), ["A", "b"]);
});

test("text export: ticks, quantities, the itinerary per day, notes", () => {
  const tr = trip({ name: "Rome", start: "2026-10-12", end: "2026-10-13", people: ["Ann", "Bob"], notes: "Hotel phone 123",
    pack: [item({ name: "Socks", qty: 2, done: true }), item({ name: "Passport", grp: "@docs", who: "Ann" })],
    plan: [entry({ kind: "flight", title: "A3 650", from: "ATH", to: "FCO", day: "2026-10-12", t1: "09:30", t2: "11:00", ref: "XYZ1" })] });
  const s = T.tripText(tr);
  assert.match(s, /^Rome\n12\/10\/2026 – 13\/10\/2026 · 1 night\n/);
  assert.match(s, /☑ 2 × Socks/);
  assert.match(s, /☐ Passport \(Ann\)/);
  assert.match(s, /09:30–11:00 A3 650 · ATH → FCO · booking XYZ1/);
  assert.match(s, /NOTES\nHotel phone 123\n$/);
});

test("iCalendar: CRLF, folded at 75 octets, escaped, floating times, all-day spans", () => {
  const tr = trip({ id: "trip0001", name: "Rome; with, commas", start: "2026-10-12", end: "2026-10-14",
    plan: [entry({ id: "entr0001", kind: "stay", title: "Hotel", day: "2026-10-12", day2: "2026-10-14", t1: "15:00" }),
           entry({ id: "entr0002", title: "Dinner", day: "2026-10-12", t1: "20:30" }),
           entry({ id: "entr0003", kind: "flight", title: "Night flight", day: "2026-10-13", t1: "23:00", day2: "2026-10-14", t2: "02:00" }),
           entry({ id: "entr0004", title: "X".repeat(200), day: "2026-10-13" }),
           entry({ id: "entr0005", title: "Someday", day: "" })] });
  const ics = T.tripIcs(tr, Date.UTC(2026, 9, 8, 12, 0, 0));
  assert.ok(ics.startsWith("BEGIN:VCALENDAR\r\nVERSION:2.0\r\n"));
  assert.ok(ics.endsWith("END:VCALENDAR\r\n"));
  assert.ok(!/[^\r]\n/.test(ics));
  ics.split("\r\n").forEach((l) => assert.ok(Buffer.byteLength(l) <= 75, l));
  assert.match(ics, /SUMMARY:Rome\\; with\\, commas/);
  assert.match(ics, /UID:trip0001@useoros.online\r\nDTSTAMP:20261008T120000Z\r\nDTSTART;VALUE=DATE:20261012\r\nDTEND;VALUE=DATE:20261015/);
  assert.match(ics, /UID:entr0001@useoros.online\r\nDTSTAMP:\d+T\d+Z\r\nDTSTART;VALUE=DATE:20261012\r\nDTEND;VALUE=DATE:20261014/);
  assert.match(ics, /DTSTART:20261012T203000\r\nDURATION:PT1H/);
  assert.match(ics, /DTSTART:20261013T230000\r\nDTEND:20261014T020000/);
  assert.ok(!/entr0005/.test(ics));                         // no day: not in a calendar
  assert.equal((ics.match(/BEGIN:VEVENT/g) || []).length, 5);
  // multi-byte characters are never split by a fold
  const f = T.icsFold("SUMMARY:" + "Ταξίδι ".repeat(20));
  f.split("\r\n").forEach((l) => assert.ok(Buffer.byteLength(l) <= 75));
  assert.equal(f.replace(/\r\n /g, ""), "SUMMARY:" + "Ταξίδι ".repeat(20));
});

test("strings: both languages have every key", () => {
  const m = src.match(/var STRINGS = \{\s*en: \{([\s\S]*?)\n    \},\n    el: \{([\s\S]*?)\n    \}\n  \};/);
  assert.ok(m);
  const keys = (s) => (s.match(/"([a-zA-Z0-9.]+)":/g) || []).map((k) => k.slice(1, -2)).sort();
  assert.deepEqual(keys(m[1]), keys(m[2]));
  // every t("key") used in the file exists
  const en = new Set(keys(m[1]));
  const used = new Set((src.match(/\bt\("([a-zA-Z0-9.]+)"[,)]/g) || []).map((k) => k.slice(3, -2)));
  used.forEach((k) => assert.ok(en.has(k), "missing string " + k));
});

test("fuel cost by car: round trip, per person, bad input", () => {
  assert.deepEqual(T.fuelCost(320, true, 7.1, 1.85, 0), { dist: 640, units: 45.44, cost: 84.06, each: null });
  assert.deepEqual(T.fuelCost(320, false, 7.1, 1.85, 3), { dist: 320, units: 22.72, cost: 42.03, each: 14.01 });
  assert.equal(T.fuelCost(0, true, 7, 1.8, 1), null);
  assert.equal(T.fuelCost(100, true, NaN, 1.8, 1), null);
  assert.equal(T.fuelCost(100, true, 7, -1, 1), null);
  assert.equal(T.fuelCost(100, true, 900, 1.8, 1), null);
  assert.equal(T.parseDec("1,859"), 1.859);
  assert.equal(T.parseDec(" 7.4 "), 7.4);
  assert.ok(isNaN(T.parseDec("abc")));
});

// ---------- wave 31: bookings, map, budget, journal ----------
function doc(o, s) { return Object.assign({ id: id("d"), of: "", file: "", name: "" }, o, { f: Object.assign(stamps(T.DOC_F, s || 1000), (o && o.f) || {}) }); }
function exp(o, s) { return Object.assign({ id: id("s"), cat: "food", amt: 1000, cur: "", day: "", what: "", who: "" }, o, { f: Object.assign(stamps(T.SPEND_F, s || 1000), (o && o.f) || {}) }); }
function jr(o, s) { return Object.assign({ id: id("j"), day: "2026-10-13", text: "", trk: "" }, o, { f: Object.assign(stamps(T.JRNL_F, s || 1000), (o && o.f) || {}) }); }

test("old trips load unchanged: new fields get defaults, new lists are empty", () => {
  const old = { id: "trip0old", name: "Rome", dest: "Rome", start: "2026-10-12", end: "2026-10-14", people: ["A"], notes: "n",
    f: { name: 5, dest: 5, start: 5, end: 5, people: 5, notes: 5 },
    pack: [{ id: "item0old", name: "Socks", qty: 2, rule: null, grp: "@clothes", who: "", note: "", done: true,
             f: { name: 5, qty: 5, rule: 5, grp: 5, who: 5, note: 5, done: 5 } }],
    plan: [{ id: "entr0old", kind: "flight", title: "", day: "2026-10-12", t1: "08:00", day2: "", t2: "", place: "",
             from: "ATH", to: "FCO", ref: "X", note: "", pos: 0, f: { kind: 5, title: 5, day: 5, t1: 5, day2: 5, t2: 5,
             place: 5, from: 5, to: 5, ref: 5, note: 5, pos: 5 } }] };
  const m = M(data([old]), data([]));
  const tr = m.trips[0];
  assert.equal(tr.name, "Rome");
  assert.equal(tr.pack[0].done, true);
  assert.equal(tr.plan[0].from, "ATH");
  assert.deepEqual([tr.cur, tr.bplan, tr.geo, tr.docs, tr.spend, tr.jrnl], ["", {}, null, [], [], []]);
  assert.deepEqual([tr.plan[0].num, tr.plan[0].cost, tr.plan[0].geo, tr.plan[0].geo0], ["", 0, null, null]);
  assert.equal(J(M(m, m)), J(m));
  // an old copy of the same trip (no new fields) never wipes the new ones
  const neu = JSON.parse(J(m));
  neu.trips[0].cur = "USD"; neu.trips[0].f.cur = 9000;
  neu.trips[0].plan[0].num = "A3 650"; neu.trips[0].plan[0].f.num = 9000;
  neu.trips[0].spend = [exp({ id: "sp000001", amt: 500 })];
  const back = M(data([old]), neu);
  assert.equal(back.trips[0].cur, "USD");
  assert.equal(back.trips[0].plan[0].num, "A3 650");
  assert.equal(back.trips[0].spend.length, 1);
  assert.equal(J(M(neu, data([old]))), J(back));
});

test("attachments, expenses and journal days: unioned per trip, tombstones win ties, a newer edit resurrects", () => {
  const d1 = doc({ id: "doc00001", of: "entr0001", file: "doc00001.pdf", name: "ticket.pdf" });
  const d2 = doc({ id: "doc00002", of: "entr0001", file: "doc00002.jpg", name: "qr.jpg" });
  const e1 = exp({ id: "sp000001", amt: 1250, cat: "food" }), e2 = exp({ id: "sp000002", amt: 300, cat: "shop" });
  const a = data([trip({ id: "trip0001", docs: [d1], spend: [e1] })]);
  const b = data([trip({ id: "trip0001", docs: [d2], spend: [e2], jrnl: [jr({ id: "j20261013-trip0001", text: "Pantheon" })] })]);
  const ab = M(a, b);
  assert.equal(J(ab), J(M(b, a)));
  assert.deepEqual(ab.trips[0].docs.map((x) => x.id), ["doc00001", "doc00002"]);
  assert.equal(ab.trips[0].spend.length, 2);
  assert.equal(ab.trips[0].jrnl[0].text, "Pantheon");
  const del = M(ab, data([], [], { doc00001: 1000, sp000002: 1000 }));
  assert.deepEqual(del.trips[0].docs.map((x) => x.id), ["doc00002"]);
  assert.deepEqual(del.trips[0].spend.map((x) => x.id), ["sp000001"]);
  const revived = M(del, data([trip({ id: "trip0001", spend: [exp({ id: "sp000002", amt: 300, cat: "shop" }, 1001)] })]));
  assert.equal(revived.trips[0].spend.length, 2);
  // bad file names, owners and amounts are cleaned
  const x = M(data([trip({ id: "trip0002", docs: [doc({ id: "doc00009", of: "BAD ID", file: "../../etc/passwd", name: "x" })],
    spend: [exp({ id: "sp000009", amt: -5, cat: "nope", cur: "XXX" })] })]), {});
  assert.deepEqual([x.trips[0].docs[0].of, x.trips[0].docs[0].file], ["", ""]);
  assert.deepEqual([x.trips[0].spend[0].amt, x.trips[0].spend[0].cat, x.trips[0].spend[0].cur], [0, "other", ""]);
});

test("journal ids are fixed per trip and day, so two devices write into one entry", () => {
  assert.equal(T.jrnlId("trip0001", "2026-10-13"), "j20261013-trip0001");
  assert.ok(/^[a-z0-9][a-z0-9-]{3,40}$/.test(T.jrnlId("a".repeat(41), "2026-10-13")));
  const phone = jr({ id: "j20261013-trip0001", text: "Phone text", trk: "", f: { text: 2000 } });
  const desk = jr({ id: "j20261013-trip0001", text: "", trk: "abc123track", f: { trk: 2100 } });
  const m = M(data([trip({ id: "trip0001", jrnl: [phone] })]), data([trip({ id: "trip0001", jrnl: [desk] })]));
  assert.equal(m.trips[0].jrnl.length, 1);
  assert.deepEqual([m.trips[0].jrnl[0].text, m.trips[0].jrnl[0].trk], ["Phone text", "abc123track"]);
});

test("budget: planned vs spent per category, bookings count, other currencies apart", () => {
  const raw = data([trip({ id: "trip0001", cur: "EUR", bplan: { transport: 50000, food: 20000, bogus: 5 },
    plan: [entry({ id: "entr0001", kind: "flight", cost: 28950, ccur: "" }), entry({ id: "entr0002", kind: "stay", cost: 40000, ccur: "EUR" }),
           entry({ id: "entr0003", kind: "ticket", cost: 9000, ccur: "USD" })],
    spend: [exp({ id: "sp000001", cat: "food", amt: 2500 }), exp({ id: "sp000002", cat: "food", amt: 1000, cur: "GBP" })] })]);
  const tr = M(raw, {}).trips[0];
  assert.deepEqual(tr.bplan, { transport: 50000, food: 20000 });
  const b = T.budget(tr);
  const row = (c) => b.rows.find((r) => r.cat === c);
  assert.equal(b.cur, "EUR");
  assert.deepEqual([row("transport").plan, row("transport").spent], [50000, 28950]);
  assert.deepEqual([row("stay").plan, row("stay").spent], [0, 40000]);
  assert.deepEqual([row("food").plan, row("food").spent], [20000, 2500]);
  assert.deepEqual(b.total, { plan: 70000, spent: 71450 });
  assert.deepEqual(b.other, [{ cur: "GBP", amt: 1000 }, { cur: "USD", amt: 9000 }]);
  assert.equal(T.budget(Object.assign({}, tr, { cur: "" })).cur, "EUR");
});

test("amounts typed by hand", () => {
  assert.equal(T.parseCents("12,50"), 1250);
  assert.equal(T.parseCents("1.234,5"), 123450);
  assert.equal(T.parseCents("1,234.50"), 123450);
  assert.equal(T.parseCents(" 7 "), 700);
  assert.equal(T.parseCents(""), 0);
  assert.equal(T.parseCents("-3"), -1);
  assert.equal(T.parseCents("1.2.3"), -1);
  assert.equal(T.parseCents("abc"), -1);
});

test("map points in itinerary order, what still needs a point, GPX", () => {
  const tr = M(data([trip({ id: "trip0001", name: "Rome & <Co>", plan: [
    entry({ id: "entr0001", kind: "flight", day: "2026-10-12", t1: "08:00", from: "ATH", to: "FCO",
            geo0: { lat: 37.9364, lon: 23.9445 }, geo: { lat: 41.8003, lon: 12.2389 } }),
    entry({ id: "entr0002", kind: "stay", title: "Hotel", place: "Via Nazionale 1", day: "2026-10-12", t1: "15:00",
            geo: { lat: 41.9, lon: 12.49 } }),
    entry({ id: "entr0003", kind: "activity", title: "Colosseum", day: "2026-10-13" }),
    entry({ id: "entr0004", kind: "train", title: "", from: "Roma", to: "Firenze", day: "2026-10-14", geo: { lat: 999, lon: 0 } })
  ] })]), {}).trips[0];
  const pts = T.dayPoints(tr, "");
  assert.deepEqual(pts.map((p) => [p.name, p.day]), [["ATH", "2026-10-12"], ["FCO", "2026-10-12"], ["Hotel", "2026-10-12"]]);
  assert.equal(T.dayPoints(tr, "2026-10-13").length, 0);
  assert.deepEqual(T.needsGeo(tr).map((n) => [n.id, n.which, n.q]),
    [["entr0003", "geo", "Colosseum"], ["entr0004", "geo0", "Roma"], ["entr0004", "geo", "Firenze"]]);
  assert.equal(T.geoQuery("fco", "flight"), "FCO airport");
  assert.equal(T.geoQuery("Rome", "flight"), "Rome");
  const gpx = T.tripGpx(tr, "");
  assert.match(gpx, /^<\?xml version="1.0" encoding="UTF-8"\?>\n<gpx version="1.1"/);
  assert.equal((gpx.match(/<wpt /g) || []).length, 3);
  assert.equal((gpx.match(/<trkseg>/g) || []).length, 1);
  assert.match(gpx, /Rome &amp; &lt;Co&gt;/);
  assert.ok(!/<Co>/.test(gpx));
  assert.equal(T.tripGpx(tr, "2026-10-13"), "");
  // Maps' own reader takes it (what "Save to Maps as a track" hands over)
  const MT = require(path.join(__dirname, "..", "maps/tracks-core.js"));
  const back = MT.parseGpx(gpx);
  assert.equal(back.wpts.length, 3);
  assert.equal(back.segs[0].length, 3);
});

test("Maps' preview line decodes and sketches", () => {
  // Google's own example: (38.5, -120.2), (40.7, -120.95), (43.252, -126.453)
  const pts = T.decodePoly("_p~iF~ps|U_ulLnnqC_mqNvxq`@");
  assert.deepEqual(pts, [[38.5, -120.2], [40.7, -120.95], [43.252, -126.453]]);
  assert.deepEqual(T.decodePoly(""), []);
  assert.deepEqual(T.decodePoly(null), []);
  T.decodePoly("~~~~");                                    // truncated: no throw
  const d = T.sketchPath(pts, 96, 64);
  assert.match(d, /^M\d+ \d+L\d+ \d+L\d+ \d+$/);
  d.match(/\d+ \d+/g).forEach((xy) => { const [x, y] = xy.split(" ").map(Number); assert.ok(x >= 0 && x <= 96 && y >= 0 && y <= 64); });
  assert.equal(T.sketchPath([[1, 1]], 96, 64), "");
});

test("Split hand-over: name, currency and travellers only", () => {
  const tr = M(data([trip({ id: "trip0001", name: "Rome", cur: "USD", people: ["Ann", "Bob"] })]), {}).trips[0];
  assert.deepEqual(T.splitTarget(tr), { newGroup: { name: "Rome", cur: "USD", people: ["Ann", "Bob"], from: "Travel" } });
  assert.equal(T.normGeo({ lat: 91, lon: 0 }), null);
  assert.deepEqual(T.normGeo({ lat: 41.123456789, lon: 12.5 }), { lat: 41.123457, lon: 12.5 });
});

test("bookings in the text and the .ics export: number, company, price, attachments", () => {
  const tr = M(data([trip({ id: "trip0001", cur: "EUR", plan: [
    entry({ id: "entr0001", kind: "flight", title: "", day: "2026-10-12", t1: "08:15", from: "ATH", to: "FCO", ref: "RXJ34P",
            num: "A3 650", prov: "Aegean", cost: 28950 }),
    entry({ id: "entr0002", kind: "rental", title: "Hertz", place: "FCO T3", day: "2026-10-12", t1: "10:00", day2: "2026-10-14", t2: "09:00" })
  ], docs: [doc({ id: "doc00001", of: "entr0001", file: "doc00001.pdf", name: "boarding.pdf" })] })]), {}).trips[0];
  const txt = T.tripText(tr);
  assert.match(txt, /Aegean A3 650/);
  assert.match(txt, /289\.50/);
  assert.match(txt, /Return .*14\/10 09:00/);
  const ics = T.tripIcs(tr, Date.UTC(2026, 0, 1)).replace(/\r\n /g, "");
  assert.match(ics, /DESCRIPTION:Aegean A3 650\\nBooking code: RXJ34P\\nPrice: [^\\]*289\.50[^\\]*\\nAttached: boarding\.pdf/);
  assert.match(ics, /DTSTART:20261012T100000\r\nDTEND:20261014T090000/);
});
