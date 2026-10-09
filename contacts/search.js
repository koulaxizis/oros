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

  var PROVIDER = {
    id: "contacts",
    keys: [KEY],
    search: function (ctx) {
      var d = ctx.readJSON(KEY), out = [];
      if (!d || !Array.isArray(d.contacts)) return out;
      d.contacts.forEach(function (c) {
        if (!c || typeof c.id !== "string") return;
        var name = displayName(c) || (ctx.lang === "el" ? "Χωρίς όνομα" : "Unnamed");
        var parts = [str(c.nickname), str(c.org), str(c.jobTitle)]
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
          target: c.id
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
