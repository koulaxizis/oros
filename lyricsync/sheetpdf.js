// ============================================================
// orOS Lyric Sync — sheetpdf.js (Songbook S3)
// Song sheets as PDF: one song, or a whole set with a cover page that
// lists its songs. Chords in bold above the words, placed by the width
// of the words before them; long lines wrap at a space and their chords
// go with their words; sections, notes, chord-only rows and tabs (in a
// monospaced face). A4 or Letter, one or two columns, a font size.
// Each song starts on a new page.
//
// layout(songs, opts) is pure: it takes a measure(text, face, size) → pt
// and gives pages of placed text, so the tests run in Node. render()
// draws those pages with jsPDF (vendor/jspdf.umd.min.js) in the Noto
// faces (vendor/noto: Latin, Greek and polytonic), embedded in the file.
// Words only through jsPDF text, never as markup.
// Exposes LyricsyncSheetPdf (browser) or module.exports (Node).
// i18n-inline-ok: no UI words here; labels come in opts.words.
// ============================================================
(function (root) {
  "use strict";

  var H = typeof module !== "undefined" && module.exports ? require("./chords.js") : root.LyricsyncChords;

  var PAGES = { a4: [595.28, 841.89], letter: [612, 792] };
  var MARGIN = 48, COL_GAP = 24;
  var FONTS = { r: "NotoSans-Regular.ttf", b: "NotoSans-Bold.ttf", m: "NotoSansMono-Regular.ttf" };

  // ---------- Layout (pure) ----------
  function layout(songs, opts) {
    opts = opts || {};
    var size = Math.max(8, Math.min(20, +opts.size || 11));
    var pg = PAGES[opts.page] || PAGES.a4, W = pg[0], Hh = pg[1];
    var cols = opts.cols === 2 ? 2 : 1;
    var colW = (W - 2 * MARGIN - (cols - 1) * COL_GAP) / cols;
    var sol = !!opts.solfege, words = opts.words || {};
    var measure = opts.measure;
    var lh = size * 1.3;                 // one text line
    var pages = [], page = null, col = 0, y = 0;

    function newPage() { page = { items: [] }; pages.push(page); col = 0; y = MARGIN; }
    function colX() { return MARGIN + col * (colW + COL_GAP); }
    function room(h) {
      if (y + h <= Hh - MARGIN) return;
      if (col + 1 < cols) { col++; y = MARGIN; }
      else newPage();
    }
    function put(t, x, face, sz) { page.items.push({ t: t, x: x, y: y, f: face, s: sz }); }
    function text(t, face, sz, gapAfter) {
      // A plain paragraph, wrapped at spaces to the column.
      wrapPlain(t, face, sz).forEach(function (part) {
        room(sz * 1.3);
        put(part, colX(), face, sz);
        y += sz * 1.3;
      });
      y += gapAfter || 0;
    }
    function wrapPlain(t, face, sz) {
      var out = [];
      String(t).split("\n").forEach(function (para) {
        var cur = "";
        para.split(/(\s+)/).forEach(function (bit) {
          if (!bit) return;
          var next = cur + bit;
          if (cur && /\S/.test(bit) && measure(next, face, sz) > colW) { out.push(cur.replace(/\s+$/, "")); cur = bit; }
          else cur = next;
        });
        out.push(cur.replace(/\s+$/, ""));
      });
      return out;
    }
    // A line of words with chords: pieces that fit the column, each with
    // its own chords (offsets inside the piece).
    function pieces(t, c) {
      var out = [], start = 0;
      while (start < t.length || !out.length) {
        var end = t.length;
        if (measure(t.slice(start), "r", size) > colW) {
          var best = -1;
          for (var k = start + 1; k < t.length; k++) {
            if (t.charAt(k) === " " && measure(t.slice(start, k), "r", size) <= colW) best = k;
            else if (best >= 0 && measure(t.slice(start, k), "r", size) > colW) break;
          }
          end = best > start ? best : t.length;
        }
        var last = end >= t.length;
        out.push({ t: t.slice(start, end), c: (c || []).filter(function (x) { return x[0] >= start && (last ? x[0] <= t.length : x[0] < end); })
          .map(function (x) { return [x[0] - start, x[1]]; }) });
        start = end;
        while (t.charAt(start) === " ") start++;
        if (last) break;
      }
      return out;
    }
    function chordLine(t, c) {
      // Chords at the width of the words before them, never on top of
      // each other.
      var x0 = colX(), minX = x0, out = [];
      c.forEach(function (x) {
        var name = H.show(x[1], sol);
        var at = Math.max(x0 + measure(t.slice(0, x[0]), "r", size), minX);
        out.push({ t: name, x: at });
        minX = at + measure(name + " ", "b", size);
      });
      return out;
    }
    function lyricLine(l) {
      var show = opts.show || "both";
      pieces(l.t, l.c).forEach(function (pc) {
        var hasC = pc.c.length && show !== "words";
        var hasW = pc.t && show !== "chords";
        var h = (hasC ? lh : 0) + (hasW ? lh : 0);
        if (!h) return;
        room(h);
        if (hasC) { chordLine(pc.t, pc.c).forEach(function (ch) { put(ch.t, ch.x, "b", size); }); y += lh; }
        if (hasW) { put(pc.t, colX(), "r", size); y += lh; }
      });
    }
    function gap() { y += lh * 0.6; }
    function label(k) { room(lh * 2); text(words["sec." + k] || k, "b", size * 0.85); }
    function row(r) {
      if (r.p) gap();
      if (r.k) label(r.k);
      if (r.m) text(r.t, "r", size * 0.9);
      else if (r.tb) { if (opts.show !== "words") r.t.split("\n").forEach(function (x) { room(lh); put(x, colX(), "m", size * 0.85); y += lh; }); }
      else if (opts.show !== "words") { room(lh); put(H.rowPlain(r, sol), colX(), "b", size); y += lh; }
    }

    // A set: the cover page with its list.
    if (opts.cover) {
      newPage();
      var cv = opts.cover;
      y = MARGIN + 40;
      text(cv.title || "", "b", size * 2.2, size);
      if (cv.sub) text(cv.sub, "r", size * 1.1, size * 0.5);
      if (cv.note) text(cv.note, "r", size, size);
      y += size;
      (cv.list || []).forEach(function (x, n) { text((n + 1) + ". " + x, "r", size * 1.15, size * 0.3); });
    }

    songs.forEach(function (p) {
      newPage();
      text(p.name || words.untitled || "", "b", size * 1.7, size * 0.2);
      var sub = [p.ar, p.al].filter(Boolean).join(" · ");
      if (sub) text(sub, "r", size, 0);
      if (p.info) text(p.info, "r", size * 0.9, 0);
      if (p.nt) text(p.nt, "r", size * 0.9, 0);
      y += lh;
      var first = true;
      (p.ln || []).forEach(function (l) {
        var rp = (l.x || []).some(function (r) { return r.p; });
        (l.x || []).forEach(function (r) { if (first) r = Object.assign({}, r, { p: 0 }); row(r); first = false; });
        if (l.p && (!rp || l.q) && !first) gap();
        if (l.k) label(l.k);
        lyricLine(l);
        first = false;
      });
      (p.xo || []).forEach(row);
    });
    if (!pages.length) newPage();
    return { w: W, h: Hh, pages: pages };
  }

  // ---------- Drawing (browser) ----------
  var fontsP = null;
  function b64(buf) {
    var bytes = new Uint8Array(buf), s = "", CH = 0x8000;
    for (var i = 0; i < bytes.length; i += CH) s += String.fromCharCode.apply(null, bytes.subarray(i, i + CH));
    return btoa(s);
  }
  function loadFonts(base) {
    if (fontsP) return fontsP;
    var keys = Object.keys(FONTS);
    fontsP = Promise.all(keys.map(function (k) {
      return fetch(base + FONTS[k]).then(function (r) { if (!r.ok) throw new Error("font"); return r.arrayBuffer(); });
    })).then(function (bufs) { var o = {}; keys.forEach(function (k, i) { o[k] = b64(bufs[i]); }); return o; });
    fontsP.catch(function () { fontsP = null; });
    return fontsP;
  }
  var jspdfP = null;
  function loadJsPdf(src) {
    if (root.jspdf && root.jspdf.jsPDF) return Promise.resolve(root.jspdf.jsPDF);
    if (jspdfP) return jspdfP;
    jspdfP = new Promise(function (res, rej) {
      var s = document.createElement("script");
      s.src = src;
      s.onload = function () { if (root.jspdf && root.jspdf.jsPDF) res(root.jspdf.jsPDF); else rej(new Error("jspdf")); };
      s.onerror = function () { rej(new Error("jspdf")); };
      document.head.appendChild(s);
    });
    jspdfP.catch(function () { jspdfP = null; });
    return jspdfP;
  }
  var NAMES = { r: ["NotoSans", "normal"], b: ["NotoSans", "bold"], m: ["NotoSansMono", "normal"] };
  // → Promise of a Blob (application/pdf).
  function render(songs, opts) {
    var base = opts.fontBase || "../vendor/noto/";
    return Promise.all([loadJsPdf(opts.jspdf || "../vendor/jspdf.umd.min.js"), loadFonts(base)]).then(function (r) {
      var JsPDF = r[0], f = r[1];
      var pg = PAGES[opts.page] || PAGES.a4;
      var doc = new JsPDF({ unit: "pt", format: [pg[0], pg[1]], compress: true });
      doc.addFileToVFS(FONTS.r, f.r); doc.addFont(FONTS.r, "NotoSans", "normal");
      doc.addFileToVFS(FONTS.b, f.b); doc.addFont(FONTS.b, "NotoSans", "bold");
      doc.addFileToVFS(FONTS.m, f.m); doc.addFont(FONTS.m, "NotoSansMono", "normal");
      var measure = function (t, face, sz) {
        doc.setFont(NAMES[face][0], NAMES[face][1]);
        doc.setFontSize(sz);
        return doc.getTextWidth(String(t));
      };
      var lay = layout(songs, Object.assign({}, opts, { measure: measure }));
      if (opts.title) doc.setProperties({ title: String(opts.title).slice(0, 200), creator: "orOS Lyric Sync" });
      lay.pages.forEach(function (p, i) {
        if (i) doc.addPage([pg[0], pg[1]]);
        p.items.forEach(function (it) {
          if (!it.t) return;
          doc.setFont(NAMES[it.f][0], NAMES[it.f][1]);
          doc.setFontSize(it.s);
          doc.text(String(it.t), it.x, it.y, { baseline: "top" });
        });
      });
      return doc.output("blob");
    });
  }

  var API = { layout: layout, render: render, PAGES: PAGES };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  else root.LyricsyncSheetPdf = API;
})(typeof window !== "undefined" ? window : globalThis);
