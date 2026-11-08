// orOS Gate, device side (gate.js pure core): which apps Claude may
// read, budget_lines (days, tombstones, accounts, bank only, paging,
// amounts, extra fields) and search hits.
// Run: node --test tests/
const test = require("node:test");
const assert = require("node:assert/strict");
const G = require("../gate/gate.js");

const data = {
  ver: 1,
  set: { m: 1, cur: "EUR" },
  acc: [{ id: "a1", m: 1, n: "Πειραιώς", o: 0 }, { id: "a2", m: 1, n: "Viva", o: 0 }, { id: "a3", m: 1, n: "Old", o: 0 }],
  cats: [{ id: "c1", m: 1, k: "o", name: "Εκτύπωση" }],
  tx: [
    { id: "t3", m: 1, d: "2026-12-03", a: 1250, k: "o", c: "c1", n: "Τυπογραφείο", ac: "a1", src: "bank", fit: "F1", ot: "ΠΛΗΡΩΜΗ ΤΥΠΟΓΡΑΦΕΙΟ", area: "pub" },
    { id: "t1", m: 1, d: "2026-12-01", a: 4050, k: "i", ac: "a2", pp: 1 },
    { id: "t2", m: 1, d: "2026-12-01", a: 99, k: "o", c: "o-groc", ac: "a3", oc: "USD", oa: 105 },
    { id: "t4", m: 5, d: "2026-12-02", a: 700, k: "o" },
    { id: "t5", m: 1, d: "2027-01-01", a: 1, k: "o" }
  ],
  tombs: { "tx:t4": 9, "acc:a3": 9 }
};

test("allowed: only apps set to read, never the closed list", () => {
  const offered = [{ id: "budget", name: "Budget" }, { id: "diary", name: "Diary" }, { id: "notes", name: "Notes" }, { id: "stock", name: "Stock" }];
  const ok = G.allowed(offered, { budget: "read", diary: "read", notes: "off" });
  assert.deepEqual(ok.map((a) => a.id), ["budget"]);
  assert.ok(G.NEVER.indexOf("passwords") >= 0 && G.NEVER.indexOf("mail") >= 0);
  assert.deepEqual(G.toolsOf("budget"), ["search_data", "app_summary", "budget_lines"]);
  assert.deepEqual(G.toolsOf("notes"), ["search_data"]);
  assert.deepEqual(G.toolsOf("kanban"), ["search_data", "app_summary"]);
});

test("budget_lines: days, order, tombstones, names, amounts, extras", () => {
  const r = G.budgetLines(data, { from: "2026-12-01", to: "2026-12-31" });
  assert.equal(r.ok, true);
  assert.equal(r.data.total, 3);
  assert.deepEqual(r.data.lines.map((l) => l.id), ["t1", "t2", "t3"]);
  const [l1, l2, l3] = r.data.lines;
  assert.deepEqual(l1, { id: "t1", date: "2026-12-01", kind: "income", amount: "40.50", account: "Viva", paypal: true });
  assert.equal(l2.account, "(deleted account)");
  assert.equal(l2.category, "o-groc");
  assert.equal(l2.original_currency, "USD");
  assert.equal(l2.original_amount, "1.05");
  assert.deepEqual(l3, { id: "t3", date: "2026-12-03", kind: "expense", amount: "12.50", category: "Εκτύπωση", account: "Πειραιώς",
    note: "Τυπογραφείο", bank_text: "ΠΛΗΡΩΜΗ ΤΥΠΟΓΡΑΦΕΙΟ", bank_id: "F1", source: "bank", area: "pub" });
  assert.equal(r.data.next_offset, undefined);
});

test("budget_lines: account by name (accents and case aside), bank only", () => {
  const a = G.budgetLines(data, { from: "2026-12-01", to: "2026-12-31", account: "πειραιως" });
  assert.deepEqual(a.data.lines.map((l) => l.id), ["t3"]);
  assert.equal(a.data.account, "Πειραιώς");
  const b = G.budgetLines(data, { from: "2026-12-01", to: "2026-12-31", bank: true });
  assert.deepEqual(b.data.lines.map((l) => l.id), ["t1", "t3"]);
  const none = G.budgetLines(data, { from: "2026-12-01", to: "2026-12-31", account: "Alpha" });
  assert.equal(none.ok, false);
  assert.match(none.err, /Πειραιώς, Viva/);
});

test("budget_lines: refuses bad days and spans, pages by 500", () => {
  assert.equal(G.budgetLines(data, { from: "2026-12-31", to: "2026-12-01" }).ok, false);
  assert.equal(G.budgetLines(data, { from: "2026-1-1", to: "2026-12-01" }).ok, false);
  assert.equal(G.budgetLines(data, { from: "2025-01-01", to: "2026-12-31" }).ok, false);
  assert.equal(G.budgetLines(data, { from: "2026-12-01", to: "2026-12-31", offset: -1 }).ok, false);
  const many = { tx: [] };
  for (let i = 0; i < 1203; i++) many.tx.push({ id: "x" + String(i).padStart(5, "0"), m: 1, d: "2026-12-05", a: 100, k: "o" });
  const p1 = G.budgetLines(many, { from: "2026-12-01", to: "2026-12-31" });
  assert.equal(p1.data.lines.length, 500);
  assert.equal(p1.data.next_offset, 500);
  const p3 = G.budgetLines(many, { from: "2026-12-01", to: "2026-12-31", offset: 1000 });
  assert.equal(p3.data.lines.length, 203);
  assert.equal(p3.data.next_offset, undefined);
  assert.equal(G.budgetLines(null, { from: "2026-12-01", to: "2026-12-31" }).data.total, 0);
});

test("cents and search hits", () => {
  assert.equal(G.cents(5), "0.05");
  assert.equal(G.cents(-12345), "-123.45");
  const items = G.packHits([{ id: "notes", hits: [{ id: 7, title: "Τιμές", text: "α".repeat(2000), when: Date.UTC(2026, 10, 7) }] }], { notes: "Notes" });
  assert.equal(items.length, 1);
  assert.equal(items[0].id, "7");
  assert.equal(items[0].date, "2026-11-07");
  assert.equal(items[0].text.length, 1501);
});

test("log keeps the newest 300", () => {
  let l = [];
  for (let i = 0; i < 305; i++) l = G.pushLog(l, { t: i });
  assert.equal(l.length, G.LOG_MAX);
  assert.equal(l[0].t, 5);
});

// Wave 2: Invoices, Stock, Publishing, and the relay a gate lives on.
const INV = require("../invoices/core.js");
const STK = require("../stock/core.js");

test("invoice_list: issued in range, drafts out, totals, paid, received bills", () => {
  const line = (p) => ({ code: "B1", d: "Book", q: 2, unit: "", p, disc: 0, vat: 6 });
  const doc = (id, extra) => Object.assign({ id, kind: "inv", st: "issued", ser: "ser-inv", seq: 1, num: "INV-1", date: "2026-12-02",
    due: "2026-12-10", cur: "EUR", cli: "", c: { name: "Βιβλιοπωλείο", afm: "123456789" }, lines: [line(1000)], gDisc: 0, wht: 0, m: 1 }, extra || {});
  const raw = { ver: 1, clients: [], pays: [{ id: "pay-1", doc: "doc-1", amt: 1000, date: "2026-12-05", how: "bank", note: "", m: 1 }],
    docs: [doc("doc-1"), doc("doc-2", { st: "draft", num: "", seq: 0 }), doc("doc-3", { date: "2027-01-03", num: "INV-2", seq: 2 }),
      doc("doc-4", { kind: "cred", num: "CR-1", ser: "ser-cred", date: "2026-12-04" })],
    bills: [{ id: "bil-1", num: "Π-77", date: "2026-12-03", due: "2026-11-30", cur: "EUR", sup: { name: "Τυπογραφείο", afm: "999" }, net: 10000, vat: 2400, note: "", m: 1 }],
    bpays: [] };
  const r = G.invoiceList(INV, raw, { from: "2026-12-01", to: "2026-12-31" }, "2026-12-20");
  assert.equal(r.ok, true);
  assert.deepEqual(r.data.documents.map((d) => d.id), ["doc-1", "doc-4"], "by day; the draft and January left out");
  const d1 = r.data.documents.find((d) => d.id === "doc-1");
  assert.equal(d1.client, "Βιβλιοπωλείο");
  assert.equal(d1.kind, "invoice");
  assert.equal(d1.net, "20.00");
  assert.equal(d1.vat, "1.20");
  assert.equal(d1.total, "21.20");
  assert.equal(d1.paid, "10.00");
  assert.deepEqual(d1.lines[0], { text: "Book", qty: 2, price: "10.00", vat_rate: 6, code: "B1" });
  const d4 = r.data.documents.find((d) => d.id === "doc-4");
  assert.equal(d4.kind, "credit note");
  assert.equal(d4.total, "-21.20");
  const b = G.invoiceList(INV, raw, { from: "2026-12-01", to: "2026-12-31", received: true }, "2026-12-20");
  assert.equal(b.data.kind, "received");
  assert.deepEqual(b.data.documents[0], { id: "bil-1", number: "Π-77", date: "2026-12-03", currency: "EUR", due: "2026-11-30",
    supplier: "Τυπογραφείο", supplier_vat_id: "999", net: "100.00", vat: "24.00", total: "124.00", paid: "0.00", balance: "124.00", status: "overdue" });
  assert.equal(G.invoiceList(INV, null, { from: "2026-12-01", to: "2026-12-31" }, "2026-12-20").data.total, 0);
  assert.equal(G.invoiceList(INV, raw, { from: "2026-12-31", to: "2026-12-01" }, "2026-12-20").ok, false);
});

test("stock_items: quantity from movements, low, query, archived", () => {
  const raw = {
    items: [
      { id: "book01", m: 1, name: "Λύκοι της θάλασσας", sku: "GL-001", unit: "pcs", price: 1500, cost: 400, vat: 6, min: 20000, cat: "cat001" },
      { id: "book02", m: 1, name: "Salt", unit: "pcs", price: 1200, vat: 6 },
      { id: "book03", m: 1, name: "Old", unit: "pcs", arch: 1 }
    ],
    cats: [{ id: "cat001", m: 1, name: "Βιβλία" }], units: [], sups: [], tombs: {},
    moves: [
      { id: "mv0001", m: 1, t: "in", d: "2026-05-01", lines: [{ i: "book01", q: 50000 }, { i: "book02", q: 3000 }] },
      { id: "mv0002", m: 1, t: "out", d: "2026-05-10", lines: [{ i: "book01", q: -35000 }] }
    ]
  };
  const r = G.stockItems(STK, raw, {});
  assert.equal(r.ok, true);
  assert.deepEqual(r.data.items.map((i) => i.id), ["book02", "book01"], "by name, archived left out");
  const a = r.data.items[1];
  assert.equal(a.on_hand, "15");
  assert.equal(a.minimum, "20");
  assert.equal(a.low, true);
  assert.equal(a.category, "Βιβλία");
  assert.equal(a.price, "15.00");
  assert.deepEqual(G.stockItems(STK, raw, { low: true }).data.items.map((i) => i.id), ["book01"]);
  assert.deepEqual(G.stockItems(STK, raw, { query: "λυκοι" }).data.items.map((i) => i.id), ["book01"]);
  assert.deepEqual(G.stockItems(STK, raw, { archived: true }).data.items.map((i) => i.id), ["book03", "book02", "book01"]);
  assert.equal(G.stockItems(STK, null, {}).data.total, 0);
});

test("publish_titles: status, people, formats, query by ISBN, tombstones", () => {
  const raw = { ver: 1, tombs: { t3: 9 }, titles: [
    { id: "t1", m: 1, t: "Ψίθυρος", st: "out", rel: "2026-05-01", ppl: [{ r: "a", n: "Νίκη" }], fmts: [{ id: "f1", k: "pb", isbn: "9786185321001", price: 1500, pages: 120 }] },
    { id: "t2", m: 1, t: "Άλφα", st: "idea" },
    { id: "t3", m: 1, t: "Gone", st: "out" }
  ] };
  const r = G.publishTitles(raw, {});
  assert.deepEqual(r.data.titles.map((t) => t.id), ["t2", "t1"]);
  assert.deepEqual(r.data.titles[1], { id: "t1", title: "Ψίθυρος", status: "published", release: "2026-05-01",
    people: [{ role: "author", name: "Νίκη" }], formats: [{ format: "paperback", isbn: "9786185321001", price: "15.00", pages: 120 }] });
  assert.deepEqual(G.publishTitles(raw, { status: "published" }).data.titles.map((t) => t.id), ["t1"]);
  assert.deepEqual(G.publishTitles(raw, { query: "9786185321001" }).data.titles.map((t) => t.id), ["t1"]);
  assert.equal(G.publishTitles(raw, { status: "sold" }).ok, false);
});

test("tools per app and the relay a gate is made on", () => {
  assert.deepEqual(G.toolsOf("invoices"), ["search_data", "invoice_list"]);
  assert.deepEqual(G.toolsOf("stock"), ["search_data", "app_summary", "stock_items"]);
  assert.deepEqual(G.toolsOf("publish"), ["search_data", "publish_titles"]);
  assert.equal(G.relayOf(null), G.RELAY);
  assert.equal(G.relayOf({ relay: { url: "https://relay.example.org/" } }), "https://relay.example.org");
  assert.equal(G.relayOf({ relay: { url: "http://relay.example.org" } }), G.RELAY);
  assert.equal(G.relayOf({ relay: { url: "" } }), G.RELAY);
});

// Wave 3: changes to Budget inside a write window.
test("budget_write: add with names, change, delete, all or none", () => {
  const base = JSON.parse(JSON.stringify(data));
  let n = 0;
  const id = () => "new" + (++n);
  const add = G.budgetWrite("add", base, { entries: [
    { date: "2026-12-10", kind: "expense", amount: "12.50", category: "εκτυπωση", account: "viva", note: "Χαρτί" },
    { date: "2026-12-11", kind: "income", amount: 40 }] }, 5000, id);
  assert.equal(add.ok, true);
  assert.deepEqual(add.ids, ["new1", "new2"]);
  const x1 = add.data.tx.find((x) => x.id === "new1");
  assert.deepEqual(x1, { id: "new1", m: 5000, d: "2026-12-10", a: 1250, k: "o", c: "c1", n: "Χαρτί", ac: "a2" });
  assert.equal(add.data.tx.find((x) => x.id === "new2").a, 4000);
  assert.deepEqual(add.data.tx.map((x) => x.id), add.data.tx.map((x) => x.id).slice().sort(), "sorted by id");
  assert.equal(base.tx.length, 5, "the input is never touched");
  assert.equal(G.budgetWrite("add", base, { entries: [{ date: "2026-12-10", kind: "expense", amount: "1.234" }] }, 1, id).ok, false);
  assert.match(G.budgetWrite("add", base, { entries: [{ date: "2026-12-10", kind: "expense", amount: "1", category: "Nope" }] }, 1, id).err, /Εκτύπωση/);
  assert.equal(G.budgetWrite("add", base, { entries: [{ date: "2026-12-10", kind: "income", amount: "1", category: "Εκτύπωση" }] }, 1, id).ok, false, "an expense category is not an income one");
  assert.equal(G.budgetWrite("add", base, { entries: new Array(51).fill({ date: "2026-12-10", kind: "expense", amount: "1" }) }, 1, id).ok, false);

  const ch = G.budgetWrite("change", base, { id: "t3", amount: "13", note: "" }, 2, id);
  assert.equal(ch.ok, true);
  const t3 = ch.data.tx.find((x) => x.id === "t3");
  assert.equal(t3.a, 1300);
  assert.equal(t3.n, "");
  assert.equal(t3.m, 2, "stamp after the old one");
  assert.equal(t3.ot, "ΠΛΗΡΩΜΗ ΤΥΠΟΓΡΑΦΕΙΟ", "bank fields kept");
  assert.equal(G.budgetWrite("change", base, { id: "t2", amount: "2" }, 9, id).ok, false, "typed in another currency");
  assert.equal(G.budgetWrite("change", base, { id: "t4", note: "x" }, 9, id).ok, false, "a deleted entry");
  assert.equal(G.budgetWrite("change", base, { id: "t3" }, 9, id).ok, false, "nothing to change");
  assert.equal(G.budgetWrite("change", { tx: [{ id: "l-pl-ab-o1", m: 1, d: "2026-12-01", a: 1, k: "i" }] }, { id: "l-pl-ab-o1", note: "x" }, 9, id).ok, false, "a shop entry");

  const del = G.budgetWrite("delete", base, { ids: ["t1", "t3"] }, 50, id);
  assert.equal(del.ok, true);
  assert.deepEqual(del.data.tx.map((x) => x.id), ["t2", "t4", "t5"]);
  assert.equal(del.data.tombs["tx:t1"], 50);
  assert.equal(G.budgetWrite("delete", base, { ids: ["t1", "nope"] }, 50, id).ok, false, "all or none");
  assert.equal(G.budgetWrite("delete", { tx: [{ id: "r1", m: 1, d: "2026-12-01", a: 1, k: "o", rc: "a.jpg" }] }, { ids: ["r1"] }, 9, id).ok, false, "receipts on the disk");
});

test("budget_undo: puts back adds, changes and deletes, leaves what changed since", () => {
  const base = JSON.parse(JSON.stringify(data));
  const add = G.budgetWrite("add", base, { entries: [{ date: "2026-12-10", kind: "expense", amount: "5" }] }, 100, () => "n1");
  const u1 = G.budgetUndo(add.data, add.undo, 200);
  assert.equal(u1.n, 1);
  assert.equal(u1.data.tx.some((x) => x.id === "n1"), false);
  assert.equal(u1.data.tombs["tx:n1"], 200);

  const ch = G.budgetWrite("change", base, { id: "t3", amount: "99" }, 100, () => "x");
  const u2 = G.budgetUndo(ch.data, ch.undo, 200);
  const t3 = u2.data.tx.find((x) => x.id === "t3");
  assert.equal(t3.a, 1250);
  assert.equal(t3.m, 200);

  const del = G.budgetWrite("delete", base, { ids: ["t1"] }, 100, () => "x");
  const u3 = G.budgetUndo(del.data, del.undo, 200);
  assert.equal(u3.data.tx.find((x) => x.id === "t1").a, 4050);
  assert.equal(u3.data.tombs["tx:t1"], undefined);

  const later = JSON.parse(JSON.stringify(ch.data));
  later.tx.find((x) => x.id === "t3").m = 150;          // changed again since
  const u4 = G.budgetUndo(later, ch.undo, 200);
  assert.equal(u4.n, 0);
  assert.equal(u4.kept, 1);
});

test("write rules: only write level, unless the owner paused changes (one rule, 5.78.00)", () => {
  assert.equal(G.canWrite({ budget: "write" }, 0, "budget", 1000), true, "no window needed");
  assert.equal(G.canWrite({ budget: "write" }, undefined, "budget", 1000), true);
  assert.equal(G.canWrite({ budget: "write" }, 900, "budget", 1000), true, "a pause that ended");
  assert.equal(G.canWrite({ budget: "write" }, 2000, "budget", 1000), false, "paused");
  assert.equal(G.canWrite({ budget: "read" }, 0, "budget", 1000), false);
  assert.equal(G.canWrite({ notes: "write" }, 0, "notes", 1000), false, "only apps with write tools");
  assert.deepEqual(G.allowed([{ id: "budget" }], { budget: "write" }).map((a) => a.id), ["budget"], "write also reads");
});

test("switches from another device: never-apps off, write only where allowed (5.77.00)", () => {
  assert.deepEqual(G.lvFrom({ budget: "write", diary: "read", passwords: "write", invoices: "write", kanban: "write", stock: "read", x: "maybe" }),
    { budget: "write", invoices: "read", kanban: "write", stock: "read" });
  assert.deepEqual(G.lvFrom(null), {});
  assert.deepEqual(G.lvFrom(["budget"]), {});
});

test("join QR link: #gate-join=CODE, only the code alphabet (5.77.00)", () => {
  assert.equal(G.joinHash("#gate-join=ABCD2345"), "ABCD2345");
  assert.equal(G.joinHash("#gate-join=abcd2345"), "");
  assert.equal(G.joinHash("#gate-join=ABCD1345"), "", "no 1 in the code alphabet");
  assert.equal(G.joinHash("#gate-join=ABCD2345&x"), "");
  assert.equal(G.joinHash(""), "");
});

test("the synced seat: bad shapes dropped, the newer one wins, merge is symmetric (5.77.00)", () => {
  const a = { id: "abcdefghijklmnopqrstuv", ss: "x".repeat(43), r: "https://relay.example", m: 5 };
  const b = { id: "bbcdefghijklmnopqrstuv", ss: "y".repeat(43), r: "https://relay.example", m: 9, extra: 1 };
  assert.deepEqual(G.seatMerge(a, b), { id: b.id, ss: b.ss, r: b.r, m: 9 });
  assert.deepEqual(G.seatMerge(b, a), G.seatMerge(a, b));
  assert.deepEqual(G.seatMerge(a, a), a);
  assert.equal(G.seatClean({ id: "short", ss: "x".repeat(43), r: "https://r", m: 1 }), null);
  assert.equal(G.seatClean(Object.assign({}, a, { r: "http://insecure" })), null);
  assert.deepEqual(G.seatMerge(null, a), a);
});
