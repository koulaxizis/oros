"use strict";
// Photo Lab automations (photolab/recipesteps.js, wave A2): the catalog
// through recipes/core.js, centred crops, resize sizes, the adjust /
// filter jobs on real pixels, watermark settings; and no app's catalog
// names an argument "op" (it would overwrite the step's own op).
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const R = require(path.join(ROOT, "recipes/core.js"));
const S = require(path.join(ROOT, "photolab/recipesteps.js"));
const A = require(path.join(ROOT, "photolab/adjust.js"));
const F = require(path.join(ROOT, "photolab/filters.js"));
const FX = require(path.join(ROOT, "designkit/fx.js"));
const B = require(path.join(ROOT, "photolab/batchcore.js"));

function img(w, h) {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4;
    data[i] = (x * 37) % 256; data[i + 1] = (y * 53) % 256; data[i + 2] = ((x + y) * 11) % 256; data[i + 3] = 255;
  }
  return { w, h, data };
}

test("catalogs: every op in ORDER, no argument called op", () => {
  assert.deepEqual(S.ORDER.slice().sort(), Object.keys(S.CATALOG).sort());
  for (const file of ["photolab/recipesteps.js", "layout/recipesteps.js", "atelier/recipesteps.js"]) {
    const cat = require(path.join(ROOT, file)).CATALOG;
    for (const [op, def] of Object.entries(cat)) assert.ok(!("op" in (def.args || {})), file + " " + op + " has an argument named op");
  }
});

test("catalog: steps are checked and clamped", () => {
  const n = (s) => R.normStep(s, S.CATALOG);
  assert.deepEqual(n({ op: "tone", bright: 250, sepia: -5 }), { op: "tone", bright: 100, contrast: 0, sat: 0, warmth: 0, tint: 0, fade: 0, sepia: 0, vignette: 0 });
  assert.equal(n({ op: "look", id: "nope" }).id, S.LOOKS[0]);
  assert.ok(S.LOOKS.indexOf("none") < 0 && S.LOOKS.indexOf("noir") >= 0);
  assert.equal(n({ op: "watermark", text: "" }), null, "a watermark needs a text");
  const wm = n({ op: "watermark", text: "© Me", c: "#FF0000", pos: "zz", opacity: 1 });
  assert.deepEqual([wm.c, wm.pos, wm.opacity, wm.size], ["#ff0000", "br", 5, 5]);
  assert.equal(n({ op: "crop", ratio: "7:3" }).ratio, "1:1");
  assert.equal(n({ op: "resize", mode: "long", v: 99999 }).v, B.MAX_SIDE);
  assert.equal(n({ op: "export", fmt: "gif" }).fmt, "jpg");
  assert.equal(n({ op: "gray" }).op, "gray");
  assert.equal(n({ op: "run", code: "x" }), null);
});

test("cropRect: the largest centred part", () => {
  assert.deepEqual(S.cropRect(4000, 3000, "1:1"), { x: 500, y: 0, w: 3000, h: 3000 });
  assert.deepEqual(S.cropRect(3000, 4000, "16:9"), { x: 0, y: 1156, w: 3000, h: 1688 });
  assert.deepEqual(S.cropRect(1600, 900, "16:9"), { x: 0, y: 0, w: 1600, h: 900 }, "already that ratio");
  assert.deepEqual(S.cropRect(1, 1, "9:16"), { x: 0, y: 0, w: 1, h: 1 }, "never empty");
  const r = S.cropRect(1000, 1000, "4:5");
  assert.equal(r.w, 800); assert.equal(r.h, 1000); assert.equal(r.x, 100);
});

test("resizeTo: batch sizes, percent at most 400, never larger unless asked", () => {
  assert.deepEqual(S.resizeTo(4000, 3000, { mode: "long", v: 2048, up: 0 }), { w: 2048, h: 1536 });
  assert.deepEqual(S.resizeTo(800, 600, { mode: "long", v: 2048, up: 0 }), { w: 800, h: 600 });
  assert.deepEqual(S.resizeTo(800, 600, { mode: "long", v: 1600, up: 1 }), { w: 1600, h: 1200 });
  assert.deepEqual(S.resizeTo(100, 50, { mode: "pct", v: 900, up: 1 }), { w: 400, h: 200 });
  assert.deepEqual(S.resizeTo(1000, 500, { mode: "h", v: 250, up: 0 }), { w: 500, h: 250 });
});

test("jobs: tone, look, gray, blur, sharpen and grain run on real pixels", () => {
  const steps = ["tone", "look", "gray", "blur", "sharpen", "noise"].map((op) => {
    const s = { op };
    if (op === "tone") Object.assign(s, { bright: 30, sat: -20 });
    return R.normStep(s, S.CATALOG);
  });
  for (const st of steps) {
    const j = S.job(st);
    assert.ok(j && (j.kind === "adjust" || j.kind === "filter"), st.op);
    const src = img(24, 16), before = Array.from(src.data);
    let out;
    if (j.kind === "adjust") { assert.ok(A.IDS ? A.IDS.indexOf(j.id) >= 0 : true); A.run(src, j.id, j.p, FX); out = src; }
    else out = F.run(src, j.id, j.p, { x: 0, y: 0, cw: 24, ch: 16 });
    assert.equal(out.w, 24); assert.equal(out.h, 16);
    assert.notDeepEqual(Array.from(out.data), before, st.op + " changes the picture");
    for (let i = 3; i < out.data.length; i += 4) assert.equal(out.data[i], 255, st.op + " keeps alpha");
  }
  assert.equal(S.job({ op: "crop", ratio: "1:1" }), null);
  assert.ok(S.isIdentity(R.normStep({ op: "tone" }, S.CATALOG)));
  assert.ok(!S.isIdentity(R.normStep({ op: "tone", fade: 1 }, S.CATALOG)));
});

test("wmOf: a text watermark for the batch drawer", () => {
  const st = R.normStep({ op: "watermark", text: "© Chris", size: 8, c: "", pos: "tl", opacity: 40 }, S.CATALOG);
  assert.deepEqual(S.wmOf(st), { kind: "text", text: "© Chris", size: 8, c: "#ffffff", pos: "tl", op: 40 });
  const p = B.wmPos(1000, 800, 100, 20, "tl", B.wmMargin(1000, 800));
  assert.ok(p.x >= 0 && p.y >= 0);
});
