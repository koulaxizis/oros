// Photo Lab — Portrait blur and Select by depth (PB): pure steps of
// photolab/portrait.js and the wiring around it.
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const read = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");
const P = require("../photolab/portrait.js");

function solid(w, h, rgba) {
  const d = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) d.set(rgba, i * 4);
  return { w, h, data: d };
}

test("the model's input: short side 518, both sides multiples of 14, long side at most 1036", () => {
  for (const [w, h] of [[1024, 768], [768, 1024], [1000, 1000], [4000, 1000], [300, 200]]) {
    const z = P.inputSize(w, h);
    assert.equal(z.w % 14, 0); assert.equal(z.h % 14, 0);
    assert.ok(Math.abs(Math.min(z.w, z.h) - 518) <= 7 || Math.max(z.w, z.h) >= 1036 - 7, w + "x" + h + " → " + z.w + "x" + z.h);
    assert.ok(Math.max(z.w, z.h) <= 1036);
    assert.ok(Math.abs(z.w / z.h - w / h) < 0.05 || Math.max(w, h) / Math.min(w, h) > 2, "aspect kept");
  }
});

test("prep: CHW, ImageNet normalised", () => {
  const x = P.prep(new Uint8ClampedArray([255, 0, 128, 255, 0, 255, 128, 255]), 2, 1);
  assert.equal(x.length, 6);
  assert.ok(Math.abs(x[0] - (1 - 0.485) / 0.229) < 1e-5);
  assert.ok(Math.abs(x[1] - (0 - 0.485) / 0.229) < 1e-5);
  assert.ok(Math.abs(x[2] - (0 - 0.456) / 0.224) < 1e-5, "G plane follows R plane");
});

test("normDepth: 0..1, a few odd values do not decide the range", () => {
  const raw = new Float32Array(1000);
  for (let i = 0; i < 1000; i++) raw[i] = i / 1000;
  raw[0] = -50; raw[999] = 90;
  const d = P.normDepth(raw);
  assert.ok(d.every((v) => v >= 0 && v <= 1));
  assert.ok(d[500] > 0.4 && d[500] < 0.6, "the middle stays in the middle");
});

test("guided filter: a flat input stays flat, an edge in the guide keeps the depth's edge", () => {
  const w = 40, h = 20, I = new Float32Array(w * h), p = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { I[y * w + x] = x < 20 ? 0.1 : 0.9; p[y * w + x] = x < 20 ? 0.2 : 0.8; }
  const flat = P.guided(I, new Float32Array(w * h).fill(0.5), w, h, 4, 1e-3);
  assert.ok(flat.every((v) => Math.abs(v - 0.5) < 1e-4));
  const g = P.guided(I, p, w, h, 4, 1e-3);
  assert.ok(g[10 * w + 18] < 0.3 && g[10 * w + 21] > 0.7, "the step stays sharp where the photo has one");
});

test("cocMap: sharp at the focus, nearer and within the depth of field, R far away, the subject always sharp", () => {
  const depth = new Float32Array([0.9, 0.85, 0.5, 0.1]);
  const c = P.cocMap(depth, 4, 1, { R: 20, focus: 0.9, dof: 0.1, soft: 0 });
  assert.equal(c[0], 0); assert.equal(c[1], 0);
  assert.ok(c[2] > 0 && c[2] <= 20); assert.equal(c[3], 20);
  const g = P.cocMap(depth, 4, 1, { R: 20, focus: 0.9, dof: 0, soft: 0, subj: new Float32Array([0, 0, 0, 1]) });
  assert.equal(g[3], 0, "subject mask 1 → no blur");
  const near = P.cocMap(new Float32Array([1, 0.2]), 2, 1, { R: 20, focus: 0.5, dof: 0, soft: 0 });
  assert.equal(near[0], 0, "nearer than the focus stays sharp");
  assert.ok(P.otsu(new Float32Array([0.1, 0.1, 0.12, 0.9, 0.92, 0.88])) > 0.12 && P.otsu(new Float32Array([0.1, 0.1, 0.12, 0.9, 0.92, 0.88])) < 0.88);
});

test("autoFocus: the subject's depth when known, else the near part", () => {
  const depth = new Float32Array(100);
  for (let i = 0; i < 100; i++) depth[i] = i / 99;
  assert.ok(P.autoFocus(depth, null) > 0.4, "the back of the near part");
  const subj = new Float32Array(100); for (let i = 40; i < 60; i++) subj[i] = 1;
  const f = P.autoFocus(depth, subj);
  assert.ok(f > 0.38 && f < 0.46, "the back of the subject: " + f);
});

test("depthSel: near inside, far with far=true, soft edge", () => {
  const d = new Float32Array([1, 0.6, 0.4, 0]);
  const near = P.depthSel(d, 0.5, 0.05, false), far = P.depthSel(d, 0.5, 0.05, true);
  assert.equal(near[0], 255); assert.equal(near[3], 0);
  assert.equal(far[0], 0); assert.equal(far[3], 255);
  const soft = P.depthSel(new Float32Array([0.5]), 0.5, 0.2, false);
  assert.ok(soft[0] > 100 && soft[0] < 155);
});

test("render: no blur keeps the picture; sharp pixels stay; the mask says where", () => {
  const img = solid(30, 20, [10, 20, 30, 255]);
  const none = P.render({ img, coc: new Float32Array(6), gw: 3, gh: 2, R: 0 });
  assert.deepEqual(Array.from(none.img.data), Array.from(img.data));
  assert.ok(none.mask.every((v) => v === 0));
  // left half sharp, right half blurred
  const coc = new Float32Array([0, 0, 12, 12, 0, 0, 12, 12]);
  const r = P.render({ img, coc, gw: 4, gh: 2, R: 12 });
  assert.equal(r.mask[5 * 30 + 1], 0, "sharp side: mask 0");
  assert.equal(r.mask[5 * 30 + 28], 255, "blurred side: mask 255");
  assert.deepEqual(Array.from(r.img.data.slice(0, 4)), [10, 20, 30, 255], "a flat colour stays the same colour");
});

test("render: the sharp subject does not smear into the blurred background", () => {
  const W = 80, H = 40, img = solid(W, H, [0, 0, 255, 255]);
  for (let y = 0; y < H; y++) for (let x = 0; x < 30; x++) img.data.set([255, 0, 0, 255], (y * W + x) * 4);   // red subject on the left
  const gw = W, gh = H, coc = new Float32Array(gw * gh);
  for (let y = 0; y < gh; y++) for (let x = 0; x < gw; x++) coc[y * gw + x] = x < 30 ? 0 : 20;
  const r = P.render({ img, coc, gw, gh, R: 20 });
  const j = (20 * W + 34) * 4;           // background, 4 px from the subject
  assert.ok(r.img.data[j + 2] > 200 && r.img.data[j] < 60, "stays blue: " + Array.from(r.img.data.slice(j, j + 4)));
});

test("render: bokeh makes bright spots stronger, never past 255", () => {
  const W = 60, H = 60, img = solid(W, H, [20, 20, 20, 255]);
  img.data.set([255, 255, 255, 255], (30 * W + 30) * 4);
  const coc = new Float32Array(W * H).fill(10);
  const a = P.render({ img, coc, gw: W, gh: H, R: 10 }), b = P.render({ img, coc, gw: W, gh: H, R: 10, bokeh: true });
  const j = (30 * W + 33) * 4;
  assert.ok(b.img.data[j] > a.img.data[j], "brighter disc with bokeh");
  assert.ok(Array.from(b.img.data).every((v) => v <= 255));
});

// ---------- Wiring ----------
test("the model comes from the orOS mirror, SHA-256 checked before it is kept; only the Small model", () => {
  const src = read("photolab/portrait.js");
  assert.equal(P.MODEL.url, "https://koulaxizis.github.io/oros-models-vision/depth-anything-v2-small/onnx/model_quantized.onnx");
  assert.match(P.MODEL.sha, /^[0-9a-f]{64}$/);
  assert.match(src, /crypto\.subtle\.digest\("SHA-256"/);
  assert.match(src, /if \(hex\(d\) !== MODEL\.sha\) throw/);
  assert.doesNotMatch(src, /huggingface\.co/, "never straight from Hugging Face");
  assert.doesNotMatch(src, /depth-anything-v2-(base|large|giant)/i, "Base/Large are CC BY-NC");
  assert.match(src, /CUT\.sessionOf\(/, "the runtime through Atelier's loader");
  assert.doesNotMatch(src, /["']\.\.\/vendor\/ort/, "no second runtime path");
});

test("Photo Lab: menu items, lazy load, PL-AI command, strings in EN, EL and DE, help", () => {
  const panels = read("photolab/panels.js"), sub = read("photolab/subject.js");
  assert.match(panels, /id: "fPortrait", run: function \(\) \{ PL\.subject\.runPortrait\("blur"\); \}/);
  assert.match(panels, /id: "selDepth", run: function \(\) \{ PL\.subject\.runPortrait\("select"\); \}/);
  assert.match(sub, /s\.src = "portrait\.js"/);
  assert.doesNotMatch(read("photolab/index.html"), /portrait\.js/, "loaded on first use, not at start");
  const CMD = require("../photolab/commands.js");
  assert.ok(CMD.check([{ op: "portrait", amt: 70 }]).ok);
  assert.ok(!CMD.check([{ op: "portrait", amt: 0 }]).ok || CMD.check([{ op: "portrait", amt: 0 }]).steps[0].amt >= 1);
  assert.match(read("photolab/aiedit.js"), /portrait: portrait/);
  global.window = {};
  require(path.join(ROOT, "photolab/strings.js"));
  const S = global.window.PL_STRINGS, de = read("i18n/de/photolab.js");
  delete global.window;
  const keys = new Set((read("photolab/portrait.js").match(/t\("(pb|dlg)\.[a-zA-Z]+"/g) || []).map((x) => x.slice(3, -1)));
  ["menu.fPortrait", "menu.selDepth", "pb.tapSel", "pb.download", "pb.find"].forEach((k) => keys.add(k));
  keys.forEach((k) => {
    assert.ok(S.en[k] && S.el[k], k + " in EN and EL");
    assert.ok(de.indexOf('"' + k + '":') > 0, k + " in DE");
  });
  assert.match(read("photolab/help.en.txt"), /## Portrait blur/);
  assert.match(read("photolab/help.el.txt"), /## Θολό φόντο πορτρέτου/);
  assert.match(read("CREDITS.md"), /Depth Anything V2/);
  assert.match(read("shell.js"), /k: "cr\.depth-anything"/);
});
