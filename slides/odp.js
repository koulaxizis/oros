// ============================================================
// orOS Slides — odp.js: LibreOffice Impress (.odp) open (v1.0.0)
// Pure (no DOM, no storage, no network). Reads an OpenDocument
// presentation into the same neutral plan pptx.js read() makes, so
// OrosSlidesPPTX.build() turns it into a NEW deck (fresh ids,
// everything through core.js normalizers) and nothing that exists is
// ever touched.
//
//   parseXml(text) → node tree { n, a, c } with text kept in order
//     ({ n: "#t", t } children: ODF text is mixed content). No DTD,
//     no entities (refused), at most MAX_NODES nodes.
//   read(zip, opts) → Promise<plan>: zip is an AtelierZip reader of
//     the .odp. plan = { as, title, th, slides:[{ ly, hid, tr, bg, n,
//     items:[spec] }], media:{ path:true }, count:{ skipped, approx,
//     unknown, slides } } plus plan.get(path) → Promise<Uint8Array|
//     null> (the picture's bytes) and plan.source = "odp".
//   readFlat(text, opts) → the same from a flat .fodp (one XML file,
//     pictures inline as office:binary-data).
//   isOdp(zip) → true when the ZIP is an OpenDocument presentation
//     (mimetype entry, or content.xml with office:presentation).
//
// What comes in: slides (draw:page, in order) with their name, size
// (other sizes fit into 16:9 or 4:3), background colour or picture,
// hidden slides, simple transitions; frames (svg:x / y / width /
// height in cm, mm, in, pt, pc or px, draw:transform rotation) with
// text boxes: paragraphs, headings, lists (bullets / numbering,
// levels), spans (bold, italic, underline, colour), alignment,
// vertical anchor, size of the first run, font family; pictures
// (Pictures/… inside the file; links to other files are never
// followed), rectangles, ellipses, custom shapes with their text,
// lines, tables (cell text), groups (flattened), speaker notes
// (presentation:notes). Title / subtitle / outline / graphic frames
// become the Slides placeholders and pick the nearest layout.
// Charts, OLE objects, video and sound become a dashed note (the
// labels of pptx.js) and are counted.
// Styles: automatic styles of content.xml and the styles of
// styles.xml, parent chains followed (paragraph, text, graphic,
// presentation, drawing-page families).
// Exposes OrosOdp on its global (browser or a Node vm) and
// module.exports in Node.
// ============================================================
(function (root) {
  "use strict";

  function C() { return root.OrosSlidesCore; }
  function D() { return root.OrosSlidesDK; }
  function X() { return root.OrosSlidesPPTX; }

  var MAX_XML = 16 * 1024 * 1024, MAX_NODES = 400000, MAX_MEDIA = 60 * 1024 * 1024;
  var MIME = "application/vnd.oasis.opendocument.presentation";

  // ---------- 1. XML ----------
  // Namespaces → the usual prefixes, so a file that names them
  // differently reads the same.
  var NS = {
    "urn:oasis:names:tc:opendocument:xmlns:office:1.0": "office",
    "urn:oasis:names:tc:opendocument:xmlns:style:1.0": "style",
    "urn:oasis:names:tc:opendocument:xmlns:text:1.0": "text",
    "urn:oasis:names:tc:opendocument:xmlns:table:1.0": "table",
    "urn:oasis:names:tc:opendocument:xmlns:drawing:1.0": "draw",
    "urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0": "fo",
    "urn:oasis:names:tc:opendocument:xmlns:svg-compatible:1.0": "svg",
    "urn:oasis:names:tc:opendocument:xmlns:smil-compatible:1.0": "smil",
    "urn:oasis:names:tc:opendocument:xmlns:presentation:1.0": "presentation",
    "urn:oasis:names:tc:opendocument:xmlns:meta:1.0": "meta",
    "http://www.w3.org/1999/xlink": "xlink",
    "http://purl.org/dc/elements/1.1/": "dc"
  };
  var ENT = { lt: "<", gt: ">", amp: "&", quot: "\"", apos: "'" };
  function unesc(s) {
    return s.indexOf("&") < 0 ? s : s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, function (m, e) {
      if (e[0] === "#") {
        var n = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
        return n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : "";
      }
      return ENT[e] !== undefined ? ENT[e] : m;
    });
  }
  function parseXml(src) {
    src = String(src == null ? "" : src);
    if (src.length > MAX_XML || /<!DOCTYPE|<!ENTITY/i.test(src)) throw new Error("xml");
    var doc = { n: "#doc", a: {}, c: [] }, stack = [doc], i = 0, L = src.length, count = 0, ren = null;
    function name(q) {
      if (!ren) return q;
      var k = q.indexOf(":");
      if (k < 0) return q;
      var p = ren[q.slice(0, k)];
      return p ? p + q.slice(k) : q;
    }
    function addText(s) {
      if (!s) return;
      var top = stack[stack.length - 1], last = top.c[top.c.length - 1];
      if (last && last.n === "#t") last.t += s; else top.c.push({ n: "#t", a: {}, c: [], t: s });
    }
    while (i < L) {
      var lt = src.indexOf("<", i);
      if (lt < 0) lt = L;
      if (lt > i && stack.length > 1) addText(unesc(src.slice(i, lt)));
      if (lt >= L) break;
      if (src.startsWith("<!--", lt)) { var ce = src.indexOf("-->", lt + 4); i = ce < 0 ? L : ce + 3; continue; }
      if (src.startsWith("<![CDATA[", lt)) {
        var de = src.indexOf("]]>", lt + 9);
        addText(src.slice(lt + 9, de < 0 ? L : de));
        i = de < 0 ? L : de + 3; continue;
      }
      if (src[lt + 1] === "?" || src[lt + 1] === "!") { var pe = src.indexOf(">", lt); i = pe < 0 ? L : pe + 1; continue; }
      // the end of the tag: the first ">" outside quotes
      var j = lt + 1, q = "";
      for (; j < L; j++) {
        var ch = src[j];
        if (q) { if (ch === q) q = ""; }
        else if (ch === "\"" || ch === "'") q = ch;
        else if (ch === ">") break;
      }
      if (j >= L) break;
      var body = src.slice(lt + 1, j);
      i = j + 1;
      if (body[0] === "/") { if (stack.length > 1) stack.pop(); continue; }
      var self = body[body.length - 1] === "/";
      if (self) body = body.slice(0, -1);
      var m = /^([^\s\/>]+)/.exec(body);
      if (!m) continue;
      var node = { n: m[1], a: {}, c: [] };
      var re = /([^\s=]+)\s*=\s*("([^"]*)"|'([^']*)')/g, am;
      re.lastIndex = m[1].length;
      while ((am = re.exec(body))) node.a[am[1]] = unesc(am[3] !== undefined ? am[3] : am[4]);
      if (stack.length === 1) {
        // the root element's namespace declarations
        Object.keys(node.a).forEach(function (k) {
          var pm = /^xmlns:(.+)$/.exec(k), want = pm && NS[node.a[k]];
          if (want && pm[1] !== want) (ren = ren || {})[pm[1]] = want;
        });
      }
      node.n = name(node.n);
      if (ren) {
        var a2 = {};
        Object.keys(node.a).forEach(function (k) { a2[/^xmlns:/.test(k) ? k : name(k)] = node.a[k]; });
        node.a = a2;
      }
      if (++count > MAX_NODES) throw new Error("xml");
      stack[stack.length - 1].c.push(node);
      if (!self) stack.push(node);
    }
    return doc;
  }
  function kid(n, nm) {
    if (!n) return null;
    for (var i = 0; i < n.c.length; i++) if (n.c[i].n === nm) return n.c[i];
    return null;
  }
  function kids(n, nm) { return n ? n.c.filter(function (x) { return x.n === nm; }) : []; }
  function path(n, names) {
    for (var i = 0; i < names.length && n; i++) n = kid(n, names[i]);
    return n;
  }
  function find(n, nm) {
    if (!n) return null;
    for (var i = 0; i < n.c.length; i++) {
      if (n.c[i].n === nm) return n.c[i];
      var f = find(n.c[i], nm);
      if (f) return f;
    }
    return null;
  }
  // all text below a node, in order
  function textIn(n) {
    if (!n) return "";
    if (n.n === "#t") return n.t;
    return n.c.map(textIn).join("");
  }

  // ---------- 2. Units, colours ----------
  var CM = { cm: 1, mm: 0.1, in: 2.54, inch: 2.54, pt: 2.54 / 72, pc: 2.54 / 6, px: 2.54 / 96 };
  // a length → cm (NaN when unreadable)
  function len(v) {
    var m = /^\s*(-?[\d.]+(?:e-?\d+)?)\s*([a-z]*)\s*$/i.exec(v == null ? "" : String(v));
    if (!m) return NaN;
    var u = m[2].toLowerCase() || "cm", k = CM[u];
    return k ? Number(m[1]) * k : NaN;
  }
  function hex(v) {
    var m = /^#([0-9a-f]{6})$/i.exec(String(v || "").trim());
    if (m) return "#" + m[1].toLowerCase();
    m = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i.exec(String(v || "").trim());
    return m ? ("#" + m[1] + m[1] + m[2] + m[2] + m[3] + m[3]).toLowerCase() : null;
  }
  function lum(h) {
    var v = [1, 3, 5].map(function (i) { return parseInt(h.substr(i, 2), 16) / 255; });
    return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2];
  }
  function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }

  // ---------- 3. Styles ----------
  // One table of every named style of the file: family:name → node.
  function styleTable(docs) {
    var t = { st: {}, lists: {}, fills: {}, layouts: {}, masters: {}, defs: {} };
    docs.forEach(function (doc) {
      var top = doc && doc.c[0];
      if (!top) return;
      ["office:styles", "office:automatic-styles", "office:master-styles"].forEach(function (sec) {
        kids(top, sec).forEach(function (s) {
          s.c.forEach(function (n) {
            var nm = n.a["style:name"] || n.a["draw:name"];
            if (n.n === "style:style" && nm) t.st[(n.a["style:family"] || "") + ":" + nm] = n;
            else if (n.n === "text:list-style" && nm) t.lists[nm] = n;
            else if (n.n === "draw:fill-image" && nm) t.fills[nm] = n;
            else if (n.n === "style:page-layout" && nm) t.layouts[nm] = n;
            else if (n.n === "style:master-page" && nm) t.masters[nm] = n;
            else if (n.n === "style:default-style") t.defs[n.a["style:family"] || ""] = n;
          });
        });
      });
    });
    return t;
  }
  // A property of a style, following its parents (and the family's
  // default style last).
  function prop(T, fam, name, tag, attr) {
    var seen = 0;
    while (name && seen++ < 20) {
      var s = T.st[fam + ":" + name];
      if (!s) break;
      var p = kid(s, tag);
      if (p && p.a[attr] !== undefined) return p.a[attr];
      name = s.a["style:parent-style-name"];
    }
    var d = T.defs[fam], dp = d && kid(d, tag);
    return dp && dp.a[attr] !== undefined ? dp.a[attr] : undefined;
  }
  // The first value along a chain of [family, name] styles.
  function chainProp(T, chain, tag, attr) {
    for (var i = 0; i < chain.length; i++) {
      if (!chain[i][1]) continue;
      var v = prop(T, chain[i][0], chain[i][1], tag, attr);
      if (v !== undefined) return v;
    }
    return undefined;
  }

  // ---------- 4. Text ----------
  var ALIGN = { start: "l", left: "l", center: "c", end: "r", right: "r", justify: "j" };
  var TXT = "style:text-properties", PAR = "style:paragraph-properties", GR = "style:graphic-properties";

  function runFmt(T, chain) {
    var w = chainProp(T, chain, TXT, "fo:font-weight"), st = chainProp(T, chain, TXT, "fo:font-style");
    var un = chainProp(T, chain, TXT, "style:text-underline-style");
    var col = hex(chainProp(T, chain, TXT, "fo:color"));
    var sz = chainProp(T, chain, TXT, "fo:font-size");
    var face = chainProp(T, chain, TXT, "style:font-name") || chainProp(T, chain, TXT, "fo:font-family") || "";
    return {
      b: w === "bold" || Number(w) >= 600, i: st === "italic" || st === "oblique",
      u: !!un && un !== "none", c: col, sz: /pt$/i.test(sz || "") ? len(sz) / CM.pt : 0,
      face: String(face).replace(/['"]/g, "")
    };
  }
  // The list kind at a level: "n" numbered, "b" bullet, "" none.
  function listKind(T, listName, lvl, dflt) {
    var ls = listName && T.lists[listName];
    if (!ls) return dflt;
    var hit = null;
    ls.c.forEach(function (x) { if (/^text:list-level-style-/.test(x.n) && Number(x.a["text:level"] || 1) === lvl + 1) hit = x; });
    if (!hit) return dflt;
    if (hit.n === "text:list-level-style-number") return hit.a["style:num-format"] ? "n" : "";
    if (hit.n === "text:list-level-style-bullet" || hit.n === "text:list-level-style-image") return "b";
    return "";
  }
  // A text box (draw:text-box, or a shape's own text) → paragraphs.
  // base: the frame's style chain. Every paragraph is { l, ls, al, r:
  // [{ t, b, i, u, c, sz, face }] }.
  function parasOf(T, host, base, dfltList) {
    var out = [];
    function para(p, lvl, ls) {
      var pchain = [["paragraph", p.a["text:style-name"]]].concat(base);
      var al = ALIGN[chainProp(T, pchain, PAR, "fo:text-align")] || "l";
      var cur = { l: Math.min(lvl, 4), ls: ls, al: al, r: [] };
      out.push(cur);
      function add(t, chain) {
        if (!t) return;
        var f = runFmt(T, chain), last = cur.r[cur.r.length - 1];
        // white space: one space, none at the start of a line
        if (/^ /.test(t) && (!last || / $/.test(last.t))) t = t.replace(/^ +/, "");
        if (!t) return;
        f.t = t;
        cur.r.push(f);
      }
      (function walk(n, chain) {
        n.c.forEach(function (x) {
          if (x.n === "#t") add(x.t.replace(/[\s]+/g, " "), chain);
          else if (x.n === "text:s") add(new Array(clamp(Number(x.a["text:c"]) || 1, 1, 50) + 1).join("\u00a0"), chain);
          else if (x.n === "text:tab") add("\u00a0\u00a0\u00a0\u00a0", chain);
          else if (x.n === "text:line-break") { cur = { l: cur.l, ls: "", al: cur.al, r: [] }; out.push(cur); }
          else if (x.n === "text:span") walk(x, [["text", x.a["text:style-name"]]].concat(chain));
          else if (x.n === "text:a" || x.n === "text:meta" || x.n === "text:ruby" || x.n === "text:ruby-base") walk(x, chain);
          else if (/^text:(page-number|date|time|title|sender-|author-|file-name)/.test(x.n)) add(textIn(x), chain);
        });
      })(p, pchain);
      // trailing white space of the line
      for (var k = out.indexOf(cur); k < out.length; k++) {
        var rs = out[k].r;
        while (rs.length && !rs[rs.length - 1].t.replace(/[ \u00a0]+$/, "")) rs.pop();
        if (rs.length) rs[rs.length - 1].t = rs[rs.length - 1].t.replace(/ +$/, "");
      }
    }
    (function walk(n, lvl, listName, inList) {
      n.c.forEach(function (x) {
        if (x.n === "text:p" || x.n === "text:h") para(x, lvl, inList ? listKind(T, listName, lvl, inList) : "");
        else if (x.n === "text:list") {
          var nm = x.a["text:style-name"] || listName;
          var deeper = inList ? lvl + 1 : 0;
          x.c.forEach(function (li) {
            if (li.n === "text:list-item") walk(li, deeper, nm, dfltList || "b");
            else if (li.n === "text:list-header") walk(li, deeper, nm, "");
          });
        } else if (x.n === "text:section" || x.n === "draw:text-box") walk(x, lvl, listName, inList);
      });
    })(host, 0, null, "");
    // a list item's first paragraph has the bullet: the continuation
    // paragraphs of one item (rare) keep it too, simpler and harmless
    while (out.length && !out[out.length - 1].r.length) out.pop();
    return out;
  }
  // paragraphs → the plan's text spec fields (as pptx.js textOf)
  function textSpec(paras, k, levelSize) {
    var first = null;
    paras.forEach(function (p) { p.r.forEach(function (r) { if (!first) first = { r: r, l: p.l }; }); });
    var fc = first && first.r.c ? first.r.c : null, ff = "", fs = 0;
    if (first && first.r.sz) fs = first.r.sz * k / levelSize(1, first.l);
    if (first && first.r.face && X() && X().familyOf) ff = X().familyOf(first.r.face);
    var out = paras.map(function (p) {
      var rs = [];
      p.r.forEach(function (r) {
        var o = { t: r.t };
        if (r.b) o.b = true;
        if (r.i) o.i = true;
        if (r.u) o.u = true;
        if (r.c && r.c !== fc) o.c = r.c;
        var last = rs[rs.length - 1];
        if (last && last.b === o.b && last.i === o.i && last.u === o.u && last.c === o.c) last.t += o.t;
        else rs.push(o);
      });
      return { l: p.l, ls: p.ls, r: rs };
    });
    if (!out.some(function (p) { return p.r.length; })) out = [];
    return { paras: out, al: paras.length ? paras[0].al : "l", fs: fs ? Math.round(fs) : 0, fc: fc, ff: ff };
  }

  // ---------- 5. Slides ----------
  var TRANS = { fade: "fade", dissolve: "fade", pushWipe: "push", slideWipe: "slide", barWipe: "wipe", irisWipe: "zoom",
    zoom: "zoom", clockWipe: "wipe", fourBoxWipe: "wipe", barnDoorWipe: "wipe", ellipseWipe: "zoom" };
  var CLASS_ROLE = { title: "title", subtitle: "sub", outline: "body", graphic: "img" };
  var LABELS = { chart: "Chart (not imported)", table: "Table (not imported)", diagram: "SmartArt (not imported)",
    media: "Video or sound (not imported)", object: "Embedded object (not imported)" };

  function noteItem(kind, b, labels) {
    return { k: "text", x: b.x, y: b.y, w: Math.max(80, b.w), h: Math.max(60, b.h), r: 0,
      paras: [{ l: 0, ls: "", r: [{ t: labels[kind] || labels.object, b: true }] }],
      fs: 24, fc: "#6b7280", st: "#9ca3af", sw: 2, dash: true, al: "c", va: "m" };
  }

  // A frame / shape's box in slide units (rotation from draw:transform).
  function boxOf(n, ctx) {
    var w = len(n.a["svg:width"]), h = len(n.a["svg:height"]);
    if (!(w >= 0 && h >= 0)) return null;
    var x = len(n.a["svg:x"]), y = len(n.a["svg:y"]), r = 0;
    var tr = n.a["draw:transform"];
    if (tr) {
      var rm = /rotate\s*\(\s*(-?[\d.e-]+)\s*\)/i.exec(tr), tm = /translate\s*\(\s*([^\s,)]+)[\s,]+([^\s,)]+)\s*\)/i.exec(tr);
      var a = rm ? Number(rm[1]) : 0;
      if (tm && isFinite(a)) {
        var tx = len(tm[1]), ty = len(tm[2]);
        // ODF: the box turns by a (counter-clockwise) about its top left
        // corner, then moves; its centre lands at:
        var cx = Math.cos(a) * w / 2 + Math.sin(a) * h / 2 + tx, cy = -Math.sin(a) * w / 2 + Math.cos(a) * h / 2 + ty;
        x = cx - w / 2; y = cy - h / 2; r = -a * 180 / Math.PI;
      }
    }
    if (!isFinite(x)) x = 0;
    if (!isFinite(y)) y = 0;
    return { x: Math.round(ctx.dx + x * ctx.k), y: Math.round(y * ctx.k), w: Math.max(1, Math.round(w * ctx.k)), h: Math.max(1, Math.round(h * ctx.k)), r: Math.round(r) };
  }

  function graphicChain(n) {
    return [["presentation", n.a["presentation:style-name"]], ["graphic", n.a["draw:style-name"]]];
  }
  function fillOf(T, chain) {
    var f = chainProp(T, chain, GR, "draw:fill");
    if (f === "none") return null;
    var c = hex(chainProp(T, chain, GR, "draw:fill-color"));
    return f === "solid" || (f === undefined && c && chain.some(function (s) { return s[1]; })) ? c : null;
  }
  function strokeOf(T, chain, ctx) {
    var s = chainProp(T, chain, GR, "draw:stroke");
    if (!s || s === "none") return null;
    var w = len(chainProp(T, chain, GR, "svg:stroke-width"));
    return { st: hex(chainProp(T, chain, GR, "svg:stroke-color")) || "#000000",
      sw: clamp(Math.round((w > 0 ? w : 0.03) * ctx.k), 1, 50), dash: s === "dash" };
  }
  function vaOf(T, chain) {
    var v = chainProp(T, chain, GR, "draw:textarea-vertical-align");
    return v === "middle" ? "m" : v === "bottom" ? "b" : "t";
  }

  function textItem(T, host, b, chain, ctx, dfltList) {
    var paras = parasOf(T, host, chain, dfltList);
    var ts = textSpec(paras, ctx.k * CM.pt, ctx.levelSize);    // pt → slide units
    return { k: "text", x: b.x, y: b.y, w: b.w, h: b.h, r: b.r, paras: ts.paras, al: ts.al, va: vaOf(T, chain),
      fs: ts.fs, fc: ts.fc, ff: ts.ff, fit: true };
  }

  function walk(T, nodes, ctx, out) {
    nodes.forEach(function (n) {
      try { node(T, n, ctx, out); } catch (e) { out.count.skipped++; }
    });
  }
  function node(T, n, ctx, out) {
    if (n.n === "#t") return;
    if (n.n === "draw:g") { walk(T, n.c, ctx, out); return; }
    if (n.n === "draw:frame") { frame(T, n, ctx, out); return; }
    if (n.n === "draw:rect" || n.n === "draw:ellipse" || n.n === "draw:circle" || n.n === "draw:custom-shape") { shape(T, n, ctx, out); return; }
    if (n.n === "draw:line" || n.n === "draw:connector") { line(T, n, ctx, out); return; }
    if (/^draw:(polygon|polyline|path|regular-polygon|caption|measure)$/.test(n.n)) { shape(T, n, ctx, out); out.count.approx++; return; }
    if (n.n === "presentation:notes" || n.n === "office:forms" || n.n === "anim:par" || /^(anim|office|svg):/.test(n.n)) return;
    if (/^draw:/.test(n.n)) out.count.skipped++;
  }
  function frame(T, n, ctx, out) {
    var b = boxOf(n, ctx);
    if (!b) { out.count.skipped++; return; }
    var cls = n.a["presentation:class"] || "", chain = graphicChain(n);
    var empty = n.a["presentation:placeholder"] === "true";
    var tb = kid(n, "draw:text-box"), imgs = kids(n, "draw:image"), obj = kid(n, "draw:object") || kid(n, "draw:object-ole");
    var tbl = kid(n, "table:table"), plug = kid(n, "draw:plugin");
    var role = CLASS_ROLE[cls] || null;
    // an empty placeholder counts for the layout, which gives it back empty
    if (empty) { if (role) out.items.push({ k: "text", role: cls === "outline" ? "body" : role, paras: [], gone: true }); return; }
    if (tb) {
      var it = textItem(T, tb, b, chain, ctx, cls === "outline" ? "b" : "");
      if (!it.paras.length) return;
      if (role && role !== "img") it.role = role;
      var f = fillOf(T, chain), s = strokeOf(T, chain, ctx);
      if (f) it.fill = f;
      if (s) { it.st = s.st; it.sw = s.sw; if (s.dash) it.dash = true; }
      out.items.push(it);
      return;
    }
    if (imgs.length) {
      // a raster copy before an SVG one, like LibreOffice writes them
      var pick = null;
      imgs.forEach(function (im) {
        var h = im.a["xlink:href"] || "", bin = kid(im, "office:binary-data");
        var key = bin ? "bin:" + out.bin.length : h.replace(/^\.\//, "");
        if (!bin && (/^[a-z][a-z0-9+.-]*:/i.test(key) || /(^|\/)\.\.(\/|$)/.test(key) || !/\.(png|jpe?g|gif|bmp|webp|svg)$/i.test(key))) return;
        var raster = !/\.svg$/i.test(key);
        if (!pick || (raster && !pick.raster)) pick = { key: key, raster: raster, bin: bin };
      });
      if (!pick) { out.count.skipped++; return; }
      if (pick.bin) { out.bin.push(textIn(pick.bin).replace(/\s+/g, "")); }
      out.media[pick.key] = true;
      var alt = textIn(kid(n, "svg:title")) || textIn(kid(n, "svg:desc"));
      var im = { k: "image", x: b.x, y: b.y, w: b.w, h: b.h, r: b.r, media: pick.key, crop: null };
      if (alt) im.alt = alt.slice(0, 300);
      if (role === "img") im.role = "img";
      out.items.push(im);
      return;
    }
    if (tbl) { table(T, tbl, b, out); return; }
    var kind = plug ? "media" : obj ? (/chart/i.test(n.a["presentation:class"] || "") || cls === "chart" ? "chart" : "object") : (cls === "chart" ? "chart" : "object");
    out.items.push(noteItem(kind, b, ctx.labels));
    out.count.unknown++;
  }
  function table(T, tbl, b, out) {
    var rows = [];
    (function walkRows(n) {
      n.c.forEach(function (x) {
        if (x.n === "table:table-row" && rows.length < C().LIM.tRows) {
          var cells = [];
          x.c.forEach(function (cell) {
            if (cell.n !== "table:table-cell" && cell.n !== "table:covered-table-cell") return;
            if (cells.length >= C().LIM.tCols) return;
            cells.push(kids(cell, "text:p").map(function (p) { return textIn(p).replace(/\s+/g, " ").trim(); }).join("\n"));
          });
          rows.push(cells);
        } else if (x.n === "table:table-rows" || x.n === "table:table-header-rows") walkRows(x);
      });
    })(tbl);
    if (!rows.length) { out.count.skipped++; return; }
    out.items.push({ k: "table", x: b.x, y: b.y, w: b.w, h: b.h, r: 0, tb: { rows: rows, hd: true } });
  }
  function shape(T, n, ctx, out) {
    var b = boxOf(n, ctx);
    if (!b) { out.count.skipped++; return; }
    var chain = graphicChain(n);
    var geo = kid(n, "draw:enhanced-geometry"), gt = geo ? geo.a["draw:type"] || "" : "";
    var sh = n.n === "draw:ellipse" || n.n === "draw:circle" || /ellipse|circle/i.test(gt) ? "ellipse" : "rect";
    var f = fillOf(T, chain), s = strokeOf(T, chain, ctx);
    if (f || s) {
      var o = { k: "shape", sh: sh, x: b.x, y: b.y, w: b.w, h: b.h, r: b.r };
      if (f) o.fill = f;
      if (s) { o.st = s.st; o.sw = s.sw; if (s.dash) o.dash = true; }
      if (sh === "rect" && /round/i.test(gt)) o.rad = Math.round(Math.min(b.w, b.h) / 6);
      else if (sh === "rect" && n.a["draw:corner-radius"]) o.rad = Math.round(len(n.a["draw:corner-radius"]) * ctx.k) || undefined;
      if (gt && !/^(rectangle|round-rectangle|ellipse|circle|non-primitive|)$/.test(gt)) out.count.approx++;
      out.items.push(o);
    }
    if (kid(n, "text:p") || kid(n, "text:list")) {
      var it = textItem(T, n, b, chain, ctx, "");
      if (it.paras.length) {
        // a shape's text sits in the middle unless its style says otherwise
        if (!chainProp(T, chain, GR, "draw:textarea-vertical-align")) it.va = "m";
        if (it.al === "l" && !chainProp(T, [["paragraph", (kid(n, "text:p") || { a: {} }).a["text:style-name"]]], PAR, "fo:text-align")) it.al = "c";
        out.items.push(it);
      }
    }
  }
  function line(T, n, ctx, out) {
    var x1 = len(n.a["svg:x1"]), y1 = len(n.a["svg:y1"]), x2 = len(n.a["svg:x2"]), y2 = len(n.a["svg:y2"]);
    if (![x1, y1, x2, y2].every(isFinite)) { out.count.skipped++; return; }
    var s = strokeOf(T, graphicChain(n), ctx) || { st: "#000000", sw: 2 };
    var o = { k: "line", x: Math.round(ctx.dx + Math.min(x1, x2) * ctx.k), y: Math.round(Math.min(y1, y2) * ctx.k),
      w: Math.max(1, Math.round(Math.abs(x2 - x1) * ctx.k)), h: Math.max(1, Math.round(Math.abs(y2 - y1) * ctx.k)), r: 0, st: s.st, sw: s.sw };
    if (s.dash) o.dash = true;
    if ((x2 - x1) * (y2 - y1) < 0) o.flip = true;
    out.items.push(o);
  }

  // Placeholder roles → the Slides layout that holds them (as pptx.js
  // assignRoles): the layout with every role and the fewest extra.
  function assignRoles(S) {
    var taken = {};
    S.items.forEach(function (it) {
      var role = it.role;
      delete it.role;
      if (!role) return;
      if (role === "body" && taken.body) role = "body2";
      if (taken[role]) return;
      taken[role] = 1;
      it.ph = role;
      if (role === "title") it.paras.forEach(function (p) { p.r.forEach(function (r) { delete r.b; }); });
    });
    S.items = S.items.filter(function (it) { return !it.gone; });
    var roles = Object.keys(taken), best = null, bestExtra = 99;
    if (roles.length) C().LAYOUTS.forEach(function (ly) {
      var have = ly.ph.map(function (p) { return p.role; });
      if (!roles.every(function (x) { return have.indexOf(x) >= 0; })) return;
      var e = have.length - roles.length;
      if (e < bestExtra) { best = ly; bestExtra = e; }
    });
    S.ly = best ? best.id : "blank";
    if (!best) S.items.forEach(function (it) { delete it.ph; });
  }

  function notesOf(T, page) {
    var nt = kid(page, "presentation:notes");
    if (!nt) return "";
    var lines = [];
    (function walkN(n) {
      n.c.forEach(function (x) {
        if (x.n === "draw:frame" && x.a["presentation:class"] === "notes") {
          parasOf(T, kid(x, "draw:text-box") || x, [], "").forEach(function (p) {
            lines.push(p.r.map(function (r) { return r.t; }).join("").replace(/\u00a0/g, " "));
          });
        } else if (x.n === "draw:g") walkN(x);
      });
    })(nt);
    return C().cleanBlock(lines.join("\n"), C().LIM.notes);
  }

  // content (+ styles, meta) trees → plan
  function planOf(content, styles, meta, opts) {
    opts = opts || {};
    var labels = {};
    Object.keys(LABELS).forEach(function (k) { labels[k] = (opts.labels && opts.labels[k]) || LABELS[k]; });
    var T = styleTable([styles, content]);
    var top = content && content.c[0];
    var pres = path(top, ["office:body", "office:presentation"]);
    if (!pres) throw new Error("odp");
    var plan = { source: "odp", as: "16:9", title: "", th: "light", slides: [], media: {}, bin: [],
      count: { skipped: 0, approx: 0, unknown: 0, slides: 0 } };
    var t = find(meta, "dc:title");
    plan.title = t ? C().cleanLine(textIn(t), C().LIM.title) : "";
    var pages = kids(pres, "draw:page");
    plan.count.slides = pages.length;
    // page size from the first page's master
    var mp = T.masters[pages.length ? pages[0].a["draw:master-page-name"] : ""] || T.masters[Object.keys(T.masters)[0]];
    var pl = mp && T.layouts[mp.a["style:page-layout-name"]], plp = kid(pl, "style:page-layout-properties");
    var pw = len(plp && plp.a["fo:page-width"]), ph = len(plp && plp.a["fo:page-height"]);
    if (!(pw > 0 && ph > 0)) { pw = 28; ph = 15.75; }
    plan.as = Math.abs(pw / ph - 16 / 9) <= Math.abs(pw / ph - 4 / 3) ? "16:9" : "4:3";
    var k = C().H / ph;
    var ctx = { k: k, dx: (C().widthOf(plan.as) - pw * k) / 2, labels: labels,
      levelSize: D() && D().levelSize ? D().levelSize : function (fs) { return fs; } };
    var W = C().widthOf(plan.as);
    pages.slice(0, C().LIM.slides).forEach(function (pg, idx) {
      var out = { items: [], media: plan.media, count: plan.count, bin: plan.bin };
      var dps = pg.a["draw:style-name"], master = T.masters[pg.a["draw:master-page-name"]];
      var dchain = [["drawing-page", dps], ["drawing-page", master && master.a["draw:style-name"]]];
      var S = { ly: "blank", hid: false, tr: "none", bg: null, n: "", items: [] };
      var vis = prop(T, "drawing-page", dps, "style:drawing-page-properties", "presentation:visibility");
      S.hid = vis === "hidden";
      var tt = prop(T, "drawing-page", dps, "style:drawing-page-properties", "smil:type") ||
        prop(T, "drawing-page", dps, "style:drawing-page-properties", "presentation:transition-type");
      if (tt && TRANS[tt]) S.tr = TRANS[tt];
      var fill = chainProp(T, dchain, "style:drawing-page-properties", "draw:fill");
      if (fill === "solid") S.bg = hex(chainProp(T, dchain, "style:drawing-page-properties", "draw:fill-color"));
      else if (fill === "bitmap") {
        var fi = T.fills[chainProp(T, dchain, "style:drawing-page-properties", "draw:fill-image-name")];
        var href = fi && (fi.a["xlink:href"] || "").replace(/^\.\//, "");
        if (href && !/^[a-z][a-z0-9+.-]*:/i.test(href) && !/(^|\/)\.\.(\/|$)/.test(href) && /\.(png|jpe?g|gif|bmp|webp|svg)$/i.test(href)) {
          plan.media[href] = true;
          out.items.push({ k: "image", x: 0, y: 0, w: W, h: C().H, r: 0, media: href, crop: null, lk: true });
        }
      }
      if (idx === 0) plan.th = S.bg && lum(S.bg) < 0.35 ? "dark" : "light";
      walk(T, pg.c, ctx, out);
      S.n = notesOf(T, pg);
      S.items = out.items;
      assignRoles(S);
      if (S.items.length > C().LIM.items) { plan.count.skipped += S.items.length - C().LIM.items; S.items = S.items.slice(0, C().LIM.items); }
      plan.slides.push(S);
    });
    if (pages.length > C().LIM.slides) plan.count.skipped += pages.length - C().LIM.slides;
    return plan;
  }

  function b64bytes(s) {
    if (typeof root.atob === "function") {
      var bin = root.atob(s), u = new Uint8Array(bin.length);
      for (var i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
      return u;
    }
    return new Uint8Array(Buffer.from(s, "base64"));
  }
  function withGet(plan, zip) {
    var bin = plan.bin;
    delete plan.bin;
    plan.get = function (key) {
      var m = /^bin:(\d+)$/.exec(key);
      if (m) {
        var s = bin[+m[1]];
        if (!s || s.length > MAX_MEDIA * 4 / 3) return Promise.resolve(null);
        try { return Promise.resolve(b64bytes(s)); } catch (e) { return Promise.resolve(null); }
      }
      if (!zip || !zip.has(key)) return Promise.resolve(null);
      return zip.bytes(key, MAX_MEDIA);
    };
    return plan;
  }

  function isOdp(zip) {
    return !!zip && zip.has("content.xml") && (!zip.has("ppt/presentation.xml"));
  }
  function read(zip, opts) {
    function xml(p) {
      if (!zip.has(p)) return Promise.resolve(null);
      return zip.text(p, MAX_XML).then(function (s) { return s === null ? null : parseXml(s); });
    }
    return Promise.all([xml("content.xml"), xml("styles.xml"), xml("meta.xml")]).then(function (r) {
      if (!r[0]) throw new Error("odp");
      return withGet(planOf(r[0], r[1], r[2], opts), zip);
    });
  }
  // a flat .fodp: one office:document with styles, body and meta
  function readFlat(text, opts) {
    var doc = parseXml(text);
    var top = doc.c[0];
    if (!top || top.n !== "office:document") throw new Error("odp");
    var meta = { n: "#doc", a: {}, c: [kid(top, "office:meta") || { n: "x", a: {}, c: [] }] };
    return withGet(planOf(doc, doc, meta, opts), null);
  }

  var API = { MIME: MIME, MAX_MEDIA: MAX_MEDIA, parseXml: parseXml, len: len, read: read, readFlat: readFlat, isOdp: isOdp };
  root.OrosOdp = API;
  if (typeof module !== "undefined" && module.exports) module.exports = API;
})(typeof window !== "undefined" ? window : this);
