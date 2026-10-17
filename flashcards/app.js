// ============================================================
// orOS Flashcards — the app inside the shell frame
// Decks + day start: slice "flashcards" (localStorage oros-flashcards-data).
// Notes and answers: files on the orOS disk that only this device
// writes (core.js header). Schedules: replayed through FSRS (fsrs.js).
// Boot order (OROS_BIBLE.md Part VI "Boot sequence"):
//   load → applyI18n → wire → registerSync → inheritPalette →
//   watchPalette → render → read the disk → take a pending deep link.
// Rules: R8 (shell APIs from window.parent, guarded, so ?standalone
// works), 5-argument registerSlice, a pulled slice never marks dirty
// (R6), user text only through textContent.
// ============================================================
(function () {
  "use strict";

  var SCRIPT_V = "";
  (function () {
    var m = (document.currentScript && document.currentScript.src || "").match(/[?&]v=([^&#]+)/);
    SCRIPT_V = m ? m[1] : "";
    console.log("flashcards/app.js v" + (SCRIPT_V || "?") + " boot");
  })();

  var APP_ID = "flashcards";
  var STORAGE_KEY = "oros-flashcards-data";
  var DEV_KEY = "oros-flashcards-dev";        // device-local: this device's file id, never synced
  var PREFS_KEY = "oros-flashcards-prefs";    // device-local: last deck, last card kind
  var C = window.FlashcardsCore, F = window.FlashcardsFsrs, M = window.FlashcardsMedia;

  // ---------- 1. Language (every string in English and Greek) ----------
  var STR = {
    en: {
      "app.name": "Flashcards",
      "btn.back": "Back", "btn.newDeck": "New deck", "btn.addCard": "Add card", "btn.settings": "Settings",
      "btn.study": "Study", "btn.deckSettings": "Deck settings", "btn.more": "Show more", "btn.undo": "Undo",
      "btn.edit": "Edit", "btn.backDecks": "Back to decks", "btn.show": "Show answer", "btn.delete": "Delete",
      "btn.cancel": "Cancel", "btn.save": "Save", "btn.saveNext": "Save and add another", "btn.create": "Create",
      "btn.ok": "OK", "btn.cloze": "Make a gap", "btn.clozeSame": "Gap with the same number",
      "g.1": "Again", "g.2": "Hard", "g.3": "Good", "g.4": "Easy",
      "nofs": "Flashcards keeps cards on the orOS disk. Open it inside orOS to save them.",
      "home.emptyTitle": "No decks yet",
      "home.empty": "A deck holds cards on one subject. Make your first deck, then add cards to it.",
      "home.unsorted": "Cards without a deck",
      "home.cards": "{n} cards", "home.card1": "1 card",
      "filter.label": "Find a card", "filter.ph": "Find a card…",
      "deck.empty": "No cards in this deck yet. Press Add card.",
      "deck.none": "No card matches.",
      "deck.sub": "{n} cards in all, {d} decks inside",
      "deck.subOne": "{n} cards in all",
      "cnt.new": "New", "cnt.learn": "Learning", "cnt.due": "To review",
      "st.new": "New", "st.learn": "Learning", "st.due": "Due {d}", "st.today": "Due today",
      "kind.basic": "Basic", "kind.rev": "Basic and reversed", "kind.cloze": "Fill in the gap",
      "study.doneTitle": "Done for now",
      "study.done": "No more cards to study in this deck today.",
      "study.later": "More cards come back at {t}. Leave the app open or come back then.",
      "study.empty": "This deck has nothing to study right now.",
      "dlg.newDeck": "New deck", "dlg.deck": "Deck settings", "dlg.newCard": "Add card", "dlg.editCard": "Edit card",
      "dlg.settings": "Flashcards settings",
      "f.name": "Name", "f.parent": "Inside deck", "f.top": "(top level)",
      "f.nd": "New cards per day", "f.rd": "Reviews per day", "f.ret": "How much to remember",
      "f.retHint": "The scheduler shows each card just before you would forget it. A higher aim means more reviews.",
      "f.deck": "Deck", "f.kind": "Card type", "f.front": "Front", "f.back": "Back", "f.text": "Text",
      "f.extra": "Extra (shown with the answer)", "f.tags": "Tags (separated by spaces)",
      "f.clozeHint": "Select words and press Make a gap. Each gap number becomes its own card.",
      "f.dayStart": "A new study day starts at",
      "f.where": "Your decks and settings sync with orOS sync. Cards and your answers are files in the orOS disk folder Flashcards, so they also follow you to your other devices, and nothing gets lost when two devices study offline.",
      "need.name": "Give the deck a name.",
      "need.front": "Write something on the front.",
      "need.cloze": "Make at least one gap: select words and press Make a gap.",
      "need.deck": "Make a deck first.",
      "saved": "Card saved", "deleted": "Deleted", "undone": "Answer undone",
      "conf.note": "Delete this card? Its answers are kept but no longer counted.",
      "conf.deck": "Delete the deck “{n}” with its {c} cards and every deck inside it?",
      "conf.deckEmpty": "Delete the deck “{n}”?",
      "full": "This device is out of storage space. The change was not saved.",
      "diskFail": "The card could not be written to the orOS disk.",
      "u.m": "{n} min", "u.h": "{n} h", "u.d": "{n} d", "u.mo": "{n} mo", "u.y": "{n} y",
      "ret.pct": "{n}%",
      "btn.browse": "Browse", "btn.moreActions": "More actions", "btn.bury": "Hide until tomorrow",
      "btn.suspend": "Suspend card", "btn.speak": "Read aloud",
      "btn.bold": "Bold", "btn.italic": "Italic", "btn.list": "List", "btn.numbers": "Numbered list",
      "btn.image": "Picture", "btn.audio": "Sound file", "btn.record": "Record", "btn.stop": "Stop {t}",
      "btn.remove": "Remove", "btn.apply": "Apply",
      "dlg.browse": "All cards",
      "br.tag": "Tag", "br.state": "State", "br.allDecks": "All decks", "br.allTags": "All tags", "br.allStates": "Any state",
      "br.move": "Move", "br.tagAdd": "Add tag", "br.tagDel": "Remove tag", "br.suspend": "Suspend", "br.resume": "Resume",
      "br.count": "{n} cards", "br.sel": "{s} of {n} selected", "br.none": "No card matches these filters.",
      "br.empty": "No cards yet. Press Add card.",
      "br.moveTo": "Move the notes of {n} cards to", "br.tagName": "Tag",
      "br.confDel": "Delete {n} notes ({c} cards)? Their answers are kept but no longer counted.",
      "br.done": "Done: {n} cards",
      "s.sus": "Suspended", "s.bury": "Hidden until tomorrow", "s.new": "New", "s.learn": "Learning",
      "s.due": "Due today", "s.rev": "Review later",
      "buried": "Hidden until tomorrow", "suspended": "Card suspended. Find it again in Browse.",
      "undoneAct": "Undone",
      "f.media": "Pictures and sounds", "f.vq": "Voice for the front", "f.va": "Voice for the back",
      "f.vAuto": "Automatic", "f.vNone": "This device has no voices installed for Read aloud. Voices come with the operating system.",
      "f.autoplay": "Play card sounds by themselves",
      "f.fmtHint": "**bold**, *italic*, lines starting with - or 1. become lists.",
      "m.missing": "Not on this device yet",
      "m.badtype": "Pictures (JPEG, PNG, WebP, GIF) and sounds (MP3, OGG, Opus, M4A, WAV, WebM) only.",
      "m.toobig": "The file is too big (sounds up to 10 MB).",
      "m.badimage": "This picture could not be read.",
      "m.full": "At most 6 pictures and sounds per field.",
      "m.nomic": "The microphone is not available. Allow it in the browser to record.",
      "m.saveFail": "A picture or sound could not be written to the orOS disk.",
      "m.recMax": "Recording stopped at 5 minutes.",
      "v.none": "No installed voice reads this language on this device.",
      "btn.import": "Import", "btn.chooseFile": "Choose a file", "btn.importNow": "Import",
      "dlg.import": "Import cards",
      "im.intro": "Anki decks (.apkg, .colpkg) or a text file with one card per line (CSV, TSV, TXT, also from Quizlet).",
      "im.reading": "Reading the file…",
      "im.media": "Pictures and sounds: {i} of {n}",
      "im.saving": "Saving the cards…",
      "im.sum": "{n} notes ({c} cards). Decks: {d}.",
      "im.hist": "{r} answers from your Anki study history.",
      "im.mediaSum": "{m} pictures and sounds.",
      "im.skip": "{s} notes are already here and stay as they are.",
      "im.histBox": "Bring my study history, so each card's schedule continues where Anki left it",
      "im.nothing": "Nothing new to import: every card in this file is already here.",
      "im.done": "Imported {c} cards.",
      "im.mediaFail": "{m} pictures or sounds could not be read and were left out.",
      "im.bad": "This file could not be read as an Anki deck.",
      "im.badText": "No cards were found in this file.",
      "im.toobig": "The file is too big (up to 300 MB).",
      "im.tooMany": "This file has more cards than Flashcards can take at once ({n} notes at most).",
      "im.colFront": "Front column", "im.colBack": "Back column", "im.colTags": "Tags column", "im.none": "(none)",
      "im.header": "The first line holds column names", "im.deck": "Into deck", "im.newDeck": "New deck “{n}”",
      "im.col": "Column {n}", "im.preview": "First lines of the file:",
      "im.dupText": "{s} cards are already here and are left out."
    },
    el: {
      "app.name": "Κάρτες μελέτης",
      "btn.back": "Πίσω", "btn.newDeck": "Νέα τράπουλα", "btn.addCard": "Νέα κάρτα", "btn.settings": "Ρυθμίσεις",
      "btn.study": "Μελέτη", "btn.deckSettings": "Ρυθμίσεις τράπουλας", "btn.more": "Περισσότερες", "btn.undo": "Αναίρεση",
      "btn.edit": "Επεξεργασία", "btn.backDecks": "Πίσω στις τράπουλες", "btn.show": "Δείξε την απάντηση", "btn.delete": "Διαγραφή",
      "btn.cancel": "Άκυρο", "btn.save": "Αποθήκευση", "btn.saveNext": "Αποθήκευση και επόμενη", "btn.create": "Δημιουργία",
      "btn.ok": "Εντάξει", "btn.cloze": "Κάνε κενό", "btn.clozeSame": "Κενό με τον ίδιο αριθμό",
      "g.1": "Ξανά", "g.2": "Δύσκολη", "g.3": "Καλή", "g.4": "Εύκολη",
      "nofs": "Οι κάρτες αποθηκεύονται στον δίσκο του orOS. Άνοιξε την εφαρμογή μέσα από το orOS για να αποθηκευτούν.",
      "home.emptyTitle": "Δεν υπάρχουν τράπουλες ακόμα",
      "home.empty": "Μια τράπουλα κρατά κάρτες για ένα θέμα. Φτιάξε την πρώτη σου τράπουλα και πρόσθεσε κάρτες σε αυτήν.",
      "home.unsorted": "Κάρτες χωρίς τράπουλα",
      "home.cards": "{n} κάρτες", "home.card1": "1 κάρτα",
      "filter.label": "Βρες μια κάρτα", "filter.ph": "Βρες μια κάρτα…",
      "deck.empty": "Η τράπουλα δεν έχει κάρτες ακόμα. Πάτησε Νέα κάρτα.",
      "deck.none": "Καμία κάρτα δεν ταιριάζει.",
      "deck.sub": "{n} κάρτες συνολικά, {d} τράπουλες μέσα",
      "deck.subOne": "{n} κάρτες συνολικά",
      "cnt.new": "Νέες", "cnt.learn": "Σε εκμάθηση", "cnt.due": "Για επανάληψη",
      "st.new": "Νέα", "st.learn": "Σε εκμάθηση", "st.due": "Επανάληψη {d}", "st.today": "Επανάληψη σήμερα",
      "kind.basic": "Απλή", "kind.rev": "Απλή και αντίστροφη", "kind.cloze": "Συμπλήρωσε το κενό",
      "study.doneTitle": "Τελείωσες για τώρα",
      "study.done": "Δεν έχει άλλες κάρτες για μελέτη σε αυτή την τράπουλα σήμερα.",
      "study.later": "Κι άλλες κάρτες επιστρέφουν στις {t}. Άφησε την εφαρμογή ανοιχτή ή γύρνα τότε.",
      "study.empty": "Η τράπουλα δεν έχει τίποτα για μελέτη αυτή τη στιγμή.",
      "dlg.newDeck": "Νέα τράπουλα", "dlg.deck": "Ρυθμίσεις τράπουλας", "dlg.newCard": "Νέα κάρτα", "dlg.editCard": "Επεξεργασία κάρτας",
      "dlg.settings": "Ρυθμίσεις: Κάρτες μελέτης",
      "f.name": "Όνομα", "f.parent": "Μέσα στην τράπουλα", "f.top": "(στο πρώτο επίπεδο)",
      "f.nd": "Νέες κάρτες τη μέρα", "f.rd": "Επαναλήψεις τη μέρα", "f.ret": "Πόσο να θυμάσαι",
      "f.retHint": "Ο προγραμματισμός δείχνει κάθε κάρτα λίγο πριν την ξεχάσεις. Υψηλότερος στόχος σημαίνει περισσότερες επαναλήψεις.",
      "f.deck": "Τράπουλα", "f.kind": "Τύπος κάρτας", "f.front": "Μπροστά", "f.back": "Πίσω", "f.text": "Κείμενο",
      "f.extra": "Επιπλέον (φαίνεται με την απάντηση)", "f.tags": "Ετικέτες (χωρισμένες με κενά)",
      "f.clozeHint": "Επίλεξε λέξεις και πάτησε Κάνε κενό. Κάθε αριθμός κενού γίνεται ξεχωριστή κάρτα.",
      "f.dayStart": "Η νέα μέρα μελέτης ξεκινά στις",
      "f.where": "Οι τράπουλες και οι ρυθμίσεις συγχρονίζονται με το sync του orOS. Οι κάρτες και οι απαντήσεις σου είναι αρχεία στον φάκελο Flashcards του δίσκου του orOS, οπότε σε ακολουθούν κι αυτές στις άλλες συσκευές σου και δεν χάνεται τίποτα όταν δύο συσκευές μελετούν offline.",
      "need.name": "Δώσε όνομα στην τράπουλα.",
      "need.front": "Γράψε κάτι στο μπροστά μέρος.",
      "need.cloze": "Φτιάξε τουλάχιστον ένα κενό: επίλεξε λέξεις και πάτησε Κάνε κενό.",
      "need.deck": "Φτιάξε πρώτα μια τράπουλα.",
      "saved": "Η κάρτα αποθηκεύτηκε", "deleted": "Διαγράφηκε", "undone": "Η απάντηση αναιρέθηκε",
      "conf.note": "Να διαγραφεί αυτή η κάρτα; Οι απαντήσεις της μένουν αλλά δεν μετράνε πια.",
      "conf.deck": "Να διαγραφεί η τράπουλα «{n}» με τις {c} κάρτες της και όλες τις τράπουλες μέσα της;",
      "conf.deckEmpty": "Να διαγραφεί η τράπουλα «{n}»;",
      "full": "Ο χώρος αποθήκευσης της συσκευής γέμισε. Η αλλαγή δεν αποθηκεύτηκε.",
      "diskFail": "Η κάρτα δεν γράφτηκε στον δίσκο του orOS.",
      "u.m": "{n} λεπ.", "u.h": "{n} ώρ.", "u.d": "{n} ημ.", "u.mo": "{n} μήν.", "u.y": "{n} έτ.",
      "ret.pct": "{n}%",
      "btn.browse": "Όλες οι κάρτες", "btn.moreActions": "Περισσότερες ενέργειες", "btn.bury": "Κρύψ' την ως αύριο",
      "btn.suspend": "Αναστολή κάρτας", "btn.speak": "Ανάγνωση",
      "btn.bold": "Έντονα", "btn.italic": "Πλάγια", "btn.list": "Λίστα", "btn.numbers": "Αριθμημένη λίστα",
      "btn.image": "Εικόνα", "btn.audio": "Αρχείο ήχου", "btn.record": "Ηχογράφηση", "btn.stop": "Τέλος {t}",
      "btn.remove": "Αφαίρεση", "btn.apply": "Εφαρμογή",
      "dlg.browse": "Όλες οι κάρτες",
      "br.tag": "Ετικέτα", "br.state": "Κατάσταση", "br.allDecks": "Όλες οι τράπουλες", "br.allTags": "Όλες οι ετικέτες", "br.allStates": "Κάθε κατάσταση",
      "br.move": "Μετακίνηση", "br.tagAdd": "Πρόσθεσε ετικέτα", "br.tagDel": "Βγάλε ετικέτα", "br.suspend": "Αναστολή", "br.resume": "Επαναφορά",
      "br.count": "{n} κάρτες", "br.sel": "{s} από {n} επιλεγμένες", "br.none": "Καμία κάρτα δεν ταιριάζει σε αυτά τα φίλτρα.",
      "br.empty": "Δεν υπάρχουν κάρτες ακόμα. Πάτησε Νέα κάρτα.",
      "br.moveTo": "Μετακίνηση των σημειώσεων {n} καρτών στην τράπουλα", "br.tagName": "Ετικέτα",
      "br.confDel": "Να διαγραφούν {n} σημειώσεις ({c} κάρτες); Οι απαντήσεις τους μένουν αλλά δεν μετράνε πια.",
      "br.done": "Έγινε: {n} κάρτες",
      "s.sus": "Σε αναστολή", "s.bury": "Κρυμμένη ως αύριο", "s.new": "Νέα", "s.learn": "Σε εκμάθηση",
      "s.due": "Επανάληψη σήμερα", "s.rev": "Επανάληψη αργότερα",
      "buried": "Κρυμμένη ως αύριο", "suspended": "Η κάρτα μπήκε σε αναστολή. Τη βρίσκεις ξανά στο Όλες οι κάρτες.",
      "undoneAct": "Αναιρέθηκε",
      "f.media": "Εικόνες και ήχοι", "f.vq": "Φωνή για το μπροστά μέρος", "f.va": "Φωνή για το πίσω μέρος",
      "f.vAuto": "Αυτόματα", "f.vNone": "Η συσκευή δεν έχει εγκατεστημένες φωνές για ανάγνωση. Οι φωνές έρχονται με το λειτουργικό σύστημα.",
      "f.autoplay": "Οι ήχοι της κάρτας παίζουν μόνοι τους",
      "f.fmtHint": "**έντονα**, *πλάγια*, γραμμές που ξεκινούν με - ή 1. γίνονται λίστες.",
      "m.missing": "Δεν έχει φτάσει ακόμα σε αυτή τη συσκευή",
      "m.badtype": "Μόνο εικόνες (JPEG, PNG, WebP, GIF) και ήχοι (MP3, OGG, Opus, M4A, WAV, WebM).",
      "m.toobig": "Το αρχείο είναι πολύ μεγάλο (ήχοι ως 10 MB).",
      "m.badimage": "Η εικόνα δεν διαβάστηκε.",
      "m.full": "Το πολύ 6 εικόνες και ήχοι ανά πεδίο.",
      "m.nomic": "Το μικρόφωνο δεν είναι διαθέσιμο. Επίτρεψέ το στον browser για να ηχογραφήσεις.",
      "m.saveFail": "Μια εικόνα ή ένας ήχος δεν γράφτηκε στον δίσκο του orOS.",
      "m.recMax": "Η ηχογράφηση σταμάτησε στα 5 λεπτά.",
      "v.none": "Καμία εγκατεστημένη φωνή δεν διαβάζει αυτή τη γλώσσα σε αυτή τη συσκευή.",
      "btn.import": "Εισαγωγή", "btn.chooseFile": "Διάλεξε αρχείο", "btn.importNow": "Εισαγωγή",
      "dlg.import": "Εισαγωγή καρτών",
      "im.intro": "Τράπουλες Anki (.apkg, .colpkg) ή αρχείο κειμένου με μία κάρτα σε κάθε γραμμή (CSV, TSV, TXT, και από το Quizlet).",
      "im.reading": "Διαβάζω το αρχείο…",
      "im.media": "Εικόνες και ήχοι: {i} από {n}",
      "im.saving": "Αποθηκεύω τις κάρτες…",
      "im.sum": "{n} σημειώσεις ({c} κάρτες). Τράπουλες: {d}.",
      "im.hist": "{r} απαντήσεις από το ιστορικό μελέτης σου στο Anki.",
      "im.mediaSum": "{m} εικόνες και ήχοι.",
      "im.skip": "{s} σημειώσεις υπάρχουν ήδη και μένουν όπως είναι.",
      "im.histBox": "Φέρε και το ιστορικό μελέτης, ώστε κάθε κάρτα να συνεχίσει από εκεί που την άφησε το Anki",
      "im.nothing": "Τίποτα καινούργιο: όλες οι κάρτες του αρχείου υπάρχουν ήδη.",
      "im.done": "Μπήκαν {c} κάρτες.",
      "im.mediaFail": "{m} εικόνες ή ήχοι δεν διαβάστηκαν και έμειναν έξω.",
      "im.bad": "Το αρχείο δεν διαβάστηκε ως τράπουλα Anki.",
      "im.badText": "Δεν βρέθηκαν κάρτες σε αυτό το αρχείο.",
      "im.toobig": "Το αρχείο είναι πολύ μεγάλο (ως 300 MB).",
      "im.tooMany": "Το αρχείο έχει περισσότερες κάρτες από όσες χωράνε με μια φορά (το πολύ {n} σημειώσεις).",
      "im.colFront": "Στήλη για το μπροστά", "im.colBack": "Στήλη για το πίσω", "im.colTags": "Στήλη για τις ετικέτες", "im.none": "(καμία)",
      "im.header": "Η πρώτη γραμμή έχει τα ονόματα των στηλών", "im.deck": "Στην τράπουλα", "im.newDeck": "Νέα τράπουλα «{n}»",
      "im.col": "Στήλη {n}", "im.preview": "Οι πρώτες γραμμές του αρχείου:",
      "im.dupText": "{s} κάρτες υπάρχουν ήδη και έμειναν έξω."
    }
  };

  function appLang() {
    if (window.orosI18n) return window.orosI18n.lang();
    try {
      var l = localStorage.getItem("oros-lang") || (window.parent && window.parent.orosLang) || "en";
      return l === "el" ? "el" : "en";
    } catch (e) { return "en"; }
  }
  var LANG = appLang();
  if (window.orosI18n) window.orosI18n.table(STR, APP_ID, LANG);   // other languages: translators' packs
  function locale() { return window.orosI18n ? window.orosI18n.locale(LANG) : (LANG === "el" ? "el-GR" : "en-GB"); }
  function t(k, vars) {
    var s = (STR[LANG] || STR.en)[k] || STR.en[k] || k;
    if (vars) Object.keys(vars).forEach(function (v) { s = s.split("{" + v + "}").join(String(vars[v])); });
    return s;
  }
  function applyI18n() {
    document.documentElement.lang = LANG;
    [].forEach.call(document.querySelectorAll("[data-i18n]"), function (n) { n.textContent = t(n.getAttribute("data-i18n")); });
    [].forEach.call(document.querySelectorAll("[data-i18n-ph]"), function (n) { n.placeholder = t(n.getAttribute("data-i18n-ph")); });
    [].forEach.call(document.querySelectorAll("[data-i18n-label]"), function (n) {
      n.setAttribute("aria-label", t(n.getAttribute("data-i18n-label")));
      n.title = t(n.getAttribute("data-i18n-label"));
    });
    document.title = t("app.name") + " · orOS";
  }
  function ivlText(ms) {
    var p = C.ivlParts(ms);
    return t("u." + p.u, { n: p.n.toLocaleString(locale()) });
  }

  // ---------- 2. Data ----------
  var slice = C.empty();          // decks + settings (synced slice)
  var notes = {};                 // id → newest note version (all devices)
  var reviews = [];               // every answer, sorted (all devices)
  var sched = {};                 // card key → { note, ord, deck, card, first, revs }
  var dev = "";                   // this device's file id
  var mine = { notes: null, reviews: null };   // { path, items } of this device's current files
  var disk = false;               // the orOS disk is reachable
  var writeChain = Promise.resolve();

  function syncApi() {
    try { return (window.parent && window.parent.orosSync) || window.orosSync || null; }
    catch (e) { return window.orosSync || null; }
  }
  function fsApi() {
    try { return (window.parent && window.parent.orosFS) || null; } catch (e) { return null; }
  }
  function readLS(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function writeLS(k, v) { try { localStorage.setItem(k, v); return true; } catch (e) { return false; } }

  function prefs() { try { return JSON.parse(readLS(PREFS_KEY) || "{}") || {}; } catch (e) { return {}; } }
  function setPref(k, v) { var p = prefs(); p[k] = v; writeLS(PREFS_KEY, JSON.stringify(p)); }

  function deviceId() {
    var id = readLS(DEV_KEY);
    if (!id || !C.DEV_RE.test(id)) { id = C.newDevId(); writeLS(DEV_KEY, id); }
    return id;
  }

  function load() {
    try { slice = C.normalize(JSON.parse(readLS(STORAGE_KEY) || "null")); }
    catch (e) { slice = C.empty(); }
    dev = deviceId();
  }
  function persist() {
    if (writeLS(STORAGE_KEY, C.serialize(slice))) return true;
    toast(t("full"));
    return false;
  }
  // Every deck edit by the user ends here: write, then tell sync.
  function saveSlice(next) {
    slice = next;
    if (!persist()) return;
    var api = syncApi();
    if (api && typeof api.markDirty === "function") api.markDirty();
    rebuild();
  }
  function sliceGet() { return C.normalize(slice); }
  function sliceSet(incoming) {
    var merged = C.merge(slice, incoming);
    if (C.serialize(merged) === C.serialize(slice)) return;
    slice = merged;
    persist();
    rebuild();
  }
  function registerSync() {
    var api = syncApi();
    if (!api || typeof api.registerSlice !== "function") return;
    try { api.registerSlice(APP_ID, sliceGet, sliceSet, STORAGE_KEY, C.merge); }   // 5 args, always
    catch (e) { /* engine busy: the next boot registers again */ }
  }

  // ---------- 3. The disk: read every device's files, write our own ----------
  function listDir(Fs, dir) {
    return Fs.ls(dir).catch(function (e) {
      if (e && e.code === "ENOENT") return [];
      throw e;
    }).then(function (list) {
      return (list || []).filter(function (e) { return e && !e.dir && C.parseFileName(e.name); }).map(function (e) { return e.name; });
    });
  }
  function readAll(Fs, dir, kind) {
    return listDir(Fs, dir).then(function (names) {
      return Promise.all(names.map(function (name) {
        return Fs.readText(dir + "/" + name).then(function (txt) {
          return { name: name, items: C.readFile(txt, kind) || [] };
        }, function () { return { name: name, items: [] }; });
      }));
    });
  }
  var loading = null, reloadAgain = false;
  function loadDisk() {
    var Fs = fsApi();
    if (!Fs || typeof Fs.ls !== "function") { disk = false; $("nofs").hidden = false; return Promise.resolve(); }
    if (loading) { reloadAgain = true; return loading; }
    loading = Promise.resolve(typeof Fs.ready === "function" ? Fs.ready() : null).then(function () {
      return Promise.all([readAll(Fs, C.NOTES_DIR, "notes"), readAll(Fs, C.REVIEWS_DIR, "reviews")]);
    }).then(function (res) {
      disk = true;
      $("nofs").hidden = true;
      var nmap = {}, revs = [], now = Date.now();
      var myNotes = C.fileName(dev, now), myRevs = C.fileName(dev, now);
      res[0].forEach(function (f) {
        nmap = C.foldNotes(nmap, f.items);
        if (f.name === myNotes && !mine.notes) mine.notes = { path: C.NOTES_DIR + "/" + f.name, items: f.items };
      });
      res[1].forEach(function (f) {
        revs = C.mergeReviews(revs, f.items);
        if (f.name === myRevs && !mine.reviews) mine.reviews = { path: C.REVIEWS_DIR + "/" + f.name, items: f.items };
      });
      // What this device wrote and has not reached the disk yet stays in.
      if (mine.notes) nmap = C.foldNotes(nmap, mine.notes.items);
      if (mine.reviews) revs = C.mergeReviews(revs, mine.reviews.items);
      notes = nmap;
      reviews = revs;
    }).catch(function (e) {
      console.warn("[flashcards] disk read failed", e);
      disk = false;
      $("nofs").hidden = false;
    }).then(function () {
      loading = null;
      rebuild();
      if (reloadAgain) { reloadAgain = false; return loadDisk(); }
    });
    return loading;
  }
  // Our own file of this month (a new month starts a new file).
  function ownFile(kind) {
    var now = Date.now();
    var path = kind === "notes" ? C.notesPath(dev, now) : C.reviewsPath(dev, now);
    if (!mine[kind] || mine[kind].path !== path) mine[kind] = { path: path, items: [] };
    return mine[kind];
  }
  function writeOwn(kind) {
    var f = mine[kind];
    if (!f) return Promise.resolve(true);
    var Fs = fsApi();
    if (!disk || !Fs || typeof Fs.writeText !== "function") return Promise.resolve(false);
    var text = C.writeFile(kind, dev, f.items);
    writeChain = writeChain.then(function () { return Fs.writeText(f.path, text); })
      .then(function () { return true; }, function (e) {
        console.warn("[flashcards] write failed", e);
        toast(t("diskFail"));
        return false;
      });
    return writeChain;
  }
  function saveNotes(versions) {
    var f = ownFile("notes");
    f.items = C.mergeNotes(f.items, versions);
    notes = C.foldNotes(notes, versions);
    rebuild();
    return writeOwn("notes");
  }
  var revTimer = 0;
  function addReviewRow(row) {
    var f = ownFile("reviews");
    f.items.push(row);
    reviews.push(row);
    if (reviews.length > 1 && reviews[reviews.length - 2].t > row.t) {
      reviews = C.mergeReviews(reviews, []);
    }
    clearTimeout(revTimer);
    revTimer = setTimeout(function () { writeOwn("reviews"); }, 800);
  }
  // Many rows at once (import): one write.
  function addReviewRows(list) {
    if (!list.length) return Promise.resolve(true);
    var f = ownFile("reviews");
    f.items = C.mergeReviews(f.items, list);
    reviews = C.mergeReviews(reviews, list);
    clearTimeout(revTimer);
    revTimer = 0;
    rebuild();
    return writeOwn("reviews");
  }
  function flushReviews() {
    if (!revTimer) return;
    clearTimeout(revTimer);
    revTimer = 0;
    writeOwn("reviews");
  }
  var seq = 0;
  function rowId(now) { return "r" + now.toString(36) + dev + (seq++).toString(36); }

  function rebuild() {
    sched = C.schedule(slice, notes, reviews, F);
    render();
  }

  // ---------- 4. Palette: follow the shell's theme and skin (G3) ----------
  var PAL_VARS = ["--bg", "--text", "--text-dim", "--accent", "--accent-hover",
                  "--accent-soft", "--panel-bg", "--border", "--danger"];
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

  // ---------- 5. Screen helpers ----------
  function $(id) { return document.getElementById(id); }
  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  }
  var toastTimer = 0;
  function toast(msg) {
    var box = $("toast");
    box.textContent = msg;
    box.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { box.classList.remove("show"); }, 3000);
  }
  function deckById(id) { return C.normalize(slice).decks.filter(function (x) { return x.id === id; })[0] || null; }
  function deckName(id) {
    if (id === C.DEFAULT_DECK) return t("home.unsorted");
    var d = deckById(id);
    return d ? d.n || "…" : t("home.unsorted");
  }
  function countsNode(q) {
    var box = el("span", "counts");
    [["cn", q.n, "cnt.new"], ["cl", q.l, "cnt.learn"], ["cr", q.r, "cnt.due"]].forEach(function (x) {
      var s = el("span", x[1] ? x[0] : "zero", String(x[1]));
      s.title = t(x[2]);
      s.setAttribute("aria-label", t(x[2]) + ": " + x[1]);
      box.appendChild(s);
    });
    return box;
  }
  function cardsIn(ids) {
    var n = 0;
    Object.keys(notes).forEach(function (id) {
      var x = notes[id];
      if (!x.del && ids[deckById(x.dk) ? x.dk : C.DEFAULT_DECK]) n += C.ords(x).length;
    });
    return n;
  }
  function plural(n) { return n === 1 ? t("home.card1") : t("home.cards", { n: n }); }
  function hasOrphans() {
    return Object.keys(notes).some(function (id) { return !notes[id].del && !deckById(notes[id].dk); });
  }

  // ---------- 6. Views ----------
  var view = "home", curDeck = "", shown = 300;
  function show(v) {
    view = v;
    document.body.classList.toggle("studying", v === "study");
    $("home").hidden = v !== "home";
    $("deck-view").hidden = v !== "deck";
    $("study").hidden = v !== "study";
    $("browse").hidden = v !== "browse";
    $("back-btn").hidden = v === "home";
    $("browse-btn").hidden = v === "study" || v === "browse";
    $("new-deck-btn").hidden = v !== "home";
    $("add-card-btn").hidden = v === "study";
    $("settings-btn").hidden = v === "study";
    if (v !== "study") { stopLaterTimer(); M.stopSpeaking(); closeMenu(); }
    render();
  }
  function render() {
    if (view === "home") renderHome();
    else if (view === "deck") renderDeck();
    else if (view === "study") renderStudyCounts();
    else if (view === "browse") renderBrowse();
  }

  function renderHome() {
    $("title").textContent = t("app.name");
    var list = $("deck-list"), tree = C.deckTree(slice), now = Date.now();
    list.textContent = "";
    var rows = tree.map(function (x) { return { id: x.deck.id, n: x.deck.n || "…", depth: x.depth }; });
    if (hasOrphans()) rows.push({ id: C.DEFAULT_DECK, n: t("home.unsorted"), depth: 0 });
    rows.forEach(function (r) {
      var li = el("li");
      li.tabIndex = 0;
      li.dataset.id = r.id;
      li.style.paddingLeft = (10 + Math.min(r.depth, 6) * 18) + "px";
      var name = el("span", "name", r.n);
      name.appendChild(el("span", "sub", plural(cardsIn(C.subtree(slice, r.id)))));
      li.appendChild(name);
      li.appendChild(countsNode(C.studyQueue(slice, sched, reviews, r.id, now)));
      var go = el("button", "chip", t("btn.study"));
      go.type = "button";
      go.addEventListener("click", function (ev) { ev.stopPropagation(); startStudy(r.id); });
      li.appendChild(go);
      li.addEventListener("click", function () { openDeck(r.id); });
      li.addEventListener("keydown", function (ev) { if (ev.code === "Enter") openDeck(r.id); });
      list.appendChild(li);
    });
    if (rows.length) {
      var add = el("li", "add-row");
      var b = el("button", "chip", "+ " + t("btn.newDeck"));
      b.type = "button";
      b.addEventListener("click", function (ev) { ev.stopPropagation(); deckDialog(""); });
      add.appendChild(b);
      var ib = el("button", "chip", t("btn.import"));
      ib.type = "button";
      ib.addEventListener("click", function (ev) { ev.stopPropagation(); importDialog(); });
      add.appendChild(ib);
      add.style.cursor = "default";
      add.style.background = "none";
      add.style.border = "0";
      list.appendChild(add);
    }
    $("home-empty").hidden = rows.length > 0;
  }

  function openDeck(id) {
    curDeck = id;
    shown = 300;
    $("filter").value = "";
    setPref("deck", id);
    show("deck");
  }
  function cardState(key) {
    var c = sched[key];
    if (c && c.sus) return t("s.sus");
    if (c && c.bury && c.bury >= C.dayStart(Date.now(), slice.set.ro)) return t("s.bury");
    if (!c || !c.card.st) return t("st.new");
    if (c.card.st === 1 || c.card.st === 3) return t("st.learn");
    if (c.card.due < C.dayEnd(Date.now(), slice.set.ro)) return t("st.today");
    return t("st.due", { d: new Date(c.card.due).toLocaleDateString(locale(), { day: "numeric", month: "short" }) });
  }
  // Case, accents and final sigma folded (\u03c2 → \u03c3) for the card filter.
  function fold(s) { return String(s || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\u03c2/g, "\u03c3"); }
  function renderDeck() {
    $("title").textContent = deckName(curDeck);
    var ids = C.subtree(slice, curDeck), now = Date.now();
    var q = C.studyQueue(slice, sched, reviews, curDeck, now);
    var box = $("deck-counts");
    box.textContent = "";
    box.appendChild(countsNode(q));
    $("study-btn").disabled = !q.queue.length;
    $("deck-edit-btn").hidden = curDeck === C.DEFAULT_DECK;
    var kids = Object.keys(ids).length - 1, total = cardsIn(ids);
    $("deck-note").textContent = kids > 0 ? t("deck.sub", { n: total, d: kids }) : t("deck.subOne", { n: total });
    var words = fold($("filter").value).split(/\s+/).filter(Boolean);
    var list = $("card-list");
    list.textContent = "";
    var all = C.liveNotes(notes).filter(function (n) { return ids[deckById(n.dk) ? n.dk : C.DEFAULT_DECK]; });
    var hits = all.filter(function (n) {
      if (!words.length) return true;
      var hay = fold([C.noteTitle(n), n.f.a || "", n.f.e || "", n.tg.join(" ")].join(" "));
      return words.every(function (w) { return hay.indexOf(w) >= 0; });
    });
    hits.slice(0, shown).forEach(function (n) {
      var li = el("li");
      li.tabIndex = 0;
      li.dataset.id = n.id;
      var name = el("span", "name", C.noteTitle(n) || "…");
      var o = C.ords(n);
      var sub = t("kind." + n.k) + (o.length ? " · " + cardState(C.cardKey(n.id, o[0])) : "");
      if (n.tg.length) sub += " · " + n.tg.map(function (x) { return "#" + x; }).join(" ");
      if (kids > 0 && n.dk !== curDeck) sub += " · " + deckName(n.dk);
      name.appendChild(el("span", "sub", sub));
      li.appendChild(name);
      li.addEventListener("click", function () { noteDialog(n.id); });
      li.addEventListener("keydown", function (ev) { if (ev.code === "Enter") noteDialog(n.id); });
      list.appendChild(li);
    });
    $("more-cards").hidden = hits.length <= shown;
    $("deck-empty").hidden = all.length > 0;
    if (all.length && !hits.length) { $("deck-empty").hidden = false; $("deck-empty").textContent = t("deck.none"); }
    else $("deck-empty").textContent = t("deck.empty");
  }

  // ---------- 7b. Card browser: filters + actions on many cards ----------
  var br = { from: "home", sel: {}, shown: 300, hits: [] };
  var STATES = ["new", "learn", "due", "rev", "bury", "sus"];
  function openBrowse(deckId) {
    br.from = view === "deck" ? "deck" : "home";
    br.sel = {};
    br.shown = 300;
    $("br-q").value = "";
    $("br-tag").value = "";
    $("br-state").value = "";
    fillBrowseSelects();
    $("br-deck").value = deckId && (deckById(deckId) || deckId === C.DEFAULT_DECK) ? deckId : "";
    show("browse");
  }
  function setOptions(sel, opts) {
    var keep = sel.value;
    sel.textContent = "";
    opts.forEach(function (o) { var op = el("option", "", o[1]); op.value = o[0]; sel.appendChild(op); });
    sel.value = opts.some(function (o) { return o[0] === keep; }) ? keep : "";
  }
  function allTags() {
    var seen = {};
    C.liveNotes(notes).forEach(function (n) { n.tg.forEach(function (x) { seen[x.toLowerCase()] = seen[x.toLowerCase()] || x; }); });
    return Object.keys(seen).sort().map(function (k) { return seen[k]; });
  }
  function fillBrowseSelects() {
    var decks = [["", t("br.allDecks")]].concat(deckOptions(null));
    if (hasOrphans()) decks.push([C.DEFAULT_DECK, t("home.unsorted")]);
    setOptions($("br-deck"), decks);
    setOptions($("br-tag"), [["", t("br.allTags")]].concat(allTags().map(function (x) { return [x, "#" + x]; })));
    setOptions($("br-state"), [["", t("br.allStates")]].concat(STATES.map(function (x) { return [x, t("s." + x)]; })));
  }
  function browseHits() {
    var now = Date.now(), ro = slice.set.ro;
    var dk = $("br-deck").value, ids = dk ? C.subtree(slice, dk) : null;
    var tag = $("br-tag").value.toLowerCase(), state = $("br-state").value;
    var words = fold($("br-q").value).split(/\s+/).filter(Boolean);
    var hay = {};
    return Object.keys(sched).filter(function (k) {
      var c = sched[k], n = c.note;
      if (ids && !ids[c.deck]) return false;
      if (tag && !n.tg.some(function (x) { return x.toLowerCase() === tag; })) return false;
      if (state && C.cardStatus(c, now, ro) !== state) return false;
      if (!words.length) return true;
      if (!hay[n.id]) hay[n.id] = fold([C.noteTitle(n), C.plain(n.f.a || ""), C.plain(n.f.e || ""), n.tg.join(" ")].join(" "));
      return words.every(function (w) { return hay[n.id].indexOf(w) >= 0; });
    }).sort(function (a, b) {
      var A = sched[a], B = sched[b];
      return B.note.m - A.note.m || (A.note.id < B.note.id ? -1 : A.note.id > B.note.id ? 1 : A.ord - B.ord);
    });
  }
  function selCount() { return Object.keys(br.sel).length; }
  function renderBrowse() {
    $("title").textContent = t("dlg.browse");
    fillBrowseSelects();
    var hits = br.hits = browseHits(), now = Date.now();
    Object.keys(br.sel).forEach(function (k) { if (!sched[k]) delete br.sel[k]; });
    var list = $("br-list");
    list.textContent = "";
    hits.slice(0, br.shown).forEach(function (k) {
      var c = sched[k], n = c.note;
      var li = el("li");
      li.tabIndex = 0;
      li.dataset.key = k;
      var cb = el("input");
      cb.type = "checkbox";
      cb.checked = !!br.sel[k];
      cb.setAttribute("aria-label", C.plain(C.cardText(n, c.ord).front).slice(0, 80));
      cb.addEventListener("click", function (ev) { ev.stopPropagation(); });
      cb.addEventListener("change", function () {
        if (cb.checked) br.sel[k] = 1; else delete br.sel[k];
        li.classList.toggle("sel", cb.checked);
        browseBar();
      });
      li.classList.toggle("sel", cb.checked);
      li.appendChild(cb);
      var front = C.plain(C.cardText(n, c.ord).front).replace(/\s+/g, " ").trim();
      var name = el("span", "name", front || (n.md ? "🖼" : "…"));
      var st = C.cardStatus(c, now, slice.set.ro);
      var sub = t("s." + st) + " · " + deckName(c.deck) + " · " + t("kind." + n.k);
      if (n.tg.length) sub += " · " + n.tg.map(function (x) { return "#" + x; }).join(" ");
      name.appendChild(el("span", "sub", sub));
      li.appendChild(name);
      if (st === "sus") li.classList.add("dim");
      li.addEventListener("click", function () { noteDialog(n.id); });
      li.addEventListener("keydown", function (ev) {
        if (ev.target !== li) return;
        if (ev.code === "Enter") noteDialog(n.id);
        else if (ev.code === "Space") { ev.preventDefault(); cb.checked = !cb.checked; cb.dispatchEvent(new Event("change")); }
      });
      list.appendChild(li);
    });
    $("br-more").hidden = hits.length <= br.shown;
    var any = Object.keys(sched).length > 0;
    $("br-empty").hidden = hits.length > 0;
    $("br-empty").textContent = any ? t("br.none") : t("br.empty");
    browseBar();
  }
  function browseBar() {
    var s = selCount(), n = br.hits.length;
    $("br-count").textContent = s ? t("br.sel", { s: s, n: n }) : t("br.count", { n: n });
    $("br-acts").hidden = !s;
    var all = $("br-all");
    var inHits = br.hits.filter(function (k) { return br.sel[k]; }).length;
    all.checked = n > 0 && inHits === n;
    all.indeterminate = inHits > 0 && inHits < n;
  }
  function selKeys() { return Object.keys(br.sel).filter(function (k) { return sched[k]; }).sort(); }
  function selNotes() {
    var seen = {}, out = [];
    selKeys().forEach(function (k) { var id = sched[k].note.id; if (!seen[id]) { seen[id] = 1; out.push(sched[k].note); } });
    return out;
  }
  function bulkDone(count) {
    br.sel = {};
    toast(t("br.done", { n: count }));
    renderBrowse();
  }
  // New versions of the selected notes; `edit` changes a copy, returns false to skip.
  function bulkNotes(edit) {
    var now = Date.now(), out = [], count = selKeys().length;
    selNotes().forEach(function (n) {
      var v = JSON.parse(JSON.stringify(n));
      if (edit(v) === false) return;
      v.m = Math.max(now, n.m + 1);
      v = C.normNote(v);
      if (v) out.push(v);
    });
    if (out.length) saveNotes(out);
    bulkDone(count);
  }
  function bulkFlag(f) {
    var keys = selKeys(), now = Date.now();
    keys.forEach(function (k) { addReviewRow({ i: rowId(now), c: k, t: now, f: f }); });
    sched = C.schedule(slice, notes, reviews, F);
    bulkDone(keys.length);
  }
  function bulkMove() {
    var decks = deckOptions(null);
    if (!decks.length) { toast(t("need.deck")); return; }
    var sel = select(decks, decks[0][0]);
    var body = el("div");
    var l = el("label", "field");
    l.appendChild(el("span", "", t("br.moveTo", { n: selKeys().length })));
    l.appendChild(sel);
    body.appendChild(l);
    openDialog(t("br.move"), body, { okText: t("br.move"), ok: function () {
      var to = sel.value;
      closeDialog();
      bulkNotes(function (v) { if (v.dk === to) return false; v.dk = to; });
    } });
  }
  function bulkTag(add) {
    var body = el("div"), box;
    if (add) box = input("text", "", C.LIMITS.tag);
    else {
      var have = {};
      selNotes().forEach(function (n) { n.tg.forEach(function (x) { have[x] = 1; }); });
      var list = Object.keys(have).sort();
      if (!list.length) { toast(t("br.none")); return; }
      box = select(list.map(function (x) { return [x, "#" + x]; }), list[0]);
    }
    body.appendChild(field("br.tagName", box));
    openDialog(t(add ? "br.tagAdd" : "br.tagDel"), body, { okText: t("btn.apply"), ok: function () {
      var tag = C.normTags([box.value])[0];
      if (!tag) { box.focus(); return; }
      var low = tag.toLowerCase();
      closeDialog();
      bulkNotes(function (v) {
        var has = v.tg.some(function (x) { return x.toLowerCase() === low; });
        if (add) { if (has) return false; v.tg.push(tag); }
        else { if (!has) return false; v.tg = v.tg.filter(function (x) { return x.toLowerCase() !== low; }); }
      });
    } });
  }
  function bulkDelete() {
    var ns = selNotes();
    if (!ns.length) return;
    var cards = 0;
    ns.forEach(function (n) { cards += C.ords(n).length; });
    confirmBox(t("br.confDel", { n: ns.length, c: cards }), t("btn.delete"), function () {
      var now = Date.now();
      saveNotes(ns.map(function (n) { return { id: n.id, m: Math.max(now, n.m + 1), del: 1 }; }));
      bulkDone(cards);
    });
  }

  // ---------- 7. Study ----------
  var study = { deck: "", key: "", shownAt: 0, back: false, undo: [], last: "" };
  var laterTimer = 0;
  function stopLaterTimer() { clearTimeout(laterTimer); laterTimer = 0; }
  function startStudy(id) {
    curDeck = id;
    study = { deck: id, key: "", shownAt: 0, back: false, undo: [], last: "" };
    $("title").textContent = deckName(id);
    show("study");
    nextCard();
  }
  function paramsFor(deckId) {
    var d = deckById(deckId);
    return F.params({ ret: d ? d.cfg.ret : C.CFG_DEF.ret });
  }
  function renderStudyCounts() {
    var q = C.studyQueue(slice, sched, reviews, study.deck, Date.now());
    var box = $("study-counts");
    box.textContent = "";
    box.appendChild(countsNode(q));
    $("undo-btn").disabled = !study.undo.length;
    $("title").textContent = deckName(study.deck);
    // A card edited or deleted elsewhere: show the current state.
    if (study.key && !sched[study.key]) nextCard();
    return q;
  }
  function nextCard() {
    stopLaterTimer();
    var now = Date.now();
    var q = C.studyQueue(slice, sched, reviews, study.deck, now);
    var key = q.queue[0] || "";
    if (key && key === study.last && q.queue.length > 1) key = q.queue[1];
    study.key = key;
    study.back = false;
    renderStudyCounts();
    var has = !!key;
    if (!has) { stopSounds(); M.stopSpeaking(); }
    $("card-box").hidden = !has;
    $("study-foot").hidden = !has;
    $("done-box").hidden = has;
    $("edit-cur-btn").hidden = !has;
    $("more-btn").hidden = !has;
    if (!has) {
      $("done-text").textContent = q.next ? t("study.later", { t: new Date(q.next).toLocaleTimeString(locale(), { hour: "2-digit", minute: "2-digit" }) })
        : (study.undo.length ? t("study.done") : t("study.empty"));
      if (q.next) laterTimer = setTimeout(nextCard, Math.max(1000, Math.min(q.next - Date.now() - 20 * 60000 + 1000, 2147483000)));
      return;
    }
    study.shownAt = now;
    drawCard();
    $("show-btn").hidden = false;
    $("grade-btns").hidden = true;
    $("show-btn").focus({ preventScroll: true });
  }
  // Formatted text (core fmtBlocks / fmtInline) as DOM nodes; text only through text nodes.
  function drawRuns(parent, text) {
    C.fmtInline(text).forEach(function (r) {
      var node = document.createTextNode(r.t);
      if (r.i) { var em = el("em"); em.appendChild(node); node = em; }
      if (r.b) { var st = el("strong"); st.appendChild(node); node = st; }
      if (r.gap || r.ans) { var sp = el("span", r.gap ? "gap" : "ans"); sp.appendChild(node); node = sp; }
      parent.appendChild(node);
    });
  }
  function drawText(box, text) {
    C.fmtBlocks(text).forEach(function (b) {
      if (b.k === "p") {
        var p = el("div", "para");
        b.lines.forEach(function (ln, i) { if (i) p.appendChild(el("br")); drawRuns(p, ln); });
        box.appendChild(p);
        return;
      }
      var list = el(b.k);
      if (b.k === "ol" && b.start !== 1) list.start = b.start;
      b.items.forEach(function (it) { var li = el("li"); drawRuns(li, it); list.appendChild(li); });
      box.appendChild(list);
    });
  }
  // Pictures and sounds of one field. Returns the audio elements, in order.
  function drawMedia(box, names) {
    var auds = [];
    (names || []).forEach(function (name) {
      var kind = C.mediaKind(name);
      if (!kind) return;
      var node;
      if (kind === "img") { node = el("img", "m-img"); node.alt = ""; node.decoding = "async"; }
      else { node = el("audio", "m-aud"); node.controls = true; node.preload = "auto"; auds.push(node); }
      box.appendChild(node);
      M.url(fsApi(), name).then(function (u) {
        if (u) { node.src = u; return; }
        var miss = el("span", "m-miss", t("m.missing"));
        if (node.parentNode) node.parentNode.replaceChild(miss, node);
      });
    });
    return auds;
  }
  // One side of a card; returns its audio elements.
  function drawSide(box, note, ord, back) {
    box.textContent = "";
    var auds = [];
    C.sideMarked(note, ord, back).forEach(function (part) {
      var wrap = el("div", part.field === "e" ? "extra" : "fld");
      drawText(wrap, part.text);
      box.appendChild(wrap);
      if (note.md && note.md[part.field]) {
        var mbox = el("div", "media");
        auds = auds.concat(drawMedia(mbox, note.md[part.field]));
        box.appendChild(mbox);
      }
    });
    return auds;
  }
  // Card sounds play one after the other (device setting, on by default).
  var playSeq = 0;
  function autoplay(auds) {
    var my = ++playSeq;
    if (prefs().auto === false || !auds.length) return;
    (function play(i) {
      if (i >= auds.length || my !== playSeq || view !== "study") return;
      var a = auds[i];
      function go() {
        if (my !== playSeq) return;
        a.onended = function () { play(i + 1); };
        var pr = a.play();
        if (pr && pr.catch) pr.catch(function () { /* blocked or not loaded */ });
      }
      if (a.src) go(); else a.addEventListener("loadedmetadata", go, { once: true });
    })(0);
  }
  function stopSounds() {
    playSeq++;
    [].forEach.call(document.querySelectorAll("#card-box audio"), function (a) { try { a.pause(); } catch (e) { /* none */ } });
  }
  function drawCard() {
    var c = sched[study.key];
    if (!c) return;
    stopSounds();
    M.stopSpeaking();
    var cloze = c.note.k === "cloze";
    var auds = drawSide($("side-front"), c.note, c.ord, cloze && study.back);
    $("side-line").hidden = !study.back || cloze;
    $("side-back").hidden = !study.back || cloze;
    if (study.back && !cloze) auds = drawSide($("side-back"), c.note, c.ord, true);
    else if (!cloze) $("side-back").textContent = "";
    $("speak-btn").hidden = !M.hasVoices();
    autoplay(auds);
  }
  // Read aloud what is showing: the front, or the answer once shown.
  function speakSide() {
    var c = sched[study.key];
    if (view !== "study" || !c) return;
    var d = deckById(c.deck);
    var parts = C.sideMarked(c.note, c.ord, study.back).map(function (p) {
      return { text: C.plain(p.text), lang: C.fieldLang(c.note, p.field, d ? d.cfg : null, LANG) };
    });
    stopSounds();
    if (!M.speak(parts)) toast(t("v.none"));
  }
  // ⋯ menu on the study screen.
  function closeMenu() {
    if (!$("study-menu").hidden) { $("study-menu").hidden = true; $("more-btn").setAttribute("aria-expanded", "false"); }
  }
  function toggleMenu() {
    var open = $("study-menu").hidden;
    $("study-menu").hidden = !open;
    $("more-btn").setAttribute("aria-expanded", open ? "true" : "false");
    if (open) $("bury-btn").focus();
  }
  // Bury (until the study day ends) or suspend the card on screen: a flag row, undoable.
  function flagCard(f) {
    closeMenu();
    if (view !== "study" || !study.key) return;
    var c = sched[study.key], now = Date.now();
    var row = { i: rowId(now), c: study.key, t: now, f: f };
    addReviewRow(row);
    if (c) { if (f === "s") c.sus = true; else c.bury = now; }
    study.undo.push({ row: row.i, key: study.key, flag: true });
    if (study.undo.length > 50) study.undo.shift();
    toast(t(f === "s" ? "suspended" : "buried"));
    nextCard();
  }
  function showAnswer() {
    if (view !== "study" || !study.key || study.back) return;
    study.back = true;
    drawCard();
    var c = sched[study.key], now = Date.now();
    var pv = F.preview(c.card, now, paramsFor(c.deck));
    [].forEach.call(document.querySelectorAll("#grade-btns .grade"), function (b) {
      var g = +b.dataset.g;
      b.querySelector(".gi").textContent = ivlText(pv[g].due - now);
    });
    $("show-btn").hidden = true;
    $("grade-btns").hidden = false;
    var good = document.querySelector("#grade-btns .g3");
    if (good) good.focus({ preventScroll: true });
  }
  function answer(g) {
    if (view !== "study" || !study.key || !study.back) return;
    var c = sched[study.key];
    if (!c) { nextCard(); return; }
    var now = Math.max(Date.now(), c.card.last + 1);
    var row = { i: rowId(now), c: study.key, t: now, g: g, ms: Math.min(3599999, now - study.shownAt) };
    addReviewRow(row);
    // Only this card changes: step it here instead of replaying everything.
    c.card = F.next(c.card, now, g, paramsFor(c.deck));
    c.revs++;
    if (!c.first) c.first = now;
    study.undo.push({ row: row.i, key: study.key });
    if (study.undo.length > 50) study.undo.shift();
    study.last = study.key;
    nextCard();
  }
  function undoAnswer() {
    var u = study.undo.pop();
    if (!u) return;
    var now = Date.now();
    addReviewRow({ i: rowId(now), u: u.row, t: now });
    sched = C.schedule(slice, notes, reviews, F);
    study.last = "";
    toast(t(u.flag ? "undoneAct" : "undone"));
    stopLaterTimer();
    if (sched[u.key]) {
      study.key = u.key;
      study.back = false;
      study.shownAt = now;
      $("card-box").hidden = false;
      $("study-foot").hidden = false;
      $("done-box").hidden = true;
      $("edit-cur-btn").hidden = false;
      $("more-btn").hidden = false;
      renderStudyCounts();
      drawCard();
      $("show-btn").hidden = false;
      $("grade-btns").hidden = true;
    } else nextCard();
  }

  // ---------- 8. Dialogs ----------
  var dlg = null;   // { ok(), alt?(), del?() }
  function openDialog(title, body, opts) {
    $("dlg-title").textContent = title;
    var b = $("dlg-body");
    b.textContent = "";
    if (body) b.appendChild(body);
    $("dlg-ok").textContent = opts.okText || t("btn.save");
    $("dlg-alt").hidden = !opts.alt;
    if (opts.alt) $("dlg-alt").textContent = opts.altText;
    $("dlg-del").hidden = !opts.del;
    $("dlg-cancel").hidden = !!opts.noCancel;
    $("dlg-ok").disabled = false;
    if (dlg && dlg !== opts && dlg.onClose) dlg.onClose();
    dlg = opts;
    $("veil").hidden = false;
    var first = b.querySelector("input, select, textarea");
    (first || $("dlg-ok")).focus();
  }
  function closeDialog() {
    var d = dlg;
    $("veil").hidden = true;
    dlg = null;
    if (d && d.onClose) d.onClose();
  }
  function field(labelKey, input) {
    var l = el("label", "field");
    l.appendChild(el("span", "", t(labelKey)));
    l.appendChild(input);
    return l;
  }
  function input(type, value, max) {
    var i = el("input");
    i.type = type;
    if (max) i.maxLength = max;
    i.value = value == null ? "" : String(value);
    return i;
  }
  function select(options, value) {
    var s = el("select");
    options.forEach(function (o) {
      var op = el("option", "", o[1]);
      op.value = o[0];
      s.appendChild(op);
    });
    s.value = value;
    return s;
  }
  function textarea(value) {
    var a = el("textarea");
    a.maxLength = C.LIMITS.field;
    a.value = value || "";
    return a;
  }
  function confirmBox(text, okText, onOk) {
    var p = el("p", "", text);
    openDialog(t("btn.delete"), p, { okText: okText, ok: function () { closeDialog(); onOk(); } });
  }
  function deckOptions(skip) {
    return C.deckTree(slice).filter(function (x) { return !skip || !skip[x.deck.id]; }).map(function (x) {
      return [x.deck.id, new Array(x.depth + 1).join("— ") + (x.deck.n || "…")];
    });
  }

  function deckDialog(id) {
    var d = id ? deckById(id) : null;
    var body = el("div");
    var name = input("text", d ? d.n : "", C.LIMITS.name);
    body.appendChild(field("f.name", name));
    var skip = id ? C.subtree(slice, id) : null;
    var par = select([["", t("f.top")]].concat(deckOptions(skip)), d && d.par ? d.par : (id ? "" : (view === "deck" && curDeck !== C.DEFAULT_DECK ? curDeck : "")));
    body.appendChild(field("f.parent", par));
    var cfg = d ? d.cfg : C.CFG_DEF;
    var two = el("div", "two");
    var nd = input("number", cfg.nd); nd.min = 0; nd.max = 9999;
    var rd = input("number", cfg.rd); rd.min = 0; rd.max = 99999;
    two.appendChild(field("f.nd", nd));
    two.appendChild(field("f.rd", rd));
    body.appendChild(two);
    var rets = [0.8, 0.85, 0.9, 0.93, 0.95, 0.97];
    if (rets.indexOf(cfg.ret) < 0) rets.push(cfg.ret);
    var ret = select(rets.sort().map(function (r) { return [String(r), t("ret.pct", { n: Math.round(r * 100) })]; }), String(cfg.ret));
    body.appendChild(field("f.ret", ret));
    body.appendChild(el("p", "hint", t("f.retHint")));
    // Read aloud: the language of each side (local voices only).
    var langs = C.voiceLangs(M.voices()), vq = null, va = null;
    if (langs.length) {
      var opts = [["", t("f.vAuto")]].concat(langs.map(function (l) { return [l, langName(l)]; }));
      [cfg.vq, cfg.va].forEach(function (v) {
        if (v && !opts.some(function (o) { return o[0] === v; })) opts.push([v, langName(v)]);
      });
      var vtwo = el("div", "two");
      vq = select(opts, cfg.vq || "");
      va = select(opts, cfg.va || "");
      vtwo.appendChild(field("f.vq", vq));
      vtwo.appendChild(field("f.va", va));
      body.appendChild(vtwo);
    } else body.appendChild(el("p", "hint", t("f.vNone")));
    openDialog(t(id ? "dlg.deck" : "dlg.newDeck"), body, {
      okText: t(id ? "btn.save" : "btn.create"),
      ok: function () {
        var n = name.value.replace(/\s+/g, " ").trim();
        if (!n) { toast(t("need.name")); name.focus(); return; }
        var c = { nd: +nd.value, rd: +rd.value, ret: +ret.value };
        if (vq) { c.vq = vq.value; c.va = va.value; }
        var now = Date.now();
        if (id) saveSlice(C.updateDeck(slice, id, { n: n, par: par.value, cfg: c }, now));
        else {
          var newId = C.newId("d", now);
          saveSlice(C.addDeck(slice, n, now, { id: newId, par: par.value || undefined, cfg: c }));
          id = newId;
        }
        closeDialog();
        if (view === "study") render(); else openDeck(id);
      },
      del: id ? function () { deleteDeck(id); } : null
    });
  }
  function langName(tag) {
    try {
      var nm = new Intl.DisplayNames([locale()], { type: "language" }).of(tag);
      return nm && nm !== tag ? nm + " (" + tag + ")" : tag;
    } catch (e) { return tag; }
  }
  function deleteDeck(id) {
    var d = deckById(id);
    if (!d) return;
    var ids = C.subtree(slice, id), count = cardsIn(ids);
    confirmBox(count ? t("conf.deck", { n: d.n, c: count }) : t("conf.deckEmpty", { n: d.n }), t("btn.delete"), function () {
      var now = Date.now(), next = slice;
      Object.keys(ids).forEach(function (x) { if (x !== C.DEFAULT_DECK) next = C.removeDeck(next, x, now); });
      var gone = Object.keys(notes).filter(function (n) { return !notes[n].del && ids[notes[n].dk]; })
        .map(function (n) { return { id: n, m: Math.max(now, notes[n].m + 1), del: 1 }; });
      saveSlice(next);
      if (gone.length) saveNotes(gone);
      toast(t("deleted"));
      show("home");
    });
  }

  function settingsDialog() {
    var body = el("div");
    var hours = [];
    for (var h = 0; h < 24; h++) hours.push([String(h), (h < 10 ? "0" : "") + h + ":00"]);
    var ro = select(hours, String(slice.set.ro));
    body.appendChild(field("f.dayStart", ro));
    var auto = el("label", "check");
    var cb = el("input");
    cb.type = "checkbox";
    cb.checked = prefs().auto !== false;
    auto.appendChild(cb);
    auto.appendChild(el("span", "", t("f.autoplay")));
    body.appendChild(auto);
    body.appendChild(el("p", "hint", t("f.where")));
    openDialog(t("dlg.settings"), body, {
      ok: function () {
        setPref("auto", cb.checked);
        if (+ro.value !== slice.set.ro) saveSlice(C.setDayStart(slice, +ro.value, Date.now()));
        closeDialog();
      }
    });
  }

  function noteDialog(id, preset) {
    var n = id ? notes[id] : null;
    if (id && (!n || n.del)) return;
    var decks = deckOptions(null);
    if (!decks.length && !n) { toast(t("need.deck")); deckDialog(""); return; }
    var p = prefs();
    var deckDefault = n ? n.dk : (view !== "home" && deckById(curDeck) ? curDeck : (deckById(p.deck) ? p.deck : (decks[0] ? decks[0][0] : C.DEFAULT_DECK)));
    if (n && !deckById(n.dk)) decks.unshift([C.DEFAULT_DECK, t("home.unsorted")]);
    var kind = n ? n.k : (preset && preset.k) || (["basic", "rev", "cloze"].indexOf(p.kind) >= 0 ? p.kind : "basic");
    var body = el("div");
    var two = el("div", "two");
    var deckSel = select(decks, deckDefault);
    var kindSel = select([["basic", t("kind.basic")], ["rev", t("kind.rev")], ["cloze", t("kind.cloze")]], kind);
    two.appendChild(field("f.deck", deckSel));
    two.appendChild(field("f.kind", kindSel));
    body.appendChild(two);
    var q = textarea(n && n.k !== "cloze" ? n.f.q : (preset && preset.q) || "");
    var a = textarea(n && n.k !== "cloze" ? n.f.a : (preset && preset.a) || "");
    var x = textarea(n && n.k === "cloze" ? n.f.x : (preset && preset.x) || "");
    var e = textarea(n && n.k === "cloze" ? n.f.e : "");
    var areas = { q: q, a: a, x: x, e: e };
    // Pictures and sounds per field: names in `media`, new files (not on the disk yet) in `fresh`.
    var media = { q: [], a: [], x: [], e: [] }, fresh = {};
    if (n && n.md) Object.keys(n.md).forEach(function (k) { media[k] = n.md[k].slice(); });
    var strips = {};
    function mediaStrip(k) {
      var box = el("div", "media-edit");
      var items = el("div", "media-items");
      var btns = el("div", "media-btns");
      [["btn.image", "image/*"], ["btn.audio", "audio/*"]].forEach(function (b) {
        var bt = el("button", "chip small", t(b[0]));
        bt.type = "button";
        bt.addEventListener("click", function () { pickFiles(k, b[1]); });
        btns.appendChild(bt);
      });
      if (M.canRecord()) {
        var rb = el("button", "chip small rec", t("btn.record"));
        rb.type = "button";
        rb.addEventListener("click", function () { toggleRecord(k, rb); });
        btns.appendChild(rb);
      }
      box.appendChild(items);
      box.appendChild(btns);
      strips[k] = items;
      drawStrip(k);
      // Paste or drop a picture or sound straight into the field.
      areas[k].addEventListener("paste", function (ev) {
        var files = ev.clipboardData && ev.clipboardData.files;
        if (files && files.length) { ev.preventDefault(); addFiles(k, files); }
      });
      [areas[k], box].forEach(function (target) {
        target.addEventListener("dragover", function (ev) {
          if (ev.dataTransfer && [].indexOf.call(ev.dataTransfer.types || [], "Files") >= 0) ev.preventDefault();
        });
        target.addEventListener("drop", function (ev) {
          var files = ev.dataTransfer && ev.dataTransfer.files;
          if (files && files.length) { ev.preventDefault(); addFiles(k, files); }
        });
      });
      return box;
    }
    function drawStrip(k) {
      var items = strips[k];
      if (!items) return;
      items.textContent = "";
      media[k].forEach(function (name, i) {
        var it = el("div", "media-it");
        if (C.mediaKind(name) === "img") {
          var img = el("img"); img.alt = "";
          M.url(fsApi(), name).then(function (u) { if (u) img.src = u; else it.replaceChild(el("span", "m-miss", t("m.missing")), img); });
          it.appendChild(img);
        } else {
          var au = el("audio"); au.controls = true; au.preload = "metadata";
          M.url(fsApi(), name).then(function (u) { if (u) au.src = u; else it.replaceChild(el("span", "m-miss", t("m.missing")), au); });
          it.appendChild(au);
        }
        var rm = el("button", "icon-btn rm");
        rm.type = "button";
        rm.textContent = "✕";
        rm.setAttribute("aria-label", t("btn.remove"));
        rm.title = t("btn.remove");
        rm.addEventListener("click", function () { media[k].splice(i, 1); drawStrip(k); });
        it.appendChild(rm);
        items.appendChild(it);
      });
    }
    function addFiles(k, files) {
      [].slice.call(files).forEach(function (f) {
        if (media[k].length >= C.MEDIA_MAX) { toast(t("m.full")); return; }
        M.prepare(f).then(function (item) {
          if (media[k].indexOf(item.name) >= 0) return;
          if (media[k].length >= C.MEDIA_MAX) { toast(t("m.full")); return; }
          fresh[item.name] = item;
          media[k].push(item.name);
          drawStrip(k);
        }, function (err) {
          var code = err && err.code;
          toast(t(code === "toobig" ? "m.toobig" : code === "badimage" ? "m.badimage" : "m.badtype"));
        });
      });
    }
    var picker = el("input");
    picker.type = "file";
    picker.multiple = true;
    picker.hidden = true;
    var pickFor = "q";
    picker.addEventListener("change", function () {
      if (picker.files && picker.files.length) addFiles(pickFor, picker.files);
      picker.value = "";
    });
    function pickFiles(k, accept) { pickFor = k; picker.accept = accept; picker.click(); }
    // One recording at a time; the button shows the time and stops it.
    var rec = null;
    function toggleRecord(k, btn) {
      if (rec) {
        var r = rec; rec = null;
        clearInterval(r.tick);
        r.btn.textContent = t("btn.record");
        r.btn.classList.remove("on");
        r.handle.stop().then(function (file) { addFiles(r.k, [file]); });
        return;
      }
      M.record(function () { toast(t("m.recMax")); if (rec) toggleRecord(rec.k, rec.btn); }).then(function (handle) {
        var start = Date.now();
        rec = { k: k, btn: btn, handle: handle, tick: 0 };
        btn.classList.add("on");
        function upd() {
          var s = Math.floor((Date.now() - start) / 1000);
          btn.textContent = t("btn.stop", { t: Math.floor(s / 60) + ":" + (s % 60 < 10 ? "0" : "") + (s % 60) });
        }
        upd();
        rec.tick = setInterval(upd, 500);
      }, function () { toast(t("m.nomic")); });
    }
    function stopRecording() {
      if (!rec) return;
      clearInterval(rec.tick);
      rec.handle.cancel();
      rec = null;
    }
    // Formatting buttons act on the field last used.
    var lastArea = kind === "cloze" ? x : q;
    [q, a, x, e].forEach(function (ar) { ar.addEventListener("focus", function () { lastArea = ar; }); });
    var fbar = el("div", "fmt-bar");
    [["btn.bold", "B", "b"], ["btn.italic", "I", "i"], ["btn.list", "•", "ul"], ["btn.numbers", "1.", "ol"]].forEach(function (f) {
      var b = el("button", "chip small fmt-" + f[2], f[1]);
      b.type = "button";
      b.setAttribute("aria-label", t(f[0]));
      b.title = t(f[0]);
      b.addEventListener("mousedown", function (ev) { ev.preventDefault(); });   // keep the selection
      b.addEventListener("click", function () { applyFormat(lastArea, f[2]); });
      fbar.appendChild(b);
    });
    fbar.appendChild(el("span", "hint", t("f.fmtHint")));
    function applyFormat(ar, how) {
      var s = ar.selectionStart, en = ar.selectionEnd, v = ar.value, ins;
      if (how === "b" || how === "i") {
        var mk = how === "b" ? "**" : "*";
        var mid = v.slice(s, en);
        ins = mk + (mid || "…") + mk;
        ar.value = v.slice(0, s) + ins + v.slice(en);
        ar.focus();
        if (mid) ar.setSelectionRange(s + ins.length, s + ins.length);
        else ar.setSelectionRange(s + mk.length, s + mk.length + 1);
        return;
      }
      var ls = v.lastIndexOf("\n", s - 1) + 1, le = v.indexOf("\n", en);
      if (le < 0) le = v.length;
      var lines = v.slice(ls, le).split("\n").map(function (line, i) {
        var bare = line.replace(/^\s*(?:[-•]|\d{1,4}[.)])\s+/, "");
        return (how === "ul" ? "- " : (i + 1) + ". ") + bare;
      });
      ins = lines.join("\n");
      ar.value = v.slice(0, ls) + ins + v.slice(le);
      ar.focus();
      ar.setSelectionRange(ls + ins.length, ls + ins.length);
    }
    var fq = field("f.front", q), fa = field("f.back", a), fx = field("f.text", x), fe = field("f.extra", e);
    fq.appendChild(mediaStrip("q")); fa.appendChild(mediaStrip("a"));
    fx.appendChild(mediaStrip("x")); fe.appendChild(mediaStrip("e"));
    var bar = el("div", "cloze-bar");
    var cz = el("button", "chip", t("btn.cloze")); cz.type = "button";
    var cz2 = el("button", "chip", t("btn.clozeSame")); cz2.type = "button";
    bar.appendChild(cz); bar.appendChild(cz2);
    bar.appendChild(el("p", "hint", t("f.clozeHint")));
    [fbar, fq, fa, fx, bar, fe, picker].forEach(function (f) { body.appendChild(f); });
    var tags = input("text", n ? n.tg.join(" ") : "", 600);
    body.appendChild(field("f.tags", tags));
    function sync() {
      var c = kindSel.value === "cloze";
      fq.hidden = fa.hidden = c;
      fx.hidden = fe.hidden = bar.hidden = !c;
      if (lastArea.closest && lastArea.closest(".field").hidden) lastArea = c ? x : q;
    }
    kindSel.addEventListener("change", function () {
      // Carry the text and the media over when the type changes.
      if (kindSel.value === "cloze" && !x.value && q.value) x.value = q.value + (a.value ? "\n" + a.value : "");
      if (kindSel.value !== "cloze" && !q.value && x.value) q.value = x.value.replace(/\{\{c\d+::([\s\S]*?)(?:::[\s\S]*?)?\}\}/g, "$1");
      var to = kindSel.value === "cloze" ? [["q", "x"], ["a", "e"]] : [["x", "q"], ["e", "a"]];
      to.forEach(function (pr) {
        if (!media[pr[1]].length && media[pr[0]].length) { media[pr[1]] = media[pr[0]].slice(); drawStrip(pr[1]); }
      });
      sync();
    });
    function makeGap(same) {
      var nums = C.clozeNums(x.value), num = nums.length ? nums[nums.length - 1] + (same ? 0 : 1) : 1;
      var s = x.selectionStart, en = x.selectionEnd, v = x.value;
      var mid = v.slice(s, en) || "…";
      var ins = "{{c" + num + "::" + mid + "}}";
      x.value = v.slice(0, s) + ins + v.slice(en);
      x.focus();
      x.setSelectionRange(s + ins.length, s + ins.length);
    }
    cz.addEventListener("click", function () { makeGap(false); });
    cz2.addEventListener("click", function () { makeGap(true); });
    sync();
    function collect() {
      var k = kindSel.value, now = Date.now();
      var v = { id: n ? n.id : C.newId("n", now), m: n ? Math.max(now, n.m + 1) : now, k: k, dk: deckSel.value,
        tg: tags.value.split(/[\s,]+/) };
      if (k === "cloze") {
        if (!C.clozeNums(x.value).length) { toast(t("need.cloze")); x.focus(); return null; }
        v.f = { x: x.value, e: e.value };
        v.md = { x: media.x, e: media.e };
      } else {
        if (!q.value.trim() && !media.q.length) { toast(t("need.front")); q.focus(); return null; }
        v.f = { q: q.value, a: a.value };
        v.md = { q: media.q, a: media.a };
      }
      return C.normNote(v);
    }
    function store(v) {
      setPref("kind", v.k);
      setPref("deck", v.dk);
      // New pictures and sounds this note uses go to the disk first.
      var Fs = fsApi(), names = [];
      if (v.md) Object.keys(v.md).forEach(function (k) { v.md[k].forEach(function (nm) { if (fresh[nm]) names.push(nm); }); });
      if (names.length && disk && Fs && typeof Fs.write === "function") {
        writeChain = writeChain.then(function () {
          return Promise.all(names.map(function (nm) { return M.write(Fs, fresh[nm]); }));
        }).catch(function (err) { console.warn("[flashcards] media write failed", err); toast(t("m.saveFail")); });
      }
      saveNotes([v]);
      toast(t("saved"));
    }
    openDialog(t(n ? "dlg.editCard" : "dlg.newCard"), body, {
      ok: function () {
        var v = collect();
        if (!v) return;
        stopRecording();
        store(v);
        closeDialog();
        if (view === "study") { if (sched[study.key]) drawCard(); else nextCard(); }
      },
      alt: n ? null : function () {
        var v = collect();
        if (!v) return;
        stopRecording();
        store(v);
        n = null;
        q.value = a.value = x.value = e.value = "";
        media = { q: [], a: [], x: [], e: [] };
        Object.keys(strips).forEach(drawStrip);
        (kindSel.value === "cloze" ? x : q).focus();
      },
      altText: t("btn.saveNext"),
      onClose: stopRecording,
      del: n ? function () {
        confirmBox(t("conf.note"), t("btn.delete"), function () {
          saveNotes([{ id: n.id, m: Math.max(Date.now(), n.m + 1), del: 1 }]);
          toast(t("deleted"));
          if (view === "study") nextCard();
        });
      } : null
    });
  }

  // ---------- 8b. Import: Anki packages and text files ----------
  // The readers load only when a file is imported (precached all the same).
  var IMPORT_MAX = 300 * 1024 * 1024;
  var loaded = {};
  function need(src) {
    if (!loaded[src]) {
      loaded[src] = new Promise(function (ok, no) {
        var sc = document.createElement("script");
        sc.src = src + (SCRIPT_V ? "?v=" + SCRIPT_V : "");
        sc.onload = function () { ok(); };
        sc.onerror = function () { delete loaded[src]; no(new Error("load")); };
        document.head.appendChild(sc);
      });
    }
    return loaded[src];
  }
  function readers() {
    return Promise.all([need("../atelier/zip.js"), need("../vendor/fzstd/fzstd.umd.js"), need("sqlite.js"), need("anki.js")]);
  }
  // A deck for every path ["Languages", "Spanish"], reusing decks with the same name and parent.
  function deckMaker(now) {
    var next = slice, made = {};
    function find(name, par) {
      return C.normalize(next).decks.filter(function (x) { return x.n === name && (x.par || "") === par; })[0];
    }
    return {
      id: function (path) {
        var par = "";
        path.slice(0, 12).forEach(function (part) {
          var name = part.replace(/\s+/g, " ").trim().slice(0, C.LIMITS.name) || "…";
          var d = find(name, par);
          if (!d) {
            if (C.normalize(next).decks.length >= C.LIMITS.decks) return;
            var id = C.newId("d", now);
            next = C.addDeck(next, name, now, { id: id, par: par || undefined });
            made[id] = 1;
            d = { id: id };
          }
          par = d.id;
        });
        return par || C.DEFAULT_DECK;
      },
      save: function () { if (Object.keys(made).length) saveSlice(next); },
      count: function () { return Object.keys(made).length; }
    };
  }
  function importDialog() {
    var body = el("div");
    body.appendChild(el("p", "hint", t("im.intro")));
    var pick = el("button", "chip pri", t("btn.chooseFile"));
    pick.type = "button";
    var inp = el("input");
    inp.type = "file";
    inp.hidden = true;
    inp.accept = ".apkg,.colpkg,.csv,.tsv,.txt,text/plain,text/csv,text/tab-separated-values";
    var status = el("p", "im-status");
    status.setAttribute("role", "status");
    var area = el("div", "im-area");
    [pick, inp, status, area].forEach(function (x) { body.appendChild(x); });
    var job = null;   // { run() } once a file is ready
    var busy = false;
    pick.addEventListener("click", function () { inp.click(); });
    inp.addEventListener("change", function () {
      var f = inp.files && inp.files[0];
      inp.value = "";
      if (f) take(f);
    });
    body.addEventListener("dragover", function (ev) { ev.preventDefault(); });
    body.addEventListener("drop", function (ev) {
      var f = ev.dataTransfer && ev.dataTransfer.files && ev.dataTransfer.files[0];
      if (f) { ev.preventDefault(); take(f); }
    });
    function say(msg) { status.textContent = msg; }
    function take(file) {
      if (busy) return;
      job = null;
      $("dlg-ok").disabled = true;
      area.textContent = "";
      if (file.size > IMPORT_MAX) { say(t("im.toobig")); return; }
      say(t("im.reading"));
      busy = true;
      file.arrayBuffer().then(function (buf) {
        var bytes = new Uint8Array(buf);
        var zip = bytes.length > 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 3 && bytes[3] === 4;
        var base = String(file.name || "").replace(/\.[^.]*$/, "").trim() || t("app.name");
        return readers().then(function () { return zip ? ankiStep(bytes, base) : textStep(bytes, base); });
      }).catch(function (e) {
        console.warn("[flashcards] import read failed", e);
        say(t("im.bad"));
      }).then(function () { busy = false; });
    }
    function ankiStep(bytes, base) {
      var A = window.FlashcardsAnki;
      return A.readPackage(bytes, { zip: window.AtelierZip, sqlite: window.FlashcardsSqlite, zstd: window.fzstd }).then(function (model) {
        if (model.notes.length >= A.MAX_NOTES) toast(t("im.tooMany", { n: A.MAX_NOTES }));
        var items = A.convert(model);
        if (!items.length) { say(t("im.badText")); return; }
        var probe = A.plan(model, items, { now: Date.now(), deckId: function () { return C.DEFAULT_DECK; }, existing: notes, history: true });
        // Only what is new counts: notes not here yet, answers not here yet, their media.
        var fresh = items.filter(function (it) { var x = notes[A.noteIdFor(it.guid, it.key)]; return !x || x.del; });
        var files = A.mediaUsed(fresh), haveRow = {};
        reviews.forEach(function (r) { haveRow[r.i] = 1; });
        probe.answers = probe.rows.filter(function (r) { return !r.f && !haveRow[r.i]; }).length;
        var decks = {};
        fresh.forEach(function (it) { decks[(model.decks[it.did] || []).join("\u001f")] = 1; });
        area.textContent = "";
        area.appendChild(el("p", "", t("im.sum", { n: probe.notes.length, c: probe.cards, d: Object.keys(decks).length })));
        if (probe.answers) area.appendChild(el("p", "", t("im.hist", { r: probe.answers })));
        if (files.length) area.appendChild(el("p", "", t("im.mediaSum", { m: files.length })));
        if (probe.skipped) area.appendChild(el("p", "hint", t("im.skip", { s: probe.skipped })));
        var hist = el("input");
        hist.type = "checkbox";
        hist.checked = true;
        if (probe.answers) {
          var lab = el("label", "check");
          lab.appendChild(hist);
          lab.appendChild(el("span", "", t("im.histBox")));
          area.appendChild(lab);
        }
        say("");
        if (!probe.notes.length && !probe.answers) { area.textContent = ""; say(t("im.nothing")); return; }
        job = { run: function () { return ankiRun(model, items, files, base, hist.checked); } };
        $("dlg-ok").disabled = false;
      });
    }
    function ankiRun(model, items, files, base, history) {
      var A = window.FlashcardsAnki, Fs = fsApi(), map = {}, failed = 0, i = 0;
      // Pictures and sounds: read, redraw / hash, write, one at a time.
      function nextMedia() {
        if (i >= files.length) return Promise.resolve();
        var name = files[i++];
        say(t("im.media", { i: i, n: files.length }));
        return model.readMedia(name).then(function (data) {
          if (!data) { failed++; return; }
          return M.prepare(new File([data], name, { type: "" })).then(function (item) {
            map[name] = item.name;
            if (disk && Fs) return M.write(Fs, item);
          });
        }).catch(function () { failed++; }).then(nextMedia);
      }
      return nextMedia().then(function () {
        say(t("im.saving"));
        var now = Date.now(), maker = deckMaker(now);
        var p = A.plan(model, items, {
          now: now, existing: notes, media: map, history: history,
          deckId: function (path) {
            if (!path.length || (path.length === 1 && path[0] === "Default")) path = [base];
            return maker.id(path);
          }
        });
        maker.save();
        var list = p.notes.map(C.normNote).filter(Boolean);
        return Promise.all([list.length ? saveNotes(list) : true, addReviewRows(p.rows.map(C.normReview).filter(Boolean))]).then(function () {
          return { cards: p.cards, failed: failed };
        });
      });
    }
    function textStep(bytes, base) {
      var A = window.FlashcardsAnki;
      var text = new TextDecoder("utf-8").decode(bytes);
      var parsed = A.parseText(text);
      if (!parsed.rows.length || !parsed.cols) { say(t("im.badText")); return Promise.resolve(); }
      say("");
      area.textContent = "";
      var cols = [];
      for (var c = 0; c < Math.min(parsed.cols, 30); c++) cols.push([String(c), t("im.col", { n: c + 1 })]);
      var none = [["-1", t("im.none")]];
      area.appendChild(el("p", "hint", t("im.preview")));
      var pre = el("div", "im-preview");
      parsed.rows.slice(0, 4).forEach(function (r) {
        var line = el("div", "im-row");
        r.slice(0, 6).forEach(function (cell, ci) {
          var sp = el("span", "", (ci + 1) + ": " + cell.replace(/\s+/g, " ").slice(0, 60));
          line.appendChild(sp);
        });
        pre.appendChild(line);
      });
      area.appendChild(pre);
      var two = el("div", "two");
      var fc = select(cols, "0"), bc = select(none.concat(cols), parsed.cols > 1 ? "1" : "-1");
      two.appendChild(field("im.colFront", fc));
      two.appendChild(field("im.colBack", bc));
      area.appendChild(two);
      var two2 = el("div", "two");
      var tc = select(none.concat(cols), String(parsed.tagsCol >= 0 && parsed.tagsCol < parsed.cols ? parsed.tagsCol : -1));
      var kc = select([["basic", t("kind.basic")], ["rev", t("kind.rev")]], "basic");
      two2.appendChild(field("im.colTags", tc));
      two2.appendChild(field("f.kind", kc));
      area.appendChild(two2);
      var dk = select([["", t("im.newDeck", { n: base })]].concat(deckOptions(null)), view === "deck" && deckById(curDeck) ? curDeck : "");
      area.appendChild(field("im.deck", dk));
      var hd = el("label", "check");
      var hb = el("input");
      hb.type = "checkbox";
      hb.checked = parsed.cols > 1 && /^(front|back|question|answer|term|definition|word|meaning|\u03bc\u03c0\u03c1\u03bf\u03c3\u03c4\u03ac|\u03c0\u03af\u03c3\u03c9)$/i.test(String(parsed.rows[0][0] || "").trim());
      hd.appendChild(hb);
      hd.appendChild(el("span", "", t("im.header")));
      area.appendChild(hd);
      job = { run: function () {
        var list = A.textNotes(parsed, { front: +fc.value, back: +bc.value, tags: +tc.value, kind: kc.value, header: hb.checked, html: parsed.html });
        var now = Date.now(), deckId = dk.value;
        if (!deckId) { var maker = deckMaker(now); deckId = maker.id([base]); maker.save(); }
        // Same card already here (same type, front and back): left out.
        var have = {};
        C.liveNotes(notes).forEach(function (n) { have[n.k + "\u0000" + C.canon(n.f)] = 1; });
        var dup = 0, out = [];
        list.forEach(function (x, k) {
          var v = C.normNote({ id: C.newId("n", now, k.toString(36) + Math.random().toString(36).slice(2, 6)), m: now, k: x.k, dk: deckId, f: x.f, tg: x.tg });
          if (!v) return;
          var key = v.k + "\u0000" + C.canon(v.f);
          if (have[key]) { dup++; return; }
          have[key] = 1;
          out.push(v);
        });
        if (dup) toast(t("im.dupText", { s: dup }));
        var cards = 0;
        out.forEach(function (v) { cards += C.ords(v).length; });
        return (out.length ? saveNotes(out) : Promise.resolve(true)).then(function () { return { cards: cards, failed: 0, deck: deckId }; });
      } };
      $("dlg-ok").disabled = false;
      return Promise.resolve();
    }
    openDialog(t("dlg.import"), body, {
      okText: t("btn.importNow"),
      ok: function () {
        if (!job || busy) return;
        busy = true;
        $("dlg-ok").disabled = true;
        pick.disabled = true;
        job.run().then(function (r) {
          closeDialog();
          toast(t("im.done", { c: r.cards }) + (r.failed ? " " + t("im.mediaFail", { m: r.failed }) : ""));
          if (r.deck && deckById(r.deck)) openDeck(r.deck); else show("home");
        }, function (e) {
          console.warn("[flashcards] import failed", e);
          say(t("diskFail"));
        }).then(function () { busy = false; pick.disabled = false; });
      },
      onClose: function () { $("dlg-ok").disabled = false; }
    });
    $("dlg-ok").disabled = true;
    pick.focus();
  }

  // ---------- 9. Wiring ----------
  function goBack() {
    if (!$("veil").hidden) { closeDialog(); return; }
    if (view === "browse") { if (br.from === "deck" && curDeck) show("deck"); else show("home"); return; }
    if (view === "study") { flushReviews(); if (curDeck && study.deck) openDeck(study.deck); else show("home"); }
    else if (view === "deck") show("home");
  }
  function wire() {
    $("back-btn").addEventListener("click", goBack);
    $("new-deck-btn").addEventListener("click", function () { deckDialog(""); });
    $("browse-btn").addEventListener("click", function () { openBrowse(view === "deck" ? curDeck : ""); });
    ["br-deck", "br-tag", "br-state"].forEach(function (id) {
      $(id).addEventListener("change", function () { br.shown = 300; renderBrowse(); });
    });
    $("br-q").addEventListener("input", function () { br.shown = 300; renderBrowse(); });
    $("br-more").addEventListener("click", function () { br.shown += 300; renderBrowse(); });
    $("br-all").addEventListener("change", function () {
      var on = $("br-all").checked;
      br.hits.forEach(function (k) { if (on) br.sel[k] = 1; else delete br.sel[k]; });
      renderBrowse();
    });
    $("br-move").addEventListener("click", bulkMove);
    $("br-tagadd").addEventListener("click", function () { bulkTag(true); });
    $("br-tagdel").addEventListener("click", function () { bulkTag(false); });
    $("br-sus").addEventListener("click", function () { bulkFlag("s"); });
    $("br-res").addEventListener("click", function () { bulkFlag("r"); });
    $("br-del").addEventListener("click", bulkDelete);
    $("more-btn").addEventListener("click", function (ev) { ev.stopPropagation(); toggleMenu(); });
    $("bury-btn").addEventListener("click", function () { flagCard("b"); });
    $("suspend-btn").addEventListener("click", function () { flagCard("s"); });
    $("speak-btn").addEventListener("click", speakSide);
    document.addEventListener("click", function (ev) {
      if (!$("study-menu").hidden && !$("study-menu").contains(ev.target)) closeMenu();
    });
    M.onVoices(function () { if (view === "study" && study.key) $("speak-btn").hidden = !M.hasVoices(); });
    $("first-deck-btn").addEventListener("click", function () { deckDialog(""); });
    $("first-import-btn").addEventListener("click", importDialog);
    $("add-card-btn").addEventListener("click", function () { noteDialog(""); });
    $("settings-btn").addEventListener("click", settingsDialog);
    $("study-btn").addEventListener("click", function () { startStudy(curDeck); });
    $("deck-edit-btn").addEventListener("click", function () { deckDialog(curDeck); });
    $("filter").addEventListener("input", function () { shown = 300; renderDeck(); });
    $("more-cards").addEventListener("click", function () { shown += 300; renderDeck(); });
    $("show-btn").addEventListener("click", showAnswer);
    [].forEach.call(document.querySelectorAll("#grade-btns .grade"), function (b) {
      b.addEventListener("click", function () { answer(+b.dataset.g); });
    });
    $("undo-btn").addEventListener("click", undoAnswer);
    $("edit-cur-btn").addEventListener("click", function () {
      var c = sched[study.key];
      if (c) noteDialog(c.note.id);
    });
    $("done-back").addEventListener("click", function () { flushReviews(); show("home"); });
    $("dlg-ok").addEventListener("click", function () { if (dlg && dlg.ok) dlg.ok(); });
    $("dlg-alt").addEventListener("click", function () { if (dlg && dlg.alt) dlg.alt(); });
    $("dlg-del").addEventListener("click", function () { if (dlg && dlg.del) dlg.del(); });
    $("dlg-cancel").addEventListener("click", closeDialog);
    $("veil").addEventListener("click", function (ev) { if (ev.target === $("veil")) closeDialog(); });

    // Contract Β: Ctrl+Alt+Shift belongs to the shell.
    document.addEventListener("keydown", function (e) {
      if (!(e.ctrlKey || e.metaKey) || !e.altKey || !e.shiftKey) return;
      var p = null; try { p = window.parent; } catch (err) { return; }
      if (!(p && p !== window && p.orosShortcuts && typeof p.orosShortcuts.handle === "function")) return;
      if (p.orosShortcuts.handle(e)) e.stopPropagation();
    }, true);
    // App keys (e.code, never e.key).
    document.addEventListener("keydown", function (e) {
      if (e.ctrlKey && e.altKey && e.shiftKey) return;
      if (!$("veil").hidden) {
        if (e.code === "Escape") { e.preventDefault(); closeDialog(); }
        else if (e.code === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); if (dlg && dlg.ok) dlg.ok(); }
        return;
      }
      var tag = (e.target && e.target.tagName) || "";
      if (/^(INPUT|TEXTAREA|SELECT)$/.test(tag)) return;
      if (e.code === "Escape" && !$("study-menu").hidden) { e.preventDefault(); closeMenu(); $("more-btn").focus(); return; }
      if (e.code === "Escape" && view !== "home") { e.preventDefault(); goBack(); return; }
      if (view !== "study") return;
      if ((e.ctrlKey || e.metaKey) && e.code === "KeyZ") { e.preventDefault(); undoAnswer(); return; }
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (!study.key) return;
      if (e.code === "KeyR") { e.preventDefault(); speakSide(); return; }
      if (e.code === "Minus" || e.code === "NumpadSubtract") { e.preventDefault(); flagCard("b"); return; }
      if (/^(BUTTON)$/.test(tag) && $("study-menu").contains(e.target)) return;
      if (!study.back && (e.code === "Space" || e.code === "Enter" || e.code === "NumpadEnter")) { e.preventDefault(); showAnswer(); return; }
      var m = /^(?:Digit|Numpad)([1-4])$/.exec(e.code);
      if (m && study.back) { e.preventDefault(); answer(+m[1]); return; }
      if (study.back && e.code === "Space") { e.preventDefault(); answer(3); }
    });

    // Our answers reach the disk before the frame goes away.
    window.addEventListener("pagehide", flushReviews);
    document.addEventListener("visibilitychange", function () {
      if (document.hidden) flushReviews();
      else loadDisk();
    });
    // Files from other devices: read again after each Vault Drive round.
    try {
      var V = window.parent && window.parent.orosVault;
      if (V && typeof V.onStatus === "function") {
        var off = V.onStatus(function (kind) { if (kind === "done") loadDisk(); });
        window.addEventListener("pagehide", function () { try { off(); } catch (e) {} });
      }
    } catch (e) { /* standalone */ }
  }

  // ---------- 10. Deep link: search hits and other apps ----------
  // target = { deck } | { note } | { study: deckId }. Unknown ids are ignored;
  // nothing happens while a dialog is open (unsaved edits win).
  window.__orosOpenAt = function (target) {
    if (!target || typeof target !== "object" || !$("veil").hidden) return;
    if (typeof target.note === "string") {
      var n = notes[target.note];
      if (!n || n.del) {
        // The disk may still be loading: try once more after it.
        if (loading) loading.then(function () { if (notes[target.note]) window.__orosOpenAt(target); });
        return;
      }
      openDeck(deckById(n.dk) ? n.dk : C.DEFAULT_DECK);
      noteDialog(n.id);
    } else if (typeof target.deck === "string" && (deckById(target.deck) || target.deck === C.DEFAULT_DECK)) {
      openDeck(target.deck);
    } else if (typeof target.study === "string" && (deckById(target.study) || target.study === C.DEFAULT_DECK)) {
      if (loading) loading.then(function () { startStudy(target.study); });
      else startStudy(target.study);
    }
  };
  function takePending() {
    try {
      var p = window.parent;
      if (p && p !== window && typeof p.__orosTakeTarget === "function") {
        var pending = p.__orosTakeTarget(APP_ID);
        if (pending) window.__orosOpenAt(pending);
      }
    } catch (e) { /* standalone */ }
  }

  // ---------- 11. Boot (last, after every declaration) ----------
  function boot() {
    load();
    applyI18n();
    wire();
    registerSync();
    inheritPalette();
    watchPalette();
    show("home");
    loadDisk().then(takePending);
  }
  boot();
})();
