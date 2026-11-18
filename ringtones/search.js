// ============================================================
// orOS Ringtone Composer — universal search provider (v1.0.0)
// Declared in apps.json as "search": "search.js"; the shell loads it
// on the first menu search, never at boot. READ-ONLY: it reads
// oros-ringtones-data and never writes. One hit per saved melody (a
// melody a tombstone covers is left out): its name as title ("Untitled
// melody" when it has none), the last edit as `when`. Opens through
// the generic deep link __orosOpenAt("ringtones", { melody: id }): the
// melody on the staff, ready to play.
// Self-contained (RingtonesCore is not loaded in the shell).
// ============================================================
(function (root) {
  "use strict";
  var KEY = "oros-ringtones-data";
  var ID_RE = /^r[a-z0-9]{6,20}$/;
  // The app's own placeholder ("f.name.ph"): en/el inline, other
  // languages through the ringtones pack when the shell has it.
  var STR = {
    en: { "f.name.ph": "Untitled melody" },
    el: { "f.name.ph": "Μελωδία χωρίς όνομα" }
  };
  function noName(ctx) {
    var I = root && root.orosI18n, l = ctx.lang === "el" ? "el" : "en";
    if (I && l !== "el") { try { l = I.lang(); } catch (e) {} }
    if (l === "el" || l === "en" || !I) return STR[l === "el" ? "el" : "en"]["f.name.ph"];
    try { return I.table(STR, "ringtones", l)["f.name.ph"] || STR.en["f.name.ph"]; }
    catch (e) { return STR.en["f.name.ph"]; }
  }
  function one(s) { return typeof s === "string" ? s.replace(/[\u0000-\u001f\u007f\u2028\u2029]+/g, " ").replace(/\s+/g, " ").trim() : ""; }

  var PROVIDER = {
    id: "ringtones",
    keys: [KEY],
    // ctx = { q, words, fold, lang, limit, readJSON(key) }
    search: function (ctx) {
      var d = ctx.readJSON(KEY);
      if (!d || !Array.isArray(d.melodies)) return [];
      var tombs = d.tombs && typeof d.tombs === "object" ? d.tombs : {};
      var seen = {}, fallback = null;
      return d.melodies.filter(function (x) {
        if (!x || typeof x.id !== "string" || !ID_RE.test(x.id) || typeof x.notes !== "string" || !x.notes.trim()) return false;
        if (typeof x.m !== "number" || tombs[x.id] >= x.m || seen[x.id]) return false;
        seen[x.id] = 1;
        return true;
      }).map(function (x) {
        var name = one(x.name);
        if (!name) name = fallback || (fallback = noName(ctx));
        return { id: x.id, title: name.slice(0, 80), text: "", when: x.m, target: { melody: x.id } };
      });
    }
  };

  if (typeof module !== "undefined" && module.exports) module.exports = PROVIDER;
  if (root && root.document) {
    var list = root.orosSearchProviders = root.orosSearchProviders || [];
    for (var i = 0; i < list.length; i++) if (list[i] && list[i].id === PROVIDER.id) return;
    list.push(PROVIDER);
  }
})(typeof window !== "undefined" ? window : globalThis);
