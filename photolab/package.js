// ============================================================
// orOS Photo Lab — package.js: the .orosphoto file (no DOM)
// One picture = one orOS bundle (../bundle.js, docs/oros-bundle.md).
// content.json holds the document in the app's own model (core.js):
// every layer with its kind, blend, opacity, offset, text, shape,
// adjustment, mask and styles, the guides and saved selections. Only
// the tile maps ("t") are replaced: each pixel owner (a raster layer,
// a layer mask, a saved selection) gets one PNG of its painted area
// in media/, named <sha256>.png, placed by "px":
//
//   content = { kind: "oros-photolab-package", ver: 1,
//     doc: { name, w, h, m, layers: [{ id, k, name, vis, lock, op,
//            bl, x, y, px?, tx?, sh?, aj?, fx?,
//            mk?: { id, on, bg, px? } }] (bottom → top),
//            gd?, sels?: [{ id, name, x, y, px? }] } }
//   px = { key: "<sha256>.png", x, y, w, h } in the owner's own grid
//        (the layer's x, y are added on the canvas, like tiles)
//
// The PNGs are written and read here, byte for byte (straight alpha,
// 8-bit RGBA): no round trip through a premultiplied canvas, so a
// layer, a soft mask edge or a half-selected pixel comes back exactly
// as it was saved. A PNG this reader can't take (16-bit, interlaced,
// edited by another program) is left to the browser by the caller.
//
//   build(doc, surfaces, T, sha256) → Promise<{ content, media }>
//   parse(content, C, o) → { doc (fresh ids, normalised), pieces:
//        [{ sid, key, x, y, w, h }] } ; throws Error("notpackage"),
//        or an Error with code "newer" for a later content version
//   encodePng(img) → Promise<Uint8Array>; decodePng(bytes, o) →
//        Promise<{ w, h, data }> (rejects Error("png"))
//
// The bk back link (Atelier "Edit picture") is this device's session
// and is not saved. UMD: module.exports in Node (tests),
// window.PhotoLab.pkg in the app.
// ============================================================
(function (root) {
  "use strict";

  var KIND = "oros-photolab-package", VER = 1;
  var MIME = "application/x-oros-photo";
  var KEY_RE = /^[0-9a-f]{64}\.png$/;
  var SIDE_MAX = 65536;                       // one piece, either side
  var PIECE_MAX = 16384 * 16384;              // one piece, pixels
  var POS_MAX = 8192 * 4;                     // core.js layer offsets

  // ---------- PNG ----------
  var CRC = (function () {
    var t = new Uint32Array(256);
    for (var n = 0; n < 256; n++) {
      var c = n;
      for (var k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c >>> 0;
    }
    return t;
  })();
  function crc32(b, c) {
    c = c === undefined ? 0xffffffff : c;
    for (var i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 255] ^ (c >>> 8);
    return c;
  }
  function u32(v) { return [(v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255]; }
  function rd32(b, i) { return ((b[i] << 24) | (b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]) >>> 0; }
  function chunk(type, data) {
    var out = new Uint8Array(12 + data.length), tb = [];
    for (var i = 0; i < 4; i++) tb.push(type.charCodeAt(i));
    out.set(u32(data.length), 0); out.set(tb, 4); out.set(data, 8);
    var c = crc32(data, crc32(tb)) ^ 0xffffffff;
    out.set(u32(c >>> 0), 8 + data.length);
    return out;
  }
  function pipe(bytes, stream) {
    var res = new Response(new Blob([bytes]).stream().pipeThrough(stream));
    return res.arrayBuffer().then(function (b) { return new Uint8Array(b); });
  }
  // zlib inflate, stopped as soon as the output passes max.
  function inflate(bytes, max) {
    var reader = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate")).getReader();
    var parts = [], n = 0;
    function pump() {
      return reader.read().then(function (r) {
        if (r.done) return;
        n += r.value.length;
        if (n > max) { try { reader.cancel(); } catch (e) {} throw new Error("png"); }
        parts.push(r.value);
        return pump();
      });
    }
    return pump().then(function () {
      var out = new Uint8Array(n), p = 0;
      parts.forEach(function (x) { out.set(x, p); p += x.length; });
      return out;
    });
  }
  function paeth(a, b, c) {
    var p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
    return pa <= pb && pa <= pc ? a : (pb <= pc ? b : c);
  }

  // img { w, h, data: RGBA } → PNG bytes (colour type 6, 8 bits). Each
  // row gets the filter with the smallest sum (the usual heuristic).
  function encodePng(img) {
    var w = img.w, h = img.h, d = img.data, stride = w * 4;
    var raw = new Uint8Array((stride + 1) * h), cand = [];
    for (var f = 0; f < 5; f++) cand.push(new Uint8Array(stride));
    for (var y = 0; y < h; y++) {
      var r = y * stride, u = r - stride, best = 0, bestSum = Infinity;
      for (f = 0; f < 5; f++) {
        var o = cand[f], sum = 0;
        for (var i = 0; i < stride; i++) {
          var x = d[r + i], a = i >= 4 ? d[r + i - 4] : 0, b = y ? d[u + i] : 0, c = y && i >= 4 ? d[u + i - 4] : 0, v;
          if (f === 0) v = x;
          else if (f === 1) v = x - a;
          else if (f === 2) v = x - b;
          else if (f === 3) v = x - ((a + b) >> 1);
          else v = x - paeth(a, b, c);
          v &= 255;
          o[i] = v;
          sum += v < 128 ? v : 256 - v;
          if (sum >= bestSum) break;
        }
        if (sum < bestSum) { bestSum = sum; best = f; }
      }
      raw[y * (stride + 1)] = best;
      raw.set(cand[best], y * (stride + 1) + 1);
    }
    return pipe(raw, new CompressionStream("deflate")).then(function (z) {
      var ihdr = new Uint8Array(13);
      ihdr.set(u32(w), 0); ihdr.set(u32(h), 4);
      ihdr[8] = 8; ihdr[9] = 6;                 // 8 bits, RGBA; deflate, filters, no interlace
      var parts = [new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", z), chunk("IEND", new Uint8Array(0))];
      var n = 0; parts.forEach(function (p) { n += p.length; });
      var out = new Uint8Array(n), at = 0;
      parts.forEach(function (p) { out.set(p, at); at += p.length; });
      return out;
    });
  }

  // PNG bytes → { w, h, data: RGBA }. 8-bit grey, RGB, palette, grey +
  // alpha and RGBA, not interlaced; o.maxPixels caps the size.
  // Anything else rejects Error("png").
  function decodePng(bytes, o) {
    var maxPixels = (o && o.maxPixels) || PIECE_MAX;
    try {
      var sig = [137, 80, 78, 71, 13, 10, 26, 10];
      if (!(bytes instanceof Uint8Array) || bytes.length < 45) throw 0;
      for (var i = 0; i < 8; i++) if (bytes[i] !== sig[i]) throw 0;
      var p = 8, hd = null, idat = [], idn = 0, pal = null, trns = null;
      while (p + 12 <= bytes.length) {
        var len = rd32(bytes, p), type = String.fromCharCode(bytes[p + 4], bytes[p + 5], bytes[p + 6], bytes[p + 7]);
        if (p + 12 + len > bytes.length) throw 0;
        var body = bytes.subarray(p + 8, p + 8 + len);
        if (type === "IHDR") {
          hd = { w: rd32(body, 0), h: rd32(body, 4), depth: body[8], ct: body[9], cm: body[10], fm: body[11], il: body[12] };
        } else if (type === "PLTE") pal = body;
        else if (type === "tRNS") trns = body;
        else if (type === "IDAT") { idat.push(body); idn += len; }
        else if (type === "IEND") break;
        p += 12 + len;
      }
      if (!hd || !hd.w || !hd.h || hd.w * hd.h > maxPixels || hd.depth !== 8 || hd.cm || hd.fm || hd.il) throw 0;
      var ch = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[hd.ct];
      if (!ch || (hd.ct === 3 && !pal) || !idn) throw 0;
    } catch (e) { return Promise.reject(new Error("png")); }
    var z = new Uint8Array(idn), at = 0;
    idat.forEach(function (b) { z.set(b, at); at += b.length; });
    var w = hd.w, h = hd.h, stride = w * ch;
    return inflate(z, (stride + 1) * h).then(function (raw) {
      if (raw.length !== (stride + 1) * h) throw new Error("png");
      var cur = new Uint8Array(stride), prev = new Uint8Array(stride);
      var out = new Uint8ClampedArray(w * h * 4);
      for (var y = 0; y < h; y++) {
        var r = y * (stride + 1), f = raw[r];
        if (f > 4) throw new Error("png");
        for (var i = 0; i < stride; i++) {
          var x = raw[r + 1 + i], a = i >= ch ? cur[i - ch] : 0, b = prev[i], c = i >= ch ? prev[i - ch] : 0;
          if (f === 1) x += a; else if (f === 2) x += b; else if (f === 3) x += (a + b) >> 1; else if (f === 4) x += paeth(a, b, c);
          cur[i] = x & 255;
        }
        var q = y * w * 4;
        for (var k = 0; k < w; k++, q += 4) {
          var s = k * ch;
          if (hd.ct === 6) { out[q] = cur[s]; out[q + 1] = cur[s + 1]; out[q + 2] = cur[s + 2]; out[q + 3] = cur[s + 3]; }
          else if (hd.ct === 2) {
            out[q] = cur[s]; out[q + 1] = cur[s + 1]; out[q + 2] = cur[s + 2];
            out[q + 3] = trns && trns.length >= 6 && trns[1] === cur[s] && trns[3] === cur[s + 1] && trns[5] === cur[s + 2] ? 0 : 255;
          } else if (hd.ct === 0) {
            out[q] = out[q + 1] = out[q + 2] = cur[s];
            out[q + 3] = trns && trns.length >= 2 && trns[1] === cur[s] ? 0 : 255;
          } else if (hd.ct === 4) { out[q] = out[q + 1] = out[q + 2] = cur[s]; out[q + 3] = cur[s + 1]; }
          else {
            var ix = cur[s];
            if (ix * 3 + 2 >= pal.length) throw new Error("png");
            out[q] = pal[ix * 3]; out[q + 1] = pal[ix * 3 + 1]; out[q + 2] = pal[ix * 3 + 2];
            out[q + 3] = trns && ix < trns.length ? trns[ix] : 255;
          }
        }
        var t = prev; prev = cur; cur = t;
      }
      return { w: w, h: h, data: out };
    }).catch(function () { throw new Error("png"); });
  }

  // ---------- Save ----------
  function hex(buf) {
    var b = new Uint8Array(buf), s = "";
    for (var i = 0; i < b.length; i++) s += (b[i] < 16 ? "0" : "") + b[i].toString(16);
    return s;
  }
  function defaultSha(bytes) { return crypto.subtle.digest("SHA-256", bytes).then(hex); }
  function copy(o) { return o == null ? o : JSON.parse(JSON.stringify(o)); }

  // doc: the open document (core.js); surfaces { id: tile surface };
  // T: tiles.js; sha256(bytes) → Promise<hex> (OrosBundle.sha256).
  function build(doc, surfaces, T, sha256) {
    sha256 = sha256 || defaultSha;
    var media = {}, chain = Promise.resolve();
    // One owner's painted area → px (or nothing when it is empty).
    function piece(sid, rec) {
      chain = chain.then(function () {
        var s = surfaces[sid], b = s && T.contentBounds(s);
        if (!b) return;
        return encodePng(T.readRect(s, b.x, b.y, b.w, b.h)).then(function (png) {
          return sha256(png).then(function (h) {
            var key = h + ".png";
            media[key] = png;
            rec.px = { key: key, x: b.x, y: b.y, w: b.w, h: b.h };
          });
        });
      });
    }
    var out = { name: doc.name, w: doc.w, h: doc.h, m: doc.m, layers: [] };
    doc.layers.forEach(function (L) {
      var o = {};
      Object.keys(L).forEach(function (k) { if (k !== "t" && k !== "mk") o[k] = copy(L[k]); });
      if (L.k === "raster") piece(L.id, o);
      if (L.mk) {
        o.mk = { id: L.mk.id, on: L.mk.on, bg: L.mk.bg };
        piece(L.mk.id, o.mk);
      }
      out.layers.push(o);
    });
    if (doc.gd) out.gd = copy(doc.gd);
    if (doc.sels && doc.sels.length) {
      out.sels = doc.sels.map(function (v) {
        var o = { id: v.id, name: v.name, x: v.x || 0, y: v.y || 0 };
        piece(v.id, o);
        return o;
      });
    }
    return chain.then(function () {
      return { content: { kind: KIND, ver: VER, doc: out }, media: media };
    });
  }

  // ---------- Open ----------
  function isInt(v) { return typeof v === "number" && isFinite(v) && Math.floor(v) === v; }
  function normPx(px) {
    if (!px || typeof px !== "object" || typeof px.key !== "string" || !KEY_RE.test(px.key)) return null;
    if (!isInt(px.x) || !isInt(px.y) || !isInt(px.w) || !isInt(px.h)) return null;
    if (Math.abs(px.x) > POS_MAX * 2 || Math.abs(px.y) > POS_MAX * 2) return null;
    if (px.w < 1 || px.h < 1 || px.w > SIDE_MAX || px.h > SIDE_MAX || px.w * px.h > PIECE_MAX) return null;
    return { key: px.key, x: px.x, y: px.y, w: px.w, h: px.h };
  }

  // content.json → a NEW document: fresh project, layer, mask and
  // selection ids, then core.js normDoc like any document read from
  // disk (what it drops, the pieces of it are dropped too).
  // o: { now, name (fallback) }
  function parse(content, C, o) {
    o = o || {};
    var c = content;
    if (!c || typeof c !== "object" || c.kind !== KIND || !c.doc || typeof c.doc !== "object") throw new Error("notpackage");
    if (typeof c.ver === "number" && c.ver > VER) { var e = new Error("newer"); e.code = "newer"; throw e; }
    var src = c.doc, used = {}, pieces = [];
    function fresh() {
      var id;
      do { id = C.newLayerId(); } while (used[id]);
      used[id] = 1;
      return id;
    }
    function take(px, sid) {
      var p = normPx(px);
      if (p) { p.sid = sid; pieces.push(p); }
    }
    var raw = {
      id: C.newProjectId(), m: isInt(o.now) && o.now >= 0 ? o.now : 0,
      name: C.cleanName(src.name) || o.name || "Untitled", w: src.w, h: src.h, layers: [], gd: src.gd
    };
    (Array.isArray(src.layers) ? src.layers : []).slice(0, C.MAX_LAYERS * 2).forEach(function (L) {
      if (!L || typeof L !== "object") return;
      var n = {};
      Object.keys(L).forEach(function (k) { if (k !== "px" && k !== "mk" && k !== "t") n[k] = L[k]; });
      n.id = fresh();
      if (n.k === "raster") { n.t = {}; take(L.px, n.id); }
      if (L.mk && typeof L.mk === "object") {
        n.mk = { id: fresh(), t: {}, on: L.mk.on, bg: L.mk.bg };
        take(L.mk.px, n.mk.id);
      }
      raw.layers.push(n);
    });
    if (Array.isArray(src.sels)) {
      raw.sels = src.sels.slice(0, C.MAX_SELS).filter(function (v) { return v && typeof v === "object"; }).map(function (v) {
        var id = fresh();
        take(v.px, id);
        return { id: id, name: v.name, t: {}, x: v.x, y: v.y };
      });
    }
    var doc = C.normDoc(raw);
    if (!doc) throw new Error("notpackage");
    var live = {};
    C.tileOwners(doc).forEach(function (w) { live[w.id] = 1; });
    return { doc: doc, pieces: pieces.filter(function (p) { return live[p.sid]; }) };
  }

  var API = { KIND: KIND, VER: VER, MIME: MIME, build: build, parse: parse,
              encodePng: encodePng, decodePng: decodePng, normPx: normPx };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  else { root.PhotoLab = root.PhotoLab || {}; root.PhotoLab.pkg = API; }
})(typeof window !== "undefined" ? window : this);
