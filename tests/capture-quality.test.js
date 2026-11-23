// Screen Capture recording quality (CAPQ-1, video ideas 2026-11-23 #10):
// resolution, 30 / 60 fps, quality with about N MB a minute, and the
// orOS panels close before a recording starts.
// Run: node --test tests/

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const read = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");
const C = require(path.join(ROOT, "capture/core.js"));

test("prefs: As shared, 30 fps, Standard by default; odd values fall back", () => {
  const p = C.prefs(null);
  assert.equal(p.res, "auto"); assert.equal(p.fps, 30); assert.equal(p.q, "std");
  const q = C.prefs({ res: "720", fps: 60, q: "high" });
  assert.equal(q.res, "720"); assert.equal(q.fps, 60); assert.equal(q.q, "high");
  const r = C.prefs({ res: "4k", fps: 144, q: "ultra" });
  assert.equal(r.res, "auto"); assert.equal(r.fps, 30); assert.equal(r.q, "std");
});

test("bitrate and MB a minute grow with resolution, frames and quality", () => {
  const std = C.prefs({});
  assert.equal(C.videoBps(std), 6000000);
  assert.equal(C.videoBps(C.prefs({ q: "low" })), 3000000);
  assert.equal(C.videoBps(C.prefs({ q: "high", fps: 60 })), 14400000);
  assert.equal(C.videoBps(C.prefs({ res: "480", q: "low" })), 660000);
  assert.equal(C.mbPerMin(std, false), 45);
  assert.equal(C.mbPerMin(std, true), 46);
  assert.equal(C.mbPerMin(C.prefs({ res: "480", q: "low" }), false), 5);
  assert.ok(C.mbPerMin(C.prefs({ q: "high", fps: 60 }), true) > C.mbPerMin(std, true));
});

test("the screen is asked at the chosen frame rate and height", () => {
  assert.deepEqual(C.recVideo(C.prefs({ fps: 60, res: "720" })), { cursor: "always", frameRate: { ideal: 60, max: 60 }, height: { max: 720 } });
  assert.deepEqual(C.recVideo(C.prefs({ cursor: false })), { cursor: "never", frameRate: { ideal: 30, max: 30 } });
});

test("wiring: recorder bitrate, panels close, controls and strings", () => {
  const A = read("capture/app.js"), H = read("capture/index.html");
  assert.match(A, /video: prefs\.mode === "rec" \? C\.recVideo\(prefs\)/, "screenshots keep the full picture");
  assert.match(A, /videoBitsPerSecond: C\.videoBps\(prefs\), audioBitsPerSecond: C\.AUDIO_BPS/);
  assert.match(A, /function startRec\(\) \{\n    if \(!stream \|\| rec \|\| counting\) return;\n    calmScreen\(\);/);
  assert.match(read("shell.js"), /window\.__orosCalmScreen = function \(\) \{/);
  for (const id of ["opt-res", "fps", "opt-q", "q-size"]) assert.ok(H.includes('id="' + id + '"'), id);
  const de = read("i18n/de/capture.js");
  for (const k of ["opt.res", "opt.res.auto", "opt.fps", "opt.q", "opt.q.low", "opt.q.std", "opt.q.high", "opt.size"]) {
    assert.equal(A.split('"' + k + '":').length - 1, 2, k);
    assert.ok(de.includes('"' + k + '":'), "de " + k);
  }
});
