// The .orostasks file (To-Do, the record apps' pilot): every list,
// task, subtask and label through the shared kit (recordpkg.js) and
// bundle.js; opening adds only what is missing, with its ids. Plus the
// app wiring (Save, Open, unzipped folder, "Open with").
// Run: node --test tests/*.test.js
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const B = require(path.join(ROOT, "bundle.js"));
const K = require(path.join(ROOT, "recordpkg.js"));
const P = require(path.join(ROOT, "todo/package.js"));
const F = require(path.join(ROOT, "fileopen.js"));
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
const D = P.DESC;
const NOW = 1800000000000;
const clone = (x) => JSON.parse(JSON.stringify(x));

function slice() {
  return {
    ver: 3, sm: 5, om: 7, activeList: "tdl-general", hideCompleted: true,
    deleted: { "t-gone": NOW - 100, "tdl-groceries": 0 },
    labels: [{ id: "lb-home", name: "home", color: "#e06c75", mtime: NOW - 900, om: 0, pos: 0 }],
    lists: [
      { id: "tdl-general", name: "General", mtime: NOW - 800, om: 1, pos: 0, recurrence: null, fm: { name: NOW - 800, cycle: 0 },
        items: [
          { id: "t1", text: "Buy milk", done: false, due: "2026-10-20", notes: "2 l", labels: ["lb-home"], info: [{ id: "f1", label: "Shop", value: "AB" }],
            recurrence: null, mtime: NOW - 700, om: 0, pos: 0, fm: { text: NOW - 700, done: 0, due: 0, notes: 0, labels: 0, info: 0, recurrence: 0 },
            prio: 1, xf: { prio: NOW - 700 }, subs: [{ id: "s1", text: "check fridge", done: true, mtime: NOW - 700 }] },
          { id: "t2", text: "=cmd", done: true, due: null, notes: "", labels: [], info: [], recurrence: null, mtime: NOW - 600, om: 0, pos: 1,
            fm: { text: NOW - 600, done: NOW - 600, due: 0, notes: 0, labels: 0, info: 0, recurrence: 0 } }
        ] }
    ],
    filters: [{ id: "flt1", name: "x", mtime: 1 }], fom: 1
  };
}

test("todo: round trip through bundle.js; the file has no tombstones, view or filters", async () => {
  const o = K.pack(D, slice(), { title: "To-Do", lang: "en", now: NOW });
  assert.equal(o.mime, "application/x-oros-tasks");
  assert.equal(o.generator, "orOS To-Do");
  assert.deepEqual(Object.keys(o.content.data).sort(), ["labels", "lists", "ver"]);
  const bytes = await B.write(o);
  assert.equal(B.sniff(bytes.subarray(0, 128)), "application/x-oros-tasks");
  const r = await B.read(bytes, { mime: D.mime });
  assert.equal(r.content.kind, "oros-todo-package");
  assert.deepEqual(r.content.data.lists, slice().lists);
  // previews: Markdown with ticks and subtasks, CSV with a formula guard
  const md = o.preview.find((p) => p.name === "tasks.md").data;
  assert.match(md, /^# Tasks\n\n## General\n\n- \[ \] Buy milk \(2026-10-20, P1\)\n  - \[x\] check fridge\n- \[x\] =cmd/);
  const csv = o.preview.find((p) => p.name === "tasks.csv").data;
  assert.match(csv, /^list,task,done,due,priority,labels,notes\r\nGeneral,Buy milk,no,2026-10-20,P1,home,2 l\r\nGeneral,"'=cmd",yes/);
  // into a device that has only its default lists
  const fresh = { ver: 3, sm: 0, om: 0, activeList: "tdl-general", hideCompleted: false, deleted: {}, labels: [],
    lists: [{ id: "tdl-general", name: "General", mtime: 0, om: 0, pos: 0, items: [] },
            { id: "tdl-groceries", name: "Groceries", mtime: 0, om: 0, pos: 1, items: [] }] };
  const res = K.open(D, fresh, r.content, { now: NOW });
  assert.deepEqual(res.report, { added: 4, skipped: 1, updated: 0 });   // label, t1, t2, s1 (inside t1) | General kept
  assert.deepEqual(res.addedIds.slice().sort(), ["lb-home", "s1", "t1", "t2"]);
  assert.deepEqual(res.next.lists[0].items.map((i) => i.id), ["t1", "t2"]);
  assert.equal(res.next.lists[0].name, "General");                         // the device's own list header
  assert.equal(res.next.lists[0].mtime, 0);
  assert.deepEqual(res.next.lists[0].items[0].subs, slice().lists[0].items[0].subs);
  assert.equal(res.next.hideCompleted, false);                              // view settings stay
  // and again: nothing
  const again = K.open(D, res.next, r.content, { now: NOW });
  assert.deepEqual(again.report.added, 0);
  assert.deepEqual(again.next, res.next);
});

test("todo: a deleted task stays deleted, a new subtask goes into the task here, update takes newer", () => {
  const theirs = slice();
  theirs.lists[0].items.push({ id: "t-gone", text: "deleted here", mtime: NOW - 1, labels: [], info: [] });
  theirs.lists[0].items[0].subs.push({ id: "s2", text: "new step", done: false, mtime: NOW - 1 });
  theirs.lists[0].items[1].text = "changed later"; theirs.lists[0].items[1].mtime = NOW - 1;
  const mine = slice();
  const c = K.pack(D, theirs, { now: NOW }).content;
  const res = K.open(D, mine, c, { now: NOW });
  assert.deepEqual(res.addedIds, ["s2"]);
  const t1 = res.next.lists[0].items[0];
  assert.deepEqual(t1.subs.map((s) => s.id), ["s1", "s2"]);
  assert.equal(t1.text, "Buy milk");
  assert.ok(!res.next.lists[0].items.some((i) => i.id === "t-gone"));
  assert.equal(res.next.lists[0].items[1].text, "=cmd");
  const upd = K.open(D, mine, c, { update: true, now: NOW });
  assert.deepEqual(upd.updatedIds, ["t2"]);
  assert.equal(upd.next.lists[0].items[1].text, "changed later");
  assert.deepEqual(upd.next.deleted, mine.deleted);
  assert.equal(P.kindOf("s2", res.next), "sub");
  assert.equal(P.kindOf("t1", res.next), "item");
  assert.equal(P.kindOf("tdl-general", res.next), "list");
  assert.equal(P.kindOf("lb-home", res.next), "label");
  assert.equal(P.kindOf("nope", res.next), "");
});

test("todo: the normaliser keeps known fields only, typed and capped", () => {
  const n = D.norm({ lists: [{ id: "L", name: "a\u0000b", evil: "<script>", items: [
    { id: "i", text: { x: 1 }, done: "yes", due: "tomorrow", labels: ["ok", 5, "../x"], info: [null, { label: "a", value: 3 }],
      prio: 9, subs: [{ id: "s", text: "x" }, { id: "s" }, "junk"], recurrence: { every: -4, unit: "year" }, onclick: "x" },
    { id: "bad id with spaces" }] }], labels: [{ id: "lb", color: "red" }, 4] });
  const it = n.lists[0].items[0];
  assert.equal(n.lists[0].name, "a b");
  assert.equal(n.lists[0].evil, undefined);
  assert.equal(n.lists[0].items.length, 1);
  assert.deepEqual([it.text, it.done, it.due, it.labels, it.prio, it.onclick], ["", false, null, ["ok"], undefined, undefined]);
  assert.deepEqual(it.info, [{ id: "f0", label: "a", value: "" }]);
  assert.deepEqual(it.subs, [{ id: "s", text: "x", done: false, mtime: 0 }]);
  assert.deepEqual(it.recurrence, { every: 1, unit: "day" });
  assert.equal(n.labels[0].color, "#ecc75f");
  assert.equal(D.norm("x"), null);
});

test("todo: wiring (scripts, buttons, Open with, precache, help, file types)", () => {
  const html = read("todo/index.html");
  ["../bundle.js", "../recordpkg.js", "package.js", "todo.js"].forEach((s) =>
    assert.ok(html.includes('src="' + s + '?v='), s));
  assert.ok(html.indexOf("recordpkg.js") < html.indexOf('src="todo.js'));
  ["l-osave", "l-oopen", "l-ofolder"].forEach((id) => assert.ok(html.includes('id="' + id + '"'), id));
  const js = read("todo/todo.js");
  assert.match(js, /RP\.ui\(TPK\.DESC,/);
  assert.match(js, /if \(t && t\.openFile\) \{ if \(recFile\) recFile\.openTarget\(t\.openFile\); return; \}/);
  assert.match(js, /importUndo\(back\)/);
  const sw = read("sw.js");
  ["\"todo/package.js\"", "\"recordpkg.js\"", "\"bundle.js\""].forEach((s) => assert.ok(sw.includes(s), s));
  for (const f of ["todo/help.en.txt", "todo/help.el.txt"]) assert.ok(read(f).includes(".orostasks"), f);
  assert.deepEqual(F.appsFor(".orostasks"), ["todo"]);
  assert.deepEqual(B.TYPES[".orostasks"], { app: "todo", mime: "application/x-oros-tasks" });
});
