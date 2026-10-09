// ============================================================
// orOS Settings — pure helpers (settings/core.js)
// No DOM, no storage: strings, the section list, which settings
// travel to every device, and small formatters. Shared by the app
// (window.SettingsCore) and node tests (module.exports).
// ============================================================
(function (root) {
  "use strict";

  // The groups, in the order shown. A deep link names one of these.
  var SECTIONS = ["appearance", "notifications", "sync", "backup", "language", "system"];

  // Where each setting lives: "all" = travels to every device through
  // sync, "device" = this device only. Mirrors the shell: lang, theme,
  // skin, wallpaper, syncInterval, autoexport ride in the shell slice;
  // the pet switch in the pet slice; notifications in the notifs slice;
  // search switches, backup folder and passphrase stay on the device.
  var SCOPE = {
    theme: "all", skin: "all", wallpaper: "all", pet: "all",
    notifications: "all", syncInterval: "all", autoexport: "all", lang: "all",
    folder: "device", search: "device", passphrase: "device"
  };

  var POSITIONS = ["top-left", "top", "top-right", "right",
                   "bottom-right", "bottom", "bottom-left", "left"];
  var STYLES = ["oros", "dunst", "plasma", "gnome"];
  var SOUNDS = ["none", "bell", "ding", "chime"];
  var DURATIONS = [2000, 5000, 8000, 12000];

  var STRINGS = {
    en: {
      "app": "Settings", "back": "Back", "sections": "Settings sections",
      "scope.all": "All devices", "scope.device": "This device",
      "scope.all.title": "Syncs to all your devices",
      "scope.device.title": "Applies to this device only",
      "on": "On", "off": "Off",
      "noShell": "Open Settings from the orOS menu: it needs the orOS desktop around it.",

      "s.appearance": "Appearance", "s.notifications": "Notifications", "s.sync": "Sync",
      "s.backup": "Backups", "s.language": "Language & search", "s.system": "System",
      "d.appearance": "Theme, colours, wallpaper, screen pet",
      "d.notifications": "Pop-ups, sound, quiet hours, per app",
      "d.sync": "Encrypted sync through Dropbox",
      "d.backup": "Backup files and the backup folder",
      "d.language": "Language and what the menu search looks in",
      "d.system": "Version, shortcuts, about, factory reset",

      "a.theme": "Theme", "a.dark": "Dark", "a.light": "Light",
      "a.skin": "System colour", "a.wallpaper": "Wallpaper",
      "a.wallpaper.make": "Make your own in Wallpaper Generator",
      "a.pet": "Screen pet",
      "a.pet.hint": "A tiny companion on your desktop. Feed it, pet it, let it sleep.",

      "n.enabled": "Notifications", "n.test": "Send a test",
      "n.test.title": "Test notification", "n.test.body": "This is how notifications look.",
      "n.position": "Position on screen", "n.style": "Style", "n.sound": "Sound",
      "n.volume": "Volume", "n.duration": "Stays on screen",
      "n.quiet": "Quiet hours", "n.quiet.hint": "No pop-ups or sounds in these hours. Notifications still wait in the bell.",
      "n.from": "From", "n.to": "To", "n.apps": "Which apps may notify",
      "n.pos.top-left": "Top left", "n.pos.top": "Top", "n.pos.top-right": "Top right",
      "n.pos.right": "Right", "n.pos.bottom-right": "Bottom right", "n.pos.bottom": "Bottom",
      "n.pos.bottom-left": "Bottom left", "n.pos.left": "Left",
      "n.sound.none": "None", "n.sound.bell": "Bell", "n.sound.ding": "Ding", "n.sound.chime": "Chime",
      "n.none": "Notifications are not available in this orOS version.",

      "y.status.off": "Not connected. Your data lives only on this device.",
      "y.status.locked": "Connected, locked. Enter your passphrase to sync this device.",
      "y.status.on": "Connected and syncing",
      "y.status.dirty": "Changes waiting to upload",
      "y.connect": "Connect to Dropbox",
      "y.connect.hint": "Everything is encrypted on this device with your passphrase before it leaves. Dropbox sees only unreadable files.",
      "y.pass": "Passphrase", "y.pass.ph": "Your sync passphrase",
      "y.pass.show": "Show passphrase", "y.pass.hide": "Hide passphrase",
      "y.pass.hint": "First time? Pick one of at least {n} characters and keep it safe: nobody can recover it.",
      "y.remember": "Remember on this device", "y.unlock": "Unlock",
      "y.pull": "Get from cloud", "y.push": "Send to cloud",
      "y.interval": "Sync automatically", "y.interval.off": "Off", "y.interval.min": "every {n} min", "y.interval.one": "every minute",
      "y.changePass": "Change passphrase",
      "y.forget": "Forget passphrase here", "y.forgetVault": "Forget this device",
      "y.disconnect": "Disconnect",
      "y.disconnect.confirm": "Tap again to disconnect",

      "b.auto": "Automatic backup", "b.auto.off": "Off", "b.auto.daily": "Daily",
      "b.auto.weekly": "Weekly", "b.auto.monthly": "Monthly",
      "b.folder": "Backup folder", "b.folder.none": "No folder chosen",
      "b.folder.choose": "Choose folder", "b.folder.stop": "Stop using it",
      "b.folder.reconnect": "Allow again", "b.folder.lapsed": "The browser needs your permission again.",
      "b.folder.hint": "orOS writes a backup file into this folder on the schedule above.",
      "b.noFolder": "This browser cannot save to a folder by itself. Export a backup file now and then.",
      "b.now": "Back up now", "b.export": "Export backup file", "b.import": "Import backup file",
      "b.hint": "A backup file is NOT encrypted. Keep it somewhere safe.",

      "l.lang": "Language", "l.search": "Menu search looks in",
      "l.search.hint": "The search field at the top of the menu also finds text inside these apps.",
      "l.search.none": "No app offers search yet.",

      "x.version": "orOS version", "x.updates": "Check for updates",
      "x.install": "Install orOS as an app", "x.install.hint": "Opens in its own window, works offline, starts from your home screen.",
      "x.shortcuts": "Keyboard shortcuts", "x.more": "More",
      "x.device": "Device info", "x.about": "About orOS, credits and licences",
      "x.apps": "Settings inside apps", "x.weather": "Weather on the taskbar",
      "x.wallgen": "Wallpaper Generator",
      "x.reset": "Factory reset", "x.reset.confirm": "Tap again to erase everything",
      "x.reset.hint": "Permanent: erases all orOS data and settings on this device, the backups in the backup folder, all cloud data and cloud backups, and this device's Dropbox sign-in, then starts orOS like new. Repeat on your other devices. Export a backup file first if you may need anything.",
      "x.reset.working": "Erasing…"
    },
    el: {
      "app": "Ρυθμίσεις", "back": "Πίσω", "sections": "Ενότητες ρυθμίσεων",
      "scope.all": "Όλες οι συσκευές", "scope.device": "Αυτή η συσκευή",
      "scope.all.title": "Συγχρονίζεται σε όλες τις συσκευές σου",
      "scope.device.title": "Ισχύει μόνο σε αυτή τη συσκευή",
      "on": "Ναι", "off": "Όχι",
      "noShell": "Άνοιξε τις Ρυθμίσεις από το μενού του orOS: χρειάζονται την επιφάνεια εργασίας του orOS γύρω τους.",

      "s.appearance": "Εμφάνιση", "s.notifications": "Ειδοποιήσεις", "s.sync": "Συγχρονισμός",
      "s.backup": "Αντίγραφα ασφαλείας", "s.language": "Γλώσσα και αναζήτηση", "s.system": "Σύστημα",
      "d.appearance": "Θέμα, χρώματα, ταπετσαρία, συντροφάκι",
      "d.notifications": "Αναδυόμενα, ήχος, ώρες ησυχίας, ανά εφαρμογή",
      "d.sync": "Κρυπτογραφημένος συγχρονισμός μέσω Dropbox",
      "d.backup": "Αρχεία αντιγράφων και φάκελος αντιγράφων",
      "d.language": "Γλώσσα και πού ψάχνει η αναζήτηση του μενού",
      "d.system": "Έκδοση, συντομεύσεις, σχετικά, επαναφορά",

      "a.theme": "Θέμα", "a.dark": "Σκοτεινό", "a.light": "Φωτεινό",
      "a.skin": "Χρώμα συστήματος", "a.wallpaper": "Ταπετσαρία",
      "a.wallpaper.make": "Φτιάξε τη δική σου στη Γεννήτρια ταπετσαρίας",
      "a.pet": "Συντροφάκι",
      "a.pet.hint": "Ένας μικρός σύντροφος στην επιφάνεια εργασίας. Τάισέ το, χάιδεψέ το, άφησέ το να κοιμηθεί.",

      "n.enabled": "Ειδοποιήσεις", "n.test": "Δοκιμαστική",
      "n.test.title": "Δοκιμαστική ειδοποίηση", "n.test.body": "Έτσι φαίνονται οι ειδοποιήσεις.",
      "n.position": "Θέση στην οθόνη", "n.style": "Στυλ", "n.sound": "Ήχος",
      "n.volume": "Ένταση", "n.duration": "Μένει στην οθόνη",
      "n.quiet": "Ώρες ησυχίας", "n.quiet.hint": "Χωρίς αναδυόμενα και ήχους αυτές τις ώρες. Οι ειδοποιήσεις περιμένουν στο καμπανάκι.",
      "n.from": "Από", "n.to": "Έως", "n.apps": "Ποιες εφαρμογές ειδοποιούν",
      "n.pos.top-left": "Πάνω αριστερά", "n.pos.top": "Πάνω", "n.pos.top-right": "Πάνω δεξιά",
      "n.pos.right": "Δεξιά", "n.pos.bottom-right": "Κάτω δεξιά", "n.pos.bottom": "Κάτω",
      "n.pos.bottom-left": "Κάτω αριστερά", "n.pos.left": "Αριστερά",
      "n.sound.none": "Κανένας", "n.sound.bell": "Καμπάνα", "n.sound.ding": "Ντινγκ", "n.sound.chime": "Κουδουνάκι",
      "n.none": "Οι ειδοποιήσεις δεν υπάρχουν σε αυτή την έκδοση του orOS.",

      "y.status.off": "Χωρίς σύνδεση. Τα δεδομένα σου υπάρχουν μόνο σε αυτή τη συσκευή.",
      "y.status.locked": "Συνδεδεμένο, κλειδωμένο. Γράψε το συνθηματικό για να συγχρονιστεί αυτή η συσκευή.",
      "y.status.on": "Συνδεδεμένο, συγχρονίζεται",
      "y.status.dirty": "Αλλαγές περιμένουν να ανέβουν",
      "y.connect": "Σύνδεση με Dropbox",
      "y.connect.hint": "Όλα κρυπτογραφούνται σε αυτή τη συσκευή με το συνθηματικό σου πριν φύγουν. Το Dropbox βλέπει μόνο αρχεία που δεν διαβάζονται.",
      "y.pass": "Συνθηματικό", "y.pass.ph": "Το συνθηματικό συγχρονισμού",
      "y.pass.show": "Εμφάνιση συνθηματικού", "y.pass.hide": "Απόκρυψη συνθηματικού",
      "y.pass.hint": "Πρώτη φορά; Διάλεξε ένα με τουλάχιστον {n} χαρακτήρες και φύλαξέ το: δεν ανακτάται από κανέναν.",
      "y.remember": "Να το θυμάται αυτή η συσκευή", "y.unlock": "Ξεκλείδωμα",
      "y.pull": "Λήψη από το cloud", "y.push": "Αποστολή στο cloud",
      "y.interval": "Αυτόματος συγχρονισμός", "y.interval.off": "Ανενεργός", "y.interval.min": "κάθε {n} λεπτά", "y.interval.one": "κάθε λεπτό",
      "y.changePass": "Αλλαγή συνθηματικού",
      "y.forget": "Ξέχασε εδώ το συνθηματικό", "y.forgetVault": "Ξέχασε αυτή τη συσκευή",
      "y.disconnect": "Αποσύνδεση",
      "y.disconnect.confirm": "Πάτα ξανά για αποσύνδεση",

      "b.auto": "Αυτόματο αντίγραφο", "b.auto.off": "Ανενεργό", "b.auto.daily": "Καθημερινά",
      "b.auto.weekly": "Κάθε εβδομάδα", "b.auto.monthly": "Κάθε μήνα",
      "b.folder": "Φάκελος αντιγράφων", "b.folder.none": "Δεν έχει επιλεγεί φάκελος",
      "b.folder.choose": "Επιλογή φακέλου", "b.folder.stop": "Διακοπή χρήσης",
      "b.folder.reconnect": "Νέα άδεια", "b.folder.lapsed": "Ο browser θέλει ξανά την άδειά σου.",
      "b.folder.hint": "Το orOS γράφει αρχείο αντιγράφου σε αυτόν τον φάκελο με τη συχνότητα που διάλεξες πάνω.",
      "b.noFolder": "Αυτός ο browser δεν μπορεί να γράφει μόνος του σε φάκελο. Κάνε πού και πού εξαγωγή αρχείου.",
      "b.now": "Αντίγραφο τώρα", "b.export": "Εξαγωγή αρχείου αντιγράφου", "b.import": "Εισαγωγή αρχείου αντιγράφου",
      "b.hint": "Το αρχείο αντιγράφου ΔΕΝ είναι κρυπτογραφημένο. Φύλαξέ το σε ασφαλές μέρος.",

      "l.lang": "Γλώσσα", "l.search": "Η αναζήτηση του μενού ψάχνει σε",
      "l.search.hint": "Το πεδίο αναζήτησης στην κορυφή του μενού βρίσκει και κείμενο μέσα σε αυτές τις εφαρμογές.",
      "l.search.none": "Καμία εφαρμογή δεν προσφέρει ακόμα αναζήτηση.",

      "x.version": "Έκδοση orOS", "x.updates": "Έλεγχος για ενημέρωση",
      "x.install": "Εγκατάσταση του orOS ως εφαρμογή", "x.install.hint": "Ανοίγει σε δικό του παράθυρο, δουλεύει offline, ξεκινά από την αρχική οθόνη.",
      "x.shortcuts": "Συντομεύσεις πληκτρολογίου", "x.more": "Περισσότερα",
      "x.device": "Πληροφορίες συσκευής", "x.about": "Σχετικά με το orOS, credits και άδειες",
      "x.apps": "Ρυθμίσεις μέσα σε εφαρμογές", "x.weather": "Ο καιρός στη γραμμή εργασιών",
      "x.wallgen": "Γεννήτρια ταπετσαρίας",
      "x.reset": "Επαναφορά εργοστασιακών", "x.reset.confirm": "Πάτα ξανά για να σβηστούν όλα",
      "x.reset.hint": "Οριστικό: σβήνει όλα τα δεδομένα και τις ρυθμίσεις του orOS σε αυτή τη συσκευή, τα αντίγραφα στον φάκελο αντιγράφων, όλα τα δεδομένα και τα αντίγραφα στο cloud, και τη σύνδεση Dropbox αυτής της συσκευής, και ξεκινά το orOS σαν καινούργιο. Επανάλαβε στις άλλες συσκευές σου. Κάνε πρώτα εξαγωγή αρχείου αν μπορεί να χρειαστείς κάτι.",
      "x.reset.working": "Σβήνονται…"
    }
  };

  function langOf(v) { return v === "el" ? "el" : "en"; }

  function t(lang, key, vars) {
    var s = STRINGS[langOf(lang)][key];
    if (s === undefined) s = STRINGS.en[key];
    if (s === undefined) return key;
    if (vars) {
      Object.keys(vars).forEach(function (k) {
        s = s.split("{" + k + "}").join(String(vars[k]));
      });
    }
    return s;
  }

  function isSection(id) { return SECTIONS.indexOf(id) !== -1; }

  // A deep-link target ({ section }) or a stored id → a known section,
  // else null. Never trusts the shape it is given.
  function sectionOf(target) {
    var id = (target && typeof target === "object") ? target.section : target;
    return (typeof id === "string" && isSection(id)) ? id : null;
  }

  function scopeOf(name) { return SCOPE[name] || "device"; }

  function pad2(n) { return (n < 10 ? "0" : "") + n; }
  function hourLabel(h) { return pad2(h) + ":00"; }

  // The same full shape the menu writes (isQuietHour reads the numbers,
  // from/to strings ride along for older consumers).
  function quietValue(enabled, start, end) {
    return { enabled: !!enabled, quietHoursStart: start, quietHoursEnd: end,
             from: hourLabel(start), to: hourLabel(end) };
  }
  function readQuiet(v) {
    v = (v && typeof v === "object") ? v : {};
    var s = (typeof v.quietHoursStart === "number" && v.quietHoursStart >= 0 && v.quietHoursStart <= 23) ? v.quietHoursStart : 22;
    var e = (typeof v.quietHoursEnd === "number" && v.quietHoursEnd >= 0 && v.quietHoursEnd <= 23) ? v.quietHoursEnd : 8;
    return { enabled: !!v.enabled, start: s, end: e };
  }

  function intervalLabel(lang, m) {
    if (m === 0) return t(lang, "y.interval.off");
    return t(lang, m === 1 ? "y.interval.one" : "y.interval.min", { n: m });
  }

  function syncState(sync) {
    if (!sync || !sync.available || !sync.connected) return "off";
    if (!sync.unlocked) return "locked";
    return sync.dirty ? "dirty" : "on";
  }

  var api = {
    SECTIONS: SECTIONS, SCOPE: SCOPE, STRINGS: STRINGS,
    POSITIONS: POSITIONS, STYLES: STYLES, SOUNDS: SOUNDS, DURATIONS: DURATIONS,
    t: t, langOf: langOf, isSection: isSection, sectionOf: sectionOf, scopeOf: scopeOf,
    hourLabel: hourLabel, quietValue: quietValue, readQuiet: readQuiet,
    intervalLabel: intervalLabel, syncState: syncState
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) root.SettingsCore = api;
})(typeof window !== "undefined" ? window : null);
