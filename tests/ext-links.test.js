// Phone/SMS/mail/map links inside an app frame (EXT-1): the shell
// takes them out of the frame and opens them from the top window, so
// the Android app shows the phone's app chooser instead of an error
// page inside the frame.
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const SHELL = fs.readFileSync(path.join(__dirname, "..", "shell.js"), "utf8");

test("EXT-1: every app frame is wired, the side and hidden ones too", () => {
  assert.match(SHELL, /appFrames\(\)\.forEach\(extWireFrame\)/);
  const mk = SHELL.slice(SHELL.indexOf("function mtNewFrame"), SHELL.indexOf("function mtDrop"));
  assert.match(mk, /extWireFrame\(f\)/);
});

test("EXT-1: only tel/sms/smsto/mailto/geo leave the frame", () => {
  const m = /var EXT_SCHEME = (\/[^\n]+\/i);/.exec(SHELL);
  assert.ok(m, "EXT_SCHEME present");
  const re = eval(m[1]);
  for (const ok of ["tel:+30690", "TEL:123", "sms:123", "smsto:1", "mailto:a@b.c", "geo:0,0?q=x"]) assert.ok(re.test(ok), ok);
  for (const no of ["https://x", "/maps/", "#tel:", "javascript:alert(1)", "intent://x", "telx:1", " tel:1"]) assert.ok(!re.test(no), no);
});

test("EXT-1: the unsaved-changes guard stays silent for a handoff", () => {
  const g = SHELL.slice(SHELL.indexOf('addEventListener("beforeunload"'));
  assert.match(g.slice(0, 400), /extHandoffAt < 2000\) return;/);
});
