// Seasonal decorations (seasonal.js): dates, event periods, what
// shows on a day, and the merge of the "seasonal" slice (R26 / R27).
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const fs = require("fs");

const ROOT = path.join(__dirname, "..");
const S = require(path.join(ROOT, "seasonal.js"));
const N = require(path.join(ROOT, "calendar", "namedays.js"));
const J = (x) => JSON.stringify(x);
const ev = (id) => S.eventById(id);
const local = S.normLocal(null);

test("Orthodox Easter: known dates and the same as the Calendar", () => {
  assert.equal(S.orthodoxEaster(2024), "2024-05-05");
  assert.equal(S.orthodoxEaster(2025), "2025-04-20");
  assert.equal(S.orthodoxEaster(2026), "2026-04-12");
  assert.equal(S.orthodoxEaster(2027), "2027-05-02");
  for (let y = 1990; y <= 2099; y++) assert.equal(S.orthodoxEaster(y), N.easter(y), String(y));
});

test("periods: inside, edges and New Year across the year end", () => {
  assert.deepEqual(S.windowAt(ev("xmas"), "2026-12-01"), ["2026-12-01", "2026-12-30"]);
  assert.equal(S.windowAt(ev("xmas"), "2026-11-30"), null);
  assert.equal(S.windowAt(ev("xmas"), "2026-12-31"), null);
  assert.deepEqual(S.windowAt(ev("newyear"), "2026-12-31"), ["2026-12-31", "2027-01-02"]);
  assert.deepEqual(S.windowAt(ev("newyear"), "2027-01-02"), ["2026-12-31", "2027-01-02"]);
  assert.equal(S.windowAt(ev("newyear"), "2027-01-03"), null);
  assert.deepEqual(S.windowAt(ev("halloween"), "2026-10-25"), ["2026-10-25", "2026-10-31"]);
  assert.equal(S.windowAt(ev("halloween"), "2026-11-01"), null);
});

test("nextWindow: the current period, else the next one", () => {
  assert.deepEqual(S.nextWindow(ev("halloween"), "2026-10-15"), ["2026-10-25", "2026-10-31"]);
  assert.deepEqual(S.nextWindow(ev("halloween"), "2026-11-02"), ["2027-10-25", "2027-10-31"]);
  assert.deepEqual(S.nextWindow(ev("newyear"), "2027-01-01"), ["2026-12-31", "2027-01-02"]);
  assert.deepEqual(S.nextWindow(ev("newyear"), "2027-01-05"), ["2027-12-31", "2028-01-02"]);
});

test("Greek feasts: known dates of the movable ones", () => {
  const w = (id, d) => S.windowAt(ev(id), d);
  assert.deepEqual(w("carnival", "2026-02-12"), ["2026-02-12", "2026-02-22"]);   // Tsiknopempti 2026
  assert.deepEqual(w("cleanmon", "2026-02-23"), ["2026-02-23", "2026-02-23"]);
  assert.deepEqual(w("cleanmon", "2027-03-15"), ["2027-03-15", "2027-03-15"]);
  assert.deepEqual(w("easter", "2026-04-09"), ["2026-04-09", "2026-04-13"]);     // Holy Thursday to Easter Monday
  assert.deepEqual(w("easter", "2027-05-03"), ["2027-04-29", "2027-05-03"]);
  assert.equal(w("easter", "2026-04-14"), null);
  assert.deepEqual(w("mar25", "2026-03-24"), ["2026-03-24", "2026-03-25"]);
  assert.deepEqual(w("oct28", "2026-10-28"), ["2026-10-27", "2026-10-28"]);
});

test("overlaps: the higher priority wins, every event shows on some day", () => {
  const top = (d) => (S.activeOn(d)[0] || {}).id;
  assert.equal(top("2026-10-27"), "oct28");        // over Halloween
  assert.equal(top("2026-10-29"), "halloween");
  assert.equal(top("2026-02-14"), "valentine");    // over Carnival
  assert.equal(top("2026-02-15"), "carnival");
  assert.equal(top("2027-05-01"), "easter");       // over May Day
  assert.equal(top("2026-05-01"), "mayday");
  for (let y = 2026; y <= 2040; y++) {
    const seen = new Set();
    for (let d = y + "-01-01"; d <= y + "-12-31"; d = S.addDays(d, 1)) {
      const t = top(d);
      if (t) seen.add(t);
      const list = S.activeOn(d);
      for (let i = 1; i < list.length; i++) assert.ok(list[i - 1].prio > list[i].prio, d + " tie");
    }
    S.EVENTS.forEach((e) => assert.ok(seen.has(e.id) || e.id === "mayday" || e.id === "birthday", y + " " + e.id));
  }
});

test("Western Easter: known dates; the option moves only Easter", () => {
  assert.equal(S.westernEaster(2024), "2024-03-31");
  assert.equal(S.westernEaster(2025), "2025-04-20");
  assert.equal(S.westernEaster(2026), "2026-04-05");
  assert.equal(S.westernEaster(2027), "2027-03-28");
  assert.equal(S.westernEaster(2038), "2038-04-25");
  const west = S.setField(S.normalize(null), "easter", "western", 5);
  const opt = S.optOf(west);
  assert.deepEqual(S.windowAt(ev("easter"), "2026-04-02", opt), ["2026-04-02", "2026-04-06"]);
  assert.equal(S.windowAt(ev("easter"), "2026-04-12", opt), null);
  assert.deepEqual(S.pick(west, local, "2026-04-05", null), { id: "easter", mode: "auto" });
  assert.deepEqual(S.windowAt(ev("cleanmon"), "2026-02-23", opt), ["2026-02-23", "2026-02-23"]);
});

test("birthday: only once set, wins over everything, 29 Feb on 28 Feb", () => {
  const d0 = S.normalize(null);
  assert.equal(S.get(d0, "bday"), "");
  assert.equal(S.nextWindow(ev("birthday"), "2026-10-15", S.optOf(d0)), null);
  assert.equal(S.setField(d0, "bday", "02-30", 1), d0);
  assert.equal(S.setField(d0, "bday", "13-01", 1), d0);
  const d = S.setField(d0, "bday", "12-25", 1);
  assert.deepEqual(S.pick(d, local, "2026-12-25", null), { id: "birthday", mode: "auto" });
  assert.deepEqual(S.pick(d, local, "2026-12-24", null), { id: "xmas", mode: "auto" });
  const off = S.setField(d, "ev.birthday", false, 2);
  assert.deepEqual(S.pick(off, local, "2026-12-25", null), { id: "xmas", mode: "auto" });
  const leap = S.setField(d0, "bday", "02-29", 1), o = S.optOf(leap);
  assert.deepEqual(S.windowAt(ev("birthday"), "2027-02-28", o), ["2027-02-28", "2027-02-28"]);
  assert.deepEqual(S.windowAt(ev("birthday"), "2028-02-29", o), ["2028-02-29", "2028-02-29"]);
  assert.equal(S.windowAt(ev("birthday"), "2028-02-28", o), null);
});

test("seasons: off by default, lose to every holiday when on", () => {
  const d0 = S.normalize(null);
  assert.equal(S.pick(d0, local, "2026-07-15", null), null);
  const sum = S.setField(d0, "ev.summer", true, 1);
  assert.deepEqual(S.pick(sum, local, "2026-07-15", null), { id: "summer", mode: "auto" });
  const aut = S.setField(d0, "ev.autumn", true, 1);
  assert.deepEqual(S.pick(aut, local, "2026-10-26", null), { id: "halloween", mode: "auto" });
  assert.deepEqual(S.pick(aut, local, "2026-11-05", null), { id: "autumn", mode: "auto" });
  const win = S.setField(d0, "ev.winter", true, 1);
  assert.deepEqual(S.pick(win, local, "2027-01-06", null), { id: "epiphany", mode: "auto" });
  assert.deepEqual(S.pick(win, local, "2027-01-20", null), { id: "winter", mode: "auto" });
});

test("pick: defaults ON, master switch, event switch, hide for today", () => {
  const empty = S.normalize(null);
  assert.equal(S.pick(empty, local, "2026-10-15", null), null);
  assert.deepEqual(S.pick(empty, local, "2026-10-29", null), { id: "halloween", mode: "auto" });
  assert.deepEqual(S.pick(empty, local, "2026-12-24", null), { id: "xmas", mode: "auto" });
  assert.deepEqual(S.pick(empty, local, "2027-01-01", null), { id: "newyear", mode: "auto" });
  const off = S.setField(empty, "on", false, 10);
  assert.equal(S.pick(off, local, "2026-12-24", null), null);
  const noX = S.setField(empty, "ev.xmas", false, 10);
  assert.equal(S.pick(noX, local, "2026-12-24", null), null);
  assert.deepEqual(S.pick(noX, local, "2026-12-31", null), { id: "newyear", mode: "auto" });
  const hid = S.normLocal({ hide: "2026-12-24" });
  assert.equal(S.pick(empty, hid, "2026-12-24", null), null);
  assert.deepEqual(S.pick(empty, hid, "2026-12-25", null), { id: "xmas", mode: "auto" });
});

test("pick: a preview or a kept preview wins, even with the switch off", () => {
  const off = S.setField(S.normalize(null), "on", false, 10);
  assert.deepEqual(S.pick(off, local, "2026-10-15", "xmas"), { id: "xmas", mode: "preview" });
  assert.equal(S.pick(off, local, "2026-10-15", "nope"), null);
  const kept = S.normLocal({ keep: { id: "halloween", until: "2026-10-31" } });
  assert.deepEqual(S.pick(off, kept, "2026-10-15", null), { id: "halloween", mode: "kept" });
  assert.deepEqual(S.pick(off, kept, "2026-10-31", null), { id: "halloween", mode: "kept" });
  assert.equal(S.pick(off, kept, "2026-11-01", null), null);
  assert.deepEqual(S.normLocal({ keep: { id: "x", until: "2026-10-31" }, hide: "bad" }), { keep: null, hide: null });
});

test("fields: defaults, validation, stamps only on a real change", () => {
  const d = S.normalize(null);
  assert.equal(S.get(d, "on"), true);
  assert.equal(S.get(d, "motion"), "auto");
  assert.equal(S.get(d, "amount"), "mid");
  assert.equal(S.get(d, "xmas"), "tree");
  assert.equal(S.get(d, "ev.halloween"), true);
  assert.equal(S.setField(d, "motion", "fast", 5), d);
  assert.equal(S.setField(d, "nope", true, 5), d);
  const a = S.setField(d, "motion", "still", 5);
  assert.equal(J(a), J({ ver: 1, f: { motion: { v: "still", t: 5 } } }));
  assert.equal(S.setField(a, "motion", "still", 9), a);
  const b = S.setField(a, "motion", "auto", 3);     // clock behind: still moves forward
  assert.equal(b.f.motion.t, 6);
});

test("normalize: junk out, unknown events from a newer bundle kept, sorted", () => {
  const n = S.normalize({ f: {
    "ev.easter": { v: true, t: 4 }, on: { v: "yes", t: 1 }, motion: { v: "still", t: -2 },
    "BAD KEY": { v: true, t: 1 }, "ev.future": { v: { x: 1 }, t: 2 }, amount: null,
  } });
  assert.equal(J(n), J({ ver: 1, f: { "ev.easter": { v: true, t: 4 }, motion: { v: "still", t: 0 } } }));
});

test("merge: per field newer wins, symmetric, idempotent (fuzz)", () => {
  const a = { ver: 1, f: { on: { v: false, t: 10 }, amount: { v: "low", t: 3 } } };
  const b = { ver: 1, f: { on: { v: true, t: 12 }, xmas: { v: "boat", t: 1 } } };
  const m = S.merge(a, b);
  assert.equal(J(m), J({ ver: 1, f: { amount: { v: "low", t: 3 }, on: { v: true, t: 12 }, xmas: { v: "boat", t: 1 } } }));
  const keys = ["on", "motion", "amount", "xmas", "ev.xmas", "ev.halloween", "ev.easter"];
  const vals = { on: [true, false], motion: ["auto", "still"], amount: ["low", "mid", "high"], xmas: ["tree", "boat"] };
  const rand = (n) => Math.floor(Math.random() * n);
  const side = () => {
    const f = {};
    keys.forEach((k) => {
      if (rand(2)) return;
      const opts = vals[k] || [true, false];
      f[k] = { v: opts[rand(opts.length)], t: rand(5) };
    });
    return { ver: 1, f };
  };
  for (let i = 0; i < 400; i++) {
    const x = side(), y = side(), z = side();
    const xy = S.merge(x, y);
    assert.equal(J(xy), J(S.merge(y, x)), "symmetric");
    assert.equal(J(S.merge(xy, xy)), J(xy), "idempotent");
    assert.equal(J(S.merge(S.merge(x, y), z)), J(S.merge(x, S.merge(y, z))), "associative");
  }
});

test("shell: loaded before shell.js, attached outside single apps, precached", () => {
  const html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
  const a = html.indexOf('src="seasonal.js?v='), b = html.indexOf('src="shell.js?v=');
  assert.ok(a > 0 && a < b);
  const shell = fs.readFileSync(path.join(ROOT, "shell.js"), "utf8");
  assert.match(shell, /if \(window\.orosSeasonal && !SOLO\) \{\n\s+window\.orosSeasonal\.attach\(/);
  assert.match(fs.readFileSync(path.join(ROOT, "sw.js"), "utf8"), /"\.\/seasonal\.js"/);
  const src = fs.readFileSync(path.join(ROOT, "seasonal.js"), "utf8");
  assert.doesNotMatch(src, /https?:\/\/(?!www\.w3\.org)/, "nothing from the net");
  assert.match(src, /prefers-reduced-motion/);
});
