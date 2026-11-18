// ============================================================
// orOS Base — Today provider (TODAY-GAP, gap review proposal 7)
// Loaded by the shell (today/host.js) through apps.json "today"
// (after feed.js, window.OrosBaseFeed). Read-only, never writes.
// The records of every date field the person turned "Show in
// Calendar" on for (field opt.cal === true, off by default: the same
// switch as the Calendar chip "Base", OrosBaseFeed.byDay), today and
// over the summary's days, as events (a past date is gone, not late),
// at the field's time when it keeps one. Title = the record's primary
// field, else the field's name; text = table · field.
// Under Sensitive work (ctx.strict) no record, table or field is named.
// Opens the record: { base, table, rec }.
// ============================================================
(function (root) {
  "use strict";
  var W = {
    en: { "td.rec": "Base record" },
    el: { "td.rec": "Εγγραφή της Βάσης" }
  };
  var MAX = 200;
  function tr(lang, k, p) {
    if (lang && !W[lang] && root && root.orosI18n) root.orosI18n.table(W, "base", lang);
    var s = (W[lang] || W.en)[k] || W.en[k];
    Object.keys(p || {}).forEach(function (x) { s = s.split("{" + x + "}").join(String(p[x])); });
    return s;
  }
  function feed() {
    if (root.OrosBaseFeed) return root.OrosBaseFeed;
    try { return typeof require === "function" ? require("./feed.js") : null; } catch (e) { return null; }
  }

  var PROVIDER = {
    id: "base",
    keys: ["oros-base-data"],
    collect: function (ctx) {
      var F = feed();
      if (!F) return [];
      var data = ctx.readJSON(F.KEY);
      if (!data || typeof data !== "object") return [];
      var by = F.byDay(data), veil = !!ctx.strict, out = [];
      for (var i = 0; i <= ctx.horizon && out.length < MAX; i++) {
        var day = ctx.addDays(ctx.today, i);
        (by[day] || []).forEach(function (x) {
          if (out.length >= MAX) return;
          var row = { id: x.rec + "-" + x.fid, due: day, time: x.time || null, kind: "event",
                      title: veil ? tr(ctx.lang, "td.rec") : (x.title || x.field || tr(ctx.lang, "td.rec")),
                      target: { base: x.base, table: x.table, rec: x.rec } };
          if (!veil && (x.field || x.tname)) row.text = [x.tname, x.field].filter(Boolean).join(" · ");
          out.push(row);
        });
      }
      return out;
    }
  };

  if (typeof module !== "undefined" && module.exports) module.exports = PROVIDER;
  if (root && root.document) {
    var list = root.orosTodayProviders = root.orosTodayProviders || [];
    for (var i = 0; i < list.length; i++) if (list[i] && list[i].id === PROVIDER.id) return;
    list.push(PROVIDER);
  }
})(typeof window !== "undefined" ? window : globalThis);
