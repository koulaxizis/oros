// ============================================================
// orOS Passwords — the vault tab (PmApp, v2.0.0)
// UI for the encrypted vault. The design (threat model, crypto,
// what is stored, what syncs) is in OROS_BIBLE.md, Part IV,
// PASSWORDS v2; the crypto is pmcrypto.js, the entries pmcore.js,
// KeePass files kdbx.js.
// Rules kept here:
//   - plaintext lives in this page's memory only while unlocked;
//     localStorage holds the encrypted slice only
//   - nothing secret is logged, put in a URL, a notification or a
//     toast; every string is set with textContent
//   - copies clear the clipboard after 30 s; Lock wipes the state
// Sections:
//   1. Strings + helpers
//   2. State, storage, sync slice
//   3. Write queue: absorb, merge blob, save
//   4. Lock, auto-lock, clipboard
//   5. Screens: create, locked, recovery
//   6. Open vault: toolbar, filters, list
//   7. Entry view (TOTP countdown)
//   8. Entry editor (generator, QR scan)
//   9. Menu: import, export, password, recovery key, settings
//  10. Dialog + file helpers
//  11. Boot
// ============================================================
(function () {
  "use strict";

  var VAULT_KEY = "oros-passwords-vault";
  var CLIP_MS = 30000;
  var MIN_MASTER = 12;
  var PV = window.PmVault, PC = window.PmCore, KX = window.Kdbx, P = window.PwCore;

  // ---------- 1. Strings + helpers ----------
  function appLang() {
    try {
      var l = localStorage.getItem("oros-lang") || (window.parent && window.parent.orosLang) || "en";
      return l === "el" ? "el" : "en";
    } catch (e) { return "en"; }
  }
  var LANG = appLang();

  var STRINGS = {
    en: {
      "tab": "Vault",
      "create.title": "Create your vault",
      "create.text": "Your passwords are encrypted on this device with a master password before anything is stored or synced. Nobody else can open them, and nobody can reset the master password for you.",
      "create.pw": "Master password", "create.pw2": "Type it again",
      "create.hint": "At least {n} characters. A passphrase of 5–6 random words is a good choice.",
      "create.go": "Create vault", "create.short": "Use at least {n} characters.",
      "create.mismatch": "The two passwords are not the same.",
      "create.weak": "This password is weak. Use a longer one or a passphrase.",
      "create.busy": "Creating the vault…",
      "lock.title": "Vault locked", "lock.text": "Type your master password to open your passwords.",
      "lock.go": "Unlock", "lock.busy": "Opening…", "lock.wrong": "Wrong master password.",
      "lock.useRk": "Forgot it? Use the recovery key",
      "lock.noWasm": "This browser cannot run the key derivation this vault uses (WebAssembly is missing).",
      "lock.fail": "The vault could not be opened.",
      "lock.newer": "This vault was made by a newer version of orOS. Update orOS to open it.",
      "rk.title": "Open with the recovery key", "rk.key": "Recovery key",
      "rk.newPw": "New master password", "rk.go": "Open and set the new password",
      "rk.wrong": "This recovery key does not open the vault.",
      "rk.none": "This vault has no recovery key.",
      "rk.show.title": "Your recovery key",
      "rk.show.text": "If you forget the master password, this key is the only way back into your vault. Write it down or save it somewhere safe, away from this device. It is shown only now.",
      "rk.show.ok": "I saved my recovery key", "rk.show.save": "Save as a file", "rk.show.copy": "Copy",
      "rk.file": "orOS Passwords recovery key\n\n{key}\n\nKeep this file somewhere safe, away from the device. With it anyone can set a new master password for your vault.\n",
      "open.search": "Search", "open.new": "New", "open.menu": "More", "open.lock": "Lock",
      "f.all": "All", "f.fav": "Favourites", "f.totp": "2FA codes", "f.weak": "Weak", "f.reused": "Reused",
      "f.tag": "Tag", "f.anyTag": "Every tag",
      "list.empty": "Your vault is empty. Press New to add a password, or import one from another manager in More.",
      "list.none": "Nothing matches.", "list.count1": "1 entry", "list.count": "{n} entries",
      "badge.totp": "2FA", "badge.weak": "Weak", "badge.reused": "Reused",
      "other.text": "There is a second vault, made on another device before the two synced. Open it with its own master password to move its entries into this one, or delete it.",
      "other.merge": "Move its entries here", "other.delete": "Delete it",
      "other.pw": "Master password of the other vault", "other.done": "{n} entries moved into this vault.",
      "other.confirm": "Delete the other vault and everything in it, on every device? This cannot be undone.",
      "v.back": "Back", "v.edit": "Edit", "v.delete": "Delete", "v.user": "Username", "v.pw": "Password",
      "v.totp": "Two-factor code", "v.urls": "Websites", "v.notes": "Notes", "v.fields": "More fields",
      "v.tags": "Tags", "v.hist": "Password history", "v.modified": "Changed {d}", "v.created": "Created {d}",
      "v.open": "Open", "v.copy": "Copy", "v.show": "Show", "v.hide": "Hide", "v.left": "{n} s",
      "v.badOtp": "The two-factor secret cannot be read.",
      "v.delConfirm": "Delete “{t}”? It is removed on every device.",
      "v.deleted": "Deleted", "v.undo": "Undo", "v.untitled": "(no title)",
      "e.title": "Title", "e.user": "Username or e-mail", "e.pw": "Password", "e.urls": "Websites (one per line)",
      "e.totp": "Two-factor secret or otpauth:// link", "e.scan": "Scan QR", "e.notes": "Notes",
      "e.tags": "Tags (separated by commas)", "e.fields": "More fields", "e.addField": "Add a field",
      "e.fName": "Name", "e.fValue": "Value", "e.fHidden": "Hidden", "e.fRemove": "Remove field",
      "e.fav": "Favourite", "e.save": "Save", "e.cancel": "Cancel", "e.new": "New entry", "e.editing": "Edit entry",
      "e.gen": "Generate", "e.genPw": "Password", "e.genPh": "Passphrase",
      "e.genHint": "Uses the options of the Password and Passphrase tabs.",
      "e.empty": "Give it at least a title, a username or a password.",
      "e.badOtp": "This is not a valid two-factor secret.", "e.hotp": "Counter-based (HOTP) codes are not supported.",
      "e.discard": "Discard your changes?", "e.saved": "Saved",
      "scan.title": "Scan a two-factor QR code", "scan.camera": "Use the camera", "scan.stop": "Stop the camera",
      "scan.file": "Choose a picture", "scan.aim": "Point the camera at the QR code.",
      "scan.none": "No QR code found.", "scan.notOtp": "This QR code is not a two-factor code.",
      "scan.denied": "The camera is not available.", "scan.found": "Two-factor code read.",
      "m.import": "Import", "m.export": "Export", "m.changePw": "Change master password",
      "m.newRk": "New recovery key", "m.settings": "Lock settings", "m.delete": "Delete vault", "m.lock": "Lock now",
      "imp.title": "Import passwords", "imp.text": "Bring your passwords from another manager. Entries already in your vault are skipped.",
      "imp.bw": "Bitwarden (.json, not encrypted)", "imp.kdbx": "KeePass / KeePassXC (.kdbx)",
      "imp.csv": "CSV (Bitwarden, Chrome, Firefox, KeePassXC, 1Password)",
      "imp.pick": "Choose file", "imp.kdbxPw": "Password of the KeePass file", "imp.keyFile": "Key file (if it has one)",
      "imp.keyPick": "Choose key file", "imp.keyNone": "No key file", "imp.open": "Open",
      "imp.reading": "Reading the file…",
      "imp.summary": "{n} new entries. {d} already in the vault. {s} empty or unreadable.",
      "imp.attach": "{a} attachments are not imported (orOS keeps no files in the vault).",
      "imp.recycle": "{r} entries in the recycle bin are left out.",
      "imp.go": "Import {n}", "imp.done": "{n} entries imported.",
      "imp.delete": "The file you imported is not encrypted. Delete it now.",
      "err.json": "This file is not valid JSON.", "err.format": "This file is not a known export.",
      "err.encrypted": "This Bitwarden export is encrypted. Export again as “.json” (not encrypted), import it, then delete that file.",
      "err.empty": "The file has no entries.", "err.notKdbx": "This is not a KeePass database.",
      "err.kdbxVersion": "This KeePass version is not supported (KDBX 3.1 and 4 are).",
      "err.wrongKey": "Wrong password or key file.", "err.twofish": "Twofish encryption is not supported. Change it to AES or ChaCha20 in KeePass, then import again.",
      "err.kdfParams": "The key derivation settings of this file are not supported.",
      "err.badFile": "The file is damaged.", "err.noKey": "Type the password or choose the key file.",
      "err.storage": "Could not save: the device storage is full. Nothing has been lost yet; free some space.",
      "err.generic": "Something went wrong.",
      "exp.title": "Export passwords", "exp.kdbx": "KeePass (.kdbx 4, encrypted) — recommended",
      "exp.bw": "Bitwarden (.json, NOT encrypted)",
      "exp.kdbxPw": "Password for the file", "exp.kdbxHint": "KeePass and KeePassXC open the file with this password. It can be your master password or a new one.",
      "exp.warn": "The Bitwarden file holds every password as plain text. Anyone who gets the file can read them all. Import it right away and then delete it.",
      "exp.ack": "I understand the file is not encrypted",
      "exp.master": "Your master password", "exp.go": "Export", "exp.busy": "Encrypting…",
      "exp.done": "Exported {n} entries.",
      "cpw.title": "Change master password", "cpw.cur": "Current master password", "cpw.new": "New master password",
      "cpw.again": "Type it again", "cpw.go": "Change", "cpw.done": "Master password changed.",
      "cpw.note": "Older cloud backups of your data still open with the old password.",
      "nrk.title": "New recovery key", "nrk.text": "Your old recovery key will stop working.",
      "set.title": "Lock settings", "set.after": "Lock after this long without use",
      "set.min": "{n} min", "set.hide": "Lock as soon as you leave the app or switch tabs",
      "set.clip": "Copied passwords and codes are cleared from the clipboard after 30 seconds.",
      "del.title": "Delete the vault", "del.text": "This deletes every password in the vault, on every device that syncs with this one. Export first if you want to keep them. It cannot be undone.",
      "del.go": "Delete the vault", "del.done": "The vault has been deleted.",
      "c.copied": "Copied. The clipboard clears in 30 seconds.", "c.copiedPlain": "Copied",
      "c.fail": "Could not copy", "c.cleared": "Clipboard cleared",
      "locked.auto": "The vault locked itself.", "locked": "Vault locked",
      "d.cancel": "Cancel", "d.ok": "OK", "d.close": "Close", "d.delete": "Delete",
      "show": "Show", "hide": "Hide", "busy": "Working…",
      "addon": "orOS does not fill in passwords on websites. Copy them from here."
    },
    el: {
      "tab": "Κρύπτη",
      "create.title": "Δημιούργησε την κρύπτη σου",
      "create.text": "Οι κωδικοί σου κρυπτογραφούνται σε αυτή τη συσκευή με έναν κύριο κωδικό πριν αποθηκευτεί ή συγχρονιστεί οτιδήποτε. Κανείς άλλος δεν μπορεί να τους ανοίξει, και κανείς δεν μπορεί να σου επαναφέρει τον κύριο κωδικό.",
      "create.pw": "Κύριος κωδικός", "create.pw2": "Γράψ’ τον ξανά",
      "create.hint": "Τουλάχιστον {n} χαρακτήρες. Μια φράση 5–6 τυχαίων λέξεων είναι καλή επιλογή.",
      "create.go": "Δημιουργία", "create.short": "Χρησιμοποίησε τουλάχιστον {n} χαρακτήρες.",
      "create.mismatch": "Οι δύο κωδικοί δεν είναι ίδιοι.",
      "create.weak": "Αυτός ο κωδικός είναι αδύναμος. Βάλε μεγαλύτερο ή μια φράση.",
      "create.busy": "Δημιουργία της κρύπτης…",
      "lock.title": "Η κρύπτη είναι κλειδωμένη", "lock.text": "Γράψε τον κύριο κωδικό για να ανοίξεις τους κωδικούς σου.",
      "lock.go": "Ξεκλείδωμα", "lock.busy": "Άνοιγμα…", "lock.wrong": "Λάθος κύριος κωδικός.",
      "lock.useRk": "Τον ξέχασες; Χρησιμοποίησε το κλειδί ανάκτησης",
      "lock.noWasm": "Αυτός ο browser δεν μπορεί να τρέξει την παραγωγή κλειδιού που χρησιμοποιεί η κρύπτη (λείπει το WebAssembly).",
      "lock.fail": "Η κρύπτη δεν άνοιξε.",
      "lock.newer": "Αυτή η κρύπτη φτιάχτηκε από νεότερη έκδοση του orOS. Ενημέρωσε το orOS για να την ανοίξεις.",
      "rk.title": "Άνοιγμα με το κλειδί ανάκτησης", "rk.key": "Κλειδί ανάκτησης",
      "rk.newPw": "Νέος κύριος κωδικός", "rk.go": "Άνοιγμα και ορισμός νέου κωδικού",
      "rk.wrong": "Αυτό το κλειδί ανάκτησης δεν ανοίγει την κρύπτη.",
      "rk.none": "Αυτή η κρύπτη δεν έχει κλειδί ανάκτησης.",
      "rk.show.title": "Το κλειδί ανάκτησής σου",
      "rk.show.text": "Αν ξεχάσεις τον κύριο κωδικό, αυτό το κλειδί είναι ο μόνος τρόπος να μπεις ξανά. Γράψ’ το ή αποθήκευσέ το κάπου ασφαλές, μακριά από αυτή τη συσκευή. Εμφανίζεται μόνο τώρα.",
      "rk.show.ok": "Αποθήκευσα το κλειδί ανάκτησης", "rk.show.save": "Αποθήκευση σε αρχείο", "rk.show.copy": "Αντιγραφή",
      "rk.file": "Κλειδί ανάκτησης orOS Passwords\n\n{key}\n\nΚράτα αυτό το αρχείο κάπου ασφαλές, μακριά από τη συσκευή. Με αυτό ο καθένας μπορεί να ορίσει νέο κύριο κωδικό στην κρύπτη σου.\n",
      "open.search": "Αναζήτηση", "open.new": "Νέο", "open.menu": "Περισσότερα", "open.lock": "Κλείδωμα",
      "f.all": "Όλα", "f.fav": "Αγαπημένα", "f.totp": "Κωδικοί 2FA", "f.weak": "Αδύναμοι", "f.reused": "Επαναλαμβανόμενοι",
      "f.tag": "Ετικέτα", "f.anyTag": "Κάθε ετικέτα",
      "list.empty": "Η κρύπτη είναι άδεια. Πάτα Νέο για να προσθέσεις κωδικό, ή κάνε εισαγωγή από άλλη εφαρμογή στο Περισσότερα.",
      "list.none": "Δεν βρέθηκε τίποτα.", "list.count1": "1 εγγραφή", "list.count": "{n} εγγραφές",
      "badge.totp": "2FA", "badge.weak": "Αδύναμος", "badge.reused": "Επαναλαμβάνεται",
      "other.text": "Υπάρχει δεύτερη κρύπτη, φτιαγμένη σε άλλη συσκευή πριν συγχρονιστούν οι δύο. Άνοιξέ τη με τον δικό της κύριο κωδικό για να μεταφέρεις τις εγγραφές της εδώ, ή διάγραψέ τη.",
      "other.merge": "Μεταφορά των εγγραφών της εδώ", "other.delete": "Διαγραφή της",
      "other.pw": "Κύριος κωδικός της άλλης κρύπτης", "other.done": "{n} εγγραφές μεταφέρθηκαν εδώ.",
      "other.confirm": "Να διαγραφεί η άλλη κρύπτη με όλο το περιεχόμενό της, σε κάθε συσκευή; Δεν αναιρείται.",
      "v.back": "Πίσω", "v.edit": "Επεξεργασία", "v.delete": "Διαγραφή", "v.user": "Όνομα χρήστη", "v.pw": "Κωδικός",
      "v.totp": "Κωδικός δύο βημάτων", "v.urls": "Ιστότοποι", "v.notes": "Σημειώσεις", "v.fields": "Άλλα πεδία",
      "v.tags": "Ετικέτες", "v.hist": "Ιστορικό κωδικών", "v.modified": "Αλλαγή {d}", "v.created": "Δημιουργία {d}",
      "v.open": "Άνοιγμα", "v.copy": "Αντιγραφή", "v.show": "Εμφάνιση", "v.hide": "Απόκρυψη", "v.left": "{n} δλ",
      "v.badOtp": "Το μυστικό δύο βημάτων δεν διαβάζεται.",
      "v.delConfirm": "Διαγραφή του «{t}»; Αφαιρείται από κάθε συσκευή.",
      "v.deleted": "Διαγράφηκε", "v.undo": "Αναίρεση", "v.untitled": "(χωρίς τίτλο)",
      "e.title": "Τίτλος", "e.user": "Όνομα χρήστη ή e-mail", "e.pw": "Κωδικός", "e.urls": "Ιστότοποι (ένας ανά γραμμή)",
      "e.totp": "Μυστικό δύο βημάτων ή σύνδεσμος otpauth://", "e.scan": "Σάρωση QR", "e.notes": "Σημειώσεις",
      "e.tags": "Ετικέτες (χωρισμένες με κόμμα)", "e.fields": "Άλλα πεδία", "e.addField": "Προσθήκη πεδίου",
      "e.fName": "Όνομα", "e.fValue": "Τιμή", "e.fHidden": "Κρυφό", "e.fRemove": "Αφαίρεση πεδίου",
      "e.fav": "Αγαπημένο", "e.save": "Αποθήκευση", "e.cancel": "Ακύρωση", "e.new": "Νέα εγγραφή", "e.editing": "Επεξεργασία εγγραφής",
      "e.gen": "Δημιουργία", "e.genPw": "Κωδικός", "e.genPh": "Φράση",
      "e.genHint": "Με τις επιλογές των καρτελών Κωδικός και Φράση.",
      "e.empty": "Βάλε τουλάχιστον τίτλο, όνομα χρήστη ή κωδικό.",
      "e.badOtp": "Αυτό δεν είναι έγκυρο μυστικό δύο βημάτων.", "e.hotp": "Οι κωδικοί με μετρητή (HOTP) δεν υποστηρίζονται.",
      "e.discard": "Να απορριφθούν οι αλλαγές σου;", "e.saved": "Αποθηκεύτηκε",
      "scan.title": "Σάρωση QR δύο βημάτων", "scan.camera": "Χρήση κάμερας", "scan.stop": "Διακοπή κάμερας",
      "scan.file": "Επιλογή εικόνας", "scan.aim": "Στρέψε την κάμερα στον κωδικό QR.",
      "scan.none": "Δεν βρέθηκε κωδικός QR.", "scan.notOtp": "Αυτός ο κωδικός QR δεν είναι κωδικός δύο βημάτων.",
      "scan.denied": "Η κάμερα δεν είναι διαθέσιμη.", "scan.found": "Ο κωδικός δύο βημάτων διαβάστηκε.",
      "m.import": "Εισαγωγή", "m.export": "Εξαγωγή", "m.changePw": "Αλλαγή κύριου κωδικού",
      "m.newRk": "Νέο κλειδί ανάκτησης", "m.settings": "Ρυθμίσεις κλειδώματος", "m.delete": "Διαγραφή κρύπτης", "m.lock": "Κλείδωμα τώρα",
      "imp.title": "Εισαγωγή κωδικών", "imp.text": "Φέρε τους κωδικούς σου από άλλη εφαρμογή. Όσες εγγραφές υπάρχουν ήδη παραλείπονται.",
      "imp.bw": "Bitwarden (.json, μη κρυπτογραφημένο)", "imp.kdbx": "KeePass / KeePassXC (.kdbx)",
      "imp.csv": "CSV (Bitwarden, Chrome, Firefox, KeePassXC, 1Password)",
      "imp.pick": "Επιλογή αρχείου", "imp.kdbxPw": "Κωδικός του αρχείου KeePass", "imp.keyFile": "Αρχείο κλειδιού (αν έχει)",
      "imp.keyPick": "Επιλογή αρχείου κλειδιού", "imp.keyNone": "Χωρίς αρχείο κλειδιού", "imp.open": "Άνοιγμα",
      "imp.reading": "Ανάγνωση του αρχείου…",
      "imp.summary": "{n} νέες εγγραφές. {d} υπάρχουν ήδη. {s} κενές ή μη αναγνώσιμες.",
      "imp.attach": "{a} συνημμένα δεν εισάγονται (το orOS δεν κρατά αρχεία στην κρύπτη).",
      "imp.recycle": "{r} εγγραφές του κάδου ανακύκλωσης μένουν έξω.",
      "imp.go": "Εισαγωγή {n}", "imp.done": "Εισήχθησαν {n} εγγραφές.",
      "imp.delete": "Το αρχείο που εισήγαγες δεν είναι κρυπτογραφημένο. Διάγραψέ το τώρα.",
      "err.json": "Αυτό το αρχείο δεν είναι έγκυρο JSON.", "err.format": "Αυτό το αρχείο δεν είναι γνωστή εξαγωγή.",
      "err.encrypted": "Αυτή η εξαγωγή του Bitwarden είναι κρυπτογραφημένη. Κάνε ξανά εξαγωγή ως «.json» (μη κρυπτογραφημένο), εισήγαγέ το και μετά διάγραψε το αρχείο.",
      "err.empty": "Το αρχείο δεν έχει εγγραφές.", "err.notKdbx": "Αυτό δεν είναι βάση δεδομένων KeePass.",
      "err.kdbxVersion": "Αυτή η έκδοση KeePass δεν υποστηρίζεται (υποστηρίζονται KDBX 3.1 και 4).",
      "err.wrongKey": "Λάθος κωδικός ή αρχείο κλειδιού.", "err.twofish": "Η κρυπτογράφηση Twofish δεν υποστηρίζεται. Άλλαξέ την σε AES ή ChaCha20 στο KeePass και ξανακάνε την εισαγωγή.",
      "err.kdfParams": "Οι ρυθμίσεις παραγωγής κλειδιού αυτού του αρχείου δεν υποστηρίζονται.",
      "err.badFile": "Το αρχείο είναι κατεστραμμένο.", "err.noKey": "Γράψε τον κωδικό ή διάλεξε το αρχείο κλειδιού.",
      "err.storage": "Η αποθήκευση απέτυχε: ο χώρος της συσκευής γέμισε. Τίποτα δεν χάθηκε ακόμα· ελευθέρωσε λίγο χώρο.",
      "err.generic": "Κάτι πήγε στραβά.",
      "exp.title": "Εξαγωγή κωδικών", "exp.kdbx": "KeePass (.kdbx 4, κρυπτογραφημένο) — προτείνεται",
      "exp.bw": "Bitwarden (.json, ΜΗ κρυπτογραφημένο)",
      "exp.kdbxPw": "Κωδικός για το αρχείο", "exp.kdbxHint": "Το KeePass και το KeePassXC ανοίγουν το αρχείο με αυτόν τον κωδικό. Μπορεί να είναι ο κύριος κωδικός σου ή καινούργιος.",
      "exp.warn": "Το αρχείο Bitwarden έχει όλους τους κωδικούς σε απλό κείμενο. Όποιος το αποκτήσει τους διαβάζει όλους. Κάνε αμέσως την εισαγωγή και μετά διάγραψέ το.",
      "exp.ack": "Καταλαβαίνω ότι το αρχείο δεν είναι κρυπτογραφημένο",
      "exp.master": "Ο κύριος κωδικός σου", "exp.go": "Εξαγωγή", "exp.busy": "Κρυπτογράφηση…",
      "exp.done": "Εξήχθησαν {n} εγγραφές.",
      "cpw.title": "Αλλαγή κύριου κωδικού", "cpw.cur": "Τωρινός κύριος κωδικός", "cpw.new": "Νέος κύριος κωδικός",
      "cpw.again": "Γράψ’ τον ξανά", "cpw.go": "Αλλαγή", "cpw.done": "Ο κύριος κωδικός άλλαξε.",
      "cpw.note": "Τα παλαιότερα αντίγραφα ασφαλείας στο cloud ανοίγουν ακόμα με τον παλιό κωδικό.",
      "nrk.title": "Νέο κλειδί ανάκτησης", "nrk.text": "Το παλιό κλειδί ανάκτησης θα σταματήσει να λειτουργεί.",
      "set.title": "Ρυθμίσεις κλειδώματος", "set.after": "Κλείδωμα μετά από τόση ώρα χωρίς χρήση",
      "set.min": "{n} λεπτά", "set.hide": "Κλείδωμα μόλις φύγεις από την εφαρμογή ή αλλάξεις καρτέλα",
      "set.clip": "Οι κωδικοί που αντιγράφεις σβήνουν από το πρόχειρο μετά από 30 δευτερόλεπτα.",
      "del.title": "Διαγραφή της κρύπτης", "del.text": "Διαγράφει κάθε κωδικό της κρύπτης, σε κάθε συσκευή που συγχρονίζεται με αυτή. Κάνε πρώτα εξαγωγή αν θέλεις να τους κρατήσεις. Δεν αναιρείται.",
      "del.go": "Διαγραφή της κρύπτης", "del.done": "Η κρύπτη διαγράφηκε.",
      "c.copied": "Αντιγράφηκε. Το πρόχειρο καθαρίζει σε 30 δευτερόλεπτα.", "c.copiedPlain": "Αντιγράφηκε",
      "c.fail": "Δεν έγινε αντιγραφή", "c.cleared": "Το πρόχειρο καθαρίστηκε",
      "locked.auto": "Η κρύπτη κλείδωσε μόνη της.", "locked": "Η κρύπτη κλείδωσε",
      "d.cancel": "Ακύρωση", "d.ok": "OK", "d.close": "Κλείσιμο", "d.delete": "Διαγραφή",
      "show": "Εμφάνιση", "hide": "Απόκρυψη", "busy": "Γίνεται…",
      "addon": "Το orOS δεν συμπληρώνει κωδικούς σε ιστότοπους. Αντίγραψέ τους από εδώ."
    }
  };

  function t(key, params) {
    var p = STRINGS[LANG] || STRINGS.en;
    var s = p[key] !== undefined ? p[key] : (STRINGS.en[key] !== undefined ? STRINGS.en[key] : key);
    if (params) Object.keys(params).forEach(function (k) { s = s.split("{" + k + "}").join(String(params[k])); });
    return s;
  }
  function $(id) { return document.getElementById(id); }
  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  function btn(label, cls, onClick) {
    var b = el("button", cls || "act", label);
    b.type = "button";
    if (onClick) b.addEventListener("click", onClick);
    return b;
  }
  function clear(n) { while (n && n.firstChild) n.removeChild(n.firstChild); }
  function padlock() {
    var NS = "http://www.w3.org/2000/svg", s = document.createElementNS(NS, "svg");
    s.setAttribute("viewBox", "0 0 24 24"); s.setAttribute("width", "20"); s.setAttribute("height", "20");
    s.setAttribute("aria-hidden", "true");
    var r = document.createElementNS(NS, "rect");
    r.setAttribute("x", "5"); r.setAttribute("y", "10.5"); r.setAttribute("width", "14"); r.setAttribute("height", "10"); r.setAttribute("rx", "2");
    var p = document.createElementNS(NS, "path");
    p.setAttribute("d", "M8 10.5V7.5a4 4 0 0 1 8 0v3");
    [r, p].forEach(function (n) {
      n.setAttribute("fill", "none"); n.setAttribute("stroke", "currentColor"); n.setAttribute("stroke-width", "2");
      s.appendChild(n);
    });
    return s;
  }
  function secretInput(id, ac) {
    var i = el("input", "mono");
    i.type = "password"; if (id) i.id = id;
    i.autocomplete = ac || "off";
    i.setAttribute("autocapitalize", "off"); i.setAttribute("autocorrect", "off");
    i.spellcheck = false; i.setAttribute("data-lpignore", "true");
    return i;
  }
  function textInput(id) {
    var i = el("input"); i.type = "text"; if (id) i.id = id;
    i.autocomplete = "off"; i.setAttribute("autocapitalize", "off"); i.spellcheck = false;
    return i;
  }
  function labelled(text, input) {
    var w = el("label", "fld");
    w.appendChild(el("span", "fld-label", text));
    w.appendChild(input);
    return w;
  }
  // A password field with its own Show button.
  function showable(input) {
    var row = el("div", "pw-row");
    row.appendChild(input);
    var b = btn(t("show"), "act small", function () {
      var on = input.type === "password";
      input.type = on ? "text" : "password";
      b.textContent = t(on ? "hide" : "show");
      b.setAttribute("aria-pressed", on ? "true" : "false");
    });
    b.setAttribute("aria-pressed", "false");
    row.appendChild(b);
    return row;
  }
  function fmtDate(ms) {
    try {
      return new Date(ms).toLocaleString(LANG === "el" ? "el-GR" : "en-GB",
        { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
    } catch (e) { return ""; }
  }
  function app() { return window.PwApp || null; }
  function toast(msg) { if (app()) app().toast(msg); }
  function errText(e) {
    var m = e && e.message;
    var map = { "json": "err.json", "format": "err.format", "encrypted": "err.encrypted", "empty": "err.empty",
                "not-kdbx": "err.notKdbx", "kdbx-version": "err.kdbxVersion", "wrong-key": "err.wrongKey",
                "twofish": "err.twofish", "kdf-params": "err.kdfParams", "kdf-unknown": "err.kdfParams",
                "bad-file": "err.badFile", "bad-xml": "err.badFile", "no-key": "err.noKey", "cipher-unknown": "err.badFile",
                "storage-full": "err.storage", "no-wasm": "lock.noWasm", "no-argon2": "lock.noWasm",
                "bad-kdf": "lock.newer", "future": "lock.newer" };
    return t(map[m] || "err.generic");
  }

  // ---------- 2. State, storage, sync slice ----------
  var slice = PV.empty();
  var session = null;            // { kid, ek, ik } while unlocked
  var snap = null;               // decrypted snapshot while unlocked
  var blobSnaps = {};            // blob id -> decrypted snapshot (memory)
  var badBlobs = {};             // blob ids that did not open
  var view = { mode: "list", id: null, query: "", filter: "all", tag: "" };
  var weakCache = {};
  var pending = null;            // { password } handed from the generator
  var root = null;               // #vault

  function readStored() {
    try {
      var raw = localStorage.getItem(VAULT_KEY);
      return raw ? PV.normSlice(JSON.parse(raw)) : PV.empty();
    } catch (e) { return PV.empty(); }
  }
  function writeStored(s) {
    try { localStorage.setItem(VAULT_KEY, JSON.stringify(s)); }
    catch (e) { throw new Error("storage-full"); }
  }
  function primary() { return PV.isFuture(slice) ? null : PV.primaryKid(slice); }
  function vaultOf(k) { return slice.vaults[k] || null; }

  function syncApi() {
    try { return (window.parent && window.parent !== window && window.parent.orosSync) || window.orosSync || null; }
    catch (e) { return window.orosSync || null; }
  }
  var suppress = false;
  function markDirty() {
    if (suppress) return;
    var api = syncApi();
    try { if (api && typeof api.markDirty === "function") api.markDirty(); } catch (e) {}
  }
  function sliceGet() {
    var raw = null;
    try { raw = localStorage.getItem(VAULT_KEY); } catch (e) { raw = null; }
    return raw ? readStored() : null;
  }
  function sliceSet(data) {
    if (!data || typeof data !== "object") return;
    var n = PV.normSlice(data);
    suppress = true;
    try { writeStored(n); } catch (e) { /* full: kept in memory, the next save retries */ }
    finally { suppress = false; }
    slice = n;
    onSliceChanged();
  }
  function registerSync() {
    var api = syncApi();
    if (!api || typeof api.registerSlice !== "function") return;
    api.registerSlice("passwords", sliceGet, sliceSet, VAULT_KEY, PV.mergeSlice);
  }

  function onSliceChanged() {
    if (session && !vaultOf(session.kid)) { lock(); toast(t("del.done")); return; }
    if (session) { enqueue(settle).then(render, render); return; }
    render();
  }

  // ---------- 3. Write queue ----------
  var chain = Promise.resolve();
  function noop() {}
  function enqueue(fn) {
    var p = chain.then(function () { return fn(); });
    chain = p.then(noop, noop);
    return p;
  }

  // Open every blob not yet seen and merge it into memory. Resolves
  // { ids (opened), merged (exactly those blobs) } or null.
  function absorb() {
    if (!session) return Promise.resolve(null);
    var s = session;
    slice = readStored();
    var V = vaultOf(s.kid);
    if (!V) return Promise.resolve(null);
    var ids = Object.keys(V.blobs);
    var p = Promise.resolve();
    ids.forEach(function (id) {
      if (blobSnaps[id] || badBlobs[id]) return;
      p = p.then(function () {
        if (session !== s) return;
        return PV.openBlob(s, id, V.blobs[id]).then(function (o) { blobSnaps[id] = PC.normSnap(o); },
                                                     function () { badBlobs[id] = 1; });
      });
    });
    return p.then(function () {
      if (session !== s) return null;
      var ok = ids.filter(function (id) { return blobSnaps[id]; });
      var merged = PC.emptySnap();
      ok.forEach(function (id) { merged = PC.mergeSnap(merged, blobSnaps[id]); });
      snap = snap ? PC.mergeSnap(snap, merged) : merged;
      return { ids: ok, all: ids.length, merged: merged };
    });
  }

  function put(sealed, merged) {
    var latest = readStored();
    var V = vaultOf(session.kid) || latest.vaults[session.kid];
    var next = PV.withVault(latest, session.kid, latest.vaults[session.kid] || V, sealed.id, sealed.blob);
    blobSnaps[sealed.id] = merged;
    writeStored(next);
    slice = next;
    markDirty();
  }

  // After unlock or a sync: one merge blob when several are left (two
  // devices write the same bytes), or a full save when memory knows
  // more than the stored blobs.
  function settle() {
    return absorb().then(function (r) {
      if (!r || !session) return;
      var V = vaultOf(session.kid);
      if (!V) return;
      if (PC.canon(snap) !== PC.canon(r.merged)) return writeSnap();
      if (r.ids.length > 1 && r.ids.length === r.all) {
        var s = session;
        return PV.sealMerge(s, V, r.ids, r.merged).then(function (x) { if (session === s) put(x, r.merged); });
      }
    });
  }
  function writeSnap() {
    var s = session, V = vaultOf(s.kid), mine = snap;
    if (!V) return Promise.reject(new Error("locked"));
    var ids = Object.keys(V.blobs).filter(function (id) { return blobSnaps[id]; });
    return PV.seal(s, V, mine, { ids: ids }).then(function (x) { if (session === s) put(x, mine); });
  }
  // fn(snapshot) -> new snapshot, applied after every stored blob is in.
  function save(fn) {
    return enqueue(function () {
      return absorb().then(function () {
        if (!session) throw new Error("locked");
        snap = fn(snap);
        return writeSnap();
      });
    }).then(function () { render(); }, function (e) { toast(errText(e)); render(); throw e; });
  }

  // ---------- 4. Lock, auto-lock, clipboard ----------
  var lastActivity = Date.now(), lockTimer = null, totpTimer = null, picking = false;
  function prefs() { return app() ? app().prefs() : { lock: 5, lockHide: 1 }; }

  function lock(auto) {
    var was = !!session;
    session = null; snap = null; blobSnaps = {}; badBlobs = {}; weakCache = {}; pending = null;
    view = { mode: "list", id: null, query: "", filter: "all", tag: "" };
    clearInterval(totpTimer); totpTimer = null;
    closeDialogs();
    if (clip.pending) clearClip(true);
    if (root) { clear(root); render(); }
    if (was && auto) toast(t("locked.auto"));
  }
  function touch() { lastActivity = Date.now(); }
  function checkIdle() {
    if (!session) return;
    var mins = prefs().lock || 5;
    if (Date.now() - lastActivity > mins * 60000) lock(true);
  }

  var clip = { timer: null, pending: false, waitFocus: false };
  function writeClip(s) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(s).then(function () { return true; }, function () { return false; });
    }
    return Promise.resolve(false);
  }
  function copySecret(text, secret) {
    if (!text) return;
    writeClip(text).then(function (ok) {
      if (!ok) { toast(t("c.fail")); return; }
      if (!secret) { toast(t("c.copiedPlain")); return; }
      toast(t("c.copied"));
      clip.pending = true; clip.waitFocus = false;
      clearTimeout(clip.timer);
      clip.timer = setTimeout(function () { clearClip(false); }, CLIP_MS);
    });
  }
  // Cleared even if something else was copied since: a vault cannot
  // read the clipboard without asking. Without focus the browser
  // refuses, so it is tried again at the next focus.
  function clearClip(quiet) {
    clearTimeout(clip.timer); clip.timer = null;
    if (!clip.pending) return;
    if (!document.hasFocus()) { clip.waitFocus = true; return; }
    writeClip("").then(function (done) {
      if (done) { clip.pending = false; clip.waitFocus = false; if (!quiet) toast(t("c.cleared")); }
      else clip.waitFocus = true;
    });
  }

  // ---------- 5. Screens: create, locked, recovery ----------
  function render() {
    if (!root) return;
    if (root.hidden) return;
    if (session) { renderOpen(); return; }
    clear(root);
    if (PV.isFuture(slice)) {
      var card = el("div", "card pv-card");
      card.appendChild(el("h2", "pv-h", t("lock.title")));
      card.appendChild(el("p", "warn", t("lock.newer")));
      root.appendChild(card);
      return;
    }
    if (!primary()) renderCreate(); else renderLocked();
  }

  function meterBox() {
    var m = el("div", "meter");
    var bar = el("div", "bar"); bar.appendChild(el("span", "fill")); m.appendChild(bar);
    var tx = el("div", "meter-text"); tx.appendChild(el("span", "m-label")); tx.appendChild(el("span", "m-bits"));
    m.appendChild(tx);
    m.update = function (pw) {
      var res = pw ? P.audit(pw) : null;
      var fill = m.querySelector(".fill");
      if (!res) { m.setAttribute("data-score", ""); fill.style.width = "0"; m.querySelector(".m-label").textContent = ""; m.querySelector(".m-bits").textContent = ""; return null; }
      m.setAttribute("data-score", String(res.score));
      fill.style.width = Math.max(6, Math.min(100, res.bits)) + "%";
      m.querySelector(".m-label").textContent = app() ? app().scoreLabel(res.score) : String(res.score);
      m.querySelector(".m-bits").textContent = "≈ " + Math.round(res.bits) + " bits";
      return res;
    };
    return m;
  }

  // Checks a new master password; returns an error text or "".
  function masterProblem(pw, pw2) {
    if (pw.length < MIN_MASTER) return t("create.short", { n: MIN_MASTER });
    if (pw !== pw2) return t("create.mismatch");
    var a = P.audit(pw);
    if (a && a.score < 3) return t("create.weak");
    return "";
  }

  function renderCreate() {
    var card = el("div", "card pv-card");
    card.appendChild(el("h2", "pv-h", t("create.title")));
    card.appendChild(el("p", "hint", t("create.text")));
    var pw = secretInput("pv-new1", "new-password"), pw2 = secretInput("pv-new2", "new-password");
    card.appendChild(labelled(t("create.pw"), showable(pw)));
    var meter = meterBox(); card.appendChild(meter);
    card.appendChild(labelled(t("create.pw2"), pw2));
    card.appendChild(el("p", "hint", t("create.hint", { n: MIN_MASTER })));
    var err = el("p", "hint err"); err.setAttribute("role", "alert"); err.hidden = true;
    card.appendChild(err);
    var go = btn(t("create.go"), "act primary wide");
    card.appendChild(go);
    pw.addEventListener("input", function () { meter.update(pw.value); err.hidden = true; });
    pw2.addEventListener("keydown", function (e) { if (e.key === "Enter") go.click(); });
    go.addEventListener("click", function () {
      var problem = masterProblem(pw.value, pw2.value);
      if (problem) { err.textContent = problem; err.hidden = false; return; }
      go.disabled = true; go.textContent = t("create.busy");
      var secret = pw.value;
      PV.create(secret).then(function (v) {
        secret = null;
        var latest = readStored();
        if (PV.isFuture(latest) || PV.primaryKid(latest)) { throw new Error("exists"); }
        var next = PV.withVault(latest, v.kid, v.vault);
        writeStored(next);
        slice = next;
        markDirty();
        session = v.session; snap = PC.emptySnap(); blobSnaps = {}; badBlobs = {};
        touch();
        pw.value = ""; pw2.value = "";
        render();
        showRecovery(v.recovery);
      }).catch(function (e) {
        go.disabled = false; go.textContent = t("create.go");
        if (e && e.message === "exists") { slice = readStored(); render(); return; }
        err.textContent = errText(e); err.hidden = false;
      });
    });
    root.appendChild(card);
    root.appendChild(el("p", "hint pv-foot", t("addon")));
    setTimeout(function () { try { pw.focus(); } catch (e) {} }, 0);
  }

  function renderLocked() {
    var card = el("div", "card pv-card");
    card.appendChild(el("h2", "pv-h", t("lock.title")));
    card.appendChild(el("p", "hint", t("lock.text")));
    var pw = secretInput("pv-master", "current-password");
    card.appendChild(labelled(t("create.pw"), showable(pw)));
    var err = el("p", "hint err"); err.setAttribute("role", "alert"); err.hidden = true;
    card.appendChild(err);
    var go = btn(t("lock.go"), "act primary wide");
    card.appendChild(go);
    var rk = btn(t("lock.useRk"), "link-btn");
    card.appendChild(rk);
    pw.addEventListener("keydown", function (e) { if (e.key === "Enter") go.click(); });
    go.addEventListener("click", function () {
      if (!pw.value) { pw.focus(); return; }
      var k = primary(), V = vaultOf(k);
      go.disabled = true; go.textContent = t("lock.busy"); err.hidden = true;
      PV.unlock(V, k, pw.value).then(function (s) {
        pw.value = "";
        startSession(s);
      }, function (e) {
        go.disabled = false; go.textContent = t("lock.go");
        err.textContent = e && e.message === "wrong-password" ? t("lock.wrong") :
                          (e && /^(no-wasm|no-argon2|bad-kdf)$/.test(e.message)) ? errText(e) : t("lock.fail");
        err.hidden = false;
        pw.select();
      });
    });
    rk.addEventListener("click", recoveryDialog);
    root.appendChild(card);
    setTimeout(function () { try { pw.focus(); } catch (e) {} }, 0);
  }

  function startSession(s) {
    session = s; snap = null; blobSnaps = {}; badBlobs = {}; weakCache = {};
    view = { mode: "list", id: null, query: "", filter: "all", tag: "" };
    touch();
    clear(root);
    root.appendChild(el("p", "hint pv-busy", t("lock.busy")));
    enqueue(settle).then(function () {
      if (pending && session) { var p = pending; pending = null; openEditor(null, p.password); return; }
      render();
    }, function (e) { toast(errText(e)); render(); });
  }

  function recoveryDialog() {
    var k = primary(), V = vaultOf(k);
    var d = dialog(t("rk.title"));
    if (!V || !V.rk) { d.body.appendChild(el("p", "hint", t("rk.none"))); d.actions(t("d.close")); return; }
    var key = textInput(); key.className = "mono"; key.placeholder = "XXXX-XXXX-…";
    var p1 = secretInput(null, "new-password"), p2 = secretInput(null, "new-password");
    d.body.appendChild(labelled(t("rk.key"), key));
    d.body.appendChild(labelled(t("rk.newPw"), showable(p1)));
    var meter = meterBox(); d.body.appendChild(meter);
    p1.addEventListener("input", function () { meter.update(p1.value); });
    d.body.appendChild(labelled(t("create.pw2"), p2));
    var err = d.error();
    d.actions(t("d.cancel"), t("rk.go"), function (done) {
      var problem = masterProblem(p1.value, p2.value);
      if (problem) { err(problem); return done(false); }
      PV.rewrap(V, k, { recovery: key.value }, p1.value).then(function (r) {
        return enqueue(function () {
          var latest = readStored();
          var next = PV.withVault(latest, k, r.vault);
          writeStored(next); slice = next; markDirty();
        }).then(function () {
          key.value = p1.value = p2.value = "";
          done(true);
          toast(t("cpw.done"));
          startSession(r.session);
        });
      }).catch(function (e) {
        err(e && e.message === "wrong-recovery" ? t("rk.wrong") : errText(e));
        done(false);
      });
    });
  }

  function showRecovery(code) {
    var d = dialog(t("rk.show.title"), { modal: true });
    d.body.appendChild(el("p", "hint", t("rk.show.text")));
    var box = el("p", "mono pv-rk", code);
    d.body.appendChild(box);
    var row = el("div", "pv-row");
    row.appendChild(btn(t("rk.show.copy"), "act", function () { copySecret(code, true); }));
    row.appendChild(btn(t("rk.show.save"), "act", function () {
      saveFile(new Blob([t("rk.file", { key: code })], { type: "text/plain" }), "oros-passwords-recovery-key.txt", "text/plain", "txt");
    }));
    d.body.appendChild(row);
    var ack = el("label", "pv-check");
    var cb = el("input"); cb.type = "checkbox";
    ack.appendChild(cb); ack.appendChild(el("span", "", t("rk.show.ok")));
    d.body.appendChild(ack);
    var ok = d.actions(null, t("d.close"), function (done) { code = null; box.textContent = ""; done(true); });
    ok.disabled = true;
    cb.addEventListener("change", function () { ok.disabled = !cb.checked; });
  }

  // ---------- 6. Open vault ----------
  function entries() { return snap ? snap.e : []; }
  function byId(id) { return entries().filter(function (e) { return e.id === id; })[0] || null; }
  function isWeak(e) {
    if (!e.pw) return false;
    if (weakCache[e.pw] === undefined) { var a = P.audit(e.pw); weakCache[e.pw] = a ? a.score : 4; }
    return weakCache[e.pw] < 2;
  }

  function renderOpen() {
    clearInterval(totpTimer); totpTimer = null;
    if (view.mode === "view" && byId(view.id)) { renderEntry(byId(view.id)); return; }
    if (view.mode === "edit") return;           // the editor stays as it is (a sync does not wipe typing)
    view.mode = "list";
    clear(root);
    var others = Object.keys(slice.vaults).filter(function (k) { return k !== session.kid; });
    if (others.length) root.appendChild(otherBanner(others[0]));
    if (Object.keys(badBlobs).length) {
      root.appendChild(el("p", "warn", t("err.badFile")));
    }
    var bar = el("div", "pv-toolbar");
    var q = el("input", "pv-search");
    q.type = "search"; q.id = "pv-search"; q.placeholder = t("open.search"); q.setAttribute("aria-label", t("open.search"));
    q.autocomplete = "off"; q.spellcheck = false; q.value = view.query;
    bar.appendChild(q);
    bar.appendChild(btn(t("open.new"), "act primary", function () { openEditor(null); }));
    var menuBtn = btn("⋯", "act pv-more", function () { openMenu(menuBtn); });
    menuBtn.setAttribute("aria-label", t("open.menu")); menuBtn.title = t("open.menu");
    menuBtn.setAttribute("aria-haspopup", "menu");
    bar.appendChild(menuBtn);
    var lockBtn = btn(null, "act pv-lock", function () { lock(false); toast(t("locked")); });
    lockBtn.appendChild(padlock());
    lockBtn.setAttribute("aria-label", t("open.lock")); lockBtn.title = t("open.lock");
    bar.appendChild(lockBtn);
    root.appendChild(bar);

    var chips = el("div", "pv-chips");
    chips.setAttribute("role", "radiogroup");
    ["all", "fav", "totp", "weak", "reused"].forEach(function (f) {
      var c = btn(t("f." + f), "chip", function () { view.filter = f; renderList(); syncChips(); });
      c.setAttribute("role", "radio"); c.setAttribute("data-f", f);
      chips.appendChild(c);
    });
    var tags = PC.allTags(entries());
    if (tags.length) {
      var sel = el("select", "chip-select");
      sel.setAttribute("aria-label", t("f.tag"));
      var o0 = el("option", "", t("f.anyTag")); o0.value = ""; sel.appendChild(o0);
      tags.forEach(function (tg) { var o = el("option", "", tg); o.value = tg; sel.appendChild(o); });
      if (tags.indexOf(view.tag) < 0) view.tag = "";
      sel.value = view.tag;
      sel.addEventListener("change", function () { view.tag = sel.value; renderList(); });
      chips.appendChild(sel);
    }
    root.appendChild(chips);
    function syncChips() {
      Array.prototype.forEach.call(chips.querySelectorAll(".chip"), function (c) {
        c.setAttribute("aria-checked", c.getAttribute("data-f") === view.filter ? "true" : "false");
      });
    }
    syncChips();
    var count = el("p", "hint pv-count"); count.id = "pv-count";
    root.appendChild(count);
    var ul = el("ul", "pv-list"); ul.id = "pv-list";
    root.appendChild(ul);
    q.addEventListener("input", function () { view.query = q.value; renderList(); });
    renderList();
  }

  function renderList() {
    var ul = $("pv-list"), count = $("pv-count");
    if (!ul) return;
    clear(ul);
    var all = entries();
    if (!all.length) { count.textContent = ""; ul.appendChild(el("li", "pv-empty hint", t("list.empty"))); return; }
    var re = view.filter === "reused" ? PC.reused(all) : null;
    var list = PC.sortEntries(all.filter(function (e) {
      if (view.tag && e.tags.indexOf(view.tag) < 0 && !e.tags.some(function (x) { return x.indexOf(view.tag + "/") === 0; })) return false;
      if (view.filter === "fav" && !e.fav) return false;
      if (view.filter === "totp" && !e.totp) return false;
      if (view.filter === "weak" && !isWeak(e)) return false;
      if (re && !re[e.id]) return false;
      return PC.matches(e, view.query);
    }));
    count.textContent = list.length === 1 ? t("list.count1") : t("list.count", { n: list.length });
    if (!list.length) { ul.appendChild(el("li", "pv-empty hint", t("list.none"))); return; }
    list.forEach(function (e) {
      var li = el("li");
      var b = btn(null, "pv-item");
      var host = PC.hostOf(e);
      var badge = el("span", "pv-badge", ((e.title || host || e.user || "?").trim().charAt(0) || "?").toUpperCase());
      badge.setAttribute("aria-hidden", "true");
      b.appendChild(badge);
      var txt = el("span", "pv-item-text");
      txt.appendChild(el("span", "pv-item-title", (e.fav ? "★ " : "") + (e.title || host || t("v.untitled"))));
      txt.appendChild(el("span", "pv-item-sub", [e.user, host].filter(Boolean).join(" · ")));
      b.appendChild(txt);
      var flags = el("span", "pv-flags");
      if (e.totp) flags.appendChild(el("span", "pv-flag", t("badge.totp")));
      if (view.filter === "weak") flags.appendChild(el("span", "pv-flag warnf", t("badge.weak")));
      if (re) flags.appendChild(el("span", "pv-flag warnf", t("badge.reused")));
      b.appendChild(flags);
      b.addEventListener("click", function () { view.mode = "view"; view.id = e.id; renderOpen(); });
      li.appendChild(b);
      ul.appendChild(li);
    });
  }

  function otherBanner(k) {
    var box = el("div", "warn pv-other");
    box.appendChild(el("p", "", t("other.text")));
    var row = el("div", "pv-row");
    row.appendChild(btn(t("other.merge"), "act", function () {
      var d = dialog(t("other.merge"));
      var pw = secretInput(null, "off");
      d.body.appendChild(labelled(t("other.pw"), showable(pw)));
      var err = d.error();
      d.actions(t("d.cancel"), t("imp.open"), function (done) {
        var V = vaultOf(k);
        if (!V) return done(true);
        PV.unlock(V, k, pw.value).then(function (s) {
          var p = Promise.resolve(PC.emptySnap());
          Object.keys(V.blobs).forEach(function (id) {
            p = p.then(function (acc) {
              return PV.openBlob(s, id, V.blobs[id]).then(function (o) { return PC.mergeSnap(acc, o); }, function () { return acc; });
            });
          });
          return p;
        }).then(function (theirs) {
          return save(function (mine) { return PC.mergeSnap(mine, theirs); }).then(function () {
            return enqueue(function () {
              var next = PV.withGone(readStored(), k);
              writeStored(next); slice = next; markDirty();
            });
          }).then(function () {
            done(true);
            toast(t("other.done", { n: theirs.e.length }));
            render();
          });
        }).catch(function (e) {
          err(e && e.message === "wrong-password" ? t("lock.wrong") : errText(e));
          done(false);
        });
      });
    }));
    row.appendChild(btn(t("other.delete"), "act danger", function () {
      confirmDialog(t("other.delete"), t("other.confirm"), t("d.delete")).then(function (yes) {
        if (!yes) return;
        enqueue(function () { var next = PV.withGone(readStored(), k); writeStored(next); slice = next; markDirty(); })
          .then(render, function (e) { toast(errText(e)); });
      });
    }));
    box.appendChild(row);
    return box;
  }

  // ---------- 7. Entry view ----------
  function rowCopy(label, value, opts) {
    opts = opts || {};
    var row = el("div", "pv-field");
    row.appendChild(el("span", "pv-field-label", label));
    var val = el("span", "pv-field-value" + (opts.mono ? " mono" : ""));
    var shown = !opts.secret;
    function paint() { val.textContent = shown ? value : "••••••••••"; }
    paint();
    row.appendChild(val);
    var acts = el("span", "pv-field-acts");
    if (opts.secret) {
      var sb = btn(t("v.show"), "act small", function () {
        shown = !shown; paint();
        sb.textContent = t(shown ? "v.hide" : "v.show");
        sb.setAttribute("aria-pressed", shown ? "true" : "false");
      });
      sb.setAttribute("aria-pressed", "false");
      acts.appendChild(sb);
    }
    if (opts.link) {
      var a = el("a", "act small", t("v.open"));
      a.href = opts.link; a.target = "_blank"; a.rel = "noopener noreferrer";
      acts.appendChild(a);
    }
    var cb = btn(t("v.copy"), "act small", function () { copySecret(value, !!opts.secret); });
    cb.setAttribute("aria-label", t("v.copy") + " " + label);
    acts.appendChild(cb);
    row.appendChild(acts);
    return row;
  }

  function renderEntry(e) {
    clear(root);
    var head = el("div", "pv-toolbar");
    head.appendChild(btn("‹ " + t("v.back"), "act", function () { view.mode = "list"; view.id = null; renderOpen(); }));
    head.appendChild(el("span", "pv-spacer"));
    head.appendChild(btn(t("v.edit"), "act primary", function () { openEditor(e); }));
    head.appendChild(btn(t("v.delete"), "act danger", function () { deleteEntry(e); }));
    root.appendChild(head);
    var card = el("div", "card pv-detail");
    card.appendChild(el("h2", "pv-title", (e.fav ? "★ " : "") + (e.title || PC.hostOf(e) || t("v.untitled"))));
    if (e.user) card.appendChild(rowCopy(t("v.user"), e.user, {}));
    if (e.pw) {
      var r = rowCopy(t("v.pw"), e.pw, { secret: true, mono: true });
      var a = P.audit(e.pw);
      if (a) {
        var s = el("span", "pv-score", app() ? app().scoreLabel(a.score) : "");
        s.setAttribute("data-score", String(a.score));
        r.querySelector(".pv-field-label").appendChild(s);
      }
      card.appendChild(r);
    }
    if (e.totp) card.appendChild(totpRow(e));
    e.urls.forEach(function (u) { card.appendChild(rowCopy(t("v.urls"), u, { link: PC.safeUrl(u) })); });
    e.fields.forEach(function (f) { card.appendChild(rowCopy(f.n || t("v.fields"), f.v, { secret: !!f.h, mono: !!f.h })); });
    if (e.notes) {
      var n = el("div", "pv-field pv-notes");
      n.appendChild(el("span", "pv-field-label", t("v.notes")));
      n.appendChild(el("div", "pv-notes-text", e.notes));
      card.appendChild(n);
    }
    if (e.tags.length) {
      var tg = el("div", "pv-tags");
      e.tags.forEach(function (x) { tg.appendChild(el("span", "pv-tag", x)); });
      card.appendChild(tg);
    }
    if (e.hist.length) {
      var det = el("details", "pv-hist");
      det.appendChild(el("summary", "", t("v.hist") + " (" + e.hist.length + ")"));
      e.hist.forEach(function (h) { det.appendChild(rowCopy(fmtDate(h.t), h.pw, { secret: true, mono: true })); });
      card.appendChild(det);
    }
    card.appendChild(el("p", "hint", t("v.modified", { d: fmtDate(e.m) }) + " · " + t("v.created", { d: fmtDate(e.c) })));
    root.appendChild(card);
  }

  function totpRow(e) {
    var row = el("div", "pv-field pv-totp");
    row.appendChild(el("span", "pv-field-label", t("v.totp")));
    var o = PC.parseOtp(e.totp);
    if (o.error) { row.appendChild(el("span", "hint err", t("v.badOtp"))); return row; }
    var code = el("span", "pv-code mono", "··· ···");
    code.setAttribute("aria-live", "off");
    row.appendChild(code);
    var ring = el("span", "pv-left");
    row.appendChild(ring);
    var cur = "";
    var acts = el("span", "pv-field-acts");
    acts.appendChild(btn(t("v.copy"), "act small", function () { if (cur) copySecret(cur, true); }));
    row.appendChild(acts);
    var lastStep = -1;
    function tick() {
      if (!session || !document.body.contains(row)) { clearInterval(totpTimer); totpTimer = null; return; }
      var now = Date.now(), step = Math.floor(now / 1000 / o.period);
      var left = o.period - Math.floor(now / 1000) % o.period;
      ring.textContent = t("v.left", { n: left });
      ring.style.setProperty("--p", String(left / o.period));
      row.classList.toggle("ending", left <= 5);
      if (step !== lastStep) {
        lastStep = step;
        PC.totp(o, now).then(function (r) {
          cur = r.code;
          code.textContent = r.code.length === 6 ? r.code.slice(0, 3) + " " + r.code.slice(3) :
                             r.code.slice(0, 4) + " " + r.code.slice(4);
        });
      }
    }
    tick();
    totpTimer = setInterval(tick, 1000);
    return row;
  }

  function deleteEntry(e) {
    confirmDialog(t("v.delete"), t("v.delConfirm", { t: e.title || t("v.untitled") }), t("d.delete")).then(function (yes) {
      if (!yes) return;
      var keep = JSON.parse(JSON.stringify(e));
      view.mode = "list"; view.id = null;
      save(function (s) { return PC.remove(s, e.id); }).then(function () {
        if (app()) app().undoToast(t("v.deleted"), t("v.undo"), function () {
          keep.m = Date.now();
          save(function (s) { return PC.upsert(s, keep); });
        });
      }, noop);
    });
  }

  // ---------- 8. Entry editor ----------
  function openEditor(e, presetPw) {
    clearInterval(totpTimer); totpTimer = null;
    view.mode = "edit";
    clear(root);
    var isNew = !e;
    var card = el("div", "card pv-edit");
    card.appendChild(el("h2", "pv-h", t(isNew ? "e.new" : "e.editing")));
    var title = textInput("pv-e-title"); title.value = e ? e.title : ""; title.maxLength = PC.LIM.title;
    card.appendChild(labelled(t("e.title"), title));
    var user = textInput("pv-e-user"); user.value = e ? e.user : ""; user.maxLength = PC.LIM.user;
    card.appendChild(labelled(t("e.user"), user));
    var pw = secretInput("pv-e-pw"); pw.value = e ? e.pw : (presetPw || ""); pw.maxLength = PC.LIM.pw;
    var pwWrap = labelled(t("e.pw"), showable(pw));
    card.appendChild(pwWrap);
    var gen = el("div", "pv-row pv-gen");
    gen.appendChild(el("span", "hint", t("e.gen") + ":"));
    gen.appendChild(btn(t("e.genPw"), "act small", function () { genInto("pw"); }));
    gen.appendChild(btn(t("e.genPh"), "act small", function () { genInto("ph"); }));
    card.appendChild(gen);
    card.appendChild(el("p", "hint", t("e.genHint")));
    var meter = meterBox(); card.appendChild(meter);
    meter.update(pw.value);
    pw.addEventListener("input", function () { meter.update(pw.value); dirty = true; });
    function genInto(kind) {
      var v = app() && app().generate(kind);
      if (!v) return;
      pw.value = v; pw.type = "text";
      var sb = pw.parentNode.querySelector("button");
      if (sb) { sb.textContent = t("hide"); sb.setAttribute("aria-pressed", "true"); }
      meter.update(v); dirty = true;
    }
    var urls = el("textarea", "pv-ta"); urls.id = "pv-e-urls"; urls.rows = 2; urls.value = e ? e.urls.join("\n") : "";
    urls.spellcheck = false; urls.setAttribute("autocapitalize", "off");
    card.appendChild(labelled(t("e.urls"), urls));
    var totp = textInput("pv-e-totp"); totp.className = "mono"; totp.value = e ? e.totp : "";
    var totpRowEl = el("div", "pw-row");
    totpRowEl.appendChild(totp);
    totpRowEl.appendChild(btn(t("e.scan"), "act small", function () { scanDialog(function (text) { totp.value = text; dirty = true; checkTotp(); }); }));
    card.appendChild(labelled(t("e.totp"), totpRowEl));
    var totpMsg = el("p", "hint"); totpMsg.hidden = true; card.appendChild(totpMsg);
    function checkTotp() {
      var v = totp.value.trim();
      if (!v) { totpMsg.hidden = true; return true; }
      var o = PC.parseOtp(v);
      totpMsg.hidden = false;
      if (o.error) { totpMsg.className = "hint err"; totpMsg.textContent = t(o.error === "hotp" ? "e.hotp" : "e.badOtp"); return false; }
      totpMsg.className = "hint";
      totpMsg.textContent = "";
      PC.totp(o).then(function (r) { totpMsg.textContent = r.code + " · " + t("v.left", { n: r.left }); });
      return true;
    }
    totp.addEventListener("change", checkTotp);
    if (totp.value) checkTotp();
    var notes = el("textarea", "pv-ta"); notes.id = "pv-e-notes"; notes.rows = 4; notes.value = e ? e.notes : "";
    notes.maxLength = PC.LIM.notes;
    card.appendChild(labelled(t("e.notes"), notes));
    var tags = textInput("pv-e-tags"); tags.value = e ? e.tags.join(", ") : "";
    var dl = el("datalist"); dl.id = "pv-taglist";
    PC.allTags(entries()).forEach(function (x) { var o = el("option"); o.value = x; dl.appendChild(o); });
    tags.setAttribute("list", "pv-taglist");
    card.appendChild(labelled(t("e.tags"), tags));
    card.appendChild(dl);

    card.appendChild(el("h3", "pv-sub", t("e.fields")));
    var fl = el("div", "pv-fields");
    card.appendChild(fl);
    function addField(f) {
      var r = el("div", "pv-frow");
      var n = textInput(); n.placeholder = t("e.fName"); n.value = f ? f.n : ""; n.setAttribute("aria-label", t("e.fName"));
      var v = f && f.h ? secretInput() : textInput(); v.placeholder = t("e.fValue"); v.value = f ? f.v : "";
      v.setAttribute("aria-label", t("e.fValue"));
      var hl = el("label", "pv-check small");
      var hc = el("input"); hc.type = "checkbox"; hc.checked = !!(f && f.h);
      hc.addEventListener("change", function () { v.type = hc.checked ? "password" : "text"; });
      hl.appendChild(hc); hl.appendChild(el("span", "", t("e.fHidden")));
      var rm = btn("×", "act small", function () { r.remove(); dirty = true; });
      rm.setAttribute("aria-label", t("e.fRemove"));
      r.appendChild(n); r.appendChild(v); r.appendChild(hl); r.appendChild(rm);
      r.read = function () { return { n: n.value, v: v.value, h: hc.checked ? 1 : 0 }; };
      fl.appendChild(r);
    }
    (e ? e.fields : []).forEach(addField);
    card.appendChild(btn("+ " + t("e.addField"), "link-btn", function () { addField(null); dirty = true; }));
    var favL = el("label", "pv-check");
    var fav = el("input"); fav.type = "checkbox"; fav.checked = !!(e && e.fav);
    favL.appendChild(fav); favL.appendChild(el("span", "", t("e.fav")));
    card.appendChild(favL);
    var err = el("p", "hint err"); err.setAttribute("role", "alert"); err.hidden = true;
    card.appendChild(err);
    var acts = el("div", "pv-row pv-edit-acts");
    var dirty = !!presetPw;
    card.addEventListener("input", function () { dirty = true; });
    acts.appendChild(btn(t("e.cancel"), "act", function () {
      if (!dirty) return leave();
      confirmDialog(t("e.cancel"), t("e.discard"), t("d.ok")).then(function (y) { if (y) leave(); });
    }));
    var saveBtn = btn(t("e.save"), "act primary", function () {
      if (!checkTotp()) { err.textContent = t("e.badOtp"); err.hidden = false; totp.focus(); return; }
      var now = Date.now();
      var next = {
        id: e ? e.id : PC.newId(), c: e ? e.c : now, m: Math.max(now, e ? e.m + 1 : 0),
        title: title.value, user: user.value, pw: pw.value, notes: notes.value, totp: totp.value.trim(),
        urls: urls.value.split(/\r?\n/), tags: tags.value.split(","), fav: fav.checked ? 1 : 0,
        fields: Array.prototype.map.call(fl.children, function (r) { return r.read(); }), hist: e ? e.hist : []
      };
      next.hist = PC.withHistory(e, next, now);
      var n = PC.normEntry(next);
      if (!n || !(n.title || n.user || n.pw)) { err.textContent = t("e.empty"); err.hidden = false; return; }
      saveBtn.disabled = true;
      save(function (s) { return PC.upsert(s, n); }).then(function () {
        toast(t("e.saved"));
        view.mode = "view"; view.id = n.id;
        clearForm(); renderOpen();
      }, function () { saveBtn.disabled = false; });
    });
    acts.appendChild(saveBtn);
    card.appendChild(acts);
    root.appendChild(card);
    function clearForm() {
      Array.prototype.forEach.call(card.querySelectorAll("input, textarea"), function (i) { i.value = ""; });
    }
    function leave() {
      clearForm();
      view.mode = e ? "view" : "list"; view.id = e ? e.id : null;
      renderOpen();
    }
    setTimeout(function () { try { title.focus(); } catch (x) {} }, 0);
  }

  // QR: BarcodeDetector, else the vendored jsQR (Apache-2.0, loaded on
  // demand). The text is handed to the editor only, never stored.
  var jsqrP = null;
  function loadJsQR() {
    if (window.jsQR) return Promise.resolve(window.jsQR);
    if (jsqrP) return jsqrP;
    jsqrP = new Promise(function (resolve, reject) {
      var s = document.createElement("script");
      s.src = "../vendor/jsqr/jsQR.js";
      s.onload = function () { if (typeof window.jsQR === "function") resolve(window.jsQR); else reject(new Error("jsqr")); };
      s.onerror = function () { jsqrP = null; reject(new Error("jsqr")); };
      document.head.appendChild(s);
    });
    return jsqrP;
  }
  var detP = null;
  function detector() {
    if (detP) return detP;
    detP = Promise.resolve(null);
    if (typeof window.BarcodeDetector !== "function") return detP;
    var BD = window.BarcodeDetector;
    detP = (typeof BD.getSupportedFormats === "function" ? BD.getSupportedFormats() : Promise.resolve(["qr_code"]))
      .then(function (f) { return f && f.indexOf("qr_code") >= 0 ? new BD({ formats: ["qr_code"] }) : null; })
      .catch(function () { return null; });
    return detP;
  }
  var grab = null;
  function detectIn(src, w, h) {
    return detector().then(function (d) {
      if (d) return d.detect(src).then(function (l) { return (l && l[0] && l[0].rawValue) || ""; }, function () { return ""; });
      return loadJsQR().then(function (jsQR) {
        var k = Math.min(1, 800 / Math.max(w, h, 1));
        if (!grab) grab = document.createElement("canvas");
        grab.width = Math.max(1, Math.round(w * k)); grab.height = Math.max(1, Math.round(h * k));
        var g = grab.getContext("2d", { willReadFrequently: true });
        g.drawImage(src, 0, 0, grab.width, grab.height);
        var px = g.getImageData(0, 0, grab.width, grab.height);
        var r = jsQR(px.data, px.width, px.height, { inversionAttempts: "attemptBoth" });
        g.clearRect(0, 0, grab.width, grab.height);
        return r && r.data ? r.data : "";
      });
    });
  }
  function scanDialog(onText) {
    var d = dialog(t("scan.title"));
    var v = el("video", "pv-cam"); v.muted = true; v.setAttribute("playsinline", ""); v.hidden = true;
    d.body.appendChild(v);
    var msg = el("p", "hint"); msg.setAttribute("aria-live", "polite"); d.body.appendChild(msg);
    var row = el("div", "pv-row"); d.body.appendChild(row);
    var stream = null, live = false, timer = 0;
    function stop() {
      live = false; clearTimeout(timer);
      if (stream) stream.getTracks().forEach(function (tr) { try { tr.stop(); } catch (e) {} });
      stream = null; try { v.srcObject = null; } catch (e) {}
      v.hidden = true; cam.textContent = t("scan.camera");
    }
    function found(text) {
      if (!/^otpauth:\/\/totp\//i.test(text)) {
        msg.textContent = /^otpauth:\/\/hotp\//i.test(text) ? t("e.hotp") : t("scan.notOtp");
        return false;
      }
      stop();
      onText(text);
      toast(t("scan.found"));
      d.close();
      return true;
    }
    function loop() {
      if (!live) return;
      if (v.readyState < 2) { timer = setTimeout(loop, 200); return; }
      detectIn(v, v.videoWidth, v.videoHeight).then(function (text) {
        if (!live) return;
        if (text && found(text)) return;
        timer = setTimeout(loop, 200);
      }, function () { if (live) timer = setTimeout(loop, 500); });
    }
    var cam = btn(t("scan.camera"), "act", function () {
      if (live) { stop(); return; }
      if (!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia)) { msg.textContent = t("scan.denied"); return; }
      live = true; cam.textContent = t("scan.stop"); picking = true;
      navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" } }, audio: false }).then(function (st) {
        picking = false;
        if (!live) { st.getTracks().forEach(function (tr) { tr.stop(); }); return; }
        stream = st; v.srcObject = st; v.hidden = false;
        return v.play().then(function () { msg.textContent = t("scan.aim"); loop(); });
      }).catch(function () { picking = false; stop(); msg.textContent = t("scan.denied"); });
    });
    row.appendChild(cam);
    row.appendChild(btn(t("scan.file"), "act", function () {
      stop();
      pickFile("image/*").then(function (f) {
        if (!f) return;
        var url = URL.createObjectURL(f), img = new Image();
        img.onload = function () {
          detectIn(img, img.naturalWidth, img.naturalHeight).then(function (text) {
            URL.revokeObjectURL(url);
            if (!text) { msg.textContent = t("scan.none"); return; }
            found(text);
          }, function () { URL.revokeObjectURL(url); msg.textContent = t("scan.none"); });
        };
        img.onerror = function () { URL.revokeObjectURL(url); msg.textContent = t("scan.none"); };
        img.src = url;
      });
    }));
    d.onClose(stop);
    d.actions(t("d.close"));
  }

  // ---------- 9. Menu ----------
  function openMenu(anchor) {
    var d = dialog(t("open.menu"));
    var list = el("div", "pv-menu");
    list.setAttribute("role", "menu");
    [["m.import", importDialog], ["m.export", exportDialog], ["m.changePw", changePwDialog],
     ["m.newRk", newRkDialog], ["m.settings", settingsDialog], ["m.delete", deleteVaultDialog],
     ["m.lock", function () { lock(false); toast(t("locked")); }]].forEach(function (it) {
      var b = btn(t(it[0]), "pv-menu-item" + (it[0] === "m.delete" ? " danger" : ""), function () { d.close(); it[1](); });
      b.setAttribute("role", "menuitem");
      list.appendChild(b);
    });
    d.body.appendChild(list);
    d.actions(t("d.close"));
    var first = list.querySelector("button"); if (first) first.focus();
  }

  function importDialog() {
    var d = dialog(t("imp.title"));
    d.body.appendChild(el("p", "hint", t("imp.text")));
    var kind = "bw";
    var opts = el("div", "pv-radios");
    [["bw", "imp.bw"], ["kdbx", "imp.kdbx"], ["csv", "imp.csv"]].forEach(function (o, i) {
      var l = el("label", "pv-check");
      var r = el("input"); r.type = "radio"; r.name = "pv-imp"; r.value = o[0]; r.checked = i === 0;
      r.addEventListener("change", function () { kind = o[0]; kx.hidden = kind !== "kdbx"; });
      l.appendChild(r); l.appendChild(el("span", "", t(o[1])));
      opts.appendChild(l);
    });
    d.body.appendChild(opts);
    var kx = el("div", "pv-kx"); kx.hidden = true;
    var kpw = secretInput(null, "off");
    kx.appendChild(labelled(t("imp.kdbxPw"), showable(kpw)));
    var keyFile = null;
    var kfRow = el("div", "pv-row");
    var kfName = el("span", "hint", t("imp.keyNone"));
    kfRow.appendChild(btn(t("imp.keyPick"), "act small", function () {
      pickFile("").then(function (f) {
        if (!f) return;
        return f.arrayBuffer().then(function (b) { keyFile = new Uint8Array(b); kfName.textContent = f.name; });
      });
    }));
    kfRow.appendChild(kfName);
    kx.appendChild(el("span", "fld-label", t("imp.keyFile")));
    kx.appendChild(kfRow);
    d.body.appendChild(kx);
    var status = el("p", "hint"); status.setAttribute("aria-live", "polite"); d.body.appendChild(status);
    var err = d.error();
    var found = null;
    var go = d.actions(t("d.cancel"), t("imp.pick"), function (done) {
      if (found) {
        var list = found;
        save(function (s) { var x = s; list.forEach(function (e) { x = PC.upsert(x, e); }); return x; }).then(function () {
          done(true);
          toast(t("imp.done", { n: list.length }) + (kind !== "kdbx" ? " " + t("imp.delete") : ""));
        }, function () { done(false); });
        return;
      }
      var accept = kind === "bw" ? ".json,application/json" : kind === "csv" ? ".csv,text/csv" : ".kdbx";
      pickFile(accept).then(function (f) {
        if (!f) return done(false);
        status.textContent = t("imp.reading");
        var p = kind === "kdbx"
          ? f.arrayBuffer().then(function (b) {
              return KX.read(new Uint8Array(b), { password: kpw.value, keyFile: keyFile });
            })
          : f.text().then(function (txt) {
              var r = kind === "bw" ? PC.fromBitwarden(txt) : PC.fromCsv(txt);
              if (r.error) throw new Error(r.error);
              return r;
            });
        return p.then(function (r) {
          kpw.value = ""; keyFile = null;
          var dd = PC.dedupe(entries(), r.entries);
          var lines = [t("imp.summary", { n: dd.entries.length, d: dd.duplicates, s: r.skipped || 0 })];
          if (r.attachments) lines.push(t("imp.attach", { a: r.attachments }));
          if (r.recycled) lines.push(t("imp.recycle", { r: r.recycled }));
          status.textContent = lines.join(" ");
          found = dd.entries;
          opts.hidden = true; kx.hidden = true;
          go.textContent = t("imp.go", { n: found.length });
          go.disabled = !found.length;
          done(false);
        });
      }).catch(function (e) { status.textContent = ""; err(errText(e)); done(false); });
    });
  }

  function verifyMaster(pw) {
    var V = vaultOf(session.kid);
    return PV.unlock(V, session.kid, pw).then(function () { return true; });
  }

  function exportDialog() {
    var d = dialog(t("exp.title"));
    var kind = "kdbx";
    var opts = el("div", "pv-radios");
    [["kdbx", "exp.kdbx"], ["bw", "exp.bw"]].forEach(function (o, i) {
      var l = el("label", "pv-check");
      var r = el("input"); r.type = "radio"; r.name = "pv-exp"; r.value = o[0]; r.checked = i === 0;
      r.addEventListener("change", function () { kind = o[0]; kx.hidden = kind !== "kdbx"; bw.hidden = kind !== "bw"; });
      l.appendChild(r); l.appendChild(el("span", "", t(o[1])));
      opts.appendChild(l);
    });
    d.body.appendChild(opts);
    var kx = el("div");
    var p1 = secretInput(null, "new-password"), p2 = secretInput(null, "new-password");
    kx.appendChild(labelled(t("exp.kdbxPw"), showable(p1)));
    kx.appendChild(labelled(t("create.pw2"), p2));
    kx.appendChild(el("p", "hint", t("exp.kdbxHint")));
    d.body.appendChild(kx);
    var bw = el("div"); bw.hidden = true;
    bw.appendChild(el("p", "warn", t("exp.warn")));
    var ackL = el("label", "pv-check"), ack = el("input"); ack.type = "checkbox";
    ackL.appendChild(ack); ackL.appendChild(el("span", "", t("exp.ack")));
    bw.appendChild(ackL);
    d.body.appendChild(bw);
    var master = secretInput(null, "current-password");
    d.body.appendChild(labelled(t("exp.master"), showable(master)));
    var err = d.error();
    var go = d.actions(t("d.cancel"), t("exp.go"), function (done) {
      if (kind === "kdbx") {
        if (p1.value.length < 8) { err(t("create.short", { n: 8 })); return done(false); }
        if (p1.value !== p2.value) { err(t("create.mismatch")); return done(false); }
      } else if (!ack.checked) { err(t("exp.ack")); return done(false); }
      go.textContent = t("exp.busy");
      var list = entries().slice();
      var stamp = new Date().toISOString().slice(0, 10);
      verifyMaster(master.value).then(function () {
        master.value = "";
        if (kind === "bw") {
          return saveFile(new Blob([PC.toBitwarden(list)], { type: "application/json" }),
                          "oros-passwords-" + stamp + ".json", "application/json", "json");
        }
        return KX.write(list, p1.value).then(function (bytes) {
          p1.value = p2.value = "";
          return saveFile(new Blob([bytes], { type: "application/octet-stream" }),
                          "oros-passwords-" + stamp + ".kdbx", "application/octet-stream", "kdbx");
        });
      }).then(function (r) {
        if (r && r.ok) toast(t("exp.done", { n: list.length }));
        done(true);
      }).catch(function (e) {
        go.textContent = t("exp.go");
        err(e && e.message === "wrong-password" ? t("lock.wrong") : errText(e));
        done(false);
      });
    });
  }

  function changePwDialog() {
    var d = dialog(t("cpw.title"));
    var cur = secretInput(null, "current-password"), p1 = secretInput(null, "new-password"), p2 = secretInput(null, "new-password");
    d.body.appendChild(labelled(t("cpw.cur"), showable(cur)));
    d.body.appendChild(labelled(t("cpw.new"), showable(p1)));
    var meter = meterBox(); d.body.appendChild(meter);
    p1.addEventListener("input", function () { meter.update(p1.value); });
    d.body.appendChild(labelled(t("cpw.again"), p2));
    d.body.appendChild(el("p", "hint", t("cpw.note")));
    var err = d.error();
    d.actions(t("d.cancel"), t("cpw.go"), function (done) {
      var problem = masterProblem(p1.value, p2.value);
      if (problem) { err(problem); return done(false); }
      var k = session.kid;
      PV.rewrap(vaultOf(k), k, { password: cur.value }, p1.value).then(function (r) {
        return enqueue(function () {
          var next = PV.withVault(readStored(), k, r.vault);
          writeStored(next); slice = next; markDirty();
        });
      }).then(function () {
        cur.value = p1.value = p2.value = "";
        done(true); toast(t("cpw.done"));
      }).catch(function (e) {
        err(e && e.message === "wrong-password" ? t("lock.wrong") : errText(e));
        done(false);
      });
    });
  }

  function newRkDialog() {
    var d = dialog(t("nrk.title"));
    d.body.appendChild(el("p", "hint", t("nrk.text")));
    var cur = secretInput(null, "current-password");
    d.body.appendChild(labelled(t("exp.master"), showable(cur)));
    var err = d.error();
    d.actions(t("d.cancel"), t("d.ok"), function (done) {
      var k = session.kid;
      PV.newRecovery(vaultOf(k), k, cur.value).then(function (r) {
        return enqueue(function () {
          var next = PV.withVault(readStored(), k, r.vault);
          writeStored(next); slice = next; markDirty();
        }).then(function () { cur.value = ""; done(true); showRecovery(r.recovery); });
      }).catch(function (e) {
        err(e && e.message === "wrong-password" ? t("lock.wrong") : errText(e));
        done(false);
      });
    });
  }

  function settingsDialog() {
    var d = dialog(t("set.title"));
    var pr = prefs();
    var sel = el("select");
    [1, 2, 5, 15, 30, 60].forEach(function (n) { var o = el("option", "", t("set.min", { n: n })); o.value = String(n); sel.appendChild(o); });
    sel.value = String(pr.lock || 5);
    d.body.appendChild(labelled(t("set.after"), sel));
    var hl = el("label", "pv-check"), hc = el("input"); hc.type = "checkbox"; hc.checked = !!pr.lockHide;
    hl.appendChild(hc); hl.appendChild(el("span", "", t("set.hide")));
    d.body.appendChild(hl);
    d.body.appendChild(el("p", "hint", t("set.clip")));
    sel.addEventListener("change", function () { if (app()) app().setLockPrefs(parseInt(sel.value, 10), hc.checked ? 1 : 0); });
    hc.addEventListener("change", function () { if (app()) app().setLockPrefs(parseInt(sel.value, 10), hc.checked ? 1 : 0); });
    d.actions(t("d.close"));
  }

  function deleteVaultDialog() {
    var d = dialog(t("del.title"));
    d.body.appendChild(el("p", "warn", t("del.text")));
    var cur = secretInput(null, "current-password");
    d.body.appendChild(labelled(t("exp.master"), showable(cur)));
    var err = d.error();
    var go = d.actions(t("d.cancel"), t("del.go"), function (done) {
      var k = session.kid;
      verifyMaster(cur.value).then(function () {
        cur.value = "";
        return enqueue(function () {
          var next = PV.withGone(readStored(), k);
          writeStored(next); slice = next; markDirty();
        });
      }).then(function () { done(true); lock(false); toast(t("del.done")); })
        .catch(function (e) { err(e && e.message === "wrong-password" ? t("lock.wrong") : errText(e)); done(false); });
    });
    go.classList.add("danger");
  }

  // ---------- 10. Dialog + file helpers ----------
  var openDialogs = [];
  function closeDialogs() { openDialogs.slice().forEach(function (d) { try { d.close(); } catch (e) {} }); }
  // dialog(title) → { body, error(), actions(cancel, ok, onOk(done)), close(), onClose(fn) }
  function dialog(title, opts) {
    var d = el("dialog", "pv-dlg");
    d.setAttribute("aria-label", title);
    d.appendChild(el("h2", "pv-dlg-title", title));
    var body = el("div", "pv-dlg-body"); d.appendChild(body);
    var foot = el("div", "pv-dlg-actions"); d.appendChild(foot);
    var closers = [];
    var api = {
      body: body,
      close: function () { if (d.open) d.close(); },
      onClose: function (fn) { closers.push(fn); },
      error: function () {
        var p = el("p", "hint err"); p.setAttribute("role", "alert"); p.hidden = true; body.appendChild(p);
        return function (msg) { p.textContent = msg; p.hidden = !msg; };
      },
      actions: function (cancelLabel, okLabel, onOk) {
        clear(foot);
        if (cancelLabel) foot.appendChild(btn(cancelLabel, "act", function () { api.close(); }));
        if (!okLabel) return null;
        var ok = btn(okLabel, "act primary", function () {
          if (!onOk) { api.close(); return; }
          ok.disabled = true;
          onOk(function (closeIt) { ok.disabled = false; if (closeIt) api.close(); });
        });
        foot.appendChild(ok);
        body.addEventListener("keydown", function (e) {
          if (e.key === "Enter" && e.target.tagName === "INPUT" && e.target.type !== "checkbox" && e.target.type !== "radio" && !ok.disabled) {
            e.preventDefault(); ok.click();
          }
        });
        return ok;
      }
    };
    if (opts && opts.modal) d.addEventListener("cancel", function (e) { e.preventDefault(); });
    d.addEventListener("close", function () {
      // Wipe what was typed before the node goes.
      Array.prototype.forEach.call(d.querySelectorAll("input"), function (i) {
        if (i.type !== "checkbox" && i.type !== "radio") i.value = "";
      });
      closers.forEach(function (fn) { try { fn(); } catch (e) {} });
      openDialogs = openDialogs.filter(function (x) { return x !== api; });
      setTimeout(function () { d.remove(); }, 0);
    });
    document.body.appendChild(d);
    openDialogs.push(api);
    d.showModal();
    return api;
  }
  function confirmDialog(title, text, okLabel) {
    return new Promise(function (resolve) {
      var d = dialog(title), answered = false;
      d.body.appendChild(el("p", "", text));
      var ok = d.actions(t("d.cancel"), okLabel, function (done) { answered = true; resolve(true); done(true); });
      if (okLabel === t("d.delete")) ok.classList.add("danger");
      d.onClose(function () { if (!answered) resolve(false); });
      ok.focus();
    });
  }

  function dialogHost() {
    try { if (window.parent && window.parent !== window && window.parent.orosDialog) return window.parent.orosDialog; } catch (e) {}
    return null;
  }
  function pickFile(accept) {
    picking = true;
    var host = dialogHost();
    var p;
    if (host && typeof host.openFile === "function") p = host.openFile(accept);
    else p = new Promise(function (resolve) {
      var i = el("input"); i.type = "file"; if (accept) i.accept = accept; i.hidden = true;
      i.addEventListener("change", function () { resolve(i.files && i.files[0] || null); i.remove(); });
      i.addEventListener("cancel", function () { resolve(null); i.remove(); });
      document.body.appendChild(i);
      i.click();
    });
    return p.then(function (f) { picking = false; touch(); return f; }, function () { picking = false; return null; });
  }
  function saveFile(blob, name, mime, ext) {
    picking = true;
    var host = dialogHost();
    var p;
    if (host && typeof host.saveFile === "function") {
      var types = [{ description: ext.toUpperCase(), accept: {} }];
      types[0].accept[mime] = ["." + ext];
      p = host.saveFile({ blob: blob, filename: name, mime: mime, types: types });
    } else {
      var a = el("a"); a.href = URL.createObjectURL(blob); a.download = name;
      document.body.appendChild(a); a.click();
      setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
      p = Promise.resolve({ ok: true });
    }
    return p.then(function (r) { picking = false; touch(); return r; }, function (e) { picking = false; throw e; });
  }

  // ---------- 11. Boot ----------
  var PmApp = {
    // Called by passwords.js when the Vault tab is shown or left.
    show: function () { if (root) { root.hidden = false; touch(); render(); } },
    hide: function () { if (root) root.hidden = true; },
    lock: function () { lock(false); },
    isOpen: function () { return !!session; },
    // A generated password goes into a new entry (unlocks first if needed).
    addWithPassword: function (pw) {
      if (session) { openEditor(null, pw); return; }
      pending = { password: pw };
    },
    label: function () { return t("tab"); }
  };
  window.PmApp = PmApp;

  function boot() {
    root = $("vault");
    if (!root || !PV || !PC || !P) return;
    slice = readStored();
    if (KX && typeof KX.setArgon2Loader === "function") KX.setArgon2Loader(function () { return PV.loadArgon2(); });
    registerSync();
    ["pointerdown", "keydown", "wheel", "touchstart"].forEach(function (ev) {
      document.addEventListener(ev, touch, { passive: true, capture: true });
    });
    lockTimer = setInterval(checkIdle, 10000);
    document.addEventListener("visibilitychange", function () {
      if (document.visibilityState === "hidden" && session && prefs().lockHide && !picking) lock(true);
    });
    window.addEventListener("focus", function () { if (clip.pending && clip.waitFocus) clearClip(false); });
    window.addEventListener("pagehide", function () { lock(false); });
  }
  boot();
})();
