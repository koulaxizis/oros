// Notifications panel: clicking a notice that opens a window or an
// app closes the panel (Chris 2026-10-13: the update notice opened
// "What's new" and the panel stayed on top). The DOM click itself is
// checked in the real shell (PR notes).
// Run: node --test tests/

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const src = fs.readFileSync(path.join(__dirname, "..", "notifications.js"), "utf8");

function loadOpenTarget(bridges) {
  const start = src.indexOf("  function openTarget(item) {");
  const end = src.indexOf("\n  }\n", start) + 4;
  assert.ok(start > 0 && end > start, "openTarget found");
  return new Function("DL_BRIDGES", src.slice(start, end) + "\nreturn openTarget;")(bridges);
}

test("openTarget reports whether a window or app was opened", () => {
  const calls = [];
  const open = loadOpenTarget({
    help: (t) => calls.push(["help", t]),
    calendar: (id, ymd) => calls.push(["calendar", id, ymd]),
    mood: (id) => calls.push(["mood", id])
  });
  assert.equal(open({ deepLink: "help:whats-new" }), true);
  assert.equal(open({ deepLink: "calendar:ev1:2026-10-13" }), true);
  assert.equal(open({ deepLink: "mood:entry:e1" }), true);
  assert.equal(open({ deepLink: "nope:x" }), false);         // no bridge
  assert.equal(open({ deepLink: "mood" }), false);           // no payload
  assert.equal(open({ deepLink: "constructor:x" }), false);  // own keys only
  assert.equal(open({}), false);
  assert.equal(open(null), false);
  assert.deepEqual(calls, [["help", "whats-new"], ["calendar", "ev1", "2026-10-13"], ["mood", "e1"]]);
});

test("panel item click closes the panel when the notice opened something", () => {
  const start = src.indexOf("  function renderPanelItems(container) {");
  const body = src.slice(start, src.indexOf("\n  function ", start + 10));
  assert.match(body, /const opened = openTarget\(item\);/);
  assert.match(body, /if \(opened\) closeNotificationPanel\(\);/);
});

test("an OS notification click follows the deep link like the in-tab toast", () => {
  const start = src.indexOf("wn.onclick = function () {");
  assert.ok(start > 0);
  const body = src.slice(start, src.indexOf("};", start));
  assert.match(body, /openTarget\(item\);/);
  assert.match(body, /markItemRead\(item\);/);
});
