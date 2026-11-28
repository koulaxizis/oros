// COVERTINT-1 (video ideas 2026-11-23 #21): the Now playing peek, the
// media widget and the island take their colours from the cover. The
// maths (shell.js WpAcc.coverTint) runs here as it is, cut out of the
// source; every colour it gives is checked for contrast.
"use strict";
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.join(__dirname, "..");
const read = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");
const SRC = read("shell.js");
function cutBlock(head) {
  const i = SRC.indexOf(head);
  if (i < 0) throw new Error("missing " + head);
  let depth = 0, j = SRC.indexOf("{", i);
  for (; j < SRC.length; j++) {
    if (SRC[j] === "{") depth++;
    else if (SRC[j] === "}" && --depth === 0) break;
  }
  return SRC.slice(i, j + 1);
}
const ctx = {};
vm.createContext(ctx);
vm.runInContext(cutBlock("  var WpAcc = (function () {") + ")();\nthis.WpAcc = WpAcc;", ctx);
const W = ctx.WpAcc;
const rgb = (h) => W.parse(h);

test("every hue and chroma: text 7:1 and dim text 4.5:1 on the panel, tint 4.5:1, its ink 4.5:1", () => {
  let n = 0;
  for (let h = 0; h < 360; h += 15) {
    for (const c of [0.02, 0.05, 0.1, 0.2, 0.35]) {
      const t = W.coverTint({ h, c });
      assert.ok(t, "a tint for h " + h + " c " + c);
      assert.ok(W.contrast(rgb(t.ink), rgb(t.bg)) >= 7, "ink on bg " + h);
      assert.ok(W.contrast(rgb(t.dim), rgb(t.bg)) >= 4.5, "dim on bg " + h);
      assert.ok(W.contrast(rgb(t.tint), rgb(t.bg)) >= 4.5, "tint on bg " + h);
      assert.ok(W.contrast(rgb(t.tintInk), rgb(t.tint)) >= 4.5, "ink on tint " + h);
      assert.match(t.soft, /^rgba\(\d+, \d+, \d+, 0\.16\)$/);
      n++;
    }
  }
  assert.strictEqual(n, 120);
});

test("hue follows the cover; nothing without a swatch", () => {
  const red = W.coverTint({ h: 25, c: 0.15 }), blue = W.coverTint({ h: 260, c: 0.15 });
  assert.notStrictEqual(red.bg, blue.bg);
  const r = rgb(red.bg), b = rgb(blue.bg);
  assert.ok(r[0] > r[2], "red cover: reddish panel");
  assert.ok(b[2] > b[0], "blue cover: bluish panel");
  assert.strictEqual(W.coverTint(null), null);
  assert.strictEqual(W.coverTint({}), null);
  // a real cover: the main swatch of red pixels gives a reddish tint
  const px = [];
  for (let i = 0; i < 32 * 32; i++) px.push(200, 40, 30, 255);
  const sw = W.swatches(px, 1);
  assert.strictEqual(sw.length, 1);
  assert.ok(rgb(W.coverTint(sw[0]).bg)[0] > rgb(W.coverTint(sw[0]).bg)[2]);
  const grey = [];
  for (let i = 0; i < 32 * 32; i++) grey.push(120, 120, 120, 255);
  assert.deepStrictEqual(W.swatches(grey, 1).length, 0, "a grey cover gives no tint");
});

test("shell: read once per cover, in memory, never under high contrast or Sensitive work", () => {
  assert.match(SRC, /var coverTints = \{\}, coverKeys = \[\];/);
  assert.match(SRC, /if \(coverKeys\.length > 24\) delete coverTints\[coverKeys\.shift\(\)\];/);
  assert.match(SRC, /if \(strictLevelNow\(\) \|\| document\.documentElement\.getAttribute\("data-oros-contrast"\) === "high"\) return null;/);
  assert.match(SRC, /mediaTint: coverTintFor,/);
  assert.match(SRC, /tint: coverTintFor,/);
  const body = SRC.slice(SRC.indexOf("function coverTint(src)"), SRC.indexOf("function coverTintFor("));
  assert.ok(!/localStorage|fetch\(/.test(body), "nothing stored, nothing fetched beyond the image");
  assert.match(body, /img\.crossOrigin = "anonymous"/);
});

test("the three players use it", () => {
  const sb = read("smartbar.js"), isl = read("smartbar-island.js"), wg = read("widgets.js");
  assert.match(sb, /var tn = st \? null : call\(function \(\) \{ return host\.tint \? host\.tint\(m\.title\) : null; \}\);/);
  assert.match(sb, /background: var\(--sbi-bg, rgba\(8, 10, 16, 0\.96\)\)/);
  assert.match(isl, /h\.tint\(m\.title\)/);
  assert.match(isl, /if \(!m \|\| strict\(\)\) return null;\n\s+var h = host\(\), v = call\(function \(\) \{ return h && typeof h\.tint/);
  assert.match(wg, /host\.mediaTint \? host\.mediaTint\(main\.title\) : null/);
  assert.match(wg, /\.wg-mbig\.wg-tinted \{ background: var\(--wg-tint-bg\);/);
});
