// Universal search: the core (search.js) and the phase-1 providers
// (<app>/search.js). Plain node, no DOM: providers read through
// ctx.readJSON over an in-memory storage.
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const S = require(path.join(__dirname, "..", "search.js"));
const P = (id) => require(path.join(__dirname, "..", id, "search.js"));

function store(obj) {
  const m = new Map(Object.entries(obj).map(([k, v]) => [k, JSON.stringify(v)]));
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), m };
}
function ctxFor(storage, q, lang) {
  return { q, words: S.parseQuery(q), fold: S.fold, lang: lang || "en", limit: 50,
           readJSON: S.makeReader(storage) };
}

// ---------- core ----------
test("fold: case, accents and final sigma", () => {
  assert.equal(S.fold("Ημερολόγιο ΓΙΆΝΝΗΣ"), "ημερολογιο γιαννησ");
  assert.equal(S.fold("Café"), "cafe");
});

test("parseQuery: unique words, longest first", () => {
  assert.deepEqual(S.parseQuery("  αθ Αθήνα αθ "), ["αθηνα", "αθ"]);
  assert.deepEqual(S.parseQuery("   "), []);
});

test("score: every word must match, title beats text", () => {
  const w = S.parseQuery("γιαννης αθηνα");
  assert.equal(S.score({ title: "Γιάννης", text: "Πάτρα" }, w, "γιαννησ αθηνα"), -1);
  const both = S.score({ title: "Γιάννης", text: "Αθήνα" }, w, "γιαννησ αθηνα");
  const titleOnly = S.score({ title: "Γιάννης Αθήνα", text: "" }, w, "γιαννησ αθηνα");
  assert.ok(both > 0 && titleOnly > both);
  const w1 = S.parseQuery("milk");
  const pre = S.score({ title: "Milk run", text: "" }, w1, "milk");
  const word = S.score({ title: "Buy milk", text: "" }, w1, "milk");
  const inner = S.score({ title: "Buttermilk", text: "" }, w1, "milk");
  const body = S.score({ title: "Shopping", text: "milk" }, w1, "milk");
  assert.ok(pre > word && word > inner && inner > body && body > 0);
});

test("ranges: highlight lands on original letters (accents, case)", () => {
  const str = "Το Ημερολόγιο μου";
  const r = S.ranges(str, S.parseQuery("ημερολογιο"));
  assert.deepEqual(r, [[3, 13]]);
  assert.equal(str.slice(3, 13), "Ημερολόγιο");
  assert.deepEqual(S.ranges("aaa", ["a"]), [[0, 3]]);   // adjacent hits merge
  assert.deepEqual(S.ranges("😀 Ωμέγα", ["ωμεγα"]), [[3, 8]]);
});

test("snippet: around the first match, with ellipses", () => {
  const long = "Lorem ipsum dolor sit amet ".repeat(10) + "the boiler needs a check " + "x ".repeat(80);
  const sn = S.snippet(long, ["boiler"], 60);
  assert.ok(sn.startsWith("…") && sn.endsWith("…"));
  assert.ok(sn.includes("boiler"));
  assert.ok(sn.length <= 62);
  assert.equal(S.snippet("short  text\n here", ["x"]), "short text here");
  assert.equal(S.snippet("", ["x"]), "");
});

test("run: ranks, caps, skips bad hits, failing and slow providers", async () => {
  const many = [];
  for (let i = 0; i < 80; i++) many.push({ id: "m" + i, title: "Note " + i, text: "alpha", when: i });
  const providers = [
    { id: "a", search: () => [{ id: 1, title: "beta alpha" }, { id: 2, title: "Alpha" }, { title: "" }, null, { id: 3, title: "gamma" }] },
    { id: "b", search: () => { throw new Error("boom"); } },
    { id: "c", search: () => new Promise(() => {}) },                  // never answers
    { id: "d", search: () => Promise.resolve(many) },
    { id: "e", search: () => [{ id: 1, title: "alpha" }] },             // switched off
    { id: "f", search: () => [{ id: 1, title: "<img src=x onerror=alert(1)> alpha" }] }
  ];
  const groups = await S.run(providers, "alpha", {
    readJSON: () => null, timeoutMs: 50, enabled: (id) => id !== "e"
  });
  assert.deepEqual(groups.map((g) => g.id), ["a", "d", "f"]);
  assert.deepEqual(groups[0].hits.map((h) => h.id), ["2", "1"]);    // prefix first
  assert.equal(groups[1].total, 80);
  assert.equal(groups[1].hits.length, S.PER_APP_MAX);
  assert.equal(groups[1].hits[0].id, "m79");                         // tie → newest
  assert.equal(groups[2].hits[0].title, "<img src=x onerror=alert(1)> alpha");  // plain text, untouched
});

test("run: one character searches nothing", async () => {
  let called = false;
  const g = await S.run([{ id: "a", search: () => { called = true; return []; } }], "a", { readJSON: () => null });
  assert.deepEqual(g, []);
  assert.equal(called, false);
});

test("makeReader: parses once per stored string, sees changes", () => {
  const st = store({ k: { v: 1 } });
  let parses = 0;
  const orig = JSON.parse;
  JSON.parse = function (s) { parses++; return orig.apply(JSON, arguments); };
  try {
    const read = S.makeReader(st);
    const a = read("k"), b = read("k");
    assert.equal(a, b);
    assert.equal(parses, 1);
    st.setItem("k", JSON.stringify({ v: 2 }));
    assert.equal(read("k").v, 2);
    st.setItem("bad", "{oops");
    assert.equal(read("bad"), null);
    assert.equal(read("missing"), null);
  } finally { JSON.parse = orig; }
});

// ---------- providers ----------
test("notes: pages, untitled fallback, target", () => {
  const st = store({ "oros-notes-data": { ver: 3,
    notebooks: [{ id: "nb-default", name: "Notes" }],
    pages: [
      { id: "p1", nb: "nb-default", parent: null, title: "Groceries", text: "milk\neggs", mtime: 5 },
      { id: "p2", nb: "nb2", parent: "p1", title: "", text: "\n  Boiler service\nask Nikos", mtime: 6 }
    ],
    tombs: { pold: 1 } } });
  const hits = P("notes").search(ctxFor(st, "milk"));
  assert.equal(hits.length, 2);
  assert.deepEqual(hits[0].target, { page: "p1", nb: "nb-default" });
  assert.equal(hits[1].title, "Boiler service");
  assert.deepEqual(P("notes").search(ctxFor(store({}), "x")), []);
});

test("contacts: display name, fields as text, open through the bridge", () => {
  const st = store({ "oros-contacts-data": { ver: 1, contacts: [
    { id: "c1", given: "Μαρία", family: "Παπαδοπούλου", org: "Acme", phones: [{ v: "+30 210 1234567" }],
      emails: [{ v: "maria@example.com" }], addresses: [{ city: "Αθήνα" }], note: "βιολί" },
    { id: "c2", given: "", family: "", nickname: "", org: "Acme Ltd" }
  ], deleted: [{ id: "c0", mtime: 1 }] } });
  const hits = P("contacts").search(ctxFor(st, "acme"));
  assert.equal(hits[0].title, "Μαρία Παπαδοπούλου");
  assert.ok(hits[0].text.includes("1234567") && hits[0].text.includes("Αθήνα"));
  assert.equal(hits[1].title, "Acme Ltd");
  let opened = null;
  P("contacts").open("c1", { __orosOpenContact: (id) => { opened = id; } });
  assert.equal(opened, "c1");
});

test("todo: lists and tasks, due date, target", () => {
  const st = store({ "oros-todo-data": { ver: 3, deleted: { t0: 1 }, lists: [
    { id: "L1", name: "Personal", items: [
      { id: "t1", text: "Call plumber", done: false, due: "2026-10-12", notes: "boiler",
        info: [{ label: "Phone", value: "210 999" }] }] }
  ] } });
  const hits = P("todo").search(ctxFor(st, "plumber"));
  const task = hits.find((h) => h.id === "t1");
  assert.deepEqual(task.target, { list: "L1", item: "t1" });
  assert.ok(task.text.includes("boiler") && task.text.includes("Phone: 210 999") && task.text.includes("Personal"));
  assert.equal(new Date(task.when).getDate(), 12);
  assert.deepEqual(hits.find((h) => h.id === "l:L1").target, { list: "L1" });
});

test("calendar: next occurrence of a series, plain date otherwise", () => {
  const cal = P("calendar");
  const weekly = { id: "e", date: "2026-01-05", recur: { freq: "W", interval: 1, until: null, exdates: ["2026-10-12"] } };
  assert.equal(cal.pickDate(weekly, "2026-10-09"), "2026-10-19");  // 10-12 excluded
  assert.equal(cal.pickDate({ id: "e", date: "2026-01-31", recur: { freq: "M", interval: 1 } }, "2026-02-01"), "2026-02-28");
  assert.equal(cal.pickDate({ id: "e", date: "2026-01-05", recur: { freq: "D", interval: 1, until: "2026-01-10" } }, "2026-10-09"), "2026-01-10");
  assert.equal(cal.pickDate({ id: "e", date: "2026-03-01", recur: null }, "2026-10-09"), "2026-03-01");
  const st = store({ "oros-calendar-data": { ver: 1, events: [
    { id: "ev1", date: "2026-10-15", start: "09:30", end: "10:30", title: "Dentist", location: "Athens", note: "" },
    { id: "bad", date: "15/10/2026", title: "Broken" }
  ], deleted: [] } });
  const hits = cal.search(ctxFor(st, "dentist"));
  assert.equal(hits.length, 1);
  assert.deepEqual(hits[0].target, { id: "ev1", date: "2026-10-15" });
  assert.ok(hits[0].text.includes("09:30–10:30") && hits[0].text.includes("Athens"));
  let got = null;
  cal.open(hits[0].target, { __orosOpenCalendar: (a, b) => { got = [a, b]; } });
  assert.deepEqual(got, ["ev1", "2026-10-15"]);
});

test("kanban: cards, archived and deleted boards skipped", () => {
  const card = { id: "k1", text: "Fix login", notes: "Safari", due: "2026-10-20", subtasks: [{ text: "write test" }] };
  const st = store({ "oros-kanban-data": { ver: 5, boardDeleted: { B3: 1 }, boards: [
    { id: "B1", name: "Main", columns: [{ id: "C1", name: "To Do", cards: [card] }] },
    { id: "B2", name: "Old", archived: true, columns: [{ id: "C2", name: "x", cards: [card] }] },
    { id: "B3", name: "Gone", columns: [{ id: "C3", name: "x", cards: [card] }] }
  ] } });
  const hits = P("kanban").search(ctxFor(st, "login"));
  assert.equal(hits.length, 1);
  assert.deepEqual(hits[0].target, { board: "B1", col: "C1", card: "k1" });
  assert.ok(hits[0].text.includes("write test") && hits[0].text.includes("Main › To Do"));
  let got = null;
  P("kanban").open(hits[0].target, { __orosOpenKanbanCard: (a, b, c) => { got = [a, b, c]; } });
  assert.deepEqual(got, ["B1", "C1", "k1"]);
});

test("bookmarks: map of items, deleted ids skipped, url fallback", () => {
  const st = store({ "oros-bookmarks-data": { ver: 1,
    items: { a: { id: "a", url: "https://developer.mozilla.org/", title: "MDN", note: "docs", tags: ["dev"], folderId: "f1" },
             b: { id: "b", url: "https://example.com/", title: "", folderId: "unsorted" },
             c: { id: "c", url: "https://gone.example/", title: "Gone" } },
    folders: { unsorted: { id: "unsorted", name: "unsorted" }, f1: { id: "f1", name: "Work" } },
    deleted: { c: 1 } } });
  const hits = P("bookmarks").search(ctxFor(st, "x"));
  assert.deepEqual(hits.map((h) => h.id).sort(), ["a", "b"]);
  const a = hits.find((h) => h.id === "a");
  assert.ok(a.text.includes("#dev") && a.text.includes("Work"));
  assert.equal(hits.find((h) => h.id === "b").title, "https://example.com/");
});

test("writer: deleted docs skipped, HTML to text, untitled fallback", () => {
  const st = store({ "oros-writer-data": { ver: 1, docs: [
    { id: "d1", title: "", html: "<h1>Chapter 1</h1><p>It was a <b>dark</b> &amp; stormy night<sup class=\"fn-ref\">1</sup></p>", mtime: 3, tags: ["novel"] },
    { id: "d2", title: "", html: "", del: true, mtime: 4 }
  ] } });
  const hits = P("writer").search(ctxFor(st, "dark"));
  assert.equal(hits.length, 1);
  assert.equal(hits[0].title, "Chapter 1 It was a dark & stormy");
  assert.ok(!hits[0].text.includes("<") && !/night1/.test(hits[0].text));
  assert.deepEqual(hits[0].target, { doc: "d1" });
});

test("files: walks the disk through ls, names and folders", async () => {
  const tree = { "/internal": [{ name: "Docs", dir: true }, { name: "todo.txt", dir: false }],
                 "/internal/Docs": [{ name: "cv.pdf", dir: false }] };
  const files = P("files");
  const list = await files._walk({ ls: (p) => Promise.resolve(tree[p] || []) });
  assert.deepEqual(list.map((e) => e.path), ["/internal/Docs", "/internal/todo.txt", "/internal/Docs/cv.pdf"]);
  globalThis.orosFS = { ls: (p) => Promise.resolve(tree[p] || []) };
  try {
    const hits = await files.search(ctxFor(store({}), "cv"));
    const cv = hits.find((h) => h.id === "/internal/Docs/cv.pdf");
    assert.equal(cv.text, "/Docs");
    assert.deepEqual(cv.target, { path: "/internal/Docs/cv.pdf", dir: false });
    assert.equal(hits.find((h) => h.id === "/internal/Docs").title, "Docs/");
  } finally { delete globalThis.orosFS; }
});

test("every provider file is read-only (no storage writes)", () => {
  const fs = require("fs");
  ["notes", "contacts", "todo", "calendar", "kanban", "bookmarks", "writer", "files"].forEach((id) => {
    const src = fs.readFileSync(path.join(__dirname, "..", id, "search.js"), "utf8");
    assert.ok(!/setItem|removeItem|registerSlice|innerHTML/.test(src), id);
  });
});
