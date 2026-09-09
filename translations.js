// ============================================================
// orOS Core v0.6.2 — Translations
// Inline i18n module (no fetch, no external files)
// Default language: English | Secondary: Greek
// Persisted via localStorage ('oros-lang'), overridable by ?lang=
// ============================================================

window.OROS_TRANSLATIONS = {

  en: {
    "bar.menu":            "orOS",
    "bar.clock.tooltip":   "Time (24h)",

    "lang.tooltip":        "Switch language",
    "theme.toLight":       "Switch to light mode",
    "theme.toDark":        "Switch to dark mode",

    "menu.title":          "Applications",
    "menu.empty":          "No applications installed",
    "menu.empty.hint":     "Apps will appear here as they are installed.",
    "category.productivity": "Productivity",

    "running.home":        "Return to desktop",
    "running.back":        "Back",

    "skin.title":          "Appearance",
    "wallpaper.title":     "Wallpaper",

    "install.trigger":     "Install orOS",
    "update.done":         "orOS was updated to",

    "sync.title":          "Sync",
    "sync.connected":      "Connected",
    "sync.disconnected":   "Not connected",
    "sync.connect":         "Connect Dropbox",
    "sync.disconnect":      "Disconnect",
    "sync.pull":            "Pull from cloud",
    "sync.push":            "Push to cloud",
    "sync.pass.label":      "Encryption passphrase",
    "sync.pass.placeholder":"Type your passphrase…",
    "sync.pass.first.hint": "First time? This passphrase encrypts your data — it never leaves this device, and Dropbox can't read your data without it. Remember it: it cannot be recovered.",
    "sync.pass.apply":      "Unlock",
    "sync.pass.forget":     "Forget passphrase",
    "sync.pass.device":     "Forget on this device",
    "sync.pass.remember":   "Remember on this device",
    "sync.pass.show":       "Show passphrase",
    "sync.working":         "Syncing…",
    "sync.ok.pull":         "Data pulled from cloud",
    "sync.ok.push":         "Data pushed to cloud",
    "sync.ok.empty":        "Nothing in the cloud yet",
    "sync.ok.export":       "Data exported to file",
    "sync.ok.import":       "Data imported",
    "sync.slices.applied":  "sections updated",
    "sync.export":          "Export data",
    "sync.import":          "Import data",
    "sync.backup.hint":    "Local backup is not encrypted — store it somewhere safe.",
    "sync.interval.label":   "Auto-sync every",
    "sync.interval.off":     "Off",
    "sync.interval.minutes": "min",
    "sync.err.notconnected":"Not connected to Dropbox",
    "sync.err.nopass":      "Enter your passphrase first",
    "sync.err.version":     "Cloud data uses an unsupported version",
    "sync.err.auth":        "Dropbox authorization failed — reconnect",
    "sync.err.generic":     "Sync failed — check your connection"
  },

  el: {
    "bar.menu":            "orOS",
    "bar.clock.tooltip":   "Ώρα (24ωρη)",

    "lang.tooltip":        "Αλλαγή γλώσσας",
    "theme.toLight":       "Μετάβαση σε φωτεινό θέμα",
    "theme.toDark":        "Μετάβαση σε σκοτεινό θέμα",

    "menu.title":          "Εφαρμογές",
    "menu.empty":          "Δεν υπάρχουν εγκατεστημένες εφαρμογές",
    "menu.empty.hint":     "Οι εφαρμογές θα εμφανιστούν εδώ μόλις εγκατασταθούν.",
    "category.productivity": "Παραγωγικότητα",

    "running.home":        "Επιστροφή στην επιφάνεια εργασίας",
    "running.back":        "Πίσω",

    "skin.title":          "Εμφάνιση",
    "wallpaper.title":     "Ταπετσαρία",

    "install.trigger":     "Εγκατάσταση του orOS",
    "update.done":         "Το orOS ενημερώθηκε στην",

    "sync.title":          "Συγχρονισμός",
    "sync.connected":      "Συνδεδεμένο",
    "sync.disconnected":   "Μη συνδεδεμένο",
    "sync.connect":         "Σύνδεση με Dropbox",
    "sync.disconnect":      "Αποσύνδεση",
    "sync.pull":            "Λήψη από το cloud",
    "sync.push":            "Αποστολή στο cloud",
    "sync.pass.label":      "Κωδικός κρυπτογράφησης",
    "sync.pass.placeholder":"Πληκτρολόγησε τον κωδικό σου…",
    "sync.pass.first.hint": "Πρώτη φορά; Αυτός ο κωδικός κρυπτογραφεί τα δεδομένα σου — δεν φεύγει ποτέ από τη συσκευή σου και η Dropbox δεν μπορεί να διαβάσει τα δεδομένα χωρίς αυτόν. Φρόντισε να τον θυμάσαι: δεν μπορεί να ανακτηθεί.",
    "sync.pass.apply":      "Ξεκλείδωμα",
    "sync.pass.forget":     "Διαγραφή κωδικού",
    "sync.pass.device":     "Διαγραφή από αυτή τη συσκευή",
    "sync.pass.remember":   "Απομνημόνευση σε αυτή τη συσκευή",
    "sync.pass.show":      "Εμφάνιση κωδικού",
    "sync.working":         "Συγχρονισμός…",
    "sync.ok.pull":         "Τα δεδομένα ελήφθησαν από το cloud",
    "sync.ok.push":         "Τα δεδομένα στάλθηκαν στο cloud",
    "sync.ok.empty":        "Δεν υπάρχει τίποτα στο cloud ακόμα",
    "sync.ok.export":       "Τα δεδομένα εξήχθησαν σε αρχείο",
    "sync.ok.import":      "Τα δεδομένα εισήχθησαν",
    "sync.slices.applied":  "ενότητες ενημερώθηκαν",
    "sync.export":          "Εξαγωγή δεδομένων",
    "sync.import":          "Εισαγωγή δεδομένων",
    "sync.backup.hint":    "Το τοπικό αντίγραφο δεν είναι κρυπτογραφημένο — φύλαξέ το σε ασφαλές μέρος.",
    "sync.interval.label":   "Αυτόματος συγχρονισμός κάθε",
    "sync.interval.off":     "Ανενεργό",
    "sync.interval.minutes": "λεπτά",
    "sync.err.notconnected":"Δεν υπάρχει σύνδεση με Dropbox",
    "sync.err.nopass":      "Δώσε πρώτα τον κωδικό σου",
    "sync.err.version":     "Τα δεδομένα του cloud χρησιμοποιούν μη υποστηριζόμενη έκδοση",
    "sync.err.auth":        "Η εξουσιοδότηση Dropbox απέτυχε — επανασύνδεση",
    "sync.err.generic":     "Ο συγχρονισμός απέτυχε — έλεγξε τη σύνδεσή σου"
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