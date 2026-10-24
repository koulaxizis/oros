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
