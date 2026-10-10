// ============================================================
// orOS Pet Health Book — universal search provider (v1.0.0)
// Loaded by the shell on the first menu search (apps.json
// "search"). Read-only: reads oros-petcare-data, never writes.
// Hits:
//   - one per pet: its name, and as text the breed, microchip,
//     passport, insurance, allergies, vet, clinic, food and notes.
//   - one per health-book record with words (vaccine, deworming,
//     vet visit, medicine, food change, or any record with notes):
//     its name (else its kind) as title, the pet, diagnosis,
//     treatment, dose, frequency, batch, vet and notes as text;
//     the date shown is the record's day.
// Skipped: pets and records with a tombstone at least as new as
// the row (tombs{id}), records of a deleted pet. Photos are not
// read. A pet that passed away stays (the book stays in the app).
// Opening: a pet through the existing Pet Health Book bridge
// (__orosOpenPetcare); a record through the generic deep link,
// target { pet, rec } (petcare.js openSearchTarget opens the pet's
// health book and the record's editor).
// ============================================================
(function (root) {
  "use strict";
  var KEY = "oros-petcare-data";
  var ID_RE = /^[a-z0-9]{6,40}$/;
  var YMD = /^(\d{4})-(\d{2})-(\d{2})$/;
  var KIND = {
    vacc:   { en: "Vaccine",      el: "Εμβόλιο" },
    deworm: { en: "Deworming",    el: "Αποπαρασίτωση" },
    visit:  { en: "Vet visit",    el: "Επίσκεψη στον κτηνίατρο" },
    med:    { en: "Medicine",     el: "Φάρμακο" },
    weight: { en: "Weight",       el: "Βάρος" },
    care:   { en: "Routine care", el: "Φροντίδα ρουτίνας" },
    food:   { en: "Food change",  el: "Αλλαγή τροφής" }
  };

  function str(v) { return typeof v === "string" ? v.trim() : ""; }
  function arr(a) { return Array.isArray(a) ? a : []; }
  function dayMs(s) {
    var m = typeof s === "string" && YMD.exec(s);
    return m ? new Date(+m[1], +m[2] - 1, +m[3], 12).getTime() : 0;
  }

  var PROVIDER = {
    id: "petcare",
    keys: [KEY],
    search: function (ctx) {
      var d = ctx.readJSON(KEY), out = [];
      if (!d || !Array.isArray(d.pets)) return out;
      var lang = ctx.lang === "el" ? "el" : "en";
      var tombs = d.tombs && typeof d.tombs === "object" ? d.tombs : {};
      function live(x) {
        if (!x || typeof x !== "object" || typeof x.id !== "string" || !x.id) return false;
        var ts = tombs[x.id];
        return typeof ts !== "number" || ts < (x.m || 0);
      }
      var pets = {};
      d.pets.forEach(function (p) {
        if (!live(p) || !str(p.name)) return;
        pets[p.id] = str(p.name);
        var vet = p.vet && typeof p.vet === "object" ? p.vet : {};
        var food = p.food && typeof p.food === "object" ? p.food : {};
        out.push({
          id: "pet:" + p.id,
          title: pets[p.id],
          text: [p.breed, p.chip, p.pass, p.ins, p.alg, vet.n, vet.c, food.n, p.notes]
            .map(str).filter(Boolean).join(" · "),
          target: p.id
        });
      });
      arr(d.recs).forEach(function (r) {
        if (!live(r) || !(r.p in pets) || !KIND[r.k]) return;
        var words = [r.dg, r.tr, r.ds, r.fq, r.b, r.v, r.nt].map(str).filter(Boolean);
        var name = str(r.n);
        if (!name && !words.length) return;
        out.push({
          id: "rec:" + r.id,
          title: name || KIND[r.k][lang],
          text: [pets[r.p]].concat(words).join(" · "),
          when: dayMs(r.d),
          target: { pet: r.p, rec: r.id }
        });
      });
      return out;
    },
    open: function (t, win) {
      if (typeof t === "string" && ID_RE.test(t) && win && typeof win.__orosOpenPetcare === "function") {
        win.__orosOpenPetcare(t);
      } else if (win && typeof win.__orosOpenAt === "function") {
        win.__orosOpenAt("petcare", t && typeof t.rec === "string" ? { pet: t.pet, rec: t.rec } : null);
      }
    }
  };

  if (typeof module !== "undefined" && module.exports) module.exports = PROVIDER;
  if (root && root.document) {
    var list = root.orosSearchProviders = root.orosSearchProviders || [];
    for (var i = 0; i < list.length; i++) if (list[i] && list[i].id === PROVIDER.id) return;
    list.push(PROVIDER);
  }
})(typeof window !== "undefined" ? window : globalThis);
