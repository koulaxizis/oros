// ============================================================
// orOS Flashcards — Today provider (v1.0.0)
// Loaded by the shell (today/host.js) through apps.json "today",
// after flashcards/due.js. Read-only: reads the device-local summary
// oros-flashcards-due that the app writes after each rebuild, never
// writes. One row for today, "N cards to study", while cards are
// waiting (FlashcardsDue.count). Opens Flashcards on its deck list.
// ============================================================
(function (root) {
  "use strict";
  var PROVIDER = {
    id: "flashcards",
    keys: ["oros-flashcards-due"],
    collect: function (ctx) {
      var D = root.FlashcardsDue;
      if (!D) return [];
      var n = D.count(D.read(ctx.readRaw(D.KEY)), ctx.today);
      if (!n) return [];
      return [{ id: "due-" + ctx.today, due: ctx.today, kind: "task", title: D.rowText(n, ctx.lang), target: { home: 1 } }];
    }
  };

  if (typeof module !== "undefined" && module.exports) module.exports = PROVIDER;
  if (root && root.document) {
    var list = root.orosTodayProviders = root.orosTodayProviders || [];
    for (var i = 0; i < list.length; i++) if (list[i] && list[i].id === PROVIDER.id) return;
    list.push(PROVIDER);
  }
})(typeof window !== "undefined" ? window : globalThis);
