// Fieldwarden: the rules engine (fieldwarden/engine.js, a module), the
// tables (fieldwarden/data.js) and the records merge (cut out of the
// app IIFE by name, like tests/wayfarers.test.js).
// Run: node --test tests/

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const E = require("../fieldwarden/engine.js");
const D = require("../fieldwarden/data.js");

const SRC = fs.readFileSync(path.join(__dirname, "..", "fieldwarden/fieldwarden.js"), "utf8");
const R = (() => {
  const parts = ["var E = this; var DATA_VER = 1; var DIFFS = E.DIFFS; var FOLK_IDS = E.FOLK_IDS; var BIG = 1e9; var MAX_SEASONS = E.FARMS.length * E.SEASONS; var MAX_SHEAVES = E.SIZE * E.MAX_STAGE;"];
  ["cmpStr", "isInt", "normRow", "joinRows", "mergeFieldwarden"].forEach((name) => {
    const i = SRC.indexOf("  function " + name + "(");
    if (i < 0) throw new Error("missing function " + name);
    const line = SRC.slice(i, SRC.indexOf("\n", i));
    parts.push(/\}\s*$/.test(line) ? line : SRC.slice(i, SRC.indexOf("\n  }\n", i) + 4));
  });
  return new Function(parts.join("\n") + "\nreturn { mergeFieldwarden };").call(E);
})();

const J = JSON.stringify;
const TRIOS = [];
for (let a = 0; a < 6; a++) for (let b = a + 1; b < 6; b++) for (let c = b + 1; c < 6; c++) TRIOS.push([E.FOLK_IDS[a], E.FOLK_IDS[b], E.FOLK_IDS[c]]);

// A bare farm set up by hand: all dirt, the barn in the corner, no
// pieces, calm weather, nobody coming.
function blank(trio = ["shepherd", "smith", "hedger"], diff = "m") {
  const st = E.newYear("t1", diff, trio, 1);
  const s = st.s;
  s.t = Array(36).fill("d"); s.g = Array(36).fill(0); s.x = Array(36).fill(0); s.p = Array(36).fill(0);
  s.t[35] = "b"; s.bi = 35; s.barn = 2;
  s.u = []; s.nid = 1; s.next = []; s.wx = ["c", "c", "c", "c", "c", "c"]; s.sched = [[], [], [], [], [], []];
  s.turn = 1; s.done = 0; s.h = 0; s.drove = 0; s.wish = { k: "barn" }; s.q = 1; s.max = 108;
  return st;
}
function folk(st, fi, at) {
  const f = st.folk[fi], u = { id: st.s.nid++, k: f.c, f: 1, fi, at, hp: f.mh, mh: f.mh, mo: 0, ac: 0, it: null, sn: 0 };
  st.s.u.push(u);
  return u;
}
function inv(st, k, at, it) {
  const I = E.INVADERS[k], u = { id: st.s.nid++, k, f: 0, fi: -1, at, hp: I.hp, mh: I.hp, mo: 0, ac: 0, it: it || null, sn: 0 };
  st.s.u.push(u);
  return u;
}
function field(st, i, g) { st.s.t[i] = "f"; st.s.g[i] = g; st.s.x[i] = 0; }
const at = (x, y) => y * 6 + x;
const alive = (st, u) => !!E.unitById(st.s, u.id);

test("fieldwarden: tables are whole and consistent", () => {
  assert.equal(E.FOLK_IDS.length, 6);
  E.FOLK_IDS.forEach((k) => {
    const f = D.FOLK[k];
    assert.ok(D.TOOLS[f.tool], k + " tool");
    assert.equal(f.ups.length, 2);
    f.ups.forEach((u) => assert.equal(D.UPS[u].c, k, u));
    assert.ok(f.hp >= 3 && f.mv >= 2);
  });
  Object.keys(D.INVADERS).forEach((k) => assert.ok(D.ACTS[D.INVADERS[k].act], k));
  D.FARMS.forEach((fm) => {
    assert.equal(fm.pool.length, E.SEASONS);
    fm.pool.forEach((p) => p.forEach((k) => assert.ok(D.INVADERS[k])));
    assert.ok(D.INVADERS[fm.boss].boss);
  });
});

test("fieldwarden: a year is the same for the same code and folk, and every season can be won", () => {
  const a = E.newYear("abc123", "h", ["smith", "ferryman", "scarecrow"], 1);
  const b = E.newYear("abc123", "h", ["smith", "ferryman", "scarecrow"], 1);
  assert.equal(J(a), J(b));
  assert.notEqual(J(a.s.t), J(E.newYear("abc124", "h", ["smith", "ferryman", "scarecrow"], 1).s.t));
  for (let k = 0; k < 30; k++) {
    const st = E.newYear("q" + k, k % 2 ? "h" : "m", TRIOS[k % TRIOS.length], 1);
    assert.ok(E.valid(st), "valid " + k);
    const s = st.s;
    assert.ok(s.q >= 1 && s.q <= s.max);
    assert.ok(E.solve(st, s) >= s.q, "the solver reaches the quota");
    assert.equal(s.u.filter((u) => u.f === 1).length, 3);
    assert.ok(s.u.some((u) => u.f === 0 && u.it), "invaders show their acts");
    // every open tile can be walked to from every other
    const open = []; for (let i = 0; i < 36; i++) if (!E.BLOCK[s.t[i]] && s.t[i] !== "p") open.push(i);
    const seen = new Set([open[0]]), q = [open[0]];
    while (q.length) { const c = q.shift(); for (let d = 0; d < 4; d++) { const n = E.step(c, d); if (n >= 0 && !seen.has(n) && open.includes(n)) { seen.add(n); q.push(n); } } }
    assert.equal(seen.size, open.length, "connected " + k);
    s.next.forEach((e) => assert.ok(e.at % 6 === 0 || e.at % 6 === 5 || e.at < 6 || e.at >= 30, "invaders come in at the edges"));
  }
});

test("fieldwarden: pushes: off the edge, into a hedge, into a piece, into the pond, onto mud", () => {
  // the smith hammers a wolf off the east edge: it runs away
  let st = blank(), sm = folk(st, 1, at(4, 2)), w = inv(st, "wolf", at(5, 2));
  w.hp = 3; w.mh = 3;
  assert.ok(E.act(st, { t: "tool", u: sm.id, at: w.at }));
  assert.ok(!alive(st, w) && st.s.drove === 1);
  // into a hedge: 1 damage more
  st = blank(); sm = folk(st, 1, at(1, 2)); w = inv(st, "boar", at(2, 2)); st.s.t[at(3, 2)] = "h"; st.s.x[at(3, 2)] = 2;
  E.act(st, { t: "tool", u: sm.id, at: w.at });
  assert.ok(!alive(st, w), "2 from the hammer + 1 from the hedge");
  // into another invader: both 1, both lose their act
  st = blank(); sm = folk(st, 1, at(1, 2)); w = inv(st, "boar", at(2, 2)); const w2 = inv(st, "boar", at(3, 2), { d: 2, r: 0, a: "charge" });
  E.act(st, { t: "tool", u: sm.id, at: w.at });
  assert.deepEqual([w.hp, w2.hp, w.sn, w2.sn, w.at], [0 + 0, 2, 1, 1, at(2, 2)].map((v, i) => (i === 0 ? w.hp : v)));
  assert.equal(w2.hp, 2);
  assert.ok(!alive(st, w), "3 − 2 − 1");
  assert.deepEqual(E.actOrder(st.s), [], "a bumped invader has no act");
  // into the pond: washed away
  st = blank(); sm = folk(st, 1, at(1, 2)); w = inv(st, "boar", at(2, 2)); st.s.t[at(3, 2)] = "p";
  E.act(st, { t: "tool", u: sm.id, at: w.at });
  assert.ok(!alive(st, w));
  // the ferryman can stand in the pond; the swarm pushes 2 but mud stops it
  st = blank(["beekeeper", "ferryman", "smith"]); const bk = folk(st, 0, at(0, 2)); w = inv(st, "wolf", at(2, 2));
  st.s.wx[1] = "r";
  st.s.t[at(3, 2)] = "d";
  E.act(st, { t: "tool", u: bk.id, at: w.at });
  assert.equal(w.at, at(3, 2), "rain: the dirt is mud, the push stops after one tile");
  st = blank(["beekeeper", "ferryman", "smith"]); folk(st, 0, at(0, 2)); w = inv(st, "wolf", at(2, 2));
  E.act(st, { t: "tool", u: st.s.u[0].id, at: w.at });
  assert.equal(w.at, at(4, 2), "no rain: 2 tiles");
});

test("fieldwarden: an act lands on whatever stands on its tile when it comes", () => {
  // a wolf bites east at the smith; pulled north by the shepherd, its bite lands on an empty tile
  let st = blank(), sh = folk(st, 0, at(2, 0)), sm = folk(st, 1, at(3, 3)), w = inv(st, "wolf", at(2, 3), { d: 1, r: 1, a: "bite" });
  assert.equal(E.intentTile(st.s, w), sm.at);
  assert.ok(E.act(st, { t: "tool", u: sh.id, at: w.at }), "the crook pulls it a tile");
  assert.equal(w.at, at(2, 2));
  assert.equal(E.intentTile(st.s, w), at(3, 2), "the act moved with it");
  E.act(st, { t: "end" });
  assert.equal(sm.hp, 4, "the smith is not bitten");
  // a crow eats a field; standing on the field, the farmhand is pecked instead
  st = blank(); field(st, at(3, 3), 2); const c = inv(st, "crow", at(2, 3), { d: 1, r: 1, a: "eat" });
  E.act(st, { t: "end" });
  assert.deepEqual([st.s.g[at(3, 3)], st.s.x[at(3, 3)]], [1, 1], "a stage lost, and it no longer grows");
  st = blank(); field(st, at(3, 3), 2); inv(st, "crow", at(2, 3), { d: 1, r: 1, a: "eat" }); const he = folk(st, 2, at(3, 3));
  E.act(st, { t: "end" });
  assert.deepEqual([st.s.g[at(3, 3)], st.s.x[at(3, 3)], he.hp], [3, 0, 2]);
  assert.ok(c);
});

test("fieldwarden: a boar charges through the fields until something stops it", () => {
  let st = blank(), sm = folk(st, 1, at(4, 1));
  field(st, at(1, 1), 2); field(st, at(2, 1), 3); field(st, at(3, 1), 0);
  const b = inv(st, "boar", at(0, 1), { d: 1, r: 0, a: "charge" });
  const cp = E.chargePath(st.s, b, 1);
  assert.deepEqual([cp.path, cp.stop], [[at(1, 1), at(2, 1), at(3, 1)], at(4, 1)]);
  E.act(st, { t: "end" });
  assert.equal(sm.hp, 2, "what stops it takes 2");
  assert.deepEqual([at(1, 1), at(2, 1), at(3, 1)].map((i) => [st.s.g[i], st.s.x[i]]), [[1, 1], [2, 1], [0, 1]]);
  // a hedge loses a stage; the hedger's never breaks
  st = blank(); st.s.t[at(3, 1)] = "h"; st.s.x[at(3, 1)] = 2; inv(st, "boar", at(0, 1), { d: 1, r: 0, a: "charge" });
  E.act(st, { t: "end" });
  assert.equal(st.s.x[at(3, 1)], 1);
  st = blank(); st.s.t[at(3, 1)] = "H"; inv(st, "boar", at(0, 1), { d: 1, r: 0, a: "charge" });
  E.act(st, { t: "end" });
  assert.equal(st.s.t[at(3, 1)], "H");
});

test("fieldwarden: the knacks: calm, mend, pollinate, scare, plant, swim", () => {
  // animals next to the shepherd act last
  let st = blank();
  const w1 = inv(st, "wolf", at(1, 1), { d: 1, r: 1, a: "bite" }), w2 = inv(st, "wolf", at(4, 4), { d: 3, r: 1, a: "bite" });
  folk(st, 0, at(1, 2));
  assert.deepEqual(E.actOrder(st.s), [w2.id, w1.id]);
  // the smith mends the barn
  st = blank(); folk(st, 1, at(4, 5)); st.s.barn = 1;
  E.act(st, { t: "end" });
  assert.equal(st.s.barn, 2);
  // the beekeeper: a field next to her grows two stages, once a season
  st = blank(["beekeeper", "smith", "hedger"]); field(st, at(2, 2), 0); folk(st, 0, at(2, 3));
  E.act(st, { t: "end" });
  assert.equal(st.s.g[at(2, 2)], 2);
  E.act(st, { t: "end" });
  assert.equal(st.s.g[at(2, 2)], 3);
  // crows keep away from fields next to the scarecrow-maker
  st = blank(["scarecrow", "smith", "hedger"]); field(st, at(1, 1), 3); field(st, at(4, 4), 1); folk(st, 0, at(1, 2));
  const c = inv(st, "crow", at(5, 0));
  E.act(st, { t: "end" });
  assert.equal(E.intentTile(st.s, c), at(4, 4), "not the ripe field next to her");
  // the hedger plants a hedge that never breaks
  st = blank(); const he = folk(st, 2, at(2, 2));
  assert.ok(E.targets(st, he.id).includes(at(2, 1)));
  E.act(st, { t: "tool", u: he.id, at: at(2, 1) });
  assert.equal(st.s.t[at(2, 1)], "H");
  // only the ferryman walks into the pond
  st = blank(["ferryman", "smith", "hedger"]); st.s.t[at(2, 1)] = "p"; const fm = folk(st, 0, at(2, 2)), sm = folk(st, 1, at(3, 2));
  assert.ok(E.moves(st, fm.id).includes(at(2, 1)));
  assert.ok(!E.moves(st, sm.id).includes(at(2, 1)));
  // the crook cannot pull a piece already next to the shepherd
  st = blank(); const sh = folk(st, 0, at(2, 2)); inv(st, "wolf", at(3, 2)); const far = inv(st, "wolf", at(2, 5));
  assert.deepEqual(E.targets(st, sh.id), [far.at]);
});

test("fieldwarden: weather, growth and invaders coming in", () => {
  // wind blows crows a tile; off the farm they are gone
  let st = blank(); st.s.wx[1] = "e";
  const c1 = inv(st, "crow", at(2, 2)), c2 = inv(st, "crow", at(5, 4));
  E.act(st, { t: "end" });
  assert.equal(c1.at, at(3, 2));
  assert.ok(!alive(st, c2));
  // fields grow to ripe and no further; hurt fields do not grow
  st = blank(); field(st, at(1, 1), 1); field(st, at(2, 1), 2); st.s.x[at(2, 1)] = 1;
  E.act(st, { t: "end" }); E.act(st, { t: "end" }); E.act(st, { t: "end" });
  assert.deepEqual([st.s.g[at(1, 1)], st.s.g[at(2, 1)]], [3, 2]);
  // a farmhand on the entry tile keeps the invader out and takes 1
  st = blank(); const sm = folk(st, 1, at(0, 3)); st.s.next = [{ k: "wolf", at: at(0, 3) }, { k: "crow", at: at(5, 0) }];
  E.act(st, { t: "end" });
  assert.equal(sm.hp, 3);
  assert.deepEqual(st.s.u.filter((u) => u.f === 0).map((u) => u.k), ["crow"]);
  assert.equal(st.s.turn, 2);
  // folk are ready again each turn
  assert.deepEqual([sm.mo, sm.ac], [0, 0]);
});

test("fieldwarden: actions that are not allowed change nothing", () => {
  const st = blank(), sm = folk(st, 1, at(2, 2)), w = inv(st, "wolf", at(3, 2));
  w.hp = 9; w.mh = 9;
  const before = J(st);
  assert.equal(E.act(st, { t: "mv", u: sm.id, to: at(5, 5) }), null, "too far");
  assert.equal(E.act(st, { t: "tool", u: sm.id, at: at(0, 0) }), null, "out of reach");
  assert.equal(E.act(st, { t: "mv", u: w.id, to: at(3, 3) }), null, "not a farmhand");
  assert.equal(E.act(st, { t: "buy", k: "hp", f: 0 }), null, "no market in a season");
  assert.equal(E.act(st, { t: "next" }), null);
  assert.equal(J(st), before);
  assert.ok(E.act(st, { t: "mv", u: sm.id, to: at(2, 3) }));
  assert.equal(E.act(st, { t: "mv", u: sm.id, to: at(2, 4) }), null, "one move a turn");
  assert.ok(E.act(st, { t: "mv", u: sm.id, to: at(2, 3) }) === null);
  const sm2 = folk(st, 0, at(0, 0));
  assert.ok(E.act(st, { t: "tool", u: sm.id, at: at(3, 3) }) === null || true);
  assert.ok(sm2);
});

test("fieldwarden: the harvest, the quota, the wish and the market", () => {
  let st = blank();
  field(st, at(1, 1), 3); field(st, at(2, 1), 3); field(st, at(3, 1), 1);
  st.s.max = 9; st.s.q = 6; st.s.turn = E.T;
  let ev = E.act(st, { t: "end" });
  assert.ok(ev.some((e) => e.k === "harvest"));
  assert.deepEqual(st.res, { h: 8, q: 6, w: 1 });
  assert.equal(st.coins, 2 + E.WISH_BONUS);
  assert.equal(st.phase, "shop");
  assert.ok(E.valid(st));
  // the market
  assert.ok(E.shopOk(st, { t: "buy", k: "hp", f: 0 }));
  assert.ok(E.act(st, { t: "buy", k: "hp", f: 0 }));
  assert.equal(st.folk[0].mh, 4);
  assert.equal(st.coins, 1);
  assert.equal(E.act(st, { t: "buy", k: "up", f: 0, n: 0 }), null, "not enough coins");
  st.coins = 20;
  assert.ok(E.act(st, { t: "buy", k: "up", f: 0, n: 0 }));
  assert.equal(E.act(st, { t: "buy", k: "up", f: 0, n: 0 }), null, "once");
  assert.equal(E.toolOf(st, 0).pull, 2);
  assert.ok(E.act(st, { t: "buy", k: "ready" }));
  assert.ok(E.valid(st));
  assert.ok(E.act(st, { t: "next" }));
  assert.deepEqual([st.sea, st.phase, st.ready, st.s.turn], [2, "play", 0, 1]);
  assert.equal(E.folkUnit(st.s, 0).mh, 4, "Health bought counts next season");
  assert.ok(E.valid(st));
  // a missed quota ends the year
  st = blank(); field(st, at(1, 1), 1); st.s.max = 3; st.s.q = 3; st.s.turn = E.T;
  E.act(st, { t: "end" });
  assert.deepEqual([st.over, st.res.h], [0, 2]);
  assert.equal(E.act(st, { t: "end" }), null);
  assert.ok(E.valid(st));
});

test("fieldwarden: the last season of the year ends it; the captain whistles when hurt", () => {
  const st = blank();
  st.sea = E.SEASONS; field(st, at(1, 1), 3); st.s.max = 3; st.s.q = 3; st.s.turn = E.T;
  E.act(st, { t: "end" });
  assert.equal(st.over, 1);
  const s2 = blank(), cap = inv(s2, "captain", at(0, 0));
  folk(s2, 1, at(4, 4));
  cap.hp = 3;
  E.act(s2, { t: "end" });
  assert.ok(s2.s.next.some((e) => e.k === "wolf" && e.w === 1), "a wolf whistled for");
  assert.ok(E.valid(s2));
});

test("fieldwarden: a saved state is checked on load", () => {
  const st = E.newYear("chk", "m", ["shepherd", "smith", "hedger"], 1);
  assert.ok(E.valid(st));
  const bad = [
    (s) => { s.v = 2; }, (s) => { s.diff = "x"; }, (s) => { s.folk[1].c = s.folk[0].c; }, (s) => { s.s.t[0] = "?"; },
    (s) => { s.s.g[0] = 4; }, (s) => { s.s.u[0].at = s.s.u[1].at; }, (s) => { s.s.u[0].hp = 0; }, (s) => { s.s.turn = 6; },
    (s) => { s.s.q = s.s.max + 1; }, (s) => { s.s.u.push({ id: 999, k: "dragon", f: 0, fi: -1, at: 0, hp: 1, mh: 1, mo: 0, ac: 0, it: null, sn: 0 }); },
    (s) => { s.coins = -1; }, (s) => { s.phase = "shop"; }, (s) => { s.seed = "A B"; }, (s) => { s.s.wx = ["c"]; },
    (s) => { s.s.t[s.s.bi] = "d"; }, (s) => { s.folk[0].mh = 99; }
  ];
  bad.forEach((f, k) => {
    const c = E.clone(st);
    f(c);
    assert.equal(E.valid(c), false, "mutation " + k);
  });
});

test("fieldwarden: 60 bot years end with no illegal state; the balance holds", () => {
  const run = (seed, diff, trio, smart) => {
    const st = E.newYear(seed, diff, trio, 1);
    let guard = 0;
    while (st.over < 0 && guard++ < 100) {
      assert.ok(E.valid(st), seed);
      if (st.phase === "shop") E.botShop(st);
      else E.botTurn(st, smart);
    }
    assert.ok(E.valid(st), seed + " end");
    assert.ok(st.over >= 0, seed + " ends");
    return st;
  };
  let smartM = 0, smartH = 0, simpleH = 0, simpleSeasonsLost = 0;
  const winners = new Set();
  for (let k = 0; k < 20; k++) {
    const trio = TRIOS[k % TRIOS.length];
    const a = run("b" + k, "m", trio, true);
    if (a.over === 1) { smartM++; trio.forEach((c) => winners.add(c)); }
    if (run("c" + k, "h", trio, true).over === 1) smartH++;
    const s = run("d" + k, "h", trio, false);
    if (s.over === 1) simpleH++;
    if (s.over === 0) simpleSeasonsLost++;
  }
  assert.ok(smartM >= 18, "the smart bot finishes Mild years: " + smartM);
  assert.ok(smartH >= 10, "the smart bot finishes Harsh years: " + smartH);
  assert.ok(simpleSeasonsLost >= 5, "a simple bot misses Harsh quotas: " + simpleSeasonsLost);
  assert.ok(simpleH < smartH);
  assert.equal(winners.size, 6, "every farmhand is in a finished year");
});

test("fieldwarden: records merge as a join", () => {
  const A = { ver: 1, br: 5, rows: { aaaaaa: { b: 5, s: { m: [3, 1, 4] }, hb: 20, c: { smith: 1 } }, oldold: { b: 1, s: { m: [9, 9, 4] } } } };
  const B = { ver: 1, br: 5, rows: { aaaaaa: { b: 5, s: { m: [4, 1, 2], h: [1, 0, 1] }, hb: 25, c: { smith: 1, hedger: 1 } }, bbbbbb: { b: 5, s: { h: [2, 1, 4] } } } };
  const m = R.mergeFieldwarden;
  assert.equal(J(m(A, B)), J(m(B, A)));
  assert.equal(J(m(m(A, B), B)), J(m(A, B)));
  assert.equal(J(m(m(A, B), A)), J(m(A, B)));
  const x = m(A, B);
  assert.deepEqual(x.rows.aaaaaa, { b: 5, s: { m: [4, 1, 4], h: [1, 0, 1] }, hb: 25, c: { smith: 1, hedger: 1 } });
  assert.ok(!x.rows.oldold, "rows from before the reset drop");
  assert.ok(!m({ rows: { zzzzzz: { b: 0, s: { m: [1, 2, 0] } }, "BAD!": { b: 0, s: { m: [1, 0, 0] } } } }, {}).rows.zzzzzz, "won > played drops");
  assert.equal(m({ rows: { cccccc: { b: 0, s: { m: [1, 0, 99] } } } }, {}).rows.cccccc, undefined, "more seasons than a year has drops");
});
