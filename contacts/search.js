// ============================================================
// orOS Contacts — universal search provider (v1.0.0)
// Loaded by the shell on the first menu search (apps.json
// "search"). Read-only: reads oros-contacts-data, never writes.
// One hit per contact: the shown name, and as text the nickname,
// company, title, phones, e-mails, addresses, websites and note.
// Deleted contacts are not in contacts[] (the deleted[] list).
// Opens through the existing Contacts bridge (__orosOpenContact).
// ============================================================
(function (root) {
  "use strict";
  var KEY = "oros-contacts-data";

  function str(v) { return typeof v === "string" ? v.trim() : ""; }
  function vals(arr, f) {
    return (Array.isArray(arr) ? arr : []).map(function (x) {
      return x && typeof x === "object" ? f(x) : "";
    }).filter(Boolean);
  }
  function displayName(c) {
    var n = [str(c.given), str(c.middle), str(c.family)].filter(Boolean).join(" ");
    return n || str(c.nickname) || str(c.org);
  }
  var W = { en: { "name.unnamed": "Unnamed", "srch.labels": "Labels: ", "ct.starred": "Favorite" },
            el: { "name.unnamed": "Χωρίς όνομα", "srch.labels": "Ετικέτες: ", "ct.starred": "Αγαπημένη" } };
  function words(lang) {
    var I = typeof window !== "undefined" && window.orosI18n;
    if (I && lang && !W[lang]) I.table(W, "contacts", lang);
    return W[lang] || W.en;
  }
  function unnamed(lang) {
    var I = typeof window !== "undefined" && window.orosI18n;
    if (I && lang && !W[lang]) I.table(W, "contacts", lang);
    return (W[lang] || W.en)["name.unnamed"];
  }

  var PROVIDER = {
    id: "contacts",
    keys: [KEY],
    search: function (ctx) {
      var d = ctx.readJSON(KEY), out = [];
      if (!d || !Array.isArray(d.contacts)) return out;
      var w = words(ctx.code || ctx.lang), lbName = {};
      (Array.isArray(d.labels) ? d.labels : []).forEach(function (l) {
        if (l && typeof l.id === "string" && str(l.name)) lbName[l.id] = str(l.name);
      });
      d.contacts.forEach(function (c) {
        if (!c || typeof c.id !== "string") return;
        var name = displayName(c) || unnamed(ctx.lang);
        var labels = (Array.isArray(c.labelIds) ? c.labelIds : []).map(function (id) { return lbName[id] || ""; }).filter(Boolean);
        var parts = [c.starred ? w["ct.starred"] : "", labels.length ? w["srch.labels"] + labels.join(", ") : "",
                     str(c.nickname), str(c.org), str(c.jobTitle)]
          .concat(vals(c.phones, function (x) { return str(x.v); }))
          .concat(vals(c.emails, function (x) { return str(x.v); }))
          .concat(vals(c.addresses, function (x) {
            return [x.street, x.city, x.zip, x.region, x.country].map(str).filter(Boolean).join(", ");
          }))
          .concat(vals(c.websites, function (x) { return str(x.v); }))
          .concat([str(c.note)]);
        out.push({
          id: c.id,
          title: name,
          text: parts.filter(Boolean).join(" · "),
          target: c.id,
          labels: labels
        });
      });
      return out;
    },
    open: function (target, win) {
      if (typeof target === "string" && win && typeof win.__orosOpenContact === "function") {
        win.__orosOpenContact(target);
      } else if (win && typeof win.__orosOpenAt === "function") {
        win.__orosOpenAt("contacts", null);
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
