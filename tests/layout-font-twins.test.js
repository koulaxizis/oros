// LY-PORT-F (2026-11-20): a font that is not free and not on the disk
// (Calibri, Cambria, Arial…) is matched to its free twin with the same
// letter widths, so a rebuilt or imported book breaks its lines where
// the original did. Fontsource twins count only with Greek.
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const ROOT = path.join(__dirname, "..");
const F = require(path.join(ROOT, "designkit/fonts.js"));

const H = (c) => c.repeat(64) + ".ttf";
const CAT = [
  { id: "carlito", family: "Carlito", category: "sans-serif", subsets: ["latin", "greek", "cyrillic"], type: "google" },
  { id: "caladea", family: "Caladea", category: "serif", subsets: ["latin", "latin-ext"], type: "google" },
  { id: "arimo", family: "Arimo", category: "sans-serif", subsets: ["latin", "greek"], type: "google" },
  { id: "gentium-book-plus", family: "Gentium Book Plus", category: "serif", subsets: ["latin", "greek"], type: "google" }
];
let fetched = 0;
global.fetch = async () => { fetched++; return { ok: true, status: 200, json: async () => CAT, clone() { return this; } }; };

test("twins(): the free fonts with the same widths", () => {
  assert.deepEqual(F.twins("Calibri"), ["Carlito"]);
  assert.deepEqual(F.twins("ABCDEF+Calibri-Bold"), ["Carlito"]);
  assert.deepEqual(F.twins("Cambria Italic"), ["Caladea"]);
  assert.deepEqual(F.twins("ArialMT"), ["Liberation Sans", "Arimo"]);
  assert.deepEqual(F.twins("Times New Roman"), ["Liberation Serif", "Tinos"]);
  assert.deepEqual(F.twins("Minion Pro"), []);
});

test("match(): a twin on the disk wins, offline too, and says what it stands for", async () => {
  const lib = [{ family: "Liberation Sans", fb: "sans", b: false, i: false, file: H("a") }];
  const e = await F.match("Arial-BoldMT", lib, { offline: true });
  assert.equal(e.name, "Liberation Sans");
  assert.equal(e.like, "Arial-BoldMT");
  assert.equal(await F.match("Calibri", [], { offline: true }), null);
});

test("match(): the font itself still comes first", async () => {
  const lib = [{ family: "Calibri", fb: "sans", b: false, i: false, file: H("b") }, { family: "Carlito", fb: "sans", b: false, i: false, file: H("c") }];
  const e = await F.match("Calibri", lib, {});
  assert.equal(e.name, "Calibri");
  assert.equal(e.like, undefined);
});

test("match(): a Fontsource twin only with Greek", async () => {
  const c = await F.match("ABCDEF+Calibri", [], {});
  assert.equal(c.id, "fs_carlito");
  assert.equal(c.like, "ABCDEF+Calibri");
  assert.equal(await F.match("Cambria", [], {}), null);          // Caladea has no Greek
  const a = await F.match("Helvetica", [], {});
  assert.equal(a.name, "Arimo");
  assert.equal((await F.match("Gentium Book Plus", [], {})).like, undefined);
  assert.equal(await F.match("Minion Pro", [], {}), null);
  assert.ok(fetched >= 1);
});

test("the stored entry drops like; the rebuild report names the twin", () => {
  const list = F.withEntry([], { id: "fs_carlito", name: "Carlito", fb: "sans", like: "Calibri" });
  assert.equal(list[0].like, undefined);
  const rb = fs.readFileSync(path.join(ROOT, "layout/rebuild.js"), "utf8");
  assert.match(rb, /if \(FONTS\[k\]\.like\) o\.like = FONTS\[k\]\.like;/);
  const io = fs.readFileSync(path.join(ROOT, "layout/io.js"), "utf8");
  assert.match(io, /p\(t\("rb\.fontsTwin", \{ f: Object\.keys\(twin\)\.join\(", "\) \}\), "hint"\)/);
  for (const f of ["layout/layout.js", "i18n/de/layout.js"]) {
    const s = fs.readFileSync(path.join(ROOT, f), "utf8");
    assert.ok((s.match(/"rb\.fontsTwin":/g) || []).length >= (f === "layout/layout.js" ? 2 : 1), f);
  }
});

test("rebuild: a twin is measured like an orOS stand-in (its justified lines need −18 too)", () => {
  const rb = fs.readFileSync(path.join(ROOT, "layout/rebuild.js"), "utf8");
  assert.match(rb, /out\[k\] = \/\^noto\/i\.test\(k\) \|\| \(fonts\[k\] && !fonts\[k\]\.like\) \? 0 : tr \+ TRACK_ADJ;/);
});
