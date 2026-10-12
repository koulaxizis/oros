// ============================================================
// orOS Sticky Notes — universal search provider (v1.0.0)
// Loaded by the shell on the first menu search (apps.json
// "search"). Read-only: reads oros-stickies-data, never writes.
// One hit per note on the desktop (faded and deleted notes are left
// out): the first line as title, the whole text as text, the ring
// time as `when` when the note rings.
// Opens through the shell's own deep link __orosOpenStickies(id): the
// note in front on the desktop (its editor on a phone).
// Needs stickies/core.js (StickiesCore), which the shell loads at
// boot next to stickies/host.js.
// ============================================================
(function (root) {
  "use strict";
  var KEY = "oros-stickies-data";
  var NAME = { en: "Sticky note", el: "Post-it" };

  function core() {
    if (root && root.StickiesCore) return root.StickiesCore;
    if (typeof module !== "undefined" && module.exports && typeof require === "function") {
      try { return require("./core.js"); } catch (e) {}
    }
    return null;
  }

  var PROVIDER = {
    id: "stickies",
    keys: [KEY],
    search: function (ctx) {
      var C = core(), d = ctx.readJSON(KEY);
      if (!C || !d) return [];
      var lang = ctx.lang === "el" ? "el" : "en";
      return C.live(C.merge(d, null)).filter(function (n) { return n.text.trim(); }).map(function (n) {
        var hit = { id: n.id, title: C.firstLine(n.text) || NAME[lang], text: n.text.replace(/\s+/g, " ").trim(), target: { note: n.id } };
        if (n.ring) hit.when = n.ring.at;
        return hit;
      });
    },
    open: function (target, win) {
      var id = target && typeof target.note === "string" ? target.note : "";
      if (win && typeof win.__orosOpenStickies === "function") win.__orosOpenStickies(id);
      else if (win && typeof win.__orosOpenAt === "function") win.__orosOpenAt("stickies", target);
    }
  };

  if (typeof module !== "undefined" && module.exports) module.exports = PROVIDER;
  if (root && root.document) {
    var list = root.orosSearchProviders = root.orosSearchProviders || [];
    for (var i = 0; i < list.length; i++) if (list[i] && list[i].id === PROVIDER.id) return;
    list.push(PROVIDER);
  }
})(typeof window !== "undefined" ? window : globalThis);
