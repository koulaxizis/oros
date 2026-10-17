// Flashcards wave 3: Anki packages (.apkg, old and new format), our
// read-only SQLite reader, HTML → text, templates, and text files.
// Fixtures: tests/fixtures/flashcards-anki/*.apkg, built by make.py there.
// Run: node --test tests/
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const A = require("../flashcards/anki.js");
const S = require("../flashcards/sqlite.js");
const C = require("../flashcards/core.js");
const F = require("../flashcards/fsrs.js");
const Z = require("../atelier/zip.js");
const zstd = require("../vendor/fzstd/fzstd.umd.js");

const DIR = path.join(__dirname, "fixtures", "flashcards-anki");
const deps = { zip: Z, sqlite: S, zstd };
const load = (name) => A.readPackage(new Uint8Array(fs.readFileSync(path.join(DIR, name))), deps);
const deckId = (p) => "d" + (p.join("-").toLowerCase().replace(/[^0-9a-z]/g, "") || "0");

for (const name of ["legacy.apkg", "modern.apkg"]) {
  test("Anki package " + name + ": notes, cards, decks, media and history", async () => {
    const m = await load(name);
    assert.equal(m.format, name === "modern.apkg" ? "anki21b" : "anki2");
    assert.equal(m.notes.length, 256);
    assert.deepEqual(m.decks["2001"], ["Languages", "Spanish"]);
    assert.deepEqual(Object.keys(m.media).sort(), ["pic.png", "say.mp3"]);
    const pic = await m.readMedia("pic.png");
    assert.deepEqual([...pic.slice(1, 4)], [0x50, 0x4e, 0x47], "PNG bytes, unpacked from zstd in the new format");
    assert.equal(await m.readMedia("nothere.png"), null);

    const items = A.convert(m);
    const by = (q) => items.find((it) => (it.f.q || it.f.x || "").startsWith(q));
    const dog = by("**Dog**");
    assert.equal(dog.kind, "basic");
    assert.deepEqual(dog.f, { q: "**Dog** & cat", a: "σκύλος" });
    assert.deepEqual(dog.media, { q: ["pic.png"], a: ["say.mp3"] });
    assert.equal(by("casa").kind, "rev", "two mirrored templates make one reversed note");
    const cz = by("{{c1::");
    assert.equal(cz.kind, "cloze");
    assert.equal(cz.f.e, "- capital\n- old");
    assert.deepEqual(cz.cards.map((c) => c.ord), [1, 2], "Anki cloze ord k is our ord k+1");
    const vocab = items.filter((it) => it.key);
    assert.deepEqual(vocab.map((v) => [v.key, v.f.q, v.f.a]), [["t0", "gato", "cat"], ["t1", "cat", "gato"], ["t2", "*El gato duerme*", "gato"]]);
    assert.equal(by("Hi").f.q, "Hi", "script and style never come through");
    assert.ok(items.find((it) => it.f.q && it.f.q.startsWith("long ")).f.q.length > 9000, "overflow pages read");

    const p = A.plan(m, items, { now: 1790000000000, deckId, existing: {}, media: { "pic.png": "a".repeat(64) + ".jpg" } });
    assert.equal(p.notes.length, 258);
    assert.equal(p.cards, 260);
    const dogNote = p.notes.find((n) => n.f.q === "**Dog** & cat");
    assert.deepEqual(dogNote.md, { q: ["a".repeat(64) + ".jpg"] }, "media without a stored file are left out");
    assert.equal(dogNote.dk, "dlanguagesspanish");
    assert.equal(p.notes.find((n) => n.f.q === "Hi").dk, "dlanguagesspanish", "a card in a filtered deck goes back to its home deck");
    assert.equal(p.notes.find((n) => n.k === "rev").dk, "dlanguagesspanish", "deck of the first card");
    // History: manual (ease 0) and filtered-without-rescheduling rows are left out.
    assert.equal(p.answers, 5);
    const sus = p.rows.filter((r) => r.f);
    assert.equal(sus.length, 1);
    assert.equal(sus[0].c, cz.cards[1] && A.noteIdFor(cz.guid) + ".2");
    p.notes.forEach((n) => assert.ok(C.normNote(n), "every note is valid: " + n.id));
    p.rows.forEach((r) => assert.ok(C.normReview(r), "every row is valid: " + r.i));

    // The schedule goes on from Anki's answers.
    const slice = C.addDeck(C.empty(), "Spanish", 1, { id: "dlanguagesspanish" });
    const notesMap = C.foldNotes({}, p.notes);
    const sched = C.schedule(slice, notesMap, C.mergeReviews(p.rows, []), F);
    const dogKey = dogNote.id + ".0";
    assert.equal(sched[dogKey].revs, 3);
    assert.equal(sched[dogKey].card.lapses, 1);
    assert.equal(sched[A.noteIdFor(cz.guid) + ".2"].sus, true);

    // Importing again adds nothing: same ids, rows merge into the same set.
    const again = A.plan(m, items, { now: 1790000500000, deckId, existing: notesMap });
    assert.equal(again.notes.length, 0);
    assert.equal(again.skipped, 258);
    assert.equal(JSON.stringify(C.mergeReviews(p.rows, again.rows)), JSON.stringify(C.mergeReviews(p.rows, [])));
    // Without history, only the suspend flag stays.
    assert.equal(A.plan(m, items, { now: 1, deckId, existing: {}, history: false }).rows.length, 1);
  });
}

test("both formats give the same notes", async () => {
  const [a, b] = await Promise.all([load("legacy.apkg"), load("modern.apkg")]);
  const opts = { now: 5, deckId, existing: {} };
  assert.equal(JSON.stringify(A.plan(a, A.convert(a), opts)), JSON.stringify(A.plan(b, A.convert(b), opts)));
});

test("SQLite reader: columns, rowid alias, and broken files fail safely", async () => {
  const zip = Z.open(new Uint8Array(fs.readFileSync(path.join(DIR, "legacy.apkg"))));
  const db = await zip.bytes("collection.anki2");
  const s = S.open(db);
  assert.deepEqual(s.tables(), ["cards", "col", "notes", "revlog"]);
  assert.deepEqual(S.parseColumns("CREATE TABLE x (id integer NOT NULL PRIMARY KEY, \"a b\" text, [c] int, PRIMARY KEY (id))").names, ["id", "a b", "c"]);
  assert.equal(S.parseColumns("create table y (id integer primary key, v)").rowidAlias, 0);
  assert.equal(S.parseColumns("create table y (id integer primary key, v) without rowid").rowidAlias, -1);
  assert.equal(s.rows("notes")[0].id, 1, "INTEGER PRIMARY KEY reads back as the rowid");
  assert.throws(() => S.open(new Uint8Array(1000)), /sqlite/);
  assert.throws(() => S.open(db.slice(0, 600)), /sqlite/);
  // Random damage: every result is an error or rows, never a hang or a crash of another kind.
  let seed = 7;
  const rnd = () => (seed = (seed * 1103515245 + 12345) >>> 0) / 4294967296;
  for (let k = 0; k < 150; k++) {
    const bad = db.slice();
    for (let j = 0; j < 20; j++) bad[100 + Math.floor(rnd() * (bad.length - 100))] = Math.floor(rnd() * 256);
    try { const x = S.open(bad); x.tables().forEach((t) => x.rows(t)); }
    catch (e) { assert.ok(e instanceof Error); }
  }
});

test("Anki HTML becomes our text: marks, lists, media, entities, nothing runs", () => {
  const r = A.htmlToText('<div><b>Bold</b> and <i>it</i>&nbsp;&amp; &lt;x&gt; &#916; &#x3a9;</div><div>next<br>line</div>' +
    '<ol><li>one</li><li>two</li></ol><img src="a.jpg" onerror="alert(1)"><script>evil()</script>[sound:b.mp3]<iframe src="x"></iframe>');
  assert.equal(r.text, "**Bold** and *it* & <x> Δ Ω\nnext\nline\n1. one\n2. two");
  assert.deepEqual(r.media.sort(), ["a.jpg", "b.mp3"]);
  assert.equal(A.htmlToText("<b></b>x").text, "x");
  assert.equal(A.htmlToText("a  \n  b").text, "a b");
});

test("templates: fields, sections, FrontSide, type: left out", () => {
  const f = { Front: "Q", Back: "A", Empty: "" };
  assert.equal(A.render("{{Front}}{{#Back}}+{{Back}}{{/Back}}{{#Empty}}no{{/Empty}}{{^Empty}}!{{/Empty}}", f), "Q+A!");
  assert.equal(A.render("{{FrontSide}}|{{type:Back}}|{{text:Back}}|{{Missing}}", f, "FS"), "FS||A|");
  assert.equal(A.backOnly("{{FrontSide}}\n<hr id=answer>\n{{Back}}"), "\n{{Back}}");
  assert.equal(A.backOnly("{{FrontSide}}{{Back}}"), "{{Back}}");
});

test("protobuf reader", () => {
  const msg = new Uint8Array([0x08, 0x96, 0x01, 0x12, 0x02, 0x68, 0x69, 0x12, 0x00]);
  const p = A.proto(msg);
  assert.equal(p[1][0], 150);
  assert.equal(p[2].length, 2);
  assert.throws(() => A.proto(new Uint8Array([0x12, 0x05, 0x01])), /proto/);
});

test("text files: Anki plain text, CSV with quotes, Quizlet tabs, cloze found", () => {
  const anki = A.parseText("#separator:tab\n#html:true\n#tags column:3\n<b>perro</b>\tdog\tanimal es\ngato\tcat\t\n");
  assert.equal(anki.sep, "\t");
  assert.equal(anki.tagsCol, 2);
  const n1 = A.textNotes(anki, { front: 0, back: 1, tags: anki.tagsCol, kind: "rev", html: anki.html });
  assert.deepEqual(n1[0], { k: "rev", f: { q: "**perro**", a: "dog" }, tg: ["animal", "es"] });
  const csv = A.parseText('Front,Back\n"a, b","line1\nline2"\n"say ""hi""",x\n');
  assert.equal(csv.sep, ",");
  const n2 = A.textNotes(csv, { front: 0, back: 1, tags: -1, kind: "basic", header: true });
  assert.deepEqual(n2.map((n) => n.f), [{ q: "a, b", a: "line1\nline2" }, { q: "say \"hi\"", a: "x" }]);
  const q = A.parseText("term1\tdef1\nterm2\tdef2");
  assert.equal(A.textNotes(q, { front: 0, back: 1, tags: -1 }).length, 2);
  const cz = A.textNotes(A.parseText("The {{c1::sun}} is hot;extra"), { front: 0, back: 1, tags: -1 });
  assert.deepEqual(cz[0], { k: "cloze", f: { x: "The {{c1::sun}} is hot", e: "extra" }, tg: [] });
});
