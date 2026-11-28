// Notes opened with ?standalone has no shell and no sync by design:
// it must say so once as info, not retry into a console error
// (user-journeys 2026-11-28 #1). With a shell parent the retry and
// the error stay.
"use strict";
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");

const src = fs.readFileSync(path.join(__dirname, "..", "notes", "notes.js"), "utf8");
const fn = src.slice(src.indexOf("function registerNotesSlice()"),
  src.indexOf("// ---------- 9. Wiring & boot"));

test("standalone Notes logs info and returns before the retry", () => {
  const standalone = fn.indexOf("window.parent !== window");
  const info = fn.indexOf("console.info(");
  const retry = fn.indexOf("setInterval(");
  assert.ok(standalone > 0 && info > standalone, "standalone check then info");
  assert.ok(retry > info, "retry only after the standalone return");
  assert.ok(/console\.info\([^)]*\);\s*return;/.test(fn), "returns after info");
});

test("embedded Notes still reports a missing orosSync as an error", () => {
  assert.ok(fn.indexOf("console.error('[notes] CRITICAL") > fn.indexOf("setInterval("));
});
