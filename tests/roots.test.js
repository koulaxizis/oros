// Roots: the rules engine (roots/engine.js, a module) and the records
// merge (cut out of the app IIFE by name, like tests/fieldwarden.test.js).
// Run: node --test tests/

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const E = require("../roots/engine.js");

const SRC = fs.readFileSync(path.join(__dirname, "..", "roots/roots.js"), "utf8");
const R = (() => {
  const parts = ["var E = this; var DATA_VER = 1; var DIFFS = E.DIFFS; var BIG = 1e9; var SIZE = E.SIZE; var MAX_SCORE = 999;"];
  ["cmpStr", "isInt", "normRow", "joinRows", "mergeRoots"].forEach((name) => {
    const i = SRC.indexOf("  function " + name + "(");
    if (i < 0) throw new Error("missing function " + name);
    const line = SRC.slice(i, SRC.indexOf("\n", i));
    parts.push(/\}\s*$/.test(line) ? line : SRC.slice(i, SRC.indexOf("\n  }\n", i) + 4));
  });
  return new Function(parts.join("\n") + "\nreturn { mergeRoots };").call(E);
})();

const J = JSON.stringify;
const W = E.W;
const at = (x, y) => y * W + x;

// A bare glade set up by hand: all soil, only the base root, no pests,
// nobody coming, plenty of sap.
function blank(diff = "m", sea = 1) {
  const st = E.newYear("t1", diff);
  for (let i = W; i < E.SIZE; i++) { st.t[i] = "."; st.r[i] = 0; st.th[i] = 0; st.cut[i] = 0; }
  for (let i = 0; i < W; i++) { st.bk[i] = 0; st.ba[i] = 0; }
  st.r[E.BASE] = 2;
  st.sea = sea;
  st.sap = 20;
  const s = st.s;
  s.u = []; s.nid = 1; s.next = []; s.sched = [[], [], [], [], [], [], []]; s.turn = 1; s.done = 0; s.q = 1;
  return st;
}
function line(st, tiles, kind = 1) { tiles.forEach((i) => { st.r[i] = kind; }); }
function pest(st, k, i, it) {
  const P = E.PESTS[k], u = { id: st.s.nid++, k, at: i, hp: P.hp, lt: P.lt, it: it || null };
  st.s.u.push(u);
  return u;
}
const end = (st) => E.act(st, { t: "end" });

test("roots: a year is the same for the same code; every soil tile can be reached", () => {
  assert.equal(J(E.newYear("abc123", "m")), J(E.newYear("abc123", "m")));
  assert.notEqual(J(E.newYear("abc123", "m").t), J(E.newYear("abc124", "m").t));
  for (let k = 0; k < 30; k++) {
    const st = E.newYear("g" + k, k % 2 ? "h" : "m");
    assert.ok(E.valid(st), "valid " + k);
    assert.equal(st.t[E.TRUNK], "T");
    assert.equal(st.r[E.BASE], 2, "the base root");
    assert.equal(st.t.filter((c) => c === "w").length, 3, "3 springs");
    assert.ok(st.s.q >= 1);
    // every non-stone soil tile joins the base through soil
    const seen = new Set([E.BASE]), q = [E.BASE];
    while (q.length) {
      const i = q.shift();
      for (let d = 0; d < 4; d++) {
        const n = E.step(i, d);
        if (n >= 0 && !seen.has(n) && E.soil(st.t, n)) { seen.add(n); q.push(n); }
      }
    }
    for (let i = W; i < E.SIZE; i++) if (st.t[i] !== "#") assert.ok(seen.has(i), "tile " + i + " of " + k);
  }
});

test("roots: sap comes from the trunk, joined springs and minerals, and leaves above joined roots", () => {
  const st = blank();
  assert.equal(E.income(st), 2, "the trunk alone");
  st.t[at(3, 3)] = "w"; st.t[at(4, 1)] = "m";
  line(st, [at(3, 2), at(3, 3), at(4, 1)]);
  assert.equal(E.income(st), 2 + 2 + 1);
  st.bk[3] = 3;
  assert.equal(E.income(st), 6, "an open leaf above the base root");
  st.bk[5] = 3;
  assert.equal(E.income(st), 6, "a leaf above no root gives nothing");
  st.r[at(3, 2)] = 0;
  assert.equal(E.income(st), 2 + 1 + 1, "the spring is cut off; the mineral still joins");
  assert.equal(E.springs(st), 0);
  st.sap = 3;
  end(st);
  assert.equal(st.sap, 3 + 4, "income is added at the start of the next turn");
});

test("roots: a root cut off gives nothing and withers after 2 turns unless it is joined again", () => {
  const st = blank();
  line(st, [at(3, 2), at(3, 3), at(3, 4), at(3, 5)]);
  st.r[at(3, 2)] = 0;   // cut below the base
  let ev = end(st);
  assert.ok(ev.some((e) => e.k === "cut" && e.at === at(3, 3)));
  assert.equal(st.cut[at(3, 3)], 2);
  end(st);
  assert.equal(st.cut[at(3, 4)], 1);
  ev = end(st);
  assert.ok(ev.some((e) => e.k === "wither"));
  assert.equal(st.r[at(3, 3)] + st.r[at(3, 4)] + st.r[at(3, 5)], 0, "the cut branch is gone");
  // joined again in time: nothing is lost
  const b = blank();
  line(b, [at(3, 2), at(3, 3), at(3, 4)]);
  b.r[at(3, 2)] = 0;
  end(b);
  assert.equal(b.cut[at(3, 3)], 2);
  assert.ok(E.act(b, { t: "root", at: at(3, 2) }), "regrow the link");
  end(b);
  assert.equal(b.cut[at(3, 3)], 0);
  assert.equal(b.r[at(3, 4)], 1);
  assert.equal(E.longest(b), 3);
});

test("roots: growths cost sap and need the network; what is not allowed changes nothing", () => {
  const st = blank();
  st.sap = 2;
  st.t[at(2, 1)] = "c"; st.t[at(4, 1)] = "#";
  const before = J(st);
  [{ t: "root", at: at(0, 5) }, { t: "root", at: at(4, 1) }, { t: "thick", at: E.BASE }, { t: "thorn", at: E.BASE },
   { t: "bud", at: 0, k: "f" }, { t: "bud", at: E.TRUNK, k: "l" }, { t: "root", at: 2 }, { t: "next" }, { t: "fly" }].forEach((a) => {
    assert.equal(E.act(st, a), null, J(a));
  });
  assert.equal(J(st), before);
  assert.ok(E.act(st, { t: "root", at: at(2, 1) }), "clay costs 2");
  assert.equal(st.sap, 0);
  assert.equal(E.act(st, { t: "root", at: at(3, 2) }), null, "no sap left");
  st.sap = 20;
  assert.ok(E.act(st, { t: "bud", at: 2, k: "f" }), "a bud above a joined root");
  assert.ok(E.act(st, { t: "thick", at: at(2, 1) }));
  assert.ok(E.act(st, { t: "thorn", at: at(2, 1) }));
  assert.equal(st.sap, 20 - 2 - 2 - 3);
  assert.equal(E.act(st, { t: "thorn", at: at(2, 1) }), null, "one thorn a tile");
});

test("roots: beetles chew, moles dig, aphids eat buds, blight spreads", () => {
  let st = blank();
  line(st, [at(3, 2), at(3, 3)]);
  st.r[at(3, 3)] = 2;
  pest(st, "beetle", at(4, 2), { a: "chew", to: at(3, 2), b: at(3, 2) });
  pest(st, "beetle", at(2, 3), { a: "chew", to: at(3, 3), b: at(3, 3) });
  end(st);
  assert.equal(st.r[at(3, 2)], 0, "a thin root breaks");
  assert.equal(st.r[at(3, 3)], 1, "a thick root turns thin");

  st = blank();
  line(st, [at(1, 4), at(2, 4), at(3, 4)]);
  st.r[at(3, 4)] = 2;
  pest(st, "mole", at(0, 4), { a: "dig", d: 1 });
  end(st);
  assert.deepEqual([st.r[at(1, 4)], st.r[at(2, 4)], st.r[at(3, 4)]], [0, 0, 1], "every root in the line is hurt");

  st = blank();
  st.bk[2] = 2; st.ba[2] = 2; st.bk[4] = 4;
  pest(st, "aphid", 1, { a: "eat", to: 2, e: 2 });
  pest(st, "aphid", 5, { a: "eat", to: 4, e: 4 });
  end(st);
  assert.equal(st.bk[2], 0, "a bud is eaten");
  assert.equal(st.bk[4], 4, "an open flower is safe");

  st = blank("m", 3);
  line(st, [at(3, 2), at(3, 3), at(2, 3), at(4, 3)]);
  st.r[at(4, 3)] = 2;
  pest(st, "blight", at(3, 4), { a: "spread", to: at(3, 3) });
  end(st);
  assert.equal(st.r[at(3, 3)], 0, "the blight takes a thin root");
  assert.equal(st.s.u.filter((u) => u.k === "blight").length, 2, "and stays there");
  const u = st.s.u.find((v) => v.at === at(3, 3));
  assert.ok(!u.it || u.it.to !== at(4, 3), "a thick root stops it");
});

test("roots: thorns hurt every pest on them or next to them, twice as hard by a mineral", () => {
  let st = blank();
  line(st, [at(3, 2), at(3, 3)]);
  st.th[at(3, 3)] = 1;
  const a = pest(st, "beetle", at(2, 3));
  const b = pest(st, "mole", at(3, 4));
  const c = pest(st, "beetle", at(5, 5));
  let ev = end(st);
  assert.equal(ev.filter((e) => e.k === "thorn").length, 2);
  assert.equal(E.pestById(st.s, a.id).hp, 1);
  assert.equal(E.pestById(st.s, b.id).hp, 2);
  assert.equal(E.pestById(st.s, c.id).hp, 2, "too far away");
  st = blank();
  line(st, [at(3, 2), at(3, 3)]);
  st.th[at(3, 3)] = 1;
  st.t[at(4, 3)] = "m";
  const d = pest(st, "beetle", at(2, 3));
  ev = end(st);
  assert.ok(ev.some((e) => e.k === "gone" && e.p === "beetle"), "2 by a mineral");
  assert.equal(E.pestById(st.s, d.id), null);
  // a thorn cut off from the trunk does nothing
  st = blank();
  line(st, [at(3, 3)]);
  st.th[at(3, 3)] = 1;
  pest(st, "beetle", at(2, 3));
  ev = end(st);
  assert.equal(ev.filter((e) => e.k === "thorn").length, 0);
});

test("roots: buds open after 2 turns only above a joined root; frost bites in late autumn", () => {
  let st = blank();
  line(st, [at(2, 1), at(4, 1)]);
  assert.ok(E.act(st, { t: "bud", at: 2, k: "f" }));
  assert.ok(E.act(st, { t: "bud", at: 4, k: "l" }));
  end(st);
  assert.equal(st.bk[2], 2);
  st.r[at(2, 1)] = 0;
  end(st);
  assert.equal(st.bk[2], 2, "no joined root below: it waits");
  assert.equal(st.bk[4], 3, "the leaf opened");
  st.r[at(2, 1)] = 1;
  end(st);
  assert.equal(st.bk[2], 4, "the flower opened");
  assert.equal(E.flowers(st), 1);

  st = blank("m", 3);
  st.s.turn = 5;
  line(st, [at(1, 1), at(2, 1), at(4, 1), at(5, 1)]);
  st.bk[1] = 2; st.ba[1] = 2;
  st.bk[5] = 2; st.ba[5] = 2; st.bk[4] = 3;
  assert.ok(E.frost(st, st.s));
  end(st);
  assert.equal(st.bk[1], 0, "a bud with no leaf beside it freezes");
  assert.equal(st.bk[5], 2, "a leaf beside keeps it");
  assert.ok(!E.frost(blank("m", 2), blank("m", 2).s), "no frost before autumn");
});

test("roots: the bloom quota ends a season; a miss ends the year; flowers fall between seasons", () => {
  let st = blank();
  st.t[at(3, 2)] = "w"; line(st, [at(3, 2)]);
  st.bk[1] = 4;
  st.s.q = 2; st.s.turn = E.T;
  end(st);
  assert.deepEqual(st.res, { b: 2, q: 2 });
  assert.equal(st.phase, "rest");
  assert.equal(st.over, -1);
  assert.ok(E.valid(st));
  assert.equal(end(st), null, "no turns in the rest");
  assert.ok(E.act(st, { t: "next" }));
  assert.equal(st.sea, 2);
  assert.equal(st.bk[1], 0, "the flower fell");
  assert.equal(st.r[at(3, 2)], 1, "the roots stay");
  assert.ok(st.s.q >= 1);

  st = blank();
  st.s.q = 3; st.s.turn = E.T;
  end(st);
  assert.equal(st.over, 0, "a quota missed ends the year");
  assert.equal(E.act(st, { t: "next" }), null);
  assert.equal(E.score(st), 0 + 0 + 0);
});

test("roots: a saved state is checked on load", () => {
  const st = E.newYear("chk", "m");
  assert.ok(E.valid(st));
  const bad = [
    (s) => { s.v = 2; }, (s) => { s.diff = "x"; }, (s) => { s.t[0] = "."; }, (s) => { s.t[20] = "?"; },
    (s) => { s.r[E.BASE] = 1; }, (s) => { s.r[2] = 1; }, (s) => { s.th[20] = 1; s.r[20] = 0; }, (s) => { s.bk[E.TRUNK] = 1; },
    (s) => { s.bk[1] = 1; s.ba[1] = 0; }, (s) => { s.sap = 99; }, (s) => { s.s.turn = 7; }, (s) => { s.phase = "rest"; },
    (s) => { s.seed = "A B"; }, (s) => { s.s.u.push({ id: 1, k: "dragon", at: 30, hp: 1, lt: 1, it: null }); },
    (s) => { s.s.u.push({ id: 1, k: "aphid", at: 30, hp: 1, lt: 1, it: null }); }, (s) => { s.s.sched = []; }
  ];
  bad.forEach((f, k) => {
    const c = E.clone(st);
    f(c);
    assert.equal(E.valid(c), false, "mutation " + k);
  });
});

test("roots: bot years end with no illegal state; the balance holds", () => {
  const simple = (st) => {
    if (st.phase === "rest") { E.act(st, { t: "next" }); return; }
    for (let g = 0; g < 10; g++) {
      const o = E.options(st);
      const a = o.find((x) => x.t === "bud" && x.k === "f") || o.find((x) => x.t === "root");
      if (!a) break;
      E.act(st, a);
    }
    E.act(st, { t: "end" });
  };
  const run = (seed, diff, smart) => {
    const st = E.newYear(seed, diff);
    let guard = 0;
    while (st.over < 0 && guard++ < 100) {
      assert.ok(E.valid(st), seed);
      if (smart) E.botTurn(st); else simple(st);
    }
    assert.ok(E.valid(st), seed + " end");
    assert.ok(st.over >= 0, seed + " ends");
    return st;
  };
  let smartM = 0, smartH = 0, simpleM = 0, simpleH = 0;
  for (let k = 0; k < 6; k++) {
    if (run("b" + k, "m", true).over === 1) smartM++;
    if (run("c" + k, "h", true).over === 1) smartH++;
  }
  for (let k = 0; k < 12; k++) {
    if (run("d" + k, "m", false).over === 1) simpleM++;
    if (run("e" + k, "h", false).over === 1) simpleH++;
  }
  assert.ok(smartM >= 5, "the solver finishes Mild years: " + smartM);
  assert.ok(smartH >= 4, "the solver finishes Hardy years: " + smartH);
  assert.ok(simpleM < 12, "a simple bot misses some Mild quotas: " + simpleM);
  assert.ok(simpleH < 9, "a simple bot misses Hardy quotas: " + simpleH);
});

test("roots: records merge as a join", () => {
  const A = { ver: 1, br: 5, rows: { aaaaaa: { b: 5, s: { m: [3, 1, 30] }, lr: 9 }, oldold: { b: 1, s: { m: [9, 9, 40] }, lr: 20 } } };
  const B = { ver: 1, br: 5, rows: { aaaaaa: { b: 5, s: { m: [4, 1, 25], h: [1, 0, 12] }, lr: 7 }, bbbbbb: { b: 5, s: { h: [2, 1, 33] }, lr: 11 } } };
  const m = R.mergeRoots;
  assert.equal(J(m(A, B)), J(m(B, A)));
  assert.equal(J(m(m(A, B), B)), J(m(A, B)));
  assert.equal(J(m(m(A, B), A)), J(m(A, B)));
  const x = m(A, B);
  assert.deepEqual(x.rows.aaaaaa, { b: 5, s: { m: [4, 1, 30], h: [1, 0, 12] }, lr: 9 });
  assert.ok(!x.rows.oldold, "rows from before the reset drop");
  assert.ok(!m({ rows: { zzzzzz: { b: 0, s: { m: [1, 2, 0] } } } }, {}).rows.zzzzzz, "finished > played drops");
  assert.ok(!m({ rows: { "BAD!": { b: 0, s: { m: [1, 0, 0] } } } }, {}).rows["BAD!"], "a bad row id drops");
  assert.equal(m({ rows: { cccccc: { b: 0, s: { m: [1, 0, 5] }, lr: 999 } } }, {}).rows.cccccc.lr, 0, "a root longer than the glade drops to 0");
});
