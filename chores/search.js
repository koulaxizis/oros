// ============================================================
// orOS Chore Wheel — universal search provider (v1.0.0)
// Loaded by the shell on the first menu search (apps.json
// "search"). Read-only: reads oros-chores-data and the household
// wheels' mirror oros-chores-hh (chores/house.js), never writes.
// Hits:
//   • a chore: its name; how often and who takes part as text
//   • a member: their name; the chores they take part in as text
//     (a chore with an empty who[] is everyone's, as in pool())
// The assignment and the done / skipped events hold no user text
// and are not searched. Deleted members and chores: a tombstone in
// tombs{} at or after max(m, om) hides them, as the merge does.
// Opens through the generic deep link: target { task } or
// { member } (Home tab + that chore's or member's dialog).
// ============================================================
(function (root) {
  "use strict";
  var KEY = "oros-chores-data", HH_KEY = "oros-chores-hh";
  var FREQ = {
    en: { d: "Every day", w: "Every week", mo: "Every month", n: "Every {n} days", wd: "On weekdays",
          "noname.task": "Unnamed chore", "noname.member": "Unnamed member" },
    el: { d: "Κάθε μέρα", w: "Κάθε εβδομάδα", mo: "Κάθε μήνα", n: "Κάθε {n} μέρες", wd: "Συγκεκριμένες μέρες",
          "noname.task": "Δουλειά χωρίς όνομα", "noname.member": "Μέλος χωρίς όνομα" }
  };

  function str(v) { return typeof v === "string" ? v.trim() : ""; }
  function arr(a) { return Array.isArray(a) ? a : []; }
  function freqText(f, lang) {
    var L = lang === "el" ? FREQ.el : FREQ.en;
    if (!f || typeof f !== "object" || !L[f.k]) return "";
    return L[f.k].replace("{n}", String(f.n));
  }

  var PROVIDER = {
    id: "chores",
    keys: [KEY, HH_KEY],
    search: function (ctx) {
      var out = hitsOf(ctx.readJSON(KEY), "", ctx);
      // wheels shared with a household (chores/house.js mirror, BR-HH)
      var hh = ctx.readJSON(HH_KEY);
      (hh && Array.isArray(hh.wheels) ? hh.wheels : []).forEach(function (w) {
        if (w && typeof w.id === "string") out = out.concat(hitsOf(w.data, w.id, ctx));
      });
      return out;
    }
  };
  function hitsOf(d, wheel, ctx) {
    var out = [], L = ctx.lang === "el" ? FREQ.el : FREQ.en;
    if (!d || typeof d !== "object") return out;
    var tombs = d.tombs && typeof d.tombs === "object" ? d.tombs : {};
    function gone(x) {
      return !x || typeof x.id !== "string" ||
        (typeof tombs[x.id] === "number" &&
         tombs[x.id] >= Math.max(Number(x.m) || 0, Number(x.om) || 0));
    }
    function at(t) { if (wheel) t.wheel = wheel; return t; }
    var names = {}, members = arr(d.members).filter(function (m) { return !gone(m); });
    var tasks = arr(d.tasks).filter(function (k) { return !gone(k); });
    members.forEach(function (m) { names[m.id] = str(m.name); });
    tasks.forEach(function (k) {
      out.push({
        id: (wheel ? wheel + ":" : "") + k.id,
        title: str(k.name) || L["noname.task"],
        text: [freqText(k.freq, ctx.lang),
               arr(k.who).map(function (id) { return names[id] || ""; }).filter(Boolean).join(", ")]
          .filter(Boolean).join(" · "),
        target: at({ task: k.id })
      });
    });
    members.forEach(function (m) {
      out.push({
        id: (wheel ? wheel + ":" : "") + m.id,
        title: names[m.id] || L["noname.member"],
        text: tasks.filter(function (k) { return !arr(k.who).length || arr(k.who).indexOf(m.id) >= 0; })
          .map(function (k) { return str(k.name); }).filter(Boolean).join(", "),
        target: at({ member: m.id })
      });
    });
    return out;
  }

  if (typeof module !== "undefined" && module.exports) module.exports = PROVIDER;
  if (root && root.document) {
    var list = root.orosSearchProviders = root.orosSearchProviders || [];
    for (var i = 0; i < list.length; i++) if (list[i] && list[i].id === PROVIDER.id) return;
    list.push(PROVIDER);
  }
})(typeof window !== "undefined" ? window : globalThis);
