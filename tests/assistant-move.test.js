// Assistant moves items to another group (AS-MOVE, "Assistant
// everywhere" wave 2): a To-Do task to another list (xf.list, top of
// the list, as To-Do's Move to), a Notes page to another notebook with
// the pages under it (labels by name), a bookmark to another folder
// (by name or path, Unsorted), a Calendar event to another calendar
// (its label). Unknown names list the real ones; Undo takes the move
// back only while nothing changed. Run: node --test tests/

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const E = require("../assistant/edits.js");
require("../assistant/edits2.js");
const M = require("../todo/model.js");

const NOW = 1790000000000;
const clone = (x) => JSON.parse(JSON.stringify(x));
function ch(args) { const r = E.normArgs(Object.assign({ ref: "r1", action: "move" }, args)); assert.equal(r.ok, true, r.err); return r; }
function run(app, data, target, args) {
  const c = ch(args);
  const p = E.plan(app, data, target, c, NOW);
  if (!p.ok) return p;
  const a = E.apply(app, data, target, c, NOW, p.before);
  assert.equal(a.ok, true, a.err);
  return a;
}

test("move takes one place word and nothing else; update refuses them", () => {
  assert.match(E.normArgs({ ref: "r1", action: "move" }).err, /list \(To-Do\), notebook \(Notes\), folder/);
  assert.match(E.normArgs({ ref: "r1", action: "move", list: "A", title: "x" }).err, /only where the item is/);
  assert.match(E.normArgs({ ref: "r1", action: "update", list: "A" }).err, /list is only for move/);
  ["todo", "calendar", "bookmarks", "notes", "kanban"].forEach((a) => assert.ok(E.actionsFor(a).includes("move"), a));
});

const TODO = () => ({
  lists: [
    { id: "l1", name: "Βιβλία", om: 5, items: [{ id: "t1", text: "Animals LP", mtime: 10, pos: 0 }, { id: "t2", text: "Ulysses", mtime: 10, pos: 1 }] },
    { id: "l2", name: "Μουσική", om: 5, items: [{ id: "t3", text: "Guitar", mtime: 10, pos: 0 }] }
  ],
  labels: [], deleted: {}
});

test("To-Do: a task to another list lands on top, stamps xf.list and both lists, undo puts it back", () => {
  const d = TODO();
  const a = run("todo", d, { list: "l1", item: "t1" }, { list: "μουσικη" });
  const l2 = a.data.lists[1];
  assert.deepEqual(l2.items.map((x) => x.id), ["t1", "t3"]);
  assert.deepEqual(a.data.lists[0].items.map((x) => x.id), ["t2"]);
  assert.ok(l2.items[0].xf.list >= NOW);
  assert.ok(a.data.lists[0].om >= NOW && l2.om >= NOW);
  assert.deepEqual(a.target, { list: "l2", item: "t1" });
  assert.deepEqual(a.rows.map((r) => [r.f, r.b, r.a]), [["list", "Βιβλία", "Μουσική"]]);
  // a device that still has the old copy merges to the moved place
  const merged = M.dedupeMoved([d.lists[0], l2].concat([]), (x, y) => (x.mtime >= y.mtime ? x : y));
  assert.ok(merged.find((l) => l.id === "l2").items.some((x) => x.id === "t1"));
  assert.ok(!merged.find((l) => l.id === "l1").items.some((x) => x.id === "t1"));
  const u = E.undo("todo", a.data, a.undo, NOW + 5);
  assert.equal(u.ok, true, u.err);
  assert.deepEqual(u.data.lists[0].items.map((x) => x.id), ["t1", "t2"]);
  assert.deepEqual(u.data.lists[1].items.map((x) => x.id), ["t3"]);
  const changed = clone(a.data); changed.lists[1].items[0].mtime += 99;
  assert.match(E.undo("todo", changed, a.undo, NOW + 5).err, /changed since/);
});

test("To-Do: unknown or same list is refused with the real names", () => {
  assert.match(E.plan("todo", TODO(), { list: "l1", item: "t1" }, ch({ list: "Ταινίες" }), NOW).err, /Its lists: Βιβλία, Μουσική/);
  assert.match(E.plan("todo", TODO(), { list: "l1", item: "t1" }, ch({ list: "Βιβλία" }), NOW).err, /already in the list/);
  assert.match(E.plan("todo", TODO(), { list: "l1", item: "t1" }, ch({ folder: "x" }), NOW).err, /list only/);
});

const NOTES = () => ({
  ver: 3,
  notebooks: [{ id: "n1", name: "Personal", pos: 0, mtime: 1 }, { id: "n2", name: "Δουλειά", pos: 1, mtime: 1 }],
  pages: [
    { id: "p1", nb: "n1", parent: null, title: "Recipes", text: "a", mtime: 10, pos: 0, labels: ["a1", "a2"] },
    { id: "p2", nb: "n1", parent: "p1", title: "Pasta", text: "b", mtime: 11, pos: 0, labels: [] },
    { id: "p3", nb: "n2", parent: null, title: "Plan", text: "c", mtime: 12, pos: 4, labels: [] }
  ],
  labels: [{ id: "a1", nb: "n1", name: "Food", mtime: 1 }, { id: "a2", nb: "n1", name: "Old", mtime: 1 }, { id: "b1", nb: "n2", name: "food", mtime: 1 }],
  tombs: {}
});

test("Notes: a page with the pages under it to another notebook, labels by name, undo", () => {
  const a = run("notes", NOTES(), { page: "p1", nb: "n1" }, { notebook: "δουλεια" });
  const p1 = a.data.pages.find((p) => p.id === "p1"), p2 = a.data.pages.find((p) => p.id === "p2");
  assert.equal(p1.nb, "n2"); assert.equal(p2.nb, "n2");
  assert.equal(p1.parent, null); assert.equal(p2.parent, "p1");
  assert.equal(p1.pos, 5);
  assert.deepEqual(p1.labels, ["b1"]);
  assert.ok(p1.st >= NOW && p1.mtime === p1.st && p1.text === "a");
  assert.match(a.note, /1 page\(s\) under it/);
  assert.match(a.note, /no label Old/);
  assert.deepEqual(a.rows.map((r) => [r.f, r.b, r.a]), [["notebook", "Personal", "Δουλειά"]]);
  const u = E.undo("notes", a.data, a.undo, NOW + 5);
  assert.equal(u.ok, true, u.err);
  const b1 = u.data.pages.find((p) => p.id === "p1");
  assert.deepEqual([b1.nb, b1.parent, b1.pos, b1.labels], ["n1", null, 0, ["a1", "a2"]]);
  assert.equal(u.data.pages.find((p) => p.id === "p2").nb, "n1");
  const ed = clone(a.data); ed.pages.find((p) => p.id === "p2").title = "x";
  assert.match(E.undo("notes", ed, a.undo, NOW + 5).err, /changed since/);
  assert.match(E.plan("notes", NOTES(), { page: "p1" }, ch({ notebook: "Nope" }), NOW).err, /Its notebooks: Personal, Δουλειά/);
});

const BM = () => ({
  folders: { unsorted: { name: "Unsorted" }, f1: { name: "Work" }, f2: { name: "Tools", parent: "f1" }, f3: { name: "Home" }, f4: { name: "Tools", parent: "f3" } },
  items: { b1: { id: "b1", url: "https://a.example", title: "A", folderId: "unsorted", modified: 10 } }, deleted: {}
});

test("Bookmarks: to a folder by path, ambiguous last name asks for the path, Unsorted, undo", () => {
  assert.match(E.plan("bookmarks", BM(), { id: "b1" }, ch({ folder: "Tools" }), NOW).err, /whole path/);
  const a = run("bookmarks", BM(), { id: "b1" }, { folder: "Work › Tools" });
  assert.equal(a.data.items.b1.folderId, "f2");
  assert.ok(a.data.items.b1.modified >= NOW);
  assert.deepEqual(a.rows.map((r) => [r.f, r.b, r.a]), [["folder", "Unsorted", "Work › Tools"]]);
  assert.equal(run("bookmarks", BM(), { id: "b1" }, { folder: "home" }).data.items.b1.folderId, "f3");   // a whole path wins
  const back = run("bookmarks", a.data, { id: "b1" }, { folder: "unsorted" });
  assert.equal(back.data.items.b1.folderId, "unsorted");
  const u = E.undo("bookmarks", a.data, a.undo, NOW + 5);
  assert.equal(u.ok, true, u.err);
  assert.equal(u.data.items.b1.folderId, "unsorted");
  assert.match(E.plan("bookmarks", BM(), { id: "b1" }, ch({ folder: "Garden" }), NOW).err, /Its folders: Home, Home › Tools, Work, Work › Tools/);
});

test("Calendar: move to another calendar sets the event's label", () => {
  const d = { events: [{ id: "e1", date: "2026-11-10", title: "Gig", labelId: "work", mtime: 10 }],
              labels: [{ id: "work", name: "Work", mtime: 1 }, { id: "home", name: "Σπίτι", mtime: 1 }], deleted: [] };
  const a = run("calendar", d, { id: "e1" }, { label: "σπιτι" });
  assert.equal(a.data.events[0].labelId, "home");
  assert.match(E.plan("calendar", d, { id: "e1" }, ch({ list: "x" }), NOW).err, /label only/);
});

test("wiring: refs move many in five apps, the tool names the place words", () => {
  const a = fs.readFileSync(path.join(__dirname, "..", "assistant/assistant.js"), "utf8");
  assert.match(a, /MANY_MOVE_APPS = \{ kanban: 1, todo: 1, notes: 1, bookmarks: 1, calendar: 1 \}/);
  const c = fs.readFileSync(path.join(__dirname, "..", "assistant/core.js"), "utf8");
  ["list:", "notebook:", "folder:"].forEach((k) => assert.ok(c.includes("        " + k + " { type: \"string\", description: \"" + (k === "list:" ? "todo" : k === "notebook:" ? "notes" : "bookmarks") + " move"), k));
});
