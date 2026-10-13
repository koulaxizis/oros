// ============================================================
// orOS Settings — pure helpers (settings/core.js)
// No DOM, no storage: strings, the section list, which settings
// travel to every device, and small formatters. Shared by the app
// (window.SettingsCore) and node tests (module.exports).
// ============================================================
(function (root) {
  "use strict";

  // The groups, in the order shown. A deep link names one of these.
  var SECTIONS = ["appearance", "menu", "notifications", "sync", "backup", "language", "files", "services", "system"];

  // Where each setting lives: "all" = travels to every device through
  // sync, "device" = this device only. Mirrors the shell: lang, theme,
  // skin, wallpaper, syncInterval, autoexport ride in the shell slice;
  // the pet switch in the pet slice; notifications in the notifs slice;
  // search switches, backup folder and passphrase stay on the device.
  // The menu's app list rides in the launcher's "menu" slice.
  var SCOPE = {
    theme: "all", skin: "all", wallpaper: "all", pet: "all",
    notifications: "all", syncInterval: "all", autoexport: "all", lang: "all", menu: "all",
    folder: "device", search: "device", passphrase: "device", dock: "device", files: "device"
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
      "s.menu": "Menu",
      "d.appearance": "Theme, colours, wallpaper, Dock, screen pet",
      "d.menu": "Which apps the menu shows",
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
      "k.dock": "Dock", "k.on": "Show the Dock", "k.size": "Size",
      "k.size.s": "Small", "k.size.m": "Medium", "k.size.l": "Large",
      "k.magnify": "Magnify on hover", "k.autohide": "Hide automatically",
      "k.over": "Show over open apps",
      "k.style": "Style", "k.style.classic": "Classic", "k.style.glass": "Glass",
      "k.style.frosted": "Frosted", "k.style.smoke": "Smoke", "k.style.transparent": "Transparent",
      "k.style.solid": "Solid", "k.style.3d": "3D shelf", "k.style.neon": "Neon",
      "k.hover": "Hover effect", "k.hover.magnify": "Magnify", "k.hover.bounce": "Bounce",
      "k.hover.pulse": "Pulse", "k.hover.frame": "Frame", "k.hover.glow": "Glow",
      "k.hover.lift": "Lift", "k.hover.wiggle": "Wiggle", "k.hover.none": "None",
      "k.empty": "Add apps with the ☆ next to each app in the menu.",

      "m.apps": "Apps in the menu",
      "m.hint": "Untick an app to hide it from the menu. Hidden apps still open from the menu search, links from other apps, the desktop and the Dock.",
      "m.showAll": "Show all", "m.hideAll": "Hide all",
      "m.count": "{n} of {total} shown",
      "m.filter": "Find an app", "m.filter.none": "No app matches.",
      "m.none": "This orOS version cannot hide apps from the menu yet.",

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

      "s.files": "Opening files", "d.files": "Which orOS app opens which file type",
      "f.status": "Open with orOS",
      "f.ready": "orOS is in your system's “Open with” for the file types below. Pick orOS there for a file, or make it the default (how, below).",
      "f.install": "Install orOS as an app first (System › Install orOS as an app). Then it appears in your system's “Open with” for these file types.",
      "f.unsupported": "This browser cannot hand files from your device to orOS. Use Chrome or Edge on Windows, Linux or Mac, with orOS installed. On Android, share the file to orOS (Share › orOS).",
      "f.none": "Opening files is not available in this orOS version.",
      "f.apps": "Which app opens what",
      "f.choose": "Types more than one app opens",
      "f.choose.hint": "orOS asks each time, unless you pick an app here (or tick “Always” when it asks).",
      "f.ask": "Ask each time",
      "f.how": "Make orOS the default",
      "f.how.hint": "Only you can make an app the default, in your system's settings. orOS cannot do it by itself.",
      "f.how.win": "Windows: right-click a file › Open with › Choose another app › orOS, tick “Always use this app”.",
      "f.how.linux": "Linux: right-click a file › Properties › Open With › orOS › Set as default.",
      "f.how.mac": "Mac: select a file › Get Info › Open with › orOS › Change All.",
      "f.how.android": "Android: in Files, Gmail or any app, Share › orOS opens the file in the matching orOS app (orOS installed from Chrome). It cannot be the default for opening files yet.",

      "s.services": "Connected services", "d.services": "Your shop and other platforms orOS works with",
      "v.intro": "Link orOS to platforms you already use. Their keys stay sealed on this device: apps ask the system, never see them.",
      "v.none": "Nothing connected yet.", "v.unsupported": "This orOS version has no connected services yet.",
      "v.add": "Connect a service", "v.platform": "Platform", "v.name": "Name", "v.name.ph": "My shop",
      "v.site": "Shop address", "v.site.ph": "shop.example.com",
      "v.ck": "Consumer key", "v.cs": "Consumer secret",
      "v.keys.hint": "In WordPress: WooCommerce › Settings › Advanced › REST API › Add key, permissions Read/Write. Copy both keys here.",
      "v.save": "Connect", "v.cancel": "Cancel", "v.checking": "Checking…",
      "v.test": "Check connection", "v.ok": "Connected: the shop answers.",
      "v.via": "Route", "v.via.direct": "Straight from this browser", "v.via.query": "Straight from this browser (keys in the address)",
      "v.via.relay": "Through the orOS relay", "v.via.none": "Not used yet on this device",
      "v.used": "Used by", "v.keysHere": "Keys on this device", "v.keysMissing": "The keys are not on this device yet",
      "v.newKeys": "Enter the keys", "v.saveKeys": "Save keys",
      "v.ks": "Use these keys on all my devices",
      "v.ks.hint": "The keys travel inside your encrypted sync, sealed with your sync passphrase. Anyone who knows that passphrase can use them.",
      "v.ks.needSync": "Connect and unlock sync first.",
      "v.rename": "Rename", "v.remove": "Disconnect", "v.remove.confirm": "Tap again to disconnect",
      "v.remove.hint": "Disconnecting removes the account and its keys from every device. Nothing in your apps is deleted.",
      "v.open": "Open {app}",
      "v.err.offline": "You are offline.", "v.err.auth": "The shop refused the keys. Check them and that they have Read/Write permission.",
      "v.err.notfound": "No WooCommerce REST API at this address.", "v.err.network": "The shop could not be reached, not even through the orOS relay.",
      "v.err.relay": "The shop does not answer this browser and the orOS relay did not answer either.", "v.err.server": "The shop answered with an error.",
      "v.err.busy": "The shop asks to wait a little. Try again in a minute.", "v.err.keys": "The keys are not on this device. Enter them again.",
      "v.err.site": "Enter the https address of a public site.", "v.err.badkeys": "Check the keys: they start with ck_ and cs_, 43 characters each.",
      "v.err.full": "You have connected as many services as orOS keeps.", "v.err.save": "Not saved: this device's storage is full.",
      "v.err.denied": "orOS does not allow that call.", "v.err.gone": "This account was disconnected.",
      "v.plat.woo": "WooCommerce shop (Stock)", "v.plat.tol": "timologisi.online (Invoices → myDATA)",
      "v.plat.tol.hint": "A certified Greek e-invoicing provider: Invoices sends your invoices, receipts and credit notes through it to myDATA (AADE). It charges credits per document.",
      "v.env": "Environment", "v.env.test": "Test (sandbox)", "v.env.live": "Live (real documents)",
      "v.vat": "Issuer's ΑΦΜ", "v.vat.ph": "9 digits", "v.key": "API key",
      "v.keys.hint.tol": "In the timologisi.online portal copy your API key here: developer.portal.timologisi.online for tests, portal.timologisi.online for real documents. Test and live keys are different.",
      "v.ok.tol": "Connected. Credits left: {n}", "v.err.vat": "Enter the 9-digit ΑΦΜ this account issues for.",
      "v.err.badkeys.tol": "Check the API key: copy it whole, without spaces.",
      "v.err.auth.tol": "timologisi.online refused the key. Check that it belongs to this environment (test or live).",
      "v.err.notfound.tol": "timologisi.online answered with “not found”.", "v.err.network.tol": "timologisi.online could not be reached, not even through the orOS relay.",
      "v.err.relay.tol": "timologisi.online does not answer this browser and the orOS relay did not answer either.", "v.err.server.tol": "timologisi.online answered with an error.",
      "v.err.busy.tol": "timologisi.online asks to wait a little. Try again in a minute.",

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
      "s.menu": "Μενού",
      "d.appearance": "Θέμα, χρώματα, ταπετσαρία, Dock, συντροφάκι",
      "d.menu": "Ποιες εφαρμογές δείχνει το μενού",
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
      "k.dock": "Dock", "k.on": "Εμφάνιση του Dock", "k.size": "Μέγεθος",
      "k.size.s": "Μικρό", "k.size.m": "Μεσαίο", "k.size.l": "Μεγάλο",
      "k.magnify": "Μεγέθυνση στο πέρασμα του ποντικιού", "k.autohide": "Αυτόματη απόκρυψη",
      "k.over": "Εμφάνιση πάνω από ανοιχτές εφαρμογές",
      "k.style": "Στυλ", "k.style.classic": "Κλασικό", "k.style.glass": "Γυαλί",
      "k.style.frosted": "Θαμπό γυαλί", "k.style.smoke": "Καπνός", "k.style.transparent": "Διάφανο",
      "k.style.solid": "Συμπαγές", "k.style.3d": "Τρισδιάστατο ράφι", "k.style.neon": "Νέον",
      "k.hover": "Εφέ στο πέρασμα του ποντικιού", "k.hover.magnify": "Μεγέθυνση", "k.hover.bounce": "Αναπήδηση",
      "k.hover.pulse": "Παλμός", "k.hover.frame": "Πλαίσιο", "k.hover.glow": "Λάμψη",
      "k.hover.lift": "Ανύψωση", "k.hover.wiggle": "Κούνημα", "k.hover.none": "Κανένα",
      "k.empty": "Πρόσθεσε εφαρμογές με το ☆ δίπλα σε κάθε εφαρμογή στο μενού.",

      "m.apps": "Εφαρμογές στο μενού",
      "m.hint": "Βγάλε το τικ από μια εφαρμογή για να κρυφτεί από το μενού. Οι κρυφές εφαρμογές ανοίγουν ακόμα από την αναζήτηση του μενού, από συνδέσμους άλλων εφαρμογών, από την επιφάνεια εργασίας και από το Dock.",
      "m.showAll": "Εμφάνιση όλων", "m.hideAll": "Απόκρυψη όλων",
      "m.count": "Φαίνονται {n} από {total}",
      "m.filter": "Βρες εφαρμογή", "m.filter.none": "Καμία εφαρμογή δεν ταιριάζει.",
      "m.none": "Αυτή η έκδοση του orOS δεν μπορεί ακόμα να κρύβει εφαρμογές από το μενού.",

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

      "s.files": "Άνοιγμα αρχείων", "d.files": "Ποια εφαρμογή του orOS ανοίγει κάθε τύπο αρχείου",
      "f.status": "Άνοιγμα με το orOS",
      "f.ready": "Το orOS υπάρχει στο «Άνοιγμα με» του συστήματός σου για τους τύπους αρχείων παρακάτω. Διάλεξε εκεί το orOS για ένα αρχείο ή κάν' το προεπιλογή (πώς, παρακάτω).",
      "f.install": "Εγκατάστησε πρώτα το orOS ως εφαρμογή (Σύστημα › Εγκατάσταση του orOS ως εφαρμογή). Μετά εμφανίζεται στο «Άνοιγμα με» του συστήματός σου για αυτούς τους τύπους αρχείων.",
      "f.unsupported": "Αυτός ο browser δεν μπορεί να δίνει αρχεία της συσκευής στο orOS. Χρησιμοποίησε Chrome ή Edge σε Windows, Linux ή Mac, με εγκατεστημένο το orOS. Στο Android, κοινοποίησε το αρχείο στο orOS (Κοινοποίηση › orOS).",
      "f.none": "Το άνοιγμα αρχείων δεν υπάρχει σε αυτή την έκδοση του orOS.",
      "f.apps": "Ποια εφαρμογή ανοίγει τι",
      "f.choose": "Τύποι που ανοίγουν σε πάνω από μία εφαρμογή",
      "f.choose.hint": "Το orOS ρωτά κάθε φορά, εκτός αν διαλέξεις εδώ εφαρμογή (ή τσεκάρεις το «Πάντα» όταν ρωτά).",
      "f.ask": "Ερώτηση κάθε φορά",
      "f.how": "Το orOS ως προεπιλογή",
      "f.how.hint": "Μόνο εσύ μπορείς να ορίσεις μια εφαρμογή ως προεπιλογή, από τις ρυθμίσεις του συστήματός σου. Το orOS δεν μπορεί να το κάνει μόνο του.",
      "f.how.win": "Windows: δεξί κλικ σε αρχείο › Άνοιγμα με › Επιλογή άλλης εφαρμογής › orOS, τσέκαρε το «Να χρησιμοποιείται πάντα αυτή η εφαρμογή».",
      "f.how.linux": "Linux: δεξί κλικ σε αρχείο › Ιδιότητες › Άνοιγμα με › orOS › Ορισμός ως προεπιλογή.",
      "f.how.mac": "Mac: επίλεξε αρχείο › Λήψη πληροφοριών › Άνοιγμα με › orOS › Αλλαγή όλων.",
      "f.how.android": "Android: στα Αρχεία, στο Gmail ή σε όποια εφαρμογή, το Κοινοποίηση › orOS ανοίγει το αρχείο στη σωστή εφαρμογή του orOS (με το orOS εγκατεστημένο από Chrome). Προεπιλογή για άνοιγμα αρχείων δεν γίνεται ακόμα.",

      "s.services": "Συνδεδεμένες υπηρεσίες", "d.services": "Το κατάστημά σου και άλλες πλατφόρμες που δουλεύουν με το orOS",
      "v.intro": "Σύνδεσε το orOS με πλατφόρμες που ήδη χρησιμοποιείς. Τα κλειδιά τους μένουν κλειδωμένα σε αυτή τη συσκευή: οι εφαρμογές ζητούν από το σύστημα και δεν τα βλέπουν ποτέ.",
      "v.none": "Δεν έχεις συνδέσει τίποτα ακόμα.", "v.unsupported": "Αυτή η έκδοση του orOS δεν έχει ακόμα συνδεδεμένες υπηρεσίες.",
      "v.add": "Σύνδεση υπηρεσίας", "v.platform": "Πλατφόρμα", "v.name": "Όνομα", "v.name.ph": "Το κατάστημά μου",
      "v.site": "Διεύθυνση καταστήματος", "v.site.ph": "shop.example.gr",
      "v.ck": "Consumer key", "v.cs": "Consumer secret",
      "v.keys.hint": "Στο WordPress: WooCommerce › Ρυθμίσεις › Για προχωρημένους › REST API › Προσθήκη κλειδιού, δικαιώματα Ανάγνωση/Εγγραφή. Αντίγραψε εδώ και τα δύο κλειδιά.",
      "v.save": "Σύνδεση", "v.cancel": "Άκυρο", "v.checking": "Έλεγχος…",
      "v.test": "Έλεγχος σύνδεσης", "v.ok": "Συνδέθηκε: το κατάστημα απαντά.",
      "v.via": "Διαδρομή", "v.via.direct": "Απευθείας από αυτόν τον browser", "v.via.query": "Απευθείας από αυτόν τον browser (κλειδιά στη διεύθυνση)",
      "v.via.relay": "Μέσω του relay του orOS", "v.via.none": "Δεν έχει χρησιμοποιηθεί ακόμα σε αυτή τη συσκευή",
      "v.used": "Το χρησιμοποιεί", "v.keysHere": "Τα κλειδιά είναι σε αυτή τη συσκευή", "v.keysMissing": "Τα κλειδιά δεν είναι ακόμα σε αυτή τη συσκευή",
      "v.newKeys": "Πέρασε τα κλειδιά", "v.saveKeys": "Αποθήκευση κλειδιών",
      "v.ks": "Τα κλειδιά σε όλες τις συσκευές μου",
      "v.ks.hint": "Τα κλειδιά ταξιδεύουν μέσα στον κρυπτογραφημένο συγχρονισμό, κλειδωμένα με το συνθηματικό συγχρονισμού. Όποιος ξέρει το συνθηματικό μπορεί να τα χρησιμοποιήσει.",
      "v.ks.needSync": "Σύνδεσε και ξεκλείδωσε πρώτα τον συγχρονισμό.",
      "v.rename": "Μετονομασία", "v.remove": "Αποσύνδεση", "v.remove.confirm": "Πάτα ξανά για αποσύνδεση",
      "v.remove.hint": "Η αποσύνδεση σβήνει τον λογαριασμό και τα κλειδιά του από όλες τις συσκευές. Τίποτα στις εφαρμογές σου δεν σβήνεται.",
      "v.open": "Άνοιγμα: {app}",
      "v.err.offline": "Είσαι εκτός σύνδεσης.", "v.err.auth": "Το κατάστημα δεν δέχτηκε τα κλειδιά. Έλεγξέ τα και ότι έχουν δικαίωμα Ανάγνωση/Εγγραφή.",
      "v.err.notfound": "Δεν υπάρχει WooCommerce REST API σε αυτή τη διεύθυνση.", "v.err.network": "Το κατάστημα δεν απάντησε, ούτε μέσω του relay του orOS.",
      "v.err.relay": "Το κατάστημα δεν απαντά σε αυτόν τον browser και δεν απάντησε ούτε το relay του orOS.", "v.err.server": "Το κατάστημα απάντησε με σφάλμα.",
      "v.err.busy": "Το κατάστημα ζητά λίγη αναμονή. Δοκίμασε ξανά σε ένα λεπτό.", "v.err.keys": "Τα κλειδιά δεν είναι σε αυτή τη συσκευή. Πέρασέ τα ξανά.",
      "v.err.site": "Γράψε τη διεύθυνση https ενός δημόσιου site.", "v.err.badkeys": "Έλεγξε τα κλειδιά: αρχίζουν με ck_ και cs_ και έχουν 43 χαρακτήρες το καθένα.",
      "v.err.full": "Έχεις συνδέσει όσες υπηρεσίες κρατά το orOS.", "v.err.save": "Δεν αποθηκεύτηκε: ο χώρος της συσκευής γέμισε.",
      "v.err.denied": "Το orOS δεν επιτρέπει αυτή την κλήση.", "v.err.gone": "Αυτός ο λογαριασμός αποσυνδέθηκε.",
      "v.plat.woo": "Κατάστημα WooCommerce (Απόθεμα)", "v.plat.tol": "timologisi.online (Τιμολόγια → myDATA)",
      "v.plat.tol.hint": "Πιστοποιημένος πάροχος ηλεκτρονικής τιμολόγησης: τα Τιμολόγια στέλνουν μέσω αυτού τιμολόγια, αποδείξεις και πιστωτικά στο myDATA (ΑΑΔΕ). Χρεώνει μονάδες ανά παραστατικό.",
      "v.env": "Περιβάλλον", "v.env.test": "Δοκιμαστικό (sandbox)", "v.env.live": "Παραγωγής (πραγματικά παραστατικά)",
      "v.vat": "ΑΦΜ εκδότη", "v.vat.ph": "9 ψηφία", "v.key": "API key",
      "v.keys.hint.tol": "Αντίγραψε εδώ το API key από το portal του timologisi.online: developer.portal.timologisi.online για δοκιμές, portal.timologisi.online για πραγματικά παραστατικά. Τα κλειδιά δοκιμών και παραγωγής είναι διαφορετικά.",
      "v.ok.tol": "Συνδέθηκε. Υπόλοιπο μονάδων: {n}", "v.err.vat": "Γράψε το 9ψήφιο ΑΦΜ για το οποίο εκδίδει ο λογαριασμός.",
      "v.err.badkeys.tol": "Έλεγξε το API key: αντίγραψέ το ολόκληρο, χωρίς κενά.",
      "v.err.auth.tol": "Το timologisi.online δεν δέχτηκε το κλειδί. Έλεγξε ότι είναι του σωστού περιβάλλοντος (δοκιμαστικό ή παραγωγής).",
      "v.err.notfound.tol": "Το timologisi.online απάντησε «δεν βρέθηκε».", "v.err.network.tol": "Το timologisi.online δεν απάντησε, ούτε μέσω του relay του orOS.",
      "v.err.relay.tol": "Το timologisi.online δεν απαντά σε αυτόν τον browser και δεν απάντησε ούτε το relay του orOS.", "v.err.server.tol": "Το timologisi.online απάντησε με σφάλμα.",
      "v.err.busy.tol": "Το timologisi.online ζητά λίγη αναμονή. Δοκίμασε ξανά σε ένα λεπτό.",

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

  // Case-, accent- and final-ς-insensitive, like the menu search.
  function fold(v) {
    var s = String(v == null ? "" : v).toLowerCase();
    try { s = s.normalize("NFD").replace(/[\u0300-\u036f]/g, ""); } catch (e) {}
    return s.replace(/ς/g, "σ");
  }

  // Menu apps for the Settings list: filtered by `query` (name, id or
  // category), grouped by category, groups and apps sorted by their
  // shown names in the UI language.
  function menuGroups(apps, query, lang) {
    var q = fold(String(query || "").trim());
    var loc = langOf(lang);
    var cmp = function (a, b) {
      var r = 0;
      try { r = a.localeCompare(b, loc, { sensitivity: "base" }); } catch (e) { r = 0; }
      return r || (a < b ? -1 : a > b ? 1 : 0);
    };
    var byCat = {};
    (Array.isArray(apps) ? apps : []).forEach(function (a) {
      if (!a || typeof a.id !== "string") return;
      if (q && [a.name, a.id, a.catName].every(function (f) { return fold(f).indexOf(q) === -1; })) return;
      var c = String(a.cat || "other");
      (byCat[c] = byCat[c] || { cat: c, name: String(a.catName || c), apps: [] }).apps.push(a);
    });
    return Object.keys(byCat).map(function (c) {
      byCat[c].apps.sort(function (x, y) { return cmp(String(x.name), String(y.name)); });
      return byCat[c];
    }).sort(function (x, y) { return cmp(x.name, y.name); });
  }

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
    intervalLabel: intervalLabel, syncState: syncState, fold: fold, menuGroups: menuGroups
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) root.SettingsCore = api;
})(typeof window !== "undefined" ? window : null);
