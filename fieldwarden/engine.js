// ============================================================
// orOS Fieldwarden — rules engine (v1.0.0)
// NOT the UI: no DOM, no storage. Loaded by fieldwarden/index.html
// (window.FieldwardenEngine, after fieldwarden/data.js) and by
// tests/fieldwarden.test.js (module.exports).
//
// A turn-based tactics game on a 6 × 6 farm through a growing season.
// Three village folk guard the fields; invaders come out of the woods
// at the edges and every one of them shows what it will do before it
// acts. The fields grow a stage every turn and the harvest at the end
// of the season is the score. Original rules, numbers and names (plan:
// /mnt/project-files/games/strategy/fieldwarden-plan.md, Bible Part IX
// "Fieldwarden").
//
// State (plain JSON, kept as is in the device-local session):
//   { v: 1, seed, diff "m" Mild | "h" Harsh, end (farms in the year),
//     farm 1…, sea season of the farm 1-4,
//     folk: [{ c folk id, mh most Health, mv Move, u: [0|1, 0|1] upgrades }] × 3,
//     coins, won seasons won, total sheaves, best (most in a season),
//     ready (fields bought a stage ahead for the next season),
//     phase "play" | "shop" (between seasons), res: null | { h, q, w } (last harvest),
//     s: season, acts, over: -1 playing | 0 a quota missed | 1 the year done }
//   season = { turn 1-T, q quota, max, wish: { k star|barn|drive, i field }, drove,
//     t: [36 tiles], g: [36 field stages 0-3], x: [36 field bruised 0|1 | hedge Health],
//     p: [36 pollinated 0|1], barn Health, bi barn tile,
//     u: [unit], nid, next: [{ k, at }] (the invaders that come at the end of the turn),
//     wx: [T + 1 weather, index = turn], sched: [T + 1 lists of invader ids],
//     rw rewinds left (Mild), r rng, done 0|1, h harvest }
//   unit = { id, k folk or invader id, f 1 folk | 0 invader, fi folk index | -1, at tile,
//            hp, mh, mo moved, ac acted, it: null | { d 0-3, r distance, a act }, sn stunned }
//   tiles: d dirt (mud while it rains), f field, h hedge (Health in x), H hedge
//   that cannot be broken (the hedger's), p pond, s haystack, b barn.
//   Directions 0 north, 1 east, 2 south, 3 west; tile = y × 6 + x.
//
// Rules (also in fieldwarden/help.en.txt):
//   - The folk act in any order: each may move, then use its tool, once.
//   - End turn: the invaders act in the order shown (animals next to the
//     shepherd last). An act lands on whatever stands on its target tile
//     then: a pushed invader carries its act along with it.
//   - Then the wind blows the crows a tile, the unhurt fields grow a
//     stage, and the invaders shown at the edges come in.
//   - A hit field loses a stage (a mole: two) and stops growing for the
//     season. Harvest = the sum of the stages; reach the quota.
//   - Pushes: off the board an invader runs away (a farmhand takes 1);
//     into a hedge, haystack or the barn 1 damage; into another piece 1
//     damage to both, and invaders lose their act; into the pond a
//     ground invader is washed away; a piece pushed onto mud stops.
//   - No dice and no misses: chance comes only from the year code.
// ============================================================
(function (root) {
  "use strict";

  var D = root.FieldwardenData || (typeof require === "function" ? require("./data.js") : null);
  var FOLK = D.FOLK, FOLK_IDS = D.FOLK_IDS, TOOLS = D.TOOLS, UPS = D.UPS, INVADERS = D.INVADERS, ACTS = D.ACTS, FARMS = D.FARMS;

  var N = 6, SIZE = 36, T = 5, SEASONS = 4, MAX_STAGE = 3;
  var DIFFS = ["m", "h"];
  var DX = [0, 1, 0, -1], DY = [-1, 0, 1, 0];
  var WIND = { n: 0, e: 1, s: 2, w: 3 };
  var BLOCK = { h: 1, H: 1, s: 1, b: 1 };
  var TILES = "dfhHpsb";
  var QUOTA = { m: 0.6, h: 0.8 };
  var COST = { hp: 3, mv: 3, up: 4, ready: 2 };
  var MAX_HP = 6, MAX_MV = 5, MAX_READY = 3, WISH_BONUS = 2, DRIVE_N = 3, HEDGE_HP = 2, BARN_HP = 2;
  var MAX_COINS = 9999, BIG = 1e9;

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
  // xorshift32 on an object { s }
  function rnd(o) {
    var x = o.s >>> 0 || 0x9e3779b9;
    x ^= x << 13; x >>>= 0;
    x ^= x >>> 17;
    x ^= x << 5; x >>>= 0;
    o.s = x;
    return x / 4294967296;
  }
  function rint(o, n) { return Math.floor(rnd(o) * n); }
  function shuffle(o, a) {
    for (var i = a.length - 1; i > 0; i--) {
      var j = rint(o, i + 1), t = a[i];
      a[i] = a[j]; a[j] = t;
    }
    return a;
  }
  function isInt(v) { return typeof v === "number" && isFinite(v) && Math.floor(v) === v; }

  // ---------- The board ----------
  function step(i, d) {
    var x = i % N + DX[d], y = Math.floor(i / N) + DY[d];
    return x < 0 || y < 0 || x >= N || y >= N ? -1 : y * N + x;
  }
  function dist(a, b) { return Math.abs(a % N - b % N) + Math.abs(Math.floor(a / N) - Math.floor(b / N)); }
  function near8(a, b) { return Math.max(Math.abs(a % N - b % N), Math.abs(Math.floor(a / N) - Math.floor(b / N))) <= 1; }
  // The direction from a to b on one row or column, else -1.
  function dirTo(a, b) {
    if (a === b) return -1;
    if (a % N === b % N) return b < a ? 0 : 2;
    if (Math.floor(a / N) === Math.floor(b / N)) return b > a ? 1 : 3;
    return -1;
  }
  function isEdge(i) { var x = i % N, y = Math.floor(i / N); return x === 0 || y === 0 || x === N - 1 || y === N - 1; }
  function unitAt(s, i) {
    for (var k = 0; k < s.u.length; k++) if (s.u[k].at === i) return s.u[k];
    return null;
  }
  function unitById(s, id) {
    for (var k = 0; k < s.u.length; k++) if (s.u[k].id === id) return s.u[k];
    return null;
  }
  function folkUnit(s, fi) {
    for (var k = 0; k < s.u.length; k++) if (s.u[k].f === 1 && s.u[k].fi === fi) return s.u[k];
    return null;
  }
  function invaders(s) { return s.u.filter(function (u) { return u.f === 0; }); }
  function folks(s) { return s.u.filter(function (u) { return u.f === 1; }); }
  function mud(s, i) { return s.t[i] === "d" && s.wx[s.turn] === "r"; }
  function flies(u) { return u.f === 0 && INVADERS[u.k].fly === 1; }
  function swims(u) { return u.f === 1 && u.k === "ferryman"; }
  // Can u stand on tile i (units aside)?
  function standable(s, u, i) {
    var t = s.t[i];
    if (BLOCK[t]) return false;
    if (t === "p") return swims(u);
    return true;
  }

  // Tiles u can reach in up to n steps: dist[] (-1 = no). Ground units
  // walk around pieces and blocks; crows fly over anything and land on
  // a free tile that is not a block or the pond.
  function reachMap(s, u, n) {
    var d = [], q = [u.at], k;
    for (k = 0; k < SIZE; k++) d.push(-1);
    d[u.at] = 0;
    var fly = flies(u);
    while (q.length) {
      var c = q.shift();
      if (d[c] >= n) continue;
      for (var dir = 0; dir < 4; dir++) {
        var nx = step(c, dir);
        if (nx < 0 || d[nx] >= 0) continue;
        if (!fly) {
          if (!standable(s, u, nx) || unitAt(s, nx)) continue;
        }
        d[nx] = d[c] + 1;
        q.push(nx);
      }
    }
    if (fly) for (k = 0; k < SIZE; k++) if (k !== u.at && d[k] > 0 && (BLOCK[s.t[k]] || s.t[k] === "p" || unitAt(s, k))) d[k] = -1;
    return d;
  }

  // ---------- Folk and their tools ----------
  function toolOf(st, fi) {
    var f = st.folk[fi], base = TOOLS[FOLK[f.c].tool], out = { id: FOLK[f.c].tool };
    Object.keys(base).forEach(function (k) { out[k] = base[k]; });
    FOLK[f.c].ups.forEach(function (id, n) {
      if (!f.u[n]) return;
      Object.keys(UPS[id]).forEach(function (k) { if (k !== "c") out[k] = UPS[id][k]; });
    });
    return out;
  }
  function movesS(st, s, u) {
    if (!u || u.f !== 1 || u.mo || u.ac || s.done) return [];
    var d = reachMap(s, u, st.folk[u.fi].mv), out = [];
    for (var i = 0; i < SIZE; i++) if (d[i] > 0) out.push(i);
    return out;
  }
  function targetsS(st, s, u) {
    if (!u || u.f !== 1 || u.ac || s.done) return [];
    var tl = toolOf(st, u.fi), out = [], dir, i, k;
    if (tl.tg === "line" || (tl.tg === "adj" && tl.reach)) {
      var rng = tl.tg === "line" ? tl.rng : tl.reach, first = tl.tg === "line" ? tl.first : 1;
      for (dir = 0; dir < 4; dir++) {
        i = u.at;
        for (k = 1; k <= rng; k++) {
          i = step(i, dir);
          if (i < 0) break;
          // the crook pulls toward the shepherd: a piece next to her cannot come closer
          if (unitAt(s, i)) { if (!(tl.pull && k === 1)) out.push(i); if (first) break; continue; }
          if (first && BLOCK[s.t[i]]) break;
        }
      }
    } else {
      for (dir = 0; dir < 4; dir++) {
        i = step(u.at, dir);
        if (i < 0) continue;
        if (unitAt(s, i)) out.push(i);
        else if (tl.tg === "plant" && s.t[i] === "d") out.push(i);
      }
    }
    return out.sort(function (a, b) { return a - b; });
  }

  // ---------- Damage, pushes, fields ----------
  function note(ev, e) { if (ev) ev.push(e); }
  function removeUnit(s, u) {
    s.u = s.u.filter(function (x) { return x !== u; });
  }
  function damage(s, u, n, ev) {
    if (!u || n <= 0 || unitById(s, u.id) !== u) return;
    u.hp -= n;
    note(ev, { k: "hit", at: u.at, n: n, f: u.f, u: u.k });
    if (u.hp > 0) return;
    removeUnit(s, u);
    if (u.f === 0) { s.drove++; note(ev, { k: "flee", at: u.at, u: u.k }); }
    else note(ev, { k: "home", at: u.at, u: u.k });
  }
  function hitField(s, i, n, ev) {
    if (s.t[i] !== "f" || n <= 0) return;
    s.g[i] = Math.max(0, s.g[i] - n);
    s.x[i] = 1;
    note(ev, { k: "field", at: i, n: n });
  }
  function hitBarn(s, n, ev) {
    if (n <= 0 || s.barn <= 0) return;
    s.barn = Math.max(0, s.barn - n);
    note(ev, { k: "barn", at: s.bi, n: n });
  }
  // Push (or pull) u n tiles in direction d. stopAt: the id of a piece
  // the pull stops next to (the shepherd).
  function push(s, u, d, n, ev, stopAt) {
    for (var k = 0; k < n; k++) {
      if (unitById(s, u.id) !== u) return;
      var nx = step(u.at, d);
      if (nx < 0) {
        if (u.f === 0) {
          removeUnit(s, u);
          s.drove++;
          note(ev, { k: "off", at: u.at, u: u.k });
        } else damage(s, u, 1, ev);
        return;
      }
      var o = unitAt(s, nx);
      if (o) {
        if (stopAt !== undefined && o.id === stopAt) return;
        note(ev, { k: "bump", at: u.at, to: nx });
        if (u.f === 0) u.sn = 1;
        if (o.f === 0) o.sn = 1;
        damage(s, u, 1, ev);
        damage(s, o, 1, ev);
        return;
      }
      var t = s.t[nx];
      if (BLOCK[t]) { damage(s, u, 1, ev); return; }
      if (t === "p" && !flies(u) && !swims(u)) {
        if (u.f === 0) {
          removeUnit(s, u);
          s.drove++;
          note(ev, { k: "wash", at: nx, u: u.k });
        } else damage(s, u, 1, ev);
        return;
      }
      note(ev, { k: "slide", from: u.at, at: nx });
      u.at = nx;
      if (mud(s, nx)) return;
    }
  }
  function applyTool(st, s, u, at, ev) {
    var tl = toolOf(st, u.fi), d = dirTo(u.at, at), v = unitAt(s, at);
    u.ac = 1;
    u.mo = 1;
    note(ev, { k: "tool", at: u.at, to: at, tool: tl.id });
    if (tl.id === "hedge" && !v) {
      s.t[at] = "H";
      s.x[at] = 0;
      note(ev, { k: "plant", at: at });
      return;
    }
    if (!v) return;
    if (tl.id === "crook") { push(s, v, (d + 2) % 4, tl.pull, ev, u.id); return; }
    if (tl.id === "swarm") {
      push(s, v, d, tl.push, ev);
      if (tl.stun && v.f === 0 && unitById(s, v.id) === v) v.sn = 1;
      return;
    }
    if (tl.id === "pole") {
      var bi = step(at, d), b = bi >= 0 ? unitAt(s, bi) : null;
      if (tl.dmg) { if (b) damage(s, b, tl.dmg, ev); damage(s, v, tl.dmg, ev); }
      if (b && unitById(s, b.id) === b) push(s, b, d, tl.push, ev);
      if (unitById(s, v.id) === v) push(s, v, d, tl.push, ev);
      return;
    }
    // hammer, hedge (a shove), turnip: damage, then a push
    if (tl.dmg) damage(s, v, tl.dmg, ev);
    if (unitById(s, v.id) === v && tl.push) push(s, v, d, tl.push, ev);
  }

  // ---------- The invaders ----------
  // Where an act lands now (-1: off the board / no act).
  function intentTile(s, u) {
    if (!u.it || u.it.a === "charge") return -1;
    var i = u.at;
    for (var k = 0; k < u.it.r; k++) { i = step(i, u.it.d); if (i < 0) return -1; }
    return i;
  }
  // The tiles a charge crosses, and what stops it: { path: [tiles], stop: tile | -1 }
  function chargePath(s, u, d, from) {
    var at = from === undefined ? u.at : from, path = [];
    for (;;) {
      var nx = step(at, d);
      if (nx < 0) return { path: path, stop: -1 };
      var o = unitAt(s, nx);
      if ((o && o !== u) || BLOCK[s.t[nx]] || s.t[nx] === "p") return { path: path, stop: nx };
      path.push(nx);
      at = nx;
      if (mud(s, nx)) return { path: path, stop: -1 };
    }
  }
  function shepherdNear(s, u) {
    if (u.f !== 0 || !INVADERS[u.k].animal) return false;
    return s.u.some(function (h) { return h.f === 1 && h.k === "shepherd" && dist(h.at, u.at) === 1; });
  }
  // The order the invaders act in: by arrival, animals next to the
  // shepherd last.
  function actOrder(s) {
    var list = invaders(s).filter(function (u) { return u.it && !u.sn; }).sort(function (a, b) { return a.id - b.id; });
    var calm = list.filter(function (u) { return shepherdNear(s, u); });
    return list.filter(function (u) { return calm.indexOf(u) < 0; }).concat(calm).map(function (u) { return u.id; });
  }
  // Move next to one of the goals (tiles, in order of preference):
  // { to, d } or null.
  function approach(s, u, goals, dm) {
    for (var g = 0; g < goals.length; g++) {
      var best = -1, bd = BIG, bdir = -1;
      for (var dir = 0; dir < 4; dir++) {
        var a = step(goals[g], dir);
        if (a < 0 || dm[a] < 0) continue;
        if (dm[a] < bd || (dm[a] === bd && a < best)) { bd = dm[a]; best = a; bdir = (dir + 2) % 4; }
      }
      if (best >= 0) return { to: best, d: bdir };
    }
    return null;
  }
  // No goal in reach: walk to the tile closest to the first goal.
  function closer(s, u, goal, dm) {
    var best = u.at, bd = dist(u.at, goal);
    for (var i = 0; i < SIZE; i++) {
      if (dm[i] <= 0) continue;
      var dd = dist(i, goal);
      if (dd < bd || (dd === bd && i < best && best !== u.at)) { bd = dd; best = i; }
    }
    return best;
  }
  function crowSafe(s, i) {
    return !s.u.some(function (h) { return h.f === 1 && h.k === "scarecrow" && near8(h.at, i); });
  }
  function fieldsBy(s, order) {
    var out = [];
    for (var i = 0; i < SIZE; i++) if (s.t[i] === "f") out.push(i);
    return out.sort(order);
  }
  function think(st, s, u) {
    var I = INVADERS[u.k], dm = reachMap(s, u, I.mv), m, goal;
    u.it = null;
    var fo = folks(s).sort(function (a, b) { return a.hp - b.hp || dist(a.at, u.at) - dist(b.at, u.at) || a.id - b.id; });
    if (I.act === "charge") {
      var best = null;
      for (var i = 0; i < SIZE; i++) {
        if (dm[i] < 0) continue;
        for (var dir = 0; dir < 4; dir++) {
          var cp = chargePath(s, u, dir, i), sc = 0;
          cp.path.forEach(function (p) { if (s.t[p] === "f") sc += s.x[p] ? 1 : s.g[p] + 2; });
          if (cp.stop >= 0) {
            var o = unitAt(s, cp.stop);
            if (o && o !== u && o.f === 1) sc += 3;
            else if (s.t[cp.stop] === "b" && s.barn > 0) sc += 2;
          }
          if (!cp.path.length && !(cp.stop >= 0 && unitAt(s, cp.stop) && unitAt(s, cp.stop).f === 1)) continue;
          if (!best || sc > best.sc || (sc === best.sc && (dm[i] < best.m || (dm[i] === best.m && (i < best.i || (i === best.i && dir < best.d)))))) {
            best = { sc: sc, m: dm[i], i: i, d: dir };
          }
        }
      }
      if (best) { u.at = best.i; u.it = { d: best.d, r: 0, a: "charge" }; }
      return;
    }
    if (I.act === "bite" || I.act === "club") {
      if (I.act === "club" && u.hp <= Math.floor(u.mh / 2)) whistle(s);
      m = approach(s, u, fo.map(function (h) { return h.at; }), dm);
      if (!m && I.act === "club" && s.barn > 0) m = approach(s, u, [s.bi], dm);
      if (m) { u.at = m.to; u.it = { d: m.d, r: 1, a: I.act }; return; }
      goal = fo.length ? fo[0].at : (fieldsBy(s, function (a, b) { return a - b; })[0]);
      if (goal !== undefined) u.at = closer(s, u, goal, dm);
      fallbackTram(s, u);
      return;
    }
    // crows: the ripest field, unhurt first; moles: the nearest field
    var list;
    if (u.k === "crow") {
      list = fieldsBy(s, function (a, b) { return s.g[b] - s.g[a] || s.x[a] - s.x[b] || dist(a, u.at) - dist(b, u.at) || a - b; })
        .filter(function (i) { return crowSafe(s, i); });
    } else {
      list = fieldsBy(s, function (a, b) { return dist(a, u.at) - dist(b, u.at) || s.g[b] - s.g[a] || a - b; });
    }
    m = approach(s, u, list, dm);
    if (m) { u.at = m.to; u.it = { d: m.d, r: 1, a: I.act }; return; }
    if (list.length) u.at = closer(s, u, list[0], dm);
  }
  // No one to bite: trample a field next to it, if any.
  function fallbackTram(s, u) {
    for (var dir = 0; dir < 4; dir++) {
      var a = step(u.at, dir);
      if (a >= 0 && s.t[a] === "f" && !unitAt(s, a)) { u.it = { d: dir, r: 1, a: "tram" }; return; }
    }
  }
  // The captain, hurt, whistles for a wolf (one a turn).
  function whistle(s) {
    if (s.turn >= T || s.next.some(function (e) { return e.w; })) return;
    var at = entryTiles(s, "wolf", s.next.map(function (e) { return e.at; }));
    if (!at.length) return;
    s.next.push({ k: "wolf", at: at[rint(s.r, at.length)], w: 1 });
  }
  function reveal(st, s) {
    invaders(s).sort(function (a, b) { return a.id - b.id; }).forEach(function (u) { think(st, s, u); });
  }
  function doIntent(s, u, ev) {
    var A = ACTS[u.it.a];
    note(ev, { k: "act", at: u.at, a: u.it.a, u: u.k });
    if (u.it.a === "charge") {
      var cp = chargePath(s, u, u.it.d);
      cp.path.forEach(function (p) {
        u.at = p;
        if (s.t[p] === "f") hitField(s, p, A.field, ev);
      });
      if (cp.stop < 0) return;
      var o = unitAt(s, cp.stop);
      if (o) damage(s, o, o.f === 1 ? A.unit : 1, ev);
      else if (s.t[cp.stop] === "h") {
        s.x[cp.stop]--;
        note(ev, { k: "hedge", at: cp.stop });
        if (s.x[cp.stop] <= 0) { s.t[cp.stop] = "d"; s.x[cp.stop] = 0; }
      } else if (s.t[cp.stop] === "b") hitBarn(s, A.barn, ev);
      return;
    }
    var tg = intentTile(s, u);
    if (tg < 0) return;
    var v = unitAt(s, tg);
    if (v) {
      damage(s, v, A.unit, ev);
      if (A.push && unitById(s, v.id) === v) push(s, v, u.it.d, A.push, ev);
    } else if (s.t[tg] === "b") hitBarn(s, A.barn, ev);
    else if (s.t[tg] === "f") hitField(s, tg, A.field, ev);
  }
  // The invaders act, then the wind. (No growth: see endTurn.)
  function resolve(st, s, ev) {
    // the smith mends the barn first
    if (s.barn > 0 && s.barn < BARN_HP && s.u.some(function (h) { return h.f === 1 && h.k === "smith" && dist(h.at, s.bi) === 1; })) {
      s.barn++;
      note(ev, { k: "mend", at: s.bi });
    }
    actOrder(s).forEach(function (id) {
      var u = unitById(s, id);
      if (!u || u.sn || !u.it) return;
      doIntent(s, u, ev);
    });
    var w = s.wx[s.turn];
    if (WIND[w] !== undefined) {
      invaders(s).filter(flies).sort(function (a, b) { return a.id - b.id; }).forEach(function (u) {
        var nx = step(u.at, WIND[w]);
        if (nx < 0) { removeUnit(s, u); s.drove++; note(ev, { k: "off", at: u.at, u: u.k }); return; }
        if (unitAt(s, nx) || BLOCK[s.t[nx]] || s.t[nx] === "p") return;
        note(ev, { k: "blow", from: u.at, at: nx });
        u.at = nx;
      });
    }
    s.u.forEach(function (u) { u.sn = 0; });
  }
  function grow(s, ev) {
    var bees = folks(s).filter(function (h) { return h.k === "beekeeper"; });
    for (var i = 0; i < SIZE; i++) {
      if (s.t[i] !== "f" || s.x[i]) continue;
      var n = 1;
      if (!s.p[i] && bees.some(function (h) { return dist(h.at, i) === 1; })) { n = 2; s.p[i] = 1; note(ev, { k: "bee", at: i }); }
      s.g[i] = Math.min(MAX_STAGE, s.g[i] + n);
    }
  }
  function entryTiles(s, k, taken) {
    var fly = INVADERS[k].fly, out = [];
    for (var i = 0; i < SIZE; i++) {
      if (!isEdge(i) || unitAt(s, i) || taken.indexOf(i) >= 0 || BLOCK[s.t[i]] || (s.t[i] === "p" && !fly)) continue;
      out.push(i);
    }
    return out;
  }
  function pickNext(s, kinds) {
    s.next = [];
    kinds.forEach(function (k) {
      var at = entryTiles(s, k, s.next.map(function (e) { return e.at; }));
      if (at.length) s.next.push({ k: k, at: at[rint(s.r, at.length)] });
    });
  }
  function newInvader(s, k, at) {
    var I = INVADERS[k];
    var u = { id: s.nid++, k: k, f: 0, fi: -1, at: at, hp: I.hp, mh: I.hp, mo: 0, ac: 0, it: null, sn: 0 };
    s.u.push(u);
    return u;
  }
  function spawn(s, ev) {
    s.next.forEach(function (e) {
      var o = unitAt(s, e.at);
      if (o) {
        note(ev, { k: "block", at: e.at, u: e.k });
        if (o.f === 1) damage(s, o, 1, ev);
        return;
      }
      newInvader(s, e.k, e.at);
      note(ev, { k: "enter", at: e.at, u: e.k });
    });
    s.next = [];
  }
  function harvestOf(s) {
    var h = 0;
    for (var i = 0; i < SIZE; i++) if (s.t[i] === "f") h += s.g[i];
    return h;
  }
  function wishOk(s) {
    var w = s.wish;
    if (w.k === "star") return s.t[w.i] === "f" && !s.x[w.i];
    if (w.k === "barn") return s.barn >= BARN_HP;
    return s.drove >= DRIVE_N;
  }

  // ---------- A season ----------
  function connected(t) {
    var free = [], i;
    for (i = 0; i < SIZE; i++) if (!BLOCK[t[i]] && t[i] !== "p") free.push(i);
    if (!free.length) return false;
    var seen = {}, q = [free[0]];
    seen[free[0]] = 1;
    var n = 1;
    while (q.length) {
      var c = q.shift();
      for (var d = 0; d < 4; d++) {
        var nx = step(c, d);
        if (nx < 0 || seen[nx] || BLOCK[t[nx]] || t[nx] === "p") continue;
        seen[nx] = 1; n++; q.push(nx);
      }
    }
    return n === free.length;
  }
  function layout(st, salt) {
    var farm = FARMS[st.farm - 1], r = { s: hashStr(st.seed + ":" + st.farm + ":" + st.sea + ":" + salt) };
    var t, g, x, i, k, bi, fields;
    var interior = [];
    for (i = 0; i < SIZE; i++) if (!isEdge(i)) interior.push(i);
    for (var tries = 0; ; tries++) {
      t = []; g = []; x = [];
      for (i = 0; i < SIZE; i++) { t.push("d"); g.push(0); x.push(0); }
      bi = interior[rint(r, interior.length)];
      t[bi] = "b";
      fields = shuffle(r, interior.filter(function (j) { return j !== bi; })).slice(0, 9 + rint(r, 3));
      fields.forEach(function (j) { t[j] = "f"; g[j] = [0, 0, 1, 1, 2][rint(r, 5)]; });
      var rest = shuffle(r, Array.apply(null, { length: SIZE }).map(function (_, j) { return j; }).filter(function (j) { return t[j] === "d"; }));
      var np = 1 + rint(r, 2), nh = 2 + rint(r, 2), ns = 1 + rint(r, 2);
      for (k = 0; k < np + nh + ns; k++) {
        var j = rest[k];
        if (k < np) t[j] = "p";
        else if (k < np + nh) { t[j] = "h"; x[j] = HEDGE_HP; }
        else t[j] = "s";
      }
      if (connected(t) || tries > 30) break;
    }
    // fields bought a stage ahead: the youngest first
    var ready = st.ready;
    fields.slice().sort(function (a, b) { return g[a] - g[b] || a - b; }).forEach(function (j) {
      if (ready > 0 && g[j] < MAX_STAGE) { g[j]++; ready--; }
    });
    var p = [];
    for (i = 0; i < SIZE; i++) p.push(0);
    var wk = ["star", "barn", "drive"][rint(r, 3)];
    var wish = wk === "star" ? { k: "star", i: fields[rint(r, fields.length)] } : { k: wk };
    var wx = ["c", "c"];
    for (k = 2; k <= T; k++) {
      var w = rint(r, 20);
      wx.push(w < 9 ? "c" : w < 14 ? "nesw".charAt(rint(r, 4)) : "r");
    }
    var pool = farm.pool[st.sea - 1], pick = function () { return pool[rint(r, pool.length)]; };
    var first = [];
    for (k = 0; k < 2 + (st.sea >= 3 ? 1 : 0) + (st.diff === "h" ? 1 : 0); k++) first.push(pick());
    if (st.sea === SEASONS) first[0] = farm.boss;
    var per = [0, 1, 1 + (st.sea >= 2 ? 1 : 0) + (st.diff === "h" && st.sea >= 2 ? 1 : 0), 1, st.sea >= SEASONS ? 1 : 0, 0];
    var sched = [first];
    for (k = 1; k <= T; k++) {
      var list = [];
      for (var n = 0; n < per[k]; n++) list.push(pick());
      sched.push(list);
    }
    var s = { turn: 1, q: 0, max: fields.length * MAX_STAGE, wish: wish, drove: 0, t: t, g: g, x: x, p: p,
      barn: BARN_HP, bi: bi, u: [], nid: 1, next: [], wx: wx, sched: sched, rw: st.diff === "m" ? 1 : 0,
      r: { s: hashStr("in:" + st.seed + ":" + st.farm + ":" + st.sea + ":" + salt) }.s, done: 0, h: 0 };
    // the folk start next to the barn
    var spots = [];
    for (i = 0; i < SIZE; i++) if (t[i] !== "p" && !BLOCK[t[i]]) spots.push(i);
    spots.sort(function (a, b) { return dist(a, bi) - dist(b, bi) || a - b; });
    spots = shuffle(r, spots.slice(0, 6));
    st.folk.forEach(function (f, fi) {
      s.u.push({ id: s.nid++, k: f.c, f: 1, fi: fi, at: spots[fi], hp: f.mh, mh: f.mh, mo: 0, ac: 0, it: null, sn: 0 });
    });
    var ro = { s: s.r };
    s.r = ro;
    first.forEach(function (kd) {
      var at = entryTiles(s, kd, []);
      if (at.length) newInvader(s, kd, at[rint(ro, at.length)]);
    });
    pickNext(s, sched[1]);
    s.r = ro.s;
    withRng(s, function () { reveal(st, s); });
    return s;
  }
  // The season's rng is a number in the state; the code works on { s }.
  function withRng(s, fn) {
    var ro = { s: s.r };
    s.r = ro;
    try { return fn(); } finally { s.r = ro.s; }
  }
  // A new season: the quota is a share of the most the fields can give,
  // but never more than the solver bot brings in with these folk (so
  // every season can be won); a layout the bot does badly on is skipped
  // (the next salt, the same for every device).
  function makeSeason(st) {
    var best = null;
    for (var salt = 0; salt < 6; salt++) {
      var s = layout(st, salt);
      var got = solve(st, s);
      if (!best || got / s.max > best.got / best.s.max) best = { s: s, got: got };
      if (got >= Math.ceil(s.max * 0.5)) break;
    }
    best.s.q = Math.max(1, Math.min(Math.ceil(best.s.max * QUOTA[st.diff]), best.got));
    st.ready = 0;
    return best.s;
  }

  // ---------- The year ----------
  function trioOk(p) {
    if (!Array.isArray(p) || p.length !== 3) return false;
    var seen = {};
    return p.every(function (c) {
      if (typeof c !== "string" || !FOLK.hasOwnProperty(c) || seen[c]) return false;
      seen[c] = 1;
      return true;
    });
  }
  function newYear(seed, diff, trio, end) {
    var st = { v: 1, seed: String(seed), diff: diff, end: end || FARMS.length, farm: 1, sea: 1,
      folk: trio.map(function (c) { return { c: c, mh: FOLK[c].hp, mv: FOLK[c].mv, u: [0, 0] }; }),
      coins: 0, won: 0, total: 0, best: 0, ready: 0, phase: "play", res: null, s: null, acts: 0, over: -1 };
    st.s = makeSeason(st);
    return st;
  }
  function lastSeason(st) { return st.farm >= st.end && st.sea >= SEASONS; }
  function finishSeason(st, ev) {
    var s = st.s, h = harvestOf(s), w = wishOk(s);
    s.done = 1;
    s.h = h;
    st.res = { h: h, q: s.q, w: w ? 1 : 0 };
    note(ev, { k: "harvest", n: h, q: s.q, w: w ? 1 : 0 });
    if (h < s.q) { st.over = 0; return; }
    st.won++;
    st.total += h;
    st.best = Math.max(st.best, h);
    st.coins = Math.min(MAX_COINS, st.coins + (h - s.q) + (w ? WISH_BONUS : 0));
    if (lastSeason(st)) st.over = 1;
    else st.phase = "shop";
  }
  function endTurnS(st, s, ev) {
    withRng(s, function () {
      resolve(st, s, ev);
      grow(s, ev);
      if (s.turn >= T) return;
      spawn(s, ev);
      s.turn++;
      s.u.forEach(function (u) { u.mo = 0; u.ac = 0; });
      pickNext(s, s.sched[s.turn] || []);
      reveal(st, s);
    });
  }
  function shopOk(st, a) {
    if (st.phase !== "shop" || st.over >= 0) return false;
    if (a.k === "ready") return st.ready < MAX_READY && st.coins >= COST.ready;
    if (!isInt(a.f) || a.f < 0 || a.f > 2) return false;
    var f = st.folk[a.f];
    if (a.k === "hp") return f.mh < MAX_HP && st.coins >= COST.hp;
    if (a.k === "mv") return f.mv < MAX_MV && st.coins >= COST.mv;
    if (a.k === "up") return (a.n === 0 || a.n === 1) && !f.u[a.n] && st.coins >= COST.up;
    return false;
  }
  // Every action. Returns the events (for the screen), or null when the
  // action is not allowed (the state is then unchanged).
  function act(st, a) {
    if (!a || st.over >= 0) return null;
    var s = st.s, ev = [], u;
    if (a.t === "mv" || a.t === "tool") {
      if (st.phase !== "play" || s.done) return null;
      u = unitById(s, a.u);
      if (!u || u.f !== 1) return null;
      if (a.t === "mv") {
        if (movesS(st, s, u).indexOf(a.to) < 0) return null;
        note(ev, { k: "move", from: u.at, at: a.to });
        u.at = a.to;
        u.mo = 1;
      } else {
        if (targetsS(st, s, u).indexOf(a.at) < 0) return null;
        withRng(s, function () { applyTool(st, s, u, a.at, ev); });
      }
      st.acts++;
      return ev;
    }
    if (a.t === "end") {
      if (st.phase !== "play" || s.done) return null;
      var last = s.turn >= T;
      endTurnS(st, s, ev);
      st.acts++;
      if (last) finishSeason(st, ev);
      return ev;
    }
    if (a.t === "buy") {
      if (!shopOk(st, a)) return null;
      if (a.k === "ready") { st.ready++; st.coins -= COST.ready; }
      else {
        var f = st.folk[a.f];
        if (a.k === "hp") f.mh++;
        else if (a.k === "mv") f.mv++;
        else f.u[a.n] = 1;
        st.coins -= COST[a.k];
      }
      note(ev, { k: "buy", b: a.k });
      return ev;
    }
    if (a.t === "next") {
      if (st.phase !== "shop") return null;
      if (st.sea >= SEASONS) { st.farm++; st.sea = 1; } else st.sea++;
      st.phase = "play";
      st.res = null;
      st.s = makeSeason(st);
      note(ev, { k: "season" });
      return ev;
    }
    return null;
  }

  // ---------- Bots (the season maker's solver, and the tests) ----------
  function cloneS(s) {
    return { turn: s.turn, q: s.q, max: s.max, wish: s.wish, drove: s.drove, t: s.t.slice(), g: s.g.slice(), x: s.x.slice(),
      p: s.p.slice(), barn: s.barn, bi: s.bi,
      u: s.u.map(function (u) {
        return { id: u.id, k: u.k, f: u.f, fi: u.fi, at: u.at, hp: u.hp, mh: u.mh, mo: u.mo, ac: u.ac,
          it: u.it ? { d: u.it.d, r: u.it.r, a: u.it.a } : null, sn: u.sn };
      }),
      nid: s.nid, next: s.next.map(function (e) { return e.w ? { k: e.k, at: e.at, w: 1 } : { k: e.k, at: e.at }; }),
      wx: s.wx, sched: s.sched, rw: s.rw, r: s.r, done: s.done, h: s.h };
  }
  function clone(st) { return JSON.parse(JSON.stringify(st)); }
  // How good a season looks after the invaders have acted.
  function scoreS(s) {
    var left = T - s.turn + 1, sc = 0;
    for (var i = 0; i < SIZE; i++) if (s.t[i] === "f") sc += 10 * (s.x[i] ? s.g[i] : Math.min(MAX_STAGE, s.g[i] + left));
    s.u.forEach(function (u) {
      if (u.f === 1) sc += 8 + 3 * u.hp;
      else sc -= 4 + 2 * u.hp;
    });
    sc += 5 * s.barn;
    if (s.wish.k === "star" && !s.x[s.wish.i]) sc += 6;
    if (s.wish.k === "drive") sc += 3 * Math.min(DRIVE_N, s.drove);
    return sc;
  }
  function simAfter(st, s) {
    var c = cloneS(s);
    withRng(c, function () { resolve(st, c, null); });
    return scoreS(c);
  }
  // One farmhand's best move and tool on s (greedy: each choice is
  // scored by playing out the invaders' acts).
  function bestFor(st, s, fi) {
    var u = folkUnit(s, fi);
    if (!u) return null;
    var spots = [u.at].concat(movesS(st, s, u)), best = null;
    spots.forEach(function (at) {
      var c = cloneS(s), cu = folkUnit(c, fi);
      cu.at = at;
      if (at !== u.at) cu.mo = 1;
      var tgs = [-1].concat(targetsS(st, c, cu));
      tgs.forEach(function (tg) {
        var d = cloneS(c), du = folkUnit(d, fi);
        if (tg >= 0) withRng(d, function () { applyTool(st, d, du, tg, null); });
        var sc = simAfter(st, d);
        if (!best || sc > best.sc) best = { sc: sc, at: at, tg: tg };
      });
    });
    return best;
  }
  function planTurn(st, s, smart) {
    var orders = smart ? [[0, 1, 2], [2, 1, 0], [1, 0, 2]] : [[0, 1, 2]], top = null;
    orders.forEach(function (ord) {
      var c = cloneS(s), plan = [];
      ord.forEach(function (fi) {
        var b = bestFor(st, c, fi);
        if (!b) return;
        var u = folkUnit(c, fi);
        if (b.at !== u.at) { plan.push({ t: "mv", u: u.id, to: b.at }); u.at = b.at; u.mo = 1; }
        if (b.tg >= 0) { plan.push({ t: "tool", u: u.id, at: b.tg }); withRng(c, function () { applyTool(st, c, u, b.tg, null); }); }
      });
      var sc = simAfter(st, c);
      if (!top || sc > top.sc) top = { sc: sc, plan: plan };
    });
    return top.plan;
  }
  // The solver: plays a whole season on a copy, returns the harvest.
  function solve(st, s) {
    var tmp = { folk: st.folk }, c = cloneS(s);
    while (!c.done) {
      planTurn(tmp, c, false).forEach(function (a) {
        var u = unitById(c, a.u);
        if (!u) return;
        if (a.t === "mv") { u.at = a.to; u.mo = 1; }
        else withRng(c, function () { applyTool(tmp, c, u, a.at, null); });
      });
      var last = c.turn >= T;
      endTurnS(tmp, c, null);
      if (last) { c.done = 1; c.h = harvestOf(c); }
    }
    return c.h;
  }
  // Plays the player's turn (and End turn) for the tests. smart: the
  // solver's way; else a simple bot: go at the nearest invader and use
  // the tool on it, no pulls, hedges or plans.
  function botTurn(st, smart) {
    var s = st.s;
    if (st.phase !== "play" || s.done) return;
    if (smart) planTurn(st, s, true).forEach(function (a) { act(st, a); });
    else {
      folks(s).forEach(function (u) {
        var foes = invaders(s);
        if (!foes.length) return;
        var hit = function () {
          var tg = targetsS(st, s, u).filter(function (i) { var v = unitAt(s, i); return v && v.f === 0; });
          if (tg.length) { act(st, { t: "tool", u: u.id, at: tg[0] }); return true; }
          return false;
        };
        if (hit()) return;
        var near = foes.slice().sort(function (a, b) { return dist(a.at, u.at) - dist(b.at, u.at) || a.id - b.id; })[0];
        var mv = movesS(st, s, u).sort(function (a, b) { return dist(a, near.at) - dist(b, near.at) || a - b; });
        if (mv.length && dist(mv[0], near.at) < dist(u.at, near.at)) act(st, { t: "mv", u: u.id, to: mv[0] });
        hit();
      });
    }
    act(st, { t: "end" });
  }
  // Shop for the bots: upgrades first, then Health, then Move.
  function botShop(st) {
    var again = true;
    while (again) {
      again = false;
      for (var f = 0; f < 3 && !again; f++) {
        var tries = [{ t: "buy", k: "up", f: f, n: 0 }, { t: "buy", k: "up", f: f, n: 1 }, { t: "buy", k: "hp", f: f }];
        for (var k = 0; k < tries.length; k++) if (act(st, tries[k])) { again = true; break; }
      }
    }
    act(st, { t: "next" });
  }

  // ---------- Checks (a session from storage) ----------
  function okUnit(u, s) {
    if (!u || typeof u !== "object" || !isInt(u.id) || u.id < 1 || u.id >= s.nid || (u.f !== 0 && u.f !== 1)) return false;
    if (!isInt(u.at) || u.at < 0 || u.at >= SIZE || !isInt(u.hp) || !isInt(u.mh) || u.hp < 1 || u.hp > u.mh || u.mh > 99) return false;
    if ((u.mo !== 0 && u.mo !== 1) || (u.ac !== 0 && u.ac !== 1) || (u.sn !== 0 && u.sn !== 1)) return false;
    if (u.f === 1) return FOLK.hasOwnProperty(u.k) && isInt(u.fi) && u.fi >= 0 && u.fi <= 2 && u.it === null;
    if (!INVADERS.hasOwnProperty(u.k) || u.fi !== -1) return false;
    if (u.it === null) return true;
    return !!u.it && typeof u.it === "object" && isInt(u.it.d) && u.it.d >= 0 && u.it.d <= 3 && isInt(u.it.r) &&
      u.it.r >= 0 && u.it.r <= 1 && ACTS.hasOwnProperty(u.it.a);
  }
  function okSeason(st, s) {
    if (!s || typeof s !== "object" || !isInt(s.turn) || s.turn < 1 || s.turn > T || !isInt(s.q) || s.q < 1 || !isInt(s.max) || s.q > s.max) return false;
    var arr = function (a, ok) { return Array.isArray(a) && a.length === SIZE && a.every(ok); };
    if (!arr(s.t, function (c) { return typeof c === "string" && c.length === 1 && TILES.indexOf(c) >= 0; })) return false;
    if (!arr(s.g, function (v) { return isInt(v) && v >= 0 && v <= MAX_STAGE; })) return false;
    if (!arr(s.x, function (v) { return isInt(v) && v >= 0 && v <= HEDGE_HP; })) return false;
    if (!arr(s.p, function (v) { return v === 0 || v === 1; })) return false;
    if (!isInt(s.bi) || s.t[s.bi] !== "b" || s.t.filter(function (c) { return c === "b"; }).length !== 1) return false;
    if (!isInt(s.barn) || s.barn < 0 || s.barn > BARN_HP || !isInt(s.drove) || s.drove < 0 || s.drove > 999) return false;
    if (!isInt(s.nid) || s.nid < 1 || s.nid > 9999 || !isInt(s.rw) || s.rw < 0 || s.rw > 1 || !isInt(s.r)) return false;
    if ((s.done !== 0 && s.done !== 1) || !isInt(s.h) || s.h < 0) return false;
    var w = s.wish;
    if (!w || ["star", "barn", "drive"].indexOf(w.k) < 0 || (w.k === "star" && !(isInt(w.i) && w.i >= 0 && w.i < SIZE))) return false;
    if (!Array.isArray(s.wx) || s.wx.length !== T + 1 || !s.wx.every(function (c) { return ["c", "r", "n", "e", "s", "w"].indexOf(c) >= 0; })) return false;
    if (!Array.isArray(s.sched) || s.sched.length !== T + 1 || !s.sched.every(function (l) {
      return Array.isArray(l) && l.length <= 9 && l.every(function (k) { return INVADERS.hasOwnProperty(k); });
    })) return false;
    if (!Array.isArray(s.u) || s.u.length > 40 || !s.u.every(function (u) { return okUnit(u, s); })) return false;
    var seenAt = {}, seenId = {}, seenFi = {};
    if (!s.u.every(function (u) {
      if (seenAt[u.at] || seenId[u.id]) return false;
      seenAt[u.at] = seenId[u.id] = 1;
      if (!standable(s, u, u.at) && !(flies(u) && !BLOCK[s.t[u.at]])) return false;
      if (u.f === 1) {
        if (seenFi[u.fi] || st.folk[u.fi].c !== u.k || (!s.done && u.mh !== st.folk[u.fi].mh)) return false;
        seenFi[u.fi] = 1;
      }
      return true;
    })) return false;
    if (!Array.isArray(s.next) || s.next.length > 9 || !s.next.every(function (e) {
      return e && INVADERS.hasOwnProperty(e.k) && isInt(e.at) && e.at >= 0 && e.at < SIZE && (e.w === undefined || e.w === 1);
    })) return false;
    return true;
  }
  function valid(st) {
    if (!st || typeof st !== "object" || st.v !== 1 || typeof st.seed !== "string" || !/^[a-z0-9]{1,16}$/.test(st.seed)) return false;
    if (DIFFS.indexOf(st.diff) < 0 || !isInt(st.end) || st.end < 1 || st.end > FARMS.length) return false;
    if (!isInt(st.farm) || st.farm < 1 || st.farm > st.end || !isInt(st.sea) || st.sea < 1 || st.sea > SEASONS) return false;
    if (!Array.isArray(st.folk) || st.folk.length !== 3 || !trioOk(st.folk.map(function (f) { return f && f.c; }))) return false;
    if (!st.folk.every(function (f) {
      return isInt(f.mh) && f.mh >= FOLK[f.c].hp && f.mh <= MAX_HP && isInt(f.mv) && f.mv >= FOLK[f.c].mv && f.mv <= MAX_MV &&
        Array.isArray(f.u) && f.u.length === 2 && f.u.every(function (v) { return v === 0 || v === 1; });
    })) return false;
    var nat = function (v, top) { return isInt(v) && v >= 0 && v <= top; };
    if (!nat(st.coins, MAX_COINS) || !nat(st.won, 999) || !nat(st.total, BIG) || !nat(st.best, SIZE * MAX_STAGE) || !nat(st.ready, MAX_READY)) return false;
    if (st.phase !== "play" && st.phase !== "shop") return false;
    if (st.res !== null && !(st.res && nat(st.res.h, SIZE * MAX_STAGE) && nat(st.res.q, SIZE * MAX_STAGE) && (st.res.w === 0 || st.res.w === 1))) return false;
    if (!nat(st.acts, BIG) || (st.over !== -1 && st.over !== 0 && st.over !== 1)) return false;
    if (!okSeason(st, st.s)) return false;
    if (st.phase === "shop" && (!st.s.done || st.over >= 0)) return false;
    if (st.over < 0 && st.phase === "play" && st.s.done) return false;
    return true;
  }

  var api = {
    N: N, SIZE: SIZE, T: T, SEASONS: SEASONS, MAX_STAGE: MAX_STAGE, DIFFS: DIFFS, COST: COST, MAX_HP: MAX_HP, MAX_MV: MAX_MV,
    MAX_READY: MAX_READY, WISH_BONUS: WISH_BONUS, DRIVE_N: DRIVE_N, BARN_HP: BARN_HP, WIND: WIND, BLOCK: BLOCK,
    FOLK: FOLK, FOLK_IDS: FOLK_IDS, TOOLS: TOOLS, UPS: UPS, INVADERS: INVADERS, ACTS: ACTS, FARMS: FARMS,
    hashStr: hashStr, step: step, dist: dist, dirTo: dirTo, unitAt: unitAt, unitById: unitById, folkUnit: folkUnit,
    trioOk: trioOk, newYear: newYear, toolOf: toolOf, actOrder: actOrder, intentTile: intentTile, chargePath: chargePath,
    harvestOf: harvestOf, wishOk: wishOk, shopOk: shopOk, lastSeason: lastSeason,
    moves: function (st, id) { return movesS(st, st.s, unitById(st.s, id)); },
    targets: function (st, id) { return targetsS(st, st.s, unitById(st.s, id)); },
    projected: function (s) {
      var left = T - s.turn + 1, h = 0;
      for (var i = 0; i < SIZE; i++) if (s.t[i] === "f") h += s.x[i] ? s.g[i] : Math.min(MAX_STAGE, s.g[i] + left);
      return h;
    },
    act: act, valid: valid, clone: clone, botTurn: botTurn, botShop: botShop, solve: solve
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.FieldwardenEngine = api;
})(typeof window !== "undefined" ? window : this);
