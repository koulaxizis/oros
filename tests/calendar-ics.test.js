// Calendar .ics import parser (calendar/ics.js): time zones, all-day
// spans, recurrence mapping, exceptions, alarms, ids, limits.
// Run: node --test tests/

"use strict";

process.env.TZ = "Europe/Athens";       // local time of every expectation below

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const I = require(path.join(__dirname, "..", "calendar/ics.js"));

const wrap = (...ev) => ["BEGIN:VCALENDAR", "VERSION:2.0", ...ev.flat(), "END:VCALENDAR"].join("\r\n");
const vev = (...lines) => ["BEGIN:VEVENT", ...lines, "END:VEVENT"];
const one = (...lines) => {
  const r = I.parse(wrap(vev(...lines)));
  assert.equal(r.events.length, 1, JSON.stringify(r));
  return r.events[0];
};

test("timed event: UTC and floating times end up in local time, other zones are kept", () => {
  let e = one("UID:a", "DTSTART:20261015T070000Z", "DTEND:20261015T083000Z", "SUMMARY:Standup");
  assert.equal(e.date, "2026-10-15");
  assert.equal(e.start, "10:00");          // Athens is UTC+3 in October
  assert.equal(e.end, "11:30");
  assert.equal(e.title, "Standup");

  e = one("UID:b", "DTSTART;TZID=Europe/London:20261215T090000", "DTEND;TZID=Europe/London:20261215T100000");
  assert.equal(e.tz, "Europe/London");     // its own zone is kept, times as written
  assert.equal(e.start, "09:00");
  assert.equal(e.end, "10:00");

  e = one("UID:c", 'DTSTART;TZID="America/New_York":20260701T200000', "DURATION:PT2H");
  assert.deepEqual([e.date, e.start, e.end, e.tz], ["2026-07-01", "20:00", "22:00", "America/New_York"]);

  e = one("UID:c2", "DTSTART;TZID=America/New_York:20260701T200000", "DTEND:20260702T020000Z");
  assert.equal(e.end, "22:00");            // a UTC end shown in the start's zone

  e = one("UID:c3", "DTSTART;TZID=Europe/Athens:20260701T200000", "DTEND;TZID=Europe/Athens:20260701T210000");
  assert.deepEqual([e.start, e.end, "tz" in e], ["20:00", "21:00", false]);   // this device's zone: plain local

  e = one("UID:d", "DTSTART:20261101T093000", "DTEND:20261101T101500");
  assert.equal(e.start, "09:30");          // floating = as written
  assert.equal(e.end, "10:15");

  e = one("UID:e", "DTSTART;TZID=GTB Standard Time:20261101T093000");
  assert.equal(e.start, "09:30");          // unknown zone name → floating, never dropped
  assert.equal(e.end, null);
});

test("all-day: exclusive DTEND, multi-day spans, timed spans", () => {
  let e = one("UID:a", "DTSTART;VALUE=DATE:20261028", "DTEND;VALUE=DATE:20261029", "SUMMARY:Holiday");
  assert.deepEqual([e.date, e.dateEnd, e.start, e.end], ["2026-10-28", null, null, null]);

  e = one("UID:b", "DTSTART;VALUE=DATE:20261230", "DTEND;VALUE=DATE:20270103");
  assert.deepEqual([e.date, e.dateEnd], ["2026-12-30", "2027-01-02"]);

  e = one("UID:c", "DTSTART:20261010T220000", "DTEND:20261012T090000");
  assert.deepEqual([e.date, e.dateEnd, e.start, e.end], ["2026-10-10", "2026-10-12", "22:00", "09:00"]);

  e = one("UID:d", "DTSTART:20261010T220000", "DTEND:20261011T000000");
  assert.deepEqual([e.dateEnd, e.start, e.end], [null, "22:00", null]);   // ends at midnight: one day
});

test("text: unescaping, folding, limits, categories", () => {
  const e = one("UID:a", "DTSTART;VALUE=DATE:20261001",
    "SUMMARY:Dinner\\, drinks \\; more",
    "DESCRIPTION:Line one\\nLine two with a long tail that continues on the",
    "  next folded line",
    "LOCATION:Ermou 1\\, Athens",
    "CATEGORIES:Family,Work\\,Home");
  assert.equal(e.title, "Dinner, drinks ; more");
  assert.equal(e.note, "Line one\nLine two with a long tail that continues on the next folded line");
  assert.equal(e.location, "Ermou 1, Athens");
  assert.deepEqual(e.cats, ["Family", "Work,Home"]);

  const long = one("UID:b", "DTSTART;VALUE=DATE:20261001", "SUMMARY:" + "x".repeat(200), "DESCRIPTION:" + "y".repeat(900));
  assert.equal(long.title.length, 80);
  assert.equal(long.note.length, 500);
});

test("text is data: markup is kept as plain text, never interpreted", () => {
  const e = one("UID:a", "DTSTART;VALUE=DATE:20261001", "SUMMARY:<img src=x onerror=alert(1)>");
  assert.equal(e.title, "<img src=x onerror=alert(1)>");   // the Calendar renders titles with textContent
});

test("recurrence: simple rules map, UNTIL and COUNT become an end date", () => {
  let e = one("UID:a", "DTSTART;VALUE=DATE:20260115", "RRULE:FREQ=YEARLY");
  assert.deepEqual(e.recur, { freq: "Y", interval: 1, until: null, exdates: [] });

  e = one("UID:b", "DTSTART:20261005T090000", "RRULE:FREQ=WEEKLY;INTERVAL=2;BYDAY=MO;UNTIL=20261231T235959Z");
  assert.deepEqual(e.recur, { freq: "W", interval: 2, until: "2027-01-01", exdates: [] });

  e = one("UID:c", "DTSTART;VALUE=DATE:20260131", "RRULE:FREQ=MONTHLY;COUNT=3");
  assert.equal(e.recur.until, "2026-03-31");   // Jan 31 → Feb 28 → Mar 31 (sticky clamp)

  e = one("UID:d", "DTSTART;VALUE=DATE:20261001", "RRULE:FREQ=DAILY;COUNT=10");
  assert.equal(e.recur.until, "2026-10-10");

  e = one("UID:e", "DTSTART;VALUE=DATE:20261001", "RRULE:FREQ=DAILY;COUNT=1");
  assert.equal(e.recur, null);
});

test("recurrence: richer rules are kept (every N, several weekdays, Nth / last weekday, COUNT)", () => {
  let e = one("UID:a", "DTSTART;VALUE=DATE:20261005", "RRULE:FREQ=WEEKLY;BYDAY=MO,WE");
  assert.deepEqual(e.recur, { freq: "W", interval: 1, until: null, exdates: [], byday: [1, 3] });

  e = one("UID:b", "DTSTART;VALUE=DATE:20261013", "RRULE:FREQ=MONTHLY;BYDAY=2TU");
  assert.deepEqual(e.recur, { freq: "M", interval: 1, until: null, exdates: [], pos: 2, wday: 2 });

  e = one("UID:c", "DTSTART;VALUE=DATE:20261013", "RRULE:FREQ=WEEKLY;INTERVAL=3");
  assert.deepEqual(e.recur, { freq: "W", interval: 1, until: null, exdates: [], every: 3 });

  e = one("UID:d", "DTSTART;VALUE=DATE:20261030", "RRULE:FREQ=MONTHLY;BYDAY=FR;BYSETPOS=-1;COUNT=3");
  assert.deepEqual(e.recur, { freq: "M", interval: 1, until: "2026-12-25", exdates: [], pos: -1, wday: 5, count: 3 });

  e = one("UID:e", "DTSTART;VALUE=DATE:20260525", "RRULE:FREQ=YEARLY;BYMONTH=5;BYDAY=-1MO");
  assert.deepEqual([e.recur.pos, e.recur.wday], [-1, 1]);

  e = one("UID:f", "DTSTART:20261012T090000", "RRULE:FREQ=DAILY;BYDAY=MO,TU,WE,TH,FR");
  assert.deepEqual(e.recur.byday, [1, 2, 3, 4, 5]);        // "every weekday" = weekly on Mon–Fri
  assert.equal(e.recur.freq, "W");

  e = one("UID:g", "DTSTART;VALUE=DATE:20260131", "RRULE:FREQ=MONTHLY;BYMONTHDAY=28,29,30,31;BYSETPOS=-1");
  assert.deepEqual(e.recur, { freq: "M", interval: 1, until: null, exdates: [], });   // our own month-end clamp

  e = one("UID:h", "DTSTART;VALUE=DATE:20261013", "DTEND;VALUE=DATE:20261016", "RRULE:FREQ=MONTHLY;INTERVAL=2");
  assert.deepEqual([e.dateEnd, e.recur.every], ["2026-10-15", 2]);                    // repeats AND spans
});

test("recurrence the Calendar cannot hold: first occurrence only, counted", () => {
  const r = I.parse(wrap(
    vev("UID:a", "DTSTART;VALUE=DATE:20261005", "RRULE:FREQ=MONTHLY;BYMONTHDAY=1,15"),
    vev("UID:b", "DTSTART;VALUE=DATE:20261013", "RRULE:FREQ=MONTHLY;BYDAY=1MO,3MO"),
    vev("UID:c", "DTSTART;VALUE=DATE:20261013", "RRULE:FREQ=YEARLY;BYWEEKNO=20"),
    vev("UID:d", "DTSTART;VALUE=DATE:20261013", "RRULE:FREQ=HOURLY")));
  assert.equal(r.events.length, 4);
  assert.equal(r.simplified, 4);
  r.events.forEach((e) => assert.equal(e.recur, null));
});

test("time zone series: exdates, overrides and UNTIL in the series' own zone", () => {
  const r = I.parse(wrap(
    vev("UID:ny", "DTSTART;TZID=America/New_York:20261005T210000", "DURATION:PT1H",
      "RRULE:FREQ=WEEKLY;UNTIL=20261027T010000Z", "EXDATE;TZID=America/New_York:20261012T210000"),
    vev("UID:ny", "RECURRENCE-ID:20261020T010000Z", "DTSTART;TZID=America/New_York:20261019T220000")));
  const m = r.events[0];
  assert.equal(m.tz, "America/New_York");
  assert.equal(m.recur.until, "2026-10-26");          // 01:00 UTC = 21:00 the day before in New York
  assert.deepEqual(m.recur.exdates, ["2026-10-12", "2026-10-19"]);
});

test("EXDATE and RECURRENCE-ID: excluded dates and moved occurrences", () => {
  const r = I.parse(wrap(
    vev("UID:series-1", "DTSTART;TZID=Europe/Athens:20261005T090000", "DTEND;TZID=Europe/Athens:20261005T100000",
      "RRULE:FREQ=WEEKLY", "EXDATE;TZID=Europe/Athens:20261012T090000,20261019T090000", "SUMMARY:Gym"),
    vev("UID:series-1", "RECURRENCE-ID;TZID=Europe/Athens:20261026T090000",
      "DTSTART;TZID=Europe/Athens:20261027T180000", "DTEND;TZID=Europe/Athens:20261027T190000", "SUMMARY:Gym (moved)")));
  assert.equal(r.events.length, 2);
  const [m, o] = r.events;
  assert.deepEqual(m.recur.exdates, ["2026-10-12", "2026-10-19", "2026-10-26"]);
  assert.equal(o.date, "2026-10-27");
  assert.equal(o.start, "18:00");
  assert.equal(o.recur, null);
  assert.notEqual(o.id, m.id);
});

test("alarms: only Calendar presets, relative to the start", () => {
  const alarm = (trig) => one("UID:a", "DTSTART:20261001T090000",
    "BEGIN:VALARM", "ACTION:DISPLAY", "TRIGGER:" + trig, "END:VALARM").remindMin;
  assert.equal(alarm("-PT15M"), 15);
  assert.equal(alarm("-PT1H"), 60);
  assert.equal(alarm("-P1D"), 1440);
  assert.equal(alarm("-PT10M"), null);      // not a preset
  assert.equal(alarm("PT5M"), null);        // after the start
});

test("ids: orOS export round-trips, other UIDs hash stably", () => {
  assert.equal(one("UID:mf3k2abcd@oros.calendar", "DTSTART;VALUE=DATE:20261001").id, "mf3k2abcd");
  const a = one("UID:abc@google.com", "DTSTART;VALUE=DATE:20261001").id;
  const b = one("UID:abc@google.com", "DTSTART;VALUE=DATE:20261002").id;
  assert.match(a, /^ics-[0-9a-f]{16}$/);
  assert.equal(a, b);
  assert.notEqual(a, one("UID:abd@google.com", "DTSTART;VALUE=DATE:20261001").id);
  const r = I.parse(wrap(vev("UID:x", "DTSTART;VALUE=DATE:20261001"), vev("UID:x", "DTSTART;VALUE=DATE:20261003")));
  assert.equal(r.events.length, 1);         // duplicate UID in one file: first wins
  assert.equal(r.skipped, 1);
});

test("skips: cancelled, missing or broken start, nested components ignored", () => {
  const r = I.parse(wrap(
    vev("UID:a", "STATUS:CANCELLED", "DTSTART;VALUE=DATE:20261001"),
    vev("UID:b", "SUMMARY:no start"),
    vev("UID:c", "DTSTART:20261345"),
    vev("UID:d", "DTSTART;VALUE=DATE:20261001", "BEGIN:X-THING", "SUMMARY:inner", "END:X-THING", "SUMMARY:outer"),
    ["BEGIN:VTODO", "UID:t", "DTSTART:20261001", "END:VTODO"]));
  assert.equal(r.found, 4);
  assert.equal(r.skipped, 3);
  assert.deepEqual(r.events.map((e) => e.title), ["outer"]);
});

test("limits: at most MAX_EVENTS, the rest reported", () => {
  const evs = [];
  for (let i = 0; i < I.MAX_EVENTS + 3; i++) evs.push(vev("UID:" + i, "DTSTART;VALUE=DATE:20261001"));
  const r = I.parse(wrap(...evs));
  assert.equal(r.events.length, I.MAX_EVENTS);
  assert.equal(r.more, true);
  assert.deepEqual(I.parse("garbage").events, []);
  assert.deepEqual(I.parse(null).events, []);
});

test("round trip with the Calendar's own export format", () => {
  const text = wrap(vev(
    "UID:k1x9@oros.calendar", "DTSTAMP:20261001T000000Z",
    "DTSTART:20261020T183000", "DTEND:20261020T200000",
    "SUMMARY:Choir", "LOCATION:Hall", "RRULE:FREQ=WEEKLY;UNTIL=20261215",
    "EXDATE;VALUE=DATE:20261027", "CATEGORIES:Personal",
    "BEGIN:VALARM", "ACTION:DISPLAY", "TRIGGER:-PT30M", "DESCRIPTION:Choir", "END:VALARM"));
  const e = I.parse(text).events[0];
  assert.deepEqual(e, {
    id: "k1x9", date: "2026-10-20", dateEnd: null, start: "18:30", end: "20:00",
    title: "Choir", note: "", location: "Hall", cats: ["Personal"],
    recur: { freq: "W", interval: 1, until: "2026-12-15", exdates: ["2026-10-27"] },
    remindMin: 30
  });
});
