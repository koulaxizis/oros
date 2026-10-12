// ============================================================
// orOS Photo Lab — tiles (no DOM)
// A raster layer's pixels as a sparse grid of TILE × TILE RGBA
// tiles (straight alpha, 8 bits). Empty tiles are not stored, so a
// mostly transparent layer costs almost nothing, painting touches
// only the tiles under the brush, undo keeps only changed tiles and
// a save writes only changed tiles.
//
//   Surface  { tiles: Map("tx,ty" → Uint8ClampedArray), dirty: {} }
//   Grid coordinates are the layer's own (the layer's x, y offset on
//   the canvas is added by the caller).
//
// Tile files on the orOS disk: "PLT1" + deflate-raw(RGBA), named by
// content (two independent 53-bit hashes, 28 hex digits), so a tile
// file never changes once written and two devices writing the same
// pixels write the same name. Lossless: no PNG round trip through a
// premultiplied canvas.
//
// UMD: module.exports in Node (tests), window.PhotoLab.tiles in the app.
// ============================================================
(function (root) {
  "use strict";

  var TILE = 256;
  var TB = TILE * TILE * 4;
  var MAGIC = [80, 76, 84, 49];               // "PLT1"

  function key(tx, ty) { return tx + "," + ty; }
  function floorDiv(a) { return Math.floor(a / TILE); }

  function create() { return { tiles: new Map(), dirty: {} }; }

  function get(s, tx, ty) { return s.tiles.get(key(tx, ty)) || null; }
  // The tile, created empty when missing (for writes).
  function ensure(s, tx, ty) {
    var k = key(tx, ty), t = s.tiles.get(k);
    if (!t) { t = new Uint8ClampedArray(TB); s.tiles.set(k, t); }
    return t;
  }
  function markDirty(s, k) { s.dirty[k] = 1; }

  function isEmpty(t) {
    for (var i = 3; i < t.length; i += 4) if (t[i] !== 0) return false;
    return true;
  }
  // Drops tiles that became fully transparent.
  function prune(s, keys) {
    (keys || Array.from(s.tiles.keys())).forEach(function (k) {
      var t = s.tiles.get(k);
      if (t && isEmpty(t)) { s.tiles.delete(k); s.dirty[k] = 1; }
    });
  }

  // Keys of the tiles a rectangle (layer coordinates) touches.
  function keysIn(x, y, w, h) {
    var out = [];
    if (w <= 0 || h <= 0) return out;
    var tx0 = floorDiv(x), ty0 = floorDiv(y), tx1 = floorDiv(x + w - 1), ty1 = floorDiv(y + h - 1);
    for (var ty = ty0; ty <= ty1; ty++) for (var tx = tx0; tx <= tx1; tx++) out.push(key(tx, ty));
    return out;
  }

  // Bounds of the stored tiles (layer coordinates), or null.
  function tileBounds(s) {
    var x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    s.tiles.forEach(function (t, k) {
      var i = k.indexOf(","), tx = +k.slice(0, i), ty = +k.slice(i + 1);
      x0 = Math.min(x0, tx * TILE); y0 = Math.min(y0, ty * TILE);
      x1 = Math.max(x1, tx * TILE + TILE); y1 = Math.max(y1, ty * TILE + TILE);
    });
    return x0 === Infinity ? null : { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  }
  // Exact bounds of the non-transparent pixels, or null.
  function contentBounds(s) {
    var x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    s.tiles.forEach(function (t, k) {
      var i = k.indexOf(","), ox = +k.slice(0, i) * TILE, oy = +k.slice(i + 1) * TILE;
      for (var py = 0; py < TILE; py++) {
        var row = py * TILE * 4;
        for (var px = 0; px < TILE; px++) {
          if (t[row + px * 4 + 3] === 0) continue;
          if (ox + px < x0) x0 = ox + px;
          if (ox + px > x1) x1 = ox + px;
          if (oy + py < y0) y0 = oy + py;
          if (oy + py > y1) y1 = oy + py;
        }
      }
    });
    return x0 === Infinity ? null : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
  }

  // Copies a rectangle out: { w, h, data } (transparent where empty).
  function readRect(s, x, y, w, h) {
    var data = new Uint8ClampedArray(w * h * 4);
    keysIn(x, y, w, h).forEach(function (k) {
      var t = s.tiles.get(k);
      if (!t) return;
      var i = k.indexOf(","), ox = +k.slice(0, i) * TILE, oy = +k.slice(i + 1) * TILE;
      var sx0 = Math.max(x, ox), sy0 = Math.max(y, oy);
      var sx1 = Math.min(x + w, ox + TILE), sy1 = Math.min(y + h, oy + TILE);
      for (var py = sy0; py < sy1; py++) {
        var src = ((py - oy) * TILE + (sx0 - ox)) * 4;
        var dst = ((py - y) * w + (sx0 - x)) * 4;
        data.set(t.subarray(src, src + (sx1 - sx0) * 4), dst);
      }
    });
    return { w: w, h: h, data: data };
  }

  // Writes a rectangle in (replaces those pixels). Fully transparent
  // tiles are dropped. → the keys touched.
  function writeRect(s, x, y, img) {
    var w = img.w, h = img.h, keys = keysIn(x, y, w, h);
    keys.forEach(function (k) {
      var i = k.indexOf(","), tx = +k.slice(0, i), ty = +k.slice(i + 1);
      var ox = tx * TILE, oy = ty * TILE;
      var sx0 = Math.max(x, ox), sy0 = Math.max(y, oy);
      var sx1 = Math.min(x + w, ox + TILE), sy1 = Math.min(y + h, oy + TILE);
      var t = s.tiles.get(k);
      if (!t) {
        // Skip creating a tile for an all-transparent piece.
        var any = false;
        for (var qy = sy0; qy < sy1 && !any; qy++) {
          var r = ((qy - y) * w + (sx0 - x)) * 4;
          for (var q = r + 3; q < r + (sx1 - sx0) * 4; q += 4) if (img.data[q]) { any = true; break; }
        }
        if (!any) return;
        t = ensure(s, tx, ty);
      }
      for (var py = sy0; py < sy1; py++) {
        var src = ((py - y) * w + (sx0 - x)) * 4;
        var dst = ((py - oy) * TILE + (sx0 - ox)) * 4;
        t.set(img.data.subarray(src, src + (sx1 - sx0) * 4), dst);
      }
      s.dirty[k] = 1;
    });
    prune(s, keys);
    return keys;
  }

  function clear(s) {
    s.tiles.forEach(function (t, k) { s.dirty[k] = 1; });
    s.tiles.clear();
  }

  // ---------- Layer masks ----------
  // A mask is a surface painted in grey; where a pixel is (partly)
  // transparent the mask's bg (0 or 255) shows through. → an RGBA
  // tile whose alpha is the mask value (rgb 0), for destination-in.
  function maskAlpha(t, bg) {
    var out = new Uint8ClampedArray(TB);
    if (!t) { if (bg) for (var j = 3; j < TB; j += 4) out[j] = bg; return out; }
    for (var i = 0; i < TB; i += 4) {
      var a = t[i + 3];
      out[i + 3] = (t[i] * a + bg * (255 - a) + 127) / 255;
    }
    return out;
  }
  // Mask value at one layer-grid pixel (0-255).
  function maskAt(s, bg, x, y) {
    var t = s.tiles.get(key(floorDiv(x), floorDiv(y)));
    if (!t) return bg;
    var i = ((y - floorDiv(y) * TILE) * TILE + (x - floorDiv(x) * TILE)) * 4, a = t[i + 3];
    return Math.round((t[i] * a + bg * (255 - a)) / 255);
  }

  // ---------- Snapshots (undo) ----------
  // { key: copy | null } for the given keys.
  function snapshot(s, keys) {
    var snap = {};
    keys.forEach(function (k) {
      var t = s.tiles.get(k);
      snap[k] = t ? new Uint8ClampedArray(t) : null;
    });
    return snap;
  }
  function restore(s, snap) {
    Object.keys(snap).forEach(function (k) {
      if (snap[k]) s.tiles.set(k, new Uint8ClampedArray(snap[k]));
      else s.tiles.delete(k);
      s.dirty[k] = 1;
    });
  }
  function snapBytes(snap) {
    var n = 0;
    Object.keys(snap).forEach(function (k) { n += 64 + (snap[k] ? snap[k].length : 0); });
    return n;
  }
  function clone(s) {
    var c = create();
    s.tiles.forEach(function (t, k) { c.tiles.set(k, new Uint8ClampedArray(t)); });
    return c;
  }

  // ---------- Content names ----------
  // cyrb53 with two seeds → 28 hex digits.
  function h53(bytes, seed) {
    var h1 = 0xdeadbeef ^ seed, h2 = 0x41c6ce57 ^ seed;
    for (var i = 0; i < bytes.length; i++) {
      var ch = bytes[i];
      h1 = Math.imul(h1 ^ ch, 2654435761);
      h2 = Math.imul(h2 ^ ch, 1597334677);
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    var n = 4294967296 * (2097151 & h2) + (h1 >>> 0);
    var s = n.toString(16);
    while (s.length < 14) s = "0" + s;
    return s;
  }
  function tileName(t) { return h53(t, 0x9e3779b9) + h53(t, 0x85ebca6b); }

  // ---------- Tile files ----------
  function streamBytes(bytes, stream) {
    var res = new Response(new Blob([bytes]).stream().pipeThrough(stream));
    return res.arrayBuffer().then(function (b) { return new Uint8Array(b); });
  }
  // → Promise<Uint8Array> (file bytes)
  function encodeTile(t) {
    return streamBytes(t, new CompressionStream("deflate-raw")).then(function (z) {
      var out = new Uint8Array(4 + z.length);
      out.set(MAGIC, 0); out.set(z, 4);
      return out;
    });
  }
  // → Promise<Uint8ClampedArray>; rejects Error("tile") on anything
  // that is not exactly one tile (size checked while inflating).
  function decodeTile(bytes) {
    try {
      if (!(bytes instanceof Uint8Array) || bytes.length < 5) throw new Error("tile");
      for (var i = 0; i < 4; i++) if (bytes[i] !== MAGIC[i]) throw new Error("tile");
    } catch (e) { return Promise.reject(new Error("tile")); }
    var out = new Uint8ClampedArray(TB), at = 0;
    var reader = new Blob([bytes.subarray(4)]).stream()
      .pipeThrough(new DecompressionStream("deflate-raw")).getReader();
    function pump() {
      return reader.read().then(function (r) {
        if (r.done) {
          if (at !== TB) throw new Error("tile");
          return out;
        }
        if (at + r.value.length > TB) { try { reader.cancel(); } catch (e) {} throw new Error("tile"); }
        out.set(r.value, at); at += r.value.length;
        return pump();
      });
    }
    return pump().catch(function () { throw new Error("tile"); });
  }

  var API = {
    TILE: TILE, create: create, get: get, ensure: ensure, key: key, markDirty: markDirty,
    isEmpty: isEmpty, prune: prune, keysIn: keysIn, tileBounds: tileBounds,
    contentBounds: contentBounds, readRect: readRect, writeRect: writeRect, clear: clear,
    snapshot: snapshot, restore: restore, snapBytes: snapBytes, clone: clone,
    maskAlpha: maskAlpha, maskAt: maskAt, tileName: tileName, encodeTile: encodeTile, decodeTile: decodeTile
  };

  if (typeof module !== "undefined" && module.exports) module.exports = API;
  else { root.PhotoLab = root.PhotoLab || {}; root.PhotoLab.tiles = API; }
})(typeof window !== "undefined" ? window : this);
