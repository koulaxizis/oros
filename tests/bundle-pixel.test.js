// The .orospixel file (Pixel Avatar): pack a face with bundle.js,
// read it back as a NEW Museum item through the app's own rules, and
// the app wiring (save, open, unzipped folder, "Open with").
// Run: node --test tests/*.test.js
//
// pixel.js is a browser IIFE, so sections 2–6 are cut out of the
// source as tests/pixel.test.js does.

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const B = require(path.join(ROOT, "bundle.js"));
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
const src = read("pixel/pixel.js");
function block(from, to) {
  const i = src.indexOf(from), j = src.indexOf(to, i);
  if (i < 0 || j < 0) throw new Error("missing block " + from);
  return src.slice(i, j);
}
const P = new Function("crypto",
  block("  var STORAGE_KEY", "  // ---------- 1.") +
  block("  function cmpStr(", "  // BOOT MARKER") +
  block("  // ---------- 2. Random", "  // ---------- 7. Storage") +
  "\nreturn { PIXEL_MIME, facePackage, faceFromPackage, faceColors, faceGrid, normItem, genFace };")(require("crypto").webcrypto);

const names = (bytes) => {
  const out = [], s = Buffer.from(bytes);
  for (let i = 0; i < s.length - 4; i++) if (s.readUInt32LE(i) === 0x02014b50) out.push(s.slice(i + 46, i + 46 + s.readUInt16LE(i + 28)).toString());
  return out;
};
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);

test("pixel: a painted face round-trips as a new Museum item", async () => {
  const grid = P.genFace("Χρήστος", 12).replace(/^./, "7");
  const it = { id: "abcdef123", m: 1700000000000, name: "Ο Χρήστος", f: { s: "Χρήστος", n: 12, p: "neon", b: 1, px: grid } };
  const cols = P.faceColors("Χρήστος", "neon", null);
  const content = P.facePackage(it, cols);
  assert.equal(content.kind, "oros-pixel-package");
  assert.equal(content.grid, grid);
  assert.deepEqual(content.colors, cols);
  const bytes = await B.write({ mime: P.PIXEL_MIME, app: "pixel", schema: "pixel/1", content,
    meta: { title: it.name, modified: it.m, id: it.id, language: "el", generator: "orOS Pixel Avatar" },
    thumbnail: PNG, preview: [{ name: "face.png", data: PNG, type: "image/png" }, { name: "face.svg", data: "<svg/>", type: "image/svg+xml" }],
    date: new Date(2026, 0, 2) });
  assert.equal(B.sniff(bytes.subarray(0, 128)), "application/x-oros-pixel");
  const list = names(bytes);
  ["content.json", "preview/thumbnail.png", "preview/face.png", "preview/face.svg"].forEach((n) => assert.ok(list.includes(n), n));
  const r = await B.read(bytes, { mime: P.PIXEL_MIME });
  assert.deepEqual(r.content, JSON.parse(JSON.stringify(content)));
  assert.equal(r.meta.title, "Ο Χρήστος");
  const y = P.faceFromPackage(r.content, 1800000000000);
  assert.notEqual(y.id, it.id);
  assert.equal(y.m, 1800000000000);
  assert.deepEqual(Object.assign({}, y, { id: it.id, m: it.m }), it);
});

test("pixel: a seed face and imported colours keep their recipe", () => {
  const f = { s: "orOS", n: 16, p: "custom", b: 0, px: "", c: ["#000000", "#111111", "#222222", "#333333", "#444444", "#555555", "#666666", "#777777"] };
  const c = P.facePackage({ id: "seedface1", m: 5, name: "", f }, f.c);
  assert.equal(c.item.name, "orOS");                // no name → the seed
  assert.equal(c.grid, P.genFace("orOS", 16));      // as generated
  const y = P.faceFromPackage(JSON.parse(JSON.stringify(c)), 9);
  assert.deepEqual(y.f, f);
});

test("pixel: a hostile file goes through normFace / normItem", () => {
  assert.equal(P.faceFromPackage(null), null);
  assert.equal(P.faceFromPackage({ kind: "x", item: { f: { s: "a", n: 8 } } }), null);
  assert.equal(P.faceFromPackage({ kind: "oros-pixel-package", item: { f: { s: "a", n: 9 } } }), null);
  assert.equal(P.faceFromPackage({ kind: "oros-pixel-package", item: { f: { s: "", n: 8 } } }), null);
  const y = P.faceFromPackage({ kind: "oros-pixel-package", item: { id: "../x", m: -1, name: "<b>" + "x".repeat(99),
    f: { s: "a\u0000b", n: 8, p: "__proto__", b: 7, px: "9".repeat(64), c: ["javascript:"] } } }, 1);
  assert.ok(/^[a-z0-9]{6,40}$/.test(y.id));
  assert.equal(y.name.length, 40);
  assert.deepEqual(y.f, { s: "a\u0000b".replace(/\s+/g, " ").trim(), n: 8, p: "classic", b: 0, px: "" });
  assert.equal(P.facePackage({ id: "bad" }), null);
});

test("pixel: the app saves, opens, reads folders and takes \"Open with\"", () => {
  const html = read("pixel/index.html");
  assert.match(html, /<script src="\.\.\/bundle\.js\?v=[\d.]+"><\/script>\s*<script src="pixel\.js/);
  assert.match(html, /id="oros-btn"/);
  assert.match(html, /id="folder-btn"/);
  assert.match(src, /B\.sniff\(/);
  assert.match(src, /B\.readFolder\(files, \{ mime: PIXEL_MIME \}\)/);
  assert.match(src, /__orosTakeTarget\("pixel"\)/);
  assert.match(src, /window\.__orosOpenAt = openTarget/);
  assert.match(src, /"\.orospixel,"/);
});
