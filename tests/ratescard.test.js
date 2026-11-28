// Exchange rate bar card + country search (RATES-1, video ideas
// 2026-11-23 #18): the converter's currency pair from the ECB rates the
// Calculator / Unit Converter already keeps (nothing new is fetched);
// typing a country in the currency list finds its currency.
// Run: node --test tests/

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const read = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");
const M = require(path.join(ROOT, "smartbar.js"));
const A = require(path.join(ROOT, "smartbar-apps.js"));
const U = require(path.join(ROOT, "units/core.js"));
const R = { base: "EUR", date: "2026-11-20", at: 1, src: "x", rates: { USD: 1.08, JPY: 162.4, GBP: 0.85 } };

test("a known money kind from smartbar-apps.js (hidden under Sensitive work)", () => {
  assert.ok(M.KINDS.includes("rates") && A.KINDS.includes("rates") && A.OWN.rates && M.MONEY.rates);
});

test("the converter's pair, EUR → USD by default, cross rates through the euro", () => {
  assert.deepEqual(A.ratePair(R, null), { f: "EUR", t: "USD", v: 1.08, date: "2026-11-20" });
  const p = A.ratePair(R, { pairs: { currency: { f: "GBP", t: "JPY" } } });
  assert.equal(p.f, "GBP"); assert.equal(p.t, "JPY");
  assert.ok(Math.abs(p.v - 162.4 / 0.85) < 1e-9);
  assert.equal(A.ratePair(R, { pairs: { currency: { f: "USD", t: "USD" } } }).t, "USD", "same both sides: the default pair");
  assert.equal(A.ratePair(R, { pairs: { currency: { f: "EUR", t: "CHF" } } }), null, "no rate for it");
  assert.equal(A.ratePair(null, null), null);
  assert.equal(A.ratePair({ base: "USD", rates: {} }, null), null);
  assert.equal(A.ratePair({ base: "EUR", date: "bad", rates: { USD: 1.1 } }, null).date, "");
});

test("rates read in the language's own mark", () => {
  assert.equal(A.rateText(1.08423, "en-GB"), "1.0842");
  assert.equal(A.rateText(1.08423, "el-GR"), "1,0842");
  assert.equal(A.rateText(162.3456, "de-DE"), "162,35");
  assert.equal(A.rateText(0.006123, "en-GB"), "0.0061");
});

test("country search: a country's name finds its currency, in English, Greek and everyday words", () => {
  const list = U.unitsOf("currency", { rates: { USD: 1.08, JPY: 160, GBP: 0.85, TRY: 35, CHF: 0.95 } });
  const ids = (q) => U.matchUnits(list, q).map((u) => u.id);
  assert.deepEqual(ids("greece"), ["EUR"]);
  assert.deepEqual(ids("Ελλάδα"), ["EUR"]);
  assert.deepEqual(ids("japan"), ["JPY"]);
  assert.deepEqual(ids("ιαπων"), ["JPY"]);
  assert.deepEqual(ids("switz"), ["CHF"]);
  assert.deepEqual(ids("turkey"), ["TRY"]);
  assert.deepEqual(ids("usa"), ["USD"]);
  assert.deepEqual(ids("england"), ["GBP"]);
  assert.deepEqual(ids("eur"), ["EUR"], "the code still works");
  assert.equal(U.countryHit("EUR", "greece", "el"), "Ελλάδα", "the picker names it in the language in use");
  assert.equal(U.countryHit("EUR", "g", "en"), "", "one letter names no country");
  assert.equal(U.countryHit("JPY", "greece", "en"), "");
  Object.keys(U.CURRENCY_REGIONS).forEach((c) => assert.ok(U.CURRENCY_ORDER.includes(c), c));
});

test("wiring: stored rates only, the converter deep link, strings, help", () => {
  const SA = read("smartbar-apps.js");
  const card = SA.slice(SA.indexOf("      rates: function () {"), SA.indexOf("      // STORE-1: free space"));
  assert.match(card, /if \(strict\(\)\) return null;/);
  assert.match(card, /read\("oros-units-rates"\), read\("oros-units-prefs"\)/);
  assert.doesNotMatch(card, /fetch\(/, "nothing new is fetched");
  assert.match(card, /__orosOpenAt\("units", \{ cat: "currency", from: r\.f, to: r\.t, value: 1 \}\)/);
  assert.match(read("units/view.js"), /C\.countryHit\(u\.id, \$\("pq"\)\.value, LANG\)/);
  const tr = read("translations.js"), de = read("i18n/de/shell.js");
  for (const k of ["sb.k.rates", "sb.rates.tip"]) {
    assert.equal(tr.split('"' + k + '":').length - 1, 2, "EN + EL " + k);
    assert.ok(de.includes('"' + k + '":'), "DE " + k);
  }
  assert.match(read("help/topics/appearance.en.txt"), /- `Exchange rate`:/);
  assert.match(read("calculator/help.en.txt"), /type a country \(`Greece`/);
  assert.match(read("calculator/help.el.txt"), /γράψεις και μια χώρα/);
});
