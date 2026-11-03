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

// ---------- KB-DEL: many Kanban cards deleted with one card ----------
test("KB-DEL: several cards of one board deleted in a row on the same data, Undo brings all back in place", () => {
  const d0 = kb();
  const s = S.kanbanBoards(d0, { today: TODAY, board: "My board" });
  const targets = s.items.map((i) => i.target);
  assert.equal(targets.length, 3);
  let d = JSON.parse(JSON.stringify(d0));
  const undos = [];
  targets.forEach((tg, i) => {
    const ch = E.normArgs({ ref: "r" + i, action: "delete" });
    assert.equal(ch.ok, true, ch.err);
    const pl = E.plan("kanban", d, tg, ch, 1760000000000);
    assert.notEqual(pl.ok, false, pl.err);
    const res = E.apply("kanban", d, tg, ch, 1760000000000 + i, pl.before);
    assert.equal(res.ok, true, res.err);
    d = res.data;
    undos.push(res.undo);
  });
  const b = d.boards.find((x) => x.id === "kb-seed-main");
  assert.deepEqual(b.columns.map((c) => c.cards.length), [0, 0]);
  assert.equal(d.boards.find((x) => x.id === "b2").columns[0].cards.length, 1);   // other boards untouched
  for (let i = undos.length - 1; i >= 0; i--) {
    const r = E.undo("kanban", d, undos[i], 1760000001000);
    assert.equal(r.ok, true, r.err);
    d = r.data;
  }
  const back = d.boards.find((x) => x.id === "kb-seed-main");
  assert.deepEqual(back.columns[0].cards.map((k) => k.id), ["k1", "k2"]);
  assert.deepEqual(back.columns[1].cards.map((k) => k.id), ["k3"]);
});

test("KB-DEL wiring: refs take delete for Kanban only, with a delete card in EN/EL/DE", () => {
  const a = fs.readFileSync(path.join(ROOT, "assistant/assistant.js"), "utf8");
  assert.match(a, /var MANY_DEL_APP = "kanban";/);
  assert.match(a, /if \(del && app\.id !== MANY_DEL_APP\) return/);
  assert.match(a, /if \(mv && !MANY_MOVE_APPS\[app\.id\]\) return/);   // AS-MOVE: more apps move many
  assert.match(a, /askChange\(app\.name, \{ many: many, del: del \}, act\)/);
  assert.match(a, /"chg\.ask\.manyDel": "Delete these \{n\} items from \{app\}\?"/);
  assert.match(a, /"chg\.ask\.manyDel": "Διαγραφή αυτών/);
  const de = fs.readFileSync(path.join(ROOT, "i18n/de/assistant.js"), "utf8");
  assert.match(de, /"chg\.ask\.manyDel"/);
  assert.match(de, /"chg\.textManyDel"/);
  const c = fs.readFileSync(path.join(ROOT, "assistant/core.js"), "utf8");
  assert.match(c, /delete: several Kanban cards at once/);
});

// ---------- KB-PICK: choose the boards of a multi-board import ----------
test("KB-PICK wiring: a multi-board import shows a tick per board and imports only the ticked ones", () => {
  const k = fs.readFileSync(path.join(ROOT, "kanban/kanban.js"), "utf8");
  assert.match(k, /many = res\.boards\.length > 1/);
  assert.match(k, /go\.disabled = !pickedBoards\(res\)\.length/);
  assert.match(k, /addParsed\(boards\.length === parsed\.boards\.length \? parsed : Object\.assign\(\{\}, parsed, \{ boards: boards \}\)\)/);
  assert.match(k, /"import\.pick":\s+"Untick the boards you don't want\."/);
  assert.match(k, /"import\.pick":\s+"Ξετσέκαρε/);
  assert.match(fs.readFileSync(path.join(ROOT, "i18n/de/kanban.js"), "utf8"), /"import\.pick"/);
});

// ---------- KB-MOVE: a card to another board ----------
function two() {
  return { ver: 5, om: 1, boards: [
    { id: "b1", name: "Βιβλία", mtime: 1, om: 1, deleted: {}, labels: [{ id: "l1", name: "Urgent" }, { id: "l2", name: "Only here" }],
      columns: [{ id: "c1", name: "Todo", mtime: 1, om: 1, pos: 0, cards: [
        { id: "k1", text: "Song", labels: ["l1", "l2"], subtasks: [], info: [], mtime: 5, pos: 0 },
        { id: "k2", text: "Other", labels: [], subtasks: [], info: [], mtime: 5, pos: 1 }] }] },
    { id: "b2", name: "Μουσική", mtime: 1, om: 1, deleted: {}, labels: [{ id: "m1", name: "urgent" }],
      columns: [{ id: "c2", name: "Ιδέες", mtime: 1, om: 1, pos: 0, cards: [] }, { id: "c3", name: "Έτοιμα", mtime: 1, om: 1, pos: 1, cards: [] }] }] };
}

test("KB-MOVE: move takes board (and column), board only for move", () => {
  assert.deepEqual(E.normArgs({ ref: "r1", action: "move", board: "Μουσική" }).set, { board: "Μουσική" });
  assert.equal(E.normArgs({ ref: "r1", action: "move" }).ok, false);
  assert.equal(E.normArgs({ ref: "r1", action: "update", board: "x", title: "y" }).ok, false);
  assert.equal(E.normArgs({ ref: "r1", action: "move", board: "x", title: "y" }).ok, false);
});

test("KB-MOVE: the card goes to the named board (accents aside), keeps its id, labels by name, Undo puts it back", () => {
  const d = two(), tg = { board: "b1", col: "c1", card: "k1" };
  const ch = E.normArgs({ ref: "r1", action: "move", board: "μουσικη", column: "ετοιμα" });
  const pl = E.plan("kanban", d, tg, ch, 1000);
  assert.equal(pl.ok, true, pl.err);
  assert.deepEqual(pl.rows.find((r) => r.f === "board"), { f: "board", b: "Βιβλία", a: "Μουσική" });
  const r = E.apply("kanban", d, tg, ch, 1000, pl.before);
  assert.equal(r.ok, true, r.err);
  assert.deepEqual(r.target, { board: "b2", col: "c3", card: "k1" });
  assert.match(r.note, /Only here/);
  const b1 = r.data.boards.find((b) => b.id === "b1"), b2 = r.data.boards.find((b) => b.id === "b2");
  assert.deepEqual(b1.columns[0].cards.map((k) => k.id), ["k2"]);
  assert.ok(b1.deleted.k1 >= 1000);
  const moved = b2.columns[1].cards[0];
  assert.equal(moved.id, "k1");
  assert.deepEqual(moved.labels, ["m1"]);
  assert.ok(moved.mtime > b1.deleted.k1);           // alive on the new board, dead on the old one
  const u = E.undo("kanban", r.data, r.undo, 2000);
  assert.equal(u.ok, true, u.err);
  const ub1 = u.data.boards.find((b) => b.id === "b1"), ub2 = u.data.boards.find((b) => b.id === "b2");
  assert.deepEqual(ub1.columns[0].cards.map((k) => k.id), ["k1", "k2"]);
  assert.deepEqual(ub1.columns[0].cards[0].labels, ["l1", "l2"]);
  assert.equal(ub1.deleted.k1, undefined);
  assert.ok(ub2.deleted.k1 >= 2000);
  assert.equal(ub2.columns[1].cards.length, 0);
});

test("KB-MOVE: the old device's copy merges to the moved card (sync)", () => {
  const M = require("../kanban/model.js");
  const d = two(), tg = { board: "b1", col: "c1", card: "k1" };
  const ch = E.normArgs({ ref: "r1", action: "move", board: "Μουσική" });
  const r = E.apply("kanban", d, tg, ch, 1000, E.plan("kanban", d, tg, ch, 1000).before);
  const merged = M.mergeKanbanStates(two(), r.data, 3000);
  const ids = (b) => merged.boards.find((x) => x.id === b).columns.flatMap((c) => c.cards.map((k) => k.id));
  assert.deepEqual(ids("b1"), ["k2"]);
  assert.deepEqual(ids("b2"), ["k1"]);
});

test("KB-MOVE: unknown board names the real ones; same board is refused", () => {
  const d = two(), tg = { board: "b1", col: "c1", card: "k1" };
  const e1 = E.plan("kanban", d, tg, E.normArgs({ ref: "r1", action: "move", board: "Jazz" }), 1000);
  assert.equal(e1.ok, false);
  assert.match(e1.err, /Βιβλία, Μουσική/);
  assert.equal(E.plan("kanban", d, tg, E.normArgs({ ref: "r1", action: "move", board: "βιβλια" }), 1000).ok, false);
});

test("KB-MOVE wiring: refs follow the moved card, many moves on one card, entry cards check the board", () => {
  const a = fs.readFileSync(path.join(ROOT, "assistant/assistant.js"), "utf8");
  assert.match(a, /if \(res\.target\) r\.target = res\.target;/);
  assert.match(a, /c\.refs\[p\.x\.ch\.ref\]\.target = p\.moved/);
  assert.match(a, /var del = args\.action === "delete", mv = args\.action === "move";/);
  assert.match(a, /var kc = kbEntryCheck\(args\);/);
  const k = fs.readFileSync(path.join(ROOT, "kanban/kanban.js"), "utf8");
  assert.match(k, /var want = foldName\(name\)/);
  const c = fs.readFileSync(path.join(ROOT, "assistant/core.js"), "utf8");
  assert.match(c, /kanban move: the name of another board/);
});
