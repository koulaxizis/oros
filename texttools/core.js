// i18n-inline-ok: Greek letter maps for case folding, accents and slugs (text-processing data, no UI text)
// ============================================================
// orOS Text Tools — core (v1.1.0)
// Pure logic, no DOM: the tools (lines, spaces, numbering, columns,
// find and replace, extract, encode / decode, compare), the pipeline
// that runs a chain of steps, the text statistics and the saved-recipe
// merge. Loaded by texttools.js
// (window.TextToolsCore), by worker.js (importScripts) and the tests.
//
// Data (sync slice "texttools", oros-texttools-data):
//   { ver: 1,
//     recipes: [{ id, m, name, steps: [{ tool, opts }] }] sorted by id,
//     tombs:   { id: deletedAt } }
// LWW per recipe by m (equal m: the larger canonical JSON), tombstones
// max-merged, delete wins ties, a newer edit resurrects (R5, R17, R26).
// The text itself is never part of the data.
// ============================================================
(function (root) {
  "use strict";

  var DATA_VER    = 1;
  var MAX_RECIPES = 100;
  var MAX_STEPS   = 30;
  var NAME_LEN    = 60;
  var STR_LEN     = 500;           // any text option (separators, find, prefix…)
  var MAX_TEXT    = 2000000;       // characters the app takes in
  var LIVE_MAX    = 200000;        // above this, the chain runs on "Apply"
  var ID_RE       = /^[a-z0-9]{6,40}$/;
  var TOOL_RE     = /^[a-z][a-z0-9]{1,23}$/;
  var KEY_RE      = /^[a-zA-Z][a-zA-Z0-9]{0,23}$/;

  function cmpStr(x, y) { return x < y ? -1 : (x > y ? 1 : 0); }
  function isInt(v) { return typeof v === "number" && isFinite(v) && Math.floor(v) === v; }
  function has(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }

  // ---------- Text helpers ----------
  // Lines: any line ending in, "\n" out. One final line break is kept
  // aside so per-line tools don't see an empty last line.
  function splitLines(text) {
    var s = String(text == null ? "" : text);
    var tail = /(\r\n|\r|\n)$/.test(s);
    if (tail) s = s.replace(/(\r\n|\r|\n)$/, "");
    return { ls: s === "" && !tail ? [] : s.split(/\r\n|\r|\n/), tail: tail };
  }
  function joinLines(L, ls) { return ls.join("\n") + (L.tail && ls.length ? "\n" : ""); }
  function perLine(text, fn) {
    var L = splitLines(text);
    return joinLines(L, L.ls.map(fn));
  }
  function isBlank(s) { return /^[\s ​  ﻿]*$/.test(s); }

  // "\t", "\n", "\\" typed into a separator field mean tab, line break, backslash.
  function unescapeSep(s) {
    return String(s == null ? "" : s).replace(/\\(t|n|\\)/g, function (m, c) {
      return c === "t" ? "\t" : (c === "n" ? "\n" : "\\");
    });
  }

  // Greek accents and diaeresis, folded for comparison only (never
  // written back: changing letters is the Case Converter's job).
  function foldAccents(s) {
    return String(s).normalize("NFD").replace(/[̀-ͯ]/g, "").normalize("NFC");
  }
  function keyOf(s, o) {
    var k = o.trim ? String(s).trim() : String(s);
    if (o.iaccent) k = foldAccents(k);
    if (o.icase) k = k.toLocaleLowerCase("el").replace(/ς/g, "σ");
    return k;
  }

  // Characters as the eye sees them (emoji, accented letters count once).
  function graphemes(s) {
    s = String(s);
    try {
      if (typeof Intl !== "undefined" && Intl.Segmenter) {
        var n = 0, it = new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(s);
        for (var x of it) n++;        // eslint-disable-line no-unused-vars
        return n;
      }
    } catch (e) {}
    return Array.from(s).length;
  }

  function collator(o, numeric) {
    var sens = o.icase ? (o.iaccent ? "base" : "accent") : (o.iaccent ? "case" : "variant");
    try { return new Intl.Collator(["el", "en"], { sensitivity: sens, numeric: !!numeric }); }
    catch (e) { return { compare: function (a, b) { return cmpStr(keyOf(a, o), keyOf(b, o)); } }; }
  }

  // Uniform integer in [0, n) — crypto when there is one, no modulo bias.
  function randInt(n, rand) {
    if (rand) return Math.floor(rand() * n) % n;
    var c = (typeof crypto !== "undefined" && crypto.getRandomValues) ? crypto : null;
    if (!c) return Math.floor(Math.random() * n);
    var lim = Math.floor(4294967296 / n) * n, r = new Uint32Array(1);
    do { c.getRandomValues(r); } while (r[0] >= lim);
    return r[0] % n;
  }

  // ---------- Delimited text (CSV and friends) ----------
  var DELIMS = { comma: ",", semi: ";", tab: "\t", pipe: "|" };
  function delimOf(id, custom) {
    if (has(DELIMS, id)) return DELIMS[id];
    if (id === "custom") return unescapeSep(custom) || ",";
    return null;
  }

  // Guess the separator from the first 20 lines: the candidate that
  // appears the same number of times (≥ 1) on most lines.
  function detectDelim(text) {
    var ls = splitLines(text).ls.filter(function (l) { return !isBlank(l); }).slice(0, 20);
    var best = ",", bestScore = -1;
    [",", ";", "\t", "|"].forEach(function (d) {
      var counts = ls.map(function (l) { return countOutsideQuotes(l, d); });
      if (!counts.length || !counts[0]) return;
      var same = counts.filter(function (c) { return c === counts[0]; }).length;
      var score = same * 1000 + counts[0];
      if (score > bestScore) { bestScore = score; best = d; }
    });
    return best;
  }
  function countOutsideQuotes(line, d) {
    var n = 0, q = false;
    for (var i = 0; i < line.length; i++) {
      var c = line.charAt(i);
      if (c === '"') q = !q;
      else if (!q && line.substr(i, d.length) === d) { n++; i += d.length - 1; }
    }
    return n;
  }

  // RFC 4180 reader: quoted fields may hold separators, "" and line breaks.
  function parseDelimited(text, d) {
    var s = String(text).replace(/\r\n|\r/g, "\n").replace(/\n$/, "");
    var rows = [], row = [], f = "", i = 0, q = false, quoted = false;
    if (s === "") return rows;
    while (i < s.length) {
      var c = s.charAt(i);
      if (q) {
        if (c === '"') {
          if (s.charAt(i + 1) === '"') { f += '"'; i += 2; continue; }
          q = false; i++; continue;
        }
        f += c; i++; continue;
      }
      if (c === '"' && !quoted && f === "") { q = true; quoted = true; i++; continue; }
      if (s.substr(i, d.length) === d) { row.push(f); f = ""; quoted = false; i += d.length; continue; }
      if (c === "\n") { row.push(f); rows.push(row); row = []; f = ""; quoted = false; i++; continue; }
      f += c; i++;
    }
    row.push(f);
    rows.push(row);
    return rows;
  }
  function needsQuote(f, d) {
    return f.indexOf(d) >= 0 || f.indexOf('"') >= 0 || /[\r\n]/.test(f);
  }
  function writeDelimited(rows, d, quoteAll) {
    return rows.map(function (r) {
      return r.map(function (f) {
        f = String(f == null ? "" : f);
        return quoteAll || needsQuote(f, d) ? '"' + f.replace(/"/g, '""') + '"' : f;
      }).join(d);
    }).join("\n");
  }
  function tableIn(text, o) {
    var d = o.delim === "auto" || !o.delim ? detectDelim(text) : delimOf(o.delim, o.custom);
    return { d: d, rows: parseDelimited(text, d) };
  }

  // "1,3,2" or "2-4" → 0-based column indexes, in that order.
  function colSpec(spec) {
    var out = [];
    String(spec || "").split(/[,;\s]+/).forEach(function (p) {
      var m = /^(\d{1,3})(?:-(\d{1,3}))?$/.exec(p);
      if (!m) return;
      var a = +m[1], b = m[2] ? +m[2] : a, step = a <= b ? 1 : -1;
      for (var k = a; out.length < 256; k += step) { if (k >= 1) out.push(k - 1); if (k === b) break; }
    });
    return out;
  }

  // ---------- Find helpers ----------
  var GREEK_VARIANTS = {
    "α": "αά", "ε": "εέ", "η": "ηή", "ι": "ιίϊΐ", "ο": "οό", "υ": "υύϋΰ", "ω": "ωώ",
    "Α": "ΑΆ", "Ε": "ΕΈ", "Η": "ΗΉ", "Ι": "ΙΊΪ", "Ο": "ΟΌ", "Υ": "ΥΎΫ", "Ω": "ΩΏ"
  };
  function escRe(s) { return s.replace(/[.*+?^${}()|[\]\\\/-]/g, "\\$&"); }
  var WORDCH = "0-9A-Za-z_\\u00C0-\\u024F\\u0370-\\u03FF\\u1F00-\\u1FFF\\u0400-\\u04FF";

  // Build the search pattern. Returns { re } or { err }.
  function buildFind(o, extraFlags) {
    var src = String(o.find || "");
    if (!src) return { err: "empty" };
    if (src.length > STR_LEN) return { err: "long" };
    var flags = "g" + (o.icase ? "i" : "") + (extraFlags || "");
    if (!o.regex) {
      var folded = o.iaccent ? foldAccents(src) : src;
      src = Array.from(folded).map(function (ch) {
        if (!o.iaccent) return escRe(ch);
        var lo = ch.toLowerCase(), up = ch.toUpperCase();
        var set = (GREEK_VARIANTS[lo] || "") + (GREEK_VARIANTS[up] || "");
        return set ? "[" + set + "]" : escRe(ch);
      }).join("");
    }
    if (o.word) src = "(?<![" + WORDCH + "])(?:" + src + ")(?![" + WORDCH + "])";
    var re = null;
    try { re = new RegExp(src, flags + "u"); }
    catch (e) {
      try { re = new RegExp(src, flags); } catch (e2) { return { err: "pattern" }; }
    }
    return { re: re };
  }

  // ---------- Extract helpers (wave 2) ----------
  // Patterns built once; "u" flag with \p{…} when the engine has it.
  function mkRe(withU, plain) {
    try { return new RegExp(withU, "gu"); } catch (e) { return new RegExp(plain, "g"); }
  }
  var L_ = "\\p{L}\\p{N}", L0 = "0-9A-Za-z\\u00C0-\\u024F\\u0370-\\u03FF\\u1F00-\\u1FFF\\u0400-\\u04FF";
  var EXTRACT = {
    emails: function () {
      return mkRe("(?<![" + L_ + "._%+-])[" + L_ + "._%+-]{1,64}@[" + L_ + "-]+(?:\\.[" + L_ + "-]+)*\\.\\p{L}{2,24}",
                  "[" + L0 + "._%+-]{1,64}@[" + L0 + "-]+(?:\\.[" + L0 + "-]+)*\\.[A-Za-z]{2,24}");
    },
    links: function () { return /\b(?:https?:\/\/|www\.)[^\s<>"'«»“”‘’`{}|\\^]+/gi; },
    phones: function () { return /(?:\+|\b00)?\(?\d[\d \t().\/-]{5,22}\d\b/g; },
    numbers: function () {
      return mkRe("(?<![\\p{L}\\p{N}.,])[-+−]?\\d+(?:[.,]\\d+)*(?:[.,]\\d+)?%?(?![\\p{L}\\p{N}])",
                  "[-+]?\\d+(?:[.,]\\d+)*%?");
    },
    hashtags: function () {
      return mkRe("(?<![\\p{L}\\p{N}_&#/])#[\\p{L}\\p{N}_]*\\p{L}[\\p{L}\\p{N}_]*", "#[" + L0 + "_]*[A-Za-z\\u00C0-\\u03FF\\u1F00-\\u1FFF][" + L0 + "_]*");
    },
    mentions: function () {
      return mkRe("(?<![\\p{L}\\p{N}._%+@-])@[\\p{L}\\p{N}_](?:[\\p{L}\\p{N}_.]*[\\p{L}\\p{N}_])?(?![@\\p{L}\\p{N}])", "@[" + L0 + "_]+");
    }
  };
  // Tidy one match: links lose trailing punctuation (a ")" stays when the
  // link opened one), phones need 7–15 digits and are not dates.
  function tidyFound(what, s) {
    if (what === "links") {
      s = s.replace(/[.,;:!?…'"»)\]]+$/, function (tail) {
        var open = (s.match(/\(/g) || []).length, close = (s.slice(0, s.length - tail.length).match(/\)/g) || []).length;
        return tail.charAt(0) === ")" && open > close ? ")" : "";
      });
      return /^(?:https?:\/\/|www\.)[^.\s]*\.?\S/i.test(s) && s.length > 7 ? s : "";
    }
    if (what === "phones") {
      s = s.replace(/^[\s(]+(?=\+|\d)/, function (m) { return m.indexOf("(") >= 0 ? "(" : ""; }).trim();
      var digits = s.replace(/\D/g, "").length;
      if (digits < 7 || digits > 15) return "";
      if (/^\d{1,4}[-.\/]\d{1,2}[-.\/]\d{1,4}$/.test(s)) return "";       // a date
      if (/^\d{1,3}(?:\.\d{3})+(?:,\d+)?$/.test(s) || /^\d+[.,]\d+$/.test(s)) return "";   // an amount
      if ((s.match(/\(/g) || []).length !== (s.match(/\)/g) || []).length) s = s.replace(/[()]/g, "").trim();
      return s;
    }
    if (what === "emails") return s.replace(/^[._-]+|[._-]+$/g, "");
    return s;
  }
  function extractAll(text, o) {
    var re = EXTRACT[o.what](), out = [], seen = {}, s = String(text), m, n = 0;
    re.lastIndex = 0;
    while ((m = re.exec(s)) !== null) {
      if (m[0] === "") { re.lastIndex++; continue; }
      var v = tidyFound(o.what, m[0]);
      if (!v) continue;
      n++;
      if (o.unique) {
        var k = o.what === "phones" ? v.replace(/[^\d+]/g, "").replace(/^00/, "+") : v.toLocaleLowerCase("el");
        if (has(seen, "\u0001" + k)) continue;
        seen["\u0001" + k] = 1;
      }
      out.push(v);
      if (out.length >= 200000) break;
    }
    return { list: out, found: n };
  }

  // ---------- Encode helpers (wave 2) ----------
  function utf8Bytes(s) {
    if (typeof TextEncoder !== "undefined") return new TextEncoder().encode(s);
    var u = unescape(encodeURIComponent(s)), b = new Uint8Array(u.length);
    for (var i = 0; i < u.length; i++) b[i] = u.charCodeAt(i);
    return b;
  }
  var B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  function b64enc(s, urlSafe) {
    var b = utf8Bytes(s), out = [], i, n;
    for (i = 0; i + 2 < b.length; i += 3) {
      n = (b[i] << 16) | (b[i + 1] << 8) | b[i + 2];
      out.push(B64.charAt(n >> 18) + B64.charAt((n >> 12) & 63) + B64.charAt((n >> 6) & 63) + B64.charAt(n & 63));
    }
    if (i < b.length) {
      n = (b[i] << 16) | ((i + 1 < b.length ? b[i + 1] : 0) << 8);
      out.push(B64.charAt(n >> 18) + B64.charAt((n >> 12) & 63) +
               (i + 1 < b.length ? B64.charAt((n >> 6) & 63) : "=") + "=");
    }
    var r = out.join("");
    return urlSafe ? r.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "") : r;
  }
  // null when it is not Base64, or not UTF-8 text once decoded.
  function b64dec(s) {
    var t = String(s).replace(/[\s]+/g, "").replace(/-/g, "+").replace(/_/g, "/").replace(/=+$/, "");
    if (!t || /[^A-Za-z0-9+\/]/.test(t) || t.length % 4 === 1) return null;
    var bytes = new Uint8Array(Math.floor(t.length * 3 / 4)), j = 0, acc = 0, bits = 0;
    for (var i = 0; i < t.length; i++) {
      acc = (acc << 6) | B64.indexOf(t.charAt(i));
      bits += 6;
      if (bits >= 8) { bits -= 8; bytes[j++] = (acc >> bits) & 255; }
    }
    bytes = bytes.subarray(0, j);
    try {
      if (typeof TextDecoder !== "undefined") return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch (e) { return null; }
    var bin = "";
    for (var k = 0; k < bytes.length; k++) bin += String.fromCharCode(bytes[k]);
    try { return decodeURIComponent(escape(bin)); } catch (e2) { return null; }
  }
  // %XX runs decoded one run at a time: a broken run stays as it was.
  function urlDec(s, plus) {
    var n = 0;
    if (plus) s = s.replace(/\+/g, function () { n++; return " "; });
    s = s.replace(/(?:%[0-9A-Fa-f]{2})+/g, function (m) {
      try { var v = decodeURIComponent(m); n++; return v; } catch (e) { return m; }
    });
    return { text: s, n: n };
  }
  var ENT = {
    amp: "&", lt: "<", gt: ">", quot: "\"", apos: "'", nbsp: " ", shy: "­", copy: "©", reg: "®",
    trade: "™", hellip: "…", mdash: "—", ndash: "–", laquo: "«", raquo: "»", lsquo: "‘", rsquo: "’",
    sbquo: "‚", ldquo: "“", rdquo: "”", bdquo: "„", euro: "€", pound: "£", yen: "¥", cent: "¢",
    bull: "•", middot: "·", deg: "°", times: "×", divide: "÷", plusmn: "±", sect: "§", para: "¶",
    frac12: "½", frac14: "¼", frac34: "¾", sup2: "²", sup3: "³", micro: "µ", iexcl: "¡", iquest: "¿",
    larr: "←", rarr: "→", uarr: "↑", darr: "↓", harr: "↔", hearts: "♥", check: "✓", zwj: "‍", zwnj: "‌",
    thinsp: " ", ensp: " ", emsp: " ", tab: "\t", newline: "\n", dagger: "†", Dagger: "‡", permil: "‰",
    prime: "′", Prime: "″", oline: "‾", infin: "∞", ne: "≠", le: "≤", ge: "≥", asymp: "≈", minus: "−"
  };
  // Latin letters with accents (&eacute; …) and the Greek letters (&alpha; …).
  (function () {
    var marks = { grave: "\u0300", acute: "\u0301", circ: "\u0302", tilde: "\u0303", uml: "\u0308", ring: "\u030A", cedil: "\u0327" };
    var sets = { grave: "aeiou", acute: "aeiouy", circ: "aeiou", tilde: "ano", uml: "aeiouy", ring: "a", cedil: "c" };
    Object.keys(sets).forEach(function (mk) {
      sets[mk].split("").forEach(function (c) {
        ENT[c + mk] = (c + marks[mk]).normalize("NFC");
        ENT[c.toUpperCase() + mk] = (c.toUpperCase() + marks[mk]).normalize("NFC");
      });
    });
    ENT.szlig = "ß"; ENT.aelig = "æ"; ENT.AElig = "Æ"; ENT.oslash = "ø"; ENT.Oslash = "Ø"; ENT.eth = "ð"; ENT.thorn = "þ";
    ["Alpha", "Beta", "Gamma", "Delta", "Epsilon", "Zeta", "Eta", "Theta", "Iota", "Kappa", "Lambda", "Mu", "Nu", "Xi",
     "Omicron", "Pi", "Rho", "", "Sigma", "Tau", "Upsilon", "Phi", "Chi", "Psi", "Omega"].forEach(function (nm, i) {
      if (!nm) return;
      ENT[nm] = String.fromCharCode(0x391 + i);
      ENT[nm.toLowerCase()] = String.fromCharCode(0x3B1 + i);
    });
    ENT.sigmaf = "ς";
  })();
  function htmlDec(s) {
    var n = 0;
    var out = s.replace(/&(#[xX][0-9A-Fa-f]{1,6}|#\d{1,7}|[A-Za-z][A-Za-z0-9]{1,31});/g, function (m, e) {
      var cp;
      if (e.charAt(0) === "#") {
        cp = /^#[xX]/.test(e) ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
        if (!(cp > 0 && cp <= 0x10FFFF) || (cp >= 0xD800 && cp <= 0xDFFF)) return m;
        n++;
        return String.fromCodePoint(cp);
      }
      if (!has(ENT, e)) return m;
      n++;
      return ENT[e];
    });
    return { text: out, n: n };
  }
  function htmlEnc(s, all) {
    var n = 0, map = { "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" };
    var out = s.replace(all ? /[&<>"']|[^\x00-\x7F]/gu : /[&<>"']/g, function (c) {
      n++;
      return has(map, c) ? map[c] : "&#" + c.codePointAt(0) + ";";
    });
    return { text: out, n: n };
  }

  // Greek → Latin for slugs (ELOT 743 simplified): "Καλή Χρονιά" → "kali-chronia".
  var GR_PAIRS = { "ου": "ou", "αυ": "av", "ευ": "ev", "ηυ": "iv", "γγ": "ng", "γκ": "gk", "μπ": "mp", "ντ": "nt", "τσ": "ts", "τζ": "tz" };
  var GR_ONE = {
    "α": "a", "β": "v", "γ": "g", "δ": "d", "ε": "e", "ζ": "z", "η": "i", "θ": "th", "ι": "i", "κ": "k",
    "λ": "l", "μ": "m", "ν": "n", "ξ": "x", "ο": "o", "π": "p", "ρ": "r", "σ": "s", "ς": "s", "τ": "t",
    "υ": "y", "φ": "f", "χ": "ch", "ψ": "ps", "ω": "o"
  };
  function greekLatin(s) {
    var out = "", i = 0;
    while (i < s.length) {
      var two = s.substr(i, 2);
      if (has(GR_PAIRS, two)) { out += GR_PAIRS[two]; i += 2; continue; }
      var c = s.charAt(i);
      out += has(GR_ONE, c) ? GR_ONE[c] : c;
      i++;
    }
    return out;
  }
  function slugOf(s, o) {
    var t = foldAccents(String(s).toLocaleLowerCase("el"));
    if (o.greek === "latin") t = greekLatin(t);
    t = t.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/ß/g, "ss").replace(/æ/g, "ae").replace(/ø/g, "o");
    var sep = o.sep === "under" ? "_" : "-";
    var keep = o.greek === "latin" ? /[^a-z0-9]+/g : mkRe("[^\\p{L}\\p{N}]+", "[^a-z0-9\\u0370-\\u03FF]+");
    t = t.replace(keep, sep);
    t = t.split(sep).filter(Boolean).join(sep);
    if (o.max > 0 && t.length > o.max) {
      t = t.slice(0, o.max);
      var cut = t.lastIndexOf(sep);
      if (cut > o.max / 2) t = t.slice(0, cut);
    }
    return t;
  }

  // ---------- Compare helpers (wave 2) ----------
  // Line diff on comparison keys. Ops: [0, i, j] same, [-1, i] removed,
  // [1, j] added. Myers (shortest edit) first; when the texts differ in
  // too many places for that (DIFF_MAX_D changes or DIFF_WORK steps), the
  // lines found once in each text anchor the two (patience diff) and
  // Myers runs between the anchors. A stretch still too different is
  // shown as removed + added. Never freezes, never loses a line.
  var DIFF_MAX_D = 2000, DIFF_WORK = 20000000;
  function myers(ka, kb) {
    var n0 = ka.length, m0 = kb.length, pre = 0, suf = 0, i;
    while (pre < n0 && pre < m0 && ka[pre] === kb[pre]) pre++;
    while (suf < n0 - pre && suf < m0 - pre && ka[n0 - 1 - suf] === kb[m0 - 1 - suf]) suf++;
    var N = n0 - pre - suf, M = m0 - pre - suf, ops = [], mid = [];
    for (i = 0; i < pre; i++) ops.push([0, i, i]);
    if (!N) for (i = 0; i < M; i++) mid.push([1, pre + i]);
    else if (!M) for (i = 0; i < N; i++) mid.push([-1, pre + i]);
    else {
      var max = N + M, off = max + 1, v = new Int32Array(2 * max + 3), trace = [], found = false;
      var d, k, x, y, work = 0;
      for (d = 0; d <= max && !found; d++) {
        if (d > DIFF_MAX_D) return null;
        var snap = new Int32Array(2 * d + 3);
        for (k = -d - 1; k <= d + 1; k++) snap[k + d + 1] = v[off + k];
        trace.push(snap);
        for (k = -d; k <= d; k += 2) {
          x = (k === -d || (k !== d && v[off + k - 1] < v[off + k + 1])) ? v[off + k + 1] : v[off + k - 1] + 1;
          y = x - k;
          while (x < N && y < M && ka[pre + x] === kb[pre + y]) { x++; y++; work++; }
          v[off + k] = x;
          if (++work > DIFF_WORK) return null;
          if (x >= N && y >= M) { found = true; break; }
        }
      }
      x = N; y = M;
      for (var dd = trace.length - 1; dd > 0; dd--) {
        var V = trace[dd], kk = x - y;
        var prevK = (kk === -dd || (kk !== dd && V[kk + dd] < V[kk + dd + 2])) ? kk + 1 : kk - 1;
        var px = V[prevK + dd + 1], py = px - prevK;
        while (x > px && y > py) { mid.push([0, pre + x - 1, pre + y - 1]); x--; y--; }
        if (x === px) mid.push([1, pre + y - 1]); else mid.push([-1, pre + x - 1]);
        x = px; y = py;
      }
      while (x > 0 && y > 0) { mid.push([0, pre + x - 1, pre + y - 1]); x--; y--; }
      mid.reverse();
    }
    for (i = 0; i < mid.length; i++) ops.push(mid[i]);
    for (i = 0; i < suf; i++) ops.push([0, n0 - suf + i, m0 - suf + i]);
    return ops;
  }
  // Lines that appear exactly once in each text, kept in the longest
  // order both agree on (patience sorting): [[i, j], …].
  function anchors(ka, kb) {
    var ca = {}, cb = {}, pos = {}, i;
    for (i = 0; i < ka.length; i++) ca["\u0001" + ka[i]] = (ca["\u0001" + ka[i]] || 0) + 1;
    for (i = 0; i < kb.length; i++) { var q = "\u0001" + kb[i]; cb[q] = (cb[q] || 0) + 1; pos[q] = i; }
    var pairs = [];
    for (i = 0; i < ka.length; i++) {
      var k = "\u0001" + ka[i];
      if (ca[k] === 1 && cb[k] === 1) pairs.push([i, pos[k]]);
    }
    var tails = [], prev = new Int32Array(pairs.length);
    pairs.forEach(function (p, n) {
      var lo = 0, hi = tails.length;
      while (lo < hi) { var m = (lo + hi) >> 1; if (pairs[tails[m]][1] < p[1]) lo = m + 1; else hi = m; }
      prev[n] = lo ? tails[lo - 1] : -1;
      tails[lo] = n;
    });
    var out = [];
    for (var t = tails.length ? tails[tails.length - 1] : -1; t >= 0; t = prev[t]) out.push(pairs[t]);
    return out.reverse();
  }
  function diffLines(ka, kb) {
    var ops = myers(ka, kb);
    if (ops) return ops;
    ops = [];
    var piece = function (a0, a1, b0, b1) {
      var sub = a1 > a0 || b1 > b0 ? myers(ka.slice(a0, a1), kb.slice(b0, b1)) : [];
      var i;
      if (!sub) {
        for (i = a0; i < a1; i++) ops.push([-1, i]);
        for (i = b0; i < b1; i++) ops.push([1, i]);
        return;
      }
      sub.forEach(function (op) {
        ops.push(op[0] === 0 ? [0, a0 + op[1], b0 + op[2]] : (op[0] < 0 ? [-1, a0 + op[1]] : [1, b0 + op[1]]));
      });
    };
    var a = 0, b = 0;
    anchors(ka, kb).forEach(function (p) {
      piece(a, p[0], b, p[1]);
      ops.push([0, p[0], p[1]]);
      a = p[0] + 1; b = p[1] + 1;
    });
    piece(a, ka.length, b, kb.length);
    return ops;
  }

  // ---------- The tools ----------
  // Each tool: group, option defaults (+ field kinds for the UI), run.
  // f: "sel" (choices), "chk", "txt", "num" ([min, max]). `when` hides
  // a field unless another option has one of the given values.
  var DELIM_CHOICES = ["comma", "semi", "tab", "pipe", "custom"];
  var TOOLS = {
    // Lines
    sort: { g: "lines", o: { by: "az", icase: true, iaccent: true, emptyLast: true },
            f: { by: ["sel", ["az", "za", "natural", "num", "len", "random"]], icase: ["chk"], iaccent: ["chk"], emptyLast: ["chk"] } },
    reverse: { g: "lines", o: {}, f: {} },
    dedupe: { g: "lines", o: { keep: "first", icase: false, iaccent: false, trim: true, empty: false },
              f: { keep: ["sel", ["first", "last"]], icase: ["chk"], iaccent: ["chk"], trim: ["chk"], empty: ["chk"] } },
    dupes: { g: "lines", o: { icase: false, iaccent: false, trim: true }, f: { icase: ["chk"], iaccent: ["chk"], trim: ["chk"] } },
    count: { g: "lines", o: { icase: false, iaccent: false, trim: true, order: "count" },
             f: { order: ["sel", ["count", "first", "az"]], icase: ["chk"], iaccent: ["chk"], trim: ["chk"] } },
    noempty: { g: "lines", o: {}, f: {} },
    squeeze: { g: "lines", o: {}, f: {} },
    filter: { g: "lines", o: { mode: "keep", where: "contains", find: "", icase: true },
              f: { mode: ["sel", ["keep", "drop"]], where: ["sel", ["contains", "starts", "ends", "regex"]], find: ["txt"], icase: ["chk"] } },
    join: { g: "lines", o: { sep: ", ", skipEmpty: true }, f: { sep: ["txt"], skipEmpty: ["chk"] } },
    split: { g: "lines", o: { sep: ",", trim: true, skipEmpty: true }, f: { sep: ["txt"], trim: ["chk"], skipEmpty: ["chk"] } },
    // Spaces and clean-up
    trim: { g: "space", o: { side: "both" }, f: { side: ["sel", ["both", "start", "end"]] } },
    spaces: { g: "space", o: { indent: true }, f: { indent: ["chk"] } },
    tabs: { g: "space", o: { dir: "t2s", width: 4 }, f: { dir: ["sel", ["t2s", "s2t"]], width: ["num", [1, 16]] } },
    unwrap: { g: "space", o: {}, f: {} },
    wrap: { g: "space", o: { width: 72 }, f: { width: ["num", [10, 500]] } },
    clean: { g: "space", o: { invisible: true, nbsp: true, quotes: false, dashes: false },
             f: { invisible: ["chk"], nbsp: ["chk"], quotes: ["chk"], dashes: ["chk"] } },
    eol: { g: "space", o: { to: "lf" }, f: { to: ["sel", ["lf", "crlf"]] } },
    // Numbering and prefixes
    number: { g: "num", o: { start: 1, step: 1, pad: 0, style: "dot", skipEmpty: true },
              f: { style: ["sel", ["dot", "paren", "dash", "bracket", "tab", "space"]], start: ["num", [-999999, 999999]],
                   step: ["num", [-1000, 1000]], pad: ["num", [0, 8]], skipEmpty: ["chk"] } },
    unnumber: { g: "num", o: {}, f: {} },
    affix: { g: "num", o: { prefix: "", suffix: "", skipEmpty: true }, f: { prefix: ["txt"], suffix: ["txt"], skipEmpty: ["chk"] } },
    // Columns and separators
    convert: { g: "cols", o: { delim: "auto", custom: "", to: "semi", toCustom: "", quoteAll: false },
               f: { delim: ["sel", ["auto"].concat(DELIM_CHOICES)], custom: ["txt", null, { delim: ["custom"] }],
                    to: ["sel", DELIM_CHOICES], toCustom: ["txt", null, { to: ["custom"] }], quoteAll: ["chk"] } },
    columns: { g: "cols", o: { delim: "auto", custom: "", mode: "keep", cols: "1" },
               f: { mode: ["sel", ["keep", "drop"]], cols: ["txt"], delim: ["sel", ["auto"].concat(DELIM_CHOICES)],
                    custom: ["txt", null, { delim: ["custom"] }] } },
    transpose: { g: "cols", o: { delim: "auto", custom: "" },
                 f: { delim: ["sel", ["auto"].concat(DELIM_CHOICES)], custom: ["txt", null, { delim: ["custom"] }] } },
    markdown: { g: "cols", o: { delim: "auto", custom: "", header: true },
                f: { delim: ["sel", ["auto"].concat(DELIM_CHOICES)], custom: ["txt", null, { delim: ["custom"] }], header: ["chk"] } },
    json: { g: "cols", o: { delim: "auto", custom: "", header: true },
            f: { delim: ["sel", ["auto"].concat(DELIM_CHOICES)], custom: ["txt", null, { delim: ["custom"] }], header: ["chk"] } },
    // Find and replace
    replace: { g: "find", o: { find: "", repl: "", regex: false, icase: false, word: false, iaccent: false },
               f: { find: ["txt"], repl: ["txt"], icase: ["chk"], iaccent: ["chk", null, { regex: [false] }], word: ["chk"], regex: ["chk"] } },
    extract: { g: "find", o: { what: "emails", unique: true, sort: false },
               f: { what: ["sel", ["emails", "links", "phones", "numbers", "hashtags", "mentions"]], unique: ["chk"], sort: ["chk"] } },
    // Encode / decode (wave 2)
    url: { g: "code", o: { dir: "enc", full: false, plus: false },
           f: { dir: ["sel", ["enc", "dec"]], full: ["chk", null, { dir: ["enc"] }], plus: ["chk", null, { dir: ["dec"] }] } },
    base64: { g: "code", o: { dir: "enc", each: false, urlsafe: false },
              f: { dir: ["sel", ["enc", "dec"]], each: ["chk"], urlsafe: ["chk", null, { dir: ["enc"] }] } },
    html: { g: "code", o: { dir: "enc", all: false }, f: { dir: ["sel", ["enc", "dec"]], all: ["chk", null, { dir: ["enc"] }] } },
    slug: { g: "code", o: { greek: "latin", sep: "dash", max: 0 },
            f: { greek: ["sel", ["latin", "keep"]], sep: ["sel", ["dash", "under"]], max: ["num", [0, 200]] } },
    // Compare two texts (wave 2): the second text comes from ctx.other
    // (the "Compare with" box), never from the step, so recipes stay small.
    diff: { g: "cmp", o: { show: "all", trim: false, icase: false, iaccent: false },
            f: { show: ["sel", ["all", "changes", "added", "removed", "same"]], trim: ["chk"], icase: ["chk"], iaccent: ["chk"] } }
  };
  var GROUPS = ["lines", "space", "num", "cols", "find", "code", "cmp"];
  var TOOL_IDS = Object.keys(TOOLS);
  function toolsOf(g) { return TOOL_IDS.filter(function (id) { return TOOLS[id].g === g; }); }

  // Options of a step with the tool's defaults filled in and bad
  // values replaced; unknown keys are ignored for the run.
  function optsFor(tool, opts) {
    var T = TOOLS[tool], o = {}, src = opts && typeof opts === "object" ? opts : {};
    if (!T) return null;
    Object.keys(T.o).forEach(function (k) {
      var def = T.o[k], v = has(src, k) ? src[k] : def, fd = T.f[k];
      if (typeof def === "boolean") o[k] = typeof v === "boolean" ? v : def;
      else if (typeof def === "number") {
        var lim = fd && fd[1] || [-1e9, 1e9];
        o[k] = typeof v === "number" && isFinite(v) ? Math.max(lim[0], Math.min(lim[1], Math.round(v))) : def;
      } else if (fd && fd[0] === "sel") o[k] = fd[1].indexOf(v) >= 0 ? v : def;
      else o[k] = typeof v === "string" ? v.slice(0, STR_LEN) : def;
    });
    return o;
  }

  // Each runner: (text, o, ctx) → { text, n?, err? }. n = how many
  // things changed / were found, shown under the result.
  var RUN = {
    sort: function (text, o, ctx) {
      var L = splitLines(text), ls = L.ls.slice();
      var empties = o.emptyLast ? ls.filter(isBlank) : [];
      if (o.emptyLast) ls = ls.filter(function (l) { return !isBlank(l); });
      if (o.by === "random") {
        for (var i = ls.length - 1; i > 0; i--) { var j = randInt(i + 1, ctx.rand), x = ls[i]; ls[i] = ls[j]; ls[j] = x; }
      } else if (o.by === "len") {
        ls = ls.map(function (l, i) { return { l: l, i: i, n: graphemes(l) }; })
               .sort(function (a, b) { return a.n - b.n || a.i - b.i; }).map(function (x) { return x.l; });
      } else if (o.by === "num") {
        var num = function (l) {
          var m = /[-−]?\d+(?:[.,]\d+)?/.exec(l);
          return m ? parseFloat(m[0].replace("−", "-").replace(",", ".")) : null;
        };
        var col = collator(o, true);
        ls = ls.map(function (l, i) { return { l: l, i: i, v: num(l) }; }).sort(function (a, b) {
          if (a.v === null || b.v === null) return (a.v === null) - (b.v === null) || col.compare(a.l, b.l) || a.i - b.i;
          return a.v - b.v || col.compare(a.l, b.l) || a.i - b.i;
        }).map(function (x) { return x.l; });
      } else {
        var c = collator(o, o.by === "natural");
        ls = ls.map(function (l, i) { return { l: l, i: i }; }).sort(function (a, b) {
          return c.compare(a.l, b.l) || cmpStr(a.l, b.l) || a.i - b.i;
        }).map(function (x) { return x.l; });
        if (o.by === "za") ls.reverse();
      }
      return { text: joinLines(L, ls.concat(empties)) };
    },
    reverse: function (text) {
      var L = splitLines(text);
      return { text: joinLines(L, L.ls.slice().reverse()) };
    },
    dedupe: function (text, o) {
      var L = splitLines(text), seen = {}, out = [], ls = L.ls;
      var order = o.keep === "last" ? ls.slice().reverse() : ls;
      order.forEach(function (l) {
        if (isBlank(l) && !o.empty) { out.push(l); return; }
        var k = "\u0001" + keyOf(l, o);
        if (seen[k]) return;
        seen[k] = 1;
        out.push(l);
      });
      if (o.keep === "last") out.reverse();
      return { text: joinLines(L, out), n: ls.length - out.length };
    },
    dupes: function (text, o) {
      var L = splitLines(text), cnt = {}, first = {}, out = [];
      L.ls.forEach(function (l) {
        if (isBlank(l)) return;
        var k = "\u0001" + keyOf(l, o);
        cnt[k] = (cnt[k] || 0) + 1;
        if (!has(first, k)) first[k] = l;
      });
      Object.keys(first).forEach(function (k) { if (cnt[k] > 1) out.push(first[k]); });
      return { text: joinLines(L, out), n: out.length };
    },
    count: function (text, o) {
      var L = splitLines(text), cnt = {}, first = {}, keys = [];
      L.ls.forEach(function (l) {
        if (isBlank(l)) return;
        var k = "\u0001" + keyOf(l, o);
        if (!has(cnt, k)) { cnt[k] = 0; first[k] = o.trim ? l.trim() : l; keys.push(k); }
        cnt[k]++;
      });
      var c = collator({ icase: true, iaccent: true }, true);
      var idx = {};
      keys.forEach(function (k, i) { idx[k] = i; });
      if (o.order === "count") keys.sort(function (a, b) { return cnt[b] - cnt[a] || idx[a] - idx[b]; });
      else if (o.order === "az") keys.sort(function (a, b) { return c.compare(first[a], first[b]) || idx[a] - idx[b]; });
      return { text: joinLines(L, keys.map(function (k) { return cnt[k] + "\t" + first[k]; })), n: keys.length };
    },
    noempty: function (text) {
      var L = splitLines(text), out = L.ls.filter(function (l) { return !isBlank(l); });
      return { text: joinLines(L, out), n: L.ls.length - out.length };
    },
    squeeze: function (text) {
      var L = splitLines(text), out = [];
      L.ls.forEach(function (l) {
        var b = isBlank(l);
        if (b && out.length && isBlank(out[out.length - 1])) return;
        out.push(b ? "" : l);
      });
      return { text: joinLines(L, out), n: L.ls.length - out.length };
    },
    filter: function (text, o) {
      var L = splitLines(text), test;
      if (!o.find) return { text: text };
      if (o.where === "regex") {
        var b = buildFind({ find: o.find, regex: true, icase: o.icase });
        if (b.err) return { text: text, err: b.err };
        var re = new RegExp(b.re.source, b.re.flags.replace("g", ""));
        test = function (l) { return re.test(l); };
      } else {
        var f = o.icase ? o.find.toLocaleLowerCase("el") : o.find;
        test = function (l) {
          var s = o.icase ? l.toLocaleLowerCase("el") : l;
          if (o.where === "starts") return s.slice(0, f.length) === f;
          if (o.where === "ends") return f.length <= s.length && s.slice(s.length - f.length) === f;
          return s.indexOf(f) >= 0;
        };
      }
      var out = L.ls.filter(function (l) { return o.mode === "drop" ? !test(l) : test(l); });
      return { text: joinLines(L, out), n: out.length };
    },
    join: function (text, o) {
      var ls = splitLines(text).ls;
      if (o.skipEmpty) ls = ls.filter(function (l) { return !isBlank(l); });
      return { text: ls.join(unescapeSep(o.sep)), n: ls.length };
    },
    split: function (text, o) {
      var sep = unescapeSep(o.sep);
      if (!sep) return { text: text };
      var parts = String(text).replace(/\r\n|\r/g, "\n").split(sep);
      if (o.trim) parts = parts.map(function (p) { return p.trim(); });
      if (o.skipEmpty) parts = parts.filter(function (p) { return p !== ""; });
      return { text: parts.join("\n"), n: parts.length };
    },
    trim: function (text, o) {
      return { text: perLine(text, function (l) {
        return o.side === "start" ? l.replace(/^\s+/, "") : (o.side === "end" ? l.replace(/\s+$/, "") : l.trim());
      }) };
    },
    spaces: function (text, o) {
      return { text: perLine(text, function (l) {
        var lead = "";
        if (o.indent) { lead = /^[ \t]*/.exec(l)[0]; l = l.slice(lead.length); }
        return lead + l.replace(/[ \t ]{2,}/g, " ");
      }) };
    },
    tabs: function (text, o) {
      var w = o.width;
      if (o.dir === "s2t") {
        return { text: perLine(text, function (l) {
          var lead = /^ */.exec(l)[0].length, tabs = Math.floor(lead / w);
          return new Array(tabs + 1).join("\t") + l.slice(tabs * w);
        }) };
      }
      return { text: perLine(text, function (l) {
        var out = "", col = 0;
        Array.from(l).forEach(function (ch) {
          if (ch === "\t") { var n = w - (col % w); out += new Array(n + 1).join(" "); col += n; }
          else { out += ch; col++; }
        });
        return out;
      }) };
    },
    unwrap: function (text) {
      var L = splitLines(text), out = [], cur = null;
      L.ls.forEach(function (l) {
        if (isBlank(l)) { if (cur !== null) out.push(cur); cur = null; out.push(""); return; }
        cur = cur === null ? l.trim() : cur + " " + l.trim();
      });
      if (cur !== null) out.push(cur);
      return { text: joinLines(L, out) };
    },
    wrap: function (text, o) {
      var L = splitLines(text), out = [];
      L.ls.forEach(function (l) {
        if (graphemes(l) <= o.width) { out.push(l); return; }
        var lead = /^\s*/.exec(l)[0], words = l.slice(lead.length).split(/[ \t]+/), cur = lead;
        words.forEach(function (w) {
          if (cur.trim() === "") cur = lead + w;
          else if (graphemes(cur) + 1 + graphemes(w) <= o.width) cur += " " + w;
          else { out.push(cur); cur = lead + w; }
        });
        out.push(cur);
      });
      return { text: joinLines(L, out) };
    },
    clean: function (text, o) {
      var s = String(text), before = s;
      if (o.invisible) s = s.replace(/[​-‍⁠﻿­‎‏‪-‮⁦-⁩]/g, "")
                            .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "");
      if (o.nbsp) s = s.replace(/[    -  - 　]/g, " ");
      if (o.quotes) s = s.replace(/[‘’‚‛′]/g, "'").replace(/[“”„‟″«»]/g, '"');
      if (o.dashes) s = s.replace(/[‒–—―−]/g, "-").replace(/…/g, "...");
      s = s.normalize("NFC");
      return { text: s, n: before === s ? 0 : null };
    },
    eol: function (text, o) {
      var s = String(text).replace(/\r\n|\r/g, "\n");
      return { text: o.to === "crlf" ? s.replace(/\n/g, "\r\n") : s };
    },
    number: function (text, o) {
      var L = splitLines(text), k = 0;
      var fmt = function (n) {
        var neg = n < 0, s = String(Math.abs(n));
        while (s.length < o.pad) s = "0" + s;
        s = (neg ? "-" : "") + s;
        switch (o.style) {
          case "paren": return s + ") ";
          case "dash": return s + " - ";
          case "bracket": return "(" + s + ") ";
          case "tab": return s + "\t";
          case "space": return s + " ";
          default: return s + ". ";
        }
      };
      return { text: joinLines(L, L.ls.map(function (l) {
        if (o.skipEmpty && isBlank(l)) return l;
        return fmt(o.start + o.step * (k++)) + l;
      })), n: k };
    },
    unnumber: function (text) {
      var n = 0;
      var re = /^(\s*)(?:\(?\d{1,9}[.)\]:]|\d{1,9}\s*[-–—]|\d{1,9}\t|[-*•·–—▪◦‣>]|\[[ xX]\])[ \t]+/;
      return { text: perLine(text, function (l) {
        var m = re.exec(l);
        if (!m) return l;
        n++;
        return m[1] + l.slice(m[0].length);
      }), n: n };
    },
    affix: function (text, o) {
      var p = unescapeSep(o.prefix), s = unescapeSep(o.suffix);
      return { text: perLine(text, function (l) { return o.skipEmpty && isBlank(l) ? l : p + l + s; }) };
    },
    convert: function (text, o) {
      var T = tableIn(text, o), to = delimOf(o.to, o.toCustom);
      return { text: writeDelimited(T.rows, to, o.quoteAll) + (/\n$/.test(text) ? "\n" : ""), n: T.rows.length, d: T.d };
    },
    columns: function (text, o) {
      var T = tableIn(text, o), idx = colSpec(o.cols);
      if (!idx.length) return { text: text, err: "cols" };
      var rows = T.rows.map(function (r) {
        if (o.mode === "drop") return r.filter(function (f, i) { return idx.indexOf(i) < 0; });
        return idx.map(function (i) { return i < r.length ? r[i] : ""; });
      });
      return { text: writeDelimited(rows, T.d, false) + (/\n$/.test(text) ? "\n" : ""), n: rows.length, d: T.d };
    },
    transpose: function (text, o) {
      var T = tableIn(text, o), w = 0;
      T.rows.forEach(function (r) { w = Math.max(w, r.length); });
      var rows = [];
      for (var c = 0; c < w && c < 10000; c++) rows.push(T.rows.map(function (r) { return c < r.length ? r[c] : ""; }));
      return { text: writeDelimited(rows, T.d, false) + (/\n$/.test(text) ? "\n" : ""), n: rows.length, d: T.d };
    },
    markdown: function (text, o) {
      var T = tableIn(text, o), w = 0;
      if (!T.rows.length) return { text: "" };
      T.rows.forEach(function (r) { w = Math.max(w, r.length); });
      var cell = function (f) { return String(f).replace(/\\/g, "\\\\").replace(/\|/g, "\\|").replace(/\r?\n/g, "<br>").trim(); };
      var line = function (r) {
        var cs = [];
        for (var i = 0; i < w; i++) cs.push(cell(i < r.length ? r[i] : ""));
        return "| " + cs.join(" | ") + " |";
      };
      var rows = T.rows.slice(), head = o.header ? rows.shift() : [];
      var out = [line(head), "|" + new Array(w + 1).join(" --- |")];
      rows.forEach(function (r) { out.push(line(r)); });
      return { text: out.join("\n") + "\n", n: rows.length, d: T.d };
    },
    json: function (text, o) {
      var T = tableIn(text, o), rows = T.rows.slice(), val;
      if (o.header && rows.length) {
        var head = rows.shift().map(function (h, i) { return String(h).trim() || "column" + (i + 1); });
        var uniq = {};
        head = head.map(function (h) {
          var k = h, n = 2;
          while (has(uniq, k)) k = h + "_" + (n++);
          uniq[k] = 1;
          return k;
        });
        val = rows.map(function (r) {
          var obj = {};
          head.forEach(function (h, i) { obj[h] = i < r.length ? r[i] : ""; });
          return obj;
        });
      } else val = rows;
      return { text: JSON.stringify(val, null, 2) + "\n", n: val.length, d: T.d };
    },
    replace: function (text, o) {
      if (!o.find) return { text: text };
      var b = buildFind(o);
      if (b.err) return { text: text, err: b.err };
      var n = 0, repl = o.regex ? unescapeSep(o.repl) : o.repl;
      var out = String(text).replace(b.re, function () {
        n++;
        if (!o.regex) return repl;
        var args = arguments, groups = args[args.length - 1];
        var hasGroups = typeof groups === "object" && groups !== null;
        var subs = Array.prototype.slice.call(args, 1, args.length - (hasGroups ? 3 : 2));
        return repl.replace(/\$(\$|&|\d{1,2}|<([^>]*)>)/g, function (m, c, name) {
          if (c === "$") return "$";
          if (c === "&") return args[0];
          if (name !== undefined) return hasGroups && groups[name] != null ? groups[name] : "";
          var k = +c;
          return k >= 1 && k <= subs.length ? (subs[k - 1] == null ? "" : subs[k - 1]) : m;
        });
      });
      return { text: out, n: n };
    },
    extract: function (text, o) {
      var r = extractAll(text, o), list = r.list;
      if (o.sort) { var c = collator({ icase: true }, true); list = list.slice().sort(function (a, b) { return c.compare(a, b); }); }
      return { text: list.length ? list.join("\n") + "\n" : "", n: list.length };
    },
    url: function (text, o) {
      if (o.dir === "dec") return urlDec(String(text), o.plus);
      var L = splitLines(text), n = 0;
      var out = joinLines(L, L.ls.map(function (l) {
        var e = o.full ? encodeURI(l) : encodeURIComponent(l);
        if (e !== l) n++;
        return e;
      }));
      return { text: out, n: n };
    },
    base64: function (text, o) {
      var s = String(text), bad = 0, n = 0;
      if (!o.each) {
        if (o.dir === "enc") return { text: s ? b64enc(s, o.urlsafe) + "\n" : "" };
        if (!s.trim()) return { text: "" };
        var v = b64dec(s);
        return v === null ? { text: s, err: "b64" } : { text: v };
      }
      var L = splitLines(s);
      var out = joinLines(L, L.ls.map(function (l) {
        if (l === "") return l;
        if (o.dir === "enc") { n++; return b64enc(l, o.urlsafe); }
        var d = b64dec(l);
        if (d === null) { bad++; return l; }
        n++;
        return d.replace(/\r\n|\r|\n/g, " ");
      }));
      return bad && !n ? { text: s, err: "b64" } : { text: out, n: n };
    },
    html: function (text, o) {
      return o.dir === "dec" ? htmlDec(String(text)) : htmlEnc(String(text), o.all);
    },
    slug: function (text, o) {
      var n = 0;
      return { text: perLine(text, function (l) { if (isBlank(l)) return ""; n++; return slugOf(l, o); }), n: n };
    },
    diff: function (text, o, ctx) {
      var other = ctx && typeof ctx.other === "string" ? ctx.other : "";
      if (!other) return { text: text, err: "noother" };
      var A = splitLines(text).ls, B = splitLines(other).ls;
      var ka = A.map(function (l) { return keyOf(l, o); }), kb = B.map(function (l) { return keyOf(l, o); });
      var ops = diffLines(ka, kb);
      // Inside each run of changes: removed lines first, then added ones.
      var sorted = [], run = [];
      var flush = function () {
        run.forEach(function (op) { if (op[0] < 0) sorted.push(op); });
        run.forEach(function (op) { if (op[0] > 0) sorted.push(op); });
        run = [];
      };
      ops.forEach(function (op) { if (op[0]) run.push(op); else { flush(); sorted.push(op); } });
      flush();
      var out = [], add = 0, del = 0;
      sorted.forEach(function (op) {
        if (op[0] > 0) add++; else if (op[0] < 0) del++;
        if (o.show === "all") out.push((op[0] > 0 ? "+ " : (op[0] < 0 ? "- " : "  ")) + (op[0] > 0 ? B[op[1]] : A[op[1]]));
        else if (o.show === "changes") { if (op[0]) out.push((op[0] > 0 ? "+ " : "- ") + (op[0] > 0 ? B[op[1]] : A[op[1]])); }
        else if (o.show === "added") { if (op[0] > 0) out.push(B[op[1]]); }
        else if (o.show === "removed") { if (op[0] < 0) out.push(A[op[1]]); }
        else if (!op[0]) out.push(A[op[1]]);
      });
      return { text: out.length ? out.join("\n") + "\n" : "", n: add + del, x: { add: add, del: del } };
    }
  };

  // Steps that can hang on a pattern (they run in the worker with a time limit).
  function usesPattern(step) {
    if (!step || !step.opts) return false;
    if (step.tool === "replace") return !!step.opts.regex;
    if (step.tool === "filter") return step.opts.where === "regex";
    return false;
  }

  // Chains with a Compare step read the second text.
  function usesOther(steps) { return (steps || []).some(function (s) { return s && s.tool === "diff"; }); }

  // Run a chain. ctx = { rand?, other? } (other: the "Compare with" text). Returns { text, notes: [{ tool, n, err }] }.
  function run(text, steps, ctx) {
    var s = String(text == null ? "" : text);
    if (s.length > MAX_TEXT) s = s.slice(0, MAX_TEXT);
    var notes = [];
    (steps || []).forEach(function (st) {
      var o = st && optsFor(st.tool, st.opts);
      if (!o) { notes.push({ tool: st && st.tool, err: "unknown" }); return; }
      var r;
      try { r = RUN[st.tool](s, o, ctx || {}); }
      catch (e) { r = { text: s, err: "failed" }; }
      s = r.text;
      notes.push({ tool: st.tool, n: r.n === undefined ? null : r.n, err: r.err || null, d: r.d || null, x: r.x || null });
    });
    return { text: s, notes: notes };
  }

  // ---------- Statistics ----------
  function stats(text) {
    var s = String(text || ""), big = s.length > LIVE_MAX;
    var words = 0, sentences = 0, seg = null;
    try { seg = !big && typeof Intl !== "undefined" && Intl.Segmenter ? Intl.Segmenter : null; } catch (e) { seg = null; }
    if (seg) {
      for (var w of new seg(undefined, { granularity: "word" }).segment(s)) if (w.isWordLike) words++;
      for (var x of new seg(undefined, { granularity: "sentence" }).segment(s)) if (/[\p{L}\p{N}]/u.test(x.segment)) sentences++;
    } else {
      words = (s.match(/[\p{L}\p{N}]+(?:['’.-][\p{L}\p{N}]+)*/gu) || []).length;
      sentences = (s.match(/[^.!?;…]*[\p{L}\p{N}][^.!?;…]*(?:[.!?;…]+|$)/gu) || []).length;
    }
    var L = splitLines(s);
    var paras = s.replace(/\r\n|\r/g, "\n").split(/\n[ \t ]*\n/).filter(function (p) { return !isBlank(p); }).length;
    var chars = big ? Array.from(s).length : graphemes(s);
    var noSpace = big ? Array.from(s.replace(/\s+/g, "")).length : graphemes(s.replace(/\s+/g, ""));
    return {
      chars: chars, noSpace: noSpace, words: words, lines: L.ls.length,
      paras: paras, sentences: sentences, minutes: words ? Math.max(1, Math.round(words / 200)) : 0,
      exact: !big
    };
  }

  // Most used words (3+ letters), case and accents ignored.
  function topWords(text, n) {
    var cnt = {}, shown = {}, order = [];
    (String(text || "").match(/[\p{L}][\p{L}\p{M}'’]{2,}/gu) || []).forEach(function (w) {
      var k = foldAccents(w.toLocaleLowerCase("el")).replace(/ς/g, "σ");
      if (!has(cnt, k)) { cnt[k] = 0; shown[k] = w.toLocaleLowerCase("el"); order.push(k); }
      cnt[k]++;
    });
    return order.sort(function (a, b) { return cnt[b] - cnt[a] || cmpStr(a, b); })
                .slice(0, n || 10).map(function (k) { return { w: shown[k], n: cnt[k] }; });
  }

  // ---------- Recipes ----------
  function normName(s) {
    return typeof s === "string" ? s.replace(/[\u0000-\u001f\u007f\u2028\u2029]/g, " ").replace(/\s+/g, " ").trim().slice(0, NAME_LEN) : "";
  }
  // A step keeps every option that is a plain value (unknown ones too:
  // a newer version's options survive a round trip through this one).
  function normStep(x) {
    if (!x || typeof x !== "object" || typeof x.tool !== "string" || !TOOL_RE.test(x.tool)) return null;
    var o = {}, src = x.opts && typeof x.opts === "object" && !Array.isArray(x.opts) ? x.opts : {};
    Object.keys(src).sort(cmpStr).slice(0, 24).forEach(function (k) {
      if (!KEY_RE.test(k)) return;
      var v = src[k];
      if (typeof v === "boolean" || (typeof v === "number" && isFinite(v))) o[k] = v;
      else if (typeof v === "string") o[k] = v.slice(0, STR_LEN);
    });
    return { tool: x.tool, opts: o };
  }
  function normSteps(list) {
    var out = [];
    (Array.isArray(list) ? list : []).forEach(function (s) {
      var x = normStep(s);
      if (x && out.length < MAX_STEPS) out.push(x);
    });
    return out;
  }
  function normRecipe(x) {
    if (!x || typeof x !== "object" || typeof x.id !== "string" || !ID_RE.test(x.id) || !isInt(x.m) || x.m < 0) return null;
    var name = normName(x.name), steps = normSteps(x.steps);
    if (!name || !steps.length) return null;
    return { id: x.id, m: x.m, name: name, steps: steps };
  }
  function emptyData() { return { ver: DATA_VER, recipes: [], tombs: {} }; }

  function mergeRecipes(A, B) {
    var a = A || {}, b = B || {}, tombs = {}, best = {};
    [a.tombs, b.tombs].forEach(function (tm) {
      if (!tm || typeof tm !== "object" || Array.isArray(tm)) return;
      Object.keys(tm).forEach(function (id) {
        if (!ID_RE.test(id) || !isInt(tm[id]) || tm[id] < 0) return;
        if (!has(tombs, id) || tm[id] > tombs[id]) tombs[id] = tm[id];
      });
    });
    [a.recipes, b.recipes].forEach(function (list) {
      if (!Array.isArray(list)) return;
      list.forEach(function (raw) {
        var x = normRecipe(raw);
        if (!x) return;
        var cur = best[x.id];
        if (!cur || x.m > cur.m || (x.m === cur.m && JSON.stringify(x) > JSON.stringify(cur))) best[x.id] = x;
      });
    });
    var recipes = [];
    Object.keys(best).sort(cmpStr).forEach(function (id) {
      if (has(tombs, id) && tombs[id] >= best[id].m) return;
      recipes.push(best[id]);
    });
    var st = {};
    Object.keys(tombs).sort(cmpStr).forEach(function (id) { st[id] = tombs[id]; });
    return { ver: DATA_VER, recipes: recipes, tombs: st };
  }

  // A recipes file (export of this app). Returns { ok, recipes } or { ok:false, err }.
  function parseRecipesFile(s) {
    var j;
    try { j = JSON.parse(String(s).replace(/^﻿/, "")); } catch (e) { return { ok: false, err: "json" }; }
    if (!j || typeof j !== "object" || j.app !== "texttools" || !Array.isArray(j.recipes)) return { ok: false, err: "kind" };
    var out = [];
    j.recipes.forEach(function (r) {
      if (!r || typeof r !== "object") return;
      var name = normName(r.name), steps = normSteps(r.steps).filter(function (st) { return has(TOOLS, st.tool); });
      if (name && steps.length && out.length < MAX_RECIPES) out.push({ name: name, steps: steps });
    });
    return out.length ? { ok: true, recipes: out } : { ok: false, err: "empty" };
  }
  function recipesFile(data, exportedAt) {
    return JSON.stringify({
      app: "texttools", ver: 1, exported: exportedAt || "",
      recipes: (data && data.recipes || []).map(function (r) { return { name: r.name, steps: r.steps }; })
    }, null, 2) + "\n";
  }

  // ---------- Hand-over helpers (other apps) ----------
  // Spreadsheet (BR-S1): rows of a table, numbers as numbers, capped.
  function sheetRows(text, maxRows, maxCols) {
    var d = detectDelim(text), rows = parseDelimited(text, d);
    var cut = rows.length > maxRows || rows.some(function (r) { return r.length > maxCols; });
    rows = rows.slice(0, maxRows).map(function (r) {
      return r.slice(0, maxCols).map(function (f) {
        var t = f.trim();
        return /^-?\d{1,15}(\.\d{1,10})?$/.test(t) ? Number(t) : f;
      });
    });
    return { rows: rows, cut: cut };
  }
  // To-Do (BR-TD-ADD): one item per non-empty line.
  function todoItems(text, max) {
    var out = [], seen = {};
    splitLines(text).ls.forEach(function (l) {
      var s = l.replace(/[\u0000-\u001f\u007f\u2028\u2029]/g, " ").replace(/\s+/g, " ").trim().slice(0, 300);
      if (!s || seen["\u0001" + s] || out.length >= max) return;
      seen["\u0001" + s] = 1;
      out.push({ text: s });
    });
    return out;
  }

  // Which file type fits the result of a chain (for Save).
  function outKind(steps) {
    var last = null;
    (steps || []).forEach(function (s) { if (s && TOOLS[s.tool]) last = s; });
    if (!last) return "txt";
    var o = optsFor(last.tool, last.opts);
    if (last.tool === "markdown") return "md";
    if (last.tool === "json") return "json";
    if (last.tool === "convert") return o.to === "tab" ? "tsv" : (o.to === "custom" ? "txt" : "csv");
    return "txt";
  }

  var api = {
    DATA_VER: DATA_VER, MAX_RECIPES: MAX_RECIPES, MAX_STEPS: MAX_STEPS, NAME_LEN: NAME_LEN, STR_LEN: STR_LEN,
    MAX_TEXT: MAX_TEXT, LIVE_MAX: LIVE_MAX, ID_RE: ID_RE,
    TOOLS: TOOLS, TOOL_IDS: TOOL_IDS, GROUPS: GROUPS, toolsOf: toolsOf, optsFor: optsFor,
    run: run, usesPattern: usesPattern, stats: stats, topWords: topWords, graphemes: graphemes,
    splitLines: splitLines, detectDelim: detectDelim, parseDelimited: parseDelimited,
    writeDelimited: writeDelimited, colSpec: colSpec, foldAccents: foldAccents, unescapeSep: unescapeSep,
    normName: normName, normStep: normStep, normSteps: normSteps, normRecipe: normRecipe,
    emptyData: emptyData, mergeRecipes: mergeRecipes, parseRecipesFile: parseRecipesFile, recipesFile: recipesFile,
    sheetRows: sheetRows, todoItems: todoItems, outKind: outKind,
    usesOther: usesOther, slugOf: slugOf, b64enc: b64enc, b64dec: b64dec, diffLines: diffLines
  };
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.TextToolsCore = api;
})(typeof self !== "undefined" ? self : this);
