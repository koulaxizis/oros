// Builds .github/qa/fixtures/<slice>.json for the sync convergence sweep
// (converge.js) from the sample states the record apps' own bundle tests
// already define (tests/bundle-<slice>.test.js: slice() / sample() /
// sampleState()). Most apps start empty, so without these the sweep would
// have no record to diverge on. A sample is kept only when its top-level
// keys match the app's real state (checked by converge.js at run time).
// Run: node .github/qa/make-fixtures.js   (then commit the JSON files)
"use strict";

const fs = require("fs");
const path = require("path");
const Module = require("module");

const ROOT = path.resolve(__dirname, "..", "..");
const OUT = path.join(__dirname, "fixtures");
fs.mkdirSync(OUT, { recursive: true });

const made = [], skipped = [];
for (const f of fs.readdirSync(path.join(ROOT, "tests")).filter((n) => /^bundle-[a-z]+\.test\.js$/.test(n)).sort()) {
  const slice = f.replace(/^bundle-|\.test\.js$/g, "");
  const file = path.join(ROOT, "tests", f);
  const src = fs.readFileSync(file, "utf8");
  const cut = src.search(/^test\(/m);
  const fn = ["slice", "sampleState", "sample"].find((n) => new RegExp("^function " + n + "\\(\\)", "m").test(src));
  if (cut < 0 || !fn) { skipped.push(slice + " (no sample function)"); continue; }
  const m = new Module(file, module);
  m.filename = file;
  m.paths = Module._nodeModulePaths(path.dirname(file));
  try {
    m._compile(src.slice(0, cut) + "\n;module.exports = " + fn + "();", file);
    const state = m.exports;
    if (!state || typeof state !== "object" || Array.isArray(state)) { skipped.push(slice + " (not an object)"); continue; }
    fs.writeFileSync(path.join(OUT, slice + ".json"), JSON.stringify({ source: "tests/" + f + " " + fn + "()", base: state }, null, 1) + "\n");
    made.push(slice);
  } catch (e) {
    skipped.push(slice + " (" + String(e.message).split("\n")[0] + ")");
  }
}
console.log("fixtures:", made.length, made.join(", "));
if (skipped.length) console.log("skipped:", skipped.join("; "));
