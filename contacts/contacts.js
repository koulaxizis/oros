// ============================================================
// orOS Contacts
// Contact CRUD, structured names, multi-field phones/emails/
// addresses/websites/IM/events (birthday, anniversary, custom),
// labels (color-coded, filterable), starred favorites,
// vCard (.vcf) import + export, merge-capable sync.
// Data: localStorage "oros-contacts-data"
//   { ver: 1,
//     labels:   [ { id, name, color, mtime } ],
//     contacts: [ { id, mtime,
//                   given, middle, family, nickname,
//                   org, jobTitle,
//                   phones:    [ { v, type } ],
//                   emails:    [ { v, type } ],
//                   addresses: [ { street, city, zip, region, country, type } ],
//                   websites:  [ { v, type } ],
//                   im:        [ { v, type } ],
//                   events:    [ { day: "MM-DD", year: number|null,
//                                   type: "birthday"|"anniversary"|"custom",
//                                   label } ],
//                   labelIds: [ "lbl-…" ],   // sorted by sanitizer
//                   starred: false, note,
//                   // wave 26 (keep in touch, per-field merge):
//                   keep?:   { n: 1–99, u: "w"|"m" } | null,
//                   seen?:   "YYYY-MM-DD" | "",   // "Contacted today"
//                   log?:    [ { id, k, d, tx, m } ],  // interactions
//                   logDel?: { id: m },          // their tombstones
//                   fm?:     { field: stamp } } ], // see merge.js
//     deleted:  [ { id, mtime } ] }          // shared tombstone list
// Events carry day "MM-DD" + optional year (null = yearless
// birthdays) — feeds the Calendar birthday feed (Wave 2) and the
// vCard BDAY round-trip ("--MM-DD" form) with zero ambiguity.
// id + mtime exist from day one for the merge sync (Part 5).
// photo: base64 JPEG data URI (≤50KB, 128×128), set via the
// dialog avatar uploader; round-trips as vCard PHOTO.
// ============================================================
(function () {
  "use strict";

  /* ---------- 0. Shell palette inheritance (same-origin iframe) ---------- */
  // Function NAMES are load-bearing: bump-version.yml's G3 palette
  // guard greps every app's JS for inheritPalette + watchPalette.
  // Single OS Skin rule: NO local accent palette (see Bible).
  function inheritPalette() {
    try {
      var pDoc = window.parent.document;
      var pCs = window.parent.getComputedStyle(pDoc.documentElement);
      ["--bg", "--text", "--text-dim", "--accent", "--accent-hover",
       "--accent-soft", "--panel-bg", "--border", "--shadow"].forEach(function (v) {
        var val = pCs.getPropertyValue(v).trim();
        if (val) document.documentElement.style.setProperty(v, val);
      });
      var th = pDoc.documentElement.getAttribute("data-theme");
      if (th) document.documentElement.setAttribute("data-theme", th);
    } catch (e) { /* standalone load — CSS fallbacks apply */ }
  }
  function watchPalette() {
    try {
      var pRoot = window.parent.document.documentElement;
      if (typeof MutationObserver !== "function") return;
      new MutationObserver(inheritPalette).observe(pRoot, {
        attributes: true, attributeFilter: ["data-theme", "data-skin"]
      });
    } catch (e) { /* standalone — nothing to watch */ }
  }
  inheritPalette();
  watchPalette();

  /* ---------- 1. i18n ---------- */
  var LANG = "en";
  try {
    if (window.parent && window.parent.orosLang) LANG = window.parent.orosLang;
    else if (localStorage.getItem("oros-lang")) LANG = localStorage.getItem("oros-lang");
  } catch (e) {}

  var STR = {
    en: {
      "app.contacts.self": "Contacts",
      "ct.add": "Add",
      "ct.import": "Import",
      "ct.export": "Export",
      "ct.search.ph": "Search contacts…",
      "ct.dlg.new": "New contact",
      "ct.dlg.edit": "Edit contact",
      "ct.field.given": "First name",
      "ct.field.middle": "Middle name",
      "ct.field.family": "Last name",
      "ct.field.nickname": "Nickname",
      "ct.field.org": "Company",
      "ct.field.jobtitle": "Job title",
      "ct.field.phones": "Phones",
      "ct.field.emails": "Emails",
      "ct.field.addresses": "Addresses",
      "ct.field.websites": "Websites",
      "ct.field.im": "Instant messaging",
      "ct.field.events": "Events",
      "ct.field.note": "Note",
      "ct.ph.given": "Maria",
      "ct.ph.middle": "—",
      "ct.ph.family": "Papadopoulou",
      "ct.ph.nickname": "Mary",
      "ct.ph.org": "Company…",
      "ct.ph.jobtitle": "Designer…",
      "ct.ph.note": "Details…",
      "ct.add.phone": "＋ Phone",
      "ct.add.email": "＋ Email",
      "ct.add.address": "＋ Address",
      "ct.add.website": "＋ Website",
      "ct.add.im": "＋ IM",
      "ct.add.event": "＋ Event",
      "ct.starred": "Favorite",
      "ct.filter.all": "All",
      "ct.filter.starred": "Favorites",
      "ct.save": "Save",
      "ct.cancel": "Cancel",
      "ct.delete": "Delete contact",
      "ct.delete.confirm": "Delete this contact?",
      "ct.del.yes": "Delete",
      "ct.del.done": "Contact deleted",
      "ct.err.name": "Give a name (or a company) first",
      "ct.none": "No contacts yet",
      "ct.search.none": "No contacts found",
      "ct.export.done": "Contacts exported (.vcf)",
      "ct.export.bad": "Export failed — please retry",
      "ct.export.json": "Export JSON",
      "ct.export.json.done": "Database exported (.json)",
      "ct.import.json": "Import JSON",
      "ct.import.json.done": "Database restored · {n} contact(s)",
      "ct.import.json.bad": "Not a valid orOS contacts JSON file",
      "ct.import.bad": "Could not read that file",
      "ct.import.done": "{n} contact(s) imported",
      "ct.phone": "From phone",
      "ct.phone.bad": "Could not read the phone's contacts",
      "ph.btn": "On this phone",
      "ph.title": "orOS contacts on this phone",
      "ph.text": "Adds your orOS contacts to the phone's Contacts, so the dialer and incoming calls show their names. Changes you make to them there, and new contacts saved to the \"orOS\" account, come back here when you open orOS.",
      "ph.on": "Show on this phone",
      "ph.what": "contacts",
      "ph.allow": "Allow access",
      "ph.ask": "Android asks for permission once.",
      "ph.denied": "Android access is off. Allow it from the app's settings.",
      "ph.off": "Not shown on this phone.",
      "ph.wait": "Sending…",
      "ph.last": "Sent {t}: {n} {what}.",
      "ph.err": "Last attempt failed: {e}",
      "ph.close": "Close",
      "pf.btn": "Find photos",
      "pf.title": "Find photos online",
      "pf.text": "For contacts without a photo, orOS looks for the profile picture the person set for their own e-mail address on Gravatar and Libravatar. Only a coded fingerprint of each address is sent, never names or numbers. An address that several of your contacts share (an office e-mail) is skipped, so a photo always belongs to that one contact. Nothing changes until you pick the photos to keep.",
      "pf.go": "Search",
      "pf.apply": "Use the ticked photos",
      "pf.none": "No contact without a photo has an e-mail address to look up.",
      "pf.busy": "Looking up {i} of {n}…",
      "pf.found": "{n} photo(s) found for {m} contact(s) looked up. Untick any that is not right.",
      "pf.nothing": "No photos found for the {m} contact(s) looked up.",
      "pf.done": "{n} photo(s) added",
      "pf.via": "via {s} · {e}",
      "en.btn": "Update online",
      "en.one": "Update from online sources",
      "en.save": "Save your changes first.",
      "en.empty": "No contact in this list has an e-mail address, phone or website to look up.",
      "en.done": "{n} contact(s) updated",
      "ac.btn": "From an account",
      "ac.title": "Import from an account",
      "ac.text": "Sign in once: orOS reads your contacts, you review them, and the connection ends right away. No password or access is kept.",
      "ac.others": "iCloud, Yahoo and other services: export your contacts there as a .vcf file and use Import.",
      "ac.noclient": "{p} is not set up in this orOS yet. You can add your own app id below.",
      "ac.wait": "Waiting for the sign-in window…",
      "ac.read": "Reading contacts… {n}",
      "ac.popup": "The sign-in window was blocked. Allow pop-ups for orOS and try again.",
      "ac.cancelled": "Sign-in cancelled.",
      "ac.forbidden": "The service refused to share the contacts. Allow reading contacts when you sign in.",
      "ac.err": "Could not read the contacts ({e}).",
      "ac.none": "No contacts found in this account.",
      "ac.src": "{p} · {n} contact(s) · disconnected",
      "ac.own": "Use my own app id",
      "ac.own.text": "Register an OAuth app (Google Cloud: Web application with the People API; Microsoft Entra: single-page app for personal and work accounts) with this redirect address, then paste its client id. It stays on this device.",
      "ac.own.save": "Save",
      "ac.own.saved": "Saved on this device",
      "ac.own.bad": "That doesn't look like a client id",
      "rv.title": "Review import",
      "rv.sum": "{new} new · {diff} with other details · {same} already here",
      "rv.folded": "{n} listed twice in the import, combined",
      "rv.pref": "When a detail differs:",
      "rv.act.add": "Add",
      "rv.act.skip": "Skip",
      "rv.act.merge": "Merge, keep mine",
      "rv.act.theirs": "Merge, use imported",
      "rv.act.sep": "Add as separate",
      "rv.grp.diff": "Other details ({n})",
      "rv.grp.new": "New ({n})",
      "rv.grp.same": "Already here, skipped ({n})",
      "rv.more": "…and {n} more, with the suggested choice",
      "rv.by.email": "Same email",
      "rv.by.phone": "Same phone",
      "rv.by.name": "Same name",
      "rv.adds": "Adds",
      "rv.nameonly": "Same name but other phones and emails: probably another person",
      "rv.birthday": "Birthday",
      "rv.safe": "Nothing is deleted. A merge only adds details; \"use imported\" replaces a value that differs.",
      "rv.go": "Import",
      "rv.done": "{a} added · {m} merged · {s} skipped",
      "rv.nothing": "Nothing new to import",
      "rv.undone": "Import undone",
      "ct.import.csv.bad": "Could not read that CSV file",
      "ct.import.csv.noheader": "No contacts found in that CSV file",
      "ct.import.csv.norows": "No importable contacts found in the CSV",
      "undo": "Undo",
      "lbl.personal": "Personal",
      "lbl.work": "Work",
      "lbl.family": "Family",
      "lbl.manage": "Manage labels",
      "lbl.new": "New label",
      "lbl.ph.name": "Name…",
      "lbl.color": "Color",
      "lbl.done": "Done",
      "lbl.delete": "Delete",
      "lbl.inuse": "This label is used by contacts",
      "lbl.empty": "No labels yet",
      "ty.mobile": "Mobile",
      "ty.home": "Home",
      "ty.work": "Work",
      "ty.main": "Main",
      "ty.other": "Other",
      "ty.blog": "Blog",
      "evt.birthday": "Birthday",
      "evt.anniversary": "Anniversary",
      "evt.custom": "Custom",
      "evt.ph": "Nameday…",
      "ct.unnamed": "(no name)",
      "ct.lbl.filter": "Labels",
      "dup.scan": "Duplicates",
      "dup.title": "Duplicate contacts",
      "dup.none": "No duplicates found",
      "dup.count": "Groups",
      "dup.merge": "Merge duplicates",
      "dup.primary": "Primary contact",
      "dup.flip": "Flip primary",
      "dup.do": "Merge now",
      "dup.reason.phone": "Same phone",
      "dup.reason.email": "Same email",
      "dup.reason.name": "Similar name",
      "dup.merged": "Contacts merged",
      "dup.undo": "Undo",
      "dup.sect.def": "Definitive matches",
      "dup.sect.pos": "Possible matches",
      "ct.avatar": "Photo",
      "ct.avatar.up": "Upload photo",
      "ct.avatar.rem": "Remove",
      "ct.avatar.bad": "Could not read that image",
      "ct.avatar.big": "Image too large after compression — try another one",
      "ct.field.relations": "Relations",
      "ct.add.relation": "＋ Relation",
      "ct.rel.pick": "— contact —",
      "ct.rel.in": "Linked from other contacts",
      "rel.spouse": "Spouse",
      "rel.partner": "Partner",
      "rel.parent": "Parent",
      "rel.child": "Child",
      "rel.sibling": "Sibling",
      "rel.friend": "Friend",
      "rel.colleague": "Colleague",
      "rel.manager": "Manager",
      "rel.other": "Other",
      "ct.back": "Back",
      "ct.share": "Share",
      "ct.familytree": "Family tree",
      "ct.qr": "QR code",
      "ct.crm": "Customer: {name}",
      "ct.share.done": "Contact copied to clipboard",
      "ct.share.fail": "Could not copy — please retry",
      "ct.maps": "Show on map",
      "kt.field": "Keep in touch",
      "kt.every": "every",
      "kt.off": "Off",
      "kt.weeks": "weeks",
      "kt.months": "months",
      "kt.cad.w1": "Every week",
      "kt.cad.w": "Every {n} weeks",
      "kt.cad.m1": "Every month",
      "kt.cad.m": "Every {n} months",
      "kt.last": "Last contacted",
      "kt.never": "Never",
      "kt.next": "Get in touch by {date}",
      "kt.overdue": "Due since {date}",
      "kt.duetoday": "Due today",
      "kt.today.btn": "Contacted today",
      "kt.today.done": "Marked as contacted today",
      "kt.log.btn": "＋ Log",
      "kt.timeline": "Timeline",
      "kt.reach": "Reach out",
      "kt.reach.none": "Nobody is waiting to hear from you right now.",
      "kt.rem": "Remind me at",
      "kt.rem.hint": "A notice on this device on days when someone is due. This setting stays on this device.",
      "kt.sub.never": "No contact yet",
      "kt.sub.last": "Last contacted {rel}",
      "rel.today": "today",
      "rel.yday": "yesterday",
      "rel.days": "{n} days ago",
      "rel.week1": "a week ago",
      "rel.weeks": "{n} weeks ago",
      "rel.month1": "a month ago",
      "rel.months": "{n} months ago",
      "rel.year1": "a year ago",
      "rel.years": "{n} years ago",
      "ix.new": "Log an interaction",
      "ix.edit": "Edit interaction",
      "ix.kind": "Type",
      "ix.date": "Date",
      "ix.text": "What happened",
      "ix.ph": "Talked about the trip…",
      "ix.k.call": "Call",
      "ix.k.meet": "Meeting",
      "ix.k.msg": "Message",
      "ix.k.gift": "Gift",
      "ix.k.note": "Note",
      "ix.del": "Delete",
      "ix.deleted": "Interaction deleted",
      "ix.bad": "Pick a date",
      "ix.none": "Nothing logged yet.",
      "cm.title": "Match the columns",
      "cm.text": "Pick what each column holds. Columns left on “Skip” are not imported.",
      "cm.header": "The first row has the column names",
      "cm.dates": "Dates",
      "cm.dmy": "day/month/year",
      "cm.mdy": "month/day/year",
      "cm.col": "Column {n}",
      "cm.preview": "Preview · {n} contact(s)",
      "cm.next": "Continue",
      "cm.none": "No contacts with these columns. Pick at least a name, company, e-mail or phone column.",
      "cm.f.skip": "Skip",
      "cm.f.full": "Full name",
      "cm.f.phone": "Phone",
      "cm.f.email": "Email",
      "cm.f.website": "Website",
      "cm.f.street": "Street",
      "cm.f.city": "City",
      "cm.f.zip": "Postcode",
      "cm.f.region": "Region",
      "cm.f.country": "Country",
      "cm.type": "Type",
      "sc.btn": "Scan card",
      "sc.title": "Scan a business card",
      "sc.text": "Take a photo of a business card or choose a picture of one. orOS reads the text on this device and fills in a new contact for you to check.",
      "sc.photo": "Take a photo",
      "sc.pick": "Choose a picture",
      "sc.paste": "Text from the card",
      "sc.ph": "Name, company, phone, e-mail… or paste the card's text here",
      "sc.fill": "Fill in a new contact",
      "sc.dl.text": "Reading the card needs the text recognition engine (Tesseract, English and Greek, about 7 MB). It is downloaded once from orOS's own site (vendor/tesseract/) and runs on this device: the picture never leaves it.",
      "sc.dl.go": "Download and read",
      "sc.wait.load": "Loading text recognition… {p}%",
      "sc.wait.read": "Reading the card… {p}%",
      "sc.err": "Could not read the picture ({e}). You can type the text below.",
      "sc.empty": "No text found. Try a sharper, well-lit photo, or type the text below.",
      "sc.done": "Check the text, then press “Fill in a new contact”.",
      "sc.nofill": "Type or read some text first",
      "sc.check": "Check the details, then press Save",
    },
    el: {
      "app.contacts.self": "Επαφές",
      "ct.add": "Προσθήκη",
      "ct.import": "Εισαγωγή",
      "ct.export": "Εξαγωγή",
      "ct.search.ph": "Αναζήτηση επαφών…",
      "ct.dlg.new": "Νέα επαφή",
      "ct.dlg.edit": "Επεξεργασία επαφής",
      "ct.field.given": "Όνομα",
      "ct.field.middle": "Μεσόναμα",
      "ct.field.family": "Επώνυμο",
      "ct.field.nickname": "Ψευδώνυμο",
      "ct.field.org": "Εταιρεία",
      "ct.field.jobtitle": "Θέση",
      "ct.field.phones": "Τηλέφωνα",
      "ct.field.emails": "Email",
      "ct.field.addresses": "Διευθύνσεις",
      "ct.field.websites": "Ιστοσελίδες",
      "ct.field.im": "Άμεσα μηνύματα",
      "ct.field.events": "Εκδηλώσεις",
      "ct.field.note": "Σημείωση",
      "ct.ph.given": "Μαρία",
      "ct.ph.middle": "—",
      "ct.ph.family": "Παπαδοπούλου",
      "ct.ph.nickname": "Μαριούλα",
      "ct.ph.org": "Εταιρεία…",
      "ct.ph.jobtitle": "Σχεδιάστρια…",
      "ct.ph.note": "Λεπτομέρειες…",
      "ct.add.phone": "＋ Τηλέφωνο",
      "ct.add.email": "＋ Email",
      "ct.add.address": "＋ Διεύθυνση",
      "ct.add.website": "＋ Ιστοσελίδα",
      "ct.add.im": "＋ IM",
      "ct.add.event": "＋ Εκδήλωση",
      "ct.starred": "Αγαπημένη",
      "ct.filter.all": "Όλες",
      "ct.filter.starred": "Αγαπημένες",
      "ct.save": "Αποθήκευση",
      "ct.cancel": "Άκυρο",
      "ct.delete": "Διαγραφή επαφής",
      "ct.delete.confirm": "Να διαγραφεί αυτή η επαφή;",
      "ct.del.yes": "Διαγραφή",
      "ct.del.done": "Η επαφή διαγράφηκε",
      "ct.err.name": "Δώσε πρώτα ένα όνομα (ή εταιρεία)",
      "ct.none": "Καμία επαφή ακόμα",
      "ct.search.none": "Καμία επαφή δεν βρέθηκε",
      "ct.export.done": "Οι επαφές εξήχθησαν (.vcf)",
      "ct.export.bad": "Η εξαγωγή απέτυχε — δοκίμασε ξανά",
      "ct.export.json": "Εξαγωγή JSON",
      "ct.export.json.done": "Η βάση εξήχθη (.json)",
      "ct.import.json": "Εισαγωγή JSON",
      "ct.import.json.done": "Η βάση επαναφέρθηκε · {n} επαφή/ές",
      "ct.import.json.bad": "Μη έγκυρο αρχείο JSON επαφών orOS",
      "ct.import.bad": "Το αρχείο δεν μπόρεσε να διαβαστεί",
      "ct.import.done": "{n} επαφή/ές εισήχθησαν",
      "ct.phone": "Από το κινητό",
      "ct.phone.bad": "Οι επαφές του κινητού δεν μπόρεσαν να διαβαστούν",
      "ph.btn": "Στο κινητό",
      "ph.title": "Οι επαφές του orOS στο κινητό",
      "ph.text": "Βάζει τις επαφές του orOS στις Επαφές του κινητού, ώστε οι κλήσεις να δείχνουν ονόματα. Ό,τι αλλάζεις εκεί, και οι νέες επαφές στον λογαριασμό \"orOS\", έρχονται εδώ όταν ανοίγεις το orOS.",
      "ph.on": "Εμφάνιση στο κινητό",
      "ph.what": "επαφές",
      "ph.allow": "Να επιτραπεί",
      "ph.ask": "Το Android ζητά άδεια μία φορά.",
      "ph.denied": "Η πρόσβαση στο Android είναι κλειστή. Άνοιξέ την από τις ρυθμίσεις της εφαρμογής.",
      "ph.off": "Δεν εμφανίζονται στο κινητό.",
      "ph.wait": "Αποστολή…",
      "ph.last": "Στάλθηκαν {t}: {n} {what}.",
      "ph.err": "Η τελευταία προσπάθεια απέτυχε: {e}",
      "ph.close": "Κλείσιμο",
      "pf.btn": "Εύρεση φωτογραφιών",
      "pf.title": "Εύρεση φωτογραφιών online",
      "pf.text": "Για τις επαφές χωρίς φωτογραφία, το orOS ψάχνει την εικόνα προφίλ που έχει βάλει ο ίδιος ο άνθρωπος για το email του στο Gravatar και στο Libravatar. Στέλνεται μόνο ένα κωδικοποιημένο αποτύπωμα κάθε διεύθυνσης, ποτέ ονόματα ή τηλέφωνα. Ένα email που το έχουν πολλές επαφές σου (π.χ. ενός γραφείου) παραλείπεται, ώστε η φωτογραφία να ανήκει πάντα σε αυτή τη μία επαφή. Τίποτα δεν αλλάζει μέχρι να διαλέξεις ποιες φωτογραφίες κρατάς.",
      "pf.go": "Αναζήτηση",
      "pf.apply": "Χρήση των επιλεγμένων",
      "pf.none": "Καμία επαφή χωρίς φωτογραφία δεν έχει email για αναζήτηση.",
      "pf.busy": "Αναζήτηση {i} από {n}…",
      "pf.found": "Βρέθηκαν {n} φωτογραφίες για {m} επαφές που ελέγχθηκαν. Ξετσέκαρε όποια δεν είναι σωστή.",
      "pf.nothing": "Δεν βρέθηκαν φωτογραφίες για τις {m} επαφές που ελέγχθηκαν.",
      "pf.done": "Προστέθηκαν {n} φωτογραφίες",
      "pf.via": "από {s} · {e}",
      "en.btn": "Ενημέρωση online",
      "en.one": "Ενημέρωση από online πηγές",
      "en.save": "Αποθήκευσε πρώτα τις αλλαγές σου.",
      "en.empty": "Καμία επαφή αυτής της λίστας δεν έχει email, τηλέφωνο ή ιστοσελίδα για αναζήτηση.",
      "en.done": "Ενημερώθηκαν {n} επαφές",
      "ac.btn": "Από λογαριασμό",
      "ac.title": "Εισαγωγή από λογαριασμό",
      "ac.text": "Συνδέεσαι μία φορά: το orOS διαβάζει τις επαφές σου, τις ελέγχεις και η σύνδεση κλείνει αμέσως. Δεν κρατιέται κωδικός ούτε πρόσβαση.",
      "ac.others": "iCloud, Yahoo και άλλες υπηρεσίες: κάνε εξαγωγή των επαφών εκεί σε αρχείο .vcf και πάτα Εισαγωγή.",
      "ac.noclient": "Το {p} δεν έχει ρυθμιστεί ακόμα σε αυτό το orOS. Μπορείς να βάλεις δικό σου αναγνωριστικό εφαρμογής παρακάτω.",
      "ac.wait": "Αναμονή για το παράθυρο σύνδεσης…",
      "ac.read": "Ανάγνωση επαφών… {n}",
      "ac.popup": "Το παράθυρο σύνδεσης μπλοκαρίστηκε. Επίτρεψε τα αναδυόμενα για το orOS και δοκίμασε ξανά.",
      "ac.cancelled": "Η σύνδεση ακυρώθηκε.",
      "ac.forbidden": "Η υπηρεσία δεν έδωσε τις επαφές. Επίτρεψε την ανάγνωση επαφών όταν συνδέεσαι.",
      "ac.err": "Οι επαφές δεν μπόρεσαν να διαβαστούν ({e}).",
      "ac.none": "Δεν βρέθηκαν επαφές σε αυτόν τον λογαριασμό.",
      "ac.src": "{p} · {n} επαφή/ές · αποσυνδέθηκε",
      "ac.own": "Χρήση δικού μου αναγνωριστικού εφαρμογής",
      "ac.own.text": "Καταχώρισε μια εφαρμογή OAuth (Google Cloud: Web application με το People API· Microsoft Entra: single-page app για προσωπικούς και εταιρικούς λογαριασμούς) με αυτή τη διεύθυνση επιστροφής και επικόλλησε το client id της. Μένει μόνο σε αυτή τη συσκευή.",
      "ac.own.save": "Αποθήκευση",
      "ac.own.saved": "Αποθηκεύτηκε σε αυτή τη συσκευή",
      "ac.own.bad": "Αυτό δεν μοιάζει με client id",
      "rv.title": "Έλεγχος εισαγωγής",
      "rv.sum": "{new} νέες · {diff} με άλλα στοιχεία · {same} υπάρχουν ήδη",
      "rv.folded": "{n} υπήρχαν δύο φορές στην εισαγωγή και ενώθηκαν",
      "rv.pref": "Όταν ένα στοιχείο διαφέρει:",
      "rv.act.add": "Προσθήκη",
      "rv.act.skip": "Παράλειψη",
      "rv.act.merge": "Συγχώνευση, κράτα τα δικά μου",
      "rv.act.theirs": "Συγχώνευση, πάρε τα εισαγόμενα",
      "rv.act.sep": "Προσθήκη ως ξεχωριστή",
      "rv.grp.diff": "Με άλλα στοιχεία ({n})",
      "rv.grp.new": "Νέες ({n})",
      "rv.grp.same": "Υπάρχουν ήδη, παραλείπονται ({n})",
      "rv.more": "…και άλλες {n}, με την προτεινόμενη επιλογή",
      "rv.by.email": "Ίδιο email",
      "rv.by.phone": "Ίδιο τηλέφωνο",
      "rv.by.name": "Ίδιο όνομα",
      "rv.adds": "Προσθέτει",
      "rv.nameonly": "Ίδιο όνομα αλλά άλλα τηλέφωνα και email: μάλλον άλλο πρόσωπο",
      "rv.birthday": "Γενέθλια",
      "rv.safe": "Τίποτα δεν διαγράφεται. Η συγχώνευση μόνο προσθέτει στοιχεία· το «πάρε τα εισαγόμενα» αντικαθιστά μια τιμή που διαφέρει.",
      "rv.go": "Εισαγωγή",
      "rv.done": "{a} προστέθηκαν · {m} συγχωνεύτηκαν · {s} παραλείφθηκαν",
      "rv.nothing": "Τίποτα νέο για εισαγωγή",
      "rv.undone": "Η εισαγωγή αναιρέθηκε",
      "ct.import.csv.bad": "Το αρχείο CSV δεν μπόρεσε να διαβαστεί",
      "ct.import.csv.noheader": "Δεν βρέθηκαν επαφές σε αυτό το αρχείο CSV",
      "ct.import.csv.norows": "Δεν βρέθηκαν εισαγώμενες επαφές στο CSV",
      "undo": "Αναίρεση",
      "lbl.personal": "Προσωπικό",
      "lbl.work": "Εργασία",
      "lbl.family": "Οικογένεια",
      "lbl.manage": "Διαχείριση ετικετών",
      "lbl.new": "Νέα ετικέτα",
      "lbl.ph.name": "Όνομα…",
      "lbl.color": "Χρώμα",
      "lbl.done": "Τέλος",
      "lbl.delete": "Διαγραφή",
      "lbl.inuse": "Η ετικέτα χρησιμοποιείται από επαφές",
      "lbl.empty": "Δεν υπάρχουν ετικέτες ακόμα",
      "ty.mobile": "Κινητό",
      "ty.home": "Σπίτι",
      "ty.work": "Εργασία",
      "ty.main": "Κύριο",
      "ty.other": "Άλλο",
      "ty.blog": "Blog",
      "evt.birthday": "Γενέθλια",
      "evt.anniversary": "Επέτειος",
      "evt.custom": "Προσαρμοσμένη",
      "evt.ph": "Ονομαστική εορτή…",
      "ct.unnamed": "(χωρίς όνομα)",
      "ct.lbl.filter": "Ετικέτες",
      "dup.scan": "Διπλότυπα",
      "dup.title": "Διπλότυπες επαφές",
      "dup.none": "Δεν βρέθηκαν διπλότυπα",
      "dup.count": "Ομάδες",
      "dup.merge": "Συγχώνευση διπλότυπων",
      "dup.primary": "Κύρια επαφή",
      "dup.flip": "Αντιστροφή κύριας",
      "dup.do": "Συγχώνευση τώρα",
      "dup.reason.phone": "Ίδιο τηλέφωνο",
      "dup.reason.email": "Ίδιο email",
      "dup.reason.name": "Παρόμοιο όνομα",
      "dup.merged": "Οι επαφές συγχωνεύτηκαν",
      "dup.undo": "Αναίρεση",
      "dup.sect.def": "Βέβαια ταιριάσματα",
      "dup.sect.pos": "Πιθανά ταιριάσματα",
      "ct.avatar": "Φωτογραφία",
      "ct.avatar.up": "Μεταφόρτωση φωτογραφίας",
      "ct.avatar.rem": "Αφαίρεση",
      "ct.avatar.bad": "Η εικόνα δεν μπόρεσε να διαβαστεί",
      "ct.avatar.big": "Η εικόνα είναι πολύ μεγάλη μετά τη συμπίεση — δοκίμασε άλλη",
      "ct.field.relations": "Σχέσεις",
      "ct.add.relation": "＋ Σχέση",
      "ct.rel.pick": "— επαφή —",
      "ct.rel.in": "Σύνδεση από άλλες επαφές",
      "rel.spouse": "Σύζυγος",
      "rel.partner": "Σύντροφος",
      "rel.parent": "Γονέας",
      "rel.child": "Παιδί",
      "rel.sibling": "Αδελφός/ή",
      "rel.friend": "Φίλος/η",
      "rel.colleague": "Συνάδελφος",
      "rel.manager": "Αφεντικό",
      "rel.other": "Αλλη",
      "ct.back": "Πίσω",
      "ct.share": "Κοινοποίηση",
      "ct.familytree": "Οικογενειακό δέντρο",
      "ct.qr": "Κωδικός QR",
      "ct.crm": "Πελάτης: {name}",
      "ct.share.done": "Η επαφή αντιγράφηκε στο πρόχειρο",
      "ct.share.fail": "Η αντιγραφή απέτυχε — δοκίμασε ξανά",
      "ct.maps": "Εμφάνιση στον χάρτη",
      "kt.field": "Διατήρηση επαφής",
      "kt.every": "κάθε",
      "kt.off": "Όχι",
      "kt.weeks": "εβδομάδες",
      "kt.months": "μήνες",
      "kt.cad.w1": "Κάθε εβδομάδα",
      "kt.cad.w": "Κάθε {n} εβδομάδες",
      "kt.cad.m1": "Κάθε μήνα",
      "kt.cad.m": "Κάθε {n} μήνες",
      "kt.last": "Τελευταία επαφή",
      "kt.never": "Ποτέ",
      "kt.next": "Επικοινωνία έως {date}",
      "kt.overdue": "Εκκρεμεί από {date}",
      "kt.duetoday": "Εκκρεμεί σήμερα",
      "kt.today.btn": "Μιλήσαμε σήμερα",
      "kt.today.done": "Καταγράφηκε επαφή σήμερα",
      "kt.log.btn": "＋ Καταγραφή",
      "kt.timeline": "Χρονολόγιο",
      "kt.reach": "Για επικοινωνία",
      "kt.reach.none": "Κανείς δεν περιμένει νέα σου αυτή τη στιγμή.",
      "kt.rem": "Υπενθύμιση στις",
      "kt.rem.hint": "Ειδοποίηση σε αυτή τη συσκευή τις μέρες που κάποιος περιμένει νέα σου. Η ρύθμιση μένει σε αυτή τη συσκευή.",
      "kt.sub.never": "Καμία επαφή ακόμα",
      "kt.sub.last": "Τελευταία επαφή {rel}",
      "rel.today": "σήμερα",
      "rel.yday": "χθες",
      "rel.days": "πριν από {n} μέρες",
      "rel.week1": "πριν από μία εβδομάδα",
      "rel.weeks": "πριν από {n} εβδομάδες",
      "rel.month1": "πριν από έναν μήνα",
      "rel.months": "πριν από {n} μήνες",
      "rel.year1": "πριν από έναν χρόνο",
      "rel.years": "πριν από {n} χρόνια",
      "ix.new": "Καταγραφή επικοινωνίας",
      "ix.edit": "Επεξεργασία καταγραφής",
      "ix.kind": "Είδος",
      "ix.date": "Ημερομηνία",
      "ix.text": "Τι έγινε",
      "ix.ph": "Μιλήσαμε για το ταξίδι…",
      "ix.k.call": "Κλήση",
      "ix.k.meet": "Συνάντηση",
      "ix.k.msg": "Μήνυμα",
      "ix.k.gift": "Δώρο",
      "ix.k.note": "Σημείωση",
      "ix.del": "Διαγραφή",
      "ix.deleted": "Η καταγραφή διαγράφηκε",
      "ix.bad": "Διάλεξε ημερομηνία",
      "ix.none": "Τίποτα καταγεγραμμένο ακόμα.",
      "cm.title": "Αντιστοίχιση στηλών",
      "cm.text": "Διάλεξε τι περιέχει κάθε στήλη. Οι στήλες με «Παράλειψη» δεν εισάγονται.",
      "cm.header": "Η πρώτη γραμμή έχει τα ονόματα των στηλών",
      "cm.dates": "Ημερομηνίες",
      "cm.dmy": "ημέρα/μήνας/έτος",
      "cm.mdy": "μήνας/ημέρα/έτος",
      "cm.col": "Στήλη {n}",
      "cm.preview": "Προεπισκόπηση · {n} επαφές",
      "cm.next": "Συνέχεια",
      "cm.none": "Καμία επαφή με αυτές τις στήλες. Διάλεξε τουλάχιστον μια στήλη με όνομα, εταιρεία, email ή τηλέφωνο.",
      "cm.f.skip": "Παράλειψη",
      "cm.f.full": "Ονοματεπώνυμο",
      "cm.f.phone": "Τηλέφωνο",
      "cm.f.email": "Email",
      "cm.f.website": "Ιστοσελίδα",
      "cm.f.street": "Οδός",
      "cm.f.city": "Πόλη",
      "cm.f.zip": "Τ.Κ.",
      "cm.f.region": "Περιοχή",
      "cm.f.country": "Χώρα",
      "cm.type": "Τύπος",
      "sc.btn": "Σάρωση κάρτας",
      "sc.title": "Σάρωση επαγγελματικής κάρτας",
      "sc.text": "Φωτογράφισε μια επαγγελματική κάρτα ή διάλεξε μια εικόνα της. Το orOS διαβάζει το κείμενο σε αυτή τη συσκευή και συμπληρώνει μια νέα επαφή για να την ελέγξεις.",
      "sc.photo": "Λήψη φωτογραφίας",
      "sc.pick": "Επιλογή εικόνας",
      "sc.paste": "Κείμενο της κάρτας",
      "sc.ph": "Όνομα, εταιρεία, τηλέφωνο, email… ή επικόλλησε εδώ το κείμενο της κάρτας",
      "sc.fill": "Συμπλήρωση νέας επαφής",
      "sc.dl.text": "Για να διαβαστεί η κάρτα χρειάζεται η μηχανή αναγνώρισης κειμένου (Tesseract, αγγλικά και ελληνικά, περίπου 7 MB). Κατεβαίνει μία φορά από τον δικό ιστότοπο του orOS (vendor/tesseract/) και τρέχει σε αυτή τη συσκευή: η εικόνα δεν φεύγει ποτέ από εδώ.",
      "sc.dl.go": "Λήψη και ανάγνωση",
      "sc.wait.load": "Φόρτωση αναγνώρισης κειμένου… {p}%",
      "sc.wait.read": "Ανάγνωση της κάρτας… {p}%",
      "sc.err": "Η εικόνα δεν διαβάστηκε ({e}). Μπορείς να πληκτρολογήσεις το κείμενο παρακάτω.",
      "sc.empty": "Δεν βρέθηκε κείμενο. Δοκίμασε πιο καθαρή φωτογραφία με καλό φως ή πληκτρολόγησε το κείμενο παρακάτω.",
      "sc.done": "Έλεγξε το κείμενο και πάτησε «Συμπλήρωση νέας επαφής».",
      "sc.nofill": "Γράψε ή διάβασε πρώτα κάποιο κείμενο",
      "sc.check": "Έλεγξε τα στοιχεία και πάτησε Αποθήκευση"
    }
  };
  function t(k) {
    return (STR[LANG] && STR[LANG][k] !== undefined) ? STR[LANG][k]
         : (STR.en[k] !== undefined ? STR.en[k] : k);
  }
  function applyI18n() {
    var els = document.querySelectorAll("[data-i18n]");
    for (var i = 0; i < els.length; i++) els[i].textContent = t(els[i].getAttribute("data-i18n"));
    var phs = document.querySelectorAll("[data-i18n-ph]");
    for (var j = 0; j < phs.length; j++) phs[j].placeholder = t(phs[j].getAttribute("data-i18n-ph"));
    var airs = document.querySelectorAll("[data-i18n-aria]");
    for (var k = 0; k < airs.length; k++) airs[k].setAttribute("aria-label", t(airs[k].getAttribute("data-i18n-aria")));
  }

  // Boot marker (stale-bundle detection — R3/R11) + live lang attr
  var SCRIPT_V = "";
  (function () {
    var m = (document.currentScript && document.currentScript.src || "")
      .match(/[?&]v=([^&#]+)/);
    SCRIPT_V = m ? m[1] : "";
    document.documentElement.lang = LANG;
    console.log("contacts.js v" + (SCRIPT_V || "?") + " boot");
  })();

  function $(id) { return document.getElementById(id); }
  function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }

  // Lazy singleton toast (orOS standard: top-right, text node FIRST,
  // optional action button SECOND, 5s auto-hide, single-slot).
  var toastEl = null, toastTimer = null;
  function hideToast() {
    if (toastTimer) { clearTimeout(toastTimer); toastTimer = null; }
    if (toastEl) toastEl.classList.remove("show");
  }
  function toast(text, actionLabel, actionFn) {
    if (!toastEl) {
      toastEl = document.createElement("div");
      toastEl.className = "app-toast";
      document.body.appendChild(toastEl);
    }
    if (toastTimer) { clearTimeout(toastTimer); toastTimer = null; }
    toastEl.textContent = "";               // wipe before append
    toastEl.appendChild(document.createTextNode(text));
    if (actionLabel && typeof actionFn === "function") {
      var b = document.createElement("button");
      b.type = "button";
      b.className = "app-toast-btn";
      b.textContent = actionLabel;
      b.addEventListener("click", function () {
        hideToast();
        actionFn();
      });
      toastEl.appendChild(b);
    }
    toastEl.classList.add("show");
    // Undo toasts stay 8 s (Part VII); plain notes 5 s.
    toastTimer = setTimeout(hideToast, (actionLabel && typeof actionFn === "function") ? 8000 : 5000);
  }

  // --- Unified notifications (Wave 12 migration) ---
  // Dynamic parent resolution + cross-origin guard; local toast()
  // remains as stale-bundle fallback for zero-crash boot.
  function notifyTransient(text) {
    try {
      var N = (window.parent && window.parent.orosNotifs) ||
               window.orosNotifs || null;
      if (N && typeof N.transient === "function") {
        N.transient({ ns: "contacts", title: text, body: "" });
        return;
      }
    } catch (e) { /* cross-origin guard */ }
    toast(text);
  }

  /* ---------- 2. State + schemas ---------- */
  var DATA_KEY = "oros-contacts-data";
  var MG = window.OrosContactsMerge || null;     // contacts/merge.js (per-field merge, log)
  var KP = window.OrosContactsKeep || null;      // contacts/keep.js (keep in touch)
  var state = { ver: 1, labels: [], contacts: [], deleted: [] };

  // Fixed label palette — identical bytes to the Calendar's, so a
  // label id + color pair renders the same hue in BOTH apps (the
  // birthday feed chip must match the Contacts side visually).
  var LABEL_PALETTE = [
    "#d4af37", "#a78bfa", "#7aa2f7", "#9ece6a",
    "#e06c75", "#ff9e64", "#4ec9b0", "#f28fb6"
  ];

  // Field type vocabularies (whitelist contract, mirrors Calendar's
  // REMIND_PRESETS doctrine: strict, enumerable, deterministic).
  var PHONE_TYPES = ["mobile", "home", "work", "main", "other"];
  var EMAIL_TYPES = ["home", "work", "other"];
  var ADDR_TYPES  = ["home", "work", "other"];
  var WEB_TYPES   = ["home", "work", "blog", "other"];
  var IM_TYPES    = ["home", "work", "other"];
  var EVENT_TYPES = ["birthday", "anniversary", "custom"];

  // Wave 2.3 — cross-contact relations. Stored ONLY on the
  // initiator (ONE record); the inverse direction is COMPUTED at
  // render time via the inverse map — no double-write, so no
  // merge races and no risk of half-updated pairs on sync.
  var RELATION_TYPES = ["spouse", "partner", "parent", "child",
                        "sibling", "friend", "colleague", "manager", "other"];
  var RELATION_INVERSE = {
    spouse: "spouse", partner: "partner",
    parent: "child",  child: "parent",
    sibling: "sibling", friend: "friend",
    colleague: "colleague", manager: "other", other: "other"
  };

  // Calendar day validity: year 2000 is leap → Feb 29 is legal.
  function validDay(day) {
    if (typeof day !== "string" || !/^\d{2}-\d{2}$/.test(day)) return false;
    var mm = +day.slice(0, 2), dd = +day.slice(3);
    if (mm < 1 || mm > 12 || dd < 1) return false;
    return dd <= new Date(2000, mm, 0).getDate();
  }

  // Seeds for fresh installs (mtime 0 → any user edit wins the merge
  // everywhere; identical bytes on every device — no Date.now() here).
  function defaultLabels() {
    return [
      { id: "lbl-personal", name: t("lbl.personal"), color: LABEL_PALETTE[0], mtime: 0 },
      { id: "lbl-work",     name: t("lbl.work"),     color: LABEL_PALETTE[4], mtime: 0 },
      { id: "lbl-family",   name: t("lbl.family"),   color: LABEL_PALETTE[3], mtime: 0 }
    ];
  }

  // Untouched seeds (mtime 0) follow the ACTIVE language — exact
  // mirror of calendar.js reseedSeedNames (merge-inert by design).
  function reseedSeedNames() {
    var map = {
      "lbl-personal": t("lbl.personal"),
      "lbl-work":     t("lbl.work"),
      "lbl-family":   t("lbl.family")
    };
    // #3 — seed colors must match the Calendar's defaults byte-for-
    // byte (shared palette): Personal gold, Work red, Family green.
    // mtime === 0 means never user-touched (every recolor bumps
    // mtime), so this migration can never override user intent.
    var seedColors = {
      "lbl-personal": LABEL_PALETTE[0],
      "lbl-work":     LABEL_PALETTE[4],
      "lbl-family":   LABEL_PALETTE[3]
    };
    var changed = false;
    state.labels.forEach(function (l) {
      if (l.mtime === 0 && map[l.id]) {
        if (l.name !== map[l.id]) {
          l.name = map[l.id];
          changed = true;
        }
        if (seedColors[l.id] && l.color !== seedColors[l.id]) {
          l.color = seedColors[l.id];
          changed = true;
        }
      }
    });
    if (changed) {
      try { localStorage.setItem(DATA_KEY, JSON.stringify(state)); } catch (e) {}
    }
  }

  function sanitizeLabel(l) {
    if (!l || typeof l !== "object") return null;
    if (typeof l.id !== "string" || !l.id) return null;
    if (LABEL_PALETTE.indexOf(l.color) === -1) return null;
    return {
      id: l.id,
      name: (typeof l.name === "string" ? l.name : "").slice(0, 40),
      color: l.color,
      mtime: (typeof l.mtime === "number" && isFinite(l.mtime)) ? l.mtime : 0
    };
  }

  function labelById(id) {
    for (var i = 0; i < state.labels.length; i++) {
      if (state.labels[i].id === id) return state.labels[i];
    }
    return null;
  }
  function labelColor(labelId) {
    var l = labelById(labelId);
    if (l) return l.color;
    var acc = "";
    try {
      acc = getComputedStyle(document.documentElement)
        .getPropertyValue("--accent").trim();
    } catch (e) {}
    return acc || "#d4af37";
  }

  // Typed multi-field row sanitizers. Each takes a RAW row, returns
  // a normalized row or null (dropped — empty/invalid never stored).
  function sanVal(row, len, types) {
    if (!row || typeof row !== "object") return null;
    var v = (typeof row.v === "string" ? row.v : "").trim().slice(0, len);
    if (!v) return null;
    var ty = (types.indexOf(row.type) !== -1) ? row.type : "other";
    return { v: v, type: ty };
  }
  // Google's CSV export joins several values of one field with
  // " ::: ". Older imports stored them as one value; split them back
  // into rows (same type), dropping a repeat of a value already there.
  // Deterministic, so every device reaches the same result.
  function splitMulti(list, phone) {
    if (!Array.isArray(list)) return [];
    var out = [];
    function same(a, b) {
      if (!phone) return a.toLowerCase() === b.toLowerCase();
      var IPm = window.OrosContactsImport;
      return IPm ? IPm.samePhone(a, b) : phoneDigits(a) === phoneDigits(b);
    }
    list.forEach(function (r) {
      if (!r || typeof r !== "object" || typeof r.v !== "string" || r.v.indexOf(":::") === -1) { out.push(r); return; }
      r.v.split(":::").forEach(function (part) {
        part = part.replace(/:+$/, "").trim();
        if (!part) return;
        if (out.some(function (o) { return o && typeof o.v === "string" && same(o.v.trim(), part); })) return;
        out.push({ v: part, type: r.type });
      });
    });
    return out;
  }
  function sanAddr(row) {
    if (!row || typeof row !== "object") return null;
    var street = (typeof row.street === "string" ? row.street : "").trim().slice(0, 120);
    var city   = (typeof row.city   === "string" ? row.city   : "").trim().slice(0, 60);
    var zip    = (typeof row.zip    === "string" ? row.zip    : "").trim().slice(0, 20);
    var region = (typeof row.region === "string" ? row.region : "").trim().slice(0, 60);
    var country= (typeof row.country=== "string" ? row.country: "").trim().slice(0, 60);
    if (!street && !city && !zip && !region && !country) return null;
    var ty = (ADDR_TYPES.indexOf(row.type) !== -1) ? row.type : "other";
    return { street: street, city: city, zip: zip, region: region, country: country, type: ty };
  }
  function sanEvent(row) {
    if (!row || typeof row !== "object") return null;
    if (!validDay(row.day)) return null;
    var ty = (EVENT_TYPES.indexOf(row.type) !== -1) ? row.type : "custom";
    var year = null;
    if (typeof row.year === "number" && isFinite(row.year) &&
        row.year >= 1850 && row.year <= 2200) year = row.year;
    return {
      day: row.day,
      year: year,
      type: ty,
      label: (typeof row.label === "string" ? row.label : "").trim().slice(0, 40)
    };
  }

  function sanRelation(row) {
    if (!row || typeof row !== "object") return null;
    if (typeof row.with !== "string" || !row.with) return null;
    var ty = (RELATION_TYPES.indexOf(row.type) !== -1) ? row.type : "other";
    return { with: row.with, type: ty };
  }

  // Load-time sanitizer (lenient mtime fallback — the strict merge
  // twin lives in §9 with the no-Date.now() merge contract).
  function sanitizeContact(c) {
    if (!c || typeof c !== "object") return null;
    if (typeof c.id !== "string" || !c.id) return null;
    var seen = {};
    var lids = [];
    if (Array.isArray(c.labelIds)) {
      c.labelIds.forEach(function (lid) {
        if (typeof lid === "string" && lid && !seen[lid]) { seen[lid] = true; lids.push(lid); }
      });
    }
    lids.sort();   // deterministic bytes → JSON tie-break in merge
    var out = {
      id: c.id,
      given:    (typeof c.given === "string" ? c.given : "").slice(0, 60),
      middle:   (typeof c.middle === "string" ? c.middle : "").slice(0, 60),
      family:   (typeof c.family === "string" ? c.family : "").slice(0, 60),
      nickname: (typeof c.nickname === "string" ? c.nickname : "").slice(0, 60),
      org:      (typeof c.org === "string" ? c.org : "").slice(0, 80),
      jobTitle: (typeof c.jobTitle === "string" ? c.jobTitle : "").slice(0, 80),
      phones:    splitMulti(c.phones, true).map(function (r) { return sanVal(r, 40, PHONE_TYPES); }).filter(Boolean),
      emails:    splitMulti(c.emails, false).map(function (r) { return sanVal(r, 120, EMAIL_TYPES); }).filter(Boolean),
      addresses: (Array.isArray(c.addresses) ? c.addresses : []).map(sanAddr).filter(Boolean),
      websites:  splitMulti(c.websites, false).map(function (r) { return sanVal(r, 300, WEB_TYPES); }).filter(Boolean),
      im:        (Array.isArray(c.im) ? c.im : []).map(function (r) { return sanVal(r, 120, IM_TYPES); }).filter(Boolean),
      events:    (Array.isArray(c.events) ? c.events : []).map(sanEvent).filter(Boolean)
                   .sort(function (a, b) { return a.type < b.type ? -1 : (a.type > b.type ? 1 : (a.day < b.day ? -1 : 1)); }),
      relations: (function () {
        var seen = {}, out = [];
        (Array.isArray(c.relations) ? c.relations : []).forEach(function (r) {
          var s = sanRelation(r);
          if (s && !seen[s.with + "|" + s.type]) { seen[s.with + "|" + s.type] = 1; out.push(s); }
        });
        out.sort(function (a, b) { return a.with < b.with ? -1 : (a.with > b.with ? 1 : 0); });
        return out;   // deterministic bytes → JSON tie-break in merge
      })(),
      labelIds:  lids,
      starred:   c.starred === true,
      note:      (typeof c.note === "string" ? c.note : "").slice(0, 500),
      photo:     (typeof c.photo === "string" && /^data:image\/(jpeg|png);base64,/.test(c.photo)) ? c.photo.slice(0, 50000) : null,
      mtime:     (typeof c.mtime === "number" && isFinite(c.mtime)) ? c.mtime : Date.now()
    };
    // CT-PF / keep in touch: keep, seen, log, logDel, fm — present
    // only when the stored contact has them (old data stays byte-
    // identical, so loading it never re-uploads anything).
    return MG ? MG.sanExtras(c, out) : out;
  }

  // Tombstones: { id, mtime } — same shared-list contract as the
  // Calendar (contacts + labels die through ONE list).
  function sanitizeTomb(d) {
    if (!d || typeof d !== "object") return null;
    if (typeof d.id !== "string" || !d.id) return null;
    return {
      id: d.id,
      mtime: (typeof d.mtime === "number" && isFinite(d.mtime)) ? d.mtime : Date.now()
    };
  }

  function loadState() {
    var rawText = null;
    try {
      rawText = localStorage.getItem(DATA_KEY);
      var d = JSON.parse(rawText);
      // CT-3: stored text that is not a contacts object would be
      // overwritten by the first save — keep a verbatim rescue copy
      // first (device-local, never synced).
      if (rawText && (!d || typeof d !== "object" || !Array.isArray(d.contacts))) rescueRaw(rawText);
      if (d && typeof d === "object" && Array.isArray(d.contacts)) {
        state.contacts = d.contacts.map(sanitizeContact).filter(Boolean);
      }
      if (d && Array.isArray(d.deleted)) {
        state.deleted = d.deleted.map(sanitizeTomb).filter(Boolean);
      }
      if (d && Array.isArray(d.labels)) {
        state.labels = d.labels.map(sanitizeLabel).filter(Boolean);
      }
      if (!state.labels.length) state.labels = defaultLabels();
    } catch (e) {
      rescueRaw(rawText);
      if (!state.labels.length) state.labels = defaultLabels();
    }
  }
  function rescueRaw(text) {
    if (!text) return;
    try { localStorage.setItem(DATA_KEY + "-broken", text); } catch (e) {}
    try { console.error("contacts: unreadable data copied to " + DATA_KEY + "-broken"); } catch (e) {}
  }
  // CT-PF: every write goes through here, so this is where each
  // contact's changed fields get their own stamp (merge.js restamp):
  // the copy about to be stored is compared with the stored one.
  function stampContacts() {
    if (!MG) return;
    var prev = {};
    try {
      var d = JSON.parse(localStorage.getItem(DATA_KEY));
      (d && Array.isArray(d.contacts) ? d.contacts : []).forEach(function (c) {
        var sc = sanitizeContact(c);
        if (sc) prev[sc.id] = sc;
      });
    } catch (e) {}
    var now = Date.now();
    state.contacts.forEach(function (c) {
      var p = prev[c.id] || null;
      if (p && JSON.stringify(p) === JSON.stringify(c)) return;
      MG.restamp(p, c, now);
    });
  }
  function saveState() {
    stampContacts();
    try { localStorage.setItem(DATA_KEY, JSON.stringify(state)); } catch (e) {}
    markDirty();
  }

  // Shell sync bridge — canonical __orosSyncApi funnel (Part VII).
  function markDirty() {
    try {
      if (window.__orosSyncApi) window.__orosSyncApi.dirty();
    } catch (e) {}
  }

  // orosDialog lives in the parent shell (same-origin iframe).
  // Standalone PWA mode -> null -> caller uses local fallback.
  function dialogHost() {
    try {
      return window.orosDialog || window.parent.orosDialog || null;
    } catch (e) { return null; }
  }

  /* ---------- 3. Display helpers ---------- */
  function displayName(c) {
    var parts = [c.given, c.middle, c.family].filter(Boolean);
    if (parts.length) return parts.join(" ");
    if (c.nickname) return c.nickname;
    if (c.org) return c.org;
    return t("ct.unnamed");
  }
  function initials(c) {
    var a = (c.given || "").charAt(0);
    var b = (c.family || c.org || c.nickname || "").charAt(0);
    var s = (a + b).toUpperCase();
    return s || "?";
  }
  function subLine(c) {
    if (c.jobTitle && c.org) return c.jobTitle + " · " + c.org;
    if (c.org) return c.org;
    if (c.jobTitle) return c.jobTitle;
    if (c.phones.length) return c.phones[0].v;
    if (c.emails.length) return c.emails[0].v;
    if (c.events.length) {
      var ev = c.events[0];
      return t("evt." + ev.type) + (ev.year ? " · " + ev.year : "");
    }
    return "";
  }
  // Phone-normalized search digits: "69…" matches "+30 69…".
  function phoneDigits(s) {
    return String(s || "").replace(/\D+/g, "");
  }

  // ===== TRANSLITERATION SEARCH (Wave 2.3) =====
  // greekFold: lowercase + accent-strip (ά→α, ή→η…) + ς→σ.
  // Latin passes through untouched. latinize: greekFold +
  // Greek→Latin letter map — "dionisis" finds "Διονύσης".
  // SEARCH-ONLY: nothing is ever stored transliterated.
  function greekFold(s) {
    var n = String(s || "").toLowerCase().normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "");
    return n.replace(/ς/g, "σ");
  }
  var LATIN_MAP = {
    "α": "a", "β": "v", "γ": "g", "δ": "d", "ε": "e", "ζ": "z",
    "η": "i", "θ": "th", "ι": "i", "κ": "k", "λ": "l", "μ": "m",
    "ν": "n", "ξ": "x", "ο": "o", "π": "p", "ρ": "r", "σ": "s",
    "τ": "t", "υ": "y", "φ": "f", "χ": "ch", "ψ": "ps", "ω": "o"
  };
  function latinize(s) {
    var f = greekFold(s);
    var out = "";
    for (var i = 0; i < f.length; i++) {
      out += (LATIN_MAP[f.charAt(i)] !== undefined) ? LATIN_MAP[f.charAt(i)] : f.charAt(i);
    }
    return out;
  }
  function contactById(id) {
    for (var i = 0; i < state.contacts.length; i++) {
      if (state.contacts[i].id === id) return state.contacts[i];
    }
    return null;
  }
  // Text haystack per contact: own fields + names of related
  // contacts (searching "Maria" finds everyone married to a Maria).
  function searchHay(c) {
    var hay = [displayName(c), c.nickname, c.org, c.jobTitle, c.note].join(" ");
    (c.relations || []).forEach(function (r) {
      var o = contactById(r.with);
      if (o) hay += " " + displayName(o);
    });
    return hay;
  }
  // Relations pointing AT this contact — COMPUTED inverse, never
  // stored. Deleted targets are skipped by contactById returning
  // null wherever used (dangling refs are render-safe by design).
  function incomingRelations(c) {
    var out = [];
    state.contacts.forEach(function (o) {
      if (o.id === c.id) return;
      (o.relations || []).forEach(function (r) {
        if (r.with === c.id) out.push({ id: o.id, type: RELATION_INVERSE[r.type] || "other" });
      });
    });
    return out;
  }

  // ===== DUPLICATE DETECTION ENGINE =====
  // Union-find structure for grouping contacts by match criteria.
  // Matches are definitive (email/phone) or possible (name-only).
  function normalizeEmail(e) {
    return String(e || "").toLowerCase().trim();
  }
  function nameKey(c) {
    // Normalization: given+family, accent-folded via greekFold
    // (lowercase + diacritics strip + ς→σ), so "Διονύσης" and
    // "Διονυσης" collapse to one dedup key.
    var s = greekFold([c.given, c.family].filter(Boolean).join(" "));
    return s.replace(/\s+/g, " ").trim();
  }

  // Union-Find data structure for contact IDs.
  function UnionFind(ids) {
    this.parent = {};
    this.rank = {};
    ids.forEach(function (id) {
      this.parent[id] = id;
      this.rank[id] = 0;
    }.bind(this));
  }
  UnionFind.prototype.find = function (x) {
    if (this.parent[x] !== x) this.parent[x] = this.find(this.parent[x]);
    return this.parent[x];
  };
  UnionFind.prototype.union = function (x, y) {
    var rx = this.find(x), ry = this.find(y);
    if (rx === ry) return;
    if (this.rank[rx] < this.rank[ry]) this.parent[rx] = ry;
    else if (this.rank[rx] > this.rank[ry]) this.parent[ry] = rx;
    else { this.parent[ry] = rx; this.rank[rx]++; }
  };

  // Scan contacts for duplicates. Returns { definitive: [], possible: [] }.
  // definitive = shared email OR shared normalized phone.
  // possible = name key collision (needs second signal).
  function scanDuplicates() {
    var ids = state.contacts.map(function (c) { return c.id; });
    var uf = new UnionFind(ids);
    var definitive = [];
    var possible = [];

    // Build lookup maps for email/phone → contact IDs.
    var emailMap = {}, phoneMap = {};
    state.contacts.forEach(function (c) {
      c.emails.forEach(function (e) {
        var em = normalizeEmail(e.v);
        if (!emailMap[em]) emailMap[em] = [];
        emailMap[em].push(c.id);
      });
      c.phones.forEach(function (p) {
        var pd = phoneDigits(p.v);
        if (pd.length < 5) return; // too short to be meaningful
        if (!phoneMap[pd]) phoneMap[pd] = [];
        phoneMap[pd].push(c.id);
      });
    });

    // Definitive matches: shared email or phone.
    // Also compute name collision groups for "possible matches".
    Object.keys(emailMap).forEach(function (em) {
      var group = emailMap[em];
      if (group.length < 2) return;
      for (var i = 0; i < group.length - 1; i++) {
        uf.union(group[i], group[i + 1]);
      }
    });
    Object.keys(phoneMap).forEach(function (pd) {
      var group = phoneMap[pd];
      if (group.length < 2) return;
      for (var j = 0; j < group.length - 1; j++) {
        uf.union(group[j], group[j + 1]);
      }
    });

    // Name-based collision groups (separate from definitive).
    var nameMap = {};
    state.contacts.forEach(function (c) {
      var nk = nameKey(c);
      if (!nk || nk.length < 2) return; // too short to be meaningful
      if (!nameMap[nk]) nameMap[nk] = [];
      nameMap[nk].push(c.id);
    });
    Object.keys(nameMap).forEach(function (nk) {
      var group = nameMap[nk];
      if (group.length < 2) return;
      for (var ni = 0; ni < group.length - 1; ni++) {
        uf.union(group[ni], group[ni + 1]);
      }
    });

    // Group by root ID.
    var groups = {};
    ids.forEach(function (id) {
      var root = uf.find(id);
      if (!groups[root]) groups[root] = [];
      groups[root].push(id);
    });

    // Filter to groups with 2+ members.
    Object.keys(groups).forEach(function (root) {
      var mem = groups[root];
      if (mem.length < 2) return;
      var members = mem.map(function (id) {
        return state.contacts.find(function (c) { return c.id === id; });
      });
      // Pair-wise ANY-to-ANY check (members[0]-centric check lied for
      // chained groups: A~B by email, B~C by name → whole group judged
      // from A alone could miss the definitive pair).
      function pairShare(listOf, normOf) {
        for (var i = 0; i < members.length; i++) {
          for (var j = i + 1; j < members.length; j++) {
            var ai = listOf(members[i]), bj = listOf(members[j]);
            for (var x = 0; x < ai.length; x++) {
              for (var y = 0; y < bj.length; y++) {
                if (normOf(ai[x]) === normOf(bj[y])) return true;
              }
            }
          }
        }
        return false;
      }
      var hasSharedEmail = pairShare(function (m) { return m.emails; },
                                     function (e) { return normalizeEmail(e.v); });
      var hasSharedPhone = pairShare(function (m) { return m.phones; },
                                     function (p) { return phoneDigits(p.v); });
      var hasDefinite = hasSharedEmail || hasSharedPhone;
      var reason = hasSharedEmail ? t("dup.reason.email")
                 : (hasSharedPhone ? t("dup.reason.phone") : t("dup.reason.name"));
      var groupObj = { ids: mem, reason: reason, definitive: hasDefinite };
      if (hasDefinite) definitive.push(groupObj);
      else possible.push(groupObj);
    });

    return { definitive: definitive, possible: possible };
  }

  // Render duplicate groups into a dialog.
  function renderDupDialog(scanResult) {
    var box = $("dedup-groups");
    box.textContent = "";
    var noneMsg = $("dedup-none");
    var hasAny = scanResult.definitive.length + scanResult.possible.length > 0;
    noneMsg.hidden = hasAny;

    if (!hasAny) {
      noneMsg.textContent = t("dup.none");
      return;
    }

    // Helper to create a group row.
    function makeGroupRow(group, idx) {
      var div = document.createElement("div");
      div.className = "dup-group";

      var head = document.createElement("div");
      head.className = "dup-group-head";
      var badge = document.createElement("span");
      badge.className = "dup-badge";
      badge.textContent = group.ids.length + " " + t("dup.count");
      var reason = document.createElement("span");
      reason.textContent = " · " + group.reason;
      head.appendChild(badge);
      head.appendChild(reason);
      div.appendChild(head);

      // Mini contact rows for each member.
      var list = document.createElement("ul");
      list.className = "dup-members";
      group.ids.forEach(function (id) {
        var c = state.contacts.find(function (x) { return x.id === id; });
        if (!c) return;
        var li = document.createElement("li");
        // Real button (not plain li) — Enter/Space work, same as the
        // main list rows; focus-visible outline comes free.
        var btn = document.createElement("button");
        btn.type = "button";
        btn.className = "ct-row dup-member";
        btn.appendChild(mkAvatarEl(c));
        var main = document.createElement("div");
        main.className = "ct-main";
        var nm = document.createElement("div");
        nm.className = "ct-name";
        nm.textContent = displayName(c);
        main.appendChild(nm);
        var sb = subLine(c);
        if (sb) {
          var sub = document.createElement("div");
          sub.className = "ct-sub";
          sub.textContent = sb;
          main.appendChild(sub);
        }
        btn.appendChild(main);
        // Click OR keyboard opens the merge dialog for this group.
        (function (gid) {
          btn.addEventListener("click", function () { openMergeDlg(gid); });
        })(group.ids);
        li.appendChild(btn);
        list.appendChild(li);
      });
      div.appendChild(list);

      return div;
    }

    // Section: definitive matches.
    if (scanResult.definitive.length) {
      var secDef = document.createElement("div");
      var hDef = document.createElement("h4");
      hDef.textContent = t("dup.sect.def");
      secDef.appendChild(hDef);
      scanResult.definitive.forEach(function (g, i) {
        secDef.appendChild(makeGroupRow(g, i));
      });
      box.appendChild(secDef);
    }

    // Section: possible matches.
    if (scanResult.possible.length) {
      var secPos = document.createElement("div");
      var hPos = document.createElement("h4");
      hPos.textContent = t("dup.sect.pos");
      secPos.appendChild(hPos);
      scanResult.possible.forEach(function (g, i) {
        secPos.appendChild(makeGroupRow(g, i));
      });
      box.appendChild(secPos);
    }
  }

  // Label visibility: id -> true/false. Absent = visible.
  var labelVis = {};
  function labelVisible(labelId) {
    if (!labelId) return true;
    return labelVis[labelId] !== false;
  }
  function anyLabelVisible(c) {
    if (!c.labelIds.length) return true;
    for (var i = 0; i < c.labelIds.length; i++) {
      if (labelVis[c.labelIds[i]] !== false) return true;
    }
    return false;
  }

  var searchQ = "";

  // Quick filter (Wave 1): "all" | "starred". Keeps the exclusive
  // filter separate from the label VISIBILITY toggles in the chips.
  var quickFilter = "all";
  function setQuickFilter(mode) {
    quickFilter = mode;
    renderChips();
    renderList();
  }

  // Reach out: the reminder switch and hour, device-local
  // (localStorage oros-contacts-keep, read by the shell's engine).
  function readKeepPrefs() {
    var raw = null;
    try { raw = JSON.parse(localStorage.getItem(KP.PREFS_KEY) || "null"); } catch (e) { raw = null; }
    return KP.prefs(raw);
  }
  function renderReachBar() {
    var bar = $("reach-bar");
    if (!bar || !KP) return;
    bar.hidden = quickFilter !== "reach";
    if (bar.hidden) return;
    var sel = $("reach-hour");
    if (!sel.options.length) {
      for (var h = 0; h < 24; h++) {
        var o = document.createElement("option");
        o.value = String(h);
        o.textContent = (h < 10 ? "0" : "") + h + ":00";
        sel.appendChild(o);
      }
      var save = function () {
        var p = { on: $("reach-on").checked, hour: +sel.value };
        try { localStorage.setItem(KP.PREFS_KEY, JSON.stringify(p)); } catch (e) {}
        sel.disabled = !p.on;
      };
      $("reach-on").addEventListener("change", save);
      sel.addEventListener("change", save);
    }
    var p = readKeepPrefs();
    $("reach-on").checked = p.on;
    sel.value = String(p.hour);
    sel.disabled = !p.on;
  }
  // Injected styling for the active quick-filter chip (self-
  // contained — no dependency on unseen contacts.css selectors).
  (function () {
    var st = document.createElement("style");
    st.textContent =
      ".chip.qf{font-weight:600}" +
      ".chip.qf.on{border-color:var(--accent,#d4af37);" +
        "color:var(--accent,#d4af37);" +
        "background:var(--accent-soft,rgba(212,175,55,.15))}";
    document.head.appendChild(st);
  })();

  /* ---------- 4. List render ---------- */
  var listShown = [];   // ids in the list right now (search / filters applied)
  function renderList() {
    var ul = $("ct-list");
    ul.textContent = "";

    var q = searchQ.trim().toLowerCase();
    var qDigits = phoneDigits(q);
    var qFold = greekFold(q);

    renderReachBar();
    var today = todayYmd();
    var due = {};                      // id → keep status (cadence set)
    if (KP) state.contacts.forEach(function (c) {
      if (c.keep) { var st = KP.status(c, today); if (st) due[c.id] = st; }
    });
    var reach = quickFilter === "reach";
    var hits = state.contacts.filter(function (c) {
      if (quickFilter === "starred" && !c.starred) return false;
      if (reach && !(due[c.id] && due[c.id].overdue)) return false;
      if (!anyLabelVisible(c)) return false;
      if (!q) return true;
      // Layer 1: accent-insensitive direct match (Greek↔Greek).
      // Layer 2: transliterated match (Latin query → Greek names).
      var hay = searchHay(c);
      if (greekFold(hay).indexOf(qFold) !== -1) return true;
      if (latinize(hay).indexOf(q) !== -1) return true;
      if (qDigits.length >= 3) {
        for (var i = 0; i < c.phones.length; i++) {
          if (phoneDigits(c.phones[i].v).indexOf(qDigits) !== -1) return true;
        }
      }
      for (var j = 0; j < c.emails.length; j++) {
        if (c.emails[j].v.toLowerCase().indexOf(q) !== -1) return true;
      }
      return false;
    });
    listShown = hits.map(function (c) { return c.id; });
    hits.sort(function (a, b) {
      // Reach out: who has waited longest comes first
      if (reach && due[a.id].due !== due[b.id].due) return due[a.id].due < due[b.id].due ? -1 : 1;
      if (a.starred !== b.starred) return a.starred ? -1 : 1;
      // Accent-insensitive collation: "Ήλιος" sorts with H, not last.
      var la = greekFold(displayName(a)).localeCompare(greekFold(displayName(b)), LANG);
      return la !== 0 ? la : (a.id < b.id ? -1 : 1);
    });

    if (!hits.length) {
      var emp = document.createElement("li");
      emp.className = "empty";
      emp.textContent = t(q ? "ct.search.none" : (reach ? "kt.reach.none" : "ct.none"));
      ul.appendChild(emp);
      return;
    }

    hits.forEach(function (c) {
      var li = document.createElement("li");
      var row = document.createElement("button");
      row.type = "button";
      row.className = "ct-row";

      row.appendChild(mkAvatarEl(c));

      var main = document.createElement("div");
      main.className = "ct-main";
      var nm = document.createElement("div");
      nm.className = "ct-name";
      nm.textContent = displayName(c);
      main.appendChild(nm);
      var sb = reach ? touchSub(c, due[c.id]) : subLine(c);
      if (sb) {
        var sub = document.createElement("div");
        sub.className = "ct-sub";
        sub.textContent = sb;
        main.appendChild(sub);
      }
      if (reach) {
        var dl = document.createElement("div");
        dl.className = "ct-sub kt-due";
        dl.textContent = dueText(due[c.id]);
        main.appendChild(dl);
      }
      row.appendChild(main);
      if (!reach && due[c.id] && due[c.id].overdue) {
        var bell = document.createElement("span");
        bell.className = "ct-due";
        bell.textContent = "⏰";
        bell.title = t("kt.reach");
        row.appendChild(bell);
      }

      if (c.labelIds.length) {
        var tags = document.createElement("span");
        tags.className = "ct-tags";
        c.labelIds.forEach(function (lid) {
          var tg = document.createElement("span");
          tg.className = "ct-tag";
          tg.style.background = labelColor(lid);
          tags.appendChild(tg);
        });
        row.appendChild(tags);
      }
      if (c.starred) {
        var st = document.createElement("span");
        st.className = "ct-star";
        st.textContent = "★";
        row.appendChild(st);
      }

      (function (cc) {
        row.addEventListener("click", function () { openViewCard(cc); });
      })(c);

      li.appendChild(row);
      ul.appendChild(li);
    });
  }

  /* ---------- 4b. Label filter chips (calendar mirror) ---------- */
  function renderChips() {
    var row = $("lbl-chips");
    row.textContent = "";

    // Quick filter tabs first (exclusive), then label chips (visibility).
    // "Reach out" appears once someone has a keep-in-touch cadence.
    var modes = ["all", "starred"], nDue = 0, anyKeep = false;
    if (KP) {
      var today = todayYmd();
      state.contacts.forEach(function (c) {
        if (!c.keep) return;
        anyKeep = true;
        var st = KP.status(c, today);
        if (st && st.overdue) nDue++;
      });
    }
    if (anyKeep || quickFilter === "reach") modes.push("reach");
    modes.forEach(function (mode) {
      var q = document.createElement("button");
      q.type = "button";
      q.className = "chip qf" + (quickFilter === mode ? " on" : "");
      q.textContent = mode === "all" ? t("ct.filter.all")
        : (mode === "starred" ? "★ " + t("ct.filter.starred") : "⏰ " + t("kt.reach") + (nDue ? " · " + nDue : ""));
      q.addEventListener("click", function () { setQuickFilter(mode); });
      row.appendChild(q);
    });

    state.labels.forEach(function (l) {
      var c = document.createElement("button");
      c.type = "button";
      c.className = "chip" + (labelVisible(l.id) ? "" : " off");
      c.style.setProperty("--chip", l.color);
      var dot = document.createElement("span");
      dot.className = "chip-dot";
      dot.style.background = l.color;
      c.appendChild(dot);
      c.appendChild(document.createTextNode(l.name));
      c.addEventListener("click", function () {
        labelVis[l.id] = !labelVisible(l.id);
        renderChips();
        renderList();
      });
      row.appendChild(c);
    });
    var mg = document.createElement("button");
    mg.type = "button";
    mg.className = "chip chip-manage";
    mg.textContent = "＋ " + t("lbl.manage");
    mg.addEventListener("click", openLblDlg);
    row.appendChild(mg);
  }

  var searchDebounceTimer = null;
  if ($("search-in")) {
    $("search-in").addEventListener("input", function () {
      var v = this.value;
      if (searchDebounceTimer) clearTimeout(searchDebounceTimer);
      searchDebounceTimer = setTimeout(function () {
        searchQ = v;
        renderList();
      }, 250);
    });
  }
  if ($("imp-done")) {
    $("imp-done").addEventListener("click", function () {
      $("import-sec").hidden = true;
      $("imp-list").textContent = "";
    });
  }

// ===== VIEW CARD (#4 — read-only contact card) =====
// List rows open a READ card first; Edit lives behind a button on
// the card. The shell deep-link (__orosContactsOpen) lands on the
// same card. Fully JS-built with injected styles — no dependency
// on unseen contacts.css selectors.

var VIEW_CSS_DONE = false;
function ensureViewCss() {
  if (VIEW_CSS_DONE) return;
  VIEW_CSS_DONE = true;
  var st = document.createElement("style");
  st.textContent =
    "#ct-view{position:fixed;inset:0;z-index:60;background:rgba(0,0,0,.5);" +
      "display:flex;justify-content:center;overflow:auto;" +
      "padding:24px 12px}" +
    ".ct-view-card{margin:auto;background:var(--panel-bg,#22242a);color:var(--text,#eee);" +
      "border:1px solid var(--border,#333);border-radius:14px;" +
      "box-shadow:var(--shadow,0 8px 30px rgba(0,0,0,.4));" +
      "width:100%;max-width:480px;padding:18px 18px 16px;position:relative}" +
    ".ct-view-x{position:absolute;top:10px;right:10px;width:30px;height:30px;" +
      "border:1px solid var(--border,#333);border-radius:8px;background:transparent;" +
      "color:var(--text-dim,#999);cursor:pointer;font-size:14px;line-height:1}" +
    ".ct-view-head{display:flex;flex-direction:column;align-items:center;gap:8px;" +
      "text-align:center}" +
    "#ct-view .ct-avatar{width:76px;height:76px;border-radius:50%;font-size:24px}" +
    "#ct-view .ct-avatar-img{width:76px;height:76px;border-radius:50%;object-fit:cover}" +
    ".ct-view-name{font-size:19px;font-weight:700;margin:0}" +
    ".ct-view-sub{font-size:12.5px;color:var(--text-dim,#999);margin:0}" +
    ".ct-view-star{color:#d4af37;font-size:13px}" +
    ".ct-view-lbls{display:flex;flex-wrap:wrap;gap:6px;justify-content:center;margin:10px 0 4px}" +
    ".ct-vs-title{font-size:11px;font-weight:700;text-transform:uppercase;" +
      "letter-spacing:.06em;color:var(--text-dim,#999);margin:16px 0 6px}" +
    ".ct-vs-row{display:flex;justify-content:space-between;gap:10px;padding:7px 0;" +
      "border-top:1px solid var(--border,#333);font-size:13px;align-items:baseline}" +
    ".ct-vs-key{color:var(--text-dim,#999);flex-shrink:0}" +
    ".ct-vs-val{color:var(--text,#eee);text-decoration:none;word-break:break-word;text-align:right}" +
    "a.ct-vs-val:hover{color:var(--accent,#d4af37);text-decoration:underline}" +
    ".ct-vs-val.map-link{cursor:pointer}" +
    ".ct-vs-val.map-link:hover{color:var(--accent,#d4af37);text-decoration:underline}" +
    ".ct-view-note{font-size:13px;white-space:pre-wrap;line-height:1.5;" +
      "padding-top:8px;border-top:1px solid var(--border,#333)}" +
    ".ct-view-foot{display:flex;flex-wrap:wrap;justify-content:flex-end;gap:8px;margin-top:18px}" +
    ".ct-view-share{border:1px solid var(--border,#333);background:transparent;" +
      "color:var(--text-dim,#999);border-radius:8px;padding:8px 18px;font:inherit;" +
      "cursor:pointer;font-weight:600}" +
    ".ct-view-share:hover{color:var(--text,#eee);border-color:var(--text-dim,#999)}" +
    ".ct-view-edit{border:1px solid var(--accent,#d4af37);background:transparent;" +
      "color:var(--accent,#d4af37);border-radius:8px;padding:8px 18px;font:inherit;" +
      "cursor:pointer;font-weight:600}" +
    ".ct-view-edit:hover{background:var(--accent-soft,rgba(212,175,55,.15))}" +
    "@media (max-width:520px){" +
      "#ct-view{padding:0;align-items:stretch}" +
      ".ct-view-card{max-width:none;border-radius:0;border:none;min-height:100%}}";
  document.head.appendChild(st);
}

var viewCardId = null;   // CT-2: which contact the open card shows
// orOS Mail with an account on this device (shell only) → the shell,
// so an e-mail address opens Mail's composer; else null (mailto:).
function mailOpener() {
  var shell = null;
  try { shell = window.parent !== window && typeof window.parent.__orosOpenAt === "function" ? window.parent : null; } catch (e) {}
  if (!shell) return null;
  try {
    var d = JSON.parse(localStorage.getItem("oros-mail-data") || "null");
    return d && Array.isArray(d.accounts) && d.accounts.length ? shell : null;
  } catch (e) { return null; }
}

function closeViewCard() {
  var ov = $("ct-view");
  if (ov) ov.parentNode.removeChild(ov);
  viewCardId = null;
}

// Full plain-text dump of a contact — one line per field, typed,
// search-friendly. Same content goes to the clipboard (desktop)
// and the Web Share sheet (mobile).
function shareText(c) {
  var L = [];
  var head = displayName(c);
  var sb = subLine(c);
  L.push(sb ? head + " — " + sb : head);
  if (c.nickname) L.push(t("ct.field.nickname") + ": " + c.nickname);
  if (c.org) L.push(t("ct.field.org") + ": " + c.org);
  if (c.jobTitle) L.push(t("ct.field.jobtitle") + ": " + c.jobTitle);
  c.phones.forEach(function (p) {
    L.push(t("ct.field.phones") + " (" + t("ty." + p.type) + "): " + p.v);
  });
  c.emails.forEach(function (e) {
    L.push(t("ct.field.emails") + " (" + t("ty." + e.type) + "): " + e.v);
  });
  c.addresses.forEach(function (a) {
    var txt = [a.street, a.city, [a.zip, a.region].filter(Boolean).join(" "), a.country]
      .filter(Boolean).join(", ");
    L.push(t("ct.field.addresses") + " (" + t("ty." + a.type) + "): " + txt);
  });
  c.websites.forEach(function (w) {
    L.push(t("ct.field.websites") + " (" + t("ty." + w.type) + "): " + w.v);
  });
  c.im.forEach(function (m) {
    L.push(t("ct.field.im") + " (" + t("ty." + m.type) + "): " + m.v);
  });
  c.events.forEach(function (e) {
    L.push(t("evt." + e.type) + ": " + evtDateText(e));
  });
  (c.relations || []).forEach(function (r) {
    var o = contactById(r.with);
    L.push(t("rel." + r.type) + ": " + (o ? displayName(o) : t("ct.unnamed")));
  });
  if (c.note) L.push(t("ct.field.note") + ": " + c.note);
  return L.join("\n");
}

// "Send to someone" (shell share/, kind "contact"): the card's own
// fields only. Photo, labels, star and relations stay at home.
function sharePayload(c) {
  var vt = function (r) { return { v: r.v, ty: r.type }; };
  return {
    g: c.given, mi: c.middle, f: c.family, nn: c.nickname, o: c.org, j: c.jobTitle,
    p: c.phones.map(vt), e: c.emails.map(vt), im: c.im.map(vt), u: c.websites.map(vt),
    a: c.addresses.map(function (a) {
      return { s: a.street, c: a.city, r: a.region, z: a.zip, co: a.country, ty: a.type };
    }),
    ev: c.events.map(function (e) { return { ty: e.type, d: e.day, y: e.year, l: e.label }; }),
    x: c.note
  };
}

// Legacy fallback for non-secure contexts / older browsers where
// the async Clipboard API is unavailable (execCommand path).
function legacyCopy(text) {
  var ta = document.createElement("textarea");
  ta.value = text;
  ta.style.position = "fixed";
  ta.style.opacity = "0";
  document.body.appendChild(ta);
  ta.select();
  var ok = false;
  try { ok = document.execCommand("copy"); } catch (e) {}
  document.body.removeChild(ta);
  return ok;
}

// Mobile-only native share: desktop browsers (Chrome/Edge on
// Windows expose navigator.share → Windows Share sheet) must NOT
// use it. Detection: navigator.share exists AND touch-capable AND
// NOT a desktop UA. Android UAs contain "Android" (never "X11"),
// iOS/iPadOS are touch-only — both pass cleanly.
function shareOnMobile() {
  if (!navigator.share) return false;
  if (/Windows NT|Macintosh|X11|CrOS/.test(navigator.userAgent)) return false;
  if (navigator.maxTouchPoints === 0 && !/Android|iPhone|iPad|Mobile/i.test(navigator.userAgent)) return false;
  return true;
}

// Mobile → native share sheet with the full text.
// Desktop (incl. Windows) → clipboard copy + toast. Nothing stored.
function shareContact(c) {
  var text = shareText(c);
  if (shareOnMobile()) {
    navigator.share({ title: displayName(c), text: text }).catch(function () {});
    return;
  }
  var done = function () { notifyTransient(t("ct.share.done")); };
  var fail = function () { notifyTransient(t("ct.share.fail")); };
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(done, function () {
      if (legacyCopy(text)) done(); else fail();
    });
    return;
  }
  if (legacyCopy(text)) done(); else fail();
}

// ===== MAPS BRIDGE (Wave 6) =====
// Structured address → geocode query. Field order mirrors
// shareText's address line: street, city, "zip region", country.
function addrToQuery(a) {
  return [a.street, a.city,
    [a.zip, a.region].filter(Boolean).join(" "), a.country]
    .filter(Boolean).join(", ");
}

// Shell bridge: parent dispatch (__orosMapsOpen) when running
// inside orOS — live push if Maps is open, staged open otherwise.
// Standalone fallback: maps page in a new tab with ?q= (geocode
// on boot, see maps.js PATCH-47).
function openInMaps(query, label) {
  try {
    if (window.parent &&
        typeof window.parent.__orosOpenMapsQuery === "function") {
      window.parent.__orosOpenMapsQuery(query, label || "");
      return;
    }
  } catch (e) { /* cross-origin guard */ }
  window.open("/maps/?q=" + encodeURIComponent(query),
    "_blank", "noopener,noreferrer");
}

// One row: dim key on the left, value on the right (link when an
// href is given). RETURNS the value node so callers can attach
// click handlers (incoming-relation navigation).
function viewRow(parent, key, text, href) {
  var row = document.createElement("div");
  row.className = "ct-vs-row";
  var k = document.createElement("span");
  k.className = "ct-vs-key";
  k.textContent = key;
  var v;
  if (href) {
    v = document.createElement("a");
    v.href = href;
    if (/^https?:/i.test(href)) { v.target = "_blank"; v.rel = "noopener noreferrer"; }
  } else {
    v = document.createElement("span");
  }
  v.className = "ct-vs-val";
  v.textContent = text;
  row.appendChild(k);
  row.appendChild(v);
  parent.appendChild(row);
  return v;
}

function viewSection(card, titleKey) {
  var h = document.createElement("div");
  h.className = "ct-vs-title";
  h.textContent = t(titleKey);
  var body = document.createElement("div");
  card.appendChild(h);
  card.appendChild(body);
  return body;
}

function evtDateText(ev) {
  return ev.year ? (ev.year + "-" + ev.day) : ev.day;
}

// ===== KEEP IN TOUCH (card section, timeline, interaction log) =====
// Data: c.keep {n, u}, c.seen "YYYY-MM-DD", c.log [{id, k, d, tx, m}],
// c.logDel {id: m} — merged per field / per item (contacts/merge.js);
// what is due comes from contacts/keep.js, the same file the shell's
// reminder engine reads.
var IX_ICON = { call: "📞", meet: "🤝", msg: "💬", gift: "🎁", note: "📝" };
function todayYmd() {
  var d = new Date();
  return d.getFullYear() + "-" + (d.getMonth() < 9 ? "0" : "") + (d.getMonth() + 1) +
    "-" + (d.getDate() < 10 ? "0" : "") + d.getDate();
}
function fmtYmd(ymd) {
  if (!ymd) return "";
  var p = ymd.split("-");
  try {
    return new Date(+p[0], +p[1] - 1, +p[2]).toLocaleDateString(LANG === "el" ? "el-GR" : "en-GB",
      { day: "numeric", month: "short", year: "numeric" });
  } catch (e) { return ymd; }
}
function relText(ymd) {
  if (!KP || !ymd) return "";
  var n = KP.daysBetween(ymd, todayYmd());
  if (n <= 0) return t("rel.today");
  if (n === 1) return t("rel.yday");
  if (n < 7) return t("rel.days").replace("{n}", String(n));
  if (n < 14) return t("rel.week1");
  if (n < 30) return t("rel.weeks").replace("{n}", String(Math.floor(n / 7)));
  if (n < 60) return t("rel.month1");
  if (n < 365) return t("rel.months").replace("{n}", String(Math.floor(n / 30.44)));
  if (n < 730) return t("rel.year1");
  return t("rel.years").replace("{n}", String(Math.floor(n / 365.25)));
}
function cadenceText(k) {
  if (!k) return "";
  if (k.n === 1) return t(k.u === "w" ? "kt.cad.w1" : "kt.cad.m1");
  return t(k.u === "w" ? "kt.cad.w" : "kt.cad.m").replace("{n}", String(k.n));
}
// One line for the list and the card: when to get in touch next.
function dueText(st) {
  if (!st) return "";
  if (st.days > 0) return t("kt.overdue").replace("{date}", fmtYmd(st.due));
  if (st.days === 0) return t("kt.duetoday");
  return t("kt.next").replace("{date}", fmtYmd(st.due));
}
function touchSub(c, st) {
  var last = KP ? KP.lastContact(c, todayYmd()) : "";
  var a = last ? t("kt.sub.last").replace("{rel}", relText(last)) : t("kt.sub.never");
  return a + (c.keep ? " · " + cadenceText(c.keep) : "");
}

function renderTouch(card, c) {
  var today = todayYmd();
  var sec = viewSection(card, "kt.field");
  var last = KP ? KP.lastContact(c, today) : "";
  viewRow(sec, t("kt.last"), last ? relText(last) + " · " + fmtYmd(last) : t("kt.never"));
  if (c.keep && KP) {
    var st = KP.status(c, today);
    var v = viewRow(sec, cadenceText(c.keep), dueText(st));
    if (st && st.overdue) v.classList.add("kt-due");
  }
  var row = document.createElement("div");
  row.className = "kt-btns";
  var b1 = document.createElement("button");
  b1.type = "button";
  b1.className = "ct-view-share";
  b1.textContent = t("kt.today.btn");
  b1.disabled = (c.seen === today);
  b1.addEventListener("click", function () { markContactedToday(c.id); });
  var b2 = document.createElement("button");
  b2.type = "button";
  b2.className = "ct-view-share";
  b2.textContent = t("kt.log.btn");
  b2.addEventListener("click", function () { openIxDlg(c.id, null); });
  row.appendChild(b1);
  row.appendChild(b2);
  sec.appendChild(row);
}

function renderTimeline(card, c) {
  var log = Array.isArray(c.log) ? c.log.slice() : [];
  var sec = viewSection(card, "kt.timeline");
  if (!log.length) {
    var p = document.createElement("p");
    p.className = "kt-empty";
    p.textContent = t("ix.none");
    sec.appendChild(p);
    return;
  }
  log.sort(function (a, b) { return a.d !== b.d ? (a.d < b.d ? 1 : -1) : (b.m - a.m); });
  var ol = document.createElement("ol");
  ol.className = "kt-tl";
  log.forEach(function (it) {
    var li = document.createElement("li");
    var btn = document.createElement("button");
    btn.type = "button";
    btn.className = "kt-item";
    var ic = document.createElement("span");
    ic.className = "kt-ic";
    ic.setAttribute("aria-hidden", "true");
    ic.textContent = IX_ICON[it.k] || "📝";
    var body = document.createElement("span");
    body.className = "kt-body";
    var head = document.createElement("span");
    head.className = "kt-head";
    head.textContent = t("ix.k." + it.k) + " · " + fmtYmd(it.d);
    body.appendChild(head);
    if (it.tx) {
      var tx = document.createElement("span");
      tx.className = "kt-tx";
      tx.textContent = it.tx;
      body.appendChild(tx);
    }
    btn.appendChild(ic);
    btn.appendChild(body);
    btn.addEventListener("click", function () { openIxDlg(c.id, it.id); });
    li.appendChild(btn);
    ol.appendChild(li);
  });
  sec.appendChild(ol);
}

// Write one changed copy of a contact (saveState stamps the fields
// that changed), then redraw what shows it.
function putContact(copy) {
  for (var i = 0; i < state.contacts.length; i++) {
    if (state.contacts[i].id === copy.id) {
      copy.mtime = Date.now();
      state.contacts[i] = sanitizeContact(copy);
      saveState();
      renderChips();
      renderList();
      if ($("ct-view") && viewCardId === copy.id) openViewCard(state.contacts[i]);
      return state.contacts[i];
    }
  }
  return null;
}
function markContactedToday(id) {
  var c = contactById(id);
  if (!c) return;
  var before = c.seen === undefined ? undefined : c.seen;
  var copy = JSON.parse(JSON.stringify(c));
  copy.seen = todayYmd();
  if (!putContact(copy)) return;
  toast(t("kt.today.done"), t("undo"), function () {
    var cur = contactById(id);
    if (!cur) return;
    var back = JSON.parse(JSON.stringify(cur));
    back.seen = before === undefined ? "" : before;
    putContact(back);
  });
}

var ixState = null;   // { id: contactId, item: logId|null }
function openIxDlg(contactId, itemId) {
  var c = contactById(contactId);
  if (!c || !MG) return;
  var it = null;
  (c.log || []).forEach(function (x) { if (x.id === itemId) it = x; });
  ixState = { id: contactId, item: it ? it.id : null };
  $("ix-dlg-title").textContent = t(it ? "ix.edit" : "ix.new");
  $("ix-who").textContent = displayName(c);
  var sel = $("ix-kind");
  if (!sel.options.length) {
    MG.KINDS.forEach(function (k) {
      var o = document.createElement("option");
      o.value = k;
      o.textContent = (IX_ICON[k] || "") + " " + t("ix.k." + k);
      sel.appendChild(o);
    });
  }
  sel.value = it ? it.k : "call";
  $("ix-date").value = it ? it.d : todayYmd();
  $("ix-text").value = it ? it.tx : "";
  $("ix-del-row").hidden = !it;
  try { if ($("ix-dlg").open) $("ix-dlg").close(); } catch (e) {}
  $("ix-dlg").showModal();
}
if ($("ix-dlg")) {
  $("ix-save").addEventListener("click", function () {
    if (!ixState) return;
    var d = $("ix-date").value;
    if (!MG.validYmd(d)) {
      $("ix-date").classList.add("invalid");
      notifyTransient(t("ix.bad"));
      setTimeout(function () { $("ix-date").classList.remove("invalid"); }, 1600);
      return;
    }
    var c = contactById(ixState.id);
    if (!c) { $("ix-dlg").close(); return; }
    var copy = JSON.parse(JSON.stringify(c));
    var old = null;
    (copy.log || []).forEach(function (x) { if (x.id === ixState.item) old = x; });
    var next = { id: ixState.item || uid(), k: $("ix-kind").value, d: d, tx: $("ix-text").value.trim() };
    if (old && old.k === next.k && old.d === next.d && old.tx === next.tx) { $("ix-dlg").close(); return; }
    MG.logPut(copy, next, Date.now());
    putContact(copy);
    $("ix-dlg").close();
  });
  $("ix-cancel").addEventListener("click", function () { $("ix-dlg").close(); });
  $("ix-del").addEventListener("click", function () {
    if (!ixState || !ixState.item) return;
    var c = contactById(ixState.id);
    if (!c) { $("ix-dlg").close(); return; }
    var copy = JSON.parse(JSON.stringify(c));
    var gone = MG.logRemove(copy, ixState.item, Date.now());
    var cid = ixState.id;
    $("ix-dlg").close();
    if (!gone) return;
    putContact(copy);
    toast(t("ix.deleted"), t("undo"), function () {
      var cur = contactById(cid);
      if (!cur) return;
      var back = JSON.parse(JSON.stringify(cur));
      MG.logPut(back, gone, Date.now());
      putContact(back);
    });
  });
  $("ix-dlg").addEventListener("click", function (ev) { if (ev.target === this) this.close(); });
  $("ix-dlg").addEventListener("close", function () { ixState = null; });
}

function openViewCard(c) {
  if (!c) return;
  closeViewCard();
  ensureViewCss();
  viewCardId = c.id;

  var ov = document.createElement("div");
  ov.id = "ct-view";
  var card = document.createElement("div");
  card.className = "ct-view-card";

  var x = document.createElement("button");
  x.type = "button";
  x.className = "ct-view-x";
  x.textContent = "✕";
  x.setAttribute("aria-label", t("ct.back"));
  x.addEventListener("click", closeViewCard);
  card.appendChild(x);

  var head = document.createElement("div");
  head.className = "ct-view-head";
  head.appendChild(mkAvatarEl(c));
  var nm = document.createElement("h2");
  nm.className = "ct-view-name";
  nm.textContent = displayName(c);
  head.appendChild(nm);
  var sb = subLine(c);
  if (sb) {
    var sub = document.createElement("p");
    sub.className = "ct-view-sub";
    sub.textContent = sb;
    head.appendChild(sub);
  }
  if (c.starred) {
    var star = document.createElement("span");
    star.className = "ct-view-star";
    star.textContent = "★";
    head.appendChild(star);
  }
  card.appendChild(head);

  if (c.labelIds.length) {
    var lbls = document.createElement("div");
    lbls.className = "ct-view-lbls";
    c.labelIds.forEach(function (lid) {
      var l = labelById(lid);
      if (!l) return;
      var chip = document.createElement("span");
      chip.className = "chip";
      chip.style.setProperty("--chip", l.color);
      var dot = document.createElement("span");
      dot.className = "chip-dot";
      dot.style.background = l.color;
      chip.appendChild(dot);
      chip.appendChild(document.createTextNode(l.name));
      lbls.appendChild(chip);
    });
    card.appendChild(lbls);
  }

  if (KP && MG) renderTouch(card, c);

  if (c.phones.length) {
    var ph = viewSection(card, "ct.field.phones");
    c.phones.forEach(function (p) {
      viewRow(ph, t("ty." + p.type), p.v,
        "tel:" + p.v.replace(/[\s()\u2013\u2014-]/g, ""));
    });
  }
  if (c.emails.length) {
    var em = viewSection(card, "ct.field.emails");
    var mailShell = mailOpener();
    c.emails.forEach(function (e) {
      var a = viewRow(em, t("ty." + e.type), e.v, "mailto:" + e.v);
      // orOS Mail set up on this device: write there instead of mailto:
      if (mailShell) a.addEventListener("click", function (ev) {
        ev.preventDefault();
        closeViewCard();
        var name = displayName(c);
        if (name === t("ct.unnamed")) name = "";
        mailShell.__orosOpenAt("mail", { compose: { to: (name ? "\"" + name.replace(/[\\"]/g, "\\$&") + "\" <" : "") + e.v + (name ? ">" : "") } });
      });
    });
  }
  if (c.addresses.length) {
    var ad = viewSection(card, "ct.field.addresses");
    c.addresses.forEach(function (a) {
      var txt = addrToQuery(a);
      var v = viewRow(ad, t("ty." + a.type), txt);
      v.classList.add("map-link");
      v.title = t("ct.maps");
      v.insertAdjacentHTML("beforeend",
        ' <svg width="11" height="11" viewBox="0 0 24 24" fill="none" ' +
        'stroke="currentColor" stroke-width="2" stroke-linecap="round" ' +
        'stroke-linejoin="round" style="opacity:.6;vertical-align:-1px">' +
        '<path d="M21 10c0 7-9 13-9 13S3 17 3 10a9 9 0 0 1 18 0z"/>' +
        '<circle cx="12" cy="10" r="3"/></svg>');
      v.addEventListener("click", function () {
        openInMaps(txt, displayName(c));
      });
    });
  }
  if (c.websites.length) {
    var wb = viewSection(card, "ct.field.websites");
    c.websites.forEach(function (w) {
      var href = /^https?:/i.test(w.v) ? w.v : ("https://" + w.v);
      viewRow(wb, t("ty." + w.type), w.v, href);
    });
  }
  if (c.im.length) {
    var im = viewSection(card, "ct.field.im");
    c.im.forEach(function (m) {
      viewRow(im, t("ty." + m.type), m.v);
    });
  }
  if (c.events.length) {
    var ev = viewSection(card, "ct.field.events");
    c.events.forEach(function (e) {
      var key = t("evt." + e.type) +
        ((e.type === "custom" && e.label) ? " · " + e.label : "");
      viewRow(ev, key, evtDateText(e));
    });
  }
  var outRels = c.relations || [];
  var incRels = incomingRelations(c);
  if (outRels.length || incRels.length) {
    var rl = viewSection(card, "ct.field.relations");
    outRels.forEach(function (r) {
      var o = contactById(r.with);
      var v = viewRow(rl, t("rel." + r.type),
        o ? displayName(o) : t("ct.unnamed"));
      if (o) {
        v.style.cursor = "pointer";
        v.addEventListener("click", function () { openViewCard(o); });
      }
    });
    incRels.forEach(function (r) {
      var o = contactById(r.id);
      if (!o) return;
      var v = viewRow(rl, t("rel." + r.type), displayName(o));
      v.style.cursor = "pointer";
      v.addEventListener("click", function () { openViewCard(o); });
    });
  }
  if (c.note) {
    var nt = viewSection(card, "ct.field.note");
    var p = document.createElement("div");
    p.className = "ct-view-note";
    p.textContent = c.note;
    nt.appendChild(p);
  }
  if (KP && MG) renderTimeline(card, c);

  var foot = document.createElement("div");
  foot.className = "ct-view-foot";
  var sh = document.createElement("button");
  sh.type = "button";
  sh.className = "ct-view-share";
  sh.textContent = t("ct.share");
  sh.addEventListener("click", function () {
    var api = null;
    try { api = window.parent !== window && window.parent.orosShare ? window.parent.orosShare : null; } catch (e) {}
    if (api) api.open({ kind: "contact", data: sharePayload(c), text: shareText(c) });
    else shareContact(c);
  });
  foot.appendChild(sh);
  // Family Tree (read-only bridge, generic deep link): the person
  // linked to this contact, or Family Tree's "Build from Contacts"
  // starting here. Shown only inside the shell.
  var shell = null;
  try { shell = window.parent !== window && typeof window.parent.__orosOpenAt === "function" ? window.parent : null; } catch (e) {}
  if (shell) {
    var ft = document.createElement("button");
    ft.type = "button";
    ft.className = "ct-view-share";
    ft.textContent = t("ct.familytree");
    ft.addEventListener("click", function () {
      closeViewCard();
      shell.__orosOpenAt("familytree", { contact: c.id });
    });
    foot.appendChild(ft);
    // QR app: a new vCard code from this contact (only the id travels).
    var qr = document.createElement("button");
    qr.type = "button";
    qr.className = "ct-view-share";
    qr.textContent = t("ct.qr");
    qr.addEventListener("click", function () {
      closeViewCard();
      shell.__orosOpenAt("qr", { from: "contacts", id: c.id });
    });
    foot.appendChild(qr);
    // CRM (read-only): each customer that lists this contact as a
    // person (at most 3) opens there. The shell's OrosCrmCore reads
    // the same oros-crm-data the app writes; no CRM data → no button.
    var crmCore = null, crmData = null;
    try { crmCore = shell.OrosCrmCore || null; } catch (e) {}
    if (crmCore) {
      try { crmData = crmCore.norm(JSON.parse(localStorage.getItem("oros-crm-data"))); } catch (e) { crmData = null; }
    }
    if (crmData) crmCore.custsForContact(crmData, c.id).slice(0, 3).forEach(function (cu) {
      var b = document.createElement("button");
      b.type = "button";
      b.className = "ct-view-share";
      b.textContent = t("ct.crm").replace("{name}", cu.name);
      b.addEventListener("click", function () {
        closeViewCard();
        shell.__orosOpenAt("crm", { cust: cu.id });
      });
      foot.appendChild(b);
    });
  }
  var ed = document.createElement("button");
  ed.type = "button";
  ed.className = "ct-view-edit";
  ed.textContent = t("ct.dlg.edit");
  ed.addEventListener("click", function () {
    closeViewCard();
    openDlg(c);
  });
  foot.appendChild(ed);
  card.appendChild(foot);

  ov.addEventListener("click", function (e) {
    if (e.target === ov) closeViewCard();
  });
  ov.appendChild(card);
  document.body.appendChild(ov);
}

// Global shortcuts. Ctrl+N is browser-reserved (cannot be
// intercepted in Chrome) — new contact uses Alt+N instead.
document.addEventListener("keydown", function (e) {
  // Ctrl/Cmd+F — focus search (browser find intentionally
  // overridden). Guarded: skipped while a dialog or the view card
  // is open, so focus never leaves an open modal's inputs.
  if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey &&
      (e.key === "f" || e.key === "F")) {
    var busy = ["ct-dlg", "del-dlg", "merge-dlg", "lbl-dlg", "rev-dlg", "ac-dlg", "ix-dlg", "csv-dlg", "scan-dlg"]
      .some(function (id) { var d = $(id); return d && d.open; })
      || !!$("ct-view");
    if (busy) return;
    var si = $("search-in");
    if (si) {
      e.preventDefault();
      si.focus();
      si.select();
    }
    return;
  }
  // Alt+N — new contact (guarded: never closes an open edit
  // dialog — an accidental shortcut must not silently discard
  // typed input)
  if (e.altKey && !e.ctrlKey && !e.metaKey &&
      (e.key === "n" || e.key === "N")) {
    var anyOpen = ["ct-dlg", "del-dlg", "merge-dlg", "lbl-dlg", "rev-dlg", "ac-dlg", "ix-dlg", "csv-dlg", "scan-dlg"]
      .some(function (id) { var d = $(id); return d && d.open; })
      || !!$("ct-view");
    if (anyOpen) return;
    e.preventDefault();
    openDlg(null);
    return;
  }
  // Escape — view card first, then any open dialog
  if (e.key === "Escape") {
    if ($("ct-view") && !(($("ix-dlg") && $("ix-dlg").open) || ($("ct-dlg") && $("ct-dlg").open))) { closeViewCard(); return; }
    ["ct-dlg", "del-dlg", "merge-dlg", "lbl-dlg", "rev-dlg", "ac-dlg", "ix-dlg", "csv-dlg", "scan-dlg"].forEach(function (id) {
      var d = $(id);
      if (d && d.open) { try { d.close(); } catch (err) {} }
    });
  }
});

// ===== CONTACT DIALOG =====

  /* ---------- 5. Multi-field editors ----------
     Each holder (phones/emails/websites/im) builds rows:
     [ value input ][ type select ][ ✕ ]. Rows live only in the
     dialog — read back into the contact on Save. Empty rows are
     dropped at read time (never stored, never synced). */

  function typeOptions(sel, types, current) {
    types.forEach(function (ty) {
      var o = document.createElement("option");
      o.value = ty;
      o.textContent = t("ty." + ty);
      if (ty === current) o.selected = true;
      sel.appendChild(o);
    });
  }

  // Generic { v, type } row builder (phones, emails, websites, im).
  function buildValRow(holder, val, type, types, ph, maxlen, i18n) {
    var row = document.createElement("div");
    row.className = "mf-row";

    var inp = document.createElement("input");
    inp.type = "text";
    inp.className = "mf-val";
    inp.maxLength = maxlen;
    inp.placeholder = ph;
    inp.value = val || "";
    inp.dataset.kind = i18n;
    row.appendChild(inp);

    var sel = document.createElement("select");
    sel.className = "mf-type";
    typeOptions(sel, types, type);
    row.appendChild(sel);

    var rm = document.createElement("button");
    rm.type = "button";
    rm.className = "mf-rm";
    rm.textContent = "✕";
    rm.setAttribute("aria-label", t("ct.cancel"));
    rm.addEventListener("click", function () {
      row.parentNode.removeChild(row);
    });
    row.appendChild(rm);

    holder.appendChild(row);
    return inp;
  }

  // Read all { v, type } rows from a holder.
  function readValRows(holder) {
    var out = [];
    var rows = holder.querySelectorAll(".mf-row:not(.addr):not(.ev)");
    for (var i = 0; i < rows.length; i++) {
      var v = rows[i].querySelector(".mf-val").value.trim();
      if (!v) continue;                            // empty row → dropped
      var sel = rows[i].querySelector("select");
      out.push({ v: v, type: sel.value });
    }
    return out;
  }

  // Address row: type select + 5 stacked text fields.
  function buildAddrRow(holder, addr) {
    addr = addr || {};
    var row = document.createElement("div");
    row.className = "mf-row addr";

    var fields = document.createElement("div");
    fields.className = "mf-addr-fields";
    [["street", 120, "Φ. Ερυθρών Σταυροφόρων 12 / 12 Crusaders St…"],
     ["city", 60, "Serres"],
     ["zip", 20, "621 00"],
     ["region", 60, "Central Macedonia / Κεντρική Μακεδονία"],
     ["country", 60, "Greece / Ελλάδα"]].forEach(function (def) {
      var inp = document.createElement("input");
      inp.type = "text";
      inp.className = "mf-af-" + def[0];
      inp.maxLength = def[1];
      inp.placeholder = def[2];
      inp.value = addr[def[0]] || "";
      fields.appendChild(inp);
    });
    row.appendChild(fields);

    var sel = document.createElement("select");
    sel.className = "mf-type";
    typeOptions(sel, ADDR_TYPES, addr.type || "home");
    row.appendChild(sel);

    var rm = document.createElement("button");
    rm.type = "button";
    rm.className = "mf-rm";
    rm.textContent = "✕";
    rm.setAttribute("aria-label", t("ct.cancel"));
    rm.addEventListener("click", function () {
      row.parentNode.removeChild(row);
    });
    row.appendChild(rm);

    holder.appendChild(row);
  }

  function readAddrRows(holder) {
    var out = [];
    var rows = holder.querySelectorAll(".mf-row.addr");
    for (var i = 0; i < rows.length; i++) {
      var g = function (cls) {
        return rows[i].querySelector("." + cls).value.trim();
      };
      var a = {
        street: g("mf-af-street"),
        city: g("mf-af-city"),
        zip: g("mf-af-zip"),
        region: g("mf-af-region"),
        country: g("mf-af-country"),
        type: rows[i].querySelector("select").value
      };
      if (a.street || a.city || a.zip || a.region || a.country) out.push(a);
    }
    return out;
  }

  // Event row: [ type select ][ date input (MM-DD via year "YYYY-MM-DD" trick
  // — see below) ][ "no year" toggle ][ custom label input ].
  //
  // DATE INPUT DESIGN (important): a native <input type="date"> CANNOT
  // represent a yearless birthday. We therefore use type="text" with a
  // YYYY-MM-DD pattern: full date = year kept; "MM-DD" (5 chars, e.g.
  // "03-17") or "--MM-DD" (vCard form) = yearless. The parse/validate
  // helper below normalizes both input styles. This keeps ONE input per
  // event row (minimal UI) while remaining honest about missing years.
  function parseEvtDate(raw) {
    var s = String(raw == null ? "" : raw).trim();
    var m;
    if ((m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/))) {
      return { day: m[2] + "-" + m[3], year: +m[1] };
    }
    if ((m = s.match(/^-{0,2}(\d{2})-(\d{2})$/))) {
      return { day: m[1] + "-" + m[2], year: null };
    }
    return null;
  }
  function fmtEvtDate(ev) {
    if (ev.year) return ev.year + "-" + ev.day;
    return ev.day;
  }

  function buildEvtRow(holder, ev) {
    ev = ev || {};
    var row = document.createElement("div");
    row.className = "mf-row ev";

    var sel = document.createElement("select");
    sel.className = "mf-type";
    EVENT_TYPES.forEach(function (ty) {
      var o = document.createElement("option");
      o.value = ty;
      o.textContent = t("evt." + ty);
      if (ty === (ev.type || "birthday")) o.selected = true;
      sel.appendChild(o);
    });
    row.appendChild(sel);

    var inp = document.createElement("input");
    inp.type = "text";
    inp.className = "mf-val";
    inp.maxLength = 10;
    inp.placeholder = "1975-03-17 / 03-17";
    inp.inputMode = "numeric";
    if (ev.day) inp.value = fmtEvtDate(ev);
    row.appendChild(inp);

    var rm = document.createElement("button");
    rm.type = "button";
    rm.className = "mf-rm";
    rm.textContent = "✕";
    rm.setAttribute("aria-label", t("ct.cancel"));
    rm.addEventListener("click", function () {
      row.parentNode.removeChild(row);
    });
    row.appendChild(rm);

    // Custom label input appears only for type=custom — keeps the
    // common rows (birthday) to exactly 3 controls.
    var labWrap = document.createElement("span");
    labWrap.className = "mf-evt-label";
    var labIn = document.createElement("input");
    labIn.type = "text";
    labIn.className = "mf-val mf-evt-label-in";
    labIn.maxLength = 40;
    labIn.placeholder = t("evt.ph");
    labIn.value = ev.label || "";
    labWrap.appendChild(labIn);
    labWrap.hidden = (sel.value !== "custom");
    row.insertBefore(labWrap, rm);

    sel.addEventListener("change", function () {
      labWrap.hidden = (sel.value !== "custom");
    });

    // live parse feedback: invalid → red border, never blocks typing
    inp.addEventListener("input", function () {
      var ok = !inp.value.trim() || parseEvtDate(inp.value);
      inp.classList.toggle("invalid", !ok);
    });

    holder.appendChild(row);
  }

  function readEvtRows(holder) {
    var out = [];
    var rows = holder.querySelectorAll(".mf-row.ev");
    for (var i = 0; i < rows.length; i++) {
      var sel = rows[i].querySelector(".mf-type");
      var raw = rows[i].querySelector(".mf-val").value.trim();
      if (!raw) continue;
      var parsed = parseEvtDate(raw);
      if (!parsed) continue;                      // invalid row → dropped
      var labIn = rows[i].querySelector(".mf-evt-label-in");
      out.push({
        day: parsed.day,
        year: parsed.year,
        type: sel.value,
        label: labIn ? labIn.value.trim().slice(0, 40) : ""
      });
    }
    return out;
  }

  // Relation row: [ contact select ][ type select ][ ✕ ].
  // The "who" select excludes the contact being edited (no
  // self-relations). Unpicked rows are dropped at read time.
  function buildRelRow(holder, rel) {
    rel = rel || {};
    var row = document.createElement("div");
    row.className = "mf-row rel";

    var who = document.createElement("select");
    who.className = "mf-val rel-who";
    var blank = document.createElement("option");
    blank.value = "";
    blank.textContent = t("ct.rel.pick");
    who.appendChild(blank);
    state.contacts.forEach(function (o) {
      if (o.id === editingId) return;
      var op = document.createElement("option");
      op.value = o.id;
      op.textContent = displayName(o);
      if (o.id === rel.with) op.selected = true;
      who.appendChild(op);
    });
    row.appendChild(who);

    var sel = document.createElement("select");
    sel.className = "mf-type";
    RELATION_TYPES.forEach(function (ty) {
      var o = document.createElement("option");
      o.value = ty;
      o.textContent = t("rel." + ty);
      if (ty === (rel.type || "friend")) o.selected = true;
      sel.appendChild(o);
    });
    row.appendChild(sel);

    var rm = document.createElement("button");
    rm.type = "button";
    rm.className = "mf-rm";
    rm.textContent = "✕";
    rm.setAttribute("aria-label", t("ct.cancel"));
    rm.addEventListener("click", function () {
      row.parentNode.removeChild(row);
    });
    row.appendChild(rm);

    holder.appendChild(row);
  }

  function readRelRows(holder) {
    var out = [];
    var rows = holder.querySelectorAll(".mf-row.rel");
    for (var i = 0; i < rows.length; i++) {
      var who = rows[i].querySelector(".rel-who");
      var sel = rows[i].querySelector(".mf-type");
      if (!who || !who.value || !sel) continue;   // unpicked → dropped
      out.push({ with: who.value, type: sel.value });
    }
    return out;
  }

  // Read-only inverse links (computed, never stored). Shown under
  // the editable relation rows; dangling (deleted) targets are
  // silently hidden — tombstones never leak into the UI.
  function renderDlgIncoming(existing) {
    var box = $("ct-rel-in");
    if (!box) return;
    box.textContent = "";
    if (!existing) return;
    var inc = incomingRelations(existing);
    if (!inc.length) return;
    var head = document.createElement("div");
    head.className = "rel-in-head";
    head.textContent = t("ct.rel.in");
    box.appendChild(head);
    inc.forEach(function (r) {
      var o = contactById(r.id);
      if (!o) return;
      var line = document.createElement("div");
      line.className = "rel-in-row";
      line.textContent = "· " + t("rel." + r.type) + " · " + displayName(o);
      box.appendChild(line);
    });
  }

  /* ---------- 5b. Dialog open/save/delete ---------- */
  var editingId = null;
  var dlgLabelIds = [];      // working copy of the contact's labels
  var editingPhoto = null;   // working copy of the contact's photo (data URI | null)

  function renderDlgLabels() {
    var row = $("ct-label-row");
    row.textContent = "";
    var mk = function (id, name, color) {
      var c = document.createElement("button");
      c.type = "button";
      c.className = "chip" + (dlgLabelIds.indexOf(id) !== -1 ? "" : " off");
      if (color) {
        var dot = document.createElement("span");
        dot.className = "chip-dot";
        dot.style.background = color;
        c.appendChild(dot);
      }
      c.appendChild(document.createTextNode(name));
      c.addEventListener("click", function () {
        var ix = dlgLabelIds.indexOf(id);
        if (ix === -1) dlgLabelIds.push(id);
        else dlgLabelIds.splice(ix, 1);
        renderDlgLabels();
      });
      row.appendChild(c);
    };
    state.labels.forEach(function (l) { mk(l.id, l.name, l.color); });
  }

  function fillHolder(holder, arr, builder) {
    holder.textContent = "";
    if (arr.length) {
      arr.forEach(function (item) { builder(holder, item); });
    } else {
      builder(holder, null);   // one empty starter row
    }
  }

  // ===== AVATAR HANDLING (Wave 2.3) =====
  // Upload → center-crop to square → 128×128 JPEG (quality 0.85,
  // typically 8–20KB) → data URI stored on the contact. Hard cap
  // 50000 chars (sanitizeContract's photo slot) protects
  // localStorage + sync payload.
  var AVATAR_SIZE = 128;

  // Shared avatar element: photo if present, initials otherwise.
  // Used by BOTH the contact list and the dedup member rows.
  function mkAvatarEl(c) {
    if (c.photo) {
      var im = document.createElement("img");
      im.className = "ct-avatar ct-avatar-img";
      im.alt = "";
      im.src = c.photo;
      return im;
    }
    var sp = document.createElement("span");
    sp.className = "ct-avatar";
    sp.textContent = initials(c);
    return sp;
  }

  // Dialog preview painter: draws the current data URI onto the
  // 64×64 canvas (scaled by CSS) and toggles the Remove button.
  function paintAvatarPreview(uri) {
    var cv = $("avatar-preview");
    var rmBtn = $("ct-avatar-remove");
    if (!cv) return;
    if (rmBtn) rmBtn.hidden = !uri;
    if (!uri) { cv.hidden = true; return; }
    var ctx = cv.getContext("2d");
    var img = new Image();
    img.onload = function () {
      cv.width = img.width;
      cv.height = img.height;
      cv.hidden = false;
      ctx.clearRect(0, 0, cv.width, cv.height);
      ctx.drawImage(img, 0, 0);
    };
    img.onerror = function () { cv.hidden = true; };
    img.src = uri;
  }

  function readAvatarFile(file) {
    if (!file) return;
    if (!/^image\/(jpeg|png)$/.test(file.type)) { notifyTransient(t("ct.avatar.bad")); return; }
    var fr = new FileReader();
    fr.onload = function () {
      var img = new Image();
      img.onload = function () {
        // Center-crop to square, then scale down to AVATAR_SIZE.
        var side = Math.min(img.width, img.height);
        var sx = (img.width - side) / 2, sy = (img.height - side) / 2;
        var cv = document.createElement("canvas");
        cv.width = AVATAR_SIZE; cv.height = AVATAR_SIZE;
        var ctx = cv.getContext("2d");
        ctx.imageSmoothingEnabled = true;
        ctx.drawImage(img, sx, sy, side, side, 0, 0, AVATAR_SIZE, AVATAR_SIZE);
        try {
          var uri = cv.toDataURL("image/jpeg", 0.85);
          if (uri.length > 50000) { notifyTransient(t("ct.avatar.big")); return; }
          editingPhoto = uri;
          paintAvatarPreview(editingPhoto);
        } catch (e) {
          notifyTransient(t("ct.avatar.bad"));
        }
      };
      img.onerror = function () { notifyTransient(t("ct.avatar.bad")); };
      img.src = fr.result;
    };
    fr.onerror = function () { notifyTransient(t("ct.avatar.bad")); };
    fr.readAsDataURL(file);
  }

  function openDlg(existing) {
    editingId = existing ? existing.id : null;
    $("ct-dlg-title").textContent = t(existing ? "ct.dlg.edit" : "ct.dlg.new");
    $("ct-given").value    = existing ? existing.given : "";
    $("ct-middle").value   = existing ? existing.middle : "";
    $("ct-family").value   = existing ? existing.family : "";
    $("ct-nickname").value = existing ? existing.nickname : "";
    $("ct-org").value      = existing ? existing.org : "";
    $("ct-jobtitle").value = existing ? existing.jobTitle : "";
    $("ct-note").value     = existing ? existing.note : "";
    $("ct-starred").checked = existing ? existing.starred : false;
    editingPhoto = (existing && existing.photo) ? existing.photo : null;
    paintAvatarPreview(editingPhoto);

    fillHolder($("ct-phones"),    existing ? existing.phones    : [], function (h, r) { buildValRow(h, r && r.v, r && r.type, PHONE_TYPES, "+30 69…", 40, "ph"); });
    fillHolder($("ct-emails"),    existing ? existing.emails    : [], function (h, r) { buildValRow(h, r && r.v, r && r.type, EMAIL_TYPES, "name@example.com", 120, "em"); });
    fillHolder($("ct-websites"),  existing ? existing.websites  : [], function (h, r) { buildValRow(h, r && r.v, r && r.type, WEB_TYPES, "https://…", 300, "wb"); });
    fillHolder($("ct-im"),        existing ? existing.im        : [], function (h, r) { buildValRow(h, r && r.v, r && r.type, IM_TYPES, "handle…", 120, "im"); });
    fillHolder($("ct-addresses"), existing ? existing.addresses : [], buildAddrRow);
    fillHolder($("ct-events"),    existing ? existing.events    : [], buildEvtRow);
    fillHolder($("ct-relations"), existing ? existing.relations : [], buildRelRow);
    renderDlgIncoming(existing);

    dlgLabelIds = existing ? existing.labelIds.slice() : [];
    renderDlgLabels();
    var kp = existing && existing.keep;
    $("ct-keep-n").value = kp ? String(kp.n) : "1";
    $("ct-keep-u").value = kp ? kp.u : "";
    $("ct-keep-n").disabled = !kp;

    $("ct-del-row").className = "dlg-row" + (existing ? " show" : "");
    // CT-2: what the form shows now, read back through the same
    // readers Save uses — Save writes only the fields that differ.
    dlgSnap = existing ? readDlgDraft() : null;
    $("ct-dlg").showModal();
    setTimeout(function () { $("ct-given").focus(); }, 50);
  }

  // Every editable field of the dialog, as Save reads it.
  var DLG_FIELDS = ["given", "middle", "family", "nickname", "org", "jobTitle",
    "phones", "emails", "addresses", "websites", "im", "events", "relations",
    "labelIds", "starred", "note", "photo", "keep"];
  if ($("ct-keep-u")) {
    $("ct-keep-u").addEventListener("change", function () { $("ct-keep-n").disabled = !this.value; });
  }
  function readKeep() {
    var u = $("ct-keep-u").value;
    if (u !== "w" && u !== "m") return null;
    var n = Math.round(+$("ct-keep-n").value);
    if (!isFinite(n) || n < 1) n = 1;
    if (n > 99) n = 99;
    return { n: n, u: u };
  }
  var dlgSnap = null;
  function readDlgDraft() {
    return {
      given: $("ct-given").value.trim(),
      middle: $("ct-middle").value.trim(),
      family: $("ct-family").value.trim(),
      nickname: $("ct-nickname").value.trim(),
      org: $("ct-org").value.trim(),
      jobTitle: $("ct-jobtitle").value.trim(),
      phones: readValRows($("ct-phones")),
      emails: readValRows($("ct-emails")),
      addresses: readAddrRows($("ct-addresses")),
      websites: readValRows($("ct-websites")),
      im: readValRows($("ct-im")),
      events: readEvtRows($("ct-events")),
      relations: readRelRows($("ct-relations")),
      labelIds: dlgLabelIds.slice().sort(),
      starred: $("ct-starred").checked,
      note: $("ct-note").value.trim(),
      photo: editingPhoto,
      keep: readKeep()
    };
  }

  // Starter-row buttons (＋ Phone / ＋ Email / …)
  if ($("ct-phone-add")) {
    $("ct-phone-add").addEventListener("click", function () {
      buildValRow($("ct-phones"), "", "mobile", PHONE_TYPES, "+30 69…", 40, "ph").focus();
    });
  }
  if ($("ct-email-add")) {
    $("ct-email-add").addEventListener("click", function () {
      buildValRow($("ct-emails"), "", "home", EMAIL_TYPES, "name@example.com", 120, "em").focus();
    });
  }
  if ($("ct-web-add")) {
    $("ct-web-add").addEventListener("click", function () {
      buildValRow($("ct-websites"), "", "home", WEB_TYPES, "https://…", 300, "wb").focus();
    });
  }
  if ($("ct-im-add")) {
    $("ct-im-add").addEventListener("click", function () {
      buildValRow($("ct-im"), "", "home", IM_TYPES, "handle…", 120, "im").focus();
    });
  }
  if ($("ct-addr-add")) {
    $("ct-addr-add").addEventListener("click", function () { buildAddrRow($("ct-addresses")); });
  }
  if ($("ct-ev-add")) {
    $("ct-ev-add").addEventListener("click", function () { buildEvtRow($("ct-events")); });
  }
  if ($("ct-rel-add")) {
    $("ct-rel-add").addEventListener("click", function () { buildRelRow($("ct-relations")); });
  }

  $("ct-add").addEventListener("click", function () { openDlg(null); });

  // Avatar wiring: upload button opens the picker, the hidden file
  // input feeds readAvatarFile, remove clears both state + preview.
  if ($("ct-avatar-upload")) {
    $("ct-avatar-upload").addEventListener("click", function () {
      var dlg = dialogHost();
      if (dlg && typeof dlg.openFile === "function") {
        dlg.openFile("image/jpeg,image/png,.jpg,.jpeg,.png")
          .then(function (f) { if (f) readAvatarFile(f); });
        return;                     // cancel (null) = silent exit
      }
      $("ct-avatar-input").value = "";            // allow re-pick of same file
      $("ct-avatar-input").click();
    });
  }
  if ($("ct-avatar-input")) {
    $("ct-avatar-input").addEventListener("change", function () {
      var f = this.files && this.files[0];
      if (f) readAvatarFile(f);
    });
  }
  if ($("ct-avatar-remove")) {
    $("ct-avatar-remove").addEventListener("click", function () {
      editingPhoto = null;
      paintAvatarPreview(null);
    });
  }

  /* Save — collects every holder, sanitizes through the SAME
     sanitizeContact() the loader uses (one truth), then pushes or
     edits. Edited-while-deleted-elsewhere → resurrect (fresh mtime
     beats the tombstone, calendar contract). */
  $("ct-save").addEventListener("click", function () {
    var form = readDlgDraft();
    var given = form.given, middle = form.middle, family = form.family;
    var nickname = form.nickname, org = form.org;
    if (!given && !middle && !family && !nickname && !org) {
      var ti = $("ct-given");
      ti.classList.add("invalid");
      ti.focus();
      notifyTransient(t("ct.err.name"));
      setTimeout(function () { ti.classList.remove("invalid"); }, 1600);
      return;
    }

    // CT-2: an edit applies only the fields the user changed since
    // the dialog opened, on top of the CURRENT contact (a pull may
    // have changed it meanwhile). Untouched fields keep the other
    // device's values (A67 Q1); a Save with no change stamps nothing
    // (R27). A new contact, or one deleted elsewhere while the dialog
    // was open, is saved whole (an edit outranks a delete).
    var current = editingId ? contactById(editingId) : null;
    var draft;
    if (current && dlgSnap) {
      var changedF = DLG_FIELDS.filter(function (f) {
        return JSON.stringify(form[f]) !== JSON.stringify(dlgSnap[f]);
      });
      if (!changedF.length) { $("ct-dlg").close(); return; }
      draft = JSON.parse(JSON.stringify(current));
      changedF.forEach(function (f) { draft[f] = form[f]; });
    } else {
      draft = form;
      draft.id = editingId || uid();
    }
    draft.mtime = Date.now();
    var clean = sanitizeContact(draft);
    // sanitizeContact keeps the drafted id/mtime (they were valid) —
    // belt and braces: restore them explicitly if the trim shape
    // lost them (it cannot, but no guessing about future edits).
    clean.id = draft.id;
    clean.mtime = draft.mtime;

    var found = false;
    for (var i = 0; i < state.contacts.length; i++) {
      if (state.contacts[i].id === editingId) {
        state.contacts[i] = clean;
        found = true;
        break;
      }
    }
    if (!found) state.contacts.push(clean);

    // Any edit outranks a stale tombstone (no phantom deletes).
    state.deleted = state.deleted.filter(function (d) {
      return d.id !== clean.id;
    });

    saveState();
    $("ct-dlg").close();
    renderChips();
    renderList();
  });

  $("ct-cancel").addEventListener("click", function () { $("ct-dlg").close(); });
  // Outside-click close (a click whose target IS the dialog hit the
  // backdrop) — same pattern as calendar ev-dlg.
  $("ct-dlg").addEventListener("click", function (ev) {
    if (ev.target === this) this.close();
  });

  // Wave 2.1 — shell deep-link target. Calendar contact-feed rows
  // land here via window.parent.__orosOpenContact (live iframe push
  // when Contacts is already open). Opens the contact's edit dialog
  // — identical to tapping its row. Stale/deleted id → silent no-op.
  // Mail "Add sender to Contacts": __orosOpenAt("contacts", { add: {
  // email, name? } }). Someone already has that address → their card;
  // otherwise a NEW contact dialog prefilled (saved only on Save).
  // Single app (solo.js): { newContact: true } → the New contact
  // dialog (icon shortcut); { cardText: { text } } → a shared text read
  // like a business card (cardtext.js), prefilling a NEW contact.
  window.__orosOpenAt = function (target) {
    if (target && typeof target === "object" && (target.newContact === true || target.cardText)) {
      if ($("ct-dlg").open) return;
      try { closeViewCard(); } catch (e) {}
      var ctx = target.cardText, CCx = window.OrosContactsCard;
      if (target.newContact === true) { openDlg(null); return; }
      if (!ctx || typeof ctx.text !== "string" || !ctx.text.trim() || !CCx) return;
      openDlgPrefilled(CCx.parse(ctx.text.slice(0, 4000)));
      notifyTransient(t("sc.check"));
      return;
    }
    var fi = target && typeof target === "object" ? target.importVcf : null;
    if (fi && typeof fi === "object" && typeof fi.text === "string") {
      askImportVcf(fi.text, typeof fi.name === "string" ? fi.name : "");
      return;
    }
    // Assistant entry card: { asNew: { given?, family?, name?, org?,
    // phones?, emails?, address?, birthday?, note?, from? } } → the
    // NEW contact dialog prefilled (OrosContactsCard.fromAsNew clamps
    // it; saved only on Save). An address someone already has → their
    // card, like "add".
    var nw = target && typeof target === "object" ? target.asNew : null;
    if (nw && typeof nw === "object") {
      var CC = window.OrosContactsCard;
      var pc = CC && typeof CC.fromAsNew === "function" ? CC.fromAsNew(nw) : null;
      if (!pc) return;
      for (var k = 0; k < pc.emails.length; k++) {
        var lowK = pc.emails[k].v.toLowerCase();
        for (var j = 0; j < state.contacts.length; j++) {
          var known = state.contacts[j].emails.some(function (x) { return String(x.v).toLowerCase() === lowK; });
          if (known) { window.__orosContactsOpen(state.contacts[j].id); return; }
        }
      }
      openDlgPrefilled(pc);
      return;
    }
    var a = target && typeof target === "object" ? target.add : null;
    if (!a || typeof a !== "object" || typeof a.email !== "string") return;
    var email = a.email.trim().slice(0, 120);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return;
    var low = email.toLowerCase();
    for (var i = 0; i < state.contacts.length; i++) {
      var hit = state.contacts[i].emails.some(function (x) { return String(x.v).toLowerCase() === low; });
      if (hit) { window.__orosContactsOpen(state.contacts[i].id); return; }
    }
    try { closeViewCard(); } catch (e) {}
    try { if ($("ct-dlg").open) $("ct-dlg").close(); } catch (e) {}
    openDlg(null);
    var words = (typeof a.name === "string" ? a.name : "").replace(/\s+/g, " ").trim().slice(0, 120).split(" ").filter(Boolean);
    if (words.length > 1) { $("ct-family").value = words.pop(); }
    $("ct-given").value = words.join(" ");
    fillHolder($("ct-emails"), [{ v: email, type: "home" }], function (h, r) { buildValRow(h, r && r.v, r && r.type, EMAIL_TYPES, "name@example.com", 120, "em"); });
  };

  window.__orosContactsOpen = function (contactId) {
    if (typeof contactId !== "string" || !contactId) return;
    // The reach-out reminder with several people (shell deep link
    // "contacts:@reachout"): the Reach out list.
    if (contactId === "@reachout") {
      try { if ($("ct-dlg").open) $("ct-dlg").close(); } catch (e) {}
      closeViewCard();
      setQuickFilter("reach");
      return;
    }
    for (var i = 0; i < state.contacts.length; i++) {
      if (state.contacts[i].id === contactId) {
        // Guard: programmatic deep-link while ct-dlg is already open
        // would throw InvalidStateError from showModal(). Close the
        // stale edit first — the deep link is the newer intent.
        try { if ($("ct-dlg").open) $("ct-dlg").close(); } catch (e) {}
        openViewCard(state.contacts[i]);
        return;
      }
    }
  };

  /* Delete: themed confirm + UNDO (resurrection via fresh mtime). */
  var lastDeleted = null;

  $("ct-delete").addEventListener("click", function () {
    if (!editingId) return;
    var ev = null;
    for (var i = 0; i < state.contacts.length; i++) {
      if (state.contacts[i].id === editingId) { ev = state.contacts[i]; break; }
    }
    $("del-dlg-text").textContent = ev ? displayName(ev) : t("ct.unnamed");
    $("del-dlg").showModal();
    $("del-dlg-yes").focus();
  });

  $("del-dlg-yes").addEventListener("click", function () {
    if (!editingId) { $("del-dlg").close(); return; }
    var ev = null;
    for (var i = 0; i < state.contacts.length; i++) {
      if (state.contacts[i].id === editingId) { ev = state.contacts[i]; break; }
    }
    state.contacts = state.contacts.filter(function (c) { return c.id !== editingId; });
    state.deleted.push({ id: editingId, mtime: Date.now() });
    saveState();
    lastDeleted = ev ? JSON.parse(JSON.stringify(ev)) : null;
    editingId = null;   // clear dangling state
    $("del-dlg").close();
    $("ct-dlg").close();
    renderChips();
    renderList();
    if (lastDeleted) toast(t("ct.del.done"), t("undo"), undoDelete);
  });

  $("del-dlg-no").addEventListener("click", function () {
    $("del-dlg").close();
  });
  $("del-dlg").addEventListener("click", function (ev) {
    if (ev.target === this) this.close();
  });

  function undoDelete() {
    if (!lastDeleted) return;
    // Already back (an edit on another device resurrected it and a
    // pull brought it here): nothing to restore, keep that version.
    if (contactById(lastDeleted.id)) { lastDeleted = null; return; }
    lastDeleted.mtime = Date.now();   // fresh: beats the tombstone
    state.contacts.push(lastDeleted);
    state.deleted = state.deleted.filter(function (d) {
      return d.id !== lastDeleted.id;
    });
    lastDeleted = null;
    saveState();
    renderChips();
    renderList();
  }

// ===== DUPLICATE MERGE LOGIC =====

  var pendingMergeGroup = null;    // group IDs awaiting merge
  var pendingMergePrimaryIndex = 0; // which member is primary (0-based)
  var pendingMergeSnapshot = null;  // pre-merge state for undo

  // Build a proposed merged contact from a group.
  function buildMergePreview(groupIds, primaryIdx) {
    var members = groupIds.map(function (id) {
      return state.contacts.find(function (c) { return c.id === id; });
    }).filter(Boolean);
    if (!members.length) return null;

    var primary = members[primaryIdx];
    var preview = JSON.parse(JSON.stringify(primary)); // deep copy
    preview.id = primary.id;
    preview.mtime = Date.now();

    // Scalar fields: keep primary unless empty, then take first non-empty.
    ["given", "middle", "family", "nickname", "org", "jobTitle", "note", "photo"].forEach(function (f) {
      if (!preview[f]) {
        for (var i = 0; i < members.length; i++) {
          if (members[i][f]) { preview[f] = members[i][f]; break; }
        }
      }
    });

    // Arrays: union with dedup.
    function arrayUnion(arrA, arrB, keyFn) {
      var map = {};
      arrA.forEach(function (x) { var k = keyFn(x); if (k && !map[k]) map[k] = x; });
      arrB.forEach(function (x) { var k = keyFn(x); if (k && !map[k]) map[k] = x; });
      return Object.keys(map).map(function (k) { return map[k]; });
    }

    preview.phones = arrayUnion(preview.phones,
      [].concat.apply([], members.slice(1).map(function (m) { return m.phones; })),
      function (p) { return phoneDigits(p.v); });

    preview.emails = arrayUnion(preview.emails,
      [].concat.apply([], members.slice(1).map(function (m) { return m.emails; })),
      function (e) { return normalizeEmail(e.v); });

    preview.addresses = arrayUnion(preview.addresses,
      [].concat.apply([], members.slice(1).map(function (m) { return m.addresses; })),
      function (a) { return a.street + "|" + a.city + "|" + a.zip; });

    preview.websites = arrayUnion(preview.websites,
      [].concat.apply([], members.slice(1).map(function (m) { return m.websites; })),
      function (w) { return w.v; });

    preview.im = arrayUnion(preview.im,
      [].concat.apply([], members.slice(1).map(function (m) { return m.im; })),
      function (i) { return i.v; });

    preview.relations = arrayUnion(preview.relations || [],
      [].concat.apply([], members.slice(1).map(function (m) { return m.relations || []; })),
      function (r) { return r.with + "|" + r.type; });

    preview.events = arrayUnion(preview.events,
      [].concat.apply([], members.slice(1).map(function (m) { return m.events; })),
      function (e) { return e.type + "|" + e.day; });

    preview.labelIds = arrayUnion(preview.labelIds,
      [].concat.apply([], members.slice(1).map(function (m) { return m.labelIds; })),
      function (l) { return l; });
    preview.labelIds.sort();

    preview.starred = primary.starred || members.some(function (m) { return m.starred; });

    // Keep in touch: every interaction of the group, the latest
    // "contacted", the primary's cadence (else the first one set).
    if (MG) {
      var lg = { log: preview.log || [], logDel: preview.logDel || {} };
      members.forEach(function (m) { if (m !== primary) lg = MG.mergeLog(lg.log, lg.logDel, m.log, m.logDel); });
      if (lg.log.length) preview.log = lg.log; else delete preview.log;
      if (Object.keys(lg.logDel).length) preview.logDel = lg.logDel; else delete preview.logDel;
      members.forEach(function (m) {
        if (m.seen && (!preview.seen || m.seen > preview.seen)) preview.seen = m.seen;
        if (!preview.keep && m.keep) preview.keep = JSON.parse(JSON.stringify(m.keep));
      });
    }

    return { preview: preview, members: members, primaryIdx: primaryIdx };
  }

  function openMergeDlg(groupIds) {
    pendingMergeGroup = groupIds;
    pendingMergePrimaryIndex = 0;
    pendingMergeSnapshot = null;

    renderMergePreview();
    $("merge-dlg").showModal();
  }

  function renderMergePreview() {
    if (!pendingMergeGroup) return;
    var prep = buildMergePreview(pendingMergeGroup, pendingMergePrimaryIndex);
    if (!prep) return;

    $("merge-title").textContent = t("dup.merge");
    var via = $("merge-via");
    via.textContent = "";
    via.appendChild(document.createTextNode(t("dup.primary") + ": "));
    var viaStrong = document.createElement("strong");
    viaStrong.textContent = displayName(prep.members[pendingMergePrimaryIndex]);
    via.appendChild(viaStrong);
    var prevBox = $("merge-preview");
    prevBox.textContent = "";

    // Show scalar fields.
    ["given", "middle", "family", "nickname", "org", "jobTitle"].forEach(function (f) {
      if (!prep.preview[f]) return;
      var div = document.createElement("div");
      div.className = "dup-preview-section";
      var lab = document.createElement("div");
      lab.className = "dup-preview-label";
      lab.textContent = t("ct.field." + (f === "jobTitle" ? "jobtitle" : f));
      var val = document.createElement("div");
      val.className = "dup-preview-value";
      val.textContent = prep.preview[f];
      div.appendChild(lab);
      div.appendChild(val);
      prevBox.appendChild(div);
    });

    // Show arrays (phones, emails, labels).
    if (prep.preview.phones.length) {
      var phDiv = document.createElement("div");
      phDiv.className = "dup-preview-section";
      phDiv.innerHTML = "<div class=\"dup-preview-label\">" + t("ct.field.phones") + "</div>";
      prep.preview.phones.forEach(function (p) {
        var span = document.createElement("span");
        span.textContent = p.v + " (" + t("ty." + p.type) + ") · ";
        phDiv.appendChild(span);
      });
      prevBox.appendChild(phDiv);
    }

    if (prep.preview.emails.length) {
      var emDiv = document.createElement("div");
      emDiv.className = "dup-preview-section";
      emDiv.innerHTML = "<div class=\"dup-preview-label\">" + t("ct.field.emails") + "</div>";
      prep.preview.emails.forEach(function (e) {
        var span = document.createElement("span");
        span.textContent = e.v + " · ";
        emDiv.appendChild(span);
      });
      prevBox.appendChild(emDiv);
    }

    if (prep.preview.labelIds.length) {
      var lbDiv = document.createElement("div");
      lbDiv.className = "dup-preview-section";
      lbDiv.innerHTML = "<div class=\"dup-preview-label\">" + t("ct.lbl.filter") + "</div>";
      prep.preview.labelIds.forEach(function (lid) {
        var l = labelById(lid);
        if (l) {
          var chip = document.createElement("span");
          chip.className = "chip";
          chip.style.setProperty("--chip", l.color);
          chip.textContent = l.name + " · ";
          lbDiv.appendChild(chip);
        }
      });
      prevBox.appendChild(lbDiv);
    }
  }

  // Commit merge: winners keep, losers become tombstones.
  function commitMerge() {
    if (!pendingMergeGroup) return;
    var prep = buildMergePreview(pendingMergeGroup, pendingMergePrimaryIndex);
    if (!prep) return;

    // CT-4: Undo snapshot = only the group's members, taken now.
    pendingMergeSnapshot = prep.members.map(function (m) {
      return JSON.parse(JSON.stringify(m));
    });

    // Store winner.
    var winnerId = prep.members[pendingMergePrimaryIndex].id;
    for (var i = 0; i < state.contacts.length; i++) {
      if (state.contacts[i].id === winnerId) {
        state.contacts[i] = prep.preview;
        break;
      }
    }

    // Losers become tombstones.
    pendingMergeGroup.forEach(function (id) {
      if (id !== winnerId) {
        state.deleted.push({ id: id, mtime: Date.now() });
        state.contacts = state.contacts.filter(function (c) { return c.id !== id; });
      }
    });

    saveState();
    $("merge-dlg").close();
    $("dedup-sec").hidden = true;
    renderChips();
    renderList();
    toast(t("dup.merged"), t("dup.undo"), undoMerge);
  }

  // CT-4: Undo puts back ONLY the merged group, with fresh stamps so
  // the restored copies beat their tombstones on every device. The
  // old Undo replaced the whole contact list and tombstone list with
  // a copy taken when the merge dialog opened (older stamps): work
  // pulled from another device in between was dropped locally, and
  // the "restored" duplicates were deleted again by the next pull.
  function undoMerge() {
    if (!pendingMergeSnapshot) return;
    var now = Date.now();
    pendingMergeSnapshot.forEach(function (m) {
      m.mtime = now;
      var found = false;
      for (var i = 0; i < state.contacts.length; i++) {
        if (state.contacts[i].id === m.id) { state.contacts[i] = m; found = true; break; }
      }
      if (!found) state.contacts.push(m);
      state.deleted = state.deleted.filter(function (d) { return d.id !== m.id; });
    });
    pendingMergeSnapshot = null;
    saveState();
    renderChips();
    renderList();
  }

  // Wiring: scan button + merge dialog controls.
  if ($("ct-dedup")) {
    $("ct-dedup").addEventListener("click", function () {
      var scan = scanDuplicates();
      var total = scan.definitive.length + scan.possible.length;
      $("dedup-title").textContent = t("dup.title") + " · " + total;
      renderDupDialog(scan);
      $("dedup-sec").hidden = false;
    });
  }

  if ($("dedup-done")) {
    $("dedup-done").addEventListener("click", function () {
      $("dedup-sec").hidden = true;
    });
  }

  if ($("merge-flip")) {
    $("merge-flip").addEventListener("click", function () {
      if (!pendingMergeGroup || pendingMergeGroup.length < 2) return;
      pendingMergePrimaryIndex = (pendingMergePrimaryIndex + 1) % pendingMergeGroup.length;
      renderMergePreview();
    });
  }

  if ($("merge-do")) {
    $("merge-do").addEventListener("click", function () {
      commitMerge();
    });
  }

  if ($("merge-cancel")) {
    $("merge-cancel").addEventListener("click", function () {
      $("merge-dlg").close();
    });
  }

  if ($("merge-dlg")) {
    $("merge-dlg").addEventListener("click", function (ev) {
      if (ev.target === this) this.close();
    });
  }

// ===== LABEL MANAGEMENT =====

  /* ---------- 6. Label management dialog ----------
     Mirror of the calendar lbl-dlg: rename (inline), recolor
     (palette popover), delete (blocked while in use), create
     (name + color pick). mtime bumped on every user touch so the
     merge winner is always the newest intent. */

  function labelInUse(id) {
    return state.contacts.some(function (c) {
      return c.labelIds.indexOf(id) !== -1;
    });
  }

  // One delegated closer for the recolor popover — registered
  // ONCE per app load. The old per-row version leaked a document
  // listener on EVERY renderLblList call (closures piling up).
  var lblPop = null;
  var lblPopOwner = null;
  function closeLblPop() {
    if (lblPop && lblPop.parentNode) lblPop.parentNode.removeChild(lblPop);
    lblPop = null;
    lblPopOwner = null;
  }
  document.addEventListener("click", function (ev) {
    if (!lblPop) return;
    if (lblPop.contains(ev.target)) return;
    if (ev.target && ev.target.closest &&
        ev.target.closest(".lbl-color-btn")) return;
    closeLblPop();
  });

  function openLblDlg() {
    renderLblList();
    $("lbl-new-name").value = "";
    $("lbl-add-colors").textContent = "";
    LABEL_PALETTE.forEach(function (col) {
      var s = document.createElement("button");
      s.type = "button";
      s.className = "lbl-swatch";
      s.style.background = col;
      s.setAttribute("aria-label", t("lbl.color"));
      s.addEventListener("click", function () {
        // mark selection, leave dialog open for typing the name
        var all = $("lbl-add-colors").querySelectorAll(".lbl-swatch");
        for (var i = 0; i < all.length; i++) all[i].classList.remove("active");
        s.classList.add("active");
      });
      $("lbl-add-colors").appendChild(s);
    });
    $("lbl-dlg").showModal();
  }

  function renderLblList() {
    var box = $("lbl-list");
    box.textContent = "";
    state.labels.forEach(function (l) {
      var row = document.createElement("div");
      row.className = "lbl-row";

      var cb = document.createElement("button");
      cb.type = "button";
      cb.className = "lbl-color-btn";
      cb.style.background = l.color;
      cb.setAttribute("aria-label", t("lbl.color"));
      row.appendChild(cb);

      var ni = document.createElement("input");
      ni.type = "text";
      ni.className = "lbl-name-in";
      ni.maxLength = 40;
      ni.value = l.name;
      ni.addEventListener("change", function () {
        // CT-2: the dialog may have outlived a pull — edit the current
        // label object, found by id (the row's `l` can be a stale copy).
        var cur = labelById(l.id);
        var nv = ni.value.trim();
        if (!cur) return;
        if (!nv || nv === cur.name) { ni.value = cur.name; return; }
        cur.name = nv.slice(0, 40);
        cur.mtime = Date.now();               // user intent outranks seeds
        saveState();
        renderChips();
        renderList();
      });
      row.appendChild(ni);

      var del = document.createElement("button");
      del.type = "button";
      del.className = "mini lbl-del";
      del.textContent = t("lbl.delete");
      del.addEventListener("click", function () {
        if (labelInUse(l.id)) { notifyTransient(t("lbl.inuse")); return; }
        state.labels = state.labels.filter(function (x) { return x.id !== l.id; });
        state.deleted.push({ id: l.id, mtime: Date.now() });   // shared tombstone
        delete labelVis[l.id];
        saveState();
        renderLblList();
        renderChips();
        renderList();
      });
      row.appendChild(del);

      // Recolor: inline palette popover beside the dot button.
      // Uses the SHARED single closer declared above openLblDlg —
      // no per-render document listeners. lblPopOwner keeps the
      // toggle behavior for the same button while clicking another
      // row's dot switches the popover instead of just closing it.
      cb.addEventListener("click", function (ev) {
        ev.stopPropagation();
        var reopen = (lblPopOwner !== cb);
        closeLblPop();
        if (!reopen) return;
        var pop = document.createElement("div");
        pop.className = "lbl-palette";
        LABEL_PALETTE.forEach(function (col) {
          var s = document.createElement("button");
          s.type = "button";
          s.className = "lbl-swatch" + (col === l.color ? " active" : "");
          s.style.background = col;
          s.addEventListener("click", function () {
            var cur = labelById(l.id);        // CT-2: current object, by id
            if (!cur) { closeLblPop(); return; }
            cur.color = col;
            cur.mtime = Date.now();
            saveState();
            renderLblList();
            renderChips();
            renderList();
            closeLblPop();
          });
          pop.appendChild(s);
        });
        document.body.appendChild(pop);
        // position near the button, clamped to viewport
        var r = cb.getBoundingClientRect();
        pop.style.left = Math.max(8, Math.min(r.left, window.innerWidth - 190)) + "px";
        pop.style.top = (r.bottom + 6) + "px";
        lblPop = pop;
        lblPopOwner = cb;
      });

      box.appendChild(row);
    });
    if (!state.labels.length) {
      var e = document.createElement("p");
      e.className = "empty";
      e.textContent = t("lbl.empty");
      box.appendChild(e);
    }
  }

  // Create: name typed, color = active swatch or first palette slot.
  if ($("lbl-add")) {
    $("lbl-add").addEventListener("click", function () {
      var name = $("lbl-new-name").value.trim();
      if (!name) { $("lbl-new-name").focus(); return; }
      var col = LABEL_PALETTE[0];
      var act = $("lbl-add-colors").querySelector(".lbl-swatch.active");
      if (act) col = act.style.background && LABEL_PALETTE[
        LABEL_PALETTE.indexOf(rgbToHex(act.style.background))] || col;
      var nu = {
        id: "lbl-" + uid(),
        name: name.slice(0, 40),
        color: col,
        mtime: Date.now()
      };
      state.labels.push(nu);
      saveState();
      $("lbl-new-name").value = "";
      renderLblList();
      renderChips();
      renderList();
    });
  }
  // Convert "rgb(r, g, b)" (browsers normalize inline styles) back to
  // a palette hex when possible; returns "" for no match.
  function rgbToHex(rgb) {
    var m = String(rgb || "").match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
    if (!m) return "";
    var h = "#" + [m[1], m[2], m[3]].map(function (d) {
      return (+d).toString(16).length < 2 ? "0" + (+d).toString(16) : (+d).toString(16);
    }).join("");
    return LABEL_PALETTE.indexOf(h) !== -1 ? h : "";
  }
  // NOTE: swatch buttons store colors via style.background, which
  // browsers may normalize — the palette comparison above tolerates
  // both hex and rgb() forms; a mismatch falls back to slot 0.

  if ($("lbl-done")) {
    $("lbl-done").addEventListener("click", function () { $("lbl-dlg").close(); });
  }
  if ($("lbl-dlg")) {
    $("lbl-dlg").addEventListener("click", function (ev) {
      if (ev.target === this) this.close();
    });
  }

// ===== VCARD IMPORT / EXPORT =====

  /* ---------- 7. vCard (.vcf) — RFC 6350 subset ----------
     Round-trip target: Android Contacts imports our exports and
     exports (Google Contacts takeout included) read back in. */

  // Unfold: CRLF/CR/LF + a leading space/tab continues the line.
  function vcfUnfold(text) {
    var lines = String(text || "").replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
    var out = [];
    for (var i = 0; i < lines.length; i++) {
      if ((lines[i].charAt(0) === " " || lines[i].charAt(0) === "\t") && out.length) {
        out[out.length - 1] += lines[i].slice(1);
      } else {
        out.push(lines[i]);
      }
    }
    return out;
  }

  // Parse property params: "TEL;TYPE=CELL,VOICE:+3069…" → {name, params, value}
  function vcfProp(line) {
    var ix = line.indexOf(":");
    if (ix === -1) return null;
    var head = line.slice(0, ix);
    var value = line.slice(ix + 1);
    var parts = head.split(";");
    return { name: parts[0].toUpperCase(), params: parts.slice(1), value: value };
  }
  function vcfType(params) {
    // Map common vCard TYPE params onto our whitelists.
    var t = "";
    params.forEach(function (p) {
      var kv = p.toUpperCase().split("=");
      if (kv[0] === "TYPE") t = kv[1] || "";
    });
    return t;
  }
  // One pass, so an escaped backslash before "n" ("\\n") stays a
  // backslash and an "n" instead of becoming a line break.
  function vcfUnesc(s) {
    return String(s || "").replace(/\\([nN,;\\])/g, function (m, ch) {
      return ch === "n" || ch === "N" ? "\n" : ch;
    });
  }
  function vcfEsc(s) {
    return String(s || "")
      .replace(/\\/g, "\\\\")
      .replace(/\n/g, "\\n")
      .replace(/,/g, "\\,").replace(/;/g, "\\;");
  }
  // 75-byte folding on export (RFC 6350 §3.2)
  function vcfFold(line) {
    if (line.length <= 75) return [line];
    var out = [];
    var rest = line;
    out.push(rest.slice(0, 75));
    rest = rest.slice(75);
    while (rest.length) {
      out.push(" " + rest.slice(0, 74));
      rest = rest.slice(74);
    }
    return out;
  }

  function typeFromVcf(rawT, whitelist, fallback) {
    var r = String(rawT || "").toLowerCase();
    if (r.indexOf("cell") !== -1 || r.indexOf("mobile") !== -1) {
      return whitelist.indexOf("mobile") !== -1 ? "mobile" : fallback;
    }
    if (whitelist.indexOf(r) !== -1) return r;
    if (r.indexOf("work") !== -1 && whitelist.indexOf("work") !== -1) return "work";
    if (r.indexOf("home") !== -1 && whitelist.indexOf("home") !== -1) return "home";
    return fallback;
  }

  // Parse one vCard block (array of unfolded lines, BEGIN..END).
  function parseVcardBlock(lines) {
    var c = {
      given: "", middle: "", family: "", nickname: "",
      org: "", jobTitle: "",
      phones: [], emails: [], addresses: [], websites: [], im: [],
      events: [], cats: [], note: "", photo: null, starred: false
    };
    lines.forEach(function (line) {
      if (!line) return;
      var p = vcfProp(line);
      if (!p) return;
      var ty = vcfType(p.params);
      switch (p.name) {
        case "N":
          // N:family;given;middle;prefix;suffix
          var nn = p.value.split(";");
          c.family  = vcfUnesc(nn[0] || "").trim().slice(0, 60);
          c.given   = vcfUnesc(nn[1] || "").trim().slice(0, 60);
          c.middle  = vcfUnesc(nn[2] || "").trim().slice(0, 60);
          break;
        case "FN":
          // Only used if N was absent (some exports ship FN only).
          if (!c.given && !c.family) {
            var fn = vcfUnesc(p.value).trim().split(/\s+/);
            c.given = (fn[0] || "").slice(0, 60);
            c.family = fn.slice(1).join(" ").slice(0, 60);
          }
          break;
        case "NICKNAME": c.nickname = vcfUnesc(p.value).trim().slice(0, 60); break;
        case "ORG":
          // ORG:company;unit → keep company
          c.org = vcfUnesc(p.value.split(";")[0] || "").trim().slice(0, 80);
          break;
        case "TITLE": c.jobTitle = vcfUnesc(p.value).trim().slice(0, 80); break;
        case "TEL":
          if (p.value.trim()) c.phones.push({ v: p.value.trim().slice(0, 40), type: typeFromVcf(ty, PHONE_TYPES, "other") });
          break;
        case "EMAIL":
          if (p.value.trim()) c.emails.push({ v: p.value.trim().slice(0, 120), type: typeFromVcf(ty, EMAIL_TYPES, "other") });
          break;
        case "ADR":
          // ADR;pobox;ext;street;city;region;zip;country
          var aa = p.value.split(";");
          var ad = {
            street: vcfUnesc(aa[2] || "").trim().slice(0, 120),
            city: vcfUnesc(aa[3] || "").trim().slice(0, 60),
            region: vcfUnesc(aa[4] || "").trim().slice(0, 60),
            zip: vcfUnesc(aa[5] || "").trim().slice(0, 20),
            country: vcfUnesc(aa[6] || "").trim().slice(0, 60),
            type: typeFromVcf(ty, ADDR_TYPES, "other")
          };
          if (ad.street || ad.city || ad.region || ad.zip || ad.country) c.addresses.push(ad);
          break;
        case "URL":
          if (p.value.trim()) c.websites.push({ v: p.value.trim().slice(0, 300), type: typeFromVcf(ty, WEB_TYPES, "other") });
          break;
        case "IMPP":
          if (p.value.trim()) c.im.push({ v: p.value.trim().slice(0, 120), type: typeFromVcf(ty, IM_TYPES, "other") });
          break;
        case "BDAY":
        case "ANNIVERSARY":
          // "YYYY-MM-DD" | "--MM-DD" | "YYYYMMDD" (v2.1 legacy)
          var bv = p.value.trim();
          var mm;
          if ((mm = bv.match(/^(\d{4})-(\d{2})-(\d{2})$/)) ||
              (mm = bv.match(/^(\d{4})(\d{2})(\d{2})$/))) {
            if (validDay(mm[2] + "-" + mm[3])) {
              c.events.push({ day: mm[2] + "-" + mm[3], year: +mm[1], type: p.name === "BDAY" ? "birthday" : "anniversary", label: "" });
            }
          } else if ((mm = bv.match(/^-{0,2}(\d{2})-(\d{2})$/))) {
            if (validDay(mm[1] + "-" + mm[2])) {
              c.events.push({ day: mm[1] + "-" + mm[2], year: null, type: p.name === "BDAY" ? "birthday" : "anniversary", label: "" });
            }
          }
          break;
        case "X-EVENT": {
          // Our own custom-event round-trip form:
          // X-EVENT;TYPE=CUSTOM;X-LABEL=<escaped label>:<date>.
          // The label is extracted BEFORE unescaping — vcfProp()
          // splits raw params on ";", which would cut an escaped
          // "\;" inside the label, so the params are re-joined and
          // regex-matched with escaped-atom tolerance, THEN unesc.
          var xv = p.value.trim();
          var xm;
          var xlab = "";
          var pm = p.params.join(";").match(/X-LABEL=((?:\\.|[^;])*)/i);
          if (pm) xlab = vcfUnesc(pm[1]).trim().slice(0, 40);
          if ((xm = xv.match(/^(\d{4})-(\d{2})-(\d{2})$/)) ||
              (xm = xv.match(/^(\d{4})(\d{2})(\d{2})$/))) {
            if (validDay(xm[2] + "-" + xm[3])) {
              c.events.push({ day: xm[2] + "-" + xm[3], year: +xm[1], type: "custom", label: xlab });
            }
          } else if ((xm = xv.match(/^-{0,2}(\d{2})-(\d{2})$/))) {
            if (validDay(xm[1] + "-" + xm[2])) {
              c.events.push({ day: xm[1] + "-" + xm[2], year: null, type: "custom", label: xlab });
            }
          }
          break;
        }
        case "NOTE": c.note = vcfUnesc(p.value).trim().slice(0, 500); break;
        case "PHOTO": {
          // Accepted forms: our own data URI ("data:image/…;base64,…")
          // or raw base64 with an explicit TYPE=JPEG|PNG param.
          // http(s) URLs are NOT fetched (static OS, no network
          // dependency in imports) — silently skipped.
          var pv = p.value.trim();
          if (/^data:image\/(jpeg|png);base64,/.test(pv)) {
            // CT-8: a cut data URI is a broken image; skip oversize photos
            if (pv.length <= 50000) c.photo = pv;
          } else if (/(?:JPEG|JPG|PNG)/i.test(ty) &&
                     pv.length > 64 && pv.length <= 50000 &&
                     /^[A-Za-z0-9+/=]+$/.test(pv)) {
            c.photo = "data:image/" + (/PNG/i.test(ty) ? "png" : "jpeg") + ";base64," + pv;
          }
          break;
        }
        case "X-OROS-STARRED":
          if (/^TRUE$/i.test(p.value.trim())) c.starred = true;
          break;
        case "CATEGORIES":
          vcfUnesc(p.value).split(",").forEach(function (cat) {
            var n = cat.trim();
            if (n) c.cats.push(n.slice(0, 40));
          });
          break;
      }
    });
    return c;
  }

  // ===== IMPORT REVIEW =====
  // Every import (vCard / CSV file, From phone, a .vcf handed over by
  // the shell, From an account) opens this review first. The plan
  // (importplan.js) sorts the incoming contacts into new / already
  // here / other details; the person picks per contact (add, skip,
  // merge keeping mine, merge using the imported values, add as a
  // separate contact). Nothing is deleted; Undo restores everything.
  var IP = window.OrosContactsImport;
  var review = null;            // { items, src }
  var lastImport = null;        // { before[], added[] } for Undo
  var REV_RENDER_MAX = 300;     // rows drawn per group (the rest keep their default)

  function resolveCats(cats) {
    var lids = [];
    (cats || []).forEach(function (catName) {
      var found = null;
      state.labels.forEach(function (l) { if (l.name.toLowerCase() === catName.toLowerCase()) found = l; });
      if (!found) {
        found = {
          id: "lbl-" + uid(),
          name: catName,
          color: LABEL_PALETTE[(state.labels.length + 1) % LABEL_PALETTE.length],
          mtime: Date.now()
        };
        state.labels.push(found);
      }
      if (lids.indexOf(found.id) === -1) lids.push(found.id);
    });
    return lids.sort();
  }

  function openReview(parsed, src) {
    var plan = IP.plan(state.contacts, parsed, state.labels);
    if (!plan.items.length) { notifyTransient(t("ct.import.bad")); return; }
    review = { items: plan.items, counts: plan.counts, src: String(src || "").slice(0, 160) };
    $("rev-src").textContent = review.src;
    $("rev-sum").textContent = t("rv.sum").replace("{new}", String(plan.counts["new"]))
      .replace("{diff}", String(plan.counts.diff)).replace("{same}", String(plan.counts.same)) +
      (plan.folded ? " · " + t("rv.folded").replace("{n}", String(plan.folded)) : "");
    $("rev-pref").value = "merge";
    $("rev-pref-row").hidden = !plan.items.some(function (it) { return it.kind === "diff" && it.conflicts.length; });
    renderReview();
    try { if ($("rev-dlg").open) $("rev-dlg").close(); } catch (e) {}
    $("rev-dlg").showModal();
  }

  var FIELD_KEY = {
    given: "ct.field.given", middle: "ct.field.middle", family: "ct.field.family",
    nickname: "ct.field.nickname", org: "ct.field.org", jobTitle: "ct.field.jobtitle",
    note: "ct.field.note", phones: "ct.field.phones", emails: "ct.field.emails",
    addresses: "ct.field.addresses", websites: "ct.field.websites", im: "ct.field.im",
    events: "ct.field.events", photo: "ct.avatar", starred: "ct.starred",
    labels: "ct.lbl.filter", birthday: "rv.birthday"
  };
  function incName(inc) {
    return displayName(inc) || t("ct.unnamed");
  }
  function revInfo(it) {
    var box = document.createElement("div");
    box.className = "rv-info";
    var parts = [];
    if (it.by) parts.push(t("rv.by." + it.by));
    var adds = Object.keys(it.add).map(function (f) {
      var n = it.add[f];
      return t(FIELD_KEY[f] || f) + (n > 1 ? " ×" + n : "");
    });
    if (adds.length) parts.push(t("rv.adds") + ": " + adds.join(", "));
    box.appendChild(document.createTextNode(parts.join(" · ")));
    it.conflicts.forEach(function (cf) {
      box.appendChild(document.createElement("br"));
      var b = document.createElement("b");
      b.textContent = t(FIELD_KEY[cf.f] || cf.f) + ": ";
      box.appendChild(b);
      box.appendChild(document.createTextNode(String(cf.mine).slice(0, 80) + " → " + String(cf.theirs).slice(0, 80)));
    });
    if (it.nameOnly) {
      box.appendChild(document.createElement("br"));
      var w = document.createElement("span");
      w.className = "rv-warn";
      w.textContent = t("rv.nameonly");
      box.appendChild(w);
    }
    return box;
  }
  function revSelect(it) {
    var sel = document.createElement("select");
    var acts = it.kind === "new" ? ["add", "skip"]
      : (it.conflicts.length ? ["merge", "theirs", "add", "skip"] : ["merge", "add", "skip"]);
    if (it.nameOnly && acts[0] !== "add") acts = ["add"].concat(acts.filter(function (a) { return a !== "add"; }));
    acts.forEach(function (a) {
      var o = document.createElement("option");
      o.value = a;
      o.textContent = t(a === "add" && it.kind !== "new" ? "rv.act.sep" : "rv.act." + a);
      sel.appendChild(o);
    });
    sel.value = it.act;
    sel.setAttribute("aria-label", incName(it.inc));
    sel.addEventListener("change", function () { it.act = sel.value; });
    return sel;
  }
  function renderReview() {
    var host = $("rev-list");
    host.textContent = "";
    function group(kind, key, collapsed) {
      var rows = review.items.filter(function (it) { return it.kind === kind; });
      if (!rows.length) return;
      var wrap = host, head;
      if (collapsed) {
        wrap = document.createElement("details");
        head = document.createElement("summary");
        wrap.appendChild(head);
        host.appendChild(wrap);
      } else {
        head = document.createElement("div");
        head.className = "rev-grp";
        host.appendChild(head);
      }
      head.textContent = t(key).replace("{n}", String(rows.length));
      rows.slice(0, REV_RENDER_MAX).forEach(function (it) {
        var row = document.createElement("div");
        row.className = "rev-row";
        var nm = document.createElement("span");
        nm.className = "rv-name";
        nm.textContent = incName(it.inc);
        row.appendChild(nm);
        if (kind !== "same") row.appendChild(revSelect(it));
        if (kind !== "new" || it.nAdd) row.appendChild(revInfo(it));
        wrap.appendChild(row);
      });
      if (rows.length > REV_RENDER_MAX) {
        var more = document.createElement("p");
        more.className = "del-text";
        more.textContent = t("rv.more").replace("{n}", String(rows.length - REV_RENDER_MAX));
        wrap.appendChild(more);
      }
    }
    group("diff", "rv.grp.diff", false);
    group("new", "rv.grp.new", false);
    group("same", "rv.grp.same", true);
  }

  function newFromInc(inc) {
    return sanitizeContact({
      id: uid(),
      given: inc.given, middle: inc.middle, family: inc.family,
      nickname: inc.nickname, org: inc.org, jobTitle: inc.jobTitle,
      phones: inc.phones, emails: inc.emails, addresses: inc.addresses,
      websites: inc.websites, im: inc.im, events: inc.events,
      labelIds: resolveCats(inc.cats),
      starred: inc.starred === true, note: inc.note,
      photo: inc.photo || null,
      relations: [],
      mtime: Date.now()
    });
  }

  function commitReview() {
    if (!review) return;
    var added = 0, merged = 0, skipped = 0, report = [];
    var undo = { before: [], added: [] };
    review.items.forEach(function (it) {
      var act = it.act;
      var local = it.match ? contactById(it.match) : null;
      if ((act === "merge" || act === "theirs") && !local) act = "add";   // gone meanwhile
      if (act === "add") {
        var clean = newFromInc(it.inc);
        if (clean && (clean.given || clean.family || clean.org || clean.nickname)) {
          state.contacts.push(clean);
          undo.added.push(clean.id);
          added++;
          report.push({ name: displayName(clean), kind: "new" });
          return;
        }
        act = "skip";
      }
      if (act === "merge" || act === "theirs") {
        var r = IP.apply(local, it.inc, act === "theirs" ? "theirs" : "mine", resolveCats(it.inc.cats));
        if (r.changed) {
          r.c.mtime = Date.now();
          var m = sanitizeContact(r.c);
          // two rows can merge into one contact: Undo keeps the first
          if (!undo.before.some(function (b) { return b.id === local.id; })) {
            undo.before.push(JSON.parse(JSON.stringify(local)));
          }
          state.contacts[state.contacts.indexOf(local)] = m;
          merged++;
          report.push({ name: displayName(m), kind: "upd" });
          return;
        }
      }
      skipped++;
      report.push({ name: incName(it.inc), kind: "skip" });
    });
    review = null;
    $("rev-dlg").close();
    if (!added && !merged) { notifyTransient(t("rv.nothing")); return; }
    saveState();
    renderChips();
    renderList();
    lastImport = undo;
    showImportReport({ created: added, updated: merged, report: report });
    toast(t("rv.done").replace("{a}", String(added)).replace("{m}", String(merged)).replace("{s}", String(skipped)),
      t("undo"), undoImport);
  }

  // Undo: merged contacts get their earlier version back (fresh stamp,
  // so it wins the sync merge), added ones are deleted (tombstoned).
  function undoImport() {
    var u = lastImport;
    lastImport = null;
    if (!u) return;
    var now = Date.now();
    u.before.forEach(function (old) {
      var cur = contactById(old.id);
      if (!cur) return;
      old.mtime = now;
      state.contacts[state.contacts.indexOf(cur)] = old;
    });
    var gone = {};
    u.added.forEach(function (id) { gone[id] = 1; state.deleted.push({ id: id, mtime: now }); });
    state.contacts = state.contacts.filter(function (c) { return !gone[c.id]; });
    saveState();
    renderChips();
    renderList();
    $("import-sec").hidden = true;
    notifyTransient(t("rv.undone"));
  }

  if ($("rev-dlg")) {
    $("rev-go").addEventListener("click", commitReview);
    $("rev-no").addEventListener("click", function () { $("rev-dlg").close(); });
    $("rev-dlg").addEventListener("close", function () { review = null; });
    $("rev-pref").addEventListener("change", function () {
      var v = this.value;
      if (!review) return;
      review.items.forEach(function (it) {
        if (it.kind === "diff" && it.conflicts.length && (it.act === "merge" || it.act === "theirs")) it.act = v;
      });
      renderReview();
    });
  }

  // ===== CSV IMPORT (Google Contacts) =====
  // Google's "Google CSV" export: RFC 4180 quoted rows, UTF-8 BOM,
  // scalar name/org/note/birthday columns, numbered value/type pairs
  // ("Phone 1 - Type" / "Phone 1 - Value", "E-mail 1 - Value"…),
  // "Group Membership" (:::-separated) → labels, "* starred" →
  // favorite, "Birthday" (ISO or "Mon D, YYYY") → event.
  // Photos are URL-only in CSV → skipped (no network imports —
  // same doctrine as vCard http PHOTOs). English headers are the
  // canonical format; Greek aliases cover the scalar fields.

  // RFC 4180-tolerant CSV rows (quoted fields, "" escapes, embedded
  // commas/newlines). Strips the UTF-8 BOM Google ships — otherwise
  // it glues onto the first header and breaks matching.
  function parseCsvRows(text) {
    var s = String(text || "");
    if (s.charCodeAt(0) === 0xFEFF) s = s.slice(1);
    var rows = [], row = [], field = "", inQ = false;
    for (var i = 0; i < s.length; i++) {
      var ch = s.charAt(i);
      if (inQ) {
        if (ch === '"') {
          if (s.charAt(i + 1) === '"') { field += '"'; i++; }
          else inQ = false;
        } else { field += ch; }
      } else if (ch === '"') {
        inQ = true;
      } else if (ch === ",") {
        row.push(field); field = "";
      } else if (ch === "\n") {
        row.push(field); field = "";
        rows.push(row); row = [];
      } else if (ch !== "\r") {
        field += ch;
      }
    }
    if (field !== "" || row.length) { row.push(field); rows.push(row); }
    // drop fully-empty rows (trailing blank lines)
    return rows.filter(function (r) {
      return r.some(function (c) { return String(c).trim() !== ""; });
    });
  }

  var CSV_H = {
    first:    ["first name", "given name", "όνομα"],
    middle:   ["middle name", "δεύτερο όνομα"],
    last:     ["last name", "family name", "surname", "επώνυμο"],
    nick:     ["nickname", "ψευδώνυμο"],
    fullname: ["name", "ονοματεπώνυμο"],
    org:      ["organization name", "organization 1 - name", "organization", "company", "εταιρεία"],
    title:    ["organization title", "organization 1 - title", "title", "job title", "θέση"],
    note:     ["notes", "note", "σημειώσεις"],
    bday:     ["birthday", "γενέθλια"],
    group:    ["labels", "group membership", "group memberships"]
  };

  // Exact-match a folded header against an alias list.
  function csvHeaderIndex(headers, aliases) {
    for (var i = 0; i < headers.length; i++) {
      var h = greekFold(headers[i]).trim();
      for (var a = 0; a < aliases.length; a++) {
        if (greekFold(aliases[a]) === h) return i;
      }
    }
    return -1;
  }

  // Header-only presence check ("phone 1 - value" etc.).
  function csvHasHeader(headers, target) {
    var tt = greekFold(target);
    for (var i = 0; i < headers.length; i++) {
      if (greekFold(headers[i]).trim() === tt) return true;
    }
    return false;
  }

  // Numbered pair lookup: prefix + " n - want" ("phone 3 - value").
  function csvPair(row, headers, prefix, n, want) {
    var target = greekFold(prefix + " " + n + " - " + want);
    for (var i = 0; i < headers.length; i++) {
      if (greekFold(headers[i]).trim() === target) return String(row[i] || "").trim();
    }
    return "";
  }

  // Google birthday spellings: 1975-03-17 · 1975-3-17 · 19750317 ·
  // --03-17 · 03-17 · Mar 17, 1975 · March 17 1975.
  var CSV_MONTHS = {
    jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
    jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12
  };
  function csvPad2(n) { return (n < 10 ? "0" : "") + n; }
  function parseCsvBirthday(v) {
    var s = String(v || "").trim();
    if (!s) return null;
    var m;
    if ((m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/)) ||
        (m = s.match(/^(\d{4})(\d{2})(\d{2})$/))) {
      var day = csvPad2(+m[2]) + "-" + csvPad2(+m[3]);
      return validDay(day) ? { day: day, year: +m[1] } : null;
    }
    if ((m = s.match(/^-{0,2}(\d{1,2})-(\d{1,2})$/))) {
      var d2 = csvPad2(+m[1]) + "-" + csvPad2(+m[2]);
      return validDay(d2) ? { day: d2, year: null } : null;
    }
    if ((m = s.match(/^([A-Za-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})$/))) {
      var mo = CSV_MONTHS[m[1].slice(0, 3).toLowerCase()];
      if (mo) {
        var d3 = csvPad2(mo) + "-" + csvPad2(+m[2]);
        return validDay(d3) ? { day: d3, year: +m[3] } : null;
      }
    }
    return null;
  }

  // One CSV row → the SAME shape parseVcardBlock emits, so
  // The import review (openReview) handles dedup (email/phone/name match), label
  // creation and the import report with zero extra code.
  function csvRowToContact(row, headers) {
    var pick = function (keys) {
      var ix = csvHeaderIndex(headers, keys);
      return ix === -1 ? "" : String(row[ix] || "").trim();
    };
    var pc = {
      given: pick(CSV_H.first).slice(0, 60),
      middle: pick(CSV_H.middle).slice(0, 60),
      family: pick(CSV_H.last).slice(0, 60),
      nickname: pick(CSV_H.nick).slice(0, 60),
      org: pick(CSV_H.org).slice(0, 80),
      jobTitle: pick(CSV_H.title).slice(0, 80),
      phones: [], emails: [], addresses: [], websites: [], im: [],
      events: [], cats: [], note: pick(CSV_H.note).slice(0, 500),
      photo: null, starred: false
    };
    // FN-style fallback: "Name" split when parts are missing.
    if (!pc.given && !pc.family && !pc.org && !pc.nickname) {
      var fn = pick(CSV_H.fullname).split(/\s+/).filter(Boolean);
      if (fn.length) {
        pc.given = fn[0].slice(0, 60);
        pc.family = fn.slice(1).join(" ").slice(0, 60);
      }
    }
    var n;
    for (n = 1; n <= 15; n++) {
      var pv = csvPair(row, headers, "phone", n, "value");
      if (!pv) continue;
      var pty = typeFromVcf(csvPair(row, headers, "phone", n, "type"), PHONE_TYPES, "other");
      // Google joins several numbers of one row with " ::: "
      pv.split(":::").forEach(function (one) {
        one = one.trim();
        if (one) pc.phones.push({ v: one.slice(0, 40), type: pty });
      });
    }
    // Email spelling check: remember WHICH alias matched ("e-mail"
    // vs "email") so the type column is read from the same spelling.
    for (n = 1; n <= 15; n++) {
      var evKey = csvPair(row, headers, "e-mail", n, "value") ? "e-mail"
                : (csvPair(row, headers, "email", n, "value") ? "email" : null);
      if (!evKey) continue;
      var ety = typeFromVcf(csvPair(row, headers, evKey, n, "type"), EMAIL_TYPES, "other");
      csvPair(row, headers, evKey, n, "value").split(":::").forEach(function (one) {
        one = one.trim();
        if (one) pc.emails.push({ v: one.slice(0, 120), type: ety });
      });
    }
    for (n = 1; n <= 10; n++) {
      var street = csvPair(row, headers, "address", n, "street") ||
                   csvPair(row, headers, "address", n, "formatted");
      var city = csvPair(row, headers, "address", n, "city");
      var region = csvPair(row, headers, "address", n, "region");
      var zip = csvPair(row, headers, "address", n, "postal code") ||
                csvPair(row, headers, "address", n, "zip");
      var country = csvPair(row, headers, "address", n, "country");
      if (!street && !city && !zip && !region && !country) continue;
      pc.addresses.push({
        street: street.slice(0, 120), city: city.slice(0, 60),
        zip: zip.slice(0, 20), region: region.slice(0, 60),
        country: country.slice(0, 60),
        type: typeFromVcf(csvPair(row, headers, "address", n, "type"), ADDR_TYPES, "other")
      });
    }
    for (n = 1; n <= 10; n++) {
      var wv = csvPair(row, headers, "website", n, "value");
      if (!wv) continue;
      var wty = typeFromVcf(csvPair(row, headers, "website", n, "type"), WEB_TYPES, "other");
      wv.split(":::").forEach(function (one) {
        one = one.trim();
        if (one) pc.websites.push({ v: one.slice(0, 300), type: wty });
      });
    }
    var bd = parseCsvBirthday(pick(CSV_H.bday));
    if (bd) {
      pc.events.push({ day: bd.day, year: bd.year, type: "birthday", label: "" });
    }
    // Group Membership: "* myContacts ::: * starred ::: Family" —
    // starred flag honored, * system groups dropped, the rest become
    // labels via the review's CATEGORIES machinery (resolveCats).
    var gm = pick(CSV_H.group);
    if (gm) {
      gm.split(":::").forEach(function (g) {
        var name = g.trim();
        if (!name) return;
        if (name === "* starred") { pc.starred = true; return; }
        if (name.charAt(0) === "*") return;
        if (pc.cats.indexOf(name) === -1) pc.cats.push(name.slice(0, 40));
      });
    }
    return pc;
  }

  // Google's own CSV keeps its automatic reader below; any other CSV
  // (Outlook, Excel with ";" — as Greek Excel writes it —, a CRM…)
  // opens the column mapping first (contacts/csvmap.js).
  function importCsvText(text, src) {
    var CM = window.OrosContactsCsv;
    if (CM) {
      var pr = CM.parse(text);
      if (!pr.rows.length) { notifyTransient(t("ct.import.csv.noheader")); return; }
      if (!CM.isGoogle(pr.rows[0])) { openCsvMap(pr.rows, src); return; }
    }
    var rows = parseCsvRows(text);
    if (rows.length < 2) { notifyTransient(t("ct.import.csv.noheader")); return; }
    var headers = rows[0];
    // Sanity gate: at least one recognisable column (or numbered
    // family) must exist before we touch state.
    var known = Object.keys(CSV_H).some(function (k) {
      return csvHeaderIndex(headers, CSV_H[k]) !== -1;
    }) || csvHasHeader(headers, "phone 1 - value") ||
         csvHasHeader(headers, "e-mail 1 - value") ||
         csvHasHeader(headers, "email 1 - value");
    if (!known) { notifyTransient(t("ct.import.csv.bad")); return; }

    var parsed = [];
    for (var r = 1; r < rows.length; r++) {
      var pc = csvRowToContact(rows[r], headers);
      if (pc.given || pc.family || pc.org || pc.nickname) parsed.push(pc);
    }
    if (!parsed.length) { notifyTransient(t("ct.import.csv.norows")); return; }
    openReview(parsed, src || "");
  }

  // ---- Column mapping (any CSV) ----
  var csvMap = null;   // { rows, map: [{f, ty}], src }
  var CSV_PREVIEW = 3;
  function csvFieldLabel(f) {
    var k = {
      "": "cm.f.skip", given: "ct.field.given", middle: "ct.field.middle", family: "ct.field.family",
      full: "cm.f.full", nickname: "ct.field.nickname", org: "ct.field.org", jobTitle: "ct.field.jobtitle",
      birthday: "evt.birthday", note: "ct.field.note", labels: "ct.lbl.filter"
    }[f];
    return t(k || ("cm.f." + f));
  }
  function openCsvMap(rows, src) {
    var CM = window.OrosContactsCsv;
    var width = 0;
    rows.slice(0, 50).forEach(function (r) { if (r.length > width) width = r.length; });
    width = Math.min(width, 80);
    var heads = rows[0] || [];
    var map = [], hits = 0;
    for (var i = 0; i < width; i++) {
      var g = CM.guess(heads[i]);
      if (g.f) hits++;
      map.push(g);
    }
    csvMap = { rows: rows, map: map, src: String(src || "").slice(0, 160), width: width };
    $("csv-src").textContent = csvMap.src;
    $("csv-head").checked = hits > 0;
    var bdays = [];
    map.forEach(function (m, ix) {
      if (m.f === "birthday") rows.slice(1, 200).forEach(function (r) { bdays.push(r[ix]); });
    });
    $("csv-order").value = CM.dateOrder(bdays);
    renderCsvMap();
    try { if ($("csv-dlg").open) $("csv-dlg").close(); } catch (e) {}
    $("csv-dlg").showModal();
  }
  function csvParsed() {
    var CM = window.OrosContactsCsv;
    return CM.toContacts(csvMap.rows, csvMap.map, { header: $("csv-head").checked, order: $("csv-order").value });
  }
  function renderCsvMap() {
    var CM = window.OrosContactsCsv;
    var host = $("csv-cols");
    host.textContent = "";
    var head = $("csv-head").checked;
    var sample = csvMap.rows[head ? 1 : 0] || [];
    csvMap.map.forEach(function (m, i) {
      var row = document.createElement("div");
      row.className = "cm-row";
      var info = document.createElement("div");
      info.className = "cm-info";
      var nm = document.createElement("span");
      nm.className = "cm-name";
      nm.textContent = head && String(csvMap.rows[0][i] || "").trim()
        ? String(csvMap.rows[0][i]).trim().slice(0, 60) : t("cm.col").replace("{n}", String(i + 1));
      var ex = document.createElement("span");
      ex.className = "cm-ex";
      ex.textContent = String(sample[i] == null ? "" : sample[i]).trim().slice(0, 60);
      info.appendChild(nm);
      info.appendChild(ex);
      row.appendChild(info);
      var sel = document.createElement("select");
      sel.setAttribute("aria-label", nm.textContent);
      CM.TARGETS.forEach(function (f) {
        var o = document.createElement("option");
        o.value = f;
        o.textContent = csvFieldLabel(f);
        sel.appendChild(o);
      });
      sel.value = m.f;
      row.appendChild(sel);
      var ts = document.createElement("select");
      ts.setAttribute("aria-label", t("cm.type"));
      var T = CM.typesOf(m.f);
      if (T) {
        T.forEach(function (ty) {
          var o = document.createElement("option");
          o.value = ty;
          o.textContent = t("ty." + ty);
          ts.appendChild(o);
        });
        ts.value = T.indexOf(m.ty) !== -1 ? m.ty : T[T.length - 1];
        m.ty = ts.value;
      } else ts.hidden = true;
      row.appendChild(ts);
      sel.addEventListener("change", function () {
        m.f = sel.value;
        var TT = CM.typesOf(m.f);
        m.ty = TT ? (m.f === "phone" ? "mobile" : TT[TT.length - 1]) : "";
        renderCsvMap();
      });
      ts.addEventListener("change", function () { m.ty = ts.value; renderCsvPreview(); });
      host.appendChild(row);
    });
    $("csv-order-row").hidden = !csvMap.map.some(function (m) { return m.f === "birthday"; });
    renderCsvPreview();
  }
  function renderCsvPreview() {
    var list = csvParsed();
    $("csv-prev-title").textContent = t("cm.preview").replace("{n}", String(list.length));
    var host = $("csv-prev");
    host.textContent = "";
    if (!list.length) {
      var p = document.createElement("p");
      p.className = "del-text";
      p.textContent = t("cm.none");
      host.appendChild(p);
    }
    list.slice(0, CSV_PREVIEW).forEach(function (pc) {
      var row = document.createElement("div");
      row.className = "rev-row";
      var nm = document.createElement("span");
      nm.className = "rv-name";
      nm.textContent = displayName(pc) || t("ct.unnamed");
      row.appendChild(nm);
      var bits = [];
      if (pc.org) bits.push(pc.org);
      if (pc.jobTitle) bits.push(pc.jobTitle);
      pc.phones.forEach(function (x) { bits.push(x.v); });
      pc.emails.forEach(function (x) { bits.push(x.v); });
      pc.addresses.forEach(function (a) { bits.push([a.street, a.zip, a.city, a.country].filter(Boolean).join(" ")); });
      pc.events.forEach(function (e) { bits.push(t("evt.birthday") + " " + (e.year ? e.year + "-" : "") + e.day); });
      if (pc.cats.length) bits.push(pc.cats.join(", "));
      var info = document.createElement("div");
      info.className = "rv-info";
      info.textContent = bits.join(" · ").slice(0, 300);
      row.appendChild(info);
      host.appendChild(row);
    });
    $("csv-go").disabled = !list.length;
  }
  if ($("csv-dlg")) {
    $("csv-head").addEventListener("change", renderCsvMap);
    $("csv-order").addEventListener("change", renderCsvPreview);
    $("csv-no").addEventListener("click", function () { $("csv-dlg").close(); });
    $("csv-dlg").addEventListener("close", function () { csvMap = null; });
    $("csv-go").addEventListener("click", function () {
      if (!csvMap) return;
      var list = csvParsed(), src = csvMap.src;
      if (!list.length) { notifyTransient(t("cm.none")); return; }
      $("csv-dlg").close();
      openReview(list, src);
    });
  }

  // vCard text → parsed blocks (only blocks with a name or company).
  function parseVcfText(text) {
    var lines = vcfUnfold(text);
    var blocks = [], cur = null;
    lines.forEach(function (ln) {
      var u = ln.trim().toUpperCase();
      if (u === "BEGIN:VCARD") { cur = []; return; }
      if (u === "END:VCARD") { if (cur) blocks.push(cur); cur = null; return; }
      if (cur) cur.push(ln);
    });
    return blocks.map(parseVcardBlock).filter(function (b) {
      return b.given || b.family || b.org || b.nickname;
    });
  }
  function importVcfText(text, src) {
    try {
      var parsed = parseVcfText(text);
      if (!parsed.length) { notifyTransient(t("ct.import.bad")); return; }
      openReview(parsed, src || "");
    } catch (e) {
      console.error("contacts: vCard import failed:", e);
      notifyTransient(t("ct.import.bad"));
    }
  }

  // BR-FILE-IMPORT: a .vcf handed over by the shell
  // (__orosOpenAt("contacts", { importVcf: { name, text } })). Never
  // silent: the review names the file and nothing is saved before
  // the person presses Import.
  var VCF_MAX_CHARS = 5 * 1024 * 1024;
  function askImportVcf(text, name) {
    if (text.length > VCF_MAX_CHARS) { notifyTransient(t("ct.import.bad")); return; }
    var parsed;
    try { parsed = parseVcfText(text); } catch (e) { parsed = []; }
    if (!parsed.length) { notifyTransient(t("ct.import.bad")); return; }
    openReview(parsed, name);
  }

  // "From phone": the Contact Picker API (Chrome on Android). The
  // person picks contacts in the system sheet; only what they pick
  // reaches the page. Same import path as a vCard (match by phone or
  // email → fill empty fields, else create).
  function pickerToParsed(r) {
    var full = (Array.isArray(r.name) && r.name[0] ? String(r.name[0]) : "").replace(/\s+/g, " ").trim();
    var words = full ? full.split(" ") : [];
    var pc = {
      given: "", middle: "", family: "", nickname: "", org: "", jobTitle: "",
      phones: [], emails: [], addresses: [], websites: [], im: [],
      events: [], cats: [], note: "", photo: null, starred: false
    };
    pc.family = (words.length > 1 ? words.pop() : "").slice(0, 60);
    pc.given = words.join(" ").slice(0, 60);
    (Array.isArray(r.tel) ? r.tel : []).forEach(function (v) {
      v = String(v || "").trim();
      if (v && !pc.phones.some(function (x) { return phoneDigits(x.v) === phoneDigits(v); })) {
        pc.phones.push({ v: v.slice(0, 40), type: "mobile" });
      }
    });
    (Array.isArray(r.email) ? r.email : []).forEach(function (v) {
      v = String(v || "").trim();
      if (v && !pc.emails.some(function (x) { return x.v.toLowerCase() === v.toLowerCase(); })) {
        pc.emails.push({ v: v.slice(0, 120), type: "other" });
      }
    });
    (Array.isArray(r.address) ? r.address : []).forEach(function (a) {
      if (!a) return;
      var ad = {
        street: (Array.isArray(a.addressLine) ? a.addressLine.join(", ") : "").trim().slice(0, 120),
        city: String(a.city || "").trim().slice(0, 60),
        region: String(a.region || "").trim().slice(0, 60),
        zip: String(a.postalCode || "").trim().slice(0, 20),
        country: String(a.country || "").trim().slice(0, 60),
        type: "other"
      };
      if (ad.street || ad.city || ad.region || ad.zip || ad.country) pc.addresses.push(ad);
    });
    if (!pc.given && !pc.family) {
      // A number with no name: keep it, named by the number itself.
      pc.given = (pc.phones[0] && pc.phones[0].v) || (pc.emails[0] && pc.emails[0].v) || "";
    }
    return pc;
  }
  // On this phone (BR-PHONE): only inside the orOS Android app, which
  // mirrors this app's data into the phone's own Contacts. The shell
  // (phone.js) owns the channel; this is just the switch and status.
  var orosPhone = null;
  try { if (window.parent && window.parent !== window) orosPhone = window.parent.orosPhone || null; } catch (e) {}
  function phoneRender() {
    if (!orosPhone || !$("ct-mirror")) return;
    $("ct-mirror").hidden = !orosPhone.available();
    if (!$("ph-dlg").open) return;
    var st = orosPhone.state() || {}, perm = st.contacts || "ask";
    var on = orosPhone.enabled("contacts"), last = orosPhone.lastSync("contacts");
    $("ph-on").checked = on;
    $("ph-allow").hidden = perm === "granted";
    var msg;
    if (perm === "denied") msg = t("ph.denied");
    else if (perm !== "granted") msg = t("ph.ask");
    else if (!on) msg = t("ph.off");
    else if (last.err) msg = t("ph.err").replace("{e}", last.err);
    else if (!last.at) msg = t("ph.wait");
    else msg = t("ph.last").replace("{t}", new Date(last.at).toLocaleString(LANG === "el" ? "el-GR" : "en-GB",
      { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }))
      .replace("{n}", String(last.n)).replace("{what}", t("ph.what"));
    $("ph-stat").textContent = msg;
  }
  if (orosPhone && $("ct-mirror") && $("ph-dlg")) {
    var phoneOff = orosPhone.onChange(phoneRender);
    window.addEventListener("pagehide", function () { phoneOff(); });
    $("ct-mirror").addEventListener("click", function () {
      $("ph-dlg").showModal();
      orosPhone.refresh();
      phoneRender();
    });
    $("ph-on").addEventListener("change", function () {
      var st = orosPhone.state() || {};
      orosPhone.setEnabled("contacts", $("ph-on").checked);
      // Switching on before Android allowed it: ask in the same tap.
      if ($("ph-on").checked && st.contacts !== "granted") orosPhone.askPermission("contacts");
      phoneRender();
    });
    $("ph-allow").addEventListener("click", function () { orosPhone.askPermission("contacts"); });
    $("ph-close").addEventListener("click", function () { $("ph-dlg").close(); });
    phoneRender();
  }

  var phonePicker = null;
  try {
    if (navigator.contacts && typeof navigator.contacts.select === "function" &&
        window.ContactsManager) phonePicker = navigator.contacts;
  } catch (e) {}
  if (phonePicker && $("ct-phone")) {
    $("ct-phone").hidden = false;
    $("ct-phone").addEventListener("click", function () {
      var want = ["name", "tel", "email"];
      Promise.resolve(typeof phonePicker.getProperties === "function" ? phonePicker.getProperties() : want)
        .then(function (have) {
          if (Array.isArray(have) && have.indexOf("address") !== -1) want.push("address");
          return phonePicker.select(want, { multiple: true });
        })
        .then(function (rows) {
          if (!Array.isArray(rows) || !rows.length) return;   // cancelled
          var parsed = rows.map(pickerToParsed).filter(function (b) { return b.given || b.family; });
          if (parsed.length) openReview(parsed, t("ct.phone"));
        })
        .catch(function (e) {
          console.warn("contacts: phone picker failed:", e);
          notifyTransient(t("ct.phone.bad"));
        });
    });
  }

  // ---- From an account (accounts.js): sign in once, read, let go ----
  var ACC = window.OrosContactsAccounts;
  var acBusy = false;
  var AC_NAME = { google: "Google", microsoft: "Microsoft" };
  function acStat(text) { $("ac-stat").textContent = text || ""; }
  function acRender() {
    ["google", "microsoft"].forEach(function (p) {
      $("ac-" + p).disabled = acBusy;
      // Only providers this orOS (or this device's own app id) can
      // sign in to are offered; Microsoft has no built-in id for now.
      $("ac-" + p).hidden = !ACC.ready(p);
      $("ac-id-" + p).value = ACC.ownId(p);
    });
    $("ac-uri").textContent = ACC.redirectUri();
    if (!ACC.ready("google") && !ACC.ready("microsoft")) $("ac-own").open = true;
  }
  function acErr(e) {
    var c = e && e.code;
    if (c === "cancelled") return t("ac.cancelled");
    if (c === "popup") return t("ac.popup");
    if (c === "forbidden") return t("ac.forbidden");
    return t("ac.err").replace("{e}", String((e && (e.detail || e.code)) || "?").slice(0, 80));
  }
  if ($("ac-dlg") && ACC && IP) {
    $("ct-acct").addEventListener("click", function () {
      acStat("");
      acRender();
      $("ac-dlg").showModal();
    });
    ["google", "microsoft"].forEach(function (p) {
      $("ac-" + p).addEventListener("click", function () {
        if (acBusy) return;
        if (!ACC.ready(p)) {
          acStat(t("ac.noclient").replace("{p}", AC_NAME[p]));
          $("ac-own").open = true;
          return;
        }
        acBusy = true;
        acRender();
        acStat(t("ac.wait"));
        ACC.run(p, function (n) { acStat(t("ac.read").replace("{n}", String(n))); })
          .then(function (res) {
            acBusy = false;
            acRender();
            var parsed = res.contacts.filter(function (b) { return b.given || b.family || b.org || b.nickname; });
            if (!parsed.length) { acStat(t("ac.none")); return; }
            acStat("");
            $("ac-dlg").close();
            openReview(parsed, t("ac.src").replace("{p}", AC_NAME[p]).replace("{n}", String(parsed.length)));
          }, function (e) {
            acBusy = false;
            acRender();
            console.warn("contacts: account import failed:", e);
            acStat(acErr(e));
          });
      });
    });
    $("ac-id-save").addEventListener("click", function () {
      var ok = ACC.setOwnId("google", $("ac-id-google").value) &&
               ACC.setOwnId("microsoft", $("ac-id-microsoft").value);
      acStat(ok ? t("ac.own.saved") : t("ac.own.bad"));
      if (ok) acRender();
    });
    $("ac-close").addEventListener("click", function () { $("ac-dlg").close(); });
    // Closing the dialog while signing in stops the wait.
    $("ac-dlg").addEventListener("close", function () { if (acBusy) ACC.cancel(); });
  } else if ($("ct-acct")) {
    $("ct-acct").hidden = true;
  }

  // ---- Find photos online (Gravatar, Libravatar) ----
  // Only contacts without a photo, only by their own e-mail: an address
  // two or more contacts share is skipped (that is the cross-check: the
  // picture someone set for an address belongs to that address's one
  // contact). The address goes out as its SHA-256 hash, lower-cased and
  // trimmed, exactly what both services index by; d=404 means "no
  // picture" instead of a generated one. Nothing is written until the
  // person ticks what to keep; Undo puts the contacts back.
  var PF_SOURCES = [
    { name: "Gravatar", url: function (h) { return "https://gravatar.com/avatar/" + h + "?d=404&s=256"; } },
    { name: "Libravatar", url: function (h) { return "https://seccdn.libravatar.org/avatar/" + h + "?d=404&s=256"; } }
  ];
  var pfBusy = false, pfFound = [];
  function pfCandidates() {
    var owners = {};
    state.contacts.forEach(function (c) {
      var seen = {};
      c.emails.forEach(function (e) {
        var k = normalizeEmail(e.v);
        if (!k || seen[k]) return;
        seen[k] = 1;
        owners[k] = (owners[k] || 0) + 1;
      });
    });
    var out = [];
    state.contacts.forEach(function (c) {
      if (c.photo) return;
      var mails = c.emails.map(function (e) { return normalizeEmail(e.v); })
        .filter(function (k, i, a) { return k && /@/.test(k) && owners[k] === 1 && a.indexOf(k) === i; });
      if (mails.length) out.push({ id: c.id, mails: mails.slice(0, 3) });
    });
    return out;
  }
  function pfHash(mail) {
    return crypto.subtle.digest("SHA-256", new TextEncoder().encode(mail)).then(function (buf) {
      return Array.prototype.map.call(new Uint8Array(buf), function (b) { return (b < 16 ? "0" : "") + b.toString(16); }).join("");
    });
  }
  // Fetched picture → the same 128×128 centre-cropped JPEG an upload gets.
  function pfAvatar(blob) {
    return createImageBitmap(blob).then(function (bmp) {
      var side = Math.min(bmp.width, bmp.height);
      var cv = document.createElement("canvas");
      cv.width = AVATAR_SIZE; cv.height = AVATAR_SIZE;
      var ctx = cv.getContext("2d");
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(bmp, (bmp.width - side) / 2, (bmp.height - side) / 2, side, side, 0, 0, AVATAR_SIZE, AVATAR_SIZE);
      var uri = cv.toDataURL("image/jpeg", 0.85);
      return uri.length <= 50000 ? uri : null;
    });
  }
  // CT-PS (2026-10-15): photos stay small. A contact picture is shown
  // at 128 px at most, but Google imports and vCards kept up to 50,000
  // characters each, and a few hundred of them filled the browser's
  // local storage (sync stopped with "storage full", SY-Q1). Once per
  // start, every bigger photo is redrawn as a 128×128 JPEG, the size
  // an upload gets; one that comes out no smaller stays as it is.
  var PHOTO_SMALL = 16000;
  function shrinkPhoto(uri) {
    return fetch(uri).then(function (r) { return r.blob(); }).then(createImageBitmap).then(function (bmp) {
      var side = Math.min(bmp.width, bmp.height);
      var cv = document.createElement("canvas");
      cv.width = AVATAR_SIZE; cv.height = AVATAR_SIZE;
      var ctx = cv.getContext("2d");
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(bmp, (bmp.width - side) / 2, (bmp.height - side) / 2, side, side, 0, 0, AVATAR_SIZE, AVATAR_SIZE);
      return cv.toDataURL("image/jpeg", 0.75);
    });
  }
  function shrinkPhotos() {
    if (typeof createImageBitmap !== "function" || typeof fetch !== "function") return Promise.resolve(0);
    var todo = state.contacts.filter(function (c) { return c.photo && c.photo.length > PHOTO_SMALL; })
      .map(function (c) { return { id: c.id, photo: c.photo }; });
    var done = 0;
    function next(i) {
      if (i >= todo.length) return Promise.resolve();
      var it = todo[i];
      return shrinkPhoto(it.photo).then(function (out) {
        var c = contactById(it.id);
        // only if the photo didn't change meanwhile, and it got clearly smaller
        if (c && c.photo === it.photo && out && out.length < it.photo.length * 0.75) { c.photo = out; done++; }
      }, function () {}).then(function () { return next(i + 1); });
    }
    return next(0).then(function () {
      if (done) { saveState(); renderList(); }
      return done;
    });
  }
  function pfLookup(mail) {
    return pfHash(mail).then(function (h) {
      var i = 0;
      function next() {
        if (i >= PF_SOURCES.length) return null;
        var src = PF_SOURCES[i++];
        return fetch(src.url(h), { credentials: "omit", cache: "no-store", referrerPolicy: "no-referrer" })
          .then(function (r) {
            if (!r.ok || !/^image\//.test(r.headers.get("Content-Type") || "")) return next();
            return r.blob().then(pfAvatar).then(function (uri) { return uri ? { photo: uri, source: src.name, mail: mail } : next(); });
          }, function () { return next(); });
      }
      return next();
    });
  }
  function pfRender() {
    var box = $("pf-list");
    box.textContent = "";
    pfFound.forEach(function (f) {
      var c = contactById(f.id);
      if (!c) return;
      var row = document.createElement("label");
      row.className = "pf-row";
      var cb = document.createElement("input");
      cb.type = "checkbox";
      cb.checked = f.on;
      cb.addEventListener("change", function () { f.on = cb.checked; });
      var im = document.createElement("img");
      im.className = "ct-avatar ct-avatar-img";
      im.alt = "";
      im.src = f.photo;
      var tx = document.createElement("span");
      tx.className = "pf-txt";
      var nm = document.createElement("b");
      nm.textContent = displayName(c);
      var via = document.createElement("small");
      via.textContent = t("pf.via").replace("{s}", f.source).replace("{e}", f.mail);
      tx.appendChild(nm);
      tx.appendChild(via);
      row.appendChild(cb);
      row.appendChild(im);
      row.appendChild(tx);
      box.appendChild(row);
    });
    $("pf-apply").hidden = !pfFound.length;
    $("pf-go").hidden = !!pfFound.length;
  }
  function pfSearch() {
    if (pfBusy) return;
    var list = pfCandidates();
    pfFound = [];
    pfRender();
    if (!list.length) { $("pf-stat").textContent = t("pf.none"); return; }
    pfBusy = true;
    $("pf-go").disabled = true;
    var done = 0, k = 0;
    function show() { $("pf-stat").textContent = t("pf.busy").replace("{i}", String(done)).replace("{n}", String(list.length)); }
    show();
    function worker() {
      if (!pfBusy || k >= list.length) return Promise.resolve();
      var item = list[k++], j = 0;
      function tryMail() {
        if (j >= item.mails.length) return null;
        return pfLookup(item.mails[j++]).then(function (r) { return r || tryMail(); });
      }
      return Promise.resolve(tryMail()).then(function (r) {
        if (r) { pfFound.push({ id: item.id, photo: r.photo, source: r.source, mail: r.mail, on: true }); pfRender(); }
      }, function () {}).then(function () { done++; show(); return worker(); });
    }
    Promise.all([worker(), worker(), worker(), worker()]).then(function () {
      var stopped = !pfBusy;
      pfBusy = false;
      $("pf-go").disabled = false;
      if (stopped) return;
      $("pf-stat").textContent = pfFound.length
        ? t("pf.found").replace("{n}", String(pfFound.length)).replace("{m}", String(list.length))
        : t("pf.nothing").replace("{m}", String(list.length));
    });
  }
  function pfApply() {
    var before = [], n = 0, now = Date.now();
    pfFound.forEach(function (f) {
      if (!f.on) return;
      var c = contactById(f.id);
      if (!c || c.photo) return;   // never replaces a photo
      before.push(JSON.parse(JSON.stringify(c)));
      c.photo = f.photo;
      c.mtime = now;
      n++;
    });
    pfFound = [];
    $("pf-dlg").close();
    if (!n) return;
    saveState();
    renderList();
    toast(t("pf.done").replace("{n}", String(n)), t("undo"), function () {
      var t2 = Date.now();
      before.forEach(function (old) {
        var cur = contactById(old.id);
        if (!cur) return;
        old.mtime = t2;
        state.contacts[state.contacts.indexOf(cur)] = old;
      });
      saveState();
      renderList();
    });
  }
  if ($("pf-dlg") && window.crypto && crypto.subtle && window.createImageBitmap) {
    $("ct-pf").addEventListener("click", function () {
      pfFound = [];
      pfRender();
      $("pf-stat").textContent = "";
      $("pf-dlg").showModal();
    });
    $("pf-go").addEventListener("click", pfSearch);
    $("pf-apply").addEventListener("click", pfApply);
    $("pf-close").addEventListener("click", function () { $("pf-dlg").close(); });
    $("pf-dlg").addEventListener("close", function () { pfBusy = false; });
  } else if ($("ct-pf")) {
    $("ct-pf").hidden = true;
  }

  // ---- Update from online sources (../enrich.js + ../enrichui.js) ----
  // The contacts in the list right now (search and filters applied),
  // or the one open in the editor. Only their own e-mail, phone and
  // websites are used as keys; an address two contacts share is not.
  // Suggestions are reviewed in the shared dialog; one write, Undo.
  function enRecord(c, owners) {
    var shared = {};
    c.emails.forEach(function (e) { var k = normalizeEmail(e.v); if (owners[k] > 1) shared[k] = 1; });
    return {
      names: [displayName(c), c.nickname, c.org].filter(Boolean),
      emails: c.emails.map(function (e) { return normalizeEmail(e.v); }),
      phones: c.phones.map(function (p) { return p.v; }),
      sites: c.websites.map(function (w) { return w.v; }),
      shared: shared,
      has: { photo: !!c.photo, birthday: c.events.some(function (e) { return e.type === "birthday"; }),
             job: !!c.jobTitle, org: !!c.org, address: c.addresses.length > 0, name: true },
      kind: (c.given || c.family) ? "person" : (c.org ? "org" : "")
    };
  }
  function enOwners() {
    var owners = {};
    state.contacts.forEach(function (c) {
      var seen = {};
      c.emails.forEach(function (e) {
        var k = normalizeEmail(e.v);
        if (!k || seen[k]) return;
        seen[k] = 1;
        owners[k] = (owners[k] || 0) + 1;
      });
    });
    return owners;
  }
  function enLoadUI() {
    if (window.OrosEnrichUI) return Promise.resolve();
    return new Promise(function (ok, fail) {
      var s = document.createElement("script");
      s.src = "../enrichui.js";
      s.onload = ok;
      s.onerror = fail;
      document.head.appendChild(s);
    });
  }
  function enApply(picks) {
    var before = [], n = 0, now = Date.now();
    picks.forEach(function (p) {
      var c = contactById(p.id);
      if (!c) return;
      var d = JSON.parse(JSON.stringify(c)), changed = false;
      function hasVal(list, v, norm) { return list.some(function (r) { return norm(r.v) === norm(v); }); }
      function low(v) { return String(v).trim().toLowerCase(); }
      p.list.forEach(function (s) {
        if (s.k === "photo" && !d.photo) { d.photo = s.v; changed = true; }
        else if (s.k === "link" && !hasVal(d.websites, s.v, function (v) { return low(v).replace(/^https?:\/\/(www\.)?/, "").replace(/\/+$/, ""); })) { d.websites.push({ v: s.v, type: "other" }); changed = true; }
        else if (s.k === "phone" && !hasVal(d.phones, s.v, phoneDigits)) { d.phones.push({ v: s.v, type: "other" }); changed = true; }
        else if (s.k === "email" && !hasVal(d.emails, s.v, low)) { d.emails.push({ v: s.v, type: "other" }); changed = true; }
        else if (s.k === "birthday" && !d.events.some(function (e) { return e.type === "birthday"; })) { d.events.push({ day: s.v.day, year: s.v.year, type: "birthday", label: "" }); changed = true; }
        else if (s.k === "job" && !d.jobTitle) { d.jobTitle = s.v; changed = true; }
        else if (s.k === "org" && !d.org) { d.org = s.v; changed = true; }
        else if (s.k === "address" && !d.addresses.length) { d.addresses.push({ street: String(s.v).slice(0, 120), city: "", zip: "", region: "", country: "", type: "work" }); changed = true; }
      });
      if (!changed) return;
      d.mtime = now;
      var clean = sanitizeContact(d);
      if (!clean) return;
      before.push(JSON.parse(JSON.stringify(c)));
      state.contacts[state.contacts.indexOf(c)] = clean;
      n++;
    });
    if (!n) return 0;
    saveState();
    renderList();
    toast(t("en.done").replace("{n}", String(n)), t("undo"), function () {
      var t2 = Date.now();
      before.forEach(function (old) {
        var cur = contactById(old.id);
        if (!cur) return;
        old.mtime = t2;
        state.contacts[state.contacts.indexOf(cur)] = old;
      });
      saveState();
      renderList();
    });
    return n;
  }
  function enOpen(ids) {
    var owners = enOwners();
    var items = ids.map(contactById).filter(function (c) {
      return c && (c.emails.length || c.phones.length || c.websites.length);
    }).map(function (c) { return { id: c.id, name: displayName(c), rec: enRecord(c, owners) }; });
    if (!items.length) { notifyTransient(t("en.empty")); return; }
    enLoadUI().then(function () {
      window.OrosEnrichUI.open({ lang: LANG === "el" ? "el" : "en", items: items, apply: enApply,
        kinds: ["link", "phone", "email", "birthday", "job", "org", "address"] });
    }, function () { notifyTransient(t("en.empty")); });
  }
  if ($("ct-enrich") && window.Promise && window.crypto && crypto.subtle) {
    $("ct-enrich").addEventListener("click", function () { enOpen(listShown.slice()); });
    $("ct-enrich-one").addEventListener("click", function () {
      if (!editingId) return;
      var form = readDlgDraft();
      var dirty = dlgSnap && DLG_FIELDS.some(function (f) { return JSON.stringify(form[f]) !== JSON.stringify(dlgSnap[f]); });
      if (dirty) { notifyTransient(t("en.save")); return; }
      var id = editingId;
      $("ct-dlg").close();
      enOpen([id]);
    });
  } else {
    if ($("ct-enrich")) $("ct-enrich").hidden = true;
    if ($("ct-enrich-one")) $("ct-enrich-one").hidden = true;
  }

  // ---- Import wiring ----
  // orosDialog first (native picker on Chromium); standalone falls
  // back to the legacy hidden #vcard-file input. Single reader:
  // both paths converge on importFileText().
  function importFileText(f) {
    if (!f) return;
    var fr = new FileReader();
    fr.onload = function () {
      // Route by extension: .csv → Google Contacts CSV path,
      // everything else → vCard path.
      if (f && (/\.csv$/i.test(f.name) || f.type === "text/csv")) {
        try {
          importCsvText(String(fr.result), f.name);
        } catch (e) {
          console.error("contacts: CSV import failed:", e);
          notifyTransient(t("ct.import.csv.bad"));
        }
        return;
      }
      importVcfText(String(fr.result), f.name);
    };
    fr.onerror = function () { notifyTransient(t("ct.import.bad")); };
    fr.readAsText(f, "utf-8");
  }
  if ($("ct-import")) {
    $("ct-import").addEventListener("click", function () {
      var dlg = dialogHost();
      if (dlg && typeof dlg.openFile === "function") {
        dlg.openFile(".vcf,.csv,text/vcard,text/csv")
          .then(function (f) { if (f) importFileText(f); });
        return;                     // cancel (null) = silent exit
      }
      $("vcard-file").click();      // standalone: legacy hidden input
    });
  }
  if ($("vcard-file")) {
    $("vcard-file").addEventListener("change", function () {
      var f = this.files && this.files[0];
      this.value = "";                       // allow re-import of same file
      if (f) importFileText(f);
    });
  }

  // ===== BUSINESS CARD SCAN =====
  // Photo (camera or file) → on-device text recognition → the text,
  // which the person can correct → contacts/cardtext.js → a NEW
  // contact form, prefilled; nothing is saved before Save.
  // Text recognition = Tesseract.js (Apache-2.0), vendored under
  // vendor/tesseract/ with the English and Greek data (about 7 MB):
  // loaded only when the person asks, after a notice the first time
  // on this device; no other server is contacted.
  var OCR_BASE = "../vendor/tesseract/";
  var OCR_FLAG = "oros-contacts-ocr";      // device-local: "1" once the engine was downloaded
  var ocrLoading = null, ocrBusy = false, scanHasImage = false;
  function scanStat(text) { $("scan-stat").textContent = text || ""; }
  function ocrScript() {
    if (window.Tesseract) return Promise.resolve(window.Tesseract);
    if (ocrLoading) return ocrLoading;
    ocrLoading = new Promise(function (res, rej) {
      var s = document.createElement("script");
      s.src = OCR_BASE + "tesseract.min.js";
      s.onload = function () { window.Tesseract ? res(window.Tesseract) : rej(new Error("no engine")); };
      s.onerror = function () { ocrLoading = null; rej(new Error("offline")); };
      document.head.appendChild(s);
    });
    return ocrLoading;
  }
  function scanImage(file) {
    if (!file || !/^image\//.test(file.type || "image/")) return;
    var url = URL.createObjectURL(file);
    var img = new Image();
    img.onload = function () {
      var w = img.naturalWidth, h = img.naturalHeight, max = 2000;
      var k = Math.min(1, max / Math.max(w, h));
      if (Math.max(w, h) < 1000) k = 1000 / Math.max(w, h);    // small pictures read better a bit larger
      var cv = $("scan-img");
      cv.width = Math.max(1, Math.round(w * k));
      cv.height = Math.max(1, Math.round(h * k));
      var x = cv.getContext("2d");
      x.fillStyle = "#fff";
      x.fillRect(0, 0, cv.width, cv.height);
      x.drawImage(img, 0, 0, cv.width, cv.height);
      URL.revokeObjectURL(url);
      cv.hidden = false;
      scanHasImage = true;
      var known = false;
      try { known = localStorage.getItem(OCR_FLAG) === "1"; } catch (e) {}
      if (known) runOcr();
      else { $("scan-dl").hidden = false; scanStat(""); }
    };
    img.onerror = function () { URL.revokeObjectURL(url); scanStat(t("ct.avatar.bad")); };
    img.src = url;
  }
  function runOcr() {
    if (ocrBusy || !scanHasImage) return;
    ocrBusy = true;
    $("scan-dl").hidden = true;
    ["scan-photo", "scan-pick", "scan-go"].forEach(function (id) { $(id).disabled = true; });
    var reading = false, worker = null;
    scanStat(t("sc.wait.load").replace("{p}", "0"));
    var base = new URL(OCR_BASE, location.href).href;
    function done() {
      ocrBusy = false;
      ["scan-photo", "scan-pick", "scan-go"].forEach(function (id) { $(id).disabled = false; });
      if (worker) { try { worker.terminate(); } catch (e) {} }
    }
    ocrScript().then(function (T) {
      return T.createWorker(["eng", "ell"], 1, {
        workerPath: base + "worker.min.js",
        corePath: base + "tesseract-core-lstm.js",
        langPath: base.replace(/\/$/, ""),
        workerBlobURL: false,
        cachePath: "oros-contacts-ocr",
        logger: function (m) {
          if (!m || typeof m.progress !== "number") return;
          var p = String(Math.round(m.progress * 100));
          scanStat(t(reading ? "sc.wait.read" : "sc.wait.load").replace("{p}", p));
        }
      });
    }).then(function (w) {
      worker = w;
      try { localStorage.setItem(OCR_FLAG, "1"); } catch (e) {}
      reading = true;
      scanStat(t("sc.wait.read").replace("{p}", "0"));
      return w.recognize($("scan-img"));
    }).then(function (r) {
      var text = String((r && r.data && r.data.text) || "").replace(/\n{3,}/g, "\n\n").trim();
      done();
      if (!text) { scanStat(t("sc.empty")); return; }
      $("scan-text").value = text.slice(0, 4000);
      scanStat(t("sc.done"));
    }, function (e) {
      done();
      console.warn("contacts: text recognition failed:", e);
      scanStat(t("sc.err").replace("{e}", String((e && e.message) || e || "?").slice(0, 80)));
    });
  }
  // The new-contact form, prefilled from a parser-shape contact.
  function openDlgPrefilled(pc) {
    try { closeViewCard(); } catch (e) {}
    try { if ($("ct-dlg").open) $("ct-dlg").close(); } catch (e) {}
    openDlg(null);
    $("ct-given").value = pc.given || "";
    $("ct-middle").value = pc.middle || "";
    $("ct-family").value = pc.family || "";
    $("ct-org").value = pc.org || "";
    $("ct-jobtitle").value = pc.jobTitle || "";
    $("ct-note").value = pc.note || "";
    fillHolder($("ct-phones"), pc.phones || [], function (h, r) { buildValRow(h, r && r.v, r && r.type, PHONE_TYPES, "+30 69…", 40, "ph"); });
    fillHolder($("ct-emails"), pc.emails || [], function (h, r) { buildValRow(h, r && r.v, r && r.type, EMAIL_TYPES, "name@example.com", 120, "em"); });
    fillHolder($("ct-websites"), pc.websites || [], function (h, r) { buildValRow(h, r && r.v, r && r.type, WEB_TYPES, "https://…", 300, "wb"); });
    fillHolder($("ct-addresses"), pc.addresses || [], buildAddrRow);
    fillHolder($("ct-events"), pc.events || [], buildEvtRow);
  }
  if ($("scan-dlg")) {
    $("ct-scan").addEventListener("click", function () {
      if (!ocrBusy) {
        scanStat("");
        $("scan-dl").hidden = true;
      }
      $("scan-dlg").showModal();
    });
    $("scan-photo").addEventListener("click", function () { $("scan-cam").value = ""; $("scan-cam").click(); });
    $("scan-pick").addEventListener("click", function () {
      var dlg = dialogHost();
      if (dlg && typeof dlg.openFile === "function") {
        dlg.openFile("image/*").then(function (f) { if (f) scanImage(f); });
        return;
      }
      $("scan-file").value = "";
      $("scan-file").click();
    });
    ["scan-cam", "scan-file"].forEach(function (id) {
      $(id).addEventListener("change", function () {
        var f = this.files && this.files[0];
        if (f) scanImage(f);
      });
    });
    $("scan-dl-go").addEventListener("click", runOcr);
    $("scan-go").addEventListener("click", function () {
      var text = $("scan-text").value.trim();
      var CC = window.OrosContactsCard;
      if (!text || !CC) { notifyTransient(t("sc.nofill")); return; }
      var pc = CC.parse(text);
      $("scan-dlg").close();
      $("scan-text").value = "";
      $("scan-img").hidden = true;
      scanHasImage = false;
      scanStat("");
      openDlgPrefilled(pc);
      notifyTransient(t("sc.check"));
    });
    $("scan-no").addEventListener("click", function () { $("scan-dlg").close(); });
  }

  function showImportReport(res) {
    var sec = $("import-sec"), ul = $("imp-list");
    ul.textContent = "";
    res.report.forEach(function (r) {
      var li = document.createElement("li");
      li.className = r.kind === "new" ? "imp-new" : (r.kind === "upd" ? "imp-upd" : "imp-skip");
      var mark = r.kind === "new" ? "＋ " : (r.kind === "upd" ? "↻ " : "· ");
      li.textContent = mark + r.name;
      ul.appendChild(li);
    });
    $("imp-title").textContent = t("ct.import.done").replace("{n}", String(res.created)) +
      " · ↻ " + res.updated;
    sec.hidden = false;
  }

  // ---- Export wiring ----
  function contactToVcard(c) {
    var L = [];
    L.push("BEGIN:VCARD");
    L.push("VERSION:3.0");
    var n = [c.family, c.given, c.middle, "", ""].map(vcfEsc).join(";");
    L.push("N:" + n);
    L.push("FN:" + vcfEsc(displayName(c)));
    if (c.nickname) L.push("NICKNAME:" + vcfEsc(c.nickname));
    if (c.org) L.push("ORG:" + vcfEsc(c.org));
    if (c.jobTitle) L.push("TITLE:" + vcfEsc(c.jobTitle));
    c.phones.forEach(function (p) {
      L.push("TEL;TYPE=" + vcfTelType(p.type) + ":" + vcfEsc(p.v));
    });
    c.emails.forEach(function (e) {
      L.push("EMAIL;TYPE=" + vcfAddrType(e.type) + ":" + vcfEsc(e.v));
    });
    c.addresses.forEach(function (a) {
      var adr = ["", "", a.street, a.city, a.region, a.zip, a.country].map(vcfEsc).join(";");
      L.push("ADR;TYPE=" + vcfAddrType(a.type) + ":" + adr);
    });
    c.websites.forEach(function (w) {
      L.push("URL:" + vcfEsc(w.v));
    });
    c.im.forEach(function (m) {
      L.push("IMPP:" + vcfEsc(m.v));
    });
    c.events.forEach(function (ev) {
      var val = ev.year ? (ev.year + "-" + ev.day) : ("--" + ev.day);
      if (ev.type === "birthday") L.push("BDAY:" + val);
      else if (ev.type === "anniversary") L.push("ANNIVERSARY:" + val);
      else L.push("X-EVENT;TYPE=CUSTOM;X-LABEL=" + vcfEsc(ev.label) + ":" + val);
    });
    if (c.note) L.push("NOTE:" + vcfEsc(c.note));
    if (c.labelIds.length) {
      var names = c.labelIds.map(function (lid) {
        var l = labelById(lid);
        return l ? l.name : "";
      }).filter(Boolean);
      if (names.length) L.push("CATEGORIES:" + names.map(vcfEsc).join(","));
    }
    // Round-trippable starred flag (X-ABShowAs was never parsed back
    // — favorite status silently died on vCard re-import).
    if (c.starred) L.push("X-OROS-STARRED:TRUE");
    if (c.photo) L.push("PHOTO:" + c.photo);
    L.push("REV:" + new Date(c.mtime).toISOString());
    L.push("END:VCARD");
    return L;
  }
  function vcfTelType(ty) {
    if (ty === "mobile") return "CELL";
    return ty.toUpperCase();
  }
  function vcfAddrType(ty) {
    return ty.toUpperCase();
  }

  if ($("ct-export")) {
    $("ct-export").addEventListener("click", function () {
      if (!state.contacts.length) { notifyTransient(t("ct.none")); return; }
      var lines = [];
      // Alphabetical export (deterministic, merge-order agnostic).
      var sorted = state.contacts.slice().sort(function (a, b) {
        return greekFold(displayName(a)).localeCompare(greekFold(displayName(b)), LANG);
      });
      sorted.forEach(function (c) {
        contactToVcard(c).forEach(function (l) {
          vcfFold(l).forEach(function (fl) { lines.push(fl); });
        });
      });
      var text = lines.join("\r\n") + "\r\n";
      try {
        var blob = new Blob([text], { type: "text/vcard;charset=utf-8" });
        var done = function () { notifyTransient(t("ct.export.done")); };
        var dlg = dialogHost();
        if (dlg && typeof dlg.saveFile === "function") {
          dlg.saveFile({
            blob: blob,
            filename: "orOS-contacts.vcf",
            mime: "text/vcard;charset=utf-8",
            types: [{ description: "vCard",
                      accept: { "text/vcard": [".vcf"] } }]
          }).then(function (r) { if (r && r.ok) done(); });
          return;                   // cancel (ok=false) = silent exit
        }
        // Standalone fallback — classic download (no shell present).
        var a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = "orOS-contacts.vcf";
        document.body.appendChild(a);
        a.click();
        setTimeout(function () {
          document.body.removeChild(a);
          URL.revokeObjectURL(a.href);
        }, 200);
        done();
      } catch (e) { notifyTransient(t("ct.export.bad")); }
    });
  }

  // ---- Full-database JSON export (zero-loss backup) ----
  // Mirrors the vcf download flow. Dumps ver + labels + contacts +
  // deleted tombstones, so a restore preserves merge history and
  // the no-phantom-delete guarantee (project mantra: FULL export).
  function exportJson() {
    try {
      var text = JSON.stringify({
        app: "contacts",
        ver: state.ver,
        labels: state.labels,
        contacts: state.contacts,
        deleted: state.deleted
      }, null, 2);
      var blob = new Blob([text], { type: "application/json;charset=utf-8" });
      var done = function () { notifyTransient(t("ct.export.json.done")); };
      var dlg = dialogHost();
      if (dlg && typeof dlg.saveFile === "function") {
        dlg.saveFile({
          blob: blob,
          filename: "orOS-contacts.json",
          mime: "application/json;charset=utf-8",
          types: [{ description: "JSON",
                    accept: { "application/json": [".json"] } }]
        }).then(function (r) { if (r && r.ok) done(); });
        return;                     // cancel (ok=false) = silent exit
      }
      // Standalone fallback — classic download (no shell present).
      var a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = "orOS-contacts.json";
      document.body.appendChild(a);
      a.click();
      setTimeout(function () {
        document.body.removeChild(a);
        URL.revokeObjectURL(a.href);
      }, 200);
      done();
    } catch (e) { notifyTransient(t("ct.export.bad")); }
  }
  // Button injected AFTER the vcf export button (same class →
  // same styling, no contacts.html edit required).
  if ($("ct-export")) {
    var jsonBtn = document.createElement("button");
    jsonBtn.type = "button";
    jsonBtn.className = $("ct-export").className;
    jsonBtn.textContent = t("ct.export.json");
    jsonBtn.addEventListener("click", exportJson);
    $("ct-export").parentNode.insertBefore(jsonBtn, $("ct-export").nextSibling);
  }

  // ---- Full-database JSON restore (merge, zero data loss) ----
  // Accepts only our own export shape: { app: "contacts", ver,
  // labels, contacts, deleted }. Runs through mergeContacts (union
  // by id, bigger mtime wins, tombstones honored — the SAME
  // contract as a cloud pull) and lands via setFromSync, so a
  // restore can never overwrite newer local edits and can never
  // resurrect phantom deletes. restore == cloud pull, by design.
  function importJsonFile(file) {
    if (!file) return;
    var fr = new FileReader();
    fr.onload = function () {
      try {
        var d = JSON.parse(fr.result);
        if (!d || typeof d !== "object" || d.app !== "contacts" ||
            !Array.isArray(d.contacts)) {
          notifyTransient(t("ct.import.json.bad"));
          return;
        }
        var local = null;
        try { local = JSON.parse(localStorage.getItem(DATA_KEY)); } catch (e) {}
        var merged = mergeContacts(
          local || { ver: 1, labels: [], contacts: [], deleted: [] }, d);
        setFromSync(merged);
        saveState();   // persist + markDirty → restore pushes to cloud
        notifyTransient(t("ct.import.json.done")
          .replace("{n}", String(state.contacts.length)));
      } catch (e) {
        console.error("contacts: JSON restore failed:", e);
        notifyTransient(t("ct.import.json.bad"));
      }
    };
    fr.onerror = function () { notifyTransient(t("ct.import.bad")); };
    fr.readAsText(file, "utf-8");
  }
  // Hidden file input + injected button (mirror of the export
  // injection — no contacts.html edit required).
  if ($("ct-export")) {
    var jsonImpIn = document.createElement("input");
    jsonImpIn.type = "file";
    jsonImpIn.accept = "application/json,.json";
    jsonImpIn.style.display = "none";
    document.body.appendChild(jsonImpIn);
    jsonImpIn.addEventListener("change", function () {
      var f = this.files && this.files[0];
      this.value = "";                    // allow re-import of same file
      importJsonFile(f);
    });
    var jsonImpBtn = document.createElement("button");
    jsonImpBtn.type = "button";
    jsonImpBtn.className = $("ct-export").className;
    jsonImpBtn.textContent = t("ct.import.json");
    jsonImpBtn.addEventListener("click", function () {
      var dlg = dialogHost();
      if (dlg && typeof dlg.openFile === "function") {
        dlg.openFile("application/json,.json")
          .then(function (f) { if (f) importJsonFile(f); });
        return;                     // cancel (null) = silent exit
      }
      jsonImpIn.click();            // standalone: legacy hidden input
    });
    // Anchor: AFTER the Export JSON button (jsonBtn) — final order
    // [Export] [Export JSON] [Import JSON].
    $("ct-export").parentNode.insertBefore(jsonImpBtn, jsonBtn.nextSibling);
  }

// ===== SYNC =====

  /* ---------- 8. Merge + register ----------
     mergeContacts: exact mirror of the calendar's mergeCalendars
     contract — union-by-id, per-entity bigger-mtime wins, tie →
     lexicographic JSON, survivors clear their tombstones, sorted
     output, NO Date.now() inside the merge (determinism R5). */

  function mergeEntity(a, b) {
    if (!a) return b;
    if (!b) return a;
    if (b.mtime > a.mtime) return b;
    if (a.mtime > b.mtime) return a;
    return JSON.stringify(a) <= JSON.stringify(b) ? a : b;   // tie
  }

  function mergeContacts(local, remote) {
    if (!remote || typeof remote !== "object") return local;
    if (!local || typeof local !== "object") return remote;

    var tomb = {};
    var a = local.deleted || [], b = remote.deleted || [];
    a.concat(b).forEach(function (d) {
      if (!d || !d.id) return;
      if (!tomb[d.id] || d.mtime > tomb[d.id].mtime) tomb[d.id] = d;
    });

    function alive(entity) {
      var t = tomb[entity.id];
      if (!t) return true;
      return entity.mtime > t.mtime;          // edit outranks delete
    }

    function unionById(listA, listB, mergeFn) {
      var map = {}, mf = mergeFn || mergeEntity;
      (listA || []).forEach(function (x) { if (x && x.id) map[x.id] = x; });
      (listB || []).forEach(function (x) { if (x && x.id) map[x.id] = mf(map[x.id], x); });
      return Object.keys(map).map(function (k) { return map[k]; })
        .filter(alive)
        .sort(function (x, y) { return x.id < y.id ? -1 : (x.id > y.id ? 1 : 0); });
    }

    var merged = {
      ver: 1,
      labels:   unionById(local.labels, remote.labels),
      contacts: unionById(local.contacts, remote.contacts, MG ? MG.mergeContact : null),
      deleted:  Object.keys(tomb).map(function (k) { return tomb[k]; })
                  .sort(function (x, y) { return x.id < y.id ? -1 : (x.id > y.id ? 1 : 0); })
    };
    return merged;
  }

  // CT-7: canonical form of the slice — exactly what mergeContacts
  // returns for (x, x): one entry per id, sorted by id, tombstones
  // deduped (max) and applied. The getter returns this, so
  // merge(get, get) === get and two devices stop re-uploading (R26).
  function canonContacts(d) {
    if (!d || typeof d !== "object") return d;
    return mergeContacts(d, d);
  }

  // setFromSync: adopt externally-provided data (a pull, or a JSON
  // restore). CT-1: the merged data is PERSISTED here (no markDirty,
  // R6). It used to live in memory only, while the sync getter reads
  // localStorage: with the app open, a pulled contact never reached
  // storage, every upload carried the stale local copy, and two open
  // devices replaced each other's contacts in the cloud forever.
  // CT-2: a pull no longer closes the open dialogs (typed text was
  // lost on every auto-sync); the edit dialog saves only the fields
  // the user changed (see ct-save), the view card is redrawn from
  // the merged data, filters and Undo survive.
  function setFromSync(data, info) {
    if (!data || typeof data !== "object") return;
    if (Array.isArray(data.contacts)) {
      state.contacts = data.contacts.map(sanitizeContact).filter(Boolean);
    }
    if (Array.isArray(data.labels)) {
      var sl = data.labels.map(sanitizeLabel).filter(Boolean);
      if (sl.length) state.labels = sl;
    }
    if (Array.isArray(data.deleted)) {
      state.deleted = data.deleted.map(sanitizeTomb).filter(Boolean);
    }
    try { localStorage.setItem(DATA_KEY, JSON.stringify(state)); } catch (e) {
      console.error("contacts: could not store synced data:", e);
    }
    if ($("ct-view") && viewCardId) {
      var vc = contactById(viewCardId);
      if (vc) openViewCard(vc); else closeViewCard();
    }
    if ($("lbl-dlg") && $("lbl-dlg").open &&
        !($("lbl-list") && $("lbl-list").contains(document.activeElement))) {
      renderLblList();
    }
    if ($("ct-dlg") && $("ct-dlg").open) renderDlgLabels();
    renderChips();
    renderList();
    // info.merged → sync dot (taskbar), not toast (Wave 11 doctrine)
  }

  // Edits made in the phone's contacts app (BR-PHONE v2): phone.js
  // writes them to the blob, then this open copy re-reads it the way
  // it adopts a pull (open dialogs and filters survive).
  // CT-PF: phone.js knows only mtime. A contact it just changed is
  // newer than all of its field stamps; with the earlier copy still
  // in memory, only the fields that really changed get the new stamp
  // (otherwise mtime would speak for every field of it).
  window.__orosPhoneReload = function (kind) {
    if (kind !== "contacts") return;
    var d = null;
    try { d = JSON.parse(localStorage.getItem(DATA_KEY)); } catch (e) { d = null; }
    if (!(d && typeof d === "object" && Array.isArray(d.contacts))) return;
    var fixed = false;
    if (MG) {
      d.contacts = d.contacts.map(function (raw) {
        var c = sanitizeContact(raw);
        if (!c || !c.fm || !MG.touchedByOldCode(c)) return raw;
        var prev = contactById(c.id);
        if (!prev) return raw;
        MG.restamp(JSON.parse(JSON.stringify(prev)), c, c.mtime);
        fixed = true;
        return c;
      });
    }
    setFromSync(d);
    if (fixed) markDirty();
  };

  // Canonical sync bridge — Contract B funnel. Live registration
  // with mergeFn means: closed-app proxies, offline divergence
  // guard, carry mailbox flush and register-pull all work for this
  // app with ZERO extra code (sync.js v0.6–v0.9 contracts).
  var syncApi = null;
  try { syncApi = window.parent && window.parent.orosSync; } catch (e) { syncApi = null; }
  if (syncApi && typeof syncApi.registerSlice === "function") {
    try {
      syncApi.registerSlice(
        "contacts",
        function () {
          try { return canonContacts(JSON.parse(localStorage.getItem(DATA_KEY))); }
          catch (e) { return null; }
        },
        setFromSync,
        DATA_KEY,
        mergeContacts
      );
    } catch (e) { console.warn("contacts: sync registration failed:", e); }
    // Bridge the funnel the shell routes app dirty-calls through.
    try {
      window.__orosSyncApi = {
        dirty: function () { syncApi.markDirty(); },
        pull: function () { return syncApi.pull(); },
        push: function () { return syncApi.push(); }
      };
    } catch (e) {}
  }

// ===== BOOT =====

  /* ---------- 9. Boot sequence ---------- */
  loadState();
  reseedSeedNames();
  applyI18n();
  renderChips();
  renderList();
  setTimeout(shrinkPhotos, 1500);   // CT-PS

  // Wave 2.1 — the shell staged a contact deep-link while we were
  // closed (sessionStorage, one-shot take). Runs AFTER render so the
  // list is already painted behind the opening dialog.
  try {
    if (window.parent &&
        typeof window.parent.__orosContactsTakePending === "function") {
      var pending = window.parent.__orosContactsTakePending();
      if (pending) window.__orosContactsOpen(pending);
    }
    if (window.parent && window.parent !== window &&
        typeof window.parent.__orosTakeTarget === "function") {
      var target = window.parent.__orosTakeTarget("contacts");
      if (target) window.__orosOpenAt(target);
    }
  } catch (e) {}

  console.log("contacts.js v" + (SCRIPT_V || "?") + " ready · " +
              state.contacts.length + " contact(s), " +
              state.labels.length + " label(s)");

})();