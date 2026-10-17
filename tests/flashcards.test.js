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
  const md = r() < 0.4 ? { q: [pick(r, [IMG, SND])], a: r() < 0.5 ? [SND] : [] } : undefined;
  return { id, m, k: pick(r, ["basic", "rev"]), dk: pick(r, ["d1", "d2"]), f: { q: "q" + Math.floor(r() * 5), a: "a" }, tg: [], md };
}
const IMG = "a".repeat(64) + ".jpg", SND = "b".repeat(64) + ".webm";
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
  const gen = () => Array.from({ length: 10 }, (_, k) => {
    const roll = r();
    if (roll < 0.1) return { i: "r" + Math.floor(r() * 30), u: "r" + Math.floor(r() * 30), t: 1 + Math.floor(r() * 100) };
    if (roll < 0.25) return { i: "r" + Math.floor(r() * 30), c: "n1." + Math.floor(r() * 2), t: 1 + Math.floor(r() * 100), f: pick(r, ["s", "b", "r"]) };
    return { i: "r" + Math.floor(r() * 30), c: "n1." + Math.floor(r() * 2), t: 1 + Math.floor(r() * 100), g: 1 + Math.floor(r() * 4) };
  });
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

// ---------- Wave 2: media, flags, formatting, voices ----------
test("notes keep media names per field, only valid ones, at most six", () => {
  const many = Array.from({ length: 9 }, (_, i) => String(i).repeat(64) + ".png");
  const n = C.normNote({ id: "n1", m: 1, k: "basic", f: { q: "x", a: "y" },
    md: { q: [IMG, IMG, "../evil.jpg", "A".repeat(64) + ".jpg", "c".repeat(64) + ".exe"], a: many, x: [SND] } });
  assert.deepEqual(n.md.q, [IMG]);
  assert.equal(n.md.a.length, C.MEDIA_MAX);
  assert.equal(n.md.x, undefined, "fields of another kind are dropped");
  const c = C.normNote({ id: "n2", m: 1, k: "cloze", f: { x: "{{c1::a}}" }, md: { x: [IMG], e: [SND], q: [IMG] } });
  assert.deepEqual(c.md, { x: [IMG], e: [SND] });
  assert.equal(C.normNote({ id: "n3", m: 1, f: { q: "a" }, md: { q: [] } }).md, undefined);
  const used = C.mediaInUse({ n1: n, n2: c, n4: { id: "n4", m: 2, del: 1 } });
  assert.ok(used[IMG] && used[SND] && used[many[0]]);
  assert.equal(C.mediaKind(IMG), "img");
  assert.equal(C.mediaKind(SND), "aud");
  assert.equal(C.mediaKind("x.jpg"), "");
});

test("media types, names and picture sizes", () => {
  assert.equal(C.mediaExt("image/jpeg", "a.bin"), "jpg");
  assert.equal(C.mediaExt("audio/webm;codecs=opus", ""), "webm");
  assert.equal(C.mediaExt("", "Song.MP3"), "mp3");
  assert.equal(C.mediaExt("", "photo.jpeg"), "jpg");
  assert.equal(C.mediaExt("application/x-msdownload", "a.exe"), "");
  assert.equal(C.mediaExt("image/svg+xml", "a.svg"), "", "SVG can carry scripts: not taken");
  assert.equal(C.mediaMime(SND), "audio/webm");
  assert.deepEqual(C.fitSize(4000, 3000, 1600), { w: 1600, h: 1200 });
  assert.deepEqual(C.fitSize(800, 600, 1600), { w: 800, h: 600 });
  assert.deepEqual(C.fitSize(1000, 5000, 1600), { w: 320, h: 1600 });
});

test("suspend and bury are rows: they merge, undo and leave the study queue", () => {
  let d = C.addDeck(C.empty(), "D", 1, { id: "d1", cfg: { nd: 10 } });
  const notesMap = C.foldNotes({}, [
    { id: "n1", m: 1, k: "basic", dk: "d1", f: { q: "a", a: "b" } },
    { id: "n2", m: 1, k: "basic", dk: "d1", f: { q: "c", a: "d" } }
  ]);
  const day = new Date(2026, 9, 17, 12).getTime();
  assert.deepEqual(C.normReview({ i: "r1", c: "n1.0", t: 5, f: "x" }), null);
  assert.deepEqual(C.normReview({ i: "r1", c: "n1.0", t: 5, f: "s", g: 3 }), { i: "r1", c: "n1.0", t: 5, f: "s" });
  let revs = C.mergeReviews([{ i: "ra", c: "n1.0", t: day - 1000, f: "s" }], [{ i: "rb", c: "n2.0", t: day - 500, f: "b" }]);
  let s = C.schedule(d, notesMap, revs, F);
  assert.equal(s["n1.0"].sus, true);
  assert.equal(C.cardStatus(s["n1.0"], day, 4), "sus");
  assert.equal(C.cardStatus(s["n2.0"], day, 4), "bury");
  assert.equal(C.studyQueue(d, s, revs, "d1", day).n, 0);
  // The bury ends with the study day; flags never count as answers.
  const tomorrow = day + 86400000;
  assert.equal(C.cardStatus(s["n2.0"], tomorrow, 4), "new");
  assert.deepEqual(C.studyQueue(d, s, revs, "d1", tomorrow).queue, ["n2.0"]);
  assert.equal(s["n1.0"].revs, 0);
  // Resume clears both; undo of the suspend brings the card back too.
  const resumed = C.mergeReviews(revs, [{ i: "rc", c: "n1.0", t: day, f: "r" }]);
  assert.equal(C.schedule(d, notesMap, resumed, F)["n1.0"].sus, false);
  const undone = C.mergeReviews(revs, [{ i: "rd", u: "ra", t: day }]);
  const s2 = C.schedule(d, notesMap, undone, F);
  assert.equal(s2["n1.0"].sus, false);
  assert.deepEqual(C.studyQueue(d, s2, undone, "d1", day).queue, ["n1.0"]);
  // A suspended card keeps its schedule: answers before and after still replay.
  const withAnswers = C.mergeReviews(revs, [{ i: "r0", c: "n1.0", t: day - 5000, g: 3 }]);
  assert.equal(C.schedule(d, notesMap, withAnswers, F)["n1.0"].revs, 1);
});

test("formatting: bold, italic, lists, cloze inside bold, plain text", () => {
  assert.deepEqual(C.fmtInline("a **b** *c*"), [{ t: "a " }, { t: "b", b: 1 }, { t: " " }, { t: "c", i: 1 }]);
  assert.deepEqual(C.fmtInline("2 * 3 * 4"), [{ t: "2 * 3 * 4" }], "a lone star is text");
  assert.deepEqual(C.fmtInline("**open"), [{ t: "**open" }]);
  assert.deepEqual(C.fmtBlocks("Title\n- one\n- two\n3. three\nend").map((b) => b.k), ["p", "ul", "ol", "p"]);
  assert.equal(C.fmtBlocks("1. a\n2. b")[0].start, 1);
  assert.equal(C.plain("**Bold** and *it*\n- item\n2. two"), "Bold and it\nitem\ntwo");
  const n = C.normNote({ id: "n1", m: 1, k: "cloze", f: { x: "The **{{c1::cat::animal}}** sat", e: "*extra*" } });
  const front = C.sideMarked(n, 1, false);
  assert.deepEqual(C.fmtInline(front[0].text), [{ t: "The " }, { t: "[animal]", b: 1, gap: 1 }, { t: " sat" }]);
  const back = C.sideMarked(n, 1, true);
  assert.deepEqual(back.map((p) => p.field), ["x", "e"]);
  assert.deepEqual(C.fmtInline(back[0].text)[1], { t: "cat", b: 1, ans: 1 });
  // Private-use marks typed by the user can not fake a gap.
  const sneaky = C.normNote({ id: "n2", m: 1, k: "basic", f: { q: "\uE002x\uE003", a: "" } });
  assert.deepEqual(C.fmtInline(C.sideMarked(sneaky, 0, false)[0].text), [{ t: "x" }]);
  const rev = C.normNote({ id: "n3", m: 1, k: "rev", f: { q: "Q", a: "A" } });
  assert.deepEqual(C.sideMarked(rev, 1, false), [{ field: "a", text: "A" }]);
  assert.deepEqual(C.sideMarked(rev, 1, true), [{ field: "q", text: "Q" }]);
  assert.equal(C.noteTitle(C.normNote({ id: "n4", m: 1, f: { q: "**Big** word" } })), "Big word");
});

test("read aloud: local voices only, deck language or a guess", () => {
  const voices = [
    { name: "Google ελληνικά", lang: "el-GR", localService: false },
    { name: "Local Greek", lang: "el-GR", localService: true },
    { name: "Local US", lang: "en-US", localService: true, default: true },
    { name: "Local UK", lang: "en_GB", localService: true }
  ];
  assert.equal(C.localVoice(voices, "el").name, "Local Greek");
  assert.equal(C.localVoice(voices, "en-GB").name, "Local UK");
  assert.equal(C.localVoice(voices, "en").name, "Local US");
  assert.equal(C.localVoice([voices[0]], "el"), null, "a network voice is never used");
  assert.deepEqual(C.voiceLangs(voices), ["el-GR", "en-GB", "en-US"]);
  assert.equal(C.guessLang("Καλημέρα κόσμε", "en"), "el");
  assert.equal(C.guessLang("Good morning", "de"), "de");
  assert.equal(C.guessLang("Good morning", "el"), "en");
  let d = C.addDeck(C.empty(), "Words", 1, { id: "d1", cfg: { vq: "de-DE", va: "bad lang!" } });
  assert.deepEqual(d.decks[0].cfg, { nd: 20, rd: 200, ret: 0.9, vq: "de-DE" });
  const note = C.normNote({ id: "n1", m: 1, f: { q: "Haus", a: "σπίτι" } });
  assert.equal(C.fieldLang(note, "q", d.decks[0].cfg, "en"), "de-DE");
  assert.equal(C.fieldLang(note, "a", d.decks[0].cfg, "en"), "el");
  d = C.updateDeck(d, "d1", { cfg: { vq: "" } }, 2);
  assert.equal(d.decks[0].cfg.vq, undefined, "Automatic clears the setting");
});

test("search provider leaves formatting marks out", async () => {
  const P = require("../flashcards/search.js");
  const fs = {
    ls: async () => [{ name: "aaaa1111-202610.json" }],
    readText: async () => JSON.stringify({ kind: "notes", items: [{ id: "n1", m: 1, k: "basic", f: { q: "**Bold** word", a: "- one\n- *two*" }, tg: [] }] })
  };
  global.orosFS = fs;
  try {
    const hits = await P.search({ readJSON: () => ({ decks: [] }) });
    assert.equal(hits[0].title, "Bold word");
    assert.match(hits[0].text, /^one two/);
  } finally { delete global.orosFS; }
});
