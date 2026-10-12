// Pure logic of CRM (crm/core.js): the sync merge (slice "crm"),
// normalizers, ΑΦΜ check, money parsing, pipeline, agenda,
// reminders, "forgotten" customers, dashboard, the Invoices
// read-out (BR-CRM-INV), CSV and backup / restore.
// Run: node --test tests/

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const C = require(path.join(__dirname, "..", "crm/core.js"));

const DAY = 86400000;
const NOW = Date.UTC(2026, 9, 12, 10, 0, 0);
const TODAY = "2026-10-12";

function cust(id, extra) { return Object.assign({ id, m: 1000, name: "Client " + id, st: "active" }, extra || {}); }
function deal(id, c, extra) { return Object.assign({ id, m: 1000, cust: c, title: "Deal " + id, val: 10000, stage: "new" }, extra || {}); }
function act(id, c, at, extra) { return Object.assign({ id, m: 1000, cust: c, k: "call", at, text: "" }, extra || {}); }
function fup(id, c, d, extra) { return Object.assign({ id, m: 1000, cust: c, d, text: "Call back" }, extra || {}); }
function data(o) { return Object.assign(C.empty(), o || {}); }
const J = JSON.stringify;

test("merge is symmetric, idempotent and canonical (R5, R26)", () => {
  const A = data({
    cust: [cust("cccccc02", { m: 2000, name: "Beta" }), cust("cccccc01")],
    deals: [deal("dddddd01", "cccccc01")],
    tags: [{ id: "tttttt01", m: 5, name: "VIP", col: 2 }],
    tombs: { xxxxxx01: 50 }
  });
  const B = data({
    cust: [cust("cccccc02", { m: 1500, name: "Old beta" }), cust("cccccc03", { kind: "person" })],
    acts: [act("aaaaaa01", "cccccc03", NOW)],
    fups: [fup("ffffff01", "cccccc01", TODAY)],
    prefs: { pm: 7, cur: "USD", forget: 45 }
  });
  const ab = C.merge(A, B), ba = C.merge(B, A);
  assert.equal(J(ab), J(ba));
  assert.equal(J(C.merge(ab, ab)), J(ab));
  assert.equal(J(C.norm(ab)), J(ab));
  assert.deepEqual(ab.cust.map(c => c.id), ["cccccc01", "cccccc02", "cccccc03"]);
  assert.equal(C.byId(ab.cust, "cccccc02").name, "Beta");
  assert.equal(ab.prefs.cur, "USD");
  assert.equal(ab.prefs.forget, 45);
  assert.equal(ab.acts.length, 1);
  assert.equal(ab.fups.length, 1);
});

test("equal stamps: larger canonical JSON wins on both sides", () => {
  const A = data({ cust: [cust("cccccc01", { name: "Alpha" })] });
  const B = data({ cust: [cust("cccccc01", { name: "Zeta" })] });
  assert.equal(C.merge(A, B).cust[0].name, "Zeta");
  assert.equal(C.merge(B, A).cust[0].name, "Zeta");
});

test("tombstones: delete wins ties, a newer edit resurrects (R17)", () => {
  const live = data({ cust: [cust("cccccc01", { m: 1000 })] });
  const del = data({ tombs: { cccccc01: 1000 } });
  assert.equal(C.merge(live, del).cust.length, 0);
  const edit = data({ cust: [cust("cccccc01", { m: 1001 })] });
  assert.equal(C.merge(edit, del).cust.length, 1);
});

test("children of a deleted customer leave in the merge", () => {
  const A = data({
    cust: [cust("cccccc01"), cust("cccccc02")],
    deals: [deal("dddddd01", "cccccc01"), deal("dddddd02", "cccccc02")],
    acts: [act("aaaaaa01", "cccccc01", NOW)],
    fups: [fup("ffffff01", "cccccc01", TODAY), fup("ffffff02", "cccccc09", TODAY)]
  });
  const B = data({ tombs: { cccccc01: 2000 } });
  const m = C.merge(A, B);
  assert.deepEqual(m.cust.map(c => c.id), ["cccccc02"]);
  assert.deepEqual(m.deals.map(d => d.id), ["dddddd02"]);
  assert.equal(m.acts.length, 0);
  assert.equal(m.fups.length, 0);   // also the orphan of a customer that never existed
});

test("old tombstones are pruned against the newest stamp, never the clock", () => {
  const t0 = Date.UTC(2025, 0, 1);
  const A = data({ tombs: { cccccc01: t0, cccccc02: t0 + 300 * DAY } , cust: [cust("cccccc03", { m: t0 + 400 * DAY })] });
  const m = C.merge(A, null);
  assert.deepEqual(Object.keys(m.tombs), ["cccccc02"]);
  assert.equal(J(C.merge(m, m)), J(m));
});

test("normalizers drop invalid rows and clean text", () => {
  assert.equal(C.normCust({ id: "bad", m: 1, name: "x" }), null);
  assert.equal(C.normCust({ id: "cccccc01", m: 1, name: "   " }), null);
  assert.equal(C.normCust({ id: "cccccc01", name: "x" }), null);   // no stamp
  const c = C.normCust({ id: "cccccc01", m: 1, name: " A\u0000  B \n C ", note: "l1\r\nl2\n\n\n\nl3", st: "nope",
    tags: ["tttttt02", "tttttt01", "tttttt01", "x"], people: [{ c: "", n: "" }, { c: "pppppp01", n: "Maria", role: "Λογιστήριο" }],
    afm: " 094 014 201 ", star: true });
  assert.equal(c.name, "A B C");
  assert.equal(c.note, "l1\nl2\n\nl3");
  assert.equal(c.st, "lead");
  assert.deepEqual(c.tags, ["tttttt01", "tttttt02"]);
  assert.deepEqual(c.people, [{ c: "pppppp01", n: "Maria", role: "Λογιστήριο" }]);
  assert.equal(c.afm, "094014201");
  assert.equal(c.star, 1);
  assert.ok(!("alias" in c), "empty optional fields are left out");
  assert.equal(C.normDeal({ id: "dddddd01", m: 1, cust: "cccccc01", title: "x", val: -5, stage: "zzz" }).val, 0);
  assert.equal(C.normDeal({ id: "dddddd01", m: 1, cust: "cccccc01", title: "x", stage: "new", cd: TODAY }).cd, undefined);
  assert.equal(C.normFup({ id: "ffffff01", m: 1, cust: "cccccc01", d: "2026-02-30", text: "x" }), null);
  assert.equal(C.normFup({ id: "ffffff01", m: 1, cust: "cccccc01", d: TODAY, text: "x", t: "25:00" }).t, undefined);
  assert.equal(C.normAct({ id: "aaaaaa01", m: 1, cust: "cccccc01", k: "call" }), null);   // no time
  assert.equal(C.normTag({ id: "tttttt01", m: 1, name: "x", col: 99 }).col, 0);
});

test("ΑΦΜ check digit", () => {
  assert.ok(C.validAfm("094014201"));
  assert.ok(C.validAfm("EL094014201"));
  assert.ok(C.validAfm("094 014 201"));
  assert.ok(!C.validAfm("094014202"));
  assert.ok(!C.validAfm("000000000"));
  assert.ok(!C.validAfm("12345"));
});

test("money: both decimal marks, thousands, limits", () => {
  assert.equal(C.parseMoney("1.234,56"), 123456);
  assert.equal(C.parseMoney("1,234.56"), 123456);
  assert.equal(C.parseMoney("1234.5"), 123450);
  assert.equal(C.parseMoney("1 234"), 123400);
  assert.equal(C.parseMoney("€ 900"), 90000);
  assert.equal(C.parseMoney("1.000"), 100000);
  assert.equal(C.parseMoney(""), null);
  assert.equal(C.parseMoney("abc"), null);
  assert.equal(C.parseMoney("-5"), null);
  assert.match(C.moneyStr(123456, "EUR", "el"), /1\.234,56/);
});

test("pipeline totals and weighted value", () => {
  const d = data({
    cust: [cust("cccccc01")],
    deals: [deal("dddddd01", "cccccc01", { val: 100000, stage: "proposal" }),
            deal("dddddd02", "cccccc01", { val: 50000, stage: "proposal", prob: 10 }),
            deal("dddddd03", "cccccc01", { val: 7000, stage: "won", cd: TODAY })]
  });
  const p = C.pipeline(C.norm(d));
  assert.deepEqual(p.proposal, { n: 2, val: 150000, wval: 55000 });
  assert.deepEqual(p.won, { n: 1, val: 7000, wval: 7000 });
  assert.equal(p.lost.n, 0);
});

test("agenda and reminders", () => {
  const d = C.norm(data({
    cust: [cust("cccccc01")],
    fups: [fup("ffffff01", "cccccc01", "2026-10-10"),
           fup("ffffff02", "cccccc01", TODAY, { t: "09:00" }),
           fup("ffffff03", "cccccc01", TODAY, { t: "15:30" }),
           fup("ffffff04", "cccccc01", TODAY),
           fup("ffffff05", "cccccc01", "2026-10-19"),
           fup("ffffff06", "cccccc01", "2026-10-20"),
           fup("ffffff07", "cccccc01", "2026-10-01", { done: "2026-10-02" })]
  }));
  const ag = C.agenda(d, TODAY, 7);
  assert.deepEqual(ag.late.map(f => f.id), ["ffffff01"]);
  assert.deepEqual(ag.today.map(f => f.id), ["ffffff04", "ffffff02", "ffffff03"]);
  assert.deepEqual(ag.soon.map(f => f.id), ["ffffff05"]);
  assert.deepEqual(C.dueNow(d, TODAY, "10:00").map(f => f.id), ["ffffff01", "ffffff04", "ffffff02"]);
});

test("forgotten customers and dashboard", () => {
  const d = C.norm(data({
    cust: [cust("cccccc01", { ct: NOW - 90 * DAY }), cust("cccccc02", { ct: NOW - 90 * DAY }),
           cust("cccccc03", { ct: NOW - 90 * DAY, st: "past" }), cust("cccccc04", { ct: NOW - 2 * DAY, st: "lead" })],
    acts: [act("aaaaaa01", "cccccc02", NOW - DAY), act("aaaaaa02", "cccccc01", NOW - 40 * DAY)],
    deals: [deal("dddddd01", "cccccc01", { stage: "won", cd: TODAY, val: 2000 }),
            deal("dddddd02", "cccccc01", { stage: "lost", cd: "2026-03-01" }),
            deal("dddddd03", "cccccc02", { stage: "nego", val: 40000 })],
    fups: [fup("ffffff01", "cccccc01", "2026-10-01")]
  }));
  assert.deepEqual(C.forgotten(d, NOW).map(c => c.id), ["cccccc01"]);
  assert.equal(C.lastContact(d, "cccccc02"), NOW - DAY);
  const s = C.dashboard(d, NOW, TODAY);
  assert.equal(s.openN, 1);
  assert.equal(s.openVal, 40000);
  assert.equal(s.openW, 30000);
  assert.equal(s.wonMonth, 2000);
  assert.equal(s.winRate, 50);
  assert.equal(s.late, 1);
  assert.equal(s.forgotten, 1);
  assert.equal(s.newLeads, 1);
  assert.deepEqual(s.byStatus, { lead: 1, active: 2, past: 1 });
});

test("Invoices read-out (BR-CRM-INV)", () => {
  const d = C.norm(data({ cust: [cust("cccccc02", { name: "Βήτα", afm: "094014201", doy: "Α' Αθηνών" }), cust("cccccc01", { name: "Άλφα" })] }));
  const b = C.customersForBilling(d);
  assert.deepEqual(b.map(x => x.name), ["Άλφα", "Βήτα"]);
  assert.deepEqual(Object.keys(b[1]), ["id", "name", "afm", "doy", "job", "addr", "country", "email", "phone"]);
  assert.equal(b[1].afm, "094014201");
});

test("CSV: header per language, formula guard, quoting", () => {
  const d = C.norm(data({ cust: [cust("cccccc01", { name: "=HYPERLINK(1)", note: 'a;"b"' })] }));
  const rows = C.csvRows(d, "el");
  assert.equal(rows[0][0], "Επωνυμία");
  assert.equal(C.csvCell(rows[1][0]), "'=HYPERLINK(1)");
  assert.equal(C.csvCell('a;"b"'), '"a;""b"""');
});

test("backup / restore merges, never replaces", () => {
  const mine = C.norm(data({ cust: [cust("cccccc01")] }));
  const file = C.backup(C.norm(data({ cust: [cust("cccccc02")] })));
  const r = C.restore(mine, JSON.parse(JSON.stringify(file)));
  assert.deepEqual(r.cust.map(c => c.id), ["cccccc01", "cccccc02"]);
  assert.equal(C.restore(mine, { app: "budget" }), null);
  assert.equal(C.restore(mine, null), null);
});

test("fold: case, accents, final sigma", () => {
  assert.equal(C.fold("Παπαδόπουλος"), C.fold("ΠΑΠΑΔΟΠΟΥΛΟΣ"));
  assert.equal(C.fold("Ελένη"), "ελενη");
});

// ---------- universal search provider (crm/search.js) ----------
const fs = require("fs");
const S = require(path.join(__dirname, "..", "search.js"));
const P = require(path.join(__dirname, "..", "crm/search.js"));
function store(obj) {
  const mm = new Map(Object.entries(obj).map(([k, v]) => [k, JSON.stringify(v)]));
  return { getItem: (k) => (mm.has(k) ? mm.get(k) : null) };
}
function ctx(d, q, lang) {
  return { q, words: S.parseQuery(q || ""), fold: S.fold, lang: lang || "en", limit: 50,
           readJSON: S.makeReader(store(d === undefined ? {} : { "oros-crm-data": d })) };
}

test("search: shape, empty storage, read-only source", () => {
  assert.equal(P.id, "crm");
  assert.deepEqual(P.keys, ["oros-crm-data"]);
  assert.deepEqual(P.search(ctx(undefined, "ab")), []);
  const src = fs.readFileSync(path.join(__dirname, "..", "crm/search.js"), "utf8");
  assert.ok(!/setItem|removeItem|registerSlice|innerHTML/.test(src));
});

test("search: customers, deals, open follow-ups, history; tombstones and orphans skipped", () => {
  const d = C.norm(data({
    cust: [cust("cccccc01", { name: "Παπαδόπουλος ΑΕ", alias: "Papa", afm: "094014201", people: [{ c: "", n: "Μαρία" }] }),
           cust("cccccc02", { name: "Gone Ltd", m: 1000 })],
    deals: [deal("dddddd01", "cccccc01", { title: "Νέο site", stage: "proposal", close: "2026-11-01" })],
    fups: [fup("ffffff01", "cccccc01", "2026-10-20", { text: "Τηλέφωνο για προσφορά" }),
           fup("ffffff02", "cccccc01", "2026-10-01", { text: "Old", done: "2026-10-02" })],
    acts: [act("aaaaaa01", "cccccc01", NOW, { text: "Μίλησα με τη Μαρία\nδεύτερη γραμμή" }),
           act("aaaaaa02", "cccccc01", NOW, { text: "" })],
    tombs: { cccccc02: 1000 }
  }));
  const hits = P.search(ctx(d, "", "el"));
  const by = Object.fromEntries(hits.map((h) => [h.id, h]));
  assert.deepEqual(Object.keys(by).sort(), ["aaaaaa01", "cccccc01", "dddddd01", "ffffff01"]);
  assert.equal(by.cccccc01.title, "Παπαδόπουλος ΑΕ (Papa)");
  assert.match(by.cccccc01.text, /094014201/);
  assert.match(by.cccccc01.text, /Μαρία/);
  assert.deepEqual(by.cccccc01.target, { cust: "cccccc01" });
  assert.match(by.dddddd01.text, /Πρόταση/);
  assert.deepEqual(by.dddddd01.target, { deal: "dddddd01" });
  assert.deepEqual(by.ffffff01.target, { fup: "ffffff01" });
  assert.equal(by.aaaaaa01.title, "Μίλησα με τη Μαρία");
  assert.equal(by.aaaaaa01.when, NOW);
});
