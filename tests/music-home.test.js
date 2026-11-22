// MU-HOME: Music always starts on Home (the last tab is not restored),
// so the recommendations are never hidden behind the Search tab.
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const src = fs.readFileSync(path.join(__dirname, "..", "music", "music.js"), "utf8");

test("prefs start on the Home tab", () => {
  assert.match(src, /var p = \{ tab: "home",/);
});

test("the saved tab is never restored at start", () => {
  assert.doesNotMatch(src, /p\.tab\s*=\s*o\.tab/);
});

// MU-NOW: the playing row shows bars and a tinted ground, not only the accent colour.
const css = fs.readFileSync(path.join(__dirname, "..", "music", "music.css"), "utf8");
test("the playing row is marked beyond the accent colour", () => {
  assert.match(src, /li\.classList\.toggle\("now", on\)/);
  assert.match(src, /el\("span", "eq"\)/);
  assert.match(src, /setAttribute\("aria-current", "true"\)/);
  assert.match(css, /\.row\.now \{ background: var\(--accent-soft\); \}/);
  assert.match(css, /\.row\.paused \.eq i \{ animation-play-state: paused; \}/);
});
