// Files › Photos › search by description (files/clip-core.js): CLIP's
// tokenizer, the picture → tensor step and the ranking.
// Run: node --test tests/

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const C = require("../files/clip-core.js");

// A tiny vocabulary with CLIP's real ids for these words.
const VOCAB = { "a</w>": 320, "photo</w>": 1125, "of</w>": 539, "dog</w>": 1929, "on</w>": 525, "the</w>": 518,
  "beach</w>": 2117, "!!</w>": 748 };
// Merges that build each word left to right, as CLIP's merges.txt does.
const MERGES = "#version: 0.2\n" + ["photo", "of", "dog", "on", "the", "beach", "!!"].map((w) => {
  const out = []; let cur = w[0];
  for (let i = 1; i < w.length; i++) { const nx = w[i] + (i === w.length - 1 ? "</w>" : ""); out.push(cur + " " + nx); cur += nx; }
  return out.join("\n");
}).join("\n") + "\n";

test("tokenizer: CLIP's start, end and padding to 77", () => {
  const t = C.tokenizer(VOCAB, MERGES);
  const e = t.encode("a photo of a dog");
  assert.equal(e.length, 77);
  assert.deepEqual(Array.from(e.slice(0, 7)), [49406, 320, 1125, 539, 320, 1929, 49407]);
  assert.ok(Array.from(e.slice(7)).every((x) => x === 49407));
  assert.equal(t.length("a photo of a dog"), 7);
});

test("tokenizer: lower case, spaces and punctuation", () => {
  const t = C.tokenizer(VOCAB, MERGES);
  assert.deepEqual(Array.from(t.encode("  Dog   on THE beach!! ").slice(0, 7)), [49406, 1929, 525, 518, 2117, 748, 49407]);
});

test("tokenizer: BPE merges in rank order", () => {
  const v = { "d": 67, "o": 79, "g</w>": 13, "do": 2, "dog</w>": 1929 };
  const merges = "#version: 0.2\nd o\ndo g</w>\n";
  assert.deepEqual(Array.from(C.tokenizer(v, merges).encode("dog").slice(0, 3)), [49406, 1929, 49407]);
  // without the second merge the word stays in two pieces
  assert.deepEqual(Array.from(C.tokenizer(v, "d o\n").encode("dog").slice(0, 4)), [49406, 2, 13, 49407]);
});

test("tokenizer: a long text is cut and still ends with the end token", () => {
  const t = C.tokenizer(VOCAB, MERGES);
  const e = t.encode(Array(200).fill("dog").join(" "));
  assert.equal(e[0], 49406);
  assert.equal(e[76], 49407);
  assert.equal(e[75], 1929);
});

test("byte table: 256 printable characters, one per byte", () => {
  const b = C.byteTable();
  const vals = Object.values(b);
  assert.equal(vals.length, 256);
  assert.equal(new Set(vals).size, 256);
  assert.equal(b[32], "Ġ");
  assert.equal(b[97], "a");
});

test("cropBox: the centre square", () => {
  assert.deepEqual(C.cropBox(640, 480), { sx: 80, sy: 0, sw: 480, sh: 480 });
  assert.deepEqual(C.cropBox(300, 500), { sx: 0, sy: 100, sw: 300, sh: 300 });
});

test("pixels: CHW with CLIP's mean and std", () => {
  const S = C.SIZE, rgba = new Uint8ClampedArray(S * S * 4);
  for (let i = 0; i < S * S; i++) { rgba[i * 4] = 255; rgba[i * 4 + 1] = 0; rgba[i * 4 + 2] = 128; rgba[i * 4 + 3] = 255; }
  const px = C.pixels(rgba, S, S);
  assert.equal(px.length, 3 * S * S);
  assert.ok(Math.abs(px[0] - (1 - C.MEAN[0]) / C.STD[0]) < 1e-6);
  assert.ok(Math.abs(px[S * S] - (0 - C.MEAN[1]) / C.STD[1]) < 1e-6);
  assert.ok(Math.abs(px[2 * S * S] - (128 / 255 - C.MEAN[2]) / C.STD[2]) < 1e-6);
});

test("pack and score: a vector matches itself, an opposite one does not", () => {
  const v = new Float32Array(512).map((_, i) => Math.sin(i + 1));
  const p = C.pack(v);
  assert.ok(p instanceof Int8Array);
  assert.ok(C.score(C.normalize(v), p) > 0.998);
  const neg = v.map((x) => -x);
  assert.ok(C.score(C.normalize(neg), p) < -0.998);
});

test("rank: best first, a floor, and close to the best only", () => {
  const base = new Float32Array(512).map((_, i) => Math.sin(i + 1));
  const other = new Float32Array(512).map((_, i) => Math.cos(i * 3 + 2));
  const mix = (a, b, w) => a.map((x, i) => x * w + b[i] * (1 - w));
  const items = [
    { k: "far", v: C.pack(other) },
    { k: "near", v: C.pack(mix(base, other, 0.9)) },
    { k: "same", v: C.pack(base) },
    { k: "bad", v: new Int8Array(10) }
  ];
  const r = C.rank(base, items, { min: 0.2, spread: 0.2 });
  assert.deepEqual(r.map((x) => x.k), ["same", "near"]);
  assert.deepEqual(C.rank(base, [], {}), []);
  assert.equal(C.rank(base, items, { min: -1, spread: 5, max: 1 }).length, 1);
});

test("blend: length one, between both", () => {
  const a = new Float32Array([1, 0]), b = new Float32Array([0, 1]);
  const m = C.blend(a, b);
  assert.ok(Math.abs(Math.hypot(m[0], m[1]) - 1) < 1e-6);
  assert.ok(Math.abs(m[0] - m[1]) < 1e-6);
});

test("clip.js: hashes and sizes from oros-models-vision, our own mirror", () => {
  const src = fs.readFileSync(path.join(__dirname, "..", "files", "clip.js"), "utf8");
  assert.match(src, /https:\/\/koulaxizis\.github\.io\/oros-models-vision\/clip-vit-base-patch32\//);
  const files = [...src.matchAll(/(vision|text|vocab|merges):\s*\{ url: MIRROR \+ "([^"]+)", v: VER, size: (\d+), sha: "([0-9a-f]*)" \}/g)];
  assert.equal(files.length, 4);
  files.forEach((m) => { assert.equal(m[4].length, 64, m[1] + " sha"); assert.ok(+m[3] > 0, m[1] + " size"); });
  assert.doesNotMatch(src, /huggingface\.co/);
});

test("photo-search.js: EN and EL strings match, nothing synced", () => {
  const src = fs.readFileSync(path.join(__dirname, "..", "files", "photo-search.js"), "utf8");
  const block = (lang) => src.split(lang + ": {")[1].split("\n    }")[0];
  const keys = (b) => [...b.matchAll(/"(ps\.[^"]+)":/g)].map((m) => m[1]).sort();
  assert.deepEqual(keys(block("en")), keys(block("el")));
  assert.doesNotMatch(src, /orosSync|registerSlice|markDirty/);
});

test("factory reset clears the index and the models", () => {
  const shell = fs.readFileSync(path.join(__dirname, "..", "shell.js"), "utf8");
  assert.match(shell, /"oros-files-clip"/);
});
