// Timesheet: minimum charge per client (day / week / month), overtime
// at its own rate, and extra charges (fuel, work away, …) — the model,
// the merge, reports, CSV, quote lines and the .oroshours file.
// Run: node --test tests/
//
// Dates are LOCAL (new Date(y, m, d, h, min)), as in timesheet.test.js.

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const C = require("../timesheet/core.js");
const P = require("../timesheet/package.js");

const at = (d, h, m) => new Date(2026, 9, d, h, m || 0).getTime();   // October 2026
const key = (d) => "2026-10-" + String(d).padStart(2, "0");
const ent = (id, p, s, e, extra) => Object.assign({ id, p, desc: "", s, e, billed: 0, m: s }, extra || {});
const json = (x) => JSON.stringify(x);
const H = C.HOUR;
const NOW = at(31, 23);

// Client "cccccc1": 50/h, minimum 2 h a day, overtime 75/h.
function base(client, extra) {
  return C.normalize(Object.assign({
    ver: 1,
    clients: [Object.assign({ id: "cccccc1", name: "Acme", rate: 5000, m: 1 }, client || {})],
    projects: [
      { id: "pppppp1", name: "Site", client: "cccccc1", m: 1 },
      { id: "pppppp2", name: "Repair", client: "cccccc1", rate: 6000, m: 1 },
      { id: "pppppp3", name: "Own", client: "", m: 1 }
    ],
    entries: []
  }, extra || {}));
}

test("normalize: minimum fields only when set; period and overtime defaults; extras list only when used", () => {
  const plain = base();
  assert.deepEqual(plain.clients[0], { id: "cccccc1", name: "Acme", rate: 5000, m: 1 });
  assert.ok(!("extras" in plain), "no extras key without a record, so old data stays byte-identical");
  assert.deepEqual(Object.keys(plain), ["ver", "clients", "projects", "entries", "prefs", "pm"]);

  const d = base({ minH: 120, minPer: "x", otRate: 7500 });
  assert.deepEqual(d.clients[0], { id: "cccccc1", name: "Acme", rate: 5000, minH: 120, minPer: "d", otRate: 7500, m: 1 });
  const noMin = base({ minH: 0, minPer: "w", otRate: 7500 });
  assert.deepEqual(noMin.clients[0], { id: "cccccc1", name: "Acme", rate: 5000, m: 1 }, "overtime needs a minimum");
  assert.equal(base({ minH: -5 }).clients[0].minH, undefined);
  assert.equal(base({ minH: 120, minPer: "m" }).clients[0].minPer, "m");

  const x = C.normalize({ ver: 1, clients: [], projects: [], entries: [], extras: [
    { id: "xxxxxx1", d: key(5), p: "pppppp1", desc: "  Fuel \n", amt: 2350, m: 3 },
    { id: "xxxxxx2", d: "2026-02-30", desc: "bad day", amt: 100, m: 1 },
    { id: "xxxxxx3", d: key(5), desc: "zero", amt: 0, m: 1 },
    { id: "xxxxxx4", m: 9, del: 1, d: key(1) },
    { id: "xxxxxx5", d: key(6), c: "cccccc1", desc: "Parking", amt: 400, billed: true, m: 2, future: "ok" }
  ] });
  assert.deepEqual(x.extras, [
    { id: "xxxxxx1", d: key(5), p: "pppppp1", c: "", desc: "Fuel", amt: 2350, billed: 0, m: 3 },
    { id: "xxxxxx4", m: 9, del: 1 },
    { id: "xxxxxx5", d: key(6), p: "", c: "cccccc1", desc: "Parking", amt: 400, billed: 1, m: 2, future: "ok" }
  ]);
  assert.equal(json(C.normalize(x)), json(x), "idempotent");
});

test("merge: extras per id, newer m wins, tombstone wins ties, symmetric; data without extras untouched", () => {
  const a = { ver: 1, clients: [], projects: [], entries: [], extras: [
    { id: "xxxxxx1", d: key(5), desc: "Fuel", amt: 2000, m: 5 },
    { id: "xxxxxx2", d: key(5), desc: "Toll", amt: 300, m: 5 }
  ] };
  const b = { ver: 1, clients: [], projects: [], entries: [], extras: [
    { id: "xxxxxx1", d: key(5), desc: "Fuel", amt: 2500, m: 6 },
    { id: "xxxxxx2", m: 5, del: 1 },
    { id: "xxxxxx3", d: key(7), desc: "Travel", amt: 1500, m: 1 }
  ] };
  const ab = C.mergeTimesheet(a, b), ba = C.mergeTimesheet(b, a);
  assert.equal(json(ab), json(ba));
  assert.deepEqual(ab.extras.map((x) => [x.id, x.amt || 0, !!x.del]),
    [["xxxxxx1", 2500, false], ["xxxxxx2", 0, true], ["xxxxxx3", 1500, false]]);
  // An old-style model (no extras key) merged with itself has no extras key.
  const old = { ver: 1, clients: [], projects: [], entries: [], prefs: C.DEFAULT_PREFS, pm: 0 };
  assert.equal(json(C.mergeTimesheet(old, old)), json(C.normalize(old)));
  assert.ok(!("extras" in C.mergeTimesheet(old, old)));
  // A merge with a model that lacks the list keeps this side's extras.
  assert.equal(C.mergeTimesheet(ab, old).extras.length, 3);
});

test("minimum per day: a short day is topped up to the minimum at the project's rate", () => {
  const d = base({ minH: 120 }, { entries: [
    ent("eeeeee1", "pppppp1", at(5, 9), at(5, 9, 30)),     // 0:30 on the 5th
    ent("eeeeee2", "pppppp1", at(6, 9), at(6, 12))         // 3:00 on the 6th (no overtime rate: usual rate)
  ] });
  const r = C.report(d, key(1), key(31), { group: "project" }, NOW);
  assert.equal(r.total.ms, 3.5 * H, "worked time is unchanged");
  assert.equal(r.total.minMs, 1.5 * H);
  assert.equal(r.total.minAmount, 7500);
  assert.equal(r.total.otMs, 1 * H);
  assert.equal(r.total.otAmount, 5000, "overtime at the usual rate when none is set");
  assert.equal(r.total.amount, 3.5 * 5000 + 7500);
  assert.equal(r.rows[0].minMs, 1.5 * H);
  assert.equal(r.tops.length, 1);
  assert.equal(r.tops[0].from, key(5));
  assert.equal(r.partial, 0);
});

test("overtime: time beyond the minimum at the client's overtime rate, in the order worked", () => {
  const d = base({ minH: 120, otRate: 7500 }, { entries: [
    ent("eeeeee2", "pppppp2", at(5, 13), at(5, 14)),        // second: 1:00 of which 1:00 overtime (60/h → 75/h)
    ent("eeeeee1", "pppppp1", at(5, 9), at(5, 11, 30))      // first: 2:30, 2:00 within + 0:30 overtime
  ] });
  const r = C.report(d, key(5), key(5), { group: "project" }, NOW);
  assert.equal(r.total.minMs, 0);
  assert.equal(r.total.otMs, 1.5 * H);
  assert.equal(r.total.otAmount, 0.5 * 7500 + 7500);
  assert.equal(r.total.amount, 2 * 5000 + 0.5 * 7500 + 7500);
  const site = r.rows.find((x) => x.key === "pppppp1"), repair = r.rows.find((x) => x.key === "pppppp2");
  assert.equal(site.amount, 2 * 5000 + 0.5 * 7500);
  assert.equal(repair.amount, 7500);
  assert.equal(repair.otMs, H);
  // Groupings add up alike.
  const byDay = C.report(d, key(5), key(5), { group: "day" }, NOW), byC = C.report(d, key(5), key(5), { group: "client" }, NOW);
  assert.equal(byDay.rows[0].amount, r.total.amount);
  assert.equal(byC.rows[0].amount, r.total.amount);
});

test("minimum per week / month: only whole periods inside the range count", () => {
  const entries = [ent("eeeeee1", "pppppp1", at(6, 9), at(6, 10)), ent("eeeeee2", "pppppp1", at(8, 9), at(8, 10))];
  const w = base({ minH: 600, minPer: "w" }, { entries });          // 10 h a week; week of Mon 5 – Sun 11
  const whole = C.report(w, key(5), key(11), {}, NOW);
  assert.equal(whole.total.minMs, 8 * H);
  assert.equal(whole.total.minAmount, 8 * 5000);
  const cut = C.report(w, key(6), key(11), {}, NOW);
  assert.equal(cut.total.minMs, 0, "a week cut by the range gets no minimum");
  assert.equal(cut.partial, 1);
  const m = base({ minH: 1200, minPer: "m" }, { entries });          // 20 h a month
  assert.equal(C.report(m, key(1), key(31), {}, NOW).total.minMs, 18 * H);
  assert.equal(C.report(m, key(1), key(15), {}, NOW).total.minMs, 0);
  assert.equal(C.report(m, key(1), key(15), {}, NOW).partial, 1);
  // A month without work charges nothing.
  assert.equal(C.report(m, "2026-11-01", "2026-11-30", {}, NOW).total.amount, 0);
});

test("minimum: non-billable projects, other clients and rounding", () => {
  const d = base({ minH: 60 }, {
    projects: [
      { id: "pppppp1", name: "Site", client: "cccccc1", m: 1 },
      { id: "pppppp4", name: "Internal", client: "cccccc1", bill: 0, m: 1 },
      { id: "pppppp3", name: "Own", client: "", rate: 1000, m: 1 }
    ],
    entries: [
      ent("eeeeee1", "pppppp4", at(5, 9), at(5, 12)),        // not billable: no minimum
      ent("eeeeee2", "pppppp3", at(5, 13), at(5, 13, 10)),   // no client: no minimum
      ent("eeeeee3", "pppppp1", at(6, 9), at(6, 9, 7))       // 0:07 → rounded up to 0:15, topped up to 1:00
    ],
    prefs: { round: 15, rup: 1 }
  });
  const r = C.report(d, key(1), key(31), {}, NOW);
  assert.equal(r.total.minMs, 45 * 60000);
  assert.equal(r.tops.length, 1);
  assert.equal(r.tops[0].pc.k, key(6));
  // A filter that leaves the client out leaves its minimum out.
  assert.equal(C.report(d, key(1), key(31), { project: "pppppp3" }, NOW).total.minMs, 0);
});

test("extra charges: in totals and groups, filters, invoiced marks", () => {
  const d = base(null, {
    entries: [ent("eeeeee1", "pppppp1", at(5, 9), at(5, 10))],
    extras: [
      { id: "xxxxxx1", d: key(5), p: "pppppp1", desc: "Fuel", amt: 2350, m: 1 },
      { id: "xxxxxx2", d: key(6), c: "cccccc1", desc: "Parking", amt: 400, billed: 1, m: 1 },
      { id: "xxxxxx3", d: key(7), desc: "Stamps", amt: 100, m: 1 },
      { id: "xxxxxx4", d: "2026-11-02", desc: "Later", amt: 999, m: 1 }
    ]
  });
  const r = C.report(d, key(1), key(31), { group: "project" }, NOW);
  assert.equal(r.total.exAmount, 2850);
  assert.equal(r.total.exN, 3);
  assert.equal(r.total.amount, 5000 + 2850);
  assert.deepEqual(r.exIds, ["xxxxxx1", "xxxxxx2", "xxxxxx3"]);
  assert.equal(r.rows.find((x) => x.key === "pppppp1").amount, 5000 + 2350);
  assert.equal(r.rows.find((x) => x.key === "").exAmount, 500, "client-only and loose extras fall under no project");
  const byC = C.report(d, key(1), key(31), { group: "client" }, NOW);
  assert.equal(byC.rows.find((x) => x.key === "cccccc1").amount, 5000 + 2350 + 400);
  assert.equal(byC.rows.find((x) => x.key === "").amount, 100);
  const byD = C.report(d, key(1), key(31), { group: "day" }, NOW);
  assert.deepEqual(byD.rows.map((x) => x.key), [key(5), key(6), key(7)]);
  assert.equal(C.report(d, key(1), key(31), { client: "cccccc1" }, NOW).total.exAmount, 2750);
  assert.equal(C.report(d, key(1), key(31), { client: "-" }, NOW).total.exAmount, 100);
  assert.equal(C.report(d, key(1), key(31), { project: "pppppp1" }, NOW).total.exAmount, 2350);
  assert.equal(C.report(d, key(1), key(31), { billed: "open" }, NOW).total.exAmount, 2450);
  assert.equal(C.report(d, key(1), key(31), { billed: "done" }, NOW).total.exAmount, 400);
  assert.equal(C.report(d, key(1), key(31), { bill: "non" }, NOW).total.exAmount, 0);
  assert.equal(C.report(d, key(1), key(31), { tag: "web" }, NOW).total.exAmount, 0);
  assert.equal(C.report(d, key(1), key(31), { tag: "-" }, NOW).total.exAmount, 2850);
  // A deleted extra counts nowhere.
  const gone = C.mergeTimesheet(d, { extras: [{ id: "xxxxxx1", m: 2, del: 1 }] });
  assert.equal(C.report(gone, key(1), key(31), {}, NOW).total.exAmount, 500);
});

test("CSV and sheet: overtime in the amount, a minimum row, extra rows without times", () => {
  const d = base({ minH: 120, otRate: 7500 }, {
    entries: [ent("eeeeee1", "pppppp1", at(5, 9), at(5, 12)), ent("eeeeee2", "pppppp1", at(6, 9), at(6, 10))],
    extras: [{ id: "xxxxxx1", d: key(5), p: "pppppp1", desc: "=Fuel", amt: 2350, m: 1 }]
  });
  const lines = C.toCsv(d, key(1), key(31), {}, NOW, "en").replace(/^﻿/, "").trim().split("\r\n");
  assert.equal(lines.length, 5);
  assert.equal(lines[1].split(";")[12], "175.00", "2 h × 50 + 1 h overtime × 75");
  assert.match(lines[2], /^2026-10-05;;;;;Acme;Site;Extra charge: =Fuel;;;Yes;;23\.50;No$/);
  assert.equal(lines[3].split(";")[12], "50.00");
  assert.match(lines[4], /^2026-10-06;;;1:00;1\.00;Acme;Site;Minimum charge;;;Yes;50\.00;50\.00;No$/);
  const el = C.toCsv(d, key(1), key(31), {}, NOW, "el");
  assert.match(el, /Ελάχιστη χρέωση/);
  assert.match(el, /Πρόσθετη χρέωση: =Fuel/);
  const sheet = C.toTable(d, key(1), key(31), {}, NOW, "en");
  assert.equal(sheet.length, 5);
  assert.equal(sheet[1][12], 175);
  assert.equal(sheet[2][12], 23.5);
  assert.equal(sheet[2][4], "");
  assert.equal(sheet[4][4], 1);
});

test("quote lines: hours, overtime, minimum and extras as separate lines; client named when unique", () => {
  const d = base({ minH: 120, otRate: 7500 }, {
    entries: [ent("eeeeee1", "pppppp1", at(5, 9), at(5, 12)), ent("eeeeee2", "pppppp1", at(6, 9), at(6, 10))],
    extras: [{ id: "xxxxxx1", d: key(5), p: "pppppp1", desc: "Fuel", amt: 2350, m: 1 }]
  });
  const q = C.quoteLines(d, key(1), key(31), {}, NOW, "en");
  assert.deepEqual(q.items.map((it) => [it.d, it.q, it.p]), [
    ["Site · 1 Oct – 31 Oct 2026", 3, 50],
    ["Site · Overtime · 1 Oct – 31 Oct 2026", 1, 75],
    ["Minimum charge · Acme · 1 Oct – 31 Oct 2026", 1, 50],
    ["Fuel · 5 Oct 2026", 1, 23.5]
  ]);
  assert.equal(q.client, "Acme");
  assert.deepEqual(q.exIds, ["xxxxxx1"]);
  const total = q.items.reduce((s, it) => s + it.q * it.p * 100, 0);
  assert.equal(Math.round(total), C.report(d, key(1), key(31), {}, NOW).total.amount, "the quote adds up to the report");
  const qel = C.quoteLines(d, key(1), key(31), {}, NOW, "el");
  assert.match(qel.items[1].d, /Υπερωρία/);
  assert.match(qel.items[2].d, /^Ελάχιστη χρέωση · Acme/);
  // Without minimums or extras the lines are as before.
  const plain = base(null, { entries: [ent("eeeeee1", "pppppp1", at(5, 9), at(5, 12))] });
  assert.deepEqual(C.quoteLines(plain, key(1), key(31), {}, NOW, "en").items, [{ d: "Site · 1 Oct – 31 Oct 2026", q: 3, p: 50 }]);
});

test(".oroshours file: extras travel (no tombstones), kindOf, and no extras key when none", () => {
  const d = base({ minH: 120 }, {
    entries: [ent("eeeeee1", "pppppp1", at(5, 9), at(5, 12))],
    extras: [{ id: "xxxxxx1", d: key(5), p: "pppppp1", desc: "Fuel", amt: 2350, m: 1 }, { id: "xxxxxx2", m: 3, del: 1 }]
  });
  const s = P.DESC.strip(d);
  assert.deepEqual(s.extras.map((x) => x.id), ["xxxxxx1"]);
  assert.equal(s.clients[0].minH, 120);
  assert.deepEqual(P.DESC.tombIds(d), ["xxxxxx2"]);
  assert.equal(P.kindOf("xxxxxx1", d), "extra");
  assert.ok(!("extras" in P.DESC.strip(base())));
  assert.equal(P.DESC.norm(s).extras.length, 1);
  assert.match(P.DESC.previews(s, "en")["hours.csv"], /Extra charge: Fuel/);
  assert.ok(P.DESC.colls.extras);
});
