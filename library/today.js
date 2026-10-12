// ============================================================
// orOS Library — Today provider (v1.0.0)
// Loaded by the shell (today/host.js) through apps.json "today",
// after library/core.js (window.LibCore). Read-only: reads
// oros-library-data, never writes. One top line: the book you're
// reading, its progress, today's reading time and the streak
// (core.todayLine). Nothing in Library is "due", so it never makes a
// day busy. Opens the book (Library's own __orosOpenAt: { book }).
// ============================================================
(function (root) {
  "use strict";
  var KEY = "oros-library-data";

  var PROVIDER = {
    id: "library",
    keys: [KEY],
    collect: function (ctx) {
      var C = root.LibCore, raw = ctx.readJSON(KEY);
      if (!C || !raw || typeof raw !== "object") return [];
      var st = C.mergeLibrary(raw, raw);
      var line = C.todayLine(st, ctx.today, ctx.now, ctx.lang);
      return line ? [{ id: "reading", kind: "info", title: line.title, target: { book: line.book } }] : [];
    }
  };

  if (typeof module !== "undefined" && module.exports) module.exports = PROVIDER;
  if (root && root.document) {
    var list = root.orosTodayProviders = root.orosTodayProviders || [];
    for (var i = 0; i < list.length; i++) if (list[i] && list[i].id === PROVIDER.id) return;
    list.push(PROVIDER);
  }
})(typeof window !== "undefined" ? window : globalThis);
