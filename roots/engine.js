// ============================================================
// orOS Roots — rules engine (v1.2.0)
// NOT the UI: no DOM, no storage. Loaded by roots/index.html
// (window.RootsEngine) and by tests/roots.test.js (module.exports).
//
// A turn-based growing game on a 7 × 9 board: an old tree grows a
// network of roots under the ground to reach springs and minerals, and
// buds on the surface that open into leaves and flowers. Pests come in
// at the edges; every one shows what it will do before it acts. What is
// cut off from the trunk gives nothing and withers after 2 turns unless
// it is joined again. Original rules, numbers and names (plan:
// /mnt/project-files/games/strategy/roots-plan.md, Bible Part IX "Roots").
//
// State (plain JSON, kept as is in the device-local session):
//   { v: 1, seed, diff "m" Mild | "h" Hardy, sea season 1-3, sap,
//     t: [63 tiles], r: [63 root 0 none | 1 thin | 2 thick], th: [63 thorn 0|1],
//     cut: [63 turns left before a cut root withers, 0 = joined],
//     bk: [63 surface 0 | 1 leaf bud | 2 flower bud | 3 leaf | 4 flower], ba: [63 bud turns left],
//     bloom: [bloom of each season played], best (longest root), phase "play" | "rest",
//     res: null | { b bloom, q quota }, s: season, acts, over: -1 | 0 a quota missed | 1 the year done,
//     one: 1 (a Daily glade, 5.91.00: this season only, always Hardy; absent in a year),
//     gl glade 1-4, end the glades in the year, pts the points of the glades
//     left behind (springs + longest root), 5.92.00; absent = a one-glade
//     year on the meadow (a session from before) }
//   season = { turn 1-T, q quota, u: [pest], nid, next: [{ k, at }], sched: [T + 1 lists], rw rewinds left, r rng, done 0|1 }
//   pest = { id, k, at, hp, lt turns left (blight 99), it: intent | null }
//   tiles: T trunk, a surface, . soil, # stone, w spring, m mineral, c clay.
//   tile = y × 7 + x; row 0 is the surface, the base root under the trunk never breaks.
// ============================================================
(function (root) {
  "use strict";

  var W = 7, H = 9, SIZE = W * H, T = 6, SEASONS = 3, TRUNK = 3, BASE = 10;
  var DIFFS = ["m", "h"];
  var QUOTA = { m: 0.6, h: 0.8 };
  var COST = { root: 1, clay: 2, thick: 2, thorn: 3, bud: 2 };
  var MAX_SAP = 20, START_SAP = 5, CUT_TURNS = 2, BUD_TURNS = 2, MAX_PESTS = 24, BIG = 1e9;
  var PESTS = {
    beetle: { hp: 2, mv: 2, lt: 3 },
    mole:   { hp: 3, mv: 3, lt: 2 },
    aphid:  { hp: 1, mv: 3, lt: 3 },
    blight: { hp: 1, mv: 0, lt: 99 }
  };
  var PEST_IDS = Object.keys(PESTS);
  // arrivals per season: [kind, count Mild, count Hardy, first turn]
  var WAVES = [
    [["beetle", 3, 4, 1], ["aphid", 2, 3, 2]],
    [["beetle", 3, 4, 1], ["mole", 2, 3, 2], ["aphid", 2, 3, 2]],
    [["beetle", 3, 4, 1], ["mole", 2, 2, 2], ["aphid", 2, 3, 2], ["blight", 1, 2, 1]]
  ];
  // The four glades of a year (5.92.00): the soil (stones, the rows the
  // springs may lie in, minerals, clay) and the arrivals of each season.
  // The meadow is the glade of 5.88.00, so a code still plays the same
  // first glade.
  var GLADES = [
    { id: "meadow", st: 7, sp: [4, 5, 6], mi: 4, cl: 5, wv: WAVES },
    { id: "river", st: 4, sp: [3, 4, 5, 6, 7], mi: 2, cl: 8, wv: [
      [["beetle", 2, 3, 1], ["aphid", 3, 4, 2], ["mole", 1, 2, 2]],
      [["mole", 3, 4, 1], ["aphid", 3, 3, 2], ["beetle", 1, 2, 2]],
      [["mole", 3, 3, 1], ["aphid", 2, 3, 2], ["blight", 1, 1, 2]]] },
    { id: "hill", st: 12, sp: [5, 7], mi: 7, cl: 3, wv: [
      [["beetle", 4, 5, 1], ["aphid", 1, 2, 3]],
      [["beetle", 4, 5, 1], ["mole", 1, 1, 3], ["aphid", 2, 2, 2]],
      [["beetle", 4, 5, 1], ["mole", 1, 2, 2], ["blight", 1, 2, 1]]] },
    { id: "forest", st: 6, sp: [4, 5, 6], mi: 4, cl: 4, wv: [
      [["beetle", 3, 4, 1], ["blight", 1, 1, 2], ["aphid", 2, 2, 2]],
      [["beetle", 3, 3, 1], ["mole", 2, 3, 2], ["aphid", 2, 3, 2], ["blight", 1, 1, 1]],
      [["beetle", 3, 4, 1], ["mole", 2, 2, 2], ["aphid", 2, 3, 2], ["blight", 2, 2, 1]]] }
  ];
  var GLADE_IDS = GLADES.map(function (g) { return g.id; });
  var DX = [0, 1, 0, -1], DY = [-1, 0, 1, 0];

  // ---------- Random numbers (no Math.random, no clock) ----------
  function hashStr(s) {
    var h = 0x811c9dc5;
    s = String(s);
    for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
    return h >>> 0;
  }
  function rnd(o) {
    var x = o.s >>> 0 || 0x9e3779b9;
    x ^= x << 13; x >>>= 0; x ^= x >>> 17; x ^= x << 5; x >>>= 0;
    o.s = x;
    return x / 4294967296;
  }
  function rint(o, n) { return Math.floor(rnd(o) * n); }
  function isInt(v) { return typeof v === "number" && isFinite(v) && Math.floor(v) === v; }

  // ---------- The board ----------
  function step(i, d) {
    var x = i % W + DX[d], y = Math.floor(i / W) + DY[d];
    return x < 0 || y < 0 || x >= W || y >= H ? -1 : y * W + x;
  }
  function soil(t, i) { return Math.floor(i / W) >= 1 && t[i] !== "#"; }
  function surface(i) { return i >= 0 && i < W && i !== TRUNK; }
  function pestAt(s, i) {
    for (var k = 0; k < s.u.length; k++) if (s.u[k].at === i) return s.u[k];
    return null;
  }
  function pestById(s, id) {
    for (var k = 0; k < s.u.length; k++) if (s.u[k].id === id) return s.u[k];
    return null;
  }
  // The roots joined to the trunk: BFS from the base root.
  function joined(st) {
    var on = [], q = [BASE], i, d, n;
    for (i = 0; i < SIZE; i++) on.push(0);
    on[BASE] = 1;
    while (q.length) {
      i = q.shift();
      for (d = 0; d < 4; d++) {
        n = step(i, d);
        if (n >= 0 && !on[n] && st.r[n] > 0) { on[n] = 1; q.push(n); }
      }
    }
    return on;
  }
  // The farthest root from the trunk along the network (the longest root).
  function longest(st) {
    var dist = [], q = [BASE], i, d, n, top = 0;
    for (i = 0; i < SIZE; i++) dist.push(-1);
    dist[BASE] = 0;
    while (q.length) {
      i = q.shift();
      top = Math.max(top, dist[i]);
      for (d = 0; d < 4; d++) {
        n = step(i, d);
        if (n >= 0 && dist[n] < 0 && st.r[n] > 0) { dist[n] = dist[i] + 1; q.push(n); }
      }
    }
    return top;
  }
  function springs(st, on) {
    on = on || joined(st);
    var n = 0;
    for (var i = 0; i < SIZE; i++) if (on[i] && st.t[i] === "w") n++;
    return n;
  }
  function income(st, on) {
    on = on || joined(st);
    var n = 2, i;
    for (i = 0; i < SIZE; i++) {
      if (!on[i]) continue;
      if (st.t[i] === "w") n += 2;
      else if (st.t[i] === "m") n += 1;
    }
    for (i = 0; i < W; i++) if (st.bk[i] === 3 && on[i + W]) n += 1;
    return n;
  }
  function flowers(st) {
    var n = 0;
    for (var i = 0; i < W; i++) if (st.bk[i] === 4) n++;
    return n;
  }
  function bloomOf(st) { return flowers(st) + springs(st); }

  // ---------- Layout of a glade (from the year code) ----------
  function reachable(t) {
    var seen = {}, q = [BASE], n = 0;
    seen[BASE] = 1;
    while (q.length) {
      var i = q.shift();
      n++;
      for (var d = 0; d < 4; d++) {
        var x = step(i, d);
        if (x >= 0 && !seen[x] && soil(t, x)) { seen[x] = 1; q.push(x); }
      }
    }
    return seen;
  }
  function gladeOf(st) { return GLADES[(st.gl || 1) - 1]; }
  function layout(seed, gl) {
    var G = GLADES[(gl || 1) - 1];
    for (var salt = 0; ; salt++) {
      var r = { s: hashStr(seed + ((gl || 1) > 1 ? ":glade" + gl + ":" : ":glade:") + salt) }, t = [], i, k, free = [];
      for (i = 0; i < SIZE; i++) t.push(i < W ? (i === TRUNK ? "T" : "a") : ".");
      for (i = 2 * W; i < SIZE; i++) if (i !== BASE) free.push(i);
      var take = function (pred) {
        var c = free.filter(pred);
        if (!c.length) return -1;
        var at = c[rint(r, c.length)];
        free.splice(free.indexOf(at), 1);
        return at;
      };
      var row = function (i2) { return Math.floor(i2 / W); };
      for (k = 0; k < G.st; k++) t[take(function (x) { return row(x) >= 2; })] = "#";
      G.sp.forEach(function (lo) { t[take(function (x) { return row(x) >= lo; })] = "w"; });
      for (k = 0; k < G.mi; k++) t[take(function (x) { return row(x) >= 2; })] = "m";
      for (k = 0; k < G.cl; k++) t[take(function (x) { return row(x) >= 3; })] = "c";
      var seen = reachable(t), ok = true;
      for (i = W; i < SIZE; i++) if (t[i] !== "#" && !seen[i]) ok = false;
      if (ok || salt > 50) return t;
    }
  }

  // ---------- Pests: what each one will do ----------
  function walkable(st, s, i, k) {
    if (i < 0) return false;
    if (k === "aphid") return surface(i);
    return soil(st.t, i);
  }
  // Shortest steps from a pest to every tile it can walk (others block).
  function paths(st, s, u) {
    var dist = {}, from = {}, q = [u.at];
    dist[u.at] = 0;
    while (q.length) {
      var i = q.shift();
      for (var d = 0; d < 4; d++) {
        var n = step(i, d);
        if (!walkable(st, s, n, u.k) || dist[n] !== undefined) continue;
        var o = pestAt(s, n);
        if (o && o !== u) continue;
        dist[n] = dist[i] + 1;
        from[n] = i;
        q.push(n);
      }
    }
    return { dist: dist, from: from };
  }
  // The tile reached after at most mv steps toward goal on the path.
  function walkTo(p, start, goal, mv) {
    var line = [], i = goal;
    while (i !== undefined && i !== start) { line.unshift(i); i = p.from[i]; }
    return line.length ? line[Math.min(mv, line.length) - 1] : start;
  }
  function think(st, s, u) {
    var P = PESTS[u.k], i, best = -1, bd = BIG, p, d;
    if (u.k === "blight") {
      // spreads to a thin root next to it (the one nearest the trunk), else creeps toward a root
      for (d = 0; d < 4; d++) {
        var n = step(u.at, d);
        if (n < 0 || !soil(st.t, n) || pestAt(s, n)) continue;
        var score = st.r[n] === 1 && !st.th[n] ? Math.abs(n % W - BASE % W) + Math.floor(n / W) : BIG / 2 + nearRoot(st, n);
        if (n === BASE || st.r[n] === 2 || st.th[n]) continue;
        if (score < bd) { bd = score; best = n; }
      }
      return best >= 0 ? { a: "spread", to: best } : null;
    }
    p = paths(st, s, u);
    if (u.k === "mole") {
      // digs the straight line with the most roots in it
      var top = -1, td = 0;
      for (d = 0; d < 4; d++) {
        var c = 0, x = u.at;
        for (var k = 0; k < P.mv; k++) {
          x = step(x, d);
          if (x < 0 || !soil(st.t, x)) break;
          if (st.r[x] && x !== BASE) c++;
        }
        if (c > top) { top = c; td = d; }
      }
      return { a: "dig", d: td };
    }
    if (u.k === "aphid") {
      for (i = 0; i < W; i++) {
        if (st.bk[i] !== 1 && st.bk[i] !== 2) continue;
        var di = i === u.at ? 0 : p.dist[i];
        if (di === undefined) continue;
        if (di < bd || (di === bd && i < best)) { bd = di; best = i; }
      }
      if (best < 0) return { a: "walk", to: walkTo(p, u.at, nearestSurfaceTo(p, u.at, TRUNK), P.mv), e: -1 };
      var to = bd <= P.mv ? best : walkTo(p, u.at, best, P.mv);
      return { a: "eat", to: to, e: to === best ? best : -1 };
    }
    // beetle: walks to a root next to it and chews it
    for (i = W; i < SIZE; i++) {
      if (!st.r[i] || i === BASE) continue;
      // the tile it bites from: the root tile itself
      var dd = i === u.at ? 0 : p.dist[i];
      if (dd === undefined) continue;
      if (dd < bd || (dd === bd && i < best)) { bd = dd; best = i; }
    }
    if (best < 0) return { a: "walk", to: walkTo(p, u.at, nearestTo(p, u.at, BASE), P.mv), b: -1 };
    if (bd <= P.mv) return { a: "chew", to: best, b: best };
    return { a: "chew", to: walkTo(p, u.at, best, P.mv), b: -1 };
  }
  function nearRoot(st, i) {
    var b = BIG;
    for (var k = W; k < SIZE; k++) if (st.r[k]) b = Math.min(b, Math.abs(k % W - i % W) + Math.abs(Math.floor(k / W) - Math.floor(i / W)));
    return b;
  }
  function nearestTo(p, start, goal) {
    var best = start, bd = BIG;
    Object.keys(p.dist).forEach(function (k) {
      var i = +k, d = Math.abs(i % W - goal % W) + Math.abs(Math.floor(i / W) - Math.floor(goal / W));
      if (d < bd || (d === bd && i < best)) { bd = d; best = i; }
    });
    return best;
  }
  function nearestSurfaceTo(p, start, goal) { return nearestTo(p, start, goal); }
  function reveal(st, s) { s.u.forEach(function (u) { u.it = think(st, s, u); }); }

  // ---------- Turn order ----------
  function note(ev, e) { if (ev) ev.push(e); }
  function hurtRoot(st, i, ev) {
    if (i === BASE || !st.r[i]) return;
    if (st.r[i] === 2) { st.r[i] = 1; note(ev, { k: "thin", at: i }); return; }
    st.r[i] = 0; st.th[i] = 0; st.cut[i] = 0;
    note(ev, { k: "lost", at: i });
  }
  function thornPower(st, i) {
    var p = st.t[i] === "m" ? 2 : 1;
    for (var d = 0; d < 4; d++) { var n = step(i, d); if (n >= 0 && st.t[n] === "m") p = 2; }
    return p;
  }
  function thorns(st, s, on, ev) {
    for (var i = W; i < SIZE; i++) {
      if (!st.th[i] || !st.r[i] || !on[i]) continue;
      var hit = [i];
      for (var d = 0; d < 4; d++) { var n = step(i, d); if (n >= 0) hit.push(n); }
      var pw = thornPower(st, i);
      hit.forEach(function (j) {
        var u = pestAt(s, j);
        if (!u) return;
        u.hp -= pw;
        note(ev, { k: "thorn", at: j, n: pw, p: u.k });
        if (u.hp <= 0) { s.u.splice(s.u.indexOf(u), 1); note(ev, { k: "gone", at: j, p: u.k }); }
      });
    }
  }
  function pestAct(st, s, u, ev) {
    var it = u.it;
    if (!it) return;
    if (it.a === "spread") {
      if (it.to < 0 || pestAt(s, it.to) || it.to === BASE || st.r[it.to] === 2 || st.th[it.to]) return;
      if (s.u.length >= MAX_PESTS) return;
      if (st.r[it.to]) { st.r[it.to] = 0; st.cut[it.to] = 0; note(ev, { k: "lost", at: it.to }); }
      s.u.push({ id: s.nid++, k: "blight", at: it.to, hp: PESTS.blight.hp, lt: PESTS.blight.lt, it: null });
      note(ev, { k: "spread", at: it.to });
      return;
    }
    if (it.a === "dig") {
      for (var k = 0; k < PESTS.mole.mv; k++) {
        var x = step(u.at, it.d);
        if (x < 0 || !soil(st.t, x) || pestAt(s, x)) break;
        u.at = x;
        hurtRoot(st, x, ev);
      }
      note(ev, { k: "dig", at: u.at });
      return;
    }
    var to = it.to;
    if (to !== u.at && !pestAt(s, to) && walkable(st, s, to, u.k)) { note(ev, { k: "walk", from: u.at, at: to, p: u.k }); u.at = to; }
    if (it.a === "chew" && it.b >= 0 && u.at === it.b) hurtRoot(st, it.b, ev);
    if (it.a === "eat" && it.e >= 0 && u.at === it.e && (st.bk[it.e] === 1 || st.bk[it.e] === 2)) {
      st.bk[it.e] = 0; st.ba[it.e] = 0;
      note(ev, { k: "eaten", at: it.e });
    }
  }
  function entryTiles(st, s, k, taken) {
    var out = [];
    for (var i = 0; i < SIZE; i++) {
      var x = i % W, y = Math.floor(i / W);
      if (pestAt(s, i) || taken.indexOf(i) >= 0) continue;
      if (k === "aphid") { if (y === 0 && (x === 0 || x === W - 1)) out.push(i); continue; }
      if (!soil(st.t, i) || st.r[i] || y < 2) continue;
      if (x === 0 || x === W - 1 || y === H - 1) out.push(i);
    }
    return out;
  }
  function pickNext(st, s, kinds) {
    s.next = [];
    kinds.forEach(function (k) {
      var at = entryTiles(st, s, k, s.next.map(function (e) { return e.at; }));
      if (at.length) s.next.push({ k: k, at: at[rint(s.r, at.length)] });
    });
  }
  function withRng(s, fn) {
    var ro = { s: s.r };
    s.r = ro;
    try { return fn(); } finally { s.r = ro.s; }
  }
  // End turn: thorns, the pests in order, cut roots, buds, frost, arrivals, sap.
  function endTurnS(st, s, ev) {
    var on = joined(st), i;
    thorns(st, s, on, ev);
    s.u.slice().sort(function (a, b) { return a.id - b.id; }).forEach(function (u) {
      if (s.u.indexOf(u) < 0) return;
      pestAct(st, s, u, ev);
    });
    s.u = s.u.filter(function (u) {
      if (u.k === "blight") return true;
      u.lt--;
      if (u.lt <= 0) note(ev, { k: "leave", at: u.at, p: u.k });
      return u.lt > 0;
    });
    on = joined(st);
    for (i = W; i < SIZE; i++) {
      if (!st.r[i] || on[i]) { st.cut[i] = 0; continue; }
      if (!st.cut[i]) { st.cut[i] = CUT_TURNS; note(ev, { k: "cut", at: i }); continue; }
      st.cut[i]--;
      if (!st.cut[i]) { st.r[i] = 0; st.th[i] = 0; note(ev, { k: "wither", at: i }); }
    }
    for (i = 0; i < W; i++) {
      if ((st.bk[i] === 1 || st.bk[i] === 2) && on[i + W]) {
        st.ba[i]--;
        if (st.ba[i] <= 0) { st.bk[i] += 2; st.ba[i] = 0; note(ev, { k: "open", at: i, f: st.bk[i] === 4 ? 1 : 0 }); }
      }
    }
    if (frost(st, s)) {
      for (i = 0; i < W; i++) {
        if (st.bk[i] !== 1 && st.bk[i] !== 2) continue;
        var l = i > 0 && st.bk[i - 1] === 3, r = i < W - 1 && st.bk[i + 1] === 3;
        if (!l && !r) { st.bk[i] = 0; st.ba[i] = 0; note(ev, { k: "frost", at: i }); }
      }
    }
    s.next.forEach(function (e) {
      if (pestAt(s, e.at) || s.u.length >= MAX_PESTS) return;
      s.u.push({ id: s.nid++, k: e.k, at: e.at, hp: PESTS[e.k].hp, lt: PESTS[e.k].lt, it: null });
      note(ev, { k: "enter", at: e.at, p: e.k });
    });
    s.next = [];
    if (s.turn >= T) { s.done = 1; return; }
    s.turn++;
    st.sap = Math.min(MAX_SAP, st.sap + income(st));
    withRng(s, function () { pickNext(st, s, s.sched[s.turn]); });
    reveal(st, s);
  }
  // Frost: the last two turns of autumn, after the buds grow.
  function frost(st, s) { return st.sea === SEASONS && s.turn >= T - 1; }

  // ---------- Actions ----------
  function rootOk(st, s, i, on) {
    if (i < W || i >= SIZE || !soil(st.t, i) || st.r[i] || pestAt(s, i)) return false;
    on = on || joined(st);
    for (var d = 0; d < 4; d++) { var n = step(i, d); if (n >= 0 && st.r[n] && on[n]) return true; }
    return false;
  }
  function rootCost(st, i) { return st.t[i] === "c" ? COST.clay : COST.root; }
  function options(st) {
    var s = st.s, out = [], on = joined(st), i;
    if (st.phase !== "play" || s.done || st.over >= 0) return out;
    for (i = W; i < SIZE; i++) {
      if (rootOk(st, s, i, on) && st.sap >= rootCost(st, i)) out.push({ t: "root", at: i });
      if (st.r[i] === 1 && i !== BASE && st.sap >= COST.thick) out.push({ t: "thick", at: i });
      if (st.r[i] && !st.th[i] && i !== BASE && on[i] && st.sap >= COST.thorn) out.push({ t: "thorn", at: i });
    }
    for (i = 0; i < W; i++) {
      if (surface(i) && !st.bk[i] && on[i + W] && !pestAt(s, i) && st.sap >= COST.bud) {
        out.push({ t: "bud", at: i, k: "l" });
        out.push({ t: "bud", at: i, k: "f" });
      }
    }
    return out;
  }
  function legal(st, a) {
    return options(st).some(function (o) { return o.t === a.t && o.at === a.at && (o.t !== "bud" || o.k === a.k); });
  }
  function act(st, a) {
    if (!a || st.over >= 0) return null;
    var s = st.s, ev = [];
    if (a.t === "root" || a.t === "thick" || a.t === "thorn" || a.t === "bud") {
      if (!legal(st, a)) return null;
      if (a.t === "root") { st.sap -= rootCost(st, a.at); st.r[a.at] = 1; st.cut[a.at] = 0; }
      else if (a.t === "thick") { st.sap -= COST.thick; st.r[a.at] = 2; }
      else if (a.t === "thorn") { st.sap -= COST.thorn; st.th[a.at] = 1; }
      else { st.sap -= COST.bud; st.bk[a.at] = a.k === "f" ? 2 : 1; st.ba[a.at] = BUD_TURNS; }
      note(ev, { k: a.t, at: a.at });
      reveal(st, s);
      st.acts++;
      return ev;
    }
    if (a.t === "end") {
      if (st.phase !== "play" || s.done) return null;
      endTurnS(st, s, ev);
      st.acts++;
      if (s.done) finishSeason(st, ev);
      return ev;
    }
    if (a.t === "next") {
      if (st.phase !== "rest" || st.over >= 0) return null;
      st.phase = "play";
      st.res = null;
      if (st.sea >= SEASONS) {
        // on to the next glade: a bare tree again; the glade left behind
        // keeps its springs and longest root in the score
        st.pts = (st.pts || 0) + springs(st) + longest(st);
        st.gl++;
        st.sea = 1;
        st.sap = START_SAP;
        st.t = layout(st.seed, st.gl);
        for (var j = 0; j < SIZE; j++) { st.r[j] = 0; st.th[j] = 0; st.cut[j] = 0; st.bk[j] = 0; st.ba[j] = 0; }
        st.r[BASE] = 2;
        st.s = makeSeason(st);
        note(ev, { k: "glade" });
        return ev;
      }
      st.sea++;
      for (var i = 0; i < W; i++) if (st.bk[i] === 4) { st.bk[i] = 0; st.ba[i] = 0; }
      st.s = makeSeason(st);
      note(ev, { k: "season" });
      return ev;
    }
    return null;
  }
  function finishSeason(st, ev) {
    var b = bloomOf(st), q = st.s.q;
    st.res = { b: b, q: q };
    st.bloom.push(b);
    st.best = Math.max(st.best, longest(st));
    note(ev, { k: "bloom", n: b, q: q });
    if (b < q) { st.over = 0; return; }
    if (st.one === 1 || (st.sea >= SEASONS && (st.gl || 1) >= (st.end || 1))) { st.over = 1; return; }
    st.phase = "rest";
  }
  // The year's score at winter: bloom of every season + springs reached +
  // the longest root, of this glade and of every glade left behind (pts).
  function score(st) {
    return st.bloom.reduce(function (a, b) { return a + b; }, 0) + springs(st) + longest(st) + (st.pts || 0);
  }

  // ---------- Seasons ----------
  function schedule(st, salt) {
    var gk = (st.gl || 1) > 1 ? ":g" + st.gl : "";
    var r = { s: hashStr(st.seed + gk + ":" + st.sea + ":" + salt) }, sched = [], k;
    for (k = 0; k <= T; k++) sched.push([]);
    gladeOf(st).wv[st.sea - 1].forEach(function (w) {
      var n = st.diff === "h" ? w[2] : w[1];
      for (var j = 0; j < n; j++) {
        // spread over the turns from the first, never on the last (it would not act)
        var turn = w[3] + rint(r, T - 1 - w[3] + 1);
        sched[Math.min(T - 1, turn)].push(w[0]);
      }
    });
    return { sched: sched, r: r.s };
  }
  function makeSeason(st) {
    var pl = schedule(st, 0);
    var s = { turn: 1, q: 1, u: [], nid: 1, next: [], sched: pl.sched, rw: st.diff === "m" ? 1 : 0, r: pl.r, done: 0 };
    st.s = s;
    withRng(s, function () { pickNext(st, s, s.sched[1]); });
    reveal(st, s);
    var got = solve(st);
    s.q = Math.max(1, Math.floor(got * QUOTA[st.diff]));
    return s;
  }
  // A bare tree on the glade of the code, before its first season.
  function bare(seed, diff, sea, gl) {
    var st = { v: 1, seed: String(seed), diff: diff, sea: sea, sap: START_SAP, t: layout(String(seed), gl),
      r: [], th: [], cut: [], bk: [], ba: [], bloom: [], best: 0, phase: "play", res: null, s: null, acts: 0, over: -1 };
    for (var i = 0; i < SIZE; i++) { st.r.push(0); st.th.push(0); st.cut.push(0); st.bk.push(0); st.ba.push(0); }
    st.r[BASE] = 2;
    st.gl = gl;
    st.end = gl;
    st.pts = 0;
    return st;
  }
  // A year: the four glades in turn, three seasons each (5.92.00).
  function newYear(seed, diff) {
    var st = bare(seed, diff, 1, 1);
    st.end = GLADES.length;
    st.s = makeSeason(st);
    return st;
  }
  // The Daily glade (5.91.00): one season on Hardy from a bare tree; the
  // glade and the season come from the code (the same for everyone that day).
  function dailyOf(seed) {
    var r = { s: hashStr(String(seed) + ":daily") };
    var sea = 1 + rint(r, SEASONS);
    return { sea: sea, gl: 1 + rint(r, GLADES.length) };
  }
  function newDaily(seed) {
    var d = dailyOf(seed), st = bare(seed, "h", d.sea, d.gl);
    st.one = 1;
    st.s = makeSeason(st);
    return st;
  }

  // ---------- The solver (the season maker, and the tests' bot) ----------
  function clone(st) { return JSON.parse(JSON.stringify(st)); }
  // How good a position looks: open and coming flowers, springs, sap,
  // and how close the network is to the next spring and to the surface.
  function value(st) {
    var on = joined(st), v = 0, i, slots = 0;
    for (i = 0; i < W; i++) {
      if (st.bk[i] === 4) v += 10;
      else if (st.bk[i] === 2 && on[i + W]) v += 7 - st.ba[i];
      else if (st.bk[i] === 3) v += 3;
      else if (st.bk[i] === 1 && on[i + W]) v += 2;
      else if (!st.bk[i] && surface(i) && on[i + W]) slots++;
    }
    v += 1.2 * Math.min(4, slots);
    v += 10 * springs(st, on) + 2 * income(st, on) + 0.3 * st.sap - 2.5 * toSpring(st, on);
    for (i = W; i < SIZE; i++) {
      if (!st.r[i]) continue;
      v += on[i] ? 0.2 + (st.r[i] === 2 ? 0.3 : 0) + (st.th[i] ? 0.6 : 0) : -0.5;
    }
    return v;
  }
  // Steps of soil from the network to the nearest spring it has not reached (0 when none is left).
  function toSpring(st, on) {
    var dist = {}, q = [], i, d, n;
    for (i = W; i < SIZE; i++) if (on[i]) { dist[i] = 0; q.push(i); }
    while (q.length) {
      i = q.shift();
      if (st.t[i] === "w" && !on[i]) return dist[i];
      for (d = 0; d < 4; d++) {
        n = step(i, d);
        if (n < 0 || dist[n] !== undefined || !soil(st.t, n)) continue;
        dist[n] = dist[i] + 1;
        q.push(n);
      }
    }
    return 0;
  }
  function lookahead(st) {
    var c = clone(st);
    endTurnS(c, c.s, null);
    return value(c);
  }
  // One turn of the greedy planner: keep taking the action that makes
  // the position after End turn look best, while it helps.
  function planTurn(st) {
    var plan = [], cur = lookahead(st);
    for (var guard = 0; guard < 12; guard++) {
      var top = null;
      options(st).forEach(function (a) {
        var c = clone(st);
        act(c, a);
        var v = lookahead(c);
        if (!top || v > top.v + 1e-9) top = { a: a, v: v };
      });
      if (!top || top.v <= cur + 0.05) break;
      act(st, top.a);
      plan.push(top.a);
      cur = top.v;
    }
    return plan;
  }
  function solve(st) {
    var c = clone(st);
    c.s.q = 0;
    while (c.over < 0 && c.phase === "play") {
      planTurn(c);
      act(c, { t: "end" });
    }
    return c.res ? c.res.b : 0;
  }
  function botTurn(st) {
    if (st.phase === "rest") { act(st, { t: "next" }); return; }
    if (st.over >= 0) return;
    planTurn(st);
    act(st, { t: "end" });
  }

  // ---------- Checks (a session from storage) ----------
  function valid(st) {
    if (!st || typeof st !== "object" || st.v !== 1 || typeof st.seed !== "string" || !/^[a-z0-9]{1,16}$/.test(st.seed)) return false;
    if (DIFFS.indexOf(st.diff) < 0 || !isInt(st.sea) || st.sea < 1 || st.sea > SEASONS || !isInt(st.sap) || st.sap < 0 || st.sap > MAX_SAP) return false;
    var arr = function (a, ok) { return Array.isArray(a) && a.length === SIZE && a.every(ok); };
    if (!arr(st.t, function (c, i) { return i < W ? c === (i === TRUNK ? "T" : "a") : ".#wmc".indexOf(c) >= 0 && c.length === 1; })) return false;
    if (!arr(st.r, function (v, i) { return isInt(v) && v >= 0 && v <= 2 && (i >= W || !v) && (!v || soil(st.t, i)); }) || st.r[BASE] !== 2) return false;
    if (!arr(st.th, function (v, i) { return (v === 0 || v === 1) && (!v || (st.r[i] && i !== BASE)); })) return false;
    if (!arr(st.cut, function (v, i) { return isInt(v) && v >= 0 && v <= CUT_TURNS && (!v || st.r[i]); })) return false;
    if (!arr(st.bk, function (v, i) { return isInt(v) && v >= 0 && v <= 4 && (!v || surface(i)); })) return false;
    if (!arr(st.ba, function (v, i) { return st.bk[i] === 1 || st.bk[i] === 2 ? isInt(v) && v >= 1 && v <= BUD_TURNS : v === 0; })) return false;
    if (st.gl === undefined ? st.end !== undefined || st.pts !== undefined
        : !isInt(st.gl) || st.gl < 1 || st.gl > GLADES.length || !isInt(st.end) || st.end < st.gl || st.end > GLADES.length ||
          !isInt(st.pts) || st.pts < 0 || st.pts > 999 || (st.one === 1 && st.end !== st.gl)) return false;
    if (!Array.isArray(st.bloom) || st.bloom.length > SEASONS * (st.end || 1) || !st.bloom.every(function (v) { return isInt(v) && v >= 0 && v <= 99; })) return false;
    if (!isInt(st.best) || st.best < 0 || st.best > SIZE || !isInt(st.acts) || st.acts < 0 || st.acts > BIG) return false;
    if (st.phase !== "play" && st.phase !== "rest") return false;
    if (st.one !== undefined && (st.one !== 1 || st.diff !== "h" || st.phase === "rest" || st.bloom.length > 1)) return false;
    if (st.over !== -1 && st.over !== 0 && st.over !== 1) return false;
    if (st.res !== null && !(st.res && isInt(st.res.b) && isInt(st.res.q))) return false;
    var s = st.s;
    if (!s || !isInt(s.turn) || s.turn < 1 || s.turn > T || !isInt(s.q) || s.q < 1 || !isInt(s.nid) || s.nid < 1 || s.nid > 9999) return false;
    if (!isInt(s.rw) || s.rw < 0 || s.rw > 1 || !isInt(s.r) || (s.done !== 0 && s.done !== 1)) return false;
    if (!Array.isArray(s.sched) || s.sched.length !== T + 1 || !s.sched.every(function (l) { return Array.isArray(l) && l.length <= 9 && l.every(function (k) { return PESTS.hasOwnProperty(k); }); })) return false;
    if (!Array.isArray(s.next) || s.next.length > 9 || !s.next.every(function (e) { return e && PESTS.hasOwnProperty(e.k) && isInt(e.at) && e.at >= 0 && e.at < SIZE; })) return false;
    var seen = {};
    if (!Array.isArray(s.u) || s.u.length > MAX_PESTS || !s.u.every(function (u) {
      if (!u || !PESTS.hasOwnProperty(u.k) || !isInt(u.id) || u.id < 1 || u.id >= s.nid || !isInt(u.at) || u.at < 0 || u.at >= SIZE || seen[u.at]) return false;
      seen[u.at] = 1;
      if (!walkable(st, s, u.at, u.k) || !isInt(u.hp) || u.hp < 1 || u.hp > PESTS[u.k].hp || !isInt(u.lt) || u.lt < 1 || u.lt > PESTS[u.k].lt) return false;
      return u.it === null || (u.it && typeof u.it === "object" && typeof u.it.a === "string");
    })) return false;
    if (st.phase === "rest" && (!s.done || st.over >= 0)) return false;
    if (st.over < 0 && st.phase === "play" && s.done) return false;
    return true;
  }

  var api = {
    W: W, H: H, SIZE: SIZE, T: T, SEASONS: SEASONS, TRUNK: TRUNK, BASE: BASE, DIFFS: DIFFS, COST: COST, MAX_SAP: MAX_SAP,
    CUT_TURNS: CUT_TURNS, BUD_TURNS: BUD_TURNS, PESTS: PESTS, PEST_IDS: PEST_IDS, WAVES: WAVES,
    GLADES: GLADES, GLADE_IDS: GLADE_IDS, gladeOf: gladeOf, layout: layout,
    hashStr: hashStr, step: step, soil: soil, surface: surface, pestAt: pestAt, pestById: pestById,
    joined: joined, longest: longest, springs: springs, income: income, flowers: flowers, bloomOf: bloomOf, frost: frost,
    newYear: newYear, dailyOf: dailyOf, newDaily: newDaily, options: options, legal: legal, act: act, score: score, rootCost: rootCost,
    valid: valid, clone: clone, solve: solve, botTurn: botTurn, planTurn: planTurn
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.RootsEngine = api;
})(typeof window !== "undefined" ? window : this);
