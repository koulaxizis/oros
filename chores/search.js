// ============================================================
// orOS Chore Wheel — universal search provider (v1.0.0)
// Loaded by the shell on the first menu search (apps.json
// "search"). Read-only: reads oros-chores-data, never writes.
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
  var KEY = "oros-chores-data";
  var FREQ = {
    en: { d: "Every day", w: "Every week", mo: "Every month", n: "Every {n} days", wd: "On weekdays" },
    el: { d: "Κάθε μέρα", w: "Κάθε εβδομάδα", mo: "Κάθε μήνα", n: "Κάθε {n} μέρες", wd: "Συγκεκριμένες μέρες" }
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
    keys: [KEY],
    search: function (ctx) {
      var d = ctx.readJSON(KEY), out = [], el = ctx.lang === "el";
      if (!d || typeof d !== "object") return out;
      var tombs = d.tombs && typeof d.tombs === "object" ? d.tombs : {};
      function gone(x) {
        return !x || typeof x.id !== "string" ||
          (typeof tombs[x.id] === "number" &&
           tombs[x.id] >= Math.max(Number(x.m) || 0, Number(x.om) || 0));
      }
      var names = {}, members = arr(d.members).filter(function (m) { return !gone(m); });
      var tasks = arr(d.tasks).filter(function (k) { return !gone(k); });
      members.forEach(function (m) { names[m.id] = str(m.name); });
      tasks.forEach(function (k) {
        out.push({
          id: k.id,
          title: str(k.name) || (el ? "Δουλειά χωρίς όνομα" : "Unnamed chore"),
          text: [freqText(k.freq, ctx.lang),
                 arr(k.who).map(function (id) { return names[id] || ""; }).filter(Boolean).join(", ")]
            .filter(Boolean).join(" · "),
          target: { task: k.id }
        });
      });
      members.forEach(function (m) {
        out.push({
          id: m.id,
          title: names[m.id] || (el ? "Μέλος χωρίς όνομα" : "Unnamed member"),
          text: tasks.filter(function (k) { return !arr(k.who).length || arr(k.who).indexOf(m.id) >= 0; })
            .map(function (k) { return str(k.name); }).filter(Boolean).join(", "),
          target: { member: m.id }
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
