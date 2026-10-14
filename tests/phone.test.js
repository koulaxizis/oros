// Phone bridge (phone.js, BR-PHONE v1): the rows handed to the orOS
// Android app for the phone's Contacts and Calendar.
// Run: node --test tests/

"use strict";

process.env.TZ = "Europe/Athens";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const P = require(path.join(__dirname, "..", "phone.js"));

const contact = (o) => Object.assign({ id: "c1", given: "Maria", family: "P", phones: [], emails: [], addresses: [],
  websites: [], im: [], events: [], labelIds: [], starred: false, note: "", photo: null, mtime: 10 }, o);

test("contacts: fields, types, dedupe, tombstones, sort, hash", () => {
  const rows = P.contactRows({
    contacts: [
      contact({ id: "b", phones: [{ v: " +30 690 1 ", type: "mobile" }, { v: "+30 690 1", type: "home" }, { v: "210", type: "fax" }],
        emails: [{ v: "m@x.gr", type: "work" }], jobTitle: "Chef", org: "Taverna",
        events: [{ day: "03-17", year: 1990, type: "birthday" }, { day: "06-01", year: null, type: "custom", label: "Name day" }, { day: "bad" }],
        addresses: [{ street: "Ermou 1", city: "Athens", zip: "10563", type: "home" }, { street: "" }],
        websites: [{ v: "https://x.gr", type: "home" }] }),
      contact({ id: "a" }),
      contact({ id: "gone", mtime: 5 }),
      contact({ id: "empty", given: "", family: "" })
    ],
    deleted: [{ id: "gone", mtime: 9 }]
  });
  assert.deepEqual(rows.map((r) => r.id), ["a", "b"]);
  const b = rows[1];
  assert.deepEqual(b.phones, [{ v: "+30 690 1", t: "mobile" }, { v: "210", t: "other" }]);
  assert.deepEqual(b.emails, [{ v: "m@x.gr", t: "work" }]);
  assert.equal(b.org, "Taverna");
  assert.equal(b.title, "Chef");
  assert.deepEqual(b.events, [{ t: "birthday", d: "1990-03-17", label: "" }, { t: "other", d: "--06-01", label: "Name day" }]);
  assert.deepEqual(b.addresses, [{ street: "Ermou 1", city: "Athens", region: "", zip: "10563", country: "", t: "home" }]);
  assert.deepEqual(b.websites, ["https://x.gr"]);
  assert.match(b.h, /^[0-9a-f]{8}$/);
  const again = P.contactRows({ contacts: [contact({ id: "a" })] });
  assert.equal(again[0].h, rows[0].h);                        // stable
  assert.notEqual(P.contactRows({ contacts: [contact({ id: "a", note: "x" })] })[0].h, rows[0].h);
});

test("contacts: a contact newer than its tombstone is alive; photos only as small JPEG/PNG", () => {
  const rows = P.contactRows({
    contacts: [contact({ id: "r", mtime: 20, photo: "data:image/jpeg;base64,AAAA" }),
      contact({ id: "s", photo: "data:image/svg+xml;base64,AAAA" }),
      contact({ id: "t", photo: "data:image/png;base64," + "A".repeat(80000) })],
    deleted: [{ id: "r", mtime: 15 }]
  });
  assert.deepEqual(rows.map((r) => [r.id, r.photo]), [["r", "AAAA"], ["s", null], ["t", null]]);
  assert.deepEqual(P.contactRows(null), []);
});

const ev = (o) => Object.assign({ id: "e1", date: "2026-10-20", dateEnd: null, start: null, end: null,
  title: "T", note: "", location: "", labelId: null, recur: null, remindMin: null, mtime: 1 }, o);

test("calendar: all-day, multi-day, timed and overnight events", () => {
  const rows = P.eventRows({ events: [
    ev({ id: "a" }),
    ev({ id: "b", dateEnd: "2026-10-22" }),
    ev({ id: "c", start: "18:30", end: "20:00", remindMin: 15, location: "Hall" }),
    ev({ id: "d", start: "22:00", end: "02:00", dateEnd: "2026-10-21" }),
    ev({ id: "e", start: "09:00" })
  ] }, "Europe/Athens");
  const [a, b, c, d, e] = rows;
  assert.deepEqual([a.allDay, a.dtstart, a.dtend, a.tz, a.rrule], [true, Date.UTC(2026, 9, 20), Date.UTC(2026, 9, 21), "UTC", null]);
  assert.equal(b.dtend, Date.UTC(2026, 9, 23));
  assert.equal(c.allDay, false);
  assert.equal(c.dtstart, Date.parse("2026-10-20T18:30:00+03:00"));
  assert.equal(c.dtend, Date.parse("2026-10-20T20:00:00+03:00"));
  assert.equal(c.tz, "Europe/Athens");
  assert.equal(c.remind, 15);
  assert.equal(c.loc, "Hall");
  assert.equal(d.dtend, Date.parse("2026-10-21T02:00:00+03:00"));
  assert.equal(e.dtend, e.dtstart);                             // no end: zero length
});

test("calendar: series use RRULE + DURATION, never DTEND; EXDATE matches instance starts", () => {
  const [w, y] = P.eventRows({ events: [
    ev({ id: "w", start: "09:00", end: "10:30", recur: { freq: "W", interval: 2, until: "2026-12-15", exdates: ["2026-11-03"] } }),
    ev({ id: "y", recur: { freq: "Y", interval: 1, until: null, exdates: ["2027-10-20"] } })
  ] }, "Europe/Athens");
  assert.equal(w.rrule, "FREQ=WEEKLY;INTERVAL=2;UNTIL=20261215T215959Z");   // 23:59:59 Athens (UTC+2 in December)
  assert.equal(w.dtend, null);
  assert.equal(w.duration, "P5400S");
  assert.equal(w.exdate, "20261103T070000Z");                               // 09:00 Athens (UTC+2)
  assert.equal(y.rrule, "FREQ=YEARLY");
  assert.equal(y.duration, "P1D");
  assert.equal(y.exdate, "20271020T000000Z");
});

test("calendar: month-end clamp matches the Calendar (Jan 31 → Feb 28 → Mar 31)", () => {
  assert.equal(P.rrule(ev({ date: "2026-01-31", recur: { freq: "M" } })), "FREQ=MONTHLY;BYMONTHDAY=28,29,30,31;BYSETPOS=-1");
  assert.equal(P.rrule(ev({ date: "2026-01-29", recur: { freq: "M" } })), "FREQ=MONTHLY;BYMONTHDAY=28,29;BYSETPOS=-1");
  assert.equal(P.rrule(ev({ date: "2026-01-28", recur: { freq: "M" } })), "FREQ=MONTHLY");
  assert.equal(P.rrule(ev({ date: "2028-02-29", recur: { freq: "Y" } })), "FREQ=YEARLY;BYMONTH=2;BYMONTHDAY=28,29;BYSETPOS=-1");
  assert.equal(P.rrule(ev({ date: "2026-10-20", recur: { freq: "D", until: "2026-10-30" } })), "FREQ=DAILY;UNTIL=20261030T000000Z");
  assert.equal(P.rrule(ev({ recur: null })), null);
});

test("calendar: tombstoned and broken events are left out; ids sorted; hash stable", () => {
  const rows = P.eventRows({ events: [ev({ id: "z" }), ev({ id: "x", mtime: 1 }), ev({ id: "bad", date: "20261020" })],
    deleted: [{ id: "x", mtime: 2 }] }, "Europe/Athens");
  assert.deepEqual(rows.map((r) => r.id), ["z"]);
  assert.equal(rows[0].h, P.eventRows({ events: [ev({ id: "z" })] }, "Europe/Athens")[0].h);
  assert.deepEqual(P.eventRows(null), []);
});

test("feedRows: calendar feed days become stable read-only rows", () => {
  const store = { at: 1, items: [
    { k: "tdo-a-2026-10-14", date: "2026-10-14", start: null, title: "Pay rent", note: "To-Do" },
    { k: "sky-2026-10-14-0", date: "2026-10-14", start: "21:30", end: null, title: "Full Moon", note: "" },
    { k: "tdo-a-2026-10-14", date: "2026-10-14", title: "dup" },
    { k: "", date: "2026-10-14", title: "no key" },
    { k: "x", date: "14/10/2026", title: "bad date" }
  ] };
  const rows = P.feedRows(store, "Europe/Athens");
  assert.equal(rows.length, 2);
  const allDay = rows.find((r) => r.title === "Pay rent");
  assert.equal(allDay.allDay, true);
  assert.equal(allDay.dtstart, Date.UTC(2026, 9, 14));
  assert.equal(allDay.dtend, Date.UTC(2026, 9, 15));
  assert.equal(allDay.tz, "UTC");
  assert.equal(allDay.desc, "To-Do");
  const timed = rows.find((r) => r.title === "Full Moon");
  assert.equal(timed.allDay, false);
  assert.equal(timed.dtend, timed.dtstart);
  assert.equal(timed.tz, "Europe/Athens");
  assert.equal(P.feedRows(store, "UTC")[0].id, P.feedRows(store, "UTC")[0].id);
  assert.match(allDay.id, /^f[0-9a-f]{16}$/);
  assert.deepEqual(P.feedRows(null, "UTC"), []);
});
