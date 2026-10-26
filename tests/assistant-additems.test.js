// Assistant: new items in To-Do, Calendar, Budget, Notes, Bookmarks and
// Kanban (AS-ADD2, wave A1, assistant/additems.js). Items are written in
// the apps' own shape and stamps (To-Do, Budget and Kanban checked
// against the apps' own merge / canonical form: the stored copy is
// already canonical, so opening the app uploads nothing), only the
// user's own lists, boards, labels… are used, longer texts are refused,
// look-alikes start unticked, and Undo takes back only untouched items.
// Run: node --test tests/

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const A = require("../assistant/additems.js");
const BM = require("../bookmarks/core.js");
const KM = require("../kanban/model.js");
const TM = require("../todo/model.js");
const core = require("../assistant/core.js");

const NOW = 1790000000000;
const T0 = NOW - 86400000;
const CTX = { today: "2026-10-26", lang: "en", bm: BM };
const clone = (x) => JSON.parse(JSON.stringify(x));

// todo.js merge engine and canonical form (sections 2 and 2b)
const TD = (() => {
  const src = fs.readFileSync(path.join(__dirname, "..", "todo", "todo.js"), "utf8");
  const i = src.indexOf("  var ITEM_FIELDS"), j = src.indexOf("  // ---------- 3. Recurrence");
  return new Function("M",
    "var window = { OrosTodoModel: M }; var DATA_VER = 3, TOMB_LIFETIME_MS = 30 * 864e5, LANG = 'en'; var state = null;" +
    src.slice(i, j) + "\nreturn { mergeTodoStates, canonState };")(TM);
})();
// budget.js merge (sections 2-5)
const BG = (() => {
  const src = fs.readFileSync(path.join(__dirname, "..", "budget", "budget.js"), "utf8");
  const block = (from, to) => { const i = src.indexOf(from), j = src.indexOf(to, i); return src.slice(i, j); };
  return new Function(block("  var STORAGE_KEY", "  // ---------- 1.") + block("  function cmpStr(", "  function newId(") +
    block("  // ---------- 2. Money", "  // ---------- 6. Storage") + "\nreturn { mergeBudget, emptyData };")();
})();

function norm(app, items) {
  const r = A.normItems({ app, items }, CTX);
  assert.equal(r.ok, true, r.err);
  return r.items;
}

test("additems: arguments are checked, limits refused, never cut", () => {
  assert.match(A.normItems({ app: "contacts", items: [{}] }, CTX).err, /app must be one of/);
  assert.match(A.normItems({ app: "todo", items: [] }, CTX).err, /empty/);
  assert.match(A.normItems({ app: "todo", items: [{ note: "x" }] }, CTX).err, /title/);
  assert.match(A.normItems({ app: "todo", items: [{ title: "x".repeat(301) }] }, CTX).err, /301 characters; To-Do keeps 300/);
  assert.match(A.normItems({ app: "todo", items: [{ title: "a", priority: 7 }] }, CTX).err, /priority/);
  assert.match(A.normItems({ app: "todo", items: [{ title: "Milk" }, { title: " milk " }] }, CTX).err, /items\[0\] and items\[1\] are the same/);
  assert.match(A.normItems({ app: "calendar", items: [{ title: "x".repeat(81), date: "2026-11-02" }] }, CTX).err, /Calendar keeps 80/);
  assert.match(A.normItems({ app: "calendar", items: [{ title: "Dentist" }] }, CTX).err, /date is required/);
  assert.match(A.normItems({ app: "calendar", items: [{ title: "D", date: "2026-02-30" }] }, CTX).err, /real date/);
  assert.match(A.normItems({ app: "calendar", items: [{ title: "D", date: "2026-11-02", start: "10:00", end: "09:00" }] }, CTX).err, /not after start/);
  assert.match(A.normItems({ app: "calendar", items: [{ title: "D", date: "2026-11-02", reminder: 7 }] }, CTX).err, /reminder/);
  assert.match(A.normItems({ app: "budget", items: [{ amount: -3 }] }, CTX).err, /greater than 0/);
  assert.match(A.normItems({ app: "budget", items: [{ amount: 3, note: "x".repeat(141) }] }, CTX).err, /keeps 140/);
  assert.match(A.normItems({ app: "bookmarks", items: [{ url: "javascript:alert(1)" }] }, CTX).err, /http\(s\)/);
  assert.match(A.normItems({ app: "bookmarks", items: [{ url: "a.gr", labels: new Array(13).fill(0).map((_, i) => "t" + i) }] }, CTX).err, /keeps 12/);
  assert.match(A.normItems({ app: "kanban", items: [{ title: "a", note: "x".repeat(20001) }] }, CTX).err, /keeps 20000/);
  assert.equal(A.normItems({ app: "todo", items: new Array(101).fill({ title: "a" }) }, CTX).ok, false);
  assert.match(A.plan("todo", null, norm("todo", [{ title: "a" }]), CTX).err, /has not been opened on this device/);
});

// ---------- To-Do ----------
function todo() {
  return TD.canonState({
    ver: 3, sm: 0, om: 0, activeList: "l2", hideCompleted: false, deleted: {},
    labels: [{ id: "lb1", name: "Home", color: "#000", mtime: T0, om: 0, pos: 0 }],
    lists: [
      { id: "l1", name: "General", mtime: T0, om: T0, pos: 0, recurrence: null, lastReset: null, nextReset: null, items: [], fm: { name: T0, cycle: T0 } },
      { id: "l2", name: "Groceries", mtime: T0, om: T0, pos: 1, recurrence: null, lastReset: null, nextReset: null, fm: { name: T0, cycle: T0 },
        items: [{ id: "t1", text: "Milk", done: false, due: null, notes: "", labels: [], info: [], recurrence: null, mtime: T0, om: 0, pos: 0 }] }
    ]
  });
}
test("todo: tasks in todo.js's own canonical shape, a new list, look-alikes unticked, Undo", () => {
  const items = norm("todo", [
    { title: "Bread", priority: 1, labels: ["home"], subtasks: ["white", "brown"], note: "two\nloaves" },
    { title: "milk" },                                             // like t1, open
    { title: "Book flights", list: "Rome trip", date: "2026-11-02" },
    { title: "Hotel", list: "rome TRIP" }
  ]);
  const d0 = todo();
  const pl = A.plan("todo", d0, items, CTX);
  assert.equal(pl.ok, true, pl.err);
  assert.deepEqual(pl.rows[0].fields[0], ["inlist", "Groceries"], "the open list is the default");
  assert.equal(pl.rows[1].dup.id, "t1");
  assert.deepEqual(pl.rows[2].hint, { k: "newList", name: "Rome trip" });
  assert.match(A.plan("todo", d0, norm("todo", [{ title: "x", labels: ["Work"] }]), CTX).err, /no label named "Work".*Home/);

  const res = A.apply("todo", d0, items, NOW, { 1: 1 }, CTX);
  assert.equal(res.ok, true, res.err);
  assert.deepEqual(d0, todo(), "the input is never touched");
  assert.equal(res.made.length, 3);
  const d = res.data;
  assert.equal(JSON.stringify(TD.canonState(d)), JSON.stringify(d), "stored already canonical: opening To-Do changes nothing");
  assert.equal(JSON.stringify(TD.mergeTodoStates(d, d)), JSON.stringify(TD.canonState(d)));
  const gro = d.lists.find((l) => l.id === "l2"), bread = gro.items[1];
  assert.equal(bread.text, "Bread");
  assert.equal(bread.prio, 1);
  assert.deepEqual(bread.labels, ["lb1"]);
  assert.deepEqual(bread.subs.map((s) => s.text), ["white", "brown"]);
  assert.deepEqual(bread.xf, { prio: NOW, subs: NOW });
  assert.deepEqual(Object.values(bread.fm), [NOW, NOW, NOW, NOW, NOW, NOW, NOW]);
  assert.equal(gro.om, NOW);
  assert.deepEqual(gro.items.map((x) => x.pos), [0, 1]);
  const rome = d.lists.filter((l) => l.name === "Rome trip");
  assert.equal(rome.length, 1, "one new list for both tasks");
  assert.deepEqual(rome[0].items.map((x) => x.text), ["Book flights", "Hotel"]);
  assert.equal(rome[0].items[0].due, "2026-11-02");
  assert.deepEqual(rome[0].fm, { name: NOW, cycle: NOW });
  assert.equal(d.om, NOW);
  assert.deepEqual(res.made[0].target, { list: "l2", item: bread.id });

  // a device that has not seen it yet takes it whole
  const other = todo();
  other.lists[1].items[0].text = "Milk 2L"; other.lists[1].items[0].mtime = T0 + 5; other.lists[1].items[0].fm.text = T0 + 5;
  const m = TD.mergeTodoStates(TD.canonState(other), d);
  assert.ok(m.lists.find((l) => l.id === "l2").items.some((x) => x.text === "Bread"));
  assert.ok(m.lists.some((l) => l.name === "Rome trip"));

  // Undo: the tasks and the new (empty again) list go, with tombstones
  const u = A.undo("todo", d, res.undo, NOW + 10);
  assert.equal(u.ok, true, u.err);
  assert.deepEqual(u.data.lists.map((l) => l.name), ["General", "Groceries"]);
  assert.deepEqual(u.data.lists[1].items.map((x) => x.id), ["t1"]);
  assert.equal(Object.keys(u.data.deleted).length, 4);
  // changed since → nothing undone
  const ch = clone(d);
  ch.lists[1].items[1].mtime = NOW + 5;
  assert.match(A.undo("todo", ch, res.undo, NOW + 10).err, /changed since/);
});

// ---------- Calendar ----------
function cal() {
  return { ver: 1, labels: [{ id: "lbl-work", name: "Work", color: "#7aa2f7", mtime: 0 }, { id: "lx", name: "Gym", color: "#9ece6a", mtime: T0 }],
           events: [{ id: "e1", date: "2026-11-02", dateEnd: null, start: "10:00", end: null, title: "Dentist", note: "", location: "", labelId: null,
                      recur: null, remindMin: null, mtime: T0 }],
           deleted: [{ id: "zz", mtime: T0 }] };
}
test("calendar: one-off events in sanitizeEvent's shape, sorted by id, labels by any name, Undo", () => {
  const items = norm("calendar", [
    { title: "Deadline: report", date: "2026-11-10", label: "Εργασία", reminder: 1440, note: "send to Anna" },
    { title: "dentist", date: "2026-11-02", start: "10:00" },
    { title: "Trip", date: "2026-11-20", end_date: "2026-11-22", start: "22:00", end: "09:00", location: "Rome" }
  ]);
  const pl = A.plan("calendar", cal(), items, CTX);
  assert.equal(pl.ok, true, pl.err);
  assert.equal(pl.rows[1].dup.id, "e1");
  assert.deepEqual(pl.rows[1].dup.target, { id: "e1", date: "2026-11-02" });
  assert.match(A.plan("calendar", cal(), norm("calendar", [{ title: "x", date: "2026-11-01", label: "Fun" }]), CTX).err, /no label named "Fun".*Work, Gym/);
  const res = A.apply("calendar", cal(), items, NOW, { 1: 1 }, CTX);
  assert.equal(res.ok, true, res.err);
  const d = res.data;
  assert.deepEqual(d.events.map((e) => e.id), d.events.map((e) => e.id).slice().sort());
  const ev = d.events.find((e) => e.title === "Deadline: report");
  assert.deepEqual(Object.keys(ev), ["id", "date", "dateEnd", "start", "end", "title", "note", "location", "labelId", "recur", "remindMin", "mtime"]);
  assert.equal(ev.labelId, "lbl-work");
  assert.equal(ev.remindMin, 1440);
  assert.equal(ev.start, null);
  assert.equal(ev.mtime, NOW);
  const trip = d.events.find((e) => e.title === "Trip");
  assert.equal(trip.dateEnd, "2026-11-22");
  assert.equal(trip.end, "09:00");
  const u = A.undo("calendar", d, res.undo, NOW + 10);
  assert.equal(u.ok, true, u.err);
  assert.deepEqual(u.data.events.map((e) => e.id), ["e1"]);
  assert.deepEqual(u.data.deleted.map((x) => x.id), [...res.made.map((m) => m.id), "zz"].sort());
  assert.ok(u.data.deleted.filter((x) => x.id !== "zz").every((x) => x.mtime === NOW + 10));
});

// ---------- Budget ----------
function budget() {
  const d = BG.emptyData();
  d.tx.push({ id: "aa1", m: T0, d: "2026-10-20", a: 1250, k: "o", c: "o-groc", n: "Market" });
  d.cats.push({ id: "c-books", m: T0, k: "o", name: "Books", col: 3 });
  d.tombs["cat:o-fun"] = T0;
  return BG.mergeBudget(d, d);
}
test("budget: entries in normTx's shape, today by default, categories by key or name, Undo", () => {
  const items = norm("budget", [
    { amount: 12.5, category: "groceries", note: "Bread and milk", date: "2026-10-20" },     // like aa1
    { amount: "8", category: "books", note: "Novel" },
    { entry: "income", amount: 900, category: "Μισθός" }
  ]);
  const pl = A.plan("budget", budget(), items, CTX);
  assert.equal(pl.ok, true, pl.err);
  assert.equal(pl.rows[0].dup.id, "t:aa1");
  assert.deepEqual(pl.rows[2].fields.slice(0, 3), [["kind", "income"], ["amount", "900.00 EUR"], ["date", "2026-10-26"]]);
  assert.match(A.plan("budget", budget(), norm("budget", [{ amount: 3, category: "fun" }]), CTX).err, /no expense category named "fun"/);
  assert.match(A.plan("budget", budget(), norm("budget", [{ entry: "income", amount: 3, category: "books" }]), CTX).err, /no income category/);
  const res = A.apply("budget", budget(), items, NOW, { 0: 1 }, CTX);
  assert.equal(res.ok, true, res.err);
  const d = res.data;
  assert.equal(JSON.stringify(BG.mergeBudget(d, d)), JSON.stringify(d), "stored already canonical");
  const nv = d.tx.find((x) => x.n === "Novel"), sal = d.tx.find((x) => x.k === "i");
  assert.deepEqual(Object.keys(nv), ["id", "m", "d", "a", "k", "c", "n"]);
  assert.equal(nv.c, "c-books");
  assert.equal(nv.a, 800);
  assert.equal(sal.c, "i-salary");
  assert.equal(sal.d, "2026-10-26");
  assert.equal(res.made[0].sid, "t:" + res.made[0].id);
  const u = A.undo("budget", d, res.undo, NOW + 10);
  assert.equal(u.ok, true);
  assert.deepEqual(u.data.tx.map((x) => x.id), ["aa1"]);
  assert.equal(JSON.stringify(BG.mergeBudget(u.data, u.data)), JSON.stringify(u.data));
  assert.equal(u.data.tombs["tx:" + nv.id], NOW + 10);
});
test("budget: nothing stored yet (Budget saves only its first entry) starts from its own empty data", () => {
  const res = A.apply("budget", null, norm("budget", [{ amount: 3.2, note: "Coffee" }]), NOW, {}, CTX);
  assert.equal(res.ok, true, res.err);
  assert.equal(JSON.stringify(BG.mergeBudget(res.data, res.data)), JSON.stringify(res.data), "the same bytes Budget's first commit writes");
  const e = BG.emptyData();
  assert.deepEqual(Object.keys(res.data), Object.keys(e));
  assert.deepEqual(res.data.set, e.set);
});

// ---------- Notes ----------
function notes() {
  return { ver: 3,
    notebooks: [{ id: "nbW", name: "Work", mtime: T0, pos: 1 }, { id: "nbH", name: "Home", mtime: T0, pos: 0 }],
    pages: [{ id: "p1", nb: "nbH", parent: null, title: "Recipes", text: "", mtime: T0, pos: 3, labels: [], pinned: false, ct: T0, st: T0 }],
    labels: [{ id: "lw", nb: "nbW", name: "Clients", color: "#e06c75", mtime: T0, pos: 0 }],
    tombs: {} };
}
test("notes: pages as insertPage makes them, the first notebook by default, labels of that notebook, Undo", () => {
  const items = norm("notes", [
    { title: "Meeting 2026-10-26", text: "# Notes\n\n- one\n- two", notebook: "work", labels: ["clients"] },
    { title: "recipes" }
  ]);
  const pl = A.plan("notes", notes(), items, CTX);
  assert.equal(pl.ok, true, pl.err);
  assert.equal(pl.rows[1].fields[0][1], "Home");
  assert.equal(pl.rows[1].dup.id, "p1");
  assert.match(A.plan("notes", notes(), norm("notes", [{ title: "x", labels: ["clients"] }]), CTX).err, /no label named "clients".*notebook Home/);
  const res = A.apply("notes", notes(), items, NOW, {}, CTX);
  const p = res.data.pages.find((x) => x.title.startsWith("Meeting"));
  assert.deepEqual(Object.keys(p), ["id", "nb", "parent", "title", "text", "mtime", "pos", "labels", "pinned", "ct", "st"]);
  assert.equal(p.nb, "nbW");
  assert.deepEqual(p.labels, ["lw"]);
  assert.equal(p.text, "# Notes\n\n- one\n- two");
  assert.equal(p.ct, NOW);
  const r2 = res.data.pages.find((x) => x.title === "recipes");
  assert.equal(r2.pos, 4, "after the notebook's top pages");
  // no notebook at all yet → the app's own seed notebook
  const empty = { ver: 3, notebooks: [], pages: [], labels: [], tombs: {} };
  const r3 = A.apply("notes", empty, norm("notes", [{ title: "First" }]), NOW, {}, { lang: "el" });
  assert.deepEqual(r3.data.notebooks, [{ id: "nb-default", name: "Σημειώσεις", mtime: 0, pos: 0 }]);
  assert.equal(r3.data.pages[0].nb, "nb-default");
  const u = A.undo("notes", res.data, res.undo, NOW + 10);
  assert.deepEqual(u.data.pages.map((x) => x.id), ["p1"]);
  assert.deepEqual(Object.keys(u.data.tombs), res.made.map((m) => m.id).sort());
});

// ---------- Bookmarks ----------
function bookmarks() {
  return { ver: 1, items: { b1: { id: "b1", url: "https://example.org/a", title: "A", note: "", folderId: "unsorted", tags: [], status: "ok",
                                  visits: 0, lastVisit: 0, fav: false, pos: 0, added: T0, modified: T0 } },
           folders: { f1: { id: "f1", name: "Reading", pos: 1000, modified: T0 }, unsorted: { id: "unsorted", name: "unsorted", pos: 0, modified: 0 } },
           deleted: {}, settings: {} };
}
test("bookmarks: links as quickAdd stores them, the same address never twice, folders by name, Undo", () => {
  const items = norm("bookmarks", [
    { url: "http://www.example.org/a/?utm_source=x", title: "Again" },          // same page as b1
    { url: "orosapp.online/docs", title: "Docs", folder: "reading", labels: ["oros", "help"] },
    { url: "https://el.wikipedia.org/wiki/Αθήνα" }
  ]);
  const pl = A.plan("bookmarks", bookmarks(), items, CTX);
  assert.equal(pl.ok, true, pl.err);
  assert.equal(pl.rows[0].same, true);
  assert.equal(pl.rows[0].dup.id, "b1");
  assert.equal(pl.rows[2].fields[1][1], "Unsorted");
  assert.match(A.plan("bookmarks", bookmarks(), norm("bookmarks", [{ url: "a.gr", folder: "Work" }]), CTX).err, /no folder named "Work"/);
  const res = A.apply("bookmarks", bookmarks(), items, NOW, {}, CTX);   // even ticked, the same address is left out
  assert.equal(res.made.length, 2);
  const d = res.data, docs = d.items[res.made[0].id];
  assert.deepEqual(Object.keys(docs), ["id", "url", "title", "note", "folderId", "tags", "status", "visits", "lastVisit", "fav", "pos", "added", "modified"]);
  assert.equal(docs.url, "https://orosapp.online/docs");
  assert.equal(docs.folderId, "f1");
  assert.deepEqual(docs.tags, ["oros", "help"]);
  assert.equal(d.items[res.made[1].id].title, d.items[res.made[1].id].url, "no title: the address, as in the app");
  assert.deepEqual(Object.keys(d.items), Object.keys(d.items).slice().sort());
  const u = A.undo("bookmarks", d, res.undo, NOW + 10);
  assert.deepEqual(Object.keys(u.data.items), ["b1"]);
  assert.equal(Object.keys(u.data.deleted).length, 2);
});

// ---------- Kanban ----------
function kanban() {
  return KM.canonState({ ver: 5, om: 0, boardDeleted: {}, boards: [
    { id: "tpl-x", name: "Template", archived: false, mtime: T0, om: T0, deleted: {}, labels: [], columns: [{ id: "tc", name: "To Do", mtime: T0, om: T0, cards: [] }] },
    { id: "b1", name: "Book launch", archived: false, mtime: T0, om: T0, deleted: { old: T0 }, labels: [{ id: "l1", name: "Urgent", color: "#f00", mtime: T0 }],
      columns: [{ id: "c1", name: "To Do", mtime: T0, om: T0, cards: [{ id: "k1", text: "Cover", notes: "", due: null, labels: [], subtasks: [], info: [], mtime: T0, pos: 0 }] },
                { id: "c2", name: "Doing", mtime: T0, om: T0, cards: [] }] },
    { id: "b2", name: "Old", archived: true, mtime: T0, om: T0, deleted: {}, labels: [], columns: [{ id: "c9", name: "A", mtime: T0, om: T0, cards: [] }] }
  ] }, NOW);
}
test("kanban: cards as newCardObj on top of their column, live boards only, canonical, Undo", () => {
  const items = norm("kanban", [
    { title: "Press release", labels: ["urgent"], subtasks: ["draft", "send"], date: "2026-11-05" },
    { title: "Print run", column: "doing", note: "500 copies" },
    { title: "cover" }
  ]);
  const pl = A.plan("kanban", kanban(), items, CTX);
  assert.equal(pl.ok, true, pl.err);
  assert.deepEqual(pl.rows[0].fields.slice(0, 2), [["board", "Book launch"], ["column", "To Do"]], "templates are not a board to add to");
  assert.equal(pl.rows[2].dup.id, "k1");
  assert.match(A.plan("kanban", kanban(), norm("kanban", [{ title: "x", board: "Old" }]), CTX).err, /no board named "Old"/);
  assert.match(A.plan("kanban", kanban(), norm("kanban", [{ title: "x", column: "Done" }]), CTX).err, /no column named "Done".*To Do, Doing/);
  const res = A.apply("kanban", kanban(), items, NOW, { 2: 1 }, CTX);
  assert.equal(res.ok, true, res.err);
  const d = res.data;
  assert.equal(JSON.stringify(KM.canonState(d, NOW)), JSON.stringify(d), "stored already canonical");
  const b = d.boards.find((x) => x.id === "b1");
  assert.deepEqual(b.columns[0].cards.map((c) => c.text), ["Press release", "Cover"]);
  assert.deepEqual(b.columns[1].cards.map((c) => c.text), ["Print run"]);
  const pr = b.columns[0].cards[0];
  assert.deepEqual(pr.labels, ["l1"]);
  assert.equal(pr.due, "2026-11-05");
  assert.deepEqual(pr.subtasks.map((s) => [s.text, s.completed, s.m]), [["draft", false, NOW], ["send", false, NOW]]);
  assert.equal(KM.fmValid(pr), true);
  assert.equal(b.columns[0].om, NOW);
  assert.deepEqual(res.made[0].target, { board: "b1", col: "c1", card: pr.id });
  // merged with a copy that hasn't seen it: kept whole
  const m = KM.mergeKanbanStates(kanban(), d);
  assert.deepEqual(m.boards.find((x) => x.id === "b1").columns[0].cards.map((c) => c.text), ["Press release", "Cover"]);
  const u = A.undo("kanban", d, res.undo, NOW + 10);
  assert.equal(u.ok, true, u.err);
  assert.deepEqual(u.data.boards.find((x) => x.id === "b1").columns.map((c) => c.cards.map((k) => k.id)), [["k1"], []]);
  assert.deepEqual(Object.keys(u.data.boards.find((x) => x.id === "b1").deleted).sort(), ["old", ...res.made.map((x) => x.id)].sort());
});

test("tool and prompt: only the apps the user allows, with only their fields", () => {
  const t = core.toolsFor({ creates: ["todo", "budget"] }).find((x) => x.name === "create_items");
  assert.deepEqual(t.params.properties.app.enum, ["todo", "budget"]);
  const props = Object.keys(t.params.properties.items.items.properties);
  assert.ok(props.includes("amount") && props.includes("priority") && props.includes("list"));
  assert.ok(!props.includes("tax_id") && !props.includes("url") && !props.includes("board"));
  const all = core.toolsFor({ creates: ["contacts", "crm"].concat(A.APP_IDS) }).find((x) => x.name === "create_items");
  assert.equal(all.params.properties.app.enum.length, 11);
  const p = core.systemPrompt({ data: true, creates: ["kanban"] });
  assert.match(p, /To add new Kanban cards, call create_items/);
  // assistant.js knows the same apps
  const src = fs.readFileSync(path.join(__dirname, "..", "assistant", "assistant.js"), "utf8");
  assert.ok(src.includes('var ADD_IDS = ' + JSON.stringify(A.APP_IDS.filter((a) => A.CRM_IDS.indexOf(a) < 0)).replace(/,/g, ", ")));
});
