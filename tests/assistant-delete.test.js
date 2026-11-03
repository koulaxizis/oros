// Assistant deletes, one item or many at once (AS-MANYDEL, "Assistant
// everywhere" wave 3): a Notes page as Notes' own Delete (tombstone,
// the pages under it move up one level), Undo while nothing changed;
// refs delete many in Kanban, To-Do, Calendar, Notes, Bookmarks and
// Contacts on one card. Run: node --test tests/

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const E = require("../assistant/edits.js");
require("../assistant/edits2.js");

const NOW = 1790000000000;
const clone = (x) => JSON.parse(JSON.stringify(x));
function del(app, data, target) {
  const c = E.normArgs({ ref: "r1", action: "delete" });
  const p = E.plan(app, data, target, c, NOW);
  if (!p.ok) return p;
  const a = E.apply(app, data, target, c, NOW, p.before);
  assert.equal(a.ok, true, a.err);
  return a;
}
const NOTES = () => ({
  ver: 3, notebooks: [{ id: "n1", name: "Personal", pos: 0, mtime: 1 }],
  pages: [
    { id: "p0", nb: "n1", parent: null, title: "Home", text: "", mtime: 9, pos: 0, labels: [] },
    { id: "p1", nb: "n1", parent: "p0", title: "Recipes", text: "a", mtime: 10, pos: 0, labels: [] },
    { id: "p2", nb: "n1", parent: "p1", title: "Pasta", text: "b", mtime: 11, pos: 0, labels: [] },
    { id: "p3", nb: "n1", parent: "p0", title: "Plan", text: "c", mtime: 12, pos: 3, labels: [] }
  ],
  labels: [], tombs: {}
});

test("Notes: delete tombstones the page, its pages move up one level, undo restores both", () => {
  const a = del("notes", NOTES(), { page: "p1", nb: "n1" });
  assert.ok(!a.data.pages.some((p) => p.id === "p1"));
  assert.ok(a.data.tombs.p1 >= NOW);
  const p2 = a.data.pages.find((p) => p.id === "p2");
  assert.equal(p2.parent, "p0");
  assert.equal(p2.pos, 4);
  assert.ok(p2.st >= NOW && p2.text === "b");
  assert.match(a.note, /1 page\(s\) under it moved up/);
  const u = E.undo("notes", a.data, a.undo, NOW + 5);
  assert.equal(u.ok, true, u.err);
  const back = u.data.pages.find((p) => p.id === "p1");
  assert.ok(back && back.mtime > NOW && back.text === "a");
  assert.equal(u.data.tombs.p1, undefined);
  assert.equal(u.data.pages.find((p) => p.id === "p2").parent, "p1");
  const ed = clone(a.data); ed.pages.find((p) => p.id === "p2").title = "x";
  assert.match(E.undo("notes", ed, a.undo, NOW + 5).err, /changed since/);
  assert.ok(E.actionsFor("notes").includes("delete"));
});

test("many deletes plan one after the other on the same data and undo newest first", () => {
  let d = { lists: [{ id: "l1", name: "Inbox", items: [{ id: "t1", text: "a", mtime: 1 }, { id: "t2", text: "b", mtime: 1 }, { id: "t3", text: "c", mtime: 1 }] }], labels: [], deleted: {} };
  const undos = [];
  ["t1", "t3"].forEach((id) => { const a = del("todo", d, { list: "l1", item: id }); d = a.data; undos.push(a.undo); });
  assert.deepEqual(d.lists[0].items.map((x) => x.id), ["t2"]);
  undos.reverse().forEach((u) => { const r = E.undo("todo", d, u, NOW + 9); assert.equal(r.ok, true, r.err); d = r.data; });
  assert.deepEqual(d.lists[0].items.map((x) => x.id), ["t1", "t2", "t3"]);
});

test("wiring: refs delete many in six apps; the tool and help say so", () => {
  const a = fs.readFileSync(path.join(__dirname, "..", "assistant/assistant.js"), "utf8");
  assert.match(a, /MANY_DEL_APPS = \{ kanban: 1, todo: 1, calendar: 1, notes: 1, bookmarks: 1, contacts: 1 \}/);
  const c = fs.readFileSync(path.join(__dirname, "..", "assistant/core.js"), "utf8");
  assert.match(c, /delete: several items of one app at once/);
  ["assistant/help.en.txt", "assistant/help.el.txt", "i18n/de/help/assistant.txt"].forEach((f) => {
    assert.match(fs.readFileSync(path.join(__dirname, "..", f), "utf8"), /AS-MANYDEL|200/);
  });
});
