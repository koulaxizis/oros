// ============================================================
// orOS Wiki — universal search provider (v1.1.0)
// Loaded by the shell on the first menu search (apps.json
// "search"). Read-only: reads oros-wiki-data, never writes.
// One hit per article: its title, and as text the article without
// markup signs ([[links]], **, ##, tables, pictures, {{infobox}},
// [^references]) plus the wiki's name.
// Redirect pages are skipped (the article they point to is a hit).
// Opens through __orosOpenAt("wiki", { a }).
// ============================================================
(function (root) {
  "use strict";
  var KEY = "oros-wiki-data";
  var ART_RE = /^a[0-9a-z]{6,24}$/;
  var REDIRECT = /^\s*#\s*(redirect|ανακατευθυνση|ανακατεύθυνση)\b/i;

  // Markup → text, without the full parser (the shell has no core.js).
  var FILE = "(?:file|image|αρχείο|αρχειο|εικόνα|εικονα)\\s*:";
  var RE_FILE_LINK = new RegExp("\\[\\[\\s*" + FILE + "([^\\]]*)\\]\\]", "gi");
  var RE_FILE_ID = new RegExp(FILE + "\\s*[0-9a-f]{64}\\.(?:jpg|png)\\|?", "gi");
  var OPTION = /^(left|right|center|centre|none|thumb|thumbnail|frame|frameless|αριστερά|δεξιά|κέντρο|\d+\s*px|alt\s*=.*)$/i;
  function plain(x) {
    return String(x || "")
      .replace(RE_FILE_LINK, function (m, body) {
        var parts = body.split("|").slice(1).filter(function (p) { return !OPTION.test(p.trim()); });
        return " " + (parts.length ? parts[parts.length - 1] : "") + " ";
      })
      .replace(RE_FILE_ID, " ")
      .replace(/^\s*\{\{[^\n]*$/gm, "")
      .replace(/^\s*\}\}\s*$/gm, "")
      .replace(/^\s*\|\s*([^=|\n]+?)\s*=\s*/gm, "$1: ")
      .replace(/^\s*\[\^[^\]\s]{1,40}\]:\s*/gm, "")
      .replace(/\[\^[^\]\s]{1,40}\]/g, "")
      .replace(/```[^\n]*\n?/g, "")
      .replace(/\[\[\s*:?\s*(?:category|κατηγορία|κατηγορια)\s*:[^\]]*\]\]/gi, " ")
      .replace(/\[\[([^\]|]*)\|([^\]]*)\]\]/g, "$2")
      .replace(/\[\[([^\]]*)\]\]/g, "$1")
      .replace(/\[([^\]\n]+)\]\(([^)\s]+)\)/g, "$1")
      .replace(/^\s*(#{1,6}|={2,6})\s*|\s*={2,6}\s*$/gm, "")
      .replace(/^\s*([-*+]|\d+[.)]|>)\s+/gm, "")
      .replace(/^\s*\|?[\s:|-]+\|?\s*$/gm, "")
      .replace(/^\s*\|\s*|\s*\|\s*$/gm, "")
      .replace(/\s*\|\s*/g, " · ")
      .replace(/\*\*|~~|`/g, "")
      .replace(/\s+/g, " ").trim();
  }

  var PROVIDER = {
    id: "wiki",
    keys: [KEY],
    search: function (ctx) {
      var d = ctx.readJSON(KEY), out = [];
      if (!d || !Array.isArray(d.arts)) return out;
      var tombs = d.tombs && typeof d.tombs === "object" ? d.tombs : {};
      var names = {};
      (Array.isArray(d.wikis) ? d.wikis : []).forEach(function (w) {
        if (w && typeof w.id === "string") names[w.id] = typeof w.n === "string" ? w.n : "";
      });
      d.arts.forEach(function (a) {
        if (!a || typeof a.id !== "string" || !ART_RE.test(a.id)) return;
        if (tombs[a.id] && tombs[a.id] >= a.m) return;
        var x = typeof a.x === "string" ? a.x : "";
        if (REDIRECT.test(x)) return;
        var title = String(a.t || "").trim();
        if (!title) return;
        var text = plain(x);
        if (names[a.w]) text = names[a.w] + " · " + text;
        out.push({ id: a.id, title: title, text: text, when: typeof a.m === "number" ? a.m : 0, target: { a: a.id } });
      });
      return out;
    },
    open: function (target, win) {
      if (win && typeof win.__orosOpenAt === "function") win.__orosOpenAt("wiki", target);
    }
  };

  if (typeof module !== "undefined" && module.exports) module.exports = PROVIDER;
  if (root && root.document) {
    var list = root.orosSearchProviders = root.orosSearchProviders || [];
    for (var i = 0; i < list.length; i++) if (list[i] && list[i].id === PROVIDER.id) return;
    list.push(PROVIDER);
  }
})(typeof window !== "undefined" ? window : globalThis);
