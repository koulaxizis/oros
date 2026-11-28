// ============================================================
// orOS Transfer — Today provider (TODAY-GAP, gap review proposal 7)
// Loaded by the shell (today/host.js) through apps.json "today"
// (after core.js, window.OrosTransferCore). Read-only, never writes:
//   - top line: each transfer received whole in the last 24 hours
//     (synced history oros-transfer-data, dir "recv", end "done");
//     opens its folder in Files when it went to the orOS disk, else
//     Transfer's History;
//   - event: each "Through my Dropbox" link of this device that stops
//     working within the summary's days, at the hour it ends
//     (device-local oros-transfer-links, core.js cleanLinks).
// Under Sensitive work (ctx.strict) no file or device is named.
// ============================================================
(function (root) {
  "use strict";
  var W = {
    en: { "td.recv": "Received: {what}", "td.recvAny": "A transfer arrived", "td.files1": "1 file", "td.files": "{n} files",
          "td.from": "from {dev}", "td.bad": "{n} did not arrive whole", "td.ends": "Transfer link ends: {what}",
          "td.endsAny": "A transfer link ends", "td.tipEnds": "After this the files are deleted from your Dropbox and the link stops working." },
    el: { "td.recv": "Λήφθηκε: {what}", "td.recvAny": "Ήρθε μια μεταφορά", "td.files1": "1 αρχείο", "td.files": "{n} αρχεία",
          "td.from": "από {dev}", "td.bad": "{n} δεν ήρθαν ολόκληρα", "td.ends": "Λήγει ο σύνδεσμος μεταφοράς: {what}",
          "td.endsAny": "Λήγει ένας σύνδεσμος μεταφοράς", "td.tipEnds": "Μετά τα αρχεία σβήνονται από το Dropbox σου και ο σύνδεσμος παύει να ισχύει." }
  };
  var DAY = 86400000;
  function tr(lang, k, p) {
    if (lang && !W[lang] && root && root.orosI18n) root.orosI18n.table(W, "transfer", lang);
    var s = (W[lang] || W.en)[k] || W.en[k];
    Object.keys(p || {}).forEach(function (x) { s = s.split("{" + x + "}").join(String(p[x])); });
    return s;
  }
  function pad(n) { return (n < 10 ? "0" : "") + n; }
  function ymd(ms) { var d = new Date(ms); return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()); }
  function hm(ms) { var d = new Date(ms); return pad(d.getHours()) + ":" + pad(d.getMinutes()); }
  function core() {
    if (root.OrosTransferCore) return root.OrosTransferCore;
    try { return typeof require === "function" ? require("./core.js") : null; } catch (e) { return null; }
  }
  var FOLDER_RE = /^\/internal\/Transfers\/[^\u0000-\u001f]{1,300}$/;

  var PROVIDER = {
    id: "transfer",
    keys: ["oros-transfer-data", "oros-transfer-links"],
    collect: function (ctx) {
      var C = core();
      if (!C) return [];
      var now = ctx.now, veil = !!ctx.strict, L = ctx.lang, out = [];
      var hist = C.mergeHistory(ctx.readJSON(C.HIST_KEY), null, now);
      hist.items.forEach(function (x) {
        if (x.dir !== "recv" || x.end !== "done" || !(x.at > now - DAY) || x.at > now + 60000) return;
        var row = { id: "recv-" + x.id, due: null, time: null, kind: "info",
                    title: veil || !x.what ? tr(L, "td.recvAny") : tr(L, "td.recv", { what: x.what }),
                    target: x.folder ? { folder: x.folder } : { tab: "hist" } };
        if (!veil) {
          var parts = [x.n === 1 ? tr(L, "td.files1") : tr(L, "td.files", { n: x.n })];
          if (x.dev) parts.push(tr(L, "td.from", { dev: x.dev }));
          if (x.bad) parts.push(tr(L, "td.bad", { n: x.bad }));
          row.text = parts.join(" · ");
        }
        out.push(row);
      });
      var last = ctx.addDays(ctx.today, ctx.horizon);
      C.cleanLinks(ctx.readJSON(C.LINKS_KEY), now).items.forEach(function (l) {
        if (!l.exp || ymd(l.exp) > last) return;          // TR-UNL: a link kept until deleted never ends
        var row = { id: "end-" + l.id, due: ymd(l.exp), time: hm(l.exp), kind: "event",
                    title: veil || !l.what ? tr(L, "td.endsAny") : tr(L, "td.ends", { what: l.what }),
                    target: { tab: "hist" } };
        if (!veil && l.n) row.text = l.n === 1 ? tr(L, "td.files1") : tr(L, "td.files", { n: l.n });
        if (l.exp - now < DAY) row.tip = tr(L, "td.tipEnds");
        out.push(row);
      });
      return out;
    },
    // A received folder opens in Files; anything else opens Transfer.
    open: function (target, win) {
      var w = win || root;
      if (!w || typeof w.__orosOpenAt !== "function") return;
      if (target && typeof target.folder === "string" && FOLDER_RE.test(target.folder) && target.folder.indexOf("..") < 0) {
        w.__orosOpenAt("files", { path: target.folder, dir: true });
        return;
      }
      w.__orosOpenAt("transfer", { tab: "hist" });
    }
  };

  if (typeof module !== "undefined" && module.exports) module.exports = PROVIDER;
  if (root && root.document) {
    var list = root.orosTodayProviders = root.orosTodayProviders || [];
    for (var i = 0; i < list.length; i++) if (list[i] && list[i].id === PROVIDER.id) return;
    list.push(PROVIDER);
  }
})(typeof window !== "undefined" ? window : globalThis);
