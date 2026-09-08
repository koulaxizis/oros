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

    "skin.title":          "Appearance",

    "install.trigger":     "Install orOS",

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
    "sync.working":         "Syncing…",
    "sync.ok.pull":         "Data pulled from cloud",
    "sync.ok.push":         "Data pushed to cloud",
    "sync.ok.empty":        "Nothing in the cloud yet",
    "sync.slices.applied":  "sections updated",
    "sync.err.notconnected":"Not connected to Dropbox",
    "sync.err.nopass":      "Enter your passphrase first",
    "sync.err.version":     "Cloud data uses an unsupported version",
    "sync.err.auth":        "Dropbox authorization failed — reconnect",
    "sync.err.generic":     "Sync failed — check your connection",
	"update.available":    "A new version of orOS is ready.",
    "update.reload":       "Update",
	"sync.pass.show":      "Show passphrase",
	"sync.pass.remember":  "Remember on this device",
    "sync.pass.device":     "Forget on this device",
    "sync.ok.unlocked":     "Unlocked — ready to sync",
	"sync.interval.label":   "Auto-sync every",
    "sync.interval.off":     "Off",
    "sync.interval.minutes": "min",
    "update.action":         "Update orOS"
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

    "skin.title":          "Εμφάνιση",

    "install.trigger":     "Εγκατάσταση του orOS",

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
    "sync.working":         "Συγχρονισμός…",
    "sync.ok.pull":         "Τα δεδομένα ελήφθησαν από το cloud",
    "sync.ok.push":         "Τα δεδομένα στάλθηκαν στο cloud",
    "sync.ok.empty":        "Δεν υπάρχει τίποτα στο cloud ακόμα",
    "sync.slices.applied":  "ενότητες ενημερώθηκαν",
    "sync.err.notconnected":"Δεν υπάρχει σύνδεση με Dropbox",
    "sync.err.nopass":      "Δώσε πρώτα τον κωδικό σου",
    "sync.err.version":     "Τα δεδομένα του cloud χρησιμοποιούν μη υποστηριζόμενη έκδοση",
    "sync.err.auth":        "Η εξουσιοδότηση Dropbox απέτυχε — επανασύνδεση",
    "sync.err.generic":     "Ο συγχρονισμός απέτυχε — έλεγξε τη σύνδεσή σου",
	"update.available":    "Μια νέα έκδοση του orOS είναι έτοιμη.",
    "update.reload":       "Ανανέωση",
	"sync.pass.show":      "Εμφάνιση κωδικού",
	"sync.pass.remember":  "Απομνημόνευση σε αυτή τη συσκευή",
    "sync.pass.device":     "Διαγραφή από αυτή τη συσκευή",
    "sync.ok.unlocked":     "Ξεκλείδωμα — έτοιμο για συγχρονισμό",
	"sync.interval.label":   "Αυτόματος συγχρονισμός κάθε",
    "sync.interval.off":     "Ανενεργό",
    "sync.interval.minutes": "λεπτά",
    "update.action":         "Ενημέρωση του orOS"
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