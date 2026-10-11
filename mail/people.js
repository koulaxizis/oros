// ============================================================
// orOS Mail — recipients from Contacts (v1.0.0)
// Reads the Contacts app's own data (localStorage
// "oros-contacts-data", same origin, read-only) so the To / Cc / Bcc
// fields suggest people as you type. Pure: no DOM, no storage.
//   fromContacts(raw)        → [{ name, addr, id }] (live contacts,
//                              one entry per e-mail address)
//   token(value, caret)      → { start, end, text } the address being
//                              typed (between top-level , ; separators)
//   suggest(people, q, skip, max) → best matches first: a word of the
//                              name or the address starting with q
//                              (accents and case ignored), then the
//                              ones that only contain it
//   put(value, tok, text)    → the field with that address replaced
//                              by text and ", " after it
// Exposes window.orosMailPeople or module.exports.
// ============================================================
(function (root) {
  "use strict";
  var MAX_PEOPLE = 5000;

  function str(x, n) { return typeof x === "string" ? x.trim().slice(0, n || 200) : ""; }
  // "Άννα" → "αννα": case and accents ignored
  function fold(s) {
    return String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  }

  function fromContacts(raw) {
    if (!raw || typeof raw !== "object" || !Array.isArray(raw.contacts)) return [];
    var gone = {};
    (Array.isArray(raw.deleted) ? raw.deleted : []).forEach(function (d) { if (d && typeof d.id === "string") gone[d.id] = 1; });
    var out = [], seen = {};
    raw.contacts.forEach(function (c) {
      if (!c || typeof c !== "object" || c.del || typeof c.id !== "string" || gone[c.id]) return;
      if (!Array.isArray(c.emails)) return;
      var name = [str(c.given), str(c.middle), str(c.family)].filter(Boolean).join(" ") ||
                 str(c.nickname) || str(c.org);
      c.emails.forEach(function (e) {
        var addr = str(e && typeof e === "object" ? e.v : e, 254).replace(/^mailto:/i, "");
        if (!/^[^\s@<>,;"]+@[^\s@<>,;"]+\.[^\s@<>,;"]+$/.test(addr)) return;
        var k = addr.toLowerCase();
        if (seen[k] || out.length >= MAX_PEOPLE) return;
        seen[k] = 1;
        out.push({ name: name.slice(0, 120), addr: addr, id: c.id });
      });
    });
    return out;
  }

  // Separators inside "quotes" or <angle brackets> do not count.
  function token(value, caret) {
    var s = String(value || "");
    if (!(caret >= 0) || caret > s.length) caret = s.length;
    var q = false, ang = false, esc = false, start = 0, end = s.length;
    for (var i = 0; i < s.length; i++) {
      var c = s[i];
      if (esc) { esc = false; continue; }
      if (c === "\\" && q) { esc = true; continue; }
      if (c === "\"" && !ang) q = !q;
      else if (c === "<" && !q) ang = true;
      else if (c === ">" && !q) ang = false;
      else if ((c === "," || c === ";" || c === "\n") && !q && !ang) {
        if (i < caret) start = i + 1;
        else { end = i; break; }
      }
    }
    return { start: start, end: end, text: s.slice(start, end).trim() };
  }

  function suggest(people, q, skip, max) {
    q = fold(q).trim();
    if (!q || /[<>]/.test(q)) return [];
    var no = {};
    (skip || []).forEach(function (a) { no[String(a).toLowerCase()] = 1; });
    var first = [], then = [];
    (people || []).forEach(function (p) {
      if (no[p.addr.toLowerCase()]) return;
      var n = fold(p.name), a = p.addr.toLowerCase();
      var words = n.split(/[\s.'-]+/);
      if (a.indexOf(q) === 0 || n.indexOf(q) === 0 || words.some(function (w) { return w.indexOf(q) === 0; })) first.push(p);
      else if (a.indexOf(q) >= 0 || n.indexOf(q) >= 0) then.push(p);
    });
    var by = function (x, y) {
      var a = fold(x.name || x.addr), b = fold(y.name || y.addr);
      return a !== b ? (a < b ? -1 : 1) : (x.addr.toLowerCase() < y.addr.toLowerCase() ? -1 : 1);
    };
    return first.sort(by).concat(then.sort(by)).slice(0, max || 6);
  }

  function put(value, tok, text) {
    var s = String(value || "");
    var before = s.slice(0, tok.start).replace(/\s+$/, "");
    var after = s.slice(tok.end).replace(/^[\s,;]+/, "");
    return (before ? before + " " : "") + text + ", " + after;
  }

  var api = { v: 1, fold: fold, fromContacts: fromContacts, token: token, suggest: suggest, put: put };
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.orosMailPeople = api;
})(typeof window !== "undefined" ? window : globalThis);
