// The .oroswater file (Water, a record app): every drink and daily
// goal through the shared kit (recordpkg.js) and bundle.js; opening
// adds only what is missing, with its ids. Plus the app wiring (Save,
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
const C = require(path.join(ROOT, "water/core.js"));
const P = require(path.join(ROOT, "water/package.js"));
const F = require(path.join(ROOT, "fileopen.js"));
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
const D = P.DESC;
const NOW = 1800000000000;
const clone = (x) => JSON.parse(JSON.stringify(x));
const TS = new Date(2026, 9, 14, 9, 5).getTime();     // local time: the CSV is local

function slice() {
  return C.normalize({
    ver: 1,
    sips: [
      { id: "sipaaa001", ts: TS, ml: 250, m: NOW - 900 },
      { id: "sipaaa002", ts: TS + 3600000, ml: 500, m: NOW - 800 },
      { id: "sipgone01", m: NOW - 100, del: 1 }
    ],
    goals: [{ id: "2026-01-01", ml: 2000, m: NOW - 1000 }, { id: "2026-10-01", ml: 2500, m: NOW - 700 }],
    prefs: { glass: 300, bottle: 750, unit: "oz", rem: { on: 1, from: 480, to: 1200, every: 60 }, habits: 0 },
    pm: NOW - 50
  });
}

test("water: round trip through bundle.js; the file has no tombstones and no settings", async () => {
  const o = K.pack(D, slice(), { title: "Water", lang: "en", now: NOW });
  assert.equal(o.mime, "application/x-oros-water");
  assert.equal(o.generator, "orOS Water");
  assert.deepEqual(Object.keys(o.content.data).sort(), ["goals", "sips", "ver"]);
  assert.deepEqual(o.content.data.sips.map((s) => s.id), ["sipaaa001", "sipaaa002"]);
  const bytes = await B.write(o);
  assert.equal(B.sniff(bytes.subarray(0, 128)), "application/x-oros-water");
  const r = await B.read(bytes, { mime: D.mime });
  assert.equal(r.content.kind, "oros-water-package");
  assert.deepEqual(r.content.data.goals, slice().goals);
  // preview: the app's own CSV export
  const csv = o.preview.find((p) => p.name === "drinks.csv").data;
  assert.equal(csv, "date,time,ml\r\n2026-10-14,09:05,250\r\n2026-10-14,10:05,500\r\n");
  assert.equal(csv, C.toCsv(slice()));
  // into a device with other data and its own settings
  const other = C.normalize({
    sips: [{ id: "sipbbb001", ts: TS - 86400000, ml: 330, m: NOW - 5000 }],
    goals: [{ id: "2026-05-01", ml: 1800, m: NOW - 5000 }],
    prefs: { glass: 200 }, pm: NOW - 4000
  });
  const res = K.open(D, other, r.content, { now: NOW });
  assert.deepEqual(res.report, { added: 4, skipped: 0, updated: 0 });
  assert.deepEqual(res.addedIds.slice().sort(), ["2026-01-01", "2026-10-01", "sipaaa001", "sipaaa002"]);
  assert.deepEqual(res.next.sips.map((s) => s.id), ["sipaaa001", "sipaaa002", "sipbbb001"]);
  assert.deepEqual(res.next.goals.map((g) => g.id), ["2026-01-01", "2026-05-01", "2026-10-01"]);
  assert.deepEqual(res.next.prefs, other.prefs);                 // settings stay this device's
  assert.equal(res.next.pm, other.pm);
  assert.deepEqual(res.next, C.normalize(res.next));             // canonical, as the slice wants
  // and again: nothing
  const again = K.open(D, res.next, r.content, { now: NOW });
  assert.equal(again.report.added, 0);
  assert.equal(again.report.skipped, 4);
  assert.deepEqual(again.next, res.next);
});

test("water: a clash keeps the local record (drinks and day-keyed goals); deleted stays deleted; update takes newer", () => {
  const mine = slice();
  const theirs = slice();
  theirs.goals[1].ml = 3500; theirs.goals[1].m = NOW - 1;      // the same day, another goal, newer
  theirs.sips[0].ml = 999; theirs.sips[0].m = NOW - 1;          // the same drink, changed later
  theirs.sips[2] = { id: "sipgone01", ts: TS, ml: 100, m: NOW - 1 };   // deleted here, live there
  theirs.sips.push({ id: "sipnew001", ts: TS + 7200000, ml: 200, m: NOW - 1 });
  const c = K.pack(D, theirs, { now: NOW }).content;
  const res = K.open(D, mine, c, { now: NOW });
  assert.deepEqual(res.addedIds, ["sipnew001"]);
  assert.deepEqual(res.report, { added: 1, skipped: 5, updated: 0 });
  assert.equal(res.next.goals.find((g) => g.id === "2026-10-01").ml, 2500);
  assert.equal(res.next.sips.find((s) => s.id === "sipaaa001").ml, 250);
  assert.deepEqual(res.next.sips.find((s) => s.id === "sipgone01"), mine.sips.find((s) => s.id === "sipgone01"));
  assert.equal(C.goalFor(res.next, "2026-10-14"), 2500);
  // "Update with newer versions": the day's goal and the drink take the file's; the tombstone stays
  const upd = K.open(D, mine, c, { update: true, now: NOW });
  assert.deepEqual(upd.updatedIds.slice().sort(), ["2026-10-01", "sipaaa001"]);
  assert.equal(upd.next.goals.find((g) => g.id === "2026-10-01").ml, 3500);
  assert.equal(upd.next.sips.find((s) => s.id === "sipaaa001").ml, 999);
  assert.equal(upd.next.sips.find((s) => s.id === "sipgone01").del, 1);
  // a file's goal NOT newer than the local one never wins, even with update
  const old = slice(); old.goals[1].ml = 4000; old.goals[1].m = NOW - 99999;
  const u2 = K.open(D, mine, K.pack(D, old, { now: NOW }).content, { update: true, now: NOW });
  assert.equal(u2.next.goals.find((g) => g.id === "2026-10-01").ml, 2500);
  assert.equal(P.kindOf("sipnew001", res.next), "sip");
  assert.equal(P.kindOf("2026-10-01", res.next), "goal");
  assert.equal(P.kindOf("nope", res.next), "");
});

test("water: hostile content is cut down; stamps are clamped; wrong kinds refused", () => {
  const evil = {
    kind: "oros-water-package", ver: 1,
    data: {
      ver: 1, prefs: { glass: 1, rem: { on: 1 } }, pm: NOW * 10, __proto__x: 1,
      sips: [
        { id: "okokok01", ts: TS, ml: 300, m: NOW * 2, onclick: "x", note: "<script>" },   // future m → clamped
        { id: "BAD ID", ts: TS, ml: 300, m: 1 },
        { id: "short", ts: TS, ml: 300, m: 1 },
        { id: "toolarge1", ts: TS, ml: 999999, m: 1 },
        { id: "farfuture1", ts: 8e15, ml: 200, m: 1 },
        { id: "negative1", ts: -5, ml: 200, m: 1 },
        { id: "fraction1", ts: TS, ml: 2.5, m: 1 },
        { id: "__proto__", ts: TS, ml: 200, m: 1 },
        { id: "deadone01", m: 5, del: 1 },
        "junk", null, 7
      ],
      goals: [
        { id: "2026-02-30", ml: 2000, m: 1 },
        { id: "2026-03-01", ml: 99, m: 1 },
        { id: "2026-03-02", ml: "2000", m: 1 },
        { id: "2026-03-03", ml: 2200, m: 1, x: "y" },
        { id: "../etc", ml: 2000, m: 1 }
      ]
    }
  };
  const res = K.open(D, C.empty(), evil, { now: NOW });
  assert.deepEqual(res.addedIds.slice().sort(), ["2026-03-03", "okokok01"]);
  assert.deepEqual(res.next.sips, [{ id: "okokok01", ts: TS, ml: 300, m: NOW + K.FUTURE }]);
  assert.deepEqual(res.next.goals, [{ id: "2026-03-03", ml: 2200, m: 1 }]);
  assert.deepEqual(res.next.prefs, C.empty().prefs);           // a file never sets the settings
  assert.equal(res.next.pm, 0);
  assert.equal(D.norm("x"), null);
  assert.equal(D.norm([1, 2]), null);
  assert.deepEqual(D.norm({}), { ver: 1, sips: [], goals: [] });
  assert.throws(() => K.open(D, C.empty(), { kind: "oros-todo-package", ver: 1, data: {} }), /notpackage/);
  assert.throws(() => K.open(D, C.empty(), { kind: "oros-water-package", ver: 9, data: {} }), /newer/);
  // caps
  const many = { kind: "oros-water-package", ver: 1, data: { sips: [], goals: [] } };
  for (let i = 0; i < P.LIM.sips + 5; i++) many.data.sips.push({ id: "s" + String(i).padStart(7, "0"), ts: TS, ml: 1, m: 1 });
  assert.equal(D.norm(many.data).sips.length, P.LIM.sips);
});

test("water: wiring (scripts, buttons, Open with, help, file types)", () => {
  const html = read("water/index.html");
  ["core.js?v=", "../bundle.js?v=2.49.00", "../recordpkg.js?v=2.49.00", "package.js?v=2.49.00", "water.js?v=2.49.00"].forEach((s) =>
    assert.ok(html.includes('src="' + s), s));
  assert.ok(html.indexOf('src="core.js') < html.indexOf('src="package.js'));
  assert.ok(html.indexOf("recordpkg.js") < html.indexOf('src="water.js'));
  const js = read("water/water.js");
  assert.match(js, /RP\.ui\(WPK\.DESC,/);
  assert.match(js, /if \(tg && tg\.openFile\) \{ if \(recFile\) recFile\.openTarget\(tg\.openFile\); return; \}/);
  ["openFile", "__orosTakeFile(", "window.__orosOpenAt =", '__orosTakeTarget("water")'].forEach((s) => assert.ok(js.includes(s), s));
  assert.equal(js.split("window.__orosOpenAt =").length, 2);
  ["wt-osave", "wt-oopen", "wt-ofolder"].forEach((id) => assert.ok(js.includes('"' + id + '"'), id));
  assert.ok(js.includes('"set.osave": "orOS file (.oroswater)"'));
  assert.ok(js.includes('"set.osave": "Αρχείο orOS (.oroswater)"'));
  for (const f of ["water/help.en.txt", "water/help.el.txt"]) assert.ok(read(f).includes(".oroswater"), f);
  assert.deepEqual(F.appsFor(".oroswater"), ["water"]);
  assert.deepEqual(B.TYPES[".oroswater"], { app: "water", mime: "application/x-oros-water" });
});
