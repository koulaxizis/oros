// ============================================================
// orOS Sticky Notes — Today provider (v1.0.0)
// Loaded by the shell (today/host.js) through apps.json "today".
// Read-only: reads oros-stickies-data, never writes. One task row per
// ring in the summary's days: a ring nobody has answered yet is late
// (Overdue) or today's; a repeating ring also shows its next rounds
// up to the horizon. Faded and deleted notes are left out.
// Opens the note on the desktop (__orosOpenStickies; its editor on a
// phone), where Done and Snooze are.
// Needs stickies/core.js (StickiesCore), which the shell loads at
// boot next to stickies/host.js.
// ============================================================
(function (root) {
  "use strict";
  var KEY = "oros-stickies-data";
  var NAME = { en: "Sticky note", el: "Post-it" };
  // The fallback title: "note" of the stickies pack for a pack language
  // (host.js loads that pack in the shell), else English or Greek.
  function name(l) {
    if (l === "el" || l === "en") return NAME[l];
    var I = root && root.orosI18n;
    if (!I) return NAME.en;
    var tab = I.table({ en: { note: NAME.en } }, "stickies", l);
    return tab.note || NAME.en;
  }
  function langOf(ctx) {
    var I = root && root.orosI18n;
    if (I && ctx.lang !== "el") { try { return I.lang(); } catch (e) {} }
    return ctx.lang === "el" ? "el" : "en";
  }
  var MAX_ROUNDS = 8;

  function core() {
    if (root && root.StickiesCore) return root.StickiesCore;
    if (typeof module !== "undefined" && module.exports && typeof require === "function") {
      try { return require("./core.js"); } catch (e) {}
    }
    return null;
  }
  function p2(n) { return (n < 10 ? "0" : "") + n; }
  function ymd(d) { return d.getFullYear() + "-" + p2(d.getMonth() + 1) + "-" + p2(d.getDate()); }
  function hm(d) { return p2(d.getHours()) + ":" + p2(d.getMinutes()); }

  var PROVIDER = {
    id: "stickies",
    keys: [KEY],
    collect: function (ctx) {
      var C = core(), d = ctx.readJSON(KEY);
      if (!C || !d) return [];
      var last = ctx.addDays(ctx.today, ctx.horizon), rows = [];
      var lang = langOf(ctx);
      C.live(C.merge(d, null)).forEach(function (n) {
        if (!n.ring) return;
        var title = C.firstLine(n.text) || name(lang);
        var at = n.ring.at, k = 0;
        while (at && k < MAX_ROUNDS) {
          var day = ymd(new Date(at));
          if (day > last) break;
          rows.push({ id: n.id + "@" + at, due: day, time: hm(new Date(at)), title: title, text: "", kind: "task", target: { note: n.id } });
          k++;
          at = n.ring.rep ? C.nextRound(n.ring.rep, n.ring.t, Math.max(at, n.ring.t)) : 0;
        }
      });
      return rows;
    },
    open: function (target, win) {
      var id = target && typeof target.note === "string" ? target.note : "";
      if (win && typeof win.__orosOpenStickies === "function") win.__orosOpenStickies(id);
      else if (win && typeof win.__orosOpenApp === "function") win.__orosOpenApp("stickies");
    }
  };

  if (typeof module !== "undefined" && module.exports) module.exports = PROVIDER;
  if (root && root.document) {
    var list = root.orosTodayProviders = root.orosTodayProviders || [];
    for (var i = 0; i < list.length; i++) if (list[i] && list[i].id === PROVIDER.id) return;
    list.push(PROVIDER);
  }
})(typeof window !== "undefined" ? window : globalThis);
