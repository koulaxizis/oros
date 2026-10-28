// ============================================================
// orOS designkit — text.js (v1.0.0)
// Fonts + typesetting shared by Layout and Atelier.
//   - fonts: the Noto TTF subsets in vendor/noto/ (Latin + Greek).
//     ONE fetch per font feeds three consumers: the metrics parser
//     below, a FontFace for canvas drawing, and jsPDF (base64).
//   - metrics come from the font's own tables (cmap + hmtx), never
//     from canvas.measureText, so a line breaks at the same place on
//     screen, in a PDF and in Node tests. Canvas draws with
//     fontKerning "none"; pair kerning (LY-KERN: GPOS "kern" pairs or
//     the old kern table; the Noto subsets have none) is read here and
//     applied by the style's ext.kern, in layout, on screen and in the
//     PDF alike. No ligatures.
//   - extra families (registerFamily): fonts fetched from URLs on
//     demand (Atelier: Fontsource). A variant may come as several
//     subset files (Latin, Greek…): metrics look a character up in
//     each in order, canvas gets one FontFace per subset with its
//     unicode-range. A character none of them has is measured and
//     drawn with the family's fallback (sans), so screen and layout
//     agree before, while and after the font arrives. A missing
//     bold / italic uses the regular face. A style names one in
//     ext.fam ("fs_…" Fontsource, "uf_…" a font file of the user's;
//     designkit/fonts.js registers them), its `font` stays the
//     built-in stand-in. pdf.js embeds every subset file and writes
//     each character in the file that has it.
//   - layoutChain(): paragraphs + styles → lines in a chain of
//     threaded frames (columns, insets, text wrap exclusions,
//     alignment incl. justify, first-line / left / right indents,
//     space before / after, bullets, tracking, vertical alignment,
//     page-number fields), with an overset flag; book typesetting
//     from the paragraph style's ext (LY-BK): Greek hyphenation
//     (hyph), lines kept together at a column break (orph at the
//     start, wid at the end), keep with next (kwn) and a paragraph
//     that starts a new column, page or odd page (brk).
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
  // ids of extra families a document may name (designkit/fonts.js)
  var FAM_RE = /^(fs|uf)_[a-z0-9]+(_[a-z0-9]+)*$/;

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
  // The built-in face an extra family's key stands in with (the key
  // itself for a built-in family).
  function fallbackKey(key) {
    var p = key.split("-"), f = FAMILIES[p[0]];
    return f && f.urls ? (f.fallback || "sans") + "-" + p[1] : key;
  }
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
    return { upm: upm, asc: asc, desc: -desc, gap: gap, cap: cap, adv: adv, map: map, kern: parseKern(dv, tables) };
  }

  // Pair kerning (LY-KERN): the GPOS "kern" feature's pair adjustments
  // (lookup type 2, also inside type 9 extensions; formats 1 and 2,
  // the first value's x advance) for the left character's script, else
  // the old "kern" table (format 0). → function (left glyph, right
  // glyph, script) → font units, or null. Lookups are read on first use.
  // A damaged table means no kerning, never an error.
  function parseKern(dv, tables) {
    try { return gposKern(dv, tables.GPOS) || kernTable(dv, tables.kern); } catch (e) { return null; }
  }
  function coverage(dv, o) {
    var fmt = dv.getUint16(o), n = dv.getUint16(o + 2), cov = {}, k, g;
    if (fmt === 1) for (k = 0; k < n; k++) cov[dv.getUint16(o + 4 + k * 2)] = k;
    else if (fmt === 2) {
      for (k = 0; k < n; k++) {
        var r = o + 4 + k * 6, st = dv.getUint16(r), en = dv.getUint16(r + 2), idx = dv.getUint16(r + 4);
        for (g = st; g <= en; g++) cov[g] = idx + g - st;
      }
    }
    return cov;
  }
  function classDef(dv, o) {
    var fmt = dv.getUint16(o), cls = {}, k, g;
    if (fmt === 1) {
      var st = dv.getUint16(o + 2), n = dv.getUint16(o + 4);
      for (k = 0; k < n; k++) cls[st + k] = dv.getUint16(o + 6 + k * 2);
    } else if (fmt === 2) {
      var nr = dv.getUint16(o + 2);
      for (k = 0; k < nr; k++) {
        var r = o + 4 + k * 6, a = dv.getUint16(r), b = dv.getUint16(r + 2), c = dv.getUint16(r + 4);
        for (g = a; g <= b; g++) cls[g] = c;
      }
    }
    return cls;
  }
  function bits(v) { var n = 0; while (v) { n += v & 1; v >>= 1; } return n; }
  // the x advance inside a value record of this format (0 when absent)
  function xAdv(dv, o, fmt) { return fmt & 4 ? dv.getInt16(o + 2 * bits(fmt & 3)) : 0; }
  function tag4(dv, o) { return String.fromCharCode(dv.getUint8(o), dv.getUint8(o + 1), dv.getUint8(o + 2), dv.getUint8(o + 3)); }
  function gposKern(dv, base) {
    if (base === undefined) return null;
    var sl = base + dv.getUint16(base + 4), fl = base + dv.getUint16(base + 6), ll = base + dv.getUint16(base + 8);
    // the kern feature's lookups, per script (the default language)
    var nf = dv.getUint16(fl), kernOf = {}, k, j;
    for (k = 0; k < nf; k++) {
      var fr = fl + 2 + k * 6;
      if (tag4(dv, fr) !== "kern") continue;
      var fo = fl + dv.getUint16(fr + 4), nl = dv.getUint16(fo + 2), list = [];
      for (j = 0; j < nl; j++) list.push(dv.getUint16(fo + 4 + j * 2));
      kernOf[k] = list;
    }
    var byScript = {}, all = {}, ns = dv.getUint16(sl);
    for (k = 0; k < ns; k++) {
      var sr = sl + 2 + k * 6, so0 = sl + dv.getUint16(sr + 4), dl = dv.getUint16(so0);
      if (!dl) continue;
      var ls = so0 + dl, nfi = dv.getUint16(ls + 4), want = {};
      for (j = 0; j < nfi; j++) (kernOf[dv.getUint16(ls + 6 + j * 2)] || []).forEach(function (li) { want[li] = all[li] = 1; });
      byScript[tag4(dv, sr)] = want;
    }
    Object.keys(kernOf).forEach(function (fi) { kernOf[fi].forEach(function (li) { all[li] = 1; }); });
    var cache = {};
    function lookup(li) {
      if (cache[li] !== undefined) return cache[li];
      var lo = ll + dv.getUint16(ll + 2 + li * 2), type = dv.getUint16(lo), nsub = dv.getUint16(lo + 4), subs = [];
      for (var s = 0; s < nsub; s++) {
        var so = lo + dv.getUint16(lo + 6 + s * 2), t = type;
        if (t === 9) { t = dv.getUint16(so + 2); so += dv.getUint32(so + 4); }
        if (t !== 2) continue;
        var fmt = dv.getUint16(so), cov = coverage(dv, so + dv.getUint16(so + 2));
        var f1 = dv.getUint16(so + 4), f2 = dv.getUint16(so + 6), rec = 2 * (bits(f1) + bits(f2));
        if (fmt === 1) {
          var pairs = {}, nset = dv.getUint16(so + 8);
          Object.keys(cov).forEach(function (g) {
            var i = cov[g];
            if (i >= nset) return;
            var ps = so + dv.getUint16(so + 10 + i * 2), np = dv.getUint16(ps), row = {};
            for (var q = 0; q < np; q++) {
              var pr = ps + 2 + q * (2 + rec);
              row[dv.getUint16(pr)] = xAdv(dv, pr + 2, f1);
            }
            pairs[g] = row;
          });
          subs.push({ cov: cov, pairs: pairs });
        } else if (fmt === 2) {
          var c1 = classDef(dv, so + dv.getUint16(so + 8)), c2 = classDef(dv, so + dv.getUint16(so + 10));
          var n1 = dv.getUint16(so + 12), n2 = dv.getUint16(so + 14), vals = new Int16Array(n1 * n2);
          for (var a = 0; a < n1; a++) for (var b = 0; b < n2; b++) vals[a * n2 + b] = xAdv(dv, so + 16 + (a * n2 + b) * rec, f1);
          subs.push({ cov: cov, c1: c1, c2: c2, n2: n2, vals: vals });
        }
      }
      return (cache[li] = subs);
    }
    var sets = {};
    function setFor(script) {
      if (sets[script]) return sets[script];
      var w = byScript[script] || byScript.DFLT || all;
      return (sets[script] = Object.keys(w).map(Number).sort(function (a, b) { return a - b; }).map(lookup));
    }
    if (!Object.keys(all).length) return null;
    // script: "latn", "grek", "cyrl"… (the left character's)
    return function (l, r, script) {
      var lookups = setFor(script || "latn"), v = 0;
      for (var i = 0; i < lookups.length; i++) {
        var subs = lookups[i];
        for (var s = 0; s < subs.length; s++) {
          var st = subs[s];
          if (st.cov[l] === undefined) continue;
          if (st.pairs) { var row = st.pairs[l]; if (!row || row[r] === undefined) continue; v += row[r]; break; }
          var a = st.c1[l] || 0, b = st.c2[r] || 0;
          if (a * st.n2 + b < st.vals.length) v += st.vals[a * st.n2 + b];
          break;
        }
      }
      return v;
    };
  }
  function kernTable(dv, o) {
    if (o === undefined || dv.getUint16(o) !== 0) return null;
    var n = dv.getUint16(o + 2), pairs = {}, any = false, so = o + 4;
    for (var t = 0; t < n; t++) {
      var len = dv.getUint16(so + 2), cov = dv.getUint16(so + 4);
      // format 0, horizontal, kerning values (not minimum, not cross-stream)
      if ((cov >> 8) === 0 && (cov & 7) === 1) {
        var np = dv.getUint16(so + 6);
        for (var k = 0; k < np; k++) {
          var pr = so + 14 + k * 6;
          pairs[dv.getUint16(pr) * 65536 + dv.getUint16(pr + 2)] = dv.getInt16(pr + 4);
          any = true;
        }
      }
      so += len;
    }
    return any ? function (l, r) { return pairs[l * 65536 + r] || 0; } : null;
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
      m = { upm: m.upm, asc: m.asc, desc: m.desc, gap: m.gap, cap: m.cap, adv: adv, map: map,
            kp: parts.map(function (p) { return p.m; }) };   // each file's own glyph ids, for kerning
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

  // The files of a loaded face (a Fontsource face can be several
  // subset files): [{ map: { codepoint: glyph }, b64(), bytes(),
  // range }]. A PDF embeds each file as its own font (Atelier's
  // vector PDF); a web page lists each as an @font-face with its
  // unicode-range ("" when the face is one file).
  function faceParts(key) {
    var f = fonts[key];
    if (!f) return [];
    var many = f.parts.length > 1;
    return f.parts.map(function (p) {
      return {
        map: p.m ? p.m.map : f.m.map,
        range: many && p.m ? unicodeRange(p.m) : "",
        bytes: function () { return new Uint8Array(p.buf.slice(0)); },
        b64: function () {
          if (p.b64) return p.b64;
          var bytes = new Uint8Array(p.buf), s = "", CH = 0x8000;
          for (var i = 0; i < bytes.length; i += CH) s += String.fromCharCode.apply(null, bytes.subarray(i, i + CH));
          p.b64 = typeof btoa === "function" ? btoa(s) : Buffer.from(p.buf).toString("base64");
          return p.b64;
        }
      };
    });
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
  // kern: add the font's pair kerning (LY-KERN) between neighbours.
  function measure(key, str, size, track, kern) {
    var m = metrics(key);
    if (!m) return str.length * size * 0.5;
    var fb = m.fb ? metrics(m.fb) : null;
    var w = 0, n = 0, prev = -1;
    for (var i = 0; i < str.length; i++) {
      var cp = str.codePointAt(i);
      if (cp > 0xFFFF) i++;
      var gid = m.map[cp];
      if (gid === undefined && fb && fb !== m && fb.map[cp] !== undefined) w += (fb.adv[fb.map[cp]] || 0) / fb.upm;
      else w += (m.adv[gid || 0] || 0) / m.upm;
      if (kern && prev >= 0) w += kernEm(m, prev, cp);
      prev = cp;
      n++;
    }
    return w * size + (track ? n * track * size / 1000 : 0);
  }
  // Pair kerning in em between two characters, when one file of the
  // face has both (a character drawn by the fallback is not kerned).
  function kernEm(m, a, b) {
    var ps = m.kp || [m];
    for (var i = 0; i < ps.length; i++) {
      var p = ps[i], ga = p.map[a];
      if (ga === undefined) continue;
      var gb = p.map[b];
      return gb !== undefined && p.kern ? p.kern(ga, gb, scriptOf(a)) / p.upm : 0;
    }
    return 0;
  }
  // The OpenType script of a character, for its kerning lookups.
  function scriptOf(cp) {
    if ((cp >= 0x370 && cp <= 0x3FF) || (cp >= 0x1F00 && cp <= 0x1FFF)) return "grek";
    if (cp >= 0x400 && cp <= 0x52F) return "cyrl";
    return "latn";
  }
  // The kerning in points between two characters (strings) of a face.
  function kernPair(key, a, b, size) {
    var m = metrics(key);
    return m ? kernEm(m, a.codePointAt(0), b.codePointAt(0)) * size : 0;
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
    out.fam = "";
    chain.forEach(function (s) {
      PS_KEYS.forEach(function (k) { if (s[k] !== undefined && s[k] !== null) out[k] = s[k]; });
      famOf(s, out);
      bookOf(s, out);
    });
    return out;
  }
  // Book typesetting (LY-BK), in the paragraph style's ext and
  // inherited like the rest: hyph 1 / 0 Greek hyphenation; orph, wid
  // (1-9) the fewest lines of a paragraph left at the foot of a
  // column and carried to the next; kwn 1 / 0 keep with the next
  // paragraph; brk "col" | "page" | "odd" | "even" where the paragraph
  // starts; sink (pt, 0-600) how far below the top of a column it
  // starts when it opens the column (a chapter's sunk opening; sb is
  // the space everywhere else).
  var BRK = { col: 1, page: 1, odd: 1, even: 1 };
  function bookOf(s, out) {
    var x = s.ext;
    if (!x) return;
    if (x.hyph !== undefined) out.hyph = x.hyph ? 1 : 0;
    if (x.kwn !== undefined) out.kwn = x.kwn ? 1 : 0;
    ["orph", "wid"].forEach(function (k) {
      var v = Math.floor(Number(x[k]));
      if (x[k] !== undefined) out[k] = isFinite(v) ? Math.max(1, Math.min(9, v)) : 1;
    });
    if (x.brk !== undefined) out.brk = BRK[x.brk] ? x.brk : "";
    if (x.sink !== undefined) { var k = Number(x.sink); out.sink = isFinite(k) ? Math.max(0, Math.min(600, k)) : 0; }
  }
  // A family of the document (ext.fam: "fs_…" Fontsource, "uf_…" a
  // font file of the user's) goes with the style's own `font`, which
  // stays the built-in stand-in: a style that sets only `font` clears
  // a family it inherited. ext.kern (1 / 0) turns the font's pair
  // kerning on or off for the style and the styles based on it.
  function famOf(s, out) {
    var f = s.ext && s.ext.fam;
    if (typeof f === "string" && FAM_RE.test(f)) out.fam = f;
    else if (s.font !== undefined && s.font !== null) out.fam = "";
    if (s.ext && s.ext.kern !== undefined) out.kern = s.ext.kern ? 1 : 0;
  }
  function resolveCs(csMap, id) {
    var chain = [], seen = {}, cur = csMap[id];
    while (cur && !seen[cur.id] && chain.length < 16) { seen[cur.id] = 1; chain.unshift(cur); cur = cur.base ? csMap[cur.base] : null; }
    var out = {};
    chain.forEach(function (s) {
      CS_KEYS.forEach(function (k) { if (s[k] !== undefined && s[k] !== null) out[k] = s[k]; });
      famOf(s, out);
    });
    return out;
  }

  // Effective character attributes of a run inside a paragraph.
  // Local run flags b / i / u toggle on top of the styles (so "bold"
  // inside a bold heading stays bold, like a word processor).
  function runAttrs(ps, cs, run) {
    var own = cs.font !== undefined || cs.fam !== undefined;
    var a = {
      font: own ? cs.font || ps.font : ps.font, fam: own ? cs.fam || "" : ps.fam || "", size: cs.size || ps.size,
      b: cs.b !== undefined ? cs.b : ps.b, i: cs.i !== undefined ? cs.i : ps.i,
      u: cs.u !== undefined ? cs.u : ps.u,
      track: cs.track !== undefined ? cs.track : ps.track,
      color: cs.color || ps.color, caps: cs.caps !== undefined ? cs.caps : ps.caps
    };
    if (run.b) a.b = 1;
    if (run.i) a.i = 1;
    if (run.u) a.u = 1;
    if (cs.kern !== undefined ? cs.kern : ps.kern) a.kern = 1;
    a.key = fontKey(a.fam && FAMILIES[a.fam] ? a.fam : a.font, a.b, a.i);
    return a;
  }

  // Line advance: explicit leading, or "auto" = 120% of the size.
  function leadOf(ps, size) { return ps.lead > 0 ? Math.max(ps.lead, 1) : size * 1.2; }

  // ---------- 5. Greek hyphenation ----------
  // The school rules: a consonant between vowels goes with the next
  // vowel; of two or more, the group goes on to the next syllable when
  // a Greek word can start with its first two letters, else the first
  // stays (άν-θρω-πος, α-στρά-φτω, Αγ-γλί-α is not split: vowels
  // stay together unless the second has a dialytika). Two letters at
  // least on each side. Words with anything but Greek letters are
  // left alone.
  // i18n-inline-ok: Greek letters (hyphenation data, no UI text)
  var GR_VOW = "αεηιουωάέήίόύώϊϋΐΰ", GR_DIA = "ϊϋΐΰ", GR_LET = /^[\u0386\u0388-\u03CE]+$/;
  // i18n-inline-ok: Greek consonant pairs a word can start with
  var GR_ONSET = " βγ βδ βλ βρ γδ γκ γλ γν γρ δρ θλ θν θρ κλ κν κρ κτ μν μπ ντ πλ πν πρ πτ σβ σγ σθ σκ σλ σμ σν σπ στ σφ σχ τζ τμ τρ τσ φθ φλ φρ φτ χθ χλ χν χρ χτ ";
  var HY_MIN = 2;
  // word → offsets where it may break (a "-" then shows)
  function hyphenGreek(word) {
    var w = word.toLowerCase(), out = [];
    if (w.length < 2 * HY_MIN || !GR_LET.test(word)) return out;
    var vow = function (k) { return GR_VOW.indexOf(w[k]) !== -1; };
    var k = 0;
    while (k < w.length && !vow(k)) k++;
    while (k < w.length) {
      // the end of this vowel group
      var e = k + 1;
      while (e < w.length && vow(e) && GR_DIA.indexOf(w[e]) === -1) e++;
      if (e >= w.length) break;
      if (vow(e)) { out.push(e); k = e; continue; }
      // consonants up to the next vowel
      var c = e;
      while (c < w.length && !vow(c)) c++;
      if (c >= w.length) break;
      var n = c - e, at;
      if (n === 1) at = e;
      else at = GR_ONSET.indexOf(" " + w.substr(e, 2) + " ") !== -1 ? e : e + 1;
      out.push(at);
      k = c;
    }
    return out.filter(function (o) { return o >= HY_MIN && w.length - o >= HY_MIN; });
  }
  // A word token's break points as tokens (one-part words; the "h"
  // tokens take no character: auto 1).
  var EDGE = /^([^\u0386\u0388-\u03CE]*)([\u0386\u0388-\u03CE]+)([^\u0386\u0388-\u03CE]*)$/;
  function hyphenate(toks) {
    var out = [];
    toks.forEach(function (tk) {
      var p = tk.k === "w" && tk.parts.length === 1 ? tk.parts[0] : null;
      var m = p && p.t !== null && p.t.length === p.n ? EDGE.exec(p.t) : null;
      var at = m ? hyphenGreek(m[2]).map(function (o) { return o + m[1].length; }) : [];
      if (!at.length) { out.push(tk); return; }
      var from = 0;
      at.concat([p.t.length]).forEach(function (o, k) {
        if (k) out.push({ k: "h", a: p.a, o: p.o + from, hy: 1, auto: 1 });
        out.push({ k: "w", parts: [{ t: p.t.slice(from, o), a: p.a, o: p.o + from, n: o - from }] });
        from = o;
      });
    });
    out.len = toks.len;
    return out;
  }

  // ---------- 6. Tokens ----------
  // A paragraph becomes a list of tokens:
  //   { k:"w", parts:[{t, a}] }  a word (several styled parts when a
  //                               style changes mid-word)
  //   { k:"s", a }               one space
  //   { k:"h", a, hy }           a break opportunity inside a word:
  //                               a soft hyphen (U+00AD, hy 1: a "-"
  //                               shows when the line breaks there) or
  //                               a zero-width space (U+200B, hy 0);
  //                               nothing shows otherwise
  //   { k:"br" }                 forced line break (Shift+Enter)
  // Fields ({ f:"pn" } page number, { f:"pc" } page count) are
  // parts with t === null, resolved when placed.
  // All caps; Greek capitals drop the tonos (Όνομα → ΟΝΟΜΑ) but keep
  // the dialytika (ϊ → Ϊ).
  // i18n-inline-ok: Greek capital letters without tonos (text layout data, no UI text)
  var TONOS = { "Ά": "Α", "Έ": "Ε", "Ή": "Η", "Ί": "Ι", "Ό": "Ο", "Ύ": "Υ", "Ώ": "Ω", "ΐ": "Ϊ", "ΰ": "Ϋ" };
  function caseOf(a, t) {
    if (!a.caps) return t;
    return t.replace(/[ΐΰ]/g, function (c) { return TONOS[c]; }).toUpperCase().replace(/[ΆΈΉΊΌΎΏ]/g, function (c) { return TONOS[c]; });
  }

  // Every part and space carries its offset `o` (and parts their
  // length `n`) in the paragraph's character space: text characters
  // count one each, a field counts one. The in-frame editor maps the
  // caret through them.
  function tokenize(para, ps, csMap) {
    var toks = [], word = null, base = 0;
    function flush() { if (word) { toks.push(word); word = null; } }
    function part(t, a, o, n) { if (!word) word = { k: "w", parts: [] }; word.parts.push({ t: caseOf(a, t), a: a, o: o, n: n }); }
    (para.runs || []).forEach(function (run) {
      var cs = run.cs ? resolveCs(csMap, run.cs) : {};
      var a = runAttrs(ps, cs, run);
      if (run.f) {
        if (!word) word = { k: "w", parts: [] };
        word.parts.push({ t: null, f: run.f, a: a, o: base, n: 1 });
        base += 1;
        return;
      }
      var s = String(run.t || "");
      var buf = "", b0 = 0;
      for (var i = 0; i < s.length; i++) {
        var ch = s[i];
        if (ch === "\n") {
          if (buf) { part(buf, a, base + b0, buf.length); buf = ""; }
          flush(); toks.push({ k: "br", o: base + i });
        } else if (ch === " " || ch === "\t") {
          if (buf) { part(buf, a, base + b0, buf.length); buf = ""; }
          flush(); toks.push({ k: "s", a: a, o: base + i });
        } else if (ch === "\u00AD" || ch === "\u200B") {
          if (buf) { part(buf, a, base + b0, buf.length); buf = ""; }
          flush(); toks.push({ k: "h", a: a, o: base + i, hy: ch === "\u00AD" ? 1 : 0 });
        } else { if (!buf) b0 = i; buf += ch; }
      }
      if (buf) part(buf, a, base + b0, buf.length);
      base += s.length;
    });
    flush();
    toks.len = base;
    return ps.hyph ? hyphenate(toks) : toks;
  }

  function partText(p, ctx) {
    if (p.t !== null) return p.t;
    if (p.f === "pn") return String(ctx.pageLabel || "#");
    if (p.f === "pc") return String(ctx.pageCount || "#");
    return "";
  }
  function partWidth(p, ctx) { return measure(p.a.key, partText(p, ctx), p.a.size, p.a.track, p.a.kern); }
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
      var txt = partText(p, ctx), buf = "", b0 = 0;
      function push() {
        var o = p.f ? p.o : p.o + Math.min(b0, p.n), n = p.f ? 1 : Math.max(0, Math.min(buf.length, p.n - Math.min(b0, p.n)));
        cur.parts.push({ t: buf, a: p.a, o: o, n: n });
      }
      for (var i = 0; i < txt.length; i++) {
        var ch = txt[i];
        var cw = measure(p.a.key, ch, p.a.size, p.a.track);
        if (curW + cw > maxW && (buf || cur.parts.length)) {
          if (buf) push();
          pieces.push(cur);
          cur = { k: "w", parts: [] }; curW = 0; buf = "";
        }
        if (!buf) b0 = i;
        buf += ch; curW += cw;
      }
      if (buf) push();
    });
    if (cur.parts.length) pieces.push(cur);
    return pieces;
  }

  // ---------- 7. Exclusions (text wrap) ----------
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

  // ---------- 8. Layout ----------
  // frames: ordered chain, each
  //   { id, w, h, cols, gut, inset, valign: "t"|"c"|"b", excl: [],
  //     ctx: { pageLabel, pageCount } }
  // story: { paras: [{ ps, runs: [...] }] }
  // styles: { ps: [..], cs: [..] }
  // Result:
  //   { frames: { id: { lines: [line] } }, overset: bool,
  //     placedParas: n }
  //   line = { col, y, h, d, p (paragraph), o0 / o1 (its offsets),
  //            x0 (where the text starts), cx0 / cx1 (column),
  //            runs: [{ x, y, t, key, size, color, u, track, w,
  //                     p, o, n (source offsets), f (field) }] }
  function layoutChain(story, frames, styles) {
    var psMap = byId(styles.ps), csMap = byId(styles.cs);
    var out = { frames: {}, overset: false, placedParas: 0 };
    frames.forEach(function (f) { out.frames[f.id] = { lines: [] }; });
    if (!frames.length) { out.overset = hasText(story); return out; }

    var fi = 0, col = 0, y = 0, colTop = true, curPi = 0, curLen = 0;
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

    // book typesetting (LY-BK): the page of the last line placed,
    // and how many lines of the paragraph went into each column
    var lastPg = null, segs = [], segKey = -1;
    var paras = story.paras || [];
    for (var pi = 0; pi < paras.length; pi++) {
      if (fi >= frames.length) { out.overset = true; break; }
      var para = paras[pi];
      var ps = resolvePs(psMap, para.ps);
      curPi = pi;
      if (ps.brk && !startAt(ps.brk)) { out.overset = true; break; }
      var S = snap(), got = place(para, ps, {});
      // lines kept together at a column break: the paragraph moves on
      // whole, or the column before it gives lines to the next
      var fix = got && keepFix(got, ps, S.colTop);
      if (fix) { restore(S); got = fix.first ? nextCol() && place(para, ps, {}) : place(para, ps, fix); }
      // keep with next: the next paragraph's first lines must fit after it
      if (got && ps.kwn && !S.colTop && pi + 1 < paras.length && !roomFor(paras[pi + 1])) {
        restore(S);
        got = nextCol() && place(para, ps, {});
      }
      if (!got) { out.overset = true; break; }
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

    function snap() {
      var n = {};
      frames.forEach(function (f) { n[f.id] = out.frames[f.id].lines.length; });
      return { fi: fi, col: col, y: y, colTop: colTop, geom: geom, lastPg: lastPg, n: n };
    }
    function restore(S) {
      fi = S.fi; col = S.col; y = S.y; colTop = S.colTop; geom = S.geom; lastPg = S.lastPg;
      frames.forEach(function (f) { out.frames[f.id].lines.length = S.n[f.id]; });
    }
    function pageOf() { return (frames[fi].ctx || {}).pg; }
    // 1 odd, 0 even, -1 a page without a number (any side will do)
    function parity() { var no = (frames[fi].ctx || {}).no; return typeof no !== "number" ? -1 : Math.abs(no) % 2; }
    // the paragraph starts in a new column, on a new page, or on an
    // odd (right-hand) or even (left-hand) page; false = no frame is left
    function startAt(brk) {
      if (brk === "col") return colTop || nextCol();
      while ((lastPg !== null && pageOf() === lastPg) || (brk === "odd" && parity() === 0) || (brk === "even" && parity() === 1)) if (!nextCol()) return false;
      return true;
    }
    // a paragraph laid out → the lines per column it took, or null
    // (no frame left); opt.breakAt: lines in its first column
    function place(para, ps, opt) {
      var toks = tokenize(para, ps, csMap);
      curLen = toks.len;
      if (ps.bul) toks.unshift({ k: "bul", a: runAttrs(ps, {}, {}) });
      segs = []; segKey = -1;
      return layoutPara(toks, ps, opt) ? segs : null;
    }
    // orph / wid broken → { first: 1 } (all to the next column) or
    // { breakAt: n } (n lines stay), else null
    function keepFix(got, ps, atTop) {
      if (got.length < 2) return null;
      var o = ps.orph || 1, w = ps.wid || 1, last = got[got.length - 1];
      if (got[0] < o) return atTop ? null : { first: 1 };
      if (last >= w || got.length > 2) return null;
      var keep = got[0] - (w - last);
      if (keep >= o) return { breakAt: keep };
      return atTop ? null : { first: 1 };
    }
    // room in this column for the first lines (its orph) of a paragraph
    function roomFor(next) {
      var nps = resolvePs(psMap, next.ps);
      if (nps.brk) return true;
      var key = fontKey(nps.font, nps.b, nps.i), lead = leadOf(nps, nps.size);
      var base = y + nps.sb + lead + lead * ((nps.orph || 1) - 1);
      return base + descent(key, nps.size) <= geom.bottom + 0.01;
    }

    // --- one paragraph; false = ran out of frames ---
    function layoutPara(toks, ps, opt) {
      var ti = 0, firstLine = true, done = 0;
      if (!colTop) y += ps.sb;          // ignored at the top of a column
      else if (ps.sink) y += ps.sink;   // where a sunk opening starts
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
        if (opt.breakAt && done === opt.breakAt) { if (!nextCol()) return false; opt.breakAt = 0; }
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
          done++;
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

    // offset where a token starts (a bullet sits before offset 0)
    function tokO(tok) {
      if (!tok) return curLen;
      if (tok.o !== undefined) return tok.o;
      return tok.parts && tok.parts.length ? tok.parts[0].o : 0;
    }
    function fill(ti, toks, ps, segs, base, asc, desc, lead, bul, bulletW, li, fullW) {
      var ctx = geom.f.ctx || {};
      var line = { col: col, frame: geom.f.id, y: base, d: desc, h: lead, runs: [], maxSize: 0, next: ti, base: base,
                   p: curPi, o0: tokO(toks[ti]), o1: curLen, cx0: geom.x0, cx1: geom.x1, x0: segs[0][0] };
      var broke = false;
      for (var si = 0; si < segs.length; si++) {
        var sx0 = segs[si][0], sx1 = segs[si][1], avail = sx1 - sx0;
        var items = [], w = 0, spaces = 0, pendingSp = [], hyph = null, hyW = 0;
        while (ti < toks.length) {
          var tk = toks[ti];
          if (tk.k === "br") { ti++; broke = true; break; }
          if (tk.k === "s" || tk.k === "h") {
            if (items.length) pendingSp.push(tk);
            ti++;
            continue;
          }
          var spW = 0, nsp = 0;
          pendingSp.forEach(function (s) { if (s.k === "s") { spW += measure(s.a.key, " ", s.a.size, s.a.track); nsp++; } });
          var ww = wordWidth(tk, ctx);
          if (w + spW + ww > avail + 0.001) {
            if (!items.length) {
              // too wide for a segment narrowed by a wrap: try the
              // next segment / line; wider than the column: split
              if (ww <= fullW + 0.001 && avail < fullW - 0.001) break;
              var pieces = splitWord(tk, avail, ctx);
              if (pieces.length > 1) { toks.splice.apply(toks, [ti, 1].concat(pieces)); continue; }
              items.push({ tok: tk, w: ww, sp: [], spW: 0, nsp: 0, ti: ti }); w += ww; ti++;
              break;
            }
            // a break inside a word: its hyphen must fit too, else the
            // line ends one break earlier
            hyph = breakHyph(pendingSp);
            while (hyph && items.length > 1) {
              if (w + (hyph.hy ? measure(hyph.a.key, "-", hyph.a.size, hyph.a.track) : 0) <= avail + 0.001) break;
              var last = items.pop();
              w -= last.w + last.spW; spaces -= last.nsp; ti = last.ti;
              hyph = breakHyph(last.sp);
            }
            hyW = hyph && hyph.hy ? measure(hyph.a.key, "-", hyph.a.size, hyph.a.track) : 0;
            break;
          }
          items.push({ tok: tk, w: ww, sp: pendingSp, spW: spW, nsp: nsp, ti: ti });
          spaces += nsp;
          w += spW + ww; pendingSp = [];
          ti++;
        }
        // alignment within the segment
        var align = ps.align, extra = avail - w - hyW, gapAdd = 0, x = sx0;
        // justify every segment except the paragraph's end and a
        // forced break
        var justifyHere = align === "j" && !broke && ti < toks.length;
        if (align === "c") x += extra / 2;
        else if (align === "r") x += extra;
        else if (justifyHere && spaces > 0 && extra > 0) gapAdd = extra / spaces;
        if (si === 0) line.x0 = x;
        if (bul && si === 0) {
          line.runs.push({ x: Math.max(geom.x0, geom.x0 + li - bulletW * 2.2), y: base, t: "•", key: bul.a.key, size: bul.a.size, color: bul.a.color, u: 0, track: 0, w: bulletW });
          line.maxSize = Math.max(line.maxSize, bul.a.size);
        }
        items.forEach(function (it, k) {
          if (k > 0) x += (it.spW || 0) + gapAdd * (it.nsp || 0);
          it.tok.parts.forEach(function (p) {
            var txt = partText(p, ctx), pw = partWidth(p, ctx);
            line.runs.push({ x: x, y: base, t: txt, key: p.a.key, size: p.a.size, color: p.a.color, u: p.a.u ? 1 : 0, track: p.a.track || 0, w: pw, p: curPi, o: p.o, n: p.n, f: p.f ? 1 : 0 });
            if (p.a.kern) line.runs[line.runs.length - 1].kern = 1;
            if (p.a.size > line.maxSize) line.maxSize = p.a.size;
            x += pw;
          });
        });
        if (hyph && hyph.hy && items.length) {
          var hr = { x: x, y: base, t: "-", key: hyph.a.key, size: hyph.a.size, color: hyph.a.color, u: hyph.a.u ? 1 : 0, track: hyph.a.track || 0, w: hyW, p: curPi, o: hyph.o, n: 1, f: 0 };
          // an automatic break takes no character: no offsets, so the
          // caret never stops on its hyphen
          if (hyph.auto) { delete hr.o; delete hr.n; }
          line.runs.push(hr);
        }
        if (si === 0) line.aw = avail;
        if (broke || ti >= toks.length) break;
      }
      if (!line.maxSize) line.maxSize = ps.size;
      line.next = ti;
      if (ti < toks.length) line.o1 = tokO(toks[ti]);
      return line;
    }

    // the break before the next word, when it is inside a word (only
    // break opportunities, no space, since the last word)
    function breakHyph(sp) {
      if (!sp.length) return null;
      for (var k = 0; k < sp.length; k++) if (sp[k].k === "s") return null;
      return sp[sp.length - 1];
    }
    function commit(line) {
      delete line.maxSize; delete line.next; delete line.base;
      out.frames[geom.f.id].lines.push(line);
      y = line.y; colTop = false;
      lastPg = pageOf() || null;
      var key = fi * 64 + col;
      if (key !== segKey) { segs.push(0); segKey = key; }
      segs[segs.length - 1]++;
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
    fontKey: fontKey, fontFile: fontFile, cssFamily: cssFamily, cssStack: cssStack, fallbackKey: fallbackKey, allKeys: allKeys, FAM_RE: FAM_RE, kernPair: kernPair,
    registerFamily: registerFamily, setFetcher: setFetcher, generation: generation, unicodeRange: unicodeRange,
    parseTTF: parseTTF, register: register, load: load, isLoaded: isLoaded, setBaseUrl: setBaseUrl,
    fontBase64: fontBase64, faceParts: faceParts, metrics: metrics, measure: measure, ascent: ascent, descent: descent,
    resolvePs: resolvePs, resolveCs: resolveCs, runAttrs: runAttrs, byId: byId,
    layoutChain: layoutChain, freeSegments: freeSegments, plainText: plainText, hasText: hasText, hyphenGreek: hyphenGreek
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else { root.orosDK = root.orosDK || {}; root.orosDK.text = api; }
})(typeof window !== "undefined" ? window : this);
