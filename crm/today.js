// ============================================================
// orOS CRM — Today provider (v1.1.0)
// Loaded by the shell (today/host.js) through apps.json "today"
// (after crm/core.js). Read-only: reads oros-crm-data, never writes.
// Rows: every open follow-up that is late, due today or due in the
// next days (OrosCrmCore.agenda, the same list as the app's Agenda),
// with its time when it has one; the customer is the text.
// Partner card W5: royalties to pay and hours not billed of linked
// partners (partnerRows, below; apps.json loads
// links.js and overview.js before this file).
// Opens through the generic deep link __orosOpenAt("crm", { fup }).
// "Done" opens CRM, which ticks the follow-up with its own code
// ({ done: { fup } }, Undo and "Log it" in its toast).
// ============================================================
(function (root) {
  "use strict";
  var KEY = "oros-crm-data";
  var W = {
    en: { "td.roy": "Royalties to pay: {v}", "td.hours": "Hours not billed: {h} · {v}", "ov.h": "{n} h",
          "td.ctr": "Contracts that need a decision: {n}", "td.ctrEnded": "{n} ended", "td.ctrSoon": "{n} end within {d} days",
          "td.ctrEnd": "ends {d}", "td.ctrGone": "ended {d}" },
    el: { "td.roy": "Δικαιώματα προς πληρωμή: {v}", "td.hours": "Ώρες χωρίς χρέωση: {h} · {v}", "ov.h": "{n} ώρ.",
          "td.ctr": "Συμφωνητικά που θέλουν απόφαση: {n}", "td.ctrEnded": "{n} έληξαν", "td.ctrSoon": "{n} λήγουν μέσα σε {d} ημέρες",
          "td.ctrEnd": "λήγει {d}", "td.ctrGone": "έληξε {d}" }
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
  // royalty statements not paid yet and hours not billed yet (lines at
  // the top). Only partners linked to those apps; each opens the
  // partner. A settlement that is due is Stock's own row (stock/today.js).
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
      if (!links.length && !(ts && (ts.clients || []).some(function (k) { return k && !k.del && k.crm === c.id; }))) return;
      var x;
      try {
        x = OV.build({ data: data, cust: c, today: ctx.today, nowMs: ctx.now, links: links, inv: inv, I: I, alsoInv: [],
                       stock: stock, S: S, ts: ts, T: T, pub: pub });
      } catch (e) { return; }
      var name = C.custName(c);
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

  // CRM 1.10 (CTR-ALL): one line at the top for the contracts that need
  // a decision (ended, or within SOON_DAYS of the end, not put off);
  // the follow-up of a contract gets its quick actions (CRM asks first).
  function dmy(ymd, lang) { return lang === "en" ? ymd : ymd.slice(8) + "/" + ymd.slice(5, 7) + "/" + ymd.slice(0, 4); }
  function ctrRows(ctx, C, data) {
    if (typeof C.ctrAll !== "function" || !data.ctr) return [];
    var needs = C.ctrAll(data, ctx.today, "needs");
    if (!needs.length) return [];
    var ended = needs.filter(function (r) { return r.st === "ended"; }).length, soon = needs.length - ended, lang = ctx.lang;
    var more = [];
    if (ended) more.push(tr(lang, "td.ctrEnded", { n: ended }));
    if (soon) more.push(tr(lang, "td.ctrSoon", { n: soon, d: C.SOON_DAYS }));
    needs.slice(0, 3 - more.length).forEach(function (r) {
      more.push(r.ctr.t + " · " + tr(lang, r.st === "ended" ? "td.ctrGone" : "td.ctrEnd", { d: dmy(r.ctr.to, lang) }));
    });
    return [{ id: "ctrs", due: null, title: tr(lang, "td.ctr", { n: needs.length }), text: "", kind: "info", target: { ctrs: "needs" }, more: more }];
  }
  function ctrActs(data, f) {
    var k = null;
    (data.ctr || []).forEach(function (c) { if (c.fup === f.id) k = c; });
    if (!k) return null;
    var c = data.cust ? (function () { for (var i = 0; i < data.cust.length; i++) if (data.cust[i].id === k.cust) return data.cust[i]; return null; })() : null;
    var acts = [{ k: "renew", target: { ctr: k.id, "do": "renew" } }, { k: "putoff", target: { ctr: k.id, "do": "post" } }];
    if (c && c.email) acts.push({ k: "email", target: { ctr: k.id, "do": "mail" } });
    return acts;
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
        var row = {
          id: f.id,
          due: f.d,
          time: f.t || null,
          title: f.text,
          text: c ? C.custName(c) : "",
          kind: "task",
          target: { fup: f.id },
          done: { fup: f.id }
        };
        var acts = ctrActs(data, f);
        if (acts) row.acts = acts;
        return row;
      }).concat(ctrRows(ctx, C, data), partnerRows(ctx, C, data));
    }
  };

  if (typeof module !== "undefined" && module.exports) module.exports = PROVIDER;
  if (root && root.document) {
    var list = root.orosTodayProviders = root.orosTodayProviders || [];
    for (var i = 0; i < list.length; i++) if (list[i] && list[i].id === PROVIDER.id) return;
    list.push(PROVIDER);
  }
})(typeof window !== "undefined" ? window : globalThis);
