// Together: data model, sync rules and date math (together/core.js).
// Run: node --test tests/
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const C = require("../together/core.js");

const rel = (id, start, extra) => Object.assign({ id, start, people: [{ n: "Anna" }] }, extra || {});
const A = () => C.put(C.put(C.empty(), "rels", rel("r1", "2020-02-14"), 100), "rels", rel("r2", "2021-06-01", { people: [{ c: "ct1", n: "Old" }] }), 110);
const B = () => C.remove(C.put(A(), "rels", rel("r1", "2020-02-15"), 200), "rels", "r2", 210);

test("merge is symmetric and settles at once", () => {
  const ab = C.serialize(C.merge(A(), B())), ba = C.serialize(C.merge(B(), A()));
  assert.equal(ab, ba);
  assert.equal(C.serialize(C.merge(JSON.parse(ab), B())), ab);
  assert.equal(C.serialize(C.merge(B(), B())), C.serialize(B()));
  assert.equal(C.serialize(C.merge(C.empty(), C.empty())), C.serialize(C.empty()));
});

test("the newer edit wins, a tie goes to the larger JSON", () => {
  const m = C.merge(A(), B());
  assert.equal(C.find(m, "rels", "r1").start, "2020-02-15");
  const x = C.normalize({ rels: [rel("t", "2020-01-01", { m: 5, title: "a" })] });
  const y = C.normalize({ rels: [rel("t", "2020-01-01", { m: 5, title: "b" })] });
  assert.equal(C.find(C.merge(x, y), "rels", "t").title, "b");
  assert.equal(C.find(C.merge(y, x), "rels", "t").title, "b");
});

test("a delete wins over an older edit, a newer edit brings it back; children go with the relationship", () => {
  let d = C.put(A(), "moments", { id: "mo1", rel: "r2", date: "2022-01-01", title: "Trip" }, 120);
  d = C.put(d, "days", { id: "dy1", rel: "r2", date: "2021-07-01", title: "First kiss" }, 121);
  const del = C.remove(d, "rels", "r2", 300);
  assert.equal(C.find(del, "rels", "r2"), null);
  assert.equal(C.find(del, "moments", "mo1"), null);
  assert.equal(C.find(del, "days", "dy1"), null);
  assert.equal(C.find(C.merge(d, del), "moments", "mo1"), null);
  const edited = C.put(d, "rels", rel("r2", "2021-06-02"), 400);
  assert.equal(C.find(C.merge(del, edited), "rels", "r2").start, "2021-06-02");
});

test("put stamps only a real change (R27) and always past the old stamp", () => {
  const d = A();
  assert.equal(C.serialize(C.put(d, "rels", rel("r1", "2020-02-14"), 999)), C.serialize(d));
  const e = C.put(d, "rels", rel("r1", "2020-02-14", { title: "Us" }), 50);
  assert.equal(C.find(e, "rels", "r1").m, 101);
});

test("broken input is dropped, never repaired; paths must stay on the orOS disk", () => {
  const d = C.normalize({
    rels: [{ id: "x" }, null, { id: "bad id!", start: "2020-01-01" }, { id: "y", start: "2020-02-30" },
      { id: "z", start: "2020-01-01", cover: "/internal/../etc", people: [{}, { n: "Ann\u0000a" }], kind: "weird", pos: 400 }],
    tombs: { q: "bad" }, prefs: { hour: 99, kinds: { fun: false } }
  });
  assert.deepEqual(d.rels.map((r) => r.id), ["z"]);
  const z = d.rels[0];
  assert.equal(z.cover, "");
  assert.equal(z.kind, "couple");
  assert.equal(z.pos, 100);
  assert.deepEqual(z.people, [{ n: "Ann a" }]);
  assert.deepEqual(d.tombs, {});
  assert.equal(d.prefs.hour, 9);
  assert.equal(d.prefs.kinds.fun, false);
  assert.ok(C.okPath("/internal/Pictures/Together/a.jpg"));
  assert.ok(!C.okPath("/etc/passwd"));
  assert.ok(!C.okPath("https://x.example/a.jpg"));
});

test("prefs merge by stamp and stay symmetric", () => {
  const a = C.setPrefs(C.empty(), { me: "Chris" }, 100);
  const b = C.setPrefs(C.empty(), { live: false }, 200);
  assert.equal(C.serialize(C.merge(a, b)), C.serialize(C.merge(b, a)));
  assert.equal(C.merge(a, b).prefs.live, false);
  assert.equal(C.serialize(C.setPrefs(a, { me: "Chris" }, 900)), C.serialize(a));
});

test("months clamp to the end of the month; leap days", () => {
  assert.equal(C.addMonths("2020-01-31", 1), "2020-02-29");
  assert.equal(C.addMonths("2021-01-31", 1), "2021-02-28");
  assert.equal(C.addMonths("2020-02-29", 12), "2021-02-28");
  assert.equal(C.addMonths("2020-02-29", 48), "2024-02-29");
  assert.equal(C.monthsBetween("2020-01-31", "2020-02-29"), 1);
  assert.equal(C.monthsBetween("2020-01-31", "2020-02-28"), 0);
  assert.equal(C.daysBetween("2020-02-28", "2020-03-01"), 2);
});

test("elapsed: years, months, days and totals", () => {
  const r = { start: "2020-02-14", time: "" };
  const e = C.elapsed(r, "2024-10-24", new Date(2024, 9, 24, 12).getTime());
  assert.deepEqual([e.years, e.months, e.days], [4, 8, 10]);
  assert.equal(e.totalDays, C.daysBetween("2020-02-14", "2024-10-24"));
  assert.equal(e.totalWeeks, Math.floor(e.totalDays / 7));
  assert.equal(e.totalMonths, 56);
  assert.equal(e.future, false);
  const f = C.elapsed({ start: "2025-01-10", time: "" }, "2024-12-25", Date.now());
  assert.equal(f.future, true);
  assert.equal(f.totalDays, 16);
});

test("milestones: months, years, 100 days, 50 weeks and fun numbers in order", () => {
  const r = { start: "2024-01-31", time: "" };
  const ms = C.milestones(r, "2024-01-01", "2025-02-01");
  const pick = (k) => ms.filter((m) => m.kind === k);
  assert.deepEqual(pick("month").slice(0, 2).map((m) => m.date), ["2024-02-29", "2024-03-31"]);
  assert.deepEqual(pick("year").map((m) => [m.date, m.n]), [["2025-01-31", 1]]);
  assert.deepEqual(pick("d100").map((m) => m.n), [100, 200, 300]);
  assert.deepEqual(pick("w50").map((m) => m.n), [50]);
  assert.ok(pick("fun").some((m) => m.n === 123 && m.u === "d"));
  assert.ok(pick("fun").some((m) => m.n === 222 && m.u === "d"));
  assert.ok(!pick("month").some((m) => m.n === 12));
  const dates = ms.map((m) => m.date);
  assert.deepEqual(dates, dates.slice().sort());
  assert.ok(ms.every((m) => m.date > r.start));
});

test("milestones respect the kinds switched off; upcoming and recent", () => {
  const r = { start: "2020-02-14", time: "" };
  const only = C.milestones(r, "2020-01-01", "2030-01-01", { month: false, d100: false, w50: false, fun: false });
  assert.ok(only.every((m) => m.kind === "year"));
  assert.equal(only.length, 9);
  const up = C.upcoming(r, "2024-10-24", 5);
  assert.equal(up.length, 5);
  assert.ok(up[0].date >= "2024-10-24");
  const rec = C.recent(r, "2024-10-24", 3);
  assert.equal(rec.length, 3);
  assert.ok(rec[0].date < "2024-10-24" && rec[0].date >= rec[1].date);
  assert.deepEqual(C.upcoming({ start: "2030-01-01", time: "" }, "2024-10-24", 5), []);
});

test("fun time units carry the time of day", () => {
  const r = { start: "2020-01-01", time: "18:30" };
  const ms = C.milestones(r, "2020-01-01", "2032-01-01").filter((m) => m.kind === "fun" && m.u === "h");
  assert.equal(ms[0].n, 10000);
  const at = new Date(C.startMs(r) + 10000 * 3600000);
  assert.equal(ms[0].time, String(at.getHours()).padStart(2, "0") + ":" + String(at.getMinutes()).padStart(2, "0"));
});

test("names: contacts give the live name, discreet shows initials", () => {
  const idx = C.contactIndex({
    contacts: [{ id: "ct1", given: "Άννα", family: "Παππά", mtime: 5, events: [{ type: "birthday", day: "05-14", year: 1990 }] },
      { id: "ct2", given: "Gone", mtime: 1 }],
    deleted: [{ id: "ct2", mtime: 3 }]
  });
  assert.deepEqual(Object.keys(idx), ["ct1"]);
  const r = C.normalize({ rels: [rel("r", "2020-01-01", { people: [{ c: "ct1", n: "Old" }, { c: "ct2", n: "Kept" }] })] }).rels[0];
  assert.equal(C.relName(r, idx, ""), "Άννα Παππά & Kept");
  assert.equal(C.relName(r, idx, "Chris"), "Chris & Άννα Παππά & Kept");
  assert.equal(C.relName(Object.assign({}, r, { discreet: true }), idx, "Chris"), "C & ΆΠ & K");
  assert.deepEqual(C.birthdays(r, idx), [{ c: "ct1", name: "Άννα Παππά", day: "05-14", year: 1990 }]);
});

test("the PIN lock round-trips and refuses a wrong PIN", async () => {
  const rec = await C.makeLock(globalThis.crypto, "1234", 2000);
  assert.ok(C.readLock(rec));
  assert.equal(await C.checkPin(globalThis.crypto, rec, "1234"), true);
  assert.equal(await C.checkPin(globalThis.crypto, rec, "4321"), false);
  assert.equal(await C.checkPin(globalThis.crypto, rec, "12"), false);
  assert.equal(C.lockWait(4), 0);
  assert.equal(C.lockWait(5), 15);
});

test("the search provider skips deleted rows and hides discreet names", () => {
  const P = require("../together/search.js");
  let d = C.put(A(), "rels", rel("r3", "2022-01-01", { people: [{ n: "Maria Lopez" }], discreet: true }), 130);
  d = JSON.parse(C.serialize(C.merge(d, B())));
  const hits = P.search({ readJSON: (k) => (k === "oros-together-data" ? d : null) });
  assert.deepEqual(hits.map((h) => h.target.rel).sort(), ["r1", "r3"]);
  const r3 = hits.find((h) => h.id === "r3");
  assert.equal(r3.title, "ML");
  assert.ok(!/Maria/.test(r3.text));
});

test("wave 2: day rows for the Calendar, Today and the morning notice", () => {
  let d = C.put(C.empty(), "rels", rel("r", "2020-02-14", { people: [{ n: "Anna Maria" }] }), 1);
  d = C.put(d, "moments", { id: "m1", rel: "r", date: "2021-03-03", title: "Paris", yearly: true }, 2);
  d = C.put(d, "moments", { id: "m2", rel: "r", date: "2021-04-04", title: "Rome" }, 3);
  d = C.put(d, "days", { id: "d1", rel: "r", date: "2020-02-29", title: "Leap", yearly: true }, 4);
  d = C.put(d, "meets", { id: "e1", rel: "r", date: "2026-11-01", time: "18:00" }, 5);
  assert.deepEqual(C.dayRows(d, {}, "2025-02-14", "en").map((r) => r.title), ["Anna Maria · 5 years together"]);
  assert.deepEqual(C.dayRows(d, {}, "2025-02-14", "el").map((r) => r.title), ["Anna Maria · 5 χρόνια μαζί"]);
  assert.deepEqual(C.dayRows(d, {}, "2024-03-03", "en").map((r) => r.target), [{ rel: "r", moment: "m1" }]);
  assert.equal(C.dayRows(d, {}, "2024-03-03", "en")[0].title, "Paris · 3 years ago");
  assert.deepEqual(C.dayRows(d, {}, "2022-04-04", "en"), []);
  assert.equal(C.dayRows(d, {}, "2021-04-04", "en")[0].title, "Rome · Anna Maria");
  assert.equal(C.dayRows(d, {}, "2023-02-28", "en").filter((r) => r.kind === "day").length, 1);
  assert.equal(C.dayRows(d, {}, "2024-02-28", "en").filter((r) => r.kind === "day").length, 0);
  assert.equal(C.dayRows(d, {}, "2026-11-01", "en").filter((r) => r.kind === "meet")[0].time, "18:00");
  // months: only with opts.months (Today) or notify.month
  assert.equal(C.dayRows(d, {}, "2020-03-14", "en").length, 0);
  assert.equal(C.dayRows(d, {}, "2020-03-14", "en", { months: true })[0].title, "Anna Maria · 1 month together");
  assert.equal(C.dayRows(d, {}, "2020-03-14", "en", { notify: true }).length, 0);
  const d2 = C.setPrefs(d, { notify: { month: true, moments: false } }, 9);
  assert.equal(C.dayRows(d2, {}, "2020-03-14", "en", { notify: true }).length, 1);
  assert.equal(C.dayRows(d2, {}, "2024-03-03", "en", { notify: true }).length, 0);
  // discreet: initials, archived: nothing
  const disc = C.put(d, "rels", rel("r", "2020-02-14", { people: [{ n: "Anna Maria" }], discreet: true }), 10);
  assert.equal(C.dayRows(disc, {}, "2024-03-03", "en")[0].title, "P · 3 years ago");
  assert.equal(C.dayRows(disc, {}, "2025-02-14", "en")[0].title, "AM · 5 years together");
  const arch = C.put(d, "rels", rel("r", "2020-02-14", { people: [{ n: "Anna Maria" }], arch: true }), 11);
  assert.deepEqual(C.dayRows(arch, {}, "2025-02-14", "en"), []);
});

test("wave 2: special days roll over every year, moments newest first", () => {
  let d = C.put(C.empty(), "rels", rel("r", "2020-02-14"), 1);
  d = C.put(d, "days", { id: "a", rel: "r", date: "2020-12-01", title: "Kiss", yearly: true }, 2);
  d = C.put(d, "days", { id: "b", rel: "r", date: "2026-11-05", title: "Concert" }, 3);
  d = C.put(d, "days", { id: "c", rel: "r", date: "2025-01-01", title: "Gone" }, 4);
  const s = C.specialDays(d, "r", "2026-10-24");
  assert.deepEqual(s.map((x) => [x.day.id, x.next]), [["b", "2026-11-05"], ["a", "2026-12-01"], ["c", null]]);
  assert.deepEqual(C.specialDays(d, "r", "2026-12-02")[0].next, "2027-12-01");
  d = C.put(d, "moments", { id: "m1", rel: "r", date: "2021-01-01", title: "x" }, 5);
  d = C.put(d, "moments", { id: "m2", rel: "r", date: "2023-01-01", title: "y" }, 6);
  assert.deepEqual(C.momentsOf(d, "r").map((m) => m.id), ["m2", "m1"]);
  assert.equal(C.yearsOn("2020-02-29", "2021-02-28"), 1);
  assert.equal(C.yearsOn("2020-02-29", "2024-02-28"), 0);
  assert.equal(C.yearsOn("2020-05-05", "2020-05-05"), 0);
});

test("wave 2: the Today provider gives the feed's rows over the horizon", () => {
  globalThis.TogetherCore = C;
  const P = require("../together/today.js");
  const d = JSON.parse(C.serialize(C.put(C.empty(), "rels", rel("r", "2020-02-14"), 1)));
  const ctx = { today: "2026-02-13", horizon: 3, lang: "en", readJSON: (k) => (k === "oros-together-data" ? d : null),
    addDays: (ymd, n) => C.addDays(ymd, n) };
  const rows = P.collect(ctx);
  assert.ok(rows.some((r) => r.due === "2026-02-14" && r.title === "Anna · 6 years together" && r.kind === "event"));
  assert.deepEqual(rows.find((r) => r.due === "2026-02-14").target, { rel: "r" });
  delete globalThis.TogetherCore;
});

test("wave 3: gift ideas sync like the rest and go with their relationship", () => {
  let d = C.put(C.empty(), "rels", rel("r", "2020-02-14"), 1);
  d = C.put(d, "gifts", { id: "g1", rel: "r", text: "Book", done: false }, 2);
  d = C.put(d, "gifts", { id: "g2", rel: "r", text: "  " }, 3);
  assert.deepEqual(d.gifts.map((g) => g.id), ["g1"]);
  const done = C.put(d, "gifts", { id: "g1", rel: "r", text: "Book", done: true }, 10);
  assert.equal(C.serialize(C.merge(d, done)), C.serialize(C.merge(done, d)));
  assert.equal(C.find(C.merge(d, done), "gifts", "g1").done, true);
  assert.equal(C.find(C.remove(d, "rels", "r", 20), "gifts", "g1"), null);
  assert.equal(C.normalize({ prefs: { giftDays: 5 } }).prefs.giftDays, 7);
  assert.equal(C.normalize({ prefs: { giftDays: 14 } }).prefs.giftDays, 14);
});

test("wave 3: occasions and gift reminders", () => {
  const idx = C.contactIndex({ contacts: [{ id: "c1", given: "Anna", mtime: 1, events: [{ type: "birthday", day: "02-29", year: 1992 }] }] });
  let d = C.put(C.empty(), "rels", rel("r", "2020-06-10", { people: [{ c: "c1", n: "A" }] }), 1);
  const r = C.find(d, "rels", "r");
  assert.deepEqual(C.occasions(r, idx, "2027-01-01", "").map((o) => [o.kind, o.date, o.years]), [["bday", "2027-02-28", 35], ["anniv", "2027-06-10", 7]]);
  assert.equal(C.nextYearly("02-29", "2028-01-01"), "2028-02-29");
  // 7 days before (default) and on the day, only in notify mode
  assert.deepEqual(C.dayRows(d, idx, "2027-02-21", "en", { notify: true }).map((x) => x.kind), ["gift"]);
  assert.equal(C.dayRows(d, idx, "2027-02-21", "en", { notify: true })[0].title, "Anna: birthday in 7 days · time for a gift");
  assert.deepEqual(C.dayRows(d, idx, "2027-02-21", "en", { notify: true })[0].target, { rel: "r", gifts: true });
  assert.deepEqual(C.dayRows(d, idx, "2027-02-28", "en", { notify: true }).map((x) => x.kind), ["bday"]);
  assert.deepEqual(C.dayRows(d, idx, "2027-02-21", "en"), []);
  assert.equal(C.dayRows(d, idx, "2027-06-03", "en", { notify: true })[0].kind, "gift");
  const off = C.setPrefs(d, { giftDays: 0 }, 5);
  assert.deepEqual(C.dayRows(off, idx, "2027-02-21", "en", { notify: true }), []);
  const nob = C.setPrefs(d, { notify: { bdays: false } }, 5);
  assert.deepEqual(C.dayRows(nob, idx, "2027-02-28", "en", { notify: true }), []);
});

test("wave 3: Contacts takes { addEvent } and shows the Together button, Together takes { contact }", () => {
  const fs = require("fs");
  const ct = fs.readFileSync(__dirname + "/../contacts/contacts.js", "utf8");
  assert.ok(/target\.addEvent/.test(ct) && /__orosOpenAt\("together", \{ contact: c\.id \}\)/.test(ct));
  const app = fs.readFileSync(__dirname + "/../together/app.js", "utf8");
  assert.ok(/target\.contact/.test(app) && /"contacts", \{ addEvent:/.test(app) && /"todo", \{ addItems:/.test(app));
  assert.ok(/"notes", \{ add:/.test(app) && /__orosOpenBudgetNew\(\{ k: "o"/.test(app) && /__orosOpenCalendarNew\(\{ date:/.test(app));
});

test("wave 4: time zones and meetings", () => {
  assert.ok(C.okTz("Asia/Tokyo") && C.okTz("UTC") && !C.okTz("Mars/Base") && !C.okTz("asia/tokyo") && !C.okTz("../x"));
  assert.equal(C.tzOffset("Asia/Tokyo", Date.UTC(2026, 0, 1)), 540);
  assert.equal(C.tzOffset("America/New_York", Date.UTC(2026, 6, 1)), -240);
  assert.equal(C.zonedMs("2026-11-08", "18:00", "Asia/Tokyo"), Date.UTC(2026, 10, 8, 9, 0));
  assert.equal(C.zonedMs("2026-07-01", "08:30", "America/New_York"), Date.UTC(2026, 6, 1, 12, 30));
  assert.deepEqual(C.wallIn("Asia/Tokyo", Date.UTC(2026, 10, 8, 16, 5)), { ymd: "2026-11-09", hm: "01:05", wd: 1 });
  // the zone is kept on the relationship (shape only) and on meetings
  let d = C.put(C.empty(), "rels", rel("r", "2024-01-01", { tz: "Asia/Tokyo" }), 1);
  assert.equal(C.find(d, "rels", "r").tz, "Asia/Tokyo");
  assert.equal(C.normalize({ rels: [{ id: "x", m: 1, start: "2024-01-01", tz: "<b>" }] }).rels[0].tz, "");
  const now = Date.UTC(2026, 10, 1, 12, 0);
  d = C.put(d, "meets", { id: "m1", rel: "r", date: "2026-11-08", time: "18:00", tz: "Asia/Tokyo", place: "Narita" }, 2);
  d = C.put(d, "meets", { id: "m2", rel: "r", date: "2026-10-01", time: "", tz: "", place: "" }, 3);
  d = C.put(d, "meets", { id: "m3", rel: "r", date: "2026-12-24", time: "", tz: "", place: "" }, 4);
  const next = C.nextMeets(d, "r", now);
  assert.deepEqual(next.map((o) => o.meet.id), ["m1", "m3"]);
  assert.equal(next[0].at, Date.UTC(2026, 10, 8, 9, 0));
  assert.equal(C.pastMeets(d, "r", now), 1);
  assert.deepEqual(C.countdown(now, next[0].at), { d: 6, h: 21, min: 0 });
  assert.deepEqual(C.countdown(next[0].at + 5, next[0].at), { d: 0, h: 0, min: 0 });
  // removing the relationship removes its meetings
  assert.equal(C.remove(d, "rels", "r", 9).meets.length, 0);
});

test("wave 4: meetings in the Calendar feed use this device's day and time", () => {
  const tz = process.env.TZ;
  let d = C.put(C.empty(), "rels", rel("r", "2024-01-01"), 1);
  d = C.put(d, "meets", { id: "m1", rel: "r", date: "2026-11-08", time: "18:00", tz: "", place: "" }, 2);
  const rows = C.dayRows(d, {}, "2026-11-08", "en");
  assert.deepEqual(rows.filter((x) => x.kind === "meet").map((x) => [x.title, x.time]), [["Anna · together again", "18:00"]]);
  const loc = C.meetLocal({ date: "2026-11-08", time: "18:00", tz: "Asia/Tokyo" });
  const at = new Date(Date.UTC(2026, 10, 8, 9, 0));
  assert.equal(loc.hm, String(at.getHours()).padStart(2, "0") + ":" + String(at.getMinutes()).padStart(2, "0"));
  assert.equal(tz, process.env.TZ);
});

test("wave 4: fun numbers and big days", () => {
  const r = { start: "2026-10-01", time: "" };          // a Thursday
  const f = C.funFacts(r, "2026-10-24", new Date(2026, 9, 24).getTime(), null);
  assert.equal(f.sunrises, 24);
  assert.equal(f.weekends, 4);                          // 3, 10, 17, 24 October
  assert.equal(f.moons, null);
  assert.equal(f.km, Math.floor(23 * 86400 * 29.78));
  assert.deepEqual(C.funFacts(r, "2026-09-01", 0, null), { sunrises: 0, weekends: 0, moons: null, km: 0 });
  const S = require("../sky/core.js");
  // full moons of 2025: 13 Jan … 5 Dec = 12
  const y = C.funFacts({ start: "2025-01-01", time: "" }, "2026-01-01", Date.UTC(2026, 0, 1), S);
  assert.equal(y.moons, 12);
  const b = { start: "2020-02-14", time: "" };
  assert.ok(C.bigDay(b, "2020-02-14") && C.bigDay(b, "2021-02-14") && C.bigDay(b, "2020-05-24"));   // start, 1 year, 100 days
  assert.ok(!C.bigDay(b, "2021-02-15") && !C.bigDay(b, "2019-02-14"));
  assert.ok(!C.bigDay(b, "2021-02-14", { year: false }) && C.bigDay(b, "2020-03-14", { month: true }));
});

test("wave 4: backup file round trip, with and without a password; an import never deletes", async () => {
  const { webcrypto } = require("crypto");
  let d = C.put(C.empty(), "rels", rel("r", "2024-01-01"), 10);
  d = C.put(d, "moments", { id: "mo", rel: "r", date: "2024-05-01", title: "Paris" }, 11);
  d = C.remove(C.put(d, "gifts", { id: "g", rel: "r", text: "x" }, 12), "gifts", "g", 13);
  const plain = await C.packExport(webcrypto, d, "");
  assert.equal(JSON.parse(plain).format, "oros-together");
  assert.deepEqual(JSON.parse(plain).data.tombs, {});
  const back = await C.readExport(webcrypto, plain, "");
  assert.equal(C.serialize(C.merge(d, back.data)), C.serialize(d));
  const enc = await C.packExport(webcrypto, d, "secret", 2000);
  assert.ok(!/Paris/.test(enc));
  assert.deepEqual(await C.readExport(webcrypto, enc, ""), { error: "locked" });
  assert.deepEqual(await C.readExport(webcrypto, enc, "wrong"), { error: "pass" });
  const ok = await C.readExport(webcrypto, enc, "secret");
  assert.equal(C.find(ok.data, "moments", "mo").title, "Paris");
  assert.deepEqual(await C.readExport(webcrypto, "{\"format\":\"x\"}", ""), { error: "bad" });
  assert.deepEqual(await C.readExport(webcrypto, "not json", ""), { error: "bad" });
  // an old file brings nothing new and deletes nothing that was added since
  const later = C.put(d, "moments", { id: "mo2", rel: "r", date: "2025-05-01", title: "Rome" }, 20);
  assert.deepEqual(C.importCounts(later, back.data), { rels: 0, moments: 0, days: 0, meets: 0, gifts: 0 });
  assert.equal(C.serialize(C.merge(later, back.data)), C.serialize(later));
  assert.deepEqual(C.importCounts(C.empty(), back.data), { rels: 1, moments: 1, days: 0, meets: 0, gifts: 0 });
  // a row deleted here stays deleted when an older copy comes in
  const del = C.remove(d, "moments", "mo", 30);
  assert.equal(C.importCounts(del, back.data).moments, 0);
  assert.equal(C.find(C.merge(del, back.data), "moments", "mo"), null);
});

test("wave 4: Today card line and widget", () => {
  let d = C.put(C.empty(), "rels", rel("r", "2026-01-01"), 1);
  assert.deepEqual(C.todayLine(d, {}, "2026-01-11", "en"), { title: "Anna", text: "10 days together", target: { rel: "r" } });
  assert.equal(C.todayLine(d, {}, "2026-01-01", "el").text, "η πρώτη μέρα μαζί");
  assert.equal(C.todayLine(d, {}, "2025-12-31", "en"), null);
  const disc = C.put(d, "rels", rel("r", "2026-01-01", { discreet: true, people: [{ n: "Anna Maria" }] }), 2);
  assert.equal(C.todayLine(disc, {}, "2026-01-11", "en").title, "AM");
  global.TogetherCore = C;
  const P = require("../together/today.js");
  const rows = P.collect({ readJSON: () => d, today: "2026-01-11", horizon: 3, lang: "en", addDays: C.addDays });
  assert.deepEqual(rows[0], { id: "days", kind: "info", title: "Anna", text: "10 days together", target: { rel: "r" } });
  const L = require("../today/layout.js");
  assert.ok(L.ORDER.includes("together") && L.WIDGETS.together.app === "together");
  const out = L.distribute({ info: [{ app: "together", kind: "info", title: "Anna" }, { app: "weather", kind: "info", title: "Sun" }] }, ["top", "together"]);
  assert.deepEqual(out.together[0].rows.map((r) => r.title), ["Anna"]);
  assert.deepEqual(out.top[0].rows.map((r) => r.title), ["Sun"]);
});
