// Atelier motion (wave 3): the animation extras in `ax` (an on an
// element, dur + ptr on the page background), the timing rules
// (atelier/anim.js) and the GIF encoder (atelier/gif.js), checked by
// decoding its output with a small GIF/LZW decoder written here.
// Run: node --test tests/

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const M = require(path.join(ROOT, "designkit/model.js"));
const AX = require(path.join(ROOT, "atelier/ax.js"));
const Anim = require(path.join(ROOT, "atelier/anim.js"));
const Gif = require(path.join(ROOT, "atelier/gif.js"));

function design() {
  const d = AX.newDesign({ name: "Motion", w: 1000, h: 500 }, 1000);
  const pg = d.pages[0].id;
  if (!AX.background(d, pg)) AX.addBackground(d, pg, "#ffffff", 1000);
  AX.addItem(d, pg, { k: "text", tx: "Hello world", size: 40, x: 10, y: 10, w: 400 }, 1000);
  AX.addItem(d, pg, { k: "shape", shp: "rect", fc: "#ff0000", x: 10, y: 100, w: 100, h: 100 }, 1000);
  return M.normDoc(d);
}

test("normAx keeps entrance animations, drops unknown ones", () => {
  assert.deepEqual(AX.normAx({ k: "shape", an: "rise" }, { t: "rect" }), { k: "shape", shp: "rect", an: "rise" });
  assert.equal(AX.normAx({ k: "shape", an: "spin" }, { t: "rect" }).an, undefined);
  // the typewriter needs text
  assert.equal(AX.normAx({ k: "shape", an: "type" }, { t: "rect" }).an, undefined);
  const txt = AX.normAx({ k: "text", tx: "Hi", an: "type" }, { t: "rect" });
  assert.equal(txt.an, "type");
});

test("page duration and transition live on the background only, defaults omitted", () => {
  const bg = AX.normAx({ k: "shape", bg: 1, dur: 8, ptr: "push", an: "fade" }, { t: "rect" });
  assert.equal(bg.dur, 8);
  assert.equal(bg.ptr, "push");
  assert.equal(bg.an, undefined);
  const def = AX.normAx({ k: "shape", bg: 1, dur: Anim.DUR_DEF, ptr: Anim.PTR_DEF }, { t: "rect" });
  assert.equal(def.dur, undefined);
  assert.equal(def.ptr, undefined);
  assert.equal(AX.normAx({ k: "shape", bg: 1, dur: 999 }, { t: "rect" }).dur, 60);
  assert.equal(AX.normAx({ k: "shape", bg: 1, ptr: "<script>" }, { t: "rect" }).ptr, undefined);
  // not on an element
  assert.equal(AX.normAx({ k: "shape", dur: 8, ptr: "zoom" }, { t: "rect" }).dur, undefined);
});

test("animation survives normalization and is idempotent", () => {
  const d = design();
  const it = d.items.find((x) => x.ax && x.ax.k === "text");
  it.ax.an = "type";
  const n1 = M.normDoc(JSON.parse(JSON.stringify(d)));
  const n2 = M.normDoc(JSON.parse(JSON.stringify(n1)));
  assert.equal(JSON.stringify(n1), JSON.stringify(n2));
  assert.equal(n1.items.find((x) => x.id === it.id).ax.an, "type");
});

test("schedule staggers entrances in layer order; stateAt ends at null", () => {
  const items = [
    { id: "a", z: 1, ax: { k: "shape", an: "fade" } },
    { id: "b", z: 2, ax: { k: "shape" } },
    { id: "c", z: 3, ax: { k: "shape", an: "pop" } }
  ];
  const sc = Anim.schedule(items);
  assert.equal(sc.b, undefined);
  assert.ok(sc.c > sc.a);
  assert.equal(Anim.stateAt(items[1], sc.b, 0, 500), null);
  const s0 = Anim.stateAt(items[0], sc.a, sc.a, 500);
  assert.equal(s0.a, 0);
  assert.equal(Anim.stateAt(items[0], sc.a, 100, 500), null);
  const rise = Anim.stateAt({ ax: { an: "rise" } }, 0, 0.1, 500);
  assert.ok(rise.dy > 0 && rise.a > 0 && rise.a < 1);
  const wipe = Anim.stateAt({ ax: { an: "wipe" } }, 0, 0.2, 500);
  assert.ok(wipe.clip > 0 && wipe.clip < 1);
  const type = Anim.stateAt({ ax: { an: "type", tx: "Καλημέρα" } }, 0, 0.2, 500);
  assert.ok(type.chars >= 0 && type.chars < 8);
  assert.ok(Anim.introLen(items) > sc.c);
});

test("timeline: page lengths, at least the intro, transitions after the first page", () => {
  const d = design();
  const pg1 = d.pages[0].id;
  AX.background(d, pg1).ax.dur = 3;
  const tl1 = Anim.timeline(d, M.pagesInOrder(d));
  assert.equal(tl1.total, 3);
  assert.equal(tl1.pages[0].tr, "none");
  // a second page with a push transition
  const p2 = M.normDoc(d);
  const id2 = M.newId("pg");
  p2.pages.push({ id: id2, m: 2000, pos: p2.pages[0].pos + 1024, ms: "" });
  AX.addBackground(p2, id2, "#000000", 2000);
  AX.background(p2, id2).ax.ptr = "push";
  const list = [p2.pages[0], p2.pages[1]];
  const tl = Anim.timeline(p2, list);
  assert.equal(tl.pages.length, 2);
  assert.equal(tl.pages[1].t0, 3);
  assert.equal(tl.pages[1].tr, "push");
  assert.equal(tl.total, 3 + Anim.DUR_DEF);
  const mid = Anim.at(tl, 3 + Anim.TRANS / 2);
  assert.equal(mid.i, 1);
  assert.equal(mid.prev, 0);
  assert.ok(mid.mix > 0 && mid.mix < 1);
  const done = Anim.at(tl, 3 + Anim.TRANS + 0.1);
  assert.equal(done.prev, -1);
  assert.equal(Anim.at(tl, 999).i, 1);
  // a long typewriter stretches its page past its duration
  const it = p2.items.find((x) => x.pg === pg1 && x.ax && x.ax.k === "text");
  it.ax.an = "type"; it.ax.tx = "x".repeat(200);
  assert.ok(Anim.timeline(p2, list).pages[0].dur > 3);
});

// ---------- GIF ----------
function decodeGif(u8) {
  let p = 0;
  const rd = () => u8[p++], rw = () => { const v = u8[p] | (u8[p + 1] << 8); p += 2; return v; };
  const sig = String.fromCharCode.apply(null, u8.slice(0, 6)); p = 6;
  assert.equal(sig, "GIF89a");
  const w = rw(), h = rw(), flags = rd(); rd(); rd();
  const pal = u8.slice(p, p + 3 * (1 << ((flags & 7) + 1))); p += pal.length;
  const frames = []; let delay = 0, loop = null;
  for (;;) {
    const b = rd();
    if (b === 0x3B) break;
    if (b === 0x21) {
      const label = rd();
      const blocks = [];
      for (let n = rd(); n; n = rd()) { blocks.push(u8.slice(p, p + n)); p += n; }
      if (label === 0xF9) delay = blocks[0][1] | (blocks[0][2] << 8);
      if (label === 0xFF) loop = blocks[1][1] | (blocks[1][2] << 8);
      continue;
    }
    assert.equal(b, 0x2C);
    rw(); rw(); const fw = rw(), fh = rw(); rd();
    const min = rd();
    const data = [];
    for (let n = rd(); n; n = rd()) { for (let i = 0; i < n; i++) data.push(u8[p + i]); p += n; }
    frames.push({ delay, idx: lzwDecode(data, min, fw * fh) });
  }
  return { w, h, pal, frames, loop };
}
function lzwDecode(data, min, count) {
  const CLEAR = 1 << min, EOI = CLEAR + 1;
  let size = min + 1, dict, next, prev = null, bit = 0;
  const out = [];
  const reset = () => { dict = []; for (let i = 0; i < CLEAR; i++) dict[i] = [i]; next = EOI + 1; size = min + 1; prev = null; };
  reset();
  for (;;) {
    let code = 0;
    for (let i = 0; i < size; i++, bit++) code |= ((data[bit >> 3] >> (bit & 7)) & 1) << i;
    if (code === CLEAR) { reset(); continue; }
    if (code === EOI) break;
    let entry;
    if (code < next && dict[code]) entry = dict[code];
    else if (code === next && prev) entry = prev.concat(prev[0]);
    else throw new Error("bad code " + code);
    out.push.apply(out, entry);
    if (prev && next < 4096) { dict[next++] = prev.concat(entry[0]); if (next === (1 << size) && size < 12) size++; }
    prev = entry;
  }
  assert.equal(out.length, count);
  return out;
}

test("gif: quantize maps black, white and pure colours to exact palette entries", () => {
  const px = new Uint8Array([0, 0, 0, 255, 255, 255, 255, 255, 255, 0, 0, 255, 0, 0, 0, 0]);
  const idx = Gif.quantize(px, 4, 1);
  const P = Gif.PALETTE;
  const rgb = (i) => [P[i * 3], P[i * 3 + 1], P[i * 3 + 2]];
  assert.deepEqual(rgb(idx[0]), [0, 0, 0]);
  assert.deepEqual(rgb(idx[1]), [255, 255, 255]);
  assert.deepEqual(rgb(idx[2]), [255, 0, 0]);
  assert.deepEqual(rgb(idx[3]), [255, 255, 255]);     // transparent → over white
});

test("gif: frames round-trip through LZW, including dictionary resets", () => {
  const w = 97, h = 61;
  let seed = 7;
  const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) % 252;
  const noise = Uint8Array.from({ length: w * h }, rnd);
  const flat = new Uint8Array(w * h).fill(17);
  const stripes = Uint8Array.from({ length: w * h }, (_, i) => (i % 13) * 9);
  const gif = Gif.encode({ w, h, loop: 0, frames: [
    { idx: noise, delay: 10 }, { idx: flat, delay: 10 }, { idx: flat, delay: 10 }, { idx: stripes, delay: 25 }
  ] });
  const g = decodeGif(gif);
  assert.equal(g.w, w); assert.equal(g.h, h); assert.equal(g.loop, 0);
  assert.equal(g.frames.length, 3);                    // the two flat frames merged
  assert.deepEqual(g.frames.map((f) => f.delay), [10, 20, 25]);
  assert.deepEqual(g.frames[0].idx, Array.from(noise));
  assert.deepEqual(g.frames[1].idx, Array.from(flat));
  assert.deepEqual(g.frames[2].idx, Array.from(stripes));
});
