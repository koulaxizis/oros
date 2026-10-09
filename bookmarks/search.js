// ============================================================
// orOS Bookmarks — universal search provider (v1.0.0)
// Loaded by the shell on the first menu search (apps.json
// "search"). Read-only: reads oros-bookmarks-data, never writes.
// One hit per bookmark (title; address, note, tags and folder as
// text). Items/folders are maps keyed by id; ids listed in
// deleted{} are skipped (as the app's own sanitizer does).
// Opens through the generic deep link: target { id }.
// ============================================================
(function (root) {
  "use strict";
  var KEY = "oros-bookmarks-data";

  function str(v) { return typeof v === "string" ? v.trim() : ""; }

  var PROVIDER = {
    id: "bookmarks",
    keys: [KEY],
    search: function (ctx) {
      var d = ctx.readJSON(KEY), out = [];
      if (!d || !d.items || typeof d.items !== "object") return out;
      var del = d.deleted && typeof d.deleted === "object" ? d.deleted : {};
      var folders = d.folders && typeof d.folders === "object" ? d.folders : {};
      Object.keys(d.items).forEach(function (id) {
        var it = d.items[id];
        if (!it || typeof it !== "object" || del[id]) return;
        var url = str(it.url);
        var f = folders[it.folderId];
        var fname = f && it.folderId !== "unsorted" ? str(f.name) : "";
        out.push({
          id: id,
          title: str(it.title) || url,
          text: [url, str(it.note),
                 (Array.isArray(it.tags) ? it.tags : []).map(str).filter(Boolean).map(function (t) { return "#" + t; }).join(" "),
                 fname].filter(Boolean).join(" · "),
          target: { id: id }
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
