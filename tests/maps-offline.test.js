// Offline map packs (maps/offline-core.js, maps wave 51): PMTiles v3
// tile ids, header and directories (with leaves and run lengths),
// planning a pack from a bounding box, download chunks, the pack
// index file, vector tile decoding and the offline search.
// The archives are written by tests/maps-offline-fixture.js; its
// output was checked once against the reference pmtiles 3.2.1 reader.
// Run: node --test tests/

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const zlib = require("zlib");
const fs = require("fs");
const path = require("path");
const OC = require(path.join(__dirname, "..", "maps", "offline-core.js"));
const FX = require(path.join(__dirname, "maps-offline-fixture.js"));
const root = path.join(__dirname, "..");
const read = f => fs.readFileSync(path.join(root, f), "utf8");

const BBOX = [23.72, 37.966, 23.735, 37.976];

function io(buf, log) {
  return {
    readDir: async (o, l) => { if (log) log.push([o, l]); return new Uint8Array(zlib.gunzipSync(buf.subarray(o, o + l))); }
  };
}
function open(buf) {
  const h = OC.parseHeader(new Uint8Array(buf.subarray(0, 16384)));
  const rootDir = OC.parseDir(new Uint8Array(zlib.gunzipSync(buf.subarray(h.rootOff, h.rootOff + h.rootLen))));
  return { h, rootDir };
}

test("tile ids follow the PMTiles Hilbert order", () => {
  assert.equal(OC.tileId(0, 0, 0), 0);
  assert.deepEqual([OC.tileId(1, 0, 0), OC.tileId(1, 0, 1), OC.tileId(1, 1, 1), OC.tileId(1, 1, 0)], [1, 2, 3, 4]);
  // values from the reference implementation (pmtiles 3.2.1 zxyToTileId)
  assert.equal(OC.tileId(12, 3423, 1763), 19078479);
  assert.equal(OC.tileId(15, 18527, 12666), 1259766120);
  assert.equal(OC.tileId(26, 2 ** 26 - 1, 2 ** 26 - 1), 4503599627370495);
  for (let i = 0; i < 2000; i++) {
    const z = i % 16, n = 2 ** z, x = (i * 7919) % n, y = (i * 104729) % n;
    assert.deepEqual(OC.tileXY(OC.tileId(z, x, y)), [z, x, y]);
    assert.equal(OC.zoomOf(OC.tileId(z, x, y)), z);
  }
  assert.throws(() => OC.tileId(2, 4, 0));
});

test("boxes, tile ranges and counts", () => {
  assert.equal(OC.normBbox([1, 2, 1, 3]), null);
  assert.equal(OC.normBbox([1, 2, 3]), null);
  assert.equal(OC.normBbox(["x", 0, 1, 1]), null);
  assert.deepEqual(OC.normBbox([-200, -89, 200, 89]).map(v => +v.toFixed(3)), [-180, -85.051, 180, 85.051]);
  const r = OC.tileRange(BBOX, 14);
  assert.ok(r.x1 >= r.x0 && r.y1 >= r.y0);
  // Athens at z14 is around x 9271, y 6322
  assert.ok(Math.abs(r.x0 - 9271) <= 2 && Math.abs(r.y0 - 6322) <= 2);
  const ids = OC.tileIds(BBOX, 14);
  assert.equal(ids.length, OC.countTiles(BBOX, 14));
  for (let i = 1; i < ids.length; i++) assert.ok(ids[i] > ids[i - 1]);
  // a whole country at z15 is too many tiles for one pack
  assert.equal(OC.tileIds([19, 34, 29, 42], 15), null);
  assert.ok(OC.countTiles([19, 34, 29, 42], 15) > OC.MAX_TILES);
  // Mercator round trip
  const y = OC.latToY(37.97, 10), x = OC.lonToX(23.72, 10);
  assert.ok(Math.abs(OC.yToLat(y, 10) - 37.97) < 1e-9 && Math.abs(OC.xToLon(x, 10) - 23.72) < 1e-9);
  assert.ok(OC.bboxIntersects([0, 0, 2, 2], [1, 1, 3, 3]));
  assert.ok(!OC.bboxIntersects([0, 0, 1, 1], [2, 2, 3, 3]));
});

test("header: fields, and sources that can't be used", () => {
  const buf = FX.athensFixture(14);
  const { h } = open(buf);
  assert.equal(h.version, 3);
  assert.equal(h.tileType, 1);
  assert.equal(h.tileComp, 2);
  assert.equal(h.maxZoom, 14);
  assert.equal(OC.headerProblem(h), "");
  assert.equal(OC.headerProblem(Object.assign({}, h, { tileType: 2 })), "type");     // PNG raster
  assert.equal(OC.headerProblem(Object.assign({}, h, { tileComp: 3 })), "comp");     // brotli
  assert.throws(() => OC.parseHeader(new Uint8Array(10)));
  const bad = Buffer.from(buf.subarray(0, 127)); bad[0] = 0x58;
  assert.throws(() => OC.parseHeader(new Uint8Array(bad)), /magic/);
  const v2 = Buffer.from(buf.subarray(0, 127)); v2[7] = 2;
  assert.throws(() => OC.parseHeader(new Uint8Array(v2)), /version/);
  assert.ok(Math.abs(h.bounds[0] - BBOX[0]) < 1e-6);
});

test("directories: varints, run lengths and a truncated directory", () => {
  const entries = [
    { tileId: 0, offset: 0, length: 10, runLength: 1 },
    { tileId: 5, offset: 10, length: 20, runLength: 3 },
    { tileId: 300, offset: 1000, length: 7, runLength: 1 }
  ];
  const dir = OC.parseDir(new Uint8Array(FX.serDir(entries)));
  assert.equal(dir.n, 3);
  assert.deepEqual(Array.from(dir.offs), [0, 10, 1000]);
  assert.equal(OC.findEntry(dir, 6), 1);
  assert.equal(OC.findEntry(dir, 7), 1);
  assert.equal(OC.findEntry(dir, 8), -1);         // after the run
  assert.equal(OC.findEntry(dir, 3), -1);
  assert.equal(OC.findEntry(dir, 300), 2);
  assert.throws(() => OC.parseDir(new Uint8Array(FX.serDir(entries).subarray(0, 5))));
  assert.equal(OC.readVarint({ buf: new Uint8Array([0xff, 0xff, 0xff, 0xff, 0x1f]), pos: 0 }), 2 ** 33 - 1);
});

for (const leafSize of [0, 4]) {
  test("planning a pack resolves every tile of the box" + (leafSize ? " through leaf directories" : ""), async () => {
    const buf = FX.athensFixture(14, { leafSize });
    const { h, rootDir } = open(buf);
    const ids = OC.tileIds(BBOX, 14);
    const log = [];
    const res = await OC.resolve(h, rootDir, ids, io(buf, log));
    assert.equal(res.ids.length, ids.length);
    if (leafSize) assert.ok(log.length >= 1); else assert.equal(log.length, 0);
    // every resolved tile is a gzip stream that decodes to our layers
    for (let i = 0; i < res.ids.length; i++) {
      const t = zlib.gunzipSync(buf.subarray(res.offs[i], res.offs[i] + res.lens[i]));
      const L = OC.decodeMvt(new Uint8Array(t));
      assert.ok(L.earth && L.roads, "tile " + res.ids[i]);
    }
    // tiles the archive doesn't have are left out, not invented
    const far = Float64Array.from([OC.tileId(14, 0, 0)]);
    assert.equal((await OC.resolve(h, rootDir, far, io(buf))).ids.length, 0);
  });
}

test("sizes per detail level, chunks and the pack file", async () => {
  const buf = FX.athensFixture(14);
  const { h, rootDir } = open(buf);
  // the box plus the three equal sea tiles at z3 (one blob, a run)
  const seaBox = [-180, 60, 180, 85];
  const ids = Float64Array.from(Array.from(OC.tileIds(BBOX, 14)).concat([OC.tileId(3, 0, 0), OC.tileId(3, 1, 0), OC.tileId(3, 2, 0)]).sort((a, b) => a - b));
  const res = await OC.resolve(h, rootDir, ids, io(buf));
  assert.equal(res.ids.length, ids.length);
  const sz = OC.sizesByZoom(res, 14);
  assert.equal(sz.bytes.length, 15);
  for (let z = 1; z <= 14; z++) assert.ok(sz.bytes[z] >= sz.bytes[z - 1] && sz.tiles[z] >= sz.tiles[z - 1]);
  // the three sea tiles (and any repeated tile) count once
  const seen = new Set(); let bytes3 = 0;
  res.ids.forEach((id, i) => { if (OC.zoomOf(id) <= 3 && !seen.has(res.offs[i])) { seen.add(res.offs[i]); bytes3 += res.lens[i]; } });
  assert.equal(sz.bytes[3], bytes3);
  const sea = [0, 1, 2].map(x => res.offs[res.ids.indexOf(OC.tileId(3, x, 0))]);
  assert.ok(sea[0] === sea[1] && sea[1] === sea[2]);
  assert.ok(seaBox);

  const p12 = OC.makePack(res, 12);
  assert.ok(p12.ids.every(id => OC.zoomOf(id) <= 12));
  const p = OC.makePack(res, 14, 0, 300);          // no gaps, tiny chunks: many requests
  assert.equal(p.ids.length, res.ids.length);
  assert.ok(p.cs.length > 1);
  for (let k = 0; k < p.cs.length; k++) assert.ok(p.cl[k] <= 300 || res.lens.includes(p.cl[k]), "a chunk over the limit holds one tile");
  // every tile is inside its chunk and its bytes are the archive's
  for (let i = 0; i < p.ids.length; i++) {
    const k = res.ids.indexOf(p.ids[i]);
    assert.equal(p.cs[p.tc[i]] + p.to[i], res.offs[k]);
    assert.equal(p.tl[i], res.lens[k]);
  }
  const big = OC.makePack(res, 14);                // the default merges neighbours into one request
  assert.equal(big.cs.length, 1);
  assert.equal(big.bytes, big.cl[0]);
  // binary round trip + lookup
  for (const pk of [p, big, OC.makePack(res, 0)]) {
    const back = OC.binToPack(OC.packToBin(pk));
    assert.deepEqual(Array.from(back.ids), Array.from(pk.ids));
    assert.deepEqual(Array.from(back.tc), Array.from(pk.tc));
    assert.deepEqual(Array.from(back.cl), Array.from(pk.cl));
    assert.equal(back.bytes, pk.bytes);
    assert.equal(back.maxz, pk.maxz);
    for (let i = 0; i < pk.ids.length; i++) assert.equal(OC.lookup(back, pk.ids[i]), i);
    assert.equal(OC.lookup(back, 123456789), -1);
  }
  // a damaged file is refused
  const bin = OC.packToBin(p);
  assert.throws(() => OC.binToPack(bin.slice(0, bin.byteLength - 8)));
  const bad = OC.packToBin(p); new Uint32Array(bad, 32 + p.ids.length * 8, 1)[0] = 99999;
  assert.throws(() => OC.binToPack(bad));
});

test("vector tile decoding: layers, values, lines, polygons with holes, points", () => {
  const t = FX.encodeTile({
    roads: [{ type: 2, props: { kind: "minor_road", name: "Οδός", lanes: 2, oneway: true, w: 1.5 }, geom: [[0, 0, 10, 10, 20, 0], [100, 100, 110, 100]] }],
    landuse: [{ type: 3, props: { kind: "park" }, geom: [[0, 0, 100, 0, 100, 100, 0, 100, 0, 0], [20, 20, 20, 80, 80, 80, 80, 20, 20, 20]] }],
    pois: [{ type: 1, props: { name: "A" }, geom: [[5, 6], [7, 8]] }]
  });
  const L = OC.decodeMvt(new Uint8Array(t));
  const r = L.roads.features[0];
  assert.equal(L.roads.extent, 4096);
  assert.equal(r.type, 2);
  assert.deepEqual(r.props, { kind: "minor_road", name: "Οδός", lanes: 2, oneway: true, w: 1.5 });
  assert.deepEqual(r.geom, [[0, 0, 10, 10, 20, 0], [100, 100, 110, 100]]);
  assert.deepEqual(L.landuse.features[0].geom[1], [20, 20, 20, 80, 80, 80, 80, 20, 20, 20]);
  assert.deepEqual(L.pois.features[0].geom, [[5, 6], [7, 8]]);
  assert.equal(OC.kindOf({ "pmap:kind": "park" }), "park");     // Protomaps v3 names
  assert.equal(OC.kindOf({ kind: "park" }), "park");
  assert.throws(() => OC.decodeMvt(new Uint8Array(t.subarray(0, t.length - 3))));
  assert.deepEqual(OC.decodeMvt(new Uint8Array(0)), {});
});

test("offline search: index from tiles, merge, accents, ranking", () => {
  const buf = FX.athensFixture(14);
  const { h } = open(buf);
  const ids = OC.tileIds(BBOX, 14);
  const all = [];
  return OC.resolve(h, open(buf).rootDir, ids, io(buf)).then(res => {
    res.ids.forEach((id, i) => {
      const [z, x, y] = OC.tileXY(id);
      if (z !== 14) return;
      const L = OC.decodeMvt(new Uint8Array(zlib.gunzipSync(buf.subarray(res.offs[i], res.offs[i] + res.lens[i]))));
      OC.indexTile(L, z, x, y).forEach(e => all.push(e));
    });
    const idx = OC.buildIndex(all);
    assert.ok(idx.length <= all.length);
    // a street cut by tile edges is one entry
    assert.equal(OC.buildIndex([["Α", "", "roads:street", 37.97, 23.72], ["Α", "", "roads:street", 37.971, 23.721], ["Α", "", "roads:street", 38.5, 23.72]]).length, 2);
    const names = idx.map(e => e[0]);
    assert.ok(names.includes("Καφέ Δοκιμή"));
    assert.ok(names.includes("Κυδαθηναίων 12"), "an address from the building's tags");
    const cafe = idx.find(e => e[0] === "Καφέ Δοκιμή");
    assert.equal(cafe[2], "pois:cafe");
    assert.ok(cafe[3] > 37.9 && cafe[3] < 38.0 && cafe[4] > 23.7 && cafe[4] < 23.75);
    // no accents, capitals or final sigma needed; English names too
    assert.equal(OC.search(idx, "καφε δοκ", [37.97, 23.72])[0][0], "Καφέ Δοκιμή");
    assert.equal(OC.search(idx, "TEST CAFE", null)[0][0], "Καφέ Δοκιμή");
    assert.equal(OC.search(idx, "amalias", null)[0][0], "Λεωφόρος Αμαλίας");
    assert.equal(OC.search(idx, "λεωφορος αμαλιας")[0][2], "roads:street");
    assert.equal(OC.search(idx, "πλακα")[0][2], "places:neighbourhood");
    // Greek names found with Latin letters, and the other way round
    assert.equal(OC.search(idx, "kydathinaion 12")[0][0], "Κυδαθηναίων 12");
    assert.equal(OC.search(idx, "kydathinaion 12")[0][2], "buildings:address");
    assert.equal(OC.search(idx, "plaka")[0][0], "Πλάκα");
    assert.equal(OC.search([["Monastiraki Square", "", "places:locality", 1, 1]], "μοναστηρ")[0][0], "Monastiraki Square");
    assert.equal(OC.latin(OC.fold("Ψυρρή Θησείο")), "psyrri thiseio");
    assert.deepEqual(OC.search(idx, "zzzz"), []);
    assert.deepEqual(OC.search(idx, "κ"), []);           // one letter: nothing
    // starts-with beats contains
    const idx2 = [["Ανω Πλάκα", "", "places:neighbourhood", 1, 1], ["Πλάκα", "", "pois:cafe", 1, 1]];
    assert.equal(OC.search(idx2, "πλακ")[0][0], "Πλάκα");
    // nearer first when equal
    const idx3 = [["Φούρνος", "", "pois:bakery", 40, 23], ["Φούρνος", "", "pois:bakery", 37.97, 23.72]];
    assert.equal(OC.search(idx3, "φουρνος", [37.97, 23.72])[0][3], 37.97);
    // normIndex keeps only well-formed rows
    assert.equal(OC.normIndex([["a", "", "k", 1, 2], ["", "", "", 1, 2], ["b", 1, 2, 999, 0], "x", null]).length, 1);
    assert.deepEqual(OC.normIndex("nope"), []);
  });
});

test("meta records, builds list, sizes, addresses", () => {
  assert.equal(OC.normMeta(null), null);
  assert.equal(OC.normMeta({ id: "../x", bbox: BBOX }), null);
  assert.equal(OC.normMeta({ id: "pabcde", bbox: [1, 1, 1, 1] }), null);
  const m = OC.normMeta({ id: "pabcde", bbox: BBOX, name: "  Αθήνα  ", maxz: 99, state: "weird", src: "javascript:alert(1)", tc: 2 });
  assert.equal(m.name, "Αθήνα");
  assert.equal(m.maxz, OC.MAX_ZOOM);
  assert.equal(m.state, "dl");
  assert.equal(m.src, "");
  assert.equal(OC.normMeta({ id: "pabcde", bbox: BBOX, state: "ready", src: "https://build.protomaps.com/20261010.pmtiles" }).state, "ready");
  assert.equal(OC.latestBuild([{ key: "20261001.pmtiles" }, { key: "20261012.pmtiles" }, { key: "x.pmtiles" }, "20261005.pmtiles"]), "20261012");
  assert.equal(OC.latestBuild({}), "");
  assert.equal(OC.fmtBytes(0), "0 B");
  assert.equal(OC.fmtBytes(1500000), "1.5 MB");
  assert.equal(OC.fmtBytes(1500000, "el"), "1,5 MB");
  assert.equal(OC.fmtBytes(250e6), "250 MB");
  assert.equal(OC.fmtBytes(2.5e9), "2.5 GB");
  assert.ok(OC.okUrl("https://example.org/a.pmtiles"));
  assert.ok(!OC.okUrl("file:///etc/passwd"));
  assert.ok(!OC.okUrl("nope"));
});

test("wiring: scripts load in order, host hooks, help and Bible", () => {
  const html = read("maps/index.html");
  const core = html.indexOf("offline-core.js"), ui = html.indexOf("offline.js?");
  assert.ok(core > 0 && ui > core && html.indexOf("maps.js?") < ui);
  const js = read("maps/maps.js");
  assert.ok(/offlineSearch/.test(js), "maps.js asks the offline packs when it can't reach Photon");
  const off = read("maps/offline.js");
  assert.ok(!/innerHTML\s*=\s*[^"';]*\b(name|meta|label)\b/.test(off), "pack names never go through innerHTML");
  assert.ok(/build\.protomaps\.com/.test(off) && !/tile\.openstreetmap\.org/.test(off));
  for (const f of ["maps/help.en.txt", "maps/help.el.txt"]) assert.ok(/Protomaps/.test(read(f)), f);
  assert.ok(/MAPS OFFLINE PACKS|offline-core\.js/.test(read("OROS_BIBLE.md")));
  assert.ok(/maps-packs/.test(read("shell.js")), "the factory reset removes the packs");
});
