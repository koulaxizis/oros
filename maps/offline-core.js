// ============================================================
// orOS Maps — offline-core.js (offline map packs, maps wave 51,
// v1.0.0). Pure functions, no DOM, no network of its own: Node-tested
// in tests/maps-offline.test.js.
//
//   - PMTiles v3 (https://github.com/protomaps/PMTiles, spec v3):
//     header, directories (varints, run lengths, leaves), Hilbert
//     tile ids. Written from the spec; no library.
//   - Planning a pack: the tiles of a bounding box from zoom 0 up to
//     a detail level, resolved through the archive's directories
//     (fetching only the directories it needs, through a function the
//     caller passes), then grouped into download chunks (byte ranges
//     of the source file). Size per detail level before anything big
//     is downloaded.
//   - The pack index (tile id → chunk, offset, length) as one binary
//     blob for OPFS, and its lookup.
//   - Mapbox Vector Tile 2.1 decoding (protobuf, geometry commands).
//   - Offline search: names (places, points of interest, streets,
//     water, parks, house numbers when the data has them) taken from
//     the pack's tiles, kept as a small index, matched without
//     accents (Greek tonos, final sigma) and ranked.
//
// API: window.OrosMapsOffline (module.exports in Node).
// ============================================================
(function (root) {
  "use strict";

  var VER = "1.0.0";
  var MAX_TILES = 600000;          // tiles per pack (all zooms)
  var MAX_ZOOM = 15;               // Protomaps builds stop at 15
  var CHUNK_GAP = 32768;           // bytes of gap two tiles may have and share a request
  var CHUNK_MAX = 4 * 1048576;     // bytes per download request
  var MAX_INDEX = 250000;          // search entries per pack
  var LAT_MAX = 85.0511287798;

  // tz[z] = number of tiles in all zoom levels below z = (4^z − 1) / 3
  var TZ = [];
  (function () { var a = 0, n = 1; for (var z = 0; z <= 27; z++) { TZ.push(a); a += n; n *= 4; } })();

  // ---------- varints / bytes ----------
  function readVarint(p) {
    var val = 0, mul = 1, b;
    do {
      if (p.pos >= p.buf.length) throw new Error("varint");
      b = p.buf[p.pos++];
      val += (b & 0x7f) * mul;
      mul *= 128;
      if (mul > 18446744073709552000) throw new Error("varint");
    } while (b & 0x80);
    return val;
  }
  function u64(dv, o) { return dv.getUint32(o, true) + dv.getUint32(o + 4, true) * 4294967296; }

  // ---------- Hilbert tile ids ----------
  function rotate(n, xy, rx, ry) {
    if (ry === 0) {
      if (rx === 1) { xy[0] = n - 1 - xy[0]; xy[1] = n - 1 - xy[1]; }
      var t = xy[0]; xy[0] = xy[1]; xy[1] = t;
    }
  }
  function tileId(z, x, y) {
    var n = Math.pow(2, z);
    if (z < 0 || z > 26 || x < 0 || y < 0 || x >= n || y >= n) throw new Error("tile");
    var d = 0, xy = [x, y], s = n / 2, rx, ry;
    while (s >= 1) {
      rx = (xy[0] & s) > 0 ? 1 : 0;
      ry = (xy[1] & s) > 0 ? 1 : 0;
      d += s * s * ((3 * rx) ^ ry);
      rotate(s, xy, rx, ry);
      s = s / 2;
    }
    return TZ[z] + d;
  }
  function zoomOf(id) {
    for (var z = 0; z < 27; z++) if (id < TZ[z + 1]) return z;
    return -1;
  }
  function tileXY(id) {
    var z = zoomOf(id), pos = id - TZ[z], n = Math.pow(2, z), xy = [0, 0], s = 1, t = pos, rx, ry;
    while (s < n) {
      rx = 1 & Math.floor(t / 2);
      ry = 1 & (Math.floor(t) ^ rx);
      rotate(s, xy, rx, ry);
      xy[0] += s * rx;
      xy[1] += s * ry;
      t = Math.floor(t / 4);
      s *= 2;
    }
    return [z, xy[0], xy[1]];
  }

  // ---------- Web Mercator ----------
  function lonToX(lon, z) { return (lon + 180) / 360 * Math.pow(2, z); }
  function latToY(lat, z) {
    lat = Math.max(-LAT_MAX, Math.min(LAT_MAX, lat));
    var r = lat * Math.PI / 180;
    return (1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * Math.pow(2, z);
  }
  function xToLon(x, z) { return x / Math.pow(2, z) * 360 - 180; }
  function yToLat(y, z) {
    var n = Math.PI - 2 * Math.PI * y / Math.pow(2, z);
    return 180 / Math.PI * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
  }

  // bbox = [west, south, east, north] in degrees. Returns null if bad.
  function normBbox(b) {
    if (!b || b.length !== 4) return null;
    var w = +b[0], s = +b[1], e = +b[2], n = +b[3];
    if (![w, s, e, n].every(isFinite)) return null;
    w = Math.max(-180, Math.min(180, w)); e = Math.max(-180, Math.min(180, e));
    s = Math.max(-LAT_MAX, Math.min(LAT_MAX, s)); n = Math.max(-LAT_MAX, Math.min(LAT_MAX, n));
    if (e <= w || n <= s) return null;
    return [w, s, e, n];
  }
  function tileRange(bbox, z) {
    var max = Math.pow(2, z) - 1;
    function c(v) { return Math.max(0, Math.min(max, Math.floor(v))); }
    return { x0: c(lonToX(bbox[0], z)), x1: c(lonToX(bbox[2], z) - 1e-9),
             y0: c(latToY(bbox[3], z)), y1: c(latToY(bbox[1], z) - 1e-9) };
  }
  function countTiles(bbox, maxz) {
    var b = normBbox(bbox), n = 0;
    if (!b) return 0;
    for (var z = 0; z <= maxz; z++) {
      var r = tileRange(b, z);
      n += (r.x1 - r.x0 + 1) * (r.y1 - r.y0 + 1);
    }
    return n;
  }
  // Sorted tile ids of the box from zoom 0 to maxz (null when too many).
  function tileIds(bbox, maxz, cap) {
    var b = normBbox(bbox);
    if (!b) return null;
    if (countTiles(b, maxz) > (cap || MAX_TILES)) return null;
    var out = [];
    for (var z = 0; z <= maxz; z++) {
      var r = tileRange(b, z);
      for (var x = r.x0; x <= r.x1; x++) for (var y = r.y0; y <= r.y1; y++) out.push(tileId(z, x, y));
    }
    var a = new Float64Array(out);
    a.sort();
    return a;
  }
  function bboxIntersects(a, b) { return a[0] < b[2] && b[0] < a[2] && a[1] < b[3] && b[1] < a[3]; }

  // ---------- PMTiles header / directories ----------
  var COMPRESSION = { 0: "unknown", 1: "none", 2: "gzip", 3: "brotli", 4: "zstd" };
  function parseHeader(u8) {
    if (!u8 || u8.length < 127) throw new Error("short");
    var magic = String.fromCharCode.apply(null, Array.prototype.slice.call(u8, 0, 7));
    if (magic !== "PMTiles") throw new Error("magic");
    var dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
    var h = {
      version: u8[7],
      rootOff: u64(dv, 8), rootLen: u64(dv, 16),
      metaOff: u64(dv, 24), metaLen: u64(dv, 32),
      leafOff: u64(dv, 40), leafLen: u64(dv, 48),
      dataOff: u64(dv, 56), dataLen: u64(dv, 64),
      addressed: u64(dv, 72), entries: u64(dv, 80), contents: u64(dv, 88),
      clustered: u8[96] === 1,
      internalComp: u8[97], tileComp: u8[98], tileType: u8[99],
      minZoom: u8[100], maxZoom: u8[101],
      bounds: [dv.getInt32(102, true) / 1e7, dv.getInt32(106, true) / 1e7,
               dv.getInt32(110, true) / 1e7, dv.getInt32(114, true) / 1e7]
    };
    if (h.version !== 3) throw new Error("version");
    return h;
  }
  // Why a source can't be used (or "" when it can).
  function headerProblem(h) {
    if (h.tileType !== 1) return "type";                    // only vector (MVT)
    if (h.tileComp !== 1 && h.tileComp !== 2) return "comp";
    if (h.internalComp !== 1 && h.internalComp !== 2) return "comp";
    return "";
  }
  function parseDir(u8) {
    var p = { buf: u8, pos: 0 };
    var n = readVarint(p);
    if (n > 10000000) throw new Error("dir");
    var ids = new Float64Array(n), runs = new Float64Array(n), lens = new Float64Array(n), offs = new Float64Array(n);
    var i, last = 0;
    for (i = 0; i < n; i++) { last += readVarint(p); ids[i] = last; }
    for (i = 0; i < n; i++) runs[i] = readVarint(p);
    for (i = 0; i < n; i++) lens[i] = readVarint(p);
    for (i = 0; i < n; i++) {
      var v = readVarint(p);
      if (v === 0 && i > 0) offs[i] = offs[i - 1] + lens[i - 1];
      else offs[i] = v - 1;
    }
    return { ids: ids, runs: runs, lens: lens, offs: offs, n: n };
  }
  // Index of the entry holding tile id (or -1).
  function findEntry(dir, id) {
    var lo = 0, hi = dir.n - 1, k;
    while (lo <= hi) {
      k = (lo + hi) >> 1;
      if (dir.ids[k] < id) lo = k + 1;
      else if (dir.ids[k] > id) hi = k - 1;
      else return k;
    }
    if (hi >= 0) {
      if (dir.runs[hi] === 0) return hi;                    // a leaf directory covers it
      if (id - dir.ids[hi] < dir.runs[hi]) return hi;
    }
    return -1;
  }

  // Resolve sorted tile ids to their data in the archive.
  //   io.readDir(absOffset, length) → Promise<Uint8Array> (decompressed directory bytes)
  //   io.progress(done, total) optional, counts directory requests
  // → Promise<{ ids: [], offs: [], lens: [] }>  (absolute byte offsets, tiles missing from the archive left out)
  function resolve(header, rootDir, ids, io) {
    var out = { ids: [], offs: [], lens: [] };
    var reqDone = 0, reqTotal = 0;
    function walk(dir, list, depth) {
      if (depth > 4) return Promise.reject(new Error("depth"));
      var groups = [], byOff = {};
      for (var i = 0; i < list.length; i++) {
        var id = list[i], k = findEntry(dir, id);
        if (k < 0) continue;
        if (dir.runs[k] > 0) {
          out.ids.push(id); out.offs.push(header.dataOff + dir.offs[k]); out.lens.push(dir.lens[k]);
        } else {
          var key = dir.offs[k];
          if (!byOff[key]) { byOff[key] = { off: header.leafOff + dir.offs[k], len: dir.lens[k], ids: [] }; groups.push(byOff[key]); }
          byOff[key].ids.push(id);
        }
      }
      reqTotal += groups.length;
      var next = 0;
      function worker() {
        if (next >= groups.length) return Promise.resolve();
        var g = groups[next++];
        return io.readDir(g.off, g.len).then(function (u8) {
          reqDone++;
          if (io.progress) io.progress(reqDone, reqTotal);
          return walk(parseDir(u8), g.ids, depth + 1);
        }).then(worker);
      }
      var ws = [];
      for (var w = 0; w < Math.min(4, groups.length); w++) ws.push(worker());
      return Promise.all(ws);
    }
    return walk(rootDir, Array.prototype.slice.call(ids), 0).then(function () {
      // sort by tile id (leaves resolve out of order)
      var order = out.ids.map(function (_, i) { return i; });
      order.sort(function (a, b) { return out.ids[a] - out.ids[b]; });
      return { ids: order.map(function (i) { return out.ids[i]; }),
               offs: order.map(function (i) { return out.offs[i]; }),
               lens: order.map(function (i) { return out.lens[i]; }) };
    });
  }

  // Bytes to download per detail level: sizes[z] = all unique tile
  // data from zoom 0 to z (shared tiles, like open sea, count once).
  function sizesByZoom(res, maxz) {
    var seen = {}, sizes = [], counts = [], total = 0, n = 0;
    var byZ = [];
    for (var z = 0; z <= maxz; z++) byZ.push([]);
    for (var i = 0; i < res.ids.length; i++) {
      var zz = zoomOf(res.ids[i]);
      if (zz >= 0 && zz <= maxz) byZ[zz].push(i);
    }
    for (z = 0; z <= maxz; z++) {
      byZ[z].forEach(function (i) {
        n++;
        if (!seen[res.offs[i]]) { seen[res.offs[i]] = 1; total += res.lens[i]; }
      });
      sizes.push(total); counts.push(n);
    }
    return { bytes: sizes, tiles: counts };
  }

  // The pack for one detail level: tiles up to maxz, download chunks.
  function makePack(res, maxz, gap, maxChunk) {
    gap = gap == null ? CHUNK_GAP : gap;
    maxChunk = maxChunk || api.CHUNK_MAX;           // (a test may lower it)
    var keep = [];
    for (var i = 0; i < res.ids.length; i++) if (zoomOf(res.ids[i]) <= maxz) keep.push(i);
    // unique blobs sorted by source offset
    var blobOffs = [], blobLen = {}, seen = {};
    keep.forEach(function (i) {
      var o = res.offs[i];
      if (!seen[o]) { seen[o] = 1; blobOffs.push(o); blobLen[o] = res.lens[i]; }
    });
    blobOffs.sort(function (a, b) { return a - b; });
    var cStart = [], cLen = [], where = {};
    blobOffs.forEach(function (o) {
      var L = blobLen[o], c = cStart.length - 1;
      var end = c >= 0 ? cStart[c] + cLen[c] : -1;
      if (c >= 0 && o <= end + gap && (Math.max(end, o + L) - cStart[c]) <= maxChunk) {
        cLen[c] = Math.max(end, o + L) - cStart[c];
      } else {
        cStart.push(o); cLen.push(L); c = cStart.length - 1;
      }
      where[o] = c;
    });
    var nT = keep.length, nC = cStart.length;
    var p = { ids: new Float64Array(nT), tc: new Uint32Array(nT), to: new Uint32Array(nT), tl: new Uint32Array(nT),
              cs: new Float64Array(nC), cl: new Float64Array(nC), bytes: 0, maxz: maxz };
    keep.forEach(function (i, j) {
      var o = res.offs[i], c = where[o];
      p.ids[j] = res.ids[i]; p.tc[j] = c; p.to[j] = o - cStart[c]; p.tl[j] = res.lens[i];
    });
    for (var k = 0; k < nC; k++) { p.cs[k] = cStart[k]; p.cl[k] = cLen[k]; p.bytes += cLen[k]; }
    return p;
  }

  // Binary form (OPFS file "plan.bin").
  function packToBin(p) {
    var nT = p.ids.length, nC = p.cs.length;
    var size = 8 * 4 + nT * 8 + nT * 12 + ((nT * 12) % 8 ? 4 : 0) + nC * 16;
    var buf = new ArrayBuffer(size), o = 0;
    var hd = new Float64Array(buf, 0, 4); hd[0] = 1; hd[1] = nT; hd[2] = nC; hd[3] = p.maxz; o = 32;
    new Float64Array(buf, o, nT).set(p.ids); o += nT * 8;
    new Uint32Array(buf, o, nT).set(p.tc); o += nT * 4;
    new Uint32Array(buf, o, nT).set(p.to); o += nT * 4;
    new Uint32Array(buf, o, nT).set(p.tl); o += nT * 4;
    if (o % 8) o += 4;
    new Float64Array(buf, o, nC).set(p.cs); o += nC * 8;
    new Float64Array(buf, o, nC).set(p.cl);
    return buf;
  }
  function binToPack(buf) {
    if (!buf || buf.byteLength < 32) throw new Error("plan");
    var hd = new Float64Array(buf, 0, 4);
    var nT = hd[1], nC = hd[2];
    if (hd[0] !== 1 || !(nT >= 0) || !(nC >= 0) || nT % 1 || nC % 1) throw new Error("plan");
    var o = 32, need = 32 + nT * 20 + ((nT * 12) % 8 ? 4 : 0) + nC * 16;
    if (buf.byteLength !== need) throw new Error("plan");
    var p = { maxz: hd[3] };
    p.ids = new Float64Array(buf, o, nT); o += nT * 8;
    p.tc = new Uint32Array(buf, o, nT); o += nT * 4;
    p.to = new Uint32Array(buf, o, nT); o += nT * 4;
    p.tl = new Uint32Array(buf, o, nT); o += nT * 4;
    if (o % 8) o += 4;
    p.cs = new Float64Array(buf, o, nC); o += nC * 8;
    p.cl = new Float64Array(buf, o, nC);
    p.bytes = 0;
    for (var k = 0; k < nC; k++) {
      p.bytes += p.cl[k];
    }
    for (var i = 0; i < nT; i++) {
      if (i && p.ids[i] <= p.ids[i - 1]) throw new Error("plan");
      if (p.tc[i] >= nC || p.to[i] + p.tl[i] > p.cl[p.tc[i]]) throw new Error("plan");
    }
    return p;
  }
  function lookup(p, id) {
    var lo = 0, hi = p.ids.length - 1, k;
    while (lo <= hi) {
      k = (lo + hi) >> 1;
      if (p.ids[k] < id) lo = k + 1;
      else if (p.ids[k] > id) hi = k - 1;
      else return k;
    }
    return -1;
  }

  // ---------- Mapbox Vector Tile decoding ----------
  var UTF8 = typeof TextDecoder !== "undefined" ? new TextDecoder("utf-8") : null;
  function utf8(u8, a, b) {
    if (UTF8) return UTF8.decode(u8.subarray(a, b));
    var s = ""; for (var i = a; i < b; i++) s += String.fromCharCode(u8[i]);
    try { return decodeURIComponent(escape(s)); } catch (e) { return s; }
  }
  function skip(p, wire) {
    if (wire === 0) readVarint(p);
    else if (wire === 1) p.pos += 8;
    else if (wire === 2) { var l = readVarint(p); p.pos += l; }
    else if (wire === 5) p.pos += 4;
    else throw new Error("wire");
    if (p.pos > p.buf.length) throw new Error("eof");
  }
  function packed(p) {
    var l = readVarint(p), end = p.pos + l, out = [];
    if (end > p.buf.length) throw new Error("eof");
    while (p.pos < end) out.push(readVarint(p));
    return out;
  }
  function zz(n) { return n % 2 ? -(n + 1) / 2 : n / 2; }
  function readValue(p, end) {
    var v = null;
    var dv = new DataView(p.buf.buffer, p.buf.byteOffset, p.buf.byteLength);
    while (p.pos < end) {
      var tag = readVarint(p), f = Math.floor(tag / 8), w = tag & 7;
      if (f === 1 && w === 2) { var l = readVarint(p); v = utf8(p.buf, p.pos, p.pos + l); p.pos += l; }
      else if (f === 2 && w === 5) { v = dv.getFloat32(p.pos, true); p.pos += 4; }
      else if (f === 3 && w === 1) { v = dv.getFloat64(p.pos, true); p.pos += 8; }
      else if ((f === 4 || f === 5) && w === 0) v = readVarint(p);
      else if (f === 6 && w === 0) v = zz(readVarint(p));
      else if (f === 7 && w === 0) v = !!readVarint(p);
      else skip(p, w);
    }
    return v;
  }
  // Geometry → array of parts, each a flat [x0, y0, x1, y1, …].
  function geometry(cmds, type) {
    var parts = [], cur = null, x = 0, y = 0, i = 0;
    while (i < cmds.length) {
      var c = cmds[i++], id = c & 7, cnt = c >> 3;
      if (id === 1 || id === 2) {
        for (var k = 0; k < cnt && i + 1 < cmds.length; k++) {
          x += zz(cmds[i++]); y += zz(cmds[i++]);
          if (id === 1) {
            if (cur && cur.length) parts.push(cur);
            cur = [];
          }
          if (!cur) cur = [];
          cur.push(x, y);
        }
      } else if (id === 7) {
        if (cur && cur.length >= 2) cur.push(cur[0], cur[1]);
      } else break;
    }
    if (cur && cur.length) parts.push(cur);
    if (type === 1) {                               // multipoint: one part per point
      var pts = [];
      parts.forEach(function (pt) { for (var j = 0; j + 1 < pt.length; j += 2) pts.push([pt[j], pt[j + 1]]); });
      return pts;
    }
    return parts;
  }
  // → { <layer name>: { extent, features: [{ type 1|2|3, props, geom }] } }
  function decodeMvt(u8) {
    var p = { buf: u8, pos: 0 }, layers = {};
    while (p.pos < u8.length) {
      var tag = readVarint(p), f = Math.floor(tag / 8), w = tag & 7;
      if (f !== 3 || w !== 2) { skip(p, w); continue; }
      var len = readVarint(p), end = p.pos + len;
      if (end > u8.length) throw new Error("eof");
      var name = "", extent = 4096, keys = [], vals = [], raw = [];
      while (p.pos < end) {
        var t2 = readVarint(p), f2 = Math.floor(t2 / 8), w2 = t2 & 7;
        if (f2 === 1 && w2 === 2) { var l1 = readVarint(p); name = utf8(u8, p.pos, p.pos + l1); p.pos += l1; }
        else if (f2 === 2 && w2 === 2) {
          var l2 = readVarint(p), fe = p.pos + l2, feat = { type: 0, tags: [], cmds: [] };
          while (p.pos < fe) {
            var t3 = readVarint(p), f3 = Math.floor(t3 / 8), w3 = t3 & 7;
            if (f3 === 2 && w3 === 2) feat.tags = packed(p);
            else if (f3 === 3 && w3 === 0) feat.type = readVarint(p);
            else if (f3 === 4 && w3 === 2) feat.cmds = packed(p);
            else skip(p, w3);
          }
          p.pos = fe;
          raw.push(feat);
        }
        else if (f2 === 3 && w2 === 2) { var l3 = readVarint(p); keys.push(utf8(u8, p.pos, p.pos + l3)); p.pos += l3; }
        else if (f2 === 4 && w2 === 2) { var l4 = readVarint(p), ve = p.pos + l4; vals.push(readValue(p, ve)); p.pos = ve; }
        else if (f2 === 5 && w2 === 0) extent = readVarint(p) || 4096;
        else skip(p, w2);
      }
      p.pos = end;
      var feats = [];
      raw.forEach(function (r) {
        if (r.type < 1 || r.type > 3) return;
        var props = {};
        for (var i = 0; i + 1 < r.tags.length; i += 2) {
          var k = keys[r.tags[i]], v = vals[r.tags[i + 1]];
          if (k !== undefined && v !== undefined && v !== null) props[k] = v;
        }
        feats.push({ type: r.type, props: props, geom: geometry(r.cmds, r.type) });
      });
      if (name) layers[name] = { extent: extent, features: feats };
    }
    return layers;
  }
  function kindOf(props) { return String(props.kind || props["pmap:kind"] || ""); }
  function detailOf(props) { return String(props.kind_detail || props["pmap:kind_detail"] || ""); }

  // ---------- offline search ----------
  function fold(s) {
    return String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "")
      .toLowerCase().replace(/ς/g, "σ").replace(/\s+/g, " ").trim();
  }
  // Greek letters → Latin (after fold), so "kydathinaion" finds
  // "Κυδαθηναίων" and Greek typing finds Latin names.
  var GR = { "α": "a", "β": "v", "γ": "g", "δ": "d", "ε": "e", "ζ": "z", "η": "i", "θ": "th", "ι": "i", "κ": "k", "λ": "l",
    "μ": "m", "ν": "n", "ξ": "x", "ο": "o", "π": "p", "ρ": "r", "σ": "s", "τ": "t", "υ": "y", "φ": "f", "χ": "ch", "ψ": "ps", "ω": "o" };
  function latin(s) {
    return s.replace(/ου/g, "ou").replace(/[α-ω]/g, function (c) { return GR[c] || c; });
  }
  var SKIP_LAYERS = { earth: 1, boundaries: 1, landcover: 1 };
  // One feature's search position: a point, the middle of a line's
  // middle segment, or the average of a polygon's outer ring.
  function featurePos(f) {
    var g = f.geom;
    if (!g || !g.length) return null;
    if (f.type === 1) return g[0];
    var part = g[0];
    if (f.type === 2) {
      var longest = g[0];
      g.forEach(function (q) { if (q.length > longest.length) longest = q; });
      var n2 = longest.length / 2;
      if (n2 < 2) return [longest[0], longest[1]];
      var k = Math.floor((n2 - 1) / 2) * 2;               // the middle segment's midpoint
      return [(longest[k] + longest[k + 2]) / 2, (longest[k + 1] + longest[k + 3]) / 2];
    }
    var sx = 0, sy = 0, n = 0;
    for (var i = 0; i + 1 < part.length; i += 2) { sx += part[i]; sy += part[i + 1]; n++; }
    return n ? [sx / n, sy / n] : null;
  }
  // Index entries of one decoded tile (z, x, y):
  // [name, alt names, kind, lat, lon]
  function indexTile(layers, z, x, y) {
    var out = [];
    Object.keys(layers).forEach(function (ln) {
      if (SKIP_LAYERS[ln]) return;
      var L = layers[ln], ext = L.extent || 4096;
      L.features.forEach(function (f) {
        var pr = f.props, name = typeof pr.name === "string" ? pr.name.trim() : "";
        var hn = pr["addr:housenumber"] || pr.housenumber || pr.addr_housenumber;
        var st = pr["addr:street"] || pr.street || pr.addr_street;
        var addr = false;
        if (!name && hn && st) { name = String(st).trim() + " " + String(hn).trim(); addr = true; }
        if (!name || name.length > 120) return;
        var pos = featurePos(f);
        if (!pos) return;
        if (pos[0] < 0 || pos[1] < 0 || pos[0] >= ext || pos[1] >= ext) return;   // in the tile buffer: another tile has it
        var alt = [];
        ["name:en", "name:el", "name_en", "name_el", "official_name", "alt_name"].forEach(function (k) {
          var v = pr[k];
          if (typeof v === "string" && v.trim() && v.trim() !== name && alt.indexOf(v.trim()) < 0) alt.push(v.trim().slice(0, 120));
        });
        var kind = addr ? "address" : (kindOf(pr) || ln);
        if (ln === "roads" && kind !== "path") kind = "street";
        var lat = yToLat(y + pos[1] / ext, z), lon = xToLon(x + pos[0] / ext, z);
        out.push([name, alt.join("|"), ln + ":" + kind, +lat.toFixed(5), +lon.toFixed(5)]);
      });
    });
    return out;
  }
  // Merge entries: the same name and kind within about 2 km is one
  // entry (a street cut by tile edges).
  function buildIndex(entries, cap) {
    var seen = {}, out = [];
    for (var i = 0; i < entries.length; i++) {
      var e = entries[i];
      var key = fold(e[0]) + "|" + e[2] + "|" + Math.round(e[3] * 50) + "|" + Math.round(e[4] * 50);
      if (seen[key]) continue;
      seen[key] = 1;
      out.push(e);
      if (out.length >= (cap || MAX_INDEX)) break;
    }
    out.sort(function (a, b) { return a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0; });
    return out;
  }
  function normIndex(arr) {
    if (!Array.isArray(arr)) return [];
    var out = [];
    arr.forEach(function (e) {
      if (!Array.isArray(e) || typeof e[0] !== "string" || !e[0] || !isFinite(e[3]) || !isFinite(e[4])) return;
      if (Math.abs(e[3]) > 90 || Math.abs(e[4]) > 180) return;
      out.push([e[0].slice(0, 120), typeof e[1] === "string" ? e[1].slice(0, 400) : "", typeof e[2] === "string" ? e[2].slice(0, 60) : "", +e[3], +e[4]]);
    });
    return out;
  }
  // Rank: whole name starts with the query, then every word of the
  // query starts a word of the name, then contained; kind (towns
  // before shops) and distance from the map centre break ties.
  var KIND_RANK = { "places:country": 0, "places:region": 1, "places:locality": 2, "places:macrohood": 3, "places:neighbourhood": 3 };
  function search(index, query, center, limit) {
    var q = fold(query);
    if (q.length < 2) return [];
    var ql = latin(q);
    if (ql !== q) return search(index, ql, center, limit);      // Greek query: compare in Latin letters
    var words = q.split(" ").filter(Boolean), hits = [];
    for (var i = 0; i < index.length; i++) {
      var e = index[i];
      if (!e._f) e._f = latin(fold(e[0] + (e[1] ? " | " + e[1].split("|").join(" | ") : "")));
      var f = e._f, score;
      if (f.indexOf(q) === 0 || f.indexOf("| " + q) >= 0) score = 0;
      else {
        var all = true, prefix = true, sf = " " + f.replace(/[(\-,./'"«]/g, " ");
        for (var w = 0; w < words.length; w++) {
          if (f.indexOf(words[w]) < 0) { all = false; break; }
          if (sf.indexOf(" " + words[w]) < 0) prefix = false;
        }
        if (!all) continue;
        score = prefix ? 1 : 2;
      }
      var kr = KIND_RANK[e[2]];
      var d = center ? Math.pow(e[3] - center[0], 2) + Math.pow((e[4] - center[1]) * Math.cos(center[0] * Math.PI / 180), 2) : 0;
      hits.push({ e: e, s: score * 10 + (kr === undefined ? 5 : kr), d: d });
    }
    hits.sort(function (a, b) { return a.s - b.s || a.d - b.d; });
    return hits.slice(0, limit || 8).map(function (h) { return h.e; });
  }

  // ---------- misc ----------
  // Latest daily build in Protomaps' list (build-metadata.protomaps.dev/builds.json).
  function latestBuild(json) {
    var best = "";
    (Array.isArray(json) ? json : []).forEach(function (b) {
      var k = typeof b === "string" ? b : (b && typeof b.key === "string" ? b.key : "");
      var m = /^(\d{8})\.pmtiles$/.exec(k);
      if (m && m[1] > best) best = m[1];
    });
    return best;
  }
  function fmtBytes(n, lang) {
    var u = ["B", "KB", "MB", "GB"], i = 0;
    n = Math.max(0, +n || 0);
    while (n >= 1000 && i < u.length - 1) { n /= 1000; i++; }
    var s = i === 0 ? String(Math.round(n)) : n.toFixed(n < 10 ? 1 : 0);
    if (lang === "el") s = s.replace(".", ",");
    return s + " " + u[i];
  }
  function okUrl(s) {
    if (typeof s !== "string" || s.length > 2000) return false;
    try { var u = new URL(s); return u.protocol === "https:" || u.protocol === "http:"; } catch (e) { return false; }
  }
  // Device-local pack record (meta.json), normalised on load.
  function normMeta(m) {
    if (!m || typeof m !== "object") return null;
    if (typeof m.id !== "string" || !/^p[a-z0-9]{4,30}$/.test(m.id)) return null;
    var b = normBbox(m.bbox);
    if (!b) return null;
    var st = ["dl", "index", "ready"].indexOf(m.state) >= 0 ? m.state : "dl";
    return {
      v: 1, id: m.id, name: (typeof m.name === "string" && m.name.trim() ? m.name.trim() : "?").slice(0, 80),
      bbox: b, maxz: Math.max(0, Math.min(MAX_ZOOM, m.maxz | 0)),
      src: okUrl(m.src) ? m.src : "", build: typeof m.build === "string" ? m.build.slice(0, 20) : "",
      created: +m.created || 0, bytes: +m.bytes || 0, tiles: +m.tiles || 0, chunks: +m.chunks || 0,
      tc: m.tc === 1 ? 1 : 2, state: st, paused: !!m.paused,
      sig: typeof m.sig === "string" ? m.sig.slice(0, 200) : "",
      words: +m.words || 0, replaces: typeof m.replaces === "string" ? m.replaces.slice(0, 40) : ""
    };
  }
  // A header signature: a newer file behind the same address changes it.
  function headerSig(h) { return [h.rootOff, h.rootLen, h.leafOff, h.leafLen, h.dataOff, h.dataLen].join(","); }

  var api = {
    VER: VER, MAX_TILES: MAX_TILES, MAX_ZOOM: MAX_ZOOM, CHUNK_GAP: CHUNK_GAP, CHUNK_MAX: CHUNK_MAX, TZ: TZ,
    COMPRESSION: COMPRESSION,
    readVarint: readVarint, tileId: tileId, zoomOf: zoomOf, tileXY: tileXY,
    lonToX: lonToX, latToY: latToY, xToLon: xToLon, yToLat: yToLat,
    normBbox: normBbox, tileRange: tileRange, countTiles: countTiles, tileIds: tileIds, bboxIntersects: bboxIntersects,
    parseHeader: parseHeader, headerProblem: headerProblem, headerSig: headerSig, parseDir: parseDir, findEntry: findEntry,
    resolve: resolve, sizesByZoom: sizesByZoom, makePack: makePack, packToBin: packToBin, binToPack: binToPack, lookup: lookup,
    decodeMvt: decodeMvt, kindOf: kindOf, detailOf: detailOf,
    fold: fold, latin: latin, indexTile: indexTile, buildIndex: buildIndex, normIndex: normIndex, search: search,
    latestBuild: latestBuild, fmtBytes: fmtBytes, okUrl: okUrl, normMeta: normMeta
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.OrosMapsOffline = api;
})(typeof window !== "undefined" ? window : this);
