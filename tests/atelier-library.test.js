// Atelier offline library: the vendored icon set and the design sizes.
// Run: node --test tests/

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const I = require(path.join(__dirname, "..", "atelier/library/icons.js"));
const P = require(path.join(__dirname, "..", "atelier/presets.js"));
const M = require(path.join(__dirname, "..", "designkit/media.js"));

test("icons: unique ids, known categories, EN + EL keywords, path data only", () => {
  assert.equal(I.source.license, "MIT");
  const cats = new Set(I.cats.map((c) => c[0]));
  assert.equal(cats.size, I.cats.length);
  I.cats.forEach((c) => assert.ok(c[1] && c[2], c[0]));
  const ids = I.list.map((i) => i[0]);
  assert.equal(new Set(ids).size, ids.length);
  assert.ok(I.list.length >= 300);
  const used = new Set();
  I.list.forEach(([id, cs, en, el, paths]) => {
    assert.match(id, /^[a-z0-9]+(-[a-z0-9]+)*$/);
    assert.ok(cs.length >= 1 && cs.every((c) => cats.has(c)), id);
    cs.forEach((c) => used.add(c));
    assert.ok(en.length > 0 && /^[a-z0-9 .'&+-]+$/.test(en), id + " en: " + en);
    assert.ok(/[α-ωά-ώ]/.test(el), id + " needs Greek keywords");
    assert.ok(paths.length >= 1, id);
    paths.forEach((d) => assert.match(d, /^[MmLlHhVvCcSsQqTtAaZz0-9 .,-]+$/, id));
  });
  assert.equal(used.size, cats.size, "every category has icons");
});

test("icons: each one survives the SVG sanitizer unchanged", () => {
  I.list.forEach(([id, , , , paths]) => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#000" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
      paths.map((d) => '<path d="' + d + '"/>').join("") + "</svg>";
    const r = M.sanitizeSvg(svg);
    assert.ok(r, id);
    assert.equal(r.svg, svg, id);
    assert.equal(r.w, 24);
  });
});

test("presets: unique ids, known groups, sizes inside the custom limits", () => {
  const groups = new Set(P.groups.map((g) => g[0]));
  const ids = P.list.map((p) => p[0]);
  assert.equal(new Set(ids).size, ids.length);
  P.list.forEach(([id, g, en, el, w, h, unit]) => {
    assert.ok(groups.has(g), id);
    assert.ok(en && el, id);
    assert.ok(unit === "px" || unit === "mm", id);
    const [lo, hi] = P.custom[unit];
    assert.ok(Number.isInteger(w) && Number.isInteger(h) && w >= lo && w <= hi && h >= lo && h <= hi, id);
  });
  groups.forEach((g) => assert.ok(P.list.some((p) => p[1] === g), g));
  assert.ok(Math.abs(P.PX_PER_MM * 25.4 - 96) < 1e-9);
});
