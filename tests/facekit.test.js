// FACE-BLUR: facekit.js pure parts (YuNet input and decoding, NMS,
// tiles, the head ellipse, blurring), the model pin, and the places
// that use it (share window, Photo Lab). Detection only: no face data
// is stored or synced.
// Run: node --test tests/
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const FK = require(path.join(ROOT, "facekit.js"));
const src = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");

test("facekit: the model is YuNet from the orOS mirror, pinned by SHA-256", () => {
  assert.equal(FK.MODEL.url, "https://koulaxizis.github.io/oros-models-vision/yunet/face_detection_yunet_2023mar.onnx");
  assert.match(FK.MODEL.sha, /^[0-9a-f]{64}$/);
  assert.equal(FK.MODEL.sha, "8f2383e4dd3cfbb4553ea8718107fc0423210dc964f9f4280604804ed2552fa4");
  const s = src("facekit.js");
  // checked before anything stores or runs it; a kept copy that cannot
  // be read never falls back to an unchecked download
  assert.match(s, /if \(hex\(d\) !== MODEL\.sha\) throw new Error\("checksum"\)/);
  assert.match(s, /specOf\(CUT, blobUrl \|\| "about:invalid"\)/);
  assert.match(s, /credentials: "omit"/);
  // never recognition: no embedding, no storage of faces
  assert.doesNotMatch(s, /localStorage|indexedDB\.open|orosSync/);
});

test("facekit: fit and the BGR input", () => {
  assert.deepEqual(FK.fit(1280, 640), { k: 0.5, w: 640, h: 320 });
  assert.deepEqual(FK.fit(300, 200), { k: 1, w: 300, h: 200 });
  const rgba = new Uint8ClampedArray([10, 20, 30, 255, 40, 50, 60, 255]);
  const x = FK.toInput(rgba, 2, 1), P = 640 * 640;
  assert.equal(x.length, 3 * P);
  assert.deepEqual([x[0], x[P], x[2 * P]], [30, 20, 10]);       // B, G, R
  assert.deepEqual([x[1], x[P + 1], x[2 * P + 1]], [60, 50, 40]);
  assert.equal(x[640], 0, "the rest stays black");
});

function outs(hits) {
  const o = {};
  [8, 16, 32].forEach((st) => {
    const n = (640 / st) ** 2;
    o["cls_" + st] = new Float32Array(n); o["obj_" + st] = new Float32Array(n);
    o["bbox_" + st] = new Float32Array(n * 4); o["kps_" + st] = new Float32Array(n * 10);
  });
  hits.forEach((h) => {
    const i = h.r * (640 / h.st) + h.c;
    o["cls_" + h.st][i] = h.cls; o["obj_" + h.st][i] = h.obj;
    o["bbox_" + h.st].set([h.dx, h.dy, Math.log(h.w / h.st), Math.log(h.h / h.st)], i * 4);
  });
  return o;
}

test("facekit: YuNet outputs → boxes in source pixels", () => {
  const o = outs([
    { st: 16, r: 10, c: 20, cls: 0.95, obj: 0.9, dx: 0.5, dy: 0.25, w: 64, h: 80 },
    { st: 8, r: 3, c: 3, cls: 0.2, obj: 0.3, dx: 0, dy: 0, w: 8, h: 8 }    // too weak
  ]);
  const b = FK.decode(o, 0.5, 100, 50);
  assert.equal(b.length, 1);
  // centre (20.5·16, 10.25·16) = (328, 164); box 64×80 at k 0.5 → ×2, + offset
  assert.equal(Math.round(b[0].x), 100 + (328 - 32) * 2);
  assert.equal(Math.round(b[0].y), 50 + (164 - 40) * 2);
  assert.equal(Math.round(b[0].w), 128);
  assert.equal(Math.round(b[0].h), 160);
  assert.ok(Math.abs(b[0].s - Math.sqrt(0.95 * 0.9)) < 1e-6);
  assert.ok(FK.THR <= 0.6, "a lower threshold than OpenCV's demo: missing a face is worse");
});

test("facekit: NMS keeps one box per face, also across tiles", () => {
  const a = { x: 0, y: 0, w: 100, h: 100, s: 0.9 };
  const b = { x: 5, y: 5, w: 100, h: 100, s: 0.8 };
  const inner = { x: 20, y: 20, w: 40, h: 40, s: 0.95 };
  const far = { x: 400, y: 0, w: 50, h: 50, s: 0.7 };
  const k = FK.nms([a, b, far]);
  assert.deepEqual(k.map((x) => x.s), [0.9, 0.7]);
  assert.equal(FK.nms([a, inner]).length, 1, "a face found again inside a bigger box");
  assert.deepEqual(FK.tiles(1200, 900), []);
  const t = FK.tiles(4000, 3000);
  assert.equal(t.length, 4);
  t.forEach((r) => { assert.ok(r.x >= 0 && r.y >= 0 && r.x + r.w <= 4000 && r.y + r.h <= 3000); });
  assert.ok(t[0].w + t[2].x > 4000 - 1, "the quarters overlap");
});

test("facekit: the head ellipse and hits", () => {
  const e = FK.head({ x: 100, y: 100, w: 100, h: 100 });
  assert.ok(e.rx > 50 && e.ry > 50, "more than the model's box");
  assert.equal(FK.hit([{ x: 100, y: 100, w: 100, h: 100 }], 150, 150), 0);
  assert.equal(FK.hit([{ x: 100, y: 100, w: 100, h: 100 }], 10, 10), -1);
});

function picture(W, H) {
  const d = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = (y * W + x) * 4;
    d[i] = (x * 7) & 255; d[i + 1] = (y * 13) & 255; d[i + 2] = ((x ^ y) * 5) & 255; d[i + 3] = 255;
  }
  return d;
}

test("facekit: blur changes the face and nothing else", () => {
  const W = 200, H = 160, box = { x: 60, y: 40, w: 60, h: 70 };
  ["blur", "pixelate", "fill"].forEach((style) => {
    const orig = picture(W, H), d = new Uint8ClampedArray(orig);
    assert.equal(FK.blurInto(d, W, H, [box], style), 1);
    const at = (x, y) => (y * W + x) * 4;
    const e = FK.head(box);
    const c = at(Math.round(e.cx), Math.round(e.cy));
    let changed = 0;
    for (let x = -30; x < 30; x++) if (d[c + x * 4] !== orig[c + x * 4]) changed++;
    assert.ok(changed > 40, style + ": the face changed (" + changed + ")");
    assert.equal(d[at(2, 2)], orig[at(2, 2)], style + ": far away untouched");
    assert.equal(d[at(199, 159) + 1], orig[at(199, 159) + 1]);
    if (style === "fill") assert.deepEqual([...d.slice(c, c + 3)], [58, 58, 64]);
  });
  // the blurred face holds little detail: neighbours inside are close
  const d = picture(W, H);
  FK.blurInto(d, W, H, [box], "blur");
  const e = FK.head(box), y = Math.round(e.cy);
  let jump = 0;
  for (let x = Math.round(e.cx - 10); x < Math.round(e.cx + 10); x++) jump = Math.max(jump, Math.abs(d[(y * W + x) * 4] - d[(y * W + x + 1) * 4]));
  assert.ok(jump < 40, "no sharp detail left (" + jump + ")");
  // a box marked off is skipped
  const o = picture(W, H), d2 = new Uint8ClampedArray(o);
  assert.equal(FK.blurInto(d2, W, H, [Object.assign({ off: true }, box)], "blur"), 0);
  assert.deepEqual(d2, o);
});

test("facekit: layer mode writes only the faces", () => {
  const W = 120, H = 120, d = picture(W, H);
  FK.blurInto(d, W, H, [{ x: 30, y: 30, w: 50, h: 50 }], "pixelate", { layer: true });
  assert.equal(d[3], 0, "outside is transparent");
  const e = FK.head({ x: 30, y: 30, w: 50, h: 50 });
  assert.equal(d[(Math.round(e.cy) * W + Math.round(e.cx)) * 4 + 3], 255, "the face is opaque");
});

test("facekit: the share window and Photo Lab use it, loaded on demand", () => {
  const send = src("share/send.js");
  assert.match(send, /s\.src = "facekit\.js\?v="/);
  assert.match(send, /var FACES_KEY = "oros-share-faces"/);
  assert.match(send, /return \{ on: false, st: "blur" \};/, "off until the person turns it on");
  assert.match(send, /if \(fx && fx\.busy\)/, "no link while the photos are being redone");
  // a failed face step turns the switch off and says so; nothing goes unblurred silently
  assert.match(send, /fx\.err = T\("fxFail"/);
  ["en", "el"].forEach(() => assert.match(send, /fxFail: "/));
  const pl = src("photolab/faces.js");
  assert.match(pl, /s\.src = "\.\.\/facekit\.js"/);
  assert.match(pl, /PL\.addLayer\(\{ k: "raster", name: t\("layer\.faces"\)/);
  assert.match(src("photolab/panels.js"), /id: "selFaces"[\s\S]*id: "fBlurFaces"/);
  assert.match(src("photolab/index.html"), /<script src="faces\.js\?v=/);
  const de = src("i18n/de/share.js") + src("i18n/de/photolab.js");
  ["fxFail", "fxHint", "menu.fBlurFaces", "faces.need"].forEach((k) => assert.ok(de.includes('"' + k + '"'), k));
  // not loaded at boot
  assert.doesNotMatch(src("index.html"), /facekit\.js/);
});
