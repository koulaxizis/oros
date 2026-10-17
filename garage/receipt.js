// ============================================================
// orOS Garage — receipt.js (fuel receipt reader, v1.0.0)
// Reads the TEXT of a fuel or charging receipt (typed, pasted, or
// read from a photo by on-device text recognition when orOS has
// it) and finds what the fuel editor needs: date, quantity
// (litres or kWh), price per unit, total and station. Greek and
// English receipts. Pure functions, no DOM, no network; nothing is
// saved here: the editor shows the values for the person to check.
//
// API (window.OrosGarageReceipt, module.exports under Node):
//   parse(text, today?) → { d?, q?, p?, c?, st?, e?, found: [keys] }
//     d  "YYYY-MM-DD" (never after `today` when given)
//     q  quantity (number, litres or kWh) · e "e" when the unit is kWh
//     p  price per unit (number) · c total in cents (integer)
//     st station / brand (≤ 40 characters)
//     found: which of d q p c st came from the text (the rest of
//     q / p / c may be worked out from the other two)
//   num(str) → number | null (receipt number: the LAST . or , is
//     the decimal point, earlier ones group thousands)
// ============================================================
// i18n-inline-ok: Greek fuel brands and receipt words (parser data, no UI text)
(function (root) {
  "use strict";

  var ST_LEN = 40;
  // Fuel brands seen on Greek, British and other European / US
  // receipts. Matched as whole words on the folded text.
  var BRANDS = [
    ["SHELL", "Shell"], ["BP", "BP"], ["EKO", "EKO"], ["AVIN", "Avin"], ["ELIN", "Elin"],
    ["REVOIL", "Revoil"], ["AEGEAN", "Aegean"], ["CYCLON", "Cyclon"], ["JET OIL", "Jet Oil"],
    ["KAOIL", "Kaoil"], ["ETEKA", "Eteka"], ["ESSO", "Esso"], ["TEXACO", "Texaco"],
    ["TOTALENERGIES", "TotalEnergies"], ["MOBIL", "Mobil"], ["GULF", "Gulf"], ["Q8", "Q8"],
    ["OMV", "OMV"], ["ARAL", "Aral"], ["AGIP", "Agip"], ["ENI", "Eni"], ["REPSOL", "Repsol"],
    ["CEPSA", "Cepsa"], ["GALP", "Galp"], ["LUKOIL", "Lukoil"], ["ORLEN", "Orlen"], ["MOL", "MOL"],
    ["TESCO", "Tesco"], ["SAINSBURY", "Sainsbury's"], ["ASDA", "Asda"], ["MORRISONS", "Morrisons"],
    ["COSTCO", "Costco"], ["CHEVRON", "Chevron"], ["EXXON", "Exxon"], ["SUNOCO", "Sunoco"],
    ["VALERO", "Valero"], ["CITGO", "Citgo"], ["IONITY", "Ionity"], ["FASTNED", "Fastned"],
    ["TESLA", "Tesla"], ["DEI BLUE", "ΔΕΗ blue"], ["ΔΕΗ BLUE", "ΔΕΗ blue"], ["ELPEDISON", "Elpedison"],
    ["ΕΚΟ", "EKO"], ["ΕΛΙΝ", "Elin"], ["ΑΒΙΝ", "Avin"]
  ];

  // Upper case, Greek accents and diaeresis removed, OCR quirks
  // evened out (× and * as "x", the euro sign kept).
  function fold(s) {
    s = String(s || "").toUpperCase();
    try { s = s.normalize("NFD").replace(/[̀-ͯ]/g, ""); } catch (e) {}
    return s.replace(/[×*]/g, " X ").replace(/[\t   ]/g, " ");
  }

  function num(str) {
    var s = String(str || "").replace(/\s+/g, "");
    if (!/^\d[\d.,]*$/.test(s) || /[.,]{2}/.test(s) || /[.,]$/.test(s)) return null;
    var last = Math.max(s.lastIndexOf("."), s.lastIndexOf(","));
    if (last < 0) return Number(s);
    var intPart = s.slice(0, last).replace(/[.,]/g, ""), dec = s.slice(last + 1);
    // "1.234" with nothing else is ambiguous; on receipts three
    // decimals (prices, litres) are far more common than thousands
    var n = Number(intPart + "." + dec);
    return isFinite(n) ? n : null;
  }

  // Every number on a line, with where it sits.
  var NUM_RE = /\d{1,3}(?:[.,]\d{3})+(?:[.,]\d{1,3})?|\d+[.,]\d{1,3}|\d+/g;
  function numbers(line) {
    var out = [], m;
    NUM_RE.lastIndex = 0;
    while ((m = NUM_RE.exec(line))) {
      // not part of a date, a time, a tax number or a long code
      var before = line.charAt(m.index - 1), after = line.charAt(m.index + m[0].length);
      if (before === "/" || after === "/" || after === ":" || before === ":") continue;
      if (/^\d{7,}$/.test(m[0])) continue;
      var v = num(m[0]);
      if (v !== null) out.push({ v: v, s: m[0], i: m.index, end: m.index + m[0].length });
    }
    return out;
  }
  function decimals(s) {
    var last = Math.max(s.lastIndexOf("."), s.lastIndexOf(","));
    return last < 0 ? 0 : s.length - last - 1;
  }

  // ---------- date ----------
  function p2(n) { return (n < 10 ? "0" : "") + n; }
  function validYmd(y, mo, d) {
    if (y < 2000 || y > 2100 || mo < 1 || mo > 12 || d < 1) return null;
    if (d > new Date(Date.UTC(y, mo, 0)).getUTCDate()) return null;
    return y + "-" + p2(mo) + "-" + p2(d);
  }
  function findDate(lines, today) {
    var re1 = /(^|[^\d])(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?!\d)/;
    var re2 = /(^|[^\d])(\d{1,2})[-/.](\d{1,2})[-/.](\d{4}|\d{2})(?!\d)/;
    for (var i = 0; i < lines.length; i++) {
      var m = re1.exec(lines[i]), ymd = null;
      if (m) ymd = validYmd(+m[2], +m[3], +m[4]);
      if (!ymd && (m = re2.exec(lines[i]))) {
        var y = m[4].length === 2 ? 2000 + (+m[4]) : +m[4];
        var a = +m[2], b = +m[3];
        ymd = validYmd(y, b, a);                          // day / month first (Europe)
        if (!ymd && a <= 12) ymd = validYmd(y, a, b);     // month / day (US)
      }
      if (ymd && (!today || ymd <= today)) return ymd;
    }
    return null;
  }

  // ---------- labels ----------
  var QTY_UNIT = "(?:LITRES?|LITERS?|LTRS?|LT|L|ΛΙΤΡΑ|ΛΙΤΡ|ΛΙΤ|ΛΤ|Λ|KWH)";
  var QTY_AFTER = new RegExp("^\\s*" + QTY_UNIT + "(?![A-ZΑ-Ω])");
  var PER_UNIT = /^\s*(?:€|EUR|EURO|£|GBP|\$|USD)?\s*\/\s*(?:LITRE|LITER|LTR|LT|L|ΛΙΤΡΟ|ΛΙΤ|ΛΤ|Λ|KWH)(?![A-ZΑ-Ω])/;
  var QTY_LABEL = /(ΠΟΣΟΤΗΤΑ|ΠΟΣΟΤ\.|ΠΟΣ\.|ΛΙΤΡΑ|QUANTITY|QTY|VOLUME|VOL\.|LITRES|LITERS|ENERGY|ΕΝΕΡΓΕΙΑ)/;
  var PRICE_LABEL = /(ΤΙΜΗ\s*ΜΟΝ|ΤΙΜΗ\s*ΑΝΑ|ΤΙΜΗ\s*\/|Τ\.Μ\.|UNIT\s*PRICE|PRICE\s*PER|PRICE\s*\/|PPL|PRICE)/;
  var TOTAL_LABEL = /(ΓΕΝΙΚΟ\s*ΣΥΝΟΛΟ|ΠΛΗΡΩΤΕΟ|ΣΥΝΟΛΟ|ΣΥΝ\.|ΑΞΙΑ|ΠΟΣΟ|GRAND\s*TOTAL|TOTAL|AMOUNT|TO\s*PAY|BALANCE|SALE|SUM)/;
  var NOT_TOTAL = /(ΦΠΑ|Φ\.Π\.Α|VAT|ΚΑΘΑΡΗ|ΚΑΘΑΡΟ|NET\b|TAX|ΡΕΣΤΑ|CHANGE|ΜΕΤΡΗΤΑ|CASH|SUBTOTAL|ΕΚΠΤΩΣΗ|DISCOUNT|POINTS|ΠΟΝΤΟΙ)/;
  var NOT_STATION = /(ΑΠΟΔΕΙΞΗ|ΤΙΜΟΛΟΓΙΟ|RECEIPT|INVOICE|Α\.?Φ\.?Μ|VAT|ΔΟΥ|Δ\.Ο\.Υ|ΤΗΛ|TEL|WWW|HTTP|@|ΑΡΙΘΜ|NO\.|#)/;

  function inRangeQ(v) { return v >= 0.5 && v <= 2000; }
  function inRangeP(v) { return v >= 0.05 && v <= 20; }
  function inRangeC(v) { return v >= 0.5 && v <= 99999; }

  function parse(text, today) {
    var raw = String(text || "").slice(0, 20000).split(/\r?\n/);
    var lines = raw.map(fold);
    var out = { found: [] };
    var q = null, p = null, c = null, e = "f";

    // 1. "32,15 LT X 1,879" / "32.15 L @ 1.879": quantity, unit, price
    lines.forEach(function (ln) {
      if (q !== null && p !== null) return;
      var m = new RegExp("(\\d+[.,]\\d{1,3}|\\d+)\\s*(" + QTY_UNIT + ")?\\s*(?:X|@)\\s*(?:€\\s*)?(\\d+[.,]\\d{1,4})").exec(ln);
      if (!m) return;
      var a = num(m[1]), b = num(m[3]);
      if (a === null || b === null) return;
      // whichever looks like a price per unit is the price
      if (inRangeQ(a) && inRangeP(b) && (m[2] || a > b)) { q = a; p = b; if (/KWH/.test(m[2] || "")) e = "e"; }
      else if (inRangeQ(b) && inRangeP(a) && b > a) { q = b; p = a; }
    });

    // 2. numbers with a unit after them, or a label before them
    lines.forEach(function (ln) {
      var ns = numbers(ln);
      ns.forEach(function (n) {
        var rest = ln.slice(n.end);
        if (PER_UNIT.test(rest) || /^\s*€\s*\/\s*Λ/.test(rest)) {
          if (p === null && inRangeP(n.v)) p = n.v;
          return;
        }
        if (q === null && QTY_AFTER.test(rest) && inRangeQ(n.v)) {
          q = n.v;
          if (/^\s*KWH/.test(rest)) e = "e";
        }
      });
      if (q === null && QTY_LABEL.test(ln) && !PRICE_LABEL.test(ln)) {
        var qn = ns.filter(function (n) { return inRangeQ(n.v) && decimals(n.s) > 0; })[0];
        if (qn) { q = qn.v; if (/KWH|ΕΝΕΡΓΕΙΑ|ENERGY/.test(ln)) e = "e"; }
      }
      if (p === null && PRICE_LABEL.test(ln) && !TOTAL_LABEL.test(ln.replace(PRICE_LABEL, ""))) {
        var pn = ns.filter(function (n) { return inRangeP(n.v) && decimals(n.s) >= 2; })[0];
        if (pn) p = pn.v;
      }
    });

    // 3. the total: the last labelled amount (the payable total
    //    comes after the lines), never a VAT, cash or change line
    var labelled = [];
    lines.forEach(function (ln, i) {
      if (!TOTAL_LABEL.test(ln) || NOT_TOTAL.test(ln)) return;
      var ns = numbers(ln).filter(function (n) { return inRangeC(n.v) && decimals(n.s) === 2; });
      if (!ns.length && i + 1 < lines.length && !NOT_TOTAL.test(lines[i + 1])) {
        ns = numbers(lines[i + 1]).filter(function (n) { return inRangeC(n.v) && decimals(n.s) === 2; });
        if (ns.length && TOTAL_LABEL.test(lines[i + 1])) ns = [];
      }
      if (ns.length) labelled.push({ v: ns[ns.length - 1].v, strong: /ΣΥΝΟΛΟ|ΠΛΗΡΩΤΕΟ|TOTAL|TO\s*PAY/.test(ln) });
    });
    var strong = labelled.filter(function (x) { return x.strong; });
    var pick = (strong.length ? strong : labelled);
    if (pick.length) c = pick[pick.length - 1].v;
    if (c === null) {
      // no label: the largest amount next to a currency sign
      lines.forEach(function (ln) {
        if (NOT_TOTAL.test(ln)) return;
        var re = /(?:€|EUR|£|\$)\s*(\d{1,3}(?:[.,]\d{3})*[.,]\d{2}|\d+[.,]\d{2})(?!\d)|(\d{1,3}(?:[.,]\d{3})*[.,]\d{2}|\d+[.,]\d{2})\s*(?:€|EUR|£)(?!\s*\/)/g, m;
        while ((m = re.exec(ln))) {
          var v = num(m[1] || m[2]);
          if (v !== null && inRangeC(v) && (c === null || v > c)) c = v;
        }
      });
    }

    if (q !== null) out.found.push("q");
    if (p !== null) out.found.push("p");
    if (c !== null) out.found.push("c");
    // 4. two of three give the third; three that disagree: the
    //    quantity and the total are on the receipt for sure
    if (q !== null && c !== null && (p === null || Math.abs(q * p - c) > Math.max(0.05, c * 0.02))) p = Math.round(c / q * 1000) / 1000;
    else if (q !== null && p !== null && c === null) c = Math.round(q * p * 100) / 100;
    else if (q === null && p !== null && c !== null) q = Math.round(c / p * 100) / 100;
    if (q !== null && inRangeQ(q)) out.q = q;
    if (p !== null && p > 0) out.p = p;
    if (c !== null) out.c = Math.round(c * 100);
    if (out.q !== undefined && e === "e") out.e = "e";

    var d = findDate(lines, today);
    if (d) { out.d = d; out.found.push("d"); }

    // 5. station: a known brand anywhere, else the first line that
    //    reads like a name (letters, not a receipt heading)
    var st = "";
    for (var b = 0; b < BRANDS.length && !st; b++) {
      var re = new RegExp("(^|[^A-ZΑ-Ω0-9])" + BRANDS[b][0].replace(/ /g, "\\s*") + "(?![A-ZΑ-Ω0-9])");
      for (var i = 0; i < lines.length; i++) if (re.test(lines[i])) { st = BRANDS[b][1]; break; }
    }
    if (!st) {
      for (var j = 0; j < Math.min(lines.length, 6); j++) {
        var ln = raw[j].replace(/\s+/g, " ").trim();
        var letters = (ln.match(/[A-Za-zΑ-Ωα-ωΆ-ώ]/g) || []).length;
        if (letters >= 3 && letters >= ln.length / 2 && !NOT_STATION.test(lines[j]) && !TOTAL_LABEL.test(lines[j])) { st = ln; break; }
      }
    }
    if (st) { out.st = st.slice(0, ST_LEN).trim(); out.found.push("st"); }
    return out;
  }

  var API = { parse: parse, num: num, fold: fold };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  if (root) root.OrosGarageReceipt = API;
})(typeof window !== "undefined" ? window : null);
