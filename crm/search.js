// ============================================================
// orOS CRM — universal search provider (v1.1.0)
// Loaded by the shell on the first menu search (apps.json
// "search"; "searchOff": true, so it starts switched off: the data
// is about other people). Read-only: reads oros-crm-data, never
// writes.
// Hits:
//   • a customer: name (+ trade name); VAT ID, phone, email,
//     profession, people, notes as text
//   • a deal: its title; customer, stage (the user's name for it,
//     else the built-in one), value as text; the day
//     shown is the expected close (open) or the close day
//   • an open follow-up: its text; customer as text; its day
//   • a history entry with text: its first line; customer; its day
// A row hidden by a tombstone (tomb ≥ m) or whose customer is gone
// is skipped, the way the merge hides it.
// Opens through the generic deep link: __orosOpenAt("crm",
// { cust | deal | fup | act: id }).
// ============================================================
(function (root) {
  "use strict";
  var KEY = "oros-crm-data";
  var YMD = /^(\d{4})-(\d{2})-(\d{2})$/;
  var STAGE = {
    en: { "new": "New", contact: "Contacted", proposal: "Proposal", nego: "Negotiation", won: "Won", lost: "Lost" },
    el: { "new": "Νέα", contact: "Επικοινωνία", proposal: "Πρόταση", nego: "Διαπραγμάτευση", won: "Κερδήθηκε", lost: "Χάθηκε" }
  };

  function str(v) { return typeof v === "string" ? v.trim() : ""; }
  function arr(a) { return Array.isArray(a) ? a : []; }
  function dayMs(s) {
    var m = typeof s === "string" && YMD.exec(s);
    return m ? new Date(+m[1], +m[2] - 1, +m[3], 12).getTime() : 0;
  }
  function firstLine(s) {
    return String(s || "").split("\n").map(function (l) { return l.trim(); }).filter(Boolean)[0] || "";
  }

  var PROVIDER = {
    id: "crm",
    keys: [KEY],
    search: function (ctx) {
      var d = ctx.readJSON(KEY), out = [], L = ctx.lang || "en";
      // a pack language (../i18n.js): STAGE[L] = English + the "crm" pack
      var I = typeof window !== "undefined" && window.orosI18n;
      if (I && !STAGE[L]) I.table(STAGE, "crm", L);
      if (!STAGE[L]) L = "en";
      if (!d || !Array.isArray(d.cust)) return out;
      var tombs = d.tombs && typeof d.tombs === "object" ? d.tombs : {};
      function gone(x) {
        return !x || typeof x.id !== "string" ||
          (typeof tombs[x.id] === "number" && tombs[x.id] >= (Number(x.m) || 0));
      }
      var names = {}, stg = {};
      arr(d.stg).forEach(function (r) { if (!gone(r)) stg[r.id] = r; });
      d.cust.forEach(function (c) {
        if (gone(c) || !str(c.name)) return;
        names[c.id] = str(c.name);
        out.push({
          id: c.id,
          title: str(c.alias) ? str(c.name) + " (" + str(c.alias) + ")" : str(c.name),
          text: [str(c.afm), str(c.phone), str(c.email), str(c.job),
                 arr(c.people).map(function (p) { return p && str(p.n); }).filter(Boolean).join(", "),
                 str(c.note)].filter(Boolean).join(" · "),
          target: { cust: c.id }
        });
      });
      function rows(list, f) {
        arr(list).forEach(function (x) {
          if (gone(x) || !names[x.cust]) return;
          var h = f(x, names[x.cust]);
          if (h) out.push(h);
        });
      }
      rows(d.deals, function (x, cn) {
        var own = stg[x.stage];
        var stage = (own && own.name) || STAGE[L][x.stage] || "";
        var val = typeof x.val === "number" && x.val > 0 ? (x.val / 100).toLocaleString(I ? I.locale(L) : (L === "el" ? "el-GR" : "en-GB")) : "";
        return {
          id: x.id,
          title: str(x.title),
          text: [cn, stage, val, str(x.note)].filter(Boolean).join(" · "),
          when: dayMs(x.cd || x.close),
          target: { deal: x.id }
        };
      });
      rows(d.fups, function (x, cn) {
        if (x.done) return null;
        return { id: x.id, title: str(x.text), text: cn, when: dayMs(x.d), target: { fup: x.id } };
      });
      rows(d.acts, function (x, cn) {
        var line = firstLine(x.text);
        if (!line) return null;
        return {
          id: x.id,
          title: line.slice(0, 80),
          text: [cn, str(x.who), str(x.text)].filter(Boolean).join(" · "),
          when: typeof x.at === "number" ? x.at : 0,
          target: { act: x.id }
        };
      });
      return out;
    }
  };

  if (typeof module !== "undefined" && module.exports) module.exports = PROVIDER;
  if (root && root.document) {
    var list = root.orosSearchProviders = root.orosSearchProviders || [];
    for (var i = 0; i < list.length; i++) if (list[i] && list[i].id === PROVIDER.id) return;
    list.push(PROVIDER);
  }
})(typeof window !== "undefined" ? window : globalThis);
