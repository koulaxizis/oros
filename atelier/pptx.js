// ============================================================
// orOS Atelier — pptx.js: PowerPoint (.pptx) import (v1.0.0)
// Made for designs downloaded from Canva as "Microsoft PowerPoint",
// works with any .pptx. Two steps, both pure (no DOM, Node-testable):
//   parse(zip) → Promise<plan>: reads the slides into a neutral plan
//     { w, h, name, pages:[{ bg, items:[…] }], media:{path:true},
//       svgs:{key:svg}, skipped }
//     sizes in points (1 EMU = 1/12700 pt), x/y/w/h/rot per item.
//   build(plan, assets, now) → { doc, missing }: a NEW Atelier design;
//     assets maps media paths and svg keys to imported images
//     { id, w, h } (io.js stores them with designkit/assets.js).
// What maps: text boxes (first run's look for the whole box: font
// by name → its Fontsource family, or sans/serif/mono for system and
// Canva-only fonts; size incl. autofit, bold,
// italic, underline, caps, colour, alignment, line and letter
// spacing, top/middle/bottom anchor), preset shapes Atelier also
// has (fill, gradient, outline), other shapes and custom geometry
// as a picture (an SVG drawn once, never executed: it goes through
// <img>), pictures (crop, flips, round/ellipse mask, transparency),
// lines and arrows, groups (flattened), slide/layout/master
// background (colour, gradient, picture), theme colours with
// lumMod/lumOff/tint/shade. Not mapped (counted in plan.skipped):
// charts, tables, media, SmartArt, OLE objects.
// The XML is read by a small tolerant parser below: no DTDs, no
// external entities, nothing in the file can fetch or run anything.
// Exposes window.AtelierPPTX (browser) or module.exports.
// ============================================================
(function (root) {
  "use strict";

  var AX, M;
  if (typeof module !== "undefined" && module.exports) {
    AX = require("./ax.js"); M = require("../designkit/model.js");
  } else {
    AX = root.AtelierAX; M = root.orosDK.model;
  }

  var EMU = 12700;                       // EMU per point
  var MAX_SLIDES = 200, MAX_XML = 16 * 1024 * 1024, MAX_NODES = 400000;

  // ---------- 1. XML ----------
  var ENT = { lt: "<", gt: ">", amp: "&", quot: "\"", apos: "'" };
  function unesc(s) {
    if (s.indexOf("&") < 0) return s;
    return s.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|[a-z]+);/g, function (m, e) {
      if (e[0] === "#") {
        var n = e[1] === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
        return n > 0 && n < 0x110000 ? String.fromCodePoint(n) : "";
      }
      return Object.prototype.hasOwnProperty.call(ENT, e) ? ENT[e] : m;
    });
  }
  // → { n, a:{}, c:[nodes], t:"text of direct children" }
  function parseXml(src) {
    var rootNode = { n: "#doc", a: {}, c: [], t: "" }, stack = [rootNode], i = 0, L = src.length, count = 0;
    while (i < L) {
      var lt = src.indexOf("<", i);
      if (lt < 0) lt = L;
      if (lt > i) stack[stack.length - 1].t += unesc(src.slice(i, lt));
      if (lt >= L) break;
      if (src.startsWith("<!--", lt)) { var ce = src.indexOf("-->", lt + 4); i = ce < 0 ? L : ce + 3; continue; }
      if (src.startsWith("<![CDATA[", lt)) {
        var de = src.indexOf("]]>", lt + 9);
        stack[stack.length - 1].t += src.slice(lt + 9, de < 0 ? L : de);
        i = de < 0 ? L : de + 3; continue;
      }
      if (src[lt + 1] === "?" || src[lt + 1] === "!") { var pe = src.indexOf(">", lt); i = pe < 0 ? L : pe + 1; continue; }
      var gt = src.indexOf(">", lt);
      if (gt < 0) break;
      var body = src.slice(lt + 1, gt);
      i = gt + 1;
      if (body[0] === "/") { if (stack.length > 1) stack.pop(); continue; }
      var self = body[body.length - 1] === "/";
      if (self) body = body.slice(0, -1);
      var m = /^([^\s]+)/.exec(body);
      if (!m) continue;
      var node = { n: m[1], a: {}, c: [], t: "" };
      var re = /([^\s=]+)\s*=\s*("([^"]*)"|'([^']*)')/g, am;
      re.lastIndex = m[1].length;
      while ((am = re.exec(body))) node.a[am[1]] = unesc(am[3] !== undefined ? am[3] : am[4]);
      if (++count > MAX_NODES) throw new Error("xml");
      stack[stack.length - 1].c.push(node);
      if (!self) stack.push(node);
    }
    return rootNode;
  }
  function kid(n, name) {
    if (!n) return null;
    for (var i = 0; i < n.c.length; i++) if (n.c[i].n === name) return n.c[i];
    return null;
  }
  function kids(n, name) { return n ? n.c.filter(function (x) { return x.n === name; }) : []; }
  function path(n, names) {
    for (var i = 0; i < names.length && n; i++) n = kid(n, names[i]);
    return n;
  }
  function find(n, name) {            // first descendant, depth first
    if (!n) return null;
    for (var i = 0; i < n.c.length; i++) {
      if (n.c[i].n === name) return n.c[i];
      var f = find(n.c[i], name);
      if (f) return f;
    }
    return null;
  }
  function numA(n, k, def) { var v = n && n.a[k] !== undefined ? Number(n.a[k]) : NaN; return isFinite(v) ? v : def; }

  // ---------- 2. Package parts ----------
  function dirOf(p) { var i = p.lastIndexOf("/"); return i < 0 ? "" : p.slice(0, i + 1); }
  function resolve(base, target) {
    if (/^[a-z]+:/i.test(target)) return null;               // external links: never fetched
    var parts = (target[0] === "/" ? target.slice(1) : dirOf(base) + target).split("/"), out = [];
    parts.forEach(function (s) { if (s === "..") out.pop(); else if (s && s !== ".") out.push(s); });
    return out.join("/");
  }
  function relsPath(p) { return dirOf(p) + "_rels/" + p.slice(dirOf(p).length) + ".rels"; }

  function loader(zip) {
    var cache = {};
    function xml(p) {
      if (!p || !zip.has(p)) return Promise.resolve(null);
      if (!cache[p]) cache[p] = zip.text(p, MAX_XML).then(parseXml);
      return cache[p];
    }
    function rels(p) {
      return xml(relsPath(p)).then(function (doc) {
        var map = {};
        kids(kid(doc, "Relationships"), "Relationship").forEach(function (r) {
          if (r.a.TargetMode === "External") return;
          var t = resolve(p, r.a.Target || "");
          if (t) map[r.a.Id] = { target: t, type: (r.a.Type || "").split("/").pop() };
        });
        return map;
      });
    }
    return { xml: xml, rels: rels };
  }

  // ---------- 3. Colours ----------
  var SCHEME_MAP = { tx1: "dk1", bg1: "lt1", tx2: "dk2", bg2: "lt2" };
  var PRESET = { black: "000000", white: "ffffff", red: "ff0000", green: "008000", blue: "0000ff", yellow: "ffff00", gray: "808080", grey: "808080" };
  function hex2(n) { n = Math.max(0, Math.min(255, Math.round(n))); return (n < 16 ? "0" : "") + n.toString(16); }
  function toHsl(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    var mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2, h = 0, s = 0;
    if (mx !== mn) {
      var d = mx - mn;
      s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
      h = mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
      h /= 6;
    }
    return [h, s, l];
  }
  function fromHsl(h, s, l) {
    function f(p, q, t) {
      if (t < 0) t += 1; if (t > 1) t -= 1;
      if (t < 1 / 6) return p + (q - p) * 6 * t;
      if (t < 1 / 2) return q;
      if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
      return p;
    }
    if (!s) return [l * 255, l * 255, l * 255];
    var q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
    return [f(p, q, h + 1 / 3) * 255, f(p, q, h) * 255, f(p, q, h - 1 / 3) * 255];
  }
  // a colour node (srgbClr, schemeClr, …) → { c:"#rrggbb", a:0..1 }
  function colourOf(n, theme, phClr) {
    if (!n) return null;
    var hex = null;
    if (n.n === "a:srgbClr") hex = n.a.val;
    else if (n.n === "a:schemeClr") {
      var key = n.a.val === "phClr" ? null : SCHEME_MAP[n.a.val] || n.a.val;
      hex = key ? theme[key] : (phClr && phClr.c.slice(1));
    } else if (n.n === "a:sysClr") hex = n.a.lastClr || (n.a.val === "window" ? "ffffff" : "000000");
    else if (n.n === "a:prstClr") hex = PRESET[n.a.val] || "000000";
    else if (n.n === "a:scrgbClr") hex = hex2(numA(n, "r", 0) / 100000 * 255) + hex2(numA(n, "g", 0) / 100000 * 255) + hex2(numA(n, "b", 0) / 100000 * 255);
    else if (n.n === "a:hslClr") { var q = fromHsl(numA(n, "hue", 0) / 21600000, numA(n, "sat", 0) / 100000, numA(n, "lum", 0) / 100000); hex = hex2(q[0]) + hex2(q[1]) + hex2(q[2]); }
    if (!hex || !/^[0-9a-fA-F]{6}$/.test(hex)) return null;
    var r = parseInt(hex.slice(0, 2), 16), g = parseInt(hex.slice(2, 4), 16), b = parseInt(hex.slice(4, 6), 16), a = 1;
    n.c.forEach(function (m) {
      var v = numA(m, "val", 0) / 100000;
      if (m.n === "a:alpha") a = v;
      else if (m.n === "a:tint") { r = 255 - (255 - r) * v; g = 255 - (255 - g) * v; b = 255 - (255 - b) * v; }
      else if (m.n === "a:shade") { r *= v; g *= v; b *= v; }
      else if (m.n === "a:lumMod" || m.n === "a:lumOff") {
        var hsl = toHsl(r, g, b);
        hsl[2] = m.n === "a:lumMod" ? hsl[2] * v : Math.min(1, hsl[2] + v);
        var o = fromHsl(hsl[0], hsl[1], hsl[2]); r = o[0]; g = o[1]; b = o[2];
      }
    });
    return { c: "#" + hex2(r) + hex2(g) + hex2(b), a: Math.max(0, Math.min(1, a)) };
  }
  var COLOUR_NODES = ["a:srgbClr", "a:schemeClr", "a:sysClr", "a:prstClr", "a:scrgbClr", "a:hslClr"];
  function colourIn(n, theme, phClr) {
    if (!n) return null;
    for (var i = 0; i < n.c.length; i++) if (COLOUR_NODES.indexOf(n.c[i].n) >= 0) return colourOf(n.c[i], theme, phClr);
    return null;
  }
  // fill of an spPr / bgPr: { fc, a } | { g:{a,b,ang} } | { blip } | { none } | null
  function fillOf(pr, theme, phClr) {
    if (!pr) return null;
    if (kid(pr, "a:noFill")) return { none: true };
    var sf = kid(pr, "a:solidFill");
    if (sf) { var c = colourIn(sf, theme, phClr); return c ? { fc: c.c, a: c.a } : null; }
    var gf = kid(pr, "a:gradFill");
    if (gf) {
      var stops = kids(kid(gf, "a:gsLst"), "a:gs").map(function (s) { return { pos: numA(s, "pos", 0), c: colourIn(s, theme, phClr) }; })
        .filter(function (s) { return s.c; }).sort(function (x, y) { return x.pos - y.pos; });
      if (!stops.length) return null;
      var lin = kid(gf, "a:lin"), ang = lin ? numA(lin, "ang", 0) / 60000 : 90;
      if (stops.length === 1) return { fc: stops[0].c.c, a: stops[0].c.a };
      return { g: { a: stops[0].c.c, b: stops[stops.length - 1].c.c, ang: Math.round(((ang + 90) % 360 + 360) % 360) } };
    }
    var bf = kid(pr, "a:blipFill");
    if (bf) return { blip: bf };
    return null;
  }

  // ---------- 4. Geometry ----------
  // xfrm → box in points; groups pass a transform { ox, oy, sx, sy }
  function boxOf(xfrm, tf) {
    if (!xfrm) return null;
    var off = kid(xfrm, "a:off"), ext = kid(xfrm, "a:ext");
    if (!off || !ext) return null;
    var x = numA(off, "x", 0), y = numA(off, "y", 0), w = numA(ext, "cx", 0), h = numA(ext, "cy", 0);
    var b = {
      x: tf.ox + x * tf.sx, y: tf.oy + y * tf.sy, w: w * tf.sx, h: h * tf.sy,
      rot: numA(xfrm, "rot", 0) / 60000 + tf.rot,
      flh: xfrm.a.flipH === "1" || xfrm.a.flipH === "true", flv: xfrm.a.flipV === "1" || xfrm.a.flipV === "true"
    };
    return b;
  }
  function pt(v) { return Math.round(v / EMU * 100) / 100; }
  function ptBox(b) { return { x: pt(b.x), y: pt(b.y), w: pt(b.w), h: pt(b.h), rot: Math.round(((b.rot % 360) + 540) % 360 - 180) }; }

  var PRST = {
    rect: "rect", roundRect: "rounded", snipRoundRect: "rounded", round2SameRect: "rounded", ellipse: "circle",
    triangle: "triangle", rtTriangle: "rtriangle", diamond: "diamond", pentagon: "pentagon", homePlate: null,
    hexagon: "hexagon", octagon: "octagon", star5: "star", star4: null, heart: "heart", plus: "cross",
    rightArrow: "arrow", chevron: "chevron", parallelogram: "parallelogram", trapezoid: "trapezoid",
    teardrop: "drop", wedgeRoundRectCallout: "bubble", wedgeRectCallout: "bubble", star16: "burst", star24: "burst", star32: "burst"
  };
  var LINE_PRST = ["line", "straightConnector1", "bentConnector2", "bentConnector3", "curvedConnector3"];

  // custom geometry → SVG path data in the shape's own box (points)
  function f2(v) { return String(Math.round(v * 100) / 100); }
  function custPath(cust, w, h) {
    var out = [];
    kids(kid(cust, "a:pathLst"), "a:path").forEach(function (p) {
      var pw = numA(p, "w", 0) || w * EMU, ph = numA(p, "h", 0) || h * EMU;
      var kx = w / pw, ky = h / ph, cx = 0, cy = 0;
      function P(n) { return [numA(n, "x", 0) * kx, numA(n, "y", 0) * ky]; }
      p.c.forEach(function (c) {
        var pts = kids(c, "a:pt").map(P);
        if (c.n === "a:moveTo" && pts[0]) { out.push("M" + f2(pts[0][0]) + " " + f2(pts[0][1])); cx = pts[0][0]; cy = pts[0][1]; }
        else if (c.n === "a:lnTo" && pts[0]) { out.push("L" + f2(pts[0][0]) + " " + f2(pts[0][1])); cx = pts[0][0]; cy = pts[0][1]; }
        else if (c.n === "a:cubicBezTo" && pts.length === 3) { out.push("C" + pts.map(function (q) { return f2(q[0]) + " " + f2(q[1]); }).join(" ")); cx = pts[2][0]; cy = pts[2][1]; }
        else if (c.n === "a:quadBezTo" && pts.length === 2) { out.push("Q" + pts.map(function (q) { return f2(q[0]) + " " + f2(q[1]); }).join(" ")); cx = pts[1][0]; cy = pts[1][1]; }
        else if (c.n === "a:arcTo") {
          var wr = numA(c, "wR", 0) * kx, hr = numA(c, "hR", 0) * ky;
          var st = numA(c, "stAng", 0) / 60000 * Math.PI / 180, sw = numA(c, "swAng", 0) / 60000 * Math.PI / 180;
          if (!wr || !hr || !sw) return;
          var ox = cx - wr * Math.cos(st), oy = cy - hr * Math.sin(st);
          var ex = ox + wr * Math.cos(st + sw), ey = oy + hr * Math.sin(st + sw);
          if (Math.abs(sw) >= 2 * Math.PI - 1e-6) {          // full ellipse: two halves
            var mx = ox + wr * Math.cos(st + Math.PI), my = oy + hr * Math.sin(st + Math.PI);
            out.push("A" + [wr, hr, 0, 0, sw > 0 ? 1 : 0, mx, my].map(f2).join(" "));
          }
          out.push("A" + [wr, hr, 0, Math.abs(sw) > Math.PI ? 1 : 0, sw > 0 ? 1 : 0, ex, ey].map(f2).join(" "));
          cx = ex; cy = ey;
        } else if (c.n === "a:close") out.push("Z");
      });
    });
    return out.join("");
  }
  function esc(s) { return String(s).replace(/[<>&"']/g, function (c) { return { "<": "&lt;", ">": "&gt;", "&": "&amp;", "\"": "&quot;", "'": "&#39;" }[c]; }); }
  function svgOf(d, w, h, fill, stroke, sw) {
    var k = Math.max(1, Math.min(4, 1200 / Math.max(w, h, 1)));        // draw it sharp enough
    var pad = stroke && sw ? sw / 2 + 1 : 0;
    var vw = w + pad * 2, vh = h + pad * 2;
    var attrs = "fill=\"" + (fill ? esc(fill.c) + "\" fill-opacity=\"" + f2(fill.a) : "none") + "\"" +
      (stroke && sw ? " stroke=\"" + esc(stroke.c) + "\" stroke-opacity=\"" + f2(stroke.a) + "\" stroke-width=\"" + f2(sw) + "\" stroke-linejoin=\"round\"" : "");
    return {
      svg: "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"" + f2(vw * k) + "\" height=\"" + f2(vh * k) + "\" viewBox=\"" +
        [-pad, -pad, vw, vh].map(f2).join(" ") + "\"><path d=\"" + esc(d) + "\" " + attrs + " fill-rule=\"evenodd\"/></svg>",
      pad: pad
    };
  }

  // ---------- 5. Text ----------
  var SERIF = /serif|times|garamond|georgia|playfair|merriweather|lora|baskerville|bodoni|didot|cormorant|crimson|libre ?bask|abril|prata|cinzel|spectral|noto serif|pt serif|caslon|cambria|book antiqua|palatino|minion|tinos|gelasio|domine|zilla|arvo|rockwell|bitter|alice|yeseva|dm serif/i;
  var MONO = /mono|courier|consolas|code|menlo|inconsolata|fira code|source code|space mono|ubuntu mono/i;
  function familyOf(name) {
    if (!name) return "sans";
    if (MONO.test(name)) return "mono";
    if (/sans/i.test(name)) return "sans";
    return SERIF.test(name) ? "serif" : "sans";
  }
  // Fonts that are not on Fontsource (system, Office, Canva's own):
  // they become the closest built-in family.
  var NOT_FS = /^(arial|arial black|arial narrow|helvetica|helvetica neue|calibri|calibri light|cambria|candara|consolas|constantia|corbel|segoe ui|segoe print|segoe script|tahoma|verdana|trebuchet ms|times|times new roman|georgia|garamond|book antiqua|palatino|palatino linotype|century gothic|franklin gothic|gill sans|futura|avenir|myriad pro|minion pro|impact|comic sans ms|courier|courier new|lucida console|lucida sans|symbol|wingdings|webdings|canva sans|canva serif|canva student font|open sauce|open sauce one|glacial indifference|tt norms|now|brittany|more sugar|horizon|the seasons|aileron|bebas neue pro|league gothic|chunkfive)$/i;
  var WEIGHT = /[\s-]+(thin|hairline|extra ?light|ultra ?light|light|regular|book|normal|medium|semi ?bold|demi ?bold|bold|extra ?bold|ultra ?bold|heavy|black|italic|oblique)$/i;
  // A typeface name from the file → { font: built-in or Fontsource
  // id ("fs_<id>"), name, bold, italic }. Canva writes weights into
  // the name ("Montserrat Bold"); Fontsource ids are the family name
  // in lower case with dashes. A family Fontsource lacks shows in
  // Sans until then (text.js falls back quietly).
  function fontFor(name) {
    var n = String(name || "").replace(/[\u0000-\u001f]/g, "").trim(), b = 0, i = 0, m;
    while ((m = WEIGHT.exec(n))) {
      var w = m[1].toLowerCase().replace(/\s/g, "");
      if (/semibold|demibold|bold|extrabold|ultrabold|heavy|black/.test(w)) b = 1;
      if (/italic|oblique/.test(w)) i = 1;
      n = n.slice(0, m.index).trim();
    }
    if (!n || NOT_FS.test(n) || /^(sans|serif|mono|sans-serif|monospace|noto sans|noto serif|noto sans mono)$/i.test(n)) return { font: familyOf(n), name: n, b: b, i: i };
    var slug = n.toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
    if (!slug || slug.length > 58) return { font: familyOf(n), name: n, b: b, i: i };
    var id = AX.fsIdOf(slug);
    return { font: AX.isExtraFont(id) ? id : familyOf(n), name: n, b: b, i: i };
  }
  var ALIGN = { l: "l", ctr: "c", r: "r", just: "j", dist: "j" };

  function textOf(txBody, ctx) {
    var paras = kids(txBody, "a:p"), lines = [], first = null, firstP = null, maxSz = 0;
    paras.forEach(function (p) {
      var s = "";
      p.c.forEach(function (r) {
        if (r.n === "a:r" || r.n === "a:fld") {
          var t = kid(r, "a:t"), str = t ? t.t : "";
          s += str;
          var rp = kid(r, "a:rPr");
          if (str.trim() && !first) { first = rp || { n: "a:rPr", a: {}, c: [] }; firstP = p; }
          if (rp) maxSz = Math.max(maxSz, numA(rp, "sz", 0));
        } else if (r.n === "a:br") s += "\n";
      });
      lines.push(s);
    });
    var tx = lines.join("\n").replace(/\s+$/, "");
    if (!tx.trim()) return null;
    var lst = ctx.lst || {};                       // inherited defaults (placeholder / master)
    var rp = first || {};
    var ra = rp.a || {};
    var sz = numA(rp, "sz", 0) || lst.sz || 1800;
    var latin = kid(rp, "a:latin"), font = latin && latin.a.typeface || lst.font || "";
    if (/^\+m[nj]-/.test(font)) font = ctx.themeFont;
    var col = colourIn(kid(rp, "a:solidFill"), ctx.theme) || lst.colour || { c: "#000000", a: 1 };
    var pPr = kid(firstP, "a:pPr"), algn = pPr && pPr.a.algn || lst.algn || "l";
    var lnPct = 100, sp = path(pPr, ["a:lnSpc", "a:spcPct"]);
    if (sp) lnPct = numA(sp, "val", 100000) / 1000;
    var autofit = path(txBody, ["a:bodyPr", "a:normAutofit"]);
    var scale = autofit ? numA(autofit, "fontScale", 100000) / 100000 : 1;
    var lnRed = autofit ? numA(autofit, "lnSpcReduction", 0) / 100000 : 0;
    var size = Math.max(2, Math.round(sz / 100 * scale * 100) / 100);
    var spc = numA(rp, "spc", 0) / 100;            // points
    var ff = fontFor(font);
    var bold = ra.b !== undefined ? ra.b === "1" || ra.b === "true" : !!lst.b || !!ff.b;
    var ital = ra.i !== undefined ? ra.i === "1" || ra.i === "true" : !!lst.i || !!ff.i;
    return {
      tx: tx, font: ff.font, fontName: ff.name, size: size,
      b: bold ? 1 : 0, i: ital ? 1 : 0, u: ra.u && ra.u !== "none" ? 1 : 0, caps: ra.cap === "all" ? 1 : 0,
      al: ALIGN[algn] || "l", lh: Math.round(Math.max(70, Math.min(300, 120 * lnPct / 100 * (1 - lnRed)))),
      tr: spc ? Math.round(spc / size * 1000) : 0, fc: col.c, op: col.a
    };
  }
  function bodyBox(txBody, box) {
    var bp = kid(txBody, "a:bodyPr") || { a: {} };
    var l = numA(bp, "lIns", 91440), r = numA(bp, "rIns", 91440), t = numA(bp, "tIns", 45720), b = numA(bp, "bIns", 45720);
    var vert = bp.a && bp.a.vert;
    return {
      x: box.x + l, y: box.y + t, w: Math.max(EMU, box.w - l - r), h: Math.max(EMU, box.h - t - b),
      rot: box.rot + (vert === "vert" ? 90 : vert === "vert270" ? -90 : 0), flh: false, flv: false,
      anchor: bp.a && bp.a.anchor || "t"
    };
  }

  // ---------- 6. Slides ----------
  function phKey(sp) {
    var nv = kid(sp, "p:nvSpPr") || kid(sp, "p:nvPicPr") || kid(sp, "p:nvCxnSpPr");
    var ph = nv && find(nv, "p:ph");
    return ph ? { type: ph.a.type || "body", idx: ph.a.idx || "" } : null;
  }
  // placeholders the slide inherits from: layout first, then master
  function phLookup(trees, key) {
    var hits = [];
    trees.forEach(function (tree) {
      if (!tree) return;
      var hit = null;
      (function walk(n) {
        n.c.forEach(function (c) {
          if (hit) return;
          if (c.n === "p:sp") {
            var k = phKey(c);
            if (k && ((key.idx && k.idx === key.idx) || k.type === key.type || (key.type === "ctrTitle" && k.type === "title") || (key.type === "subTitle" && k.type === "body"))) hit = c;
          } else if (c.n === "p:grpSp") walk(c);
        });
      })(tree);
      if (hit) hits.push(hit);
    });
    return hits;
  }
  function phBox(hits, tf) {
    for (var i = 0; i < hits.length; i++) {
      var b = boxOf(path(hits[i], ["p:spPr", "a:xfrm"]), tf);
      if (b) return b;
    }
    return null;
  }
  function lstOf(sp, theme) {
    var lvl = path(sp, ["p:txBody", "a:lstStyle", "a:lvl1pPr"]), o = {};
    if (!lvl) return o;
    if (lvl.a.algn) o.algn = lvl.a.algn;
    var d = kid(lvl, "a:defRPr");
    if (d) {
      if (d.a.sz) o.sz = numA(d, "sz", 0);
      if (d.a.b) o.b = d.a.b === "1";
      if (d.a.i) o.i = d.a.i === "1";
      var lat = kid(d, "a:latin"); if (lat) o.font = lat.a.typeface;
      var c = colourIn(kid(d, "a:solidFill"), theme); if (c) o.colour = c;
    }
    return o;
  }

  function walkTree(tree, tf, ctx, out) {
    tree.c.forEach(function (n) {
      try { walkNode(n, tf, ctx, out); } catch (e) { out.skipped++; }
    });
  }

  function walkNode(n, tf, ctx, out) {
    var nv = kid(n, "p:nvSpPr") || kid(n, "p:nvPicPr") || kid(n, "p:nvGrpSpPr") || kid(n, "p:nvCxnSpPr") || kid(n, "p:nvGraphicFramePr");
    var cNvPr = nv && kid(nv, "p:cNvPr");
    if (cNvPr && (cNvPr.a.hidden === "1" || cNvPr.a.hidden === "true")) return;
    if (n.n === "p:grpSp") {
      var gx = path(n, ["p:grpSpPr", "a:xfrm"]);
      if (!gx) { walkTree(n, tf, ctx, out); return; }
      var off = kid(gx, "a:off"), ext = kid(gx, "a:ext"), cho = kid(gx, "a:chOff"), che = kid(gx, "a:chExt");
      var sx = che && numA(che, "cx", 0) ? numA(ext, "cx", 0) / numA(che, "cx", 1) : 1;
      var sy = che && numA(che, "cy", 0) ? numA(ext, "cy", 0) / numA(che, "cy", 1) : 1;
      var t2 = {
        ox: tf.ox + (numA(off, "x", 0) - (cho ? numA(cho, "x", 0) : 0) * sx) * tf.sx,
        oy: tf.oy + (numA(off, "y", 0) - (cho ? numA(cho, "y", 0) : 0) * sy) * tf.sy,
        sx: tf.sx * sx, sy: tf.sy * sy, rot: tf.rot + numA(gx, "rot", 0) / 60000
      };
      walkTree(n, t2, ctx, out);
      return;
    }
    if (n.n === "p:pic") { picture(n, tf, ctx, out); return; }
    if (n.n === "p:sp" || n.n === "p:cxnSp") { shape(n, tf, ctx, out); return; }
    if (n.n === "p:graphicFrame" || n.n === "mc:AlternateContent" || n.n === "p:contentPart") { out.skipped++; return; }
  }

  function picture(n, tf, ctx, out) {
    var spPr = kid(n, "p:spPr");
    var box = boxOf(kid(spPr, "a:xfrm"), tf);
    if (!box) {
      var k = phKey(n);
      box = k && phBox(phLookup(ctx.phTrees, k), tf);
    }
    var blipFill = kid(n, "p:blipFill");
    var blip = kid(blipFill, "a:blip");
    var rel = blip && ctx.rels[blip.a["r:embed"]];
    if (!box || !rel || !/^ppt\/media\//.test(rel.target) || !/\.(png|jpe?g|gif|bmp|webp|svg)$/i.test(rel.target)) { out.skipped++; return; }
    var src = kid(blipFill, "a:srcRect"), crop = null;
    if (src) crop = { l: numA(src, "l", 0) / 100000, t: numA(src, "t", 0) / 100000, r: numA(src, "r", 0) / 100000, b: numA(src, "b", 0) / 100000 };
    var am = kid(blip, "a:alphaModFix");
    var prst = path(spPr, ["a:prstGeom"]), shp = prst ? PRST[prst.a.prst] || "" : "";
    var it = ptBox(box);
    it.k = "photo"; it.img = rel.target; it.crop = crop;
    if (shp && shp !== "rect") it.shp = shp;
    if (box.flh) it.flh = 1;
    if (box.flv) it.flv = 1;
    if (am) it.op = Math.round(numA(am, "amt", 100000) / 1000);
    out.media[rel.target] = true;
    out.items.push(it);
  }

  function outline(spPr, ctx, style) {
    var ln = kid(spPr, "a:ln");
    if (ln && kid(ln, "a:noFill")) return null;
    var c = ln && colourIn(kid(ln, "a:solidFill"), ctx.theme);
    if (!c && style) { var lr = kid(style, "a:lnRef"); if (lr && numA(lr, "idx", 0) > 0) c = colourIn(lr, ctx.theme); }
    if (!c) return null;
    var w = ln ? numA(ln, "w", 12700) : 12700;
    return { c: c, w: pt(w), head: ln && kid(ln, "a:headEnd"), tail: ln && kid(ln, "a:tailEnd") };
  }
  function headOf(n) {
    var t = n && n.a.type;
    if (!t || t === "none") return "";
    return t === "oval" ? "dot" : "arrow";
  }

  function shape(n, tf, ctx, out) {
    var spPr = kid(n, "p:spPr"), style = kid(n, "p:style");
    var k = phKey(n), phs = k ? phLookup(ctx.phTrees, k) : [];
    var box = boxOf(kid(spPr, "a:xfrm"), tf) || phBox(phs, tf);
    if (!box) { out.skipped++; return; }
    var prst = kid(spPr, "a:prstGeom"), cust = kid(spPr, "a:custGeom");
    var prstId = prst ? prst.a.prst : cust ? "" : "rect";
    var line = outline(spPr, ctx, style);

    // lines and connectors
    if (n.n === "p:cxnSp" || LINE_PRST.indexOf(prstId) >= 0) {
      if (!line) { out.skipped++; return; }
      var x0 = box.x, y0 = box.y, x1 = box.x + box.w, y1 = box.y + box.h;
      if (box.flh) { var tx0 = x0; x0 = x1; x1 = tx0; }
      if (box.flv) { var ty0 = y0; y0 = y1; y1 = ty0; }
      if (box.rot) {
        var cx = box.x + box.w / 2, cy = box.y + box.h / 2, a = box.rot * Math.PI / 180;
        var rotp = function (x, y) { return [cx + (x - cx) * Math.cos(a) - (y - cy) * Math.sin(a), cy + (x - cx) * Math.sin(a) + (y - cy) * Math.cos(a)]; };
        var p0 = rotp(x0, y0), p1 = rotp(x1, y1); x0 = p0[0]; y0 = p0[1]; x1 = p1[0]; y1 = p1[1];
      }
      var li = { k: "line", x: pt(x0), y: pt(y0), w: pt(x1 - x0), h: pt(y1 - y0), rot: 0, sc: line.c.c, sw: Math.max(0.5, line.w) };
      var as = headOf(line.head), ae = headOf(line.tail);
      if (as) li.as = as;
      if (ae) li.ae = ae;
      if (line.c.a < 1) li.op = Math.round(line.c.a * 100);
      out.items.push(li);
      return;
    }

    var fill = fillOf(spPr, ctx.theme);
    if (!fill && style) { var fr = kid(style, "a:fillRef"); if (fr && numA(fr, "idx", 0) > 0) { var fcol = colourIn(fr, ctx.theme); if (fcol) fill = { fc: fcol.c, a: fcol.a }; } }
    var visible = (fill && !fill.none) || line;
    var b = ptBox(box);

    if (visible) {
      var shp = PRST[prstId];
      if (fill && fill.blip) {
        var bl = kid(fill.blip, "a:blip"), rel = bl && ctx.rels[bl.a["r:embed"]];
        if (rel && /^ppt\/media\//.test(rel.target)) {
          var ph2 = { k: "photo", x: b.x, y: b.y, w: b.w, h: b.h, rot: b.rot, img: rel.target, crop: null };
          if (shp && shp !== "rect") ph2.shp = shp;
          out.media[rel.target] = true;
          out.items.push(ph2);
        } else out.skipped++;
      } else if (shp && !box.flh && !box.flv || shp === "rect" || shp === "circle" || shp === "rounded") {
        var s = { k: "shape", shp: shp, x: b.x, y: b.y, w: b.w, h: b.h, rot: b.rot };
        if (fill && fill.g) s.g = fill.g;
        else if (fill && fill.fc) { s.fc = fill.fc; if (fill.a < 1) s.op = Math.round(fill.a * 100); }
        if (line) { s.sc = line.c.c; s.sw = Math.max(0.5, line.w); }
        if (shp === "rounded") {
          var gd = find(kid(prst, "a:avLst"), "a:gd");
          var adj = gd ? Number((gd.a.fmla || "").replace(/^val\s+/, "")) : 16667;
          if (isFinite(adj)) s.rd = Math.max(0, Math.min(100, Math.round(adj / 50000 * 100)));
        }
        out.items.push(s);
      } else if (cust || prstId) {
        // any other geometry: drawn once as a picture
        var d = cust ? custPath(cust, b.w, b.h) : "";
        if (!d) {
          // a preset Atelier lacks: its bounding box keeps the colour
          var r = { k: "shape", shp: "rect", x: b.x, y: b.y, w: b.w, h: b.h, rot: b.rot };
          if (fill && fill.fc) r.fc = fill.fc;
          else if (fill && fill.g) r.g = fill.g;
          out.items.push(r);
          out.approx++;
        } else {
          var fl = fill && fill.fc ? { c: fill.fc, a: fill.a } : fill && fill.g ? { c: fill.g.a, a: 1 } : null;
          var sv = svgOf(d, b.w, b.h, fl, line && line.c, line && line.w);
          var key = "svg" + Object.keys(out.svgs).length;
          out.svgs[key] = sv.svg;
          var g = { k: "photo", x: b.x - sv.pad, y: b.y - sv.pad, w: b.w + sv.pad * 2, h: b.h + sv.pad * 2, rot: b.rot, img: key, crop: null, svg: 1 };
          if (box.flh) g.flh = 1;
          if (box.flv) g.flv = 1;
          out.items.push(g);
        }
      }
    }

    var txBody = kid(n, "p:txBody");
    if (txBody) {
      var lst = {};
      phs.slice().reverse().concat([n]).forEach(function (src) {
        var o = lstOf(src, ctx.theme);
        Object.keys(o).forEach(function (key2) { lst[key2] = o[key2]; });
      });
      if (!lst.sz && k && ctx.titleSz && /title/i.test(k.type)) lst.sz = ctx.titleSz;
      var t = textOf(txBody, { theme: ctx.theme, lst: lst, themeFont: ctx.themeFont });
      if (t) {
        var bb = bodyBox(txBody, box), tb = ptBox(bb);
        t.k = "text"; t.x = tb.x; t.y = tb.y; t.w = tb.w; t.boxH = tb.h; t.rot = tb.rot;
        t.anchor = bb.anchor;
        if (t.op >= 1) delete t.op; else t.op = Math.round(t.op * 100);
        out.items.push(t);
      }
    }
  }

  function bgOf(cSld, ctx) {
    var bg = kid(cSld, "p:bg");
    if (!bg) return null;
    var pr = kid(bg, "p:bgPr");
    if (pr) {
      var f = fillOf(pr, ctx.theme);
      if (f && f.blip) {
        var bl = kid(f.blip, "a:blip"), rel = bl && ctx.rels[bl.a["r:embed"]];
        return rel && /^ppt\/media\//.test(rel.target) ? { img: rel.target } : null;
      }
      return f && !f.none ? f : null;
    }
    var ref = kid(bg, "p:bgRef");
    if (ref) { var c = colourIn(ref, ctx.theme); return c ? { fc: c.c } : null; }
    return null;
  }

  function parseTheme(doc) {
    var t = {}, fonts = "";
    var cs = find(doc, "a:clrScheme");
    if (cs) cs.c.forEach(function (c) {
      var name = c.n.replace(/^a:/, ""), v = c.c[0];
      if (!v) return;
      if (v.n === "a:srgbClr") t[name] = v.a.val;
      else if (v.n === "a:sysClr") t[name] = v.a.lastClr || "000000";
    });
    var minor = find(find(doc, "a:minorFont"), "a:latin");
    if (minor) fonts = minor.a.typeface || "";
    return { colours: t, font: fonts };
  }

  // zip: atelier/zip.js reader. → Promise<plan>
  function parse(zip, name) {
    var L = loader(zip);
    var plan = { w: 960, h: 540, name: name || "", pages: [], media: {}, svgs: {}, skipped: 0, approx: 0 };
    var presP = "ppt/presentation.xml";
    return L.xml(presP).then(function (pres) {
      if (!pres) throw new Error("pptx");
      var p = kid(pres, "p:presentation");
      var sz = kid(p, "p:sldSz");
      if (sz) { plan.w = pt(numA(sz, "cx", 12192000)); plan.h = pt(numA(sz, "cy", 6858000)); }
      var ids = kids(kid(p, "p:sldIdLst"), "p:sldId").map(function (s) { return s.a["r:id"]; }).slice(0, MAX_SLIDES);
      return L.rels(presP).then(function (prels) {
        var themeRel = Object.keys(prels).map(function (k) { return prels[k]; }).filter(function (r) { return r.type === "theme"; })[0];
        var masterTheme = themeRel ? themeRel.target : "ppt/theme/theme1.xml";
        return L.xml(masterTheme).then(function (th) {
          var theme = th ? parseTheme(th) : { colours: {}, font: "" };
          var chain = Promise.resolve();
          ids.forEach(function (rid) {
            var r = prels[rid];
            if (!r) return;
            chain = chain.then(function () { return slide(L, r.target, theme, plan); });
          });
          return chain;
        });
      });
    }).then(function () {
      if (!plan.pages.length) throw new Error("pptx");
      return plan;
    });
  }

  function slide(L, sp, theme, plan) {
    return Promise.all([L.xml(sp), L.rels(sp)]).then(function (res) {
      var doc = res[0], rels = res[1];
      if (!doc) return;
      var sld = kid(doc, "p:sld");
      if (sld && (sld.a.show === "0" || sld.a.show === "false")) return;
      var layoutRel = Object.keys(rels).map(function (k) { return rels[k]; }).filter(function (r) { return r.type === "slideLayout"; })[0];
      var layoutP = layoutRel ? layoutRel.target : null;
      return Promise.all([L.xml(layoutP), layoutP ? L.rels(layoutP) : Promise.resolve({})]).then(function (lr) {
        var layout = lr[0], lrels = lr[1];
        var masterRel = Object.keys(lrels).map(function (k) { return lrels[k]; }).filter(function (r) { return r.type === "slideMaster"; })[0];
        var masterP = masterRel ? masterRel.target : null;
        return Promise.all([L.xml(masterP), masterP ? L.rels(masterP) : Promise.resolve({})]).then(function (mr) {
          var master = mr[0], mrels = mr[1];
          var cSld = path(sld, ["p:cSld"]);
          var lcs = path(layout, ["p:sldLayout", "p:cSld"]), mcs = path(master, ["p:sldMaster", "p:cSld"]);
          var titleSz = 0, tst = find(find(master, "p:titleStyle"), "a:defRPr");
          if (tst) titleSz = numA(tst, "sz", 0);
          var base = { theme: theme.colours, themeFont: theme.font, titleSz: titleSz, phTrees: [path(lcs, ["p:spTree"]), path(mcs, ["p:spTree"])] };
          var page = { bg: null, items: [] };
          var out = { items: page.items, media: plan.media, svgs: plan.svgs, skipped: 0, approx: 0 };
          var tf = { ox: 0, oy: 0, sx: 1, sy: 1, rot: 0 };
          page.bg = bgOf(cSld, assign(base, { rels: rels })) || bgOf(lcs, assign(base, { rels: lrels })) || bgOf(mcs, assign(base, { rels: mrels }));
          if (page.bg && page.bg.img) plan.media[page.bg.img] = true;
          // layout / master pictures and shapes that show on the slide (not placeholders)
          var showMaster = !(sld && sld.a.showMasterSp === "0");
          if (showMaster) {
            var lay = path(lcs, ["p:spTree"]);
            if (!(layout && kid(layout, "p:sldLayout") && kid(layout, "p:sldLayout").a.showMasterSp === "0")) {
              decor(path(mcs, ["p:spTree"]), tf, assign(base, { rels: mrels, phTrees: [] }), out);
            }
            decor(lay, tf, assign(base, { rels: lrels, phTrees: [] }), out);
          }
          walkTree(path(cSld, ["p:spTree"]) || { c: [] }, tf, assign(base, { rels: rels }), out);
          plan.skipped += out.skipped; plan.approx += out.approx;
          plan.pages.push(page);
        });
      });
    });
  }
  function decor(tree, tf, ctx, out) {
    if (!tree) return;
    walkTree({ c: tree.c.filter(function (n) { return !phKey(n) && n.n !== "p:nvGrpSpPr" && n.n !== "p:grpSpPr"; }) }, tf, ctx, out);
  }
  function assign(a, b) { var o = {}; Object.keys(a).forEach(function (k) { o[k] = a[k]; }); Object.keys(b).forEach(function (k) { o[k] = b[k]; }); return o; }

  // ---------- 7. Build the design ----------
  // assets: { mediaPath|svgKey: { id, w, h } } (missing → item skipped)
  // → { doc, missing }
  function build(plan, assets, now) {
    var d = AX.newDesign({ name: plan.name, w: plan.w, h: plan.h, unit: "px", pages: plan.pages.length }, now);
    var pages = M.pagesInOrder(d), missing = 0;
    plan.pages.forEach(function (P, pi) {
      var pg = pages[pi];
      if (!pg) return;
      var bg = AX.background(d, pg.id), z = 1;
      if (P.bg && bg) {
        if (P.bg.fc) bg.ax.fc = P.bg.fc;
        else if (P.bg.g) bg.ax.g = P.bg.g;
        else if (P.bg.img) {
          var A0 = assets[P.bg.img];
          if (A0) AX.addItem(d, pg.id, { k: "photo", a: A0.id, iw: A0.w, ih: A0.h, x: 0, y: 0, w: plan.w, h: plan.h, fit: "fill", lock: 1, z: z++ }, now);
          else missing++;
        }
      }
      P.items.forEach(function (s) {
        var spec = {}, img = null;
        Object.keys(s).forEach(function (k) {
          if (["img", "crop", "svg", "boxH", "anchor", "fontName"].indexOf(k) < 0) spec[k] = s[k];
        });
        if (spec.op !== undefined && !(spec.op < 100)) delete spec.op;
        if (s.k === "photo") {
          img = assets[s.img];
          if (!img) { missing++; return; }
          spec.a = img.id; spec.iw = img.w; spec.ih = img.h; spec.nm = s.svg ? "" : s.img.split("/").pop();
          if (s.svg) { spec.fit = "custom"; spec.ix = 0; spec.iy = 0; spec.isc = s.w / img.w; }
          else if (s.crop && (s.crop.l || s.crop.t || s.crop.r || s.crop.b)) {
            var fw = 1 - s.crop.l - s.crop.r, fh = 1 - s.crop.t - s.crop.b;
            if (fw > 0.01 && fh > 0.01) {
              var dw = s.w / fw, dh = s.h / fh;
              spec.fit = "custom"; spec.isc = dw / img.w;
              // one scale for both sides (Atelier never stretches a photo)
              spec.ix = -s.crop.l * dw; spec.iy = -s.crop.t * img.h * spec.isc;
            } else spec.fit = "fill";
          } else spec.fit = "fill";
        }
        spec.z = z++;
        if (s.k === "text" && AX.isExtraFont(spec.font)) AX.ensureFont(spec.font, s.fontName);
        var it = AX.addItem(d, pg.id, spec, now);
        if (it && s.k === "text") {
          if (s.anchor === "ctr") it.y = s.y + (s.boxH - it.h) / 2;
          else if (s.anchor === "b") it.y = s.y + s.boxH - it.h;
        }
      });
    });
    return { doc: M.normDoc(d), missing: missing };
  }

  // the Fontsource families a plan uses: [{ id, name }]
  function planFonts(plan) {
    var seen = {}, out = [];
    plan.pages.forEach(function (P) {
      P.items.forEach(function (s) {
        if (s.k === "text" && AX.isExtraFont(s.font) && !seen[s.font]) { seen[s.font] = 1; out.push({ id: s.font, name: s.fontName }); }
      });
    });
    return out;
  }

  var api = { parse: parse, build: build, parseXml: parseXml, familyOf: familyOf, fontFor: fontFor, planFonts: planFonts, EMU: EMU };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.AtelierPPTX = api;
})(typeof window !== "undefined" ? window : this);
