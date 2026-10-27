// OROS_BIBLE.md Part XII (the changelog) stays in ascending order (R21):
//   - entry dates never go back
//   - entries that name an APP_VERSION (X.YY.ZZ) never go back either
// R40: a parallel PR whose higher version merged first keeps its place; the
// later PR's entry goes just before it. On failure the test names the
// misplaced entry and where it belongs.
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

// Each entry as { title, date, ver }; an entry without a version keeps the
// version of the entry before it, so it only has to respect the date.
function entries() {
  return part12Headings().filter((t) => DATE.test(t))
    .map((t) => ({ title: t, date: DATE.exec(t)[1], ver: versionOf(t) }));
}

// The pairs that go back in date or APP_VERSION, as messages.
function problemsIn(list) {
  let prevDate = "", prevVer = [0, 0, 0], prevTitle = "";
  const problems = [];
  for (const e of list) {
    if (e.date < prevDate) {
      problems.push(`"${e.title}" (${e.date}) comes after "${prevTitle}" (${prevDate})`);
    } else if (e.ver && cmp(e.ver, prevVer) < 0) {
      problems.push(`"${e.title}" (${fmt(e.ver)}) comes after an entry with ${fmt(prevVer)}`);
    }
    prevDate = e.date;
    if (e.ver) prevVer = e.ver;
    prevTitle = e.title;
  }
  return problems;
}

// For a single misplaced entry: which one it is and where it belongs (R40:
// after the last entry it may follow, so just before the first entry with a
// higher date or version that merged first).
function whereItBelongs(list) {
  const moves = [];
  for (let i = 0; i < list.length; i++) {
    const rest = list.slice(0, i).concat(list.slice(i + 1));
    if (problemsIn(rest).length) continue;
    let at = -1;
    for (let j = 0; j <= rest.length; j++) {
      if (!problemsIn(rest.slice(0, j).concat([list[i]], rest.slice(j))).length) at = j;
    }
    if (at < 0) continue;
    const after = at > 0 ? `just after "${rest[at - 1].title}"` : "at the start of Part XII";
    const before = at < rest.length ? ` and before "${rest[at].title}"` : " (the very end of Part XII)";
    moves.push(`Move "${list[i].title}" ${after}${before}.`);
  }
  return moves;
}

test("Part XII entries are in ascending date and APP_VERSION order", () => {
  const list = entries();
  const problems = problemsIn(list);
  if (!problems.length) return;
  const moves = whereItBelongs(list);
  assert.fail(
    "Part XII is oldest first, newest at the bottom (R21, R40). A new entry goes after the " +
    "last entry with a lower date and APP_VERSION, normally at the very end of the file; " +
    "when a parallel PR with a higher version merged first, just before that entry.\n" +
    (moves.length ? "Where the entry belongs:\n  " + moves.join("\n  ") + "\n" : "") +
    "Out of order:\n  " + problems.join("\n  "));
});

test("the order check names where a misplaced entry belongs", () => {
  const e = (title) => ({ title, date: DATE.exec(title)[1], ver: versionOf(title) });
  const a = e("2026-10-26 — A (3.95.00)"), b = e("2026-10-26 — B (3.96.00)");
  const c = e("2026-10-27 — C (3.97.00)"), d = e("2026-10-27 — D (3.98.00)");
  // C landed at the top, as parallel PRs used to do it.
  const moves = whereItBelongs([c, a, b, d]);
  assert.deepEqual(moves, [`Move "${c.title}" just after "${b.title}" and before "${d.title}".`]);
  // Newest at the bottom passes.
  assert.deepEqual(problemsIn([a, b, c, d]), []);
});
