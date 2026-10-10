// Pure logic of the Oracle: the prophecy lists, topics from keywords
// (Greek or English, with or without accents), the same answer for
// the same question on the same day, the oracle of the day, and the
// favourites merge (sync slice "oracle").
// Run: node --test tests/
//
// The app is a browser IIFE with no exports, so the constants and
// sections 2–3 are cut out of the source and evaluated on their own.

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const W = require(path.join(__dirname, "..", "oracle/prophecies.js"));
const src = fs.readFileSync(path.join(__dirname, "..", "oracle/oracle.js"), "utf8");
function block(from, to) {
  const i = src.indexOf(from), j = src.indexOf(to, i);
  if (i < 0 || j < 0) throw new Error("missing block " + from);
  return src.slice(i, j);
}
const O = new Function("window",
  block("  var STORAGE_KEY", "  // ---------- 1.") +
  block("  function cmpStr(", "  // BOOT MARKER") +
  block("  // ---------- 2. Prophecies", "  // ---------- 4. Storage") +
  "\nreturn { TOPICS, MAX_Q, MAX_A, hash32, normQ, topicOf, dayKey, prophecy, dailyOracle," +
  " favId, normFav, mergeOracle, findFav, newestFirst };")({ ORACLE_WORDS: W });

const fav = (id, m, extra) => Object.assign({ id, m, q: "q " + id, a: "a " + id, d: "2026-10-09" }, extra || {});
const empty = () => ({ ver: 1, favs: [], tombs: {} });
const ID = (s) => O.favId("q" + s, "a" + s);

test("prophecies: every topic in both languages, unique, one finished sentence each", () => {
  ["en", "el"].forEach((l) => {
    let total = 0;
    const all = new Set();
    O.TOPICS.forEach((tp) => {
      const list = W.P[l][tp];
      assert.ok(Array.isArray(list) && list.length >= 20, l + " " + tp);
      list.forEach((s) => {
        assert.equal(typeof s, "string");
        assert.equal(s, s.trim(), s);
        assert.ok(s.length > 8 && s.length <= O.MAX_A, s);
        assert.match(s, /[.!?…»]$/, l + ": " + s);
        assert.ok(!/\s{2,}/.test(s), s);
        if (l === "el") assert.match(s, /[α-ωά-ώ]/, s);
        else assert.ok(!/[α-ωΑ-Ω]/.test(s), s);
        assert.ok(!all.has(s), "repeat: " + s);
        all.add(s);
        total++;
      });
    });
    assert.ok(total >= 130, l + " has " + total);
  });
});

test("normQ: case, accents, final sigma and punctuation do not matter", () => {
  assert.equal(O.normQ("  Θα ΠΆΡΩ την προαγωγή;; "), "θα παρω την προαγωγη");
  assert.equal(O.normQ("Πότε;"), O.normQ("ποτε"));
  assert.equal(O.normQ("ναός"), "ναοσ");
  assert.equal(O.normQ("Will I be RICH?!"), "will i be rich");
  assert.equal(O.normQ(""), "");
  assert.equal(O.normQ("?!…"), "");
  assert.equal(O.normQ(null), "");
});

test("topics: keywords in either language, any case or accent", () => {
  const cases = [
    ["When will I see the sea?", "time"], ["Πότε θα δω τη θάλασσα;", "time"], ["ποτε;", "time"],
    ["What happens tomorrow?", "time"], ["Τι θα γίνει αύριο;", "time"],
    ["Does she love me?", "love"], ["Με αγαπάει;", "love"], ["Θα παντρευτώ;", "love"], ["Is my ex coming back", "love"],
    ["Will I get the job?", "work"], ["Θα πάρω την προαγωγή;", "work"], ["Θα κερδίσω στο Λόττο;", "work"],
    ["Will it rain?", "yesno"], ["Θα βρέξει;", "yesno"], ["Should I go", "yesno"], ["Να πάω;", "yesno"],
    ["What is the meaning of life?", "general"], ["Τι είναι η ζωή;", "general"], ["Hello", "general"],
    ["Island", "general"]                         // "is" only counts at the start, as a word
  ];
  cases.forEach(([q, tp]) => assert.equal(O.topicOf(q), tp, q));
  // time is checked first: "when … love" is about time
  assert.equal(O.topicOf("When will I find love?"), "time");
});

test("prophecy: same question, same day, same answer; empty is silence", () => {
  const day = "2026-10-09";
  ["en", "el"].forEach((l) => {
    const a = O.prophecy("Θα πάρω την προαγωγή;", l, day);
    assert.deepEqual(O.prophecy("θα παρω την προαγωγη", l, day), a, "accents/case do not change it");
    assert.equal(a.topic, "work");
    assert.ok(W.P[l].work.includes(a.a));
  });
  assert.equal(O.prophecy("", "en", day), null);
  assert.equal(O.prophecy("  ?? ", "el", day), null);
  // across days the answer can change: over a month, more than one answer
  const seen = new Set();
  for (let d = 1; d <= 30; d++) seen.add(O.prophecy("Will it rain?", "en", "2026-11-" + String(d).padStart(2, "0")).a);
  assert.ok(seen.size > 5, "only " + seen.size);
  // different questions spread over the list
  const spread = new Set();
  for (let i = 0; i < 200; i++) spread.add(O.prophecy("question " + i, "el", day).a);
  assert.ok(spread.size > 20, "only " + spread.size);
  assert.equal(O.prophecy("x", "fr", day).a, O.prophecy("x", "en", day).a);
});

test("daily oracle: one per day, the same everywhere, from the lists", () => {
  const all = O.TOPICS.flatMap((tp) => W.P.el[tp]);
  assert.equal(O.dailyOracle("el", "2026-10-09"), O.dailyOracle("el", "2026-10-09"));
  assert.ok(all.includes(O.dailyOracle("el", "2026-10-09")));
  const seen = new Set();
  for (let d = 1; d <= 28; d++) seen.add(O.dailyOracle("en", "2026-02-" + String(d).padStart(2, "0")));
  assert.ok(seen.size > 15);
  assert.equal(O.dayKey(new Date(2026, 0, 5, 23, 59)), "2026-01-05");
});

test("favourites: ids are stable, valid and tell different prophecies apart", () => {
  const a = O.favId("Θα βρέξει;", "Ναι.");
  assert.equal(a, O.favId("  Θα   βρέξει; ", "Ναι."));
  assert.equal(a, O.favId("θα βρεξει", "Ναι."), "same question, other accents");
  assert.notEqual(a, O.favId("Θα βρέξει;", "Όχι."));
  assert.notEqual(a, O.favId("", "Ναι."));
  assert.ok(O.normFav({ id: a, m: 1, q: "x", a: "y" }), a);
  const ids = new Set();
  for (let i = 0; i < 2000; i++) ids.add(O.favId("q" + i, "a"));
  assert.equal(ids.size, 2000);
});

test("merge: commutative, associative, idempotent", () => {
  const A = { favs: [fav(ID(1), 5), fav(ID(2), 9)], tombs: { [ID(3)]: 3 } };
  const B = { favs: [fav(ID(1), 7, { q: "new" }), fav(ID(3), 2)], tombs: {} };
  const C = { favs: [fav(ID(4), 1)], tombs: { [ID(2)]: 9 } };
  const ab = O.mergeOracle(A, B);
  assert.deepEqual(ab, O.mergeOracle(B, A));
  assert.deepEqual(O.mergeOracle(ab, C), O.mergeOracle(A, O.mergeOracle(B, C)));
  assert.deepEqual(O.mergeOracle(ab, ab), ab);
  assert.equal(O.findFav(ab, ID(1)).q, "new");
  assert.equal(O.findFav(ab, ID(3)), null, "tomb 3 beats m 2");
  assert.equal(O.findFav(O.mergeOracle(ab, C), ID(2)), null, "delete wins ties");
  const x = fav(ID(5), 4, { a: "x" }), y = fav(ID(5), 4, { a: "y" });
  assert.deepEqual(O.mergeOracle({ favs: [x] }, { favs: [y] }), O.mergeOracle({ favs: [y] }, { favs: [x] }));
});

test("merge: Undo after unstar writes m past the tomb (R17)", () => {
  const id = ID(9);
  let d = O.mergeOracle(empty(), { favs: [fav(id, 10)], tombs: {} });
  d = O.mergeOracle(d, { favs: [], tombs: { [id]: 20 } });
  assert.equal(d.favs.length, 0);
  const other = d;
  d = O.mergeOracle(d, { favs: [fav(id, 21)], tombs: {} });
  assert.equal(d.favs.length, 1);
  assert.equal(O.mergeOracle(other, d).favs.length, 1);
  assert.equal(O.mergeOracle(other, d).tombs[id], 20);
});

test("merge: junk in, clean data out", () => {
  const ok = ID("ok"), ok2 = ID("ok2");
  const junk = {
    favs: [null, 3, "x", { id: "O123456", m: 1, a: "a" }, { id: "oabc", m: 1, a: "a" },
      { id: ok, m: -1, a: "a" }, { id: ok, m: 1.5, a: "a" }, { id: ok, m: 1, a: "   " },
      { id: ok, m: 2, q: 5, a: "  the   answer ", d: "nope" },
      { id: ok2, m: 3, q: "q".repeat(999), a: "a".repeat(999), d: "2026-10-09" }],
    tombs: { BAD: 1, [ok2 + "x"]: "1", [ID("t")]: 4, [ID("u")]: -2 }
  };
  const d = O.mergeOracle(junk, "nope");
  assert.equal(d.favs.length, 2);
  const a = O.findFav(d, ok), b = O.findFav(d, ok2);
  assert.deepEqual(a, { id: ok, m: 2, q: "", a: "the answer", d: "" });
  assert.equal(b.q.length, O.MAX_Q);
  assert.equal(b.a.length, O.MAX_A);
  assert.deepEqual(d.tombs, { [ID("t")]: 4 });
  assert.deepEqual(O.mergeOracle(null, undefined), empty());
  assert.deepEqual(O.newestFirst(O.mergeOracle({ favs: [fav(ID(1), 1), fav(ID(2), 3)] }, null).favs).map((f) => f.m), [3, 1]);
});
