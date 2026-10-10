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
  var BUILTIN = {
    bp: { en: "Blood pressure",     el: "Πίεση" },
    wt: { en: "Weight",             el: "Βάρος" },
    gl: { en: "Blood sugar",        el: "Σάκχαρο" },
    sl: { en: "Sleep",              el: "Ύπνος" },
    hr: { en: "Resting heart rate", el: "Σφυγμοί ηρεμίας" },
    tp: { en: "Temperature",        el: "Θερμοκρασία" },
    o2: { en: "Oxygen (SpO₂)",      el: "Οξυγόνο (SpO₂)" }
  };

  function str(v) { return typeof v === "string" ? v.trim() : ""; }

  var PROVIDER = {
    id: "health",
    keys: [KEY],
    search: function (ctx) {
      var d = ctx.readJSON(KEY), out = [];
      if (!d || !Array.isArray(d.en)) return out;
      var lang = ctx.lang === "el" ? "el" : "en";
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
        if (BUILTIN[tid]) return BUILTIN[tid][lang];
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
          title: kindName(e.t) || (lang === "el" ? "Μέτρηση" : "Reading"),
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
      return out;
    },
    open: function (t, win) {
      if (t && typeof t.kind === "string" && ID_RE.test(t.kind) &&
          win && typeof win.__orosOpenHealth === "function") {
        win.__orosOpenHealth(t.kind);
      } else if (win && typeof win.__orosOpenAt === "function") {
        win.__orosOpenAt("health", t && typeof t.entry === "string" ? { entry: t.entry } : null);
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
