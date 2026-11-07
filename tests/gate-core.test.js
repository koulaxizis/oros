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
