// i18n-inline-ok: the Greek currency and receipt words are detection data, no UI text
// ============================================================
// orOS "Send to…" — send/detect.js (pure, v1.0.0, wave A3)
// Finds, on this device and without any network, what a piece of text
// is about, so the "Send to an app" sheet can offer the app that fits
// first: a day and time → Calendar, an amount → Budget / Invoices,
// a phone or e-mail → Contacts, an address → Maps.
//
// It reuses the parsers orOS already has, when they are loaded:
//   calendar/quickadd.js (OrosCalQuick)     days, times, places
//   contacts/cardtext.js (OrosContactsCard) phones, e-mails, addresses
// and adds its own amount reader. Without a parser that part finds
// nothing (never a guess). Only the first LINES lines / CHARS
// characters are read, so a long document stays quick.
//
// API (window.OrosSendDetect / module.exports):
//   event(text, today)  → { date, start?, end?, dateEnd?, title,
//                           location, line } | null
//   amount(text)        → { cents, line, note } | null   (€ only)
//   amounts(lines)      → [{ text, cents }]  every line with an amount
//   card(text)          → { phones, emails, addresses } | null
//   address(text)       → "street, zip city" | ""
//   all(text, today)    → { event, amount, card, address }
// No DOM, no storage. Node tests load it as is.
// ============================================================
(function (root) {
  "use strict";

  var LINES = 60;
  var CHARS = 6000;
  var MAX_CENTS = 100000000000;          // __orosOpenBudgetNew's cap

  function Q() { return root.OrosCalQuick || null; }
  function K() { return root.OrosContactsCard || null; }

  function head(text) {
    if (typeof text !== "string") return "";
    return text.slice(0, CHARS).replace(/\r\n?/g, "\n");
  }
  function lines(text) {
    return head(text).split("\n").map(function (l) { return l.replace(/\s+/g, " ").trim(); })
      .filter(function (l) { return !!l; }).slice(0, LINES);
  }
  function pad(n) { return (n < 10 ? "0" : "") + n; }
  function today0() { var d = new Date(); return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()); }

  // ---------- A day and a time ----------
  // The first line that names a day or a time (quick add's rules);
  // a line naming nothing never makes an event.
  function event(text, today) {
    var q = Q();
    if (!q || typeof q.parse !== "function") return null;
    var ls = lines(text), td = /^\d{4}-\d{2}-\d{2}$/.test(today || "") ? today : today0();
    for (var i = 0; i < ls.length; i++) {
      var r;
      try { r = q.parse(ls[i].slice(0, 300), { today: td }); } catch (e) { r = null; }
      if (!r || !r.found || !(r.found.date || r.found.time)) continue;
      var out = { date: r.date, title: (r.title || "").slice(0, 80), location: (r.location || "").slice(0, 150), line: ls[i].slice(0, 300) };
      if (r.start) out.start = r.start;
      if (r.start && r.end) out.end = r.end;
      if (r.dateEnd) out.dateEnd = r.dateEnd;
      return out;
    }
    return null;
  }

  // ---------- Amounts in euro ----------
  // "€12,50", "12,50 €", "12.50 EUR", "1.234,56 ευρώ", "EUR 8", "€ 3".
  // A number needs a euro mark next to it: a bare number (a phone, a
  // year, a quantity) is never an amount.
  var NUM = "(\\d{1,3}(?:[.,\\u00a0 ]\\d{3})+(?:[.,]\\d{1,2})?|\\d+(?:[.,]\\d{1,2})?)";
  var CUR = "(?:€|eur\\b|euro\\b|euros\\b|ευρώ|ευρω|ευρ\\.)";
  var RE_AFTER = new RegExp(NUM + "\\s?" + CUR, "i");
  var RE_BEFORE = new RegExp(CUR + "\\s?" + NUM, "i");
  function cents(s) {
    s = s.replace(/[  ]/g, "");
    var m = /^(.*?)(?:[.,](\d{1,2}))?$/.exec(s);
    var whole = m[1], dec = m[2] || "";
    // "1.234" with three digits after the mark = thousands, not cents.
    if (/^\d{1,3}([.,]\d{3})+$/.test(s)) { whole = s; dec = ""; }
    whole = whole.replace(/[.,]/g, "");
    if (!/^\d+$/.test(whole)) return 0;
    var c = parseInt(whole, 10) * 100 + (dec ? parseInt((dec + "0").slice(0, 2), 10) : 0);
    return c > 0 && c <= MAX_CENTS ? c : 0;
  }
  function inLine(l) {
    var m = RE_AFTER.exec(l), b = RE_BEFORE.exec(l);
    var hit = m && (!b || m.index <= b.index) ? m : b;
    if (!hit) return null;
    var c = cents(hit[1]);
    if (!c) return null;
    var rest = (l.slice(0, hit.index) + " " + l.slice(hit.index + hit[0].length))
      .replace(/[\s:–—-]+$/, "").replace(/^[\s:–—-]+/, "").replace(/\s+/g, " ").trim();
    return { cents: c, note: rest.slice(0, 200) };
  }
  // A receipt's total wins over its lines: a line with a total word.
  var TOTAL = /(σύνολο|συνολο|πληρωτέο|πληρωτεο|total|amount due|to pay)/i;
  function amount(text) {
    var ls = lines(text), first = null;
    for (var i = 0; i < ls.length; i++) {
      var a = inLine(ls[i]);
      if (!a) continue;
      a.line = ls[i].slice(0, 300);
      if (TOTAL.test(ls[i])) {
        // "Total 23,40 €": the note is the receipt's first line (the shop).
        if (!a.note || TOTAL.test(a.note) && a.note.replace(TOTAL, "").replace(/[\s:.-]/g, "") === "") a.note = i > 0 ? ls[0].slice(0, 200) : "";
        return a;
      }
      if (!first) first = a;
    }
    return first;
  }
  function amounts(list) {
    var out = [];
    (Array.isArray(list) ? list : lines(list)).slice(0, 50).forEach(function (l) {
      var a = typeof l === "string" ? inLine(l) : null;
      if (a && a.note) out.push({ text: a.note, cents: a.cents });
    });
    return out;
  }

  // ---------- Phones, e-mails, addresses ----------
  function card(text) {
    var k = K();
    if (!k || typeof k.parse !== "function") return null;
    var r;
    try { r = k.parse(head(text).slice(0, 4000)); } catch (e) { return null; }
    if (!r) return null;
    var out = {
      phones: (r.phones || []).map(function (p) { return p.v; }).filter(function (v) { return typeof v === "string" && v; }),
      emails: (r.emails || []).map(function (p) { return p.v; }).filter(function (v) { return typeof v === "string" && v; }),
      addresses: (r.addresses || []).map(addrText).filter(function (v) { return !!v; })
    };
    return out.phones.length || out.emails.length || out.addresses.length ? out : null;
  }
  function addrText(a) {
    if (!a || typeof a !== "object") return "";
    var city = [a.zip, a.city].filter(function (x) { return typeof x === "string" && x; }).join(" ");
    return [a.street, city, a.country].filter(function (x) { return typeof x === "string" && x; }).join(", ").slice(0, 200);
  }
  // The card reader also takes "word number" as a street; here an
  // address needs more: a postcode (105 63, 54622), a street word, or
  // a phone / e-mail beside it (a business card). Never an amount.
  var STREET = /(^|[^\u0370-\u03ffA-Za-z])(οδός|οδος|οδ\.|λεωφ|λ\.|πλατεία|πλατεια|πλ\.|street|st\.|road|rd\.|avenue|ave\.?|boulevard|blvd|str\.|straße|strasse|platz|weg)(?=$|[^\u0370-\u03ffA-Za-z])/i;
  var POSTCODE = /(^|\D)\d{3}\s?\d{2}(\D|$)/;
  function address(text) {
    var c = card(text);
    var a = c && c.addresses[0];
    if (!a || !/\d/.test(a) || inLine(a) || /^\D*(19|20)\d{2}\D*$/.test(a)) return "";   // a year is not a number on a street
    if (!(POSTCODE.test(a) || STREET.test(a) || c.phones.length || c.emails.length)) return "";
    // "Meeting at Ermou 25, …" → "Ermou 25, …": the words before the
    // last "at / στην / στο …" are not part of the place.
    var m = /^.*(?:^|\s)(?:at|στην|στη|στον|στο|@)\s+(?=\S)/i.exec(a);
    return m && m[0].length < a.length ? a.slice(m[0].length) : a;
    return "";
  }

  function all(text, today) {
    return { event: event(text, today), amount: amount(text), card: card(text), address: address(text) };
  }

  var API = { event: event, amount: amount, amounts: amounts, card: card, address: address, all: all, cents: cents };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  if (root) root.OrosSendDetect = API;
})(typeof window !== "undefined" ? window : globalThis);
