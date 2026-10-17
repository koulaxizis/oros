// Files: Atelier's Assets folder (hundreds of pictures) in grid view,
// and opening a picture from inside the app frame.
"use strict";
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const css = fs.readFileSync(path.join(root, "files/files.css"), "utf8");
const js = fs.readFileSync(path.join(root, "files/files.js"), "utf8");

test("grid rows keep their height once the grid overflows", () => {
  const grid = css.match(/#entries\.grid \{[^}]*\}/)[0];
  assert.match(grid, /grid-auto-rows:\s*max-content/);
  assert.match(css, /#entries\.grid \.entry \.glyph \{[^}]*flex-shrink:\s*0/);
});

test("picture preview accepts a Blob from the shell's realm", () => {
  const fn = js.slice(js.indexOf("function renderImagePreview"), js.indexOf("function bs64ToBlob"));
  assert.ok(!/data instanceof Blob/.test(fn), "instanceof Blob is false for the parent frame's Blob");
  assert.match(fn, /\[object Blob\]/);
});
