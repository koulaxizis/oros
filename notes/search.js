// ============================================================
// orOS Notes — universal search provider (v1.0.0)
// Loaded by the shell on the first menu search (apps.json
// "search"). Read-only: reads oros-notes-data, never writes.
// One hit per page (title + plain text). Deleted pages are not in
// pages[] (tombstones live in tombs{}), so nothing else to skip.
// Opens through the generic deep link: target { page, nb }.
// ============================================================
(function (root) {
  "use strict";
  var KEY = "oros-notes-data";

  function firstLine(s) {
    return String(s || "").split("\n").map(function (l) { return l.trim(); })
      .filter(Boolean)[0] || "";
  }

  // The one text of its own (same key and English as notes.js). The
  // shell runs this file, not the Notes page: a pack language shows
  // the "notes" pack line when the shell has it, else English.
  var S = {
    en: { "page.untitled": "Untitled", "srch.labels": "Labels: " },
    el: { "page.untitled": "Χωρίς τίτλο", "srch.labels": "Ετικέτες: " }
  };
  function word(lang, k) {
    var I = root && root.orosI18n;
    var tab = S[lang] || (I && lang ? I.table(S, "notes", lang) : S.en);
    return tab[k] || S.en[k];
  }
  function untitled(lang) {
    var I = root && root.orosI18n;
    var tab = S[lang] || (I && lang ? I.table(S, "notes", lang) : S.en);
    return tab["page.untitled"] || S.en["page.untitled"];
  }

  var PROVIDER = {
    id: "notes",
    keys: [KEY],
    search: function (ctx) {
      var d = ctx.readJSON(KEY), out = [];
      if (!d || !Array.isArray(d.pages)) return out;
      var nbName = {};
      (Array.isArray(d.notebooks) ? d.notebooks : []).forEach(function (nb) {
        if (nb && typeof nb.id === "string") nbName[nb.id] = String(nb.name || "");
      });
      var lbName = {};
      (Array.isArray(d.labels) ? d.labels : []).forEach(function (l) {
        if (l && typeof l.id === "string" && typeof l.name === "string" && l.name.trim()) lbName[l.id] = l.name.trim();
      });
      d.pages.forEach(function (p) {
        if (!p || typeof p.id !== "string") return;
        var labels = (Array.isArray(p.labels) ? p.labels : []).map(function (id) { return lbName[id] || ""; }).filter(Boolean);
        // The notebook and labels first: the Assistant gets the text's
        // beginning only (the menu shows the part that matched).
        var text = [nbName[p.nb] ? "📓 " + nbName[p.nb].trim() : "", labels.length ? word(ctx.code || ctx.lang, "srch.labels") + labels.join(", ") : "",
                    typeof p.text === "string" ? p.text : ""].filter(Boolean).join(" · ");
        var title = String(p.title || "").trim() || firstLine(text).slice(0, 60) ||
                    untitled(ctx.lang);
        out.push({
          id: p.id,
          title: title,
          text: text,
          when: typeof p.mtime === "number" ? p.mtime : 0,
          target: { page: p.id, nb: typeof p.nb === "string" ? p.nb : null },
          labels: labels
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
