// ============================================================
// orOS Orbit garden — the rules (v1.0.0), no DOM
// A tower defense game on a round map: a little garden on a small moon.
// At night falling sparks come in at a gate on the rim and spiral in
// towards the moonflower in the middle. Plants grow on three stone
// rings; every ring has one gap, and between waves the player turns
// the rings a step at a time. A turn moves the ring's plants and its
// gap, and the gap decides how far the sparks walk round each lane
// before they find the way in. Everything is a pure function of the
// state, stepped in fixed ticks of 1/60 s, so a night replays exactly
// (tests/orbit.test.js).
//
// Geometry: units, the centre at (0, 0), x to the right, y down; the
// rim at radius 6. An angle is measured from the top, clockwise (x =
// r sin a, y = −r cos a). Ring k (0 outer, 1 middle, 2 inner) has
// RINGS[k].n slots at radius RINGS[k].r; slot j (in the ring's own
// frame) stands at angle (j + rot[k]) × 2π / n. Frame slot 0 is the
// gap, so turning a ring moves its gap and its plants together.
// Lanes: LANES[0] runs between the rim and ring 0, LANES[1] between
// rings 0 and 1, LANES[2] between rings 1 and 2.
//
// The way of a gate (rebuilt whenever a ring turns): in from the rim to
// lane 0, clockwise round lane 0 to the angle of ring 0's gap, through
// it to lane 1, clockwise to ring 1's gap, through to lane 2, clockwise
// to ring 2's gap, and in to the moonflower (radius HEART). A spark's
// place is its distance s along the way of its gate.
//
// Run state (also the device-local session, oros-orbit-session .g):
//   { v, gd: garden, diff, u: plants unlocked (1-4), t: ticks, coins,
//     hearts, hmax, wave: waves called, nw: waves in the night,
//     rot: [3 ring turns], tn: [3 steps turned since the last wave was
//     called, signed], sp: [spawner], wl: [sparks left per wave],
//     sk: [spark], pl: { "<ring>:<slot>": plant }, nid,
//     over: -1 playing | 0 lost | 1 won, acts, faded }
//   spawner { w: wave, g: group, n: spawned in group, next: tick }
//   spark { id, k: kind, w: wave, gt: gate index, s, hp, mx,
//           sl: slow, st: slow ticks, hd: held ticks, ar: 1 shelled }
//   plant { k, l: 1 | 2 | 3, b: "" | "a" | "b", tm: target mode, cd,
//           sp: coins spent, fr: coins spent since the last wave started
//           (sold back in full) }
// ev (not saved): what happened in the last steps, for the screen.
// ============================================================
(function (root) {
  "use strict";

  var V = 1;
  var TPS = 60;                          // ticks per second
  var RIM = 6, HEART = 0.75;
  var RINGS = [{ n: 16, r: 4.6 }, { n: 12, r: 3.2 }, { n: 8, r: 1.8 }];
  var LANES = [5.4, 3.9, 2.5];
  var GATES_N = 16;                      // a gate sits at one of 16 rim angles
  var GROUP_GAP = 90;                    // ticks between two groups of a wave
  var SELL = 0.7;                        // part of the price a sold plant gives back
  var SHELL = 0.4;                       // what a meteor's shell lets through of thorns and vines
  var STEP_COST = 5;                     // a ring step beyond the free ones
  var FREE_FIRST = 2;                    // free steps per ring before the first wave
  var FREE = 1;                          // and between waves after that
  var TAU = Math.PI * 2;

  var DIFFS = ["m", "n", "h"];           // Mild, Normal, Hard
  var DIFF = {
    m: { hearts: 30, coins: 150, hp: 0.8 },
    n: { hearts: 20, coins: 120, hp: 1 },
    h: { hearts: 10, coins: 100, hp: 1.15 }
  };

  // Spark kinds: health, speed (units per second), coins, hearts it
  // costs; ar: shelled; split: two bits when it goes out.
  var SPARK = {
    s: { hp: 32, v: 1.1, c: 3, h: 1 },             // spark
    c: { hp: 14, v: 2.0, c: 2, h: 1 },             // comet
    m: { hp: 40, v: 0.8, c: 7, h: 1, ar: 1 },      // meteor
    n: { hp: 40, v: 0.9, c: 5, h: 1, split: 1 },   // nebula
    b: { hp: 12, v: 1.2, c: 1, h: 1 },             // a bit of a nebula
    e: { hp: 240, v: 0.5, c: 30, h: 3 }            // eclipse
  };
  var HP_WAVE = 0.45;                    // health +45% per wave
  var HP_GD = 0.1;                       // and +10% per garden (the first 0.85)

  // Plants: price, the garden from which it opens (index + 1 = plants
  // unlocked), tm: has a target mode, and the stats per level 1, 2, a
  // and b (the two level 3 branches). r reach (units), cd ticks between
  // actions, d harm; sl slow, sd slow ticks; hold ticks held still, n
  // how many at once; crack: breaks shells.
  var PLANTS = {
    thorn: { c: 45, u: 1, tm: true, st: {
      1: { r: 1.9, cd: 30, d: 8 },
      2: { r: 2.1, cd: 27, d: 11 },
      a: { r: 2.9, cd: 45, d: 28 },                // Briar
      b: { r: 2.1, cd: 14, d: 10 } } },            // Bramble
    dew: { c: 55, u: 2, tm: false, st: {
      1: { r: 1.8, cd: 120, sl: 0.4, sd: 120 },
      2: { r: 2.0, cd: 110, sl: 0.45, sd: 120 },
      a: { r: 2.6, cd: 110, sl: 0.55, sd: 150 },   // Mist
      b: { r: 2.0, cd: 100, sl: 0.45, sd: 120, d: 12 } } },  // Cold dew
    sun: { c: 70, u: 3, tm: false, st: {
      1: { r: 1.7, cd: 150, d: 22, crack: 1 },
      2: { r: 1.9, cd: 140, d: 32, crack: 1 },
      a: { r: 2.6, cd: 140, d: 34, crack: 1 },     // Big head
      b: { r: 1.9, cd: 140, d: 64, crack: 1 } } }, // Noon burst
    vine: { c: 65, u: 4, tm: true, st: {
      1: { r: 1.8, cd: 240, hold: 60, d: 4, n: 1 },
      2: { r: 2.0, cd: 220, hold: 70, d: 6, n: 1 },
      a: { r: 2.7, cd: 220, hold: 100, d: 6, n: 1 },   // Long tendril
      b: { r: 2.0, cd: 220, hold: 70, d: 6, n: 2 } } } // Twin vine
  };
  var KINDS = ["thorn", "dew", "sun", "vine"];
  var TARGETS = ["first", "strong", "close"];

  // The gardens of the Quiet orbit: gates (rim angle 0-15), the rings'
  // turns at the start, old stones (frame slots, no planting) and the
  // waves ("<kind><count>:<ticks between>", groups one after the other;
  // groups take the gates in turn).
  var GARDENS = [
    { id: "g1", gates: [0], rot: [4, 6, 6], stones: [[], [], []],
      waves: ["s5:90", "s7:80", "s9:70", "s10:60", "s12:55", "s14:50", "s16:45", "s18:40", "s20:36", "s16:40 e1:0"] },
    { id: "g2", gates: [0, 8], rot: [12, 3, 2], stones: [[], [], []],
      waves: ["s6:80", "s8:70", "c5:50 s5:70", "s12:55", "c10:40", "s10:50 c6:40", "s16:45", "c12:35 s8:45", "s20:38", "s14:40 c10:35 e1:0"] },
    { id: "g3", gates: [12], rot: [0, 9, 4], stones: [[5, 11], [4, 8], [4]],
      waves: ["s8:70", "m4:80", "s10:55 c4:45", "m8:60", "s12:50 m4:60", "c12:35", "s14:45 m6:55", "m12:45", "s18:38 c8:35", "m12:40 s12:40 e1:0"] },
    { id: "g4", gates: [4, 12], rot: [8, 0, 4], stones: [[8], [6], []],
      waves: ["s8:70", "n4:80", "c8:45 s6:60", "n8:60", "s14:50", "c10:35 n6:55", "s16:45", "n12:45", "s12:45 c12:35 m8:50", "n12:40 s14:40 e1:0"] }
  ];
  var GARDEN = {};
  function parseWave(str) {
    return str.split(" ").map(function (g) {
      var m = /^([a-z])(\d+):(\d+)$/.exec(g);
      return { k: m[1], n: +m[2], gap: +m[3] };
    });
  }
  GARDENS.forEach(function (gd, i) { gd.idx = i; gd.groups = gd.waves.map(parseWave); GARDEN[gd.id] = gd; });

  // ---------- Geometry ----------
  function mod(a, n) { return ((a % n) + n) % n; }
  function point(r, a) { return { x: r * Math.sin(a), y: -r * Math.cos(a) }; }
  function slotAngle(rot, k, j) { return mod(j + rot[k], RINGS[k].n) * TAU / RINGS[k].n; }
  function slotPos(g, key) {
    var p = parseKey(key);
    return point(RINGS[p.k].r, slotAngle(g.rot, p.k, p.j));
  }
  function gateAngle(gd, i) { return gd.gates[i] * TAU / GATES_N; }
  function key(k, j) { return k + ":" + j; }
  function parseKey(s) {
    var m = /^([0-2]):(\d{1,2})$/.exec(String(s));
    if (!m) return null;
    var k = +m[1], j = +m[2];
    return j < RINGS[k].n ? { k: k, j: j } : null;
  }
  // The clockwise sweep from angle a to angle b, in [0, 2π).
  function sweep(a, b) {
    var d = mod(b - a, TAU);
    return d > TAU - 1e-9 ? 0 : d;
  }
  // The way of one gate: [{ t: "r", a, r0, r1, s0, l } | { t: "c", r, a0, da, s0, l }].
  function wayOf(gd, rot, gi) {
    var seg = [], s = 0, a = gateAngle(gd, gi), r = RIM;
    function radial(r1) { var l = Math.abs(r - r1); if (l > 0) seg.push({ t: "r", a: a, r0: r, r1: r1, s0: s, l: l }); s += l; r = r1; }
    function arc(to) { var da = sweep(a, to), l = da * r; if (l > 0) seg.push({ t: "c", r: r, a0: a, da: da, s0: s, l: l }); s += l; a = mod(a + da, TAU); }
    radial(LANES[0]);
    for (var k = 0; k < 3; k++) {
      arc(slotAngle(rot, k, 0));
      radial(k < 2 ? LANES[k + 1] : HEART);
    }
    return { seg: seg, len: s };
  }
  // Everything derived from the turns, kept on the run (not saved).
  function ways(g) {
    var tag = g.rot.join(",");
    if (g._w && g._w.tag === tag) return g._w.w;
    var gd = GARDEN[g.gd], w = gd.gates.map(function (x, i) { return wayOf(gd, g.rot, i); });
    try { Object.defineProperty(g, "_w", { value: { tag: tag, w: w }, writable: true, configurable: true, enumerable: false }); }
    catch (e) { g._w = { tag: tag, w: w }; }
    return w;
  }
  function posOn(way, s) {
    var seg = way.seg;
    if (!seg.length) return point(HEART, 0);
    for (var i = 0; i < seg.length; i++) {
      var q = seg[i];
      if (s <= q.s0 + q.l || i === seg.length - 1) {
        var f = Math.max(0, Math.min(q.l, s - q.s0));
        if (q.t === "r") return point(q.r0 + (q.r1 - q.r0) * f / q.l, q.a);
        return point(q.r, q.a0 + q.da * f / q.l);
      }
    }
    return point(HEART, 0);
  }
  function sparkPos(g, sk) { return posOn(ways(g)[sk.gt], sk.s); }
  // Points along a way for drawing (every ~0.25 units).
  function wayPoints(g, gi) {
    var w = ways(g)[gi], out = [];
    for (var s = 0; s < w.len; s += 0.25) out.push(posOn(w, s));
    out.push(posOn(w, w.len));
    return out;
  }

  // ---------- Randomness (one seeded PRNG, for the tests and Endless later) ----------
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

  // ---------- A new night ----------
  function newRun(gdId, diff) {
    var gd = GARDEN[gdId];
    if (!gd || !DIFF[diff]) return null;
    var D = DIFF[diff];
    return {
      v: V, gd: gdId, diff: diff, u: Math.min(4, gd.idx + 1), t: 0,
      coins: D.coins, hearts: D.hearts, hmax: D.hearts, wave: 0, nw: gd.waves.length,
      rot: gd.rot.slice(), tn: [0, 0, 0],
      sp: [], wl: gd.groups.map(function (gs) { return gs.reduce(function (n, x) { return n + x.n; }, 0); }),
      sk: [], pl: {}, nid: 1, over: -1, acts: 0, faded: 0, ev: []
    };
  }

  // ---------- Actions ----------
  function stats(p) { var P = PLANTS[p.k]; return P ? P.st[p.l === 3 ? p.b : p.l] : null; }
  function plantCost(k) { return PLANTS[k] ? PLANTS[k].c : 0; }
  function upCost(p) {
    if (!p || p.l >= 3) return 0;
    var c = PLANTS[p.k].c;
    return p.l === 1 ? Math.round(c * 0.6) : c;
  }
  function sellValue(p) { return p.fr + Math.floor(SELL * (p.sp - p.fr)); }
  function unlocked(g, k) { return !!PLANTS[k] && PLANTS[k].u <= g.u; }
  function isStone(gd, k, j) { return gd.stones[k].indexOf(j) >= 0; }
  // A slot plants can grow on: not the gap (frame slot 0), not a stone.
  function isBed(gd, k, j) { return j > 0 && j < RINGS[k].n && !isStone(gd, k, j); }
  // Why plant k cannot go on slot key ("" = it can): "over", "locked",
  // "gap", "stone", "taken", "coins".
  function whyNot(g, sk, k) {
    var gd = GARDEN[g.gd], p = parseKey(sk);
    if (g.over >= 0) return "over";
    if (!PLANTS[k] || !unlocked(g, k)) return "locked";
    if (!p) return "stone";
    if (p.j === 0) return "gap";
    if (isStone(gd, p.k, p.j)) return "stone";
    if (g.pl[sk]) return "taken";
    if (g.coins < plantCost(k)) return "coins";
    return "";
  }
  function plant(g, sk, k) {
    if (whyNot(g, sk, k)) return false;
    var c = plantCost(k);
    g.coins -= c;
    g.pl[sk] = { k: k, l: 1, b: "", tm: 0, cd: 0, sp: c, fr: c };
    g.acts++;
    return true;
  }
  function upgrade(g, sk, branch) {
    var p = g.pl[sk];
    if (g.over >= 0 || !p || p.l >= 3) return false;
    if (p.l === 2 && branch !== "a" && branch !== "b") return false;
    var c = upCost(p);
    if (g.coins < c) return false;
    g.coins -= c;
    p.sp += c; p.fr += c;
    p.l++;
    if (p.l === 3) p.b = branch;
    g.acts++;
    return true;
  }
  function sell(g, sk) {
    var p = g.pl[sk];
    if (g.over >= 0 || !p) return false;
    g.coins += sellValue(p);
    delete g.pl[sk];
    g.acts++;
    return true;
  }
  function target(g, sk) {
    var p = g.pl[sk];
    if (g.over >= 0 || !p || !PLANTS[p.k].tm) return false;
    p.tm = (p.tm + 1) % TARGETS.length;
    g.acts++;
    return true;
  }
  // Turning. The steps turned on a ring since the last wave was called
  // are counted (signed), so turning back gives the step back. The free
  // steps: FREE_FIRST before the first wave, FREE after; every step
  // beyond them costs STEP_COST.
  function free(g) { return g.wave === 0 ? FREE_FIRST : FREE; }
  function stepsCost(g, n) { return Math.max(0, Math.abs(n) - free(g)) * STEP_COST; }
  function canTurn(g) { return g.over < 0 && !g.sk.length && !g.sp.length; }
  // What turning ring k by dir (+1 clockwise, −1) costs (negative: gives back).
  function turnCost(g, k, dir) { return stepsCost(g, g.tn[k] + dir) - stepsCost(g, g.tn[k]); }
  // Why ring k cannot turn ("" = it can): "over", "out" (sparks are out), "coins".
  function whyNoTurn(g, k, dir) {
    if (g.over >= 0) return "over";
    if (!canTurn(g)) return "out";
    if (turnCost(g, k, dir) > g.coins) return "coins";
    return "";
  }
  function turn(g, k, dir) {
    if (!(k >= 0 && k < 3) || (dir !== 1 && dir !== -1) || whyNoTurn(g, k, dir)) return false;
    g.coins -= turnCost(g, k, dir);
    g.tn[k] += dir;
    g.rot[k] = mod(g.rot[k] + dir, RINGS[k].n);
    g.acts++;
    return true;
  }
  // Sparks still to come or out in the waves called so far.
  function sparksLeft(g) {
    var n = 0;
    for (var w = 0; w < g.wave; w++) n += g.wl[w];
    return n;
  }
  // The next wave. Called while sparks are still out: +1 coin for every
  // spark still to come or out.
  function callWave(g) {
    if (g.over >= 0 || g.wave >= g.nw) return false;
    var early = sparksLeft(g);
    if (early) { g.coins += early; g.ev.push({ e: "early", n: early }); }
    g.sp.push({ w: g.wave, g: 0, n: 0, next: g.t + 1 });
    g.wave++;
    g.tn = [0, 0, 0];
    Object.keys(g.pl).forEach(function (k) { g.pl[k].fr = 0; });
    g.acts++;
    return true;
  }

  // ---------- One tick ----------
  function sparkHp(g, k, w) {
    return Math.round(SPARK[k].hp * (1 + HP_WAVE * w) * (0.85 + HP_GD * GARDEN[g.gd].idx) * DIFF[g.diff].hp);
  }
  function makeSpark(g, k, w, gt, s) {
    var hp = sparkHp(g, k, w);
    return { id: g.nid++, k: k, w: w, gt: gt, s: s, hp: hp, mx: hp, sl: 0, st: 0, hd: 0, ar: SPARK[k].ar ? 1 : 0 };
  }
  function hurt(sk, d, shellOk) {
    if (sk.ar && !shellOk) d *= SHELL;
    sk.hp -= d;
  }
  function slow(sk, sl, ticks) {
    sk.sl = sk.st > 0 ? Math.max(sk.sl, sl) : sl;
    sk.st = Math.max(sk.st, ticks);
  }
  function inReach(g, at, r) {
    return g.sk.filter(function (sk) {
      if (sk.hp <= 0) return false;
      var q = sparkPos(g, sk), dx = q.x - at.x, dy = q.y - at.y;
      return dx * dx + dy * dy <= r * r + 1e-9;
    });
  }
  // The sparks a plant aims at, best first (ties: the lower id).
  function pick(g, at, p, st, n) {
    var cand = inReach(g, at, st.r);
    if (!cand.length) return [];
    var tm = TARGETS[p.tm], w = ways(g);
    function rest(sk) { return w[sk.gt].len - sk.s; }
    function d2(sk) { var q = sparkPos(g, sk); return (q.x - at.x) * (q.x - at.x) + (q.y - at.y) * (q.y - at.y); }
    if (p.k === "vine") cand = cand.filter(function (sk) { return sk.hd <= 0; });
    cand.sort(function (a, b) {
      var x;
      if (tm === "strong") x = b.hp - a.hp;
      else if (tm === "close") x = d2(a) - d2(b);
      else x = rest(a) - rest(b);
      return x || a.id - b.id;
    });
    return cand.slice(0, n);
  }
  function act(g, sk, p) {
    var st = stats(p), at = slotPos(g, sk);
    if (p.k === "thorn") {
      var tg = pick(g, at, p, st, 1);
      if (!tg.length) return false;
      hurt(tg[0], st.d, false);
      g.ev.push({ e: "thorn", p: sk, f: tg[0].id });
      return true;
    }
    if (p.k === "vine") {
      var hv = pick(g, at, p, st, st.n);
      if (!hv.length) return false;
      hv.forEach(function (x) { x.hd = Math.max(x.hd, st.hold); hurt(x, st.d, false); });
      g.ev.push({ e: "vine", p: sk, f: hv.map(function (x) { return x.id; }) });
      return true;
    }
    var all = inReach(g, at, st.r);
    if (!all.length) return false;
    if (p.k === "dew") {
      all.forEach(function (x) { slow(x, st.sl, st.sd); if (st.d) hurt(x, st.d, false); });
      g.ev.push({ e: "dew", p: sk });
      return true;
    }
    if (p.k === "sun") {
      all.forEach(function (x) { if (st.crack) x.ar = 0; hurt(x, st.d, true); });
      g.ev.push({ e: "sun", p: sk });
      return true;
    }
    return false;
  }
  // The plants act in a fixed order: ring by ring, slot by slot.
  function plantKeys(g) {
    return Object.keys(g.pl).sort(function (a, b) {
      var p = parseKey(a), q = parseKey(b);
      return p.k - q.k || p.j - q.j;
    });
  }
  function step(g) {
    if (g.over >= 0) return;
    var gd = GARDEN[g.gd], w = ways(g);
    g.t++;
    // spawners (groups take the gates in turn)
    for (var i = 0; i < g.sp.length; i++) {
      var sp = g.sp[i];
      if (g.t < sp.next) continue;
      var grp = gd.groups[sp.w][sp.g];
      g.sk.push(makeSpark(g, grp.k, sp.w, (sp.w + sp.g) % gd.gates.length, 0));
      sp.n++;
      if (sp.n >= grp.n) {
        sp.g++; sp.n = 0;
        if (sp.g >= gd.groups[sp.w].length) { g.sp.splice(i, 1); i--; continue; }
        sp.next = g.t + GROUP_GAP;
      } else sp.next = g.t + Math.max(1, grp.gap);
    }
    // plants
    plantKeys(g).forEach(function (k) {
      var p = g.pl[k];
      if (p.cd > 0) { p.cd--; return; }
      if (act(g, k, p)) p.cd = stats(p).cd;
    });
    // sparks that went out (a nebula leaves two bits behind it)
    var alive = [];
    g.sk.forEach(function (sk) {
      if (sk.hp > 0) { alive.push(sk); return; }
      var q = sparkPos(g, sk);
      g.coins += SPARK[sk.k].c;
      g.faded++;
      g.ev.push({ e: "out", f: sk.id, k: sk.k, x: q.x, y: q.y });
      if (SPARK[sk.k].split) {
        g.wl[sk.w] += 2;
        alive.push(makeSpark(g, "b", sk.w, sk.gt, sk.s));
        alive.push(makeSpark(g, "b", sk.w, sk.gt, Math.max(0, sk.s - 0.35)));
      }
      done(g, sk.w);
    });
    g.sk = alive;
    // move, and the sparks that reached the moonflower
    var left = [];
    g.sk.forEach(function (sk) {
      if (sk.hd > 0) sk.hd--;
      else sk.s += SPARK[sk.k].v * (1 - (sk.st > 0 ? sk.sl : 0)) / TPS;
      if (sk.st > 0) sk.st--;
      if (sk.s < w[sk.gt].len) { left.push(sk); return; }
      g.hearts = Math.max(0, g.hearts - SPARK[sk.k].h);
      g.ev.push({ e: "leak", f: sk.id, k: sk.k });
      done(g, sk.w);
    });
    g.sk = left;
    if (g.hearts <= 0) { g.over = 0; g.ev.push({ e: "lost" }); return; }
    if (g.wave >= g.nw && !g.sp.length && !g.sk.length) { g.over = 1; g.ev.push({ e: "won", stars: stars(g) }); }
  }
  // One spark of wave w is gone: the wave's bonus when it was the last.
  function done(g, w) {
    g.wl[w]--;
    if (g.wl[w] === 0) {
      var bonus = 8 + 2 * (w + 1);
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
  // What comes in the next wave: [{k, n, gt}], in order.
  function preview(g) {
    if (g.wave >= g.nw) return [];
    var gd = GARDEN[g.gd], w = g.wave;
    return gd.groups[w].map(function (x, i) { return { k: x.k, n: x.n, gt: (w + i) % gd.gates.length }; });
  }
  // The gates the next wave comes from (or every gate when none comes).
  function nextGates(g) {
    var p = preview(g), seen = {}, out = [];
    p.forEach(function (x) { if (!seen[x.gt]) { seen[x.gt] = 1; out.push(x.gt); } });
    if (!out.length) GARDEN[g.gd].gates.forEach(function (x, i) { out.push(i); });
    return out.sort(function (a, b) { return a - b; });
  }

  // ---------- Session: the night in progress ----------
  function num(v, lo, hi) { return typeof v === "number" && isFinite(v) && v >= lo && v <= hi; }
  function int(v, lo, hi) { return num(v, lo, hi) && Math.floor(v) === v; }
  // A copy that can be trusted, or null (unreadable or from another version).
  function normalizeRun(x) {
    if (!x || typeof x !== "object" || x.v !== V || !GARDEN[x.gd] || !DIFF[x.diff]) return null;
    var gd = GARDEN[x.gd];
    var BIG = 1e9, nw = gd.waves.length, i;
    if (!int(x.u, 1, 4) || !int(x.t, 0, BIG) || !num(x.coins, 0, BIG) || !int(x.hearts, 0, 99) ||
        !int(x.hmax, 1, 99) || !int(x.wave, 0, nw) || x.nw !== nw ||
        !int(x.nid, 1, BIG) || [-1, 0, 1].indexOf(x.over) < 0 || !int(x.acts, 0, BIG) || !int(x.faded, 0, BIG) ||
        !Array.isArray(x.rot) || x.rot.length !== 3 || !Array.isArray(x.tn) || x.tn.length !== 3 ||
        !Array.isArray(x.sp) || !Array.isArray(x.wl) || x.wl.length !== nw ||
        !Array.isArray(x.sk) || !x.pl || typeof x.pl !== "object" || Array.isArray(x.pl)) return null;
    for (i = 0; i < 3; i++) if (!int(x.rot[i], 0, RINGS[i].n - 1) || !int(x.tn[i], -99, 99)) return null;
    var g = { v: V, gd: x.gd, diff: x.diff, u: x.u, t: x.t, coins: x.coins, hearts: x.hearts, hmax: x.hmax,
              wave: x.wave, nw: nw, rot: x.rot.slice(), tn: x.tn.slice(), sp: [], wl: [], sk: [], pl: {},
              nid: x.nid, over: x.over, acts: x.acts, faded: x.faded, ev: [] };
    for (i = 0; i < x.wl.length; i++) { if (!int(x.wl[i], 0, BIG)) return null; g.wl.push(x.wl[i]); }
    for (i = 0; i < x.sp.length; i++) {
      var s = x.sp[i];
      if (!s || !int(s.w, 0, nw - 1) || !int(s.g, 0, gd.groups[s.w].length - 1) ||
          !int(s.n, 0, BIG) || !int(s.next, 0, BIG)) return null;
      g.sp.push({ w: s.w, g: s.g, n: s.n, next: s.next });
    }
    var keys = Object.keys(x.pl);
    for (i = 0; i < keys.length; i++) {
      var k = keys[i], p = x.pl[k], pk = parseKey(k);
      if (!pk || key(pk.k, pk.j) !== k || !isBed(gd, pk.k, pk.j) || !p || !PLANTS[p.k]) return null;
      if (!int(p.l, 1, 3) || (p.l === 3 ? (p.b !== "a" && p.b !== "b") : p.b !== "") || !int(p.tm, 0, TARGETS.length - 1) ||
          !int(p.cd, 0, 9999) || !num(p.sp, 0, BIG) || !num(p.fr, 0, p.sp)) return null;
      g.pl[k] = { k: p.k, l: p.l, b: p.b, tm: p.tm, cd: p.cd, sp: p.sp, fr: p.fr };
    }
    var w = ways(g);
    for (i = 0; i < x.sk.length; i++) {
      var h = x.sk[i];
      if (!h || !SPARK[h.k] || !int(h.id, 1, BIG) || !int(h.w, 0, nw - 1) || !int(h.gt, 0, gd.gates.length - 1) ||
          !num(h.s, 0, w[h.gt].len) || !num(h.hp, -BIG, BIG) || !num(h.mx, 1, BIG) || !num(h.sl, 0, 1) ||
          !int(h.st, 0, BIG) || !int(h.hd, 0, BIG) || (h.ar !== 0 && h.ar !== 1)) return null;
      g.sk.push({ id: h.id, k: h.k, w: h.w, gt: h.gt, s: h.s, hp: h.hp, mx: h.mx, sl: h.sl, st: h.st, hd: h.hd, ar: h.ar });
    }
    return g;
  }
  // The session as written: no events, no derived fields.
  function saveable(g) {
    var c = JSON.parse(JSON.stringify(g));
    delete c.ev;
    return c;
  }

  // ---------- Progress (the synced slice "orbit", oros-orbit-data) ----------
  // { ver, br, maps: { "<garden>": { b, s: best stars 0-3, e: best Endless wave } },
  //   rows: { "<device id>": { b, s: { "<diff>": [nights, won] }, f: sparks out } } }
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
        if (!GARDEN[id]) return;
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
    var m = out.maps[g.gd];
    var st = stars(g);
    if (st && (!m || st > m.s)) out.maps[g.gd] = { b: m ? m.b : Math.max(out.br, now || 0), s: st, e: m ? m.e : 0 };
    return merge(out, out);
  }
  // Stars of a garden, and whether it is open (the first is; the next
  // opens when the one before has a star).
  function starsOf(d, id) { var m = d && d.maps && d.maps[id]; return m ? m.s : 0; }
  function isOpen(d, id) {
    var gd = GARDEN[id];
    return !!gd && (gd.idx === 0 || starsOf(d, GARDENS[gd.idx - 1].id) > 0);
  }

  function clone(x) { return JSON.parse(JSON.stringify(x)); }

  var api = {
    V: V, TPS: TPS, RIM: RIM, HEART: HEART, RINGS: RINGS, LANES: LANES, GATES_N: GATES_N, TAU: TAU,
    DIFFS: DIFFS, DIFF: DIFF, SPARK: SPARK, PLANTS: PLANTS, KINDS: KINDS, TARGETS: TARGETS,
    GARDENS: GARDENS, GARDEN: GARDEN, STEP_COST: STEP_COST, FREE: FREE, FREE_FIRST: FREE_FIRST,
    point: point, slotAngle: slotAngle, slotPos: slotPos, gateAngle: gateAngle, key: key, parseKey: parseKey,
    isBed: isBed, isStone: isStone, ways: ways, posOn: posOn, sparkPos: sparkPos, wayPoints: wayPoints,
    stats: stats, plantCost: plantCost, upCost: upCost, sellValue: sellValue, unlocked: unlocked,
    newRun: newRun, whyNot: whyNot, plant: plant, upgrade: upgrade, sell: sell, target: target,
    free: free, canTurn: canTurn, turnCost: turnCost, whyNoTurn: whyNoTurn, turn: turn,
    callWave: callWave, sparksLeft: sparksLeft, step: step, run: run, stars: stars, preview: preview,
    nextGates: nextGates, sparkHp: sparkHp, normalizeRun: normalizeRun, saveable: saveable,
    defaultData: defaultData, merge: merge, record: record, starsOf: starsOf, isOpen: isOpen,
    hash: hash, mulberry32: mulberry32, clone: clone
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.OrbitEngine = api;
})(typeof window !== "undefined" ? window : this);
