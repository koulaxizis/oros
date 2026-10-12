// ============================================================
// orOS Newsletter — universal search provider (v1.0.0)
// Loaded by the shell on the first menu search (apps.json
// "search"). Read-only: reads oros-newsletter-data, never writes.
// Hits: one per issue (subject; preview line and first text as
// text; shown on its send/start date) and one per list (name).
// Subscribers are never searchable: their addresses stay inside
// the app (privacy). Tombstones ({ id, m, del: 1 }) are skipped.
// Opens through the generic deep link: target { issue } |
// { list } (receiver in newsletter.js).
// ============================================================
(function (root) {
  "use strict";
  var KEY = "oros-newsletter-data";
  var L10N = {
    en: { untitled: "Untitled issue", draft: "draft", sending: "sending", paused: "paused", sent: "sent", list: "List" },
    el: { untitled: "Τεύχος χωρίς θέμα", draft: "πρόχειρο", sending: "αποστέλλεται", paused: "σε παύση", sent: "στάλθηκε", list: "Λίστα" }
  };

  function str(v) { return typeof v === "string" ? v.trim() : ""; }
  function live(a) {
    return (Array.isArray(a) ? a : []).filter(function (x) {
      return x && typeof x === "object" && typeof x.id === "string" && !x.del;
    });
  }
  function bodyText(x) {
    if (x.fmt === "md") return str(x.md).replace(/[#*\[\]()!>_`-]+/g, " ");
    return (Array.isArray(x.blocks) ? x.blocks : []).map(function (b) {
      if (!b || typeof b !== "object") return "";
      if (b.k === "cols") return [str(b.a), str(b.b)].join(" ");
      return str(b.t) || str(b.alt) || "";
    }).join(" ");
  }

  var PROVIDER = {
    id: "newsletter",
    keys: [KEY],
    search: function (ctx) {
      var d = ctx.readJSON(KEY), out = [];
      if (!d || typeof d !== "object") return out;
      var L = L10N[ctx.lang === "el" ? "el" : "en"];
      var lists = {};
      live(d.lists).forEach(function (l) { lists[l.id] = l; });
      live(d.issues).forEach(function (x) {
        var l = lists[x.list];
        if (!l) return;
        var st = L[x.st] ? x.st : "draft";
        out.push({
          id: "i:" + x.id,
          title: (str(x.subj) || L.untitled) + " · " + (str(l.name) || L.list),
          text: [L[st], str(x.pre), bodyText(x).replace(/\s+/g, " ").trim().slice(0, 400)].filter(Boolean).join(" · "),
          when: (typeof x.done === "number" && x.done) || (typeof x.start === "number" && x.start) || (typeof x.m === "number" ? x.m : 0),
          target: { issue: x.id }
        });
      });
      Object.keys(lists).forEach(function (id) {
        var l = lists[id];
        out.push({
          id: "l:" + l.id,
          title: str(l.name) || L.list,
          text: L.list + (str(l.why) ? " · " + str(l.why).slice(0, 200) : ""),
          when: typeof l.m === "number" ? l.m : 0,
          target: { list: l.id }
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
