// ============================================================
// orOS Settings — universal search provider (v1.0.0)
// Loaded by the shell on the first menu search (apps.json
// "search"). Reads no storage: it answers from a fixed list of
// settings, so typing "dark", "wallpaper" or "συνθηματικό" in the
// menu finds the setting. Opens through the generic deep link:
// target { section }.
// ============================================================
(function (root) {
  "use strict";

  // section, English title + words, Greek title + words
  var TOPICS = [
    ["appearance", "Theme: dark or light", "dark light mode night",
                   "Θέμα: σκοτεινό ή φωτεινό", "σκοτεινό φωτεινό λειτουργία νύχτα"],
    ["appearance", "System colour", "colour color accent skin palette",
                   "Χρώμα συστήματος", "χρώμα χρώματα παλέτα skin"],
    ["appearance", "Wallpaper", "background desktop picture",
                   "Ταπετσαρία", "φόντο επιφάνεια εργασίας εικόνα"],
    ["appearance", "Screen pet", "companion pet",
                   "Συντροφάκι", "κατοικίδιο σύντροφος"],
    ["notifications", "Notifications", "pop-up toast sound volume position style",
                      "Ειδοποιήσεις", "αναδυόμενα ήχος ένταση θέση στυλ"],
    ["notifications", "Quiet hours", "silent night do not disturb",
                      "Ώρες ησυχίας", "σίγαση νύχτα μην ενοχλείτε"],
    ["sync", "Sync with Dropbox", "cloud connect encrypted devices",
             "Συγχρονισμός με Dropbox", "cloud σύνδεση κρυπτογράφηση συσκευές"],
    ["sync", "Sync passphrase", "password unlock change forget",
             "Συνθηματικό συγχρονισμού", "κωδικός ξεκλείδωμα αλλαγή"],
    ["backup", "Backups", "export import backup file folder restore",
               "Αντίγραφα ασφαλείας", "εξαγωγή εισαγωγή αρχείο φάκελος επαναφορά"],
    ["language", "Language", "english greek",
                 "Γλώσσα", "αγγλικά ελληνικά"],
    ["language", "Menu search", "search find apps",
                 "Αναζήτηση μενού", "αναζήτηση εύρεση εφαρμογές"],
    ["system", "Version and updates", "update about install",
               "Έκδοση και ενημερώσεις", "ενημέρωση σχετικά εγκατάσταση"],
    ["system", "Keyboard shortcuts", "keys shortcut",
               "Συντομεύσεις πληκτρολογίου", "πλήκτρα"],
    ["system", "Factory reset", "erase delete everything reset",
               "Επαναφορά εργοστασιακών", "διαγραφή σβήσιμο όλα"]
  ];

  var SECTION_NAME = {
    en: { appearance: "Appearance", notifications: "Notifications", sync: "Sync",
          backup: "Backups", language: "Language & search", system: "System" },
    el: { appearance: "Εμφάνιση", notifications: "Ειδοποιήσεις", sync: "Συγχρονισμός",
          backup: "Αντίγραφα ασφαλείας", language: "Γλώσσα και αναζήτηση", system: "Σύστημα" }
  };

  var PROVIDER = {
    id: "settings",
    keys: [],
    topics: TOPICS,
    search: function (ctx) {
      var el = ctx.lang === "el";
      return TOPICS.map(function (tp, i) {
        return {
          id: "t" + i,
          title: el ? tp[3] : tp[1],
          // section name first, then both languages' words, so either finds it
          text: SECTION_NAME[el ? "el" : "en"][tp[0]] + " · " +
                (el ? tp[4] + " " + tp[2] : tp[2] + " " + tp[4]),
          target: { section: tp[0] }
        };
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
