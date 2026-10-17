// ============================================================
// orOS Health — universal search provider (v1.0.0)
// Loaded by the shell on the first menu search (apps.json
// "search"). Read-only: reads oros-health-data, never writes.
// Sensitive data: the app ships with "searchOff": true (opt-in).
// Hits:
//   - one per reading that carries a note or tags: the kind as
//     title, the note and the tags as text; the date shown is when
//     it was measured. Readings without words are numbers only and
//     are not searched.
//   - one per own kind (custom type): its name, its unit as text.
//   - one per medicine (wave 2): name + strength as title, the note
//     as text; target { med } (opens its editor).
//   - one per symptom that carries a note or tags: the symptom as
//     title (own kinds by name), note and tags as text; target
//     { sym }. Symptoms of a hidden or deleted kind are skipped.
//   - wave 3: one per appointment, vaccination, document, allergy
//     and condition; targets { appt } / { vax } / { doc } / { al } /
//     { cn } open its editor on the Record tab.
// Skipped: rows with a tombstone at least as new as the row
// (tombs{"en:<id>"} / tombs{"ty:<id>"}), readings of a hidden or
// unknown kind, hidden own kinds.
// Opening: a reading through the generic deep link, target
// { entry: id } (health.js openSearchTarget opens its edit
// dialog); an own kind through the existing Health bridge
// (__orosOpenHealth → a new reading of that kind).
// ============================================================
(function (root) {
  "use strict";
  var KEY = "oros-health-data";
  var ID_RE = /^[a-z0-9-]{1,40}$/;
  var BUILTIN = { bp: 1, wt: 1, gl: 1, sl: 1, hr: 1, tp: 1, o2: 1, st: 1 };
  var SYMS = { ha: 1, na: 1, dz: 1, ft: 1, pn: 1, cg: 1, br: 1, pl: 1 };
  // Same keys as health.js. A pack language: English + the health
  // pack, when one is loaded (else English).
  var TXT = {
    en: { "t.bp": "Blood pressure", "t.wt": "Weight", "t.gl": "Blood sugar", "t.sl": "Sleep",
          "t.hr": "Resting heart rate", "t.tp": "Temperature", "t.o2": "Oxygen (SpO₂)", "t.st": "Steps",
          "sy.ha": "Headache", "sy.na": "Nausea", "sy.dz": "Dizziness", "sy.ft": "Tiredness",
          "sy.pn": "Pain", "sy.cg": "Cough", "sy.br": "Shortness of breath", "sy.pl": "Palpitations",
          "td.reading": "Reading" },
    el: { "t.bp": "Πίεση", "t.wt": "Βάρος", "t.gl": "Σάκχαρο", "t.sl": "Ύπνος",
          "t.hr": "Σφυγμοί ηρεμίας", "t.tp": "Θερμοκρασία", "t.o2": "Οξυγόνο (SpO₂)", "t.st": "Βήματα",
          "sy.ha": "Πονοκέφαλος", "sy.na": "Ναυτία", "sy.dz": "Ζάλη", "sy.ft": "Κούραση",
          "sy.pn": "Πόνος", "sy.cg": "Βήχας", "sy.br": "Δύσπνοια", "sy.pl": "Αίσθημα παλμών",
          "td.reading": "Μέτρηση" }
  };
  function words(lang) {
    var I = typeof window !== "undefined" && window.orosI18n;
    if (I && lang && !TXT[lang]) I.table(TXT, "health", lang);
    return TXT[lang] || TXT.en;
  }

  function str(v) { return typeof v === "string" ? v.trim() : ""; }

  var PROVIDER = {
    id: "health",
    keys: [KEY],
    search: function (ctx) {
      var d = ctx.readJSON(KEY), out = [];
      if (!d || !Array.isArray(d.en)) return out;
      var W = words(typeof ctx.lang === "string" && ctx.lang ? ctx.lang : "en");
      var tombs = d.tombs && typeof d.tombs === "object" ? d.tombs : {};
      function gone(c, x) {
        var ts = tombs[c + ":" + x.id];
        return typeof ts === "number" && ts >= (x.m || 0);
      }
      var types = {};
      (Array.isArray(d.ty) ? d.ty : []).forEach(function (ty) {
        if (ty && typeof ty.id === "string" && !gone("ty", ty)) types[ty.id] = ty;
      });
      function kindName(tid) {
        if (BUILTIN[tid] === 1) return W["t." + tid];
        return types[tid] ? str(types[tid].n) : "";
      }
      d.en.forEach(function (e) {
        if (!e || typeof e.id !== "string" || typeof e.t !== "string" || gone("en", e)) return;
        if (!BUILTIN[e.t] && !types[e.t]) return;          // own kind deleted
        if (types[e.t] && types[e.t].h) return;            // hidden kind
        var tags = (Array.isArray(e.g) ? e.g : []).map(str).filter(Boolean);
        var note = str(e.n);
        if (!note && !tags.length) return;
        out.push({
          id: e.id,
          title: kindName(e.t) || W["td.reading"],
          text: [note, tags.join(", ")].filter(Boolean).join(" · "),
          when: typeof e.at === "number" ? e.at : 0,
          target: { entry: e.id }
        });
      });
      Object.keys(types).forEach(function (id) {
        var ty = types[id];
        if (BUILTIN[id] || ty.h || !str(ty.n)) return;
        out.push({ id: "ty:" + id, title: str(ty.n), text: str(ty.u), target: { kind: id } });
      });
      (Array.isArray(d.md) ? d.md : []).forEach(function (m) {
        if (!m || typeof m.id !== "string" || !ID_RE.test(m.id) || gone("md", m) || !str(m.n)) return;
        out.push({ id: "md:" + m.id, title: str(m.n) + (str(m.s) ? " " + str(m.s) : ""), text: str(m.nt), target: { med: m.id } });
      });
      var sk = {};
      (Array.isArray(d.sk) ? d.sk : []).forEach(function (k) {
        if (k && typeof k.id === "string" && !gone("sk", k)) sk[k.id] = k;
      });
      (Array.isArray(d.sy) ? d.sy : []).forEach(function (e) {
        if (!e || typeof e.id !== "string" || typeof e.k !== "string" || gone("sy", e)) return;
        var k = sk[e.k], name = SYMS[e.k] === 1 ? W["sy." + e.k] : (k ? str(k.n) : "");
        if (!name || (k && k.h)) return;
        var tags = (Array.isArray(e.g) ? e.g : []).map(str).filter(Boolean), note = str(e.n);
        if (!note && !tags.length) return;
        out.push({ id: "sy:" + e.id, title: name, text: [note, tags.join(", ")].filter(Boolean).join(" · "),
                   when: typeof e.at === "number" ? e.at : 0, target: { sym: e.id } });
      });
      // Wave 3: the record. Appointments (doctor · specialty, place
      // and note as text, when = its time), vaccinations, documents,
      // allergies and conditions; each opens its editor in Health.
      function rows(c, fn) {
        (Array.isArray(d[c]) ? d[c] : []).forEach(function (x) {
          if (!x || typeof x.id !== "string" || !ID_RE.test(x.id) || gone(c, x)) return;
          var h = fn(x);
          if (h && h.title) out.push(h);
        });
      }
      rows("ap", function (a) {
        var dr = str(a.dr), sp = str(a.sp);
        return { id: "ap:" + a.id, title: dr && sp ? dr + " · " + sp : (dr || sp), text: [str(a.pl), str(a.nt)].filter(Boolean).join(" · "),
                 when: typeof a.at === "number" ? a.at : 0, target: { appt: a.id } };
      });
      rows("vx", function (v) { return { id: "vx:" + v.id, title: str(v.n), text: [str(v.lt), str(v.nt)].filter(Boolean).join(" · "), target: { vax: v.id } }; });
      rows("dc", function (x) { return { id: "dc:" + x.id, title: str(x.n), text: str(x.nt), target: { doc: x.id } }; });
      rows("al", function (x) { return { id: "al:" + x.id, title: str(x.n), text: [str(x.r), str(x.nt)].filter(Boolean).join(" · "), target: { al: x.id } }; });
      rows("cn", function (x) { return { id: "cn:" + x.id, title: str(x.n), text: str(x.nt), target: { cn: x.id } }; });
      return out;
    },
    open: function (t, win) {
      if (t && typeof t.kind === "string" && ID_RE.test(t.kind) &&
          win && typeof win.__orosOpenHealth === "function") {
        win.__orosOpenHealth(t.kind);
      } else if (win && typeof win.__orosOpenAt === "function") {
        var rec = null;
        ["appt", "vax", "doc", "al", "cn"].forEach(function (k) {
          if (!rec && t && typeof t[k] === "string" && ID_RE.test(t[k])) { rec = {}; rec[k] = t[k]; }
        });
        win.__orosOpenAt("health", rec ? rec : t && typeof t.entry === "string" ? { entry: t.entry }
          : t && typeof t.med === "string" ? { med: t.med } : t && typeof t.sym === "string" ? { sym: t.sym } : null);
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
