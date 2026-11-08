// Today T1 (BR-TODAY-15): row details (`more`), one tip (`tip`) and
// up to 3 suggested actions (`acts`) — how agg.js cleans them, what
// the enriched providers give, and that every action ends in the
// target app's own receiver (Today never writes).
// Run: node --test tests/

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const ROOT = path.join(__dirname, "..");
const req = (p) => require(path.join(ROOT, p));
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");

const A = req("today/agg.js");
globalThis.OrosCalOccur = req("calendar/occur.js");
globalThis.OrosTodoCore = req("todo/core.js");
globalThis.OrosContactDates = req("contacts/dates.js");
globalThis.OrosNamedays = req("calendar/namedays.js");
globalThis.OrosHabitsCore = req("habits/core.js");
globalThis.orosWaterCore = req("water/core.js");
globalThis.OrosInvoicesCore = req("invoices/core.js");
const P = {};
["todo", "contacts", "calendar", "habits", "water", "invoices"].forEach((id) => { P[id] = req(id + "/today.js"); });

function ctx(store, today, lang, now) {
  return {
    today, horizon: A.HORIZON, now: now || Date.now(), lang: lang || "en",
    readJSON: (k) => (k in store ? JSON.parse(JSON.stringify(store[k])) : null),
    readRaw: (k) => (k in store ? (typeof store[k] === "string" ? store[k] : JSON.stringify(store[k])) : null),
    addDays: A.addDays, diff: A.diff
  };
}
async function rowsOf(p, c) { return (await A.run([p], c, {})).rows; }

// ---------- agg.js ----------
test("cleanRow: more, tip and acts are cleaned and bounded", () => {
  const r = A.cleanRow({ title: "x",
    more: ["  one\n line ", "one line", "", 5, "b".repeat(200), "c", "d"],
    tip: "t".repeat(300),
    acts: [{ k: "later", target: { later: { list: "l", item: "i" } } },
           { k: "rm-rf", target: {} },                          // unknown kind
           { k: "later", target: { later: 1 } },                // one per kind
           { k: "route", app: "Maps!", target: { q: 1 } },      // bad app id
           { k: "tick" },                                       // no target
           { k: "sip", target: { s: "z".repeat(600) } },        // target too long
           { k: "route", app: "maps", target: { routeTo: { query: "Center" } } },
           { k: "open", target: { a: 1 } },
           { k: "gift", app: "todo", target: { addItems: {} } }] }, "todo");
  assert.deepEqual(r.more, ["one line", "b".repeat(120), "c"]);
  assert.equal(r.tip.length, 200);
  assert.deepEqual(r.acts, [
    { k: "later", app: "todo", target: { later: { list: "l", item: "i" } }, via: "at" },
    { k: "route", app: "maps", target: { routeTo: { query: "Center" } }, via: "at" },
    { k: "open", app: "todo", target: { a: 1 }, via: "open" }]);
  const bare = A.cleanRow({ title: "y", acts: "no", more: "no" }, "a");
  assert.deepEqual([bare.more, bare.tip, bare.acts], [[], "", []]);
});

test("ACTS: every kind has a label and an icon in the Today app (EN, EL, DE)", () => {
  const src = read("today/today.js"), de = read("i18n/de/today.js");
  Object.keys(A.ACTS).forEach((k) => {
    assert.equal((src.match(new RegExp('"act\\.' + k + '":', "g")) || []).length, 2, k + " EN + EL");
    assert.ok(de.indexOf('"act.' + k + '":') > 0, k + " DE");
    assert.match(src, new RegExp("ACT_ICON = \\{[^}]*\\b" + k + ":"), k + " icon");
  });
});

test("askText carries the details to the Assistant", () => {
  const s = A.askText({ title: "Dentist", time: "09:30", text: "Center", more: ["09:30–10:00", "Bring the card"] }, "Calendar", "Monday", "en");
  assert.match(s, /Dentist \(09:30\) — Center — 09:30–10:00 · Bring the card/);
});

// ---------- providers ----------
test("To-Do: priority, steps, note; Tomorrow for late or today; a tip a week late", async () => {
  const today = "2026-11-08";
  const store = { "oros-todo-data": { lists: [{ id: "l1", name: "Home", items: [
    { id: "a", text: "Taxes", due: "2026-10-30", prio: 1, notes: "\n\nCall the accountant\nsecond" },
    { id: "b", text: "Paint", due: today, subs: [{ id: "s1", text: "buy", done: true }, { id: "s2", text: "do" }] },
    { id: "c", text: "Later", due: "2026-11-10" }] }] } };
  const rows = await rowsOf(P.todo, ctx(store, today));
  const by = Object.fromEntries(rows.map((r) => [r.id, r]));
  assert.deepEqual(by["l1/a"].more, ["Priority P1", "Call the accountant"]);
  assert.match(by["l1/a"].tip, /more than a week/);
  assert.deepEqual(by["l1/a"].acts, [{ k: "later", app: "todo", target: { later: { list: "l1", item: "a" } }, via: "at" }]);
  assert.deepEqual(by["l1/b"].more, ["1 of 2 steps done"]);
  assert.match(by["l1/b"].tip, /next open step/);
  assert.deepEqual(by["l1/c"].acts, [], "nothing to move for a coming day");
  assert.equal((await rowsOf(P.todo, ctx(store, today, "el"))).find((r) => r.id === "l1/a").more[0], "Προτεραιότητα P1");
});

test("Calendar: time span, note, Directions to the place, tips; a name day offers the card and To-Do", async () => {
  const today = "2026-11-08";
  const morning = new Date(2026, 10, 8, 8, 0).getTime(), evening = new Date(2026, 10, 8, 21, 0).getTime();
  const store = { "oros-calendar-data": { events: [
    { id: "e1", date: today, start: "18:00", end: "19:00", title: "Dentist", location: "Center", note: "Bring the card\nx" },
    { id: "e2", date: "2026-11-09", start: "07:30", title: "Train" },
    { id: "e3", date: "2026-11-07", dateEnd: "2026-11-10", title: "Fair" }], deleted: [] },
    "oros-contacts-data": { contacts: [{ id: "c1", given: "Δημήτρης" }] } };
  let rows = await rowsOf(P.calendar, ctx(store, today, "en", morning));
  const ev = (id) => rows.find((r) => r.id.startsWith("ev:" + id + ":"));
  assert.deepEqual(ev("e1").more, ["18:00–19:00", "Bring the card"]);
  assert.deepEqual(ev("e1").acts, [{ k: "route", app: "maps", target: { routeTo: { query: "Center", name: "Dentist" } }, via: "at" }]);
  assert.match(ev("e1").tip, /18:00 at Center/);
  assert.match(ev("e2").tip, /early \(07:30\)/);
  assert.equal(ev("e3").more.length, 1);
  assert.match(ev("e3").more[0], /^From .+ to .+$/);
  rows = await rowsOf(P.calendar, ctx(store, today, "en", evening));
  assert.equal(ev("e1").tip, "", "no 'leave in time' after the start");
  const nd = (await rowsOf(P.calendar, ctx(store, "2026-10-26", "el"))).find((r) => r.id === "nd:c1");
  assert.ok(nd, "Dimitrios celebrates on 26 October");
  assert.deepEqual(nd.acts.map((a) => [a.k, a.app, a.via]), [["contact", "calendar", "open"], ["todo", "todo", "at"]]);
  assert.match(nd.acts[1].target.addItems.items[0].text, /Δημήτρης/);
  assert.equal(nd.acts[1].target.addItems.from, "Σήμερα");
});

test("Contacts: open the card, a gift idea and a tip before a birthday", async () => {
  const store = { "oros-contacts-data": { contacts: [
    { id: "c1", given: "Maria", events: [{ day: "11-10", year: 1990, type: "birthday" }] },
    { id: "c2", given: "Nikos", events: [{ day: "11-08", type: "custom", label: "Exam" }] }] } };
  const rows = await rowsOf(P.contacts, ctx(store, "2026-11-08"));
  const m = rows.find((r) => r.id.startsWith("c1:")), n = rows.find((r) => r.id.startsWith("c2:"));
  assert.match(m.tip, /In 2 days/);
  assert.deepEqual(m.acts.map((a) => [a.k, a.app]), [["contact", "contacts"], ["gift", "todo"]]);
  assert.equal(m.acts[1].target.addItems.items[0].text, "Gift for Maria");
  assert.deepEqual(n.acts.map((a) => a.k), ["contact"], "no gift for a custom date");
  assert.match(n.tip, /^Today/);
});

test("Habits: the streak, a tip to keep it, Tick it by id", async () => {
  const today = "2026-11-08";                               // Sunday
  const comps = ["2026-11-05", "2026-11-06", "2026-11-07"].map((d) => ({ id: "h1|" + d, habitId: "h1", date: d }));
  const store = { "oros-habits-data": { ver: 1, habits: [{ id: "h1", name: "Read", days: [0, 1, 2, 3, 4, 5, 6] }], comps } };
  const [r] = await rowsOf(P.habits, ctx(store, today));
  assert.deepEqual(r.more, ["Streak: 3 days"]);
  assert.match(r.tip, /^3 in a row/);
  assert.deepEqual(r.acts, [{ k: "tick", app: "habits", target: { tick: { id: "h1", name: "Read" } }, via: "at" }]);
});

test("Water: +1 glass only while the goal is not met", async () => {
  const today = A.ymdOf(new Date()), now = Date.now();
  const mk = (ml) => JSON.stringify({ ver: 1, sips: [{ id: "sip0001", ts: now, ml, m: now }], goals: [{ id: "2020-01-01", ml: 2000, m: now }] });
  const [low] = await rowsOf(P.water, ctx({ "oros-water-data": mk(250) }, today));
  assert.deepEqual(low.acts.map((a) => [a.k, a.app, JSON.stringify(a.target)]), [["sip", "water", '{"sip":"glass"}']]);
  const [full] = await rowsOf(P.water, ctx({ "oros-water-data": mk(2500) }, today));
  assert.deepEqual(full.acts, []);
});

test("Invoices: a tip only once the due day has passed", () => {
  const src = read("invoices/today.js");
  assert.match(src, /tip: r\.due && r\.due < ctx\.today \? w\["tdy\.tipOwed"\] : ""/);
  assert.match(src, /tip: b\.due < ctx\.today \? w\["tdy\.tipBill"\] : ""/);
});

// ---------- the receivers do the work ----------
test("To-Do { later }: its own code, the due field stamp only, Undo puts the old date back", () => {
  const src = read("todo/todo.js");
  assert.match(src, /if \(t && t\.later\) \{ laterFromToday\(t\.later\); return; \}/);
  const fn = src.slice(src.indexOf("function laterFromToday"), src.indexOf("window.__orosOpenAt = openSearchTarget;"));
  assert.match(fn, /touchField\(item, "due"\)/);
  assert.match(fn, /undoFn = function/);
  assert.match(fn, /if \(item\.done\) \{ showToast\(t\("toast\.already"\)/);
  assert.doesNotMatch(fn, /stampItemNewest|stampAll/);
  assert.ok(read("i18n/de/todo.js").indexOf('"toast.later":') > 0);
});

test("Habits { tick: { id } }: the id wins, the name still works", () => {
  const src = read("habits/habits.js");
  const fn = src.slice(src.indexOf("function tickByName"), src.indexOf("function openSearchTarget"));
  assert.match(fn, /typeof x\.id === "string" \? habitById\(x\.id\)/);
  assert.match(fn, /toggleComp\(h, d\)/);
});

test("Today draws details with textContent and acts only through host.act", () => {
  const src = read("today/today.js"), host = read("today/host.js");
  const fn = src.slice(src.indexOf("function details("), src.indexOf("var detSeq"));
  assert.doesNotMatch(fn, /innerHTML\s*=\s*(?!\s|SVG\.|svg)/);
  assert.match(fn, /H\.act\(a\)/);
  assert.doesNotMatch(src, /localStorage\.setItem\("oros-(todo|habits|water)/);
  const act = host.slice(host.indexOf("function act("), host.indexOf("// ---------- The daily notice"));
  assert.match(act, /A\.cleanAct\(/);
  assert.doesNotMatch(act, /localStorage|setItem/);
});
