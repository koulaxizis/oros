// ============================================================
// orOS Writer — mail merge (pure logic, no DOM)
// A document with {{Field}} placeholders + records (a CSV file or the
// Contacts app's data) → one filled copy per record. Every merged value
// is HTML-escaped; placeholders are only replaced in text, never inside
// a tag or an attribute.
//   · fieldsIn(html): the placeholder names, in order, once each
//   · parseCsv(text): { headers[], rows[{header: value}] } (",", ";"
//     or tab, quotes, CRLF, BOM)
//   · contactRecords(raw, labelId?): { headers[], rows[] } from
//     oros-contacts-data (live contacts only)
//   · contactLabels(raw): [{id, name}]
//   · findHeader(name, headers): the column a placeholder takes
//   · mergeHtml(html, row, headers): { html, missing[] }
// Loaded by writer.js (window.WriterMerge) and the tests (require).
// ============================================================
(function (root) {
  "use strict";

  var MAX_ROWS = 5000, MAX_COLS = 100, MAX_VAL = 5000;
  var PH_RE = /\{\{\s*([^{}<>\n]{1,60}?)\s*\}\}/g;

  function esc(s) {
    return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;")
      .replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }
  function unesc(s) {
    return String(s).replace(/&nbsp;/g, " ").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
      .replace(/&quot;/g, "\"").replace(/&#39;/g, "'").replace(/&amp;/g, "&");
  }
  // "First name" ≈ "first_name" ≈ "FirstName"; "Επώνυμο" ≈ "ΕΠΩΝΥΜΟ"
  function normKey(s) {
    return String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "")
      .toLowerCase().replace(/[\s_\-.]+/g, "");
  }

  // The text parts of an html string (tags kept apart).
  function parts(html) { return String(html || "").split(/(<[^>]*>)/); }

  function fieldsIn(html) {
    var out = [], seen = {};
    parts(html).forEach(function (seg, i) {
      if (i % 2) return;
      var text = unesc(seg), m;
      PH_RE.lastIndex = 0;
      while ((m = PH_RE.exec(text))) {
        var k = normKey(m[1]);
        if (k && !seen[k]) { seen[k] = 1; out.push(m[1].trim()); }
      }
    });
    return out;
  }

  /* ----- CSV ----- */
  function sniff(text) {
    var line = text.split(/\r?\n/)[0] || "";
    var best = ",", n = -1;
    [",", ";", "\t"].forEach(function (d) {
      var c = 0, q = false;
      for (var i = 0; i < line.length; i++) {
        if (line[i] === "\"") q = !q;
        else if (!q && line[i] === d) c++;
      }
      if (c > n) { n = c; best = d; }
    });
    return best;
  }
  function parseCsv(text) {
    text = String(text || "").replace(/^﻿/, "");
    var d = sniff(text), rows = [], row = [], cell = "", q = false, i = 0, n = text.length;
    function endCell() { row.push(cell.length > MAX_VAL ? cell.slice(0, MAX_VAL) : cell); cell = ""; }
    function endRow() { endCell(); if (row.length > 1 || row[0] !== "") rows.push(row); row = []; }
    for (; i < n && rows.length <= MAX_ROWS; i++) {
      var c = text[i];
      if (q) {
        if (c === "\"") { if (text[i + 1] === "\"") { cell += "\""; i++; } else q = false; }
        else cell += c;
      } else if (c === "\"" && cell === "") q = true;
      else if (c === d) endCell();
      else if (c === "\n") endRow();
      else if (c === "\r") { if (text[i + 1] !== "\n") endRow(); }
      else cell += c;
    }
    if (cell !== "" || row.length) endRow();
    if (!rows.length) return { headers: [], rows: [] };
    var seen = {}, headers = rows[0].slice(0, MAX_COLS).map(function (h, k) {
      var name = String(h).trim().slice(0, 60) || ("Column " + (k + 1));
      var base = name, j = 2;
      while (seen[normKey(name)]) name = base + " " + (j++);
      seen[normKey(name)] = 1;
      return name;
    });
    var out = rows.slice(1, MAX_ROWS + 1).map(function (r) {
      var o = {};
      headers.forEach(function (h, k) { o[h] = r[k] == null ? "" : String(r[k]); });
      return o;
    });
    return { headers: headers, rows: out };
  }

  /* ----- Contacts ----- */
  // Column names (English) and the other names a placeholder may use.
  var CONTACT_COLS = [
    ["FullName", ["Name", "Full name", "Ονοματεπώνυμο", "Όνομα και επώνυμο"]],
    ["FirstName", ["Given name", "First", "Όνομα"]],
    ["MiddleName", ["Middle", "Πατρώνυμο", "Μεσαίο όνομα"]],
    ["LastName", ["Family name", "Surname", "Last", "Επώνυμο"]],
    ["Nickname", ["Παρατσούκλι", "Ψευδώνυμο"]],
    ["Company", ["Organization", "Organisation", "Org", "Εταιρεία", "Εταιρία"]],
    ["JobTitle", ["Title", "Job", "Θέση", "Τίτλος"]],
    ["Email", ["E-mail", "Mail", "Ηλεκτρονικό ταχυδρομείο"]],
    ["Phone", ["Telephone", "Mobile", "Τηλέφωνο", "Κινητό"]],
    ["Address", ["Full address", "Διεύθυνση"]],
    ["Street", ["Οδός"]],
    ["City", ["Town", "Πόλη"]],
    ["PostalCode", ["Zip", "Postcode", "ΤΚ", "Ταχυδρομικός κώδικας"]],
    ["Region", ["State", "County", "Νομός", "Περιοχή"]],
    ["Country", ["Χώρα"]],
    ["Birthday", ["Γενέθλια"]]
  ];
  var ALIAS = {};
  CONTACT_COLS.forEach(function (c) {
    ALIAS[normKey(c[0])] = c[0];
    c[1].forEach(function (a) { ALIAS[normKey(a)] = c[0]; });
  });

  function str(x, n) { return typeof x === "string" ? x.trim().slice(0, n || 300) : ""; }
  function firstVal(list) {
    if (!Array.isArray(list)) return "";
    for (var i = 0; i < list.length; i++) {
      var v = list[i] && typeof list[i] === "object" ? list[i].v : list[i];
      if (typeof v === "string" && v.trim()) return v.trim().slice(0, 300);
    }
    return "";
  }
  function liveContacts(raw) {
    if (!raw || typeof raw !== "object" || !Array.isArray(raw.contacts)) return [];
    var gone = {};
    var del = raw.deleted;
    if (Array.isArray(del)) del.forEach(function (d) { if (d && typeof d.id === "string") gone[d.id] = 1; });
    else if (del && typeof del === "object") Object.keys(del).forEach(function (k) { gone[k] = 1; });
    return raw.contacts.filter(function (c) {
      return c && typeof c === "object" && typeof c.id === "string" && !c.del && !gone[c.id];
    });
  }
  function contactLabels(raw) {
    if (!raw || !Array.isArray(raw.labels)) return [];
    return raw.labels.filter(function (l) { return l && typeof l.id === "string" && typeof l.name === "string" && !l.del; })
      .map(function (l) { return { id: l.id, name: l.name.slice(0, 60) }; });
  }
  function contactRecords(raw, labelId) {
    var rows = liveContacts(raw).filter(function (c) {
      return !labelId || (Array.isArray(c.labelIds) && c.labelIds.indexOf(labelId) >= 0);
    }).map(function (c) {
      var a = Array.isArray(c.addresses) && c.addresses.find(function (x) { return x && typeof x === "object"; }) || {};
      var given = str(c.given, 60), middle = str(c.middle, 60), family = str(c.family, 60);
      var full = [given, middle, family].filter(Boolean).join(" ") || str(c.nickname, 60) || str(c.org, 80);
      var street = str(a.street, 120), city = str(a.city, 60), zip = str(a.zip, 20), region = str(a.region, 60), country = str(a.country, 60);
      var bday = "";
      if (Array.isArray(c.events)) {
        var ev = c.events.find(function (e) { return e && e.type === "birthday" && typeof e.day === "string"; });
        if (ev && /^\d\d-\d\d$/.test(ev.day)) bday = ev.day.slice(3) + "/" + ev.day.slice(0, 2) + (ev.year ? "/" + ev.year : "");
      }
      return {
        FullName: full, FirstName: given, MiddleName: middle, LastName: family,
        Nickname: str(c.nickname, 60), Company: str(c.org, 80), JobTitle: str(c.jobTitle, 80),
        Email: firstVal(c.emails), Phone: firstVal(c.phones),
        Address: [street, [zip, city].filter(Boolean).join(" "), region, country].filter(Boolean).join(", "),
        Street: street, City: city, PostalCode: zip, Region: region, Country: country, Birthday: bday
      };
    });
    rows.sort(function (x, y) {
      var a = normKey(x.LastName || x.FullName), b = normKey(y.LastName || y.FullName);
      return a < b ? -1 : a > b ? 1 : 0;
    });
    return { headers: CONTACT_COLS.map(function (c) { return c[0]; }), rows: rows.slice(0, MAX_ROWS) };
  }

  // The column a placeholder name takes: the same name (case, accents,
  // spaces ignored), else a known alias of a Contacts column.
  function findHeader(name, headers) {
    var k = normKey(name);
    for (var i = 0; i < headers.length; i++) if (normKey(headers[i]) === k) return headers[i];
    var a = ALIAS[k];
    if (a) for (var j = 0; j < headers.length; j++) if (headers[j] === a) return headers[j];
    return null;
  }

  function mergeHtml(html, row, headers) {
    var missing = [], seen = {};
    var out = parts(html).map(function (seg, i) {
      if (i % 2 || seg.indexOf("{{") < 0) return seg;
      // placeholders may hold entities ("{{A&amp;B}}"): match on the
      // decoded text, rebuild the segment escaped
      var text = unesc(seg), res = "", last = 0, m;
      PH_RE.lastIndex = 0;
      while ((m = PH_RE.exec(text))) {
        res += esc(text.slice(last, m.index));
        var h = findHeader(m[1], headers || Object.keys(row || {}));
        if (h === null) {
          if (!seen[normKey(m[1])]) { seen[normKey(m[1])] = 1; missing.push(m[1].trim()); }
        } else {
          res += esc(row && row[h] != null ? row[h] : "").replace(/\r?\n/g, "<br>");
        }
        last = PH_RE.lastIndex;
      }
      return res + esc(text.slice(last));
    }).join("");
    return { html: out, missing: missing };
  }

  var api = {
    fieldsIn: fieldsIn, parseCsv: parseCsv, contactRecords: contactRecords, contactLabels: contactLabels,
    findHeader: findHeader, mergeHtml: mergeHtml, normKey: normKey, esc: esc, MAX_ROWS: MAX_ROWS
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.WriterMerge = api;
})(typeof window !== "undefined" ? window : this);
