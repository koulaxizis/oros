// ============================================================
// orOS Certificates — App logic (v1.0.0)
// Certificates of attendance, completion and merit, diplomas, thank-
// you and kids' awards, issued in bulk from a list of people.
//   - Home: every set of certificates (one design + its list)
//   - Design: what it is for (seminar, dates, place, hours, issuer),
//     kind (ready texts in EN / EL), six looks, colours, font, paper,
//     the texts with fields, logo, up to 3 signatures (a picture or
//     signed on the screen), a seal or a medal, numbering
//   - People: one by one, pasted, a CSV / Excel file, Contacts (all
//     or a label), CRM (all or a tag); grade, another form of the
//     name, extra text, revoked
//   - Issue: checks (empty fields, people without a number, numbers
//     given twice), numbers in list order, PDF with everyone, a ZIP
//     with one PDF each, each PDF into orOS Files, printing, one PDF
//     or picture, sending one by email (orOS Mail with the PDF, or
//     the device's mail app), the register as CSV
// Drawing: certificates/dk.js -> designkit (render.js on screen,
// pdf.js for PDF), so the preview and the paper agree.
// Data: synced slice "certificates" (core.js); pictures on the orOS
// disk through designkit/assets.js (R30).
// Sections:
//   1. Constants, i18n, helpers
//   2. State + storage
//   3. Views: home, editor, tabs
//   4. Design form
//   5. Pictures and signatures
//   6. Preview
//   7. People
//   8. Issue: checks, numbers
//   9. Output: PDF, ZIP, Files, print, PNG, email, register
//  10. Dialogs + toast
//  11. Sync slice, palette, deep link
//  12. Wiring & boot
// ============================================================
(function () {
  "use strict";

  var C = window.CertCore, D = window.CertDK, DK = window.orosDK, S = window.CertSign || null;
  var T = DK.text, R = DK.render, P = DK.pdf, A = DK.assets;

  // ---------- 1. Constants, i18n, helpers ----------
  function appLang() {
    try {
      var l = localStorage.getItem("oros-lang") || (window.parent && window.parent.orosLang) || "en";
      return l === "el" ? "el" : "en";
    } catch (e) { return "en"; }
  }
  var LANG = appLang();

  var STRINGS = {
    en: {
      "app.name": "Certificates", "loading": "Loading fonts…",
      "home.empty": "Make certificates of attendance, completion, merit and more. Design one, add the names, and save a PDF for every person, numbered.",
      "btn.first": "Make certificates", "home.q": "Find", "home.count1": "1 set of certificates", "home.count": "{n} sets of certificates",
      "home.none": "Nothing matches.", "ev.people0": "No one yet", "ev.people1": "1 person", "ev.people": "{n} people",
      "btn.new": "New certificates", "btn.more": "More", "btn.home": "All certificates", "btn.close": "Close",
      "tab.design": "Design", "tab.people": "People", "tab.issue": "Issue",
      "sec.details": "What it is for", "f.t": "Seminar, course or event", "f.issuer": "Issued by (organisation)",
      "f.d1": "From", "f.d2": "Until (if more days)", "f.place": "Place", "f.hours": "Hours", "f.idate": "Date of issue",
      "sec.look": "Kind and look", "f.kind": "Kind", "f.lang": "Language of the certificate", "f.sty": "Look",
      "f.acc": "Main colour", "f.acc2": "Second colour", "f.font": "Font", "font.serif": "Serif (Noto Serif)", "font.sans": "Sans (Noto Sans)",
      "f.size": "Paper", "f.orient": "Orientation", "orient.l": "Landscape", "orient.p": "Portrait",
      "kind.attend": "Attendance", "kind.complete": "Completion", "kind.award": "Merit", "kind.excel": "Excellence",
      "kind.diploma": "Diploma", "kind.particip": "Participation", "kind.train": "Training", "kind.thanks": "Thanks",
      "kind.volunteer": "Volunteering", "kind.kids": "Kids' award",
      "kindsub.attend": "Seminar, workshop", "kindsub.complete": "Course, programme", "kindsub.award": "Praise for a result",
      "kindsub.excel": "Top achievement", "kindsub.diploma": "With or without grade", "kindsub.particip": "Conference, event",
      "kindsub.train": "Training hours", "kindsub.thanks": "Speakers, sponsors", "kindsub.volunteer": "Hours of service",
      "kindsub.kids": "School, clubs, home",
      "sty.classic": "Classic", "sty.modern": "Modern", "sty.elegant": "Elegant", "sty.bold": "Bold", "sty.minimal": "Minimal", "sty.kids": "Playful",
      "sec.texts": "Texts", "texts.hint": "Tap a field to put it where the cursor is. Each person's details go in its place. A part between [[ and ]] shows only when its fields have a value.",
      "tx.sub": "Above the title", "tx.head": "Title", "tx.pre": "Before the name", "tx.nm": "Name line", "tx.body": "Text",
      "tx.foot": "Place and date", "tx.no": "Number line", "btn.resetTexts": "Ready texts for this kind",
      "tok.name": "Name", "tok.name2": "Other form of the name", "tok.grade": "Grade", "tok.extra": "Extra", "tok.title": "Seminar or course",
      "tok.dates": "Dates", "tok.date": "Date of issue", "tok.place": "Place", "tok.hours": "Hours", "tok.issuer": "Issued by", "tok.serial": "Number",
      "sec.pics": "Logo, signatures and seal", "pic.logo": "Logo", "pic.seal": "Seal or stamp", "pic.sigs": "Signatures",
      "pic.none": "None", "pic.missing": "The picture has not arrived on this device yet.", "btn.pick": "Choose a picture", "btn.change": "Change",
      "btn.removePic": "Remove", "btn.addSig": "Add a signature", "btn.draw": "Sign on the screen", "btn.sigImg": "Picture of a signature",
      "btn.removeSig": "Remove this signature", "f.sigN": "Name", "f.sigR": "Role", "f.medal": "A medal when there is no seal",
      "sec.number": "Numbers", "f.showNo": "Show the certificate number", "f.pre": "Number starts with", "f.next": "Next number",
      "no.example": "The next number will be {s}. Numbers are given in list order, once, and never reused.",
      "f.n": "Full name", "f.em": "Email", "btn.add": "Add", "btn.paste": "Paste a list", "btn.file": "Open a file (CSV, Excel)",
      "btn.contacts": "From Contacts", "btn.crm": "From CRM", "ppl.q": "Find a person",
      "ppl.empty": "No one on the list yet. Add names one by one, paste a list, or open a table (CSV or Excel) with a column for the name.",
      "ppl.count0": "No one", "ppl.count1": "1 person", "ppl.count": "{n} people", "ppl.more": "Show {n} more", "ppl.none": "Nobody matches.",
      "ppl.noNo": "no number", "ppl.rv": "revoked",
      "paste.title": "Paste a list", "paste.hint": "One person per line. A table copied from a spreadsheet works too: a first row with column names (name, email, grade…) tells which column is which.",
      "paste.found1": "1 person found.", "paste.found": "{n} people found.", "paste.cols": "Columns: {c}.", "paste.nothing": "No names found yet.",
      "btn.sample": "Save an example table", "btn.addAll": "Add to the list",
      "col.n": "name", "col.n2": "other form", "col.em": "email", "col.g": "grade", "col.x": "extra",
      "person.title": "Person", "f.n2": "Other form of the name (optional)", "f.g": "Grade or distinction", "f.x": "Extra",
      "f.rv": "Revoked (no longer valid)", "btn.remove": "Remove from the list", "btn.mailOne": "Send by email", "btn.save": "Save",
      "pe.no": "Number {s}, given on {d}.", "pe.noNone": "No number yet: numbers are given in the Issue tab.",
      "sec.check": "Check", "btn.number": "Give numbers",
      "chk.none": "No one on the list yet.", "chk.toPeople": "Add people",
      "chk.count": "{n} certificates: {a} with a number, {b} without.", "chk.allNo": "{n} certificates, all numbered.",
      "chk.missing": "The design uses “{f}”, but it is empty.", "chk.fill": "Fill in",
      "chk.grade": "Some people have no grade: the part with it is left out for them.",
      "chk.dup": "Number {s} was given twice (two devices at the same time).", "chk.fix": "Give a new number",
      "chk.rv1": "1 certificate is revoked.", "chk.rv": "{n} certificates are revoked.",
      "chk.name2": "Some people have no other form of the name: their name is used as written.",
      "chk.ok": "Everything the design needs is filled in.",
      "sec.save": "Save and print", "f.skipRv": "Leave out revoked certificates",
      "btn.pdfAll": "PDF with everyone", "btn.zip": "ZIP, one PDF each", "btn.files": "Save each in Files", "btn.print": "Print",
      "btn.pdfOne": "PDF of this one", "btn.pngOne": "Picture (PNG) of this one", "btn.mail": "Send by email…", "btn.register": "Register (CSV)",
      "pv.who": "Whose certificate", "pv.sample": "Example: {n}", "pv.prev": "Previous person", "pv.next": "Next person",
      "pv.alt": "Preview of the certificate", "pv.note": "An example. Add people to see each one's certificate.",
      "sample.name": "Maria Smith",
      "more.title": "These certificates", "btn.dup": "Duplicate (design only)", "btn.clear": "Clear the list of people",
      "btn.del": "Delete these certificates",
      "more.hint": "Your certificates and lists follow you to every device through orOS sync, encrypted. Their pictures travel with your orOS disk.",
      "new.title": "New certificates", "btn.create": "Create",
      "draw.title": "Sign here", "draw.hint": "Sign with a finger, a pen or the mouse.", "btn.clearPad": "Clear", "btn.useSig": "Use this signature",
      "pick.q": "Search", "pick.none": "Nothing here.", "pick.ct": "Add from Contacts", "pick.crm": "Add from CRM",
      "pick.all": "Everyone ({n})", "pick.label": "{l} ({n})",
      "pick.mail": "Send by email", "pick.mailHint": "One message per person, with the PDF attached when orOS Mail is set up on this device.",
      "pick.noMail": "No one on the list has an email address.",
      "btn.cancel": "Cancel", "btn.yes": "Yes", "btn.no": "No", "btn.delete": "Delete", "btn.replace": "Replace", "btn.keep": "Keep my texts",
      "btn.numberFirst": "Give numbers", "btn.without": "Without numbers",
      "ask.kind": "Put the ready texts of this kind in place of your texts?",
      "ask.lang": "Put the ready texts in this language in place of your texts?",
      "ask.del": "Delete “{name}” and its list of {n} people? This cannot be undone.",
      "ask.clear": "Remove all {n} people from the list? Their numbers stay used.",
      "ask.remove": "Remove {name} from the list?",
      "ask.numbers": "{n} people have no number yet. Give them numbers first?",
      "ask.reset": "Put back the ready texts of this kind?",
      "toast.saveFail": "Could not save: the device storage is full.", "toast.full": "There is no room for more.",
      "sec.check": "Check code (QR)", "f.qr": "A QR code that shows the certificate is genuine",
      "qr.hint": "Anyone can scan it with a phone to see the details you signed: number, name, course, dates and organisation. It works with no server and nothing is sent anywhere.",
      "qr.none": "This browser cannot sign codes.", "qr.fp": "Your key:",
      "qr.fpHint": "Put this key on your website or under your emails. The check page shows it, so people can see the certificate really comes from you.",
      "btn.copyFp": "Copy the key", "btn.openCheck": "Open the check page",
      "qr.copyText": "Our certificates carry a QR code signed with the orOS key {fp}.",
      "toast.copied": "Copied.", "toast.noCrypto": "This browser cannot make the check code.",
      "btn.atAll": "Everyone came", "btn.atNone": "Clear the ticks", "btn.sheet": "Sign-in sheet (PDF)", "ppl.at": "Came: {n}",
      "f.onlyAt": "Only for people ticked as present", "btn.badges": "Open Badges (ZIP)",
      "chk.at": "{a} of {n} people are ticked as present; only they get a certificate.", "chk.at0": "No one is ticked as present yet.",
      "toast.at": "Ticked: {n}.", "work.badges": "Open Badges {i} of {n}…", "toast.badges": "Open Badges need a browser that can sign.",
      "btn.sendAll": "Email everyone…", "send.title": "Email everyone",
      "send.hint": "Each person gets one message with their own certificate attached, sent from your orOS Mail account. Keep orOS open and in front while it sends.",
      "send.from": "Send from", "send.rate": "Messages per hour, at most",
      "send.rateHint": "Mail providers limit how many messages you can send (often 100 to 300 an hour, about 500 a day on Gmail). Sending stops at the first such refusal.",
      "send.again": "Also people who were already sent theirs", "send.go": "Start sending", "send.pause": "Pause", "send.resume": "Go on",
      "send.left": "{n} to send.", "send.left1": "1 to send.", "send.none": "Everyone with an email has already been sent theirs.",
      "send.noMail": "No one on the list has an email address.", "send.step": "Sending {i} of {n}: {name}…",
      "send.sent": "Sent {s} of {n}.", "send.done": "Done: {s} sent.", "send.doneFail": "Done: {s} sent. Not delivered (address refused): {list}.",
      "send.paused": "Paused: {s} of {n} sent. Press “Go on” to continue.",
      "send.err.rate": "The mail server refused more messages for now (its limit). Wait a while or lower the messages per hour, then go on.",
      "send.err.auth": "The mail server did not accept the password. Check the account in orOS Mail.",
      "send.err.nopass": "The password of this account is not on this device. Open the account in orOS Mail on this device first.",
      "send.err.offline": "No connection. Go on when you are back online.", "send.maybe": "The last message ({name}) may already have gone out: check your Sent folder before going on.", "send.err.other": "Sending stopped: {why}.",
      "sheet.title": "SIGN-IN SHEET", "sheet.no": "#", "sheet.name": "Full name", "sheet.sign": "Signature", "sheet.page": "Page {i} of {n}",
      "badge.check": "Check this certificate",
      "wd": "Sun,Mon,Tue,Wed,Thu,Fri,Sat",
      "toast.added0": "No one new was added.", "toast.added": "{n} added to the list.", "toast.added1": "1 added to the list.",
      "toast.dup": "{n} were already on the list.", "toast.over": "The list is full: {n} were left out.",
      "toast.numbered1": "1 number given.", "toast.numbered": "{n} numbers given.", "toast.numbered0": "Everyone already has a number.",
      "toast.saved": "Saved.", "toast.savedN": "{n} PDFs saved in Files › {p}.", "toast.noFiles": "The orOS disk is not available here.",
      "toast.picFail": "That picture could not be used.", "toast.fileFail": "That file could not be read.", "toast.fileBig": "That file is too large.",
      "toast.pdfFail": "The PDF could not be made.", "toast.fontFail": "The fonts could not be loaded. Certificates may look different until they do.",
      "toast.dupDone": "Duplicated, without the list.", "toast.deleted": "Deleted.", "toast.cleared": "The list is empty.",
      "toast.mailSent": "Opened in Mail.", "toast.mailHint": "Your mail app opened: attach the PDF that was just saved.",
      "toast.printMany": "Printing works for up to {n} certificates at a time. Use the PDF for more.",
      "toast.nothing": "Nothing to save: the list is empty.", "toast.empty": "Please type a name.",
      "work.pdf": "Making the PDF…", "work.zip": "Making PDF {i} of {n}…", "work.files": "Saving PDF {i} of {n}…", "work.print": "Preparing page {i} of {n}…",
      "untitled": "Untitled", "copyOf": "{t} (copy)",
      "mail.subject": "Your certificate: {t}", "mail.subjectNoT": "Your certificate",
      "mail.body": "Hello {n},\n\nPlease find attached your certificate{tt}.\n\nKind regards,\n{i}",
      "standalone": "Opened on its own: saving to files and sync need orOS."
    },
    el: {
      "app.name": "Πιστοποιητικά", "loading": "Φόρτωση γραμματοσειρών…",
      "home.empty": "Φτιάξε βεβαιώσεις παρακολούθησης, πιστοποιητικά ολοκλήρωσης, επαίνους και άλλα. Σχεδίασε ένα, πρόσθεσε τα ονόματα και αποθήκευσε PDF για κάθε άτομο, με αριθμό.",
      "btn.first": "Φτιάξε πιστοποιητικά", "home.q": "Αναζήτηση", "home.count1": "1 σειρά πιστοποιητικών", "home.count": "{n} σειρές πιστοποιητικών",
      "home.none": "Δεν βρέθηκε κάτι.", "ev.people0": "Κανένα άτομο ακόμα", "ev.people1": "1 άτομο", "ev.people": "{n} άτομα",
      "btn.new": "Νέα πιστοποιητικά", "btn.more": "Περισσότερα", "btn.home": "Όλα τα πιστοποιητικά", "btn.close": "Κλείσιμο",
      "tab.design": "Σχέδιο", "tab.people": "Άτομα", "tab.issue": "Έκδοση",
      "sec.details": "Για ποιο λόγο", "f.t": "Σεμινάριο, πρόγραμμα ή εκδήλωση", "f.issuer": "Εκδίδεται από (φορέας)",
      "f.d1": "Από", "f.d2": "Έως (αν κράτησε μέρες)", "f.place": "Τόπος", "f.hours": "Ώρες", "f.idate": "Ημερομηνία έκδοσης",
      "sec.look": "Είδος και εμφάνιση", "f.kind": "Είδος", "f.lang": "Γλώσσα του πιστοποιητικού", "f.sty": "Εμφάνιση",
      "f.acc": "Κύριο χρώμα", "f.acc2": "Δεύτερο χρώμα", "f.font": "Γραμματοσειρά", "font.serif": "Με πατούρες (Noto Serif)", "font.sans": "Χωρίς πατούρες (Noto Sans)",
      "f.size": "Χαρτί", "f.orient": "Προσανατολισμός", "orient.l": "Οριζόντιο", "orient.p": "Κατακόρυφο",
      "kind.attend": "Παρακολούθηση", "kind.complete": "Ολοκλήρωση", "kind.award": "Έπαινος", "kind.excel": "Αριστεία",
      "kind.diploma": "Δίπλωμα", "kind.particip": "Συμμετοχή", "kind.train": "Κατάρτιση", "kind.thanks": "Ευχαριστήριο",
      "kind.volunteer": "Εθελοντισμός", "kind.kids": "Βραβείο για παιδιά",
      "kindsub.attend": "Σεμινάριο, εργαστήριο", "kindsub.complete": "Μάθημα, πρόγραμμα", "kindsub.award": "Για μια επίδοση",
      "kindsub.excel": "Κορυφαία επίδοση", "kindsub.diploma": "Με ή χωρίς βαθμό", "kindsub.particip": "Συνέδριο, εκδήλωση",
      "kindsub.train": "Ώρες κατάρτισης", "kindsub.thanks": "Ομιλητές, χορηγοί", "kindsub.volunteer": "Ώρες προσφοράς",
      "kindsub.kids": "Σχολείο, όμιλοι, σπίτι",
      "sty.classic": "Κλασικό", "sty.modern": "Μοντέρνο", "sty.elegant": "Κομψό", "sty.bold": "Έντονο", "sty.minimal": "Λιτό", "sty.kids": "Παιχνιδιάρικο",
      "sec.texts": "Κείμενα", "texts.hint": "Πάτα ένα πεδίο για να μπει εκεί που είναι ο κέρσορας. Στη θέση του μπαίνουν τα στοιχεία κάθε ατόμου. Ένα κομμάτι ανάμεσα σε [[ και ]] φαίνεται μόνο όταν τα πεδία του έχουν τιμή.",
      "tx.sub": "Πάνω από τον τίτλο", "tx.head": "Τίτλος", "tx.pre": "Πριν από το όνομα", "tx.nm": "Γραμμή ονόματος", "tx.body": "Κείμενο",
      "tx.foot": "Τόπος και ημερομηνία", "tx.no": "Γραμμή αριθμού", "btn.resetTexts": "Έτοιμα κείμενα για αυτό το είδος",
      "tok.name": "Όνομα", "tok.name2": "Άλλη μορφή ονόματος", "tok.grade": "Βαθμός", "tok.extra": "Επιπλέον", "tok.title": "Σεμινάριο ή πρόγραμμα",
      "tok.dates": "Ημερομηνίες", "tok.date": "Ημερομηνία έκδοσης", "tok.place": "Τόπος", "tok.hours": "Ώρες", "tok.issuer": "Φορέας", "tok.serial": "Αριθμός",
      "sec.pics": "Λογότυπο, υπογραφές και σφραγίδα", "pic.logo": "Λογότυπο", "pic.seal": "Σφραγίδα", "pic.sigs": "Υπογραφές",
      "pic.none": "Καμία", "pic.missing": "Η εικόνα δεν έχει φτάσει ακόμα σε αυτή τη συσκευή.", "btn.pick": "Επιλογή εικόνας", "btn.change": "Αλλαγή",
      "btn.removePic": "Αφαίρεση", "btn.addSig": "Προσθήκη υπογραφής", "btn.draw": "Υπογραφή στην οθόνη", "btn.sigImg": "Εικόνα υπογραφής",
      "btn.removeSig": "Αφαίρεση αυτής της υπογραφής", "f.sigN": "Όνομα", "f.sigR": "Ιδιότητα", "f.medal": "Ένα μετάλλιο όταν δεν υπάρχει σφραγίδα",
      "sec.number": "Αριθμοί", "f.showNo": "Να φαίνεται ο αριθμός του πιστοποιητικού", "f.pre": "Ο αριθμός ξεκινά με", "f.next": "Επόμενος αριθμός",
      "no.example": "Ο επόμενος αριθμός θα είναι {s}. Οι αριθμοί δίνονται με τη σειρά της λίστας, μία φορά, και δεν ξαναχρησιμοποιούνται.",
      "f.n": "Ονοματεπώνυμο", "f.em": "Email", "btn.add": "Προσθήκη", "btn.paste": "Επικόλληση λίστας", "btn.file": "Άνοιγμα αρχείου (CSV, Excel)",
      "btn.contacts": "Από τις Επαφές", "btn.crm": "Από το CRM", "ppl.q": "Βρες ένα άτομο",
      "ppl.empty": "Δεν υπάρχει κανείς στη λίστα ακόμα. Πρόσθεσε ονόματα ένα ένα, επικόλλησε μια λίστα ή άνοιξε έναν πίνακα (CSV ή Excel) με μια στήλη για το όνομα.",
      "ppl.count0": "Κανένα άτομο", "ppl.count1": "1 άτομο", "ppl.count": "{n} άτομα", "ppl.more": "Εμφάνιση {n} ακόμα", "ppl.none": "Δεν ταιριάζει κανείς.",
      "ppl.noNo": "χωρίς αριθμό", "ppl.rv": "ανακλήθηκε",
      "paste.title": "Επικόλληση λίστας", "paste.hint": "Ένα άτομο ανά γραμμή. Δουλεύει και πίνακας από υπολογιστικό φύλλο: μια πρώτη γραμμή με ονόματα στηλών (ονοματεπώνυμο, email, βαθμός…) λέει ποια στήλη είναι ποια.",
      "paste.found1": "Βρέθηκε 1 άτομο.", "paste.found": "Βρέθηκαν {n} άτομα.", "paste.cols": "Στήλες: {c}.", "paste.nothing": "Δεν βρέθηκαν ονόματα ακόμα.",
      "btn.sample": "Αποθήκευση πίνακα-παραδείγματος", "btn.addAll": "Προσθήκη στη λίστα",
      "col.n": "όνομα", "col.n2": "άλλη μορφή", "col.em": "email", "col.g": "βαθμός", "col.x": "επιπλέον",
      "person.title": "Άτομο", "f.n2": "Άλλη μορφή του ονόματος (προαιρετικά)", "f.g": "Βαθμός ή διάκριση", "f.x": "Επιπλέον",
      "f.rv": "Ανακλήθηκε (δεν ισχύει πια)", "btn.remove": "Αφαίρεση από τη λίστα", "btn.mailOne": "Αποστολή με email", "btn.save": "Αποθήκευση",
      "pe.no": "Αριθμός {s}, δόθηκε στις {d}.", "pe.noNone": "Χωρίς αριθμό ακόμα: οι αριθμοί δίνονται στην καρτέλα Έκδοση.",
      "sec.check": "Έλεγχος", "btn.number": "Δώσε αριθμούς",
      "chk.none": "Δεν υπάρχει κανείς στη λίστα ακόμα.", "chk.toPeople": "Πρόσθεσε άτομα",
      "chk.count": "{n} πιστοποιητικά: {a} με αριθμό, {b} χωρίς.", "chk.allNo": "{n} πιστοποιητικά, όλα με αριθμό.",
      "chk.missing": "Το σχέδιο χρησιμοποιεί «{f}», αλλά είναι κενό.", "chk.fill": "Συμπλήρωση",
      "chk.grade": "Κάποια άτομα δεν έχουν βαθμό: το κομμάτι με τον βαθμό παραλείπεται για αυτά.",
      "chk.dup": "Ο αριθμός {s} δόθηκε δύο φορές (δύο συσκευές ταυτόχρονα).", "chk.fix": "Δώσε νέο αριθμό",
      "chk.rv1": "1 πιστοποιητικό έχει ανακληθεί.", "chk.rv": "{n} πιστοποιητικά έχουν ανακληθεί.",
      "chk.name2": "Κάποια άτομα δεν έχουν άλλη μορφή ονόματος: χρησιμοποιείται το όνομα όπως γράφτηκε.",
      "chk.ok": "Ό,τι χρειάζεται το σχέδιο είναι συμπληρωμένο.",
      "sec.save": "Αποθήκευση και εκτύπωση", "f.skipRv": "Να μη μπουν όσα έχουν ανακληθεί",
      "btn.pdfAll": "PDF με όλους", "btn.zip": "ZIP, ένα PDF ο καθένας", "btn.files": "Αποθήκευση στα Αρχεία", "btn.print": "Εκτύπωση",
      "btn.pdfOne": "PDF αυτού", "btn.pngOne": "Εικόνα (PNG) αυτού", "btn.mail": "Αποστολή με email…", "btn.register": "Μητρώο (CSV)",
      "pv.who": "Ποιανού το πιστοποιητικό", "pv.sample": "Παράδειγμα: {n}", "pv.prev": "Προηγούμενο άτομο", "pv.next": "Επόμενο άτομο",
      "pv.alt": "Προεπισκόπηση του πιστοποιητικού", "pv.note": "Παράδειγμα. Πρόσθεσε άτομα για να δεις το πιστοποιητικό του καθενός.",
      "sample.name": "Μαρία Παπαδοπούλου",
      "more.title": "Αυτά τα πιστοποιητικά", "btn.dup": "Αντίγραφο (μόνο το σχέδιο)", "btn.clear": "Άδειασμα της λίστας ατόμων",
      "btn.del": "Διαγραφή αυτών των πιστοποιητικών",
      "more.hint": "Τα πιστοποιητικά και οι λίστες σου σε ακολουθούν σε κάθε συσκευή μέσω του συγχρονισμού του orOS, κρυπτογραφημένα. Οι εικόνες τους ταξιδεύουν με τον δίσκο του orOS.",
      "new.title": "Νέα πιστοποιητικά", "btn.create": "Δημιουργία",
      "draw.title": "Υπόγραψε εδώ", "draw.hint": "Υπόγραψε με το δάχτυλο, μια γραφίδα ή το ποντίκι.", "btn.clearPad": "Καθαρισμός", "btn.useSig": "Χρήση αυτής της υπογραφής",
      "pick.q": "Αναζήτηση", "pick.none": "Δεν υπάρχει κάτι εδώ.", "pick.ct": "Προσθήκη από τις Επαφές", "pick.crm": "Προσθήκη από το CRM",
      "pick.all": "Όλοι ({n})", "pick.label": "{l} ({n})",
      "pick.mail": "Αποστολή με email", "pick.mailHint": "Ένα μήνυμα για κάθε άτομο, με το PDF συνημμένο όταν το orOS Mail είναι ρυθμισμένο σε αυτή τη συσκευή.",
      "pick.noMail": "Κανείς στη λίστα δεν έχει διεύθυνση email.",
      "btn.cancel": "Άκυρο", "btn.yes": "Ναι", "btn.no": "Όχι", "btn.delete": "Διαγραφή", "btn.replace": "Αντικατάσταση", "btn.keep": "Κράτα τα κείμενά μου",
      "btn.numberFirst": "Δώσε αριθμούς", "btn.without": "Χωρίς αριθμούς",
      "ask.kind": "Να μπουν τα έτοιμα κείμενα αυτού του είδους στη θέση των δικών σου;",
      "ask.lang": "Να μπουν τα έτοιμα κείμενα σε αυτή τη γλώσσα στη θέση των δικών σου;",
      "ask.del": "Διαγραφή του «{name}» και της λίστας του με {n} άτομα; Δεν αναιρείται.",
      "ask.clear": "Να αφαιρεθούν και τα {n} άτομα από τη λίστα; Οι αριθμοί τους μένουν δεσμευμένοι.",
      "ask.remove": "Αφαίρεση του ατόμου {name} από τη λίστα;",
      "ask.numbers": "{n} άτομα δεν έχουν αριθμό ακόμα. Να πάρουν αριθμούς πρώτα;",
      "ask.reset": "Να επανέλθουν τα έτοιμα κείμενα αυτού του είδους;",
      "toast.saveFail": "Δεν έγινε αποθήκευση: ο χώρος της συσκευής γέμισε.", "toast.full": "Δεν υπάρχει χώρος για άλλα.",
      "sec.check": "Κωδικός ελέγχου (QR)", "f.qr": "Κωδικός QR που δείχνει ότι το πιστοποιητικό είναι γνήσιο",
      "qr.hint": "Όποιος το σκανάρει με το κινητό βλέπει τα στοιχεία που υπέγραψες: αριθμό, όνομα, σεμινάριο, ημερομηνίες και φορέα. Δουλεύει χωρίς server και δεν στέλνεται τίποτα πουθενά.",
      "qr.none": "Αυτός ο browser δεν μπορεί να υπογράψει κωδικούς.", "qr.fp": "Το κλειδί σου:",
      "qr.fpHint": "Βάλε αυτό το κλειδί στον ιστότοπό σου ή κάτω από τα email σου. Η σελίδα ελέγχου το δείχνει, ώστε να φαίνεται ότι το πιστοποιητικό προέρχεται πράγματι από εσένα.",
      "btn.copyFp": "Αντιγραφή του κλειδιού", "btn.openCheck": "Άνοιγμα της σελίδας ελέγχου",
      "qr.copyText": "Τα πιστοποιητικά μας φέρουν κωδικό QR υπογεγραμμένο με το κλειδί orOS {fp}.",
      "toast.copied": "Αντιγράφηκε.", "toast.noCrypto": "Αυτός ο browser δεν μπορεί να φτιάξει τον κωδικό ελέγχου.",
      "btn.atAll": "Ήρθαν όλοι", "btn.atNone": "Καθάρισμα των σημαδιών", "btn.sheet": "Παρουσιολόγιο (PDF)", "ppl.at": "Ήρθε: {n}",
      "f.onlyAt": "Μόνο για όσους σημειώθηκαν παρόντες", "btn.badges": "Open Badges (ZIP)",
      "chk.at": "{a} από {n} άτομα σημειώθηκαν παρόντες· μόνο αυτά παίρνουν πιστοποιητικό.", "chk.at0": "Κανείς δεν έχει σημειωθεί παρών ακόμα.",
      "toast.at": "Σημειώθηκαν: {n}.", "work.badges": "Open Badges {i} από {n}…", "toast.badges": "Τα Open Badges χρειάζονται browser που μπορεί να υπογράψει.",
      "btn.sendAll": "Email σε όλους…", "send.title": "Email σε όλους",
      "send.hint": "Κάθε άτομο παίρνει ένα μήνυμα με το δικό του πιστοποιητικό συνημμένο, από τον λογαριασμό σου στο orOS Mail. Κράτα το orOS ανοιχτό και μπροστά όσο στέλνει.",
      "send.from": "Αποστολή από", "send.rate": "Μηνύματα την ώρα, το πολύ",
      "send.rateHint": "Οι πάροχοι email βάζουν όριο στα μηνύματα (συχνά 100 έως 300 την ώρα, περίπου 500 τη μέρα στο Gmail). Η αποστολή σταματά στην πρώτη τέτοια άρνηση.",
      "send.again": "Και σε όσους έχουν ήδη λάβει το δικό τους", "send.go": "Έναρξη αποστολής", "send.pause": "Παύση", "send.resume": "Συνέχεια",
      "send.left": "{n} για αποστολή.", "send.left1": "1 για αποστολή.", "send.none": "Όλοι όσοι έχουν email έχουν ήδη λάβει το δικό τους.",
      "send.noMail": "Κανείς στη λίστα δεν έχει διεύθυνση email.", "send.step": "Αποστολή {i} από {n}: {name}…",
      "send.sent": "Στάλθηκαν {s} από {n}.", "send.done": "Έτοιμο: στάλθηκαν {s}.", "send.doneFail": "Έτοιμο: στάλθηκαν {s}. Δεν παραδόθηκαν (η διεύθυνση απορρίφθηκε): {list}.",
      "send.paused": "Σε παύση: στάλθηκαν {s} από {n}. Πάτα «Συνέχεια» για να συνεχίσεις.",
      "send.err.rate": "Ο server email δεν δέχεται άλλα μηνύματα προς το παρόν (το όριό του). Περίμενε λίγο ή μείωσε τα μηνύματα την ώρα και συνέχισε.",
      "send.err.auth": "Ο server email δεν δέχτηκε τον κωδικό. Έλεγξε τον λογαριασμό στο orOS Mail.",
      "send.err.nopass": "Ο κωδικός αυτού του λογαριασμού δεν υπάρχει σε αυτή τη συσκευή. Άνοιξε πρώτα τον λογαριασμό στο orOS Mail εδώ.",
      "send.err.offline": "Δεν υπάρχει σύνδεση. Συνέχισε όταν συνδεθείς ξανά.", "send.maybe": "Το τελευταίο μήνυμα ({name}) ίσως έχει ήδη φύγει: έλεγξε τα Απεσταλμένα πριν συνεχίσεις.", "send.err.other": "Η αποστολή σταμάτησε: {why}.",
      "sheet.title": "ΠΑΡΟΥΣΙΟΛΟΓΙΟ", "sheet.no": "#", "sheet.name": "Ονοματεπώνυμο", "sheet.sign": "Υπογραφή", "sheet.page": "Σελίδα {i} από {n}",
      "badge.check": "Έλεγχος του πιστοποιητικού",
      "wd": "Κυρ,Δευ,Τρί,Τετ,Πέμ,Παρ,Σάβ",
      "toast.added0": "Δεν προστέθηκε κανείς καινούριος.", "toast.added": "Προστέθηκαν {n} στη λίστα.", "toast.added1": "Προστέθηκε 1 στη λίστα.",
      "toast.dup": "{n} υπήρχαν ήδη στη λίστα.", "toast.over": "Η λίστα γέμισε: {n} έμειναν εκτός.",
      "toast.numbered1": "Δόθηκε 1 αριθμός.", "toast.numbered": "Δόθηκαν {n} αριθμοί.", "toast.numbered0": "Όλοι έχουν ήδη αριθμό.",
      "toast.saved": "Αποθηκεύτηκε.", "toast.savedN": "Αποθηκεύτηκαν {n} PDF στα Αρχεία › {p}.", "toast.noFiles": "Ο δίσκος του orOS δεν είναι διαθέσιμος εδώ.",
      "toast.picFail": "Αυτή η εικόνα δεν μπορεί να χρησιμοποιηθεί.", "toast.fileFail": "Αυτό το αρχείο δεν διαβάστηκε.", "toast.fileBig": "Το αρχείο είναι πολύ μεγάλο.",
      "toast.pdfFail": "Το PDF δεν έγινε.", "toast.fontFail": "Οι γραμματοσειρές δεν φορτώθηκαν. Τα πιστοποιητικά μπορεί να φαίνονται διαφορετικά μέχρι να φορτωθούν.",
      "toast.dupDone": "Έγινε αντίγραφο, χωρίς τη λίστα.", "toast.deleted": "Διαγράφηκε.", "toast.cleared": "Η λίστα άδειασε.",
      "toast.mailSent": "Άνοιξε στο Mail.", "toast.mailHint": "Άνοιξε η εφαρμογή email: επισύναψε το PDF που μόλις αποθηκεύτηκε.",
      "toast.printMany": "Η εκτύπωση δουλεύει για έως {n} πιστοποιητικά τη φορά. Για περισσότερα χρησιμοποίησε το PDF.",
      "toast.nothing": "Δεν υπάρχει κάτι για αποθήκευση: η λίστα είναι άδεια.", "toast.empty": "Γράψε ένα όνομα.",
      "work.pdf": "Ετοιμάζεται το PDF…", "work.zip": "PDF {i} από {n}…", "work.files": "Αποθήκευση PDF {i} από {n}…", "work.print": "Σελίδα {i} από {n}…",
      "untitled": "Χωρίς τίτλο", "copyOf": "{t} (αντίγραφο)",
      "mail.subject": "Το πιστοποιητικό σας: {t}", "mail.subjectNoT": "Το πιστοποιητικό σας",
      "mail.body": "Καλησπέρα σας,\n\nσας στέλνουμε συνημμένο το πιστοποιητικό σας{tt}.\n\nΜε εκτίμηση,\n{i}",
      "standalone": "Άνοιξε μόνο του: η αποθήκευση αρχείων και ο συγχρονισμός χρειάζονται το orOS."
    }
  };
  function t(k, vars) {
    var s = (STRINGS[LANG] && STRINGS[LANG][k] !== undefined) ? STRINGS[LANG][k] : (STRINGS.en[k] !== undefined ? STRINGS.en[k] : k);
    if (vars && typeof s === "string") s = s.replace(/\{(\w+)\}/g, function (m, n) { return vars[n] !== undefined ? vars[n] : m; });
    return s;
  }
  // Texts written in the certificate's language (email).
  function tIn(lang, k, vars) {
    var keep = LANG;
    LANG = lang === "el" ? "el" : "en";
    var s = t(k, vars);
    LANG = keep;
    return s;
  }

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
  function todayKey() {
    var d = new Date();
    return d.getFullYear() + "-" + ("0" + (d.getMonth() + 1)).slice(-2) + "-" + ("0" + d.getDate()).slice(-2);
  }
  function readJSON(key) {
    try { var r = localStorage.getItem(key); return r ? JSON.parse(r) : null; } catch (e) { return null; }
  }
  function now() { return Date.now(); }
  function wait(ms) { return new Promise(function (r) { setTimeout(r, ms || 0); }); }

  var ICON = {
    plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>',
    more: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/></svg>',
    close: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>',
    back: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 18l-6-6 6-6"/></svg>',
    next: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 18l6-6-6-6"/></svg>'
  };

  // ---------- 2. State + storage ----------
  var data = C.empty();
  var prefs = C.normPrefs(null);
  var ev = null;                 // the open event (a working copy)
  var saveTimer = 0;
  var fontsReady = false;
  var pvId = "";                 // person shown in the preview ("" = example)

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
    if (!ev) return;
    var old = C.eventById(data, ev.id);
    if (old) {
      var a = JSON.parse(JSON.stringify(ev)), b = JSON.parse(JSON.stringify(old));
      a.m = b.m = 0;
      if (JSON.stringify(a) === JSON.stringify(b)) return;
    }
    var r = C.putEvent(data, ev, now());
    if (!r.ok) { if (r.why === "full") toast(t("toast.full")); return; }
    data = r.data;
    ev = JSON.parse(JSON.stringify(r.ev));
    storeData();
  }
  // An edit of the open event: fn(ev) changes the working copy.
  function change(fn, opts) {
    if (!ev) return;
    fn(ev);
    ev = C.normEvent(Object.assign({}, ev, { m: ev.m || 1 })) || ev;
    saveSoon();
    if (!opts || !opts.quiet) renderForm();
    renderPreviewSoon();
  }
  function people() { return ev ? C.eventPeople(data, ev.id) : []; }
  function evTitle(e) { return (e && e.t) || (e ? t("kind." + e.kind) : "") || t("untitled"); }

  // ---------- 3. Views: home, editor, tabs ----------
  function showHome() {
    if (saveTimer) saveNow();
    ev = null;
    prefs.cur = ""; savePrefs();
    $("ed").hidden = true;
    $("home").hidden = false;
    $("home-btn").hidden = true;
    $("more-btn").hidden = true;
    $("new-btn").hidden = false;
    hideDlg();
    renderHome();
  }
  var thumbs = {};
  function thumbOf(e) {
    var ppl = C.eventPeople(data, e.id), first = ppl[0] || null;
    var key = e.id + ":" + e.m + ":" + (first ? first.id + first.m : "");
    if (thumbs[e.id] && thumbs[e.id].key === key) return thumbs[e.id].url;
    if (!fontsReady) return "";
    try {
      var cv = drawPage(e, first, 300 * Math.min(2, window.devicePixelRatio || 1));
      var url = cv.toDataURL("image/png");
      thumbs[e.id] = { key: key, url: url };
      return url;
    } catch (x) { return ""; }
  }
  function renderHome() {
    var list = C.eventList(data), host = $("evs");
    host.textContent = "";
    $("home-empty").hidden = list.length > 0;
    $("home-q").hidden = list.length < 7;
    $("title-main").textContent = t("app.name");
    $("title-sub").textContent = list.length === 1 ? t("home.count1") : list.length ? t("home.count", { n: list.length }) : "";
    var q = C.fold($("home-q").value);
    var shown = list.filter(function (e) { return !q || C.fold(evTitle(e) + " " + e.issuer + " " + e.place).indexOf(q) >= 0; });
    if (list.length && !shown.length) host.appendChild(el("p", "hint", t("home.none")));
    shown.forEach(function (e) {
      var card = el("button", "ev-card");
      card.type = "button";
      var th = el("div", "ev-thumb");
      var url = thumbOf(e);
      if (url) { var img = el("img"); img.src = url; img.alt = ""; th.appendChild(img); }
      card.appendChild(th);
      card.appendChild(el("span", "ev-title", evTitle(e)));
      var n = C.countPeople(data, e.id);
      card.appendChild(el("span", "ev-sub", t("kind." + e.kind) + " · " + (n === 0 ? t("ev.people0") : n === 1 ? t("ev.people1") : t("ev.people", { n: n }))));
      card.addEventListener("click", function () { openEvent(e.id); });
      host.appendChild(card);
    });
  }
  function openEvent(id, tab) {
    var e = C.eventById(data, id);
    if (!e) { showHome(); return; }
    if (saveTimer) saveNow();
    ev = JSON.parse(JSON.stringify(e));
    prefs.cur = ev.id;
    if (tab) prefs.tab = tab;
    savePrefs();
    pvId = "";
    var ppl = people();
    if (ppl.length) pvId = ppl[0].id;
    pplShown = PAGE;
    $("ppl-q").value = "";
    $("home").hidden = true;
    $("ed").hidden = false;
    $("home-btn").hidden = false;
    $("more-btn").hidden = false;
    $("new-btn").hidden = true;
    renderForm();
    renderStyles();
    renderPeople();
    showTab(prefs.tab);
    renderPreviewSoon(0);
  }
  function showTab(k) {
    prefs.tab = ["design", "people", "issue"].indexOf(k) >= 0 ? k : "design";
    savePrefs();
    ["design", "people", "issue"].forEach(function (x) {
      var b = $("tab-" + x), on = x === prefs.tab;
      b.classList.toggle("on", on);
      b.setAttribute("aria-selected", on ? "true" : "false");
      b.tabIndex = on ? 0 : -1;
      document.body.classList.toggle("tab-" + x, on);
    });
    if (prefs.tab === "issue") renderChecks();
    if (prefs.tab === "people") renderPeople();
    renderPreviewSoon(0);
  }

  // New
  var newKind = "attend";
  function openNew() {
    newKind = "attend";
    $("new-t").value = "";
    $("new-lang").value = LANG;
    renderNewKinds();
    showDlg("new");
    $("new-t").focus();
  }
  function renderNewKinds() {
    var host = $("new-kinds");
    host.textContent = "";
    C.KINDS.forEach(function (k) {
      var b = el("button", "kind" + (k === newKind ? " on" : ""));
      b.type = "button";
      b.setAttribute("role", "radio");
      b.setAttribute("aria-checked", k === newKind ? "true" : "false");
      b.tabIndex = k === newKind ? 0 : -1;
      b.setAttribute("data-kind", k);
      b.appendChild(document.createTextNode(t("kind." + k)));
      b.appendChild(el("small", null, t("kindsub." + k)));
      b.addEventListener("click", function () { newKind = k; renderNewKinds(); var f = $("new-kinds").querySelector('[data-kind="' + k + '"]'); if (f) f.focus(); });
      host.appendChild(b);
    });
  }
  function createEvent() {
    if (data.evs.length >= C.LIM.events) { toast(t("toast.full")); return; }
    var e = C.blankEvent(C.newId("e"), now(), $("new-lang").value, newKind, todayKey());
    e.t = C.line($("new-t").value, C.LIM.title);
    // a new set keeps the organisation, logo, signatures and seal of the last one
    var last = C.eventList(data)[0];
    if (last) {
      e.issuer = last.issuer;
      e.logo = last.logo; e.seal = last.seal;
      if (last.sigs.some(function (s) { return s.n || s.a; })) e.sigs = JSON.parse(JSON.stringify(last.sigs));
    }
    var r = C.putEvent(data, e, now());
    if (!r.ok) { toast(t("toast.full")); return; }
    data = r.data;
    storeData();
    hideDlg();
    openEvent(r.ev.id, "design");
  }

  // ---------- 4. Design form ----------
  var FIELDS = ["t", "issuer", "d1", "d2", "place", "hours", "idate"];
  function renderForm() {
    if (!ev) return;
    $("title-main").textContent = evTitle(ev);
    $("title-sub").textContent = t("kind." + ev.kind);
    FIELDS.forEach(function (k) { var n = $("f-" + k); if (document.activeElement !== n) n.value = ev[k] || ""; });
    $("f-kind").value = ev.kind;
    $("f-lang").value = ev.lang;
    $("f-acc").value = ev.acc; $("f-acc2").value = ev.acc2;
    $("f-font").value = ev.font; $("f-size").value = ev.size; $("f-orient").value = ev.orient;
    C.TXT_KEYS.forEach(function (k) { var n = $("tx-" + k); if (document.activeElement !== n) n.value = ev.txt[k] || ""; });
    $("f-medal").checked = !!ev.medal;
    $("f-showNo").checked = !!ev.showNo;
    renderCheck();
    if (document.activeElement !== $("f-pre")) $("f-pre").value = ev.pre;
    if (document.activeElement !== $("f-next")) $("f-next").value = String(Math.max(ev.next, C.maxNo(data, ev.id) + 1));
    $("no-example").textContent = t("no.example", { s: C.serial(ev, Math.max(ev.next, C.maxNo(data, ev.id) + 1)) });
    [].forEach.call($("stys").querySelectorAll(".tpl"), function (b) {
      var on = b.getAttribute("data-sty") === ev.sty;
      b.classList.toggle("on", on); b.setAttribute("aria-checked", on ? "true" : "false"); b.tabIndex = on ? 0 : -1;
    });
    renderPics();
  }
  function readDetails() {
    change(function (e) {
      FIELDS.forEach(function (k) { e[k] = $("f-" + k).value; });
      C.TXT_KEYS.forEach(function (k) { e.txt[k] = $("tx-" + k).value; });
      e.acc = $("f-acc").value; e.acc2 = $("f-acc2").value;
      e.font = $("f-font").value; e.size = $("f-size").value; e.orient = $("f-orient").value;
      e.medal = $("f-medal").checked ? 1 : 0; e.showNo = $("f-showNo").checked ? 1 : 0;
      e.pre = $("f-pre").value;
      var nx = parseInt($("f-next").value, 10);
      if (nx >= 1 && nx <= 999999) e.next = nx;
    }, { quiet: true });
    $("title-main").textContent = evTitle(ev);
    $("no-example").textContent = t("no.example", { s: C.serial(ev, Math.max(ev.next, C.maxNo(data, ev.id) + 1)) });
  }
  function onKind() {
    var k = $("f-kind").value;
    if (!ev || k === ev.kind) return;
    var apply = function (replace) {
      change(function (e) {
        var n = replace ? C.applyKind(e, k) : Object.assign({}, e, { kind: k });
        Object.keys(n).forEach(function (x) { e[x] = n[x]; });
      });
    };
    if (C.textsEdited(ev)) ask(t("ask.kind"), t("btn.replace"), function () { apply(true); }, t("btn.keep"), function () { apply(false); });
    else apply(true);
  }
  function onLang() {
    var l = $("f-lang").value;
    if (!ev || l === ev.lang) return;
    var apply = function (replace) {
      change(function (e) {
        var n = replace ? C.applyLang(e, l) : Object.assign({}, e, { lang: l });
        Object.keys(n).forEach(function (x) { e[x] = n[x]; });
      });
      renderStyles();
    };
    if (C.textsEdited(ev)) ask(t("ask.lang"), t("btn.replace"), function () { apply(true); }, t("btn.keep"), function () { apply(false); });
    else apply(true);
  }
  function resetTexts() {
    if (!ev) return;
    ask(t("ask.reset"), t("btn.replace"), function () {
      change(function (e) { e.txt = C.kindTexts(e.lang, e.kind); });
    });
  }
  // The look buttons, each with a small picture of the certificate.
  function renderStyles() {
    var host = $("stys");
    host.textContent = "";
    if (!ev) return;
    C.STYLES.forEach(function (s) {
      var b = el("button", "tpl" + (s === ev.sty ? " on" : ""));
      b.type = "button";
      b.setAttribute("role", "radio");
      b.setAttribute("data-sty", s);
      b.setAttribute("aria-checked", s === ev.sty ? "true" : "false");
      b.tabIndex = s === ev.sty ? 0 : -1;
      if (fontsReady) {
        try {
          var e = C.applyStyle(ev, s);
          e.logo = null; e.seal = null; e.sigs = e.sigs.map(function (x) { return { n: x.n, r: x.r }; });
          var cv = drawPage(e, null, 72 * Math.min(2, window.devicePixelRatio || 1));
          cv.setAttribute("aria-hidden", "true");
          b.appendChild(cv);
        } catch (x) {}
      }
      b.appendChild(el("span", null, t("sty." + s)));
      b.addEventListener("click", function () { pickStyle(s); });
      host.appendChild(b);
    });
  }
  function pickStyle(s) {
    if (!ev || s === ev.sty) return;
    change(function (e) { var n = C.applyStyle(e, s); Object.keys(n).forEach(function (x) { e[x] = n[x]; }); });
    var f = $("stys").querySelector('[data-sty="' + s + '"]');
    if (f) f.focus();
  }
  // Field chips: put {field} where the cursor is in the last text field.
  var lastTx = "tx-body";
  function renderTokens() {
    var host = $("tokens");
    host.textContent = "";
    C.TOKENS.forEach(function (k) {
      var b = el("button", "chip small", t("tok." + k));
      b.type = "button";
      b.title = "{" + k + "}";
      b.addEventListener("mousedown", function (e) { e.preventDefault(); });
      b.addEventListener("click", function () { insertToken(k); });
      host.appendChild(b);
    });
  }
  function insertToken(k) {
    var n = $(lastTx) || $("tx-body"), tok = "{" + k + "}";
    var s = n.selectionStart, e = n.selectionEnd, v = n.value;
    if (typeof s !== "number") { s = e = v.length; }
    n.value = v.slice(0, s) + tok + v.slice(e);
    n.focus();
    try { n.setSelectionRange(s + tok.length, s + tok.length); } catch (x) {}
    readDetails();
  }

  // ---------- 5. Pictures and signatures ----------
  var assetUrls = {};
  function assetUrl(a) {
    if (assetUrls[a]) return Promise.resolve(assetUrls[a]);
    return A.load(a).then(function (img) {
      if (!img) return "";
      var cv = document.createElement("canvas"), k = Math.min(1, 320 / (img.naturalWidth || img.width || 1));
      cv.width = Math.max(1, Math.round((img.naturalWidth || img.width) * k));
      cv.height = Math.max(1, Math.round((img.naturalHeight || img.height) * k));
      cv.getContext("2d").drawImage(img, 0, 0, cv.width, cv.height);
      assetUrls[a] = cv.toDataURL("image/png");
      return assetUrls[a];
    }).catch(function () { return ""; });
  }
  function thumbInto(host, a) {
    assetUrl(a).then(function (u) {
      host.textContent = "";
      if (u) { var i = el("img"); i.src = u; i.alt = ""; host.appendChild(i); }
      else host.appendChild(el("span", "pic-note", t("pic.missing")));
    });
  }
  function renderPics() {
    picBlock($("pic-logo"), "logo");
    picBlock($("pic-seal"), "seal");
    renderSigs();
  }
  function picBlock(host, key) {
    host.textContent = "";
    host.appendChild(el("span", "lbl", t("pic." + key)));
    var im = ev[key];
    var th = el("div", "pic-thumb");
    if (im) thumbInto(th, im.a); else th.appendChild(el("span", null, t("pic.none")));
    host.appendChild(th);
    var row = el("div", "actions");
    var b = el("button", "chip small", im ? t("btn.change") : t("btn.pick"));
    b.type = "button";
    b.addEventListener("click", function () {
      pickImage().then(function (r) { if (r) change(function (e) { e[key] = { a: r.id, w: r.w, h: r.h }; }); });
    });
    row.appendChild(b);
    if (im) {
      var x = el("button", "chip small", t("btn.removePic"));
      x.type = "button";
      x.addEventListener("click", function () { change(function (e) { e[key] = null; }); });
      row.appendChild(x);
    }
    host.appendChild(row);
  }
  function renderSigs() {
    var host = $("sig-list");
    host.textContent = "";
    ev.sigs.forEach(function (s, i) {
      var li = el("li", "sig-row");
      var g = el("div", "grid");
      [["n", "f.sigN", C.LIM.sigName], ["r", "f.sigR", C.LIM.sigRole]].forEach(function (f) {
        var lab = el("label", "fld");
        lab.appendChild(el("span", null, t(f[1])));
        var inp = el("input");
        inp.maxLength = f[2];
        inp.autocomplete = "off";
        inp.value = s[f[0]] || "";
        inp.addEventListener("input", function () {
          change(function (e) { if (e.sigs[i]) e.sigs[i][f[0]] = inp.value; }, { quiet: true });
        });
        lab.appendChild(inp);
        g.appendChild(lab);
      });
      li.appendChild(g);
      var im = el("div", "sig-img");
      if (s.a) { var th = el("span"); thumbInto(th, s.a); im.appendChild(th); }
      var draw = el("button", "chip small", t("btn.draw"));
      draw.type = "button";
      draw.addEventListener("click", function () { openDraw(i); });
      im.appendChild(draw);
      var up = el("button", "chip small", t("btn.sigImg"));
      up.type = "button";
      up.addEventListener("click", function () {
        pickImage().then(function (r) { if (r) setSigImage(i, r); });
      });
      im.appendChild(up);
      if (s.a) {
        var rm = el("button", "chip small", t("btn.removePic"));
        rm.type = "button";
        rm.addEventListener("click", function () { change(function (e) { if (e.sigs[i]) { delete e.sigs[i].a; delete e.sigs[i].w; delete e.sigs[i].h; } }); });
        im.appendChild(rm);
      }
      li.appendChild(im);
      var del = el("button", "chip small danger-chip", t("btn.removeSig"));
      del.type = "button";
      del.addEventListener("click", function () { change(function (e) { e.sigs.splice(i, 1); }); });
      var row = el("div", "actions");
      row.appendChild(del);
      li.appendChild(row);
      host.appendChild(li);
    });
    $("sig-add").disabled = ev.sigs.length >= C.LIM.sigs;
  }
  function setSigImage(i, r) {
    change(function (e) { if (e.sigs[i]) { e.sigs[i].a = r.id; e.sigs[i].w = r.w; e.sigs[i].h = r.h; } });
  }
  function dialogHost() {
    try { if (window.parent && window.parent !== window && window.parent.orosDialog) return window.parent.orosDialog; } catch (e) {}
    return window.orosDialog || null;
  }
  // A file from the person (R33: through orosDialog when the shell is there).
  var fileWait = null;
  function openFile(accept) {
    var dlg = dialogHost();
    if (dlg && typeof dlg.openFile === "function") return Promise.resolve(dlg.openFile(accept)).catch(function () { return null; });
    return new Promise(function (resolve) {
      var inp = $("file-in");
      inp.accept = accept;
      inp.value = "";
      fileWait = resolve;
      inp.click();
    });
  }
  function pickImage() {
    return openFile("image/png,image/jpeg,image/gif,image/webp,image/svg+xml").then(function (f) {
      if (!f) return null;
      if (f.size > 25 * 1024 * 1024) { toast(t("toast.fileBig")); return null; }
      return A.importFile(f).then(function (r) {
        if (!r || !r.id) { toast(t("toast.picFail")); return null; }
        return r;
      });
    }).catch(function () { toast(t("toast.picFail")); return null; });
  }

  // Signing on the screen
  var drawIdx = -1, drawing = false, drawn = false, lastPt = null;
  function openDraw(i) {
    drawIdx = i;
    clearPad();
    showDlg("draw");
  }
  function clearPad() {
    var cv = $("draw-cv"), ctx = cv.getContext("2d");
    ctx.clearRect(0, 0, cv.width, cv.height);
    drawn = false;
    $("draw-go").disabled = true;
  }
  function padPoint(e) {
    var cv = $("draw-cv"), r = cv.getBoundingClientRect();
    return { x: (e.clientX - r.left) * cv.width / r.width, y: (e.clientY - r.top) * cv.height / r.height };
  }
  function wirePad() {
    var cv = $("draw-cv"), ctx = cv.getContext("2d");
    cv.addEventListener("pointerdown", function (e) {
      e.preventDefault();
      drawing = true;
      lastPt = padPoint(e);
      try { cv.setPointerCapture(e.pointerId); } catch (x) {}
      ctx.fillStyle = "#1b1b3a";
      ctx.beginPath(); ctx.arc(lastPt.x, lastPt.y, 2.2, 0, Math.PI * 2); ctx.fill();
    });
    cv.addEventListener("pointermove", function (e) {
      if (!drawing) return;
      var p = padPoint(e);
      ctx.strokeStyle = "#1b1b3a";
      ctx.lineWidth = e.pressure && e.pointerType === "pen" ? 2 + 4 * e.pressure : 4.2;
      ctx.lineCap = "round"; ctx.lineJoin = "round";
      ctx.beginPath(); ctx.moveTo(lastPt.x, lastPt.y); ctx.lineTo(p.x, p.y); ctx.stroke();
      lastPt = p;
      drawn = true;
      $("draw-go").disabled = false;
    });
    ["pointerup", "pointercancel", "pointerleave"].forEach(function (k) { cv.addEventListener(k, function () { drawing = false; }); });
  }
  // The drawn signature, cut to what was drawn, as a picture on the orOS disk.
  function useDrawing() {
    if (!drawn || drawIdx < 0) return;
    var cv = $("draw-cv"), ctx = cv.getContext("2d");
    var px = ctx.getImageData(0, 0, cv.width, cv.height).data, x0 = cv.width, y0 = cv.height, x1 = 0, y1 = 0;
    for (var y = 0; y < cv.height; y++) for (var x = 0; x < cv.width; x++) {
      if (px[(y * cv.width + x) * 4 + 3] > 8) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    }
    if (x1 <= x0 || y1 <= y0) return;
    var m = 10; x0 = Math.max(0, x0 - m); y0 = Math.max(0, y0 - m); x1 = Math.min(cv.width - 1, x1 + m); y1 = Math.min(cv.height - 1, y1 + m);
    var out = document.createElement("canvas");
    out.width = x1 - x0 + 1; out.height = y1 - y0 + 1;
    out.getContext("2d").drawImage(cv, x0, y0, out.width, out.height, 0, 0, out.width, out.height);
    var idx = drawIdx;
    hideDlg();
    out.toBlob(function (blob) {
      if (!blob) { toast(t("toast.picFail")); return; }
      var file;
      try { file = new File([blob], "signature.png", { type: "image/png" }); } catch (e) { file = blob; file.name = "signature.png"; }
      A.importFile(file).then(function (r) { if (r && r.id) setSigImage(idx, r); else toast(t("toast.picFail")); }, function () { toast(t("toast.picFail")); });
    }, "image/png");
  }

  // ---------- 6. Preview ----------
  function sample() {
    return { n: t("sample.name"), no: ev ? Math.max(ev.next, C.maxNo(data, ev.id) + 1) : 1 };
  }
  // One certificate on a fresh canvas `px` wide.
  function sampleOf(e) { return { n: tIn(e.lang, "sample.name"), no: Math.max(e.next, C.maxNo(data, e.id) + 1) }; }
  function drawPage(e, person, px, canvas) {
    var b = D.build(e, person ? [person] : [], { sample: sampleOf(e) });
    var doc = b.doc, L = R.computeLayout(doc), scale = px / doc.setup.w;
    var cv = R.renderPage(doc, doc.pages[0], L, scale, { canvas: canvas, getImage: A.get, background: "#ffffff" });
    var box = b.pages[0].qr, code = box && qrCached(e, person || sampleOf(e));
    if (code) {
      var ctx = cv.getContext("2d");
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      paintQr(code, box, function (x, y, w, h) {
        // whole device pixels: a sharp code at any size
        var x0 = Math.round(x * scale), y0 = Math.round(y * scale);
        ctx.fillRect(x0, y0, Math.round((x + w) * scale) - x0, Math.round((y + h) * scale) - y0);
      }, function (c) { ctx.fillStyle = c; });
      ctx.restore();
    }
    return cv;
  }

  // ---------- 6b. Check QR codes (wave 2) ----------
  // A signed link per certificate (sign.js), drawn as a QR code in the
  // white square dk.js keeps for it. Signing is async: codes are made
  // ahead (prepareQr) and kept by their exact fields.
  var subtle = (function () { try { return window.isSecureContext !== false && window.crypto && window.crypto.subtle || null; } catch (e) { return null; } })();
  var CHECK_HOME = "https://useoros.online/certificates/verify.html";
  function checkBase() {
    try {
      if (location.protocol === "https:") return new URL("verify.html", location.href).href.split(/[?#]/)[0];
    } catch (e) {}
    return CHECK_HOME;
  }
  var qrCache = {}, qrCount = 0, keyBusy = null;
  function qrKeyOf(e, p) {
    var k = C.activeKey(data);
    return k ? k.id + "|" + JSON.stringify(C.checkFields(e, p)) : "";
  }
  function qrCached(e, p) {
    var key = qrKeyOf(e, p);
    return key && qrCache[key] && qrCache[key].qr || null;
  }
  // The signing key: made once, the first time a design turns the code on.
  function ensureKey() {
    var k = C.activeKey(data);
    if (k) return Promise.resolve(k);
    if (!subtle || !S) return Promise.reject(new Error("crypto"));
    if (keyBusy) return keyBusy;
    keyBusy = S.makeKey(subtle).then(function (j) {
      var r = C.putKey(data, { id: C.newId("k", Math.random), made: now(), x: j.x, y: j.y, d: j.d }, now());
      if (!r.ok) throw new Error("key");
      data = r.data;
      storeData();
      return C.activeKey(data);
    });
    keyBusy.then(function () { keyBusy = null; }, function () { keyBusy = null; });
    return keyBusy;
  }
  // Codes for a list of people (the sample when the list is empty).
  function prepareQr(e, list) {
    if (!e.qr || !subtle || !S || !window.orosQR) return Promise.resolve();
    return ensureKey().then(function (k) {
      var chain = Promise.resolve(), base = checkBase();
      (list && list.length ? list : [sampleOf(e)]).forEach(function (p) {
        var key = qrKeyOf(e, p);
        if (!key || qrCache[key]) return;
        chain = chain.then(function () {
          return S.sign(subtle, k, base, C.checkFields(e, p));
        }).then(function (url) {
          if (qrCount > 4000) { qrCache = {}; qrCount = 0; }
          qrCache[key] = { url: url, qr: window.orosQR.encode(url, { ecl: "L" }) };
          qrCount++;
        });
      });
      return chain;
    });
  }
  // fill(x, y, w, h) in page points; the quiet zone is the white square.
  function paintQr(qr, box, fill, color) {
    var sh = window.orosQR.shapes(qr, { margin: 2 }), u = box.s / sh.w;
    color("#111111");
    sh.rects.forEach(function (r) { fill(box.x + r[0] * u, box.y + r[1] * u, r[2] * u, r[3] * u); });
  }
  function checkUrl(e, p) {
    var key = qrKeyOf(e, p);
    return key && qrCache[key] ? qrCache[key].url : "";
  }
  var fpCache = {};
  function renderCheck() {
    if (!ev) return;
    var on = !!ev.qr, k = C.activeKey(data);
    $("f-qr").checked = on;
    $("f-qr").disabled = !subtle || !S;
    $("qr-none").hidden = !!(subtle && S);
    $("qr-key").hidden = !on || !k;
    if (!on || !k) return;
    if (fpCache[k.id]) { $("qr-fp").textContent = fpCache[k.id]; return; }
    $("qr-fp").textContent = "…";
    S.fingerprint(subtle, S.pubOf(k)).then(function (fp) {
      fpCache[k.id] = fp;
      if (C.activeKey(data) && C.activeKey(data).id === k.id) $("qr-fp").textContent = fp;
    });
  }
  function onQr() {
    var on = $("f-qr").checked;
    change(function (e) { e.qr = on ? 1 : 0; }, { quiet: true });
    if (!on) { renderCheck(); return; }
    ensureKey().then(function () { renderCheck(); renderPreviewSoon(0); }, function () {
      change(function (e) { e.qr = 0; }, { quiet: true });
      renderCheck();
      toast(t("toast.noCrypto"));
    });
  }
  function copyFp() {
    var k = C.activeKey(data), fp = k && fpCache[k.id];
    if (!fp) return;
    var txt = t("qr.copyText", { fp: fp });
    var done = function () { toast(t("toast.copied")); };
    try { navigator.clipboard.writeText(txt).then(done, function () { toast(fp); }); } catch (e) { toast(fp); }
  }
  function openCheck() {
    var p = currentPerson() || sampleOf(ev);
    prepareQr(ev, [p]).then(function () {
      var u = checkUrl(ev, p) || checkBase();
      try { window.open(u, "_blank", "noopener"); } catch (e) {}
    });
  }
  var pvTimer = 0;
  function renderPreviewSoon(ms) {
    clearTimeout(pvTimer);
    pvTimer = setTimeout(renderPreview, ms === undefined ? 120 : ms);
  }
  function renderPreview() {
    if (!ev || !fontsReady || $("ed").hidden) return;
    var ppl = people(), sel = $("pv-sel");
    if (pvId && !ppl.some(function (p) { return p.id === pvId; })) pvId = ppl.length ? ppl[0].id : "";
    if (!pvId && ppl.length) pvId = ppl[0].id;
    // the person picker
    var sig = ppl.length + ":" + ppl.map(function (p) { return p.id + p.m; }).join(",").length + ":" + (ppl[0] ? ppl[0].m : 0) + ":" + ev.pre;
    if (sel.getAttribute("data-sig") !== sig) {
      sel.textContent = "";
      if (!ppl.length) {
        var o = el("option", null, t("pv.sample", { n: tIn(ev.lang, "sample.name") }));
        o.value = "";
        sel.appendChild(o);
      }
      ppl.forEach(function (p) {
        var o2 = el("option", null, (p.no ? C.serial(ev, p.no) + " · " : "") + p.n);
        o2.value = p.id;
        sel.appendChild(o2);
      });
      sel.setAttribute("data-sig", sig);
    }
    sel.value = pvId;
    var i = ppl.findIndex(function (p) { return p.id === pvId; });
    $("pv-prev").disabled = i <= 0;
    $("pv-next").disabled = i < 0 || i >= ppl.length - 1;
    $("pv-note").textContent = ppl.length ? "" : t("pv.note");
    var person = i >= 0 ? ppl[i] : null;
    var box = $("pv-pane").querySelector(".pv-box");
    var w = Math.max(200, Math.min(1100, (box.clientWidth || 600) - 20));
    var cv = $("pv");
    if (ev.qr && !qrCached(ev, person || sampleOf(ev)) && C.activeKey(data)) {
      var e0 = ev;
      prepareQr(e0, person ? [person] : []).then(function () { if (ev === e0 || (ev && ev.id === e0.id)) renderPreviewSoon(0); }, function () {});
    }
    try {
      drawPage(ev, person, Math.round(w * (window.devicePixelRatio || 1)), cv);
      cv.style.width = w + "px";
      cv.style.height = "auto";
    } catch (e) { try { console.error("[orOS Certificates] preview", e); } catch (x) {} }
  }
  function stepPreview(d) {
    var ppl = people(), i = ppl.findIndex(function (p) { return p.id === pvId; });
    var j = Math.max(0, Math.min(ppl.length - 1, i + d));
    if (ppl[j]) { pvId = ppl[j].id; renderPreview(); }
  }

  // ---------- 7. People ----------
  var PAGE = 200, pplShown = PAGE;
  function renderPeople() {
    if (!ev) return;
    var all = people(), host = $("ppl");
    host.textContent = "";
    var n = all.length;
    $("ppl-count").textContent = n === 0 ? t("ppl.count0") : n === 1 ? t("ppl.count1") : t("ppl.count", { n: n });
    $("ppl-empty").hidden = n > 0;
    $("ppl-q").hidden = n < 8;
    var q = C.fold($("ppl-q").value);
    var list = all.filter(function (p) { return !q || C.fold([p.n, p.n2, p.em, p.g, C.serial(ev, p.no)].join(" ")).indexOf(q) >= 0; });
    if (n && !list.length) host.appendChild(el("li", "hint", t("ppl.none")));
    $("at-bar").hidden = n === 0;
    list.slice(0, pplShown).forEach(function (p) {
      var li = el("li", "ppl-row"), b = el("button", "ppl-item" + (p.rv ? " rv" : ""));
      var lab = el("label", "at"), cb = el("input");
      cb.type = "checkbox";
      cb.checked = !!p.at;
      cb.setAttribute("aria-label", t("ppl.at", { n: p.n }));
      cb.addEventListener("change", function () { markAt([p.id], cb.checked); });
      lab.appendChild(cb);
      li.appendChild(lab);
      b.type = "button";
      b.appendChild(el("span", "ppl-no" + (p.no ? "" : " none"), p.no ? C.serial(ev, p.no) : "—"));
      b.appendChild(el("span", "ppl-name", p.n));
      var sub = [p.n2, p.em, p.g, p.rv ? t("ppl.rv") : ""].filter(Boolean).join(" · ");
      if (sub) b.appendChild(el("span", "ppl-sub", sub));
      b.addEventListener("click", function () { openPerson(p.id); });
      li.appendChild(b);
      host.appendChild(li);
    });
    var more = list.length - pplShown;
    $("ppl-more").hidden = more <= 0;
    $("ppl-more").textContent = t("ppl.more", { n: Math.min(PAGE, Math.max(0, more)) });
    $("ct-btn").hidden = !C.contactsPeople(readJSON("oros-contacts-data"), "").length;
    $("crm-btn").hidden = !C.crmPeople(readJSON("oros-crm-data"), "").length;
  }
  // Attendance: tick who came (wave 3).
  function markAt(ids, on) {
    if (!ev) return;
    if (saveTimer) saveNow();
    var r = C.setAttended(data, ev.id, ids, on, now());
    if (!r.n) return;
    data = r.data;
    storeData();
    if (!ids) toast(t("toast.at", { n: C.countAttended(data, ev.id) }));
    if (prefs.tab === "issue") renderChecks();
    if (!ids) renderPeople();
  }
  function dayLabel(lang, d) {
    var dt = new Date(d + "T12:00:00Z");
    return tIn(lang, "wd").split(",")[dt.getUTCDay()] + " " + dt.getUTCDate() + "/" + (dt.getUTCMonth() + 1);
  }
  function sheetPdf() {
    if (!ev || busy) return;
    if (saveTimer) saveNow();
    var e = ev, lang = e.lang, ppl = people().filter(function (p) { return !p.rv; });
    var sub = [e.issuer, C.fmtRange(e.d1, e.d2, lang), e.place, e.hours ? tIn(lang, "tok.hours") + ": " + e.hours : ""].filter(Boolean).join(" · ");
    work(t("work.pdf"));
    runBusy(loadJsPDF().then(function (J) {
      var b = D.buildSheet(e, ppl, {
        title: evTitle(e), sub: sub, sheet: tIn(lang, "sheet.title"), no: tIn(lang, "sheet.no"), name: tIn(lang, "sheet.name"),
        sign: tIn(lang, "sheet.sign"), page: tIn(lang, "sheet.page"), day: function (d) { return dayLabel(lang, d); }
      });
      var pdf = P.build(b.doc, { title: evTitle(e) }, { jsPDF: J, layout: R.computeLayout(b.doc) });
      return saveFile(pdf.output("blob"), C.fileStem(evTitle(e) + " " + tIn(lang, "btn.sheet").replace(/\s*\(PDF\)$/, ""), "sheet") + ".pdf", "application/pdf", "pdf");
    }));
  }
  // Open Badges 3.0: one signed credential (VC-JWT) per person, in a ZIP.
  function badgesZip() {
    if (busy || !ev) return;
    var Bd = window.CertBadges;
    if (!subtle || !Bd || !S) { toast(t("toast.badges")); return; }
    withNumbers(function (list) {
      var e = ev, files = [], names = C.uniqueNames(list.map(function (p) { return pdfName(e, p).replace(/\.pdf$/, ".jwt"); }));
      var chain = ensureKey().then(function (k) {
        var c2 = e.qr ? prepareQr(e, list) : Promise.resolve();
        return c2.then(function () { return k; });
      }).then(function (k) {
        var inner = Promise.resolve();
        list.forEach(function (p, i) {
          inner = inner.then(function () { work(t("work.badges", { i: i + 1, n: list.length })); return wait(0); }).then(function () {
            var map = C.fields(e, p);
            return Bd.make(subtle, k, {
              kind: e.kind, title: evTitle(e), name: p.n, email: p.em || "", issuer: e.issuer,
              description: C.fill(e.txt.body || "", map).trim(), idate: p.iss || e.idate, d1: e.d1, d2: e.d2,
              checkUrl: e.qr ? checkUrl(e, p) : "", checkName: tIn(e.lang, "badge.check")
            }, { evId: e.id, pId: p.id, now: now() });
          }).then(function (r) { files.push({ name: names[i], data: new TextEncoder().encode(r.jwt) }); });
        });
        return inner;
      });
      runBusy(chain.then(function () {
        var bytes = window.AtelierZip.write(files, new Date());
        return saveFile(new Blob([bytes], { type: "application/zip" }), stem() + "-open-badges.zip", "application/zip", "zip");
      }));
    });
  }
  function afterPeople() {
    renderPeople();
    renderPreviewSoon(0);
    if (prefs.tab === "issue") renderChecks();
    renderForm();
  }
  function importRows(rows) {
    if (!ev) return;
    if (saveTimer) saveNow();
    var r = C.importPeople(data, ev.id, rows, now());
    data = r.data;
    storeData();
    var msg = r.added === 0 ? t("toast.added0") : r.added === 1 ? t("toast.added1") : t("toast.added", { n: r.added });
    if (r.dup) msg += " " + t("toast.dup", { n: r.dup });
    if (r.over) msg += " " + t("toast.over", { n: r.over });
    toast(msg);
    if (r.added && !pvId) { var ppl = people(); if (ppl.length) pvId = ppl[0].id; }
    afterPeople();
  }
  function addOne(e) {
    e.preventDefault();
    var n = C.line($("add-n").value, C.LIM.name);
    if (!n) { toast(t("toast.empty")); $("add-n").focus(); return; }
    importRows([{ n: n, em: C.line($("add-em").value, C.LIM.email) }]);
    $("add-n").value = ""; $("add-em").value = "";
    $("add-n").focus();
  }
  // Paste
  var pasted = { people: [], cols: [] };
  function openPaste() {
    $("paste-ta").value = "";
    readPaste();
    showDlg("paste");
    $("paste-ta").focus();
  }
  function readPaste() {
    pasted = C.rowsToPeople(C.parseTable($("paste-ta").value));
    var n = pasted.people.length, info = $("paste-info");
    if (!n) info.textContent = $("paste-ta").value.trim() ? t("paste.nothing") : "";
    else {
      var s = n === 1 ? t("paste.found1") : t("paste.found", { n: n });
      if (pasted.header) s += " " + t("paste.cols", { c: pasted.cols.map(function (c) { return t("col." + c); }).join(", ") });
      info.textContent = s;
    }
    $("paste-go").disabled = !n;
  }
  function pasteGo() {
    var list = pasted.people;
    hideDlg();
    if (list.length) importRows(list);
  }
  function saveSample() {
    var s = LANG === "el"
      ? "Ονοματεπώνυμο,Email,Βαθμός,Άλλη μορφή ονόματος\nΜαρία Παπαδοπούλου,maria@example.gr,Άριστα,\nΓιώργος Νικολάου,giorgos@example.gr,Πολύ καλά,Γιώργο Νικολάου\n"
      : "Name,Email,Grade,Other form of the name\nMaria Smith,maria@example.com,Excellent,\nNick Jones,nick@example.com,Very good,\n";
    saveFile(new Blob(["\uFEFF" + s], { type: "text/csv" }), (LANG === "el" ? "λίστα" : "list") + ".csv", "text/csv", "csv");
  }
  // A CSV / TSV / text file, or a spreadsheet (SheetJS, loaded on first use).
  function openList() {
    var xl = loadXlsx();          // pre-warm while the file dialog is open (R33)
    openFile(".csv,.tsv,.txt,.xlsx,.xls,.ods,text/csv,text/plain").then(function (f) {
      if (!f) return;
      if (f.size > 15 * 1024 * 1024) { toast(t("toast.fileBig")); return; }
      var name = String(f.name || "").toLowerCase();
      if (/\.(xlsx|xls|ods)$/.test(name)) {
        return Promise.all([xl, f.arrayBuffer()]).then(function (r) {
          var X = r[0];
          if (!X) throw new Error("xlsx");
          var wb = X.read(new Uint8Array(r[1]), { type: "array" });
          var ws = wb.Sheets[wb.SheetNames[0]];
          var rows = X.utils.sheet_to_json(ws, { header: 1, raw: false, defval: "" }).slice(0, C.LIM.perEvent + 1);
          finishFile(C.rowsToPeople(rows));
        });
      }
      return f.text().then(function (s) { finishFile(C.rowsToPeople(C.parseTable(s))); });
    }).catch(function () { toast(t("toast.fileFail")); });
  }
  function finishFile(r) {
    if (!r.people.length) { toast(t("paste.nothing")); return; }
    importRows(r.people);
  }
  var xlsxP = null;
  function loadXlsx() {
    if (window.XLSX) return Promise.resolve(window.XLSX);
    if (xlsxP) return xlsxP;
    xlsxP = new Promise(function (resolve) {
      var s = document.createElement("script");
      s.src = "../vendor/xlsx.full.min.js";
      s.onload = function () { resolve(window.XLSX || null); };
      s.onerror = function () { xlsxP = null; resolve(null); };
      document.head.appendChild(s);
    });
    return xlsxP;
  }
  // Contacts / CRM: everyone, or one label / tag.
  function fromContacts() {
    var o = readJSON("oros-contacts-data"), items = [];
    var all = C.contactsPeople(o, "");
    items.push({ label: t("pick.all", { n: all.length }), run: function () { importRows(all); } });
    C.contactLabels(o).forEach(function (l) {
      var list = C.contactsPeople(o, l.id);
      if (list.length) items.push({ label: t("pick.label", { l: l.name, n: list.length }), run: function () { importRows(list); } });
    });
    openPick(t("pick.ct"), items, items.length > 8);
  }
  function fromCrm() {
    var o = readJSON("oros-crm-data"), items = [];
    var all = C.crmPeople(o, "");
    items.push({ label: t("pick.all", { n: all.length }), run: function () { importRows(all); } });
    C.crmTags(o).forEach(function (tg) {
      var list = C.crmPeople(o, tg.id);
      if (list.length) items.push({ label: t("pick.label", { l: tg.name, n: list.length }), run: function () { importRows(list); } });
    });
    openPick(t("pick.crm"), items, items.length > 8);
  }
  // One person
  var peId = "";
  function openPerson(id) {
    var p = C.personById(data, id);
    if (!p) return;
    peId = id;
    $("pe-n").value = p.n; $("pe-n2").value = p.n2 || ""; $("pe-em").value = p.em || "";
    $("pe-g").value = p.g || ""; $("pe-x").value = p.x || "";
    $("pe-rv").checked = !!p.rv;
    $("pe-no").textContent = p.no ? t("pe.no", { s: C.serial(ev, p.no), d: C.fmtDate(p.iss, LANG) || "—" }) : t("pe.noNone");
    $("pe-mail").hidden = !p.em;
    pvId = id;
    renderPreviewSoon(0);
    showDlg("person");
    $("pe-n").focus();
  }
  function savePerson() {
    var p = C.personById(data, peId);
    if (!p) { hideDlg(); return; }
    var n = C.line($("pe-n").value, C.LIM.name);
    if (!n) { toast(t("toast.empty")); $("pe-n").focus(); return false; }
    var c = JSON.parse(JSON.stringify(p));
    c.n = n; c.n2 = $("pe-n2").value; c.em = $("pe-em").value; c.g = $("pe-g").value; c.x = $("pe-x").value;
    c.rv = $("pe-rv").checked ? 1 : 0;
    var r = C.putPeople(data, [c], now());
    data = r.data;
    storeData();
    hideDlg();
    afterPeople();
    return true;
  }
  function removePerson() {
    var p = C.personById(data, peId);
    if (!p) return;
    ask(t("ask.remove", { name: p.n }), t("btn.remove"), function () {
      data = C.removePeople(data, [p.id], now());
      storeData();
      afterPeople();
    });
  }

  // ---------- 8. Issue: checks, numbers ----------
  function renderChecks() {
    if (!ev) return;
    var host = $("checks"), ppl = people(), list = ppl.filter(function (p) { return !p.rv && (!ev.onlyAt || p.at); });
    host.textContent = "";
    function item(cls, text, btnLabel, fn) {
      var li = el("li", cls, text);
      if (btnLabel) {
        var b = el("button", "chip small", btnLabel);
        b.type = "button";
        b.addEventListener("click", fn);
        li.appendChild(b);
      }
      host.appendChild(li);
    }
    if (!ppl.length) item("warn", t("chk.none"), t("chk.toPeople"), function () { showTab("people"); $("add-n").focus(); });
    else if (list.length) {
      var a = list.filter(function (p) { return p.no; }).length;
      if (a === list.length) item("ok", t("chk.allNo", { n: list.length }));
      else item(ev.showNo ? "warn" : "info", t("chk.count", { n: list.length, a: a, b: list.length - a }));
    }
    var miss = C.missing(ev, list);
    miss.forEach(function (f) {
      if (f === "serial") return;            // counted above
      if (f === "grade" || f === "extra") { item("info", t("chk.grade").replace(t("tok.grade").toLowerCase(), t("tok." + f).toLowerCase())); return; }
      item("warn", t("chk.missing", { f: t("tok." + f) }), t("chk.fill"), function () {
        showTab("design");
        var map = { title: "f-t", issuer: "f-issuer", dates: "f-d1", date: "f-idate", place: "f-place", hours: "f-hours" };
        var n = $(map[f]);
        if (n) { n.closest("details").open = true; n.focus(); }
      });
    });
    var usesN2 = C.TXT_KEYS.some(function (k) { return C.usedFields(ev.txt[k]).indexOf("name2") >= 0; });
    if (usesN2 && list.some(function (p) { return !p.n2; })) item("info", t("chk.name2"));
    C.dupNumbers(data, ev.id).forEach(function (no) {
      item("warn", t("chk.dup", { s: C.serial(ev, no) }), t("chk.fix"), function () { fixDup(no); });
    });
    var rv = ppl.filter(function (p) { return p.rv; }).length;
    if (rv) item("info", rv === 1 ? t("chk.rv1") : t("chk.rv", { n: rv }));
    if (ev.onlyAt && ppl.length) {
      var live = ppl.length - rv;
      if (!list.length) item("warn", t("chk.at0"), t("chk.toPeople"), function () { showTab("people"); });
      else item("info", t("chk.at", { a: list.length, n: live }));
    }
    if (ppl.length && !miss.filter(function (f) { return f !== "serial"; }).length) item("ok", t("chk.ok"));
    $("num-btn").disabled = !ppl.some(function (p) { return !p.no && (!ev.onlyAt || p.at); });
    $("f-onlyAt").checked = !!ev.onlyAt;
    $("send-btn").hidden = !canSendAll();
  }
  function giveNumbers(silent) {
    if (!ev) return 0;
    if (saveTimer) saveNow();
    var ids = ev.onlyAt ? people().filter(function (p) { return p.at; }).map(function (p) { return p.id; }) : null;
    var r = C.issue(data, ev.id, ids, now(), todayKey());
    data = r.data;
    if (r.n) {
      storeData();
      var e = C.eventById(data, ev.id);
      if (e) ev = JSON.parse(JSON.stringify(e));
    }
    if (!silent) toast(r.n === 0 ? t("toast.numbered0") : r.n === 1 ? t("toast.numbered1") : t("toast.numbered", { n: r.n }));
    afterPeople();
    return r.n;
  }
  // The later of the people who share a number gets a fresh one.
  function fixDup(no) {
    var same = people().filter(function (p) { return p.no === no; }).sort(function (a, b) { return a.m - b.m || (a.id < b.id ? -1 : 1); });
    same.slice(1).forEach(function (p) {
      var r = C.renumber(data, ev.id, p.id, now(), todayKey());
      data = r.data;
    });
    storeData();
    var e = C.eventById(data, ev.id);
    if (e) ev = JSON.parse(JSON.stringify(e));
    afterPeople();
  }

  // ---------- 9. Output: PDF, ZIP, Files, print, PNG, email, register ----------
  var jspdfP = null;
  function loadJsPDF() {
    if (window.jspdf && window.jspdf.jsPDF) return Promise.resolve(window.jspdf.jsPDF);
    if (jspdfP) return jspdfP;
    jspdfP = new Promise(function (resolve, reject) {
      var s = document.createElement("script");
      s.src = "../vendor/jspdf.umd.min.js";
      s.onload = function () { if (window.jspdf && window.jspdf.jsPDF) resolve(window.jspdf.jsPDF); else reject(new Error("jspdf")); };
      s.onerror = function () { jspdfP = null; reject(new Error("jspdf")); };
      document.head.appendChild(s);
    });
    return jspdfP;
  }
  function toBlob(cv, type, q) {
    return new Promise(function (resolve, reject) {
      cv.toBlob(function (b) { if (b) resolve(b); else reject(new Error("encode")); }, type, q);
    });
  }
  // Pictures for the PDF, cut and resampled once per picture + frame
  // (every page of a batch shares them: same alias, one copy in the file).
  var cropCache = {};
  function cropImage(it) {
    var crop = P.imageCrop(it);
    if (!crop) return Promise.resolve(null);
    var key = it.a + ":" + Math.round(it.w) + "x" + Math.round(it.h);
    if (cropCache[key]) return cropCache[key];
    cropCache[key] = A.load(it.a).then(function (img) {
      if (!img) return null;
      var k = (img.naturalWidth || img.width) / (it.iw || 1), ppi = 300;
      var src = { x: crop.src.x * k, y: crop.src.y * k, w: crop.src.w * k, h: crop.src.h * k };
      var cw = Math.max(1, Math.round(Math.min(src.w, crop.rect.w / 72 * ppi)));
      var ch = Math.max(1, Math.round(Math.min(src.h, crop.rect.h / 72 * ppi)));
      var cv = document.createElement("canvas");
      cv.width = cw; cv.height = ch;
      var png = /\.png$/.test(it.a);
      cv.getContext("2d").drawImage(img, src.x, src.y, src.w, src.h, 0, 0, cw, ch);
      return toBlob(cv, png ? "image/png" : "image/jpeg", 0.92).then(function (b) { return b.arrayBuffer(); }).then(function (ab) {
        return { data: new Uint8Array(ab), fmt: png ? "PNG" : "JPEG", rect: crop.rect, alias: "im-" + key.replace(/[^a-z0-9]/gi, "") };
      });
    }).catch(function () { return null; });
    return cropCache[key];
  }
  // A jsPDF with one page per person.
  function makePdf(e, list) {
    var J;
    return loadJsPDF().then(function (x) {
      J = x;
      var built = D.build(e, list, {});
      var doc = built.doc, images = {}, chain = prepareQr(e, list.length ? list : [{ n: "", no: 0 }]);
      doc.items.forEach(function (it) {
        if (it.t !== "img" || !it.a) return;
        chain = chain.then(function () { return cropImage(it); }).then(function (im) { if (im) images[it.id] = im; });
      });
      return chain.then(function () {
        var pdf = P.build(doc, { title: evTitle(e) }, { jsPDF: J, layout: R.computeLayout(doc), images: images });
        built.pages.forEach(function (pg, i) {
          var code = pg.qr && qrCached(e, list[i] || { n: "", no: 0 });
          if (!code) return;
          pdf.setPage(i + 1);
          paintQr(code, pg.qr, function (x, y, w, h) { pdf.rect(x, y, w, h, "F"); }, function () { pdf.setFillColor(17, 17, 17); });
          // the code is also a link in the PDF
          try { pdf.link(pg.qr.x, pg.qr.y, pg.qr.s, pg.qr.s, { url: checkUrl(e, list[i] || { n: "", no: 0 }) }); } catch (x3) {}
        });
        try { pdf.setProperties({ title: evTitle(e), creator: "orOS Certificates", subject: e.issuer || "" }); } catch (x2) {}
        return pdf;
      });
    });
  }
  function pdfName(e, p) {
    var parts = [];
    if (p && p.no) parts.push(C.serial(e, p.no));
    if (p) parts.push(p.n);
    return C.fileStem(parts.join(" "), "certificate") + ".pdf";
  }
  // Who goes out: everyone (revoked left out when ticked).
  function outList() {
    var skip = $("skip-rv").checked, only = ev && ev.onlyAt;
    return people().filter(function (p) { return !(skip && p.rv) && (!only || p.at); });
  }
  var busy = false;
  // Before a batch: offer numbers to those without, when the design shows them.
  function withNumbers(fn) {
    if (!ev) return;
    if (saveTimer) saveNow();
    var list = outList();
    if (!list.length) { toast(t("toast.nothing")); return; }
    var none = list.filter(function (p) { return !p.no; }).length;
    if (ev.showNo && none) {
      ask(t("ask.numbers", { n: none }), t("btn.numberFirst"), function () { giveNumbers(true); fn(outList()); },
        t("btn.without"), function () { fn(list); });
      return;
    }
    fn(list);
  }
  function work(s) { $("work").textContent = s || ""; }
  function runBusy(p) {
    busy = true;
    return p.then(function (r) { busy = false; work(""); return r; }, function (e) {
      busy = false; work("");
      try { console.error("[orOS Certificates] output", e); } catch (x) {}
      toast(t("toast.pdfFail"));
    });
  }
  function stem() { return C.fileStem(evTitle(ev), "certificates"); }
  function pdfAll() {
    if (busy) return;
    withNumbers(function (list) {
      var e = ev;
      work(t("work.pdf"));
      runBusy(wait(30).then(function () { return makePdf(e, list); }).then(function (pdf) {
        return saveFile(pdf.output("blob"), stem() + ".pdf", "application/pdf", "pdf");
      }));
    });
  }
  function zipAll() {
    if (busy) return;
    withNumbers(function (list) {
      var e = ev, files = [], names = C.uniqueNames(list.map(function (p) { return pdfName(e, p); }));
      var chain = Promise.resolve();
      list.forEach(function (p, i) {
        chain = chain.then(function () { work(t("work.zip", { i: i + 1, n: list.length })); return wait(0); })
          .then(function () { return makePdf(e, [p]); })
          .then(function (pdf) { files.push({ name: names[i], data: new Uint8Array(pdf.output("arraybuffer")) }); });
      });
      runBusy(chain.then(function () {
        var bytes = window.AtelierZip.write(files, new Date());
        return saveFile(new Blob([bytes], { type: "application/zip" }), stem() + ".zip", "application/zip", "zip");
      }));
    });
  }
  function fsApi() {
    try { return (window.parent && window.parent.orosFS) || window.orosFS || null; } catch (e) { return window.orosFS || null; }
  }
  function folderOf(e) { return "/internal/Certificates/" + C.fileStem(evTitle(e), "certificates"); }
  function writeFile(path, blob) {
    var F = fsApi();
    if (!F) return Promise.reject(new Error("fs"));
    var w = typeof F.writeBlob === "function" ? F.writeBlob : F.write;
    return Promise.resolve(w.call(F, path, blob));
  }
  function filesAll() {
    if (busy) return;
    if (!fsApi()) { toast(t("toast.noFiles")); return; }
    withNumbers(function (list) {
      var e = ev, dir = folderOf(e), names = C.uniqueNames(list.map(function (p) { return pdfName(e, p); }));
      var chain = Promise.resolve();
      list.forEach(function (p, i) {
        chain = chain.then(function () { work(t("work.files", { i: i + 1, n: list.length })); return wait(0); })
          .then(function () { return makePdf(e, [p]); })
          .then(function (pdf) { return writeFile(dir + "/" + names[i], pdf.output("blob")); });
      });
      runBusy(chain.then(function () { toast(t("toast.savedN", { n: list.length, p: dir.replace("/internal/", "") })); }));
    });
  }
  var PRINT_MAX = 100;
  function printAll() {
    if (busy || !ev) return;
    withNumbers(function (list) {
      if (list.length > PRINT_MAX) { toast(t("toast.printMany", { n: PRINT_MAX })); return; }
      var e = ev, host = $("print-host"), pg = D.pageSize(e);
      host.textContent = "";
      var st = $("print-page") || document.head.appendChild(el("style"));
      st.id = "print-page";
      st.textContent = "@page { size: " + (e.size === "letter" ? "letter" : "A4") + " " + (e.orient === "p" ? "portrait" : "landscape") + "; margin: 0; }";
      var px = Math.round(pg.w / 72 * 150), chain = prepareQr(e, list);
      list.forEach(function (p, i) {
        chain = chain.then(function () { work(t("work.print", { i: i + 1, n: list.length })); return wait(0); }).then(function () {
          var img = el("img");
          img.alt = "";
          img.src = drawPage(e, p, px).toDataURL("image/jpeg", 0.9);
          host.appendChild(img);
        });
      });
      runBusy(chain.then(function () { return wait(80); }).then(function () { try { window.print(); } catch (x) {} }));
    });
  }
  function currentPerson() { return C.personById(data, pvId); }
  function pdfOne() {
    if (busy || !ev) return;
    if (saveTimer) saveNow();
    var p = currentPerson(), e = ev;
    runBusy(makePdf(e, p ? [p] : []).then(function (pdf) {
      return saveFile(pdf.output("blob"), p ? pdfName(e, p) : stem() + ".pdf", "application/pdf", "pdf");
    }));
  }
  function pngOne() {
    if (busy || !ev) return;
    var p = currentPerson(), e = ev, pg = D.pageSize(e);
    runBusy(prepareQr(e, p ? [p] : []).then(function () {
      var cv = drawPage(e, p, Math.round(pg.w / 72 * 200));
      return toBlob(cv, "image/png").then(function (b) {
        return saveFile(b, (p ? pdfName(e, p) : stem() + ".pdf").replace(/\.pdf$/, ".png"), "image/png", "png");
      });
    }));
  }
  function saveRegister() {
    if (!ev) return;
    if (saveTimer) saveNow();
    var csv = C.registerCsv(data, ev.id, LANG);
    saveFile(new Blob([csv], { type: "text/csv" }), stem() + (LANG === "el" ? "-μητρώο" : "-register") + ".csv", "text/csv", "csv");
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
      setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 40000);
      return Promise.resolve({ ok: true });
    })();
    return Promise.resolve(p).then(function (r) { if (r && r.ok) toast(t("toast.saved")); return r; });
  }
  // Email: orOS Mail (an account on this device) with the PDF from
  // the orOS disk attached, or the device's mail app (mailto:) after
  // saving the PDF.
  function mailShell() {
    var s = shell();
    if (!s || typeof s.__orosOpenAt !== "function") return null;
    var m = readJSON("oros-mail-data");
    return m && Array.isArray(m.accounts) && m.accounts.length ? s : null;
  }
  function openMailList() {
    var withMail = people().filter(function (p) { return p.em && !p.rv && (!ev.onlyAt || p.at); });
    if (!withMail.length) { toast(t("pick.noMail")); return; }
    openPick(t("pick.mail"), withMail.map(function (p) {
      return { label: p.n, sub: [p.em, p.no ? C.serial(ev, p.no) : ""].filter(Boolean).join(" · "), keep: true, run: function () { sendMail(p.id); } };
    }), withMail.length > 8, t("pick.mailHint"));
  }
  function sendMail(id) {
    var p = C.personById(data, id);
    if (!p || !p.em || !ev || busy) return;
    if (saveTimer) saveNow();
    var e = ev, mt = mailText(e, p), subj = mt.subj, body = mt.body;
    var name = pdfName(e, p), s = mailShell();
    runBusy(makePdf(e, [p]).then(function (pdf) {
      var blob = pdf.output("blob");
      if (s && fsApi()) {
        var path = folderOf(e) + "/" + name;
        return writeFile(path, blob).then(function () {
          s.__orosOpenAt("mail", { compose: { to: p.em, subject: subj.slice(0, 300), body: body.slice(0, 20000), attach: [{ path: path, name: name }] } });
          toast(t("toast.mailSent"));
        });
      }
      return saveFile(blob, name, "application/pdf", "pdf").then(function () {
        var a = document.createElement("a");
        a.href = "mailto:" + encodeURIComponent(p.em) + "?subject=" + encodeURIComponent(subj) + "&body=" + encodeURIComponent(body);
        a.target = "_blank"; a.rel = "noopener";
        document.body.appendChild(a); a.click(); a.remove();
        toast(t("toast.mailHint"));
      });
    }));
  }

  function mailText(e, p) {
    var lang = e.lang;
    var title = e.t ? (lang === "el" ? " για «" + e.t + "»" : " for “" + e.t + "”") : "";
    return {
      subj: (e.t ? tIn(lang, "mail.subject", { t: e.t }) : tIn(lang, "mail.subjectNoT")).slice(0, 300),
      body: tIn(lang, "mail.body", { n: p.n, tt: title, i: e.issuer || "" }).replace(/\n+$/, "").slice(0, 20000)
    };
  }

  // Email everyone through the relay with an orOS Mail account
  // (send.js): one message per person, paced, resumable (person.ms).
  var SEND_KEY = "oros-certificates-send", sendQ = null, sendRun = null;
  function canSendAll() { return !!(window.CertSend && window.CertSend.accounts && window.orosMailCompose && window.CertSend.accounts().length); }
  function sendPrefs() {
    var p = readJSON(SEND_KEY) || {}, H = window.CertSend.PER_HOUR;
    var r = Math.round(+p.rate);
    return { acc: typeof p.acc === "string" ? p.acc : "", rate: r >= H.min && r <= H.max ? r : H.def };
  }
  // bad: ids whose address was refused in this run (not tried again)
  function sendList(e, again, since, bad) {
    var MC = window.orosMailCompose;
    return people().filter(function (p) {
      if ((bad && bad[p.id]) || !p.em || !MC.validAddr(p.em) || (e.onlyAt && !p.at) || ($("skip-rv").checked && p.rv)) return false;
      return again ? !p.ms || p.ms < since : !p.ms;
    });
  }
  function renderSend() {
    var st = $("send-state"), go = $("send-go"), r = sendRun;
    if (!ev) return;
    var mine = r && r.evId === ev.id;
    go.disabled = false;
    if (mine && r.status === "run") {
      go.textContent = t("send.pause");
      st.textContent = r.cur ? t("send.step", { i: r.s + r.f.length + 1, n: r.n, name: r.cur }) : t("send.sent", { s: r.s, n: r.n });
      return;
    }
    if (mine && (r.status === "paused" || r.status === "error")) {
      go.textContent = t("send.resume");
      if (r.status === "paused") { st.textContent = t("send.paused", { s: r.s, n: r.n }); return; }
      var err = r.err || {}, S = window.CertSend, k = S.isRate(err) ? "rate" : err.code === "auth" ? "auth" : err.code === "nopass" ? "nopass" :
        /^(offline|network|timeout)$/.test(err.code) ? "offline" : "other";
      st.textContent = t("send.sent", { s: r.s, n: r.n }) + " " + t("send.err." + k, { why: err.msg || err.code || "?" }) +
        (/^(network|timeout)$/.test(err.code) && r.last ? " " + t("send.maybe", { name: r.last }) : "");
      return;
    }
    go.textContent = t("send.go");
    var since = mine ? r.since : 0;
    var n = sendList(ev, $("send-again").checked, since || now(), mine ? r.bad : null).length;
    var done = mine && r.status === "done" ? (r.f.length ? t("send.doneFail", { s: r.s, list: r.f.join(", ") }) : t("send.done", { s: r.s })) + " " : "";
    if (!people().some(function (p) { return p.em; })) { st.textContent = t("send.noMail"); go.disabled = true; return; }
    st.textContent = done + (n ? (n === 1 ? t("send.left1") : t("send.left", { n: n })) : t("send.none"));
    go.disabled = !n;
  }
  function openSend() {
    if (!ev || !canSendAll()) return;
    if (saveTimer) saveNow();
    var accs = window.CertSend.accounts(), sp = sendPrefs(), sel = $("send-acc");
    sel.textContent = "";
    accs.forEach(function (a) {
      var o = document.createElement("option");
      o.value = a.id; o.textContent = a.name ? a.name + " <" + a.email + ">" : a.email;
      sel.appendChild(o);
    });
    sel.value = accs.some(function (a) { return a.id === sp.acc; }) ? sp.acc : accs[0].id;
    $("send-rate").value = String(sp.rate);
    if (!(sendRun && sendRun.evId === ev.id && sendRun.status !== "done")) $("send-again").checked = false;
    renderSend();
    showDlg("send");
  }
  function binOf(ab) {
    var u8 = new Uint8Array(ab), out = "";
    for (var i = 0; i < u8.length; i += 0x8000) out += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
    return out;
  }
  function sendGo() {
    if (sendQ) { sendQ.stop(); return; }
    if (!ev || busy || !canSendAll()) return;
    var S = window.CertSend, MC = window.orosMailCompose, H = S.PER_HOUR;
    var accs = S.accounts(), acc = accs.filter(function (a) { return a.id === $("send-acc").value; })[0] || accs[0];
    var rate = Math.max(H.min, Math.min(H.max, Math.round(+$("send-rate").value) || H.def));
    $("send-rate").value = String(rate);
    try { localStorage.setItem(SEND_KEY, JSON.stringify({ acc: acc.id, rate: rate })); } catch (x) {}
    var e = ev, resume = sendRun && sendRun.evId === e.id && sendRun.status !== "done";
    var since = resume ? sendRun.since : now(), again = $("send-again").checked;
    var bad = resume ? sendRun.bad : {};
    var list = sendList(e, again, since, bad);
    if (!list.length) { renderSend(); return; }
    sendRun = { evId: e.id, since: since, n: resume ? sendRun.s + list.length : list.length, s: resume ? sendRun.s : 0, f: resume ? sendRun.f : [], bad: bad, status: "run", cur: "" };
    renderSend();
    sendQ = S.run({
      acc: acc, list: list, perHour: rate,
      build: function (p) {
        var cur = C.personById(data, p.id) || p, mt = mailText(e, cur);
        return makePdf(e, [cur]).then(function (pdf) {
          var m = S.message(MC, {
            from: { name: acc.name || e.issuer || "", addr: acc.email }, to: { name: cur.n, addr: cur.em },
            subject: mt.subj, text: mt.body, pdf: { name: pdfName(e, cur), bin: binOf(pdf.output("arraybuffer")) }
          });
          return { to: cur.em, bin: m.bin };
        });
      },
      done: function (p) {
        var cur = C.personById(data, p.id);
        if (cur) {
          var c = JSON.parse(JSON.stringify(cur));
          c.ms = now();
          data = C.putPeople(data, [c], now()).data;
          storeData();
        }
        sendRun.s++; sendRun.cur = "";
        renderSend();
      },
      failed: function (p) { sendRun.f.push(p.n); sendRun.bad[p.id] = 1; sendRun.cur = ""; renderSend(); },
      step: function (i) { sendRun.cur = list[i].n; sendRun.last = list[i].n; renderSend(); },
      end: function (reason, err) {
        sendQ = null;
        sendRun.status = reason; sendRun.err = err || null; sendRun.cur = "";
        if (reason === "error") { try { console.warn("[orOS Certificates] send stopped", err && err.code); } catch (x) {} }
        renderSend();
        if (reason === "done") toast(sendRun.f.length ? t("send.doneFail", { s: sendRun.s, list: sendRun.f.join(", ") }) : t("send.done", { s: sendRun.s }));
        else if (reason === "error" && !openDlg) toast($("send-state").textContent);
      }
    });
  }

  // ---------- 10. Dialogs + toast ----------
  var openDlg = null, lastFocus = null;
  function showDlg(id) {
    if (openDlg) hideDlg(true);
    lastFocus = document.activeElement;
    openDlg = $(id);
    $("scrim").hidden = false;
    openDlg.hidden = false;
    var f = openDlg.querySelector("input, textarea, button:not(.dlg-close)") || openDlg.querySelector("button");
    if (f) f.focus();
  }
  function hideDlg(keepFocus) {
    if (!openDlg) return;
    openDlg.hidden = true;
    $("scrim").hidden = true;
    openDlg = null;
    if (!keepFocus && lastFocus && lastFocus.focus) try { lastFocus.focus(); } catch (e) {}
  }
  var pickItems = [];
  function openPick(title, items, searchable, hint) {
    pickItems = items;
    $("pick-title").textContent = title;
    $("pick-hint").hidden = !hint;
    $("pick-hint").textContent = hint || "";
    $("pick-q").hidden = !searchable;
    $("pick-q").value = "";
    $("pick-q").placeholder = t("pick.q");
    $("pick-q").setAttribute("aria-label", t("pick.q"));
    renderPick();
    showDlg("pick");
  }
  function renderPick() {
    var q = C.fold($("pick-q").value.trim()), list = $("pick-list");
    list.textContent = "";
    var shown = pickItems.filter(function (it) { return !q || C.fold(it.label + " " + (it.sub || "")).indexOf(q) >= 0; }).slice(0, 300);
    if (!shown.length) { list.appendChild(el("li", "hint", t("pick.none"))); return; }
    shown.forEach(function (it) {
      var li = el("li"), b = el("button", "pick-item");
      b.type = "button";
      var tx = el("span", "pick-text");
      tx.appendChild(el("span", "pick-label", it.label));
      if (it.sub) tx.appendChild(el("span", "pick-sub", it.sub));
      b.appendChild(tx);
      b.addEventListener("click", function () { if (!it.keep) hideDlg(); it.run(); });
      li.appendChild(b);
      list.appendChild(li);
    });
  }
  var askYes = null, askNo = null;
  function ask(text, yesLabel, fn, noLabel, noFn) {
    $("ask-text").textContent = text;
    $("ask-yes").textContent = yesLabel;
    $("ask-no").textContent = noLabel || t("btn.cancel");
    askYes = fn; askNo = noFn || null;
    showDlg("ask");
    $("ask-no").focus();
  }
  // More
  function duplicate() {
    hideDlg();
    if (!ev) return;
    if (data.evs.length >= C.LIM.events) { toast(t("toast.full")); return; }
    if (saveTimer) saveNow();
    var c = JSON.parse(JSON.stringify(ev));
    c.id = C.newId("e"); c.m = now(); c.next = 1;
    c.t = C.line(t("copyOf", { t: evTitle(ev) }), C.LIM.title);
    var r = C.putEvent(data, c, now());
    if (!r.ok) return;
    data = r.data;
    storeData();
    openEvent(r.ev.id, "design");
    toast(t("toast.dupDone"));
  }
  function clearList() {
    hideDlg();
    var ppl = people();
    if (!ppl.length) return;
    ask(t("ask.clear", { n: ppl.length }), t("btn.delete"), function () {
      // the numbers stay used: the event keeps the next free one
      var e = JSON.parse(JSON.stringify(ev));
      e.next = Math.max(e.next, C.maxNo(data, e.id) + 1);
      var r = C.putEvent(data, e, now());
      if (r.ok) { data = r.data; ev = JSON.parse(JSON.stringify(r.ev)); }
      data = C.removePeople(data, ppl.map(function (p) { return p.id; }), now());
      storeData();
      pvId = "";
      afterPeople();
      toast(t("toast.cleared"));
    });
  }
  function delEvent() {
    hideDlg();
    if (!ev) return;
    var id = ev.id;
    ask(t("ask.del", { name: evTitle(ev), n: C.countPeople(data, id) }), t("btn.delete"), function () {
      clearTimeout(saveTimer); saveTimer = 0;
      data = C.removeEvent(data, id, now());
      storeData();
      showHome();
      toast(t("toast.deleted"));
    });
  }
  var toastTimer = 0;
  function toast(msg) {
    var n = $("toast");
    n.textContent = "";
    n.appendChild(el("span", null, msg));
    n.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { n.classList.remove("show"); }, 3800);
  }

  // ---------- 11. Sync slice, palette, deep link ----------
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
    api.registerSlice("certificates", sliceGet, sliceSet, C.DATA_KEY, C.merge);
  }
  function sliceGet() { if (saveTimer) saveNow(); return C.merge(data, null); }     // canonical copy (R26)
  function sliceSet(incoming) {
    if (!incoming || typeof incoming !== "object" || !Array.isArray(incoming.evs)) return;
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
    if (ev) {
      var e = C.eventById(data, ev.id);
      if (!e) { showHome(); return; }
      // an edit waiting to be saved is newer and will win
      if (!saveTimer && e.m !== ev.m) { ev = JSON.parse(JSON.stringify(e)); renderForm(); renderStyles(); }
      renderPeople();
      if (prefs.tab === "issue") renderChecks();
      renderPreviewSoon(0);
    } else if (!$("home").hidden) renderHome();
  }
  // Deep link (search hit): { ev, p } opens the certificates (and the person).
  var pending = null;
  function openTarget(tg) {
    if (!tg || typeof tg !== "object" || typeof tg.ev !== "string") return false;
    if (!fontsReady) { pending = tg; return true; }
    if (!C.eventById(data, tg.ev)) return false;
    hideDlg();
    var p = typeof tg.p === "string" ? C.personById(data, tg.p) : null;
    openEvent(tg.ev, p ? "people" : prefs.tab);
    if (p && p.e === tg.ev) { pvId = p.id; renderPreviewSoon(0); openPerson(p.id); }
    return true;
  }
  window.__orosOpenAt = openTarget;

  // ---------- 12. Wiring & boot ----------
  function applyI18n() {
    document.documentElement.lang = LANG;
    [].forEach.call(document.querySelectorAll("[data-i18n]"), function (n) { n.textContent = t(n.getAttribute("data-i18n")); });
    document.title = t("app.name") + " · orOS";
    $("new-btn").innerHTML = ICON.plus; setLabel($("new-btn"), t("btn.new"));
    $("more-btn").innerHTML = ICON.more; setLabel($("more-btn"), t("btn.more"));
    $("home-btn").innerHTML = ICON.back; setLabel($("home-btn"), t("btn.home"));
    $("pv-prev").innerHTML = ICON.back; setLabel($("pv-prev"), t("pv.prev"));
    $("pv-next").innerHTML = ICON.next; setLabel($("pv-next"), t("pv.next"));
    [].forEach.call(document.querySelectorAll(".dlg-close"), function (b) { b.innerHTML = ICON.close; setLabel(b, t("btn.close")); });
    $("tabs").setAttribute("aria-label", t("app.name"));
    $("pv").setAttribute("aria-label", t("pv.alt"));
    $("add-n").placeholder = t("f.n"); $("add-em").placeholder = t("f.em");
    $("ppl-q").placeholder = t("ppl.q"); $("home-q").placeholder = t("home.q");
    $("home-q").setAttribute("aria-label", t("home.q"));
    var ks = $("f-kind");
    C.KINDS.forEach(function (k) { var o = el("option", null, t("kind." + k)); o.value = k; ks.appendChild(o); });
    renderTokens();
  }

  function wire() {
    $("home-btn").addEventListener("click", showHome);
    $("new-btn").addEventListener("click", openNew);
    $("first-btn").addEventListener("click", openNew);
    $("more-btn").addEventListener("click", function () { showDlg("more"); });
    $("home-q").addEventListener("input", renderHome);
    $("new-go").addEventListener("click", createEvent);
    $("new-t").addEventListener("keydown", function (e) { if (e.key === "Enter") { e.preventDefault(); createEvent(); } });
    $("new-kinds").addEventListener("keydown", function (e) {
      var d = (e.key === "ArrowRight" || e.key === "ArrowDown") ? 1 : ((e.key === "ArrowLeft" || e.key === "ArrowUp") ? -1 : 0);
      if (!d) return;
      e.preventDefault();
      var i = C.KINDS.indexOf(newKind);
      newKind = C.KINDS[(i + d + C.KINDS.length) % C.KINDS.length];
      renderNewKinds();
      var f = $("new-kinds").querySelector('[data-kind="' + newKind + '"]'); if (f) f.focus();
    });
    ["design", "people", "issue"].forEach(function (k) { $("tab-" + k).addEventListener("click", function () { showTab(k); }); });
    $("tabs").addEventListener("keydown", function (e) {
      var d = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
      if (!d) return;
      var list = ["design", "people", "issue"], i = list.indexOf(prefs.tab);
      var k = list[(i + d + 3) % 3];
      showTab(k);
      $("tab-" + k).focus();
    });
    FIELDS.forEach(function (k) { $("f-" + k).addEventListener("input", readDetails); $("f-" + k).addEventListener("change", readDetails); });
    C.TXT_KEYS.forEach(function (k) {
      var n = $("tx-" + k);
      n.addEventListener("input", readDetails);
      n.addEventListener("focus", function () { lastTx = n.id; });
    });
    ["f-acc", "f-acc2", "f-pre", "f-next"].forEach(function (id) { $(id).addEventListener("input", readDetails); });
    ["f-font", "f-size", "f-orient", "f-medal", "f-showNo"].forEach(function (id) {
      $(id).addEventListener("change", function () { readDetails(); renderForm(); if (id === "f-orient" || id === "f-size" || id === "f-font") renderStyles(); });
    });
    $("f-next").addEventListener("change", renderForm);
    $("f-qr").addEventListener("change", onQr);
    $("qr-copy").addEventListener("click", copyFp);
    $("qr-open").addEventListener("click", openCheck);
    $("f-kind").addEventListener("change", onKind);
    $("f-lang").addEventListener("change", onLang);
    $("tx-reset").addEventListener("click", resetTexts);
    $("stys").addEventListener("keydown", function (e) {
      var d = (e.key === "ArrowRight" || e.key === "ArrowDown") ? 1 : ((e.key === "ArrowLeft" || e.key === "ArrowUp") ? -1 : 0);
      if (!d || !ev) return;
      e.preventDefault();
      var i = C.STYLES.indexOf(ev.sty);
      pickStyle(C.STYLES[(i + d + C.STYLES.length) % C.STYLES.length]);
    });
    $("sig-add").addEventListener("click", function () {
      if (!ev || ev.sigs.length >= C.LIM.sigs) return;
      change(function (e) { e.sigs.push({ n: "", r: C.sigRole(e.lang, e.kind) }); });
    });
    wirePad();
    $("draw-clear").addEventListener("click", clearPad);
    $("draw-go").addEventListener("click", useDrawing);
    $("add-form").addEventListener("submit", addOne);
    $("paste-btn").addEventListener("click", openPaste);
    $("paste-ta").addEventListener("input", readPaste);
    $("paste-go").addEventListener("click", pasteGo);
    $("paste-sample").addEventListener("click", saveSample);
    $("file-btn").addEventListener("click", openList);
    $("ct-btn").addEventListener("click", fromContacts);
    $("crm-btn").addEventListener("click", fromCrm);
    $("ppl-q").addEventListener("input", function () { pplShown = PAGE; renderPeople(); });
    $("ppl-more").addEventListener("click", function () { pplShown += PAGE; renderPeople(); });
    $("pe-save").addEventListener("click", savePerson);
    $("pe-del").addEventListener("click", removePerson);
    $("pe-mail").addEventListener("click", function () { var id = peId; if (savePerson() !== false) sendMail(id); });
    ["pe-n", "pe-n2", "pe-em", "pe-g", "pe-x"].forEach(function (id) {
      $(id).addEventListener("keydown", function (e) { if (e.key === "Enter") { e.preventDefault(); savePerson(); } });
    });
    $("num-btn").addEventListener("click", function () { giveNumbers(false); });
    $("pdf-all").addEventListener("click", pdfAll);
    $("zip-all").addEventListener("click", zipAll);
    $("files-all").addEventListener("click", filesAll);
    $("print-btn").addEventListener("click", printAll);
    $("pdf-one").addEventListener("click", pdfOne);
    $("png-one").addEventListener("click", pngOne);
    $("mail-btn").addEventListener("click", openMailList);
    $("send-btn").addEventListener("click", openSend);
    $("send-go").addEventListener("click", sendGo);
    $("send-again").addEventListener("change", renderSend);
    $("reg-btn").addEventListener("click", saveRegister);
    $("ob-btn").addEventListener("click", badgesZip);
    $("sheet-btn").addEventListener("click", sheetPdf);
    $("at-all").addEventListener("click", function () { markAt(null, true); });
    $("at-none").addEventListener("click", function () { markAt(null, false); });
    $("f-onlyAt").addEventListener("change", function () {
      var on = $("f-onlyAt").checked;
      change(function (e) { e.onlyAt = on ? 1 : 0; }, { quiet: true });
      renderChecks();
    });
    $("pv-prev").addEventListener("click", function () { stepPreview(-1); });
    $("pv-next").addEventListener("click", function () { stepPreview(1); });
    $("pv-sel").addEventListener("change", function () { pvId = $("pv-sel").value; renderPreview(); });
    $("dup-btn").addEventListener("click", duplicate);
    $("clear-btn").addEventListener("click", clearList);
    $("del-btn").addEventListener("click", delEvent);
    $("pick-q").addEventListener("input", renderPick);
    $("ask-no").addEventListener("click", function () { var f = askNo; askYes = askNo = null; hideDlg(); if (f) f(); });
    $("ask-yes").addEventListener("click", function () { var f = askYes; askYes = askNo = null; hideDlg(); if (f) f(); });
    $("scrim").addEventListener("click", function () { hideDlg(); });
    [].forEach.call(document.querySelectorAll(".dlg-close"), function (b) { b.addEventListener("click", function () { hideDlg(); }); });
    $("file-in").addEventListener("change", function () {
      var f = $("file-in").files && $("file-in").files[0], r = fileWait;
      fileWait = null;
      if (r) r(f || null);
    });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && openDlg) { e.preventDefault(); hideDlg(); }
    });
    // Contract B: Ctrl+Alt+Shift shortcuts go to the shell
    document.addEventListener("keydown", function (e) {
      if (!(e.ctrlKey || e.metaKey) || !e.altKey || !e.shiftKey) return;
      var p = null; try { p = window.parent; } catch (err) { return; }
      if (!(p && p !== window && p.orosShortcuts && typeof p.orosShortcuts.handle === "function")) return;
      if (p.orosShortcuts.handle(e)) e.stopPropagation();
    }, true);
    window.addEventListener("pagehide", function () { if (saveTimer) saveNow(); });
    document.addEventListener("visibilitychange", function () { if (document.visibilityState === "hidden" && saveTimer) saveNow(); });
    window.addEventListener("resize", function () { renderPreviewSoon(); });
    A.onChange(function () { thumbs = {}; renderPreviewSoon(); if (ev) renderPics(); else if (!$("home").hidden) renderHome(); });
  }

  function start() {
    $("loading").hidden = true;
    fontsReady = true;
    D.resetFit();
    var tg = pending;
    pending = null;
    var opened = false;
    try {
      var s = shell();
      if (!tg && s && typeof s.__orosTakeTarget === "function") tg = s.__orosTakeTarget("certificates");
    } catch (e) {}
    if (tg) opened = openTarget(tg);
    if (!opened) {
      if (prefs.cur && C.eventById(data, prefs.cur)) openEvent(prefs.cur);
      else showHome();
    }
  }
  function boot() {
    load();
    applyI18n();
    inheritPalette();
    wire();
    registerSync();
    watchPalette();
    if (!shell()) toast(t("standalone"));
    T.load(T.allKeys()).then(start, function () { toast(t("toast.fontFail")); start(); });
    console.log("[orOS Certificates] v" + C.VERSION + " ready");
  }

  boot();
})();
