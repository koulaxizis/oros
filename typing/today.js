// ============================================================
// orOS Typing Tutor: Today provider
// Loaded by the shell (today/host.js) through apps.json "today",
// after typing/due.js. Read-only: reads the synced slice
// oros-typing-data through TypingDue and never writes. One row for
// today, "Practise typing: 4 of 10 minutes today", while the daily
// goal is not reached and the person practised in the last 7 days
// (no row for someone who never opens the app). Opens the app home.
// ============================================================
(function (root) {
  "use strict";
  var PROVIDER = {
    id: "typing",
    keys: ["oros-typing-data"],
    collect: function (ctx) {
      var D = root.TypingDue;
      if (!D) return [];
      var title = D.todayRow(D.read(ctx.readRaw(D.KEY)), ctx.now, ctx.lang);
      if (!title) return [];
      return [{ id: "practice-" + ctx.today, due: ctx.today, kind: "task", title: title, target: { home: 1 } }];
    }
  };

  if (typeof module !== "undefined" && module.exports) module.exports = PROVIDER;
  if (root && root.document) {
    var list = root.orosTodayProviders = root.orosTodayProviders || [];
    for (var i = 0; i < list.length; i++) if (list[i] && list[i].id === PROVIDER.id) return;
    list.push(PROVIDER);
  }
})(typeof window !== "undefined" ? window : globalThis);
