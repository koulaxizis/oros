// ============================================================
// orOS Email Signature — App logic (v1.0.0)
// Make an email signature once and use it in any mail app: Gmail,
// Outlook, Thunderbird, Apple Mail, phones and orOS Mail.
//   - your details, filled in by hand or from Invoices (business
//     profile), Contacts (a card) and Atelier (brand kit)
//   - six layouts, colours, email-safe fonts, logo + photo, social
//     profiles, a button, a dated banner, a vCard QR code, legal text
//   - live preview (light / dark mail app, phone width, short version)
//   - Copy (rich text), Copy HTML code, Save .html / .txt, Use in
//     orOS Mail (BR-MAIL-SIG), signatures for a team (CSV → .zip)
//   - checks (links, contrast, Gmail's size limit, pictures that a
//     web mail app would drop) and the steps for each mail app
// Data: synced slice "signature" (oros-signature-data, core.js);
// pictures on the orOS disk through designkit/assets.js (R30).
// Sections:
//   1. Constants, i18n, helpers
//   2. State + storage
//   3. Pictures (orOS disk → data: URL), icons, QR code
//   4. The form
//   5. Pictures, social profiles
//   6. Preview, checks, steps
//   7. Copy, save, orOS Mail
//   8. Fill in from orOS apps
//   9. Dialogs: more, team, pick, ask
//  10. Sync slice, palette, deep link
//  11. Wiring & boot
// ============================================================
(function () {
  "use strict";

  var C = window.SignatureCore;

  // ---------- 1. Constants, i18n, helpers ----------
  function appLang() {
    try {
      var l = localStorage.getItem("oros-lang") || (window.parent && window.parent.orosLang) || "en";
      return l === "el" ? "el" : "en";
    } catch (e) { return "en"; }
  }
  // "en", "el" or a pack language (i18n/<code>/signature.js).
  var LANG = window.orosI18n ? window.orosI18n.lang() : appLang();
  function loc() { return window.orosI18n ? window.orosI18n.locale(LANG) : (LANG === "el" ? "el-GR" : "en-GB"); }

  var STRINGS = {
    en: {
      "app.name": "Email Signature",
      "f.pick": "Signature", "btn.new": "New signature", "btn.more": "More",
      "tab.edit": "Edit", "tab.use": "Preview and use",
      "empty": "No signature yet. Make your first one: fill in your details, pick a look, and copy it into your mail.",
      "btn.first": "Make a signature",
      "sec.fill": "Fill in from orOS", "fill.inv": "Business profile (Invoices)", "fill.ct": "A contact", "fill.brand": "Brand kit (Atelier)",
      "fill.none": "When you use Invoices, Contacts or Atelier, their details can fill this in with one tap.",
      "sec.details": "Your details", "f.nm": "Name of this signature", "f.lang": "Language of the signature",
      "f.name": "Full name", "f.pron": "Pronouns", "f.title": "Job title", "f.dept": "Department", "f.company": "Company",
      "f.vat": "VAT number", "f.phone": "Phone", "f.mobile": "Mobile", "f.email": "Email", "f.web": "Website",
      "f.addr": "Address", "f.line": "Short line (slogan, hours, a quote)",
      "ph.nm": "Work", "ph.pron": "she/her", "ph.web": "example.com",
      "sec.look": "Look", "f.tpl": "Layout",
      "tpl.classic": "Classic", "tpl.side": "Picture on the side", "tpl.minimal": "Minimal", "tpl.bar": "Colour bar",
      "tpl.compact": "Compact", "tpl.plain": "Text only",
      "f.acc": "Main colour", "f.txt": "Text colour", "f.font": "Font", "f.size": "Text size",
      "f.lab": "Before phone and email", "lab.l": "Letters (T, M, E)", "lab.w": "Words (Phone, Email)", "lab.n": "Nothing",
      "f.shape": "Photo shape", "shape.square": "Square", "shape.round": "Round",
      "f.div": "Divider line", "f.icons": "Social icons (instead of names)",
      "sec.pics": "Logo and photo",
      "pics.hint": "Pictures stay on your orOS disk and are put inside the signature. Gmail and Outlook on the web drop pictures put inside a signature: for those, also give the address of the picture on your own website.",
      "pic.logo": "Logo", "pic.photo": "Photo", "pic.ban": "Banner picture",
      "pic.choose": "Choose a picture", "pic.brand": "From the brand kit", "pic.remove": "Remove",
      "pic.url": "Address on your website (https://…)", "pic.width": "Width", "pic.none": "No picture",
      "pic.missing": "Not on this device yet", "pic.webOnly": "Only on your website",
      "sec.social": "Social profiles and button", "btn.addSocial": "Add a profile", "so.url": "Profile address",
      "so.other": "Other link", "f.ctaT": "Button text", "f.ctaU": "Button link (booking page, shop…)",
      "sec.banner": "Banner",
      "banner.hint": "A picture under the signature for an offer, an event or a new product. It shows only between the two dates (leave them empty for always).",
      "f.banLink": "Banner link", "f.banFrom": "From", "f.banTo": "Until",
      "sec.extra": "QR code and legal text", "f.qr": "A QR code with my contact card (vCard)",
      "f.legal": "Legal text or disclaimer", "legal.presets": "Ready texts",
      "legal.conf": "Confidential", "legal.gdpr": "Personal data (GDPR)", "legal.env": "Think before you print", "legal.hours": "Not urgent outside hours",
      "f.target": "Where will you use it?", "tg.outlookweb": "Outlook (new, web)", "tg.outlook": "Outlook classic (Windows)",
      "tg.apple": "Apple Mail", "tg.oros": "orOS Mail", "tg.other": "Another app or phone",
      "pv.short": "Short version (for replies)", "pv.dark": "Dark mail app", "pv.phone": "Phone width",
      "pv.to": "To", "pv.toWho": "a client", "pv.body": "Hello,\n\nThank you for your message. I will get back to you soon.\n\nKind regards,",
      "btn.copy": "Copy signature", "btn.mail": "Use in orOS Mail", "btn.code": "Copy HTML code",
      "btn.html": "Save .html", "btn.txt": "Save .txt",
      "sec.check": "Check", "sec.steps": "How to add it",
      "more.title": "Signatures", "btn.dup": "Duplicate this signature", "btn.team": "Signatures for a team (CSV)…",
      "btn.del": "Delete this signature",
      "btn.osave": "orOS file (.orossignature)", "btn.oopen": "Open orOS file…", "btn.ofolder": "Unzipped orOS folder…",
      "more.hint": "Your signatures follow you to every device through orOS sync, encrypted. Their pictures travel with your orOS disk.",
      "team.title": "Signatures for a team",
      "team.hint": "One signature per person, with the look, company details and pictures of the signature open now. Paste a table (CSV) with a header row: name, title, department, email, phone, mobile, pronouns, photo (an https address).",
      "team.csv": "Table (CSV)", "btn.openCsv": "Open a CSV file", "btn.sample": "Save an example", "btn.zip": "Save all as .zip",
      "team.count": "{n} people · columns: {cols}", "team.count1": "1 person · columns: {cols}",
      // team.sample: the example CSV. Keep its header row in English (or
      // Greek): the team reader knows only those column names.
      "team.sample": "name,title,department,email,phone,mobile,photo\nMaria Smith,Sales Manager,Sales,maria@example.com,+44 20 0000 0000,+44 7700 000000,\nNick Jones,Accountant,Finance,nick@example.com,+44 20 0000 0001,,\n",
      "team.sampleFile": "team",
      "team.noname": "The table needs a \"name\" column in its first row.", "team.empty": "Paste a table with a header row and one row per person.",
      "btn.cancel": "Cancel", "btn.delete": "Delete", "btn.close": "Close", "btn.undo": "Undo", "btn.use": "Use",
      "ask.del": "Delete the signature \"{name}\"? This removes it from all your devices.",
      "pick.ct": "Fill in from a contact", "pick.inv": "Which business profile?", "pick.logo": "Which logo?", "pick.q": "Search",
      "pick.none": "Nothing here.", "pick.main": "Main profile",
      "untitled": "Signature", "copyOf": "(copy)",
      "toast.copied": "Copied. Now paste it into your mail app's signature box.", "toast.codeCopied": "HTML code copied",
      "toast.copyFail": "Copying did not work here. Save the .html file instead.",
      "toast.saved": "Saved", "toast.saveFail": "Could not save on this device (storage full?)",
      "toast.full": "You have 30 signatures. Delete one first.", "toast.deleted": "Signature deleted",
      "toast.filled": "Filled in from {app}", "toast.nofs": "Pictures need the orOS disk: open the app inside orOS.",
      "toast.badImg": "That file is not a picture orOS can read.", "toast.mailSent": "Opened in orOS Mail: pick the account there.",
      "toast.nothing": "Nothing to fill in yet.", "toast.zip": "Saved {n} signatures",
      "toast.dup": "Copy made", "toast.badUrl": "That address does not look like an https web address.",
      "chk.ok": "Looks good.",
      "chk.noname": "Add your name or your company.", "chk.bademail": "The email address does not look right.",
      "chk.badweb": "The website address does not look right.",
      "chk.badphone": "A phone number has letters or is too short, so it will not be a link to call.",
      "chk.lowacc": "The main colour is pale on a white background; text in it is hard to read.",
      "chk.lowtxt": "The text colour is pale on a white background.",
      "chk.needurl.logo": "This mail app drops pictures put inside a signature: give the logo's address on your website, or it is left out.",
      "chk.needurl.photo": "This mail app drops pictures put inside a signature: give the photo's address on your website, or it is left out.",
      "chk.needurl.ban": "This mail app drops pictures put inside a signature: give the banner's address on your website, or it is left out.",
      "chk.noqrweb": "The QR code is a picture made here, so web mail apps leave it out. It is in the .html file and in orOS Mail.",
      "chk.iconsweb": "Social icons are pictures made here, so this mail app shows the names instead.",
      "chk.banoff": "The banner is outside its dates, so it is not shown today.",
      "chk.gmail": "{n} characters: Gmail takes at most 10,000. Use smaller or fewer pictures, or shorter legal text.",
      "chk.big": "{n} characters: a large signature makes every message heavier. Use smaller pictures.",
      "chk.longlegal": "Long legal text: many people never read it. Keep the part that matters.",
      "chk.round": "Outlook classic shows round photos as squares when the photo comes from your website.",
      "steps.gmail.a": "Press `Copy signature` here.",
      "steps.gmail.b": "In Gmail open Settings (the gear) › See all settings › General › Signature, and press Create new.",
      "steps.gmail.c": "Click in the big box and paste (Ctrl+V).",
      "steps.gmail.d": "Under Signature defaults pick it for new emails and replies, then press Save Changes at the bottom.",
      "steps.gmail.e": "Gmail on the phone uses its own plain-text signature: open its settings and paste the .txt text there.",
      "steps.outlookweb.a": "Press `Copy signature` here.",
      "steps.outlookweb.b": "In Outlook open Settings › Account › Signatures (on older versions: Mail › Compose and reply).",
      "steps.outlookweb.c": "Give the signature a name, click in the box and paste (Ctrl+V).",
      "steps.outlookweb.d": "Pick it for new messages and replies, then press Save.",
      "steps.outlook.a": "Press `Copy signature` here.",
      "steps.outlook.b": "In Outlook open File › Options › Mail › Signatures…, press New and give it a name.",
      "steps.outlook.c": "Click in the Edit signature box and paste (Ctrl+V), then press OK.",
      "steps.outlook.d": "Or: `Save .html`, then put the file in %APPDATA%\\Microsoft\\Signatures. Its file name is the signature's name in Outlook.",
      "steps.thunderbird.a": "Press `Save .html` here.",
      "steps.thunderbird.b": "In Thunderbird open Account Settings and choose your account.",
      "steps.thunderbird.c": "Tick \"Attach the signature from a file instead\" and choose the .html file.",
      "steps.thunderbird.d": "Or: tick \"Use HTML\", then `Copy HTML code` here and paste it into the Signature text box.",
      "steps.apple.a": "Press `Copy signature` here.",
      "steps.apple.b": "In Mail open Mail › Settings › Signatures and press + under the account.",
      "steps.apple.c": "Untick \"Always match my default message font\", then paste (Cmd+V) into the right side.",
      "steps.apple.d": "On an iPhone: Settings › Apps › Mail › Signature, and paste there.",
      "steps.oros.a": "Press `Use in orOS Mail` here.",
      "steps.oros.b": "orOS Mail opens and asks which account gets the signature.",
      "steps.oros.c": "Press Use. New messages and replies from that account get it at once, on all your devices.",
      "steps.other.a": "Most mail apps on a phone take only plain text: press `Save .txt` or copy the text from the file.",
      "steps.other.b": "Desktop apps that take formatting: press `Copy signature` and paste it into their signature settings.",
      "steps.other.c": "Apps that take an HTML file: press `Save .html`.",
      "legal.conf.t": "This email and any attachments are confidential and meant only for the person they are addressed to. If you received it by mistake, please tell the sender and delete it.",
      "legal.gdpr.t": "We process personal data according to the GDPR (EU 2016/679). You can ask to see, correct or delete your data at any time by replying to this email.",
      "legal.env.t": "Please think of the environment before printing this email.",
      "legal.hours.t": "I may send emails outside working hours. Please do not feel you have to reply outside yours.",
      "aria.so.kind": "Kind of profile", "aria.so.del": "Remove this profile",
      "standalone": "Open Email Signature inside orOS to keep pictures and sync."
    },
    el: {
      "app.name": "Υπογραφή email",
      "f.pick": "Υπογραφή", "btn.new": "Νέα υπογραφή", "btn.more": "Περισσότερα",
      "tab.edit": "Επεξεργασία", "tab.use": "Προβολή και χρήση",
      "empty": "Δεν υπάρχει ακόμα υπογραφή. Φτιάξε την πρώτη: συμπλήρωσε τα στοιχεία σου, διάλεξε εμφάνιση και αντίγραψέ τη στο email σου.",
      "btn.first": "Φτιάξε υπογραφή",
      "sec.fill": "Συμπλήρωση από το orOS", "fill.inv": "Επιχειρηματικό προφίλ (Τιμολόγια)", "fill.ct": "Μια επαφή", "fill.brand": "Brand kit (Atelier)",
      "fill.none": "Όταν χρησιμοποιείς Τιμολόγια, Επαφές ή Atelier, τα στοιχεία τους συμπληρώνουν την υπογραφή με ένα πάτημα.",
      "sec.details": "Τα στοιχεία σου", "f.nm": "Όνομα αυτής της υπογραφής", "f.lang": "Γλώσσα της υπογραφής",
      "f.name": "Ονοματεπώνυμο", "f.pron": "Αντωνυμίες", "f.title": "Θέση", "f.dept": "Τμήμα", "f.company": "Εταιρεία",
      "f.vat": "ΑΦΜ", "f.phone": "Τηλέφωνο", "f.mobile": "Κινητό", "f.email": "Email", "f.web": "Ιστότοπος",
      "f.addr": "Διεύθυνση", "f.line": "Σύντομη φράση (σύνθημα, ωράριο, ένα απόφθεγμα)",
      "ph.nm": "Δουλειά", "ph.pron": "αυτή/της", "ph.web": "example.gr",
      "sec.look": "Εμφάνιση", "f.tpl": "Διάταξη",
      "tpl.classic": "Κλασική", "tpl.side": "Εικόνα στο πλάι", "tpl.minimal": "Λιτή", "tpl.bar": "Χρωματιστή μπάρα",
      "tpl.compact": "Μικρή", "tpl.plain": "Μόνο κείμενο",
      "f.acc": "Κύριο χρώμα", "f.txt": "Χρώμα κειμένου", "f.font": "Γραμματοσειρά", "f.size": "Μέγεθος κειμένου",
      "f.lab": "Πριν από τηλέφωνο και email", "lab.l": "Γράμματα (Τ, Κ, E)", "lab.w": "Λέξεις (Τηλ., Email)", "lab.n": "Τίποτα",
      "f.shape": "Σχήμα φωτογραφίας", "shape.square": "Τετράγωνο", "shape.round": "Στρογγυλό",
      "f.div": "Διαχωριστική γραμμή", "f.icons": "Εικονίδια κοινωνικών δικτύων (αντί για ονόματα)",
      "sec.pics": "Λογότυπο και φωτογραφία",
      "pics.hint": "Οι εικόνες μένουν στον δίσκο του orOS και μπαίνουν μέσα στην υπογραφή. Το Gmail και το Outlook στο web πετάνε τις εικόνες που είναι μέσα σε υπογραφή: γι' αυτά δώσε και τη διεύθυνση της εικόνας στον δικό σου ιστότοπο.",
      "pic.logo": "Λογότυπο", "pic.photo": "Φωτογραφία", "pic.ban": "Εικόνα banner",
      "pic.choose": "Διάλεξε εικόνα", "pic.brand": "Από το brand kit", "pic.remove": "Αφαίρεση",
      "pic.url": "Διεύθυνση στον ιστότοπό σου (https://…)", "pic.width": "Πλάτος", "pic.none": "Χωρίς εικόνα",
      "pic.missing": "Δεν έχει έρθει ακόμα σε αυτή τη συσκευή", "pic.webOnly": "Μόνο στον ιστότοπό σου",
      "sec.social": "Κοινωνικά δίκτυα και κουμπί", "btn.addSocial": "Προσθήκη προφίλ", "so.url": "Διεύθυνση προφίλ",
      "so.other": "Άλλος σύνδεσμος", "f.ctaT": "Κείμενο κουμπιού", "f.ctaU": "Σύνδεσμος κουμπιού (σελίδα ραντεβού, κατάστημα…)",
      "sec.banner": "Banner",
      "banner.hint": "Μια εικόνα κάτω από την υπογραφή για μια προσφορά, μια εκδήλωση ή ένα νέο προϊόν. Εμφανίζεται μόνο ανάμεσα στις δύο ημερομηνίες (άφησέ τες κενές για πάντα).",
      "f.banLink": "Σύνδεσμος banner", "f.banFrom": "Από", "f.banTo": "Έως",
      "sec.extra": "QR code και νομικό κείμενο", "f.qr": "Ένα QR code με την κάρτα επαφής μου (vCard)",
      "f.legal": "Νομικό κείμενο ή αποποίηση ευθύνης", "legal.presets": "Έτοιμα κείμενα",
      "legal.conf": "Εμπιστευτικό", "legal.gdpr": "Προσωπικά δεδομένα (GDPR)", "legal.env": "Σκέψου πριν εκτυπώσεις", "legal.hours": "Όχι επείγον εκτός ωραρίου",
      "f.target": "Πού θα τη χρησιμοποιήσεις;", "tg.outlookweb": "Outlook (νέο, web)", "tg.outlook": "Outlook classic (Windows)",
      "tg.apple": "Apple Mail", "tg.oros": "Mail του orOS", "tg.other": "Άλλη εφαρμογή ή κινητό",
      "pv.short": "Σύντομη εκδοχή (για απαντήσεις)", "pv.dark": "Σκοτεινή εφαρμογή email", "pv.phone": "Πλάτος κινητού",
      "pv.to": "Προς", "pv.toWho": "έναν πελάτη", "pv.body": "Καλησπέρα σας,\n\nΣας ευχαριστώ για το μήνυμά σας. Θα επικοινωνήσω σύντομα μαζί σας.\n\nΜε εκτίμηση,",
      "btn.copy": "Αντιγραφή υπογραφής", "btn.mail": "Χρήση στο Mail του orOS", "btn.code": "Αντιγραφή κώδικα HTML",
      "btn.html": "Αποθήκευση .html", "btn.txt": "Αποθήκευση .txt",
      "sec.check": "Έλεγχος", "sec.steps": "Πώς την προσθέτεις",
      "more.title": "Υπογραφές", "btn.dup": "Αντίγραφο αυτής της υπογραφής", "btn.team": "Υπογραφές για ομάδα (CSV)…",
      "btn.del": "Διαγραφή αυτής της υπογραφής",
      "btn.osave": "Αρχείο orOS (.orossignature)", "btn.oopen": "Άνοιγμα αρχείου orOS…", "btn.ofolder": "Αποσυμπιεσμένος φάκελος orOS…",
      "more.hint": "Οι υπογραφές σου σε ακολουθούν σε κάθε συσκευή μέσω του sync του orOS, κρυπτογραφημένες. Οι εικόνες τους ταξιδεύουν με τον δίσκο του orOS.",
      "team.title": "Υπογραφές για ομάδα",
      "team.hint": "Μία υπογραφή για κάθε άτομο, με την εμφάνιση, τα στοιχεία της εταιρείας και τις εικόνες της υπογραφής που είναι ανοιχτή τώρα. Επικόλλησε έναν πίνακα (CSV) με γραμμή επικεφαλίδων: όνομα, θέση, τμήμα, email, τηλέφωνο, κινητό, αντωνυμίες, φωτογραφία (μια διεύθυνση https).",
      "team.csv": "Πίνακας (CSV)", "btn.openCsv": "Άνοιγμα αρχείου CSV", "btn.sample": "Αποθήκευση παραδείγματος", "btn.zip": "Αποθήκευση όλων σε .zip",
      "team.count": "{n} άτομα · στήλες: {cols}", "team.count1": "1 άτομο · στήλες: {cols}",
      "team.sample": "όνομα,θέση,τμήμα,email,τηλέφωνο,κινητό,φωτογραφία\nΜαρία Παπαδοπούλου,Υπεύθυνη Πωλήσεων,Πωλήσεις,maria@example.gr,+30 210 0000000,+30 690 0000000,\nΝίκος Γεωργίου,Λογιστής,Λογιστήριο,nikos@example.gr,+30 210 0000001,,\n",
      "team.sampleFile": "ομάδα",
      "team.noname": "Ο πίνακας θέλει μια στήλη «όνομα» (ή «name») στην πρώτη γραμμή.", "team.empty": "Επικόλλησε έναν πίνακα με γραμμή επικεφαλίδων και μία γραμμή για κάθε άτομο.",
      "btn.cancel": "Άκυρο", "btn.delete": "Διαγραφή", "btn.close": "Κλείσιμο", "btn.undo": "Αναίρεση", "btn.use": "Χρήση",
      "ask.del": "Διαγραφή της υπογραφής «{name}»; Θα φύγει από όλες τις συσκευές σου.",
      "pick.ct": "Συμπλήρωση από επαφή", "pick.inv": "Ποιο επιχειρηματικό προφίλ;", "pick.logo": "Ποιο λογότυπο;", "pick.q": "Αναζήτηση",
      "pick.none": "Δεν υπάρχει τίποτα εδώ.", "pick.main": "Κύριο προφίλ",
      "untitled": "Υπογραφή", "copyOf": "(αντίγραφο)",
      "toast.copied": "Αντιγράφηκε. Τώρα επικόλλησέ τη στο πεδίο υπογραφής της εφαρμογής email σου.", "toast.codeCopied": "Ο κώδικας HTML αντιγράφηκε",
      "toast.copyFail": "Η αντιγραφή δεν δούλεψε εδώ. Αποθήκευσε το αρχείο .html.",
      "toast.saved": "Αποθηκεύτηκε", "toast.saveFail": "Δεν έγινε αποθήκευση σε αυτή τη συσκευή (γέμισε ο χώρος;)",
      "toast.full": "Έχεις 30 υπογραφές. Διάγραψε πρώτα μία.", "toast.deleted": "Η υπογραφή διαγράφηκε",
      "toast.filled": "Συμπληρώθηκε από: {app}", "toast.nofs": "Οι εικόνες θέλουν τον δίσκο του orOS: άνοιξε την εφαρμογή μέσα από το orOS.",
      "toast.badImg": "Αυτό το αρχείο δεν είναι εικόνα που διαβάζει το orOS.", "toast.mailSent": "Άνοιξε στο Mail του orOS: διάλεξε εκεί τον λογαριασμό.",
      "toast.nothing": "Δεν υπάρχει ακόμα κάτι για συμπλήρωση.", "toast.zip": "Αποθηκεύτηκαν {n} υπογραφές",
      "toast.dup": "Έγινε αντίγραφο", "toast.badUrl": "Αυτή δεν μοιάζει με διεύθυνση https.",
      "chk.ok": "Όλα δείχνουν σωστά.",
      "chk.noname": "Πρόσθεσε το όνομά σου ή την εταιρεία σου.", "chk.bademail": "Η διεύθυνση email δεν μοιάζει σωστή.",
      "chk.badweb": "Η διεύθυνση του ιστότοπου δεν μοιάζει σωστή.",
      "chk.badphone": "Ένα τηλέφωνο έχει γράμματα ή είναι πολύ μικρό, άρα δεν θα γίνει σύνδεσμος κλήσης.",
      "chk.lowacc": "Το κύριο χρώμα είναι αχνό σε λευκό φόντο· κείμενο με αυτό διαβάζεται δύσκολα.",
      "chk.lowtxt": "Το χρώμα του κειμένου είναι αχνό σε λευκό φόντο.",
      "chk.needurl.logo": "Αυτή η εφαρμογή πετάει τις εικόνες που είναι μέσα σε υπογραφή: δώσε τη διεύθυνση του λογοτύπου στον ιστότοπό σου, αλλιώς παραλείπεται.",
      "chk.needurl.photo": "Αυτή η εφαρμογή πετάει τις εικόνες που είναι μέσα σε υπογραφή: δώσε τη διεύθυνση της φωτογραφίας στον ιστότοπό σου, αλλιώς παραλείπεται.",
      "chk.needurl.ban": "Αυτή η εφαρμογή πετάει τις εικόνες που είναι μέσα σε υπογραφή: δώσε τη διεύθυνση του banner στον ιστότοπό σου, αλλιώς παραλείπεται.",
      "chk.noqrweb": "Το QR code είναι εικόνα που φτιάχνεται εδώ, οπότε οι εφαρμογές web το παραλείπουν. Υπάρχει στο αρχείο .html και στο Mail του orOS.",
      "chk.iconsweb": "Τα εικονίδια κοινωνικών δικτύων είναι εικόνες που φτιάχνονται εδώ, οπότε αυτή η εφαρμογή δείχνει τα ονόματα.",
      "chk.banoff": "Το banner είναι εκτός ημερομηνιών, οπότε δεν εμφανίζεται σήμερα.",
      "chk.gmail": "{n} χαρακτήρες: το Gmail δέχεται έως 10.000. Βάλε μικρότερες ή λιγότερες εικόνες ή συντόμευσε το νομικό κείμενο.",
      "chk.big": "{n} χαρακτήρες: μια μεγάλη υπογραφή βαραίνει κάθε μήνυμα. Βάλε μικρότερες εικόνες.",
      "chk.longlegal": "Μεγάλο νομικό κείμενο: πολλοί δεν το διαβάζουν ποτέ. Κράτα ό,τι μετράει.",
      "chk.round": "Το Outlook classic δείχνει τις στρογγυλές φωτογραφίες τετράγωνες όταν η φωτογραφία έρχεται από τον ιστότοπό σου.",
      "steps.gmail.a": "Πάτα `Αντιγραφή υπογραφής` εδώ.",
      "steps.gmail.b": "Στο Gmail άνοιξε Ρυθμίσεις (το γρανάζι) › Εμφάνιση όλων των ρυθμίσεων › Γενικά › Υπογραφή και πάτα Δημιουργία νέας.",
      "steps.gmail.c": "Κάνε κλικ στο μεγάλο πλαίσιο και επικόλλησε (Ctrl+V).",
      "steps.gmail.d": "Στις Προεπιλογές υπογραφής διάλεξέ τη για νέα μηνύματα και απαντήσεις και πάτα Αποθήκευση αλλαγών στο κάτω μέρος.",
      "steps.gmail.e": "Το Gmail στο κινητό έχει δική του υπογραφή, μόνο κείμενο: άνοιξε τις ρυθμίσεις του και επικόλλησε εκεί το κείμενο του .txt.",
      "steps.outlookweb.a": "Πάτα `Αντιγραφή υπογραφής` εδώ.",
      "steps.outlookweb.b": "Στο Outlook άνοιξε Ρυθμίσεις › Λογαριασμός › Υπογραφές (σε παλιότερες εκδόσεις: Αλληλογραφία › Σύνταξη και απάντηση).",
      "steps.outlookweb.c": "Δώσε όνομα στην υπογραφή, κάνε κλικ στο πλαίσιο και επικόλλησε (Ctrl+V).",
      "steps.outlookweb.d": "Διάλεξέ τη για νέα μηνύματα και απαντήσεις και πάτα Αποθήκευση.",
      "steps.outlook.a": "Πάτα `Αντιγραφή υπογραφής` εδώ.",
      "steps.outlook.b": "Στο Outlook άνοιξε Αρχείο › Επιλογές › Αλληλογραφία › Υπογραφές…, πάτα Δημιουργία και δώσε της όνομα.",
      "steps.outlook.c": "Κάνε κλικ στο πλαίσιο Επεξεργασία υπογραφής, επικόλλησε (Ctrl+V) και πάτα OK.",
      "steps.outlook.d": "Ή: `Αποθήκευση .html` και βάλε το αρχείο στον φάκελο %APPDATA%\\Microsoft\\Signatures. Το όνομα του αρχείου γίνεται το όνομα της υπογραφής στο Outlook.",
      "steps.thunderbird.a": "Πάτα `Αποθήκευση .html` εδώ.",
      "steps.thunderbird.b": "Στο Thunderbird άνοιξε Ρυθμίσεις λογαριασμού και διάλεξε τον λογαριασμό σου.",
      "steps.thunderbird.c": "Τσέκαρε «Επισύναψη υπογραφής από αρχείο» και διάλεξε το αρχείο .html.",
      "steps.thunderbird.d": "Ή: τσέκαρε «Χρήση HTML», πάτα εδώ `Αντιγραφή κώδικα HTML` και επικόλλησέ τον στο πλαίσιο Κείμενο υπογραφής.",
      "steps.apple.a": "Πάτα `Αντιγραφή υπογραφής` εδώ.",
      "steps.apple.b": "Στο Mail άνοιξε Mail › Ρυθμίσεις › Υπογραφές και πάτα + κάτω από τον λογαριασμό.",
      "steps.apple.c": "Ξετσέκαρε «Πάντα ίδια με την προεπιλεγμένη γραμματοσειρά» και επικόλλησε (Cmd+V) δεξιά.",
      "steps.apple.d": "Σε iPhone: Ρυθμίσεις › Εφαρμογές › Mail › Υπογραφή και επικόλλησε εκεί.",
      "steps.oros.a": "Πάτα `Χρήση στο Mail του orOS` εδώ.",
      "steps.oros.b": "Ανοίγει το Mail του orOS και ρωτά ποιος λογαριασμός παίρνει την υπογραφή.",
      "steps.oros.c": "Πάτα Χρήση. Τα νέα μηνύματα και οι απαντήσεις από αυτόν τον λογαριασμό την παίρνουν αμέσως, σε όλες τις συσκευές σου.",
      "steps.other.a": "Οι περισσότερες εφαρμογές email στο κινητό δέχονται μόνο κείμενο: πάτα `Αποθήκευση .txt` ή αντίγραψε το κείμενο από το αρχείο.",
      "steps.other.b": "Εφαρμογές υπολογιστή που δέχονται μορφοποίηση: πάτα `Αντιγραφή υπογραφής` και επικόλλησέ τη στις ρυθμίσεις υπογραφής τους.",
      "steps.other.c": "Εφαρμογές που δέχονται αρχείο HTML: πάτα `Αποθήκευση .html`.",
      "legal.conf.t": "Το παρόν μήνυμα και τυχόν συνημμένα του είναι εμπιστευτικά και προορίζονται μόνο για τον παραλήπτη. Αν το λάβατε κατά λάθος, παρακαλούμε ενημερώστε τον αποστολέα και διαγράψτε το.",
      "legal.gdpr.t": "Επεξεργαζόμαστε προσωπικά δεδομένα σύμφωνα με τον ΓΚΠΔ (ΕΕ 2016/679). Μπορείτε οποτεδήποτε να ζητήσετε πρόσβαση, διόρθωση ή διαγραφή των δεδομένων σας απαντώντας σε αυτό το μήνυμα.",
      "legal.env.t": "Σκεφτείτε το περιβάλλον πριν εκτυπώσετε αυτό το μήνυμα.",
      "legal.hours.t": "Μπορεί να στέλνω μηνύματα εκτός ωραρίου. Δεν χρειάζεται να απαντήσετε εκτός του δικού σας.",
      "aria.so.kind": "Είδος προφίλ", "aria.so.del": "Αφαίρεση αυτού του προφίλ",
      "standalone": "Άνοιξε την Υπογραφή email μέσα από το orOS για εικόνες και sync."
    }
  };
  if (window.orosI18n) window.orosI18n.table(STRINGS, "signature", LANG);
  function t(k, vars) {
    var s = (STRINGS[LANG] && STRINGS[LANG][k] !== undefined) ? STRINGS[LANG][k] : (STRINGS.en[k] !== undefined ? STRINGS.en[k] : k);
    if (vars && typeof s === "string") s = s.replace(/\{(\w+)\}/g, function (m, n) { return vars[n] !== undefined ? vars[n] : m; });
    return s;
  }
  // Legal presets are written in the signature's language.
  function tIn(lang, k) { return (STRINGS[lang] && STRINGS[lang][k]) || STRINGS.en[k] || ""; }

  function $(id) { return document.getElementById(id); }
  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined && text !== null) n.textContent = text;
    return n;
  }
  function setLabel(btn, text) { btn.setAttribute("aria-label", text); btn.title = text; }
  function shell() {
    try { return window.parent && window.parent !== window ? window.parent : null; } catch (e) { return null; }
  }
  function installed(id) {
    var s = shell();
    try {
      if (!s || typeof s.orosAssistInstalled !== "function") return false;
      return s.orosAssistInstalled().some(function (a) { return a && a.id === id; });
    } catch (e) { return false; }
  }
  function todayKey() {
    var d = new Date();
    return d.getFullYear() + "-" + ("0" + (d.getMonth() + 1)).slice(-2) + "-" + ("0" + d.getDate()).slice(-2);
  }
  function readJSON(key) {
    try { var r = localStorage.getItem(key); return r ? JSON.parse(r) : null; } catch (e) { return null; }
  }

  var ICON = {
    plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>',
    more: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/></svg>',
    close: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>'
  };

  // ---------- 2. State + storage ----------
  var data = C.empty();
  var prefs = C.normPrefs(null);
  var sig = null;                    // the signature being edited (normalized)
  var saveTimer = 0, renderTimer = 0, renderSeq = 0;
  var built = null;                  // { html, text, mail } of the current preview

  function load() {
    try { data = C.parse(localStorage.getItem(C.DATA_KEY)); } catch (e) { data = C.empty(); }
    prefs = C.normPrefs(readJSON(C.PREFS_KEY));
  }
  function savePrefs() {
    try { localStorage.setItem(C.PREFS_KEY, JSON.stringify(prefs)); } catch (e) {}
  }
  function storeData() {
    try { localStorage.setItem(C.DATA_KEY, JSON.stringify(data)); }
    catch (e) { toast(t("toast.saveFail")); return false; }
    if (window.__orosSyncApi) window.__orosSyncApi.dirty();
    return true;
  }
  function saveSoon() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveNow, 400);
  }
  function saveNow() {
    clearTimeout(saveTimer);
    saveTimer = 0;
    if (!sig) return;
    var old = C.byId(data, sig.id);
    var a = JSON.parse(JSON.stringify(sig)), b = old ? JSON.parse(JSON.stringify(old)) : null;
    if (b) { a.m = b.m = 0; if (JSON.stringify(a) === JSON.stringify(b)) return; }
    var r = C.put(data, sig, Date.now());
    if (!r.ok) { if (r.why === "full") toast(t("toast.full")); return; }
    data = r.data;
    sig = r.sig;
    storeData();
    fillSelect();
  }
  function select(id) {
    if (saveTimer) saveNow();
    var s = C.byId(data, id) || data.sigs[0] || null;
    sig = s ? JSON.parse(JSON.stringify(s)) : null;
    prefs.cur = sig ? sig.id : "";
    savePrefs();
    fillSelect();
    renderForm();
    renderSoon(0);
  }
  function newSig() {
    if (data.sigs.length >= C.MAX_SIGS) { toast(t("toast.full")); return; }
    if (saveTimer) saveNow();
    var s = C.blank(C.newId(), Date.now(), LANG);
    // a new one keeps the look and company of the one open now
    if (sig) {
      s.st = JSON.parse(JSON.stringify(sig.st));
      s.tpl = sig.tpl;
      ["company", "vat", "phone", "web", "addr"].forEach(function (k) { s.f[k] = sig.f[k]; });
      if (sig.im.logo) s.im.logo = JSON.parse(JSON.stringify(sig.im.logo));
    }
    s.nm = t("untitled") + " " + (data.sigs.length + 1);
    var r = C.put(data, s, Date.now());
    if (!r.ok) return;
    data = r.data;
    storeData();
    select(r.sig.id);
    showTab("edit");
    $("f-name").focus();
  }

  // ---------- 3. Pictures (orOS disk → data: URL), icons, QR code ----------
  var AS = window.orosDK && window.orosDK.assets;
  var srcCache = {};                 // key → data: URL ("" = missing)
  function canvasOf(w, h) { var c = document.createElement("canvas"); c.width = w; c.height = h; return c; }
  // Encode small enough for a signature: PNG when it has see-through
  // parts (or round), else JPEG, quality lowered until it fits.
  function encode(cv, png) {
    if (png) {
      var p = cv.toDataURL("image/png");
      if (p.length <= 150000) return p;
    }
    var q = 0.88, out = cv.toDataURL("image/jpeg", q);
    while (out.length > 150000 && q > 0.4) { q -= 0.12; out = cv.toDataURL("image/jpeg", q); }
    return out.length <= 160000 ? out : "";
  }
  // kind: logo | photo | ban; w = shown width in px (drawn at 2× for sharp screens)
  function assetSrc(a, kind, w, round) {
    var key = a + "|" + kind + "|" + w + "|" + (round ? 1 : 0);
    if (key in srcCache) return Promise.resolve(srcCache[key]);
    if (!AS) return Promise.resolve("");
    return AS.load(a).then(function (img) {
      if (!img) { srcCache[key] = ""; return ""; }
      var nw = img.naturalWidth || img.width, nh = img.naturalHeight || img.height;
      var cv, ctx, out;
      if (kind === "photo") {
        var side = Math.min(nw, nh), s = Math.min(side, w * 2);
        cv = canvasOf(s, s); ctx = cv.getContext("2d");
        if (round) { ctx.beginPath(); ctx.arc(s / 2, s / 2, s / 2, 0, Math.PI * 2); ctx.closePath(); ctx.clip(); }
        ctx.drawImage(img, (nw - side) / 2, (nh - side) / 2, side, side, 0, 0, s, s);
        out = encode(cv, round || /\.png$/.test(a));
      } else {
        var cw = Math.min(nw, w * 2), ch = Math.max(1, Math.round(cw * nh / nw));
        cv = canvasOf(cw, ch); ctx = cv.getContext("2d");
        ctx.drawImage(img, 0, 0, cw, ch);
        out = encode(cv, /\.png$/.test(a));
      }
      srcCache[key] = out;
      return out;
    }, function () { return ""; });
  }
  // A social icon: the short mark on a circle of the main colour.
  function iconSrc(kind, color) {
    var key = "so|" + kind + "|" + color;
    if (srcCache[key]) return srcCache[key];
    var g = C.SOCIAL[kind] ? C.SOCIAL[kind].g : "?", s = 44, cv = canvasOf(s, s), ctx = cv.getContext("2d");
    ctx.fillStyle = color;
    ctx.beginPath(); ctx.arc(s / 2, s / 2, s / 2, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = C.contrast(color, "#ffffff") >= 2.4 ? "#ffffff" : "#1a1a1a";
    ctx.font = "bold " + (g.length > 1 ? 17 : 22) + "px Arial, Helvetica, sans-serif";
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText(g, s / 2, s / 2 + 1);
    return (srcCache[key] = cv.toDataURL("image/png"));
  }
  function qrSrc(s) {
    if (!window.orosQR) return "";
    var text = C.vcard(s), key = "qr|" + text;
    if (srcCache[key]) return srcCache[key];
    var q;
    try { q = window.orosQR.encode(text, { ecl: "M" }); } catch (e) { return ""; }
    var mg = 2, n = q.size + mg * 2, sc = Math.max(2, Math.floor(152 / n)), cv = canvasOf(n * sc, n * sc), ctx = cv.getContext("2d");
    ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, cv.width, cv.height);
    ctx.fillStyle = "#000000";
    for (var y = 0; y < q.size; y++) for (var x = 0; x < q.size; x++) if (q.modules[y][x]) ctx.fillRect((x + mg) * sc, (y + mg) * sc, sc, sc);
    return (srcCache[key] = cv.toDataURL("image/png"));
  }
  // Every picture a signature can show, ready for core.build().
  function resolveSrc(s) {
    var st = s.st, src = { social: {} };
    s.so.forEach(function (x) { src.social[x.k] = iconSrc(x.k, st.acc); });
    if (s.qr) src.qr = qrSrc(s);
    var jobs = [];
    function want(kind, w, round) {
      var im = s.im[kind];
      if (!im || !im.a) return;
      jobs.push(assetSrc(im.a, kind, w, round).then(function (u) { if (u) src[kind] = u; }));
    }
    want("logo", st.logoW, false);
    want("photo", Math.max(st.photoW, 48), st.shape === "round");
    if (s.im.ban) want("ban", s.im.ban.bw || 400, false);
    return Promise.all(jobs).then(function () { return src; });
  }
  if (AS && typeof AS.onChange === "function") AS.onChange(function () { srcCache = filterCache(); renderSoon(50); renderPics(); });
  function filterCache() { var o = {}; Object.keys(srcCache).forEach(function (k) { if (srcCache[k]) o[k] = srcCache[k]; }); return o; }

  // ---------- 4. The form ----------
  var TEXT_FIELDS = ["name", "pron", "title", "dept", "company", "vat", "phone", "mobile", "email", "web", "addr", "line", "legal"];

  function fillSelect() {
    var sel = $("sig-sel");
    sel.textContent = "";
    data.sigs.slice().sort(function (a, b) { return C.label(a, "").localeCompare(C.label(b, ""), loc()); }).forEach(function (s) {
      var o = el("option", null, C.label(s, t("untitled")));
      o.value = s.id;
      sel.appendChild(o);
    });
    sel.hidden = data.sigs.length < 1;
    if (sig) sel.value = sig.id;
    $("title-sub").textContent = sig ? C.label(sig, t("untitled")) : "";
    $("more-btn").hidden = !sig;
  }

  function renderForm() {
    var has = !!sig;
    $("empty-box").hidden = has;
    $("form").hidden = !has;
    $("out").classList.toggle("off", !has);
    if (!has) return;
    $("f-nm").value = sig.nm;
    $("f-lang").value = sig.lang;
    TEXT_FIELDS.forEach(function (k) { $("f-" + k).value = sig.f[k]; });
    var st = sig.st;
    $("f-acc").value = st.acc; $("f-txt").value = st.txt; $("f-font").value = st.font;
    $("f-size").value = st.size; $("o-size").textContent = st.size + " px";
    $("f-lab").value = st.lab; $("f-shape").value = st.shape;
    $("f-div").checked = !!st.div; $("f-icons").checked = !!st.icons;
    $("f-ctaT").value = sig.cta.t; $("f-ctaU").value = sig.cta.u;
    $("f-ctaT").placeholder = C.WORDS[sig.lang].cta;
    var b = sig.im.ban || {};
    $("f-banLink").value = b.link || ""; $("f-banFrom").value = b.from || ""; $("f-banTo").value = b.to || "";
    $("f-qr").checked = !!sig.qr;
    renderTpls();
    renderSocial();
    renderPics();
    renderFill();
  }

  // The form → sig (on every input). URLs are kept as typed while
  // typing and cleaned by the core when saved.
  function readForm() {
    if (!sig) return;
    var s = JSON.parse(JSON.stringify(sig));
    s.nm = $("f-nm").value;
    s.lang = $("f-lang").value;
    TEXT_FIELDS.forEach(function (k) { s.f[k] = $("f-" + k).value; });
    s.st.acc = $("f-acc").value; s.st.txt = $("f-txt").value; s.st.font = $("f-font").value;
    s.st.size = +$("f-size").value; s.st.lab = $("f-lab").value; s.st.shape = $("f-shape").value;
    s.st.div = $("f-div").checked ? 1 : 0; s.st.icons = $("f-icons").checked ? 1 : 0;
    s.cta = { t: $("f-ctaT").value, u: $("f-ctaU").value };
    if (s.im.ban) {
      s.im.ban.link = $("f-banLink").value; s.im.ban.from = $("f-banFrom").value; s.im.ban.to = $("f-banTo").value;
    }
    s.qr = $("f-qr").checked ? 1 : 0;
    s.so = [].map.call($("so-list").children, function (li) {
      return { k: li.querySelector("select").value, u: li.querySelector("input").value };
    });
    var n = C.normSig(s);
    if (!n) return;
    sig = n;
    $("o-size").textContent = sig.st.size + " px";
    $("f-ctaT").placeholder = C.WORDS[sig.lang].cta;
    $("title-sub").textContent = C.label(sig, t("untitled"));
    saveSoon();
    renderSoon();
  }
  function change(fn) {
    if (!sig) return;
    var s = JSON.parse(JSON.stringify(sig));
    fn(s);
    var n = C.normSig(s);
    if (!n) return;
    sig = n;
    saveSoon();
    renderForm();
    renderSoon(0);
  }

  function renderTpls() {
    var box = $("tpls");
    box.textContent = "";
    C.TEMPLATES.forEach(function (k) {
      var b = el("button", "tpl" + (sig.tpl === k ? " on" : ""));
      b.type = "button";
      b.setAttribute("role", "radio");
      b.setAttribute("aria-checked", sig.tpl === k ? "true" : "false");
      b.tabIndex = sig.tpl === k ? 0 : -1;
      b.dataset.tpl = k;
      b.appendChild(tplSketch(k));
      b.appendChild(el("span", null, t("tpl." + k)));
      b.addEventListener("click", function () { change(function (s) { s.tpl = k; }); focusTpl(k); });
      box.appendChild(b);
    });
  }
  function focusTpl(k) { var b = $("tpls").querySelector('[data-tpl="' + k + '"]'); if (b) b.focus(); }
  // A tiny drawing of each layout (boxes and lines, currentColor).
  function tplSketch(k) {
    var ns = "http://www.w3.org/2000/svg", svg = document.createElementNS(ns, "svg");
    svg.setAttribute("viewBox", "0 0 60 36"); svg.setAttribute("aria-hidden", "true");
    function r(x, y, w, h, o) {
      var n = document.createElementNS(ns, "rect");
      n.setAttribute("x", x); n.setAttribute("y", y); n.setAttribute("width", w); n.setAttribute("height", h);
      n.setAttribute("rx", 1); n.setAttribute("fill", "currentColor"); n.setAttribute("opacity", o || 1);
      svg.appendChild(n);
    }
    var L = {
      classic: function () { r(4, 3, 14, 6, 0.5); r(4, 12, 26, 3); r(4, 17, 20, 2, 0.6); r(4, 21, 12, 1, 0.9); r(4, 24, 30, 2, 0.6); r(4, 28, 24, 2, 0.6); },
      side: function () { r(4, 6, 14, 14, 0.5); r(20, 4, 1.5, 26, 0.9); r(25, 6, 26, 3); r(25, 11, 20, 2, 0.6); r(25, 17, 28, 2, 0.6); r(25, 21, 22, 2, 0.6); },
      minimal: function () { r(4, 12, 20, 3); r(27, 12, 18, 3, 0.6); r(4, 18, 50, 2, 0.6); },
      bar: function () { r(4, 4, 2, 28, 0.9); r(10, 6, 26, 3); r(10, 11, 20, 2, 0.6); r(10, 17, 30, 2, 0.6); r(10, 21, 26, 2, 0.6); },
      compact: function () { r(4, 6, 10, 10, 0.5); r(17, 7, 22, 3); r(17, 12, 16, 2, 0.6); r(4, 20, 26, 2, 0.6); r(4, 24, 22, 2, 0.6); },
      plain: function () { r(4, 6, 26, 3); r(4, 12, 20, 2, 0.6); r(4, 17, 30, 2, 0.6); r(4, 21, 26, 2, 0.6); }
    };
    L[k]();
    return svg;
  }

  // ---------- 5. Pictures, social profiles ----------
  var PIC_W = { logo: [40, 240, "logoW"], photo: [40, 120, "photoW"], ban: [200, 600, "bw"] };
  var pendingPick = null;            // kind waiting for the file input

  function brandLogos() {
    var b = readJSON("oros-atelier-brand");
    return b ? C.fromBrand(b).logos : [];
  }
  function renderPics() {
    if (!sig) return;
    ["logo", "photo", "ban"].forEach(function (kind) { renderPic(kind); });
  }
  function renderPic(kind) {
    var box = $("pic-" + kind), im = sig.im[kind];
    box.textContent = "";
    var head = el("div", "pic-head");
    var thumb = el("div", "pic-thumb");
    if (im && im.a) {
      assetSrc(im.a, kind, 120, kind === "photo" && sig.st.shape === "round").then(function (u) {
        if (!u) { thumb.textContent = t("pic.missing"); return; }
        var i = el("img"); i.src = u; i.alt = ""; thumb.appendChild(i);
      });
    } else if (im && im.u) {
      var i = el("img"); i.alt = ""; i.referrerPolicy = "no-referrer"; i.src = im.u;
      i.addEventListener("load", function () { measured(kind, im.u, i.naturalWidth, i.naturalHeight); });
      thumb.appendChild(i);
      thumb.appendChild(el("span", "pic-note", t("pic.webOnly")));
    } else thumb.textContent = t("pic.none");
    head.appendChild(el("span", "lbl", t("pic." + kind)));
    box.appendChild(head);
    box.appendChild(thumb);
    var acts = el("div", "chips");
    var choose = el("button", "chip small", t("pic.choose"));
    choose.type = "button";
    choose.addEventListener("click", function () { pendingPick = kind; $("file-in").value = ""; $("file-in").click(); });
    acts.appendChild(choose);
    if (kind === "logo" && brandLogos().length) {
      var fb = el("button", "chip small", t("pic.brand"));
      fb.type = "button";
      fb.addEventListener("click", pickBrandLogo);
      acts.appendChild(fb);
    }
    if (im) {
      var rm = el("button", "chip small", t("pic.remove"));
      rm.type = "button";
      rm.addEventListener("click", function () { change(function (s) { delete s.im[kind]; }); });
      acts.appendChild(rm);
    }
    box.appendChild(acts);
    var url = el("label", "fld wide");
    url.appendChild(el("span", null, t("pic.url")));
    var ui = el("input");
    ui.type = "url"; ui.inputMode = "url"; ui.maxLength = 1000; ui.autocomplete = "off"; ui.placeholder = "https://";
    ui.value = im && im.u ? im.u : "";
    ui.addEventListener("change", function () {
      var v = ui.value.trim(), u = C.httpsUrl(v);
      if (v && !u) { toast(t("toast.badUrl")); return; }
      change(function (s) {
        var cur = s.im[kind] || { w: 0, h: 0 };
        if (u) cur.u = u; else delete cur.u;
        if (!cur.a && !cur.u) delete s.im[kind]; else s.im[kind] = cur;
      });
    });
    url.appendChild(ui);
    box.appendChild(url);
    if (im) {
      var r = PIC_W[kind], wl = el("label", "fld");
      wl.appendChild(el("span", null, t("pic.width")));
      var wrap = el("span", "range"), rg = el("input"), out = el("output");
      rg.type = "range"; rg.min = r[0]; rg.max = r[1]; rg.step = 4;
      var curW = kind === "ban" ? (im.bw || 400) : sig.st[r[2]];
      rg.value = curW; out.textContent = curW + " px";
      rg.addEventListener("input", function () {
        out.textContent = rg.value + " px";
        if (kind === "ban") sig.im.ban.bw = +rg.value; else sig.st[r[2]] = +rg.value;
        sig = C.normSig(sig);
        saveSoon(); renderSoon();
      });
      wrap.appendChild(rg); wrap.appendChild(out); wl.appendChild(wrap);
      box.appendChild(wl);
    }
  }
  // A picture from the web: its real size once the preview loads it.
  function measured(kind, u, w, h) {
    var im = sig && sig.im[kind];
    if (!im || im.a || im.u !== u || !w || !h || (im.w === w && im.h === h)) return;
    im.w = w; im.h = h;
    saveSoon(); renderSoon();
  }
  function onFile() {
    var f = $("file-in").files && $("file-in").files[0], kind = pendingPick;
    pendingPick = null;
    if (!f || !kind || !sig) return;
    if (!AS) { toast(t("toast.nofs")); return; }
    AS.importFile(f).then(function (r) {
      change(function (s) {
        var cur = s.im[kind] || {};
        s.im[kind] = Object.assign({}, cur, { a: r.id, w: r.w, h: r.h });
      });
    }, function (e) { toast(t(e && e.message === "nofs" ? "toast.nofs" : "toast.badImg")); });
  }
  function pickBrandLogo() {
    var logos = brandLogos();
    function use(l) { change(function (s) { s.im.logo = Object.assign({}, s.im.logo || {}, { a: l.a, w: l.w, h: l.h }); }); }
    if (logos.length === 1) { use(logos[0]); return; }
    openPick(t("pick.logo"), logos.map(function (l, i) {
      return { label: l.nm || (t("pic.logo") + " " + (i + 1)), asset: l.a, run: function () { use(l); } };
    }), false);
  }

  function renderSocial() {
    var list = $("so-list");
    list.textContent = "";
    sig.so.forEach(function (s) { list.appendChild(socialRow(s.k, s.u)); });
    $("so-add").hidden = sig.so.length >= C.MAX_SOCIAL;
  }
  function socialRow(k, u) {
    var li = el("li", "so-row"), sel = el("select"), inp = el("input"), del = el("button", "icon-btn");
    C.SOCIAL_KEYS.forEach(function (key) {
      var o = el("option", null, C.SOCIAL[key].n || t("so.other"));
      o.value = key;
      sel.appendChild(o);
    });
    sel.value = k;
    sel.setAttribute("aria-label", t("aria.so.kind"));
    inp.type = "url"; inp.inputMode = "url"; inp.maxLength = 1000; inp.value = u || ""; inp.placeholder = t("so.url");
    inp.setAttribute("aria-label", t("so.url"));
    del.type = "button"; del.innerHTML = ICON.close; setLabel(del, t("aria.so.del"));
    sel.addEventListener("change", readForm);
    inp.addEventListener("input", readForm);
    del.addEventListener("click", function () { li.remove(); readForm(); renderSocial(); });
    li.appendChild(sel); li.appendChild(inp); li.appendChild(del);
    return li;
  }
  function addSocial() {
    if (!sig || $("so-list").children.length >= C.MAX_SOCIAL) return;
    var used = sig.so.map(function (s) { return s.k; });
    var k = C.SOCIAL_KEYS.filter(function (x) { return used.indexOf(x) < 0; })[0] || "other";
    var row = socialRow(k, "");
    $("so-list").appendChild(row);
    row.querySelector("input").focus();
    $("so-add").hidden = $("so-list").children.length >= C.MAX_SOCIAL;
  }

  // ---------- 6. Preview, checks, steps ----------
  function renderSoon(ms) {
    clearTimeout(renderTimer);
    renderTimer = setTimeout(render, ms === undefined ? 150 : ms);
  }
  function render() {
    var seq = ++renderSeq;
    if (!sig) { built = null; return; }
    var s = sig, kind = C.targetKind(prefs.target), short = $("pv-short").checked;
    resolveSrc(s).then(function (src) {
      if (seq !== renderSeq) return;
      var opts = { target: kind === "mail" ? "embed" : kind, today: todayKey(), short: short, src: src };
      var r = C.build(s, opts);
      var m = C.build(s, { target: "mail", today: todayKey(), short: short, src: src });
      var shown = kind === "mail" ? m.html : r.html;
      built = { html: kind === "mail" ? m.html : r.html, text: r.text, mail: m, full: r.html, src: src };
      paint(shown);
      renderChecks(s, r.html, kind);
    });
  }
  function paint(html) {
    var dark = $("pv-dark").checked;
    $("pv-wrap").classList.toggle("dark", dark);
    $("pv-wrap").classList.toggle("phone", $("pv-phone").checked);
    var body = C.esc(t("pv.body")).replace(/\n/g, "<br>");
    // Dark mail apps darken the background and lighten dark text; this
    // is a fair picture of it (pictures keep their own colours).
    var css = "body{margin:0;padding:12px 14px;font:14px Arial,Helvetica,sans-serif;color:#222;background:#fff;overflow-wrap:anywhere}" +
      ".msg{margin:0 0 14px}" + (dark ? "body{background:#1e1e1e;color:#e6e6e6}.sig{filter:invert(1) hue-rotate(180deg)}.sig img{filter:invert(1) hue-rotate(180deg)}" : "");
    var doc = '<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="referrer" content="no-referrer"><style>' + css + '</style></head><body><p class="msg">' + body +
      '</p><div class="sig">' + html + '</div></body></html>';
    var f = $("pv");
    f.onload = function () {
      try { f.style.height = Math.max(160, f.contentDocument.documentElement.scrollHeight + 4) + "px"; } catch (e) {}
    };
    f.srcdoc = doc;
  }
  function renderChecks(s, html, kind) {
    var list = $("checks");
    list.textContent = "";
    var out = C.checks(s, { target: kind === "mail" ? "embed" : kind, today: todayKey(), html: html });
    if (prefs.target === "outlook" && s.st.shape === "round" && s.im.photo && !s.im.photo.a) out.push({ lvl: "info", code: "round" });
    if (!out.length) { list.appendChild(el("li", "ok", t("chk.ok"))); return; }
    out.forEach(function (c) {
      var k = "chk." + c.code + (c.code === "needurl" ? "." + c.n : "");
      list.appendChild(el("li", c.lvl, t(k, { n: (c.n || 0).toLocaleString(loc()) })));
    });
  }
  function renderSteps() {
    var list = $("steps");
    list.textContent = "";
    // One key per step: steps.<target>.a, .b, … (a pack translates each).
    var lines = [];
    for (var i = 0; i < 8; i++) {
      var k = "steps." + prefs.target + "." + "abcdefgh".charAt(i);
      if (STRINGS.en[k] === undefined) break;
      lines.push(t(k));
    }
    lines.forEach(function (line) {
      var li = el("li");
      // `Button` → a highlighted name
      line.split(/(`[^`]+`)/).forEach(function (part) {
        if (/^`[^`]+`$/.test(part)) li.appendChild(el("b", null, part.slice(1, -1)));
        else if (part) li.appendChild(document.createTextNode(part));
      });
      list.appendChild(li);
    });
    $("mail-btn").hidden = !installed("mail");
    var kind = C.targetKind(prefs.target);
    $("copy-btn").classList.toggle("primary", kind !== "mail" && prefs.target !== "thunderbird");
    $("html-btn").classList.toggle("primary", prefs.target === "thunderbird");
    $("mail-btn").classList.toggle("primary", kind === "mail");
  }

  // ---------- 7. Copy, save, orOS Mail ----------
  function copyRich() {
    if (!built) return;
    var html = built.html, text = built.text;
    if (navigator.clipboard && typeof navigator.clipboard.write === "function" && typeof window.ClipboardItem === "function") {
      try {
        var item = new window.ClipboardItem({
          "text/html": new Blob([html], { type: "text/html" }),
          "text/plain": new Blob([text], { type: "text/plain" })
        });
        navigator.clipboard.write([item]).then(function () { toast(t("toast.copied")); }, function () { copyBySelection(html); });
        return;
      } catch (e) {}
    }
    copyBySelection(html);
  }
  // The old way: select a hidden copy of the signature and copy it.
  function copyBySelection(html) {
    var box = el("div");
    box.setAttribute("contenteditable", "true");
    box.style.cssText = "position:fixed;left:-9999px;top:0;background:#fff;color:#000";
    box.innerHTML = html;   // built and escaped by core.build()
    document.body.appendChild(box);
    var ok = false;
    try {
      var r = document.createRange(); r.selectNodeContents(box);
      var s = window.getSelection(); s.removeAllRanges(); s.addRange(r);
      ok = document.execCommand("copy");
      s.removeAllRanges();
    } catch (e) { ok = false; }
    box.remove();
    toast(t(ok ? "toast.copied" : "toast.copyFail"));
  }
  function copyCode() {
    if (!built) return;
    var code = built.html;
    var done = function () { toast(t("toast.codeCopied")); };
    if (navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
      navigator.clipboard.writeText(code).then(done, function () { copyTextFallback(code) ? done() : toast(t("toast.copyFail")); });
    } else if (copyTextFallback(code)) done(); else toast(t("toast.copyFail"));
  }
  function copyTextFallback(text) {
    var ta = el("textarea"); ta.value = text; ta.style.cssText = "position:fixed;left:-9999px;top:0";
    document.body.appendChild(ta); ta.select();
    var ok = false;
    try { ok = document.execCommand("copy"); } catch (e) {}
    ta.remove();
    return ok;
  }
  function dialogHost() {
    try { if (window.parent && window.parent !== window && window.parent.orosDialog) return window.parent.orosDialog; } catch (e) {}
    return window.orosDialog || null;
  }
  // R33: through orosDialog when the shell is there.
  function saveFile(blob, name, mime, ext) {
    var dlg = dialogHost();
    var types = [{ description: ext.toUpperCase(), accept: {} }];
    types[0].accept[mime] = ["." + ext];
    var p = dlg ? dlg.saveFile({ blob: blob, filename: name, mime: mime, types: types }) : (function () {
      var a = document.createElement("a");
      a.href = URL.createObjectURL(blob); a.download = name;
      document.body.appendChild(a); a.click();
      setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
      return Promise.resolve({ ok: true });
    })();
    return p.then(function (r) { if (r && r.ok) toast(t("toast.saved")); return r; });
  }
  function stem() { return C.fileStem(C.label(sig, ""), "signature"); }
  function saveHtml() {
    if (!built || !sig) return;
    var html = C.htmlFile(sig, C.targetKind(prefs.target) === "mail" ? built.full : built.html);
    saveFile(new Blob([html], { type: "text/html" }), stem() + ".html", "text/html", "html");
  }
  function saveTxt() {
    if (!built || !sig) return;
    saveFile(new Blob([built.text + "\n"], { type: "text/plain" }), stem() + ".txt", "text/plain", "txt");
  }
  // BR-MAIL-SIG: orOS Mail asks which account and replaces its
  // signature only after the person confirms.
  function useInMail() {
    var s = shell();
    if (!built || !sig || !s || typeof s.__orosOpenAt !== "function") return;
    s.__orosOpenAt("mail", { signature: { html: built.mail.html, text: built.mail.text, name: C.label(sig, t("untitled")) } });
    toast(t("toast.mailSent"));
  }

  // ---------- 8. Fill in from orOS apps ----------
  function invProfiles() {
    var d = readJSON("oros-invoices-data");
    if (!d || typeof d !== "object") return [];
    var out = [];
    if (d.prof && typeof d.prof === "object" && (d.prof.name || d.prof.trade)) out.push(Object.assign({ main: true }, d.prof));
    (Array.isArray(d.profs) ? d.profs : []).forEach(function (p) { if (p && !p.del && p.name) out.push(p); });
    return out;
  }
  function contactsList() {
    var d = readJSON("oros-contacts-data");
    return d && Array.isArray(d.contacts) ? d.contacts.filter(function (c) { return c && typeof c.id === "string"; }) : [];
  }
  function brandRec() { return readJSON("oros-atelier-brand"); }
  function renderFill() {
    var inv = installed("invoices") && invProfiles().length > 0;
    var ct = installed("contacts") && contactsList().length > 0;
    var br = installed("atelier") && (function () { var b = brandRec(); return !!(b && ((b.colors && b.colors.length) || (b.logos && b.logos.length))); })();
    $("fill-inv").hidden = !inv; $("fill-ct").hidden = !ct; $("fill-brand").hidden = !br;
    $("fill-none").hidden = inv || ct || br;
  }
  var undoSnap = null;
  function applyPatch(patch, appName, extra) {
    if (!sig) return;
    undoSnap = JSON.parse(JSON.stringify(sig));
    change(function (s) {
      Object.keys(patch).forEach(function (k) { if (patch[k]) s.f[k] = patch[k]; });
      if (extra) extra(s);
    });
    toast(t("toast.filled", { app: appName }), t("btn.undo"), function () {
      if (!undoSnap || !sig || undoSnap.id !== sig.id) return;
      var back = undoSnap; undoSnap = null;
      change(function (s) { Object.keys(back).forEach(function (k) { s[k] = back[k]; }); });
    });
  }
  function appName(id, fallback) {
    var s = shell();
    try { var v = s && s.t ? s.t("app." + id) : ""; return v && v !== "app." + id ? v : fallback; } catch (e) { return fallback; }
  }
  function fillInvoices() {
    var list = invProfiles();
    function use(p) {
      var patch = C.fromInvoices(p);
      var logo = typeof p.logo === "string" && /^data:image\/(png|jpeg);base64,/.test(p.logo) ? p.logo : "";
      applyPatch(patch, appName("invoices", "Invoices"));
      if (logo && AS && (!sig.im.logo || !sig.im.logo.a)) {
        fetch(logo).then(function (r) { return r.blob(); }).then(function (b) {
          return AS.importFile(new File([b], "logo." + (b.type === "image/png" ? "png" : "jpg"), { type: b.type }));
        }).then(function (r) {
          change(function (s) { s.im.logo = Object.assign({}, s.im.logo || {}, { a: r.id, w: r.w, h: r.h }); });
        }).catch(function () {});
      }
    }
    if (!list.length) { toast(t("toast.nothing")); return; }
    if (list.length === 1) { use(list[0]); return; }
    openPick(t("pick.inv"), list.map(function (p) {
      return { label: p.trade || p.name, sub: p.main ? t("pick.main") : (p.afm || ""), run: function () { use(p); } };
    }), false);
  }
  function fillContact() {
    var list = contactsList();
    if (!list.length) { toast(t("toast.nothing")); return; }
    openPick(t("pick.ct"), list.map(function (c) {
      var p = C.fromContact(c);
      return { label: p.name || p.company || "?", sub: [p.company, p.email].filter(Boolean).join(" · "),
               run: function () { applyPatch(p, appName("contacts", "Contacts")); } };
    }).sort(function (a, b) { return a.label.localeCompare(b.label, loc()); }), true);
  }
  function fillBrand() {
    var b = brandRec();
    if (!b) { toast(t("toast.nothing")); return; }
    var p = C.fromBrand(b);
    applyPatch({}, appName("atelier", "Atelier"), function (s) {
      if (p.acc) s.st.acc = p.acc;
      if (p.txt) s.st.txt = p.txt;
      if (p.font) s.st.font = p.font;
      if (p.logos.length && (!s.im.logo || !s.im.logo.a)) s.im.logo = Object.assign({}, s.im.logo || {}, { a: p.logos[0].a, w: p.logos[0].w, h: p.logos[0].h });
    });
  }

  // ---------- 9. Dialogs: more, team, pick, ask ----------
  var openDlg = null, lastFocus = null;
  function showDlg(id) {
    if (openDlg) hideDlg();
    lastFocus = document.activeElement;
    openDlg = $(id);
    $("scrim").hidden = false;
    openDlg.hidden = false;
    var f = openDlg.querySelector("input, textarea, button:not(.dlg-close)") || openDlg.querySelector("button");
    if (f) f.focus();
  }
  function hideDlg() {
    if (!openDlg) return;
    openDlg.hidden = true;
    $("scrim").hidden = true;
    openDlg = null;
    if (lastFocus && lastFocus.focus) try { lastFocus.focus(); } catch (e) {}
  }

  var pickItems = [];
  function openPick(title, items, searchable) {
    pickItems = items;
    $("pick-title").textContent = title;
    $("pick-q").hidden = !searchable;
    $("pick-q").value = "";
    $("pick-q").placeholder = t("pick.q");
    $("pick-q").setAttribute("aria-label", t("pick.q"));
    renderPick();
    showDlg("pick");
  }
  function fold(s) { return String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, ""); }
  function renderPick() {
    var q = fold($("pick-q").value.trim()), list = $("pick-list");
    list.textContent = "";
    var shown = pickItems.filter(function (it) { return !q || fold(it.label + " " + (it.sub || "")).indexOf(q) >= 0; }).slice(0, 200);
    if (!shown.length) { list.appendChild(el("li", "hint", t("pick.none"))); return; }
    shown.forEach(function (it) {
      var li = el("li"), b = el("button", "pick-item");
      b.type = "button";
      if (it.asset) {
        var th = el("span", "pick-thumb");
        assetSrc(it.asset, "logo", 60, false).then(function (u) { if (u) { var i = el("img"); i.src = u; i.alt = ""; th.appendChild(i); } });
        b.appendChild(th);
      }
      var tx = el("span", "pick-text");
      tx.appendChild(el("span", "pick-label", it.label));
      if (it.sub) tx.appendChild(el("span", "pick-sub", it.sub));
      b.appendChild(tx);
      b.addEventListener("click", function () { hideDlg(); it.run(); });
      li.appendChild(b);
      list.appendChild(li);
    });
  }

  var askYes = null;
  function ask(text, yesLabel, fn) {
    $("ask-text").textContent = text;
    $("ask-yes").textContent = yesLabel;
    askYes = fn;
    showDlg("ask");
    $("ask-no").focus();
  }

  function duplicate() {
    hideDlg();
    if (!sig) return;
    if (data.sigs.length >= C.MAX_SIGS) { toast(t("toast.full")); return; }
    if (saveTimer) saveNow();
    var c = C.duplicate(sig, C.newId(), Date.now(), t("copyOf"));
    var r = C.put(data, c, Date.now());
    if (!r.ok) return;
    data = r.data;
    storeData();
    select(r.sig.id);
    toast(t("toast.dup"));
  }
  function delSig() {
    hideDlg();
    if (!sig) return;
    var id = sig.id;
    ask(t("ask.del", { name: C.label(sig, t("untitled")) }), t("btn.delete"), function () {
      clearTimeout(saveTimer); saveTimer = 0;
      data = C.remove(data, id, Date.now());
      storeData();
      sig = null;
      select(data.sigs[0] ? data.sigs[0].id : "");
      toast(t("toast.deleted"));
    });
  }

  // Team signatures
  var team = { people: [] };
  function openTeam() {
    hideDlg();
    if (!sig) return;
    readTeam();
    showDlg("team");
  }
  function readTeam() {
    var r = C.teamRows($("team-csv").value);
    team = r;
    var info = $("team-info");
    if (r.error === "noname") info.textContent = t("team.noname");
    else if (!r.people.length) info.textContent = $("team-csv").value.trim() ? t("team.noname") : t("team.empty");
    else info.textContent = t(r.people.length === 1 ? "team.count1" : "team.count", { n: r.people.length, cols: r.cols.join(", ") });
    $("team-zip").disabled = !r.people.length;
  }
  function openCsv() {
    var dlg = dialogHost();
    var p = dlg && dlg.openFile ? dlg.openFile(".csv,.txt,text/csv,text/plain") : Promise.resolve(null);
    p.then(function (f) {
      if (!f) return null;
      if (f.size > 2 * 1024 * 1024) return null;
      return f.text();
    }).then(function (text) {
      if (typeof text !== "string") return;
      $("team-csv").value = text.slice(0, 1000000);
      readTeam();
    }).catch(function () {});
  }
  function saveSample() {
    var sample = t("team.sample");
    saveFile(new Blob(["﻿" + sample], { type: "text/csv" }), t("team.sampleFile") + ".csv", "text/csv", "csv");
  }
  function saveZip() {
    if (!sig || !team.people.length) return;
    if (saveTimer) saveNow();
    var kind = C.targetKind(prefs.target) === "web" ? "web" : "embed";
    resolveSrc(sig).then(function (src) {
      var files = team.people.map(function (p) {
        var s = C.forPerson(sig, p);
        var my = Object.assign({}, src, { photo: "" });
        if (s.qr) my.qr = qrSrc(s);
        var r = C.build(s, { target: kind, today: todayKey(), src: my });
        return { name: C.fileStem(p.name, "signature") + ".html", text: C.htmlFile(s, r.html) };
      });
      var bytes = C.zip(files, new Date());
      return saveFile(new Blob([bytes], { type: "application/zip" }), stem() + "-team.zip", "application/zip", "zip").then(function (r) {
        if (r && r.ok) toast(t("toast.zip", { n: files.length }));
      });
    });
  }

  // ---------- Toast ----------
  var toastTimer = 0;
  function toast(msg, actLabel, act) {
    var n = $("toast");
    n.textContent = "";
    n.appendChild(el("span", null, msg));
    if (actLabel && act) {
      var b = el("button", null, actLabel);
      b.type = "button";
      b.addEventListener("click", function () { n.classList.remove("show"); act(); });
      n.appendChild(b);
    }
    n.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { n.classList.remove("show"); }, actLabel ? 6000 : 3200);
  }

  // ---------- Tabs (narrow screens) ----------
  function showTab(k) {
    var edit = k !== "use";
    $("tab-edit").classList.toggle("on", edit); $("tab-edit").setAttribute("aria-selected", edit ? "true" : "false");
    $("tab-use").classList.toggle("on", !edit); $("tab-use").setAttribute("aria-selected", edit ? "false" : "true");
    document.body.classList.toggle("show-use", !edit);
    if (!edit) renderSoon(0);
  }

  // ---------- 10. Sync slice, palette, deep link ----------
  var PAL_VARS = ["--bg", "--bg-desktop", "--bar-bg", "--text", "--text-dim",
                  "--accent", "--accent-hover", "--accent-soft",
                  "--panel-bg", "--border", "--shadow", "--danger"];
  function inheritPalette() {
    try {
      var pRoot = window.parent.document.documentElement;
      document.documentElement.setAttribute("data-theme", pRoot.getAttribute("data-theme") || "dark");
      var cs = window.parent.getComputedStyle(pRoot);
      PAL_VARS.forEach(function (v) {
        var val = cs.getPropertyValue(v).trim();
        if (val) document.documentElement.style.setProperty(v, val);
      });
    } catch (e) { /* standalone */ }
  }
  function watchPalette() {
    try {
      new MutationObserver(inheritPalette).observe(window.parent.document.documentElement,
        { attributes: true, attributeFilter: ["data-skin", "data-theme"] });
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
    api.registerSlice("signature", sliceGet, sliceSet, C.DATA_KEY, C.merge);
  }
  function sliceGet() { return C.merge(data, null); }     // canonical copy (R26)
  function sliceSet(incoming) {
    if (!incoming || typeof incoming !== "object" || !Array.isArray(incoming.sigs)) return;
    var before = JSON.stringify(data);
    window.__orosSyncApi._suppress = true;   // R6: a pull never marks dirty
    try {
      data = C.merge(incoming, null);
      localStorage.setItem(C.DATA_KEY, JSON.stringify(data));
    } catch (e) {
    } finally {
      window.__orosSyncApi._suppress = false;
    }
    if (JSON.stringify(data) === before) return;
    // the open signature: take the incoming copy unless an edit is
    // waiting to be saved (that edit is newer and will win)
    if (sig && !saveTimer) {
      var s = C.byId(data, sig.id);
      if (!s) { select(data.sigs[0] ? data.sigs[0].id : ""); return; }
      if (s.m !== sig.m) { sig = JSON.parse(JSON.stringify(s)); renderForm(); renderSoon(0); }
    } else if (!sig && data.sigs.length) { select(prefs.cur || data.sigs[0].id); return; }
    fillSelect();
  }
  // .orossignature (OBF-4e): every signature as one orOS file
  // (../recordpkg.js + package.js), its pictures from the orOS disk in
  // media/ (the asset id IS the media key: <sha256>.png|jpg). Opening
  // ADDS the signatures this device lacks, with their ids; one already
  // here (or deleted here) is kept as it is unless "Update with newer
  // versions" is ticked. A picture goes back through the designkit's
  // own package check (assets.put: the bytes must hash to its name and
  // decode as an image) and is written only when it is not on the disk
  // yet. Prefs stay on this device; the app holds no keys. Undo deletes
  // the added signatures the way Delete does, so the tombstones sync.
  var RP = window.OrosRecordPkg || null, SPK = window.OrosSignaturePackage || null;
  var MEDIA_MAX = 20 * 1024 * 1024;
  // true: stored or already there (or no bytes in the file: it stays a
  // name, "Not on this device yet"); false: the bytes failed a check
  function storeAsset(a, media) {
    var item = Object.prototype.hasOwnProperty.call(media, a) ? media[a] : null;
    if (!item || !(item.blob || item.bytes) || !AS || typeof AS.put !== "function") return Promise.resolve(true);
    var type = /\.png$/.test(a) ? "image/png" : "image/jpeg";
    var size = item.blob ? item.blob.size : item.bytes.length;
    if (item.type !== type || size > MEDIA_MAX) return Promise.resolve(false);
    var blob = item.blob ? item.blob.slice(0, item.blob.size, type) : new Blob([item.bytes], { type: type });
    return AS.put(a, blob).then(function () { return true; }, function () { return false; });
  }
  var recFile = RP && SPK && window.OrosBundle ? RP.ui(SPK.DESC, {
    lang: function () { return LANG; },
    get: function () { if (saveTimer) saveNow(); return C.merge(data, null); },
    title: function () { return t("app.name"); },
    // media/: every picture the signatures name, read from the orOS disk
    files: function (state) {
      var out = [], chain = Promise.resolve();
      if (!AS || typeof AS.blob !== "function") return out;
      SPK.assetIds(state).forEach(function (a) {
        chain = chain.then(function () { return AS.blob(a); }).then(function (b) {
          if (b && b.size) out.push({ key: a, blob: b, type: /\.png$/.test(a) ? "image/png" : "image/jpeg" });
        }, function () {});
      });
      return chain.then(function () { return out; });
    },
    // the pictures of the signatures this open adds (or updates)
    media: function (read, res) {
      var next = res.next, media = (read && read.media) || {}, ids = res.addedIds.concat(res.updatedIds), bad = [];
      var chain = Promise.resolve();
      SPK.assetIds(next, ids).forEach(function (a) {
        chain = chain.then(function () { return storeAsset(a, media); }).then(function (ok) { if (!ok) bad.push(a); });
      });
      return chain.then(function () { return SPK.dropAssets(next, ids, bad); });
    },
    set: function (next, info) {
      if (!next || typeof next !== "object" || !Array.isArray(next.sigs)) return;
      if (saveTimer) saveNow();
      data = C.merge(next, null);
      storeData();
      srcCache = filterCache();
      var cur = sig ? C.byId(data, sig.id) : null;
      if (!cur) {
        var first = ((info && info.addedIds) || []).filter(function (id) { return C.byId(data, id); })[0];
        sig = null;
        select(first || (data.sigs[0] ? data.sigs[0].id : ""));
        return;
      }
      if (cur.m !== sig.m) { sig = JSON.parse(JSON.stringify(cur)); renderForm(); }
      fillSelect();
      renderSoon(0);
    },
    deleteIds: function (ids) {
      if (saveTimer) saveNow();
      var now = Date.now(), any = false;
      ids.forEach(function (id) { if (C.byId(data, id)) { data = C.remove(data, id, now); any = true; } });
      if (!any) return;
      storeData();
      if (sig && !C.byId(data, sig.id)) { sig = null; select(data.sigs[0] ? data.sigs[0].id : ""); }
      else fillSelect();
      toast(recFile.text("undone"));
    },
    toast: function (text, undo) { toast(text, undo ? t("btn.undo") : null, undo || null); }
  }) : null;

  // Deep link (search hit): { id } opens that signature.
  // "Open with" an .orossignature file (fileopen.js): { openFile: { token } },
  // the File taken once with window.parent.__orosTakeFile(token), then
  // the kit's dialog (false: boot still opens the last signature)
  function openTarget(target) {
    if (target && typeof target === "object" && target.openFile) {
      hideDlg();
      if (recFile) recFile.openTarget(target.openFile);
      return false;
    }
    if (!target || typeof target !== "object" || typeof target.id !== "string") return false;
    if (!C.byId(data, target.id)) return false;
    hideDlg();
    select(target.id);
    return true;
  }
  window.__orosOpenAt = openTarget;

  // ---------- 11. Wiring & boot ----------
  function applyI18n() {
    document.documentElement.lang = LANG;
    [].forEach.call(document.querySelectorAll("[data-i18n]"), function (n) { n.textContent = t(n.getAttribute("data-i18n")); });
    document.title = t("app.name") + " · orOS";
    $("new-btn").innerHTML = ICON.plus; setLabel($("new-btn"), t("btn.new"));
    $("more-btn").innerHTML = ICON.more; setLabel($("more-btn"), t("btn.more"));
    [].forEach.call(document.querySelectorAll(".dlg-close"), function (b) { b.innerHTML = ICON.close; setLabel(b, t("btn.close")); });
    $("f-nm").placeholder = t("ph.nm"); $("f-pron").placeholder = t("ph.pron"); $("f-web").placeholder = t("ph.web");
    $("pv").title = t("tab.use");
    $("tabs").setAttribute("aria-label", t("app.name"));
    var fs = $("f-font");
    Object.keys(C.FONTS).forEach(function (k) {
      var o = el("option", null, C.FONT_NAMES[k]);
      o.value = k;
      o.style.fontFamily = C.FONTS[k];
      fs.appendChild(o);
    });
  }

  function wire() {
    $("sig-sel").addEventListener("change", function () { select($("sig-sel").value); });
    $("new-btn").addEventListener("click", newSig);
    $("first-btn").addEventListener("click", newSig);
    $("more-btn").addEventListener("click", function () { showDlg("more"); });
    $("tab-edit").addEventListener("click", function () { showTab("edit"); });
    $("tab-use").addEventListener("click", function () { showTab("use"); });
    $("tabs").addEventListener("keydown", function (e) {
      if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
      var use = !document.body.classList.contains("show-use");
      showTab(use ? "use" : "edit");
      $(use ? "tab-use" : "tab-edit").focus();
    });
    var inputs = ["f-nm", "f-name", "f-pron", "f-title", "f-dept", "f-company", "f-vat", "f-phone", "f-mobile", "f-email", "f-web",
                  "f-addr", "f-line", "f-legal", "f-ctaT", "f-ctaU", "f-banLink", "f-acc", "f-txt", "f-size"];
    inputs.forEach(function (id) { $(id).addEventListener("input", readForm); });
    ["f-lang", "f-font", "f-lab", "f-shape", "f-div", "f-icons", "f-qr", "f-banFrom", "f-banTo"].forEach(function (id) {
      $(id).addEventListener("change", readForm);
    });
    // clean what was typed when leaving a link field (https:// added)
    ["f-web", "f-ctaU", "f-banLink"].forEach(function (id) {
      $(id).addEventListener("change", function () { if (sig) renderForm(); });
    });
    $("tpls").addEventListener("keydown", function (e) {
      var d = (e.key === "ArrowRight" || e.key === "ArrowDown") ? 1 : ((e.key === "ArrowLeft" || e.key === "ArrowUp") ? -1 : 0);
      if (!d || !sig) return;
      e.preventDefault();
      var i = C.TEMPLATES.indexOf(sig.tpl), k = C.TEMPLATES[(i + d + C.TEMPLATES.length) % C.TEMPLATES.length];
      change(function (s) { s.tpl = k; });
      focusTpl(k);
    });
    $("so-add").addEventListener("click", addSocial);
    [].forEach.call(document.querySelectorAll("[data-legal]"), function (b) {
      b.addEventListener("click", function () {
        if (!sig) return;
        var add = tIn(sig.lang, "legal." + b.getAttribute("data-legal") + ".t"), cur = $("f-legal").value.trim();
        if (cur.indexOf(add) >= 0) return;
        $("f-legal").value = (cur ? cur + "\n" : "") + add;
        readForm();
      });
    });
    $("file-in").addEventListener("change", onFile);
    $("fill-inv").addEventListener("click", fillInvoices);
    $("fill-ct").addEventListener("click", fillContact);
    $("fill-brand").addEventListener("click", fillBrand);
    $("target").addEventListener("change", function () {
      prefs.target = C.TARGETS.indexOf($("target").value) >= 0 ? $("target").value : "gmail";
      savePrefs(); renderSteps(); renderSoon(0);
    });
    ["pv-short", "pv-dark", "pv-phone"].forEach(function (id) {
      $(id).addEventListener("change", function () {
        prefs.dark = $("pv-dark").checked; prefs.phone = $("pv-phone").checked; savePrefs();
        renderSoon(0);
      });
    });
    $("copy-btn").addEventListener("click", copyRich);
    $("code-btn").addEventListener("click", copyCode);
    $("html-btn").addEventListener("click", saveHtml);
    $("txt-btn").addEventListener("click", saveTxt);
    $("mail-btn").addEventListener("click", useInMail);
    $("dup-btn").addEventListener("click", duplicate);
    $("del-btn").addEventListener("click", delSig);
    $("team-btn").addEventListener("click", openTeam);
    // .orossignature: shown only when the kit loaded (Open also in the
    // empty box, where the More menu is hidden: a new device starts there)
    [["osave-btn", function () { recFile.save(); }],
     ["oopen-btn", function () { recFile.open(); }],
     ["ofolder-btn", function () { recFile.openFolder(); }],
     ["oopen-first", function () { recFile.open(); }],
     ["ofolder-first", function () { recFile.openFolder(); }]].forEach(function (b) {
      var n = $(b[0]);
      n.hidden = !recFile;
      n.addEventListener("click", function () { hideDlg(); if (saveTimer) saveNow(); b[1](); });
    });
    $("empty-open").hidden = !recFile;
    $("team-csv").addEventListener("input", readTeam);
    $("team-open").addEventListener("click", openCsv);
    $("team-sample").addEventListener("click", saveSample);
    $("team-zip").addEventListener("click", saveZip);
    $("pick-q").addEventListener("input", renderPick);
    $("ask-no").addEventListener("click", hideDlg);
    $("ask-yes").addEventListener("click", function () { var f = askYes; askYes = null; hideDlg(); if (f) f(); });
    $("scrim").addEventListener("click", hideDlg);
    [].forEach.call(document.querySelectorAll(".dlg-close"), function (b) { b.addEventListener("click", hideDlg); });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && openDlg) { e.preventDefault(); hideDlg(); return; }
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === "C" || e.key === "c") && sig && !openDlg) { e.preventDefault(); copyRich(); }
    });
    window.addEventListener("pagehide", function () { if (saveTimer) saveNow(); });
    document.addEventListener("visibilitychange", function () { if (document.visibilityState === "hidden" && saveTimer) saveNow(); });
  }

  function boot() {
    load();
    applyI18n();
    inheritPalette();
    $("target").value = prefs.target;
    $("pv-dark").checked = prefs.dark;
    $("pv-phone").checked = prefs.phone;
    wire();
    registerSync();
    watchPalette();
    if (!shell()) toast(t("standalone"));
    renderSteps();
    showTab("edit");
    var opened = false;
    try {
      var s = shell();
      if (s && typeof s.__orosTakeTarget === "function") {
        var pending = s.__orosTakeTarget("signature");
        if (pending) opened = openTarget(pending);
      }
    } catch (e) {}
    if (!opened) select(prefs.cur);
    console.log("[orOS Signature] v" + C.VERSION + " ready");
  }

  boot();
})();
