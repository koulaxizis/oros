// ============================================================
// orOS Lantern maze — the rules (v1.0.0), no DOM
// A tower defense game on an open grid: at night shadows slip in at
// the town gate and walk to the fountain of an old square. Crates and
// lantern towers can go on any free tile, and the shadows walk the
// maze they leave them. Shadows do not take the shortest way but the
// darkest one: every lit tile costs them extra steps. Moths do the
// opposite and look for the brightest way. Everything is a pure
// function of the state, stepped in fixed ticks of 1/60 s, so a night
// replays exactly (tests/maze.test.js).
//
// The map is a grid of 12 × 18 tiles, column c from the left, row r
// from the top; a tile's index is r × 12 + c and its centre is
// (c + 0.5, r + 0.5). Each square is drawn as text: "#" a house or
// wall, "o" a column, "w" a well (none can be built on or walked
// through), "G" a gate, "F" the fountain, "." free ground.
//
// The way (flow field): every tile has a cost of 1 + 2 × light for
// shadows (1 + 2 × (3 − light) for moths), light 0-3. dist[tile] =
// cost of the tile + the smallest dist of its four neighbours, the
// fountain 0. A shadow at a tile centre steps to the neighbour with
// the smallest dist (ties: straight on, then north, east, south, west).
// A crate or tower that would leave a gate or a shadow with no way to
// the fountain is refused.
//
// Run state (also the device-local session, oros-maze-session .g):
//   { v, sq, diff, u: towers unlocked (1-4), t: ticks, coins, hearts,
//     hmax, wave: waves called, nw: waves in the night, sp: [spawner],
//     wl: [shadows left per wave], sh: [shadow], bl: { "<tile>": block },
//     nid, over: -1 playing | 0 lost | 1 won, acts, faded }
//   spawner { w: wave, g: group, n: spawned in group, next: tick }
//   shadow { id, k: kind, w: wave, x, y, at: tile left, to: tile heading for,
//            hp, mx, sl: slow, st: slow ticks, ar: 1 veiled }
//   block { k: "crate" | tower kind, l: 1 | 2 | 3, b: "" | "a" | "b",
//           d: mirror direction 0-3 (N E S W), cd, sp: coins spent,
//           fr: coins spent since the last wave started (sold back in full) }
// Derived (not saved, rebuilt after every change): the light of every
// tile, the mirror beams and both flow fields.
// ev (not saved): what happened in the last steps, for the screen.
// ============================================================
(function (root) {
  "use strict";

  var V = 1;
  var COLS = 12, ROWS = 18, N = COLS * ROWS;
  var TPS = 60;                          // ticks per second
  var GROUP_GAP = 90;                    // ticks between two groups of a wave
  var SELL = 0.7;                        // part of the price a sold block gives back
  var VEIL = 0.25;                       // what a veil takes from steady light
  var LIGHT_MAX = 3;
  var LIGHT_COST = 2;                    // extra steps per light level
  var INF = 1e9;

  var DIFFS = ["m", "n", "h"];           // Mild, Normal, Hard
  var DIFF = {
    m: { hearts: 30, coins: 150, hp: 0.8 },
    n: { hearts: 20, coins: 120, hp: 1 },
    h: { hearts: 10, coins: 100, hp: 1.15 }
  };

  // Shadow kinds: health, speed (tiles per second), coins, hearts it
  // costs; moth: looks for light; ar: veiled.
  var SHADOW = {
    s: { hp: 36, v: 0.9, c: 3, h: 1 },             // shade
    k: { hp: 16, v: 1.7, c: 2, h: 1 },             // skitter
    m: { hp: 30, v: 1.1, c: 4, h: 1, moth: 1 },    // moth
    v: { hp: 60, v: 0.7, c: 7, h: 1, ar: 1 },      // veil
    g: { hp: 220, v: 0.45, c: 30, h: 3 }           // gloom
  };
  var HP_WAVE = 0.45;                    // health +45% per wave
  var HP_SQ = 0.1;                       // and +10% per square (the first 0.85)

  // Blocks: price, the square from which it is unlocked (crates always).
  // Stats per level 1, 2, a, b. Lantern: r reach of light and harm,
  // li light it gives, dps. Flash: r, cd, d, crack. Mirror: len of the
  // beam, dps, two: a second beam at a right angle. Bell: r, cd, sl, sd.
  var BLOCKS = {
    crate: { c: 5, u: 0 },
    lantern: { c: 40, u: 1, st: {
      1: { r: 2, li: 1, dps: 7 },
      2: { r: 2.3, li: 1, dps: 10 },
      a: { r: 3, li: 2, dps: 12 },                 // Bright lamp
      b: { r: 1.5, li: 1, dps: 24 } } },           // Coloured glass: a small hot light
    flash: { c: 60, u: 2, st: {
      1: { r: 1.6, cd: 120, d: 18 },
      2: { r: 1.7, cd: 110, d: 26 },
      a: { r: 1.9, cd: 110, d: 34, crack: 1 },     // Magnesium
      b: { r: 1.7, cd: 55, d: 16 } } },            // Rapid flash
    mirror: { c: 50, u: 3, st: {
      1: { len: 5, dps: 6 },
      2: { len: 6, dps: 9 },
      a: { len: 9, dps: 10 },                      // Long mirror
      b: { len: 6, dps: 9, two: 1 } } },           // Prism
    bell: { c: 70, u: 4, st: {
      1: { r: 2, cd: 120, sl: 0.4, sd: 120 },
      2: { r: 2.3, cd: 110, sl: 0.45, sd: 120 },
      a: { r: 2.3, cd: 110, sl: 0.55, sd: 150, crack: 1 },  // Deep bell
      b: { r: 2.8, cd: 100, sl: 0.4, sd: 120, d: 10 } } }   // Chime
  };
  var KINDS = ["lantern", "flash", "mirror", "bell"];
  var DIRS = [[0, -1], [1, 0], [0, 1], [-1, 0]];   // N E S W

  // The squares of the Harbour quarter. Waves: "<kind><count>:<ticks
  // between>", groups one after the other.
  var SQUARES = [
    { id: "q1", map: [
      "#####F######",
      "##........##",
      "##........##",
      "##........##",
      "##..o..o..##",
      "##........##",
      "##........##",
      "##........##",
      "##........##",
      "##........##",
      "##........##",
      "##..o..o..##",
      "##........##",
      "##........##",
      "##........##",
      "##........##",
      "##........##",
      "######G#####"],
      waves: ["s5:90", "s7:80", "s9:70", "s10:60", "s12:55", "s14:50", "s16:45", "s18:40", "s20:36", "s16:40 g1:0"] },
    { id: "q2", map: [
      "########F###",
      "#..........#",
      "#..........#",
      "#..o....o..#",
      "#..........#",
      "#..........#",
      "#..........#",
      "#....ww....#",
      "#....ww....#",
      "#..........#",
      "#..........#",
      "#..........#",
      "#..o....o..#",
      "#..........#",
      "#..........#",
      "#..........#",
      "#..........#",
      "###G########"],
      waves: ["s6:80", "s8:70", "k5:50 s5:70", "s12:55", "k10:40", "s10:50 k6:40", "s16:45", "k12:35 s8:45", "s20:38", "s14:40 k10:35 g1:0"] },
    { id: "q3", map: [
      "#####F######",
      "#..........#",
      "#.......####",
      "#.......####",
      "#..........#",
      "#..o.......#",
      "#..........#",
      "#.......o..#",
      "#..........#",
      "##..##..##.#",
      "#..........#",
      "#..........#",
      "#..o....o..#",
      "#..........#",
      "#..........#",
      "G..........#",
      "#..........#",
      "############"],
      waves: ["s8:70", "m4:70", "s10:55 k4:45", "m8:55", "s12:50 m4:60", "k12:35", "s14:45 m6:50", "m12:45", "s18:38 k8:35", "m12:40 s12:40 g1:0"] },
    { id: "q4", map: [
      "##F#########",
      "#..........#",
      "#..........#",
      "#..##..##..#",
      "#..........#",
      "#..........#",
      "#..........#",
      "#.o..o..o..#",
      "#..........#",
      "#..........#",
      "#..........#",
      "#..##..##..#",
      "#..........#",
      "#..........#",
      "#..........#",
      "#..........#",
      "#..........#",
      "#########G##"],
      waves: ["s8:70", "k8:45", "m6:60 s6:60", "s14:50", "k10:35 m6:50", "s16:45", "m12:45", "s12:45 k12:35", "m14:40 s10:45", "s16:40 m10:40 k10:35 g1:0"] }
  ];
  var SQUARE = {};

  // ---------- Squares ----------
  function idx(c, r) { return r * COLS + c; }
  function colOf(i) { return i % COLS; }
  function rowOf(i) { return Math.floor(i / COLS); }
  function centre(i) { return { x: colOf(i) + 0.5, y: rowOf(i) + 0.5 }; }
  function inGrid(c, r) { return c >= 0 && c < COLS && r >= 0 && r < ROWS; }
  function buildSquare(sq) {
    var ground = [], gates = [], fountain = -1;
    for (var r = 0; r < ROWS; r++) {
      for (var c = 0; c < COLS; c++) {
        var ch = sq.map[r].charAt(c), i = idx(c, r);
        ground[i] = ch;
        if (ch === "G") gates.push(i);
        else if (ch === "F") fountain = i;
      }
    }
    sq.ground = ground; sq.gates = gates; sq.fountain = fountain;
    sq.groups = sq.waves.map(parseWave);
  }
  function parseWave(str) {
    return str.split(" ").map(function (g) {
      var m = /^([a-z])(\d+):(\d+)$/.exec(g);
      return { k: m[1], n: +m[2], gap: +m[3] };
    });
  }
  SQUARES.forEach(function (sq, i) { sq.idx = i; buildSquare(sq); SQUARE[sq.id] = sq; });

  // Free ground: built on only when nothing stands there.
  function isGround(sq, i) { return sq.ground[i] === "."; }
  // Can a shadow walk here (with these blocks)?
  function walkable(sq, bl, i) {
    var ch = sq.ground[i];
    if (ch === "G" || ch === "F") return true;
    return ch === "." && !bl[i];
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

  // ---------- Light ----------
  function stats(b) {
    var B = BLOCKS[b.k];
    return B && B.st ? B.st[b.l === 3 ? b.b : b.l] : null;
  }
  // The tiles a mirror's beam lights: [[tile, ...], ...] (one or two
  // beams), or [] when no lit lantern stands next to it. A beam stops
  // at the first tile no light passes (a house, a column, a crate or
  // another tower).
  function beamsOf(sq, bl, i) {
    var m = bl[i], st = stats(m);
    var c = colOf(i), r = rowOf(i), lit = false;
    for (var dc = -1; dc <= 1 && !lit; dc++) {
      for (var dr = -1; dr <= 1; dr++) {
        if (!dc && !dr) continue;
        var cc = c + dc, rr = r + dr;
        if (!inGrid(cc, rr)) continue;
        var n = bl[idx(cc, rr)];
        if (n && n.k === "lantern" && stats(n).li > 0) { lit = true; break; }
      }
    }
    if (!lit) return [];
    var dirs = st.two ? [m.d, (m.d + 1) % 4] : [m.d];
    return dirs.map(function (d) {
      var out = [], x = c, y = r;
      for (var s = 0; s < st.len; s++) {
        x += DIRS[d][0]; y += DIRS[d][1];
        if (!inGrid(x, y)) break;
        var j = idx(x, y), ch = sq.ground[j];
        if (ch === "#" || ch === "o" || ch === "w" || bl[j]) break;
        out.push(j);
      }
      return out;
    });
  }
  // Light per tile (0-3) and the beams of every mirror ({ "<tile>": [[...]] }).
  function lightOf(sq, bl) {
    var light = [], beams = {};
    for (var i = 0; i < N; i++) light[i] = 0;
    Object.keys(bl).forEach(function (key) {
      var i = +key, b = bl[i];
      if (b.k !== "lantern") return;
      var st = stats(b);
      if (!st.li) return;
      var c = colOf(i), r = rowOf(i), R = Math.ceil(st.r);
      for (var dr = -R; dr <= R; dr++) {
        for (var dc = -R; dc <= R; dc++) {
          if ((!dc && !dr) || dc * dc + dr * dr > st.r * st.r + 1e-9 || !inGrid(c + dc, r + dr)) continue;
          var j = idx(c + dc, r + dr);
          light[j] = Math.min(LIGHT_MAX, light[j] + st.li);
        }
      }
    });
    Object.keys(bl).forEach(function (key) {
      var i = +key;
      if (bl[i].k !== "mirror") return;
      var bs = beamsOf(sq, bl, i);
      beams[i] = bs;
      bs.forEach(function (line) { line.forEach(function (j) { light[j] = Math.min(LIGHT_MAX, light[j] + 1); }); });
    });
    return { light: light, beams: beams };
  }

  // ---------- The way (flow fields) ----------
  function tileCost(light, i, moth) {
    var L = light[i];
    return 1 + LIGHT_COST * (moth ? LIGHT_MAX - L : L);
  }
  // Dijkstra from the fountain over walkable tiles (a small binary heap).
  function flow(sq, bl, light, moth) {
    var dist = [], done = [];
    for (var i = 0; i < N; i++) { dist[i] = INF; done[i] = false; }
    var heap = [];
    function push(d, i) {
      heap.push([d, i]);
      var k = heap.length - 1;
      while (k > 0) {
        var p = (k - 1) >> 1;
        if (less(heap[k], heap[p])) { var x = heap[k]; heap[k] = heap[p]; heap[p] = x; k = p; } else break;
      }
    }
    function less(a, b) { return a[0] < b[0] || (a[0] === b[0] && a[1] < b[1]); }
    function pop() {
      var top = heap[0], last = heap.pop();
      if (heap.length) {
        heap[0] = last;
        var k = 0;
        for (;;) {
          var l = 2 * k + 1, r = l + 1, m = k;
          if (l < heap.length && less(heap[l], heap[m])) m = l;
          if (r < heap.length && less(heap[r], heap[m])) m = r;
          if (m === k) break;
          var x = heap[k]; heap[k] = heap[m]; heap[m] = x; k = m;
        }
      }
      return top;
    }
    dist[sq.fountain] = 0;
    push(0, sq.fountain);
    while (heap.length) {
      var top = pop(), v = top[1];
      if (done[v]) continue;
      done[v] = true;
      var c = colOf(v), r = rowOf(v);
      for (var d = 0; d < 4; d++) {
        var cc = c + DIRS[d][0], rr = r + DIRS[d][1];
        if (!inGrid(cc, rr)) continue;
        var u = idx(cc, rr);
        if (done[u] || !walkable(sq, bl, u)) continue;
        var nd = dist[v] + tileCost(light, u, moth);
        if (nd < dist[u]) { dist[u] = nd; push(nd, u); }
      }
    }
    return dist;
  }
  // Everything derived from the blocks, kept on the run (not saved).
  function fields(g) {
    if (g._f && g._f.acts === g.acts) return g._f;
    var sq = SQUARE[g.sq], L = lightOf(sq, g.bl);
    var f = { acts: g.acts, light: L.light, beams: L.beams, dark: flow(sq, g.bl, L.light, false), moth: flow(sq, g.bl, L.light, true) };
    try { Object.defineProperty(g, "_f", { value: f, writable: true, configurable: true, enumerable: false }); }
    catch (e) { g._f = f; }
    return f;
  }
  function invalidate(g) {
    try { Object.defineProperty(g, "_f", { value: null, writable: true, configurable: true, enumerable: false }); }
    catch (e) { g._f = null; }
  }
  // The next tile from tile i (heading: the direction it came in, or -1).
  function nextTile(sq, bl, dist, i, heading) {
    if (i === sq.fountain) return -1;
    var c = colOf(i), r = rowOf(i), best = -1, bd = INF, bh = 9;
    for (var d = 0; d < 4; d++) {
      var cc = c + DIRS[d][0], rr = r + DIRS[d][1];
      if (!inGrid(cc, rr)) continue;
      var u = idx(cc, rr);
      if (!walkable(sq, bl, u) || dist[u] >= INF) continue;
      var h = d === heading ? -1 : d;
      if (dist[u] < bd || (dist[u] === bd && h < bh)) { bd = dist[u]; best = u; bh = h; }
    }
    return best;
  }
  function dirTo(a, b) {
    var dc = colOf(b) - colOf(a), dr = rowOf(b) - rowOf(a);
    for (var d = 0; d < 4; d++) if (DIRS[d][0] === dc && DIRS[d][1] === dr) return d;
    return -1;
  }
  // The way a shadow (or a moth) would walk from tile i: a list of tiles.
  function routeFrom(sq, bl, dist, i) {
    var out = [i], seen = {}, heading = -1;
    seen[i] = 1;
    for (var k = 0; k < N && i !== sq.fountain; k++) {
      var n = nextTile(sq, bl, dist, i, heading);
      if (n < 0 || seen[n]) return out;
      heading = dirTo(i, n);
      out.push(n); seen[n] = 1; i = n;
    }
    return out;
  }
  function routes(g, moth) {
    var sq = SQUARE[g.sq], f = fields(g);
    return sq.gates.map(function (gt) { return routeFrom(sq, g.bl, moth ? f.moth : f.dark, gt); });
  }

  // ---------- A new night ----------
  function newRun(sqId, diff) {
    var sq = SQUARE[sqId];
    if (!sq || !DIFF[diff]) return null;
    var D = DIFF[diff];
    return {
      v: V, sq: sqId, diff: diff, u: Math.min(4, sq.idx + 1), t: 0,
      coins: D.coins, hearts: D.hearts, hmax: D.hearts, wave: 0, nw: sq.waves.length,
      sp: [], wl: sq.groups.map(function (gs) { return gs.reduce(function (n, x) { return n + x.n; }, 0); }),
      sh: [], bl: {}, nid: 1, over: -1, acts: 0, faded: 0, ev: []
    };
  }

  // ---------- Actions ----------
  function buildCost(k) { return BLOCKS[k] ? BLOCKS[k].c : 0; }
  function upCost(b) {
    if (!b || b.k === "crate" || b.l >= 3) return 0;
    var c = BLOCKS[b.k].c;
    return b.l === 1 ? Math.round(c * 0.6) : c;
  }
  function sellValue(b) { return b.fr + Math.floor(SELL * (b.sp - b.fr)); }
  function unlocked(g, k) { return !!BLOCKS[k] && BLOCKS[k].u <= g.u; }
  // The tiles shadows stand on or walk to: nothing may be built there.
  function occupied(g) {
    var o = {};
    g.sh.forEach(function (s) { o[s.at] = 1; if (s.to >= 0) o[s.to] = 1; });
    return o;
  }
  // Why a block of kind k cannot go on tile i ("" = it can):
  // "over", "locked", "ground" (a house, column, gate or the fountain),
  // "taken", "shadow", "coins", "closed" (the last way would close).
  function whyNot(g, i, k) {
    var sq = SQUARE[g.sq];
    if (g.over >= 0) return "over";
    if (!BLOCKS[k]) return "locked";
    if (!unlocked(g, k)) return "locked";
    if (!(i >= 0 && i < N) || !isGround(sq, i)) return "ground";
    if (g.bl[i]) return "taken";
    if (occupied(g)[i]) return "shadow";
    if (g.coins < buildCost(k)) return "coins";
    if (closes(g, i)) return "closed";
    return "";
  }
  // Would a block on tile i close every way for a gate or a shadow?
  function closes(g, i) {
    var sq = SQUARE[g.sq], bl = {};
    Object.keys(g.bl).forEach(function (k) { bl[k] = g.bl[k]; });
    bl[i] = { k: "crate" };
    var zero = [];
    for (var j = 0; j < N; j++) zero[j] = 0;
    var dist = flow(sq, bl, zero, false);
    for (var a = 0; a < sq.gates.length; a++) if (dist[sq.gates[a]] >= INF) return true;
    for (var s = 0; s < g.sh.length; s++) {
      var sh = g.sh[s];
      if (dist[sh.at] >= INF) return true;
      if (sh.to >= 0 && dist[sh.to] >= INF) return true;
    }
    return false;
  }
  // The way the shadows from the first gate would walk with a crate on
  // tile i (null: it would close the way). For the build preview.
  function routeWith(g, i) {
    if (whyNot(g, i, "crate") === "closed") return null;
    var sq = SQUARE[g.sq], bl = {};
    Object.keys(g.bl).forEach(function (k) { bl[k] = g.bl[k]; });
    bl[i] = { k: "crate", l: 1, b: "" };
    var L = lightOf(sq, bl), dist = flow(sq, bl, L.light, false);
    return sq.gates.map(function (gt) { return routeFrom(sq, bl, dist, gt); });
  }
  function changed(g) { g.acts++; invalidate(g); }
  function build(g, i, k) {
    if (whyNot(g, i, k)) return false;
    var c = buildCost(k);
    g.coins -= c;
    g.bl[i] = { k: k, l: 1, b: "", d: 0, cd: 0, sp: c, fr: c };
    if (k === "mirror") g.bl[i].d = mirrorFacing(g, i);
    changed(g);
    return true;
  }
  // A new mirror faces the way with the most free ground in front of it.
  function mirrorFacing(g, i) {
    var sq = SQUARE[g.sq], best = 0, bn = -1;
    for (var d = 0; d < 4; d++) {
      var n = 0, x = colOf(i), y = rowOf(i);
      for (var s = 0; s < 5; s++) {
        x += DIRS[d][0]; y += DIRS[d][1];
        if (!inGrid(x, y)) break;
        var j = idx(x, y);
        if (!walkable(sq, g.bl, j)) break;
        n++;
      }
      if (n > bn) { bn = n; best = d; }
    }
    return best;
  }
  function upgrade(g, i, branch) {
    var b = g.bl[i];
    if (g.over >= 0 || !b || b.k === "crate" || b.l >= 3) return false;
    if (b.l === 2 && branch !== "a" && branch !== "b") return false;
    var c = upCost(b);
    if (g.coins < c) return false;
    g.coins -= c;
    b.sp += c; b.fr += c;
    b.l++;
    if (b.l === 3) b.b = branch;
    changed(g);
    return true;
  }
  function sell(g, i) {
    var b = g.bl[i];
    if (g.over >= 0 || !b) return false;
    g.coins += sellValue(b);
    delete g.bl[i];
    changed(g);
    return true;
  }
  function turn(g, i) {
    var b = g.bl[i];
    if (g.over >= 0 || !b || b.k !== "mirror") return false;
    b.d = (b.d + 1) % 4;
    changed(g);
    return true;
  }
  // Shadows still to come or out in the waves called so far.
  function shadowsLeft(g) {
    var n = 0;
    for (var w = 0; w < g.wave; w++) n += g.wl[w];
    return n;
  }
  // The next wave. Called while shadows are still out: +1 coin for
  // every shadow still to come or out.
  function callWave(g) {
    if (g.over >= 0 || g.wave >= g.nw) return false;
    var early = shadowsLeft(g);
    if (early) { g.coins += early; g.ev.push({ e: "early", n: early }); }
    g.sp.push({ w: g.wave, g: 0, n: 0, next: g.t + 1 });
    g.wave++;
    Object.keys(g.bl).forEach(function (i) { g.bl[i].fr = 0; });
    g.acts++;
    return true;
  }

  // ---------- One tick ----------
  function shadowHp(g, k, w) {
    return Math.round(SHADOW[k].hp * (1 + HP_WAVE * w) * (0.85 + HP_SQ * SQUARE[g.sq].idx) * DIFF[g.diff].hp);
  }
  function makeShadow(g, k, w, gate) {
    var hp = shadowHp(g, k, w), p = centre(gate);
    return { id: g.nid++, k: k, w: w, x: p.x, y: p.y, at: gate, to: -1, hp: hp, mx: hp, sl: 0, st: 0, ar: SHADOW[k].ar ? 1 : 0 };
  }
  function hurt(s, d, steady) {
    if (s.ar && steady) d *= VEIL;
    s.hp -= d;
  }
  function slow(s, sl, ticks) {
    s.sl = s.st > 0 ? Math.max(s.sl, sl) : sl;
    s.st = Math.max(s.st, ticks);
  }
  function near(g, i, r) {
    var p = centre(i);
    return g.sh.filter(function (s) {
      return s.hp > 0 && (s.x - p.x) * (s.x - p.x) + (s.y - p.y) * (s.y - p.y) <= r * r;
    });
  }
  function tileUnder(s) {
    var c = Math.min(COLS - 1, Math.max(0, Math.floor(s.x))), r = Math.min(ROWS - 1, Math.max(0, Math.floor(s.y)));
    return idx(c, r);
  }
  function act(g, f, i, b) {
    var st = stats(b);
    if (b.k === "lantern") {
      var lit = near(g, i, st.r);
      lit.forEach(function (s) { hurt(s, st.dps / TPS, true); });
      return false;                      // steady: never waits
    }
    if (b.k === "mirror") {
      var bs = f.beams[i] || [];
      if (!bs.length) return false;
      var on = {};
      bs.forEach(function (line) { line.forEach(function (j) { on[j] = 1; }); });
      g.sh.forEach(function (s) { if (s.hp > 0 && on[tileUnder(s)]) hurt(s, st.dps / TPS, true); });
      return false;
    }
    var hit = near(g, i, st.r);
    if (!hit.length) return false;
    if (b.k === "flash") {
      hit.forEach(function (s) { if (st.crack) s.ar = 0; hurt(s, st.d, false); });
      g.ev.push({ e: "flash", p: i });
      return true;
    }
    if (b.k === "bell") {
      hit.forEach(function (s) {
        slow(s, st.sl, st.sd);
        if (st.crack) s.ar = 0;
        if (st.d) hurt(s, st.d, false);
      });
      g.ev.push({ e: "ring", p: i });
      return true;
    }
    return false;
  }
  // Move a shadow along the field; true when it reached the fountain.
  function move(g, sq, f, s, dist) {
    var left = SHADOW[s.k].v * (1 - (s.st > 0 ? s.sl : 0)) / TPS;
    for (var guard = 0; guard < 4 && left > 0; guard++) {
      if (s.to < 0) {
        if (s.at === sq.fountain) return true;
        s.to = nextTile(sq, g.bl, dist, s.at, -1);
        if (s.to < 0) return false;      // cannot happen: closing placements are refused
      }
      var q = centre(s.to), dx = q.x - s.x, dy = q.y - s.y;
      var d = Math.abs(dx) + Math.abs(dy);
      if (d <= left + 1e-9) {
        var came = dirTo(s.at, s.to);
        s.x = q.x; s.y = q.y; left -= d;
        s.at = s.to;
        if (s.at === sq.fountain) { s.to = -1; return true; }
        s.to = nextTile(sq, g.bl, dist, s.at, came);
      } else {
        s.x += dx / d * left; s.y += dy / d * left;
        left = 0;
      }
    }
    return false;
  }
  function step(g) {
    if (g.over >= 0) return;
    var sq = SQUARE[g.sq], f = fields(g);
    g.t++;
    // spawners (groups take the gates in turn)
    for (var i = 0; i < g.sp.length; i++) {
      var sp = g.sp[i];
      if (g.t < sp.next) continue;
      var grp = sq.groups[sp.w][sp.g];
      g.sh.push(makeShadow(g, grp.k, sp.w, sq.gates[(sp.w + sp.g) % sq.gates.length]));
      sp.n++;
      if (sp.n >= grp.n) {
        sp.g++; sp.n = 0;
        if (sp.g >= sq.groups[sp.w].length) { g.sp.splice(i, 1); i--; continue; }
        sp.next = g.t + GROUP_GAP;
      } else sp.next = g.t + Math.max(1, grp.gap);
    }
    // towers, in tile order
    Object.keys(g.bl).map(Number).sort(function (a, b) { return a - b; }).forEach(function (i) {
      var b = g.bl[i];
      if (b.k === "crate") return;
      if (b.cd > 0) { b.cd--; return; }
      if (act(g, f, i, b)) b.cd = stats(b).cd;
    });
    // shadows that faded
    var alive = [];
    g.sh.forEach(function (s) {
      if (s.hp > 0) { alive.push(s); return; }
      g.coins += SHADOW[s.k].c;
      g.faded++;
      g.ev.push({ e: "fade", f: s.id, k: s.k, x: s.x, y: s.y });
      done(g, s.w);
    });
    g.sh = alive;
    // move, and the shadows that reached the fountain
    var left = [];
    g.sh.forEach(function (s) {
      var home = move(g, sq, f, s, SHADOW[s.k].moth ? f.moth : f.dark);
      if (s.st > 0) s.st--;
      if (!home) { left.push(s); return; }
      g.hearts = Math.max(0, g.hearts - SHADOW[s.k].h);
      g.ev.push({ e: "leak", f: s.id, k: s.k });
      done(g, s.w);
    });
    g.sh = left;
    if (g.hearts <= 0) { g.over = 0; g.ev.push({ e: "lost" }); return; }
    if (g.wave >= g.nw && !g.sp.length && !g.sh.length) { g.over = 1; g.ev.push({ e: "won", stars: stars(g) }); }
  }
  // One shadow of wave w is gone: the wave's bonus when it was the last.
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
  // What comes in the next wave: [{k, n}], in order.
  function preview(g) {
    if (g.wave >= g.nw) return [];
    return SQUARE[g.sq].groups[g.wave].map(function (x) { return { k: x.k, n: x.n }; });
  }
  // Do moths come on this square at all (then their way is shown too)?
  function hasMoths(sqId) {
    var sq = SQUARE[sqId];
    return !!sq && sq.groups.some(function (gs) { return gs.some(function (x) { return SHADOW[x.k].moth; }); });
  }

  // ---------- Session: the night in progress ----------
  function num(v, lo, hi) { return typeof v === "number" && isFinite(v) && v >= lo && v <= hi; }
  function int(v, lo, hi) { return num(v, lo, hi) && Math.floor(v) === v; }
  // A copy that can be trusted, or null (unreadable or from another version).
  function normalizeRun(x) {
    if (!x || typeof x !== "object" || x.v !== V || !SQUARE[x.sq] || !DIFF[x.diff]) return null;
    var sq = SQUARE[x.sq];
    var BIG = 1e9, nw = sq.waves.length;
    if (!int(x.u, 1, 4) || !int(x.t, 0, BIG) || !num(x.coins, 0, BIG) || !int(x.hearts, 0, 99) ||
        !int(x.hmax, 1, 99) || !int(x.wave, 0, nw) || x.nw !== nw ||
        !int(x.nid, 1, BIG) || [-1, 0, 1].indexOf(x.over) < 0 || !int(x.acts, 0, BIG) || !int(x.faded, 0, BIG) ||
        !Array.isArray(x.sp) || !Array.isArray(x.wl) || x.wl.length !== nw ||
        !Array.isArray(x.sh) || !x.bl || typeof x.bl !== "object" || Array.isArray(x.bl)) return null;
    var g = { v: V, sq: x.sq, diff: x.diff, u: x.u, t: x.t, coins: x.coins, hearts: x.hearts, hmax: x.hmax,
              wave: x.wave, nw: nw, sp: [], wl: [], sh: [], bl: {}, nid: x.nid, over: x.over,
              acts: x.acts, faded: x.faded, ev: [] };
    var i;
    for (i = 0; i < x.wl.length; i++) { if (!int(x.wl[i], 0, BIG)) return null; g.wl.push(x.wl[i]); }
    for (i = 0; i < x.sp.length; i++) {
      var s = x.sp[i];
      if (!s || !int(s.w, 0, nw - 1) || !int(s.g, 0, sq.groups[s.w].length - 1) ||
          !int(s.n, 0, BIG) || !int(s.next, 0, BIG)) return null;
      g.sp.push({ w: s.w, g: s.g, n: s.n, next: s.next });
    }
    var keys = Object.keys(x.bl);
    for (i = 0; i < keys.length; i++) {
      var key = keys[i], b = x.bl[key];
      if (!/^\d{1,3}$/.test(key) || +key >= N || !isGround(sq, +key) || !b || !BLOCKS[b.k]) return null;
      if (b.k === "crate") {
        if (b.l !== 1 || b.b !== "" || !num(b.sp, 0, BIG) || !num(b.fr, 0, b.sp)) return null;
        g.bl[+key] = { k: "crate", l: 1, b: "", d: 0, cd: 0, sp: b.sp, fr: b.fr };
        continue;
      }
      if (!int(b.l, 1, 3) || (b.l === 3 ? (b.b !== "a" && b.b !== "b") : b.b !== "") || !int(b.d, 0, 3) ||
          !int(b.cd, 0, 9999) || !num(b.sp, 0, BIG) || !num(b.fr, 0, b.sp)) return null;
      g.bl[+key] = { k: b.k, l: b.l, b: b.b, d: b.d, cd: b.cd, sp: b.sp, fr: b.fr };
    }
    for (i = 0; i < x.sh.length; i++) {
      var h = x.sh[i];
      if (!h || !SHADOW[h.k] || !int(h.id, 1, BIG) || !int(h.w, 0, nw - 1) || !num(h.x, 0, COLS) || !num(h.y, 0, ROWS) ||
          !int(h.at, 0, N - 1) || !int(h.to, -1, N - 1) || !walkable(sq, g.bl, h.at) || (h.to >= 0 && !walkable(sq, g.bl, h.to)) ||
          !num(h.hp, -BIG, BIG) || !num(h.mx, 1, BIG) || !num(h.sl, 0, 1) || !int(h.st, 0, BIG) || (h.ar !== 0 && h.ar !== 1)) return null;
      g.sh.push({ id: h.id, k: h.k, w: h.w, x: h.x, y: h.y, at: h.at, to: h.to, hp: h.hp, mx: h.mx, sl: h.sl, st: h.st, ar: h.ar });
    }
    // every gate and shadow must still have a way to the fountain
    var zero = [];
    for (i = 0; i < N; i++) zero[i] = 0;
    var dist = flow(sq, g.bl, zero, false);
    if (sq.gates.some(function (gt) { return dist[gt] >= INF; })) return null;
    if (g.sh.some(function (h) { return dist[h.at] >= INF || (h.to >= 0 && dist[h.to] >= INF); })) return null;
    return g;
  }
  // The session as written: no events, no derived fields.
  function saveable(g) {
    var c = JSON.parse(JSON.stringify(g));
    delete c.ev;
    return c;
  }

  // ---------- Progress (the synced slice "maze", oros-maze-data) ----------
  // { ver, br, maps: { "<square>": { b, s: best stars 0-3, e: best Endless wave } },
  //   rows: { "<device id>": { b, s: { "<diff>": [nights, won] }, f: shadows faded } } }
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
        if (!SQUARE[id]) return;
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
    var m = out.maps[g.sq];
    var st = stars(g);
    if (st && (!m || st > m.s)) out.maps[g.sq] = { b: m ? m.b : Math.max(out.br, now || 0), s: st, e: m ? m.e : 0 };
    return merge(out, out);
  }
  // Stars of a square, and whether it is open (the first is; the next
  // opens when the one before has a star).
  function starsOf(d, id) { var m = d && d.maps && d.maps[id]; return m ? m.s : 0; }
  function isOpen(d, id) {
    var sq = SQUARE[id];
    return !!sq && (sq.idx === 0 || starsOf(d, SQUARES[sq.idx - 1].id) > 0);
  }

  function clone(x) { return JSON.parse(JSON.stringify(x)); }

  var api = {
    V: V, COLS: COLS, ROWS: ROWS, N: N, TPS: TPS, DIFFS: DIFFS, DIFF: DIFF, SHADOW: SHADOW, BLOCKS: BLOCKS,
    KINDS: KINDS, DIRS: DIRS, SQUARES: SQUARES, SQUARE: SQUARE, LIGHT_MAX: LIGHT_MAX, INF: INF,
    idx: idx, colOf: colOf, rowOf: rowOf, centre: centre, isGround: isGround, walkable: walkable,
    stats: stats, fields: fields, routes: routes, routeWith: routeWith, tileCost: tileCost,
    newRun: newRun, buildCost: buildCost, upCost: upCost, sellValue: sellValue, unlocked: unlocked,
    whyNot: whyNot, build: build, upgrade: upgrade, sell: sell, turn: turn, callWave: callWave,
    shadowsLeft: shadowsLeft, step: step, run: run, stars: stars, preview: preview, hasMoths: hasMoths,
    shadowHp: shadowHp, normalizeRun: normalizeRun, saveable: saveable,
    defaultData: defaultData, merge: merge, record: record, starsOf: starsOf, isOpen: isOpen,
    hash: hash, mulberry32: mulberry32, clone: clone
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.MazeEngine = api;
})(typeof window !== "undefined" ? window : this);
