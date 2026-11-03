// Assistant and every Kanban board (KB-ALL): app_summary kanban lists
// every board, not only the first or the one open in Kanban: each
// board's columns with their card counts, late / due-today cards,
// archived boards by name, and the cards of all boards (or of one
// board by name) with a target the Assistant turns into a ref for
// change_item. Templates and deleted boards stay out. Pure parts in
// node; static checks on the wiring in assistant.js and core.js.
// Run: node --test tests/

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const S = require("../assistant/summary.js");
const E = require("../assistant/edits.js");

const TODAY = "2026-11-03";

function kb() {
  return {
    ver: 3, om: 1,
    boardDeleted: { "b-gone": 50, "b-back": 5 },
    boards: [
      { id: "kb-seed-main", name: "My board", mtime: 1, om: 0, deleted: {}, labels: [{ id: "l1", name: "Urgent" }],
        columns: [
          { id: "c1", name: "To do", pos: 0, cards: [
            { id: "k1", text: "Write intro", due: "2026-11-01", labels: ["l1"], subtasks: [{ text: "a", done: true }, { text: "b" }] },
            { id: "k2", text: "Call printer", due: TODAY }
          ] },
          { id: "c2", name: "Done", pos: 1, cards: [{ id: "k3", text: "Old thing", due: "2026-10-01" }] }
        ] },
      { id: "b2", name: "Γλαρόλυκοι", mtime: 2, om: 0, deleted: {}, labels: [],
        columns: [
          { id: "c3", name: "Ιδέες", pos: 0, cards: [{ id: "k4", text: "Νέο βιβλίο" }] },
          { id: "c4", name: "Σε εξέλιξη", pos: 1, cards: [{ id: "k5", text: "Εξώφυλλο", due: "2026-10-30" }] },
          { id: "c5", name: "Έτοιμα", pos: 2, cards: [] }
        ] },
      { id: "b3", name: "Old project", archived: true, mtime: 3, columns: [{ id: "c6", name: "x", cards: [{ id: "k6", text: "hidden" }] }] },
      { id: "tpl-weekly", name: "Weekly template", archived: true, mtime: 1, columns: [] },
      { id: "b-gone", name: "Deleted", mtime: 10, columns: [{ id: "c7", name: "y", cards: [{ id: "k7", text: "gone" }] }] },
      { id: "b-back", name: "Restored", mtime: 9, columns: [{ id: "c8", name: "z", cards: [{ id: "k8", text: "kept" }] }] }
    ]
  };
}

test("kanban has a summary of its own and args take a board name", () => {
  assert.equal(S.OWN.kanban, "boards");
  const a = S.normArgs({ app: "kanban", board: "  Γλαρόλυκοι  " }, TODAY);
  assert.equal(a.ok, true);
  assert.equal(a.board, "Γλαρόλυκοι");
  assert.equal(S.normArgs({ app: "todo", board: "x" }, TODAY).board, undefined);
});

test("every open board is listed with its columns, counts, late and due today", () => {
  const s = S.kanbanBoards(kb(), { today: TODAY });
  assert.deepEqual(s.boards.map((b) => b.name), ["My board", "Γλαρόλυκοι", "Restored"]);
  const b1 = s.boards[0];
  assert.deepEqual(b1.columns, [{ name: "To do", cards: 2 }, { name: "Done", cards: 1 }]);
  assert.equal(b1.cards, 3);
  assert.equal(b1.late, 1);          // k3 is late by date but sits in the last (Done) column
  assert.equal(b1.due_today, 1);
  assert.equal(s.boards[1].late, 1);
  assert.equal(s.cards, 6);
  assert.equal(s.late, 2);
  assert.deepEqual(s.archived_boards, ["Old project"]);   // templates and deleted boards stay out
});

test("the cards of all boards come with board › column, due, labels, subtasks and a target", () => {
  const s = S.kanbanBoards(kb(), { today: TODAY });
  assert.deepEqual(s.items.map((i) => i.title), ["Write intro", "Call printer", "Old thing", "Νέο βιβλίο", "Εξώφυλλο", "kept"]);
  const k1 = s.items[0];
  assert.equal(k1.where, "My board › To do");
  assert.equal(k1.date, "2026-11-01");
  assert.equal(k1.late, true);
  assert.deepEqual(k1.labels, ["Urgent"]);
  assert.equal(k1.subtasks, "1/2");
  assert.deepEqual(k1.target, { board: "kb-seed-main", col: "c1", card: "k1" });
  assert.deepEqual(s.items[4].target, { board: "b2", col: "c4", card: "k5" });
  assert.equal(s.listed, 6);
  assert.ok(!s.items.some((i) => i.title === "hidden" || i.title === "gone"));
});

test("board: only that board's cards (case and accents aside); an unknown one names the real ones", () => {
  const s = S.kanbanBoards(kb(), { today: TODAY, board: "γλαρολυκοι" });
  assert.equal(s.board, "Γλαρόλυκοι");
  assert.deepEqual(s.items.map((i) => i.title), ["Νέο βιβλίο", "Εξώφυλλο"]);
  assert.equal(s.boards.length, 3);            // the overview still names every board
  const e = S.kanbanBoards(kb(), { today: TODAY, board: "Nope" });
  assert.equal(e.ok, false);
  assert.match(e.err, /My board, Γλαρόλυκοι, Restored/);
  assert.match(e.err, /Old project/);
});

test("a card from the second board can be changed through its target", () => {
  const d = kb();
  const s = S.kanbanBoards(d, { today: TODAY });
  const t = s.items.find((i) => i.title === "Εξώφυλλο").target;
  const ch = E.normArgs({ ref: "r1", action: "update", title: "Εξώφυλλο v2" });
  assert.equal(ch.ok, true, ch.err);
  const pl = E.plan("kanban", d, t, ch, 1760000000000);
  assert.notEqual(pl.ok, false, pl.err);
});

test("many cards: at most 200 listed, the rest counted", () => {
  const d = kb();
  d.boards[1].columns[0].cards = Array.from({ length: 250 }, (_, i) => ({ id: "n" + i, text: "Card " + i }));
  const s = S.kanbanBoards(d, { today: TODAY });
  assert.equal(s.items.length, 200);
  assert.equal(s.more_items, s.listed - 200);
  assert.equal(s.boards[1].cards, 251);
});

test("the consent card shows every board in EN and EL", () => {
  const s = S.kanbanBoards(kb(), { today: TODAY });
  const en = S.preview(s, "en"), el = S.preview(s, "el");
  assert.match(en[0], /^My board: 3 cards, 1 late, 1 due today \(To do 2 · Done 1\)$/);
  assert.match(en[1], /^Γλαρόλυκοι: 2 cards/);
  assert.ok(en.includes("Archived: Old project"));
  assert.match(el[0], /κάρτες/);
  assert.match(en.find((l) => l.startsWith("Restored")), /^Restored: 1 card \(z 1\)$/);
  assert.ok(el.includes("Στο αρχείο: Old project"));
  assert.ok(en.some((l) => /Εξώφυλλο · Γλαρόλυκοι › Σε εξέλιξη/.test(l)));
  assert.equal(S.preview(S.kanbanBoards(null, { today: TODAY }), "en").length >= 1, true);
});

test("wiring: assistant.js builds the kanban summary from every board; core.js tells the model", () => {
  const a = fs.readFileSync(path.join(ROOT, "assistant/assistant.js"), "utf8");
  assert.match(a, /if \(a\.app === "kanban" && !a\.brief\) return/);       // the Briefing keeps only what is due
  assert.match(a, /days: x\.days, brief: true \}/);
  assert.match(a, /S\.kanbanBoards\(readStore\("oros-kanban-data"\), \{ board: a\.board, today: today \}\)/);
  const c = fs.readFileSync(path.join(ROOT, "assistant/core.js"), "utf8");
  assert.match(c, /kanban \(EVERY board/);
  assert.match(c, /board: \{ type: "string", description: "kanban: one board's name/);
});
