// ============================================================
// orOS Realm — rules engine (v1.0.0)
// NOT the UI: no DOM, no storage. Loaded by realm/index.html
// (window.RealmEngine) and by tests/realm.test.js (module.exports).
//
// A turn-based territory game on a hex island. Original rules,
// numbers and names (plan: Bible Part IX "Realm").
//
// Grid: pointy-top hexes in rows, odd rows shifted half a hex to the
// right ("odd-r"). Cell i = r * W + c.
//
// State (plain JSON, kept as is in the device-local session):
//   { v: 1, W, H, size "s"|"m"|"l", seed "…",
//     land: [0|1],          // 1 = land
//     own:  [-1|0..5],      // owner side, -1 = nobody
//     obj:  [code],         // see O below
//     done: [0|1],          // a unit that already acted this turn
//     gold: [int],          // treasury, kept on the Hall cell only
//     sides: [{ k: "h"|"c", lv: "e"|"m"|"h", out: bool }],
//     turn, round, rng (uint32), acts (actions so far, all sides),
//     over (-1 while playing, else the winning side), nos (1 = the
//     surrender offer was declined) }
//
// Rules (also in realm/help.en.txt):
//   - Region = connected cells of one side. A region of 2+ cells has
//     one Hall (its treasury); a lone cell has none and its units
//     desert at the start of its owner's turn.
//   - At the start of a side's turn every region earns 1 per cell
//     that is not overgrown + 4 per Mill, then pays upkeep. Gold below
//     0 = every unit of the region deserts (Ruin), gold 0.
//   - Units: tier 1-4, cost 10/20/30/40, upkeep 2/5/12/22, strength =
//     tier. One action per turn: walk up to 4 steps inside its region,
//     then take a cell next to any reached cell. Two units merge
//     (tiers add, max 4).
//   - Buildings: Hall 1, Watchtower 2 (15, upkeep 1), Fort 3 (35,
//     upkeep 4), Mill +4 gold (12 + 3 per Mill in the region, next to
//     the Hall or another Mill).
//   - A cell is guarded by the highest strength on it and on its
//     neighbours of the same side; an attacker needs more.
//   - Each new round: Ruins turn into Thicket; each Thicket spreads to
//     one empty neighbour with chance 1 in 5 (seeded).
//   - A side without a region is out; the last side wins.
// ============================================================
(function (root) {
  "use strict";

  var O = { EMPTY: 0, HALL: 1, TOWER: 2, FORT: 3, MILL: 4, THICKET: 5, RUIN: 6, U1: 7, U2: 8, U3: 9, U4: 10 };
  var UNIT_COST = [0, 10, 20, 30, 40];
  var UNIT_UPKEEP = [0, 2, 5, 12, 22];
  var TOWER_COST = 15, FORT_COST = 35, MILL_BASE = 12, MILL_STEP = 3, MILL_GAIN = 4;
  var TOWER_UPKEEP = 1, FORT_UPKEEP = 4;
  var MOVE_STEPS = 4;
  var START_GOLD = 10;
  var SURRENDER_SHARE = 0.75;
  var SIZES = {
    s: { W: 13, H: 12, land: 90 },
    m: { W: 17, H: 15, land: 160 },
    l: { W: 21, H: 19, land: 260 }
  };
  var LEVELS = ["e", "m", "h"];
  var MAX_SIDES = 6;
  // Buy kinds, in the order of the buy bar.
  var KINDS = ["u1", "u2", "u3", "u4", "tower", "fort", "mill"];

  // ---------- Random numbers (seeded, the same on every device) ----------
  function hashStr(s) {
    var h = 0x811c9dc5;
    s = String(s);
    for (var i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    return h >>> 0;
  }
  // mulberry32 step on a state number; returns [next state, value in [0, 1)]
  function step(a) {
    a = (a + 0x6D2B79F5) >>> 0;
    var t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return [a, ((t ^ (t >>> 14)) >>> 0) / 4294967296];
  }
  function stream(seed) {
    var a = typeof seed === "number" ? seed >>> 0 : hashStr(seed);
    return function () { var r = step(a); a = r[0]; return r[1]; };
  }

  // ---------- Grid ----------
  // The six neighbours in a fixed order W, E, NW, NE, SW, SE; -1 where
  // the grid ends (the map view draws region borders from this).
  function around(st, i) {
    var W = st.W, H = st.H, r = Math.floor(i / W), c = i % W, out = [];
    var d = (r & 1) ? [[0, -1], [0, 1], [-1, 0], [-1, 1], [1, 0], [1, 1]]
                    : [[0, -1], [0, 1], [-1, -1], [-1, 0], [1, -1], [1, 0]];
    for (var k = 0; k < 6; k++) {
      var rr = r + d[k][0], cc = c + d[k][1];
      out.push(rr >= 0 && rr < H && cc >= 0 && cc < W ? rr * W + cc : -1);
    }
    return out;
  }
  function neighbours(st, i) {
    return around(st, i).filter(function (x) { return x >= 0; });
  }
  function isUnit(o) { return o >= O.U1 && o <= O.U4; }
  function tierOf(o) { return isUnit(o) ? o - O.U1 + 1 : 0; }
  function unitObj(t) { return O.U1 + t - 1; }
  function strengthOf(o) {
    if (isUnit(o)) return tierOf(o);
    if (o === O.HALL) return 1;
    if (o === O.TOWER) return 2;
    if (o === O.FORT) return 3;
    return 0;
  }

  // ---------- Map maker ----------
  // A connected island grown from the middle, then the start regions
  // as far apart as the island allows.
  function makeMap(opts) {
    var size = SIZES[opts.size] ? opts.size : "s";
    var spec = SIZES[size];
    var seed = String(opts.seed || "realm");
    var sides = opts.sides;
    var rnd = stream("realm:" + size + ":" + sides.length + ":" + seed);
    var W = spec.W, H = spec.H, n = W * H;
    var st = { v: 1, W: W, H: H, size: size, seed: seed, land: [], own: [], obj: [], done: [], gold: [] };
    for (var i = 0; i < n; i++) { st.land.push(0); st.own.push(-1); st.obj.push(0); st.done.push(0); st.gold.push(0); }
    // Grow land: each step picks a water cell next to land, weighted by
    // how many land neighbours it has and how close it is to the middle.
    var cr = (H - 1) / 2, cc = (W - 1) / 2;
    var start = Math.round(cr) * W + Math.round(cc);
    st.land[start] = 1;
    var count = 1;
    var guard = 0;
    while (count < spec.land && guard++ < 20000) {
      var cand = [], weights = [], total = 0;
      for (var j = 0; j < n; j++) {
        if (st.land[j]) continue;
        var nb = neighbours(st, j), ln = 0;
        for (var k = 0; k < nb.length; k++) if (st.land[nb[k]]) ln++;
        if (!ln) continue;
        var r = Math.floor(j / W), c = j % W;
        // stay off the grid edge so the island has a shore all round
        if (r === 0 || c === 0 || r === H - 1 || c === W - 1) continue;
        var dy = (r - cr) / (H / 2), dx = (c - cc) / (W / 2);
        var w = (ln * ln) * Math.max(0.15, 1.2 - Math.sqrt(dx * dx + dy * dy));
        cand.push(j); weights.push(w); total += w;
      }
      if (!cand.length) break;
      var pick = rnd() * total, idx = 0;
      while (idx < cand.length - 1 && pick >= weights[idx]) { pick -= weights[idx]; idx++; }
      st.land[cand[idx]] = 1;
      count++;
    }
    var landCells = [];
    for (var q = 0; q < n; q++) if (st.land[q]) landCells.push(q);
    // Start cells: farthest-point picks on the land graph.
    var starts = [];
    starts.push(landCells[Math.floor(rnd() * landCells.length)]);
    for (var s = 1; s < sides.length + 1; s++) {
      var dist = bfsDist(st, starts);
      var best = -1, bestD = -1;
      for (var m = 0; m < landCells.length; m++) {
        var dd = dist[landCells[m]];
        if (dd > bestD) { bestD = dd; best = landCells[m]; }
      }
      starts.push(best);
    }
    starts.shift();     // the first random pick only seeds the spread
    // Each side gets its start cell and up to 5 cells around it, with a
    // gap of one cell to other sides where the island allows it.
    starts.forEach(function (sc, side) { st.own[sc] = side; });
    starts.forEach(function (sc, side) {
      var region = [sc];
      [true, false].forEach(function (gap) {
        var frontier = region.slice();
        while (region.length < 6 && frontier.length) {
          var cur = frontier.shift();
          var nbs = neighbours(st, cur);
          for (var z = 0; z < nbs.length && region.length < 6; z++) {
            var x = nbs[z];
            if (!st.land[x] || st.own[x] >= 0) continue;
            if (gap && neighbours(st, x).some(function (y) { return st.own[y] >= 0 && st.own[y] !== side; })) continue;
            st.own[x] = side;
            region.push(x);
            frontier.push(x);
          }
        }
      });
      st.obj[sc] = O.HALL;
      st.gold[sc] = START_GOLD;
    });
    // A few Thicket patches on free land.
    landCells.forEach(function (x) {
      if (st.own[x] < 0 && rnd() < 0.07) st.obj[x] = O.THICKET;
    });
    st.sides = sides.map(function (sd) {
      return { k: sd.k === "c" ? "c" : "h", lv: LEVELS.indexOf(sd.lv) >= 0 ? sd.lv : "m", out: false };
    });
    st.turn = 0;
    st.round = 1;
    st.rng = hashStr("thicket:" + seed) >>> 0;
    st.acts = 0;
    st.over = -1;
    st.nos = 0;
    settle(st, -1);
    beginTurn(st);
    return st;
  }

  function bfsDist(st, from) {
    var n = st.W * st.H, dist = [], q = [];
    for (var i = 0; i < n; i++) dist.push(-1);
    from.forEach(function (f) { dist[f] = 0; q.push(f); });
    for (var h = 0; h < q.length; h++) {
      var cur = q[h], nb = neighbours(st, cur);
      for (var k = 0; k < nb.length; k++) {
        var x = nb[k];
        if (st.land[x] && dist[x] < 0) { dist[x] = dist[cur] + 1; q.push(x); }
      }
    }
    return dist;
  }

  // ---------- Regions ----------
  // The connected cells of side `side` that hold cell i.
  function regionOf(st, i) {
    var side = st.own[i];
    if (side < 0) return [];
    var seen = {}, out = [i];
    seen[i] = true;
    for (var h = 0; h < out.length; h++) {
      var nb = neighbours(st, out[h]);
      for (var k = 0; k < nb.length; k++) {
        var x = nb[k];
        if (!seen[x] && st.own[x] === side) { seen[x] = true; out.push(x); }
      }
    }
    return out.sort(function (a, b) { return a - b; });
  }
  // Every region of a side, each as a sorted cell list, in cell order.
  function regions(st, side) {
    var n = st.W * st.H, seen = {}, out = [];
    for (var i = 0; i < n; i++) {
      if (st.own[i] !== side || seen[i]) continue;
      var reg = regionOf(st, i);
      reg.forEach(function (x) { seen[x] = true; });
      out.push(reg);
    }
    return out;
  }
  function hallOf(st, reg) {
    for (var k = 0; k < reg.length; k++) if (st.obj[reg[k]] === O.HALL) return reg[k];
    return -1;
  }

  // After any change: every region of 2+ cells has exactly one Hall,
  // lone cells have none. Two Halls in one region (regions joined):
  // the one at `keep` (or the richest, then the lowest cell) stays and
  // takes the gold of the others. A region without a Hall gets one on
  // the free cell nearest its middle.
  function settle(st, keep) {
    for (var side = 0; side < st.sides.length; side++) {
      regions(st, side).forEach(function (reg) {
        var halls = reg.filter(function (x) { return st.obj[x] === O.HALL; });
        if (reg.length < 2) {
          halls.forEach(function (x) { st.obj[x] = O.EMPTY; st.gold[x] = 0; });
          return;
        }
        if (halls.length > 1) {
          var stay = halls.indexOf(keep) >= 0 ? keep : halls.slice().sort(function (a, b) {
            return st.gold[b] - st.gold[a] || a - b;
          })[0];
          var sum = 0;
          halls.forEach(function (x) { sum += st.gold[x]; });
          halls.forEach(function (x) { if (x !== stay) { st.obj[x] = O.EMPTY; st.gold[x] = 0; } });
          st.gold[stay] = sum;
        } else if (!halls.length) {
          var spot = hallSpot(st, reg);
          st.obj[spot] = O.HALL;
          st.gold[spot] = 0;
          st.done[spot] = 0;
        }
      });
    }
    // Gold never stays on a cell that is not a Hall.
    for (var i = 0; i < st.gold.length; i++) if (st.obj[i] !== O.HALL) st.gold[i] = 0;
  }
  // The cell for a new Hall: empty first, then Thicket/Ruin, then a
  // Mill or Watchtower, then a Fort, and only when the region is full
  // the weakest unit (which is lost). Every region of 2+ cells gets one.
  function hallSpot(st, reg) {
    var rank = function (o) {
      if (o === O.EMPTY) return 0;
      if (o === O.THICKET || o === O.RUIN) return 1;
      if (o === O.MILL || o === O.TOWER) return 2;
      if (o === O.FORT) return 3;
      if (isUnit(o)) return 3 + tierOf(o);
      return 9;
    };
    var best = -1, bestR = 9;
    for (var k = 0; k < reg.length; k++) {
      var r = rank(st.obj[reg[k]]);
      if (r < bestR) { bestR = r; best = reg[k]; }
    }
    return best;
  }

  // ---------- Economy ----------
  function upkeepOf(o) {
    if (isUnit(o)) return UNIT_UPKEEP[tierOf(o)];
    if (o === O.TOWER) return TOWER_UPKEEP;
    if (o === O.FORT) return FORT_UPKEEP;
    return 0;
  }
  // { gold, income, upkeep, net, mills, hall } of the region holding i.
  function regionInfo(st, i) {
    var reg = regionOf(st, i);
    var hall = hallOf(st, reg);
    var inc = 0, up = 0, mills = 0;
    reg.forEach(function (x) {
      var o = st.obj[x];
      if (o !== O.THICKET) inc++;
      if (o === O.MILL) { mills++; inc += MILL_GAIN; }
      up += upkeepOf(o);
    });
    if (hall < 0) inc = 0;
    return { cells: reg, hall: hall, gold: hall >= 0 ? st.gold[hall] : 0,
             income: inc, upkeep: up, net: inc - up, mills: mills };
  }
  function millCost(mills) { return MILL_BASE + MILL_STEP * mills; }
  function costOf(kind, info) {
    if (kind === "u1") return UNIT_COST[1];
    if (kind === "u2") return UNIT_COST[2];
    if (kind === "u3") return UNIT_COST[3];
    if (kind === "u4") return UNIT_COST[4];
    if (kind === "tower") return TOWER_COST;
    if (kind === "fort") return FORT_COST;
    if (kind === "mill") return millCost(info ? info.mills : 0);
    return Infinity;
  }

  // ---------- Defence ----------
  function defence(st, i) {
    var side = st.own[i];
    if (side < 0) return 0;
    var best = strengthOf(st.obj[i]);
    var nb = neighbours(st, i);
    for (var k = 0; k < nb.length; k++) {
      var x = nb[k];
      if (st.own[x] === side) best = Math.max(best, strengthOf(st.obj[x]));
    }
    return best;
  }

  // ---------- Turn flow ----------
  // Start of a side's turn: nature (at the start of a round), income
  // and upkeep, desertion, fresh units.
  function beginTurn(st) {
    var side = st.turn;
    var n = st.W * st.H;
    for (var i = 0; i < n; i++) if (st.own[i] === side) st.done[i] = 0;
    regions(st, side).forEach(function (reg) {
      var hall = hallOf(st, reg);
      if (reg.length < 2 || hall < 0) {
        // A lone cell has no Hall and no gold: its units desert.
        reg.forEach(function (x) { if (isUnit(st.obj[x])) st.obj[x] = O.RUIN; });
        return;
      }
      var info = regionInfo(st, reg[0]);
      var g = st.gold[hall] + info.net;
      if (g < 0) {
        reg.forEach(function (x) { if (isUnit(st.obj[x])) st.obj[x] = O.RUIN; });
        g = 0;
      }
      st.gold[hall] = g;
    });
  }

  function nature(st) {
    var n = st.W * st.H, grow = [];
    for (var i = 0; i < n; i++) if (st.obj[i] === O.RUIN) st.obj[i] = O.THICKET;
    for (var j = 0; j < n; j++) {
      if (st.obj[j] !== O.THICKET) continue;
      var r = step(st.rng); st.rng = r[0];
      if (r[1] >= 0.2) continue;
      var free = neighbours(st, j).filter(function (x) { return st.land[x] && st.obj[x] === O.EMPTY; });
      if (!free.length) continue;
      var r2 = step(st.rng); st.rng = r2[0];
      grow.push(free[Math.floor(r2[1] * free.length)]);
    }
    grow.forEach(function (x) { if (st.obj[x] === O.EMPTY) st.obj[x] = O.THICKET; });
  }

  // A side is out when it holds no region of 2+ cells. Its cells go to
  // nobody and its units turn into Ruins.
  function checkOut(st) {
    var alive = [];
    for (var s = 0; s < st.sides.length; s++) {
      if (st.sides[s].out) continue;
      var any = regions(st, s).some(function (reg) { return reg.length >= 2; });
      if (!any) {
        st.sides[s].out = true;
        for (var i = 0; i < st.own.length; i++) {
          if (st.own[i] !== s) continue;
          st.own[i] = -1;
          if (isUnit(st.obj[i])) st.obj[i] = O.RUIN;
          else if (st.obj[i] === O.HALL) st.obj[i] = O.EMPTY;
          st.gold[i] = 0;
          st.done[i] = 0;
        }
      } else alive.push(s);
    }
    if (alive.length === 1) st.over = alive[0];
    else if (!alive.length) st.over = st.turn;
  }

  // End the current side's turn and start the next living side's turn.
  function endTurn(st) {
    if (st.over >= 0) return false;
    var n = st.sides.length, s = st.turn, wrapped = false;
    for (var k = 0; k < n; k++) {
      s = (s + 1) % n;
      if (s === 0) wrapped = true;
      if (!st.sides[s].out) break;
    }
    if (wrapped) { st.round++; nature(st); }
    st.turn = s;
    beginTurn(st);
    settle(st, -1);
    checkOut(st);
    return true;
  }

  // ---------- Moves ----------
  // Own cells a unit at i can walk to (up to 4 steps through its own
  // region; it may pass any own cell), with the start cell first.
  function walkable(st, i) {
    var side = st.own[i], dist = {}, out = [i];
    dist[i] = 0;
    for (var h = 0; h < out.length; h++) {
      var cur = out[h];
      if (dist[cur] >= MOVE_STEPS) continue;
      var nb = neighbours(st, cur);
      for (var k = 0; k < nb.length; k++) {
        var x = nb[k];
        if (st.own[x] === side && dist[x] === undefined) { dist[x] = dist[cur] + 1; out.push(x); }
      }
    }
    return out;
  }
  // Where the unit at i may go: { walk: [own cells], take: [cells] }.
  // Every cell's guard at once (the computer reads it many times).
  function defenceMap(st) {
    var out = [];
    for (var i = 0; i < st.own.length; i++) out.push(st.land[i] ? defence(st, i) : 0);
    return out;
  }
  function targets(st, i, def) {
    var o = st.obj[i], side = st.own[i];
    if (!isUnit(o) || side !== st.turn || st.done[i] || st.over >= 0) return { walk: [], take: [] };
    var t = tierOf(o), cells = walkable(st, i), walk = [], take = [], seenT = {};
    cells.forEach(function (x) {
      if (x !== i) {
        var ox = st.obj[x];
        if (ox === O.EMPTY || ox === O.THICKET || ox === O.RUIN) walk.push(x);
        else if (isUnit(ox) && tierOf(ox) + t <= 4) walk.push(x);
      }
      var nb = neighbours(st, x);
      for (var k = 0; k < nb.length; k++) {
        var y = nb[k];
        if (seenT[y] || !st.land[y] || st.own[y] === side) continue;
        seenT[y] = true;
        if (t > (def ? def[y] : defence(st, y))) take.push(y);
      }
    });
    take.sort(function (a, b) { return a - b; });
    walk.sort(function (a, b) { return a - b; });
    return { walk: walk, take: take };
  }

  // Put side's unit of tier t on cell y owned by someone else (or by
  // nobody): the cell changes hands, its Hall's treasury is lost, a
  // split region keeps its gold shared by cell count.
  function capture(st, y, side, t, fromHall) {
    var prev = st.own[y];
    var oldParts = null, oldGold = 0, oldHall = -1;
    if (prev >= 0) {
      var reg = regionOf(st, y);
      oldHall = hallOf(st, reg);
      oldGold = oldHall >= 0 ? st.gold[oldHall] : 0;
      oldParts = reg;
    }
    st.own[y] = side;
    st.obj[y] = unitObj(t);
    st.gold[y] = 0;
    st.done[y] = 1;
    if (prev >= 0 && oldParts && oldHall !== y && oldHall >= 0) {
      // The rest of the old region may now be several parts.
      var rest = oldParts.filter(function (x) { return x !== y; });
      var seen = {}, parts = [];
      rest.forEach(function (x) {
        if (seen[x]) return;
        var p = regionOf(st, x);
        p.forEach(function (z) { seen[z] = true; });
        parts.push(p);
      });
      if (parts.length > 1) {
        var total = 0;
        parts.forEach(function (p) { if (p.length >= 2) total += p.length; });
        var given = 0;
        parts.forEach(function (p) {
          if (p.length < 2 || p.indexOf(oldHall) >= 0) return;
          var share = total ? Math.floor(oldGold * p.length / total) : 0;
          var spot = hallSpot(st, p);
          st.obj[spot] = O.HALL; st.gold[spot] = share; st.done[spot] = 0; given += share;
        });
        st.gold[oldHall] = Math.max(0, oldGold - given);
      }
    }
    settle(st, fromHall);
  }

  // The Hall of the acting region, so a joined region keeps it.
  function hallNear(st, i) { return hallOf(st, regionOf(st, i)); }

  // Move the unit at i to y. Returns true when done.
  function move(st, i, y) {
    var tg = targets(st, i);
    var side = st.own[i], t = tierOf(st.obj[i]);
    if (tg.walk.indexOf(y) >= 0) {
      var oy = st.obj[y];
      st.obj[i] = O.EMPTY;
      st.done[i] = 0;
      // a walk, a merge or clearing Thicket is the unit's action
      st.obj[y] = unitObj(isUnit(oy) ? tierOf(oy) + t : t);
      st.done[y] = 1;
      st.acts++;
      return true;
    }
    if (tg.take.indexOf(y) >= 0) {
      var keep = hallNear(st, i);
      st.obj[i] = O.EMPTY;
      st.done[i] = 0;
      capture(st, y, side, t, keep);
      st.acts++;
      checkOut(st);
      return true;
    }
    return false;
  }

  // Can the region holding cell `at` buy `kind` and place it on y?
  // Returns null when not, else { cost, info, how: "place"|"merge"|"take"|"clear" }.
  function canBuy(st, at, kind, y) {
    var info = buyInfo(st, at, kind);
    return info ? buyHow(st, info, kind, y) : null;
  }
  // The region's info when it may buy `kind` at all (gold, Hall), else null.
  function buyInfo(st, at, kind) {
    if (st.over >= 0 || st.own[at] !== st.turn) return null;
    var info = regionInfo(st, at);
    if (info.hall < 0 || info.cells.length < 2) return null;
    var cost = costOf(kind, info);
    if (!isFinite(cost) || info.gold < cost) return null;
    info.cost = cost;
    info.set = {};
    info.cells.forEach(function (x) { info.set[x] = true; });
    return info;
  }
  function buyHow(st, info, kind, y) {
    var cost = info.cost, inReg = !!info.set[y], oy = st.obj[y];
    var yes = function (how) { return { cost: cost, info: info, how: how }; };
    if (kind.charAt(0) === "u") {
      var t = +kind.charAt(1);
      if (inReg) {
        if (oy === O.EMPTY) return yes("place");
        if (oy === O.THICKET || oy === O.RUIN) return yes("clear");
        if (isUnit(oy) && tierOf(oy) + t <= 4) return yes("merge");
        return null;
      }
      if (!st.land[y] || st.own[y] === st.turn) return null;
      var touches = neighbours(st, y).some(function (x) { return info.set[x]; });
      if (!touches || t <= defence(st, y)) return null;
      return yes("take");
    }
    if (!inReg) return null;
    if (kind === "tower") return oy === O.EMPTY ? yes("place") : null;
    if (kind === "fort") return (oy === O.EMPTY || oy === O.TOWER) ? yes("place") : null;
    if (kind === "mill") {
      if (oy !== O.EMPTY) return null;
      var ok = neighbours(st, y).some(function (x) {
        return info.set[x] && (st.obj[x] === O.HALL || st.obj[x] === O.MILL);
      });
      return ok ? yes("place") : null;
    }
    return null;
  }
  // Every cell where the region at `at` can place `kind` now.
  function buyCells(st, at, kind) {
    var info = buyInfo(st, at, kind), out = [];
    if (!info) return out;
    for (var y = 0; y < st.land.length; y++) if (st.land[y] && buyHow(st, info, kind, y)) out.push(y);
    return out;
  }
  function buy(st, at, kind, y) {
    var ok = canBuy(st, at, kind, y);
    if (!ok) return false;
    var hall = ok.info.hall;
    st.gold[hall] -= ok.cost;
    if (kind.charAt(0) === "u") {
      var t = +kind.charAt(1), oy = st.obj[y];
      if (ok.how === "take") capture(st, y, st.turn, t, hall);
      else if (ok.how === "merge") st.obj[y] = unitObj(tierOf(oy) + t);
      else if (ok.how === "clear") { st.obj[y] = unitObj(t); st.done[y] = 1; }
      else { st.obj[y] = unitObj(t); st.done[y] = 0; }
    } else {
      st.obj[y] = kind === "tower" ? O.TOWER : kind === "fort" ? O.FORT : O.MILL;
    }
    st.acts++;
    checkOut(st);
    return true;
  }

  // ---------- Queries for the UI ----------
  function landCount(st) {
    var n = 0;
    for (var i = 0; i < st.land.length; i++) if (st.land[i]) n++;
    return n;
  }
  function share(st, side) {
    var n = 0;
    for (var i = 0; i < st.own.length; i++) if (st.own[i] === side) n++;
    return n / Math.max(1, landCount(st));
  }
  function alive(st) {
    var out = [];
    for (var s = 0; s < st.sides.length; s++) if (!st.sides[s].out) out.push(s);
    return out;
  }
  // The computer sides offer to give up: exactly one person left among
  // the living sides, holding 75% of the land, offer not declined yet.
  function surrenderOffer(st) {
    if (st.over >= 0 || st.nos) return -1;
    var humans = alive(st).filter(function (s) { return st.sides[s].k === "h"; });
    if (humans.length !== 1 || alive(st).length < 2) return -1;
    return share(st, humans[0]) >= SURRENDER_SHARE ? humans[0] : -1;
  }
  function surrender(st, side) {
    st.over = side;
    return true;
  }
  // Units of the current side that may still act.
  function readyUnits(st) {
    var out = [];
    for (var i = 0; i < st.obj.length; i++) {
      if (st.own[i] === st.turn && isUnit(st.obj[i]) && !st.done[i]) {
        var tg = targets(st, i);
        if (tg.walk.length || tg.take.length) out.push(i);
      }
    }
    return out;
  }

  // ---------- Computer player ----------
  // planTurn(st, side's level) → [action]; action = { a: "move", i, y }
  // or { a: "buy", at, kind, y }. Plans on a copy, one greedy step at a
  // time, with a fixed work budget (counted, not timed), so a slow
  // phone and a fast PC play the same moves.
  //   e: random captures, cheap units, may overspend; no buildings
  //   m: best value per gold, never a unit the region cannot keep,
  //      Mills when the region has spare gold
  //   h: m + cutting enemy regions in two, the weakest neighbour
  //      first, Watchtowers and idle units on threatened borders; and
  //      it looks ahead: four greedy plans (two with a little seeded
  //      noise) are each played out until this side's next turn, the
  //      neighbours answering with Medium plans, and the plan that
  //      leaves the best position is played
  var AI_MAX_ACTS = 60, AI_BUDGET = 60000;

  function aiRand(st) {
    return stream("ai:" + st.seed + ":" + st.round + ":" + st.turn + ":" + st.acts);
  }
  // Would taking y cut its owner's region in two (or more)?
  function splits(st, y) {
    var side = st.own[y];
    if (side < 0) return false;
    var nb = neighbours(st, y).filter(function (x) { return st.own[x] === side; });
    if (nb.length < 2) return false;
    st.own[y] = -2;
    var first = regionOf(st, nb[0]);
    st.own[y] = side;
    return nb.some(function (x) { return first.indexOf(x) < 0; });
  }
  function takeValue(st, y, side, lv, weak) {
    var o = st.obj[y], owner = st.own[y], v = 1;
    if (owner >= 0) {
      v += 2;
      if (o === O.HALL) v += 6;
      else if (o === O.MILL) v += 3;
      else if (o === O.TOWER || o === O.FORT) v += 2;
      else if (isUnit(o)) v += 2 * tierOf(o);
      if (lv === "h") {
        if (splits(st, y)) v += 4;
        if (owner === weak) v += 1.5;
      }
    }
    if (lv !== "e") {
      var nb = neighbours(st, y), mine = 0;
      for (var k = 0; k < nb.length; k++) if (st.own[nb[k]] === side) mine++;
      v += 0.3 * mine;
    }
    return v;
  }
  // The living enemy with the least land (Hard's focus).
  function weakest(st, side) {
    var best = -1, bestS = 2;
    alive(st).forEach(function (s) {
      if (s === side) return;
      var sh = share(st, s);
      if (sh < bestS) { bestS = sh; best = s; }
    });
    return best;
  }
  // Border cells of a region that an enemy unit next door could take.
  function threatened(st, reg, side) {
    var out = [];
    reg.forEach(function (y) {
      var nb = neighbours(st, y), worst = 0;
      for (var k = 0; k < nb.length; k++) {
        var x = nb[k];
        if (st.own[x] >= 0 && st.own[x] !== side) {
          // the strongest enemy unit within reach of that border
          neighbours(st, x).concat([x]).forEach(function (z) {
            if (st.own[z] === st.own[x] && isUnit(st.obj[z])) worst = Math.max(worst, tierOf(st.obj[z]));
          });
          worst = Math.max(worst, 1);
        }
      }
      if (worst && worst > defence(st, y)) out.push(y);
    });
    return out;
  }

  // How many threatened cells a unit of tier t on y would guard better.
  function cover(st, y, t, thr) {
    var c = 0, around = neighbours(st, y).concat([y]);
    for (var k = 0; k < around.length; k++) {
      if (thr.indexOf(around[k]) >= 0 && defence(st, around[k]) < t) c++;
    }
    return c;
  }
  function candidates(st, lv, work) {
    var side = st.turn, out = [], def = defenceMap(st);
    var weak = lv === "h" ? weakest(st, side) : -1;
    // Units that can act
    for (var i = 0; i < st.obj.length; i++) {
      if (st.own[i] !== side || !isUnit(st.obj[i]) || st.done[i]) continue;
      var tg = targets(st, i, def);
      work.n += tg.take.length + tg.walk.length + 4;
      tg.take.forEach(function (y) {
        out.push({ a: "move", i: i, y: y, s: takeValue(st, y, side, lv, weak) + 0.5 });
      });
      if (lv !== "e") tg.walk.forEach(function (y) {
        if (st.obj[y] === O.THICKET || st.obj[y] === O.RUIN) out.push({ a: "move", i: i, y: y, s: 0.9 });
      });
      // Hard: a unit with nothing to take stands guard where the border
      // is weakest (a unit guards the cells around it).
      if (lv === "h" && !tg.take.length) {
        var tier = tierOf(st.obj[i]), thr = threatened(st, regionOf(st, i), side);
        work.n += thr.length * 6;
        var best = -1, bestC = cover(st, i, tier, thr);
        tg.walk.forEach(function (y) {
          if (st.obj[y] !== O.EMPTY) return;
          var c = cover(st, y, tier, thr);
          if (c > bestC) { bestC = c; best = y; }
        });
        if (best >= 0) out.push({ a: "move", i: i, y: best, s: 0.35 + 0.15 * bestC });
      }
    }
    // Buys, region by region
    regions(st, side).forEach(function (reg) {
      if (reg.length < 2) return;
      var at = reg[0], info = regionInfo(st, at);
      if (info.hall < 0 || info.gold < UNIT_COST[1]) return;
      var seen = {};
      reg.forEach(function (x) {
        neighbours(st, x).forEach(function (y) {
          if (seen[y] || !st.land[y] || st.own[y] === side) return;
          seen[y] = true;
          work.n += 6;
          var need = def[y] + 1;
          if (need > 4 || (lv === "e" && need > 2)) return;
          var cost = UNIT_COST[need];
          if (info.gold < cost) return;
          var newNet = info.net + 1 - UNIT_UPKEEP[need];    // +1: the cell taken
          if (lv === "e" ? newNet < -3 : newNet < 0) return;
          var sc = takeValue(st, y, side, lv, weak) - cost / (lv === "e" ? 40 : 14);
          // Hard keeps a reserve when the region's balance is thin
          if (lv === "h" && newNet < 2 && info.gold - cost < 10) sc -= 0.6;
          out.push({ a: "buy", at: at, kind: "u" + need, y: y, s: sc });
        });
      });
      if (lv === "e") return;
      // Mills: when the region keeps a reserve after paying
      var mc = millCost(info.mills);
      if (info.gold >= mc) {
        var spots = buyCells(st, at, "mill");
        work.n += reg.length;
        if (spots.length) out.push({ a: "buy", at: at, kind: "mill", y: spots[0], s: 2.6 - 0.25 * info.mills - mc / 40 });
      }
      // Watchtowers (Hard): the border cell that covers most threatened cells
      if (lv === "h" && info.gold >= TOWER_COST + 4 && info.net >= TOWER_UPKEEP + 1) {
        var thr = threatened(st, reg, side);
        work.n += reg.length * 6;
        if (thr.length >= 2) {
          var bestY = -1, bestC = 1;
          reg.forEach(function (y) {
            if (st.obj[y] !== O.EMPTY) return;
            var c = 0, cover = neighbours(st, y).concat([y]);
            for (var k = 0; k < cover.length; k++) if (thr.indexOf(cover[k]) >= 0) c++;
            if (c > bestC) { bestC = c; bestY = y; }
          });
          if (bestY >= 0) out.push({ a: "buy", at: at, kind: "tower", y: bestY, s: 0.8 + 0.5 * bestC });
        }
      }
    });
    return out;
  }

  function apply(st, act) {
    return act.a === "move" ? move(st, act.i, act.y) : buy(st, act.at, act.kind, act.y);
  }

  function planTurn(st0, lv) {
    if (LEVELS.indexOf(lv) < 0) lv = "m";
    if (lv === "h") return planHard(st0);
    return greedy(st0, lv, 0);
  }
  // Hard: a few greedy plans, each played out to this side's next turn
  // (the others answer with Medium plans); the plan that leaves the
  // best position wins.
  function evalSide(st, side) {
    if (st.sides[side].out) return -1e6;
    if (st.over === side) return 1e6;
    var v = 0;
    regions(st, side).forEach(function (reg) {
      if (reg.length < 2) return;
      var info = regionInfo(st, reg[0]);
      v += reg.length * 3 + info.net * 1.5 + info.gold * 0.15;
      reg.forEach(function (x) { if (isUnit(st.obj[x])) v += tierOf(st.obj[x]) * 2; });
    });
    return v;
  }
  // The sides whose land touches this side's land: { side: true }.
  function neighboursOf(st, side) {
    var out = {};
    for (var i = 0; i < st.own.length; i++) {
      if (st.own[i] !== side) continue;
      var nb = neighbours(st, i);
      for (var k = 0; k < nb.length; k++) {
        var o = st.own[nb[k]];
        if (o >= 0 && o !== side) out[o] = true;
      }
    }
    return out;
  }
  function planHard(st0) {
    var side = st0.turn, best = null, bestV = -Infinity;
    // A side that already holds most of the island just presses on.
    if (share(st0, side) > 0.45) return greedy(st0, "h", 0);
    var near = neighboursOf(st0, side);
    var variants = [["h", 0], ["m", 0], ["h", 1], ["h", 2]];
    for (var k = 0; k < variants.length; k++) {
      var p = greedy(st0, variants[k][0], variants[k][1]);
      var s = clone(st0);
      p.forEach(function (a) { apply(s, a); });
      endTurn(s);
      var guard = 0;
      while (s.over < 0 && s.turn !== side && guard++ < 8) {
        // only the sides on this side's border answer; the others pass
        if (near[s.turn]) greedy(s, "m", 0).forEach(function (a) { apply(s, a); });
        endTurn(s);
      }
      var v = evalSide(s, side);
      if (v > bestV) { bestV = v; best = p; }
    }
    return best;
  }
  function greedy(st0, lv, noise) {
    var st = clone(st0), side = st.turn, plan = [], work = { n: 0 };
    var rnd = aiRand(st0);
    var nrnd = stream("noise:" + noise + ":" + st0.seed + ":" + st0.round + ":" + st0.turn);
    var limit = lv === "e" ? 1 + Math.floor(rnd() * 5) : AI_MAX_ACTS;
    while (plan.length < limit && work.n < AI_BUDGET && st.over < 0 && st.turn === side) {
      var cs = candidates(st, lv, work).filter(function (c) { return c.s > 0.3; });
      if (!cs.length) break;
      var pick;
      if (lv === "e") pick = cs[Math.floor(rnd() * cs.length)];
      else {
        if (noise) cs.forEach(function (c) { c.s += (nrnd() - 0.5) * noise; });
        pick = cs[0];
        for (var k = 1; k < cs.length; k++) if (cs[k].s > pick.s) pick = cs[k];
      }
      var act = pick.a === "move" ? { a: "move", i: pick.i, y: pick.y } : { a: "buy", at: pick.at, kind: pick.kind, y: pick.y };
      if (!apply(st, act)) break;
      plan.push(act);
    }
    return plan;
  }

  // ---------- Checking a stored state ----------
  function isInt(v) { return typeof v === "number" && isFinite(v) && Math.floor(v) === v; }
  function valid(st) {
    if (!st || typeof st !== "object" || st.v !== 1 || !SIZES[st.size]) return false;
    var spec = SIZES[st.size];
    if (st.W !== spec.W || st.H !== spec.H) return false;
    var n = st.W * st.H;
    var lists = ["land", "own", "obj", "done", "gold"];
    for (var k = 0; k < lists.length; k++) {
      var a = st[lists[k]];
      if (!Array.isArray(a) || a.length !== n) return false;
      for (var i = 0; i < n; i++) if (!isInt(a[i])) return false;
    }
    if (!Array.isArray(st.sides) || st.sides.length < 2 || st.sides.length > MAX_SIDES) return false;
    for (var s = 0; s < st.sides.length; s++) {
      var sd = st.sides[s];
      if (!sd || (sd.k !== "h" && sd.k !== "c") || LEVELS.indexOf(sd.lv) < 0 || typeof sd.out !== "boolean") return false;
    }
    for (var j = 0; j < n; j++) {
      if (st.land[j] !== 0 && st.land[j] !== 1) return false;
      if (st.own[j] < -1 || st.own[j] >= st.sides.length) return false;
      if (st.obj[j] < 0 || st.obj[j] > O.U4) return false;
      if (!st.land[j] && (st.own[j] !== -1 || st.obj[j] !== 0)) return false;
      if (st.gold[j] < 0) return false;
    }
    if (!isInt(st.turn) || st.turn < 0 || st.turn >= st.sides.length) return false;
    if (!isInt(st.round) || st.round < 1 || !isInt(st.rng) || !isInt(st.acts) || st.acts < 0) return false;
    if (!isInt(st.over) || st.over < -1 || st.over >= st.sides.length) return false;
    return typeof st.seed === "string" && st.seed.length <= 64;
  }
  function clone(st) { return JSON.parse(JSON.stringify(st)); }

  var api = {
    O: O, SIZES: SIZES, LEVELS: LEVELS, KINDS: KINDS, MAX_SIDES: MAX_SIDES,
    UNIT_COST: UNIT_COST, UNIT_UPKEEP: UNIT_UPKEEP, TOWER_COST: TOWER_COST, FORT_COST: FORT_COST,
    MILL_GAIN: MILL_GAIN, MOVE_STEPS: MOVE_STEPS, SURRENDER_SHARE: SURRENDER_SHARE,
    hashStr: hashStr, stream: stream, step: step,
    makeMap: makeMap, neighbours: neighbours, around: around, regionOf: regionOf, regions: regions, hallOf: hallOf,
    regionInfo: regionInfo, costOf: costOf, millCost: millCost, defence: defence,
    isUnit: isUnit, tierOf: tierOf, strengthOf: strengthOf, upkeepOf: upkeepOf,
    targets: targets, move: move, canBuy: canBuy, buyCells: buyCells, buy: buy,
    endTurn: endTurn, settle: settle, nature: nature, beginTurn: beginTurn, checkOut: checkOut,
    landCount: landCount, share: share, alive: alive, surrenderOffer: surrenderOffer,
    surrender: surrender, readyUnits: readyUnits, valid: valid, clone: clone,
    planTurn: planTurn, apply: apply, splits: splits
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.RealmEngine = api;
})(typeof window !== "undefined" ? window : this);
