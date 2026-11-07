// ============================================================
// orOS Banner — rules engine and computer players (v1.0.0)
// NOT the UI: no DOM, no storage. Loaded by banner/index.html
// (window.BannerEngine, after banner/cards.js) and by
// tests/banner.test.js (module.exports).
//
// A turn-based card battler on a small tile board. Original rules,
// numbers and names (plan: /mnt/project-files/games/strategy/
// banner-plan.md, Bible Part IX "Banner").
//
// Board: W 5 × H 7 square tiles, cell i = y * W + x. Side 0 (blue)
// has its home row at the bottom (y 6), side 1 (red) at the top (y 0);
// each Keep stands in the middle of its home row. Three shrines on the
// middle row (y 3).
//
// State (plain JSON, kept as is in the device-local session):
//   { v: 1, seed, decks: [id, id], map: terrain string (W × H):
//       "." plain, "w" wood, "r" rock, "~" water, "b" bridge, "t" tower,
//       "m" mire, "s" spring, "d" road,
//     keep: [hp, hp], hand: [[card], [card]], deck: [[card], [card]] (next first),
//     units: [{ id, k, s: side, i, hp, mv: 1 moved, at: 1 attacked, f: 1 played this turn, st: 1 stuck }],
//     side: whose turn, turn: 1…, rt: [own turns, own turns], en: [energy, energy],
//     hold: [turns holding all shrines, …], rally: [0|1, 0|1], tired: [sudden-death hits so far, …],
//     disc: [[card], [card]] discard piles, rng: [uint32, uint32] (reshuffles),
//     nid, n: actions taken, over: -1 playing | 0 | 1 winner, why: "" | "keep" | "shrines" }
//
// Rules (also in banner/help.en.txt):
//   - A turn: draw 2 (not on the first turn of the battle; hand at most
//     6, a card drawn into a full hand is lost), energy = the side's own
//     turn number (at most 6) + 1 for each shrine it holds; then play
//     cards and use units; each unit may move once and attack once.
//   - A unit card is placed on your home row, or next to one of your
//     units on your half or the middle row. A new unit cannot act on
//     its first turn, unless it has Charge.
//   - Damage = Attack (+1 on a tower, +1 Rally), −1 for a target in
//     wood, −1 for a target next to a friendly Guard; at least 1. A
//     unit that survives a hit from next to it hits back. No dice.
//   - Reach attacks 2 tiles away in a line (not past a rock). Climb
//     passes rock and water. Heal: 1 to the friends next to it at the
//     end of your turn.
//   - Win: break the enemy Keep, or start three of your turns in a row
//     holding all three shrines. An empty deck takes back its discard
//     pile. From a side's 15th turn its own Keep loses 1, 2, 3… at the
//     start of each of its turns, so every battle ends.
// ============================================================
(function (root) {
  "use strict";

  var D = root.BannerCards || (typeof require === "function" ? require("./cards.js") : null);
  var CARDS = D.CARDS, DECKS = D.DECKS, DECK_IDS = D.DECK_IDS;

  var W = 5, H = 7, N = W * H;
  var KEEP_HP = 15, HAND_MAX = 6, HAND_START = 4, DRAW = 2, EN_MAX = 6, HOLD_WIN = 3, SUDDEN = 15;
  var KEEPS = [6 * W + 2, 0 * W + 2];            // side 0 bottom, side 1 top
  var SHRINES = [3 * W + 0, 3 * W + 2, 3 * W + 4];
  var DX = [0, 1, 0, -1], DY = [-1, 0, 1, 0];
  var TILE_OF = { wood: "w", rock: "r", bridge: "b", tower: "t", mire: "m", spring: "s", road: "d", pond: "~" };
  var LEVELS = ["e", "m", "h"];                   // Easy, Medium, Hard

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
  function rnd(o) {
    var x = o.s >>> 0 || 0x9e3779b9;
    x ^= x << 13; x >>>= 0;
    x ^= x >>> 17;
    x ^= x << 5; x >>>= 0;
    o.s = x;
    return x / 4294967296;
  }
  function rint(o, n) { return Math.floor(rnd(o) * n); }

  // ---------- Geometry ----------
  function xy(i) { return { x: i % W, y: Math.floor(i / W) }; }
  function idx(x, y) { return y * W + x; }
  function step(i, d) {
    var p = xy(i), x = p.x + DX[d], y = p.y + DY[d];
    return x < 0 || y < 0 || x >= W || y >= H ? -1 : idx(x, y);
  }
  function dist(a, b) { var p = xy(a), q = xy(b); return Math.abs(p.x - q.x) + Math.abs(p.y - q.y); }
  function homeRow(side) { return side === 0 ? H - 1 : 0; }
  // Rows where a side may place a unit next to its own: its half and the middle row.
  function ownRows(side, y) { return side === 0 ? y >= 3 : y <= 3; }
  function isKeep(i) { return i === KEEPS[0] || i === KEEPS[1]; }
  function isShrine(i) { return SHRINES.indexOf(i) >= 0; }
  function card(k) { return typeof k === "string" && Object.prototype.hasOwnProperty.call(CARDS, k) ? CARDS[k] : null; }

  // ---------- Board ----------
  // Ground passes plain, wood, bridge, tower, mire, spring, road; rock
  // and water need Climb.
  function passable(t, climb) { return climb || (t !== "r" && t !== "~"); }
  // Can a ground unit get from each home row to the cells next to the
  // other Keep? (units ignored)
  function pathOk(map) {
    for (var side = 0; side < 2; side++) {
      var seen = {}, q = [], hy = homeRow(side);
      for (var x = 0; x < W; x++) {
        var c = idx(x, hy);
        if (!isKeep(c) && passable(map.charAt(c), false)) { seen[c] = 1; q.push(c); }
      }
      var goal = KEEPS[1 - side], ok = false;
      while (q.length && !ok) {
        var cur = q.shift();
        for (var d = 0; d < 4; d++) {
          var n = step(cur, d);
          if (n < 0) continue;
          if (n === goal) { ok = true; break; }
          if (seen[n] || isKeep(n) || !passable(map.charAt(n), false)) continue;
          seen[n] = 1;
          q.push(n);
        }
      }
      if (!ok) return false;
    }
    return true;
  }
  // A seeded, mirror-fair board: rows 1–2 get a few tiles, rows 4–5
  // the same turned half round; the middle row gets one mirrored pair.
  function makeBoard(seed) {
    var r = { s: hashStr("banner:" + seed + ":board") || 1 };
    for (var tries = 0; tries < 50; tries++) {
      var m = [];
      for (var i = 0; i < N; i++) m.push(".");
      var kinds = ["w", "w", "r", "~", "t", "s"];
      var n = 2 + rint(r, 3);
      for (var k = 0; k < n; k++) {
        var c = idx(rint(r, W), 1 + rint(r, 2));
        if (m[c] !== ".") continue;
        var t = kinds[rint(r, kinds.length)];
        m[c] = t;
        m[N - 1 - c] = t;
      }
      if (rnd(r) < 0.6) { var mt = rnd(r) < 0.5 ? "w" : "~"; m[idx(1, 3)] = mt; m[idx(3, 3)] = mt; }
      var map = m.join("");
      if (pathOk(map)) return map;
    }
    var plain = "";
    for (var j = 0; j < N; j++) plain += ".";
    return plain;
  }
  function deckList(id) {
    var out = [];
    (DECKS[id] || []).forEach(function (p) { for (var k = 0; k < p[1]; k++) out.push(p[0]); });
    return out;
  }
  function shuffle(list, r) {
    var a = list.slice();
    for (var i = a.length - 1; i > 0; i--) { var j = rint(r, i + 1), t = a[i]; a[i] = a[j]; a[j] = t; }
    return a;
  }

  // A new battle. decks: [id, id] (DECK_IDS); first: the side that
  // starts (0 | 1, default from the seed); lists (March, 5.66.00):
  // [cards | null, cards | null], a side's own card list in place of
  // its deck's (MARCH_MIN–MARCH_MAX known cards; decks[s] stays the
  // deck it grew from).
  var MARCH_MIN = 15, MARCH_MAX = 30;
  function listOk(l) { return Array.isArray(l) && l.length >= MARCH_MIN && l.length <= MARCH_MAX && l.every(function (k) { return !!card(k); }); }
  function newBattle(seed, decks, first, lists) {
    seed = String(seed);
    var dk = [0, 1].map(function (s) { return DECK_IDS.indexOf(decks && decks[s]) >= 0 ? decks[s] : DECK_IDS[s]; });
    var st = { v: 1, seed: seed, decks: dk, map: makeBoard(seed), keep: [KEEP_HP, KEEP_HP], hand: [[], []], deck: [], units: [],
      side: first === 0 || first === 1 ? first : hashStr("banner:" + seed + ":first") & 1,
      turn: 1, rt: [0, 0], en: [0, 0], hold: [0, 0], rally: [0, 0], tired: [0, 0], disc: [[], []], rng: [0, 0], nid: 1, n: 0, over: -1, why: "" };
    for (var s = 0; s < 2; s++) {
      var r = { s: hashStr("banner:" + seed + ":deck:" + s) || 1 };
      st.deck.push(shuffle(lists && listOk(lists[s]) ? lists[s].slice() : deckList(dk[s]), r));
      st.rng[s] = r.s;
      st.hand[s] = st.deck[s].splice(0, HAND_START);
    }
    startTurn(st, [], true);
    return st;
  }

  // ---------- Queries ----------
  function unitAt(st, i) {
    for (var k = 0; k < st.units.length; k++) if (st.units[k].i === i) return st.units[k];
    return null;
  }
  function unitById(st, id) {
    for (var k = 0; k < st.units.length; k++) if (st.units[k].id === id) return st.units[k];
    return null;
  }
  function shrinesHeld(st, side) {
    var n = 0;
    SHRINES.forEach(function (c) { var u = unitAt(st, c); if (u && u.s === side) n++; });
    return n;
  }
  function guarded(st, u) {
    for (var d = 0; d < 4; d++) {
      var g = unitAt(st, step(u.i, d));
      if (g && g.s === u.s && card(g.k).kw === "guard") return true;
    }
    return false;
  }
  function atkOf(st, u, onTurn) {
    var a = card(u.k).atk;
    if (a <= 0) return 0;
    if (st.map.charAt(u.i) === "t") a++;
    if (onTurn && st.rally[u.s]) a++;
    return a;
  }
  // Damage from attacker a (its Attack already counted) to unit b.
  function dmgTo(st, a, b) {
    if (a <= 0) return 0;
    var d = a;
    if (st.map.charAt(b.i) === "w") d--;
    if (guarded(st, b)) d--;
    return Math.max(1, d);
  }
  function canAct(st, u) { return !u.f || card(u.k).kw === "charge"; }

  // Cells a unit can move to this turn.
  function moves(st, u) {
    if (st.over >= 0 || u.s !== st.side || u.mv || u.st || !canAct(st, u)) return [];
    var c = card(u.k), climb = c.kw === "climb";
    var mv = c.mv + (st.map.charAt(u.i) === "d" ? 1 : 0);
    var dd = {}, q = [u.i], out = [];
    dd[u.i] = 0;
    while (q.length) {
      var cur = q.shift();
      if (dd[cur] >= mv) continue;
      if (cur !== u.i && st.map.charAt(cur) === "m") continue;   // mire stops
      for (var d = 0; d < 4; d++) {
        var n = step(cur, d);
        if (n < 0 || dd[n] !== undefined || isKeep(n) || unitAt(st, n) || !passable(st.map.charAt(n), climb)) continue;
        dd[n] = dd[cur] + 1;
        out.push(n);
        q.push(n);
      }
    }
    return out.sort(function (a, b) { return a - b; });
  }
  // Cells a unit can attack: enemy units, or the enemy Keep.
  function attacks(st, u) {
    if (st.over >= 0 || u.s !== st.side || u.at || !canAct(st, u) || card(u.k).atk <= 0) return [];
    var out = [], reach = card(u.k).kw === "reach";
    function ok(c) {
      if (c === KEEPS[1 - u.s]) return true;
      var e = unitAt(st, c);
      return !!(e && e.s !== u.s);
    }
    for (var d = 0; d < 4; d++) {
      var n = step(u.i, d);
      if (n < 0) continue;
      if (ok(n)) out.push(n);
      if (reach && st.map.charAt(n) !== "r" && !isKeep(n)) {
        var n2 = step(n, d);
        if (n2 >= 0 && ok(n2)) out.push(n2);
      }
    }
    return out.sort(function (a, b) { return a - b; });
  }
  // Cells where hand card h can go (-1 for a card without a target).
  function targets(st, h) {
    var s = st.side, k = st.hand[s][h], c = card(k);
    if (st.over >= 0 || !c || c.c > st.en[s]) return [];
    var out = [], i, u;
    if (c.t === "u") {
      var climb = c.kw === "climb";
      for (i = 0; i < N; i++) {
        if (isKeep(i) || unitAt(st, i) || !passable(st.map.charAt(i), climb)) continue;
        var p = xy(i), near = false;
        if (p.y === homeRow(s)) near = true;
        else if (ownRows(s, p.y)) {
          for (var d = 0; d < 4; d++) { u = unitAt(st, step(i, d)); if (u && u.s === s) near = true; }
        }
        if (near) out.push(i);
      }
      return out;
    }
    if (c.t === "t") {
      var tc = TILE_OF[k];
      for (i = 0; i < N; i++) {
        if (isKeep(i) || isShrine(i) || xy(i).y === homeRow(1 - s)) continue;
        var cur = st.map.charAt(i);
        if (k === "bridge") { if (cur === "~") out.push(i); continue; }
        if (cur === tc || cur === "~") continue;
        if ((tc === "r" || tc === "~") && unitAt(st, i)) continue;
        if ((tc === "r" || tc === "~") && !pathOk(st.map.slice(0, i) + tc + st.map.slice(i + 1))) continue;
        out.push(i);
      }
      return out;
    }
    // spells
    if (k === "rally" || k === "storm") return [-1];
    if (k === "fortify") return st.keep[s] < KEEP_HP ? [-1] : [];
    st.units.forEach(function (x) {
      if (k === "spark" && x.s !== s) out.push(x.i);
      else if (k === "mend" && x.s === s && x.hp < card(x.k).hp) out.push(x.i);
      else if ((k === "recall" || k === "haste") && x.s === s) out.push(x.i);
    });
    if (k === "quake") for (i = 0; i < N; i++) { var t = st.map.charAt(i); if (t !== "." && !(t === "~" && unitAt(st, i))) out.push(i); }
    return out.sort(function (a, b) { return a - b; });
  }

  // Every action open to the side whose turn it is ("end" last).
  function legal(st) {
    if (st.over >= 0) return [];
    var out = [], s = st.side;
    st.hand[s].forEach(function (k, h) {
      if (h > 0 && st.hand[s].indexOf(k) < h) return;   // the same card twice: one is enough
      targets(st, h).forEach(function (c) { out.push({ t: "play", h: h, c: c }); });
    });
    st.units.forEach(function (u) {
      if (u.s !== s) return;
      moves(st, u).forEach(function (c) { out.push({ t: "move", u: u.id, c: c }); });
      attacks(st, u).forEach(function (c) { out.push({ t: "atk", u: u.id, c: c }); });
    });
    out.push({ t: "end" });
    return out;
  }

  // ---------- Turn flow ----------
  function hurtKeep(st, side, n, ev) {
    st.keep[side] = Math.max(0, st.keep[side] - n);
    ev.push({ e: "keep", s: side, n: n, hp: st.keep[side] });
    if (st.keep[side] <= 0) win(st, 1 - side, "keep", ev);
  }
  function win(st, side, why, ev) {
    if (st.over >= 0) return;
    st.over = side;
    st.why = why;
    ev.push({ e: "win", s: side, why: why });
  }
  // An empty deck takes the discard pile back, shuffled by the side's
  // own random numbers in the state.
  function draw(st, side, ev) {
    if (!st.deck[side].length) {
      if (!st.disc[side].length) return;
      var r = { s: st.rng[side] };
      st.deck[side] = shuffle(st.disc[side], r);
      st.rng[side] = r.s;
      st.disc[side] = [];
      ev.push({ e: "reshuffle", s: side });
    }
    var k = st.deck[side].shift();
    if (st.hand[side].length >= HAND_MAX) { st.disc[side].push(k); ev.push({ e: "burn", s: side, k: k }); return; }
    st.hand[side].push(k);
    ev.push({ e: "draw", s: side });
  }
  function startTurn(st, ev, first) {
    var s = st.side;
    st.rt[s]++;
    st.rally = [0, 0];
    st.units.forEach(function (u) {
      if (u.s !== s) return;
      u.mv = u.st ? 1 : 0;
      u.st = 0;
      u.at = 0;
      u.f = 0;
    });
    if (!first) for (var dr = 0; dr < DRAW; dr++) draw(st, s, ev);
    // Long battles end: from the side's turn SUDDEN on, its own Keep
    // loses 1, 2, 3… at the start of each of its turns.
    if (st.rt[s] >= SUDDEN) {
      st.tired[s]++;
      ev.push({ e: "tired", s: s, n: st.tired[s] });
      hurtKeep(st, s, st.tired[s], ev);
    }
    if (st.over >= 0) return;
    var held = shrinesHeld(st, s);
    st.en[s] = Math.min(EN_MAX, st.rt[s]) + held;
    if (held === SHRINES.length) {
      st.hold[s]++;
      ev.push({ e: "hold", s: s, n: st.hold[s] });
      if (st.hold[s] >= HOLD_WIN) win(st, s, "shrines", ev);
    } else st.hold[s] = 0;
    ev.push({ e: "turn", s: s });
  }
  function endTurn(st, ev) {
    var s = st.side;
    // Heal and springs at the end of the side's turn
    st.units.forEach(function (u) {
      if (u.s !== s) return;
      var c = card(u.k);
      if (c.kw === "heal") {
        for (var d = 0; d < 4; d++) {
          var f = unitAt(st, step(u.i, d));
          if (f && f.s === s) heal(st, f, 1, ev);
        }
      }
    });
    st.units.forEach(function (u) { if (u.s === s && st.map.charAt(u.i) === "s") heal(st, u, 1, ev); });
    st.side = 1 - s;
    st.turn++;
    startTurn(st, ev, false);
  }
  function heal(st, u, n, ev) {
    var max = card(u.k).hp, before = u.hp;
    u.hp = Math.min(max, u.hp + n);
    if (u.hp > before) ev.push({ e: "heal", c: u.i, n: u.hp - before });
  }
  function hurt(st, u, n, ev) {
    u.hp -= n;
    ev.push({ e: "hit", c: u.i, n: n, k: u.k });
    if (u.hp <= 0) {
      st.units.splice(st.units.indexOf(u), 1);
      st.disc[u.s].push(u.k);
      ev.push({ e: "die", c: u.i, k: u.k, s: u.s });
      return true;
    }
    return false;
  }

  // Do one action for the side whose turn it is. Returns the events,
  // or null when the action is not allowed (nothing changed).
  //   { t: "play", h: hand index, c: cell | -1 }
  //   { t: "move", u: unit id, c: cell }
  //   { t: "atk",  u: unit id, c: cell }
  //   { t: "end" }
  function act(st, a) {
    if (!a || st.over >= 0) return null;
    var s = st.side, ev = [], u;
    if (a.t === "end") { endTurn(st, ev); st.n++; return ev; }
    if (a.t === "play") {
      if (!isInt(a.h) || a.h < 0 || a.h >= st.hand[s].length) return null;
      if (targets(st, a.h).indexOf(a.c) < 0) return null;
      var k = st.hand[s][a.h], c = card(k);
      st.hand[s].splice(a.h, 1);
      st.en[s] -= c.c;
      ev.push({ e: "play", s: s, k: k, c: a.c });
      if (c.t !== "u") st.disc[s].push(k);
      if (c.t === "u") {
        st.units.push({ id: st.nid++, k: k, s: s, i: a.c, hp: c.hp, mv: 0, at: 0, f: 1, st: 0 });
      } else if (c.t === "t") {
        st.map = st.map.slice(0, a.c) + TILE_OF[k] + st.map.slice(a.c + 1);
      } else spell(st, k, a.c, ev);
      st.n++;
      return ev;
    }
    if (a.t === "move") {
      u = unitById(st, a.u);
      if (!u || moves(st, u).indexOf(a.c) < 0) return null;
      ev.push({ e: "move", u: u.id, from: u.i, to: a.c });
      u.i = a.c;
      u.mv = 1;
      if (st.map.charAt(u.i) === "m") { u.st = 1; ev.push({ e: "stuck", c: u.i }); }
      st.n++;
      return ev;
    }
    if (a.t === "atk") {
      u = unitById(st, a.u);
      if (!u || attacks(st, u).indexOf(a.c) < 0) return null;
      u.at = 1;
      var power = atkOf(st, u, true);
      ev.push({ e: "atk", u: u.id, from: u.i, to: a.c });
      if (a.c === KEEPS[1 - s]) hurtKeep(st, 1 - s, power, ev);
      else {
        var tg = unitAt(st, a.c);
        var dead = hurt(st, tg, dmgTo(st, power, tg), ev);
        if (!dead && dist(u.i, tg.i) === 1 && card(tg.k).atk > 0) {
          ev.push({ e: "back", from: tg.i, to: u.i });
          hurt(st, u, dmgTo(st, atkOf(st, tg, false), u), ev);
        }
      }
      st.n++;
      return ev;
    }
    return null;
  }
  function spell(st, k, c, ev) {
    var s = st.side, u = c >= 0 ? unitAt(st, c) : null;
    if (k === "spark") hurt(st, u, 2, ev);
    else if (k === "rally") { st.rally[s] = 1; ev.push({ e: "rally", s: s }); }
    else if (k === "recall") {
      st.units.splice(st.units.indexOf(u), 1);
      st.hand[s].push(u.k);
      ev.push({ e: "recall", c: c, k: u.k });
    } else if (k === "mend") heal(st, u, 3, ev);
    else if (k === "haste") { u.mv = 0; u.at = 0; u.f = 0; u.st = 0; ev.push({ e: "haste", c: c }); }
    else if (k === "quake") { st.map = st.map.slice(0, c) + "." + st.map.slice(c + 1); ev.push({ e: "quake", c: c }); }
    else if (k === "storm") {
      st.units.filter(function (x) { return x.s !== s; }).forEach(function (x) { hurt(st, x, 1, ev); });
    } else if (k === "fortify") {
      var before = st.keep[s];
      st.keep[s] = Math.min(KEEP_HP, st.keep[s] + 3);
      ev.push({ e: "fortify", s: s, n: st.keep[s] - before });
    }
  }

  // ---------- Computer players ----------
  function clone(st) { return JSON.parse(JSON.stringify(st)); }
  function keepDist(st, u) { return dist(u.i, KEEPS[1 - u.s]); }
  function unitWorth(u) {
    var c = card(u.k);
    return u.hp + c.atk * 1.5 + (c.kw ? 1 : 0) + c.mv * 0.5 + 1;
  }
  // How good st is for side (higher is better).
  function evaluate(st, side) {
    if (st.over >= 0) return st.over === side ? 1e6 - st.turn : -1e6 + st.turn;
    var o = 1 - side, v = 0;
    v += 4 * (st.keep[side] - st.keep[o]);
    st.units.forEach(function (u) {
      var w = unitWorth(u) + (6 - keepDist(st, u)) * 0.35;
      if (keepDist(st, u) === 1) w += 2;            // at the gate
      v += u.s === side ? w : -w;
    });
    v += 1.5 * (shrinesHeld(st, side) - shrinesHeld(st, o));
    v += 3 * (st.hold[side] - st.hold[o]);
    v += 0.4 * (st.hand[side].length - st.hand[o].length);
    v -= 0.8 * (st.tired[side] - st.tired[o]);
    // what each side could hit next: the other side's threat weighs more
    v += TM * threat(st, side) - TH * threat(st, o);
    return v;
  }
  // Damage side could deal on its next turn, roughly: each unit picks
  // its best target within its move + reach (the Keep counts double).
  var TM = 0.3, TH = 0.7;          // weights: own threat, the other side's threat
  // Cells unit u could stand on at its next turn (its own cell
  // included): a move through free cells, as moves() does.
  function reachOf(st, u) {
    var c = card(u.k), climb = c.kw === "climb", out = [u.i];
    if (u.st) return out;
    var mv = c.mv + (st.map.charAt(u.i) === "d" ? 1 : 0), dd = {}, q = [u.i];
    dd[u.i] = 0;
    while (q.length) {
      var cur = q.shift();
      if (dd[cur] >= mv || (cur !== u.i && st.map.charAt(cur) === "m")) continue;
      for (var d = 0; d < 4; d++) {
        var n = step(cur, d);
        if (n < 0 || dd[n] !== undefined || isKeep(n) || unitAt(st, n) || !passable(st.map.charAt(n), climb)) continue;
        dd[n] = dd[cur] + 1;
        out.push(n);
        q.push(n);
      }
    }
    return out;
  }
  // What side could do on its next turn, roughly, in evaluate() units:
  // each unit takes its best target from the cells it can reach (a hit
  // on the Keep is worth 4 per point, like Keep Health).
  function threat(st, side) {
    var total = 0, gate = KEEPS[1 - side];
    st.units.forEach(function (u) {
      if (u.s !== side) return;
      var c = card(u.k);
      if (c.atk <= 0) return;
      var span = c.kw === "reach" ? 2 : 1, best = 0, from = reachOf(st, u);
      function inRange(t) {
        for (var k = 0; k < from.length; k++) if (dist(from[k], t) <= span && (span === 1 || dist(from[k], t) === 1 || xy(from[k]).x === xy(t).x || xy(from[k]).y === xy(t).y)) return true;
        return false;
      }
      if (inRange(gate)) best = 4 * c.atk;
      st.units.forEach(function (e) {
        if (e.s === side || !inRange(e.i)) return;
        var d = Math.min(e.hp, Math.max(1, c.atk - (st.map.charAt(e.i) === "w" ? 1 : 0)));
        var val = d + (e.hp <= c.atk ? unitWorth(e) * 0.6 : 0);
        if (val > best) best = val;
      });
      total += best;
    });
    return total;
  }
  function tryAct(st, a) { var c = clone(st); return act(c, a) ? c : null; }

  // Easy: plain rules of thumb, in order.
  function easyAction(st) {
    var s = st.side, mine = st.units.filter(function (u) { return u.s === s; });
    var i, at, best;
    for (i = 0; i < mine.length; i++) {
      at = attacks(st, mine[i]);
      if (at.indexOf(KEEPS[1 - s]) >= 0) return { t: "atk", u: mine[i].id, c: KEEPS[1 - s] };
    }
    for (var h = 0; h < st.hand[s].length; h++) {
      var c = card(st.hand[s][h]), tg = targets(st, h);
      if (!tg.length || c.t === "t") continue;
      if (c.t === "u") return { t: "play", h: h, c: tg[0] };
      if (st.hand[s][h] === "spark" || st.hand[s][h] === "storm" || st.hand[s][h] === "rally" || st.hand[s][h] === "fortify") return { t: "play", h: h, c: tg[0] };
    }
    for (i = 0; i < mine.length; i++) {
      var mv = moves(st, mine[i]);
      if (!mv.length) continue;
      best = mine[i].i;
      mv.forEach(function (x) { if (dist(x, KEEPS[1 - s]) < dist(best, KEEPS[1 - s])) best = x; });
      if (best !== mine[i].i) return { t: "move", u: mine[i].id, c: best };
    }
    for (i = 0; i < mine.length; i++) {
      at = attacks(st, mine[i]);
      if (at.length) return { t: "atk", u: mine[i].id, c: at[0] };
    }
    return { t: "end" };
  }
  // Medium: the action that most improves the position, until none does.
  function mediumAction(st) {
    var s = st.side, base = evaluate(st, s), best = null, bv = base + 0.01;
    legal(st).forEach(function (a) {
      if (a.t === "end") return;
      var c = tryAct(st, a);
      if (!c) return;
      var v = evaluate(c, s);
      if (v > bv) { bv = v; best = a; }
    });
    return best || { t: "end" };
  }
  // Play the rest of the turn with a policy, then end it.
  function finishTurn(st, policy, cap) {
    var s = st.side;
    for (var k = 0; k < (cap || 30) && st.over < 0 && st.side === s; k++) {
      var a = policy(st);
      if (!act(st, a) || a.t === "end") break;
    }
    if (st.over < 0 && st.side === s) act(st, { t: "end" });
    return st;
  }
  // Hard: the best few Medium choices, each played out to the end of
  // the turn and through the other side's Medium answer.
  var HARD_K = 4;
  function hardAction(st) {
    var s = st.side, cands = [];
    legal(st).forEach(function (a) {
      if (a.t === "end") return;
      var c = tryAct(st, a);
      if (c) cands.push({ a: a, v: evaluate(c, s), st: c });
    });
    cands.sort(function (x, y) { return y.v - x.v; });
    function ahead(c) {
      var x = clone(c);
      if (x.over < 0 && x.side === s) finishTurn(x, mediumAction);
      if (x.over < 0 && x.side !== s) finishTurn(x, mediumAction);
      return evaluate(x, s);
    }
    // "end now" is a choice too; with no candidate better than it, end
    var ended = clone(st);
    act(ended, { t: "end" });
    if (ended.over < 0) finishTurn(ended, mediumAction);
    var best = { t: "end" }, bv = evaluate(ended, s);
    cands.slice(0, HARD_K).forEach(function (c) {
      var v = c.st.over === s ? 1e6 : ahead(c.st);
      if (v > bv + 0.01) { bv = v; best = c.a; }
    });
    return best;
  }
  function aiAction(st, level) {
    if (st.over >= 0) return null;
    if (level === "e") return easyAction(st);
    if (level === "h") return hardAction(st);
    return mediumAction(st);
  }

  // ---------- Saved state check ----------
  function isInt(v) { return typeof v === "number" && isFinite(v) && Math.floor(v) === v; }
  function pair(a, f) { return Array.isArray(a) && a.length === 2 && f(a[0]) && f(a[1]); }
  function nat(v) { return isInt(v) && v >= 0; }
  function cardList(h) { return Array.isArray(h) && h.length <= 40 && h.every(function (k) { return !!card(k); }); }
  function valid(st) {
    if (!st || typeof st !== "object" || st.v !== 1 || typeof st.seed !== "string") return false;
    if (!pair(st.decks, function (d) { return DECK_IDS.indexOf(d) >= 0; })) return false;
    if (typeof st.map !== "string" || st.map.length !== N || !/^[.wr~btmsd]*$/.test(st.map)) return false;
    for (var q = 0; q < N; q++) if ((isKeep(q) || isShrine(q)) && st.map.charAt(q) !== ".") return false;
    if (!pair(st.keep, function (v) { return isInt(v) && v >= 0 && v <= KEEP_HP; })) return false;
    if (!pair(st.hand, function (h) { return Array.isArray(h) && h.length <= HAND_MAX && h.every(function (k) { return !!card(k); }); })) return false;
    if (!pair(st.deck, cardList) || !pair(st.disc, cardList) || !pair(st.rng, function (v) { return isInt(v) && v >= 0 && v <= 0xffffffff; })) return false;
    if (st.side !== 0 && st.side !== 1) return false;
    if (!isInt(st.turn) || st.turn < 1 || !nat(st.n) || !isInt(st.nid) || st.nid < 1) return false;
    if (!pair(st.rt, nat) || !pair(st.en, function (v) { return isInt(v) && v >= 0 && v <= EN_MAX + SHRINES.length; })) return false;
    if (!pair(st.hold, nat) || !pair(st.rally, function (v) { return v === 0 || v === 1; }) || !pair(st.tired, nat)) return false;
    if ([-1, 0, 1].indexOf(st.over) < 0 || ["", "keep", "shrines"].indexOf(st.why) < 0 || (st.over < 0) !== (st.why === "")) return false;
    if (!Array.isArray(st.units) || st.units.length > N) return false;
    var cells = {}, ids = {};
    for (var k = 0; k < st.units.length; k++) {
      var u = st.units[k], c = u && card(u.k);
      if (!u || !c || c.t !== "u" || !isInt(u.id) || u.id < 1 || u.id >= st.nid || ids[u.id]) return false;
      if ((u.s !== 0 && u.s !== 1) || !isInt(u.i) || u.i < 0 || u.i >= N || isKeep(u.i) || cells[u.i]) return false;
      if (!isInt(u.hp) || u.hp < 1 || u.hp > c.hp) return false;
      if ([u.mv, u.at, u.f, u.st].some(function (b) { return b !== 0 && b !== 1; })) return false;
      if (!passable(st.map.charAt(u.i), c.kw === "climb")) return false;
      ids[u.id] = 1;
      cells[u.i] = 1;
    }
    return true;
  }

  var api = {
    W: W, H: H, N: N, KEEP_HP: KEEP_HP, HAND_MAX: HAND_MAX, EN_MAX: EN_MAX, HOLD_WIN: HOLD_WIN,
    KEEPS: KEEPS, SHRINES: SHRINES, LEVELS: LEVELS, CARDS: CARDS, DECKS: DECKS, DECK_IDS: DECK_IDS, TILE_OF: TILE_OF,
    hashStr: hashStr, xy: xy, idx: idx, step: step, dist: dist, card: card, isKeep: isKeep, isShrine: isShrine,
    passable: passable, pathOk: pathOk, makeBoard: makeBoard, deckList: deckList, newBattle: newBattle,
    MARCH_MIN: MARCH_MIN, MARCH_MAX: MARCH_MAX, listOk: listOk,
    unitAt: unitAt, unitById: unitById, shrinesHeld: shrinesHeld, guarded: guarded, atkOf: atkOf, dmgTo: dmgTo,
    moves: moves, attacks: attacks, targets: targets, legal: legal, act: act, valid: valid, clone: clone,
    evaluate: evaluate, aiAction: aiAction, finishTurn: finishTurn
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.BannerEngine = api;
})(typeof window !== "undefined" ? window : this);
