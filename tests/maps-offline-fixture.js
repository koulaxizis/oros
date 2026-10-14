// Test helper (not a test file): writes small Mapbox Vector Tiles and
// PMTiles v3 archives in the Protomaps basemap layout, so the offline
// map packs (maps/offline-core.js, maps/offline.js) can be tested
// without the network. Used by tests/maps-offline.test.js and by the
// browser check of wave 51.
"use strict";

const zlib = require("zlib");
const OC = require("../maps/offline-core.js");

function varint(n, out) {
  while (n >= 128) { out.push((n % 128) | 128); n = Math.floor(n / 128); }
  out.push(n);
}
function zig(n) { return n < 0 ? -2 * n - 1 : 2 * n; }
function lenField(field, bytes, out) { varint(field * 8 + 2, out); varint(bytes.length, out); for (const b of bytes) out.push(b); }
function utf8(s) { return Array.from(Buffer.from(String(s), "utf8")); }

// features: [{ type: 1|2|3, props: {}, geom: [[x,y,x,y…], …] }]  (points: [[x,y]])
function encodeLayer(name, features, extent) {
  const keys = [], vals = [], kIdx = new Map(), vIdx = new Map();
  const feats = [];
  for (const f of features) {
    const tags = [];
    for (const k of Object.keys(f.props || {})) {
      const v = f.props[k];
      if (!kIdx.has(k)) { kIdx.set(k, keys.length); keys.push(k); }
      const vk = typeof v + ":" + v;
      if (!vIdx.has(vk)) { vIdx.set(vk, vals.length); vals.push(v); }
      tags.push(kIdx.get(k), vIdx.get(vk));
    }
    const cmds = [];
    let cx = 0, cy = 0;
    if (f.type === 1) {
      cmds.push((f.geom.length << 3) | 1);
      for (const p of f.geom) { cmds.push(zig(p[0] - cx), zig(p[1] - cy)); cx = p[0]; cy = p[1]; }
    } else {
      for (const part of f.geom) {
        const pts = part.slice();
        if (f.type === 3) pts.splice(-2, 2);   // the closing point is ClosePath
        cmds.push((1 << 3) | 1, zig(pts[0] - cx), zig(pts[1] - cy)); cx = pts[0]; cy = pts[1];
        const n = pts.length / 2 - 1;
        cmds.push((n << 3) | 2);
        for (let i = 2; i < pts.length; i += 2) { cmds.push(zig(pts[i] - cx), zig(pts[i + 1] - cy)); cx = pts[i]; cy = pts[i + 1]; }
        if (f.type === 3) cmds.push((1 << 3) | 7);
      }
    }
    const fb = [];
    const tb = []; tags.forEach(t => varint(t, tb)); lenField(2, tb, fb);
    varint(3 * 8, fb); varint(f.type, fb);
    const gb = []; cmds.forEach(c => varint(c, gb)); lenField(4, gb, fb);
    feats.push(fb);
  }
  const lb = [];
  varint(15 * 8, lb); varint(2, lb);
  lenField(1, utf8(name), lb);
  feats.forEach(fb => lenField(2, fb, lb));
  keys.forEach(k => lenField(3, utf8(k), lb));
  vals.forEach(v => {
    const vb = [];
    if (typeof v === "string") lenField(1, utf8(v), vb);
    else if (typeof v === "boolean") { varint(7 * 8, vb); varint(v ? 1 : 0, vb); }
    else if (Number.isInteger(v)) { varint(6 * 8, vb); varint(zig(v), vb); }
    else { varint(3 * 8 + 1, vb); const b = Buffer.alloc(8); b.writeDoubleLE(v); for (const x of b) vb.push(x); }
    lenField(4, vb, lb);
  });
  varint(5 * 8, lb); varint(extent || 4096, lb);
  return lb;
}
function encodeTile(layers) {
  const out = [];
  for (const name of Object.keys(layers)) lenField(3, encodeLayer(name, layers[name]), out);
  return Buffer.from(out);
}

function serDir(entries) {
  const out = [];
  varint(entries.length, out);
  let last = 0;
  for (const e of entries) { varint(e.tileId - last, out); last = e.tileId; }
  for (const e of entries) varint(e.runLength, out);
  for (const e of entries) varint(e.length, out);
  entries.forEach((e, i) => {
    if (i > 0 && e.offset === entries[i - 1].offset + entries[i - 1].length) varint(0, out);
    else varint(e.offset + 1, out);
  });
  return Buffer.from(out);
}

// tiles: Map(tileId → Buffer of the MVT). Tile data is gzipped (as in
// the Protomaps builds); identical tiles are stored once, and
// consecutive identical ones use a run length. leafSize > 0 puts every
// entry into leaf directories of that many entries.
function writePmtiles(tiles, opts) {
  opts = opts || {};
  const ids = Array.from(tiles.keys()).sort((a, b) => a - b);
  const data = [], byHash = new Map(), entries = [];
  let off = 0;
  for (const id of ids) {
    const raw = zlib.gzipSync(tiles.get(id));
    const h = raw.toString("base64");
    let o, len = raw.length;
    if (byHash.has(h)) o = byHash.get(h);
    else { o = off; byHash.set(h, o); data.push(raw); off += raw.length; }
    const prev = entries[entries.length - 1];
    if (prev && prev.offset === o && prev.tileId + prev.runLength === id) prev.runLength++;
    else entries.push({ tileId: id, offset: o, length: len, runLength: 1 });
  }
  let rootEntries = entries, leafBuf = Buffer.alloc(0);
  if (opts.leafSize) {
    rootEntries = []; const leaves = [];
    let loff = 0;
    for (let i = 0; i < entries.length; i += opts.leafSize) {
      const leaf = zlib.gzipSync(serDir(entries.slice(i, i + opts.leafSize)));
      rootEntries.push({ tileId: entries[i].tileId, offset: loff, length: leaf.length, runLength: 0 });
      leaves.push(leaf); loff += leaf.length;
    }
    leafBuf = Buffer.concat(leaves);
  }
  const root = zlib.gzipSync(serDir(rootEntries));
  const meta = zlib.gzipSync(Buffer.from(JSON.stringify({ name: "orOS test fixture", attribution: "© OpenStreetMap" })));
  const tileData = Buffer.concat(data);
  const h = Buffer.alloc(127);
  h.write("PMTiles", 0, "latin1"); h[7] = 3;
  let pos = 127;
  const put = (o, v) => { h.writeUInt32LE(v % 4294967296, o); h.writeUInt32LE(Math.floor(v / 4294967296), o + 4); };
  put(8, pos); put(16, root.length); pos += root.length;
  put(24, pos); put(32, meta.length); pos += meta.length;
  put(40, pos); put(48, leafBuf.length); pos += leafBuf.length;
  put(56, pos); put(64, tileData.length);
  put(72, ids.length); put(80, entries.length); put(88, byHash.size);
  h[96] = 1; h[97] = 2; h[98] = 2; h[99] = 1;
  const zs = ids.map(OC.zoomOf);
  h[100] = Math.min(...zs); h[101] = Math.max(...zs);
  const b = opts.bounds || [-180, -85, 180, 85];
  h.writeInt32LE(Math.round(b[0] * 1e7), 102); h.writeInt32LE(Math.round(b[1] * 1e7), 106);
  h.writeInt32LE(Math.round(b[2] * 1e7), 110); h.writeInt32LE(Math.round(b[3] * 1e7), 114);
  return Buffer.concat([h, root, meta, leafBuf, tileData]);
}

// A small Protomaps-like city around Plaka, Athens: every tile of the
// box from zoom 0 to maxz has land, a main road, a street and a path
// crossing it; the deeper tiles have a park, buildings, a café, a
// neighbourhood label and an address. Far tiles (open sea) are equal
// and share one blob.
function athensFixture(maxz, opts) {
  opts = opts || {};
  const bbox = opts.bbox || [23.72, 37.966, 23.735, 37.976];
  const tiles = new Map();
  const E = 4096;
  const sea = encodeTile({ water: [{ type: 3, props: { kind: "ocean" }, geom: [[0, 0, E, 0, E, E, 0, E, 0, 0]] }] });
  for (let z = 0; z <= maxz; z++) {
    const r = OC.tileRange(bbox, z);
    for (let x = r.x0; x <= r.x1; x++) for (let y = r.y0; y <= r.y1; y++) {
      const L = {
        earth: [{ type: 3, props: { kind: "earth" }, geom: [[0, 0, E, 0, E, E, 0, E, 0, 0]] }],
        roads: [
          { type: 2, props: { kind: "major_road", name: "Λεωφόρος Αμαλίας", "name:en": "Amalias Avenue" }, geom: [[0, 600, E, 900]] },
          { type: 2, props: { kind: "minor_road", name: "Αδριανού" }, geom: [[400, 0, 700, E]] },
          { type: 2, props: { kind: "path", name: "Μονοπάτι Φιλοπάππου" }, geom: [[0, 3000, E, 3200]] }
        ],
        water: [{ type: 3, props: { kind: "water", name: "Λιμνούλα" }, geom: [[3000, 3000, 3400, 3000, 3400, 3400, 3000, 3400, 3000, 3000]] }]
      };
      if (z >= 12) {
        L.landuse = [{ type: 3, props: { kind: "park", name: "Εθνικός Κήπος", "name:en": "National Garden" }, geom: [[2000, 1000, 3000, 1000, 3000, 2000, 2000, 2000, 2000, 1000]] }];
        L.buildings = [{ type: 3, props: { kind: "building", "addr:housenumber": "12", "addr:street": "Κυδαθηναίων" }, geom: [[1000, 1000, 1200, 1000, 1200, 1200, 1000, 1200, 1000, 1000]] }];
        L.pois = [{ type: 1, props: { kind: "cafe", name: "Καφέ Δοκιμή", "name:en": "Test Café", min_zoom: 14 }, geom: [[1500, 1500]] }];
        L.places = [{ type: 1, props: { kind: "neighbourhood", name: "Πλάκα", "name:en": "Plaka" }, geom: [[2500, 2500]] }];
      }
      // makes every tile's bytes different (no name: not searchable)
      L.pois = (L.pois || []).concat([{ type: 1, props: { kind: "bench", tile: z + "/" + x + "/" + y }, geom: [[(x * 37) % E, (y * 53) % E]] }]);
      if (z <= 4) L.places = [{ type: 1, props: { kind: "locality", kind_detail: "city", name: "Αθήνα", "name:en": "Athens", population_rank: 12 }, geom: [[2048, 2048]] }];
      tiles.set(OC.tileId(z, x, y), encodeTile(L));
    }
    if (z === 3 && opts.sea !== false) {
      // a few sea tiles next to the box: identical content (one blob, run length)
      for (let x = 0; x < 3; x++) tiles.set(OC.tileId(z, x, 0), sea);
    }
  }
  return writePmtiles(tiles, { leafSize: opts.leafSize || 0, bounds: bbox });
}

module.exports = { encodeTile, writePmtiles, athensFixture, serDir };
