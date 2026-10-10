// ============================================================
// orOS designkit — text.js (v1.0.0)
// Fonts + typesetting shared by Layout and Atelier.
//   - fonts: the Noto TTF subsets in vendor/noto/ (Latin + Greek).
//     ONE fetch per font feeds three consumers: the metrics parser
//     below, a FontFace for canvas drawing, and jsPDF (base64).
//   - metrics come from the font's own tables (cmap + hmtx), never
//     from canvas.measureText, so a line breaks at the same place on
//     screen, in a PDF and in Node tests. The subsets carry no
//     kerning or ligature features and canvas draws with
//     fontKerning "none", so the drawn advances match.
//   - extra families (registerFamily): fonts fetched from URLs on
//     demand (Atelier: Fontsource). A variant may come as several
//     subset files (Latin, Greek…): metrics look a character up in
//     each in order, canvas gets one FontFace per subset with its
//     unicode-range. A character none of them has is measured and
//     drawn with the family's fallback (sans), so screen and layout
//     agree before, while and after the font arrives. A missing
//     bold / italic uses the regular face. PDF output (pdf.js) only
//     embeds the first subset of such a font; Layout does not offer
//     them.
//   - layoutChain(): paragraphs + styles → lines in a chain of
//     threaded frames (columns, insets, text wrap exclusions,
//     alignment incl. justify, first-line / left / right indents,
//     space before / after, bullets, tracking, vertical alignment,
//     page-number fields), with an overset flag.
// Units: points (1/72 in) everywhere; y grows downwards; a line's
// y is its baseline.
// Exposes window.orosDK.text (browser) or module.exports (Node).
// ============================================================
(function (root) {
  "use strict";

  // ---------- 1. Font table ----------
  // family → variant → file. Mono has no italics: the upright face
  // stands in (the style still records the wish).
  var FAMILIES = {
    sans:  { name: "Noto Sans",  r: "NotoSans-Regular.ttf",  b: "NotoSans-Bold.ttf",  i: "NotoSans-Italic.ttf",  bi: "NotoSans-BoldItalic.ttf" },
    serif: { name: "Noto Serif", r: "NotoSerif-Regular.ttf", b: "NotoSerif-Bold.ttf", i: "NotoSerif-Italic.ttf", bi: "NotoSerif-BoldItalic.ttf" },
    mono:  { name: "Noto Sans Mono", r: "NotoSansMono-Regular.ttf", b: "NotoSansMono-Bold.ttf", i: "NotoSansMono-Regular.ttf", bi: "NotoSansMono-Bold.ttf" }
  };
  var FAMILY_IDS = ["sans", "serif", "mono"];

  function variant(b, i) { return b ? (i ? "bi" : "b") : (i ? "i" : "r"); }
  // "serif-bi" — also the canvas family name ("dk-serif-bi") and the
  // jsPDF font name.
  function fontKey(fam, b, i) {
    if (!FAMILIES[fam]) fam = "sans";
    return fam + "-" + variant(b, i);
  }
  function fontFile(key) {
    var p = key.split("-");
    var f = FAMILIES[p[0]];
    if (f && f.urls) return p[0] + "-" + p[1] + ".ttf";
    return f ? f[p[1]] : null;
  }
  function cssFamily(key) { return "dk-" + key; }
  // What to draw with: an extra family falls back to its fallback
  // family's face (same variant), as metrics do.
  function cssStack(key) {
    var p = key.split("-"), f = FAMILIES[p[0]];
    if (!f || !f.urls) return cssFamily(key);
    return '"' + cssFamily(key) + '", "' + cssFamily((f.fallback || "sans") + "-" + p[1]) + '"';
  }

  // id: [a-z0-9_]{1,64} (no "-": keys are "<family>-<variant>").
  // spec: { name, urls: { r: [url…], b, i, bi }, fallback }
  function registerFamily(id, spec) {
    if (!/^[a-z0-9_]{1,64}$/.test(id) || FAMILY_IDS.indexOf(id) >= 0) return false;
    if (FAMILIES[id] && FAMILIES[id].urls) return true;
    var urls = {};
    ["r", "b", "i", "bi"].forEach(function (v) {
      var u = spec && spec.urls && spec.urls[v];
      urls[v] = Array.isArray(u) ? u.filter(function (x) { return typeof x === "string"; }) : [];
    });
    if (!urls.r.length) return false;
    var fb = spec.fallback && FAMILY_IDS.indexOf(spec.fallback) >= 0 ? spec.fallback : "sans";
    FAMILIES[id] = { name: String(spec.name || id), urls: urls, fallback: fb };
    return true;
  }

  // ---------- 2. TTF metrics parser ----------
  // Reads just what layout needs: unitsPerEm, ascender / descender /
  // line gap, cap height, advance widths and the Unicode cmap
  // (formats 4 and 12). Throws on a malformed file.
  function parseTTF(buf) {
    var dv = new DataView(buf instanceof ArrayBuffer ? buf : buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
    var n = dv.getUint16(4), tables = {};
    for (var t = 0; t < n; t++) {
      var off = 12 + t * 16;
      var tag = String.fromCharCode(dv.getUint8(off), dv.getUint8(off + 1), dv.getUint8(off + 2), dv.getUint8(off + 3));
      tables[tag] = dv.getUint32(off + 8);
    }
    ["head", "hhea", "hmtx", "cmap", "maxp"].forEach(function (k) {
      if (tables[k] === undefined) throw new Error("ttf: missing " + k);
    });
    var upm = dv.getUint16(tables.head + 18);
    var hh = tables.hhea;
    var asc = dv.getInt16(hh + 4), desc = dv.getInt16(hh + 6), gap = dv.getInt16(hh + 8);
    var numH = dv.getUint16(hh + 34);
    var numGlyphs = dv.getUint16(tables.maxp + 4);
    var adv = new Uint16Array(numGlyphs);
    var last = 0;
    for (var g = 0; g < numGlyphs; g++) {
      if (g < numH) last = dv.getUint16(tables.hmtx + g * 4);
      adv[g] = last;
    }
    var cap = Math.round(asc * 0.7);
    if (tables["OS/2"] !== undefined) {
      var os = tables["OS/2"], ver = dv.getUint16(os);
      if (ver >= 2) cap = dv.getInt16(os + 88) || cap;
    }
    // cmap: prefer (3,10) format 12, then (3,1) / (0,x) format 4
    var cm = tables.cmap, nsub = dv.getUint16(cm + 2), pick = -1, pickFmt = 0;
    for (var s = 0; s < nsub; s++) {
      var pid = dv.getUint16(cm + 4 + s * 8), eid = dv.getUint16(cm + 6 + s * 8);
      var so = cm + dv.getUint32(cm + 8 + s * 8), fmt = dv.getUint16(so);
      if (fmt === 12 && (pid === 3 || pid === 0)) { pick = so; pickFmt = 12; break; }
      if (fmt === 4 && ((pid === 3 && eid === 1) || pid === 0) && pickFmt !== 12) { pick = so; pickFmt = 4; }
    }
    if (pick < 0) throw new Error("ttf: no unicode cmap");
    var map = {};
    if (pickFmt === 4) {
      var segX2 = dv.getUint16(pick + 6), segs = segX2 / 2;
      var endO = pick + 14, startO = endO + segX2 + 2, deltaO = startO + segX2, rangeO = deltaO + segX2;
      for (var i = 0; i < segs; i++) {
        var end = dv.getUint16(endO + i * 2), start = dv.getUint16(startO + i * 2);
        var delta = dv.getInt16(deltaO + i * 2), ro = dv.getUint16(rangeO + i * 2);
        if (start === 0xFFFF) continue;
        for (var c = start; c <= end; c++) {
          var gid;
          if (ro === 0) gid = (c + delta) & 0xFFFF;
          else {
            var ga = rangeO + i * 2 + ro + (c - start) * 2;
            gid = dv.getUint16(ga);
            if (gid) gid = (gid + delta) & 0xFFFF;
          }
          if (gid) map[c] = gid;
        }
      }
    } else {
      var ng = dv.getUint32(pick + 12);
      for (var k = 0; k < ng; k++) {
        var go = pick + 16 + k * 12;
        var sc = dv.getUint32(go), ec = dv.getUint32(go + 4), sg = dv.getUint32(go + 8);
        for (var cc = sc; cc <= ec && cc - sc < 65536; cc++) map[cc] = sg + (cc - sc);
      }
    }
    return { upm: upm, asc: asc, desc: -desc, gap: gap, cap: cap, adv: adv, map: map };
  }

  // ---------- 3. Font registry ----------
  var fonts = {};          // key → { m: metrics, buf: ArrayBuffer (first file), parts: [{ m, buf }] }
  var pending = {};        // key → Promise
  var baseUrl = "../vendor/noto/";
  var gen = 0;             // bumps whenever a face arrives (layout caches key on it)
  var fetcher = null;      // url → Promise<ArrayBuffer | null> (null: not there)

  function setBaseUrl(u) { baseUrl = u; }
  function setFetcher(fn) { fetcher = fn; }
  function isLoaded(key) { return !!fonts[key]; }
  function generation() { return gen; }

  // One file, or several subset files of the same face (first wins
  // for a character). The merged metrics keep the first file's units.
  function register(key, buf) {
    var bufs = Array.isArray(buf) ? buf : [buf];
    var parts = bufs.map(function (b) { return { m: parseTTF(b), buf: b }; });
    var m = parts[0].m;
    if (parts.length > 1) {
      var total = 0;
      parts.forEach(function (p) { total += p.m.adv.length; });
      var adv = new Uint16Array(total), map = {}, off = 0;
      parts.forEach(function (p) {
        var k = m.upm / p.m.upm;
        for (var g = 0; g < p.m.adv.length; g++) adv[off + g] = Math.round(p.m.adv[g] * k);
        Object.keys(p.m.map).forEach(function (cp) { if (map[cp] === undefined) map[cp] = off + p.m.map[cp]; });
        off += p.m.adv.length;
      });
      m = { upm: m.upm, asc: m.asc, desc: m.desc, gap: m.gap, cap: m.cap, adv: adv, map: map };
    }
    var f = FAMILIES[key.split("-")[0]];
    if (f && f.urls) m.fb = (f.fallback || "sans") + "-" + key.split("-")[1];
    fonts[key] = { m: m, buf: parts[0].buf, parts: parts };
    gen++;
    return fonts[key];
  }

  // CSS unicode-range of a parsed file (so the browser picks the
  // subset file that has the character, as metrics do).
  function unicodeRange(m) {
    var cps = Object.keys(m.map).map(Number).sort(function (a, b) { return a - b; });
    var out = [], i = 0;
    while (i < cps.length) {
      var a = cps[i], b = a;
      while (i + 1 < cps.length && cps[i + 1] === b + 1) { i++; b = cps[i]; }
      out.push("U+" + a.toString(16) + (b > a ? "-" + b.toString(16) : ""));
      i++;
    }
    return out.join(",");
  }

  function addFontFace(key, buf) {
    if (typeof FontFace === "undefined" || typeof document === "undefined" || !document.fonts) return Promise.resolve();
    var parts = fonts[key] && fonts[key].parts.length > 1 ? fonts[key].parts : [{ buf: buf }];
    return Promise.all(parts.map(function (p) {
      try {
        var desc = p.m ? { unicodeRange: unicodeRange(p.m) } : undefined;
        var ff = new FontFace(cssFamily(key), p.buf.slice(0), desc);
        return ff.load().then(function (f) { document.fonts.add(f); }, function () {});
      } catch (e) { return Promise.resolve(); }
    }));
  }

  function fetchBuf(url) {
    if (fetcher) return fetcher(url);
    return fetch(url, { credentials: "omit", referrerPolicy: "no-referrer" }).then(function (r) {
      if (r.status === 404) return null;
      if (!r.ok) throw new Error("font " + url + " " + r.status);
      return r.arrayBuffer();
    });
  }

  // An extra family's face: every subset file of the variant (or of
  // the regular one when the variant has none); files that are not
  // there are skipped, at least one must be.
  function loadExtra(key, f) {
    var v = key.split("-")[1];
    function get(list) {
      return Promise.all(list.map(fetchBuf)).then(function (bufs) {
        var good = [];
        bufs.forEach(function (b) {
          if (!b || !b.byteLength) return;
          try { parseTTF(b); good.push(b); } catch (e) { /* not a font */ }
        });
        return good;
      });
    }
    var list = f.urls[v] && f.urls[v].length ? f.urls[v] : f.urls.r;
    return get(list).then(function (good) {
      if (good.length || list === f.urls.r) return good;
      return get(f.urls.r);           // no such weight / style: the regular face
    }).then(function (good) {
      if (!good.length) throw new Error("font " + key + " not found");
      register(key, good);
      return addFontFace(key, good[0]);
    });
  }

  // Loads (once) every key in the list; resolves when all are
  // usable for metrics AND canvas drawing.
  function load(keys) {
    return Promise.all(keys.map(function (key) {
      if (fonts[key]) return Promise.resolve();
      if (pending[key]) return pending[key];
      var fam = FAMILIES[key.split("-")[0]];
      if (fam && fam.urls) {
        // an extra family that cannot be fetched (offline, gone) is not
        // an error: its fallback stands in, the next load() tries again
        pending[key] = loadExtra(key, fam).then(function () { delete pending[key]; }, function () { delete pending[key]; });
        return pending[key];
      }
      var file = fontFile(key);
      if (!file) return Promise.reject(new Error("unknown font " + key));
      pending[key] = fetch(baseUrl + file).then(function (r) {
        if (!r.ok) throw new Error("font " + file + " " + r.status);
        return r.arrayBuffer();
      }).then(function (buf) {
        register(key, buf);
        return addFontFace(key, buf);
      }).then(function () { delete pending[key]; }, function (e) { delete pending[key]; throw e; });
      return pending[key];
    }));
  }

  function allKeys() {
    var out = [];
    FAMILY_IDS.forEach(function (f) { ["r", "b", "i", "bi"].forEach(function (v) { out.push(f + "-" + v); }); });
    return out;
  }

  // The same buffer as base64, for jsPDF's virtual file system.
  function fontBase64(key) {
    var f = fonts[key];
    if (!f) return null;
    if (f.b64) return f.b64;
    var bytes = new Uint8Array(f.buf), s = "", CH = 0x8000;
    for (var i = 0; i < bytes.length; i += CH) s += String.fromCharCode.apply(null, bytes.subarray(i, i + CH));
    f.b64 = typeof btoa === "function" ? btoa(s) : Buffer.from(f.buf).toString("base64");
    return f.b64;
  }

  // Metrics of a key; an unloaded face borrows the regular one of
  // its family, then sans-r, so layout never crashes on a font that
  // is still on its way (the caller re-lays out when it lands).
  function metrics(key) {
    var p = key.split("-"), fam = FAMILIES[p[0]];
    var f = fonts[key] || fonts[p[0] + "-r"] ||
      (fam && fam.urls ? fonts[(fam.fallback || "sans") + "-" + p[1]] : null) || fonts["sans-r"];
    return f ? f.m : null;
  }

  // Width of a string in points. track = 1/1000 em added after
  // every character (InDesign's tracking unit).
  function measure(key, str, size, track) {
    var m = metrics(key);
    if (!m) return str.length * size * 0.5;
    var fb = m.fb ? metrics(m.fb) : null;
    var w = 0, n = 0;
    for (var i = 0; i < str.length; i++) {
      var cp = str.codePointAt(i);
      if (cp > 0xFFFF) i++;
      var gid = m.map[cp];
      if (gid === undefined && fb && fb !== m && fb.map[cp] !== undefined) w += (fb.adv[fb.map[cp]] || 0) / fb.upm;
      else w += (m.adv[gid || 0] || 0) / m.upm;
      n++;
    }
    return w * size + (track ? n * track * size / 1000 : 0);
  }

  function ascent(key, size) { var m = metrics(key); return m ? m.asc * size / m.upm : size * 0.8; }
  function descent(key, size) { var m = metrics(key); return m ? m.desc * size / m.upm : size * 0.2; }

  // ---------- 4. Styles ----------
  // Paragraph style fields (all optional except name; missing = the
  // base's value, then DEFAULT_PS).
  var DEFAULT_PS = {
    font: "serif", size: 11, lead: 0, align: "l", b: 0, i: 0, u: 0,
    sb: 0, sa: 0, fi: 0, li: 0, ri: 0, track: 0, color: "sw-black", bul: 0, caps: 0
  };
  var PS_KEYS = Object.keys(DEFAULT_PS);
  var CS_KEYS = ["font", "size", "b", "i", "u", "track", "color", "caps"];

  function byId(list) {
    var o = {};
    (list || []).forEach(function (x) { o[x.id] = x; });
    return o;
  }

  // Resolve a style id through its "based on" chain. Cycles end at
  // the first repeat.
  function resolvePs(psMap, id) {
    var chain = [], seen = {}, cur = psMap[id];
    while (cur && !seen[cur.id] && chain.length < 16) { seen[cur.id] = 1; chain.unshift(cur); cur = cur.base ? psMap[cur.base] : null; }
    var out = {};
    PS_KEYS.forEach(function (k) { out[k] = DEFAULT_PS[k]; });
    chain.forEach(function (s) { PS_KEYS.forEach(function (k) { if (s[k] !== undefined && s[k] !== null) out[k] = s[k]; }); });
    return out;
  }
  function resolveCs(csMap, id) {
    var chain = [], seen = {}, cur = csMap[id];
    while (cur && !seen[cur.id] && chain.length < 16) { seen[cur.id] = 1; chain.unshift(cur); cur = cur.base ? csMap[cur.base] : null; }
    var out = {};
    chain.forEach(function (s) { CS_KEYS.forEach(function (k) { if (s[k] !== undefined && s[k] !== null) out[k] = s[k]; }); });
    return out;
  }

  // Effective character attributes of a run inside a paragraph.
  // Local run flags b / i / u toggle on top of the styles (so "bold"
  // inside a bold heading stays bold, like a word processor).
  function runAttrs(ps, cs, run) {
    var a = {
      font: cs.font || ps.font, size: cs.size || ps.size,
      b: cs.b !== undefined ? cs.b : ps.b, i: cs.i !== undefined ? cs.i : ps.i,
      u: cs.u !== undefined ? cs.u : ps.u,
      track: cs.track !== undefined ? cs.track : ps.track,
      color: cs.color || ps.color, caps: cs.caps !== undefined ? cs.caps : ps.caps
    };
    if (run.b) a.b = 1;
    if (run.i) a.i = 1;
    if (run.u) a.u = 1;
    a.key = fontKey(a.font, a.b, a.i);
    return a;
  }

  // Line advance: explicit leading, or "auto" = 120% of the size.
  function leadOf(ps, size) { return ps.lead > 0 ? Math.max(ps.lead, 1) : size * 1.2; }

  // ---------- 5. Tokens ----------
  // A paragraph becomes a list of tokens:
  //   { k:"w", parts:[{t, a}] }  a word (several styled parts when a
  //                               style changes mid-word)
  //   { k:"s", a }               one space
  //   { k:"br" }                 forced line break (Shift+Enter)
  // Fields ({ f:"pn" } page number, { f:"pc" } page count) are
  // parts with t === null, resolved when placed.
  function caseOf(a, t) { return a.caps ? t.toLocaleUpperCase() : t; }

  function tokenize(para, ps, csMap) {
    var toks = [], word = null;
    function flush() { if (word) { toks.push(word); word = null; } }
    (para.runs || []).forEach(function (run) {
      var cs = run.cs ? resolveCs(csMap, run.cs) : {};
      var a = runAttrs(ps, cs, run);
      if (run.f) {
        if (!word) word = { k: "w", parts: [] };
        word.parts.push({ t: null, f: run.f, a: a });
        return;
      }
      var s = String(run.t || "");
      var buf = "";
      for (var i = 0; i < s.length; i++) {
        var ch = s[i];
        if (ch === "\n") {
          if (buf) { if (!word) word = { k: "w", parts: [] }; word.parts.push({ t: caseOf(a, buf), a: a }); buf = ""; }
          flush(); toks.push({ k: "br" });
        } else if (ch === " " || ch === "\t") {
          if (buf) { if (!word) word = { k: "w", parts: [] }; word.parts.push({ t: caseOf(a, buf), a: a }); buf = ""; }
          flush(); toks.push({ k: "s", a: a });
        } else buf += ch;
      }
      if (buf) { if (!word) word = { k: "w", parts: [] }; word.parts.push({ t: caseOf(a, buf), a: a }); }
    });
    flush();
    return toks;
  }

  function partText(p, ctx) {
    if (p.t !== null) return p.t;
    if (p.f === "pn") return String(ctx.pageLabel || "#");
    if (p.f === "pc") return String(ctx.pageCount || "#");
    return "";
  }
  function partWidth(p, ctx) { return measure(p.a.key, partText(p, ctx), p.a.size, p.a.track); }
  function wordWidth(w, ctx) {
    var s = 0;
    for (var i = 0; i < w.parts.length; i++) s += partWidth(w.parts[i], ctx);
    return s;
  }
  function tokMaxSize(tok, ps) {
    if (tok.k === "w") { var m = 0; tok.parts.forEach(function (p) { if (p.a.size > m) m = p.a.size; }); return m; }
    if (tok.k === "s") return tok.a.size;
    return ps.size;
  }

  // Split a word that is wider than any line into pieces that fit.
  function splitWord(w, maxW, ctx) {
    var pieces = [], cur = { k: "w", parts: [] }, curW = 0;
    w.parts.forEach(function (p) {
      var txt = partText(p, ctx), buf = "";
      for (var i = 0; i < txt.length; i++) {
        var ch = txt[i];
        var cw = measure(p.a.key, ch, p.a.size, p.a.track);
        if (curW + cw > maxW && (buf || cur.parts.length)) {
          if (buf) cur.parts.push({ t: buf, a: p.a });
          pieces.push(cur);
          cur = { k: "w", parts: [] }; curW = 0; buf = "";
        }
        buf += ch; curW += cw;
      }
      if (buf) cur.parts.push({ t: buf, a: p.a });
    });
    if (cur.parts.length) pieces.push(cur);
    return pieces;
  }

  // ---------- 6. Exclusions (text wrap) ----------
  // ex = { x, y, w, h, shape: "box"|"ell" } in frame coordinates,
  // offset already applied. Returns the blocked x-interval for the
  // band [y0, y1], or null.
  function blocked(ex, y0, y1) {
    if (y1 <= ex.y || y0 >= ex.y + ex.h) return null;
    if (ex.shape !== "ell") return [ex.x, ex.x + ex.w];
    var cy = ex.y + ex.h / 2, ry = ex.h / 2, rx = ex.w / 2;
    // widest point of the ellipse inside the band
    var yy = (y0 <= cy && y1 >= cy) ? 0 : Math.min(Math.abs(y0 - cy), Math.abs(y1 - cy));
    if (yy >= ry) return null;
    var half = rx * Math.sqrt(1 - (yy * yy) / (ry * ry));
    return [ex.x + rx - half, ex.x + rx + half];
  }

  // Free intervals of [x0, x1] for a band, widest-first is NOT used:
  // text fills them left to right (InDesign "wrap both sides").
  function freeSegments(x0, x1, excl, y0, y1, minW) {
    var segs = [[x0, x1]];
    (excl || []).forEach(function (ex) {
      var b = blocked(ex, y0, y1);
      if (!b) return;
      var next = [];
      segs.forEach(function (s) {
        if (b[1] <= s[0] || b[0] >= s[1]) { next.push(s); return; }
        if (b[0] > s[0]) next.push([s[0], b[0]]);
        if (b[1] < s[1]) next.push([b[1], s[1]]);
      });
      segs = next;
    });
    return segs.filter(function (s) { return s[1] - s[0] >= minW; });
  }

  // ---------- 7. Layout ----------
  // frames: ordered chain, each
  //   { id, w, h, cols, gut, inset, valign: "t"|"c"|"b", excl: [],
  //     ctx: { pageLabel, pageCount } }
  // story: { paras: [{ ps, runs: [...] }] }
  // styles: { ps: [..], cs: [..] }
  // Result:
  //   { frames: { id: { lines: [line] } }, overset: bool,
  //     placedParas: n }
  //   line = { col, y, h, runs: [{ x, y, t, key, size, color, u,
  //            track, w }] }
  function layoutChain(story, frames, styles) {
    var psMap = byId(styles.ps), csMap = byId(styles.cs);
    var out = { frames: {}, overset: false, placedParas: 0 };
    frames.forEach(function (f) { out.frames[f.id] = { lines: [] }; });
    if (!frames.length) { out.overset = hasText(story); return out; }

    var fi = 0, col = 0, y = 0, colTop = true;
    var geom = null;

    function colGeom() {
      var f = frames[fi];
      var cols = Math.max(1, Math.min(20, f.cols || 1));
      var ins = Math.max(0, f.inset || 0), gut = Math.max(0, f.gut || 0);
      var innerW = Math.max(1, f.w - 2 * ins);
      var cw = Math.max(1, (innerW - gut * (cols - 1)) / cols);
      return { f: f, cols: cols, x0: ins + col * (cw + gut), x1: ins + col * (cw + gut) + cw, top: ins, bottom: Math.max(ins, f.h - ins) };
    }
    function nextCol() {
      col++;
      if (col >= geom.cols) { col = 0; fi++; }
      if (fi >= frames.length) return false;
      geom = colGeom(); y = geom.top; colTop = true;
      return true;
    }
    geom = colGeom(); y = geom.top;

    var paras = story.paras || [];
    for (var pi = 0; pi < paras.length; pi++) {
      if (fi >= frames.length) { out.overset = true; break; }
      var para = paras[pi];
      var ps = resolvePs(psMap, para.ps);
      var toks = tokenize(para, ps, csMap);
      if (ps.bul) {
        var bA = runAttrs(ps, {}, {});
        toks.unshift({ k: "bul", a: bA });
      }
      var ok = layoutPara(toks, ps, pi === 0);
      if (!ok) { out.overset = true; break; }
      out.placedParas = pi + 1;
    }

    // vertical alignment per column
    frames.forEach(function (f) {
      if (!f.valign || f.valign === "t") return;
      var lines = out.frames[f.id].lines;
      var byCol = {};
      lines.forEach(function (ln) { (byCol[ln.col] = byCol[ln.col] || []).push(ln); });
      var ins = Math.max(0, f.inset || 0), bottom = Math.max(ins, f.h - ins);
      Object.keys(byCol).forEach(function (c) {
        var ls = byCol[c], last = ls[ls.length - 1];
        var used = (last.y + last.d) - ins, free = (bottom - ins) - used;
        if (free <= 0) return;
        var dy = f.valign === "c" ? free / 2 : free;
        ls.forEach(function (ln) { ln.y += dy; ln.runs.forEach(function (r) { r.y += dy; }); });
      });
    });
    return out;

    // --- one paragraph; false = ran out of frames ---
    function layoutPara(toks, ps, first) {
      var ti = 0, firstLine = true;
      if (!colTop) y += ps.sb;          // ignored at the top of a column
      var hangBul = null;
      if (toks.length && toks[0].k === "bul") {
        hangBul = toks.shift();
      }
      var li = ps.li, bulletW = 0;
      if (hangBul) {
        bulletW = measure(hangBul.a.key, "•", hangBul.a.size, 0);
        if (li < bulletW * 2) li = bulletW * 2.2;
      }
      var empty = toks.length === 0;
      while (ti < toks.length || empty) {
        // line metrics guess: paragraph size, refined by the line's
        // biggest size after a first fill
        var maxSize = ps.size;
        for (var pass = 0; pass < 2; pass++) {
          var lead = leadOf(ps, maxSize);
          var keyA = fontKey(ps.font, ps.b, ps.i);
          var asc = ascent(keyA, maxSize), desc = descent(keyA, maxSize);
          var placed = placeLine(ti, toks, ps, li, firstLine, asc, desc, lead, hangBul && firstLine ? hangBul : null, bulletW);
          if (placed === false) return false;
          if (placed.maxSize > maxSize + 0.001 && pass === 0) { maxSize = placed.maxSize; continue; }
          if (placed.next === ti && !empty) {
            // nothing fitted beside a wrap: nudge down, try again
            y = placed.y - lead + Math.max(1, lead / 4);
            colTop = false;
            break;
          }
          ti = placed.next;
          commit(placed);
          firstLine = false;
          break;
        }
        if (empty) break;
      }
      y += ps.sa;
      return true;
    }

    // Find room for one line starting at token ti; returns the line
    // (not yet committed) or false when no frame is left.
    function placeLine(ti, toks, ps, li, firstLine, asc, desc, lead, bul, bulletW) {
      var guard = 0;
      while (guard++ < 4000) {
        var base = colTop ? y + asc : y + lead;
        if (base + desc > geom.bottom + 0.01) {
          // a frame too short for even one line: still move on
          if (!nextCol()) return false;
          continue;
        }
        var fx0 = geom.x0 + li + (firstLine ? ps.fi : 0), fx1 = geom.x1 - ps.ri;
        if (fx1 - fx0 < 1) fx1 = fx0 + 1;
        var segs = freeSegments(fx0, fx1, geom.f.excl, base - asc, base + desc, Math.max(ps.size * 2, 6));
        if (!segs.length) {
          // blocked by a wrap: step the baseline down and retry
          y = base - lead + Math.max(1, lead / 4);
          colTop = false;
          continue;
        }
        return fill(ti, toks, ps, segs, base, asc, desc, lead, bul, bulletW, li, fx1 - fx0);
      }
      return false;
    }

    function fill(ti, toks, ps, segs, base, asc, desc, lead, bul, bulletW, li, fullW) {
      var ctx = geom.f.ctx || {};
      var line = { col: col, frame: geom.f.id, y: base, d: desc, h: lead, runs: [], maxSize: 0, next: ti, base: base };
      var broke = false;
      for (var si = 0; si < segs.length; si++) {
        var sx0 = segs[si][0], sx1 = segs[si][1], avail = sx1 - sx0;
        var items = [], w = 0, spaces = 0, pendingSp = [];
        while (ti < toks.length) {
          var tk = toks[ti];
          if (tk.k === "br") { ti++; broke = true; break; }
          if (tk.k === "s") {
            if (items.length) pendingSp.push(tk);
            ti++;
            continue;
          }
          var spW = 0;
          pendingSp.forEach(function (s) { spW += measure(s.a.key, " ", s.a.size, s.a.track); });
          var ww = wordWidth(tk, ctx);
          if (w + spW + ww > avail + 0.001) {
            if (!items.length) {
              // too wide for a segment narrowed by a wrap: try the
              // next segment / line; wider than the column: split
              if (ww <= fullW + 0.001 && avail < fullW - 0.001) break;
              var pieces = splitWord(tk, avail, ctx);
              if (pieces.length > 1) { toks.splice.apply(toks, [ti, 1].concat(pieces)); continue; }
              items.push({ tok: tk, w: ww, sp: [] }); w += ww; ti++;
            }
            break;
          }
          items.push({ tok: tk, w: ww, sp: pendingSp, spW: spW });
          spaces += pendingSp.length;
          w += spW + ww; pendingSp = [];
          ti++;
        }
        // alignment within the segment
        var align = ps.align, extra = avail - w, gapAdd = 0, x = sx0;
        // justify every segment except the paragraph's end and a
        // forced break
        var justifyHere = align === "j" && !broke && ti < toks.length;
        if (align === "c") x += extra / 2;
        else if (align === "r") x += extra;
        else if (justifyHere && spaces > 0 && extra > 0) gapAdd = extra / spaces;
        if (bul && si === 0) {
          line.runs.push({ x: Math.max(geom.x0, geom.x0 + li - bulletW * 2.2), y: base, t: "•", key: bul.a.key, size: bul.a.size, color: bul.a.color, u: 0, track: 0, w: bulletW });
          line.maxSize = Math.max(line.maxSize, bul.a.size);
        }
        items.forEach(function (it, k) {
          if (k > 0) x += (it.spW || 0) + gapAdd * it.sp.length;
          it.tok.parts.forEach(function (p) {
            var txt = partText(p, ctx), pw = partWidth(p, ctx);
            line.runs.push({ x: x, y: base, t: txt, key: p.a.key, size: p.a.size, color: p.a.color, u: p.a.u ? 1 : 0, track: p.a.track || 0, w: pw });
            if (p.a.size > line.maxSize) line.maxSize = p.a.size;
            x += pw;
          });
        });
        if (broke || ti >= toks.length) break;
      }
      if (!line.maxSize) line.maxSize = ps.size;
      line.next = ti;
      return line;
    }

    function commit(line) {
      delete line.maxSize; delete line.next; delete line.base;
      out.frames[geom.f.id].lines.push(line);
      y = line.y; colTop = false;
    }
  }

  function hasText(story) {
    return (story.paras || []).some(function (p) {
      return (p.runs || []).some(function (r) { return r.f || (r.t && String(r.t).length); });
    });
  }

  // Plain text of a story (search, previews, conflict checks).
  function plainText(story) {
    return (story.paras || []).map(function (p) {
      return (p.runs || []).map(function (r) { return r.f ? (r.f === "pn" ? "#" : "##") : String(r.t || ""); }).join("");
    }).join("\n");
  }

  var api = {
    FAMILIES: FAMILIES, FAMILY_IDS: FAMILY_IDS, DEFAULT_PS: DEFAULT_PS, PS_KEYS: PS_KEYS, CS_KEYS: CS_KEYS,
    fontKey: fontKey, fontFile: fontFile, cssFamily: cssFamily, cssStack: cssStack, allKeys: allKeys,
    registerFamily: registerFamily, setFetcher: setFetcher, generation: generation, unicodeRange: unicodeRange,
    parseTTF: parseTTF, register: register, load: load, isLoaded: isLoaded, setBaseUrl: setBaseUrl,
    fontBase64: fontBase64, metrics: metrics, measure: measure, ascent: ascent, descent: descent,
    resolvePs: resolvePs, resolveCs: resolveCs, runAttrs: runAttrs, byId: byId,
    layoutChain: layoutChain, freeSegments: freeSegments, plainText: plainText, hasText: hasText
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else { root.orosDK = root.orosDK || {}; root.orosDK.text = api; }
})(typeof window !== "undefined" ? window : this);
