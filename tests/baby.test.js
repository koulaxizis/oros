// Baby: the shared core (baby/core.js) — normalize, the sync merge
// (slice "baby"), breast-feed timers, day totals across midnight,
// ages, CSV, the paediatrician summary — plus a two-device round
// trip through the real sync engine (tests/harness.js).
// Run: node --test tests/
//
// Every date here is built in LOCAL time (new Date(y, m, d, h, min)),
// as the app derives an event's day from its timestamp.

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const C = require("../baby/core.js");
const { FakeDropbox, createDevice, readKey, writeKey } = require("./harness");

const at = (d, h, m, s) => new Date(2026, 9, d, h, m || 0, s || 0).getTime();   // October 2026
const key = (d) => "2026-10-" + String(d).padStart(2, "0");
const json = (x) => JSON.stringify(x);
const KID = "kid0001";
const kid = (id, extra) => Object.assign({ id: id || KID, n: "Anna", b: "2026-06-15", s: "f", c: 1, m: 1 }, extra || {});
const ev = (id, t, ts, extra) => Object.assign({ id, k: KID, t, ts, m: ts }, extra || {});
function model(evs, extra) {
  return C.normalize(Object.assign({ ver: 1, kids: [kid()], ev: evs || [], gr: [], mk: [] }, extra || {}));
}

// ---------------------------------------------------------------
// Normalize
// ---------------------------------------------------------------

test("normalize: bad rows dropped, fields kept per type, sorted by id", () => {
  const d = model([
    ev("zzzzzz1", "bottle", at(1, 9), { ml: 120, x: "fm", ls: 50, tx: "  warm\n milk " }),
    ev("aaaaaa1", "diaper", at(1, 8), { x: "wd", ml: 3 }),
    ev("bbbbbb1", "diaper", at(1, 8), { x: "huge" }),                 // unknown kind
    ev("bbbbbb2", "bottle", at(1, 8), { ml: 900 }),                   // ml out of range
    ev("bbbbbb3", "teleport", at(1, 8)),                              // unknown type
    ev("bbbbbb4", "med", at(1, 8), { tx: "   " }),                    // medicine needs a name
    ev("bbbbbb5", "sleep", at(1, 8), { e: at(1, 7) }),                // end before start → running
    ev("bbbbbb6", "temp", at(1, 8), { v: 512 }),                      // 51.2 °C
    { id: "bad id!", k: KID, t: "note", ts: at(1, 8), tx: "x", m: 1 },
    { id: "dddddd1", m: 7, del: 1, k: KID, t: "note" }                // tombstone keeps id + m only
  ]);
  assert.deepEqual(d.ev.map((e) => e.id), ["aaaaaa1", "bbbbbb5", "dddddd1", "zzzzzz1"]);
  assert.deepEqual(d.ev[0], { id: "aaaaaa1", k: KID, t: "diaper", ts: at(1, 8), x: "wd", m: at(1, 8) });
  assert.deepEqual(d.ev[1], { id: "bbbbbb5", k: KID, t: "sleep", ts: at(1, 8), m: at(1, 8) });
  assert.deepEqual(d.ev[2], { id: "dddddd1", m: 7, del: 1 });
  assert.deepEqual(d.ev[3], { id: "zzzzzz1", k: KID, t: "bottle", ts: at(1, 9), ml: 120, x: "fm", tx: "warm milk", m: at(1, 9) });
  assert.deepEqual(d.prefs, C.DEFAULT_PREFS);
  assert.equal(d.ver, 1);
});

test("normalize: kids need a name and a real birth date; text is capped", () => {
  const d = C.normalize({
    kids: [kid("kid0001", { n: "x".repeat(80) }), kid("kid0002", { b: "2026-02-30" }), kid("kid0003", { n: " " }),
           kid("kid0004", { s: "?", c: 9 })],
    ev: [], gr: [], mk: []
  });
  assert.deepEqual(d.kids.map((k) => k.id), ["kid0001", "kid0004"]);
  assert.equal(d.kids[0].n.length, C.LIM.name);
  assert.equal(d.kids[1].s, "");
  assert.equal(d.kids[1].c, 0);
});

test("normalize: a seed milestone must carry its deterministic id", () => {
  const d = model([], {
    mk: [
      { id: C.msId(KID, "smile"), k: KID, t: "ms", key: "smile", d: "2026-08-01", m: 1 },
      { id: "random01", k: KID, t: "ms", key: "smile", d: "2026-08-02", m: 1 },        // second "first smile"
      { id: "custom01", k: KID, t: "ms", tx: "Says mama", d: "2026-09-01", nt: "loud", m: 1 },
      { id: "vac00001", k: KID, t: "vac", tx: "", d: "2026-09-01", m: 1 }              // no name
    ]
  });
  assert.deepEqual(d.mk.map((x) => x.id), ["custom01", C.msId(KID, "smile")]);
});

test("normalize: growth needs at least one measure in range", () => {
  const d = model([], {
    gr: [
      { id: "gr00001", k: KID, d: "2026-09-01", g: 5200, l: 590, h: 99, m: 1 },        // head out of range
      { id: "gr00002", k: KID, d: "2026-09-01", g: 20, m: 1 }                          // nothing valid
    ]
  });
  assert.deepEqual(d.gr, [{ id: "gr00001", k: KID, d: "2026-09-01", g: 5200, l: 590, m: 1 }]);
});

test("parse: missing → empty model, unreadable → null (the app keeps a rescue copy)", () => {
  assert.deepEqual(C.parse(null), C.empty());
  assert.equal(C.parse("{oops"), null);
  assert.equal(C.parse(json({ kids: "no" })), null);
  assert.equal(json(C.parse(json(model([ev("aaaaaa1", "bath", at(1, 9))])))), json(model([ev("aaaaaa1", "bath", at(1, 9))])));
});

// ---------------------------------------------------------------
// Merge
// ---------------------------------------------------------------

test("merge: symmetric, idempotent, canonical (R5, R26)", () => {
  const A = model([ev("aaaaaa1", "diaper", at(2, 8), { x: "w" }), ev("cccccc1", "bottle", at(2, 9), { ml: 90 })]);
  const B = model([ev("bbbbbb1", "diaper", at(2, 8, 1), { x: "d" }), ev("cccccc1", "bottle", at(2, 9), { ml: 120, m: at(2, 10) })]);
  const ab = C.mergeBaby(A, B), ba = C.mergeBaby(B, A);
  assert.equal(json(ab), json(ba));
  assert.equal(json(C.mergeBaby(ab, ab)), json(ab));
  assert.equal(ab.ev.length, 3);
  assert.equal(C.findIn(ab.ev, "cccccc1").ml, 120, "newer edit wins");
});

test("merge: a delete beats an equal-stamp edit, a newer edit resurrects (R17)", () => {
  const A = model([ev("aaaaaa1", "bath", at(2, 8), { m: 50 })]);
  const B = model([{ id: "aaaaaa1", m: 50, del: 1 }]);
  assert.equal(C.mergeBaby(A, B).ev[0].del, 1);
  const A2 = model([ev("aaaaaa1", "bath", at(2, 8), { m: 51 })]);
  assert.equal(C.mergeBaby(A2, B).ev[0].del, undefined);
});

test("merge: prefs travel whole, newer pm wins", () => {
  const A = Object.assign(model([]), { prefs: { wu: "lb", tu: "c", vu: "ml" }, pm: 5 });
  const B = Object.assign(model([]), { prefs: { wu: "kg", tu: "f", vu: "oz" }, pm: 9 });
  assert.deepEqual(C.mergeBaby(A, B).prefs, { wu: "kg", tu: "f", vu: "oz" });
  assert.equal(C.mergeBaby(B, A).pm, 9);
});

test("merge: the same seed milestone ticked on two devices is one record", () => {
  const id = C.msId(KID, "tooth");
  const A = model([], { mk: [{ id, k: KID, t: "ms", key: "tooth", d: "2026-10-01", m: 10 }] });
  const B = model([], { mk: [{ id, k: KID, t: "ms", key: "tooth", d: "2026-10-02", m: 12 }] });
  const m = C.mergeBaby(A, B);
  assert.equal(m.mk.length, 1);
  assert.equal(m.mk[0].d, "2026-10-02");
});

// ---------------------------------------------------------------
// Breast-feed timer
// ---------------------------------------------------------------

test("feed timer: start, switch side, pause, resume, stop", () => {
  const t0 = at(3, 10);
  let f = C.normEv(Object.assign(C.feedStart(KID, "l", t0, "feed001"), { m: 1 }));
  assert.deepEqual(C.feedSecs(f, t0 + 90000), { l: 90, r: 0 });
  f = C.normEv(Object.assign(C.feedSide(f, "r", t0 + 300000), { m: 2 }));      // 5 min left
  assert.equal(f.ls, 300);
  assert.equal(f.cur, "r");
  assert.equal(f.sd, "r");
  f = C.normEv(Object.assign(C.feedPause(f, t0 + 420000), { m: 3 }));          // 2 min right
  assert.equal(f.cur, undefined);
  assert.deepEqual(C.feedSecs(f, t0 + 999999), { l: 300, r: 120 }, "paused: the clock stands still");
  f = C.normEv(Object.assign(C.feedSide(f, "r", t0 + 600000), { m: 4 }));
  f = C.normEv(Object.assign(C.feedStop(f, t0 + 660000), { m: 5 }));
  assert.deepEqual([f.ls, f.rs, f.e, f.cur, f.cs], [300, 180, t0 + 660000, undefined, undefined]);
});

test("feed timer: next side is the other one from the last feed", () => {
  const d = model([ev("feed001", "feed", at(3, 6), { e: at(3, 6, 20), ls: 600, rs: 300, sd: "r" })]);
  assert.equal(C.nextSide(d, KID, at(3, 9)), "l");
  assert.equal(C.nextSide(model([]), KID, at(3, 9)), "l");
  const d2 = model([ev("feed001", "feed", at(3, 6), { e: at(3, 6, 20), ls: 600, rs: 0, sd: "l" })]);
  assert.equal(C.nextSide(d2, KID, at(3, 9)), "r");
});

test("feed timer: stopped on another device while this one still runs it", () => {
  const t0 = at(3, 10);
  const run = C.normEv(Object.assign(C.feedStart(KID, "l", t0, "feed001"), { m: t0 }));
  const stopped = C.normEv(Object.assign(C.feedStop(run, t0 + 600000), { m: t0 + 600000 }));
  const A = model([run]), B = model([stopped]);
  const m = C.mergeBaby(A, B);
  assert.equal(json(m), json(C.mergeBaby(B, A)));
  assert.equal(m.ev[0].e, t0 + 600000);
  assert.equal(C.running(m, KID).length, 0);
});

// ---------------------------------------------------------------
// Day maths
// ---------------------------------------------------------------

test("day totals: feeds, bottles, nappies, pump", () => {
  const d = model([
    ev("aaaaaa1", "feed", at(4, 6), { e: at(4, 6, 25), ls: 600, rs: 900 }),
    ev("aaaaaa2", "bottle", at(4, 9), { ml: 120 }),
    ev("aaaaaa3", "bottle", at(4, 13), { ml: 90, x: "fm" }),
    ev("aaaaaa4", "diaper", at(4, 9), { x: "w" }),
    ev("aaaaaa5", "diaper", at(4, 11), { x: "wd" }),
    ev("aaaaaa6", "diaper", at(4, 15), { x: "d" }),
    ev("aaaaaa7", "pump", at(4, 16), { ml: 80, sd: "l" }),
    ev("aaaaaa8", "solid", at(4, 12), { tx: "carrot" }),
    ev("aaaaaa9", "bottle", at(5, 0, 5), { ml: 60 })              // next day
  ]);
  const t = C.dayTotals(d, KID, key(4), at(6, 0));
  assert.deepEqual(t, { feeds: 3, breastMin: 25, bottles: 2, bottleMl: 210, solids: 1,
    sleepMin: 0, nightMin: 0, naps: 0, wet: 2, dirty: 2, pumpMl: 80 });
});

test("day totals: a sleep across midnight counts on both days, night share 19-07", () => {
  const d = model([
    ev("sleep01", "sleep", at(4, 21), { e: at(5, 5) }),            // 8 h, all night
    ev("sleep02", "sleep", at(5, 13), { e: at(5, 14, 30) })        // nap
  ]);
  const d4 = C.dayTotals(d, KID, key(4), at(6, 0));
  const d5 = C.dayTotals(d, KID, key(5), at(6, 0));
  assert.deepEqual([d4.sleepMin, d4.nightMin, d4.naps], [180, 180, 1]);
  assert.deepEqual([d5.sleepMin, d5.nightMin, d5.naps], [300 + 90, 300, 1]);
  assert.equal(C.dayEvents(d, KID, key(5)).length, 2, "the midnight sleep shows on the next day too");
});

test("day totals: a running sleep counts up to now", () => {
  const d = model([ev("sleep01", "sleep", at(4, 13))]);
  assert.equal(C.isAsleep(d, KID), true);
  assert.equal(C.dayTotals(d, KID, key(4), at(4, 14)).sleepMin, 60);
});

test("averages: full days before today, from the first entry on", () => {
  const d = model([
    ev("aaaaaa1", "diaper", at(2, 9), { x: "w" }),
    ev("aaaaaa2", "diaper", at(3, 9), { x: "w" }),
    ev("aaaaaa3", "diaper", at(3, 10), { x: "w" }),
    ev("aaaaaa4", "diaper", at(4, 10), { x: "w" })                // today: not counted
  ]);
  const a = C.averages(d, KID, key(4), 7, at(4, 12));
  assert.equal(a.days, 2);
  assert.equal(a.wet, 1.5);
  assert.equal(C.averages(model([]), KID, key(4), 7, at(4, 12)), null);
});

test("day spans: fractions of the day for the 24-hour strip", () => {
  const d = model([ev("sleep01", "sleep", at(4, 0), { e: at(4, 6) }), ev("bott001", "bottle", at(4, 12), { ml: 90 })]);
  const s = C.daySpans(d, KID, key(4), at(5, 0));
  assert.deepEqual(s[0], { t: "sleep", a: 0, b: 0.25 });
  assert.equal(s[1].t, "feed");
  assert.equal(s[1].a, 0.5);
});

// ---------------------------------------------------------------
// Age + formatting
// ---------------------------------------------------------------

test("age: calendar months, short months clamp the day", () => {
  assert.deepEqual(C.age("2026-01-31", "2026-02-28"), { days: 28, months: 1, rest: 0 });   // month-end birthday
  assert.deepEqual(C.age("2026-01-31", "2026-03-01"), { days: 29, months: 1, rest: 1 });
  assert.deepEqual(C.age("2026-06-15", "2026-10-15"), { days: 122, months: 4, rest: 0 });
  assert.equal(C.fmtAge("2026-10-01", "2026-10-01", "en"), "Newborn");
  assert.equal(C.fmtAge("2026-10-01", "2026-10-06", "el"), "5 ημερών");
  assert.equal(C.fmtAge("2026-09-01", "2026-10-02", "en"), "4 wk 3 d");
  assert.equal(C.fmtAge("2026-06-15", "2026-10-15", "el"), "4 μηνών");
  assert.equal(C.fmtAge("2026-06-15", "2026-10-20", "en"), "4 mo 5 d");
  assert.equal(C.fmtAge("2024-06-15", "2026-08-15", "en"), "2 yr 2 mo");
  assert.equal(C.fmtAge("2026-12-01", "2026-10-15", "en"), "Due");
});

test("format: durations, timers, units", () => {
  assert.equal(C.fmtDur(45), "45′");
  assert.equal(C.fmtDur(75), "1:15");
  assert.equal(C.fmtTimer(65), "1:05");
  assert.equal(C.fmtTimer(3725), "1:02:05");
  const p = C.DEFAULT_PREFS;
  assert.equal(C.fmtWeight(5230, p, "en"), "5.23 kg");
  assert.equal(C.fmtWeight(5230, { wu: "lb" }, "en"), "11 lb 8 oz");
  assert.equal(C.fmtTemp(375, p, "el"), "37,5 °C");
  assert.equal(C.fmtTemp(375, { tu: "f" }, "en"), "99.5 °F");
  assert.equal(C.fmtLen(612, "en"), "61.2 cm");
});

// ---------------------------------------------------------------
// Export
// ---------------------------------------------------------------

test("CSV: time order, deleted kids and tombstones left out, injection guarded", () => {
  const d = model([
    ev("bbbbbb1", "note", at(2, 9, 5), { tx: "=HYPERLINK(\"x\")" }),
    ev("aaaaaa1", "feed", at(2, 8), { e: at(2, 8, 20), ls: 600, rs: 540, sd: "r" }),
    { id: "cccccc1", m: 3, del: 1 },
    { id: "dddddd1", k: "kid0002", t: "bath", ts: at(2, 7), m: 1 }
  ], { kids: [kid(), { id: "kid0002", m: 9, del: 1 }] });
  assert.equal(C.toCsv(d),
    "child,type,start,end,minutes,left_min,right_min,ml,detail,note\r\n" +
    "Anna,feed,2026-10-02 08:00,2026-10-02 08:20,20,10,9,,r,\r\n" +
    "Anna,note,2026-10-02 09:05,,,,,,,\"'=HYPERLINK(\"\"x\"\")\"\r\n");
});

test("growth CSV: age in days", () => {
  const d = model([], { gr: [{ id: "gr00001", k: KID, d: "2026-07-15", g: 4100, m: 1 }] });
  assert.equal(C.growthCsv(d), "child,date,age_days,weight_g,length_mm,head_mm\r\nAnna,2026-07-15,30,4100,,\r\n");
});

test("summary: averages, latest growth, milestones, both languages", () => {
  const d = model([
    ev("aaaaaa1", "diaper", at(3, 9), { x: "w" }),
    ev("aaaaaa2", "bottle", at(3, 10), { ml: 100 })
  ], {
    gr: [{ id: "gr00001", k: KID, d: "2026-09-01", g: 5000, m: 1 }, { id: "gr00002", k: KID, d: "2026-10-01", g: 5600, l: 610, m: 1 }],
    mk: [{ id: C.msId(KID, "smile"), k: KID, t: "ms", key: "smile", d: "2026-08-01", m: 1 }]
  });
  const en = C.summary(d, KID, key(4), "en", at(4, 12));
  assert.match(en, /^Anna · summary for the paediatrician/);
  assert.match(en, /Weight 5\.60 kg \(2026-10-01\)/);
  assert.match(en, /Length 61\.0 cm/);
  assert.match(en, /2026-08-01 First smile/);
  assert.match(en, /Nappies: 1\.0 wet/);
  const el = C.summary(d, KID, key(4), "el", at(4, 12));
  assert.match(el, /Πρώτο χαμόγελο/);
  assert.equal(C.summary(d, "nobody1", key(4), "en", at(4, 12)), "");
});

// ---------------------------------------------------------------
// Two devices through the real sync engine
// ---------------------------------------------------------------

test("sync: two parents log offline, one stops the other's timer, then nothing re-uploads", async () => {
  const db = new FakeDropbox();
  const A = await createDevice(db, "A");
  const B = await createDevice(db, "B");
  const reg = (dev) => dev.sync.registerSlice("baby",
    () => C.normalize(readKey(dev, C.STORAGE_KEY)),
    (data) => writeKey(dev, C.STORAGE_KEY, C.mergeBaby(readKey(dev, C.STORAGE_KEY), data)),
    C.STORAGE_KEY, C.mergeBaby);
  reg(A); reg(B);

  writeKey(A, C.STORAGE_KEY, model([ev("sleep01", "sleep", at(5, 20))]));   // A starts a sleep
  A.sync.markDirty();
  await A.sync.push();
  await B.sync.pull();
  assert.equal(C.isAsleep(readKey(B, C.STORAGE_KEY), KID), true, "B sees the running sleep");

  const edit = (dev, fn) => {
    const cur = readKey(dev, C.STORAGE_KEY);
    fn(cur);
    writeKey(dev, C.STORAGE_KEY, C.normalize(cur));
    dev.sync.markDirty();
  };
  edit(A, (d) => d.ev.push(ev("diapera", "diaper", at(5, 21), { x: "w" })));
  edit(B, (d) => {
    const s = C.findIn(d.ev, "sleep01");
    s.e = at(5, 23); s.m = at(5, 23);                                         // B stops it
    d.ev.push(ev("bottleb", "bottle", at(5, 23, 5), { ml: 90 }));
  });
  await A.sync.push();
  await B.sync.push();          // stale: refused, merged, retried
  await A.sync.pull();

  const a = readKey(A, C.STORAGE_KEY), b = readKey(B, C.STORAGE_KEY);
  assert.equal(json(a), json(b));
  assert.equal(a.ev.length, 3);
  assert.equal(C.isAsleep(a, KID), false);
  assert.equal(C.dayTotals(a, KID, key(5), at(6, 0)).sleepMin, 180);

  assert.equal(A.sync.isDirty(), false, "A: nothing left to push once converged");
  assert.equal(B.sync.isDirty(), false, "B: nothing left to push once converged");
  await B.sync.pull();
  assert.equal(B.sync.isDirty(), false, "a pull of the same state marks nothing dirty");
});

// ---------------------------------------------------------------
// Phase 2: reminders (device-local settings) + Calendar feed rows
// ---------------------------------------------------------------

test("reminders: settings are read strictly, off by default", () => {
  assert.deepEqual(C.readRem(null), { feed: 0, med: "", mt: "" });
  assert.deepEqual(C.readRem({ feed: 181, med: "25:00", mt: 5 }), { feed: 0, med: "", mt: "" });
  assert.deepEqual(C.readRem({ feed: 180, med: "07:30", mt: " Vitamin\nD " }), { feed: 180, med: "07:30", mt: "Vitamin D" });
  assert.equal(C.remOn(C.readRem({})), false);
  assert.equal(C.remOn(C.readRem({ med: "08:00" })), true);
  const d = model([ev("feed001", "bottle", at(5, 6), { ml: 90 })]);
  assert.deepEqual(C.reminderDue(d, {}, at(5, 23)), []);            // nothing is on
});

test("reminders: feed is due once per gap, never while feeding or after a day", () => {
  const rem = { feed: 180 };
  const base = [ev("feed001", "feed", at(5, 6), { e: at(5, 6, 20), ls: 600 })];
  assert.deepEqual(C.reminderDue(model(base), rem, at(5, 8, 59)), []);
  const due = C.reminderDue(model(base), rem, at(5, 9, 10));
  assert.equal(due.length, 1);
  assert.equal(due[0].kind, "feed");
  assert.equal(due[0].key, "feed-" + KID + "-feed001");
  // the key stays the same for the whole gap (one notification)
  assert.equal(C.reminderDue(model(base), rem, at(5, 11))[0].key, due[0].key);
  const txt = C.reminderText(due[0], rem, "en", at(5, 9, 10));
  assert.equal(txt.title, "Feed time?");
  assert.equal(txt.body, "Anna: last feed 3 h 10 min ago, at 06:00.");
  assert.equal(C.reminderText(due[0], rem, "el", at(5, 9)).body, "Anna: τελευταίο τάισμα πριν από 3 ώρ., στις 06:00.");
  // a new bottle starts a new gap with a new key
  const more = base.concat([ev("feed002", "bottle", at(5, 9, 30), { ml: 100 })]);
  assert.deepEqual(C.reminderDue(model(more), rem, at(5, 10)), []);
  assert.equal(C.reminderDue(model(more), rem, at(5, 12, 31))[0].key, "feed-" + KID + "-feed002");
  // a breastfeed still running → silent
  const running = base.concat([ev("feed003", "feed", at(5, 9, 0), { cur: "l", cs: at(5, 9) })]);
  assert.deepEqual(C.reminderDue(model(running), rem, at(5, 12, 30)), []);
  // stale: no feed logged for more than a day → silent; none at all → silent
  assert.deepEqual(C.reminderDue(model(base), rem, at(6, 7)), []);
  assert.deepEqual(C.reminderDue(model([]), rem, at(5, 12)), []);
  // a deleted child is never reminded
  const gone = model(base, { kids: [{ id: KID, m: 9, del: 1 }] });
  assert.deepEqual(C.reminderDue(gone, rem, at(5, 10)), []);
});

test("reminders: daily medicine time, skipped when a medicine is logged", () => {
  const rem = { med: "08:00", mt: "Vitamin D" };
  const d = model([]);
  assert.deepEqual(C.reminderDue(d, rem, at(5, 7, 59)), []);
  const due = C.reminderDue(d, rem, at(5, 8, 5));
  assert.deepEqual(due.map((x) => x.key), ["med-" + key(5)]);
  assert.deepEqual(C.reminderText(due[0], rem, "en", at(5, 8, 5)), { title: "Medicine time", body: "Vitamin D, 08:00." });
  assert.equal(C.reminderText(due[0], { med: "08:00" }, "el", at(5, 8)).body, "Καθημερινό φάρμακο ή βιταμίνη, 08:00.");
  const given = model([ev("med0001", "med", at(5, 6, 30), { tx: "Vit D" })]);    // up to 2 h early counts
  assert.deepEqual(C.reminderDue(given, rem, at(5, 9)), []);
  const yesterday = model([ev("med0001", "med", at(4, 8), { tx: "Vit D" })]);
  assert.equal(C.reminderDue(yesterday, rem, at(5, 9)).length, 1);
  assert.deepEqual(C.reminderDue(model([], { kids: [] }), rem, at(5, 9)), []);    // no child → silent
});

test("calendar rows: marks on their day, monthly age, birthdays, deleted kids out", () => {
  const d = model([], {
    kids: [kid(), kid("kid0002", { n: "{x}", b: "2024-01-31" })],
    mk: [
      { id: C.msId(KID, "smile"), k: KID, t: "ms", key: "smile", d: "2026-08-01", m: 1 },
      { id: "vacc001", k: KID, t: "vac", tx: "Hexa 1", d: "2026-08-15", m: 1 },
      { id: "docv001", k: KID, t: "doc", tx: "2-month check", d: "2026-08-15", m: 1 },
      { id: "gone001", k: "kid0009", t: "doc", tx: "x", d: "2026-08-15", m: 1 }
    ]
  });
  assert.deepEqual(C.calendarRows(d, "2026-08-01", "en").map((r) => r.title), ["Anna: First smile"]);
  assert.deepEqual(C.calendarRows(d, "2026-08-15", "en").map((r) => r.title),
    ["Anna is 2 months old today", "Anna: vaccine, Hexa 1", "Anna: doctor, 2-month check"]);
  assert.deepEqual(C.calendarRows(d, "2026-08-15", "el").map((r) => r.title),
    ["Anna: κλείνει σήμερα 2 μηνών", "Anna: εμβόλιο, Hexa 1", "Anna: γιατρός, 2-month check"]);
  assert.deepEqual(C.calendarRows(d, "2026-07-15", "en").map((r) => r.title), ["Anna is 1 month old today"]);
  assert.deepEqual(C.calendarRows(d, "2026-06-15", "en"), []);                    // birth day itself
  assert.deepEqual(C.calendarRows(d, "2027-06-15", "en").map((r) => r.title), ["🎂 Anna turns 1"]);
  // month-end births: Feb 29 2024 for a Jan 31 child; a name with braces is not re-filled
  assert.deepEqual(C.calendarRows(d, "2024-02-29", "en").map((r) => r.title), ["{x} is 1 month old today"]);
  assert.deepEqual(C.calendarRows(d, "2026-01-31", "el").map((r) => r.title), ["🎂 {x}: γενέθλια (2)"]);
  assert.deepEqual(C.calendarRows(d, "2026-02-28", "en"), []);                    // over 2: birthdays only
  assert.deepEqual(C.calendarRows(d, "nope", "en"), []);
  const del = model([], { kids: [{ id: KID, m: 9, del: 1 }], mk: d.mk });
  assert.deepEqual(C.calendarRows(del, "2026-08-15", "en"), []);
});
