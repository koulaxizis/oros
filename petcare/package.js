// ============================================================
// orOS Pet Health Book — .orospet file (petcare/package.js,
// window.OrosPetcarePackage). The descriptor of Pet Health Book for
// the record apps' kit (../recordpkg.js, docs/oros-bundle.md "Record
// apps"): every pet and every health record in one orOS bundle, the
// records' attachments (photos of prescriptions, test results: Files ›
// Pet Health Book) in media/<sha256>.<jpg|pdf>. Opening one ADDS what
// this device lacks, with its ids. Pure (no DOM, no storage), so the
// app and `node --test` run the same code. Needs core.js
// (OrosPetcareCore).
//   DESC                     the kit descriptor; merge = core.merge
//                            (the slice's own symmetric merge: pets
//                            per field group, records LWW, this
//                            device's tombstones stay as they are)
//   DESC.norm(data)          a file's data → { ver, pets, recs, ats? }:
//                            every row through core's normPet / normRec
//                            (invalid rows dropped); a record keeps
//                            only attachment names that carry its own
//                            id, and only when its pet is in the file
//   DESC.strip(state)        the slice → { ver, pets, recs, ats? }: no
//                            tombstones
//   DESC.tombIds(state)      the ids in state.tombs
//   DESC.previews(state, l)  pets.md (readable health book) and
//                            records.csv (formula guard)
//   ats                      attachments: { "<file name>": "<sha256>.<ext>" },
//                            the media key of each file a record's `sc`
//                            names; set by the app's files hook on save
//   forLocal(getLocal)       DESC whose norm also drops the records of
//                            a pet deleted on this device (the app's
//                            ui() uses it; the kit keeps that pet
//                            deleted, so its records must not be
//                            counted as added: core.merge would drop
//                            them anyway)
//   normAts(ats, recs), kindOf(id, state) "pet" | "rec" | ""
// Never in the file: tombstones and the device-only prefs (reminder
// hour, days of warning, dose reminders, fired maps, open tab: other
// localStorage keys, not in the slice). The pet's photo is a small
// JPEG data URI inside the pet record itself (core PHOTO_RE, ≤ 28 000
// chars), so it travels in content.json like the rest of the record.
// ============================================================
(function (root) {
  "use strict";

  var NODE = typeof module === "object" && module.exports;
  function core() { return NODE ? require("./core.js") : root.OrosPetcareCore; }

  var KEY_RE = /^[0-9a-f]{64}\.(jpg|pdf)$/;

  function isObj(v) { return !!v && typeof v === "object" && !Array.isArray(v); }
  function clone(x) { return x === undefined ? undefined : JSON.parse(JSON.stringify(x)); }
  function cmpStr(x, y) { return x < y ? -1 : (x > y ? 1 : 0); }

  // A record's attachment names that carry its own id ("<ymd>-<id>-<rnd>.<ext>").
  function ownAt(r) {
    if (!r.sc) return r;
    var sc = r.sc.filter(function (n) { return n.indexOf("-" + r.id + "-") === 8; });
    if (sc.length) r.sc = sc; else delete r.sc;
    return r;
  }
  // attachments map: names some record names → a hash key of the same type
  function normAts(ats, recs) {
    var out = {}, used = {};
    if (!isObj(ats)) return out;
    (recs || []).forEach(function (r) { if (r && Array.isArray(r.sc)) r.sc.forEach(function (n) { used[n] = 1; }); });
    Object.keys(ats).sort(cmpStr).forEach(function (n) {
      var k = ats[n];
      if (!used[n] || !core().AT_RE.test(n) || typeof k !== "string" || !KEY_RE.test(k)) return;
      if (n.split(".").pop() !== k.split(".").pop()) return;
      out[n] = k;
    });
    return out;
  }

  function norm(data) {
    if (!isObj(data)) return null;
    var C = core(), out = { ver: C.DATA_VER, pets: [], recs: [] }, pets = {}, recs = {};
    (Array.isArray(data.pets) ? data.pets : []).slice(0, C.MAX_PETS * 4).forEach(function (raw) {
      if (out.pets.length >= C.MAX_PETS) return;
      var p = C.normPet(raw);
      if (!p || pets[p.id]) return;
      pets[p.id] = 1;
      out.pets.push(p);
    });
    (Array.isArray(data.recs) ? data.recs : []).slice(0, C.MAX_RECS * 2).forEach(function (raw) {
      if (out.recs.length >= C.MAX_RECS) return;
      var r = C.normRec(raw);
      if (!r || recs[r.id] || pets[r.id] || !pets[r.p]) return;
      recs[r.id] = 1;
      out.recs.push(ownAt(r));
    });
    var ats = normAts(data.ats, out.recs);
    if (Object.keys(ats).length) out.ats = ats;
    if (isObj(data.tombs)) {                    // strip drops them: a file's tombstones are ignored
      out.tombs = {};
      Object.keys(data.tombs).forEach(function (id) { if (C.ID_RE.test(id)) out.tombs[id] = 1; });
    }
    return out;
  }
  function strip(state) {
    var s = isObj(state) ? state : {};
    var out = { ver: core().DATA_VER, pets: Array.isArray(s.pets) ? s.pets : [], recs: Array.isArray(s.recs) ? s.recs : [] };
    var ats = normAts(s.ats, out.recs);
    if (Object.keys(ats).length) out.ats = ats;
    return clone(out);
  }
  function tombIds(state) {
    return isObj(state) && isObj(state.tombs) ? Object.keys(state.tombs) : [];
  }

  // ---------- previews: pets.md and records.csv ----------
  var WORDS = {
    en: {
      title: "Pet Health Book", profile: "Profile", records: "Health book", none: "No entries.",
      species: "Species", breed: "Breed", sex: "Sex", birth: "Born", color: "Colour", chip: "Microchip",
      pass: "Passport", ins: "Insurance", alg: "Allergies", vet: "Vet", eph: "Emergency phone", food: "Food",
      gone: "No longer with me since", notes: "Notes", next: "next", until: "until", cost: "cost",
      f: "Female", m: "Male", neut: "neutered", files: "attachments",
      head: ["Pet", "Date", "Kind", "Name", "Next / until", "Details", "Cost", "Notes"],
      kind: { vacc: "Vaccine", deworm: "Deworming", visit: "Vet visit", med: "Medicine", weight: "Weight",
              care: "Care", food: "Food change" },
      dw: { "int": "internal", ext: "external", both: "internal + external" },
      care: { bath: "Bath", nails: "Nail trim", brush: "Brushing / grooming", teeth: "Teeth", ears: "Ear cleaning",
              litter: "Litter change", cage: "Cage cleaning", tank: "Tank water change" }
    },
    el: {
      title: "Βιβλιάριο κατοικιδίου", profile: "Στοιχεία", records: "Βιβλιάριο υγείας", none: "Καμία καταχώριση.",
      species: "Είδος", breed: "Ράτσα", sex: "Φύλο", birth: "Γέννηση", color: "Χρώμα", chip: "Μικροτσίπ",
      pass: "Διαβατήριο", ins: "Ασφάλεια", alg: "Αλλεργίες", vet: "Κτηνίατρος", eph: "Τηλέφωνο έκτακτης ανάγκης", food: "Τροφή",
      gone: "Δεν είναι πια μαζί μου από", notes: "Σημειώσεις", next: "επόμενη", until: "έως", cost: "κόστος",
      f: "Θηλυκό", m: "Αρσενικό", neut: "στειρωμένο", files: "συνημμένα",
      head: ["Ζώο", "Ημερομηνία", "Είδος", "Όνομα", "Επόμενη / έως", "Λεπτομέρειες", "Κόστος", "Σημειώσεις"],
      kind: { vacc: "Εμβόλιο", deworm: "Αποπαρασίτωση", visit: "Επίσκεψη", med: "Φάρμακο", weight: "Βάρος",
              care: "Φροντίδα", food: "Αλλαγή τροφής" },
      dw: { "int": "εσωτερική", ext: "εξωτερική", both: "εσωτερική + εξωτερική" },
      care: { bath: "Μπάνιο", nails: "Κόψιμο νυχιών", brush: "Βούρτσισμα / καλλωπισμός", teeth: "Δόντια", ears: "Καθαρισμός αυτιών",
              litter: "Αλλαγή άμμου", cage: "Καθαρισμός κλουβιού", tank: "Αλλαγή νερού ενυδρείου" }
    }
  };
  function csvCell(v) {
    var s = v == null ? "" : String(v);
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
    return /[",\r\n]/.test(s) || s.charAt(0) === "'" ? '"' + s.replace(/"/g, '""') + '"' : s;
  }
  // Markdown text: one line, no markup that could become a link or an image
  function mdText(s) { return String(s == null ? "" : s).replace(/[\r\n]+/g, " ").replace(/([\\`*_\[\]<>#!|])/g, "\\$1"); }
  function money(c) { return (c / 100).toFixed(2); }
  function grams(g) { return g >= 1000 ? (g / 1000).toFixed(2) + " kg" : g + " g"; }
  function details(r, W) {
    var d = [];
    if (r.k === "vacc") { if (r.b) d.push(r.b); if (r.v) d.push(r.v); }
    else if (r.k === "deworm") d.push(W.dw[r.t] || "");
    else if (r.k === "visit") { if (r.dg) d.push(r.dg); if (r.tr) d.push(r.tr); if (r.v) d.push(r.v); }
    else if (r.k === "med") { if (r.ds) d.push(r.ds); if (r.fq) d.push(r.fq); if (r.tm) d.push(r.tm.join(" ")); }
    else if (r.k === "weight") d.push(grams(r.g));
    if (r.sc && r.sc.length) d.push(r.sc.length + " " + W.files);
    return d.filter(Boolean).join("; ");
  }
  function recName(r, W) {
    if (r.k === "care") return W.care[r.c] || r.c;
    return r.n || "";
  }
  function previews(state, lang) {
    var C = core(), el = lang === "el", W = WORDS[el ? "el" : "en"];
    var s = isObj(state) ? state : {}, pets = Array.isArray(s.pets) ? s.pets : [], recs = Array.isArray(s.recs) ? s.recs : [];
    if (!pets.length) return {};
    var byPet = {};
    recs.forEach(function (r) { (byPet[r.p] || (byPet[r.p] = [])).push(r); });
    Object.keys(byPet).forEach(function (id) {
      byPet[id].sort(function (x, y) { return cmpStr(y.d, x.d) || cmpStr(x.id, y.id); });
    });
    var md = ["# " + W.title, ""], csv = [W.head.map(csvCell).join(",")];
    pets.slice().sort(function (x, y) { return cmpStr(x.name.toLowerCase(), y.name.toLowerCase()) || cmpStr(x.id, y.id); })
      .forEach(function (p) {
        var sp = C.SPECIES[p.sp] || C.SPECIES.other;
        md.push("## " + mdText(p.name), "", "### " + W.profile, "");
        function fact(label, v) { if (v) md.push("- " + label + ": " + mdText(v)); }
        fact(W.species, sp[el ? "el" : "en"]);
        fact(W.breed, p.breed);
        fact(W.sex, p.sex ? W[p.sex] + (p.neut ? ", " + W.neut : "") : (p.neut ? W.neut : ""));
        fact(W.birth, p.birth);
        fact(W.color, p.color);
        fact(W.chip, p.chip);
        fact(W.pass, p.pass);
        fact(W.ins, p.ins);
        fact(W.alg, p.alg);
        fact(W.vet, [p.vet.n, p.vet.c, p.vet.ph].filter(Boolean).join(", "));
        fact(W.eph, p.eph);
        fact(W.food, p.food.n);
        fact(W.gone, p.gone);
        fact(W.notes, p.notes);
        md.push("", "### " + W.records, "");
        var list = byPet[p.id] || [];
        if (!list.length) md.push(W.none);
        list.forEach(function (r) {
          var name = recName(r, W), extra = [], det = details(r, W);
          if (det) extra.push(det);
          if (r.nx) extra.push(W.next + " " + r.nx);
          if (r.u) extra.push(W.until + " " + r.u);
          if (r.k === "visit" && r.c) extra.push(W.cost + " " + money(r.c));
          md.push("- " + r.d + " · " + W.kind[r.k] + (name ? ": " + mdText(name) : "") +
                  (extra.length ? " (" + mdText(extra.join(", ")) + ")" : "") + (r.nt ? " · " + mdText(r.nt) : ""));
          csv.push([p.name, r.d, W.kind[r.k], name, r.nx || r.u || "", det,
                    r.k === "visit" && r.c ? money(r.c) : "", r.nt || ""].map(csvCell).join(","));
        });
        md.push("");
      });
    return { "pets.md": md.join("\n"), "records.csv": "﻿" + csv.join("\r\n") + "\r\n" };
  }

  // What an id names in a state (Undo removes each the right way).
  function kindOf(id, state) {
    var s = isObj(state) ? state : {};
    if ((s.pets || []).some(function (p) { return p.id === id; })) return "pet";
    if ((s.recs || []).some(function (r) { return r.id === id; })) return "rec";
    return "";
  }

  function forLocal(getLocal) {
    var d = {};
    Object.keys(DESC).forEach(function (k) { d[k] = DESC[k]; });
    d.norm = function (data) {
      var out = norm(data), dead = {};
      if (!out) return out;
      var local = getLocal();
      tombIds(local).forEach(function (id) { dead[id] = 1; });
      ((isObj(local) && local.pets) || []).forEach(function (p) { if (p) delete dead[p.id]; });
      out.recs = out.recs.filter(function (r) { return dead[r.p] !== 1; });
      return out;
    };
    return d;
  }

  var DESC = {
    app: "petcare", title: "Pet Health Book", slice: "petcare", ext: ".orospet", mime: "application/x-oros-pet",
    colls: {
      pets: { shape: "array", id: "id", stamp: "m", clampIn: ["fm"] },
      recs: { shape: "array", id: "id", stamp: "m" }
    },
    norm: norm, strip: strip, tombIds: tombIds, previews: previews,
    merge: function (a, b) { return core().merge(a, b); }
  };

  var api = { DESC: DESC, forLocal: forLocal, KEY_RE: KEY_RE, normAts: normAts, kindOf: kindOf, csvCell: csvCell };
  if (NODE) module.exports = api;
  else root.OrosPetcarePackage = api;
})(typeof window !== "undefined" ? window : this);
