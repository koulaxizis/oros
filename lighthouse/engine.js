// ============================================================
// orOS Lighthouse Island — the rules (v1.0.0), no DOM
// An idle game: keep the light burning on a small island. At night (and
// in fog) the lamp guides the ships on the sea routes it reaches and
// each one pays its dues; by day the harbour, the fishing boats and the
// tavern work. A seeded weather line, shown ahead as a forecast, decides
// which defences pay first. Everything is a pure function of the state
// and the time, so a game left alone for a week is worked out on the
// next open with the same code that runs while it is open (advance),
// and tests can step it (tests/lighthouse.test.js).
//
// Time: one game hour = 1 real minute (a day and night = 24 minutes),
// stepped in whole game hours. Away from the game, the first 7 days
// count in full and the rest at half rate (effectiveMs); a clock that
// went backwards counts nothing.
//
// State (also the synced slice "lighthouse", oros-lighthouse-data;
// normalize gives the canonical copy):
//   { v, seed, br, at, life, hr, ms, coins, sup, fish, ships, lv: {..},
//     low (night hours the lamp burned low), acts,
//     is: the island, d0: the day this light began, s0: ships guided
//     before it, hv: handovers so far, tr: [trait ids], lh: [{ is, d, sh }]
//     the old lighthouses of the sea chart (newest last, at most LH_MAX) }
//   br = reset stamp (Start over), at = wall clock of the state (ms),
//   life = coins earned over the whole game (only grows), hr = game hours
//   since the start (the start is day 1, 16:00).
// Merge (R5, symmetric): the larger br, then the larger life, then the
// later at, then the larger JSON. The further-ahead island wins.
// ============================================================
(function (root) {
  "use strict";

  var V = 1;
  var STEP_MS = 60000;                // one game hour = one real minute
  var START_H = 16;                   // the game starts at 16:00 on day 1
  var FULL_MS = 7 * 86400000;         // away: full rate for 7 days
  var MAX_MS = 400 * 86400000;        // away: at most this much real time is worked out
  var NIGHT_FROM = 20, NIGHT_TO = 6;  // night: 20:00 to 06:00

  // Weather: what it does to the light (share of ships guided), to the
  // harbour by day and to the boats. A defence lifts one of them.
  var WX = ["calm", "wind", "rain", "fog", "storm"];
  var WXF = {
    calm:  { light: 1,   day: 1,   boat: 1 },
    wind:  { light: 1,   day: 0.9, boat: 0.6 },
    rain:  { light: 0.7, day: 0.8, boat: 0.9 },
    fog:   { light: 0.4, day: 0.7, boat: 0.7 },
    storm: { light: 0.3, day: 0.5, boat: 0 }
  };
  // Islands (a handover moves to one): the odds of each day's main
  // weather, and routes that carry more ships there.
  var ISLES = {
    home:  { p: { calm: 0.40, wind: 0.20, rain: 0.15, fog: 0.15, storm: 0.10 }, mult: {} },
    rock:  { p: { calm: 0.30, wind: 0.15, rain: 0.10, fog: 0.35, storm: 0.10 }, mult: { lanes: 1.3, caique: 1.2 } },
    cape:  { p: { calm: 0.30, wind: 0.25, rain: 0.15, fog: 0.10, storm: 0.20 }, mult: { cargo: 1.3, merchant: 1.3 } },
    outer: { p: { calm: 0.35, wind: 0.15, rain: 0.25, fog: 0.15, storm: 0.10 }, mult: { merchant: 1.5, lanes: 0.8 } },
    windy: { p: { calm: 0.25, wind: 0.45, rain: 0.10, fog: 0.10, storm: 0.10 }, mult: { caique: 1.3, ferry: 1.3 } }
  };
  var ISLE_IDS = ["home", "rock", "cape", "outer", "windy"];
  // Sea routes: the range the light needs, ships per night hour, dues
  // per ship (coins), supplies per ship.
  var ROUTES = [
    { id: "lanes",    r: 1, n: 3,   c: 1,  sup: 0 },
    { id: "caique",   r: 2, n: 2,   c: 4,  sup: 0.25 },
    { id: "ferry",    r: 3, n: 1.2, c: 12, sup: 0 },
    { id: "cargo",    r: 4, n: 0.8, c: 22, sup: 2.5 },
    { id: "merchant", r: 5, n: 0.4, c: 90, sup: 1 }
  ];
  var RT = {};
  ROUTES.forEach(function (r) { RT[r.id] = r; });
  var VARIETY = 0.05;                  // +5% per route the light reaches
  var OIL = 0.6;                       // coins of oil per night hour per lamp level + 1
  var HARBOUR = 3;                     // coins per day hour per pier
  var FERRY_DAY = 8;                   // coins per day hour from the ferry pier
  var CATCH = 2;                       // fish per day hour per boat
  var SELL = 3, FISH_C = 2;            // fish the tavern sells per hour per table, coins each
  var HANDOVER_SHIPS = 20000, HANDOVER_LAMP = 3;
  var CHART_F = 0.02, LH_MAX = 50;
  // Traits: one chosen from three at every handover, kept for good.
  var TRAITS = ["weatherwise", "thrifty", "fisher", "host", "builder", "owl"];

  // Buildings: the place they belong to, max level, price of the next
  // level [coins, supplies], and what has to be built first.
  function g(b, f, n) { return b * Math.pow(f, n); }
  var UPGRADES = [
    { id: "lamp",   at: "light",  max: 4, cost: function (n) { return [[60, 900, 9000, 120000][n], [0, 20, 200, 2000][n]]; } },
    { id: "polish", at: "light",  max: 25, cost: function (n) { return [g(40, 1.5, n), 0]; } },
    { id: "rot",    at: "light",  max: 1, cost: function () { return [1500, 60]; }, need: { lamp: 2 } },
    { id: "hood",   at: "light",  max: 1, cost: function () { return [250, 10]; } },
    { id: "horn",   at: "light",  max: 1, cost: function () { return [400, 0]; } },
    { id: "shut",   at: "light",  max: 1, cost: function () { return [900, 40]; } },
    { id: "store",  at: "house",  max: 4, cost: function (n) { return [g(200, 2.6, n), g(10, 2.6, n)]; } },
    { id: "shop",   at: "house",  max: 3, cost: function (n) { return [g(400, 2.5, n), g(30, 2.5, n)]; } },
    { id: "pier",   at: "harbour", max: 10, cost: function (n) { return [g(50, 1.75, n), n ? g(5, 1.75, n) : 0]; } },
    { id: "ferry",  at: "harbour", max: 1, cost: function () { return [2000, 120]; }, need: { lamp: 2, pier: 1 } },
    { id: "ware",   at: "harbour", max: 6, cost: function (n) { return [g(300, 2.2, n), g(20, 2.2, n)]; } },
    { id: "brk",    at: "harbour", max: 1, cost: function () { return [3000, 200]; } },
    { id: "boat",   at: "boats",  max: 12, cost: function (n) { return [g(30, 1.6, n), 0]; } },
    { id: "nets",   at: "boats",  max: 8, cost: function (n) { return [g(100, 1.9, n), 0]; } },
    { id: "tables", at: "tavern", max: 12, cost: function (n) { return [g(40, 1.6, n), 0]; } },
    { id: "rooms",  at: "tavern", max: 6, cost: function (n) { return [g(250, 2.3, n), g(15, 2.3, n)]; } }
  ];
  var UP = {};
  UPGRADES.forEach(function (u) { UP[u.id] = u; });
  var LV_KEYS = UPGRADES.map(function (u) { return u.id; }).sort();
  var PLACES = ["light", "house", "harbour", "boats", "tavern"];
  // A new light: one boat and one tavern table; everything else unbuilt.
  var START_LV = { boat: 1, tables: 1 };
  // Ship names: indices into each language's list (the screen names them).
  var SHIP_NAMES = 24;

  // ---------- helpers ----------
  function isNum(v) { return typeof v === "number" && isFinite(v); }
  function num(v, lo, hi, d) { return isNum(v) ? Math.max(lo, Math.min(hi, v)) : d; }
  function int(v, lo, hi, d) { return isNum(v) ? Math.max(lo, Math.min(hi, Math.floor(v))) : d; }
  function obj(v) { return v && typeof v === "object" && !Array.isArray(v) ? v : null; }

  // FNV-1a, then one mulberry32 step: a number in [0, 1) from a text.
  function rand01(str) {
    var h = 2166136261;
    for (var i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
    var t = (h + 0x6D2B79F5) | 0;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  // ---------- time ----------
  // Absolute game hour (0 = midnight before day 1) of the state's hour.
  function absH(hr) { return START_H + hr; }
  function hourOf(hr) { return absH(hr) % 24; }
  function dayOf(hr) { return Math.floor(absH(hr) / 24); }       // 0-based
  function isNight(hr) { var h = hourOf(hr); return h >= NIGHT_FROM || h < NIGHT_TO; }
  // Real time away → the time that counts (full for 7 days, then half).
  function effectiveMs(dt) {
    if (!isNum(dt) || dt <= 0) return 0;
    dt = Math.min(dt, MAX_MS);
    return dt <= FULL_MS ? dt : FULL_MS + (dt - FULL_MS) / 2;
  }

  // ---------- weather ----------
  // Each day has a main weather (by the island's odds); each quarter of
  // the day (6 hours) has it with a 65% chance, else calm. Seeded per
  // island, so every device and every replay agrees. → a WX id
  function dayWeather(seed, is, day) {
    var p = (ISLES[is] || ISLES.home).p, r = rand01(seed + "|" + is + "|d|" + day), acc = 0;
    for (var i = 0; i < WX.length; i++) { acc += p[WX[i]]; if (r < acc) return WX[i]; }
    return "calm";
  }
  function weatherAt(seed, is, ah) {
    var day = Math.floor(ah / 24), q = Math.floor((ah % 24) / 6);
    var main = dayWeather(seed, is, day);
    if (main === "calm") return "calm";
    return rand01(seed + "|" + is + "|q|" + day + "|" + q) < 0.65 ? main : "calm";
  }
  function weather(s, hr) { return weatherAt(s.seed, s.is, absH(isNum(hr) ? hr : s.hr)); }
  // The forecast: one entry per quarter day from the current quarter,
  // for 3 days (5 with the weatherwise trait). → [{ ah, day, q, w }]
  function forecastDays(s) { return traitN(s, "weatherwise") ? 5 : 3; }
  function forecast(s) {
    var ah = absH(s.hr), start = ah - (ah % 6), out = [];
    for (var k = 0; k < forecastDays(s) * 4; k++) {
      var a = start + 6 * k;
      out.push({ ah: a, day: Math.floor(a / 24), q: Math.floor((a % 24) / 6), w: weatherAt(s.seed, s.is, a) });
    }
    return out;
  }

  // ---------- the island ----------
  function traitN(s, id) { var n = 0; for (var i = 0; i < s.tr.length; i++) if (s.tr[i] === id) n++; return n; }
  function range(s) { return s.lv.lamp + 1; }
  // Share of ships guided in this weather (the defences lift it).
  function lightF(s, w) {
    var f = WXF[w].light;
    if (w === "rain" && s.lv.hood) f = 1;
    if (w === "fog") f = (s.lv.horn ? 0.8 : 0.4) + 0.1 * traitN(s, "weatherwise");
    if (w === "storm" && s.lv.shut) f = 0.7;
    return Math.min(1, f);
  }
  function dayF(s, w) { return WXF[w].day; }
  function boatF(s, w) {
    if (s.lv.brk && (w === "wind" || w === "storm")) return w === "storm" ? 0.5 : 1;
    return WXF[w].boat;
  }
  // The lamp's strength: polishing and the clockwork rotation.
  function strength(s) { return (1 + 0.15 * s.lv.polish) * (s.lv.rot ? 1.1 : 1); }
  function chartF(s) { return 1 + CHART_F * Math.min(LH_MAX, s.hv); }
  function varietyF(s, r) { return 1 + VARIETY * Math.min(ROUTES.length, r); }
  function oilCost(s) { return OIL * (s.lv.lamp + 1) * Math.pow(0.8, s.lv.store) * Math.pow(0.8, traitN(s, "thrifty")); }
  function supF(s) { return (1 + 0.25 * s.lv.ware); }
  function routeN(s, rt) { return rt.n * ((ISLES[s.is] || ISLES.home).mult[rt.id] || 1); }
  // Does the light work this hour? At night, and by day in fog.
  function lightWorks(s, hr, w) { return isNight(hr) || w === "fog"; }

  // What one hour gives, without changing anything. low = the lamp burns
  // low (half its range, half its strength). → { coins, sup, fish, sold,
  // ships, oil, light, routes: { id: ships } }
  function hourYield(s, hr, w, low) {
    var out = { coins: 0, sup: 0, fish: 0, sold: 0, ships: 0, oil: 0, light: false, routes: {} };
    var night = isNight(hr), bonus = chartF(s);
    if (lightWorks(s, hr, w)) {
      out.light = true;
      out.oil = oilCost(s);
      var r = range(s), str = strength(s) * (night ? 1 + 0.15 * traitN(s, "owl") : 1);
      if (low) { r = Math.ceil(r / 2); str *= 0.5; }
      var lf = lightF(s, w), vf = varietyF(s, r);
      ROUTES.forEach(function (rt) {
        if (rt.r > r) return;
        var n = routeN(s, rt) * lf;
        out.ships += n;
        out.routes[rt.id] = n;
        out.coins += n * rt.c * str * vf * bonus;
        out.sup += n * rt.sup * supF(s);
      });
    }
    if (!night) {
      var df = dayF(s, w);
      out.coins += s.lv.pier * HARBOUR * (1 + 0.15 * s.lv.rooms) * df * bonus;
      if (s.lv.ferry) out.coins += FERRY_DAY * df * bonus;
      out.fish = s.lv.boat * CATCH * (1 + 0.2 * s.lv.nets) * (1 + 0.25 * traitN(s, "fisher")) * boatF(s, w);
    }
    return out;
  }
  function tavernPrice(s) { return FISH_C * (1 + 0.2 * traitN(s, "host")) * chartF(s); }
  // Coins per hour right now (for the status line).
  function rates(s) {
    var w = weather(s), y = hourYield(s, s.hr, w, s.coins < oilCost(s));
    var sold = Math.min(s.fish + y.fish, SELL * s.lv.tables);
    return { coins: y.coins + sold * tavernPrice(s) - (y.light ? y.oil : 0), ships: y.ships, fish: y.fish, sup: y.sup,
             light: y.light, w: w, low: y.light && s.coins < y.oil };
  }

  // One game hour.
  function step(s, out) {
    var w = weather(s), hr = s.hr;
    var low = false;
    if (lightWorks(s, hr, w)) {
      var oil = oilCost(s);
      if (s.coins >= oil) { s.coins -= oil; if (out) out.oil += oil; }
      else { low = true; s.low++; if (out) out.low++; }
    }
    var y = hourYield(s, hr, w, low);
    s.fish += y.fish;
    var sold = Math.min(s.fish, SELL * s.lv.tables);
    s.fish -= sold;
    var earned = y.coins + sold * tavernPrice(s);
    s.coins += earned; s.life += earned;
    s.sup += y.sup;
    s.ships += y.ships;
    if (out) {
      out.coins += earned; out.ships += y.ships; out.fish += y.fish; out.sup += y.sup;
      out.wx[w] = (out.wx[w] || 0) + 1;
      if (isNight(hr) && hourOf(hr) === NIGHT_FROM) out.nights++;
    }
    s.hr++;
  }
  function emptyOut() { return { hours: 0, coins: 0, ships: 0, fish: 0, sup: 0, oil: 0, low: 0, nights: 0, wx: {} }; }

  // Step the island by ms of game time (whole hours; the rest is kept
  // in s.ms). Moves s.at by the same real time. → what happened.
  function advance(s, ms, realMs) {
    var out = emptyOut();
    if (!isNum(ms) || ms <= 0) return out;
    s.at += isNum(realMs) ? realMs : ms;
    var total = s.ms + ms;
    var n = Math.floor(total / STEP_MS);
    s.ms = total - n * STEP_MS;
    for (var i = 0; i < n; i++) step(s, out);
    out.hours = n;
    return out;
  }
  // Bring the island to the wall clock now: the away rule applies.
  // A clock that went backwards moves at to now and counts nothing.
  function catchUp(s, now) {
    var dt = now - s.at;
    if (!isNum(dt) || dt <= 0) {
      if (isNum(now)) s.at = now;
      var o = emptyOut(); o.dt = 0; o.slowed = false;
      return o;
    }
    var out = advance(s, effectiveMs(dt), dt);
    out.dt = dt;
    out.slowed = dt > FULL_MS;
    return out;
  }

  // ---------- the keeper's log ----------
  // The ship of a night hour: seeded, from the routes the light reached
  // then (as the island is now). → null or { hr, route, name, w }
  function logAt(s, hr) {
    if (hr < 0) return null;
    var w = weather(s, hr);
    if (!lightWorks(s, hr, w)) return null;
    var r = range(s), list = ROUTES.filter(function (rt) { return rt.r <= r; });
    var k = Math.floor(rand01(s.seed + "|log|" + s.is + "|" + hr) * list.length);
    return { hr: hr, route: list[k].id, name: Math.floor(rand01(s.seed + "|name|" + hr) * SHIP_NAMES), w: w };
  }
  // The last n log lines before the current hour (newest first).
  function log(s, n) {
    var out = [];
    for (var h = s.hr - 1; h >= 0 && h >= s.hr - 24 * 7 && out.length < n; h--) {
      var e = logAt(s, h);
      if (e) out.push(e);
    }
    return out;
  }

  // ---------- prices and actions ----------
  function costOf(s, uid) {
    var u = UP[uid], c = u.cost(s.lv[uid]);
    var sup = c[1] * Math.pow(0.9, s.lv.shop) * Math.pow(0.9, traitN(s, "builder"));
    return [c[0], sup];
  }
  function needMet(s, uid) {
    var nd = UP[uid].need;
    if (!nd) return true;
    return Object.keys(nd).every(function (k) { return s.lv[k] >= nd[k]; });
  }
  function upInfo(s, uid) {
    var u = UP[uid], lvl = s.lv[uid], done = lvl >= u.max, c = done ? [0, 0] : costOf(s, uid), need = needMet(s, uid);
    return { id: uid, at: u.at, lv: lvl, max: u.max, c: c[0], s: c[1], done: done, need: need,
             ok: !done && need && s.coins >= c[0] && s.sup >= c[1] };
  }

  // ---------- the handover ----------
  // Once the lens is built and the light has guided handShips(s) ships
  // here, the keeper may hand it to an apprentice and sail to another
  // island with one new trait.
  function shipsHere(s) { return Math.max(0, s.ships - s.s0); }
  // Every handover so far takes 10% off the ships the next one needs
  // (at most half), so later lights hand over sooner.
  function handShips(s) { return HANDOVER_SHIPS * Math.max(0.5, 1 - 0.1 * s.hv); }
  function canHand(s) { return s.lv.lamp >= HANDOVER_LAMP && shipsHere(s) >= handShips(s); }
  // The three traits offered at the next handover (seeded).
  function offer(s) {
    var out = [], k = 0;
    while (out.length < 3 && k < 50) {
      var t = TRAITS[Math.floor(rand01(s.seed + "|t|" + s.hv + "|" + k) * TRAITS.length)];
      if (out.indexOf(t) < 0) out.push(t);
      k++;
    }
    for (var i = 0; out.length < 3 && i < TRAITS.length; i++) if (out.indexOf(TRAITS[i]) < 0) out.push(TRAITS[i]);
    return out;
  }
  function freshLv() {
    var lv = {};
    LV_KEYS.forEach(function (k) { lv[k] = START_LV[k] || 0; });
    return lv;
  }
  function handover(s, is, tr) {
    s.lh.push({ is: s.is, d: Math.max(1, dayOf(s.hr) - s.d0 + 1), sh: Math.floor(shipsHere(s)) });
    if (s.lh.length > LH_MAX) s.lh.splice(0, s.lh.length - LH_MAX);
    s.hv++;
    s.tr.push(tr);
    s.is = is;
    s.d0 = dayOf(s.hr);
    s.s0 = s.ships;
    s.lv = freshLv();
    s.coins = 20 + s.coins * 0.1;
    s.sup = 0; s.fish = 0;
  }
  // act(s, {t: "up", u} | {t: "hand", is, tr}) → "" or an error code
  function act(s, a) {
    a = obj(a);
    if (!a) return "bad";
    if (a.t === "up") {
      if (!UP[a.u]) return "bad";
      var inf = upInfo(s, a.u);
      if (inf.done) return "max";
      if (!inf.need) return "need";
      if (s.coins < inf.c) return "coins";
      if (s.sup < inf.s) return "sup";
      s.coins -= inf.c; s.sup -= inf.s;
      s.lv[a.u]++;
      s.acts++;
      return "";
    }
    if (a.t === "hand") {
      if (!canHand(s)) return "nohand";
      if (!ISLES[a.is] || a.is === s.is || offer(s).indexOf(a.tr) < 0) return "bad";
      handover(s, a.is, a.tr);
      s.acts++;
      return "";
    }
    return "bad";
  }

  // ---------- new game, normalize, merge ----------
  function newGame(seed, now, br) {
    return normalize({
      v: V, seed: String(seed || "light"), br: isNum(br) ? br : 0, at: isNum(now) ? now : 0,
      life: 0, hr: 0, ms: 0, coins: 40, sup: 0, fish: 0, ships: 0, lv: freshLv(), low: 0, acts: 0,
      is: "home", d0: 0, s0: 0, hv: 0, tr: [], lh: []
    });
  }
  // A clean copy with every field checked, keys in one order (R26);
  // null when it is not an island.
  function normalize(x) {
    x = obj(x);
    if (!x || x.v !== V || !obj(x.lv)) return null;
    var lv = {};
    LV_KEYS.forEach(function (k) { lv[k] = int(x.lv[k], START_LV[k] || 0, UP[k].max, START_LV[k] || 0); });
    var hr = int(x.hr, 0, 1e9, 0);
    var s = {
      v: V, seed: typeof x.seed === "string" && x.seed ? x.seed.slice(0, 32) : "light",
      br: num(x.br, 0, 1e15, 0), at: num(x.at, 0, 1e15, 0),
      life: num(x.life, 0, 1e30, 0), hr: hr, ms: num(x.ms, 0, STEP_MS, 0),
      coins: num(x.coins, 0, 1e30, 0), sup: num(x.sup, 0, 1e30, 0), fish: num(x.fish, 0, 1e30, 0),
      ships: num(x.ships, 0, 1e30, 0), lv: lv, low: int(x.low, 0, 1e9, 0), acts: int(x.acts, 0, 1e9, 0),
      is: ISLES[x.is] ? x.is : "home", d0: int(x.d0, 0, dayOf(hr), 0), s0: 0,
      hv: int(x.hv, 0, 1e6, 0), tr: [], lh: []
    };
    s.s0 = num(x.s0, 0, s.ships, 0);
    (Array.isArray(x.tr) ? x.tr : []).forEach(function (t) {
      if (TRAITS.indexOf(t) >= 0 && s.tr.length < 1e4) s.tr.push(t);
    });
    (Array.isArray(x.lh) ? x.lh : []).forEach(function (h) {
      h = obj(h);
      if (h && ISLES[h.is]) s.lh.push({ is: h.is, d: int(h.d, 1, 1e7, 1), sh: int(h.sh, 0, 1e15, 0) });
    });
    if (s.lh.length > LH_MAX) s.lh.splice(0, s.lh.length - LH_MAX);
    if (s.hv < s.lh.length) s.hv = s.lh.length;
    return s;
  }
  function better(a, b) {   // > 0 when a wins
    if (a.br !== b.br) return a.br - b.br;
    if (a.life !== b.life) return a.life - b.life;
    if (a.at !== b.at) return a.at - b.at;
    var ja = JSON.stringify(a), jb = JSON.stringify(b);
    return ja < jb ? -1 : (ja > jb ? 1 : 0);
  }
  function merge(a, b) {
    var na = normalize(a), nb = normalize(b);
    if (!na) return nb;
    if (!nb) return na;
    return better(na, nb) >= 0 ? na : nb;
  }
  function clone(s) { return JSON.parse(JSON.stringify(s)); }

  var api = {
    V: V, STEP_MS: STEP_MS, FULL_MS: FULL_MS, START_H: START_H, NIGHT_FROM: NIGHT_FROM, NIGHT_TO: NIGHT_TO,
    WX: WX, WXF: WXF, ISLES: ISLES, ISLE_IDS: ISLE_IDS, ROUTES: ROUTES, RT: RT, UPGRADES: UPGRADES, UP: UP,
    PLACES: PLACES, TRAITS: TRAITS, SHIP_NAMES: SHIP_NAMES, HANDOVER_SHIPS: HANDOVER_SHIPS, HANDOVER_LAMP: HANDOVER_LAMP,
    CHART_F: CHART_F, LH_MAX: LH_MAX, SELL: SELL,
    hourOf: hourOf, dayOf: dayOf, isNight: isNight, absH: absH, effectiveMs: effectiveMs,
    dayWeather: dayWeather, weatherAt: weatherAt, weather: weather, forecast: forecast, forecastDays: forecastDays,
    range: range, lightF: lightF, boatF: boatF, strength: strength, oilCost: oilCost, lightWorks: lightWorks,
    hourYield: hourYield, tavernPrice: tavernPrice, rates: rates, traitN: traitN, chartF: chartF,
    advance: advance, catchUp: catchUp, logAt: logAt, log: log,
    upInfo: upInfo, act: act, shipsHere: shipsHere, handShips: handShips, canHand: canHand, offer: offer,
    newGame: newGame, normalize: normalize, merge: merge, clone: clone, rand01: rand01
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.LighthouseEngine = api;
})(typeof window !== "undefined" ? window : this);
