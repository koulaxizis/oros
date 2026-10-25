// ============================================================
// orOS CRM — Today provider (v1.1.0)
// Loaded by the shell (today/host.js) through apps.json "today"
// (after crm/core.js). Read-only: reads oros-crm-data, never writes.
// Rows: every open follow-up that is late, due today or due in the
// next days (OrosCrmCore.agenda, the same list as the app's Agenda),
// with its time when it has one; the customer is the text.
// Partner card W5: settlements due, royalties to pay and hours not
// billed of linked partners (partnerRows, below; apps.json loads
// links.js and overview.js before this file).
// Opens through the generic deep link __orosOpenAt("crm", { fup }).
// "Done" opens CRM, which ticks the follow-up with its own code
// ({ done: { fup } }, Undo and "Log it" in its toast).
// ============================================================
(function (root) {
  "use strict";
  var KEY = "oros-crm-data";
  var W = {
    en: { "td.settle": "Settlement due: {s}", "td.roy": "Royalties to pay: {v}", "td.hours": "Hours not billed: {h} · {v}", "ov.h": "{n} h" },
    el: { "td.settle": "Οφείλεται εκκαθάριση: {s}", "td.roy": "Δικαιώματα προς πληρωμή: {v}", "td.hours": "Ώρες χωρίς χρέωση: {h} · {v}", "ov.h": "{n} ώρ." }
  };
  function tr(lang, k, p) {
    if (lang && !W[lang] && root.orosI18n) root.orosI18n.table(W, "crm", lang);
    var s = (W[lang] || W.en)[k];
    Object.keys(p || {}).forEach(function (x) { s = s.split("{" + x + "}").join(String(p[x])); });
    return s;
  }
  function readRaw(ctx, key) { try { return ctx.readJSON(key); } catch (e) { return null; } }
  // Partner card W5: what is due with a partner in the other apps,
  // read through their cores (all in the shell) and crm/overview.js:
  // a consignment settlement that is due (a task on its day), royalty
  // statements not paid yet and hours not billed yet (lines at the
  // top). Only partners linked to those apps; each opens the partner.
  function partnerRows(ctx, C, data) {
    var OV = root.OrosCrmOverview, out = [];
    if (!OV || !data.pt || !data.pt.length) return out;
    var I = root.OrosInvoicesCore, S = root.OrosStockCore, T = root.orosTimesheetCore;
    // read the way CRM reads them (crm.js stockData / tsData)
    var stock = S ? readRaw(ctx, "oros-stock-data") : null, ts = null, pub = readRaw(ctx, "oros-publish-data"), inv = null;
    if (stock) { try { stock = S.merge(stock, null); } catch (e) { stock = null; } }
    if (T && typeof T.parse === "function") { try { ts = T.parse(ctx.readRaw("oros-timesheet-data")); } catch (e) { ts = null; } }
    var lang = ctx.lang, cur = function (map, f) { return Object.keys(map).sort().map(function (k) { return f(map[k], k); }).join(" · "); };
    data.cust.forEach(function (c) {
      var links = C.linksOf(data, c);
      if (!links.length) return;
      var x;
      try {
        x = OV.build({ data: data, cust: c, today: ctx.today, nowMs: ctx.now, links: links, inv: inv, I: I, alsoInv: [],
                       stock: stock, S: S, ts: ts, T: T, pub: pub });
      } catch (e) { return; }
      var name = C.custName(c);
      x.shops.forEach(function (r) {
        if (!r.due) return;
        out.push({ id: "cons-" + r.id, due: r.due, title: tr(lang, "td.settle", { s: r.name }), text: name, kind: "task", target: { cust: c.id } });
      });
      if (x.pub.open && Object.keys(x.pub.due).length) {
        out.push({ id: "roy-" + c.id, due: null, title: tr(lang, "td.roy", { v: cur(x.pub.due, function (v, k) { return C.moneyStr(v, k, lang); }) }), text: name, kind: "info", target: { cust: c.id } });
      }
      var ms = 0, amt = {};
      x.work.forEach(function (r) { ms += r.ms; if (r.amount) amt[r.cur] = (amt[r.cur] || 0) + r.amount; });
      if (ms >= 3600000) {
        var h = tr(lang, "ov.h", { n: (Math.round(ms / 360000) / 10).toLocaleString(lang === "el" ? "el-GR" : (lang || "en")) });
        var v = cur(amt, function (a, k) { return C.moneyStr(a, k, lang); });
        out.push({ id: "hrs-" + c.id, due: null, title: v ? tr(lang, "td.hours", { h: h, v: v }) : tr(lang, "td.hours", { h: h, v: "" }).replace(/ · $/, ""), text: name, kind: "info", target: { cust: c.id } });
      }
    });
    return out;
  }

  var PROVIDER = {
    id: "crm",
    keys: [KEY],
    collect: function (ctx) {
      var C = root.OrosCrmCore, raw = ctx.readJSON(KEY);
      if (!C || !raw || !Array.isArray(raw.cust) || !raw.cust.length) return [];
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
      }).concat(partnerRows(ctx, C, data));
    }
  };

  if (typeof module !== "undefined" && module.exports) module.exports = PROVIDER;
  if (root && root.document) {
    var list = root.orosTodayProviders = root.orosTodayProviders || [];
    for (var i = 0; i < list.length; i++) if (list[i] && list[i].id === PROVIDER.id) return;
    list.push(PROVIDER);
  }
})(typeof window !== "undefined" ? window : globalThis);
