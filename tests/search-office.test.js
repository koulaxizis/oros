// Universal search, phase 2 — the "office" group providers:
// quote, timesheet, split, budget, spreadsheet, storage, minimalism.
// Plain node, no DOM: providers read through ctx.readJSON over an
// in-memory storage, exactly as the shell's core hands it to them.
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const S = require(path.join(__dirname, "..", "search.js"));
const P = (id) => require(path.join(__dirname, "..", id, "search.js"));
const IDS = ["quote", "timesheet", "split", "budget", "spreadsheet", "storage", "minimalism"];

function store(obj) {
  const m = new Map(Object.entries(obj).map(([k, v]) => [k, JSON.stringify(v)]));
  return { getItem: (k) => (m.has(k) ? m.get(k) : null) };
}
function ctxFor(storage, q, lang) {
  return { q, words: S.parseQuery(q || ""), fold: S.fold, lang: lang || "en", limit: 50,
           readJSON: S.makeReader(storage) };
}
function run(id, data, q, lang) {
  const p = P(id);
  return p.search(ctxFor(store({ [p.keys[0]]: data }), q, lang));
}
const byId = (hits) => Object.fromEntries(hits.map((h) => [h.id, h]));
const noon = (y, m, d) => new Date(y, m - 1, d, 12).getTime();

test("office providers: shape, ids and empty storage", () => {
  IDS.forEach((id) => {
    const p = P(id);
    assert.equal(p.id, id);
    assert.ok(Array.isArray(p.keys) && p.keys.length >= 1);
    assert.equal(typeof p.search, "function");
    assert.deepEqual(p.search(ctxFor(store({}), "ab")), [], id);
  });
});

test("office providers are read-only (no writes, no sync, no innerHTML)", () => {
  IDS.forEach((id) => {
    const src = fs.readFileSync(path.join(__dirname, "..", id, "search.js"), "utf8");
    assert.ok(!/setItem|removeItem|registerSlice|innerHTML/.test(src), id);
  });
});

// ---------- quote ----------
test("quote: number + client, items and notes as text, tombstones, bridge", () => {
  const data = {
    ver: 1, om: 0, deleted: { q3: 500, c2: 900 },
    quotes: [
      { id: "q1", num: "OFF-2026-001", clientId: "c1", status: "sent", date: "2026-03-14", dueDate: "",
        currency: "EUR", items: [{ id: "i1", code: "WEB", desc: "Website redesign", qty: 1, price: 900, disc: 0, vat: 24 }],
        gDisc: 0, payment: "Bank transfer", notes: "Includes hosting", instalments: [], mtime: 1000, pos: 0 },
      { id: "q2", num: "", clientId: "c2", status: "draft", date: "", items: [], notes: "", payment: "", mtime: 800, pos: 1 },
      { id: "q3", num: "OFF-2026-003", clientId: "c1", items: [], notes: "", payment: "", mtime: 400, pos: 2 }
    ],
    clients: [
      { id: "c1", name: "Acme Ltd", email: "info@acme.test", phone: "", address: "Athens", taxId: "", mtime: 10, pos: 0 },
      { id: "c2", name: "Gone Co", email: "", phone: "", address: "", taxId: "", mtime: 10, pos: 1 }
    ],
    templates: [{ id: "t1", name: "Template with Website", items: [], mtime: 5 }]
  };
  const hits = run("quote", data, "website");
  const m = byId(hits);
  assert.deepEqual(Object.keys(m).sort(), ["q1", "q2"]);      // q3 tombstoned, templates not searched
  assert.equal(m.q1.title, "OFF-2026-001 · Acme Ltd");
  assert.ok(m.q1.text.includes("WEB Website redesign") && m.q1.text.includes("Includes hosting") &&
            m.q1.text.includes("info@acme.test"));
  assert.equal(m.q1.when, noon(2026, 3, 14));
  assert.equal(m.q1.target, "q1");
  assert.equal(m.q2.title, "Untitled quote");                  // deleted client → no name
  assert.equal(run("quote", data, "x", "el").find((h) => h.id === "q2").title, "Προσφορά χωρίς αριθμό");
  let got = null;
  P("quote").open("q1", { __orosOpenQuote: (id) => { got = id; } });
  assert.equal(got, "q1");
});

// ---------- timesheet ----------
test("timesheet: projects, clients, described entries; tombstones and archived skipped", () => {
  const s = new Date(2026, 4, 6, 9, 30).getTime();
  const data = {
    ver: 1,
    clients: [{ id: "cli001", name: "Northwind", rate: 0, m: 1 }, { id: "cli002", m: 5, del: 1 }],
    projects: [
      { id: "prj001", name: "Mobile app", client: "cli001", color: 0, rate: 0, bill: 1, arch: 0, m: 2 },
      { id: "prj002", name: "Old site", client: "cli001", color: 1, rate: 0, bill: 1, arch: 1, m: 3 },
      { id: "prj003", m: 4, del: 1 }
    ],
    entries: [
      { id: "ent001", p: "prj001", desc: "Login screen review", s, e: s + 3600000, billed: 0, m: 10 },
      { id: "ent002", p: "prj001", desc: "", s, e: s + 60000, billed: 0, m: 11 },
      { id: "ent003", m: 12, del: 1 }
    ],
    prefs: { cur: "EUR", rate: 0, goal: 0, round: 0, rup: 1 }, pm: 0
  };
  const m = byId(run("timesheet", data, "login"));
  assert.deepEqual(Object.keys(m).sort(), ["c:cli001", "e:ent001", "p:prj001"]);
  assert.equal(m["p:prj001"].title, "Mobile app");
  assert.equal(m["p:prj001"].text, "Northwind");
  assert.deepEqual(m["p:prj001"].target, { project: "prj001" });
  assert.equal(m["c:cli001"].text, "Mobile app");             // archived project not listed
  assert.deepEqual(m["c:cli001"].target, { client: "cli001" });
  assert.equal(m["e:ent001"].title, "Login screen review");
  assert.equal(m["e:ent001"].text, "Mobile app · Northwind");
  assert.equal(m["e:ent001"].when, s);
  assert.deepEqual(m["e:ent001"].target, { entry: "ent001" });
  assert.equal(P("timesheet").open, undefined);                 // generic deep link
});

// ---------- split ----------
test("split: groups and expenses; archived groups and tombstones skipped", () => {
  const data = {
    ver: 1,
    groups: [
      { id: "trip", m: 1, n: "Crete trip", col: 0, cur: "EUR", arch: 0 },
      { id: "old", m: 1, n: "Old flat", col: 1, cur: "EUR", arch: 1 },
      { id: "gone", m: 1, n: "Gone group", col: 1, cur: "EUR", arch: 0 }
    ],
    people: [{ id: "trip.a", m: 1, n: "Anna" }, { id: "trip.b", m: 1, n: "Babis" }, { id: "old.a", m: 1, n: "Old" }],
    exp: [
      { id: "trip.e1", m: 5, t: "Ferry tickets", a: 12000, d: "2026-07-02", c: "trans",
        by: { "trip.a": 12000 }, mode: "eq", w: { "trip.a": 1, "trip.b": 1 }, n: "Piraeus to Heraklion" },
      { id: "trip.e2", m: 6, t: "", a: 3000, d: "2026-07-03", c: "food",
        by: { "trip.b": 3000 }, mode: "eq", w: { "trip.a": 1, "trip.b": 1 }, n: "" },
      { id: "trip.e3", m: 7, t: "Deleted dinner", a: 100, d: "2026-07-04", c: "food",
        by: { "trip.b": 100 }, mode: "eq", w: { "trip.b": 1 }, n: "" },
      { id: "old.e1", m: 5, t: "Old rent", a: 100, d: "2025-01-01", c: "bills",
        by: { "old.a": 100 }, mode: "eq", w: { "old.a": 1 }, n: "" }
    ],
    pay: [], mine: [],
    tombs: { "exp:trip.e3": 9, "grp:gone": 9 }
  };
  const m = byId(run("split", data, "ab"));
  assert.deepEqual(Object.keys(m).sort(), ["e:trip.e1", "e:trip.e2", "g:trip"]);
  assert.equal(m["g:trip"].title, "Crete trip");
  assert.equal(m["g:trip"].text, "Anna · Babis");
  assert.deepEqual(m["g:trip"].target, { group: "trip" });
  assert.equal(m["e:trip.e1"].title, "Ferry tickets");
  assert.equal(m["e:trip.e1"].text, "Piraeus to Heraklion · Anna · Crete trip");
  assert.equal(m["e:trip.e1"].when, noon(2026, 7, 2));
  assert.deepEqual(m["e:trip.e1"].target, { group: "trip", exp: "trip.e1" });
  assert.equal(m["e:trip.e2"].title, "Food & drinks");          // untitled → category
  assert.equal(byId(run("split", data, "x", "el"))["e:trip.e2"].title, "Φαγητό & ποτό");
});

// ---------- budget ----------
test("budget: entries and recurring rules, category names, tombstones", () => {
  const data = {
    ver: 1,
    tx: [
      { id: "t1", m: 5, d: "2026-09-12", a: 4550, k: "o", c: "o-groc", n: "Weekly market" },
      { id: "t2", m: 5, d: "2026-09-01", a: 150000, k: "i", c: "i-salary", n: "" },
      { id: "t3", m: 5, d: "2026-09-02", a: 999, k: "o", c: "mine1", n: "" },
      { id: "t4", m: 5, d: "2026-09-03", a: 100, k: "o", c: "", n: "Deleted coffee" }
    ],
    cats: [{ id: "mine1", m: 1, k: "o", name: "Hobbies", col: 3 }],
    bud: [], rec: [{ id: "r1", m: 1, k: "o", a: 80000, c: "o-home", n: "Rent", f: "m", s: "2026-01-01", e: "" }],
    set: { m: 0, cur: "EUR" },
    tombs: { "tx:t4": 9 }
  };
  const m = byId(run("budget", data, "ab"));
  assert.deepEqual(Object.keys(m).sort(), ["r:r1", "t:t1", "t:t2", "t:t3"]);
  assert.equal(m["t:t1"].title, "Weekly market");
  assert.equal(m["t:t1"].text, "Expense · Groceries · 45.50 EUR");
  assert.equal(m["t:t1"].when, noon(2026, 9, 12));
  assert.deepEqual(m["t:t1"].target, { tx: "t1" });
  assert.equal(m["t:t2"].title, "Salary");
  assert.equal(m["t:t3"].title, "Hobbies");
  assert.equal(m["r:r1"].title, "Rent");
  assert.equal(m["r:r1"].text, "Every month · Expense · Rent & home · 800.00 EUR");
  assert.deepEqual(m["r:r1"].target, { rec: "r1" });
  const el = byId(run("budget", data, "x", "el"));
  assert.equal(el["t:t1"].text, "Έξοδο · Σούπερ μάρκετ · 45,50 EUR");
});

// ---------- spreadsheet ----------
test("spreadsheet: sheet names + text cells, prefiltered; formulas, numbers, tombstones skipped", () => {
  const data = {
    ver: 2,
    sheets: [
      { id: "s-main", name: null, bi: { en: "Sheet1", el: "Φύλλο1" }, rows: 100, cols: 26, pos: 0, mtime: 0, cw: {} },
      { id: "s2", name: "Invoices", bi: null, rows: 100, cols: 26, pos: 1, mtime: 50, cw: {} },
      { id: "s3", name: "Removed", bi: null, rows: 100, cols: 26, pos: 2, mtime: 50, cw: {} }
    ],
    cells: {
      "s2|3|1": { v: "Invoice Acme March", mtime: 60 },
      "s2|4|1": { v: "=SUM(A1:A3)", mtime: 60 },
      "s2|5|1": { v: "1.250,00", mtime: 60 },
      "s2|6|1": { v: "Old invoice text", mtime: 60, fm: { v: 60, f: 0 } },
      "s-main|0|27": { v: "Invoice in AB", mtime: 70 },
      "s3|0|0": { v: "Invoice gone", mtime: 40 }
    },
    deleted: { "s2|6|1": 80, s3: 90 }
  };
  const hits = run("spreadsheet", data, "invoice");
  const m = byId(hits);
  assert.deepEqual(Object.keys(m).sort(), ["c:s-main|0|27", "c:s2|3|1", "s:s-main", "s:s2"]);
  assert.equal(m["s:s-main"].title, "Sheet1");
  assert.equal(m["s:s2"].title, "Invoices");
  assert.deepEqual(m["s:s2"].target, { sheet: "s2" });
  assert.equal(m["c:s2|3|1"].title, "Invoice Acme March");
  assert.equal(m["c:s2|3|1"].text, "Invoices · B4");
  assert.deepEqual(m["c:s2|3|1"].target, { sheet: "s2", r: 3, c: 1 });
  assert.equal(m["c:s-main|0|27"].text, "Sheet1 · AB1");
  assert.equal(byId(run("spreadsheet", data, "invoice", "el"))["c:s-main|0|27"].text, "Φύλλο1 · AB1");
  // the prefilter: a cell that does not match is not even returned
  assert.equal(run("spreadsheet", data, "acme").filter((h) => h.id.startsWith("c:")).length, 1);
});

test("spreadsheet: cell hits are capped", () => {
  const cells = {};
  for (let r = 0; r < 500; r++) for (let c = 0; c < 2; c++) cells["s-main|" + r + "|" + c] = { v: "row text " + r, mtime: 1 };
  const data = { ver: 2, sheets: [{ id: "s-main", name: "Big", rows: 500, cols: 26, pos: 0, mtime: 1 }], cells, deleted: {} };
  const hits = run("spreadsheet", data, "text");
  assert.ok(hits.length <= 301 && hits.length > 50);
});

// ---------- storage ----------
test("storage: entities with their path, notes; tombstones and orphans skipped", () => {
  const data = {
    ver: 1,
    ents: [
      { id: "seed-sp-home", type: "space", name: "", bi: { en: "Home", el: "Σπίτι" }, parentId: null, pos: 0, mtime: 0, del: false },
      { id: "r1", type: "room", name: "Kitchen", parentId: "seed-sp-home", pos: 0, mtime: 5, del: false },
      { id: "f1", type: "furniture", name: "Cupboard", parentId: "r1", pos: 0, mtime: 5, del: false },
      { id: "p1", type: "position", name: "Top shelf", parentId: "f1", pos: 0, mtime: 5, del: false },
      { id: "i1", type: "item", name: "Pasta maker", parentId: "p1", qty: 1, note: "Box with the hand crank", pos: 0, mtime: 9, del: false },
      { id: "f2", type: "furniture", name: "Old dresser", parentId: "r1", pos: 1, mtime: 5, del: true },
      { id: "p2", type: "position", name: "Drawer", parentId: "f2", pos: 0, mtime: 5, del: true },
      { id: "i2", type: "item", name: "Pasta orphan", parentId: "p9", qty: 1, pos: 0, mtime: 5, del: false }
    ]
  };
  const m = byId(run("storage", data, "pasta"));
  assert.deepEqual(Object.keys(m).sort(), ["f1", "i1", "p1", "r1", "seed-sp-home"]);
  assert.equal(m.i1.title, "Pasta maker");
  assert.equal(m.i1.text, "Home › Kitchen › Cupboard › Top shelf · Box with the hand crank");
  assert.deepEqual(m.i1.target, { id: "i1" });
  assert.equal(m["seed-sp-home"].title, "Home");
  const el = byId(run("storage", data, "x", "el"));
  assert.equal(el["seed-sp-home"].title, "Σπίτι");
  assert.equal(el.r1.text, "Σπίτι");
});

// ---------- minimalism ----------
test("minimalism: typed skip reasons only; presets, done days, tombstones skipped; bridge", () => {
  const data = {
    ver: 1, sm: 0, om: 0, prefs: { remindHour: 10, mtime: 0 },
    days: [
      { id: "2026-10-05:phys", date: "2026-10-05", level: "phys", status: "skip", reason: "Moving house this week", mtime: 10 },
      { id: "2026-10-04:dig", date: "2026-10-04", level: "dig", status: "skip", reason: "Not today", mtime: 10 },
      { id: "2026-10-03:dig", date: "2026-10-03", level: "dig", status: "done", reason: "", mtime: 10 },
      { id: "2026-10-02:dig", date: "2026-10-02", level: "dig", status: "skip", reason: "Phone broken", mtime: 10 }
    ],
    deleted: { "2026-10-02:dig": 20 }
  };
  const hits = run("minimalism", data, "house");
  assert.equal(hits.length, 1);
  assert.equal(hits[0].title, "Moving house this week");
  assert.equal(hits[0].text, "Skipped · Physical");
  assert.equal(hits[0].when, noon(2026, 10, 5));
  assert.equal(hits[0].target, "2026-10-05");
  assert.equal(run("minimalism", data, "x", "el")[0].text, "Παραλείφθηκε · Φυσικός");
  let got = null;
  P("minimalism").open("2026-10-05", { __orosOpenMinimalism: (y) => { got = y; } });
  assert.equal(got, "2026-10-05");
});

test("office providers through the core: ranking and cleaning", async () => {
  const st = store({
    "oros-storage-data": { ver: 1, ents: [
      { id: "r1", type: "room", name: "Garage", parentId: null, pos: 0, mtime: 1, del: false }] },
    "oros-split-data": { ver: 1, groups: [{ id: "g", m: 1, n: "Garage sale", col: 0, cur: "EUR", arch: 0 }],
      people: [], exp: [], pay: [], mine: [], tombs: {} }
  });
  const groups = await S.run([P("storage"), P("split")], "garage", { readJSON: S.makeReader(st), timeoutMs: 200 });
  assert.deepEqual(groups.map((g) => g.id).sort(), ["split", "storage"]);
});
