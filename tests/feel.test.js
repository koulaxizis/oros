// Motion feel (FEEL-1, video ideas 2026-11-23 #6): Calm / Lively /
// Bouncy for the app zoom, menus and panels; Reduce motion always wins.
// Run: node --test tests/

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const read = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");

test("Lively is the timing from before; the zoom takes the feel's timings", () => {
  const sh = read("shell.js");
  assert.match(sh, /lively: \{ open: ZOOM_OPEN_MS, close: ZOOM_CLOSE_MS, ease: "cubic-bezier\(\.2,\.8,\.2,1\)", easeClose: "cubic-bezier\(\.4,0,\.6,1\)" \}/);
  assert.match(sh, /return FEELS\[v\] \? v : "lively";/);
  assert.match(sh, /duration: FEELS\[feelNow\(\)\]\.open, easing: FEELS\[feelNow\(\)\]\.ease/);
  assert.match(sh, /duration: FEELS\[feelNow\(\)\]\.close, easing: FEELS\[feelNow\(\)\]\.easeClose/);
  assert.match(sh, /try \{ if \(f === "lively"\) de\.removeAttribute\("data-oros-feel"\); else de\.setAttribute\("data-oros-feel", f\);/);
  assert.match(sh, /case "feel":\s+feelSetUser\(String\(value \|\| ""\)\); return;/);
});

test("Reduce motion wins: orOS's own and the system's", () => {
  const sh = read("shell.js"), css = read("style.css");
  assert.match(sh, /if \(de && de\.hasAttribute && de\.hasAttribute\("data-oros-motion"\)\) return false;/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\) \{ #app-menu\.open, #qs-panel, #oros-notif-panel \{ animation: none; \} \}/);
  assert.match(css, /html\[data-oros-motion\] :is\(#app-menu\.open, #qs-panel, #oros-notif-panel\) \{ animation: none !important; \}/);
  assert.match(css, /html\[data-oros-feel="bouncy"\] \{ --oros-pop-ms: 300ms;/);
});

test("Settings: Motion feel under the app zoom, EN/EL/DE", () => {
  const st = read("settings/settings.js"), core = read("settings/core.js"), de = read("i18n/de/settings.js");
  assert.match(st, /set\("feel", v\)/);
  assert.match(core, /\["feel", "appearance", "a\.feel", null, null, "zoom"\]/);
  for (const k of ["a.feel", "a.feel.hint", "a.feel.calm", "a.feel.lively", "a.feel.bouncy", "w.feel"]) {
    assert.equal(core.split('"' + k + '":').length - 1, 2, k);
    assert.ok(de.includes('"' + k + '":'), k + " DE");
  }
});
