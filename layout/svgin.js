// ============================================================
// orOS Layout — SVG import (v1.0.0)
// Opens SVG files (for example the pages Affinity Publisher, Designer
// or Inkscape export as SVG) as a NEW Layout document, one page per
// file:
//   - rect / circle / ellipse / line / polyline / polygon / path
//     become rectangles, ellipses, lines and path items, with fill,
//     stroke, dashes, opacity and linear / radial gradients;
//   - <text> becomes editable text frames (through the PDF reader's
//     line and paragraph grouping, layout/pdfin.js);
//   - pictures embedded as data: URIs are stored like placed ones;
//     linked pictures become empty frames that keep the file name;
//   - <use> of shapes, pictures and symbols is followed (with a depth
//     limit), groups pass on their transform, style and opacity.
// The XML goes through the Scribus reader's tokenizer (layout/sla.js:
// no DOM, no scripts, no external entities). Scripts, foreignObject,
// event attributes, CSS <style> sheets, filters, masks and clip paths
// are never run or applied; patterns fill as nothing. Text frames sit
// above the shapes of their page.
// Page size: width / height with units when the file has them;
// otherwise the viewBox, read at the resolution (72, 96, 150, 300 or
// 600 per inch) that makes it a known paper size, else 72 per inch.
// Pure part (parse) is testable under Node; open() stores pictures.
// Exposes LY_SVGIN (browser) or module.exports (Node tests).
// ============================================================
(function (root) {
  "use strict";

  var M, T, X, P;
  if (typeof module !== "undefined" && module.exports) {
    M = require("../designkit/model.js"); T = require("../designkit/text.js"); X = require("./sla.js"); P = require("./pdfin.js");
  } else { M = root.orosDK.model; T = root.orosDK.text; X = root.LY_SLA; P = root.LY_PDFIN; }

  var MAX_FILE = 60 * 1024 * 1024, MAX_ITEMS_PAGE = 3000, MAX_DEPTH = 24, MAX_PAGES = 300;

  // ---------- 1. Small parsers ----------
  function num(v, def) { var n = parseFloat(v); return isFinite(n) ? n : def; }
  var UNIT = { pt: 1, px: 0.75, mm: 72 / 25.4, cm: 72 / 2.54, "in": 72, pc: 12 };
  // a length in pt, or null for "100%", "auto" and other relative ones
  function lenPt(v) {
    var m = /^\s*([-+]?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?)\s*(pt|px|mm|cm|in|pc)?\s*$/i.exec(String(v || ""));
    if (!m) return null;
    return parseFloat(m[1]) * (m[2] ? UNIT[m[2].toLowerCase()] : 0.75);
  }
  var NAMED = {
    black: [0, 0, 0], white: [255, 255, 255], red: [255, 0, 0], lime: [0, 255, 0], green: [0, 128, 0], blue: [0, 0, 255],
    yellow: [255, 255, 0], cyan: [0, 255, 255], aqua: [0, 255, 255], magenta: [255, 0, 255], fuchsia: [255, 0, 255],
    gray: [128, 128, 128], grey: [128, 128, 128], silver: [192, 192, 192], maroon: [128, 0, 0], olive: [128, 128, 0],
    navy: [0, 0, 128], purple: [128, 0, 128], teal: [0, 128, 128], orange: [255, 165, 0], brown: [165, 42, 42], pink: [255, 192, 203],
    gold: [255, 215, 0], darkgray: [169, 169, 169], darkgrey: [169, 169, 169], lightgray: [211, 211, 211], lightgrey: [211, 211, 211]
  };
  // → [r, g, b] | "none" | { url: id } | null (unknown: inherit)
  function colour(v, current) {
    var s = String(v || "").trim().toLowerCase();
    if (!s) return null;
    if (s === "none" || s === "transparent") return "none";
    if (s === "currentcolor") return current || [0, 0, 0];
    var u = /^url\(\s*['"]?#([^'")\s]+)['"]?\s*\)/.exec(String(v).trim());
    if (u) return { url: u[1] };
    var h = /^#([0-9a-f]{3,8})$/.exec(s);
    if (h) {
      var x = h[1];
      if (x.length === 3 || x.length === 4) return [0, 1, 2].map(function (k) { return parseInt(x[k] + x[k], 16); });
      if (x.length === 6 || x.length === 8) return [0, 2, 4].map(function (k) { return parseInt(x.substr(k, 2), 16); });
      return null;
    }
    var r = /^rgba?\(\s*([^,\s]+)[\s,]+([^,\s]+)[\s,]+([^,\s)\/]+)/.exec(s);
    if (r) return [r[1], r[2], r[3]].map(function (p) { return Math.max(0, Math.min(255, Math.round(/%$/.test(p) ? parseFloat(p) * 2.55 : parseFloat(p)))) || 0; });
    return NAMED[s] ? NAMED[s].slice() : null;
  }
  function styleOf(a) {
    var o = {};
    String(a.style || "").split(";").forEach(function (d) {
      var k = d.indexOf(":");
      if (k > 0) o[d.slice(0, k).trim().toLowerCase()] = d.slice(k + 1).trim();
    });
    return o;
  }

  // 2D matrices [a, b, c, d, e, f]
  var I = [1, 0, 0, 1, 0, 0];
  function mul(m, n) {
    return [m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1], m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3],
      m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5]];
  }
  function apply(m, x, y) { return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]]; }
  function transform(v) {
    var m = I, re = /(matrix|translate|scale|rotate|skewX|skewY)\s*\(([^)]*)\)/g, t;
    while ((t = re.exec(String(v || "")))) {
      var a = t[2].trim().split(/[\s,]+/).map(Number);
      if (a.some(function (x) { return !isFinite(x); })) continue;
      var n = I;
      if (t[1] === "matrix" && a.length >= 6) n = a.slice(0, 6);
      else if (t[1] === "translate") n = [1, 0, 0, 1, a[0] || 0, a[1] || 0];
      else if (t[1] === "scale") n = [a[0], 0, 0, a.length > 1 ? a[1] : a[0], 0, 0];
      else if (t[1] === "rotate") {
        var r = (a[0] || 0) * Math.PI / 180, c = Math.cos(r), s = Math.sin(r);
        n = [c, s, -s, c, 0, 0];
        if (a.length >= 3) n = mul(mul([1, 0, 0, 1, a[1], a[2]], n), [1, 0, 0, 1, -a[1], -a[2]]);
      } else if (t[1] === "skewX") n = [1, 0, Math.tan((a[0] || 0) * Math.PI / 180), 1, 0, 0];
      else if (t[1] === "skewY") n = [1, Math.tan((a[0] || 0) * Math.PI / 180), 0, 1, 0, 0];
      m = mul(m, n);
    }
    return m;
  }
  // rotation + positive scale only (no skew, no mirror)?
  function decompose(m) {
    var sx = Math.hypot(m[0], m[1]), sy = Math.hypot(m[2], m[3]), det = m[0] * m[3] - m[1] * m[2];
    if (!(sx > 1e-9 && sy > 1e-9) || det <= 0 || Math.abs(m[0] * m[2] + m[1] * m[3]) > 1e-6 * sx * sy) return null;
    return { sx: sx, sy: sy, rot: Math.atan2(m[1], m[0]) * 180 / Math.PI };
  }
  function avgScale(m) { return Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2])) || 1; }

  // ---------- 2. Shapes as commands (local coordinates) ----------
  var K = 0.5522847498;
  function ellCmds(cx, cy, rx, ry) {
    var kx = rx * K, ky = ry * K;
    return [["M", cx + rx, cy], ["C", cx + rx, cy + ky, cx + kx, cy + ry, cx, cy + ry], ["C", cx - kx, cy + ry, cx - rx, cy + ky, cx - rx, cy],
      ["C", cx - rx, cy - ky, cx - kx, cy - ry, cx, cy - ry], ["C", cx + kx, cy - ry, cx + rx, cy - ky, cx + rx, cy], ["Z"]];
  }
  function rectCmds(x, y, w, h, rx, ry) {
    if (!(rx > 0 && ry > 0)) return [["M", x, y], ["L", x + w, y], ["L", x + w, y + h], ["L", x, y + h], ["Z"]];
    var kx = rx * (1 - K), ky = ry * (1 - K);
    return [["M", x + rx, y], ["L", x + w - rx, y], ["C", x + w - kx, y, x + w, y + ky, x + w, y + ry], ["L", x + w, y + h - ry],
      ["C", x + w, y + h - ky, x + w - kx, y + h, x + w - rx, y + h], ["L", x + rx, y + h], ["C", x + kx, y + h, x, y + h - ky, x, y + h - ry],
      ["L", x, y + ry], ["C", x, y + ky, x + kx, y, x + rx, y], ["Z"]];
  }
  function pointsCmds(v, close) {
    var n = String(v || "").trim().split(/[\s,]+/).map(Number), out = [];
    for (var i = 0; i + 1 < n.length && out.length < 8000; i += 2) {
      if (!isFinite(n[i]) || !isFinite(n[i + 1])) break;
      out.push([out.length ? "L" : "M", n[i], n[i + 1]]);
    }
    if (close && out.length) out.push(["Z"]);
    return out;
  }
  function mapCmds(cmds, m) {
    return cmds.map(function (c) {
      var o = [c[0]];
      for (var i = 1; i < c.length; i += 2) { var p = apply(m, c[i], c[i + 1]); o.push(p[0], p[1]); }
      return o;
    });
  }
  function bounds(cmds) {
    var x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    cmds.forEach(function (c) {
      for (var i = 1; i < c.length; i += 2) { x0 = Math.min(x0, c[i]); x1 = Math.max(x1, c[i]); y0 = Math.min(y0, c[i + 1]); y1 = Math.max(y1, c[i + 1]); }
    });
    return isFinite(x0) ? { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } : null;
  }
  // page commands → model path text in fractions of box b
  function pathText(cmds, b) {
    var w = Math.max(b.w, 1e-6), h = Math.max(b.h, 1e-6);
    return cmds.map(function (c) {
      var o = c[0];
      for (var i = 1; i < c.length; i += 2) o += (i > 1 ? " " : "") + (Math.round((c[i] - b.x) / w * 10000) / 10000) + " " + (Math.round((c[i + 1] - b.y) / h * 10000) / 10000);
      return o;
    }).join("");
  }

  // ---------- 3. Page size ----------
  var PAPER = [[595.28, 841.89], [419.53, 595.28], [841.89, 1190.55], [612, 792], [612, 1008], [498.9, 708.66], [1080, 1080], [1920, 1080]];
  function guessScale(vw, vh) {
    var dpis = [72, 96, 150, 300, 600];
    for (var i = 0; i < dpis.length; i++) {
      var s = 72 / dpis[i], w = vw * s, h = vh * s;
      for (var k = 0; k < PAPER.length; k++) {
        var p = PAPER[k];
        if ((Math.abs(w - p[0]) < p[0] * 0.01 && Math.abs(h - p[1]) < p[1] * 0.01) || (Math.abs(w - p[1]) < p[1] * 0.01 && Math.abs(h - p[0]) < p[0] * 0.01)) return s;
      }
    }
    return 1;
  }

  // ---------- 4. One SVG → one page ----------
  // → { w, h, items: [...], pieces: [...], images: [{ item, data, mime, name }], linked, skipped } or null
  function parse(src) {
    src = String(src || "");
    if (src.length > MAX_FILE) return null;
    var tree = X.parseXml(src, true), svg = find(tree, "svg");
    if (!svg) return null;
    var ids = {};
    (function index(n, d) {
      if (d > 200) return;
      if (n.a && n.a.id && !ids[n.a.id]) ids[n.a.id] = n;
      n.c.forEach(function (ch) { index(ch, d + 1); });
    })(svg, 0);
    var vb = String(svg.a.viewBox || "").trim().split(/[\s,]+/).map(Number);
    var hasVb = vb.length === 4 && vb.every(isFinite) && vb[2] > 0 && vb[3] > 0;
    var wPt = lenPt(svg.a.width), hPt = lenPt(svg.a.height), base;
    if (hasVb) {
      var s;
      if (wPt && hPt) s = [wPt / vb[2], hPt / vb[3]];
      else { var g = guessScale(vb[2], vb[3]); s = [g, g]; }
      base = [s[0], 0, 0, s[1], -vb[0] * s[0], -vb[1] * s[1]];
      wPt = vb[2] * s[0]; hPt = vb[3] * s[1];
    } else {
      wPt = wPt || 595.28; hPt = hPt || 841.89;
      base = [0.75, 0, 0, 0.75, 0, 0];
      if (lenPt(svg.a.width) !== null && /pt|mm|cm|in|pc/i.test(String(svg.a.width))) base = [1, 0, 0, 1, 0, 0];
    }
    wPt = Math.min(20000, Math.max(10, wPt)); hPt = Math.min(20000, Math.max(10, hPt));
    var out = { w: wPt, h: hPt, items: [], pieces: [], images: [], linked: 0, skipped: 0 };
    var SKIP = { defs: 1, symbol: 1, clipPath: 1, mask: 1, pattern: 1, marker: 1, style: 1, script: 1, foreignObject: 1, metadata: 1,
      title: 1, desc: 1, linearGradient: 1, radialGradient: 1, filter: 1, "#text": 1, "#ace": 1 };
    function full() { return out.items.length >= MAX_ITEMS_PAGE; }

    // inherited presentation state
    function stateOf(node, up) {
      var a = node.a, st = styleOf(a), o = {};
      Object.keys(up).forEach(function (k) { o[k] = up[k]; });
      function get(k) { return st[k] !== undefined ? st[k] : a[k]; }
      var col = colour(get("color"), up.color);
      if (Array.isArray(col)) o.color = col;
      ["fill", "stroke"].forEach(function (k) { var v = get(k); if (v !== undefined) { var c = colour(v, o.color); if (c) o[k] = c; } });
      ["fill-opacity", "stroke-opacity"].forEach(function (k) { var v = get(k); if (v !== undefined) o[k] = Math.max(0, Math.min(1, num(v, 1))); });
      var sw = get("stroke-width"); if (sw !== undefined) o.sw = Math.max(0, num(sw, 1));
      var da = get("stroke-dasharray"); if (da !== undefined) o.dash = !/^\s*(none|0)?\s*$/.test(da);
      var fr = get("fill-rule"); if (fr !== undefined) o.eo = fr === "evenodd";
      var ff = get("font-family"); if (ff !== undefined) o.ff = ff.replace(/['"]/g, "");
      var fs = get("font-size"); if (fs !== undefined) { var p = lenPt(fs); if (p) o.fs = p / 0.75; }
      var fw = get("font-weight"); if (fw !== undefined) o.fb = fw === "bold" || fw === "bolder" || num(fw, 400) >= 600;
      var fst = get("font-style"); if (fst !== undefined) o.fi = /italic|oblique/.test(fst);
      var ta = get("text-anchor"); if (ta !== undefined) o.ta = ta;
      o.op = up.op * Math.max(0, Math.min(1, num(get("opacity"), 1)));
      o.hidden = get("display") === "none" || get("visibility") === "hidden" || get("visibility") === "collapse";
      return o;
    }

    function gradient(id, m, lb) {
      var g = ids[id], seen = {};
      if (!g || (g.n !== "linearGradient" && g.n !== "radialGradient")) return null;
      var stopsHost = g, attrs = {};
      for (var k = 0; k < 8 && stopsHost; k++) {
        Object.keys(stopsHost.a).forEach(function (x) { if (attrs[x] === undefined) attrs[x] = stopsHost.a[x]; });
        if (stopsHost.c.some(function (c) { return c.n === "stop"; }) && !seen.stops) seen.stops = stopsHost;
        var href = String(stopsHost.a.href || stopsHost.a["xlink:href"] || "").replace(/^#/, "");
        stopsHost = href && !seen[href] ? ids[href] : null;
        seen[href] = 1;
      }
      var host = seen.stops;
      if (!host) return null;
      var st = [];
      host.c.forEach(function (s) {
        if (s.n !== "stop" || st.length >= 16) return;
        var ss = styleOf(s.a), off = String(s.a.offset !== undefined ? s.a.offset : "0");
        var pos = /%$/.test(off) ? num(off, 0) / 100 : num(off, 0);
        var c = colour(ss["stop-color"] !== undefined ? ss["stop-color"] : s.a["stop-color"] || "black", [0, 0, 0]);
        var op = num(ss["stop-opacity"] !== undefined ? ss["stop-opacity"] : s.a["stop-opacity"], 1);
        if (c === "none") { c = [255, 255, 255]; op = 0; }
        if (!Array.isArray(c)) c = [0, 0, 0];
        st.push([Math.max(0, Math.min(1, pos)), c, Math.round(Math.max(0, Math.min(1, op)) * 100)]);
      });
      if (st.length === 1) st.push([1, st[0][1], st[0][2]]);
      if (st.length < 2) return null;
      var user = attrs.gradientUnits === "userSpaceOnUse", gt = transform(attrs.gradientTransform);
      function v(x, d, along) {
        if (x === undefined) return d;
        var s = String(x), n = num(s, d);
        if (/%$/.test(s)) n = n / 100 * (user ? along : 1);
        return n;
      }
      var p1, p2, k2 = g.n === "linearGradient" ? "l" : "r";
      if (k2 === "l") { p1 = [v(attrs.x1, 0, lb.w), v(attrs.y1, 0, lb.h)]; p2 = [v(attrs.x2, user ? lb.w : 1, lb.w), v(attrs.y2, 0, lb.h)]; }
      else {
        var cx = v(attrs.cx, user ? lb.w / 2 : 0.5, lb.w), cy = v(attrs.cy, user ? lb.h / 2 : 0.5, lb.h), r = v(attrs.r, user ? lb.w / 2 : 0.5, lb.w);
        p1 = [cx, cy]; p2 = [cx + r, cy];
      }
      // into the element's own space
      var toLocal = user ? gt : mul([lb.w, 0, 0, lb.h, lb.x, lb.y], gt);
      return { k: k2, p1: apply(m, apply(toLocal, p1[0], p1[1])[0], apply(toLocal, p1[0], p1[1])[1]), p2: apply(m, apply(toLocal, p2[0], p2[1])[0], apply(toLocal, p2[0], p2[1])[1]), st: st };
    }

    function paint(item, s, m, lb, isLine) {
      var f = isLine ? "none" : (s.fill === undefined ? [0, 0, 0] : s.fill), k = s.stroke === undefined ? "none" : s.stroke;
      var fo = s["fill-opacity"] === undefined ? 1 : s["fill-opacity"], so = s["stroke-opacity"] === undefined ? 1 : s["stroke-opacity"];
      if (f && f.url) {
        var g = gradient(f.url, m, lb);
        if (g) item.grad = g;
        else { f = "none"; out.skipped++; }
      }
      if (Array.isArray(f)) item.fill = f;
      if (Array.isArray(k)) { item.stroke = k; item.sw = Math.max(0, (s.sw === undefined ? 1 : s.sw) * avgScale(m)); if (s.dash) item.dash = 1; }
      else if (k && k.url) { var gk = gradient(k.url, m, lb); if (gk) { item.stroke = gk.st[0][1]; item.sw = Math.max(0, (s.sw === undefined ? 1 : s.sw) * avgScale(m)); } }
      // one opacity per item: the group's, times the fill's (or the
      // stroke's for an outline only)
      item.op = Math.round(100 * s.op * (item.fill || item.grad ? fo : so));
      if (s.eo) item.eo = 1;
      return !!(item.fill || item.grad || item.stroke);
    }

    function shape(node, s, m) {
      var a = node.a, n = node.n, cmds = null, box = null, kind = "path";
      if (n === "rect") {
        var w = num(a.width, 0), h = num(a.height, 0);
        if (!(w > 0 && h > 0)) return;
        var rx = a.rx !== undefined ? num(a.rx, 0) : num(a.ry, 0), ry = a.ry !== undefined ? num(a.ry, 0) : rx;
        rx = Math.min(Math.max(0, rx), w / 2); ry = Math.min(Math.max(0, ry), h / 2);
        box = { x: num(a.x, 0), y: num(a.y, 0), w: w, h: h };
        cmds = rectCmds(box.x, box.y, w, h, rx, ry);
        kind = Math.abs(rx - ry) < 1e-6 ? "rect" : "path";
        box.r = rx;
      } else if (n === "circle" || n === "ellipse") {
        var cx = num(a.cx, 0), cy = num(a.cy, 0), erx = n === "circle" ? num(a.r, 0) : num(a.rx, 0), ery = n === "circle" ? erx : num(a.ry, 0);
        if (!(erx > 0 && ery > 0)) return;
        box = { x: cx - erx, y: cy - ery, w: 2 * erx, h: 2 * ery };
        cmds = ellCmds(cx, cy, erx, ery); kind = "ell";
      } else if (n === "line") cmds = [["M", num(a.x1, 0), num(a.y1, 0)], ["L", num(a.x2, 0), num(a.y2, 0)]];
      else if (n === "polyline" || n === "polygon") cmds = pointsCmds(a.points, n === "polygon");
      else if (n === "path") cmds = X.svgPath(a.d);
      if (!cmds || !cmds.length || cmds[0][0] !== "M") return;
      var lb = box || bounds(cmds) || { x: 0, y: 0, w: 1, h: 1 };
      var item = {}, dec = decompose(m);
      if (!paint(item, s, m, lb, n === "line")) return;
      var pc = mapCmds(cmds, m), pb = bounds(pc);
      if (!pb) return;
      if (n === "line" || (pc.length === 2 && pc[1][0] === "L" && !item.fill && !item.grad)) {
        item.t = "line"; item.x = pc[0][1]; item.y = pc[0][2]; item.w = pc[1][1] - pc[0][1]; item.h = pc[1][2] - pc[0][2];
        if (!item.stroke) return;
      } else if ((kind === "rect" || kind === "ell") && dec) {
        // a box with its own rotation: keep it a real rectangle / ellipse
        var c = apply(m, box.x + box.w / 2, box.y + box.h / 2), bw = box.w * dec.sx, bh = box.h * dec.sy;
        item.t = kind; item.x = c[0] - bw / 2; item.y = c[1] - bh / 2; item.w = bw; item.h = bh; item.rot = dec.rot;
        if (kind === "rect" && box.r) item.r = box.r * Math.min(dec.sx, dec.sy);
      } else {
        item.t = "path"; item.x = pb.x; item.y = pb.y; item.w = Math.max(pb.w, 0.5); item.h = Math.max(pb.h, 0.5);
        item.d = pathText(pc, { x: pb.x, y: pb.y, w: item.w, h: item.h });
        if (!M.parsePath(item.d)) return;
      }
      // the gradient in fractions of the item's own (unrotated) box
      if (item.grad && item.t !== "line") {
        var g = item.grad, toBox = function (p) {
          var cx = item.x + item.w / 2, cy = item.y + item.h / 2, r = -(item.rot || 0) * Math.PI / 180;
          var dx = p[0] - cx, dy = p[1] - cy, x = dx * Math.cos(r) - dy * Math.sin(r), y = dx * Math.sin(r) + dy * Math.cos(r);
          return [(x + item.w / 2) / item.w, (y + item.h / 2) / item.h];
        };
        var q1 = toBox(g.p1), q2 = toBox(g.p2);
        item.gr = { k: g.k, x1: q1[0], y1: q1[1], x2: q2[0], y2: q2[1], st: g.st };
      }
      delete item.grad;
      out.items.push(item);
    }

    function image(node, s, m) {
      var a = node.a, w = num(a.width, 0), h = num(a.height, 0);
      if (!(w > 0 && h > 0)) return;
      var dec = decompose(m) || { sx: avgScale(m), sy: avgScale(m), rot: 0 };
      var x = num(a.x, 0), y = num(a.y, 0), c = apply(m, x + w / 2, y + h / 2), bw = w * dec.sx, bh = h * dec.sy;
      var href = String(a.href || a["xlink:href"] || "").trim();
      var item = { t: "img", x: c[0] - bw / 2, y: c[1] - bh / 2, w: bw, h: bh, rot: dec.rot, op: Math.round(100 * s.op),
        fit: /slice/.test(a.preserveAspectRatio || "") ? "fill" : "fit", nm: "" };
      var d = /^data:(image\/(?:png|jpe?g|gif|webp|bmp|svg\+xml));base64,([\s\S]+)$/i.exec(href);
      if (d) { item.nm = "svg-image-" + (out.images.length + 1); out.images.push({ item: item, mime: d[1].toLowerCase(), data: d[2].replace(/\s+/g, "") }); }
      else {
        // a linked picture: keep only its file name (no other schemes)
        item.nm = /^(?![a-z][a-z0-9+.-]+:)|^(https?|file):/i.test(href) ? (href.split(/[\\\/?#]/).filter(Boolean).pop() || "").slice(0, 120) : "";
        out.linked++;
      }
      out.items.push(item);
    }

    function text(node, s, m) {
      // walk text + tspans: the pen moves on after each chunk
      var pen = { x: 0, y: 0 };
      function first(v) { var n = String(v || "").trim().split(/[\s,]+/)[0]; return n === "" ? NaN : parseFloat(n); }
      function run(n, st, top) {
        var a = n.a;
        if (!top && n.n !== "tspan" && n.n !== "textPath") return;
        if (n.n === "textPath") out.skipped++;
        var x = first(a.x), y = first(a.y);
        if (isFinite(x)) pen.x = x;
        if (isFinite(y)) pen.y = y;
        pen.x += first(a.dx) || 0; pen.y += first(a.dy) || 0;
        n.c.forEach(function (ch) {
          if (ch.n === "#text") {
            var str = String(ch.t || "").replace(/\s+/g, " ");
            if (!str.trim() || st.hidden) { return; }
            var f = X.fontOf(st.ff || ""), b = st.fb !== undefined ? (st.fb ? 1 : 0) : f.b, i = st.fi !== undefined ? (st.fi ? 1 : 0) : f.i;
            var size = st.fs || 16, key = T.fontKey(f.font, b, i), adv = T.measure(key, str, size, 0) || str.length * size * 0.5;
            var sx = pen.x - (st.ta === "middle" ? adv / 2 : st.ta === "end" ? adv : 0);
            var p = apply(m, sx, pen.y), sc = avgScale(m), rot = Math.atan2(m[1], m[0]) * 180 / Math.PI;
            var fill = Array.isArray(st.fill) ? st.fill : st.fill && st.fill.url ? (gradient(st.fill.url, m, { x: 0, y: 0, w: 1, h: 1 }) || { st: [[0, [0, 0, 0]]] }).st[0][1] : st.fill === "none" ? null : [0, 0, 0];
            if (fill && out.pieces.length < 20000) out.pieces.push({ s: str, x: p[0], y: p[1], w: adv * sc, size: size * sc, rot: rot, fam: f.font, b: b, i: i, color: fill });
            pen.x += adv;
          } else if (ch.n === "tspan" || ch.n === "textPath") {
            run(ch, stateOf(ch, st), false);
          }
        });
      }
      run(node, s, true);
    }

    function walk(node, up, m, depth, via) {
      if (depth > MAX_DEPTH || full()) return;
      if (SKIP[node.n]) return;
      var s = stateOf(node, up);
      if (s.hidden && node.n !== "g") return;
      var mm = mul(m, transform(node.a.transform));
      var n = node.n;
      if (n === "svg" && depth > 0) {
        mm = mul(mm, [1, 0, 0, 1, num(node.a.x, 0), num(node.a.y, 0)]);
        n = "g";
      }
      if (n === "svg" || n === "g" || n === "a" || n === "symbol") {
        if (s.hidden) return;
        node.c.forEach(function (ch) { walk(ch, s, mm, depth + 1, via); });
      } else if (n === "switch") {
        var ch0 = node.c.filter(function (c) { return c.n !== "#text" && !SKIP[c.n]; })[0];
        if (ch0) walk(ch0, s, mm, depth + 1, via);
      } else if (n === "use") {
        var ref = String(node.a.href || node.a["xlink:href"] || "").replace(/^#/, ""), tgt = ids[ref];
        if (!tgt || via[ref] || /^https?:|^data:/i.test(ref)) return;
        var v2 = {}; Object.keys(via).forEach(function (k) { v2[k] = 1; }); v2[ref] = 1;
        var um = mul(mm, [1, 0, 0, 1, num(node.a.x, 0), num(node.a.y, 0)]);
        if (tgt.n === "symbol") tgt.c.forEach(function (ch) { walk(ch, s, um, depth + 1, v2); });
        else walk(tgt.n === "defs" ? { n: "g", a: {}, c: tgt.c } : tgt, s, um, depth + 1, v2);
      } else if (n === "rect" || n === "circle" || n === "ellipse" || n === "line" || n === "polyline" || n === "polygon" || n === "path") shape(node, s, mm);
      else if (n === "image") image(node, s, mm);
      else if (n === "text") text(node, s, mm);
      else if (n !== "#text") out.skipped++;
    }
    walk(svg, { op: 1 }, base, 0, {});
    return out;
  }
  function find(n, name) {
    if (n.n === name) return n;
    for (var i = 0; i < n.c.length; i++) { var r = find(n.c[i], name); if (r) return r; }
    return null;
  }

  // ---------- 5. Pages → document ----------
  // parsed: [page from parse()]; opts { now, name }. Pictures keep a
  // `ref` to their entry in page.images, for open() to store. →
  // { doc, images: [{ item (id), name, mime, data }], linked, stats }
  function convert(parsed, opts) {
    opts = opts || {};
    parsed = parsed.filter(Boolean).slice(0, MAX_PAGES);
    if (!parsed.length) return null;
    var pages = parsed.map(function (p) {
      return { w: p.w, h: p.h, blocks: P.toBlocks(P.toLines(p.pieces)), shapes: p.items };
    });
    var res = P.buildDoc(pages, { now: opts.now, name: opts.name || "SVG" });
    if (!res) return null;
    var images = [], linked = 0, skipped = 0;
    parsed.forEach(function (p, k) {
      linked += p.linked; skipped += p.skipped;
      (p.images || []).forEach(function (im) {
        var id = res.shapeIds[k][p.items.indexOf(im.item)];
        if (id) images.push({ item: id, name: im.item.nm, mime: im.mime, data: im.data });
      });
    });
    res.stats.skipped = skipped;
    return { doc: res.doc, images: images, linked: linked, stats: res.stats };
  }
  function imageBlob(im) {
    var bin;
    try { bin = atob(im.data); } catch (e) { return null; }
    var u = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
    return new Blob([u], { type: im.mime === "image/jpg" ? "image/jpeg" : im.mime });
  }

  var api = { parse: parse, convert: convert, imageBlob: imageBlob, lenPt: lenPt, colour: colour, transform: transform, guessScale: guessScale, MAX_FILE: MAX_FILE };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.LY_SVGIN = api;
})(typeof window !== "undefined" ? window : this);
