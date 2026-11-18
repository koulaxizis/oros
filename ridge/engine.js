// ============================================================
// orOS Windmill ridge — the rules (v1.0.0), no DOM
// A tower defense game: on stormy nights sea fog climbs a winding
// island road to the village well. Towers stand on stone pads beside
// the road; the wind turns with every wave and stretches what the
// towers reach. Everything is a pure function of the state, stepped in
// fixed ticks of 1/60 s, so a night replays exactly (tests/ridge.test.js).
//
// The map is a grid of 9 × 16 tiles, column c from the left, row r
// from the top; a tile's centre is (c + 0.5, r + 0.5). The road is a
// list of tile waypoints joined by straight lines (sea → well); a fog's
// place is its distance s along the road, in tiles.
//
// Run state (also the device-local session, oros-ridge-session .g):
//   { v, ridge, diff, u: towers unlocked (1-4), t: ticks, coins, hearts,
//     hmax, wave: waves called, nw: waves in the night, sp: [spawner],
//     wl: [fog left per wave], fog: [fog], oil: [patch],
//     tw: { "<pad>": tower }, nid, over: -1 playing | 0 lost | 1 won,
//     acts, faded }
//   spawner { w: wave, g: group, n: spawned in group, next: tick }
//   fog { id, k: kind, w: wave, s, hp, mx, sl: slow, st: slow ticks, ar: 1 armoured }
//   tower { k, l: 1 | 2 | 3, b: "" | "a" | "b", tm: target mode, cd, sp: coins spent,
//           fr: coins spent since the last wave started (sold back in full) }
//   patch { a, b: road stretch, e: last tick, dps, sl }
// ev (not saved): what happened in the last steps, for the screen.
// ============================================================
(function (root) {
  "use strict";

  var V = 1;
  var COLS = 9, ROWS = 16;
  var TPS = 60;                          // ticks per second
  var GROUP_GAP = 90;                    // ticks between two groups of a wave
  var SELL = 0.7;                        // part of the price a sold tower gives back
  var ARMOUR = 0.25;                     // what a shell takes from stones and chimes

  var DIFFS = ["m", "n", "h"];           // Mild, Normal, Hard
  var DIFF = {
    m: { hearts: 30, coins: 130, hp: 0.8 },
    n: { hearts: 20, coins: 100, hp: 1 },
    h: { hearts: 10, coins: 90, hp: 1.15 }
  };

  // Fog kinds: health, speed (tiles per second), coins, hearts it costs.
  var FOG = {
    w: { hp: 40, v: 0.9, c: 3, h: 1 },            // wisp
    r: { hp: 18, v: 1.7, c: 2, h: 1 },            // runner
    s: { hp: 60, v: 0.7, c: 7, h: 1, ar: 1 },     // shell (armoured)
    p: { hp: 40, v: 0.8, c: 5, h: 1, split: 1 },  // puff (splits in two)
    m: { hp: 14, v: 1.0, c: 1, h: 1 },            // half of a puff
    b: { hp: 400, v: 0.45, c: 30, h: 3 }          // fog bank
  };
  var HP_WAVE = 0.35;                    // fog health +35% per wave
  var HP_RIDGE = 0.1;                    // and +10% per ridge (the first 0.85)

  // Towers: price, the ridge from which it is unlocked (index + 1 =
  // towers unlocked), and the stats per level: 1, 2, a and b (the two
  // level 3 branches). r reach (tiles), cd ticks between actions.
  var TOWERS = {
    sling: { c: 50, u: 1, tm: true, st: {
      1: { r: 2.6, cd: 36, d: 10 },
      2: { r: 2.8, cd: 30, d: 14 },
      a: { r: 2.8, cd: 30, d: 15, n: 2 },          // Twin sling
      b: { r: 3.9, cd: 48, d: 30 } } },            // Long sling
    bell: { c: 60, u: 2, tm: false, st: {
      1: { r: 2.2, cd: 120, sl: 0.4, sd: 120 },
      2: { r: 2.5, cd: 110, sl: 0.45, sd: 120 },
      a: { r: 2.5, cd: 110, sl: 0.55, sd: 150, crack: 1 },  // Deep bell
      b: { r: 3.1, cd: 100, sl: 0.4, sd: 120, d: 10 } } },  // Chime
    press: { c: 80, u: 3, tm: true, st: {
      1: { r: 2.3, cd: 150, len: 1.0, dur: 240, dps: 30 },
      2: { r: 2.5, cd: 140, len: 1.0, dur: 240, dps: 45 },
      a: { r: 2.5, cd: 140, len: 1.0, dur: 360, dps: 60 },          // Hot oil
      b: { r: 2.5, cd: 140, len: 2.0, dur: 240, dps: 45, sl: 0.3 } } }, // Spill
    mill: { c: 80, u: 4, tm: false, st: {
      1: { r: 2.4, cd: 300, push: 1.6 },
      2: { r: 2.6, cd: 270, push: 2.0 },
      a: { r: 2.6, cd: 270, push: 2.8 },           // Great sails
      b: { r: 2.6, cd: 270, push: 2.0, d: 30 } } } // Millstone
  };
  var KINDS = ["sling", "bell", "press", "mill"];
  var TARGETS = ["first", "strong", "close"];

  // The ridges of island 1: the road (tile waypoints, sea → well), the
  // stone pads and the waves ("<kind><count>:<ticks between>", groups
  // one after the other).
  var RIDGES = [
    { id: "i1r1",
      path: [[4, 15], [4, 12], [1, 12], [1, 8], [7, 8], [7, 4], [3, 4], [3, 0]],
      pads: [[5, 14], [3, 13], [2, 11], [0, 10], [2, 9], [4, 9], [6, 9], [8, 7], [6, 6], [5, 5], [4, 3], [2, 1]],
      waves: ["w6:80", "w8:70", "w10:60", "w8:50 w4:40", "w12:50", "w14:45", "w10:40 w8:30", "w16:40", "w20:35", "w24:30"] },
    { id: "i1r2",
      path: [[0, 14], [6, 14], [6, 11], [2, 11], [2, 7], [7, 7], [7, 3], [4, 3], [4, 0]],
      pads: [[1, 13], [3, 13], [5, 12], [7, 12], [3, 10], [1, 9], [3, 8], [5, 8], [6, 6], [8, 5], [6, 4], [5, 2], [3, 1]],
      waves: ["w6:80", "w8:60", "r4:60 w6:60", "w12:50", "r8:45", "w10:45 r6:40", "w16:40", "r10:35 w8:40", "w20:35", "w14:35 r12:30"] },
    { id: "i1r3",
      path: [[8, 15], [8, 13], [1, 13], [1, 10], [7, 10], [7, 7], [1, 7], [1, 4], [6, 4], [6, 0]],
      pads: [[7, 14], [3, 12], [5, 12], [4, 11], [6, 9], [3, 9], [8, 8], [4, 8], [2, 6], [5, 6], [0, 5], [3, 5], [5, 3], [7, 2]],
      waves: ["w8:70", "r6:50", "w12:50", "w8:45 r8:40", "w16:40", "r12:35", "w14:35 r8:35", "w20:30", "r16:30 w10:35", "w24:28 r12:28"] },
    { id: "i1r4",
      path: [[6, 15], [6, 12], [2, 12], [2, 9], [5, 9], [5, 6], [1, 6], [1, 2], [7, 2], [7, 0]],
      pads: [[7, 14], [5, 13], [3, 13], [1, 11], [3, 10], [4, 8], [6, 8], [3, 7], [0, 5], [2, 5], [4, 5], [2, 3], [4, 1], [6, 3]],
      waves: ["w8:70", "w10:55 r4:45", "r10:40", "w16:40", "w10:40 r10:35", "w20:35", "r16:30", "w18:30 r10:30", "w24:28", "w16:30 r12:30 b1:0"] }
  ];
  var RIDGE = {};

  // ---------- Roads ----------
  function buildRoad(rd) {
    var pts = rd.path.map(function (p) { return [p[0] + 0.5, p[1] + 0.5]; });
    var seg = [], len = 0, tiles = {};
    for (var i = 1; i < pts.length; i++) {
      var a = pts[i - 1], b = pts[i];
      var l = Math.abs(b[0] - a[0]) + Math.abs(b[1] - a[1]);
      seg.push({ a: a, b: b, s0: len, l: l });
      len += l;
      var c0 = rd.path[i - 1], c1 = rd.path[i];
      var dc = Math.sign(c1[0] - c0[0]), dr = Math.sign(c1[1] - c0[1]);
      for (var c = c0[0], r = c0[1]; ; c += dc, r += dr) {
        tiles[c + "," + r] = 1;
        if (c === c1[0] && r === c1[1]) break;
      }
    }
    rd.seg = seg; rd.len = len; rd.tiles = tiles;
    rd.groups = rd.waves.map(parseWave);
  }
  function parseWave(str) {
    return str.split(" ").map(function (g) {
      var m = /^([a-z])(\d+):(\d+)$/.exec(g);
      return { k: m[1], n: +m[2], gap: +m[3] };
    });
  }
  RIDGES.forEach(function (rd, i) { rd.idx = i; buildRoad(rd); RIDGE[rd.id] = rd; });

  // The point at distance s along the road.
  function posAt(rd, s) {
    if (s <= 0) return { x: rd.seg[0].a[0], y: rd.seg[0].a[1] };
    for (var i = 0; i < rd.seg.length; i++) {
      var g = rd.seg[i];
      if (s <= g.s0 + g.l || i === rd.seg.length - 1) {
        var f = Math.min(1, (s - g.s0) / g.l);
        return { x: g.a[0] + (g.b[0] - g.a[0]) * f, y: g.a[1] + (g.b[1] - g.a[1]) * f };
      }
    }
    return { x: 0, y: 0 };
  }
  function padPos(rd, i) { var p = rd.pads[i]; return { x: p[0] + 0.5, y: p[1] + 0.5 }; }

  // ---------- Randomness (one seeded PRNG) ----------
  function hash(str) {
    var h = 2166136261;
    for (var i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
  }
  function mulberry32(a) {
    return function () {
      a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // ---------- The wind ----------
  // Wind of a wave (0-based): d = 0..7, where it blows TO (0 north/up,
  // clockwise), s = 0 calm, 1 breeze, 2 wind, 3 gale. Same for the same
  // ridge, difficulty and wave.
  function windOf(ridge, diff, w) {
    var rnd = mulberry32(hash("ridge:" + ridge + ":" + diff + ":" + w));
    var d = Math.floor(rnd() * 8);
    var x = rnd();
    var s = x < 0.15 ? 0 : x < 0.5 ? 1 : x < 0.85 ? 2 : 3;
    return { d: d, s: s };
  }
  function windVec(d) {
    var a = d * Math.PI / 4;
    return { x: Math.round(Math.sin(a) * 1e6) / 1e6, y: Math.round(-Math.cos(a) * 1e6) / 1e6 };
  }
  // The wind now: the newest wave called (before the first, the first's).
  function windNow(g) { return windOf(g.ridge, g.diff, Math.max(0, g.wave - 1)); }
  function windNext(g) { return g.wave < g.nw ? windOf(g.ridge, g.diff, g.wave) : null; }

  function stats(tw) { return TOWERS[tw.k].st[tw.l === 3 ? tw.b : tw.l]; }
  // How far a tower reaches towards (dx, dy) in this wind: slings and
  // presses +10% per strength downwind and -10% upwind, bells only the
  // downwind gain, windmills the same either way.
  function reachTo(k, r, wind, dx, dy) {
    if (k === "mill" || !wind.s) return r;
    var len = Math.sqrt(dx * dx + dy * dy);
    if (!len) return r;
    var v = windVec(wind.d);
    var c = (dx * v.x + dy * v.y) / len;
    if (k === "bell" && c < 0) c = 0;
    return r * (1 + 0.1 * wind.s * c);
  }
  function inReach(rd, pad, tw, st, wind, f) {
    var p = padPos(rd, pad), q = posAt(rd, f.s);
    var dx = q.x - p.x, dy = q.y - p.y;
    return dx * dx + dy * dy <= Math.pow(reachTo(tw.k, st.r, wind, dx, dy), 2);
  }

  // ---------- A new night ----------
  function newRun(ridge, diff) {
    var rd = RIDGE[ridge];
    if (!rd || !DIFF[diff]) return null;
    var D = DIFF[diff];
    return {
      v: V, ridge: ridge, diff: diff, u: Math.min(4, rd.idx + 1), t: 0,
      coins: D.coins, hearts: D.hearts, hmax: D.hearts, wave: 0, nw: rd.waves.length,
      sp: [], wl: rd.groups.map(function (gs) { return gs.reduce(function (n, g) { return n + g.n; }, 0); }),
      fog: [], oil: [], tw: {}, nid: 1, over: -1, acts: 0, faded: 0, ev: []
    };
  }

  // ---------- Actions (each returns true when done) ----------
  function buildCost(k) { return TOWERS[k] ? TOWERS[k].c : 0; }
  function upCost(tw) {
    if (!tw || tw.l >= 3) return 0;
    var c = TOWERS[tw.k].c;
    return tw.l === 1 ? Math.round(c * 0.6) : c;
  }
  function sellValue(tw) { return tw.fr + Math.floor(SELL * (tw.sp - tw.fr)); }
  function unlocked(g, k) { return TOWERS[k] && TOWERS[k].u <= g.u; }

  function build(g, pad, k) {
    var rd = RIDGE[g.ridge];
    if (g.over >= 0 || !rd.pads[pad] || g.tw[pad] || !unlocked(g, k)) return false;
    var c = buildCost(k);
    if (g.coins < c) return false;
    g.coins -= c;
    g.tw[pad] = { k: k, l: 1, b: "", tm: 0, cd: 0, sp: c, fr: c };
    g.acts++;
    return true;
  }
  function upgrade(g, pad, branch) {
    var tw = g.tw[pad];
    if (g.over >= 0 || !tw || tw.l >= 3) return false;
    if (tw.l === 2 && branch !== "a" && branch !== "b") return false;
    var c = upCost(tw);
    if (g.coins < c) return false;
    g.coins -= c;
    tw.sp += c; tw.fr += c;
    tw.l++;
    if (tw.l === 3) tw.b = branch;
    g.acts++;
    return true;
  }
  function sell(g, pad) {
    var tw = g.tw[pad];
    if (g.over >= 0 || !tw) return false;
    g.coins += sellValue(tw);
    delete g.tw[pad];
    g.acts++;
    return true;
  }
  function target(g, pad) {
    var tw = g.tw[pad];
    if (g.over >= 0 || !tw || !TOWERS[tw.k].tm) return false;
    tw.tm = (tw.tm + 1) % TARGETS.length;
    g.acts++;
    return true;
  }
  // Fog still to come or on the road in the waves called so far.
  function fogLeft(g) {
    var n = 0;
    for (var w = 0; w < g.wave; w++) n += g.wl[w];
    return n;
  }
  // The next wave. Called while fog is still on the road: +1 coin for
  // every fog still to come or on the road.
  function callWave(g) {
    if (g.over >= 0 || g.wave >= g.nw) return false;
    var early = fogLeft(g);
    if (early) { g.coins += early; g.ev.push({ e: "early", n: early }); }
    g.sp.push({ w: g.wave, g: 0, n: 0, next: g.t + 1 });
    g.wave++;
    Object.keys(g.tw).forEach(function (p) { g.tw[p].fr = 0; });
    g.acts++;
    return true;
  }

  // ---------- One tick ----------
  function fogHp(g, k, w) {
    return Math.round(FOG[k].hp * (1 + HP_WAVE * w) * (0.85 + HP_RIDGE * RIDGE[g.ridge].idx) * DIFF[g.diff].hp);
  }
  function makeFog(g, k, w, s) {
    var hp = fogHp(g, k, w);
    return { id: g.nid++, k: k, w: w, s: s, hp: hp, mx: hp, sl: 0, st: 0, ar: FOG[k].ar ? 1 : 0 };
  }
  function hurt(f, d, oil) {
    if (f.ar && !oil) d *= ARMOUR;
    f.hp -= d;
  }
  function slow(f, sl, ticks) {
    f.sl = f.st > 0 ? Math.max(f.sl, sl) : sl;
    f.st = Math.max(f.st, ticks);
  }
  function pick(g, rd, pad, tw, st, wind, n) {
    var cand = g.fog.filter(function (f) { return f.hp > 0 && inReach(rd, pad, tw, st, wind, f); });
    if (!cand.length) return [];
    var p = padPos(rd, pad);
    var key = TARGETS[tw.tm];
    cand.sort(function (x, y) {
      var d;
      if (key === "strong") d = y.hp - x.hp;
      else if (key === "close") {
        var a = posAt(rd, x.s), b = posAt(rd, y.s);
        d = (Math.pow(a.x - p.x, 2) + Math.pow(a.y - p.y, 2)) - (Math.pow(b.x - p.x, 2) + Math.pow(b.y - p.y, 2));
      }
      if (!d) d = y.s - x.s;          // ties: the one furthest up the road
      return d || x.id - y.id;
    });
    return cand.slice(0, n || 1);
  }
  function act(g, rd, pad, tw, wind) {
    var st = stats(tw);
    if (tw.k === "sling") {
      var hit = pick(g, rd, pad, tw, st, wind, st.n || 1);
      if (!hit.length) return false;
      hit.forEach(function (f) { hurt(f, st.d, false); g.ev.push({ e: "shot", p: +pad, f: f.id }); });
      return true;
    }
    var near = g.fog.filter(function (f) { return f.hp > 0 && inReach(rd, pad, tw, st, wind, f); });
    if (tw.k === "bell") {
      if (!near.length) return false;
      near.forEach(function (f) {
        slow(f, st.sl, st.sd);
        if (st.crack) f.ar = 0;
        if (st.d) hurt(f, st.d, false);
      });
      g.ev.push({ e: "ring", p: +pad });
      return true;
    }
    if (tw.k === "press") {
      var to = pick(g, rd, pad, tw, st, wind, 1);
      if (!to.length) return false;
      var mid = Math.min(rd.len, to[0].s + 0.3);
      g.oil.push({ a: mid - st.len / 2, b: mid + st.len / 2, e: g.t + st.dur, dps: st.dps, sl: st.sl || 0 });
      g.ev.push({ e: "oil", p: +pad, s: mid });
      return true;
    }
    if (tw.k === "mill") {
      if (!near.length) return false;
      var push = st.push * (1 + wind.s) / 2;
      near.forEach(function (f) {
        f.s = Math.max(0, f.s - (f.k === "b" ? push / 2 : push));
        if (st.d) hurt(f, st.d, false);
      });
      g.ev.push({ e: "push", p: +pad, n: near.length });
      return true;
    }
    return false;
  }

  function step(g) {
    if (g.over >= 0) return;
    var rd = RIDGE[g.ridge];
    g.t++;
    // spawners
    for (var i = 0; i < g.sp.length; i++) {
      var sp = g.sp[i];
      if (g.t < sp.next) continue;
      var grp = rd.groups[sp.w][sp.g];
      g.fog.push(makeFog(g, grp.k, sp.w, 0));
      sp.n++;
      if (sp.n >= grp.n) {
        sp.g++; sp.n = 0;
        if (sp.g >= rd.groups[sp.w].length) { g.sp.splice(i, 1); i--; continue; }
        sp.next = g.t + GROUP_GAP;
      } else sp.next = g.t + Math.max(1, grp.gap);
    }
    // towers, in pad order
    var wind = windNow(g);
    Object.keys(g.tw).map(Number).sort(function (a, b) { return a - b; }).forEach(function (pad) {
      var tw = g.tw[pad];
      if (tw.cd > 0) { tw.cd--; return; }
      if (act(g, rd, pad, tw, wind)) tw.cd = stats(tw).cd;
    });
    // oil
    g.oil = g.oil.filter(function (o) { return o.e > g.t; });
    var oilSlow = {};
    g.oil.forEach(function (o) {
      g.fog.forEach(function (f) {
        if (f.hp <= 0 || f.s < o.a || f.s > o.b) return;
        hurt(f, o.dps / TPS, true);
        f.ar = 0;
        if (o.sl) oilSlow[f.id] = Math.max(oilSlow[f.id] || 0, o.sl);
      });
    });
    // fog that faded
    var alive = [];
    g.fog.forEach(function (f) {
      if (f.hp > 0) { alive.push(f); return; }
      g.coins += FOG[f.k].c;
      g.faded++;
      g.ev.push({ e: "fade", f: f.id, k: f.k, s: f.s });
      if (FOG[f.k].split) {
        g.wl[f.w] += 2;
        alive.push(makeFog(g, "m", f.w, f.s), makeFog(g, "m", f.w, Math.max(0, f.s - 0.3)));
      }
      done(g, f.w);
    });
    g.fog = alive;
    // move, and the fog that reached the well
    var left = [];
    g.fog.forEach(function (f) {
      var sl = Math.max(f.st > 0 ? f.sl : 0, oilSlow[f.id] || 0);
      if (f.st > 0) f.st--;
      f.s += FOG[f.k].v * (1 - sl) / TPS;
      if (f.s < rd.len) { left.push(f); return; }
      g.hearts = Math.max(0, g.hearts - FOG[f.k].h);
      g.ev.push({ e: "leak", f: f.id, k: f.k });
      done(g, f.w);
    });
    g.fog = left;
    if (g.hearts <= 0) { g.over = 0; g.ev.push({ e: "lost" }); return; }
    if (g.wave >= g.nw && !g.sp.length && !g.fog.length) { g.over = 1; g.ev.push({ e: "won", stars: stars(g) }); }
  }
  // One fog of wave w is gone: the wave's bonus when it was the last.
  function done(g, w) {
    g.wl[w]--;
    if (g.wl[w] === 0) {
      var bonus = 10 + 2 * (w + 1);
      g.coins += bonus;
      g.ev.push({ e: "clear", w: w, n: bonus });
    }
  }
  function run(g, ticks) { for (var i = 0; i < ticks && g.over < 0; i++) step(g); }

  function stars(g) {
    if (g.over !== 1) return 0;
    var r = g.hearts / g.hmax;
    return r >= 0.9 ? 3 : r >= 0.5 ? 2 : 1;
  }
  // What comes in the next wave: [{k, n}], in order.
  function preview(g) {
    if (g.wave >= g.nw) return [];
    return RIDGE[g.ridge].groups[g.wave].map(function (x) { return { k: x.k, n: x.n }; });
  }

  // ---------- Session: the night in progress ----------
  function num(v, lo, hi) { return typeof v === "number" && isFinite(v) && v >= lo && v <= hi; }
  function int(v, lo, hi) { return num(v, lo, hi) && Math.floor(v) === v; }
  // A copy that can be trusted, or null (unreadable or from another version).
  function normalizeRun(x) {
    if (!x || typeof x !== "object" || x.v !== V || !RIDGE[x.ridge] || !DIFF[x.diff]) return null;
    var rd = RIDGE[x.ridge];
    var BIG = 1e9;
    if (!int(x.u, 1, 4) || !int(x.t, 0, BIG) || !num(x.coins, 0, BIG) || !int(x.hearts, 0, 99) ||
        !int(x.hmax, 1, 99) || !int(x.wave, 0, rd.waves.length) || x.nw !== rd.waves.length ||
        !int(x.nid, 1, BIG) || [-1, 0, 1].indexOf(x.over) < 0 || !int(x.acts, 0, BIG) || !int(x.faded, 0, BIG) ||
        !Array.isArray(x.sp) || !Array.isArray(x.wl) || x.wl.length !== rd.waves.length ||
        !Array.isArray(x.fog) || !Array.isArray(x.oil) || !x.tw || typeof x.tw !== "object") return null;
    var g = { v: V, ridge: x.ridge, diff: x.diff, u: x.u, t: x.t, coins: x.coins, hearts: x.hearts, hmax: x.hmax,
              wave: x.wave, nw: x.nw, sp: [], wl: [], fog: [], oil: [], tw: {}, nid: x.nid, over: x.over,
              acts: x.acts, faded: x.faded, ev: [] };
    for (var i = 0; i < x.wl.length; i++) { if (!int(x.wl[i], 0, BIG)) return null; g.wl.push(x.wl[i]); }
    for (i = 0; i < x.sp.length; i++) {
      var s = x.sp[i];
      if (!s || !int(s.w, 0, rd.waves.length - 1) || !int(s.g, 0, rd.groups[s.w].length - 1) ||
          !int(s.n, 0, BIG) || !int(s.next, 0, BIG)) return null;
      g.sp.push({ w: s.w, g: s.g, n: s.n, next: s.next });
    }
    for (i = 0; i < x.fog.length; i++) {
      var f = x.fog[i];
      if (!f || !FOG[f.k] || !int(f.id, 1, BIG) || !int(f.w, 0, rd.waves.length - 1) || !num(f.s, 0, rd.len) ||
          !num(f.hp, -BIG, BIG) || !num(f.mx, 1, BIG) || !num(f.sl, 0, 1) || !int(f.st, 0, BIG) || (f.ar !== 0 && f.ar !== 1)) return null;
      g.fog.push({ id: f.id, k: f.k, w: f.w, s: f.s, hp: f.hp, mx: f.mx, sl: f.sl, st: f.st, ar: f.ar });
    }
    for (i = 0; i < x.oil.length; i++) {
      var o = x.oil[i];
      if (!o || !num(o.a, -2, rd.len + 2) || !num(o.b, -2, rd.len + 2) || !int(o.e, 0, BIG) || !num(o.dps, 0, 999) || !num(o.sl, 0, 1)) return null;
      g.oil.push({ a: o.a, b: o.b, e: o.e, dps: o.dps, sl: o.sl });
    }
    var pads = Object.keys(x.tw);
    for (i = 0; i < pads.length; i++) {
      var p = pads[i], tw = x.tw[p];
      if (!/^\d{1,2}$/.test(p) || !rd.pads[+p] || !tw || !TOWERS[tw.k] || !int(tw.l, 1, 3) ||
          (tw.l === 3 ? (tw.b !== "a" && tw.b !== "b") : tw.b !== "") || !int(tw.tm, 0, TARGETS.length - 1) ||
          !int(tw.cd, 0, 9999) || !num(tw.sp, 0, BIG) || !num(tw.fr, 0, tw.sp)) return null;
      g.tw[+p] = { k: tw.k, l: tw.l, b: tw.b, tm: tw.tm, cd: tw.cd, sp: tw.sp, fr: tw.fr };
    }
    return g;
  }
  // The session as written: no events.
  function saveable(g) {
    var c = JSON.parse(JSON.stringify(g));
    delete c.ev;
    return c;
  }

  // ---------- Progress (the synced slice "ridge", oros-ridge-data) ----------
  // { ver, br, maps: { "<ridge>": { b, s: best stars 0-3, e: best Endless wave } },
  //   rows: { "<device id>": { b, s: { "<diff>": [nights, won] }, f: fog faded } } }
  // br = reset stamp (Reset progress): entries with b < br drop. maps:
  // the newer b wins, equal b keeps the larger s and e. rows: each
  // device only grows its own row (the newer b wins, then per-field
  // max). Every part is a join, so merge is symmetric and idempotent.
  var DATA_VER = 1;
  var BIGN = 1e9;
  function cmpStr(x, y) { return x < y ? -1 : (x > y ? 1 : 0); }
  function defaultData() { return { ver: DATA_VER, br: 0, maps: {}, rows: {} }; }
  function normMap(v) {
    if (!v || typeof v !== "object" || !int(v.b, 0, 1e15) || !int(v.s, 0, 3) || !int(v.e, 0, 9999)) return null;
    return { b: v.b, s: v.s, e: v.e };
  }
  function normRow(v) {
    if (!v || typeof v !== "object" || !int(v.b, 0, 1e15) || !v.s || typeof v.s !== "object") return null;
    var s = {};
    DIFFS.forEach(function (k) {
      var a = v.s[k];
      if (Array.isArray(a) && a.length === 2 && int(a[0], 0, BIGN) && int(a[1], 0, a[0])) s[k] = [a[0], a[1]];
    });
    return { b: v.b, s: s, f: int(v.f, 0, BIGN) ? v.f : 0 };
  }
  function merge(A, B) {
    var a = A && typeof A === "object" ? A : {}, b = B && typeof B === "object" ? B : {};
    var br = Math.max(int(a.br, 0, 1e15) ? a.br : 0, int(b.br, 0, 1e15) ? b.br : 0);
    var maps = {}, rows = {};
    [a.maps, b.maps].forEach(function (m) {
      if (!m || typeof m !== "object" || Array.isArray(m)) return;
      Object.keys(m).forEach(function (id) {
        if (!RIDGE[id]) return;
        var v = normMap(m[id]);
        if (!v || v.b < br) return;
        var c = maps[id];
        if (!c || v.b > c.b) maps[id] = v;
        else if (v.b === c.b) maps[id] = { b: c.b, s: Math.max(c.s, v.s), e: Math.max(c.e, v.e) };
      });
    });
    [a.rows, b.rows].forEach(function (m) {
      if (!m || typeof m !== "object" || Array.isArray(m)) return;
      Object.keys(m).forEach(function (id) {
        if (!/^[a-z0-9]{6,32}$/.test(id)) return;
        var v = normRow(m[id]);
        if (!v || v.b < br) return;
        var c = rows[id];
        if (!c || v.b > c.b) { rows[id] = v; return; }
        if (v.b < c.b) return;
        var s = {};
        DIFFS.forEach(function (k) {
          var x = c.s[k], y = v.s[k];
          if (x || y) s[k] = !x ? y.slice() : !y ? x.slice() : [Math.max(x[0], y[0]), Math.max(x[1], y[1])];
        });
        rows[id] = { b: c.b, s: s, f: Math.max(c.f, v.f) };
      });
    });
    var sm = {}, sr = {};
    Object.keys(maps).sort(cmpStr).forEach(function (id) { sm[id] = maps[id]; });
    Object.keys(rows).sort(cmpStr).forEach(function (id) {
      var r = rows[id], s = {};
      DIFFS.forEach(function (k) { if (r.s[k]) s[k] = r.s[k]; });
      sr[id] = { b: r.b, s: s, f: r.f };
    });
    return { ver: DATA_VER, br: br, maps: sm, rows: sr };
  }
  // A night ended on this device: count it and keep the best stars.
  function record(d, device, g, now) {
    var out = merge(d, d);
    var row = out.rows[device] || { b: out.br, s: {}, f: 0 };
    var v = row.s[g.diff] ? row.s[g.diff].slice() : [0, 0];
    v[0]++;
    if (g.over === 1) v[1]++;
    row.s[g.diff] = v;
    row.f += g.faded;
    out.rows[device] = row;
    var m = out.maps[g.ridge];
    var st = stars(g);
    if (st && (!m || st > m.s)) out.maps[g.ridge] = { b: m ? m.b : Math.max(out.br, now || 0), s: st, e: m ? m.e : 0 };
    return merge(out, out);
  }
  // Stars of a ridge, and whether it is open (the first is; the next
  // opens when the one before has a star).
  function starsOf(d, id) { var m = d && d.maps && d.maps[id]; return m ? m.s : 0; }
  function isOpen(d, id) {
    var rd = RIDGE[id];
    return !!rd && (rd.idx === 0 || starsOf(d, RIDGES[rd.idx - 1].id) > 0);
  }

  function clone(x) { return JSON.parse(JSON.stringify(x)); }

  var api = {
    V: V, COLS: COLS, ROWS: ROWS, TPS: TPS, DIFFS: DIFFS, DIFF: DIFF, FOG: FOG, TOWERS: TOWERS, KINDS: KINDS,
    TARGETS: TARGETS, RIDGES: RIDGES, RIDGE: RIDGE,
    posAt: posAt, padPos: padPos, windOf: windOf, windVec: windVec, windNow: windNow, windNext: windNext,
    stats: stats, reachTo: reachTo, newRun: newRun, buildCost: buildCost, upCost: upCost, sellValue: sellValue,
    unlocked: unlocked, build: build, upgrade: upgrade, sell: sell, target: target, callWave: callWave,
    fogLeft: fogLeft, step: step, run: run, stars: stars, preview: preview, fogHp: fogHp,
    normalizeRun: normalizeRun, saveable: saveable,
    defaultData: defaultData, merge: merge, record: record, starsOf: starsOf, isOpen: isOpen,
    hash: hash, mulberry32: mulberry32, clone: clone
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.RidgeEngine = api;
})(typeof window !== "undefined" ? window : this);
