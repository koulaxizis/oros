// The .oroshabits file (Habits, a record app): every habit and its days
// through the shared kit (recordpkg.js) and bundle.js; opening adds only
// what is missing, with its ids (a day is keyed "<habitId>|<date>", so a
// day already here keeps its local values). Plus the app wiring (Save,
// Open, unzipped folder, "Open with").
// Run: node --test tests/*.test.js
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const B = require(path.join(ROOT, "bundle.js"));
const K = require(path.join(ROOT, "recordpkg.js"));
const P = require(path.join(ROOT, "habits/package.js"));
const M = require(path.join(ROOT, "habits/model.js"));
const F = require(path.join(ROOT, "fileopen.js"));
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
const D = P.DESC;
const NOW = Date.now();
const clone = (x) => JSON.parse(JSON.stringify(x));

function slice() {
  return M.canon({
    ver: 2,
    habits: [
      { id: "h-read", name: "Read", icon: "book", color: "#e06c75", days: [0, 1, 2, 3, 4, 5, 6], mtime: NOW - 9000, del: false,
        num: { u: "pages", t: 10, c: "ge", s: 1 }, rem: 480 },
      { id: "h-run", name: "=Run", icon: "run", color: "#87cf3e", days: [], per: ["w", 3], mtime: NOW - 8000, del: false },
      { id: "h-gone", name: "Old", icon: "check", color: "#e06c75", days: [], mtime: NOW - 7000, del: true }
    ],
    comps: [
      { id: "h-read|2026-10-01", habitId: "h-read", date: "2026-10-01", mtime: 0, del: true,
        v: { dev1abc: [12, NOW - 5000] }, nt: ["good book", NOW - 5000] },
      { id: "h-run|2026-10-01", habitId: "h-run", date: "2026-10-01", mtime: NOW - 4000, del: false },
      { id: "h-run|2026-10-02", habitId: "h-run", date: "2026-10-02", mtime: NOW - 3000, del: true, sk: [1, NOW - 3000] },
      { id: "h-run|2026-10-03", habitId: "h-run", date: "2026-10-03", mtime: NOW - 3000, del: true },          // empty
      { id: "h-gone|2026-10-01", habitId: "h-gone", date: "2026-10-01", mtime: NOW - 7000, del: true }
    ],
    set: { st: 0, sg: 9000, m: NOW - 100 }
  });
}

test("habits: round trip through bundle.js; the file has no deleted habits, empty days or Steps setting", async () => {
  const o = K.pack(D, slice(), { title: "Habits", lang: "en", now: NOW });
  assert.equal(o.mime, "application/x-oros-habits");
  assert.equal(o.generator, "orOS Habits");
  assert.deepEqual(Object.keys(o.content.data).sort(), ["comps", "habits", "ver"]);
  assert.deepEqual(o.content.data.habits.map((h) => h.id), ["h-read", "h-run"]);
  assert.deepEqual(o.content.data.comps.map((c) => c.id), ["h-read|2026-10-01", "h-run|2026-10-01", "h-run|2026-10-02"]);
  const bytes = await B.write(o);
  assert.equal(B.sniff(bytes.subarray(0, 128)), "application/x-oros-habits");
  const r = await B.read(bytes, { mime: D.mime });
  assert.equal(r.content.kind, "oros-habits-package");
  assert.deepEqual(r.content.data, o.content.data);
  // previews: Markdown list, CSV with the day's sum and a formula guard
  const md = o.preview.find((p) => p.name === "habits.md").data;
  assert.match(md, /^# Habits\n\n- =Run \(3× \/ week · check-offs: 1\)\n- Read \(every day · ≥ 10 pages · check-offs: 1\)\n$/);
  const csv = o.preview.find((p) => p.name === "checkins.csv").data;
  assert.equal(csv, "date,habit,done,value,unit,skipped,note\r\n" +
    "2026-10-01,Read,yes,12,pages,,good book\r\n" +
    "2026-10-01,\"'=Run\",yes,,,,\r\n" +
    "2026-10-02,\"'=Run\",no,,,yes,\r\n");
  // into a device that has one habit of its own
  const fresh = M.canon({ ver: 2, habits: [{ id: "h-mine", name: "Mine", icon: "star", color: "#ecc75f", days: [], mtime: NOW - 1, del: false }],
    comps: [], set: { st: 1, sg: 8000, m: 5 } });
  const res = K.open(D, fresh, r.content, { now: NOW });
  assert.deepEqual(res.report, { added: 5, skipped: 0, updated: 0 });
  assert.deepEqual(res.addedIds.slice().sort(), ["h-read", "h-read|2026-10-01", "h-run", "h-run|2026-10-01", "h-run|2026-10-02"]);
  assert.deepEqual(res.next.habits.map((h) => h.id), ["h-mine", "h-read", "h-run"]);
  assert.deepEqual(res.next.set, fresh.set);                                // the device's own setting
  assert.deepEqual(res.next.comps.find((c) => c.id === "h-read|2026-10-01").v, { dev1abc: [12, NOW - 5000] });
  assert.ok(M.normalize(res.next));
  // and again: nothing
  const again = K.open(D, res.next, r.content, { now: NOW });
  assert.equal(again.report.added, 0);
  assert.equal(again.report.skipped, 5);
  assert.deepEqual(again.next, res.next);
});

test("habits: a day already here keeps its local values; update takes newer, field by field", () => {
  const theirs = slice();
  const mine = slice();
  // the same day (same day-keyed id) with other values in the file
  const tc = theirs.comps.find((c) => c.id === "h-read|2026-10-01");
  tc.v = { dev1abc: [99, NOW - 1000], zzzz9999: [5, NOW - 1000] }; tc.nt = ["file note", NOW - 6000]; tc.mtime = NOW - 1000; tc.del = false;
  theirs.comps.push({ id: "h-read|2026-10-04", habitId: "h-read", date: "2026-10-04", mtime: NOW - 10, del: true, v: { zzzz9999: [3, NOW - 10] } });
  theirs.habits.find((h) => h.id === "h-run").name = "Run later"; theirs.habits.find((h) => h.id === "h-run").mtime = NOW - 10;
  const c = K.pack(D, theirs, { now: NOW }).content;
  const res = K.open(D, mine, c, { now: NOW });
  assert.deepEqual(res.addedIds, ["h-read|2026-10-04"]);
  const kept = res.next.comps.find((x) => x.id === "h-read|2026-10-01");
  assert.deepEqual(kept, mine.comps.find((x) => x.id === "h-read|2026-10-01"));   // local value and note
  assert.equal(res.next.habits.find((h) => h.id === "h-run").name, "=Run");
  // update: newer habit name; the day merged field by field (newer
  // shares win, the older file note loses to the local one)
  const upd = K.open(D, mine, c, { update: true, now: NOW });
  assert.deepEqual(upd.updatedIds.slice().sort(), ["h-read|2026-10-01", "h-run"]);
  assert.equal(upd.next.habits.find((h) => h.id === "h-run").name, "Run later");
  const u = upd.next.comps.find((x) => x.id === "h-read|2026-10-01");
  assert.deepEqual(u.v, { dev1abc: [99, NOW - 1000], zzzz9999: [5, NOW - 1000] });
  assert.deepEqual(u.nt, ["good book", NOW - 5000]);
  assert.equal(u.del, false);
  assert.deepEqual(upd.next.set, mine.set);
  assert.equal(P.kindOf("h-run", res.next), "habit");
  assert.equal(P.kindOf("h-read|2026-10-04", res.next), "comp");
  assert.equal(P.kindOf("nope", res.next), "");
});

test("habits: a habit deleted here stays deleted, and its days do not come back", () => {
  const theirs = slice();
  theirs.comps.push({ id: "h-run|2026-10-05", habitId: "h-run", date: "2026-10-05", mtime: NOW - 10, del: false });
  const mine = slice();
  const run = mine.habits.find((h) => h.id === "h-run");
  run.del = true; run.mtime = NOW - 500;
  const c = K.pack(D, theirs, { now: NOW }).content;
  const DL = P.forLocal(() => mine);
  const res = K.open(DL, mine, c, { now: NOW });
  assert.deepEqual(res.addedIds, []);
  assert.equal(res.report.added, 0);
  assert.ok(!res.next.comps.some((x) => x.id === "h-run|2026-10-05"));
  assert.equal(res.next.habits.find((h) => h.id === "h-run").del, true);
  // even with update ticked
  const upd = K.open(DL, mine, c, { update: true, now: NOW });
  assert.equal(upd.next.habits.find((h) => h.id === "h-run").del, true);
  assert.equal(upd.report.added + upd.report.updated, 0);
});

test("habits: hostile content is cut down", () => {
  const far = NOW + 365 * 864e5;
  const n = D.norm({
    habits: [
      { id: "ok", name: "a\u0000b‮", icon: "<img>", color: "red", days: [9, 1, 1, "x"], mtime: far, del: false,
        num: { u: "u\n" + "x".repeat(50), t: -1 }, onclick: "x", per: ["w", 99], rem: 5000 },
      { id: "bad id", name: "x", mtime: 1 }, { id: "noname", name: "  ", mtime: 1 }, "junk", { id: "ok", name: "dup", mtime: 1 }
    ],
    comps: [
      { id: "ok|2026-01-01", habitId: "ok", date: "2026-01-01", mtime: 1, del: false, v: { "BAD!": [1, 1], good1: [2, far] },
        nt: ["n\u0007\nline2", far], sk: [1, far], evil: 1 },
      { id: "other|2026-01-02", habitId: "ok", date: "2026-01-02", mtime: 1 },                 // id does not match
      { id: "ok|tomorrow", habitId: "ok", date: "tomorrow", mtime: 1 },
      { id: "ok|2026-01-01", habitId: "ok", date: "2026-01-01", mtime: 2 }                     // duplicate
    ],
    set: { st: 0, sg: 1, m: far }
  });
  assert.equal(n.habits.length, 1);
  const h = n.habits[0];
  assert.deepEqual([h.name, h.icon, h.color, h.days, h.num, h.per, h.rem, h.onclick],
    ["a b‮", "check", "#e06c75", [1], undefined, undefined, undefined, undefined]);
  assert.equal(n.comps.length, 1);
  const c = n.comps[0];
  assert.deepEqual(Object.keys(c.v), ["good1"]);
  assert.ok(c.v.good1[1] <= Date.now() + K.FUTURE);
  assert.ok(c.sk[1] <= Date.now() + K.FUTURE && c.nt[1] <= Date.now() + K.FUTURE);
  assert.equal(c.nt[0], "n \nline2");
  assert.equal(c.evil, undefined);
  assert.equal(n.set, undefined);
  assert.equal(D.norm("x"), null);
  // the kit clamps the row stamps of what it adds
  const res = K.open(D, slice(), { kind: "oros-habits-package", ver: 1, data: { habits: [
    { id: "far", name: "Far", mtime: far, days: [] }], comps: [] } }, { now: NOW });
  assert.equal(res.next.habits.find((x) => x.id === "far").mtime, NOW + K.FUTURE);
  assert.throws(() => K.open(D, slice(), { kind: "oros-todo-package", ver: 1, data: {} }), /notpackage/);
  assert.throws(() => K.open(D, slice(), { kind: "oros-habits-package", ver: 9, data: {} }), /newer/);
});

test("habits: wiring (scripts, buttons, Open with, Undo, help, file types)", () => {
  const html = read("habits/index.html");
  ["../bundle.js?v=", "../recordpkg.js?v=", "package.js?v=", "habits.js?v="].forEach((s) =>
    assert.ok(html.includes('src="' + s), s));
  assert.ok(html.indexOf("model.js") < html.indexOf("package.js?"));
  assert.ok(html.indexOf("recordpkg.js") < html.indexOf('src="habits.js'));
  const js = read("habits/habits.js");
  ["sf-osave", "sf-oopen", "sf-ofolder"].forEach((id) => assert.ok(js.includes('id="' + id + '"'), id));
  assert.match(js, /RP\.ui\(HPK\.forLocal\(/);
  assert.match(js, /if \(t && t\.openFile\) \{ if \(recFile\) recFile\.openTarget\(t\.openFile\); return; \}/);
  assert.match(js, /deleteHabit\(h\)/);
  assert.match(js, /__orosTakeFile\(/);
  assert.equal((js.match(/window\.__orosOpenAt\s*=/g) || []).length, 1);
  assert.match(js, /__orosTakeTarget\("habits"\)/);
  for (const f of ["habits/help.en.txt", "habits/help.el.txt"]) assert.ok(read(f).includes(".oroshabits"), f);
  assert.deepEqual(F.appsFor(".oroshabits"), ["habits"]);
  assert.deepEqual(B.TYPES[".oroshabits"], { app: "habits", mime: "application/x-oros-habits" });
});
