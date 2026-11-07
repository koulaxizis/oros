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
  const parts = ["var DATA_VER = 1; var ROW_KEYS = ['e','m','h','p','a']; var E = { KEEP_HP: 15, DECK_IDS: ['iron','thorn','tide','ember'] }; var MAX_DAY = 100000; var MAX_TURNS = 999; var MARCH_N = 8; var LAST_N = 10;"];
  parts[0] = parts[0].replace("var E = { KEEP_HP: 15, DECK_IDS: ['iron','thorn','tide','ember'] };", "var E = Object.assign({}, ENGINE);");
  ["cmpStr", "isInt", "normRow", "joinRows", "cleanName", "deckIdOk", "normDeck", "codeOk", "normLast", "normDay", "dayKeyOk", "dayBetter", "mergeBanner"].forEach((name) => {
    const i = SRC.indexOf("  function " + name + "(");
    if (i < 0) throw new Error("missing function " + name);
    const one = SRC.indexOf("\n", i);
    const line = SRC.slice(i, one);
    parts.push(/\}\s*$/.test(line) ? line : SRC.slice(i, SRC.indexOf("\n  }\n", i) + 4));
  });
  parts.push("var PUZZLE_N = 20, DECKS_MAX = 12, DECKS_KEEP = 60, NAME_MAX = 24;");
  return new Function("ENGINE", parts.join("\n") + "\nreturn { mergeBanner, normDeck };")(E);
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

test("banner: Daily battle results merge as a join: newer epoch, then won, fewer turns, more Keep", () => {
  const A = { br: 2, rows: {}, days: { 10: { b: 2, w: 0, t: 9, k: 0 }, 11: { b: 2, w: 1, t: 12, k: 4 }, 12: { b: 1, w: 1, t: 5, k: 9 } } };
  const B = { br: 2, rows: {}, days: { 10: { b: 2, w: 1, t: 14, k: 2 }, 11: { b: 2, w: 1, t: 12, k: 7 }, 13: { b: 3, w: 0, t: 3, k: 1 } } };
  const ab = R.mergeBanner(A, B), ba = R.mergeBanner(B, A);
  assert.equal(J(ab), J(ba));
  assert.equal(J(R.mergeBanner(ab, ab)), J(ab));
  assert.deepEqual(ab.days[10], { b: 2, w: 1, t: 14, k: 2 }, "a win beats a loss");
  assert.deepEqual(ab.days[11], { b: 2, w: 1, t: 12, k: 7 }, "same turns: more Keep left");
  assert.ok(!ab.days[12], "older than the reset");
  assert.deepEqual(ab.days[13], { b: 3, w: 0, t: 3, k: 1 });
  assert.deepEqual(Object.keys(ab.days), ["10", "11", "13"]);
  const junk = R.mergeBanner({ br: 0, rows: {}, days: { x: { b: 0, w: 1, t: 2, k: 3 }, 5: { b: 0, w: 1, t: 2, k: 0 },
    6: { b: 0, w: 2, t: 2, k: 3 }, 7: { b: 0, w: 0, t: 0, k: 3 }, 8: { b: 0, w: 0, t: 4, k: 16 }, 9: "no" } }, null);
  assert.deepEqual(junk.days, {}, "bad keys, a win with no Keep left, bad flags, turns and Keep are refused");
  assert.deepEqual(R.mergeBanner({ br: 0, rows: {} }, null).days, {}, "older data without days");
});

test("banner: the Daily battle is the same for everyone on a day", () => {
  const K = require("../gamekit/daily.js");
  const seed = K.seedOf("banner", 300);
  assert.equal(seed, K.seedOf("banner", 300));
  assert.notEqual(seed, K.seedOf("banner", 301));
  assert.notEqual(seed, K.seedOf("crypt", 300));
  assert.ok(SRC.includes('DK.seedOf("banner", day)'));
});

test("banner: March rows keep [marches, best of 8] and merge as a join", () => {
  const A = { br: 0, rows: { a: { b: 0, s: { a: [2, 5] } } } };
  const B = { br: 0, rows: { a: { b: 0, s: { a: [3, 4], m: [1, 0] } } } };
  const ab = R.mergeBanner(A, B);
  assert.equal(J(ab), J(R.mergeBanner(B, A)));
  assert.deepEqual(ab.rows.a.s.a, [3, 5]);
  const junk = R.mergeBanner({ br: 0, rows: { x: { b: 0, s: { a: [0, 0] } }, y: { b: 0, s: { a: [1, 9] } } } }, null);
  assert.deepEqual(junk.rows, {}, "no march, or a best above 8, is refused");
});

test("banner: Last battles are a union of the newest 10, from the reset on", () => {
  const one = (a, s, m, w) => ({ a, m: m || "m", w: w === undefined ? 1 : w, t: 7, s, k: ["iron", "tide"] });
  const A = { br: 1000, rows: {}, last: [one(5000, "aa"), one(4000, "bb", "p", 0), one(900, "old")] };
  const B = { br: 1000, rows: {}, last: [one(5000, "aa"), one(4500, "cc", "r"), one(3000, "dd", "d", 0)] };
  const ab = R.mergeBanner(A, B);
  assert.equal(J(ab), J(R.mergeBanner(B, A)));
  assert.equal(J(R.mergeBanner(ab, ab)), J(ab));
  assert.deepEqual(ab.last.map((v) => v.s), ["aa", "cc", "bb", "dd"], "newest first, once each, none before the reset");
  const many = { br: 0, rows: {}, last: [] };
  for (let i = 1; i <= 14; i++) many.last.push(one(i * 10, "s" + i));
  assert.equal(R.mergeBanner(many, null).last.length, 10);
  assert.equal(R.mergeBanner(many, null).last[0].s, "s14");
  const junk = R.mergeBanner({ br: 0, rows: {}, last: [one(10, "A!"), one(10, "ok", "x"), one(10, "ok", "m", 2),
    { a: 10, m: "m", w: 1, t: 0, s: "ok", k: ["iron", "tide"] }, { a: 10, m: "m", w: 1, t: 3, s: "ok", k: ["iron", "gold"] }, "no"] }, null);
  assert.deepEqual(junk.last, [], "bad codes, modes, flags, turns and decks are refused");
  assert.deepEqual(R.mergeBanner({ br: 0, rows: {} }, null).last, [], "older data without last");
});

test("banner: a March deck list replaces the starter deck only when it is valid", () => {
  const list = E.deckList("iron").concat(["dragon", "spark"]);
  assert.ok(E.listOk(list));
  const st = E.newBattle("m1", ["iron", "ember"], 0, [list, null]);
  assert.equal(st.hand[0].length + st.deck[0].length, list.length);
  assert.equal(st.hand[1].length + st.deck[1].length, E.deckList("ember").length);
  assert.ok(!E.listOk(list.slice(0, E.MARCH_MIN - 1)), "too few cards");
  assert.ok(!E.listOk(new Array(E.MARCH_MAX + 1).fill("spark")), "too many cards");
  assert.ok(!E.listOk(list.concat(["constructor"])), "not a card");
  assert.equal(E.card("constructor"), null);
  assert.equal(E.card("__proto__"), null);
  const bad = E.newBattle("m1", ["iron", "ember"], 0, [["spark"], null]);
  assert.equal(bad.hand[0].length + bad.deck[0].length, E.deckList("iron").length, "a broken list falls back to the starter deck");
});

test("banner: deck share codes round trip, and a wrong letter is refused", () => {
  assert.equal(E.CODE_ORDER.length, Object.keys(D.CARDS).length);
  assert.ok(Object.keys(D.CARDS).every((k) => E.CODE_ORDER.includes(k)), "every card has a place in the code");
  E.DECK_IDS.forEach((d) => {
    const list = E.deckList(d), code = E.deckCode(list);
    assert.match(code, /^b[0-9a-hjkmnp-tv-z]{16}$/);
    assert.deepEqual(E.deckFromCode(code), E.sortDeck(list));
    assert.deepEqual(E.deckFromCode(" " + code.toUpperCase().replace(/(.{4})/g, "$1-") + " "), E.sortDeck(list), "case, spaces and dashes do not matter");
    for (let i = 1; i < code.length; i++) {
      const alt = code.slice(0, i) + (code[i] === "2" ? "3" : "2") + code.slice(i + 1);
      assert.equal(E.deckFromCode(alt), null, "one wrong letter at " + i);
    }
  });
  assert.equal(E.deckCode(E.deckList("iron").slice(1)), "", "19 cards is not a deck");
  assert.ok(!E.deckOk(new Array(20).fill("spark")), "at most 3 of a card");
  assert.equal(E.deckFromCode("b"), null);
  assert.equal(E.deckFromCode(null), null);
});

test("banner: own decks merge by the later change; puzzles solved merge as a max epoch", () => {
  const iron = E.deckCode(E.deckList("iron")), tide = E.deckCode(E.deckList("tide"));
  const A = { br: 5, rows: {}, decks: { abcd: { n: "Mine", c: iron, m: 100 }, efgh: { n: "Gone", c: tide, m: 50 } }, pz: { 1: 5, 3: 2, 7: 9 } };
  const B = { br: 5, rows: {}, decks: { abcd: { n: "Mine 2", c: tide, m: 200 }, efgh: { m: 60, x: 1 } }, pz: { 1: 7, 2: 6 } };
  const ab = R.mergeBanner(A, B);
  assert.equal(J(ab), J(R.mergeBanner(B, A)));
  assert.equal(J(R.mergeBanner(ab, ab)), J(ab));
  assert.deepEqual(ab.decks.abcd, { n: "Mine 2", c: tide, m: 200 });
  assert.deepEqual(ab.decks.efgh, { m: 60, x: 1 }, "a later delete wins");
  assert.deepEqual(ab.pz, { 1: 7, 2: 6, 7: 9 }, "solved before the reset drops");
  const junk = R.mergeBanner({ br: 0, rows: {}, pz: { 0: 1, 21: 1, x: 1, 4: -1 }, decks: {
    "A!": { n: "x", c: iron, m: 1 }, good: { n: "", c: iron, m: 1 }, bad1: { n: "x", c: "b123", m: 1 }, bad2: { n: "x", c: iron, m: 0 } } }, null);
  assert.deepEqual([junk.pz, junk.decks], [{}, {}], "bad numbers, ids, names, codes and times are refused");
  assert.equal(R.normDeck({ n: "  a\u0007b   c  ", c: iron, m: 3 }).n, "a b c", "names are cleaned");
  assert.equal(R.normDeck({ n: "x".repeat(40), c: iron, m: 3 }).n.length, 24);
  assert.deepEqual(R.mergeBanner({ br: 0, rows: {} }, null).decks, {}, "older data without decks");
  const many = { br: 0, rows: {}, decks: {} };
  for (let i = 0; i < 70; i++) many.decks["d" + (1000 + i)] = { m: i + 1, x: 1 };
  assert.equal(Object.keys(R.mergeBanner(many, null).decks).length, 60, "the newest 60 entries are kept");
  // Last battles with an own deck keep its code
  const last = R.mergeBanner({ br: 0, rows: {}, last: [{ a: 9, m: "m", w: 1, t: 3, s: "abc", k: ["iron", "tide"], c: [iron, ""] },
    { a: 8, m: "m", w: 1, t: 3, s: "abd", k: ["iron", "tide"], c: ["bnope", ""] }] }, null).last;
  assert.deepEqual(last.map((v) => v.c), [[iron, ""]], "a bad code is refused");
});

test("banner: an own deck plays its own cards", () => {
  const list = E.deckFromCode(E.deckCode(E.deckList("ember")));
  const st = E.newBattle("own1", ["iron", "iron"], 0, [list, null]);
  assert.deepEqual(st.hand[0].concat(st.deck[0]).sort(), list.slice().sort());
});

// The shortest way to break the red Keep this turn (breadth first over
// every action but "end", same states counted once), or -1.
function puzzleWin(st0, budget) {
  const key = (st) => JSON.stringify([st.map, st.keep, st.hand[0], st.en[0], st.rally[0],
    st.units.map((u) => [u.k, u.s, u.i, u.hp, u.mv, u.at, u.f, u.st]).sort()]);
  const seen = new Set([key(st0)]);
  let layer = [st0], depth = 0, nodes = 0;
  while (layer.length && nodes < budget) {
    const next = [];
    for (const st of layer) {
      for (const a of E.legal(st)) {
        if (a.t === "end") continue;
        const c = E.clone(st);
        if (!E.act(c, a)) continue;
        nodes++;
        if (c.over === 0) return depth + 1;
        const k = key(c);
        if (!seen.has(k)) { seen.add(k); next.push(c); }
      }
    }
    layer = next;
    depth++;
  }
  return -1;
}

test("banner: 20 puzzles, each a valid position that can be won this turn, never in one step", () => {
  const P = require("../banner/puzzles.js").LIST;
  assert.equal(P.length, 20);
  const seen = new Set();
  P.forEach((p, j) => {
    const st = E.puzzleBattle(p, j + 1);
    assert.ok(E.valid(st), "puzzle " + (j + 1) + " is a valid state");
    assert.equal(st.seed, "pz" + (j + 1));
    assert.ok(p.keep >= 1 && p.keep <= E.KEEP_HP && p.en >= 1 && p.en <= E.EN_MAX);
    const k = JSON.stringify([p.map, p.u]);
    assert.ok(!seen.has(k), "puzzle " + (j + 1) + " is not a copy");
    seen.add(k);
    const w = puzzleWin(st, 400000);
    assert.ok(w >= 3, "puzzle " + (j + 1) + " needs at least 3 steps (found " + w + ")");
  });
});

test("banner: ending the turn is not a way through a puzzle", () => {
  const st = E.puzzleBattle(require("../banner/puzzles.js").LIST[0], 1);
  E.act(st, { t: "end" });
  assert.equal(st.over, -1);
  assert.equal(st.keep[1], require("../banner/puzzles.js").LIST[0].keep);
});
