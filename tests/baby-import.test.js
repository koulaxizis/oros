// Baby "Import from another app" (baby/import.js): Huckleberry CSV,
// Baby Buddy CSV / JSON (per model, Django dump), Baby Tracker
// (Nighp) per-activity CSVs and their ZIP, units, skipped kinds, and
// the plan against the app's data (stable ids, entries already
// logged by hand left out, growth fields the child has kept, an
// undone import that comes back, one child of a multi-baby file).
// Fixtures are built inline from the documented export shapes.
// Run: node --test tests/

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const I = require(path.join(__dirname, "..", "baby/import.js"));
const C = require(path.join(__dirname, "..", "baby/core.js"));
const Z = require(path.join(__dirname, "..", "atelier/zip.js"));

const NOW = new Date(2026, 9, 15, 12, 0).getTime();
const at = (y, mo, d, h, mi) => new Date(y, mo - 1, d, h || 0, mi || 0).getTime();
const KID = "kid0001aaaa";
function base() {
  const d = C.empty();
  d.kids.push({ id: KID, n: "Mia", b: "2026-08-01", s: "f", c: 0, m: 1 });
  return d;
}
function apply(data, pl) {
  data.ev = data.ev.concat(pl.ev);
  data.gr = data.gr.concat(pl.gr);
  return C.normalize(data);
}

const HUCK = [
  "Type,Start,End,Duration,Start Condition,Start Location,End Condition,Notes",
  "Feed,2026-10-01 07:00,2026-10-01 07:25,00:25,00:10L,Breast,00:15R,",
  "Feed,2026-10-01 10:00,2026-10-01 10:10,00:10,Formula,Bottle,120ml,",
  "Feed,2026-10-01 13:00,2026-10-01 13:05,00:05,Breast Milk,Bottle,4oz,",
  "Feed,2026-10-01 15:00,2026-10-01 15:20,00:20,,Breast,,left side",
  "Sleep,2026-10-01 20:30,2026-10-02 06:15,09:45,Upset,Crib,Woke up,",
  "Diaper,2026-10-01 07:30,,,,,Pee,",
  "Diaper,2026-10-01 11:00,,,,,Both,",
  "Diaper,2026-10-01 12:00,,,,,Poo,\"<img src=x onerror=alert(1)>\"",
  "Diaper,2026-10-01 14:00,,,,,Dry,",
  "Pump,2026-10-01 09:00,2026-10-01 09:15,00:15,Left 60ml,,Right 50ml,",
  "Growth,2026-10-01 09:00,,,4.2kg,55cm,38cm,",
  "Medicine,2026-10-01 08:00,,,Vitamin D,,1 drop,",
  "Potty,2026-10-01 08:30,,,,,,",
  "Activity,2026-10-01 16:00,,,,,,",
  "Sleep,2026-10-03 13:00,,,,,,"
].join("\n");

test("Huckleberry: feeds (breast sides, bottles), sleep, diapers, pump, growth, medicine; skips", () => {
  const r = I.parseText(HUCK, "huckleberry.csv", {});
  assert.equal(r.source, "huckleberry");
  const by = (t) => r.items.filter((x) => x.t === t);
  const feeds = by("feed");
  assert.equal(feeds.length, 2);
  assert.equal(feeds[0].ls, 600);
  assert.equal(feeds[0].rs, 900);
  assert.equal(feeds[0].sd, "r");
  assert.equal(feeds[0].e - feeds[0].ts, 25 * 60000);
  assert.equal(feeds[1].ls, 1200);                     // "left side", from the times
  const bottles = by("bottle");
  assert.deepEqual(bottles.map((x) => [x.ml, x.x]), [[120, "fm"], [118, "bm"]]);
  const sleep = by("sleep")[0];
  assert.equal(sleep.e - sleep.ts, (9 * 60 + 45) * 60000);
  assert.deepEqual(by("diaper").map((x) => x.x), ["w", "wd", "d"]);
  assert.equal(by("diaper")[2].tx, "<img src=x onerror=alert(1)>");   // plain text, shown with textContent
  assert.equal(by("pump")[0].ml, 110);
  const g = by("growth")[0];
  assert.deepEqual([g.d, g.g, g.l, g.h], ["2026-10-01", 4200, 550, 380]);
  assert.equal(by("med")[0].tx, "Vitamin D 1 drop");
  assert.equal(r.skip.Potty, 1);
  assert.equal(r.skip.Activity, 1);
  assert.equal(r.skip.dry, 1);
  assert.equal(r.skip.noend, 1);                       // a sleep with no end is not a running timer
});

test("Huckleberry: M/D/Y dates found from the data", () => {
  const csv = "Type,Start,End,Duration,Start Condition,Start Location,End Condition,Notes\n" +
    "Diaper,10/13/2026 7:30 AM,,,,,Pee,\nDiaper,10/02/2026 7:30 PM,,,,,Poo,\n";
  const r = I.parseText(csv, "x.csv", {});
  assert.equal(r.items[0].ts, at(2026, 10, 13, 7, 30));
  assert.equal(r.items[1].ts, at(2026, 10, 2, 19, 30));
});

test("plan: stable ids, a second import adds nothing, hand-logged entries left out", () => {
  const r = I.parseText(HUCK, "h.csv", {});
  const data = base();
  // logged by hand in orOS, 20 s apart from the file's 07:30 nappy
  data.ev.push({ id: "own0001aaaa", k: KID, t: "diaper", ts: at(2026, 10, 1, 7, 30) + 20000, x: "w", m: 5 });
  // a weight the person already entered that day
  data.gr.push({ id: "own0002aaaa", k: KID, d: "2026-10-01", g: 4150, m: 5 });
  const pl = I.plan(r, data, { kid: KID, now: NOW });
  assert.equal(pl.kinds.diaper.add, 2);
  assert.equal(pl.kinds.diaper.dup, 1);
  assert.equal(pl.gr.length, 1);
  assert.equal(pl.gr[0].g, undefined);                 // their weight wins
  assert.equal(pl.gr[0].l, 550);
  assert.ok(pl.ev.every((e) => /^imp[a-z0-9]{14}$/.test(e.id) && C.ID_RE.test(e.id) && e.k === KID && e.m === NOW));
  assert.ok(pl.ev.every((e) => !C.TIMED[e.t] || e.e !== undefined));    // never a running timer
  assert.equal(pl.from, at(2026, 10, 1));                // the growth day
  const after = apply(data, pl);
  assert.equal(after.ev.find((e) => e.id === "own0001aaaa").x, "w");
  const again = I.plan(r, after, { kid: KID, now: NOW + 1000 });
  assert.equal(again.ev.length, 0);
  assert.equal(again.gr.length, 0);
  assert.ok(again.dup >= pl.ev.length);
  // ids are per child: the same file for another child is new
  const other = I.plan(r, after, { kid: "kid0002bbbb", now: NOW });
  assert.equal(other.ev.length, pl.ev.length + 1);
});

test("plan: an undone import (tombstones) comes back with a newer stamp", () => {
  const r = I.parseText(HUCK, "h.csv", {});
  let data = apply(base(), I.plan(r, base(), { kid: KID, now: NOW }));
  const ids = data.ev.map((e) => e.id);
  data.ev = data.ev.map((e) => ({ id: e.id, m: e.m + 1, del: 1 }));
  data = C.normalize(data);
  const pl = I.plan(r, data, { kid: KID, now: NOW });
  assert.equal(pl.ev.length, ids.length);
  assert.ok(pl.ev.every((e) => e.m === NOW + 1 + 1 || e.m > NOW));
  const merged = C.mergeBaby(data, { kids: [], ev: pl.ev, gr: [], mk: [] });
  assert.equal(merged.ev.filter((e) => !e.del).length, ids.length);
});

test("plan: future entries are skipped", () => {
  const csv = "Type,Start,End,Duration,Start Condition,Start Location,End Condition,Notes\nDiaper,2027-01-01 07:30,,,,,Pee,\n";
  const pl = I.plan(I.parseText(csv, "x.csv", {}), base(), { kid: KID, now: NOW });
  assert.equal(pl.ev.length, 0);
  assert.equal(pl.skip.future, 1);
});

test("Baby Buddy CSV per model, units from the app's prefs", () => {
  const feeding = "id,child,start,end,duration,type,method,amount,notes\n" +
    "1,Mia Smith,2026-10-05 08:00:00,2026-10-05 08:20:00,0:20:00,breast milk,left breast,,\n" +
    "2,Mia Smith,2026-10-05 11:00:00,2026-10-05 11:10:00,0:10:00,formula,bottle,90,\n" +
    "3,Mia Smith,2026-10-05 14:00:00,2026-10-05 14:30:00,0:30:00,breast milk,both breasts,,\n" +
    "4,Mia Smith,2026-10-05 17:00:00,2026-10-05 17:10:00,0:10:00,solid food,parent fed,,carrot\n" +
    "5,Mia Smith,2026-10-05 19:00:00,2026-10-05 19:10:00,0:10:00,breast milk,bottle,,\n";
  let r = I.parseText(feeding, "feeding.csv", { prefs: { vu: "ml" } });
  assert.equal(r.source, "babybuddy");
  assert.deepEqual(r.items.map((x) => x.t), ["feed", "bottle", "feed", "solid"]);
  assert.equal(r.items[0].ls, 1200);
  assert.equal(r.items[1].ml, 90);
  assert.equal(r.items[1].x, "fm");
  assert.deepEqual([r.items[2].ls, r.items[2].rs], [900, 900]);
  assert.equal(r.items[3].tx, "carrot");
  assert.equal(r.skip.noamount, 1);
  assert.deepEqual(r.babies, { "Mia Smith": 4 });
  r = I.parseText(feeding, "feeding.csv", { prefs: { vu: "oz" } });
  assert.equal(r.items[1].ml, 2662);                   // 90 "oz" → out of range later
  const pl = I.plan(r, base(), { kid: KID, now: NOW });
  assert.equal(pl.skip.bad, 1);

  const diaper = "child,time,wet,solid,color,amount,notes\nMia Smith,2026-10-05 08:30:00,True,False,,,\n" +
    "Mia Smith,2026-10-05 09:30:00,True,True,yellow,,\nMia Smith,2026-10-05 10:30:00,False,False,,,\n";
  r = I.parseText(diaper, "diaperchange.csv", {});
  assert.deepEqual(r.items.map((x) => x.x), ["w", "wd"]);
  assert.equal(r.items[1].tx, "yellow");
  assert.equal(r.skip.dry, 1);

  const sleep = "child,start,end,duration,nap,notes\nMia Smith,2026-10-05 13:00:00,2026-10-05 14:30:00,1:30:00,True,\n";
  r = I.parseText(sleep, "sleep.csv", {});
  assert.equal(r.items[0].t, "sleep");
  assert.equal(r.items[0].e - r.items[0].ts, 90 * 60000);

  r = I.parseText("child,weight,date,notes\nMia Smith,4.5,2026-10-05,\n", "weight.csv", { prefs: { wu: "kg" } });
  assert.equal(r.items[0].g, 4500);
  r = I.parseText("child,weight,date,notes\nMia Smith,9.9,2026-10-05,\n", "weight.csv", { prefs: { wu: "lb" } });
  assert.equal(r.items[0].g, 4491);
  r = I.parseText("child,height,date\nMia Smith,56,2026-10-05\n", "height.csv", {});
  assert.equal(r.items[0].l, 560);
  r = I.parseText("child,head_circumference,date\nMia Smith,15,2026-10-05\n", "headcircumference.csv", {});
  assert.equal(r.items[0].h, 381);                     // only inches make sense
  r = I.parseText("child,start,end,duration,milestone\nMia Smith,2026-10-05 10:00,2026-10-05 10:12,0:12:00,lifted head\n", "tummytime.csv", {});
  assert.deepEqual([r.items[0].t, r.items[0].v, r.items[0].tx], ["tummy", 12, "lifted head"]);
  r = I.parseText("child,temperature,time\nMia Smith,100.4,2026-10-05 10:00\n", "temperature.csv", {});
  assert.equal(r.items[0].v, 380);
  r = I.parseText("child,bmi,date\nMia Smith,14,2026-10-05\n", "bmi.csv", {});
  assert.equal(r.skip.bmi, 1);
});

test("Baby Buddy JSON: Django dump with child names, and the API shape", () => {
  const dump = JSON.stringify([
    { model: "core.child", pk: 1, fields: { first_name: "Mia", last_name: "Smith", birth_date: "2026-08-01" } },
    { model: "core.feeding", pk: 7, fields: { child: 1, start: "2026-10-06T08:00:00+03:00", end: "2026-10-06T08:15:00+03:00", type: "breast milk", method: "right breast", amount: null } },
    { model: "core.sleep", pk: 8, fields: { child: 1, start: "2026-10-06T09:00:00+03:00", end: "2026-10-06T10:00:00+03:00", nap: true } },
    { model: "core.diaperchange", pk: 9, fields: { child: 1, time: "2026-10-06T10:05:00+03:00", wet: true, solid: false } },
    { model: "core.weight", pk: 10, fields: { child: 1, weight: 4.6, date: "2026-10-06" } },
    { model: "core.note", pk: 11, fields: { child: 1, note: "Smiled at grandma", time: "2026-10-06T11:00:00+03:00" } },
    { model: "core.timer", pk: 12, fields: { name: "x" } }
  ]);
  const r = I.parseText(dump, "dump.json", {});
  assert.equal(r.source, "babybuddy");
  assert.deepEqual(r.items.map((x) => x.t).sort(), ["diaper", "feed", "growth", "note", "sleep"]);
  assert.deepEqual(Object.keys(r.babies), ["Mia Smith"]);
  const f = r.items.find((x) => x.t === "feed");
  assert.equal(f.ts, Date.parse("2026-10-06T05:00:00Z"));
  assert.equal(f.rs, 900);
  assert.equal(r.skip.timer, 1);
  const api = JSON.stringify({ count: 1, results: [{ id: 3, child: 1, time: "2026-10-06T10:05:00Z", wet: false, solid: true, color: "brown" }] });
  const r2 = I.parseText(api, "changes.json", {});
  assert.equal(r2.items[0].x, "d");
});

const NIGHP = {
  "Nursing.csv": "Baby,Time,Start Side,Left duration (min),Right duration (min),Total Duration (min),Note\n" +
    "Mia,\"10/7/26, 7:05 AM\",Left,12,8,20,\nLeo,\"10/7/26, 7:10 AM\",Right,5,10,15,\n",
  "Formula.csv": "Baby,Time,Amount (ml),Note\nMia,\"10/7/26, 10:00 AM\",120,\n",
  "Pumped.csv": "Baby,Time,Amount,Note\nMia,\"10/7/26, 1:00 PM\",3 oz,\n",
  "Pump.csv": "Time,Left Amount,Right Amount,Duration (min),Note\n\"10/7/26, 9:00 AM\",60 ml,40 ml,15,\n",
  "Sleep.csv": "Baby,Time,Duration (min),Note\nMia,\"10/13/26, 8:00 PM\",600,\n",
  "Diaper.csv": "Baby,Time,Status,Note\nMia,\"10/7/26, 7:30 AM\",Mixed,\nMia,\"10/7/26, 8:30 AM\",Dry,\n",
  "Growth.csv": "Baby,Time,Weight (kg),Height (cm),Head Size (cm),Note\nMia,\"10/7/26, 9:00 AM\",4.7,57,38.5,\n",
  "Medicine.csv": "Baby,Time,Medicine Name,Amount,Note\nMia,\"10/7/26, 8:00 AM\",Vitamin D,1 drop,\n",
  "Joy.csv": "Baby,Time,Note\nMia,\"10/7/26, 8:00 AM\",laughed\n"
};

test("Baby Tracker (Nighp): one CSV per activity", () => {
  const n = (f) => I.parseText(NIGHP[f], f, {});
  let r = n("Nursing.csv");
  assert.equal(r.source, "babytracker");
  assert.deepEqual([r.items[0].ls, r.items[0].rs, r.items[0].sd], [720, 480, "l"]);
  assert.equal(r.items[0].e - r.items[0].ts, 20 * 60000);
  assert.deepEqual(r.babies, { Mia: 1, Leo: 1 });
  assert.deepEqual(n("Formula.csv").items[0].x, "fm");
  r = n("Pumped.csv");
  assert.deepEqual([r.items[0].t, r.items[0].x, r.items[0].ml], ["bottle", "bm", 89]);
  r = n("Pump.csv");
  assert.deepEqual([r.items[0].t, r.items[0].ml, r.items[0].sd], ["pump", 100, "b"]);
  r = n("Sleep.csv");
  assert.equal(r.items[0].e - r.items[0].ts, 600 * 60000);
  r = n("Diaper.csv");
  assert.equal(r.items[0].x, "wd");
  assert.equal(r.skip.dry, 1);
  r = n("Growth.csv");
  assert.deepEqual([r.items[0].g, r.items[0].l, r.items[0].h], [4700, 570, 385]);
  assert.equal(n("Medicine.csv").items[0].tx, "Vitamin D 1 drop");
  assert.equal(n("Joy.csv").skip.Joy, 1);
});

test("Baby Tracker ZIP: entries combined; one baby of the file per child", async () => {
  const enc = new TextEncoder();
  const zip = Z.write(Object.keys(NIGHP).map((f) => ({ name: "BabyTracker/" + f, data: enc.encode(NIGHP[f]) })));
  const r = await I.readBytes(zip, "export.zip", {});
  assert.equal(r.source, "babytracker");
  assert.ok(r.items.length >= 9);
  assert.equal(I.pickBaby(r, "mia"), "Mia");
  assert.equal(I.pickBaby(r, "Leo Smith"), "Leo");
  const pl = I.plan(r, base(), { kid: KID, baby: "Leo", now: NOW });
  assert.equal(pl.ev.length, 1);
  assert.equal(pl.ev[0].sd, "r");
  const plMia = I.plan(r, base(), { kid: KID, baby: "Mia", now: NOW });
  assert.equal(plMia.ev.length, 6);                    // nursing, formula, pumped, sleep, nappy, medicine
  // 10/13/26 in Sleep.csv makes every file of the ZIP month-first
  assert.ok(plMia.ev.every((e) => new Date(e.ts).getMonth() === 9));
  assert.equal(plMia.gr.length, 1);
  // the pump file names no baby: it goes with the "" group
  const none = I.plan(r, base(), { kid: KID, baby: "", now: NOW });
  assert.equal(none.ev.length, 1);
  assert.equal(none.ev[0].t, "pump");
});

test("errors, caps and value parsers", async () => {
  assert.deepEqual(I.parseText("", "x.csv", {}), { error: "empty" });
  assert.deepEqual(I.parseText("a,b\n1,2\n", "x.csv", {}), { error: "bad" });
  assert.deepEqual(I.parseText("{nope", "x.json", {}), { error: "bad" });
  assert.deepEqual(await I.readBytes(new Uint8Array(I.MAX_FILE + 1), "x.csv", {}), { error: "big" });
  assert.equal(I.durSec("1:20:05"), 4805);
  assert.equal(I.durSec("00:25"), 1500);
  assert.equal(I.durSec("1h 5m"), 3900);
  assert.equal(I.durSec("12"), 720);
  assert.equal(I.mlOf("4 oz"), 118);
  assert.equal(I.gramsOf("7 lb 8 oz"), 3402);
  assert.equal(I.gramsOf("3500"), 3500);
  assert.equal(I.mmOf('20"'), 508);
  const long = "Type,Start,End,Duration,Start Condition,Start Location,End Condition,Notes\n" +
    "Note,2026-10-01 07:00,,,,,," + "y".repeat(5000) + "\n";
  const r = I.parseText(long, "x.csv", {});
  assert.ok(r.items[0].tx.length <= 200);
});
