// Photo Lab batch processing and Select subject: the pure parts
// (photolab/batchcore.js: settings, output sizes, file names,
// watermark places, the adjustment stack) and the wiring rules
// (one model, Atelier's loader; old projects unchanged).
// Run: node --test tests/

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const B = require("../photolab/batchcore.js");
const A = require("../photolab/adjust.js");
const C = require("../photolab/core.js");

const ROOT = path.join(__dirname, "..");
const read = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");

// ---------- Settings ----------
test("norm: defaults, clamps and unknown values", () => {
  const d = B.norm(null);
  assert.equal(d.adj, "none");
  assert.deepEqual(d.rs, { mode: "long", v: 2048, up: false });
  assert.equal(d.fmt, "jpg"); assert.equal(d.q, 88); assert.equal(d.pattern, "{name}");
  assert.equal(d.dest, "disk"); assert.equal(d.folder, "Batch");
  assert.equal(d.wm.kind, "none"); assert.equal(d.wm.pos, "br");
  const n = B.norm({ adj: "magic", rs: { mode: "pct", v: 9999, up: 1 }, fmt: "gif", q: 5, pattern: "", dest: "zip",
    folder: "../../etc", wm: { kind: "text", text: "x".repeat(500), size: 0, c: "red", pos: "middle", op: 1 } });
  assert.equal(n.adj, "none");
  assert.deepEqual(n.rs, { mode: "pct", v: 400, up: true });
  assert.equal(n.fmt, "jpg"); assert.equal(n.q, 10); assert.equal(n.pattern, "{name}"); assert.equal(n.dest, "zip");
  assert.equal(n.folder, ".. .. etc");
  assert.equal(n.wm.text.length, 200); assert.equal(n.wm.size, 1); assert.equal(n.wm.c, "#ffffff"); assert.equal(n.wm.pos, "br"); assert.equal(n.wm.op, 5);
  assert.equal(B.norm({ rs: { mode: "pct" } }).rs.v, 50);
  assert.deepEqual(B.norm(B.norm({ fmt: "webp", q: 70 })), B.norm({ fmt: "webp", q: 70 }), "stable");
});

test("cleanFolder: one folder name, no paths", () => {
  assert.equal(B.cleanFolder("Holiday 2026"), "Holiday 2026");
  assert.equal(B.cleanFolder("a/b\\c:d"), "a b c d");
  assert.equal(B.cleanFolder(".."), "");
  assert.equal(B.cleanFolder("   "), "");
  assert.equal(B.cleanFolder(42), "");
  assert.equal(B.cleanFolder("x".repeat(100)).length, 60);
});

// ---------- Resize maths ----------
test("targetSize: long side, width, height, percent, none", () => {
  assert.deepEqual(B.targetSize(6000, 4000, { mode: "long", v: 2048 }), { w: 2048, h: 1365 });
  assert.deepEqual(B.targetSize(4000, 6000, { mode: "long", v: 2048 }), { w: 1365, h: 2048 });
  assert.deepEqual(B.targetSize(6000, 4000, { mode: "w", v: 1200 }), { w: 1200, h: 800 });
  assert.deepEqual(B.targetSize(6000, 4000, { mode: "h", v: 1000 }), { w: 1500, h: 1000 });
  assert.deepEqual(B.targetSize(6000, 4000, { mode: "pct", v: 25 }), { w: 1500, h: 1000 });
  assert.deepEqual(B.targetSize(6000, 4000, { mode: "none", v: 10 }), { w: 6000, h: 4000 });
  assert.deepEqual(B.targetSize(3, 2, { mode: "pct", v: 10 }), { w: 1, h: 1 }, "never below 1 px");
  assert.deepEqual(B.targetSize(1001, 667, { mode: "long", v: 500 }), { w: 500, h: 333 });
});

test("targetSize: smaller photos stay as they are unless enlarging is on; never past 8192", () => {
  assert.deepEqual(B.targetSize(800, 600, { mode: "long", v: 2048 }), { w: 800, h: 600 });
  assert.deepEqual(B.targetSize(800, 600, { mode: "long", v: 2048, up: true }), { w: 2048, h: 1536 });
  assert.deepEqual(B.targetSize(800, 600, { mode: "pct", v: 200 }), { w: 800, h: 600 });
  assert.deepEqual(B.targetSize(800, 600, { mode: "pct", v: 200, up: true }), { w: 1600, h: 1200 });
  assert.deepEqual(B.targetSize(5000, 2500, { mode: "pct", v: 400, up: true }), { w: 8192, h: 4096 });
  assert.deepEqual(B.targetSize(10000, 5000, { mode: "none" }), { w: 8192, h: 4096 }, "the editor's limit");
  assert.deepEqual(B.targetSize(800, 600, { mode: "long", v: NaN }), { w: 800, h: 600 });
  assert.deepEqual(B.targetSize(800, 600, { mode: "long", v: -5 }), { w: 800, h: 600 });
});

test("rawHalf: develop RAW at half size only when the output is at most half as big", () => {
  assert.equal(B.rawHalf({ mode: "pct", v: 50 }, 0, 0), true);
  assert.equal(B.rawHalf({ mode: "pct", v: 51 }, 0, 0), false);
  assert.equal(B.rawHalf({ mode: "long", v: 2048 }, 0, 0), false, "size unknown: full");
  assert.equal(B.rawHalf({ mode: "long", v: 2048 }, 6000, 4000), true);
  assert.equal(B.rawHalf({ mode: "long", v: 3500 }, 6000, 4000), false);
  assert.equal(B.rawHalf({ mode: "none" }, 6000, 4000), false);
});

// ---------- Names ----------
test("fileName: tokens, numbers with zeros, date, size", () => {
  const ctx = { name: "IMG_0042.CR2", n: 7, date: "2026-10-14", w: 2048, h: 1365 };
  assert.equal(B.fileName("{name}", ctx), "IMG_0042");
  assert.equal(B.fileName("{nnn} {name}", ctx), "007 IMG_0042");
  assert.equal(B.fileName("trip-{n}", ctx), "trip-7");
  assert.equal(B.fileName("{name}_{w}x{h}_{date}", ctx), "IMG_0042_2048x1365_2026-10-14");
  assert.equal(B.fileName("{NAME}-{NN}", ctx), "IMG_0042-07");
  assert.equal(B.fileName("{nnnnnnnnn}", ctx), "000007", "at most 6 digits");
  assert.equal(B.fileName("{unknown} {name}", ctx), "{unknown} IMG_0042");
  assert.equal(B.fileName("{date}", { date: new Date(2026, 0, 5) }), "2026-01-05");
});

test("fileName: safe names; empty falls back", () => {
  assert.equal(B.fileName("a/b\\c:d*e?f\"g<h>i|j", {}), "a-b-c-d-e-f-g-h-i-j");
  assert.equal(B.fileName("../{name}", { name: "x.jpg" }), "-x");
  assert.equal(B.fileName("   ", { name: "photo.png" }), "photo");
  assert.equal(B.fileName("{name}", { name: "", n: 3 }), "photo-003");
  assert.equal(B.fileName("...", { n: 1 }), "photo-001");
  assert.equal(B.fileName("{name}", { name: "/internal/Pictures/Trip/a b.jpeg" }), "a b");
  assert.ok(B.fileName("x".repeat(400), {}).length <= 120);
  assert.equal(B.fileName("tab\there", {}), "tab-here");
});

test("uniqueName: never the same name twice (any case), existing files count", () => {
  const taken = { "photo.jpg": 1 };
  assert.equal(B.uniqueName("photo", "jpg", taken), "photo (2).jpg");
  assert.equal(B.uniqueName("Photo", "jpg", taken), "Photo (3).jpg");
  assert.equal(B.uniqueName("photo", "png", taken), "photo.png");
  assert.equal(B.uniqueName("other", "jpg", taken), "other.jpg");
  assert.ok(taken["photo (3).jpg"] && taken["other.jpg"]);
});

// ---------- Watermark ----------
test("wmPos: the nine places, with the margin", () => {
  const at = (pos) => B.wmPos(1000, 800, 200, 100, pos, 20);
  assert.deepEqual(at("tl"), { x: 20, y: 20 });
  assert.deepEqual(at("t"), { x: 400, y: 20 });
  assert.deepEqual(at("tr"), { x: 780, y: 20 });
  assert.deepEqual(at("l"), { x: 20, y: 350 });
  assert.deepEqual(at("c"), { x: 400, y: 350 });
  assert.deepEqual(at("r"), { x: 780, y: 350 });
  assert.deepEqual(at("bl"), { x: 20, y: 680 });
  assert.deepEqual(at("b"), { x: 400, y: 680 });
  assert.deepEqual(at("br"), { x: 780, y: 680 });
  assert.equal(B.POS.length, 9);
});

test("wmFont / wmMargin / wmImageSize", () => {
  assert.equal(B.wmFont(2000, 1000, 5), 50);
  assert.equal(B.wmFont(100, 50, 1), 6, "at least 6 px");
  assert.equal(B.wmMargin(2000, 1000), 30);
  assert.deepEqual(B.wmImageSize(1000, 800, 400, 200, 20), { w: 200, h: 100 });
  assert.deepEqual(B.wmImageSize(1000, 100, 100, 400, 50), { w: 25, h: 100 }, "taller than the photo: fits its height");
});

// ---------- Adjustments ----------
test("stackOf: visible adjustment layers with opacity; masks counted, not used", () => {
  const layers = [
    { id: "lbg01", k: "raster" },
    { id: "ladj1", k: "adj", vis: 1, op: 100, aj: { id: "gray", p: {} } },
    { id: "ladj2", k: "adj", vis: 0, op: 100, aj: { id: "invert", p: {} } },
    { id: "ladj3", k: "adj", vis: 1, op: 50, aj: { id: "levels", p: { ib: 10, iw: 245, g: 1, ob: 0, ow: 255 } }, mk: { id: "lmask", on: 1 } },
    { id: "ladj4", k: "adj", vis: 1, op: 0, aj: { id: "invert", p: {} } }
  ];
  const s = B.stackOf(layers);
  assert.deepEqual(s.map((x) => [x.id, x.op]), [["gray", 100], ["levels", 50]]);
  assert.equal(s.masked, 1);
  s[1].p.ib = 99;
  assert.equal(layers[3].aj.p.ib, 10, "a copy, the picture is not touched");
  assert.equal(B.stackOf(null).length, 0);
  assert.deepEqual(B.stackFromXmp([{ id: "hsl", p: { s: 20 } }]), [{ id: "hsl", p: { s: 20 }, op: 100 }]);
});

test("applyStack: runs each adjustment, mixed by its opacity; alpha kept", () => {
  const img = () => ({ w: 2, h: 1, data: new Uint8ClampedArray([200, 100, 50, 255, 0, 0, 0, 128]) });
  const full = B.applyStack(img(), [{ id: "invert", p: {}, op: 100 }], A, null);
  assert.deepEqual([...full.data], [55, 155, 205, 255, 255, 255, 255, 128]);
  const half = B.applyStack(img(), [{ id: "invert", p: {}, op: 50 }], A, null);
  assert.deepEqual([...half.data].map((v) => Math.round(v)), [128, 128, 128, 255, 128, 128, 128, 128]);
  const none = B.applyStack(img(), [{ id: "invert", p: {}, op: 0 }], A, null);
  assert.deepEqual([...none.data], [...img().data]);
  const two = B.applyStack(img(), [{ id: "invert", p: {}, op: 100 }, { id: "invert", p: {}, op: 100 }], A, null);
  assert.deepEqual([...two.data], [...img().data]);
  const gray = B.applyStack(img(), [{ id: "gray", p: {}, op: 100 }], A, null);
  assert.equal(gray.data[0], gray.data[1]); assert.equal(gray.data[1], gray.data[2]);
});

// ---------- Wiring ----------
test("Select subject reuses Atelier's loader and model: no second copy, Atelier unchanged", () => {
  const sub = read("photolab/subject.js");
  assert.match(sub, /\.\.\/atelier\/cutout\.js/);
  assert.doesNotMatch(sub, /["']\.\.\/vendor\/(ort|u2netp)/, "the model and runtime come only through cutout.js");
  const files = fs.readdirSync(path.join(ROOT, "photolab"));
  assert.ok(!files.some((f) => /\.onnx$|ort/i.test(f)), "no model files in photolab/");
  const cut = require("../atelier/cutout.js");
  assert.equal(cut.S, 320);
  assert.equal(cut.FILES.model, "../vendor/u2netp/u2netp.onnx", "same relative path from photolab/ and atelier/");
  assert.doesNotMatch(read("photolab/index.html"), /cutout\.js/, "loaded on first use, not at start");
});

test("old projects load unchanged: the document schema is not touched", () => {
  const old = { ver: 1, id: "pabcdefgh12", m: 5, name: "Old", w: 100, h: 80,
    layers: [{ id: "labcd1", k: "raster", name: "Background", vis: 1, lock: 0, op: 100, bl: "normal", x: 0, y: 0, t: {} },
             { id: "labcd2", k: "adj", name: "Levels", vis: 1, lock: 0, op: 60, bl: "normal", x: 0, y: 0, aj: { id: "levels", p: {} },
               mk: { id: "labcd3", t: {}, on: 1, bg: 0 } }] };
  const n = C.normDoc(JSON.parse(JSON.stringify(old)));
  assert.equal(n.layers.length, 2);
  assert.deepEqual(n.layers[1].mk, { id: "labcd3", t: {}, on: 1, bg: 0 });
  assert.deepEqual(C.normDoc(JSON.parse(JSON.stringify(n))), n, "stable");
});
