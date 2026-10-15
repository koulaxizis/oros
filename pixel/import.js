// ============================================================
// orOS Pixel Avatar — import.js ("Open a sprite or a palette", v1.0.0)
// Reads a file made in another pixel-art app and turns it into a face
// for the desk. Pure: no DOM, no storage; pixel.js runs the picker,
// the preview, the one change of the desk face and the Undo.
//
// Sources (detected from the bytes, then the file name):
//   aseprite  Aseprite .aseprite / .ase (binary, documented format):
//             frames (0xF1FA) with layer (0x2004), cel (0x2005: raw,
//             linked, zlib; tilemaps are skipped) and palette chunks
//             (0x2019, old 0x0004 / 0x0011). RGBA, grayscale or
//             indexed. Layers are flattened per frame: hidden layers
//             (or in a hidden group) are left out, layer and cel
//             opacity are applied, blend modes become "normal".
//   piskel    Piskel .piskel (JSON, modelVersion 2: each layer a JSON
//             string with chunks[] = { layout, base64PNG } sprite
//             sheets; version 1: one horizontal strip per layer). The
//             PNGs are decoded by the browser (pixel.js), the frames
//             are put together here.
//   gpl       GIMP palette (.gpl)      "GIMP Palette", "R G B name"
//   hex       Lospec .hex              one rrggbb per line
//   paintnet  Paint.NET palette (.txt) ";" comments, AARRGGBB
//   jasc      JASC / Paint Shop Pro .pal  "JASC-PAL", "0100", count
//   asef      Adobe swatch exchange .ase  "ASEF" (RGB, CMYK, Gray)
//
// Pixel Avatar has one picture of 8×8, 12×12 or 16×16 in 8 colours,
// no frames, no layers. So a sprite becomes ONE frame (the preview
// picks which), cropped to what is drawn when it is bigger than 16,
// scaled down when still bigger (details kept: see toFace), centred, and its
// colours reduced to 8 (7 + see-through when it has transparency):
// toFace(). A palette gives the face its first 8 colours: paletteColors().
//
// detect(name, bytes) → kind | null
// parseAseprite(bytes, { inflate }) → Promise<{ source, w, h, frames:
//   [{ dur, cels }], layers: [{ name, vis, op }], palette: [hex],
//   skipped: { tilemaps, blends, frames } }>; frameRgba(doc, i) →
//   { w, h, data } (the layers of frame i flattened)
// parsePiskel(text) → { source, name, w, h, fps, count, layers: [{ name,
//   op, vis, chunks: [{ layout, png }] }] }; piskelFrame(doc, sheets, i)
//   → { w, h, data }, sheets[layer][chunk] = decoded { w, h, data }
// parsePalette(bytes, kind) → { source, colors: [hex] } | null
// toFace(img, opts) → { n, px, c, b, crop, scaled, colors, reduced } | null
// Errors: Error("bad") damaged / unknown, Error("big") over the caps.
//
// UMD: module.exports in Node (tests), window.OrosPixelImport in the app.
// ============================================================
(function (root) {
  "use strict";

  var MAX_FILE = 20 * 1024 * 1024;
  var MAX_SIDE = 1024, MAX_FRAMES = 256, MAX_LAYERS = 256, MAX_CHUNKS = 4096;
  var MAX_COLORS = 4096, MAX_NAME = 40;
  var SIZES = [8, 12, 16];
  var ACCEPT = ".aseprite,.ase,.piskel,.gpl,.hex,.txt,.pal";
  // Free slots of a palette that has fewer than 8 colours.
  var FILL = ["#000000", "#ffffff", "#808080", "#c0c0c0", "#404040", "#ff0000", "#00a000", "#0000ff", "#ffff00", "#ff00ff"];

  function hex2(v) { return ("0" + Math.max(0, Math.min(255, Math.round(v))).toString(16)).slice(-2); }
  function rgbHex(r, g, b) { return "#" + hex2(r) + hex2(g) + hex2(b); }
  function cleanName(s) { return String(s == null ? "" : s).replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, MAX_NAME); }
  function utf8(bytes) {
    if (typeof TextDecoder !== "undefined") return new TextDecoder("utf-8").decode(bytes);
    return Buffer.from(bytes).toString("utf8");
  }
  function textOf(bytes) {
    if (typeof bytes === "string") return bytes.replace(/^﻿/, "");
    return utf8(bytes).replace(/^﻿/, "");
  }

  // ---------- Detect ----------
  function u16(b, o) { return b[o] | (b[o + 1] << 8); }
  function detect(name, bytes) {
    var n = String(name || "").toLowerCase();
    if (!bytes || !bytes.length) return null;
    if (bytes.length >= 4 && bytes[0] === 0x41 && bytes[1] === 0x53 && bytes[2] === 0x45 && bytes[3] === 0x46) return "asef";
    if (bytes.length >= 128 && u16(bytes, 4) === 0xA5E0) return "aseprite";
    var head = textOf(bytes.subarray ? bytes.subarray(0, 4096) : bytes).replace(/^\s+/, "");
    if (/^GIMP Palette/i.test(head)) return "gpl";
    if (/^JASC-PAL/i.test(head)) return "jasc";
    if (head.charAt(0) === "{" && (/\.piskel$/.test(n) || /"piskel"\s*:/.test(head))) return "piskel";
    var lines = head.split(/\r?\n/).map(function (l) { return l.trim(); }).filter(function (l) { return l && !/^;/.test(l); });
    if (!lines.length) return null;
    if (lines.every(function (l) { return /^#?[0-9a-f]{8}$/i.test(l); })) return "paintnet";
    if (lines.every(function (l) { return /^#?[0-9a-f]{6}$/i.test(l); })) return /^;/m.test(head) ? "paintnet" : "hex";
    return null;
  }

  // ---------- Aseprite ----------
  // A little-endian reader over a Uint8Array; out of range → "bad".
  function Reader(b, p, end) { this.b = b; this.p = p || 0; this.end = end == null ? b.length : end; }
  Reader.prototype.need = function (n) { if (n < 0 || this.p + n > this.end) throw new Error("bad"); };
  Reader.prototype.u8 = function () { this.need(1); return this.b[this.p++]; };
  Reader.prototype.u16 = function () { this.need(2); var v = this.b[this.p] | (this.b[this.p + 1] << 8); this.p += 2; return v; };
  Reader.prototype.s16 = function () { var v = this.u16(); return v > 32767 ? v - 65536 : v; };
  Reader.prototype.u32 = function () { this.need(4); var b = this.b, p = this.p; this.p += 4; return (b[p] | (b[p + 1] << 8) | (b[p + 2] << 16)) + b[p + 3] * 16777216; };
  Reader.prototype.skip = function (n) { this.need(n); this.p += n; };
  Reader.prototype.bytes = function (n) { this.need(n); var o = this.b.subarray(this.p, this.p + n); this.p += n; return o; };
  Reader.prototype.str = function () { var n = this.u16(); return utf8(this.bytes(n)); };

  // zlib data → Promise<Uint8Array>: Node's zlib in tests, the
  // browser's DecompressionStream("deflate") (zlib format) in the app.
  function defaultInflate(data, size) {
    if (typeof module !== "undefined" && module.exports && typeof require === "function") {
      try { return Promise.resolve(new Uint8Array(require("zlib").inflateSync(data, { maxOutputLength: size + 1 }))); }
      catch (e) { return Promise.reject(new Error("bad")); }
    }
    if (typeof DecompressionStream !== "function") return Promise.reject(new Error("zip"));
    var out = new Uint8Array(size), at = 0;
    var reader = new Blob([data]).stream().pipeThrough(new DecompressionStream("deflate")).getReader();
    function pump() {
      return reader.read().then(function (r) {
        if (r.done) return out.subarray(0, at);
        if (at + r.value.length > size) { try { reader.cancel(); } catch (e) {} throw new Error("bad"); }
        out.set(r.value, at); at += r.value.length;
        return pump();
      });
    }
    return pump().catch(function () { throw new Error("bad"); });
  }

  // Raw cel pixels (in the file's colour depth) → RGBA.
  function celRgba(raw, w, h, depth, pal, tIndex) {
    var bpp = depth / 8, n = w * h, out = new Uint8ClampedArray(n * 4);
    if (raw.length < n * bpp) throw new Error("bad");
    for (var i = 0; i < n; i++) {
      var o = i * 4;
      if (depth === 32) { out[o] = raw[i * 4]; out[o + 1] = raw[i * 4 + 1]; out[o + 2] = raw[i * 4 + 2]; out[o + 3] = raw[i * 4 + 3]; }
      else if (depth === 16) { out[o] = out[o + 1] = out[o + 2] = raw[i * 2]; out[o + 3] = raw[i * 2 + 1]; }
      else {
        var k = raw[i], c = pal[k];
        if (k === tIndex || !c) continue;            // see-through
        out[o] = c[0]; out[o + 1] = c[1]; out[o + 2] = c[2]; out[o + 3] = c[3];
      }
    }
    return out;
  }

  function parseAseprite(bytes, opts) {
    var inflate = (opts && opts.inflate) || defaultInflate;
    try {
      var R = new Reader(bytes);
      R.u32();
      if (R.u16() !== 0xA5E0) throw new Error("bad");
      var nFrames = R.u16(), w = R.u16(), h = R.u16(), depth = R.u16(), flags = R.u32();
      R.skip(2 + 4 + 4);
      var tIndex = R.u8();
      R.p = 128;
      if (depth !== 32 && depth !== 16 && depth !== 8) throw new Error("bad");
      if (!w || !h || !nFrames) throw new Error("bad");
      if (w > MAX_SIDE || h > MAX_SIDE) throw new Error("big");
      var layerOpacity = (flags & 1) === 1;
      var pal = [], layers = [], frames = [], pending = [];
      var skipped = { tilemaps: 0, blends: 0, frames: Math.max(0, nFrames - MAX_FRAMES) };
      var parents = [];                               // visible flag per child level
      var newPal = false;
      for (var f = 0; f < Math.min(nFrames, MAX_FRAMES); f++) {
        var fStart = R.p, fSize = R.u32();
        if (R.u16() !== 0xF1FA || fSize < 16) throw new Error("bad");
        var oldCount = R.u16(), dur = R.u16();
        R.skip(2);
        var newCount = R.u32(), count = newCount || oldCount, fEnd = fStart + fSize;
        if (fEnd > bytes.length || count > MAX_CHUNKS) throw new Error("bad");
        var frame = { dur: dur || 100, cels: [] };
        frames.push(frame);
        for (var c = 0; c < count; c++) {
          var cStart = R.p, cSize = R.u32(), type = R.u16(), cEnd = cStart + cSize;
          if (cSize < 6 || cEnd > fEnd) throw new Error("bad");
          var C = new Reader(bytes, R.p, cEnd);
          if (type === 0x2019) {                      // palette
            newPal = true;
            var size = C.u32(), first = C.u32(), last = C.u32();
            C.skip(8);
            if (size > 65536 || last < first || last - first > 65535) throw new Error("bad");
            for (var k = first; k <= last; k++) {
              var pf = C.u16(), col = [C.u8(), C.u8(), C.u8(), C.u8()];
              if (pf & 1) C.str();
              pal[k] = col;
            }
          } else if (type === 0x0004 || type === 0x0011) {
            if (newPal) { R.p = cEnd; continue; }     // old palette: only when there is no new one
            var packets = C.u16(), at = 0, six = type === 0x0011;
            for (var q = 0; q < packets; q++) {
              at += C.u8();
              var nc = C.u8() || 256;
              for (var j = 0; j < nc; j++, at++) {
                var r = C.u8(), g = C.u8(), b = C.u8();
                if (six) { r = r * 255 / 63; g = g * 255 / 63; b = b * 255 / 63; }
                if (at < 256) pal[at] = [Math.round(r), Math.round(g), Math.round(b), 255];
              }
            }
          } else if (type === 0x2004) {               // layer
            if (layers.length >= MAX_LAYERS) throw new Error("big");
            var lf = C.u16(), lt = C.u16(), level = C.u16();
            C.skip(4);
            var blend = C.u16(), lop = C.u8();
            C.skip(3);
            var name = cleanName(C.str());
            var vis = (lf & 1) === 1 && (level === 0 || parents[level - 1] !== false);
            parents[level] = vis;
            parents.length = level + 1;
            if (blend && lt === 0) skipped.blends++;
            layers.push({ name: name || "Layer " + (layers.length + 1), vis: vis ? 1 : 0, op: layerOpacity ? lop : 255, group: lt === 1, tiles: lt === 2 });
          } else if (type === 0x2005) {               // cel
            var li = C.u16(), cx = C.s16(), cy = C.s16(), cop = C.u8(), ct = C.u16();
            C.skip(2 + 5);
            if (ct === 1) { frame.cels.push({ layer: li, link: C.u16() }); }
            else if (ct === 0 || ct === 2) {
              var cw = C.u16(), ch = C.u16();
              if (cw > MAX_SIDE * 2 || ch > MAX_SIDE * 2) throw new Error("big");
              var need = cw * ch * depth / 8;
              var cel = { layer: li, x: cx, y: cy, op: cop, w: cw, h: ch, data: null };
              frame.cels.push(cel);
              if (!cw || !ch) { cel.data = new Uint8ClampedArray(0); }
              else if (ct === 0) { cel.raw = C.bytes(need); }
              else pending.push({ cel: cel, z: C.bytes(cEnd - C.p), size: need });
            } else skipped.tilemaps++;               // 3: tilemap
          }
          R.p = cEnd;
        }
        R.p = fEnd;
      }
    } catch (e) { return Promise.reject(new Error(e && e.message === "big" ? "big" : "bad")); }

    var chain = Promise.resolve();
    pending.forEach(function (p) {
      chain = chain.then(function () {
        return inflate(p.z, p.size).then(function (raw) {
          if (raw.length < p.size) throw new Error("bad");
          p.cel.raw = raw;
        });
      });
    });
    return chain.then(function () {
      frames.forEach(function (fr) {
        fr.cels.forEach(function (cel) {
          if (cel.raw) { cel.data = celRgba(cel.raw, cel.w, cel.h, depth, pal, depth === 8 ? tIndex : -1); delete cel.raw; }
        });
      });
      var palette = [];
      pal.forEach(function (c) { if (c && palette.length < 256) palette.push(rgbHex(c[0], c[1], c[2])); });
      return { source: "aseprite", w: w, h: h, frames: frames, layers: layers, palette: palette, skipped: skipped };
    }).catch(function (e) { throw new Error(e && e.message === "zip" ? "zip" : "bad"); });
  }

  // Straight alpha "over": src pixel (with an extra opacity 0–1) on dst.
  function over(dst, o, r, g, b, a) {
    if (a <= 0) return;
    var da = dst[o + 3] / 255, oa = a + da * (1 - a);
    if (oa <= 0) return;
    dst[o] = (r * a + dst[o] * da * (1 - a)) / oa;
    dst[o + 1] = (g * a + dst[o + 1] * da * (1 - a)) / oa;
    dst[o + 2] = (b * a + dst[o + 2] * da * (1 - a)) / oa;
    dst[o + 3] = oa * 255;
  }
  function blit(out, W, H, src, sw, sh, x0, y0, k) {
    for (var y = 0; y < sh; y++) {
      var ty = y + y0;
      if (ty < 0 || ty >= H) continue;
      for (var x = 0; x < sw; x++) {
        var tx = x + x0;
        if (tx < 0 || tx >= W) continue;
        var s = (y * sw + x) * 4;
        over(out, (ty * W + tx) * 4, src[s], src[s + 1], src[s + 2], src[s + 3] / 255 * k);
      }
    }
  }

  function frameRgba(doc, i) {
    var W = doc.w, H = doc.h, out = new Uint8ClampedArray(W * H * 4);
    var fr = doc.frames[i];
    if (!fr) return { w: W, h: H, data: out };
    var cels = fr.cels.map(function (c) {
      if (c.link == null) return c;
      var tgt = doc.frames[c.link], hit = null;
      if (tgt) tgt.cels.forEach(function (x) { if (x.layer === c.layer && x.link == null) hit = x; });
      return hit;
    }).filter(function (c) { return c && c.data; });
    cels.sort(function (a, b) { return a.layer - b.layer; });
    cels.forEach(function (c) {
      var L = doc.layers[c.layer];
      if (!L || !L.vis || L.group) return;
      blit(out, W, H, c.data, c.w, c.h, c.x, c.y, (c.op / 255) * (L.op / 255));
    });
    return { w: W, h: H, data: out };
  }

  // ---------- Piskel ----------
  function b64(s) {
    s = String(s || "").replace(/^data:[^,]*,/, "").replace(/\s+/g, "");
    if (typeof atob === "function") {
      var bin = atob(s), out = new Uint8Array(bin.length);
      for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
      return out;
    }
    return new Uint8Array(Buffer.from(s, "base64"));
  }
  function parsePiskel(text) {
    var j;
    try { j = JSON.parse(textOf(text)); } catch (e) { throw new Error("bad"); }
    var p = j && j.piskel;
    if (!p || !Array.isArray(p.layers)) throw new Error("bad");
    var w = Math.round(+p.width), h = Math.round(+p.height);
    if (!(w > 0 && h > 0)) throw new Error("bad");
    if (w > MAX_SIDE || h > MAX_SIDE) throw new Error("big");
    if (p.layers.length > MAX_LAYERS) throw new Error("big");
    var count = 0;
    var layers = p.layers.map(function (raw, li) {
      var L = raw;
      if (typeof raw === "string") { try { L = JSON.parse(raw); } catch (e) { throw new Error("bad"); } }
      if (!L || typeof L !== "object") throw new Error("bad");
      var fc = Math.max(0, Math.min(MAX_FRAMES, Math.round(+L.frameCount) || 0));
      var chunks = [];
      if (Array.isArray(L.chunks)) {
        L.chunks.slice(0, 64).forEach(function (ch) {
          if (!ch || typeof ch.base64PNG !== "string" || !Array.isArray(ch.layout)) return;
          chunks.push({ layout: ch.layout, png: b64(ch.base64PNG) });
        });
      } else if (typeof L.base64PNG === "string") {    // modelVersion 1: one strip
        var lay = [];
        for (var k = 0; k < fc; k++) lay.push([k]);
        chunks.push({ layout: lay, png: b64(L.base64PNG) });
      }
      count = Math.max(count, fc);
      var op = L.opacity == null ? 1 : Math.max(0, Math.min(1, +L.opacity || 0));
      return { name: cleanName(L.name) || "Layer " + (li + 1), op: op, vis: L.hidden || L.visible === false ? 0 : 1, chunks: chunks };
    });
    if (!count) throw new Error("bad");
    var fps = Math.max(1, Math.min(60, Math.round(+p.fps) || 12));
    return { source: "piskel", name: cleanName(p.name), w: w, h: h, fps: fps, count: count, layers: layers };
  }
  // Frame i: every visible layer's cell of frame i, bottom (first
  // in the file) to top. layout[col][row] = frame index.
  function piskelFrame(doc, sheets, i) {
    var W = doc.w, H = doc.h, out = new Uint8ClampedArray(W * H * 4);
    doc.layers.forEach(function (L, li) {
      if (!L.vis || !L.op) return;
      L.chunks.forEach(function (ch, ci) {
        var sh = sheets && sheets[li] && sheets[li][ci];
        if (!sh) return;
        for (var col = 0; col < ch.layout.length; col++) {
          var rows = ch.layout[col];
          if (!Array.isArray(rows)) continue;
          for (var row = 0; row < rows.length; row++) {
            if (rows[row] !== i) continue;
            var x0 = col * W, y0 = row * H;
            for (var y = 0; y < H; y++) {
              if (y0 + y >= sh.h) break;
              for (var x = 0; x < W; x++) {
                if (x0 + x >= sh.w) break;
                var s = ((y0 + y) * sh.w + x0 + x) * 4;
                over(out, (y * W + x) * 4, sh.data[s], sh.data[s + 1], sh.data[s + 2], sh.data[s + 3] / 255 * L.op);
              }
            }
          }
        }
      });
    });
    return { w: W, h: H, data: out };
  }

  // ---------- Palettes ----------
  function floats(dv, q, end) {
    return function (k) { return q + k * 4 + 4 <= end ? dv.getFloat32(q + k * 4) : 0; };
  }
  function readAsef(bytes) {
    var dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), p = 12, out = [];
    if (bytes.length < 12) throw new Error("bad");
    var n = dv.getUint32(8);
    for (var i = 0; i < n && p + 6 <= bytes.length && out.length < MAX_COLORS; i++) {
      var type = dv.getUint16(p), len = dv.getUint32(p + 2), q = p + 6, end = q + len;
      if (end > bytes.length) break;
      if (type === 1 && len >= 2) {
        var nl = dv.getUint16(q);
        q += 2 + nl * 2;
        if (q + 4 > end) { p = end; continue; }
        var model = String.fromCharCode(bytes[q], bytes[q + 1], bytes[q + 2], bytes[q + 3]);
        q += 4;
        var fl = floats(dv, q, end);
        if (model === "RGB ") out.push(rgbHex(fl(0) * 255, fl(1) * 255, fl(2) * 255));
        else if (model === "CMYK") {
          var k = fl(3);
          out.push(rgbHex(255 * (1 - fl(0)) * (1 - k), 255 * (1 - fl(1)) * (1 - k), 255 * (1 - fl(2)) * (1 - k)));
        } else if (model === "Gray") out.push(rgbHex(fl(0) * 255, fl(0) * 255, fl(0) * 255));
        // LAB is left out
      }
      p = end;
    }
    return out;
  }
  function parsePalette(bytes, kind) {
    var colors = [];
    if (kind === "asef") colors = readAsef(bytes);
    else {
      var lines = textOf(bytes).split(/\r?\n/), m;
      lines.forEach(function (l, i) {
        if (colors.length >= MAX_COLORS) return;
        l = l.trim();
        if (!l) return;
        if (kind === "gpl") {
          if (/^(GIMP Palette|Name:|Columns:|#)/i.test(l)) return;
          m = /^(\d{1,3})\s+(\d{1,3})\s+(\d{1,3})/.exec(l);
          if (m) colors.push(rgbHex(+m[1], +m[2], +m[3]));
        } else if (kind === "jasc") {
          if (i < 3) return;                         // JASC-PAL, 0100, count
          m = /^(\d{1,3})\s+(\d{1,3})\s+(\d{1,3})/.exec(l);
          if (m) colors.push(rgbHex(+m[1], +m[2], +m[3]));
        } else if (kind === "paintnet" || kind === "hex") {
          if (/^;/.test(l)) return;
          m = /^#?([0-9a-f]{2})?([0-9a-f]{6})$/i.exec(l);
          if (m) colors.push("#" + m[2].toLowerCase());   // the alpha of AARRGGBB is left out
        }
      });
    }
    if (!colors.length) return null;
    return { source: kind, colors: colors };
  }
  // The first 8 different colours; fewer → the face's own fill the rest.
  function paletteColors(colors, current) {
    var out = [];
    colors.forEach(function (c) { if (out.length < 8 && out.indexOf(c) < 0) out.push(c); });
    var used = out.length;
    (current || []).concat(FILL).forEach(function (c) { if (out.length < 8 && out.indexOf(c) < 0) out.push(c); });
    return { c: out, used: used };
  }

  // ---------- Sprite → face ----------
  function dist2(a, b) {
    var dr = (a >> 16 & 255) - (b >> 16 & 255), dg = (a >> 8 & 255) - (b >> 8 & 255), db = (a & 255) - (b & 255);
    return dr * dr * 2 + dg * dg * 4 + db * db * 3;
  }
  // Up to k colours for a { colour: count } map: the k most used when
  // they fit, else a weighted k-means started from far-apart, often
  // used colours. Deterministic. → [colour int] most used first.
  function reduce(counts, k) {
    var list = Object.keys(counts).map(Number).sort(function (a, b) { return counts[b] - counts[a] || a - b; });
    if (list.length <= k) return list;
    var cent = [list[0]];
    while (cent.length < k) {
      var best = -1, bestS = -1;
      list.forEach(function (c) {
        var d = Infinity;
        cent.forEach(function (x) { d = Math.min(d, dist2(c, x)); });
        var s = d * counts[c];
        if (s > bestS) { bestS = s; best = c; }
      });
      if (bestS <= 0) break;
      cent.push(best);
    }
    for (var it = 0; it < 8; it++) {
      var acc = cent.map(function () { return [0, 0, 0, 0]; });
      list.forEach(function (c) {
        var bi = 0, bd = Infinity;
        cent.forEach(function (x, i) { var d = dist2(c, x); if (d < bd) { bd = d; bi = i; } });
        var w = counts[c], a = acc[bi];
        a[0] += (c >> 16 & 255) * w; a[1] += (c >> 8 & 255) * w; a[2] += (c & 255) * w; a[3] += w;
      });
      cent = cent.map(function (x, i) {
        var a = acc[i];
        return a[3] ? (Math.round(a[0] / a[3]) << 16) | (Math.round(a[1] / a[3]) << 8) | Math.round(a[2] / a[3]) : x;
      });
    }
    return cent;
  }

  function toFace(img, opts) {
    if (!img || !(img.w > 0) || !(img.h > 0)) return null;
    var W = img.w, H = img.h, d = img.data;
    function op(x, y) { return d[(y * W + x) * 4 + 3] >= 128; }
    var x0 = 0, y0 = 0, x1 = W - 1, y1 = H - 1, crop = false;
    var bx0 = W, by0 = H, bx1 = -1, by1 = -1, x, y;
    for (y = 0; y < H; y++) for (x = 0; x < W; x++) if (op(x, y)) {
      if (x < bx0) bx0 = x; if (x > bx1) bx1 = x; if (y < by0) by0 = y; if (y > by1) by1 = y;
    }
    if (bx1 < 0) return null;                          // nothing drawn
    if (Math.max(W, H) > 16) { x0 = bx0; y0 = by0; x1 = bx1; y1 = by1; crop = x1 - x0 + 1 < W || y1 - y0 + 1 < H; }
    var sw = x1 - x0 + 1, sh = y1 - y0 + 1, big = Math.max(sw, sh);
    var n = 16;
    for (var s = 0; s < SIZES.length; s++) if (SIZES[s] >= big) { n = SIZES[s]; break; }
    var k = big > 16 ? 16 / big : 1;
    var tw = Math.max(1, Math.round(sw * k)), th = Math.max(1, Math.round(sh * k));
    var ox = Math.floor((n - tw) / 2), oy = Math.floor((n - th) / 2);
    function rgb(o) { return (d[o] << 16) | (d[o + 1] << 8) | d[o + 2]; }
    // Scaling down: each face pixel covers a block of the sprite. Small
    // details (eyes, outlines) use rarer colours than the fills around
    // them, so the block's least used colour (in the whole drawing)
    // wins; a block mostly see-through stays see-through.
    var all = {};
    if (k < 1) for (y = y0; y <= y1; y++) for (x = x0; x <= x1; x++) {
      var o0 = (y * W + x) * 4;
      if (d[o0 + 3] >= 128) { var v0 = rgb(o0); all[v0] = (all[v0] || 0) + 1; }
    }
    function block(tx, ty) {
      var sx0 = Math.floor(tx / k), sx1 = Math.max(sx0 + 1, Math.min(sw, Math.floor((tx + 1) / k)));
      var sy0 = Math.floor(ty / k), sy1 = Math.max(sy0 + 1, Math.min(sh, Math.floor((ty + 1) / k)));
      var seen = 0, holes = 0, best = -1;
      for (var by = sy0; by < sy1; by++) for (var bx = sx0; bx < sx1; bx++) {
        var o = ((y0 + by) * W + x0 + bx) * 4;
        seen++;
        if (d[o + 3] < 128) { holes++; continue; }
        var v = rgb(o);
        if (best < 0 || all[v] < all[best] || (all[v] === all[best] && v < best)) best = v;
      }
      return holes * 2 > seen ? -1 : best;
    }
    var cells = [], counts = {}, clear = false;
    for (y = 0; y < n; y++) for (x = 0; x < n; x++) {
      var tx = x - ox, ty = y - oy, v = -1;
      if (tx >= 0 && ty >= 0 && tx < tw && ty < th) {
        if (k < 1) v = block(tx, ty);
        else {
          var o = ((y0 + ty) * W + x0 + tx) * 4;
          if (d[o + 3] >= 128) v = rgb(o);
        }
      }
      if (v < 0) clear = true; else counts[v] = (counts[v] || 0) + 1;
      cells.push(v);
    }
    var distinct = Object.keys(counts).length;
    var slots = clear ? 7 : 8, pal = reduce(counts, slots);
    var map = {}, px = "";
    cells.forEach(function (v) {
      if (v < 0) { px += "0"; return; }
      if (!(v in map)) {
        var bi = 0, bd = Infinity;
        pal.forEach(function (c, i) { var dd = dist2(v, c); if (dd < bd) { bd = dd; bi = i; } });
        map[v] = bi + (clear ? 1 : 0);
      }
      px += map[v];
    });
    var c = clear ? ["#ffffff"] : [];
    pal.forEach(function (v) { c.push(rgbHex(v >> 16 & 255, v >> 8 & 255, v & 255)); });
    FILL.forEach(function (h) { if (c.length < 8 && c.indexOf(h) < 0) c.push(h); });
    return { n: n, px: px, c: c, b: clear ? 1 : 0, crop: crop, scaled: k < 1, colors: distinct, reduced: distinct > slots, w: sw, h: sh };
  }

  function baseName(name) {
    return cleanName(String(name || "").replace(/^.*[\\/]/, "").replace(/\.[a-z0-9]{1,9}$/i, "")) || "import";
  }

  var API = {
    MAX_FILE: MAX_FILE, ACCEPT: ACCEPT, SIZES: SIZES,
    detect: detect, parseAseprite: parseAseprite, frameRgba: frameRgba,
    parsePiskel: parsePiskel, piskelFrame: piskelFrame, b64: b64,
    parsePalette: parsePalette, paletteColors: paletteColors,
    toFace: toFace, reduce: reduce, baseName: baseName
  };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  else root.OrosPixelImport = API;
})(typeof window !== "undefined" ? window : this);
