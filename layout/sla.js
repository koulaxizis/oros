// ============================================================
// orOS Layout — Scribus .sla import (v1.3.0)
// Reads a Scribus document (1.4, 1.5, 1.6 XML) into a NEW Layout
// document: pages, master pages, margins, columns, bleed, colours,
// paragraph styles, text frames with their threads, images, shapes,
// lines, free shapes (polygons, polylines, Bézier paths, regular
// polygons, arcs, spirals → path items), linear and radial gradients,
// and layers (stacking order; hidden or non-printing layers → hidden
// objects, locked layers → locked objects). The XML is read by a small tokenizer here (no DOM, no
// scripts, no external entities); every value then goes through the
// model's normalizers like any other document.
//   - Images embedded in the file (Scribus "inline images") come back
//     as data for io.js to store; linked images become empty image
//     frames that keep the file name (`links`), filled by io.js from
//     the pictures picked with the file. Each keeps how Scribus placed
//     it (ext.place: scale, offset, fit or stretch).
//   - Not imported (counted in stats.skipped): tables, text on a path
//     (a plain text frame), mesh / pattern / diamond / conical fills
//     (plain colour), LaTeX and other render frames, hyphenation
//     settings. Image and text frames keep their box, not a free
//     outline.
//   - Fonts: each style keeps the built-in family closest to its font
//     and the font's own name in ext.srcFont; io.js then finds that
//     family on the orOS disk or at Fontsource (LY-FONT). Text kerns,
//     as in Scribus (ext.kern on the base style, LY-KERN).
//   - A compressed .sla.gz is unpacked by io.js before it comes here.
// Exposes LY_SLA (browser) or module.exports (Node tests).
// ============================================================
(function (root) {
  "use strict";

  var M;
  if (typeof module !== "undefined" && module.exports) M = require("../designkit/model.js");
  else M = root.orosDK.model;

  // ---------- 1. XML ----------
  var ENT = { amp: "&", lt: "<", gt: ">", quot: "\"", apos: "'" };
  function unent(s) {
    return s.indexOf("&") < 0 ? s : s.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|[a-zA-Z]+);/g, function (m, e) {
      if (e[0] === "#") {
        var n = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
        return n > 0 && n < 0x110000 && !(n >= 0xD800 && n <= 0xDFFF) ? String.fromCodePoint(n) : "";
      }
      return ENT.hasOwnProperty(e) ? ENT[e] : "";
    });
  }
  // → { n: name, a: {attrs}, c: [children] }. Text nodes are dropped
  // (Scribus keeps everything in attributes) unless `keep` is set
  // (InDesign, layout/idml.js): then text and CDATA come as
  // { n: "#text", t } (whitespace only inside <Content>) and an
  // InDesign special character <?ACE n?> as { n: "#ace", t: n }.
  function parseXml(src, keep) {
    var top = { n: "#root", a: {}, c: [] }, stack = [top], i = 0, L = src.length;
    var attrRe = /([^\s=\/>]+)\s*=\s*("([^"]*)"|'([^']*)')/g;
    function text(t, raw) {
      var host = stack[stack.length - 1];
      if (t && (host.n === "Content" || /\S/.test(t))) host.c.push({ n: "#text", a: {}, c: [], t: raw ? t : unent(t) });
    }
    while (i < L) {
      var lt = src.indexOf("<", i);
      if (lt < 0) break;
      if (keep && lt > i) text(src.slice(i, lt), false);
      if (src.startsWith("<!--", lt)) { var ce = src.indexOf("-->", lt + 4); i = ce < 0 ? L : ce + 3; continue; }
      if (src.startsWith("<![CDATA[", lt)) {
        var cd = src.indexOf("]]>", lt);
        if (keep) text(src.slice(lt + 9, cd < 0 ? L : cd), true);
        i = cd < 0 ? L : cd + 3; continue;
      }
      if (src[lt + 1] === "?" || src[lt + 1] === "!") {
        var pe = src.indexOf(">", lt), pi = src.slice(lt, pe < 0 ? L : pe + 1).match(/^<\?ACE\s+(\d+)\s*\?>$/);
        if (keep && pi) stack[stack.length - 1].c.push({ n: "#ace", a: {}, c: [], t: pi[1] });
        i = pe < 0 ? L : pe + 1; continue;
      }
      // find the closing ">" outside quotes
      var j = lt + 1, q = "";
      while (j < L) {
        var ch = src[j];
        if (q) { if (ch === q) q = ""; }
        else if (ch === "\"" || ch === "'") q = ch;
        else if (ch === ">") break;
        j++;
      }
      if (j >= L) break;
      var body = src.slice(lt + 1, j);
      i = j + 1;
      if (body[0] === "/") {
        var nm = body.slice(1).trim();
        for (var k = stack.length - 1; k > 0; k--) if (stack[k].n === nm) { stack.length = k; break; }
        continue;
      }
      var self = body[body.length - 1] === "/";
      if (self) body = body.slice(0, -1);
      var sp = body.search(/\s/), name = sp < 0 ? body : body.slice(0, sp);
      var node = { n: name, a: {}, c: [] }, m;
      attrRe.lastIndex = 0;
      var rest = sp < 0 ? "" : body.slice(sp);
      while ((m = attrRe.exec(rest))) node.a[m[1]] = unent(m[3] !== undefined ? m[3] : m[4]);
      stack[stack.length - 1].c.push(node);
      if (!self) stack.push(node);
    }
    return top;
  }
  function kids(node, name) { return node.c.filter(function (x) { return !name || x.n === name; }); }
  function find1(node, name) {
    if (node.n === name) return node;
    for (var i = 0; i < node.c.length; i++) { var r = find1(node.c[i], name); if (r) return r; }
    return null;
  }
  function num(v, def) { var n = parseFloat(v); return isFinite(n) ? n : def; }

  // ---------- 2. Fonts, colours, styles ----------
  var SERIF = /serif|times|georgia|garamond|minion|palatino|book ?antiqua|cambria|baskerville|caslon|bodoni|didot|charter|roman|libertin|gentium|crimson|merriweather|lora|playfair|pt serif|source serif|noto serif|dejavu serif|liberation serif|tinos/i;
  var MONO = /mono|courier|consol|menlo|code|typewriter|inconsolata|fira code|cousine/i;
  function fontOf(name) {
    name = String(name || "");
    var fam = MONO.test(name) ? "mono" : /sans/i.test(name) ? "sans" : SERIF.test(name) ? "serif" : "sans";
    return { font: fam, b: /bold|black|heavy|semibold|demi|extrabold/i.test(name) ? 1 : 0, i: /italic|oblique/i.test(name) ? 1 : 0 };
  }
  // the family part of a font name ("Constantia Bold Italic" → "constantia")
  function famName(name) {
    return String(name || "").toLowerCase().replace(/\b(regular|bold|italic|oblique|black|heavy|semibold|semi|demi|extrabold|extra|light|medium|book|roman)\b/g, "").replace(/[^a-z0-9]+/g, "");
  }
  function slug(s, pre, used) {
    var b = String(s || "").toLowerCase().normalize("NFD").replace(/[^a-z0-9]+/g, "").slice(0, 16) || "x";
    var id = pre + "-" + b, n = 2;
    while (used[id]) id = pre + "-" + b.slice(0, 13) + n++;
    used[id] = 1;
    return id;
  }
  // Scribus colours → swatches; "Black"/"White"/"Registration" map to
  // the seed swatches. Returns name → swatch id.
  function colours(docNode, now, used) {
    var map = { None: "", Black: "sw-black", White: "sw-paper", Registration: "sw-black" }, list = [];
    kids(docNode, "COLOR").forEach(function (c) {
      var name = c.a.NAME;
      if (!name || map.hasOwnProperty(name)) return;
      var mode, v;
      if (c.a.SPACE === "RGB" || (!c.a.SPACE && c.a.RGB && !c.a.CMYK)) {
        mode = "rgb";
        if (c.a.SPACE) v = [c.a.R, c.a.G, c.a.B].map(function (x) { return Math.round(num(x, 0)); });
        else v = [1, 3, 5].map(function (k) { return parseInt(c.a.RGB.substr(k, 2), 16) || 0; });
      } else if (c.a.SPACE === "CMYK" || c.a.CMYK) {
        mode = "cmyk";
        if (c.a.SPACE) v = [c.a.C, c.a.M, c.a.Y, c.a.K].map(function (x) { return Math.round(num(x, 0)); });
        else v = [1, 3, 5, 7].map(function (k) { return Math.round((parseInt(c.a.CMYK.substr(k, 2), 16) || 0) / 2.55); });
      } else return;      // Lab and spot-only colours: left out
      var id = slug(name, "sw", used);
      map[name] = id;
      list.push({ id: id, m: now, name: String(name).slice(0, 60), mode: mode, v: v });
    });
    return { map: map, list: list };
  }
  // A tint (SHADE < 100) of a swatch, made once per colour + shade.
  function tinter(doc, cmap, now, used) {
    var made = {};
    return function (name, shade) {
      var id = cmap[name];
      if (id === undefined) id = name ? "sw-black" : "";
      shade = num(shade, 100);
      if (!id || shade >= 100) return id;
      var k = id + "@" + Math.round(shade);
      if (made[k]) return made[k];
      var base = M.find(doc.swatches, id), f = Math.max(0, shade) / 100, v, mode;
      if (!base) return id;
      if (base.mode === "cmyk") { mode = "cmyk"; v = base.v.map(function (x) { return Math.round(x * f); }); }
      else { mode = "rgb"; v = base.v.map(function (x) { return Math.round(255 - (255 - x) * f); }); }
      var nid = slug(id.slice(3) + Math.round(shade), "sw", used);
      doc.swatches.push({ id: nid, m: now, name: M.label(base.name, "en") + " " + Math.round(shade) + "%", mode: mode, v: v });
      made[k] = nid;
      return nid;
    };
  }

  var ALIGN = ["l", "c", "r", "j", "j"];
  // Scribus paragraph attributes → Layout paragraph style keys.
  function psProps(a, colour) {
    var o = {};
    // ext.srcFont: the font's own name, for Layout to find the family (LY-FONT)
    if (a.FONT !== undefined) { var f = fontOf(a.FONT); o.font = f.font; o.b = f.b; o.i = f.i; o.ext = { srcFont: String(a.FONT).slice(0, 60) }; }
    if (a.FONTSIZE !== undefined) o.size = num(a.FONTSIZE, 11);
    if (a.LINESP !== undefined || a.LINESPMode !== undefined) o.lead = a.LINESPMode === "1" ? 0 : num(a.LINESP, 0);
    if (a.ALIGN !== undefined) o.align = ALIGN[parseInt(a.ALIGN, 10)] || "l";
    if (a.VOR !== undefined) o.sb = num(a.VOR, 0);
    if (a.NACH !== undefined) o.sa = num(a.NACH, 0);
    if (a.FIRST !== undefined) o.fi = num(a.FIRST, 0);
    if (a.INDENT !== undefined) o.li = num(a.INDENT, 0);
    if (a.RMARGIN !== undefined) o.ri = num(a.RMARGIN, 0);
    if (a.FCOLOR !== undefined) o.color = colour(a.FCOLOR, a.FSHADE) || "sw-black";
    if (a.TXTSTYLE !== undefined && (parseInt(a.TXTSTYLE, 10) & 8)) o.u = 1;
    if (a.FEATURES !== undefined && /underline/.test(a.FEATURES)) o.u = 1;
    if (a.FEATURES !== undefined && /allcaps/.test(a.FEATURES)) o.caps = 1;
    if (a.KERN !== undefined) o.track = num(a.KERN, 0) * 10;
    return o;
  }

  // ---------- 3. Geometry ----------
  // Scribus rotates about the top-left corner, Layout about the centre.
  function place(it, x, y, w, h, rot) {
    var a = rot * Math.PI / 180, c = Math.cos(a), s = Math.sin(a);
    var cx = x + (w / 2) * c - (h / 2) * s, cy = y + (w / 2) * s + (h / 2) * c;
    it.x = cx - w / 2; it.y = cy - h / 2; it.w = w; it.h = h;
    it.rot = ((rot % 360) + 540) % 360 - 180;
  }

  // SVG path data (Scribus "path" attribute, frame coordinates) →
  // absolute M / L / C / Z commands. Quadratic and smooth segments
  // become cubics; arcs (Scribus writes none) become straight lines.
  function svgPath(d) {
    var tok = String(d || "").match(/[MmLlHhVvCcSsQqTtAaZz]|[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/g) || [];
    var out = [], i = 0, cmd = "", x = 0, y = 0, sx = 0, sy = 0, lc = null, lq = null;
    function n() { var v = parseFloat(tok[i++]); return isFinite(v) ? v : NaN; }
    var ARGS = { M: 2, L: 2, H: 1, V: 1, C: 6, S: 4, Q: 4, T: 2, A: 7, Z: 0 };
    while (i < tok.length && out.length < 8000) {
      if (/^[A-Za-z]$/.test(tok[i])) cmd = tok[i++];
      else if (!cmd) return out;
      var C = cmd.toUpperCase(), rel = cmd !== C, a = [];
      for (var k = 0; k < ARGS[C]; k++) a.push(n());
      if (a.some(function (v) { return !isFinite(v); })) return out;
      var ox = rel ? x : 0, oy = rel ? y : 0, c2 = null, q1 = null;
      if (C === "M") { x = a[0] + ox; y = a[1] + oy; sx = x; sy = y; out.push(["M", x, y]); cmd = rel ? "l" : "L"; }
      else if (C === "L") { x = a[0] + ox; y = a[1] + oy; out.push(["L", x, y]); }
      else if (C === "H") { x = a[0] + (rel ? x : 0); out.push(["L", x, y]); }
      else if (C === "V") { y = a[0] + (rel ? y : 0); out.push(["L", x, y]); }
      else if (C === "C") { c2 = [a[2] + ox, a[3] + oy]; out.push(["C", a[0] + ox, a[1] + oy, c2[0], c2[1], a[4] + ox, a[5] + oy]); x = a[4] + ox; y = a[5] + oy; }
      else if (C === "S") {
        var r1 = lc ? [2 * x - lc[0], 2 * y - lc[1]] : [x, y];
        c2 = [a[0] + ox, a[1] + oy]; out.push(["C", r1[0], r1[1], c2[0], c2[1], a[2] + ox, a[3] + oy]); x = a[2] + ox; y = a[3] + oy;
      } else if (C === "Q" || C === "T") {
        q1 = C === "Q" ? [a[0] + ox, a[1] + oy] : lq ? [2 * x - lq[0], 2 * y - lq[1]] : [x, y];
        var ex = (C === "Q" ? a[2] : a[0]) + ox, ey = (C === "Q" ? a[3] : a[1]) + oy;
        out.push(["C", x + 2 / 3 * (q1[0] - x), y + 2 / 3 * (q1[1] - y), ex + 2 / 3 * (q1[0] - ex), ey + 2 / 3 * (q1[1] - ey), ex, ey]);
        x = ex; y = ey;
      } else if (C === "A") { x = a[5] + ox; y = a[6] + oy; out.push(["L", x, y]); }
      else if (C === "Z") { out.push(["Z"]); x = sx; y = sy; }
      lc = c2; lq = q1;
    }
    return out;
  }
  // Scribus 1.4 point lists (POCOOR): groups of four points per
  // segment, start, its control, end, its control; 999999 starts a
  // new sub-path.
  function poCoor(v) {
    var nums = String(v || "").trim().split(/\s+/).map(Number), out = [], open = false, last = null;
    for (var i = 0; i + 7 < nums.length && out.length < 8000; i += 8) {
      var q = nums.slice(i, i + 8);
      if (q.some(function (x) { return !isFinite(x); })) break;
      if (q[0] >= 999999) { if (open) out.push(["Z"]); open = false; last = null; continue; }
      if (!open || !last || Math.abs(last[0] - q[0]) > 1e-6 || Math.abs(last[1] - q[1]) > 1e-6) out.push(["M", q[0], q[1]]);
      out.push(["C", q[2], q[3], q[6], q[7], q[4], q[5]]);
      open = true; last = [q[4], q[5]];
    }
    return out;
  }
  // Commands in frame points → model path text in fractions of w × h.
  function pathData(cmds, w, h) {
    if (!cmds.length || cmds[0][0] !== "M") return "";
    var d = cmds.map(function (c) {
      var o = c[0];
      for (var i = 1; i < c.length; i += 2) o += (i > 1 ? " " : "") + (Math.round(c[i] / w * 10000) / 10000) + " " + (Math.round(c[i + 1] / h * 10000) / 10000);
      return o;
    }).join("");
    return M.parsePath(d) ? d : "";
  }

  // ---------- 4. Convert ----------
  // opts: { now, name }. Result: { doc, images: [{ item, name, data }],
  // linked: n, links: [{ item, name }], stats: { pages, items,
  // skipped } } or null.
  function convert(src, opts) {
    opts = opts || {};
    var now = opts.now || 1, tree = parseXml(String(src || ""));
    var D = find1(tree, "DOCUMENT");
    if (!D) return null;
    var pagesN = kids(D, "PAGE").sort(function (a, b) { return num(a.a.NUM, 0) - num(b.a.NUM, 0); });
    if (!pagesN.length) return null;
    var p0 = pagesN[0].a, used = {};
    var unitOf = ["pt", "mm", "in", "pt", "mm", "mm"][parseInt(D.a.UNITS, 10) || 0] || "pt";
    var bleed = Math.max(num(D.a.BleedTop, 0), num(D.a.BleedBottom, 0), num(D.a.BleedLeft, 0), num(D.a.BleedRight, 0));
    var facing = D.a.BOOK === "1" || pagesN.some(function (p) { return p.a.LEFT === "1"; }) ? 1 : 0;
    var doc = M.newDoc({
      name: opts.name || D.a.TITLE || "Scribus", w: num(p0.PAGEWIDTH, num(D.a.PAGEWIDTH, 595.276)), h: num(p0.PAGEHEIGHT, num(D.a.PAGEHEIGHT, 841.89)),
      unit: unitOf, bleed: bleed, mt: num(D.a.BORDERTOP, 36), mb: num(D.a.BORDERBOTTOM, 36), mi: num(D.a.BORDERLEFT, 36), mo: num(D.a.BORDERRIGHT, 36),
      cols: num(D.a.AUTOSPALTEN, 1), gut: num(D.a.ABSTSPALTEN, 12), facing: facing, preset: "custom", pages: pagesN.length
    }, now);
    var stats = { pages: pagesN.length, items: 0, skipped: 0 };
    ["sw-black", "sw-paper"].forEach(function (k) { used[k] = 1; });
    doc.swatches.forEach(function (s) { used[s.id] = 1; });
    var cols = colours(D, now, used);
    cols.list.forEach(function (s) { doc.swatches.push(s); });
    var colour = tinter(doc, cols.map, now, used);

    // named gradients (1.5+): name → its CSTOP list
    var gradBy = {};
    kids(D, "Gradient").forEach(function (g) { if (g.a.Name) gradBy[g.a.Name] = kids(g, "CSTOP"); });
    // GRTYP: 1 horizontal, 2 vertical, 3 diagonal, 4 cross diagonal,
    // 5 radial (fixed directions, 1.4), 6 linear, 7 radial (free)
    var GRAD_DEF = { 1: ["l", 0, 0.5, 1, 0.5], 2: ["l", 0.5, 0, 0.5, 1], 3: ["l", 0, 0, 1, 1], 4: ["l", 0, 1, 1, 0], 5: ["r", 0.5, 0.5, 1, 1], 6: ["l", 0, 0.5, 1, 0.5], 7: ["r", 0.5, 0.5, 1, 1] };
    function gradOf(node, w, h) {
      var a = node.a, typ = parseInt(a.GRTYP, 10), def = GRAD_DEF[typ];
      if (!def) return null;
      var stops = kids(node, "CSTOP");
      if (!stops.length && a.GRNAME && gradBy[a.GRNAME]) stops = gradBy[a.GRNAME];
      var st = stops.slice(0, 16).map(function (c) {
        var id = colour(c.a.NAME, c.a.SHADE);
        return [Math.min(1, Math.max(0, num(c.a.RAMP, 0))), id || "sw-paper", id ? Math.round(100 * Math.min(1, Math.max(0, num(c.a.TRANS, 1)))) : 0];
      });
      if (st.length < 2) return null;
      var g = { k: def[0], x1: def[1], y1: def[2], x2: def[3], y2: def[4], st: st };
      if (a.GRSTARTX !== undefined && a.GRENDX !== undefined && (typ === 6 || typ === 7 || num(a.GRSTARTX, 0) || num(a.GRENDX, 0) || num(a.GRSTARTY, 0) || num(a.GRENDY, 0))) {
        g.x1 = num(a.GRSTARTX, 0) / w; g.y1 = num(a.GRSTARTY, 0) / h; g.x2 = num(a.GRENDX, w) / w; g.y2 = num(a.GRENDY, 0) / h;
      }
      return M.normGrad(g);
    }

    // layers: stacking order by LEVEL; hidden / non-printing → hidden
    // objects, not editable → locked
    var layerBy = {};
    kids(D, "LAYERS").forEach(function (l) {
      layerBy[l.a.NUMMER] = { level: num(l.a.LEVEL, 0), hide: l.a.SICHTBAR === "0" || l.a.DRUCKEN === "0", lock: l.a.EDIT === "0" };
    });

    // masters: one Layout master per Scribus master page
    doc.masters = [];
    var masterBy = {}, masterPos = {}, letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
    kids(D, "MASTERPAGE").forEach(function (mp, k) {
      var nm = mp.a.NAM || ("Master " + (k + 1));
      if (masterBy[nm]) return;
      var id = slug(nm, "ms", used);
      masterBy[nm] = id;
      masterPos[nm] = { x: num(mp.a.PAGEXPOS, 0), y: num(mp.a.PAGEYPOS, 0) };
      doc.masters.push({ id: id, m: now, name: String(nm).slice(0, 60), pre: letters[k % 26] });
    });
    var order = M.pagesInOrder(doc), pagePos = [];
    pagesN.forEach(function (pn, k) {
      order[k].ms = masterBy[pn.a.MNAM] || "";
      pagePos.push({ id: order[k].id, x: num(pn.a.PAGEXPOS, 0), y: num(pn.a.PAGEYPOS, 0) });
    });

    // paragraph styles (Scribus inheritance kept through "based on")
    var styleId = {}, styleRaw = {};
    var defName = "Default Paragraph Style";
    kids(D, "STYLE").forEach(function (st) {
      var nm = st.a.NAME;
      if (!nm || styleId[nm]) return;
      styleRaw[nm] = st.a;
      styleId[nm] = nm === defName || st.a.DefaultStyle === "1" ? "ps-base" : slug(nm, "ps", used);
    });
    doc.pstyles.forEach(function (p) { used[p.id] = 1; });
    Object.keys(styleId).forEach(function (nm) {
      var a = styleRaw[nm], o = psProps(a, colour), id = styleId[nm];
      if (id === "ps-base") {
        var base = M.find(doc.pstyles, "ps-base");
        Object.keys(o).forEach(function (k) { base[k] = o[k]; });
        return;
      }
      o.id = id; o.m = now; o.name = String(nm).slice(0, 60);
      o.base = a.PARENT && styleId[a.PARENT] ? styleId[a.PARENT] : "ps-base";
      doc.pstyles.push(o);
    });
    // Scribus kerns by default (LY-KERN)
    var base0 = M.find(doc.pstyles, "ps-base");
    base0.ext = base0.ext || {};
    base0.ext.kern = 1;
    // paragraph with local overrides → a derived style, made once
    var derived = {};
    function paraStyle(a) {
      var parent = a.PARENT && styleId[a.PARENT] ? styleId[a.PARENT] : "ps-base";
      var loc = {};
      ["ALIGN", "LINESP", "LINESPMode", "VOR", "NACH", "FIRST", "INDENT", "RMARGIN"].forEach(function (k) { if (a[k] !== undefined) loc[k] = a[k]; });
      if (!Object.keys(loc).length) return parent;
      var key = parent + JSON.stringify(loc);
      if (derived[key]) return derived[key];
      var o = psProps(loc, colour), id = slug(parent.slice(3) + "loc", "ps", used);
      o.id = id; o.m = now; o.base = parent;
      o.name = (parent === "ps-base" ? "Basic" : (a.PARENT || "")).slice(0, 48) + " · " + Object.keys(derived).length;
      doc.pstyles.push(o);
      derived[key] = id;
      return id;
    }
    // character overrides (family / size / colour) → character styles
    var csBy = {};
    function charStyle(o) {
      var key = JSON.stringify(o);
      if (csBy[key]) return csBy[key];
      if (Object.keys(csBy).length >= 200) return "";
      var id = slug("imp" + Object.keys(csBy).length, "cs", used), s = { id: id, m: now, name: "Scribus " + (Object.keys(csBy).length + 1) };
      Object.keys(o).forEach(function (k) { s[k] = o[k]; });
      doc.cstyles.push(s);
      csBy[key] = id;
      return id;
    }
    function resolved(styleName) {
      var out = {}, seen = {}, nm = styleName;
      var chain = [];
      while (nm && styleRaw[nm] && !seen[nm]) { seen[nm] = 1; chain.unshift(styleRaw[nm]); nm = styleRaw[nm].PARENT; }
      if (styleRaw[defName] && !seen[defName]) chain.unshift(styleRaw[defName]);
      chain.forEach(function (a) { Object.keys(a).forEach(function (k) { out[k] = a[k]; }); });
      return out;
    }

    // ---------- objects ----------
    var images = [], linked = 0, links = [], byItemId = {}, items = [];
    function storyOf(node) {
      var host = find1(node, "StoryText") || node, paras = [], runs = [];
      var defA = (kids(host, "DefaultStyle")[0] || {}).a || {};
      function endPara(a) {
        var pa = {};
        Object.keys(defA).forEach(function (k) { pa[k] = defA[k]; });
        Object.keys(a || {}).forEach(function (k) { pa[k] = a[k]; });
        var ps = paraStyle(pa), sty = resolved(pa.PARENT);
        var sf = fontOf(sty.FONT), base = { size: num(sty.FONTSIZE, 0), color: sty.FCOLOR, shade: sty.FSHADE };
        paras.push({ ps: ps, runs: runs.map(function (r) {
          var o = { t: r.t }, ra = r.a, cs = {};
          if (ra.FONT !== undefined) {
            var f = fontOf(ra.FONT);
            if (famName(ra.FONT) !== famName(sty.FONT)) { cs.font = f.font; cs.ext = { srcFont: String(ra.FONT).slice(0, 60) }; }
            if (f.b !== sf.b) o.b = f.b;
            if (f.i !== sf.i) o.i = f.i;
          }
          if (ra.FONTSIZE !== undefined && Math.abs(num(ra.FONTSIZE, 0) - base.size) > 0.01) cs.size = num(ra.FONTSIZE, 11);
          if ((ra.FCOLOR !== undefined && ra.FCOLOR !== base.color) || (ra.FSHADE !== undefined && ra.FSHADE !== base.shade)) cs.color = colour(ra.FCOLOR !== undefined ? ra.FCOLOR : base.color, ra.FSHADE) || "sw-black";
          if ((ra.FEATURES && /underline/.test(ra.FEATURES)) || (ra.TXTSTYLE && (parseInt(ra.TXTSTYLE, 10) & 8))) o.u = 1;
          if (r.f) { delete o.t; o.f = r.f; }
          if (Object.keys(cs).length) { var id = charStyle(cs); if (id) o.cs = id; }
          if (!o.b) delete o.b;
          if (!o.i) delete o.i;
          return o;
        }) });
        runs = [];
      }
      host.c.forEach(function (x) {
        if (x.n === "ITEXT") {
          // 1.4 kept paragraph breaks inside CH as U+2029 or \r
          var parts = String(x.a.CH || "").split(/[\u2029\r\n]/);
          parts.forEach(function (t, k) {
            if (k) endPara({});
            t = t.replace(/[\t\u0009]/g, " ").replace(/[\u0000-\u001f\u2028]/g, "");
            if (t) runs.push({ t: t, a: x.a });
          });
        } else if (x.n === "para") endPara(x.a);
        else if (x.n === "trail") endPara(x.a);
        else if (x.n === "tab") runs.push({ t: " ", a: {} });
        else if (x.n === "nbspace") runs.push({ t: "\u00a0", a: {} });
        else if (x.n === "breakline" || x.n === "breakcol" || x.n === "breakframe") endPara({});
        else if (x.n === "var" && (x.a.name === "pgno" || x.a.name === "pgco")) runs.push({ f: x.a.name === "pgno" ? "pn" : "pc", a: {} });
      });
      if (runs.length || !paras.length) endPara({});
      return { id: M.newId("st"), m: now, h: [], paras: paras };
    }

    function ownerOf(node) {
      var mn = node.a.OnMasterPage;
      if (mn) return masterBy[mn] ? { id: masterBy[mn], x: masterPos[mn].x, y: masterPos[mn].y } : null;
      var k = parseInt(node.a.OwnPage, 10);
      if (!(k >= 0) || !pagePos[k]) {
        // scratch-space objects: the page they sit on, if any
        var x = num(node.a.XPOS, 0), y = num(node.a.YPOS, 0);
        for (var i = 0; i < pagePos.length; i++) {
          var p = pagePos[i];
          if (x >= p.x && y >= p.y && x <= p.x + doc.setup.w && y <= p.y + doc.setup.h) return p;
        }
        return null;
      }
      return pagePos[k];
    }

    var z = 0;
    function addObject(node, gx, gy, gLayer) {
      var a = node.a, typ = parseInt(a.PTYPE, 10);
      if (typ === 12) {    // group: its members
        kids(node).forEach(function (ch) { if (ch.n === "PAGEOBJECT" || ch.n === "MASTEROBJECT" || ch.n === "ITEM") addObject(ch, num(a.XPOS, 0), num(a.YPOS, 0), a.LAYER !== undefined ? a.LAYER : gLayer); });
        return;
      }
      if (typ === 9 || typ === 10 || typ === 11 || typ === 17) { stats.skipped++; return; }
      var own = ownerOf(node);
      if (!own && gx !== undefined) own = ownerOf({ a: { OwnPage: a.OwnPage, OnMasterPage: a.OnMasterPage, XPOS: gx, YPOS: gy } });
      if (!own) { stats.skipped++; return; }
      var x = (a.XPOS !== undefined ? num(a.XPOS, 0) : (gx || 0) + num(a.gXpos, 0)) - own.x;
      var y = (a.YPOS !== undefined ? num(a.YPOS, 0) : (gy || 0) + num(a.gYpos, 0)) - own.y;
      var w = Math.max(0.5, num(a.WIDTH, 10)), h = Math.max(0.5, num(a.HEIGHT, 10)), rot = num(a.ROT, 0);
      var lay = layerBy[a.LAYER] || layerBy[gLayer] || { level: 0 };
      var it = { id: M.newId("it"), m: now, pg: own.id, z: (Math.max(0, Math.min(999, lay.level)) * 1e6 + (++z)) * 16 };
      if (lay.hide) it.hide = 1;
      it.fill = colour(a.PCOLOR, a.SHADE);
      it.stroke = colour(a.PCOLOR2, a.SHADE2);
      it.sw = num(a.PWIDTH, 1);
      if (!it.stroke || !(it.sw > 0)) { it.stroke = ""; }
      it.op = Math.round(100 * (1 - Math.min(1, Math.max(0, num(a.TransValue, 0)))));
      if (a.LOCK === "1" || lay.lock) it.lock = 1;
      if (a.TEXTFLOWMODE && a.TEXTFLOWMODE !== "0") it.wrap = a.FRTYPE === "1" ? "ell" : "box";
      if (a.DASHS || (a.PLINEART && a.PLINEART !== "1")) it.dash = 1;
      if (typ === 5) {    // line: length along the rotation
        var r = rot * Math.PI / 180;
        it.t = "line"; it.x = x; it.y = y; it.w = num(a.WIDTH, 10) * Math.cos(r); it.h = num(a.WIDTH, 10) * Math.sin(r); it.rot = 0;
        it.stroke = it.stroke || colour(a.PCOLOR2 || "Black", a.SHADE2) || "sw-black";
        it.fill = "";
      } else {
        place(it, x, y, w, h, rot);
        if (typ === 4 || typ === 8) {
          it.t = "text";
          it.cols = Math.max(1, num(a.COLUMNS, 1)); it.gut = num(a.COLGAP, 0);
          it.ins = Math.max(num(a.EXTRA, 0), num(a.TEXTRA, 0), num(a.BEXTRA, 0), num(a.REXTRA, 0));
          it.va = a.VAlign === "1" ? "c" : a.VAlign === "2" ? "b" : "t";
          if (typ === 8) stats.skipped++;
        } else if (typ === 2) {
          it.t = "img";
          it.nm = String(a.PFILE || "").split(/[\\\/]/).pop().slice(0, 120);
          it.fit = a.SCALETYPE === "0" ? "fill" : "fit";
          // how Scribus placed it, for io.js once the picture is there:
          // [mode (0 own scale and offset, 1 fit keeping proportions,
          // 2 stretched to the frame), x / y scale (pt per pixel),
          // x / y offset (pixels)]
          var mode = a.SCALETYPE === "0" ? 0 : a.RATIO === "0" ? 2 : 1;
          it.ext = { place: [mode, num(a.LOCALSCX, 1), num(a.LOCALSCY, 1), num(a.LOCALX, 0), num(a.LOCALY, 0)] };
          if (a.isInlineImage === "1" && a.ImageData) images.push({ item: it.id, name: it.nm || "image", data: a.ImageData, type: a.inlineImageExt || "" });
          else if (a.PFILE) { linked++; links.push({ item: it.id, name: it.nm }); }
        } else {
          // shapes are polygons (6) whose FRTYPE says rectangle (0),
          // ellipse (1), rounded rectangle (2) or a free shape (3);
          // polylines (7), regular polygons (13), arcs (14) and spirals
          // (15) are free shapes too
          var free = (typ === 6 && a.FRTYPE === "3") || typ === 7 || typ === 13 || typ === 14 || typ === 15;
          var d = free ? pathData(a.path ? svgPath(a.path) : poCoor(a.POCOOR), w, h) : "";
          if (d) {
            it.t = "path"; it.d = d;
            if (a.fillRule !== "0") it.eo = 1;
            if (typ === 7 || typ === 15) it.stroke = it.stroke || "sw-black";
          } else {
            it.t = a.FRTYPE === "1" ? "ell" : "rect";
            if (a.FRTYPE === "2" && num(a.RADRECT, 0) > 0) it.r = num(a.RADRECT, 0);
            if (typ !== 6 || a.FRTYPE === "3") stats.skipped++;     // drawn as its box
            if (typ === 7) { it.fill = ""; it.stroke = it.stroke || "sw-black"; }
            if (typ === 16) { it.fill = ""; it.stroke = "sw-black"; it.sw = 0.5; }
          }
          if (a.GRTYP !== undefined && a.GRTYP !== "0" && typ !== 16) {
            var gr = gradOf(node, w, h);
            if (gr) { it.gr = gr; it.fill = it.fill || gr.st[0][1]; }
            else stats.skipped++;
          }
        }
      }
      items.push({ it: it, node: node });
      if (a.ItemID) byItemId[a.ItemID] = it;
      byItemId["#" + items.length] = it;
      stats.items++;
    }
    kids(D).forEach(function (n) { if (n.n === "MASTEROBJECT" || n.n === "PAGEOBJECT") addObject(n); });

    // text threads: NEXTITEM / BACKITEM (ItemID in 1.5+, list index in 1.4)
    var idx = {};
    items.forEach(function (o, k) { idx[k] = o.it; });
    function ref(v) {
      if (v === undefined || v === "-1" || v === "") return null;
      return byItemId[v] || (/^\d+$/.test(v) ? idx[parseInt(v, 10)] : null) || null;
    }
    var hasBack = {};
    items.forEach(function (o) { if (o.it.t === "text") { var nx = ref(o.node.a.NEXTITEM); if (nx && nx.t === "text" && nx !== o.it) hasBack[nx.id] = 1; } });
    function thread(o) {
      var st = storyOf(o.node), cur = o, seq = 1024;
      doc.stories.push(st);
      while (cur && !cur.it.story) {
        cur.it.story = st.id; cur.it.seq = seq; seq += 1024;
        var nx = ref(cur.node.a.NEXTITEM), nxt = null;
        if (nx && nx.t === "text") items.forEach(function (q) { if (q.it === nx) nxt = q; });
        cur = nxt;
      }
    }
    items.forEach(function (o) { if (o.it.t === "text" && !hasBack[o.it.id] && !o.it.story) thread(o); });
    // a thread that loops back on itself has no head: start at its first frame
    items.forEach(function (o) { if (o.it.t === "text" && !o.it.story) thread(o); });
    items.forEach(function (o) { doc.items.push(o.it); });
    if (doc.items.length > M.MAX_ITEMS) doc.items.length = M.MAX_ITEMS;
    if (!doc.masters.length) {
      doc.masters.push({ id: "ms-a", m: now, name: { en: "A-Master", el: "A-Master" }, pre: "A" });
    }
    var out = M.normDoc(doc);
    return { doc: out, images: images, linked: linked, links: links, stats: stats };
  }

  // Scribus inline image data: base64 of qCompress (4-byte big-endian
  // length + zlib stream). Returns a Promise of a Blob, or null.
  function inlineImage(img) {
    if (typeof DecompressionStream === "undefined") return Promise.resolve(null);
    var bin;
    try { bin = atob(String(img.data).replace(/\s+/g, "")); } catch (e) { return Promise.resolve(null); }
    var u = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
    if (u.length < 6) return Promise.resolve(null);
    var ds = new DecompressionStream("deflate");
    var stream = new Blob([u.subarray(4)]).stream().pipeThrough(ds);
    return new Response(stream).blob().then(function (b) {
      var ext = String(img.type || "").toLowerCase(), type = ext === "png" ? "image/png" : ext === "gif" ? "image/gif" : ext === "svg" ? "image/svg+xml" : "image/jpeg";
      return new Blob([b], { type: type });
    }, function () { return null; });
  }

  // A .sla.gz (gzip) → the XML text, at most `max` bytes unpacked.
  // Promise of a string, or null.
  function gunzip(buf, max) {
    var u = new Uint8Array(buf);
    max = max || 200 * 1024 * 1024;
    if (!(u.length > 18 && u[0] === 0x1f && u[1] === 0x8b)) return Promise.resolve(null);
    if (typeof DecompressionStream === "undefined") return Promise.resolve(null);
    var rd = new Blob([u]).stream().pipeThrough(new DecompressionStream("gzip")).getReader(), parts = [], size = 0;
    function pump() {
      return rd.read().then(function (r) {
        if (r.done) return new Blob(parts).text();
        size += r.value.length;
        if (size > max) { try { rd.cancel(); } catch (e) {} return null; }
        parts.push(r.value);
        return pump();
      });
    }
    return pump().then(null, function () { return null; });
  }

  // ---------- 5. Pictures found later ----------
  // Linked picture names compare without case, accents written either
  // way (NFC) or a folder in front.
  function nameKey(n) { return String(n || "").split(/[\\\/]/).pop().normalize("NFC").toLowerCase().trim(); }
  // Once its picture is there (it.iw, it.ih), an image frame takes the
  // placement Scribus gave it (ext.place): its own scale and offset,
  // fit, or stretched to the frame. A stretch scales the height on its
  // own (ext.iscy, see designkit/render.js imageRect). Without
  // ext.place nothing changes.
  function placePicture(it) {
    var p = it.ext && it.ext.place;
    if (!Array.isArray(p) || !it.iw || !it.ih) return;
    var sx = p[1] > 0 ? p[1] : 1, sy = p[2] > 0 ? p[2] : sx;
    delete it.ext.iscy;
    if (p[0] === 1) { it.fit = "fit"; return; }
    it.fit = "custom";
    if (p[0] === 2) { sx = it.w / it.iw; sy = it.h / it.ih; it.ix = 0; it.iy = 0; }
    else { it.ix = (p[3] || 0) * sx; it.iy = (p[4] || 0) * sy; }
    it.isc = sx;
    if (Math.abs(sy - sx) > 1e-9 * sx) it.ext.iscy = sy;
  }

  var api = { parseXml: parseXml, convert: convert, inlineImage: inlineImage, gunzip: gunzip, svgPath: svgPath, poCoor: poCoor, fontOf: fontOf, slug: slug, nameKey: nameKey, placePicture: placePicture };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.LY_SLA = api;
})(typeof window !== "undefined" ? window : this);
