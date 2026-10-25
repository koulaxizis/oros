// ============================================================
// orOS Publishing — feed.js (Calendar feed + step names, v1.0.0)
// The Calendar (calendar/index.html loads publish/core.js and this
// file) shows, under the chip "Publishing" / «Εκδόσεις»:
//   - the release date of every title not out of print: "Release: …";
//   - every step of a title's release plan (wave P4) that is not done
//     yet, on its date: "Proofs 1 · …".
// Nothing is stored or synced by it; it only reads Publishing's own
// blob (synced slice "publish", key oros-publish-data). Publishing's
// editor uses the same step names.
//
// API (window.OrosPublishFeed):
//   byDay(data) → { "YYYY-MM-DD": [{ title, k, n, t, step? }] }
//   stage(k, n, lang) → the step's name ("Proofs 1", or n for own steps)
//   label(row, lang) → "Release: Title" | "Proofs 1 · Title"
// ============================================================
(function (root) {
  "use strict";

  var C = typeof module !== "undefined" && module.exports ? require("./core.js") : root.OrosPublishCore;

  // One flat { en, el } table (orosI18n pack "publish"; the Calendar
  // has no Publishing pack loaded, so a pack language reads English
  // there and the pack in Publishing itself).
  var TEXT = {
    en: {
      "stage.ms": "Manuscript in", "stage.ed": "Editing", "stage.p1": "Proofs 1", "stage.cov": "Cover ready",
      "stage.p2": "Proofs 2", "stage.isbn": "ISBN and barcode", "stage.p3": "Proofs 3", "stage.print": "To the printer",
      "stage.pres": "Presentation", "stage.x": "Step",
      "feed.rel": "Release: {t}", "feed.step": "{s} · {t}"
    },
    el: {
      "stage.ms": "Παράδοση χειρογράφου", "stage.ed": "Επιμέλεια", "stage.p1": "Διορθώσεις 1", "stage.cov": "Έτοιμο εξώφυλλο",
      "stage.p2": "Διορθώσεις 2", "stage.isbn": "ISBN και barcode", "stage.p3": "Διορθώσεις 3", "stage.print": "Στο τυπογραφείο",
      "stage.pres": "Παρουσίαση", "stage.x": "Βήμα",
      "feed.rel": "Κυκλοφορία: {t}", "feed.step": "{s} · {t}"
    }
  };
  function i18n() { return typeof window !== "undefined" && window.orosI18n; }
  function text(lang) {
    var I = i18n();
    if (I && I.known(lang) && !TEXT[lang]) I.table(TEXT, "publish", lang);
    return TEXT[lang] || TEXT.en;
  }
  function fill(s, vars) {
    Object.keys(vars).forEach(function (k) { s = s.split("{" + k + "}").join(String(vars[k])); });
    return s;
  }

  function byDay(data) {
    if (!C || !data || typeof data !== "object") return {};
    try { return C.byDay(C.normalize(data)); } catch (e) { return {}; }
  }
  function stage(k, n, lang) {
    if (n) return n;
    var tb = text(lang);
    return tb["stage." + k] || TEXT.en["stage." + k] || TEXT.en["stage.x"];
  }
  function label(row, lang) {
    var tb = text(lang);
    if (row.k === "rel") return fill(tb["feed.rel"], { t: row.t });
    return fill(tb["feed.step"], { s: stage(row.k, row.n, lang), t: row.t });
  }

  var API = { TEXT: TEXT, byDay: byDay, stage: stage, label: label };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  if (root) root.OrosPublishFeed = API;
})(typeof window !== "undefined" ? window : globalThis);
