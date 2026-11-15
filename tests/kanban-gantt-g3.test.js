// Kanban Gantt wave G3: the plan outside the Timeline. Calendar's
// "starts" mark and Today's "Starts today" (kanban/core.js startCards),
// the plan through orOS Gate (kanban_change_card / kanban_add_cards) and
// the Assistant (change_item, create_items), with undo, and the start
// date from other apps' exports (kanban/import.js).
// Run: node --test tests/

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const R = path.join(__dirname, "..");
const KC = require(path.join(R, "kanban/core.js"));
globalThis.OrosKanbanCore = KC;                  // the Today provider finds it on the page
const TODAY = require(path.join(R, "kanban/today.js"));
const M = require(path.join(R, "kanban/model.js"));
const G = require(path.join(R, "gate/gate.js"));
const E = require(path.join(R, "assistant/edits.js"));
const A = require(path.join(R, "assistant/additems.js"));
const I = require(path.join(R, "kanban/import.js"));

const T0 = 1760000000000, NOW = T0 + 1000;
const clone = (x) => JSON.parse(JSON.stringify(x));
function card(id, text, extra) {
  return Object.assign({ id, text, notes: "", due: null, labels: [], subtasks: [], info: [], mtime: T0, pos: 0 }, extra || {});
}
function data() {
  return M.canonState({
    ver: 5, om: 1, boardDeleted: {},
    boards: [{ id: "b1", name: "Βιβλίο", mtime: T0, om: T0, deleted: {}, labels: [],
      columns: [
        { id: "c1", name: "Todo", mtime: T0, om: T0, cards: [
          card("k1", "Επιμέλεια", { start: "2026-11-16", due: "2026-11-20" }),
          card("k2", "Σελιδοποίηση", { start: "2026-11-23", due: "2026-11-27", deps: ["k1"] }),
          card("k3", "Παρουσίαση", { start: "2026-11-16", due: "2026-12-04", ms: 1 }),
          card("k4", "Εξώφυλλο", { start: "2026-11-18" })] },
        { id: "c2", name: "Done", mtime: T0, om: T0, cards: [card("k5", "Παλιό", { start: "2026-11-16", due: "2026-11-17" })] }] },
      { id: "b2", name: "Old", archived: true, mtime: T0, deleted: {}, labels: [],
        columns: [{ id: "c9", name: "A", mtime: T0, om: T0, cards: [card("k9", "Archived", { start: "2026-11-16", due: "2026-11-30" })] }] }]
  }, T0);
}
const find = (d, id) => { for (const b of d.boards) for (const c of b.columns) for (const k of c.cards) if (k.id === id) return k; return null; };

test("startCards: a planned start that is not the due day, never a milestone, never archived", () => {
  const d = data();
  assert.deepEqual(KC.startCards(d, "2026-11-16", "2026-11-16").map((x) => x.card.id), ["k1", "k5"]);
  assert.deepEqual(KC.startCards(d, "2026-11-16", "2026-11-16", { skipLast: true }).map((x) => x.card.id), ["k1"]);
  assert.deepEqual(KC.startCards(d, "2026-11-18", "2026-11-18").map((x) => x.card.id), ["k4"], "a start without a due date counts");
  const same = clone(d); find(same, "k1").start = "2026-11-20";
  assert.deepEqual(KC.startCards(same, "2026-11-20", "2026-11-20").map((x) => x.card.id), [], "start = due: the due mark only");
  // dueCards is unchanged
  assert.deepEqual(KC.dueCards(d, "2026-11-20", "2026-11-20").map((x) => x.card.id), ["k1"]);
});

test("Today: a Starts today row (event, never late) next to the due rows", () => {
  const ctx = { today: "2026-11-16", horizon: 3, lang: "el", readJSON: () => data(), addDays: (ymd, n) => { const t = new Date(ymd + "T12:00:00Z"); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); } };
  const rows = TODAY.collect(ctx);
  const st = rows.filter((r) => /\/start$/.test(r.id));
  assert.deepEqual(st.map((r) => r.target.card), ["k1"]);
  assert.equal(st[0].kind, "event");
  assert.equal(st[0].due, "2026-11-16");
  assert.match(st[0].text, /^Ξεκινά σήμερα · Βιβλίο · Todo$/);
  assert.ok(!rows.some((r) => r.target.card === "k5"), "the last column stays out");
  assert.match(TODAY.collect(Object.assign({}, ctx, { lang: "en" })).filter((r) => /\/start$/.test(r.id))[0].text, /^Starts today/);
});

let n = 0;
const nid = () => "new" + (++n);

test("Gate: change_card sets the plan (group g), refuses loops and a start after the due day; undo puts it back", () => {
  const raw = data();
  const r = G.kanbanWrite(M, "change_card", raw, { board: "b1", card: "k4", start: "2026-11-17", milestone: false, depends_on: ["Επιμέλεια"] }, NOW, nid);
  assert.equal(r.ok, true, r.err);
  const k = find(r.data, "k4");
  assert.equal(k.start, "2026-11-17");
  assert.deepEqual(k.deps, ["k1"], "by exact text, kept as the id");
  assert.equal(k.fm.g, NOW);
  assert.deepEqual(r.undo.cards.k4.g, ["g"]);
  // a loop: k1 cannot wait for k2 (k2 waits for k1)
  const loop = G.kanbanWrite(M, "change_card", raw, { board: "b1", card: "k1", depends_on: ["k2"] }, NOW, nid);
  assert.equal(loop.ok, false); assert.match(loop.err, /loop/);
  assert.match(G.kanbanWrite(M, "change_card", raw, { board: "b1", card: "k1", depends_on: ["k1"] }, NOW, nid).err, /itself/);
  assert.match(G.kanbanWrite(M, "change_card", raw, { board: "b1", card: "k1", start: "2026-11-25" }, NOW, nid).err, /after the due date/);
  assert.match(G.kanbanWrite(M, "change_card", raw, { board: "b1", card: "k1", depends_on: ["Nope"] }, NOW, nid).err, /no card/);
  assert.match(G.kanbanWrite(M, "change_card", raw, { board: "b1", card: "k1", start: "2026-11-16" }, NOW, nid).err, /Nothing to change/);
  // clear: "" and [] remove the keys
  const c2 = G.kanbanWrite(M, "change_card", raw, { board: "b1", card: "k2", start: "", depends_on: [] }, NOW, nid);
  assert.equal(c2.ok, true, c2.err);
  assert.ok(!("start" in find(c2.data, "k2")) && !("deps" in find(c2.data, "k2")));
  // undo
  const u = G.kanbanUndo(M, r.data, r.undo, NOW + 100);
  assert.equal(u.ok, true, u.err); assert.equal(u.n, 1);
  const back = find(u.data, "k4");
  assert.equal(back.start, "2026-11-18");
  assert.ok(!("deps" in back));
  assert.equal(back.fm.g, NOW + 100);
  assert.equal(JSON.stringify(M.canonState(clone(u.data), NOW + 100)), JSON.stringify(u.data), "canonical");
  // the change merges with a concurrent text edit on another device
  const other = clone(raw); const ko = find(other, "k4"); ko.text = "Εξώφυλλο 2"; M.stampCard(ko, ["t"], NOW + 5);
  const m = M.mergeKanbanStates(clone(r.data), M.canonState(other, NOW + 5), NOW + 10);
  assert.equal(find(m, "k4").text, "Εξώφυλλο 2"); assert.equal(find(m, "k4").start, "2026-11-17");
});

test("Gate: add_cards takes start and milestone", () => {
  const r = G.kanbanWrite(M, "add_cards", data(), { board: "b1", cards: [
    { column: "Todo", text: "Τυπογραφείο", start: "2026-11-30", due: "2026-12-03" },
    { column: "Todo", text: "Launch", due: "2026-12-10", milestone: true }] }, NOW, nid);
  assert.equal(r.ok, true, r.err);
  const [a, b] = r.ids.map((id) => find(r.data, id));
  assert.equal(a.start, "2026-11-30"); assert.ok(!("ms" in a));
  assert.equal(b.ms, 1);
  assert.match(G.kanbanWrite(M, "add_cards", data(), { board: "b1", cards: [{ column: "Todo", text: "x", start: "2026-12-05", due: "2026-12-01" }] }, NOW, nid).err, /Card 1: start/);
});

const ch = (a) => { const r = E.normArgs(Object.assign({ ref: "r1" }, a)); assert.equal(r.ok, true, r.err); return r; };
const tg = (id) => ({ board: "b1", col: "c1", card: id });

test("Assistant change_item: plan_start, milestone, depends_on by title; undo", () => {
  const d = data();
  const c = ch({ action: "update", plan_start: "2026-11-17", depends_on: ["επιμελεια"] });
  const p = E.plan("kanban", d, tg("k4"), c, NOW);
  assert.equal(p.ok, true, p.err);
  const r = E.apply("kanban", d, tg("k4"), c, NOW, p.before);
  assert.equal(r.ok, true, r.err);
  const k = find(r.data, "k4");
  assert.equal(k.start, "2026-11-17"); assert.deepEqual(k.deps, ["k1"]);
  assert.equal(k.fm.g, NOW);
  assert.equal(JSON.stringify(M.canonState(clone(r.data), NOW)), JSON.stringify(r.data), "canonical");
  // the diff shows the plan
  const after = E.plan("kanban", r.data, tg("k4"), ch({ action: "update", milestone: true }), NOW + 1);
  assert.equal(after.ok, true, after.err);
  assert.equal(after.before.plan, "2026-11-17");
  assert.equal(after.before.deps, "Επιμέλεια");
  // refusals
  assert.match(E.plan("kanban", d, tg("k1"), ch({ action: "update", depends_on: ["Σελιδοποίηση"] }), NOW).err, /loop/);
  assert.match(E.plan("kanban", d, tg("k1"), ch({ action: "update", plan_start: "2026-11-30" }), NOW).err, /after the card's due date/);
  assert.match(E.plan("kanban", d, tg("k1"), ch({ action: "update", depends_on: ["Nope"] }), NOW).err, /no card called/);
  assert.equal(E.normArgs({ ref: "r1", action: "update", milestone: "yes" }).ok, false);
  assert.equal(E.normArgs({ ref: "r1", action: "update", plan_start: "16/11" }).ok, false);
  // undo
  const u = E.undo("kanban", r.data, r.undo, NOW + 10);
  assert.equal(u.ok, true, u.err);
  const back = find(u.data, "k4");
  assert.equal(back.start, "2026-11-18"); assert.ok(!("deps" in back));
  assert.equal(back.fm.g, NOW + 10);
  // clear with ""
  const cl = ch({ action: "update", plan_start: "" });
  const r2 = E.apply("kanban", data(), tg("k1"), cl, NOW, E.plan("kanban", data(), tg("k1"), cl, NOW).before);
  assert.equal(r2.ok, true, r2.err);
  assert.ok(!("start" in find(r2.data, "k1")));
});

test("Assistant create_items: plan_start and milestone on a new card", () => {
  const CTX = { today: "2026-11-13", lang: "en" };
  const items = A.normItems({ app: "kanban", items: [{ title: "Τυπογραφείο", date: "2026-12-03", plan_start: "2026-11-30" }, { title: "Launch", date: "2026-12-10", milestone: true }] }, CTX);
  assert.equal(items.ok, true, items.err);
  const d = data();
  const p = A.plan("kanban", d, items.items, CTX);
  assert.equal(p.ok, true, p.err);
  const r = A.apply("kanban", d, items.items, NOW, {}, CTX);
  assert.equal(r.ok, true, r.err);
  const made = r.made.map((x) => find(r.data, x.id));
  assert.equal(made[0].start, "2026-11-30");
  assert.equal(made[1].ms, 1);
  assert.equal(typeof made[0].fm.g, "number", "every field group stamped, g too");
  assert.equal(JSON.stringify(M.canonState(clone(r.data), NOW)), JSON.stringify(r.data), "canonical");
  assert.equal(A.normItems({ app: "kanban", items: [{ title: "x", date: "2026-12-01", plan_start: "2026-12-05" }] }, CTX).ok, false);
});

test("import: a start date becomes the plan start (Jira, Asana), not an extra field", () => {
  const jira = "Summary,Issue key,Issue id,Status,Due Date,Custom field (Start date)\n" +
               "Write,BK-1,100,To Do,12/Mar/24 10:00 AM,04/Mar/24 9:00 AM\n" +
               "Late,BK-2,101,To Do,2024-03-01,2024-03-09\n";
  const res = I.parseText(jira, "jira.csv", { done: "Done", none: "No section" });
  assert.equal(res.source, "jira");
  const cs = res.exports[0].cards;
  assert.equal(cs[0].start, "2024-03-04");
  assert.equal(cs[0].due, "2024-03-12");
  assert.ok(!("start" in cs[1]), "a start after the due day is left out");
  const asana = JSON.stringify({ data: [{ gid: "1", name: "Brief", notes: "", completed: false, start_on: "2024-03-04", due_on: "2024-03-10", memberships: [{ section: { name: "Backlog" } }] }] });
  const a = I.parseText(asana, "a.json", { done: "Done", none: "No section" }).exports[0].cards[0];
  assert.equal(a.start, "2024-03-04");
  assert.ok(!a.info.some((f) => f.label === "Start Date"));
});
