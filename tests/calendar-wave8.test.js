// Calendar wave 8: quick add parser (calendar/quickadd.js), subscribed
// calendars (calendar/subs.js), free times (calendar/free.js) and the
// "slots" kind of Send to someone (share/kinds.js).
// Run: node --test tests/

"use strict";

process.env.TZ = "Europe/Athens";       // local time of every expectation below

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const Q = require(path.join(ROOT, "calendar/quickadd.js"));
const S = require(path.join(ROOT, "calendar/subs.js"));
const F = require(path.join(ROOT, "calendar/free.js"));
const O = require(path.join(ROOT, "calendar/occur.js"));
const I = require(path.join(ROOT, "calendar/ics.js"));
const K = require(path.join(ROOT, "share/kinds.js"));

const TODAY = "2026-10-14";              // a Wednesday
const p = (s) => Q.parse(s, { today: TODAY });
const pick = (r) => ({ title: r.title, date: r.date, start: r.start, end: r.end, location: r.location });

// ---------- Quick add ----------
test("quick add: the five examples of the brief", () => {
  assert.deepEqual(pick(p("Coffee with Nikos Thursday 6pm at Syntagma")),
    { title: "Coffee with Nikos", date: "2026-10-15", start: "18:00", end: null, location: "Syntagma" });
  assert.deepEqual(pick(p("Καφές με Νίκο Πέμπτη 6μμ στο Σύνταγμα")),
    { title: "Καφές με Νίκο", date: "2026-10-15", start: "18:00", end: null, location: "Σύνταγμα" });
  assert.deepEqual(pick(p("dentist 15/11 9:30")),
    { title: "dentist", date: "2026-11-15", start: "09:30", end: null, location: "" });
  const gym = p("every Monday gym 7am");
  assert.deepEqual(pick(gym), { title: "gym", date: "2026-10-19", start: "07:00", end: null, location: "" });
  assert.equal(gym.recur.freq, "W");
  assert.equal(gym.recur.byday, undefined);           // the start's own weekday
  assert.deepEqual(pick(p("αύριο 10-12 σύσκεψη")),
    { title: "σύσκεψη", date: "2026-10-15", start: "10:00", end: "12:00", location: "" });
});

test("quick add: dates", () => {
  assert.equal(p("x today").date, TODAY);
  assert.equal(p("x σήμερα").date, TODAY);
  assert.equal(p("x tomorrow").date, "2026-10-15");
  assert.equal(p("x μεθαύριο").date, "2026-10-16");
  assert.equal(p("x the day after tomorrow").date, "2026-10-16");
  assert.equal(p("x Wednesday").date, TODAY);          // today's weekday is today
  assert.equal(p("x next Wednesday").date, "2026-10-21");
  assert.equal(p("x next Friday").date, "2026-10-23");  // Friday of next week
  assert.equal(p("x την άλλη Τρίτη").date, "2026-10-20");
  assert.equal(p("x το Σάββατο").date, "2026-10-17");
  assert.equal(p("x 3 Μαΐου").date, "2027-05-03");      // passed this year → next year
  assert.equal(p("x 15 Νοεμβρίου").date, "2026-11-15");
  assert.equal(p("x Nov 15th").date, "2026-11-15");
  assert.equal(p("x 31 December").date, "2026-12-31");
  assert.equal(p("x 15.11.2027").date, "2027-11-15");
  assert.equal(p("x 1/2/27").date, "2027-02-01");
  assert.equal(p("x 2026-12-20").date, "2026-12-20");
  assert.equal(p("x in 3 days").date, "2026-10-17");
  assert.equal(p("x σε 2 εβδομάδες").date, "2026-10-28");
  assert.equal(p("x 30/2").found.date, false);         // no such day
  assert.equal(p("call mom").date, TODAY);
  assert.equal(p("call mom").found.date, false);
});

test("quick add: times and ranges", () => {
  assert.deepEqual([p("x 18:00").start, p("x 18.30").start, p("x 9.05").start], ["18:00", "18:30", "09:05"]);
  assert.equal(p("x at 7").start, "07:00");
  assert.equal(p("x at 3").start, "15:00");            // a bare 1–6 is the afternoon
  assert.equal(p("x στις 9 το βράδυ").start, "21:00");
  assert.equal(p("x 7 το πρωί").start, "07:00");
  assert.equal(p("x 12pm").start, "12:00");
  assert.equal(p("x 12am").start, "00:00");
  assert.equal(p("x 6 μ.μ.").start, "18:00");
  assert.equal(p("x noon").start, "12:00");
  assert.equal(p("Room 4 cleanup").start, null);       // a bare number is not a time
  assert.equal(p("Room 4 cleanup").title, "Room 4 cleanup");
  let r = p("team call 6-8pm");
  assert.deepEqual([r.start, r.end], ["18:00", "20:00"]);
  r = p("x 11-1pm");
  assert.deepEqual([r.start, r.end], ["11:00", "13:00"]);
  r = p("x 10:00–11:30");
  assert.deepEqual([r.start, r.end], ["10:00", "11:30"]);
  r = p("x από 10 έως 12");
  assert.deepEqual([r.start, r.end], ["10:00", "12:00"]);
  r = p("workshop between 2 and 4");
  assert.deepEqual([r.start, r.end, r.title], ["14:00", "16:00", "workshop"]);
  r = p("late show Sat 23:00-01:00");
  assert.deepEqual([r.date, r.start, r.end, r.dateEnd], ["2026-10-17", "23:00", "01:00", "2026-10-18"]);
});

test("quick add: repeats", () => {
  assert.equal(p("x daily").recur.freq, "D");
  assert.equal(p("x καθημερινά").recur.freq, "D");
  assert.equal(p("x κάθε μήνα").recur.freq, "M");
  assert.equal(p("x yearly").recur.freq, "Y");
  assert.equal(p("x every 2 weeks").recur.interval, 2);
  assert.equal(p("x every other week").recur.interval, 2);
  assert.equal(p("x every 3 days").recur.every, 3);
  let r = p("standup every weekday 9:15");
  assert.deepEqual(r.recur.byday, [1, 2, 3, 4, 5]);
  assert.equal(r.date, TODAY);
  r = p("κάθε Δευτέρα και Τετάρτη γυμναστήριο στις 7 το πρωί");
  assert.deepEqual([r.title, r.date, r.start], ["γυμναστήριο", TODAY, "07:00"]);
  assert.deepEqual(r.recur.byday, [1, 3]);
  r = p("Μάθημα στις 18.30 τις Τρίτες");
  assert.deepEqual([r.title, r.date, r.start, r.recur.freq], ["Μάθημα", "2026-10-20", "18:30", "W"]);
  r = p("yoga every week on Sunday 10am");
  assert.deepEqual([r.date, r.recur.freq], ["2026-10-18", "W"]);
  // A weekly rule on a weekday other than the date given keeps the weekday.
  r = p("x every Monday from 2/11");
  assert.equal(r.date, "2026-11-02");
  // The rule is a valid Calendar rule.
  assert.ok(O.normRecur(p("x every Monday and Friday").recur, TODAY));
});

test("quick add: locations and titles", () => {
  assert.deepEqual(pick(p("Lunch at Nikos's place tomorrow 1pm")),
    { title: "Lunch", date: "2026-10-15", start: "13:00", end: null, location: "Nikos's place" });
  assert.equal(p("Party 31 December 21:00 @Gazi").location, "Gazi");
  assert.equal(p("Coffee at Starbucks at 6pm").location, "Starbucks");
  assert.equal(p("Coffee at Starbucks at 6pm").title, "Coffee");
  assert.equal(p("συνάντηση την άλλη Τρίτη 11:00-12:30 στο γραφείο").location, "γραφείο");
  assert.equal(p("Ραντεβού στη Θεσσαλονίκη αύριο").location, "Θεσσαλονίκη");
  assert.equal(p("Ραντεβού στη Θεσσαλονίκη αύριο").title, "Ραντεβού");
  assert.equal(p("").title, "");
  assert.equal(p("   ").date, TODAY);
  // Odd input never throws.
  ["at", "@", "στις", "every", "κάθε", "10-", "-12", "31/12/99999", "\u0000\u0007", "x".repeat(1000)].forEach((s) => p(s));
});

// ---------- Subscriptions ----------
test("subs: addresses", () => {
  assert.equal(S.normUrl("webcal://example.com/a.ics"), "https://example.com/a.ics");
  assert.equal(S.normUrl("WEBCALS://example.com/a.ics#x"), "https://example.com/a.ics");
  assert.equal(S.normUrl(" https://calendar.google.com/calendar/ical/x/basic.ics "), "https://calendar.google.com/calendar/ical/x/basic.ics");
  assert.equal(S.normUrl("http://example.com/a.ics"), "http://example.com/a.ics");
  assert.equal(S.normUrl("ftp://example.com/a.ics"), "");
  assert.equal(S.normUrl("javascript:alert(1)"), "");
  assert.equal(S.normUrl("https://user:pw@example.com/a.ics"), "");
  assert.equal(S.normUrl("example.com/a.ics"), "");
  assert.equal(S.hostName("https://www.example.com/x"), "example.com");
});

test("subs: sanitize (load and merge)", () => {
  const C = ["#a78bfa", "#7aa2f7"];
  const ok = { id: "sub1", url: "webcal://e.com/a.ics", name: " Team\u0007 ", color: "#a78bfa", mtime: 5 };
  assert.deepEqual(S.sanitizeSub(ok, C, true), { id: "sub1", url: "https://e.com/a.ics", name: "Team", color: "#a78bfa", mtime: 5 });
  assert.equal(S.sanitizeSub(Object.assign({}, ok, { color: "red" }), C, true), null);
  assert.equal(S.sanitizeSub(Object.assign({}, ok, { mtime: "x" }), C, true), null);
  assert.equal(S.sanitizeSub(Object.assign({}, ok, { mtime: "x" }), C, false).mtime, 0);
  assert.equal(S.sanitizeSub(Object.assign({}, ok, { id: "a b" }), C, true), null);
  assert.equal(S.sanitizeSub(Object.assign({}, ok, { url: "file:///etc" }), C, true), null);
  assert.equal(S.sanitizeSub(Object.assign({}, ok, { name: "n".repeat(99) }), C, true).name.length, 40);
});

const FEED = ["BEGIN:VCALENDAR", "VERSION:2.0", "X-WR-CALNAME:School\\, holidays",
  "BEGIN:VEVENT", "UID:w", "DTSTART:20261016T060000Z", "DTEND:20261016T070000Z", "SUMMARY:Standup", "RRULE:FREQ=WEEKLY",
  "BEGIN:VALARM", "TRIGGER:-PT15M", "ACTION:DISPLAY", "END:VALARM", "END:VEVENT",
  "BEGIN:VEVENT", "UID:t", "DTSTART;VALUE=DATE:20261026", "DTEND;VALUE=DATE:20261029", "SUMMARY:Trip", "END:VEVENT",
  "BEGIN:VEVENT", "UID:old", "DTSTART;VALUE=DATE:20200101", "SUMMARY:Long ago", "END:VEVENT",
  "BEGIN:VEVENT", "UID:ny", "DTSTART;TZID=America/New_York:20261020T200000", "DTEND;TZID=America/New_York:20261020T210000", "SUMMARY:NY call", "END:VEVENT",
  "END:VCALENDAR"].join("\r\n");

test("subs: a feed becomes cached events", () => {
  const r = S.fromIcs(FEED, TODAY, I);
  assert.equal(r.name, "School, holidays");
  assert.equal(r.total, 4);
  assert.deepEqual(r.events.map((e) => e.title), ["Standup", "NY call", "Trip"]);   // sorted by date, the old one dropped
  const st = r.events[0];
  assert.equal(st.start, "09:00");
  assert.equal(st.recur.freq, "W");
  assert.equal(st.remindMin, undefined);              // no reminders from feeds
  assert.equal(r.events[1].tz, "America/New_York");
  assert.equal(S.calName("BEGIN:VCALENDAR\r\nX-WR-CALNAME;VALUE=TEXT:Fixtures\r\n"), "Fixtures");
  assert.equal(S.calName("nothing"), "");
});

test("subs: day index and rows (zones applied)", () => {
  const evs = S.fromIcs(FEED, TODAY, I).events;
  const idx = S.index(evs, O);
  assert.deepEqual(Object.keys(idx.days).sort(), ["2026-10-21", "2026-10-26", "2026-10-27", "2026-10-28"]);  // NY 20:00 → 03:00 next day in Athens
  assert.equal(idx.rec.length, 1);
  const on = (d) => S.rowsOn(evs, idx, d, O).map((r) => r.ev.title + "@" + (r.inst.start || "allday"));
  assert.deepEqual(on("2026-10-23"), ["Standup@09:00"]);
  assert.deepEqual(on("2026-10-21"), ["NY call@03:00"]);
  assert.deepEqual(on("2026-10-27"), ["Trip@allday"]);
  assert.deepEqual(on("2026-10-22"), []);
});

test("subs: cache read back and refresh timing", () => {
  const c = S.cleanCache({ url: "https://e.com/a.ics", at: 10, ok: 10, err: 5, name: "N", total: 2, dropped: 0, n: 404,
    events: [{ id: "a", date: "2026-10-01", start: "25:00", title: "x" }, { id: 3, date: "x" }, null,
             { id: "b", date: "2026-10-02", dateEnd: "2026-10-01", start: "10:00", end: "11:00", tz: "<script>", recur: { freq: "Q" } }] });
  assert.equal(c.err, "");
  assert.equal(c.n, 404);
  assert.equal(c.events.length, 2);
  assert.equal(c.events[0].start, null);
  assert.deepEqual([c.events[1].dateEnd, c.events[1].tz, c.events[1].recur], [null, undefined, null]);
  assert.equal(S.cleanCache("x"), null);
  assert.equal(S.due(null, 1000, 10), true);
  assert.equal(S.due({ at: 995 }, 1000, 10), false);
  assert.equal(S.due({ at: 990 }, 1000, 10), true);
  assert.equal(S.due({ at: 2000 }, 1000, 10), true);    // clock went back
});

// ---------- Free times ----------
const own = [
  { id: "a", date: "2026-10-15", start: "10:00", end: "11:00", recur: null },              // Thu
  { id: "b", date: "2026-10-16", start: "09:00", end: null, recur: null },                 // Fri: no end = one hour
  { id: "c", date: "2026-10-15", start: null, recur: null, title: "birthday" },            // all day: not busy
  { id: "d", date: "2026-10-12", start: "16:00", end: "16:30", recur: { freq: "D", interval: 1, until: null, exdates: [] } },
  { id: "e", date: "2026-10-19", dateEnd: "2026-10-20", start: "22:00", end: "09:30", recur: null }   // Mon night → Tue
];

test("free: busy times", () => {
  const b = F.busy(own, "2026-10-15", "2026-10-20", O);
  assert.deepEqual(b["2026-10-15"], [[600, 660], [960, 990]]);
  assert.deepEqual(b["2026-10-16"], [[540, 600], [960, 990]]);
  assert.deepEqual(b["2026-10-19"], [[960, 990], [1320, 1440]]);
  assert.deepEqual(b["2026-10-20"], [[0, 570], [960, 990]]);
});

test("free: slots", () => {
  const s = F.slots(own, { from: "2026-10-15", days: 6, len: 30, dayStart: "09:00", dayEnd: "12:00" }, O);
  // Thu, Fri, Mon, Tue (Sat/Sun left out by default)
  assert.deepEqual(s.map((x) => x.d), ["2026-10-15", "2026-10-16", "2026-10-19", "2026-10-20"]);
  assert.deepEqual(s[0].m, [540, 570, 660, 690]);       // 10–11 busy
  assert.deepEqual(s[1].m, [600, 630, 660, 690]);       // 9–10 busy
  assert.deepEqual(s[3].m, [570, 600, 630, 660, 690]);  // until 09:30 busy
  const long = F.slots(own, { from: "2026-10-15", days: 1, len: 60, dayStart: "09:00", dayEnd: "12:00" }, O);
  assert.deepEqual(long[0].m, [540, 660]);              // 30-minute grid, an hour long
  const wk = F.slots(own, { from: "2026-10-17", days: 2, len: 30, dayStart: "09:00", dayEnd: "10:00", wdays: [0, 6] }, O);
  assert.deepEqual(wk.map((x) => x.d), ["2026-10-17", "2026-10-18"]);
  const now = F.slots([], { from: "2026-10-15", days: 1, len: 30, dayStart: "09:00", dayEnd: "12:00", nowMin: 625 }, O);
  assert.deepEqual(now[0].m, [630, 660, 690]);
  const gap = F.slots(own, { from: "2026-10-15", days: 1, len: 30, dayStart: "09:00", dayEnd: "12:00", gap: 15 }, O);
  assert.deepEqual(gap[0].m, [540, 690]);
  assert.equal(F.slots([], { from: "2026-10-15", days: 60, len: 15, dayStart: "00:00", dayEnd: "24:00", wdays: [0, 1, 2, 3, 4, 5, 6], max: 50 }, O)
    .reduce((n, x) => n + x.m.length, 0), 50);
  assert.deepEqual(F.slots([], { from: "2026-10-15", days: 1, len: 30, dayStart: "17:00", dayEnd: "09:00" }, O), []);
});

// ---------- Send to someone: "slots" ----------
const SL = { t: "Coffee chat", n: "Maria P", m: "maria@example.com", len: 30, tz: "Europe/Athens", l: "Syntagma",
  s: [{ d: "2026-10-15", m: [600, 540, 540, 2000, -1, 1.5] }, { d: "2026-10-15", m: [700] }, { d: "bad", m: [1] }, { d: "2026-10-14", m: [] }] };

test("slots kind: normalizer", () => {
  const d = K.norm("slots", SL);
  assert.deepEqual(d.s, [{ d: "2026-10-15", m: [540, 600] }]);
  assert.equal(d.m, "maria@example.com");
  assert.equal(d.tz, "Europe/Athens");
  assert.equal(K.norm("slots", Object.assign({}, SL, { len: 1 })), null);
  assert.equal(K.norm("slots", Object.assign({}, SL, { s: [] })), null);
  assert.equal(K.norm("slots", Object.assign({}, SL, { m: "not an email" })).m, undefined);
  assert.equal(K.norm("slots", Object.assign({}, SL, { tz: "../../x y" })).tz, undefined);
  const many = K.norm("slots", { len: 15, s: Array.from({ length: 80 }, (_, i) => ({ d: "2027-01-" + String(1 + (i % 31)).padStart(2, "0"), m: Array.from({ length: 200 }, (_, j) => j) })) });
  assert.ok(many.s.length <= 31);
  assert.ok(many.s.reduce((n, x) => n + x.m.length, 0) <= 1500);
  assert.equal(K.KINDS.indexOf("slots") >= 0, true);
});

test("slots kind: texts, no direct target, a round trip", async () => {
  const env = K.pack("slots", SL);
  assert.equal(K.summary(env, "en"), "Free times «Coffee chat» · 2 times to pick from");
  assert.match(K.summary(env, "el"), /^Ελεύθερες ώρες/);
  const txt = K.text(env, "en");
  assert.match(txt, /09:00, 10:00/);
  assert.match(txt, /maria@example\.com/);
  assert.equal(K.target(env, "en"), null);
  const code = await K.encode(env);
  const back = await K.decode(code);
  assert.deepEqual(back.env, env);
});

test("slots kind: the picked time in the receiver's zone, .ics and email", () => {
  const d = K.norm("slots", SL);
  // This test runs in Athens: the sender's own zone, nothing moves.
  let w = K.slotWhen(d, "2026-10-15", 540);
  assert.deepEqual([w.d, w.s, w.e, w.shifted], ["2026-10-15", "09:00", "09:30", false]);
  // Sent from New York: 20:00 there is 03:00 the next day here.
  w = K.slotWhen(Object.assign({}, d, { tz: "America/New_York" }), "2026-10-15", 1200);
  assert.deepEqual([w.d, w.s, w.e, w.shifted], ["2026-10-16", "03:00", "03:30", true]);
  // A time that ends after midnight.
  w = K.slotWhen(Object.assign({}, d, { tz: undefined }), "2026-10-15", 1425);
  assert.deepEqual([w.d, w.s, w.e, w.de], ["2026-10-15", "23:45", "00:15", "2026-10-16"]);
  const ev = K.slotEvent(d, "2026-10-15", 540, "en");
  assert.deepEqual([ev.t, ev.d, ev.s, ev.e, ev.l], ["Coffee chat", "2026-10-15", "09:00", "09:30", "Syntagma"]);
  assert.match(ev.x, /Maria P/);
  assert.match(ev.id, /^slot[0-9a-f]{8}$/);
  const ics = K.ics(ev);
  assert.match(ics, /DTSTART:20261015T090000/);
  assert.match(ics, /DTEND:20261015T093000/);
  const mail = K.slotMail(d, "2026-10-15", 540, "en");
  assert.match(mail, /^mailto:maria@example\.com\?subject=/);
  const body = decodeURIComponent(mail.split("&body=")[1]);
  assert.match(body, /^Hello Maria,/);
  assert.match(body, /09:00–09:30/);
  const ny = decodeURIComponent(K.slotMail(Object.assign({}, d, { tz: "America/New_York" }), "2026-10-15", 1200, "el").split("&body=")[1]);
  assert.match(ny, /ώρα America\/New_York/);
  assert.equal(K.slotMail(Object.assign({}, d, { m: undefined }), "2026-10-15", 540, "en"), "");
});
