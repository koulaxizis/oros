// ============================================================
// orOS Budget — investments (budget/invest.js, INV-1)
// An account can hold an investment: crypto, a precious metal, or a
// stock / ETF / anything else with a price. Stored on the account as
// flat extras (an older version carries them forward):
//   ivk  kind: "c" crypto, "m" metal, "s" stock / ETF / other
//   ivs  what it is: a crypto symbol (BTC) or CoinGecko id (bitcoin),
//        "gold" / "silver", or a ticker (AAPL); ≤ 60 characters
//   ivq  quantity as written, a decimal string ("0.25", "1,5")
//   ivu  metal unit: "oz" (troy ounce) or "g"; absent = oz
//   ivp  a price typed by hand, cents per unit in the account's currency
//   ivd  the day of that price
//   ivr  (kind "p" only) yearly change in hundredths of a percent,
//        −10000…10000: a car −1500 (−15 % a year), a home +300
// Kind "p" (AS-1): a home, a car or anything of value with no market
// price: ivq "1", ivs an optional description, ivp its value on ivd,
// and the value today = ivp × (1 + ivr) ^ (years since ivd).
// The account's balance stays what was paid (its starting balance and
// the transfers into it); its value is quantity × price. Live prices
// come from CoinGecko's free public API (no key) for crypto and for
// gold and silver (through gold- and silver-backed tokens, one troy
// ounce each); they are kept on this device only, never synced.
// ============================================================
(function (root) {
  "use strict";

  var KINDS = { c: 1, m: 1, s: 1, p: 1 };
  var SYM_RE = /^[\p{L}\p{N} ._-]{1,60}$/u;
  var QTY_RE = /^\d{1,12}([.,]\d{1,12})?$/;
  var OZ_G = 31.1034768;
  // Common symbols → CoinGecko ids; anything else is taken as an id.
  var COINS = {
    btc: "bitcoin", eth: "ethereum", usdt: "tether", usdc: "usd-coin", bnb: "binancecoin", xrp: "ripple",
    sol: "solana", ada: "cardano", doge: "dogecoin", trx: "tron", dot: "polkadot", ltc: "litecoin",
    link: "chainlink", avax: "avalanche-2", xlm: "stellar", bch: "bitcoin-cash", atom: "cosmos",
    pol: "polygon-ecosystem-token", matic: "polygon-ecosystem-token", xmr: "monero", etc: "ethereum-classic",
    shib: "shiba-inu", ton: "the-open-network", near: "near", algo: "algorand", xtz: "tezos", eos: "eos"
  };
  var METALS = { gold: "pax-gold", silver: "kinesis-silver" };
  var METAL_NAMES = { gold: "gold", xau: "gold", "\u03c7\u03c1\u03c5\u03c3\u03cc\u03c2": "gold", "\u03c7\u03c1\u03c5\u03c3\u03bf\u03c2": "gold",
                      silver: "silver", xag: "silver", "\u03b1\u03c3\u03ae\u03bc\u03b9": "silver", "\u03b1\u03c3\u03b7\u03bc\u03b9": "silver" };

  function isInt(v) { return typeof v === "number" && isFinite(v) && Math.floor(v) === v; }
  function okYmd(s) { return typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s); }

  function qty(s) {
    if (typeof s !== "string" || !QTY_RE.test(s.trim())) return null;
    var v = parseFloat(s.trim().replace(",", "."));
    return v > 0 ? v : null;
  }
  function metalOf(s) { return METAL_NAMES[String(s || "").trim().toLowerCase()] || ""; }

  // Clean an account's investment extras in place (y is a copy of the
  // stored account). Without a valid kind and quantity all are dropped.
  function clean(y) {
    if (y.ivk === "p") {                      // AS-1: a value typed on a day
      if (typeof y.ivs !== "string" || !SYM_RE.test(y.ivs.trim())) delete y.ivs; else y.ivs = y.ivs.trim();
      y.ivq = "1";
      if (!(isInt(y.ivr) && y.ivr >= -10000 && y.ivr <= 10000 && y.ivr !== 0)) delete y.ivr;
      delete y.ivu;
      if (!(isInt(y.ivp) && y.ivp > 0 && y.ivp <= 100000000000 && okYmd(y.ivd))) { ["ivk", "ivs", "ivq", "ivp", "ivd", "ivr"].forEach(function (k) { delete y[k]; }); }
      return y;
    }
    delete y.ivr;
    var ok = KINDS[y.ivk] && typeof y.ivs === "string" && SYM_RE.test(y.ivs.trim()) && qty(y.ivq) !== null;
    if (!ok) { ["ivk", "ivs", "ivq", "ivu", "ivp", "ivd"].forEach(function (k) { delete y[k]; }); return y; }
    y.ivs = y.ivs.trim();
    y.ivq = y.ivq.trim();
    if (y.ivk !== "m" || (y.ivu !== "g" && y.ivu !== "oz")) delete y.ivu;
    if (!(isInt(y.ivp) && y.ivp > 0 && y.ivp <= 100000000000)) { delete y.ivp; delete y.ivd; }
    else if (!okYmd(y.ivd)) delete y.ivd;
    return y;
  }
  function cfg(a) {
    if (!a || !KINDS[a.ivk]) return null;
    if (a.ivk === "p") return isInt(a.ivp) && a.ivp > 0 && okYmd(a.ivd) ? { k: "p", s: typeof a.ivs === "string" ? a.ivs : "", q: 1, u: "", p: a.ivp, d: a.ivd, r: isInt(a.ivr) ? a.ivr : 0 } : null;
    var q = qty(a.ivq);
    if (q === null || typeof a.ivs !== "string") return null;
    return { k: a.ivk, s: a.ivs, q: q, u: a.ivk === "m" ? (a.ivu === "g" ? "g" : "oz") : "", p: a.ivp || 0, d: a.ivd || "" };
  }
  // The CoinGecko id that prices one unit (an ounce for metals); "" none.
  function liveId(a) {
    var c = cfg(a);
    if (!c) return "";
    if (c.k === "c") {
      var s = c.s.toLowerCase();
      if (COINS[s]) return COINS[s];
      return /^[a-z0-9-]{2,60}$/.test(s) ? s : "";
    }
    if (c.k === "m") { var m = metalOf(c.s); return m ? METALS[m] : ""; }
    return "";
  }
  function priceUrl(ids, cur) {
    return "https://api.coingecko.com/api/v3/simple/price?ids=" + ids.map(encodeURIComponent).join(",") +
           "&vs_currencies=" + encodeURIComponent(String(cur).toLowerCase());
  }
  // { bitcoin: { eur: 61234.5 } } → { bitcoin: 6123450 } (cents per unit)
  function parsePrices(json, ids, cur) {
    var out = {}, c = String(cur).toLowerCase();
    if (!json || typeof json !== "object") return out;
    ids.forEach(function (id) {
      var v = json[id] && json[id][c];
      if (typeof v === "number" && isFinite(v) && v > 0 && v < 1e9) out[id] = Math.round(v * 100);
    });
    return out;
  }
  // The value of an account's holding in its currency: quantity × price
  // (a live one per ounce for metals, converted for grams), else the
  // typed price. cache = { t, cur, p: { id: cents } } → { v, px, src
  // ("live" | "hand"), t | d } | null (no price yet)
  function value(a, cache, cur, today) {
    var c = cfg(a);
    if (!c) return null;
    if (c.k === "p") {
      var yrs = today && okYmd(today) && today > c.d ? (Date.UTC(+today.slice(0, 4), +today.slice(5, 7) - 1, +today.slice(8, 10)) -
                Date.UTC(+c.d.slice(0, 4), +c.d.slice(5, 7) - 1, +c.d.slice(8, 10))) / 864e5 / 365.25 : 0;
      var v = c.r ? Math.round(c.p * Math.pow(1 + c.r / 10000, yrs)) : c.p;
      return { v: v, px: v, src: "hand", t: 0, d: c.d, r: c.r };
    }
    var id = liveId(a), px = 0, src = "", t = 0;
    if (id && cache && cache.p && cache.cur === cur && cache.p[id] > 0) { px = cache.p[id]; src = "live"; t = cache.t || 0; }
    if (px && c.u === "g") px = px / OZ_G;
    if (!px && c.p) { px = c.p; src = "hand"; }
    if (!px) return null;
    return { v: Math.round(c.q * px), px: Math.round(px), src: src, t: t, d: src === "hand" ? c.d : "" };
  }
  // Unique live ids of a list of accounts.
  function liveIds(accs) {
    var seen = {}, out = [];
    (accs || []).forEach(function (a) { var id = liveId(a); if (id && !seen[id]) { seen[id] = 1; out.push(id); } });
    return out.sort();
  }

  var api = { clean: clean, cfg: cfg, qty: qty, liveId: liveId, liveIds: liveIds, priceUrl: priceUrl,
              parsePrices: parsePrices, value: value, metalOf: metalOf, COINS: COINS, OZ_G: OZ_G };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.OrosBudgetInvest = api;
})(typeof window !== "undefined" ? window : this);
