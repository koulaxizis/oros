// Timesheet: the shared core (timesheet/core.js) — normalize, the
// sync merge (slice "timesheet"), day pieces across midnight and DST,
// rounding, the week grid, reports, parsing, CSV, backup — plus a
// two-device round trip through the real sync engine (tests/harness.js).
// Run: node --test tests/
//
// Every date here is built in LOCAL time (new Date(y, m, d, h, min)):
// the app derives an entry's day(s) from its timestamps the same way.

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const C = require("../timesheet/core.js");
const { FakeDropbox, createDevice, readKey, writeKey } = require("./harness");

const at = (d, h, m) => new Date(2026, 9, d, h, m || 0).getTime();   // October 2026
const key = (d) => "2026-10-" + String(d).padStart(2, "0");
const ent = (id, s, e, extra) => Object.assign({ id, p: "", desc: "", s, e, billed: 0, m: s }, extra || {});
const json = (x) => JSON.stringify(x);
function model(o) {
  return C.normalize(Object.assign({ ver: 1, clients: [], projects: [], entries: [] }, o || {}));
}
const H = C.HOUR;

// ---------------------------------------------------------------
// Normalize
// ---------------------------------------------------------------

test("normalize: bad rows dropped, rows sorted by id, text cleaned, defaults filled", () => {
  const d = C.normalize({
    clients: [{ id: "cccccc1", name: "  Acme \n SA ", rate: 5000, m: 1 }, { id: "cccccc2", name: "", m: 1 }],
    projects: [
      { id: "pppppp2", name: "Site", client: "cccccc1", color: 9, rate: -1, m: 1 },
      { id: "pppppp1", name: "App", client: "bad id!", bill: 0, arch: 1, m: 1 }
    ],
    entries: [
      ent("zzzzzz1", at(1, 9), at(1, 10)),
      ent("aaaaaa1", at(1, 8), 0),                           // running
      ent("bbbbbb1", at(1, 9), at(1, 9)),                    // zero length
      ent("bbbbbb2", at(1, 9), at(1, 8)),                    // ends before start
      ent("bbbbbb3", 5, at(1, 8)),                           // start out of range
      ent("bbbbbb4", at(1, 9), at(1, 9) + 400 * C.DAY),      // beyond the sanity span
      { id: "dddddd1", m: 7, del: 1, s: 1, e: 5 }            // tombstone keeps id + m only
    ],
    prefs: { cur: "XXX", rate: 4000.5, goal: 480, round: 7, rup: 0 }
  });
  assert.deepEqual(d.clients, [{ id: "cccccc1", name: "Acme SA", rate: 5000, m: 1 }]);
  assert.deepEqual(d.projects.map((p) => p.id), ["pppppp1", "pppppp2"]);
  assert.deepEqual(d.projects[0], { id: "pppppp1", name: "App", client: "", color: 0, rate: 0, bill: 0, arch: 1, m: 1 });
  assert.equal(d.projects[1].color, 0);
  assert.equal(d.projects[1].rate, 0);
  assert.equal(d.projects[1].bill, 1);
  assert.deepEqual(d.entries.map((x) => x.id), ["aaaaaa1", "dddddd1", "zzzzzz1"]);
  assert.deepEqual(d.entries[1], { id: "dddddd1", m: 7, del: 1 });
  assert.deepEqual(d.prefs, { cur: "EUR", rate: 0, goal: 480, round: 0, rup: 0 });
});

test("normalize is idempotent and canonical (R26)", () => {
  const raw = {
    clients: [{ id: "cccccc1", name: "B", m: 3 }],
    projects: [{ id: "pppppp1", name: "X", client: "cccccc1", m: 2 }],
    entries: [ent("bbbbbb1", at(2, 9), at(2, 11)), ent("aaaaaa1", at(2, 7), at(2, 8))],
    prefs: { round: 15 }, pm: 5
  };
  const once = C.normalize(raw);
  assert.equal(json(C.normalize(once)), json(once));
  assert.equal(json(C.mergeTimesheet(once, once)), json(once));
});

test("parse: empty → empty model, garbage → null (rescue), valid → normalized", () => {
  assert.equal(json(C.parse(null)), json(C.empty()));
  assert.equal(C.parse("{oops"), null);
  assert.equal(C.parse(JSON.stringify({ entries: [] })), null, "a model without its lists is not ours");
  const d = C.parse(JSON.stringify(model({ entries: [ent("aaaaaa1", at(1, 9), at(1, 10))] })));
  assert.equal(d.entries.length, 1);
});

// ---------------------------------------------------------------
// Merge
// ---------------------------------------------------------------

test("merge: symmetric, newer edit wins, tombstone wins ties, newer edit resurrects", () => {
  const a = model({ entries: [
    ent("aaaaaa1", at(3, 9), at(3, 10), { desc: "old", m: 10 }),
    ent("bbbbbb1", at(3, 9), at(3, 10), { m: 10 }),
    { id: "cccccc1", m: 20, del: 1 }
  ] });
  const b = model({ entries: [
    ent("aaaaaa1", at(3, 9), at(3, 11), { desc: "new", m: 11 }),
    { id: "bbbbbb1", m: 10, del: 1 },
    ent("cccccc1", at(3, 12), at(3, 13), { m: 21 })
  ] });
  const ab = C.mergeTimesheet(a, b), ba = C.mergeTimesheet(b, a);
  assert.equal(json(ab), json(ba));
  assert.equal(ab.entries[0].desc, "new");
  assert.equal(ab.entries[1].del, 1, "delete wins a tie");
  assert.equal(ab.entries[2].del, undefined, "a newer edit resurrects");
  assert.equal(json(C.mergeTimesheet(ab, ab)), json(ab));
});

test("merge: prefs travel as one record, newer pm wins, equal pm is symmetric", () => {
  const a = model({ prefs: { round: 15, cur: "EUR" }, pm: 5 });
  const b = model({ prefs: { round: 30, cur: "USD" }, pm: 9 });
  assert.equal(C.mergeTimesheet(a, b).prefs.cur, "USD");
  assert.equal(C.mergeTimesheet(b, a).prefs.round, 30);
  const c = model({ prefs: { round: 6 }, pm: 9 });
  assert.equal(json(C.mergeTimesheet(b, c)), json(C.mergeTimesheet(c, b)));
});

test("merge: two devices each start a timer offline, both survive; a stop is an edit", () => {
  const a = model({ entries: [ent("aaaaaa1", at(4, 9), 0)] });
  const b = model({ entries: [ent("bbbbbb1", at(4, 9, 5), 0)] });
  const m = C.mergeTimesheet(a, b);
  assert.equal(C.running(m).length, 2);
  const stopped = model({ entries: [ent("aaaaaa1", at(4, 9), at(4, 12), { m: at(4, 12) })] });
  const m2 = C.mergeTimesheet(m, stopped);
  assert.deepEqual(C.running(m2).map((x) => x.id), ["bbbbbb1"]);
});

// ---------------------------------------------------------------
// Rates + lookups
// ---------------------------------------------------------------

test("rates: project → client → default; deleted project falls to default", () => {
  const d = model({
    clients: [{ id: "cccccc1", name: "C", rate: 3000, m: 1 }],
    projects: [
      { id: "pppppp1", name: "Own", client: "cccccc1", rate: 5000, m: 1 },
      { id: "pppppp2", name: "Inherit", client: "cccccc1", m: 1 },
      { id: "pppppp3", name: "Free", m: 1 },
      { id: "pppppp4", m: 2, del: 1 }
    ],
    prefs: { rate: 1000 }
  });
  assert.equal(C.rateOf(d, "pppppp1"), 5000);
  assert.equal(C.rateOf(d, "pppppp2"), 3000);
  assert.equal(C.rateOf(d, "pppppp3"), 1000);
  assert.equal(C.rateOf(d, "pppppp4"), 1000);
  assert.equal(C.rateOf(d, ""), 1000);
});

// ---------------------------------------------------------------
// Time maths
// ---------------------------------------------------------------

test("pieces: an entry across midnight counts on both days", () => {
  const p = C.pieces(at(5, 22), at(6, 2, 30));
  assert.deepEqual(p.map((x) => x.k), [key(5), key(6)]);
  assert.equal(p[0].e - p[0].s, 2 * H);
  assert.equal(p[1].e - p[1].s, 2.5 * H);
  const d = model({ entries: [ent("aaaaaa1", at(5, 22), at(6, 2, 30))] });
  const t = C.dayTotals(d, key(5), key(6), at(9, 0));
  assert.equal(t[key(5)], 2 * H);
  assert.equal(t[key(6)], 2.5 * H);
  assert.equal(C.dayEntries(d, key(6), at(9, 0)).length, 1);
});

test("pieces: a day with a DST change still splits at local midnight", () => {
  // 25 October 2026: Europe leaves summer time (the day has 25 hours
  // there); in any zone the pieces must end on local midnights.
  const s = new Date(2026, 9, 24, 20).getTime(), e = new Date(2026, 9, 26, 4).getTime();
  const p = C.pieces(s, e);
  assert.deepEqual(p.map((x) => x.k), ["2026-10-24", "2026-10-25", "2026-10-26"]);
  assert.equal(p[1].s, new Date(2026, 9, 25).getTime());
  assert.equal(p[1].e, new Date(2026, 9, 26).getTime());
  assert.equal(p.reduce((n, x) => n + x.e - x.s, 0), e - s);
});

test("running entries count up to now", () => {
  const d = model({ entries: [ent("aaaaaa1", at(7, 9), 0)] });
  assert.equal(C.dayTotals(d, key(7), key(7), at(7, 10, 30))[key(7)], 1.5 * H);
});

test("rounding: off, up and nearest, per piece; stored data untouched", () => {
  assert.equal(C.roundMs(7 * 60000, 0, 1), 7 * 60000);
  assert.equal(C.roundMs(7 * 60000, 15, 1), 15 * 60000);
  assert.equal(C.roundMs(7 * 60000, 15, 0), 0);
  assert.equal(C.roundMs(8 * 60000, 15, 0), 15 * 60000);
  assert.equal(C.roundMs(61 * 60000, 6, 1), 66 * 60000);
});

test("week grid: rows per project, a no-project row, column totals", () => {
  const d = model({
    projects: [{ id: "pppppp1", name: "A", m: 1 }],
    entries: [
      ent("aaaaaa1", at(5, 9), at(5, 11), { p: "pppppp1" }),   // Monday 5 Oct
      ent("aaaaaa2", at(11, 9), at(11, 10)),                  // Sunday 11 Oct, no project
      ent("aaaaaa3", at(12, 9), at(12, 10), { p: "pppppp1" }) // next week
    ]
  });
  assert.equal(C.weekStart(key(8)), key(5));
  const g = C.weekGrid(d, key(5), at(20, 0));
  assert.equal(g.total, 3 * H);
  assert.deepEqual(g.rows.map((r) => r.p), ["pppppp1", ""]);
  assert.equal(g.rows[0].days[0], 2 * H);
  assert.equal(g.cols[6], H);
});

test("report: groups add up alike, filters, rates and amounts", () => {
  const d = model({
    clients: [{ id: "cccccc1", name: "Acme", rate: 6000, m: 1 }],
    projects: [
      { id: "pppppp1", name: "Web", client: "cccccc1", m: 1 },
      { id: "pppppp2", name: "Admin", client: "cccccc1", bill: 0, m: 1 }
    ],
    entries: [
      ent("aaaaaa1", at(5, 9), at(5, 10, 7), { p: "pppppp1" }),
      ent("aaaaaa2", at(5, 23), at(6, 1), { p: "pppppp1", billed: 1 }),
      ent("aaaaaa3", at(6, 9), at(6, 10), { p: "pppppp2" }),
      ent("aaaaaa4", at(9, 9), at(9, 10), { p: "pppppp1" })    // outside the range
    ],
    prefs: { round: 15, rup: 1 }
  });
  const now = at(20, 0);
  const byP = C.report(d, key(5), key(6), { group: "project" }, now);
  const byC = C.report(d, key(5), key(6), { group: "client" }, now);
  const byD = C.report(d, key(5), key(6), { group: "day" }, now);
  // 1:07 → 1:15, 1:00 + 1:00 (two pieces), 1:00
  assert.equal(byP.total.ms, (75 + 60 + 60 + 60) * 60000);
  assert.equal(byC.total.ms, byP.total.ms);
  assert.equal(byD.total.ms, byP.total.ms);
  assert.deepEqual(byD.rows.map((r) => r.key), [key(5), key(6)]);
  assert.equal(byP.total.billMs, (75 + 120) * 60000);
  assert.equal(byP.total.amount, Math.round(195 * 60000 * 6000 / H));   // 195,00 €
  assert.deepEqual(byP.ids, ["aaaaaa1", "aaaaaa2", "aaaaaa3"]);
  assert.equal(C.report(d, key(5), key(6), { bill: "non" }, now).total.ms, 60 * 60000);
  assert.deepEqual(C.report(d, key(5), key(6), { billed: "open", bill: "bill" }, now).ids, ["aaaaaa1"]);
  assert.equal(C.report(d, key(5), key(6), { project: "-" }, now).total.n, 0);
});

// ---------------------------------------------------------------
// Parsing + formatting
// ---------------------------------------------------------------

test("parseDuration: the forms people type", () => {
  const cases = { "2:30": 150, "1,5": 90, "1.5": 90, "90m": 90, "90 λ": 90, "2h 30m": 150,
    "2h30": 150, "2ω 30λ": 150, "8": 480, "45": 45, "0:45": 45, "30 λεπτά": 30, "2 ώρες": 120 };
  Object.keys(cases).forEach((k) => assert.equal(C.parseDuration(k), cases[k], k));
  ["", "abc", "2:75", "-1"].forEach((k) => assert.ok(isNaN(C.parseDuration(k)), k));
});

test("parseMoney: comma or dot decimals, thousands separators", () => {
  assert.equal(C.parseMoney("45"), 4500);
  assert.equal(C.parseMoney("45,5"), 4550);
  assert.equal(C.parseMoney("1.250,00"), 125000);
  assert.equal(C.parseMoney("1,250.00"), 125000);
  assert.equal(C.parseMoney("€ 30"), 3000);
  assert.equal(C.parseMoney(""), 0);
  assert.ok(isNaN(C.parseMoney("abc")));
  assert.equal(C.moneyInput(4550, "el"), "45,50");
  assert.equal(C.moneyInput(4500, "en"), "45");
});

test("fmtDur", () => {
  assert.equal(C.fmtDur(0), "0:00");
  assert.equal(C.fmtDur(3725000), "1:02");
  assert.equal(C.fmtDur(3725000, true), "1:02:05");
});

// ---------------------------------------------------------------
// Export
// ---------------------------------------------------------------

test("CSV: BOM, ; separated, formula cells defused, quotes escaped", () => {
  const d = model({
    projects: [{ id: "pppppp1", name: "=HYPERLINK(\"x\")", m: 1 }],
    entries: [ent("aaaaaa1", at(5, 9), at(5, 10, 30), { p: "pppppp1", desc: "a;b \"c\"" })],
    prefs: { rate: 4000 }
  });
  const csv = C.toCsv(d, key(5), key(5), {}, at(9, 0), "en");
  assert.ok(csv.startsWith("﻿Date;Start;End;"));
  const row = csv.split("\r\n")[1];
  assert.ok(row.includes("'=HYPERLINK"), "formula defused");
  assert.ok(row.includes("\"a;b \"\"c\"\"\""), "quoted + escaped");
  assert.ok(row.includes(";1.50;"), "hours");
  assert.ok(row.endsWith(";60.00;No"), "amount + billed");
  const el = C.toCsv(d, key(5), key(5), {}, at(9, 0), "el");
  assert.ok(el.includes("05/10/2026;09:00;10:30;1:30;1,50;"), "Greek date + decimal comma");
  assert.equal(C.csvCell("-5"), "'-5");
});

test("backup: round trip keeps tombstones; foreign files refused", () => {
  const d = model({ entries: [ent("aaaaaa1", at(5, 9), at(5, 10)), { id: "bbbbbb1", m: 3, del: 1 }] });
  const back = C.fromBackup(C.toBackup(d));
  assert.equal(json(back), json(d));
  assert.equal(C.fromBackup("{}"), null);
  assert.equal(C.fromBackup(JSON.stringify({ app: "water", data: d })), null);
  assert.equal(C.fromBackup("not json"), null);
});

// ---------------------------------------------------------------
// Sync: two devices through the real engine
// ---------------------------------------------------------------

test("sync: offline edits on two devices converge, then nothing re-uploads", async () => {
  const db = new FakeDropbox();
  const A = await createDevice(db, "A");
  const B = await createDevice(db, "B");
  const reg = (dev) => dev.sync.registerSlice("timesheet",
    () => C.normalize(readKey(dev, C.STORAGE_KEY)),
    (data) => writeKey(dev, C.STORAGE_KEY, C.mergeTimesheet(readKey(dev, C.STORAGE_KEY), data)),
    C.STORAGE_KEY, C.mergeTimesheet);
  reg(A); reg(B);

  writeKey(A, C.STORAGE_KEY, model({
    projects: [{ id: "pppppp1", name: "Web", m: 1 }],
    entries: [ent("base001", at(3, 8), 0, { p: "pppppp1" })]
  }));
  A.sync.markDirty();
  await A.sync.push();
  await B.sync.pull();

  const edit = (dev, fn) => {
    const cur = readKey(dev, C.STORAGE_KEY);
    fn(cur);
    writeKey(dev, C.STORAGE_KEY, C.normalize(cur));
    dev.sync.markDirty();
  };
  edit(A, (d) => d.entries.push(ent("aaaaaa1", at(3, 10), at(3, 11))));
  edit(B, (d) => {                       // B stops the running timer
    const x = d.entries.find((e) => e.id === "base001");
    x.e = at(3, 9, 30); x.m = at(3, 9, 30);
  });
  await A.sync.push();
  await B.sync.push();          // stale: refused, merged, retried
  await A.sync.pull();

  const a = readKey(A, C.STORAGE_KEY), b = readKey(B, C.STORAGE_KEY);
  assert.equal(json(a), json(b));
  assert.equal(C.running(a).length, 0);
  assert.equal(C.dayTotals(a, key(3), key(3), at(9, 0))[key(3)], 2.5 * H);

  assert.equal(A.sync.isDirty(), false, "A: nothing left to push once converged");
  assert.equal(B.sync.isDirty(), false, "B: nothing left to push once converged");
  await B.sync.pull();
  assert.equal(B.sync.isDirty(), false, "a pull of the same state marks nothing dirty");
});
