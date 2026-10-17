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

test("contacts: a contact newer than its tombstone is alive; photos never go to the phone (CT-NP)", () => {
  const rows = P.contactRows({
    contacts: [contact({ id: "r", mtime: 20, photo: "data:image/jpeg;base64,AAAA" }),
      contact({ id: "s", photo: "data:image/svg+xml;base64,AAAA" }),
      contact({ id: "t", photo: "data:image/png;base64," + "A".repeat(80000) })],
    deleted: [{ id: "r", mtime: 15 }]
  });
  assert.deepEqual(rows.map((r) => [r.id, r.photo]), [["r", null], ["s", null], ["t", null]]);
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
  assert.equal(c.remind, null);                                // orOS rings it, not the phone Calendar
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

test("rows carry the label colour", () => {
  const ev = P.eventRows({ labels: [{ id: "work", color: "#4FC4CF" }],
    events: [{ id: "e1", date: "2026-10-14", labelId: "work", title: "A" }, { id: "e2", date: "2026-10-14", labelId: "gone", title: "B" }] }, "UTC");
  assert.equal(ev.find((r) => r.id === "e1").color, "#4fc4cf");
  assert.equal(ev.find((r) => r.id === "e2").color, null);
  const fd = P.feedRows({ items: [{ k: "a", date: "2026-10-14", title: "x", color: "#8c9eff" }, { k: "b", date: "2026-10-14", title: "y", color: "red" }] }, "UTC");
  assert.deepEqual(fd.map((r) => r.color).sort(), ["#8c9eff", null].sort());
});

test("phone → orOS: new, edited and deleted events (v2)", () => {
  const blob = { ver: 1, labels: [], deleted: [], events: [
    { id: "e1", date: "2026-10-14", start: "10:00", end: "11:00", title: "Old", note: "", location: "", labelId: "work", recur: null, remindMin: null, mtime: 1 },
    { id: "e2", date: "2026-10-15", start: null, end: null, title: "Gone", labelId: null, recur: null, remindMin: null, mtime: 1 }
  ] };
  const at = (h, m) => new Date(2026, 9, 14, h, m).getTime();
  const res = P.applyCalendarChanges(blob, [
    { ref: "r1", op: "upsert", id: "e1", title: "New title", desc: "n", loc: "Office", allDay: false, dtstart: at(12, 0), dtend: at(13, 30), remind: 14 },
    { ref: "r2", op: "delete", id: "e2" },
    { ref: "r3", op: "upsert", id: null, title: "Trip", allDay: true, dtstart: Date.UTC(2026, 9, 20), dtend: Date.UTC(2026, 9, 23), remind: -1 },
    { ref: "r4", op: "upsert", id: "f0123456789abcdef", title: "feed" }
  ], 500);
  assert.deepEqual(res.refs, ["r1", "r2", "r3", "r4"]);
  const e1 = res.blob.events.find((e) => e.id === "e1");
  assert.equal(e1.title, "New title");
  assert.equal(e1.start, "12:00");
  assert.equal(e1.end, "13:30");
  assert.equal(e1.location, "Office");
  assert.equal(e1.labelId, "work");
  assert.equal(e1.remindMin, 15);
  assert.equal(e1.mtime, 500);
  assert.equal(res.blob.events.some((e) => e.id === "e2"), false);
  assert.deepEqual(res.blob.deleted, [{ id: "e2", mtime: 500 }]);
  const trip = res.blob.events.find((e) => e.title === "Trip");
  assert.equal(trip.date, "2026-10-20");
  assert.equal(trip.dateEnd, "2026-10-22");
  assert.equal(trip.start, null);
  assert.equal(trip.remindMin, null);
  assert.equal(res.blob.events.length, 2);
  assert.equal(blob.events.length, 2, "input untouched");
});

test("phone → orOS: an edit on the phone keeps orOS's reminder (the copy carries none)", () => {
  const blob = { events: [{ id: "e1", date: "2026-10-14", start: "10:00", end: "11:00", title: "A", labelId: null, recur: null, remindMin: 30, mtime: 1 }] };
  const at = (h, m) => new Date(2026, 9, 14, h, m).getTime();
  const kept = P.applyCalendarChanges(blob, [{ ref: "r1", op: "upsert", id: "e1", title: "B", allDay: false, dtstart: at(10, 0), dtend: at(11, 0), remind: -1 }], 9);
  assert.equal(kept.blob.events[0].remindMin, 30);
  assert.equal(kept.blob.events[0].title, "B");
  const added = P.applyCalendarChanges(blob, [{ ref: "r1", op: "upsert", id: "e1", title: "A", allDay: false, dtstart: at(10, 0), dtend: at(11, 0), remind: 5 }], 9);
  assert.equal(added.blob.events[0].remindMin, 5);
});

test("phone → orOS: series edits, occurrences and RRULE round trip (v2)", () => {
  const series = { id: "s1", date: "2026-10-05", start: "09:00", end: "09:30", title: "Standup", labelId: "work",
    recur: { freq: "W", interval: 1, until: null, exdates: [] }, remindMin: null, mtime: 1 };
  const row = P.eventRows({ events: [series] }, "Europe/Athens")[0];
  const back = P.eventIn(Object.assign({}, row, { desc: row.desc, loc: row.loc }));
  assert.equal(back.date, "2026-10-05");
  assert.equal(back.start, "09:00");
  assert.equal(back.recur.freq, "W");
  // A moved occurrence: the series skips the day, a single event appears.
  const occ = new Date(2026, 9, 12, 9, 0).getTime();
  const res = P.applyCalendarChanges({ events: [series] }, [
    { ref: "r9", op: "upsert", id: null, orig: { id: "s1", at: occ }, title: "Standup (moved)", allDay: false,
      dtstart: new Date(2026, 9, 12, 11, 0).getTime(), dtend: new Date(2026, 9, 12, 11, 30).getTime(), remind: -1 },
    { ref: "r10", op: "upsert", id: null, orig: { id: "s1", at: new Date(2026, 9, 19, 9, 0).getTime() }, cancelled: true }
  ], 700);
  const s = res.blob.events.find((e) => e.id === "s1");
  assert.deepEqual(s.recur.exdates, ["2026-10-12", "2026-10-19"]);
  const one = res.blob.events.find((e) => e.title === "Standup (moved)");
  assert.equal(one.recur, null);
  assert.equal(one.start, "11:00");
  assert.equal(one.labelId, "work");
  assert.equal(res.blob.events.length, 2);
  // RRULE parts orOS cannot hold are dropped; UNTIL and EXDATE become days.
  const r = P.eventIn({ allDay: true, dtstart: Date.UTC(2026, 0, 31), duration: "P1D",
    rrule: "FREQ=MONTHLY;BYMONTHDAY=28,29,30,31;BYSETPOS=-1;UNTIL=20261231", exdate: "20260228" });
  assert.deepEqual(r.recur, { freq: "M", interval: 1, until: "2026-12-31", exdates: ["2026-02-28"] });
});

test("phone → orOS: new, edited and deleted contacts (v2)", () => {
  const blob = {
    ver: 1, labels: [], deleted: [],
    contacts: [
      { id: "c1", given: "Anna", family: "Pappa", phones: [{ v: "+30 690", type: "mobile" }], emails: [],
        websites: [{ v: "https://a.gr", type: "blog" }], im: [{ v: "anna", type: "home" }],
        relations: [{ with: "c2", type: "friend" }], labelIds: ["lbl-x"], photo: "data:image/jpeg;base64,AAAA",
        events: [], addresses: [], note: "old", starred: false, mtime: 1 },
      { id: "c2", given: "Bob", phones: [], emails: [{ v: "b@x.gr", type: "work" }], mtime: 1 }
    ]
  };
  const items = [
    { ref: "r10v3", id: "c1", op: "upsert", given: "Anna", middle: "", family: "Pappa-Nikolaou", nickname: "",
      org: "", title: "", note: "", starred: true,
      phones: [{ v: "+30 690", t: "mobile" }, { v: "210 123", t: "home" }], emails: [],
      addresses: [{ street: "Odos 1", city: "", region: "", zip: "", country: "", t: "home" }],
      websites: ["https://a.gr", "https://b.gr"],
      events: [{ t: "birthday", d: "1990-05-10", label: "" }, { t: "other", d: "--12-01", label: "Name day" }],
      photo: "BBBB" },
    { ref: "r11v1", id: "c2", op: "delete" },
    { ref: "r12v1", id: null, op: "upsert", given: "", middle: "", family: "", nickname: "", org: "", title: "",
      note: "", starred: false, phones: [{ v: "6944", t: "mobile" }], emails: [], addresses: [], websites: [],
      events: [{ t: "birthday", d: "19851103", label: "" }], photo: "iVBORw0K" },
    { ref: "r13v1", id: null, op: "upsert", given: "", phones: [], emails: [] }
  ];
  const res = P.applyContactChanges(blob, items, 500);
  assert.deepEqual(res.refs, ["r10v3", "r11v1", "r12v1", "r13v1"]);
  assert.equal(blob.contacts.length, 2, "input untouched");

  const a = res.blob.contacts.find((c) => c.id === "c1");
  assert.equal(a.family, "Pappa-Nikolaou");
  assert.equal(a.note, "");
  assert.equal(a.starred, true);
  assert.deepEqual(a.phones, [{ v: "+30 690", type: "mobile" }, { v: "210 123", type: "home" }]);
  assert.deepEqual(a.websites, [{ v: "https://a.gr", type: "blog" }, { v: "https://b.gr", type: "other" }]);
  assert.deepEqual(a.events, [
    { day: "05-10", year: 1990, type: "birthday", label: "" },
    { day: "12-01", year: null, type: "custom", label: "Name day" }
  ]);
  assert.equal(a.addresses[0].type, "home");
  assert.deepEqual(a.im, [{ v: "anna", type: "home" }], "orOS-only fields kept");
  assert.deepEqual(a.labelIds, ["lbl-x"]);
  assert.equal(a.relations.length, 1);
  assert.equal(a.photo, "data:image/jpeg;base64,AAAA", "stored fields orOS has stay as they are");
  assert.equal(a.mtime, 500);

  assert.ok(!res.blob.contacts.some((c) => c.id === "c2"));
  assert.deepEqual(res.blob.deleted, [{ id: "c2", mtime: 500 }]);

  const id = res.ids.r12v1;
  assert.ok(id && !res.ids.r13v1, "only the new contact with data gets an id");
  const n = res.blob.contacts.find((c) => c.id === id);
  assert.deepEqual(n.phones, [{ v: "6944", type: "mobile" }]);
  assert.deepEqual(n.events, [{ day: "11-03", year: 1985, type: "birthday", label: "" }]);
  assert.equal(n.photo, undefined, "CT-NP: a phone photo never comes in");
  assert.equal(n.avatar, null);
  assert.deepEqual([n.im, n.relations, n.labelIds], [[], [], []]);
  assert.equal(res.blob.contacts.length, 2);
});

test("phone → orOS contacts round trip: an untouched row comes back unchanged", () => {
  const blob = { ver: 1, labels: [], deleted: [], contacts: [
    { id: "k1", given: "Eleni", middle: "", family: "K", nickname: "Lena", org: "ACME", jobTitle: "CEO",
      phones: [{ v: "1", type: "work" }], emails: [{ v: "e@x.gr", type: "home" }],
      addresses: [{ street: "S", city: "C", zip: "1", region: "R", country: "GR", type: "work" }],
      websites: [], im: [], events: [{ day: "02-29", year: null, type: "anniversary", label: "" }],
      relations: [], labelIds: [], starred: false, note: "n", photo: null, mtime: 1 }
  ] };
  const row = P.contactRows(blob)[0];
  const res = P.applyContactChanges(blob, [Object.assign({ ref: "r1v1", op: "upsert" }, row)], 9);
  const back = Object.assign({}, res.blob.contacts[0], { mtime: 1 });
  assert.deepEqual(back, blob.contacts[0]);
});

test("phone changes sent again before the answer are applied once (v2)", () => {
  const item = { ref: "r7", op: "upsert", id: null, title: "Lunch", allDay: false, dtstart: 1, dtend: 2 };
  const first = P.splitTaken("calendar", [item], [], 1000);
  assert.equal(first.fresh.length, 1);
  const taken = [[P.takenKey("calendar", item), "", 1000]];
  const again = P.splitTaken("calendar", [Object.assign({}, item)], taken, 2000);
  assert.deepEqual([again.fresh.length, again.refs], [0, ["r7"]]);
  const edited = P.splitTaken("calendar", [Object.assign({}, item, { title: "Dinner" })], taken, 2000);
  assert.equal(edited.fresh.length, 1, "a later edit of the same row applies");
  assert.equal(P.splitTaken("contacts", [item], taken, 2000).fresh.length, 1, "kinds are apart");
  assert.equal(P.splitTaken("calendar", [item], taken, 1000 + 11 * 60 * 1000).fresh.length, 1, "forgotten after 10 minutes");
  const c = { ref: "r9v1", op: "upsert", id: null, given: "Viber" };
  const ct = P.splitTaken("contacts", [c], [[P.takenKey("contacts", c), "newid", 1000]], 1500);
  assert.deepEqual(ct.ids, { r9v1: "newid" }, "a repeat gets the id it got the first time");
});

test("reminders: Clock alarms, Water and To-Do for the next 48 hours (v3)", () => {
  const W = require(path.join(__dirname, "..", "water", "core.js"));
  const T = require(path.join(__dirname, "..", "todo", "core.js"));
  const now = new Date(2026, 9, 14, 8, 0).getTime();
  const at = (d, h, m) => new Date(2026, 9, d, h, m || 0).getTime();
  const water = W.parse(JSON.stringify({ sips: [{ id: "sip0001", ts: at(13, 20), ml: 250, m: 1 }],
    prefs: { rem: { on: 1, from: 540, to: 1260, every: 120 } } }));
  const rows = P.reminderRows({
    lang: "en", alarmTitle: "Alarm",
    alarms: [
      { id: "a1", at: at(13, 7), repeat: "daily", state: "pending", label: "Wake up" },
      { id: "a2", at: at(14, 9, 30), repeat: "once", state: "pending" },
      { id: "a3", at: at(14, 7), repeat: "once", state: "pending" },
      { id: "a4", at: at(14, 10), repeat: "once", state: "done" }
    ],
    water: { core: W, data: water },
    todo: { core: T, data: { lists: [{ id: "L", items: [{ id: "i1", title: "Pay", due: "2026-10-15", done: false }] }] } }
  }, now);
  const ids = rows.map((r) => r.id);
  assert.deepEqual(ids.filter((i) => i.startsWith("time:")),
    ["time:alarm-a2-2026-10-14", "time:alarm-a1-2026-10-15", "time:alarm-a1-2026-10-16"],
    "past once-alarms and finished ones are left out; a daily one rings each day ahead");
  const a1 = rows.find((r) => r.id === "time:alarm-a1-2026-10-15");
  assert.deepEqual([a1.kind, a1.at, a1.body, a1.link], ["alarm", at(15, 7), "Wake up", "time:alarms"]);
  const todo = rows.filter((r) => r.ns === "todo");
  assert.deepEqual(todo.map((r) => [r.id, r.at]), [["todo:due-2026-10-15-1", at(15, 9)]], "due tasks ring at 09:00 on their day");
  assert.equal(todo[0].link, "todo:L");
  const w = rows.filter((r) => r.ns === "water");
  assert.ok(w.length >= 1, "water reminders while behind the pace");
  assert.equal(w[0].id, "water:" + W.reminderDue(water, new Date(w[0].at)).key);
  assert.ok(w.every((r) => r.at > now && r.at <= now + 24 * 3600000));
  assert.deepEqual(rows.map((r) => r.at), rows.map((r) => r.at).slice().sort((a, b) => a - b), "sorted by time");
  assert.deepEqual(P.reminderRows({}, now), []);
});

test("widgetData: the Today summary in plain rows for the home-screen widget", () => {
  const sum = {
    today: "2026-10-14",
    apps: [{ id: "todo", name: "To-Do" }, { id: "calendar", name: "Calendar" }],
    groups: {
      info: [{ app: "weather", title: "Sunny, 24°" }],
      overdue: [{ app: "todo", due: "2026-10-12", time: null, title: "Pay rent", kind: "task" }],
      today: [{ app: "calendar", due: "2026-10-14", time: "09:30", title: "Dentist", kind: "event" },
              { app: "todo", due: null, time: null, title: "Daily walk", kind: "task" }],
      soon: [{ day: "2026-10-15", rows: [{ app: "calendar", due: "2026-10-15", time: null, title: "Trip", kind: "event" },
                                          { app: "x", title: "", kind: "task" }] }]
    }
  };
  assert.deepEqual(P.widgetData(sum), {
    day: "2026-10-14",
    info: "Sunny, 24°",
    rows: [
      { d: "2026-10-12", tm: "", t: "Pay rent", a: "To-Do", k: "task" },
      { d: "2026-10-14", tm: "09:30", t: "Dentist", a: "Calendar", k: "event" },
      { d: "", tm: "", t: "Daily walk", a: "To-Do", k: "task" },
      { d: "2026-10-15", tm: "", t: "Trip", a: "Calendar", k: "event" }
    ]
  }, "late first, a row with no day of its own keeps no day, rows without a title are dropped");
  assert.deepEqual(P.widgetData(null), { day: "", info: "", rows: [] });
  const many = { today: "2026-10-14", apps: [], groups: { today: Array.from({ length: 50 }, (_, i) => ({ title: "t" + i })) } };
  assert.equal(P.widgetData(many).rows.length, 30, "at most 30 rows");
});

test("healthOut: the last 30 days of Water and Workouts, never rows that came from Health Connect", () => {
  const now = Date.UTC(2026, 9, 14, 12);
  const day = 86400000;
  const water = { sips: [
    { id: "sip0001", ts: now - day, ml: 250, m: 5 },
    { id: "sip0002", ts: now - 40 * day, ml: 250, m: 5 },
    { id: "sip0003", m: 9, del: 1 },
    { id: "hc0123456789abcdef", ts: now - day, ml: 300, m: 7 }
  ] };
  const fit = { wo: [
    { id: "w1", m: 3, d: "2026-10-13", st: now - day, en: now - day + 3600000, ti: "Push" },
    { id: "w2", m: 3, d: "2026-10-14", st: now - 600000, en: 0, ti: "Running now" },
    { id: "w3", m: 3, d: "2026-10-12", st: now - 2 * day, en: now - 2 * day + 60000, ti: "Gone" },
    { id: "hc-abc", m: 3, d: "2026-10-12", st: now - 2 * day, en: now - 2 * day + 60000, ti: "From a watch" }
  ], tombs: { "wo:w3": 4 } };
  const o = P.healthOut(water, fit, now);
  assert.equal(o.since, now - 30 * day);
  assert.deepEqual(o.water, [{ id: "sip0001", at: now - day, ml: 250, v: 5 }]);
  assert.deepEqual(o.workouts, [{ id: "w1", st: now - day, en: now - day + 3600000, ti: "Push", v: 3 }],
    "a running workout, a deleted one and one from Health Connect stay home");
  assert.deepEqual(P.healthOut(null, null, now), { since: now - 30 * day, water: [], workouts: [] });
});

test("healthIn: water, workouts and steps from other apps, once, never over a deletion", () => {
  const now = new Date(2026, 9, 14, 15, 0).getTime();
  const ref = "0b1c2d3e-4f50-6172-8394-a5b6c7d8e9f0";
  const inc = {
    water: [{ ref, at: now - 3600000, ml: 330 }, { ref: "zz", at: now, ml: 200 }],
    workouts: [{ ref, st: now - 7200000, en: now - 3600000, ti: "", kind: "running" },
               { ref: "1111", st: now, en: now - 1, ti: "Bad" }],
    steps: [{ d: "2026-10-13", n: 9123 }, { d: "2026-10-14", n: 4210 }, { d: "2026-10-12", n: 0 }]
  };
  const names = { running: "Running", other: "Workout" };
  const r = P.healthIn({ water: { sips: [] }, fitness: null, health: null }, inc, now, names);
  assert.deepEqual(r.water.sips, [{ id: "hc0b1c2d3e4f5061728394a5b6c7d8e9f0", ts: now - 3600000, ml: 330, m: now }],
    "a reference with too few hex digits is skipped");
  assert.equal(r.fitness.wo.length, 1);
  assert.deepEqual(r.fitness.wo[0], { id: "hc-0b1c2d3e4f5061728394a5b6c7d8e9f0", m: now, d: "2026-10-14",
    st: now - 7200000, en: now - 3600000, ti: "Running", p: "", pd: "", n: "", x: [] });
  assert.deepEqual(r.health.en.map((e) => [e.id, e.t, e.v[0]]), [["hc-st-20261013", "st", 9123], ["hc-st-20261014", "st", 4210]]);
  assert.equal(r.health.en[1].at, now, "today's steps carry the time they were read");
  assert.equal(r.health.en[0].at, new Date(2026, 9, 13, 23, 59).getTime());

  const again = P.healthIn({ water: r.water, fitness: r.fitness, health: r.health }, inc, now + 1000, names);
  assert.deepEqual(again, { water: null, fitness: null, health: null }, "the same answer again changes nothing");

  const more = P.healthIn({ water: r.water, fitness: r.fitness, health: r.health },
    { steps: [{ d: "2026-10-14", n: 5000 }] }, now + 60000, names);
  assert.equal(more.health.en[1].v[0], 5000, "today's steps go up as the day goes on");

  const deleted = P.healthIn({ water: null, fitness: { wo: [], tombs: { "wo:hc-0b1c2d3e4f5061728394a5b6c7d8e9f0": now } },
    health: { en: [], tombs: { "en:hc-st-20261013": now } } }, inc, now, names);
  assert.equal(deleted.fitness, null, "a workout deleted in orOS is not brought back");
  assert.deepEqual(deleted.health.en.map((e) => e.id), ["hc-st-20261014"], "nor a deleted day of steps");
});

test("contacts: an orOS id stored twice becomes one phone contact", () => {
  const rows = P.contactRows({ contacts: [contact({ id: "x", given: "Elena" }), contact({ id: "x", given: "Elena", family: "K" })] });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].family, "P");
  assert.match(require("fs").readFileSync(path.join(__dirname, "..", "android", "app", "src", "main", "java",
    "online", "useoros", "twa", "ContactsWriter.java"), "utf8"), /!done\.add\(id\)/);
});
