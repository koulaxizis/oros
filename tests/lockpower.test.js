// Lock-screen power buttons (LOCKPOW-1, video ideas 2026-11-23 #11):
// orOS gives the lock screen an empty box and tells the system part
// (orOS USB / Portable / installed, oros-usb extension) when the lock
// opens and closes; the system part fills it with Sleep, Restart and
// Shut down. In a browser the box stays empty and hidden.
// Run: node --test tests/

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const read = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");
const L = read("lock.js");

test("an empty, labelled box on the lock screen for the system part", () => {
  assert.match(L, /pow\.id = "lock-power-sys";/);
  assert.match(L, /pow\.setAttribute\("aria-label", t\("lock\.power"\)\);/);
  assert.doesNotMatch(L.slice(L.indexOf('pow.id = "lock-power-sys"'), L.indexOf("main.addEventListener(\"submit\"")), /appendChild\(node\("button"/,
    "orOS itself adds no power buttons");
  const css = read("style.css");
  assert.match(css, /#oros-lock \.lk-power:empty \{ display: none; \}/);
  assert.match(css, /#oros-lock \.lk-pow \{/);
});

test("the DOM event 'oros-lock' says open and close (a string, it crosses the extension's world)", () => {
  assert.match(L, /doc\.dispatchEvent\(new CustomEvent\("oros-lock", \{ detail: what \}\)\)/);
  assert.match(L, /sysEvent\("open"\);\n    emit\(\);\n    return true;/);
  assert.match(L, /d\.parentNode\.removeChild\(d\);\n      sysEvent\("close"\);/);
});

test("strings in EN, EL and DE", () => {
  assert.equal(read("translations.js").split('"lock.power":').length - 1, 2);
  assert.ok(read("i18n/de/shell.js").includes('"lock.power":'));
});
