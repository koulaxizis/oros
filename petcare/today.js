// ============================================================
// orOS Pet Health Book — Today provider (v1.0.0)
// Loaded by the shell (today/host.js) through apps.json "today".
// Read-only: reads oros-petcare-data, never writes. What is due is
// petcare/core.js (items, birthdayOn), the same the app, the Calendar
// feed and the shell reminder use. Rows: vaccines, deworming,
// rechecks, the last day of a medicine course, routine care and food
// that are late, due today or in the next days; pets' birthdays.
// (Per-dose reminders keep their own notices.) Pets that are gone
// are left out. Opens through the shell bridge __orosOpenPetcare(petId).
// ============================================================
(function (root) {
  "use strict";
  var KEY = "oros-petcare-data";
  var W = {
    en: { due: "{name}: {what}", med: "{name}: last day of {what}", bday: "🎂 {name} turns {n}",
          deworm: "deworming", recheck: "recheck", food: "food runs out",
          care: { bath: "bath", nails: "nail trim", brush: "brushing", teeth: "teeth", ears: "ear cleaning",
                  litter: "litter change", cage: "cage cleaning", tank: "tank water change" } },
    el: { due: "{name}: {what}", med: "{name}: τελευταία μέρα για {what}", bday: "🎂 {name}: γενέθλια ({n})",
          deworm: "αποπαρασίτωση", recheck: "επανεξέταση", food: "νέο σακί τροφής",
          care: { bath: "μπάνιο", nails: "κόψιμο νυχιών", brush: "βούρτσισμα", teeth: "δόντια", ears: "καθάρισμα αυτιών",
                  litter: "αλλαγή άμμου", cage: "καθάρισμα κλουβιού", tank: "αλλαγή νερού ενυδρείου" } }
  };
  function fill(s, v) { return s.replace("{name}", v.name).replace("{what}", v.what || "").replace("{n}", v.n || ""); }
  function what(w, it) {
    if (it.kind === "vacc") return it.label;
    if (it.kind === "deworm") return w.deworm + (it.label ? " (" + it.label + ")" : "");
    if (it.kind === "visit") return w.recheck + (it.label ? " (" + it.label + ")" : "");
    if (it.kind === "care") return w.care[it.sub] || it.sub;
    return w.food;
  }

  var PROVIDER = {
    id: "petcare",
    keys: [KEY],
    collect: function (ctx) {
      var C = root.OrosPetcareCore, raw = ctx.readJSON(KEY);
      if (!C || !raw || !Array.isArray(raw.pets) || !raw.pets.length) return [];
      var w = W[ctx.lang] || W.en;
      var data = C.merge(raw, raw, ctx.now), out = [];
      C.items(data, ctx.today).forEach(function (it) {
        if (it.diff > ctx.horizon) return;
        out.push({
          id: it.key,
          due: it.due,
          title: it.kind === "med" ? fill(w.med, { name: it.pet.name, what: it.label })
                                   : fill(w.due, { name: it.pet.name, what: what(w, it) }),
          kind: "task",
          target: { pet: it.pet.id }
        });
      });
      for (var d = 0; d <= ctx.horizon; d++) {
        var day = ctx.addDays(ctx.today, d);
        data.pets.forEach(function (p) {
          var n = p.gone ? 0 : C.birthdayOn(p, day);
          if (n) out.push({ id: "bd:" + p.id + ":" + day, due: day, title: fill(w.bday, { name: p.name, n: n }),
                            kind: "event", target: { pet: p.id } });
        });
      }
      return out;
    },
    open: function (target, win) {
      var id = target && typeof target.pet === "string" ? target.pet : "today";
      if (typeof win.__orosOpenPetcare === "function") win.__orosOpenPetcare(id);
    }
  };

  if (typeof module !== "undefined" && module.exports) module.exports = PROVIDER;
  if (root && root.document) {
    var list = root.orosTodayProviders = root.orosTodayProviders || [];
    for (var i = 0; i < list.length; i++) if (list[i] && list[i].id === PROVIDER.id) return;
    list.push(PROVIDER);
  }
})(typeof window !== "undefined" ? window : globalThis);
