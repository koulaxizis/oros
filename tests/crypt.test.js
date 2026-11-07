// Crypt: the rules engine (crypt/engine.js, a module), the item and
// monster tables (crypt/items.js) and the records merge (cut out of the
// app IIFE by name, like tests/realm.test.js).
// Run: node --test tests/

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const E = require("../crypt/engine.js");
const D = require("../crypt/items.js");

const SRC = fs.readFileSync(path.join(__dirname, "..", "crypt/crypt.js"), "utf8");
const R = (() => {
  const parts = ["var DATA_VER = 1; var MODES = ['g','r']; var E = { FLOORS: 10 }; var MAX_DAY = 100000; var MAX_TURNS = 99999; var LAST_N = 10;"];
  ["cmpStr", "isInt", "normDay", "dayKeyOk", "dayBetter", "normLast", "normRow", "joinRows", "mergeCrypt"].forEach((name) => {
    const i = SRC.indexOf("  function " + name + "(");
    if (i < 0) throw new Error("missing function " + name);
    const one = SRC.indexOf("\n", i);
    const line = SRC.slice(i, one);
    parts.push(/\}\s*$/.test(line) ? line : SRC.slice(i, SRC.indexOf("\n  }\n", i) + 4));
  });
  return new Function(parts.join("\n") + "\nreturn { mergeCrypt };")();
})();

const J = JSON.stringify;
const W = E.W, H = E.H;
const at = (x, y) => y * W + x;

// A run on one open room (walls only on the edge), nothing on the floor.
function room(mode = "g") {
  const st = E.newRun("room", mode);
  let map = "";
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) map += x === 0 || y === 0 || x === W - 1 || y === H - 1 ? "#" : ".";
  st.map = map.slice(0, at(W - 2, H - 2)) + ">" + map.slice(at(W - 2, H - 2) + 1);
  st.seen = "1".repeat(W * H);
  st.traps = []; st.chests = []; st.chestItems = []; st.gold = []; st.loot = []; st.mons = [];
  st.hero.i = at(5, 5);
  return st;
}
function mon(st, k, i, extra) {
  const s = E.monStats(k, st.floor);
  const m = Object.assign({ id: st.nid++, k, i, hp: s.hp, aw: 1, t: 0, m: 0, n: null }, extra || {});
  st.mons.push(m);
  return m;
}
const evs = (list, e) => (list || []).filter((x) => x.e === e);

// The bot from the balance runs: heals first, fights what is next to
// it, bolts, and walks to the stairs (or to the Warden for the key).
function botStep(st) {
  const h = st.hero, s = E.stats(st);
  if (h.hp < s.mhp * 0.4) {
    const u = E.usable(st).find((n) => { const it = E.item(st.pack.it[n].k); return it.use === "heal" || it.use === "elixir" || (it.use === "mend" && h.fo >= it.cost); });
    if (u !== undefined) return { t: "use", n: u };
  }
  for (let d = 0; d < 4; d++) {
    const n = E.step(h.i, d);
    const m = n >= 0 && E.monAt(st, n);
    if (m && !m.m) return { t: "move", d };
  }
  const b = E.usable(st).find((n) => { const it = E.item(st.pack.it[n].k); return it.use === "bolt" && h.fo >= it.cost && st.mons.some((m) => m.aw && E.dist(m.i, h.i) <= 4); });
  if (b !== undefined) return { t: "use", n: b };
  const w = st.floor === E.FLOORS && !h.key ? (st.mons.find((m) => m.k === "warden") || {}).i : undefined;
  const dd = E.bfs(st, w === undefined ? st.map.indexOf(">") : w);
  let best = -1, bd = dd[h.i] < 0 ? 999 : dd[h.i];
  for (let d = 0; d < 4; d++) {
    const n = E.step(h.i, d);
    if (n >= 0 && dd[n] >= 0 && dd[n] < bd) { bd = dd[n]; best = d; }
  }
  return best >= 0 ? { t: "move", d: best } : { t: "wait" };
}
function botRun(seed, mode, cap) {
  const st = E.newRun(seed, mode);
  for (let n = 0; st.over < 0 && n < cap; n++) {
    if (!E.act(st, botStep(st))) E.act(st, { t: "wait" });
    assert.ok(E.valid(st), "valid state, " + seed + " turn " + st.turn);
  }
  return st;
}

test("crypt: tables are whole (shapes, items, monsters)", () => {
  assert.deepEqual(Object.keys(D.SHAPES).sort(), ["i2", "i3", "i4", "l3", "l4", "o1", "o4", "p5", "s4", "t4", "u5", "x5"]);
  Object.keys(D.SHAPES).forEach((k) => {
    const c = D.SHAPES[k];
    assert.ok(c.length >= 1 && c.length <= 5, k);
    assert.equal(new Set(c.map((p) => p.join())).size, c.length, k + " has no repeated cell");
  });
  const ids = new Set();
  D.ITEMS.forEach((it) => {
    assert.ok(!ids.has(it.id), "one " + it.id); ids.add(it.id);
    assert.ok("bwrcps".includes(it.t), it.id);
    assert.ok(D.SHAPES[it.sh], it.id + " shape");
    it.ports.forEach((p) => assert.ok(p[0] < D.SHAPES[it.sh].length && p[1] >= 0 && p[1] < 4, it.id + " port"));
    if (it.t === "r") assert.ok(it.use && it.cost > 0, it.id + " rune");
    if (it.t === "p" || it.t === "s") assert.ok(it.use, it.id + " used up");
  });
  assert.equal(D.ITEMS.length, 40);
  assert.equal(D.MON_KINDS.length, 14);
  D.MON_KINDS.forEach((k) => assert.ok(D.MONS[k].hp > 0 && D.MONS[k].atk > 0, k));
  // monster strength grows every three floors
  assert.ok(E.monStats("rat", 4).hp > E.monStats("rat", 1).hp);
  assert.deepEqual(E.monStats("rat", 1), E.monStats("rat", 3));
});

test("crypt: floors are the same from the same code, and the stairs are always reachable", () => {
  for (let k = 0; k < 30; k++) {
    for (let f = 1; f <= E.FLOORS; f++) {
      const a = E.makeFloor("s" + k, f), b = E.makeFloor("s" + k, f);
      assert.equal(J(a), J(b), "same code, same floor");
      assert.equal(a.map.length, W * H);
      assert.equal(a.map.split(">").length - 1, 1, "one stairs");
      const st = { map: a.map, mons: [], chests: [] };
      const d = E.bfs(st, a.start);
      assert.ok(d[a.map.indexOf(">")] > 0, "stairs reachable " + k + "/" + f);
      // everything on the floor stands on an open cell
      [].concat(a.mons, a.chests, a.loot, a.gold, a.traps).forEach((o) => assert.ok(d[o.i] >= 0, "reachable thing " + k + "/" + f));
      if (f === E.FLOORS) assert.equal(a.mons.filter((m) => m.k === "warden").length, 1, "one Warden on floor 10");
      else assert.ok(!a.mons.some((m) => m.k === "warden"));
    }
  }
  assert.notEqual(J(E.makeFloor("a", 1)), J(E.makeFloor("b", 1)), "another code, another floor");
});

test("crypt: shapes turn, fit and link through facing ports", () => {
  // a dagger (two cells across) turned once stands upright
  assert.deepEqual(E.shapeOf("dagger", 0).cells, [[0, 0], [1, 0]]);
  assert.deepEqual(E.shapeOf("dagger", 1).cells, [[0, 0], [0, 1]]);
  assert.deepEqual(E.shapeOf("dagger", 1).ports, [[0, 0], [1, 2]]);
  for (let r = 0; r < 4; r++) assert.equal(E.shapeOf("sword", r).cells.length, 3);
  assert.deepEqual(E.shapeOf("sword", 4).cells, E.shapeOf("sword", 0).cells, "four turns go round");
  const pack = { w: 6, h: 4, it: [{ k: "dagger", x: 0, y: 0, r: 0, c: 0 }] };
  assert.ok(!E.fits(pack, "dagger", 1, 0, 0, -1), "overlap");
  assert.ok(!E.fits(pack, "dagger", 5, 0, 0, -1), "outside");
  assert.ok(E.fits(pack, "dagger", 2, 0, 0, -1));
  assert.ok(E.fits(pack, "dagger", 1, 0, 0, 0), "moving the item itself");
  pack.it.push({ k: "dagger", x: 2, y: 0, r: 0, c: 0 });
  assert.deepEqual(E.packLinks(pack).map((l) => l.kind), ["atk"], "blade and blade");
  // ports that do not face each other do not link
  pack.it[1] = { k: "dagger", x: 0, y: 1, r: 0, c: 0 };
  assert.equal(E.packLinks(pack).length, 0);
  // the link kinds
  pack.it = [{ k: "buckler", x: 0, y: 0, r: 0, c: 0 }, { k: "buckler", x: 1, y: 0, r: 0, c: 0 }];
  assert.deepEqual(E.packLinks(pack).map((l) => l.kind), ["def"]);
  pack.it = [{ k: "dagger", x: 0, y: 0, r: 0, c: 0 }, { k: "buckler", x: 2, y: 0, r: 0, c: 0 }];
  assert.deepEqual(E.packLinks(pack).map((l) => l.kind), ["hp"]);
  // the link changes the hero
  const st = room();
  st.pack.it = [{ k: "dagger", x: 0, y: 0, r: 0, c: 0 }];
  const one = E.stats(st).atk;
  st.pack.it.push({ k: "dagger", x: 2, y: 0, r: 0, c: 0 });
  assert.equal(E.stats(st).atk, one + 2, "+1 for the dagger, +1 for the link");
  // a full pack: findSpot says no
  const full = { w: 6, h: 4, it: [] };
  for (let y = 0; y < 4; y++) for (let x = 0; x < 6; x++) full.it.push({ k: "buckler", x, y, r: 0, c: 0 });
  assert.equal(E.findSpot(full, "buckler"), null);
  assert.deepEqual(E.packSize(1), { w: 6, h: 4 });
  assert.deepEqual(E.packSize(4), { w: 7, h: 5 });
  assert.deepEqual(E.packSize(7), { w: 8, h: 5 });
});

test("crypt: a cursed item stays in the pack until a Cleansing scroll, and is not picked up by itself", () => {
  const st = room();
  st.loot.push({ i: st.hero.i, it: { k: "glass", r: 0, c: 1 } });
  assert.equal(E.autoPick(st, 0), false, "not by itself");
  const sp = E.findSpot(st.pack, "glass");
  assert.ok(E.packAdd(st, 0, sp.x, sp.y, sp.r), "by hand");
  const n = st.pack.it.findIndex((p) => p.k === "glass");
  assert.equal(st.pack.it[n].c, 1);
  assert.equal(E.packDrop(st, n), false, "cursed: cannot leave");
  // no curse, no scroll used
  const s2 = room();
  s2.pack.it.push({ k: "cleanse", x: 5, y: 3, r: 0, c: 0 });
  assert.equal(E.act(s2, { t: "use", n: s2.pack.it.length - 1 }), null);
  st.pack.it.push({ k: "cleanse", x: 5, y: 3, r: 0, c: 0 });
  const ev = E.act(st, { t: "use", n: st.pack.it.length - 1 });
  assert.equal(evs(ev, "cleanse").length, 1);
  assert.ok(!st.pack.it.some((p) => p.k === "cleanse"), "used up");
  const g = st.pack.it.findIndex((p) => p.k === "glass");
  assert.ok(E.packDrop(st, g), "cleansed: can leave");
});

test("crypt: damage is Attack minus Defence, at least 1, and a hit lands only on the marked cell", () => {
  const st = room();
  const atk = E.stats(st).atk;
  const m = mon(st, "knight", at(6, 5), { hp: 50 });
  const ev = E.act(st, { t: "move", d: 1 });
  assert.equal(evs(ev, "hit")[0].n, Math.max(1, atk - E.monStats("knight", 1).def));
  assert.equal(m.hp, 50 - evs(ev, "hit")[0].n);
  // the knight now marks the hero's cell; stepping out of it makes it miss
  assert.equal(m.n.a, "a");
  assert.deepEqual(m.n.c, [st.hero.i]);
  const hp = st.hero.hp;
  const ev2 = E.act(st, { t: "move", d: 3 });
  assert.equal(evs(ev2, "hurt").length, 0);
  assert.equal(evs(ev2, "miss").length, 1);
  assert.equal(st.hero.hp, hp);
  // standing still takes the hit: knight Attack minus hero Defence
  st.mons[0].i = at(5, 5); st.mons[0].n = null;
  E.act(st, { t: "wait" });          // plans an attack on the hero's cell
  const h2 = st.hero.hp;
  const ev3 = E.act(st, { t: "wait" });
  assert.equal(evs(ev3, "hurt")[0].n, Math.max(1, E.monStats("knight", 1).atk - E.stats(st).def));
  assert.equal(st.hero.hp, h2 - evs(ev3, "hurt")[0].n, "no regen this turn");
});

test("crypt: monster habits", () => {
  // bat: two steps a turn
  let st = room();
  const bat = mon(st, "bat", at(10, 5));
  E.act(st, { t: "wait" });
  assert.equal(bat.n.c.length, 2);
  E.act(st, { t: "wait" });
  assert.equal(E.dist(bat.i, st.hero.i), 3);
  // slime: every other turn
  st = room();
  const sl = mon(st, "slime", at(10, 5));
  const moves = [];
  for (let k = 0; k < 5; k++) { E.act(st, { t: "wait" }); moves.push(sl.i); }
  assert.equal(new Set(moves).size, 3, "after the first plan it moves on every other turn");
  // stone guard: still while the hero is in its row
  st = room();
  const g = mon(st, "guard", at(10, 5));
  E.act(st, { t: "wait" }); E.act(st, { t: "wait" });
  assert.equal(g.i, at(10, 5));
  st.hero.i = at(5, 7);
  E.act(st, { t: "wait" }); E.act(st, { t: "wait" });
  assert.notEqual(g.i, at(10, 5), "moves once out of line");
  // archer: shoots along a line
  st = room();
  const ar = mon(st, "archer", at(9, 5));
  E.act(st, { t: "wait" });
  assert.equal(ar.n.a, "s");
  assert.ok(ar.n.c.includes(st.hero.i));
  // swarm: splits off a rat when hit, at most twice
  st = room();
  const sw = mon(st, "swarm", at(6, 5), { hp: 99 });
  for (let k = 0; k < 4; k++) E.act(st, { t: "move", d: 1 });
  assert.equal(st.mons.filter((m) => m.k === "rat").length + st.hero.kills >= 2, true);
  assert.equal(Math.floor(sw.t / 1000), 2, "two splits, then no more");
  // wisp: a hit drains Focus
  st = room();
  st.hero.fo = 3;
  mon(st, "wisp", at(6, 5));
  E.act(st, { t: "wait" }); E.act(st, { t: "wait" });
  assert.equal(st.hero.fo, 2);
  // mimic: a chest until the hero is next to it
  st = room();
  const mm = mon(st, "mimic", at(8, 5), { aw: 0, m: 1 });
  E.act(st, { t: "wait" });
  assert.equal(mm.m, 1);
  E.act(st, { t: "move", d: 1 });
  E.act(st, { t: "move", d: 1 });
  assert.equal(mm.m, 0, "revealed");
  // warden: calls a skeleton every 6 turns, drops the key
  st = room();
  st.floor = E.FLOORS;
  const wd = mon(st, "warden", at(15, 10), { aw: 1 });
  st.hero.i = at(2, 2);
  let calls = 0;
  for (let k = 0; k < 12; k++) calls += evs(E.act(st, { t: "wait" }), "call").length;
  assert.equal(calls, 2);
  st.mons = [wd]; wd.hp = 1; wd.i = at(3, 2); st.hero.i = at(2, 2);
  E.act(st, { t: "move", d: 1 });
  assert.equal(st.hero.key, 1);
});

test("crypt: the stairs on floor 10 need the key; floors change the pack size", () => {
  const st = room();
  st.floor = E.FLOORS;
  st.hero.i = at(W - 3, H - 2);
  const ev = E.act(st, { t: "move", d: 1 });
  assert.equal(evs(ev, "locked").length, 1);
  assert.equal(st.over, -1);
  st.hero.i = at(W - 3, H - 2); st.hero.key = 1;
  const ev2 = E.act(st, { t: "move", d: 1 });
  assert.equal(evs(ev2, "win").length, 1);
  assert.equal(st.over, 1);
  assert.equal(E.act(st, { t: "wait" }), null, "nothing after the end");
  // the stairs on floor 3 lead to floor 4 and a bigger pack
  const s2 = room();
  s2.floor = 3;
  s2.hero.i = at(W - 3, H - 2);
  const ev3 = E.act(s2, { t: "move", d: 1 });
  assert.equal(evs(ev3, "floor")[0].n, 4);
  assert.deepEqual([s2.pack.w, s2.pack.h], [7, 5]);
  assert.ok(E.valid(s2));
});

test("crypt: valid() refuses broken saves", () => {
  const st = E.newRun("v", "r");
  assert.ok(E.valid(st));
  const bad = [
    (s) => { s.v = 2; }, (s) => { s.mode = "x"; }, (s) => { s.floor = 11; }, (s) => { s.map = s.map.slice(1); },
    (s) => { s.seen = s.seen.replace("0", "2"); }, (s) => { s.over = 3; }, (s) => { s.hero.i = -1; },
    (s) => { s.hero.key = 2; }, (s) => { s.mons.push({ k: "dragon", i: 1, hp: 1, id: 1, t: 0, aw: 0, m: 0, n: null }); },
    (s) => { s.pack.it.push({ k: "nope", x: 0, y: 0, r: 0, c: 0 }); },
    (s) => { s.pack.it.push(Object.assign({}, s.pack.it[0])); },          // on top of another
    (s) => { s.pack.it[0].x = 9; }, (s) => { s.chestItems.push({ k: "sword", r: 0, c: 0 }); },
    (s) => { s.loot.push({ i: 1, it: { k: "sword", r: 5, c: 0 } }); }
  ];
  bad.forEach((f, n) => { const c = E.clone(st); f(c); assert.equal(E.valid(c), false, "case " + n); });
  assert.equal(E.valid(null), false);
});

test("crypt: a run is the same from the same code, moves and all", () => {
  const a = botRun("same", "g", 600), b = botRun("same", "g", 600);
  assert.equal(J(a), J(b));
});

test("crypt: 300 bot runs keep a valid state, and Gentle gets most heroes to floor 3", () => {
  let deep = 0;
  for (let k = 0; k < 150; k++) {
    const g = botRun("bot" + k, "g", 3000);
    if (g.floor >= 3) deep++;
    botRun("grim" + k, "r", 3000);
  }
  assert.ok(deep / 150 > 0.7, "Gentle floor 3+: " + deep + "/150");
});

test("crypt: the records merge is a join (symmetric, idempotent, reset wins)", () => {
  const A = { ver: 1, br: 0, rows: { a: { b: 0, s: { g: [3, 1, 6] } }, b: { b: 0, s: { r: [2, 0, 4] } } } };
  const B = { ver: 1, br: 0, rows: { a: { b: 0, s: { g: [5, 1, 4], r: [1, 0, 2] } } } };
  const C = { ver: 1, br: 0, rows: { c: { b: 0, s: { g: [1, 1, 10] } }, x: { b: 0, s: { g: [1, 2] } } } };
  const m = R.mergeCrypt;
  assert.equal(J(m(A, B)), J(m(B, A)));
  assert.equal(J(m(m(A, B), C)), J(m(A, m(B, C))));
  assert.equal(J(m(A, A)), J(m(A, null)));
  assert.deepEqual(m(A, B).rows.a.s, { g: [5, 1, 6], r: [1, 0, 2] });
  assert.ok(!m(C, null).rows.x, "a broken row is dropped");
  // a reset on another device clears older rows
  const reset = { ver: 1, br: 1, rows: { a: { b: 1, s: { g: [1, 0, 1] } } } };
  const out = m(A, reset);
  assert.equal(out.br, 1);
  assert.deepEqual(Object.keys(out.rows), ["a"]);
  assert.deepEqual(out.rows.a.s, { g: [1, 0, 1] });
  // a floor past 10 is not a record
  assert.ok(!m({ ver: 1, br: 0, rows: { z: { b: 0, s: { g: [1, 0, 11] } } } }, null).rows.z);
});

test("crypt: the Daily crypt is a short descent: out on the stairs of floor 5, no key", () => {
  const st = E.newRun("crypt20261107", "g", 5);
  assert.equal(st.end, 5);
  assert.ok(E.valid(st));
  assert.equal(E.newRun("x", "g").end, undefined, "a normal run has no end field");
  assert.equal(E.newRun("x", "g", 10).end, undefined);
  // floor 4 → 5 still goes down
  const r = room();
  r.end = 5; r.floor = 4;
  r.hero.i = at(W - 3, H - 2);
  assert.equal(evs(E.act(r, { t: "move", d: 1 }), "floor")[0].n, 5);
  // floor 5: the stairs are the way out
  const q = room();
  q.end = 5; q.floor = 5;
  q.hero.i = at(W - 3, H - 2);
  assert.equal(evs(E.act(q, { t: "move", d: 1 }), "win").length, 1);
  assert.equal(q.over, 1);
  // valid() checks end
  const bad = E.clone(st); bad.end = 10; assert.equal(E.valid(bad), false);
  const bad2 = E.clone(st); bad2.floor = 6; assert.equal(E.valid(bad2), false);
  // the same day gives the same crypt
  assert.equal(J(E.newRun("crypt20261107", "g", 5)), J(st));
});

test("crypt: Daily results merge as a join: newer epoch, then out, deeper, fewer turns", () => {
  const m = R.mergeCrypt;
  const A = { ver: 1, br: 0, rows: {}, days: { 310: { b: 0, w: 0, f: 3, t: 200 }, 311: { b: 0, w: 1, f: 5, t: 400 } } };
  const B = { ver: 1, br: 0, rows: {}, days: { 310: { b: 0, w: 0, f: 4, t: 900 }, 311: { b: 0, w: 1, f: 5, t: 350 } } };
  const C = { ver: 1, br: 0, rows: {}, days: { 310: { b: 0, w: 1, f: 5, t: 999 }, 12: { b: 0, w: 2, f: 1, t: 1 } } };
  assert.equal(J(m(A, B)), J(m(B, A)));
  assert.equal(J(m(m(A, B), C)), J(m(A, m(B, C))));
  assert.equal(J(m(A, A)), J(m(A, null)));
  assert.deepEqual(m(A, B).days[310], { b: 0, w: 0, f: 4, t: 900 }, "deeper wins");
  assert.deepEqual(m(A, B).days[311].t, 350, "fewer turns win");
  assert.deepEqual(m(B, C).days[310].w, 1, "out wins");
  assert.ok(!m(C, null).days[12], "a bad entry drops");
  // older data without days, and a reset drops older days
  assert.deepEqual(m({ ver: 1, br: 0, rows: {} }, null).days, {});
  assert.deepEqual(m(A, { ver: 1, br: 5, rows: {} }).days, {});
});

// Walks a run down to floor n through the stairs (monsters and traps
// cleared on the way), for the shrine tests.
function downTo(st, n) {
  while (st.floor < n) {
    st.mons = []; st.traps = [];
    const d = E.bfs(st, st.map.indexOf(">"));
    let best = -1, bd = d[st.hero.i];
    for (let k = 0; k < 4; k++) { const x = E.step(st.hero.i, k); if (x >= 0 && d[x] >= 0 && d[x] < bd) { bd = d[x]; best = k; } }
    if (best < 0) { st.chests = []; st.chestItems = []; E.act(st, { t: "wait" }); continue; }
    E.act(st, { t: "move", d: best });
  }
  return st;
}

test("crypt: shrines stand on floors 3, 6 and 9, the same from the same code, and leave the floors as they were", () => {
  for (let k = 0; k < 20; k++) {
    const a = downTo(E.newRun("sh" + k, "g"), 3), b = downTo(E.newRun("sh" + k, "g"), 3);
    assert.ok(a.shrine, "a shrine on floor 3");
    assert.equal(J(a.shrine), J(b.shrine));
    assert.equal(a.map, E.makeFloor("sh" + k, 3).map, "the floor itself is unchanged");
    assert.equal(a.shrine.it.length, 3);
    assert.ok(a.shrine.it.every((x) => x.c === 0), "never cursed");
    assert.ok(E.valid(a));
    const d = E.bfs(a, a.hero.i)[a.shrine.i];
    assert.ok(d >= 2 && d <= 6, "near the start");
    downTo(a, 4);
    assert.equal(a.shrine, undefined, "no shrine on floor 4");
  }
  assert.deepEqual(E.SHRINE_FLOORS, [3, 6, 9]);
});

test("crypt: the shrine heals, lifts curses and sells, for gold, on its cell and unwatched only", () => {
  const st = room();
  st.floor = 3;
  st.shrine = { i: at(5, 5), it: [{ k: "sword", r: 0, c: 0 }, { k: "lantern", r: 0, c: 0 }, null] };
  st.hero.gold = 100;
  st.hero.hp = 3;
  // heal to full
  const ev = E.shrineBuy(st, "heal");
  assert.ok(ev && evs(ev, "heal").length === 1);
  assert.equal(st.hero.hp, E.stats(st).mhp);
  assert.equal(st.hero.gold, 100 - E.shrinePrice(st, "heal"));
  assert.equal(E.shrineBuy(st, "heal"), null, "nothing to heal");
  assert.equal(E.shrineBuy(st, "cleanse"), null, "nothing cursed");
  // buy an item: into the pack, sold out
  const g = st.hero.gold, price = E.shrinePrice(st, 0);
  assert.equal(price, 8 + 2 * 3, "tier 1 on floor 3");
  const ev2 = E.shrineBuy(st, 0);
  assert.ok(evs(ev2, "bought").length && evs(ev2, "pick").length);
  assert.ok(st.pack.it.some((x) => x.k === "sword"));
  assert.equal(st.hero.gold, g - price);
  assert.equal(st.shrine.it[0], null);
  assert.equal(E.shrineBuy(st, 0), null, "sold");
  assert.equal(E.shrineBuy(st, 2), null, "an empty place");
  // a curse lifted
  st.pack.it.push({ k: "glass", x: 5, y: 3, r: 0, c: 1 });
  assert.ok(E.shrineBuy(st, "cleanse"));
  assert.ok(st.pack.it.every((x) => x.c === 0));
  // not enough gold
  st.hero.gold = 1;
  assert.equal(E.shrineBuy(st, 1), null);
  // off the shrine, or watched by an awake monster: nothing
  st.hero.gold = 100;
  st.hero.i = at(6, 5);
  assert.equal(E.shrineBuy(st, 1), null);
  st.hero.i = at(5, 5);
  mon(st, "rat", at(8, 5));
  assert.ok(E.watched(st));
  assert.equal(E.shrineBuy(st, 1), null);
  assert.ok(E.valid(st));
  // stepping on it says so
  const s2 = room();
  s2.shrine = { i: at(6, 5), it: [null, null, null] };
  assert.equal(evs(E.act(s2, { t: "move", d: 1 }), "shrine").length, 1);
  // valid() checks the shrine
  const bad = E.clone(s2); bad.shrine.it.push(null); assert.equal(E.valid(bad), false);
  const bad2 = E.clone(s2); bad2.shrine.it[0] = { k: "glass", r: 0, c: 1 }; assert.equal(E.valid(bad2), false);
  const bad3 = E.clone(s2); bad3.shrine.i = 0; assert.equal(E.valid(bad3), false);
});

test("crypt: a cursed item does not link until it is cleansed", () => {
  const pack = { w: 6, h: 4, it: [{ k: "dagger", x: 0, y: 0, r: 0, c: 1 }, { k: "dagger", x: 2, y: 0, r: 0, c: 0 }] };
  assert.equal(E.packLinks(pack).length, 0);
  pack.it[0].c = 0;
  assert.equal(E.packLinks(pack).length, 1);
});

test("crypt: Last runs merge as a join: union, newest first, at most 10, a reset clears", () => {
  const m = R.mergeCrypt;
  const run = (a, s, extra) => Object.assign({ a, m: "g", f: 3, w: 0, c: "rat", s }, extra || {});
  const A = { ver: 1, br: 0, rows: {}, last: [run(5, "aa"), run(3, "bb"), run(1, "cc")] };
  const B = { ver: 1, br: 0, rows: {}, last: [run(4, "dd", { m: "d", w: 1, c: "", f: 5 }), run(3, "bb")] };
  const C = { ver: 1, br: 0, rows: {}, last: [run(2, "ee", { m: "x" }), run(6, "ff", { c: "left" })] };
  assert.equal(J(m(A, B)), J(m(B, A)));
  assert.equal(J(m(m(A, B), C)), J(m(A, m(B, C))));
  assert.equal(J(m(A, A)), J(m(A, null)));
  assert.deepEqual(m(A, m(B, C)).last.map((x) => x.s), ["ff", "aa", "dd", "bb", "cc"], "union, newest first, bad entry dropped");
  const many = { ver: 1, br: 0, rows: {}, last: Array.from({ length: 14 }, (_, k) => run(k + 1, "s" + k)) };
  assert.equal(m(many, null).last.length, 10);
  assert.equal(m(many, null).last[0].a, 14);
  assert.deepEqual(m(A, { ver: 1, br: 4, rows: {} }).last.map((x) => x.s), ["aa"], "older than the reset drop");
  assert.deepEqual(m({ ver: 1, br: 0, rows: {} }, null).last, [], "older data has none");
});
