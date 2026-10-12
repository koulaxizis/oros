// ============================================================
// orOS CRM — Today provider (v1.0.0)
// Loaded by the shell (today/host.js) through apps.json "today"
// (after crm/core.js). Read-only: reads oros-crm-data, never writes.
// Rows: every open follow-up that is late, due today or due in the
// next days (OrosCrmCore.agenda, the same list as the app's Agenda),
// with its time when it has one; the customer is the text.
// Opens through the generic deep link __orosOpenAt("crm", { fup }).
// "Done" opens CRM, which ticks the follow-up with its own code
// ({ done: { fup } }, Undo and "Log it" in its toast).
// ============================================================
(function (root) {
  "use strict";
  var KEY = "oros-crm-data";

  var PROVIDER = {
    id: "crm",
    keys: [KEY],
    collect: function (ctx) {
      var C = root.OrosCrmCore, raw = ctx.readJSON(KEY);
      if (!C || !raw || !Array.isArray(raw.fups) || !raw.fups.length) return [];
      var data = C.norm(raw);
      var ag = C.agenda(data, ctx.today, ctx.horizon);
      return ag.late.concat(ag.today, ag.soon).map(function (f) {
        var c = C.byId(data.cust, f.cust);
        return {
          id: f.id,
          due: f.d,
          time: f.t || null,
          title: f.text,
          text: c ? C.custName(c) : "",
          kind: "task",
          target: { fup: f.id },
          done: { fup: f.id }
        };
      });
    }
  };

  if (typeof module !== "undefined" && module.exports) module.exports = PROVIDER;
  if (root && root.document) {
    var list = root.orosTodayProviders = root.orosTodayProviders || [];
    for (var i = 0; i < list.length; i++) if (list[i] && list[i].id === PROVIDER.id) return;
    list.push(PROVIDER);
  }
})(typeof window !== "undefined" ? window : globalThis);
