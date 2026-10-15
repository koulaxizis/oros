// ============================================================
// orOS Photo Lab — ora.js: OpenRaster (.ora) reader + writer (no DOM)
// OpenRaster is the layered format of GIMP, Krita and MyPaint: a ZIP
// with "mimetype" (stored first), stack.xml (layers, top first),
// one PNG per layer, mergedimage.png and Thumbnails/thumbnail.png.
// Reading uses the shared ZIP reader (atelier/zip.js, passed in);
// the PNGs are decoded by the caller (the browser), so this file only
// deals with the stack and the container. Groups are flattened into
// the layer list: a hidden group hides its layers, its opacity
// multiplies theirs. Text in stack.xml is data only (never markup).
//
// read(bytes, Zip, o) → Promise<{ w, h, layers: [{ name, x, y, op, bl,
//   vis, png }] (bottom → top), merged: png | null, skipped: { groups,
//   missing } }>; png = Uint8Array. Rejects with Error("ora").
// write({ w, h, layers: [{ name, x, y, op, bl, vis, png }], merged,
//   thumb }) → Uint8Array (stored ZIP, layers bottom → top).
// parseStack(xml) and zip(entries) are exposed for the tests.
//
// Krita .kra is a ZIP too, but not OpenRaster: maindoc.xml lists the
// layers (top first, groups nested in <layers>), each paint layer's
// pixels are in "<image name>/layers/<filename>" as Krita's tiled
// format (64×64 tiles, LZF, channel planes, BGRA). readKra() decodes
// 8-bit RGBA paint layers itself (no PNG in between); a file with
// anything it can't read (16-bit / float / CMYK / grey colour spaces,
// an old tile version, over the size limit) opens as one layer from
// mergedimage.png instead, with skipped.flat set so the app says so
// (damaged layer data too, when the file has a merged picture).
// Vector, file, clone, filter and fill layers and masks are left out
// (counted).
// readKra(bytes, Zip, o) → Promise<{ w, h, layers: [{ name, x, y, op,
//   bl, vis, img: { w, h, data } }], merged: png | null, skipped:
//   { groups, other (left-out layers and masks), flat } }>; o.maxPixels
//   caps the layers.
//   Rejects with Error("ora"). parseKraDoc(xml), kraTiles(bytes, o)
//   and lzf(src, out) are exposed for the tests.
//
// UMD: module.exports in Node (tests), window.PhotoLab.ora (and
// window.OrosOra) in the app.
// ============================================================
(function (root) {
  "use strict";

  var MIME = "image/openraster";
  var MAX_LAYERS = 1000, MAX_DEPTH = 32;
  var MAX_XML = 4 * 1024 * 1024, MAX_PNG = 200 * 1024 * 1024;

  // composite-op ⇄ Photo Lab blend ids (core.js BLENDS).
  var OPS = {
    "svg:src-over": "normal", "svg:multiply": "multiply", "svg:screen": "screen",
    "svg:overlay": "overlay", "svg:darken": "darken", "svg:lighten": "lighten",
    "svg:color-dodge": "dodge", "svg:color-burn": "burn", "svg:hard-light": "hard",
    "svg:soft-light": "soft", "svg:difference": "difference", "svg:exclusion": "exclusion",
    "krita:exclusion": "exclusion", "svg:hue": "hue", "svg:saturation": "saturation",
    "svg:color": "color", "svg:luminosity": "luminosity"
  };
  var OP_OF = {};
  Object.keys(OPS).forEach(function (k) { if (!OP_OF[OPS[k]]) OP_OF[OPS[k]] = k; });

  // ---------- stack.xml ----------
  function unescape(s) {
    return s.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, function (m, e) {
      var l = e.toLowerCase();
      if (l === "amp") return "&"; if (l === "lt") return "<"; if (l === "gt") return ">";
      if (l === "quot") return '"'; if (l === "apos") return "'";
      var n = l.charAt(1) === "x" ? parseInt(l.slice(2), 16) : parseInt(l.slice(1), 10);
      return n > 0 && n < 0x110000 ? String.fromCodePoint(n) : "";
    });
  }
  function attrs(s) {
    var o = {}, re = /([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g, m;
    while ((m = re.exec(s))) o[m[1]] = unescape(m[2] != null ? m[2] : m[3]);
    return o;
  }
  function num(v, d) { var n = parseFloat(v); return isFinite(n) ? n : d; }
  function cleanText(s) { return String(s || "").replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, 60); }

  // → { w, h, layers: [...] bottom → top, groups } ; throws Error("ora").
  function parseStack(xml) {
    var re = /<(\/?)(image|stack|layer)\b([^>]*?)(\/?)>/g, m;
    var w = 0, h = 0, out = [], groups = 0;
    var ctx = [{ vis: 1, op: 1, x: 0, y: 0 }];          // the enclosing stacks
    while ((m = re.exec(xml))) {
      var close = m[1] === "/", tag = m[2], a = attrs(m[3]), empty = m[4] === "/";
      if (tag === "image") { if (!close) { w = Math.round(num(a.w, 0)); h = Math.round(num(a.h, 0)); } continue; }
      var top = ctx[ctx.length - 1];
      if (tag === "stack") {
        if (close) { if (ctx.length > 1) ctx.pop(); continue; }
        if (ctx.length > 1 || out.length) groups++;
        if (ctx.length > MAX_DEPTH) throw new Error("ora");
        var g = { vis: top.vis && a.visibility !== "hidden" ? 1 : 0,
                  op: top.op * Math.max(0, Math.min(1, num(a.opacity, 1))),
                  x: top.x + Math.round(num(a.x, 0)), y: top.y + Math.round(num(a.y, 0)) };
        if (!empty) ctx.push(g);
        continue;
      }
      if (close) continue;
      if (out.length >= MAX_LAYERS) throw new Error("ora");
      var src = String(a.src || "");
      if (!src || /^\/|\.\.|^[a-z]+:/i.test(src)) continue;   // only paths inside the file
      out.push({
        name: cleanText(a.name) || "Layer", src: src,
        x: top.x + Math.round(num(a.x, 0)), y: top.y + Math.round(num(a.y, 0)),
        op: Math.round(top.op * Math.max(0, Math.min(1, num(a.opacity, 1))) * 100),
        bl: OPS[a["composite-op"]] || "normal",
        vis: top.vis && a.visibility !== "hidden" ? 1 : 0
      });
    }
    if (!w || !h) throw new Error("ora");
    return { w: w, h: h, layers: out.reverse(), groups: groups };
  }

  function read(bytes, Zip) {
    var z;
    try { z = Zip.open(bytes); } catch (e) { return Promise.reject(new Error("ora")); }
    if (!z.has("stack.xml")) return Promise.reject(new Error("ora"));
    return z.text("stack.xml", MAX_XML).then(function (xml) {
      var st = parseStack(xml), layers = [], missing = 0;
      var chain = Promise.resolve();
      st.layers.forEach(function (L) {
        chain = chain.then(function () {
          if (!z.has(L.src)) { missing++; return; }
          return z.bytes(L.src, MAX_PNG).then(function (png) {
            layers.push({ name: L.name, x: L.x, y: L.y, op: L.op, bl: L.bl, vis: L.vis, png: png });
          });
        });
      });
      return chain.then(function () {
        if (layers.length) return null;
        return z.has("mergedimage.png") ? z.bytes("mergedimage.png", MAX_PNG) : null;
      }).then(function (merged) {
        if (!layers.length && !merged) throw new Error("ora");
        return { w: st.w, h: st.h, layers: layers, merged: merged, skipped: { groups: st.groups, missing: missing } };
      });
    }).catch(function (e) { throw new Error(e && /^ora/.test(e.message) ? e.message : "ora"); });
  }

  // ---------- Krita .kra ----------
  // Krita compositeop ids → Photo Lab blend ids.
  var KOPS = {
    normal: "normal", multiply: "multiply", screen: "screen", overlay: "overlay", darken: "darken",
    lighten: "lighten", dodge: "dodge", burn: "burn", hard_light: "hard", soft_light: "soft",
    soft_light_svg: "soft", diff: "difference", exclusion: "exclusion", hue: "hue",
    saturation: "saturation", color: "color", luminize: "luminosity"
  };
  var KRA_TILE_MAX = 1 << 20;                        // tiles in one layer

  // maindoc.xml → { w, h, name, layers: [{ name, file, x, y, op, bl,
  // vis, cs }] bottom → top, groups, masks, other }. Throws Error("ora").
  function parseKraDoc(xml) {
    var re = /<(\/?)(IMAGE|layer|mask)\b([^>]*?)(\/?)>/g, m;
    var img = null, out = [], groups = 0, masks = 0, other = 0;
    var ctx = [{ vis: 1, op: 1 }], open = [];          // groups open around us
    while ((m = re.exec(xml))) {
      var close = m[1] === "/", tag = m[2], a = attrs(m[3]), empty = m[4] === "/";
      if (tag === "IMAGE") {
        if (!close && !img) img = { w: Math.round(num(a.width, 0)), h: Math.round(num(a.height, 0)), name: a.name || "" };
        continue;
      }
      if (tag === "mask") { if (!close) masks++; continue; }
      if (close) {                                    // </layer>: the end of a group
        if (open.length && open.pop()) ctx.pop();
        continue;
      }
      var top = ctx[ctx.length - 1];
      var vis = top.vis && a.visible !== "0" ? 1 : 0;
      var op = top.op * Math.max(0, Math.min(1, num(a.opacity, 255) / 255));
      var type = a.nodetype || "paintlayer";
      if (type === "grouplayer") {
        groups++;
        if (ctx.length > MAX_DEPTH) throw new Error("ora");
        if (!empty) { ctx.push({ vis: vis, op: op }); open.push(true); }
        continue;
      }
      if (!empty) open.push(false);                  // e.g. a layer with masks inside
      if (type !== "paintlayer") { other++; continue; }
      if (out.length >= MAX_LAYERS) throw new Error("ora");
      var file = String(a.filename || "");
      if (!file || /[\/\\]|\.\./.test(file)) { other++; continue; }
      out.push({ name: cleanText(a.name) || "Layer", file: file, x: Math.round(num(a.x, 0)), y: Math.round(num(a.y, 0)),
                 op: Math.round(op * 100), bl: KOPS[a.compositeop] || "normal", vis: vis,
                 cs: String(a.colorspacename || "RGBA") });
    }
    if (!img || !img.w || !img.h) throw new Error("ora");
    return { w: img.w, h: img.h, name: img.name, layers: out.reverse(), groups: groups, masks: masks, other: other };
  }

  // LZF (as Krita writes it) from src into out; → bytes written.
  function lzf(src, out) {
    var ip = 0, op = 0, end = src.length;
    while (ip < end) {
      var ctrl = src[ip++];
      if (ctrl < 32) {                                 // ctrl + 1 literal bytes
        ctrl++;
        if (op + ctrl > out.length || ip + ctrl > end) throw new Error("ora");
        while (ctrl--) out[op++] = src[ip++];
      } else {                                         // back reference
        var len = ctrl >> 5, ref = op - ((ctrl & 31) << 8) - 1;
        if (len === 7) { if (ip >= end) throw new Error("ora"); len += src[ip++]; }
        if (ip >= end) throw new Error("ora");
        ref -= src[ip++];
        len += 2;
        if (ref < 0 || op + len > out.length) throw new Error("ora");
        while (len--) out[op++] = out[ref++];
      }
    }
    return op;
  }

  // A layer's tiled data → { x, y, w, h, data } (RGBA, layer pixel
  // coordinates; w = 0 when empty). Only 8-bit RGBA (PIXELSIZE 4) —
  // anything else throws Error("kra-cs"); damaged data Error("ora").
  function kraTiles(bytes, o) {
    var maxPixels = (o && o.maxPixels) || 120e6, p = 0, head = {};
    function line() {
      var s = p;
      while (p < bytes.length && bytes[p] !== 10) p++;
      if (p >= bytes.length || p - s > 200) throw new Error("ora");
      var t = String.fromCharCode.apply(null, bytes.subarray(s, p));
      p++;
      return t;
    }
    for (var i = 0; i < 5; i++) {
      var kv = /^([A-Z]+) (\d+)$/.exec(line());
      if (!kv) throw new Error("ora");
      head[kv[1]] = +kv[2];
    }
    if (head.VERSION !== 2) throw new Error("kra-cs");
    var tw = head.TILEWIDTH, th = head.TILEHEIGHT, ps = head.PIXELSIZE, n = head.DATA;
    if (ps !== 4) throw new Error("kra-cs");
    if (!(tw > 0 && th > 0 && tw <= 1024 && th <= 1024) || n > KRA_TILE_MAX) throw new Error("ora");
    var tiles = [], x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (var k = 0; k < n; k++) {
      var hm = /^(-?\d+),(-?\d+),(\w+),(\d+)$/.exec(line());
      if (!hm || hm[3] !== "LZF") throw new Error("ora");
      var size = +hm[4];
      if (p + size > bytes.length || size < 1) throw new Error("ora");
      var t = { x: +hm[1], y: +hm[2], at: p, size: size };
      p += size;
      tiles.push(t);
      x0 = Math.min(x0, t.x); y0 = Math.min(y0, t.y);
      x1 = Math.max(x1, t.x + tw); y1 = Math.max(y1, t.y + th);
    }
    if (!tiles.length) return { x: 0, y: 0, w: 0, h: 0, data: new Uint8ClampedArray(0) };
    var W = x1 - x0, H = y1 - y0;
    if (W * H > maxPixels) throw new Error("kra-big");
    var out = new Uint8ClampedArray(W * H * 4), npx = tw * th, raw = new Uint8Array(npx * 4);
    tiles.forEach(function (t) {
      var flag = bytes[t.at], body = bytes.subarray(t.at + 1, t.at + t.size), inter;
      if (flag === 1) {                                // LZF of channel planes
        if (lzf(body, raw) !== npx * 4) throw new Error("ora");
        inter = false;
      } else if (flag === 0) {                         // stored, pixels as they are
        if (body.length < npx * 4) throw new Error("ora");
        raw.set(body.subarray(0, npx * 4));
        inter = true;
      } else throw new Error("ora");
      var ox = t.x - x0, oy = t.y - y0;
      for (var yy = 0; yy < th; yy++) {
        var row = ((oy + yy) * W + ox) * 4;
        for (var xx = 0; xx < tw; xx++) {
          var j = yy * tw + xx, d = row + xx * 4, b, g, r, a;
          if (inter) { b = raw[j * 4]; g = raw[j * 4 + 1]; r = raw[j * 4 + 2]; a = raw[j * 4 + 3]; }
          else { b = raw[j]; g = raw[npx + j]; r = raw[2 * npx + j]; a = raw[3 * npx + j]; }
          out[d] = r; out[d + 1] = g; out[d + 2] = b; out[d + 3] = a;
        }
      }
    });
    return { x: x0, y: y0, w: W, h: H, data: out };
  }

  function readKra(bytes, Zip, o) {
    var z, maxPixels = (o && o.maxPixels) || 120e6;
    try { z = Zip.open(bytes); } catch (e) { return Promise.reject(new Error("ora")); }
    if (!z.has("maindoc.xml")) return Promise.reject(new Error("ora"));
    function merged() { return z.has("mergedimage.png") ? z.bytes("mergedimage.png", MAX_PNG) : Promise.resolve(null); }
    return z.text("maindoc.xml", MAX_XML).then(function (xml) {
      var doc = parseKraDoc(xml), skipped = { groups: doc.groups, other: doc.other + doc.masks, flat: 0 };   // masks are left out
      var layers = [], total = 0, chain = Promise.resolve();
      function path(file) {
        var want = doc.name + "/layers/" + file;
        if (z.has(want)) return want;
        var hit = null;                                // a renamed folder: the one entry that ends so
        z.names.forEach(function (n) { if (!hit && n.slice(-(file.length + 8)) === "/layers/" + file) hit = n; });
        return hit;
      }
      doc.layers.forEach(function (L) {
        chain = chain.then(function () {
          if (!/^RGBA$/i.test(L.cs)) throw new Error("kra-cs");
          var at = path(L.file);
          if (!at) throw new Error("kra-cs");
          return z.bytes(at, MAX_PNG).then(function (b) {
            var t = kraTiles(b, { maxPixels: maxPixels - total });
            total += t.w * t.h;
            if (!t.w) return;                          // an empty layer
            layers.push({ name: L.name, x: L.x + t.x, y: L.y + t.y, op: L.op, bl: L.bl, vis: L.vis,
                          img: { w: t.w, h: t.h, data: t.data } });
          });
        });
      });
      return chain.then(function () {
        if (layers.length) return { w: doc.w, h: doc.h, layers: layers, merged: null, skipped: skipped };
        return merged().then(function (png) {
          if (!png) throw new Error("ora");
          return { w: doc.w, h: doc.h, layers: [], merged: png, skipped: skipped };
        });
      }, function (e) {
        // What we can't read layer by layer (or damaged layer data)
        // opens as the flat picture, when the file has one.
        return merged().then(function (png) {
          if (!png) throw new Error("ora");
          skipped.flat = 1;
          return { w: doc.w, h: doc.h, layers: [], merged: png, skipped: skipped };
        });
      });
    }).catch(function (e) { throw new Error("ora"); });
  }

  // ---------- Writing ----------
  var CRC = (function () {
    var t = new Uint32Array(256);
    for (var n = 0; n < 256; n++) {
      var c = n;
      for (var k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c >>> 0;
    }
    return t;
  })();
  function crc32(b) {
    var c = 0xffffffff;
    for (var i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 255] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  }
  function utf8(s) { return new TextEncoder().encode(s); }

  // A stored (uncompressed) ZIP; entries [{ name, data }] in order.
  // PNGs are compressed already, and OpenRaster wants "mimetype" stored.
  function zip(entries) {
    var parts = [], central = [], off = 0;
    function le(n, v) { var b = new Uint8Array(n); for (var i = 0; i < n; i++) b[i] = (v >>> (8 * i)) & 255; return b; }
    function cat(list) { var n = 0; list.forEach(function (b) { n += b.length; }); var o = new Uint8Array(n), p = 0; list.forEach(function (b) { o.set(b, p); p += b.length; }); return o; }
    entries.forEach(function (e) {
      var name = utf8(e.name), crc = crc32(e.data), size = e.data.length;
      var head = cat([le(4, 0x04034b50), le(2, 20), le(2, 0x0800), le(2, 0), le(2, 0), le(2, 0x21),
                      le(4, crc), le(4, size), le(4, size), le(2, name.length), le(2, 0), name]);
      central.push(cat([le(4, 0x02014b50), le(2, 20), le(2, 20), le(2, 0x0800), le(2, 0), le(2, 0), le(2, 0x21),
                        le(4, crc), le(4, size), le(4, size), le(2, name.length), le(2, 0), le(2, 0), le(2, 0),
                        le(2, 0), le(4, 0), le(4, off), name]));
      parts.push(head, e.data);
      off += head.length + size;
    });
    var cd = cat(central);
    var end = cat([le(4, 0x06054b50), le(2, 0), le(2, 0), le(2, entries.length), le(2, entries.length),
                   le(4, cd.length), le(4, off), le(2, 0)]);
    return cat(parts.concat([cd, end]));
  }

  function esc(s) {
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }
  function write(doc) {
    var list = doc.layers || [], lines = [];
    for (var i = list.length - 1; i >= 0; i--) {
      var L = list[i];
      lines.push('  <layer name="' + esc(L.name) + '" src="data/layer' + i + '.png" x="' + Math.round(L.x) +
                 '" y="' + Math.round(L.y) + '" opacity="' + (Math.max(0, Math.min(100, L.op == null ? 100 : L.op)) / 100) +
                 '" visibility="' + (L.vis === 0 ? "hidden" : "visible") +
                 '" composite-op="' + (OP_OF[L.bl] || "svg:src-over") + '"/>');
    }
    var xml = '<?xml version="1.0" encoding="UTF-8"?>\n<image version="0.0.6" w="' + doc.w + '" h="' + doc.h +
              '">\n <stack>\n' + lines.join("\n") + '\n </stack>\n</image>\n';
    var entries = [{ name: "mimetype", data: utf8(MIME) }, { name: "stack.xml", data: utf8(xml) }];
    list.forEach(function (L, j) { entries.push({ name: "data/layer" + j + ".png", data: L.png }); });
    if (doc.merged) entries.push({ name: "mergedimage.png", data: doc.merged });
    if (doc.thumb) entries.push({ name: "Thumbnails/thumbnail.png", data: doc.thumb });
    return zip(entries);
  }

  var API = { read: read, write: write, parseStack: parseStack, zip: zip, crc32: crc32, OPS: OPS, MIME: MIME,
              readKra: readKra, parseKraDoc: parseKraDoc, kraTiles: kraTiles, lzf: lzf, KOPS: KOPS };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  else { root.PhotoLab = root.PhotoLab || {}; root.PhotoLab.ora = API; root.OrosOra = API; }
})(typeof window !== "undefined" ? window : this);
