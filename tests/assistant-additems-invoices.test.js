// Assistant / Gate: invoice drafts saved straight away (AS-ADD8,
// GATE-PAR P4, assistant/additems3.js). A draft is what Invoices'
// prefillNew + saveDraft would write (opening Invoices rewrites
// nothing), never issued (no number, no series), a known client is
// linked, an unknown one is only the draft's party, look-alike drafts
// start unticked, and Undo removes only a draft nobody changed.
// Run: node --test tests/
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const A = require("../assistant/additems.js");
require("../assistant/additems3.js");
const core = require("../assistant/core.js");
const IC = require("../invoices/core.js");

const NOW = new Date(2026, 10, 8, 12, 0).getTime();
const CTX = { today: "2026-11-08", lang: "en" };
const clone = (x) => JSON.parse(JSON.stringify(x));
function items(list) { const n = A.normItems({ app: "invoices", items: list }, CTX); assert.equal(n.ok, true, n.err); return n.items; }
function err(list) { const n = A.normItems({ app: "invoices", items: list }, CTX); assert.equal(n.ok, false); return n.err; }
function base() {
  const d = IC.empty();
  d.prof = Object.assign({}, d.prof, { name: "Me", vat: 24, days: 15, cur: "EUR", terms: "IBAN GR00", m: 5 });
  d.clients.push(IC.normClient({ id: "cl-abc1", name: "Γλαρόλυκοι ΙΚΕ", afm: "123456789", doy: "Α' Αθηνών", m: 3 }));
  return IC.normalize(d);
}

test("invoices: a draft saved at once, as Invoices writes it; known client linked; never issued", () => {
  assert.ok(A.APP_IDS.includes("invoices"));
  assert.equal(A.storageKey("invoices"), "oros-invoices-data");
  const d = base();
  const it = items([{ client: "γλαρολυκοι ικε", lines: [{ text: "Editing", qty: 2, price: 45.5 }, { text: "Cover", qty: 1, price: 100, vat: 13 }], note: "Thanks" },
                    { client: "New Shop", tax_id: "999 888 777", lines: [{ text: "Books", qty: 10, price: 8 }], date: "2026-11-01", currency: "USD" }]);
  const p = A.plan("invoices", clone(d), it, CTX);
  assert.equal(p.ok, true, p.err);
  assert.equal(p.rows.length, 2);
  assert.ok(p.rows[0].fields.some((f) => f[0] === "amount" && f[1] === "225.84 EUR"));   // 191 net + 21.84 + 13
  assert.ok(p.rows[1].fields.some((f) => f[0] === "client" && /new$/.test(f[1])));
  const r = A.apply("invoices", clone(d), it, NOW, [false, false], CTX);
  assert.equal(r.ok, true, r.err);
  assert.equal(r.made.length, 2);
  assert.equal(JSON.stringify(IC.normalize(r.data)), JSON.stringify(r.data), "opening Invoices rewrites nothing");
  const a = IC.doc(r.data, r.made[0].id), b = IC.doc(r.data, r.made[1].id);
  assert.equal(a.st, "draft"); assert.equal(a.num, ""); assert.equal(a.seq, 0); assert.equal(a.ser, "");
  assert.equal(a.kind, "inv");
  assert.equal(a.cli, "cl-abc1");
  assert.equal(a.c.afm, "123456789");
  assert.equal(a.date, "2026-11-08"); assert.equal(a.due, "2026-11-23");
  assert.equal(a.terms, "IBAN GR00"); assert.equal(a.notes, "Thanks");
  assert.deepEqual(a.lines.map((l) => [l.d, l.q, l.p, l.vat]), [["Editing", 2, 4550, 24], ["Cover", 1, 10000, 13]]);
  assert.equal(b.cli, ""); assert.equal(b.c.name, "New Shop"); assert.equal(b.c.afm, "999888777");
  assert.equal(b.cur, "USD"); assert.equal(b.date, "2026-11-01");
  assert.equal(IC.live(r.data.clients).length, 1, "no client is made");
  assert.deepEqual(r.made[0].target, { invoice: a.id });
  // the same draft again is a look-alike (unticked)
  const p2 = A.plan("invoices", clone(r.data), it.slice(0, 1), CTX);
  assert.equal(p2.rows[0].dup.id, a.id);
  // Undo removes the drafts while unchanged
  const u = A.undo("invoices", clone(r.data), r.undo, NOW + 1000);
  assert.equal(u.ok, true, u.err);
  assert.equal(IC.live(u.data.docs).length, 0);
  assert.ok(u.data.docs.every((x) => x.del === 1 && x.m > NOW));
});

test("invoices: a draft changed or issued since is not undone", () => {
  const d = base();
  const r = A.apply("invoices", clone(d), items([{ client: "X", lines: [{ text: "A", qty: 1, price: 1 }] }]), NOW, null, CTX);
  const x = clone(r.data);
  const doc = x.docs.find((y) => y.id === r.made[0].id);
  doc.st = "issued"; doc.num = "1"; doc.seq = 1; doc.m = NOW + 50;
  const u = A.undo("invoices", IC.normalize(x), r.undo, NOW + 100);
  assert.equal(u.ok, false);
  assert.match(u.err, /changed or issued/);
});

test("invoices: bad input is refused with the reason; never opened = empty Invoices", () => {
  assert.match(err([{ client: "X" }]), /lines is required/);
  assert.match(err([{ lines: [{ text: "A", qty: 0, price: 1 }] }]), /qty must be more than 0/);
  assert.match(err([{ lines: [{ text: "A", qty: 1 }] }]), /price is required/);
  assert.match(err([{ lines: [{ text: "A", qty: 1, price: 1 }], currency: "euro" }]), /currency/);
  assert.match(err([{ lines: [{ text: "x".repeat(201), qty: 1, price: 1 }] }]), /200/);
  const p = A.plan("invoices", null, items([{ lines: [{ text: "A", qty: 1, price: 1 }] }]), CTX);
  assert.equal(p.ok, true);
  assert.equal(A.plan("invoices", { nope: 1 }, items([{ lines: [{ text: "A", qty: 1, price: 1 }] }]), CTX).ok, false);
});

test("invoices in create_items: the tool, the prompt, the Gate", () => {
  const t = core.toolsFor({ data: 1, creates: ["invoices"] }).find((x) => x.name === "create_items");
  assert.deepEqual(t.params.properties.app["enum"], ["invoices"]);
  ["client", "tax_id", "lines", "currency", "note", "date"].forEach((k) => assert.ok(t.params.properties.items.items.properties[k], k));
  assert.match(t.params.properties.app.description, /DRAFT/);
  const src = require("fs").readFileSync(require("path").join(__dirname, "../assistant/assistant.js"), "utf8");
  assert.match(src, /ADD3_IDS = \[[^\]]*"invoices"/);
  assert.match(src, /invoices: \["OrosInvoicesCore", "\.\.\/invoices\/core\.js"\]/);
});

// ---------- Quote Builder (AS-ADD8) ----------
const QC = require("../quote/core.js");
function qitems(list) { const n = A.normItems({ app: "quote", items: list }, CTX); assert.equal(n.ok, true, n.err); return n.items; }
function qbase() {
  return QC.canonState({ ver: 1, om: 10, deleted: {}, quotes: [{ id: "q1", num: "OFF-2026-004", clientId: "c1", status: "sent", date: "2026-10-01", dueDate: "", currency: "EUR",
    items: [], gDisc: 0, payment: "", notes: "", instalments: [], mtime: 10, pos: 0 }],
    clients: [{ id: "c1", name: "ACME", email: "", phone: "", address: "", taxId: "", mtime: 5, pos: 0 }], templates: [], payMethods: [] });
}

test("quote: new quotes in Quote's canonical form, next OFF number, client matched or made; Undo", () => {
  assert.ok(A.APP_IDS.includes("quote"));
  assert.equal(A.storageKey("quote"), "oros-quote-data");
  const d = qbase();
  const it = qitems([{ client: "acme", lines: [{ text: "Design", qty: 3, price: 50 }] }, { client: "Beta", tax_id: "123", lines: [{ text: "Print", qty: 100, price: 1.2, vat: 6 }], currency: "GBP" }]);
  const p = A.plan("quote", clone(d), it, CTX);
  assert.equal(p.ok, true, p.err);
  assert.deepEqual(p.rows.map((r) => r.fields.find((f) => f[0] === "num")[1]), ["OFF-2026-005", "OFF-2026-006"]);
  assert.ok(p.rows[0].fields.some((f) => f[0] === "amount" && f[1] === "186.00 EUR"));
  const r = A.apply("quote", clone(d), it, NOW, [false, false], CTX);
  assert.equal(r.ok, true, r.err);
  assert.equal(JSON.stringify(QC.canonState(r.data)), JSON.stringify(r.data), "opening Quote rewrites nothing");
  assert.equal(JSON.stringify(QC.merge(r.data, r.data)), JSON.stringify(r.data));
  const [a, b] = r.made.map((m) => r.data.quotes.find((q) => q.id === m.id));
  assert.equal(a.num, "OFF-2026-005"); assert.equal(b.num, "OFF-2026-006");
  assert.equal(a.status, "draft"); assert.equal(a.clientId, "c1"); assert.equal(a.date, "2026-11-08");
  assert.deepEqual(a.items.map((x) => [x.desc, x.qty, x.price, x.vat]), [["Design", 3, 50, 24]]);
  const beta = r.data.clients.find((c) => c.name === "Beta");
  assert.ok(beta); assert.equal(beta.taxId, "123"); assert.equal(b.clientId, beta.id); assert.equal(b.currency, "GBP");
  assert.ok(r.data.om > 10);
  // the same quote again: a look-alike
  assert.equal(A.plan("quote", clone(r.data), it.slice(0, 1), CTX).rows[0].dup.id, a.id);
  // a merge with the old copy keeps them (another device)
  assert.equal(QC.merge(d, r.data).quotes.length, 3);
  const u = A.undo("quote", clone(r.data), r.undo, NOW + 1000);
  assert.equal(u.ok, true, u.err);
  assert.deepEqual(u.data.quotes.map((q) => q.id), ["q1"]);
  assert.deepEqual(u.data.clients.map((c) => c.id), ["c1"], "the client it made goes too");
  assert.equal(QC.merge(r.data, u.data).quotes.length, 1, "the deletion wins over the old copy");
});

test("quote: a quote changed since is not undone; never opened = empty Quote", () => {
  const r = A.apply("quote", null, qitems([{ lines: [{ text: "A", qty: 1, price: 1 }] }]), NOW, null, CTX);
  assert.equal(r.ok, true, r.err);
  assert.equal(r.data.quotes[0].num, "OFF-2026-001");
  const x = clone(r.data); x.quotes[0].status = "sent"; x.quotes[0].mtime = NOW + 5;
  const u = A.undo("quote", x, r.undo, NOW + 10);
  assert.equal(u.ok, false);
});
