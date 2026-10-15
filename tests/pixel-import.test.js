// Pixel Avatar: reading sprites and palettes from other pixel-art apps
// (pixel/import.js). Fixtures are built here from the documented
// formats: an Aseprite file writer (header, frames, layer / cel /
// palette chunks), Piskel JSON, and the palette text formats.
// Run: node --test tests/

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const zlib = require("zlib");
const IMP = require("../pixel/import.js");

// ---------- an Aseprite writer (just enough of the spec) ----------
function le(n, v) { const b = Buffer.alloc(n); if (n === 1) b.writeUInt8(v & 255); else if (n === 2) b.writeUInt16LE(v & 0xffff); else b.writeUInt32LE(v >>> 0); return b; }
function s16(v) { const b = Buffer.alloc(2); b.writeInt16LE(v); return b; }
function str(s) { const b = Buffer.from(s, "utf8"); return Buffer.concat([le(2, b.length), b]); }
function chunk(type, data) { return Buffer.concat([le(4, data.length + 6), le(2, type), data]); }
function layer(name, o) {
  o = o || {};
  return chunk(0x2004, Buffer.concat([le(2, o.hidden ? 0 : 1), le(2, o.type || 0), le(2, o.level || 0), le(2, 0), le(2, 0),
    le(2, o.blend || 0), le(1, o.op == null ? 255 : o.op), Buffer.alloc(3), str(name)]));
}
function cel(li, x, y, w, h, px, o) {
  o = o || {};
  const head = Buffer.concat([le(2, li), s16(x), s16(y), le(1, o.op == null ? 255 : o.op)]);
  if (o.link != null) return chunk(0x2005, Buffer.concat([head, le(2, 1), s16(0), Buffer.alloc(5), le(2, o.link)]));
  const raw = Buffer.from(px);
  const body = o.zip ? zlib.deflateSync(raw) : raw;
  return chunk(0x2005, Buffer.concat([head, le(2, o.zip ? 2 : 0), s16(0), Buffer.alloc(5), le(2, w), le(2, h), body]));
}
function palette(cols) {
  const parts = [le(4, cols.length), le(4, 0), le(4, cols.length - 1), Buffer.alloc(8)];
  cols.forEach((c) => parts.push(le(2, 0), Buffer.from(c)));
  return chunk(0x2019, Buffer.concat(parts));
}
function frame(chunks, dur) {
  const body = Buffer.concat(chunks);
  return Buffer.concat([le(4, body.length + 16), le(2, 0xF1FA), le(2, chunks.length), le(2, dur || 100), Buffer.alloc(2), le(4, chunks.length), body]);
}
function aseprite(w, h, depth, frames, o) {
  o = o || {};
  const body = Buffer.concat(frames);
  const head = Buffer.alloc(128);
  head.writeUInt32LE(body.length + 128, 0);
  head.writeUInt16LE(0xA5E0, 4);
  head.writeUInt16LE(frames.length, 6);
  head.writeUInt16LE(w, 8); head.writeUInt16LE(h, 10);
  head.writeUInt16LE(depth, 12);
  head.writeUInt32LE(1, 14);                     // layer opacity is valid
  head.writeUInt8(o.tIndex || 0, 28);
  return new Uint8Array(Buffer.concat([head, body]));
}
const RED = [255, 0, 0, 255], BLUE = [0, 0, 255, 255], CLEAR = [0, 0, 0, 0];
const fill = (n, c) => [].concat(...Array.from({ length: n }, () => c));
const px = (img, x, y) => Array.from(img.data.slice((y * img.w + x) * 4, (y * img.w + x) * 4 + 4));

test("detect: Aseprite, Adobe swatches, Piskel, palettes by content", () => {
  const ase = aseprite(4, 4, 32, [frame([layer("a")])]);
  assert.equal(IMP.detect("x.aseprite", ase), "aseprite");
  assert.equal(IMP.detect("x.ase", ase), "aseprite");
  assert.equal(IMP.detect("x.ase", new Uint8Array(Buffer.from("ASEF\x00\x01\x00\x00\x00\x00\x00\x00", "latin1"))), "asef");
  assert.equal(IMP.detect("a.piskel", Buffer.from('{"modelVersion":2,"piskel":{}}')), "piskel");
  assert.equal(IMP.detect("a.gpl", Buffer.from("GIMP Palette\nName: x\n0 0 0 black\n")), "gpl");
  assert.equal(IMP.detect("a.pal", Buffer.from("JASC-PAL\r\n0100\r\n1\r\n1 2 3\r\n")), "jasc");
  assert.equal(IMP.detect("a.txt", Buffer.from("; paint.net\nFFFF0000\nFF00FF00\n")), "paintnet");
  assert.equal(IMP.detect("a.hex", Buffer.from("ff0000\n00ff00\n")), "hex");
  assert.equal(IMP.detect("a.txt", Buffer.from("hello world")), null);
  assert.equal(IMP.detect("a.bin", new Uint8Array([1, 2, 3])), null);
});

test("aseprite: RGBA layers flattened per frame, hidden and opacity respected, zlib cels, linked cels", async () => {
  const f1 = frame([
    layer("bg"), layer("ghost", { hidden: true }), layer("half", { op: 128 }),
    cel(0, 0, 0, 2, 2, fill(4, RED), { zip: true }),
    cel(1, 0, 0, 2, 2, fill(4, [0, 255, 0, 255])),
    cel(2, 1, 1, 1, 1, BLUE)
  ], 120);
  const f2 = frame([cel(0, 0, 0, 0, 0, [], { link: 0 }), cel(2, 0, 0, 1, 1, BLUE)], 80);
  const doc = await IMP.parseAseprite(aseprite(2, 2, 32, [f1, f2]));
  assert.equal(doc.w, 2); assert.equal(doc.frames.length, 2);
  assert.deepEqual(doc.layers.map((l) => [l.name, l.vis, l.op]), [["bg", 1, 255], ["ghost", 0, 255], ["half", 1, 128]]);
  assert.deepEqual(doc.frames.map((f) => f.dur), [120, 80]);
  const a = IMP.frameRgba(doc, 0);
  assert.deepEqual(px(a, 0, 0), RED);                       // the hidden green layer is left out
  const mid = px(a, 1, 1);                                  // half-opaque blue over red
  assert.ok(mid[0] > 100 && mid[0] < 150 && mid[2] > 100 && mid[2] < 150 && mid[3] === 255, String(mid));
  const b = IMP.frameRgba(doc, 1);
  assert.deepEqual(px(b, 1, 1), RED);                       // linked to frame 1's red cel
  assert.ok(px(b, 0, 0)[2] > 100);
});

test("aseprite: indexed with palette and transparent index; grayscale; groups hide children", async () => {
  const idx = aseprite(2, 1, 8, [frame([palette([[0, 0, 0, 255], [10, 20, 30, 255]]), layer("l"), cel(0, 0, 0, 2, 1, [0, 1])])]);
  const d1 = await IMP.parseAseprite(idx);
  assert.deepEqual(d1.palette, ["#000000", "#0a141e"]);
  const r1 = IMP.frameRgba(d1, 0);
  assert.deepEqual(px(r1, 0, 0), CLEAR);                    // index 0 is the transparent one
  assert.deepEqual(px(r1, 1, 0), [10, 20, 30, 255]);
  const gray = aseprite(1, 1, 16, [frame([layer("g"), cel(0, 0, 0, 1, 1, [77, 255])])]);
  assert.deepEqual(px(IMP.frameRgba(await IMP.parseAseprite(gray), 0), 0, 0), [77, 77, 77, 255]);
  const grp = aseprite(1, 1, 32, [frame([layer("G", { type: 1, hidden: true }), layer("child", { level: 1 }), layer("top"),
    cel(1, 0, 0, 1, 1, RED)])]);
  const d3 = await IMP.parseAseprite(grp);
  assert.deepEqual(d3.layers.map((l) => l.vis), [0, 0, 1]);
  assert.deepEqual(px(IMP.frameRgba(d3, 0), 0, 0), CLEAR);
});

test("aseprite: damaged, oversized and odd files are refused", async () => {
  await assert.rejects(IMP.parseAseprite(new Uint8Array(200)), /bad/);
  const big = aseprite(4000, 4, 32, [frame([])]);
  await assert.rejects(IMP.parseAseprite(big), /big/);
  const cut = aseprite(2, 2, 32, [frame([layer("a"), cel(0, 0, 0, 2, 2, fill(4, RED))])]).slice(0, 170);
  await assert.rejects(IMP.parseAseprite(cut), /bad/);
  const depth = aseprite(2, 2, 24, [frame([])]);
  await assert.rejects(IMP.parseAseprite(depth), /bad/);
});

test("piskel: layers of JSON strings with sprite-sheet chunks; frames put together", () => {
  const L = (name, op, layout) => JSON.stringify({ name, opacity: op, frameCount: 2, chunks: [{ layout, base64PNG: "data:image/png;base64,iVBORw0KGgo=" }] });
  const text = JSON.stringify({ modelVersion: 2, piskel: { name: "Hero <b>", fps: 8, width: 2, height: 1, layers: [L("base", 1, [[0], [1]]), L("top", 0.5, [[0], [1]])] } });
  const doc = IMP.parsePiskel(text);
  assert.equal(doc.name, "Hero <b>");                     // text only, shown through textContent
  assert.equal(doc.count, 2); assert.equal(doc.fps, 8); assert.equal(doc.layers.length, 2);
  assert.equal(doc.layers[0].chunks[0].png[0], 0x89);     // base64 decoded
  // decoded sheets: 4×1 (two frames of 2×1 side by side)
  const sheet = (a, b) => ({ w: 4, h: 1, data: new Uint8ClampedArray([].concat(a, a, b, b)) });
  const sheets = [[sheet(RED, BLUE)], [sheet(CLEAR, [0, 255, 0, 255])]];
  const f0 = IMP.piskelFrame(doc, sheets, 0), f1 = IMP.piskelFrame(doc, sheets, 1);
  assert.deepEqual(px(f0, 0, 0), RED);
  const g = px(f1, 1, 0);
  assert.ok(g[1] > 100 && g[2] > 100, String(g));          // half green over blue
  assert.throws(() => IMP.parsePiskel("{}"), /bad/);
  assert.throws(() => IMP.parsePiskel(JSON.stringify({ piskel: { width: 5000, height: 2, layers: [] } })), /big/);
});

test("palettes: GIMP, Lospec hex, Paint.NET, JASC, Adobe swatches", () => {
  const P = (s, k) => IMP.parsePalette(Buffer.from(s), k).colors;
  assert.deepEqual(P("GIMP Palette\nName: Test\nColumns: 4\n# c\n255   0   0\tRed\n0 128 255 Sky\n", "gpl"), ["#ff0000", "#0080ff"]);
  assert.deepEqual(P("FF0000\r\n#00ff00\n\n", "hex"), ["#ff0000", "#00ff00"]);
  assert.deepEqual(P("; Paint.NET Palette File\n;\nFFFF0000\n800000FF\n", "paintnet"), ["#ff0000", "#0000ff"]);
  assert.deepEqual(P("JASC-PAL\r\n0100\r\n2\r\n1 2 3\r\n250 251 252\r\n", "jasc"), ["#010203", "#fafbfc"]);
  // ASEF: header, one group start, one RGB entry, one CMYK entry
  function entry(name, model, vals) {
    const nm = Buffer.from(name + "\0", "utf16le").swap16();
    const fl = Buffer.alloc(vals.length * 4); vals.forEach((v, i) => fl.writeFloatBE(v, i * 4));
    const body = Buffer.concat([Buffer.from([0, name.length + 1]), nm, Buffer.from(model, "latin1"), fl, Buffer.from([0, 2])]);
    const h = Buffer.alloc(6); h.writeUInt16BE(1, 0); h.writeUInt32BE(body.length, 2);
    return Buffer.concat([h, body]);
  }
  const grp = Buffer.from([0xc0, 1, 0, 0, 0, 2, 0, 0]);
  const head = Buffer.alloc(12); head.write("ASEF", 0, "latin1"); head.writeUInt16BE(1, 4); head.writeUInt32BE(3, 8);
  const asef = new Uint8Array(Buffer.concat([head, grp, entry("Red", "RGB ", [1, 0, 0]), entry("Black", "CMYK", [0, 0, 0, 1])]));
  assert.equal(IMP.detect("s.ase", asef), "asef");
  assert.deepEqual(IMP.parsePalette(asef, "asef").colors, ["#ff0000", "#000000"]);
  assert.equal(IMP.parsePalette(Buffer.from("nothing"), "gpl"), null);
  // the first 8 different colours; fewer are filled from the face
  const pc = IMP.paletteColors(["#111111", "#111111", "#222222"], ["#aaaaaa", "#bbbbbb"]);
  assert.equal(pc.used, 2); assert.equal(pc.c.length, 8);
  assert.deepEqual(pc.c.slice(0, 4), ["#111111", "#222222", "#aaaaaa", "#bbbbbb"]);
});

test("toFace: fits 8/12/16, crops and scales big sprites, see-through background, 8 colours", () => {
  const img = (w, h, f) => {
    const d = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) d.set(f(x, y), (y * w + x) * 4);
    return { w, h, data: d };
  };
  // 8×8 fully opaque, two colours → n 8, no clear, exact
  const a = IMP.toFace(img(8, 8, (x) => (x < 4 ? RED : BLUE)));
  assert.equal(a.n, 8); assert.equal(a.b, 0); assert.equal(a.px.length, 64);
  assert.match(a.px, /^[0-7]+$/); assert.equal(a.c.length, 8);
  assert.equal(a.c[+a.px[0]], "#ff0000"); assert.equal(a.c[+a.px[7]], "#0000ff");
  // 10×10 → 12, centred, padding see-through (0) and b = 1
  const b = IMP.toFace(img(10, 10, () => RED));
  assert.equal(b.n, 12); assert.equal(b.b, 1); assert.equal(b.px[0], "0"); assert.equal(b.px[13], "1");
  // 64×64 with a 32×32 drawing → cropped then scaled to 16
  const c = IMP.toFace(img(64, 64, (x, y) => (x >= 16 && x < 48 && y >= 16 && y < 48 ? (x < 32 ? RED : BLUE) : CLEAR)));
  assert.equal(c.n, 16); assert.ok(c.crop); assert.ok(c.scaled); assert.equal(c.b, 0);
  // scaling down keeps a one-pixel detail (an eye) instead of the fill around it
  const eye = IMP.toFace(img(32, 32, (x, y) => (x === 9 && y === 9 ? BLUE : RED)));
  assert.equal(eye.n, 16); assert.ok(eye.scaled);
  assert.equal(eye.c[+eye.px[4 * 16 + 4]], "#0000ff");
  assert.equal((eye.px.match(new RegExp(eye.px[4 * 16 + 4], "g")) || []).length, 1);
  // many colours → 8 at most, reduced, deterministic
  const many = img(16, 16, (x, y) => [x * 16, y * 16, (x * y) & 255, 255]);
  const m1 = IMP.toFace(many), m2 = IMP.toFace(many);
  assert.ok(m1.reduced); assert.equal(m1.colors, 256); assert.deepEqual(m1, m2);
  assert.equal(new Set(m1.px).size <= 8, true);
  m1.c.forEach((h) => assert.match(h, /^#[0-9a-f]{6}$/));
  assert.equal(IMP.toFace(img(4, 4, () => CLEAR)), null);
  assert.equal(IMP.baseName("C:\\art\\hero.aseprite"), "hero");
});
