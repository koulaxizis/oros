// ============================================================
// orOS Contacts — business card text → contact fields
// (contacts/cardtext.js, window.OrosContactsCard)
// ============================================================
// Pure helpers, no DOM, no storage (also loaded by the node tests).
// The text comes from the on-device text recognition of a card
// photo, or is pasted / typed by the person. Heuristics, English
// and Greek; the result only PREFILLS a new-contact form that the
// person checks before saving.
//
//   parse(text) → parser-shape contact { given, family, org,
//                 jobTitle, phones[{v,type}], emails[], websites[],
//                 addresses[], note, … } — lines it could not place
//                 go to the note, so nothing read is lost.
//
//   e-mail   anything@domain.tld
//   website  http(s)://…, www.…, or a bare domain (acme.gr)
//   phone    ≥ 7 digits; the label before it decides the type
//            (Mob / Κιν. → mobile, Tel / Τηλ. → work, Fax / Φαξ →
//            kept in the note); without a label a Greek 69… number
//            is a mobile, the rest work numbers
//   address  a line with a street word (Οδός, Λεωφ., Street, Ave…),
//            a postcode (115 26, 54622, T.K.) or "word number"
//   company  a line with a company form (Α.Ε., Ε.Π.Ε., Ι.Κ.Ε., Ltd,
//            Inc, GmbH, S.A. …); then a job line wins over a weak
//            company word (Software, Studio, Consulting …)
//   title    a line with a job word (Manager, CEO, Διευθυντής,
//            Μηχανικός, Σύμβουλος …)
//   name     the first line of 2–4 capitalised words left; ALL CAPS
//            becomes Title Case
// ============================================================
(function (root) {
  "use strict";

  function blank() {
    return {
      given: "", middle: "", family: "", nickname: "", org: "", jobTitle: "",
      phones: [], emails: [], addresses: [], websites: [], im: [],
      events: [], cats: [], note: "", photo: null, starred: false
    };
  }
  function fold(s) {
    var t = String(s || "").toLowerCase();
    try { t = t.normalize("NFD").replace(/[̀-ͯ]/g, ""); } catch (e) {}
    return t.replace(/ς/g, "σ");
  }

  var EMAIL = /[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}/g;
  var URL = /(?:https?:\/\/[^\s,;]+|www\.[^\s,;]+|(?:^|[\s(])(?:[a-z0-9\-]+\.)+(?:com|gr|net|org|eu|io|info|biz|co|uk|de|fr|it|es|cy|app|dev|me|online|shop|store)(?:\/[^\s,;]*)?(?=$|[\s),;]))/gi;
  var PHONE = /(?:\+|00)?\d[\d\s().\/\-]{5,}\d/g;

  var CO = /(^|[\s,])(α\.?\s?ε\.?|ε\.?\s?π\.?\s?ε\.?|ο\.?\s?ε\.?|ε\.?\s?ε\.?|ι\.?\s?κ\.?\s?ε\.?|μ\.?\s?ι\.?\s?κ\.?\s?ε\.?|a\.?\s?e\.?|i\.?\s?k\.?\s?e\.?|e\.?\s?p\.?\s?e\.?|s\.?\s?a\.?|ltd\.?|limited|inc\.?|llc|gmbh|corp\.?|corporation|co\.|company|group|plc|ag|bv|srl|spa|sarl|εταιρεια|ομιλοσ|τραπεζα|bank)(?=$|[\s,.])/;
  var CO_WEAK = /(^|[\s,])(software|solutions|technologies|technology|consulting|studio|agency|labs?|hotel|ξενοδοχειο|clinic|κλινικη|φαρμακειο|pharmacy)(?=$|[\s,.])/;
  var JOB = /(manager|director|ceo|cto|cfo|coo|cmo|founder|co-founder|owner|partner|president|engineer|developer|designer|consultant|sales|marketing|account|accountant|lawyer|attorney|advocate|doctor|dr\.?|physician|dentist|architect|officer|head of|lead|specialist|analyst|assistant|secretary|advisor|adviser|representative|agent|executive|associate|coordinator|administrator|technician|teacher|professor|researcher|chef|photographer|writer|editor|journalist|nurse|pharmacist|broker|realtor|διευθυντ|διευθυνουσα|διευθυνων|υπευθυν|μηχανικ|συμβουλ|σύμβουλ|πωλησε|ιδρυτ|συνιδρυτ|προεδρ|αντιπροεδρ|δικηγορ|γιατρ|ιατρ|οδοντιατρ|αρχιτεκτον|λογιστ|γραμματε|προγραμματιστ|σχεδιαστ|στελεχ|συνεργατ|αναλυτ|τεχνικ|καθηγητ|ερευνητ|φαρμακοποι|μεσιτ|ασφαλιστ|εκπροσωπ|διαχειριστ|ιδιοκτητ|επιμελητ|δημοσιογραφ|νοσηλευτ|υπαλληλ|σεφ|φωτογραφ)/;
  var STREET = /(^|[\s,.])(οδοσ|οδ\.|λεωφ\.?|λεωφοροσ|πλατεια|πλ\.|παροδοσ|street|st\.|avenue|ave\.?|road|rd\.|boulevard|blvd\.?|lane|square|sq\.|p\.?\s?o\.?\s?box|τ\.?\s?θ\.|τ\.?\s?κ\.?)(?=$|[\s,.\d])/;
  var ZIP = /(^|[^\d])(\d{3}\s?\d{2})(?!\d)/;
  var WORDNUM = /^[^\d,]{3,}\s\d{1,4}[α-ωa-z]?(,|$|\s)/i;

  function titleCase(s) {
    if (s !== s.toUpperCase() || s === s.toLowerCase()) return s;
    return s.toLowerCase().replace(/(^|[\s\-'.])([^\s\-'.])/g, function (m, a, b) { return a + b.toUpperCase(); })
      .replace(/σ(?=$|[\s\-'.,])/g, "ς");
  }
  function phoneType(label, num) {
    var l = fold(label);
    if (/(fax|φαξ)|(^|\s)f\s*[:.]?\s*$/.test(l)) return "fax";
    if (/(mob|cell|κιν|m\s*[:.]|^m$)/.test(l)) return "mobile";
    if (/(home|οικια|σπιτι)/.test(l)) return "home";
    if (/(tel|phone|τηλ|office|work|γραφ|t\s*[:.]|^t$|^p$|p\s*[:.])/.test(l)) {
      return /^(?:\+30|0030)?\s?69/.test(num.replace(/[\s().\-\/]/g, "").replace(/^(\+30|0030)/, "$1 ")) ? "mobile" : "work";
    }
    var d = num.replace(/\D/g, "").replace(/^(0030|30)(?=\d{10}$)/, "");
    return /^69\d{8}$/.test(d) ? "mobile" : "work";
  }
  function addAddress(pc, line) {
    var s = line.replace(/\s+/g, " ").trim().replace(/^(διευθυνση|address|addr)\s*[:.]\s*/i, "");
    var a = { street: "", city: "", zip: "", region: "", country: "", type: "work" };
    var m = s.match(ZIP);
    if (m) {
      a.zip = m[2].replace(/\s/g, "").replace(/^(\d{3})(\d{2})$/, "$1 $2");
      var at = s.indexOf(m[2], m.index);
      var before = s.slice(0, at).replace(/(τ\.?\s?κ\.?|t\.?\s?k\.?)\s*$/i, "").replace(/[,\s\-–]+$/, "").trim();
      var after = s.slice(at + m[2].length).replace(/^[,\s\-–]+/, "").trim();
      a.street = before.slice(0, 120);
      var parts = after.split(/\s*,\s*/);
      a.city = (parts[0] || "").slice(0, 60);
      if (parts[1]) a.country = parts[1].slice(0, 60);
    } else {
      a.street = s.slice(0, 120);
    }
    var prev = pc.addresses[pc.addresses.length - 1];
    if (prev && !prev.zip && a.zip && !prev.city) {          // street on one line, "115 26 Αθήνα" on the next
      prev.zip = a.zip;
      prev.city = a.city;
      if (a.street) prev.street = (prev.street + ", " + a.street).slice(0, 120);
      return;
    }
    if (a.street || a.city || a.zip) pc.addresses.push(a);
  }

  function parse(text) {
    var pc = blank(), rest = [], fax = [];
    var lines = String(text || "").replace(/\r/g, "").split("\n").map(function (l) {
      return l.replace(/[|_•·]+/g, " ").replace(/\s+/g, " ").trim();
    }).filter(function (l) { return /[0-9A-Za-zΑ-Ωα-ωΆ-ώ]/.test(l); });
    var left = [];
    lines.forEach(function (line) {
      var l = line;
      (l.match(EMAIL) || []).forEach(function (e) {
        if (!pc.emails.some(function (x) { return x.v.toLowerCase() === e.toLowerCase(); })) pc.emails.push({ v: e.slice(0, 120), type: "work" });
      });
      l = l.replace(EMAIL, " ");
      (l.match(URL) || []).forEach(function (u) {
        u = u.trim().replace(/^\(/, "").replace(/[.)]+$/, "");
        if (u && !pc.websites.some(function (x) { return x.v === u; })) pc.websites.push({ v: u.slice(0, 300), type: "work" });
      });
      l = l.replace(URL, " ");
      var isAddr = STREET.test(fold(l)) && !/\d{7,}/.test(l.replace(/[\s().\-\/]/g, ""));
      if (!isAddr) {
        var re = new RegExp(PHONE.source, "g"), m, cut = 0, found = false, out = "";
        while ((m = re.exec(l))) {
          var num = m[0].trim(), digits = num.replace(/\D/g, "");
          if (digits.length < 7 || digits.length > 15) continue;
          found = true;
          var label = l.slice(cut, m.index);
          var ty = phoneType(label, num);
          if (ty === "fax") fax.push(num);
          else if (!pc.phones.some(function (x) { return x.v.replace(/\D/g, "") === digits; })) pc.phones.push({ v: num.slice(0, 40), type: ty });
          out += label.replace(/(tel|phone|mob(ile)?|cell|fax|office|work|home|τηλ(εφωνο)?|κιν(ητο)?|φαξ|γραφ(ειο)?|[tmfp])\.?\s*[:.]?\s*$/i, " ");
          cut = m.index + m[0].length;
        }
        if (found) l = out + l.slice(cut);
      }
      l = l.replace(/^[\s,;:\-–/]+|[\s,;:\-–/]+$/g, "").replace(/\s+/g, " ").trim();
      if (/[A-Za-zΑ-Ωα-ωΆ-ώ0-9]{2,}/.test(l) && !/^(τηλ|tel|κιν|mob|fax|φαξ|e-?mail|web|www)\.?:?$/i.test(l)) left.push(l);
    });
    left.forEach(function (l) {
      var f = fold(l);
      if ((STREET.test(f) || (ZIP.test(l) && /[A-Za-zΑ-Ωα-ωΆ-ώ]{3,}/.test(l)) || WORDNUM.test(l)) && !JOB.test(f) && !CO.test(f) && !CO_WEAK.test(f)) {
        addAddress(pc, l);
        return;
      }
      if (!pc.org && CO.test(f)) { pc.org = l.slice(0, 80); return; }
      if (!pc.jobTitle && JOB.test(f) && l.split(" ").length <= 8) { pc.jobTitle = l.slice(0, 80); return; }
      if (!pc.org && CO_WEAK.test(f)) { pc.org = l.slice(0, 80); return; }
      rest.push(l);
    });
    // name: the first remaining line of 2–4 capitalised words
    for (var i = 0; i < rest.length; i++) {
      var words = rest[i].split(" ");
      if (words.length < 2 || words.length > 4 || /\d/.test(rest[i])) continue;
      var ok = words.every(function (wd) { return /^[A-ZΑ-ΩΆ-Ώ][A-Za-zΑ-Ωα-ωΆ-ώϊϋΐΰ.'\-]*$/.test(wd); });
      if (!ok) continue;
      var name = titleCase(rest[i]).split(" ");
      pc.family = name.pop().slice(0, 60);
      pc.given = name.join(" ").slice(0, 60);
      rest.splice(i, 1);
      break;
    }
    // company: no company form found → the first remaining line
    // without digits that is not a slogan-long sentence
    if (!pc.org) {
      for (var j = 0; j < rest.length; j++) {
        if (!/\d/.test(rest[j]) && rest[j].split(" ").length <= 5) { pc.org = rest[j].slice(0, 80); rest.splice(j, 1); break; }
      }
    }
    if (pc.jobTitle && !pc.given && !pc.family) {
      // "Μαρία Παπαδοπούλου, Υπεύθυνη Πωλήσεων" on one line
      var c = pc.jobTitle.split(/\s*[,–\-]\s+/);
      if (c.length === 2 && c[0].split(" ").length >= 2 && c[0].split(" ").length <= 4 && !JOB.test(fold(c[0]))) {
        var nm = titleCase(c[0]).split(" ");
        pc.family = nm.pop(); pc.given = nm.join(" "); pc.jobTitle = c[1];
      }
    }
    var notes = rest.slice();
    fax.forEach(function (n) { notes.push("Fax: " + n); });
    pc.note = notes.join("\n").slice(0, 500);
    if (!pc.given && !pc.family && !pc.org) {
      pc.given = (pc.emails[0] && pc.emails[0].v.split("@")[0]) || (pc.phones[0] && pc.phones[0].v) || "";
      pc.given = pc.given.slice(0, 60);
    }
    return pc;
  }

  // Assistant entry card (shell __orosOpenAt("contacts", { asNew })):
  // a loose object → parser-shape contact, clamped to the dialog's
  // limits, or null when it has neither a name nor a company.
  //   { given?, family?, name? (split like "add": last word = family,
  //     only when given/family are absent), org?, phones?[≤5],
  //     emails?[≤5], address? (one line → street), birthday?
  //     ("YYYY-MM-DD" real date, or "MM-DD" / "--MM-DD" yearless),
  //     note? }
  function asNewStr(v, max) {
    if (typeof v !== "string") return "";
    return v.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, max).trim();
  }
  function asNewList(v) {
    if (typeof v === "string") return [v];
    return Array.isArray(v) ? v : [];
  }
  function asNewDay(v) {
    var s = asNewStr(v, 12), m, y = null, mm, dd;
    if ((m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/))) { y = +m[1]; mm = +m[2]; dd = +m[3]; }
    else if ((m = s.match(/^-{0,2}(\d{2})-(\d{2})$/))) { mm = +m[1]; dd = +m[2]; }
    else return null;
    if (y !== null && (y < 1900 || y > new Date().getFullYear())) return null;
    if (mm < 1 || mm > 12 || dd < 1 || dd > new Date(y === null ? 2000 : y, mm, 0).getDate()) return null;
    var day = (mm < 10 ? "0" : "") + mm + "-" + (dd < 10 ? "0" : "") + dd;
    return { day: day, year: y, type: "birthday", label: "" };
  }
  function fromAsNew(x) {
    if (!x || typeof x !== "object" || Array.isArray(x)) return null;
    var pc = blank();
    pc.given = asNewStr(x.given, 60);
    pc.family = asNewStr(x.family, 60);
    if (!pc.given && !pc.family) {
      var words = asNewStr(x.name, 120).split(" ").filter(Boolean);
      if (words.length > 1) pc.family = words.pop().slice(0, 60);
      pc.given = words.join(" ").slice(0, 60).trim();
    }
    pc.org = asNewStr(x.org, 80);
    if (!pc.given && !pc.family && !pc.org) return null;
    asNewList(x.phones).forEach(function (p) {
      var v = asNewStr(p, 40);
      if (/\d/.test(v) && pc.phones.length < 5) pc.phones.push({ v: v, type: "mobile" });
    });
    var seen = {};
    asNewList(x.emails).forEach(function (e) {
      var v = asNewStr(e, 120);
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) || seen[v.toLowerCase()] || pc.emails.length >= 5) return;
      seen[v.toLowerCase()] = 1;
      pc.emails.push({ v: v, type: "home" });
    });
    var street = asNewStr(x.address, 120);
    if (street) pc.addresses.push({ street: street, city: "", zip: "", region: "", country: "", type: "home" });
    var bd = asNewDay(x.birthday);
    if (bd) pc.events.push(bd);
    // The note keeps its line breaks (other control chars dropped).
    if (typeof x.note === "string") {
      pc.note = x.note.replace(/\r\n?/g, "\n").replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, "").trim().slice(0, 500).trim();
    }
    return pc;
  }

  var api = { parse: parse, titleCase: titleCase, fromAsNew: fromAsNew };
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.OrosContactsCard = api;
})(typeof self !== "undefined" ? self : this);
