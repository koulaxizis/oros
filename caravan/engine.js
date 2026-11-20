// ============================================================
// orOS Caravan — the rules (v1.0.0), no DOM
// A reverse tower defense game: old clockwork toll machines guard the
// road to the market, and the player leads a caravan of carts through
// them. Before every trip the player hires and upgrades carts, puts
// them in order and sets the sign at every fork; on the road the
// carts roll by themselves, the machines knock crates off the carts in
// reach, and the player flips signs and uses three tricks (smoke, a
// shield, the goat track). Everything is a pure function of the state,
// stepped in fixed ticks of 1/60 s, with no randomness, so a trip
// replays exactly (tests/caravan.test.js).
//
// The map is 12 × 18 tiles, column c from the left, row r from the
// top; a point (x, y) is in tiles, a tile's centre is (c + 0.5,
// r + 0.5). Each route is a small road graph: nodes (S the village
// gate, M the market, the rest junctions) and edges drawn as
// straight pieces between corner tiles. An edge marked goat is the
// goat track: only the Shortcut trick opens it, for one trip.
//
// Run state (also the device-local session, oros-caravan-session .g):
//   { v, rt, diff, u: carts unlocked (1-4), t: ticks, ph: "plan" | "go",
//     trip (1-3), nt: trips, coins, got: crates at the market, load:
//     crates loaded, tg: crates of this trip, goal, cv: [cart] in order,
//     sg: { "<node>": out edge index }, tk: { s: smoke, w: shield,
//     c: shortcut } tricks left, goat: 0 | 1 open this trip, sm: [cloud],
//     mc: [machine], ri: carts released this trip, nid,
//     over: -1 playing | 0 lost | 1 won, acts }
//   cart { id, k, l, b, sp: coins spent, fr: spent since the last
//          departure (sold back in full), st: "q" waiting | "r" on the
//          road | "d" at the market | "h" turned back | "x" burnt,
//          e: edge (-1 none), d: distance along it, x, y, tr: distance
//          travelled, hp: crates (straw for the straw cart), sh: shield
//          ticks }
//   cloud { x, y, t: ticks left }   machine { cd: cooldown, st: stopped }
// ev (not saved): what happened in the last steps, for the screen.
// ============================================================
(function (root) {
  "use strict";

  var V = 1;
  var COLS = 12, ROWS = 18;
  var TPS = 60;                          // ticks per second
  var GAP = 1;                           // tiles between two carts
  var SELL = 0.7;                        // part of the price a sold cart gives back
  var MAX_CARTS = 8;
  var TRIPS = 3;
  var PAY = 2, TRIP_PAY = 10;            // coins per crate at the market, per trip
  var TRICK_COST = 15;
  var SMOKE_R = 1.6, SMOKE_T = 300;      // tiles, ticks
  var SHIELD_T = 360;
  var LOOK_R = 2, LOOK_RATE = 1.5;       // a lookout: reach, how much faster
  var MUD_SLOW = 0.5;
  var EPS = 1e-9;

  var DIFFS = ["m", "n", "h"];           // Mild, Normal, Hard
  var DIFF = {
    m: { coins: 130, dmg: 0.75 },
    n: { coins: 100, dmg: 1 },
    h: { coins: 80, dmg: 1.25 }
  };

  // Carts: price, the route from which it can be hired. Stats per level
  // 1, 2, a, b: cap crates (straw), v tiles per second, ar part of a hit
  // it takes, decoy, mender reach mr and rate (crates per second), scare
  // ticks a machine that hits it stops.
  var CARTS = {
    mule: { c: 30, u: 1, st: {
      1: { cap: 10, v: 0.8, ar: 0.75 },
      2: { cap: 13, v: 0.8, ar: 0.75 },
      a: { cap: 18, v: 0.65, ar: 0.75 },           // Ox wagon
      b: { cap: 13, v: 0.8, ar: 0.5 } } },         // Iron rims
    pony: { c: 25, u: 1, st: {
      1: { cap: 5, v: 1.4, ar: 1 },
      2: { cap: 6, v: 1.5, ar: 1 },
      a: { cap: 6, v: 1.9, ar: 1 },                // Courier
      b: { cap: 9, v: 1.4, ar: 1 } } },            // Saddlebags
    mender: { c: 40, u: 2, st: {
      1: { cap: 3, v: 0.9, ar: 1, mr: 1.5, rate: 0.5 },
      2: { cap: 4, v: 0.9, ar: 1, mr: 1.8, rate: 0.7 },
      a: { cap: 4, v: 0.9, ar: 1, mr: 2.6, rate: 0.7 },   // Wide reach
      b: { cap: 4, v: 0.9, ar: 1, mr: 1.8, rate: 1.2 } } }, // Quick hands
    straw: { c: 15, u: 3, st: {
      1: { cap: 12, v: 1, ar: 1, decoy: 1 },
      2: { cap: 16, v: 1, ar: 1, decoy: 1 },
      a: { cap: 26, v: 1, ar: 1, decoy: 1 },             // Wet straw
      b: { cap: 16, v: 1, ar: 1, decoy: 1, scare: 120 } } } // Scarecrow
  };
  var KINDS = ["mule", "pony", "mender", "straw"];

  // Toll machines: reach r, cooldown cd (ticks), dmg crates per hit,
  // sp splash reach round the cart it aims at; mud slows, look speeds
  // up the machines near it and sees through smoke.
  var MACHINES = {
    arm: { r: 1.5, cd: 72, dmg: 1 },
    bellows: { r: 2, cd: 180, dmg: 1, sp: 1 },
    mud: { r: 1.5, mud: 1 },
    look: { r: LOOK_R, look: 1 }
  };
  var MKINDS = ["arm", "bellows", "mud", "look"];

  // The routes of the Salt road. edges: [from, to, "c,r c,r" corners
  // between, "g" goat track]. machines: [kind, c, r, first trip].
  var ROUTES = [
    { id: "r1", goal: 50,
      nodes: { S: [6, 0], A: [6, 3], B: [6, 14], M: [6, 17] },
      edges: [["S", "A"], ["A", "B", "2,3 2,14"], ["A", "B"], ["A", "B", "10,3 10,14"], ["B", "M"]],
      machines: [["arm", 7, 6, 1], ["arm", 5, 10, 1], ["arm", 7, 16, 1],
                 ["arm", 3, 8, 2], ["arm", 7, 12, 2],
                 ["arm", 9, 7, 3], ["arm", 11, 11, 3], ["arm", 1, 12, 3]] },
    { id: "r2", goal: 55,
      nodes: { S: [3, 0], A: [3, 3], B: [9, 8], C: [3, 12], M: [8, 17] },
      edges: [["S", "A"], ["A", "B", "9,3"], ["A", "C"], ["B", "M"], ["C", "M", "3,15 8,15"],
              ["B", "C", "9,12"], ["A", "M", "6,10", "g"]],
      machines: [["arm", 4, 7, 1], ["bellows", 10, 5, 1], ["arm", 7, 15, 1],
                 ["bellows", 2, 10, 2], ["arm", 8, 11, 2], ["arm", 7, 9, 2],
                 ["bellows", 9, 14, 3], ["arm", 4, 14, 3], ["arm", 6, 12, 3]] },
    { id: "r3", goal: 60,
      nodes: { S: [2, 0], A: [2, 3], B: [9, 6], C: [2, 9], D: [6, 12], M: [6, 17] },
      edges: [["S", "A"], ["A", "B", "9,3"], ["A", "C"], ["B", "D", "9,12"], ["C", "D", "2,12"],
              ["C", "D", "6,9"], ["D", "M"]],
      machines: [["mud", 3, 6, 1], ["arm", 1, 7, 1], ["arm", 10, 9, 1], ["arm", 5, 15, 1],
                 ["mud", 8, 4, 2], ["bellows", 3, 11, 2], ["arm", 5, 10, 2],
                 ["arm", 8, 11, 3], ["bellows", 7, 7, 3], ["mud", 7, 14, 3]] },
    { id: "r4", goal: 72,
      nodes: { S: [9, 0], A: [9, 3], B: [3, 7], C: [9, 9], D: [6, 13], M: [6, 17] },
      edges: [["S", "A"], ["A", "B", "3,3"], ["A", "C"], ["B", "D", "3,13"], ["C", "D", "9,13"],
              ["B", "C", "6,7 6,9"], ["A", "D", "6,6", "g"], ["D", "M"]],
      machines: [["arm", 10, 6, 1], ["look", 4, 10, 1], ["arm", 2, 9, 1], ["arm", 7, 15, 1],
                 ["arm", 8, 11, 2], ["bellows", 4, 12, 2], ["mud", 10, 12, 2],
                 ["look", 8, 7, 3], ["arm", 7, 8, 3], ["bellows", 5, 15, 3], ["arm", 4, 5, 3]] }
  ];
  var ROUTE = {};

  // ---------- Routes ----------
  function pt(c, r) { return { x: c + 0.5, y: r + 0.5 }; }
  function buildRoute(rt, idx) {
    rt.idx = idx;
    var P = {};
    Object.keys(rt.nodes).forEach(function (k) { P[k] = pt(rt.nodes[k][0], rt.nodes[k][1]); });
    rt.P = P;
    rt.out = {};
    Object.keys(P).forEach(function (k) { rt.out[k] = []; });
    rt.E = rt.edges.map(function (e, i) {
      var pts = [P[e[0]]];
      if (e[2]) e[2].split(" ").forEach(function (s) { var a = s.split(","); pts.push(pt(+a[0], +a[1])); });
      pts.push(P[e[1]]);
      var cum = [0];
      for (var k = 1; k < pts.length; k++) cum.push(cum[k - 1] + Math.hypot(pts[k].x - pts[k - 1].x, pts[k].y - pts[k - 1].y));
      rt.out[e[0]].push(i);
      return { a: e[0], b: e[1], pts: pts, cum: cum, len: cum[cum.length - 1], goat: e[3] === "g" };
    });
    rt.forks = Object.keys(rt.out).filter(function (k) { return rt.out[k].length > 1; }).sort();
    rt.hasGoat = rt.E.some(function (e) { return e.goat; });
    rt.M = rt.machines.map(function (m) { var p = pt(m[1], m[2]); return { k: m[0], x: p.x, y: p.y, t: m[3] }; });
  }
  ROUTES.forEach(function (rt, i) { buildRoute(rt, i); ROUTE[rt.id] = rt; });

  function pointAt(edge, d) {
    var cum = edge.cum, pts = edge.pts;
    if (d <= 0) return { x: pts[0].x, y: pts[0].y };
    for (var k = 1; k < pts.length; k++) {
      if (d <= cum[k] + EPS) {
        var f = (d - cum[k - 1]) / Math.max(EPS, cum[k] - cum[k - 1]);
        return { x: pts[k - 1].x + (pts[k].x - pts[k - 1].x) * f, y: pts[k - 1].y + (pts[k].y - pts[k - 1].y) * f };
      }
    }
    var last = pts[pts.length - 1];
    return { x: last.x, y: last.y };
  }
  function dist2(a, b) { return (a.x - b.x) * (a.x - b.x) + (a.y - b.y) * (a.y - b.y); }

  // ---------- Carts ----------
  function stats(c) {
    var K = CARTS[c.k];
    return K ? K.st[c.l === 3 ? c.b : c.l] : null;
  }
  function isGoods(c) { return !stats(c).decoy; }
  function hireCost(k) { return CARTS[k] ? CARTS[k].c : 0; }
  function upCost(c) {
    if (!c || c.l >= 3) return 0;
    var p = CARTS[c.k].c;
    return c.l === 1 ? Math.round(p * 0.6) : p;
  }
  function sellValue(c) { return c.fr + Math.floor(SELL * (c.sp - c.fr)); }
  function unlocked(g, k) { return !!CARTS[k] && CARTS[k].u <= g.u; }
  function cartById(g, id) {
    for (var i = 0; i < g.cv.length; i++) if (g.cv[i].id === id) return g.cv[i];
    return null;
  }

  // ---------- A new route ----------
  function machinesState(rt) { return rt.M.map(function () { return { cd: 0, st: 0 }; }); }
  function newRun(rtId, diff) {
    var rt = ROUTE[rtId];
    if (!rt || !DIFF[diff]) return null;
    var sg = {};
    rt.forks.forEach(function (n) { sg[n] = firstOpen(rt, n, false); });
    return {
      v: V, rt: rtId, diff: diff, u: Math.min(4, rt.idx + 1), t: 0, ph: "plan", trip: 1, nt: TRIPS,
      coins: DIFF[diff].coins, got: 0, load: 0, tg: 0, goal: rt.goal, cv: [], sg: sg,
      tk: { s: 1, w: 1, c: rt.hasGoat ? 1 : 0 }, goat: 0, sm: [], mc: machinesState(rt), ri: 0,
      nid: 1, over: -1, acts: 0, ev: []
    };
  }
  function firstOpen(rt, n, goat) {
    var outs = rt.out[n];
    for (var i = 0; i < outs.length; i++) if (goat || !rt.E[outs[i]].goat) return i;
    return 0;
  }

  // ---------- Plan: hire, order, upgrade, sell ----------
  // Why cart kind k cannot be hired ("" = it can): over, phase, locked,
  // full, coins.
  function whyNot(g, k) {
    if (g.over >= 0) return "over";
    if (g.ph !== "plan") return "phase";
    if (!CARTS[k] || !unlocked(g, k)) return "locked";
    if (g.cv.length >= MAX_CARTS) return "full";
    if (g.coins < hireCost(k)) return "coins";
    return "";
  }
  function fresh(c) {
    var st = stats(c);
    c.st = "q"; c.e = -1; c.d = 0; c.tr = 0; c.sh = 0; c.hp = st.cap;
    c.x = -1; c.y = -1;
  }
  function changed(g) { g.acts++; }
  function hire(g, k) {
    if (whyNot(g, k)) return null;
    var p = hireCost(k);
    g.coins -= p;
    var c = { id: g.nid++, k: k, l: 1, b: "", sp: p, fr: p };
    fresh(c);
    g.cv.push(c);
    changed(g);
    return c;
  }
  function upgrade(g, id, branch) {
    var c = cartById(g, id);
    if (g.over >= 0 || g.ph !== "plan" || !c || c.l >= 3) return false;
    if (c.l === 2 && branch !== "a" && branch !== "b") return false;
    var p = upCost(c);
    if (g.coins < p) return false;
    g.coins -= p;
    c.sp += p; c.fr += p;
    c.l++;
    if (c.l === 3) c.b = branch;
    fresh(c);
    changed(g);
    return true;
  }
  function sell(g, id) {
    var c = cartById(g, id);
    if (g.over >= 0 || g.ph !== "plan" || !c) return false;
    g.coins += sellValue(c);
    g.cv.splice(g.cv.indexOf(c), 1);
    changed(g);
    return true;
  }
  // Move a cart one place forward (-1) or back (+1) in the caravan.
  function moveCart(g, id, dir) {
    var c = cartById(g, id);
    if (g.over >= 0 || g.ph !== "plan" || !c) return false;
    var i = g.cv.indexOf(c), j = i + (dir < 0 ? -1 : 1);
    if (j < 0 || j >= g.cv.length) return false;
    g.cv[i] = g.cv[j]; g.cv[j] = c;
    changed(g);
    return true;
  }
  // An extra trick for this route (plan only).
  function buyTrick(g, k) {
    if (g.over >= 0 || g.ph !== "plan" || !(k in g.tk) || g.coins < TRICK_COST) return false;
    if (k === "c" && !ROUTE[g.rt].hasGoat) return false;
    g.coins -= TRICK_COST;
    g.tk[k]++;
    changed(g);
    return true;
  }

  // ---------- Signs and tricks (plan and road) ----------
  // Flip the sign at fork n to the next way it can point.
  function flip(g, n) {
    var rt = ROUTE[g.rt];
    if (g.over >= 0 || rt.forks.indexOf(n) < 0) return false;
    var outs = rt.out[n], cur = g.sg[n];
    for (var s = 1; s <= outs.length; s++) {
      var j = (cur + s) % outs.length;
      if (!rt.E[outs[j]].goat || g.goat) { g.sg[n] = j; changed(g); return true; }
    }
    return false;
  }
  function setSign(g, n, j) {
    var rt = ROUTE[g.rt];
    if (g.over >= 0 || rt.forks.indexOf(n) < 0 || !(j >= 0 && j < rt.out[n].length)) return false;
    if (rt.E[rt.out[n][j]].goat && !g.goat) return false;
    if (g.sg[n] === j) return true;
    g.sg[n] = j;
    changed(g);
    return true;
  }
  function smoke(g, x, y) {
    if (g.over >= 0 || g.ph !== "go" || g.tk.s < 1 || !(x >= 0 && x <= COLS && y >= 0 && y <= ROWS)) return false;
    g.tk.s--;
    g.sm.push({ x: x, y: y, t: SMOKE_T });
    g.ev.push({ e: "smoke", x: x, y: y });
    changed(g);
    return true;
  }
  function shield(g, id) {
    var c = cartById(g, id);
    if (g.over >= 0 || g.ph !== "go" || g.tk.w < 1 || !c || (c.st !== "r" && c.st !== "q")) return false;
    g.tk.w--;
    c.sh = SHIELD_T;
    g.ev.push({ e: "shield", c: id });
    changed(g);
    return true;
  }
  // Open the goat track for this trip; every sign at a fork with one
  // turns to it.
  function shortcut(g) {
    var rt = ROUTE[g.rt];
    if (g.over >= 0 || !rt.hasGoat || g.goat || g.tk.c < 1) return false;
    g.tk.c--;
    g.goat = 1;
    rt.forks.forEach(function (n) {
      rt.out[n].forEach(function (e, j) { if (rt.E[e].goat) g.sg[n] = j; });
    });
    g.ev.push({ e: "goat" });
    changed(g);
    return true;
  }

  // ---------- Setting off ----------
  function canSetOff(g) { return g.over < 0 && g.ph === "plan" && g.cv.length > 0; }
  function setOff(g) {
    if (!canSetOff(g)) return false;
    g.ph = "go";
    g.ri = 0; g.tg = 0;
    g.cv.forEach(function (c) { fresh(c); c.fr = 0; if (isGoods(c)) g.load += stats(c).cap; });
    g.mc = machinesState(ROUTE[g.rt]);
    changed(g);
    g.ev.push({ e: "off", n: g.trip });
    return true;
  }

  // ---------- One tick ----------
  function active(g, m) { return m.t <= g.trip; }
  function inSmoke(g, p) {
    for (var i = 0; i < g.sm.length; i++) if (dist2(p, g.sm[i]) <= SMOKE_R * SMOKE_R) return true;
    return false;
  }
  // A lookout within reach of machine i (not itself)?
  function looked(g, rt, i) {
    var m = rt.M[i];
    for (var j = 0; j < rt.M.length; j++) {
      var o = rt.M[j];
      if (j !== i && o.k === "look" && active(g, o) && dist2(m, o) <= LOOK_R * LOOK_R + EPS) return true;
    }
    return false;
  }
  function onRoad(c) { return c.st === "r"; }
  // The way out of node n now (the sign, or the first open way).
  function wayOut(g, rt, n) {
    var outs = rt.out[n], j = g.sg[n] || 0;
    if (!(j >= 0 && j < outs.length) || (rt.E[outs[j]].goat && !g.goat)) j = firstOpen(rt, n, false);
    return outs[j];
  }
  function place(c, rt) {
    var p = pointAt(rt.E[c.e], c.d);
    c.x = p.x; c.y = p.y;
  }
  // The nearest cart in front on the same edge (or null).
  function ahead(g, c) {
    var best = null;
    g.cv.forEach(function (o) {
      if (o === c || !onRoad(o) || o.e !== c.e) return;
      // in front: further along, or level and earlier in the caravan
      if (o.d < c.d - 1e-6 || (o.d <= c.d + 1e-6 && g.cv.indexOf(o) > g.cv.indexOf(c))) return;
      if (!best || o.d < best.d) best = o;
    });
    return best;
  }
  function rearOn(g, e, not) {
    var best = null;
    g.cv.forEach(function (o) { if (o !== not && onRoad(o) && o.e === e && (!best || o.d < best.d)) best = o; });
    return best;
  }
  function release(g, rt) {
    if (g.ri >= g.cv.length) return;
    var c = g.cv[g.ri], outs = rt.out.S;
    for (var i = 0; i < g.cv.length; i++) {
      var o = g.cv[i];
      if (onRoad(o) && outs.indexOf(o.e) >= 0 && o.d < GAP) return;
    }
    c.st = "r";
    c.e = wayOut(g, rt, "S"); c.d = 0;
    place(c, rt);
    g.ri++;
  }
  function hit(g, rt, m, ms, c, dmg) {
    if (c.sh > 0) { g.ev.push({ e: "block", c: c.id }); return; }
    var st = stats(c);
    c.hp = Math.max(0, c.hp - dmg * DIFF[g.diff].dmg * st.ar);
    g.ev.push({ e: "hit", c: c.id, x: c.x, y: c.y });
    if (st.scare) ms.st = Math.max(ms.st, st.scare);
  }
  // Machine i aims: a straw cart in reach first, else the cart with
  // goods that has come furthest.
  function aim(g, rt, i) {
    var m = rt.M[i], M = MACHINES[m.k], sees = looked(g, rt, i), best = null, bs = false;
    g.cv.forEach(function (c) {
      if (!onRoad(c) || c.hp <= 0 || dist2(c, m) > M.r * M.r + EPS) return;
      if (!sees && inSmoke(g, c)) return;
      var straw = !isGoods(c);
      if (!best || (straw && !bs) || (straw === bs && c.tr > best.tr)) { best = c; bs = straw; }
    });
    return best;
  }
  function fire(g, rt) {
    for (var i = 0; i < rt.M.length; i++) {
      var m = rt.M[i], M = MACHINES[m.k], ms = g.mc[i];
      if (!active(g, m) || !M.dmg) continue;
      if (ms.st > 0) { ms.st--; continue; }
      if (ms.cd > 0) { ms.cd--; continue; }
      var sees = looked(g, rt, i);
      if (!sees && inSmoke(g, m)) continue;
      var c = aim(g, rt, i);
      if (!c) continue;
      if (M.sp) {
        g.ev.push({ e: "puff", m: i, x: c.x, y: c.y });
        g.cv.forEach(function (o) {
          if (onRoad(o) && o.hp > 0 && dist2(o, c) <= M.sp * M.sp + EPS) hit(g, rt, m, ms, o, M.dmg);
        });
      } else {
        g.ev.push({ e: "swing", m: i });
        hit(g, rt, m, ms, c, M.dmg);
      }
      ms.cd = sees ? Math.round(M.cd / LOOK_RATE) : M.cd;
    }
  }
  function mend(g) {
    g.cv.forEach(function (c) {
      if (!onRoad(c) || c.k !== "mender") return;
      var st = stats(c);
      g.cv.forEach(function (o) {
        if (o === c || !onRoad(o) || !isGoods(o) || o.hp <= 0) return;
        var cap = stats(o).cap;
        if (o.hp < cap && dist2(o, c) <= st.mr * st.mr + EPS) o.hp = Math.min(cap, o.hp + st.rate / TPS);
      });
    });
  }
  function muddy(g, rt, c) {
    for (var i = 0; i < rt.M.length; i++) {
      var m = rt.M[i];
      if (MACHINES[m.k].mud && active(g, m) && dist2(c, m) <= MACHINES[m.k].r * MACHINES[m.k].r + EPS) return true;
    }
    return false;
  }
  function move(g, rt) {
    var order = g.cv.filter(onRoad).sort(function (a, b) { return b.tr - a.tr || g.cv.indexOf(a) - g.cv.indexOf(b); });
    order.forEach(function (c) {
      var v = stats(c).v * (muddy(g, rt, c) ? MUD_SLOW : 1) / TPS;
      var edge = rt.E[c.e], lim = Infinity, a = ahead(g, c);
      if (a) lim = a.d - GAP;
      else if (edge.b !== "M") {
        // the last cart on the stretch after the next fork or junction
        var r = rearOn(g, wayOut(g, rt, edge.b), c);
        if (r) lim = edge.len + r.d - GAP;
      }
      var nd = Math.max(c.d, Math.min(c.d + v, lim));
      c.tr += nd - c.d;
      c.d = nd;
      if (c.d >= edge.len - EPS) {
        var over = c.d - edge.len;
        if (edge.b === "M") {
          c.st = "d";
          var n = Math.floor(c.hp + 1e-6);
          if (isGoods(c)) { g.got += n; g.tg += n; }
          c.x = rt.P.M.x; c.y = rt.P.M.y;
          g.ev.push({ e: "home", c: c.id, n: isGoods(c) ? n : 0 });
          return;
        }
        c.e = wayOut(g, rt, edge.b);
        c.d = 0;
        var a2 = ahead(g, c);
        c.d = Math.max(0, Math.min(over, a2 ? a2.d - GAP : over));
      }
      place(c, rt);
    });
  }
  function step(g) {
    if (g.over >= 0 || g.ph !== "go") return;
    var rt = ROUTE[g.rt];
    g.t++;
    release(g, rt);
    g.sm = g.sm.filter(function (s) { s.t--; return s.t > 0; });
    g.cv.forEach(function (c) { if (c.sh > 0) c.sh--; });
    fire(g, rt);
    mend(g);
    // emptied carts walk home, burnt straw is gone
    g.cv.forEach(function (c) {
      if (!onRoad(c) || c.hp > 1e-6) return;
      c.hp = 0;
      c.st = isGoods(c) ? "h" : "x";
      g.ev.push({ e: c.st === "h" ? "back" : "burnt", c: c.id, x: c.x, y: c.y });
    });
    move(g, rt);
    if (g.ri >= g.cv.length && !g.cv.some(onRoad)) endTrip(g, rt);
  }
  function endTrip(g, rt) {
    var pay = g.tg * PAY + TRIP_PAY;
    g.coins += pay;
    g.ev.push({ e: "trip", n: g.trip, got: g.tg, c: pay });
    if (g.trip >= g.nt) {
      g.over = g.got >= g.goal ? 1 : 0;
      g.ev.push({ e: g.over ? "won" : "lost", stars: stars(g) });
      return;
    }
    g.trip++;
    g.ph = "plan";
    g.cv = g.cv.filter(function (c) { return c.st !== "x"; });
    g.cv.forEach(fresh);
    g.tk.s = Math.max(1, g.tk.s); g.tk.w = Math.max(1, g.tk.w);
    if (rt.hasGoat) g.tk.c = Math.max(1, g.tk.c);
    g.goat = 0;
    rt.forks.forEach(function (n) { if (rt.E[rt.out[n][g.sg[n]]].goat) g.sg[n] = firstOpen(rt, n, false); });
    g.sm = [];
    g.mc = machinesState(rt);
    g.ri = 0;
  }
  function run(g, ticks) { for (var i = 0; i < ticks && g.over < 0 && g.ph === "go"; i++) step(g); }

  function stars(g) {
    if (g.over !== 1) return 0;
    var r = g.load ? g.got / g.load : 0;
    return r >= 0.85 ? 3 : r >= 0.65 ? 2 : 1;
  }
  // Machines that are new on this trip (indexes), for the plan screen.
  function newMachines(g) {
    var rt = ROUTE[g.rt], out = [];
    rt.M.forEach(function (m, i) { if (m.t === g.trip) out.push(i); });
    return out;
  }
  function activeMachines(g) {
    var rt = ROUTE[g.rt], out = [];
    rt.M.forEach(function (m, i) { if (active(g, m)) out.push(i); });
    return out;
  }
  // The edges the signs send a cart along now, from the gate to the market.
  function wayNow(g) {
    var rt = ROUTE[g.rt], out = [], n = "S";
    for (var k = 0; k < rt.E.length + 1 && n !== "M"; k++) {
      var e = wayOut(g, rt, n);
      out.push(e);
      n = rt.E[e].b;
    }
    return out;
  }
  function loaded(g) {
    return g.cv.reduce(function (n, c) { return n + (isGoods(c) ? stats(c).cap : 0); }, 0);
  }

  // ---------- Session: the route in progress ----------
  function num(v, lo, hi) { return typeof v === "number" && isFinite(v) && v >= lo && v <= hi; }
  function int(v, lo, hi) { return num(v, lo, hi) && Math.floor(v) === v; }
  var STATES = ["q", "r", "d", "h", "x"];
  // A copy that can be trusted, or null (unreadable or from another version).
  function normalizeRun(x) {
    if (!x || typeof x !== "object" || x.v !== V || !ROUTE[x.rt] || !DIFF[x.diff]) return null;
    var rt = ROUTE[x.rt], BIG = 1e9, i;
    if (!int(x.u, 1, 4) || !int(x.t, 0, BIG) || (x.ph !== "plan" && x.ph !== "go") || !int(x.trip, 1, TRIPS) ||
        x.nt !== TRIPS || !num(x.coins, 0, BIG) || !int(x.got, 0, BIG) || !int(x.load, 0, BIG) || x.got > x.load ||
        !int(x.tg, 0, BIG) || x.goal !== rt.goal || !Array.isArray(x.cv) || x.cv.length > MAX_CARTS ||
        !x.sg || typeof x.sg !== "object" || !x.tk || typeof x.tk !== "object" || (x.goat !== 0 && x.goat !== 1) ||
        !Array.isArray(x.sm) || x.sm.length > 99 || !Array.isArray(x.mc) || x.mc.length !== rt.M.length ||
        !int(x.ri, 0, MAX_CARTS) || x.ri > x.cv.length || !int(x.nid, 1, BIG) || [-1, 0, 1].indexOf(x.over) < 0 ||
        !int(x.acts, 0, BIG)) return null;
    if (!int(x.tk.s, 0, 99) || !int(x.tk.w, 0, 99) || !int(x.tk.c, 0, 99) || (!rt.hasGoat && x.tk.c)) return null;
    var g = { v: V, rt: x.rt, diff: x.diff, u: x.u, t: x.t, ph: x.ph, trip: x.trip, nt: TRIPS, coins: x.coins,
              got: x.got, load: x.load, tg: x.tg, goal: rt.goal, cv: [], sg: {}, tk: { s: x.tk.s, w: x.tk.w, c: x.tk.c },
              goat: x.goat, sm: [], mc: [], ri: x.ri, nid: x.nid, over: x.over, acts: x.acts, ev: [] };
    for (i = 0; i < rt.forks.length; i++) {
      var n = rt.forks[i], j = x.sg[n];
      if (!int(j, 0, rt.out[n].length - 1) || (rt.E[rt.out[n][j]].goat && !x.goat)) return null;
      g.sg[n] = j;
    }
    for (i = 0; i < x.sm.length; i++) {
      var s = x.sm[i];
      if (!s || !num(s.x, 0, COLS) || !num(s.y, 0, ROWS) || !int(s.t, 1, SMOKE_T)) return null;
      g.sm.push({ x: s.x, y: s.y, t: s.t });
    }
    for (i = 0; i < x.mc.length; i++) {
      var m = x.mc[i];
      if (!m || !int(m.cd, 0, 9999) || !int(m.st, 0, 9999)) return null;
      g.mc.push({ cd: m.cd, st: m.st });
    }
    var ids = {};
    for (i = 0; i < x.cv.length; i++) {
      var c = x.cv[i];
      if (!c || !CARTS[c.k] || !int(c.id, 1, x.nid - 1) || ids[c.id] || !int(c.l, 1, 3) ||
          (c.l === 3 ? (c.b !== "a" && c.b !== "b") : c.b !== "") || !num(c.sp, 0, BIG) || !num(c.fr, 0, c.sp) ||
          STATES.indexOf(c.st) < 0 || !int(c.e, -1, rt.E.length - 1) || !int(c.sh, 0, SHIELD_T) ||
          !num(c.tr, 0, BIG)) return null;
      ids[c.id] = 1;
      // the same key order as hire + fresh, so a copy writes the same
      var cc = { id: c.id, k: c.k, l: c.l, b: c.b, sp: c.sp, fr: c.fr, st: c.st, e: c.e, d: 0, tr: c.tr, sh: c.sh,
                 hp: 0, x: -1, y: -1 };
      var cap = stats(cc).cap;
      if (!num(c.hp, 0, cap)) return null;
      cc.hp = c.hp;
      if (c.st === "r") {
        if (c.e < 0 || !num(c.d, 0, rt.E[c.e].len)) return null;
        cc.d = c.d;
        place(cc, rt);
      } else if (c.e !== -1 && c.st === "q") return null;
      else if (c.st !== "q") { cc.e = c.e; cc.x = num(c.x, -1, COLS) ? c.x : -1; cc.y = num(c.y, -1, ROWS) ? c.y : -1; }
      if (g.ph === "plan" && c.st !== "q") return null;
      g.cv.push(cc);
    }
    // the released carts are the first ri ones
    for (i = 0; i < g.cv.length; i++) if ((i < g.ri) === (g.cv[i].st === "q")) return null;
    return g;
  }
  // The session as written: no events.
  function saveable(g) {
    var c = JSON.parse(JSON.stringify(g));
    delete c.ev;
    return c;
  }

  // ---------- Progress (the synced slice "caravan", oros-caravan-data) ----------
  // { ver, br, maps: { "<route>": { b, s: best stars 0-3, e: best Endless } },
  //   rows: { "<device id>": { b, s: { "<diff>": [routes, won] }, f: crates delivered } } }
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
        if (!ROUTE[id]) return;
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
  // A route ended on this device: count it and keep the best stars.
  function record(d, device, g, now) {
    var out = merge(d, d);
    var row = out.rows[device] || { b: out.br, s: {}, f: 0 };
    var v = row.s[g.diff] ? row.s[g.diff].slice() : [0, 0];
    v[0]++;
    if (g.over === 1) v[1]++;
    row.s[g.diff] = v;
    row.f += g.got;
    out.rows[device] = row;
    var m = out.maps[g.rt];
    var st = stars(g);
    if (st && (!m || st > m.s)) out.maps[g.rt] = { b: m ? m.b : Math.max(out.br, now || 0), s: st, e: m ? m.e : 0 };
    return merge(out, out);
  }
  function starsOf(d, id) { var m = d && d.maps && d.maps[id]; return m ? m.s : 0; }
  function isOpen(d, id) {
    var rt = ROUTE[id];
    return !!rt && (rt.idx === 0 || starsOf(d, ROUTES[rt.idx - 1].id) > 0);
  }

  function clone(x) { return JSON.parse(JSON.stringify(x)); }

  var api = {
    V: V, COLS: COLS, ROWS: ROWS, TPS: TPS, GAP: GAP, DIFFS: DIFFS, DIFF: DIFF, CARTS: CARTS, KINDS: KINDS,
    MACHINES: MACHINES, MKINDS: MKINDS, ROUTES: ROUTES, ROUTE: ROUTE, MAX_CARTS: MAX_CARTS, TRIPS: TRIPS,
    TRICK_COST: TRICK_COST, SMOKE_R: SMOKE_R, PAY: PAY, TRIP_PAY: TRIP_PAY,
    pointAt: pointAt, stats: stats, isGoods: isGoods, hireCost: hireCost, upCost: upCost, sellValue: sellValue,
    unlocked: unlocked, cartById: cartById, newRun: newRun, whyNot: whyNot, hire: hire, upgrade: upgrade,
    sell: sell, moveCart: moveCart, buyTrick: buyTrick, flip: flip, setSign: setSign, smoke: smoke,
    shield: shield, shortcut: shortcut, canSetOff: canSetOff, setOff: setOff, step: step, run: run,
    stars: stars, newMachines: newMachines, activeMachines: activeMachines, wayNow: wayNow, loaded: loaded,
    looked: looked, normalizeRun: normalizeRun, saveable: saveable,
    defaultData: defaultData, merge: merge, record: record, starsOf: starsOf, isOpen: isOpen, clone: clone
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.CaravanEngine = api;
})(typeof window !== "undefined" ? window : this);
