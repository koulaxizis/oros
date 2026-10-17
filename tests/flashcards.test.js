// Flashcards: data model, sync merges (fuzz) and the study queue.
// Run: node --test tests/
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const C = require("../flashcards/core.js");
const F = require("../flashcards/fsrs.js");

// A small seeded random generator, so a failure can be replayed.
function rng(seed) {
  let s = seed >>> 0 || 1;
  return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
}
const pick = (r, a) => a[Math.floor(r() * a.length)];
const J = (x) => JSON.stringify(x);

// ---------- Decks (the slice) ----------
function randomSlice(r) {
  let d = C.empty();
  const ids = ["d1", "d2", "d3", "d4"];
  for (let i = 0; i < 6; i++) {
    const id = pick(r, ids), t = 1 + Math.floor(r() * 50);
    const roll = r();
    if (roll < 0.5) d = C.addDeck(d, pick(r, ["Greek", "Words", "Λέξεις", ""]), t, { id, par: r() < 0.3 ? pick(r, ids) : undefined });
    else if (roll < 0.7) d = C.updateDeck(d, id, { n: "x" + Math.floor(r() * 3), cfg: { ret: pick(r, [0.8, 0.9, 0.95]) } }, t);
    else if (roll < 0.85) d = C.removeDeck(d, id, t);
    else d = C.setDayStart(d, Math.floor(r() * 24), t);
  }
  return d;
}

test("deck merge is symmetric, idempotent and associative (fuzz)", () => {
  const r = rng(7);
  for (let i = 0; i < 400; i++) {
    const a = randomSlice(r), b = randomSlice(r), c = randomSlice(r);
    assert.equal(C.serialize(C.merge(a, b)), C.serialize(C.merge(b, a)));
    assert.equal(C.serialize(C.merge(a, a)), C.serialize(a));
    assert.equal(C.serialize(C.merge(C.merge(a, b), c)), C.serialize(C.merge(a, C.merge(b, c))));
    const ab = C.merge(a, b);
    assert.equal(J(C.normalize(JSON.parse(C.serialize(ab)))), J(C.normalize(ab)), "canonical (R26)");
  }
});

test("a deck delete wins ties, a newer edit brings the deck back", () => {
  const a = C.addDeck(C.empty(), "Greek", 10, { id: "d1" });
  const del = C.removeDeck(a, "d1", 20);
  assert.equal(C.merge(a, del).decks.length, 0);
  const edited = C.updateDeck(a, "d1", { n: "Greek 2" }, 30);
  assert.deepEqual(C.merge(del, edited).decks.map((x) => x.n), ["Greek 2"]);
  const same = C.updateDeck(a, "d1", { n: "same time" }, 20);
  assert.equal(C.merge(del, same).decks.length, 0);
});

test("parents never make a loop, and the tree keeps orphans", () => {
  let d = C.addDeck(C.empty(), "A", 1, { id: "da" });
  d = C.addDeck(d, "B", 2, { id: "db", par: "da" });
  d = C.updateDeck(d, "da", { par: "db" }, 3);
  assert.equal(d.decks.find((x) => x.id === "da").par, undefined);
  d = C.removeDeck(d, "da", 4);
  assert.deepEqual(C.deckTree(d).map((t) => [t.deck.id, t.depth]), [["db", 0]]);
  assert.deepEqual(Object.keys(C.subtree(C.addDeck(d, "C", 5, { id: "dc", par: "db" }), "db")).sort(), ["db", "dc"]);
});

test("broken slice input is dropped, never repaired with fresh ids or times", () => {
  const d = C.normalize({ decks: [{ id: "bad" }, null, { id: "d1", m: "x", n: 5, cfg: { nd: -3, ret: 7 } }], tombs: { z: 1, d9: "bad" }, set: { ro: 99 } });
  assert.deepEqual(d, { ver: 1, decks: [{ id: "d1", m: 0, n: "", cfg: { nd: 0, rd: 200, ret: 0.99 } }], set: { m: 0, ro: 23 }, tombs: {} });
});

// ---------- Notes and reviews ----------
function randomNote(r, id, m) {
  if (r() < 0.2) return { id, m, del: 1 };
  if (r() < 0.3) return { id, m, k: "cloze", dk: "d1", f: { x: "Η {{c1::Αθήνα}} και {{c2::Σπάρτη::πόλη}}", e: "" }, tg: ["ιστορία"] };
  return { id, m, k: pick(r, ["basic", "rev"]), dk: pick(r, ["d1", "d2"]), f: { q: "q" + Math.floor(r() * 5), a: "a" }, tg: [] };
}
test("note merge is symmetric, idempotent and associative (fuzz)", () => {
  const r = rng(11);
  const gen = () => Array.from({ length: 8 }, () => randomNote(r, pick(r, ["n1", "n2", "n3"]), 1 + Math.floor(r() * 6)));
  for (let i = 0; i < 400; i++) {
    const a = gen(), b = gen(), c = gen();
    assert.equal(J(C.mergeNotes(a, b)), J(C.mergeNotes(b, a)));
    assert.equal(J(C.mergeNotes(C.mergeNotes(a, b), C.mergeNotes(a, b))), J(C.mergeNotes(a, b)));
    assert.equal(J(C.mergeNotes(C.mergeNotes(a, b), c)), J(C.mergeNotes(a, C.mergeNotes(b, c))));
  }
});

test("review merge is a union, nothing is ever lost (fuzz)", () => {
  const r = rng(13);
  const gen = () => Array.from({ length: 10 }, (_, k) => r() < 0.1
    ? { i: "r" + Math.floor(r() * 30), u: "r" + Math.floor(r() * 30), t: 1 + Math.floor(r() * 100) }
    : { i: "r" + Math.floor(r() * 30), c: "n1." + Math.floor(r() * 2), t: 1 + Math.floor(r() * 100), g: 1 + Math.floor(r() * 4) });
  for (let i = 0; i < 400; i++) {
    const a = gen(), b = gen(), c = gen();
    const ab = C.mergeReviews(a, b);
    assert.equal(J(ab), J(C.mergeReviews(b, a)));
    assert.equal(J(C.mergeReviews(ab, ab)), J(ab));
    assert.equal(J(C.mergeReviews(ab, c)), J(C.mergeReviews(a, C.mergeReviews(b, c))));
    const ids = new Set(ab.map((x) => x.i));
    a.concat(b).forEach((x) => assert.ok(ids.has(x.i)));
  }
});

// Three devices study and edit offline in any order, then copy each
// other's files the way Vault Drive does (a file has ONE writer, so a
// copy only ever replaces an older copy of the same file).
test("three devices: every answer survives and the schedules agree (simulation)", () => {
  for (let run = 0; run < 40; run++) {
    const r = rng(100 + run);
    const devs = ["aaaa1111", "bbbb2222", "cccc3333"].map((dev) => ({ dev, files: {}, slice: C.empty() }));
    const allReviews = new Set();
    let t = Date.UTC(2026, 9, 1, 8);
    let seq = 0;
    function own(d, kind) {
      const path = (kind === "notes" ? C.notesPath : C.reviewsPath)(d.dev, t);
      const items = d.files[path] ? C.readFile(d.files[path].text, kind) : [];
      return { path, items };
    }
    function write(d, kind, item) {
      const f = own(d, kind);
      f.items.push(item);
      const old = d.files[f.path];
      d.files[f.path] = { text: C.writeFile(kind, d.dev, f.items), v: (old ? old.v : 0) + 1 };
    }
    function state(d) {
      let notes = {}, revs = [];
      Object.keys(d.files).forEach((p) => {
        if (p.startsWith(C.NOTES_DIR)) notes = C.foldNotes(notes, C.readFile(d.files[p].text, "notes"));
        else revs = C.mergeReviews(revs, C.readFile(d.files[p].text, "reviews"));
      });
      return { notes, revs };
    }
    for (let step = 0; step < 120; step++) {
      t += Math.floor(r() * 3 * 3600000);
      const d = pick(r, devs), roll = r();
      if (roll < 0.15) d.slice = C.addDeck(d.slice, "deck", t, { id: pick(r, ["d1", "d2"]) });
      else if (roll < 0.35) write(d, "notes", randomNote(r, pick(r, ["n1", "n2", "n3", "n4"]), t));
      else if (roll < 0.75) {
        const s = state(d), keys = Object.keys(C.schedule(d.slice, s.notes, s.revs, F));
        if (keys.length) {
          const row = { i: "r" + t.toString(36) + d.dev + (seq++), c: pick(r, keys), t, g: 1 + Math.floor(r() * 4) };
          write(d, "reviews", row);
          allReviews.add(row.i);
        }
      } else if (roll < 0.8) {
        const s = state(d), last = s.revs.filter((x) => !x.u).pop();
        if (last) write(d, "reviews", { i: "r" + t.toString(36) + d.dev + (seq++), u: last.i, t });
      } else {
        // Sync two devices: newer copies of each file win, slices merge.
        const a = pick(r, devs), b = pick(r, devs);
        if (a === b) continue;
        new Set(Object.keys(a.files).concat(Object.keys(b.files))).forEach((p) => {
          const x = a.files[p], y = b.files[p];
          const win = !x ? y : !y ? x : (x.v >= y.v ? x : y);
          a.files[p] = win; b.files[p] = win;
        });
        a.slice = b.slice = C.merge(a.slice, b.slice);
      }
    }
    // Everyone syncs with everyone.
    for (let k = 0; k < 2; k++) devs.forEach((a) => devs.forEach((b) => {
      if (a === b) return;
      Object.keys(b.files).forEach((p) => { if (!a.files[p] || a.files[p].v < b.files[p].v) a.files[p] = b.files[p]; });
      a.slice = C.merge(a.slice, b.slice);
    }));
    const finals = devs.map((d) => {
      const s = state(d);
      const sched = C.schedule(d.slice, s.notes, s.revs, F);
      return { revs: s.revs, sched: J(Object.keys(sched).sort().map((k) => [k, sched[k].card])) };
    });
    finals.forEach((f) => {
      assert.equal(f.sched, finals[0].sched, "same schedule on every device");
      const ids = new Set(f.revs.map((x) => x.i));
      allReviews.forEach((i) => assert.ok(ids.has(i), "answer " + i + " lost"));
    });
  }
});

// ---------- Cards ----------
test("cloze cards: one card per number, hint on the front, answer on the back", () => {
  const n = C.normNote({ id: "n1", m: 1, k: "cloze", f: { x: "{{c2::Paris::city}} is in {{c1::France}}", e: "Europe" } });
  assert.deepEqual(C.ords(n), [1, 2]);
  assert.deepEqual(C.cardText(n, 2), { front: "[city] is in France", back: "Paris is in France\n\nEurope" });
  assert.deepEqual(C.cardText(n, 1).front, "Paris is in […]");
  assert.equal(C.noteTitle(n), "Paris is in France");
  const rev = C.normNote({ id: "n2", m: 1, k: "rev", f: { q: "σκύλος", a: "dog" } });
  assert.deepEqual(C.ords(rev), [0, 1]);
  assert.deepEqual(C.cardText(rev, 1), { front: "dog", back: "σκύλος" });
  assert.deepEqual(C.ords(C.normNote({ id: "n3", m: 1, k: "cloze", f: { x: "no gaps" } })), []);
});

test("note input is cleaned: kinds, tags, control characters, unknown decks", () => {
  const n = C.normNote({ id: "n1", m: 5, k: "weird", dk: "nope", f: { q: "a\u0000b", a: 3 }, tg: ["#x", "X", "y z", 4] });
  assert.deepEqual(n, { id: "n1", m: 5, k: "basic", dk: "d0", f: { q: "ab", a: "" }, tg: ["x", "y_z"] });
  assert.equal(C.normNote({ id: "n1", m: 0 }), null);
  assert.equal(C.normReview({ i: "r1", c: "n1.0", t: 5, g: 9 }), null);
  assert.deepEqual(C.normReview({ i: "r1", c: "n1.0", t: 5, g: 3, ms: 2500.4 }), { i: "r1", c: "n1.0", t: 5, g: 3, ms: 2500 });
});

test("files: names, one writer per file, foreign files ignored", () => {
  assert.equal(C.notesPath("abcd1234", Date.UTC(2026, 9, 17)), "/internal/Flashcards/Notes/abcd1234-202610.json");
  assert.deepEqual(C.parseFileName("abcd1234-202610.json"), { dev: "abcd1234", month: "202610" });
  assert.equal(C.parseFileName("abcd1234-202610 (conflict).json"), null);
  assert.equal(C.readFile("{\"kind\":\"reviews\",\"items\":[]}", "notes"), null);
  assert.equal(C.readFile("not json", "notes"), null);
  const txt = C.writeFile("notes", "abcd1234", [{ id: "n2", m: 2, k: "basic", f: { q: "b" } }, { id: "n1", m: 1, k: "basic", f: { q: "a" } }, { id: "n1", m: 3, del: 1 }]);
  assert.deepEqual(C.readFile(txt, "notes").map((x) => [x.id, x.m]), [["n1", 3], ["n2", 2]]);
  assert.match(C.newDevId(), C.DEV_RE);
});

// ---------- Study queue ----------
test("study queue: limits per day, learning first, siblings on later days, undo", () => {
  const now = new Date(2026, 9, 17, 12).getTime();
  let slice = C.addDeck(C.empty(), "Words", now - 1e6, { id: "d1", cfg: { nd: 3, rd: 100 } });
  const notes = C.foldNotes({}, [
    { id: "n1", m: 1, k: "rev", dk: "d1", f: { q: "a", a: "b" } },
    { id: "n2", m: 1, k: "basic", dk: "d1", f: { q: "c", a: "d" } },
    { id: "n3", m: 1, k: "basic", dk: "d1", f: { q: "e", a: "f" } },
    { id: "n4", m: 1, k: "basic", dk: "d1", f: { q: "g", a: "h" } }
  ]);
  let revs = [];
  let q = C.studyQueue(slice, C.schedule(slice, notes, revs, F), revs, "d1", now);
  assert.equal(q.n, 3);
  assert.deepEqual(q.queue, ["n1.0", "n2.0", "n3.0"], "one card per note per day");
  revs = C.mergeReviews(revs, [{ i: "ra", c: "n1.0", t: now, g: 1 }]);
  q = C.studyQueue(slice, C.schedule(slice, notes, revs, F), revs, "d1", now + 1000);
  assert.equal(q.l, 1);
  assert.equal(q.n, 2, "a new card answered today counts against the limit");
  assert.equal(q.queue[0], "n1.0");
  revs = C.mergeReviews(revs, [{ i: "rb", u: "ra", t: now + 2000 }]);
  q = C.studyQueue(slice, C.schedule(slice, notes, revs, F), revs, "d1", now + 3000);
  assert.deepEqual([q.n, q.l], [3, 0], "an undone answer is as if it never happened");
});

test("day start follows the setting", () => {
  const at = new Date(2026, 9, 17, 3, 30).getTime();
  assert.equal(C.dayStart(at, 4), new Date(2026, 9, 16, 4).getTime());
  assert.equal(C.dayStart(at, 0), new Date(2026, 9, 17, 0).getTime());
  assert.equal(C.dayEnd(at, 4), new Date(2026, 9, 17, 4).getTime());
});

test("the search provider finds decks and live notes on the disk", async () => {
  const P = require("../flashcards/search.js");
  const files = {
    "aaaa1111-202610.json": C.writeFile("notes", "aaaa1111", [
      { id: "n1", m: 1, k: "basic", dk: "d1", f: { q: "σκύλος", a: "dog" } },
      { id: "n2", m: 1, k: "cloze", dk: "d1", f: { x: "{{c1::Athens}} is old" } },
      { id: "n3", m: 1, k: "basic", f: { q: "gone" } }]),
    "bbbb2222-202610.json": C.writeFile("notes", "bbbb2222", [{ id: "n3", m: 2, del: 1 }]),
    "bad.json": "{}"
  };
  globalThis.orosFS = {
    ls: async () => Object.keys(files).map((name) => ({ name, dir: false })),
    readText: async (p) => files[p.split("/").pop()]
  };
  try {
    const slice = C.addDeck(C.empty(), "Λέξεις", 1, { id: "d1" });
    const hits = await P.search({ readJSON: () => JSON.parse(C.serialize(slice)) });
    assert.deepEqual(hits.map((h) => [h.title, h.target]), [
      ["Λέξεις", { deck: "d1" }], ["σκύλος", { note: "n1" }], ["Athens is old", { note: "n2" }]]);
  } finally { delete globalThis.orosFS; }
});
