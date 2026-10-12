// Pure logic of the Unit Converter (units/core.js): the unit
// tables, conversion (exact definitions, temperature, fuel,
// cooking with an ingredient, currency), number input and output,
// the merge (sync slice "units"), currency rates, the query parser
// of the universal search; plus the search provider and the wiring.
// Run: node --test tests/*.test.js

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const fs = require("fs");

const C = require(path.join(__dirname, "..", "units/core.js"));
const P = require(path.join(__dirname, "..", "units/search.js"));
const read = (f) => fs.readFileSync(path.join(__dirname, "..", f), "utf8");

const T0 = 1760000000000;
const close = (a, b, rel) => Math.abs(a - b) <= Math.abs(b) * (rel || 1e-12) + 1e-12;
const conv = (c, f, t, v, o) => { const r = C.convert(c, f, t, v, o); assert.ok(r.ok, `${c} ${f}>${t} ${v}: ${r.err}`); return r.v; };
const RATES = { base: "EUR", date: "2026-10-09", at: T0, src: "x", rates: { USD: 1.1, GBP: 0.85, JPY: 160 } };

test("tables: 15 categories, unique ids, defaults exist, sane symbols", () => {
  assert.equal(C.CATS.length, 15);
  const cats = new Set();
  C.CATS.forEach((c) => {
    assert.ok(!cats.has(c.id), c.id); cats.add(c.id);
    assert.ok(c.en && c.el, c.id);
    if (c.money) return;
    const ids = new Set();
    c.units.forEach((u) => {
      assert.ok(!ids.has(u.id), `${c.id}:${u.id} twice`); ids.add(u.id);
      assert.match(u.id, /^[A-Za-z0-9]{1,8}$/);
      assert.ok(u.sym && u.en && u.el, u.id);
      assert.ok(["m", "i", "o"].includes(u.g), u.id);
      assert.ok(u.fn || u.f > 0 || u.w > 0, u.id);
    });
    assert.ok(ids.has(c.def[0]) && ids.has(c.def[1]) && c.def[0] !== c.def[1], c.id);
  });
});

test("exact definitions and reference values", () => {
  assert.equal(conv("length", "mi", "km", 1), 1.609344);
  assert.equal(conv("length", "in", "cm", 1), 2.54);
  assert.ok(close(conv("length", "ft", "m", 1), 0.3048));
  assert.ok(close(conv("mass", "lb", "kg", 1), 0.45359237));
  assert.ok(close(conv("mass", "oka", "g", 1), 1282.9));
  assert.ok(close(conv("mass", "oka", "drami", 1), 400));
  assert.ok(close(conv("volume", "usgal", "L", 1), 3.785411784));
  assert.ok(close(conv("volume", "ukgal", "L", 1), 4.54609));
  assert.equal(conv("area", "strema", "m2", 5), 5000);
  assert.ok(close(conv("area", "acre", "m2", 1), 4046.8564224));
  assert.ok(close(conv("speed", "kmh", "mph", 100), 62.13711922373339, 1e-9));
  assert.ok(close(conv("speed", "kn", "kmh", 1), 1.852));
  assert.equal(conv("time", "h", "min", 1.5), 90);
  assert.equal(conv("data", "GiB", "MiB", 1), 1024);
  assert.equal(conv("data", "GB", "MB", 1), 1000);
  assert.ok(close(conv("pressure", "bar", "psi", 1), 14.503773773, 1e-9));
  assert.equal(conv("pressure", "atm", "Pa", 1), 101325);
  assert.equal(conv("energy", "kcal", "kJ", 1), 4.184);
  assert.equal(conv("energy", "kWh", "J", 1), 3.6e6);
  assert.ok(close(conv("power", "hp", "W", 1), 745.69987158227022));
  assert.ok(close(conv("angle", "rad", "deg", Math.PI), 180));
  assert.equal(conv("angle", "turn", "deg", -0.5), -180);
});

test("every unit goes there and back", () => {
  C.CATS.forEach((c) => {
    if (c.money) return;
    const o = { dens: 0.53 };
    c.units.forEach((a) => c.units.forEach((b) => {
      const v = c.id === "temp" ? 37.5 : 12.75;
      const there = C.convert(c.id, a.id, b.id, v, o);
      assert.ok(there.ok, `${c.id} ${a.id}>${b.id}`);
      const back = C.convert(c.id, b.id, a.id, there.v, o);
      assert.ok(back.ok && close(back.v, v, 1e-9), `${c.id} ${a.id}>${b.id}>${a.id}: ${back.v}`);
    }));
  });
});

test("temperature: offsets, absolute zero, negatives", () => {
  assert.equal(conv("temp", "C", "F", 0), 32);
  assert.equal(conv("temp", "C", "F", 100), 212);
  assert.ok(close(conv("temp", "F", "C", -40), -40));
  assert.ok(close(conv("temp", "C", "K", -273.15), 0));
  assert.ok(close(conv("temp", "K", "R", 100), 180));
  assert.deepEqual(C.convert("temp", "C", "F", -300), { ok: false, err: "belowZero" });
  assert.deepEqual(C.convert("temp", "K", "C", -1), { ok: false, err: "belowZero" });
  assert.deepEqual(C.convert("length", "m", "ft", -1), { ok: false, err: "neg" });
  assert.deepEqual(C.convert("length", "m", "nope", 1), { ok: false, err: "unit" });
  assert.deepEqual(C.convert("nope", "m", "ft", 1), { ok: false, err: "unit" });
  assert.deepEqual(C.convert("length", "m", "ft", NaN), { ok: false, err: "unit" });
});

test("fuel economy: reciprocal, zero has no counterpart", () => {
  assert.ok(close(conv("fuel", "l100", "mpgus", 10), 23.52145833333, 1e-9));
  assert.ok(close(conv("fuel", "l100", "mpguk", 10), 28.24809363, 1e-8));
  assert.equal(conv("fuel", "kml", "l100", 20), 5);
  assert.ok(close(conv("fuel", "mpgus", "kml", 30), 12.754311, 1e-6));
  assert.equal(conv("fuel", "l100", "l100", 0), 0);
  assert.deepEqual(C.convert("fuel", "l100", "kml", 0), { ok: false, err: "zero" });
  assert.deepEqual(C.convert("fuel", "kml", "mpgus", 0), { ok: false, err: "zero" });
});

test("cooking: spoons and cups, weight through the ingredient", () => {
  assert.equal(conv("cooking", "tbsp", "tsp", 1), 3);
  assert.equal(conv("cooking", "cup", "cml", 1), 250);
  assert.ok(close(conv("cooking", "uscup", "ustbsp", 1), 16));
  assert.equal(conv("cooking", "g", "ckg", 500), 0.5);
  assert.equal(conv("cooking", "cup", "g", 1, { dens: 1 }), 250);          // water
  assert.ok(close(conv("cooking", "cup", "g", 1, { dens: 0.53 }), 132.5));  // flour
  assert.ok(close(conv("cooking", "g", "cup", 132.5, { dens: 0.53 }), 1));
  assert.deepEqual(C.convert("cooking", "cup", "g", 1, {}), { ok: false, err: "dens" });
  assert.equal(C.needsDensity("cooking", "cup", "g"), true);
  assert.equal(C.needsDensity("cooking", "cup", "tbsp"), false);
  assert.equal(C.needsDensity("mass", "g", "kg"), false);
  assert.equal(C.INGREDIENTS.length, 11);
  C.INGREDIENTS.forEach((g) => assert.ok(g[1] > 0 && g[2] && g[3], g[0]));
  assert.equal(C.ingredient("water")[1], 1);
  assert.equal(C.ingredient("nope"), null);
});

test("currency: through the euro, codes come from the rates", () => {
  const ids = C.unitsOf("currency", RATES).map((u) => u.id);
  assert.deepEqual(ids, ["EUR", "USD", "GBP", "JPY"]);
  assert.deepEqual(C.unitsOf("currency", null).map((u) => u.id), ["EUR"]);
  assert.ok(close(conv("currency", "EUR", "USD", 10, { rates: RATES }), 11));
  assert.ok(close(conv("currency", "USD", "GBP", 11, { rates: RATES }), 8.5));
  assert.deepEqual(C.convert("currency", "EUR", "USD", 1, {}), { ok: false, err: "rate" });
  assert.equal(C.factorOf("currency", "EUR", "JPY", { rates: RATES }), 160);
  assert.equal(C.factorOf("temp", "C", "F"), null);
});

test("rates: only a real Frankfurter reply is kept; stale after 6 hours", () => {
  const reply = { amount: 1, base: "EUR", date: "2026-10-09", rates: { USD: 1.1, GBP: 0.85, bad: 3, XXX: -1, YYY: "2", EUR: 1 } };
  const r = C.readRates(reply, T0, "https://api.frankfurter.dev/v1/latest");
  assert.deepEqual(r, { base: "EUR", date: "2026-10-09", at: T0, src: "https://api.frankfurter.dev/v1/latest", rates: { GBP: 0.85, USD: 1.1 } });
  assert.equal(C.readRates({ base: "USD", date: "2026-10-09", rates: { EUR: 1 } }, T0), null);
  assert.equal(C.readRates({ base: "EUR", date: "yesterday", rates: { USD: 1 } }, T0), null);
  assert.equal(C.readRates({ base: "EUR", date: "2026-10-09", rates: {} }, T0), null);
  assert.equal(C.readRates("<html>", T0), null);
  assert.deepEqual(C.storedRates(JSON.parse(JSON.stringify(r))), r);
  assert.equal(C.storedRates({ base: "EUR" }), null);
  assert.equal(C.ratesStale(null, T0), true);
  assert.equal(C.ratesStale(r, T0 + 3600000), false);
  assert.equal(C.ratesStale(r, T0 + 7 * 3600000), true);
  assert.equal(C.ratesStale(r, T0 - 1000), true, "a clock set back refetches");
  assert.ok(C.RATES_URLS.every((u) => u.startsWith("https://api.frankfurter.")));
});

test("numbers in: comma or point, thousands by language, sums, no eval", () => {
  const p = (s, l) => C.parseInput(s, l || "el");
  assert.deepEqual(p("1,5"), { ok: true, v: 1.5 });
  assert.deepEqual(p("1.5"), { ok: true, v: 1.5 });
  assert.deepEqual(p("1.500"), { ok: true, v: 1500 });
  assert.deepEqual(p("1.500", "en"), { ok: true, v: 1.5 });
  assert.deepEqual(p("1,500", "en"), { ok: true, v: 1500 });
  assert.deepEqual(p("1,500"), { ok: true, v: 1.5 });
  assert.deepEqual(p("0.500"), { ok: true, v: 0.5 });
  assert.deepEqual(p("1.234,5"), { ok: true, v: 1234.5 });
  assert.deepEqual(p("1,234.5", "en"), { ok: true, v: 1234.5 });
  assert.deepEqual(p("1.000.000"), { ok: true, v: 1e6 });
  assert.deepEqual(p("1 000 000,5"), { ok: true, v: 1000000.5 });
  assert.deepEqual(p(",5"), { ok: true, v: 0.5 });
  assert.deepEqual(p("2*(3+4)"), { ok: true, v: 14 });
  assert.deepEqual(p("2,5 × 4"), { ok: true, v: 10 });
  assert.deepEqual(p("10 ÷ 4"), { ok: true, v: 2.5 });
  assert.deepEqual(p("−5"), { ok: true, v: -5 });
  assert.deepEqual(p("-(2+3)"), { ok: true, v: -5 });
  assert.deepEqual(p("1,5e3"), { ok: true, v: 1500 });
  assert.deepEqual(p("2+3*4"), { ok: true, v: 14 });
  for (const bad of ["abc", "1..2", "1,2,3,4", "2+", "(2", "2)", "1/0", "alert(1)", "1.2.3", "e5", "1;2"]) {
    assert.equal(p(bad).ok, false, bad);
  }
  assert.deepEqual(p(""), { ok: false, empty: true });
  assert.deepEqual(p("   "), { ok: false, empty: true });
  assert.deepEqual(C.parseInput(null), { ok: false, empty: true });
  assert.equal(p("1".repeat(201)).ok, false);
});

test("numbers out: significant digits, language format, science", () => {
  assert.equal(C.formatNumber(1.609344, 6, "el"), "1,60934");
  assert.equal(C.formatNumber(1.609344, 6, "en"), "1.60934");
  assert.equal(C.formatNumber(1234567.891, 6, "el", true), "1.234.570");
  assert.equal(C.formatNumber(1234567.891, 6, "el", false), "1234570");
  assert.equal(C.formatNumber(1234.5, 6, "en", true), "1,234.5");
  assert.equal(C.formatNumber(0, 6, "en"), "0");
  assert.equal(C.formatNumber(1e20, 6, "en"), "1 × 10²⁰");
  assert.equal(C.formatNumber(1.5e-9, 4, "el"), "1,5 × 10⁻⁹");
  assert.equal(C.formatNumber(2 / 3, 3, "en"), "0.667");
  assert.equal(C.formatNumber(2 / 3, 99, "en"), "0.666667", "out of range → default 6");
  assert.equal(C.formatNumber(NaN, 6, "en"), "");
  // what the fields show reads back as the same number
  [0.1, 1.5, 1234.5678, 0.000123, 98765.4321, 1500].forEach((v) => ["en", "el"].forEach((l) => {
    const s = C.formatNumber(v, 12, l, false);
    assert.ok(close(C.parseInput(s, l).v, v, 1e-11), `${l} ${v} → ${s}`);
  }));
});

test("unit picker search: names, symbols, both languages", () => {
  const ids = (cat, q) => C.matchUnits(C.unitsOf(cat), q).map((u) => u.id);
  assert.deepEqual(ids("length", "πόδ"), ["ft"]);
  assert.deepEqual(ids("length", "ft"), ["ft"]);
  assert.ok(ids("length", "mile").includes("mi") && ids("length", "mile").includes("nmi"));
  assert.deepEqual(ids("area", "στρεμ"), ["strema"]);
  assert.deepEqual(ids("area", "ΣΤΡΈΜΜΑ"), ["strema"]);
  assert.equal(ids("length", "").length, C.unitsOf("length").length);
  assert.deepEqual(ids("length", "zzz"), []);
  assert.ok(ids("currency", "δολ").length === 0, "no rates → only EUR");
  assert.deepEqual(C.matchUnits(C.unitsOf("currency", RATES), "δολ").map((u) => u.id), ["USD"]);
});

test("query parser: '10 km σε mi' and friends", () => {
  const q = (s, l) => C.parseQuery(s, l || "el", RATES);
  assert.deepEqual(q("10 km σε mi"), { v: 10, cat: "length", from: "km", to: "mi" });
  assert.deepEqual(q("10 km to miles", "en"), { v: 10, cat: "length", from: "km", to: "mi" });
  assert.deepEqual(q("72 f to c"), { v: 72, cat: "temp", from: "F", to: "C" });
  assert.deepEqual(q("20 °C σε °F"), { v: 20, cat: "temp", from: "C", to: "F" });
  assert.deepEqual(q("5 στρέμματα"), { v: 5, cat: "area", from: "strema", to: null });
  assert.deepEqual(q("3,5 κιλά σε λίβρες"), { v: 3.5, cat: "mass", from: "kg", to: "lb" });
  assert.deepEqual(q("1 cup to g"), { v: 1, cat: "cooking", from: "cup", to: "g" });
  assert.deepEqual(q("100 usd σε eur"), { v: 100, cat: "currency", from: "USD", to: "EUR" });
  assert.deepEqual(q("50 € σε $"), { v: 50, cat: "currency", from: "EUR", to: "USD" });
  assert.deepEqual(q("60 mph = km/h"), { v: 60, cat: "speed", from: "mph", to: "kmh" });
  assert.deepEqual(q("2 fl oz to ml"), { v: 2, cat: "volume", from: "usfloz", to: "ml" });
  assert.deepEqual(q("10 ms to s"), { v: 10, cat: "time", from: "ms", to: "s" });
  assert.deepEqual(q("1 oz to g"), { v: 1, cat: "mass", from: "oz", to: "g" });
  assert.deepEqual(q("5 ft → m"), { v: 5, cat: "length", from: "ft", to: "m" });
  for (const bad of ["km", "hello world", "10", "10 km σε κιλά", "10 xyz", "10 km σε mi και", "10 km σε km"]) assert.equal(q(bad), null, bad);
  assert.equal(C.partnerOf("length", "km"), "mi");
  assert.equal(C.partnerOf("length", "mi"), "km");
  assert.equal(C.partnerOf("area", "strema"), "m2");
});

test("merge: favourites and recent, symmetric, canonical, tombstones", () => {
  let d = C.emptyData();
  d = C.toggleFav(d, "temp", "C", "F", T0);
  assert.ok(C.isFav(d, "temp", "C", "F"));
  assert.deepEqual(d.favs, { "temp:C>F": { c: "temp", f: "C", t: "F", m: T0 } });
  const off = C.toggleFav(d, "temp", "C", "F", T0 + 5);
  assert.equal(C.isFav(off, "temp", "C", "F"), false);
  assert.equal(off.tombs["temp:C>F"], T0 + 5);
  const back = C.toggleFav(off, "temp", "C", "F", T0 + 1);      // a clock behind still wins (R17)
  assert.ok(C.isFav(back, "temp", "C", "F") && back.favs["temp:C>F"].m === T0 + 6);

  let a = C.addRecent(C.emptyData(), "length", "km", "mi", 10, T0);
  a = C.addRecent(a, "length", "km", "mi", 10, T0 + 1);             // same conversion: one entry, newer
  assert.deepEqual(Object.keys(a.recent), ["length:km>mi=10"]);
  assert.equal(a.recent["length:km>mi=10"].m, T0 + 1);
  let b = C.addRecent(C.emptyData(), "mass", "kg", "lb", 2.5, T0 + 2);
  b = C.setPrec(b, 8, T0 + 3);
  const ab = C.mergeData(a, b), ba = C.mergeData(b, a);
  assert.equal(JSON.stringify(ab), JSON.stringify(ba));                                   // R5
  assert.equal(JSON.stringify(C.mergeData(ab, ab)), JSON.stringify(ab));                  // R26
  assert.equal(C.precOf(ab), 8);
  assert.deepEqual(C.recentList(ab).map((r) => r.c), ["mass", "length"]);
  const cleared = C.clearRecent(ab, T0 + 10);
  assert.deepEqual(cleared.recent, {});
  assert.deepEqual(C.mergeData(cleared, a).recent, {}, "a stale device does not bring them back");
  const again = C.addRecent(cleared, "length", "km", "mi", 10, T0 + 4);
  assert.ok(again.recent["length:km>mi=10"].m > cleared.tombs["length:km>mi=10"]);
});

test("recent: Cooking cups ⇄ grams keep their ingredient", () => {
  let d = C.addRecent(C.emptyData(), "cooking", "cup", "g", 1, T0, "flour");
  assert.deepEqual(d.recent, { "cooking:cup>g=1@flour": { c: "cooking", f: "cup", t: "g", v: 1, m: T0, i: "flour" } });
  d = C.addRecent(d, "cooking", "cup", "g", 1, T0 + 1, "honey");
  assert.equal(Object.keys(d.recent).length, 2, "another ingredient is another conversion");
  d = C.addRecent(d, "cooking", "cup", "tbsp", 1, T0 + 2, "flour");
  assert.ok("cooking:cup>tbsp=1" in d.recent && d.recent["cooking:cup>tbsp=1"].i === undefined, "no ingredient without weight");
  assert.equal(C.addRecent(C.emptyData(), "cooking", "g", "cup", 5, T0, "glue").recent["cooking:g>cup=5@water"].i, "water");
  const junk = C.mergeData({ recent: {
    "cooking:cup>g=1": { c: "cooking", f: "cup", t: "g", v: 1, m: 1 },
    "cooking:cup>g=2@glue": { c: "cooking", f: "cup", t: "g", v: 2, m: 1, i: "glue" },
    "length:m>ft=1@flour": { c: "length", f: "m", t: "ft", v: 1, m: 1, i: "flour" } } }, null);
  assert.deepEqual(junk.recent, {});
  assert.equal(JSON.stringify(C.mergeData(d, d)), JSON.stringify(d));
});

test("merge: recent capped at 20, tombstones capped, junk dropped", () => {
  let d = C.emptyData();
  for (let i = 0; i < 30; i++) d = C.addRecent(d, "length", "m", "ft", i, T0 + i);
  assert.equal(Object.keys(d.recent).length, C.RECENT_MAX);
  assert.equal(C.recentList(d)[0].v, 29);
  assert.equal(C.recentList(d).at(-1).v, 10);
  const tombs = {};
  for (let i = 0; i < 400; i++) tombs["length:m>ft=" + i] = T0 + i;
  const t = C.mergeData({ tombs }, null).tombs;
  assert.equal(Object.keys(t).length, C.TOMBS_MAX);
  assert.ok(!("length:m>ft=0" in t) && "length:m>ft=399" in t);
  const junk = C.mergeData({
    favs: { "x": { c: "temp", f: "C", t: "F", m: 1 }, "temp:C>C": { c: "temp", f: "C", t: "C", m: 1 },
            "nope:a>b": { c: "nope", f: "a", t: "b", m: 1 }, "temp:C>F": { c: "temp", f: "C", t: "F", m: -1 },
            "currency:EUR>USD": { c: "currency", f: "EUR", t: "USD", m: 2 } },
    recent: { "length:m>ft=1": { c: "length", f: "m", t: "ft", v: 2, m: 1 }, "length:m>ft=3": { c: "length", f: "m", t: "ft", v: 3, m: 1 } },
    prec: { v: 40, m: 1 }, tombs: { "<img>": 5 }
  }, null);
  assert.deepEqual(Object.keys(junk.favs), ["currency:EUR>USD"]);
  assert.deepEqual(Object.keys(junk.recent), ["length:m>ft=3"]);
  assert.equal(junk.prec, null);
  assert.deepEqual(junk.tombs, {});
  assert.deepEqual(C.mergeData(null, undefined), C.emptyData());
  assert.deepEqual(C.mergeData([], "x"), C.emptyData());
});

test("precision: 2-12, LWW, default 6", () => {
  assert.equal(C.precOf(C.emptyData()), 6);
  const d = C.setPrec(C.emptyData(), 9, T0);
  assert.deepEqual(d.prec, { v: 9, m: T0 });
  assert.deepEqual(C.setPrec(d, 9, T0 + 1).prec, { v: 9, m: T0 }, "the same value is not a change (R27)");
  assert.equal(C.setPrec(d, 99, T0 + 1).prec.v, 6);
  const older = C.setPrec(C.emptyData(), 3, T0 - 5);
  assert.equal(C.precOf(C.mergeData(older, d)), 9);
});

test("prefs: device-local, checked", () => {
  assert.deepEqual(C.readPrefs(null), { cat: "length", pairs: {}, ing: "water", all: true });
  const p = C.readPrefs({ cat: "temp", pairs: { temp: { f: "F", t: "C" }, length: { f: "zz", t: "m" }, currency: { f: "EUR", t: "GBP" } }, ing: "flour", all: false });
  assert.deepEqual(p, { cat: "temp", pairs: { temp: { f: "F", t: "C" }, currency: { f: "EUR", t: "GBP" } }, ing: "flour", all: false });
  assert.deepEqual(C.pairOf(p, "temp"), { f: "F", t: "C" });
  assert.deepEqual(C.pairOf(p, "speed"), { f: "kmh", t: "mph" });
  assert.equal(C.readPrefs({ cat: "nope", ing: "glue" }).cat, "length");
  assert.equal(C.readPrefs({ ing: "glue" }).ing, "water");
});

test("search provider: ready answers and favourites, read-only", async () => {
  const store = {
    "oros-units-data": C.toggleFav(C.emptyData(), "temp", "C", "F", T0),
    "oros-units-rates": RATES
  };
  const ctx = (q, lang) => ({ q, lang: lang || "el", readJSON: (k) => store[k] });
  let h = await P.search(ctx("10 km σε mi"));
  assert.equal(h[0].title, "10 km = 6,21371 mi");
  assert.ok(h[0].text.startsWith("10 km σε mi"));
  assert.deepEqual(h[0].target, { cat: "length", from: "km", to: "mi", value: 10 });
  h = await P.search(ctx("5 στρέμματα"));
  assert.equal(h[0].title, "5 στρ. = 5.000 m²");
  h = await P.search(ctx("100 usd to eur", "en"));
  assert.equal(h[0].title, "100 USD = 90.9091 EUR");
  h = await P.search(ctx("φαρενάιτ"));
  assert.equal(h.length, 1);
  assert.equal(h[0].title, "°C → °F");
  assert.ok(h[0].text.includes("Φαρενάιτ") && h[0].text.includes("Fahrenheit"));
  assert.deepEqual(h[0].target, { cat: "temp", from: "C", to: "F" });
  assert.deepEqual(await P.search({ q: "x", lang: "en", readJSON: () => null }), []);
  const calls = [];
  P.open({ cat: "length" }, { __orosOpenAt: (...a) => calls.push(a) });
  P.open("junk", { __orosOpenAt: (...a) => calls.push(a) });
  assert.deepEqual(calls, [["units", { cat: "length" }], ["units", null]]);
  assert.deepEqual(P.keys, ["oros-units-data", "oros-units-rates"]);
  assert.ok(!/setItem|innerHTML/.test(read("units/search.js")));
});

test("wiring: app, palette, sync, deep link, help", () => {
  const js = read("units/units.js"), html = read("units/index.html");
  assert.ok(js.includes("inheritPalette") && js.includes("watchPalette"));            // guard G3
  assert.ok(js.includes('api.registerSlice("units", sliceGet, sliceSet, STORAGE_KEY, C.mergeData)'));
  assert.equal((js.match(/window\.__orosOpenAt = /g) || []).length, 1);
  assert.ok(js.includes('__orosTakeTarget("units")'));
  assert.ok(html.indexOf("core.js") < html.indexOf("units.js"));
  assert.ok(!/\beval\(|new Function/.test(js + read("units/core.js")));
  // every data-i18n key exists in both languages
  const keys = [...html.matchAll(/data-i18n="([^"]+)"/g)].map((m) => m[1]);
  const en = js.slice(js.indexOf("en: {"), js.indexOf("el: {")), el = js.slice(js.indexOf("el: {"), js.indexOf("function t("));
  keys.forEach((k) => { assert.ok(en.includes(`"${k}"`), `en ${k}`); assert.ok(el.includes(`"${k}"`), `el ${k}`); });
  for (const f of ["help.en.txt", "help.el.txt", "search.js"]) assert.ok(fs.existsSync(path.join(__dirname, "..", "units", f)));
  for (const f of ["units/core.js", "units/units.js", "units/search.js"]) assert.ok(!/[\u2028\u2029\ufeff]/.test(read(f)), f);
});
