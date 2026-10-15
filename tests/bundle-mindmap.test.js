// Mind Map as an orOS file (.orosmind): mm-core packBundle /
// unpackBundle through bundle.js write / read. One map = one bundle,
// pictures in media/, an outline .md + .opml in preview/; opening
// always makes a NEW map (fresh ids) through the JSON import's
// normalisers.
// Run: node --test tests/

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const M = require(path.join(__dirname, "..", "mindmap/mm-core.js"));
const B = require(path.join(__dirname, "..", "bundle.js"));

const MIME = "application/x-oros-mind";
// a 1×1 PNG
const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
const PIC = "data:image/png;base64," + PNG;

function sample() {
  const MAP = "mapA", R = M.rootId(MAP);
  return M.merge({
    maps: [{ id: MAP, m: 5, sides: "right" }, { id: "other", m: 5, sides: "both" }],
    nodes: [
      { id: R, m: 5, map: MAP, parent: "", ord: "", text: "Plan" },
      { id: "a1", m: 6, map: MAP, parent: R, ord: "V", text: "Alpha", note: "a note", url: "https://example.org/", emoji: "⭐", color: "red", done: true },
      { id: "a2", m: 7, map: MAP, parent: "a1", ord: "V", text: "Beta" },
      { id: "a3", m: 8, map: MAP, parent: R, ord: "W", text: "Gamma" },
      { id: M.rootId("other"), m: 5, map: "other", parent: "", ord: "", text: "Other map" }
    ],
    links: [{ id: "l1", m: 5, map: MAP, from: "a2", to: "a3", label: "then" }],
    pos: [{ id: "a3", m: 5, map: MAP, dx: 40, dy: -10 }],
    imgs: [{ id: "a1", m: 5, map: MAP, src: PIC, w: 1, h: 1 }],
    styles: [{ id: "a1", m: 5, map: MAP, shape: "pill", fill: "solid", border: "", size: "l", bold: true }],
    frames: [{ id: "f1", m: 5, map: MAP, nodes: ["a1", "a3"], kind: "brace", label: "both", color: "teal" }],
    layouts: [{ id: MAP, m: 5, map: MAP, kind: "org" }],
    tombs: { gone: 3 }
  }, {});
}
let seq = 0;
const newId = () => "z" + (++seq).toString(36).padStart(6, "0");

function pack(data, map) {
  return M.packBundle(data, map, B.sha256, "2026-10-15T00:00:00.000Z").then((p) =>
    B.write({ mime: MIME, app: "mindmap", schema: "mindmap/1", content: p.content, media: p.media,
      meta: { title: p.title, created: p.created, modified: p.modified, language: "en", generator: "orOS Mind Map" },
      preview: [{ name: "map.md", data: p.outline, type: "text/markdown" }, { name: "map.opml", data: p.opml, type: "text/x-opml" }],
      date: new Date(0) }).then((bytes) => ({ p, bytes })));
}

test("pack: one map, pictures leave content.json for media/<sha256>.png", async () => {
  const { p, bytes } = await pack(sample(), "mapA");
  assert.equal(p.content.kind, "oros-mindmap-package");
  assert.equal(p.content.ver, 1);
  assert.equal(p.title, "Plan");
  const keys = Object.keys(p.media);
  assert.equal(keys.length, 1);
  assert.match(keys[0], /^[0-9a-f]{64}\.png$/);
  const json = JSON.stringify(p.content);
  assert.ok(!/base64/.test(json), "no base64 in content.json");
  assert.equal(p.content.data.maps.length, 1, "only the one map");
  assert.ok(p.content.data.nodes.every((n) => n.map === "mapA"));
  assert.equal(p.content.data.imgs[0].media, keys[0]);
  assert.match(p.outline, /^# Plan\n- \[x\] Alpha\n  - Beta\n- Gamma\n$/);
  assert.match(p.opml, /<opml/);
  assert.equal(B.sniff(bytes.subarray(0, 128)), MIME);
  const r = await B.read(bytes, { mime: MIME });
  assert.equal(r.app, "mindmap");
  assert.equal(r.meta.title, "Plan");
  assert.deepEqual(r.changed, []);
  assert.equal(r.media[keys[0]].type, "image/png");
});

test("unpack: a new map with fresh ids, every detail kept", async () => {
  const { bytes } = await pack(sample(), "mapA");
  const r = await B.read(bytes, { mime: MIME });
  const u = M.unpackBundle(r.content, r.media, newId, 1000);
  assert.equal(u.ok, true);
  const d = u.data;
  assert.equal(d.maps.length, 1);
  assert.notEqual(u.map, "mapA");
  assert.equal(d.maps[0].id, u.map);
  assert.equal(d.maps[0].sides, "right");
  const ids = new Set(d.nodes.map((n) => n.id));
  ["mapA-r", "a1", "a2", "a3"].forEach((x) => assert.ok(!ids.has(x), "fresh id for " + x));
  assert.ok(d.nodes.every((n) => n.m === 1000 && n.map === u.map));
  const R = M.resolve(d, u.map);
  assert.equal(R.root.text, "Plan");
  assert.equal(M.toOutline(R), "# Plan\n- [x] Alpha\n  - Beta\n- Gamma\n");
  const alpha = d.nodes.find((n) => n.text === "Alpha"), beta = d.nodes.find((n) => n.text === "Beta"),
    gamma = d.nodes.find((n) => n.text === "Gamma");
  assert.deepEqual([alpha.note, alpha.url, alpha.emoji, alpha.color, alpha.done], ["a note", "https://example.org/", "⭐", "red", true]);
  assert.equal(beta.parent, alpha.id);
  assert.deepEqual(d.links.map((l) => [l.from, l.to, l.label]), [[beta.id, gamma.id, "then"]]);
  assert.notEqual(d.links[0].id, "l1");
  assert.deepEqual(d.pos.map((x) => [x.id, x.dx, x.dy]), [[gamma.id, 40, -10]]);
  assert.deepEqual(d.imgs.map((x) => [x.id, x.src, x.w, x.h]), [[alpha.id, PIC, 1, 1]]);
  assert.deepEqual(d.styles.map((x) => [x.id, x.shape, x.fill, x.size, x.bold]), [[alpha.id, "pill", "solid", "l", true]]);
  assert.equal(d.frames.length, 1);
  assert.deepEqual(d.frames[0].nodes, [alpha.id, gamma.id].sort());
  assert.deepEqual([d.frames[0].kind, d.frames[0].label, d.frames[0].color], ["brace", "both", "teal"]);
  assert.deepEqual(d.layouts, [{ id: u.map, m: 1000, map: u.map, kind: "org" }]);
  assert.deepEqual(d.tombs, {});
  // opening twice: two maps, no shared ids
  const u2 = M.unpackBundle((await B.read(bytes, { mime: MIME })).content, r.media, newId, 1000);
  assert.ok(u2.data.nodes.every((n) => !ids.has(n.id)));
});

test("unpack: from an unzipped folder, a swapped picture gets its new hash", async () => {
  const { bytes } = await pack(sample(), "mapA");
  const r0 = await B.read(bytes, { mime: MIME });
  const key = Object.keys(r0.media)[0];
  // rebuild the folder from the zip, with a different (valid) PNG
  const other = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
  const list = [
    { path: "mimetype", bytes: new TextEncoder().encode(MIME) },
    { path: "content.json", bytes: new TextEncoder().encode(JSON.stringify(r0.content)) },
    { path: "media/" + key, bytes: new Uint8Array(other) }
  ];
  const r = await B.readFolder(list, { mime: MIME });
  const nk = Object.keys(r.media)[0];
  assert.notEqual(nk, key);
  const u = M.unpackBundle(r.content, r.media, newId, 5);
  assert.equal(u.ok, true);
  assert.equal(u.data.imgs[0].src, "data:image/png;base64," + other.toString("base64"));
});

test("unpack: hostile or foreign content is refused or cleaned", () => {
  assert.equal(M.unpackBundle(null, {}, newId, 1).ok, false);
  assert.equal(M.unpackBundle({ kind: "oros-doc-package", data: {} }, {}, newId, 1).err, "format");
  assert.equal(M.unpackBundle({ kind: "oros-mindmap-package", data: { app: "x" } }, {}, newId, 1).err, "format");
  const u = M.unpackBundle({ kind: "oros-mindmap-package", ver: 1, data: {
    app: "mindmap", format: 1,
    maps: [{ id: "m1", m: 1 }],
    nodes: [{ id: "m1-r", m: 1, map: "m1", text: "<script>x</script>" },
      { id: "b", m: 1, map: "m1", parent: "m1-r", ord: "V", text: "ok", url: "javascript:alert(1)", color: "url(x)" },
      { id: "bad id!", m: 1, map: "m1", text: "dropped" }],
    imgs: [{ id: "b", m: 1, map: "m1", media: "../../etc/passwd", w: 1, h: 1 },
      { id: "m1-r", m: 1, map: "m1", src: "data:image/svg+xml;base64,PHN2Zy8+", w: 1, h: 1 }],
    __proto__: { polluted: true }
  } }, { "x.png": { bytes: new Uint8Array([1]), type: "application/octet-stream" } }, newId, 9);
  assert.equal(u.ok, true);
  assert.equal(u.data.nodes.length, 2);
  const b = u.data.nodes.find((n) => n.text === "ok");
  assert.equal(b.url, "");
  assert.equal(b.color, "");
  assert.deepEqual(u.data.imgs, [], "no picture without valid media bytes; svg refused");
  assert.equal(({}).polluted, undefined);
});

test("unpack: a map without its centre gets an empty one", () => {
  const u = M.unpackBundle({ kind: "oros-mindmap-package", ver: 1, data: {
    app: "mindmap", format: 1, maps: [{ id: "m1", m: 1 }],
    nodes: [{ id: "k", m: 1, map: "m1", parent: "m1-r", ord: "V", text: "child" }] } }, {}, newId, 2);
  assert.equal(u.ok, true);
  const R = M.resolve(u.data, u.map);
  assert.equal(R.root.id, M.rootId(u.map));
  assert.equal(M.toOutline(R), "# \n- child\n");
});
