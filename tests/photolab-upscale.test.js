// Photo Lab — Enlarge with AI (PL-UP): the pure steps of
// photolab/upscale.js (factor, tiles, colour bleed, tile in/out, the
// tiled run against a whole-picture run) and the wiring (lazy load,
// worker, SHA-256 check, Assistant / Claude command, strings).
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const ROOT = path.join(__dirname, "..");
const read = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");
const U = require(path.join(ROOT, "photolab/upscale.js"));
const R = require(path.join(ROOT, "photolab/resample.js"));

function pic(w, h, fn) {
  const d = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const p = fn(x, y), i = (y * w + x) * 4;
    d[i] = p[0]; d[i + 1] = p[1]; d[i + 2] = p[2]; d[i + 3] = p[3] == null ? 255 : p[3];
  }
  return { w, h, data: d };
}
// A stand-in model: a 3 × 3 average around each pixel (so a tile needs
// its neighbours), then each pixel 4 × 4 times (nearest).
function fakeInfer(data, w, h) {
  const plane = w * h, W = w * 4, H = h * 4, out = new Float32Array(3 * W * H);
  for (let c = 0; c < 3; c++) for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let s = 0, n = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const xx = x + dx, yy = y + dy;
      if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
      s += data[c * plane + yy * w + xx]; n++;
    }
    for (let a = 0; a < 4; a++) for (let b = 0; b < 4; b++) out[c * W * H + (y * 4 + a) * W + x * 4 + b] = s / n;
  }
  return Promise.resolve(out);
}

test("factor: 2× halves a 4× run, other factors shrink the input first", () => {
  assert.deepEqual(U.factor(2), { m: 2, s: 1 });
  assert.deepEqual(U.factor(4), { m: 4, s: 1 });
  assert.deepEqual(U.factor(3), { m: 4, s: 0.75 });
  assert.deepEqual(U.factor(1.5), { m: 2, s: 0.75 });
  assert.deepEqual(U.factor(9), { m: 4, s: 1 }, "at most 4");
  assert.equal(U.factor(1), null);
  assert.equal(U.factor("x"), null);
  assert.deepEqual(U.outSize(100, 50, 2), { w: 200, h: 100, iw: 100, ih: 50, m: 2 });
  assert.deepEqual(U.outSize(100, 50, 3), { w: 300, h: 152, iw: 75, ih: 38, m: 4 });
});

test("plan: every pixel is written once, every read stays inside the picture", () => {
  for (const [w, h, tile, pad] of [[13, 7, 5, 2], [128, 128, 128, 12], [300, 129, 128, 12], [1, 1, 128, 12]]) {
    const seen = new Uint8Array(w * h);
    for (const t of U.plan(w, h, tile, pad)) {
      assert.ok(t.px >= 0 && t.py >= 0 && t.px + t.pw <= w && t.py + t.ph <= h);
      assert.ok(t.px <= t.x && t.py <= t.y && t.px + t.pw >= t.x + t.w && t.py + t.ph >= t.y + t.h);
      assert.ok(t.x - t.px === Math.min(pad, t.x) && t.y - t.py === Math.min(pad, t.y));
      for (let y = t.y; y < t.y + t.h; y++) for (let x = t.x; x < t.x + t.w; x++) seen[y * w + x]++;
    }
    assert.ok(seen.every((n) => n === 1), w + "×" + h);
  }
});

test("bleed: fully transparent pixels take the nearest visible colour, the rest stays", () => {
  const img = pic(5, 1, (x) => (x === 0 ? [200, 10, 10, 255] : x === 4 ? [10, 10, 200, 128] : [0, 0, 0, 0]));
  const b = U.bleed(img);
  assert.deepEqual(Array.from(b.data.slice(4, 8)), [200, 10, 10, 0]);
  assert.deepEqual(Array.from(b.data.slice(12, 16)), [10, 10, 200, 0]);
  assert.deepEqual(Array.from(b.data.slice(16, 20)), [10, 10, 200, 128], "a half-visible pixel keeps its colour");
  const opaque = pic(2, 2, () => [1, 2, 3]);
  assert.equal(U.bleed(opaque), opaque, "nothing to fill: the same picture");
  const empty = pic(2, 2, () => [0, 0, 0, 0]);
  assert.equal(U.bleed(empty), empty, "nothing visible: the same picture");
});

test("tileInput: RGB 0..1, channel planes, the read part only", () => {
  const img = pic(4, 3, (x, y) => [x * 50, y * 100, 255]);
  const t = { px: 1, py: 1, pw: 2, ph: 2 };
  const a = U.tileInput(img, t);
  assert.equal(a.length, 12);
  assert.ok(Math.abs(a[0] - 50 / 255) < 1e-6 && Math.abs(a[4] - 100 / 255) < 1e-6 && a[8] === 1);
  assert.ok(Math.abs(a[3] - 100 / 255) < 1e-6 && Math.abs(a[7] - 200 / 255) < 1e-6);
});

test("run: tiles give exactly what one whole-picture run gives (4× and 2×), alpha resampled", async () => {
  const img = pic(23, 17, (x, y) => [(x * 37 + y * 11) % 256, (x * x + y * 7) % 256, (x * y) % 256]);
  for (const k of [4, 2]) {
    const tiled = await U.run(img, { k, R, infer: fakeInfer, tile: 6, pad: 2 });
    const whole = await U.run(img, { k, R, infer: fakeInfer, tile: 1000, pad: 0 });
    assert.equal(tiled.w, 23 * k); assert.equal(tiled.h, 17 * k);
    assert.deepEqual(Buffer.from(tiled.data), Buffer.from(whole.data), "seamless at " + k + "×");
  }
  // 2× of a flat colour stays that colour; values are clamped to 0..255
  const flat = await U.run(pic(9, 9, () => [120, 60, 30]), { k: 2, R, infer: fakeInfer, tile: 4, pad: 1 });
  assert.deepEqual(Array.from(flat.data.slice(0, 4)), [120, 60, 30, 255]);
  const hot = await U.run(pic(2, 2, () => [255, 0, 9]), { k: 4, R, infer: (d, w, h) => fakeInfer(d, w, h).then((o) => o.map((v) => v * 2 - 0.5)) });
  assert.deepEqual(Array.from(hot.data.slice(0, 4)), [255, 0, 0, 255]);
  // transparency: alpha comes from bicubic resampling, never from the model
  const cut = pic(8, 8, (x) => (x < 4 ? [200, 100, 50, 255] : [0, 0, 0, 0]));
  const up = await U.run(cut, { k: 2, R, infer: fakeInfer, tile: 3, pad: 1 });
  const ref = R.resize(cut, 16, 16);
  for (let i = 3; i < up.data.length; i += 4) assert.equal(up.data[i], ref.data[i]);
  assert.equal(up.data[(0 * 16 + 7) * 4], 200, "the edge is not darkened by black behind it");
  // the input is shrunk first for 3×
  const three = await U.run(pic(8, 4, () => [1, 2, 3]), { k: 3, R, infer: fakeInfer });
  assert.deepEqual([three.w, three.h], [24, 12]);
  // a model answer of the wrong size stops the run
  await assert.rejects(U.run(pic(4, 4, () => [1, 1, 1]), { k: 4, R, infer: () => Promise.resolve(new Float32Array(3)) }), /model output/);
  // no factor above 1: the same picture
  const same = pic(2, 2, () => [1, 2, 3]);
  assert.equal(await U.run(same, { k: 1, R, infer: fakeInfer }), same);
});

test("the model: oros-models-vision, pinned by SHA-256", () => {
  assert.match(U.MODEL.url, /^https:\/\/koulaxizis\.github\.io\/oros-models-vision\/realesrgan\/realesr-general-x4v3\.onnx$/);
  assert.match(U.MODEL.sha, /^[0-9a-f]{64}$/);
  assert.equal(U.MODEL.sha, "10279d50668a171356ee5e4b4cef12d11037eb338c437d900664eb79a29159d5");
  // cutout.js keeps a file with a sha only when it matches (Web Crypto)
  const cut = read("atelier/cutout.js");
  assert.match(cut, /return spec\[name\]\.sha \? checkSha\(blob, spec\[name\]\.sha\) : blob;/);
  assert.match(cut, /sub\.digest\("SHA-256", buf\)/);
  assert.match(cut, /if \(!sub\) return Promise\.reject\(new Error\("hash"\)\);/);
  assert.match(cut, /filesOf: filesOf/);
});

test("wiring: loaded on first use, worker, editor step, Assistant / Claude upscale on the device", () => {
  const html = read("photolab/index.html"), panels = read("photolab/panels.js"), en = read("photolab/enlarge.js");
  assert.ok(html.indexOf('src="enlarge.js') < 0 && html.indexOf('src="upscale.js') < 0, "not loaded at first open");
  assert.match(panels, /\{ id: "enlarge", run: function \(\) \{ PL\.enlargeTool\(\)\.then\(function \(E\) \{ E\.open\(\); \}/);
  assert.match(panels, /load\("upscale\.js"\)\.then\(function \(\) \{ return load\("enlarge\.js"\); \}\)/);
  assert.match(read("photolab/upscale-worker.js"), /importScripts\("resample\.js", "upscale\.js"\);/);
  assert.match(en, /new Worker\("upscale-worker\.js" \+ ver\(\)\)/);
  assert.match(en, /s\.esrgan = \{ url: U\.MODEL\.url, v: U\.MODEL\.v, sha: U\.MODEL\.sha \};/);
  assert.match(en, /return PL\.ops\.resizeImage\(z\.w, z\.h, \{/);
  const ops = read("photolab/ops.js");
  assert.match(ops, /var p = o && o\.job && O && O\.k === "raster" \? o\.job\(c, O, tw, th\) : null;/);
  assert.match(ops, /jobFor\(c, O\)/);
  const CMD = require(path.join(ROOT, "photolab/commands.js"));
  assert.ok(CMD.check([{ op: "upscale", f: "4", prov: "device" }]).ok);
  assert.match(CMD.check([{ op: "generate", prompt: "x", prov: "device" }]).err, /prov "device" is not allowed/);
  const ai = read("photolab/aiedit.js");
  assert.match(ai, /if \(s\.prov === "device"\) return onDevice\(f\);/);
  assert.match(ai, /if \(!s\.prov && !\(cf && cf\.p\.upscale\)\) return onDevice\(f\);/);
  assert.match(read("assistant/assistant.js"), /if \(k === "prov" && app === "photolab" && v === "device"\) return t\("ed\.v\.prov\.device"\);/);
});

test("every Enlarge string is in EN, EL and DE", () => {
  global.window = {};
  require(path.join(ROOT, "photolab/strings.js"));
  const S = global.window.PL_STRINGS;
  const de = read("i18n/de/photolab.js"), asst = read("assistant/assistant.js"), deA = read("i18n/de/assistant.js");
  const keys = Object.keys(S.en).filter((k) => /^(up\.|menu\.enlarge|dlg\.enlarge|step\.enlarge|msg\.up)/.test(k));
  assert.ok(keys.length >= 20, keys.length);
  for (const k of keys) {
    assert.ok(S.el[k] && S.el[k] !== S.en[k] || k === "up.x", "el " + k);
    assert.ok(de.indexOf(JSON.stringify(k) + ":") >= 0, "de " + k);
  }
  for (const k of ["ed.note.aiUpFail", "ed.v.prov.device"]) {
    assert.equal(asst.split('"' + k + '":').length, 3, "en + el " + k);
    assert.ok(deA.indexOf('"' + k + '":') >= 0, "de " + k);
  }
  // the enlarge.js keys all exist
  for (const m of read("photolab/enlarge.js").matchAll(/t\("([a-zA-Z.]+)"/g)) assert.ok(S.en[m[1]], m[1]);
});
