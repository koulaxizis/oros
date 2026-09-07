// ============================================================
// orOS Core v0 — Translations
// Inline i18n module (no fetch, no external files)
// Default language: English | Secondary: Greek
// Persisted via localStorage ('oros-lang'), overridable by ?lang=
// ============================================================

window.OROS_TRANSLATIONS = {

  en: {
    // --- Shell ---
    "app.name":            "orOS",
    "app.tagline":         "A static operating system in your browser",

    // --- Top bar ---
    "bar.menu":            "Applications",
    "bar.clock.tooltip":   "Time (24h)",
    "bar.date.tooltip":    "Date",

    // --- Theme toggle ---
    "theme.toLight":       "Switch to light mode",
    "theme.toDark":        "Switch to dark mode",

    // --- Language toggle ---
    "lang.switch":         "Ελληνικά",

    // --- App menu ---
    "menu.title":          "Applications",
    "menu.empty":          "No applications installed",
    "menu.empty.hint":     "Apps will appear here as they are installed.",

    // --- Running app view ---
    "running.home":        "Return to desktop",
    "running.back":        "Back",

    // --- Footer (desktop) ---
    "footer.designedBy":   "Designed by Christos Koulaxizis",
    "footer.noCookies":    "No cookies · No tracking · Open source"
  },

  el: {
    // --- Shell ---
    "app.name":            "orOS",
    "app.tagline":         "Ένα στατικό λειτουργικό σύστημα στον browser",

    // --- Top bar ---
    "bar.menu":            "Εφαρμογές",
    "bar.clock.tooltip":   "Ώρα (24ωρη)",
    "bar.date.tooltip":    "Ημερομηνία",

    // --- Theme toggle ---
    "theme.toLight":       "Μετάβαση σε φωτεινό θέμα",
    "theme.toDark":        "Μετάβαση σε σκοτεινό θέμα",

    // --- Language toggle ---
    "lang.switch":         "English",

    // --- App menu ---
    "menu.title":          "Εφαρμογές",
    "menu.empty":          "Δεν υπάρχουν εγκατεστημένες εφαρμογές",
    "menu.empty.hint":     "Οι εφαρμογές θα εμφανιστούν εδώ μόλις εγκατασταθούν.",

    // --- Running app view ---
    "running.home":        "Επιστροφή στην επιφάνεια εργασίας",
    "running.back":        "Πίσω",

    // --- Footer (desktop) ---
    "footer.designedBy":   "Σχεδιασμένο από τον Christos Koulaxizis",
    "footer.noCookies":    "Χωρίς cookies · Χωρίς tracking · Ανοιχτού κώδικα"
  }

};

// ============================================================
// i18n helper — t(key)
// Reads active language from window.orosLang (set by shell)
// Falls back: active → en → key itself (so UI never breaks)
// ============================================================

window.t = function (key) {
  const lang = window.orosLang || "en";
  const pack = window.OROS_TRANSLATIONS[lang] || {};
  return pack[key] !== undefined ? pack[key]
       : (window.OROS_TRANSLATIONS.en[key] !== undefined
          ? window.OROS_TRANSLATIONS.en[key]
          : key);
};