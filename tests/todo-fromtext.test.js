// To-Do "Tasks from text, photo or PDF" (todo/fromtext.js, TD-FT): the
// rules that split notes into tasks (bullets, numbering, check boxes,
// indented subtasks, headings, day headings, ";" lists, a picture's
// wrapped lines), days → due dates through calendar/quickadd.js, the
// AI answer's checks and the PDF text lines. The window itself is
// checked in the real shell (Playwright).
// Run: node --test tests/

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const F = require(path.join(ROOT, "todo/fromtext.js"));
const Q = require(path.join(ROOT, "calendar/quickadd.js"));

// 2026-11-27 is a Friday
const O = { today: "2026-11-27", quick: Q };
const split = (s, extra) => F.split(s, Object.assign({}, O, extra || {}));
const texts = (r) => r.tasks.map((x) => x.text);

test("one task per line, blank lines and duplicates dropped", () => {
  const r = split("Buy milk\n\ncall mom\nBuy  milk\n  \nx\n");
  assert.deepEqual(texts(r), ["Buy milk", "call mom"]);
  assert.equal(r.head, "");
});

test("bullets, numbering and check boxes", () => {
  const r = split("- one\n* two\n• three\n1. four\n2) five\n(6) six\na) seven\n- [ ] eight\n- [x] nine\n☐ ten\n☑ eleven");
  assert.deepEqual(texts(r), ["one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven"]);
  assert.equal(r.tasks.find((x) => x.text === "nine").done, true);
  assert.equal(r.tasks.find((x) => x.text === "eleven").done, true);
  assert.equal(r.tasks.find((x) => x.text === "eight").done, false);
});

test("an indented bullet is a subtask; an indented plain line continues", () => {
  const r = split("- Plan the trip\n  - book flights\n  - [x] hotel\n    near the station\n- Pack");
  assert.deepEqual(texts(r), ["Plan the trip", "Pack"]);
  assert.deepEqual(r.tasks[0].subs, [{ text: "book flights", done: false }, { text: "hotel near the station", done: true }]);
});

test("a heading names a new list; a day heading dates the tasks under it", () => {
  const r = split("Ψώνια:\n- γάλα\n- ψωμί");
  assert.equal(r.head, "Ψώνια");
  assert.deepEqual(texts(r), ["γάλα", "ψωμί"]);
  const d = split("Δευτέρα:\n- Σύσκεψη\nΤρίτη:\n- Κουρέας\nOther:\n- Free");
  assert.deepEqual(d.tasks.map((x) => [x.text, x.due]), [["Σύσκεψη", "2026-11-30"], ["Κουρέας", "2026-12-01"], ["Free", ""]]);
});

test("days become due dates and leave the text; times go to the notes", () => {
  const r = split("Call the bank by Monday\nΠήγαινε στο φαρμακείο αύριο\nSend invoice 15/12 at 10:00\nπλήρωσε ΔΕΗ έως 5/1\nevery Monday gym");
  assert.deepEqual(r.tasks.map((x) => [x.text, x.due]), [
    ["Call the bank", "2026-11-30"],
    ["Πήγαινε στο φαρμακείο", "2026-11-28"],
    ["Send invoice", "2026-12-15"],
    ["πλήρωσε ΔΕΗ", "2027-01-05"],
    ["every Monday gym", ""]                 // a repeat stays words
  ]);
  assert.equal(r.tasks[2].notes, "10:00");
  // without the date reader nothing is dated
  assert.equal(F.split("Call the bank by Monday", { today: O.today }).tasks[0].due, "");
});

test("p1–p3 set the priority and leave the text", () => {
  const r = split("Pay rent p1\np3 call mom\nplain p4\nPlan p2p");
  assert.deepEqual(r.tasks.map((x) => [x.text, x.prio]), [["Pay rent", 1], ["call mom", 3], ["plain", 0], ["Plan p2p", 0]]);
});

test("a line with two or more ';' is several tasks", () => {
  assert.deepEqual(texts(split("κουρέας; γυμναστήριο; ταχυδρομείο")), ["κουρέας", "γυμναστήριο", "ταχυδρομείο"]);
  assert.deepEqual(texts(split("Call Anna; ask Bob")), ["Call Anna; ask Bob"]);
});

test("from a picture: wrapped lines and broken words are joined, odd bullets read", () => {
  const r = split("e Order new cables for the\nstudio\ne Book the hall\ne Email Maria", { scan: true });
  assert.deepEqual(texts(r), ["Order new cables for the studio", "Book the hall", "Email Maria"]);
  const w = split("Finish the report for the meet-\ning\nEmail Maria", { scan: true });
  assert.deepEqual(texts(w), ["Finish the report for the meeting", "Email Maria"]);
  // each bullet of a picture read as another mark
  assert.deepEqual(texts(split("* Αγορά καλωδίων\n- Call the printer\n« Book the hall", { scan: true })), ["Αγορά καλωδίων", "Call the printer", "Book the hall"]);
  // typed text keeps its lines even when one starts with a small letter
  assert.deepEqual(texts(split("buy milk\ncall mom")), ["buy milk", "call mom"]);
});

test("limits: at most MAX tasks, text length, control characters", () => {
  const many = Array.from({ length: 260 }, (_, i) => "task number " + i).join("\n");
  const r = split(many);
  assert.equal(r.tasks.length, F.MAX);
  assert.equal(r.capped, true);
  const long = split("a".repeat(50) + " " + "b".repeat(400));
  assert.ok(long.tasks[0].text.length <= 300);
  assert.deepEqual(texts(split("bad\u0007 one two")), ["bad one two"]);
});

test("the AI's answer is checked like the rules' result", () => {
  const r = F.fromAi('Sure: [{"text":"Buy milk","due":"2026-11-28","subs":["2 litres"]},"Call mom",' +
    '{"text":"Buy milk"},{"text":"x"},{"text":"Pay","due":"tomorrow"},{"text":"<b>Bold</b>","due":"2026-02-31x"}] done', O);
  assert.deepEqual(r.tasks.map((x) => [x.text, x.due]), [["Buy milk", "2026-11-28"], ["Call mom", ""], ["Pay", ""], ["<b>Bold</b>", ""]]);
  assert.deepEqual(r.tasks[0].subs, [{ text: "2 litres", done: false }]);
  assert.equal(F.fromAi("no list here", O), null);
  assert.equal(F.fromAi("[1, 2", O), null);
  assert.equal(F.fromAi("[]", O), null);
  assert.match(F.aiPrompt("2026-11-27"), /Today is 2026-11-27/);
  assert.match(F.aiPrompt("bad"), /Today is unknown/);
});

test("PDF text items become lines, top to bottom, page by page", () => {
  const txt = F.pdfText([
    { x: 50, y: 700.5, s: "milk", p: 1 }, { x: 10, y: 700, s: "• Buy", p: 1 },
    { x: 10, y: 680, s: "• Call", p: 1 }, { x: 10, y: 600, s: "Later", p: 1 },
    { x: 10, y: 700, s: "Page two", p: 2 }, { x: "bad", y: 1, s: "no" }, null
  ]);
  assert.equal(txt, "• Buy milk\n• Call\n\nLater\n\nPage two");
  assert.deepEqual(texts(split(txt)), ["Buy milk", "Call", "Later", "Page two"]);
});
