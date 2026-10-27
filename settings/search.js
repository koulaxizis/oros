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

  // [section, topic]: the topic's title is "st.<topic>" and the words
  // that find it "st.<topic>.words", in the table below (German and
  // other languages from the "settings" pack).
  var TOPICS = [
    ["appearance", "theme"],
    ["appearance", "colour"],
    ["appearance", "wallpaper"],
    ["appearance", "seasonal"],
    ["appearance", "pet"],
    ["accessibility", "textsize"],
    ["accessibility", "contrast"],
    ["accessibility", "focus"],
    ["menu", "menuapps"],
    ["notifications", "notifs"],
    ["notifications", "quiet"],
    ["sync", "dropbox"],
    ["sync", "passphrase"],
    ["lock", "lock"],
    ["backup", "backups"],
    ["language", "language"],
    ["language", "menusearch"],
    ["language", "osk"],
    ["files", "files"],
    ["system", "version"],
    ["system", "shortcuts"],
    ["system", "multitask"],
    ["system", "reset"]
  ];
  var TOPIC_T = {
    en: { "st.theme": "Theme: dark or light",
          "st.theme.words": "dark light mode night",
          "st.colour": "System colour",
          "st.colour.words": "colour color accent skin palette",
          "st.wallpaper": "Wallpaper",
          "st.wallpaper.words": "background desktop picture",
          "st.seasonal": "Seasonal decorations",
          "st.seasonal.words": "christmas snow tree lights new year fireworks halloween pumpkin holiday festive easter carnival kites flag valentine epiphany may day",
          "st.pet": "Screen pet",
          "st.pet.words": "companion pet",
          "st.textsize": "Text size",
          "st.textsize.words": "bigger larger font zoom small text accessibility low vision",
          "st.contrast": "High contrast",
          "st.contrast.words": "contrast black white forced colors colours accessibility",
          "st.focus": "Focus ring",
          "st.focus.words": "keyboard tab outline focus accessibility",
          "st.menuapps": "Apps in the menu",
          "st.menuapps.words": "hide show hidden choose menu apps list",
          "st.notifs": "Notifications",
          "st.notifs.words": "pop-up toast sound volume position style",
          "st.quiet": "Quiet hours",
          "st.quiet.words": "silent night do not disturb",
          "st.dropbox": "Sync with Dropbox",
          "st.dropbox.words": "cloud connect encrypted devices",
          "st.passphrase": "Sync passphrase",
          "st.passphrase.words": "password unlock change forget",
          "st.backups": "Backups",
          "st.backups.words": "export import backup file folder restore",
          "st.language": "Language",
          "st.language.words": "english greek",
          "st.menusearch": "Menu search",
          "st.menusearch.words": "search find apps",
          "st.osk": "On-screen keyboard",
          "st.osk.words": "keyboard virtual touch type keys screen layout",
          "st.files": "Opening files",
          "st.files.words": "open with default app file type handler docx xlsx",
          "st.version": "Version and updates",
          "st.version.words": "update about install",
          "st.shortcuts": "Keyboard shortcuts",
          "st.shortcuts.words": "keys shortcut",
          "st.multitask": "Multitasking: keep apps open",
          "st.multitask.words": "multitasking windows switch apps side by side split background open",
          "st.reset": "Factory reset",
          "st.reset.words": "erase delete everything reset",
          "st.lock": "Screen lock",
          "st.lock.words": "lock pin passphrase screen idle away security" },
    el: { "st.theme": "Θέμα: σκοτεινό ή φωτεινό",
          "st.theme.words": "σκοτεινό φωτεινό λειτουργία νύχτα",
          "st.colour": "Χρώμα συστήματος",
          "st.colour.words": "χρώμα χρώματα παλέτα skin",
          "st.wallpaper": "Ταπετσαρία",
          "st.wallpaper.words": "φόντο επιφάνεια εργασίας εικόνα",
          "st.seasonal": "Θεματική διακόσμηση",
          "st.seasonal.words": "χριστούγεννα χιόνι δέντρο λαμπάκια καραβάκι πρωτοχρονιά πυροτεχνήματα halloween κολοκύθα γιορτές πάσχα απόκριες χαρταετοί σημαία θεοφάνια πρωτομαγιά βαλεντίνου",
          "st.pet": "Συντροφάκι",
          "st.pet.words": "κατοικίδιο σύντροφος",
          "st.textsize": "Μέγεθος κειμένου",
          "st.textsize.words": "μεγάλα γράμματα γραμματοσειρά μεγέθυνση ζουμ προσβασιμότητα όραση",
          "st.contrast": "Υψηλή αντίθεση",
          "st.contrast.words": "αντίθεση μαύρο άσπρο χρώματα προσβασιμότητα",
          "st.focus": "Περίγραμμα εστίασης",
          "st.focus.words": "πληκτρολόγιο tab περίγραμμα εστίαση προσβασιμότητα",
          "st.menuapps": "Εφαρμογές στο μενού",
          "st.menuapps.words": "απόκρυψη εμφάνιση κρυφές κρυμμένες επιλογή μενού λίστα",
          "st.notifs": "Ειδοποιήσεις",
          "st.notifs.words": "αναδυόμενα ήχος ένταση θέση στυλ",
          "st.quiet": "Ώρες ησυχίας",
          "st.quiet.words": "σίγαση νύχτα μην ενοχλείτε",
          "st.dropbox": "Συγχρονισμός με Dropbox",
          "st.dropbox.words": "cloud σύνδεση κρυπτογράφηση συσκευές",
          "st.passphrase": "Συνθηματικό συγχρονισμού",
          "st.passphrase.words": "κωδικός ξεκλείδωμα αλλαγή",
          "st.backups": "Αντίγραφα ασφαλείας",
          "st.backups.words": "εξαγωγή εισαγωγή αρχείο φάκελος επαναφορά",
          "st.language": "Γλώσσα",
          "st.language.words": "αγγλικά ελληνικά",
          "st.menusearch": "Αναζήτηση μενού",
          "st.menusearch.words": "αναζήτηση εύρεση εφαρμογές",
          "st.osk": "Πληκτρολόγιο οθόνης",
          "st.osk.words": "πληκτρολόγιο οθόνης αφή πληκτρολόγηση εικονικό διάταξη",
          "st.files": "Άνοιγμα αρχείων",
          "st.files.words": "άνοιγμα με προεπιλογή εφαρμογή τύπος αρχείου",
          "st.version": "Έκδοση και ενημερώσεις",
          "st.version.words": "ενημέρωση σχετικά εγκατάσταση",
          "st.shortcuts": "Συντομεύσεις πληκτρολογίου",
          "st.shortcuts.words": "πλήκτρα",
          "st.multitask": "Πολυεργασία: οι εφαρμογές μένουν ανοιχτές",
          "st.multitask.words": "πολυεργασία παράθυρα εναλλαγή δίπλα δίπλα παρασκήνιο ανοιχτές",
          "st.reset": "Επαναφορά εργοστασιακών",
          "st.reset.words": "διαγραφή σβήσιμο όλα",
          "st.lock": "Κλείδωμα οθόνης",
          "st.lock.words": "κλείδωμα κλειδωμα pin φράση κωδικός οθόνη αδράνεια ασφάλεια lock" }
  };


  var SECTION_NAME = {
    en: { appearance: "Appearance", accessibility: "Accessibility", menu: "Menu", notifications: "Notifications", sync: "Sync", lock: "Screen lock",
          backup: "Backups", language: "Language & search", files: "Opening files", system: "System" },
    el: { appearance: "Εμφάνιση", accessibility: "Προσβασιμότητα", menu: "Μενού", notifications: "Ειδοποιήσεις", sync: "Συγχρονισμός", lock: "Κλείδωμα οθόνης",
          backup: "Αντίγραφα ασφαλείας", language: "Γλώσσα και αναζήτηση", files: "Άνοιγμα αρχείων", system: "Σύστημα" }
  };

  // The two tables in language code: en / el here, another from the
  // "settings" pack (asked for once; until it arrives, English).
  var asked = {};
  function tables(code) {
    if (code === "en" || code === "el") {
      var o = {}, a = TOPIC_T[code], b = SECTION_NAME[code], k;
      for (k in a) o[k] = a[k];
      for (k in b) o[k] = b[k];
      return o;
    }
    var I = root && root.orosI18n;
    if (!I || !I.known(code)) return tables("en");
    if (!asked[code]) { asked[code] = 1; I.ensure(code, "settings", function () {}); }
    var out = {}, t1 = I.table(TOPIC_T, "settings", code), t2 = I.table(SECTION_NAME, "settings", code), j;
    for (j in t1) out[j] = t1[j];
    for (j in t2) out[j] = t2[j];
    return out;
  }

  var PROVIDER = {
    id: "settings",
    keys: [],
    topics: TOPICS,
    search: function (ctx) {
      var code = ctx.code || ctx.lang, L = tables(code);
      return TOPICS.map(function (tp, i) {
        var w = tp[1] + ".words";
        // section name first, then this language's words and the English
        // and Greek ones, so any of them finds it
        var words = [L["st." + w] || TOPIC_T.en["st." + w]];
        if (code !== "en") words.push(TOPIC_T.en["st." + w]);
        if (code !== "el") words.push(TOPIC_T.el["st." + w]);
        return {
          id: "t" + i,
          title: L["st." + tp[1]] || TOPIC_T.en["st." + tp[1]],
          text: (L[tp[0]] || SECTION_NAME.en[tp[0]]) + " · " + words.join(" "),
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
