// ============================================================
// orOS Contacts — Today provider (v1.0.0)
// Loaded by the shell (today/host.js) through apps.json "today":
// ["dates.js", "today.js"]. Read-only: reads oros-contacts-data, never
// writes. The dates are contacts/dates.js (eventsOn), the same the
// Calendar's birthday feed uses (29 February shows on the 28th in
// years without one). Rows: birthdays, anniversaries and custom dates
// of today and the next days, with the years when the date has one.
// Opens the contact (__orosOpenContact).
// ============================================================
(function (root) {
  "use strict";
  var KEY = "oros-contacts-data";
  var W = {
    en: { birthday: "🎂 {name}", birthdayN: "🎂 {name} turns {n}", anniversary: "{name}: anniversary",
          anniversaryN: "{name}: anniversary ({n} years)", custom: "{name}: {label}" },
    el: { birthday: "🎂 {name}: γενέθλια", birthdayN: "🎂 {name}: γενέθλια ({n})", anniversary: "{name}: επέτειος",
          anniversaryN: "{name}: επέτειος ({n} χρόνια)", custom: "{name}: {label}" }
  };
  function fill(s, v) { return s.replace("{name}", v.name).replace("{n}", v.n).replace("{label}", v.label); }

  var PROVIDER = {
    id: "contacts",
    keys: [KEY],
    collect: function (ctx) {
      var C = root.OrosContactDates, raw = ctx.readJSON(KEY);
      if (!C || !raw || !Array.isArray(raw.contacts)) return [];
      var I = root.orosI18n;
      if (I && ctx.lang && !W[ctx.lang]) I.table(W, "contacts", ctx.lang);
      var w = W[ctx.lang] || W.en, out = [];
      for (var d = 0; d <= ctx.horizon; d++) {
        var day = ctx.addDays(ctx.today, d);
        C.eventsOn(raw.contacts, day, raw.deleted).forEach(function (x) {
          var name = C.displayName(x.contact), type = x.ev.type, n = x.years;
          var title;
          if (type === "custom") title = fill(w.custom, { name: name, n: "", label: typeof x.ev.label === "string" && x.ev.label ? x.ev.label : "—" });
          else if (type === "anniversary") title = fill(n ? w.anniversaryN : w.anniversary, { name: name, n: n || "", label: "" });
          else title = fill(n ? w.birthdayN : w.birthday, { name: name, n: n || "", label: "" });
          out.push({ id: x.contact.id + ":" + x.ix + ":" + day, due: day, kind: "event", title: title,
                     target: { contact: x.contact.id } });
        });
      }
      return out;
    },
    open: function (target, win) {
      if (target && typeof target.contact === "string" && typeof win.__orosOpenContact === "function") win.__orosOpenContact(target.contact);
    }
  };

  if (typeof module !== "undefined" && module.exports) module.exports = PROVIDER;
  if (root && root.document) {
    var list = root.orosTodayProviders = root.orosTodayProviders || [];
    for (var i = 0; i < list.length; i++) if (list[i] && list[i].id === PROVIDER.id) return;
    list.push(PROVIDER);
  }
})(typeof window !== "undefined" ? window : globalThis);
