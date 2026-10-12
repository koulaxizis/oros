// ============================================================
// orOS Case Converter — pure core (no DOM, no storage)
// Changes the case and the letters of a text. Greek is done right:
//   - UPPERCASE drops the accents (καλημέρα → ΚΑΛΗΜΕΡΑ) but keeps
//     the diaeresis, and an accent that breaks a diphthong becomes a
//     diaeresis (τσάι → ΤΣΑΪ, Μάιος → ΜΑΪΟΣ); the lone word "ή"
//     ("or") keeps its accent
//   - a capital at the start of a word keeps its accent (όλα → Όλα)
//   - final sigma: ς at the end of a word, σ elsewhere
//   - Greek → Latin by ELOT 743 (passports) or casual Greeklish
//   - Latin letters hiding in Greek words (and the other way round)
//   - Turkish i/İ and German ß through the chosen language
// Every rule here is the engine's own, so Chrome, Firefox and Safari
// give the same result.
//
//   My words (synced slice "textcase", oros-textcase-data):
//   { ver, words: [{ id, w, m }], tombs: { id: ms } }
//   words whose casing is always kept by Sentence case, Title Case
//   and Capitalize Each Word (iPhone, NASA, ΔΕΗ). The id is a hash of
//   the folded word (two devices adding the same word get one entry,
//   R16). LWW per word by m (equal m: larger canonical JSON) +
//   tombstones (delete wins ties, a newer edit resurrects), sorted by
//   id (R5, R17, R26). The seed words carry m = 1, so any real
//   change, delete included, wins over them.
//
// Read-only for other apps: Text Tools may load this file for a
// "change case" step (convert / convertRange take no state).
// UMD: module.exports in Node, window.TextCaseCore in the browser.
// ============================================================
(function (root) {
  "use strict";

  var DATA_VER     = 1;
  var DATA_KEY     = "oros-textcase-data";
  var PREFS_KEY    = "oros-textcase-prefs";
  var DRAFT_KEY    = "oros-textcase-draft";
  var MAX_DRAFT    = 100000;   // characters kept on the device
  var MAX_WORDS    = 500;
  var MAX_WORD_LEN = 40;
  var LANGS        = ["auto", "en", "el", "tr", "de"];

  var RE_LETTER = /\p{L}/u;
  var RE_MARK   = /\p{M}/u;
  var RE_DIGIT  = /\p{N}/u;
  var RE_SPACE  = /\s/;
  var RE_WORD   = /[\p{L}\p{M}\p{N}]+(?:['’][\p{L}\p{M}\p{N}]+)*/gu;
  var RE_TOKEN  = /[\p{L}\p{M}\p{N}]+(?:[-'’.][\p{L}\p{M}\p{N}]+)*/gu;

  function isInt(v) { return typeof v === "number" && isFinite(v) && Math.floor(v) === v; }
  function cmpStr(x, y) { return x < y ? -1 : (x > y ? 1 : 0); }
  function str(s) { return typeof s === "string" ? s : (s == null ? "" : String(s)); }
  function isLetter(ch) { return !!ch && RE_LETTER.test(ch); }
  function isMark(ch) { return !!ch && RE_MARK.test(ch); }
  function isGreekCh(ch) {
    if (!ch) return false;
    var c = ch.codePointAt(0);
    return (c >= 0x370 && c <= 0x3ff) || (c >= 0x1f00 && c <= 0x1fff);
  }
  function isGreekLetter(ch) { return isGreekCh(ch) && isLetter(ch); }
  function isLatinLetter(ch) {
    if (!isLetter(ch)) return false;
    var c = ch.codePointAt(0);
    return c < 0x250 || (c >= 0x1e00 && c <= 0x1eff);
  }

  // ---------- Language ----------
  // "auto" looks at the letters: more Greek than Latin → el.
  function langOf(text, lang) {
    if (lang && lang !== "auto" && LANGS.indexOf(lang) > 0) return lang;
    var g = 0, l = 0, cps = Array.from(str(text).slice(0, 5000));
    for (var i = 0; i < cps.length; i++) {
      if (isGreekLetter(cps[i])) g++;
      else if (isLatinLetter(cps[i])) l++;
    }
    return g > 0 && g >= l ? "el" : "en";
  }

  function upperChar(ch, L) { return L === "tr" ? ch.toLocaleUpperCase("tr") : ch.toUpperCase(); }
  function lowerChar(ch, L) { return L === "tr" ? ch.toLocaleLowerCase("tr") : ch.toLowerCase(); }

  // ---------- Clusters (a base character + its combining marks) ----------
  function clusters(nfd) {
    var out = [], cps = Array.from(nfd);
    for (var i = 0; i < cps.length; i++) {
      var ch = cps[i];
      if (isMark(ch) && out.length) out[out.length - 1].m.push(ch);
      else out.push({ b: ch, m: [] });
    }
    return out;
  }
  function joinClusters(cl) {
    var s = "";
    for (var i = 0; i < cl.length; i++) s += cl[i].b + cl[i].m.join("");
    return s;
  }
  var ACCENTS = { "́": 1, "̀": 1, "͂": 1 };
  function hasAccent(marks) {
    for (var i = 0; i < marks.length; i++) if (ACCENTS[marks[i]]) return true;
    return false;
  }

  // ---------- Final sigma ----------
  // σ at the end of a word (after a letter, before no letter) → ς;
  // ς anywhere else → σ. Marks between are skipped both ways.
  function fixSigma(s) {
    var cps = Array.from(str(s));
    for (var i = 0; i < cps.length; i++) {
      if (cps[i] !== "σ" && cps[i] !== "ς") continue;
      var p = i - 1;
      while (p >= 0 && isMark(cps[p])) p--;
      var n = i + 1;
      while (n < cps.length && isMark(cps[n])) n++;
      var end = p >= 0 && isLetter(cps[p]) && !(n < cps.length && isLetter(cps[n]));
      cps[i] = end ? "ς" : "σ";
    }
    return cps.join("");
  }

  // ---------- UPPERCASE / lowercase ----------
  var DIPH = { "αι": 1, "ει": 1, "οι": 1, "υι": 1, "αυ": 1, "ευ": 1, "ου": 1, "ηυ": 1 };

  function lonelyAt(cl, i) {
    var p = cl[i - 1], n = cl[i + 1];
    return !(p && isLetter(p.b)) && !(n && isLetter(n.b));
  }

  function upper(text, lang) {
    var L = langOf(text, lang);
    var cl = clusters(str(text).normalize("NFD"));
    for (var i = 0; i < cl.length; i++) {
      var c = cl[i];
      if (!isGreekLetter(c.b)) { c.b = upperChar(c.b, L); continue; }
      var low = c.b.toLowerCase(), acc = hasAccent(c.m);
      var keep = [];
      for (var k = 0; k < c.m.length; k++) {
        var mk = c.m[k];
        if (mk === "̈") keep.push(mk);
        else if (mk === "́" && low === "η" && lonelyAt(cl, i)) keep.push(mk);   // Ή ("or")
      }
      var n = cl[i + 1];
      if (acc && n && n.m.length === 0 && isGreekLetter(n.b) && DIPH[low + n.b.toLowerCase()]) {
        n.m = ["̈"];   // τσάι → ΤΣΑΪ
      }
      c.b = c.b.toUpperCase();
      c.m = keep;
    }
    return joinClusters(cl).normalize("NFC");
  }

  function lower(text, lang) {
    var L = langOf(text, lang);
    var s = str(text);
    return fixSigma(L === "tr" ? s.toLocaleLowerCase("tr") : s.toLowerCase());
  }

  // A capital at the start of a word keeps its accent (Ό, Ή).
  function capFirstLetter(word, L) {
    var cps = Array.from(word);
    for (var i = 0; i < cps.length; i++) {
      if (isLetter(cps[i])) { cps[i] = upperChar(cps[i], L); break; }
      if (RE_DIGIT.test(cps[i])) break;
    }
    return cps.join("");
  }

  // ---------- My words ----------
  function foldKey(w) { return str(w).normalize("NFC").toLowerCase().replace(/ς/g, "σ"); }

  function wordMap(words) {
    var map = {};
    (words || []).forEach(function (w) {
      var t = typeof w === "string" ? w : (w && w.w);
      if (typeof t === "string" && t) map[foldKey(t)] = t;
    });
    return map;
  }

  function applyWords(text, words) {
    var map = wordMap(words);
    if (!Object.keys(map).length) return text;
    return str(text).replace(RE_TOKEN, function (tok) {
      var hit = map[foldKey(tok)];
      if (hit !== undefined) return hit;
      return tok.replace(/[\p{L}\p{M}\p{N}]+/gu, function (part) {
        var h = map[foldKey(part)];
        return h !== undefined ? h : part;
      });
    });
  }

  // ---------- Sentence case ----------
  var ABBR = {
    "e.g": 1, "i.e": 1, "vs": 1, "cf": 1, "mr": 1, "mrs": 1, "ms": 1, "dr": 1, "prof": 1,
    "π.χ": 1, "δηλ": 1, "βλ": 1, "σελ": 1, "τηλ": 1, "κ": 1, "κα": 1, "κος": 1, "αρ": 1, "π.μ": 1, "μ.μ": 1
  };
  var TERMS = { ".": 1, "!": 1, "?": 1, "…": 1, "‼": 1, "⁇": 1 };
  var CLOSERS = { "\"": 1, "'": 1, "»": 1, "”": 1, "’": 1, ")": 1, "]": 1, "}": 1 };

  // The word (letters and dots) right before position i, folded.
  function wordBefore(cps, i) {
    var j = i - 1, w = "";
    while (j >= 0 && (isLetter(cps[j]) || isMark(cps[j]) || cps[j] === ".")) { w = cps[j] + w; j--; }
    return foldKey(w.replace(/\.+$/, ""));
  }

  function sentence(text, lang, words) {
    var L = langOf(text, lang);
    var cps = Array.from(lower(text, L).normalize("NFC"));
    var start = true, afterTerm = false, lastGreek = false;
    for (var i = 0; i < cps.length; i++) {
      var ch = cps[i];
      if (start) {
        if (isLetter(ch)) { cps[i] = upperChar(ch, L); start = false; }
        else if (RE_DIGIT.test(ch)) start = false;
      }
      if (isLetter(ch)) lastGreek = isGreekLetter(ch);
      if (ch === "\n") { start = true; afterTerm = false; continue; }
      if (TERMS[ch] || (ch === ";" && lastGreek)) {
        afterTerm = !(ch === "." && ABBR[wordBefore(cps, i)]);
        continue;
      }
      if (afterTerm && RE_SPACE.test(ch)) { start = true; afterTerm = false; continue; }
      if (afterTerm && (CLOSERS[ch] || TERMS[ch])) continue;
      afterTerm = false;
    }
    var out = cps.join("");
    if (L !== "tr" && L !== "de") {
      // English "i" on its own (also i'm, i'll, i've, i'd).
      out = out.replace(/(^|[^\p{L}\p{M}\p{N}])i(?=$|[^\p{L}\p{M}\p{N}]|['’](?:m|ll|ve|d)\b)/gu, "$1I");
    }
    return applyWords(out, words);
  }

  // ---------- Title Case / Capitalize Each Word ----------
  var SMALL = {
    en: ["a", "an", "the", "and", "but", "or", "nor", "for", "so", "yet", "as", "at", "by", "in", "of",
         "off", "on", "per", "to", "up", "via", "vs", "from", "into", "onto", "with", "over"],
    el: ["ο", "η", "το", "οι", "τα", "του", "της", "των", "τον", "την", "τη", "τις", "τους", "και", "κι",
         "σε", "στο", "στη", "στην", "στον", "στα", "στις", "στους", "με", "για", "από", "απ", "ως", "προς",
         "να", "θα", "ή", "αλλά", "ένα", "μια", "μία", "ένας", "έναν"]
  };
  var SMALL_EN = {}, SMALL_EL = {};
  SMALL.en.forEach(function (w) { SMALL_EN[w] = 1; });
  SMALL.el.forEach(function (w) { SMALL_EL[w] = 1; });
  var BREAKS = /[\n:.!?;—–]/;

  function words2(text, lang, words, smart) {
    var L = langOf(text, lang);
    var s = lower(text, L).normalize("NFC");
    var hits = [], m;
    RE_WORD.lastIndex = 0;
    while ((m = RE_WORD.exec(s))) hits.push({ i: m.index, w: m[0] });
    var out = "", pos = 0;
    for (var k = 0; k < hits.length; k++) {
      var h = hits[k], w = h.w;
      out += s.slice(pos, h.i);
      var cap = true;
      if (smart) {
        var first = k === 0 || BREAKS.test(s.slice(hits[k - 1].i + hits[k - 1].w.length, h.i));
        var last = k === hits.length - 1 || BREAKS.test(s.slice(h.i + w.length, hits[k + 1].i));
        var key = foldKey(w);
        var small = isGreekLetter(Array.from(w)[0]) ? SMALL_EL[key] || SMALL_EL[w] :
                    (L === "tr" || L === "de" ? false : SMALL_EN[key]);
        if (small && !first && !last) cap = false;
      }
      out += cap ? capFirstLetter(w, L) : w;
      pos = h.i + w.length;
    }
    out += s.slice(pos);
    return applyWords(out, words);
  }
  function title(text, lang, words) { return words2(text, lang, words, true); }
  function capitalize(text, lang, words) { return words2(text, lang, words, false); }

  // ---------- tOGGLE / aLtErNaTiNg ----------
  function toggle(text, lang) {
    var L = langOf(text, lang);
    var cps = Array.from(str(text).normalize("NFC"));
    for (var i = 0; i < cps.length; i++) {
      var c = cps[i], u = upperChar(c, L), l = lowerChar(c, L);
      if (c === l && c !== u) cps[i] = u;
      else if (c === u && c !== l) cps[i] = l;
    }
    return fixSigma(cps.join(""));
  }
  function alternating(text, lang) {
    var L = langOf(text, lang);
    var cps = Array.from(str(text).normalize("NFC")), n = 0;
    for (var i = 0; i < cps.length; i++) {
      if (!isLetter(cps[i])) continue;
      cps[i] = n % 2 ? upperChar(cps[i], L) : lowerChar(cps[i], L);
      n++;
    }
    return fixSigma(cps.join(""));
  }

  // ---------- Accents ----------
  function removeAccents(text) {
    return str(text).normalize("NFD").replace(/[̀-ͯ]/g, "").normalize("NFC");
  }

  // ---------- Greek → Latin ----------
  var ELOT = {
    "α": "a", "β": "v", "γ": "g", "δ": "d", "ε": "e", "ζ": "z", "η": "i", "θ": "th", "ι": "i", "κ": "k",
    "λ": "l", "μ": "m", "ν": "n", "ξ": "x", "ο": "o", "π": "p", "ρ": "r", "σ": "s", "ς": "s", "τ": "t",
    "υ": "y", "φ": "f", "χ": "ch", "ψ": "ps", "ω": "o"
  };
  var CASUAL = {
    "α": "a", "β": "v", "γ": "g", "δ": "d", "ε": "e", "ζ": "z", "η": "h", "θ": "th", "ι": "i", "κ": "k",
    "λ": "l", "μ": "m", "ν": "n", "ξ": "ks", "ο": "o", "π": "p", "ρ": "r", "σ": "s", "ς": "s", "τ": "t",
    "υ": "y", "φ": "f", "χ": "x", "ψ": "ps", "ω": "w"
  };
  var VOICELESS = { "θ": 1, "κ": 1, "ξ": 1, "π": 1, "σ": 1, "ς": 1, "τ": 1, "φ": 1, "χ": 1, "ψ": 1 };

  // casual = false: ELOT 743 (as on Greek passports); true: Greeklish.
  function toLatin(text, casual) {
    var T = casual ? CASUAL : ELOT;
    var cl = clusters(str(text).normalize("NFD"));
    var g = cl.map(function (c) { return isGreekLetter(c.b); });
    // Words written all in capitals (two letters or more) stay in capitals.
    var caps = new Array(cl.length);
    for (var a = 0; a < cl.length;) {
      if (!g[a]) { a++; continue; }
      var b = a, up = true;
      while (b < cl.length && g[b]) { if (cl[b].b === cl[b].b.toLowerCase()) up = false; b++; }
      for (var q = a; q < b; q++) caps[q] = up && b - a > 1;
      a = b;
    }
    function low(i) { return i >= 0 && i < cl.length && g[i] ? cl[i].b.toLowerCase() : ""; }
    function dia(i) { return cl[i].m.indexOf("̈") >= 0; }
    function shape(piece, i) {
      if (caps[i]) return piece.toUpperCase();
      if (cl[i].b !== cl[i].b.toLowerCase()) return piece.charAt(0).toUpperCase() + piece.slice(1);
      return piece;
    }
    var out = "";
    for (var i = 0; i < cl.length; i++) {
      var c = cl[i];
      if (!g[i]) {
        out += c.b + c.m.join("");
        continue;
      }
      var l = low(i), n = low(i + 1), piece = null, used = 1;
      var nPlain = n && !dia(i + 1) && !hasAccent(c.m);
      if (l === "ο" && n === "υ" && nPlain) piece = "ou";
      else if ((l === "α" || l === "ε" || l === "η") && n === "υ" && nPlain) {
        if (casual) piece = (l === "η" ? "h" : T[l]) + "u";
        else {
          var n2 = low(i + 2);
          piece = T[l] + (!n2 || VOICELESS[n2] ? "f" : "v");
        }
      } else if (l === "μ" && n === "π") {
        piece = casual ? (low(i - 1) ? "mp" : "b") : (!low(i - 1) || !low(i + 2) ? "b" : "mp");
      } else if (!casual && l === "γ" && (n === "γ" || n === "ξ" || n === "χ")) {
        piece = n === "γ" ? "ng" : (n === "ξ" ? "nx" : "nch");
      }
      if (piece !== null) used = 2;
      else piece = T[l] !== undefined ? T[l] : l;
      out += shape(piece, i);
      i += used - 1;
    }
    return out.normalize("NFC");
  }

  // ---------- Mixed letters ----------
  var LOOK_L2G = {
    "A": "Α", "B": "Β", "E": "Ε", "Z": "Ζ", "H": "Η", "I": "Ι", "K": "Κ", "M": "Μ", "N": "Ν", "O": "Ο",
    "P": "Ρ", "T": "Τ", "X": "Χ", "Y": "Υ", "o": "ο", "v": "ν", "u": "υ", "i": "ι", "x": "χ", "p": "ρ"
  };
  var LOOK_G2L = {};
  Object.keys(LOOK_L2G).forEach(function (k) { LOOK_G2L[LOOK_L2G[k]] = k; });

  // Words that mix Greek and Latin letters get the letters of the
  // script most of the word is in (ties: the script of the text).
  function fixMixed(text, lang) {
    var s = str(text).normalize("NFC"), n = 0;
    var textGreek = langOf(s, lang === "el" ? "el" : "auto") === "el";
    var out = s.replace(/[\p{L}\p{M}]+/gu, function (w) {
      var cps = Array.from(w), gr = 0, la = 0, gOnly = 0, lOnly = 0;
      cps.forEach(function (c) {
        if (isGreekLetter(c)) { gr++; if (!LOOK_G2L[c]) gOnly++; }
        else if (isLatinLetter(c)) { la++; if (!LOOK_L2G[c]) lOnly++; }
      });
      if (!gr || !la) return w;
      var toGreek = gOnly !== lOnly ? gOnly > lOnly : (gr !== la ? gr > la : textGreek);
      var map = toGreek ? LOOK_L2G : LOOK_G2L;
      var res = cps.map(function (c) { return map[c] || c; }).join("");
      if (res !== w) n++;
      return res;
    });
    return { text: out, n: n };
  }

  // ---------- Code cases ----------
  function codeWords(line, keepGreek) {
    var s = removeAccents(keepGreek ? line : toLatin(line, false));
    s = s.replace(/([\p{Ll}\p{N}])(\p{Lu})/gu, "$1 $2").replace(/(\p{Lu})(\p{Lu}\p{Ll})/gu, "$1 $2");
    return s.split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  }
  function cap1(w) { var c = Array.from(w); return c.length ? upperChar(c[0], "en") + lower(c.slice(1).join(""), "en") : ""; }
  var CODE = {
    camel:    function (ws) { return ws.map(function (w, i) { return i ? cap1(w) : lower(w, "en"); }).join(""); },
    pascal:   function (ws) { return ws.map(cap1).join(""); },
    snake:    function (ws) { return ws.map(function (w) { return lower(w, "en"); }).join("_"); },
    kebab:    function (ws) { return ws.map(function (w) { return lower(w, "en"); }).join("-"); },
    constant: function (ws) { return ws.map(function (w) { return upper(w, "en"); }).join("_"); },
    dot:      function (ws) { return ws.map(function (w) { return lower(w, "en"); }).join("."); },
    path:     function (ws) { return ws.map(function (w) { return lower(w, "en"); }).join("/"); },
    train:    function (ws) { return ws.map(cap1).join("-"); }
  };
  function codeCase(text, style, keepGreek) {
    return str(text).split("\n").map(function (line) {
      var ws = codeWords(line, keepGreek);
      return ws.length ? fixSigma(CODE[style](ws)) : line.trim();
    }).join("\n");
  }

  // ---------- Unicode styles ----------
  // Mathematical letters (Latin, Greek where Unicode has them, digits).
  // Letters a style has no form for stay as they are.
  var MATH = {
    bold:       { U: 0x1d400, L: 0x1d41a, D: 0x1d7ce, GU: 0x1d6a8, GL: 0x1d6c2 },
    italic:     { U: 0x1d434, L: 0x1d44e, GU: 0x1d6e2, GL: 0x1d6fc, H: { "h": 0x210e } },
    bolditalic: { U: 0x1d468, L: 0x1d482, GU: 0x1d71c, GL: 0x1d736 },
    sansbold:   { U: 0x1d5d4, L: 0x1d5ee, D: 0x1d7ec, GU: 0x1d756, GL: 0x1d770 },
    mono:       { U: 0x1d670, L: 0x1d68a, D: 0x1d7f6 },
    double:     { U: 0x1d538, L: 0x1d552, D: 0x1d7d8,
                  H: { "C": 0x2102, "H": 0x210d, "N": 0x2115, "P": 0x2119, "Q": 0x211a, "R": 0x211d, "Z": 0x2124 } }
  };
  var SMALLCAPS = "ᴀʙᴄᴅᴇꜰɢʜɪᴊᴋʟᴍɴᴏᴘǫʀꜱᴛᴜᴠᴡxʏᴢ";
  var STYLES = ["bold", "italic", "bolditalic", "sansbold", "mono", "double", "smallcaps", "wide", "circled", "strike", "under"];

  function styleChar(ch, style) {
    var c = ch.codePointAt(0), def = MATH[style];
    if (def) {
      if (def.H && def.H[ch]) return String.fromCodePoint(def.H[ch]);
      if (c >= 65 && c <= 90) return String.fromCodePoint(def.U + c - 65);
      if (c >= 97 && c <= 122) return String.fromCodePoint(def.L + c - 97);
      if (def.D && c >= 48 && c <= 57) return String.fromCodePoint(def.D + c - 48);
      if (def.GU && c >= 0x391 && c <= 0x3a9 && c !== 0x3a2) return String.fromCodePoint(def.GU + c - 0x391);
      if (def.GL && c >= 0x3b1 && c <= 0x3c9) return String.fromCodePoint(def.GL + c - 0x3b1);
      return ch;
    }
    if (style === "smallcaps") {
      if (c >= 97 && c <= 122) return Array.from(SMALLCAPS)[c - 97];
      return ch;
    }
    if (style === "wide") {
      if (c >= 0x21 && c <= 0x7e) return String.fromCodePoint(c + 0xfee0);
      if (c === 0x20) return "　";
      return ch;
    }
    if (style === "circled") {
      if (c >= 65 && c <= 90) return String.fromCodePoint(0x24b6 + c - 65);
      if (c >= 97 && c <= 122) return String.fromCodePoint(0x24d0 + c - 97);
      if (c >= 49 && c <= 57) return String.fromCodePoint(0x2460 + c - 49);
      if (c === 48) return "⓪";
      return ch;
    }
    return ch;
  }

  function stylize(text, style) {
    var s = str(text);
    if (style === "strike" || style === "under") {
      var mark = style === "strike" ? "̶" : "̲";
      return clusters(s.normalize("NFC")).map(function (c) {
        var t = c.b + c.m.join("");
        return RE_SPACE.test(c.b) ? t : t + mark;
      }).join("");
    }
    return clusters(s.normalize("NFD")).map(function (c) {
      return styleChar(c.b, style) + c.m.join("");
    }).join("").normalize("NFC");
  }

  // Back to plain text: every character any style makes, reversed.
  var PLAIN = null;
  function plainMap() {
    if (PLAIN) return PLAIN;
    PLAIN = {};
    var src = [];
    for (var c = 32; c <= 126; c++) src.push(String.fromCharCode(c));
    for (var g = 0x391; g <= 0x3c9; g++) if (g !== 0x3a2) src.push(String.fromCodePoint(g));
    STYLES.forEach(function (st) {
      if (st === "strike" || st === "under") return;
      src.forEach(function (ch) {
        var s = styleChar(ch, st);
        if (s !== ch && !(s in PLAIN)) PLAIN[s] = ch;
      });
    });
    return PLAIN;
  }
  function plain(text) {
    var map = plainMap();
    return Array.from(str(text)).map(function (ch) {
      if (ch === "̶" || ch === "̲") return "";
      return map[ch] !== undefined ? map[ch] : ch;
    }).join("").normalize("NFC");
  }

  // ---------- The conversions ----------
  var TABS = {
    basic:  ["upper", "lower", "sentence", "title", "capital", "toggle", "alt"],
    greek:  ["noaccents", "elot", "greeklish", "mixed"],
    code:   ["camel", "pascal", "snake", "kebab", "constant", "dot", "path", "train"],
    styles: STYLES.concat(["plain"])
  };
  var MODES = [];
  Object.keys(TABS).forEach(function (k) { MODES = MODES.concat(TABS[k]); });

  // opts: { lang, words (strings or {w}), keepGreek }
  // → { text, n } (n: words fixed by "mixed", else 0)
  function convert(mode, text, opts) {
    var o = opts || {}, s = str(text), lang = o.lang || "auto";
    switch (mode) {
      case "upper":     return { text: upper(s, lang), n: 0 };
      case "lower":     return { text: lower(s, lang), n: 0 };
      case "sentence":  return { text: sentence(s, lang, o.words), n: 0 };
      case "title":     return { text: title(s, lang, o.words), n: 0 };
      case "capital":   return { text: capitalize(s, lang, o.words), n: 0 };
      case "toggle":    return { text: toggle(s, lang), n: 0 };
      case "alt":       return { text: alternating(s, lang), n: 0 };
      case "noaccents": return { text: removeAccents(s), n: 0 };
      case "elot":      return { text: toLatin(s, false), n: 0 };
      case "greeklish": return { text: toLatin(s, true), n: 0 };
      case "mixed":     return fixMixed(s, lang);
      case "plain":     return { text: plain(s), n: 0 };
    }
    if (CODE[mode]) return { text: codeCase(s, mode, !!o.keepGreek), n: 0 };
    if (STYLES.indexOf(mode) >= 0) return { text: stylize(s, mode), n: 0 };
    return { text: s, n: 0 };
  }

  // Only [start, end) changes; an empty range converts everything.
  function convertRange(mode, text, start, end, opts) {
    var s = str(text);
    if (!isInt(start) || !isInt(end) || start < 0 || end > s.length || start >= end) return convert(mode, s, opts);
    var r = convert(mode, s.slice(start, end), opts);
    return { text: s.slice(0, start) + r.text + s.slice(end), n: r.n, start: start, end: start + r.text.length };
  }

  // ---------- Counts ----------
  function counts(text) {
    var s = str(text), chars;
    try {
      var seg = new Intl.Segmenter(undefined, { granularity: "grapheme" });
      chars = 0;
      for (var it = seg.segment(s)[Symbol.iterator](), r = it.next(); !r.done; r = it.next()) chars++;
    } catch (e) { chars = Array.from(s).length; }
    var w = s.match(/[\p{L}\p{N}]+(?:[-'’][\p{L}\p{N}]+)*/gu);
    return { chars: chars, words: w ? w.length : 0, lines: s ? s.split("\n").length : 0 };
  }

  // ---------- My words: data + merge ----------
  function fnv(s) {
    var h = 0x811c9dc5;
    for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
    return h.toString(36);
  }
  function wordId(w) { return "w" + fnv(foldKey(w)); }

  // A valid word: 1–40 characters, no spaces or control characters.
  function cleanWord(w) {
    var s = str(w).normalize("NFC").trim();
    if (!s || Array.from(s).length > MAX_WORD_LEN) return "";
    if (/[\s\u0000-\u001f\u007f<>]/.test(s)) return "";
    if (!/[\p{L}\p{N}]/u.test(s)) return "";
    return s;
  }

  function normWord(x) {
    if (!x || typeof x !== "object") return null;
    var w = cleanWord(x.w);
    if (!w || typeof x.id !== "string" || x.id !== wordId(w) || !isInt(x.m) || x.m < 0) return null;
    return { id: x.id, w: w, m: x.m };
  }

  function mergeWords(A, B) {
    var a = A || {}, b = B || {};
    var tombs = {};
    [a.tombs, b.tombs].forEach(function (tm) {
      if (!tm || typeof tm !== "object" || Array.isArray(tm)) return;
      Object.keys(tm).forEach(function (k) {
        if (!/^w[0-9a-z]+$/.test(k) || !isInt(tm[k]) || tm[k] < 0) return;
        if (!(k in tombs) || tm[k] > tombs[k]) tombs[k] = tm[k];
      });
    });
    var best = {};
    [a.words, b.words].forEach(function (list) {
      if (!Array.isArray(list)) return;
      list.forEach(function (x) {
        var d = normWord(x);
        if (!d) return;
        var cur = best[d.id];
        if (!cur || d.m > cur.m || (d.m === cur.m && JSON.stringify(d) > JSON.stringify(cur))) best[d.id] = d;
      });
    });
    var words = [];
    Object.keys(best).sort(cmpStr).forEach(function (k) {
      if (k in tombs && tombs[k] >= best[k].m) return;
      words.push(best[k]);
    });
    var sorted = {};
    Object.keys(tombs).sort(cmpStr).forEach(function (k) { sorted[k] = tombs[k]; });
    return { ver: DATA_VER, words: words, tombs: sorted };
  }

  // → { data, ok, why } why: "bad" | "full" | "same"
  function addWord(data, w, now) {
    var cur = mergeWords(data, null);
    var clean = cleanWord(w);
    if (!clean) return { data: cur, ok: false, why: "bad" };
    var id = wordId(clean), old = null;
    cur.words.forEach(function (x) { if (x.id === id) old = x; });
    if (old && old.w === clean) return { data: cur, ok: false, why: "same" };
    if (!old && cur.words.length >= MAX_WORDS) return { data: cur, ok: false, why: "full" };
    var m = Math.max(now, (cur.tombs[id] || 0) + 1, old ? old.m + 1 : 0);
    return { data: mergeWords(cur, { words: [{ id: id, w: clean, m: m }] }), ok: true, id: id };
  }

  function removeWord(data, id, now) {
    var cur = mergeWords(data, null), old = null;
    cur.words.forEach(function (x) { if (x.id === id) old = x; });
    if (!old) return cur;
    var tomb = {};
    tomb[id] = Math.max(now, old.m);
    return mergeWords(cur, { tombs: tomb });
  }

  // First use on a device with no words and no deletions: the seed
  // list, m = 1 (any real change wins over it, R16 ids).
  var SEEDS = ["NASA", "UNESCO", "PDF", "URL", "USB", "Wi-Fi", "iPhone", "iPad", "YouTube", "orOS",
               "ΔΕΗ", "ΟΤΕ", "ΦΠΑ", "ΑΦΜ", "ΑΜΚΑ", "ΕΦΚΑ", "ΚΤΕΟ", "ΗΠΑ", "ΕΕ"];
  function seeded(data) {
    var cur = mergeWords(data, null);
    if (cur.words.length || Object.keys(cur.tombs).length) return cur;
    return mergeWords(cur, { words: SEEDS.map(function (w) { return { id: wordId(w), w: w, m: 1 }; }) });
  }

  function sortedForList(data, lang) {
    var coll;
    try { coll = new Intl.Collator(lang === "el" ? "el" : "en", { sensitivity: "base" }); } catch (e) { coll = null; }
    return (data && data.words ? data.words.slice() : []).sort(function (x, y) {
      return coll ? coll.compare(x.w, y.w) : cmpStr(foldKey(x.w), foldKey(y.w));
    });
  }

  // ---------- Prefs (device-local, R10) ----------
  function readPrefs(raw) {
    var p = { tab: "basic", mode: "upper", lang: "auto", sel: false, keepGreek: false };
    if (!raw || typeof raw !== "object") return p;
    if (TABS[raw.tab]) p.tab = raw.tab;
    if (MODES.indexOf(raw.mode) >= 0) p.mode = raw.mode;
    if (LANGS.indexOf(raw.lang) >= 0) p.lang = raw.lang;
    p.sel = raw.sel === true;
    p.keepGreek = raw.keepGreek === true;
    return p;
  }

  var api = {
    VER: DATA_VER, DATA_KEY: DATA_KEY, PREFS_KEY: PREFS_KEY, DRAFT_KEY: DRAFT_KEY,
    MAX_DRAFT: MAX_DRAFT, MAX_WORDS: MAX_WORDS, MAX_WORD_LEN: MAX_WORD_LEN,
    LANGS: LANGS.slice(), TABS: TABS, MODES: MODES.slice(), STYLES: STYLES.slice(), SEEDS: SEEDS.slice(),
    langOf: langOf, fixSigma: fixSigma, upper: upper, lower: lower, sentence: sentence, title: title,
    capitalize: capitalize, toggle: toggle, alternating: alternating, removeAccents: removeAccents,
    toLatin: toLatin, fixMixed: fixMixed, codeCase: codeCase, stylize: stylize, plain: plain,
    applyWords: applyWords, convert: convert, convertRange: convertRange, counts: counts,
    foldKey: foldKey, wordId: wordId, cleanWord: cleanWord, mergeWords: mergeWords,
    addWord: addWord, removeWord: removeWord, seeded: seeded, sortedForList: sortedForList,
    readPrefs: readPrefs
  };

  if (typeof module === "object" && module.exports) module.exports = api;
  else root.TextCaseCore = api;
})(typeof window !== "undefined" ? window : this);
