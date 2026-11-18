// ============================================================
// orOS Hive — the rules (v1.0.0), no DOM
// An idle game: a beehive on a Greek hillside through the year. Bees
// fly to the flower patches that are in bloom, honey buys patches,
// frames and hive improvements, winter eats the stores. Everything is
// a pure function of the state and the time, so a game left alone for
// a week is worked out on the next open with the same code that runs
// while it is open (advance), and tests can step it (tests/hive.test.js).
//
// Time: one game month = 30 real minutes (a year = 6 hours), stepped in
// whole game minutes (one real minute each). Away from the game, the
// first 7 days count in full and the rest at half rate (effectiveMs);
// a clock that went backwards counts nothing.
//
// State (also the synced slice "hive", oros-hive-data; normalize gives
// the canonical copy):
//   { v, seed, br, at, life, min, ms, honey, wax, bees, frames,
//     lv: { box, ent, trough, wind, queen, terr },
//     slots: [ null | { f: flower id, p: minute planted, l: tending } ] (18),
//     yk: the year the kinds belong to, kinds: { <flower>: honey made },
//     cl: 1 while the colony is clustered (stores ran out), acts }
//   br = reset stamp (Start over), at = wall clock of the state (ms),
//   life = honey made over the whole game (only grows), min = game
//   minutes since the start (the start is 1 March, year 1).
// Merge (R5, symmetric): the larger br, then the larger life, then the
// later at, then the larger JSON. The further-ahead hive wins.
// ============================================================
(function (root) {
  "use strict";

  var V = 1;
  var MONTH_MIN = 30;                 // game minutes in a month
  var YEAR_MIN = 12 * MONTH_MIN;
  var STEP_MS = 60000;                // one game minute = one real minute
  var START_MONTH = 2;                // March
  var FULL_MS = 7 * 86400000;         // away: full rate for 7 days
  var MAX_MS = 400 * 86400000;        // away: at most this much real time is worked out
  var WINTER = [11, 0];               // December, January

  // Flowers: months in bloom (0 = January), honey per bee-minute
  // factor, base price, months to establish after planting.
  var FLOWERS = [
    { id: "almond",   m: [1],          y: 0.8, c: 40,  est: 1 },
    { id: "orange",   m: [2, 3],       y: 1.2, c: 60,  est: 1 },
    { id: "wild",     m: [3, 4, 5],    y: 0.7, c: 15,  est: 1 },
    { id: "thyme",    m: [5, 6, 7],    y: 1.6, c: 120, est: 2 },
    { id: "chestnut", m: [5],          y: 1.3, c: 80,  est: 1 },
    { id: "pine",     m: [7, 8, 9],    y: 1.0, c: 90,  est: 1 },
    { id: "heather",  m: [8, 9, 10],   y: 0.9, c: 70,  est: 1 }
  ];
  var FL = {};
  FLOWERS.forEach(function (f) { FL[f.id] = f; });

  // The hillside: axial hex coordinates around the hive (0, 0). Ring 1
  // is open from the start; ring 2 opens with the terraces.
  var SLOTS = [];
  (function () {
    var dirs = [[1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1]];
    for (var ring = 1; ring <= 2; ring++) {
      var q = dirs[4][0] * ring, r = dirs[4][1] * ring;
      for (var side = 0; side < 6; side++) {
        for (var k = 0; k < ring; k++) {
          SLOTS.push({ q: q, r: r, ring: ring });
          q += dirs[side][0]; r += dirs[side][1];
        }
      }
    }
  })();
  var RING_F = { 1: 1, 2: 0.75 };      // flight distance: ring 2 gives less
  var PATCH_BEES = 800;                // bees one patch can feed
  var PER_BEE = 0.01;                  // honey per bee-minute at factor 1
  var WAX_F = 0.2;                     // wax made per honey made
  var LAY = 3;                         // bees laid per minute (before queen care)
  var LAY_COST = 0.02;                 // honey per bee laid
  var EAT = 0.004;                     // honey a bee eats per minute in winter
  var BASE_CAP = 300, FRAME_CAP = 500; // bees the hive can hold
  var VARIETY = 0.05;                  // +5% per honey kind made this year
  var TEND_MAX = 20;                   // a tended patch feeds more bees, a little better

  // Hive improvements: max level, price of the next level (honey, wax).
  var UPGRADES = [
    { id: "frame",  max: function (s) { return 10 * s.lv.box; },
      cost: function (s) { var n = s.frames - 2; return [40 * Math.pow(1.18, n), 4 * Math.pow(1.18, n)]; } },
    { id: "box",    max: function () { return 4; },
      cost: function (s) { var b = s.lv.box; return [[0, 1500, 8000, 40000][b] || 0, [0, 100, 500, 2500][b] || 0]; } },
    { id: "ent",    max: function () { return 10; },
      cost: function (s) { return [80 * Math.pow(1.6, s.lv.ent), 0]; } },
    { id: "queen",  max: function () { return 8; },
      cost: function (s) { return [120 * Math.pow(1.55, s.lv.queen), 0]; } },
    { id: "wind",   max: function () { return 3; },
      cost: function (s) { return [250 * Math.pow(2.2, s.lv.wind), 0]; } },
    { id: "trough", max: function () { return 1; },
      cost: function () { return [300, 0]; } },
    { id: "terr",   max: function () { return 1; },
      cost: function () { return [1200, 60]; } }
  ];
  var UP = {};
  UPGRADES.forEach(function (u) { UP[u.id] = u; });
  var LV_KEYS = ["box", "ent", "queen", "terr", "trough", "wind"];

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
  function monthOf(min) { return (START_MONTH + Math.floor(min / MONTH_MIN)) % 12; }
  function yearOf(min) { return Math.floor((START_MONTH * MONTH_MIN + min) / YEAR_MIN); }   // 0-based
  function isWinter(m) { return WINTER.indexOf(m) >= 0; }
  // Real time away → the time that counts (full for 7 days, then half).
  function effectiveMs(dt) {
    if (!isNum(dt) || dt <= 0) return 0;
    dt = Math.min(dt, MAX_MS);
    return dt <= FULL_MS ? dt : FULL_MS + (dt - FULL_MS) / 2;
  }

  // Weather of a month of a year: fair, rain (a 15% chance, foraging
  // ×0.7) or, in June to August, heat (a 30% chance, ×0.8 without the
  // water trough). Seeded, so every device and every replay agrees.
  function weather(seed, y, m) {
    if (isWinter(m)) return "fair";
    var r = rand01(seed + "|" + y + "|" + m);
    if (r < 0.15) return "rain";
    if (m >= 5 && m <= 7 && r < 0.45) return "heat";
    return "fair";
  }
  function weatherF(s, w) {
    if (w === "rain") return 0.7;
    if (w === "heat") return s.lv.trough ? 1 : 0.8;
    return 1;
  }

  // ---------- the hive ----------
  function capacity(s) { return BASE_CAP + FRAME_CAP * s.frames; }
  function slotsOpen(s) { return s.lv.terr ? SLOTS.length : 6; }
  function established(s, slot) { return s.min - slot.p >= FL[slot.f].est * MONTH_MIN; }
  function blooms(fid, m) { return FL[fid].m.indexOf(m) >= 0; }
  function varietyF(s) { return 1 + VARIETY * Object.keys(s.kinds).length; }

  // Which patches feed bees this minute: the richest first, each up to
  // PATCH_BEES × (1 + tending level), while there are bees. → [{ i, f, bees, y }]
  function forage(s, m) {
    var open = slotsOpen(s), list = [];
    for (var i = 0; i < open; i++) {
      var sl = s.slots[i];
      if (!sl || !established(s, sl) || !blooms(sl.f, m)) continue;
      list.push({ i: i, f: sl.f, y: FL[sl.f].y * RING_F[SLOTS[i].ring] * (1 + 0.1 * sl.l),
                  cap: PATCH_BEES * (1 + sl.l), bees: 0 });
    }
    list.sort(function (a, b) { return b.y - a.y || a.i - b.i; });
    var left = s.bees;
    list.forEach(function (p) { p.bees = Math.min(p.cap, left); left -= p.bees; });
    return list.filter(function (p) { return p.bees > 0; });
  }
  // Honey per minute right now, by kind (for the status line).
  function rates(s) {
    var m = monthOf(s.min), y = yearOf(s.min);
    var mult = PER_BEE * (1 + 0.1 * s.lv.ent) * weatherF(s, weather(s.seed, y, m)) * varietyF(s);
    var out = { honey: 0, kinds: {}, fed: 0, eat: 0 };
    if (!isWinter(m)) {
      forage(s, m).forEach(function (p) {
        var h = p.bees * p.y * mult;
        out.honey += h; out.fed += p.bees;
        out.kinds[p.f] = (out.kinds[p.f] || 0) + h;
      });
    }
    out.eat = eatRate(s, m, out.fed > 0);
    return out;
  }
  function eatRate(s, m, fed) {
    var base = s.bees * EAT * (1 - 0.15 * s.lv.wind);
    if (isWinter(m)) return base;
    return fed ? 0 : base / 2;
  }
  // Honey the hive needs to come through the next winter (its 60 minutes).
  function winterNeed(s) { return s.bees * EAT * (1 - 0.15 * s.lv.wind) * 2 * MONTH_MIN; }

  // One game minute.
  function step(s, out) {
    var m = monthOf(s.min), y = yearOf(s.min);
    if (y !== s.yk) { s.yk = y; s.kinds = {}; }
    var winter = isWinter(m);
    var fed = false;
    if (!winter) {
      var mult = PER_BEE * (1 + 0.1 * s.lv.ent) * weatherF(s, weather(s.seed, y, m)) * varietyF(s);
      var made = 0;
      forage(s, m).forEach(function (p) {
        var h = p.bees * p.y * mult;
        made += h;
        s.kinds[p.f] = (s.kinds[p.f] || 0) + h;
      });
      if (made > 0) {
        fed = true;
        s.honey += made; s.life += made; s.wax += made * WAX_F;
        if (out) out.made += made;
        s.cl = 0;
      }
      // The queen lays while there is room and honey to feed the brood.
      var room = capacity(s) - s.bees;
      if (room > 0) {
        var n = Math.min(room, LAY * (1 + 0.25 * s.lv.queen), s.honey / LAY_COST);
        if (n > 0) { s.bees += n; s.honey -= n * LAY_COST; if (out) out.laid += n; }
      }
    }
    var eat = eatRate(s, m, fed);
    if (eat > 0) {
      var e = Math.min(eat, s.honey);
      s.honey -= e;
      if (out) out.eaten += e;
      if (e < eat) {
        s.honey = 0;
        if (winter && !s.cl) { s.cl = 1; if (out) out.clustered++; }
      }
    }
    if (s.honey < 0) s.honey = 0;
    s.min++;
  }

  // Step the hive by ms of game time (whole minutes; the rest is kept
  // in s.ms). Moves s.at by the same real time. → what happened.
  function advance(s, ms, realMs) {
    var out = { minutes: 0, made: 0, eaten: 0, laid: 0, clustered: 0 };
    if (!isNum(ms) || ms <= 0) return out;
    s.at += isNum(realMs) ? realMs : ms;
    var total = s.ms + ms;
    var n = Math.floor(total / STEP_MS);
    s.ms = total - n * STEP_MS;
    for (var i = 0; i < n; i++) step(s, out);
    out.minutes = n;
    return out;
  }
  // Bring the hive to the wall clock now: the away rule applies.
  // A clock that went backwards moves at to now and counts nothing.
  function catchUp(s, now) {
    var dt = now - s.at;
    if (!isNum(dt) || dt <= 0) {
      if (isNum(now)) s.at = now;
      return { minutes: 0, made: 0, eaten: 0, laid: 0, clustered: 0, dt: 0, slowed: false };
    }
    var out = advance(s, effectiveMs(dt), dt);
    out.dt = dt;
    out.slowed = dt > FULL_MS;
    return out;
  }

  // ---------- prices and actions ----------
  function plantCost(s, fid) {
    var n = 0;
    s.slots.forEach(function (sl) { if (sl && sl.f === fid) n++; });
    return FL[fid].c * Math.pow(1.15, n);
  }
  // Tending a patch: level l → l + 1 (more bees fed, +10% honey).
  function tendInfo(s, i) {
    var sl = s.slots[i], l = sl ? sl.l : 0, h = sl ? FL[sl.f].c * 2 * Math.pow(1.7, l) : 0;
    return { lv: l, max: TEND_MAX, h: h, done: !sl || l >= TEND_MAX, ok: !!sl && l < TEND_MAX && s.honey >= h };
  }
  function upLevel(s, uid) { return uid === "frame" ? s.frames : s.lv[uid]; }
  function upInfo(s, uid) {
    var u = UP[uid], c = u.cost(s), lvl = upLevel(s, uid), max = u.max(s);
    return { id: uid, lv: lvl, max: max, h: c[0], w: c[1], done: lvl >= max,
             ok: lvl < max && s.honey >= c[0] && s.wax >= c[1] };
  }
  // act(s, {t: "plant", slot, f} | {t: "up", u}) → "" or an error code
  function act(s, a) {
    a = obj(a);
    if (!a) return "bad";
    if (a.t === "plant") {
      var i = a.slot;
      if (typeof i !== "number" || Math.floor(i) !== i) return "bad";
      if (!(i >= 0 && i < slotsOpen(s))) return "locked";
      if (!FL[a.f]) return "bad";
      var cur = s.slots[i];
      if (cur && cur.f === a.f) return "same";
      var c = plantCost(s, a.f);
      if (s.honey < c) return "honey";
      s.honey -= c;
      s.slots[i] = { f: a.f, p: s.min, l: 0 };
      s.acts++;
      return "";
    }
    if (a.t === "tend") {
      var j = a.slot;
      if (typeof j !== "number" || !(j >= 0 && j < slotsOpen(s)) || !s.slots[j]) return "bad";
      var ti = tendInfo(s, j);
      if (ti.done) return "max";
      if (s.honey < ti.h) return "honey";
      s.honey -= ti.h;
      s.slots[j].l++;
      s.acts++;
      return "";
    }
    if (a.t === "up") {
      if (!UP[a.u]) return "bad";
      var inf = upInfo(s, a.u);
      if (inf.done) return "max";
      if (s.honey < inf.h) return "honey";
      if (s.wax < inf.w) return "wax";
      s.honey -= inf.h; s.wax -= inf.w;
      if (a.u === "frame") s.frames++;
      else s.lv[a.u]++;
      s.acts++;
      return "";
    }
    return "bad";
  }

  // ---------- new game, normalize, merge ----------
  function newGame(seed, now, br) {
    var s = {
      v: V, seed: String(seed || "hive"), br: isNum(br) ? br : 0, at: isNum(now) ? now : 0,
      life: 0, min: 0, ms: 0, honey: 30, wax: 5, bees: 500, frames: 2,
      lv: { box: 1, ent: 0, queen: 0, terr: 0, trough: 0, wind: 0 },
      slots: [], yk: 0, kinds: {}, cl: 0, acts: 0
    };
    for (var i = 0; i < SLOTS.length; i++) s.slots.push(null);
    s.slots[0] = { f: "wild", p: -MONTH_MIN, l: 0 };   // one meadow patch, already in flower
    return normalize(s);
  }
  // A clean copy with every field checked, keys in one order (R26);
  // null when it is not a hive.
  function normalize(x) {
    x = obj(x);
    if (!x || x.v !== V || !Array.isArray(x.slots)) return null;
    var lvIn = obj(x.lv) || {};
    var lv = {};
    LV_KEYS.forEach(function (k) {
      var max = k === "box" ? 4 : k === "ent" ? 10 : k === "queen" ? 8 : k === "wind" ? 3 : 1;
      lv[k] = int(lvIn[k], k === "box" ? 1 : 0, max, k === "box" ? 1 : 0);
    });
    var min = int(x.min, 0, 1e9, 0);
    var slots = [];
    for (var i = 0; i < SLOTS.length; i++) {
      var sl = obj(x.slots[i]);
      slots.push(sl && FL[sl.f] ? { f: sl.f, p: int(sl.p, -MONTH_MIN, min, 0), l: int(sl.l, 0, TEND_MAX, 0) } : null);
    }
    var kIn = obj(x.kinds) || {}, kinds = {};
    Object.keys(kIn).sort().forEach(function (k) { if (FL[k] && isNum(kIn[k]) && kIn[k] > 0) kinds[k] = kIn[k]; });
    var s = {
      v: V, seed: typeof x.seed === "string" && x.seed ? x.seed.slice(0, 32) : "hive",
      br: num(x.br, 0, 1e15, 0), at: num(x.at, 0, 1e15, 0),
      life: num(x.life, 0, 1e30, 0), min: min, ms: num(x.ms, 0, STEP_MS, 0),
      honey: num(x.honey, 0, 1e30, 0), wax: num(x.wax, 0, 1e30, 0),
      bees: 0, frames: int(x.frames, 2, 40 * lv.box, 2), lv: lv,
      slots: slots, yk: int(x.yk, 0, 1e7, yearOf(min)), kinds: kinds,
      cl: x.cl ? 1 : 0, acts: int(x.acts, 0, 1e9, 0)
    };
    s.frames = Math.min(s.frames, 10 * lv.box);
    s.bees = num(x.bees, 0, capacity(s), 0);
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
    V: V, MONTH_MIN: MONTH_MIN, YEAR_MIN: YEAR_MIN, STEP_MS: STEP_MS, FULL_MS: FULL_MS,
    FLOWERS: FLOWERS, FL: FL, SLOTS: SLOTS, UPGRADES: UPGRADES, PATCH_BEES: PATCH_BEES,
    monthOf: monthOf, yearOf: yearOf, isWinter: isWinter, effectiveMs: effectiveMs,
    weather: weather, capacity: capacity, slotsOpen: slotsOpen, established: established,
    blooms: blooms, varietyF: varietyF, rates: rates, winterNeed: winterNeed,
    advance: advance, catchUp: catchUp, plantCost: plantCost, upInfo: upInfo, tendInfo: tendInfo, act: act, TEND_MAX: TEND_MAX,
    newGame: newGame, normalize: normalize, merge: merge, clone: clone, rand01: rand01
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.HiveEngine = api;
})(typeof window !== "undefined" ? window : this);
