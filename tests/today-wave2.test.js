// Today wave 2: the shared read-only cores that replaced copies in
// the shell and the Calendar — calendar/occur.js, todo/core.js,
// quote/core.js, kanban/core.js, contacts/dates.js — locked against
// the code they replaced (golden tests: same input, same answer;
// the two intended changes are tested on their own), plus the Today
// providers of To-Do, Quote, Kanban, Contacts and the Calendar's own
// events.
// Run: node --test tests/

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const req = (p) => require(path.join(__dirname, "..", p));

const A = req("today/agg.js");
const OCC = globalThis.OrosCalOccur = req("calendar/occur.js");
const TC = globalThis.OrosTodoCore = req("todo/core.js");
const QC = globalThis.OrosQuoteCore = req("quote/core.js");
const KC = globalThis.OrosKanbanCore = req("kanban/core.js");
const CD = globalThis.OrosContactDates = req("contacts/dates.js");
globalThis.OrosNamedays = req("calendar/namedays.js");
const P = {};
["todo", "quote", "kanban", "contacts", "calendar"].forEach((id) => { P[id] = req(id + "/today.js"); });

function ctx(store, today, lang) {
  return {
    today, horizon: A.HORIZON, now: Date.now(), lang: lang || "en",
    readJSON: (k) => (k in store ? JSON.parse(JSON.stringify(store[k])) : null),
    readRaw: (k) => (k in store ? JSON.stringify(store[k]) : null),
    addDays: A.addDays, diff: A.diff
  };
}
let seed = 11;
const rnd = (n) => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed % n; };
const pad = (n) => String(n).padStart(2, "0");
const day = () => `${2024 + rnd(4)}-${pad(1 + rnd(12))}-${pad(1 + rnd(28) + (rnd(4) === 0 ? 3 : 0))}`;

// ---------------------------------------------------------------
// The code these cores replaced (verbatim logic, kept here only as
// the reference the new cores must keep matching)
// ---------------------------------------------------------------
function legacyEach(e, cb) {
  const ymd = (y, m, d) => y + "-" + pad(m + 1) + "-" + pad(d);
  const dim = (y, m) => new Date(y, m + 1, 0).getDate();
  if (!(e.recur && /^[DWMY]$/.test(e.recur.freq || ""))) return;
  const p = e.date.split("-");
  let y = +p[0], m = +p[1] - 1, d = +p[2];
  const origDay = d, r = e.recur, interval = r.interval === 2 ? 2 : 1;
  const until = typeof r.until === "string" && /^\d{4}-\d{2}-\d{2}$/.test(r.until) ? r.until : null;
  const ex = {};
  if (Array.isArray(r.exdates)) for (let x = 0; x < r.exdates.length && x < 100; x++) if (/^\d{4}-\d{2}-\d{2}$/.test(r.exdates[x])) ex[r.exdates[x]] = true;
  const MAX = r.freq === "D" ? 40000 : r.freq === "W" ? 5200 : 600;
  for (let s = 0; s < MAX; s++) {
    const o = ymd(y, m, d);
    if (until && o > until) return;
    if (!ex[o] && cb(o) === false) return;
    if (r.freq === "D") d += interval;
    else if (r.freq === "W") d += 7 * interval;
    else if (r.freq === "M") { m += interval; while (m > 11) { m -= 12; y++; } d = Math.min(origDay, dim(y, m)); }
    else { y += interval; d = Math.min(origDay, dim(y, m)); }
    const dm = dim(y, m);
    if (d > dm) { d -= dm; m++; if (m > 11) { m = 0; y++; } }
  }
}
function legacyTodoTick(raw, today) {
  let due = 0, earliest = null, earliestList = null;
  raw.lists.forEach((l) => {
    if (!l || !Array.isArray(l.items)) return;
    l.items.forEach((it) => {
      if (!it || it.done || typeof it.due !== "string") return;
      if (it.due <= today) { due++; if (earliest === null || it.due < earliest) { earliest = it.due; earliestList = l.id; } }
    });
  });
  return { count: due, earliest, earliestList };
}
function legacyKanban(data, ds) {
  const out = [];
  (data.boards || []).forEach((bd) => {
    if (!bd || bd.archived) return;
    (Array.isArray(bd.columns) ? bd.columns : []).forEach((col) => {
      (Array.isArray(col.cards) ? col.cards : []).forEach((card) => { if (card && card.due === ds) out.push(card.id); });
    });
  });
  return out;
}
function legacyContacts(cs, ds) {
  const mmdd = ds.slice(5), out = [];
  cs.forEach((c) => {
    if (!c || typeof c !== "object" || typeof c.id !== "string") return;
    (Array.isArray(c.events) ? c.events : []).forEach((ev, ix) => { if (ev && typeof ev === "object" && ev.day === mmdd) out.push(c.id + ":" + ix); });
  });
  return out;
}
function legacyQuotes(raw, horizon) {
  let due = 0, earliestId = null, earliestDue = null;
  raw.quotes.forEach((q) => {
    if (!q || !q.id || typeof q.dueDate !== "string") return;
    if (q.status !== "sent" && q.status !== "accepted") return;
    if (q.dueDate <= horizon) { due++; if (earliestDue === null || q.dueDate < earliestDue) { earliestId = q.id; earliestDue = q.dueDate; } }
  });
  return { due, earliestId };
}

// ---------------------------------------------------------------
// Golden tests
// ---------------------------------------------------------------

test("occur: every series walks exactly as before (fuzz, 400 series)", () => {
  const FREQ = ["D", "W", "M", "Y"];
  for (let i = 0; i < 400; i++) {
    const freq = FREQ[rnd(4)];
    const e = { id: "e" + i, date: day(), recur: { freq, interval: freq === "W" && rnd(2) ? 2 : 1 } };
    if (rnd(3) === 0) e.recur.until = day();
    if (rnd(3) === 0) e.recur.exdates = [day(), day(), "bad"];
    const a = [], b = [];
    let n = 0; legacyEach(e, (o) => { a.push(o); return ++n < 60; });
    n = 0; OCC.eachOccurrence(e, (o) => { b.push(o); return ++n < 60; });
    assert.deepEqual(b, a, JSON.stringify(e));
  }
});

test("occur: sticky clamp, leap days, exdates, until, spans", () => {
  const take = (e, k) => { const o = []; OCC.eachOccurrence(e, (x) => { o.push(x); return o.length < k; }); return o; };
  assert.deepEqual(take({ date: "2026-01-31", recur: { freq: "M" } }, 4), ["2026-01-31", "2026-02-28", "2026-03-31", "2026-04-30"]);
  assert.deepEqual(take({ date: "2024-02-29", recur: { freq: "Y" } }, 3), ["2024-02-29", "2025-02-28", "2026-02-28"]);
  assert.deepEqual(take({ date: "2026-10-01", recur: { freq: "D", exdates: ["2026-10-02"], until: "2026-10-04" } }, 9),
    ["2026-10-01", "2026-10-03", "2026-10-04"]);
  assert.equal(OCC.occursOn({ date: "2026-10-05", recur: { freq: "W", interval: 2 } }, "2026-10-19"), true);
  assert.equal(OCC.occursOn({ date: "2026-10-05", recur: { freq: "W", interval: 2 } }, "2026-10-12"), false);
  assert.equal(OCC.occursOn({ date: "2026-10-05", dateEnd: "2026-10-07" }, "2026-10-06"), true);
  assert.equal(OCC.occursOn({ date: "2026-10-05", dateEnd: "2026-10-07" }, "2026-10-08"), false);
  assert.equal(OCC.occursOn({ date: "bad", recur: { freq: "D" } }, "2026-10-08"), false);
  const data = { events: [
    { id: "b", date: "2026-10-11", title: "all day" },
    { id: "a", date: "2026-10-11", start: "09:00", title: "nine" },
    { id: "c", date: "2026-10-04", start: "08:00", recur: { freq: "W" }, title: "weekly" },
    { id: "gone", date: "2026-10-11", title: "deleted" }, null, { id: 5 }
  ], deleted: [{ id: "gone", mtime: 1 }] };
  assert.deepEqual(OCC.eventsOn(data, "2026-10-11").map((e) => e.id), ["c", "a", "b"]);
  assert.deepEqual(OCC.eventsOn(null, "2026-10-11"), []);
});

test("todo: due summary and day feed as before (fuzz)", () => {
  for (let i = 0; i < 200; i++) {
    const lists = [];
    for (let l = 0; l < 3; l++) {
      const items = [];
      for (let k = 0; k < 6; k++) items.push({ id: `i${l}${k}`, text: "t", done: rnd(3) === 0, due: rnd(4) ? day() : null });
      lists.push({ id: "l" + l, name: "L" + l, items });
    }
    const raw = { lists }, today = day();
    assert.deepEqual(TC.dueSummary(raw, today), legacyTodoTick(raw, today));
    const ds = lists[0].items[0].due || today;
    const legacyFeed = [];
    lists.forEach((l) => l.items.forEach((it) => { if (!it.done && it.due === ds) legacyFeed.push(it.id); }));
    assert.deepEqual(TC.dueOn(raw, ds).map((x) => x.item.id), legacyFeed);
  }
  // To-Do stores a missing date as null; a stray "" no longer counts as due
  assert.equal(TC.dueSummary({ lists: [{ id: "l", items: [{ id: "x", due: "" }] }] }, "2026-10-11").count, 0);
});

test("quote: same reminders as before, except quotes without a due date (fixed)", () => {
  for (let i = 0; i < 200; i++) {
    const quotes = [];
    for (let k = 0; k < 8; k++) quotes.push({ id: "q" + k, num: "OFF-2026-00" + k,
      status: ["draft", "sent", "accepted", "rejected", "expired"][rnd(5)], dueDate: day() });
    const raw = { quotes }, h = day();
    const was = legacyQuotes(raw, h), now = QC.dueQuotes(raw, h);
    assert.equal(now.length, was.due);
    if (was.due) assert.equal(now[0].dueDate, quotes.find((q) => q.id === was.earliestId).dueDate);
  }
  // the old loop counted a sent quote with no due date ("" <= horizon)
  const raw = { quotes: [{ id: "q1", status: "sent", dueDate: "" }] };
  assert.equal(legacyQuotes(raw, "2026-10-13").due, 1);
  assert.deepEqual(QC.dueQuotes(raw, "2026-10-13"), []);
  assert.equal(QC.clientName({ clients: [{ id: "c1", name: "Acme" }] }, { clientId: "c1" }), "Acme");
  assert.equal(QC.clientName({}, { clientId: "c1" }), "");
});

test("kanban: Calendar feed as before; Today leaves out each board's last column", () => {
  for (let i = 0; i < 150; i++) {
    const boards = [];
    for (let b = 0; b < 3; b++) {
      const columns = [];
      for (let c = 0; c < 3; c++) {
        const cards = [];
        for (let k = 0; k < 4; k++) cards.push({ id: `c${b}${c}${k}`, text: "x", due: rnd(3) ? day() : null });
        columns.push({ id: `col${b}${c}`, name: "C" + c, cards });
      }
      boards.push({ id: "b" + b, name: "B" + b, archived: rnd(4) === 0, columns });
    }
    const raw = { boards }, ds = boards[0].columns[0].cards[0].due || day();
    assert.deepEqual(KC.dueCards(raw, ds, ds).map((x) => x.card.id), legacyKanban(raw, ds));
  }
  const raw = { boards: [{ id: "b", name: "Work", columns: [
    { id: "todo", name: "To do", cards: [{ id: "k1", text: "Write", due: "2026-10-10" }] },
    { id: "done", name: "Done", cards: [{ id: "k2", text: "Shipped", due: "2026-10-10" }] }] },
    { id: "one", name: "Solo", columns: [{ id: "only", name: "All", cards: [{ id: "k3", text: "Only", due: "2026-10-11" }] }] }] };
  assert.deepEqual(KC.dueCards(raw, null, "2026-10-12", { skipLast: true }).map((x) => x.card.id), ["k1", "k3"]);
  assert.deepEqual(KC.dueCards(raw, null, "2026-10-12").map((x) => x.card.id), ["k1", "k2", "k3"]);
});

test("contacts: dates as before, and 29 February shows on the 28th in other years (fixed)", () => {
  for (let i = 0; i < 150; i++) {
    const cs = [];
    for (let k = 0; k < 6; k++) cs.push({ id: "c" + k, given: "N" + k, events: [{ day: day().slice(5), type: "birthday" }, { day: "02-29", type: "birthday" }] });
    const ds = day();
    const leapFix = ds.slice(5) === "02-28" && !CD.isLeap(+ds.slice(0, 4));
    if (leapFix) continue;
    assert.deepEqual(CD.eventsOn(cs, ds).map((x) => x.contact.id + ":" + x.ix), legacyContacts(cs, ds));
  }
  const cs = [{ id: "c1", given: "Leap", events: [{ day: "02-29", year: 2000, type: "birthday" }] }];
  assert.deepEqual(legacyContacts(cs, "2026-02-28"), []);
  assert.deepEqual(CD.eventsOn(cs, "2026-02-28").map((x) => [x.contact.id, x.years]), [["c1", 26]]);
  assert.deepEqual(CD.eventsOn(cs, "2028-02-28"), []);                       // leap year: on the 29th
  assert.deepEqual(CD.eventsOn(cs, "2028-02-29").map((x) => x.years), [28]);
  assert.deepEqual(CD.eventsOn(cs, "2026-02-28", [{ id: "c1", mtime: 1 }]), []);   // tombstoned
  assert.equal(CD.displayName({ given: "A", family: "B" }), "A B");
  assert.equal(CD.displayName({ org: "Acme" }), "Acme");
});

// ---------------------------------------------------------------
// Providers
// ---------------------------------------------------------------

test("todo provider: late, today and next days; Done carries list and task", () => {
  const store = { "oros-todo-data": { lists: [{ id: "l1", name: "Home", items: [
    { id: "a", text: "Pay power bill", due: "2026-10-08", done: false },
    { id: "b", text: "Call mum", due: "2026-10-11", done: false },
    { id: "c", text: "Done one", due: "2026-10-11", done: true },
    { id: "d", text: "Far", due: "2026-10-20", done: false },
    { id: "e", text: "No date", done: false }] }] } };
  const rows = P.todo.collect(ctx(store, "2026-10-11"));
  assert.deepEqual(rows.map((r) => [r.title, r.due, r.text]), [["Pay power bill", "2026-10-08", "Home"], ["Call mum", "2026-10-11", "Home"]]);
  assert.deepEqual(rows[0].done, { list: "l1", item: "a" });
  assert.deepEqual(A.cleanRow(rows[0], "todo").done, { list: "l1", item: "a" });
  assert.deepEqual(P.todo.collect(ctx({}, "2026-10-11")), []);
});

test("quote provider: open follow-ups with number and client", () => {
  const store = { "oros-quote-data": { clients: [{ id: "c1", name: "Acme" }], quotes: [
    { id: "q1", num: "OFF-2026-001", clientId: "c1", status: "sent", dueDate: "2026-10-09" },
    { id: "q2", num: "OFF-2026-002", status: "draft", dueDate: "2026-10-11" },
    { id: "q3", num: "OFF-2026-003", status: "accepted", dueDate: "2026-10-30" }] } };
  const rows = P.quote.collect(ctx(store, "2026-10-11"));
  assert.deepEqual(rows.map((r) => [r.title, r.due]), [["OFF-2026-001 · Acme", "2026-10-09"]]);
  let opened = null;
  P.quote.open({ quote: "q1" }, { __orosOpenQuote: (id) => { opened = id; } });
  assert.equal(opened, "q1");
});

test("kanban provider: due cards outside the Done column, archived boards out", () => {
  const store = { "oros-kanban-data": { boards: [
    { id: "b1", name: "Work", columns: [
      { id: "c1", name: "To do", cards: [{ id: "k1", text: "Draft spec", due: "2026-10-12" }] },
      { id: "c2", name: "Done", cards: [{ id: "k2", text: "Old", due: "2026-10-01" }] }] },
    { id: "b2", name: "Old", archived: true, columns: [{ id: "c3", name: "X", cards: [{ id: "k3", text: "Hidden", due: "2026-10-11" }] }, { id: "c4", name: "Y", cards: [] }] }] } };
  const rows = P.kanban.collect(ctx(store, "2026-10-11"));
  assert.deepEqual(rows.map((r) => [r.title, r.text, r.due]), [["Draft spec", "Work · To do", "2026-10-12"]]);
  const calls = [];
  P.kanban.open(rows[0].target, { __orosOpenKanbanCard: (...a) => calls.push(a) });
  assert.deepEqual(calls, [["b1", "c1", "k1"]]);
});

test("contacts provider: birthdays with the age, anniversaries, custom dates", () => {
  const store = { "oros-contacts-data": { contacts: [
    { id: "c1", given: "Maria", family: "K", events: [{ day: "10-12", year: 1992, type: "birthday" }] },
    { id: "c2", given: "Nikos", events: [{ day: "10-11", year: null, type: "anniversary" }, { day: "10-13", type: "custom", label: "Name day" }] }] } };
  const rows = P.contacts.collect(ctx(store, "2026-10-11"));
  assert.deepEqual(rows.map((r) => [r.due, r.title]), [
    ["2026-10-11", "Nikos: anniversary"], ["2026-10-12", "🎂 Maria K turns 34"], ["2026-10-13", "Nikos: Name day"]]);
  assert.equal(P.contacts.collect(ctx(store, "2026-10-11", "el"))[1].title, "🎂 Maria K: γενέθλια (34)");
});

test("calendar provider: own events with time, series, spans once", () => {
  const store = { "oros-calendar-data": { events: [
    { id: "e1", date: "2026-10-11", start: "09:30", title: "Dentist", location: "Center" },
    { id: "e2", date: "2026-10-05", recur: { freq: "W" }, title: "Yoga", start: "19:00" },
    { id: "e3", date: "2026-10-09", dateEnd: "2026-10-16", title: "Conference" },
    { id: "e4", date: "2026-10-13", dateEnd: "2026-10-15", title: "Trip" },
    { id: "e5", date: "2026-10-11", title: "" }], deleted: [] } };
  const rows = P.calendar.collect(ctx(store, "2026-10-11")).filter((r) => r.id.startsWith("ev:"));
  assert.deepEqual(rows.map((r) => [r.due, r.time, r.title]), [
    ["2026-10-11", "09:30", "Dentist"], ["2026-10-11", null, "Conference"], ["2026-10-11", null, "(untitled)"],
    ["2026-10-12", "19:00", "Yoga"], ["2026-10-13", null, "Trip"]]);
  assert.equal(rows[0].text, "Center");
  const calls = [];
  P.calendar.open(rows[0].target, { __orosOpenCalendar: (a, b) => calls.push([a, b]) });
  assert.deepEqual(calls, [["e1", "2026-10-11"]]);
});
