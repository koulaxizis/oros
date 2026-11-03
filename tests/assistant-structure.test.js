// Assistant sees how six more apps are organised (AS-STRUCT): app_summary
// for To-Do (one list by name), Notes (notebooks), Bookmarks (folders,
// tags), Contacts (labels), Media Shelf (kinds, statuses, tags) and
// Library (reading / finished / unread, tags) lists the app's groups
// with their counts and the items with the same target as the app's
// search provider, so each row becomes a ref for change_item. An
// unknown group name is an error that lists the real ones. Pure parts
// in node; static checks on the wiring in assistant.js and core.js.
// Run: node --test tests/

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const S = require("../assistant/summary.js");
const TODAY = "2026-11-03";

function provider(app) {
  delete require.cache[require.resolve("../" + app + "/search.js")];
  return require("../" + app + "/search.js");
}
// Every summary row's target is the one the app's own search gives
// the same item (so refs open and change the same thing).
function sameTargets(app, data, items) {
  const hits = provider(app).search({ readJSON: () => data, lang: "en" });
  const want = new Map(hits.map((h) => [JSON.stringify(h.target), h.title]));
  assert.ok(items.length > 0);
  items.forEach((it) => assert.ok(want.has(JSON.stringify(it.target)), app + ": " + JSON.stringify(it.target)));
}

const TODO = {
  lists: [
    { id: "l1", name: "Inbox", items: [
      { id: "t1", text: "Pay rent", due: "2026-11-01" },
      { id: "t2", text: "Old", done: true },
      { id: "t3", text: "Call Ann", due: TODAY, prio: 1, labels: ["g1"], subs: [{ text: "a", done: true }, { text: "b" }] }
    ] },
    { id: "l2", name: "Μουσική", items: [{ id: "t4", text: "Νέο άλμπουμ" }] }
  ],
  labels: [{ id: "g1", name: "Home", mtime: 1 }, { id: "g2", name: "Gone", mtime: 1 }],
  deleted: { g2: 5 }
};

test("args take each app's own group words and nothing else", () => {
  assert.equal(S.normArgs({ app: "todo", list: "  Μουσική " }, TODAY).list, "Μουσική");
  assert.equal(S.normArgs({ app: "notes", notebook: "Work" }, TODAY).notebook, "Work");
  const b = S.normArgs({ app: "bookmarks", folder: "Work › Tools", tag: "js" }, TODAY);
  assert.deepEqual([b.folder, b.tag], ["Work › Tools", "js"]);
  const sh = S.normArgs({ app: "shelf", kind: "Book", status: "NOW" }, TODAY);
  assert.deepEqual([sh.kind, sh.status], ["book", "now"]);
  assert.equal(S.normArgs({ app: "contacts", label: "Family" }, TODAY).label, "Family");
  assert.equal(S.normArgs({ app: "budget", list: "x", notebook: "y" }, TODAY).list, undefined);
  assert.equal(S.normArgs({ app: "kanban", notebook: "y" }, TODAY).notebook, undefined);
  ["notes", "bookmarks", "contacts", "shelf", "library"].forEach((a) => assert.ok(S.OWN[a], a));
});

test("To-Do: one list by name, open tasks first, late, labels, subtasks, targets", () => {
  const s = S.todoList(TODO, { list: "μουσικη", today: TODAY });
  assert.equal(s.list, "Μουσική");
  assert.deepEqual(s.items.map((i) => i.title), ["Νέο άλμπουμ"]);
  const t = S.todoList(TODO, { list: "Inbox", today: TODAY });
  assert.deepEqual(t.items.map((i) => i.title), ["Pay rent", "Call Ann", "Old"]);
  assert.equal(t.items[0].late, true);
  assert.deepEqual(t.items[1].labels, ["Home"]);
  assert.equal(t.items[1].subtasks, "1/2");
  assert.equal(t.items[1].priority, 1);
  assert.equal(t.items[2].done, true);
  assert.deepEqual([t.open, t.done, t.overdue, t.due_today], [2, 1, 1, 1]);
  sameTargets("todo", TODO, t.items);
  const bad = S.todoList(TODO, { list: "Books", today: TODAY });
  assert.equal(bad.ok, false);
  assert.match(bad.err, /Inbox, Μουσική/);
  assert.ok(S.preview(t, "el").length > 3);
});

const NOTES = {
  ver: 3,
  notebooks: [{ id: "n2", name: "Work", pos: 1, mtime: 1 }, { id: "n1", name: "Personal", pos: 0, mtime: 1 }, { id: "n3", name: "Old", pos: 2, mtime: 1 }],
  pages: [
    { id: "p1", nb: "n1", parent: null, title: "Recipes", text: "secret text", mtime: Date.UTC(2026, 9, 1, 12), labels: ["a"] },
    { id: "p2", nb: "n1", parent: "p1", title: "", text: "\n Pasta \nmore", mtime: 1 },
    { id: "p3", nb: "n2", parent: null, title: "Plan", text: "x" }
  ],
  labels: [{ id: "a", name: "Food", mtime: 1 }],
  tombs: { "nb:n3": 9 }
};

test("Notes: notebooks in order with page counts, labels, pages with notebook › parent, no text", () => {
  const s = S.notesBooks(NOTES, {});
  assert.deepEqual(s.notebooks, [{ name: "Personal", pages: 2 }, { name: "Work", pages: 1 }]);
  assert.deepEqual(s.labels, [{ name: "Food", n: 1 }]);
  assert.equal(s.items[1].title, "Pasta");
  assert.equal(s.items[1].where, "Personal › Recipes");
  assert.equal(s.items[0].changed, "2026-10-01");
  assert.ok(!JSON.stringify(s).includes("secret"));
  sameTargets("notes", NOTES, s.items);
  const w = S.notesBooks(NOTES, { notebook: "work" });
  assert.deepEqual(w.items.map((i) => i.title), ["Plan"]);
  const bad = S.notesBooks(NOTES, { notebook: "Old" });
  assert.equal(bad.ok, false);
  assert.match(bad.err, /Personal, Work/);
});

const BM = {
  folders: { unsorted: { name: "Unsorted", pos: 0 }, f1: { name: "Work", pos: 1 }, f2: { name: "Tools", parent: "f1", pos: 0 }, f3: { name: "Tools", pos: 2 } },
  items: {
    b1: { url: "https://a.example", title: "A", folderId: "f2", tags: ["js"], fav: true },
    b2: { url: "https://b.example", title: "B", folderId: "f1" },
    b3: { url: "https://c.example", title: "", folderId: "unsorted", tags: ["js", "read"] },
    b4: { url: "https://d.example", title: "Gone", folderId: "f1" }
  },
  deleted: { b4: 1 }
};

test("Bookmarks: folder paths with counts, tags, a folder with its subfolders, tag filter, targets", () => {
  const s = S.bookmarksFolders(BM, {});
  assert.equal(s.bookmarks, 3);
  assert.equal(s.unsorted, 1);
  assert.deepEqual(s.folders, [{ name: "Tools", bookmarks: 0 }, { name: "Work", bookmarks: 1 }, { name: "Work › Tools", bookmarks: 1 }]);
  assert.deepEqual(s.tags[0], { name: "js", n: 2 });
  assert.equal(s.items.find((i) => i.url === "https://c.example").title, "https://c.example");
  sameTargets("bookmarks", BM, s.items);
  const w = S.bookmarksFolders(BM, { folder: "work" });
  assert.deepEqual(w.items.map((i) => i.title).sort(), ["A", "B"]);
  const top = S.bookmarksFolders(BM, { folder: "Tools" });   // the whole path "Tools" wins over Work › Tools
  assert.equal(top.folder, "Tools");
  assert.deepEqual(top.items, []);
  const amb = S.bookmarksFolders({ folders: { a: { name: "A" }, b: { name: "B" }, x: { name: "T", parent: "a" }, y: { name: "T", parent: "b" } }, items: {} }, { folder: "T" });
  assert.equal(amb.ok, false);
  assert.match(amb.err, /whole path/);
  assert.deepEqual(S.bookmarksFolders(BM, { folder: "Work › Tools" }).items.map((i) => i.title), ["A"]);
  assert.equal(S.bookmarksFolders(BM, { tag: "READ" }).items.length, 1);
});

const CT = {
  labels: [{ id: "x", name: "Family" }, { id: "y", name: "Work" }],
  contacts: [
    { id: "c1", given: "Maria", family: "K", labelIds: ["x"], starred: true, phones: [{ v: "6970000000" }], emails: [{ v: "m@example.com" }] },
    { id: "c2", org: "ACME", labelIds: ["y", "zz"] },
    { id: "c3", given: "Nikos", org: "Shop" }
  ],
  deleted: []
};

test("Contacts: labels with counts, favourites, names with company and labels, never phones or e-mails", () => {
  const s = S.contactsLabels(CT, {});
  assert.deepEqual(s.labels, [{ name: "Family", n: 1 }, { name: "Work", n: 1 }]);
  assert.deepEqual([s.contacts, s.favorites, s.no_label], [3, 1, 1]);
  assert.equal(s.items[1].title, "ACME");
  assert.equal(s.items[1].org, undefined);
  assert.equal(s.items[2].org, "Shop");
  assert.ok(!/6970000000|m@example/.test(JSON.stringify(s)));
  sameTargets("contacts", CT, s.items);
  assert.deepEqual(S.contactsLabels(CT, { label: "family" }).items.map((i) => i.title), ["Maria K"]);
  assert.deepEqual(S.contactsLabels(CT, { label: "none" }).items.map((i) => i.title), ["Nikos"]);
  assert.equal(S.contactsLabels(CT, { label: "Friends" }).ok, false);
});

const SH = {
  items: [
    { id: "s1", type: "book", st: "want", title: "Dune", by: "Herbert", tags: ["sf"], m: 1 },
    { id: "s2", type: "album", st: "done", title: "Blue", rate: 9, fav: 1, m: 1 },
    { id: "s3", type: "book", st: "now", title: "Ulysses", m: 1 },
    { id: "s4", type: "film", st: "done", title: "Gone", m: 1 }
  ],
  tombs: { s4: 5 }
};

test("Media Shelf: per kind and status, tags, filters by kind (music = album), status, tag", () => {
  const s = S.shelfItems(SH, {});
  assert.equal(s.items_total, 3);
  assert.deepEqual(s.kinds.map((k) => [k.kind, k.total, k.want, k.now, k.done]), [["book", 2, 1, 1, 0], ["album", 1, 0, 0, 1]]);
  assert.equal(s.items.find((i) => i.title === "Blue").rating, 4.5);
  sameTargets("shelf", SH, s.items);
  assert.deepEqual(S.shelfItems(SH, { kind: "music" }).items.map((i) => i.title), ["Blue"]);
  assert.deepEqual(S.shelfItems(SH, { kind: "book", status: "want" }).items.map((i) => i.title), ["Dune"]);
  assert.deepEqual(S.shelfItems(SH, { tag: "SF" }).items.map((i) => i.title), ["Dune"]);
  assert.equal(S.shelfItems(SH, { status: "reading" }).ok, false);
  assert.ok(S.preview(s, "en").some((l) => /^Books: 2/.test(l)));
});

const LIB = {
  books: [
    { id: "bk1", m: 2, title: "Emma", by: "Austen", fmt: "epub", tags: ["classic"] },
    { id: "bk2", m: 2, title: "Ion", fmt: "pdf", fin: "2026-10-20" },
    { id: "bk3", m: 2, title: "New", fmt: "epub" },
    { id: "bk4", m: 2, title: "Hidden", fmt: "epub" }
  ],
  pos: { bk1: { m: 3, loc: "x", pct: 425 } },
  marks: [{ id: "h1", b: "bk1", k: "hl", q: "a quote", n: "my note", loc: "a", end: "b", m: 1 }],
  tombs: { bk4: 9 }
};

test("Library: reading / finished / unread, progress, tags, no highlights, targets", () => {
  const s = S.libraryBooks(LIB, {});
  assert.deepEqual([s.books, s.reading, s.finished, s.unread], [3, 1, 1, 1]);
  assert.equal(s.items[0].progress, "43%");
  assert.equal(s.items[1].finished, "2026-10-20");
  assert.ok(!/quote|my note/.test(JSON.stringify(s)));
  sameTargets("library", LIB, s.items);
  assert.deepEqual(S.libraryBooks(LIB, { status: "unread" }).items.map((i) => i.title), ["New"]);
  assert.deepEqual(S.libraryBooks(LIB, { tag: "Classic" }).items.map((i) => i.title), ["Emma"]);
  assert.equal(S.libraryBooks(LIB, { status: "want" }).ok, false);
});

test("previews have a line per group in EN and EL and every word exists in both and in DE", () => {
  const sums = [S.notesBooks(NOTES, {}), S.bookmarksFolders(BM, {}), S.contactsLabels(CT, {}), S.shelfItems(SH, {}), S.libraryBooks(LIB, {})];
  sums.forEach((s) => ["en", "el"].forEach((l) => {
    const lines = S.preview(s, l);
    assert.ok(lines.length >= 3, s.app);
    lines.forEach((x) => assert.ok(!/undefined/.test(x), s.app + " " + l + ": " + x));
  }));
  const src = fs.readFileSync(path.join(ROOT, "assistant/summary.js"), "utf8");
  const de = fs.readFileSync(path.join(ROOT, "i18n/de/assistant.js"), "utf8");
  const keys = ["stLists", "stNbs", "stPages", "stFolders", "stUnsorted", "stTags", "stBm", "stCt", "stFav", "stItems", "stBooks",
    "stReading", "stFinished", "stUnread", "stWant", "stNow", "stDrop", "kBook", "kFilm", "kSeries", "kAlbum", "kPodcast", "kGame"];
  keys.forEach((k) => {
    assert.equal((src.match(new RegExp("\\b" + k + ":", "g")) || []).length, 2, k);
    assert.ok(de.includes('"' + k + '"'), "de " + k);
  });
});

test("wiring: assistant.js reads each store and the tool and prompt name the new groups", () => {
  const a = fs.readFileSync(path.join(ROOT, "assistant/assistant.js"), "utf8");
  ["oros-notes-data", "oros-bookmarks-data", "oros-contacts-data", "oros-shelf-data", "oros-library-data"].forEach((k) => assert.ok(a.includes('"' + k + '"'), k));
  assert.match(a, /S\.todoList\(/);
  const c = fs.readFileSync(path.join(ROOT, "assistant/core.js"), "utf8");
  ["list:", "notebook:", "folder:", "tag:", "kind:", "status:"].forEach((k) => assert.ok(c.includes("        " + k), k));
  assert.match(c, /never guess a name/);
});
