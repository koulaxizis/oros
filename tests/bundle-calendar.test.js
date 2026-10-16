// The .oroscal file (Calendar): every event and label through the
// shared kit (recordpkg.js) and bundle.js; opening adds only what is
// missing, with its ids. The .ics preview is the Export's own text
// (calendar/ics.js build). Plus the app wiring (Save, Open, unzipped
// folder, "Open with" for .oroscal and .ics).
// Run: node --test tests/*.test.js
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const B = require(path.join(ROOT, "bundle.js"));
const K = require(path.join(ROOT, "recordpkg.js"));
const P = require(path.join(ROOT, "calendar/package.js"));
const I = require(path.join(ROOT, "calendar/ics.js"));
const F = require(path.join(ROOT, "fileopen.js"));
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
const D = P.DESC;
const NOW = 1800000000000;

function slice() {
  return {
    ver: 1,
    labels: [
      { id: "lbl-family", name: "Family", color: "#9ece6a", mtime: 0 },
      { id: "lbl-gym", name: "Gym", color: "#e06c75", mtime: NOW - 900 },
      { id: "lbl-personal", name: "Personal", color: "#d4af37", mtime: 0 },
      { id: "lbl-work", name: "Work", color: "#7aa2f7", mtime: 0 }
    ],
    events: [
      { id: "ev1", date: "2026-10-20", dateEnd: null, start: "09:00", end: "10:30", title: "Dentist", note: "bring card\nfloor 2",
        location: "Main St; 4", labelId: "lbl-personal", recur: null, remindMin: 60, mtime: NOW - 700 },
      { id: "ev2", date: "2026-10-05", dateEnd: null, start: null, end: null, title: "=HYPERLINK(1)", note: "", location: "",
        labelId: "lbl-gym", recur: { freq: "W", interval: 1, until: null, exdates: ["2026-10-12"] }, remindMin: null, mtime: NOW - 600 },
      { id: "ev3", date: "2026-11-01", dateEnd: "2026-11-03", start: "18:00", end: "12:00", title: "Trip", note: "", location: "",
        labelId: null, recur: null, remindMin: null, mtime: NOW - 500, tz: "Europe/Athens" }
    ],
    deleted: [{ id: "ev-gone", mtime: NOW - 100 }, { id: "lbl-old", mtime: NOW - 100 }],
    subs: [{ id: "sub1", url: "https://calendar.example.com/private-SECRETKEY/basic.ics", name: "Work", color: "#7aa2f7", mtime: NOW - 50 }]
  };
}
function seeds() {
  return {
    ver: 1,
    labels: [
      { id: "lbl-family", name: "Family", color: "#9ece6a", mtime: 0 },
      { id: "lbl-personal", name: "Personal", color: "#d4af37", mtime: 0 },
      { id: "lbl-work", name: "Work", color: "#7aa2f7", mtime: 0 }
    ],
    events: [{ id: "mine", date: "2026-10-21", dateEnd: null, start: null, end: null, title: "Local only", note: "", location: "",
               labelId: null, recur: null, remindMin: null, mtime: NOW - 10 }],
    deleted: []
  };
}

test("calendar: round trip through bundle.js; no tombstones, subscriptions or secrets in the file", async () => {
  const o = K.pack(D, slice(), { title: "Calendar", lang: "en", now: NOW });
  assert.equal(o.mime, "application/x-oros-cal");
  assert.equal(o.generator, "orOS Calendar");
  assert.deepEqual(Object.keys(o.content.data).sort(), ["events", "labels", "ver"]);
  const bytes = await B.write(o);
  assert.equal(B.sniff(bytes.subarray(0, 128)), "application/x-oros-cal");
  const whole = Buffer.from(bytes).toString("latin1");
  assert.ok(!whole.includes("SECRETKEY") && !whole.includes("sub1"), "no subscription address");
  const r = await B.read(bytes, { mime: D.mime });
  assert.equal(r.content.kind, "oros-calendar-package");
  assert.deepEqual(r.content.data.events, slice().events);
  assert.deepEqual(r.content.data.labels, slice().labels);
  // the normaliser keeps the app's own data exactly
  assert.deepEqual(D.norm(clone(slice())).events, slice().events);
  // into a device that has its seed labels and one event of its own
  const res = K.open(D, seeds(), r.content, { now: NOW });
  assert.deepEqual(res.report, { added: 4, skipped: 3, updated: 0 });   // lbl-gym, ev1-3 | 3 seed labels
  assert.deepEqual(res.addedIds.slice().sort(), ["ev1", "ev2", "ev3", "lbl-gym"]);
  assert.deepEqual(res.next.events.map((e) => e.id), ["mine", "ev1", "ev2", "ev3"]);
  assert.deepEqual(res.next.deleted, []);
  assert.equal(res.next.subs, undefined);
  // and again: nothing
  const again = K.open(D, res.next, r.content, { now: NOW });
  assert.equal(again.report.added, 0);
  assert.deepEqual(again.next, res.next);
});

test("calendar: preview/calendar.ics is the Export's text; the builder matches the exporter", async () => {
  const o = K.pack(D, slice(), { lang: "el", now: NOW });
  const ics = o.preview.find((p) => p.name === "calendar.ics").data;
  assert.match(ics, /^BEGIN:VCALENDAR\r\nVERSION:2\.0\r\nPRODID:-\/\/orOS\/\/Calendar\/\/EN\r\n/);
  assert.match(ics, /UID:ev1@oros\.calendar\r\n/);
  assert.match(ics, /DTSTART:20261020T090000\r\nDTEND:20261020T103000\r\nSUMMARY:Dentist\r\nDESCRIPTION:bring card\\nfloor 2\r\nLOCATION:Main St\\; 4\r\n/);
  assert.match(ics, /CATEGORIES:Προσωπικό\r\n/);                 // a seed label in the file's language
  assert.match(ics, /TRIGGER:-PT60M/);
  assert.match(ics, /DTSTART;VALUE=DATE:20261005\r\nDTEND;VALUE=DATE:20261006\r\nSUMMARY:=HYPERLINK\(1\)\r\nRRULE:FREQ=WEEKLY\r\nEXDATE;VALUE=DATE:20261012\r\nCATEGORIES:Gym\r\n/);
  assert.match(ics, /DTSTART;TZID=Europe\/Athens:20261101T180000\r\nDTEND;TZID=Europe\/Athens:20261103T120000\r\n/);
  assert.match(ics, /END:VCALENDAR\r\n$/);
  assert.ok(!/SECRETKEY|ev-gone/.test(ics));
  // the .ics parser reads the preview back to the same events
  const back = I.parse(ics);
  assert.deepEqual(back.events.map((e) => e.id), ["ev1", "ev2", "ev3"]);
  assert.equal(back.events[0].note, "bring card\nfloor 2");
  // the app's Export uses the same builder
  const js = read("calendar/calendar.js");
  assert.match(js, /window\.OrosIcs\.build\(events, \{/);
  assert.match(js, /new Blob\(\[icsText\(state\.events\)\]/);
  assert.ok(!/function icsEventLines/.test(js), "one builder only");
});

test("calendar: a clash keeps the local event, a deleted one stays deleted, update takes newer", () => {
  const theirs = slice();
  theirs.events[0].title = "Dentist (moved)"; theirs.events[0].mtime = NOW - 1;
  theirs.events.push({ id: "ev-gone", date: "2026-10-01", title: "deleted here", mtime: NOW - 1 });
  theirs.labels[1].name = "Gym 2"; theirs.labels[1].mtime = NOW - 1;
  const mine = slice();
  const c = K.pack(D, theirs, { now: NOW }).content;
  const res = K.open(D, mine, c, { now: NOW });
  assert.deepEqual(res.report, { added: 0, skipped: 8, updated: 0 });
  assert.equal(res.next.events[0].title, "Dentist");
  assert.ok(!res.next.events.some((e) => e.id === "ev-gone"));
  const upd = K.open(D, mine, c, { update: true, now: NOW });
  assert.deepEqual(upd.updatedIds.slice().sort(), ["ev1", "lbl-gym"]);
  assert.equal(upd.next.events[0].title, "Dentist (moved)");
  assert.equal(upd.next.labels[1].name, "Gym 2");
  assert.deepEqual(upd.next.deleted, mine.deleted);
  assert.deepEqual(upd.next.subs, mine.subs);                    // this device's subscriptions stay
  assert.ok(!upd.next.events.some((e) => e.id === "ev-gone"));
  assert.equal(P.kindOf("ev1", res.next), "event");
  assert.equal(P.kindOf("lbl-gym", res.next), "label");
  assert.equal(P.kindOf("nope", res.next), "");
  // tombstones in a file are ignored: nothing here is deleted
  const c2 = { kind: "oros-calendar-package", ver: 1, data: { events: [], labels: [], deleted: [{ id: "mine", mtime: NOW }] } };
  const r2 = K.open(D, seeds(), c2, { now: NOW });
  assert.deepEqual(r2.next, seeds());
});

test("calendar: hostile content is cut down", () => {
  const far = NOW + 10 * 365 * 864e5;
  const long = "x".repeat(5000);
  const n = D.norm({
    deleted: "junk",
    subs: [{ id: "s", url: "javascript:alert(1)" }],
    labels: [{ id: "lb", name: "a\u0000b" + long, color: "red", mtime: 1 }, { id: "lb2", name: "<img onerror=x>", color: "#e06c75", mtime: "9" },
             { id: "lbl-work", name: "Δουλειά", color: "#7aa2f7", mtime: 0 }, 5, null],
    events: [
      { id: "e1", date: "2026-13-01", title: "bad date" },
      { id: "e2", date: "2026-10-01", dateEnd: "2026-09-01", start: "25:00", end: "10:00", title: { x: 1 }, note: long, location: "a\nb",
        labelId: 7, recur: { freq: "X" }, remindMin: 3, mtime: far, tz: "Europe/Athens", onclick: "x", __proto__: { evil: 1 } },
      { id: "e3", date: "2026-10-01", start: "10:00", end: "09:00", title: "t‮", recur: { freq: "D", every: 5000, exdates: ["x", "2026-10-03"] }, tz: "../../etc" },
      { id: "e3", date: "2026-10-09", title: "duplicate" },
      { id: "", date: "2026-10-01" }, { id: "x".repeat(300), date: "2026-10-01" }, { id: "a\u0001b", date: "2026-10-01" }, "junk"
    ]
  });
  assert.deepEqual(n.labels.map((l) => l.id), ["lb2", "lbl-work"]);
  assert.equal(n.labels[0].mtime, 0);
  assert.equal(n.labels[1].name, "Work");                       // a seed keeps its canonical name
  assert.deepEqual(n.events.map((e) => e.id), ["e2", "e3"]);
  const e2 = n.events[0];
  assert.deepEqual([e2.dateEnd, e2.start, e2.end, e2.title, e2.note.length, e2.location, e2.labelId, e2.recur, e2.remindMin, e2.tz, e2.onclick, e2.evil],
    [null, null, "10:00", "", 500, "a b", null, null, null, undefined, undefined, undefined]);
  const e3 = n.events[1];
  assert.equal(e3.end, null);                                   // end before start on one day
  assert.equal(e3.tz, undefined);
  assert.deepEqual(e3.recur.exdates, ["2026-10-03"]);
  assert.equal(n.deleted, undefined);
  assert.equal(n.subs, undefined);
  assert.equal(D.norm("x"), null);
  // the kit clamps the stamps of what it adds; kind and version checked
  const res = K.open(D, seeds(), { kind: "oros-calendar-package", ver: 1, data: { events: [
    { id: "far", date: "2026-10-01", mtime: far }], labels: [] } }, { now: NOW });
  assert.equal(res.next.events.find((x) => x.id === "far").mtime, NOW + K.FUTURE);
  assert.throws(() => K.open(D, seeds(), { kind: "oros-todo-package", ver: 1, data: {} }), /notpackage/);
  assert.throws(() => K.open(D, seeds(), { kind: "oros-calendar-package", ver: 9, data: {} }), /newer/);
});

test("calendar: wiring (scripts, menu items, Open with, Undo, help, file types)", () => {
  const html = read("calendar/index.html");
  ["../bundle.js?v=", "../recordpkg.js?v=", "package.js?v=", "calendar.js?v=", "ics.js?v="].forEach((s) =>
    assert.ok(html.includes('src="' + s), s));
  assert.ok(html.indexOf('src="occur.js') < html.indexOf('src="package.js'));
  assert.ok(html.indexOf('src="ics.js') < html.indexOf('src="package.js'));
  assert.ok(html.indexOf("recordpkg.js") < html.indexOf('src="calendar.js'));
  ["mm-osave", "mm-oopen", "mm-ofolder"].forEach((id) => assert.ok(html.includes('id="' + id + '"'), id));
  const js = read("calendar/calendar.js");
  assert.match(js, /RP\.ui\(CPK\.DESC,/);
  assert.match(js, /if \(target && target\.openFile\) \{ if \(recFile\) recFile\.openTarget\(target\.openFile\); return; \}/);
  assert.match(js, /importIcsText\(f\.text,/);                   // .ics from "Open with" still as text
  assert.match(js, /deleteIds: function \(ids\) \{ dropAdded\(ids\); \}/);
  assert.match(js, /subs: state\.subs/);
  assert.match(js, /__orosTakeFile\(/);
  assert.equal((js.match(/window\.__orosOpenAt\s*=/g) || []).length, 1);
  assert.match(js, /__orosTakeTarget\("calendar"\)/);
  for (const k of ["mm.osave", "mm.oopen", "mm.ofolder"]) assert.equal((js.match(new RegExp('"' + k.replace(".", "\\.") + '":', "g")) || []).length, 2, k);
  assert.ok(js.includes('"mm.osave": "orOS file (.oroscal)"') && js.includes('"mm.osave": "Αρχείο orOS (.oroscal)"'));
  for (const f of ["calendar/help.en.txt", "calendar/help.el.txt"]) assert.ok(read(f).includes(".oroscal"), f);
  assert.deepEqual(F.appsFor(".oroscal"), ["calendar"]);
  assert.deepEqual(B.TYPES[".oroscal"], { app: "calendar", mime: "application/x-oros-cal" });
});

function clone(x) { return JSON.parse(JSON.stringify(x)); }
