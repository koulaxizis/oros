// ACCENT-INK: text drawn on an accent fill (notification badge, tour
// "Next", pressed keyboard key, dialog primary button, seasonal button)
// uses --accent-ink, which every palette block sets to white or near
// black, whichever reads better on that block's --accent. Tux dark has
// a near-white accent, so white text on it was invisible.
// Run: node --test tests/

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const css = fs.readFileSync(path.join(ROOT, "style.css"), "utf8");

function lum(hex) {
  const h = hex.replace("#", "");
  return [0, 2, 4]
    .map((i) => parseInt(h.slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)))
    .reduce((s, c, i) => s + c * [0.2126, 0.7152, 0.0722][i], 0);
}
function contrast(a, b) {
  const [lo, hi] = [lum(a), lum(b)].sort((x, y) => x - y);
  return (hi + 0.05) / (lo + 0.05);
}

const BLOCK = /((?:\[data-skin="\w+"\]\[data-theme="\w+"\]|html\[data-oros-contrast="high"\]\[data-theme="\w+"\]))\s*\{([^}]*)\}/g;
const blocks = [];
for (let m; (m = BLOCK.exec(css)); ) {
  const accent = /--accent:\s*(#[0-9a-fA-F]{6})/.exec(m[2]);
  if (!accent) continue;
  const ink = /--accent-ink:\s*(#[0-9a-fA-F]{6})/.exec(m[2]);
  blocks.push({ name: m[1], accent: accent[1], ink: ink && ink[1] });
}

test("every palette block (32 skins + 2 high contrast) sets --accent-ink", () => {
  assert.equal(blocks.length, 34);
  for (const b of blocks) assert.ok(b.ink, b.name + " has no --accent-ink");
});

test("--accent-ink reads on --accent (contrast at least 4.3:1)", () => {
  for (const b of blocks) {
    const c = contrast(b.accent, b.ink);
    assert.ok(c >= 4.3, `${b.name}: ${b.ink} on ${b.accent} is ${c.toFixed(2)}:1`);
  }
});

test("shell text on an accent fill uses --accent-ink, never a fixed white", () => {
  const files = ["notifications.js", "shell.js", "seasonal.js", "style.css"];
  const bad = /background:\s*var\(--accent\)[^;"}]*;[^"}]*?color:\s*#fff\b/;
  for (const f of files) {
    const src = fs.readFileSync(path.join(ROOT, f), "utf8");
    src.split("\n").forEach((line, i) => {
      assert.ok(!bad.test(line), `${f}:${i + 1} puts #fff on var(--accent)`);
    });
  }
  const badge = fs.readFileSync(path.join(ROOT, "notifications.js"), "utf8");
  assert.match(badge, /background:var\(--accent\);color:var\(--accent-ink, #fff\)/);
});
