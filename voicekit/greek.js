// ============================================================
// orOS voices — Greek text to phonemes (voicekit/greek.js, v1.0.0)
// Turns Greek text into the IPA phonemes a Piper voice was trained on
// (the Greek Piper voices were trained on espeak-ng's phonemes). Written
// here from Greek spelling rules, MIT like the rest of orOS: espeak-ng
// itself (GPL-3.0) is never shipped or loaded. tests/voicekit-greek.test.js
// checks the output against a list of words and sentences that espeak-ng
// phonemized (tests/fixtures/voicekit-greek.tsv), so the voice hears
// what it learned.
//   GreekVoice.words(text)      → the text with numbers, symbols and
//                                 short forms spelled out as Greek words
//   GreekVoice.word(w)          → the phonemes of one word ("kˌalimˈera")
//   GreekVoice.sentences(text)  → [{ text, ph }]: one entry per sentence,
//                                 ph = phonemes with spaces and punctuation
// Pure: no DOM, no network. UMD: module.exports in Node,
// window.GreekVoice in the browser and in workers.
// i18n-inline-ok: the Greek letters and words here are data (spelling rules, number words, short forms), not text to translate.
// ============================================================
(function (root) {
  "use strict";

  var ACUTE = { "\u0301": 1, "\u0341": 1, "\u0342": 1 };   // tonos, oxia, perispomeni
  var DIA = "\u0308";
  var VOWEL = "αεηιουω";
  var SINGLE_V = { "α": "a", "ε": "e", "η": "i", "ι": "i", "ο": "o", "υ": "i", "ω": "o" };
  var CONS = {
    "β": "v", "γ": "ɣ", "δ": "ð", "ζ": "z", "θ": "θ", "κ": "k", "λ": "l", "μ": "m",
    "ν": "n", "ξ": "ks", "π": "p", "ρ": "r", "σ": "s", "τ": "t", "φ": "f", "χ": "x", "ψ": "ps"
  };
  // before e / i: κ γ χ are said further forward
  var FRONTED = { "κ": "c", "γ": "j", "χ": "ç" };
  // an unstressed i (ι, ει, οι, υ) before another vowel melts into the
  // consonant before it: these consonants change, σ ζ take a j, π a ç
  var GLIDE = { "κ": "c", "γ": "j", "χ": "ç", "λ": "ʎ", "ν": "ɲ" };
  var GLIDE_ADD = { "σ": "j", "ζ": "j", "π": "ç" };
  // ει before a vowel glides after every consonant: j after σ ζ, else ç
  var GLIDE_EI = { "σ": "j", "ζ": "j" };
  var VOICELESS = "θκξπστφχψ";
  // short words said without stress of their own (articles, pronouns,
  // particles, prepositions)
  var UNSTRESSED = {};
  ("ο η το οι τα τον την τη της του των τους τις τ στο στη στην στον στα στις στους στης στου " +
   "σε σ με μ να θα και αν που πως μου σου μας σας εκ ας μια").split(" ").forEach(function (w) { if (w) UNSTRESSED[w.replace(/ς/g, "σ")] = 1; });

  // common words said lighter, with a secondary stress only
  var LIGHT = {};
  ("από ένα είναι έχει μία έναν μέσα μαζί ένας ενός έχεις έχουν αλλά ήταν είσαι είχες είχε " +
   "επί μίας έχω είστε ήσουν είχαν είμαι έχουμε παρά").split(" ").forEach(function (w) {
    LIGHT[keyOf(letters(w))] = 1;
  });
  function keyOf(L) { return L.map(function (x) { return x.c + (x.acc ? "'" : ""); }).join(""); }
  // words whose sound breaks the rules
  var WORDS = { "και": "ke" };

  // ---------- letters ----------
  // [{ c, acc, dia }] lower case, final sigma as σ, accents as flags
  function letters(word) {
    var s = String(word).normalize("NFD").toLowerCase(), out = [];
    for (var i = 0; i < s.length; i++) {
      var ch = s[i];
      if (ACUTE[ch]) { if (out.length) out[out.length - 1].acc = true; continue; }
      if (ch === DIA) { if (out.length) out[out.length - 1].dia = true; continue; }
      if (/[\u0300-\u036f]/.test(ch)) continue;            // breathings, grave, iota subscript
      if (ch === "ς") ch = "σ";
      if (ch === "ϊ") { out.push({ c: "ι", dia: true }); continue; }
      if (ch === "ϋ") { out.push({ c: "υ", dia: true }); continue; }
      out.push({ c: ch });
    }
    return out;
  }
  function isV(L, j) { return j < L.length && VOWEL.indexOf(L[j].c) >= 0; }
  // the vowel sound starting at j is e or i
  function frontAt(L, j) {
    if (j >= L.length) return false;
    var c = L[j].c;
    if ("εηιυ".indexOf(c) >= 0) return true;
    if ((c === "α" || c === "ο") && j + 1 < L.length && L[j + 1].c === "ι" && !L[j + 1].dia && !L[j].acc) return true;
    return false;
  }
  // length of the vowel letters group at j: 2 for a digraph, else 1
  function vowelLen(L, j) {
    var a = L[j], b = L[j + 1];
    if (!b || b.dia || a.acc) return 1;
    var d = a.c + b.c;
    if (d === "ου" || d === "αι" || d === "ει" || d === "οι" || d === "υι") return 2;
    if (d === "αυ" || d === "ευ" || d === "ηυ") return 2;
    return 1;
  }

  // ---------- one word ----------
  // units: { t: text, v: true (vowel nucleus), st: 1 primary }
  function units(L) {
    var u = [], i = 0, n = L.length;
    function push(t, v, st) { u.push({ t: t, v: !!v, st: st ? 1 : 0 }); }
    function prevIsCons() { return u.length && !u[u.length - 1].v && u[u.length - 1].t !== "ɪ"; }
    while (i < n) {
      var c = L[i].c;
      if (VOWEL.indexOf(c) >= 0) {
        var len = vowelLen(L, i), acc = L[i].acc || (len === 2 && L[i + 1].acc);
        var d = len === 2 ? c + L[i + 1].c : c, after = i + len;
        if (d === "αυ" || d === "ευ" || d === "ηυ") {
          var vl = after >= n || VOICELESS.indexOf(L[after].c) >= 0;
          push(SINGLE_V[c], true, acc);
          push(vl ? "f" : "v");
          i = after; continue;
        }
        var snd = d === "ου" ? "u" : d === "αι" ? "e" : len === 2 ? "i" : SINGLE_V[c];
        // unstressed η after α or ο: a glide (βοηθός, αηδόνι)
        if (c === "η" && !acc && i > 0 && (L[i - 1].c === "α" || L[i - 1].c === "ο") && u.length && u[u.length - 1].v) {
          push("ɪ"); i = after; continue;
        }
        // ι after a vowel it does not join (ϊ, or the vowel before carries the accent): a glide
        if (c === "ι" && !acc && u.length && u[u.length - 1].v && u[u.length - 1].t !== "i" &&
            (L[i].dia || (i > 0 && L[i - 1].acc))) {
          push("ɪ"); i = after; continue;
        }
        // unstressed i before a vowel: melts into the consonant before it
        if (snd === "i" && !acc && isV(L, after) && prevIsCons() && i > 0 && u[u.length - 1].t !== "ŋɡ") {
          var pc = L[i - 1].c, last = u[u.length - 1], rep = null;
          if (GLIDE[pc]) rep = last.t.slice(0, -1) + GLIDE[pc];
          else if (d === "ει") rep = last.t + (GLIDE_EI[pc] || "ç");
          else if (d !== "οι" && GLIDE_ADD[pc]) rep = last.t + GLIDE_ADD[pc];
          else if (pc === "δ" && d === "ι" && L[after].c === "α" && !L[after].acc && after === n - 1) rep = last.t + "j";
          else if (pc === "μ" && d === "ι" && n === 3 && i === 1) rep = "mɲ";      // μια
          if (rep !== null) { last.t = rep; i = after; continue; }
        }
        push(snd, true, acc);
        i = after; continue;
      }
      var nx = L[i + 1] ? L[i + 1].c : "", two = c + nx;
      if (two === "μπ") { push("b"); i += 2; continue; }
      if (two === "ντ") {
        if (L[i + 2] && L[i + 2].c === "ζ") { push("dz"); i += 3; continue; }
        push("d"); i += 2; continue;
      }
      if (two === "τσ") { push("ts"); i += 2; continue; }
      if (two === "τζ") { push("dz"); i += 2; continue; }
      if (two === "γκ" || two === "γγ") { push(i === 0 || L[i - 1].c === "ν" ? "ɡ" : "ŋɡ"); i += 2; continue; }
      if (two === "γχ") { push(frontAt(L, i + 2) ? "ŋç" : "ŋx"); i += 2; continue; }
      if (two === "γξ") { push("ɣks"); i += 2; continue; }
      if (two === "σσ") { push("ss"); i += 2; continue; }
      if (nx === c && CONS[c]) { i += 1; continue; }         // double letters are said once (σσ apart)
      if (CONS[c]) {
        push(FRONTED[c] && frontAt(L, i + 1) ? FRONTED[c] : CONS[c]);
        i += 1; continue;
      }
      i += 1;                                                // anything else is silent
    }
    return u;
  }

  function word(w) {
    var L = letters(w);
    if (!L.length) return "";
    var u = units(L);
    var nuc = [];
    u.forEach(function (x, k) { if (x.v) nuc.push(k); });
    var stressed = nuc.filter(function (k) { return u[k].st; });
    var plain = L.map(function (x) { return x.c; }).join("");
    if (WORDS[plain] && !L.some(function (x) { return x.acc; })) return WORDS[plain];
    // no accent (a short word, or text typed without accents): the stress
    // goes on the last but one vowel
    if (!stressed.length && nuc.length && !UNSTRESSED[plain]) {
      var k0 = nuc[Math.max(0, nuc.length - 2)];
      u[k0].st = 1; stressed = [k0];
    }
    var light = LIGHT[keyOf(L)] && stressed.length === 1;
    if (stressed.length) {
      var p = nuc.indexOf(stressed[0]), q = nuc.indexOf(stressed[stressed.length - 1]);
      // secondary stress: every other syllable from the first one up to
      // two before the stress, and every other one after it
      if (p >= 2) for (var a = 0; a <= p - 2; a += 2) u[nuc[a]].st = u[nuc[a]].st || 2;
      for (var b = q + 2; b < nuc.length; b += 2) if (!u[nuc[b]].st) u[nuc[b]].st = 2;
    }
    if (light) u[stressed[0]].st = 2;
    var out = "";
    u.forEach(function (x) { out += (x.st === 1 ? "ˈ" : x.st === 2 ? "ˌ" : "") + x.t; });
    return out;
  }

  // ---------- text to words ----------
  var ONES = ["μηδέν", "ένα", "δύο", "τρία", "τέσσερα", "πέντε", "έξι", "επτά", "οκτώ", "εννέα",
    "δέκα", "έντεκα", "δώδεκα", "δεκατρία", "δεκατέσσερα", "δεκαπέντε", "δεκαέξι", "δεκαεπτά",
    "δεκαοκτώ", "δεκαεννέα"];
  var TENS = ["", "", "είκοσι", "τριάντα", "σαράντα", "πενήντα", "εξήντα", "εβδομήντα", "ογδόντα", "ενενήντα"];
  var HUNDREDS = ["", "εκατό", "διακόσια", "τριακόσια", "τετρακόσια", "πεντακόσια", "εξακόσια",
    "επτακόσια", "οκτακόσια", "εννιακόσια"];
  var HUNDREDS_F = ["", "εκατό", "διακόσιες", "τριακόσιες", "τετρακόσιες", "πεντακόσιες", "εξακόσιες",
    "επτακόσιες", "οκτακόσιες", "εννιακόσιες"];
  // 1..999; fem: the form before χιλιάδες (feminine)
  function under1000(n, fem) {
    var h = Math.floor(n / 100), r = n % 100, out = [];
    if (h) out.push(h === 1 && r ? "εκατόν" : (fem ? HUNDREDS_F : HUNDREDS)[h]);
    if (r) {
      var o = r < 20 ? ONES[r] : TENS[Math.floor(r / 10)] + (r % 10 ? " " + ONES[r % 10] : "");
      if (fem) o = o.replace(/(^| )τρία$/, "$1τρεις").replace(/(^| )τέσσερα$/, "$1τέσσερις")
        .replace(/(^| )ένα$/, "$1μία").replace(/^δεκατρία$/, "δεκατρείς").replace(/^δεκατέσσερα$/, "δεκατέσσερις");
      out.push(o);
    }
    return out.join(" ");
  }
  function number(n) {
    if (!isFinite(n) || n < 0 || n >= 1e12) return null;
    if (n === 0) return ONES[0];
    var parts = [], b = Math.floor(n / 1e9), m = Math.floor(n / 1e6) % 1000,
        t = Math.floor(n / 1000) % 1000, r = n % 1000;
    if (b) parts.push(b === 1 ? "ένα δισεκατομμύριο" : under1000(b) + " δισεκατομμύρια");
    if (m) parts.push(m === 1 ? "ένα εκατομμύριο" : under1000(m) + " εκατομμύρια");
    if (t) parts.push(t === 1 ? "χίλια" : under1000(t, true) + " χιλιάδες");
    if (r) parts.push(under1000(r));
    return parts.join(" ");
  }
  function digits(str) {                 // a long code: said digit by digit
    return str.split("").map(function (d) { return ONES[+d]; }).join(" ");
  }
  function numberWords(str) {
    var clean = str.replace(/\./g, "");
    if (clean.length > 1 && clean[0] === "0") return digits(clean);
    if (clean.length > 12 || (clean === str && clean.length > 6)) return digits(clean);
    return number(parseInt(clean, 10));
  }
  var ORD = { 1: "πρώτ", 2: "δεύτερ", 3: "τρίτ", 4: "τέταρτ", 5: "πέμπτ", 6: "έκτ", 7: "έβδομ",
    8: "όγδο", 9: "ένατ", 10: "δέκατ", 11: "ενδέκατ", 12: "δωδέκατ", 20: "εικοστ", 30: "τριακοστ",
    100: "εκατοστ" };
  var STRESSED_END = { "ος": "ός", "ου": "ού", "ο": "ό", "ον": "όν", "οι": "οί", "ων": "ών",
    "ους": "ούς", "η": "ή", "ης": "ής", "ην": "ήν", "ες": "ές", "α": "ά" };
  var MONTHS = ["Ιανουαρίου", "Φεβρουαρίου", "Μαρτίου", "Απριλίου", "Μαΐου", "Ιουνίου", "Ιουλίου",
    "Αυγούστου", "Σεπτεμβρίου", "Οκτωβρίου", "Νοεμβρίου", "Δεκεμβρίου"];
  // short forms, as they are written (with the dot), longest first
  var SHORT = [
    ["κ.λπ.", "και λοιπά"], ["κ.λ.π.", "και λοιπά"], ["κλπ.", "και λοιπά"], ["κλπ", "και λοιπά"],
    ["κ.τ.λ.", "και τα λοιπά"], ["κτλ.", "και τα λοιπά"], ["κτλ", "και τα λοιπά"],
    ["π.χ.", "παραδείγματος χάρη"], ["κ.ά.", "και άλλα"], ["δηλ.", "δηλαδή"], ["τηλ.", "τηλέφωνο"],
    ["π.Χ.", "προ Χριστού"], ["μ.Χ.", "μετά Χριστόν"], ["π.μ.", "προ μεσημβρίας"], ["μ.μ.", "μετά μεσημβρίας"],
    ["Δρ.", "δόκτωρ"], ["δρ.", "δόκτωρ"], ["οδ.", "οδός"], ["αρ.", "αριθμός"], ["σελ.", "σελίδα"],
    ["κεφ.", "κεφάλαιο"], ["βλ.", "βλέπε"], ["χλμ.", "χιλιόμετρα"], ["χλμ", "χιλιόμετρα"],
    ["εκ.", "εκατοστά"], ["κ.", "κύριος"], ["κα.", "κυρία"], ["κα", "κυρία"]
  ];
  var LETTER = { "α": "άλφα", "β": "βήτα", "γ": "γάμα", "δ": "δέλτα", "ε": "έψιλον", "ζ": "ζήτα",
    "η": "ήτα", "θ": "θήτα", "ι": "γιώτα", "κ": "κάπα", "λ": "λάμδα", "μ": "μι", "ν": "νι", "ξ": "ξι",
    "ο": "όμικρον", "π": "πι", "ρ": "ρο", "σ": "σίγμα", "ς": "σίγμα", "τ": "ταυ", "υ": "ύψιλον",
    "φ": "φι", "χ": "χι", "ψ": "ψι", "ω": "ωμέγα" };
  // Latin letters, said the Greek way (names like orOS, Dropbox)
  var LATIN = [["th", "θ"], ["ch", "τσ"], ["sh", "σ"], ["ph", "φ"], ["ou", "ου"], ["oo", "ου"],
    ["ee", "ι"], ["ck", "κ"], ["qu", "κου"], ["a", "α"], ["b", "μπ"], ["c", "κ"], ["d", "ντ"], ["e", "ε"],
    ["f", "φ"], ["g", "γκ"], ["h", "χ"], ["i", "ι"], ["j", "τζ"], ["k", "κ"], ["l", "λ"], ["m", "μ"],
    ["n", "ν"], ["o", "ο"], ["p", "π"], ["q", "κ"], ["r", "ρ"], ["s", "σ"], ["t", "τ"], ["u", "ου"],
    ["v", "β"], ["w", "ου"], ["x", "ξ"], ["y", "ι"], ["z", "ζ"]];
  function latin(w) {
    var s = w.toLowerCase(), out = "";
    for (var i = 0; i < s.length;) {
      var hit = null;
      for (var k = 0; k < LATIN.length; k++) if (s.substr(i, LATIN[k][0].length) === LATIN[k][0]) { hit = LATIN[k]; break; }
      if (hit) { out += hit[1]; i += hit[0].length; } else { i++; }
    }
    return out;
  }
  function spell(w) {
    return w.toLowerCase().split("").map(function (c) { return LETTER[c] || ""; }).join(" ");
  }

  function words(text) {
    var s = String(text == null ? "" : text).normalize("NFC");
    s = s.replace(/[‘’ʼ]/g, "'").replace(/[«»“”"]/g, " ")
         .replace(/[–—]/g, ", ").replace(/·/g, ";;").replace(/…/g, ".");
    SHORT.forEach(function (p) {
      var esc = p[0].replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      s = s.replace(new RegExp("(^|[\\s(])" + esc + (/\.$/.test(p[0]) ? "" : "(?![\\p{L}])"), "gu"), "$1" + p[1] + " ");
    });
    // dates 5/12/2026, times 14:30, money, percent, ordinals
    s = s.replace(/\b(\d{1,2})[\/.](\d{1,2})[\/.](\d{2,4})\b/g, function (m, d, mo, y) {
      mo = +mo; if (mo < 1 || mo > 12 || +d < 1 || +d > 31) return m;
      if (y.length === 2) y = "20" + y;
      return " " + (d === "1" || d === "01" ? "πρώτη" : number(+d)) + " " + MONTHS[mo - 1] + " " + number(+y) + " ";
    });
    s = s.replace(/\b([01]?\d|2[0-3]):([0-5]\d)\b/g, function (m, h, mi) {
      return " " + (+h ? under1000(+h, true) : "μηδέν") + (+mi ? " και " + number(+mi) : "") + " ";
    });
    s = s.replace(/(\d{1,3}(?:\.\d{3})+|\d+)(?:,(\d{1,2}))?\s?(€|ευρώ)/g, function (m, e, c) {
      var c2 = c ? +(c.length === 1 ? c + "0" : c) : 0;
      return " " + numberWords(e) + " ευρώ" + (c2 ? " και " + number(c2) + " λεπτά" : "") + " ";
    });
    s = s.replace(/€\s?(\d{1,3}(?:\.\d{3})+|\d+)(?:,(\d{1,2}))?/g, function (m, e, c) {
      var c2 = c ? +(c.length === 1 ? c + "0" : c) : 0;
      return " " + numberWords(e) + " ευρώ" + (c2 ? " και " + number(c2) + " λεπτά" : "") + " ";
    });
    s = s.replace(/(\d+(?:,\d+)?)\s?%/g, "$1 τοις εκατό");
    s = s.replace(/(^|[^\p{L}\d])(\d{1,2})(ος|ου|ον|ο|οι|ων|ους|ης|ην|η|ες|α)(?![\p{L}\d])/gu, function (m, pre, n, end) {
      n = +n;
      if (ORD[n]) return pre + " " + ORD[n] + end + " ";
      var tens = ORD[Math.floor(n / 10) * 10], ones = ORD[n % 10];
      if (!tens || !ones) return m;
      return pre + " " + tens + STRESSED_END[end] + " " + ones + end + " ";
    });
    s = s.replace(/(\d+),(\d+)/g, function (m, a, b) { return numberWords(a) + " κόμμα " + numberWords(b); });
    s = s.replace(/\d{1,3}(?:\.\d{3})+|\d+/g, function (m) { return " " + numberWords(m) + " "; });
    // Latin words the Greek way; letters alone or without a vowel are spelled
    s = s.replace(/[A-Za-z]+/g, function (w) { return latin(w); });
    s = s.replace(/[\p{L}']+/gu, function (w) {
      var bare = w.replace(/'/g, "");
      if (/[α-ωάέήίόύώϊϋΐΰ]/i.test(bare) && !/[αεηιουωάέήίόύώϊϋΐΰ]/i.test(bare)) return spell(bare);
      if (bare.length > 1 && bare === bare.toUpperCase() && bare.length <= 4 && !/[ΑΕΗΙΟΥΩΆΈΉΊΌΎΏ]{1}.*[ΑΕΗΙΟΥΩΆΈΉΊΌΎΏ]/.test(bare) &&
          /^[Α-ΩΆ-Ώ]+$/.test(bare) && !/^[ΑΕΗΙΟΥΩ]/.test(bare)) return spell(bare);
      return w;
    });
    return s.replace(/[ \t]+/g, " ").trim();
  }

  // ---------- sentences ----------
  var VOICELESS_START = { "p": "b", "t": "d", "k": "ɡ", "c": "ɟ" };
  // a final ν joins the next word: τον πατέρα → tom batˈera
  function joinN(prev, next) {
    if (!/n$/.test(prev)) return [prev, next];
    var m = /^([ˈˌ]?)(ps|ks|ts|[ptkc])/.exec(next);
    if (!m) return [prev, next];
    var first = m[2], rest = next.slice(m[0].length), nasal, voiced;
    if (first === "ps") { nasal = "m"; voiced = "bz"; }
    else if (first === "ks") { nasal = "ŋ"; voiced = "ɡz"; }
    else if (first === "ts") { nasal = "n"; voiced = "dz"; }
    else { nasal = first === "p" ? "m" : first === "t" ? "n" : "ŋ"; voiced = first === "c" ? "ɟ" : VOICELESS_START[first]; }
    return [prev.slice(0, -1) + nasal, m[1] + voiced + rest];
  }
  var END = { ".": ".", "!": "!", "?": "?", ";": "?" };
  function sentences(text) {
    var s = words(text), out = [], cur = [], curText = "";
    var re = /([\p{L}']+)|([.!?;]+|;;|,|:)|(\n+)/gu, m, start = 0;
    function flush(p) {
      if (cur.length) {
        var ph = "";
        for (var i = 0; i < cur.length; i++) {
          var t = cur[i];
          if (t.p) { ph += t.p; continue; }
          if (ph && !/ $/.test(ph)) ph += " ";
          ph += t.w;
        }
        out.push({ text: curText.trim(), ph: (ph + (p || "")).replace(/\s+/g, " ").trim() });
      }
      cur = []; curText = "";
    }
    while ((m = re.exec(s))) {
      curText += s.slice(start, re.lastIndex); start = re.lastIndex;
      if (m[1]) {
        var w = word(m[1].replace(/'/g, ""));
        if (!w) continue;
        var prev = null;
        for (var k = cur.length - 1; k >= 0; k--) { if (!cur[k].p) { prev = k; } break; }
        if (prev !== null) { var j = joinN(cur[prev].w, w); cur[prev].w = j[0]; w = j[1]; }
        cur.push({ w: w });
      } else if (m[2]) {
        var p = m[2] === ";;" ? ";" : m[2];
        if (p === "," || p === ":") { if (cur.length) cur.push({ p: p + " " }); }
        else if (p === ";" && !/^[.!?]/.test(p) && m[2] !== ";") { if (cur.length) cur.push({ p: "; " }); }
        else flush(m[2] === ";;" ? ";" : END[p[p.length - 1]] || ".");
      } else flush("");
    }
    curText += s.slice(start);
    flush("");
    return out.filter(function (x) { return x.ph; });
  }

  var api = { letters: letters, word: word, words: words, sentences: sentences, number: number };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.GreekVoice = api;
})(typeof self !== "undefined" ? self : this);
