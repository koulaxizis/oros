// Test helper (not a test file): vector tiles of a small made-up path
// network cut the way a tile builder cuts them (each tile holds its
// part of every way plus a buffer of 64 units around it, coordinates
// rounded to the 4096 grid), for the offline walking and cycling
// routes (maps/offroute-core.js, wave H8). Used by
// tests/maps-offroute.test.js and by the browser check of wave H8.
"use strict";

const OR = require("../maps/offroute-core.js");
const { encodeTile } = require("./maps-offline-fixture.js");

const E = 4096, B = 64;
// ways: [{ props, pts: [[lat, lon]…] }] → Map "z/x/y" → layers (decoded shape)
function cutTiles(ways, z, bbox) {
  const tiles = new Map();
  const x0 = Math.floor(OR.lonToX(bbox[0], z)), x1 = Math.floor(OR.lonToX(bbox[2], z));
  const y0 = Math.floor(OR.latToY(bbox[3], z)), y1 = Math.floor(OR.latToY(bbox[1], z));
  for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) {
    const feats = [];
    for (const w of ways) {
      const loc = w.pts.map(([lat, lon]) => [(OR.lonToX(lon, z) - x) * E, (OR.latToY(lat, z) - y) * E]);
      let cur = null;
      const parts = [];
      for (let i = 0; i + 1 < loc.length; i++) {
        const [px, py] = loc[i], [qx, qy] = loc[i + 1];
        const c = OR.clip(px + B, py + B, qx + B, qy + B, E + 2 * B);
        if (!c) { if (cur) { parts.push(cur); cur = null; } continue; }
        const a = [px + (qx - px) * c[0], py + (qy - py) * c[0]], b = [px + (qx - px) * c[1], py + (qy - py) * c[1]];
        if (!cur || c[0] > 0) { if (cur) parts.push(cur); cur = [Math.round(a[0]), Math.round(a[1])]; }
        cur.push(Math.round(b[0]), Math.round(b[1]));
        if (c[1] < 1) { parts.push(cur); cur = null; }
      }
      if (cur) parts.push(cur);
      parts.filter(p => p.length >= 4).forEach(p => feats.push({ type: 2, props: w.props, geom: [p] }));
    }
    tiles.set(z + "/" + x + "/" + y, { roads: { extent: E, features: feats } });
  }
  return tiles;
}
function encode(layers) { return encodeTile({ roads: layers.roads.features }); }

// A hill village: a main road along the valley, a residential street
// up to the square, a footpath from the square over the ridge, a track
// back down, steps as a short cut, a cycleway along the river, and a
// motorway nobody may walk on. Spans several z15 tiles.
function village() {
  const P = (props, pts) => ({ props, pts });
  return [
    P({ kind: "highway", kind_detail: "motorway", name: "Highway A1" }, [[39.5000, 21.7600], [39.5000, 21.8400]]),
    P({ kind: "major_road", kind_detail: "primary", name: "Valley Road" }, [[39.5040, 21.7700], [39.5050, 21.7900], [39.5055, 21.8000], [39.5060, 21.8100], [39.5070, 21.8300]]),
    P({ kind: "minor_road", kind_detail: "residential", name: "School Street" }, [[39.5050, 21.7900], [39.5100, 21.7920], [39.5150, 21.7950]]),
    P({ kind: "path", kind_detail: "path", name: "Ridge Path" }, [[39.5150, 21.7950], [39.5200, 21.8000], [39.5210, 21.8100], [39.5160, 21.8200]]),
    P({ kind: "path", kind_detail: "track", name: "" }, [[39.5160, 21.8200], [39.5110, 21.8250], [39.5070, 21.8300]]),
    P({ kind: "path", kind_detail: "steps", name: "" }, [[39.5150, 21.7950], [39.5130, 21.8050], [39.5110, 21.8150], [39.5110, 21.8250]]),
    P({ kind: "path", kind_detail: "cycleway", name: "River Cycleway" }, [[39.5030, 21.7700], [39.5035, 21.8000], [39.5045, 21.8300]]),
    P({ kind: "minor_road", kind_detail: "service", name: "" }, [[39.5035, 21.8000], [39.5055, 21.8000]]),
    P({ kind: "rail", kind_detail: "rail", name: "Railway" }, [[39.5080, 21.7700], [39.5080, 21.8400]])
  ];
}
module.exports = { cutTiles, encode, village, E, B };
