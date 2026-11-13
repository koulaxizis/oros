// ============================================================
// orOS Files \u2014 docs-text.js: what a document's text suggests
// (Documents wave W2, DOCS-1). Pure: no DOM, no storage.
// ------------------------------------------------------------
// The text itself is read by docs-read.js (PDF text, or on-device
// text recognition) and kept beside the document as a plain file,
// /internal/.docs/text/<id>.txt, so every device searches it without
// reading it again (Vault Drive syncs that file like any other).
//
// clean(raw, max)   -> the text as stored: NFC, no control characters,
//                      at most `max` characters (default 200,000).
// dates(text)       -> [{ iso, at }] every calendar date found
//                      (day first, like the rest of Europe; a second
//                      number over 12 makes it month first).
// amounts(text)     -> [{ v, cur, at, tot }] money-looking numbers.
// suggest(text, state, opts) -> { ty?, d?, ex?, amt?, cur?, co? }
//     opts { today "YYYY-MM-DD", lang }. Only what the text makes
//     likely; the person applies it (only empty fields are filled).
// UMD: window.OrosDocsText, or module.exports in Node.
// ============================================================
(function (root) {
  "use strict";

  var CORE = (typeof module !== "undefined" && module.exports) ? require("./docs-core.js") : root.OrosDocsCore;
  var MAX_TEXT = 200000;
  var fold = CORE.fold;

  function clean(raw, max) {
    var s = String(raw == null ? "" : raw);
    if (s.normalize) s = s.normalize("NFC");
    s = s.replace(/\r\n?/g, "\n").replace(/\t/g, " ")
         .replace(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f\u2028\u2029\ufeff]/g, "")
         .replace(/[ \u00a0]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
    var m = max > 0 ? max : MAX_TEXT;
    return s.length > m ? s.slice(0, m) : s;
  }

  // ---------- dates ----------
  function pad(n) { return (n < 10 ? "0" : "") + n; }
  function iso(y, m, d) {
    if (y < 100) y += y < 70 ? 2000 : 1900;
    var s = y + "-" + pad(m) + "-" + pad(d);
    return CORE.okDate(s) ? s : "";
  }
  var MONTHS = [
    ["january", "jan", "\u03b9\u03b1\u03bd\u03bf\u03c5\u03b1\u03c1\u03b9\u03bf\u03c5", "\u03b9\u03b1\u03bd\u03bf\u03c5\u03b1\u03c1\u03b9\u03bf\u03c2", "\u03b9\u03b1\u03bd", "januar", "janner"],
    ["february", "feb", "\u03c6\u03b5\u03b2\u03c1\u03bf\u03c5\u03b1\u03c1\u03b9\u03bf\u03c5", "\u03c6\u03b5\u03b2\u03c1\u03bf\u03c5\u03b1\u03c1\u03b9\u03bf\u03c2", "\u03c6\u03b5\u03b2", "februar"],
    ["march", "mar", "\u03bc\u03b1\u03c1\u03c4\u03b9\u03bf\u03c5", "\u03bc\u03b1\u03c1\u03c4\u03b9\u03bf\u03c2", "\u03bc\u03b1\u03c1", "marz"],
    ["april", "apr", "\u03b1\u03c0\u03c1\u03b9\u03bb\u03b9\u03bf\u03c5", "\u03b1\u03c0\u03c1\u03b9\u03bb\u03b9\u03bf\u03c2", "\u03b1\u03c0\u03c1"],
    ["may", "\u03bc\u03b1\u03b9\u03bf\u03c5", "\u03bc\u03b1\u03b9\u03bf\u03c2", "\u03bc\u03b1\u03b9", "mai"],
    ["june", "jun", "\u03b9\u03bf\u03c5\u03bd\u03b9\u03bf\u03c5", "\u03b9\u03bf\u03c5\u03bd\u03b9\u03bf\u03c2", "\u03b9\u03bf\u03c5\u03bd", "juni"],
    ["july", "jul", "\u03b9\u03bf\u03c5\u03bb\u03b9\u03bf\u03c5", "\u03b9\u03bf\u03c5\u03bb\u03b9\u03bf\u03c2", "\u03b9\u03bf\u03c5\u03bb", "juli"],
    ["august", "aug", "\u03b1\u03c5\u03b3\u03bf\u03c5\u03c3\u03c4\u03bf\u03c5", "\u03b1\u03c5\u03b3\u03bf\u03c5\u03c3\u03c4\u03bf\u03c2", "\u03b1\u03c5\u03b3"],
    ["september", "sep", "sept", "\u03c3\u03b5\u03c0\u03c4\u03b5\u03bc\u03b2\u03c1\u03b9\u03bf\u03c5", "\u03c3\u03b5\u03c0\u03c4\u03b5\u03bc\u03b2\u03c1\u03b9\u03bf\u03c2", "\u03c3\u03b5\u03c0"],
    ["october", "oct", "\u03bf\u03ba\u03c4\u03c9\u03b2\u03c1\u03b9\u03bf\u03c5", "\u03bf\u03ba\u03c4\u03c9\u03b2\u03c1\u03b9\u03bf\u03c2", "\u03bf\u03ba\u03c4", "oktober", "okt"],
    ["november", "nov", "\u03bd\u03bf\u03b5\u03bc\u03b2\u03c1\u03b9\u03bf\u03c5", "\u03bd\u03bf\u03b5\u03bc\u03b2\u03c1\u03b9\u03bf\u03c2", "\u03bd\u03bf\u03b5"],
    ["december", "dec", "\u03b4\u03b5\u03ba\u03b5\u03bc\u03b2\u03c1\u03b9\u03bf\u03c5", "\u03b4\u03b5\u03ba\u03b5\u03bc\u03b2\u03c1\u03b9\u03bf\u03c2", "\u03b4\u03b5\u03ba", "dezember", "dez"]
  ];
  var MONTH_OF = {};
  MONTHS.forEach(function (list, i) { list.forEach(function (w) { MONTH_OF[fold(w)] = i + 1; }); });
  var MONTH_RE = Object.keys(MONTH_OF).sort(function (a, b) { return b.length - a.length; }).join("|");
  var NUM_DATE = /(^|[^\d])(\d{4})[-./](\d{1,2})[-./](\d{1,2})(?!\d)|(^|[^\d])(\d{1,2})[./-](\d{1,2})[./-](\d{4}|\d{2})(?![\d])/g;
  var WORD_DATE = new RegExp("(^|[^\\d])(\\d{1,2})\\.?\\s+(" + MONTH_RE + ")\\.?,?\\s+(\\d{4})(?!\\d)|(^|[^a-z\\u03b1-\\u03c9])(" + MONTH_RE + ")\\.?\\s+(\\d{1,2}),?\\s+(\\d{4})(?!\\d)", "g");

  function dates(text) {
    var f = fold(text), out = [], m;
    NUM_DATE.lastIndex = 0;
    while ((m = NUM_DATE.exec(f))) {
      var at = m.index + (m[1] != null ? m[1].length : m[5].length), s = "";
      if (m[2]) s = iso(+m[2], +m[3], +m[4]);
      else {
        var a = +m[6], b = +m[7], y = +m[8];
        s = b > 12 && a <= 12 ? iso(y, a, b) : iso(y, b, a);
      }
      if (s) out.push({ iso: s, at: at });
    }
    WORD_DATE.lastIndex = 0;
    while ((m = WORD_DATE.exec(f))) {
      var s2 = m[2] ? iso(+m[4], MONTH_OF[m[3]], +m[2]) : iso(+m[8], MONTH_OF[m[6]], +m[7]);
      if (s2) out.push({ iso: s2, at: m.index + (m[1] != null ? m[1].length : m[5].length) });
    }
    return out.sort(function (x, y) { return x.at - y.at; });
  }

  // ---------- amounts ----------
  var CUR = { "\u20ac": "EUR", "eur": "EUR", "euro": "EUR", "\u03b5\u03c5\u03c1\u03c9": "EUR", "$": "USD", "usd": "USD", "\u00a3": "GBP", "gbp": "GBP",
              "chf": "CHF", "ron": "RON", "bgn": "BGN", "lei": "RON" };
  var CUR_RE = "\u20ac|\\$|\u00a3|eur|euro|\u03b5\u03c5\u03c1\u03c9|usd|gbp|chf|ron|bgn|lei";
  var AMOUNT = new RegExp("(" + CUR_RE + ")?\\s?(-?\\d{1,3}(?:[.,]\\d{3})+|-?\\d+)([.,]\\d{2})(?![\\d.,]?\\d)\\s?(" + CUR_RE + ")?", "g");
  var TOTAL = ["total", "grand total", "amount due", "total due", "to pay", "balance due", "amount payable",
               "\u03c3\u03c5\u03bd\u03bf\u03bb\u03bf", "\u03b3\u03b5\u03bd\u03b9\u03ba\u03bf \u03c3\u03c5\u03bd\u03bf\u03bb\u03bf", "\u03c0\u03bb\u03b7\u03c1\u03c9\u03c4\u03b5\u03bf", "\u03c3\u03c5\u03bd\u03bf\u03bb\u03bf \u03c0\u03bb\u03b7\u03c1\u03c9\u03bc\u03b7\u03c2", "\u03c0\u03bf\u03c3\u03bf \u03c0\u03bb\u03b7\u03c1\u03c9\u03bc\u03b7\u03c2", "\u03c4\u03b5\u03bb\u03b9\u03ba\u03bf \u03c0\u03bf\u03c3\u03bf", "\u03c0\u03bb\u03b7\u03c1\u03c9\u03c4\u03b5\u03bf \u03c0\u03bf\u03c3\u03bf",
               "gesamt", "summe", "gesamtbetrag", "endbetrag", "rechnungsbetrag", "zu zahlen"].map(fold);
  var NOT_TOTAL = ["subtotal", "sub total", "\u03bc\u03b5\u03c1\u03b9\u03ba\u03bf \u03c3\u03c5\u03bd\u03bf\u03bb\u03bf", "zwischensumme"].map(fold);

  // The word closest before the number decides: "subtotal" ends where
  // "total" ends, and the longer word wins that tie.
  function isTotal(before) {
    var end = -1, len = 0, tot = false;
    function look(list, val) {
      list.forEach(function (w) {
        var i = before.lastIndexOf(w);
        if (i === -1) return;
        var e = i + w.length;
        if (e > end || (e === end && w.length > len)) { end = e; len = w.length; tot = val; }
      });
    }
    look(TOTAL, true);
    look(NOT_TOTAL, false);
    return tot;
  }
  function amounts(text) {
    var f = fold(text), out = [], m, last = 0;
    AMOUNT.lastIndex = 0;
    while ((m = AMOUNT.exec(f))) {
      var whole = m[2].replace(/[.,]/g, ""), v = Number(whole + "." + m[3].slice(1));
      if (!isFinite(v) || Math.abs(v) > 1e9) continue;
      var cur = CUR[m[1] || m[4] || ""] || "";
      var at = m.index;
      // a "total" word counts only up to the number before this one
      out.push({ v: Math.round(v * 100) / 100, cur: cur, at: at, tot: isTotal(f.slice(Math.max(last, at - 40), at)) });
      last = m.index + m[0].length;
    }
    return out;
  }

  // ---------- document types ----------
  // A word ending in "*" matches as a beginning ("\u03c6\u03bf\u03c1\u03bf\u03bb\u03bf\u03b3*" takes
  // \u03c6\u03bf\u03c1\u03bf\u03bb\u03bf\u03b3\u03b9\u03ba\u03ae, \u03c6\u03bf\u03c1\u03bf\u03bb\u03bf\u03b3\u03b9\u03ba\u03cc\u2026); the others match whole words.
  var KEYS = {
    "ty-invoice":   ["invoice", "tax invoice", "\u03c4\u03b9\u03bc\u03bf\u03bb\u03bf\u03b3\u03b9\u03bf", "\u03c4\u03b9\u03bc\u03bf\u03bb\u03bf\u03b3\u03b9\u03bf \u03c0\u03b1\u03c1\u03bf\u03c7\u03b7\u03c2 \u03c5\u03c0\u03b7\u03c1\u03b5\u03c3\u03b9\u03c9\u03bd", "rechnung", "rechnungsnummer"],
    "ty-receipt":   ["receipt", "\u03b1\u03c0\u03bf\u03b4\u03b5\u03b9\u03be\u03b7", "\u03b1\u03c0\u03bf\u03b4\u03b5\u03b9\u03be\u03b7 \u03bb\u03b9\u03b1\u03bd\u03b9\u03ba\u03b7\u03c2", "quittung", "kassenbon", "kassenbeleg"],
    "ty-bill":      ["utility bill", "electricity bill", "water bill", "\u03bb\u03bf\u03b3\u03b1\u03c1\u03b9\u03b1\u03c3\u03bc\u03bf\u03c2 \u03c1\u03b5\u03c5\u03bc\u03b1\u03c4\u03bf\u03c2", "\u03bb\u03bf\u03b3\u03b1\u03c1\u03b9\u03b1\u03c3\u03bc\u03bf\u03c2 \u03bd\u03b5\u03c1\u03bf\u03c5", "\u03bb\u03bf\u03b3\u03b1\u03c1\u03b9\u03b1\u03c3\u03bc\u03bf\u03c2 \u03ba\u03b1\u03c4\u03b1\u03bd\u03b1\u03bb\u03c9\u03c3\u03b7\u03c2",
                     "\u03b5\u03b9\u03b4\u03bf\u03c0\u03bf\u03b9\u03b7\u03c3\u03b7 \u03c0\u03bb\u03b7\u03c1\u03c9\u03bc\u03b7\u03c2", "\u03ba\u03c9\u03b4\u03b9\u03ba\u03bf\u03c2 \u03c0\u03bb\u03b7\u03c1\u03c9\u03bc\u03b7\u03c2", "stromrechnung", "wasserrechnung", "abrechnung"],
    "ty-contract":  ["contract", "agreement", "\u03c3\u03c5\u03bc\u03b2\u03b1\u03c3\u03b7", "\u03c3\u03c5\u03bc\u03b2\u03bf\u03bb\u03b1\u03b9\u03bf", "\u03c3\u03c5\u03bc\u03c6\u03c9\u03bd\u03b7\u03c4\u03b9\u03ba\u03bf", "\u03bc\u03b9\u03c3\u03b8\u03c9\u03c4\u03b7\u03c1\u03b9\u03bf", "vertrag", "vereinbarung", "mietvertrag"],
    "ty-warranty":  ["warranty", "guarantee", "\u03b5\u03b3\u03b3\u03c5\u03b7\u03c3\u03b7", "garantie", "gewahrleistung"],
    "ty-insurance": ["insurance", "insurance policy", "\u03b1\u03c3\u03c6\u03b1\u03bb\u03b9\u03c3\u03c4\u03b7\u03c1\u03b9\u03bf", "\u03b1\u03c3\u03c6\u03b1\u03bb\u03b9\u03c3\u03b7", "\u03b1\u03c3\u03c6\u03b1\u03bb\u03b9\u03c3\u03c4\u03c1\u03b1", "versicherung", "versicherungsschein"],
    "ty-tax":       ["tax return", "income tax", "\u03c6\u03bf\u03c1\u03bf\u03bb\u03bf\u03b3*", "\u03b5\u03c6\u03bf\u03c1\u03b9\u03b1", "\u03b5\u03ba\u03ba\u03b1\u03b8\u03b1\u03c1\u03b9\u03c3\u03c4\u03b9\u03ba\u03bf \u03c3\u03b7\u03bc\u03b5\u03b9\u03c9\u03bc\u03b1", "steuer*", "finanzamt"],
    "ty-bank":      ["bank statement", "account statement", "\u03c4\u03c1\u03b1\u03c0\u03b5\u03b6\u03b1*", "\u03ba\u03b9\u03bd\u03b7\u03c3\u03b7 \u03bb\u03bf\u03b3\u03b1\u03c1\u03b9\u03b1\u03c3\u03bc\u03bf\u03c5", "\u03b1\u03bd\u03c4\u03b9\u03b3\u03c1\u03b1\u03c6\u03bf \u03ba\u03b9\u03bd\u03b7\u03c3\u03b7\u03c2", "iban", "kontoauszug"],
    "ty-medical":   ["prescription", "diagnosis", "medical", "laboratory", "hospital", "\u03b3\u03bd\u03c9\u03bc\u03b1\u03c4\u03b5\u03c5\u03c3\u03b7", "\u03b9\u03b1\u03c4\u03c1*", "\u03b5\u03be\u03b5\u03c4\u03b1\u03c3\u03b5\u03b9\u03c2", "\u03c3\u03c5\u03bd\u03c4\u03b1\u03b3\u03b7", "\u03bd\u03bf\u03c3\u03bf\u03ba\u03bf\u03bc\u03b5\u03b9*",
                     "arzt*", "befund", "rezept", "krankenhaus"],
    "ty-vehicle":   ["vehicle registration", "\u03b1\u03b4\u03b5\u03b9\u03b1 \u03ba\u03c5\u03ba\u03bb\u03bf\u03c6\u03bf\u03c1\u03b9\u03b1\u03c2", "\u03ba\u03c4\u03b5\u03bf", "\u03bf\u03c7\u03b7\u03bc\u03b1*", "fahrzeugschein", "zulassungsbescheinigung"],
    "ty-id":        ["passport", "identity card", "\u03b4\u03b9\u03b1\u03b2\u03b1\u03c4\u03b7\u03c1\u03b9\u03bf", "\u03b4\u03b5\u03bb\u03c4\u03b9\u03bf \u03c4\u03b1\u03c5\u03c4\u03bf\u03c4\u03b7\u03c4\u03b1\u03c2", "\u03b1\u03c3\u03c4\u03c5\u03bd\u03bf\u03bc\u03b9\u03ba\u03b7 \u03c4\u03b1\u03c5\u03c4\u03bf\u03c4\u03b7\u03c4\u03b1", "personalausweis", "reisepass"],
    "ty-cert":      ["certificate", "\u03c0\u03b9\u03c3\u03c4\u03bf\u03c0\u03bf\u03b9\u03b7\u03c4\u03b9\u03ba\u03bf", "\u03b2\u03b5\u03b2\u03b1\u03b9\u03c9\u03c3\u03b7", "zertifikat", "bescheinigung", "urkunde"]
  };
  var WORD_CH = "a-z0-9\\u03b1-\\u03c9";
  function wordRe(w) {
    var pre = w.charAt(w.length - 1) === "*";
    var core = fold(pre ? w.slice(0, -1) : w).replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/ /g, "\\s+");
    return new RegExp("(^|[^" + WORD_CH + "])" + core + (pre ? "" : "(?![" + WORD_CH + "])"), "g");
  }
  var KEY_RE = {};
  Object.keys(KEYS).forEach(function (id) { KEY_RE[id] = KEYS[id].map(wordRe); });

  function hits(re, f) {
    var n = 0, first = -1, m;
    re.lastIndex = 0;
    while ((m = re.exec(f)) && n < 3) { if (first < 0) first = m.index; n++; }
    return { n: n, first: first };
  }
  function guessType(f, s, lang) {
    var best = "", score = 0;
    function weigh(id, res) {
      var sc = 0;
      res.forEach(function (re) { var h = hits(re, f); if (h.n) sc += h.n + (h.first < 300 ? 2 : 0); });
      if (sc > score) { score = sc; best = id; }
    }
    Object.keys(KEY_RE).forEach(function (id) { weigh(id, KEY_RE[id]); });
    // The person's own types match by their name.
    CORE.types(s, lang).forEach(function (ty) {
      if (ty.builtin || !ty.name || fold(ty.name).length < 3) return;
      weigh(ty.id, [wordRe(ty.name)]);
    });
    return best;
  }

  // ---------- who it is from ----------
  function guessCorr(f, s) {
    var best = null;
    s.corr.forEach(function (c) {
      var n = fold(c.n);
      if (n.length < 3) return;
      var h = hits(wordRe(c.n), f);
      if (h.n && (!best || h.first < best.at)) best = { id: c.id, at: h.first };
    });
    return best ? best.id : "";
  }

  // ---------- together ----------
  var DATE_KEYS = ["date", "invoice date", "issued", "date of issue", "\u03b7\u03bc\u03b5\u03c1\u03bf\u03bc\u03b7\u03bd\u03b9\u03b1", "\u03b7\u03bc/\u03bd\u03b9\u03b1", "\u03b7\u03bc\u03b5\u03c1.", "\u03b5\u03ba\u03b4\u03bf\u03c3\u03b7\u03c2", "\u03b7\u03bc\u03b5\u03c1\u03bf\u03bc\u03b7\u03bd\u03b9\u03b1 \u03b5\u03ba\u03b4\u03bf\u03c3\u03b7\u03c2",
                   "datum", "rechnungsdatum", "ausgestellt"].map(fold);
  var EXP_KEYS = ["valid until", "valid thru", "expires", "expiry", "expiration", "expiry date", "\u03b9\u03c3\u03c7\u03c5\u03b5\u03b9 \u03b5\u03c9\u03c2", "\u03b9\u03c3\u03c7\u03c5\u03c2 \u03b5\u03c9\u03c2", "\u03bb\u03b7\u03be\u03b7", "\u03bb\u03b7\u03b3\u03b5\u03b9",
                  "\u03b7\u03bc\u03b5\u03c1\u03bf\u03bc\u03b7\u03bd\u03b9\u03b1 \u03bb\u03b7\u03be\u03b7\u03c2", "gultig bis", "ablauf", "lauft ab", "ablaufdatum"].map(fold);
  function near(f, keys, at, span) {
    var before = f.slice(Math.max(0, at - span), at);
    for (var i = 0; i < keys.length; i++) if (before.indexOf(keys[i]) !== -1) return true;
    return false;
  }
  function addDays(isoDay, n) {
    var p = isoDay.split("-"), d = new Date(Date.UTC(+p[0], +p[1] - 1, +p[2] + n));
    return d.getUTCFullYear() + "-" + pad(d.getUTCMonth() + 1) + "-" + pad(d.getUTCDate());
  }

  function suggest(text, s, opts) {
    opts = opts || {};
    s = CORE.norm(s);
    var out = {};
    var f = fold(text || "");
    if (!f) return out;
    var today = CORE.okDate(opts.today) ? opts.today : "9999-12-31";
    var ty = guessType(f, s, opts.lang || "en");
    if (ty) out.ty = ty;
    var co = guessCorr(f, s);
    if (co) out.co = co;
    // Dates: the one after a "date" word, else the first that is not in
    // the future (a month of slack); expiry: after an "expires" word.
    var ds = dates(text), soon = addDays(today, 31), d = "", ex = "";
    ds.forEach(function (x) {
      if (!ex && near(f, EXP_KEYS, x.at, 30)) { ex = x.iso; return; }
      if (!d && x.iso >= "1990-01-01" && x.iso <= soon && near(f, DATE_KEYS, x.at, 30)) d = x.iso;
    });
    if (!d) ds.some(function (x) { if (x.iso !== ex && x.iso >= "1990-01-01" && x.iso <= soon) { d = x.iso; return true; } return false; });
    if (d) out.d = d;
    if (ex && (!d || ex > d)) out.ex = ex;
    // Amount: the largest after a "total" word, else the largest with
    // a currency next to it. Plain numbers alone suggest nothing.
    var am = amounts(text), pick = null;
    am.forEach(function (a) { if (a.tot && a.v > 0 && (!pick || a.v > pick.v)) pick = a; });
    if (!pick) am.forEach(function (a) { if (a.cur && a.v > 0 && (!pick || a.v > pick.v)) pick = a; });
    if (pick) {
      out.amt = pick.v;
      var cur = pick.cur;
      if (!cur) am.some(function (a) { if (a.cur) { cur = a.cur; return true; } return false; });
      if (cur) out.cur = cur;
    }
    return out;
  }

  var API = { MAX_TEXT: MAX_TEXT, clean: clean, dates: dates, amounts: amounts, suggest: suggest };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  else root.OrosDocsText = API;
})(this);
