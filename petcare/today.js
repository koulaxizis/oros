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
  // Pack "petcare": the shell runs this file, so a pack language reads
  // the "petcare" pack when the shell has it, else English.
  var W = {
    en: { "today.due": "{name}: {what}", "today.med": "{name}: last day of {what}", "today.bday": "🎂 {name} turns {n}",
          "today.deworm": "deworming", "today.recheck": "recheck", "today.food": "food runs out",
          "today.care.bath": "bath", "today.care.nails": "nail trim", "today.care.brush": "brushing", "today.care.teeth": "teeth",
          "today.care.ears": "ear cleaning", "today.care.litter": "litter change", "today.care.cage": "cage cleaning",
          "today.care.tank": "tank water change" },
    el: { "today.due": "{name}: {what}", "today.med": "{name}: τελευταία μέρα για {what}", "today.bday": "🎂 {name}: γενέθλια ({n})",
          "today.deworm": "αποπαρασίτωση", "today.recheck": "επανεξέταση", "today.food": "νέο σακί τροφής",
          "today.care.bath": "μπάνιο", "today.care.nails": "κόψιμο νυχιών", "today.care.brush": "βούρτσισμα", "today.care.teeth": "δόντια",
          "today.care.ears": "καθάρισμα αυτιών", "today.care.litter": "αλλαγή άμμου", "today.care.cage": "καθάρισμα κλουβιού",
          "today.care.tank": "αλλαγή νερού ενυδρείου" }
  };
  function words(lang) {
    var I = root && root.orosI18n;
    if (I && I.known(lang) && !W[lang]) I.table(W, "petcare", lang);
    var tb = W[lang] || W.en, w = { care: {} };
    Object.keys(W.en).forEach(function (k) {
      var v = tb[k] !== undefined ? tb[k] : W.en[k];
      if (k.indexOf("today.care.") === 0) w.care[k.slice(11)] = v;
      else w[k.slice(6)] = v;
    });
    return w;
  }
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
    keys: [KEY, "oros-petcare-hh"],
    collect: function (ctx) {
      var C = root.OrosPetcareCore, raw = ctx.readJSON(KEY), PH = root.OrosPetcareHouse;
      if (PH) {                                   // shared books (BR-HH wave 7c): a shared pet once
        var sets = PH.readMirror(ctx.readJSON(PH.MIRROR_KEY));
        if (sets.length) raw = PH.union(raw && Array.isArray(raw.pets) ? raw : null, sets);
      }
      if (!C || !raw || !Array.isArray(raw.pets) || !raw.pets.length) return [];
      var w = words(ctx.lang);
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
