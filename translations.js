// ============================================================
// orOS Core v0 — Translations
// Inline i18n module (no fetch, no external files)
// Default language: English | Secondary: Greek
// Persisted via localStorage ('oros-lang'), overridable by ?lang=
// ============================================================

window.OROS_TRANSLATIONS = {

  en: {
    "app.name":           "orOS",
    "app.tagline":         "A static operating system in your browser",

    "bar.menu":            "Applications",
    "bar.clock.tooltip":   "Time (24h)",

    "lang.tooltip":        "Switch language",
    "theme.toLight":       "Switch to light mode",
    "theme.toDark":        "Switch to dark mode",

    "menu.title":          "Applications",
    "menu.empty":          "No applications installed",
    "menu.empty.hint":     "Apps will appear here as they are installed.",

    "running.home":        "Return to desktop",
    "running.back":        "Back",

    "skin.title":          "Appearance"
  },

  el: {
    "app.name":           "orOS",
    "app.tagline":         "Ένα στατικό λειτουργικό σύστημα στον browser",

    "bar.menu":            "Εφαρμογές",
    "bar.clock.tooltip":   "Ώρα (24ωρη)",

    "lang.tooltip":        "Αλλαγή γλώσσας",
    "theme.toLight":       "Μετάβαση σε φωτεινό θέμα",
    "theme.toDark":        "Μετάβαση σε σκοτεινό θέμα",

    "menu.title":          "Εφαρμογές",
    "menu.empty":          "Δεν υπάρχουν εγκατεστημένες εφαρμογές",
    "menu.empty.hint":     "Οι εφαρμογές θα εμφανιστούν εδώ μόλις εγκατασταθούν.",

    "running.home":        "Επιστροφή στην επιφάνεια εργασίας",
    "running.back":        "Πίσω",

    "skin.title":          "Εμφάνιση"
  }

};

// ============================================================
// i18n helper — t(key)
// Reads active language from window.orosLang (set by shell)
// Fallback chain: active → en → key itself (UI never breaks)
// ============================================================

window.t = function (key) {
  const lang = window.orosLang || "en";
  const pack = window.OROS_TRANSLATIONS[lang] || {};
  return pack[key] !== undefined ? pack[key]
       : (window.OROS_TRANSLATIONS.en[key] !== undefined
          ? window.OROS_TRANSLATIONS.en[key]
          : key);
};