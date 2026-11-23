// Quick settings: Screenshot (Screen / Region) and the search field
// (QS-SHOT-1, video ideas 2026-11-23 #3).
// Run: node --test tests/

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const read = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");

test("the shell asks for the screen on the tap, draws one frame, stops sharing, hands it over once", () => {
  const sh = read("shell.js");
  const sec = sh.slice(sh.indexOf("  var shotHeld = null;"), sh.indexOf("  window.__orosTakeTarget = function"));
  assert.match(sec, /md\.getDisplayMedia\(\{ video: \{ cursor: "never" \}, audio: false/);
  assert.match(sec, /stop\(\);\s+shotHeld = cv \?/, "sharing stops right after the one frame");
  assert.match(sec, /window\.__orosOpenAt\("capture", \{ shot: kind \}\);/);
  assert.match(sec, /var s = shotHeld;\s+shotHeld = null;\s+return s && Date\.now\(\) - s\.at < 60000/, "once, for one minute");
  assert.match(sec, /if \(!md \|\| typeof md\.getDisplayMedia !== "function"\) \{ window\.__orosOpenAt\("capture", null\); return; \}/);
  assert.match(sh, /search: SOLO \? null : function \(text\) \{ ovToMenu\(String\(text \|\| ""\)\.slice\(0, 200\)\); \},/);
  assert.match(sh, /shot: SOLO \? null : function \(kind\) \{ if \(hasApp\("capture"\)\) shotTake\(kind === "region" \? "region" : "screen"\); \}/);
});

test("Quick settings: the pill, its two choices, the search field hands over to the menu", () => {
  const qs = read("qsettings.js");
  assert.match(qs, /parts\.shot = pill\(IC\.shot, then\(function \(\) \{ host\.shot\("screen"\); \}\)/);
  assert.match(qs, /menuItem\(IC\.region, t\("qs\.shot\.region"\), then\(function \(\) \{ host\.shot\("region"\); \}\)\)/);
  assert.match(qs, /parts\.shot\.box\.hidden = !canShot;/);
  assert.match(qs, /if \(!v\) return;\s+close\(\);\s+host\.search\(v\);/);
  assert.match(qs, /if \(typeof host\.search === "function"\) \{/);
  const tr = read("translations.js"), de = read("i18n/de/shell.js");
  for (const k of ["qs.shot", "qs.shot.more", "qs.shot.screen", "qs.shot.region", "qs.search", "qs.search.label"]) {
    assert.equal(tr.split('"' + k + '":').length - 1, 2, k);
    assert.ok(de.includes('"' + k + '":'), k + " DE");
  }
});

test("Screen Capture takes the picture from the parent once and shows it to crop", () => {
  const app = read("capture/app.js");
  assert.match(app, /if \(!target \|\| typeof target !== "object" \|\| \(target\.shot !== "screen" && target\.shot !== "region"\)\) return false;/);
  assert.match(app, /P\.__orosTakeShot\(\)/);
  assert.match(app, /window\.__orosOpenAt = function \(target\) \{ takeHeld\(target\); \};/);
  assert.match(app, /P\.__orosTakeTarget\("capture"\)/);
  assert.equal(app.split('"toast.region":').length - 1, 2);
  assert.ok(read("i18n/de/capture.js").includes('"toast.region":'));
  assert.match(read("capture/help.en.txt"), /## From Quick settings/);
  assert.match(read("capture/help.el.txt"), /## Από τις Γρήγορες ρυθμίσεις/);
});
