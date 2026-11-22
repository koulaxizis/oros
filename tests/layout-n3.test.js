// Layout N3 (LY-N3): swatch libraries (.ase read and write, Lab,
// ready-made libraries, merging without doubles), the asset library's
// checks, the Story Editor's overset mark (L.placed), strings in
// EN/EL/DE and the wiring.
// Run: node --test tests/layout-n3.test.js
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const SW = require(path.join(ROOT, "layout/swatchlib.js"));
const LIB = require(path.join(ROOT, "layout/library.js"));
const M = require(path.join(ROOT, "designkit/model.js"));
const T = require(path.join(ROOT, "designkit/text.js"));
const R = require(path.join(ROOT, "designkit/render.js"));
const read = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");

T.allKeys().forEach((k) => {
  const b = fs.readFileSync(path.join(ROOT, "vendor/noto", T.fontFile(k)));
  T.register(k, b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
});

// a hand-made .ase: one group, a Lab, a Gray and a spot CMYK colour
function block(type, body) {
  const b = Buffer.alloc(6 + body.length);
  b.writeUInt16BE(type, 0); b.writeUInt32BE(body.length, 2); body.copy(b, 6);
  return b;
}
function name(s) {
  const b = Buffer.alloc(2 + (s.length + 1) * 2);
  b.writeUInt16BE(s.length + 1, 0);
  for (let i = 0; i < s.length; i++) b.writeUInt16BE(s.charCodeAt(i), 2 + i * 2);
  return b;
}
function colour(n, model, vals, ctype) {
  const v = Buffer.alloc(vals.length * 4 + 2);
  vals.forEach((x, i) => v.writeFloatBE(x, i * 4));
  v.writeUInt16BE(ctype, vals.length * 4);
  return block(1, Buffer.concat([name(n), Buffer.from(model, "ascii"), v]));
}
function ase(blocks) {
  const h = Buffer.alloc(12);
  h.write("ASEF", 0, "ascii"); h.writeUInt16BE(1, 4); h.writeUInt32BE(blocks.length, 8);
  return new Uint8Array(Buffer.concat([h].concat(blocks)));
}

test("swatches: .ase written and read back the same", () => {
  const list = [
    { name: "Θάλασσα", mode: "cmyk", v: [90, 40, 0, 0] },
    { name: "Red", mode: "rgb", v: [200, 16, 46] },
    { name: "Pantone-ish", mode: "cmyk", v: [0, 80, 100, 0], spot: 1 }
  ];
  const r = SW.parseASE(SW.writeASE(list));
  assert.equal(r.error, undefined);
  assert.deepEqual(r.swatches.map((s) => [s.name, s.mode, s.v, s.spot]), list.map((s) => [s.name, s.mode, s.v, s.spot ? 1 : 0]));
});

test("swatches: groups, Lab, Gray, spot, and broken files", () => {
  const f = ase([
    block(0xC001, name("Brand")),
    colour("Lab white", "LAB ", [1, 0, 0], 2),
    colour("", "Gray", [0.25], 2),
    colour("Spot", "CMYK", [0, 1, 1, 0], 1),
    block(0xC002, Buffer.alloc(0)),
    colour("Odd", "XYZ ", [1, 1, 1], 2)
  ]);
  const r = SW.parseASE(f);
  assert.deepEqual(r.groups, ["Brand"]);
  assert.equal(r.skipped, 1, "an unknown model is skipped");
  assert.deepEqual(r.swatches[0].v, [255, 255, 255], "Lab 100/0/0 is white");
  assert.equal(r.swatches[0].group, "Brand");
  assert.deepEqual(r.swatches[1], { mode: "cmyk", v: [0, 0, 0, 75], name: "0/0/0/75", spot: 0, group: "Brand" }, "grey as K, named by its value");
  assert.equal(r.swatches[2].spot, 1);
  const lab = SW.labToRgb(53.24, 80.09, 67.2);
  assert.ok(lab[0] > 230 && lab[1] < 40 && lab[2] < 40, "Lab red is red: " + lab);
  assert.equal(SW.parseASE(new Uint8Array(4)).error, "short");
  assert.equal(SW.parseASE(new Uint8Array(20)).error, "notAse");
  assert.equal(SW.parseASE(f.slice(0, 30)).error, "broken");
});

test("swatches: ready-made libraries and merging without doubles", () => {
  assert.ok(SW.LIBS.length >= 5);
  SW.LIBS.forEach((l) => {
    l.sw.forEach((s) => assert.ok(M.normSwatch({ id: "sw-x", name: s.name, mode: s.mode, v: s.v }), s.name));
  });
  let n = 0;
  const id = () => "sw-n" + (++n);
  const have = [{ id: "sw-a", name: "Cyan", mode: "cmyk", v: [100, 0, 0, 0] }, { id: "sw-b", name: "Red", mode: "rgb", v: [255, 0, 0] }];
  const out = SW.merge(have, SW.LIBS[0].sw, id);
  assert.ok(!out.some((s) => s.name === "Cyan"), "the same colour is not added twice");
  assert.equal(out.filter((s) => /^Red/.test(s.name))[0].name, "Red (2)", "a name in use with another value");
  assert.equal(out.length, SW.LIBS[0].sw.length - 1);
  const spot = SW.merge([], [{ name: "S", mode: "cmyk", v: [0, 1, 2, 3], spot: 1 }], id);
  assert.deepEqual(spot[0].ext, { spot: 1 });
  assert.ok(M.normSwatch(spot[0]).ext.spot, "spot survives the model check");
});

test("library: entries checked, kept within caps, only the colours and styles used", () => {
  const clip = {
    items: [{ id: "it-1", t: "rect", fill: "sw-red", x: 0, y: 0, w: 10, h: 10 }, { id: "it-2", t: "text", story: "st-1", x: 0, y: 0, w: 10, h: 10 }],
    stories: [{ id: "st-1", paras: [{ ps: "ps-h", runs: [{ t: "Hi", cs: "cs-b" }] }] }],
    swatches: [{ id: "sw-red" }, { id: "sw-blue" }, { id: "sw-ink" }],
    pstyles: [{ id: "ps-h", col: "sw-ink" }, { id: "ps-x" }], cstyles: [{ id: "cs-b" }, { id: "cs-y" }]
  };
  const e = LIB.fromClip(clip, "Opener\u0007", "data:image/png;base64,AAAA", 5);
  assert.match(e.id, /^lib-[a-z0-9]+$/);
  assert.equal(e.name, "Opener");
  assert.deepEqual(e.clip.swatches.map((x) => x.id), ["sw-red", "sw-ink"], "the style's colour comes too");
  assert.deepEqual(e.clip.pstyles.map((x) => x.id), ["ps-h"]);
  assert.deepEqual(e.clip.cstyles.map((x) => x.id), ["cs-b"]);
  const c = LIB.toClip(e);
  assert.equal(c.from, "lib", "styles are added when placed");
  c.items[0].x = 99;
  assert.equal(e.clip.items[0].x, 0, "placing does not change the entry");
  assert.equal(LIB.norm({ id: "x", clip: clip }), null, "bad id");
  assert.equal(LIB.norm({ id: "lib-a", clip: { items: [] } }), null, "nothing in it");
  assert.equal(LIB.norm({ id: "lib-a", thumb: "javascript:1", clip: clip }).thumb, "", "only image data as a picture");
  const big = { id: "lib-big", m: 1, clip: { items: [{ t: "rect", nm: "x".repeat(500000) }] } };
  assert.equal(LIB.norm(big), null, "one entry has a size cap");
  const many = [];
  for (let i = 0; i < 260; i++) many.push({ id: "lib-" + i, m: i, clip: clip });
  const kept = LIB.normLib(many.concat([{ id: "lib-5", m: 999, clip: clip }]));
  assert.equal(kept.length, LIB.MAX);
  assert.equal(kept[0].id, "lib-5", "newest first, no doubles");
  assert.equal(kept.filter((x) => x.id === "lib-5").length, 1);
});

test("Story Editor: the layout says how many paragraphs fit (overset mark)", () => {
  const d = M.newDoc({ name: "N3", w: 300, h: 300, pages: 1, facing: 0 }, 1000);
  const pg = M.pagesInOrder(d);
  d.stories.push({ id: "st-a", m: 1000, paras: [1, 2, 3, 4, 5, 6].map((i) => ({ ps: "ps-body", runs: [{ t: "Παράγραφος " + i + " ".repeat(1) + "λόγια ".repeat(30) }] })) });
  d.items.push({ id: "it-a", m: 1000, t: "text", pg: pg[0].id, x: 20, y: 20, w: 120, h: 90, story: "st-a", seq: 1, z: 1 });
  const L = R.computeLayout(M.normDoc(d));
  assert.ok(L.overset["st-a"]);
  assert.ok(L.placed["st-a"] >= 0 && L.placed["st-a"] < 6, "placed " + L.placed["st-a"]);
});

test("N3: strings in EN/EL/DE, wiring, help", () => {
  const LYJS = read("layout/layout.js"), at = LYJS.indexOf('"home.new": "Νέο έγγραφο"');
  const de = read("i18n/de/layout.js");
  const keys = SW.LIBS.map((l) => "swl.lib." + l.id).concat(["story.names", "story.smaller", "story.bigger", "more.lib", "lib.title", "lib.add", "lib.place", "lib.hint", "lib.imported", "swl.libs", "swl.import", "swl.export", "swl.added", "swl.bad", "swl.hint"]);
  keys.forEach((k) => {
    assert.ok(LYJS.slice(0, at).includes('"' + k + '": '), "EN " + k);
    assert.ok(LYJS.slice(at).includes('"' + k + '": '), "EL " + k);
    assert.ok(de.includes('"' + k + '": '), "DE " + k);
  });
  const html = read("layout/index.html"), sw = read("sw.js");
  ["swatchlib.js", "library.js"].forEach((f) => {
    assert.match(html, new RegExp('src="' + f.replace(".", "\\.") + '\\?v='), f);
    assert.ok(sw.includes('"layout/' + f + '"'), "sw " + f);
  });
  assert.ok(html.indexOf("swatchlib.js") < html.indexOf("panels.js"));
  assert.ok(html.indexOf("library.js") > html.indexOf("editor.js"));
  assert.match(read("layout/help.en.txt"), /## Story Editor, library and swatch libraries/);
  assert.match(read("layout/help.el.txt"), /## Επεξεργαστής κειμένου, βιβλιοθήκη και βιβλιοθήκες χρωμάτων/);
  assert.match(read("i18n/de/help/layout.txt"), /## Textmodus, Bibliothek und Farbfeldbibliotheken/);
  // pictures are only named in the library, never stored (R30)
  assert.doesNotMatch(read("layout/library.js"), /assets?\.blob|toDataURL\("image\/jpeg/);
});
