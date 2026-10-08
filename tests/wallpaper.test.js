// Pure logic of Wallpaper Generator: the shared renderer (art.js:
// recipe normalize, determinism, palettes, cache key) and the
// favourites merge of the app.
// Run: node --test tests/
//
// art.js is evaluated as is in a fresh context (it attaches
// OrosWallArt to its global). The app is a browser IIFE with no
// exports, so its pure functions are cut out of the source by name
// (brace matching). A renamed function fails here loudly.

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ART_SRC = fs.readFileSync(path.join(__dirname, "..", "wallpaper", "art.js"), "utf8");
const APP_SRC = fs.readFileSync(path.join(__dirname, "..", "wallpaper", "wallpaper.js"), "utf8");

function loadArt() {
  const ctx = { setTimeout, Promise, Math, JSON, Date, Uint8Array, Uint32Array, Float32Array };
  vm.createContext(ctx);
  vm.runInContext(ART_SRC, ctx);
  return ctx.OrosWallArt;
}
const ART = loadArt();

function cutFunction(name) {
  const i = APP_SRC.indexOf("  function " + name + "(");
  if (i < 0) throw new Error("missing function " + name);
  let depth = 0, j = APP_SRC.indexOf("{", i);
  for (; j < APP_SRC.length; j++) {
    if (APP_SRC[j] === "{") depth++;
    else if (APP_SRC[j] === "}" && --depth === 0) break;
  }
  return APP_SRC.slice(i, j + 1);
}

const WP = new Function("ART",
  "var DATA_VER = 1; var ID_RE = /^[a-z0-9]{6,40}$/;\n" +
  ["cmpStr", "isInt", "normFav", "mergeWall"].map(cutFunction).join("\n") +
  "\nreturn { normFav, mergeWall };")(ART);

// A canvas stand-in that records every call and property write
// (numbers rounded), so a drawing can be compared as a hash.
function recorder() {
  const log = [];
  const fmt = (a) => a.map((x) => (typeof x === "number" ? x.toFixed(3) : typeof x === "object" ? "obj" : String(x))).join(",");
  const grad = (kind) => (...a) => {
    log.push(kind + "(" + fmt(a) + ")");
    return { addColorStop: (o, c) => log.push("stop(" + o + "," + c + ")") };
  };
  const target = {
    createLinearGradient: grad("lin"),
    createRadialGradient: grad("rad"),
    createPattern: () => { log.push("pattern"); return {}; }
  };
  const ctx = new Proxy(target, {
    get(t, k) {
      if (k in t) return t[k];
      return (...a) => log.push(String(k) + "(" + fmt(a) + ")");
    },
    set(t, k, v) { log.push(String(k) + "=" + (typeof v === "number" ? v.toFixed(3) : typeof v === "object" ? "obj" : v)); return true; }
  });
  return { ctx, log };
}
function draw(r, w, h, opts) {
  const rec = recorder();
  ART.renderSync(rec.ctx, w, h, r, opts || {});
  return rec.log.join("\n");
}
function fakeCanvas() {
  return {
    getContext: () => ({
      createImageData: (w, h) => ({ data: new Uint8ClampedArray(w * h * 4) }),
      putImageData: () => {}
    })
  };
}
const R = (over) => ART.normRecipe(Object.assign({ seed: "hello", style: "waves", pal: "ember", dens: 40, chaos: 30, grain: 0, light: 0 }, over));

test("normRecipe: canonical, clamped, idempotent", () => {
  assert.equal(ART.normRecipe(null), null);
  assert.equal(ART.normRecipe([]), null);
  assert.equal(ART.normRecipe({ seed: "   " }), null);
  const r = ART.normRecipe({ light: true, seed: "  a   b ", style: "nope", pal: "nope", dens: 140.6, chaos: -3, grain: "yes", extra: 1 });
  assert.deepEqual(Object.keys(r), ["seed", "style", "pal", "dens", "chaos", "grain", "light"]);
  assert.equal(r.seed, "a b");
  assert.equal(r.style, "waves");
  assert.equal(r.pal, "oros");
  assert.equal(r.dens, 100);
  assert.equal(r.chaos, 0);
  assert.equal(r.grain, 0);
  assert.equal(r.light, 1);
  assert.equal(ART.normRecipe({ seed: "x".repeat(99) }).seed.length, ART.SEED_LEN);
  assert.deepEqual(ART.normRecipe(r), r);
  assert.deepEqual(ART.normRecipe(ART.defaultRecipe()), ART.defaultRecipe());
});

test("randomSeed gives short, varied seeds", () => {
  const seen = new Set();
  for (let i = 0; i < 50; i++) {
    const s = ART.randomSeed();
    assert.match(s, /^[a-z]{6}-\d{3}$/);
    seen.add(s);
  }
  assert.ok(seen.size > 40);
});

test("every style is deterministic, and the seed matters", () => {
  for (const style of ART.STYLES) {
    for (const light of [0, 1]) {
      const a = draw(R({ style, light, dens: 10 }), 320, 200);
      const b = draw(R({ style, light, dens: 10 }), 320, 200);
      assert.ok(a.length > 100, style + " draws something");
      assert.equal(a, b, style + " same recipe, same drawing");
      assert.notEqual(a, draw(R({ style, light, dens: 10, seed: "other" }), 320, 200), style + " other seed");
    }
  }
});

test("density and chaos change the picture; grain adds one pattern pass", () => {
  for (const style of ART.STYLES) {
    const base = draw(R({ style, dens: 10 }), 300, 200);
    assert.notEqual(base, draw(R({ style, dens: 60 }), 300, 200), style + " density");
    assert.notEqual(base, draw(R({ style, dens: 10, chaos: 90 }), 300, 200), style + " chaos");
  }
  const g = draw(R({ grain: 1 }), 300, 200, { makeCanvas: fakeCanvas });
  assert.equal(g.split("pattern").length - 1, 1);
  assert.equal(draw(R({ grain: 0 }), 300, 200, { makeCanvas: fakeCanvas }).indexOf("pattern"), -1);
  // no canvas factory (old engine): grain is skipped, nothing throws
  assert.doesNotThrow(() => draw(R({ grain: 1 }), 300, 200, { makeCanvas: () => null }));
});

test("same shape, any size: the drawing scales", () => {
  // every coordinate doubles: compare after halving the numbers of the big one
  const small = draw(R({ style: "orbits" }), 400, 250);
  const big = draw(R({ style: "orbits" }), 800, 500);
  assert.equal(small.split("\n").length, big.split("\n").length);
  assert.equal(small.split("\n").filter((l) => l.startsWith("ellipse")).length,
               big.split("\n").filter((l) => l.startsWith("ellipse")).length);
});

test("palettes: orOS follows the accent, nebula is always dark, light uses the light ground", () => {
  const a = ART.colors(R({ pal: "oros" }), "#ff0000");
  const b = ART.colors(R({ pal: "oros" }), "#0000ff");
  assert.notDeepEqual(a.ink, b.ink);
  assert.equal(a.ink.length, 5);
  for (const c of a.ink.concat([a.bg])) assert.match(c, /^#[0-9a-f]{6}$/);
  assert.deepEqual(ART.colors(R({ pal: "ember" }), "#ff0000"), ART.colors(R({ pal: "ember" }), "#0000ff"));
  assert.equal(ART.colors(R({ light: 1 }), "#000").light, true);
  assert.equal(ART.colors(R({ light: 1, style: "nebula" }), "#000").light, false);
  assert.notEqual(ART.colors(R({ light: 1 })).bg, ART.colors(R({ light: 0 })).bg);
  // every palette id resolves; an unreadable accent falls back
  for (const pal of ART.PALETTES) assert.ok(ART.colors(R({ pal }), "rgb(10, 20, 30)").ink.length >= 4);
  assert.deepEqual(ART.colors(R({ pal: "oros" }), "nonsense"), ART.colors(R({ pal: "oros" }), "#d4af37"));
});

test("cache key changes exactly when the picture does", () => {
  assert.equal(ART.key(null, "#fff"), "");
  assert.equal(ART.key(R({ pal: "ember" }), "#ff0000"), ART.key(R({ pal: "ember" }), "#00ff00"));
  assert.notEqual(ART.key(R({ pal: "oros" }), "#ff0000"), ART.key(R({ pal: "oros" }), "#00ff00"));
  assert.equal(ART.key(R({ pal: "oros" }), "#FF0000"), ART.key(R({ pal: "oros" }), "rgb(255, 0, 0)"));
  assert.notEqual(ART.key(R({}), "#fff"), ART.key(R({ chaos: 31 }), "#fff"));
});

test("render runs in slices, reports progress and can be cancelled", async () => {
  const rec = recorder();
  const seen = [];
  const done = await ART.render(rec.ctx, 400, 300, R({ style: "flow", dens: 30 }), {
    slice: 0, onProgress: (f) => seen.push(f)
  });
  assert.equal(done, true);
  assert.ok(seen.length > 2);
  assert.equal(seen[seen.length - 1], 1);
  assert.equal(rec.log.join("\n"), draw(R({ style: "flow", dens: 30 }), 400, 300));
  let n = 0;
  const stopped = await ART.render(recorder().ctx, 400, 300, R({ style: "flow" }), {
    slice: 0, cancelled: () => ++n > 2
  });
  assert.equal(stopped, false);
});

// ---------- favourites merge ----------
const fav = (id, m, over) => ({ id, m, r: R(over) });
const J = (x) => JSON.stringify(x);

test("normFav drops bad favourites", () => {
  assert.equal(WP.normFav(null), null);
  assert.equal(WP.normFav({ id: "BAD!", m: 1, r: R({}) }), null);
  assert.equal(WP.normFav({ id: "abc123", m: -1, r: R({}) }), null);
  assert.equal(WP.normFav({ id: "abc123", m: 1, r: { seed: "" } }), null);
  assert.deepEqual(WP.normFav({ id: "abc123", m: 1, r: { seed: "x", dens: 500 }, junk: 1 }),
                   { id: "abc123", m: 1, r: ART.normRecipe({ seed: "x", dens: 100 }) });
});

test("merge is symmetric, associative, idempotent and leaves inputs alone", () => {
  const a = { favs: [fav("aaa111", 5), fav("bbb222", 9, { seed: "a" })], tombs: { ccc333: 4 } };
  const b = { favs: [fav("bbb222", 9, { seed: "b" }), fav("ccc333", 3)], tombs: {} };
  const c = { favs: [fav("ddd444", 1)], tombs: { aaa111: 2 } };
  const snapA = J(a);
  assert.equal(J(WP.mergeWall(a, b)), J(WP.mergeWall(b, a)));
  assert.equal(J(WP.mergeWall(WP.mergeWall(a, b), c)), J(WP.mergeWall(a, WP.mergeWall(b, c))));
  const m = WP.mergeWall(a, b);
  assert.equal(J(WP.mergeWall(m, m)), J(m));
  assert.equal(J(a), snapA);
  // equal mtime: the larger canonical JSON wins on both sides
  assert.equal(m.favs.find((f) => f.id === "bbb222").r.seed, "b");
  assert.deepEqual(m.favs.map((f) => f.id), ["aaa111", "bbb222"]);
});

test("tombstones: delete wins ties, a newer save resurrects", () => {
  const live = { favs: [fav("aaa111", 10)], tombs: {} };
  assert.equal(WP.mergeWall(live, { favs: [], tombs: { aaa111: 10 } }).favs.length, 0);
  assert.equal(WP.mergeWall(live, { favs: [], tombs: { aaa111: 9 } }).favs.length, 1);
  const back = WP.mergeWall({ favs: [fav("aaa111", 11)], tombs: {} }, { favs: [], tombs: { aaa111: 10 } });
  assert.equal(back.favs.length, 1);
  assert.deepEqual(back.tombs, { aaa111: 10 });
  assert.deepEqual(WP.mergeWall({ tombs: { "BAD!": 3, zzz999: -1, yyy888: 1.5 } }, null).tombs, {});
});
