// ============================================================
// orOS Typewriter — core (v1.0.0)
// Pure logic, no DOM: typewriter-mode editing (forward only, a
// backspace strikes the letter instead of erasing it), word counts,
// the ink of each letter, and the pages merge.
// Loaded by typewriter.js (window.TypewriterCore) and by the tests.
//
// A struck letter is the letter followed by U+0336 (combining long
// stroke overlay): plain text that still reads as "crossed out" in
// any editor the text is copied to.
//
// Pages (sync slice "typewriter"):
//   { ver: 1, pages: [{ id, m, title, text, goal }], tombs: { id: deletedAt } }
// ============================================================
(function (root) {
  "use strict";

  var STRIKE     = "̶";
  var MAX_TEXT   = 200000;
  var MAX_TITLE  = 80;
  var MAX_GOAL   = 100000;
  var DATA_VER   = 1;
  var ID_RE      = /^p[a-z0-9]{6,20}$/;

  function isInt(v) { return typeof v === "number" && isFinite(v) && Math.floor(v) === v; }
  function cmpStr(x, y) { return x < y ? -1 : (x > y ? 1 : 0); }
  function clipLine(s, n) {
    return typeof s === "string" ? s.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, n) : "";
  }
  function hash32(s) {                // FNV-1a
    var h = 0x811c9dc5;
    for (var i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    return h >>> 0;
  }

  // ---------- Text ----------
  // Line breaks as \n, no other control characters, at most MAX_TEXT.
  function cleanText(s) {
    if (typeof s !== "string") return "";
    s = s.replace(/\r\n?/g, "\n").replace(/\t/g, "    ")
         .replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, "");
    if (s.length > MAX_TEXT) {
      s = s.slice(0, MAX_TEXT);
      if (/[\ud800-\udbff]$/.test(s)) s = s.slice(0, -1);   // no half surrogate pair
    }
    return s;
  }

  // Strike up to n letters, going back from the end over letters that
  // are already struck. Never crosses a line break (the carriage only
  // goes back on its own line) and never strikes a space.
  function strike(text, n) {
    var chars = Array.from(text), i = chars.length - 1, done = 0;
    var out = chars.slice();
    while (done < n && i >= 0) {
      var c = chars[i];
      if (c === "\n") break;
      if (c === STRIKE) { i -= 2; continue; }               // letter + stroke: already struck
      if (/\s/.test(c)) { i--; continue; }
      out.splice(i + 1, 0, STRIKE);
      done++;
      i--;
    }
    return out.join("");
  }

  // Every letter of s struck (spaces and letters already struck stay).
  function strikeAll(s) {
    var chars = Array.from(s), out = "";
    for (var i = 0; i < chars.length; i++) {
      var c = chars[i];
      out += c;
      if (c !== STRIKE && !/\s/.test(c) && chars[i + 1] !== STRIKE) out += STRIKE;
    }
    return out;
  }

  // Typewriter mode: the new value of the text box after a native edit
  // (keyboard, autocorrect, paste, cut) becomes what a typewriter would
  // show: nothing is erased.
  //   - added at the end: kept
  //   - added in the middle: moved to the end
  //   - removed at the end (backspace): that many letters struck
  //   - removed in the middle: struck in place
  //   - replaced (autocorrect): the whole word struck, the new text typed after it
  function typewriterEdit(oldText, newText) {
    if (newText === oldText) return oldText;
    var a = oldText, b = newText, p = 0;
    var max = Math.min(a.length, b.length);
    while (p < max && a.charCodeAt(p) === b.charCodeAt(p)) p++;
    var s = 0;
    while (s < a.length - p && s < b.length - p &&
           a.charCodeAt(a.length - 1 - s) === b.charCodeAt(b.length - 1 - s)) s++;
    var removed = a.slice(p, a.length - s), added = b.slice(p, b.length - s).split(STRIKE).join("");
    var suffix = a.slice(a.length - s), out;
    if (!removed) {
      out = a + added;
    } else if (!added && !s) {
      var n = Array.from(removed).filter(function (c) { return c !== STRIKE && !/\s/.test(c); }).length;
      out = strike(a, Math.max(1, n));
    } else if (!added) {
      // "one two three" → "one three" can be read as removing "wo t";
      // slide the window to start on a word ("two ") when it can.
      var L = removed.length, q = p;
      while (q > 0 && a.charAt(q - 1) === a.charAt(q - 1 + L)) {
        q--;
        if (/\s/.test(a.charAt(q - 1)) || q === 0) { p = q; break; }
      }
      out = a.slice(0, p) + strikeAll(a.slice(p, p + L)) + a.slice(p + L);
    } else {
      var w = p;
      while (w > 0 && !/\s/.test(a.charAt(w - 1))) w--;
      out = a.slice(0, w) + strikeAll(a.slice(w, a.length - s)) + suffix +
            b.slice(w, b.length - s).split(STRIKE).join("") + (/^\s+$/.test(suffix) ? suffix : "");
    }
    return cleanText(out);
  }

  function plainText(text) { return String(text || "").split(STRIKE).join(""); }
  // Text without the struck letters (what a reader would keep).
  function keptText(text) {
    return Array.from(String(text || "")).reduce(function (acc, c) {
      if (c === STRIKE) { acc.pop(); return acc; }
      acc.push(c); return acc;
    }, []).join("");
  }

  // Words: runs of letters or digits (any script), struck letters left out.
  var WORD_RE = /[\p{L}\p{N}]+(?:['’\-][\p{L}\p{N}]+)*/gu;
  function wordCount(text) {
    var m = keptText(text).match(WORD_RE);
    return m ? m.length : 0;
  }

  // Ink class 0..7 of the letter at position i of a line: the same
  // letter in the same place always looks the same.
  function inkOf(lineSeed, i, ch) {
    return hash32(lineSeed + ":" + i + ":" + ch) % 8;
  }

  // Characters left on the line the carriage is on (for the bell).
  function column(text) {
    var nl = text.lastIndexOf("\n");
    return Array.from(text.slice(nl + 1)).filter(function (c) { return c !== STRIKE; }).length;
  }

  // ---------- Pages: normalise + merge ----------
  function normPage(p) {
    if (!p || typeof p !== "object" || typeof p.id !== "string" || !ID_RE.test(p.id) ||
        !isInt(p.m) || p.m < 0) return null;
    var goal = isInt(p.goal) && p.goal > 0 ? Math.min(p.goal, MAX_GOAL) : 0;
    return { id: p.id, m: p.m, title: clipLine(p.title, MAX_TITLE), text: cleanText(p.text), goal: goal };
  }

  // LWW per page (newer m wins; equal m: the larger canonical JSON),
  // tombstones max-merged, delete wins ties, a newer edit resurrects (R17).
  function mergeTypewriter(A, B) {
    var a = A || {}, b = B || {};
    var tombs = {};
    [a.tombs, b.tombs].forEach(function (tm) {
      if (!tm || typeof tm !== "object" || Array.isArray(tm)) return;
      Object.keys(tm).forEach(function (id) {
        if (!ID_RE.test(id) || !isInt(tm[id]) || tm[id] < 0) return;
        if (!(id in tombs) || tm[id] > tombs[id]) tombs[id] = tm[id];
      });
    });
    var best = {};
    [a.pages, b.pages].forEach(function (list) {
      if (!Array.isArray(list)) return;
      list.forEach(function (raw) {
        var p = normPage(raw);
        if (!p) return;
        var cur = best[p.id];
        if (!cur || p.m > cur.m ||
            (p.m === cur.m && JSON.stringify(p) > JSON.stringify(cur))) best[p.id] = p;
      });
    });
    var pages = [];
    Object.keys(best).sort(cmpStr).forEach(function (id) {
      if (id in tombs && tombs[id] >= best[id].m) return;
      pages.push(best[id]);
    });
    var sortedTombs = {};
    Object.keys(tombs).sort(cmpStr).forEach(function (id) { sortedTombs[id] = tombs[id]; });
    return { ver: DATA_VER, pages: pages, tombs: sortedTombs };
  }

  function findPage(dat, id) {
    for (var i = 0; i < dat.pages.length; i++) if (dat.pages[i].id === id) return dat.pages[i];
    return null;
  }
  function newestFirst(list) {
    return list.slice().sort(function (x, y) { return y.m - x.m || cmpStr(x.id, y.id); });
  }
  function newId(r) {
    var s = "p";
    for (var i = 0; i < 12; i++) s += "abcdefghijklmnopqrstuvwxyz0123456789".charAt(Math.floor(r() * 36));
    return s;
  }
  // What the list shows: the title, else the first words of the page.
  function displayTitle(p, fallback) {
    if (p.title) return p.title;
    var first = clipLine(keptText(p.text).split("\n").filter(function (l) { return l.trim(); })[0] || "", 60);
    return first || fallback;
  }
  // File name for the .txt download.
  function fileName(title) {
    var base = clipLine(title, 60).replace(/[\\/:*?"<>|]+/g, "").replace(/\s+/g, "-").replace(/^[.\-]+|[.\-]+$/g, "");
    return (base || "typewriter") + ".txt";
  }

  var api = {
    STRIKE: STRIKE, MAX_TEXT: MAX_TEXT, MAX_TITLE: MAX_TITLE, MAX_GOAL: MAX_GOAL, ID_RE: ID_RE,
    hash32: hash32, cleanText: cleanText, strike: strike, strikeAll: strikeAll, typewriterEdit: typewriterEdit,
    plainText: plainText, keptText: keptText, wordCount: wordCount, inkOf: inkOf, column: column,
    normPage: normPage, mergeTypewriter: mergeTypewriter, findPage: findPage, newestFirst: newestFirst,
    newId: newId, displayTitle: displayTitle, fileName: fileName
  };
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.TypewriterCore = api;
})(typeof window !== "undefined" ? window : this);
