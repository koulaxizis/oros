// ============================================================
// orOS Invoices — universal search provider (v1.0.0)
// Loaded by the shell on the first menu search (apps.json
// "search"). Read-only: reads oros-invoices-data, never writes.
// Hits: one per document (its number, or kind + "draft"; client
// name, item descriptions and codes, ΜΑΡΚ as text; shown on its
// date) and one per client (name; job, ΑΦΜ, email as text).
// Tombstones ({ id, m, del: 1 }) are skipped.
// Opens through the generic deep link: target { invoice } |
// { client: { id } } (receiver in invoices.js).
// ============================================================
(function (root) {
  "use strict";
  var KEY = "oros-invoices-data";
  var KINDS = {
    en: { "kind.inv": "Invoice", "kind.rcpt": "Receipt", "kind.pro": "Proforma", "kind.cred": "Credit note", "kind.ext": "Recorded invoice",
          "search.draft": "draft", "search.nameless": "Unnamed client", "search.mark": "ΜΑΡΚ {m}" },
    el: { "kind.inv": "Τιμολόγιο", "kind.rcpt": "Απόδειξη", "kind.pro": "Προτιμολόγιο", "kind.cred": "Πιστωτικό", "kind.ext": "Καταχωρισμένο τιμολόγιο",
          "search.draft": "πρόχειρο", "search.nameless": "Πελάτης χωρίς όνομα", "search.mark": "ΜΑΡΚ {m}" }
  };

  function str(v) { return typeof v === "string" ? v.trim() : ""; }
  function live(a) {
    return (Array.isArray(a) ? a : []).filter(function (x) {
      return x && typeof x === "object" && typeof x.id === "string" && !x.del;
    });
  }
  function dayMs(s) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(str(s));
    return m ? new Date(+m[1], +m[2] - 1, +m[3], 12).getTime() : 0;
  }

  var PROVIDER = {
    id: "invoices",
    keys: [KEY],
    search: function (ctx) {
      var d = ctx.readJSON(KEY), out = [];
      if (!d || typeof d !== "object") return out;
      // orosI18n (the shell's ../i18n.js): a pack language included.
      var I = typeof window !== "undefined" && window.orosI18n;
      if (I && ctx.lang && !KINDS[ctx.lang]) I.table(KINDS, "invoices", ctx.lang);
      var L = KINDS[ctx.lang] || KINDS.en;
      var clients = {};
      live(d.clients).forEach(function (c) { clients[c.id] = c; });
      live(d.docs).forEach(function (x) {
        var kind = L["kind." + x.kind] ? x.kind : "inv";
        var c = x.c && typeof x.c === "object" ? x.c : {};
        var cl = clients[x.cli];
        var who = str(c.name) || (cl ? str(cl.name) : "");
        var num = x.st === "draft" ? "" : str(x.num);
        var items = (Array.isArray(x.lines) ? x.lines : []).map(function (l) {
          return l && typeof l === "object" ? [str(l.code), str(l.d)].filter(Boolean).join(" ") : "";
        }).filter(Boolean);
        out.push({
          id: "d:" + x.id,
          title: (num ? L["kind." + kind] + " " + num : L["kind." + kind] + " (" + L["search.draft"] + ")") + (who ? " · " + who : ""),
          text: [items.join(" · ").slice(0, 400), str(c.afm), str(x.mark) ? L["search.mark"].replace("{m}", str(x.mark)) : ""].filter(Boolean).join(" · "),
          when: dayMs(x.date) || (typeof x.m === "number" ? x.m : 0),
          target: { invoice: x.id }
        });
      });
      Object.keys(clients).forEach(function (id) {
        var c = clients[id];
        out.push({
          id: "c:" + c.id,
          title: str(c.name) || L["search.nameless"],
          text: [str(c.job), str(c.afm), str(c.email)].filter(Boolean).join(" · "),
          when: typeof c.m === "number" ? c.m : 0,
          target: { client: { id: c.id } }
        });
      });
      return out;
    }
  };

  if (typeof module !== "undefined" && module.exports) module.exports = PROVIDER;
  if (root && root.document) {
    var list = root.orosSearchProviders = root.orosSearchProviders || [];
    for (var i = 0; i < list.length; i++) if (list[i] && list[i].id === PROVIDER.id) return;
    list.push(PROVIDER);
  }
})(typeof window !== "undefined" ? window : globalThis);
