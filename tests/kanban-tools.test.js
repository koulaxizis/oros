// Kanban board tools (kanban/tools.js): arrival rules, the overdue
// rule, swimlanes, table sort, timeline range, JSON export/import,
// CSV, templates (built-in EN/EL and user ones).
// Run: node --test tests/

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const M = require(path.join(__dirname, "..", "kanban/model.js"));
const T = require(path.join(__dirname, "..", "kanban/tools.js"));

const NOW = new Date(2026, 9, 14, 10, 0, 0).getTime();     // local 2026-10-14 10:00
const TODAY = "2026-10-14";

function card(id, extra) {
  return Object.assign({ id, text: "Card " + id, notes: "", due: null, labels: [], subtasks: [], info: [], mtime: NOW - 1e6, pos: 0 }, extra || {});
}
function board(extra) {
  return Object.assign({
    id: "b1", name: "B", mtime: 1, om: 1, deleted: {},
    labels: [{ id: "L1", name: "Bug", color: "#e06c75", mtime: 1, pos: 0 }, { id: "L2", name: "Idea", color: "#4fc4cf", mtime: 1, pos: 1 }],
    columns: [
      { id: "c1", name: "To do", mtime: 1, om: 1, pos: 0, cards: [card("k1", { subtasks: [{ id: "s1", text: "a", completed: false }, { id: "s2", text: "b", completed: true }] }), card("k2")] },
      { id: "c2", name: "Done", mtime: 1, om: 1, pos: 1, cards: [card("k3")] }
    ]
  }, extra || {});
}

test("arrival rules: tick subtasks, due today, add label, move to top", () => {
  const b = board();
  b.columns[1].auto = { done: true, today: true, label: "L2", top: true };
  const k = b.columns[0].cards.shift();
  b.columns[1].cards.push(k);
  const got = T.applyArrival(b, "c2", "k1", TODAY, NOW);
  assert.deepEqual(got, ["done", "today", "label", "top"]);
  assert.equal(b.columns[1].cards[0].id, "k1");
  assert.ok(k.subtasks.every((s) => s.completed));
  assert.equal(k.due, TODAY);
  assert.deepEqual(k.labels, ["L2"]);
  assert.ok(M.fmValid(k));
  assert.ok(k.fm.s >= NOW && k.fm.d >= NOW && k.fm.l >= NOW);
  assert.ok(k.fm.t < NOW, "text group untouched");
  assert.equal(k.subtasks[0].m, k.fm.s);
  // nothing left to do: a second run changes nothing
  assert.deepEqual(T.applyArrival(b, "c2", "k1", TODAY, NOW + 5), []);
  // a column without rules, or a label that no longer exists
  b.columns[0].auto = { label: "gone" };
  assert.deepEqual(T.applyArrival(b, "c1", "k2", TODAY, NOW), []);
});

test("overdue rule: labels late cards once, leaves Done and user removals alone", () => {
  const b = board();
  b.labels.push({ id: "OD", name: "Overdue", color: "#e06c75", auto: "overdue", mtime: 1, pos: 2 });
  b.columns[0].cards[0].due = "2026-10-13";          // late
  b.columns[0].cards[1].due = TODAY;                 // due today: not late yet
  b.columns[1].cards[0].due = "2026-10-01";          // in Done: left alone
  assert.equal(T.applyOverdue(b, NOW), 1);
  assert.deepEqual(b.columns[0].cards[0].labels, ["OD"]);
  assert.equal(T.applyOverdue(b, NOW + 1000), 0, "once");
  // the user takes the label off after the due date passed: not added again
  const k = b.columns[0].cards[0];
  k.labels = [];
  M.stampCard(k, ["l"], NOW + 2000);
  assert.equal(T.applyOverdue(b, NOW + 3000), 0);
  // a new (later) due date that passes again: labelled again
  k.due = TODAY;
  M.stampCard(k, ["d"], NOW + 4000);
  const tomorrow = new Date(2026, 9, 15, 0, 0, 1).getTime();
  assert.equal(T.applyOverdue(b, tomorrow), 2, "k1 again and k2");
  // labels edited after the date passed but BEFORE the rule was switched on: labelled
  const b2 = board();
  const k2 = b2.columns[0].cards[0];
  k2.due = "2026-10-10"; k2.labels = ["L1"];
  M.stampCard(k2, ["l"], NOW - 5000);
  b2.labels.push({ id: "OD", name: "Overdue", color: "#e06c75", auto: "overdue", mtime: NOW - 1000, pos: 2 });
  assert.equal(T.applyOverdue(b2, NOW), 1);
  assert.deepEqual(k2.labels, ["L1", "OD"]);
  // no rule label → nothing; template boards never
  assert.equal(T.applyOverdue(board(), NOW), 0);
  const tpl = board({ id: "tpl-x" });
  tpl.labels.push({ id: "OD", name: "O", color: "#e06c75", auto: "overdue", mtime: 1, pos: 2 });
  tpl.columns[0].cards[0].due = "2026-01-01";
  assert.equal(T.applyOverdue(tpl, NOW), 0);
});

test("swimlanes by label and by lane; moving between lanes", () => {
  const b = board();
  b.columns[0].cards[0].labels = ["L2", "L1"];
  b.columns[0].cards[1].lane = "Team B";
  b.columns[1].cards[0].lane = "Team A";
  assert.equal(T.laneKey(b, b.columns[0].cards[0], "label"), "L1", "first label in board order");
  assert.deepEqual(T.lanes(b, "label").map((l) => l.key), ["L1", "L2", ""]);
  assert.deepEqual(T.lanes(b, "lane").map((l) => l.key), ["Team A", "Team B", ""]);
  const k = b.columns[0].cards[0];
  assert.deepEqual(T.setLane(b, k, "label", "L1", ""), ["l"]);
  assert.deepEqual(k.labels, ["L2"]);
  assert.deepEqual(T.setLane(b, k, "label", "L2", "L1"), ["l"]);
  assert.deepEqual(k.labels, ["L1"]);
  const k2 = b.columns[0].cards[1];
  assert.deepEqual(T.setLane(b, k2, "lane", "Team B", "Team A"), ["k"]);
  assert.equal(k2.lane, "Team A");
  T.setLane(b, k2, "lane", "Team A", "");
  assert.equal("lane" in k2, false);
});

test("table sort: by text, due (empty last), subtasks, status", () => {
  const b = board();
  b.columns[0].cards[0].due = "2026-10-20";
  b.columns[1].cards[0].due = "2026-10-15";
  const rows = [];
  b.columns.forEach((col, ci) => col.cards.forEach((c, i) => rows.push({ card: c, col, colIdx: ci, idx: i })));
  assert.deepEqual(T.sortRows(rows, "due", "asc", b).map((r) => r.card.id), ["k3", "k1", "k2"]);
  assert.deepEqual(T.sortRows(rows, "due", "desc", b).map((r) => r.card.id), ["k1", "k3", "k2"]);
  assert.deepEqual(T.sortRows(rows, "status", "desc", b).map((r) => r.card.id), ["k3", "k2", "k1"]);
  assert.deepEqual(T.sortRows(rows, "sub", "asc", b).map((r) => r.card.id), ["k1", "k2", "k3"]);
});

test("timeline range covers today and every due date, capped", () => {
  const r = T.timelineRange(["2026-09-01", "2026-12-24", "bad"], TODAY);
  assert.equal(r.from, "2026-08-31");
  assert.equal(r.to, "2026-12-26");
  assert.equal(r.days, T.daysBetween(r.from, r.to) + 1);
  const r2 = T.timelineRange([], TODAY);
  assert.equal(r2.from, "2026-10-11");
  assert.equal(r2.to, "2026-11-04");
  const r3 = T.timelineRange(["2030-01-01"], TODAY);
  assert.equal(r3.to, "2027-10-15");
});

test("export → import makes a new board with fresh ids and everything", () => {
  const b = board();
  b.columns[1].wip = 3;
  b.columns[1].auto = { done: true, label: "L1" };
  b.labels.push({ id: "OD", name: "Overdue", color: "#e06c75", auto: "overdue", mtime: 1, pos: 2 });
  const k = b.columns[0].cards[0];
  k.due = "2026-10-20"; k.labels = ["L1", "nope"]; k.lane = "Team"; k.info = [{ id: "i", label: "Owner", value: "Ann" }];
  k.att = [{ id: "a1", name: "photo.jpg", file: "abc123.jpg", kind: "img", size: 100 }, { id: "a2", name: "bad", file: "../etc/x", kind: "file", size: 1 }];
  k.cover = "a:a1";
  const ex = JSON.parse(JSON.stringify(T.exportBoard(b, { "abc123.jpg": "AAEC" }, NOW)));
  assert.equal(ex.app, "oros-kanban");
  assert.equal(ex.board.deleted, undefined);
  const uid = T.counter();
  const got = T.parseExport(ex, uid, NOW);
  const nb = got.board;
  assert.notEqual(nb.id, "b1");
  assert.equal(nb.columns.length, 2);
  assert.equal(nb.columns[1].wip, 3);
  const L1 = nb.labels.find((l) => l.name === "Bug").id;
  assert.deepEqual(nb.columns[1].auto, { done: true, label: L1 });
  assert.equal(nb.labels.find((l) => l.name === "Overdue").auto, "overdue");
  const nk = nb.columns[0].cards[0];
  assert.deepEqual(nk.labels, [L1]);
  assert.equal(nk.due, "2026-10-20");
  assert.equal(nk.lane, "Team");
  assert.equal(nk.att.length, 1, "the bad file name is dropped");
  assert.notEqual(nk.att[0].file, "abc123.jpg");
  assert.equal(nk.cover, "a:" + nk.att[0].id);
  assert.deepEqual(got.files, [{ file: nk.att[0].file, data: "AAEC" }]);
  assert.ok(M.fmValid(nk));
  assert.equal(T.parseExport({ app: "other" }, uid, NOW), null);
  assert.equal(T.parseExport({ app: "oros-kanban", board: { columns: "x" } }, uid, NOW), null);
});

test("CSV: one row per card, quoted, no formulas", () => {
  const b = board();
  b.columns[0].cards[0].text = "=SUM(A1)";
  b.columns[0].cards[0].notes = 'He said "hi", ok';
  b.columns[0].cards[0].labels = ["L1"];
  const csv = T.boardCsv(b, ["Board", "Column", "Card", "Notes", "Due", "Labels", "Subtasks", "Lane", "Extra info", "Attachments"]);
  const lines = csv.replace(/^﻿/, "").trim().split("\r\n");
  assert.equal(lines.length, 4);
  assert.ok(lines[1].startsWith("B,To do,'=SUM(A1),\"He said \"\"hi\"\", ok\",,Bug,1/2,"));
});

test("templates: save a board as one, new board from it; built-ins in EN and EL", () => {
  const b = board();
  b.columns[0].cards[0].due = "2026-10-20";
  b.columns[0].cards[0].att = [{ id: "a1", name: "x", file: "f.jpg", kind: "img", size: 1 }];
  const uid = T.counter();
  const tpl = T.templateFromBoard(b, uid, NOW, "My template");
  assert.ok(M.isTpl(tpl));
  assert.equal(tpl.archived, true);
  assert.equal(tpl.name, "My template");
  const k = tpl.columns[0].cards[0];
  assert.equal(k.due, null);
  assert.equal(k.att, undefined);
  assert.ok(k.subtasks.every((s) => !s.completed));
  const nb = T.boardFromTemplate(tpl, uid, NOW, "Sprint 12");
  assert.equal(M.isTpl(nb), false);
  assert.equal(nb.archived, undefined);
  assert.equal(nb.name, "Sprint 12");
  assert.equal(nb.columns[0].cards.length, 2);
  ["en", "el"].forEach((lang) => {
    const list = T.builtinList(lang);
    assert.deepEqual(list.map((x) => x.key), ["personal", "sprint", "content"]);
    list.forEach((x) => {
      const src = T.builtinBoard(x.key, lang);
      const made = T.boardFromTemplate(src, uid, NOW, src.name);
      assert.ok(made.columns.length >= 4, x.key);
      assert.ok(made.labels.some((l) => l.auto === "overdue"), x.key + " has the overdue rule");
      made.columns.forEach((c) => { if (c.auto && c.auto.label) assert.ok(made.labels.some((l) => l.id === c.auto.label)); });
    });
  });
  assert.equal(T.builtinList("el")[1].name, "Σπριντ λογισμικού");
  const sprint = T.boardFromTemplate(T.builtinBoard("sprint", "en"), uid, NOW, "S");
  assert.equal(sprint.columns[2].wip, 3);
  assert.deepEqual(sprint.columns[4].auto, { done: true });
});

test("used files and attachment paths", () => {
  const s = { boards: [board()] };
  s.boards[0].columns[0].cards[0].att = [{ id: "a", name: "n", file: "abc.jpg", kind: "img", size: 1 }];
  assert.deepEqual(T.usedFiles(s), { "abc.jpg": true });
  assert.equal(T.attPath("abc.jpg"), "/internal/Kanban/Attachments/abc.jpg");
  assert.equal(T.attPath("../x.jpg"), null);
  assert.equal(T.attPath("a/b.jpg"), null);
});
