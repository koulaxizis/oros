// ============================================================
// orOS Health — .oroshealth file (health/package.js,
// window.OrosHealthPackage). The descriptor of Health for the record
// apps' kit (../recordpkg.js, docs/oros-bundle.md "Record apps"):
// every reading, own kind, medicine, dose, refill, symptom, allergy,
// condition, emergency contact, vaccination, appointment and document
// in one orOS bundle, the documents' photos and PDFs in media/; opening
// one ADDS what this device lacks, with its ids. Pure (no DOM, no
// storage), so the app and `node --test` run the same code. Needs
// core.js (window.OrosHealthCore; require("./core.js") under Node).
//   DESC                     the kit descriptor; merge = core.js merge
//                            (pure: LWW per row by m, tombstones), which
//                            only ever sees the records the kit let
//                            through, so a clash keeps the local record;
//                            settings and the Medical ID of this device
//                            stay as they are
//   DESC.norm(data)          a file's data → the slice's shape, every
//                            row through core.js's own norm* (invalid
//                            rows dropped), capped counts
//   DESC.strip(state)        the slice → { ver, en, ty, md, dl, rf, sy,
//                            sk, al, cn, ec, vx, ap, dc, set, pf, ats? }:
//                            no tombstones, no snoozed doses (a snooze is
//                            notification state) and every reminder off
//                            (kinds' reminder times, medicine, vaccine and
//                            appointment reminders ring on the device that
//                            set them, never because a file was opened)
//   DESC.tombIds(state)      the ids in state.tombs ("en:<id>" → id)
//   DESC.previews(state, l)  readings.csv (every reading in the units of
//                            the file's settings; formula guard) and
//                            health.md (Medical ID, allergies,
//                            conditions, medicines, vaccinations,
//                            appointments, documents)
//   ats                      document files: { "<file name>":
//                            "<sha256>.<jpg|pdf>" }, the media key of each
//                            file a document's `sc` names (Files › Health).
//                            Only names that carry their document's own id
//                            are kept.
//   atsOf(doc)               the file names of a document that are its own
//   collOf(id, state)        the collections that hold a record id
//   COLLS, LIM, KEY_RE
// Never in the file: tombstones, device prefs (oros-health-prefs: tab,
// chart and report choices), Workouts weights (another app's data).
// ============================================================
(function (root) {
  "use strict";

  function core() { return typeof module === "object" && module.exports ? require("./core.js") : root.OrosHealthCore; }
  var COLLS = ["en", "ty", "md", "dl", "rf", "sy", "sk", "al", "cn", "ec", "vx", "ap", "dc"];
  // per file (the slice lives in localStorage: the same order as an import)
  var LIM = { en: 100000, ty: 200, md: 500, dl: 100000, rf: 20000, sy: 50000, sk: 200,
              al: 500, cn: 500, ec: 100, vx: 2000, ap: 5000, dc: 2000 };
  var KEY_RE = /^[0-9a-f]{64}\.(jpg|pdf)$/;

  function isObj(v) { return !!v && typeof v === "object" && !Array.isArray(v); }
  function clone(x) { return JSON.parse(JSON.stringify(x)); }
  function cmpStr(x, y) { return x < y ? -1 : (x > y ? 1 : 0); }
  function pad2(n) { return (n < 10 ? "0" : "") + n; }

  // A document's own file names (AT_RE, the middle part = its id)
  function atsOf(doc) {
    var C = core();
    if (!isObj(doc) || !Array.isArray(doc.sc)) return [];
    return doc.sc.filter(function (n) { return typeof n === "string" && C.AT_RE.test(n) && n.split("-")[1] === doc.id; });
  }
  // the files map: names some document of dc names → a hash key of the same type
  function normAts(ats, dc) {
    var out = {}, used = {};
    if (!isObj(ats)) return out;
    (dc || []).forEach(function (d) { atsOf(d).forEach(function (n) { used[n] = 1; }); });
    Object.keys(ats).sort(cmpStr).forEach(function (n) {
      var k = ats[n];
      if (!used[n] || typeof k !== "string" || !KEY_RE.test(k)) return;
      if (n.split(".").pop() !== k.split(".").pop()) return;
      out[n] = k;
    });
    return out;
  }
  var NORM = null;
  function norms() {
    var C = core();
    return NORM || (NORM = { en: C.normEntry, ty: C.normType, md: C.normMed, dl: C.normDose, rf: C.normRefill,
                             sy: C.normSym, sk: C.normSymKind, al: C.normAllergy, cn: C.normCond, ec: C.normContact,
                             vx: C.normVax, ap: C.normAppt, dc: C.normDoc });
  }

  function norm(data) {
    if (!isObj(data)) return null;
    var C = core(), N = norms(), out = { ver: C.DATA_VER };
    COLLS.forEach(function (c) {
      var seen = {};
      out[c] = [];
      (Array.isArray(data[c]) ? data[c] : []).slice(0, LIM[c] * 2).forEach(function (raw) {
        if (out[c].length >= LIM[c]) return;
        var x = N[c](raw);
        if (!x || seen[x.id]) return;
        if (c === "dc") {                          // only its own files
          var own = atsOf(x);
          if (own.length) x.sc = own; else delete x.sc;
        }
        seen[x.id] = 1;
        out[c].push(x);
      });
    });
    out.set = C.normSettings(data.set);
    out.pf = C.normProfile(data.pf);
    var ats = normAts(data.ats, out.dc);
    if (Object.keys(ats).length) out.ats = ats;
    if (isObj(data.tombs)) out.tombs = data.tombs;          // tombIds sees it, then strip drops it
    return out;
  }
  // Reminders off: they ring where they were set, not where a file lands.
  function quiet(c, x) {
    if (!isObj(x)) return x;
    if (c === "ty") x.r = [];
    else if (c === "md" || c === "vx") x.rm = 0;
    else if (c === "ap") x.rm = -1;
    return x;
  }
  function strip(state) {
    var s = isObj(state) ? state : {}, out = { ver: core().DATA_VER };
    COLLS.forEach(function (c) {
      var list = Array.isArray(s[c]) ? clone(s[c]) : [];
      if (c === "dl") list = list.filter(function (x) { return !isObj(x) || x.s !== "z"; });
      out[c] = list.map(function (x) { return quiet(c, x); });
    });
    out.set = isObj(s.set) ? clone(s.set) : null;
    out.pf = isObj(s.pf) ? clone(s.pf) : null;
    var ats = normAts(s.ats, out.dc);
    if (Object.keys(ats).length) out.ats = ats;
    return out;
  }
  function tombIds(state) {
    var out = [];
    if (isObj(state) && isObj(state.tombs)) Object.keys(state.tombs).forEach(function (k) {
      var i = k.indexOf(":");
      if (i > 0) out.push(k.slice(i + 1));
    });
    return out;
  }

  // ---------- previews ----------
  var WORDS = {
    en: { date: "Date", time: "Time", kind: "Measurement", value: "Value", unit: "Unit", dia: "Diastolic",
          pulse: "Pulse", note: "Note", tags: "Tags", h: "h", bpm: "bpm", steps: "steps",
          head: "Health", id: "Medical ID", name: "Name", born: "Date of birth", blood: "Blood type",
          donor: "Organ donor", yes: "Yes", no: "No", notes: "Medical notes", al: "Allergies", cn: "Conditions",
          md: "Medicines", ec: "Emergency contacts", vx: "Vaccinations", ap: "Appointments", dc: "Documents",
          since: "since", next: "next dose", stopped: "stopped", asNeeded: "as needed", files: "files",
          "pkg.sev.1": "mild", "pkg.sev.2": "moderate", "pkg.sev.3": "severe",
          "t.bp": "Blood pressure", "t.wt": "Weight", "t.gl": "Blood sugar", "t.sl": "Sleep", "t.hr": "Resting heart rate",
          "t.tp": "Temperature", "t.o2": "Oxygen (SpO₂)", "t.st": "Steps",
          note1: "Made by orOS Health. This file is not encrypted." },
    el: { date: "Ημερομηνία", time: "Ώρα", kind: "Μέτρηση", value: "Τιμή", unit: "Μονάδα", dia: "Διαστολική",
          pulse: "Σφυγμοί", note: "Σημείωση", tags: "Ετικέτες", h: "ώ", bpm: "παλμοί/λεπτό", steps: "βήματα",
          head: "Υγεία", id: "Ιατρική ταυτότητα", name: "Όνομα", born: "Ημερομηνία γέννησης", blood: "Ομάδα αίματος",
          donor: "Δωρητής οργάνων", yes: "Ναι", no: "Όχι", notes: "Ιατρικές σημειώσεις", al: "Αλλεργίες", cn: "Παθήσεις",
          md: "Φάρμακα", ec: "Επαφές έκτακτης ανάγκης", vx: "Εμβόλια", ap: "Ραντεβού", dc: "Έγγραφα",
          since: "από", next: "επόμενη δόση", stopped: "διακόπηκε", asNeeded: "όταν χρειάζεται", files: "αρχεία",
          "pkg.sev.1": "ήπια", "pkg.sev.2": "μέτρια", "pkg.sev.3": "σοβαρή",
          "t.bp": "Πίεση", "t.wt": "Βάρος", "t.gl": "Σάκχαρο", "t.sl": "Ύπνος", "t.hr": "Σφυγμοί ηρεμίας",
          "t.tp": "Θερμοκρασία", "t.o2": "Οξυγόνο (SpO₂)", "t.st": "Βήματα",
          note1: "Φτιάχτηκε από την Υγεία του orOS. Το αρχείο δεν είναι κρυπτογραφημένο." }
  };
  // The kit passes "el" or "en"; a pack language (orosI18n, ../i18n.js,
  // browser only) reads the "health" pack. → the language code.
  function langOf(lang) {
    var code = lang === "el" ? "el" : "en", I = root && root.orosI18n;
    if (code === "en" && I && typeof I.lang === "function") {
      var c = I.lang();
      if (c !== "el" && c !== "en") { if (!WORDS[c]) I.table(WORDS, "health", c); if (WORDS[c]) code = c; }
    }
    return code;
  }
  // Decimal comma (Greek, German, …): CSV wants ";" then.
  function commaOf(code) {
    if (code === "el") return true;
    if (code === "en") return false;
    try { return (1.5).toLocaleString(root.orosI18n.locale(code)).indexOf(",") >= 0; } catch (e) { return false; }
  }
  // Greek Excel wants ";" and a decimal comma; a cell a spreadsheet
  // would run as a formula gets an apostrophe in front.
  function csvCell(v, sep) {
    var s = String(v == null ? "" : v);
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
    if (s.indexOf(sep) >= 0 || /["\n\r]/.test(s)) s = '"' + s.replace(/"/g, '""') + '"';
    return s;
  }
  function num(x, dec, el) {
    var p = Math.pow(10, dec), s = String(Math.round(x * p) / p);
    return el ? s.replace(".", ",") : s;
  }
  function ymdOf(ms) { var d = new Date(ms); return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate()); }
  function hmOf(ms) { var d = new Date(ms); return pad2(d.getHours()) + ":" + pad2(d.getMinutes()); }
  function line(s) { return String(s == null ? "" : s).replace(/\s+/g, " ").trim(); }

  function readingsCsv(s, code) {
    var C = core(), W = WORDS[code] || WORDS.en, el = commaOf(code), sep = el ? ";" : ",", set = C.settingsOf(s);
    var types = {};
    (s.ty || []).forEach(function (ty) { types[ty.id] = ty; });
    function valueOf(e) {
      switch (e.t) {
        case "bp": return [e.v[0], "mmHg"];
        case "wt": return [num(C.toUnit("w", e.v[0], set), 2, el), set.wu];
        case "gl": return [num(C.toUnit("g", e.v[0], set), set.gu === "mmol" ? 1 : 0, el), set.gu === "mmol" ? "mmol/L" : "mg/dL"];
        case "sl": return [num(e.v[0] / 60, 2, el), W.h];
        case "hr": return [e.v[0], W.bpm];
        case "tp": return [num(C.toUnit("t", e.v[0], set), 1, el), set.tu === "f" ? "°F" : "°C"];
        case "o2": return [e.v[0], "%"];
        case "st": return [e.v[0], W.steps];
      }
      var ty = types[e.t];
      return [num(e.v[0] / 1000, ty ? ty.dc : 3, el), ty ? ty.u : ""];
    }
    var rows = [[W.date, W.time, W.kind, W.value, W.unit, W.dia, W.pulse, W.note, W.tags]];
    (s.en || []).slice().sort(function (a, b) { return a.at - b.at || cmpStr(a.id, b.id); }).forEach(function (e) {
      var ty = types[e.t], name = W["t." + e.t] || (ty ? ty.n : e.t), vu = valueOf(e);
      rows.push([ymdOf(e.at), hmOf(e.at), name, vu[0], vu[1], e.t === "bp" ? e.v[1] : "",
                 e.t === "bp" && e.v[2] ? e.v[2] : "", line(e.n), (e.g || []).join(", ")]);
    });
    if (rows.length === 1) return "";
    return "﻿" + rows.map(function (r) { return r.map(function (c) { return csvCell(c, sep); }).join(sep); }).join("\r\n") + "\r\n";
  }

  function healthMd(s, code) {
    var W = WORDS[code] || WORDS.en, out = ["# " + W.head, "", "_" + W.note1 + "_", ""];
    function sec(title, items) {
      if (!items.length) return;
      out.push("## " + title, "");
      items.forEach(function (x) { out.push("- " + x); });
      out.push("");
    }
    var pf = isObj(s.pf) ? s.pf : null, id = [];
    if (pf) {
      if (pf.nm) id.push(W.name + ": " + line(pf.nm));
      if (pf.bd) id.push(W.born + ": " + pf.bd);
      if (pf.bt) id.push(W.blood + ": " + pf.bt);
      if (pf.od) id.push(W.donor + ": " + (pf.od === 1 ? W.yes : W.no));
      if (pf.nt) id.push(W.notes + ": " + line(pf.nt));
    }
    sec(W.id, id);
    function byName(a, b) { return cmpStr(String(a.n).toLowerCase(), String(b.n).toLowerCase()) || cmpStr(a.id, b.id); }
    sec(W.al, (s.al || []).slice().sort(byName).map(function (a) {
      return line(a.n) + (a.sv ? " (" + W["pkg.sev." + a.sv] + ")" : "") + (a.r ? ": " + line(a.r) : "");
    }));
    sec(W.cn, (s.cn || []).slice().sort(byName).map(function (c) { return line(c.n) + (c.sd ? " (" + W.since + " " + c.sd + ")" : ""); }));
    sec(W.md, (s.md || []).slice().sort(byName).map(function (m) {
      var when = m.k === "p" || !m.tm.length ? W.asNeeded : m.tm.map(function (x) { return pad2(Math.floor(x / 60)) + ":" + pad2(x % 60); }).join(", ");
      return line(m.n) + (m.s ? " " + line(m.s) : "") + " · " + when + " · " + m.sd + (m.ed ? "–" + m.ed : "") + (m.ar ? " (" + W.stopped + ")" : "");
    }));
    sec(W.ec, (s.ec || []).slice().sort(byName).map(function (c) { return line(c.n) + (c.rl ? " (" + line(c.rl) + ")" : "") + " " + c.ph; }));
    sec(W.vx, (s.vx || []).slice().sort(function (a, b) { return cmpStr(a.d, b.d) || cmpStr(a.id, b.id); }).map(function (v) {
      return v.d + " " + line(v.n) + (v.nx ? " · " + W.next + " " + v.nx : "");
    }));
    sec(W.ap, (s.ap || []).slice().sort(function (a, b) { return a.at - b.at || cmpStr(a.id, b.id); }).map(function (a) {
      return ymdOf(a.at) + " " + hmOf(a.at) + " " + [line(a.dr), line(a.sp), line(a.pl)].filter(Boolean).join(" · ");
    }));
    sec(W.dc, (s.dc || []).slice().sort(function (a, b) { return cmpStr(a.d, b.d) || cmpStr(a.id, b.id); }).map(function (d) {
      return d.d + " " + line(d.n) + (d.sc && d.sc.length ? " (" + d.sc.length + " " + W.files + ")" : "");
    }));
    return out.join("\n");
  }
  function previews(state, lang) {
    var s = isObj(state) ? state : {}, code = langOf(lang), out = { "health.md": healthMd(s, code) };
    var csv = readingsCsv(s, code);
    if (csv) out["readings.csv"] = csv;
    return out;
  }

  // The collections of a state that hold a record with this id.
  function collOf(id, state) {
    var s = isObj(state) ? state : {};
    return COLLS.filter(function (c) {
      return Array.isArray(s[c]) && s[c].some(function (x) { return x && x.id === id; });
    });
  }

  var colls = {};
  COLLS.forEach(function (c) { colls[c] = { shape: "array", id: "id", stamp: "m" }; });
  var DESC = {
    app: "health", title: "Health", slice: "health", ext: ".oroshealth", mime: "application/x-oros-health",
    colls: colls,
    norm: norm, strip: strip, tombIds: tombIds, previews: previews,
    merge: function (local, remote) { return core().merge(local, remote); }
  };

  var api = { DESC: DESC, COLLS: COLLS, LIM: LIM, KEY_RE: KEY_RE, atsOf: atsOf, collOf: collOf };
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.OrosHealthPackage = api;
})(this);
