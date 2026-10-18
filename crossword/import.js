// ============================================================
// orOS Crossword — import.js ("Import a crossword", v1.0.0)
// i18n-inline-ok: the Greek final sigma in normCell is answer folding (data, no UI text)
// Reads a clued crossword file and keeps it in the synced library of
// imported puzzles. Pure: no DOM, no storage; crossword.js runs the
// picker, the preview, the one write, the Undo and the clued play.
//
// Sources (detected from the bytes, not the file name):
//   puz    Across Lite .puz (binary): "ACROSS&DOWN\0" at 0x02, width
//          0x2C, height 0x2D, clue count 0x2E (uint16 LE), scrambled
//          flag 0x32; then the solution and the player's grid (w×h
//          each, "." = block), then NUL-terminated ISO-8859-1 strings
//          (UTF-8 from version 2.0): title, author, copyright, the
//          clues in cell-number order (across before down on the same
//          number), notes. Extra sections: GRBS + RTBL (rebus squares:
//          the first letter is typed, the whole entry shown when
//          solved), GEXT (0x80 = circled square). Scrambled (locked)
//          puzzles are refused: their solution cannot be checked.
//   ipuz   .ipuz JSON (kind …/crossword#1): dimensions, puzzle (numbers,
//          "#" / block, null = no square, { cell, style: { shapebg:
//          "circle" } }), solution (letters, { value } objects; more
//          than one letter = rebus), clues { "Across": [[n, "clue"] or
//          { number, clue }], "Down": … }, title, author, copyright,
//          notes. HTML in any text becomes plain text. A JSONP wrapper
//          ipuz( … ) is accepted.
//
// Puzzle payload z (canonical, the same for the same file everywhere):
//   { w, h, g: one character per square row by row ("." block; the
//     solution letter in upper case, Greek without accents, final
//     sigma as Σ), lg: "en"|"el", ca: [across clues in slot order],
//     cd: [down clues], ti?, au?, cp?, nt?, ci?: [circled squares],
//     rb?: [[square, "REBUS"]] }
//   Numbering is the usual one (computed by slots(z)); a white square
//   that is in no word of two letters or more becomes a block.
// parse({ name, bytes }) → { source, z, info } | { error } where error
//   is "scrambled" · "nosol" (no solution in the file) · "size" (2–30
//   squares a side) · "clues" (the clue count does not match the grid)
//   · "kind" (an ipuz that is not a crossword) · "unknown".
// Library (synced, in the "crossword" slice as data.lib):
//   { "imp-<hash of z>": { z?, b: added, x: removed, s: last solved,
//     t: best seconds without reveals (0 = none) } }
//   visible while b > x (a hidden entry keeps z: dropping it would
//   break the join). Join per id: b, x, s max; t the smallest > 0; z
//   from either side (the same content: the id is its hash).
// apply(lib, z, now) → { lib, id, added, undo }; undo(lib, info, now):
//   x = a newer stamp than the import, so a sync that already carried
//   it cannot bring it back. solved(lib, id, sec, hinted, now).
// UMD: window.OrosCrosswordImport in the browser, module.exports in Node.
// ============================================================
(function (root) {
  "use strict";

  var NODE = typeof module !== "undefined" && module.exports && typeof require === "function";
  function kit() { return NODE ? require("../importkit.js") : root.OrosImportKit; }

  var MAX_SIDE = 30, MIN_SIDE = 2;
  var MAX_LIB = 60;                     // visible imported crosswords
  var MAX_FILE = 2 * 1024 * 1024;       // bytes read from a file
  var CLUE_LEN = 400, TITLE_LEN = 200, NOTE_LEN = 1000, REBUS_LEN = 12;
  var MAX_SEC = 360000;                 // as crossword.js
  var BLOCK = ".";
  var ACCEPT = ".puz,.ipuz,.json,application/json,application/x-crossword";

  function isInt(v) { return typeof v === "number" && isFinite(v) && Math.floor(v) === v; }
  function cmpStr(x, y) { return x < y ? -1 : (x > y ? 1 : 0); }

  // ---------- text ----------
  var ENT = { amp: "&", lt: "<", gt: ">", quot: "\"", apos: "'", nbsp: " ", ndash: "–", mdash: "—",
    hellip: "…", lsquo: "‘", rsquo: "’", ldquo: "“", rdquo: "”", eacute: "é", egrave: "è", aacute: "á",
    iacute: "í", oacute: "ó", uacute: "ú", ntilde: "ñ", uuml: "ü", ouml: "ö", auml: "ä", ccedil: "ç",
    deg: "°", times: "×", frac12: "½", copy: "©", reg: "®", trade: "™", middot: "·", laquo: "«", raquo: "»" };
  // HTML (as ipuz and some .puz clues carry it) → plain text: tags
  // dropped (<br> and block ends become spaces), entities decoded.
  function htmlText(s, n) {
    s = s == null ? "" : String(s);
    s = s.replace(/<\s*(br|\/p|\/div|\/li)\b[^>]*>/gi, " ").replace(/<[^>]*>/g, "");
    s = s.replace(/&(#x[0-9a-f]{1,6}|#[0-9]{1,7}|[a-z][a-z0-9]{1,8});/gi, function (m, e) {
      if (e[0] === "#") {
        var cp = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
        if (!(cp > 31 && cp < 0x110000) || (cp >= 0xd800 && cp < 0xe000)) return "";
        return String.fromCodePoint ? String.fromCodePoint(cp) : String.fromCharCode(cp);
      }
      var v = ENT[e.toLowerCase()];
      return v !== undefined ? v : m;
    });
    return kit().clean(s, n);
  }

  // One square's solution: upper case, accents dropped, final sigma Σ.
  function normCell(s) {
    s = String(s == null ? "" : s);
    if (s.normalize) s = s.normalize("NFD").replace(/[̀-ͯ]/g, "");
    s = s.toUpperCase().replace(/ς/g, "Σ").replace(/[\s\u0000-\u001f\u007f]/g, "");
    return s;
  }
  function cellOk(ch) { return typeof ch === "string" && ch.length === 1 && ch !== BLOCK && !/[\s\u0000-\u001f\u007f\ud800-\udfff]/.test(ch); }

  // ---------- grid ----------
  // Turn white squares that are in no word of 2+ letters into blocks.
  function dropLoners(g, w, h) {
    var a = g.split(""), changed = false;
    for (var i = 0; i < a.length; i++) {
      if (a[i] === BLOCK) continue;
      var r = Math.floor(i / w), c = i % w;
      var lr = (c > 0 && a[i - 1] !== BLOCK) || (c < w - 1 && a[i + 1] !== BLOCK);
      var ud = (r > 0 && a[i - w] !== BLOCK) || (r < h - 1 && a[i + w] !== BLOCK);
      if (!lr && !ud) { a[i] = BLOCK; changed = true; }
    }
    return changed ? a.join("") : g;
  }

  // The usual numbering: [{ r, c, d (0 across, 1 down), n, len, ix }] in
  // clue order (by number, across first).
  function slotsOf(g, w, h) {
    var out = [], n = 0;
    function white(r, c) { return r >= 0 && c >= 0 && r < h && c < w && g[r * w + c] !== BLOCK; }
    for (var r = 0; r < h; r++) {
      for (var c = 0; c < w; c++) {
        if (!white(r, c)) continue;
        var ac = !white(r, c - 1) && white(r, c + 1), dn = !white(r - 1, c) && white(r + 1, c);
        if (!ac && !dn) continue;
        n++;
        var len;
        if (ac) { for (len = 0; white(r, c + len); len++); out.push({ r: r, c: c, d: 0, n: n, len: len, ix: r * w + c }); }
        if (dn) { for (len = 0; white(r + len, c); len++); out.push({ r: r, c: c, d: 1, n: n, len: len, ix: r * w + c }); }
      }
    }
    return out;
  }
  function slots(z) { return slotsOf(z.g, z.w, z.h); }

  function langOf(g) { return /[Α-Ω]/.test(g) ? "el" : "en"; }

  // Build a canonical payload from loose parts; null when unusable.
  // parts: { w, h, cells: [solution string per square, "" = block],
  //          across: { n: text }, down: { n: text } | acrossList / downList
  //          (texts in clue order), circles: { ix: true }, ti, au, cp, nt }
  function build(parts) {
    var w = parts.w, h = parts.h, cells = parts.cells, g = "", rb = {}, i;
    for (i = 0; i < w * h; i++) {
      var s = cells[i];
      if (!s) { g += BLOCK; continue; }
      var first = s[0];
      if (!cellOk(first)) first = "?";
      g += first;
      if (s.length > 1) rb[i] = s.slice(0, REBUS_LEN);
    }
    g = dropLoners(g, w, h);
    var sl = slotsOf(g, w, h);
    if (!sl.length) return null;
    var ca = [], cd = [], ka = 0, kd = 0;
    sl.forEach(function (x) {
      var text = "";
      if (x.d === 0) text = parts.acrossList ? parts.acrossList[ka++] : (parts.across || {})[x.n];
      else text = parts.downList ? parts.downList[kd++] : (parts.down || {})[x.n];
      (x.d === 0 ? ca : cd).push(htmlText(text, CLUE_LEN));
    });
    var z = { w: w, h: h, g: g, lg: langOf(g), ca: ca, cd: cd };
    var ti = htmlText(parts.ti, TITLE_LEN), au = htmlText(parts.au, TITLE_LEN), cp = htmlText(parts.cp, TITLE_LEN);
    var nt = kit().cleanText(String(parts.nt || "").replace(/<\s*br\s*\/?>/gi, "\n").replace(/<[^>]*>/g, ""), NOTE_LEN);
    if (ti) z.ti = ti;
    if (au) z.au = au;
    if (cp) z.cp = cp;
    if (nt) z.nt = nt;
    var ci = Object.keys(parts.circles || {}).map(Number).filter(function (k) { return g[k] && g[k] !== BLOCK; })
      .sort(function (x, y) { return x - y; });
    if (ci.length) z.ci = ci;
    var rbl = Object.keys(rb).map(Number).filter(function (k) { return g[k] !== BLOCK; }).sort(function (x, y) { return x - y; })
      .map(function (k) { return [k, rb[k]]; });
    if (rbl.length) z.rb = rbl;
    return normPuzzle(z);
  }

  // Validate and canonicalize a payload (also for synced data); null
  // when anything is off.
  function normPuzzle(z) {
    if (!z || typeof z !== "object" || !isInt(z.w) || !isInt(z.h) || z.w < MIN_SIDE || z.h < MIN_SIDE ||
        z.w > MAX_SIDE || z.h > MAX_SIDE || typeof z.g !== "string" || z.g.length !== z.w * z.h ||
        (z.lg !== "en" && z.lg !== "el") || !Array.isArray(z.ca) || !Array.isArray(z.cd)) return null;
    var i;
    for (i = 0; i < z.g.length; i++) if (z.g[i] !== BLOCK && !cellOk(z.g[i])) return null;
    if (dropLoners(z.g, z.w, z.h) !== z.g || langOf(z.g) !== z.lg) return null;
    var sl = slotsOf(z.g, z.w, z.h), na = 0;
    sl.forEach(function (x) { if (!x.d) na++; });
    if (!sl.length || z.ca.length !== na || z.cd.length !== sl.length - na) return null;
    var out = { w: z.w, h: z.h, g: z.g, lg: z.lg, ca: [], cd: [] };
    for (i = 0; i < z.ca.length; i++) { if (typeof z.ca[i] !== "string") return null; out.ca.push(kit().clean(z.ca[i], CLUE_LEN)); }
    for (i = 0; i < z.cd.length; i++) { if (typeof z.cd[i] !== "string") return null; out.cd.push(kit().clean(z.cd[i], CLUE_LEN)); }
    ["ti", "au", "cp"].forEach(function (k) {
      if (typeof z[k] === "string") { var v = kit().clean(z[k], TITLE_LEN); if (v) out[k] = v; }
    });
    if (typeof z.nt === "string") { var nt = kit().cleanText(z.nt, NOTE_LEN); if (nt) out.nt = nt; }
    if (z.ci !== undefined) {
      if (!Array.isArray(z.ci)) return null;
      var ci = [];
      for (i = 0; i < z.ci.length; i++) {
        var k = z.ci[i];
        if (!isInt(k) || k < 0 || k >= z.g.length || z.g[k] === BLOCK || (ci.length && k <= ci[ci.length - 1])) return null;
        ci.push(k);
      }
      if (ci.length) out.ci = ci;
    }
    if (z.rb !== undefined) {
      if (!Array.isArray(z.rb)) return null;
      var rb = [];
      for (i = 0; i < z.rb.length; i++) {
        var e = z.rb[i];
        if (!Array.isArray(e) || e.length !== 2 || !isInt(e[0]) || e[0] < 0 || e[0] >= z.g.length || z.g[e[0]] === BLOCK ||
            typeof e[1] !== "string" || e[1].length < 2 || e[1].length > REBUS_LEN || normCell(e[1]) !== e[1] ||
            e[1][0] !== z.g[e[0]] || (rb.length && e[0] <= rb[rb.length - 1][0])) return null;
        rb.push([e[0], e[1]]);
      }
      if (rb.length) out.rb = rb;
    }
    return out;
  }

  function idOf(z) { return "imp-" + kit().hash("crossword|" + JSON.stringify(z)); }

  // ---------- Across Lite .puz ----------
  var MAGIC = "ACROSS&DOWN\u0000";
  function findMagic(b) {
    var lim = Math.min(b.length - 12, 4096);
    for (var i = 0; i <= lim; i++) {
      var ok = true;
      for (var j = 0; j < 12 && ok; j++) if (b[i + j] !== MAGIC.charCodeAt(j)) ok = false;
      if (ok) return i;
    }
    return -1;
  }
  function isPuz(bytes) { return !!bytes && bytes.length > 0x34 && findMagic(bytes) >= 2; }
  function latin1(b, from, to) {
    var s = "";
    for (var i = from; i < to; i++) s += String.fromCharCode(b[i]);
    return s;
  }
  function utf8(b, from, to) {
    try { return new TextDecoder("utf-8").decode(b.subarray(from, to)); } catch (e) { return latin1(b, from, to); }
  }

  function parsePuz(b) {
    var base = findMagic(b) - 2;
    if (base < 0) return { error: "unknown" };
    var u16 = function (o) { return b[base + o] | (b[base + o + 1] << 8); };
    var w = b[base + 0x2C], h = b[base + 0x2D], nClues = u16(0x2E), scr = u16(0x32);
    var ver = latin1(b, base + 0x18, base + 0x1B);
    if (w < MIN_SIDE || h < MIN_SIDE || w > MAX_SIDE || h > MAX_SIDE) return { error: "size" };
    var at = base + 0x34, n = w * h;
    if (b.length < at + 2 * n) return { error: "unknown" };
    if (scr) return { error: "scrambled" };
    var sol = latin1(b, at, at + n);
    at += 2 * n;                                      // solution, then the player's grid
    var dec = /^[2-9]\./.test(ver) ? utf8 : latin1;
    var strs = [];
    while (strs.length < 4 + nClues && at < b.length) {
      var e = at;
      while (e < b.length && b[e] !== 0) e++;
      strs.push(dec(b, at, e));
      at = e + 1;
    }
    if (strs.length < 3 + nClues) return { error: "clues" };
    // extra sections: GRBS / RTBL (rebus), GEXT (circles)
    var sec = {};
    while (at + 8 <= b.length) {
      var name = latin1(b, at, at + 4);
      if (!/^[A-Z]{4}$/.test(name)) break;
      var len = b[at + 4] | (b[at + 5] << 8);
      if (at + 8 + len > b.length) break;
      sec[name] = b.subarray(at + 8, at + 8 + len);
      at += 8 + len + 1;
    }
    var rtbl = {};
    if (sec.RTBL) {
      latin1(sec.RTBL, 0, sec.RTBL.length).split(";").forEach(function (p) {
        var m = /^\s*(\d+)\s*:\s*(.+?)\s*$/.exec(p);
        if (m) rtbl[+m[1]] = normCell(m[2]);
      });
    }
    var cells = [], circles = {}, unknown = 0, rebus = 0;
    for (var i = 0; i < n; i++) {
      var ch = sol[i];
      if (ch === "." || ch === ":") { cells.push(""); continue; }
      var s = normCell(ch);
      if (ch === "-" || !s) unknown++;
      if (sec.GRBS && sec.GRBS.length === n && sec.GRBS[i] && rtbl[sec.GRBS[i] - 1]) {
        var rs = rtbl[sec.GRBS[i] - 1];
        if (rs.length > 1) { s = rs; rebus++; }
      }
      cells.push(s || "?");
      if (sec.GEXT && sec.GEXT.length === n && (sec.GEXT[i] & 0x80)) circles[i] = true;
    }
    if (unknown * 2 > n - cells.filter(function (x) { return !x; }).length) return { error: "nosol" };
    var g0 = cells.map(function (x) { return x ? "A" : BLOCK; }).join("");
    var sl0 = slotsOf(g0, w, h);
    if (sl0.length !== nClues) return { error: "clues" };
    var acrossList = [], downList = [];
    sl0.forEach(function (x, k) { (x.d ? downList : acrossList).push(strs[3 + k]); });
    // the clue order matches the grid before loners turn into blocks
    // (a loner is in no slot, so the order is the same after)
    var z = build({ w: w, h: h, cells: cells, acrossList: acrossList, downList: downList, circles: circles,
      ti: strs[0], au: strs[1], cp: strs[2], nt: strs[3 + nClues] || "" });
    if (!z) return { error: "unknown" };
    return { source: "puz", z: z, info: { rebus: rebus, circles: (z.ci || []).length } };
  }

  // ---------- ipuz ----------
  function ipuzObject(text) {
    var s = String(text || "").replace(/^﻿/, "").trim();
    var m = /^ipuz\s*\(([\s\S]*)\)\s*;?$/.exec(s);
    if (m) s = m[1];
    if (s[0] !== "{") return null;
    var o = kit().json(s);
    return o && typeof o === "object" && !Array.isArray(o) ? o : null;
  }
  function looksIpuz(o) {
    if (!o) return false;
    var kinds = Array.isArray(o.kind) ? o.kind : [];
    if (kinds.some(function (k) { return /ipuz\.org\//i.test(String(k)); })) return true;
    return !!(o.dimensions && o.puzzle && o.clues);
  }
  function ipuzVal(v) {
    if (v && typeof v === "object" && !Array.isArray(v)) {
      if (v.value !== undefined) return v.value;
      if (v.cell !== undefined) return v.cell;
      return null;
    }
    return v;
  }
  // ipuz clues of one direction → { number: text }
  function ipuzClues(list) {
    var out = {};
    if (!Array.isArray(list)) return out;
    list.forEach(function (e) {
      var num, text;
      if (Array.isArray(e)) { num = e[0]; text = e[1]; }
      else if (e && typeof e === "object") { num = e.number !== undefined ? e.number : e.label; text = e.clue; }
      else if (typeof e === "string") { var m = /^\s*(\d+)[.:)]?\s+(.*)$/.exec(e); if (m) { num = m[1]; text = m[2]; } }
      if (Array.isArray(num)) num = num[0];
      num = parseInt(num, 10);
      if (isInt(num) && num > 0 && out[num] === undefined) out[num] = typeof text === "string" ? text : "";
    });
    return out;
  }
  function parseIpuz(o) {
    var kinds = Array.isArray(o.kind) ? o.kind.map(String) : [];
    if (kinds.length && !kinds.some(function (k) { return /crossword/i.test(k); })) return { error: "kind" };
    var dim = o.dimensions || {}, w = parseInt(dim.width, 10), h = parseInt(dim.height, 10);
    if (!isInt(w) || !isInt(h) || w < MIN_SIDE || h < MIN_SIDE || w > MAX_SIDE || h > MAX_SIDE) return { error: "size" };
    var block = o.block !== undefined ? String(o.block) : "#";
    var pz = Array.isArray(o.puzzle) ? o.puzzle : [], so = Array.isArray(o.solution) ? o.solution : null;
    if (!so) return { error: "nosol" };
    var cells = [], circles = {}, rebus = 0, missing = 0, white = 0;
    for (var r = 0; r < h; r++) {
      for (var c = 0; c < w; c++) {
        var pr = Array.isArray(pz[r]) ? pz[r][c] : undefined, sr = Array.isArray(so[r]) ? so[r][c] : undefined;
        var pv = ipuzVal(pr), sv = ipuzVal(sr);
        var isBlock = pv === null || String(pv) === block || sv === null || String(sv) === block;
        if (pr && typeof pr === "object" && pr.style && typeof pr.style === "object" && pr.style.shapebg === "circle" && !isBlock) circles[r * w + c] = true;
        if (isBlock) { cells.push(""); continue; }
        white++;
        var s = normCell(sv);
        if (!s) { missing++; s = "?"; }
        if (s.length > 1) rebus++;
        cells.push(s);
      }
    }
    if (!white || missing * 2 > white) return { error: "nosol" };
    var across = {}, down = {};
    var cl = o.clues && typeof o.clues === "object" ? o.clues : {};
    Object.keys(cl).forEach(function (k) {
      var dir = k.split(":")[0].trim().toLowerCase();
      if (dir === "across") across = ipuzClues(cl[k]);
      else if (dir === "down") down = ipuzClues(cl[k]);
    });
    var z = build({ w: w, h: h, cells: cells, across: across, down: down, circles: circles,
      ti: o.title, au: o.author, cp: o.copyright, nt: o.notes || o.intro || "" });
    if (!z) return { error: "unknown" };
    return { source: "ipuz", z: z, info: { rebus: (z.rb || []).length, circles: (z.ci || []).length } };
  }

  // A file → { source, z, info } | { error }.
  function parse(file) {
    var bytes = file && file.bytes;
    if (!bytes || !bytes.length) return { error: "unknown" };
    if (bytes.length > MAX_FILE) return { error: "toobig" };
    if (isPuz(bytes)) return parsePuz(bytes);
    var o = ipuzObject(kit().text(bytes));
    if (looksIpuz(o)) return parseIpuz(o);
    return { error: "unknown" };
  }

  // ---------- library ----------
  function visible(e) { return !!e && e.b > e.x; }
  function normEntry(id, e) {
    if (!e || typeof e !== "object" || !/^imp-[a-z0-9]{1,16}$/.test(id)) return null;
    var out = { b: 0, x: 0, s: 0, t: 0 };
    ["b", "x", "s"].forEach(function (k) { if (isInt(e[k]) && e[k] > 0) out[k] = e[k]; });
    if (isInt(e.t) && e.t > 0 && e.t <= MAX_SEC) out.t = e.t;
    if (!out.b) return null;
    if (e.z !== undefined) {
      var z = normPuzzle(e.z);
      if (z && idOf(z) === id) out.z = z;
    }
    return out;
  }
  function mergeLib(A, B) {
    var all = {};
    [A, B].forEach(function (m) {
      if (!m || typeof m !== "object" || Array.isArray(m)) return;
      Object.keys(m).forEach(function (id) {
        var e = normEntry(id, m[id]);
        if (!e) return;
        var o = all[id];
        if (!o) { all[id] = e; return; }
        all[id] = { b: Math.max(o.b, e.b), x: Math.max(o.x, e.x), s: Math.max(o.s, e.s),
          t: !o.t ? e.t : !e.t ? o.t : Math.min(o.t, e.t), z: o.z || e.z };
      });
    });
    var ids = Object.keys(all).sort(cmpStr);
    if (!ids.length) return null;
    var out = {};
    ids.forEach(function (id) {
      var e = all[id], o = { b: e.b, x: e.x, s: e.s, t: e.t };
      if (e.z) o.z = e.z;
      out[id] = o;
    });
    return out;
  }
  // Visible crosswords, oldest import first: [{ id, z, b, s, t }].
  function list(lib) {
    if (!lib) return [];
    return Object.keys(lib).filter(function (id) { return visible(lib[id]) && lib[id].z; }).map(function (id) {
      var e = lib[id];
      return { id: id, z: e.z, b: e.b, s: e.s, t: e.t };
    }).sort(function (x, y) { return x.b - y.b || cmpStr(x.id, y.id); });
  }
  function apply(lib, z, now) {
    var out = JSON.parse(JSON.stringify(lib || {})), stamp = isInt(now) && now > 0 ? now : Date.now();
    z = normPuzzle(z);
    if (!z) return { lib: mergeLib(out, null), id: "", added: false, full: false, undo: null };
    var id = idOf(z), o = out[id];
    if (visible(o) && o.z) return { lib: mergeLib(out, null), id: id, added: false, full: false, undo: null };
    if (list(lib).length >= MAX_LIB) return { lib: mergeLib(out, null), id: id, added: false, full: true, undo: null };
    if (o) { o.b = Math.max(stamp, (o.x || 0) + 1); o.z = z; }
    else out[id] = { b: stamp, x: 0, s: 0, t: 0, z: z };
    return { lib: mergeLib(out, null), id: id, added: true, full: false, undo: { ids: [id] } };
  }
  function undo(lib, info, now) {
    var out = JSON.parse(JSON.stringify(lib || {})), stamp = isInt(now) && now > 0 ? now : Date.now();
    ((info && info.ids) || []).forEach(function (id) {
      var o = out[id];
      if (o) o.x = Math.max(stamp, o.b + 1);
    });
    return mergeLib(out, null);
  }
  function solved(lib, id, sec, hinted, now) {
    var out = JSON.parse(JSON.stringify(lib || {})), o = out[id];
    if (o) {
      o.s = Math.max(o.s || 0, isInt(now) ? now : Date.now());
      sec = Math.max(1, Math.min(MAX_SEC, Math.round(sec)));
      if (!hinted && (!o.t || sec < o.t)) o.t = sec;
    }
    return mergeLib(out, null);
  }

  var API = {
    ACCEPT: ACCEPT, MAX_LIB: MAX_LIB, MAX_FILE: MAX_FILE, MAX_SIDE: MAX_SIDE,
    htmlText: htmlText, normCell: normCell, slots: slots, slotsOf: slotsOf, normPuzzle: normPuzzle, idOf: idOf,
    isPuz: isPuz, parsePuz: parsePuz, ipuzObject: ipuzObject, parseIpuz: parseIpuz, parse: parse,
    visible: visible, mergeLib: mergeLib, list: list, apply: apply, undo: undo, solved: solved
  };
  if (NODE) module.exports = API;
  else root.OrosCrosswordImport = API;
})(typeof window !== "undefined" ? window : this);
