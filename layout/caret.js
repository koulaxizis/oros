// ============================================================
// orOS Layout — caret geometry for in-frame text editing (v1.0.0)
// Pure functions over the typeset lines of designkit/text.js (every
// line and run carries its paragraph and character offsets):
//   - flow(doc, L, sid): the story's lines in reading order
//   - locate(lines, pos): caret box (frame, x, top, bottom, line)
//   - hit(lines, fid, x, y): the position nearest a frame point
//   - lineMove / lineEdge: Up / Down, Home / End
//   - word(paras, pos): the word around a position
// Positions are { p: paragraph index, o: character offset } in the
// story's character space (a field counts one character).
// Exposes LY_CARET (browser) or module.exports (Node tests).
// ============================================================
(function (root) {
  "use strict";

  var M, T;
  if (typeof module !== "undefined" && module.exports) { M = require("../designkit/model.js"); T = require("../designkit/text.js"); }
  else { M = root.orosDK.model; T = root.orosDK.text; }

  // The lines of a story, frame by frame along its thread, each
  // { fid, ln }.
  function flow(doc, L, sid) {
    var out = [];
    M.chain(doc, sid).forEach(function (f) {
      var fr = L && L.frames ? L.frames[f.id] : null;
      if (!fr) return;
      fr.lines.forEach(function (ln) { out.push({ fid: f.id, ln: ln }); });
    });
    return out;
  }

  function textRuns(ln) { return ln.runs.filter(function (r) { return r.o !== undefined; }); }
  function xIn(r, k) {
    if (k <= 0) return r.x;
    if (r.f || k >= r.n) return r.x + r.w;
    return r.x + T.measure(r.key, r.t.slice(0, k), r.size, r.track);
  }
  // x of offset o on a line (o0 ≤ o ≤ o1)
  function xOf(ln, o) {
    var rs = textRuns(ln), prev = null;
    for (var i = 0; i < rs.length; i++) {
      var r = rs[i];
      if (o >= r.o && o < r.o + r.n) return xIn(r, o - r.o);
      if (o < r.o) {
        // in the gap before r: after the previous run, or the line start
        if (!prev) return r.x;
        var sp = T.measure(prev.key, " ", prev.size, prev.track);
        return Math.min(r.x, prev.x + prev.w + (o - prev.o - prev.n) * sp);
      }
      prev = r;
    }
    if (!prev) return ln.x0 !== undefined ? ln.x0 : (ln.cx0 || 0);
    var sp2 = T.measure(prev.key, " ", prev.size, prev.track);
    return prev.x + prev.w + Math.max(0, o - prev.o - prev.n) * sp2;
  }
  function box(ln) { return { top: ln.y - Math.max(ln.h - ln.d, ln.d), bottom: ln.y + ln.d }; }

  // Index of the line that shows pos (−1 when it is overset).
  function lineIndex(lines, pos) {
    var cand = -1;
    for (var i = 0; i < lines.length; i++) {
      var ln = lines[i].ln;
      if (ln.p !== pos.p) { if (cand >= 0) break; continue; }
      if (pos.o >= ln.o0 && pos.o <= ln.o1) {
        cand = i;
        if (pos.o < ln.o1) return i;
      }
    }
    return cand;
  }
  function locate(lines, pos) {
    var i = lineIndex(lines, pos);
    if (i < 0) return null;
    var ln = lines[i].ln, b = box(ln);
    return { i: i, fid: lines[i].fid, x: xOf(ln, pos.o), y: ln.y, top: b.top, bottom: b.bottom };
  }

  // Does the paragraph go on after line i? Then its end offset
  // belongs to the next line.
  function wraps(lines, i) { return !!lines[i + 1] && lines[i + 1].ln.p === lines[i].ln.p; }
  function nearestOnLine(lines, i, x) {
    var ln = lines[i].ln, best = ln.o0, bd = Infinity;
    var last = wraps(lines, i) ? Math.max(ln.o0, ln.o1 - 1) : ln.o1;
    for (var o = ln.o0; o <= last; o++) {
      var d = Math.abs(xOf(ln, o) - x);
      if (d < bd) { bd = d; best = o; }
    }
    return best;
  }
  // Nearest position to a point inside frame fid (frame-local pt).
  function hit(lines, fid, x, y) {
    var mine = [];
    lines.forEach(function (l, i) { if (l.fid === fid) mine.push(i); });
    if (!mine.length) return null;
    // the column under x, then the line under y
    var bestI = -1, bestD = Infinity;
    mine.forEach(function (i) {
      var ln = lines[i].ln, b = box(ln);
      var dx = x < ln.cx0 ? ln.cx0 - x : x > ln.cx1 ? x - ln.cx1 : 0;
      var dy = y < b.top ? b.top - y : y > b.bottom ? y - b.bottom : 0;
      var d = dx * 1000 + dy;
      if (d < bestD) { bestD = d; bestI = i; }
    });
    return { p: lines[bestI].ln.p, o: nearestOnLine(lines, bestI, x) };
  }

  // Up (dir −1) / Down (+1) keeping the goal x; null at the ends.
  function lineMove(lines, pos, dir, goalX) {
    var i = lineIndex(lines, pos);
    if (i < 0) return null;
    var j = i + dir;
    if (j < 0 || j >= lines.length) return null;
    return { p: lines[j].ln.p, o: nearestOnLine(lines, j, goalX) };
  }
  // Home (−1) / End (+1) of the caret's line.
  function lineEdge(lines, pos, dir) {
    var i = lineIndex(lines, pos);
    if (i < 0) return pos;
    var ln = lines[i].ln;
    if (dir < 0) return { p: ln.p, o: ln.o0 };
    // End stops before the space (or line break) the line wraps at; a
    // word split across lines has none
    var rs = textRuns(ln), lr = rs[rs.length - 1], o = ln.o1;
    if (wraps(lines, i) && (!lr || lr.o + lr.n < o)) o -= 1;
    return { p: ln.p, o: Math.max(ln.o0, o) };
  }

  // Plain text of one paragraph (fields as U+FFFC, one character).
  function paraText(p) {
    return (p.runs || []).map(function (r) { return r.f ? "\uFFFC" : String(r.t || ""); }).join("");
  }
  var WORD = /[0-9A-Za-z_'’\-\u00C0-\u024F\u0370-\u03FF\u0400-\u04FF\u1F00-\u1FFF]/;
  function word(paras, pos) {
    var s = paraText(paras[pos.p] || { runs: [] }), a = pos.o, b = pos.o;
    while (a > 0 && WORD.test(s[a - 1])) a--;
    while (b < s.length && WORD.test(s[b])) b++;
    if (a === b && b < s.length) b++;
    return { a: { p: pos.p, o: a }, b: { p: pos.p, o: b } };
  }
  // One step left (−1) / right (+1) through the story; by word with
  // Ctrl/Alt.
  function step(paras, pos, dir, byWord) {
    var len = paraText(paras[pos.p]).length;
    if (dir < 0 && pos.o === 0) return pos.p > 0 ? { p: pos.p - 1, o: paraText(paras[pos.p - 1]).length } : pos;
    if (dir > 0 && pos.o >= len) return pos.p < paras.length - 1 ? { p: pos.p + 1, o: 0 } : pos;
    if (!byWord) return { p: pos.p, o: pos.o + dir };
    var s = paraText(paras[pos.p]), o = pos.o;
    if (dir > 0) { while (o < len && !WORD.test(s[o])) o++; while (o < len && WORD.test(s[o])) o++; }
    else { while (o > 0 && !WORD.test(s[o - 1])) o--; while (o > 0 && WORD.test(s[o - 1])) o--; }
    return { p: pos.p, o: o };
  }
  function cmp(a, b) { return a.p - b.p || a.o - b.o; }

  var api = { flow: flow, locate: locate, hit: hit, lineMove: lineMove, lineEdge: lineEdge, word: word, step: step, cmp: cmp, xOf: xOf, paraText: paraText };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.LY_CARET = api;
})(typeof window !== "undefined" ? window : this);
