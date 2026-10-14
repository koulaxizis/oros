// Workouts Assistant entry card (BR-W8-6): normAsNew cleans the
// shell's { asNew } payload for the "Log a workout" dialog. The app
// is a browser IIFE, so sections 1–4 are cut out of the source as in
// fitness.test.js. Run: node --test tests/

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { webcrypto } = require("crypto");

const src = fs.readFileSync(path.join(__dirname, "..", "fitness/fitness.js"), "utf8");
function block(from, to) {
  const i = src.indexOf(from), j = src.indexOf(to, i);
  if (i < 0 || j < 0) throw new Error("missing block " + from);
  return src.slice(i, j);
}
function build(lang) {
  return new Function("crypto",
    "var LANG = " + JSON.stringify(lang) + ";\n" +
    block("  var STORAGE_KEY", "  // ---------- 1.") +
    block("  var STRINGS", "  function newId(") +
    block("  // ---------- 2. Ready", "  // ---------- 5. Storage") +
    "\nreturn { normAsNew, emptyData };")(webcrypto);
}
const F = build("en");
const TODAY = "2026-10-14";

test("fitness asNew: needs type, minutes, distance or note", () => {
  const d = F.emptyData();
  assert.equal(F.normAsNew(d, null, TODAY), null);
  assert.equal(F.normAsNew(d, { date: "2026-10-01", start: "07:00" }, TODAY), null);
  assert.equal(F.normAsNew(d, { minutes: 0, distanceKm: -1, type: " " }, TODAY), null);
  assert.deepEqual(F.normAsNew(d, { note: " easy \r\n day " }, TODAY),
    { ex: "", ti: "", mins: 0, dist: 0, n: "easy \n day", d: TODAY, st: "" });
});

test("fitness asNew: activity match, numbers, date and time", () => {
  const d = F.emptyData();
  const v = F.normAsNew(d, { type: "running", minutes: 31.6, distanceKm: 5.25, date: "2026-10-12", start: "7:05", x: 1 }, TODAY);
  assert.deepEqual(v, { ex: "x-run", ti: "running", mins: 32, dist: 5250, n: "", d: "2026-10-12", st: "07:05" });
  assert.equal(F.normAsNew(d, { type: "Τρέξιμο" }, TODAY).ex, "x-run");
  assert.equal(F.normAsNew(d, { type: "ride" }, TODAY).ex, "x-bike");
  assert.equal(F.normAsNew(d, { type: "plank" }, TODAY).ex, "x-plank");
  assert.equal(F.normAsNew(d, { type: "Bench press" }, TODAY).ex, "");      // not timed: title only
  assert.equal(F.normAsNew(d, { type: "Yoga" }, TODAY).ti, "Yoga");
  assert.equal(F.normAsNew(d, { type: "r", distance: 2 }, TODAY).dist, 2000);
  assert.equal(F.normAsNew(d, { type: "r", minutes: 1441 }, TODAY).mins, 0);
  assert.equal(F.normAsNew(d, { type: "r", distanceKm: 1001 }, TODAY).dist, 0);
  assert.equal(F.normAsNew(d, { type: "r", date: "2026-10-15" }, TODAY).d, TODAY);   // future
  assert.equal(F.normAsNew(d, { type: "r", date: "2026-02-30" }, TODAY).d, TODAY);
  assert.equal(F.normAsNew(d, { type: "r", start: "25:00" }, TODAY).st, "");
  assert.equal(F.normAsNew(d, { type: "x".repeat(99) }, TODAY).ti.length, 60);
});
