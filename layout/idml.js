// ============================================================
// orOS Layout — InDesign .idml import (v1.0.0)
// An IDML file is a zip of XML parts (designmap.xml, Spreads/,
// MasterSpreads/, Stories/, Resources/). This reads it into a NEW
// Layout document: page size, facing pages, margins, columns, bleed,
// colours and tints, paragraph and character styles, master pages,
// text frames with their threads and columns, rectangles, ellipses,
// lines, image frames, groups, rotation, opacity, text wrap.
//   - The zip is read here (stored and deflate entries, through the
//     browser's DecompressionStream); only XML parts are opened, with
//     size limits. The XML goes through the Scribus reader's tokenizer
//     (layout/sla.js: no DOM, no scripts, no external entities).
//   - Images embedded in the file come back as bytes for io.js to
//     store; linked images become empty image frames that keep the
//     file name, ready for Place image.
//   - Not imported (counted in stats.skipped): tables, free shapes
//     (drawn as their box), text on a path, buttons and other
//     interactive objects, footnotes, layers.
// Exposes LY_IDML (browser) or module.exports (Node tests).
// ============================================================
(function (root) {
  "use strict";

  var M, X;
  if (typeof module !== "undefined" && module.exports) { M = require("../designkit/model.js"); X = require("./sla.js"); }
  else { M = root.orosDK.model; X = root.LY_SLA; }

  // ---------- 1. Zip ----------
  var MAX_ENTRY = 64 * 1024 * 1024, MAX_TOTAL = 256 * 1024 * 1024, MAX_FILES = 5000;
  function u16(b, o) { return b[o] | (b[o + 1] << 8); }
  function u32(b, o) { return (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0; }
  var UTF8 = typeof TextDecoder !== "undefined" ? new TextDecoder("utf-8") : null;
  function utf8(b) { return UTF8.decode(b); }

  // Central directory → [{ name, method, csize, size, off }], or null.
  function entries(b) {
    var e = -1;
    for (var i = b.length - 22; i >= Math.max(0, b.length - 65557); i--) if (u32(b, i) === 0x06054b50) { e = i; break; }
    if (e < 0) return null;
    var n = u16(b, e + 10), p = u32(b, e + 16), out = [];
    if (n > MAX_FILES) return null;
    for (var k = 0; k < n; k++) {
      if (p + 46 > b.length || u32(b, p) !== 0x02014b50) return null;
      var nl = u16(b, p + 28), xl = u16(b, p + 30), cl = u16(b, p + 32);
      out.push({ name: utf8(b.subarray(p + 46, p + 46 + nl)), method: u16(b, p + 10), csize: u32(b, p + 20), size: u32(b, p + 24), off: u32(b, p + 42) });
      p += 46 + nl + xl + cl;
    }
    return out;
  }
  function dataOf(b, en) {
    var o = en.off;
    if (o + 30 > b.length || u32(b, o) !== 0x04034b50) return null;
    var s = o + 30 + u16(b, o + 26) + u16(b, o + 28);
    return s + en.csize <= b.length ? b.subarray(s, s + en.csize) : null;
  }
  // Inflate with a hard cap on the output (a lying size field cannot
  // blow up memory).
  function inflate(data, cap) {
    if (typeof DecompressionStream === "undefined") return Promise.reject(new Error("inflate"));
    var rd = new Blob([data]).stream().pipeThrough(new DecompressionStream("deflate-raw")).getReader();
    var parts = [], n = 0;
    function pump() {
      return rd.read().then(function (r) {
        if (r.done) {
          var out = new Uint8Array(n), at = 0;
          parts.forEach(function (x) { out.set(x, at); at += x.length; });
          return out;
        }
        n += r.value.length;
        if (n > cap) { rd.cancel(); throw new Error("too big"); }
        parts.push(r.value);
        return pump();
      });
    }
    return pump();
  }
  // The XML parts of a zip → Promise of { path: text }.
  function unzip(buf) {
    var b = new Uint8Array(buf), list = entries(b);
    if (!list) return Promise.reject(new Error("zip"));
    var files = {}, total = 0, chain = Promise.resolve();
    list.forEach(function (en) {
      if (!/\.xml$/i.test(en.name) || /(^|\/)\.\.(\/|$)/.test(en.name)) return;
      if (en.size > MAX_ENTRY || (total += en.size) > MAX_TOTAL) return;
      var d = dataOf(b, en);
      if (!d) return;
      chain = chain.then(function () {
        if (en.method === 0) return d;
        if (en.method === 8) return inflate(d, MAX_ENTRY);
        return null;
      }).then(function (u) { if (u) files[en.name] = utf8(u); });
    });
    return chain.then(function () { return files; });
  }

  // ---------- 2. Small helpers ----------
  function kids(node, name) { return node.c.filter(function (x) { return !name || x.n === name; }); }
  function find1(node, name) {
    if (node.n === name) return node;
    for (var i = 0; i < node.c.length; i++) { var r = find1(node.c[i], name); if (r) return r; }
    return null;
  }
  function findAll(node, name, out) {
    out = out || [];
    node.c.forEach(function (c) { if (c.n === name) out.push(c); findAll(c, name, out); });
    return out;
  }
  function num(v, def) { var n = parseFloat(v); return isFinite(n) ? n : def; }
  function textOf(node) { return node ? node.c.map(function (c) { return c.n === "#text" ? c.t : ""; }).join("") : ""; }
  // An attribute, or the same property under <Properties> (InDesign
  // writes some either way).
  function prop(node, name) {
    if (node.a[name] !== undefined) return node.a[name];
    var ps = kids(node, "Properties")[0], p = ps ? kids(ps, name)[0] : null;
    return p ? textOf(p) : undefined;
  }

  // 2D matrices [a, b, c, d, tx, ty]: x' = a x + c y + tx, y' = b x + d y + ty
  function mat(s) {
    var v = String(s || "").trim().split(/\s+/).map(Number);
    return v.length === 6 && v.every(isFinite) ? v : [1, 0, 0, 1, 0, 0];
  }
  function apply(m, x, y) { return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]]; }
  // m1 first, then m2
  function mul(m1, m2) {
    return [m1[0] * m2[0] + m1[1] * m2[2], m1[0] * m2[1] + m1[1] * m2[3], m1[2] * m2[0] + m1[3] * m2[2], m1[2] * m2[1] + m1[3] * m2[3],
      m1[4] * m2[0] + m1[5] * m2[2] + m2[4], m1[4] * m2[1] + m1[5] * m2[3] + m2[5]];
  }
  function inv(m) {
    var det = m[0] * m[3] - m[1] * m[2];
    if (!det) return [1, 0, 0, 1, 0, 0];
    var a = m[3] / det, b = -m[1] / det, c = -m[2] / det, d = m[0] / det;
    return [a, b, c, d, -(a * m[4] + c * m[5]), -(b * m[4] + d * m[5])];
  }
  // the anchors of an item's path (inner coordinates)
  function anchors(node) {
    return findAll(node, "PathPointType").map(function (p) {
      var v = String(p.a.Anchor || "").trim().split(/\s+/).map(Number);
      return v.length === 2 && isFinite(v[0]) && isFinite(v[1]) ? v : null;
    }).filter(Boolean);
  }
  // "top left bottom right"
  function bounds(s) {
    var v = String(s || "").trim().split(/\s+/).map(Number);
    return v.length === 4 && v.every(isFinite) ? { t: v[0], l: v[1], b: v[2], r: v[3] } : null;
  }

  // ---------- 3. Colours ----------
  var SEED = { "Color/Black": "sw-black", "Color/Paper": "sw-paper", "Color/Registration": "sw-black", "Swatch/None": "", "n": "" };
  function colours(G, doc, now, used) {
    var map = {}, byRef = {};
    Object.keys(SEED).forEach(function (k) { map[k] = SEED[k]; });
    findAll(G, "Color").forEach(function (c) {
      var ref = c.a.Self;
      if (!ref || map.hasOwnProperty(ref)) return;
      var v = String(c.a.ColorValue || "").trim().split(/\s+/).map(Number), mode;
      if (c.a.Space === "CMYK" && v.length === 4) mode = "cmyk";
      else if (c.a.Space === "RGB" && v.length === 3) mode = "rgb";
      else return;                       // Lab, mixed inks: left out
      v = v.map(function (x) { return Math.round(Math.max(0, Math.min(mode === "rgb" ? 255 : 100, x))); });
      var name = c.a.Name || ref.replace(/^Color\//, "");
      var id = X.slug(name, "sw", used);
      map[ref] = id;
      byRef[ref] = { mode: mode, v: v, name: name };
      doc.swatches.push({ id: id, m: now, name: String(name).slice(0, 60), mode: mode, v: v });
    });
    function base(ref) {
      if (byRef[ref]) return byRef[ref];
      if (map[ref] === "sw-black") return { mode: "cmyk", v: [0, 0, 0, 100], name: "Black" };
      return null;
    }
    var tints = {};
    // a colour reference (+ tint %) → swatch id; tints become swatches
    function colour(ref, tint) {
      if (ref === undefined) return undefined;
      var t = num(tint, -1);
      findAll(G, "Tint").some(function (tn) {
        if (tn.a.Self !== ref) return false;
        ref = tn.a.BaseColor; if (t < 0) t = num(tn.a.TintValue, 100);
        return true;
      });
      if (!map.hasOwnProperty(ref)) return "";
      if (!(t >= 0) || t >= 100 || !map[ref]) return map[ref];
      var b = base(ref);
      if (!b) return map[ref];
      var key = ref + "@" + Math.round(t);
      if (tints[key]) return tints[key];
      var f = t / 100, v = b.mode === "cmyk" ? b.v.map(function (x) { return Math.round(x * f); }) : b.v.map(function (x) { return Math.round(255 - (255 - x) * f); });
      var id = X.slug(b.name + Math.round(t), "sw", used);
      doc.swatches.push({ id: id, m: now, name: (String(b.name).slice(0, 50) + " " + Math.round(t) + "%"), mode: b.mode, v: v });
      tints[key] = id;
      return id;
    }
    return colour;
  }

  // ---------- 4. Styles ----------
  var JUST = { LeftAlign: "l", CenterAlign: "c", RightAlign: "r", LeftJustified: "j", RightJustified: "j", CenterJustified: "j", FullyJustified: "j", ToBindingSide: "l", AwayFromBindingSide: "r" };
  var BOLD = /bold|black|heavy|semibold|demi|extrabold/i, ITAL = /italic|oblique/i;
  // InDesign text attributes → Layout style keys (only those present)
  function textProps(node, colour) {
    var o = {}, v;
    var font = prop(node, "AppliedFont");
    if (font) o.font = X.fontOf(font).font;
    if ((v = node.a.FontStyle) !== undefined) { o.b = BOLD.test(v) ? 1 : 0; o.i = ITAL.test(v) ? 1 : 0; }
    if ((v = node.a.PointSize) !== undefined) o.size = num(v, 12);
    if ((v = prop(node, "Leading")) !== undefined) o.lead = v === "Auto" ? 0 : num(v, 0);
    if ((v = node.a.Justification) !== undefined && JUST[v]) o.align = JUST[v];
    if ((v = node.a.SpaceBefore) !== undefined) o.sb = num(v, 0);
    if ((v = node.a.SpaceAfter) !== undefined) o.sa = num(v, 0);
    if ((v = node.a.FirstLineIndent) !== undefined) o.fi = num(v, 0);
    if ((v = node.a.LeftIndent) !== undefined) o.li = num(v, 0);
    if ((v = node.a.RightIndent) !== undefined) o.ri = num(v, 0);
    if ((v = node.a.FillColor) !== undefined) { var c = colour(v, node.a.FillTint); if (c) o.color = c; }
    if ((v = node.a.Underline) !== undefined) o.u = v === "true" ? 1 : 0;
    if ((v = node.a.Capitalization) !== undefined) o.caps = v === "AllCaps" || v === "SmallCaps" ? 1 : 0;
    if ((v = node.a.Tracking) !== undefined) o.track = num(v, 0);
    if ((v = node.a.BulletsAndNumberingListType) !== undefined) o.bul = v === "BulletList" ? 1 : 0;
    return o;
  }
  var PS_KEYS = ["font", "b", "i", "size", "lead", "align", "sb", "sa", "fi", "li", "ri", "color", "u", "caps", "track", "bul"];
  var CS_KEYS = ["font", "b", "i", "size", "color", "u", "caps", "track"];
  function pick(o, keys) { var r = {}; keys.forEach(function (k) { if (o[k] !== undefined) r[k] = o[k]; }); return r; }
  var BASIC = /^ParagraphStyle\/\$ID\/(\[No paragraph style\]|NormalParagraphStyle)$/;
  var NOCS = /^CharacterStyle\/\$ID\/\[No character style\]$/;
  function cleanName(n) { return String(n || "").replace(/^\$ID\//, "").replace(/^\[|\]$/g, "").slice(0, 60); }

  // ---------- 5. Convert ----------
  // files: { path: xml text }; opts: { now, name }. Result: { doc,
  // images: [{ item, name, bytes }], linked, stats: { pages, items,
  // skipped } } or null.
  function convert(files, opts) {
    opts = opts || {};
    var now = opts.now || 1;
    function xml(p) { return files[p] ? X.parseXml(files[p], true) : null; }
    var dm = xml("designmap.xml");
    var D = dm && find1(dm, "Document");
    if (!D) return null;
    var srcs = {};
    D.c.forEach(function (c) {
      var m = /^idPkg:(Spread|MasterSpread|Story|Graphic|Styles|Preferences)$/.exec(c.n);
      if (m && c.a.src) (srcs[m[1]] = srcs[m[1]] || []).push(c.a.src);
    });
    var spreadT = (srcs.Spread || []).map(xml).filter(Boolean).map(function (t) { return find1(t, "Spread"); }).filter(Boolean);
    var pageNodes = [];
    spreadT.forEach(function (sp) { kids(sp, "Page").forEach(function (pg) { pageNodes.push({ node: pg, spread: sp }); }); });
    if (!pageNodes.length) return null;
    var prefs = (srcs.Preferences || []).map(xml).filter(Boolean)[0] || D;
    var dp = find1(prefs, "DocumentPreference") || find1(D, "DocumentPreference") || { a: {}, c: [] };
    var mp = find1(prefs, "MarginPreference") || find1(D, "MarginPreference") || { a: {}, c: [] };
    var vp = find1(prefs, "ViewPreference") || find1(D, "ViewPreference") || { a: {}, c: [] };
    var u = vp.a.HorizontalMeasurementUnits || "";
    var unit = /millimet|centimet/i.test(u) ? "mm" : /inch/i.test(u) ? "in" : "pt";
    var b0 = bounds(pageNodes[0].node.a.GeometricBounds);
    var pw = num(dp.a.PageWidth, b0 ? b0.r - b0.l : 595.276), ph = num(dp.a.PageHeight, b0 ? b0.b - b0.t : 841.89);
    var bleed = Math.max(num(dp.a.DocumentBleedTopOffset, 0), num(dp.a.DocumentBleedBottomOffset, 0), num(dp.a.DocumentBleedInsideOrLeftOffset, 0), num(dp.a.DocumentBleedOutsideOrRightOffset, 0));
    var facing = dp.a.FacingPages === "true" ? 1 : 0;
    var doc = M.newDoc({
      name: opts.name || "InDesign", w: pw, h: ph, unit: unit, bleed: bleed,
      mt: num(mp.a.Top, 36), mb: num(mp.a.Bottom, 36), mi: num(mp.a.Left, 36), mo: num(mp.a.Right, 36),
      cols: num(mp.a.ColumnCount, 1), gut: num(mp.a.ColumnGutter, 12), facing: facing, preset: "custom", pages: pageNodes.length
    }, now);
    var stats = { pages: pageNodes.length, items: 0, skipped: 0 }, used = {};
    ["sw-black", "sw-paper"].forEach(function (k) { used[k] = 1; });
    doc.swatches.forEach(function (s) { used[s.id] = 1; });
    doc.pstyles.forEach(function (s) { used[s.id] = 1; });
    doc.cstyles.forEach(function (s) { used[s.id] = 1; });
    var G = { n: "#root", a: {}, c: (srcs.Graphic || []).map(xml).filter(Boolean) };
    var colour = colours(G, doc, now, used);

    // styles ("based on" kept); Basic Paragraph = ps-base
    var S = { n: "#root", a: {}, c: (srcs.Styles || []).map(xml).filter(Boolean) };
    var psId = {}, csId = {}, psRaw = {};
    findAll(S, "ParagraphStyle").forEach(function (n) {
      var ref = n.a.Self;
      if (!ref || psId[ref]) return;
      psRaw[ref] = n;
      psId[ref] = BASIC.test(ref) ? "ps-base" : X.slug(cleanName(n.a.Name || ref), "ps", used);
    });
    Object.keys(psId).forEach(function (ref) {
      var n = psRaw[ref], o = pick(textProps(n, colour), PS_KEYS), id = psId[ref];
      if (id === "ps-base") {
        var base = M.find(doc.pstyles, "ps-base");
        Object.keys(o).forEach(function (k) { base[k] = o[k]; });
        return;
      }
      var bo = prop(n, "BasedOn");
      o.id = id; o.m = now; o.name = cleanName(n.a.Name || ref); o.base = bo && psId[bo] ? psId[bo] : "ps-base";
      doc.pstyles.push(o);
    });
    var csRaw = {};
    findAll(S, "CharacterStyle").forEach(function (n) {
      var ref = n.a.Self;
      if (!ref || NOCS.test(ref) || csId[ref]) return;
      csRaw[ref] = n;
      csId[ref] = X.slug(cleanName(n.a.Name || ref), "cs", used);
    });
    Object.keys(csId).forEach(function (ref) {
      var n = csRaw[ref], o = pick(textProps(n, colour), CS_KEYS), bo = prop(n, "BasedOn");
      o.id = csId[ref]; o.m = now; o.name = cleanName(n.a.Name || ref);
      if (bo && csId[bo]) o.base = csId[bo];
      doc.cstyles.push(o);
    });
    // resolved paragraph style (for telling real overrides apart)
    function resolvedPs(id) {
      var chain = [], seen = {};
      for (var s = M.find(doc.pstyles, id); s && !seen[s.id]; s = s.base ? M.find(doc.pstyles, s.base) : null) { seen[s.id] = 1; chain.unshift(s); }
      var out = {};
      chain.forEach(function (s) { PS_KEYS.forEach(function (k) { if (s[k] !== undefined) out[k] = s[k]; }); });
      return out;
    }
    var derived = {};
    function paraStyle(psr) {
      var parent = psId[psr.a.AppliedParagraphStyle] || "ps-base";
      var loc = pick(textProps(psr, colour), ["align", "sb", "sa", "fi", "li", "ri", "lead", "bul"]), res = resolvedPs(parent);
      Object.keys(loc).forEach(function (k) { if (res[k] === loc[k] || (res[k] === undefined && !loc[k])) delete loc[k]; });
      if (!Object.keys(loc).length) return parent;
      var key = parent + JSON.stringify(loc);
      if (derived[key]) return derived[key];
      var id = X.slug(parent.slice(3) + "loc", "ps", used), ps = M.find(doc.pstyles, parent);
      loc.id = id; loc.m = now; loc.base = parent;
      loc.name = (ps && typeof ps.name === "string" ? ps.name : "Basic").slice(0, 48) + " \u00b7 " + Object.keys(derived).length;
      doc.pstyles.push(loc);
      derived[key] = id;
      return id;
    }
    var csBy = {};
    function charStyle(o, base) {
      var key = (base || "") + JSON.stringify(o);
      if (csBy[key]) return csBy[key];
      if (Object.keys(csBy).length >= 200) return base || "";
      var n = Object.keys(csBy).length + 1, id = X.slug("idml" + n, "cs", used), s = { id: id, m: now, name: "InDesign " + n };
      if (base) s.base = base;
      Object.keys(o).forEach(function (k) { s[k] = o[k]; });
      doc.cstyles.push(s);
      csBy[key] = id;
      return id;
    }

    // ---------- stories ----------
    var storyT = {};
    (srcs.Story || []).forEach(function (src) {
      var t = xml(src), st = t && find1(t, "Story");
      if (st && st.a.Self) storyT[st.a.Self] = st;
    });
    function storyOf(st) {
      var paras = [], runs = [], psr = null;
      function endPara() {
        var ps = psr ? paraStyle(psr) : "ps-base";
        paras.push({ ps: ps, runs: runs });
        runs = [];
      }
      function addText(t, csr) {
        t = String(t).replace(/\u2028/g, "\n").replace(/[\t\u0009]/g, " ").replace(/[\u0000-\u0008\u000b-\u001f\u007f\u2029\ufeff]/g, "");
        if (!t) return;
        runs.push(runOf({ t: t }, csr));
      }
      function runOf(r, csr) {
        if (!csr) return r;
        var res = resolvedPs(psr ? psId[psr.a.AppliedParagraphStyle] || "ps-base" : "ps-base");
        var o = pick(textProps(csr, colour), CS_KEYS), cs = csId[csr.a.AppliedCharacterStyle] || "", over = {};
        if (o.b !== undefined && o.b !== (res.b || 0)) r.b = o.b;
        if (o.i !== undefined && o.i !== (res.i || 0)) r.i = o.i;
        if (o.u !== undefined && o.u !== (res.u || 0)) r.u = o.u;
        ["font", "size", "color", "caps", "track"].forEach(function (k) {
          if (o[k] !== undefined && o[k] !== res[k] && !(res[k] === undefined && !o[k])) over[k] = o[k];
        });
        if (Object.keys(over).length) cs = charStyle(over, cs);
        if (cs) r.cs = cs;
        if (!r.b) delete r.b;
        if (!r.i) delete r.i;
        if (!r.u) delete r.u;
        return r;
      }
      function walk(node, csr) {
        node.c.forEach(function (x) {
          if (x.n === "ParagraphStyleRange") { var keep = psr; psr = x; walk(x, csr); psr = keep; }
          else if (x.n === "CharacterStyleRange") walk(x, x);
          else if (x.n === "Content") {
            x.c.forEach(function (y) {
              if (y.n === "#text") addText(y.t, csr);
              else if (y.n === "#ace" && y.t === "18") runs.push(runOf({ f: "pn" }, csr));
              else if (y.n === "#ace" && y.t === "8") addText(" ", csr);
            });
          }
          else if (x.n === "Br") endPara();
          else if (x.n === "TextVariableInstance") {
            if (/last ?page ?number/i.test(x.a.AssociatedTextVariable || "") || /last ?page ?number/i.test(x.a.Name || "")) runs.push(runOf({ f: "pc" }, csr));
            else if (x.a.ResultText) addText(x.a.ResultText, csr);
          }
          else if (x.n === "Table" || x.n === "Footnote" || x.n === "Note") stats.skipped++;
          else if (x.n === "Properties" || x.n === "StoryPreference" || x.n === "InCopyExportOption") return;
          else if (x.c && x.c.length) walk(x, csr);     // XML tags, hyperlinks, tracked changes
        });
      }
      walk(st, null);
      if (runs.length || !paras.length) endPara();
      // a final empty paragraph left by a trailing break
      if (paras.length > 1 && !paras[paras.length - 1].runs.length) paras.pop();
      return { id: M.newId("st"), m: now, h: [], paras: paras };
    }

    // ---------- masters ----------
    doc.masters = [];
    var masterBy = {}, masterPages = [], letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
    (srcs.MasterSpread || []).map(xml).filter(Boolean).forEach(function (t, k) {
      var ms = find1(t, "MasterSpread");
      if (!ms || !ms.a.Self || masterBy[ms.a.Self]) return;
      var nm = ms.a.Name || ((ms.a.NamePrefix || letters[k % 26]) + "-" + (ms.a.BaseName || "Master"));
      var id = X.slug(nm, "ms", used);
      masterBy[ms.a.Self] = id;
      doc.masters.push({ id: id, m: now, name: String(nm).slice(0, 60), pre: String(ms.a.NamePrefix || letters[k % 26]).slice(0, 3) });
      var pgs = kids(ms, "Page");
      masterPages.push({ spread: ms, pages: pgs.map(function (pg, i) { return { node: pg, id: id, side: facing && pgs.length > 1 ? (i === 0 ? "L" : "R") : "" }; }) });
    });
    var order = M.pagesInOrder(doc);
    pageNodes.forEach(function (pn, k) {
      var am = pn.node.a.AppliedMaster;
      order[k].ms = am && masterBy[am] ? masterBy[am] : "";
      pn.id = order[k].id; pn.side = "";
    });

    // ---------- objects ----------
    // a page's inner box in spread coordinates
    function pageGeo(pg) {
      var m = mat(pg.node.a.ItemTransform), bx = bounds(pg.node.a.GeometricBounds) || { t: 0, l: 0, b: ph, r: pw };
      var c = apply(m, (bx.l + bx.r) / 2, (bx.t + bx.b) / 2);
      return { pg: pg, m: m, im: inv(m), bx: bx, cx: c[0], cy: c[1] };
    }
    // the page under a spread point (else the nearest one)
    function pageAt(geos, x, y) {
      var best = null, bd = Infinity;
      geos.forEach(function (g) {
        var l = apply(g.im, x, y), bx = g.bx;
        if (l[0] >= bx.l && l[0] <= bx.r && l[1] >= bx.t && l[1] <= bx.b) { if (bd > 0) { best = g; bd = 0; } return; }
        var d = Math.hypot(x - g.cx, y - g.cy);
        if (d < bd) { bd = d; best = g; }
      });
      return best;
    }
    function local(g, x, y) { var l = apply(g.im, x, y); return [l[0] - g.bx.l, l[1] - g.bx.t]; }

    var images = [], linked = 0, frames = [], z = 0, items = [];
    function common(node, it) {
      var a = node.a;
      var f = colour(a.FillColor, a.FillTint), s = colour(a.StrokeColor, a.StrokeTint);
      it.fill = f || "";
      it.sw = num(a.StrokeWeight, s ? 1 : 0);
      it.stroke = s && it.sw > 0 ? s : "";
      if (/dash|dotted/i.test(a.StrokeType || "")) it.dash = 1;
      var bs = find1(node, "BlendingSetting");
      if (bs && bs.a.Opacity !== undefined) it.op = Math.round(Math.max(0, Math.min(100, num(bs.a.Opacity, 100))));
      if (a.Locked === "true") it.lock = 1;
      if (a.Visible === "false") it.hide = 1;
      var tw = kids(node, "TextWrapPreference")[0];
      if (tw && tw.a.TextWrapMode && tw.a.TextWrapMode !== "None") {
        it.wrap = node.n === "Oval" ? "ell" : "box";
        var off = find1(tw, "TextWrapOffset");
        if (off) it.wo = Math.max(num(off.a.Top, 0), num(off.a.Left, 0), num(off.a.Bottom, 0), num(off.a.Right, 0));
      }
      if (a.CornerOption && /Rounded/.test(a.CornerOption)) it.r = num(a.CornerRadius, 0);
      else if (a.TopLeftCornerOption && /Rounded/.test(a.TopLeftCornerOption)) it.r = num(a.TopLeftCornerRadius, 0);
    }
    function addItem(node, pm, geos, grp) {
      var kind = node.n;
      var m = mul(mat(node.a.ItemTransform), pm);
      if (kind === "Group") {
        var g = M.newId("gr");
        node.c.forEach(function (c) { addItem(c, m, geos, g); });
        return;
      }
      if (["TextFrame", "Rectangle", "Oval", "GraphicLine", "Polygon"].indexOf(kind) < 0) {
        if (["Button", "TextPath", "MultiStateObject", "EPSText", "FormField", "CheckBox", "RadioButton", "TextBox", "ListBox", "ComboBox", "SignatureField"].indexOf(kind) >= 0) stats.skipped++;
        return;
      }
      var pts = anchors(node);
      if (!pts.length) { stats.skipped++; return; }
      var it = { id: M.newId("it"), m: now, z: (++z) * 16 };
      if (grp) it.grp = grp;
      common(node, it);
      var sp, g0;
      if (kind === "GraphicLine") {
        var p0 = apply(m, pts[0][0], pts[0][1]), p1 = apply(m, pts[pts.length - 1][0], pts[pts.length - 1][1]);
        g0 = pageAt(geos, (p0[0] + p1[0]) / 2, (p0[1] + p1[1]) / 2);
        if (!g0) { stats.skipped++; return; }
        var l0 = local(g0, p0[0], p0[1]), l1 = local(g0, p1[0], p1[1]);
        it.t = "line"; it.x = l0[0]; it.y = l0[1]; it.w = l1[0] - l0[0]; it.h = l1[1] - l0[1]; it.rot = 0;
        it.stroke = it.stroke || "sw-black"; it.fill = "";
        if (!(it.sw > 0)) it.sw = 1;
      } else {
        var x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
        pts.forEach(function (p) { x0 = Math.min(x0, p[0]); y0 = Math.min(y0, p[1]); x1 = Math.max(x1, p[0]); y1 = Math.max(y1, p[1]); });
        sp = apply(m, (x0 + x1) / 2, (y0 + y1) / 2);
        g0 = pageAt(geos, sp[0], sp[1]);
        if (!g0) { stats.skipped++; return; }
        // the item's matrix relative to its page
        var rm = mul(m, g0.im);
        var w = Math.max(0.5, (x1 - x0) * Math.hypot(rm[0], rm[1])), h = Math.max(0.5, (y1 - y0) * Math.hypot(rm[2], rm[3]));
        var c = local(g0, sp[0], sp[1]);
        it.x = c[0] - w / 2; it.y = c[1] - h / 2; it.w = w; it.h = h;
        var rot = Math.atan2(rm[1], rm[0]) * 180 / Math.PI;
        it.rot = Math.round(rot * 1000) / 1000;
        if (kind === "TextFrame") {
          it.t = "text";
          var tf = kids(node, "TextFramePreference")[0] || { a: {}, c: [] };
          it.cols = Math.max(1, Math.min(20, Math.round(num(tf.a.TextColumnCount, 1))));
          it.gut = num(tf.a.TextColumnGutter, 12);
          // one number, or a list of four under <Properties>
          var il = find1(tf, "InsetSpacing");
          var ins = tf.a.InsetSpacing !== undefined ? tf.a.InsetSpacing : il ? findAll(il, "ListItem").map(textOf).join(" ") || textOf(il) : "";
          var iv = String(ins).trim().split(/\s+/).map(Number).filter(isFinite);
          if (iv.length) it.ins = Math.max.apply(null, iv);
          var vj = tf.a.VerticalJustification;
          it.va = vj === "CenterAlign" ? "c" : vj === "BottomAlign" ? "b" : "t";
          frames.push({ it: it, node: node });
        } else if (kind === "Rectangle" && (kids(node, "Image").length || kids(node, "PDF").length || kids(node, "EPS").length || kids(node, "ImportedPage").length)) {
          it.t = "img";
          it.fit = "fill";
          var gr = kids(node, "Image")[0] || kids(node, "PDF")[0] || kids(node, "EPS")[0] || kids(node, "ImportedPage")[0];
          var ln = find1(gr, "Link"), uri = ln ? String(ln.a.LinkResourceURI || "") : "";
          var nm = uri.split(/[\\\/]/).pop();
          try { nm = decodeURIComponent(nm); } catch (e) { void e; }
          it.nm = nm.slice(0, 120);
          var cont = find1(gr, "Contents"), b64 = textOf(cont).replace(/\s+/g, "");
          if (gr.n === "Image" && b64) images.push({ item: it.id, name: it.nm || "image", b64: b64 });
          else linked++;
        } else {
          it.t = kind === "Oval" ? "ell" : "rect";
          if (kind === "Polygon") stats.skipped++;     // drawn as its box
        }
      }
      it.pg = g0.pg.id;
      if (g0.pg.side) it.side = g0.pg.side;
      items.push(it);
      stats.items++;
    }
    var OBJ = /^(TextFrame|Rectangle|Oval|GraphicLine|Polygon|Group|Button|TextPath|MultiStateObject|EPSText|FormField|CheckBox|RadioButton|TextBox|ListBox|ComboBox|SignatureField)$/;
    function spreadItems(sp, pages) {
      // pages and items are both placed in the spread's own space
      var geos = pages.map(pageGeo);
      sp.c.forEach(function (c) { if (OBJ.test(c.n)) addItem(c, [1, 0, 0, 1, 0, 0], geos, ""); });
    }
    masterPages.forEach(function (ms) { spreadItems(ms.spread, ms.pages); });
    spreadT.forEach(function (sp) {
      spreadItems(sp, pageNodes.filter(function (pn) { return pn.spread === sp; }));
    });

    // ---------- threads ----------
    var bySelf = {};
    frames.forEach(function (f) { bySelf[f.node.a.Self] = f; });
    var made = {};
    function thread(f) {
      var sid = f.node.a.ParentStory, raw = storyT[sid];
      if (!raw) return;
      var st = storyOf(raw), seq = 1024, cur = f, guard = 0;
      doc.stories.push(st);
      while (cur && !cur.it.story && guard++ < 5000) {
        cur.it.story = st.id; cur.it.seq = seq; seq += 1024;
        var nx = cur.node.a.NextTextFrame;
        cur = nx && nx !== "n" ? bySelf[nx] : null;
        if (cur && cur.node.a.ParentStory !== sid) cur = null;
      }
      made[sid] = st.id;
    }
    frames.forEach(function (f) { var pv = f.node.a.PreviousTextFrame; if (!pv || pv === "n" || !bySelf[pv]) thread(f); });
    // a frame whose head was not found starts its own story copy only
    // when the story was never placed
    frames.forEach(function (f) {
      if (f.it.story) return;
      var sid = f.node.a.ParentStory;
      if (!made[sid]) thread(f);
    });
    items.forEach(function (it) { if (it.t !== "text" || it.story) doc.items.push(it); else stats.items--; });
    if (doc.items.length > M.MAX_ITEMS) doc.items.length = M.MAX_ITEMS;
    if (!doc.masters.length) doc.masters.push({ id: "ms-a", m: now, name: { en: "A-Master", el: "A-Master" }, pre: "A" });
    var out = M.normDoc(doc);
    return { doc: out, images: images, linked: linked, stats: stats };
  }

  // The whole file → Promise of the convert() result (or null).
  function open(buf, opts) {
    return unzip(buf).then(function (files) { return convert(files, opts); }, function () { return null; });
  }
  // embedded image bytes + type (JPEG / PNG / GIF by their signature)
  function imageBlob(im) {
    var bin;
    try { bin = atob(im.b64); } catch (e) { return null; }
    var u = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
    var type = u[0] === 0x89 && u[1] === 0x50 ? "image/png" : u[0] === 0xff && u[1] === 0xd8 ? "image/jpeg" : u[0] === 0x47 && u[1] === 0x49 ? "image/gif" : "";
    return type ? new Blob([u], { type: type }) : null;
  }

  var api = { unzip: unzip, convert: convert, open: open, imageBlob: imageBlob };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.LY_IDML = api;
})(typeof window !== "undefined" ? window : this);
