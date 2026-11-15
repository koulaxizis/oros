// orOS: the font families for the Assistant and orOS Gate (FM-7).
// designkit/fonts.js 1.5.0 overview(): the disk's families (with the
// letters and licence of their regular file) and the families of the
// collections (Fontsource from the catalog), filtered by letters,
// kind, collection, source and name; the font of orOS. The tool
// list_fonts is the same on both sides (tests/gate-parity.test.js).
// Run: node --test tests/fonts-list.test.js
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const F = require(path.join(ROOT, "designkit/fonts.js"));
const C = require(path.join(ROOT, "assistant/core.js"));
const U1 = "uf_" + "a".repeat(16), U2 = "uf_" + "b".repeat(16), U3 = "uf_" + "c".repeat(16);
const cols = F.cols.normalize({
  cols: { cbook1: { name: "Βιβλία", m: 1 }, cposter: { name: "Posters", m: 1 } },
  mem: {
    "cbook1:fs_gfs_didot": { on: 1, name: "GFS Didot", fb: "serif", m: 2 },
    ["cbook1:" + U1]: { on: 1, name: "Mine Serif", fb: "serif", m: 2 },
    "cposter:fs_inter": { on: 1, name: "Inter", fb: "sans", m: 2 },
    "cposter:fs_old": { on: 0, name: "Old", fb: "sans", m: 2 },
    ["cposter:" + U3]: { on: 1, name: "Lost", fb: "sans", m: 2 }
  },
  notes: { fs_gfs_didot: { t: "for poems", m: 3 } }
});
const disk = [
  { id: U1, name: "Mine Serif", fb: "serif", r: "x", b: "y", cov: { greek: "full", poly: "most" }, lic: "ofl", embed: "installable" },
  { id: U2, name: "Code Mono", fb: "mono", r: "z", cov: { greek: "some", poly: "none" }, lic: "", embed: "print" }
];
const catalog = [
  { id: "fs_gfs_didot", family: "GFS Didot", cat: "serif", greek: true, poly: true, lic: "OFL-1.1", vars: ["r"] },
  { id: "fs_inter", family: "Inter", cat: "sans", greek: true, poly: false, lic: "OFL-1.1", vars: ["r", "b", "i", "bi"] }
];
const src = { disk, cols, catalog, ui: { id: U1, name: "Mine Serif" }, lang: "en" };

test("overview: the disk and the collections, by name, with letters, licence and collections", () => {
  const r = F.overview(src, {});
  assert.equal(r.ok, true);
  assert.deepEqual(r.families.map((x) => x.name), ["Code Mono", "GFS Didot", "Inter", "Lost", "Mine Serif"]);
  const by = {};
  r.families.forEach((x) => { by[x.name] = x; });
  assert.deepEqual(by["Mine Serif"], { name: "Mine Serif", source: "disk", kind: "serif", greek: "full", polytonic: "most", licence: "OFL",
                                      styles: ["regular", "bold"], collections: ["Βιβλία"], ui: true });
  assert.equal(by["Code Mono"].licence, "other (see Settings › Fonts)");
  assert.equal(by["Code Mono"].embedding, "print");
  assert.deepEqual([by["GFS Didot"].source, by["GFS Didot"].polytonic, by["GFS Didot"].licence, by["GFS Didot"].note], ["free", "full", "OFL", "for poems"]);
  assert.deepEqual(by.Inter.styles, ["regular", "bold", "italic", "bold italic"]);
  assert.deepEqual([by.Lost.source, by.Lost.greek, by.Lost.files], ["disk", "unknown", "not on the disk"]);
  assert.deepEqual(r.collections, ["Posters", "Βιβλία"]);
  assert.equal(r.ui, "Mine Serif");
  assert.equal(r.total, 5);
});

test("overview: filters", () => {
  const names = (f) => F.overview(src, f).families.map((x) => x.name);
  assert.deepEqual(names({ letters: "polytonic" }), ["GFS Didot", "Mine Serif"]);
  assert.deepEqual(names({ letters: "greek" }), ["GFS Didot", "Inter", "Mine Serif"]);
  assert.deepEqual(names({ kind: "serif", source: "free" }), ["GFS Didot"]);
  assert.deepEqual(names({ collection: "βιβλία" }), ["GFS Didot", "Mine Serif"]);
  assert.deepEqual(names({ query: "mine s" }), ["Mine Serif"]);
  const bad = F.overview(src, { collection: "Nope" });
  assert.equal(bad.ok, false);
  assert.match(bad.err, /Posters, Βιβλία/);
  assert.equal(F.overview(src, { letters: "cyrillic" }).ok, false);
  assert.equal(F.overview(src, { kind: "script" }).ok, false);
  assert.equal(F.overview(src, { source: "web" }).ok, false);
});

test("overview: nothing read, the catalog offline, many families", () => {
  assert.deepEqual(F.overview(null, {}), { ok: true, total: 0, families: [], collections: [], ui: "Nunito" });
  const off = F.overview({ cols, disk: [] }, {});
  const didot = off.families.find((x) => x.name === "GFS Didot");
  assert.deepEqual([didot.greek, didot.polytonic, didot.licence], ["unknown", "unknown", "open"]);
  const many = [];
  for (let i = 0; i < 130; i++) many.push({ id: "uf_" + i.toString(16).padStart(16, "0"), name: "F" + String(i).padStart(3, "0"), fb: "sans", r: "r", cov: null, lic: null });
  const r = F.overview({ disk: many }, {});
  assert.equal(r.families.length, 100);
  assert.equal(r.more, 30);
  assert.equal(r.total, 130);
  assert.equal(r.families[0].licence, "unknown");
});

test("list_fonts: read only, offered with fonts, wired in the Assistant", () => {
  assert.ok(!C.toolsFor({ data: 1 }).some((t) => t.name === "list_fonts"));
  const t = C.toolsFor({ fonts: 1 }).find((x) => x.name === "list_fonts");
  assert.ok(t);
  assert.equal(t.params.required, undefined, "no argument is needed");
  const src2 = fs.readFileSync(path.join(ROOT, "assistant/assistant.js"), "utf8");
  assert.match(src2, /kbCols: kbColsOn\(chgApps\),.*fonts: !data\.set\.chat \}\)/);
  assert.match(src2, /F\.overview\(\{ disk: got\[0\], cols: cols, catalog: got\[1\]/);
  assert.match(src2, /\["\.\.\/designkit\/text\.js", "\.\.\/designkit\/fonts\.js"\]/);
});
