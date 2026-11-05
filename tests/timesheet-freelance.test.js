// Timesheet T3: monthly packages (retainers) shown against their hours,
// fixed-fee projects and the hourly rate they make, mileage charges,
// extra charges handed to Budget (BR-B1), the client timesheet PDF.
// Run: node --test tests/
//
// Dates are LOCAL (new Date(y, m, d, h, min)), as in timesheet.test.js.

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const C = require("../timesheet/core.js");

const at = (d, h, m) => new Date(2026, 9, d, h, m || 0).getTime();   // October 2026
const NOW = at(20, 18);
const ent = (id, p, s, e) => ({ id, p, desc: "", s, e, billed: 0, m: s });
const read = (f) => fs.readFileSync(path.join(__dirname, "..", f), "utf8");

function base(extra) {
  return C.normalize(Object.assign({
    ver: 1,
    clients: [{ id: "cccccc1", name: "Acme", rate: 0, minAmt: 100000, otH: 1200, minPer: "m", otRate: 6000, crm: "cust01", m: 1 }],
    projects: [
      { id: "pppppp1", name: "Site", client: "cccccc1", m: 1 },
      { id: "pppppp2", name: "Logo", client: "", rate: 5000, fee: 80000, m: 1 },
      { id: "pppppp3", name: "Own", client: "cccccc1", bill: 0, m: 1 }
    ],
    entries: [
      ent("eeeeee1", "pppppp1", at(5, 9), at(5, 17)),     // 8 h
      ent("eeeeee2", "pppppp1", at(6, 9), at(6, 17)),     // 8 h
      ent("eeeeee3", "pppppp3", at(7, 9), at(7, 17)),     // not billable
      ent("eeeeee4", "pppppp1", at(28, 9), at(28, 9, 30)),
      ent("eeeeee5", "pppppp2", at(8, 9), at(8, 19)),     // 10 h on the fixed fee
      ent("eeeeee6", "pppppp1", at(2, 9) - 40 * C.DAY, at(2, 17) - 40 * C.DAY)   // another month
    ],
    extras: []
  }, extra || {}));
}

test("fee, km, kmr and bud are written only when set, so older data stays byte-identical", () => {
  const d = base();
  assert.equal(d.projects.find((p) => p.id === "pppppp2").fee, 80000);
  assert.ok(!("fee" in d.projects.find((p) => p.id === "pppppp1")));
  assert.ok(!("fee" in C.normProject({ id: "pppppp9", name: "X", fee: 0, m: 1 })));
  const x = C.normExtra({ id: "xxxxxx1", d: "2026-10-01", amt: 8420, km: 210.5, kmr: 40, bud: 1, fee: 1, m: 1 });
  assert.deepEqual([x.km, x.kmr, x.bud, x.fee], [210.5, 40, 1, 1]);
  const plain = C.normExtra({ id: "xxxxxx2", d: "2026-10-01", amt: 100, m: 1 });
  assert.deepEqual(Object.keys(plain), ["id", "d", "p", "c", "desc", "amt", "billed", "m"]);
  // a bad distance or rate drops both; flags other than 1 are not kept
  assert.ok(!("km" in C.normExtra({ id: "xxxxxx3", d: "2026-10-01", amt: 1, km: 1.25, kmr: 40, m: 1 })));
  assert.ok(!("km" in C.normExtra({ id: "xxxxxx3", d: "2026-10-01", amt: 1, km: 12, kmr: 0, m: 1 })));
  assert.ok(!("bud" in C.normExtra({ id: "xxxxxx3", d: "2026-10-01", amt: 1, bud: true, m: 1 })));
});

test("mileage: one decimal of km × cents per km", () => {
  assert.equal(C.parseKm("12,5"), 12.5);
  assert.equal(C.parseKm("120"), 120);
  assert.ok(Number.isNaN(C.parseKm("1,25")));
  assert.ok(Number.isNaN(C.parseKm("0")));
  assert.ok(Number.isNaN(C.parseKm("abc")));
  assert.equal(C.kmAmount(210.5, 40), 8420);
  assert.equal(C.kmAmount(12.5, 33), 413);       // 412,5 → 413
  assert.ok(Number.isNaN(C.kmAmount(12, 0)));
  assert.equal(C.fmtKm(12.5, "el"), "12,5");
  assert.equal(C.fmtKm(12.5, "en"), "12.5");
});

test("a monthly package: this month's billable hours against the hours included", () => {
  const d = base();
  const u = C.pkgUse(d, "c", "cccccc1", "2026-10-20", NOW);
  assert.equal(u.from, "2026-10-01");
  assert.equal(u.to, "2026-10-31");
  assert.equal(u.ms, 16.5 * C.HOUR, "not billable and other months left out");
  assert.equal(u.inclMs, 20 * C.HOUR);
  assert.equal(u.pct, 82);
  assert.equal(u.state, "near");
  d.entries.push(C.normEntry(ent("eeeeee7", "pppppp1", at(29, 9), at(29, 14))));
  assert.equal(C.pkgUse(d, "c", "cccccc1", "2026-10-20", NOW).state, "over");
  // a day rate is not a package; nothing without hours included
  assert.equal(C.pkgUse(base({ clients: [{ id: "cccccc1", name: "A", minAmt: 100, minPer: "d", otH: 480, m: 1 }] }), "c", "cccccc1", "2026-10-20", NOW), null);
  assert.equal(C.pkgUse(base({ clients: [{ id: "cccccc1", name: "A", minAmt: 100, minPer: "m", m: 1 }] }), "c", "cccccc1", "2026-10-20", NOW), null);
});

test("a fixed fee: its time is not charged by the hour, the fee shows what it makes per hour", () => {
  const d = base();
  const r = C.report(d, "2026-10-08", "2026-10-08", { group: "project" }, NOW);
  assert.equal(r.total.amount, 0);
  assert.equal(r.total.billMs, 10 * C.HOUR, "still billable time");
  assert.deepEqual(C.effRate(d, "pppppp2", NOW), { fee: 80000, ms: 10 * C.HOUR, rate: 8000 });
  assert.equal(C.effRate(d, "pppppp1", NOW), null);
  // no zero-price time line on a quote or invoice; the fee goes on as an extra charge
  assert.deepEqual(C.quoteLines(d, "2026-10-08", "2026-10-08", {}, NOW, "en").items, []);
  d.extras = [C.normExtra({ id: "xxxxxx1", d: "2026-10-08", p: "pppppp2", desc: "Fixed fee: Logo", amt: 80000, fee: 1, m: 1 })];
  assert.equal(C.feeExtra(d, "pppppp2").id, "xxxxxx1");
  const q = C.quoteLines(d, "2026-10-08", "2026-10-08", {}, NOW, "en");
  assert.deepEqual(q.items.map((it) => [it.q, it.p]), [[1, 800]]);
  assert.deepEqual(q.ids, ["eeeeee5"], "the fee's hours are invoiced with it");
});

test("Budget gets an expense with the day, description and client; mileage as transport", () => {
  const d = base();
  const x = C.normExtra({ id: "xxxxxx1", d: "2026-10-06", p: "pppppp1", desc: "Trip", amt: 8420, km: 210.5, kmr: 40, m: 1 });
  assert.deepEqual(C.budgetPrefill(d, x), { k: "o", a: 8420, d: "2026-10-06", n: "Trip · Acme", c: "o-trans", src: "timesheet", crm: "cust01" });
  const y = C.normExtra({ id: "xxxxxx2", d: "2026-10-06", desc: "Parking", amt: 500, m: 1 });
  assert.deepEqual(C.budgetPrefill(d, y), { k: "o", a: 500, d: "2026-10-06", n: "Parking", src: "timesheet" });
});

test("the app: Budget only through BR-B1, a refused prefill marks nothing, the PDF through jsPDF and Mail compose", () => {
  const src = read("timesheet/timesheet.js");
  assert.match(src, /window\.parent\.__orosOpenBudgetNew/);
  assert.match(src, /ok = fn\(C\.budgetPrefill\(data, x\)\) !== false/);
  assert.match(src, /if \(!ok\) \{ showToast\(t\("toast\.budFail"\)\); return; \}/);
  assert.match(src, /if \(x && !isFee && budgetApi\(\)\)/, "a fee is income, never sent as an expense");
  assert.doesNotMatch(src, /oros-budget-new/, "never stages Budget's sessionStorage itself");
  assert.match(src, /loadOther\("\.\.\/vendor\/jspdf\.umd\.min\.js", "jspdf"/);
  assert.match(src, /__orosOpenAt\("mail", \{ compose: \{/);
  assert.match(src, /attach: \[\{ name: pdfName\(\), type: "application\/pdf", b64: b64 \}\]/);
});
