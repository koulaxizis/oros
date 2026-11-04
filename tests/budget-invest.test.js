// Budget investments (INV-1): stored extras, live ids, prices, value.
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const I = require("../budget/invest.js");

test("INV-1: an account's investment extras are cleaned", () => {
  const y = I.clean({ ivk: "c", ivs: " BTC ", ivq: "0,5", ivu: "g", ivp: 100, ivd: "2026-11-01" });
  assert.deepEqual(y, { ivk: "c", ivs: "BTC", ivq: "0,5", ivp: 100, ivd: "2026-11-01" });
  assert.deepEqual(I.clean({ ivk: "x", ivs: "BTC", ivq: "1" }), {});
  assert.deepEqual(I.clean({ ivk: "c", ivs: "BTC", ivq: "-1", ivp: 5 }), {});
  assert.deepEqual(I.clean({ ivk: "m", ivs: "gold", ivq: "10", ivu: "g", ivp: 0 }), { ivk: "m", ivs: "gold", ivq: "10", ivu: "g" });
  assert.equal(I.qty("1.234567891234"), 1.234567891234);
  assert.equal(I.qty("1e5"), null);
});

test("INV-1: live ids, the price call and its answer", () => {
  assert.equal(I.liveId({ ivk: "c", ivs: "BTC", ivq: "1" }), "bitcoin");
  assert.equal(I.liveId({ ivk: "c", ivs: "render-token", ivq: "1" }), "render-token");
  assert.equal(I.liveId({ ivk: "m", ivs: "Χρυσός", ivq: "1" }), "pax-gold");
  assert.equal(I.liveId({ ivk: "m", ivs: "platinum", ivq: "1" }), "");
  assert.equal(I.liveId({ ivk: "s", ivs: "AAPL", ivq: "1" }), "");
  assert.deepEqual(I.liveIds([{ ivk: "c", ivs: "eth", ivq: "1" }, { ivk: "c", ivs: "BTC", ivq: "1" }, { ivk: "c", ivs: "bitcoin", ivq: "2" }]), ["bitcoin", "ethereum"]);
  assert.equal(I.priceUrl(["bitcoin", "pax-gold"], "EUR"), "https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,pax-gold&vs_currencies=eur");
  assert.deepEqual(I.parsePrices({ bitcoin: { eur: 61234.567 }, "pax-gold": { usd: 2000 }, x: 5 }, ["bitcoin", "pax-gold"], "EUR"), { bitcoin: 6123457 });
});

test("INV-1: value = quantity × price, live first, grams of metal, else the typed price", () => {
  const cache = { t: 5, cur: "EUR", p: { bitcoin: 6000000, "pax-gold": 311035 } };
  assert.deepEqual(I.value({ ivk: "c", ivs: "BTC", ivq: "0.5" }, cache, "EUR"), { v: 3000000, px: 6000000, src: "live", t: 5, d: "" });
  assert.equal(I.value({ ivk: "m", ivs: "gold", ivq: "10", ivu: "g" }, cache, "EUR").v, 100000);      // €3,110.35/oz → €100/g
  assert.deepEqual(I.value({ ivk: "s", ivs: "AAPL", ivq: "3", ivp: 20000, ivd: "2026-11-03" }, cache, "EUR"),
    { v: 60000, px: 20000, src: "hand", t: 0, d: "2026-11-03" });
  assert.equal(I.value({ ivk: "c", ivs: "BTC", ivq: "1" }, cache, "USD"), null);                        // cache in another currency
  assert.equal(I.value({ ivk: "c", ivs: "BTC", ivq: "1", ivp: 100 }, null, "EUR").src, "hand");
  assert.equal(I.value({ n: "Bank" }, cache, "EUR"), null);
});

test("INV-1: a metal named in Greek is kept", () => {
  assert.equal(I.clean({ ivk: "m", ivs: "χρυσός", ivq: "10" }).ivs, "χρυσός");
});
