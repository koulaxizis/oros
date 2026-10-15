// Kanban "Import from other apps", file sources (kanban/import.js):
// detection and mapping of Asana (CSV + JSON), Jira (CSV), ClickUp
// (CSV), WeKan (JSON) and Planka (JSON) into the Trello-export shape,
// then through kanban.js's own trelloAdapter + importInto (sliced out
// of kanban.js): stable ids, re-import adds only what is missing, a
// card already here is never moved or overwritten, a deleted one
// doesn't come back.
// Fixtures follow the documented export shapes.
// Run: node --test tests/

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const I = require(path.join(ROOT, "kanban/import.js"));

// trelloAdapter / importInto from kanban.js, unchanged
const SRC = fs.readFileSync(path.join(ROOT, "kanban/kanban.js"), "utf8");
function slice(from, to) {
  const i = SRC.indexOf(from), j = SRC.indexOf(to, i);
  if (i < 0 || j < 0) throw new Error("missing block " + from);
  return SRC.slice(i, j);
}
const K = new Function(
  "var SWATCH_COLORS = ['#111111','#222222','#333333']; var FALLBACK_COLOR = '#999999';" +
  "function uid() { return 'u' + Math.random().toString(36).slice(2); } function t(k) { return k; }" +
  slice("  var TRELLO_HEX = {", "  // K1: a board exported from orOS Kanban") +
  slice("  function importInto(ex, nb) {", "  // --- Import dialog") +
  "return { trelloAdapter: trelloAdapter, importInto: importInto };"
)();

const NAMES = { done: "Done", none: "No section" };
const parse = (text, name) => I.parseText(text, name || "export.csv", NAMES);
function boardOf(res) { return K.trelloAdapter(res.exports[0]).boards[0]; }
function cardsByText(b) {
  const out = {};
  b.columns.forEach((c) => c.cards.forEach((k) => { out[k.text] = Object.assign({ col: c.name }, k); }));
  return out;
}
const info = (card, label) => (card.info.find((f) => f.label === label) || {}).value;

// ---------- fixtures ----------
const ASANA_CSV =
  "Task ID,Created At,Completed At,Last Modified,Name,Section/Column,Assignee,Assignee Email,Start Date,Due Date,Tags,Notes,Projects,Parent task,Blocked By (Dependencies),Blocking (Dependencies)\n" +
  "1201,2024-03-01,,2024-03-02,Write brief,Backlog,Ann Lee,ann@example.com,2024-03-04,2024-03-10,\"design,urgent\",\"Two\nlines\",Website Relaunch,,,\n" +
  "1202,2024-03-01,,2024-03-02,Build pages,In Progress,Bob,,,2024-03-20,design,,Website Relaunch,,1201,\n" +
  "1203,2024-03-01,2024-03-05,2024-03-05,Pick fonts,In Progress,,,,,,,Website Relaunch,,,\n" +
  "1204,2024-03-01,2024-03-02,2024-03-02,Gather logos,,,,,,,,,Write brief,,\n" +
  "1205,2024-03-01,,2024-03-02,Ask legal,,,,,,,,,Write brief,,\n" +
  "1206,2024-03-01,,2024-03-02,,Backlog,,,,,,,Website Relaunch,,,\n";

const ASANA_JSON = JSON.stringify({ data: [
  { gid: "9001", name: "Plan sprint", notes: "Agenda", completed: false, due_on: "2024-05-02",
    assignee: { gid: "1", name: "Ann" },
    memberships: [{ project: { gid: "77", name: "Mobile App" }, section: { gid: "s1", name: "To do" } }],
    tags: [{ gid: "t1", name: "planning" }],
    subtasks: [{ gid: "9101", name: "Book room", completed: true }, { gid: "9102", name: "Send invites", completed: false }] },
  { gid: "9002", name: "Ship 1.2", notes: "", completed: true, completed_at: "2024-05-01T10:00:00.000Z", due_on: null,
    memberships: [{ project: { gid: "77", name: "Mobile App" }, section: { gid: "s2", name: "Doing" } }], tags: [], subtasks: [] },
  { gid: "9003", name: "Fix login", notes: "", completed: false, due_at: "2024-05-09T15:00:00.000Z",
    memberships: [{ project: { gid: "77", name: "Mobile App" }, section: { gid: "s2", name: "Doing" } }] },
  { gid: "9103", name: "Write notes", completed: false, parent: { gid: "9001" } }
] });

const JIRA_CSV =
  "Summary,Issue key,Issue id,Issue Type,Status,Project key,Project name,Priority,Assignee,Reporter,Created,Updated,Due Date,Labels,Labels,Labels,Description,Sprint,Sprint,Parent summary\n" +
  "Login fails,APP-3,10003,Bug,Done,APP,App Project,High,Ann,Bob,01/Mar/24 9:00 AM,02/Mar/24 9:00 AM,15/Mar/24 12:00 AM,auth,backend,,\"Steps:\n1. open\",Sprint 1,Sprint 2,\n" +
  "Add dark mode,APP-4,10004,Story,In Progress,APP,App Project,Medium,,Bob,01/Mar/24 9:00 AM,02/Mar/24 9:00 AM,,ui,,,,Sprint 2,,\n" +
  "Settings page,APP-5,10005,Task,To Do,APP,App Project,Low,,Bob,01/Mar/24 9:00 AM,02/Mar/24 9:00 AM,2024-04-01,,,,,,,\n" +
  "Toggle,APP-6,10006,Sub-task,QA Check,APP,App Project,Low,,Bob,01/Mar/24 9:00 AM,02/Mar/24 9:00 AM,,ui,,,,,,Add dark mode\n";

const CLICKUP_CSV =
  "Task ID,Task Name,Task Content,Status,Date Created,Date Created Text,Due Date,Due Date Text,Start Date,Priority,Tags,Assignees,List Name,Folder Name,Space Name,Checklists,Parent ID\n" +
  "abc1,Draft post,Outline first,in progress,1709280000000,,1710460800000,,,2,\"[blog, seo]\",\"[Ann, Bob]\",Content,Marketing,Team,\"{\"\"Steps\"\":[{\"\"name\"\":\"\"Research\"\",\"\"resolved\"\":true},{\"\"name\"\":\"\"Write\"\",\"\"resolved\"\":false}]}\",\n" +
  "abc2,Publish,,complete,1709280000000,,,,,,,,Content,Marketing,Team,,\n" +
  "abc3,Ideas,,to do,1709280000000,,,,,,[blog],,Content,Marketing,Team,,\n" +
  "abc4,Proofread,,complete,1709280000000,,,,,,,,Content,Marketing,Team,,abc1\n";

const WEKAN = {
  _format: "wekan-board-1.0.0", _id: "wkB1", title: "Home Projects",
  lists: [{ _id: "L2", title: "Doing", sort: 1, archived: false }, { _id: "L1", title: "Todo", sort: 0, archived: false },
          { _id: "L3", title: "Old", sort: 2, archived: true }],
  cards: [
    { _id: "c1", title: "Paint fence", description: "White", listId: "L1", sort: 1, archived: false, dueAt: "2024-06-01T00:00:00.000Z", labelIds: ["lb1"] },
    { _id: "c2", title: "Fix tap", listId: "L2", sort: 0, archived: false, dueAt: { $date: "2024-06-03T10:00:00.000Z" } },
    { _id: "c3", title: "Gone", listId: "L1", sort: 2, archived: true },
    { _id: "c4", title: "In old list", listId: "L3", sort: 0, archived: false }
  ],
  labels: [{ _id: "lb1", name: "", color: "green" }, { _id: "lb2", name: "Urgent", color: "crimson" }],
  checklists: [{ _id: "cl1", cardId: "c1", title: "Steps", sort: 0 }],
  checklistItems: [{ _id: "i2", checklistId: "cl1", cardId: "c1", title: "Second coat", isFinished: false, sort: 1 },
                   { _id: "i1", checklistId: "cl1", cardId: "c1", title: "Sand", isFinished: true, sort: 0 }]
};

const PLANKA = {
  item: { id: "800", name: "Ops" },
  included: {
    lists: [{ id: "l2", name: "Done", position: 2 }, { id: "l1", name: "Inbox", position: 1 }, { id: "l9", type: "trash", name: "", position: 9 }],
    cards: [{ id: "k1", listId: "l1", name: "Renew cert", description: "before May", dueDate: "2024-04-30T00:00:00.000Z", position: 1 },
            { id: "k2", listId: "l2", name: "Rotate keys", position: 1 }],
    labels: [{ id: "lb", name: "infra", color: "lagoon-blue" }],
    cardLabels: [{ cardId: "k1", labelId: "lb" }],
    tasks: [{ id: "t1", cardId: "k1", name: "Order", isCompleted: true, position: 1 }]
  }
};

// ---------- detection ----------
test("detects each source from headers / JSON shape", () => {
  assert.equal(parse(ASANA_CSV).source, "asana");
  assert.equal(I.parseText(ASANA_JSON, "a.json", NAMES).source, "asana");
  assert.equal(parse(JIRA_CSV).source, "jira");
  assert.equal(parse(CLICKUP_CSV).source, "clickup");
  assert.equal(I.parseText(JSON.stringify(WEKAN), "w.json", NAMES).source, "wekan");
  assert.equal(I.parseText(JSON.stringify(PLANKA), "p.json", NAMES).source, "planka");
  // semicolon CSV + BOM
  assert.equal(parse("﻿" + JIRA_CSV.replace(/,/g, ";")).source, "jira");
});

test("other files are not taken", () => {
  assert.equal(parse("Date,Amount\n2024-01-01,3\n"), null);
  assert.equal(I.parseText("", "x.csv", NAMES), null);
  assert.equal(I.parseText("not json {", "x.json", NAMES), null);
  // a Trello export stays Trello's (lists with id, cards with idList)
  assert.equal(I.parseJson({ id: "t", name: "T", lists: [{ id: "a", name: "A" }], cards: [{ id: "c", idList: "a", name: "x" }] }, "t.json", NAMES), null);
  assert.equal(I.parseJson({ boards: [] }, "k.json", NAMES), null);
});

// ---------- Asana ----------
test("Asana CSV: sections → columns, completed → Done, subtasks → checklist, extras → info", () => {
  const res = parse(ASANA_CSV, "Website_Relaunch.csv");
  const b = boardOf(res);
  assert.equal(b.name, "Website Relaunch");
  assert.deepEqual(b.columns.map((c) => c.name), ["Backlog", "In Progress", "Done"]);
  const c = cardsByText(b);
  assert.equal(c["Write brief"].col, "Backlog");
  assert.equal(c["Write brief"].notes, "Two\nlines");
  assert.equal(c["Write brief"].due, "2024-03-10");
  assert.equal(info(c["Write brief"], "Assignee"), "Ann Lee");
  assert.equal(info(c["Write brief"], "Start Date"), "2024-03-04");
  assert.deepEqual(c["Write brief"].subtasks.map((s) => [s.text, s.completed]), [["Gather logos", true], ["Ask legal", false]]);
  assert.equal(c["Pick fonts"].col, "Done");
  assert.equal(info(c["Build pages"], "Blocked By"), "1201");
  assert.ok(!c["Gather logos"], "a subtask is not a card");
  assert.deepEqual(b.labels.map((l) => l.name).sort(), ["design", "urgent"]);
  assert.equal(c["Write brief"].labels.length, 2);
  assert.equal(res.skipped, 1);               // the nameless row
  assert.equal(res.checks, 2);
  assert.equal(res.from, "2024-03-10");
  assert.equal(res.to, "2024-03-20");
  assert.ok(b.id.startsWith("imp-t-as-"));
  b.columns.forEach((col) => col.cards.forEach((k) => assert.ok(k.id.startsWith("imp-t-as-"))));
});

test("Asana CSV: no Done column when nothing is completed; no Projects → file name", () => {
  const csv = "Task ID,Name,Section/Column,Completed At,Notes\n1,A,Todo,,\n2,B,,,\n";
  const res = parse(csv, "My tasks.csv");
  const b = boardOf(res);
  assert.equal(b.name, "My tasks");
  assert.deepEqual(b.columns.map((c) => c.name), ["Todo", "No section"]);
});

test("Asana JSON: sections, completed → Done, subtasks and child tasks → checklist", () => {
  const res = I.parseText(ASANA_JSON, "asana.json", NAMES);
  const b = boardOf(res);
  assert.equal(b.name, "Mobile App");
  assert.deepEqual(b.columns.map((c) => c.name), ["To do", "Doing", "Done"]);
  const c = cardsByText(b);
  assert.equal(c["Plan sprint"].col, "To do");
  assert.deepEqual(c["Plan sprint"].subtasks.map((s) => [s.text, s.completed]), [["Book room", true], ["Send invites", false], ["Write notes", false]]);
  assert.equal(c["Ship 1.2"].col, "Done");
  assert.equal(c["Fix login"].due, "2024-05-09");
  assert.equal(info(c["Plan sprint"], "Assignee"), "Ann");
  assert.equal(c["Plan sprint"].labels.length, 1);
  // a bare array of tasks works too
  assert.equal(I.parseText(JSON.stringify(JSON.parse(ASANA_JSON).data), "a.json", NAMES).source, "asana");
});

// ---------- Jira ----------
test("Jira CSV: status → ordered columns, key in title, repeated Labels / Sprint", () => {
  const res = parse(JIRA_CSV, "Jira.csv");
  const b = boardOf(res);
  assert.equal(b.name, "App Project");
  assert.deepEqual(b.columns.map((c) => c.name), ["To Do", "In Progress", "QA Check", "Done"]);
  const c = cardsByText(b);
  const login = c["APP-3 Login fails"];
  assert.equal(login.col, "Done");
  assert.equal(login.due, "2024-03-15");
  assert.equal(login.notes, "Steps:\n1. open");
  assert.equal(info(login, "Priority"), "High");
  assert.equal(info(login, "Issue Type"), "Bug");
  assert.equal(info(login, "Sprint"), "Sprint 1, Sprint 2");
  assert.deepEqual(login.labels.map((id) => b.labels.find((l) => l.id === id).name), ["auth", "backend"]);
  assert.equal(c["APP-5 Settings page"].due, "2024-04-01");
  assert.equal(info(c["APP-6 Toggle"], "Parent"), "Add dark mode");
});

// ---------- ClickUp ----------
test("ClickUp CSV: status → columns, tags, checklists, subtasks, epoch dates", () => {
  const res = parse(CLICKUP_CSV, "clickup.csv");
  const b = boardOf(res);
  assert.equal(b.name, "Content");
  assert.deepEqual(b.columns.map((c) => c.name), ["to do", "in progress", "complete"]);
  const c = cardsByText(b);
  assert.equal(c["Draft post"].col, "in progress");
  assert.equal(c["Draft post"].notes, "Outline first");
  assert.ok(/^2024-03-1[45]$/.test(c["Draft post"].due));
  assert.equal(info(c["Draft post"], "Assignees"), "Ann, Bob");
  assert.deepEqual(c["Draft post"].subtasks.map((s) => [s.text, s.completed]), [["Research", true], ["Write", false], ["Proofread", true]]);
  assert.deepEqual(b.labels.map((l) => l.name), ["blog", "seo"]);
  assert.ok(!c.Proofread);
});

// ---------- WeKan / Planka ----------
test("WeKan JSON: sorted lists, archived skipped, labels, checklist items in order", () => {
  const res = I.parseText(JSON.stringify(WEKAN), "wekan.json", NAMES);
  const b = boardOf(res);
  assert.equal(b.name, "Home Projects");
  assert.deepEqual(b.columns.map((c) => c.name), ["Todo", "Doing"]);
  const c = cardsByText(b);
  assert.equal(c["Paint fence"].due, "2024-06-01");
  assert.equal(c["Fix tap"].due, "2024-06-03");
  assert.deepEqual(c["Paint fence"].subtasks.map((s) => [s.text, s.completed]), [["Sand", true], ["Second coat", false]]);
  assert.equal(c["Paint fence"].labels.length, 1);
  assert.equal(b.labels.find((l) => l.id === c["Paint fence"].labels[0]).name, "green");
  assert.ok(!c.Gone && !c["In old list"]);
  assert.equal(res.skipped, 3);               // archived list + archived card + its orphan card
});

test("Planka JSON: lists by position, trash skipped, card labels and tasks", () => {
  const b = boardOf(I.parseText(JSON.stringify(PLANKA), "planka.json", NAMES));
  assert.equal(b.name, "Ops");
  assert.deepEqual(b.columns.map((c) => c.name), ["Inbox", "Done"]);
  const c = cardsByText(b);
  assert.equal(c["Renew cert"].due, "2024-04-30");
  assert.deepEqual(c["Renew cert"].subtasks.map((s) => [s.text, s.completed]), [["Order", true]]);
  assert.equal(b.labels[0].color, "#4fc4cf");
  // Planka 2: tasks hang from taskLists
  const p2 = JSON.parse(JSON.stringify(PLANKA));
  p2.included.taskLists = [{ id: "tl", cardId: "k2" }];
  p2.included.tasks = [{ id: "t9", taskListId: "tl", name: "Run script", isCompleted: false }];
  assert.deepEqual(cardsByText(boardOf(I.parseJson(p2, "p.json", NAMES)))["Rotate keys"].subtasks.map((s) => s.text), ["Run script"]);
});

// ---------- ids and the merge ----------
test("ids are stable across reads and distinct across sources / projects", () => {
  const a = boardOf(parse(ASANA_CSV, "x.csv")), a2 = boardOf(parse(ASANA_CSV, "renamed.csv"));
  assert.deepEqual(JSON.stringify(a.columns.map((c) => [c.id, c.cards.map((k) => k.id)])),
                   JSON.stringify(a2.columns.map((c) => [c.id, c.cards.map((k) => k.id)])));
  assert.equal(a.id, a2.id);
  const j = boardOf(parse(JIRA_CSV));
  assert.notEqual(a.id, j.id);
  const other = boardOf(parse(JIRA_CSV.replace(/,APP,App Project,/g, ",WEB,Web,")));
  assert.notEqual(other.id, j.id);
  const all = [];
  [a, j].forEach((b) => b.columns.forEach((c) => c.cards.forEach((k) => all.push(k.id))));
  assert.equal(new Set(all).size, all.length);
});

test("re-import adds only what is missing; the user's cards and deletions win", () => {
  const first = boardOf(parse(JIRA_CSV));
  const state = JSON.parse(JSON.stringify(first));
  // the user edits a card, moves another, deletes a third
  const cols = state.columns;
  const login = cols.find((c) => c.name === "Done").cards[0];
  login.text = "Login fails (mine)";
  const todo = cols.find((c) => c.name === "To Do");
  const moved = todo.cards.shift();
  cols.find((c) => c.name === "In Progress").cards.push(moved);
  const qa = cols.find((c) => c.name === "QA Check");
  const gone = qa.cards.shift();
  state.deleted[gone.id] = Date.now();
  const snap = JSON.stringify(state);

  // the same file again: nothing changes
  K.importInto(state, boardOf(parse(JIRA_CSV)));
  assert.equal(JSON.stringify(state), snap);

  // a newer export with one more issue: only that one comes in
  const newer = JIRA_CSV + "New thing,APP-7,10007,Task,To Do,APP,App Project,Low,,Bob,,,,,,,,,,\n";
  K.importInto(state, boardOf(parse(newer)));
  const texts = [];
  state.columns.forEach((c) => c.cards.forEach((k) => texts.push(c.name + ":" + k.text)));
  assert.deepEqual(texts.sort(), ["Done:Login fails (mine)", "In Progress:APP-4 Add dark mode", "In Progress:APP-5 Settings page", "To Do:APP-7 New thing"].sort());
});

test("text from the file stays text; caps hold", () => {
  const evil = "Task ID,Name,Section/Column,Completed At,Notes\n1,\"<img src=x onerror=alert(1)>\",\"<b>Col</b>\",,\"\u0000x\"\n";
  const b = boardOf(parse(evil));
  assert.equal(b.columns[0].name, "<b>Col</b>");
  assert.equal(b.columns[0].cards[0].text, "<img src=x onerror=alert(1)>");
  assert.equal(b.columns[0].cards[0].notes.indexOf("\u0000"), -1);

  let big = "Task ID,Name,Section/Column,Completed At\n";
  for (let i = 0; i < 5200; i++) big += i + ",Task " + i + ",S" + (i % 80) + ",\n";
  const res = parse(big);                     // 80 sections: the ones past 60 are left out
  assert.equal(res.exports[0].lists.length, I.MAX.cols);
  assert.ok(res.exports[0].cards.length < I.MAX.cards);
  const res2 = parse(big.replace(/,S(\d+),/g, (m, d) => ",S" + (d % 10) + ","));
  assert.equal(res2.exports[0].cards.length, I.MAX.cards);
  assert.equal(res2.skipped, 200);
  const long = "Summary,Issue key,Status\n" + "x".repeat(2000) + ",A-1,To Do\n";
  assert.ok(boardOf(parse(long)).columns[0].cards[0].text.length <= 500);
});
