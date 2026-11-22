// ============================================================
// orOS designkit — text.js (v1.3.0)
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
//   - tabs (LY-TAB): a tab character moves on to the next stop,
//     measured from the paragraph's left indent: the style's own stops
//     (ext.tabs, points) first, then every ext.tabw points (36 when
//     unset, as Scribus and Word). Stops are left stops; the gap of a
//     tab never stretches in a justified line, only the spaces after
//     the line's last tab do.
//   - a line whose sizes are all smaller than its paragraph style's
//     size takes its metrics from them (a 7 pt header in a 9.8 pt
//     frame of a 10.5 pt style still fits, as in Scribus).
//   - a forced line break that ends a paragraph leaves an empty
//     line after it (Scribus, InDesign, Word); the first line of a
//     column needs only its baseline inside the column.
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
  // range, cff }] (cff: PostScript outlines, "OTTO", which jsPDF
  // cannot embed). A PDF embeds each file as its own font (Atelier's
  // vector PDF); a web page lists each as an @font-face with its
  // unicode-range ("" when the face is one file).
  function isCff(buf) {
    var b = new Uint8Array(buf, 0, Math.min(4, buf.byteLength));
    return b.length === 4 && b[0] === 0x4F && b[1] === 0x54 && b[2] === 0x54 && b[3] === 0x4F;
  }
  function faceParts(key) {
    var f = fonts[key];
    if (!f) return [];
    var many = f.parts.length > 1;
    return f.parts.map(function (p) {
      return {
        map: p.m ? p.m.map : f.m.map,
        range: many && p.m ? unicodeRange(p.m) : "",
        cff: isCff(p.buf),
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
  // Characters of a string that neither the face nor its fallback
  // draws (LY-W6 glyph check); spaces and controls do not count. An
  // unloaded face reports nothing.
  function missingGlyphs(key, str) {
    var m = metrics(key), out = [];
    if (!m) return out;
    var fb = m.fb ? metrics(m.fb) : null;
    if (m.fb && !fb) return out;   // its fallback is not loaded yet: cannot tell
    for (var i = 0; i < str.length; i++) {
      var cp = str.codePointAt(i);
      if (cp > 0xFFFF) i++;
      if (cp <= 0x20 || (cp >= 0x7F && cp <= 0xA0) || cp === 0xAD || (cp >= 0x200B && cp <= 0x200F) || cp === 0xFFFC) continue;
      if (m.map[cp] !== undefined || (fb && fb.map[cp] !== undefined)) continue;
      var ch = String.fromCodePoint(cp);
      if (out.indexOf(ch) === -1) out.push(ch);
    }
    return out;
  }
  // Greek-aware order (LY-W6) for lists people read: accents,
  // breathings and case set aside first (ά = α, ς = σ, Ἀ = α), then
  // used to tell apart what is otherwise the same; digits by value.
  var collator = null;
  try { collator = typeof Intl !== "undefined" && Intl.Collator ? new Intl.Collator("el", { sensitivity: "base", numeric: true }) : null; } catch (e) { collator = null; }
  function sortKey(s) {
    return String(s || "").normalize("NFD").replace(/[\u0300-\u036f\u0345]/g, "").toLowerCase().replace(/\u03C2/g, "\u03C3");
  }
  function collate(a, b) {
    a = String(a || ""); b = String(b || "");
    var r = collator ? collator.compare(a, b) : (sortKey(a) < sortKey(b) ? -1 : sortKey(a) > sortKey(b) ? 1 : 0);
    return r || (a < b ? -1 : a > b ? 1 : 0);
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
  // the space everywhere else); sec 1 / 0 its paragraphs are the
  // titles a running head shows (LY-RH); bl 1 / 0 its baselines sit
  // on the document's baseline grid (LY-W5b, frame.bgrid).
  // A paragraph's own ext.brk (a break character typed before it,
  // LY-W5b) starts it the same way, whatever its style says.
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
    if (x.sec !== undefined) out.sec = x.sec ? 1 : 0;
    if (x.nest !== undefined) out.nest = nestOf(x.nest);
    if (x.tabw !== undefined) { var tw = Number(x.tabw); out.tabw = isFinite(tw) ? Math.max(1, Math.min(720, tw)) : 36; }
    if (x.tabs !== undefined) out.tabs = tabsOf(x.tabs);
    if (x.grep !== undefined) out.grep = grepOf(x.grep);
    if (x.bl !== undefined) out.bl = x.bl ? 1 : 0;
    // composition (LY-W6): comp "p" the paragraph composer (else the
    // line-by-line one); ws [min, max] word spacing in % of a space
    // (min 50-100, max 100-400) a justified line may use; ls the most
    // letter spacing (thousandths of an em, 0-100) a justified line
    // may add once its spaces are at their max; opt 1 optical margins
    // (punctuation hangs at the edges); dc { n lines 2-10, c letters
    // 1-10 } a drop cap; bal 1 balanced ragged lines
    if (x.list !== undefined) out.list = listOf(x.list);
    if (x.comp !== undefined) out.comp = x.comp === "p" ? "p" : "";
    if (x.ws !== undefined) {
      var ws = Array.isArray(x.ws) ? x.ws : [];
      var mn = Number(ws[0]), mx = Number(ws[1]);
      out.wsMin = isFinite(mn) ? Math.max(50, Math.min(100, mn)) : 100;
      out.wsMax = isFinite(mx) ? Math.max(100, Math.min(400, mx)) : 0;
    }
    if (x.ls !== undefined) { var lv = Number(x.ls); out.lsMax = isFinite(lv) ? Math.max(0, Math.min(100, lv)) : 0; }
    if (x.opt !== undefined) out.opt = x.opt ? 1 : 0;
    if (x.bal !== undefined) out.bal = x.bal ? 1 : 0;
    if (x.dc !== undefined) {
      var dn = x.dc && Math.floor(Number(x.dc.n)), dl = x.dc && Math.floor(Number(x.dc.c));
      out.dc = dn >= 2 && dl >= 1 ? { n: Math.min(10, dn), c: Math.min(10, dl) } : null;
    }
  }
  // GREP styles (LY-W5, ext.grep): [{ re, cs }] up to 10, a JavaScript
  // regular expression (flag u, at most 200 characters) and the
  // character style its matches take; a later rule wins where two
  // overlap. A run with its own character style keeps it (as nested
  // styles). A pattern that does not compile is left out.
  var grepCache = {};
  function grepOf(v) {
    if (!Array.isArray(v)) return null;
    var out = v.filter(function (g) { return g && typeof g.re === "string" && g.re && g.re.length <= 200 && typeof g.cs === "string" && g.cs; })
      .slice(0, 10).map(function (g) { return { re: g.re, cs: g.cs }; })
      .filter(function (g) { return !!grepRe(g.re); });
    return out.length ? out : null;
  }
  function grepRe(src) {
    if (Object.prototype.hasOwnProperty.call(grepCache, src)) return grepCache[src];
    var re = null;
    try { re = new RegExp(src, "gu"); if (re.test("")) re = null; } catch (e) { re = null; }
    var keys = Object.keys(grepCache);
    if (keys.length > 200) delete grepCache[keys[0]];
    grepCache[src] = re;
    return re;
  }
  function grepCuts(text, rules) {
    var cuts = [];
    rules.forEach(function (g) {
      var re = grepRe(g.re), m, n = 0;
      if (!re) return;
      re.lastIndex = 0;
      while ((m = re.exec(text)) && n++ < 500) {
        if (!m[0].length) { re.lastIndex++; continue; }
        cuts.push({ a: m.index, b: m.index + m[0].length, cs: g.cs });
      }
    });
    return cuts;
  }
  function textOfRuns(runs) {
    var text = "";
    runs.forEach(function (r) { text += r.f ? "\uFFFC" : String(r.t || ""); });
    return text;
  }
  // Runs split at the cuts' edges; a piece inside cuts takes the last
  // covering cut's character style (runs with their own keep it).
  function cutRuns(runs, cuts) {
    if (!cuts.length) return runs;
    var edges = {};
    cuts.forEach(function (c) { edges[c.a] = 1; edges[c.b] = 1; });
    function cover(pos) { var hit = null; cuts.forEach(function (c) { if (pos >= c.a && pos < c.b) hit = c; }); return hit; }
    var out = [], base = 0;
    runs.forEach(function (r) {
      var len = r.f ? 1 : String(r.t || "").length, end = base + len;
      if (r.cs || r.f || r.ext || !len) {
        // a field takes the style of the place it is in
        if (r.f && !r.cs) { var c0 = cover(base); out.push(c0 ? Object.assign({}, r, { cs: c0.cs }) : r); }
        else out.push(r);
        base = end; return;
      }
      var pos = base, t = String(r.t);
      while (pos < end) {
        var stop = end;
        for (var k = pos + 1; k < end; k++) if (edges[k]) { stop = k; break; }
        var c = cover(pos), piece = Object.assign({}, r, { t: t.slice(pos - base, stop - base) });
        if (c) piece.cs = c.cs;
        out.push(piece);
        pos = stop;
      }
      base = end;
    });
    return out;
  }
  // ext.tabs: up to 40 stops in points (0-14400), in order
  function tabsOf(v) {
    if (!Array.isArray(v)) return [];
    return v.map(Number).filter(function (n) { return isFinite(n) && n > 0 && n <= 14400; }).sort(function (a, b) { return a - b; }).slice(0, 40);
  }
  // Nested styles (LY-PRO W2, ext.nest): [{ cs, to }] up to 4, each a
  // character style from where the last one stopped through the first
  // `to` (1-4 characters, included): a play's speaker in caps up to
  // the ":". Not found: that one and the rest do not apply. A run with
  // its own character style keeps it.
  function nestOf(v) {
    if (!Array.isArray(v)) return null;
    var out = v.filter(function (n) { return n && typeof n.cs === "string" && n.cs && typeof n.to === "string" && n.to.length >= 1 && n.to.length <= 4; })
      .slice(0, 4).map(function (n) { return { cs: n.cs, to: n.to }; });
    return out.length ? out : null;
  }
  function nestRuns(runs, nest) {
    var text = textOfRuns(runs);
    var cuts = [], at = 0;
    for (var i = 0; i < nest.length; i++) {
      var k = text.indexOf(nest[i].to, at);
      if (k < 0) break;
      cuts.push({ a: at, b: k + nest[i].to.length, cs: nest[i].cs });
      at = k + nest[i].to.length;
    }
    if (!cuts.length) return runs;
    var out = [], base = 0;
    runs.forEach(function (r) {
      var len = r.f ? 1 : String(r.t || "").length, end = base + len;
      if (r.cs || r.f || r.ext || !len) {
        // a field takes the style of the place it is in
        if (r.f && !r.cs) { var c0 = cuts.filter(function (c) { return base >= c.a && base < c.b; })[0]; out.push(c0 ? Object.assign({}, r, { cs: c0.cs }) : r); }
        else out.push(r);
        base = end; return;
      }
      var pos = base, t = String(r.t);
      while (pos < end) {
        var c = cuts.filter(function (x) { return pos >= x.a && pos < x.b; })[0];
        var stop = c ? Math.min(end, c.b) : Math.min(end, cuts.reduce(function (m, x) { return x.a > pos && x.a < m ? x.a : m; }, end));
        var piece = Object.assign({}, r, { t: t.slice(pos - base, stop - base) });
        if (c) piece.cs = c.cs;
        out.push(piece);
        pos = stop;
      }
      base = end;
    });
    return out;
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
    // LY-W6: sc 1 small capitals (drawn from the capitals, smaller),
    // pos "sup" | "sub" superscript or subscript
    if (s.ext && s.ext.sc !== undefined) out.sc = s.ext.sc ? 1 : 0;
    if (s.ext && s.ext.pos !== undefined) out.pos = s.ext.pos === "sup" || s.ext.pos === "sub" ? s.ext.pos : "";
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
    // a note's mark (ext.sup, LY-NT): smaller and raised; an older
    // orOS shows it at the text's size
    if (run.ext && run.ext.sup) { a.rise = a.size * 0.33; a.size = a.size * 0.65; }
    else if (cs.pos === "sup") { a.rise = a.size * 0.33; a.size = a.size * 0.65; }
    else if (cs.pos === "sub") { a.rise = -a.size * 0.14; a.size = a.size * 0.65; }
    if (cs.sc !== undefined ? cs.sc : ps.sc) a.sc = 1;
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
  // Polytonic text (LY-W6) follows the same rules: each letter is read
  // as its base letter (breathings, accents and the iota subscript
  // set aside, ῃ is η), and a dialytika still starts a new syllable.
  // i18n-inline-ok: Greek consonant pairs a word can start with
  var GR_ONSET = " βγ βδ βλ βρ γδ γκ γλ γν γρ δρ θλ θν θρ κλ κν κρ κτ μν μπ ντ πλ πν πρ πτ σβ σγ σθ σκ σλ σμ σν σπ στ σφ σχ τζ τμ τρ τσ φθ φλ φρ φτ χθ χλ χν χρ χτ ";
  var GR_LET = /^[\u0386\u0388-\u03CE\u1F00-\u1FBC\u1FC2-\u1FCC\u1FD0-\u1FDB\u1FE0-\u1FEC\u1FF2-\u1FFC]+$/;
  var HY_MIN = 2, baseCache = {};
  // a Greek letter → { b: its base letter, lower case, σ for ς; d: 1
  // when it carries a dialytika }
  function grBase(ch) {
    var c = baseCache[ch];
    if (c) return c;
    var d = ch.normalize ? ch.normalize("NFD") : ch;
    var b = d.charAt(0).toLowerCase();
    if (b === "\u03C2") b = "\u03C3";
    return (baseCache[ch] = { b: b, d: d.indexOf("\u0308") !== -1 ? 1 : 0 });
  }
  var GR_VOW_BASE = "\u03B1\u03B5\u03B7\u03B9\u03BF\u03C5\u03C9";
  // word → offsets where it may break (a "-" then shows)
  function hyphenGreek(word) {
    var out = [], n = word.length;
    if (n < 2 * HY_MIN || !GR_LET.test(word)) return out;
    var bs = [];
    for (var i = 0; i < n; i++) bs.push(grBase(word[i]));
    var w = bs.map(function (x) { return x.b; }).join("");
    var vow = function (k) { return GR_VOW_BASE.indexOf(w[k]) !== -1; };
    var k = 0;
    while (k < n && !vow(k)) k++;
    while (k < n) {
      // the end of this vowel group
      var e = k + 1;
      while (e < n && vow(e) && !bs[e].d) e++;
      if (e >= n) break;
      if (vow(e)) { out.push(e); k = e; continue; }
      // consonants up to the next vowel
      var c = e;
      while (c < n && !vow(c)) c++;
      if (c >= n) break;
      var at;
      if (c - e === 1) at = e;
      else at = GR_ONSET.indexOf(" " + w.substr(e, 2) + " ") !== -1 ? e : e + 1;
      out.push(at);
      k = c;
    }
    return out.filter(function (o) { return o >= HY_MIN && n - o >= HY_MIN; });
  }
  // A word token's break points as tokens (one-part words; the "h"
  // tokens take no character: auto 1).
  var EDGE = /^([^\u0386\u0388-\u03CE\u1F00-\u1FFF]*)([\u0386\u0388-\u03CE\u1F00-\u1FFF]+)([^\u0386\u0388-\u03CE\u1F00-\u1FFF]*)$/;
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
  // Polytonic letters (LY-W6) lose breathings and accents too; an iota
  // subscript becomes a capital iota after its letter (ᾳ → ΑΙ).
  function polyCap(c) {
    var d = c.normalize ? c.normalize("NFD") : c, b = d.charAt(0);
    if (!/[\u0391-\u03A9\u03B1-\u03C9]/.test(b)) return c;
    var dia = d.indexOf("\u0308") !== -1 ? "\u0308" : "", isub = d.indexOf("\u0345") !== -1 ? "\u03B9" : "";
    return (b + dia).normalize("NFC") + isub;
  }
  var CAPS = { caps: 1 };
  function scOf(a) {
    if (!a._sc) { a._sc = {}; for (var k in a) if (k !== "_sc" && Object.prototype.hasOwnProperty.call(a, k)) a._sc[k] = a[k]; a._sc.size = a.size * 0.78; a._sc.track = (a.track || 0) + 25; delete a._sc.sc; }
    return a._sc;
  }
  function caseOf(a, t) {
    if (!a.caps) return t;
    return t.replace(/[\u1F00-\u1FFF]/g, polyCap).replace(/[ΐΰ]/g, function (c) { return TONOS[c]; }).toUpperCase().replace(/[ΆΈΉΊΌΎΏ]/g, function (c) { return TONOS[c]; });
  }

  // Every part and space carries its offset `o` (and parts their
  // length `n`) in the paragraph's character space: text characters
  // count one each, a field counts one. The in-frame editor maps the
  // caret through them.
  function tokenize(para, ps, csMap) {
    var toks = [], word = null, base = 0;
    var runs = ps.nest && para.runs && para.runs.length ? nestRuns(para.runs, ps.nest) : (para.runs || []);
    if (ps.grep && runs.length) runs = cutRuns(runs, grepCuts(textOfRuns(runs), ps.grep));
    function flush() { if (word) { toks.push(word); word = null; } }
    function part(t, a, o, n) {
      if (!word) word = { k: "w", parts: [] };
      if (!a.sc || a.caps) { word.parts.push({ t: caseOf(a, t), a: a, o: o, n: n }); return; }
      // small capitals: the lower-case letters as capitals, smaller and
      // a little spaced; the rest as typed
      var re = /\p{Ll}+|[^\p{Ll}]+/gu, m;
      while ((m = re.exec(t))) {
        var low = /\p{Ll}/u.test(m[0]);
        word.parts.push({ t: low ? caseOf(CAPS, m[0]) : m[0], a: low ? scOf(a) : a, o: o + m.index, n: m[0].length });
      }
    }
    runs.forEach(function (run) {
      var cs = run.cs ? resolveCs(csMap, run.cs) : {};
      var a = runAttrs(ps, cs, run);
      // a tracked deletion (LY-W12, ext.del): kept in the text until it
      // is accepted or rejected, never set; its characters keep their
      // offsets
      if (run.ext && run.ext.del && typeof run.t === "string") { base += run.t.length; return; }
      if (run.f) {
        if (!word) word = { k: "w", parts: [] };
        word.parts.push({ t: null, f: run.f, a: a, o: base, n: 1 });
        base += 1;
        return;
      }
      // a running head (ext.fld "sec", LY-RH): the page's chapter title;
      // its own text is what shows where there is none (a master being
      // edited, an older orOS). Its characters keep their offsets.
      // a note's reference (LY-W7, ext.fn: the note's id) shows the
      // note's number, raised; a cross-reference (ext.xr) the page or
      // text of where it points. Their own text is what an older orOS
      // shows; its characters keep their offsets.
      if (run.ext && (typeof run.ext.fn === "string" || (run.ext.xr && typeof run.ext.xr === "object")) && typeof run.t === "string" && run.t) {
        if (!word) word = { k: "w", parts: [] };
        if (typeof run.ext.fn === "string") {
          var fa = {}; for (var ak in a) if (ak !== "_sc" && Object.prototype.hasOwnProperty.call(a, ak)) fa[ak] = a[ak];
          fa.rise = a.size * 0.33; fa.size = a.size * 0.65;
          word.parts.push({ t: null, f: "fn", fn: run.ext.fn, fb: run.t, a: fa, o: base, n: run.t.length });
        } else word.parts.push({ t: null, f: "xr", xr: run.ext.xr, fb: run.t, a: a, o: base, n: run.t.length });
        base += run.t.length;
        return;
      }
      if (run.ext && run.ext.fld === "sec" && typeof run.t === "string") {
        if (!word) word = { k: "w", parts: [] };
        word.parts.push({ t: null, f: "sec", fb: run.t, a: a, o: base, n: run.t.length });
        base += run.t.length;
        return;
      }
      var s = String(run.t || "");
      var buf = "", b0 = 0;
      for (var i = 0; i < s.length; i++) {
        var ch = s[i];
        if (ch === "\n") {
          if (buf) { part(buf, a, base + b0, buf.length); buf = ""; }
          flush(); toks.push({ k: "br", o: base + i });
        } else if (ch === "\t") {
          if (buf) { part(buf, a, base + b0, buf.length); buf = ""; }
          flush(); toks.push({ k: "t", a: a, o: base + i });
        } else if (ch === " ") {
          if (buf) { part(buf, a, base + b0, buf.length); buf = ""; }
          flush(); toks.push({ k: "s", a: a, o: base + i });
        } else if (ch === "\uFFFC" && run.ext && typeof run.ext.obj === "string") {
          // an anchored object (LY-PRO W4b): a box as wide and tall as
          // the frame it holds, set like a word
          if (buf) { part(buf, a, base + b0, buf.length); buf = ""; }
          if (!word) word = { k: "w", parts: [] };
          word.parts.push({ t: null, f: "obj", ob: run.ext.obj, a: a, o: base + i, n: 1 });
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
    if (p.f === "sec") return caseOf(p.a, typeof ctx.sec === "string" ? ctx.sec : p.fb || "");
    if (p.f === "fn") return curNotes && curNotes.num[p.fn] ? String(curNotes.num[p.fn]) : p.fb || "*";
    if (p.f === "xr") return caseOf(p.a, xrText(p.xr, p.fb));
    return "";
  }
  // the anchored objects' boxes of the chain being laid out:
  // { item id: { w, h } } (styles.obj; none: an object takes no room)
  var curObjs = null;
  // the notes of the chain being laid out (LY-W7): { num: { id: n },
  // text: { id: text }, kind "foot" | "end", ps } (styles.notes), and
  // the cross-reference targets { anchor id: { pg: label, t: text } }
  // (styles.xr)
  var curNotes = null, curXr = null;
  function xrText(x, fb) {
    var to = x && typeof x.to === "string" && curXr ? curXr[x.to] : null;
    if (!to) return fb || "?";
    return x.k === "t" ? to.t : x.k === "tp" ? to.t + " (" + to.pg + ")" : String(to.pg);
  }
  function objBox(p) { var b = curObjs && curObjs[p.ob]; return b && b.w > 0 && b.h > 0 ? b : null; }
  function partWidth(p, ctx) {
    if (p.f === "obj") { var b = objBox(p); return b ? b.w : 0; }
    return measure(p.a.key, partText(p, ctx), p.a.size, p.a.track, p.a.kern);
  }
  function wordWidth(w, ctx) {
    var s = 0;
    for (var i = 0; i < w.parts.length; i++) s += partWidth(w.parts[i], ctx);
    return s;
  }
  // the biggest size among a paragraph's words (0: none)
  function wordsMaxSize(toks) {
    var m = 0;
    toks.forEach(function (tk) { if (tk.k === "w") tk.parts.forEach(function (p) { if (p.a.size > m) m = p.a.size; }); });
    return m;
  }
  // the one font all its words are set in ("" when they mix or there
  // are none): in a frame from Scribus (sfit) its ascent and descent
  // place the lines, as Scribus takes them from the glyphs (LY-FIT)
  function wordsKey(toks) {
    var k = null;
    for (var i = 0; i < toks.length; i++) {
      if (toks[i].k !== "w") continue;
      var ps = toks[i].parts;
      for (var j = 0; j < ps.length; j++) {
        if (k === null) k = ps[j].a.key;
        else if (ps[j].a.key !== k) return "";
      }
    }
    return k || "";
  }
  // a tab at `pos` (points from the left indent) → the next stop
  function tabStop(ps, pos) {
    var st = ps.tabs || [];
    for (var i = 0; i < st.length; i++) if (st[i] > pos + 0.01) return st[i];
    var w = ps.tabw || 36;
    return (Math.floor((pos + 0.01) / w) + 1) * w;
  }

  // ---------- 6c. Notes (LY-W7) ----------
  // A note lives in its reference: a run with ext.fn = its id and
  // ext.ft = its text (paragraphs split by a new line), so it travels
  // with the text it belongs to (copy, paste, another story); a
  // story's ext.fn { id: text } is read too. styles.notes:
  // { kind "foot" | "end", ps (a paragraph style id), start (the first
  // number of this story, so numbers run through a document) }.
  function notesOf(story, styles) {
    var tx = story && story.ext && story.ext.fn;
    var refs = [], num = {}, text = {};
    (story && story.paras || []).forEach(function (p) {
      (p.runs || []).forEach(function (r) {
        if (!r.ext || typeof r.ext.fn !== "string" || refs.indexOf(r.ext.fn) >= 0) return;
        refs.push(r.ext.fn);
        text[r.ext.fn] = typeof r.ext.ft === "string" ? r.ext.ft : tx && typeof tx[r.ext.fn] === "string" ? tx[r.ext.fn] : "";
      });
    });
    if (!refs.length) return null;
    var cfg = styles.notes || {}, n = Math.max(1, Math.floor(Number(cfg.start)) || 1);
    refs.forEach(function (id) { num[id] = n++; });
    var psMap = byId(styles.ps), base = resolvePs(psMap, cfg.ps && psMap[cfg.ps] ? cfg.ps : "ps-base");
    var own = !!(cfg.ps && psMap[cfg.ps]);
    return { num: num, text: text, order: refs, kind: cfg.kind === "end" ? "end" : "foot", ps: own ? cfg.ps : null, base: base, styles: styles,
             key: fontKey(base.font, base.b, base.i), color: base.color };
  }
  // the notes as paragraphs: "n" + an en space + the text
  function noteParas(notes, ids) {
    var out = [];
    ids.forEach(function (id) {
      String(notes.text[id] || "").split("\n").slice(0, 50).forEach(function (t, k) {
        var runs = [];
        if (!k) runs.push({ t: notes.num[id] + "\u2002" });
        if (t) runs.push({ t: t });
        out.push({ ps: notes.ps || "_fn", runs: runs });
      });
    });
    return out;
  }
  // a line moved down by dy: its runs and a table row's fills and rules
  function moveLine(ln, dy) {
    ln.y += dy;
    ln.runs.forEach(function (r) { r.y += dy; });
    if (ln.tb) {
      ln.tb.fills.forEach(function (f) { f[1] += dy; });
      ln.tb.rules.forEach(function (r) { r[1] += dy; r[3] += dy; });
    }
  }
  // a note set on its own, `w` wide → { lines, h }
  function noteBlock(notes, id, w) {
    var st = notes.styles, ps = st.ps;
    if (!notes.ps) {
      var b = notes.base, sz = Math.max(5, Math.round(b.size * 0.8 * 10) / 10);
      ps = ps.concat([{ id: "_fn", m: 0, name: "", base: "ps-base", size: sz, lead: b.lead > 0 ? Math.max(sz * 1.15, b.lead * 0.8) : 0, align: b.align === "j" ? "j" : "l", sb: 0, sa: 1, fi: 0, li: 0, ri: 0, ext: { brk: "" } }]);
    }
    var keepO = curObjs, keepN = curNotes, keepX = curXr;
    var res = layoutChain({ paras: noteParas(notes, [id]) }, [{ id: "_fn", w: w, h: 1e6 }], { ps: ps, cs: st.cs });
    curObjs = keepO; curNotes = keepN; curXr = keepX;
    var ls = res.frames._fn.lines, last = ls[ls.length - 1];
    return { lines: ls, h: last ? last.y + last.d + 2 : 0 };
  }

  // ---------- 6a. Lists (LY-W7) ----------
  // A paragraph style's ext.list { f: format, g: list name (default the
  // style's id), lv: level 1-3, s: first number } numbers its
  // paragraphs; a paragraph's ext.lr (a number) starts its list again
  // from there. Counters run through the story; a deeper level starts
  // again under each new number of the level above.
  // i18n-inline-ok: Greek numerals (list labels, no UI text)
  var GR_UNITS = ["", "α", "β", "γ", "δ", "ε", "ϛ", "ζ", "η", "θ"], GR_TENS = ["", "ι", "κ", "λ", "μ", "ν", "ξ", "ο", "π", "ϟ"], GR_HUND = ["", "ρ", "σ", "τ", "υ", "φ", "χ", "ψ", "ω", "ϡ"];
  function greekNum(n) {
    if (n < 1 || n > 999) return String(n);
    return GR_HUND[Math.floor(n / 100)] + GR_TENS[Math.floor(n / 10) % 10] + GR_UNITS[n % 10] + "\u0374";
  }
  function roman(n) {
    if (n < 1 || n > 3999) return String(n);
    var v = [1000, 900, 500, 400, 100, 90, 50, 40, 10, 9, 5, 4, 1], r = ["m", "cm", "d", "cd", "c", "xc", "l", "xl", "x", "ix", "v", "iv", "i"], o = "";
    for (var i = 0; i < v.length; i++) while (n >= v[i]) { o += r[i]; n -= v[i]; }
    return o;
  }
  function alpha(n) { var o = ""; while (n > 0) { n--; o = String.fromCharCode(97 + n % 26) + o; n = Math.floor(n / 26); } return o; }
  var LIST_FMT = {
    "1.": function (n) { return n + "."; }, "1)": function (n) { return n + ")"; }, "(1)": function (n) { return "(" + n + ")"; },
    "a.": function (n) { return alpha(n) + "."; }, "a)": function (n) { return alpha(n) + ")"; }, "A.": function (n) { return alpha(n).toUpperCase() + "."; },
    "i.": function (n) { return roman(n) + "."; }, "I.": function (n) { return roman(n).toUpperCase() + "."; },
    "\u03B1\u0374": greekNum, "\u0391\u0374": function (n) { return greekNum(n).toUpperCase(); }, "\u2022": function () { return "\u2022"; }, "\u2013": function () { return "\u2013"; }
  };
  function listOf(v) {
    // U+0374 and U+02B9 are the same keraia (NFC turns one into the other)
    var f = v && typeof v.f === "string" ? v.f.replace(/\u02B9/g, "\u0374") : "";
    if (!v || typeof v !== "object" || !LIST_FMT[f]) return null;
    var lv = Math.floor(Number(v.lv)), st = Math.floor(Number(v.s));
    return { f: f, g: typeof v.g === "string" ? v.g.slice(0, 40) : "", lv: lv >= 1 && lv <= 3 ? lv : 1, s: st >= 0 && st < 100000 ? st : 1 };
  }
  function listLabel(f, n) { return (LIST_FMT[f] || LIST_FMT["1."])(n); }
  // each paragraph's label ("" none) for a story
  function listLabels(paras, psMap) {
    var out = [], count = {};
    paras.forEach(function (p, i) {
      var ps = resolvePs(psMap, p.ps), L = ps.list;
      if (!L || ps.bul) { out[i] = ""; return; }
      var g = L.g || p.ps, c = count[g] = count[g] || [0, 0, 0, 0];
      var lr = p.ext && Number(p.ext.lr);
      if (lr >= 0 && lr < 100000 && p.ext.lr !== undefined && p.ext.lr !== null) c[L.lv] = Math.floor(lr);
      else c[L.lv] = c[L.lv] ? c[L.lv] + 1 : L.s;
      for (var k = L.lv + 1; k < 4; k++) c[k] = 0;
      out[i] = listLabel(L.f, c[L.lv]);
    });
    return out;
  }

  // ---------- 6b. Optical margins, drop caps, the composer (LY-W6) ----------
  // How much of a character hangs past the edge of the column.
  // i18n-inline-ok: punctuation marks (typesetting data, no UI text)
  var HANG = { ".": 1, ",": 1, "-": 1, "\u2010": 1, "\u00B7": 1, "'": 1, "\"": 1, "\u2018": 1, "\u2019": 1, "\u201C": 1, "\u201D": 1, "\u201E": 1,
               "\u00AB": 0.5, "\u00BB": 0.5, "\u2039": 0.5, "\u203A": 0.5, ":": 0.5, ";": 0.5, "\u0387": 0.5, "\u2013": 0.5, "\u2014": 0.5, "!": 0.3, "?": 0.3, "\u2026": 0.3 };
  function edgePart(tok, last) {
    var ps = tok.parts || [];
    for (var i = last ? ps.length - 1 : 0; last ? i >= 0 : i < ps.length; i += last ? -1 : 1) if (ps[i].t !== null && ps[i].t.length && ps[i].f !== "obj") return ps[i];
    return null;
  }
  function hangOf(p, ch) { var k = HANG[ch]; return k ? measure(p.a.key, ch, p.a.size, 0) * k : 0; }
  function hangLeft(tok) { var p = tok && tok.k === "w" ? edgePart(tok, false) : null; return p ? hangOf(p, p.t.charAt(0)) : 0; }
  function hangRight(tok) { var p = tok && tok.k === "w" ? edgePart(tok, true) : null; return p ? hangOf(p, p.t.charAt(p.t.length - 1)) : 0; }

  // A drop cap: the first letters of the paragraph's first word (as
  // many as asked, never more than the word), sized so their capitals
  // stand from the first line's cap height to the n-th line's
  // baseline. The word token loses them.
  var CAP_H = 0.7;
  function dropCap(toks, ps) {
    if (!ps.dc || !toks.length || toks[0].k !== "w") return null;
    var p0 = toks[0].parts[0];
    if (!p0 || p0.t === null || p0.f || !p0.t.length || p0.t.length !== p0.n) return null;
    var c = Math.min(ps.dc.c, p0.t.length), lead = leadOf(ps, ps.size);
    var size = (lead * (ps.dc.n - 1) + CAP_H * ps.size) / CAP_H;
    var txt = p0.t.slice(0, c);
    var dc = { t: txt, a: p0.a, size: size, o: p0.o, n: c, nLines: ps.dc.n };
    dc.cw = measure(p0.a.key, txt, size, 0);
    dc.w = dc.cw + ps.size * 0.3;
    dc.n = ps.dc.n; dc.nch = c;
    if (c === p0.t.length) {
      toks[0].parts.shift();
      if (!toks[0].parts.length) toks.shift();
    } else {
      toks[0].parts[0] = { t: p0.t.slice(c), a: p0.a, o: p0.o + c, n: p0.n - c };
    }
    return dc;
  }
  // Split a word that is wider than any line into pieces that fit.
  function splitWord(w, maxW, ctx) {
    var pieces = [], cur = { k: "w", parts: [] }, curW = 0;
    w.parts.forEach(function (p) {
      var txt = partText(p, ctx), buf = "", b0 = 0;
      function push() {
        var o = p.f ? p.o : p.o + Math.min(b0, p.n), n = p.f ? p.n : Math.max(0, Math.min(buf.length, p.n - Math.min(b0, p.n)));
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
  // ex = { x, y, w, h, shape: "box"|"ell"|"poly" } in frame coordinates,
  // offset already applied. Returns the blocked x-interval for the
  // band [y0, y1], or null.
  // shape "poly" (W4b, by the outline): polys = point lists, o the
  // offset; the band (widened by o) takes the polygons' x extent there.
  function polyBlocked(ex, y0, y1) {
    var o = ex.o || 0, a = y0 - o, b = y1 + o, lo = Infinity, hi = -Infinity;
    ex.polys.forEach(function (pl) {
      for (var i = 0; i < pl.length; i++) {
        var p = pl[i], q = pl[(i + 1) % pl.length];
        var ya = Math.min(p[1], q[1]), yb = Math.max(p[1], q[1]);
        if (yb < a || ya > b) continue;
        // the edge's part inside the band
        var t0 = 0, t1 = 1, dy = q[1] - p[1];
        if (dy) {
          var ta = (a - p[1]) / dy, tb = (b - p[1]) / dy;
          t0 = Math.max(0, Math.min(ta, tb)); t1 = Math.min(1, Math.max(ta, tb));
          if (t1 < t0) continue;
        }
        var xa = p[0] + (q[0] - p[0]) * t0, xb = p[0] + (q[0] - p[0]) * t1;
        lo = Math.min(lo, xa, xb); hi = Math.max(hi, xa, xb);
      }
    });
    return hi >= lo ? [lo - o, hi + o] : null;
  }
  function blocked(ex, y0, y1) {
    if (y1 <= ex.y || y0 >= ex.y + ex.h) return null;
    if (ex.shape === "poly") return polyBlocked(ex, y0, y1);
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
    // a slice left by a wrap must be wide enough; the whole line (no
    // wrap across it) always is, however narrow the frame (CV-F3)
    return segs.filter(function (s) { return s[1] - s[0] >= minW || (s[0] === x0 && s[1] === x1); });
  }

  // ---------- 8. Layout ----------
  // frames: ordered chain, each
  //   { id, w, h, cols, gut, inset, valign: "t"|"c"|"b", excl: [],
  //     slack (optional: a word may pass the right edge by this much),
  //     one (true: the frame holds one line, whatever its height),
  //     ctx: { pageLabel, pageCount, sec (the page's running head
  //     text, LY-RH) } }
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
    curObjs = styles.obj || null;
    curXr = styles.xr || null;
    var notes = curNotes = notesOf(story, styles);
    var out = { frames: {}, overset: false, placedParas: 0 };
    frames.forEach(function (f) { out.frames[f.id] = { lines: [] }; });
    if (!frames.length) { out.overset = hasText(story); return out; }
    // endnotes (LY-W7): the notes follow the story's last paragraph
    var realN = (story.paras || []).length;
    if (notes && notes.kind === "end" && notes.order.length) story = { paras: (story.paras || []).concat(noteParas(notes, notes.order)) };
    var labels = listLabels(story.paras || [], psMap);
    // footnotes waiting at the foot of each column: key → { f, col, x0,
    // bottom, h, blocks: [{ lines, h }] }
    var foot = {}, fnDone = {}, FN_SEP = 9, FN_GAP = 2;
    function footKey() { return fi * 64 + col; }
    function footRoom() { var k = foot[footKey()]; return k ? k.h + FN_SEP : 0; }

    var fi = 0, col = 0, y = 0, colTop = true, curPi = 0, curLen = 0;
    var geom = null;

    function colGeom() {
      var f = frames[fi];
      var cols = Math.max(1, Math.min(20, f.cols || 1));
      var ins = Math.max(0, f.inset || 0), gut = Math.max(0, f.gut || 0);
      var innerW = Math.max(1, f.w - 2 * ins);
      var cw = Math.max(1, (innerW - gut * (cols - 1)) / cols);
      return { f: f, cols: cols, x0: ins + col * (cw + gut), x1: ins + col * (cw + gut) + cw, top: ins, bottom: f.one ? Infinity : Math.max(ins, f.h - ins) };
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
      var pbrk = para.ext && BRK[para.ext.brk] ? para.ext.brk : ps.brk;
      if (pbrk && !startAt(pbrk)) { out.overset = true; break; }
      // a table (LY-W12): rows in the column, header rows repeated
      var tbx = para.ext && para.ext.tbl;
      if (tbx && Array.isArray(tbx.rows) && tbx.rows.length && Array.isArray(tbx.cols) && tbx.cols.length) {
        if (!placeTable(para, ps, tbx)) { out.overset = true; break; }
        if (pi < realN) out.placedParas = pi + 1;
        continue;
      }
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
      if (pi < realN) out.placedParas = pi + 1;
    }
    // the footnotes, at the foot of their columns, under a short rule
    Object.keys(foot).forEach(function (k) {
      var F = foot[k], yy = F.bottom - F.h;
      var rule = { col: F.col, frame: F.f.id, y: yy - FN_SEP + 3, d: 0, h: FN_SEP, runs: [{ x: F.x0, y: yy - FN_SEP + 3, t: "\u00A0", key: notes.key, size: 6, color: notes.color, u: 1, track: 0, w: Math.min(72, F.cw / 3) }], fn: 1, rule: 1, p: -1, cx0: F.x0, cx1: F.x0 + F.cw, x0: F.x0 };
      out.frames[F.f.id].lines.push(rule);
      F.blocks.forEach(function (b, bi) {
        b.lines.forEach(function (ln) {
          // fk: which note the line belongs to (a tagged PDF's Note, LY-N6)
          var nl = { col: F.col, frame: F.f.id, y: yy + ln.y, d: ln.d, h: ln.h, fn: 1, fk: k + "/" + bi, p: -1, cx0: F.x0 + ln.cx0, cx1: F.x0 + ln.cx1, x0: F.x0 + ln.x0, runs: ln.runs.map(function (r) {
            var o = {}; for (var q in r) if (q !== "o" && q !== "n" && q !== "p") o[q] = r[q];
            o.x = F.x0 + r.x; o.y = yy + r.y; return o;
          }) };
          out.frames[F.f.id].lines.push(nl);
        });
        yy += b.h;
      });
    });
    var footCols = {};
    Object.keys(foot).forEach(function (k) { footCols[foot[k].f.id + ":" + foot[k].col] = 1; });

    // vertical justification (LY-W5b, frame ext.vj): a column the text
    // goes on from gets its free space shared out between paragraphs
    // (between lines when it holds one paragraph); the last column of
    // the text stays as it is
    var lastF = null, lastC = -1;
    frames.forEach(function (f) { var ls = out.frames[f.id].lines.filter(function (l) { return !l.fn; }); if (ls.length) { lastF = f; lastC = ls[ls.length - 1].col; } });
    frames.forEach(function (f) {
      if (!f.vj) return;
      var byCol = {}, ins = Math.max(0, f.inset || 0), bottom = Math.max(ins, f.h - ins);
      out.frames[f.id].lines.forEach(function (ln) { if (!ln.fn) (byCol[ln.col] = byCol[ln.col] || []).push(ln); });
      Object.keys(byCol).forEach(function (c) {
        if (footCols[f.id + ":" + c]) return;
        if (f === lastF && +c === lastC && !out.overset) return;
        var ls = byCol[c], last = ls[ls.length - 1], free = bottom - (last.y + last.d);
        if (free <= 0.5 || ls.length < 2) return;
        var gaps = 0, i;
        for (i = 1; i < ls.length; i++) if (ls[i].p !== ls[i - 1].p) gaps++;
        if (!gaps && ls.some(function (l) { return l.tb; })) return;   // a table's rows do not spread (LY-W12)
        var byLine = !gaps, step = free / (byLine ? ls.length - 1 : gaps), dy = 0;
        for (i = 1; i < ls.length; i++) {
          if (byLine || ls[i].p !== ls[i - 1].p) dy += step;
          var ln = ls[i], d0 = dy;
          moveLine(ln, d0);
        }
      });
    });
    // vertical alignment per column
    frames.forEach(function (f) {
      if (!f.valign || f.valign === "t" || f.vj) return;
      var lines = out.frames[f.id].lines;
      var byCol = {};
      lines.forEach(function (ln) { if (!ln.fn) (byCol[ln.col] = byCol[ln.col] || []).push(ln); });
      var ins = Math.max(0, f.inset || 0), bottom = Math.max(ins, f.h - ins);
      Object.keys(byCol).forEach(function (c) {
        if (footCols[f.id + ":" + c]) return;
        var ls = byCol[c], last = ls[ls.length - 1];
        var used = (last.y + last.d) - ins, free = (bottom - ins) - used;
        if (free <= 0) return;
        var dy = f.valign === "c" ? free / 2 : free;
        ls.forEach(function (ln) { moveLine(ln, dy); });
      });
    });
    return out;

    function snap() {
      var n = {};
      frames.forEach(function (f) { n[f.id] = out.frames[f.id].lines.length; });
      var fs = {};
      Object.keys(foot).forEach(function (k) { fs[k] = { f: foot[k].f, col: foot[k].col, x0: foot[k].x0, bottom: foot[k].bottom, h: foot[k].h, blocks: foot[k].blocks.slice() }; });
      return { fi: fi, col: col, y: y, colTop: colTop, geom: geom, lastPg: lastPg, n: n, foot: fs, fnDone: Object.keys(fnDone) };
    }
    function restore(S) {
      fi = S.fi; col = S.col; y = S.y; colTop = S.colTop; geom = S.geom; lastPg = S.lastPg;
      foot = S.foot; fnDone = {}; S.fnDone.forEach(function (k) { fnDone[k] = 1; });
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
    // ---- a table (LY-W12) ----
    // each cell's text set on its own (as a note is), rows as tall as
    // their tallest cell, rows a span joins kept in one column; a row
    // is one line with its cells' runs, fills and rules (line.tb)
    function cellLines(text, psId, w) {
      var keepO = curObjs, keepN = curNotes, keepX = curXr;
      var cp = String(text || "").split("\n").map(function (s) { return { ps: psId, runs: [{ t: s }] }; });
      var res = layoutChain({ paras: cp }, [{ id: "_tc", w: Math.max(1, w), h: 1e6 }], { ps: styles.ps, cs: styles.cs });
      curObjs = keepO; curNotes = keepN; curXr = keepX;
      var ls = res.frames._tc.lines, last = ls[ls.length - 1];
      return { lines: ls, h: last ? last.y + (last.d || 0) : 0 };
    }
    function placeTable(para, ps, tb) {
      var C = Math.min(30, tb.cols.length), R = Math.min(2000, tb.rows.length);
      var num = function (v, lo, hi, d) { v = Number(v); return isFinite(v) ? Math.max(lo, Math.min(hi, v)) : d; };
      var pad = num(tb.pad, 0, 36, 4), bw = num(tb.bw, 0, 12, 0.5);
      var li = ps.li || 0, ri = ps.ri || 0, W = Math.max(10, geom.x1 - geom.x0 - li - ri);
      var ws = [], sum = 0, j, i;
      for (j = 0; j < C; j++) { ws.push(num(tb.cols[j], 0.05, 100, 1)); sum += ws[j]; }
      var cx = [0];
      for (j = 0; j < C; j++) cx.push(cx[j] + W * ws[j] / sum);
      var hdr = Math.max(0, Math.min(R - 1, Math.round(num(tb.hdr, 0, 20, 0))));
      var cps = typeof tb.cps === "string" && tb.cps ? tb.cps : para.ps, hps = typeof tb.hps === "string" && tb.hps ? tb.hps : cps;
      var rh = [], cells = [];
      for (i = 0; i < R; i++) { rh.push(num(tb.rows[i] && tb.rows[i].h, 0, 2000, 0)); cells.push([]); }
      for (i = 0; i < R; i++) {
        var row = tb.rows[i] && Array.isArray(tb.rows[i].c) ? tb.rows[i].c : [];
        for (j = 0; j < C; j++) {
          var c = row[j];
          if (!c || c.x) continue;
          var sp = Math.round(num(c.s, 1, C - j, 1)), rs = Math.round(num(c.r, 1, R - i, 1));
          var w = cx[j + sp] - cx[j], L = cellLines(typeof c.t === "string" ? c.t.slice(0, 4000) : "", i < hdr ? hps : cps, w - 2 * pad);
          cells[i].push({ j: j, s: sp, r: rs, w: w, L: L, f: typeof c.f === "string" ? c.f : "" });
          if (rs === 1) rh[i] = Math.max(rh[i], L.h + 2 * pad);
        }
      }
      // a span's text fits: its last row grows
      for (i = 0; i < R; i++) cells[i].forEach(function (cl) {
        if (cl.r < 2) return;
        var have = 0;
        for (var a = i; a < i + cl.r; a++) have += rh[a];
        if (cl.L.h + 2 * pad > have) rh[i + cl.r - 1] += cl.L.h + 2 * pad - have;
      });
      for (i = 0; i < R; i++) rh[i] = Math.max(rh[i], 2 * pad + 1);
      // blocks: rows that a span joins (the header is one block)
      var blocks = [], start = 0;
      while (start < R) {
        var end = start < hdr ? hdr - 1 : start;
        for (var k = start; k <= end; k++) cells[k].forEach(function (cl) { end = Math.max(end, k + cl.r - 1); });
        blocks.push([start, end]);
        start = end + 1;
      }
      var headB = hdr ? blocks[0] : null;
      function bh(b) { var h = 0; for (var a = b[0]; a <= b[1]; a++) h += rh[a]; return h; }
      function emit(b) {
        var tx = geom.x0 + li;
        for (var a = b[0]; a <= b[1]; a++) {
          var top = y, line = { col: col, frame: geom.f.id, y: y + rh[a], d: 0, h: rh[a], p: curPi, o0: 0, o1: 0, tr: a, runs: [], cx0: geom.x0, cx1: geom.x1, x0: tx, tb: { fills: [], rules: [] } };
          cells[a].forEach(function (cl) {
            var H = 0, X = tx + cx[cl.j];
            for (var q = a; q < a + cl.r; q++) H += rh[q];
            var fill = cl.f || (a < hdr && typeof tb.hf === "string" ? tb.hf : "");
            if (fill) line.tb.fills.push([X, top, cl.w, H, fill]);
            if (bw > 0) {
              var bc = typeof tb.bc === "string" && tb.bc ? tb.bc : "";
              line.tb.rules.push([X, top, X + cl.w, top, bc, bw], [X, top + H, X + cl.w, top + H, bc, bw], [X, top, X, top + H, bc, bw], [X + cl.w, top, X + cl.w, top + H, bc, bw]);
            }
            cl.L.lines.forEach(function (ln) {
              ln.runs.forEach(function (r) {
                var o = {};
                for (var kk in r) if (kk !== "o" && kk !== "n" && kk !== "p") o[kk] = r[kk];
                o.x = X + pad + r.x; o.y = top + pad + r.y;
                line.runs.push(o);
              });
            });
          });
          y += rh[a];
          out.frames[geom.f.id].lines.push(line);
        }
        colTop = false;
      }
      if (!colTop) {
        // below the line before (its descent), then the space before
        var prev = out.frames[geom.f.id].lines, pl = prev[prev.length - 1];
        y += ps.sb + (pl && pl.col === col && !pl.tb ? pl.d || 0 : 0);
      }
      for (var bi = 0; bi < blocks.length; bi++) {
        var b = blocks[bi], need = bh(b);
        if (y + need > geom.bottom - footRoom() + 0.01 && !colTop) {
          if (!nextCol()) return false;
          if (headB && bi > 0 && tb.rep !== 0) emit(headB);
        }
        emit(b);
      }
      y += ps.sa || 0;
      return true;
    }
    function place(para, ps, opt) {
      var toks = tokenize(para, ps, csMap);
      curLen = toks.len;
      if (ps.bul) toks.unshift({ k: "bul", a: runAttrs(ps, {}, {}) });
      else if (labels[curPi]) toks.unshift({ k: "bul", a: runAttrs(ps, {}, {}), label: labels[curPi] });
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
      if (nps.brk || (next.ext && BRK[next.ext.brk])) return true;
      var key = fontKey(nps.font, nps.b, nps.i), lead = leadOf(nps, nps.size);
      var base = y + nps.sb + lead + lead * ((nps.orph || 1) - 1);
      return base + descent(key, nps.size) <= geom.bottom - footRoom() + 0.01;
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
      if (hangBul && hangBul.label) {
        // a list's number (LY-W7): it hangs in the left indent, which
        // grows to hold it and a space
        bulletW = measure(hangBul.a.key, hangBul.label, hangBul.a.size, 0);
        var gapL = hangBul.a.size * 0.5;
        if (li < bulletW + gapL) li = bulletW + gapL;
      } else if (hangBul) {
        bulletW = measure(hangBul.a.key, "•", hangBul.a.size, 0);
        if (li < bulletW * 2) li = bulletW * 2.2;
      }
      // a drop cap (LY-W6): its letters leave the first word and sink
      // through the first n lines, which make room for them
      var dc = hangBul ? null : dropCap(toks, ps), dcLine = null;
      var empty = toks.length === 0;
      // all its words smaller than the style: their size sets the metrics
      var wMax = wordsMaxSize(toks), size0 = wMax > 0 && wMax < ps.size ? wMax : ps.size;
      var wKey = geom.f.sfit ? wordsKey(toks) : "";
      // the paragraph composer (LY-W6): where its lines end, worked out
      // for the whole paragraph and redone from wherever a line ends
      // elsewhere (a wrap, a narrower column)
      var usePlan = (ps.comp === "p" || ps.bal) && !geom.f.sfit && toks.length > 2, plan = null;
      function liAt(k) { return li + (dc && k < dc.n ? dc.w : 0); }
      function stopFor(at) {
        if (!usePlan) return -1;
        if (!plan || plan[at] === undefined) {
          var cw = geom.x1 - geom.x0 - ps.ri;
          plan = kpPlan(toks, at, function (k) { var n = done + k; return Math.max(1, cw - liAt(n) - (n === 0 && !dc ? ps.fi : 0)); }, ps, geom.f.ctx || {});
          if (!plan) { usePlan = false; return -1; }
        }
        return plan[at];
      }
      while (ti < toks.length || empty) {
        if (opt.breakAt && done === opt.breakAt) { if (!nextCol()) return false; opt.breakAt = 0; }
        var stopAt = stopFor(ti);
        // line metrics guess: paragraph size, refined by the line's
        // biggest size after a first fill
        var maxSize = size0, objH = 0, wasTop = colTop;
        for (var pass = 0; pass < 3; pass++) {
          var lead = leadOf(ps, maxSize);
          var keyA = wKey || fontKey(ps.font, ps.b, ps.i);
          var asc = ascent(keyA, maxSize), desc = descent(keyA, maxSize);
          // an anchored object taller than the line's ascent: the line
          // makes room above its baseline (W4b)
          if (objH > asc) { lead += objH - asc; asc = objH; }
          var placed = placeLine(ti, toks, ps, liAt(done), firstLine && !dc, asc, desc, lead, hangBul && firstLine ? hangBul : null, bulletW, stopAt);
          if (placed === false) return false;
          if (pass < 2 && (placed.objH || 0) > Math.max(objH, asc) + 0.001) { objH = placed.objH; if (placed.maxSize > maxSize) maxSize = placed.maxSize; continue; }
          if (placed.maxSize > maxSize + 0.001 && pass === 0) { maxSize = placed.maxSize; continue; }
          if (placed.next === ti && !empty) {
            // nothing fitted beside a wrap: nudge down, try again
            y = placed.y - lead + Math.max(1, lead / 4);
            colTop = false;
            break;
          }
          // footnotes referred to on this line go to the foot of this
          // column; the line moves on when they do not fit with it
          if (notes && notes.kind !== "end" && !footHere(placed, wasTop)) {
            if (!nextCol()) return false;
            break;
          }
          ti = placed.next;
          if (dc && !done) { dcLine = placed; placeCap(placed, dc, li, leadOf(ps, ps.size)); }
          commit(placed);
          firstLine = false;
          done++;
          break;
        }
        if (empty) break;
      }
      // a paragraph shorter than its drop cap: the next one starts below it
      if (dcLine && done < dc.n && dcLine.frame === geom.f.id && dcLine.col === col) {
        var capFoot = dcLine.y + leadOf(ps, ps.size) * (dc.n - 1);
        if (capFoot > y) y = capFoot;
      }
      // a line break that ends the paragraph leaves an empty line after
      // it, as in Scribus, InDesign and Word (LY-TAB)
      if (toks.length && toks[toks.length - 1].k === "br") {
        var keyT = fontKey(ps.font, ps.b, ps.i), lineT = placeLine(toks.length, toks, ps, li, false, ascent(keyT, size0), descent(keyT, size0), leadOf(ps, size0), null, bulletW);
        if (lineT === false) return false;
        commit(lineT);
        done++;
      }
      y += ps.sa;
      return true;
    }

    // Find room for one line starting at token ti; returns the line
    // (not yet committed) or false when no frame is left.
    function placeLine(ti, toks, ps, li, firstLine, asc, desc, lead, bul, bulletW, stopAt) {
      var guard = 0;
      while (guard++ < 4000) {
        // a one-line frame (text on a path, LY-TP) takes one line
        if (geom.f.one && !colTop) {
          if (!nextCol()) return false;
          continue;
        }
        var base = colTop ? y + asc : y + lead;
        // locked to the baseline grid: down to the next grid line (LY-W5b)
        var bg = ps.bl && geom.f.bgrid;
        if (bg) base = bg.o + Math.ceil((base - bg.o - 0.01) / bg.inc) * bg.inc;
        // the first line of a column needs its baseline inside, not its
        // descent: a one-line header or page number whose font is taller
        // here than in the program it came from still shows (LY-TAB)
        if (base + (colTop ? 0 : desc) > geom.bottom - footRoom() + 0.01) {
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
        return fill(ti, toks, ps, segs, base, asc, desc, lead, bul, bulletW, li, fx1 - fx0, stopAt === undefined ? -1 : stopAt);
      }
      return false;
    }

    // offset where a token starts (a bullet sits before offset 0)
    function tokO(tok) {
      if (!tok) return curLen;
      if (tok.o !== undefined) return tok.o;
      return tok.parts && tok.parts.length ? tok.parts[0].o : 0;
    }
    function fill(ti, toks, ps, segs, base, asc, desc, lead, bul, bulletW, li, fullW, stopAt) {
      var ctx = geom.f.ctx || {};
      // frame slack: a word may pass the edge by this much (Atelier's
      // boxes, sized to Canva's own narrower measure, CV-F3)
      var slk = geom.f.slack > 0 ? geom.f.slack : 0;
      var line = { col: col, frame: geom.f.id, y: base, d: desc, h: lead, runs: [], maxSize: 0, next: ti, base: base,
                   p: curPi, o0: tokO(toks[ti]), o1: curLen, cx0: geom.x0, cx1: geom.x1, x0: segs[0][0] };
      var broke = false;
      for (var si = 0; si < segs.length; si++) {
        var sx0 = segs[si][0], sx1 = segs[si][1], avail = sx1 - sx0;
        // does a line `lw` wide still fit? Scribus's frames (sfit) end a
        // line once its end, rounded up, reaches the column's right
        // edge rounded down, so the same words go on each line (LY-FIT)
        var over = geom.f.sfit ? function (lw) { return Math.ceil(sx0 + lw - 0.001) >= Math.floor(sx1 + 0.001); } : function (lw) { return lw > avail + 0.001 + slk; };
        var items = [], w = 0, spaces = 0, pendingSp = [], hyph = null, hyW = 0, lastTab = -1, spSum = 0;
        // justified with a minimum word spacing (LY-W6): spaces may give
        // up to (100 - min) % of their width for a line to fit
        var shrF = ps.align === "j" && ps.wsMin < 100 ? (100 - ps.wsMin) / 100 : 0;
        while (ti < toks.length) {
          var tk = toks[ti];
          if (tk.k === "br") { ti++; broke = true; break; }
          if (tk.k === "t") {
            // to the next stop, from the left indent (LY-TAB)
            var tSpW = 0, tNsp = 0;
            pendingSp.forEach(function (s) { if (s.k === "s") { tSpW += measure(s.a.key, " ", s.a.size, s.a.track); tNsp++; } });
            var at = sx0 - (geom.x0 + li) + w + tSpW, tw = tabStop(ps, at) - at;
            if (over(w + tSpW + tw) && items.length) break;
            items.push({ tok: tk, w: Math.max(0, tw), sp: pendingSp, spW: tSpW, nsp: tNsp, ti: ti, tab: 1 });
            w += tSpW + Math.max(0, tw); pendingSp = [];
            spaces = 0; lastTab = items.length - 1;
            ti++;
            continue;
          }
          if (tk.k === "s" || tk.k === "h") {
            if (items.length) pendingSp.push(tk);
            ti++;
            continue;
          }
          var spW = 0, nsp = 0;
          pendingSp.forEach(function (s) { if (s.k === "s") { spW += measure(s.a.key, " ", s.a.size, s.a.track); nsp++; } });
          var ww = wordWidth(tk, ctx);
          // the paragraph composer ends the line here
          if (stopAt >= 0 && ti === stopAt && items.length) {
            hyph = breakHyph(pendingSp);
            hyW = hyph && hyph.hy ? measure(hyph.a.key, "-", hyph.a.size, hyph.a.track) : 0;
            break;
          }
          var hangW = ps.opt ? hangRight(tk, ctx) : 0;
          if (over(w + spW + ww - (spSum + spW) * shrF - hangW)) {
            if (!items.length) {
              // too wide for a segment narrowed by a wrap: try the
              // next segment / line; wider than the column: split
              if (ww <= fullW + 0.001 + slk && avail < fullW - 0.001) break;
              var pieces = splitWord(tk, avail, ctx);
              if (pieces.length > 1) { toks.splice.apply(toks, [ti, 1].concat(pieces)); continue; }
              items.push({ tok: tk, w: ww, sp: [], spW: 0, nsp: 0, ti: ti }); w += ww; ti++;
              break;
            }
            // a break inside a word: its hyphen must fit too, else the
            // line ends one break earlier
            hyph = breakHyph(pendingSp);
            while (hyph && items.length > 1) {
              if (!over(w - spSum * shrF + (hyph.hy ? measure(hyph.a.key, "-", hyph.a.size, hyph.a.track) * (ps.opt ? 0 : 1) : 0))) break;
              var last = items.pop();
              w -= last.w + last.spW; spaces -= last.nsp; spSum -= last.spW; ti = last.ti;
              hyph = breakHyph(last.sp);
            }
            hyW = hyph && hyph.hy ? measure(hyph.a.key, "-", hyph.a.size, hyph.a.track) : 0;
            break;
          }
          items.push({ tok: tk, w: ww, sp: pendingSp, spW: spW, nsp: nsp, ti: ti });
          spaces += nsp; spSum += spW;
          w += spW + ww; pendingSp = [];
          ti++;
        }
        // optical margins (LY-W6): punctuation at the edges hangs out
        var hl = ps.opt && items.length && !items[0].tab ? hangLeft(items[0].tok, ctx) : 0;
        var hr0 = !ps.opt || !items.length ? 0 : hyph && hyph.hy ? hyW * HANG["-"] : items[items.length - 1].tab ? 0 : hangRight(items[items.length - 1].tok, ctx);
        // alignment within the segment
        var align = ps.align, extra = avail - w - hyW + hl + hr0, gapAdd = 0, lsAdd = 0, x = sx0 - hl;
        // justify every segment except the paragraph's end and a
        // forced break
        var justifyHere = align === "j" && !broke && ti < toks.length;
        if (align === "c") x += (extra - hl - hr0) / 2 + hl;
        else if (align === "r") x += extra;
        else if (justifyHere && spaces > 0 && (extra > 0 || shrF)) {
          gapAdd = extra / spaces;
          var spAvg = spSum / Math.max(1, spaces);
          if (gapAdd < -spAvg * shrF) gapAdd = -spAvg * shrF;
          // word spacing past its max: letter spacing takes up to its
          // max, the spaces the rest (as InDesign does)
          if (ps.wsMax && gapAdd > spAvg * (ps.wsMax - 100) / 100 && ps.lsMax) {
            var nch = 0;
            items.forEach(function (it) { if (!it.tab) it.tok.parts.forEach(function (pp) { if (pp.f !== "obj") nch += partText(pp, ctx).length; }); });
            if (nch > 1) {
              var room = (gapAdd - spAvg * (ps.wsMax - 100) / 100) * spaces;
              lsAdd = Math.min(room / nch, ps.lsMax * ps.size / 1000);
              gapAdd -= lsAdd * nch / spaces;
            }
          }
          var ratio = (spAvg + gapAdd) / spAvg * 100;
          line.ws = Math.round(ratio);
          if (ratio > (ps.wsMax || 133) + 0.5) line.hj = 1;
          else if (ratio < (ps.wsMin < 100 ? ps.wsMin : 80) - 0.5) line.hj = -1;
        }
        if (si === 0) line.x0 = x;
        if (bul && si === 0) {
          if (bul.label) line.runs.push({ x: geom.x0 + li - bulletW - bul.a.size * 0.5, y: base, t: bul.label, key: bul.a.key, size: bul.a.size, color: bul.a.color, u: 0, track: 0, w: bulletW, lbl: 1 });
          else line.runs.push({ x: Math.max(geom.x0, geom.x0 + li - bulletW * 2.2), y: base, t: "•", key: bul.a.key, size: bul.a.size, color: bul.a.color, u: 0, track: 0, w: bulletW });
          line.maxSize = Math.max(line.maxSize, bul.a.size);
        }
        items.forEach(function (it, k) {
          if (k > 0) x += (it.spW || 0) + (k > lastTab ? gapAdd * (it.nsp || 0) : 0);
          if (it.tab) {
            // the tab: a blank run, so the caret and a selection find it
            line.runs.push({ x: x, y: base, t: " ", key: it.tok.a.key, size: it.tok.a.size, color: it.tok.a.color, u: 0, track: 0, w: it.w, p: curPi, o: it.tok.o, n: 1, f: 0 });
            x += it.w;
            return;
          }
          it.tok.parts.forEach(function (p) {
            var txt = partText(p, ctx), pw = partWidth(p, ctx), trk = p.a.track || 0;
            if (lsAdd && p.f !== "obj" && txt.length) { trk += lsAdd * 1000 / p.a.size; pw += lsAdd * txt.length; }
            line.runs.push({ x: x, y: base - (p.a.rise || 0), t: txt, key: p.a.key, size: p.a.size, color: p.a.color, u: p.a.u ? 1 : 0, track: trk, w: pw, p: curPi, o: p.o, n: p.n, f: p.f ? 1 : 0 });
            if (p.f === "fn") line.runs[line.runs.length - 1].fn = p.fn;
            if (p.f === "xr") line.runs[line.runs.length - 1].xr = p.xr.to;
            if (p.a.kern) line.runs[line.runs.length - 1].kern = 1;
            if (p.f === "obj") {
              var ob = objBox(p);
              line.runs[line.runs.length - 1].obj = p.ob;
              if (ob) line.objH = Math.max(line.objH || 0, ob.h + (p.a.rise || 0));
              x += pw;
              return;
            }
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

    // the notes a line refers to, not placed yet: room for them at the
    // foot of this column, or false (the line has to move on; a line at
    // the top of a column keeps them anyway, so nothing is lost)
    function footHere(line, atTop) {
      var ids = [];
      line.runs.forEach(function (r) { if (r.fn && !fnDone[r.fn] && notes.text[r.fn] !== undefined && ids.indexOf(r.fn) < 0) ids.push(r.fn); });
      if (!ids.length) return true;
      var cw = geom.x1 - geom.x0, blocks = ids.map(function (id) { return noteBlock(notes, id, cw); });
      var need = blocks.reduce(function (a, b) { return a + b.h; }, 0), k = footKey(), F = foot[k];
      var room = geom.bottom - (F ? F.h : 0) - need - FN_SEP;
      if (line.y + line.d > room + 0.01 && !atTop) return false;
      if (!F) F = foot[k] = { f: geom.f, col: col, x0: geom.x0, cw: cw, bottom: geom.bottom, h: 0, blocks: [] };
      blocks.forEach(function (b) { F.blocks.push(b); F.h += b.h; });
      ids.forEach(function (id) { fnDone[id] = 1; });
      return true;
    }
    // the drop cap's run, at the start of the first line, its baseline
    // on the n-th line's
    function placeCap(line, dc, li, lead) {
      line.runs.unshift({ x: geom.x0 + li, y: line.y + lead * (dc.n - 1), t: dc.t, key: dc.a.key, size: dc.size, color: dc.a.color, u: 0, track: 0, w: dc.cw, p: curPi, o: dc.o, n: dc.nch, f: 0, dc: 1 });
      line.o0 = dc.o;
    }
    // The paragraph composer: Knuth and Plass's total fit over the
    // paragraph from token `from`, for lines widthAt(k) wide → { line
    // start token: next line's start token }, or null when it cannot
    // (tabs, too long, no way to set it) and the line-by-line one does.
    // Justified: spaces stretch to wsMax (133 % when unset) and shrink
    // to wsMin; ragged (left, centre, right): every line may fall short
    // and how short counts (with balanced ragged lines the last line
    // too, so a heading's lines come out even).
    function kpPlan(toks, from, widthAt, ps, ctx) {
      var n = toks.length;
      if (n - from > 3000) return null;
      var just = ps.align === "j", mx = (ps.wsMax || 133) - 100, mn = 100 - (ps.wsMin < 100 ? ps.wsMin : 100);
      var W = [0], Y = [0], Z = [0], i, tk;
      for (i = from; i < n; i++) {
        tk = toks[i];
        if (tk.k === "t" || tk.k === "bul") return null;
        var w = 0, y = 0, z = 0;
        if (tk.k === "w") w = wordWidth(tk, ctx);
        else if (tk.k === "s") { w = measure(tk.a.key, " ", tk.a.size, tk.a.track); y = w * mx / 100; z = w * mn / 100; }
        W.push(W[W.length - 1] + w); Y.push(Y[Y.length - 1] + y); Z.push(Z[Z.length - 1] + z);
      }
      function at(arr, k) { return arr[k - from]; }
      function nextWord(k) { while (k < n && toks[k].k !== "w" && toks[k].k !== "br") k++; return k; }
      // break candidates in order
      var cands = [];
      for (i = from + 1; i < n; i++) {
        tk = toks[i];
        if (tk.k === "s" && toks[i - 1].k === "w") cands.push({ i: i, next: nextWord(i + 1), pen: 0 });
        else if (tk.k === "h" && toks[i - 1].k === "w" && i + 1 < n && toks[i + 1].k === "w") cands.push({ i: i, next: i + 1, pen: tk.hy ? 100 : 0, hy: tk.hy ? 1 : 0, hw: tk.hy ? measure(tk.a.key, "-", tk.a.size, tk.a.track) : 0 });
        else if (tk.k === "br") cands.push({ i: i, next: i + 1, forced: 1 });
      }
      cands.push({ i: n, next: n, forced: 1, end: 1 });
      var active = [{ start: from, line: 0, total: 0, prev: null, hy: 0 }], last = null;
      for (var ci = 0; ci < cands.length; ci++) {
        var c = cands[ci], best = null, keep = [];
        for (var ai = 0; ai < active.length; ai++) {
          var a = active[ai];
          if (a.start >= c.i) { keep.push(a); continue; }
          var L = at(W, c.i) - at(W, a.start) + (c.hw || 0), width = widthAt(a.line);
          var st = at(Y, c.i) - at(Y, a.start), sh = at(Z, c.i) - at(Z, a.start), r;
          if (just && !c.forced) r = L < width ? (st > 0 ? (width - L) / st : 10) : L > width ? (sh > 0 ? (width - L) / sh : -10) : 0;
          else if (just) r = L <= width ? 0 : (sh > 0 ? (width - L) / sh : -10);
          // balanced: the last line counts too, so a heading's lines come out even
          else r = L <= width ? (c.forced && !(ps.bal && c.end) ? 0 : (width - L) / (width / 6)) : -10;
          if (r < -1) {
            // too long from here on: this start is done, unless nothing
            // else is left (one word wider than the line)
            if (active.length === 1 && !keep.length && !best) { r = -1; } else continue;
          }
          keep.push(a);
          // badness grows with the cube of how far the spaces go; not
          // capped, so a very loose line never ties with a merely loose one
          var bad = 100 * Math.pow(Math.min(Math.abs(r), 100), 3);
          var pen = just ? c.pen : c.pen / 5;
          var d = Math.pow(1 + bad, 2) + (pen ? pen * pen : 0) + (c.hy && a.hy ? 3000 : 0);
          var tot = a.total + d;
          if (!best || tot < best.total) best = { start: c.next, line: a.line + 1, total: tot, prev: a, hy: c.hy ? 1 : 0, cand: c };
        }
        active = keep;
        if (c.forced) active = [];
        if (best) { active.push(best); if (c.end) last = best; }
        if (!active.length && !c.end) return null;
      }
      if (!last) return null;
      var starts = [];
      for (var nd = last; nd && nd.prev; nd = nd.prev) starts.unshift([nd.prev.start, nd.start]);
      var plan = {};
      starts.forEach(function (x) { plan[x[0]] = x[1]; });
      return plan;
    }

    // the break before the next word, when it is inside a word (only
    // break opportunities, no space, since the last word)
    function breakHyph(sp) {
      if (!sp.length) return null;
      for (var k = 0; k < sp.length; k++) if (sp[k].k === "s") return null;
      return sp[sp.length - 1];
    }
    function commit(line) {
      delete line.maxSize; delete line.next; delete line.base; delete line.objH;
      // an endnote's line: not the story's text (the caret and the
      // Story Editor leave it alone)
      if (curPi >= realN) { line.fn = 1; line.runs.forEach(function (r) { delete r.o; delete r.n; }); }
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
      // a table (LY-W12): its cells, tab-separated, row by row
      var tb = p.ext && p.ext.tbl;
      if (tb && Array.isArray(tb.rows)) return tb.rows.map(function (r) { return (r && r.c || []).filter(function (c) { return c && !c.x; }).map(function (c) { return String(c.t || "").replace(/\n/g, " "); }).join("\t"); }).join("\n");
      return (p.runs || []).map(function (r) { return r.ext && r.ext.del ? "" : r.f ? (r.f === "pn" ? "#" : "##") : String(r.t || ""); }).join("");
    }).join("\n");
  }

  var api = {
    FAMILIES: FAMILIES, FAMILY_IDS: FAMILY_IDS, DEFAULT_PS: DEFAULT_PS, PS_KEYS: PS_KEYS, CS_KEYS: CS_KEYS,
    fontKey: fontKey, fontFile: fontFile, cssFamily: cssFamily, cssStack: cssStack, fallbackKey: fallbackKey, allKeys: allKeys, FAM_RE: FAM_RE, kernPair: kernPair,
    registerFamily: registerFamily, setFetcher: setFetcher, generation: generation, unicodeRange: unicodeRange,
    parseTTF: parseTTF, register: register, load: load, isLoaded: isLoaded, setBaseUrl: setBaseUrl,
    fontBase64: fontBase64, faceParts: faceParts, metrics: metrics, measure: measure, ascent: ascent, descent: descent,
    resolvePs: resolvePs, resolveCs: resolveCs, runAttrs: runAttrs, byId: byId,
    nestRuns: nestRuns, grepRuns: function (runs, rules) { var g = grepOf(rules); return g ? cutRuns(runs, grepCuts(textOfRuns(runs), g)) : runs; }, layoutChain: layoutChain, freeSegments: freeSegments, missingGlyphs: missingGlyphs, collate: collate, sortKey: sortKey, plainText: plainText, hasText: hasText, hyphenGreek: hyphenGreek,
    LIST_FORMATS: Object.keys(LIST_FMT), listLabel: listLabel, listLabels: listLabels, notesOf: notesOf, greekNum: greekNum
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else { root.orosDK = root.orosDK || {}; root.orosDK.text = api; }
})(typeof window !== "undefined" ? window : this);
