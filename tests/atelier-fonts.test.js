// Atelier fonts (wave 2b): extra families in designkit/text.js
// (several subset files per face, fallback per character, variant
// fallback, the fetcher hook) and Fontsource ids in atelier/ax.js.
// Run: node --test tests/

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const T = require(path.join(ROOT, "designkit/text.js"));
const MEDIA = require(path.join(ROOT, "designkit/media.js"));
const AX = require(path.join(ROOT, "atelier/ax.js"));

function buf(file) {
  const b = fs.readFileSync(path.join(ROOT, "vendor/noto", file));
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
}
const SANS = buf("NotoSans-Regular.ttf"), SERIF = buf("NotoSerif-Regular.ttf"), SERIF_B = buf("NotoSerif-Bold.ttf");
T.register("sans-r", SANS);
T.register("sans-b", buf("NotoSans-Bold.ttf"));
T.register("serif-r", SERIF);

test("registerFamily validates ids and keeps built-ins", () => {
  assert.equal(T.registerFamily("bad-id", { urls: { r: ["x"] } }), false);
  assert.equal(T.registerFamily("sans", { urls: { r: ["x"] } }), false);
  assert.equal(T.registerFamily("fs_empty", { urls: { r: [] } }), false);
  assert.equal(T.registerFamily("fs_demo", { name: "Demo", urls: { r: ["https://f/r1.ttf", "https://f/r2.ttf"] } }), true);
  assert.equal(T.FAMILIES.fs_demo.name, "Demo");
  assert.ok(T.FAMILY_IDS.indexOf("fs_demo") < 0);          // Layout's list is untouched
  assert.equal(T.fontKey("fs_demo", 1, 0), "fs_demo-b");
  assert.equal(T.fontFile("fs_demo-b"), "fs_demo-b.ttf");
  assert.equal(T.cssStack("fs_demo-b"), '"dk-fs_demo-b", "dk-sans-b"');
  assert.equal(T.cssStack("serif-r"), "dk-serif-r");
});

test("before the font arrives, metrics are the fallback's", () => {
  T.registerFamily("fs_later", { urls: { r: ["https://f/x.ttf"] } });
  assert.equal(T.measure("fs_later-r", "Hello", 20), T.measure("sans-r", "Hello", 20));
  assert.equal(T.measure("fs_later-b", "Hello", 20), T.measure("sans-b", "Hello", 20));
});

test("several subset files: first file wins, missing characters use the fallback", () => {
  T.registerFamily("fs_merge", { urls: { r: ["a", "b"] } });
  const g0 = T.generation();
  T.register("fs_merge-r", [SERIF, SANS]);
  assert.ok(T.generation() > g0);
  assert.ok(Math.abs(T.measure("fs_merge-r", "Αγάπη Hello", 30) - T.measure("serif-r", "Αγάπη Hello", 30)) < 1e-9);
  // a character the face lacks is measured like the fallback draws it
  const m = T.metrics("fs_merge-r");
  delete m.map[0x41];
  assert.ok(Math.abs(T.measure("fs_merge-r", "A", 30) - T.measure("sans-r", "A", 30)) < 1e-9);
  assert.match(T.unicodeRange(T.parseTTF(SERIF)), /^U\+[0-9a-f]+(-[0-9a-f]+)?(,U\+[0-9a-f]+(-[0-9a-f]+)?)*$/);
});

test("load(): files that are not there are skipped; a missing weight uses the regular face; failure is quiet", async () => {
  const served = { "u/r-latin": SERIF, "u/r-greek": SANS, "u/b-latin": null, "u/b-greek": null };
  const asked = [];
  T.setFetcher((u) => { asked.push(u); if (u === "u/boom") return Promise.reject(new Error("net")); return Promise.resolve(served[u] === undefined ? null : served[u]); });
  try {
    T.registerFamily("fs_net", { urls: { r: ["u/r-latin", "u/r-greek", "u/r-nope"], b: ["u/b-latin", "u/b-greek"] } });
    await T.load(["fs_net-r", "fs_net-b"]);
    assert.ok(T.isLoaded("fs_net-r") && T.isLoaded("fs_net-b"));
    assert.ok(Math.abs(T.measure("fs_net-b", "Hi", 10) - T.measure("serif-r", "Hi", 10)) < 1e-9);
    T.registerFamily("fs_down", { urls: { r: ["u/boom"] } });
    await T.load(["fs_down-r"]);                    // resolves: sans stands in
    assert.equal(T.isLoaded("fs_down-r"), false);
    T.registerFamily("fs_bold", { urls: { r: ["u/r-latin"], b: ["u/bold"] } });
    served["u/bold"] = SERIF_B;
    await T.load(["fs_bold-b"]);
    assert.ok(Math.abs(T.measure("fs_bold-b", "Hi", 10) - T.measure("serif-r", "Hi", 10)) > 0.01);
  } finally { T.setFetcher(null); }
});

test("Fontsource ids in Atelier designs", () => {
  assert.equal(AX.isExtraFont("fs_open_sans"), true);
  assert.equal(AX.isExtraFont("fs_Open"), false);
  assert.equal(AX.isExtraFont("fs_a-b"), false);
  assert.equal(AX.isExtraFont("fs_"), false);
  assert.equal(AX.fsIdOf("open-sans"), "fs_open_sans");
  assert.equal(AX.fsSlug("fs_open_sans"), "open-sans");
  const a = AX.normAx({ k: "text", tx: "x", font: "fs_gfs_didot" }, { t: "rect" });
  assert.equal(a.font, "fs_gfs_didot");
  assert.equal(AX.normAx({ k: "text", tx: "x", font: "<b>" }, { t: "rect" }).font, "sans");
  assert.equal(AX.fontName("fs_gfs_didot"), "Gfs Didot");
  assert.equal(AX.fontKeyOf({ font: "fs_gfs_didot", b: 1 }), "fs_gfs_didot-b");
  const urls = MEDIA.fontsourceUrls("gfs-didot");
  assert.equal(urls.r[0], "https://cdn.jsdelivr.net/fontsource/fonts/gfs-didot@latest/latin-400-normal.ttf");
  assert.ok(urls.bi.every((u) => /-700-italic\.ttf$/.test(u)));
  assert.ok(urls.r.some((u) => /\/greek-400-normal\.ttf$/.test(u)));
  assert.equal(MEDIA.fontsourceUrls("../x"), null);
  assert.deepEqual(T.FAMILIES.fs_gfs_didot.urls.r, urls.r);
});
