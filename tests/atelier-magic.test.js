// Atelier Magic eraser / Magic grab: inpaint.js pure steps (MI-GAN
// input and output, painted areas, crops) and the wiring.
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const INP = require("../atelier/inpaint.js");

function maskWith(w, h, rects) {
  const m = new Uint8ClampedArray(w * h);
  rects.forEach(([x0, y0, x1, y1]) => { for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) m[y * w + x] = 255; });
  return m;
}

test("boxes: one box per painted area, near areas merged", () => {
  assert.deepEqual(INP.boxes(new Uint8ClampedArray(100 * 100), 100, 100), []);
  const far = INP.boxes(maskWith(2000, 1000, [[10, 10, 40, 40], [1500, 700, 1600, 800]]), 2000, 1000);
  assert.equal(far.length, 2);
  assert.ok(far[0].x0 <= 10 && far[0].x1 >= 40 && far[0].y0 <= 10 && far[0].y1 >= 40);
  const near = INP.boxes(maskWith(2000, 1000, [[10, 10, 40, 40], [200, 10, 230, 40]]), 2000, 1000);
  assert.equal(near.length, 1);
  assert.ok(near[0].x0 <= 10 && near[0].x1 >= 230);
});

test("cropFor / fitIn: margin inside the picture, long side 512", () => {
  const c = INP.cropFor({ x0: 50, y0: 300, x1: 100, y1: 350 }, 1000, 600);
  assert.deepEqual(c, { x: 0, y: 172, w: 228, h: 306 });
  const f = INP.fitIn(c.w, c.h);
  assert.equal(f.h, 512);
  assert.equal(f.w, Math.round(228 * 512 / 306));
  assert.deepEqual(INP.fitIn(2048, 1024), { w: 512, h: 256 });
});

test("toInput / fromOutput: the MI-GAN layout and range", () => {
  const S = INP.S, n = S * S;
  const rgba = new Uint8ClampedArray(4 * n).fill(255), hole = new Uint8ClampedArray(n);
  hole[0] = 255;
  rgba[4] = 0; rgba[5] = 127.5; rgba[6] = 255;
  const inp = INP.toInput(rgba, hole);
  assert.equal(inp.length, 4 * n);
  assert.equal(inp[0], -0.5);                 // hole: 0.5 − 1
  assert.equal(inp[1], 0.5);                  // known
  assert.equal(inp[n], 0);                    // hole pixels are blanked
  assert.equal(inp[n + 1], -1);               // red 0 → −1
  assert.ok(Math.abs(inp[2 * n + 1] - 0) < 0.01);
  assert.equal(inp[3 * n + 1], 1);
  const chw = new Float32Array(3 * n);
  chw[0] = -1; chw[n] = 0; chw[2 * n] = 1; chw[1] = 2;
  const out = INP.fromOutput(chw);
  assert.deepEqual(Array.from(out.slice(0, 8)), [0, 128, 255, 255, 255, 128, 128, 255]);
});

test("grow / opaqueBox", () => {
  const m = maskWith(20, 10, [[5, 5, 6, 6]]);
  const g = INP.grow(m, 20, 10, 2);
  assert.equal(g[3 * 20 + 3], 255);
  assert.equal(g[3 * 20 + 2], 0);
  assert.equal(g[7 * 20 + 7], 255);
  assert.deepEqual(INP.opaqueBox(g, 20, 10, 127), { x: 3, y: 3, w: 5, h: 5 });
  assert.equal(INP.opaqueBox(new Uint8ClampedArray(4), 2, 2, 127), null);
});

test("wiring: files, precache, model credits and both languages", () => {
  const html = fs.readFileSync(path.join(ROOT, "atelier/index.html"), "utf8");
  assert.ok(html.indexOf("cutout.js") < html.indexOf("inpaint.js"));
  assert.ok(html.indexOf("inpaint.js") < html.indexOf("magic.js"));
  const sw = fs.readFileSync(path.join(ROOT, "sw.js"), "utf8");
  assert.ok(sw.includes('"atelier/inpaint.js"') && sw.includes('"atelier/magic.js"'));
  assert.match(sw, /vendor\\\/\(ort\|u2netp\|migan/);
  assert.ok(fs.existsSync(path.join(ROOT, INP.MODEL.url.replace(/^\.\.\//, ""))), "model file");
  assert.ok(fs.existsSync(path.join(ROOT, "vendor/migan/LICENSE")));
  assert.match(fs.readFileSync(path.join(ROOT, "CREDITS.md"), "utf8"), /MI-GAN/);
  assert.match(fs.readFileSync(path.join(ROOT, "shell.js"), "utf8"), /MI-GAN/);
  ["en", "el"].forEach((l) => {
    const help = fs.readFileSync(path.join(ROOT, "atelier/help." + l + ".txt"), "utf8");
    assert.match(help, l === "en" ? /Magic eraser/ : /Μαγική γόμα/);
  });
});
