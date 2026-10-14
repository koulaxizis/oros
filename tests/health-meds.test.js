// Health wave 2 (health/core.js): medicines, dose log, stock, refills,
// adherence, dose reminders, symptoms and their merge.
// Run: node --test tests/

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const C = require("../health/core.js");

const at = (d, h, m) => new Date(2026, 9, d, h, m || 0).getTime();   // October 2026, local
function data(parts) { return Object.assign(C.emptyData(), parts || {}); }
function med(id, extra) {
  return C.normMed(Object.assign({ id, m: 1000, n: "Med " + id, s: "10 mg", f: "tab", q: 100, k: "d",
    tm: [480, 1200], sd: "2026-10-01", ed: "", rm: 1, sk: -1, rw: 7, ar: 0, ca: 0, nt: "" }, extra || {}));
}
function dose(md, d, tm, s, extra) {
  return C.normDose(Object.assign({ id: C.doseKey(md, d, tm), m: 2000, md, d, tm, s, ta: C.slotAt(d, tm) }, extra || {}));
}

test("medicines: strict normalizer", () => {
  const m = med("ma", { n: "  Lisinopril  ", tm: [1200, 480, 480, 1300, -1, 2000] });
  assert.equal(m.n, "Lisinopril");
  assert.deepEqual(m.tm, [480, 1200, 1300], "times unique, valid, sorted");
  assert.equal(m.ev, 1, "every-N only for k n");
  assert.equal(m.sk, -1, "stock not tracked");
  assert.equal(med("mb", { k: "w", wd: 0 }).wd, 127, "empty weekday mask → every day");
  assert.equal(med("mb", { k: "n", ev: 1 }).ev, 2);
  assert.equal(med("mb", { k: "d", tm: [] }).k, "p", "no times → as needed");
  assert.deepEqual(med("mb", { k: "p", tm: [480] }).tm, [], "as needed has no times");
  assert.equal(med("mb", { ed: "2026-09-01" }).ed, "", "end before start dropped");
  assert.equal(med("mb", { f: "x" }).f, "tab");
  assert.equal(med("m-b"), null, "no dash in a medicine id (dose keys split on it)");
  assert.equal(med("m".repeat(21)), null, "id ≤ 20");
  assert.equal(med("mb", { n: " " }), null, "name required");
  assert.equal(med("mb", { sd: "2026-02-30" }), null, "real start date required");
  assert.equal(med("mb", { sk: 2000, sa: 5 }).sa, 5);
  assert.equal(med("mb", { sk: -5, sa: 5 }).sa, 0);
});

test("dose log: the id is the slot, strict states", () => {
  const ok = dose("ma", "2026-10-09", 480, "t");
  assert.equal(ok.id, "ma-20261009-0800");
  assert.equal(ok.q, 100);
  assert.equal(C.normDose(Object.assign({}, ok, { id: "ma-20261009-0801" })), null, "id must match its slot");
  assert.equal(C.normDose(Object.assign({}, ok, { s: "x" })), null);
  assert.equal(dose("ma", "2026-10-09", 480, "s").q, 0, "a skipped dose takes nothing");
  assert.equal(dose("ma", "2026-10-09", 480, "z", { zu: 7 }).zu, 7);
  const prn = C.normDose({ id: "ma-20261009-pab12", m: 1, md: "ma", d: "2026-10-09", tm: -1, s: "t", ta: 5, q: 50 });
  assert.equal(prn.q, 50);
  assert.equal(C.normDose(Object.assign({}, prn, { id: "ma-20261008-pab12" })), null, "as-needed id carries its day");
  assert.equal(C.normDose(Object.assign({}, prn, { s: "s" })), null, "as needed: only taken");
});

test("schedules: every day, weekdays, every N days, start and end", () => {
  const daily = med("ma", { sd: "2026-10-05", ed: "2026-10-07" });
  assert.deepEqual(C.slotsOn(daily, "2026-10-04"), []);
  assert.deepEqual(C.slotsOn(daily, "2026-10-05"), [480, 1200]);
  assert.deepEqual(C.slotsOn(daily, "2026-10-07"), [480, 1200]);
  assert.deepEqual(C.slotsOn(daily, "2026-10-08"), []);
  const mwf = med("mb", { k: "w", wd: 1 | 4 | 16, tm: [540] });     // Mon, Wed, Fri
  assert.deepEqual(C.slotsOn(mwf, "2026-10-12"), [540], "Monday");
  assert.deepEqual(C.slotsOn(mwf, "2026-10-13"), [], "Tuesday");
  assert.deepEqual(C.slotsOn(mwf, "2026-10-16"), [540], "Friday");
  const n3 = med("mc", { k: "n", ev: 3, tm: [600], sd: "2026-10-01" });
  assert.deepEqual(["2026-10-01", "2026-10-02", "2026-10-04", "2026-11-03"].map((d) => C.slotsOn(n3, d).length), [1, 0, 1, 1],
    "every 3 days, across a month and the DST change");
  assert.deepEqual(C.slotsOn(med("md", { k: "p" }), "2026-10-09"), []);
});

test("doses of a day: states taken / skipped / snoozed / upcoming / due / late / missed", () => {
  const d = data({ md: [med("ma")], dl: [dose("ma", "2026-10-08", 480, "t"), dose("ma", "2026-10-09", 480, "z", { zu: at(9, 9, 0) })] });
  const st = (day, now) => C.dosesOn(d, day, now).map((r) => r.state);
  assert.deepEqual(st("2026-10-08", at(9, 10)), ["taken", "missed"]);
  assert.deepEqual(st("2026-10-09", at(9, 8, 40)), ["snoozed", "upcoming"]);
  assert.deepEqual(st("2026-10-09", at(9, 9, 5)), ["late", "upcoming"], "the snooze ended");
  assert.deepEqual(st("2026-10-09", at(9, 20, 10)), ["late", "due"]);
  const pre = data({ md: [med("ma", { ca: at(9, 10) })] });
  assert.deepEqual(C.dosesOn(pre, "2026-10-09", at(9, 12)).map((r) => [r.state, r.pre]), [["due", true], ["upcoming", false]],
    "a dose from before the medicine was added is never late");
});

test("adherence: taken / counted, late counts once 30 minutes have passed", () => {
  const d = data({ md: [med("ma", { sd: "2026-10-07" }), med("mb", { tm: [600], sd: "2026-10-01", ed: "2026-10-07" })],
    dl: [dose("ma", "2026-10-07", 480, "t"), dose("ma", "2026-10-07", 1200, "t"), dose("ma", "2026-10-08", 480, "s"),
         dose("ma", "2026-10-09", 480, "t")] });
  const a = C.adherence(d, "ma", "2026-10-01", "2026-10-09", at(9, 12));
  assert.deepEqual([a.n, a.taken, a.skipped, a.missed], [5, 3, 1, 1], "20:00 of the 8th missed, 20:00 today not yet");
  assert.equal(a.pct, 3 / 5);
  assert.equal(C.adherence(d, "ma", "2026-10-09", "2026-10-09", at(9, 8, 20)).n, 1, "08:00 marked, 20:00 not due");
  const all = C.adherence(d, "", "2026-10-05", "2026-10-09", at(9, 12));
  assert.equal(all.n, 5 + 3, "mb: three days before its end");
  assert.equal(C.adherence(d, "nope", "2026-10-01", "2026-10-09", at(9, 12)).pct, null);
  const pre = data({ md: [med("ma", { ca: at(9, 10) })] });
  assert.equal(C.adherence(pre, "", "2026-10-01", "2026-10-09", at(9, 23)).n, 1, "doses before it was added are not missed");
});

test("stock: count + refills − doses since the count; days left; low warning once per refill", () => {
  const m = med("ma", { sk: 1000, sa: at(8, 12), rw: 3 });                      // 10 tablets, 2 a day
  const d = data({ md: [m], dl: [dose("ma", "2026-10-08", 480, "t"), dose("ma", "2026-10-08", 1200, "t"),
                                   dose("ma", "2026-10-09", 480, "t", { q: 50 }), dose("ma", "2026-10-09", 1200, "s")] });
  assert.equal(C.stockOf(d, m), 1000 - 100 - 50, "the dose before the count is not taken off; a half tablet is");
  assert.equal(C.perDay(m), 200);
  assert.equal(C.daysLeft(d, m), 4);
  assert.equal(C.runOutDay(d, m, at(9, 12)), "2026-10-13");
  assert.deepEqual(C.lowStock(d, at(9, 12)), [], "4 days > 3");
  d.dl.push(dose("ma", "2026-10-10", 480, "t"));
  const low = C.lowStock(d, at(10, 12));
  assert.equal(low.length, 1);
  assert.equal(low[0].days, 3);
  assert.equal(low[0].key, "low-ma-" + at(8, 12).toString(36));
  d.rf = [C.normRefill({ id: "r1", m: 1, md: "ma", at: at(10, 13), a: 3000 })];
  assert.equal(C.stockOf(d, m), 750 + 3000);
  assert.deepEqual(C.lowStock(d, at(10, 14)), []);
  assert.equal(C.normRefill({ id: "r2", m: 1, md: "ma", at: 1, a: 0 }), null);
  const w = med("mb", { k: "w", wd: 1, tm: [480], q: 100 });                   // weekly
  assert.equal(C.perDay(w), 100 / 7);
  assert.equal(C.daysLeft(data(), med("mc")), null, "not tracked");
  const prn = med("mp", { k: "p", q: 200, sk: 100, sa: 1 });
  assert.equal(C.lowStock(data({ md: [prn] }), at(9, 12)).length, 1, "as needed: less than one dose left");
  assert.deepEqual(C.lowStock(data({ md: [med("mq", { sk: 0, sa: 1, ar: 1 })] }), at(9, 12)), [], "stopped medicines never warn");
  const ended = med("me", { sk: 1000, sa: 1, ed: "2026-10-10" });
  assert.equal(C.runOutDay(data({ md: [ended] }), ended, at(9, 12)), "", "the course ends before the stock does");
});

test("dose reminders: 4-hour window, marks, snooze, stopped, reminder off, yesterday's late dose", () => {
  const d = data({ md: [med("ma"), med("mb", { rm: 0 }), med("mc", { ar: 1 }), med("mn", { tm: [1410] })] });
  assert.deepEqual(C.dueDoses(d, at(9, 7, 59)), []);
  assert.deepEqual(C.dueDoses(d, at(9, 8, 5)).map((r) => r.key), ["d-ma-20261009-0800"]);
  assert.deepEqual(C.dueDoses(d, at(10, 0, 30)).map((r) => r.key), ["d-mn-20261009-2330"], "23:30 still reminds after midnight");
  assert.deepEqual(C.dueDoses(d, at(9, 12, 0)), [], "window closed");
  d.dl = [dose("ma", "2026-10-09", 480, "z", { zu: at(9, 8, 15) })];
  assert.deepEqual(C.dueDoses(d, at(9, 8, 10)), [], "snoozed");
  assert.deepEqual(C.dueDoses(d, at(9, 8, 16)).map((r) => r.key), ["d-ma-20261009-0800-z" + at(9, 8, 15).toString(36)],
    "after the snooze: a new key, so it rings again");
  d.dl = [dose("ma", "2026-10-09", 480, "t")];
  assert.deepEqual(C.dueDoses(d, at(9, 8, 16)), [], "taken");
  const pre = data({ md: [med("ma", { ca: at(9, 8, 30) })] });
  assert.deepEqual(C.dueDoses(pre, at(9, 8, 40)), [], "never for a dose before the medicine was added");
});

test("as-needed doses taken in a period", () => {
  const p = (r, ta) => C.normDose({ id: "mp-20261009-p" + r, m: 1, md: "mp", d: "2026-10-09", tm: -1, s: "t", ta });
  const d = data({ dl: [p("b", at(9, 14)), p("a", at(9, 9)), dose("ma", "2026-10-09", 480, "t")] });
  assert.deepEqual(C.prnTaken(d, "mp", at(9, 0), at(10, 0)).map((l) => l.id), ["mp-20261009-pa", "mp-20261009-pb"]);
  assert.equal(C.prnTaken(d, "", at(9, 10), at(10, 0)).length, 1);
});

test("symptoms and symptom kinds", () => {
  const s = C.normSym({ id: "y1", m: 1, k: "ha", at: 5, i: 7, n: "after work", g: ["stress"] });
  assert.equal(s.i, 7);
  assert.equal(C.normSym({ id: "y1", m: 1, k: "ha", at: 5, i: 11 }), null, "1–10");
  assert.equal(C.normSym({ id: "y1", m: 1, k: "ha", at: 5, i: 2.5 }), null);
  assert.equal(C.normSymKind({ id: "ha", m: 1, n: "x", h: 1 }).n, "", "built-in: no own name");
  assert.equal(C.normSymKind({ id: "sabc", m: 1, n: "" }), null, "own kind needs a name");
  assert.equal(C.normSymKind({ id: "xabc", m: 1, n: "X" }), null, "own kinds start with s");
  const d = data({ sk: [C.normSymKind({ id: "szzz", m: 1, n: "Back pain" }), C.normSymKind({ id: "saaa", m: 1, n: "acne" })] });
  assert.deepEqual(C.symKindList(d).map((k) => k.id), C.SYM_BUILTIN.concat(["saaa", "szzz"]));
  assert.equal(C.symKindRow(d, "nope"), null);
});

test("merge: new collections are symmetric, idempotent, keep tombstones; the same dose from two devices is one row", () => {
  const A = data({ md: [med("ma")], dl: [dose("ma", "2026-10-09", 480, "t", { m: 3000, ta: at(9, 8, 5) })],
                   sy: [C.normSym({ id: "y1", m: 1, k: "ha", at: 5, i: 7 })] });
  const B = data({ md: [med("ma", { m: 1500, n: "Renamed" })], dl: [dose("ma", "2026-10-09", 480, "s", { m: 2500 })],
                   rf: [C.normRefill({ id: "r1", m: 1, md: "ma", at: 9, a: 3000 })], tombs: { "sy:y1": 1 } });
  const ab = C.merge(A, B), ba = C.merge(B, A);
  assert.equal(JSON.stringify(ab), JSON.stringify(ba), "symmetric");
  assert.equal(JSON.stringify(C.merge(ab, ab)), JSON.stringify(ab), "idempotent");
  assert.equal(ab.dl.length, 1, "one row per dose");
  assert.equal(ab.dl[0].s, "t", "the newer mark wins");
  assert.equal(ab.md[0].n, "Renamed");
  assert.equal(ab.rf.length, 1);
  assert.equal(ab.sy.length, 0, "tombstone wins the tie");
  assert.deepEqual(Object.keys(ab), ["ver", "en", "ty", "md", "dl", "rf", "sy", "sk", "set", "tombs"]);
  const old = C.merge({ en: [], ty: [], set: null, tombs: {} }, { en: [], ty: [], set: null, tombs: {} });
  assert.deepEqual(old.md, [], "older data loads with empty collections");
  const hostile = C.merge({ md: [{ id: "__proto__", m: 1, n: "x", sd: "2026-10-01" }, null], dl: [{ id: "x", m: 1 }],
                           tombs: { "md:ma": 5, "zz:a": 1 } }, null);
  assert.deepEqual(hostile.md, []);
  assert.deepEqual(hostile.tombs, { "md:ma": 5 });
});

test("Today provider: open doses of today as tasks, low stock as a top line, stopped medicines left out", () => {
  globalThis.OrosHealthCore = C;
  const P = require("../health/today.js");
  const raw = data({ md: [med("ma", { n: "Lisinopril", sk: 300, sa: 1, rw: 3 }), med("mb", { ar: 1 })],
                     dl: [dose("ma", "2026-10-09", 480, "t")] });
  const ctx = { readJSON: () => JSON.parse(JSON.stringify(raw)), today: "2026-10-09", lang: "el", now: at(9, 12) };
  const rows = P.collect(ctx);
  assert.deepEqual(rows.map((r) => [r.id, r.time, r.kind, r.title]), [
    ["dose@ma-20261009-2000", "20:00", "task", "Lisinopril 10 mg"],
    ["low@ma", null, "info", "Lisinopril 10 mg: φτάνει για περίπου μία μέρα"]
  ]);
  let opened = "";
  P.open({ meds: true }, { __orosOpenHealth: (k) => { opened = k; } });
  assert.equal(opened, "meds");
});

test("Calendar feed: first and last day of a course, the day the stock runs out; wired and opt-in", () => {
  const d = data({ md: [med("ma", { n: "Amoxicillin", sd: "2026-10-09", ed: "2026-10-15" }),
                        med("mb", { n: "Lisinopril", sk: 1000, sa: 1 }), med("mc", { n: "Stopped", sk: 100, sa: 1, ar: 1 })] });
  const on = (day) => C.calendarOn(d, day, at(9, 12)).map((r) => r.k + ":" + r.med.id);
  assert.deepEqual(on("2026-10-09"), ["start:ma"]);
  assert.deepEqual(on("2026-10-14"), ["out:mb"], "10 tablets, 2 a day");
  assert.deepEqual(on("2026-10-15"), ["end:ma"]);
  assert.deepEqual(on("2026-10-01"), ["start:mb", "start:mc"], "a stopped medicine keeps its course days");
  assert.deepEqual(on("2026-10-02"), []);
  assert.deepEqual(C.calendarOn(d, "bad", at(9, 12)), []);
  const fs = require("fs"), path = require("path");
  const cal = fs.readFileSync(path.join(__dirname, "../calendar/calendar.js"), "utf8");
  const idx = fs.readFileSync(path.join(__dirname, "../calendar/index.html"), "utf8");
  assert.ok(idx.includes('src="../health/core.js?v='));
  assert.ok(/OPT_IN_FEEDS = \[[^\]]*"lbl-feed-meds"/.test(cal), "opt-in");
  assert.ok(cal.includes(".concat(medsFeedOn(dateStr))"));
  assert.ok(cal.includes('_openAt: { app: "health", target: { med: r.med.id } }'));
});

test("schedule changes keep the past: earlier schedules by day, same-day marks stay", () => {
  const old = med("ma", { sd: "2026-10-01" });                                   // 08:00, 20:00
  const changed = med("ma", { tm: [540], m: 3000 });
  changed.ps = C.withHistory(old, changed, "2026-10-09");
  assert.deepEqual(changed.ps, [{ u: "2026-10-08", k: "d", tm: [480, 1200], wd: 127, ev: 1 }]);
  const n = C.normMed(changed);
  assert.deepEqual(C.slotsOn(n, "2026-10-08"), [480, 1200], "yesterday keeps its times");
  assert.deepEqual(C.slotsOn(n, "2026-10-09"), [540], "the new times from today");
  assert.deepEqual(C.withHistory(n, Object.assign({}, n, { tm: [600] }), "2026-10-09"), n.ps, "a second change the same day adds nothing");
  assert.deepEqual(C.withHistory(n, n, "2026-10-12"), n.ps, "no change, no history");
  assert.deepEqual(C.withHistory(med("mb", { sd: "2026-10-09" }), med("mb", { tm: [600] }), "2026-10-09"), [], "started today: nothing to keep");
  const d = data({ md: [n], dl: [dose("ma", "2026-10-09", 480, "t")] });
  const rows = C.dosesOn(d, "2026-10-09", at(9, 12));
  assert.deepEqual(rows.map((r) => [r.tm, r.state, r.extra]), [[480, "taken", true], [540, "late", false]],
    "this morning's dose at the old time still shows");
  assert.equal(C.adherence(d, "ma", "2026-10-08", "2026-10-09", at(9, 12)).n, 4);
  assert.equal(C.normMed(Object.assign({}, n, { ps: [{ u: "2026-09-01", k: "d", tm: [1] }, { u: "bad" }, 5] })).ps.length, 0,
    "entries before the start or malformed are dropped");
});
