// ============================================================
// orOS Layout — SVG export (v1.0.0, vector wave VEC-4)
// One page, or some of its items, as one standalone SVG, drawn from
// the same layout as the canvas and the PDF (render.js computeLayout):
//   - rectangles, ellipses, paths and lines as vector shapes with
//     their swatch colours (as RGB), gradients, strokes and dashes;
//   - text frames as real text, one <text> per run at its place (path
//     text, LY-TP, glyph by glyph), in the document's fonts embedded as
//     @font-face data (opts.fonts false leaves them out);
//   - placed pictures embedded as data, cut to their frames;
//   - the master items of the page under the page's own (whole page).
// build(doc, page, L, opts, deps) → { svg, w, h } or null.
//   opts: { ids (only these items; the box is theirs), fonts }
//   deps: { images: { itemId: { data Uint8Array, fmt "PNG"|"JPEG",
//     rect { x, y, w, h } (frame-local) } } (io.js cropImage) }
// Pure: no DOM. Exposes LY_SVGOUT (browser) or module.exports.
// ============================================================
(function (root) {
  "use strict";

  var M, T, R;
  if (typeof module !== "undefined" && module.exports) {
    M = require("../designkit/model.js"); T = require("../designkit/text.js"); R = require("../designkit/render.js");
  } else { M = root.orosDK.model; T = root.orosDK.text; R = root.orosDK.render; }

  function n2(v) { return String(Math.round((+v || 0) * 100) / 100); }
  function esc(s) { return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); }
  function at(k, v) { return " " + k + '="' + esc(v) + '"'; }
  function b64(bytes) {
    if (typeof Buffer !== "undefined" && typeof window === "undefined") return Buffer.from(bytes).toString("base64");
    var s = "", CH = 0x8000;
    for (var i = 0; i < bytes.length; i += CH) s += String.fromCharCode.apply(null, bytes.subarray(i, i + CH));
    return btoa(s);
  }
  function hex(doc, id) {
    var c = M.swatchColor(doc, id);
    if (!c) return null;
    return "#" + c.rgb.map(function (v) { var s = Math.max(0, Math.min(255, v)).toString(16); return s.length < 2 ? "0" + s : s; }).join("");
  }
  function fam(key) { return "f-" + key; }
  function stack(key) {
    var f = String(key).split("-")[0];
    return "'" + fam(key) + "', " + (f === "serif" ? "serif" : f === "mono" ? "monospace" : "sans-serif");
  }
  function faceAt(key) {
    var v = String(key || "").split("-")[1] || "r";
    return (/b/.test(v) ? ' font-weight="bold"' : "") + (/i/.test(v) ? ' font-style="italic"' : "");
  }

  // the outline of an item as SVG path data (page points); curves are
  // cubics (no arcs), as every SVG reader takes them
  var K = 0.5522847498;
  function shapeD(it) {
    var cmds;
    if (it.t === "path") cmds = R.pathCmds(it);
    else if (it.t === "ell") {
      var rx = Math.abs(it.w / 2), ry = Math.abs(it.h / 2), cx = it.x + it.w / 2, cy = it.y + it.h / 2, kx = rx * K, ky = ry * K;
      cmds = [["M", cx + rx, cy], ["C", cx + rx, cy + ky, cx + kx, cy + ry, cx, cy + ry], ["C", cx - kx, cy + ry, cx - rx, cy + ky, cx - rx, cy],
        ["C", cx - rx, cy - ky, cx - kx, cy - ry, cx, cy - ry], ["C", cx + kx, cy - ry, cx + rx, cy - ky, cx + rx, cy], ["Z"]];
    } else {
      var r = Math.max(0, Math.min(it.r || 0, Math.abs(it.w) / 2, Math.abs(it.h) / 2)), x = it.x, y = it.y, w = it.w, h = it.h, q = r * (1 - K);
      cmds = !r ? [["M", x, y], ["L", x + w, y], ["L", x + w, y + h], ["L", x, y + h], ["Z"]]
        : [["M", x + r, y], ["L", x + w - r, y], ["C", x + w - q, y, x + w, y + q, x + w, y + r], ["L", x + w, y + h - r],
          ["C", x + w, y + h - q, x + w - q, y + h, x + w - r, y + h], ["L", x + r, y + h], ["C", x + q, y + h, x, y + h - q, x, y + h - r],
          ["L", x, y + r], ["C", x, y + q, x + q, y, x + r, y], ["Z"]];
    }
    return cmds.map(function (c) { return c[0] + c.slice(1).map(n2).join(" "); }).join("");
  }

  function build(doc, page, L, opts, deps) {
    opts = opts || {}; deps = deps || {};
    if (!doc || !page) return null;
    L = L || R.computeLayout(doc);
    var want = null;
    if (opts.ids && opts.ids.length) { want = {}; opts.ids.forEach(function (id) { want[id] = 1; }); }
    var side = M.sideOf(doc, (L.pageOf || {})[page.id] || 0), mframes = (L.master || {})[page.id] || {};
    var list = [];
    if (!want && page.ms) M.masterItems(doc, page, side).forEach(function (it) { list.push({ it: it, lines: mframes[it.id] && mframes[it.id].lines }); });
    M.itemsOn(doc, page.id).forEach(function (it) {
      if (!want || want[it.id]) list.push({ it: it, lines: L.frames[it.id] && L.frames[it.id].lines });
    });
    list = list.filter(function (e) { return !e.it.hide; });
    if (!list.length) return null;
    var defs = [], nid = 0, keys = {}, images = deps.images || {};
    function id(p) { return p + (++nid); }

    function itemSvg(it, lines) {
      var out = "";
      if (it.t === "line") {
        var col = it.stroke && it.sw > 0 ? hex(doc, it.stroke) : null;
        if (!col) return "";
        out = '<path d="M' + n2(it.x) + " " + n2(it.y) + "L" + n2(it.x + it.w) + " " + n2(it.y + it.h) + '" fill="none"' + at("stroke", col) + at("stroke-width", n2(it.sw)) +
          (it.dash ? at("stroke-dasharray", n2(it.sw * 3) + " " + n2(it.sw * 2)) : "") + "/>";
      } else {
        var d = shapeD(it), fill = "none";
        if (it.gr) {
          var g = it.gr, gid = id("g"), x1 = it.x + g.x1 * it.w, y1 = it.y + g.y1 * it.h, x2 = it.x + g.x2 * it.w, y2 = it.y + g.y2 * it.h;
          var stops = g.st.map(function (s) { return '<stop offset="' + n2(s[0]) + '"' + at("stop-color", hex(doc, s[1]) || "#000000") + (s[2] < 100 ? at("stop-opacity", n2(s[2] / 100)) : "") + "/>"; }).join("");
          defs.push(g.k === "r"
            ? '<radialGradient id="' + gid + '" gradientUnits="userSpaceOnUse"' + at("cx", n2(x1)) + at("cy", n2(y1)) + at("r", n2(Math.max(0.01, Math.hypot(x2 - x1, y2 - y1)))) + ">" + stops + "</radialGradient>"
            : '<linearGradient id="' + gid + '" gradientUnits="userSpaceOnUse"' + at("x1", n2(x1)) + at("y1", n2(y1)) + at("x2", n2(x2)) + at("y2", n2(y2)) + ">" + stops + "</linearGradient>");
          fill = "url(#" + gid + ")";
        } else if (it.fill) fill = hex(doc, it.fill) || "none";
        if (fill !== "none") out += '<path d="' + d + '"' + at("fill", fill) + (it.eo ? ' fill-rule="evenodd"' : "") + "/>";
        if (it.t === "img") {
          var im = images[it.id];
          if (im && im.data) {
            var cid = id("c");
            defs.push('<clipPath id="' + cid + '"><path d="' + d + '"/></clipPath>');
            out += '<image clip-path="url(#' + cid + ')" preserveAspectRatio="none"' + at("x", n2(it.x + im.rect.x)) + at("y", n2(it.y + im.rect.y)) +
              at("width", n2(im.rect.w)) + at("height", n2(im.rect.h)) + at("href", "data:image/" + (im.fmt === "PNG" ? "png" : "jpeg") + ";base64," + b64(im.data)) + "/>";
          }
        }
        if (it.t === "text" && lines) out += textSvg(it, lines);
        if (it.stroke && it.sw > 0) {
          var sc = hex(doc, it.stroke);
          if (sc) out += '<path d="' + d + '" fill="none"' + at("stroke", sc) + at("stroke-width", n2(it.sw)) + (it.dash ? at("stroke-dasharray", n2(it.sw * 3) + " " + n2(it.sw * 2)) : "") + "/>";
        }
      }
      if (!out) return "";
      var tf = it.rot && it.t !== "line" ? at("transform", "rotate(" + n2(it.rot) + " " + n2(it.x + it.w / 2) + " " + n2(it.y + it.h / 2) + ")") : "";
      var op = it.op === undefined ? 100 : it.op;
      return "<g" + tf + (op < 100 ? at("opacity", n2(op / 100)) : "") + ">" + out + "</g>";
    }

    function textSvg(it, lines) {
      var s = "";
      lines.forEach(function (ln) {
        // a table row (LY-W12): cell fills, then rules (black without a swatch)
        if (ln.tb) {
          ln.tb.fills.forEach(function (f) { var c = hex(doc, f[4]); if (c) s += "<rect" + at("x", n2(it.x + f[0])) + at("y", n2(it.y + f[1])) + at("width", n2(f[2])) + at("height", n2(f[3])) + at("fill", c) + "/>"; });
          ln.tb.rules.forEach(function (r) { s += "<line" + at("x1", n2(it.x + r[0])) + at("y1", n2(it.y + r[1])) + at("x2", n2(it.x + r[2])) + at("y2", n2(it.y + r[3])) + at("stroke", (r[4] && hex(doc, r[4])) || "#000000") + at("stroke-width", n2(r[5])) + "/>"; });
        }
        ln.runs.forEach(function (r) {
          if (!r.t || !r.t.trim() && !r.g) return;
          keys[r.key] = 1;
          var head = at("font-family", stack(r.key)) + faceAt(r.key) + at("font-size", n2(r.size)) + at("fill", hex(doc, r.color) || "#000000");
          if (r.g) {
            r.g.forEach(function (gl) {
              s += "<text" + head + at("transform", "translate(" + n2(it.x + gl.x) + " " + n2(it.y + gl.y) + ") rotate(" + n2(gl.rot * 180 / Math.PI) + ")") +
                at("x", n2(-gl.w / 2)) + ' y="0">' + esc(gl.ch) + "</text>";
            });
            return;
          }
          var extra = r.track ? at("letter-spacing", n2(r.track * r.size / 1000)) : "";
          if (r.kern) {
            var ks = [], prev = "", any = false;
            Array.from(r.t).forEach(function (ch) { var k = prev ? T.kernPair(r.key, prev, ch, r.size) : 0; if (k) any = true; ks.push(n2(k)); prev = ch; });
            if (any) extra += at("dx", ks.join(" "));
          }
          s += "<text" + head + at("x", n2(it.x + r.x)) + at("y", n2(it.y + r.y)) + extra + ">" + esc(r.t) + "</text>";
          if (r.u) s += "<rect" + at("x", n2(it.x + r.x)) + at("y", n2(it.y + r.y + r.size * 0.12)) + at("width", n2(r.w)) + at("height", n2(Math.max(0.3, r.size * 0.05))) + at("fill", hex(doc, r.color) || "#000000") + "/>";
        });
      });
      return s;
    }

    var body = "";
    list.forEach(function (e) { body += itemSvg(e.it, e.lines); });
    var vb;
    if (want) {
      vb = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
      list.forEach(function (e) {
        var b = R.itemBox(e.it), p = e.it.sw > 0 ? e.it.sw / 2 : 0;
        if (e.it.ext && e.it.ext.tp) p += 40;
        vb.x0 = Math.min(vb.x0, b.x - p); vb.y0 = Math.min(vb.y0, b.y - p); vb.x1 = Math.max(vb.x1, b.x + b.w + p); vb.y1 = Math.max(vb.y1, b.y + b.h + p);
      });
    } else { var psz = M.pageSize(doc, page); vb = { x0: 0, y0: 0, x1: psz.w, y1: psz.h }; }
    var W = Math.max(1, vb.x1 - vb.x0), H = Math.max(1, vb.y1 - vb.y0);
    var css = [];
    if (opts.fonts !== false) {
      Object.keys(keys).sort().forEach(function (key) {
        T.faceParts(key).forEach(function (p) {
          css.push('@font-face{font-family:"' + fam(key) + '";src:url(data:font/ttf;base64,' + p.b64() + ') format("truetype")' + (p.range ? ";unicode-range:" + p.range : "") + "}");
        });
      });
    }
    css.push("text{white-space:pre;font-kerning:none;font-variant-ligatures:none}");
    var svg = '<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" version="1.1"' + at("width", n2(W) + "pt") + at("height", n2(H) + "pt") +
      at("viewBox", n2(vb.x0) + " " + n2(vb.y0) + " " + n2(W) + " " + n2(H)) + ' xml:space="preserve"><style>' + css.join("\n") + "</style>" +
      (want ? "" : '<rect width="' + n2(W) + '" height="' + n2(H) + '" fill="#ffffff"/>') +
      (defs.length ? "<defs>" + defs.join("") + "</defs>" : "") + body + "</svg>\n";
    return { svg: svg, w: W, h: H };
  }

  var api = { build: build };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.LY_SVGOUT = api;
})(typeof window !== "undefined" ? window : this);
