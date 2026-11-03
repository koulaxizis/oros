// Assistant: change_item in Music (playlists) and Flashcards (decks,
// notes) ("Assistant everywhere" wave 5b, AS-EDIT5, assistant/edits4.js).
// Written through the apps' own cores; a Flashcards note change is a new
// version in the Assistant's OWN notes file (one writer per file), and
// the newest version wins in Flashcards' merge.
// Run: node --test tests/

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const E = require("../assistant/edits.js");
const E4 = require("../assistant/edits4.js");
const MU = require("../music/core.js").OrosMusicCore;
const FC = require("../flashcards/core.js");

const NOW = 1790000000000;
const T0 = NOW - 5 * 86400000;
const J = (x) => JSON.stringify(x);
function ok(args) { const r = E.normArgs(Object.assign({ ref: "r1" }, args)); assert.equal(r.ok, true, r.err); return r; }
function run(app, data, target, args, now) {
  const ch = ok(args);
  const p = E.plan(app, data, target, ch, now || NOW);
  if (!p.ok) return p;
  const a = E.apply(app, data, target, ch, now || NOW, p.before);
  assert.equal(a.ok, true, a.err);
  return Object.assign(a, { plan: p });
}
function rows(r) { const o = {}; r.rows.forEach((x) => { o[x.f] = [x.b, x.a]; }); return o; }

test("wave 5b apps are registered", () => {
  assert.ok(E.LAZY_IDS.includes("music") && E.LAZY_IDS.includes("flashcards"));
  assert.equal(E.storageKey("flashcards"), "disk:flashcards");
  assert.deepEqual(E.actionsFor("flashcards"), ["update", "move"]);
  assert.equal(E.normArgs({ ref: "r1", action: "move", deck: "Greek" }).ok, true);
  assert.equal(E.normArgs({ ref: "r1", action: "update", deck: "Greek" }).ok, false);
  assert.equal(E.normArgs({ ref: "r1", action: "update", front: "x".repeat(20001) }).ok, false);
});

// ---------- Music ----------
const K1 = "l:abcdef01", K2 = "l:abcdef02", K3 = "l:abcdef03";
function music() {
  E4.setCache("music", {
    [K1]: { k: K1, t: "Song one", a: "Band", al: "Album", n: 1, d: 200 },
    [K2]: { k: K2, t: "Song two", a: "Band", al: "Album", n: 2 },
    [K3]: { k: K3, t: "Other", a: "Solo" }
  });
  return MU.mergeMusic({ ver: 1, likes: [], pls: [{ id: "p0000000001", m: T0, n: "Road trip", it: [{ k: K3, t: "Other", a: "Solo" }] }], tombs: {} }, {});
}
test("music: rename, add a song, add an album in track order, take a song out, undo", () => {
  const d = music();
  const r = run("music", d, { pl: "p0000000001" }, { action: "update", title: "Summer" });
  assert.equal(r.data.pls[0].n, "Summer");
  assert.equal(J(MU.mergeMusic(r.data, r.data)), J(r.data), "canonical");
  const a = run("music", d, { track: K1 }, { action: "update", playlist: "road TRIP" });
  assert.deepEqual(a.data.pls[0].it.map((x) => x.k), [K3, K1]);
  assert.equal(a.data.pls[0].it[1].d, 200);
  assert.deepEqual(rows(a).songs, [1, 2]);
  const al = run("music", d, { album: MU.albumKey({ a: "Band", al: "Album" }) }, { action: "update", playlist: "Road trip" });
  assert.deepEqual(al.data.pls[0].it.map((x) => x.k), [K3, K1, K2]);
  assert.match(run("music", a.data, { track: K1 }, { action: "update", playlist: "Road trip" }, NOW + 5).err, /already in the playlist/);
  assert.match(run("music", d, { track: K1 }, { action: "update", playlist: "Gym" }).err, /no playlist named "Gym".*Road trip/);
  const o = run("music", d, { track: K3 }, { action: "update", from_playlist: "Road trip" });
  assert.deepEqual(o.data.pls[0].it, []);
  assert.match(run("music", d, { track: K1 }, { action: "update", from_playlist: "Road trip" }).err, /not in the playlist/);
  const u = E.undo("music", a.data, a.undo, NOW + 10);
  assert.equal(u.ok, true, u.err);
  assert.deepEqual(u.data.pls[0].it.map((x) => x.k), [K3]);
  assert.ok(u.data.pls[0].m > a.data.pls[0].m);
  const a2 = run("music", a.data, { pl: "p0000000001" }, { action: "update", title: "X" }, NOW + 5);
  assert.equal(E.undo("music", a2.data, a.undo, NOW + 10).ok, false);
});

// ---------- Flashcards ----------
function fc() {
  const slice = FC.normalize({ ver: 1, decks: [{ id: "d0", m: T0, n: "Default" }, { id: "dgreek1", m: T0, n: "Greek" }], set: { m: 0, ro: 4 }, tombs: {} });
  const notes = [{ id: "nabc1", m: T0, k: "basic", dk: "d0", f: { q: "Cat", a: "Γάτα" }, tg: ["animals"] },
                 { id: "nabc2", m: T0, k: "cloze", dk: "dgreek1", f: { x: "The {{c1::sun}} rises", e: "" }, tg: [] }];
  return { slice, notes, own: { path: FC.notesPath("asst0001", NOW), items: [] } };
}
test("flashcards: a note's back and tags as a new version in the Assistant's own file; the newest wins", () => {
  const d = fc();
  const r = run("flashcards", d, { note: "nabc1" }, { action: "update", back: "Η γάτα", labels: ["animals", "greek words"] });
  assert.equal(r.data.own.items.length, 1);
  const v = r.data.own.items[0];
  assert.equal(v.f.a, "Η γάτα");
  assert.deepEqual(v.tg, ["animals", "greek_words"]);
  assert.ok(v.m > T0);
  assert.equal(r.plan.title, "Cat");
  // The app folds every file: its own (old version) and the Assistant's (new)
  const map = FC.foldNotes(FC.foldNotes({}, d.notes), r.data.own.items);
  assert.equal(map.nabc1.f.a, "Η γάτα");
  assert.equal(FC.readFile(FC.writeFile("notes", "asst0001", r.data.own.items), "notes").length, 1);
  assert.match(run("flashcards", d, { note: "nabc2" }, { action: "update", front: "no gap" }).err, /needs at least one gap/);
  const c = run("flashcards", d, { note: "nabc2" }, { action: "update", front: "The {{c1::moon}} rises" });
  assert.equal(c.data.own.items[0].f.x, "The {{c1::moon}} rises");
  const u = E.undo("flashcards", r.data, r.undo, NOW + 10);
  assert.equal(u.ok, true, u.err);
  const back = FC.foldNotes({}, u.data.own.items).nabc1;
  assert.equal(back.f.a, "Γάτα");
  assert.ok(back.m > v.m);
  const noDisk = Object.assign({}, d, { own: null });
  assert.match(run("flashcards", noDisk, { note: "nabc1" }, { action: "update", back: "x" }).err, /disk is not reachable/);
});
test("flashcards: move a note to another deck by name, rename a deck in the slice", () => {
  const d = fc();
  const m = run("flashcards", d, { note: "nabc1" }, { action: "move", deck: "greek" });
  assert.equal(m.data.own.items[0].dk, "dgreek1");
  assert.deepEqual(rows(m).deck, ["Default", "Greek"]);
  assert.match(run("flashcards", d, { note: "nabc1" }, { action: "move", deck: "Spanish" }).err, /no deck named "Spanish"/);
  const r = run("flashcards", d, { deck: "dgreek1" }, { action: "update", title: "Ελληνικά" });
  const dk = r.data.slice.decks.find((x) => x.id === "dgreek1");
  assert.equal(dk.n, "Ελληνικά");
  assert.equal(J(FC.normalize(r.data.slice)), J(r.data.slice));
  assert.equal(r.data.own.items.length, 0, "a deck change writes no note");
  const u = E.undo("flashcards", r.data, r.undo, NOW + 10);
  assert.equal(u.data.slice.decks.find((x) => x.id === "dgreek1").n, "Greek");
});
