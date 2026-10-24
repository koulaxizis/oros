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
