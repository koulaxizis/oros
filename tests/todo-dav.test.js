// CalDAV wave 5: todo/vtodo.js (the VTODO reader) and todo/dav.js (the
// mapper between one server task and a To-Do task or subtask: DAV-4
// lossless patch per property group, read-only detection, DAV-6 read
// back, subtasks as RELATED-TO children).
// Run: node --test tests/
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const V = require("../todo/vtodo.js");
const TD = require("../todo/dav.js");

const COL = "https://dav.test/dav/calendars/u/tasks/";
let clock = Date.UTC(2026, 10, 1, 9, 0);
const M = TD.mapper(COL, { now: () => clock });

function task(extra) {
  return Object.assign({ id: "t1", text: "Pay the rent; then call, Anna", notes: "Line one\nline two", due: "2026-11-05",
                         prio: 1, done: false, rec: { every: 1, unit: "month" }, cats: ["Home", "Money"], sub: false,
                         mtime: 5 }, extra || {});
}
const todo = (lines) => ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Other//EN", "BEGIN:VTODO"]
  .concat(lines, ["END:VTODO", "END:VCALENDAR", ""]).join("\r\n");

test("a task is written as its own VTODO and reads back as the same task", () => {
  const text = M.write(task(), null);
  assert.ok(text, "written");
  assert.match(text, /\r\nUID:t1@oros\.todo\r\n/);
  for (const l of ["SUMMARY:Pay the rent\\; then call\\, Anna", "DUE;VALUE=DATE:20261105", "PRIORITY:1",
                   "STATUS:NEEDS-ACTION", "RRULE:FREQ=MONTHLY", "CATEGORIES:Home,Money", "DESCRIPTION:Line one\\nline two"]) {
    assert.ok(text.includes(l), l);
  }
  const r = M.read(text);
  assert.equal(r.ro, false);
  assert.equal(M.hash(r.main), M.hash(task()));
  assert.equal(M.idFor(r.uid, "x").own, "t1");
  assert.equal(TD.uidOf(text), "t1@oros.todo");
  for (const line of text.split("\r\n")) assert.ok(Buffer.byteLength(line, "utf8") <= 75, line);
  // Repeat after completion: kept as X-OROS-AFTER-DONE.
  const a = M.write(task({ rec: { every: 2, unit: "week", weekday: 1, after: true } }), null);
  assert.ok(a.includes("RRULE:FREQ=WEEKLY;INTERVAL=2;BYDAY=MO") && a.includes("X-OROS-AFTER-DONE:TRUE"));
  assert.deepEqual(M.read(a).main.rec, { every: 2, unit: "week", weekday: 1, after: true });
});

test("the reader: priorities, done forms, date-times, repeats it can and cannot keep", () => {
  const rd = (lines) => V.read(todo(["UID:x", "SUMMARY:A"].concat(lines)));
  assert.deepEqual([3, 5, 7, 0].map((n) => rd(["PRIORITY:" + n]).prio), [1, 2, 3, 4]);
  assert.equal(rd(["STATUS:COMPLETED"]).done, true);
  assert.equal(rd(["COMPLETED:20261101T090000Z"]).done, true);
  assert.equal(rd(["PERCENT-COMPLETE:100"]).done, true);
  assert.equal(rd(["STATUS:IN-PROCESS", "PERCENT-COMPLETE:40"]).done, false);
  const c = rd(["STATUS:CANCELLED"]);
  assert.deepEqual([c.done, c.cut], [true, true]);
  assert.equal(rd(["DUE;TZID=Europe/Athens:20261105T170000"]).due, "2026-11-05");
  assert.equal(rd(["DUE:20261105"]).due, "2026-11-05");
  assert.deepEqual(rd(["RRULE:FREQ=YEARLY"]).rec, { every: 12, unit: "month" });
  assert.deepEqual(rd(["RRULE:FREQ=DAILY;INTERVAL=3;WKST=MO"]).rec, { every: 3, unit: "day" });
  for (const bad of ["RRULE:FREQ=WEEKLY;BYDAY=MO,WE", "RRULE:FREQ=DAILY;COUNT=5", "RRULE:FREQ=MONTHLY;BYMONTHDAY=-1",
                     "RRULE:FREQ=HOURLY", "DURATION:PT1H", "RECURRENCE-ID:20261105"]) {
    assert.equal(rd([bad]).cut, true, bad);
  }
  assert.equal(rd(["CATEGORIES:" + "c".repeat(41)]).cut, true);
  assert.equal(V.read(todo(["UID:x", "SUMMARY:x\\ny"])).cut, true, "a title on two lines");
  assert.equal(V.read(todo(["UID:x"]) + todo(["UID:y"])).cut, true, "two tasks in one item");
  assert.equal(V.read("BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nUID:e\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n"), null, "an event is not ours");
});

test("DAV-4: a change patches only its own group; alarms, X- lines, RELATED-TO and DTSTART stay", () => {
  const raw = todo(["UID:abc-1", "DTSTAMP:20261001T000000Z", "LAST-MODIFIED:20261001T000000Z", "SEQUENCE:3",
    "SUMMARY:Water the plants", "PRIORITY:3", "DTSTART;TZID=Europe/Athens:20261101T080000",
    "DUE;TZID=Europe/Athens:20261103T180000", "X-APPLE-SORT-ORDER:12", "RELATED-TO;RELTYPE=SIBLING:other",
    "CATEGORIES:home", "BEGIN:VALARM", "ACTION:DISPLAY", "TRIGGER:-PT15M", "DESCRIPTION:x", "END:VALARM"]);
  const r = M.read(raw);
  assert.equal(r.ro, false);
  assert.deepEqual([r.main.prio, r.main.due, r.main.sub], [1, "2026-11-03", false]);
  // Ticked: only the status lines change.
  const out = M.write(Object.assign({}, r.main, { done: true, cats: ["Home"] }), raw);
  assert.ok(out);
  for (const keep of ["UID:abc-1", "SUMMARY:Water the plants", "PRIORITY:3", "DTSTART;TZID=Europe/Athens:20261101T080000",
    "DUE;TZID=Europe/Athens:20261103T180000", "X-APPLE-SORT-ORDER:12", "RELATED-TO;RELTYPE=SIBLING:other",
    "CATEGORIES:home", "BEGIN:VALARM", "TRIGGER:-PT15M"]) {
    assert.ok(out.includes(keep), keep);
  }
  assert.ok(out.includes("STATUS:COMPLETED") && out.includes("COMPLETED:20261101T090000Z") && out.includes("SEQUENCE:4"));
  assert.ok(!out.includes("LAST-MODIFIED:20261001"));
  assert.ok(out.indexOf("STATUS:COMPLETED") < out.indexOf("BEGIN:VALARM"), "properties before the alarm");
  // A new date keeps the time of day and the zone.
  const d2 = M.write(Object.assign({}, r.main, { due: "2026-11-10" }), raw);
  assert.ok(d2.includes("DUE;TZID=Europe/Athens:20261110T180000"));
  // Priority changed: P2 is written as 5.
  assert.ok(M.write(Object.assign({}, r.main, { prio: 2 }), raw).includes("PRIORITY:5"));
  // Read-only items are never written.
  const ro = todo(["UID:r", "SUMMARY:A", "RRULE:FREQ=DAILY;COUNT=3"]);
  assert.equal(M.read(ro).ro, true);
  assert.equal(M.write(Object.assign({}, M.read(ro).main, { text: "B" }), ro), null);
});

test("subtasks: a plain child is a subtask, a child with more is a task; new subtasks name their task", () => {
  const kid = M.read(todo(["UID:k1", "SUMMARY:Milk", "RELATED-TO:parent-1"]));
  assert.deepEqual([kid.main.sub, kid.main.puid], [true, "parent-1"]);
  const big = M.read(todo(["UID:k2", "SUMMARY:Milk", "DUE:20261105", "RELATED-TO;RELTYPE=PARENT:parent-1"]));
  assert.equal(big.main.sub, false, "a subtask cannot hold a date");
  assert.equal(M.read(todo(["UID:k3", "SUMMARY:Milk", "RELATED-TO;RELTYPE=CHILD:x"])).main.sub, false);
  const s = { id: "s1", text: "Eggs", notes: "", due: null, prio: 4, done: false, rec: null, cats: [], sub: true,
              puid: "t1@oros.todo", mtime: 3 };
  const text = M.write(s, null);
  assert.ok(text.includes("RELATED-TO;RELTYPE=PARENT:t1@oros.todo"));
  assert.equal(M.read(text).main.sub, true);
  // A subtask's hash is the same whether it sits under its task or as a task (the parent is not compared).
  assert.equal(M.hash(Object.assign({}, s, { sub: false, puid: "" })), M.hash(s));
  assert.equal(TD.parentId(COL, "t1@oros.todo"), "t1");
  assert.match(TD.parentId(COL, "parent-1"), /^dav-[0-9a-f]{16}$/);
  assert.equal(TD.parentId(COL, "parent-1"), M.idFor("parent-1", "k").dav, "the same id the engine gives it");
});

test("the hash ignores id, mtime, label case and order; copies are marked", () => {
  assert.equal(M.hash(task({ id: "zz", mtime: 99, cats: ["money", "HOME"] })), M.hash(task()));
  assert.equal(M.hash(task({ notes: "Line one\nline two\n\n" })), M.hash(task()));
  assert.notEqual(M.hash(task({ done: true })), M.hash(task()));
  const c = M.copy(task());
  assert.notEqual(c.id, "t1");
  assert.equal(c.text, "Pay the rent; then call, Anna (conflict)");
});
