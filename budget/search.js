// ============================================================
// orOS Budget — universal search provider (v1.0.0)
// Loaded by the shell on the first menu search (apps.json
// "search"). Read-only: reads oros-budget-data, never writes.
// Sensitive (money): apps.json "searchOff": true, opt-in.
// Hits: one per entry (its note, or its category when it has no
// note; kind, category and amount as text; the date shown is the
// entry's day) and one per recurring rule (note or category; how
// often, category and amount as text). Limits, settings and own
// categories are not searched. Anything a tombstone in tombs{}
// ("tx:" / "rec:") covers is skipped.
// Opens through the generic deep link: target { tx } | { rec }
// (receiver in budget.js).
// ============================================================
(function (root) {
  "use strict";
  var KEY = "oros-budget-data";
  var YMD = /^(\d{4})-(\d{2})-(\d{2})$/;
  var SEED_NAMES = {
    en: { "o-groc": "Groceries", "o-eat": "Eating out", "o-bills": "Bills", "o-home": "Rent & home",
          "o-trans": "Transport", "o-health": "Health", "o-fun": "Entertainment", "o-cloth": "Clothing",
          "o-gift": "Gifts", "o-other": "Other", "i-salary": "Salary", "i-free": "Freelance",
          "i-gift": "Gifts", "i-other": "Other" },
    el: { "o-groc": "Σούπερ μάρκετ", "o-eat": "Φαγητό έξω", "o-bills": "Λογαριασμοί", "o-home": "Ενοίκιο & σπίτι",
          "o-trans": "Μεταφορές", "o-health": "Υγεία", "o-fun": "Ψυχαγωγία", "o-cloth": "Ρούχα",
          "o-gift": "Δώρα", "o-other": "Άλλα", "i-salary": "Μισθός", "i-free": "Ελεύθερο επάγγελμα",
          "i-gift": "Δώρα", "i-other": "Άλλα" }
  };
  var WORDS = {
    en: { none: "Uncategorized", o: "Expense", i: "Income",
          m: "Every month", w: "Every week", y: "Every year" },
    el: { none: "Χωρίς κατηγορία", o: "Έξοδο", i: "Έσοδο",
          m: "Κάθε μήνα", w: "Κάθε εβδομάδα", y: "Κάθε χρόνο" }
  };

  function str(v) { return typeof v === "string" ? v.trim() : ""; }
  function arr(a) { return Array.isArray(a) ? a : []; }
  function dayMs(s) {
    var m = typeof s === "string" && YMD.exec(s);
    return m ? new Date(+m[1], +m[2] - 1, +m[3], 12).getTime() : 0;
  }

  var PROVIDER = {
    id: "budget",
    keys: [KEY],
    search: function (ctx) {
      var d = ctx.readJSON(KEY), out = [];
      if (!d || typeof d !== "object") return out;
      var lang = ctx.lang === "el" ? "el" : "en", w = WORDS[lang], seeds = SEED_NAMES[lang];
      var tombs = d.tombs && typeof d.tombs === "object" ? d.tombs : {};
      var cur = d.set && typeof d.set.cur === "string" ? d.set.cur : "EUR";
      function dead(kind, x) {
        var ts = tombs[kind + ":" + x.id];
        return typeof ts === "number" && ts >= (Number(x.m) || 0);
      }
      var stored = {};
      arr(d.cats).forEach(function (c) {
        if (c && typeof c.id === "string" && !dead("cat", c)) stored[c.id] = c;
      });
      function catName(id) {
        if (!id) return w.none;
        var c = stored[id];
        if (c && str(c.name)) return str(c.name);
        if (seeds[id] && !(("cat:" + id) in tombs && !c)) return seeds[id];
        return w.none;
      }
      function money(a) {
        if (typeof a !== "number" || !isFinite(a)) return "";
        var s = (a / 100).toFixed(2);
        return (lang === "el" ? s.replace(".", ",") : s) + " " + cur;
      }
      arr(d.tx).forEach(function (x) {
        if (!x || typeof x.id !== "string" || dead("tx", x)) return;
        var cat = catName(x.c);
        out.push({
          id: "t:" + x.id,
          title: str(x.n) || cat,
          text: [w[x.k === "i" ? "i" : "o"], cat, money(x.a)].join(" · "),
          when: dayMs(x.d),
          target: { tx: x.id }
        });
      });
      arr(d.rec).forEach(function (r) {
        if (!r || typeof r.id !== "string" || dead("rec", r)) return;
        var cat = catName(r.c);
        out.push({
          id: "r:" + r.id,
          title: str(r.n) || cat,
          text: [w[r.f] || "", w[r.k === "i" ? "i" : "o"], cat, money(r.a)].filter(Boolean).join(" · "),
          target: { rec: r.id }
        });
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
