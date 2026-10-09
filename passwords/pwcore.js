// ============================================================
// orOS Password Generator — engine (v1.0.0)
// Pure logic, no DOM: the app (passwords.js) and the tests
// (tests/passwords.test.js) both load this file.
//   1. Randomness: crypto.getRandomValues only, uniform picks by
//      rejection sampling (no modulo bias). No Math.random here.
//   2. Character passwords + PIN, with exact entropy
//      (inclusion-exclusion over "every chosen set appears").
//   3. Diceware passphrases (EFF lists) + real-dice lookup.
//   4. Strength auditor: finds the cheapest way to guess a
//      password (common passwords, words, sequences, repeats,
//      keyboard walks, dates, brute force) and turns it into
//      bits, a 0–4 score, crack times and findings.
// Nothing here stores, logs or sends a password anywhere.
// ============================================================
(function (root) {
  "use strict";

  // ---------- 1. Randomness ----------
  var cryptoObj = (typeof globalThis !== "undefined" && globalThis.crypto) ||
                  (typeof root !== "undefined" && root && root.crypto) || null;

  function hasCrypto() {
    return !!(cryptoObj && typeof cryptoObj.getRandomValues === "function");
  }

  function randomU32() {
    if (!hasCrypto()) throw new Error("no-crypto");
    var a = new Uint32Array(1);
    cryptoObj.getRandomValues(a);
    return a[0];
  }

  // Uniform integer in [0, n), 1 <= n <= 2^32. Values in the
  // incomplete top bucket are thrown away and drawn again.
  var TWO32 = 4294967296;
  function randBelow(n) {
    if (!(n >= 1 && n <= TWO32 && Math.floor(n) === n)) throw new Error("bad range");
    if (n === 1) return 0;
    var limit = TWO32 - (TWO32 % n);
    var x;
    do { x = randomU32(); } while (x >= limit);
    return x % n;
  }

  function pick(str) { return str.charAt(randBelow(str.length)); }

  // log2 of a non-negative BigInt (exact enough for display).
  function log2Big(b) {
    if (b <= 0n) return 0;
    var s = b.toString(2);
    if (s.length <= 53) return Math.log2(parseInt(s, 2));
    return Math.log2(parseInt(s.slice(0, 53), 2)) + (s.length - 53);
  }

  function log2(x) { return x > 0 ? Math.log2(x) : 0; }

  // ---------- 2. Character passwords ----------
  var LOWER   = "abcdefghijklmnopqrstuvwxyz";
  var UPPER   = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  var DIGITS  = "0123456789";
  var SYMBOLS = "!\"#$%&'()*+,-./:;<=>?@[\\]^_`{|}~";
  var AMBIG   = "0Oo1lI|`'\"";
  var LEN_MIN = 4, LEN_MAX = 128, LEN_DEF = 20;
  var PIN_MIN = 4, PIN_MAX = 12, PIN_DEF = 6;

  function strip(set, chars) {
    var out = "";
    for (var i = 0; i < set.length; i++) {
      if (chars.indexOf(set.charAt(i)) < 0) out += set.charAt(i);
    }
    return out;
  }

  // A custom symbol set: printable ASCII punctuation only, no
  // duplicates, in the order typed. Letters, digits, spaces and
  // anything outside ASCII are dropped.
  function normSymbols(s) {
    var out = "";
    if (typeof s !== "string") return out;
    for (var i = 0; i < s.length; i++) {
      var c = s.charAt(i);
      if (SYMBOLS.indexOf(c) >= 0 && out.indexOf(c) < 0) out += c;
    }
    return out;
  }

  function clampInt(v, lo, hi, def) {
    v = Math.round(Number(v));
    if (!isFinite(v)) return def;
    return Math.min(hi, Math.max(lo, v));
  }

  // opts: { length, lower, upper, digits, symbols, noAmbig, custom }
  // custom = "" uses every symbol, otherwise only those typed.
  // Returns the sets in use (never empty strings), in a fixed order.
  function charSets(opts) {
    opts = opts || {};
    var sets = [];
    var sym = opts.custom ? normSymbols(opts.custom) : SYMBOLS;
    if (opts.lower)   sets.push({ id: "lower",   chars: LOWER });
    if (opts.upper)   sets.push({ id: "upper",   chars: UPPER });
    if (opts.digits)  sets.push({ id: "digits",  chars: DIGITS });
    if (opts.symbols) sets.push({ id: "symbols", chars: sym });
    if (opts.noAmbig) sets.forEach(function (s) { s.chars = strip(s.chars, AMBIG); });
    return sets.filter(function (s) { return s.chars.length > 0; });
  }

  // Exact count of strings of length L over the union that contain at
  // least one character of every set (sets are disjoint).
  function countValid(sizes, L) {
    var k = sizes.length, total = 0;
    sizes.forEach(function (s) { total += s; });
    var sum = 0n;
    for (var mask = 0; mask < (1 << k); mask++) {
      var left = total, bits = 0;
      for (var j = 0; j < k; j++) if (mask & (1 << j)) { left -= sizes[j]; bits++; }
      var term = BigInt(left) ** BigInt(L);
      sum += (bits % 2) ? -term : term;
    }
    return sum;
  }

  function passwordBits(opts) {
    var sets = charSets(opts);
    var L = clampInt(opts && opts.length, LEN_MIN, LEN_MAX, LEN_DEF);
    if (!sets.length || L < sets.length) return 0;
    return log2Big(countValid(sets.map(function (s) { return s.chars.length; }), L));
  }

  // Uniform over all strings that hold every chosen set: draw from
  // the union, reject the whole string when a set is missing.
  function genPassword(opts) {
    var sets = charSets(opts);
    var L = clampInt(opts && opts.length, LEN_MIN, LEN_MAX, LEN_DEF);
    if (!sets.length) throw new Error("no-sets");
    if (L < sets.length) throw new Error("too-short");
    var all = sets.map(function (s) { return s.chars; }).join("");
    for (;;) {
      var pw = "";
      for (var i = 0; i < L; i++) pw += pick(all);
      var ok = sets.every(function (s) {
        for (var j = 0; j < pw.length; j++) if (s.chars.indexOf(pw.charAt(j)) >= 0) return true;
        return false;
      });
      if (ok) return { value: pw, bits: passwordBits(opts) };
    }
  }

  function genPin(len) {
    var L = clampInt(len, PIN_MIN, PIN_MAX, PIN_DEF);
    var pin = "";
    for (var i = 0; i < L; i++) pin += pick(DIGITS);
    return { value: pin, bits: L * Math.log2(10) };
  }

  // Character class for colouring the shown password.
  function charClass(c) {
    if (/[0-9]/.test(c)) return "d";
    if (/[a-zA-Z]/.test(c)) return "l";
    if (/[Ͱ-Ͽἀ-῿]/.test(c)) return "l";
    return "s";
  }

  // ---------- 3. Diceware ----------
  var WORDS_MIN = 3, WORDS_MAX = 12, WORDS_DEF = 6;
  var SEPS = { space: " ", dash: "-", dot: ".", under: "_" };
  var EXTRA = "0123456789!#$%&*+=?@";

  var lists = {};
  function setLists(src) {
    lists = {};
    if (src && typeof src.large === "string") lists.large = src.large.split(" ");
    if (src && typeof src.short === "string") lists.short = src.short.split(" ");
  }
  function list(id) { return lists[id === "short" ? "short" : "large"] || []; }
  // Dice per word: 6^5 = 7776, 6^4 = 1296.
  function diceCount(id) { return id === "short" ? 4 : 5; }

  function capFirst(w) { return w.charAt(0).toUpperCase() + w.slice(1); }

  // opts: { list, words, sep, caps, extra }
  function genPassphrase(opts) {
    opts = opts || {};
    var words = list(opts.list);
    if (!words.length) throw new Error("no-list");
    var n = clampInt(opts.words, WORDS_MIN, WORDS_MAX, WORDS_DEF);
    var picked = [];
    for (var i = 0; i < n; i++) picked.push(words[randBelow(words.length)]);
    var shown = picked.map(function (w) { return opts.caps ? capFirst(w) : w; });
    var bits = n * Math.log2(words.length);
    if (opts.extra) {
      // One extra character at the end of one word: 20 × n choices.
      var at = randBelow(n);
      shown[at] += pick(EXTRA);
      bits += Math.log2(EXTRA.length * n);
    }
    var sep = SEPS.hasOwnProperty(opts.sep) ? SEPS[opts.sep] : " ";
    return { value: shown.join(sep), words: picked, bits: bits };
  }

  // "41526" (large) or "4152" (short) → the word, or null.
  function diceWord(code, id) {
    var need = diceCount(id);
    code = String(code == null ? "" : code).replace(/\s+/g, "");
    if (code.length !== need || !/^[1-6]+$/.test(code)) return null;
    var idx = 0;
    for (var i = 0; i < code.length; i++) idx = idx * 6 + (code.charCodeAt(i) - 49);
    var w = list(id);
    return w[idx] || null;
  }

  // ---------- 4. Strength auditor ----------
  var AUDIT_MAX = 256;    // longer input is cut (the DP is O(n²) at worst)
  var WORD_MAX = 24;      // longest substring tried against the word lists

  var dict = null;        // Map: lowercased word → bits (cheapest source)
  var dictCommon = null;  // Set: words whose cheapest source is the common list
  var commonRank = null;  // Map: exact common password → rank (1-based)

  function setCommon(text) {
    commonRank = new Map();
    if (typeof text !== "string") return;
    text.split("\n").forEach(function (p, i) {
      if (p && !commonRank.has(p)) commonRank.set(p, i + 1);
    });
    dict = null;
  }

  function buildDict() {
    dict = new Map();
    dictCommon = new Set();
    function add(w, bits, common) {
      if (!w) return;
      var k = w.toLowerCase();
      if (!dict.has(k) || dict.get(k) > bits) {
        dict.set(k, bits);
        if (common) dictCommon.add(k); else dictCommon.delete(k);
      }
    }
    var lb = log2(list("large").length), sb = log2(list("short").length);
    list("large").forEach(function (w) { if (w.length >= 3) add(w, lb); });
    list("short").forEach(function (w) { if (w.length >= 3) add(w, sb); });
    if (commonRank) commonRank.forEach(function (rank, p) {
      if (p.length >= 4) add(p, log2(rank), true);
    });
  }

  var LEET = { "4": "a", "@": "a", "3": "e", "1": "i", "!": "i", "0": "o",
               "$": "s", "5": "s", "7": "t", "+": "t", "8": "b", "9": "g" };

  // Undo leet; "1" can also stand for "l", so both spellings return.
  function unleet(s) {
    var a = "", b = "", n = 0;
    for (var i = 0; i < s.length; i++) {
      var c = s.charAt(i), m = LEET[c];
      if (m) { n++; a += m; b += (c === "1" ? "l" : m); } else { a += c; b += c; }
    }
    return { forms: a === b ? [a] : [a, b], subs: n };
  }

  function nCk(n, k) {
    var r = 1;
    for (var i = 1; i <= k; i++) r = r * (n - k + i) / i;
    return r;
  }
  // Extra bits for upper/lower-case mixing (zxcvbn idea).
  function caseBits(s) {
    var up = 0, low = 0;
    for (var i = 0; i < s.length; i++) {
      var c = s.charAt(i);
      if (c !== c.toLowerCase()) up++;
      else if (c !== c.toUpperCase()) low++;
    }
    if (!up) return 0;
    if (!low) return 1;
    if (up === 1 && s.charAt(0) !== s.charAt(0).toLowerCase()) return 1;
    var sum = 0;
    for (var k = 1; k <= Math.min(up, low); k++) sum += nCk(up + low, k);
    return log2(sum);
  }
  function leetBits(len, subs) {
    if (!subs) return 0;
    var sum = 0;
    for (var k = 1; k <= subs; k++) sum += nCk(len, k);
    return Math.max(1, log2(sum));
  }

  // Character pool for brute force over what no pattern explains.
  function poolSize(pw) {
    var size = 0;
    if (/[a-z]/.test(pw)) size += 26;
    if (/[A-Z]/.test(pw)) size += 26;
    if (/[0-9]/.test(pw)) size += 10;
    if (/[ -\/:-@\[-`{-~]/.test(pw)) size += 33;
    if (/[α-ωάέήίόύώϊϋΐΰς]/.test(pw)) size += 33;
    if (/[Α-ΩΆΈΉΊΌΎΏΪΫ]/.test(pw)) size += 33;
    if (/[^\x20-\x7eͰ-Ͽ]/.test(pw)) size += 100;
    return Math.max(size, 10);
  }

  // Keyboard rows (and well-known column walks), Latin and Greek.
  var KEY_ROWS = [
    "`1234567890-=", "~!@#$%^&*()_+", "qwertyuiop[]\\", "asdfghjkl;'", "zxcvbnm,./",
    "1qaz2wsx3edc4rfv5tgb6yhn7ujm8ik,9ol.0p;/", "qazwsxedcrfvtgbyhnujmikolp",
    "ςερτυθιοπ", "ασδφγηξκλ", "ζχψωβνμ",
    "789456123", "147258369", "0147852369"
  ];
  var KEY_BITS_BASE = log2(KEY_ROWS.length * 2 * 12);

  function keyboardMatches(pw, out) {
    var low = pw.toLowerCase();
    for (var i = 0; i < low.length; i++) {
      var best = 0;
      KEY_ROWS.forEach(function (row) {
        [row, row.split("").reverse().join("")].forEach(function (r) {
          for (var len = Math.min(low.length - i, r.length); len >= 4; len--) {
            if (len > best && r.indexOf(low.substr(i, len)) >= 0) { best = len; break; }
          }
        });
      });
      if (best >= 4) {
        out.push({ i: i, j: i + best, kind: "keyboard",
                   bits: KEY_BITS_BASE + log2(best) + caseBits(pw.substr(i, best)) });
      }
    }
  }

  // Runs of 3+ with a step of +1 or -1 inside one alphabet.
  var SEQ_CLASSES = [
    { re: /[a-z]/, size: 26 }, { re: /[A-Z]/, size: 26 }, { re: /[0-9]/, size: 10 },
    { re: /[α-ω]/, size: 24 }, { re: /[Α-Ω]/, size: 24 }
  ];
  function seqClass(c) {
    for (var k = 0; k < SEQ_CLASSES.length; k++) if (SEQ_CLASSES[k].re.test(c)) return k;
    return -1;
  }
  function sequenceMatches(pw, out) {
    var i = 0;
    while (i < pw.length - 2) {
      var cls = seqClass(pw.charAt(i));
      var d = pw.charCodeAt(i + 1) - pw.charCodeAt(i);
      var j = i + 1;
      if (cls >= 0 && (d === 1 || d === -1)) {
        while (j < pw.length && seqClass(pw.charAt(j)) === cls &&
               pw.charCodeAt(j) - pw.charCodeAt(j - 1) === d) j++;
      }
      if (j - i >= 3) {
        var first = pw.charAt(i);
        var start = /[aA1zZ9αΑ0]/.test(first) ? 4 : SEQ_CLASSES[cls].size;
        out.push({ i: i, j: j, kind: "sequence",
                   bits: log2(start * (j - i) * (d < 0 ? 2 : 1)) });
        i = j - 1;
      } else {
        i++;
      }
    }
  }

  // "aaaa" and repeated blocks such as "abcabc".
  function repeatMatches(pw, out, depth) {
    var n = pw.length;
    for (var i = 0; i < n; i++) {
      for (var b = 1; b <= (n - i) >> 1; b++) {
        var block = pw.substr(i, b), k = 1;
        while (pw.substr(i + k * b, b) === block) k++;
        if (k >= 2 && (b > 1 || k >= 3)) {
          var bb = b === 1 ? log2(poolSize(block)) : estimateBits(block, depth + 1);
          out.push({ i: i, j: i + k * b, kind: "repeat", bits: bb + log2(k) });
        }
      }
    }
  }

  // Years 1900–2039 and day-month-year shapes.
  var DATE_RES = [
    /^(\d{1,2})[\/.\- ](\d{1,2})[\/.\- ](\d{2}|\d{4})/,
    /^(\d{4})[\/.\- ](\d{1,2})[\/.\- ](\d{1,2})/,
    /^(\d{8})/, /^(\d{6})/
  ];
  function plausibleDate(digits) {
    function ok(d, m) { return d >= 1 && d <= 31 && m >= 1 && m <= 12; }
    function yr(y) { return (y >= 1900 && y <= 2039) || (y >= 0 && y <= 99); }
    var s = digits;
    if (s.length === 8) {
      var a = +s.slice(0, 2), b = +s.slice(2, 4), y = +s.slice(4);
      if (yr(y) && (ok(a, b) || ok(b, a))) return true;
      var y2 = +s.slice(0, 4), m2 = +s.slice(4, 6), d2 = +s.slice(6);
      return y2 >= 1900 && y2 <= 2039 && ok(d2, m2);
    }
    if (s.length === 6) {
      var p = +s.slice(0, 2), q = +s.slice(2, 4);
      return ok(p, q) || ok(q, p);
    }
    return false;
  }
  function dateMatches(pw, out) {
    for (var i = 0; i < pw.length; i++) {
      if (!/[0-9]/.test(pw.charAt(i)) || (i > 0 && /[0-9]/.test(pw.charAt(i - 1)))) continue;
      var rest = pw.slice(i);
      for (var r = 0; r < DATE_RES.length; r++) {
        var m = rest.match(DATE_RES[r]);
        if (!m) continue;
        var s = m[0];
        if (r < 2 || plausibleDate(s)) {
          out.push({ i: i, j: i + s.length, kind: "date",
                     bits: log2(366 * 140) + (r < 2 ? 1 : 0) });
          break;
        }
      }
      var y = rest.match(/^(19\d\d|20[0-3]\d)/);
      if (y) out.push({ i: i, j: i + 4, kind: "date", bits: log2(140) });
    }
  }

  function wordMatches(pw, out) {
    if (!dict) buildDict();
    var n = pw.length;
    for (var i = 0; i < n; i++) {
      for (var j = i + 3; j <= Math.min(n, i + WORD_MAX); j++) {
        var raw = pw.slice(i, j), low = raw.toLowerCase(), u = unleet(low);
        var best = Infinity, common = false;
        u.forms.forEach(function (f, fi) {
          if (!dict.has(f)) return;
          var extra = (fi === 0 && f === low) ? 0 : leetBits(raw.length, u.subs);
          var b = dict.get(f) + caseBits(raw) + extra;
          if (b < best) { best = b; common = dictCommon.has(f); }
        });
        if (best < Infinity) {
          out.push({ i: i, j: j, kind: common ? "common" : "word", bits: best });
        }
      }
    }
  }

  // The cheapest cover of the password by patterns + brute force.
  // Each pattern costs one extra bit (an attacker must also guess
  // which patterns follow each other).
  function analyse(pw, depth) {
    depth = depth || 0;
    var n = pw.length, out = [];
    if (!n) return { bits: 0, path: [] };
    if (commonRank && commonRank.has(pw)) {
      return { bits: log2(commonRank.get(pw)), path: [{ i: 0, j: n, kind: "common" }] };
    }
    if (depth < 2) {
      wordMatches(pw, out);
      sequenceMatches(pw, out);
      keyboardMatches(pw, out);
      dateMatches(pw, out);
      repeatMatches(pw, out, depth);
    }
    var brute = log2(poolSize(pw));
    var best = [0], from = [null];
    var byEnd = {};
    out.forEach(function (m) { (byEnd[m.j] = byEnd[m.j] || []).push(m); });
    for (var e = 1; e <= n; e++) {
      var cands = byEnd[e];
      best[e] = best[e - 1] + brute; from[e] = { i: e - 1, j: e, kind: "brute" };
      if (cands) cands.forEach(function (m) {
        var c = best[m.i] + m.bits + 1;
        if (c < best[e]) { best[e] = c; from[e] = m; }
      });
    }
    var path = [], at = n;
    while (at > 0) { path.unshift(from[at]); at = from[at].i; }
    var patterns = path.some(function (m) { return m.kind !== "brute"; });
    return { bits: Math.max(0, best[n] - (patterns ? 1 : 0)), path: path };
  }
  // Blocks of a repeat are scored once per audit (memo).
  var memo = null;
  function estimateBits(pw, depth) {
    var key = depth + ":" + pw;
    if (memo && memo.has(key)) return memo.get(key);
    var b = analyse(pw, depth).bits;
    if (memo) memo.set(key, b);
    return b;
  }

  // Words joined by one repeated separator ("a-b-c", "a b c"): the
  // separator is guessed once, not once per gap.
  function splitBits(pw) {
    var m = pw.match(/[ \-._+,;:\/|~*]/);
    if (!m) return Infinity;
    var sep = m[0], parts = pw.split(sep);
    if (parts.length < 3 || parts.some(function (p) { return !p; })) return Infinity;
    var sum = log2(33) + parts.length;
    parts.forEach(function (p) { sum += estimateBits(p, 1); });
    return sum;
  }

  // Seconds an attacker needs on average (half the space).
  var RATES = { online: 100 / 3600, slow: 1e4, fast: 1e10 };
  function crackSeconds(bits, rate) { return Math.pow(2, bits) / 2 / rate; }

  // → { unit, n }: unit is instant/seconds/minutes/hours/days/months/years/centuries.
  function humanTime(sec) {
    var MIN = 60, H = 3600, D = 86400, MO = D * 30.44, Y = D * 365.25;
    if (!(sec >= 1)) return { unit: "instant", n: 0 };
    if (sec < MIN) return { unit: "seconds", n: Math.round(sec) };
    if (sec < H) return { unit: "minutes", n: Math.round(sec / MIN) };
    if (sec < D) return { unit: "hours", n: Math.round(sec / H) };
    if (sec < MO) return { unit: "days", n: Math.round(sec / D) };
    if (sec < Y) return { unit: "months", n: Math.round(sec / MO) };
    if (sec < 100 * Y) return { unit: "years", n: Math.round(sec / Y) };
    return { unit: "centuries", n: Math.round(sec / (100 * Y)) };
  }

  function scoreOf(bits) {
    // 70 bits ≈ a thousand years against a fast offline attack.
    if (bits < 25) return 0;
    if (bits < 40) return 1;
    if (bits < 55) return 2;
    if (bits < 70) return 3;
    return 4;
  }

  // Full audit of one password. findings: keys the app translates.
  function audit(input) {
    var pw = String(input == null ? "" : input).slice(0, AUDIT_MAX);
    if (!pw) return null;
    memo = new Map();
    var a, split;
    try { a = analyse(pw, 0); split = splitBits(pw); } finally { memo = null; }
    var bits = Math.min(a.bits, split);
    var seen = {}, findings = [];
    function add(k) { if (!seen[k]) { seen[k] = 1; findings.push(k); } }
    // Short pattern hits inside random strings are noise, not advice.
    a.path.forEach(function (m) {
      if (m.kind === "brute" || (m.j - m.i < 4 && m.j - m.i < pw.length)) return;
      // A common password inside a longer phrase is just a word.
      add(m.kind === "common" && 2 * (m.j - m.i) < pw.length ? "word" : m.kind);
    });
    var classes = 0;
    [/[a-zα-ωάέήίόύώς]/, /[A-ZΑ-Ω]/, /[0-9]/, /[^a-zA-Z0-9α-ωΑ-Ωάέήίόύώς]/].forEach(function (re) {
      if (re.test(pw)) classes++;
    });
    if (pw.length < 12 && bits < 70) add("short");
    if (classes === 1 && bits < 55) add("oneclass");
    if (/^[A-ZΑ-Ω][^A-ZΑ-Ω]*$/.test(pw) && /[a-zα-ω]/.test(pw) && bits < 55) add("capfirst");
    if (/^[^0-9]*[a-zA-Zα-ωΑ-Ω][^0-9]*[0-9]{1,4}[^0-9a-zA-Zα-ωΑ-Ω]?$/.test(pw) && bits < 55) add("digitsend");
    var score = seen.common && a.path.length === 1 ? 0 : scoreOf(bits);
    return {
      bits: bits,
      score: score,
      length: pw.length,
      findings: findings,
      times: {
        online: humanTime(crackSeconds(bits, RATES.online)),
        slow:   humanTime(crackSeconds(bits, RATES.slow)),
        fast:   humanTime(crackSeconds(bits, RATES.fast))
      }
    };
  }

  var PwCore = {
    version: "1.0.0",
    hasCrypto: hasCrypto, randBelow: randBelow, log2Big: log2Big,
    LOWER: LOWER, UPPER: UPPER, DIGITS: DIGITS, SYMBOLS: SYMBOLS, AMBIG: AMBIG, EXTRA: EXTRA,
    LEN_MIN: LEN_MIN, LEN_MAX: LEN_MAX, LEN_DEF: LEN_DEF,
    PIN_MIN: PIN_MIN, PIN_MAX: PIN_MAX, PIN_DEF: PIN_DEF,
    WORDS_MIN: WORDS_MIN, WORDS_MAX: WORDS_MAX, WORDS_DEF: WORDS_DEF, SEPS: SEPS,
    normSymbols: normSymbols, charSets: charSets, countValid: countValid,
    passwordBits: passwordBits, genPassword: genPassword, genPin: genPin, charClass: charClass,
    setLists: setLists, list: list, diceCount: diceCount, genPassphrase: genPassphrase, diceWord: diceWord,
    setCommon: setCommon, analyse: analyse, audit: audit, scoreOf: scoreOf,
    humanTime: humanTime, crackSeconds: crackSeconds, RATES: RATES
  };

  if (typeof module === "object" && module.exports) module.exports = PwCore;
  else root.PwCore = PwCore;
})(this);
