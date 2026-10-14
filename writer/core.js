// ============================================================
// orOS Writer — core (pure logic, no DOM)
// Loaded by writer.js (window.WriterCore) and by tests/writer-core.test.js.
//   · textStats: words, characters (with / without spaces),
//     paragraphs, sentences, reading and speaking time
//   · sentenceRanges / sentenceAt: sentence bounds for Focus mode
//   · breakLines / alignLine: line breaking + alignment for the PDF
//   · colWidths / fitBox: table columns and image size in the PDF
//   · centerDelta: typewriter scrolling
// ============================================================
(function (root) {
  "use strict";

  var WORD_RE = /[\p{L}\p{N}]/u;
  var SPACE_RE = /\s/;
  var CLOSERS = "\"'”’»)]}";
  var READ_WPM = 230;     // silent reading, adult average
  var SPEAK_WPM = 130;    // reading aloud

  function terms(lang) {
    // Greek question mark: ";" (U+003B as typed) and U+037E
    return lang === "el" ? ".!?…;;" : ".!?…";
  }

  function countWords(text) {
    var parts = String(text || "").trim().split(/\s+/), n = 0;
    for (var i = 0; i < parts.length; i++) if (parts[i] && WORD_RE.test(parts[i])) n++;
    return n;
  }

  // Sentences of one text: [{s, e}] (e exclusive, no outer spaces).
  // A sentence ends at . ! ? … (and ; in Greek) followed by a space or
  // the end (so 3.14 and e.g.x stay whole), or at a line break.
  function sentenceRanges(text, lang) {
    text = String(text || "");
    var T = terms(lang), out = [], start = -1, n = text.length;
    function close(end) {
      while (end > start && SPACE_RE.test(text[end - 1])) end--;
      if (end > start) out.push({ s: start, e: end });
      start = -1;
    }
    for (var i = 0; i < n; i++) {
      var ch = text[i];
      if (ch === "\n") { if (start >= 0) close(i); continue; }
      if (start < 0) { if (SPACE_RE.test(ch)) continue; start = i; }
      if (T.indexOf(ch) >= 0) {
        var j = i + 1;
        while (j < n && (T.indexOf(text[j]) >= 0 || CLOSERS.indexOf(text[j]) >= 0)) j++;
        if (j >= n || SPACE_RE.test(text[j])) { close(j); i = j - 1; }
      }
    }
    if (start >= 0) close(n);
    return out;
  }

  // The sentence holding the caret: the first one that ends at or after
  // it (a caret in the gap between two sentences belongs to the next).
  function sentenceAt(text, offset, lang) {
    var r = sentenceRanges(text, lang);
    if (!r.length) return null;
    for (var i = 0; i < r.length; i++) if (offset <= r[i].e) return r[i];
    return r[r.length - 1];
  }

  function countSentences(text, lang) {
    var r = sentenceRanges(text, lang), n = 0;
    for (var i = 0; i < r.length; i++) if (WORD_RE.test(text.slice(r[i].s, r[i].e))) n++;
    return n;
  }

  // text: one line per block (paragraph, heading, list item, cell…).
  function textStats(text, lang) {
    text = String(text || "").replace(/\r\n?/g, "\n").replace(/ /g, " ");
    var lines = text.split("\n"), chars = 0, noSp = 0, paras = 0;
    for (var i = 0; i < lines.length; i++) {
      var cps = Array.from(lines[i]);
      chars += cps.length;
      for (var k = 0; k < cps.length; k++) if (!SPACE_RE.test(cps[k])) noSp++;
      if (WORD_RE.test(lines[i])) paras++;
    }
    var words = countWords(text);
    return {
      words: words, chars: chars, charsNoSpaces: noSp, paragraphs: paras,
      sentences: countSentences(text, lang),
      readMin: words / READ_WPM, speakMin: words / SPEAK_WPM
    };
  }

  // Minutes → { lt1 } under 30 s, else whole minutes (≥ 1).
  function roundMinutes(min) {
    if (!(min > 0) || min < 0.5) return { lt1: true, n: 0 };
    return { lt1: false, n: Math.max(1, Math.round(min)) };
  }

  // Line breaking. tokens: [{w, sp, br}] — w width; sp = a space comes
  // before it (tokens without sp stick to the previous one: "bold" + ","
  // never split); br = forced line break. Returns lines
  // [{from, to, w, gaps, hard}] (to exclusive; w includes the spaces;
  // gaps = spaces in the line; hard = ended by a break, or the last).
  function breakLines(tokens, maxW, spaceW) {
    var lines = [], i = 0, n = tokens.length;
    var cur = null;
    function open(at) { cur = { from: at, to: at, w: 0, gaps: 0, hard: false }; }
    function push(hard) { cur.hard = hard; lines.push(cur); cur = null; }
    open(0);
    while (i < n) {
      var tk = tokens[i];
      if (tk.br) {
        cur.to = i; push(true); i++; open(i);
        continue;
      }
      // a cluster: this token and the ones glued to it
      var j = i + 1, cw = tk.w || 0;
      while (j < n && !tokens[j].br && !tokens[j].sp) { cw += tokens[j].w || 0; j++; }
      var empty = cur.to === cur.from;
      var add = empty ? cw : spaceW + cw;
      if (!empty && cur.w + add > maxW + 1e-6) {
        push(false); open(i); add = cw; empty = true;
      }
      if (!empty) cur.gaps++;
      cur.w += add; cur.to = j; i = j;
    }
    // a trailing break draws no extra empty line (as in HTML)
    if (cur.to > cur.from || !lines.length) push(true);
    return lines;
  }

  // { x: offset of the line, extra: added to each space } for an alignment.
  function alignLine(line, maxW, align) {
    var free = Math.max(0, maxW - line.w);
    if (align === "center") return { x: free / 2, extra: 0 };
    if (align === "right") return { x: free, extra: 0 };
    if (align === "justify" && !line.hard && line.gaps > 0) return { x: 0, extra: free / line.gaps };
    return { x: 0, extra: 0 };
  }

  // Column widths from the longest text of each column (a short column
  // stays narrow, a long one gets more room), summing to total; each at
  // least minW when there is room for that.
  function colWidths(lens, total, minW) {
    var n = lens.length;
    if (!n) return [];
    var wts = lens.map(function (l) { return Math.sqrt(Math.max(3, Math.min(60, l || 0))); });
    var sum = wts.reduce(function (a, b) { return a + b; }, 0);
    var w = wts.map(function (x) { return total * x / sum; });
    if (minW * n <= total) {
      var short = 0, rest = 0;
      w.forEach(function (x) { if (x < minW) short += minW - x; else rest += x - minW; });
      if (short > 0) w = w.map(function (x) { return x < minW ? minW : x - short * (x - minW) / rest; });
    }
    return w;
  }

  // Image box in mm: natural size at 96 dpi, shrunk to fit maxW × maxH.
  function fitBox(pxW, pxH, maxW, maxH) {
    var MM = 25.4 / 96;
    var w = Math.max(1, pxW || 1) * MM, h = Math.max(1, pxH || 1) * MM;
    var k = Math.min(1, maxW / w, maxH / h);
    return { w: w * k, h: h * k };
  }

  // Pixels to scroll so the caret line sits in the middle of the view
  // (0 when it is already within a few pixels of it).
  function centerDelta(caretMid, viewTop, viewH) {
    var d = caretMid - (viewTop + viewH / 2);
    return Math.abs(d) < 4 ? 0 : Math.round(d);
  }

  var api = {
    countWords: countWords, sentenceRanges: sentenceRanges, sentenceAt: sentenceAt,
    countSentences: countSentences, textStats: textStats, roundMinutes: roundMinutes,
    breakLines: breakLines, alignLine: alignLine, colWidths: colWidths, fitBox: fitBox,
    centerDelta: centerDelta,
    READ_WPM: READ_WPM, SPEAK_WPM: SPEAK_WPM
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.WriterCore = api;
})(typeof window !== "undefined" ? window : this);
