// Timesheet through orOS Gate (TS-GATE, 8.26.00): a new project with
// its client, hourly rate, day minimum and overtime (create_items
// timesheet_project); an entry's billed state, the Invoices document
// it went on and the Calendar event it was for (create_items and
// change_item); work past midnight billed on the day it started
// (TS-NIGHT); and app_summary timesheet's month entry by entry and per
// client. The worked example is a sound engineer's month: 20/h, at
// least 200 a day.
// Run: node --test tests/

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const A = require("../assistant/additems.js");
require("../assistant/additems2.js");
const E = require("../assistant/edits.js");
require("../assistant/edits2.js");
const S = require("../assistant/summary.js");
const core = require("../assistant/core.js");
const TS = require("../timesheet/core.js");

const NOW = new Date(2026, 10, 21, 16, 0).getTime();
const T0 = NOW - 30 * 86400000;
const clone = (x) => JSON.parse(JSON.stringify(x));
const J = (x) => JSON.stringify(x);
const lt = (ymd, hm) => { const p = ymd.split("-"); return new Date(+p[0], +p[1] - 1, +p[2], +hm.slice(0, 2), +hm.slice(3)).getTime(); };
function items(app, list) { const n = A.normItems({ app, items: list }); assert.equal(n.ok, true, n.err); return n.items; }
function nerr(app, list) { const n = A.normItems({ app, items: list }); assert.equal(n.ok, false); return n.err; }
function ok(args) { const r = E.normArgs(Object.assign({ ref: "r1" }, args)); assert.equal(r.ok, true, r.err); return r; }

// A project with a day rate of 200 and 20/h (the sound engineer's terms).
function soundData(extra) {
  return TS.normalize(Object.assign({ ver: 1,
    clients: [{ id: "clwave01", name: "Wave", rate: 0, m: T0 }],
    projects: [{ id: "prwave01", name: "Wave", client: "clwave01", color: 0, rate: 2000, bill: 1, arch: 0, minAmt: 20000, minPer: "d", m: T0 },
               { id: "prold001", name: "Old", client: "", color: 1, rate: 0, bill: 1, arch: 1, m: T0 }],
    entries: [] }, extra || {}));
}
const ent = (id, ymd, s, mins, extra) => Object.assign({ id, p: "prwave01", desc: "", s: lt(ymd, s), e: lt(ymd, s) + mins * 60000, billed: 0, m: T0 }, extra || {});

test("TS-NIGHT: 08:00-01:30 is one working day: its overtime, no second day minimum", () => {
  const d = soundData({ entries: [ent("night0001", "2026-11-16", "08:00", 17.5 * 60)] });
  const plan = TS.chargedPieces(d, "2026-11-01", "2026-11-30", {}, NOW);
  assert.equal(plan.pcs.length, 2, "two calendar pieces");
  assert.deepEqual(plan.tops, [], "17.5 h at 20/h is over the 200 minimum: no top-up on 17/11");
  const rep = TS.report(d, "2026-11-01", "2026-11-30", {}, NOW);
  assert.equal(rep.total.amount, 35000);
  // a short day after midnight that started the day before still is that day
  const d2 = soundData({ entries: [ent("night0002", "2026-11-19", "22:00", 3 * 60)] });
  const p2 = TS.chargedPieces(d2, "2026-11-01", "2026-11-30", {}, NOW);
  assert.equal(p2.tops.length, 1, "one minimum, not two");
  assert.equal(p2.tops[0].from, "2026-11-19");
  assert.equal(TS.report(d2, "2026-11-01", "2026-11-30", {}, NOW).total.amount, 20000);
  // hours per calendar day are unchanged
  assert.equal(TS.dayTotals(d, "2026-11-17", "2026-11-17", NOW)["2026-11-17"], 1.5 * 3600000);
});

test("timesheet_project: project with a new client, rate, day minimum, overtime; canonical; look-alike; Undo", () => {
  const d = soundData();
  const it = items("timesheet_project", [
    { name: "Ίβρος", client: "SyncAV", rate: 20, day_minimum: 200 },
    { name: "APG", client: "APG", rate: 20, day_minimum: 200, overtime_after: 10, overtime_rate: 25 },
    { name: "Harmony", client: "syncav", rate: 20 },
    { name: "wave", client: "Wave", rate: 20 }
  ]);
  const p = A.plan("timesheet_project", d, it, {});
  assert.equal(p.ok, true, p.err);
  assert.deepEqual(p.rows[0].fields, [["client", "SyncAV (new)"], ["rate", "20.00/h"], ["day minimum", "200.00"]]);
  assert.deepEqual(p.rows[1].fields.slice(2), [["day minimum", "200.00"], ["overtime after", "10 h at 25.00/h"]]);
  assert.equal(p.rows[3].dup.target.project, "prwave01", "a project with the name starts unticked");
  const r = A.apply("timesheet_project", d, it, NOW, { 3: 1 }, {});
  assert.equal(r.ok, true, r.err);
  assert.equal(r.made.length, 3);
  const live = (l) => l.filter((x) => !x.del);
  const ivros = r.data.projects.find((x) => x.id === r.made[0].id), syncav = r.data.clients.find((c) => c.name === "SyncAV");
  assert.deepEqual([ivros.name, ivros.client, ivros.rate, ivros.minAmt, ivros.minPer, ivros.bill, ivros.arch], ["Ίβρος", syncav.id, 2000, 20000, "d", 1, 0]);
  const apg = r.data.projects.find((x) => x.id === r.made[1].id);
  assert.deepEqual([apg.otH, apg.otRate], [600, 2500]);
  assert.equal(r.data.projects.find((x) => x.id === r.made[2].id).client, syncav.id, "one new client for both spellings");
  assert.equal(live(r.data.clients).length, 3);
  assert.equal(J(TS.normalize(clone(r.data))), J(r.data), "stored = what Timesheet's merge makes of it");
  assert.deepEqual(r.made[0].target, { project: ivros.id });
  // the new project bills like the app: 12 h → 240, 9 h → 200
  r.data.entries.push({ id: "eeee000001", p: ivros.id, desc: "", s: lt("2026-10-30", "07:30"), e: lt("2026-10-30", "19:30"), billed: 0, m: NOW },
                      { id: "eeee000002", p: ivros.id, desc: "", s: lt("2026-11-03", "10:00"), e: lt("2026-11-03", "19:00"), billed: 0, m: NOW });
  assert.equal(TS.report(r.data, "2026-10-01", "2026-11-30", {}, NOW).total.amount, 44000);
  r.data.entries = [];
  // Undo: the new projects and the new client go; refused once one is changed or has time
  const changed = clone(r.data);
  changed.projects.find((x) => x.id === ivros.id).name = "x";
  assert.match(A.undo("timesheet_project", changed, r.undo, NOW + 1).err, /changed since/);
  const used = clone(r.data);
  used.entries.push({ id: "eeee000003", p: ivros.id, desc: "", s: lt("2026-11-03", "10:00"), e: lt("2026-11-03", "11:00"), billed: 0, m: NOW });
  assert.match(A.undo("timesheet_project", TS.normalize(used), r.undo, NOW + 1).err, /already logged/);
  const u = A.undo("timesheet_project", r.data, r.undo, NOW + 1);
  assert.equal(u.ok, true, u.err);
  assert.equal(live(u.data.projects).length, 2);
  assert.equal(live(u.data.clients).length, 1);
  assert.equal(J(TS.normalize(clone(u.data))), J(u.data));
});

test("timesheet_project: refusals", () => {
  assert.match(nerr("timesheet_project", [{ client: "X" }]), /name .* is required/);
  assert.match(nerr("timesheet_project", [{ name: "X", rate: "20" }]), /rate must be an amount/);
  assert.match(nerr("timesheet_project", [{ name: "X", rate: -1 }]), /rate must be an amount/);
  assert.match(nerr("timesheet_project", [{ name: "X", overtime_rate: 25 }]), /needs overtime_after/);
  assert.match(nerr("timesheet_project", [{ name: "X", overtime_after: 30 }]), /at most 24/);
  assert.match(nerr("timesheet_project", [{ name: "X", billable: "no" }]), /billable must be true or false/);
  assert.match(nerr("timesheet_project", [{ name: "X" }, { name: "x" }]), /are the same/);
  assert.match(A.plan("timesheet_project", {}, items("timesheet_project", [{ name: "X" }]), {}).err, /has not been opened/);
});

test("timesheet entry: billed, the invoice it went on and the event it was for (refs resolved by assistant.js)", () => {
  const d = soundData();
  const it = items("timesheet", [
    { title: "Μέγαρο Κοτζιά", date: "2026-10-12", start: "09:00", end: "17:00", project: "Wave", invoice: "r7", event: "r9" },
    { title: "Wyndham", date: "2026-11-16", start: "08:00", minutes: 1050, project: "Wave", billed: false },
    { title: "Royal Olympic", date: "2026-10-15", start: "07:00", end: "19:30", project: "Wave", billed: true }
  ]);
  assert.deepEqual([it[0].invoiceRef, it[0].eventRef, it[0].billed], ["r7", "r9", true], "an invoice makes it billed");
  // what tsRefsOf adds
  Object.assign(it[0], { iv: "mwm9jgd8jq3fz6ivr8", ivTitle: "Recorded invoice ΤΠΥ0149 · WAVE", src: "cal:evwave01:2026-10-12", evTitle: "Wave · 2026-10-12" });
  const p = A.plan("timesheet", d, it, {});
  assert.equal(p.ok, true, p.err);
  assert.deepEqual(p.rows[0].fields.slice(-2), [["billed", "Recorded invoice ΤΠΥ0149 · WAVE"], ["event", "Wave · 2026-10-12"]]);
  const r = A.apply("timesheet", d, it, NOW, {}, {});
  assert.equal(r.ok, true, r.err);
  const x = (i) => r.data.entries.find((e) => e.id === r.made[i].id);
  assert.deepEqual([x(0).billed, x(0).iv, x(0).src], [1, "mwm9jgd8jq3fz6ivr8", "cal:evwave01:2026-10-12"]);
  assert.deepEqual([x(1).billed, "iv" in x(1), x(1).e - x(1).s], [0, false, 1050 * 60000]);
  assert.deepEqual([x(2).billed, "iv" in x(2)], [1, false]);
  assert.equal(J(TS.normalize(clone(r.data))), J(r.data));
  // billed time is no longer to invoice
  const un = TS.unbilled(r.data, "2026-11-21", NOW);
  assert.equal(un.reduce((a, g) => a + g.amount, 0), 35000);
  assert.match(nerr("timesheet", [{ title: "x", date: "2026-10-12", start: "09:00", minutes: 5, invoice: "r1", billed: false }]), /is billed/);
  assert.match(nerr("timesheet", [{ title: "x", date: "2026-10-12", start: "09:00", minutes: 5, billed: "yes" }]), /billed must be true or false/);
});

test("change_item timesheet: project by name, billed, invoice and event; canonical; Undo", () => {
  const d = soundData({ entries: [ent("entry00001", "2026-10-12", "09:00", 8 * 60, { p: "" })] });
  const plan = (args) => E.plan("timesheet", d, { entry: "entry00001" }, ok(Object.assign({ action: "update" }, args)), NOW);
  const run = (args, data) => {
    const ch = ok(Object.assign({ action: "update" }, args));
    const p = E.plan("timesheet", data || d, { entry: "entry00001" }, ch, NOW);
    if (!p.ok) return p;
    const a = E.apply("timesheet", data || d, { entry: "entry00001" }, ch, NOW, p.before);
    assert.equal(a.ok, true, a.err);
    return Object.assign(a, { plan: p });
  };
  const r = run({ project: "wave" });
  assert.deepEqual(r.plan.rows, [{ f: "project", b: "", a: "Wave" }]);
  assert.equal(r.data.entries[0].p, "prwave01");
  assert.equal(J(TS.normalize(clone(r.data))), J(r.data));
  // invoice / event arrive resolved (assistant.js tsChangeRefs)
  const ch = ok({ action: "update", invoice: "r5", event: "r6" });
  assert.deepEqual([ch.set.invoice, ch.set.event], ["r5", "r6"]);
  ch.set.invoice = { id: "mwm9jgd8jq3fz6ivr8", title: "ΤΠΥ0149" };
  ch.set.event = { src: "cal:evwave01:2026-10-12", title: "Wave · 2026-10-12" };
  const p2 = E.plan("timesheet", r.data, { entry: "entry00001" }, ch, NOW + 1);
  assert.equal(p2.ok, true, p2.err);
  assert.deepEqual(p2.rows.map((x) => [x.f, x.a]), [["billed", "yes"], ["invoice", "ΤΠΥ0149"], ["event", "Wave · 2026-10-12"]]);
  const a2 = E.apply("timesheet", r.data, { entry: "entry00001" }, ch, NOW + 1, p2.before);
  assert.equal(a2.ok, true, a2.err);
  const x = a2.data.entries[0];
  assert.deepEqual([x.billed, x.iv, x.src], [1, "mwm9jgd8jq3fz6ivr8", "cal:evwave01:2026-10-12"]);
  // billed false takes the invoice off; "" clears the event
  const r3 = run({ billed: false, event: "" }, a2.data);
  assert.deepEqual([r3.data.entries[0].billed, "iv" in r3.data.entries[0], "src" in r3.data.entries[0]], [0, false, false]);
  assert.match(plan({ project: "Nope" }).err, /no project named "Nope".*Wave/);
  assert.match(plan({ project: "Old" }).err, /archived/);
  assert.match(plan({ invoice: "r5" }).err, /invoice's ref/, "an unresolved ref is refused");
  assert.match(E.normArgs({ ref: "r1", action: "update", billed: "yes" }).err, /billed must be true or false/);
  const u = E.undo("timesheet", a2.data, a2.undo, NOW + 2);
  assert.equal(u.ok, true, u.err);
  assert.equal(u.data.entries[0].iv, undefined);
});

test("app_summary timesheet: the month entry by entry and per client, billed and still to invoice", () => {
  const d = soundData({ entries: [
    ent("e000000001", "2026-11-05", "11:30", 600),
    ent("e000000002", "2026-11-06", "08:00", 780),
    ent("e000000003", "2026-11-08", "11:30", 240),
    ent("e000000004", "2026-11-16", "08:00", 1050),
    ent("e000000005", "2026-11-01", "08:00", 660, { billed: 1, iv: "mwm9jgd8jq3fz6ivr8", src: "cal:ev1:2026-11-01" })
  ] });
  d.projects.find((x) => x.id === "prwave01").otH = 600;      // overtime after 10 h, at the usual rate
  const out = S.timesheetMonth(TS, TS.normalize(d), "2026-11", NOW);
  assert.equal(out.amount, 200 + 260 + 200 + 350 + 220);
  assert.equal(out.overtime_hours, 3 + 7.5 + 1);
  assert.equal(out.day_minimum_amount, 120, "08/11: 4 h = 80 + 120 to the day's 200");
  assert.equal(out.work.length, 5);
  assert.deepEqual(out.work.find((w) => w.date === "2026-11-16"),
    { date: "2026-11-16", start: "08:00", end: "01:30 (+1)", hours: 17.5, overtime_hours: 7.5, project: "Wave", client: "Wave", amount: 350, billed: false });
  assert.deepEqual(out.work.find((w) => w.date === "2026-11-01"),
    { date: "2026-11-01", start: "08:00", end: "19:00", hours: 11, overtime_hours: 1, project: "Wave", client: "Wave", amount: 220, billed: true,
      invoice_id: "mwm9jgd8jq3fz6ivr8", source: "cal:ev1:2026-11-01" });
  assert.deepEqual(out.clients, [{ name: "Wave", days: 5, hours: 55.5, overtime_hours: 11.5, amount: 1230, billed: 220, to_invoice: 1010 }]);
  assert.equal(out.to_invoice.amount, 1010);
});

test("the tools name the new fields (create_items timesheet_project, timesheet billed / invoice / event; change_item)", () => {
  const tool = core.toolsFor({ data: true, changes: true, creates: ["timesheet", "timesheet_project"] });
  const cr = tool.find((t) => t.name === "create_items"), chg = tool.find((t) => t.name === "change_item");
  assert.deepEqual(cr.params.properties.app.enum, ["timesheet", "timesheet_project"]);
  ["name", "client", "rate", "day_minimum", "overtime_after", "overtime_rate", "billable", "billed", "invoice", "event"].forEach((k) => assert.ok(cr.params.properties.items.items.properties[k], k));
  ["project", "billed", "invoice", "event"].forEach((k) => assert.ok(chg.params.properties[k], k));
  assert.deepEqual(core.crUnknown("timesheet_project", [{ name: "x", minutes: 5 }]).bad, ["items[0].minutes"]);
});
