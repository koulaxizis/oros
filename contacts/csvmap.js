// ============================================================
// orOS Contacts — any CSV with a column mapping
// (contacts/csvmap.js, window.OrosContactsCsv)
// ============================================================
// Pure helpers, no DOM, no storage (also loaded by the node tests).
// Google's own CSV ("Phone 1 - Value"…) keeps its automatic reader
// in contacts.js; every other CSV (Outlook, Excel, a CRM, a list
// typed by hand, in English or Greek) goes through a mapping step:
//
//   parse(text)            → { rows: [[cell]], delim }  (comma,
//                            semicolon — what Greek Excel writes —
//                            or tab, detected on the first line;
//                            RFC 4180 quotes; BOM dropped)
//   isGoogle(headers)      → true for Google's numbered columns
//   guess(header)          → { f, ty } (f "" = ignore)
//   dateOrder(values)      → "dmy" | "mdy" (from the dates in the
//                            column; Greek and most of the world
//                            write day first, the default)
//   toContacts(rows, map, { header, order }) → parser-shape
//                            contacts for the import review
//
// Targets f: given middle family full nickname org jobTitle phone
// email website street city zip region country birthday note labels.
// phone / email / website / address parts carry a type ty.
// ============================================================
(function (root) {
  "use strict";

  var TARGETS = ["", "given", "middle", "family", "full", "nickname", "org", "jobTitle",
    "phone", "email", "website", "street", "city", "zip", "region", "country",
    "birthday", "note", "labels"];
  var TYPES = {
    phone: ["mobile", "home", "work", "main", "other"],
    email: ["home", "work", "other"],
    website: ["home", "work", "blog", "other"],
    addr: ["home", "work", "other"]
  };
  var ADDR = ["street", "city", "zip", "region", "country"];
  function typesOf(f) { return ADDR.indexOf(f) !== -1 ? TYPES.addr : (TYPES[f] || null); }

  // ---- CSV ----
  function detectDelim(s) {
    var first = "", inQ = false;
    for (var i = 0; i < s.length; i++) {
      var ch = s.charAt(i);
      if (ch === '"') inQ = !inQ;
      else if (ch === "\n" && !inQ) break;
      if (!inQ) first += ch;
    }
    var best = ",", n = -1;
    [",", ";", "\t"].forEach(function (d) {
      var c = first.split(d).length - 1;
      if (c > n) { n = c; best = d; }
    });
    return best;
  }
  function parse(text) {
    var s = String(text || "");
    if (s.charCodeAt(0) === 0xFEFF) s = s.slice(1);
    var delim = detectDelim(s);
    var rows = [], row = [], field = "", inQ = false;
    for (var i = 0; i < s.length; i++) {
      var ch = s.charAt(i);
      if (inQ) {
        if (ch === '"') {
          if (s.charAt(i + 1) === '"') { field += '"'; i++; }
          else inQ = false;
        } else field += ch;
      } else if (ch === '"') inQ = true;
      else if (ch === delim) { row.push(field); field = ""; }
      else if (ch === "\n") { row.push(field); field = ""; rows.push(row); row = []; }
      else if (ch !== "\r") field += ch;
    }
    if (field !== "" || row.length) { row.push(field); rows.push(row); }
    rows = rows.filter(function (r) { return r.some(function (c) { return String(c).trim() !== ""; }); });
    return { rows: rows, delim: delim };
  }

  // ---- header guessing ----
  function fold(s) {
    var t = String(s || "").toLowerCase();
    try { t = t.normalize("NFD").replace(/[̀-ͯ]/g, ""); } catch (e) {}
    return t.replace(/ς/g, "σ").replace(/[._\-\/()#:*]+/g, " ").replace(/\s+/g, " ").trim();
  }
  function isGoogle(headers) {
    return (headers || []).some(function (h) {
      var f = fold(h);
      return f === "phone 1 value" || f === "e mail 1 value" || f === "email 1 value" || f === "group membership";
    });
  }
  // (^| )word( |$) on folded text; Greek has no \b in JS regexes.
  function w(words) { return new RegExp("(^| )(" + words + ")( |$)"); }
  function addrType(h) {
    if (/(work|business|office|company|εργασια|γραφειο|επαγγελματ)/.test(h)) return "work";
    if (/(home|personal|private|οικια|σπιτι|κατοικια|προσωπικ)/.test(h)) return "home";
    return "other";
  }
  var RULES = [
    [/^(first|first name|firstname|given|given name|forename|ονομα|μικρο ονομα)$/, "given"],
    [/^(middle|middle name|middlename|πατρωνυμο|ονομα πατρο[σc]|δευτερο ονομα)$/, "middle"],
    [/^(last|last name|lastname|surname|family|family name|επωνυμο)$/, "family"],
    [/^(name|full name|fullname|display name|contact|contact name|ονοματεπωνυμο|ονομ επωνυμο|πληρε[σc] ονομα|επαφη)$/, "full"],
    [/^(nick|nickname|nick name|ψευδωνυμο|παρατσουκλι)$/, "nickname"],
    [/(job title|jobtitle)|^(position|role|job|occupation|θεση|ιδιοτητα|επαγγελμα|ρολο[σc]|θεση εργασια[σc])$/, "jobTitle"],
    [/(company|organi[sz]ation|employer|business name|εταιρεια|επιχειρηση|οργανισμο[σc]|επωνυμια)/, "org"],
    [/(e ?mail|ηλ ?ταχ|ηλεκτρονικο ταχυδρομειο)/, "email"],
    [/(phone|mobile|cell|fax|telephone|τηλεφωνο|κινητο|σταθερο)|(^| )(tel|τηλ|κιν)( |$)/, "phone"],
    [/(web ?page|website|homepage|ιστοσελιδα|ιστοτοπο[σc])|(^| )(web|url|site|www)( |$)/, "website"],
    [/(birthday|birth date|date of birth|γενεθλια|ημερομηνια γεννηση[σc]|ημ γεννηση[σc]|γεννηση)|(^| )(dob|bday)( |$)/, "birthday"],
    [/(postal|post code|postcode|zip|ταχ ?κωδ|ταχυδρομικο[σc] κωδικα[σc])|^(τ ?κ|tk)$|(^| )(τ ?κ)( |$)/, "zip"],
    [/(street|address|addr|οδο[σc]|διευθυνση)/, "street"],
    [/(city|town|πολη|δημο[σc])/, "city"],
    [/(state|region|province|county|νομο[σc]|περιφερεια|περιοχη)/, "region"],
    [/(country|χωρα)/, "country"],
    [/(note|comment|remark|description|σημειωσ|παρατηρησ|σχολι)/, "note"],
    [/(label|tag|group|categor|ετικετ|ομαδ|κατηγορ)/, "labels"]
  ];
  function guess(header) {
    var h = fold(header);
    if (!h || /(^| )(type|τυποσ)( |$)/.test(h)) return { f: "", ty: "" };
    for (var i = 0; i < RULES.length; i++) {
      if (!RULES[i][0].test(h)) continue;
      var f = RULES[i][1], ty = "";
      if (f === "phone") {
        if (/(fax|φαξ)/.test(h)) ty = "other";
        else if (/(mobile|cell|κινητ)|(^| )κιν( |$)/.test(h)) ty = "mobile";
        else if (/(work|business|office|company|εργασια|γραφειο)/.test(h)) ty = "work";
        else if (/(home|οικια|σπιτι|σταθερ)/.test(h)) ty = "home";
        else if (/(main|primary|κυριο)/.test(h)) ty = "main";
        else ty = "mobile";
      } else if (f === "email") {
        ty = /(work|business|office|εργασια)/.test(h) ? "work" : (/(home|personal|προσωπικ)/.test(h) ? "home" : "other");
      } else if (f === "website") {
        ty = /(work|business|εργασια)/.test(h) ? "work" : (/(blog)/.test(h) ? "blog" : (/(home|personal|προσωπικ)/.test(h) ? "home" : "other"));
      } else if (ADDR.indexOf(f) !== -1) {
        ty = addrType(h);
      }
      return { f: f, ty: ty };
    }
    return { f: "", ty: "" };
  }

  // ---- dates ----
  var MONTHS = {
    jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
    ιαν: 1, φεβ: 2, μαρ: 3, απρ: 4, μαι: 5, ιουν: 6, ιουλ: 7, αυγ: 8, σεπ: 9, οκτ: 10, νοε: 11, δεκ: 12
  };
  function monthOf(word) {
    var f = fold(word);
    if (f.slice(0, 4) === "ιουν") return 6;
    if (f.slice(0, 4) === "ιουλ") return 7;
    return MONTHS[f.slice(0, 3)] || 0;
  }
  function pad(n) { return (n < 10 ? "0" : "") + n; }
  function okDay(mm, dd) {
    return mm >= 1 && mm <= 12 && dd >= 1 && dd <= new Date(2000, mm, 0).getDate();
  }
  function year(y) {
    y = +y;
    if (y < 100) y += y <= 30 ? 2000 : 1900;
    return y >= 1850 && y <= 2200 ? y : null;
  }
  var NUM3 = /^(\d{1,4})[\/.\-](\d{1,2})[\/.\-](\d{2,4})$/;
  function dateOrder(values) {
    var dmy = 0, mdy = 0;
    (values || []).forEach(function (v) {
      var m = String(v || "").trim().match(NUM3);
      if (!m || m[1].length === 4) return;
      if (+m[1] > 12) dmy++;
      else if (+m[2] > 12) mdy++;
    });
    return mdy > dmy ? "mdy" : "dmy";
  }
  function parseDate(v, order) {
    var s = String(v || "").trim(), m, mm, dd;
    if (!s) return null;
    if ((m = s.match(/^(\d{4})[\-\/.](\d{1,2})[\-\/.](\d{1,2})(?:[T ].*)?$/)) || (m = s.match(/^(\d{4})(\d{2})(\d{2})$/))) {
      mm = +m[2]; dd = +m[3];
      return okDay(mm, dd) ? { day: pad(mm) + "-" + pad(dd), year: year(m[1]) } : null;
    }
    if ((m = s.match(NUM3))) {
      if (order === "mdy") { mm = +m[1]; dd = +m[2]; } else { dd = +m[1]; mm = +m[2]; }
      return okDay(mm, dd) ? { day: pad(mm) + "-" + pad(dd), year: year(m[3]) } : null;
    }
    if ((m = s.match(/^-{0,2}(\d{1,2})[\-\/.](\d{1,2})$/))) {
      if (order === "mdy" || s.charAt(0) === "-") { mm = +m[1]; dd = +m[2]; } else { dd = +m[1]; mm = +m[2]; }
      return okDay(mm, dd) ? { day: pad(mm) + "-" + pad(dd), year: null } : null;
    }
    // "Mar 17, 1975", "March 17 1975", "17 March 1975", "17 Μαρτίου 1975"
    if ((m = s.match(/^([^\d\s,.]+)\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s*(\d{4})?$/))) {
      mm = monthOf(m[1]); dd = +m[2];
      return mm && okDay(mm, dd) ? { day: pad(mm) + "-" + pad(dd), year: m[3] ? year(m[3]) : null } : null;
    }
    if ((m = s.match(/^(\d{1,2})\.?\s+([^\d\s,.]+)\.?,?\s*(\d{4})?$/))) {
      mm = monthOf(m[2]); dd = +m[1];
      return mm && okDay(mm, dd) ? { day: pad(mm) + "-" + pad(dd), year: m[3] ? year(m[3]) : null } : null;
    }
    return null;
  }

  // ---- rows → contacts ----
  function cut(s, n) { return String(s || "").trim().slice(0, n); }
  var LEN = { given: 60, middle: 60, family: 60, nickname: 60, org: 80, jobTitle: 80 };
  function splitFull(s) {
    s = String(s || "").replace(/\s+/g, " ").trim();
    if (!s) return null;
    var c = s.indexOf(",");
    if (c > 0) return { family: s.slice(0, c).trim(), given: s.slice(c + 1).trim() };
    var words = s.split(" ");
    if (words.length === 1) return { given: words[0], family: "" };
    var fam = words.pop();
    return { given: words.join(" "), family: fam };
  }
  function blank() {
    return {
      given: "", middle: "", family: "", nickname: "", org: "", jobTitle: "",
      phones: [], emails: [], addresses: [], websites: [], im: [],
      events: [], cats: [], note: "", photo: null, starred: false
    };
  }
  function toContacts(rows, map, opts) {
    opts = opts || {};
    var out = [], start = opts.header === false ? 0 : 1;
    var order = opts.order === "mdy" ? "mdy" : "dmy";
    for (var r = start; r < (rows || []).length; r++) {
      var row = rows[r], pc = blank(), full = "", addr = {}, addrOrder = [];
      (map || []).forEach(function (m, i) {
        if (!m || !m.f) return;
        var v = String(row[i] == null ? "" : row[i]).trim();
        if (!v) return;
        var T = typesOf(m.f), ty = T && T.indexOf(m.ty) !== -1 ? m.ty : (T ? T[T.length - 1] : "");
        if (LEN[m.f]) {
          pc[m.f] = cut(pc[m.f] ? pc[m.f] + " " + v : v, LEN[m.f]);
        } else if (m.f === "full") {
          full = full ? full + " " + v : v;
        } else if (m.f === "note") {
          pc.note = cut(pc.note ? pc.note + "\n" + v : v, 500);
        } else if (m.f === "email") {
          v.split(/[;,\s]+/).forEach(function (e) {
            e = cut(e, 120);
            if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) && !pc.emails.some(function (x) { return x.v.toLowerCase() === e.toLowerCase(); })) pc.emails.push({ v: e, type: ty });
          });
        } else if (m.f === "phone") {
          v.split(/[;,]|\s\/\s/).forEach(function (p) {
            p = cut(p, 40);
            var dg = p.replace(/\D/g, "");
            if (dg.length >= 3 && !pc.phones.some(function (x) { return x.v.replace(/\D/g, "") === dg; })) pc.phones.push({ v: p, type: ty });
          });
        } else if (m.f === "website") {
          v.split(/[;\s]+/).forEach(function (u) {
            u = cut(u, 300);
            if (u && !pc.websites.some(function (x) { return x.v === u; })) pc.websites.push({ v: u, type: ty });
          });
        } else if (ADDR.indexOf(m.f) !== -1) {
          if (!addr[ty]) { addr[ty] = { street: "", city: "", zip: "", region: "", country: "", type: ty }; addrOrder.push(ty); }
          var a = addr[ty], max = m.f === "street" ? 120 : (m.f === "zip" ? 20 : 60);
          a[m.f] = cut(a[m.f] ? a[m.f] + ", " + v : v, max);
        } else if (m.f === "birthday") {
          var d = parseDate(v, order);
          if (d && !pc.events.some(function (e) { return e.type === "birthday"; })) pc.events.push({ day: d.day, year: d.year, type: "birthday", label: "" });
        } else if (m.f === "labels") {
          v.split(/:::|[;,|]/).forEach(function (g) {
            g = g.replace(/^\*\s*/, "").trim().slice(0, 40);
            if (g && pc.cats.indexOf(g) === -1) pc.cats.push(g);
          });
        }
      });
      if (full && !pc.given && !pc.family) {
        var sp = splitFull(full);
        if (sp) { pc.given = cut(sp.given, 60); pc.family = cut(sp.family, 60); }
      }
      addrOrder.forEach(function (ty) { pc.addresses.push(addr[ty]); });
      if (!pc.given && !pc.family && !pc.org && !pc.nickname) {
        pc.given = (pc.emails[0] && pc.emails[0].v.slice(0, 60)) || (pc.phones[0] && pc.phones[0].v) || "";
      }
      if (pc.given || pc.family || pc.org || pc.nickname) out.push(pc);
    }
    return out;
  }

  var api = {
    TARGETS: TARGETS, TYPES: TYPES, typesOf: typesOf, parse: parse, isGoogle: isGoogle,
    guess: guess, fold: fold, dateOrder: dateOrder, parseDate: parseDate, toContacts: toContacts
  };
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.OrosContactsCsv = api;
})(typeof self !== "undefined" ? self : this);
