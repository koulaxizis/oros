// New users, extra idea 1: keep your data safe (SAFE-1, shell.js).
// After orOS has started on 7 different days with neither sync nor an
// automatic backup, one card says so, once.
// Run: node --test tests/

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const read = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");
const SHELL = read("shell.js");

function cut(src, name) {
  const i = src.indexOf("  function " + name + "(");
  if (i < 0) throw new Error("missing function " + name);
  let depth = 0, j = src.indexOf("{", i);
  for (; j < src.length; j++) {
    if (src[j] === "{") depth++;
    else if (src[j] === "}" && --depth === 0) break;
  }
  return src.slice(i, j + 1);
}

const P = new Function("var SAFE_DAYS = 7;\n" + cut(SHELL, "safeNorm") + "\n" + cut(SHELL, "safeCount") + "\n" + cut(SHELL, "safeDue") +
  "\nreturn { safeNorm: safeNorm, safeCount: safeCount, safeDue: safeDue };")();

test("safe: anything odd in the record reads as a fresh start", () => {
  assert.deepEqual(P.safeNorm(null), { v: 1, n: 0, last: "" });
  assert.deepEqual(P.safeNorm([1]), { v: 1, n: 0, last: "" });
  assert.deepEqual(P.safeNorm({ n: "7", last: "yesterday" }), { v: 1, n: 0, last: "" });
  assert.deepEqual(P.safeNorm({ n: 3.7, last: "2026-11-11", done: true }), { v: 1, n: 3, last: "2026-11-11", done: 1 });
  assert.equal(P.safeNorm({ n: 1e9 }).n, 9999);
});

test("safe: one day counted per day, none after it was shown", () => {
  let r = P.safeCount(null, "2026-11-11");
  assert.deepEqual(r, { v: 1, n: 1, last: "2026-11-11" });
  r = P.safeCount(r, "2026-11-11");
  assert.equal(r.n, 1, "the same day again");
  r = P.safeCount(r, "2026-11-12");
  assert.equal(r.n, 2);
  assert.equal(P.safeCount({ n: 7, last: "2026-11-12", done: 1 }, "2026-11-13").n, 7, "shown: no more counting");
});

test("safe: due after 7 days only with no sync and no automatic backup, and only once", () => {
  const none = { sync: false, backup: "off" };
  assert.equal(P.safeDue({ n: 6, last: "x" }, none), false);
  assert.equal(P.safeDue({ n: 7 }, none), true);
  assert.equal(P.safeDue({ n: 30 }, { sync: false }), true, "no backup mode known = off");
  assert.equal(P.safeDue({ n: 7 }, { sync: true, backup: "off" }), false);
  assert.equal(P.safeDue({ n: 7 }, { sync: false, backup: "weekly" }), false);
  assert.equal(P.safeDue({ n: 7, done: 1 }, none), false);
});

test("safe: the shell's wiring and guards", () => {
  assert.match(SHELL, /var SAFE_KEY = "oros-safe", SAFE_DAYS = 7;/);
  assert.match(SHELL, /greetStart\(\);\n        safeStart\(\);/);
  const start = cut(SHELL, "safeStart");
  assert.match(start, /if \(SOLO\) return;/);
  assert.ok(start.indexOf("safeWrite(rec);") < start.indexOf("lateWhen("), "the day is counted at start");
  const may = cut(SHELL, "safeMaybe");
  assert.match(may, /if \(!safeDue\(rec, safeFacts\(\)\)\) return;/);
  assert.match(may, /if \(tour \|\| tourBox \|\| profilesBusy\) return;/);
  assert.match(may, /if \(state\.running \|\| late\.open\) return;/);
  assert.match(may, /L\.isLocked\(\)/);
  assert.match(may, /greetBox/, "waits for the greeting");
  assert.ok(may.indexOf("rec.done = 1;") < may.indexOf("safeShow();") && may.indexOf("safeWrite(rec);") < may.indexOf("safeShow();"), "marked before it shows");
  const facts = cut(SHELL, "safeFacts");
  assert.match(facts, /window\.orosSync\.isConnected\(\)/);
  assert.match(facts, /state\.autoexport/);
  assert.doesNotMatch(facts, /setItem|removeItem/);
  const show = cut(SHELL, "safeShow");
  assert.doesNotMatch(show, /innerHTML/);
  assert.match(show, /\["safe\.sync", "sync", "safe-main"\], \["safe\.backup", "backup", ""\]/);
  assert.match(show, /window\.orosSettings\.open\(section\)/);
  assert.match(cut(SHELL, "openApp"), /safeEnd\(\);/);
});

test("safe: strings EN, EL, DE; styles; help", () => {
  const tr = read("translations.js"), sde = read("i18n/de/shell.js");
  const en = tr.slice(0, tr.indexOf("\n  el: {")), el = tr.slice(tr.indexOf("\n  el: {"));
  for (const k of ["safe.title", "safe.text", "safe.sync", "safe.backup", "safe.close"]) {
    assert.ok(en.includes('"' + k + '":') && el.includes('"' + k + '":') && sde.includes('"' + k + '":'), k);
  }
  const css = read("style.css");
  assert.match(css, /#oros-safe \{/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\) \{ #oros-safe \{ animation: none; \} \}/);
  assert.match(css, /html\[data-oros-contrast="high"\] #oros-safe \{/);
  assert.match(read("help/topics/backup.en.txt"), /## A reminder to keep a copy/);
  assert.match(read("help/topics/backup.el.txt"), /## Υπενθύμιση για αντίγραφο/);
});
