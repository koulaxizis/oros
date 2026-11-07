// Banner: the rules engine (banner/engine.js, a module), the card table
// (banner/cards.js) and the records merge (cut out of the app IIFE by
// name, like tests/crypt.test.js).
// Run: node --test tests/

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const E = require("../banner/engine.js");
const D = require("../banner/cards.js");

const SRC = fs.readFileSync(path.join(__dirname, "..", "banner/banner.js"), "utf8");
const R = (() => {
  const parts = ["var DATA_VER = 1; var ROW_KEYS = ['e','m','h','p'];"];
  ["cmpStr", "isInt", "normRow", "joinRows", "mergeBanner"].forEach((name) => {
    const i = SRC.indexOf("  function " + name + "(");
    if (i < 0) throw new Error("missing function " + name);
    const one = SRC.indexOf("\n", i);
    const line = SRC.slice(i, one);
    parts.push(/\}\s*$/.test(line) ? line : SRC.slice(i, SRC.indexOf("\n  }\n", i) + 4));
  });
  return new Function(parts.join("\n") + "\nreturn { mergeBanner };")();
})();

const J = JSON.stringify;
const W = E.W;
const at = (x, y) => y * W + x;
const PLAIN = ".".repeat(E.N);

// A quiet board: plain ground, no units, side 0 to play with 6 energy.
function quiet(hand0, hand1) {
  const st = E.newBattle("t", ["iron", "ember"], 0);
  st.map = PLAIN;
  st.hand = [hand0 || [], hand1 || []];
  st.units = [];
  st.rt = [6, 6];
  st.en = [6, 0];
  return st;
}
function put(st, k, s, i, extra) {
  const u = Object.assign({ id: st.nid++, k, s, i, hp: D.CARDS[k].hp, mv: 0, at: 0, f: 0, st: 0 }, extra || {});
  st.units.push(u);
  return u;
}
function endBoth(st) { E.act(st, { t: "end" }); E.act(st, { t: "end" }); }

test("banner: card table and starter decks", () => {
  const ks = Object.keys(D.CARDS);
  assert.equal(ks.length, 36);
  assert.equal(ks.filter((k) => D.CARDS[k].t === "u").length, 20);
  assert.equal(ks.filter((k) => D.CARDS[k].t === "s").length, 8);
  assert.equal(ks.filter((k) => D.CARDS[k].t === "t").length, 8);
  ks.forEach((k) => {
    const c = D.CARDS[k];
    assert.ok(c.c >= 1 && c.c <= 6, k);
    if (c.t === "u") {
      assert.ok(c.hp > 0 && c.atk > 0 && c.mv > 0, k);
      assert.ok(["", "reach", "guard", "charge", "climb", "heal"].includes(c.kw), k);
    }
    if (c.t === "t") assert.ok(E.TILE_OF[k], k);
  });
  assert.deepEqual(D.DECK_IDS, ["iron", "thorn", "tide", "ember"]);
  D.DECK_IDS.forEach((id) => {
    const list = E.deckList(id);
    assert.equal(list.length, 20, id);
    list.forEach((k) => assert.ok(D.CARDS[k], id + " " + k));
  });
  // every app string for a card exists in both languages
  ks.forEach((k) => {
    assert.ok(SRC.includes('"c.' + k + '"'), "name " + k);
    if (D.CARDS[k].t !== "u") assert.ok(SRC.includes('"tx.' + k + '"'), "text " + k);
  });
});

test("banner: the board is deterministic, mirror-fair and every Keep can be reached", () => {
  for (let n = 0; n < 200; n++) {
    const seed = "s" + n;
    const m = E.makeBoard(seed);
    assert.equal(m, E.makeBoard(seed));
    assert.equal(m.length, E.N);
    for (let i = 0; i < E.N; i++) assert.equal(m.charAt(i), m.charAt(E.N - 1 - i), seed + " mirror " + i);
    E.KEEPS.concat(E.SHRINES).forEach((i) => assert.equal(m.charAt(i), ".", seed));
    for (let x = 0; x < W; x++) { assert.equal(m.charAt(at(x, 0)), "."); assert.equal(m.charAt(at(x, 6)), "."); }
    assert.ok(E.pathOk(m), seed);
  }
  const a = E.newBattle("same", ["tide", "thorn"]), b = E.newBattle("same", ["tide", "thorn"]);
  assert.equal(J(a), J(b));
  assert.notEqual(J(E.newBattle("other", ["tide", "thorn"]).hand), J(a.hand));
});

test("banner: a new battle starts valid with 4 cards and 1 energy", () => {
  const st = E.newBattle("x1", ["iron", "thorn"], 1);
  assert.ok(E.valid(st));
  assert.equal(st.side, 1);
  assert.equal(st.hand[0].length, 4);
  assert.equal(st.hand[1].length, 4);
  assert.equal(st.deck[0].length, 16);
  assert.deepEqual(st.en, [0, 1]);
  assert.deepEqual(st.keep, [15, 15]);
  E.act(st, { t: "end" });
  assert.equal(st.side, 0);
  assert.equal(st.hand[0].length, 6, "draw 2 from the second turn on");
  assert.equal(st.en[0], 1);
  E.act(st, { t: "end" });
  assert.equal(st.en[1], 2, "one more energy each own turn");
});

test("banner: energy caps at 6 plus 1 for each shrine held", () => {
  const st = quiet();
  st.rt = [9, 9];
  E.SHRINES.slice(0, 2).forEach((i) => put(st, "militia", 0, i));
  endBoth(st);
  assert.equal(st.en[0], 6 + 2);
  assert.equal(E.shrinesHeld(st, 0), 2);
});

test("banner: units go on the home row or next to own units on the own half", () => {
  const st = quiet(["militia"]);
  const cells = E.targets(st, 0);
  for (let x = 0; x < W; x++) if (at(x, 6) !== E.KEEPS[0]) assert.ok(cells.includes(at(x, 6)));
  assert.ok(!cells.includes(E.KEEPS[0]));
  assert.ok(!cells.includes(at(0, 5)));
  put(st, "spear", 0, at(0, 4));
  const c2 = E.targets(st, 0);
  assert.ok(c2.includes(at(0, 3)) && c2.includes(at(0, 5)) && c2.includes(at(1, 4)));
  put(st, "spear", 0, at(0, 3));
  assert.ok(!E.targets(st, 0).includes(at(0, 2)), "not past the middle row");
  st.en[0] = 0;
  assert.deepEqual(E.targets(st, 0), [], "no energy, no play");
  st.en[0] = 6;
  assert.equal(E.act(st, { t: "play", h: 0, c: at(4, 0) }), null, "an illegal play changes nothing");
  assert.ok(E.act(st, { t: "play", h: 0, c: at(4, 6) }));
  assert.equal(st.en[0], 5);
  assert.equal(st.hand[0].length, 0);
});

test("banner: a new unit waits a turn unless it has Charge; move once and attack once", () => {
  const st = quiet(["spear", "raider"]);
  E.act(st, { t: "play", h: 0, c: at(1, 6) });
  E.act(st, { t: "play", h: 0, c: at(3, 6) });
  const sp = E.unitAt(st, at(1, 6)), rd = E.unitAt(st, at(3, 6));
  assert.deepEqual(E.moves(st, sp), []);
  assert.ok(E.moves(st, rd).length > 0);
  assert.ok(E.act(st, { t: "move", u: rd.id, c: at(3, 5) }));
  assert.deepEqual(E.moves(st, rd), [], "one move per turn");
  endBoth(st);
  assert.ok(E.moves(st, sp).includes(at(1, 5)));
  assert.ok(!E.moves(st, sp).includes(at(1, 4)), "Move 1");
});

test("banner: damage, wood, tower, Guard, Rally and the strike back", () => {
  const st = quiet(["rally"]);
  const a = put(st, "spear", 0, at(2, 4));
  const t = put(st, "golem", 1, at(2, 3));
  assert.ok(E.act(st, { t: "atk", u: a.id, c: t.i }));
  assert.equal(t.hp, 9 - 2);
  assert.equal(a.hp, 3 - 2, "the target hits back");
  assert.equal(E.act(st, { t: "atk", u: a.id, c: t.i }), null, "one attack per turn");
  // wood and Guard each take 1 off, at least 1
  const st2 = quiet();
  st2.map = st2.map.slice(0, at(2, 3)) + "w" + st2.map.slice(at(2, 3) + 1);
  const b = put(st2, "giant", 0, at(2, 4));
  const g = put(st2, "golem", 1, at(2, 3));
  put(st2, "shield", 1, at(1, 3));
  E.act(st2, { t: "atk", u: b.id, c: g.i });
  assert.equal(g.hp, 9 - 1, "3 − wood − Guard");
  // tower +1, Rally +1
  const st3 = quiet(["rally"]);
  st3.map = st3.map.slice(0, at(2, 4)) + "t" + st3.map.slice(at(2, 4) + 1);
  const c = put(st3, "spear", 0, at(2, 4));
  const h = put(st3, "golem", 1, at(2, 3));
  E.act(st3, { t: "play", h: 0, c: -1 });
  E.act(st3, { t: "atk", u: c.id, c: h.i });
  assert.equal(h.hp, 9 - 4);
});

test("banner: Reach hits 2 away in a line, not past a rock, and takes no strike back", () => {
  const st = quiet();
  const ar = put(st, "archer", 0, at(2, 5));
  const t = put(st, "spear", 1, at(2, 3));
  assert.ok(E.attacks(st, ar).includes(t.i));
  E.act(st, { t: "atk", u: ar.id, c: t.i });
  assert.equal(t.hp, 2);
  assert.equal(ar.hp, 2, "no strike back from 2 away");
  const st2 = quiet();
  st2.map = st2.map.slice(0, at(2, 4)) + "r" + st2.map.slice(at(2, 4) + 1);
  const a2 = put(st2, "archer", 0, at(2, 5));
  put(st2, "spear", 1, at(2, 3));
  assert.deepEqual(E.attacks(st2, a2), []);
});

test("banner: Climb passes rock and water; a mire stops a unit for a turn; a road adds 1 Move", () => {
  const st = quiet();
  st.map = st.map.slice(0, at(2, 4)) + "r" + st.map.slice(at(2, 4) + 1);
  st.map = st.map.slice(0, at(1, 5)) + "~" + st.map.slice(at(1, 5) + 1);
  const s = put(st, "spear", 0, at(2, 5));
  const c = put(st, "climber", 0, at(1, 6));
  assert.ok(!E.moves(st, s).includes(at(2, 4)));
  assert.ok(E.moves(st, c).includes(at(1, 5)));
  const st2 = quiet();
  st2.map = st2.map.slice(0, at(0, 4)) + "m" + st2.map.slice(at(0, 4) + 1);
  const w = put(st2, "wolf", 0, at(0, 5));
  E.act(st2, { t: "move", u: w.id, c: at(0, 4) });
  assert.equal(w.st, 1);
  endBoth(st2);
  assert.deepEqual(E.moves(st2, w), [], "stuck for its next turn");
  endBoth(st2);
  assert.ok(E.moves(st2, w).length > 0);
  const st3 = quiet();
  st3.map = st3.map.slice(0, at(0, 5)) + "d" + st3.map.slice(at(0, 5) + 1);
  const m = put(st3, "militia", 0, at(0, 5));
  assert.ok(E.moves(st3, m).includes(at(0, 3)), "Move 1 + road");
});

test("banner: Heal and springs heal at the end of the turn", () => {
  const st = quiet();
  put(st, "healer", 0, at(2, 5));
  const f = put(st, "golem", 0, at(1, 5), { hp: 5 });
  st.map = st.map.slice(0, at(4, 5)) + "s" + st.map.slice(at(4, 5) + 1);
  const g = put(st, "golem", 0, at(4, 5), { hp: 5 });
  E.act(st, { t: "end" });
  assert.equal(f.hp, 6);
  assert.equal(g.hp, 6);
});

test("banner: every spell", () => {
  const st = quiet(["spark", "mend", "recall", "haste", "quake", "fortify"]);
  const e = put(st, "golem", 1, at(0, 2));
  const own = put(st, "golem", 0, at(4, 5), { hp: 2, mv: 1, at: 1 });
  st.map = st.map.slice(0, at(3, 3)) + "w" + st.map.slice(at(3, 3) + 1);
  st.keep[0] = 10;
  st.en[0] = 20;
  const h = (k) => st.hand[0].indexOf(k);
  assert.ok(E.act(st, { t: "play", h: h("spark"), c: e.i })); assert.equal(e.hp, 7);
  assert.ok(E.act(st, { t: "play", h: h("mend"), c: own.i })); assert.equal(own.hp, 5);
  assert.ok(E.act(st, { t: "play", h: h("haste"), c: own.i })); assert.equal(own.mv + own.at, 0);
  assert.ok(E.act(st, { t: "play", h: h("quake"), c: at(3, 3) })); assert.equal(st.map.charAt(at(3, 3)), ".");
  assert.ok(E.act(st, { t: "play", h: h("fortify"), c: -1 })); assert.equal(st.keep[0], 13);
  assert.ok(E.act(st, { t: "play", h: h("recall"), c: own.i }));
  assert.ok(!st.units.includes(own) && st.hand[0].includes("golem"));
  const st2 = quiet(["storm"]);
  const a = put(st2, "militia", 1, at(0, 1), { hp: 1 }), b = put(st2, "golem", 1, at(4, 1));
  const mine = put(st2, "militia", 0, at(0, 5));
  E.act(st2, { t: "play", h: 0, c: -1 });
  assert.ok(!st2.units.includes(a) && b.hp === 8 && mine.hp === 2);
  assert.ok(st2.disc[1].includes("militia"), "a fallen unit goes to the discard pile");
});

test("banner: tiles change the ground but never cut the way between the Keeps", () => {
  const st = quiet(["rock", "bridge", "wood"]);
  const rock = E.targets(st, 0);
  assert.ok(!rock.includes(E.KEEPS[0]) && !rock.includes(E.SHRINES[0]));
  for (let x = 0; x < W; x++) assert.ok(!rock.includes(at(x, 0)), "not on the enemy home row");
  assert.deepEqual(E.targets(st, 1), [], "a bridge needs water");
  // a wall of rocks leaves one gap: that gap can never close
  st.map = PLAIN.split("").map((ch, i) => (Math.floor(i / W) === 2 && i % W !== 4 ? "r" : ch)).join("");
  assert.ok(!E.targets(st, 0).includes(at(4, 2)));
  assert.ok(E.act(st, { t: "play", h: 2, c: at(0, 4) }));
  assert.equal(st.map.charAt(at(0, 4)), "w");
});

test("banner: a win by the Keep, by the shrines and by the long battle", () => {
  const st = quiet();
  st.keep[1] = 2;
  const k = put(st, "spear", 0, at(2, 1));
  E.act(st, { t: "atk", u: k.id, c: E.KEEPS[1] });
  assert.equal(st.over, 0);
  assert.equal(st.why, "keep");
  assert.equal(E.act(st, { t: "end" }), null, "nothing after the end");
  const s2 = quiet();
  E.SHRINES.forEach((i) => put(s2, "golem", 0, i));
  endBoth(s2); assert.equal(s2.hold[0], 1);
  endBoth(s2); assert.equal(s2.hold[0], 2);
  endBoth(s2);
  assert.equal(s2.over, 0);
  assert.equal(s2.why, "shrines");
  const s3 = quiet();
  s3.rt = [14, 14];
  endBoth(s3);
  assert.equal(s3.keep[0], 14, "turn 15: −1");
  endBoth(s3);
  assert.equal(s3.keep[0], 12, "turn 16: −2");
  assert.ok(s3.tired[1] > 0);
});

test("banner: an empty deck takes back its discard pile; a full hand loses the card", () => {
  const st = quiet(["a", "b", "c", "d", "e", "f"].map(() => "militia"));
  st.deck[0] = [];
  st.disc[0] = ["spear", "spear", "spear"];
  endBoth(st);
  assert.equal(st.hand[0].length, 6);
  assert.equal(st.deck[0].length + st.disc[0].length, 3, "both drawn cards were lost into the discard");
  assert.ok(E.valid(st));
});

test("banner: the saved state check refuses broken states", () => {
  const good = E.newBattle("v", ["iron", "tide"]);
  assert.ok(E.valid(good));
  const bad = [
    (s) => { s.v = 2; }, (s) => { s.decks = ["iron", "nope"]; }, (s) => { s.map = "x"; },
    (s) => { s.map = "r" + s.map.slice(1, E.KEEPS[1]) + "r" + s.map.slice(E.KEEPS[1] + 1); },
    (s) => { s.hand[0].push("joker"); }, (s) => { s.keep = [16, 15]; }, (s) => { s.side = 2; },
    (s) => { s.units.push({ id: 1, k: "spear", s: 0, i: E.KEEPS[0], hp: 3, mv: 0, at: 0, f: 0, st: 0 }); },
    (s) => { s.units.push({ id: 1, k: "spear", s: 0, i: 7, hp: 9, mv: 0, at: 0, f: 0, st: 0 }); }
  ];
  bad.forEach((f, n) => { const s = E.clone(good); f(s); assert.equal(E.valid(s), false, "case " + n); });
  assert.equal(E.valid(null), false);
});

test("banner: 300 computer battles end in a valid state within 60 turns of each side", () => {
  const lv = ["e", "m"];
  for (let n = 0; n < 300; n++) {
    const d = [D.DECK_IDS[n % 4], D.DECK_IDS[(n >> 2) % 4]];
    const st = E.newBattle("ai" + n, d);
    const levels = [lv[n % 2], lv[(n >> 1) % 2]];
    let steps = 0;
    while (st.over < 0 && steps < 5000) {
      const a = E.aiAction(st, levels[st.side]);
      if (!E.act(st, a)) assert.fail("illegal computer action " + J(a) + " in battle " + n);
      steps++;
      if (a.t === "end") assert.ok(E.valid(st), "valid after a turn, battle " + n);
    }
    assert.ok(st.over >= 0, "battle " + n + " ended");
    assert.ok(st.rt[0] <= 60 && st.rt[1] <= 60, "battle " + n + " short enough");
    assert.ok(E.valid(st));
  }
});

function duel(a, b, n0, count) {
  let wins = 0;
  for (let n = n0; n < n0 + count; n++) {
    const st = E.newBattle("lv" + n, [D.DECK_IDS[n % 4], D.DECK_IDS[(n + 1) % 4]], n & 1);
    const lv = n % 2 ? [a, b] : [b, a];
    const me = n % 2 ? 0 : 1;
    while (st.over < 0) E.act(st, E.aiAction(st, lv[st.side]) || { t: "end" });
    if (st.over === me) wins++;
  }
  return wins;
}
test("banner: Medium beats Easy in more than 7 of 10 battles (28 of 40)", () => {
  assert.ok(duel("m", "e", 0, 40) > 28);
});
test("banner: Hard beats Medium in more than half of its battles", () => {
  assert.ok(duel("h", "m", 100, 6) > 3);
});

test("banner: records merge as a join (symmetric, idempotent, reset epoch)", () => {
  const A = { ver: 1, br: 1, rows: { a: { b: 1, s: { m: [3, 2] } }, b: { b: 1, s: { e: [1, 1] } } } };
  const B = { ver: 1, br: 1, rows: { a: { b: 1, s: { m: [2, 2], p: [4, 0] } }, c: { b: 0, s: { h: [5, 5] } } } };
  const ab = R.mergeBanner(A, B), ba = R.mergeBanner(B, A);
  assert.equal(J(ab), J(ba));
  assert.equal(J(R.mergeBanner(ab, ab)), J(ab));
  assert.deepEqual(ab.rows.a.s, { m: [3, 2], p: [4, 0] });
  assert.ok(!ab.rows.c, "a row from before the reset is dropped");
  const junk = R.mergeBanner({ br: 1, rows: { x: { b: 1, s: { m: [1, 2], p: [2, 1], h: [-1, 0], z: [9, 9] } }, y: "no" } }, null);
  assert.deepEqual(junk.rows, {}, "won more than played, a two-player win, negatives and unknown keys are refused");
});
