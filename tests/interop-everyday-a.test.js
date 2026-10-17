// App interop, everyday links A: Meal Planner's shopping list → Budget
// (BR-B1, an amount asked in a small dialog, a prefill only) and
// Calendar's event → Timesheet ("Track time": __orosOpenAt("timesheet",
// { startTimer: { title } }), never stopping a running timer). Both
// senders guard on the shell bridge, have EN and EL labels and a help
// line; meals' parseAmount is pure and tested here.
// Run: node --test tests/

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const src = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");
const C = require(path.join(ROOT, "meals/core.js")).OrosMealsCore;

test("meals parseAmount: typed amount → integer cents, as Budget reads it", () => {
  const P = C.parseAmount;
  assert.equal(P("12,50"), 1250);
  assert.equal(P("12.50"), 1250);
  assert.equal(P("12,5"), 1250);
  assert.equal(P("7"), 700);
  assert.equal(P(" € 3,99 "), 399);
  assert.equal(P(".5"), 50);
  // Both separators: the last is the decimal point.
  assert.equal(P("1.234,5"), 123450);
  assert.equal(P("1,234.50"), 123450);
  // One separator + exactly three digits: thousands (Budget's rule).
  assert.equal(P("1.250"), 125000);
  for (const bad of ["0", "0,00", "abc", "", "-2", "12,345,6", "1,2,3", "12.555,5,5", null, 12]) {
    assert.equal(P(bad), null, JSON.stringify(bad));
  }
  assert.equal(P("12,505"), 1250500);
  assert.equal(P("12,5055"), null, "more than two decimals");
  assert.equal(P("1000000000"), 100000000000, "the shell's cap");
  assert.equal(P("1000000000,01"), null, "over the cap");
});

test("meals → Budget: shell-guarded button, BR-B1 payload, EN/EL, help", () => {
  const s = src("meals/meals.js"), h = src("meals/index.html");
  assert.match(h, /id="sh-bud" hidden/);
  assert.match(s, /typeof p\.__orosOpenBudgetNew === "function"/, "checks the bridge");
  assert.match(s, /\$\("sh-bud"\)\.hidden = !budgetBridge\(\)/, "hidden without the bridge");
  const i = s.indexOf("function shopToBudget"), body = s.slice(i, s.indexOf("function renderAll", i));
  assert.match(body, /C\.parseAmount\(fA\.value\)/, "parses the typed amount");
  assert.match(body, /\{ k: "o", a: a, c: "o-groc", d: today\(\), n: n, src: "meals" \}/, "payload");
  assert.match(body, /n\.length > 500/, "note capped at 500");
  assert.match(body, /res === false\) showToast\(t\("bud\.fail"\)\)/, "failure toast");
  assert.doesNotMatch(body, /innerHTML/, "no HTML from data");
  for (const k of ["Add to Budget", "How much did you pay?", "Shopping: {n} items", "Budget couldn't open this",
    "Στον Προϋπολογισμό", "Πόσα πλήρωσες;", "Ψώνια: {n} είδη", "Ο Προϋπολογισμός δεν μπόρεσε να το ανοίξει"]) {
    assert.ok(s.includes(k), k);
  }
  assert.match(src("meals/help.en.txt"), /`Add to Budget`.*app:budget/);
  assert.match(src("meals/help.el.txt"), /`Στον Προϋπολογισμό`.*app:budget/);
  // Budget really has the category the payload names.
  assert.match(src("budget/budget.js"), /id: "o-groc"/);
});

test("calendar → Timesheet: Track time sends startTimer, only with Timesheet installed", () => {
  const s = src("calendar/calendar.js"), h = src("calendar/index.html");
  assert.match(h, /id="ev-track" type="button" class="btn" data-i18n="ev\.track" hidden/);
  assert.match(s, /p\.__orosOpenAt\("timesheet", \{ startTimer: \{ title: title \} \}\)/);
  assert.match(s, /window\.parent\.orosAssistInstalled/);
  assert.match(s, /a && a\.id === "timesheet"/);
  assert.match(s, /dlgTrack = existing && tsInstalled && shellOpenAt\(\)/);
  assert.match(s, /\.slice\(0, 200\)/);
  assert.ok(s.includes('"ev.track": "Track time"') && s.includes('"ev.track": "Χρονομέτρηση"'));
  assert.match(src("calendar/help.en.txt"), /`Track time`.*app:timesheet/);
  assert.match(src("calendar/help.el.txt"), /`Χρονομέτρηση`.*app:timesheet/);
});

test("timesheet receives startTimer: documented, never stops a running timer", () => {
  const s = src("timesheet/timesheet.js");
  assert.match(s, /\{ startTimer: \{ title,\n\s*\/\/ note\? \} \}/, "documented in the target comment");
  assert.match(s, /if \(t\.startTimer && typeof t\.startTimer === "object"\) \{ startFromTarget\(t\.startTimer\); return; \}/);
  const i = s.indexOf("function startFromTarget"), body = s.slice(i, s.indexOf("window.__orosOpenAt = openSearchTarget", i));
  assert.match(body, /cleanText\([^)]*, 200\)/, "title ≤ 200");
  const run = body.indexOf("C.running(data).length"), start = body.indexOf("startTimer(pid");
  assert.ok(run > 0 && start > run, "checks for a running timer before starting");
  assert.match(body.slice(run, start), /showToast\(t\("toast\.alreadyRunning"\)\);\n\s*return;/, "running → toast, no start");
  assert.doesNotMatch(body, /stopAll|stopEntry|stopOne|toggleTimer/, "never stops anything itself");
  assert.match(body, /!p\.arch && String\(p\.name \|\| ""\)\.trim\(\)\.toLowerCase\(\) === key/, "project by name");
  assert.ok(s.includes('"toast.alreadyRunning": "A timer is already running. Stop it first."'));
  assert.ok(s.includes('"toast.alreadyRunning": "Ήδη μετράει ένα χρονόμετρο. Σταμάτησέ το πρώτα."'));
  assert.match(src("timesheet/help.en.txt"), /`Track time`.*app:calendar/);
  assert.match(src("timesheet/help.el.txt"), /`Χρονομέτρηση`.*app:calendar/);
});
