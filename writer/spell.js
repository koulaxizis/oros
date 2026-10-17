// ============================================================
// orOS Writer — spelling (pure logic, no DOM)
// A small Hunspell-compatible checker written for orOS. It reads the
// .aff / .dic files of a Hunspell dictionary as DATA (nothing in them
// is ever run) and checks words the Hunspell way: a word is right
// when it is in the .dic, or when a prefix and / or suffix rule of the
// .aff takes it back to a .dic word that carries that rule's flag.
//   · Dictionary(affText, dicText): parse (dic words in one string,
//     an open-addressing hash table over their offsets: about 25 MB
//     for the 830,000 Greek words instead of ~60 MB as JS strings)
//   · dict.spell(word): case rules (Hello → hello, HELLO → hello /
//     Hello; Greek capitals without accents: ΚΑΛΗΜΕΡΑ → καλημέρα)
//   · dict.suggest(word, max): accent fixes, REP / MAP tables, one
//     edit with the TRY letters, two words; best first, in the case
//     of the word
//   · tokens(text): the words of a text with offsets (skips links,
//     e-mail addresses, words with digits)
//   · shouldCheck(word), scriptOf(word)
//   · mergeUserDict / userDictWords / userHas: "my dictionary"
// Supported .aff: SET, FLAG (char, long, num, UTF-8), TRY, REP, MAP,
// PFX / SFX (cross products), ICONV, NEEDAFFIX, FORBIDDENWORD,
// ONLYINCOMPOUND, NOSUGGEST, KEEPCASE. Not supported: compounding
// (words with digits are not checked, which covers en_US's
// ordinals), two-level suffixes, CIRCUMFIX.
// Loaded by spell-worker.js (importScripts), the tests (require)
// and writer.js (window.WriterSpell, tokens and the user list).
// ============================================================
(function (root) {
  "use strict";

  /* ---------- small text helpers ---------- */
  // i18n-inline-ok: Greek accent folding for the spell checker (data, no UI text)
  var GREEK_RE = /[Ͱ-Ͽἀ-῿]/;
  var LATIN_RE = /[A-Za-zÀ-ɏ]/;
  var UPPER_RE = /\p{Lu}/u, LOWER_RE = /\p{Ll}/u;
  var TONOS = { "α": "ά", "ε": "έ", "η": "ή", "ι": "ί", "ο": "ό", "υ": "ύ", "ω": "ώ", "ϊ": "ΐ", "ϋ": "ΰ" };
  var UNTONOS = { "ά": "α", "έ": "ε", "ή": "η", "ί": "ι", "ό": "ο", "ύ": "υ", "ώ": "ω", "ΐ": "ϊ", "ΰ": "ϋ",
                  "Ά": "Α", "Έ": "Ε", "Ή": "Η", "Ί": "Ι", "Ό": "Ο", "Ύ": "Υ", "Ώ": "Ω" };

  function scriptOf(w) {
    if (GREEK_RE.test(w)) return "el";
    if (LATIN_RE.test(w)) return "en";
    return "";
  }
  // lower: "hello", init: "Hello", all: "HELLO", mixed: "iPhone"
  function caseType(w) {
    var up = 0, low = 0, firstUp = false, n = 0;
    for (var ch of w) {
      if (UPPER_RE.test(ch)) { up++; if (n === 0) firstUp = true; }
      else if (LOWER_RE.test(ch)) low++;
      n++;
    }
    if (!up) return "lower";
    if (!low) return up > 1 ? "all" : "init";
    if (up === 1 && firstUp) return "init";
    return "mixed";
  }
  function finalSigma(w) { return w.replace(/σ(?=$|[^\p{L}])/gu, "ς"); }
  function lower(w) { return finalSigma(w.toLowerCase()); }
  function capitalize(w) {
    var cps = Array.from(w);
    return cps.length ? cps[0].toUpperCase() + cps.slice(1).join("") : w;
  }
  function stripTonos(w) {
    var out = "";
    for (var ch of w) out += UNTONOS[ch] || ch;
    return out;
  }
  // Greek capitals are written without accents: ΚΑΛΗΜΕΡΑ, not ΚΑΛΗΜΈΡΑ
  function upperLike(w) { return GREEK_RE.test(w) ? stripTonos(w).toUpperCase() : w.toUpperCase(); }
  function withCase(w, ct) {
    if (ct === "all") return upperLike(w);
    if (ct === "init") return capitalize(w);
    return w;
  }
  // Each placement of one tonos on a word without accents.
  function tonosVariants(w) {
    var out = [], cps = Array.from(w);
    for (var i = 0; i < cps.length; i++) {
      if (TONOS[cps[i]]) {
        var c = cps.slice();
        c[i] = TONOS[cps[i]];
        out.push(c.join(""));
      }
    }
    return out;
  }

  /* ---------- .aff ---------- */
  function condRegex(cond, suffix) {
    if (!cond || cond === ".") return null;
    var src = "", inSet = false;
    for (var i = 0; i < cond.length; i++) {
      var c = cond[i];
      if (c === "[") { inSet = true; src += "["; continue; }
      if (c === "]") { inSet = false; src += "]"; continue; }
      if (c === "^" && inSet && cond[i - 1] === "[") { src += "^"; continue; }
      if (c === "." && !inSet) { src += "[\\s\\S]"; continue; }
      src += c.replace(/[\\^$*+?(){}|]/g, "\\$&");
    }
    try { return new RegExp(suffix ? "(?:" + src + ")$" : "^(?:" + src + ")", "u"); }
    catch (e) { return null; }
  }

  function splitFlags(s, mode) {
    if (!s) return [];
    if (mode === "long") { var o = []; for (var i = 0; i < s.length; i += 2) o.push(s.substr(i, 2)); return o; }
    if (mode === "num") return s.split(",").map(function (x) { return x.trim(); }).filter(Boolean);
    if (mode === "UTF-8") return Array.from(s);
    return s.split("");
  }

  function parseAff(text) {
    var aff = { set: "UTF-8", flag: "char", tryChars: "", rep: [], map: [], iconv: [],
                pfx: [], sfx: [], needAffix: null, forbidden: null, onlyIn: null,
                noSuggest: null, keepCase: null };
    var lines = String(text || "").split(/\r?\n/);
    var pending = null;   // header of the PFX / SFX block being read
    for (var li = 0; li < lines.length; li++) {
      var line = lines[li];
      if (!line || line.charAt(0) === "#") continue;
      var p = line.trim().split(/\s+/);
      var key = p[0];
      if (key === "PFX" || key === "SFX") {
        var flag = p[1];
        if (pending && pending.key === key && pending.flag === flag && pending.left > 0 && p.length >= 4) {
          pending.left--;
          var strip = p[2] === "0" ? "" : p[2];
          var add = p[3] || "";
          var slash = add.indexOf("/");
          if (slash >= 0) add = add.slice(0, slash);
          if (add === "0") add = "";
          var rule = { flag: flag, cross: pending.cross, strip: strip, add: add,
                       cond: condRegex(p[4] || ".", key === "SFX") };
          (key === "PFX" ? aff.pfx : aff.sfx).push(rule);
        } else if (p.length >= 4 && /^\d+$/.test(p[3])) {
          pending = { key: key, flag: flag, cross: p[2] === "Y", left: +p[3] };
        }
        continue;
      }
      pending = null;
      switch (key) {
        case "SET": aff.set = p[1] || aff.set; break;
        case "FLAG": aff.flag = p[1] || "char"; break;
        case "TRY": aff.tryChars = p[1] || ""; break;
        case "REP": if (p.length >= 3) aff.rep.push([p[1].replace(/_/g, " "), p[2].replace(/_/g, " ")]); break;
        case "MAP": if (p.length >= 2 && !/^\d+$/.test(p[1])) aff.map.push(Array.from(p[1].replace(/[()]/g, ""))); break;
        case "ICONV": if (p.length >= 3) aff.iconv.push([p[1], p[2]]); break;
        case "NEEDAFFIX": case "PSEUDOROOT": aff.needAffix = p[1]; break;
        case "FORBIDDENWORD": aff.forbidden = p[1]; break;
        case "ONLYINCOMPOUND": aff.onlyIn = p[1]; break;
        case "NOSUGGEST": aff.noSuggest = p[1]; break;
        case "KEEPCASE": aff.keepCase = p[1]; break;
      }
    }
    aff.iconv.sort(function (a, b) { return b[0].length - a[0].length; });
    return aff;
  }

  /* ---------- .dic: words in one string + hash table ---------- */
  function hashStr(s, a, b) {   // FNV-1a over UTF-16 units of s[a, b)
    var h = 0x811c9dc5;
    for (var i = a; i < b; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
    return h >>> 0;
  }

  function Dictionary(affText, dicText) {
    var aff = this.aff = parseAff(affText);
    var dic = this.dic = String(dicText || "");
    // index the rules by the first / last letter of what they add
    this.sfxBy = {}; this.sfxEmpty = [];
    this.pfxBy = {}; this.pfxEmpty = [];
    var self = this;
    aff.sfx.forEach(function (r) {
      if (!r.add) self.sfxEmpty.push(r);
      else (self.sfxBy[r.add.slice(-1)] = self.sfxBy[r.add.slice(-1)] || []).push(r);
    });
    aff.pfx.forEach(function (r) {
      if (!r.add) self.pfxEmpty.push(r);
      else (self.pfxBy[r.add[0]] = self.pfxBy[r.add[0]] || []).push(r);
    });
    // one pass over the lines: [word start, word end, flags start, flags end]
    var n = 0, cap = 1024;
    var ws = new Uint32Array(cap), we = new Uint32Array(cap), fs = new Uint32Array(cap), fe = new Uint32Array(cap);
    var len = dic.length, pos = 0, first = true;
    while (pos < len) {
      var end = dic.indexOf("\n", pos);
      if (end < 0) end = len;
      var lineEnd = end;
      if (lineEnd > pos && dic.charCodeAt(lineEnd - 1) === 13) lineEnd--;
      if (first) { first = false; if (/^\s*\d+\s*$/.test(dic.slice(pos, lineEnd))) { pos = end + 1; continue; } }
      // the word ends at an unescaped "/", a tab, or (morphology) a space
      var i = pos, wEnd = -1, fStart = -1, fEnd = -1;
      for (; i < lineEnd; i++) {
        var c = dic.charCodeAt(i);
        if (c === 47 && i > pos && dic.charCodeAt(i - 1) !== 92) { wEnd = i; break; }   // "/"
        if (c === 9 || (c === 32 && i > pos)) { wEnd = i; break; }
      }
      if (wEnd < 0) wEnd = lineEnd;
      if (dic.charCodeAt(wEnd) === 47) {
        fStart = wEnd + 1; fEnd = fStart;
        while (fEnd < lineEnd) { var cc = dic.charCodeAt(fEnd); if (cc === 9 || cc === 32) break; fEnd++; }
      }
      if (wEnd > pos) {
        if (n === cap) {
          cap *= 2;
          var g = function (a) { var b = new Uint32Array(cap); b.set(a); return b; };
          ws = g(ws); we = g(we); fs = g(fs); fe = g(fe);
        }
        ws[n] = pos; we[n] = wEnd;
        fs[n] = fStart < 0 ? 0 : fStart; fe[n] = fStart < 0 ? 0 : fEnd;
        n++;
      }
      pos = end + 1;
    }
    this.n = n; this.ws = ws; this.we = we; this.fs = fs; this.fe = fe;
    var size = 1; while (size < n * 2) size <<= 1;
    var table = new Int32Array(size), mask = size - 1;
    for (var k = 0; k < n; k++) {
      var h = hashStr(dic, ws[k], we[k]) & mask;
      while (table[h]) h = (h + 1) & mask;
      table[h] = k + 1;
    }
    this.table = table; this.mask = mask;
    this._flagCache = new Map();
  }

  // All entries of a word: arrays of flags (one per homonym), or null.
  Dictionary.prototype.entries = function (w) {
    var dic = this.dic, mask = this.mask, table = this.table, L = w.length;
    var h = 0x811c9dc5;
    for (var i = 0; i < L; i++) { h ^= w.charCodeAt(i); h = Math.imul(h, 0x01000193); }
    h = (h >>> 0) & mask;
    var out = null, k;
    while ((k = table[h])) {
      k--;
      var s = this.ws[k];
      if (this.we[k] - s === L) {
        var same = true;
        for (var j = 0; j < L; j++) if (dic.charCodeAt(s + j) !== w.charCodeAt(j)) { same = false; break; }
        if (same) (out = out || []).push(this.flagsOf(k));
      }
      h = (h + 1) & mask;
    }
    return out;
  };
  Dictionary.prototype.flagsOf = function (k) {
    if (this.fs[k] === this.fe[k]) return [];
    var c = this._flagCache.get(k);
    if (!c) {
      c = splitFlags(this.dic.slice(this.fs[k], this.fe[k]), this.aff.flag);
      if (this._flagCache.size > 50000) this._flagCache.clear();
      this._flagCache.set(k, c);
    }
    return c;
  };

  // A root that may stand for w: has `need` (when given; and `need2`),
  // is not compound-only / forbidden, needs no affix when bare, and is
  // not "never suggest" while suggesting.
  Dictionary.prototype.rootOk = function (w, need, need2, sugg) {
    var list = this.entries(w);
    if (!list) return false;
    var a = this.aff;
    for (var i = 0; i < list.length; i++) {
      var f = list[i];
      if (a.forbidden && f.indexOf(a.forbidden) >= 0) continue;
      if (a.onlyIn && f.indexOf(a.onlyIn) >= 0) continue;
      if (sugg && a.noSuggest && f.indexOf(a.noSuggest) >= 0) continue;
      if (need) {
        if (f.indexOf(need) < 0) continue;
        if (need2 && f.indexOf(need2) < 0) continue;
      } else if (a.needAffix && f.indexOf(a.needAffix) >= 0) continue;
      return true;
    }
    return false;
  };
  Dictionary.prototype.forbidden = function (w) {
    var f = this.aff.forbidden;
    if (!f) return false;
    var list = this.entries(w);
    return !!(list && list.some(function (x) { return x.indexOf(f) >= 0; }));
  };

  Dictionary.prototype.sfxRules = function (w) {
    var a = this.sfxBy[w.slice(-1)];
    return a ? a.concat(this.sfxEmpty) : this.sfxEmpty;
  };
  Dictionary.prototype.pfxRules = function (w) {
    var a = this.pfxBy[w[0]];
    return a ? a.concat(this.pfxEmpty) : this.pfxEmpty;
  };

  // Suffix stripping on w (optionally also needing a prefix flag).
  Dictionary.prototype.viaSuffix = function (w, pfxFlag, sugg) {
    var rules = this.sfxRules(w);
    for (var i = 0; i < rules.length; i++) {
      var r = rules[i];
      if (pfxFlag && !r.cross) continue;
      var al = r.add.length;
      if (w.length <= al || (al && w.slice(-al) !== r.add)) continue;
      var stem = w.slice(0, w.length - al) + r.strip;
      if (r.cond && !r.cond.test(stem)) continue;
      if (this.rootOk(stem, r.flag, pfxFlag, sugg)) return true;
    }
    return false;
  };

  // The word exactly as written (no case changes).
  Dictionary.prototype.checkExact = function (w, sugg) {
    if (!w) return false;
    if (this.forbidden(w)) return false;
    if (this.rootOk(w, null, null, sugg)) return true;
    if (this.viaSuffix(w, null, sugg)) return true;
    var rules = this.pfxRules(w);
    for (var i = 0; i < rules.length; i++) {
      var r = rules[i];
      var al = r.add.length;
      if (w.length <= al || (al && w.slice(0, al) !== r.add)) continue;
      var stem = r.strip + w.slice(al);
      if (r.cond && !r.cond.test(stem)) continue;
      if (this.rootOk(stem, r.flag, null, sugg)) return true;
      if (r.cross && this.viaSuffix(stem, r.flag, sugg)) return true;
    }
    return false;
  };

  Dictionary.prototype.iconv = function (w) {
    var ic = this.aff.iconv;
    if (!ic.length) return w;
    for (var i = 0; i < ic.length; i++) if (w.indexOf(ic[i][0]) >= 0) w = w.split(ic[i][0]).join(ic[i][1]);
    return w;
  };

  // The forms of w tried for a lookup, by its case.
  Dictionary.prototype.forms = function (w) {
    var ct = caseType(w), out = [w];
    if (ct === "init") out.push(lower(w));
    else if (ct === "all") {
      var l = lower(w);
      out.push(l, capitalize(l));
      if (GREEK_RE.test(l)) {
        tonosVariants(stripTonos(l)).forEach(function (v) { out.push(v, capitalize(v)); });
      }
    }
    return out;
  };

  Dictionary.prototype.spell = function (word, sugg) {
    var w = this.iconv(String(word || "").normalize("NFC"));
    if (!w) return true;
    var f = this.forms(w);
    for (var i = 0; i < f.length; i++) if (this.checkExact(f[i], sugg)) return true;
    return false;
  };

  /* ---------- suggestions ---------- */
  function ngramScore(a, b) {   // shared 2-grams, a cheap likeness
    var grams = {}, n = 0, s = 0;
    for (var i = 0; i < a.length - 1; i++) { grams[a.substr(i, 2)] = (grams[a.substr(i, 2)] || 0) + 1; }
    for (var j = 0; j < b.length - 1; j++) {
      var g = b.substr(j, 2);
      if (grams[g]) { grams[g]--; s++; }
      n++;
    }
    return s * 2 / Math.max(1, (a.length - 1) + n);
  }
  function charOverlap(a, b) {   // shared letters, any order
    var bag = {}, s = 0;
    for (var ch of a) bag[ch] = (bag[ch] || 0) + 1;
    for (var c2 of b) if (bag[c2]) { bag[c2]--; s++; }
    return s / Math.max(1, Math.max(Array.from(a).length, Array.from(b).length));
  }
  function likeness(a, b) {   // 0…1
    var fa = stripTonos(a.toLowerCase()), fb = stripTonos(b.toLowerCase());
    return 0.5 * charOverlap(fa, fb) + 0.4 * ngramScore(fa, fb) + (fa[0] === fb[0] ? 0.1 : 0);
  }

  Dictionary.prototype.suggest = function (word, max) {
    max = max || 6;
    var self = this;
    var w = this.iconv(String(word || "").normalize("NFC"));
    var ct = caseType(w);
    var base = (ct === "init" || ct === "all") ? lower(w) : w;
    var found = [], seen = {};
    seen[base] = 1; seen[w] = 1;
    var budget = 6000;
    function ok(s) {
      if (budget-- <= 0) return false;
      return self.checkExact(s, true) || self.checkExact(capitalize(s), true);
    }
    function add(s, pri) {
      if (!s || seen[s]) return;
      seen[s] = 1;
      if (s.indexOf(" ") >= 0 || ok(s)) found.push({ s: s, pri: pri });
    }
    var cps = Array.from(base), L = cps.length;
    // -1. only the capital is missing ("paris" → "Paris")
    if (ct === "lower" && self.checkExact(capitalize(base), true)) found.push({ s: base, pri: -1 });
    // 0. Greek: one accent in the right place (missing, extra, misplaced)
    if (GREEK_RE.test(base)) {
      var bare = stripTonos(base);
      add(bare, 0);
      tonosVariants(bare).forEach(function (v) { add(v, 0); });
      add(finalSigma(base), 0);
    }
    // 1. REP table (common misspellings), MAP (related letters)
    this.aff.rep.forEach(function (r) {
      var from = r[0], to = r[1];
      if (!from) return;
      var at = base.indexOf(from), guard = 0;
      while (at >= 0 && guard++ < 20) {
        add(base.slice(0, at) + to + base.slice(at + from.length), 1);
        at = base.indexOf(from, at + 1);
      }
    });
    if (this.aff.map.length) {
      for (var i = 0; i < L; i++) {
        this.aff.map.forEach(function (grp) {
          if (grp.indexOf(cps[i]) < 0) return;
          grp.forEach(function (c) {
            if (c !== cps[i]) { var x = cps.slice(); x[i] = c; add(x.join(""), 1); }
          });
        });
      }
    }
    // 2. one edit: swap, delete, replace, insert (TRY letters)
    var tryChars = Array.from(this.aff.tryChars || "abcdefghijklmnopqrstuvwxyz");
    if (ct !== "lower") tryChars = tryChars.filter(function (c) { return !UPPER_RE.test(c); });
    for (var a = 0; a < L - 1; a++) {
      var sw = cps.slice(); var tmp = sw[a]; sw[a] = sw[a + 1]; sw[a + 1] = tmp;
      add(sw.join(""), 2);
    }
    for (var d = 0; d < L; d++) add(cps.slice(0, d).concat(cps.slice(d + 1)).join(""), 3);
    for (var r2 = 0; r2 < L; r2++) {
      for (var t = 0; t < tryChars.length; t++) {
        if (tryChars[t] === cps[r2]) continue;
        var rp = cps.slice(); rp[r2] = tryChars[t];
        add(rp.join(""), 3);
      }
    }
    for (var ins = 0; ins <= L; ins++) {
      for (var t2 = 0; t2 < tryChars.length; t2++) {
        add(cps.slice(0, ins).concat([tryChars[t2]], cps.slice(ins)).join(""), 3);
      }
    }
    // 3. two words ("alot" → "a lot")
    for (var sp = 1; sp < L; sp++) {
      var left = cps.slice(0, sp).join(""), right = cps.slice(sp).join("");
      if ((left.length > 2 || /^[aAI]$/.test(left)) && right.length > 2 &&
          self.checkExact(left, true) && self.checkExact(right, true)) add(left + " " + right, 4);
    }
    // the kind of fix first (as Hunspell), then the likeness
    found.forEach(function (f) {
      f.score = likeness(base, f.s) * 0.9 - f.pri;
      // Greek: the stress falls most often on the next-to-last syllable
      if (f.pri === 0 && /[άέήίόύώΐΰ][^αεηιουωάέήίόύώϊϋΐΰ]*[αεηιουω]+[^αεηιουωάέήίόύώϊϋΐΰ]*$/.test(f.s)) f.score += 0.05;
    });
    found.sort(function (x, y) { return y.score - x.score || (x.s < y.s ? -1 : 1); });
    var out = [], have = {};
    for (var k = 0; k < found.length && out.length < max; k++) {
      var s = found[k].s;
      // a dictionary word with its own capital ("Paris") keeps it
      var cased = (!self.checkExact(s, true) && self.checkExact(capitalize(s), true)) ? capitalize(s) : s;
      cased = withCase(cased, ct);
      if (cased === word || have[cased]) continue;
      have[cased] = 1;
      out.push(cased);
    }
    return out;
  };

  /* ---------- tokens ---------- */
  // Words (letters, marks, inner apostrophes) of a text: [{s, e, w}].
  // A run of non-space characters that looks like a link, an e-mail
  // address or a path is skipped whole; so is a word next to a digit
  // or an underscore (codes, ordinals, file names).
  var WORD_RE = /[\p{L}\p{M}]+(?:['’][\p{L}\p{M}]+)*/gu;
  function tokens(text) {
    text = String(text || "");
    var out = [], m;
    WORD_RE.lastIndex = 0;
    while ((m = WORD_RE.exec(text))) {
      var s = m.index, e = s + m[0].length;
      var before = text[s - 1] || "", after = text[e] || "";
      if (/[\p{N}_@\/\\#&=]/u.test(before) || /[\p{N}_@\\#&=]/u.test(after)) continue;
      if (after === "/" && text[e + 1] === "/") continue;
      // the whole non-space chunk around the word
      var cs = s, ce = e;
      while (cs > 0 && !/\s/.test(text[cs - 1])) cs--;
      while (ce < text.length && !/\s/.test(text[ce])) ce++;
      var chunk = text.slice(cs, ce);
      if (/:\/\/|^www\.|@|\.(com|org|net|gr|eu|io|html?)\b/i.test(chunk)) continue;
      out.push({ s: s, e: e, w: m[0] });
    }
    return out;
  }

  // Worth checking: two letters or more, not mixed case (iPhone,
  // McCartney), not a short all-capitals word (acronyms: NASA, ΟΤΕ).
  function shouldCheck(w) {
    var n = Array.from(w).length;
    if (n < 2) return false;
    var ct = caseType(w);
    if (ct === "mixed") return false;
    if (ct === "all" && n < 5) return false;
    return true;
  }

  /* ---------- my dictionary (synced) ----------
     { word: stamp } — a positive stamp = added then, negative = removed
     then. Merge keeps the larger |stamp| per word (equal → removed),
     then keeps at most USER_MAX entries, removals older first out. */
  var USER_MAX = 3000;
  function cleanWord(w) {
    w = String(w || "").normalize("NFC").trim();
    if (!w || w.length > 60 || /[\s<>]/.test(w)) return "";
    return w;
  }
  function canonUserDict(map) {
    var keys = Object.keys(map).filter(function (k) { return cleanWord(k) === k && Number.isFinite(map[k]) && map[k] !== 0; });
    if (keys.length > USER_MAX) {
      keys.sort(function (a, b) {
        var da = map[a] > 0 ? 1 : 0, db = map[b] > 0 ? 1 : 0;
        if (da !== db) return db - da;                         // words first
        return Math.abs(map[b]) - Math.abs(map[a]) || (a < b ? -1 : 1);   // newest first
      });
      keys = keys.slice(0, USER_MAX);
    }
    keys.sort();
    var out = {};
    keys.forEach(function (k) { out[k] = map[k]; });
    return out;
  }
  function mergeUserDict(a, b) {
    var out = {};
    [a, b].forEach(function (src) {
      if (!src || typeof src !== "object") return;
      Object.keys(src).forEach(function (k) {
        var v = Number(src[k]);
        if (!Number.isFinite(v) || v === 0) return;
        if (!(k in out)) { out[k] = v; return; }
        var o = out[k];
        if (Math.abs(v) > Math.abs(o) || (Math.abs(v) === Math.abs(o) && v < o)) out[k] = v;
      });
    });
    return canonUserDict(out);
  }
  function userDictWords(map) {
    return Object.keys(map || {}).filter(function (k) { return map[k] > 0; }).sort();
  }
  // "foo" in the list accepts foo, Foo and FOO; "Kubernetes" accepts
  // Kubernetes and KUBERNETES.
  function userHas(set, w) {
    if (!set || !w) return false;
    if (set.has(w)) return true;
    var ct = caseType(w);
    if (ct === "init" || ct === "all") {
      var l = lower(w);
      if (set.has(l) || (ct === "all" && set.has(capitalize(l)))) return true;
      if (ct === "all" && GREEK_RE.test(l)) {
        var hit = false;
        set.forEach(function (x) { if (!hit && upperLike(x) === w) hit = true; });
        return hit;
      }
    }
    return false;
  }

  var api = {
    Dictionary: Dictionary, parseAff: parseAff, tokens: tokens, shouldCheck: shouldCheck,
    scriptOf: scriptOf, caseType: caseType, lower: lower, stripTonos: stripTonos,
    mergeUserDict: mergeUserDict, canonUserDict: canonUserDict, userDictWords: userDictWords,
    userHas: userHas, cleanWord: cleanWord, USER_MAX: USER_MAX
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.WriterSpell = api;
})(typeof self !== "undefined" ? self : this);
