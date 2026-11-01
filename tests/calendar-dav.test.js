// CalDAV wave 3: calendar/dav.js, the mapper between one .ics item on
// the person's server and the Calendar's own event (DAV-4 lossless
// patch, read-only detection, DAV-6 write read back).
// Run: node --test tests/
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const CD = require("../calendar/dav.js");
const ICS = require("../calendar/ics.js");

const COL = "https://dav.test/dav/calendars/u/personal/";
let clock = Date.UTC(2026, 10, 1, 9, 0);
const M = CD.mapper(COL, { now: () => clock });

function ics(props, extra) {
  return ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Test//EN", "BEGIN:VEVENT"].concat(props, ["END:VEVENT"], extra || [],
    ["END:VCALENDAR", ""]).join("\r\n");
}
const EV = { id: "k1", date: "2026-11-02", dateEnd: null, start: "10:00", end: "11:30", title: "Dentist, room 2; Dr. X",
             note: "bring\nthe card", location: "Athens", recur: { freq: "W", interval: 1, until: null, exdates: ["2026-11-09"] },
             remindMin: 15, mtime: 5 };

test("an orOS event is written as its own item and reads back as the same event", () => {
  const text = M.write(EV, null);
  assert.ok(text, "written");
  assert.match(text, /UID:k1@oros\.calendar/);
  assert.match(text, /\r\n$/);
  const r = M.read(text, COL + "k1.ics");
  assert.equal(r.ro, false);
  assert.equal(r.main.id, "k1");
  assert.equal(M.hash(r.main), M.hash(EV));
  assert.equal(r.uid, "k1@oros.calendar");
  assert.deepEqual(M.idFor(r.uid, "x").own, "k1");
  // All-day, several days, no reminder.
  const ad = { id: "k2", date: "2026-12-24", dateEnd: "2026-12-26", start: null, end: null, title: "Holidays", note: "",
               location: "", recur: null, remindMin: null };
  const r2 = M.read(M.write(ad, null));
  assert.equal(M.hash(r2.main), M.hash(ad));
  assert.match(M.write(ad, null), /DTSTART;VALUE=DATE:20261224/);
});

test("the hash ignores id, label, mtime and what the Calendar would normalise anyway", () => {
  const a = Object.assign({}, EV, { id: "zz", labelId: "L", mtime: 99 });
  assert.equal(M.hash(a), M.hash(EV));
  assert.notEqual(M.hash(Object.assign({}, EV, { title: "Other" })), M.hash(EV));
  assert.equal(M.hash(Object.assign({}, EV, { remindMin: 7 })), M.hash(Object.assign({}, EV, { remindMin: null })), "not a preset");
});

test("DAV-4: a change patches only what orOS owns; guests, X- lines, other alarms and the time zone block stay", () => {
  const raw = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Nextcloud//EN", "BEGIN:VTIMEZONE", "TZID:Europe/Athens",
    "BEGIN:STANDARD", "DTSTART:19701025T040000", "TZOFFSETFROM:+0300", "TZOFFSETTO:+0200", "END:STANDARD", "END:VTIMEZONE",
    "BEGIN:VEVENT", "UID:abc@server.example", "DTSTAMP:20261001T000000Z", "LAST-MODIFIED:20261001T000000Z", "SEQUENCE:3",
    "DTSTART:20261103T090000Z", "DURATION:PT1H", "SUMMARY:Team", "ORGANIZER;CN=Ann:mailto:ann@example.com",
    "ATTENDEE;CN=Bob;PARTSTAT=ACCEPTED:mailto:bob@example.com", "CATEGORIES:Work", "X-NC-GROUP-ID:7", "CLASS:PRIVATE",
    "BEGIN:VALARM", "ACTION:AUDIO", "TRIGGER:-PT7M", "END:VALARM",
    "BEGIN:VALARM", "ACTION:DISPLAY", "TRIGGER:-PT15M", "DESCRIPTION:Team", "END:VALARM",
    "END:VEVENT", "END:VCALENDAR", ""].join("\r\n");
  const r = M.read(raw);
  assert.equal(r.ro, false);
  assert.equal(r.main.remindMin, 15);
  assert.equal(r.mtime, Date.UTC(2026, 9, 1));
  const ed = Object.assign({}, r.main, { title: "Team sync", note: "agenda", remindMin: 60 });
  const out = M.write(ed, raw);
  assert.ok(out);
  for (const keep of ["ORGANIZER;CN=Ann:mailto:ann@example.com", "ATTENDEE;CN=Bob;PARTSTAT=ACCEPTED:mailto:bob@example.com",
    "CATEGORIES:Work", "X-NC-GROUP-ID:7", "CLASS:PRIVATE", "TRIGGER:-PT7M", "BEGIN:VTIMEZONE", "TZOFFSETTO:+0200", "UID:abc@server.example"]) {
    assert.ok(out.includes(keep), keep);
  }
  assert.ok(!out.includes("TRIGGER:-PT15M"), "the alarm orOS read is replaced");
  assert.ok(out.includes("TRIGGER:-PT60M"));
  assert.ok(!out.includes("DURATION:"), "DTEND instead");
  assert.ok(out.includes("SEQUENCE:4"));
  assert.equal((out.match(/BEGIN:VEVENT/g) || []).length, 1);
  assert.equal(M.hash(M.read(out).main), M.hash(ed));
  // The same reminder: every alarm stays exactly.
  const same = M.write(Object.assign({}, r.main, { title: "Team!" }), raw);
  assert.ok(same.includes("TRIGGER:-PT15M") && same.includes("TRIGGER:-PT7M"));
  // Reminder removed: the other alarm stays.
  const none = M.write(Object.assign({}, r.main, { remindMin: null }), raw);
  assert.ok(!none.includes("TRIGGER:-PT15M") && none.includes("TRIGGER:-PT7M"));
  assert.equal(M.read(none).main.remindMin, null);
});

test("read-only: what orOS cannot show exactly; cancelled and tasks are not events", () => {
  const base = ["UID:x1", "DTSTAMP:20261001T000000Z", "DTSTART:20261103T090000Z", "DTEND:20261103T100000Z"];
  const cases = {
    "simplified repeat": base.concat(["SUMMARY:A", "RRULE:FREQ=MONTHLY;BYMONTHDAY=1,15"]),
    "RDATE": base.concat(["SUMMARY:A", "RDATE:20261110T090000Z"]),
    "long title": base.concat(["SUMMARY:" + "x".repeat(90)]),
    "title on two lines": base.concat(["SUMMARY:one\\ntwo"]),
    "long note": base.concat(["SUMMARY:A", "DESCRIPTION:" + "n".repeat(600)])
  };
  for (const [name, props] of Object.entries(cases)) {
    const r = M.read(ics(props));
    assert.equal(r.ro, true, name);
    assert.equal(M.write(Object.assign({}, r.main, { title: "B" }), ics(props)), null, name + ": never written");
  }
  // An edited occurrence: the series and the occurrence, both read-only.
  const series = ics(base.concat(["SUMMARY:Weekly", "RRULE:FREQ=WEEKLY"]),
    ["BEGIN:VEVENT", "UID:x1", "RECURRENCE-ID:20261110T090000Z", "DTSTART:20261110T110000Z", "DTEND:20261110T120000Z",
     "SUMMARY:Weekly (moved)", "END:VEVENT"]);
  const s = M.read(series);
  assert.equal(s.ro, true);
  assert.equal(s.main.title, "Weekly");
  assert.equal(s.extras.length, 1);
  assert.equal(s.extras[0].title, "Weekly (moved)");
  assert.ok(s.main.recur.exdates.length === 1);
  assert.deepEqual(M.read(ics(base.concat(["SUMMARY:A", "STATUS:CANCELLED"]))), { gone: true });
  const todo = ["BEGIN:VCALENDAR", "VERSION:2.0", "BEGIN:VTODO", "UID:t1", "SUMMARY:Task", "END:VTODO", "END:VCALENDAR"].join("\r\n");
  assert.equal(M.read(todo), null);
});

test("ids: own orOS items keep theirs, an imported .ics id is offered for binding, others get dav- + collection + UID", () => {
  assert.equal(M.idFor("k9@oros.calendar", "x").own, "k9");
  const ids = M.idFor("abc@server.example", "x");
  assert.equal(ids.own, null);
  assert.equal(ids.bind, ICS.hashId("abc@server.example"));
  assert.match(ids.dav, /^dav-[0-9a-f]{16}$/);
  assert.equal(CD.mapper(COL).idFor("abc@server.example", "x").dav, ids.dav, "the same on every device");
  assert.notEqual(CD.mapper(COL + "other/").idFor("abc@server.example", "x").dav, ids.dav);
  const c = M.copy(Object.assign({}, EV, { title: "y".repeat(80) }));
  assert.notEqual(c.id, EV.id);
  assert.equal(c.title.length, 80);
  assert.match(c.title, / \(conflict\)$/);
});

test("long lines are folded at 75 octets, Greek included, and read back whole", () => {
  const ev = Object.assign({}, EV, { title: "Συνάντηση με τον λογιστή για τα βιβλία του μήνα και τις δηλώσεις", note: "σημείωση ".repeat(40).trim() });
  const text = M.write(ev, null);
  for (const line of text.split("\r\n")) assert.ok(Buffer.byteLength(line, "utf8") <= 75, line);
  assert.equal(M.read(text).main.title, ev.title);
  assert.equal(M.read(text).main.note, ev.note);
});
