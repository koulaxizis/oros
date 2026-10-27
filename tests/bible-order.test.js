// OROS_BIBLE.md Part XII (the changelog) stays in ascending order (R21):
//   - entry dates never go back
//   - entries that name an APP_VERSION (X.YY.ZZ) never go back either
// Parallel PRs used to insert their entries near the top of a newest-first
// run, which scrambled the order; this test catches that in the PR itself.
// Run: node --test tests/

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const bible = fs.readFileSync(path.join(__dirname, "..", "OROS_BIBLE.md"), "utf8");

function part12Headings() {
  const i = bible.indexOf("\n## Part XII");
  assert.ok(i >= 0, "Part XII heading not found");
  return bible.slice(i).split("\n")
    .filter((l) => l.startsWith("### "))
    .map((l) => l.slice(4))
    .filter((t) => !t.startsWith("Condensed history"));
}

const DATE = /^(?:≈)?(\d{4}-\d{2}-\d{2})/;
const VER = /(\d+)\.(\d{2})\.(\d{2})(?!\d)/g;

function versionOf(title) {
  const all = [...title.matchAll(VER)];
  if (!all.length) return null;
  const m = all[all.length - 1];
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}
const cmp = (a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
const fmt = (v) => v[0] + "." + String(v[1]).padStart(2, "0") + "." + String(v[2]).padStart(2, "0");

test("every Part XII entry starts with a date", () => {
  const bad = part12Headings().filter((t) => !DATE.test(t));
  assert.deepEqual(bad, [], "entries without a YYYY-MM-DD date");
});

test("Part XII entries are in ascending date and APP_VERSION order", () => {
  let prevDate = "", prevVer = [0, 0, 0], prevTitle = "";
  const problems = [];
  for (const t of part12Headings()) {
    const m = DATE.exec(t);
    if (!m) continue;
    const d = m[1], v = versionOf(t);
    if (d < prevDate) {
      problems.push(`"${t}" (${d}) comes after "${prevTitle}" (${prevDate})`);
    } else if (v && cmp(v, prevVer) < 0) {
      problems.push(`"${t}" (${fmt(v)}) comes after an entry with ${fmt(prevVer)}`);
    }
    prevDate = d;
    if (v) prevVer = v;
    prevTitle = t;
  }
  assert.deepEqual(problems, [],
    "Part XII is oldest first, newest at the bottom (R21). Put a new entry after the " +
    "last entry with a lower APP_VERSION, normally at the very end of the file.");
});
