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

test("AS-1: a home, a car or a valuable: a value on a day, with a yearly change", () => {
  assert.deepEqual(I.clean({ ivk: "p", ivs: " Fiat Panda ", ivq: "7", ivu: "g", ivp: 1000000, ivd: "2025-11-04", ivr: -1500 }),
    { ivk: "p", ivs: "Fiat Panda", ivq: "1", ivp: 1000000, ivd: "2025-11-04", ivr: -1500 });
  assert.deepEqual(I.clean({ ivk: "p", ivq: "1", ivp: 1000000 }), {});                     // no day
  assert.deepEqual(I.clean({ ivk: "p", ivp: 5000, ivd: "2026-01-01", ivr: 0 }), { ivk: "p", ivq: "1", ivp: 5000, ivd: "2026-01-01" });
  const car = { ivk: "p", ivq: "1", ivp: 1000000, ivd: "2025-11-04", ivr: -1500 };
  assert.equal(I.value(car, null, "EUR", "2025-11-04").v, 1000000);
  assert.ok(Math.abs(I.value(car, null, "EUR", "2026-11-04").v - 850000) < 300);           // one year (365 of 365.25 days)
  assert.equal(I.value({ ivk: "p", ivq: "1", ivp: 20000000, ivd: "2026-01-01" }, null, "EUR", "2030-01-01").v, 20000000);
  assert.equal(I.liveId(car), "");
});

test("EX-1: holdings from a Coinbase or Binance transaction history", () => {
  const B = require("../budget/bank.js");
  const rows = (s) => B.parseCsv(s, B.guessSep(s));
  const cb = "You can use this transaction report to inform your likely tax obligations.\nTransactions\nUser,chris,abc\n" +
    "ID,Timestamp,Transaction Type,Asset,Quantity Transacted,Price Currency,Price at Transaction,Subtotal,Total (inclusive of fees and/or spread),Fees and/or Spread,Notes\n" +
    "1,2026-01-01 10:00:00 UTC,Buy,BTC,0.02,EUR,50000,1000,1010,10,Bought 0.02 BTC\n" +
    "2,2026-02-01 10:00:00 UTC,Sell,BTC,0.005,EUR,60000,300,295,5,Sold\n" +
    "3,2026-03-01,Convert,BTC,0.005,EUR,60000,300,300,0,\"Converted 0.005 BTC to 1,000.5 USDC\"\n" +
    "4,2026-03-02,Staking Income,ETH,0.01,EUR,3000,30,30,0,\n" +
    "5,2026-03-03,Retail Staking Transfer,ETH,0.01,EUR,3000,30,30,0,\n" +
    "6,2026-03-04,Send,ETH,-0.002,EUR,3000,6,6,0,\n";
  assert.deepEqual(I.exchangeHoldings(rows(cb)), { src: "coinbase", q: { BTC: 0.01, ETH: 0.008, USDC: 1000.5 } });
  const bn = "User_ID,UTC_Time,Account,Operation,Coin,Change,Remark\n1,2026-01-01 10:00:00,Spot,Buy,BTC,0.01,\n1,2026-01-01 10:00:00,Spot,Buy,EUR,-500,\n" +
    "1,2026-01-02,Spot,Transfer Between Main and Funding Wallet,BTC,-0.01,\n1,2026-01-02,Funding,Transfer Between Main and Funding Wallet,BTC,0.01,\n";
  assert.deepEqual(I.exchangeHoldings(rows(bn)), { src: "binance", q: { BTC: 0.01 } });
  assert.equal(I.exchangeHoldings(rows("Date,Amount\n2026-01-01,5\n")), null);
  assert.equal(I.qtyText(0.015), "0.015");
  assert.equal(I.qtyText(1 / 3), "0.3333333333");
});
