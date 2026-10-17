// App interop wave 4 (BR-S1-5): twelve record apps open their data in
// Spreadsheet — each sender guards on the shell bridge, caps the rows
// (498 with a SUM row, since the receiver keeps 500 rows in all), has
// its label in EN and EL and a help line; the shared table builders
// give numbers, not formatted text.
// Run: node --test tests/

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const src = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");

const SENDERS = {
  timesheet: ["timesheet/timesheet.js"],
  fitness: ["fitness/fitness.js"],
  health: ["health/health.js"],
  water: ["water/water.js"],
  mood: ["mood/mood.js"],
  garage: ["garage/garage.js"],
  invoices: ["invoices/invoices.js"],
  crm: ["crm/crm.js"],
  library: ["library/home.js", "library/strings.js"],
  shelf: ["shelf/shelf.js"],
  split: ["split/split.js"],
  meals: ["meals/meals.js"]
};

test("every record app sends a BR-S1 newSheet through the shell bridge", () => {
  for (const [app, files] of Object.entries(SENDERS)) {
    const s = files.map(src).join("\n");
    assert.match(s, /\("spreadsheet", \{ newSheet: \{/, app + " opens a new sheet");
    assert.match(s, /typeof [\w.]+\.__orosOpenAt === "function"/, app + " checks the bridge first");
    assert.match(s, /49[89]/, app + " caps the rows");
    assert.ok(s.includes("Open in Spreadsheet"), app + " has the EN label");
    assert.ok(s.includes("Άνοιγμα στο Υπολογιστικό φύλλο"), app + " has the EL label");
    assert.doesNotMatch(s.slice(s.indexOf("newSheet") - 1500, s.indexOf("newSheet")), /innerHTML\s*=\s*[^"']/, app + " builds no HTML from data");
  }
});

test("every record app's help mentions Spreadsheet in both languages", () => {
  for (const app of Object.keys(SENDERS)) {
    assert.match(src(app + "/help.en.txt"), /app:spreadsheet|Spreadsheet/, app + " help EN");
    assert.match(src(app + "/help.el.txt"), /app:spreadsheet|Υπολογιστικ/, app + " help EL");
  }
});

test("shared table builders: numbers stay numbers, the CSV comes from the same rows", () => {
  const W = require(path.join(ROOT, "water/core.js"));
  const data = { sips: [{ id: "a", ts: new Date(2026, 9, 1, 8, 5).getTime(), ml: 250 }, { id: "b", ts: 1, ml: 9, del: 1 }] };
  const tbl = W.toTable(data);
  assert.deepEqual(tbl, [["date", "time", "ml"], ["2026-10-01", "08:05", 250]]);
  assert.equal(W.toCsv(data), "date,time,ml\r\n2026-10-01,08:05,250\r\n");
  const I = require(path.join(ROOT, "invoices/core.js"));
  assert.ok(Array.isArray(I.DOCS_MONEY) && I.DOCS_MONEY.length === 2, "invoices money columns");
  assert.equal(typeof I.docsRows, "function");
  const T = require(path.join(ROOT, "timesheet/core.js"));
  assert.equal(typeof T.toTable, "function");
});
