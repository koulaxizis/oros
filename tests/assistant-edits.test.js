// Assistant wave 48 (assistant/edits.js): change_item — argument
// checks, the before → after diff, each app's write under its own
// sync contract (stamps, tombstones, canonical order), the refusals,
// the conflict guard and Undo. Plus the tool and prompt wiring in
// core.js and static checks on assistant.js.
// Run: node --test tests/

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const E = require("../assistant/edits.js");
const A = require("../assistant/core.js");

const NOW = 1760000000000;
const ok = (args) => { const r = E.normArgs(args); assert.equal(r.ok, true, r.err); return r; };

// ---------- arguments ----------
test("normArgs: ref, action and fields are checked before anything is looked up", () => {
  assert.equal(E.normArgs(null).ok, false);
  assert.equal(E.normArgs({ ref: "x1", action: "delete" }).ok, false);
  assert.equal(E.normArgs({ ref: "r1", action: "explode" }).ok, false);
  assert.equal(ok({ ref: "oros:r12", action: "delete" }).ref, "r12");
  assert.equal(E.normArgs({ ref: "r1", action: "delete", title: "x" }).ok, false);    // delete takes nothing else
  assert.equal(E.normArgs({ ref: "r1", action: "complete", date: "2026-10-20" }).ok, false);
  assert.equal(E.normArgs({ ref: "r1", action: "reschedule" }).ok, false);
  assert.equal(E.normArgs({ ref: "r1", action: "reschedule", date: "2026-02-30" }).ok, false);
  assert.equal(E.normArgs({ ref: "r1", action: "reschedule", date: "2026-10-20", title: "x" }).ok, false);
  assert.equal(E.normArgs({ ref: "r1", action: "update" }).ok, false);
  assert.equal(E.normArgs({ ref: "r1", action: "update", title: "   " }).ok, false);
  assert.equal(E.normArgs({ ref: "r1", action: "update", start: "25:00" }).ok, false);
  assert.equal(E.normArgs({ ref: "r1", action: "update", amount: -3 }).ok, false);
  assert.equal(E.normArgs({ ref: "r1", action: "update", amount: "abc" }).ok, false);
  assert.equal(E.normArgs({ ref: "r1", action: "update", category: "yachts" }).ok, false);
  const u = ok({ ref: "r1", action: "update", title: " New\n name ", start: "9:30", amount: "12.505", note: "" });
  assert.deepEqual(u.set, { title: "New name", start: "09:30", amount: 1251, note: "" });
  assert.deepEqual(ok({ ref: "r2", action: "reschedule", date: "2026-10-20", start: "10:00" }).set, { date: "2026-10-20", start: "10:00" });
});

// ---------- diff ----------
test("buildDiff: only what changes, in a fixed order; a delete lists what the item had", () => {
  assert.deepEqual(E.buildDiff({ title: "A", done: false, due: "2026-10-14", note: "" },
                               { title: "A", done: true, due: "2026-10-14", note: "" }),
                   [{ f: "done", b: false, a: true }]);
  assert.deepEqual(E.buildDiff({ note: "x", title: "A" }, { note: "y", title: "B" }).map((r) => r.f), ["title", "note"]);
  assert.deepEqual(E.buildDiff({ title: "A", done: false, due: "", note: "n" }, null, true),
                   [{ f: "title", b: "A", a: null }, { f: "note", b: "n", a: null }]);
  assert.deepEqual(E.buildDiff({ a: 1 }, { a: 1 }), []);
});

// ---------- To-Do ----------
function todoData() {
  return {
    ver: 3, sm: 0, activeList: "l1", hideCompleted: false, deleted: { zz: 5, aa: 7 },
    labels: [],
    lists: [{ id: "l1", name: "Home", mtime: 1, om: 1, pos: 0, items: [
      { id: "t1", text: "Call plumber", done: false, due: "2026-10-14", notes: "", labels: [], info: [], recurrence: null,
        mtime: 100, om: 1, pos: 0, fm: { text: 100, done: 90, due: 100, notes: 0, labels: 0, info: 0, recurrence: 0 } },
      { id: "t2", text: "Water plants", done: false, due: "2026-10-15", recurrence: { every: 1, unit: "week" }, mtime: 50, pos: 1 },
      { id: "t3", text: "Old", done: true, mtime: 200, pos: 2 }                     // no fm: written by older code
    ] }]
  };
}
const alive = (it, tomb) => tomb === undefined || (it.mtime || 0) > tomb;

test("todo: complete stamps only the tick (TD-3) and never touches the stored input", () => {
  const d = todoData(), before = JSON.stringify(d);
  const ch = ok({ ref: "r1", action: "complete" });
  const pl = E.plan("todo", d, { list: "l1", item: "t1" }, ch, NOW);
  assert.equal(pl.ok, true);
  assert.equal(pl.title, "Call plumber");
  assert.deepEqual(pl.rows, [{ f: "done", b: false, a: true }]);
  assert.equal(JSON.stringify(d), before);                                   // plan is pure
  const ap = E.apply("todo", d, { list: "l1", item: "t1" }, ch, NOW, pl.before);
  assert.equal(ap.ok, true);
  assert.equal(JSON.stringify(d), before);                                   // apply returns a copy
  const it = ap.data.lists[0].items[0];
  assert.equal(it.done, true);
  assert.equal(it.fm.done, NOW);
  assert.equal(it.fm.text, 100);                                             // other fields keep their stamps
  assert.equal(it.mtime, NOW);
  // Undo: back to not done, stamped again (newer than the tick)
  const un = E.undo("todo", ap.data, ap.undo, NOW + 10);
  assert.equal(un.ok, true);
  const it2 = un.data.lists[0].items[0];
  assert.equal(it2.done, false);
  assert.equal(it2.fm.done, NOW + 10);
  // A second Undo finds the task already changed back → refused
  assert.equal(E.undo("todo", un.data, ap.undo, NOW + 20).ok, false);
});

test("todo: a task written by older code gets its field stamps spelled out from mtime first", () => {
  const d = todoData();
  const ap = E.apply("todo", d, { list: "l1", item: "t3" }, ok({ ref: "r1", action: "reopen" }), NOW);
  const it = ap.data.lists[0].items[2];
  assert.equal(it.done, false);
  assert.equal(it.fm.text, 200);           // mtime spoke for every field
  assert.equal(it.fm.done, NOW);
});

test("todo: refusals — repeating task, already done, start time, unknown task, wrong action", () => {
  const d = todoData();
  const re = E.plan("todo", d, { list: "l1", item: "t2" }, ok({ ref: "r1", action: "complete" }), NOW);
  assert.equal(re.ok, false);
  assert.match(re.err, /repeats/);
  assert.equal(E.plan("todo", d, { list: "l1", item: "t3" }, ok({ ref: "r1", action: "complete" }), NOW).ok, false);
  assert.equal(E.plan("todo", d, { list: "l1", item: "t1" }, ok({ ref: "r1", action: "reschedule", start: "10:00" }), NOW).ok, false);
  assert.equal(E.plan("todo", d, { list: "l1", item: "nope" }, ok({ ref: "r1", action: "delete" }), NOW).ok, false);
  assert.equal(E.plan("todo", d, { list: "l1", item: "t1" }, ok({ ref: "r1", action: "update", amount: 3 }), NOW).ok, false);
  assert.equal(E.plan("todo", d, { list: "l1", item: "t1" }, ok({ ref: "r1", action: "update", title: "Call plumber" }), NOW).ok, false);   // nothing changes
  assert.equal(E.plan("notes", d, {}, ok({ ref: "r1", action: "delete" }), NOW).ok, false);
});

test("todo: reschedule + update; a task moved to another list is still found", () => {
  const d = todoData();
  d.lists.push({ id: "l2", name: "Work", mtime: 1, items: [] });
  const moved = d.lists[0].items.splice(0, 1)[0];
  d.lists[1].items.push(moved);
  const ap = E.apply("todo", d, { list: "l1", item: "t1" }, ok({ ref: "r1", action: "reschedule", date: "2026-10-20" }), NOW);
  assert.equal(ap.ok, true);
  assert.equal(ap.data.lists[1].items[0].due, "2026-10-20");
  assert.deepEqual(ap.rows, [{ f: "due", b: "2026-10-14", a: "2026-10-20" }]);
  const up = E.apply("todo", ap.data, { list: "l2", item: "t1" }, ok({ ref: "r1", action: "update", title: "Call Nikos", note: "after 5" }), NOW + 1);
  assert.equal(up.data.lists[1].items[0].text, "Call Nikos");
  assert.equal(up.data.lists[1].items[0].notes, "after 5");
});

test("todo: delete tombstones (newer than the task, keys sorted); Undo brings it back alive at its place", () => {
  const d = todoData();
  const ap = E.apply("todo", d, { list: "l1", item: "t1" }, ok({ ref: "r1", action: "delete" }), NOW);
  assert.equal(ap.ok, true);
  assert.deepEqual(ap.rows.map((r) => r.f), ["title", "due"]);
  assert.equal(ap.data.lists[0].items.some((x) => x.id === "t1"), false);
  assert.deepEqual(Object.keys(ap.data.deleted), ["aa", "t1", "zz"]);
  assert.ok(ap.data.deleted.t1 > 100);
  const un = E.undo("todo", ap.data, ap.undo, NOW);       // same ms: still newer than the tombstone
  assert.equal(un.ok, true);
  const back = un.data.lists[0].items[0];
  assert.equal(back.id, "t1");
  assert.equal(un.data.deleted.t1, undefined);
  assert.ok(alive(back, ap.data.deleted.t1));
  assert.deepEqual(un.data.lists[0].items.map((x) => x.pos), [0, 1, 2]);
  assert.equal(E.undo("todo", un.data, ap.undo, NOW + 1).ok, false);       // already back
});

test("apply: the conflict guard leaves an item alone when it changed after the user saw the diff", () => {
  const d = todoData();
  const ch = ok({ ref: "r1", action: "complete" });
  const pl = E.plan("todo", d, { list: "l1", item: "t1" }, ch, NOW);
  d.lists[0].items[0].text = "Call the plumber today";      // another device, meanwhile
  const ap = E.apply("todo", d, { list: "l1", item: "t1" }, ch, NOW, pl.before);
  assert.equal(ap.ok, false);
  assert.equal(ap.conflict, true);
});

test("undo: refuses a forged or mismatched undo record", () => {
  const d = todoData();
  assert.equal(E.undo("todo", d, null, NOW).ok, false);
  assert.equal(E.undo("todo", d, { t: "del", app: "budget" }, NOW).ok, false);
  assert.equal(E.undo("todo", d, { t: "del", app: "todo", list: "l1", item: { id: "<img>" } }, NOW).ok, false);
});

// ---------- Calendar ----------
function calData() {
  return { ver: 1, labels: [], deleted: [{ id: "old", mtime: 3 }], subs: [], events: [
    { id: "e1", date: "2026-10-20", dateEnd: null, start: "10:00", end: "11:30", title: "Dentist", note: "", location: "Main st",
      labelId: null, recur: null, remindMin: null, mtime: 500 },
    { id: "e2", date: "2026-10-01", dateEnd: null, start: null, end: null, title: "Gym", note: "", location: "",
      labelId: null, recur: { freq: "weekly" }, remindMin: null, mtime: 10 },
    { id: "e3", date: "2026-10-22", dateEnd: "2026-10-24", start: null, end: null, title: "Trip", note: "", location: "",
      labelId: null, recur: null, remindMin: null, mtime: 10 }
  ] };
}
test("calendar: reschedule keeps the length; multi-day keeps its span; a new mtime wins the merge", () => {
  const d = calData();
  const ap = E.apply("calendar", d, { id: "e1", date: "2026-10-20" }, ok({ ref: "r1", action: "reschedule", date: "2026-10-21", start: "15:00" }), NOW);
  assert.equal(ap.ok, true);
  const ev = ap.data.events[0];
  assert.deepEqual([ev.date, ev.start, ev.end], ["2026-10-21", "15:00", "16:30"]);
  assert.equal(ev.mtime, NOW);
  assert.deepEqual(ap.rows.map((r) => r.f), ["date", "start", "end"]);
  const sp = E.apply("calendar", d, { ev: "e3", date: "2026-10-22" }, ok({ ref: "r1", action: "reschedule", date: "2026-10-30" }), NOW);
  assert.deepEqual([sp.data.events[2].date, sp.data.events[2].dateEnd], ["2026-10-30", "2026-11-01"]);
  // Undo puts every field back, with another fresh mtime
  const un = E.undo("calendar", ap.data, ap.undo, NOW + 5);
  assert.equal(un.ok, true);
  assert.deepEqual([un.data.events[0].date, un.data.events[0].start, un.data.events[0].end], ["2026-10-20", "10:00", "11:30"]);
  assert.equal(un.data.events[0].mtime, NOW + 5);
});
test("calendar: end before start refused; a repeating event can be renamed but not moved or deleted", () => {
  const d = calData();
  assert.equal(E.plan("calendar", d, { id: "e1" }, ok({ ref: "r1", action: "update", end: "09:00" }), NOW).ok, false);
  assert.equal(E.plan("calendar", d, { id: "e2" }, ok({ ref: "r1", action: "reschedule", date: "2026-10-02" }), NOW).ok, false);
  assert.equal(E.plan("calendar", d, { id: "e2" }, ok({ ref: "r1", action: "delete" }), NOW).ok, false);
  assert.equal(E.plan("calendar", d, { id: "e2" }, ok({ ref: "r1", action: "update", title: "Gym (Tue)" }), NOW).ok, true);
  assert.equal(E.plan("calendar", d, { id: "e1" }, ok({ ref: "r1", action: "complete" }), NOW).ok, false);
});
test("calendar: delete adds a tombstone newer than the event; Undo beats it", () => {
  const d = calData();
  const ap = E.apply("calendar", d, { id: "e1" }, ok({ ref: "r1", action: "delete" }), NOW);
  assert.equal(ap.data.events.some((e) => e.id === "e1"), false);
  const tomb = ap.data.deleted.find((x) => x.id === "e1");
  assert.ok(tomb.mtime > 500);
  const un = E.undo("calendar", ap.data, ap.undo, NOW);
  const back = un.data.events.find((e) => e.id === "e1");
  assert.ok(back.mtime > tomb.mtime);
  assert.equal(un.data.deleted.some((x) => x.id === "e1"), false);
  assert.equal(un.data.deleted.length, 1);
});

// ---------- Budget ----------
function budData() {
  return { ver: 1, tx: [
    { id: "a1", m: 10, d: "2026-10-02", a: 1250, k: "o", c: "o-groc", n: "Market" },
    { id: "b2", m: 20, d: "2026-10-03", a: 5000, k: "o", c: "own1", n: "", rc: "r1.jpg" },
    { id: "c3", m: 30, d: "2026-10-04", a: 900, k: "o", c: "", n: "Taxi", oc: "USD", oa: 1000 }
  ], cats: [{ id: "own1", k: "o", name: "Hobby", m: 1 }], bud: [], rec: [], set: { m: 0, cur: "EUR" }, tombs: { "tx:zz": 4 } };
}
test("budget: update amount, category and note; the diff shows names, not ids", () => {
  const d = budData();
  const pl = E.plan("budget", d, { tx: "a1" }, ok({ ref: "r1", action: "update", amount: 14, category: "eating-out", note: "Lunch" }), NOW);
  assert.equal(pl.ok, true);
  assert.deepEqual(pl.rows, [
    { f: "amount", b: "12.50", a: "14.00" },
    { f: "category", b: "cat:groceries", a: "cat:eating-out" },
    { f: "note", b: "Market", a: "Lunch" }
  ]);
  const ap = E.apply("budget", d, { tx: "a1" }, ok({ ref: "r1", action: "update", amount: 14, category: "eating-out", note: "Lunch" }), NOW, pl.before);
  assert.deepEqual(ap.data.tx[0], { id: "a1", m: NOW, d: "2026-10-02", a: 1400, k: "o", c: "o-eat", n: "Lunch" });   // key order kept
  assert.equal(E.plan("budget", d, { tx: "b2" }, ok({ ref: "r1", action: "update", note: "x" }), NOW).before.category, "Hobby");
  const un = E.undo("budget", ap.data, ap.undo, NOW + 1);
  assert.deepEqual(un.data.tx[0], { id: "a1", m: NOW + 1, d: "2026-10-02", a: 1250, k: "o", c: "o-groc", n: "Market" });
});
test("budget: refusals — income category on an expense, foreign amount, receipts, recurring entry", () => {
  const d = budData();
  assert.equal(E.plan("budget", d, { tx: "a1" }, ok({ ref: "r1", action: "update", category: "salary" }), NOW).ok, false);
  assert.equal(E.plan("budget", d, { tx: "c3" }, ok({ ref: "r1", action: "update", amount: 5 }), NOW).ok, false);
  assert.equal(E.plan("budget", d, { tx: "c3" }, ok({ ref: "r1", action: "update", note: "Cab" }), NOW).ok, true);
  assert.equal(E.plan("budget", d, { tx: "b2" }, ok({ ref: "r1", action: "delete" }), NOW).ok, false);
  assert.equal(E.plan("budget", d, { rec: "x" }, ok({ ref: "r1", action: "delete" }), NOW).ok, false);
});
test("budget: delete tombstones tx:<id> (sorted); Undo puts it back in id order with a newer stamp", () => {
  const d = budData();
  const ap = E.apply("budget", d, { tx: "a1" }, ok({ ref: "r1", action: "delete" }), NOW);
  assert.deepEqual(Object.keys(ap.data.tombs), ["tx:a1", "tx:zz"]);
  assert.deepEqual(ap.data.tx.map((x) => x.id), ["b2", "c3"]);
  const un = E.undo("budget", ap.data, ap.undo, NOW);
  assert.deepEqual(un.data.tx.map((x) => x.id), ["a1", "b2", "c3"]);
  assert.ok(un.data.tx[0].m > ap.data.tombs["tx:a1"]);
  assert.deepEqual(Object.keys(un.data.tombs), ["tx:zz"]);
});

// ---------- Bookmarks ----------
function bmData() {
  return { ver: 1, folders: { unsorted: { id: "unsorted", name: "unsorted", pos: 0, modified: 0 } },
           items: { b1: { id: "b1", url: "https://a.example/", title: "A", note: "", modified: 40 },
                    b2: { id: "b2", url: "https://b.example/", title: "B", note: "", modified: 40, arch: { at: 1, f: "x" } } },
           deleted: { q: 1 }, settings: {} };
}
test("bookmarks: rename, delete with a sorted tombstone, Undo; a saved copy blocks the delete", () => {
  const d = bmData();
  const up = E.apply("bookmarks", d, { id: "b1" }, ok({ ref: "r1", action: "update", title: "Alpha" }), NOW);
  assert.equal(up.data.items.b1.title, "Alpha");
  assert.equal(up.data.items.b1.modified, NOW);
  const del = E.apply("bookmarks", d, { id: "b1" }, ok({ ref: "r1", action: "delete" }), NOW);
  assert.deepEqual(Object.keys(del.data.deleted), ["b1", "q"]);
  assert.equal(del.data.items.b1, undefined);
  const un = E.undo("bookmarks", del.data, del.undo, NOW);
  assert.deepEqual(Object.keys(un.data.items), ["b1", "b2"]);
  assert.ok(un.data.items.b1.modified > del.data.deleted.b1);
  assert.equal(E.plan("bookmarks", d, { id: "b2" }, ok({ ref: "r1", action: "delete" }), NOW).ok, false);
  assert.equal(E.plan("bookmarks", d, { id: "b1" }, ok({ ref: "r1", action: "complete" }), NOW).ok, false);
});

// ---------- wiring ----------
test("core: change_item is offered only with data access and an app that takes changes; the prompt says so", () => {
  const names = (o) => A.toolsFor(o).map((t) => t.name);
  assert.ok(!names({ data: true }).includes("change_item"));
  assert.ok(!names({ changes: true }).includes("change_item"));
  assert.ok(names({ data: true, changes: true }).includes("change_item"));
  const tool = A.toolsFor({ data: true, changes: true }).find((t) => t.name === "change_item");
  assert.deepEqual(tool.params.properties.action.enum, E.ACTIONS);
  assert.deepEqual(tool.params.properties.category.enum, E.CAT_NAMES);
  const sp = A.systemPrompt({ lang: "en", apps: ["To-Do (todo)"], changes: ["To-Do (todo)"], entries: ["todo"] });
  assert.match(sp, /change_item/);
  assert.match(sp, /must press Apply/);
  assert.doesNotMatch(sp, /You cannot change or delete anything/);
  const no = A.systemPrompt({ lang: "en", apps: ["To-Do (todo)"], entries: ["todo"] });
  assert.match(no, /You cannot change or delete anything/);
  assert.doesNotMatch(A.systemPrompt({ lang: "en", chatOnly: true, apps: ["x"], changes: ["x"] }), /change_item/);
  assert.doesNotMatch(A.systemPrompt({ builtin: true, apps: ["x"], changes: ["x"] }), /change_item/);
});

test("assistant.js: changes need the user's press, undo is never read from a stored chat, no voice input", () => {
  const src = fs.readFileSync(path.join(ROOT, "assistant/assistant.js"), "utf8");
  // the write happens only after askChange resolved true
  const fn = src.slice(src.indexOf("function changeItem("), src.indexOf("function undoChange("));
  assert.ok(fn.indexOf("askChange(") > 0 && fn.indexOf("askChange(") < fn.indexOf("writeStore("));
  assert.match(fn, /if \(!ok\)/);
  // undo comes from memory only
  assert.match(src, /var undoMem = \{\};/);
  assert.match(src.slice(src.indexOf("function undoChange("), src.indexOf("function chgValue(")), /undoMem\[ui\.u\]/);
  // no speech recognition: in Chrome it streams the audio to Google (removed 2026-10-14)
  assert.doesNotMatch(src, /SpeechRecognition|voiceOk|mic-btn/);
  const html = fs.readFileSync(path.join(ROOT, "assistant/index.html"), "utf8");
  assert.ok(html.indexOf("edits.js") > 0 && html.indexOf("edits.js") < html.indexOf("assistant.js?"));
  assert.doesNotMatch(html, /mic-btn/);
});
