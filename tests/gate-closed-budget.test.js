// 6.05.00 (Chris 2026-11-10 «Πρέπει να μπορείς να δουλεύεις και με
// κλειστό το orOS»): the closed-orOS copy keeps Budget's lines of about
// 400 days (gate.js bglCopy) and the relay answers budget_lines from it
// for any range (relay/gate.js closedLines), with the accounts and the
// possible duplicates.
// Run: node --test tests/

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const G = require("../gate/gate.js");
const L = require("../budget/loans.js");

let R;
test.before(async () => { R = await import("../relay/gate.js"); });

function data() {
  const tx = [];
  for (let i = 0; i < 40; i++) {
    const d = new Date(Date.UTC(2026, 9, 1) + i * 86400000).toISOString().slice(0, 10);
    tx.push({ id: "t" + i, m: 1, d, a: 1000 + i, k: i % 5 ? "o" : "i", c: "", n: "Line " + i, ac: i % 2 ? "alpha" : "viva", src: i % 3 ? "bank" : undefined, fit: i % 3 ? "F" + i : undefined });
  }
  tx.push({ id: "c1", m: 1, d: "2026-10-20", a: 2890, k: "o", c: "", n: "COSMOTE FIXED · Αγορά", ac: "card", src: "bank", fit: "C1" });
  tx.push({ id: "c2", m: 1, d: "2026-10-22", a: 2890, k: "o", c: "", n: "CΟSΜΟΤΕ FΙΧΕD", ac: "alpha", src: "bank", fit: "C2" });
  tx.push({ id: "old", m: 1, d: "2024-01-01", a: 5, k: "o", c: "", n: "too old", ac: "alpha" });
  return { ver: 1, tx, cats: [], acc: [
    { id: "alpha", m: 1, n: "Alpha", o: 100000, col: 0 },
    { id: "card", m: 1, n: "Debit Card", o: 0, col: 1 },
    { id: "viva", m: 1, n: "Viva Business", o: 0, col: 2 }
  ], xfer: [], adj: [], area: [], bnk: [{ id: "b1", m: 1, ac: "alpha", bb: 12345, bc: "EUR", bd: "2026-11-09" }], set: { m: 0, cur: "EUR" }, tombs: {} };
}
const cp = (bgl) => ({ at: 1e12, ans: { __bgl: bgl } });
const body = (r) => JSON.parse(r.c.slice(r.c.indexOf("\n") + 1));

test("bglCopy: every line of 400 days, accounts and duplicates; the oldest days go first when too big", () => {
  const txt = G.bglCopy(data(), "2026-11-10", L, 300000);
  const g = JSON.parse(txt);
  assert.equal(g.from, "2025-10-06");
  assert.equal(g.to, "2026-11-10");
  assert.equal(g.lines.length, 42, "the 2024 line is outside the 400 days");
  assert.deepEqual(g.possible_duplicates.map((p) => p.ids), [["c1", "c2"]]);
  assert.equal(g.accounts.find((a) => a.name === "Alpha").bank.balance, "123.45");
  // small: whole days are dropped from the oldest end
  const small = JSON.parse(G.bglCopy(data(), "2026-11-10", L, 5000));
  assert.ok(small.lines.length < 42 && small.lines.length > 0);
  assert.equal(small.from, small.lines[0].date);
  assert.equal(small.lines[small.lines.length - 1].date, "2026-11-09");
  assert.ok(Buffer.byteLength(JSON.stringify(small)) <= 5000);
  assert.equal(G.bglCopy(null, "2026-11-10", L, 5000), "");
});

test("relay closedLines: any range, account, bank, pages and notes, like the device", () => {
  const raw = data();
  const g = G.bglCopy(raw, "2026-11-10", L, 300000);
  const args = { from: "2026-10-10", to: "2026-10-25" };
  const r = R.closedLines(cp(g), args, "X");
  assert.equal(r.ok, true, r.c);
  assert.match(r.c, /^\[orOS is closed: this is the copy of X\]\n/);
  const live = G.budgetLines(raw, args, L).data, b = body(r);
  assert.deepEqual(b.lines, live.lines, "the same lines as the device gives");
  assert.equal(b.total, live.total);
  assert.deepEqual(b.possible_duplicates, live.possible_duplicates);
  assert.equal(b.accounts_as_of, "2026-11-10");
  assert.match(b.note, /Account balances are as of 2026-11-10/);
  const acc = body(R.closedLines(cp(g), Object.assign({ account: "viva business" }, args), "X"));
  assert.deepEqual(acc.lines.map((x) => x.id), live.lines.filter((x) => x.account === "Viva Business").map((x) => x.id));
  assert.equal(acc.possible_duplicates, undefined, "a pair needs both lines in the answer");
  const bank = body(R.closedLines(cp(g), Object.assign({ bank: true }, args), "X"));
  assert.deepEqual(bank.lines.map((x) => x.id), G.budgetLines(raw, Object.assign({ bank: true }, args), L).data.lines.map((x) => x.id));
  assert.match(body(R.closedLines(cp(g), { from: "2025-01-01", to: "2025-12-31" }, "X")).note, /start on 2025-10-06/);
  assert.match(R.closedLines(cp(g), { from: "2026-10-10" }, "X").c, /from and to must be days/);
  assert.match(R.closedLines(cp(g), Object.assign({ account: "Nope" }, args), "X").c, /Accounts: Alpha, Debit Card, Viva Business/);
  assert.equal(R.closedLines({ at: 1, ans: { __bgl: "{" } }, args, "X").ok, false);
});
