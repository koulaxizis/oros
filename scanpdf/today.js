// ============================================================
// orOS Scanner & PDF — Today provider (TODAY-GAP, gap review proposal 7)
// Loaded by the shell (today/host.js) through apps.json "today"
// (after core.js and sign-core.js, which give window.ScanPdfSign).
// Read-only: reads the synced list of signature requests
// (oros-scanpdf-sign, ScanPdfSign.rows: one row per request, several
// signers of one document as one row); never writes, never asks the
// relay (the app's own poll brings the answers in).
//   - top line: how many requests are still waiting for a signature;
//   - top line: each request answered in the last 24 hours (signed,
//     declined, or k of n signed for several signers);
//   - event: a waiting request whose link stops working within the
//     summary's days, at the hour it ends.
// Under Sensitive work (ctx.strict) no document or person is named.
// Every row opens the list of requests: { signList: 1 }.
// ============================================================
(function (root) {
  "use strict";
  var W = {
    en: { "td.wait1": "1 signature request waiting", "td.wait": "{n} signature requests waiting",
          "td.signed": "Signed: {doc}", "td.signedAll": "Signed by everyone: {doc}", "td.declined": "Declined: {doc}",
          "td.some": "{k} of {n} signed: {doc}", "td.by": "By {nm}", "td.ends": "Signing link ends: {doc}",
          "td.to": "To {to}", "td.doc": "a document", "td.back": "A signature request was answered",
          "td.endsAny": "A signing link ends", "td.tipEnds": "Nobody has signed yet: send a reminder, or a new request before the link ends." },
    el: { "td.wait1": "1 αίτηση υπογραφής σε αναμονή", "td.wait": "{n} αιτήσεις υπογραφής σε αναμονή",
          "td.signed": "Υπογράφηκε: {doc}", "td.signedAll": "Υπέγραψαν όλοι: {doc}", "td.declined": "Απορρίφθηκε: {doc}",
          "td.some": "Υπέγραψαν {k} από {n}: {doc}", "td.by": "Από: {nm}", "td.ends": "Λήγει ο σύνδεσμος υπογραφής: {doc}",
          "td.to": "Προς: {to}", "td.doc": "ένα έγγραφο", "td.back": "Απαντήθηκε μια αίτηση υπογραφής",
          "td.endsAny": "Λήγει ένας σύνδεσμος υπογραφής", "td.tipEnds": "Δεν έχει υπογράψει κανείς ακόμη: στείλε μια υπενθύμιση ή νέα αίτηση πριν λήξει ο σύνδεσμος." }
  };
  var DAY = 86400000;
  function tr(lang, k, p) {
    if (lang && !W[lang] && root && root.orosI18n) root.orosI18n.table(W, "scanpdf", lang);
    var s = (W[lang] || W.en)[k] || W.en[k];
    Object.keys(p || {}).forEach(function (x) { s = s.split("{" + x + "}").join(String(p[x])); });
    return s;
  }
  function pad(n) { return (n < 10 ? "0" : "") + n; }
  function ymd(ms) { var d = new Date(ms); return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()); }
  function hm(ms) { var d = new Date(ms); return pad(d.getHours()) + ":" + pad(d.getMinutes()); }
  function sign() {
    if (root.ScanPdfSign) return root.ScanPdfSign;
    try { return typeof require === "function" ? require("./sign-core.js") : null; } catch (e) { return null; }
  }

  var PROVIDER = {
    id: "scanpdf",
    keys: ["oros-scanpdf-sign"],
    collect: function (ctx) {
      var SG = sign();
      if (!SG) return [];
      var raw = ctx.readJSON(SG.STORE_KEY);
      if (!raw || typeof raw !== "object") return [];
      var now = ctx.now, veil = !!ctx.strict, L = ctx.lang, last = ctx.addDays(ctx.today, ctx.horizon);
      var rows = SG.rows(raw, now), out = [], waiting = 0;
      rows.forEach(function (r) {
        var items = r.g ? r.items : [r.it], first = items[0], q = first.q || {};
        var doc = veil ? tr(L, "td.doc") : (q.n || tr(L, "td.doc"));
        var key = r.g ? "g-" + r.g : first.id;
        var st = r.g ? r.status : first.status;
        if (st === "waiting") {
          waiting++;
          var x = first.x;
          if (x > now && ymd(x) <= last) {
            var none = !items.some(function (it) { return it.got; });
            var ends = { id: "end-" + key, due: ymd(x), time: hm(x), kind: "event",
                         title: veil ? tr(L, "td.endsAny") : tr(L, "td.ends", { doc: doc }), target: { signList: 1 } };
            if (!veil) ends.text = items.map(function (it) { return it.q && it.q.to; }).filter(Boolean)
              .map(function (to) { return tr(L, "td.to", { to: to }); }).join(" · ");
            if (none && x - now < DAY) ends.tip = tr(L, "td.tipEnds");
            out.push(ends);
          }
        }
        // answered in the last 24 hours (the time this device took the reply in)
        var got = items.filter(function (it) { return it.got && it.got.at > now - DAY && it.got.at <= now + 60000; });
        if (!got.length) return;
        var title, by = "";
        if (veil) title = tr(L, "td.back");
        else if (st === "declined") {
          var no = items.filter(function (it) { return it.got && it.got.st === "declined"; })[0] || got[0];
          title = tr(L, "td.declined", { doc: doc }); by = no.got.nm || (no.q && no.q.to) || "";
        } else if (r.g && st === "signed") title = tr(L, "td.signedAll", { doc: doc });
        else if (r.g) {
          var k = items.filter(function (it) { return it.got && it.got.st === "signed"; }).length;
          title = tr(L, "td.some", { k: k, n: first.g.n, doc: doc });
        } else if (st === "signed") { title = tr(L, "td.signed", { doc: doc }); by = first.got.nm || q.to || ""; }
        else return;
        var row = { id: "got-" + key, due: null, time: null, kind: "info", title: title, target: { signList: 1 } };
        if (!veil && by) row.text = tr(L, "td.by", { nm: by });
        out.push(row);
      });
      if (waiting) out.unshift({ id: "waiting", due: null, time: null, kind: "info",
        title: waiting === 1 ? tr(L, "td.wait1") : tr(L, "td.wait", { n: waiting }), target: { signList: 1 } });
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
