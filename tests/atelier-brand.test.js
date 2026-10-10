// Atelier brand kit (wave 3B): the synced record in atelier/brandkit.js
// (merge, tombstones, canonical form, limits).
// Run: node --test tests/

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const BK = require(path.join(__dirname, "..", "atelier/brandkit.js"));
const ASSET = "a".repeat(64) + ".png";

test("brand: add, dedupe and canonical form", () => {
  let b = BK.empty();
  b = BK.addColor(b, "#FF0000", 1000);
  b = BK.addColor(b, "#ff0000", 1001);           // same colour: ignored
  b = BK.addColor(b, "not a colour", 1002);
  b = BK.addColor(b, "#00ff00", 1003);
  assert.deepEqual(b.colors.map((x) => x.c), ["#ff0000", "#00ff00"]);
  assert.deepEqual(BK.norm(JSON.parse(JSON.stringify(b))), b);
  assert.deepEqual(Object.keys(b), ["ver", "colors", "fonts", "logos", "dt"]);
  b = BK.addLogo(b, { id: ASSET, w: 300, h: 100, name: "logo.png" }, 1004);
  b = BK.addLogo(b, { id: ASSET, w: 300, h: 100, name: "again" }, 1005);
  assert.equal(b.logos.length, 1);
  assert.equal(BK.addLogo(b, { id: "../x.png", w: 1, h: 1 }, 1006).logos.length, 1);
});

test("brand: fonts per slot, newest wins", () => {
  let a = BK.setFont(BK.empty(), "h", "fs_roboto_slab", 1, 2000);
  let b = BK.setFont(BK.empty(), "h", "serif", 0, 3000);
  b = BK.setFont(b, "x", "serif", 0, 3000);       // unknown slot
  a = BK.setFont(a, "t", "javascript:alert(1)", 0, 2500);   // not a font id
  const m = BK.merge(a, b);
  assert.deepEqual(m.fonts, { h: { f: "serif", b: 0, m: 3000 } });
  assert.deepEqual(BK.merge(b, a), m);
});

test("brand: merge is commutative and idempotent, tombstones remove", () => {
  const base = BK.addColor(BK.empty(), "#111111", 100);
  const id = base.colors[0].id;
  const a = BK.remove(base, id, 200);              // removed on one device
  const b = BK.addColor(base, "#222222", 150);     // added on another
  const ab = BK.merge(a, b), ba = BK.merge(b, a);
  assert.deepEqual(ab, ba);
  assert.deepEqual(BK.merge(ab, ab), ab);
  assert.deepEqual(ab.colors.map((x) => x.c), ["#222222"]);
  assert.equal(ab.dt[id], 200);
  // an edit newer than the tombstone brings it back
  const newer = JSON.parse(JSON.stringify(base));
  newer.colors[0].m = 300;
  assert.deepEqual(BK.merge(ab, newer).colors.map((x) => x.c).sort(), ["#111111", "#222222"]);
});

test("brand: limits and junk", () => {
  let b = BK.empty();
  for (let i = 0; i < 50; i++) b = BK.addColor(b, "#" + (i + 0x100000).toString(16), 10 + i);
  assert.equal(b.colors.length, BK.MAX_COLORS);
  const junk = BK.norm({ colors: [{ id: "bc-abcdef", m: 1, c: "red" }, null, 5], fonts: { h: { f: "sans", m: -1 } },
    logos: [{ id: "bl-abcdef", m: 1, a: ASSET, w: 1e9, h: -4, nm: "a\u0000b" }], dt: { "zz-abcdef": 5, "bc-qqqqqq": 9 } });
  assert.deepEqual(junk.colors, []);
  assert.deepEqual(junk.fonts, {});
  assert.deepEqual(junk.logos, [{ id: "bl-abcdef", m: 1, a: ASSET, w: 20000, h: 1, nm: "ab", pos: 0 }]);
  assert.deepEqual(junk.dt, { "bc-qqqqqq": 9 });
});
