// ============================================================
// orOS voices — English text to phonemes (voicekit/english.js, v1.0.0)
// Turns English text into the phonemes Kokoro-82M was trained on (the
// alphabet of misaki, Kokoro's own G2P: IPA plus A I O W Y for the
// diphthongs eɪ aɪ oʊ aʊ ɔɪ, ᵊ ᵻ for weak vowels, ˈ ˌ for stress).
//   - Words come from misaki's American English dictionaries (Apache-2.0,
//     mirrored in koulaxizis/oros-models-vision misaki-en/ and downloaded
//     with the voice): gold first, then silver. The voice gives them with
//     EnglishVoice.lexicon(gold, silver).
//   - A word that is not there is found from its stem (-s, -ed, -ing),
//     from two known words (drop + box), spelled when it is in capitals
//     (USB), and otherwise read with orOS's own spelling rules.
//   Written here, MIT like the rest of orOS; espeak-ng (GPL-3.0) is never
//   used. tests/voicekit-english.test.js.
// i18n-inline-ok: the phonemes here (θ and other IPA letters) are data, not text to translate.
//   EnglishVoice.lexicon(gold, silver)  sets the dictionaries (objects)
//   EnglishVoice.words(text)            numbers and symbols as words
//   EnglishVoice.word(w)                the phonemes of one word
//   EnglishVoice.rules(w)               the phonemes by the spelling rules only
//   EnglishVoice.sentences(text)        [{ text, ph }]
// Pure: no DOM, no network. UMD: module.exports in Node,
// self.EnglishVoice in the browser and in workers.
// ============================================================
(function (root) {
  "use strict";

  var P = "ˈ", S = "ˌ";
  var GOLD = {}, SILVER = {};
  var VOWELS = "AIOWYaiuæɑɒɔəɛɜɪʊʌᵻᵊ";
  var TAUS = "AIOWYiuæɑəɛɪɹʊʌ";      // a t between these and a vowel is a flap (ɾ) in American English

  function lexicon(gold, silver) {
    GOLD = gold && typeof gold === "object" ? gold : {};
    SILVER = silver && typeof silver === "object" ? silver : {};
  }

  // a dictionary value: a string, or { DEFAULT, VERB, … } (no tagger here: DEFAULT)
  function val(v) { return v == null ? null : typeof v === "string" ? v : (v.DEFAULT != null ? v.DEFAULT : null); }
  function own(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }
  function look(w) {
    var forms = [w, w.toLowerCase(), w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()];
    for (var i = 0; i < forms.length; i++) if (own(GOLD, forms[i]) && val(GOLD[forms[i]]) != null) return val(GOLD[forms[i]]);
    for (var j = 0; j < forms.length; j++) if (own(SILVER, forms[j]) && val(SILVER[forms[j]]) != null) return val(SILVER[forms[j]]);
    return null;
  }

  // ---------- endings ----------
  function addS(ps) {
    var c = ps.slice(-1);
    if ("ptkfθ".indexOf(c) !== -1) return ps + "s";
    if ("szʃʒʧʤ".indexOf(c) !== -1) return ps + "ᵻz";
    return ps + "z";
  }
  function addEd(ps) {
    var c = ps.slice(-1), c2 = ps.slice(-2, -1);
    if ("pkfθʃsʧ".indexOf(c) !== -1) return ps + "t";
    if (c === "d") return ps + "ᵻd";
    if (c !== "t") return ps + "d";
    if (c2 && TAUS.indexOf(c2) !== -1) return ps.slice(0, -1) + "ɾᵻd";
    return ps + "ᵻd";
  }
  function addIng(ps) {
    var c = ps.slice(-1), c2 = ps.slice(-2, -1);
    if (c === "t" && c2 && TAUS.indexOf(c2) !== -1) return ps.slice(0, -1) + "ɾɪŋ";
    return ps + "ɪŋ";
  }
  function stemmed(w) {
    var l = w.toLowerCase(), s;
    if (l.length >= 3 && /s$/.test(l)) {
      if (!/ss$/.test(l) && (s = look(l.slice(0, -1)))) return addS(s);
      if ((/'s$/.test(l) || (l.length > 4 && /es$/.test(l) && !/ies$/.test(l))) && (s = look(l.slice(0, -2)))) return addS(s);
      if (l.length > 4 && /ies$/.test(l) && (s = look(l.slice(0, -3) + "y"))) return addS(s);
    }
    if (l.length >= 4 && /d$/.test(l)) {
      if (!/dd$/.test(l) && (s = look(l.slice(0, -1)))) return addEd(s);
      if (l.length > 4 && /ed$/.test(l) && !/eed$/.test(l) && (s = look(l.slice(0, -2)))) return addEd(s);
      if (l.length > 4 && /ied$/.test(l) && (s = look(l.slice(0, -3) + "y"))) return addEd(s);
      if (l.length > 5 && /([bdgklmnprstz])\1ed$/.test(l) && (s = look(l.slice(0, -3)))) return addEd(s);
    }
    if (l.length >= 5 && /ing$/.test(l)) {
      if (l.length > 5 && (s = look(l.slice(0, -3)))) return addIng(s);
      if ((s = look(l.slice(0, -3) + "e"))) return addIng(s);
      if (l.length > 5 && /([bcdgklmnprstvxz])\1ing$|cking$/.test(l) && (s = look(l.slice(0, -4)))) return addIng(s);
    }
    return null;
  }

  // ---------- letters spelled ----------
  var LETTER = { a: "ˈA", b: "bˈi", c: "sˈi", d: "dˈi", e: "ˈi", f: "ˈɛf", g: "ʤˈi", h: "ˈAʧ", i: "ˈI", j: "ʤˈA",
    k: "kˈA", l: "ˈɛl", m: "ˈɛm", n: "ˈɛn", o: "ˈO", p: "pˈi", q: "kjˈu", r: "ˈɑɹ", s: "ˈɛs", t: "tˈi", u: "jˈu",
    v: "vˈi", w: "dˈʌbᵊlju", x: "ˈɛks", y: "wˈI", z: "zˈi" };
  function spell(w) {
    var parts = w.toLowerCase().split("").map(function (c) { var g = look(c.toUpperCase()); return g || LETTER[c] || ""; }).filter(Boolean);
    // all but the last letter get a light stress
    return parts.map(function (p, i) { return i === parts.length - 1 ? p.replace(/ˌ/g, P) : p.replace(/ˈ/g, S); }).join("");
  }

  // ---------- the spelling rules (words no dictionary has) ----------
  // Ordered: the first rule that matches at a position wins. "#" = a vowel
  // letter, "^" = a consonant letter, "$" = the end of the word.
  var RULES = [
    ["ing$", "ɪŋ"], ["er$", "əɹ"], ["ers$", "əɹz"], ["or$", "əɹ"], ["ar$", "əɹ"], ["le$", "ᵊl"], ["ly$", "li"],
    ["ness$", "nəs"], ["ment$", "mənt"], ["able$", "əbᵊl"], ["ful$", "fᵊl"], ["ous$", "əs"], ["ism$", "ɪzəm"],
    ["ize$", "Iz"], ["ise$", "Iz"], ["ity$", "əɾi"], ["ic$", "ɪk"], ["al$", "ᵊl"], ["ive$", "ɪv"], ["age$", "ɪʤ"],
    ["ate$", "At"], ["ent$", "ənt"], ["ant$", "ənt"], ["ence$", "əns"], ["ance$", "əns"], ["ist$", "ɪst"],
    ["ar", "ɑɹ"], ["or", "ɔɹ"], ["er", "ɜɹ"], ["ir", "ɜɹ"], ["ur", "ɜɹ"],
    ["tion", "ʃən"], ["sion", "ʒən"], ["cious", "ʃəs"], ["tious", "ʃəs"], ["ture", "ʧəɹ"], ["ough", "O"],
    ["eigh", "A"], ["igh", "I"], ["tch", "ʧ"], ["sch", "sk"], ["dge", "ʤ"], ["ph", "f"], ["th", "θ"],
    ["sh", "ʃ"], ["ch", "ʧ"], ["ck", "k"], ["ng", "ŋ"], ["qu", "kw"], ["wh", "w"], ["wr", "ɹ"], ["kn", "n"],
    ["gn$", "n"], ["mb$", "m"], ["x", "ks"], ["ce", "sɛ"], ["ci", "sɪ"], ["cy", "si"], ["c", "k"], ["ge", "ʤɛ"],
    ["gi", "ʤɪ"], ["g", "ɡ"], ["j", "ʤ"], ["y#", "j"], ["r", "ɹ"],
    ["ee", "i"], ["ea", "i"], ["oo", "u"], ["ou", "W"], ["ow$", "O"], ["ow", "W"], ["oi", "Y"], ["oy", "Y"],
    ["ai", "A"], ["ay", "A"], ["au", "ɔ"], ["aw", "ɔ"], ["ew", "ju"], ["ie$", "I"], ["ie", "i"], ["ei", "A"],
    ["ey$", "i"], ["oa", "O"], ["ue$", "u"], ["ui", "u"],
    ["a^e$", "A"], ["i^e$", "I"], ["o^e$", "O"], ["u^e$", "ju"], ["e^e$", "i"],
    ["y$", "i"], ["e$", ""], ["es$", "z"], ["ed$", "d"],
    ["a", "æ"], ["e", "ɛ"], ["i", "ɪ"], ["o", "ɑ"], ["u", "ʌ"], ["y", "ɪ"]
  ];
  function isVL(c) { return !!c && "aeiouy".indexOf(c) !== -1; }
  function match(rule, w, i) {
    var pat = rule[0], k = i;
    for (var p = 0; p < pat.length; p++) {
      var ch = pat[p];
      if (ch === "$") { if (k !== w.length) return 0; continue; }
      if (ch === "#") { if (!isVL(w[k])) return 0; return -(k - i); }     // a vowel follows (not eaten)
      if (ch === "^") { if (!w[k] || isVL(w[k])) return 0; k++; continue; }
      if (w[k] !== ch) return 0;
      k++;
    }
    return k - i;
  }
  // prefixes said without stress: the syllable after them takes it
  var WEAK_PRE = [["com", "kəm"], ["con", "kən"], ["dis", "dɪs"], ["mis", "mɪs"], ["pre", "pɹi"], ["pro", "pɹə"],
    ["sub", "səb"], ["per", "pəɹ"], ["ab", "əb"], ["ac", "ək"], ["ad", "əd"], ["ap", "əp"], ["as", "əs"], ["at", "ət"],
    ["be", "bɪ"], ["de", "dɪ"], ["re", "ɹi"], ["en", "ɪn"], ["ex", "ɪks"], ["im", "ɪm"], ["in", "ɪn"], ["ob", "əb"],
    ["un", "ʌn"], ["a", "ə"]];
  function rules(word) {
    var w = String(word || "").toLowerCase().replace(/[^a-z]/g, "");
    if (!w) return "";
    if (w.length > 5) {
      for (var k = 0; k < WEAK_PRE.length; k++) {
        var pre = WEAK_PRE[k][0], rest = w.slice(pre.length);
        // the rest must start a syllable of its own and hold a vowel
        if (w.indexOf(pre) === 0 && rest.length >= 3 && /[aeiouy]/.test(rest) && !(pre === "a" && isVL(rest[0])) &&
            !/^[aeiouy]/.test(rest) === (pre.length > 1 || !isVL(rest[0])) && rest[0] !== rest[1]) {
          return WEAK_PRE[k][1] + rules(rest);
        }
      }
    }
    var out = [], i = 0;
    while (i < w.length) {
      var done = false;
      for (var r = 0; r < RULES.length; r++) {
        var n = match(RULES[r], w, i);
        if (!n) continue;
        var rule = RULES[r];
        if (n < 0) { out.push(rule[1]); i += -n; done = true; break; }
        // a^e$: the vowel is long, the consonant stays, the e is silent
        if (rule[0].indexOf("^") !== -1) {
          out.push(rule[1]);
          var cons = rules(w[i + 1]);
          out.push(cons);
          i += n; done = true; break;
        }
        out.push(rule[1]); i += n; done = true; break;
      }
      if (!done) {
        var c = w[i];
        out.push(/[bdfhklmnpstvwz]/.test(c) ? c : "");
        // double consonants are one sound
        if (w[i + 1] === c && !isVL(c)) i++;
        i++;
      }
    }
    var ps = out.join("");
    // stress the first vowel; short vowels after it are said weak
    for (var q = 0; q < ps.length; q++) if (VOWELS.indexOf(ps[q]) !== -1) {
      var tail = ps.slice(q + 1).replace(/ɜɹ/g, "əɹ").replace(/[æɛʌɑ](?!ɹ)/g, "ə");
      return ps.slice(0, q) + P + ps[q] + tail;
    }
    return ps;
  }

  // two known words (dropbox = drop + box), each at least 3 letters
  function compound(w) {
    var l = w.toLowerCase();
    for (var i = l.length - 3; i >= 3; i--) {
      var a = look(l.slice(0, i)), b = look(l.slice(i));
      if (a && b) return a + b.replace(/ˈ/g, S);
    }
    return null;
  }

  var OVERRIDE = { "oros": "ˈɔɹˌOs", "ctrl": "kəntɹˈOl", "json": "ʤˈAsᵊn", "todo": "tˈu dˌu", "https": "ˌAʧtˌitˌipˌiˈɛs",
    "wifi": "wˈIfˌI", "gif": "ɡˈɪf", "url": "jˌuˌɑɹˈɛl" };

  // how a word is found: "dict", "spell", "stem", "compound", "rules" (tests, coverage)
  function how(w) {
    w = String(w || "");
    if (!/[a-z]/i.test(w)) return "";
    if (own(OVERRIDE, w.toLowerCase()) || look(w) != null) return "dict";
    if (/^[A-Z]{2,6}s?$/.test(w) || (!/[aeiouy]/i.test(w) && w.length <= 6)) return "spell";
    if (stemmed(w) != null) return "stem";
    if (/-/.test(w)) return "parts";
    var camel = w.match(/[A-Z]+(?![a-z])|[A-Z]?[a-z]+/g);
    if (camel && camel.length > 1 && camel.join("") === w) return "parts";
    if (compound(w) != null) return "compound";
    return "rules";
  }

  function word(w) {
    w = String(w || "");
    var l = w.toLowerCase();
    if (!/[a-z]/i.test(w)) return "";
    if (own(OVERRIDE, l)) return OVERRIDE[l];
    var ps = look(w);
    if (ps != null) return ps;
    // capitals that are not a word: letters (USB, PDF)
    if (/^[A-Z]{2,6}s?$/.test(w)) {
      if (/s$/.test(w) && /^[A-Z]+s$/.test(w)) return addS(spell(w.slice(0, -1)));
      return spell(w);
    }
    if (!/[aeiouy]/i.test(w) && w.length <= 6) return spell(w);           // csv, html, km
    ps = stemmed(w);
    if (ps != null) return ps;
    if (/-/.test(w)) return w.split("-").map(word).filter(Boolean).join(" ");
    var camel = w.match(/[A-Z]+(?![a-z])|[A-Z]?[a-z]+/g);                  // OpenStreetMap, WebDAV
    if (camel && camel.length > 1 && camel.join("") === w) return camel.map(word).join(" ");
    ps = compound(w);
    if (ps != null) return ps;
    return rules(w);
  }

  // ---------- numbers ----------
  var ONES = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve",
    "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen"];
  var TENS = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"];
  function num(n) {
    if (n < 20) return ONES[n];
    if (n < 100) return TENS[Math.floor(n / 10)] + (n % 10 ? " " + ONES[n % 10] : "");
    if (n < 1000) return ONES[Math.floor(n / 100)] + " hundred" + (n % 100 ? " " + num(n % 100) : "");
    if (n < 1e6) return num(Math.floor(n / 1000)) + " thousand" + (n % 1000 ? " " + num(n % 1000) : "");
    if (n < 1e9) return num(Math.floor(n / 1e6)) + " million" + (n % 1e6 ? " " + num(n % 1e6) : "");
    return String(n).split("").map(function (d) { return ONES[+d]; }).join(" ");
  }
  function year(n) {
    if (n >= 1100 && n < 2000 || n >= 2010 && n < 2100) {
      var a = Math.floor(n / 100), b = n % 100;
      return num(a) + " " + (b === 0 ? "hundred" : b < 10 ? "oh " + ONES[b] : num(b));
    }
    return num(n);
  }
  function number(s) {
    if (typeof s === "number") return num(Math.floor(Math.abs(s)));
    var t = String(s).replace(/,(?=\d{3}(\D|$))/g, ""), m = t.split(".");
    var out = num(parseInt(m[0], 10) || 0);
    if (m[1]) out += " point " + m[1].split("").map(function (d) { return ONES[+d]; }).join(" ");
    return out;
  }
  var ORD = { one: "first", two: "second", three: "third", five: "fifth", eight: "eighth", nine: "ninth", twelve: "twelfth" };
  function ordinal(n) {
    var w = num(n).split(" "), last = w[w.length - 1];
    w[w.length - 1] = ORD[last] || (/y$/.test(last) ? last.slice(0, -1) + "ieth" : last + "th");
    return w.join(" ");
  }

  var SHORT = [[/\be\.g\./gi, "for example"], [/\bi\.e\./gi, "that is"], [/\betc\./gi, "et cetera"],
    [/\bvs\.?(?=\s)/gi, "versus"], [/\bMr\./g, "Mister"], [/\bMrs\./g, "Missus"], [/\bDr\./g, "Doctor"], [/\bNo\.(?=\s*\d)/g, "number"]];
  var SYM = { "%": " percent", "&": " and ", "+": " plus ", "=": " equals ", "@": " at ", "°": " degrees" };
  var CUR = { "$": ["dollar", "dollars", "cent", "cents"], "€": ["euro", "euros", "cent", "cents"], "£": ["pound", "pounds", "penny", "pence"] };

  function words(text) {
    var t = String(text || "").normalize("NFC");
    SHORT.forEach(function (r) { t = t.replace(r[0], r[1]); });
    // $12.50 → twelve dollars and fifty cents; 12,50 € too
    t = t.replace(/([$€£])\s?(\d[\d,]*)(?:\.(\d{2}))?|(\d[\d,]*)(?:[.,](\d{2}))?\s?([$€£])/g, function (m, c1, a1, b1, a2, b2, c2) {
      var c = CUR[c1 || c2], a = parseInt(String(a1 || a2).replace(/,/g, ""), 10), b = parseInt(b1 || b2 || "0", 10);
      return " " + num(a) + " " + (a === 1 ? c[0] : c[1]) + (b ? " and " + num(b) + " " + (b === 1 ? c[2] : c[3]) : "") + " ";
    });
    t = t.replace(/\b(\d{1,2}):(\d{2})\s*(am|pm|a\.m\.|p\.m\.)?/gi, function (m, h, mi, ap) {
      var s = num(+h) + " " + (+mi === 0 ? (ap ? "" : "o'clock") : +mi < 10 ? "oh " + num(+mi) : num(+mi));
      return " " + s + (ap ? " " + (/^a/i.test(ap) ? "A M" : "P M") : "") + " ";
    });
    t = t.replace(/\b(\d+)(st|nd|rd|th)\b/gi, function (m, d) { return ordinal(+d); });
    t = t.replace(/\b(1[1-9]\d\d|20\d\d)\b(?![.,]\d)/g, function (m, y) { return year(+y); });
    t = t.replace(/[%&+=@°]/g, function (c) { return SYM[c]; });
    t = t.replace(/\d[\d,]*(?:\.\d+)?/g, function (m) { return " " + number(m) + " "; });
    return t.replace(/[ \t]+/g, " ").trim();
  }

  // the, a, to: said lighter before the next word
  function weak(w, next) {
    var l = w.toLowerCase(), v = !!next && /^[aeiou]/i.test(next);
    if (l === "the") return v ? "ði" : "ðə";
    if (l === "a") return w === "A" && next === "M" ? null : "ɐ";   // A M (a time) is spelled
    if (l === "an") return "ɐn";
    if (l === "to") return v ? "tʊ" : "tə";
    return null;
  }

  function sentences(text) {
    var t = words(text);
    if (!t.trim()) return [];
    var list = t.match(/[^.!?…]+[.!?…]*["”’)]*/g) || [];
    var out = [];
    list.forEach(function (raw) {
      var s = raw.trim();
      if (!/[A-Za-z]/.test(s)) return;
      var toks = s.match(/[A-Za-z]+(?:['’][A-Za-z]+)*|[,;:!?.…—–-]|\s+|[^\sA-Za-z]/g) || [];
      var ph = [];
      for (var i = 0; i < toks.length; i++) {
        var tk = toks[i];
        if (/^[A-Za-z]/.test(tk)) {
          var nx = "";
          for (var j = i + 1; j < toks.length; j++) if (/^[A-Za-z]/.test(toks[j])) { nx = toks[j]; break; } else if (/[,;:!?.]/.test(toks[j])) break;
          ph.push(weak(tk, nx) || word(tk.replace(/’/g, "'")));
        } else if (/^\s+$/.test(tk)) ph.push(" ");
        else if (/^[,;:!?.…—]$/.test(tk)) ph.push(tk === "—" ? " — " : tk);
        else if (tk === "–" || tk === "-") ph.push(" ");
      }
      var p = ph.join("").replace(/[^\p{L}\p{M}ˈˌ ,;:!?.…—]/gu, " ").replace(/\s+/g, " ").replace(/\s+([,;:!?.…])/g, "$1").trim();
      if (p) out.push({ text: s, ph: p });
    });
    return out;
  }

  var api = { lexicon: lexicon, word: word, how: how, rules: rules, words: words, sentences: sentences, number: number, ordinal: ordinal };
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.EnglishVoice = api;
})(typeof self !== "undefined" ? self : this);
