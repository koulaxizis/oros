// Screen Capture: the pure helpers (file names, crop maths, options).
// Run: node --test tests/
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const C = require("../capture/core.js");

test("options: unknown values fall back to the defaults", () => {
  assert.deepEqual(C.prefs(null), { delay: 0, cursor: true, edit: false });
  assert.deepEqual(C.prefs({ delay: 7, cursor: "no", edit: 1 }), { delay: 0, cursor: true, edit: false });
  assert.deepEqual(C.prefs({ delay: 5, cursor: false, edit: true }), { delay: 5, cursor: false, edit: true });
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
