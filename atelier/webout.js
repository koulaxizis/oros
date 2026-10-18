// ============================================================
// orOS Atelier — webout.js: a design as a web page (v1.0.0)
// Download › Web page: a ZIP with index.html, style.css, the
// pictures (img/) and the fonts (fonts/), ready for any static host
// (GitHub Pages, Netlify, Cloudflare Pages, a server of your own).
//   - every page of the design is a <section> holding one inline
//     SVG drawn from the SAME layout the canvas and the PDF use
//     (ax.js textLayout / curveLayout / tableLayout), so it looks the
//     same and scales to any screen width (phones included);
//   - texts are real text (<text>, the design's fonts as @font-face):
//     search engines and screen readers read them, people can select
//     and copy them; copies made by text effects are aria-hidden;
//   - shapes, gradients, lines, icons and tables are vector paths;
//     photos (with filters and crop), charts and blurred text effects
//     (shadow, lift, neon glow) are pictures the caller draws
//     (io.js, through draw.js), photos cut to their shape here;
//   - an element's link (item ext.lnk, AX.normLink) wraps it in <a>;
//     "#p2" jumps to page 2;
//   - no JavaScript at all, a Content-Security-Policy that allows only
//     the page's own files, no outside requests (no fonts, trackers
//     or CDNs), credits of open-source pieces in the footer.
// plan() says what goes how, build() writes the files.
// Pure: no DOM. Exposes window.AtelierWeb (browser) or module.exports.
// ============================================================
(function (root) {
  "use strict";

  var M, T, FX, AX, ICONS;
  if (typeof module !== "undefined" && module.exports) {
    M = require("../designkit/model.js"); T = require("../designkit/text.js");
    FX = require("../designkit/fx.js"); AX = require("./ax.js"); ICONS = require("./library/icons.js");
  } else {
    M = root.orosDK.model; T = root.orosDK.text; FX = root.orosDK.fx; AX = root.AtelierAX; ICONS = root.ATELIER_ICONS;
  }

  var CSP = "default-src 'none'; img-src 'self'; font-src 'self'; style-src 'self'; base-uri 'none'; form-action 'none'";
  var DESC_MAX = 160;

  function n2(v) { return String(Math.round((+v || 0) * 100) / 100); }
  function esc(s) {
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }
  function at(name, v) { return " " + name + '="' + esc(v) + '"'; }
  function colour(v, def) { return FX.normColor(v) || def; }
  function rad(d) { return d * Math.PI / 180; }

  var iconById = null;
  function iconPaths(id) {
    if (!iconById) {
      iconById = {};
      ((ICONS && ICONS.list) || []).forEach(function (e) { iconById[e[0]] = e[4]; });
    }
    return iconById[id] || null;
  }

  // ---------- 1. What goes how ----------
  // "text" (real text) | "textfx" (real text over a picture of its
  // blurred passes) | "vector" | "photo" (picture cut to its shape) |
  // "raster" (the element as a picture) | "" (nothing to draw).
  function hasBlur(ax) {
    return FX.textPasses(ax.tfx, ax.size || AX.TEXT_DEF.size, ax.fc || "#000000").some(function (p) { return p.blur > 0; });
  }
  function kindOf(it) {
    var ax = it && it.ax;
    if (!ax || it.hide || ax.tg) return "";
    if (ax.k === "text") {
      if (!ax.tx || !ax.tx.trim()) return "";
      return hasBlur(ax) ? "textfx" : "text";
    }
    if (ax.k === "shape") return ax.g || ax.fc || (ax.sc && it.sw > 0) ? "vector" : "";
    if (ax.k === "line" || ax.k === "icon" || ax.k === "table") return "vector";
    if (ax.k === "photo") return it.a || ax.vid ? "photo" : "";
    return "raster";                     // charts
  }
  function padOf(it, kind) {
    if (kind !== "textfx") return 0;
    var ax = it.ax, p = FX.fxPad(ax.tfx, ax.size || AX.TEXT_DEF.size), s = (ax.size || AX.TEXT_DEF.size) * 0.3;
    return Math.ceil(Math.max(p.l, p.t, p.r, p.b) + s);
  }
  function pageItems(doc, pg) {
    return doc.items.filter(function (it) { return it.pg === pg && it.ax && !it.hide && !it.ax.tg; }).sort(M.byZ);
  }
  // [{ id, pg, kind, pad }]; the ones needsPicture() names need a
  // picture from the caller (same shape as AtelierPDF's plan).
  function plan(doc, pageIds) {
    var out = [];
    pageIds.forEach(function (pg) {
      pageItems(doc, pg).forEach(function (it) {
        var k = kindOf(it);
        if (k) out.push({ id: it.id, pg: pg, kind: k, pad: padOf(it, k) });
      });
    });
    return out;
  }
  function needsPicture(p) { return p.kind === "textfx" || p.kind === "photo" || p.kind === "raster"; }

  // ---------- 2. Fonts ----------
  function fam(key) { return "f-" + key; }
  function generic(key) {
    var f = key.split("-")[0];
    return f === "serif" ? "serif" : f === "mono" ? "monospace" : "sans-serif";
  }
  // The family list of a font key, as the canvas draws it: an extra
  // family falls back to its sans face (same variant).
  function stack(key) {
    var p = key.split("-"), out = [fam(key)];
    if (AX.isExtraFont(p[0])) out.push(fam("sans-" + p[1]));
    return out.map(function (f) { return "'" + f + "'"; }).join(", ") + ", " + generic(key);
  }
  function usedKeys(doc, pageIds) {
    var keys = {}, want = {};
    pageIds.forEach(function (id) { want[id] = 1; });
    function add(k) {
      var p = k.split("-");
      keys[k] = 1;
      if (AX.isExtraFont(p[0])) keys["sans-" + p[1]] = 1;
    }
    doc.items.forEach(function (it) {
      if (!it.ax || !want[it.pg] || it.hide) return;
      if (it.ax.k === "text") add(AX.fontKeyOf(it.ax));
      else if (it.ax.k === "table") { add(AX.fontKeyOf({ font: it.ax.font })); add(AX.fontKeyOf({ font: it.ax.font, b: 1 })); }
    });
    return Object.keys(keys).sort();
  }

  // ---------- 3. Drawing one page ----------
  function Page(doc, n) {
    var defs = [], nid = 0;
    function id(p) { return p + n + "-" + (++nid); }
    return { defs: defs, id: id, doc: doc, n: n };
  }

  function shapeD(it) {
    return FX.toSvgPath(AX.shapeCmds(it)) || "M0 0";
  }
  function dashAt(it, sw) { return it.dash ? at("stroke-dasharray", n2(sw * 3) + " " + n2(sw * 2)) : ""; }

  function gradientOf(P, it, g) {
    var a = rad(g.ang - 90), cx = it.w / 2, cy = it.h / 2;
    var len = Math.abs(it.w * Math.cos(a)) / 2 + Math.abs(it.h * Math.sin(a)) / 2;
    var dx = Math.cos(a) * len, dy = Math.sin(a) * len, gid = P.id("g");
    P.defs.push('<linearGradient id="' + gid + '" gradientUnits="userSpaceOnUse" x1="' + n2(cx - dx) + '" y1="' + n2(cy - dy) +
      '" x2="' + n2(cx + dx) + '" y2="' + n2(cy + dy) + '"><stop offset="0"' + at("stop-color", colour(g.a, "#000000")) +
      '/><stop offset="1"' + at("stop-color", colour(g.b, "#000000")) + "/></linearGradient>");
    return "url(#" + gid + ")";
  }

  function shapeSvg(P, it) {
    var ax = it.ax;
    var fill = ax.g ? gradientOf(P, it, ax.g) : ax.fc ? colour(ax.fc, "none") : "none";
    var s = '<path d="' + shapeD(it) + '"' + at("fill", fill);
    if (ax.sc && it.sw > 0) s += at("stroke", colour(ax.sc, "#000000")) + at("stroke-width", n2(it.sw)) + ' stroke-linejoin="round"' + dashAt(it, it.sw);
    return s + "/>";
  }

  function headSvg(x, y, ang, kind, sw, col) {
    var s = Math.max(6, sw * 3.2), c = Math.cos(ang), sn = Math.sin(ang);
    if (kind === "dot") return '<circle cx="' + n2(x) + '" cy="' + n2(y) + '" r="' + n2(s / 2.2) + '"' + at("fill", col) + "/>";
    function pt(px, py) { return n2(x + px * c - py * sn) + "," + n2(y + px * sn + py * c); }
    return '<polygon points="' + pt(0, 0) + " " + pt(-s, -s / 1.6) + " " + pt(-s, s / 1.6) + '"' + at("fill", col) + "/>";
  }
  function lineSvg(it) {
    var ax = it.ax, sw = it.sw || 1, col = colour(ax.sc, "#000000");
    var ang = Math.atan2(it.h, it.w), len = Math.sqrt(it.w * it.w + it.h * it.h), cut = Math.max(6, sw * 3.2) * 0.7;
    var x0 = 0, y0 = 0, x1 = it.w, y1 = it.h;
    if (ax.as === "arrow" && len > cut) { x0 += Math.cos(ang) * cut; y0 += Math.sin(ang) * cut; }
    if (ax.ae === "arrow" && len > cut) { x1 -= Math.cos(ang) * cut; y1 -= Math.sin(ang) * cut; }
    var s = '<path d="M' + n2(x0) + " " + n2(y0) + "L" + n2(x1) + " " + n2(y1) + '" fill="none"' + at("stroke", col) +
      at("stroke-width", n2(sw)) + ' stroke-linecap="round"' + dashAt(it, sw) + "/>";
    if (ax.as) s += headSvg(0, 0, ang + Math.PI, ax.as, sw, col);
    if (ax.ae) s += headSvg(it.w, it.h, ang, ax.ae, sw, col);
    return s;
  }

  function iconSvg(it) {
    var ax = it.ax, ps = iconPaths(ax.ico), k = Math.min(it.w, it.h) / 24;
    var s = '<g transform="translate(' + n2((it.w - 24 * k) / 2) + " " + n2((it.h - 24 * k) / 2) + ") scale(" + String(Math.round(k * 10000) / 10000) + ')"' +
      at("fill", ax.fc ? colour(ax.fc, "none") : "none") + at("stroke", colour(ax.sc, "#000000")) +
      at("stroke-width", n2(it.sw > 0 ? it.sw : 2)) + ' stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">';
    if (ps) ps.forEach(function (d) { s += "<path" + at("d", d) + "/>"; });
    else s += '<rect x="2" y="2" width="20" height="20"/>';
    return s + "</g>";
  }

  // A run as a <tspan> (text is in the run's own face and size when
  // they differ from the element's).
  function tspan(r, key, size, dx, dy, tail) {
    var s = "<tspan" + at("x", n2(r.x + dx)) + at("y", n2(r.y + dy));
    if (r.key && r.key !== key) s += at("font-family", stack(r.key));
    if (r.size && r.size !== size) s += at("font-size", n2(r.size));
    if (r.track) s += at("letter-spacing", n2(r.track * (r.size || size) / 1000));
    return s + ">" + esc(r.t + (tail || "")) + "</tspan>";
  }
  // Paint attributes of a text pass.
  function passPaint(p) {
    var s = "";
    if (p.mode === "stroke") s += ' fill="none"' + at("stroke", colour(p.color, "#000000")) + at("stroke-width", n2(p.width)) + ' stroke-linejoin="round" stroke-miterlimit="2"';
    else s += at("fill", colour(p.color, "#000000"));
    if (p.alpha < 0.999) s += at("opacity", n2(Math.max(0, p.alpha)));
    return s;
  }
  // What to add after each run so the text reads as typed: a space
  // between words (the layout places words apart, without the space)
  // and at the end of a line that runs on into the next one. The
  // runs keep their places; a trailing space draws nothing.
  function tails(ln, li, lines) {
    var runs = ln.runs.filter(function (r) { return r.t; });
    return runs.map(function (r, i) {
      if (/\s$/.test(r.t)) return "";
      var nx = runs[i + 1];
      if (nx) return !/^\s/.test(nx.t) && nx.x > r.x + r.w + 0.05 * (r.size || 1) ? " " : "";
      return li < lines.length - 1 ? " " : "";
    });
  }

  function textSvg(it) {
    var ax = it.ax, size = ax.size || AX.TEXT_DEF.size, key = AX.fontKeyOf(ax);
    var passes = FX.textPasses(ax.tfx, size, ax.fc || "#000000");
    var curve = ax.cv ? AX.curveLayout(it) : null, lay = curve ? null : AX.textLayout(it);
    var asc = T.ascent(key, size), desc = T.descent(key, size);
    var readable = -1;
    passes.forEach(function (p, i) { if (p.mode !== "box" && !(p.blur > 0)) readable = i; });
    var out = "";
    passes.forEach(function (p, i) {
      if (p.blur > 0) return;                     // in the picture underneath
      var hide = i !== readable;
      if (p.mode === "box") {
        if (curve) return;
        lay.lines.forEach(function (ln) {
          var x0 = Infinity, x1 = -Infinity;
          ln.runs.forEach(function (r) { if (r.t && r.t.trim()) { x0 = Math.min(x0, r.x); x1 = Math.max(x1, r.x + r.w); } });
          if (x0 === Infinity) return;
          var bw = x1 - x0 + 2 * p.pad, bh = asc + desc + p.pad * 1.2, rr = Math.max(0, Math.min(p.radius, bw / 2, bh / 2));
          out += "<rect" + at("x", n2(x0 - p.pad)) + at("y", n2(ln.y - asc - p.pad * 0.6)) + at("width", n2(bw)) + at("height", n2(bh)) +
            (rr ? at("rx", n2(rr)) : "") + at("fill", colour(p.color, "#000000")) + (p.alpha < 0.999 ? at("fill-opacity", n2(p.alpha)) : "") + "/>";
        });
        return;
      }
      var head = at("font-family", stack(key)) + at("font-size", n2(size)) + passPaint(p);
      if (curve) {
        var g = "";
        curve.glyphs.forEach(function (gl) {
          g += '<text transform="translate(' + n2(it.w / 2 + gl.x + p.dx) + " " + n2(it.h / 2 + gl.y + p.dy) + ") rotate(" + n2(gl.rot * 180 / Math.PI) + ')"' +
            at("x", n2(-gl.w / 2)) + ' y="0">' + esc(gl.ch) + "</text>";
        });
        out += hide ? '<g aria-hidden="true"' + head + ">" + g + "</g>"
          : '<g role="img"' + at("aria-label", (ax.tx || "").replace(/\s+/g, " ").trim()) + head + ">" + g + "</g>";
        return;
      }
      var t = "<text" + head + (hide ? ' aria-hidden="true"' : "") + ">", lines = [];
      lay.lines.forEach(function (ln, li) {
        var tl = tails(ln, li, lay.lines), runs = ln.runs.filter(function (r) { return r.t; });
        runs.forEach(function (r, ri) { t += tspan(r, key, size, p.dx, p.dy, tl[ri]); });
        if (p.mode === "fill") runs.forEach(function (r) { if (r.u) lines.push(r); });
      });
      out += t + "</text>";
      lines.forEach(function (r) {
        out += "<rect" + at("x", n2(r.x + p.dx)) + at("y", n2(r.y + p.dy + r.size * 0.12)) + at("width", n2(r.w)) +
          at("height", n2(Math.max(0.3, r.size * 0.05))) + passPaint({ mode: "fill", color: p.color, alpha: p.alpha }) + ' aria-hidden="true"/>';
      });
    });
    return out;
  }

  function tableSvg(it) {
    var ax = it.ax, OB = AX.OB, L = AX.tableLayout(it), s = "";
    L.cells.forEach(function (c) {
      if (c.fill) s += "<rect" + at("x", n2(c.x)) + at("y", n2(c.y)) + at("width", n2(c.w)) + at("height", n2(c.h)) + at("fill", colour(c.fill, "#ffffff")) + "/>";
    });
    L.cells.forEach(function (c) {
      if (!c.lines.length) return;
      var first = null;
      c.lines.forEach(function (ln) { ln.runs.forEach(function (r) { if (r.t && !first) first = r; }); });
      if (!first) return;
      var t = "<text" + at("font-family", stack(first.key)) + at("font-size", n2(first.size)) + at("fill", colour(c.ink, "#000000")) + ">";
      c.lines.forEach(function (ln, li) {
        var runs = ln.runs.filter(function (r) { return r.t; }), tl = tails(ln, li, c.lines);
        runs.forEach(function (r, ri) { t += tspan(r, first.key, first.size, c.tx, c.ty, tl[ri]); });
      });
      s += t + "</text>";
    });
    if (it.sw > 0) {
      var d = "";
      OB.tableRules(it).forEach(function (l) { d += "M" + n2(l[0]) + " " + n2(l[1]) + "L" + n2(l[2]) + " " + n2(l[3]); });
      if (d) s += '<path d="' + d + '" fill="none"' + at("stroke", colour(ax.sc, OB.RULE)) + at("stroke-width", n2(it.sw)) + ' stroke-linecap="square"' + dashAt(it, it.sw) + "/>";
    }
    return s;
  }

  function pictureSvg(pic, file, clip) {
    if (!pic || !file) return "";
    return "<image" + at("href", file) + at("x", n2(pic.x)) + at("y", n2(pic.y)) + at("width", n2(pic.w)) + at("height", n2(pic.h)) +
      ' preserveAspectRatio="none"' + (clip ? at("clip-path", "url(#" + clip + ")") : "") + ' aria-hidden="true"/>';
  }
  function photoSvg(P, it, pic, file) {
    var cid = P.id("c");
    P.defs.push('<clipPath id="' + cid + '"><path d="' + (it.ax.shp ? shapeD(it) : "M0 0H" + n2(it.w) + "V" + n2(it.h) + "H0Z") + '"/></clipPath>');
    return pictureSvg(pic, file, cid);
  }

  function hitArea(it) {
    if (it.t === "line") {
      var p = Math.max(6, (it.sw || 1) * 2);
      return '<path d="M0 0L' + n2(it.w) + " " + n2(it.h) + '" stroke="#000" stroke-opacity="0"' + at("stroke-width", n2(p * 2)) + ' fill="none"/>';
    }
    return '<rect width="' + n2(Math.max(1, it.w)) + '" height="' + n2(Math.max(1, it.h)) + '" fill="#000" fill-opacity="0"/>';
  }

  // One element: its look in its own coordinates, turned and faded
  // as on the canvas, inside its link when it has one.
  function itemSvg(P, it, kind, pic, file) {
    var ax = it.ax, body = "";
    if (kind === "text") body = textSvg(it);
    else if (kind === "textfx") body = pictureSvg(pic, file) + textSvg(it);
    else if (kind === "photo") body = photoSvg(P, it, pic, file);
    else if (kind === "raster") body = pictureSvg(pic, file);
    else if (ax.k === "shape") body = shapeSvg(P, it);
    else if (ax.k === "line") body = lineSvg(it);
    else if (ax.k === "icon") body = iconSvg(it);
    else if (ax.k === "table") body = tableSvg(it);
    if (!body) return "";
    var tf = [];
    if (it.t !== "line" && it.rot) tf.push("rotate(" + n2(it.rot) + " " + n2(it.x + it.w / 2) + " " + n2(it.y + it.h / 2) + ")");
    tf.push("translate(" + n2(it.x) + " " + n2(it.y) + ")");
    var op = it.op === undefined ? 100 : it.op;
    var l = AX.linkOf(it), pm = l ? /^#p(\d+)$/.exec(l) : null;
    if (pm && !P.pageIds[+pm[1] - 1]) l = "";                 // no such page here
    // a link answers anywhere on its element, not only on painted
    // pixels (the gaps between letters, an icon's empty middle)
    if (l) body = hitArea(it) + body;
    var g = '<g transform="' + tf.join(" ") + '"' + (op < 100 ? at("opacity", n2(op / 100)) : "") + ">" + body + "</g>";
    if (!l) return g;
    return "<a" + at("href", l) + (/^https?:/.test(l) ? ' rel="noopener"' : "") + ">" + g + "</a>";
  }

  // ---------- 4. The files ----------
  function plainText(doc, pages) {
    var bits = [];
    pages.forEach(function (pg) {
      pageItems(doc, pg.id).filter(function (it) { return it.ax.k === "text" && it.ax.tx; })
        .sort(function (a, b) { return a.y - b.y || a.x - b.x; })
        .forEach(function (it) { bits.push(it.ax.tx); });
    });
    var s = bits.join(" ").replace(/\s+/g, " ").trim();
    if (s.length <= DESC_MAX) return s;
    s = s.slice(0, DESC_MAX);
    var cut = s.lastIndexOf(" ");
    return (cut > DESC_MAX / 2 ? s.slice(0, cut) : s) + "…";
  }
  function pageColour(doc, pg) {
    var bg = AX.background(doc, pg.id);
    return bg && bg.ax.k === "shape" && !bg.ax.g && bg.ax.fc ? bg.ax.fc : "#ffffff";
  }
  function utf8(s) {
    if (typeof TextEncoder !== "undefined") return new TextEncoder().encode(s);
    return new Uint8Array(Buffer.from(s, "utf8"));
  }

  // opts: { pages [pageId] (default all), title, lang ("en"),
  //   credits [line], maxWidth (CSS px, default the page width),
  //   fontNote (text of fonts/README.txt) }
  // deps: { pictures: { itemId: { data Uint8Array, fmt "PNG"|"JPEG",
  //   x, y, w, h (item-local points, unrotated) } }, plan, ofl (the
  //   Noto licence text, optional) }
  // → { files: [{ name, data Uint8Array }], pictures n, fonts n }
  function build(doc, opts, deps) {
    opts = opts || {}; deps = deps || {};
    var all = M.pagesInOrder(doc), want = {};
    (opts.pages && opts.pages.length ? opts.pages : all.map(function (p) { return p.id; })).forEach(function (id) { want[id] = 1; });
    var pages = all.filter(function (p) { return want[p.id]; });
    if (!pages.length) throw new Error("no pages");
    var ids = pages.map(function (p) { return p.id; });
    var PL = deps.plan || plan(doc, ids), how = {};
    PL.forEach(function (p) { how[p.id] = p.kind; });
    var pics = deps.pictures || {}, files = [], picFile = {}, np = 0;
    Object.keys(pics).sort().forEach(function (id) {
      var pc = pics[id];
      if (!pc || !pc.data || !how[id]) return;
      var name = "img/" + (++np) + (pc.fmt === "JPEG" ? ".jpg" : ".png");
      picFile[id] = name;
      files.push({ name: name, data: pc.data });
    });

    var W = doc.setup.w, H = doc.setup.h, maxW = Math.round(opts.maxWidth || W);
    var sections = pages.map(function (pg, i) {
      var P = Page(doc, i + 1), body = "";
      P.pageIds = ids;
      pageItems(doc, pg.id).forEach(function (it) {
        var k = how[it.id];
        if (k) body += itemSvg(P, it, k, pics[it.id], picFile[it.id]);
      });
      return '<section class="pg" id="p' + (i + 1) + '">' +
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + n2(W) + " " + n2(H) + '"' + at("width", n2(W)) + at("height", n2(H)) +
        ' xml:space="preserve">' + (P.defs.length ? "<defs>" + P.defs.join("") + "</defs>" : "") + body + "</svg></section>";
    });

    // fonts: every file of every face the pages use, with its range
    var css = [], nf = 0, readme = [], fsNames = {};
    usedKeys(doc, ids).forEach(function (key) {
      var parts = T.faceParts(key);
      if (!parts.length) return;
      var fm = key.split("-")[0];
      if (AX.isExtraFont(fm)) fsNames[AX.fsSlug(fm)] = AX.fontName(fm);
      parts.forEach(function (p, i) {
        var name = "fonts/" + key + (parts.length > 1 ? "-" + i : "") + ".ttf";
        files.push({ name: name, data: p.bytes() });
        nf++;
        css.push('@font-face{font-family:"' + fam(key) + '";src:url("' + name + '") format("truetype");font-display:swap' +
          (p.range ? ";unicode-range:" + p.range : "") + "}");
      });
    });
    if (nf) {
      readme.push(opts.fontNote || "Fonts");
      readme.push("");
      readme.push("Noto Sans, Noto Serif, Noto Sans Mono: SIL Open Font License 1.1 (OFL.txt), https://openfontlicense.org");
      Object.keys(fsNames).sort().forEach(function (slug) {
        readme.push(fsNames[slug] + ": https://fontsource.org/fonts/" + slug);
      });
      files.push({ name: "fonts/README.txt", data: utf8(readme.join("\n") + "\n") });
      if (deps.ofl) files.push({ name: "fonts/OFL.txt", data: utf8(String(deps.ofl)) });
    }

    var bgc = pageColour(doc, pages[0]);
    var style = (css.length ? css.join("\n") + "\n" : "") +
      "*{box-sizing:border-box}\n" +
      "html{background:" + bgc + "}\n" +
      "body{margin:0}\n" +
      ".pg{display:block;margin:0 auto;max-width:" + maxW + "px}\n" +
      ".pg svg{display:block;width:100%;height:auto}\n" +
      ".pg text{white-space:pre;font-kerning:none;font-variant-ligatures:none}\n" +
      ".pg a:focus-visible{outline:3px solid #1a73e8;outline-offset:2px}\n" +
      ".cr{max-width:" + maxW + "px;margin:0 auto;padding:16px;font:13px/1.5 system-ui,sans-serif;color:#555;background:#fff}\n" +
      ".cr p{margin:0 0 4px}\n";

    var title = String(opts.title || doc.name || "").replace(/\s+/g, " ").trim() || "Atelier";
    var desc = plainText(doc, pages);
    var credits = (opts.credits || []).filter(function (s) { return typeof s === "string" && s.trim(); });
    var html = "<!doctype html>\n" +
      '<html lang="' + esc(/^[a-z]{2,3}(-[A-Za-z0-9]{2,8})?$/.test(opts.lang || "") ? opts.lang : "en") + '">\n<head>\n' +
      '<meta charset="utf-8">\n' +
      '<meta name="viewport" content="width=device-width, initial-scale=1">\n' +
      '<meta http-equiv="Content-Security-Policy" content="' + CSP + '">\n' +
      "<title>" + esc(title) + "</title>\n" +
      (desc ? '<meta name="description"' + at("content", desc) + ">\n" : "") +
      '<meta name="generator" content="orOS Atelier">\n' +
      '<link rel="stylesheet" href="style.css">\n' +
      "</head>\n<body>\n<main>\n" + sections.join("\n") + "\n</main>\n" +
      (credits.length ? '<footer class="cr">' + credits.map(function (c) { return "<p>" + esc(c) + "</p>"; }).join("") + "</footer>\n" : "") +
      "</body>\n</html>\n";
    files.unshift({ name: "style.css", data: utf8(style) });
    files.unshift({ name: "index.html", data: utf8(html) });
    return { files: files, pictures: np, fonts: nf };
  }

  var api = { plan: plan, kindOf: kindOf, needsPicture: needsPicture, build: build, stack: stack, CSP: CSP };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.AtelierWeb = api;
})(typeof window !== "undefined" ? window : this);
