// orOS Base wave B5: Automations follow Base (BR-EV base.add /
// base.change, base/core.js events, base/app.js save). OROS_BIBLE.md
// Part VI "Base" B5.
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
global.window = global.window || {};
const C = require("../base/core.js");
const AC = require("../automations/core.js");
const read = (f) => fs.readFileSync(path.join(__dirname, "..", f), "utf8");

const NAMES = { field: "Name", grid: "Grid", cards: "Cards" };
function seed() {
  let d = C.addBase(C.empty(), "Events", 100, "b1");
  d = C.addTable(d, "b1", "Guests", 110, NAMES, { t: "t1", f: "fname", v1: "v1", v2: "v2" });
  d = C.addField(d, "t1", "Status", "select", { ch: [{ id: "o1", n: "Done", c: "red" }] }, 122, "fst");
  d = C.addField(d, "t1", "Seats", "number", {}, 123, "fseat");
  d = C.addField(d, "t1", "Twice", "formula", { expr: "{fseat}*2" }, 124, "ftw");
  return C.addRecord(d, "t1", { fname: "Ann" }, 130, "r1").data;
}

test("events: a new record, a changed field, with base › table · title", () => {
  const d = seed();
  const a = C.addRecord(d, "t1", { fname: "Bob" }, 200, "r2").data;
  assert.deepEqual(C.events(d, a), [{ ev: "base.add", key: "base:r2:a", text: "Events › Guests · Bob" }]);
  const b = C.setValues(a, "r2", { fst: "o1", fseat: 3 }, 300);
  assert.deepEqual(C.events(a, b), [
    { ev: "base.change", key: "base:r2:fseat:300", text: "Events › Guests · Bob · Seats: 3" },
    { ev: "base.change", key: "base:r2:fst:300", text: "Events › Guests · Bob · Status: Done" }
  ]);
  // cleared: the value is empty
  const c = C.setValues(b, "r2", { fst: null }, 400);
  assert.equal(C.events(b, c)[0].text, "Events › Guests · Bob · Status: ");
  // a value set to what it was: no new time, no event
  assert.deepEqual(C.events(c, C.setValues(c, "r2", { fseat: 3 }, 500)), []);
});

test("events: none for a delete, an Undo of a delete, an import, a field change or a pull", () => {
  const d = seed();
  const gone = C.remove(d, "r1", 200);
  assert.deepEqual(C.events(d, gone), [], "a delete");
  const rows = [{ kind: "recs", row: d.recs[0] }];
  assert.deepEqual(C.events(gone, C.restore(gone, rows, 300)), [], "Undo brings a record back");
  const imp = C.importRows(d, "b1", "Imported", [["Name"], ["x"], ["y"]], 400, NAMES);
  assert.deepEqual(C.events(d, imp.data), [], "records of a table made in the same save");
  const d2 = C.setValues(d, "r1", { fseat: 4 }, 450);
  const conv = C.convert(d2, "fseat", "text", {}, 500);
  const after = conv && conv.data ? conv.data : conv;
  assert.deepEqual(C.events(d2, after).filter((e) => e.ev === "base.change"), [], "a type change");
  let many = d;
  for (let i = 0; i < 30; i++) many = C.addRecord(many, "t1", { fname: "n" + i }, 600 + i).data;
  assert.equal(C.events(d, many).length, 20, "at most 20 per save");
  // base/app.js: only save() (the person's edits) emits, never sliceSet (a pull)
  const app = read("base/app.js");
  const save = app.slice(app.indexOf("function save(next, opts)"), app.indexOf("function sliceGet()"));
  assert.match(save, /emitEvents\(before, next\);/);
  const pull = app.slice(app.indexOf("function sliceSet(incoming)"), app.indexOf("function registerSync()"));
  assert.doesNotMatch(pull, /emitEvents/);
  assert.match(save, /window\.parent\.orosEvents/);
});

test("Automations: base.add and base.change are BR-EV events of Base, EN/EL/DE, and the Assistant may propose them", () => {
  for (const ev of ["base.add", "base.change"]) {
    assert.ok(AC.EVENTS.includes(ev), ev);
    assert.equal(AC.EVENT_APP[ev], "base");
    assert.deepEqual(AC.cleanWhen({ t: "event", ev, word: "Done" }), { t: "event", ev, word: "Done" });
    assert.match(read("i18n/de/automations.js"), new RegExp('"ev\\.' + ev.replace(".", "\\.") + '"'));
  }
  assert.equal(AC.whenText({ t: "event", ev: "base.change" }, "en"), "When a field changes in Base");
  assert.equal(AC.whenText({ t: "event", ev: "base.add" }, "el"), "Όταν μπαίνει εγγραφή στη Βάση");
  const rule = AC.cleanRule({ id: "r1", name: "Done", on: true, when: { t: "event", ev: "base.change", word: "status: done" },
    "do": [{ a: "notify", text: "{text}" }], m: 1 });
  const sig = { kind: "event", name: "base.change", key: "base:r2:fst:300", text: "Events › Guests · Bob · Status: Done" };
  assert.ok(AC.matches(rule, sig, Date.now()));
  assert.ok(!AC.matches(rule, Object.assign({}, sig, { text: "Events › Guests · Bob · Status: Open" }), Date.now()));
  const src = read("assistant/core.js");
  assert.match(src, /"goal\.spent", "base\.add", "base\.change"\] \}/);
});

test("comments (B5b): their own slice, merge both ways, delete and Undo", () => {
  assert.equal(C.NOTES_KEY, "oros-base-notes");
  let n = C.addNote(null, "r1", "  First\nline two ", 100, "n1").data;
  n = C.addNote(n, "r1", "Second", 200, "n2").data;
  n = C.addNote(n, "r2", "Other record", 150, "n3").data;
  assert.deepEqual(C.notesOf(n, "r1").map((x) => x.id), ["n1", "n2"]);
  assert.equal(C.notesOf(n, "r1")[0].x, "  First\nline two ", "text kept as written (para)");
  assert.equal(C.addNote(n, "r1", "   ", 300).id, null, "an empty comment is not added");
  assert.equal(C.addNote(n, "r1", "x".repeat(5000), 300).data.cs.find((c) => c.r === "r1" && c.x.length === 4000) !== undefined, true);
  const del = C.delNote(n, "n1", 400);
  assert.deepEqual(C.notesOf(del, "r1").map((x) => x.id), ["n2"]);
  assert.equal(del.cs.find((c) => c.id === "n1").x, undefined, "a deleted comment keeps no text");
  // merge is the same both ways, a delete beats the older copy
  assert.deepEqual(C.mergeNotes(n, del), C.mergeNotes(del, n));
  assert.deepEqual(C.notesOf(C.mergeNotes(n, del), "r1").map((x) => x.id), ["n2"]);
  // Undo brings it back, newer than the delete, on every device
  const back = C.undelNote(del, n.cs.find((c) => c.id === "n1"), 450);
  assert.deepEqual(C.notesOf(C.mergeNotes(del, back), "r1").map((x) => x.id), ["n1", "n2"]);
  // junk is dropped, never invented
  assert.deepEqual(C.normNotes({ cs: [{ id: "a" }, { id: "b<", r: "r1", m: 1, x: "y" }, null, { id: "c", r: "r1", m: 5, x: "" }] }).cs, []);
  // the tables' slice never holds comments: a device before B5b keeps them
  assert.equal(JSON.stringify(C.normalize(Object.assign(seed(), { cs: n.cs }))).indexOf("Second"), -1);
  const app = read("base/app.js");
  assert.match(app, /registerSlice\("base-notes", function \(\) \{ return C\.normNotes\(notes\); \}, notesSet, C\.NOTES_KEY, C\.mergeNotes\)/);
  assert.match(app, /el\("p", "rec-note-x", n\.x\)/, "text only through textContent");
  for (const k of ["cm.title", "cm.add", "cm.del", "cm.deleted", "cm.none", "cm.ph", "cm.full"]) assert.match(read("i18n/de/base.js"), new RegExp('"' + k.replace(".", "\\.") + '"'), k);
});
