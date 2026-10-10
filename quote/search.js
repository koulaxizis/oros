// ============================================================
// orOS Quote — universal search provider (v1.0.0)
// Loaded by the shell on the first menu search (apps.json
// "search"). Read-only: reads oros-quote-data, never writes.
// One hit per saved quote: number + client as the title; client
// details, line items (code, description), payment terms and notes
// as text. The date shown is the quote's date. Templates, clients
// on their own and the unsaved draft (oros-quote-draft) are not
// searched. Deleted quotes are not in quotes[]; a row older than
// its tombstone (deleted{}) is skipped as well.
// Opens through the existing Quote bridge (__orosOpenQuote).
// ============================================================
(function (root) {
  "use strict";
  var KEY = "oros-quote-data";
  var YMD = /^(\d{4})-(\d{2})-(\d{2})$/;

  function str(v) { return typeof v === "string" ? v.trim() : ""; }
  function arr(a) { return Array.isArray(a) ? a : []; }
  function dayMs(s) {
    var m = typeof s === "string" && YMD.exec(s);
    return m ? new Date(+m[1], +m[2] - 1, +m[3], 12).getTime() : 0;
  }
  function alive(x, tomb) {
    var ts = tomb[x.id];
    return typeof ts !== "number" || (Number(x.mtime) || 0) > ts;
  }

  var PROVIDER = {
    id: "quote",
    keys: [KEY],
    search: function (ctx) {
      var d = ctx.readJSON(KEY), out = [];
      if (!d || !Array.isArray(d.quotes)) return out;
      var tomb = d.deleted && typeof d.deleted === "object" ? d.deleted : {};
      var clients = {};
      arr(d.clients).forEach(function (c) {
        if (c && typeof c.id === "string" && alive(c, tomb)) clients[c.id] = c;
      });
      d.quotes.forEach(function (q) {
        if (!q || typeof q.id !== "string" || !alive(q, tomb)) return;
        var c = typeof q.clientId === "string" ? clients[q.clientId] : null;
        var cname = c ? str(c.name) : "";
        var num = str(q.num);
        var title = [num, cname].filter(Boolean).join(" · ") ||
                    (ctx.lang === "el" ? "Προσφορά χωρίς αριθμό" : "Untitled quote");
        var items = arr(q.items).map(function (it) {
          return it ? [str(it.code), str(it.desc)].filter(Boolean).join(" ") : "";
        });
        var who = c ? [str(c.email), str(c.phone), str(c.address), str(c.taxId)] : [];
        out.push({
          id: q.id,
          title: title,
          text: who.concat(items, [str(q.payment), str(q.notes)]).filter(Boolean).join(" · "),
          when: dayMs(q.date),
          target: q.id
        });
      });
      return out;
    },
    open: function (target, win) {
      if (typeof target === "string" && target && win && typeof win.__orosOpenQuote === "function") {
        win.__orosOpenQuote(target);
      } else if (win && typeof win.__orosOpenAt === "function") {
        win.__orosOpenAt("quote", null);
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
