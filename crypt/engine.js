// ============================================================
// orOS Crypt — rules engine (v1.0.0)
// NOT the UI: no DOM, no storage. Loaded by crypt/index.html
// (window.CryptEngine, after crypt/items.js) and by tests/crypt.test.js
// (module.exports).
//
// A turn-based dungeon crawler with a backpack puzzle. Original rules,
// numbers and names (plan: /mnt/project-files/games/strategy/
// crypt-plan.md, Bible Part IX "Crypt").
//
// Grid: W × H square cells, cell i = y * W + x; moves go up, right,
// down, left (d 0-3).
//
// State (plain JSON, kept as is in the device-local session):
//   { v: 1, seed, mode "g" Gentle | "r" Grim, floor 1-10, W, H,
//     map:   "#" wall, "." floor, ">" stairs (one string, W × H),
//     seen:  "0" | "1" per cell (one string),
//     traps: [{ i, k: 1 known }], chests: [i], gold: [{ i, n }],
//     loot:  [{ i, it }]     items lying on the floor,
//     mons:  [{ id, k, i, hp, aw: 1 awake, t: timer, m: 1 disguised,
//               n: intent { a: "m" move | "a" attack | "s" shoot, c: [cells] } | null }],
//     hero:  { i, hp, fo, gold, key, wd: 1 warded, kills },
//     pack:  { w, h, it: [{ k: item id, x, y, r: 0-3, c: 1 cursed }] },
//     turn, rng (uint32), nid, over: -1 playing | 0 fallen | 1 won }
//   it = { k, r, c } on the floor.
//
// Rules (also in crypt/help.en.txt):
//   - One action is one turn: step, attack (step into a monster), open
//     a chest (step into it), use an item, or wait. Then every awake
//     monster carries out the move it showed, and shows its next one.
//     An attack lands only if you are still on the cell it marked.
//   - Damage = attack − defence, at least 1. No dice.
//   - What you carry works only while it is in the backpack. Items
//     touch through ports; facing ports make a link: blade + blade +1
//     Attack, ward + ward +1 Defence, a rune with anything +1 Focus,
//     charm + charm +5 % gold, any other pair +2 Health.
//   - A cursed item cannot leave the backpack until a Cleansing scroll.
//   - 10 floors; the Warden on floor 10 holds the key, and the stairs
//     there are the way out.
// ============================================================
(function (root) {
  "use strict";

  var D = root.CryptData || (typeof require === "function" ? require("./items.js") : null);
  var SHAPES = D.SHAPES, ITEMS = D.ITEMS, MONS = D.MONS, MON_KINDS = D.MON_KINDS;
  var BY_ID = {};
  ITEMS.forEach(function (it) { BY_ID[it.id] = it; });

  var W = 21, H = 15, FLOORS = 10;
  var BASE = { hp: 20, atk: 1, def: 0, fo: 3, light: 4 };
  var GENTLE_HP = 6;
  var REGEN = 12, FOCUS_REGEN = 10;
  var WAKE = 7;
  var DX = [0, 1, 0, -1], DY = [-1, 0, 1, 0];
  var MODES = ["g", "r"];
  var CHECKPOINTS = [4, 7, 10];      // Gentle: a save point on arriving
  var SHRINE_FLOORS = [3, 6, 9];     // a shrine shop on these floors (5.56.00)
  var TIER_PRICE = [0, 8, 16, 28];   // + 2 per floor

  // ---------- Random numbers (no Math.random, no clock) ----------
  function hashStr(s) {
    var h = 0x811c9dc5;
    s = String(s);
    for (var i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    return h >>> 0;
  }
  // xorshift32 on an object { s } so map making and play keep their own.
  function rnd(o) {
    var x = o.s >>> 0 || 0x9e3779b9;
    x ^= x << 13; x >>>= 0;
    x ^= x >>> 17;
    x ^= x << 5; x >>>= 0;
    o.s = x;
    return x / 4294967296;
  }
  function rint(o, n) { return Math.floor(rnd(o) * n); }
  function playRng(st) {
    var o = { s: st.rng };
    return { next: function () { var v = rnd(o); st.rng = o.s; return v; },
             int: function (n) { var v = rint(o, n); st.rng = o.s; return v; } };
  }

  // ---------- Grid helpers ----------
  function xy(i) { return { x: i % W, y: Math.floor(i / W) }; }
  function idx(x, y) { return y * W + x; }
  function inside(x, y) { return x >= 0 && y >= 0 && x < W && y < H; }
  function step(i, d) {
    var p = xy(i), x = p.x + DX[d], y = p.y + DY[d];
    return inside(x, y) ? idx(x, y) : -1;
  }
  function dist(a, b) { var p = xy(a), q = xy(b); return Math.abs(p.x - q.x) + Math.abs(p.y - q.y); }
  function cheb(a, b) { var p = xy(a), q = xy(b); return Math.max(Math.abs(p.x - q.x), Math.abs(p.y - q.y)); }
  function open(st, i) { return i >= 0 && st.map.charAt(i) !== "#"; }
  function monAt(st, i) {
    for (var k = 0; k < st.mons.length; k++) if (st.mons[k].i === i && st.mons[k].hp > 0) return st.mons[k];
    return null;
  }
  function chestAt(st, i) { return st.chests.indexOf(i); }
  // Line of sight: Bresenham, walls stop it (the wall itself is seen).
  function los(st, a, b) {
    var p = xy(a), q = xy(b), x = p.x, y = p.y;
    var dx = Math.abs(q.x - x), dy = -Math.abs(q.y - y), sx = x < q.x ? 1 : -1, sy = y < q.y ? 1 : -1, e = dx + dy;
    while (!(x === q.x && y === q.y)) {
      if (!(x === p.x && y === p.y) && st.map.charAt(idx(x, y)) === "#") return false;
      var e2 = 2 * e;
      if (e2 >= dy) { e += dy; x += sx; }
      if (e2 <= dx) { e += dx; y += sy; }
    }
    return true;
  }
  // Steps from a cell over open cells (blocked: cells to avoid).
  function bfs(st, from, blocked) {
    var d = [], q = [from], h = 0;
    for (var i = 0; i < W * H; i++) d.push(-1);
    d[from] = 0;
    while (h < q.length) {
      var c = q[h++];
      for (var k = 0; k < 4; k++) {
        var n = step(c, k);
        if (n < 0 || d[n] >= 0 || !open(st, n) || (blocked && blocked(n))) continue;
        d[n] = d[c] + 1;
        q.push(n);
      }
    }
    return d;
  }

  // ---------- Floors ----------
  // Rooms joined by corridors, from the run's seed and the floor
  // number only, so a floor is the same whatever happened before.
  function tierRoll(r, floor) {
    var v = rnd(r);
    if (floor <= 3) return v < 0.85 ? 1 : 2;
    if (floor <= 6) return v < 0.35 ? 1 : (v < 0.9 ? 2 : 3);
    return v < 0.1 ? 1 : (v < 0.6 ? 2 : 3);
  }
  function rollItem(r, floor, plus) {
    var tier = Math.min(3, tierRoll(r, floor) + (plus || 0));
    var pool = ITEMS.filter(function (it) { return it.tier === tier; });
    var it = pool[rint(r, pool.length)];
    var cur = it.cur ? 1 : (it.tier === 3 && (it.t === "b" || it.t === "w") && rnd(r) < 0.25 ? 1 : 0);
    return { k: it.id, r: 0, c: cur };
  }
  function pickMon(r, floor) {
    var pool = [], sum = 0;
    MON_KINDS.forEach(function (k) {
      var m = MONS[k];
      if (m.w > 0 && m.f <= floor) { pool.push(k); sum += m.w + (floor - m.f > 4 ? -1 : 0); }
    });
    var v = rnd(r) * sum;
    for (var j = 0; j < pool.length; j++) {
      v -= MONS[pool[j]].w + (floor - MONS[pool[j]].f > 4 ? -1 : 0);
      if (v < 0) return pool[j];
    }
    return pool[pool.length - 1];
  }
  function monStats(k, floor) {
    var m = MONS[k], up = Math.floor((floor - m.f) / 3);
    return { hp: m.hp + (k === "warden" ? 0 : up * 2), atk: m.atk + (k === "warden" ? 0 : Math.floor(up / 2)), def: m.def };
  }
  function makeFloor(seed, floor) {
    var r = { s: hashStr("crypt:" + seed + ":" + floor) || 1 };
    var cells = [], rooms = [];
    for (var i = 0; i < W * H; i++) cells.push("#");
    for (var a = 0; a < 80 && rooms.length < 7; a++) {
      var w = 3 + rint(r, 4), h = 3 + rint(r, 2);
      var x = 1 + rint(r, W - w - 1), y = 1 + rint(r, H - h - 1);
      var clash = rooms.some(function (o) {
        return x - 1 < o.x + o.w && x + w + 1 > o.x && y - 1 < o.y + o.h && y + h + 1 > o.y;
      });
      if (clash) continue;
      rooms.push({ x: x, y: y, w: w, h: h });
    }
    rooms.sort(function (p, q) { return (p.x + p.w / 2) - (q.x + q.w / 2) || p.y - q.y; });
    rooms.forEach(function (o) {
      for (var yy = o.y; yy < o.y + o.h; yy++) for (var xx = o.x; xx < o.x + o.w; xx++) cells[idx(xx, yy)] = ".";
    });
    function mid(o) { return { x: o.x + Math.floor(o.w / 2), y: o.y + Math.floor(o.h / 2) }; }
    function dig(p, q, flip) {
      var x0 = p.x, y0 = p.y;
      if (flip) {
        while (y0 !== q.y) { cells[idx(x0, y0)] = "."; y0 += y0 < q.y ? 1 : -1; }
        while (x0 !== q.x) { cells[idx(x0, y0)] = "."; x0 += x0 < q.x ? 1 : -1; }
      } else {
        while (x0 !== q.x) { cells[idx(x0, y0)] = "."; x0 += x0 < q.x ? 1 : -1; }
        while (y0 !== q.y) { cells[idx(x0, y0)] = "."; y0 += y0 < q.y ? 1 : -1; }
      }
      cells[idx(q.x, q.y)] = ".";
    }
    for (var k = 1; k < rooms.length; k++) dig(mid(rooms[k - 1]), mid(rooms[k]), rnd(r) < 0.5);
    if (rooms.length > 3) dig(mid(rooms[0]), mid(rooms[2]), rnd(r) < 0.5);   // one loop
    var st = { map: cells.join("") };
    var start = idx(mid(rooms[0]).x, mid(rooms[0]).y);
    var d = bfs(st, start);
    // the stairs: the floor cell of the last rooms farthest away
    var far = start, best = -1;
    rooms.slice(-2).forEach(function (o) {
      for (var yy = o.y; yy < o.y + o.h; yy++) for (var xx = o.x; xx < o.x + o.w; xx++) {
        var c = idx(xx, yy);
        if (d[c] > best) { best = d[c]; far = c; }
      }
    });
    cells[far] = ">";
    var map = cells.join("");
    st.map = map;
    // free cells away from the start, in room order
    var used = {}; used[start] = 1; used[far] = 1;
    function freeCell(minD, roomOnly) {
      for (var tries = 0; tries < 200; tries++) {
        var c;
        if (roomOnly) {
          var o = rooms[1 + rint(r, rooms.length - 1)];
          c = idx(o.x + rint(r, o.w), o.y + rint(r, o.h));
        } else c = rint(r, W * H);
        if (map.charAt(c) !== "." || used[c] || d[c] < minD) continue;
        used[c] = 1;
        return c;
      }
      return -1;
    }
    var out = { map: map, start: start, stairs: far, mons: [], chests: [], loot: [], gold: [], traps: [] };
    var nMon = floor === FLOORS ? 4 : Math.min(10, 3 + floor);
    for (var m = 0; m < nMon; m++) {
      var c = freeCell(5, true);
      if (c < 0) continue;
      var kind = pickMon(r, floor);
      out.mons.push({ k: kind, i: c });
    }
    if (floor === FLOORS) {
      var wc = -1;
      [0, 1, 2, 3].some(function (dd) { var n = step(far, dd); if (n >= 0 && map.charAt(n) === "." && !used[n]) { wc = n; return true; } return false; });
      if (wc >= 0) { used[wc] = 1; out.mons.push({ k: "warden", i: wc }); }
    }
    var nChest = 1 + (rnd(r) < 0.5 ? 1 : 0);
    for (var ch = 0; ch < nChest; ch++) {
      var cc = freeCell(3, true);
      if (cc < 0) continue;
      if (floor >= 3 && rnd(r) < 0.3) out.mons.push({ k: "mimic", i: cc, m: 1 });
      else out.chests.push({ i: cc, it: rollItem(r, floor, rnd(r) < 0.4 ? 1 : 0) });
    }
    var nLoot = 1 + (floor % 2);
    for (var l = 0; l < nLoot; l++) {
      var lc = freeCell(2, false);
      if (lc >= 0) out.loot.push({ i: lc, it: rollItem(r, floor, 0) });
    }
    if (floor % 3 === 2) {   // a potion on every third floor
      var pc = freeCell(2, false);
      if (pc >= 0) out.loot.push({ i: pc, it: { k: floor < 6 ? "vial" : "flask", r: 0, c: 0 } });
    }
    var nGold = 2 + rint(r, 2);
    for (var g = 0; g < nGold; g++) {
      var gc = freeCell(2, false);
      if (gc >= 0) out.gold.push({ i: gc, n: 2 + floor + rint(r, 3 + floor) });
    }
    var nTrap = Math.min(5, floor - 1);
    for (var tr = 0; tr < nTrap; tr++) {
      var tc = freeCell(3, false);
      if (tc >= 0) out.traps.push({ i: tc, k: 0 });
    }
    return out;
  }

  // ---------- Items in the backpack ----------
  function item(k) { return BY_ID[k] || null; }
  // The cells and ports of a shape turned r quarter turns clockwise,
  // moved so the top-left is at 0, 0.
  function shapeOf(k, r) {
    var def = item(k), cells = SHAPES[def.sh].map(function (c) { return [c[0], c[1]]; });
    var ports = def.ports.map(function (p) { return [p[0], p[1]]; });
    for (var t = 0; t < (r || 0); t++) {
      cells = cells.map(function (c) { return [-c[1], c[0]]; });
      ports = ports.map(function (p) { return [p[0], (p[1] + 1) % 4]; });
    }
    var mx = Infinity, my = Infinity;
    cells.forEach(function (c) { mx = Math.min(mx, c[0]); my = Math.min(my, c[1]); });
    cells = cells.map(function (c) { return [c[0] - mx, c[1] - my]; });
    return { cells: cells, ports: ports };
  }
  function packSize(floor) { return floor >= 7 ? { w: 8, h: 5 } : (floor >= 4 ? { w: 7, h: 5 } : { w: 6, h: 4 }); }
  // grid[y * w + x] = index of the item there, or -1.
  function packGrid(pack, skip) {
    var g = [];
    for (var i = 0; i < pack.w * pack.h; i++) g.push(-1);
    pack.it.forEach(function (p, n) {
      if (n === skip) return;
      shapeOf(p.k, p.r).cells.forEach(function (c) { g[(p.y + c[1]) * pack.w + p.x + c[0]] = n; });
    });
    return g;
  }
  function fits(pack, k, x, y, r, skip) {
    var g = packGrid(pack, skip);
    return shapeOf(k, r).cells.every(function (c) {
      var cx = x + c[0], cy = y + c[1];
      return cx >= 0 && cy >= 0 && cx < pack.w && cy < pack.h && g[cy * pack.w + cx] < 0;
    });
  }
  // First place (reading order, then turns) where an item fits.
  function findSpot(pack, k) {
    for (var r = 0; r < 4; r++) {
      for (var y = 0; y < pack.h; y++) for (var x = 0; x < pack.w; x++) {
        if (fits(pack, k, x, y, r, -1)) return { x: x, y: y, r: r };
      }
    }
    return null;
  }
  // Links: [itemA, itemB, kind] for facing ports. A cursed item does
  // not link until it is cleansed (5.56.00).
  function packLinks(pack) {
    var g = packGrid(pack, -1), out = [], seen = {};
    pack.it.forEach(function (p, n) {
      if (p.c) return;
      var sh = shapeOf(p.k, p.r);
      sh.ports.forEach(function (pt) {
        var c = sh.cells[pt[0]], x = p.x + c[0], y = p.y + c[1];
        var nx = x + DX[pt[1]], ny = y + DY[pt[1]];
        if (nx < 0 || ny < 0 || nx >= pack.w || ny >= pack.h) return;
        var m = g[ny * pack.w + nx];
        if (m < 0 || m === n) return;
        var q = pack.it[m];
        if (q.c) return;
        var sq = shapeOf(q.k, q.r);
        var back = sq.ports.some(function (pp) {
          var cc = sq.cells[pp[0]];
          return q.x + cc[0] === nx && q.y + cc[1] === ny && pp[1] === (pt[1] + 2) % 4;
        });
        if (!back) return;
        var key = Math.min(n, m) + ":" + Math.max(n, m) + ":" + Math.min(x + y * 99, nx + ny * 99);
        if (seen[key]) return;
        seen[key] = 1;
        out.push({ a: n, b: m, x: x, y: y, d: pt[1], kind: linkKind(item(p.k).t, item(q.k).t) });
      });
    });
    return out;
  }
  function linkKind(ta, tb) {
    if (ta === "b" && tb === "b") return "atk";
    if (ta === "w" && tb === "w") return "def";
    if (ta === "r" || tb === "r") return "fo";
    if (ta === "c" && tb === "c") return "gold";
    return "hp";
  }
  // What the hero has with this backpack.
  function stats(st) {
    var s = { atk: BASE.atk, def: BASE.def, mhp: BASE.hp + (st.mode === "g" ? GENTLE_HP : 0), mfo: BASE.fo,
      light: BASE.light, trap: 0, gold: 0, regen: REGEN, frg: FOCUS_REGEN, links: [] };
    st.pack.it.forEach(function (p) {
      var it = item(p.k);
      s.atk += it.atk || 0; s.def += it.def || 0; s.mhp += it.hp || 0; s.mfo += it.fo || 0;
      s.light += it.light || 0; s.gold += it.gold || 0;
      if (it.trap) s.trap = 1;
      if (it.regen) s.regen = Math.min(s.regen, it.regen);
      if (it.frg) s.frg = Math.min(s.frg, it.frg);
    });
    s.links = packLinks(st.pack);
    s.links.forEach(function (l) {
      if (l.kind === "atk") s.atk++;
      else if (l.kind === "def") s.def++;
      else if (l.kind === "fo") s.mfo++;
      else if (l.kind === "gold") s.gold += 5;
      else s.mhp += 2;
    });
    s.atk = Math.max(1, s.atk);
    s.def = Math.max(0, s.def);
    return s;
  }
  function clampHero(st) {
    var s = stats(st);
    st.hero.hp = Math.min(st.hero.hp, s.mhp);
    st.hero.fo = Math.min(st.hero.fo, s.mfo);
    return s;
  }
  // Packing (no turn): put a floor item in, move one, take one out.
  function groundAt(st) {
    var out = [];
    st.loot.forEach(function (l, n) { if (l.i === st.hero.i) out.push(n); });
    return out;
  }
  function packAdd(st, lootIdx, x, y, r) {
    var l = st.loot[lootIdx];
    if (!l || l.i !== st.hero.i || !fits(st.pack, l.it.k, x, y, r, -1)) return false;
    st.pack.it.push({ k: l.it.k, x: x, y: y, r: r, c: l.it.c ? 1 : 0 });
    st.loot.splice(lootIdx, 1);
    clampHero(st);
    return true;
  }
  function packMove(st, n, x, y, r) {
    var p = st.pack.it[n];
    if (!p || !fits(st.pack, p.k, x, y, r, n)) return false;
    p.x = x; p.y = y; p.r = r;
    clampHero(st);
    return true;
  }
  function packDrop(st, n) {
    var p = st.pack.it[n];
    if (!p || p.c) return false;
    st.pack.it.splice(n, 1);
    st.loot.push({ i: st.hero.i, it: { k: p.k, r: p.r, c: 0 } });
    clampHero(st);
    return true;
  }
  // Packs a floor item into the first free spot; cursed ones stay.
  function autoPick(st, lootIdx) {
    var l = st.loot[lootIdx];
    if (!l || l.it.c) return false;
    var sp = findSpot(st.pack, l.it.k);
    return sp ? packAdd(st, lootIdx, sp.x, sp.y, sp.r) : false;
  }

  // ---------- Shrine (5.56.00) ----------
  // A shrine on floors 3, 6 and 9: a floor cell 2–6 steps from the
  // start, and three items for sale (never cursed). It uses its own
  // random numbers, so the floors themselves stay as they were.
  function placeShrine(st, floor) {
    if (SHRINE_FLOORS.indexOf(floor) < 0) return;
    var r = { s: hashStr("shrine:" + st.seed + ":" + floor) || 1 };
    var d = bfs(st, st.hero.i), cand = [];
    var taken = {};
    st.mons.forEach(function (m) { taken[m.i] = 1; });
    st.chests.forEach(function (c) { taken[c] = 1; });
    st.loot.forEach(function (l) { taken[l.i] = 1; });
    st.gold.forEach(function (g) { taken[g.i] = 1; });
    st.traps.forEach(function (t) { taken[t.i] = 1; });
    for (var i = 0; i < W * H; i++) {
      if (st.map.charAt(i) === "." && d[i] >= 2 && d[i] <= 6 && !taken[i]) cand.push(i);
    }
    if (!cand.length) return;
    var at = cand[rint(r, cand.length)], it = [], got = {};
    for (var k = 0; k < 3; k++) {
      var x = null;
      for (var a = 0; a < 6 && (!x || got[x.k]); a++) x = rollItem(r, floor, k === 2 ? 1 : 0);
      got[x.k] = 1;
      it.push({ k: x.k, r: 0, c: 0 });
    }
    st.shrine = { i: at, it: it };
  }
  function shrinePrice(st, what) {
    if (what === "heal") return 4 + st.floor;
    if (what === "cleanse") return 10 + 2 * st.floor;
    var x = st.shrine && st.shrine.it[what];
    return x ? TIER_PRICE[item(x.k).tier] + 2 * st.floor : 0;
  }
  // An awake monster can see the hero (packing then costs a turn, the
  // shrine stays silent).
  function watched(st) {
    return st.mons.some(function (m) { return m.hp > 0 && m.aw && !m.m && cheb(m.i, st.hero.i) <= 7 && los(st, m.i, st.hero.i); });
  }
  // what: "heal" | "cleanse" | 0–2 (an item). No turn passes. Returns
  // the events, or null when it is not possible (not on the shrine,
  // watched, not enough gold, nothing to do, sold).
  function shrineBuy(st, what) {
    var sh = st.shrine, h = st.hero;
    if (!sh || st.over >= 0 || h.i !== sh.i || watched(st)) return null;
    var cost = shrinePrice(st, what), s = stats(st), ev = [];
    if (what === "heal") {
      if (h.hp >= s.mhp) return null;
    } else if (what === "cleanse") {
      if (!st.pack.it.some(function (x) { return x.c; })) return null;
    } else if (!isInt(what) || what < 0 || what > 2 || !sh.it[what]) return null;
    if (h.gold < cost) return null;
    h.gold -= cost;
    if (what === "heal") { ev.push({ e: "heal", n: s.mhp - h.hp }); h.hp = s.mhp; }
    else if (what === "cleanse") { st.pack.it.forEach(function (x) { x.c = 0; }); ev.push({ e: "cleanse" }); }
    else {
      var x = sh.it[what];
      sh.it[what] = null;
      st.loot.push({ i: h.i, it: { k: x.k, r: 0, c: 0 } });
      var n = st.loot.length - 1;
      ev.push({ e: "bought", k: x.k });
      if (autoPick(st, n)) ev.push({ e: "pick", k: x.k });
      else ev.push({ e: "full", k: x.k });
    }
    return ev;
  }

  // ---------- New run ----------
  // end: the last floor (the Daily crypt is a short descent, 5.55.00);
  // a run with a short end is won on that floor's stairs, no key needed.
  function newRun(seed, mode, end) {
    mode = MODES.indexOf(mode) >= 0 ? mode : "g";
    var st = { v: 1, seed: String(seed || "crypt").slice(0, 64), mode: mode, floor: 0, W: W, H: H,
      map: "", seen: "", traps: [], chests: [], gold: [], loot: [], mons: [],
      hero: { i: 0, hp: 0, fo: 0, gold: 0, key: 0, wd: 0, kills: 0 },
      pack: { w: 6, h: 4, it: [] }, turn: 0, rng: hashStr("play:" + seed) || 1, nid: 1, over: -1 };
    if (isInt(end) && end >= 1 && end < FLOORS) st.end = end;
    var start = ["dagger", "buckler"].concat(mode === "g" ? ["vial"] : []);
    start.forEach(function (k) {
      var sp = findSpot(st.pack, k);
      st.pack.it.push({ k: k, x: sp.x, y: sp.y, r: sp.r, c: 0 });
    });
    var s = stats(st);
    st.hero.hp = s.mhp;
    st.hero.fo = s.mfo;
    enterFloor(st, 1, []);
    return st;
  }
  function enterFloor(st, floor, ev) {
    var f = makeFloor(st.seed, floor);
    st.floor = floor;
    st.map = f.map;
    st.traps = f.traps;
    st.chests = f.chests.map(function (c) { return c.i; });
    st.chestItems = f.chests.map(function (c) { return c.it; });
    st.gold = f.gold;
    st.loot = f.loot;
    st.mons = f.mons.map(function (m) {
      var s = monStats(m.k, floor);
      return { id: st.nid++, k: m.k, i: m.i, hp: s.hp, aw: 0, t: 0, m: m.m ? 1 : 0, n: null };
    });
    st.hero.i = f.start;
    st.hero.wd = 0;
    delete st.shrine;
    placeShrine(st, floor);
    var size = packSize(floor);
    st.pack.w = Math.max(st.pack.w, size.w);
    st.pack.h = Math.max(st.pack.h, size.h);
    var z = "";
    for (var i = 0; i < W * H; i++) z += "0";
    st.seen = z;
    look(st, ev);
    plan(st);
    if (ev) ev.push({ e: "floor", n: floor });
  }

  // ---------- Seeing ----------
  function visible(st) {
    var s = stats(st), out = [], h = st.hero.i;
    for (var i = 0; i < W * H; i++) {
      if (cheb(i, h) <= s.light && los(st, h, i)) out.push(i);
    }
    return out;
  }
  function look(st, ev) {
    var vis = visible(st), seen = st.seen.split(""), s = stats(st);
    vis.forEach(function (i) { seen[i] = "1"; });
    st.seen = seen.join("");
    if (s.trap) st.traps.forEach(function (t) { if (cheb(t.i, st.hero.i) <= 2) t.k = 1; });
    // monsters that see you wake up
    st.mons.forEach(function (m) {
      if (m.hp <= 0 || m.aw) return;
      if (m.m) { if (dist(m.i, st.hero.i) === 1) { m.m = 0; m.aw = 1; if (ev) ev.push({ e: "mimic", i: m.i }); } return; }
      if (cheb(m.i, st.hero.i) <= WAKE && los(st, m.i, st.hero.i)) {
        m.aw = 1;
        if (ev) ev.push({ e: "wake", i: m.i, k: m.k });
        if (m.k === "ghoul") {
          if (ev) ev.push({ e: "bell", i: m.i });
          st.mons.forEach(function (o) { if (o.hp > 0 && !o.m && cheb(o.i, m.i) <= 8) o.aw = 1; });
        }
      }
    });
    return vis;
  }

  // ---------- Monsters ----------
  function freeFor(st, i) { return open(st, i) && i !== st.hero.i && !monAt(st, i) && chestAt(st, i) < 0; }
  function toward(st, m) {
    var d = bfs(st, st.hero.i, function (n) { return n !== m.i && (monAt(st, n) || chestAt(st, n) >= 0); });
    var best = -1, bd = d[m.i] >= 0 ? d[m.i] : 999;
    for (var k = 0; k < 4; k++) {
      var n = step(m.i, k);
      if (n < 0 || !freeFor(st, n) || d[n] < 0) continue;
      if (d[n] < bd) { bd = d[n]; best = n; }
    }
    return best;
  }
  function away(st, m) {
    var best = -1, bd = dist(m.i, st.hero.i);
    for (var k = 0; k < 4; k++) {
      var n = step(m.i, k);
      if (n < 0 || !freeFor(st, n)) continue;
      var dd = dist(n, st.hero.i);
      if (dd > bd) { bd = dd; best = n; }
    }
    return best;
  }
  // A straight clear line from a to b (same row or column): its cells.
  function lineTo(st, a, b, max) {
    var p = xy(a), q = xy(b);
    if (p.x !== q.x && p.y !== q.y) return null;
    var n = dist(a, b);
    if (n < 1 || n > max) return null;
    var sx = Math.sign(q.x - p.x), sy = Math.sign(q.y - p.y), out = [];
    for (var k = 1; k <= n; k++) {
      var c = idx(p.x + sx * k, p.y + sy * k);
      if (st.map.charAt(c) === "#") return null;
      if (k < n && monAt(st, c)) return null;
      out.push(c);
    }
    return out;
  }
  // The move a monster shows for its next turn.
  function intent(st, m) {
    var h = st.hero.i;
    if (m.hp <= 0 || !m.aw || m.m) return null;
    if ((m.k === "slime" || m.k === "brute") && timer(m) % 2 === 1) return { a: "rest", c: [] };
    if (m.k === "guard") {
      var p = xy(m.i), q = xy(h);
      if ((p.x === q.x || p.y === q.y) && dist(m.i, h) > 1) return { a: "rest", c: [] };
    }
    if (dist(m.i, h) === 1) return { a: "a", c: [h] };
    if (m.k === "archer") {
      var ln = lineTo(st, m.i, h, 6);
      if (ln && ln.length >= 2) return { a: "s", c: ln };
      if (dist(m.i, h) < 3) { var aw = away(st, m); if (aw >= 0) return { a: "m", c: [aw] }; }
    }
    if (m.k === "spider") {
      var sl = lineTo(st, m.i, h, 4);
      if (sl && sl.length >= 3 && freeFor(st, sl[sl.length - 2])) return { a: "m", c: [sl[sl.length - 2]] };
    }
    var n = toward(st, m);
    if (n < 0) return { a: "rest", c: [] };
    if (m.k === "bat") {
      var save = m.i;
      m.i = n;
      var n2 = dist(n, h) > 1 ? toward(st, m) : -1;
      m.i = save;
      return { a: "m", c: n2 >= 0 && n2 !== save ? [n, n2] : [n] };
    }
    return { a: "m", c: [n] };
  }
  function plan(st) {
    st.mons.forEach(function (m) { m.n = intent(st, m); });
  }
  function hurtHero(st, m, ev) {
    var s = stats(st), st0 = monStats(m.k, st.floor);
    if (st.hero.wd) { st.hero.wd = 0; ev.push({ e: "warded", i: m.i }); return; }
    var dmg = Math.max(1, st0.atk - s.def);
    st.hero.hp -= dmg;
    ev.push({ e: "hurt", i: st.hero.i, n: dmg, k: m.k });
    if (m.k === "wisp" && st.hero.fo > 0) { st.hero.fo--; ev.push({ e: "drain", i: st.hero.i }); }
    if (st.hero.hp <= 0) { st.hero.hp = 0; st.over = 0; ev.push({ e: "fall", k: m.k }); }
  }
  function monTurn(st, ev) {
    var r = playRng(st);
    var list = st.mons.slice();
    for (var k = 0; k < list.length && st.over < 0; k++) {
      var m = list[k];
      if (m.hp <= 0 || !m.aw || m.m) continue;
      m.t++;
      var n = m.n;
      if (m.k === "warden" && timer(m) % 6 === 0) {
        for (var d = 0; d < 4; d++) {
          var c = step(m.i, (d + r.int(4)) % 4);
          if (c >= 0 && freeFor(st, c)) {
            var s0 = monStats("bones", st.floor);
            st.mons.push({ id: st.nid++, k: "bones", i: c, hp: s0.hp, aw: 1, t: 0, m: 0, n: null });
            ev.push({ e: "call", i: c });
            break;
          }
        }
      }
      if (!n) continue;
      if (n.a === "a") {
        if (n.c[0] === st.hero.i) hurtHero(st, m, ev);
        else ev.push({ e: "miss", i: n.c[0] });
      } else if (n.a === "s") {
        if (n.c.indexOf(st.hero.i) >= 0) hurtHero(st, m, ev);
        else ev.push({ e: "miss", i: n.c[n.c.length - 1] });
      } else if (n.a === "m") {
        for (var j = 0; j < n.c.length; j++) {
          if (!freeFor(st, n.c[j])) break;
          m.i = n.c[j];
        }
      }
    }
    st.mons = st.mons.filter(function (x) { return x.hp > 0; });
  }
  function hitMon(st, m, dmg, ev) {
    var s0 = monStats(m.k, st.floor);
    dmg = Math.max(1, dmg - s0.def);
    m.hp -= dmg;
    m.aw = 1;
    m.m = 0;
    ev.push({ e: "hit", i: m.i, n: dmg, k: m.k });
    if (m.hp <= 0) {
      ev.push({ e: "kill", i: m.i, k: m.k });
      st.hero.kills++;
      var r = playRng(st), s = stats(st);
      var g = Math.round((1 + st.floor + r.int(3)) * (100 + s.gold) / 100);
      st.gold.push({ i: m.i, n: g });
      if (m.k === "warden") { st.hero.key = 1; ev.push({ e: "key", i: m.i }); }
      return;
    }
    if (m.k === "swarm") {
      var splits = Math.floor(m.t / 1000);
      if (splits < 2) {
        for (var d = 0; d < 4; d++) {
          var c = step(m.i, d);
          if (c >= 0 && freeFor(st, c)) {
            var rs = monStats("rat", st.floor);
            st.mons.push({ id: st.nid++, k: "rat", i: c, hp: Math.min(rs.hp, 3), aw: 1, t: 0, m: 0, n: null });
            ev.push({ e: "split", i: c });
            break;
          }
        }
        m.t += 1000;
      }
    }
  }
  // ---------- Hero actions ----------
  // a = { t: "move", d } | { t: "wait" } | { t: "use", n: pack index }
  // Returns the events (for the screen), or null when the action is
  // not allowed (no turn passes).
  function act(st, a) {
    if (st.over >= 0 || !a) return null;
    var ev = [], h = st.hero;
    if (a.t === "move") {
      var to = step(h.i, a.d);
      if (to < 0 || !open(st, to)) return null;
      var m = monAt(st, to);
      var ci = chestAt(st, to);
      if (m) hitMon(st, m, stats(st).atk, ev);
      else if (ci >= 0) {
        var it = st.chestItems[ci];
        st.chests.splice(ci, 1);
        st.chestItems.splice(ci, 1);
        st.loot.push({ i: to, it: it });
        ev.push({ e: "chest", i: to, k: it.k });
      } else {
        h.i = to;
        ev.push({ e: "step", i: to });
        arrive(st, ev);
        if (st.over >= 0 || ev.some(function (x) { return x.e === "floor"; })) return finishTurn(st, ev, true);
      }
    } else if (a.t === "wait") {
      ev.push({ e: "wait" });
    } else if (a.t === "use") {
      if (!useItem(st, a.n, ev)) return null;
    } else return null;
    return finishTurn(st, ev, false);
  }
  function arrive(st, ev) {
    var h = st.hero;
    for (var g = st.gold.length - 1; g >= 0; g--) {
      if (st.gold[g].i === h.i) { h.gold += st.gold[g].n; ev.push({ e: "gold", n: st.gold[g].n }); st.gold.splice(g, 1); }
    }
    st.traps.forEach(function (t) {
      if (t.i !== h.i) return;
      t.k = 1;
      h.hp -= 3;
      ev.push({ e: "trap", i: h.i, n: 3 });
      if (h.hp <= 0) { h.hp = 0; st.over = 0; ev.push({ e: "fall", k: "trap" }); }
    });
    if (st.over >= 0) return;
    groundAt(st).reverse().forEach(function (n) {
      var k = st.loot[n].it.k, cur = st.loot[n].it.c;
      if (autoPick(st, n)) ev.push({ e: "pick", k: k });
      else ev.push({ e: cur ? "cursedHere" : "full", k: k });
    });
    if (st.shrine && st.shrine.i === h.i) ev.push({ e: "shrine" });
    if (st.map.charAt(h.i) === ">") {
      var last = st.end || FLOORS;
      if (st.floor < last) { enterFloor(st, st.floor + 1, ev); return; }
      if (last < FLOORS || h.key) { st.over = 1; ev.push({ e: "win" }); return; }
      ev.push({ e: "locked" });
    }
  }
  function finishTurn(st, ev, fresh) {
    st.turn++;
    if (st.over < 0 && !fresh) monTurn(st, ev);
    if (st.over < 0) {
      var s = stats(st);
      if (st.turn % s.regen === 0 && st.hero.hp < s.mhp) st.hero.hp++;
      if (st.turn % s.frg === 0 && st.hero.fo < s.mfo) st.hero.fo++;
      look(st, ev);
      plan(st);
    }
    return ev;
  }
  function nearestSeen(st, maxD) {
    var best = null, bd = 999;
    visible(st).forEach(function (i) {
      var m = monAt(st, i);
      if (!m || m.m) return;
      var d = dist(i, st.hero.i);
      if (d <= maxD && (d < bd || (d === bd && m.id < best.id))) { bd = d; best = m; }
    });
    return best;
  }
  function useItem(st, n, ev) {
    var p = st.pack.it[n];
    if (!p) return false;
    var it = item(p.k), h = st.hero, s = stats(st);
    if (!it.use) return false;
    if (it.t === "r") {
      if (h.fo < it.cost) return false;
      if (it.use === "bolt") {
        var m = nearestSeen(st, 6);
        if (!m) return false;
        hitMon(st, m, 4 + s.atk, ev);
      } else if (it.use === "storm") {
        var vis = visible(st), any = false;
        st.mons.slice().forEach(function (o) { if (o.hp > 0 && !o.m && vis.indexOf(o.i) >= 0) { any = true; hitMon(st, o, 5, ev); } });
        if (!any) return false;
      } else if (it.use === "push") {
        var pushed = false;
        for (var d = 0; d < 4; d++) {
          var o = monAt(st, step(h.i, d));
          if (!o || o.m) continue;
          for (var k = 0; k < 2; k++) { var nx = step(o.i, d); if (nx >= 0 && freeFor(st, nx)) o.i = nx; }
          o.n = null;
          pushed = true;
          ev.push({ e: "push", i: o.i });
        }
        if (!pushed) return false;
      } else if (it.use === "ward") {
        if (h.wd) return false;
        h.wd = 1;
        ev.push({ e: "ward" });
      } else if (it.use === "blink") {
        var dd = bfs(st, h.i, function (c) { return !!monAt(st, c) || chestAt(st, c) >= 0; });
        var seenMons = st.mons.filter(function (o) { return o.hp > 0 && o.aw && !o.m; });
        var best = -1, score = -1;
        for (var c = 0; c < W * H; c++) {
          if (dd[c] < 2 || dd[c] > 4 || st.seen.charAt(c) !== "1" || st.map.charAt(c) !== ".") continue;
          var sc = seenMons.reduce(function (mn, o) { return Math.min(mn, dist(o.i, c)); }, 99);
          if (sc > score) { score = sc; best = c; }
        }
        if (best < 0) return false;
        h.i = best;
        ev.push({ e: "blink", i: best });
      } else if (it.use === "mend") {
        if (h.hp >= s.mhp) return false;
        h.hp = Math.min(s.mhp, h.hp + 6);
        ev.push({ e: "heal", n: 6 });
      }
      h.fo -= it.cost;
      return true;
    }
    // potions and scrolls are used up
    if (it.use === "heal") { if (h.hp >= s.mhp) return false; h.hp = Math.min(s.mhp, h.hp + it.n); ev.push({ e: "heal", n: it.n }); }
    else if (it.use === "focus") { if (h.fo >= s.mfo) return false; h.fo = s.mfo; ev.push({ e: "focus" }); }
    else if (it.use === "elixir") { h.hp = s.mhp; h.fo = s.mfo; ev.push({ e: "heal", n: s.mhp }); }
    else if (it.use === "cleanse") {
      var had = st.pack.it.some(function (x) { return x.c; });
      if (!had) return false;
      st.pack.it.forEach(function (x) { x.c = 0; });
      ev.push({ e: "cleanse" });
    } else if (it.use === "chart") {
      var z = "";
      for (var i = 0; i < W * H; i++) {
        var near = false;
        if (st.map.charAt(i) === "#") {
          for (var dk = 0; dk < 4 && !near; dk++) { var q = step(i, dk); near = q >= 0 && st.map.charAt(q) !== "#"; }
        }
        z += st.map.charAt(i) !== "#" || near ? "1" : st.seen.charAt(i);
      }
      st.seen = z;
      st.traps.forEach(function (t) { t.k = 1; });
      ev.push({ e: "chart" });
    } else if (it.use === "escape") {
      var stairs = st.map.indexOf(">"), spot = -1;
      for (var e2 = 0; e2 < 4 && spot < 0; e2++) { var nb = step(stairs, e2); if (nb >= 0 && freeFor(st, nb)) spot = nb; }
      if (spot < 0) return false;
      h.i = spot;
      ev.push({ e: "blink", i: spot });
    } else if (it.use === "fire") {
      var hit = false;
      st.mons.slice().forEach(function (o) { if (o.hp > 0 && cheb(o.i, h.i) === 1) { hit = true; hitMon(st, o, 6, ev); } });
      if (!hit) return false;
    } else return false;
    st.pack.it.splice(n, 1);
    clampHero(st);
    ev.push({ e: "used", k: p.k });
    return true;
  }
  // The items a person can use now (quick slots): runes, potions and
  // scrolls in the backpack's reading order.
  function usable(st) {
    var out = [];
    st.pack.it.forEach(function (p, n) { if (item(p.k).use) out.push(n); });
    out.sort(function (a, b) {
      var p = st.pack.it[a], q = st.pack.it[b];
      return (p.y - q.y) || (p.x - q.x);
    });
    return out;
  }

  // ---------- Saved state check ----------
  function isInt(v) { return typeof v === "number" && isFinite(v) && Math.floor(v) === v; }
  function valid(st) {
    if (!st || typeof st !== "object" || st.v !== 1 || st.W !== W || st.H !== H) return false;
    if (MODES.indexOf(st.mode) < 0 || typeof st.seed !== "string" || !isInt(st.floor) || st.floor < 1 || st.floor > FLOORS) return false;
    if (typeof st.map !== "string" || st.map.length !== W * H || /[^#.>]/.test(st.map)) return false;
    if (typeof st.seen !== "string" || st.seen.length !== W * H || /[^01]/.test(st.seen)) return false;
    if (st.end !== undefined && (!isInt(st.end) || st.end < 1 || st.end >= FLOORS || st.floor > st.end)) return false;
    if (!isInt(st.turn) || st.turn < 0 || !isInt(st.rng) || !isInt(st.nid) || [-1, 0, 1].indexOf(st.over) < 0) return false;
    var n = W * H, cell = function (i) { return isInt(i) && i >= 0 && i < n; };
    var h = st.hero;
    if (!h || !cell(h.i) || !isInt(h.hp) || !isInt(h.fo) || !isInt(h.gold) || !isInt(h.kills) || (h.key !== 0 && h.key !== 1) || (h.wd !== 0 && h.wd !== 1)) return false;
    var okIt = function (it) { return it && item(it.k) && isInt(it.r) && it.r >= 0 && it.r < 4 && (it.c === 0 || it.c === 1); };
    if (!Array.isArray(st.traps) || !st.traps.every(function (t) { return t && cell(t.i) && (t.k === 0 || t.k === 1); })) return false;
    if (!Array.isArray(st.chests) || !st.chests.every(cell) || !Array.isArray(st.chestItems) ||
        st.chestItems.length !== st.chests.length || !st.chestItems.every(okIt)) return false;
    if (!Array.isArray(st.gold) || !st.gold.every(function (g) { return g && cell(g.i) && isInt(g.n) && g.n >= 0; })) return false;
    if (!Array.isArray(st.loot) || !st.loot.every(function (l) { return l && cell(l.i) && okIt(l.it); })) return false;
    if (!Array.isArray(st.mons) || !st.mons.every(function (m) {
      return m && MONS[m.k] && cell(m.i) && isInt(m.hp) && isInt(m.id) && isInt(m.t) && (m.aw === 0 || m.aw === 1) &&
        (m.m === 0 || m.m === 1) && (m.n === null || (m.n && typeof m.n.a === "string" && Array.isArray(m.n.c) && m.n.c.every(cell)));
    })) return false;
    if (st.shrine !== undefined) {
      var sh = st.shrine;
      if (!sh || !cell(sh.i) || st.map.charAt(sh.i) !== "." || !Array.isArray(sh.it) || sh.it.length !== 3 ||
          !sh.it.every(function (x) { return x === null || (okIt(x) && x.c === 0); })) return false;
    }
    var p = st.pack;
    if (!p || !isInt(p.w) || !isInt(p.h) || p.w < 6 || p.w > 8 || p.h < 4 || p.h > 5 || !Array.isArray(p.it)) return false;
    if (!p.it.every(function (x) { return okIt(x) && isInt(x.x) && isInt(x.y); })) return false;
    // items inside the pack and not on top of each other
    var g = [];
    for (var c = 0; c < p.w * p.h; c++) g.push(0);
    for (var k = 0; k < p.it.length; k++) {
      var x = p.it[k], cells = shapeOf(x.k, x.r).cells;
      for (var j = 0; j < cells.length; j++) {
        var cx = x.x + cells[j][0], cy = x.y + cells[j][1];
        if (cx < 0 || cy < 0 || cx >= p.w || cy >= p.h || g[cy * p.w + cx]) return false;
        g[cy * p.w + cx] = 1;
      }
    }
    return true;
  }
  function clone(st) { return JSON.parse(JSON.stringify(st)); }

  // the swarm keeps its split count in the thousands of t
  function timer(m) { return m.t % 1000; }

  var api = {
    W: W, H: H, FLOORS: FLOORS, BASE: BASE, MODES: MODES, CHECKPOINTS: CHECKPOINTS, DX: DX, DY: DY,
    ITEMS: ITEMS, SHAPES: SHAPES, MONS: MONS, MON_KINDS: MON_KINDS,
    hashStr: hashStr, xy: xy, idx: idx, step: step, dist: dist, cheb: cheb, los: los, bfs: bfs, open: open,
    monAt: monAt, chestAt: chestAt, makeFloor: makeFloor, monStats: monStats, item: item, shapeOf: shapeOf,
    packSize: packSize, packGrid: packGrid, fits: fits, findSpot: findSpot, packLinks: packLinks, stats: stats,
    groundAt: groundAt, packAdd: packAdd, packMove: packMove, packDrop: packDrop, autoPick: autoPick,
    SHRINE_FLOORS: SHRINE_FLOORS, shrinePrice: shrinePrice, shrineBuy: shrineBuy, watched: watched,
    newRun: newRun, visible: visible, intent: intent, act: act, usable: usable, valid: valid, clone: clone,
    timer: timer
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.CryptEngine = api;
})(typeof window !== "undefined" ? window : this);
