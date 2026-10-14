// Timesheet wave 46: time away (timesheet/core.js idle*), the shell's
// timer menu and idle watcher, and the app's banner wiring.
// Run: node --test tests/

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const C = require("../timesheet/core.js");

const T0 = Date.UTC(2026, 9, 14, 8, 0);
const MIN = 60000;
function model(entries) {
  return C.normalize({ ver: 1, clients: [], projects: [{ id: "proj01", name: "Site", client: "", color: 0, rate: 0, bill: 1, arch: 0, m: 1 }], entries, prefs: {}, pm: 0 });
}
let n = 0;
const ids = () => "newid" + (++n);

test("prefs: off by default, minutes clamped", () => {
  assert.deepEqual(C.idlePrefs(null), { on: 0, min: 10 });
  assert.deepEqual(C.idlePrefs('{"on":1,"min":15}'), { on: 1, min: 15 });
  assert.deepEqual(C.idlePrefs({ on: true, min: 2 }), { on: 1, min: 10 });
  assert.deepEqual(C.idlePrefs("junk"), { on: 0, min: 10 });
});

test("records: never before the entry, never under the minimum, joined when they touch", () => {
  const run = { id: "entry01", s: T0 };
  assert.equal(C.idleRecord(run, T0 + 5 * MIN, T0 + 9 * MIN, 10 * MIN), null);
  assert.deepEqual(C.idleRecord(run, T0 - 30 * MIN, T0 + 15 * MIN, 10 * MIN), { id: "entry01", from: T0, to: T0 + 15 * MIN });
  assert.equal(C.idleRecord(null, T0, T0 + HOURS(1), 0), null);
  let list = C.idlePut([], { id: "entry01", from: T0 + 10 * MIN, to: T0 + 30 * MIN });
  list = C.idlePut(list, { id: "entry01", from: T0 + 30 * MIN, to: T0 + 50 * MIN });
  assert.deepEqual(list, [{ id: "entry01", from: T0 + 10 * MIN, to: T0 + 50 * MIN }]);
  list = C.idlePut(list, { id: "entry02", from: T0, to: T0 + 20 * MIN });
  assert.equal(list.length, 2);
  assert.deepEqual(C.idleDrop(list, list[0]).length, 1);
  assert.deepEqual(C.idleRead("[{\"id\":\"BAD\",\"from\":1,\"to\":2},{\"id\":\"entry01\",\"from\":" + T0 + ",\"to\":" + (T0 - 1) + "}]"), []);
  assert.deepEqual(C.idleRead(JSON.stringify(list)), list);
});
function HOURS(h) { return h * 3600000; }

test("pending: only periods their entry still covers", () => {
  const d = model([
    { id: "entry01", p: "proj01", desc: "Build", s: T0, e: 0, billed: 0, m: 1 },
    { id: "entry02", p: "proj01", desc: "Old", s: T0 - HOURS(3), e: T0 - HOURS(2), billed: 0, m: 1 }
  ]);
  const list = [
    { id: "entry01", from: T0 + 10 * MIN, to: T0 + 40 * MIN },
    { id: "entry02", from: T0 - HOURS(2.5), to: T0 - HOURS(1.5) },   // runs past the entry's end
    { id: "gone01", from: T0, to: T0 + 20 * MIN }
  ];
  assert.deepEqual(C.idlePending(d, list), [list[0]]);
});

test("take it out of a running timer: it ends at the start of the time away and goes on from its end", () => {
  const d = model([{ id: "entry01", p: "proj01", desc: "Build", s: T0, e: 0, billed: 0, m: 1, task: "Design", tags: ["web"] }]);
  const rec = { id: "entry01", from: T0 + HOURS(1), to: T0 + HOURS(1.5) };
  const add = C.idleApply(d, rec, "discard", T0 + HOURS(2), ids);
  const out = C.mergeTimesheet(d, add);
  const a = out.entries.find((x) => x.id === "entry01");
  const b = out.entries.find((x) => x.id !== "entry01");
  assert.equal(a.e, T0 + HOURS(1));
  assert.ok(a.m > 1);
  assert.equal(b.s, T0 + HOURS(1.5));
  assert.equal(b.e, 0, "still running");
  assert.equal(b.p, "proj01");
  assert.equal(b.desc, "Build");
  assert.equal(b.task, "Design");
  assert.deepEqual(b.tags, ["web"]);
  assert.equal(C.running(out).length, 1);
});

test("take out and stop; a stopped entry keeps its own end; keep changes nothing", () => {
  const d = model([{ id: "entry01", p: "proj01", desc: "", s: T0, e: 0, billed: 0, m: 1 }]);
  const rec = { id: "entry01", from: T0 + HOURS(1), to: T0 + HOURS(2) };
  const out = C.mergeTimesheet(d, C.idleApply(d, rec, "stop", T0 + HOURS(2), ids));
  assert.equal(out.entries.length, 1);
  assert.equal(out.entries[0].e, T0 + HOURS(1));
  assert.equal(C.running(out).length, 0);
  assert.equal(C.idleApply(d, rec, "keep", T0, ids), null);
  // an entry that already ended after the time away: split in two
  const e2 = model([{ id: "entry02", p: "", desc: "x", s: T0, e: T0 + HOURS(3), billed: 1, m: 1 }]);
  const o2 = C.mergeTimesheet(e2, C.idleApply(e2, { id: "entry02", from: T0 + HOURS(1), to: T0 + HOURS(2) }, "discard", T0 + HOURS(4), ids));
  const ends = o2.entries.map((x) => [x.s - T0, x.e - T0, x.billed]).sort((x, y) => x[0] - y[0]);
  assert.deepEqual(ends, [[0, HOURS(1), 1], [HOURS(2), HOURS(3), 1]]);
  // stop on a stopped entry: nothing
  assert.equal(C.idleApply(e2, { id: "entry02", from: T0 + HOURS(1), to: T0 + HOURS(2) }, "stop", T0, ids), null);
  // a period the entry no longer covers: nothing
  assert.equal(C.idleApply(e2, { id: "entry02", from: T0 + HOURS(2), to: T0 + HOURS(5) }, "discard", T0, ids), null);
});

test("wiring: the shell's timer menu and idle watcher, the app's banner and receivers", () => {
  const shell = fs.readFileSync(path.join(__dirname, "../shell.js"), "utf8");
  assert.ok(shell.indexOf("tsTrayTogglePop();            // Wave 46") > 0);
  assert.ok(/new window\.IdleDetector\(\)/.test(shell));
  assert.ok(/permissions\.query\(\{ name: "idle-detection" \}\)/.test(shell));
  assert.ok(shell.indexOf('"stop:" + run.id') > 0);
  const css = fs.readFileSync(path.join(__dirname, "../style.css"), "utf8");
  assert.ok(css.indexOf("#ts-tray-pop {") > 0);
  const html = fs.readFileSync(path.join(__dirname, "../timesheet/index.html"), "utf8");
  ["idle", "idle-text", "idle-keep", "idle-discard", "idle-stop"].forEach((id) => assert.ok(html.indexOf('id="' + id + '"') > 0, id));
  const js = fs.readFileSync(path.join(__dirname, "../timesheet/timesheet.js"), "utf8");
  assert.ok(js.indexOf("window.__orosTimesheetStop = function") > 0);
  assert.ok(js.indexOf("window.__orosTimesheetIdle = function") > 0);
  assert.ok(js.indexOf("IdleDetector.requestPermission()") > 0);
});
