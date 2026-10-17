// ============================================================
// orOS QR Generator — App logic (v1.1.0)
// Make a QR code for a link, a WiFi network, a contact card, a
// calendar event, text, email, phone, SMS or a location; export it
// as PNG or SVG, copy, share, print, or save it into Files.
//   - encoder: qr-encode.js (own code, offline); formats: qr-payload.js
//   - "From…" fills the form from Contacts, Calendar or Bookmarks
//     (read-only: nothing is written to those apps, BR-W8-6)
//   - "Save to Files" writes the image into the orOS disk (orosFS)
//   - my codes (synced): name, type, fields and look
//   - look v1.1: dot style, corner (eye) style, a logo in the middle
//     (level H forced while there is one)
//   - Scan: camera or a picture (BarcodeDetector, else jsQR loaded on
//     use), what the code says (qr-scan.js) with actions: open an
//     http(s) link after showing it, add to Contacts / Calendar through
//     the shell, WiFi details, copy; recent scans on this device
//   - Many codes: one code per CSV row (qr-bulk.js) -> print sheet,
//     PDF (vendor/jspdf) or ZIP of PNGs (atelier/zip.js)
// Data:
//   - synced slice "qr" (oros-qr-data): saved codes LWW + tombstones
//     (R5, R17, R26)
//   - device-local (R10): oros-qr-prefs (open code, draft, PNG size),
//     oros-qr-scans (recent scans, ≤ 50)
// Sections:
//   1. Constants, i18n, helpers
//   2. Look (style) + saved codes: normalize, merge
//   3. Storage + prefs
//   4. Current code
//   5. Painting (preview + PNG)
//   6. Export: PNG, SVG, copy, share, Files, print, WiFi card
//   7. Form: types, fields, look
//   8. "From…" pickers (Contacts, Calendar, Bookmarks)
//  8b. Files in, logo   8c. Scanner   8d. Many codes
//   9. My codes
//  10. Dialogs + toasts
//  11. Keyboard (Contract Β)
//  12. Sync slice + palette
//  13. Wiring & boot
// ============================================================
(function () {
  "use strict";

  var STORAGE_KEY = "oros-qr-data";
  var PREFS_KEY   = "oros-qr-prefs";
  var DATA_VER    = 1;
  var NAME_LEN    = 40;
  var MAX_CODES   = 100;
  var CAPTION_LEN = 40;
  var PNG_SIZES   = [256, 512, 1024, 2048];
  var ECLS        = ["L", "M", "Q", "H"];
  var ID_RE       = /^[a-z0-9]{6,40}$/;
  var HEX_RE      = /^#[0-9a-f]{6}$/;
  var QR = window.orosQR, P = window.orosQRPayload;
  var TYPES = P.TYPES;
  var DEFAULT_STYLE = { ecl: "M", fg: "#000000", bg: "#ffffff", mg: 4, rd: false, cap: false, ct: "" };
  var DOTS        = ["square", "rounded", "dots"];
  var EYES        = ["square", "rounded", "circle"];
  var LOGO_FRAC   = 0.22;     // of the code's width (encoder max 0.25)
  var LOGO_PX     = 192;      // a logo is stored at most this big…
  var LOGO_LEN    = 80000;    // …and at most this many characters (it syncs)

  // ---------- 1. Constants, i18n, helpers ----------
  function appLang() {
    try {
      var l = localStorage.getItem("oros-lang") ||
              (window.parent && window.parent.orosLang) || "en";
      return l === "el" ? "el" : "en";
    } catch (e) { return "en"; }
  }
  // orosI18n (../i18n.js): the full language code, a pack language included.
  var LANG = window.orosI18n ? window.orosI18n.lang() : appLang();
  function loc() { return window.orosI18n ? window.orosI18n.locale(LANG) : (LANG === "el" ? "el-GR" : "en-GB"); }

  var STRINGS = {
    en: {
      "sec.type": "Type", "sec.content": "Content", "sec.look": "Look", "sec.mine": "My codes",
      "type.url": "Link", "type.wifi": "WiFi", "type.vcard": "Contact", "type.event": "Event",
      "type.text": "Text", "type.email": "Email", "type.phone": "Phone", "type.sms": "SMS", "type.geo": "Location",
      "f.url": "Web address", "f.text": "Text", "f.ssid": "Network name (SSID)", "f.sec": "Security",
      "f.pass": "Password", "f.hidden": "Hidden network",
      "sec.WPA": "WPA / WPA2 / WPA3", "sec.WEP": "WEP (old)", "sec.nopass": "None (open network)",
      "f.first": "First name", "f.last": "Last name", "f.org": "Company", "f.vcard.title": "Job title",
      "f.mobile": "Mobile", "f.phone": "Other phone", "f.email": "Email", "f.web": "Website",
      "f.street": "Street", "f.city": "City", "f.zip": "Postcode", "f.region": "Region", "f.country": "Country",
      "f.note": "Note", "f.event.title": "Title", "f.allDay": "All day", "f.date": "Starts", "f.start": "Time",
      "f.dateEnd": "Ends (optional)", "f.end": "End time", "f.location": "Location", "f.event.note": "Description",
      "f.to": "Email address", "f.subject": "Subject", "f.body": "Message", "f.number": "Phone number",
      "f.message": "Message", "f.lat": "Latitude", "f.lon": "Longitude",
      "pass.show": "Show password", "pass.hide": "Hide password",
      "err.need.url": "Type a web address.", "err.bad.url": "This doesn't look like a web address (http or https).",
      "err.need.text": "Type some text.", "err.need.ssid": "Type the network name.",
      "err.need.pass": "Type the password, or choose an open network.",
      "err.bad.pass": "A WPA password has at least 8 characters.",
      "err.need.name": "Type a name or a company.", "err.need.title": "Give the event a title.",
      "err.need.date": "Pick the date.", "err.need.time": "Pick the time, or tick “All day”.",
      "err.bad.end": "The end is before the start.", "err.need.email": "Type the email address.",
      "err.bad.email": "This doesn't look like an email address.", "err.need.number": "Type the phone number.",
      "err.bad.number": "Use digits, and + at the start for an international number.",
      "err.need.geo": "Type latitude and longitude.", "err.bad.geo": "Latitude is −90 to 90, longitude −180 to 180.",
      "err.too.long": "Too much content for a QR code. Shorten it, or lower the error correction.",
      "empty": "Fill in the fields to see your code.",
      "meter": "Version {v} · {n}×{n} · {p}% full",
      "cv.label": "QR code: {what}",
      "look.ecl": "Error correction", "ecl.L": "Low (7%)", "ecl.M": "Medium (15%)", "ecl.Q": "High (25%)", "ecl.H": "Highest (30%)",
      "look.ecl.hint": "Higher survives smudges and scratches, but the code gets denser.",
      "look.fg": "Code", "look.bg": "Background", "look.swap": "Swap colours", "look.reset": "Black on white",
      "look.margin": "Margin", "look.cap": "Caption under the code",
      "look.capText": "Caption", "look.capAuto": "Automatic",
      "warn.low": "Low contrast: some phones may not read this code.",
      "warn.inverted": "Light code on a dark background: many phones can't read it. Swap the colours.",
      "warn.margin": "Without a margin, scanning only works on a light background.",
      "btn.new": "New", "btn.save": "Save", "btn.png": "PNG", "btn.svg": "SVG", "btn.copy": "Copy",
      "btn.share": "Share", "btn.files": "Save to Files", "btn.print": "Print", "btn.card": "WiFi card",
      "png.size": "PNG size", "png.px": "{n} px",
      "from.url": "From Bookmarks", "from.vcard": "From Contacts", "from.event": "From Calendar",
      "pick.search": "Search…", "pick.none": "Nothing here yet.", "pick.noMatch": "No matches.",
      "pick.title.url": "Pick a bookmark", "pick.title.vcard": "Pick a contact", "pick.title.event": "Pick an event",
      "pick.allDay": "all day", "pick.filled": "Filled in from {app}",
      "app.bookmarks": "Bookmarks", "app.contacts": "Contacts", "app.calendar": "Calendar",
      "mine.empty": "Save a code to keep it here.",
      "mine.rename": "Rename {name}", "mine.copy": "Copy {name}", "mine.del": "Delete {name}",
      "draft": "New QR code", "copy.suffix": "{name} (copy)",
      "dlg.saveTitle": "Save QR code", "dlg.renameTitle": "Rename", "dlg.name": "Name",
      "dlg.save": "Save", "dlg.cancel": "Cancel",
      "files.title": "Save to Files", "files.sub": "Into the QR folder of Files.",
      "toast.saved": "QR code saved", "toast.deleted": "QR code deleted", "toast.undo": "Undo",
      "toast.newCode": "New QR code", "toast.maxCodes": "Up to {n} saved codes",
      "toast.save": "Could not save: storage is full", "toast.needName": "Give it a name",
      "toast.notReady": "Fill in the fields first",
      "toast.exported": "Exported {file}", "toast.copied": "Image copied",
      "toast.copyFail": "Could not copy the image", "toast.filesSaved": "Saved to Files › QR › {file}",
      "toast.filesFail": "Could not save to Files",
      "toast.gone": "Not found: it may have been deleted",
      "card.title": "WiFi", "card.network": "Network", "card.password": "Password",
      "card.scan": "Point your phone camera at the code to connect.",
      "look.dots": "Dots", "dot.square": "Square", "dot.rounded": "Rounded", "dot.dots": "Dots",
      "look.eyes": "Corners", "eye.square": "Square", "eye.rounded": "Rounded", "eye.circle": "Circle",
      "look.logo": "Logo", "logo.add": "Add a logo…", "logo.change": "Change logo", "logo.remove": "Remove logo",
      "logo.hint": "With a logo the error correction is set to Highest (30%), so phones still read the code.",
      "logo.bad": "Could not read that picture", "logo.big": "That picture is too large, even made smaller",
      "logo.alt": "Logo",
      "btn.scan": "Scan", "btn.bulk": "Many codes", "btn.close": "Close",
      "scan.title": "Scan a code", "scan.file": "Scan a picture…", "scan.camera": "Use the camera", "scan.stop": "Stop the camera",
      "scan.wait": "Starting the camera…", "scan.aim": "Point the camera at a QR code.",
      "scan.denied": "The camera is off or not allowed. You can still scan a picture.",
      "scan.noCam": "There is no camera here. Scan a picture of a code instead.",
      "scan.none": "No QR code found in that picture.", "scan.looking": "Looking for a code…",
      "scan.paste": "You can also paste a picture here.", "scan.again": "Scan another",
      "scan.history": "Recent scans", "scan.historyEmpty": "The codes you scan are kept here, on this device only.",
      "scan.clear": "Clear", "scan.cleared": "Recent scans cleared", "scan.del": "Remove {what}",
      "scan.removed": "Removed from recent scans",
      "kind.url": "Link", "kind.wifi": "WiFi network", "kind.vcard": "Contact", "kind.event": "Event", "kind.email": "Email",
      "kind.phone": "Phone number", "kind.sms": "SMS", "kind.geo": "Location", "kind.text": "Text",
      "res.opens": "This link opens:", "res.open": "Open link", "res.copy": "Copy text", "res.copyPass": "Copy password",
      "res.copySsid": "Copy network name", "res.contacts": "Add to Contacts", "res.vcf": "Save contact file",
      "res.calendar": "Add to Calendar", "res.ics": "Save event file", "res.make": "Make a QR code from this",
      "res.copied": "Copied", "res.copyFail": "Could not copy", "res.network": "Network", "res.security": "Security",
      "res.password": "Password", "res.hidden": "Hidden network", "res.yes": "yes", "res.name": "Name", "res.org": "Company",
      "res.phone": "Phone", "res.email": "Email", "res.when": "When", "res.where": "Where", "res.to": "To",
      "res.subject": "Subject", "res.number": "Number", "res.message": "Message", "res.coords": "Coordinates",
      "res.made": "New QR code from the scan", "res.allDay": "all day",
      "bulk.title": "Many codes from a table", "bulk.rows": "Rows (CSV): paste them, or open a file",
      "bulk.open": "Open CSV file…", "bulk.header": "The first row holds column names",
      "bulk.col": "Content of each code", "bulk.label": "Label under each code", "bulk.noLabel": "No label",
      "bulk.colN": "Column {n}", "bulk.grid": "Labels per page", "bulk.gridOpt": "{c} × {r} ({n} per page)",
      "bulk.count": "{n} codes", "bulk.empty": "{n} rows without content left out.", "bulk.empty1": "1 row without content left out.", "bulk.count1": "1 code",
      "bulk.more": "Only the first {max}: {n} more rows left out.", "bulk.tooLong": "Too long for a QR code, left out: row {rows}.",
      "bulk.none": "Paste rows or open a CSV file.", "bulk.print": "Print", "bulk.pdf": "PDF", "bulk.zip": "ZIP of PNGs",
      "bulk.look": "The codes use the look you set (colours, dots, corners, logo, margin).",
      "bulk.working": "Making {n} codes…", "bulk.fail": "Could not make the file", "bulk.readFail": "Could not read that file",
      "bulk.sheet": "QR labels"
    },
    el: {
      "sec.type": "Τύπος", "sec.content": "Περιεχόμενο", "sec.look": "Εμφάνιση", "sec.mine": "Τα QR μου",
      "type.url": "Σύνδεσμος", "type.wifi": "WiFi", "type.vcard": "Επαφή", "type.event": "Συμβάν",
      "type.text": "Κείμενο", "type.email": "Email", "type.phone": "Τηλέφωνο", "type.sms": "SMS", "type.geo": "Τοποθεσία",
      "f.url": "Διεύθυνση ιστού", "f.text": "Κείμενο", "f.ssid": "Όνομα δικτύου (SSID)", "f.sec": "Ασφάλεια",
      "f.pass": "Κωδικός", "f.hidden": "Κρυφό δίκτυο",
      "sec.WPA": "WPA / WPA2 / WPA3", "sec.WEP": "WEP (παλιό)", "sec.nopass": "Κανένα (ανοιχτό δίκτυο)",
      "f.first": "Όνομα", "f.last": "Επώνυμο", "f.org": "Εταιρεία", "f.vcard.title": "Θέση",
      "f.mobile": "Κινητό", "f.phone": "Άλλο τηλέφωνο", "f.email": "Email", "f.web": "Ιστότοπος",
      "f.street": "Οδός", "f.city": "Πόλη", "f.zip": "Τ.Κ.", "f.region": "Περιοχή", "f.country": "Χώρα",
      "f.note": "Σημείωση", "f.event.title": "Τίτλος", "f.allDay": "Ολοήμερο", "f.date": "Έναρξη", "f.start": "Ώρα",
      "f.dateEnd": "Λήξη (προαιρετικά)", "f.end": "Ώρα λήξης", "f.location": "Τοποθεσία", "f.event.note": "Περιγραφή",
      "f.to": "Διεύθυνση email", "f.subject": "Θέμα", "f.body": "Μήνυμα", "f.number": "Αριθμός τηλεφώνου",
      "f.message": "Μήνυμα", "f.lat": "Γεωγραφικό πλάτος", "f.lon": "Γεωγραφικό μήκος",
      "pass.show": "Εμφάνιση κωδικού", "pass.hide": "Απόκρυψη κωδικού",
      "err.need.url": "Γράψε μια διεύθυνση ιστού.", "err.bad.url": "Δεν μοιάζει με διεύθυνση ιστού (http ή https).",
      "err.need.text": "Γράψε κάποιο κείμενο.", "err.need.ssid": "Γράψε το όνομα του δικτύου.",
      "err.need.pass": "Γράψε τον κωδικό ή διάλεξε ανοιχτό δίκτυο.",
      "err.bad.pass": "Ο κωδικός WPA έχει τουλάχιστον 8 χαρακτήρες.",
      "err.need.name": "Γράψε ένα όνομα ή μια εταιρεία.", "err.need.title": "Δώσε τίτλο στο συμβάν.",
      "err.need.date": "Διάλεξε ημερομηνία.", "err.need.time": "Διάλεξε ώρα ή τσέκαρε «Ολοήμερο».",
      "err.bad.end": "Η λήξη είναι πριν από την έναρξη.", "err.need.email": "Γράψε τη διεύθυνση email.",
      "err.bad.email": "Δεν μοιάζει με διεύθυνση email.", "err.need.number": "Γράψε τον αριθμό τηλεφώνου.",
      "err.bad.number": "Χρησιμοποίησε ψηφία, και + στην αρχή για διεθνή αριθμό.",
      "err.need.geo": "Γράψε γεωγραφικό πλάτος και μήκος.", "err.bad.geo": "Το πλάτος είναι από −90 έως 90 και το μήκος από −180 έως 180.",
      "err.too.long": "Πολύ περιεχόμενο για QR. Κόψε λίγο ή χαμήλωσε τη διόρθωση σφαλμάτων.",
      "empty": "Συμπλήρωσε τα πεδία για να δεις το QR σου.",
      "meter": "Έκδοση {v} · {n}×{n} · {p}% γεμάτο",
      "cv.label": "Κωδικός QR: {what}",
      "look.ecl": "Διόρθωση σφαλμάτων", "ecl.L": "Χαμηλή (7%)", "ecl.M": "Μεσαία (15%)", "ecl.Q": "Υψηλή (25%)", "ecl.H": "Μέγιστη (30%)",
      "look.ecl.hint": "Όσο πιο υψηλή, τόσο αντέχει σε λεκέδες και γρατζουνιές, αλλά το QR γίνεται πιο πυκνό.",
      "look.fg": "QR", "look.bg": "Φόντο", "look.swap": "Αντιστροφή χρωμάτων", "look.reset": "Μαύρο σε λευκό",
      "look.margin": "Περιθώριο", "look.cap": "Λεζάντα κάτω από το QR",
      "look.capText": "Λεζάντα", "look.capAuto": "Αυτόματη",
      "warn.low": "Χαμηλή αντίθεση: μερικά κινητά ίσως δεν το διαβάσουν.",
      "warn.inverted": "Ανοιχτό QR σε σκούρο φόντο: πολλά κινητά δεν το διαβάζουν. Αντίστρεψε τα χρώματα.",
      "warn.margin": "Χωρίς περιθώριο, η σάρωση πετυχαίνει μόνο πάνω σε ανοιχτό φόντο.",
      "btn.new": "Νέο", "btn.save": "Αποθήκευση", "btn.png": "PNG", "btn.svg": "SVG", "btn.copy": "Αντιγραφή",
      "btn.share": "Κοινοποίηση", "btn.files": "Στα Αρχεία", "btn.print": "Εκτύπωση", "btn.card": "Κάρτα WiFi",
      "png.size": "Μέγεθος PNG", "png.px": "{n} px",
      "from.url": "Από Σελιδοδείκτες", "from.vcard": "Από Επαφές", "from.event": "Από Ημερολόγιο",
      "pick.search": "Αναζήτηση…", "pick.none": "Δεν υπάρχει τίποτα ακόμα.", "pick.noMatch": "Κανένα αποτέλεσμα.",
      "pick.title.url": "Διάλεξε σελιδοδείκτη", "pick.title.vcard": "Διάλεξε επαφή", "pick.title.event": "Διάλεξε συμβάν",
      "pick.allDay": "ολοήμερο", "pick.filled": "Συμπληρώθηκε από: {app}",
      "app.bookmarks": "Σελιδοδείκτες", "app.contacts": "Επαφές", "app.calendar": "Ημερολόγιο",
      "mine.empty": "Αποθήκευσε ένα QR για να το κρατήσεις εδώ.",
      "mine.rename": "Μετονομασία: {name}", "mine.copy": "Αντίγραφο: {name}", "mine.del": "Διαγραφή: {name}",
      "draft": "Νέο QR", "copy.suffix": "{name} (αντίγραφο)",
      "dlg.saveTitle": "Αποθήκευση QR", "dlg.renameTitle": "Μετονομασία", "dlg.name": "Όνομα",
      "dlg.save": "Αποθήκευση", "dlg.cancel": "Άκυρο",
      "files.title": "Αποθήκευση στα Αρχεία", "files.sub": "Στον φάκελο QR των Αρχείων.",
      "toast.saved": "Το QR αποθηκεύτηκε", "toast.deleted": "Το QR διαγράφηκε", "toast.undo": "Αναίρεση",
      "toast.newCode": "Νέο QR", "toast.maxCodes": "Έως {n} αποθηκευμένα QR",
      "toast.save": "Δεν αποθηκεύτηκε: ο χώρος είναι γεμάτος", "toast.needName": "Δώσε ένα όνομα",
      "toast.notReady": "Συμπλήρωσε πρώτα τα πεδία",
      "toast.exported": "Εξήχθη το {file}", "toast.copied": "Η εικόνα αντιγράφηκε",
      "toast.copyFail": "Η αντιγραφή της εικόνας απέτυχε", "toast.filesSaved": "Αποθηκεύτηκε στα Αρχεία › QR › {file}",
      "toast.filesFail": "Η αποθήκευση στα Αρχεία απέτυχε",
      "toast.gone": "Δεν βρέθηκε: ίσως διαγράφηκε",
      "card.title": "WiFi", "card.network": "Δίκτυο", "card.password": "Κωδικός",
      "card.scan": "Στρέψε την κάμερα του κινητού στο QR για να συνδεθείς.",
      "look.dots": "Κουκκίδες", "dot.square": "Τετράγωνες", "dot.rounded": "Στρογγυλεμένες", "dot.dots": "Τελείες",
      "look.eyes": "Γωνίες", "eye.square": "Τετράγωνες", "eye.rounded": "Στρογγυλεμένες", "eye.circle": "Κύκλοι",
      "look.logo": "Λογότυπο", "logo.add": "Προσθήκη λογότυπου…", "logo.change": "Αλλαγή λογότυπου", "logo.remove": "Αφαίρεση λογότυπου",
      "logo.hint": "Με λογότυπο η διόρθωση σφαλμάτων γίνεται Μέγιστη (30%), ώστε τα κινητά να διαβάζουν το QR.",
      "logo.bad": "Η εικόνα δεν διαβάστηκε", "logo.big": "Η εικόνα είναι πολύ μεγάλη, ακόμα και μικραμένη",
      "logo.alt": "Λογότυπο",
      "btn.scan": "Σάρωση", "btn.bulk": "Πολλά QR", "btn.close": "Κλείσιμο",
      "scan.title": "Σάρωση QR", "scan.file": "Σάρωση εικόνας…", "scan.camera": "Με την κάμερα", "scan.stop": "Διακοπή κάμερας",
      "scan.wait": "Η κάμερα ξεκινά…", "scan.aim": "Στρέψε την κάμερα σε ένα QR.",
      "scan.denied": "Η κάμερα είναι κλειστή ή δεν επιτρέπεται. Μπορείς να σαρώσεις μια εικόνα.",
      "scan.noCam": "Δεν υπάρχει κάμερα εδώ. Σάρωσε μια εικόνα του QR.",
      "scan.none": "Δεν βρέθηκε QR σε αυτή την εικόνα.", "scan.looking": "Αναζήτηση QR…",
      "scan.paste": "Μπορείς και να επικολλήσεις μια εικόνα εδώ.", "scan.again": "Νέα σάρωση",
      "scan.history": "Πρόσφατες σαρώσεις", "scan.historyEmpty": "Τα QR που σαρώνεις μένουν εδώ, μόνο σε αυτή τη συσκευή.",
      "scan.clear": "Καθαρισμός", "scan.cleared": "Οι πρόσφατες σαρώσεις καθαρίστηκαν", "scan.del": "Αφαίρεση: {what}",
      "scan.removed": "Αφαιρέθηκε από τις πρόσφατες σαρώσεις",
      "kind.url": "Σύνδεσμος", "kind.wifi": "Δίκτυο WiFi", "kind.vcard": "Επαφή", "kind.event": "Συμβάν", "kind.email": "Email",
      "kind.phone": "Αριθμός τηλεφώνου", "kind.sms": "SMS", "kind.geo": "Τοποθεσία", "kind.text": "Κείμενο",
      "res.opens": "Ο σύνδεσμος ανοίγει:", "res.open": "Άνοιγμα συνδέσμου", "res.copy": "Αντιγραφή κειμένου", "res.copyPass": "Αντιγραφή κωδικού",
      "res.copySsid": "Αντιγραφή ονόματος δικτύου", "res.contacts": "Προσθήκη στις Επαφές", "res.vcf": "Αποθήκευση αρχείου επαφής",
      "res.calendar": "Προσθήκη στο Ημερολόγιο", "res.ics": "Αποθήκευση αρχείου συμβάντος", "res.make": "Δημιουργία QR από αυτό",
      "res.copied": "Αντιγράφηκε", "res.copyFail": "Η αντιγραφή απέτυχε", "res.network": "Δίκτυο", "res.security": "Ασφάλεια",
      "res.password": "Κωδικός", "res.hidden": "Κρυφό δίκτυο", "res.yes": "ναι", "res.name": "Όνομα", "res.org": "Εταιρεία",
      "res.phone": "Τηλέφωνο", "res.email": "Email", "res.when": "Πότε", "res.where": "Πού", "res.to": "Προς",
      "res.subject": "Θέμα", "res.number": "Αριθμός", "res.message": "Μήνυμα", "res.coords": "Συντεταγμένες",
      "res.made": "Νέο QR από τη σάρωση", "res.allDay": "ολοήμερο",
      "bulk.title": "Πολλά QR από πίνακα", "bulk.rows": "Γραμμές (CSV): επικόλλησέ τες ή άνοιξε ένα αρχείο",
      "bulk.open": "Άνοιγμα αρχείου CSV…", "bulk.header": "Η πρώτη γραμμή έχει τα ονόματα των στηλών",
      "bulk.col": "Περιεχόμενο κάθε QR", "bulk.label": "Ετικέτα κάτω από κάθε QR", "bulk.noLabel": "Χωρίς ετικέτα",
      "bulk.colN": "Στήλη {n}", "bulk.grid": "Ετικέτες ανά σελίδα", "bulk.gridOpt": "{c} × {r} ({n} ανά σελίδα)",
      "bulk.count": "{n} QR", "bulk.empty": "Παραλείφθηκαν {n} γραμμές χωρίς περιεχόμενο.", "bulk.empty1": "Παραλείφθηκε 1 γραμμή χωρίς περιεχόμενο.", "bulk.count1": "1 QR",
      "bulk.more": "Μόνο τα πρώτα {max}: παραλείφθηκαν άλλες {n} γραμμές.", "bulk.tooLong": "Πολύ μεγάλο για QR, παραλείφθηκε: γραμμή {rows}.",
      "bulk.none": "Επικόλλησε γραμμές ή άνοιξε ένα αρχείο CSV.", "bulk.print": "Εκτύπωση", "bulk.pdf": "PDF", "bulk.zip": "ZIP με PNG",
      "bulk.look": "Τα QR παίρνουν την εμφάνιση που όρισες (χρώματα, κουκκίδες, γωνίες, λογότυπο, περιθώριο).",
      "bulk.working": "Δημιουργία {n} QR…", "bulk.fail": "Το αρχείο δεν δημιουργήθηκε", "bulk.readFail": "Το αρχείο δεν διαβάστηκε",
      "bulk.sheet": "Ετικέτες QR"
    }
  };

  if (window.orosI18n) window.orosI18n.table(STRINGS, "qr", LANG);

  function has(key) { return (STRINGS[LANG] && STRINGS[LANG][key] !== undefined) || STRINGS.en[key] !== undefined; }
  function t(key, params) {
    var p = STRINGS[LANG] || STRINGS.en;
    var s = p[key] !== undefined ? p[key] : (STRINGS.en[key] !== undefined ? STRINGS.en[key] : key);
    if (params) {
      Object.keys(params).forEach(function (k) {
        s = s.split("{" + k + "}").join(String(params[k]));
      });
    }
    return s;
  }
  function fieldLabel(type, key) { return t(has("f." + type + "." + key) ? "f." + type + "." + key : "f." + key); }

  function $(id) { return document.getElementById(id); }
  function cmpStr(x, y) { return x < y ? -1 : (x > y ? 1 : 0); }
  function isInt(v) { return typeof v === "number" && isFinite(v) && Math.floor(v) === v; }
  function clone(o) { return JSON.parse(JSON.stringify(o)); }

  function newId() {
    var r = new Uint32Array(2);
    crypto.getRandomValues(r);
    return Date.now().toString(36) + r[0].toString(36) + r[1].toString(36).slice(0, 4);
  }

  // BOOT MARKER
  (function () {
    var m = ((document.currentScript && document.currentScript.src) || "")
      .match(/[?&]v=([^&#]+)/);
    document.documentElement.lang = LANG;
    console.log("qr.js v" + (m ? m[1] : "?") + " boot");
  })();

  // ---------- 2. Look + saved codes ----------
  // v1.1 look keys, left out while at their default so older codes keep
  // their exact JSON: sd "dots" (rd stays true, so an older device shows
  // rounded dots), se eye style, sl logo (a small data: picture). They
  // come first and sort after "ecl": at equal mtime the copy that still
  // has them is the larger canonical JSON and wins over one an older
  // device stripped.
  function normStyle(s) {
    var x = (s && typeof s === "object") ? s : {};
    var fg = typeof x.fg === "string" && HEX_RE.test(x.fg.toLowerCase()) ? x.fg.toLowerCase() : DEFAULT_STYLE.fg;
    var bg = typeof x.bg === "string" && HEX_RE.test(x.bg.toLowerCase()) ? x.bg.toLowerCase() : DEFAULT_STYLE.bg;
    var out = {};
    if (x.sd === "dots") out.sd = "dots";
    if (EYES.indexOf(x.se) >= 0) out.se = x.se;
    if (typeof x.sl === "string" && x.sl.length <= LOGO_LEN && QR.logoSrcOk(x.sl)) out.sl = x.sl;
    var base = {
      ecl: ECLS.indexOf(x.ecl) >= 0 ? x.ecl : DEFAULT_STYLE.ecl,
      fg: fg, bg: bg,
      mg: isInt(x.mg) && x.mg >= 0 && x.mg <= 10 ? x.mg : DEFAULT_STYLE.mg,
      rd: x.rd === true,
      cap: x.cap === true,
      ct: typeof x.ct === "string" ? x.ct.replace(/\s+/g, " ").slice(0, CAPTION_LEN) : ""
    };
    if (out.sd) base.rd = true;
    Object.keys(base).forEach(function (k) { out[k] = base[k]; });
    return out;
  }
  // The drawing style of a look: dot / eye style, logo, level.
  function dotStyle(st) { return st.sd === "dots" ? "dots" : (st.rd ? "rounded" : "square"); }
  function eyeStyle(st) { return st.se || (dotStyle(st) === "square" ? "square" : "rounded"); }
  function effEcl(st) { return st.sl ? "H" : st.ecl; }
  function drawOpts(st) {
    return { margin: st.mg, round: st.rd, dot: dotStyle(st), eye: eyeStyle(st), logo: st.sl ? LOGO_FRAC : 0 };
  }
  function normName(s) {
    return typeof s === "string" ? s.replace(/\s+/g, " ").trim().slice(0, NAME_LEN) : "";
  }

  // saved = { id, m (mtime, ms), name, type, f (fields), st (look) }
  // data  = { ver: 1, codes: [saved…] sorted by id, tombs: { id: deletedAt } }
  function normSaved(x) {
    if (!x || typeof x !== "object" || typeof x.id !== "string" || !ID_RE.test(x.id) ||
        !isInt(x.m) || x.m < 0 || TYPES.indexOf(x.type) < 0) return null;
    var name = normName(x.name);
    if (!name) return null;
    return { id: x.id, m: x.m, name: name, type: x.type, f: P.normFields(x.type, x.f), st: normStyle(x.st) };
  }

  // LWW per code (newer m wins; equal m: the larger canonical JSON),
  // tombstones max-merged, delete wins ties, a newer edit resurrects
  // (R17). Symmetric and canonical (R5, R26).
  function mergeQR(A, B) {
    var a = A || {}, b = B || {};
    var tombs = {};
    [a.tombs, b.tombs].forEach(function (tm) {
      if (!tm || typeof tm !== "object") return;
      Object.keys(tm).forEach(function (id) {
        if (!ID_RE.test(id) || !isInt(tm[id]) || tm[id] < 0) return;
        if (!(id in tombs) || tm[id] > tombs[id]) tombs[id] = tm[id];
      });
    });
    var best = {};
    [a.codes, b.codes].forEach(function (list) {
      if (!Array.isArray(list)) return;
      list.forEach(function (raw) {
        var x = normSaved(raw);
        if (!x) return;
        var cur = best[x.id];
        if (!cur || x.m > cur.m ||
            (x.m === cur.m && JSON.stringify(x) > JSON.stringify(cur))) best[x.id] = x;
      });
    });
    var codes = [];
    Object.keys(best).sort(cmpStr).forEach(function (id) {
      if (id in tombs && tombs[id] >= best[id].m) return;
      codes.push(best[id]);
    });
    var sortedTombs = {};
    Object.keys(tombs).sort(cmpStr).forEach(function (id) { sortedTombs[id] = tombs[id]; });
    return { ver: DATA_VER, codes: codes, tombs: sortedTombs };
  }

  // ---------- 3. Storage + prefs ----------
  var data = null, prefs = null;

  function load() {
    var raw = null;
    try { raw = localStorage.getItem(STORAGE_KEY); } catch (e) {}
    if (raw) {
      try {
        var parsed = JSON.parse(raw);
        if (parsed && typeof parsed === "object" && Array.isArray(parsed.codes)) {
          data = mergeQR(parsed, parsed);
          return;
        }
      } catch (e) {}
      try { localStorage.setItem(STORAGE_KEY + "-broken", raw); } catch (e) {}
      try { console.error("[orOS] qr: unreadable data copied to " + STORAGE_KEY + "-broken"); } catch (e) {}
    }
    data = { ver: DATA_VER, codes: [], tombs: {} };
  }

  var saveFailShown = false;
  function saveNow() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
      saveFailShown = false;
    } catch (e) {
      if (!saveFailShown) { saveFailShown = true; showToast(t("toast.save")); }   // R30
    }
    if (window.__orosSyncApi) window.__orosSyncApi.dirty();
  }

  // prefs = { cur: saved id | null, draft: { type, fields: { type: f }, st }, png }
  function normDraft(d) {
    var x = (d && typeof d === "object") ? d : {};
    var fields = {};
    var src = (x.fields && typeof x.fields === "object") ? x.fields : {};
    TYPES.forEach(function (ty) { if (src[ty]) fields[ty] = P.normFields(ty, src[ty]); });
    return { type: TYPES.indexOf(x.type) >= 0 ? x.type : "url", fields: fields, st: normStyle(x.st) };
  }
  function loadPrefs() {
    var p = null;
    try { p = JSON.parse(localStorage.getItem(PREFS_KEY) || "null"); } catch (e) {}
    p = (p && typeof p === "object") ? p : {};
    prefs = {
      cur: typeof p.cur === "string" && ID_RE.test(p.cur) ? p.cur : null,
      draft: normDraft(p.draft),
      png: PNG_SIZES.indexOf(p.png) >= 0 ? p.png : 1024
    };
  }
  var prefsTimer = null;
  function savePrefs() { clearTimeout(prefsTimer); prefsTimer = setTimeout(savePrefsNow, 300); }
  function savePrefsNow() {
    clearTimeout(prefsTimer); prefsTimer = null;
    try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch (e) {}
  }

  // ---------- 4. Current code ----------
  // `work` is what the form shows: the type, the fields of every type
  // touched (switching type keeps what was typed), and the look.
  var work = null;
  var built = null;    // { text } | { error } for the current fields
  var code = null;     // encoder result, or null

  function curSaved() {
    if (!prefs.cur) return null;
    for (var i = 0; i < data.codes.length; i++) if (data.codes[i].id === prefs.cur) return data.codes[i];
    return null;
  }
  function loadCurrent() {
    var s = curSaved();
    if (!s) prefs.cur = null;
    if (s) {
      var f = {};
      f[s.type] = clone(s.f);
      work = { type: s.type, fields: f, st: clone(s.st) };
    } else {
      work = clone(prefs.draft);
    }
  }
  function curFields() {
    if (!work.fields[work.type]) work.fields[work.type] = P.normFields(work.type, {});
    return work.fields[work.type];
  }
  function isBlank(f) {
    return !Object.keys(f).some(function (k) { return typeof f[k] === "string" && f[k].trim(); });
  }
  function captionText() {
    if (!work.st.cap) return "";
    var c = work.st.ct.trim() || P.caption(work.type, curFields());
    return c.replace(/\s+/g, " ").slice(0, CAPTION_LEN);
  }

  // Store the work into the open code (saved: debounced write + sync),
  // or into the draft (device-local).
  var editTimer = null;
  function storeWork() {
    var s = curSaved();
    if (!s) { prefs.draft = clone(work); savePrefs(); return; }
    clearTimeout(editTimer);
    editTimer = setTimeout(storeSavedNow, 600);
  }
  function storeSavedNow() {
    clearTimeout(editTimer); editTimer = null;
    var s = curSaved();
    if (!s) return;
    var next = { type: work.type, f: P.normFields(work.type, curFields()), st: normStyle(work.st) };
    if (JSON.stringify(next) === JSON.stringify({ type: s.type, f: s.f, st: s.st })) return;
    s.type = next.type; s.f = next.f; s.st = next.st;
    s.m = Math.max(Date.now(), s.m + 1);
    data = mergeQR(data, data);
    saveNow();
  }

  function rebuild() {
    built = P.build(work.type, curFields());
    code = null;
    if (built.text) {
      try { code = QR.encode(built.text, { ecl: effEcl(work.st) }); }
      catch (e) { built = { error: "too.long" }; }
    }
  }

  // ---------- 5. Painting ----------
  function roundRect(g, x, y, w, h, r) {
    g.beginPath();
    if (typeof g.roundRect === "function") { g.roundRect(x, y, w, h, r); return; }
    g.moveTo(x + r, y);
    g.arcTo(x + w, y, x + w, y + h, r);
    g.arcTo(x + w, y + h, x, y + h, r);
    g.arcTo(x, y + h, x, y, r);
    g.arcTo(x, y, x + w, y, r);
    g.closePath();
  }

  // Logo pictures, decoded once per data URL. logoImage() gives the
  // picture when it is ready (else starts loading and repaints after);
  // logoReady() waits for it (exports).
  var logoCache = {};
  function logoEntry(src) {
    var e = logoCache[src];
    if (e) return e;
    e = logoCache[src] = { img: new Image(), ok: false, p: null };
    e.p = new Promise(function (resolve) {
      e.img.onload = function () { e.ok = true; resolve(e.img); if (code && work.st.sl === src) drawPreview(); };
      e.img.onerror = function () { resolve(null); };
    });
    e.img.src = src;
    return e;
  }
  function logoImage(src) { if (!src) return null; var e = logoEntry(src); return e.ok ? e.img : null; }
  function logoReady(st) { return st && st.sl ? logoEntry(st.sl).p : Promise.resolve(null); }

  // Paint `qr` in the look `st` at `px` pixels per module, with an
  // optional caption band; returns the canvas.
  function paintCode(cv, px, qr, st, cap) {
    var sh = QR.shapes(qr, drawOpts(st));
    var capH = cap ? QR.CAPTION_H : 0;
    cv.width = sh.w * px;
    cv.height = (sh.h + capH) * px;
    var g = cv.getContext("2d");
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.fillStyle = st.bg;
    g.fillRect(0, 0, cv.width, cv.height);
    g.fillStyle = st.fg;
    sh.rects.forEach(function (r) {
      if (r[4]) {
        g.fillStyle = r[5] === "bg" ? st.bg : st.fg;
        roundRect(g, r[0] * px, r[1] * px, r[2] * px, r[3] * px, r[4] * px);
        g.fill();
      } else {
        g.fillStyle = st.fg;
        g.fillRect(r[0] * px, r[1] * px, r[2] * px, r[3] * px);
      }
    });
    g.fillStyle = st.fg;
    sh.dots.forEach(function (c) {
      g.beginPath();
      g.arc(c[0] * px, c[1] * px, c[2] * px, 0, Math.PI * 2);
      g.fill();
    });
    var img = sh.logo ? logoImage(st.sl) : null;
    if (img && img.naturalWidth) {
      // fit inside the empty square, a little inset (as the SVG does)
      var ins = Math.min(0.5, sh.logo.w * 0.06), bw = (sh.logo.w - 2 * ins) * px;
      var k = Math.min(bw / img.naturalWidth, bw / img.naturalHeight);
      var iw = img.naturalWidth * k, ih = img.naturalHeight * k;
      g.imageSmoothingQuality = "high";
      g.drawImage(img, (sh.logo.x + ins) * px + (bw - iw) / 2, (sh.logo.y + ins) * px + (bw - ih) / 2, iw, ih);
    }
    if (cap) {
      var fs = 2.6 * px, maxW = (sh.w - 2) * px;
      g.fillStyle = st.fg;
      g.textAlign = "center";
      g.textBaseline = "middle";
      do {
        g.font = "700 " + fs + "px Nunito, 'Segoe UI', system-ui, sans-serif";
        if (g.measureText(cap).width <= maxW) break;
        fs *= 0.9;
      } while (fs > px * 0.8);
      g.fillText(cap, cv.width / 2, (sh.h + capH / 2 - 1.2) * px, maxW);
    }
    return cv;
  }
  function paint(cv, px) { return paintCode(cv, px, code, work.st, captionText()); }

  function moduleCount() {
    var sh = QR.shapes(code, { margin: work.st.mg });
    return { w: sh.w, h: sh.h + (captionText() ? QR.CAPTION_H : 0) };
  }

  function drawPreview() {
    var cv = $("cv"), box = $("preview-box");
    var empty = !code;
    cv.hidden = empty;
    $("empty").hidden = !empty;
    if (empty) return;
    var r = box.getBoundingClientRect();
    var dpr = Math.min(3, window.devicePixelRatio || 1);
    var dim = moduleCount();
    var fitCss = Math.max(80, Math.min(r.width, r.height || r.width));
    var px = Math.max(1, Math.floor(fitCss * dpr / Math.max(dim.w, dim.h)));
    paint(cv, px);
    cv.style.width = (cv.width / dpr) + "px";
    cv.style.height = (cv.height / dpr) + "px";
    cv.setAttribute("aria-label", t("cv.label", { what: t("type." + work.type) + (captionText() ? ", " + captionText() : "") }));
  }

  // ---------- 6. Export ----------
  function ready() {
    if (code) return true;
    showToast(built && built.error && !isBlank(curFields()) ? t("err." + built.error) : t("toast.notReady"));
    return false;
  }
  function stem() { return P.fileStem(work.type, curFields()); }

  function canvasBlob(cv) {
    return new Promise(function (resolve, reject) {
      cv.toBlob(function (b) { if (b) resolve(b); else reject(new Error("toBlob")); }, "image/png");
    });
  }
  function pngBlob(size) {
    var qr = code, st = clone(work.st), cap = captionText();
    return logoReady(st).then(function () {
      var dim = QR.shapes(qr, { margin: st.mg }), px = Math.max(2, Math.round(size / dim.w));
      return canvasBlob(paintCode(document.createElement("canvas"), px, qr, st, cap));
    });
  }
  function svgOf(qr, st, cap) {
    var o = drawOpts(st);
    o.fg = st.fg; o.bg = st.bg; o.caption = cap; o.scale = 8;
    if (st.sl) o.logoSrc = st.sl;
    return QR.svg(qr, o);
  }
  function svgText() { return svgOf(code, work.st, captionText()); }
  function dialogHost() {
    try { if (window.orosDialog) return window.orosDialog; } catch (e) {}
    try { if (window.parent && window.parent !== window && window.parent.orosDialog) return window.parent.orosDialog; } catch (e) {}
    return null;
  }
  function downloadBlob(blob, name) {
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
    return Promise.resolve({ ok: true, mode: "download" });
  }
  // R33: through orosDialog when the shell is there.
  function saveFile(blob, name, mime, ext) {
    var dlg = dialogHost();
    var types = [{ description: ext.toUpperCase(), accept: {} }];
    types[0].accept[mime] = ["." + ext];
    var p = dlg ? dlg.saveFile({ blob: blob, filename: name, mime: mime, types: types }) : downloadBlob(blob, name);
    return p.then(function (r) { if (r && r.ok) showToast(t("toast.exported", { file: name })); return r; });
  }

  function exportPng() {
    if (!ready()) return;
    var name = stem() + ".png";
    // A sync blob keeps the click's activation for the native picker
    // on small sizes; big ones fall back to download inside dialogs.js.
    pngBlob(prefs.png).then(function (b) { return saveFile(b, name, "image/png", "png"); })
      .catch(function () { showToast(t("toast.filesFail")); });
  }
  function exportSvg() {
    if (!ready()) return;
    saveFile(new Blob([svgText()], { type: "image/svg+xml" }), stem() + ".svg", "image/svg+xml", "svg");
  }

  function canCopyImage() {
    return !!(navigator.clipboard && typeof navigator.clipboard.write === "function" &&
              typeof window.ClipboardItem === "function");
  }
  function copyImage() {
    if (!ready()) return;
    try {
      var item = new ClipboardItem({ "image/png": pngBlob(1024) });
      navigator.clipboard.write([item]).then(function () { showToast(t("toast.copied")); },
                                             function () { showToast(t("toast.copyFail")); });
    } catch (e) { showToast(t("toast.copyFail")); }
  }

  // Same rule as Contacts: the native share sheet only on phones/tablets.
  function shareOnMobile() {
    if (!navigator.share || !navigator.canShare) return false;
    if (/Windows NT|Macintosh|X11|CrOS/.test(navigator.userAgent)) return false;
    if (navigator.maxTouchPoints === 0 && !/Android|iPhone|iPad|Mobile/i.test(navigator.userAgent)) return false;
    return true;
  }
  function shareImage() {
    if (!ready()) return;
    pngBlob(1024).then(function (b) {
      var file = new File([b], stem() + ".png", { type: "image/png" });
      if (!navigator.canShare({ files: [file] })) { exportPng(); return; }
      return navigator.share({ files: [file], title: captionText() || t("type." + work.type) });
    }).catch(function () {});
  }

  function filesApi() {
    try {
      var fs = window.parent && window.parent !== window ? window.parent.orosFS : null;
      return fs && typeof fs.writeBlob === "function" && typeof fs.stat === "function" ? fs : null;
    } catch (e) { return null; }
  }
  // A free name in /internal/QR: "x.png", then "x (2).png", …
  function freePath(fs, base, ext) {
    var dir = fs.INTERNAL_ROOT + "/QR/";
    function tryN(n) {
      var name = base + (n > 1 ? " (" + n + ")" : "") + "." + ext;
      return fs.stat(dir + name).then(function () { return n < 99 ? tryN(n + 1) : name; },
                                       function () { return name; });
    }
    return tryN(1).then(function (name) { return { path: dir + name, name: name }; });
  }
  function saveToFiles(kind) {
    var fs = filesApi();
    if (!fs || !ready()) return;
    var blobP = kind === "svg" ? Promise.resolve(new Blob([svgText()], { type: "image/svg+xml" })) : pngBlob(prefs.png);
    Promise.all([blobP, freePath(fs, stem(), kind)]).then(function (r) {
      return fs.writeBlob(r[1].path, r[0]).then(function () { showToast(t("toast.filesSaved", { file: r[1].name })); });
    }).catch(function () { showToast(t("toast.filesFail")); });
  }
  function filesDialog() {
    if (!ready()) return;
    var dlg = makeDialog("qr-files");
    dlg.appendChild(el("div", "dlg-title", t("files.title")));
    dlg.appendChild(el("p", "dlg-sub", t("files.sub")));
    var acts = el("div", "dlg-actions");
    acts.appendChild(button(t("btn.png") + " · " + t("png.px", { n: prefs.png }), "primary", function () { dlg.close(); saveToFiles("png"); }));
    acts.appendChild(button(t("btn.svg"), "", function () { dlg.close(); saveToFiles("svg"); }));
    dlg.appendChild(acts);
    var cancel = el("div", "dlg-actions");
    cancel.appendChild(button(t("dlg.cancel"), "", function () { dlg.close(); }));
    dlg.appendChild(cancel);
    document.body.appendChild(dlg);
    dlg.showModal();
  }

  // Print: only the print area shows on paper (qr.css @media print).
  function printWith(build) {
    var area = $("print-area");
    area.innerHTML = "";
    area.classList.remove("sheet");
    var img = el("img", "pr-code");
    img.alt = "";
    img.src = paint(document.createElement("canvas"), 16).toDataURL("image/png");
    build(area, img);
    var go = function () { try { window.print(); } catch (e) {} };
    if (img.complete) go(); else img.onload = go;
  }
  function printCode() {
    if (!ready()) return;
    printWith(function (area, img) { area.appendChild(img); });
  }
  function printWifiCard() {
    if (!ready() || work.type !== "wifi") return;
    var f = curFields();
    var keepCap = work.st.cap;
    work.st.cap = false;                   // the card prints its own text
    printWith(function (area, img) {
      var card = el("div", "pr-card");
      card.appendChild(el("div", "pr-title", t("card.title")));
      card.appendChild(img);
      var dl = el("dl", "pr-rows");
      dl.appendChild(el("dt", "", t("card.network")));
      dl.appendChild(el("dd", "", f.ssid));
      if (f.sec !== "nopass" && f.pass) {
        dl.appendChild(el("dt", "", t("card.password")));
        dl.appendChild(el("dd", "pr-pass", f.pass));
      }
      card.appendChild(dl);
      card.appendChild(el("p", "pr-scan", t("card.scan")));
      area.appendChild(card);
    });
    work.st.cap = keepCap;
  }

  // ---------- 7. Form ----------
  var UI = {
    save:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 3h11l3 3v15H5z"/><path d="M8 3v5h7V3M8 21v-7h8v7"/></svg>',
    plus:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14M5 12h14"/></svg>',
    down:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 4v11M7 10l5 5 5-5M5 20h14"/></svg>',
    copy:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/></svg>',
    share: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="M8.6 13.5l6.8 4M15.4 6.5l-6.8 4"/></svg>',
    files: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>',
    print: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9V3h12v6"/><rect x="3" y="9" width="18" height="8" rx="2"/><path d="M7 14h10v7H7z"/></svg>',
    card:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 9a15 15 0 0 1 20 0M5 12.5a10 10 0 0 1 14 0M8.5 16a5 5 0 0 1 7 0"/><circle cx="12" cy="19.5" r="1"/></svg>',
    eye:   '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12z"/><circle cx="12" cy="12" r="3"/></svg>',
    eyeOff: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.9 17.9A10.4 10.4 0 0 1 12 19C5 19 1 12 1 12a18.5 18.5 0 0 1 5.1-5.9M9.9 5.2A9.1 9.1 0 0 1 12 5c7 0 11 7 11 7a18.4 18.4 0 0 1-2.2 3.2M1 1l22 22"/><path d="M14.1 14.1a3 3 0 0 1-4.2-4.2"/></svg>',
    swap:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 4L3 8l4 4M3 8h14M17 20l4-4-4-4M21 16H7"/></svg>',
    edit:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/></svg>',
    x:     '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6L6 18M6 6l12 12"/></svg>',
    scan:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 8V5a2 2 0 0 1 2-2h3M16 3h3a2 2 0 0 1 2 2v3M21 16v3a2 2 0 0 1-2 2h-3M8 21H5a2 2 0 0 1-2-2v-3M7 12h10"/></svg>',
    grid:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>'
  };

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  }
  function iconBtn(cls, svg, label, fn) {
    var b = el("button", cls);
    b.type = "button";
    b.innerHTML = svg;
    b.setAttribute("aria-label", label);
    b.title = label;
    if (fn) b.addEventListener("click", fn);
    return b;
  }
  function labeled(svg, text) {
    var frag = document.createDocumentFragment(), s = document.createElement("span");
    var i = document.createElement("i");
    i.className = "ic";
    i.innerHTML = svg;                         // trusted constant
    s.textContent = text;
    frag.appendChild(i);
    frag.appendChild(s);
    return frag;
  }
  function setBtn(id, svg, text) {
    var b = $(id);
    b.textContent = "";
    b.appendChild(labeled(svg, text));
  }

  // Field layout: [key, input kind, options]. `half`: two per row.
  var FORM = {
    url:   [["url", "url", { ph: "https://" }]],
    text:  [["text", "area", { rows: 5 }]],
    wifi:  [["ssid", "text"], ["sec", "select"], ["pass", "password"], ["hidden", "check"]],
    vcard: [["first", "text", { half: 1, ac: "given-name" }], ["last", "text", { half: 1, ac: "family-name" }],
            ["org", "text", { half: 1 }], ["title", "text", { half: 1 }],
            ["mobile", "tel", { half: 1 }], ["phone", "tel", { half: 1 }],
            ["email", "email"], ["web", "url", { ph: "https://" }], ["street", "text"],
            ["city", "text", { half: 1 }], ["zip", "text", { half: 1 }],
            ["region", "text", { half: 1 }], ["country", "text", { half: 1 }], ["note", "area", { rows: 2 }]],
    event: [["title", "text"], ["allDay", "check"],
            ["date", "date", { half: 1 }], ["start", "time", { half: 1, timed: 1 }],
            ["dateEnd", "date", { half: 1 }], ["end", "time", { half: 1, timed: 1 }],
            ["location", "text"], ["note", "area", { rows: 3 }]],
    email: [["to", "email"], ["subject", "text"], ["body", "area", { rows: 4 }]],
    phone: [["number", "tel", { ph: "+30 …" }]],
    sms:   [["number", "tel", { ph: "+30 …" }], ["message", "area", { rows: 4 }]],
    geo:   [["lat", "text", { half: 1, ph: "37.9715", im: "decimal" }], ["lon", "text", { half: 1, ph: "23.7257", im: "decimal" }]]
  };
  var FROM = { url: "bookmarks", vcard: "contacts", event: "calendar" };

  function buildTypes() {
    var host = $("types");
    host.innerHTML = "";
    TYPES.forEach(function (ty) {
      var b = el("button", "chip", t("type." + ty));
      b.type = "button";
      b.setAttribute("role", "radio");
      b.setAttribute("data-t", ty);
      b.addEventListener("click", function () { setType(ty); });
      host.appendChild(b);
    });
    host.addEventListener("keydown", function (e) {
      var i = TYPES.indexOf(work.type), d = 0;
      if (e.key === "ArrowRight" || e.key === "ArrowDown") d = 1;
      else if (e.key === "ArrowLeft" || e.key === "ArrowUp") d = -1;
      if (!d) return;
      e.preventDefault();
      setType(TYPES[(i + d + TYPES.length) % TYPES.length]);
      var f = host.querySelector('[data-t="' + work.type + '"]');
      if (f) f.focus();
    });
  }
  function renderTypes() {
    [].forEach.call(document.querySelectorAll("#types .chip"), function (b) {
      var on = b.getAttribute("data-t") === work.type;
      b.classList.toggle("on", on);
      b.setAttribute("aria-checked", on ? "true" : "false");
      b.tabIndex = on ? 0 : -1;
    });
  }

  function setType(ty) {
    if (ty === work.type) return;
    work.type = ty;
    changed();
    renderTypes();
    renderFields();
  }

  var passShown = false;
  function renderFields() {
    var form = $("fields"), f = curFields(), ty = work.type;
    form.innerHTML = "";
    form.setAttribute("aria-label", t("type." + ty));
    var row = null;
    FORM[ty].forEach(function (spec) {
      var key = spec[0], kind = spec[1], o = spec[2] || {};
      var id = "f-" + ty + "-" + key;
      var wrap = el("div", "field" + (o.half ? " half" : "") + (kind === "check" ? " check" : ""));
      if (o.timed) wrap.setAttribute("data-timed", "1");
      var inp;
      if (kind === "check") {
        inp = el("input");
        inp.type = "checkbox";
        inp.id = id;
        inp.checked = !!f[key];
        var lb = el("label", "", fieldLabel(ty, key));
        lb.setAttribute("for", id);
        wrap.appendChild(inp);
        wrap.appendChild(lb);
      } else {
        var lab = el("label", "f-lbl", fieldLabel(ty, key));
        lab.setAttribute("for", id);
        wrap.appendChild(lab);
        if (kind === "area") {
          inp = el("textarea");
          inp.rows = o.rows || 3;
        } else if (kind === "select") {
          inp = el("select");
          P.FIELDS[ty][key].forEach(function (v) {
            var op = el("option", "", t(key + "." + v));
            op.value = v;
            inp.appendChild(op);
          });
        } else {
          inp = el("input");
          inp.type = kind === "password" ? (passShown ? "text" : "password") : kind;
          if (kind === "password") inp.autocomplete = "off";
          if (o.ac) inp.autocomplete = o.ac;
          if (o.im) inp.inputMode = o.im;
          if (kind === "url" || kind === "email" || kind === "tel") inp.spellcheck = false;
        }
        inp.id = id;
        var max = P.FIELDS[ty][key];
        if (typeof max === "number") inp.maxLength = max;
        if (o.ph) inp.placeholder = o.ph;
        inp.value = f[key] || "";
        if (kind === "password") {
          var pw = el("div", "pass-row");
          pw.appendChild(inp);
          pw.appendChild(iconBtn("icon-btn", passShown ? UI.eyeOff : UI.eye, t(passShown ? "pass.hide" : "pass.show"), function () {
            passShown = !passShown;
            renderFields();
            var n = $(id);
            if (n) n.focus();
          }));
          wrap.appendChild(pw);
        } else wrap.appendChild(inp);
      }
      inp.setAttribute("data-k", key);
      var on = function () {
        var v = inp.type === "checkbox" ? inp.checked : inp.value;
        curFields()[key] = v;
        if (key === "allDay" || key === "sec") syncFieldVisibility();
        changed();
      };
      inp.addEventListener("input", on);
      inp.addEventListener("change", on);
      if (o.half) {
        if (!row) { row = el("div", "f-row"); form.appendChild(row); }
        row.appendChild(wrap);
        if (row.children.length === 2) row = null;
      } else {
        row = null;
        form.appendChild(wrap);
      }
    });
    var err = el("p", "f-err");
    err.id = "f-err";
    err.setAttribute("aria-live", "polite");
    form.appendChild(err);
    var from = FROM[ty];
    $("from-btn").hidden = !from;
    if (from) $("from-btn").textContent = t("from." + ty);
    $("card-btn").hidden = ty !== "wifi";
    syncFieldVisibility();
  }
  function syncFieldVisibility() {
    var f = curFields();
    if (work.type === "event") {
      [].forEach.call(document.querySelectorAll('#fields [data-timed]'), function (n) { n.hidden = !!f.allDay; });
    }
    if (work.type === "wifi") {
      var p = $("f-wifi-pass");
      if (p) p.closest(".field").hidden = f.sec === "nopass";
    }
  }

  function buildLook() {
    var host = $("look");
    host.innerHTML = "";
    // Error correction
    var w = el("div", "field");
    var lab = el("label", "f-lbl", t("look.ecl"));
    lab.setAttribute("for", "lk-ecl");
    var sel = el("select");
    sel.id = "lk-ecl";
    ECLS.forEach(function (k) { var op = el("option", "", t("ecl." + k)); op.value = k; sel.appendChild(op); });
    sel.addEventListener("change", function () { work.st.ecl = sel.value; changed(); });
    w.appendChild(lab); w.appendChild(sel);
    w.appendChild(el("p", "hint", t("look.ecl.hint")));
    host.appendChild(w);
    // Colours
    var cr = el("div", "f-row colors");
    [["fg", "look.fg"], ["bg", "look.bg"]].forEach(function (c) {
      var cw = el("div", "field half color");
      var l = el("label", "f-lbl", t(c[1]));
      l.setAttribute("for", "lk-" + c[0]);
      var inp = el("input");
      inp.type = "color";
      inp.id = "lk-" + c[0];
      inp.addEventListener("input", function () { work.st[c[0]] = inp.value.toLowerCase(); changed(); });
      cw.appendChild(l); cw.appendChild(inp);
      cr.appendChild(cw);
    });
    var tools = el("div", "color-tools");
    tools.appendChild(iconBtn("icon-btn", UI.swap, t("look.swap"), function () {
      var x = work.st.fg; work.st.fg = work.st.bg; work.st.bg = x; changed(); renderLook();
    }));
    var rs = el("button", "link-btn", t("look.reset"));
    rs.type = "button";
    rs.addEventListener("click", function () { work.st.fg = "#000000"; work.st.bg = "#ffffff"; changed(); renderLook(); });
    tools.appendChild(rs);
    cr.appendChild(tools);
    host.appendChild(cr);
    // Margin
    var mw = el("div", "field");
    var ml = el("label", "f-lbl", "");
    ml.id = "lk-mg-l";
    ml.setAttribute("for", "lk-mg");
    var mg = el("input");
    mg.type = "range"; mg.min = "0"; mg.max = "10"; mg.step = "1"; mg.id = "lk-mg";
    mg.addEventListener("input", function () { work.st.mg = parseInt(mg.value, 10) || 0; changed(); renderLook(); });
    mw.appendChild(ml); mw.appendChild(mg);
    host.appendChild(mw);
    // Dots and corners
    var sr = el("div", "f-row");
    [["dot", "look.dots", DOTS], ["eye", "look.eyes", EYES]].forEach(function (c) {
      var sw = el("div", "field half");
      var l = el("label", "f-lbl", t(c[1]));
      l.setAttribute("for", "lk-" + c[0]);
      var s = el("select");
      s.id = "lk-" + c[0];
      c[2].forEach(function (k) { var op = el("option", "", t(c[0] + "." + k)); op.value = k; s.appendChild(op); });
      s.addEventListener("change", function () {
        if (c[0] === "dot") {
          work.st.rd = s.value !== "square";
          if (s.value === "dots") work.st.sd = "dots"; else delete work.st.sd;
        } else work.st.se = s.value;
        work.st = normStyle(work.st);
        changed();
        renderLook();
      });
      sw.appendChild(l); sw.appendChild(s);
      sr.appendChild(sw);
    });
    host.appendChild(sr);
    // Logo
    var lw = el("div", "field");
    var ll = el("span", "f-lbl", t("look.logo"));
    var lrow = el("div", "logo-row");
    var thumb = el("img", "logo-thumb");
    thumb.id = "lk-logo-img";
    thumb.alt = t("logo.alt");
    var add = el("button", "txt-btn", t("logo.add"));
    add.type = "button";
    add.id = "lk-logo";
    add.addEventListener("click", pickLogo);
    var rm = iconBtn("icon-btn", UI.x, t("logo.remove"), function () {
      var was = work.st.sl;
      delete work.st.sl;
      changed();
      renderLook();
      undoToast(t("logo.remove"), function () { work.st.sl = was; work.st = normStyle(work.st); changed(); renderLook(); });
    });
    rm.id = "lk-logo-rm";
    lrow.appendChild(thumb); lrow.appendChild(add); lrow.appendChild(rm);
    lw.appendChild(ll); lw.appendChild(lrow);
    var lh = el("p", "hint", t("logo.hint"));
    lh.id = "lk-logo-hint";
    lw.appendChild(lh);
    host.appendChild(lw);
    // Caption
    [["cap", "look.cap"]].forEach(function (c) {
      var cw = el("div", "field check");
      var inp = el("input");
      inp.type = "checkbox";
      inp.id = "lk-" + c[0];
      inp.addEventListener("change", function () { work.st[c[0]] = inp.checked; changed(); renderLook(); });
      var l = el("label", "", t(c[1]));
      l.setAttribute("for", inp.id);
      cw.appendChild(inp); cw.appendChild(l);
      host.appendChild(cw);
    });
    var tw = el("div", "field");
    tw.id = "lk-ct-w";
    var tl = el("label", "f-lbl", t("look.capText"));
    tl.setAttribute("for", "lk-ct");
    var ti = el("input");
    ti.id = "lk-ct";
    ti.maxLength = CAPTION_LEN;
    ti.autocomplete = "off";
    ti.addEventListener("input", function () { work.st.ct = ti.value.slice(0, CAPTION_LEN); changed(); });
    tw.appendChild(tl); tw.appendChild(ti);
    host.appendChild(tw);
  }
  function renderLook() {
    var st = work.st;
    $("lk-ecl").value = effEcl(st);
    $("lk-ecl").disabled = !!st.sl;
    $("lk-fg").value = st.fg;
    $("lk-bg").value = st.bg;
    $("lk-mg").value = String(st.mg);
    $("lk-mg-l").textContent = t("look.margin") + ": " + st.mg;
    $("lk-dot").value = dotStyle(st);
    $("lk-eye").value = eyeStyle(st);
    $("lk-logo-img").hidden = !st.sl;
    if (st.sl) $("lk-logo-img").src = st.sl; else $("lk-logo-img").removeAttribute("src");
    $("lk-logo").textContent = t(st.sl ? "logo.change" : "logo.add");
    $("lk-logo-rm").hidden = !st.sl;
    $("lk-logo-hint").hidden = !st.sl;
    $("lk-cap").checked = st.cap;
    $("lk-ct-w").hidden = !st.cap;
    $("lk-ct").value = st.ct;
    $("lk-ct").placeholder = P.caption(work.type, curFields()) || t("look.capAuto");
  }

  // Everything after an edit: rebuild, repaint, store.
  var raf = 0;
  function changed() {
    storeWork();
    if (raf) return;
    raf = requestAnimationFrame(function () { raf = 0; refresh(); });
  }
  function refresh() {
    rebuild();
    drawPreview();
    var f = curFields(), blank = isBlank(f);
    var errBox = $("f-err");
    var msg = built.error && !blank ? t("err." + built.error) : "";
    if (errBox) { errBox.textContent = msg; errBox.hidden = !msg; }
    $("empty").textContent = msg || t("empty");
    if (code) {
      var m = QR.measure(built.text, effEcl(work.st));
      $("meter").textContent = t("meter", { v: code.version, n: code.size, p: Math.max(1, Math.round(m.bits / m.max * 100)) });
    } else $("meter").textContent = "";
    var warn = "", c = P.contrast(work.st.fg, work.st.bg);
    if (c !== "ok") warn = t("warn." + c);
    else if (work.st.mg === 0) warn = t("warn.margin");
    $("warn").textContent = warn;
    $("warn").hidden = !warn;
    var ct = $("lk-ct");
    if (ct) ct.placeholder = P.caption(work.type, f) || t("look.capAuto");
    [].forEach.call(document.querySelectorAll("#export-bar button"), function (b) { b.disabled = !code; });
    $("png-size").disabled = !code;
  }

  // ---------- 8. "From…" pickers ----------
  function readJson(key) {
    try { var d = JSON.parse(localStorage.getItem(key) || "null"); return d && typeof d === "object" ? d : null; }
    catch (e) { return null; }
  }
  function str(v) { return typeof v === "string" ? v : ""; }

  function tombSet(del) {
    var out = {};
    if (Array.isArray(del)) del.forEach(function (d) { if (d && typeof d.id === "string") out[d.id] = 1; });
    else if (del && typeof del === "object") Object.keys(del).forEach(function (k) { out[k] = 1; });
    return out;
  }

  function contactRows() {
    var d = readJson("oros-contacts-data");
    if (!d || !Array.isArray(d.contacts)) return [];
    var dead = tombSet(d.deleted);
    return d.contacts.filter(function (c) { return c && typeof c.id === "string" && !dead[c.id]; }).map(function (c) {
      var name = [str(c.given), str(c.middle), str(c.family)].filter(Boolean).join(" ") || str(c.nickname) || str(c.org);
      var phones = Array.isArray(c.phones) ? c.phones.filter(function (p) { return p && str(p.v); }) : [];
      var mob = phones.filter(function (p) { return p.type === "mobile"; })[0] || phones[0] || null;
      var other = phones.filter(function (p) { return p !== mob; })[0] || null;
      var em = Array.isArray(c.emails) ? c.emails.filter(function (e) { return e && str(e.v); })[0] : null;
      var web = Array.isArray(c.websites) ? c.websites.filter(function (e) { return e && str(e.v); })[0] : null;
      var adr = Array.isArray(c.addresses) ? c.addresses.filter(Boolean)[0] : null;
      return {
        id: c.id,
        main: name || "?",
        sub: [str(c.org), mob ? mob.v : "", em ? em.v : ""].filter(Boolean).join(" · "),
        fields: {
          first: [str(c.given), str(c.middle)].filter(Boolean).join(" "), last: str(c.family),
          org: str(c.org), title: str(c.jobTitle),
          mobile: mob ? str(mob.v) : "", phone: other ? str(other.v) : "",
          email: em ? str(em.v) : "", web: web ? str(web.v) : "",
          street: adr ? str(adr.street) : "", city: adr ? str(adr.city) : "", zip: adr ? str(adr.zip) : "",
          region: adr ? str(adr.region) : "", country: adr ? str(adr.country) : ""
        }
      };
    }).sort(function (a, b) { return a.main.localeCompare(b.main, loc()); });
  }

  function todayYmd() {
    var d = new Date();
    return d.getFullYear() + "-" + ("0" + (d.getMonth() + 1)).slice(-2) + "-" + ("0" + d.getDate()).slice(-2);
  }
  function fmtDate(ymd) {
    try {
      return new Date(ymd + "T00:00:00").toLocaleDateString(loc(),
        { day: "numeric", month: "short", year: "numeric" });
    } catch (e) { return ymd; }
  }
  // Upcoming first (soonest on top), then the past (latest on top).
  function eventRows() {
    var d = readJson("oros-calendar-data");
    if (!d || !Array.isArray(d.events)) return [];
    var dead = tombSet(d.deleted), today = todayYmd();
    var TIME = /^\d{2}:\d{2}$/, DATE = /^\d{4}-\d{2}-\d{2}$/;
    return d.events.filter(function (e) { return e && typeof e.id === "string" && !dead[e.id] && DATE.test(str(e.date)); })
      .map(function (e) {
        var start = TIME.test(str(e.start)) ? e.start : "";
        var end = TIME.test(str(e.end)) ? e.end : "";
        var dEnd = DATE.test(str(e.dateEnd)) && e.dateEnd > e.date ? e.dateEnd : "";
        return {
          id: e.id,
          key: e.date + (start || "00:00"),
          main: str(e.title) || "—",
          sub: fmtDate(e.date) + " · " + (start ? start + (end ? "–" + end : "") : t("pick.allDay")) +
               (str(e.location) ? " · " + str(e.location) : ""),
          future: (dEnd || e.date) >= today,
          fields: { title: str(e.title), allDay: !start, date: e.date, start: start, dateEnd: dEnd, end: end,
                    location: str(e.location), note: str(e.note) }
        };
      })
      .sort(function (a, b) {
        if (a.future !== b.future) return a.future ? -1 : 1;
        return a.future ? cmpStr(a.key, b.key) : cmpStr(b.key, a.key);
      });
  }

  function bookmarkRows() {
    var d = readJson("oros-bookmarks-data");
    if (!d || !d.items || typeof d.items !== "object") return [];
    var dead = tombSet(d.deleted);
    return Object.keys(d.items).map(function (id) { return d.items[id]; })
      .filter(function (it) { return it && typeof it.id === "string" && !dead[it.id] && /^https?:\/\//i.test(str(it.url)); })
      .map(function (it) { return { id: it.id, main: str(it.title) || str(it.url), sub: str(it.url), fields: { url: str(it.url) } }; })
      .sort(function (a, b) { return a.main.localeCompare(b.main, loc()); });
  }

  var PICK_SRC = { url: bookmarkRows, vcard: contactRows, event: eventRows };
  var PICK_MAX = 200;

  function pickerDialog() {
    var ty = work.type, src = PICK_SRC[ty];
    if (!src) return;
    var rows = src();
    var dlg = makeDialog("qr-pick");
    dlg.classList.add("pick-dlg");
    dlg.appendChild(el("div", "dlg-title", t("pick.title." + ty)));
    var q = el("input");
    q.type = "search";
    q.placeholder = t("pick.search");
    q.setAttribute("aria-label", t("pick.search"));
    q.autocomplete = "off";
    var list = el("ul", "pick-list");
    var note = el("p", "hint", "");
    function render() {
      var s = q.value.trim().toLowerCase();
      list.innerHTML = "";
      var hits = rows.filter(function (r) { return !s || (r.main + " " + r.sub).toLowerCase().indexOf(s) >= 0; });
      hits.slice(0, PICK_MAX).forEach(function (r) {
        var li = el("li");
        var b = el("button", "pick-item");
        b.type = "button";
        b.appendChild(el("span", "pick-main", r.main));
        if (r.sub) b.appendChild(el("span", "pick-sub", r.sub));
        b.addEventListener("click", function () { dlg.close(); applyPick(ty, r.fields); });
        li.appendChild(b);
        list.appendChild(li);
      });
      note.textContent = rows.length ? (hits.length ? "" : t("pick.noMatch")) : t("pick.none");
      note.hidden = !note.textContent;
    }
    q.addEventListener("input", render);
    dlg.appendChild(q);
    dlg.appendChild(note);
    dlg.appendChild(list);
    var acts = el("div", "dlg-actions");
    acts.appendChild(button(t("dlg.cancel"), "", function () { dlg.close(); }));
    dlg.appendChild(acts);
    render();
    document.body.appendChild(dlg);
    dlg.showModal();
    q.focus();
  }

  // A prefill, never data of the other app (BR-W8-6). Undo restores.
  function applyPick(ty, fields) {
    var before = clone(curFields());
    work.fields[ty] = P.normFields(ty, fields);
    changed();
    renderFields();
    renderLook();
    undoToast(t("pick.filled", { app: t("app." + FROM[ty]) }), function () {
      work.fields[ty] = before;
      changed();
      renderFields();
      renderLook();
    });
  }

  // "QR code" buttons in Contacts, Calendar and Bookmarks (shell deep
  // link __orosOpenAt("qr", target) / __orosTakeTarget("qr")). Target
  // { from: "contacts" | "calendar" | "bookmarks", id, date? }: only an
  // id travels, the fields are read here with the same mapping as the
  // pickers. The result is a NEW unsaved code (the open saved code is
  // stored first and left as it was); nothing is written to the other
  // app (BR-W8-6). `date` (YYYY-MM-DD) picks one occurrence of a
  // repeating event. Unknown source or id → a toast, nothing changes.
  var TARGET_TYPE = { bookmarks: "url", contacts: "vcard", calendar: "event" };
  function openTarget(tg) {
    var ty = tg && typeof tg.from === "string" && TARGET_TYPE.hasOwnProperty(tg.from) ? TARGET_TYPE[tg.from] : null;
    if (!ty || typeof tg.id !== "string") return;
    var row = null;
    PICK_SRC[ty]().forEach(function (r) { if (r.id === tg.id) row = r; });
    [].forEach.call(document.querySelectorAll("dialog[open]"), function (d) { d.close(); });
    if (!row) { showToast(t("toast.gone")); return; }
    var fields = clone(row.fields);
    if (ty === "event" && typeof tg.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(tg.date)) {
      fields.date = tg.date;
      if (fields.dateEnd && fields.dateEnd <= tg.date) fields.dateEnd = "";
    }
    storeSavedNow();
    var was = { cur: prefs.cur, draft: clone(prefs.draft), work: clone(work) };
    var f = {};
    f[ty] = P.normFields(ty, fields);
    prefs.cur = null;
    prefs.draft = { type: ty, fields: f, st: clone(work.st) };
    work = clone(prefs.draft);
    savePrefs();
    renderAll();
    undoToast(t("pick.filled", { app: t("app." + tg.from) }), function () {
      prefs.cur = was.cur;
      prefs.draft = was.draft;
      loadCurrent();
      if (!was.cur) work = was.work;
      savePrefs();
      renderAll();
    });
  }
  window.__orosOpenAt = openTarget;

  // ---------- 8b. Files in, logo ----------
  // A file from the device: the shell's picker (R33) or an <input>.
  function openFile(accept) {
    var dlg = dialogHost();
    if (dlg && typeof dlg.openFile === "function") return dlg.openFile(accept);
    return new Promise(function (resolve) {
      var inp = document.createElement("input");
      inp.type = "file";
      inp.accept = accept;
      inp.style.display = "none";
      inp.addEventListener("change", function () { resolve(inp.files && inp.files[0] || null); inp.remove(); });
      document.body.appendChild(inp);
      inp.click();
    });
  }
  // A picture file (or Blob) -> a decoded <img>; rejects when it is not one.
  function loadImage(blob) {
    return new Promise(function (resolve, reject) {
      if (!blob || !/^image\//.test(blob.type || "image/")) { reject(new Error("type")); return; }
      var url = URL.createObjectURL(blob), img = new Image();
      img.onload = function () { URL.revokeObjectURL(url); resolve(img); };
      img.onerror = function () { URL.revokeObjectURL(url); reject(new Error("decode")); };
      img.src = url;
    });
  }
  // Logo: made at most LOGO_PX big, WebP where the browser writes it
  // (keeps transparency, small), else PNG; refused past LOGO_LEN.
  function logoDataUrl(img) {
    var sizes = [LOGO_PX, 128, 96];
    for (var i = 0; i < sizes.length; i++) {
      var k = Math.min(1, sizes[i] / Math.max(img.naturalWidth, img.naturalHeight));
      var cv = document.createElement("canvas");
      cv.width = Math.max(1, Math.round(img.naturalWidth * k));
      cv.height = Math.max(1, Math.round(img.naturalHeight * k));
      var g = cv.getContext("2d");
      g.imageSmoothingQuality = "high";
      g.drawImage(img, 0, 0, cv.width, cv.height);
      var url = cv.toDataURL("image/webp", 0.9);
      if (!/^data:image\/webp;/.test(url)) url = cv.toDataURL("image/png");
      if (url.length <= LOGO_LEN && QR.logoSrcOk(url)) return url;
    }
    return "";
  }
  function pickLogo() {
    openFile("image/*").then(function (f) {
      if (!f) return;
      return loadImage(f).then(function (img) {
        var url = logoDataUrl(img);
        if (!url) { showToast(t("logo.big")); return; }
        work.st.sl = url;
        work.st = normStyle(work.st);
        changed();
        renderLook();
      }, function () { showToast(t("logo.bad")); });
    });
  }

  function copyText(s) {
    function fallback() {
      var ta = el("textarea");
      ta.value = s;
      ta.setAttribute("readonly", "");
      ta.style.position = "fixed"; ta.style.opacity = "0";
      (document.querySelector("dialog[open]") || document.body).appendChild(ta);
      ta.select();
      var ok = false;
      try { ok = document.execCommand("copy"); } catch (e) {}
      ta.remove();
      showToast(t(ok ? "res.copied" : "res.copyFail"));
    }
    if (navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
      navigator.clipboard.writeText(s).then(function () { showToast(t("res.copied")); }, fallback);
    } else fallback();
  }
  function shellWin() {
    try { return window.parent && window.parent !== window ? window.parent : null; } catch (e) { return null; }
  }

  // ---------- 8c. Scanner ----------
  // BarcodeDetector where the browser has it with "qr_code" (Chrome on
  // Android, macOS); otherwise jsQR (vendor/jsqr, Apache-2.0), loaded
  // only then. The camera loop follows Stock's (9b): a frame every
  // 150 ms, the stream stops when the dialog closes or a code is read.
  var SCANS_KEY = "oros-qr-scans";
  var S = window.orosQRScan;
  var detP = null, jsqrP = null;
  function nativeDetector() {
    if (detP) return detP;
    detP = Promise.resolve(null);
    if (typeof window.BarcodeDetector !== "function") return detP;
    var BD = window.BarcodeDetector;
    detP = (typeof BD.getSupportedFormats === "function" ? BD.getSupportedFormats() : Promise.resolve(["qr_code"]))
      .then(function (f) { return f && f.indexOf("qr_code") >= 0 ? new BD({ formats: ["qr_code"] }) : null; })
      .catch(function () { return null; });
    return detP;
  }
  // No element of the page may have the id "exports", "module" or
  // "define": jsQR's UMD wrapper would hand itself to it (named access
  // on window) instead of setting window.jsQR.
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
  // Read a QR code from an image, video or canvas source. Resolves the
  // text or "" (nothing found). `big`: also try smaller copies (files).
  var grabCv = null;
  function detectIn(src, w, h, big) {
    return nativeDetector().then(function (det) {
      if (det) {
        return det.detect(src).then(function (list) {
          var hit = (list || []).filter(function (b) { return typeof b.rawValue === "string" && b.rawValue; })[0];
          return hit ? hit.rawValue : "";
        }, function () { return ""; });
      }
      return loadJsQR().then(function (jsQR) {
        var tries = big ? [1600, 800, 400] : [640];
        for (var i = 0; i < tries.length; i++) {
          var k = Math.min(1, tries[i] / Math.max(w, h));
          if (i > 0 && k === 1) break;
          if (!grabCv) grabCv = document.createElement("canvas");
          grabCv.width = Math.max(1, Math.round(w * k));
          grabCv.height = Math.max(1, Math.round(h * k));
          var g = grabCv.getContext("2d", { willReadFrequently: true });
          g.drawImage(src, 0, 0, grabCv.width, grabCv.height);
          var px = g.getImageData(0, 0, grabCv.width, grabCv.height);
          var r = jsQR(px.data, px.width, px.height, { inversionAttempts: big ? "attemptBoth" : "dontInvert" });
          if (r && typeof r.data === "string" && r.data) return r.data;
        }
        return "";
      });
    });
  }

  function loadScans() {
    try { return S.normHistory(JSON.parse(localStorage.getItem(SCANS_KEY) || "[]")); } catch (e) { return []; }
  }
  function saveScans(list) {
    try { localStorage.setItem(SCANS_KEY, JSON.stringify(list)); } catch (e) {}
  }

  function fmtWhen(ev) {
    var s = fmtDate(ev.date);
    if (ev.allDay) {
      if (ev.dateEnd) s += " – " + fmtDate(ev.dateEnd);
      return s + " · " + t("res.allDay");
    }
    s += " · " + ev.start + (ev.end ? "–" + ev.end : "");
    if (ev.dateEnd) s += " (" + fmtDate(ev.dateEnd) + ")";
    return s;
  }
  function fileSafe(s, dflt) {
    var c = String(s || "").replace(/[^\p{L}\p{N} _-]+/gu, "-").replace(/^[-\s]+|[-\s]+$/g, "").slice(0, 40);
    return c || dflt;
  }

  // A new unsaved code from a scan (the open one is stored first and
  // left as it was; Undo brings it back), like the deep link.
  function makeFrom(gen) {
    if (!gen || TYPES.indexOf(gen.type) < 0) return;
    storeSavedNow();
    var was = { cur: prefs.cur, draft: clone(prefs.draft), work: clone(work) };
    var f = {};
    f[gen.type] = P.normFields(gen.type, gen.fields);
    prefs.cur = null;
    prefs.draft = { type: gen.type, fields: f, st: clone(work.st) };
    work = clone(prefs.draft);
    savePrefs();
    renderAll();
    undoToast(t("res.made"), function () {
      prefs.cur = was.cur;
      prefs.draft = was.draft;
      loadCurrent();
      if (!was.cur) work = was.work;
      savePrefs();
      renderAll();
    });
  }

  // The result card: what the code says, as text only (textContent),
  // and the actions that fit it.
  function resultView(r, closeDlg) {
    var box = el("div", "res");
    box.appendChild(el("div", "res-kind", t("kind." + r.kind)));
    var dl = el("dl", "res-rows");
    function row(k, v, cls) {
      if (!v) return;
      dl.appendChild(el("dt", "", t(k)));
      dl.appendChild(el("dd", cls || "", v));
    }
    var acts = el("div", "res-acts");
    function act(label, primary, fn) {
      var b = el("button", "txt-btn" + (primary ? " primary" : ""), label);
      b.type = "button";
      b.addEventListener("click", fn);
      acts.appendChild(b);
      return b;
    }
    var sh = shellWin();
    switch (r.kind) {
      case "url":
        box.appendChild(el("p", "res-note", t("res.opens")));
        var host = el("p", "res-host", r.host);
        box.appendChild(host);
        box.appendChild(el("p", "res-raw", r.url));
        act(t("res.open"), true, function () {
          // http/https only (checked by parse); a new tab, no opener
          if (/^https?:\/\//i.test(r.url)) window.open(r.url, "_blank", "noopener,noreferrer");
        });
        break;
      case "wifi":
        row("res.network", r.ssid);
        row("res.security", r.sec === "nopass" ? t("sec.nopass") : t("sec." + r.sec));
        row("res.password", r.pass, "res-mono");
        if (r.hidden) row("res.hidden", t("res.yes"));
        if (r.pass) act(t("res.copyPass"), true, function () { copyText(r.pass); });
        act(t("res.copySsid"), !r.pass, function () { copyText(r.ssid); });
        break;
      case "vcard":
        row("res.name", r.name);
        if (r.org && r.org !== r.name) row("res.org", r.org);
        r.phones.slice(0, 3).forEach(function (p) { row("res.phone", p); });
        r.emails.slice(0, 3).forEach(function (e) { row("res.email", e); });
        var vname = fileSafe(r.name, "contact") + ".vcf";
        if (sh && typeof sh.__orosOpenAt === "function") {
          act(t("res.contacts"), true, function () {
            closeDlg();
            sh.__orosOpenAt("contacts", { importVcf: { name: vname, text: r.vcf } });
          });
        } else {
          act(t("res.vcf"), true, function () {
            saveFile(new Blob([r.vcf], { type: "text/vcard" }), vname, "text/vcard", "vcf");
          });
        }
        break;
      case "event":
        row("res.name", r.title);
        row("res.when", fmtWhen(r));
        row("res.where", r.location);
        if (sh && typeof sh.__orosOpenCalendarNew === "function") {
          act(t("res.calendar"), true, function () {
            closeDlg();
            sh.__orosOpenCalendarNew(S.calendarPayload(r));
          });
        } else {
          act(t("res.ics"), true, function () {
            var ics = /^BEGIN:VCALENDAR/i.test(r.text.trim()) ? r.text.trim()
              : "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//orOS//QR//EN\r\n" + r.text.trim() + "\r\nEND:VCALENDAR";
            saveFile(new Blob([ics + "\r\n"], { type: "text/calendar" }), fileSafe(r.title, "event") + ".ics", "text/calendar", "ics");
          });
        }
        break;
      case "email":
        row("res.to", r.to); row("res.subject", r.subject); row("res.message", r.body);
        act(t("res.copy"), true, function () { copyText(r.to); });
        break;
      case "phone":
        row("res.number", r.number);
        act(t("res.copy"), true, function () { copyText(r.number); });
        break;
      case "sms":
        row("res.number", r.number); row("res.message", r.message);
        act(t("res.copy"), true, function () { copyText(r.number); });
        break;
      case "geo":
        row("res.coords", r.lat + ", " + r.lon);
        act(t("res.copy"), true, function () { copyText(r.lat + ", " + r.lon); });
        break;
      default:
        box.appendChild(el("p", "res-raw res-text", r.text));
    }
    if (dl.children.length) box.appendChild(dl);
    if (r.kind !== "text" && r.kind !== "url") {
      var raw = el("details", "res-more");
      raw.appendChild(el("summary", "", t("kind.text")));
      raw.appendChild(el("p", "res-raw", r.text));
      box.appendChild(raw);
    }
    if (r.kind !== "phone" && r.kind !== "email" && r.kind !== "sms" && r.kind !== "geo") {
      act(t("res.copy"), !acts.children.length, function () { copyText(r.text); });
    }
    if (r.gen) act(t("res.make"), false, function () { closeDlg(); makeFrom(r.gen); });
    box.appendChild(acts);
    return box;
  }

  function scanDialog() {
    var dlg = makeDialog("qr-scan");
    dlg.classList.add("scan-dlg");
    dlg.appendChild(el("div", "dlg-title", t("scan.title")));
    var cam = el("div", "cam");
    var v = el("video", "cam-video");
    v.muted = true;
    v.setAttribute("playsinline", "");
    v.setAttribute("aria-hidden", "true");
    cam.appendChild(v);
    cam.appendChild(el("div", "cam-frame"));
    cam.hidden = true;
    dlg.appendChild(cam);
    var msg = el("p", "hint scan-msg", "");
    msg.setAttribute("aria-live", "polite");
    dlg.appendChild(msg);
    var bar = el("div", "scan-bar");
    var camBtn = el("button", "txt-btn", t("scan.camera"));
    camBtn.type = "button";
    var fileBtn = el("button", "txt-btn", t("scan.file"));
    fileBtn.type = "button";
    bar.appendChild(camBtn);
    bar.appendChild(fileBtn);
    dlg.appendChild(bar);
    dlg.appendChild(el("p", "hint scan-tip", t("scan.paste")));
    var out = el("div", "scan-out");
    dlg.appendChild(out);
    var hist = el("div", "scan-hist");
    dlg.appendChild(hist);
    var acts = el("div", "dlg-actions");
    acts.appendChild(button(t("btn.close"), "", function () { dlg.close(); }));
    dlg.appendChild(acts);

    var hasCam = !!(navigator.mediaDevices && typeof navigator.mediaDevices.getUserMedia === "function");
    var stream = null, timer = 0, live = false, closed = false, busy = false;
    function stopCam() {
      live = false;
      clearTimeout(timer);
      if (stream) stream.getTracks().forEach(function (tr) { try { tr.stop(); } catch (e) {} });
      stream = null;
      try { v.srcObject = null; } catch (e) {}
      cam.hidden = true;
      camBtn.textContent = t("scan.camera");
    }
    function say(s, warn) { msg.textContent = s; msg.classList.toggle("warn", !!warn); }
    function close() { dlg.close(); }

    function show(text, fromHistory) {
      var r = S.parse(text);
      out.innerHTML = "";
      out.appendChild(resultView(r, close));
      if (!fromHistory) {
        var list = S.addHistory(loadScans(), text, Date.now(), newId());
        saveScans(list);
        try { if (navigator.vibrate) navigator.vibrate(40); } catch (e) {}
      }
      renderHist();
      say("");
      out.scrollIntoView({ block: "nearest" });
    }
    function found(text) {
      stopCam();
      show(text, false);
    }

    function loop() {
      if (!live || closed) return;
      if (v.readyState < 2 || busy) { timer = setTimeout(loop, 200); return; }
      busy = true;
      detectIn(v, v.videoWidth, v.videoHeight, false).then(function (text) {
        busy = false;
        if (!live || closed) return;
        if (text) { found(text); return; }
        timer = setTimeout(loop, 150);
      }, function () { busy = false; if (live) timer = setTimeout(loop, 400); });
    }
    function startCam() {
      if (live) { stopCam(); say(""); return; }
      if (!hasCam) { say(t("scan.noCam"), true); return; }
      out.innerHTML = "";
      say(t("scan.wait"));
      live = true;
      camBtn.textContent = t("scan.stop");
      // load the decoder alongside the camera
      nativeDetector().then(function (d) { if (!d) return loadJsQR(); }).catch(function () {});
      navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" } }, audio: false }).then(function (st) {
        if (!live || closed) { st.getTracks().forEach(function (tr) { tr.stop(); }); return; }
        stream = st;
        v.srcObject = st;
        cam.hidden = false;
        return v.play().then(function () { say(t("scan.aim")); loop(); });
      }).catch(function () {
        if (closed) return;
        stopCam();
        say(t("scan.denied"), true);
      });
    }
    function scanBlob(blob) {
      if (!blob) return;
      stopCam();
      out.innerHTML = "";
      say(t("scan.looking"));
      loadImage(blob).then(function (img) {
        return detectIn(img, img.naturalWidth, img.naturalHeight, true);
      }).then(function (text) {
        if (closed) return;
        if (text) show(text, false); else say(t("scan.none"), true);
      }, function () { if (!closed) say(t("scan.none"), true); });
    }

    function renderHist() {
      hist.innerHTML = "";
      var list = loadScans();
      var head = el("div", "sec-head");
      head.appendChild(el("h2", "", t("scan.history")));
      head.appendChild(el("span", "spacer"));
      if (list.length) {
        var clr = el("button", "link-btn", t("scan.clear"));
        clr.type = "button";
        clr.addEventListener("click", function () {
          var keep = loadScans();
          saveScans([]);
          renderHist();
          undoToast(t("scan.cleared"), function () { saveScans(keep); renderHist(); });
        });
        head.appendChild(clr);
      }
      hist.appendChild(head);
      if (!list.length) { hist.appendChild(el("p", "hint", t("scan.historyEmpty"))); return; }
      var ul = el("ul", "pick-list hist-list");
      list.forEach(function (h) {
        var r = S.parse(h.text);
        var li = el("li", "hist-row");
        var b = el("button", "pick-item");
        b.type = "button";
        var first = (r.kind === "url" ? r.url : r.kind === "wifi" ? r.ssid : r.kind === "vcard" ? r.name :
                     r.kind === "event" ? (r.title || fmtDate(r.date)) : h.text).replace(/\s+/g, " ").trim().slice(0, 120);
        b.appendChild(el("span", "pick-main", first));
        var when = "";
        try {
          when = new Date(h.at).toLocaleString(loc(),
            { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
        } catch (e) {}
        b.appendChild(el("span", "pick-sub", t("kind." + r.kind) + (when ? " · " + when : "")));
        b.addEventListener("click", function () { stopCam(); show(h.text, true); });
        li.appendChild(b);
        li.appendChild(iconBtn("mini danger", UI.x, t("scan.del", { what: first }), function () {
          var keep = loadScans();
          saveScans(keep.filter(function (x) { return x.id !== h.id; }));
          renderHist();
          undoToast(t("scan.removed"), function () { saveScans(keep); renderHist(); });
        }));
        ul.appendChild(li);
      });
      hist.appendChild(ul);
    }

    camBtn.addEventListener("click", startCam);
    fileBtn.addEventListener("click", function () { openFile("image/*").then(scanBlob); });
    dlg.addEventListener("paste", function (e) {
      var items = (e.clipboardData && e.clipboardData.items) || [];
      for (var i = 0; i < items.length; i++) {
        if (items[i].kind === "file" && /^image\//.test(items[i].type)) { e.preventDefault(); scanBlob(items[i].getAsFile()); return; }
      }
    });
    dlg.addEventListener("close", function () { closed = true; stopCam(); });
    camBtn.hidden = !hasCam;
    renderHist();
    document.body.appendChild(dlg);
    dlg.showModal();
    say(hasCam ? "" : t("scan.noCam"));
    var coarse = false;
    try { coarse = window.matchMedia("(pointer: coarse)").matches; } catch (e) {}
    if (hasCam && coarse) startCam();      // phones: straight to the camera
  }

  // ---------- 8d. Many codes (bulk) ----------
  // One code per row of a CSV, in the current look (no caption: the
  // label column prints under each code). Print sheet, PDF (jsPDF,
  // already vendored, loaded on use; labels are drawn as pictures so
  // any script prints), or a ZIP of PNGs (Atelier's zip writer).
  var B = window.orosQRBulk;
  var jspdfP = null, zipP = null;
  function loadScript(src, ready) {
    return new Promise(function (resolve, reject) {
      if (ready()) { resolve(ready()); return; }
      var s = document.createElement("script");
      s.src = src;
      s.onload = function () { if (ready()) resolve(ready()); else reject(new Error(src)); };
      s.onerror = function () { reject(new Error(src)); };
      document.head.appendChild(s);
    });
  }
  function loadJsPDF() {
    if (!jspdfP) jspdfP = loadScript("../vendor/jspdf.umd.min.js", function () { return window.jspdf && window.jspdf.jsPDF; })
      .catch(function (e) { jspdfP = null; throw e; });
    return jspdfP;
  }
  function loadZip() {
    if (!zipP) zipP = loadScript("../atelier/zip.js", function () { return window.AtelierZip; })
      .catch(function (e) { zipP = null; throw e; });
    return zipP;
  }

  var bulkGrid = "3x4";
  function bulkDialog() {
    var dlg = makeDialog("qr-bulk");
    dlg.classList.add("bulk-dlg");
    dlg.appendChild(el("div", "dlg-title", t("bulk.title")));
    var state = { rows: [], header: false, col: 0, label: -1, touched: false };

    var tl = el("label", "dlg-lbl", t("bulk.rows"));
    tl.setAttribute("for", "bk-text");
    var ta = el("textarea");
    ta.id = "bk-text";
    ta.rows = 5;
    ta.spellcheck = false;
    ta.placeholder = "https://example.com/1,Front door\nhttps://example.com/2,Back door";
    var openBtn = el("button", "link-btn", t("bulk.open"));
    openBtn.type = "button";
    var hdr = el("div", "field check");
    var hc = el("input");
    hc.type = "checkbox"; hc.id = "bk-head";
    var hl = el("label", "", t("bulk.header"));
    hl.setAttribute("for", "bk-head");
    hdr.appendChild(hc); hdr.appendChild(hl);
    var cr = el("div", "f-row");
    function selField(id, label) {
      var w = el("div", "field half");
      var l = el("label", "f-lbl", label);
      l.setAttribute("for", id);
      var s = el("select");
      s.id = id;
      w.appendChild(l); w.appendChild(s);
      cr.appendChild(w);
      return s;
    }
    var colSel = selField("bk-col", t("bulk.col"));
    var labSel = selField("bk-lab", t("bulk.label"));
    var gw = el("div", "field");
    var gl = el("label", "f-lbl", t("bulk.grid"));
    gl.setAttribute("for", "bk-grid");
    var gridSel = el("select");
    gridSel.id = "bk-grid";
    Object.keys(B.GRIDS).forEach(function (k) {
      var g = B.GRIDS[k], op = el("option", "", t("bulk.gridOpt", { c: g[0], r: g[1], n: g[0] * g[1] }));
      op.value = k;
      gridSel.appendChild(op);
    });
    gridSel.value = bulkGrid;
    gw.appendChild(gl); gw.appendChild(gridSel);
    var sum = el("p", "bulk-sum");
    sum.setAttribute("aria-live", "polite");
    var prev = el("div", "bulk-prev");
    var look = el("p", "hint", t("bulk.look"));
    var acts = el("div", "dlg-actions bulk-acts");
    var bPrint = button(t("bulk.print"), "", null), bPdf = button(t("bulk.pdf"), "primary", null), bZip = button(t("bulk.zip"), "", null);
    acts.appendChild(bPrint); acts.appendChild(bPdf); acts.appendChild(bZip);
    var cancel = el("div", "dlg-actions");
    cancel.appendChild(button(t("btn.close"), "", function () { dlg.close(); }));

    var top = el("div", "sec-head");
    top.appendChild(tl); top.appendChild(el("span", "spacer")); top.appendChild(openBtn);
    [top, ta, hdr, cr, gw, sum, prev, look, acts, cancel].forEach(function (n) { dlg.appendChild(n); });

    var list = [], tooLong = [];
    function colName(i) {
      var h = state.header && state.rows[0] ? String(state.rows[0][i] || "").trim() : "";
      return h ? h.slice(0, 40) : t("bulk.colN", { n: i + 1 });
    }
    function fillSelects() {
      var n = Math.max(1, B.columns(state.rows));
      colSel.innerHTML = ""; labSel.innerHTML = "";
      var none = el("option", "", t("bulk.noLabel"));
      none.value = "-1";
      labSel.appendChild(none);
      for (var i = 0; i < n; i++) {
        var a = el("option", "", colName(i)); a.value = String(i); colSel.appendChild(a);
        var b = el("option", "", colName(i)); b.value = String(i); labSel.appendChild(b);
      }
      if (state.col >= n) state.col = 0;
      if (state.label >= n) state.label = -1;
      colSel.value = String(state.col);
      labSel.value = String(state.label);
    }
    function recompute() {
      var res = B.items(state.rows, { header: state.header, col: state.col, label: state.label });
      list = []; tooLong = [];
      res.items.forEach(function (it) {
        try { it.qr = QR.encode(it.text, { ecl: effEcl(work.st) }); list.push(it); }
        catch (e) { tooLong.push(it.row); }
      });
      var bits = [];
      bits.push(state.rows.length ? t(list.length === 1 ? "bulk.count1" : "bulk.count", { n: list.length }) : t("bulk.none"));
      if (res.empty) bits.push(t(res.empty === 1 ? "bulk.empty1" : "bulk.empty", { n: res.empty }));
      if (res.more) bits.push(t("bulk.more", { max: B.MAX_ITEMS, n: res.more }));
      if (tooLong.length) bits.push(t("bulk.tooLong", { rows: tooLong.slice(0, 10).join(", ") + (tooLong.length > 10 ? "…" : "") }));
      sum.textContent = bits.join(" ");
      [bPrint, bPdf, bZip].forEach(function (b) { b.disabled = !list.length; });
      // a few small previews
      prev.innerHTML = "";
      list.slice(0, 6).forEach(function (it) {
        var f = el("figure", "bulk-fig");
        var cv = paintCode(document.createElement("canvas"), 3, it.qr, work.st, "");
        cv.setAttribute("role", "img");
        cv.setAttribute("aria-label", it.label || it.text);
        f.appendChild(cv);
        f.appendChild(el("figcaption", "", it.label || it.text));
        prev.appendChild(f);
      });
    }
    function parse() {
      var p = B.parseCsv(ta.value);
      state.rows = p.rows;
      if (!state.touched) { state.header = B.guessHeader(p.rows); hc.checked = state.header; }
      fillSelects();
      recompute();
    }
    var parseTimer = 0;
    ta.addEventListener("input", function () { clearTimeout(parseTimer); parseTimer = setTimeout(parse, 250); });
    hc.addEventListener("change", function () { state.header = hc.checked; state.touched = true; fillSelects(); recompute(); });
    colSel.addEventListener("change", function () { state.col = parseInt(colSel.value, 10) || 0; recompute(); });
    labSel.addEventListener("change", function () { state.label = parseInt(labSel.value, 10); recompute(); });
    gridSel.addEventListener("change", function () { bulkGrid = gridSel.value; });
    openBtn.addEventListener("click", function () {
      openFile(".csv,.tsv,.txt,text/csv,text/plain").then(function (f) {
        if (!f) return;
        if (f.size > 2 * 1024 * 1024) { showToast(t("bulk.readFail")); return; }
        return f.text().then(function (s) { ta.value = s; state.touched = false; parse(); });
      }).catch(function () { showToast(t("bulk.readFail")); });
    });

    // One label as a canvas: the code, and the label under it (drawn
    // here, so Greek or any script needs no PDF font).
    function labelCanvas(it, codePx, labPx, wPx) {
      var st = work.st, sh = QR.shapes(it.qr, { margin: st.mg });
      var px = Math.max(1, Math.floor(codePx / sh.w));
      var code = paintCode(document.createElement("canvas"), px, it.qr, st, "");
      if (!labPx || !it.label) return { code: code, label: null };
      var lc = document.createElement("canvas");
      lc.width = Math.round(wPx); lc.height = Math.round(labPx);
      var g = lc.getContext("2d");
      g.fillStyle = "#000000";
      g.textAlign = "center"; g.textBaseline = "middle";
      var fs = labPx * 0.62;
      do {
        g.font = "700 " + fs + "px Nunito, 'Segoe UI', system-ui, sans-serif";
        if (g.measureText(it.label).width <= wPx * 0.96) break;
        fs *= 0.9;
      } while (fs > labPx * 0.25);
      g.fillText(it.label, wPx / 2, labPx / 2, wPx * 0.96);
      return { code: code, label: lc };
    }
    function busy(on) {
      [bPrint, bPdf, bZip].forEach(function (b) { b.disabled = on || !list.length; });
      if (on) sum.textContent = t("bulk.working", { n: list.length });
      else recompute();
    }
    var hasLabels = function () { return state.label >= 0 && list.some(function (it) { return it.label; }); };

    bPrint.addEventListener("click", function () {
      if (!list.length) return;
      logoReady(work.st).then(function () {
        var lay = B.sheet(list.length, bulkGrid, hasLabels());
        var area = $("print-area");
        area.innerHTML = "";
        area.classList.add("sheet");
        var page = null;
        lay.cells.forEach(function (c, i) {
          if (!page || i % lay.per === 0) {
            page = el("div", "pr-page");
            page.style.gridTemplateColumns = "repeat(" + lay.cols + ", 1fr)";
            page.style.gridTemplateRows = "repeat(" + lay.rows + ", " + c.h.toFixed(2) + "mm)";
            area.appendChild(page);
          }
          var it = list[i], cell = el("div", "pr-cell");
          var img = el("img", "pr-qr");
          img.alt = "";
          img.src = paintCode(document.createElement("canvas"), 8, it.qr, work.st, "").toDataURL("image/png");
          img.style.width = c.code.toFixed(2) + "mm";
          img.style.height = c.code.toFixed(2) + "mm";
          cell.appendChild(img);
          if (c.label && it.label) {
            var cap = el("div", "pr-lab", it.label);
            cap.style.height = c.label.toFixed(2) + "mm";
            cap.style.fontSize = (c.label * 0.55).toFixed(2) + "mm";
            cell.appendChild(cap);
          }
          page.appendChild(cell);
        });
        dlg.close();
        setTimeout(function () { try { window.print(); } catch (e) {} }, 60);
      });
    });

    bPdf.addEventListener("click", function () {
      if (!list.length) return;
      busy(true);
      Promise.all([loadJsPDF(), logoReady(work.st)]).then(function (r) {
        var JsPDF = r[0], doc = new JsPDF({ unit: "mm", format: "a4", orientation: "portrait", compress: true });
        var lay = B.sheet(list.length, bulkGrid, hasLabels()), MMPX = 12;     // ≈ 300 dpi
        doc.setProperties({ title: t("bulk.sheet"), creator: "orOS QR Generator" });
        lay.cells.forEach(function (c, i) {
          if (i > 0 && i % lay.per === 0) doc.addPage();
          var it = list[i], lc = labelCanvas(it, c.code * MMPX, c.label && it.label ? c.label * MMPX : 0, c.w * MMPX);
          var x = c.x + (c.w - c.code) / 2, y = c.y + (c.h - c.code - c.label) / 2;
          doc.addImage(lc.code.toDataURL("image/png"), "PNG", x, y, c.code, c.code, undefined, "FAST");
          if (lc.label) doc.addImage(lc.label.toDataURL("image/png"), "PNG", c.x, y + c.code, c.w, c.label, undefined, "FAST");
        });
        var blob = doc.output("blob");
        busy(false);
        return saveFile(blob, fileSafe(t("bulk.sheet"), "qr") + ".pdf", "application/pdf", "pdf");
      }).catch(function () { busy(false); showToast(t("bulk.fail")); });
    });

    bZip.addEventListener("click", function () {
      if (!list.length) return;
      busy(true);
      var names = B.fileNames(list, "png"), files = [], st = clone(work.st), size = prefs.png;
      Promise.all([loadZip(), logoReady(st)]).then(function (r) {
        var Z = r[0], chain = Promise.resolve();
        list.forEach(function (it, i) {
          chain = chain.then(function () {
            var dim = QR.shapes(it.qr, { margin: st.mg }), px = Math.max(2, Math.round(size / dim.w));
            var cap = it.label ? it.label.slice(0, CAPTION_LEN) : "";
            return canvasBlob(paintCode(document.createElement("canvas"), px, it.qr, st, cap));
          }).then(function (b) { return b.arrayBuffer(); }).then(function (ab) {
            files.push({ name: names[i], data: new Uint8Array(ab) });
          });
        });
        return chain.then(function () {
          var bytes = Z.write(files, new Date());
          busy(false);
          return saveFile(new Blob([bytes], { type: "application/zip" }), fileSafe(t("bulk.sheet"), "qr") + ".zip", "application/zip", "zip");
        });
      }).catch(function () { busy(false); showToast(t("bulk.fail")); });
    });

    parse();
    document.body.appendChild(dlg);
    dlg.showModal();
    ta.focus();
  }

  // ---------- 9. My codes ----------
  function renderToolbar() {
    var s = curSaved();
    $("code-name").textContent = s ? s.name : t("draft");
    $("save-btn").hidden = !!s;
  }

  function renderMine() {
    var host = $("mine");
    host.innerHTML = "";
    $("mine-empty").hidden = data.codes.length > 0;
    data.codes.slice().sort(function (a, b) { return cmpStr(a.name.toLowerCase(), b.name.toLowerCase()) || cmpStr(a.id, b.id); })
      .forEach(function (x) {
        var row = el("div", "mine-row");
        var b = el("button", "chip mine-chip");
        b.type = "button";
        b.appendChild(el("span", "mine-type", t("type." + x.type)));
        b.appendChild(el("span", "", x.name));
        var on = x.id === prefs.cur;
        b.classList.toggle("on", on);
        b.setAttribute("aria-pressed", on ? "true" : "false");
        b.addEventListener("click", function () { openSaved(x.id); });
        row.appendChild(b);
        row.appendChild(iconBtn("mini", UI.edit, t("mine.rename", { name: x.name }), function () { nameDialog(x); }));
        row.appendChild(iconBtn("mini", UI.copy, t("mine.copy", { name: x.name }), function () { copyCode(x); }));
        row.appendChild(iconBtn("mini danger", UI.x, t("mine.del", { name: x.name }), function () { deleteCode(x.id); }));
        host.appendChild(row);
      });
  }

  function renderAll() {
    renderToolbar();
    renderTypes();
    renderFields();
    renderLook();
    renderMine();
    refresh();
  }

  function openSaved(id) {
    storeSavedNow();
    if (!curSaved()) prefs.draft = clone(work);
    prefs.cur = id;
    loadCurrent();
    savePrefs();
    renderAll();
  }

  function newCode() {
    storeSavedNow();
    var was = { cur: prefs.cur, draft: clone(prefs.draft), work: clone(work) };
    prefs.cur = null;
    prefs.draft = { type: work.type, fields: {}, st: clone(work.st) };
    work = clone(prefs.draft);
    savePrefs();
    renderAll();
    var first = document.querySelector("#fields input, #fields textarea");
    if (first) first.focus();
    if (!was.cur && !isBlank((was.work.fields[was.work.type]) || {})) {
      undoToast(t("toast.newCode"), function () {
        prefs.cur = null;
        prefs.draft = was.draft;
        work = was.work;
        savePrefs();
        renderAll();
      });
    }
  }

  function copyCode(x) {
    if (data.codes.length >= MAX_CODES) { showToast(t("toast.maxCodes", { n: MAX_CODES })); return; }
    storeSavedNow();
    var id = newId();
    data.codes.push({ id: id, m: Date.now(), name: normName(t("copy.suffix", { name: x.name })),
                      type: x.type, f: clone(x.f), st: clone(x.st) });
    data = mergeQR(data, data);
    saveNow();
    openSaved(id);
  }

  function deleteCode(id) {
    var x = null;
    data.codes.forEach(function (y) { if (y.id === id) x = y; });
    if (!x) return;
    storeSavedNow();
    var snapshot = clone(x);
    var wasOpen = prefs.cur === id;
    data.tombs[id] = Math.max(Date.now(), x.m);
    data = mergeQR(data, data);
    saveNow();
    if (wasOpen) {                         // keep it on the desk as a draft
      prefs.cur = null;
      prefs.draft = clone(work);
      savePrefs();
    }
    renderAll();
    undoToast(t("toast.deleted"), function () {
      // R17: a fresh mtime beats the tombstone
      snapshot.m = Math.max(Date.now(), (data.tombs[snapshot.id] || 0) + 1);
      data.codes.push(snapshot);
      data = mergeQR(data, data);
      saveNow();
      if (wasOpen) { prefs.cur = snapshot.id; loadCurrent(); savePrefs(); }
      renderAll();
    });
  }

  // ---------- 10. Dialogs + toasts ----------
  function nameDialog(existing) {
    if (!existing && data.codes.length >= MAX_CODES) { showToast(t("toast.maxCodes", { n: MAX_CODES })); return; }
    if (!existing && !code) { showToast(built && built.error && !isBlank(curFields()) ? t("err." + built.error) : t("toast.notReady")); return; }
    var dlg = makeDialog("qr-name");
    dlg.appendChild(el("div", "dlg-title", t(existing ? "dlg.renameTitle" : "dlg.saveTitle")));
    var form = el("form");
    form.method = "dialog";
    var lab = el("label", "dlg-lbl", t("dlg.name"));
    lab.setAttribute("for", "qr-name-in");
    var inp = el("input");
    inp.id = "qr-name-in";
    inp.maxLength = NAME_LEN;
    inp.autocomplete = "off";
    inp.value = existing ? existing.name : normName(P.caption(work.type, curFields()) || t("type." + work.type));
    var acts = el("div", "dlg-actions");
    acts.appendChild(button(t("dlg.cancel"), "", function () { dlg.close(); }));
    var ok = button(t("dlg.save"), "primary", null);
    ok.type = "submit";
    acts.appendChild(ok);
    form.appendChild(lab); form.appendChild(inp); form.appendChild(acts);
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var name = normName(inp.value);
      if (!name) { showToast(t("toast.needName")); inp.focus(); return; }
      if (existing) {
        var x = null;
        data.codes.forEach(function (y) { if (y.id === existing.id) x = y; });
        if (x) { x.name = name; x.m = Math.max(Date.now(), x.m + 1); }
      } else {
        var id = newId();
        data.codes.push({ id: id, m: Date.now(), name: name, type: work.type,
                          f: P.normFields(work.type, curFields()), st: normStyle(work.st) });
        prefs.cur = id;
        prefs.draft = { type: work.type, fields: {}, st: clone(work.st) };
        savePrefs();
        showToast(t("toast.saved"));
      }
      data = mergeQR(data, data);
      saveNow();
      if (!existing) loadCurrent();
      dlg.close();
      renderAll();
    });
    dlg.appendChild(form);
    document.body.appendChild(dlg);
    dlg.showModal();
    inp.focus();
    inp.select();
  }

  function button(label, cls, fn) {
    var b = el("button", "dlg-btn" + (cls ? " " + cls : ""), label);
    b.type = "button";
    if (fn) b.addEventListener("click", fn);
    return b;
  }
  function makeDialog(id) {
    var stale = document.getElementById(id);
    if (stale) stale.remove();
    var dlg = document.createElement("dialog");
    dlg.id = id;
    dlg.className = "mm-dlg";
    dlg.addEventListener("click", function (e) { if (e.target === dlg) dlg.close(); });
    dlg.addEventListener("close", function () {
      parkToast();
      setTimeout(function () { dlg.remove(); }, 0);
    });
    return dlg;
  }

  function showToast(text) {
    try {
      var n = (window.parent && window.parent !== window && window.parent.orosNotifs) || null;
      if (n && typeof n.transient === "function" &&
          n.transient({ ns: "qr", title: String(text) })) return;
    } catch (e) {}
    localToast(text, null);
  }
  // Undo toasts stay local (the closure never leaves the frame), 8 s.
  function undoToast(text, onUndo) { localToast(text, onUndo); }

  var toastTimer = null;
  function localToast(text, onUndo) {
    var box = $("toast");
    if (!box) return;
    hostToast();
    box.innerHTML = "";
    box.classList.remove("show");
    box.appendChild(el("span", "", text));
    if (onUndo) {
      var b = el("button", "", t("toast.undo"));
      b.type = "button";
      b.addEventListener("click", function () {
        box.classList.remove("show");
        clearTimeout(toastTimer);
        onUndo();
      });
      box.appendChild(b);
    }
    void box.offsetWidth;
    box.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { box.classList.remove("show"); }, onUndo ? 8000 : 4000);
  }
  function hostToast() {
    var box = $("toast"), d = document.querySelector("dialog[open]");
    if (box && d && box.parentNode !== d) d.appendChild(box);
  }
  function parkToast() {
    var box = $("toast");
    if (box && box.parentNode !== document.body) document.body.appendChild(box);
  }

  // ---------- 11. Keyboard ----------
  function wireKeyboard() {
    // Contract Β: forward Ctrl+Alt+Shift shortcuts to the shell (capture)
    document.addEventListener("keydown", function (e) {
      if (!(e.ctrlKey || e.metaKey) || !e.altKey || !e.shiftKey) return;
      var p = null;
      try { p = window.parent; } catch (err) { return; }
      if (!(p && p !== window && p.orosShortcuts &&
            typeof p.orosShortcuts.handle === "function")) return;
      if (p.orosShortcuts.handle(e)) e.stopPropagation();
    }, true);
    // Ctrl+S: export PNG
    document.addEventListener("keydown", function (e) {
      if (!(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey || e.repeat) return;
      if ((e.key || "").toLowerCase() !== "s" || document.querySelector("dialog[open]")) return;
      e.preventDefault();
      exportPng();
    });
  }

  // ---------- 12. Sync slice + palette ----------
  var PAL_VARS = ["--bg", "--bg-desktop", "--bar-bg", "--text", "--text-dim",
                  "--accent", "--accent-hover", "--accent-soft",
                  "--panel-bg", "--border", "--shadow", "--danger"];

  function inheritPalette() {
    try {
      var pRoot = window.parent.document.documentElement;
      document.documentElement.setAttribute("data-theme",
        pRoot.getAttribute("data-theme") || "dark");
      var cs = window.parent.getComputedStyle(pRoot);
      PAL_VARS.forEach(function (v) {
        var val = cs.getPropertyValue(v).trim();
        if (val) document.documentElement.style.setProperty(v, val);
      });
    } catch (e) { /* standalone */ }
  }

  function watchPalette() {
    try {
      new MutationObserver(inheritPalette).observe(
        window.parent.document.documentElement,
        { attributes: true, attributeFilter: ["data-skin", "data-theme"] }
      );
    } catch (e) { /* standalone */ }
  }

  function syncApi() {
    try { return (window.parent && window.parent.orosSync) || window.orosSync || null; }
    catch (e) { return window.orosSync || null; }
  }

  function registerSync() {
    // LOCAL FIRST: load() has already run (boot order).
    var api = syncApi();
    window.__orosSyncApi = {
      _suppress: false,
      dirty: function () {
        if (this._suppress) return;
        if (api && typeof api.markDirty === "function") api.markDirty();
      }
    };
    if (!api || typeof api.registerSlice !== "function") return;
    api.registerSlice("qr", sliceGet, sliceSet, STORAGE_KEY, mergeQR);
  }

  function sliceGet() {
    storeSavedNow();
    return mergeQR(data, data);   // canonical copy (R26)
  }

  function sliceSet(incoming) {
    if (!incoming || typeof incoming !== "object" || !Array.isArray(incoming.codes)) return;
    var before = JSON.stringify(data.codes);
    var openWas = curSaved();
    window.__orosSyncApi._suppress = true;   // R6: a pull never marks dirty
    try {
      data = mergeQR(incoming, incoming);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch (e) {
    } finally {
      window.__orosSyncApi._suppress = false;
    }
    if (JSON.stringify(data.codes) === before) return;   // no toast on merge (sync feedback = taskbar dot)
    var openNow = curSaved();
    if (openWas && !openNow) {                // deleted elsewhere: keep it as a draft
      prefs.cur = null;
      prefs.draft = clone(work);
      savePrefs();
    } else if (openNow && editTimer === null &&
               JSON.stringify({ type: openNow.type, f: openNow.f, st: openNow.st }) !==
               JSON.stringify({ type: work.type, f: P.normFields(work.type, curFields()), st: normStyle(work.st) })) {
      var focusId = document.activeElement && document.activeElement.id;
      loadCurrent();                          // edited elsewhere
      renderAll();
      if (focusId && $(focusId)) $(focusId).focus();
      return;
    }
    renderMine();
    renderToolbar();
  }

  // ---------- 13. Wiring & boot ----------
  function applyI18n() {
    [].forEach.call(document.querySelectorAll("[data-i18n]"), function (n) {
      n.textContent = t(n.getAttribute("data-i18n"));
    });
    setBtn("scan-btn", UI.scan, t("btn.scan"));
    setBtn("bulk-btn", UI.grid, t("btn.bulk"));
    setBtn("new-btn", UI.plus, t("btn.new"));
    // their text hides on narrow screens: the name stays for screen readers
    [["scan-btn", "btn.scan"], ["bulk-btn", "btn.bulk"], ["new-btn", "btn.new"]].forEach(function (b) {
      $(b[0]).title = t(b[1]);
      $(b[0]).setAttribute("aria-label", t(b[1]));
    });
    setBtn("save-btn", UI.save, t("btn.save"));
    setBtn("png-btn", UI.down, t("btn.png"));
    setBtn("svg-btn", UI.down, t("btn.svg"));
    setBtn("copy-btn", UI.copy, t("btn.copy"));
    setBtn("share-btn", UI.share, t("btn.share"));
    setBtn("files-btn", UI.files, t("btn.files"));
    setBtn("print-btn", UI.print, t("btn.print"));
    setBtn("card-btn", UI.card, t("btn.card"));
    var ps = $("png-size");
    ps.innerHTML = "";
    ps.setAttribute("aria-label", t("png.size"));
    ps.title = t("png.size");
    PNG_SIZES.forEach(function (n) {
      var op = el("option", "", t("png.px", { n: n }));
      op.value = String(n);
      ps.appendChild(op);
    });
    ps.value = String(prefs.png);
  }

  function wire() {
    $("new-btn").addEventListener("click", newCode);
    $("scan-btn").addEventListener("click", scanDialog);
    $("bulk-btn").addEventListener("click", bulkDialog);
    $("save-btn").addEventListener("click", function () { nameDialog(null); });
    $("png-btn").addEventListener("click", exportPng);
    $("svg-btn").addEventListener("click", exportSvg);
    $("png-size").addEventListener("change", function () {
      var n = parseInt($("png-size").value, 10);
      if (PNG_SIZES.indexOf(n) >= 0) { prefs.png = n; savePrefs(); }
    });
    $("copy-btn").hidden = !canCopyImage();
    $("copy-btn").addEventListener("click", copyImage);
    $("share-btn").hidden = !shareOnMobile();
    $("share-btn").addEventListener("click", shareImage);
    $("files-btn").hidden = !filesApi();
    $("files-btn").addEventListener("click", filesDialog);
    $("print-btn").addEventListener("click", printCode);
    $("card-btn").addEventListener("click", printWifiCard);
    $("from-btn").addEventListener("click", pickerDialog);
    $("fields").addEventListener("submit", function (e) { e.preventDefault(); });
    window.addEventListener("afterprint", function () { $("print-area").innerHTML = ""; $("print-area").classList.remove("sheet"); });
    try { new ResizeObserver(function () { if (code) drawPreview(); }).observe($("preview-box")); }
    catch (e) { window.addEventListener("resize", drawPreview); }
    document.addEventListener("visibilitychange", function () {
      if (document.visibilityState === "hidden") { savePrefsNow(); storeSavedNow(); }
    });
    window.addEventListener("pagehide", function () { savePrefsNow(); storeSavedNow(); });
    wireKeyboard();
  }

  function boot() {
    load();
    loadPrefs();
    loadCurrent();
    applyI18n();
    buildTypes();
    buildLook();
    wire();
    registerSync();
    inheritPalette();
    watchPalette();
    renderAll();
    try {
      var p = window.parent;
      if (p && p !== window && typeof p.__orosTakeTarget === "function") {
        var tg = p.__orosTakeTarget("qr");
        if (tg) openTarget(tg);
      }
    } catch (e) {}
  }

  boot();
})();
