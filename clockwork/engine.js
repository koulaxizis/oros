// ============================================================
// orOS Clockwork Workshop — the rules (v1.0.0), no DOM
// An idle game: a watchmaker's bench. A water wheel turns gears, the
// gears drive small machines, belts carry the goods, and whatever
// reaches the shipping crate is sold, every minute, open or closed.
// Brass becomes gears and springs, gears and springs become clocks,
// clocks become automatons. Everything is a pure function of the
// state and the time, so a week away is worked out on the next open
// with the same code that runs while it is open, and tests can step it
// (tests/clockwork.test.js).
//
// The bench: a square grid (5 × 5 at the start, one row and column
// more with every new workshop, at most 7 × 7). The wheel sits on the
// left edge, the crate on the right edge, both in the middle row.
//   - a gear meshes with the gears (and the wheel) on the eight cells
//     around it, sides and corners, and turns the other way. A closed
//     ring of an odd number of gears (three that all touch, say) cannot
//     turn: the whole train jams and every machine stops.
//   - a machine runs when the wheel or a turning gear is on one of the
//     eight cells around it; every running machine takes 1 power, and
//     when the train needs more than the wheel gives they all slow down
//     to wheel ÷ need.
//   - a machine puts what it makes on the cell it faces; a belt carries
//     goods one cell in the way it points; a machine takes the goods it
//     needs from any side; the crate sells what reaches it.
// The layout does not change while nobody touches it, so the engine
// solves it once as a steady flow (solve): every machine makes as much
// as its speed, its power and its inputs allow, in the order of the
// goods (brass first). Coins per minute = what reaches the crate ×
// prices. Time only multiplies that rate.
//
// State (also the synced slice "clockwork", oros-clockwork-data;
// normalize gives the canonical copy):
//   { v, seed, br, at, life, co, bd: [cell codes], lv: {..}, acts,
//     wn (new workshops so far), tr: [guild marks], pb: [{ n, z, bd, e }]
//     the pattern book (past benches, newest last), we (coins earned in
//     this workshop), ws: [5] goods shipped in this workshop, sh: [5]
//     goods shipped in all, mk: [5] goods made in all, mi (milestones) }
//   br = reset stamp (Start over), at = wall clock of the state (ms),
//   life = coins earned over the whole game (only grows), co = coins now.
//   A cell code: "" empty, "g" gear, "b0".."b3" belt, or a machine
//   letter and its way: "f" furnace, "p" gear press, "c" spring coiler,
//   "k" clock bench, "a" automaton loft; 0 east, 1 south, 2 west, 3 north.
// Merge (R5, symmetric): the larger br, then the larger life, then the
// later at, then the larger JSON. The further-ahead workshop wins.
// ============================================================
(function (root) {
  "use strict";

  var V = 1;
  var MIN = 60000, HOUR = 3600000, DAY = 86400000;
  var FULL_MS = 7 * DAY;               // away: full rate for 7 days (more with "patient")
  var MAX_MS = 400 * DAY;              // away: at most this much is worked out
  var Z0 = 5, ZMAX = 7;                // bench size at the start, at most
  var START_CO = 40;                   // coins of a new workshop
  var NEW_E = 3000000;                // coins earned in a workshop before a new one
  var PB_MAX = 40;                     // pattern book entries kept
  var PB_F = 0.02;                     // every past workshop: prices +2% for good
  var POWER0 = 4, POWER_UP = 2;        // the wheel: power, + per level
  var REFUND = 0.5;                    // taking a part back returns half its price

  // Goods: brass, gear, spring, clock, automaton.
  var GOODS = ["brass", "gear", "spring", "clock", "auto"];
  var PRICE = [2, 9, 9, 60, 520];
  // Machines: what each makes, what it needs for one, its speed (a
  // minute), its first price. Inputs come in lower goods only, so the
  // flow is always one way.
  var MACH = {
    f: { out: 0, inp: [],               sp: 6,    c: 20 },
    p: { out: 1, inp: [[0, 1]],         sp: 3,    c: 120 },
    c: { out: 2, inp: [[0, 1]],         sp: 3,    c: 150 },
    k: { out: 3, inp: [[1, 2], [2, 1]], sp: 1.5,  c: 1500 },
    a: { out: 4, inp: [[3, 3]],         sp: 0.5,  c: 25000 }
  };
  var MKEYS = ["f", "p", "c", "k", "a"];
  var PARTS = ["g", "b"].concat(MKEYS);
  var PART_C = { g: 15, b: 4, f: 20, p: 120, c: 150, k: 1500, a: 25000 };
  var PART_F = 1.15;                   // every copy of a part on the bench costs 15% more
  var CODE_RE = /^(g|[bfpcka][0-3])$/;
  var DX = [1, 0, -1, 0], DY = [0, 1, 0, -1];

  // Upgrades: bigger wheel (+2 power, 6 levels), oiled bearings (+20%
  // to every machine, 5 levels), back door (a second crate, top right),
  // one polish per machine kind (×2 once, needs one on the bench).
  var UPS = [
    { id: "wheel", max: 6, cost: function (n) { return 150 * Math.pow(4, n); } },
    { id: "oil",   max: 5, cost: function (n) { return 400 * Math.pow(6, n); } },
    { id: "door",  max: 1, cost: function () { return 4000; } }
  ];
  MKEYS.forEach(function (k) {
    UPS.push({ id: "p" + k, max: 1, cost: function () { return MACH[k].c * 40; }, need: k });
  });
  var UP = {};
  UPS.forEach(function (u) { UP[u.id] = u; });
  var LV_KEYS = UPS.map(function (u) { return u.id; }).sort();
  // Guild marks: one chosen from three at every new workshop, kept for good.
  var TRAITS = ["quick", "thrifty", "river", "fine", "keen", "patient"];
  // Milestones (bits of mi).
  var MILES = ["clock", "auto", "train", "tidy", "million", "first", "big", "ten"];

  // ---------- helpers ----------
  function isNum(v) { return typeof v === "number" && isFinite(v); }
  function num(v, lo, hi, d) { return isNum(v) ? Math.max(lo, Math.min(hi, v)) : d; }
  function int(v, lo, hi, d) { return isNum(v) ? Math.max(lo, Math.min(hi, Math.floor(v))) : d; }
  function obj(v) { return v && typeof v === "object" && !Array.isArray(v) ? v : null; }
  function arr5(x) {
    var out = [0, 0, 0, 0, 0];
    if (Array.isArray(x)) for (var i = 0; i < 5; i++) out[i] = num(x[i], 0, 1e30, 0);
    return out;
  }

  // FNV-1a, then one mulberry32 step: a number in [0, 1) from a text.
  function rand01(str) {
    var h = 2166136261;
    for (var i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
    var t = (h + 0x6D2B79F5) | 0;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  function traitN(s, id) { var n = 0; for (var i = 0; i < s.tr.length; i++) if (s.tr[i] === id) n++; return n; }

  // ---------- the bench ----------
  function sizeOf(wn) { return Math.min(ZMAX, Z0 + wn); }
  function size(s) { return sizeOf(s.wn); }
  function mid(z) { return Math.floor(z / 2); }
  function wheelCell(z) { return mid(z) * z; }
  function crateCell(z) { return mid(z) * z + z - 1; }
  function doorCell(z) { return z - 1; }
  // What a fixed cell is: "W" the wheel, "X" a crate, "" none.
  function fixedAt(s, i) {
    var z = size(s);
    if (i === wheelCell(z)) return "W";
    if (i === crateCell(z)) return "X";
    if (s.lv.door && i === doorCell(z)) return "X";
    return "";
  }
  function kindOf(code) { return code ? code.charAt(0) : ""; }
  function dirOf(code) { return code && code.length > 1 ? +code.charAt(1) : 0; }
  function isMach(code) { return !!MACH[kindOf(code)]; }
  function countKind(s, k) { var n = 0; s.bd.forEach(function (c) { if (kindOf(c) === k) n++; }); return n; }
  function partsCount(s) { var n = 0; s.bd.forEach(function (c) { if (c) n++; }); return n; }
  function neighbours8(z, i) {
    var x = i % z, y = Math.floor(i / z), out = [];
    for (var dy = -1; dy <= 1; dy++) for (var dx = -1; dx <= 1; dx++) {
      if (!dx && !dy) continue;
      var nx = x + dx, ny = y + dy;
      if (nx >= 0 && ny >= 0 && nx < z && ny < z) out.push(ny * z + nx);
    }
    return out;
  }
  function step(z, i, d) {
    var x = i % z + DX[d], y = Math.floor(i / z) + DY[d];
    return x >= 0 && y >= 0 && x < z && y < z ? y * z + x : -1;
  }

  // ---------- power, flow ----------
  function power(s) { return POWER0 + POWER_UP * (s.lv.wheel + traitN(s, "river")); }
  function speedF(s, k) {
    return (s.lv["p" + k] ? 2 : 1) * (1 + 0.2 * s.lv.oil) * (1 + 0.15 * traitN(s, "quick"));
  }
  function priceF(s) { return (1 + PB_F * s.wn) * (1 + 0.1 * traitN(s, "fine")); }
  // Solve the bench: which gears turn (and which way), whether the train
  // jams, which machines run and how fast, where every machine's goods
  // go, and what reaches the crate. Pure; s is not changed.
  //  → { z, P, need, share, jam, spin: {cell: 1|-1}, bad: {cell: 1},
  //      train (gears turning), ms: {cell: {k, st, rate, sp, tgt, path}},
  //      ship: [5] a minute, make: [5] a minute, inc (coins a minute) }
  function solve(s) {
    var z = size(s), bd = s.bd, W0 = wheelCell(z);
    var spin = {}, bad = {}, jam = false, train = 0;
    spin[W0] = 1;
    var queue = [W0];
    while (queue.length) {
      var v = queue.shift();
      neighbours8(z, v).forEach(function (w) {
        if (bd[w] !== "g") return;
        if (spin[w] === undefined) { spin[w] = -spin[v]; queue.push(w); }
        else if (spin[w] === spin[v]) { jam = true; bad[w] = 1; bad[v] = 1; }
      });
    }
    Object.keys(spin).forEach(function (c) { if (+c !== W0) train++; });
    // machines and their power
    var ms = {}, need = 0;
    bd.forEach(function (code, i) {
      if (!isMach(code)) return;
      var on = false;
      if (!jam) neighbours8(z, i).forEach(function (w) { if (spin[w] !== undefined) on = true; });
      ms[i] = { k: kindOf(code), d: dirOf(code), on: on, st: "", rate: 0, sp: 0, tgt: -1, path: [i], sup: [0, 0, 0, 0, 0] };
      if (on) need++;
    });
    var P = power(s), share = need ? Math.min(1, P / need) : 1;
    // where the goods of each machine go
    Object.keys(ms).forEach(function (key) {
      var m = ms[key], i = +key, d = m.d, seen = {}, cur = i, out = MACH[m.k].out;
      for (var n = 0; n < z * z + 1; n++) {
        var nx = step(z, cur, d);
        if (nx < 0) { m.tgt = -1; m.why = "full"; break; }
        m.path.push(nx);
        if (fixedAt(s, nx) === "X") { m.tgt = "X"; break; }
        var c = bd[nx];
        if (kindOf(c) === "b") {
          if (seen[nx]) { m.tgt = -1; m.why = "loop"; break; }
          seen[nx] = 1; cur = nx; d = dirOf(c); continue;
        }
        if (isMach(c) && MACH[kindOf(c)].inp.some(function (x) { return x[0] === out; })) { m.tgt = nx; break; }
        m.tgt = -1; m.why = "full"; break;
      }
    });
    // the flow, goods in order
    var ship = [0, 0, 0, 0, 0], make = [0, 0, 0, 0, 0];
    var order = Object.keys(ms).map(Number).sort(function (a, b) { return MACH[ms[a].k].out - MACH[ms[b].k].out || a - b; });
    order.forEach(function (i) {
      var m = ms[i], spec = MACH[m.k];
      m.sp = m.on ? spec.sp * speedF(s, m.k) * share : 0;
      var r = m.sp;
      spec.inp.forEach(function (x) { r = Math.min(r, m.sup[x[0]] / x[1]); });
      if (m.tgt === -1) r = 0;
      m.rate = r;
      if (jam) m.st = "jam";
      else if (!m.on) m.st = "idle";
      else if (m.tgt === -1) m.st = m.why;
      else if (r < m.sp * 0.999) m.st = "wait";
      else m.st = "run";
      if (r > 0) {
        make[spec.out] += r;
        if (m.tgt === "X") ship[spec.out] += r;
        else ms[m.tgt].sup[spec.out] += r;
      }
    });
    var pf = priceF(s), inc = 0;
    for (var g = 0; g < 5; g++) inc += ship[g] * PRICE[g] * pf;
    return { z: z, P: P, need: need, share: share, jam: jam, spin: spin, bad: bad, train: jam ? 0 : train,
             ms: ms, ship: ship, make: make, inc: inc };
  }

  // ---------- prices ----------
  function partCost(s, k, n) {
    if (n === undefined) n = countKind(s, k);
    if (traitN(s, "keen") && n === 0 && (k === "p" || k === "c")) return 0;
    return PART_C[k] * Math.pow(PART_F, n) * Math.pow(0.85, traitN(s, "thrifty"));
  }
  function refundOf(s, k) {
    var n = countKind(s, k);
    return n ? partCost(s, k, n - 1) * REFUND : 0;
  }
  function upInfo(s, id) {
    var u = UP[id], lvl = s.lv[id], d = lvl >= u.max, cc = d ? 0 : u.cost(lvl);
    var need = !u.need || countKind(s, u.need) > 0;
    var blocked = id === "door" && !d && !!s.bd[doorCell(size(s))];
    return { id: id, lv: lvl, max: u.max, c: cc, done: d, need: need, blocked: blocked, ok: !d && need && !blocked && s.co >= cc };
  }

  // ---------- time ----------
  // Earn from s.at for ms at the weight w (1 or 0.5). The bench is the
  // same all the time, so this is one multiplication. → out filled
  function earn(s, ms, w, sol, out) {
    if (ms <= 0) return;
    var m = ms / MIN * w, g = sol.inc * m;
    s.co += g; s.life += g; s.we += g;
    for (var i = 0; i < 5; i++) {
      s.sh[i] += sol.ship[i] * m; s.ws[i] += sol.ship[i] * m; s.mk[i] += sol.make[i] * m;
      if (out) out.ship[i] += sol.ship[i] * m;
    }
    if (out) out.co += g;
    s.at += ms;
  }
  function emptyOut() { return { co: 0, ship: [0, 0, 0, 0, 0], dt: 0, slowed: false }; }
  function fullMs(s) { return FULL_MS * (1 + traitN(s, "patient")); }
  // Step the workshop by ms, in full (no away rule). → what happened
  function advance(s, ms) {
    var out = emptyOut();
    if (!isNum(ms) || ms <= 0) return out;
    var sol = solve(s);
    earn(s, ms, 1, sol, out);
    out.dt = ms;
    miles(s, sol);
    return out;
  }
  // Bring the workshop to the wall clock now: the first 7 days (14 with
  // "patient") in full, the rest at half (at most 400 days). A clock
  // that went back moves at to now and counts nothing.
  function catchUp(s, now) {
    var out = emptyOut();
    var dt = now - s.at;
    if (!isNum(dt) || dt <= 0) { if (isNum(now)) s.at = now; return out; }
    var sol = solve(s);
    if (dt > MAX_MS) s.at = now - MAX_MS;
    var fullTo = Math.min(now, s.at + fullMs(s));
    if (s.at < fullTo) earn(s, fullTo - s.at, 1, sol, out);
    if (s.at < now) earn(s, now - s.at, 0.5, sol, out);
    s.at = now;
    out.dt = dt;
    out.slowed = dt > fullMs(s);
    miles(s, sol);
    return out;
  }

  // ---------- milestones ----------
  function bit(s, id) { return (s.mi >> MILES.indexOf(id)) & 1; }
  function setBit(s, id) { s.mi |= 1 << MILES.indexOf(id); }
  function miles(s, sol) {
    sol = sol || solve(s);
    if (s.mk[3] > 0 || sol.make[3] > 0) setBit(s, "clock");
    if (s.sh[4] >= 1) setBit(s, "auto");
    if (sol.train >= 12) setBit(s, "train");
    var machines = Object.keys(sol.ms);
    if (partsCount(s) >= 20 && machines.length && machines.every(function (i) { return sol.ms[i].st === "run"; })) setBit(s, "tidy");
    if (s.life >= 1e6) setBit(s, "million");
    if (s.wn >= 1) setBit(s, "first");
    if (size(s) >= ZMAX) setBit(s, "big");
    if (s.wn >= 10) setBit(s, "ten");
  }

  // ---------- the new workshop ----------
  function canNew(s) { return s.ws[4] >= 1 && s.we >= NEW_E; }
  function offer(s) {
    var out = [], k = 0;
    while (out.length < 3 && k < 50) {
      var t = TRAITS[Math.floor(rand01(s.seed + "|t|" + s.wn + "|" + k) * TRAITS.length)];
      if (out.indexOf(t) < 0) out.push(t);
      k++;
    }
    for (var i = 0; out.length < 3 && i < TRAITS.length; i++) if (out.indexOf(TRAITS[i]) < 0) out.push(TRAITS[i]);
    return out;
  }
  function freshLv() {
    var lv = {};
    LV_KEYS.forEach(function (k) { lv[k] = 0; });
    return lv;
  }
  function emptyBd(z) { var b = []; for (var i = 0; i < z * z; i++) b.push(""); return b; }
  function newWorkshop(s, tr) {
    s.pb.push({ n: s.wn + 1, z: size(s), bd: s.bd.slice(), e: Math.round(s.we) });
    while (s.pb.length > PB_MAX) s.pb.shift();
    s.wn++;
    s.tr.push(tr);
    s.bd = emptyBd(size(s));
    s.lv = freshLv();
    s.co = START_CO;
    s.we = 0;
    s.ws = [0, 0, 0, 0, 0];
    miles(s);
  }
  // A pattern from the book laid on this bench: kept in place from the
  // left, moved up or down so its wheel row is this bench's wheel row.
  // Cells off the bench or on a fixed cell are left out. → [cell, code]
  function patternCells(s, k) {
    var p = s.pb[k], z = size(s);
    if (!p) return null;
    var dy = mid(z) - mid(p.z), out = [];
    p.bd.forEach(function (code, i) {
      if (!code) return;
      var x = i % p.z, y = Math.floor(i / p.z) + dy;
      if (x >= z || y < 0 || y >= z) return;
      var j = y * z + x;
      if (fixedAt(s, j)) return;
      out.push([j, code]);
    });
    return out;
  }

  // ---------- actions ----------
  // act(s, {t: "put", i, p} | {t: "turn", i} | {t: "take", i} |
  //        {t: "buy", u} | {t: "pattern", k} | {t: "new", tr})
  //   → "" or an error code
  function put(s, i, code) {
    var k = kindOf(code), c = partCost(s, k);
    if (s.co < c) return "co";
    s.co -= c;
    s.bd[i] = code;
    return "";
  }
  function take(s, i) {
    var k = kindOf(s.bd[i]);
    s.co += refundOf(s, k);
    s.bd[i] = "";
  }
  function cellOk(s, i) { return isNum(i) && i === Math.floor(i) && i >= 0 && i < s.bd.length; }
  function act(s, a) {
    a = obj(a);
    if (!a) return "bad";
    if (a.t === "put") {
      if (!cellOk(s, a.i) || typeof a.p !== "string" || !CODE_RE.test(a.p)) return "bad";
      if (fixedAt(s, a.i) || s.bd[a.i]) return "full";
      var e = put(s, a.i, a.p);
      if (e) return e;
      s.acts++;
      miles(s);
      return "";
    }
    if (a.t === "turn") {
      if (!cellOk(s, a.i)) return "bad";
      var code = s.bd[a.i];
      if (!code || code === "g") return "bad";
      s.bd[a.i] = kindOf(code) + ((dirOf(code) + (a.back ? 3 : 1)) % 4);
      s.acts++;
      miles(s);
      return "";
    }
    if (a.t === "take") {
      if (!cellOk(s, a.i) || !s.bd[a.i]) return "bad";
      take(s, a.i);
      s.acts++;
      miles(s);
      return "";
    }
    if (a.t === "buy") {
      if (!UP[a.u]) return "bad";
      var inf = upInfo(s, a.u);
      if (inf.done) return "max";
      if (!inf.need) return "need";
      if (inf.blocked) return "door";
      if (s.co < inf.c) return "co";
      s.co -= inf.c;
      s.lv[a.u]++;
      s.acts++;
      return "";
    }
    if (a.t === "pattern") {
      if (!isNum(a.k) || !s.pb[a.k]) return "bad";
      var cells = patternCells(s, a.k), t = clone(s);
      for (var j = t.bd.length - 1; j >= 0; j--) if (t.bd[j]) take(t, j);
      for (var n = 0; n < cells.length; n++) {
        if (put(t, cells[n][0], cells[n][1])) return "co";
      }
      s.co = t.co; s.bd = t.bd;
      s.acts++;
      miles(s);
      return "";
    }
    if (a.t === "new") {
      if (!canNew(s)) return "nonew";
      if (offer(s).indexOf(a.tr) < 0) return "bad";
      newWorkshop(s, a.tr);
      s.acts++;
      return "";
    }
    return "bad";
  }
  // What laying pattern k costs now (after the parts on the bench come
  // back at half price). → { cost, back, cells } or null
  function patternCost(s, k) {
    var cells = patternCells(s, k);
    if (!cells) return null;
    var t = clone(s), back = 0, co0;
    co0 = t.co;
    for (var j = t.bd.length - 1; j >= 0; j--) if (t.bd[j]) take(t, j);
    back = t.co - co0;
    t.co = 1e300;
    var spent = 0;
    cells.forEach(function (x) { var c = partCost(t, kindOf(x[1])); spent += c; t.bd[x[0]] = x[1]; });
    return { cost: spent, back: back, cells: cells.length };
  }

  // ---------- new game, normalize, merge ----------
  function newGame(seed, now, br) {
    return normalize({
      v: V, seed: String(seed || "brass"), br: isNum(br) ? br : 0, at: isNum(now) ? now : 0,
      life: 0, co: START_CO, bd: emptyBd(Z0), lv: freshLv(), acts: 0, wn: 0, tr: [], pb: [],
      we: 0, ws: [0, 0, 0, 0, 0], sh: [0, 0, 0, 0, 0], mk: [0, 0, 0, 0, 0], mi: 0
    });
  }
  function normBd(x, z, fixed) {
    var out = emptyBd(z);
    if (!Array.isArray(x) || x.length !== z * z) return out;
    for (var i = 0; i < z * z; i++) {
      var c = x[i];
      if (typeof c === "string" && CODE_RE.test(c) && !fixed(i)) out[i] = c;
    }
    return out;
  }
  // A clean copy with every field checked, keys in one order (R26);
  // null when it is not a workshop. Unknown cell codes and parts on the
  // wheel or a crate are dropped.
  function normalize(x) {
    x = obj(x);
    if (!x || x.v !== V || !obj(x.lv)) return null;
    var s = {
      v: V, seed: typeof x.seed === "string" && x.seed ? x.seed.slice(0, 32) : "brass",
      br: num(x.br, 0, 1e15, 0), at: num(x.at, 0, 1e15, 0),
      life: num(x.life, 0, 1e30, 0), co: num(x.co, 0, 1e30, 0), bd: [], lv: {},
      acts: int(x.acts, 0, 1e9, 0), wn: int(x.wn, 0, 1e6, 0), tr: [], pb: [],
      we: num(x.we, 0, 1e30, 0), ws: arr5(x.ws), sh: arr5(x.sh), mk: arr5(x.mk),
      mi: int(x.mi, 0, (1 << MILES.length) - 1, 0)
    };
    LV_KEYS.forEach(function (k) { s.lv[k] = int(x.lv[k], 0, UP[k].max, 0); });
    (Array.isArray(x.tr) ? x.tr : []).forEach(function (t) {
      if (TRAITS.indexOf(t) >= 0 && s.tr.length < 1e4) s.tr.push(t);
    });
    var z = size(s);
    s.bd = normBd(x.bd, z, function (i) { return fixedAt(s, i); });
    (Array.isArray(x.pb) ? x.pb : []).forEach(function (p) {
      p = obj(p);
      if (!p) return;
      var pz = int(p.z, Z0, ZMAX, 0);
      if (!pz || !Array.isArray(p.bd) || p.bd.length !== pz * pz) return;
      var w0 = wheelCell(pz), c0 = crateCell(pz);
      s.pb.push({ n: int(p.n, 1, 1e6, 1), z: pz,
                  bd: normBd(p.bd, pz, function (i) { return i === w0 || i === c0; }),
                  e: num(p.e, 0, 1e30, 0) });
    });
    while (s.pb.length > PB_MAX) s.pb.shift();
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
    V: V, MIN: MIN, HOUR: HOUR, DAY: DAY, FULL_MS: FULL_MS, MAX_MS: MAX_MS, Z0: Z0, ZMAX: ZMAX,
    START_CO: START_CO, NEW_E: NEW_E, PB_MAX: PB_MAX, PB_F: PB_F, POWER0: POWER0, REFUND: REFUND,
    GOODS: GOODS, PRICE: PRICE, MACH: MACH, MKEYS: MKEYS, PARTS: PARTS, PART_C: PART_C, PART_F: PART_F,
    UPS: UPS, UP: UP, TRAITS: TRAITS, MILES: MILES, DX: DX, DY: DY,
    size: size, sizeOf: sizeOf, mid: mid, wheelCell: wheelCell, crateCell: crateCell, doorCell: doorCell,
    fixedAt: fixedAt, kindOf: kindOf, dirOf: dirOf, isMach: isMach, countKind: countKind, partsCount: partsCount,
    neighbours8: neighbours8, step: step, power: power, speedF: speedF, priceF: priceF, solve: solve,
    partCost: partCost, refundOf: refundOf, upInfo: upInfo, advance: advance, catchUp: catchUp, fullMs: fullMs,
    bit: bit, canNew: canNew, offer: offer, traitN: traitN, patternCells: patternCells, patternCost: patternCost,
    act: act, newGame: newGame, normalize: normalize, merge: merge, clone: clone, rand01: rand01
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.ClockworkEngine = api;
})(typeof window !== "undefined" ? window : this);
