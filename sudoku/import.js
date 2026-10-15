// ============================================================
// orOS Sudoku — import.js ("Import puzzle", v1.0.0)
// Reads sudoku puzzles from pasted text or a file and keeps them in
// the synced library of imported puzzles. Pure: no DOM, no storage;
// sudoku.js runs the paste box, the picker, the preview, the one
// write and the Undo.
//
// Formats (one reader, no format switch needed):
//   line      81 characters per line: digits 1–9 given, 0 . - _ * x
//             blank; spaces, | and + inside the line are ignored and
//             anything after the 81st cell (a name, a rating) too.
//             Many lines = many puzzles (up to MAX_PUZZLES).
//   grid      9 lines of 9 cells (Simple Sudoku .ss, Project Euler,
//             printed grids): separator lines such as "---+---+---" or
//             "-----------" are skipped; a line of 9 dashes is a row of
//             blanks.
//   sdk       SadMan Sudoku .sdk: "#" lines are metadata (#D becomes
//             the name), the [Puzzle] section holds the grid; [State]
//             and other sections are ignored.
//   anything else whose cells add up to exactly 81 → one puzzle.
//
// analyze(text, lib) → { items: [{ p, id, nm, st, n, cut, at }], counts }
//   st: "ok" unique · "multi" more than one solution (allowed, n = how
//   many, up to COUNT_LIMIT; cut = the solver stopped early) · "have"
//   already in the library · "dup" twice in this text · "conflict" two
//   equal givens in a row, column or box · "none" no solution ·
//   "slow" the solver could not finish (refused). at: line number.
// Library (synced, in the "sudoku" slice as data.lib):
//   { "imp-<hash of the 81 digits>": { p, nm?, b: added, x: removed,
//     s: last solved, t: best ms without hints (0 = none) } }
//   visible while b > x. Join per id: b, x, s max; t the smallest
//   time > 0; nm the larger string. Symmetric, associative, idempotent.
// apply(lib, items, now) → { lib, ids, undo }: adds the "ok" / "multi"
//   items; an id that was removed comes back (b = now). Never touches
//   an entry that is visible.
// undo(lib, info, now) → lib: every added id gets x = now (newer than
//   its b), so a sync that already carried the import cannot bring it
//   back.
// UMD: window.OrosSudokuImport in the browser, module.exports in Node.
// ============================================================
(function (root) {
  "use strict";

  var NODE = typeof module !== "undefined" && module.exports && typeof require === "function";
  function kit() { return NODE ? require("../importkit.js") : root.OrosImportKit; }

  var MAX_PUZZLES = 500;               // read from one text
  var MAX_LIB = 2000;                  // visible puzzles in the library
  var MAX_TEXT = 4 * 1024 * 1024;      // characters read
  var COUNT_LIMIT = 100;               // "has N solutions" counts up to this
  var NODES = 200000;                  // solver steps per puzzle
  var MAX_MS = 360000000;              // as sudoku.js
  var NAME_LEN = 60;
  var ACCEPT = ".txt,.sdk,.ss,.sdm,.sdx,.csv,.text,text/plain";

  // ---------- cell tables ----------
  var ROW = [], COL = [], BOX = [], PEERS = [], POP = [];
  (function () {
    var i, j, k;
    for (i = 0; i < 512; i++) { k = 0; for (j = i; j; j &= j - 1) k++; POP.push(k); }
    for (i = 0; i < 81; i++) {
      ROW.push(Math.floor(i / 9));
      COL.push(i % 9);
      BOX.push(Math.floor(i / 27) * 3 + Math.floor((i % 9) / 3));
    }
    for (i = 0; i < 81; i++) {
      var p = [];
      for (j = 0; j < 81; j++) {
        if (j !== i && (ROW[j] === ROW[i] || COL[j] === COL[i] || BOX[j] === BOX[i])) p.push(j);
      }
      PEERS.push(p);
    }
  })();

  function isInt(v) { return typeof v === "number" && isFinite(v) && Math.floor(v) === v; }
  function cmpStr(x, y) { return x < y ? -1 : (x > y ? 1 : 0); }

  // ---------- reading ----------
  var DIGIT = /[1-9]/, BLANK = /[0.\-_*xX]/, SKIP = /[\s|+:]/;

  // The cells at the start of a line: digits and blanks, ignoring
  // spaces, | + and :, up to the first other character or 81 cells.
  function scanCells(s) {
    var out = "";
    for (var i = 0; i < s.length && out.length < 81; i++) {
      var ch = s[i];
      if (DIGIT.test(ch)) out += ch;
      else if (BLANK.test(ch)) out += "0";
      else if (SKIP.test(ch)) continue;
      else break;
    }
    return out;
  }
  // "---+---+---", "-----------", "=========", "|-----+-----|": a rule
  // between boxes (a line of exactly 9 dashes is a row of blanks).
  function isRule(s) {
    if (!/^[\-+=|*\s]+$/.test(s)) return false;
    var dashes = s.replace(/[^\-]/g, "").length;
    return /[+=]/.test(s) || dashes !== 9;
  }

  // Every puzzle in a text: [{ p: "81 digits (0 = blank)", nm, at }]
  // (more = there were more than MAX_PUZZLES).
  function extract(text) {
    text = String(text == null ? "" : text).slice(0, MAX_TEXT).replace(/^﻿/, "");
    var lines = text.split(/\r\n|\r|\n/), out = [], more = false, i;
    // SadMan .sdk with sections: only [Puzzle]
    var sec = -1;
    for (i = 0; i < lines.length; i++) if (/^\s*\[puzzle\]\s*$/i.test(lines[i])) { sec = i; break; }
    var from = 0, to = lines.length;
    if (sec >= 0) {
      from = sec + 1;
      for (i = from; i < lines.length; i++) if (/^\s*\[[^\]]+\]\s*$/.test(lines[i])) { to = i; break; }
    }
    var grid = [], gridAt = 0, name = "";
    function push(p, at) {
      if (out.length >= MAX_PUZZLES) { more = true; return; }
      out.push({ p: p, nm: name, at: at });
      name = "";
    }
    // sdk metadata before the section counts too
    if (sec >= 0) {
      for (i = 0; i < sec; i++) {
        var md = /^\s*#D\s*(.+)$/.exec(lines[i]);
        if (md) name = kit().clean(md[1], NAME_LEN);
      }
    }
    for (i = from; i < to && !more; i++) {
      var s = lines[i].trim();
      if (!s) continue;
      if (s[0] === "#") {
        var m = /^#D\s*(.+)$/.exec(s);
        if (m) name = kit().clean(m[1], NAME_LEN);
        continue;
      }
      if (isRule(s)) continue;
      var cells = scanCells(s);
      if (cells.length === 81) { grid = []; push(cells, i + 1); continue; }
      if (cells.length === 9) {
        if (!grid.length) gridAt = i + 1;
        grid.push(cells);
        if (grid.length === 9) { push(grid.join(""), gridAt); grid = []; }
        continue;
      }
      grid = [];
    }
    // last resort: the whole text holds exactly 81 cells
    if (!out.length) {
      var all = "", bad = false;
      for (i = from; i < to; i++) {
        var t2 = lines[i].trim();
        if (!t2 || t2[0] === "#" || isRule(t2)) continue;
        for (var k = 0; k < t2.length; k++) {
          var ch = t2[k];
          if (DIGIT.test(ch)) all += ch;
          else if (BLANK.test(ch)) all += "0";
          else if (!SKIP.test(ch)) { bad = true; break; }
        }
        if (bad) break;
      }
      if (!bad && all.length === 81) push(all, 1);
    }
    return { list: out, more: more };
  }

  // ---------- checking ----------
  // Two equal givens in one row, column or box?
  function conflicts(p) {
    for (var i = 0; i < 81; i++) {
      var v = p.charCodeAt(i) - 48;
      if (!v) continue;
      var pe = PEERS[i];
      for (var j = 0; j < pe.length; j++) if (pe[j] > i && p.charCodeAt(pe[j]) - 48 === v) return true;
    }
    return false;
  }

  // Count solutions up to limit (most constrained cell first, at most
  // NODES steps). Returns { n, cut, sol: the first one as a string }.
  function countSolutions(p, limit) {
    var g = [], rm = [], cm = [], bm = [], i, n = 0, nodes = 0, cut = false, first = null;
    for (i = 0; i < 9; i++) { rm.push(0); cm.push(0); bm.push(0); }
    for (i = 0; i < 81; i++) {
      var v = p.charCodeAt(i) - 48;
      g.push(v);
      if (!v) continue;
      var bit = 1 << (v - 1);
      if ((rm[ROW[i]] | cm[COL[i]] | bm[BOX[i]]) & bit) return { n: 0, cut: false, sol: null };
      rm[ROW[i]] |= bit; cm[COL[i]] |= bit; bm[BOX[i]] |= bit;
    }
    function rec() {
      if (++nodes > NODES) { cut = true; return true; }
      var best = -1, bestMask = 0, bestN = 10;
      for (var k = 0; k < 81; k++) {
        if (g[k]) continue;
        var m = ~(rm[ROW[k]] | cm[COL[k]] | bm[BOX[k]]) & 511, c = POP[m];
        if (c < bestN) { best = k; bestMask = m; bestN = c; if (c <= 1) break; }
      }
      if (best < 0) {
        n++;
        if (!first) first = g.join("");
        return n >= limit;
      }
      if (!bestN) return false;
      for (var d = 0; d < 9; d++) {
        var b = 1 << d;
        if (!(bestMask & b)) continue;
        g[best] = d + 1;
        rm[ROW[best]] |= b; cm[COL[best]] |= b; bm[BOX[best]] |= b;
        var stop = rec();
        rm[ROW[best]] &= ~b; cm[COL[best]] &= ~b; bm[BOX[best]] &= ~b;
        g[best] = 0;
        if (stop) return true;
      }
      return false;
    }
    rec();
    return { n: n, cut: cut, sol: first };
  }

  function idOf(p) { return "imp-" + kit().hash("sudoku|" + p); }
  function givens(p) { return p.replace(/0/g, "").length; }

  // Check one puzzle: { st, n, cut } (st as in analyze, without have / dup).
  function check(p) {
    if (!/^[0-9]{81}$/.test(p)) return { st: "none", n: 0, cut: false };
    if (conflicts(p)) return { st: "conflict", n: 0, cut: false };
    var r = countSolutions(p, 2);
    if (r.n === 0) return { st: r.cut ? "slow" : "none", n: 0, cut: r.cut };
    if (r.n === 1 && !r.cut) return { st: "ok", n: 1, cut: false };
    if (r.n >= 2) r = countSolutions(p, COUNT_LIMIT);
    return { st: "multi", n: r.n, cut: r.cut || r.n >= COUNT_LIMIT };
  }

  function visible(e) { return !!e && e.b > e.x; }

  function analyze(text, lib) {
    var ex = extract(text), seen = {}, items = [];
    var counts = { found: ex.list.length, ok: 0, multi: 0, have: 0, dup: 0, conflict: 0, none: 0, slow: 0, more: ex.more };
    ex.list.forEach(function (x) {
      var id = idOf(x.p), it = { p: x.p, id: id, nm: x.nm, at: x.at, st: "", n: 0, cut: false };
      if (seen[id]) it.st = "dup";
      else if (lib && visible(lib[id])) it.st = "have";
      else { var c = check(x.p); it.st = c.st; it.n = c.n; it.cut = c.cut; }
      seen[id] = true;
      counts[it.st]++;
      items.push(it);
    });
    return { items: items, counts: counts };
  }

  // ---------- library ----------
  function normEntry(id, e) {
    if (!e || typeof e !== "object" || typeof e.p !== "string" || !/^[0-9]{81}$/.test(e.p) ||
        !/^imp-[a-z0-9]{1,16}$/.test(id) || idOf(e.p) !== id) return null;
    var out = { p: e.p, b: 0, x: 0, s: 0, t: 0 };
    ["b", "x", "s"].forEach(function (k) { if (isInt(e[k]) && e[k] > 0) out[k] = e[k]; });
    if (isInt(e.t) && e.t > 0 && e.t <= MAX_MS) out.t = e.t;
    if (!out.b) return null;
    if (typeof e.nm === "string" && e.nm) {
      var nm = kit().clean(e.nm, NAME_LEN);
      if (nm) out.nm = nm;
    }
    return out;
  }
  function joinEntry(a, c) {
    var out = { p: a.p, b: Math.max(a.b, c.b), x: Math.max(a.x, c.x), s: Math.max(a.s, c.s),
      t: !a.t ? c.t : !c.t ? a.t : Math.min(a.t, c.t) };
    var nm = cmpStr(a.nm || "", c.nm || "") >= 0 ? a.nm : c.nm;
    if (nm) out.nm = nm;
    return out;
  }
  // Canonical join of two libraries (null = no library).
  function mergeLib(A, B) {
    var all = {};
    [A, B].forEach(function (m) {
      if (!m || typeof m !== "object" || Array.isArray(m)) return;
      Object.keys(m).forEach(function (id) {
        var e = normEntry(id, m[id]);
        if (!e) return;
        all[id] = all[id] ? joinEntry(all[id], e) : e;
      });
    });
    var ids = Object.keys(all).sort(cmpStr);
    if (!ids.length) return null;
    var out = {};
    ids.forEach(function (id) {
      var e = all[id], o = { p: e.p };
      if (e.nm) o.nm = e.nm;
      o.b = e.b; o.x = e.x; o.s = e.s; o.t = e.t;
      out[id] = o;
    });
    return out;
  }

  // Visible puzzles, oldest import first: [{ id, p, nm, b, s, t }].
  function list(lib) {
    if (!lib) return [];
    return Object.keys(lib).filter(function (id) { return visible(lib[id]); }).map(function (id) {
      var e = lib[id];
      return { id: id, p: e.p, nm: e.nm || "", b: e.b, s: e.s, t: e.t };
    }).sort(function (x, y) { return x.b - y.b || cmpStr(x.id, y.id); });
  }

  function apply(lib, items, now) {
    var out = JSON.parse(JSON.stringify(lib || {})), ids = [], room = MAX_LIB - list(lib).length;
    var stamp = isInt(now) && now > 0 ? now : Date.now();
    (items || []).forEach(function (it) {
      if ((it.st !== "ok" && it.st !== "multi") || ids.length >= room) return;
      var o = out[it.id];
      if (visible(o)) return;
      if (o) { o.b = Math.max(stamp, o.x + 1); if (!o.nm && it.nm) o.nm = it.nm; }
      else {
        o = { p: it.p, b: stamp, x: 0, s: 0, t: 0 };
        if (it.nm) o.nm = it.nm;
        out[it.id] = o;
      }
      ids.push(it.id);
    });
    return { lib: mergeLib(out, null), ids: ids, undo: { ids: ids.slice() }, full: ids.length >= room };
  }

  function undo(lib, info, now) {
    var out = JSON.parse(JSON.stringify(lib || {})), stamp = isInt(now) && now > 0 ? now : Date.now();
    ((info && info.ids) || []).forEach(function (id) {
      var o = out[id];
      if (o) o.x = Math.max(stamp, o.b + 1);
    });
    return mergeLib(out, null);
  }

  // A solved imported puzzle: s = now; t = the better time (no hint).
  function solved(lib, id, ms, hinted, now) {
    var out = JSON.parse(JSON.stringify(lib || {})), o = out[id];
    if (!o) return mergeLib(out, null);
    o.s = Math.max(o.s || 0, isInt(now) ? now : Date.now());
    ms = Math.max(1, Math.min(MAX_MS, Math.round(ms)));
    if (!hinted && (!o.t || ms < o.t)) o.t = ms;
    return mergeLib(out, null);
  }

  var API = {
    ACCEPT: ACCEPT, MAX_PUZZLES: MAX_PUZZLES, MAX_LIB: MAX_LIB, COUNT_LIMIT: COUNT_LIMIT,
    scanCells: scanCells, extract: extract, conflicts: conflicts, countSolutions: countSolutions,
    check: check, analyze: analyze, idOf: idOf, givens: givens, visible: visible,
    mergeLib: mergeLib, list: list, apply: apply, undo: undo, solved: solved
  };
  if (NODE) module.exports = API;
  else root.OrosSudokuImport = API;
})(typeof window !== "undefined" ? window : this);
