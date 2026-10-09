// Pure logic of Pixel Avatar: the face generator (deterministic per
// seed, symmetric, valid colours, the same person in every size),
// palettes, canonical face records, export sizes and the Museum
// merge (sync slice "pixel").
// Run: node --test tests/
//
// The app is a browser IIFE with no exports, so the constants and
// sections 2–6 are cut out of the source and evaluated on their own.

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const src = fs.readFileSync(path.join(__dirname, "..", "pixel/pixel.js"), "utf8");
function block(from, to) {
  const i = src.indexOf(from), j = src.indexOf(to, i);
  if (i < 0 || j < 0) throw new Error("missing block " + from);
  return src.slice(i, j);
}
const P = new Function("crypto",
  block("  var STORAGE_KEY", "  // ---------- 1.") +
  block("  function cmpStr(", "  // BOOT MARKER") +
  block("  // ---------- 2. Random", "  // ---------- 7. Storage") +
  "\nreturn { SIZES, NCOL, MAX_SEED, MAX_NAME, PAL_IDS, PALETTES, OROS_FALLBACK, hash32, randomSeed," +
  " toHex, darken, faceColors, faceParts, genFace, normFace, faceGrid, sameFace, faceSvg, exportPx," +
  " normItem, mergePixel, newId, shelf };")(require("crypto").webcrypto);

const SEEDS = ["chris", "Χρήστος", "a", "orOS", "pixel-42", "🙂", "zzzzzzzz", "The quick brown fox"];
for (let i = 0; i < 200; i++) SEEDS.push("s" + i);
const HEX = /^#[0-9a-f]{6}$/;
const face = (s, n, extra) => Object.assign({ s, n, p: "classic", b: 0, px: "" }, extra || {});
const item = (id, m, extra) => Object.assign({ id, m, name: id, f: face("seed-" + id, 12) }, extra || {});
const empty = () => ({ ver: 1, items: [], tombs: {} });

test("generator: same seed, same face; different seeds vary", () => {
  P.SIZES.forEach((n) => {
    const seen = new Set();
    SEEDS.forEach((s) => {
      const g = P.genFace(s, n);
      assert.equal(g, P.genFace(s, n), s);
      seen.add(g);
    });
    // 8×8 has little room, so shapes repeat more (colours still differ)
    assert.ok(seen.size > SEEDS.length * (n === 8 ? 0.6 : 0.8), n + ": only " + seen.size + " distinct faces");
  });
});

test("generator: right length, digits 0–7, mirrored left to right", () => {
  P.SIZES.forEach((n) => SEEDS.forEach((s) => {
    const g = P.genFace(s, n);
    assert.equal(g.length, n * n);
    assert.match(g, /^[0-7]+$/);
    for (let y = 0; y < n; y++) {
      const row = g.slice(y * n, y * n + n);
      assert.equal(row, row.split("").reverse().join(""), s + " " + n + " row " + y);
    }
  }));
});

test("generator: a face has skin, eyes and clothes in every size", () => {
  P.SIZES.forEach((n) => SEEDS.forEach((s) => {
    const g = P.genFace(s, n);
    ["1", "6"].forEach((c) => assert.ok(g.includes(c), s + " " + n + " lacks " + c));
    // the eyes may hide behind shades, never both gone
    assert.ok(g.includes("4") || P.faceParts(s).glasses === 2, s + " " + n + " has no eyes");
    assert.ok(g.includes("5"), s + " " + n + " has no mouth");
  }));
});

test("generator: the parts come from the seed only, the same person in every size", () => {
  SEEDS.forEach((s) => {
    const a = P.faceParts(s);
    assert.deepEqual(P.faceParts(s), a);
    // hair colour present in all sizes whenever the face has hair
    if (a.hair !== 3 && !a.hat) P.SIZES.forEach((n) => assert.ok(P.genFace(s, n).includes("3"), s + " " + n));
    // a hat or a crown shows in every size
    if (a.hat || a.glasses || a.phones) P.SIZES.forEach((n) => assert.ok(P.genFace(s, n).includes("7"), s + " " + n));
  });
  // every part value shows up across the seed set
  const all = SEEDS.map(P.faceParts);
  [["head", 3], ["hair", 6], ["eyes", 3], ["mouth", 4], ["hat", 4], ["glasses", 3]].forEach(([k, n]) => {
    const vals = new Set(all.map((p) => p[k]));
    assert.equal(vals.size, n, k + ": " + [...vals]);
  });
});

test("palettes: 8 palettes, 8 hex colours per face, same seed same colours", () => {
  assert.equal(P.PAL_IDS.length, 8);
  P.PAL_IDS.forEach((id) => SEEDS.slice(0, 30).forEach((s) => {
    const c = P.faceColors(s, id, null);
    assert.equal(c.length, P.NCOL);
    c.forEach((x) => assert.match(x, HEX, id + " " + s));
    assert.deepEqual(P.faceColors(s, id, null), c);
    assert.equal(c[2], P.darken(c[1], 0.18));
  }));
  assert.deepEqual(P.faceColors("x", "nope", null), P.faceColors("x", "classic", null));
});

test("palettes: orOS follows the skin, falls back when a value is missing", () => {
  const skin = { "--panel-bg": "rgb(1, 2, 3)", "--accent": "#abc", "--text": "#102030" };
  const c = P.faceColors("chris", "oros", (k) => skin[k] || "");
  c.forEach((x) => assert.match(x, HEX));
  const fb = P.faceColors("chris", "oros", () => "");
  fb.forEach((x) => assert.match(x, HEX));
  const usedSkin = c.some((x) => ["#010203", "#aabbcc", "#102030"].includes(x));
  assert.ok(usedSkin, "the orOS palette should use the skin's colours");
  assert.equal(P.toHex("#ABC"), "#aabbcc");
  assert.equal(P.toHex("rgba(255, 0, 300, 0.5)"), "#ff00ff");
  assert.equal(P.toHex("var(--x)"), null);
  assert.equal(P.darken("#ffffff", 0.5), "#808080");
});

test("faces: normFace is canonical and rejects junk", () => {
  const g = P.genFace("chris", 12);
  assert.deepEqual(P.normFace(face("chris", 12, { px: g })), face("chris", 12));       // unedited → ""
  const painted = "7" + g.slice(1);
  assert.equal(P.normFace(face("chris", 12, { px: painted })).px, painted);
  assert.equal(P.faceGrid(P.normFace(face("chris", 12, { px: painted }))), painted);
  assert.equal(P.normFace(face("chris", 12, { px: "8" + g.slice(1) })).px, "");          // bad digit
  assert.equal(P.normFace(face("chris", 12, { px: g.slice(1) })).px, "");                // bad length
  assert.equal(P.normFace(face("  a   b ", 8)).s, "a b");
  assert.equal(P.normFace(face("x".repeat(99), 8)).s.length, P.MAX_SEED);
  assert.equal(P.normFace(face("x", 8, { p: "rainbow" })).p, "classic");
  assert.equal(P.normFace(face("x", 8, { b: "1" })).b, 0);
  [null, 5, "x", {}, face("", 8), face("   ", 8), face("x", 10), face("x", "12")].forEach((j) =>
    assert.equal(P.normFace(j), null, JSON.stringify(j)));
});

test("faces: hand edits, then back to the seed", () => {
  const f = P.normFace(face("chris", 8));
  const g = P.faceGrid(f);
  const edited = P.normFace(Object.assign({}, f, { px: g.slice(0, 9) + (g[9] === "7" ? "6" : "7") + g.slice(10) }));
  assert.notEqual(edited.px, "");
  assert.ok(!P.sameFace(edited, f));
  const back = P.normFace(Object.assign({}, edited, { px: "" }));
  assert.ok(P.sameFace(back, f));
});

test("svg: crisp, clear background left out, one rect per run", () => {
  const f = P.normFace(face("chris", 16));
  const cols = P.faceColors(f.s, f.p, null);
  const svg = P.faceSvg(f, 512, cols, true);
  assert.match(svg, /^<svg xmlns="http:\/\/www.w3.org\/2000\/svg" width="512" height="512" viewBox="0 0 16 16" shape-rendering="crispEdges">/);
  const clear = P.faceSvg(Object.assign({}, f, { b: 1 }), 72, cols, false);
  assert.match(clear, /aria-hidden="true"/);
  assert.ok(!clear.includes('fill="' + cols[0] + '"') || cols.indexOf(cols[0], 1) > 0);
  // rect widths add up to the whole grid for a colour background
  let sum = 0;
  svg.replace(/width="(\d+)" height="1"/g, (m, w) => { sum += +w; return m; });
  assert.equal(sum, 256);
});

test("export: a whole number of screen pixels per face pixel", () => {
  assert.equal(P.exportPx(8, 256), 256);
  assert.equal(P.exportPx(12, 256), 252);
  assert.equal(P.exportPx(12, 512), 516);
  assert.equal(P.exportPx(16, 1024), 1024);
  assert.equal(P.exportPx(12, 1), 12);
  P.SIZES.forEach((n) => [256, 512, 1024].forEach((t) => assert.equal(P.exportPx(n, t) % n, 0)));
});

test("merge: commutative, associative, idempotent", () => {
  const A = { items: [item("aaaaaa", 5), item("bbbbbb", 9)], tombs: { cccccc: 3 } };
  const B = { items: [item("aaaaaa", 7, { name: "new" }), item("cccccc", 2)], tombs: {} };
  const C = { items: [item("dddddd", 1)], tombs: { bbbbbb: 9 } };
  const ab = P.mergePixel(A, B);
  assert.deepEqual(ab, P.mergePixel(B, A));
  assert.deepEqual(P.mergePixel(ab, C), P.mergePixel(A, P.mergePixel(B, C)));
  assert.deepEqual(P.mergePixel(ab, ab), ab);
  assert.equal(ab.items.find((x) => x.id === "aaaaaa").name, "new");
  assert.ok(!ab.items.some((x) => x.id === "cccccc"), "tomb 3 beats m 2");
  assert.ok(!P.mergePixel(ab, C).items.some((x) => x.id === "bbbbbb"), "delete wins ties");
  // equal m: the larger canonical JSON wins on both sides
  const x = item("eeeeee", 4, { name: "x" }), y = item("eeeeee", 4, { name: "y" });
  assert.deepEqual(P.mergePixel({ items: [x] }, { items: [y] }), P.mergePixel({ items: [y] }, { items: [x] }));
});

test("merge: Undo after delete writes m past the tomb (R17)", () => {
  let d = P.mergePixel(empty(), { items: [item("aaaaaa", 10)], tombs: {} });
  d = P.mergePixel(d, { items: [], tombs: { aaaaaa: 20 } });
  assert.equal(d.items.length, 0);
  const other = d;                                      // another device still has the tomb
  d = P.mergePixel(d, { items: [item("aaaaaa", 21)], tombs: {} });
  assert.equal(d.items.length, 1);
  assert.equal(P.mergePixel(other, d).items.length, 1);
  assert.equal(P.mergePixel(other, d).tombs.aaaaaa, 20);
});

test("merge: junk in, clean data out", () => {
  const junk = {
    items: [null, 4, "x", { id: "UPPER1", m: 1, f: face("a", 8) }, { id: "short", m: 1, f: face("a", 8) },
      { id: "okokok", m: -1, f: face("a", 8) }, { id: "okokok", m: 1.5, f: face("a", 8) },
      { id: "okokok", m: 1, f: face("a", 9) }, { id: "goodid", m: 3, name: "  ", f: face("seedy", 8) },
      { id: "named1", m: 3, name: "n".repeat(99), f: face("q", 16, { p: "bad" }) }],
    tombs: { "BAD": 3, okokok: -1, fine00: "7", ttttttt: 5 }
  };
  const d = P.mergePixel(junk, "nope");
  assert.deepEqual(d.items.map((x) => x.id), ["goodid", "named1"]);
  assert.equal(d.items[0].name, "seedy");
  assert.equal(d.items[1].name.length, P.MAX_NAME);
  assert.equal(d.items[1].f.p, "classic");
  assert.deepEqual(d.tombs, { ttttttt: 5 });
  assert.deepEqual(P.mergePixel(null, undefined), empty());
});

test("museum: new ids are valid and unique, shelf is newest first", () => {
  const ids = new Set();
  for (let i = 0; i < 500; i++) {
    const id = P.newId();
    assert.ok(P.normItem(item(id, 1)), id);
    ids.add(id);
  }
  assert.equal(ids.size, 500);
  const d = P.mergePixel({ items: [item("aaaaaa", 1), item("bbbbbb", 3), item("cccccc", 2)] }, null);
  assert.deepEqual(P.shelf(d).map((x) => x.id), ["bbbbbb", "cccccc", "aaaaaa"]);
  assert.match(P.randomSeed(), /^[a-z2-9]{8}$/);
});
