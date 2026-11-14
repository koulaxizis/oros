/* ============================================================
   orOS Transfer — generated artwork (TRANSFER-ART)
   Backgrounds drawn by code, never downloaded: four styles (dunes,
   orbits, prism, horizon) from a 32-bit seed and the skin's accent.
   The seed comes from the transfer's secret (sender and receiver
   hold the same one), so both sides see the same picture: a quick
   visual check that they are connected to each other. The relay
   never sees the secret, and 32 bits of a SHA-256 tell nothing
   usable about it.

   Output is a list of plain shape records; toNode() builds real SVG
   elements with createElementNS (no innerHTML), toString() writes
   escaped SVG text (tests, previews). Same seed + accent + size →
   the same shapes, byte for byte, in every browser.
   Used by: transfer/about/ (landing page); the app and the receive
   page from wave D1.
   Tests: tests/transfer-art.test.js
   ============================================================ */
(function (root) {
  "use strict";

  var VERSION = "1.0.0";
  var STYLES = ["dunes", "orbits", "prism", "horizon"];
  var NS = "http://www.w3.org/2000/svg";
  var LABEL = "orOS-transfer-art-v1:";

  // ---------- 1. Numbers ----------
  // Park–Miller (minimal standard), exact in doubles.
  // The seed is mixed first (32-bit finaliser, integer-exact), so
  // neighbouring seeds do not start with nearly the same numbers.
  function mix(x) {
    x = (x >>> 0) ^ 0x9e3779b9;
    x = Math.imul(x ^ (x >>> 16), 0x85ebca6b);
    x = Math.imul(x ^ (x >>> 13), 0xc2b2ae35);
    return (x ^ (x >>> 16)) >>> 0;
  }
  function rng(seed) {
    var s = (mix(Math.floor(Math.abs(Number(seed) || 0)) % 4294967296) % 2147483646) + 1;
    return function () { s = (s * 48271) % 2147483647; return (s - 1) / 2147483646; };
  }
  function r1(x) { return Math.round(x * 10) / 10; }

  // ---------- 2. Colours ----------
  function hexHsl(hex) {
    var m = /^#?([0-9a-f]{6})$/i.exec(String(hex || "").trim());
    if (!m) return [46, 65, 52];             // orOS gold #d4af37
    var n = parseInt(m[1], 16);
    var r = (n >> 16 & 255) / 255, g = (n >> 8 & 255) / 255, b = (n & 255) / 255;
    var mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn, l = (mx + mn) / 2, h = 0;
    var s = d ? d / (1 - Math.abs(2 * l - 1)) : 0;
    if (d) {
      if (mx === r) h = ((g - b) / d) % 6; else if (mx === g) h = (b - r) / d + 2; else h = (r - g) / d + 4;
      h *= 60; if (h < 0) h += 360;
    }
    return [Math.round(h), Math.round(s * 100), Math.round(l * 100)];
  }
  function hsl(h, s, l, a) {
    h = ((Math.round(h) % 360) + 360) % 360;
    s = Math.max(0, Math.min(100, Math.round(s)));
    l = Math.max(0, Math.min(100, Math.round(l)));
    return a == null || a >= 1 ? "hsl(" + h + "," + s + "%," + l + "%)" : "hsla(" + h + "," + s + "%," + l + "%," + (Math.round(a * 100) / 100) + ")";
  }

  // ---------- 3. Styles ----------
  // Each returns { defs: [...], shapes: [...] }; a shape is { t, a } with t a tag name.
  function dunes(R, h, W, H, light) {
    var L = light ? 18 : 0, id = "tg";
    var defs = [{ t: "linearGradient", a: { id: id, x1: 0, y1: 0, x2: 0, y2: 1 }, c: [
      { t: "stop", a: { offset: 0, "stop-color": hsl(h + 200, 45, 16 + L * 2) } },
      { t: "stop", a: { offset: 0.55, "stop-color": hsl(h - 10, 55, 38 + L) } },
      { t: "stop", a: { offset: 1, "stop-color": hsl(h + 15, 80, 62 + L / 2) } }] }];
    var out = [{ t: "rect", a: { width: W, height: H, fill: "url(#" + id + ")" } },
      { t: "circle", a: { cx: r1(W * (0.55 + R() * 0.3)), cy: r1(H * 0.36), r: r1(Math.min(W, H) * 0.13), fill: hsl(h - 6, 95, 70 + L / 3) } }];
    for (var i = 0; i < 7; i++) {
      var y0 = H * (0.45 + i * 0.085), amp = H * (0.04 + R() * 0.05), f = 1 + R() * 1.6, ph = R() * 6;
      var d = "M0 " + H + "L0 " + r1(y0);
      for (var k = 0; k <= 60; k++) {
        var x = W * k / 60;
        d += "L" + r1(x) + " " + r1(y0 + Math.sin(x / W * Math.PI * f + ph) * amp + Math.sin(x / W * 9 + ph * 2) * amp * 0.15);
      }
      out.push({ t: "path", a: { d: d + "L" + W + " " + H + "Z", fill: hsl(h - 25 + i * 6, 55 - i * 3, 40 - i * 4.6 + L) } });
    }
    return { defs: defs, shapes: out };
  }
  function orbits(R, h, W, H, light) {
    var L = light ? 30 : 0, id = "tg", m = Math.min(W, H);
    var defs = [{ t: "radialGradient", a: { id: id, cx: 0.7, cy: 0.35, r: 0.9 }, c: [
      { t: "stop", a: { offset: 0, "stop-color": hsl(h + 250, 45, 24 + L) } },
      { t: "stop", a: { offset: 1, "stop-color": hsl(h + 220, 40, 6 + L) } }] }];
    var out = [{ t: "rect", a: { width: W, height: H, fill: "url(#" + id + ")" } }];
    var cx = W * 0.68, cy = H * 0.4, rot = "rotate(-18 " + r1(cx) + " " + r1(cy) + ")";
    for (var i = 0; i < 14; i++) {
      var r = m * (0.08 + i * 0.075);
      out.push({ t: "ellipse", a: { cx: r1(cx), cy: r1(cy), rx: r1(r * 1.5), ry: r1(r * 0.55), transform: rot, fill: "none",
        stroke: hsl(h + (i % 3) * 30, 70, 65, 0.12 + R() * 0.18), "stroke-width": r1(1 + R() * 1.6) } });
      var a = R() * 6.28;
      out.push({ t: "circle", a: { cx: r1(cx + Math.cos(a) * r * 1.5), cy: r1(cy + Math.sin(a) * r * 0.55), r: r1(2 + R() * 4), fill: hsl(h + R() * 40, 90, 72) } });
    }
    out.push({ t: "circle", a: { cx: r1(cx), cy: r1(cy), r: r1(m * 0.14), fill: hsl(h, 90, 62, 0.12) } });
    out.push({ t: "circle", a: { cx: r1(cx), cy: r1(cy), r: r1(m * 0.07), fill: hsl(h, 90, 62) } });
    for (var j = 0; j < 120; j++) out.push({ t: "circle", a: { cx: r1(R() * W), cy: r1(R() * H), r: r1(R() * 1.3), fill: light ? "#3a3426" : "#ffffff", opacity: r1(R() * 0.7) } });
    return { defs: defs, shapes: out };
  }
  function prism(R, h, W, H, light) {
    var L = light ? 30 : 0, s = Math.max(W, H) / 9, rh = s * 0.866;
    var out = [{ t: "rect", a: { width: W, height: H, fill: hsl(h + 190, 35, 10 + L) } }];
    for (var r = -1; r * rh < H + rh; r++) {
      for (var c = -1; c * s / 2 < W + s; c++) {
        var up = ((r + c) % 2 + 2) % 2 === 0, x = c * s / 2, y = r * rh, t = (x / W + y / H) / 2 + R() * 0.25;
        var pts = up ? [x, y + rh, x + s / 2, y, x + s, y + rh] : [x, y, x + s, y, x + s / 2, y + rh];
        out.push({ t: "polygon", a: { points: pts.map(r1).join(" "), fill: hsl(h - 40 + t * 70, 55 + R() * 20, 12 + t * 45 + R() * 8 + L * 0.6),
          stroke: hsl(h, 30, 8, 0.35), "stroke-width": 1 } });
      }
    }
    return { defs: [], shapes: out };
  }
  function horizon(R, h, W, H, light) {
    var L = light ? 22 : 0, id = "tg", cid = "tc";
    // wide: the sun stands right of the text; narrow (phones): it rises low, under the text
    var wide = W > 900, cx = wide ? W * (0.72 + R() * 0.08) : W * (0.4 + R() * 0.2), cy = wide ? H * 0.62 : H * 0.93, r = wide ? Math.min(W, H) * 0.3 : W * 0.4;
    var defs = [
      { t: "linearGradient", a: { id: id, x1: 0, y1: 0, x2: 0, y2: 1 }, c: [
        { t: "stop", a: { offset: 0, "stop-color": hsl(h + 170, 50, 14 + L) } },
        { t: "stop", a: { offset: 0.6, "stop-color": hsl(h - 30, 70, 45 + L / 2) } },
        { t: "stop", a: { offset: 1, "stop-color": hsl(h, 90, 70) } }] },
      { t: "clipPath", a: { id: cid }, c: [{ t: "circle", a: { cx: r1(cx), cy: r1(cy), r: r1(r) } }] }];
    var out = [{ t: "rect", a: { width: W, height: H, fill: "url(#" + id + ")" } },
      { t: "circle", a: { cx: r1(cx), cy: r1(cy), r: r1(r), fill: hsl(h - 4, 95, 68) } }];
    for (var i = 0; i < 9; i++) {
      out.push({ t: "rect", a: { x: 0, y: r1(cy - r * 0.1 + i * r * 0.13), width: W, height: r1(3 + i * 2.2), fill: hsl(h - 30, 70, 45 + L / 2), "clip-path": "url(#" + cid + ")" } });
    }
    var gy = cy + r * 0.55;
    out.push({ t: "rect", a: { x: 0, y: r1(gy), width: W, height: r1(Math.max(0, H - gy)), fill: hsl(h + 170, 50, 10 + L) } });
    for (var k = 0; k < 10; k++) out.push({ t: "line", a: { x1: 0, x2: W, y1: r1(gy + k * k * 5), y2: r1(gy + k * k * 5), stroke: hsl(h, 90, 65, 0.35) } });
    for (var j = -12; j <= 12; j++) out.push({ t: "line", a: { x1: r1(cx), y1: r1(gy), x2: r1(cx + j * W * 0.12), y2: H, stroke: hsl(h, 90, 65, 0.25) } });
    return { defs: defs, shapes: out };
  }
  var DRAW = { dunes: dunes, orbits: orbits, prism: prism, horizon: horizon };

  // ---------- 4. Public API ----------
  // Style from the seed unless one is asked for.
  function pickStyle(seed) { return STYLES[(Math.abs(Math.floor(Number(seed) || 0)) >>> 0) % STYLES.length]; }
  // { style, w, h, defs, shapes }. opts: { style, accent, w, h, light }
  function draw(seed, opts) {
    opts = opts || {};
    var W = Math.max(16, Math.min(4096, Math.round(Number(opts.w) || 1280)));
    var H = Math.max(16, Math.min(4096, Math.round(Number(opts.h) || 800)));
    var style = STYLES.indexOf(opts.style) >= 0 ? opts.style : pickStyle(seed);
    var R = rng(seed);
    var res = DRAW[style](R, hexHsl(opts.accent)[0], W, H, !!opts.light);
    return { style: style, w: W, h: H, defs: res.defs, shapes: res.shapes };
  }
  function esc(v) { return String(v).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); }
  function nodeStr(n) {
    var s = "<" + n.t;
    for (var k in n.a) if (Object.prototype.hasOwnProperty.call(n.a, k)) s += " " + k + '="' + esc(n.a[k]) + '"';
    if (!n.c || !n.c.length) return s + "/>";
    return s + ">" + n.c.map(nodeStr).join("") + "</" + n.t + ">";
  }
  function toString(art) {
    return '<svg xmlns="' + NS + '" viewBox="0 0 ' + art.w + " " + art.h + '" preserveAspectRatio="xMidYMid slice" aria-hidden="true">' +
      (art.defs.length ? "<defs>" + art.defs.map(nodeStr).join("") + "</defs>" : "") + art.shapes.map(nodeStr).join("") + "</svg>";
  }
  // Real SVG elements; ids get a prefix so several pictures can share a page.
  function toNode(art, doc, prefix) {
    doc = doc || root.document;
    var p = String(prefix || "ta") + "-";
    function fix(v) { return typeof v === "string" ? v.replace(/url\(#(t[gc])\)/g, "url(#" + p + "$1)") : v; }
    function mk(n) {
      var e = doc.createElementNS(NS, n.t);
      for (var k in n.a) if (Object.prototype.hasOwnProperty.call(n.a, k)) e.setAttribute(k, k === "id" ? p + n.a[k] : String(fix(n.a[k])));
      (n.c || []).forEach(function (c) { e.appendChild(mk(c)); });
      return e;
    }
    var svg = doc.createElementNS(NS, "svg");
    svg.setAttribute("viewBox", "0 0 " + art.w + " " + art.h);
    svg.setAttribute("preserveAspectRatio", "xMidYMid slice");
    svg.setAttribute("aria-hidden", "true");
    if (art.defs.length) { var d = doc.createElementNS(NS, "defs"); art.defs.forEach(function (n) { d.appendChild(mk(n)); }); svg.appendChild(d); }
    art.shapes.forEach(function (n) { svg.appendChild(mk(n)); });
    return svg;
  }
  // 32-bit seed from the transfer secret (SHA-256 of a fixed label + the secret).
  function seedFrom(secret, subtle) {
    subtle = subtle || (root.crypto && root.crypto.subtle);
    var bytes = new TextEncoder().encode(LABEL + String(secret || ""));
    return subtle.digest("SHA-256", bytes).then(function (buf) { return new DataView(buf).getUint32(0); });
  }

  var api = { VERSION: VERSION, STYLES: STYLES, rng: rng, hexHsl: hexHsl, hsl: hsl, pickStyle: pickStyle, draw: draw, toString: toString, toNode: toNode, seedFrom: seedFrom };
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.orosTransferArt = api;
})(typeof self !== "undefined" ? self : this);
