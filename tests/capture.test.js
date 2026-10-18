// Screen Capture: the pure helpers (file names, crop maths, options).
// Run: node --test tests/
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const C = require("../capture/core.js");

test("options: unknown values fall back to the defaults", () => {
  const def = { mode: "shot", delay: 0, cursor: true, edit: false, sys: true, mic: false, montage: false };
  assert.deepEqual(C.prefs(null), def);
  assert.deepEqual(C.prefs({ mode: "video", delay: 7, cursor: "no", edit: 1, mic: "yes" }), def);
  assert.deepEqual(C.prefs({ mode: "rec", delay: 5, cursor: false, edit: true, sys: false, mic: true, montage: true }),
    { mode: "rec", delay: 5, cursor: false, edit: true, sys: false, mic: true, montage: true });
});

test("file names sort by time and have no characters Windows refuses", () => {
  const d = new Date(2026, 9, 8, 9, 5, 3);
  assert.equal(C.fileName("Screenshot", d, "png"), "Screenshot 2026-10-08 09-05-03.png");
  assert.equal(C.fileName("Στιγμιότυπο", d), "Στιγμιότυπο 2026-10-08 09-05-03.png");
  assert.equal(C.fileName('a:b/c"', d), "a b c 2026-10-08 09-05-03.png");
  assert.doesNotMatch(C.fileName("x", d), /[\\/:*?"<>|]/);
});

test("a taken name gets a number before the extension", () => {
  assert.equal(C.pathFor("s.png", 1), "/internal/Pictures/s.png");
  assert.equal(C.pathFor("s.png", 3), "/internal/Pictures/s (3).png");
  assert.equal(C.pathFor("r.webm", 2, C.VIDEOS), "/internal/Videos/r (2).webm");
});

test("a drag on a half-size preview crops the full-size picture", () => {
  // preview 960×540 of a 1920×1080 picture, dragged right-to-left, bottom-to-top
  assert.deepEqual(C.cropRect(500, 300, 100, 50, 960, 540, 1920, 1080), { x: 200, y: 100, w: 800, h: 500 });
});

test("a drag past the edge stays inside the picture", () => {
  assert.deepEqual(C.cropRect(-40, -10, 2000, 900, 960, 540, 1920, 1080), { x: 0, y: 0, w: 1920, h: 1080 });
});

test("a click or a tiny drag keeps the whole picture", () => {
  assert.equal(C.cropRect(10, 10, 12, 40, 960, 540, 1920, 1080), null);
  assert.equal(C.cropRect(10, 10, 300, 300, 0, 0, 1920, 1080), null);
});

test("the overlay is the crop in percentages", () => {
  assert.deepEqual(C.rectStyle({ x: 480, y: 270, w: 960, h: 540 }, 1920, 1080), { left: 25, top: 25, width: 50, height: 50 });
  assert.equal(C.rectStyle(null, 1920, 1080), null);
});

test("the recorder prefers MP4, then WebM, and says when it cannot record", () => {
  assert.equal(C.recType(() => true), "video/mp4;codecs=avc1,mp4a");
  assert.equal(C.recType((t) => /webm/.test(t)), "video/webm;codecs=vp9,opus");
  assert.equal(C.recType((t) => t === "video/webm"), "video/webm");
  assert.equal(C.recType(() => false), "");
  assert.equal(C.recType(undefined), null);
  assert.equal(C.recExt("video/mp4"), "mp4");
  assert.equal(C.recExt("video/webm;codecs=vp9"), "webm");
  assert.equal(C.recExt(""), "webm");
});

test("recording time and size read like a clock and a file size", () => {
  assert.equal(C.clock(0), "0:00");
  assert.equal(C.clock(75000), "1:15");
  assert.equal(C.clock(3725000), "1:02:05");
  assert.equal(C.clock(-5), "0:00");
  assert.equal(C.size(0), "0.0 MB");
  assert.equal(C.size(1048576 * 12.4), "12 MB");
  assert.equal(C.size(1048576 * 1536), "1.5 GB");
});
