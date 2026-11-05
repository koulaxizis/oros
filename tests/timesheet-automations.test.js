// Timesheet T4: timer events for Automations (BR-EV timesheet.start /
// timesheet.stop), the "Timesheet timer" step (track: start with a
// title, or stop the running timer), the To invoice line in Today and
// in the Assistant's Timesheet summary.
// Run: node --test tests/

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const read = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");
const AC = require("../automations/core.js");
const T = require("../timesheet/core.js");
globalThis.orosTimesheetCore = T;
const TODAY = require("../timesheet/today.js");
const AS = require("../assistant/core.js");
const SUM = require("../assistant/summary.js");
const A = require("../today/agg.js");

const at = (d, h, m) => new Date(2026, 9, d, h, m || 0).getTime();   // October 2026, local

test("events: timesheet.start and timesheet.stop are BR-EV events of Timesheet", () => {
  for (const ev of ["timesheet.start", "timesheet.stop"]) {
    assert.ok(AC.EVENTS.includes(ev), ev);
    assert.equal(AC.EVENT_APP[ev], "timesheet");
    assert.deepEqual(AC.cleanWhen({ t: "event", ev, word: "Acme" }), { t: "event", ev, word: "Acme" });
  }
  // the four A2 events are still first and unchanged
  assert.deepEqual(AC.EVENTS.slice(0, 4), ["todo.done", "habits.done", "water.goal", "fitness.done"]);
  assert.equal(AC.whenText({ t: "event", ev: "timesheet.stop" }, "en"), "When I stop a Timesheet timer");
  assert.equal(AC.whenText({ t: "event", ev: "timesheet.start" }, "el"), "Όταν ξεκινώ χρονόμετρο στο Timesheet");
  // a rule on a stop event matches the signal Timesheet sends
  const rule = AC.cleanRule({ id: "r1", name: "Log", on: true, when: { t: "event", ev: "timesheet.stop", word: "acme" },
    "do": [{ a: "notify", text: "{text}" }], m: 1 });
  const sig = { kind: "event", name: "timesheet.stop", key: "timesheet:eeeeee1:e", text: "Acme site · Pages" };
  assert.ok(AC.matches(rule, sig, at(5, 12)));
  assert.ok(!AC.matches(rule, Object.assign({}, sig, { text: "Other" }), at(5, 12)));
});

test("the track step: start with a title (project a name hint) or stop; opens Timesheet only", () => {
  assert.deepEqual(AC.cleanAction({ a: "track", title: "  Writing\n", project: "Site" }), { a: "track", title: "Writing", project: "Site" });
  assert.deepEqual(AC.cleanAction({ a: "track", title: "Writing" }), { a: "track", title: "Writing" });
  assert.deepEqual(AC.cleanAction({ a: "track", stop: true, title: "dropped" }), { a: "track", stop: true });
  assert.equal(AC.cleanAction({ a: "track" }), null, "a start needs a title");
  assert.equal(AC.cleanAction({ a: "track", stop: 1 }), null, "stop must be true");
  assert.equal(AC.cleanAction({ a: "track", title: "x".repeat(300) }).title.length, 200);
  assert.equal(AC.needs({ a: "track" }), "timesheet");
  assert.ok(AC.ACTIONS.includes("track"));
  assert.deepEqual(AC.call({ a: "track", title: "Review {weekday}", project: "Site" }, at(5, 9), "en", AC.from("en"), ""),
    { fn: "openAt", app: "timesheet", arg: { startTimer: { title: "Review Monday", project: "Site" } } });
  assert.deepEqual(AC.call({ a: "track", stop: true }, at(5, 18), "en", AC.from("en"), ""),
    { fn: "openAt", app: "timesheet", arg: { stopTimer: true } });
  assert.equal(AC.actText({ a: "track", stop: true }, "en"), "Timesheet: stop the timer");
  assert.equal(AC.actText({ a: "track", title: "Site" }, "el"), "Timesheet: έναρξη «Site»");
  assert.ok(!AC.runnable({ "do": [{ a: "track", stop: true }] }, ["automations"]), "needs Timesheet installed");
});

test("Timesheet emits the events and takes stopTimer / tab targets", () => {
  const s = read("timesheet/timesheet.js");
  assert.match(s, /orosEvent\("timesheet\.start", "timesheet:" \+ id \+ ":s", evText\(x\)\)/);
  assert.match(s, /orosEvent\("timesheet\.stop", "timesheet:" \+ x\.id \+ ":e", evText\(x\)\)/);
  assert.match(s, /w\.orosEvents\.emit\(name, key, text\)/);
  assert.match(s, /if \(t\.stopTimer === true\) \{ stopFromTarget\(\); return; \}/);
  assert.match(s, /if \(t\.tab === "bill"\) \{ setTab\("bill"\); return; \}/);
  const i = s.indexOf("function stopFromTarget"), body = s.slice(i, s.indexOf("function startFromTarget", i));
  assert.doesNotMatch(body, /startTimer\(/, "stopping never starts anything");
  assert.match(body, /showToast\(t\("toast\.noneRunning"\)\); return;/);
  for (const k of ['"toast.noneRunning": "No timer is running."', '"toast.noneRunning": "Δεν μετράει κανένα χρονόμετρο."']) assert.ok(s.includes(k), k);
  assert.match(read("i18n/de/timesheet.js"), /"toast\.noneRunning"/);
  // the editor offers the step, EN/EL/DE
  const app = read("automations/app.js");
  assert.match(app, /a\.a === "track"/);
  assert.ok(app.includes('"a.track": "Timesheet timer"') && app.includes('"a.track": "Χρονόμετρο Timesheet"'));
  assert.match(read("i18n/de/automations.js"), /"a\.track"[\s\S]*"act\.trackStop"[\s\S]*"ev\.timesheet\.stop"/);
});

function store(rate) {
  return JSON.stringify(T.normalize({ ver: 1,
    clients: [{ id: "cccccc1", name: "Acme", rate: rate, m: 1 }, { id: "cccccc2", name: "Beta", rate: rate, m: 1 }],
    projects: [{ id: "pppppp1", name: "Site", client: "cccccc1", m: 1 }, { id: "pppppp2", name: "App", client: "cccccc2", m: 1 }],
    entries: [{ id: "eeeeee1", p: "pppppp1", desc: "", s: at(5, 9), e: at(5, 11), billed: 0, m: 1 },
              { id: "eeeeee2", p: "pppppp2", desc: "", s: at(6, 9), e: at(6, 10), billed: 0, m: 1 },
              { id: "eeeeee3", p: "pppppp1", desc: "", s: at(7, 9), e: at(7, 12), billed: 1, m: 1 }],
    prefs: { cur: "EUR", rate: 0, goal: 0, round: 0, rup: 1 } }));
}
function ctx(raw, lang) {
  return { today: "2026-10-11", horizon: 3, now: at(11, 9), lang: lang || "en",
           readRaw: (k) => (k === T.STORAGE_KEY ? raw : null), readJSON: () => null, addDays: A.addDays, diff: A.diff };
}

test("Today: one To invoice line with hours, amount and clients, opening that tab; none without an amount", () => {
  const rows = TODAY.collect(ctx(store(5000)));
  const bill = rows.find((r) => r.id === "bill");
  assert.ok(bill, JSON.stringify(rows));
  assert.equal(bill.kind, "info");
  assert.deepEqual(bill.target, { tab: "bill" });
  assert.match(bill.title, /^To invoice: 3:00 h? ?· /);
  assert.match(bill.title, /150/);
  assert.equal(bill.text, "2 clients");
  assert.equal(TODAY.collect(ctx(store(5000), "el")).find((r) => r.id === "bill").text, "2 πελάτες");
  assert.ok(!TODAY.collect(ctx(store(0))).some((r) => r.id === "bill"), "time without rates is not to invoice");
});

test("Assistant: the Timesheet summary carries to_invoice; propose_rule writes track steps and timer events", () => {
  const s = SUM.timesheetMonth(T, T.parse(store(5000)), "2026-10", at(11, 9));
  assert.deepEqual(s.to_invoice, { hours: 3, amount: 150, clients: 2, since: "2026-10-05" });
  assert.ok(!("to_invoice" in SUM.timesheetMonth(T, T.parse(store(0)), "2026-10", at(11, 9))) ||
            SUM.timesheetMonth(T, T.parse(store(0)), "2026-10", at(11, 9)).to_invoice.amount === 0);
  const all = () => true;
  const r = AS.normRule({ name: "Stop at six", when: { type: "day", at: "18:00", weekdays: [1, 2, 3, 4, 5] },
    steps: [{ do: "track", stop: true }] }, all);
  assert.ok(r.ok, r.err);
  assert.deepEqual(r.rule["do"], [{ a: "track", stop: true }]);
  const g = AS.normRule({ when: { type: "event", event: "timesheet.stop" }, steps: [{ do: "track", title: "Admin", project: "Office" }] }, all);
  assert.ok(g.ok, g.err);
  assert.deepEqual(g.rule["do"], [{ a: "track", title: "Admin", project: "Office" }]);
  assert.match(AS.normRule({ when: { type: "open" }, steps: [{ do: "track" }] }, all).err, /step 1/);
  assert.match(AS.normRule({ when: { type: "open" }, steps: [{ do: "track", stop: true }] }, (a) => a !== "timesheet").err, /timesheet/);
});
