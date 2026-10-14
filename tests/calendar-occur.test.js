// Calendar wave 5 (calendar/occur.js): richer repeats, repeating
// spans, time zones, RRULE in and out, and the phone bridge's use of
// them (phone.js). The older shapes are covered by
// tests/today-wave2.test.js (walk identical to the pre-wave code).
// Run: node --test tests/

"use strict";

process.env.TZ = "Europe/Athens";       // the device zone of every expectation below

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const O = require(path.join(__dirname, "..", "calendar/occur.js"));
const P = require(path.join(__dirname, "..", "phone.js"));
const I = require(path.join(__dirname, "..", "calendar/ics.js"));

const take = (e, k) => { const o = []; O.eachOccurrence(e, (x) => { o.push(x); return o.length < k; }); return o; };
const norm = (r, d) => O.normRecur(r, d);

test("normRecur: old series keep their exact shape; new keys only when they say something", () => {
  const olds = [
    { freq: "W", interval: 2, until: null, exdates: [] },
    { freq: "D", interval: 1, until: "2026-12-01", exdates: ["2026-10-20", "2026-10-02", "2026-10-20"] },
    { freq: "M", interval: 1, until: null, exdates: [] },
    { freq: "Y", interval: 1, until: null, exdates: [] }
  ];
  assert.deepEqual(JSON.stringify(norm(olds[0], "2026-10-05")), '{"freq":"W","interval":2,"until":null,"exdates":[]}');
  assert.deepEqual(norm(olds[1], "2026-10-01").exdates, ["2026-10-02", "2026-10-20"]);
  assert.deepEqual(Object.keys(norm(olds[2], "2026-10-05")), ["freq", "interval", "until", "exdates"]);
  // weekly on the start's own weekday only = plain weekly
  assert.equal(norm({ freq: "W", byday: [1] }, "2026-10-05").byday, undefined);
  // every 2 weeks stays the legacy interval, other N go to `every`
  assert.deepEqual(norm({ freq: "W", every: 2 }, "2026-10-05"), { freq: "W", interval: 2, until: null, exdates: [] });
  assert.deepEqual(norm({ freq: "M", every: 3 }, "2026-10-05"), { freq: "M", interval: 1, until: null, exdates: [], every: 3 });
  // junk is dropped, never fatal
  assert.deepEqual(norm({ freq: "W", byday: [9, "x", 3, 3, 1], pos: 2, wday: 1, count: 0 }, "2026-10-05"),
    { freq: "W", interval: 1, until: null, exdates: [], byday: [1, 3] });
  assert.equal(norm({ freq: "X" }, "2026-10-05"), null);
  // count → until = the last occurrence (older versions stop there too)
  assert.deepEqual(norm({ freq: "D", every: 3, count: 4 }, "2026-10-14"),
    { freq: "D", interval: 1, until: "2026-10-23", exdates: [], every: 3, count: 4 });
});

test("every N days / weeks / months / years", () => {
  assert.deepEqual(take({ date: "2026-10-14", recur: { freq: "D", every: 10 } }, 3), ["2026-10-14", "2026-10-24", "2026-11-03"]);
  assert.deepEqual(take({ date: "2026-10-14", recur: { freq: "W", every: 3 } }, 3), ["2026-10-14", "2026-11-04", "2026-11-25"]);
  assert.deepEqual(take({ date: "2026-01-31", recur: { freq: "M", every: 2 } }, 4), ["2026-01-31", "2026-03-31", "2026-05-31", "2026-07-31"]);
  assert.deepEqual(take({ date: "2025-11-30", recur: { freq: "M", every: 3 } }, 3), ["2025-11-30", "2026-02-28", "2026-05-30"]);
  assert.deepEqual(take({ date: "2024-02-29", recur: { freq: "Y", every: 4 } }, 3), ["2024-02-29", "2028-02-29", "2032-02-29"]);
});

test("weekly on several weekdays, with a week step and a week start", () => {
  assert.deepEqual(take({ date: "2026-10-14", recur: { freq: "W", byday: [1, 3, 5] } }, 5),
    ["2026-10-14", "2026-10-16", "2026-10-19", "2026-10-21", "2026-10-23"]);
  // the start counts even when its weekday is not picked (RFC 5545)
  assert.deepEqual(take({ date: "2026-10-14", recur: { freq: "W", interval: 2, byday: [0, 1] } }, 5),
    ["2026-10-14", "2026-10-18", "2026-10-26", "2026-11-01", "2026-11-09"]);
  // WKST=SU puts Sunday Oct 25 in the week of Oct 26 (not the skipped one)
  assert.deepEqual(take({ date: "2026-10-19", recur: { freq: "W", interval: 2, byday: [0, 1], wkst: 0 } }, 3),
    ["2026-10-19", "2026-11-01", "2026-11-02"]);
});

test("monthly / yearly on the Nth or last weekday; a missing 5th is skipped", () => {
  assert.deepEqual(take({ date: "2026-10-30", recur: { freq: "M", pos: -1, wday: 5 } }, 4),
    ["2026-10-30", "2026-11-27", "2026-12-25", "2027-01-29"]);
  assert.deepEqual(take({ date: "2026-10-13", recur: { freq: "M", pos: 2, wday: 2 } }, 3), ["2026-10-13", "2026-11-10", "2026-12-08"]);
  assert.deepEqual(take({ date: "2026-10-29", recur: { freq: "M", pos: 5, wday: 4 } }, 3), ["2026-10-29", "2026-12-31", "2027-04-29"]);
  assert.deepEqual(take({ date: "2026-05-25", recur: { freq: "Y", pos: -1, wday: 1 } }, 3), ["2026-05-25", "2027-05-31", "2028-05-29"]);
  assert.equal(O.nthWeekday(2026, 1, 5, 0), null);          // no 5th Sunday in February 2026
  assert.equal(O.posOf("2026-10-30", true), -1);
  assert.equal(O.posOf("2026-10-23", true), null);
  assert.equal(O.posOf("2026-10-23", false), 4);
});

test("count and exdates: an excluded date still counts (RFC 5545)", () => {
  const e = { date: "2026-10-01", recur: norm({ freq: "D", count: 3, exdates: ["2026-10-02"] }, "2026-10-01") };
  assert.deepEqual(take(e, 9), ["2026-10-01", "2026-10-03"]);
  assert.equal(e.recur.until, "2026-10-03");
});

test("a repeating event may span several days", () => {
  const e = { id: "s", date: "2026-10-01", dateEnd: "2026-10-03", recur: { freq: "M" } };
  assert.equal(O.occursOn(e, "2026-11-02"), true);
  assert.equal(O.occursOn(e, "2026-11-03"), true);
  assert.equal(O.occursOn(e, "2026-11-04"), false);
  assert.equal(O.instanceOn(e, "2026-11-03").occ, "2026-11-01");
  assert.deepEqual(O.instanceOn(e, "2026-11-02"), { occ: "2026-11-01", date: "2026-11-01", dateEnd: "2026-11-03", start: null, end: null, zoned: false });
  // an excluded occurrence takes its whole span with it
  const x = Object.assign({}, e, { recur: { freq: "M", exdates: ["2026-11-01"] } });
  assert.equal(O.occursOn(x, "2026-11-02"), false);
  // a weekly overnight shift (Fri 22:00 → Sat 06:00)
  const n = { date: "2026-10-16", dateEnd: "2026-10-17", start: "22:00", end: "06:00", recur: { freq: "W" } };
  assert.deepEqual(O.instanceOn(n, "2026-10-24"), { occ: "2026-10-23", date: "2026-10-23", dateEnd: "2026-10-24", start: "22:00", end: "06:00", zoned: false });
});

test("time zones: wall times in the event's zone, shown in the device's", () => {
  const ny = { date: "2026-10-14", start: "20:00", end: "21:00", tz: "America/New_York" };
  assert.deepEqual(O.instance(ny, "2026-10-14"), { occ: "2026-10-14", date: "2026-10-15", dateEnd: null, start: "03:00", end: "04:00", zoned: true });
  assert.equal(O.occursOn(ny, "2026-10-14"), false);
  assert.equal(O.occursOn(ny, "2026-10-15"), true);
  // DST: New York leaves summer time on Nov 1, Athens on Oct 25
  const w = Object.assign({ recur: { freq: "W" } }, ny);
  assert.equal(O.instanceOn(w, "2026-10-22").start, "03:00");
  assert.equal(O.instanceOn(w, "2026-10-29").start, "02:00");   // Athens back to UTC+2, NY still UTC-4
  assert.equal(O.instanceOn(w, "2026-11-05").start, "03:00");   // both on winter time
  assert.equal(O.startTs(w, "2026-11-04"), Date.parse("2026-11-04T20:00:00-05:00"));
  // the device's own zone or an unknown name: plain local time
  assert.equal(O.instance({ date: "2026-10-14", start: "20:00", tz: "Europe/Athens" }, "2026-10-14").zoned, false);
  assert.equal(O.instance({ date: "2026-10-14", start: "20:00", tz: "Mars/Olympus" }, "2026-10-14").start, "20:00");
  // all-day events have no zone
  assert.equal(O.instance({ date: "2026-10-14", start: null, tz: "Asia/Tokyo" }, "2026-10-14").zoned, false);
  // an event far away can land two days off: still found
  const ki = { date: "2026-10-14", start: "00:30", tz: "Pacific/Kiritimati", recur: { freq: "D" } };
  assert.equal(O.instanceOn(ki, "2026-10-20").occ, "2026-10-21");
  assert.equal(O.wallToMs("2026-03-29", "03:30", "Europe/Athens"), Date.parse("2026-03-29T04:30:00+03:00"));  // a skipped hour lands after it
  assert.deepEqual(O.msToWall(Date.parse("2026-10-14T23:30:00Z"), "Asia/Tokyo"), { date: "2026-10-15", time: "08:30" });
});

test("eventsOn sorts by the time shown here", () => {
  const data = { events: [
    { id: "a", date: "2026-10-15", start: "02:30" },
    { id: "b", date: "2026-10-14", start: "20:00", tz: "America/New_York" },     // 03:00 here
    { id: "c", date: "2026-10-15" }
  ] };
  assert.deepEqual(O.eventsOn(data, "2026-10-15").map((e) => e.id), ["a", "b", "c"]);
});

test("RRULE out and back in: every shape survives", () => {
  const cases = [
    ["2026-10-14", { freq: "W", byday: [1, 3, 5] }, "FREQ=WEEKLY;BYDAY=MO,WE,FR"],
    ["2026-10-14", { freq: "W", every: 3 }, "FREQ=WEEKLY;INTERVAL=3"],
    ["2026-10-30", { freq: "M", pos: -1, wday: 5, count: 5 }, "FREQ=MONTHLY;BYDAY=-1FR;COUNT=5"],
    ["2026-05-25", { freq: "Y", pos: -1, wday: 1 }, "FREQ=YEARLY;BYMONTH=5;BYDAY=-1MO"],
    ["2026-01-31", { freq: "M", every: 2, until: "2027-01-31" }, "FREQ=MONTHLY;INTERVAL=2;BYMONTHDAY=28,29,30,31;BYSETPOS=-1;UNTIL=20270131"],
    ["2026-10-19", { freq: "W", interval: 2, byday: [0, 1], wkst: 0 }, "FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,SU;WKST=SU"],
    ["2026-10-14", { freq: "D", every: 2 }, "FREQ=DAILY;INTERVAL=2"]
  ];
  cases.forEach(([date, r, want]) => {
    const recur = norm(r, date);
    const out = O.toRrule({ date, recur });
    assert.equal(out, want);
    assert.deepEqual(O.fromRrule(out, date).recur, recur, out);
  });
  assert.deepEqual(O.fromRrule("FREQ=MONTHLY;BYMONTHDAY=1,15", "2026-10-01"), { simplified: true });
  assert.deepEqual(O.fromRrule("FREQ=MONTHLY;BYDAY=1MO,3MO", "2026-10-05"), { simplified: true });
  assert.deepEqual(O.fromRrule("FREQ=YEARLY;BYDAY=20MO", "2026-05-18"), { simplified: true });
  assert.deepEqual(O.fromRrule("FREQ=DAILY;COUNT=1", "2026-10-01"), { single: true });
  assert.deepEqual(O.fromRrule("FREQ=DAILY;UNTIL=20250101", "2026-10-01"), { single: true });
});

test("ICS round trip: a zoned, multi-day, Nth-weekday series", () => {
  const text = ["BEGIN:VCALENDAR", "BEGIN:VEVENT", "UID:k9@oros.calendar",
    "DTSTART;TZID=America/New_York:20261030T220000", "DTEND;TZID=America/New_York:20261031T020000",
    "RRULE:FREQ=MONTHLY;BYDAY=-1FR;UNTIL=20270401T035959Z", "EXDATE;TZID=America/New_York:20261127T220000",
    "SUMMARY:Late show", "END:VEVENT", "END:VCALENDAR"].join("\r\n");
  const e = I.parse(text).events[0];
  assert.deepEqual([e.date, e.dateEnd, e.start, e.end, e.tz], ["2026-10-30", "2026-10-31", "22:00", "02:00", "America/New_York"]);
  assert.deepEqual(e.recur, { freq: "M", interval: 1, until: "2027-03-31", exdates: ["2026-11-27"], pos: -1, wday: 5 });
});

const ev = (o) => Object.assign({ id: "e1", date: "2026-10-20", dateEnd: null, start: null, end: null,
  title: "T", note: "", location: "", labelId: null, recur: null, remindMin: null, mtime: 1 }, o);

test("phone bridge: new rules, repeating spans and zones go to Android as RFC 5545", () => {
  const [a, b, c, d] = P.eventRows({ events: [
    ev({ id: "a", start: "09:00", end: "10:00", recur: norm({ freq: "W", byday: [2, 4], count: 6 }, "2026-10-20") }),
    ev({ id: "b", dateEnd: "2026-10-22", recur: norm({ freq: "M", every: 2 }, "2026-10-20") }),
    ev({ id: "c", start: "20:00", end: "21:00", tz: "America/New_York", recur: { freq: "W", interval: 1, until: "2026-12-01", exdates: ["2026-11-03"] } }),
    ev({ id: "d", date: "2026-10-16", dateEnd: "2026-10-17", start: "22:00", end: "06:00", recur: { freq: "W", interval: 1, until: null, exdates: [] } })
  ] }, "Europe/Athens");
  assert.equal(a.rrule, "FREQ=WEEKLY;BYDAY=TU,TH;COUNT=6");
  assert.equal(b.rrule, "FREQ=MONTHLY;INTERVAL=2");
  assert.equal(b.duration, "P3D");
  assert.equal(c.tz, "America/New_York");
  assert.equal(c.dtstart, Date.parse("2026-10-20T20:00:00-04:00"));
  assert.equal(c.rrule, "FREQ=WEEKLY;UNTIL=20261202T045959Z");          // 23:59:59 in New York
  assert.equal(c.exdate, "20261104T010000Z");                            // Nov 3, 20:00 EST
  assert.equal(d.duration, "P" + 8 * 3600 + "S");
});

test("phone bridge: rules and zones come back from the phone", () => {
  const e = P.eventIn({ allDay: false, dtstart: Date.parse("2026-10-30T17:00:00+02:00"), duration: "P3600S",
    rrule: "FREQ=MONTHLY;BYDAY=-1FR;COUNT=4", exdate: "20261127T150000Z" });
  assert.deepEqual(e.recur, { freq: "M", interval: 1, until: "2027-01-29", exdates: ["2026-11-27"], pos: -1, wday: 5, count: 4 });
  // a spanning series is no longer cut to one day
  const s = P.eventIn({ allDay: true, dtstart: Date.UTC(2026, 9, 1), duration: "P3D", rrule: "FREQ=MONTHLY" });
  assert.deepEqual([s.date, s.dateEnd], ["2026-10-01", "2026-10-03"]);
  // an unsupported rule keeps its frequency, as before
  assert.equal(P.eventIn({ allDay: true, dtstart: Date.UTC(2026, 9, 1), rrule: "FREQ=MONTHLY;BYMONTHDAY=1,15" }).recur.freq, "M");
  // an edit of an event kept in New York stays in New York time
  const blob = { events: [ev({ id: "ny", start: "20:00", end: "21:00", tz: "America/New_York" })] };
  const res = P.applyCalendarChanges(blob, [{ ref: "r1", op: "upsert", id: "ny", allDay: false,
    dtstart: Date.parse("2026-10-20T21:00:00-04:00"), dtend: Date.parse("2026-10-20T22:30:00-04:00"), title: "Moved" }], 99);
  const ny = res.blob.events[0];
  assert.deepEqual([ny.date, ny.start, ny.end, ny.tz], ["2026-10-20", "21:00", "22:30", "America/New_York"]);
  // an occurrence of a zoned series: the exdate is its New York day
  const ser = { events: [ev({ id: "s", start: "20:00", tz: "America/New_York", recur: { freq: "D", interval: 1, until: null, exdates: [] } })] };
  const r2 = P.applyCalendarChanges(ser, [{ ref: "r2", op: "delete", orig: { id: "s", at: Date.parse("2026-10-21T20:00:00-04:00") } }], 99);
  assert.deepEqual(r2.blob.events[0].recur.exdates, ["2026-10-21"]);
});
