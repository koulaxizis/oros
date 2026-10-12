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
// UMD: module.exports in Node (tests), window.PhotoLab.ora in the app.
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

  var API = { read: read, write: write, parseStack: parseStack, zip: zip, crc32: crc32, OPS: OPS, MIME: MIME };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  else { root.PhotoLab = root.PhotoLab || {}; root.PhotoLab.ora = API; }
})(typeof window !== "undefined" ? window : this);
