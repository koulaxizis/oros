// ============================================================
// orOS Newsletter — Today provider (v1.0.0)
// Loaded by the shell (today/host.js) through apps.json "today":
// ["core.js", "today.js"]. Read-only: reads oros-newsletter-data,
// never writes. Rows:
//   - an issue being sent ("Sending …: 40 of 120"), as a line for today
//   - a paused issue, as a task for today (it waits for you)
//   - a scheduled issue, as an event on its day at its time
//   - new subscribers in the last 24 hours, as a line for today
// Opens through Newsletter's own deep link (__orosOpenAt: { issue } /
// { list }).
// ============================================================
(function (root) {
  "use strict";
  var W = {
    en: { "today.sending": "Sending “{s}”", prog: "{a} of {b} sent", paused: "Newsletter paused: “{s}”",
          sched: "Newsletter goes out: “{s}”", "today.subs": "{n} new subscribers", subs1: "1 new subscriber", noSubj: "(no subject)" },
    el: { "today.sending": "Αποστολή «{s}»", prog: "στάλθηκαν {a} από {b}", paused: "Παύση αποστολής: «{s}»",
          sched: "Φεύγει το δελτίο: «{s}»", "today.subs": "{n} νέοι συνδρομητές", subs1: "1 νέος συνδρομητής", noSubj: "(χωρίς θέμα)" }
  };
  function fill(s, p) {
    Object.keys(p || {}).forEach(function (k) { s = s.split("{" + k + "}").join(String(p[k])); });
    return s;
  }
  function z(n) { return ("0" + n).slice(-2); }
  function ymd(ms) { var d = new Date(ms); return d.getFullYear() + "-" + z(d.getMonth() + 1) + "-" + z(d.getDate()); }
  function hm(ms) { var d = new Date(ms); return z(d.getHours()) + ":" + z(d.getMinutes()); }
  function subj(x, w) {
    var s = String(x.subj || "").replace(/\{(first|name)\|([^}]*)\}/g, "$2").replace(/\{(first|name)\}/g, "").trim();
    return (s || w.noSubj).slice(0, 80);
  }

  var PROVIDER = {
    id: "newsletter",
    keys: ["oros-newsletter-data"],
    collect: function (ctx) {
      var C = root.OrosNewsletterCore;
      if (!C) return [];
      var d = C.parse(ctx.readRaw(C.STORAGE_KEY));
      if (!d) return [];
      // A pack language: English + the "newsletter" pack, when one is loaded.
      if (!W[ctx.lang] && root.orosI18n) root.orosI18n.table(W, "newsletter", ctx.lang);
      var w = W[ctx.lang] || W.en, out = [];
      var last = ctx.addDays(ctx.today, ctx.horizon);
      C.live(d.issues).forEach(function (x) {
        if (x.st === "sending") {
          var p = C.progress(d, x);
          out.push({ id: "send-" + x.id, due: ctx.today, kind: "info", title: fill(w["today.sending"], { s: subj(x, w) }),
                     text: fill(w.prog, { a: p.sent, b: p.total }), target: { issue: x.id } });
        } else if (x.st === "paused") {
          out.push({ id: "paused-" + x.id, due: ctx.today, kind: "task", title: fill(w.paused, { s: subj(x, w) }),
                     target: { issue: x.id } });
        } else if (x.st === "sched" && x.when) {
          var day = ymd(x.when);
          if (day > last) return;
          if (day < ctx.today) day = ctx.today;          // late: it starts when orOS runs on its device
          out.push({ id: "sched-" + x.id, due: day, time: hm(x.when), kind: "event",
                     title: fill(w.sched, { s: subj(x, w) }), target: { issue: x.id } });
        }
      });
      // new subscribers (active or waiting to confirm) in the last day
      var since = ctx.now - 24 * 3600 * 1000, per = {};
      C.live(d.subs).forEach(function (s) {
        var st = C.status(s);
        if ((st === "on" || st === "pend") && s.at >= since) per[s.list] = (per[s.list] || 0) + 1;
      });
      var lists = Object.keys(per), n = 0;
      lists.forEach(function (id) { n += per[id]; });
      if (n) {
        out.push({ id: "subs-" + ctx.today, due: ctx.today, kind: "info", title: n === 1 ? w.subs1 : fill(w["today.subs"], { n: n }),
                   target: lists.length === 1 ? { list: lists[0] } : null });
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
