// Timesheet T2 (BR-TS-SRC): an entry can name the To-Do task, Kanban
// card or Calendar occurrence it is for (src); time per source; ended
// Calendar events with no time logged become suggestions; the To-Do,
// Kanban and Calendar sides start or log time only through the shell.
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
const ent = (id, s, e, extra) => Object.assign({ id, p: "", desc: "", s, e, billed: 0, m: s }, extra || {});
const read = (f) => fs.readFileSync(path.join(__dirname, "..", f), "utf8");

function data(entries) { return C.normalize({ ver: 1, clients: [], projects: [], entries: entries || [], extras: [] }); }

test("src: only todo:, kanban: and cal: keys, written only when set", () => {
  assert.ok(C.srcKey("todo:mh2x9abcd"));
  assert.ok(C.srcKey("kanban:abc123"));
  assert.ok(C.srcKey("cal:ev_1:2026-10-20"));
  assert.ok(!C.srcKey("mail:abc"));
  assert.ok(!C.srcKey("todo:"));
  assert.ok(!C.srcKey("todo:a b"));
  assert.ok(!C.srcKey("cal:" + "x".repeat(91)));
  assert.ok(!C.srcKey(5));
  const d = data([ent("eeeeee1", at(20, 9), at(20, 10), { src: "todo:t1abc" }),
                  ent("eeeeee2", at(20, 10), at(20, 11), { src: "bad src" }),
                  ent("eeeeee3", at(20, 11), at(20, 12))]);
  assert.equal(d.entries[0].src, "todo:t1abc");
  assert.ok(!("src" in d.entries[1]) && !("src" in d.entries[2]));
});

test("timeBySrc: per source, a running entry counts up to now, deleted ones do not", () => {
  const d = data([
    ent("eeeeee1", at(20, 9), at(20, 10), { src: "kanban:c1" }),
    ent("eeeeee2", at(20, 11), at(20, 11, 30), { src: "kanban:c1" }),
    ent("eeeeee3", at(20, 17), 0, { src: "kanban:c2" }),
    ent("eeeeee4", at(20, 12), at(20, 13), { src: "todo:t1" }),
    ent("eeeeee5", at(20, 13), at(20, 14), { src: "kanban:c1", del: 1 })
  ]);
  assert.deepEqual(C.timeBySrc(d, "kanban:", NOW), { "kanban:c1": 90 * 60000, "kanban:c2": 60 * 60000 });
  assert.deepEqual(Object.keys(C.timeBySrc(d, "", NOW)).sort(), ["kanban:c1", "kanban:c2", "todo:t1"]);
});

test("calSuggest: ended events with no time logged, the dismissed and covered ones left out", () => {
  const d = data([
    ent("eeeeee1", at(20, 9), at(20, 10), { src: "cal:ev1:2026-10-20" }),   // logged from the event
    ent("eeeeee2", at(20, 11), at(20, 11, 40)),                             // covers 40 of 60 min of ev3
    ent("eeeeee3", at(20, 13), at(20, 13, 20))                              // covers 20 of 60 min of ev4
  ]);
  const evs = [
    { key: "cal:ev5:2026-10-20", title: "Late", s: at(20, 15), e: at(20, 16) },
    { key: "cal:ev1:2026-10-20", title: "Logged", s: at(20, 9), e: at(20, 10) },
    { key: "cal:ev2:2026-10-20", title: "Dismissed", s: at(20, 10), e: at(20, 11) },
    { key: "cal:ev3:2026-10-20", title: "Covered", s: at(20, 11), e: at(20, 12) },
    { key: "cal:ev4:2026-10-20", title: "Partly", s: at(20, 13), e: at(20, 14) },
    { key: "cal:ev6:2026-10-20", title: "Not over", s: at(20, 17), e: at(20, 19) },
    { key: "bad key", title: "Bad", s: at(20, 8), e: at(20, 9) },
    { key: "cal:ev7:2026-10-20", title: "Backwards", s: at(20, 9), e: at(20, 8) }
  ];
  const out = C.calSuggest(d, evs, { "cal:ev2:2026-10-20": 1 }, NOW);
  assert.deepEqual(out.map((v) => v.title), ["Partly", "Late"]);
});

test("To-Do, Kanban and Calendar start or log time only through the shell, and only read Timesheet", () => {
  for (const f of ["todo/todo.js", "kanban/kanban.js"]) {
    const src = read(f);
    assert.match(src, /__orosOpenAt\("timesheet", \{ startTimer: \{ title: title, project: /, f);
    assert.match(src, /src: "(todo|kanban):" \+ /, f);
    assert.match(src, /a\.id === "timesheet"/, f + " shows the button only when Timesheet is installed");
    assert.doesNotMatch(src, /localStorage\.setItem\(TS_KEY/, f + " never writes Timesheet");
  }
  const cal = read("calendar/calendar.js");
  assert.match(cal, /startTimer: \{ title: tr\.title, src: tr\.src \}/);
  assert.match(cal, /logTime: \{ title: tr\.title, s: tr\.log\.s, e: tr\.log\.e, src: tr\.src \}/);
  assert.match(cal, /src: "cal:" \+ existing\.id \+ ":" \+ \(occ \|\| existing\.date\)/);
  const ts = read("timesheet/timesheet.js");
  assert.match(ts, /if \(t\.logTime && typeof t\.logTime === "object"\) \{ logFromTarget\(t\.logTime\); return; \}/);
  assert.match(ts, /if \(C\.srcKey\(src\)\) x\.src = src;/);
  assert.match(ts, /key: "cal:" \+ ev\.id \+ ":" \+ \(inst\.occ \|\| inst\.date\)/, "the same key as Calendar's");
});
