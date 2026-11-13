// ============================================================
// orOS Forms — the app (forms/app.js), wave 1: the builder
// Make forms and surveys: questions of 14 kinds, statements, pages,
// "show only if" conditions, jumps between pages, required answers and
// checks, a preview that behaves exactly like the form people will fill
// in (render.js on engine.js), templates, duplicate and delete with
// Undo. Sharing and answers come in wave 2 (see OROS_BIBLE.md Forms).
// Data: the synced slice "forms" (oros-forms-data, core.js).
// Device-local: none.
// Sections:
//   1. Strings + helpers
//   2. Storage + sync slice
//   3. List of forms
//   4. Editor: head, items, one item's fields
//   5. Conditions and jumps
//   6. Preview + settings
//   7. Dialogs: new form, add item
//   8. Toast, palette, wiring, boot
// ============================================================
(function () {
  "use strict";

  var E = window.OrosFormsEngine, C = window.OrosFormsCore, R = window.OrosFormsRender;
  var STORAGE_KEY = C.STORAGE_KEY;

  // ---------- 1. Strings + helpers ----------
  function appLang() {
    if (window.orosI18n) return window.orosI18n.lang();
    try {
      var l = localStorage.getItem("oros-lang") || (window.parent && window.parent.orosLang) || "en";
      return l === "el" ? "el" : "en";
    } catch (e) { return "en"; }
  }
  var LANG = appLang();

  var STRINGS = {
    en: {
      "app": "Forms", "search": "Search forms", "search.none": "No form matches.",
      "btn.new": "New form", "btn.cancel": "Cancel", "btn.dup": "Duplicate form", "btn.del": "Delete form",
      "btn.back": "All forms", "btn.undo": "Undo",
      "tab.edit": "Questions", "tab.prev": "Preview", "tab.set": "Settings",
      "empty.title": "No forms yet",
      "empty.text": "Make a survey, a sign-up sheet or an order form. Start from scratch or from a template.",
      "list.meta": "{n} questions · changed {d}", "list.meta1": "1 question · changed {d}",
      "list.pages": "{n} pages",
      "ed.title": "Form title", "ed.desc": "Description (optional)", "ed.add": "Add question",
      "ed.empty": "No questions yet. Add the first one.",
      "ed.label": "Question", "ed.labelInfo": "Title", "ed.labelPage": "Page title",
      "ed.help": "Help text (optional)", "ed.helpInfo": "Text", "ed.helpPage": "Text at the top of the page (optional)",
      "ed.type": "Kind", "ed.req": "Required",
      "ed.opts": "Answers", "ed.cols": "Columns", "ed.rows": "Rows",
      "ed.addOpt": "Add answer", "ed.addCol": "Add column", "ed.addRow": "Add row",
      "ed.other": "Add “Other” with a text box", "ed.optN": "Answer {n}", "ed.rowN": "Row {n}", "ed.colN": "Column {n}",
      "ed.rmOpt": "Remove “{x}”",
      "ed.minL": "At least (characters)", "ed.maxL": "At most (characters)",
      "ed.min": "Smallest", "ed.max": "Largest", "ed.int": "Whole numbers only",
      "ed.minD": "Earliest", "ed.maxD": "Latest",
      "ed.minC": "Choose at least", "ed.maxC": "Choose at most",
      "ed.from": "From", "ed.to": "To", "ed.loL": "Label at the start", "ed.hiL": "Label at the end",
      "ed.starsN": "Stars", "ed.multiRow": "More than one answer per row",
      "ed.up": "Move up", "ed.down": "Move down", "ed.copy": "Duplicate", "ed.rm": "Delete", "ed.done": "Done",
      "ed.untitled": "Untitled question", "ed.untitledPage": "Untitled page",
      "ed.pageN": "Page {n}", "ed.badgeShow": "Shown only sometimes", "ed.badgeGo": "Jumps",
      "ed.reqMark": "required",
      "show.title": "Show only if…", "show.always": "Always show",
      "show.eq": "is", "show.ne": "is not", "show.has": "includes", "show.set": "is answered",
      "show.unset": "is not answered", "show.gt": "is more than", "show.lt": "is less than",
      "show.none": "Add a question before this one to show it only for some answers.",
      "show.value": "Value",
      "go.title": "After this page, go to…", "go.byAnswer": "Go to a page by answer",
      "go.next": "The next page", "go.end": "Submit the form", "go.page": "{p}",
      "go.noPages": "Add a page break after this question to send people to different pages.",
      "go.noteLast": "The last answered question with jumps on a page decides where it goes.",
      "type.pick": "Add",
      "type.text": "Short answer", "type.para": "Paragraph", "type.email": "E-mail", "type.phone": "Phone",
      "type.number": "Number", "type.date": "Date", "type.time": "Time", "type.choice": "One choice",
      "type.multi": "Checkboxes", "type.select": "Drop-down", "type.scale": "Linear scale",
      "type.stars": "Rating", "type.yesno": "Yes / No", "type.matrix": "Grid",
      "type.info": "Text block", "type.page": "Page break",
      "prev.hint": "This is how people see the form. Answers you give here are not kept.",
      "set.thanks": "Message after submitting",
      "set.thanksHint": "Leave it empty for “Thank you. Your answers have been recorded.”",
      "set.note": "Note at the top (for example how you use the answers)",
      "set.prog": "Show a progress bar on forms with pages",
      "set.share": "Sharing",
      "set.shareSoon": "Sharing a form with a link, a QR code or on your website comes in the next update of Forms. For now you can build, preview and duplicate forms.",
      "new.title": "New form", "new.blank": "Blank form", "new.blankText": "Start from nothing.",
      "toast.deleted": "Form deleted", "toast.itemDeleted": "Question deleted", "toast.dup": "Form duplicated",
      "toast.full": "Could not save: storage is full", "toast.cap": "A form holds at most {n} items",
      "toast.optCap": "At most {n} answers",
      "copyOf": "{x} (copy)",
      "tpl.contact": "Contact form", "tpl.contactText": "Name, e-mail, phone and a message.",
      "tpl.event": "Event sign-up", "tpl.eventText": "Who comes, how many, and their needs.",
      "tpl.feedback": "Feedback", "tpl.feedbackText": "Stars, what went well and what could be better.",
      "tpl.order": "Order form", "tpl.orderText": "Product, quantity, pick-up or delivery.",
      "tpl.survey": "Satisfaction survey", "tpl.surveyText": "A grid of ratings and a few questions.",
      "tpl.course": "Course sign-up", "tpl.courseText": "Course, level and the days that suit.",
      "q.name": "Full name", "q.email": "E-mail", "q.phone": "Phone", "q.message": "Message",
      "q.contactDesc": "Send us a message and we will get back to you.",
      "q.attend": "Will you come?", "q.details": "A few details", "q.guests": "How many people, you included?",
      "q.diet": "Food needs", "q.diet1": "Vegetarian", "q.diet2": "Vegan", "q.diet3": "Gluten-free",
      "q.comments": "Anything else we should know?", "q.eventDesc": "Let us know if you can make it.",
      "q.stars": "How happy are you overall?", "q.liked": "What did you like?",
      "q.better": "What could be better?", "q.recommend": "How likely are you to recommend us?",
      "q.notLikely": "Not at all", "q.veryLikely": "Very likely",
      "q.product": "Product", "q.prod1": "Product A", "q.prod2": "Product B", "q.prod3": "Product C",
      "q.qty": "Quantity", "q.how": "How do you want it?", "q.pickup": "I'll pick it up", "q.delivery": "Delivery",
      "q.address": "Delivery address", "q.notes": "Notes",
      "q.rate": "How would you rate us?", "q.quality": "Quality", "q.price": "Price", "q.service": "Service",
      "q.poor": "Poor", "q.fair": "Fair", "q.good": "Good", "q.great": "Excellent",
      "q.age": "Age group", "q.age1": "Under 18", "q.age2": "18–34", "q.age3": "35–54", "q.age4": "55 or older",
      "q.course": "Course", "q.course1": "Course 1", "q.course2": "Course 2",
      "q.level": "Your level", "q.lvl1": "Beginner", "q.lvl2": "Intermediate", "q.lvl3": "Advanced",
      "q.days": "Which days suit you?", "q.mon": "Monday", "q.tue": "Tuesday", "q.wed": "Wednesday",
      "q.thu": "Thursday", "q.fri": "Friday", "q.sat": "Saturday", "q.questions": "Questions for us",
      "q.opt1": "Option 1", "q.row1": "Row 1", "q.col1": "Column 1"
    },
    el: {
      "app": "Φόρμες", "search": "Αναζήτηση φορμών", "search.none": "Καμία φόρμα δεν ταιριάζει.",
      "btn.new": "Νέα φόρμα", "btn.cancel": "Άκυρο", "btn.dup": "Αντίγραφο φόρμας", "btn.del": "Διαγραφή φόρμας",
      "btn.back": "Όλες οι φόρμες", "btn.undo": "Αναίρεση",
      "tab.edit": "Ερωτήσεις", "tab.prev": "Προεπισκόπηση", "tab.set": "Ρυθμίσεις",
      "empty.title": "Καμία φόρμα ακόμα",
      "empty.text": "Φτιάξε μια έρευνα, μια λίστα εγγραφών ή μια φόρμα παραγγελίας. Ξεκίνα από το μηδέν ή από ένα πρότυπο.",
      "list.meta": "{n} ερωτήσεις · αλλαγή {d}", "list.meta1": "1 ερώτηση · αλλαγή {d}",
      "list.pages": "{n} σελίδες",
      "ed.title": "Τίτλος φόρμας", "ed.desc": "Περιγραφή (προαιρετικά)", "ed.add": "Προσθήκη ερώτησης",
      "ed.empty": "Καμία ερώτηση ακόμα. Πρόσθεσε την πρώτη.",
      "ed.label": "Ερώτηση", "ed.labelInfo": "Τίτλος", "ed.labelPage": "Τίτλος σελίδας",
      "ed.help": "Βοηθητικό κείμενο (προαιρετικά)", "ed.helpInfo": "Κείμενο", "ed.helpPage": "Κείμενο στην αρχή της σελίδας (προαιρετικά)",
      "ed.type": "Είδος", "ed.req": "Υποχρεωτική",
      "ed.opts": "Απαντήσεις", "ed.cols": "Στήλες", "ed.rows": "Γραμμές",
      "ed.addOpt": "Προσθήκη απάντησης", "ed.addCol": "Προσθήκη στήλης", "ed.addRow": "Προσθήκη γραμμής",
      "ed.other": "Προσθήκη «Άλλο» με πεδίο κειμένου", "ed.optN": "Απάντηση {n}", "ed.rowN": "Γραμμή {n}", "ed.colN": "Στήλη {n}",
      "ed.rmOpt": "Αφαίρεση «{x}»",
      "ed.minL": "Τουλάχιστον (χαρακτήρες)", "ed.maxL": "Το πολύ (χαρακτήρες)",
      "ed.min": "Ελάχιστο", "ed.max": "Μέγιστο", "ed.int": "Μόνο ακέραιοι",
      "ed.minD": "Νωρίτερα", "ed.maxD": "Αργότερα",
      "ed.minC": "Επιλογή τουλάχιστον", "ed.maxC": "Επιλογή το πολύ",
      "ed.from": "Από", "ed.to": "Έως", "ed.loL": "Ετικέτα στην αρχή", "ed.hiL": "Ετικέτα στο τέλος",
      "ed.starsN": "Αστέρια", "ed.multiRow": "Πάνω από μία απάντηση ανά γραμμή",
      "ed.up": "Μετακίνηση πάνω", "ed.down": "Μετακίνηση κάτω", "ed.copy": "Αντίγραφο", "ed.rm": "Διαγραφή", "ed.done": "Τέλος",
      "ed.untitled": "Ερώτηση χωρίς τίτλο", "ed.untitledPage": "Σελίδα χωρίς τίτλο",
      "ed.pageN": "Σελίδα {n}", "ed.badgeShow": "Εμφανίζεται μόνο κάποιες φορές", "ed.badgeGo": "Μεταβάσεις",
      "ed.reqMark": "υποχρεωτική",
      "show.title": "Εμφάνιση μόνο αν…", "show.always": "Εμφάνιση πάντα",
      "show.eq": "είναι", "show.ne": "δεν είναι", "show.has": "περιλαμβάνει", "show.set": "έχει απάντηση",
      "show.unset": "δεν έχει απάντηση", "show.gt": "είναι πάνω από", "show.lt": "είναι κάτω από",
      "show.none": "Πρόσθεσε μια ερώτηση πριν από αυτή, για να εμφανίζεται μόνο για κάποιες απαντήσεις.",
      "show.value": "Τιμή",
      "go.title": "Μετά από αυτή τη σελίδα, πήγαινε σε…", "go.byAnswer": "Μετάβαση σε σελίδα ανάλογα με την απάντηση",
      "go.next": "Την επόμενη σελίδα", "go.end": "Υποβολή της φόρμας", "go.page": "{p}",
      "go.noPages": "Πρόσθεσε αλλαγή σελίδας μετά από αυτή την ερώτηση, για να στέλνεις τους άλλους σε διαφορετικές σελίδες.",
      "go.noteLast": "Αν μια σελίδα έχει πολλές ερωτήσεις με μεταβάσεις, αποφασίζει η τελευταία που απαντήθηκε.",
      "type.pick": "Προσθήκη",
      "type.text": "Σύντομη απάντηση", "type.para": "Παράγραφος", "type.email": "Email", "type.phone": "Τηλέφωνο",
      "type.number": "Αριθμός", "type.date": "Ημερομηνία", "type.time": "Ώρα", "type.choice": "Μία επιλογή",
      "type.multi": "Πολλές επιλογές", "type.select": "Αναπτυσσόμενη λίστα", "type.scale": "Γραμμική κλίμακα",
      "type.stars": "Βαθμολογία", "type.yesno": "Ναι / Όχι", "type.matrix": "Πλέγμα",
      "type.info": "Μπλοκ κειμένου", "type.page": "Αλλαγή σελίδας",
      "prev.hint": "Έτσι βλέπουν οι άλλοι τη φόρμα. Ό,τι απαντήσεις εδώ δεν κρατιέται.",
      "set.thanks": "Μήνυμα μετά την υποβολή",
      "set.thanksHint": "Άφησέ το κενό για το «Ευχαριστούμε. Οι απαντήσεις σας καταχωρίστηκαν.»",
      "set.note": "Σημείωση στην κορυφή (για παράδειγμα πώς χρησιμοποιείς τις απαντήσεις)",
      "set.prog": "Μπάρα προόδου στις φόρμες με σελίδες",
      "set.share": "Κοινή χρήση",
      "set.shareSoon": "Η κοινή χρήση μιας φόρμας με σύνδεσμο, κωδικό QR ή στον ιστότοπό σου έρχεται στην επόμενη ενημέρωση των Φορμών. Προς το παρόν μπορείς να φτιάχνεις φόρμες, να τις βλέπεις σε προεπισκόπηση και να τις αντιγράφεις.",
      "new.title": "Νέα φόρμα", "new.blank": "Κενή φόρμα", "new.blankText": "Ξεκίνα από το μηδέν.",
      "toast.deleted": "Η φόρμα διαγράφηκε", "toast.itemDeleted": "Η ερώτηση διαγράφηκε", "toast.dup": "Έγινε αντίγραφο της φόρμας",
      "toast.full": "Δεν αποθηκεύτηκε: ο χώρος είναι γεμάτος", "toast.cap": "Μια φόρμα χωράει το πολύ {n} στοιχεία",
      "toast.optCap": "Το πολύ {n} απαντήσεις",
      "copyOf": "{x} (αντίγραφο)",
      "tpl.contact": "Φόρμα επικοινωνίας", "tpl.contactText": "Όνομα, email, τηλέφωνο και μήνυμα.",
      "tpl.event": "Εγγραφή σε εκδήλωση", "tpl.eventText": "Ποιος έρχεται, πόσοι και τι χρειάζονται.",
      "tpl.feedback": "Σχόλια", "tpl.feedbackText": "Αστέρια, τι πήγε καλά και τι θα μπορούσε να γίνει καλύτερα.",
      "tpl.order": "Φόρμα παραγγελίας", "tpl.orderText": "Προϊόν, ποσότητα, παραλαβή ή αποστολή.",
      "tpl.survey": "Έρευνα ικανοποίησης", "tpl.surveyText": "Ένα πλέγμα βαθμολογιών και λίγες ερωτήσεις.",
      "tpl.course": "Εγγραφή σε μάθημα", "tpl.courseText": "Μάθημα, επίπεδο και οι μέρες που βολεύουν.",
      "q.name": "Ονοματεπώνυμο", "q.email": "Email", "q.phone": "Τηλέφωνο", "q.message": "Μήνυμα",
      "q.contactDesc": "Στείλτε μας ένα μήνυμα και θα επικοινωνήσουμε μαζί σας.",
      "q.attend": "Θα έρθετε;", "q.details": "Μερικές λεπτομέρειες", "q.guests": "Πόσα άτομα, μαζί με εσάς;",
      "q.diet": "Διατροφικές ανάγκες", "q.diet1": "Χορτοφαγικό", "q.diet2": "Vegan", "q.diet3": "Χωρίς γλουτένη",
      "q.comments": "Κάτι άλλο που πρέπει να ξέρουμε;", "q.eventDesc": "Πείτε μας αν θα μπορέσετε να έρθετε.",
      "q.stars": "Πόσο ικανοποιημένοι είστε συνολικά;", "q.liked": "Τι σας άρεσε;",
      "q.better": "Τι θα μπορούσε να γίνει καλύτερα;", "q.recommend": "Πόσο πιθανό είναι να μας προτείνετε;",
      "q.notLikely": "Καθόλου", "q.veryLikely": "Πολύ πιθανό",
      "q.product": "Προϊόν", "q.prod1": "Προϊόν Α", "q.prod2": "Προϊόν Β", "q.prod3": "Προϊόν Γ",
      "q.qty": "Ποσότητα", "q.how": "Πώς το θέλετε;", "q.pickup": "Θα το παραλάβω", "q.delivery": "Αποστολή",
      "q.address": "Διεύθυνση αποστολής", "q.notes": "Σημειώσεις",
      "q.rate": "Πώς θα μας βαθμολογούσατε;", "q.quality": "Ποιότητα", "q.price": "Τιμή", "q.service": "Εξυπηρέτηση",
      "q.poor": "Κακή", "q.fair": "Μέτρια", "q.good": "Καλή", "q.great": "Άριστη",
      "q.age": "Ηλικία", "q.age1": "Κάτω από 18", "q.age2": "18–34", "q.age3": "35–54", "q.age4": "55 και πάνω",
      "q.course": "Μάθημα", "q.course1": "Μάθημα 1", "q.course2": "Μάθημα 2",
      "q.level": "Το επίπεδό σας", "q.lvl1": "Αρχάριο", "q.lvl2": "Μέσο", "q.lvl3": "Προχωρημένο",
      "q.days": "Ποιες μέρες σας βολεύουν;", "q.mon": "Δευτέρα", "q.tue": "Τρίτη", "q.wed": "Τετάρτη",
      "q.thu": "Πέμπτη", "q.fri": "Παρασκευή", "q.sat": "Σάββατο", "q.questions": "Ερωτήσεις για εμάς",
      "q.opt1": "Επιλογή 1", "q.row1": "Γραμμή 1", "q.col1": "Στήλη 1"
    }
  };
  // The fill-in strings of render.js are part of the same table.
  Object.keys(R.STRINGS).forEach(function (l) {
    Object.keys(R.STRINGS[l]).forEach(function (k) { if (STRINGS[l] && !STRINGS[l][k]) STRINGS[l][k] = R.STRINGS[l][k]; });
  });
  if (window.orosI18n) window.orosI18n.table(STRINGS, "forms", LANG);

  function t(k, v) {
    var s = (STRINGS[LANG] && STRINGS[LANG][k]) || STRINGS.en[k] || k;
    if (v) Object.keys(v).forEach(function (n) { s = s.split("{" + n + "}").join(String(v[n])); });
    return s;
  }
  function $(id) { return document.getElementById(id); }
  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  function locale() { return window.orosI18n ? window.orosI18n.locale(LANG) : (LANG === "el" ? "el-GR" : "en-GB"); }
  function fmtDay(ms) {
    try { return new Date(ms).toLocaleDateString(locale(), { day: "numeric", month: "short", year: "numeric" }); }
    catch (e) { return new Date(ms).toISOString().slice(0, 10); }
  }
  function fold(s) {
    return String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  }

  var ICON = {
    back: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>',
    up: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="18 15 12 9 6 15"/></svg>',
    down: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>',
    copy: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>',
    bin: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4h6v2"/></svg>',
    x: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>'
  };
  // Static markup only (never data): the icons above.
  function iconBtn(svg, label, cls) {
    var b = el("button", "icon-btn" + (cls ? " " + cls : ""));
    b.type = "button";
    b.innerHTML = svg;
    b.setAttribute("aria-label", label);
    b.title = label;
    return b;
  }

  // ---------- 2. Storage + sync slice ----------
  var data = { ver: 1, forms: [] };
  var cur = null;          // the open form (a working copy of its record)
  var openId = "";         // which item card is open in the editor
  var saveTimer = 0;

  function load() {
    var raw = null;
    try { raw = localStorage.getItem(STORAGE_KEY); } catch (e) {}
    if (!raw) return;
    try { data = C.normalize(JSON.parse(raw)); }
    catch (e) { try { localStorage.setItem(STORAGE_KEY + "-broken", raw); } catch (x) {} }
  }
  function persist() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(data)); }
    catch (e) { toast(t("toast.full")); return false; }
    if (window.__orosSyncApi) window.__orosSyncApi.dirty();
    return true;
  }
  // The open form goes into the data (only a real change gets a new stamp).
  function commit() {
    clearTimeout(saveTimer);
    saveTimer = 0;
    if (!cur) return;
    var res = C.put(data, cur, Date.now());
    if (!res.changed) return;
    data = res.data;
    // Only the stamps: the editor's fields keep working on cur's objects.
    cur.m = res.rec.m;
    cur.c = res.rec.c;
    persist();
  }
  function soon() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(commit, 400);
  }

  function syncApi() {
    try { return (window.parent && window.parent.orosSync) || window.orosSync || null; }
    catch (e) { return window.orosSync || null; }
  }
  function registerSync() {
    var api = syncApi();
    window.__orosSyncApi = {
      _suppress: false,
      dirty: function () {
        if (this._suppress) return;
        if (api && typeof api.markDirty === "function") api.markDirty();
      }
    };
    if (!api || typeof api.registerSlice !== "function") return;
    api.registerSlice("forms", sliceGet, sliceSet, STORAGE_KEY, C.merge);
  }
  function sliceGet() { commit(); return C.normalize(data); }
  function sliceSet(incoming) {
    if (!incoming || typeof incoming !== "object" || !Array.isArray(incoming.forms)) return;
    commit();
    var before = JSON.stringify(data);
    window.__orosSyncApi._suppress = true;      // R6: a pull never marks dirty
    try {
      data = C.merge(data, incoming);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch (e) {
    } finally { window.__orosSyncApi._suppress = false; }
    if (JSON.stringify(data) === before) return;
    if (cur) {
      var rec = C.find(data, cur.id);
      if (!rec || rec.del) { closeForm(true); return; }
      if (rec.m !== cur.m) {
        // Another device changed this form: show its version, unless the
        // person is typing in it right now (then their next save, newer,
        // wins, as the merge rule says).
        var a = document.activeElement;
        var typing = a && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName) && $("edit-view").contains(a);
        if (!typing) { cur = JSON.parse(JSON.stringify(rec)); renderForm(); }
      }
    } else renderList();
  }

  // ---------- 3. List of forms ----------
  function renderList() {
    var q = fold($("search").value.trim());
    var all = C.live(data).slice().sort(function (a, b) { return b.m - a.m; });
    var shown = all.filter(function (f) { return !q || fold(f.title + " " + (f.desc || "")).indexOf(q) >= 0; });
    var ul = $("forms-list");
    ul.textContent = "";
    shown.forEach(function (f) {
      var li = el("li");
      var b = el("button", "row-main");
      b.type = "button";
      b.appendChild(el("span", "name", f.title || t("f.untitled")));
      var asked = f.qs.filter(function (x) { return E.ASKS[x.t]; }).length;
      var np = 1 + f.qs.filter(function (x) { return x.t === "page"; }).length;
      var meta = t(asked === 1 ? "list.meta1" : "list.meta", { n: asked, d: fmtDay(f.m) });
      if (np > 1) meta += " · " + t("list.pages", { n: np });
      b.appendChild(el("span", "meta", meta));
      b.addEventListener("click", function () { openForm(f.id); });
      li.appendChild(b);
      ul.appendChild(li);
    });
    $("list-empty").hidden = all.length > 0;
    $("search-bar").hidden = all.length < 2;
    $("list-none").hidden = !(all.length && !shown.length);
  }

  function openForm(id, tab) {
    var rec = C.find(data, id);
    if (!rec || rec.del) return;
    commit();
    cur = JSON.parse(JSON.stringify(rec));
    openId = "";
    $("list-view").hidden = true;
    $("edit-view").hidden = false;
    $("tabs").hidden = false;
    $("back-btn").hidden = false;
    $("new-btn").hidden = true;
    $("title").hidden = true;
    renderForm();
    setTab(tab || "edit");
    window.scrollTo(0, 0);
  }
  // gone = the form was deleted (here or on another device): nothing of
  // it is saved again.
  function closeForm(gone) {
    if (gone === true) { clearTimeout(saveTimer); saveTimer = 0; } else commit();
    cur = null;
    if (preview) { preview.destroy(); preview = null; }
    $("edit-view").hidden = true;
    $("list-view").hidden = false;
    $("tabs").hidden = true;
    $("back-btn").hidden = true;
    $("new-btn").hidden = false;
    $("title").hidden = false;
    renderList();
  }

  // ---------- 4. Editor ----------
  function renderForm() {
    if (!cur) return;
    var ti = $("f-title"), de = $("f-desc");
    if (document.activeElement !== ti) ti.value = cur.title || "";
    if (document.activeElement !== de) de.value = cur.desc || "";
    $("s-thanks").value = cur.set.thanks || "";
    $("s-note").value = cur.set.note || "";
    $("s-prog").checked = !!cur.set.prog;
    renderItems();
    if (!$("pane-prev").hidden) renderPreview();
  }

  // After an edit: saved soon (core.js normalizes what is stored). A
  // change of structure also normalizes the working copy (references
  // follow the engine's rules) and draws the cards again; a typed change
  // does not, so the fields keep editing the same objects.
  function changed(redraw) {
    soon();
    if (!redraw) return;
    var f = E.normForm(cur);
    cur.qs = f.qs;
    cur.set = f.set;
    renderItems();
  }

  function pageNumbers() {
    var n = 1, map = {};
    cur.qs.forEach(function (q) { if (q.t === "page") map[q.id] = ++n; });
    return map;
  }
  function pageName(q, nums) {
    return q.label ? t("ed.pageN", { n: nums[q.id] }) + " · " + q.label : t("ed.pageN", { n: nums[q.id] });
  }

  function renderItems() {
    var ol = $("items");
    ol.textContent = "";
    var nums = pageNumbers();
    if (cur.qs.some(function (q) { return q.t === "page"; })) {
      ol.appendChild(el("li", "page-mark", t("ed.pageN", { n: 1 })));
    }
    cur.qs.forEach(function (q, i) {
      var li = el("li", "item" + (q.t === "page" ? " is-page" : "") + (q.id === openId ? " open" : ""));
      li.dataset.id = q.id;
      if (q.id === openId) li.appendChild(itemEditor(q, i, nums));
      else li.appendChild(itemSummary(q, nums));
      ol.appendChild(li);
    });
    $("items-empty").hidden = cur.qs.length > 0;
  }

  function itemSummary(q, nums) {
    var b = el("button", "sum");
    b.type = "button";
    var kind = el("span", "kind", q.t === "page" ? t("ed.pageN", { n: nums[q.id] }) : t("type." + q.t));
    b.appendChild(kind);
    var name = q.t === "page" ? (q.label || t("ed.untitledPage")) : (q.label || t("ed.untitled"));
    var label = el("span", "label" + (q.label ? "" : " dim"), name);
    if (q.req) {
      var s = el("span", "req", " *");
      s.setAttribute("aria-label", t("ed.reqMark"));
      label.appendChild(s);
    }
    b.appendChild(label);
    var badges = el("span", "badges");
    if (q.show) badges.appendChild(el("span", "badge", t("ed.badgeShow")));
    if (q.go || q.next) badges.appendChild(el("span", "badge", t("ed.badgeGo")));
    if (badges.childNodes.length) b.appendChild(badges);
    b.addEventListener("click", function () { openId = q.id; commit(); renderItems(); focusOpen(); });
    return b;
  }
  function focusOpen() {
    var n = document.querySelector(".item.open .q-label");
    if (n) { n.focus(); if (n.scrollIntoView) n.scrollIntoView({ block: "nearest" }); }
  }

  function field(label, input, cls) {
    var w = el("label", "fld" + (cls ? " " + cls : ""));
    w.appendChild(el("span", "", label));
    w.appendChild(input);
    return w;
  }
  function textIn(value, max, onInput, cls) {
    var i = el("input", cls || "");
    i.type = "text";
    i.maxLength = max;
    i.value = value || "";
    i.addEventListener("input", function () { onInput(i.value); });
    return i;
  }
  function areaIn(value, max, onInput) {
    var i = el("textarea");
    i.rows = 2;
    i.maxLength = max;
    i.value = value || "";
    i.addEventListener("input", function () { onInput(i.value); });
    return i;
  }
  function numIn(value, onChange, opts) {
    var i = el("input");
    i.type = opts && opts.date ? "date" : "text";
    if (!(opts && opts.date)) i.inputMode = "decimal";
    i.value = value == null ? "" : String(value);
    i.addEventListener("change", function () { onChange(i.value.trim()); });
    return i;
  }
  function checkIn(label, on, onChange) {
    var w = el("label", "opt");
    var c = el("input");
    c.type = "checkbox";
    c.checked = !!on;
    c.addEventListener("change", function () { onChange(c.checked); });
    w.appendChild(c);
    w.appendChild(el("span", "", label));
    return w;
  }
  function selectIn(choices, value, onChange) {
    var s = el("select");
    choices.forEach(function (c) {
      var o = el("option", "", c[1]);
      o.value = c[0];
      s.appendChild(o);
    });
    s.value = value;
    s.addEventListener("change", function () { onChange(s.value); });
    return s;
  }
  function toNum(s) {
    if (s === "") return undefined;
    var n = Number(String(s).replace(",", "."));
    return isFinite(n) ? n : undefined;
  }
  function setOrDrop(q, k, v) { if (v === undefined || v === "" || v === null) delete q[k]; else q[k] = v; }

  function itemEditor(q, i, nums) {
    var box = el("div", "editor");
    // Kind (a page break stays a page break)
    if (q.t !== "page") {
      var kinds = E.TYPES.filter(function (k) { return k !== "page"; }).map(function (k) { return [k, t("type." + k)]; });
      box.appendChild(field(t("ed.type"), selectIn(kinds, q.t, function (v) { retype(q, v); })));
    }
    var lbl = q.t === "page" ? t("ed.labelPage") : (q.t === "info" ? t("ed.labelInfo") : t("ed.label"));
    var li = textIn(q.label, E.LIM.label, function (v) { q.label = v; changed(false); }, "q-label");
    box.appendChild(field(lbl, li));
    var hl = q.t === "page" ? t("ed.helpPage") : (q.t === "info" ? t("ed.helpInfo") : t("ed.help"));
    box.appendChild(field(hl, areaIn(q.help, E.LIM.help, function (v) { q.help = v; changed(false); })));
    typeFields(box, q);
    if (E.ASKS[q.t]) box.appendChild(checkIn(t("ed.req"), q.req, function (on) { q.req = on ? 1 : 0; changed(false); }));
    if (q.t !== "page") showEditor(box, q, i);
    jumpEditor(box, q, i, nums);
    // Actions
    var bar = el("div", "bar actions");
    var up = iconBtn(ICON.up, t("ed.up"));
    up.disabled = i === 0;
    up.addEventListener("click", function () { move(i, -1); });
    var dn = iconBtn(ICON.down, t("ed.down"));
    dn.disabled = i === cur.qs.length - 1;
    dn.addEventListener("click", function () { move(i, 1); });
    var cp = iconBtn(ICON.copy, t("ed.copy"));
    cp.addEventListener("click", function () { dupItem(i); });
    var rm = iconBtn(ICON.bin, t("ed.rm"), "danger");
    rm.addEventListener("click", function () { removeItem(i); });
    var done = el("button", "chip", t("ed.done"));
    done.type = "button";
    done.addEventListener("click", function () { openId = ""; commit(); renderItems(); });
    bar.appendChild(up); bar.appendChild(dn); bar.appendChild(cp); bar.appendChild(rm);
    bar.appendChild(el("span", "spacer"));
    bar.appendChild(done);
    box.appendChild(bar);
    return box;
  }

  function words() { return { opt1: t("q.opt1"), row1: t("q.row1"), col1: t("q.col1") }; }
  function takenIds() {
    var m = {};
    cur.qs.forEach(function (q) {
      m[q.id] = 1;
      (q.opts || []).concat(q.rows || []).forEach(function (o) { m[o.id] = 1; });
    });
    return m;
  }

  // A new kind keeps the text, the answers where they fit, and required.
  function retype(q, t2) {
    var fresh = E.blank(t2, takenIds(), words());
    var keep = { id: q.id, t: t2, label: q.label, help: q.help, req: q.req, show: q.show };
    if (fresh.opts && q.opts) keep.opts = q.opts;
    if (t2 === "matrix" && q.rows) keep.rows = q.rows;
    if ((t2 === "choice" || t2 === "multi") && q.other) keep.other = 1;
    var n = E.normItem(Object.assign({}, fresh, keep));
    if (t2 === "matrix" && !q.rows) n.rows = fresh.rows;
    if (n.opts && !keep.opts) n.opts = fresh.opts;
    cur.qs[cur.qs.indexOf(q)] = n;
    changed(true);
    focusOpen();
  }

  function typeFields(box, q) {
    if (q.t === "text" || q.t === "para") {
      var row = el("div", "row2");
      row.appendChild(field(t("ed.minL"), numIn(q.minL, function (v) { setOrDrop(q, "minL", toNum(v)); changed(false); })));
      row.appendChild(field(t("ed.maxL"), numIn(q.maxL, function (v) { setOrDrop(q, "maxL", toNum(v)); changed(false); })));
      box.appendChild(row);
    } else if (q.t === "number") {
      var r2 = el("div", "row2");
      r2.appendChild(field(t("ed.min"), numIn(q.min, function (v) { setOrDrop(q, "min", toNum(v)); changed(false); })));
      r2.appendChild(field(t("ed.max"), numIn(q.max, function (v) { setOrDrop(q, "max", toNum(v)); changed(false); })));
      box.appendChild(r2);
      box.appendChild(checkIn(t("ed.int"), q.int, function (on) { q.int = on ? 1 : 0; changed(false); }));
    } else if (q.t === "date") {
      var r3 = el("div", "row2");
      r3.appendChild(field(t("ed.minD"), numIn(q.min, function (v) { setOrDrop(q, "min", v); changed(false); }, { date: 1 })));
      r3.appendChild(field(t("ed.maxD"), numIn(q.max, function (v) { setOrDrop(q, "max", v); changed(false); }, { date: 1 })));
      box.appendChild(r3);
    } else if (q.t === "choice" || q.t === "multi" || q.t === "select") {
      box.appendChild(optList(q, "opts", t("ed.opts"), t("ed.addOpt"), "ed.optN", E.LIM.opts));
      if (q.t !== "select") box.appendChild(checkIn(t("ed.other"), q.other, function (on) { q.other = on ? 1 : 0; changed(true); focusOpen(); }));
      if (q.t === "multi") {
        var r4 = el("div", "row2");
        r4.appendChild(field(t("ed.minC"), numIn(q.minC, function (v) { setOrDrop(q, "minC", toNum(v)); changed(false); })));
        r4.appendChild(field(t("ed.maxC"), numIn(q.maxC, function (v) { setOrDrop(q, "maxC", toNum(v)); changed(false); })));
        box.appendChild(r4);
      }
    } else if (q.t === "scale") {
      var r5 = el("div", "row2");
      r5.appendChild(field(t("ed.from"), selectIn([["0", "0"], ["1", "1"]], String(q.lo), function (v) { q.lo = +v; changed(false); })));
      var his = [];
      for (var h = 2; h <= 10; h++) his.push([String(h), String(h)]);
      r5.appendChild(field(t("ed.to"), selectIn(his, String(q.hi), function (v) { q.hi = +v; changed(false); })));
      box.appendChild(r5);
      var r6 = el("div", "row2");
      r6.appendChild(field(t("ed.loL"), textIn(q.loL, 60, function (v) { q.loL = v; changed(false); })));
      r6.appendChild(field(t("ed.hiL"), textIn(q.hiL, 60, function (v) { q.hiL = v; changed(false); })));
      box.appendChild(r6);
    } else if (q.t === "stars") {
      var st = [];
      for (var s = 3; s <= 10; s++) st.push([String(s), String(s)]);
      box.appendChild(field(t("ed.starsN"), selectIn(st, String(q.hi), function (v) { q.hi = +v; changed(false); })));
    } else if (q.t === "matrix") {
      box.appendChild(optList(q, "rows", t("ed.rows"), t("ed.addRow"), "ed.rowN", E.LIM.rows));
      box.appendChild(optList(q, "opts", t("ed.cols"), t("ed.addCol"), "ed.colN", E.LIM.cols));
      box.appendChild(checkIn(t("ed.multiRow"), q.multi, function (on) { q.multi = on ? 1 : 0; changed(false); }));
    }
  }

  // Answers, rows or columns: a text box each, add and remove.
  function optList(q, key, title, addLabel, nKey, cap) {
    var fs = el("fieldset", "opts");
    fs.appendChild(el("legend", "", title));
    var ul = el("ol", "opt-list");
    q[key].forEach(function (o, j) {
      var li = el("li");
      var inp = textIn(o.label, E.LIM.opt, function (v) { o.label = v; changed(false); });
      inp.setAttribute("aria-label", t(nKey, { n: j + 1 }));
      inp.placeholder = t(nKey, { n: j + 1 });
      inp.addEventListener("keydown", function (ev) {
        if (ev.key === "Enter") { ev.preventDefault(); addOpt(); }
      });
      li.appendChild(inp);
      var rm = iconBtn(ICON.x, t("ed.rmOpt", { x: o.label || t(nKey, { n: j + 1 }) }));
      rm.disabled = q[key].length < 2;
      rm.addEventListener("click", function () { q[key].splice(j, 1); changed(true); focusOpen(); });
      li.appendChild(rm);
      ul.appendChild(li);
    });
    fs.appendChild(ul);
    function addOpt() {
      if (q[key].length >= cap) { toast(t("toast.optCap", { n: cap })); return; }
      q[key].push({ id: E.newId(takenIds()), label: "" });
      changed(true);
      var all = document.querySelectorAll(".item.open fieldset.opts");
      [].forEach.call(all, function (f) {
        if (f.firstChild.textContent === title) {
          var ins = f.querySelectorAll("input");
          if (ins.length) ins[ins.length - 1].focus();
        }
      });
    }
    var add = el("button", "chip small", addLabel);
    add.type = "button";
    add.addEventListener("click", addOpt);
    fs.appendChild(add);
    return fs;
  }

  function move(i, d) {
    var j = i + d;
    if (j < 0 || j >= cur.qs.length) return;
    var a = cur.qs[i];
    cur.qs[i] = cur.qs[j];
    cur.qs[j] = a;
    changed(true);
    var b = document.querySelector(".item.open .actions .icon-btn:" + (d < 0 ? "first-child" : "nth-child(2)"));
    if (b && !b.disabled) b.focus();
  }
  function dupItem(i) {
    if (cur.qs.length >= E.LIM.items) { toast(t("toast.cap", { n: E.LIM.items })); return; }
    var c = E.reid([cur.qs[i]], takenIds())[0];
    (c.opts || []).concat(c.rows || []).forEach(function (o) { o.id = E.newId(takenIds()); });
    cur.qs.splice(i + 1, 0, c);
    openId = c.id;
    changed(true);
    focusOpen();
  }
  function removeItem(i) {
    var gone = cur.qs.splice(i, 1)[0];
    var before = JSON.parse(JSON.stringify(cur.qs));
    before.splice(i, 0, gone);
    openId = "";
    changed(true);
    commit();
    var formId = cur.id;
    toast(t("toast.itemDeleted"), t("btn.undo"), function () {
      if (!cur || cur.id !== formId) openForm(formId);
      if (!cur) return;
      cur.qs = before;
      openId = gone.id;
      changed(true);
      commit();
    });
  }
  function addItem(type) {
    if (!cur) return;
    if (cur.qs.length >= E.LIM.items) { toast(t("toast.cap", { n: E.LIM.items })); return; }
    var q = E.blank(type, takenIds(), words());
    var at = cur.qs.length;
    for (var i = 0; i < cur.qs.length; i++) if (cur.qs[i].id === openId) at = i + 1;
    cur.qs.splice(at, 0, q);
    openId = q.id;
    changed(true);
    focusOpen();
  }

  // ---------- 5. Conditions and jumps ----------
  function opsFor(src) {
    var ops = ["set", "unset"];
    if (src.t === "multi") ops = ["has"].concat(ops);
    else if (["number", "scale", "stars", "date"].indexOf(src.t) >= 0) ops = ["eq", "ne", "gt", "lt"].concat(ops);
    else if (src.t !== "matrix") ops = ["eq", "ne"].concat(ops);
    return ops;
  }
  function choicesOf(src) {
    if (src.t === "yesno") return [["yes", t("f.yes")], ["no", t("f.no")]];
    var list = (src.opts || []).map(function (o, j) { return [o.id, o.label || t("ed.optN", { n: j + 1 })]; });
    if (src.other) list.push([E.OTHER, t("f.other")]);
    return list;
  }

  function showEditor(box, q, i) {
    var earlier = cur.qs.slice(0, i).filter(function (x) { return E.ASKS[x.t]; });
    var fs = el("fieldset", "logic");
    fs.appendChild(el("legend", "", t("show.title")));
    if (!earlier.length) {
      fs.appendChild(el("p", "hint", t("show.none")));
      box.appendChild(fs);
      return;
    }
    var srcChoices = [["", t("show.always")]].concat(earlier.map(function (x) {
      return [x.id, x.label || t("ed.untitled")];
    }));
    var row = el("div", "logic-row");
    var srcSel = selectIn(srcChoices, q.show ? q.show.q : "", function (v) {
      if (!v) delete q.show;
      else {
        var src = earlier.filter(function (x) { return x.id === v; })[0];
        var op = opsFor(src)[0];
        q.show = { q: v, op: op };
        var ch = choicesOf(src);
        if (op === "eq" || op === "has") {
          if (ch.length) q.show.v = ch[0][0];
          else if (src.t === "scale") q.show.v = src.lo;
          else if (src.t === "stars") q.show.v = 1;
          else if (src.t === "number") q.show.v = 0;
          else if (src.t === "date") q.show.v = new Date().toISOString().slice(0, 10);
          else q.show.v = "";
        }
      }
      changed(true);
      focusOpen();
    });
    srcSel.setAttribute("aria-label", t("show.title"));
    row.appendChild(srcSel);
    if (q.show) {
      var src = earlier.filter(function (x) { return x.id === q.show.q; })[0];
      var opSel = selectIn(opsFor(src).map(function (o) { return [o, t("show." + o)]; }), q.show.op, function (v) {
        q.show.op = v;
        if ((v === "set" || v === "unset")) delete q.show.v;
        else if (!Object.prototype.hasOwnProperty.call(q.show, "v")) {
          var ch2 = choicesOf(src);
          q.show.v = ch2.length ? ch2[0][0] : (src.t === "date" ? new Date().toISOString().slice(0, 10) : 0);
        }
        changed(true);
      });
      row.appendChild(opSel);
      if (q.show.op !== "set" && q.show.op !== "unset") {
        var ch = choicesOf(src), vIn;
        if (ch.length) {
          vIn = selectIn(ch, String(q.show.v), function (v) { q.show.v = v; changed(false); });
        } else if (src.t === "date") {
          vIn = numIn(q.show.v, function (v) { if (E.validDay(v)) { q.show.v = v; changed(false); } }, { date: 1 });
        } else if (src.t === "scale" || src.t === "stars") {
          var pts = [];
          for (var n = src.t === "scale" ? src.lo : 1; n <= src.hi; n++) pts.push([String(n), String(n)]);
          vIn = selectIn(pts, String(q.show.v), function (v) { q.show.v = +v; changed(false); });
        } else if (src.t === "number") {
          vIn = numIn(q.show.v, function (v) { var x = toNum(v); if (x !== undefined) { q.show.v = x; changed(false); } });
        } else {
          vIn = textIn(q.show.v, E.LIM.opt, function (v) { q.show.v = v; changed(false); });
        }
        vIn.setAttribute("aria-label", t("show.value"));
        row.appendChild(vIn);
      }
    }
    fs.appendChild(row);
    box.appendChild(fs);
  }

  // Pages after item i, for jumps.
  function pagesAfter(i, nums) {
    return cur.qs.slice(i + 1).filter(function (x) { return x.t === "page"; })
      .map(function (p) { return [p.id, pageName(p, nums)]; });
  }
  function jumpEditor(box, q, i, nums) {
    var isPage = q.t === "page";
    if (!isPage && !(q.t === "choice" || q.t === "select" || q.t === "yesno")) return;
    var later = pagesAfter(i, nums);
    var targets = [["", t("go.next")]].concat(later).concat([["end", t("go.end")]]);
    var fs = el("fieldset", "logic");
    if (isPage) {
      fs.appendChild(el("legend", "", t("go.title")));
      fs.appendChild(selectIn(targets, q.next || "", function (v) { setOrDrop(q, "next", v); changed(false); }));
      box.appendChild(fs);
      return;
    }
    fs.appendChild(el("legend", "", t("go.byAnswer")));
    if (!later.length) {
      fs.appendChild(el("p", "hint", t("go.noPages")));
      box.appendChild(fs);
      return;
    }
    choicesOf(q).forEach(function (c) {
      var row = el("div", "go-row");
      row.appendChild(el("span", "go-ans", c[1]));
      var s = selectIn(targets, (q.go && q.go[c[0]]) || "", function (v) {
        q.go = q.go || {};
        if (v) q.go[c[0]] = v; else delete q.go[c[0]];
        changed(false);
      });
      s.setAttribute("aria-label", c[1]);
      row.appendChild(s);
      fs.appendChild(row);
    });
    fs.appendChild(el("p", "hint", t("go.noteLast")));
    box.appendChild(fs);
  }

  // ---------- 6. Preview + settings ----------
  var preview = null;
  function renderPreview() {
    commit();
    if (preview) preview.destroy();
    preview = R.mount($("preview"), cur, { t: t, preview: true });
  }
  function setTab(name) {
    commit();
    ["edit", "prev", "set"].forEach(function (k) {
      var on = k === name;
      $("tab-" + k).classList.toggle("on", on);
      $("tab-" + k).setAttribute("aria-selected", on ? "true" : "false");
      $("tab-" + k).tabIndex = on ? 0 : -1;
      $("pane-" + k).hidden = !on;
    });
    if (name === "prev") renderPreview();
    else if (preview) { preview.destroy(); preview = null; }
  }

  function setField(k, v) { cur.set[k] = v; changed(false); }

  function dupForm() {
    if (!cur) return;
    commit();
    var now = Date.now();
    var copy = JSON.parse(JSON.stringify(cur));
    copy.id = E.newId(idsOfForms());
    copy.title = t("copyOf", { x: cur.title || t("f.untitled") }).slice(0, E.LIM.title);
    copy.qs = E.reid(cur.qs, {});
    delete copy.x;
    var res = C.put(data, copy, now);
    data = res.data;
    persist();
    openForm(copy.id);
    toast(t("toast.dup"));
  }
  function delForm() {
    if (!cur) return;
    commit();
    var id = cur.id;
    var res = C.remove(data, id, Date.now());
    if (!res.changed) return;
    data = res.data;
    persist();
    closeForm(true);
    toast(t("toast.deleted"), t("btn.undo"), function () {
      data = C.restore(data, res.old, Date.now());
      persist();
      openForm(id);
    });
  }
  function idsOfForms() {
    var m = {};
    (data.forms || []).forEach(function (r) { m[r.id] = 1; });
    return m;
  }

  // ---------- 7. Dialogs ----------
  function openDlg(d) {
    if (typeof d.showModal === "function") d.showModal(); else d.setAttribute("open", "");
  }
  function closeDlg(d) {
    if (typeof d.close === "function") d.close(); else d.removeAttribute("open");
  }

  function tplOpts(keys) { return keys.map(function (k, j) { return { id: "o" + (j + 1), label: t(k) }; }); }
  // Templates: built in the app's language from the string table.
  var TEMPLATES = {
    contact: function () {
      return { title: t("tpl.contact"), desc: t("q.contactDesc"), qs: [
        { id: "name", t: "text", label: t("q.name"), req: 1 },
        { id: "email", t: "email", label: t("q.email"), req: 1 },
        { id: "phone", t: "phone", label: t("q.phone") },
        { id: "msg", t: "para", label: t("q.message"), req: 1 }
      ] };
    },
    event: function () {
      return { title: t("tpl.event"), desc: t("q.eventDesc"), set: { prog: 1 }, qs: [
        { id: "name", t: "text", label: t("q.name"), req: 1 },
        { id: "email", t: "email", label: t("q.email"), req: 1 },
        { id: "come", t: "yesno", label: t("q.attend"), req: 1, go: { no: "end" } },
        { id: "p2", t: "page", label: t("q.details") },
        { id: "guests", t: "number", label: t("q.guests"), int: 1, min: 1, max: 20, req: 1 },
        { id: "diet", t: "multi", label: t("q.diet"), opts: tplOpts(["q.diet1", "q.diet2", "q.diet3"]), other: 1 },
        { id: "notes", t: "para", label: t("q.comments") }
      ] };
    },
    feedback: function () {
      return { title: t("tpl.feedback"), qs: [
        { id: "stars", t: "stars", label: t("q.stars"), hi: 5, req: 1 },
        { id: "liked", t: "para", label: t("q.liked") },
        { id: "better", t: "para", label: t("q.better") },
        { id: "nps", t: "scale", label: t("q.recommend"), lo: 0, hi: 10, loL: t("q.notLikely"), hiL: t("q.veryLikely") }
      ] };
    },
    order: function () {
      return { title: t("tpl.order"), qs: [
        { id: "name", t: "text", label: t("q.name"), req: 1 },
        { id: "email", t: "email", label: t("q.email"), req: 1 },
        { id: "phone", t: "phone", label: t("q.phone") },
        { id: "prod", t: "select", label: t("q.product"), opts: tplOpts(["q.prod1", "q.prod2", "q.prod3"]), req: 1 },
        { id: "qty", t: "number", label: t("q.qty"), int: 1, min: 1, req: 1 },
        { id: "how", t: "choice", label: t("q.how"), opts: tplOpts(["q.pickup", "q.delivery"]), req: 1 },
        { id: "addr", t: "para", label: t("q.address"), req: 1, show: { q: "how", op: "eq", v: "o2" } },
        { id: "notes", t: "para", label: t("q.notes") }
      ] };
    },
    survey: function () {
      return { title: t("tpl.survey"), qs: [
        { id: "rate", t: "matrix", label: t("q.rate"), req: 1,
          rows: tplOpts(["q.quality", "q.price", "q.service"]), opts: tplOpts(["q.poor", "q.fair", "q.good", "q.great"]) },
        { id: "nps", t: "scale", label: t("q.recommend"), lo: 0, hi: 10, loL: t("q.notLikely"), hiL: t("q.veryLikely") },
        { id: "age", t: "select", label: t("q.age"), opts: tplOpts(["q.age1", "q.age2", "q.age3", "q.age4"]) },
        { id: "notes", t: "para", label: t("q.comments") }
      ] };
    },
    course: function () {
      return { title: t("tpl.course"), qs: [
        { id: "name", t: "text", label: t("q.name"), req: 1 },
        { id: "email", t: "email", label: t("q.email"), req: 1 },
        { id: "phone", t: "phone", label: t("q.phone") },
        { id: "course", t: "choice", label: t("q.course"), opts: tplOpts(["q.course1", "q.course2"]), req: 1 },
        { id: "level", t: "choice", label: t("q.level"), opts: tplOpts(["q.lvl1", "q.lvl2", "q.lvl3"]) },
        { id: "days", t: "multi", label: t("q.days"), opts: tplOpts(["q.mon", "q.tue", "q.wed", "q.thu", "q.fri", "q.sat"]), minC: 1 },
        { id: "ask", t: "para", label: t("q.questions") }
      ] };
    }
  };

  function newForm(kind) {
    commit();
    var base = kind && TEMPLATES[kind] ? TEMPLATES[kind]() : { title: "", qs: [] };
    base.id = E.newId(idsOfForms());
    // Template ids are short words; give the items real random ids.
    base.qs = E.reid(base.qs || [], {});
    base.set = base.set || {};
    var res = C.put(data, base, Date.now());
    data = res.data;
    persist();
    openForm(base.id);
    if (!kind) { var ti = $("f-title"); if (ti) ti.focus(); }
  }

  function buildNewDialog() {
    var grid = $("tpl-grid");
    grid.textContent = "";
    [["", "new.blank", "new.blankText"], ["contact", "tpl.contact", "tpl.contactText"],
     ["event", "tpl.event", "tpl.eventText"], ["feedback", "tpl.feedback", "tpl.feedbackText"],
     ["order", "tpl.order", "tpl.orderText"], ["survey", "tpl.survey", "tpl.surveyText"],
     ["course", "tpl.course", "tpl.courseText"]].forEach(function (x) {
      var b = el("button", "tpl");
      b.type = "button";
      b.appendChild(el("span", "tpl-name", t(x[1])));
      b.appendChild(el("span", "tpl-text", t(x[2])));
      b.addEventListener("click", function () { closeDlg($("new-dlg")); newForm(x[0]); });
      grid.appendChild(b);
    });
  }
  function buildTypeDialog() {
    var grid = $("type-grid");
    grid.textContent = "";
    E.TYPES.forEach(function (k) {
      var b = el("button", "type", t("type." + k));
      b.type = "button";
      b.addEventListener("click", function () { closeDlg($("type-dlg")); addItem(k); });
      grid.appendChild(b);
    });
  }

  // ---------- 8. Toast, palette, wiring, boot ----------
  var toastTimer = 0, toastAct = null;
  function toast(text, action, fn) {
    clearTimeout(toastTimer);
    $("toast-text").textContent = text;
    var b = $("toast-btn");
    b.hidden = !action;
    b.textContent = action || "";
    toastAct = fn || null;
    $("toast").classList.add("show");
    $("live").textContent = text;
    toastTimer = setTimeout(function () { $("toast").classList.remove("show"); toastAct = null; }, action ? 8000 : 3000);
  }

  var PAL_VARS = ["--bg", "--bg-desktop", "--bar-bg", "--text", "--text-dim",
                  "--accent", "--accent-hover", "--accent-soft", "--accent-ink",
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

  function applyI18n() {
    document.documentElement.lang = LANG;
    [].forEach.call(document.querySelectorAll("[data-i18n]"), function (n) { n.textContent = t(n.getAttribute("data-i18n")); });
    [].forEach.call(document.querySelectorAll("[data-i18n-ph]"), function (n) { n.placeholder = t(n.getAttribute("data-i18n-ph")); });
    document.title = t("app") + " · orOS";
    var b = $("back-btn");
    b.innerHTML = ICON.back;
    b.setAttribute("aria-label", t("btn.back"));
    b.title = t("btn.back");
  }

  function wire() {
    $("new-btn").addEventListener("click", function () { openDlg($("new-dlg")); });
    $("back-btn").addEventListener("click", function () { closeForm(); });
    $("search").addEventListener("input", renderList);
    $("add-btn").addEventListener("click", function () { openDlg($("type-dlg")); });
    ["edit", "prev", "set"].forEach(function (k) {
      $("tab-" + k).addEventListener("click", function () { setTab(k); });
    });
    $("tabs").addEventListener("keydown", function (ev) {
      if (ev.key !== "ArrowRight" && ev.key !== "ArrowLeft") return;
      var order = ["edit", "prev", "set"], at = 0;
      order.forEach(function (k, j) { if ($("tab-" + k).classList.contains("on")) at = j; });
      var nx = order[(at + (ev.key === "ArrowRight" ? 1 : order.length - 1)) % order.length];
      setTab(nx);
      $("tab-" + nx).focus();
    });
    $("f-title").addEventListener("input", function () { if (cur) { cur.title = $("f-title").value; changed(false); } });
    $("f-desc").addEventListener("input", function () { if (cur) { cur.desc = $("f-desc").value; changed(false); } });
    $("s-thanks").addEventListener("input", function () { if (cur) setField("thanks", $("s-thanks").value); });
    $("s-note").addEventListener("input", function () { if (cur) setField("note", $("s-note").value); });
    $("s-prog").addEventListener("change", function () { if (cur) setField("prog", $("s-prog").checked ? 1 : 0); });
    $("dup-btn").addEventListener("click", dupForm);
    $("del-btn").addEventListener("click", delForm);
    $("toast-btn").addEventListener("click", function () {
      var fn = toastAct;
      toastAct = null;
      $("toast").classList.remove("show");
      if (fn) fn();
    });
    [].forEach.call(document.querySelectorAll("dialog [data-close]"), function (b) {
      b.addEventListener("click", function () { closeDlg(b.closest("dialog")); });
    });
    [].forEach.call(document.querySelectorAll("dialog"), function (d) {
      d.addEventListener("click", function (ev) { if (ev.target === d) closeDlg(d); });
    });
    document.addEventListener("keydown", function (ev) {
      if (ev.key === "Escape" && cur && !document.querySelector("dialog[open]")) {
        if (openId) { openId = ""; commit(); renderItems(); }
      }
    });
    window.addEventListener("pagehide", commit);
    document.addEventListener("visibilitychange", function () { if (document.hidden) commit(); });
  }

  // Deep link: { form: id } opens a form.
  function openTarget(tg) {
    if (tg && typeof tg.form === "string") openForm(tg.form, tg.tab);
  }

  function boot() {
    load();
    applyI18n();
    buildNewDialog();
    buildTypeDialog();
    wire();
    registerSync();
    inheritPalette();
    watchPalette();
    renderList();
    window.__orosOpenAt = openTarget;
    try {
      if (window.parent && window.parent !== window && typeof window.parent.__orosTakeTarget === "function") {
        var pending = window.parent.__orosTakeTarget("forms");
        if (pending) openTarget(pending);
      }
    } catch (e) {}
  }

  boot();
})();
