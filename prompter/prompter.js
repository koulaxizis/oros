// ============================================================
// orOS Prompter — App logic (v0.33.05) — Ground-up rewrite

// Writing inspiration, daily prompts, and custom creations —
// all offline, all synced, all yours.
// Sections:
//   1. Constants, i18n, prompts data (100 built-in + 10 categories)
//   1b. Tag system (controlled vocabulary + per-prompt tags)
//   2. Data model + storage (favorites, completed, customs, deleted)
//   2b. Merge engine (union + LWW mtime + tombstone resurrection)
//   3. Views: Browse + Stats (+ streak helper)
//   4. Settings modal
//   5. Sync slice + wiring & boot
// Data:
//   slice "oros-prompter-data" → travels (favorites + completed + customs)
//   DATA_VER 1: fresh start
// ============================================================
(function () {
  "use strict";

  function $(id){ return document.getElementById(id); }  // defensive: harmless if HTML defines its own

  var STORAGE_KEY = "oros-prompter-data";
  var DATA_VER    = 1;

  // ---------- 1. Constants, i18n ----------
  var LANG = localStorage.getItem("oros-lang") === "el" ? "el" : "en";

  var STRINGS = {
    en: {
      "app.title":           "Prompter",
      "browse":              "Browse",
      "stats":               "Statistics",
      "settings":            "Settings",
      "search.placeholder":  "Search prompts...",
      "tag.clear":           "Clear tag filter",
      "cat.all":             "All",
      "cat.micro":           "Micro-fiction",
      "cat.haiku":           "Haiku",
      "cat.poetry.free":     "Free poetry",
      "cat.poetry.metred":   "Metered poetry",
      "cat.song":            "Song",
      "cat.aphorism":        "Aphorism",
      "cat.theatrical":      "Theatrical",
      "cat.novel":           "Novel",
      "cat.monologue":       "Monologue",
      "cat.letter":          "Letter/Diary",
      "badge.fav":           "Favorite",
      "badge.comp":          "Completed",
      "badge.custom":        "Custom",
      "fav.badge":           "★",
      "comp.badge":          "✓",
      "custom.badge":        "✦",
      "btn.use":             "Use",
      "btn.reroll":          "Reroll",
      "btn.copy":            "Copy",
      "btn.toggle":          "Variation",
      "btn.favorite":        "Star",
      "btn.unfavorite":      "Unstar",
      "btn.complete":        "Mark done",
      "btn.uncComplete":     "Undo",
      "btn.daily":           "Today's prompt",
      "daily.pulse":         "New today!",
      "streak.val":          "{n} days in a row",
      "streak.zero":         "No streak yet",
      "stats.total":         "Total prompts",
      "stats.completed":     "Completed",
      "stats.favorites":     "Favorites",
      "stats.customs":       "Customs",
      "stats.streak":        "Day streak",
      "daily.badge":         "Today",
      "stats.progress":      "Progress",
      "by.cat":              "By category",
      "empty.browse":        "No prompts found — adjust your filters.",
      "empty.stats":         "Start using prompts to see your stats.",
      "saved.toast":         "Copied to clipboard",
      "sync.pull":           "Updated from sync",
      "rst.btn":             "Factory reset",
      "rst.body":            "This permanently erases ALL custom prompts, favorites, and completed marks on every synced device. There is no undo.",
      "rst.yes":             "Erase everything",
      "rst.cancel":          "Cancel",
      "rst.done":            "Fresh start — everything erased",
      "settings.title":      "Settings",
      "settings.close":      "Close",
      "custom.new":           "New prompt",
      "custom.mine":          "✦ Mine",
      "custom.edit":          "Edit",
      "custom.delete":        "Delete",
      "custom.confirmDel":    "Delete this custom prompt? No undo.",
      "editor.title.new":     "New custom prompt",
      "editor.title.edit":    "Edit custom prompt",
      "editor.cat":           "Category",
      "editor.en":            "English text",
      "editor.el":            "Greek text",
      "editor.varEn":         "Variation (EN) — optional",
      "editor.varEl":         "Variation (EL) — optional",
      "editor.tags":          "Tags (comma separated) — optional",
      "editor.save":          "Save",
      "editor.cancel":        "Cancel",
      "custom.saved":         "Custom prompt saved",
      "custom.deleted":       "Custom prompt deleted",
      "editor.errEmpty":      "Both language fields are required"
    },
    el: {
      "app.title":           "Γεννήτρια θεμάτων",
      "browse":              "Αναζήτηση",
      "stats":               "Στατιστικά",
      "settings":            "Ρυθμίσεις",
      "search.placeholder":  "Αναζήτηση θεμάτων...",
      "tag.clear":           "Καθαρισμός φίλτρου",
      "cat.all":             "Όλα",
      "cat.micro":           "Μικροϊστορίες",
      "cat.haiku":           "Χάικου",
      "cat.poetry.free":     "Ελεύθερο ποίημα",
      "cat.poetry.metred":   "Μετρική ποίηση",
      "cat.song":            "Τραγούδι",
      "cat.aphorism":        "Αφορισμός",
      "cat.theatrical":      "Θεατρικό",
      "cat.novel":           "Μυθιστόρημα",
      "cat.monologue":       "Μονόλογος",
      "cat.letter":          "Επιστολή/Ημερολόγιο",
      "badge.fav":           "Αγαπημένο",
      "badge.comp":          "Ολοκληρωμένο",
      "badge.custom":        "Δικό μου",
      "fav.badge":           "★",
      "comp.badge":          "✓",
      "custom.badge":        "✦",
      "btn.use":             "Χρήση",
      "btn.reroll":          "Επανάληψη",
      "btn.copy":            "Αντιγραφή",
      "btn.toggle":          "Παραλλαγή",
      "btn.favorite":         "Αγαπημένο",
      "btn.unfavorite":      "Αφαίρεση",
      "btn.complete":        "Ολοκλήρωσα",
      "btn.uncComplete":     "Αναίρεση",
      "btn.daily":           "Σημερινό θέμα",
      "daily.pulse":         "Καινούργιο σήμερα!",
      "streak.val":          "{n} συνεχόμενες ημέρες",
      "streak.zero":         "Δεν έχει ακόμα σειρά",
      "stats.total":         "Σύνολο θεμάτων",
      "stats.completed":     "Ολοκληρωμένα",
      "stats.favorites":     "Αγαπημένα",
      "stats.customs":       "Δικά μου",
      "stats.streak":        "Σειρά ημερών",
      "daily.badge":         "Σήμερα",
      "stats.progress":      "Πρόοδος",
      "by.cat":              "Ανά κατηγορία",
      "empty.browse":        "Δεν βρέθηκαν θέματα — προσαρμόστε τα φίλτρα.",
      "empty.stats":         "Ξεκινήστε να χρησιμοποιείτε θέματα για να δείτε στατιστικά.",
      "saved.toast":         "Αντιγράφηκε στο πρόχειρο",
      "sync.pull":           "Ενημερώθηκε από συγχρονισμό",
      "rst.btn":             "Επαναφορά εργοστασιακών",
      "rst.body":            "Θα διαγραφούν ΟΛΑ τα custom θέματα, αγαπημένα και σημεία ολοκλήρωσης από κάθε συγχρονισμένη συσκευή. Χωρίς αναίρεση.",
      "rst.yes":             "Σβήσε τα όλα",
      "rst.cancel":          "Ακύρωση",
      "rst.done":            "Καθαρή αρχή — όλα διαγράφτηκαν",
      "settings.title":      "Ρυθμίσεις",
      "settings.close":      "Κλείσιμο",
      "custom.new":           "Νέο θέμα",
      "custom.mine":          "✦ Δικά μου",
      "custom.edit":          "Επεξεργασία",
      "custom.delete":        "Διαγραφή",
      "custom.confirmDel":    "Να διαγραφεί το custom θέμα; Χωρίς αναίρεση.",
      "editor.title.new":     "Νέο custom θέμα",
      "editor.title.edit":    "Επεξεργασία custom θέματος",
      "editor.cat":           "Κατηγορία",
      "editor.en":            "Αγγλικό κείμενο",
      "editor.el":            "Ελληνικό κείμενο",
      "editor.varEn":         "Παραλλαγή (EN) — προαιρετικά",
      "editor.varEl":         "Παραλλαγή (EL) — προαιρετικά",
      "editor.tags":          "Tags (με κόμμα) — προαιρετικά",
      "editor.save":          "Αποθήκευση",
      "editor.cancel":        "Ακύρωση",
      "custom.saved":         "Το θέμα αποθηκεύτηκε",
      "custom.deleted":       "Το θέμα διαγράφηκε",
      "editor.errEmpty":      "Χρειάζονται και οι δύο γλώσσες"
    }
  };

  function t(key) {
    var p = STRINGS[LANG] || STRINGS.en;
    return p[key] !== undefined ? p[key]
         : (STRINGS.en[key] !== undefined ? STRINGS.en[key] : key);
  }

  // Category map — 10 categories, bilingual display names
  var CATEGORIES = [
    { id: "all",      en: "All",          el: "Όλα" },
    { id: "micro",    en: "Micro-fiction", el: "Μικροϊστορίες" },
    { id: "haiku",    en: "Haiku",        el: "Χάικου" },
    { id: "poetry_free", en: "Free poetry", el: "Ελεύθερο ποίημα" },
    { id: "poetry_metred", en: "Metered poetry", el: "Μετρική ποίηση" },
    { id: "song",     en: "Song",         el: "Τραγούδι" },
    { id: "aphorism", en: "Aphorism",     el: "Αφορισμός" },
    { id: "theatrical", en: "Theatrical",  el: "Θεατρικό" },
    { id: "novel",    en: "Novel",        el: "Μυθιστόρημα" },
    { id: "monologue", en: "Monologue",   el: "Μονόλογος" },
    { id: "letter",   en: "Letter/Diary", el: "Επιστολή/Ημερολόγιο" }
  ];

  function catLabel(cid) {
    for (var i = 0; i < CATEGORIES.length; i++) {
      if (CATEGORIES[i].id === cid) return t("cat." + cid);
    }
    return cid;
  }
  
    // BUILT-IN PROMPTS — 100 entries, EN corrected, EL handwritten.
  // No fetch, embedded data only.
  // Each prompt: {id, cat, en, el, var_en, var_el (optional)}
  // IDs: p001–p100 for built-ins, cXXX for customs (uid() at creation)
  var PROMPTS_DATA = [
    {id: "p001", cat: "micro", en: "Write a story in exactly 50 words about a door that shouldn't be opened.", el: "Γράψε μια ιστορία σε ακριβώς 50 λέξεις για μια πόρτα που δεν έπρεπε να ανοίξει.", var_en: "Without ever using the word 'door'", var_el: "Να μη χρησιμοποιήσεις ούτε μία φορά τη λέξη «πόρτα»"},
    {id: "p002", cat: "micro", en: "A child finds a key in their lunchbox. What happens next?", el: "Ένα παιδί βρίσκει ένα κλειδί στο κουτί του γεύματός του. Τι συμβαίνει μετά;", var_en: "Make it exactly 75 words", var_el: "Σε ακριβώς 75 λέξεις"},
    {id: "p003", cat: "micro", en: "Two strangers meet on a train platform. They recognize each other from a dream.", el: "Δύο άγνωστοι συναντιούνται σε μια αποβάθρα. Αναγνωρίζουν ο ένας τον άλλον από ένα όνειρο.", var_en: "No dialogue allowed", var_el: "Χωρίς κανέναν διάλογο"},
    {id: "p004", cat: "micro", en: "Describe a sunset from the perspective of someone who has never seen one.", el: "Περιγράψε ένα ηλιοβασίλεμα με τα μάτια κάποιου που το βλέπει για πρώτη φορά.", var_en: "Without naming any colours", var_el: "Χωρίς να αναφέρεις ούτε ένα χρώμα"},
    {id: "p005", cat: "haiku", en: "Write a haiku about the silence between two people.", el: "Γράψε ένα χαϊκού για τη σιωπή ανάμεσα σε δύο ανθρώπους.", var_en: "No verbs", var_el: "Χωρίς ρήματα"},
    {id: "p006", cat: "haiku", en: "Capture the moment when rain stops and birds resume singing.", el: "Σύλλαβε τη στιγμή που κόβει η βροχή και τα πουλιά ξαναρχίζουν το τραγούδι τους.", var_en: "Never mention the rain itself", var_el: "Η βροχή να μη μπαίνει ποτέ στο ποίημα"},
    {id: "p007", cat: "haiku", en: "Three lines about an empty chair at dinner.", el: "Τρεις στίχοι για μια άδεια καρέκλα στο τραπέζι του δείπνου.", var_en: "Each line anchored in one single sense", var_el: "Κάθε στίχος βασισμένος σε μία μόνο αίσθηση"},
    {id: "p008", cat: "poetry_free", en: "Free verse about a letter you'll never send.", el: "Ελεύθερος στίχος για μια επιστολή που δεν θα σταλεί ποτέ.", var_en: "Written entirely in second person", var_el: "Ολόκληρο σε δεύτερο πρόσωπο"},
    {id: "p009", cat: "poetry_free", en: "Write about memory fading like old photographs.", el: "Γράψε για τη μνήμη που ξεθωριάζει, σαν παλιές φωτογραφίες.", var_en: "One phrase returns three times, slightly changed", var_el: "Μία φράση να επανέρχεται τρεις φορές, αλλάζοντας λίγο κάθε φορά"},
    {id: "p010", cat: "poetry_free", en: "Poem about returning to a childhood home that no longer exists.", el: "Ποίημα για την επιστροφή σε ένα παιδικό σπίτι που δεν υπάρχει πια.", var_en: "The house itself speaks", var_el: "Το ποίημα να το λέει το ίδιο το σπίτι"},
    {id: "p011", cat: "poetry_metred", en: "Write a sonnet about loss in iambic pentameter.", el: "Γράψε ένα σονέτο για την απώλεια σε ιαμβικό πεντάμετρο.", var_en: "The final line ends on a dash —", var_el: "Ο τελευταίος στίχος να τελειώνει με παύλα —"},
    {id: "p012", cat: "poetry_metred", en: "Ten lines of rhyming couplets about hope.", el: "Δέκα στίχοι σε ομοιοκατάληκτα δίστιχα για την ελπίδα.", var_en: "The final couplet reverses everything before it", var_el: "Το τελευταίο δίστιχο να ανατρέπει όσα προηγήθηκαν"},
    {id: "p013", cat: "poetry_metred", en: "A villanelle about waiting.", el: "Μια βιλανέλ για την αναμονή.", var_en: "It must open and close on the same word", var_el: "Να ξεκινά και να τελειώνει με την ίδια λέξη"},
    {id: "p014", cat: "song", en: "Lyrics for a song about leaving your hometown.", el: "Στίχοι για ένα τραγούδι για την ώρα που φεύγεις από την πατρίδα.", var_en: "The chorus means something different each time it returns", var_el: "Το ρεφρέν να σημαίνει κάτι διαφορετικό κάθε φορά που επανέρχεται"},
    {id: "p015", cat: "song", en: "Write a bridge section that reveals a secret.", el: "Γράψε ένα bridge που αποκαλύπτει ένα μυστικό.", var_en: "Six lines maximum", var_el: "Έξι γραμμές το πολύ"},
    {id: "p016", cat: "song", en: "A ballad about a sailor who lost his way.", el: "Μια μπαλάντα για έναν ναύτη που έχασε τον δρόμο του γυρισμού.", var_en: "The sailor never appears — only traces of him", var_el: "Ο ναύτης να μην εμφανίζεται ποτέ — μόνο τα ίχνη του"},
    {id: "p017", cat: "aphorism", en: "Compose an aphorism about truth and lies.", el: "Γράψε έναν αφορισμό για την αλήθεια και το ψέμα.", var_en: "Under 15 words", var_el: "Το πολύ 15 λέξεις"},
    {id: "p018", cat: "aphorism", en: "Write something that sounds wise but isn't.", el: "Γράψε κάτι που ακούγεται σοφό — αλλά δεν είναι.", var_en: "Sign it as your own", var_el: "Να το υπογράψεις σαν δικό σου"},
    {id: "p019", cat: "aphorism", en: "An aphorism about forgiveness that forgives nothing.", el: "Αφορισμός για μια συγχώρεση που δεν συγχωρεί τίποτα.", var_en: "Spoken in second person singular", var_el: "Σε δεύτερο ενικό"},
    {id: "p020", cat: "theatrical", en: "Monologue where a character confesses their greatest mistake.", el: "Μονόλογος όπου ένας χαρακτήρας εξομολογείται το μεγαλύτερό του λάθος.", var_en: "We never learn what it was", var_el: "Να μη μάθουμε ποτέ τι ήταν"},
    {id: "p021", cat: "theatrical", en: "Scene where two actors forget their lines mid-performance.", el: "Σκηνή όπου δύο ηθοποιοί ξεχνούν τους στίχους τους στη μέση μιας παράστασης.", var_en: "They try to improvise through silence", var_el: "Προσπαθούν να προχωρήσουν μέσω της σιωπής"},
    {id: "p022", cat: "theatrical", en: "Dialogue between someone arriving and someone leaving.", el: "Διάλογος ανάμεσα σε κάποιον που μόλις έφτασε και κάποιον που φεύγει.", var_en: "Neither speaks more than six words", var_el: "Κανείς δεν μιλάει πάνω από έξι λέξεις"},
    {id: "p023", cat: "novel", en: "Opening paragraph of a mystery novel set in a small town.", el: "Εναρκτήρια παράγραφος αστυνομικού μυθιστορήματος σε μια μικρή πόλη.", var_en: "The narrator is unreliable from the first sentence", var_el: "Ο αφηγητής είναι αναξιόπιστος από την πρώτη πρόταση"},
    {id: "p024", cat: "novel", en: "Describe a protagonist who lies about their past.", el: "Περιγραφή ενός πρωταγωνιστή που λέει ψέματα για το παρελθόν του.", var_en: "Only show us the truth indirectly", var_el: "Να βλέπουμε την αλήθεια μόνο έμμεσα"},
    {id: "p025", cat: "novel", en: "Write a chapter about discovering a family secret.", el: "Γράψε ένα κεφάλαιο για την ανακάλυψη ενός οικογενειακού μυστικού.", var_en: "The discovery changes nothing immediately", var_el: "Η ανακάλυψη δεν αλλάζει τίποτα αμέσως"},
    {id: "p026", cat: "monologue", en: "Address the audience directly about betrayal.", el: "Μίλα απευθείας στο κοινό για μια προδοσία.", var_en: "You never explain what was betrayed", var_el: "Να μην εξηγήσεις ποτέ τι προδώθηκε"},
    {id: "p027", cat: "monologue", en: "A soliloquy about being trapped in your own mind.", el: "Εσωτερικός μονόλογος για την παγίδα μέσα στον ίδιο σου τον νου.", var_en: "Three voices speak — one is yours", var_el: "Τρεις φωνές μιλάνε — μία από αυτές είναι η δική σου"},
    {id: "p028", cat: "monologue", en: "Speak to your younger self about mistakes.", el: "Μίλα στον νεαρότερο εαυτό σου για λάθη.", var_en: "Never say sorry", var_el: "Να μην πεις ποτέ «συγγνώμη»"},
    {id: "p029", cat: "letter", en: "Write a letter to your future self ten years from now.", el: "Γράψε μια επιστολή στον εαυτό σου σε δέκα χρόνια.", var_en: "Include something you hope is no longer true", var_el: "Να περιλαμβάνει κάτι που ελπίζεις πως δεν θα ισχύει πια"},
    {id: "p030", cat: "letter", en: "Diary entry on the day everything changed.", el: "Ημερολογιακή εγγραφή της ημέρας που όλα άλλαξαν.", var_en: "Nothing dramatic happens in the entry itself", var_el: "Τίποτα δραματικό να μην συμβεί στην ίδια την εγγραφή"},
    {id: "p031", cat: "micro", en: "Someone wakes up and realizes they're living in a story they wrote.", el: "Κάποιος ξυπνά και συνειδητοποιεί ότι ζει μέσα σε μια ιστορία που έγραψε ο ίδιος.", var_en: "They try to edit reality", var_el: "Προσπαθεί να επεξεργαστεί την πραγματικότητα"},
    {id: "p032", cat: "micro", en: "A photograph develops backwards in a darkroom.", el: "Μια φωτογραφία εμφανίζεται ανάποδα στο σκοτεινό δωμάτιο.", var_en: "What appears first is what disappears last", var_el: "Τι φαίνεται πρώτο — είναι αυτό που χάνεται τελευταίο"},
    {id: "p033", cat: "micro", en: "You find your own name carved on a tree you've never visited.", el: "Βρίσκεις το όνομά σου χαραγμένο σε ένα δέντρο που ποτέ δεν είχες δει.", var_en: "The carving looks ancient", var_el: "Το χάραγμα να μοιάζει πανάρχαιο"},
    {id: "p034", cat: "haiku", en: "Snow falling on a sleeping dog.", el: "Χιόνι πέφτει πάνω σε ένα κοιμισμένο σκυλί.", var_en: "Never mention the cold", var_el: "Καμία αναφορά στο κρύο"},
    {id: "p035", cat: "haiku", en: "Coffee cup cooling on a desk.", el: "Φλιτζάνι καφέ να κρυώνει σε ένα γραφείο.", var_en: "The steam is the main character", var_el: "Ο ατμός να είναι ο κύριος χαρακτήρας"},
    {id: "p036", cat: "haiku", en: "The sound of pages turning at night.", el: "Ο ήχος από σελίδες που γυρίζουν τη νύχτα.", var_en: "No human presence ever stated", var_el: "Καμία ανθρώπινη παρουσία να μην αναφερθεί"},
    {id: "p037", cat: "poetry_free", en: "About a voice that stopped answering.", el: "Για μια φωνή που σταμάτησε να απαντά.", var_en: "Written as a voicemail transcript", var_el: "Σαν απομαγνητοφώνηση τηλεφωνητή"},
    {id: "p038", cat: "poetry_free", en: "What remains after a fire burns through memory.", el: "Τι μένει όταν μια φωτιά έχει καεί μέσα στη μνήμη.", var_en: "Three repeated fragments throughout", var_el: "Τρία επαναλαμβανόμενα αποσπάσματα σε όλο το ποίημα"},
    {id: "p039", cat: "poetry_free", en: "Grief expressed as a physical object.", el: "Πένθος εκφρασμένο ως υλικό αντικείμενο.", var_en: "The object weighs more than it should", var_el: "Το αντικείμενο ζυγίζει περισσότερο από όσο θα έπρεπε"},
    {id: "p040", cat: "poetry_metred", en: "Elegy in blank verse for someone who never knew your name.", el: "Επιτάφιο σε λευκό στίχο για κάποιον που ποτέ δεν έμαθε το όνομά σου.", var_en: "Eleven syllables per line exactly", var_el: "Ακριβώς ένδεκα συλλαβές ανά στίχο"},
    {id: "p041", cat: "poetry_metred", en: "Ballad meter about a journey that went wrong.", el: "Μπαλάντα για ένα ταξίδι που πήγε στραβά.", var_en: "Each stanza ends on an unresolved note", var_el: "Κάθε στροφή να τελειώνει σε ανολοκλήρωτο τόνο"},
    {id: "p042", cat: "poetry_metred", en: "Ode to something ordinary made extraordinary.", el: "Ωδή σε κάτι συνηθισμένο που έγινε εξαιρετικό.", var_en: "The subject must be something mundane", var_el: "Θέμα να είναι κάτι καθημερινό"},
    {id: "p043", cat: "song", en: "Chorus about coming home to a place that's forgotten you.", el: "Ρεφρέν για την επιστροφή σε μέρος που σε έχει ξεχάσει.", var_en: "The chorus repeats three times with different meanings", var_el: "Το ρεφρέν να επαναληφθεί τρεις φορές με διαφορετική σημασία"},
    {id: "p044", cat: "song", en: "Verse describing a crime without revealing who did it.", el: "Στίχος που περιγράφει έγκλημα χωρίς να αποκαλύπτει τον δράστη.", var_en: "Only witnesses speak", var_el: "Μιλάει μόνο ο μάρτυρας"},
    {id: "p045", cat: "song", en: "Anthem for the quietly defeated.", el: "Ύμνος για τους ήσυχα ηττημένους.", var_en: "Everyone sings except the singer", var_el: "Όλοι τραγουδούν — εκτός από τον τραγουδιστή"},
    {id: "p046", cat: "aphorism", en: "About wisdom gained through suffering.", el: "Για τη σοφία που κερδίζεται μέσω του πόνου.", var_en: "Sounds comforting but isn't", var_el: "Ακούγεται παρηγορητικό — αλλά δεν είναι"},
    {id: "p047", cat: "aphorism", en: "A paradox about freedom and chains.", el: "Ένα παράδοξο για ελευθερία και αλυσίδες.", var_en: "Shorter than five words", var_el: "Λιγότερο από πέντε λέξεις"},
    {id: "p048", cat: "aphorism", en: "Something true spoken as a lie.", el: "Κάτι αληθινό ειπωμένο ως ψέμα.", var_en: "The listener believes it anyway", var_el: "Ο ακροατής το πιστεύει παρ' όλα αυτά"},
    {id: "p049", cat: "theatrical", en: "Two characters arguing over something that doesn't matter.", el: "Δύο χαρακτήρες μαλώνουν για κάτι που δεν έχει καμία σημασία.", var_en: "Both are right and both are wrong", var_el: "Και οι δύο έχουν δίκιο και άδικο ταυτόχρονα"},
    {id: "p050", cat: "theatrical", en: "A play within a play scene where reality blurs.", el: "Σκηνή «παιχνίδι μέσα στο παιχνίδι» όπου θολώνει η πραγματικότητα.", var_en: "The actors break character halfway", var_el: "Οι ηθοποιοί διακόπτουν τον χαρακτήρα τους στη μέση"},
    {id: "p051", cat: "theatrical", en: "Final curtain line that changes everything.", el: "Η τελευταία φράση της αυλαίας αλλάζει τα πάντα.", var_en: "It undermines the entire performance", var_el: "Να ανατρέπει ολόκληρη την παράσταση"},
    {id: "p052", cat: "novel", en: "Flashback that contradicts what we thought was true.", el: "Αναδρομή που αντιφάσκει με ό,τι νομίζαμε ότι ήταν αλήθεια.", var_en: "No one acknowledges the contradiction", var_el: "Κανείς να μην αναγνωρίσει την αντίφαση"},
    {id: "p053", cat: "novel", en: "A character discovers they're a minor in someone else's story.", el: "Ένας χαρακτήρας ανακαλύπτει ότι είναι δευτερεύων στην ιστορία κάποιου άλλου.", var_en: "They try to escape the narrative", var_el: "Προσπατεί να δραπετεύσει από την αφήγηση"},
    {id: "p054", cat: "novel", en: "Setting described through sensory deprivation.", el: "Περιβάλλον περιγραφόμενο μέσω στέρησης αισθήσεων.", var_en: "Never describe what IS present", var_el: "Να μην περιγράψεις ποτέ τι υπάρχει"},
    {id: "p055", cat: "monologue", en: "Confronting a ghost from your past.", el: "Σύγκρουση με ένα φάντασμα από το παρελθόν σου.", var_en: "The ghost never speaks", var_el: "Το φάντασμα να μην μιλήσει ποτέ"},
    {id: "p056", cat: "monologue", en: "Explaining why you can't forgive someone.", el: "Εξήγηση γιατί δεν μπορείς να συγχωρέσεις κάποιον.", var_en: "The reason is selfish", var_el: "Ο λόγος να είναι εγωιστικός"},
    {id: "p057", cat: "monologue", en: "Talking to the mirror about who you've become.", el: "Μιλώντας στον καθρέφτη για το ποιος έγινες.", var_en: "The reflection lies back", var_el: "Η αντανάκλαση να ψεύδεται πίσω"},
    {id: "p058", cat: "letter", en: "Apology letter sent too late.", el: "Επιστολή συγγνώμης που στάλθηκε πολύ αργά.", var_en: "The recipient is already dead", var_el: "Ο παραλήπτης είναι ήδη νεκρός"},
    {id: "p059", cat: "letter", en: "Love letter you'll bury with you.", el: "Ερωτική επιστολή που θα θαφτεί μαζί σου.", var_en: "Never addressed to anyone", var_el: "Να μην απευθύνεται σε κανέναν"},
    {id: "p060", cat: "letter", en: "Journal entry before making an irreversible choice.", el: "Ημερολογιακή εγγραφή πριν πάρεις μια μη αναστρέψιμη απόφαση.", var_en: "You don't know what choice it is", var_el: "Δεν ξέρεις ποια είναι η επιλογή"},
    {id: "p061", cat: "micro", en: "Your shadow detaches and walks away.", el: "Η σκιά σου ξεκολλάει και φεύγει περπατώντας.", var_en: "You can't catch it", var_el: "Δεν μπορείς να την πιάσεις"},
    {id: "p062", cat: "micro", en: "A clock that counts backwards.", el: "Ένα ρολόι που μετράει προς τα πίσω.", var_en: "It's counting down to nothing", var_el: "Μετράει προς το τίποτα"},
    {id: "p063", cat: "micro", en: "Meeting yourself from parallel universe.", el: "Συνάντηση με τον εαυτό σου από παράλληλο σύμπαν.", var_en: "Neither is surprised", var_el: "Κανείς δεν εκπλήσσεται"},
    {id: "p064", cat: "haiku", en: "Footsteps fading down a hallway.", el: "Βήματα που εξασθενούν μέσα σε διάδρομο.", var_en: "The source is never shown", var_el: "Η πηγή να μην φαίνεται ποτέ"},
    {id: "p065", cat: "haiku", en: "Window fogged by winter breath.", el: "Παράθυρο θολό από χειμωνιάτικη ανάσα.", var_en: "Condensation draws a face", var_el: "Ο ατμός να ζωγραφίζει πρόσωπο"},
    {id: "p066", cat: "haiku", en: "First light touching empty room.", el: "Πρώτο φως που ακουμπά άδειο δωμάτιο.", var_en: "Dust particles become stars", var_el: "Τα σωματίδια σκόνης να γίνουν άστρα"},
    {id: "p067", cat: "poetry_free", en: "Language breaking down at the edge of meaning.", el: "Γλώσσα που διαλύεται στο χείλος της σημασίας.", var_en: "Words dissolve mid-sentence", var_el: "Λέξεις να διαλύονται στη μέση του στίχου"},
    {id: "p068", cat: "poetry_free", en: "Body as landscape of memory.", el: "Σώμα ως τοπίο μνήμης.", var_en: "Scars are geographical features", var_el: "Τα σημάδια να είναι γεωγραφικά χαρακτηριστικά"},
    {id: "p069", cat: "poetry_free", en: "Silence louder than any scream.", el: "Σιωπή πιο δυνατή από κάθε κραυγή.", var_en: "No description of the silence itself", var_el: "Καμία περιγραφή της ίδιας της σιωπής"},
    {id: "p070", cat: "poetry_metred", en: "Limerick series about absurd fears.", el: "Σειρά λίμερικ για παράλογους φόβους.", var_en: "All five limericks rhyme the same", var_el: "Και τα πέντε λίμερικ να ομοιοκαταληκτούν με τον ίδιο τρόπο"},
    {id: "p071", cat: "poetry_metred", en: "Pantoum about repeating patterns.", el: "Παντούμ για επαναλαμβανόμενα μοτίβα.", var_en: "Meaning reverses each repetition", var_el: "Η σημασία να αντιστρέφεται σε κάθε επανάληψη"},
    {id: "p072", cat: "poetry_metred", en: "Sestina about six lost things.", el: "Σεστίνα για έξι χαμένα αντικείμενα.", var_en: "The six words spiral toward nothing", var_el: "Οι έξι λέξεις να περιστρέφουν προς το τίποτα"},
    {id: "p073", cat: "song", en: "Love song from the wrong person's perspective.", el: "Τραγούδι αγάπης από τη λάθος οπτική.", var_en: "The beloved never knew", var_el: "Ο/η αγαπημένος/η δεν το έμαθε ποτέ"},
    {id: "p074", cat: "song", en: "Work song for people who dig holes.", el: "Τραγούδι εργασίας για ανθρώπους που σκάβουν τρύπες.", var_en: "The rhythm matches digging strokes", var_el: "Ο ρυθμός να ακολουθεί τους χτύπους του φτυαριού"},
    {id: "p075", cat: "song", en: "Lullaby for grown children who left.", el: "Νανούρισμα για ενήλικα παιδιά που έφυγαν.", var_en: "Sung backwards", var_el: "Τραγουδημένο ανάποδα"},
    {id: "p076", cat: "aphorism", en: "On beauty and its cruelty.", el: "Για την ομορφιά και την ωμότητά της.", var_en: "Beauty wins at the end", var_el: "Η ομορφιά να κερδίζει στο τέλος"},
    {id: "p077", cat: "aphorism", en: "What we owe to those who can't thank us.", el: "Τι οφείλουμε σε όσους δεν μπορούν να μας ευχαριστήσουν.", var_en: "The debt grows", var_el: "Το χρέος να μεγαλώνει"},
    {id: "p078", cat: "aphorism", en: "The cost of staying silent.", el: "Το κόστος της σιωπής.", var_en: "Calculate it in years", var_el: "Υπολόγισέ το σε χρόνια"},
    {id: "p079", cat: "theatrical", en: "Trial scene where guilt is assumed.", el: "Σκηνή δίκης όπου η ενοχή υποτίθεται.", var_en: "The defense is not for innocence", var_el: "Η άμυνα να μην είναι για αθωότητα"},
    {id: "p080", cat: "theatrical", en: "Comedy of misunderstandings ending badly.", el: "Κωμωδία παρεξηγήσεων που καταλήγει άσχημα.", var_en: "Nobody learns anything", var_el: "Κανείς να μην μάθει τίποτα"},
    {id: "p081", cat: "theatrical", en: "Horror revealed through absence, not presence.", el: "Τρόμος αποκαλύπτεται μέσω απουσίας, όχι παρουσίας.", var_en: "The missing thing is never named", var_el: "Το χαμένο αντικείμενο να μην ονομαστεί ποτέ"},
    {id: "p082", cat: "novel", en: "Narrator unreliable from the first sentence.", el: "Αφηγητής αναξιόπιστος από την πρώτη πρόταση.", var_en: "The truth emerges in contradictions", var_el: "Η αλήθεια να αναδυθεί μέσα στις αντιφάσεις"},
    {id: "p083", cat: "novel", en: "World rebuilt after everyone forgot.", el: "Κόσμος ανοικοδομημένος αφού όλοι ξέχασαν.", var_en: "Old ruins remain unexplained", var_el: "Τα παλιά ερείπια να παραμένουν ανεξήγητα"},
    {id: "p084", cat: "novel", en: "Time travel consequences discovered generations later.", el: "Συνέπειες ταξιδιού χρόνου που ανακαλύπτονται γενιές μετά.", var_en: "No one connects them to the past", var_el: "Κανείς να μην τις συνδέσει με το παρελθόν"},
    {id: "p085", cat: "monologue", en: "Prayer said without belief.", el: "Προσευχή ειπωμένη χωρίς πίστη.", var_en: "Answered anyway", var_el: "Απαντημένη παρ' όλα αυτά"},
    {id: "p086", cat: "monologue", en: "Threat disguised as a compliment.", el: "Απειλή μεταμφιεσμένη ως έπαινος.", var_en: "Delivered with a smile", var_el: "Ειπωμένη με ένα χαμόγελο"},
    {id: "p087", cat: "monologue", en: "Last words before jumping.", el: "Τελευταία λόγια πριν πηδήξει.", var_en: "They're an apology to someone else", var_el: "Να είναι συγγνώμη προς κάποιον άλλο"},
    {id: "p088", cat: "letter", en: "Resignation letter with no reason given.", el: "Επιστολή παραίτησης χωρίς να δίνεται λόγος.", var_en: "The employer already knows why", var_el: "Ο εργοδότης έχει ήδη καταλάβει"},
    {id: "p089", cat: "letter", en: "Proposal written to someone who can't read.", el: "Πρόταση γραμμένη σε κάποιον που δεν διαβάζει.", var_en: "Written in Braille", var_el: "Γραμμένη σε μπραϊγ"},
    {id: "p090", cat: "letter", en: "Receipt of something priceless mailed by accident.", el: "Απόδειξη για κάτι ανεκτίμητο που στάλθηκε κατά λάθος.", var_en: "The sender wants it back", var_el: "Ο αποστολέας το θέλει πίσω"},
    {id: "p091", cat: "micro", en: "Plant growing inside a locked safe.", el: "Φυτό που φυτρώνει μέσα σε κλειστό θησαυροφυλάκιο.", var_en: "No light enters", var_el: "Καμία φάση φωτός να μην μπαίνει"},
    {id: "p092", cat: "micro", en: "Mirror reflecting something that isn't there.", el: "Καθρέφτης που αντανακλά κάτι που δεν υπάρχει.", var_en: "The reflection moves independently", var_el: "Η αντανάκλαση να κινείται ανεξάρτητα"},
    {id: "p093", cat: "micro", en: "Whisper heard in an empty building.", el: "Ψιθυριστό που ακούγεται σε άδειο κτίριο.", var_en: "Multiple voices overlap", var_el: "Πολλές φωνές να επικαλύπτονται"},
    {id: "p094", cat: "haiku", en: "Dust motes dancing in sunlight.", el: "Σκόνη που χορεύει στο ηλιακό φως.", var_en: "Time stands still", var_el: "Ο χρόνος να σταματήσει"},
    {id: "p095", cat: "haiku", en: "Door slowly closing on its own.", el: "Πόρτα που κλείνει αργά από μόνη της.", var_en: "Nobody touched it", var_el: "Κανείς να μην την ακούμπησε"},
    {id: "p096", cat: "haiku", en: "Tea gone cold on the table.", el: "Τσάι κρύο στο τραπέζι.", var_en: "The cup is half-full", var_el: "Το φλιτζάνι να είναι μισογεμάτο"},
    {id: "p097", cat: "poetry_free", en: "Bodies remembered in scars.", el: "Σώματα θυμόμαστε στα σημάδια.", var_en: "Each scar tells a different story", var_el: "Κάθε σημάδι να λέει άλλη ιστορία"},
    {id: "p098", cat: "poetry_free", en: "Names erased from headstones.", el: "Ονόματα σβησμένα από ταφικά μνημεία.", var_en: "Wind remembers them", var_el: "Ο άνεμος να τα θυμάται"},
    {id: "p099", cat: "poetry_free", en: "Hunger disguised as appetite.", el: "Πείνα μεταμφιεσμένη ως όρεξη.", var_en: "Food goes untouched", var_el: "Το φαγητό να μένει ανέγγιχτο"},
    {id: "p100", cat: "poetry_free", en: "Everything you wanted to say in one breath.", el: "Όλα όσα ήθελες να πεις σε μια ανάσα.", var_en: "Cut off before completion", var_el: "Να διακοπεί πριν ολοκληρωθεί"}
  ];
  
    // ---------- 1b. Tag system ----------
  // Controlled vocabulary (57 tags). Every tag below exists in TAG_LABELS
  // and every PROMPT_TAGS id references a valid key — zero orphans by design.
  var TAG_LABELS = {
    absence:   { en: "Absence",       el: "Απουσία" },
    betrayal:  { en: "Betrayal",      el: "Προδοσία" },
    body:      { en: "Body",          el: "Σώμα" },
    childhood: { en: "Childhood",     el: "Παιδικά χρόνια" },
    comedy:    { en: "Comedy",        el: "Κωμωδία" },
    confession:{ en: "Confession",   el: "Εξομολόγηση" },
    crime:     { en: "Crime",         el: "Έγκλημα" },
    death:     { en: "Death",         el: "Θάνατος" },
    doubt:     { en: "Doubt",         el: "Αμφιβολία" },
    dream:     { en: "Dream",         el: "Όνειρο" },
    everyday:  { en: "Everyday",      el: "Καθημερινότητα" },
    faith:     { en: "Faith",         el: "Πίστη" },
    family:    { en: "Family",        el: "Οικογένεια" },
    farewell:  { en: "Farewell",      el: "Αποχαιρετισμός" },
    fear:      { en: "Fear",          el: "Φόβος" },
    fire:      { en: "Fire",          el: "Φωτιά" },
    gratitude: { en: "Gratitude",     el: "Ευγνωμοσύνη" },
    grief:     { en: "Grief",         el: "Πένθος" },
    hope:      { en: "Hope",          el: "Ελπίδα" },
    horror:    { en: "Horror",        el: "Τρόμος" },
    hunger:    { en: "Hunger",        el: "Πείνα" },
    identity:  { en: "Identity",      el: "Ταυτότητα" },
    illusion:  { en: "Illusion",      el: "Ψευδαίσθηση" },
    journey:   { en: "Journey",       el: "Ταξίδι" },
    justice:   { en: "Justice",       el: "Δικαιοσύνη" },
    key:       { en: "Key",           el: "Κλειδί" },
    language:  { en: "Language",      el: "Γλώσσα" },
    light:     { en: "Light",         el: "Φως" },
    loss:      { en: "Loss",          el: "Απώλεια" },
    love:      { en: "Love",          el: "Αγάπη" },
    memory:    { en: "Memory",        el: "Μνήμη" },
    mirror:    { en: "Mirror",        el: "Καθρέφτης" },
    mystery:   { en: "Mystery",       el: "Μυστήριο" },
    nature:    { en: "Nature",        el: "Φύση" },
    night:     { en: "Night",         el: "Νύχτα" },
    rain:      { en: "Rain",          el: "Βροχή" },
    regret:    { en: "Regret",        el: "Μεταμέλεια" },
    sea:       { en: "Sea",           el: "Θάλασσα" },
    secret:    { en: "Secret",        el: "Μυστικό" },
    shadow:    { en: "Shadow",        el: "Σκιά" },
    silence:   { en: "Silence",       el: "Σιωπή" },
    snow:      { en: "Snow",          el: "Χιόνι" },
    solitude:  { en: "Solitude",      el: "Ερημιά" },
    sound:     { en: "Sound",         el: "Ήχος" },
    stranger:  { en: "Stranger",      el: "Άγνωστος" },
    theatre:   { en: "Theatre",       el: "Θέατρο" },
    time:      { en: "Time",          el: "Χρόνος" },
    truth:     { en: "Truth",         el: "Αλήθεια" },
    waiting:   { en: "Waiting",       el: "Αναμονή" },
    wisdom:    { en: "Wisdom",        el: "Σοφία" },
    winter:    { en: "Winter",        el: "Χειμώνας" },
    work:      { en: "Work",          el: "Εργασία" },
    door:      { en: "Door",          el: "Πόρτα" },
    forgiveness:{ en: "Forgiveness",  el: "Συγχώρεση" },
    home:      { en: "Home",          el: "Σπίτι" },
    longing:   { en: "Longing",       el: "Λαχτάρα" }
  };

  var PROMPT_TAGS = {
    p001: ["door","mystery","fear"],
    p002: ["key","childhood","mystery"],
    p003: ["stranger","dream","journey"],
    p004: ["light","night","solitude"],
    p005: ["silence","love"],
    p006: ["rain","sound","hope"],
    p007: ["absence","family","loss"],
    p008: ["farewell","love","memory"],
    p009: ["memory","loss","time"],
    p010: ["childhood","home","memory"],
    p011: ["loss","grief","time"],
    p012: ["hope","time"],
    p013: ["waiting","time"],
    p014: ["home","farewell","journey"],
    p015: ["secret","love"],
    p016: ["sea","journey","loss"],
    p017: ["truth","wisdom"],
    p018: ["truth","wisdom"],
    p019: ["forgiveness","betrayal"],
    p020: ["confession","regret"],
    p021: ["theatre","comedy"],
    p022: ["farewell","journey"],
    p023: ["mystery","crime"],
    p024: ["secret","identity"],
    p025: ["family","secret"],
    p026: ["betrayal","confession"],
    p027: ["identity","solitude"],
    p028: ["regret","identity"],
    p029: ["time","hope"],
    p030: ["memory","time"],
    p031: ["dream","identity"],
    p032: ["memory","time"],
    p033: ["mystery","identity"],
    p034: ["snow","silence"],
    p035: ["everyday","time"],
    p036: ["night","sound"],
    p037: ["silence","absence"],
    p038: ["fire","memory","loss"],
    p039: ["grief","loss"],
    p040: ["loss","grief"],
    p041: ["journey","loss"],
    p042: ["everyday","light"],
    p043: ["home","farewell","memory"],
    p044: ["crime","mystery"],
    p045: ["hope","loss"],
    p046: ["wisdom","grief"],
    p047: ["truth","wisdom"],
    p048: ["truth"],
    p049: ["comedy","theatre"],
    p050: ["illusion","theatre"],
    p051: ["theatre","mystery"],
    p052: ["memory","truth"],
    p053: ["identity","dream"],
    p054: ["solitude","mystery"],
    p055: ["memory","death"],
    p056: ["forgiveness","betrayal"],
    p057: ["mirror","identity"],
    p058: ["regret","forgiveness"],
    p059: ["love","death"],
    p060: ["time","solitude"],
    p061: ["shadow","identity"],
    p062: ["time","death"],
    p063: ["identity","dream"],
    p064: ["absence","sound"],
    p065: ["winter","solitude"],
    p066: ["light","absence"],
    p067: ["language","silence"],
    p068: ["memory","identity"],
    p069: ["silence","fear"],
    p070: ["fear","comedy"],
    p071: ["time","dream"],
    p072: ["loss","time"],
    p073: ["love","betrayal"],
    p074: ["work","everyday"],
    p075: ["farewell","family"],
    p076: ["light","wisdom"],
    p077: ["gratitude"],
    p078: ["silence","regret"],
    p079: ["crime","justice"],
    p080: ["comedy","illusion"],
    p081: ["horror","absence"],
    p082: ["truth","identity"],
    p083: ["memory","absence"],
    p084: ["time","mystery"],
    p085: ["faith","doubt"],
    p086: ["fear","comedy"],
    p087: ["death","farewell"],
    p088: ["farewell","work"],
    p089: ["love","waiting"],
    p090: ["everyday","mystery"],
    p091: ["nature","hope"],
    p092: ["mirror","mystery"],
    p093: ["sound","fear","absence"],
    p094: ["light","everyday"],
    p095: ["door","mystery"],
    p096: ["everyday","time"],
    p097: ["memory","body"],
    p098: ["memory","death","absence"],
    p099: ["hunger","longing"],
    p100: ["time","longing","love"]
  };

  // ---------- 2. Data model + storage ----------
  // state = { ver:1, sm, om, favorites:{id:mtime}, completed:{id:ts},
  //           customs:[{id, cat, en, el, mtime, pos}], deleted:{} }
  var state = null;

  function newState() {
    return {
      ver: DATA_VER,
      sm: Date.now(),
      om: Date.now(),
      favorites: {},   // id → mtime (mirrors completed — tombstone-aware)
      completed: {},
      customs: [],
      deleted: {}
    };
  }

  // Favorites schema v2: { id → mtime }. Legacy arrays (pre-v2) migrate:
  // tombstoned ids drop (their last signal was a delete), survivors get
  // mtime NOW — local truth wins ONCE, then normal LWW applies. Mixed-age
  // sync payloads funnel through here too.
  function normalizeFavs(data) {
    if (!data.favorites) { data.favorites = {}; return; }
    if (Array.isArray(data.favorites)) {
      var now = Date.now(), out = {};
      data.favorites.forEach(function(id){
        if (data.deleted && data.deleted[id] !== undefined) return;
        out[id] = now;
      });
      data.favorites = out;
      return;
    }
    if (typeof data.favorites !== "object") { data.favorites = {}; return; }
    Object.keys(data.favorites).forEach(function(id){   // defensive strip
      if (typeof data.favorites[id] !== "number") delete data.favorites[id];
    });
  }

  function load() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        var data = JSON.parse(raw);
        if (data && typeof data.ver === "number") {
          state = data;
          normalizeFavs(state);
          if (!state.completed) state.completed = {};
          if (!state.customs) state.customs = [];
          if (!state.deleted) state.deleted = {};
          return;
        }
      }
    } catch (e) { /* corrupted → fresh */ }
    state = newState();
    save();
  }

  function save() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }
    catch (e) { /* quota */ }
    if (window.__orosSyncApi) window.__orosSyncApi.dirty();
  }

  function dailyPromptId() {
    var now = new Date();
    var dayStr = now.getFullYear() + "-" + (now.getMonth()+1) + "-" + now.getDate();
    var hash = 0;
    for (var i = 0; i < dayStr.length; i++) {
      hash = ((hash << 5) - hash) + dayStr.charCodeAt(i);
      hash |= 0;
    }
    var abs = Math.abs(hash) % PROMPTS_DATA.length;
    return PROMPTS_DATA[abs].id;
  }

  function isNewDaily() {
    var last = localStorage.getItem("oros-prompter-daily-last");
    var today = dailyPromptId();
    var seen = last === today;
    localStorage.setItem("oros-prompter-daily-last", today);
    return !seen;
  }

  // ---------- 2b. Merge engine ----------
  // Union favorites, union completed (newest ts wins), union customs (LWW mtime), tombstones resurrect
  function newerTs(a, b) {
    if ((a.mtime||0) !== (b.mtime||0)) return (a.mtime||0) > (b.mtime||0) ? a : b;
    return JSON.stringify(a) >= JSON.stringify(b) ? a : b;   // tie → deterministic + symmetric
  }

  function mergePrompterStates(A, B) {
    var a = A || {}, b = B || {};
    var tomb = {};
    Object.keys(a.deleted||{}).forEach(function(id){ tomb[id] = a.deleted[id]; });
    Object.keys(b.deleted||{}).forEach(function(id){ tomb[id] = Math.max(tomb[id]||0, b.deleted[id]); });

    // alive = no tombstone, or content newer than the tombstone
    // (resurrection contract — same as mood/weather)
    var alive = function(id, mtime){
      return (tomb[id] === undefined) || ((mtime || 0) > tomb[id]);
    };

    // favorites: union by id, LWW by mtime. Arrays (legacy payloads from
    // not-yet-updated devices) contribute mtime 0 — they survive only
    // without a tombstone, so an unfavorite anywhere still wins.
    var favMap = function(side) {
      var f = side.favorites || {}, out = {};
      if (Array.isArray(f)) { f.forEach(function(id){ out[id] = 0; }); }
      else { Object.keys(f).forEach(function(id){ if (typeof f[id] === "number") out[id] = f[id]; }); }
      return out;
    };
    var fa = favMap(a), fb = favMap(b);
    var favorites = {};
    [fa, fb].forEach(function(fm){
      Object.keys(fm).forEach(function(id){
        favorites[id] = Math.max(favorites[id] || 0, fm[id]);
      });
    });
    Object.keys(favorites).forEach(function(id){
      if (!alive(id, favorites[id])) delete favorites[id];
    });

    var completed = {};
    Object.keys(a.completed||{}).forEach(function(id){
      if (alive(id, a.completed[id])) completed[id] = a.completed[id];
    });
    Object.keys(b.completed||{}).forEach(function(id){
      if (!alive(id, b.completed[id])) return;
      completed[id] = Math.max(completed[id] || 0, b.completed[id]);
    });

    var customsMap = {};
    (a.customs||[]).forEach(function(c){ customsMap[c.id] = c; });
    (b.customs||[]).forEach(function(c){
      customsMap[c.id] = newerTs(customsMap[c.id], c);
    });
    var customs = [];
    Object.keys(customsMap).forEach(function(id){
      if (alive(id, customsMap[id].mtime)) customs.push(customsMap[id]);
    });
    customs.sort(function(x,y){ return (x.pos||0)-(y.pos||0) || (x.id<y.id?-1:x.id>y.id?1:0); });   // pos, then id — deterministic across devices

    return {
      ver: DATA_VER,
      sm: Math.max(a.sm||0, b.sm||0),
      om: Math.max(a.om||0, b.om||0),
      favorites: favorites,
      completed: completed,
      customs: customs,
      deleted: tomb
    };
  }

  // ---------- 5. Sync slice + wiring ----------
  function registerSync() {
    var api = (window.parent && window.parent.orosSync) || window.orosSync;
    window.__orosSyncApi = { _suppress:false, dirty:function(){ if(this._suppress)return; if(api&&api.markDirty) api.markDirty(); }};
    if (!api || typeof api.registerSlice !== "function") return;
    api.registerSlice("prompter", sliceGet, sliceSet, STORAGE_KEY, mergePrompterStates);
  }

  function sliceGet() { return JSON.parse(JSON.stringify(state)); }
  function sliceSet(data, info) {
    data = JSON.parse(JSON.stringify(data||null));
    if (!data || data.favorites === undefined) return;
    normalizeFavs(data);
    window.__orosSyncApi._suppress = true;
    try { state = data; localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }
    finally { window.__orosSyncApi._suppress = false; }
    renderAll();
    if (info && info.merged) showToast(t("sync.pull"));
  }

  // Toast (lazy, top-right)
  var toastEl=null, toastTimer=null, toastAction=null;
  function showToast(text, actionLabel, actionFn) {
    if(!toastEl){
      toastEl=document.createElement("div");
      toastEl.style.cssText="position:fixed;top:calc(12px+env(safe-area-inset-top,0px));right:12px;z-index:1200;background:var(--panel-bg);border:1px solid var(--border);border-radius:8px;box-shadow:0 4px 16px var(--shadow);padding:9px 14px;font-size:13px;color:var(--text);opacity:0;transition:opacity .3s,transform .3s;max-width:calc(100vw-32px);";
      document.body.appendChild(toastEl);
    }
    if(toastAction){ toastAction.remove(); toastAction=null; }
    toastEl.textContent="";
    toastEl.appendChild(document.createTextNode(text));
    if(actionLabel && typeof actionFn==="function"){
      toastAction=document.createElement("button");
      toastAction.type="button";
      toastAction.textContent=actionLabel;
      toastAction.style.cssText="margin-left:10px;background:transparent;color:var(--accent);border:none;border-left:1px solid var(--border);padding:0 0 0 10px;font-size:13px;font-weight:700;cursor:pointer;";
      toastAction.addEventListener("click", function(){ actionFn(); hideToast(); });
      toastEl.appendChild(toastAction);
    }
    void toastEl.offsetWidth;
    toastEl.style.opacity="1";
    toastEl.style.transform="translateY(0)";
    clearTimeout(toastTimer);
    toastTimer=setTimeout(hideToast, 5000);
  }
  function hideToast(){ if(!toastEl)return; toastEl.style.opacity="0"; toastEl.style.transform="translateY(-8px)"; if(toastAction){ toastAction.remove(); toastAction=null;} toastEl.textContent=""; }

  // Helpers
  function uid(){ return Date.now().toString(36)+Math.random().toString(36).slice(2,7); }
  function esc(s){ return String(s).replace(/[&<>"']/g,function(c){return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c];});}
  function promptById(id){
    for(var i=0;i<PROMPTS_DATA.length;i++) if(PROMPTS_DATA[i].id===id) return PROMPTS_DATA[i];
    for(i=0;i<(state.customs||[]).length;i++) if(state.customs[i].id===id) return state.customs[i];
    return null;
  }
  // Built-ins read PROMPT_TAGS; customs carry their own tags field (Wave 4).
  function tagsFor(p){
    if(Array.isArray(p.tags)) return p.tags;
    return PROMPT_TAGS[p.id] || [];
  }
  function tagLabel(id){
    var l=TAG_LABELS[id];
    return l? (LANG==="el"? l.el : l.en) : id;
  }
  // Text search also matches tag labels (both languages) —
  // typing "μυστ" finds mystery prompts even without clicking a suggestion.
  function promptMatchesQuery(p){
    if(p.en.toLowerCase().indexOf(searchQuery)>=0) return true;
    if(p.el.toLowerCase().indexOf(searchQuery)>=0) return true;
    var tg=tagsFor(p);
    for(var i=0;i<tg.length;i++){
      var l=TAG_LABELS[tg[i]];
      if(!l) continue;
      if(l.en.toLowerCase().indexOf(searchQuery)>=0 ||
         l.el.toLowerCase().indexOf(searchQuery)>=0) return true;
    }
    return false;
  }
  function tagSuggestions(query){
    var out=[];
    Object.keys(TAG_LABELS).forEach(function(id){
      var l=TAG_LABELS[id];
      if(id.indexOf(query)===0 ||
         l.en.toLowerCase().indexOf(query)>=0 ||
         l.el.toLowerCase().indexOf(query)>=0) out.push(id);
    });
    return out.slice(0,6);
  }

  function isInFavs(id){ return Object.prototype.hasOwnProperty.call(state.favorites, id); }
  function isCompleted(id){ return state.completed.hasOwnProperty(id); }
  function isCustom(id){ return id.indexOf("c")===0; }
  function toggleFav(id){
    if(isInFavs(id)){ delete state.favorites[id]; state.deleted[id]=Date.now(); }   // tombstone — survives merge
    else { delete state.deleted[id]; state.favorites[id]=Date.now(); }   // fresh ts beats tombstone
    state.sm=Date.now(); save(); renderAll();
  }
  function toggleComplete(id){
    if(state.completed[id]) { delete state.completed[id]; state.deleted[id]=Date.now(); }   // tombstone — survives merge
    else { delete state.deleted[id]; state.completed[id]=Date.now(); }   // fresh ts beats tombstone
    state.sm=Date.now(); save(); renderAll();
  }
  function copyText(text){
    if(navigator.clipboard){ navigator.clipboard.writeText(text).then(function(){ showToast(t("saved.toast")); }); }
    else { var ta=document.createElement("textarea"); ta.value=text; document.body.appendChild(ta); ta.select(); try{ document.execCommand("copy"); showToast(t("saved.toast")); }catch(e){} document.body.removeChild(ta);}
  }

  // ---------- Wave 4: Custom prompt CRUD ----------
  var editorModal=null;
  var showMineOnly=false;   // "✦ Mine" browse toggle
  function closeEditor(){
    if(editorModal){ editorModal.close(); editorModal.remove(); editorModal=null; }
  }
  function openCustomEditor(existing){
    if(editorModal) return;
    var editing=!!existing;
    var p=existing||{cat:"micro", en:"", el:"", var_en:"", var_el:"", tags:[]};
    editorModal=document.createElement("dialog");
    editorModal.className="settings-dlg custom-editor";

    var h=document.createElement("h3");
    h.textContent=editing? t("editor.title.edit") : t("editor.title.new");
    editorModal.appendChild(h);

    var mkField=function(labelTxt, inputEl){
      var wrap=document.createElement("label");
      wrap.className="field";
      var lb=document.createElement("span");
      lb.className="field-label";
      lb.textContent=labelTxt;
      wrap.appendChild(lb);
      wrap.appendChild(inputEl);
      return wrap;
    };

    var sel=document.createElement("select");
    CATEGORIES.slice(1).forEach(function(cat){
      var o=document.createElement("option");
      o.value=cat.id;
      o.textContent=t("cat."+cat.id);
      if(p.cat===cat.id) o.selected=true;
      sel.appendChild(o);
    });
    editorModal.appendChild(mkField(t("editor.cat"), sel));

    var enIn=document.createElement("textarea");
    enIn.rows=2; enIn.value=p.en||"";
    editorModal.appendChild(mkField(t("editor.en"), enIn));

    var elIn=document.createElement("textarea");
    elIn.rows=2; elIn.value=p.el||"";
    editorModal.appendChild(mkField(t("editor.el"), elIn));

    var vEn=document.createElement("input");
    vEn.type="text"; vEn.value=p.var_en||"";
    editorModal.appendChild(mkField(t("editor.varEn"), vEn));

    var vEl=document.createElement("input");
    vEl.type="text"; vEl.value=p.var_el||"";
    editorModal.appendChild(mkField(t("editor.varEl"), vEl));

    var tgIn=document.createElement("input");
    tgIn.type="text";
    tgIn.value=(p.tags||[]).join(", ");
    editorModal.appendChild(mkField(t("editor.tags"), tgIn));

    // Known-tag suggestions from the 57-tag vocabulary —
    // appear from the 2nd char of the last fragment, exclude already-entered,
    // click appends to the field. Free-form tags stay fully supported.
    var tgSug=document.createElement("div");
    tgSug.className="tag-suggest editor-tag-suggest";
    var renderTagSug=function(){
      tgSug.innerHTML="";
      var entered=tgIn.value.split(",").map(function(s){ return s.trim().toLowerCase(); }).filter(Boolean);
      var parts=tgIn.value.split(",");
      var frag=parts[parts.length-1].trim().toLowerCase();
      if(frag.length<2) return;
      var hits=tagSuggestions(frag).filter(function(tid){ return entered.indexOf(tid)<0; });
      hits.slice(0,6).forEach(function(tid){
        var sbtn=document.createElement("button");
        sbtn.type="button";
        sbtn.className="tag-sugg-item";
        sbtn.textContent="#"+tagLabel(tid);
        sbtn.addEventListener("mousedown", function(ev){
          ev.preventDefault();
          var parts=tgIn.value.split(",");
          parts.pop();                       // αντικαθιστά το ημιτελές fragment
          var v=parts.join(",").trim();
          if(v) v+=", ";
          v+=tid+", ";
          tgIn.value=v;
          renderTagSug();
        });
        tgSug.appendChild(sbtn);
      });
    };
    tgIn.addEventListener("input", renderTagSug);
    editorModal.appendChild(tgSug);

    var btns=document.createElement("div");
    btns.className="editor-buttons";
    var cn=document.createElement("button");
    cn.type="button"; cn.className="ghost"; cn.textContent=t("editor.cancel");
    cn.addEventListener("click", closeEditor);
    var sv=document.createElement("button");
    sv.type="button"; sv.className="prim"; sv.textContent=t("editor.save");
    sv.addEventListener("click", function(){
      var enVal=enIn.value.trim(), elVal=elIn.value.trim();
      if(!enVal || !elVal){ showToast(t("editor.errEmpty")); return; }
      var tagList=tgIn.value.split(",").map(function(s){ return s.trim().toLowerCase(); }).filter(Boolean);
      var now=Date.now();
      if(editing){
        // p is a live reference into state.customs — mutate in place
        p.cat=sel.value; p.en=enVal; p.el=elVal;
        p.var_en=vEn.value.trim(); p.var_el=vEl.value.trim();
        p.tags=tagList; p.mtime=now;
        delete state.deleted[p.id];   // resurrection on re-save
      } else {
        var maxPos=-1;
        state.customs.forEach(function(c){ if((c.pos||0)>maxPos) maxPos=c.pos||0; });
        state.customs.push({
          id:"c"+uid(), cat:sel.value, en:enVal, el:elVal,
          var_en:vEn.value.trim(), var_el:vEl.value.trim(),
          tags:tagList, mtime:now, pos:maxPos+1
        });
      }
      state.sm=now; save(); closeEditor(); renderAll();
      showToast(t("custom.saved"));
    });
    btns.appendChild(cn); btns.appendChild(sv);
    editorModal.appendChild(btns);
    editorModal.addEventListener("keydown", function(ev){
      if((ev.ctrlKey||ev.metaKey) && (ev.key==="Enter"||ev.keyCode===13)){
        ev.preventDefault();
        sv.click();
      }
    });

    editorModal.addEventListener("close", function(){ if(editorModal){ editorModal.remove(); editorModal=null; } });   // Esc too (async event — buttons null it first)
    document.body.appendChild(editorModal);
    editorModal.showModal();
    setTimeout(function(){ enIn.focus(); }, 50);
  }

  function deleteCustom(id){
    var now=Date.now();
    for(var i=0;i<state.customs.length;i++){
      if(state.customs[i].id===id){ state.customs.splice(i,1); break; }
    }
    delete state.favorites[id];
    delete state.completed[id];
    state.deleted[id]=now;   // tombstone → merge-proof wipe on all devices
    state.sm=now; save(); renderAll();
    showToast(t("custom.deleted"));
  }
  function confirmCustomDelete(id){
    var dlg=document.createElement("dialog");
    dlg.className="settings-dlg";
    var p=document.createElement("p");
    p.style.margin="12px 0";
    p.textContent=t("custom.confirmDel");
    dlg.appendChild(p);
    var c=document.createElement("button");
    c.type="button"; c.className="ghost"; c.textContent=t("rst.cancel");
    c.addEventListener("click", function(){ dlg.close(); dlg.remove(); });
    var y=document.createElement("button");
    y.type="button"; y.className="prim danger"; y.textContent=t("custom.delete");
    y.addEventListener("click", function(){ dlg.close(); dlg.remove(); deleteCustom(id); });
    dlg.appendChild(c); dlg.appendChild(y);
    dlg.addEventListener("close", function(){ dlg.remove(); });   // Esc too
    document.body.appendChild(dlg);
    dlg.showModal();
  }

  // View state — ALL declared here, nothing implicit
  var viewMode="browse";
  var searchQuery="";      // lowercased, used for matching
  var searchRaw="";        // raw input value — keeps typed casing intact (fix #7)
  var activeCategory="all";
  var activeTag=null;      // tag filter (Wave 3)
  var varShown={};         // per-prompt variation toggle
  var currentDailyPromptId=null;
  var searchFocus=false;
  var dailyFresh=false;    // set ONCE at boot — isNewDaily() has a side effect
  
    // ---------- 3. Views: Browse + Stats ----------
  function showTab(tab){
    viewMode=tab;
    applyView();
  }

  function applyView(){
    var b=$("browse"), s=$("stats"), tb=$("browse-btn"), stb=$("stats-btn"), sb=$("settings-btn");
    if(b) b.hidden=(viewMode!=="browse");
    if(s) s.hidden=(viewMode!=="stats");
    if(tb){ tb.classList.toggle("on", viewMode==="browse"); tb.setAttribute("aria-pressed", viewMode==="browse"? "true":"false"); }
    if(stb){ stb.classList.toggle("on", viewMode==="stats"); stb.setAttribute("aria-pressed", viewMode==="stats"? "true":"false"); }
    if(sb){ sb.classList.toggle("on", viewMode==="settings"); sb.setAttribute("aria-pressed", viewMode==="settings"? "true":"false"); }
    if(viewMode==="browse") renderBrowse();
    else if(viewMode==="stats") renderStats();
  }
  
  var loader=document.createElement("div");
loader.id="prompter-boot-loader";
loader.style.cssText="position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);font-size:14px;color:var(--text-dim);";
loader.textContent=(LANG==="el"? "Φόρτωση..." : "Loading...");
document.body.appendChild(loader);

  function renderBrowse(){
    var host=$("browse");
    if(!host) return;
    host.innerHTML="";
	
	if(loader) loader.remove();

    // Search (focus-preserving: re-render restores caret + typed casing)
    var sr=document.createElement("input");
    sr.type="text";
    sr.className="search-input";
    sr.placeholder=t("search.placeholder");
    sr.value=searchRaw;
    sr.addEventListener("input", function(e){
      searchRaw=e.target.value;
      searchQuery=searchRaw.trim().toLowerCase();
      searchFocus=true;
      renderBrowse();
    });
    host.appendChild(sr);
    if(searchFocus){
      sr.focus();
      try{ sr.setSelectionRange(sr.value.length, sr.value.length); }catch(err){}
      searchFocus=false;
    }

    // Tag suggestions — from the 3rd character, max 6, toggle on click
    if(searchQuery.length>=3){
      var hits=tagSuggestions(searchQuery);
      if(hits.length){
        var sg=document.createElement("div");
        sg.className="tag-suggest";
        hits.forEach(function(tid){
          var sbt=document.createElement("button");
          sbt.type="button";
          sbt.className="tag-sugg-item"+(activeTag===tid? " on":"");
          sbt.textContent="#"+tagLabel(tid);
          sbt.addEventListener("mousedown", function(ev){
            ev.preventDefault();               // mousedown beats input blur
            activeTag=(activeTag===tid? null:tid);
            searchFocus=true;                  // caret survives the re-render
            renderBrowse();
          });
          sg.appendChild(sbt);
        });
        host.appendChild(sg);
      }
    }

    // Active tag filter chip — click clears it
    if(activeTag){
      var ac=document.createElement("button");
      ac.type="button";
      ac.className="active-tag";
      ac.title=t("tag.clear");
      ac.textContent="#"+tagLabel(activeTag)+" ✕";
      ac.addEventListener("click", function(){
        activeTag=null;
        renderBrowse();
      });
      host.appendChild(ac);
    }

    // Category filter chips
    var cf=document.createElement("div");
    cf.className="category-filter";
    CATEGORIES.forEach(function(cat){
      var ch=document.createElement("button");
      ch.type="button";
      ch.className="cat-chip"+(activeCategory===cat.id?" on":"");
      ch.textContent=t("cat."+cat.id);
      ch.addEventListener("click", function(){ activeCategory=cat.id; renderBrowse(); });
      cf.appendChild(ch);
    });
    var mc=document.createElement("button");
    mc.type="button";
    mc.className="cat-chip"+(showMineOnly? " on":"");
    mc.textContent=t("custom.mine");
    mc.addEventListener("click", function(){ showMineOnly=!showMineOnly; renderBrowse(); });
    cf.appendChild(mc);
    var nc=document.createElement("button");
    nc.type="button";
    nc.className="cat-chip add-custom";
    nc.title=t("custom.new");
    nc.textContent="＋ "+t("custom.new");
    nc.addEventListener("click", function(){ openCustomEditor(null); });
    cf.appendChild(nc);
    host.appendChild(cf);

    // Prompts grid
    var grid=document.createElement("div");
    grid.className="prompts-grid";
    var shown=0;
    var dailyId=dailyPromptId();
    currentDailyPromptId=dailyId;

    // Built-ins + customs filtered
    var allPrompts=PROMPTS_DATA.concat(state.customs||[]);
    allPrompts.forEach(function(p){
      if(showMineOnly && !isCustom(p.id)) return;
      if(activeCategory!=="all" && p.cat!==activeCategory) return;
      if(activeTag && tagsFor(p).indexOf(activeTag)<0) return;
      if(searchQuery && !promptMatchesQuery(p)) return;
      if(!activeTag && !searchQuery && shown>=50 && p.id!==dailyId) return;

      var card=document.createElement("div");
      card.className="prompt-card"+(isCustom(p.id)? " custom":"");
      if(p.id===dailyId) card.classList.add("daily-highlight");

      var hdr=document.createElement("div");
      hdr.className="card-header";
      var catLab=document.createElement("span");
      catLab.className="card-cat";
      catLab.textContent=catLabel(p.cat);
      hdr.appendChild(catLab);

      var badges=document.createElement("div");
      badges.className="card-badges";
      if(isInFavs(p.id)){
        var fb=document.createElement("span");
        fb.className="badge";
        fb.textContent=t("fav.badge");
        fb.title=t("badge.fav");
        badges.appendChild(fb);
      }
      if(isCompleted(p.id)){
        var cb=document.createElement("span");
        cb.className="badge completed";
        cb.textContent=t("comp.badge");
        cb.title=t("badge.comp");
        badges.appendChild(cb);
      }
      if(isCustom(p.id)){
        var xfb=document.createElement("span");
        xfb.className="badge";
        xfb.textContent=t("custom.badge");
        xfb.title=t("badge.custom");
        badges.appendChild(xfb);
      }
      if(p.id===dailyId){
        var db=document.createElement("span");
        db.className="badge daily-badge";
        db.textContent=t(dailyFresh? "daily.pulse" : "daily.badge");
        if(dailyFresh){ db.style.background="#ff7043"; db.style.color="white"; }
        badges.appendChild(db);
      }
      hdr.appendChild(badges);
      card.appendChild(hdr);

      var body=document.createElement("div");
      body.className="card-body";
      body.textContent=(LANG==="el"? p.el : p.en);
      var varText=(LANG==="el"? p.var_el : p.var_en)||"";
      var showVar=!!varText && !!varShown[p.id];
      if(showVar){
        var vline=document.createElement("div");
        vline.className="var-line";
        vline.textContent="+ "+varText;
        body.appendChild(vline);
      }
      card.appendChild(body);

      var ptags=tagsFor(p);
      if(ptags.length){
        var tr=document.createElement("div");
        tr.className="tag-row";
        ptags.forEach(function(tid){
          var tc=document.createElement("button");
          tc.type="button";
          tc.className="tag-chip"+(activeTag===tid? " on":"");
          tc.textContent="#"+tagLabel(tid);
          tc.addEventListener("click", function(ev){
            ev.stopPropagation();
            activeTag=(activeTag===tid? null:tid);
            renderBrowse();
          });
          tr.appendChild(tc);
        });
        card.appendChild(tr);
      }

      var acts=document.createElement("div");
      acts.className="card-actions";
      var useBtn=document.createElement("button");
      useBtn.type="button";
      useBtn.className="primary";
      useBtn.textContent=t("btn.use");
      useBtn.addEventListener("click", function(){ copyText(LANG==="el"? p.el : p.en); });
      acts.appendChild(useBtn);

      var copyBtn=document.createElement("button");
      copyBtn.type="button";
      copyBtn.textContent=t("btn.copy");
      copyBtn.addEventListener("click", function(){
        copyText((LANG==="el"? p.el : p.en)+(showVar? "\n+ "+varText : ""));
      });
      acts.appendChild(copyBtn);

      if(varText){
        var varBtn=document.createElement("button");
        varBtn.type="button";
        varBtn.textContent=t("btn.toggle")+(showVar? " ✓":"");
        varBtn.addEventListener("click", function(){
          varShown[p.id]=!varShown[p.id];
          renderBrowse();
        });
        acts.appendChild(varBtn);
      }

      var favBtn=document.createElement("button");
      favBtn.type="button";
      favBtn.textContent=isInFavs(p.id)? t("btn.unfavorite") : t("btn.favorite");
      favBtn.addEventListener("click", function(){ toggleFav(p.id); });
      acts.appendChild(favBtn);

      var compBtn=document.createElement("button");
      compBtn.type="button";
      compBtn.textContent=isCompleted(p.id)? t("btn.uncComplete") : t("btn.complete");
      compBtn.addEventListener("click", function(){ toggleComplete(p.id); });
      acts.appendChild(compBtn);

      if(isCustom(p.id)){
        var edBtn=document.createElement("button");
        edBtn.type="button";
        edBtn.textContent=t("custom.edit");
        edBtn.addEventListener("click", function(){ openCustomEditor(p); });
        acts.appendChild(edBtn);
        var dlBtn=document.createElement("button");
        dlBtn.type="button";
        dlBtn.textContent=t("custom.delete");
        dlBtn.addEventListener("click", function(){ confirmCustomDelete(p.id); });
        acts.appendChild(dlBtn);
      }

      card.appendChild(acts);
      grid.appendChild(card);
      shown++;
    });

    if(!grid.childNodes.length){
      var emp=document.createElement("div");
      emp.className="empty-state";
      emp.innerHTML=t("empty.browse")+'<br><span class="hint" style="margin-top:8px;display:block;">'+t("cat.all")+' — '+t("search.placeholder")+'</span>';
      host.appendChild(emp);
    } else {
      host.appendChild(grid);
    }
  }

  // Streak — set of local dates with ≥1 completion, walk backwards.
  // Grace rule: today counts only if something was completed today,
  // otherwise the streak is measured up to yesterday.
  function computeStreak(){
    var days={};
    Object.keys(state.completed).forEach(function(id){
      var d=new Date(state.completed[id]);
      if(isNaN(d.getTime())) return;
      days[d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0")+"-"+String(d.getDate()).padStart(2,"0")]=true;
    });
    var streak=0;
    var cur=new Date();
    var key=function(dt){
      return dt.getFullYear()+"-"+String(dt.getMonth()+1).padStart(2,"0")+"-"+String(dt.getDate()).padStart(2,"0");
    };
    if(!days[key(cur)]) cur.setDate(cur.getDate()-1);
    while(days[key(cur)]){ streak++; cur.setDate(cur.getDate()-1); }
    return streak;
  }

  function renderStats(){
    var host=$("stats");
    if(!host) return;
    host.innerHTML="";

    var totalBuiltIn=PROMPTS_DATA.length;
    var totalCustom=state.customs.length;
    var totalFavs=Object.keys(state.favorites).length;
    var totalComp=Object.keys(state.completed||{}).length;
    // Completed built-ins only — customs don't inflate the built-in progress %
    var compBuiltIn=0;
    PROMPTS_DATA.forEach(function(p){ if(state.completed[p.id]) compBuiltIn++; });
    var progress=totalBuiltIn>0 ? Math.min(100, Math.round(compBuiltIn/totalBuiltIn*100)) : 0;

    var kpis=document.createElement("div");
    kpis.className="stats-kpis";
    var mkKpi=function(lbl, val){
      var k=document.createElement("div");
      k.className="kpi-card";
      var v=document.createElement("div");
      v.className="kpi-value";
      v.textContent=val;
      var l=document.createElement("div");
      l.className="kpi-label";
      l.textContent=lbl;
      k.appendChild(v); k.appendChild(l);
      return k;
    };
    kpis.appendChild(mkKpi(t("stats.total"), String(totalBuiltIn+totalCustom)));
    kpis.appendChild(mkKpi(t("stats.completed"), String(totalComp)));
    kpis.appendChild(mkKpi(t("stats.favorites"), String(totalFavs)));
    kpis.appendChild(mkKpi(t("stats.customs"), String(totalCustom)));
    host.appendChild(kpis);

    // Streak — shared helper (fix #5)
    var streak=computeStreak();
    var streakDiv=document.createElement("div");
    streakDiv.className="stats-breakdown";
    var sTitle=document.createElement("div");
    sTitle.className="breakdown-title";
    sTitle.textContent=streak>0 ? t("streak.val").replace("{n}", streak) : t("streak.zero");
    streakDiv.appendChild(sTitle);
    host.appendChild(streakDiv);

    // Progress
    var progDiv=document.createElement("div");
    progDiv.className="stats-breakdown";
    var pTitle=document.createElement("div");
    pTitle.className="breakdown-title";
    pTitle.textContent=t("stats.progress");
    progDiv.appendChild(pTitle);
    var row=document.createElement("div");
    row.className="breakdown-row";
    var lab=document.createElement("span");
    lab.className="breakdown-lab";
    lab.textContent="%";
    var bar=document.createElement("div");
    bar.className="breakdown-bar";
    var fill=document.createElement("div");
    fill.className="breakdown-fill";
    fill.style.width=Math.max(4, progress)+"%";
    bar.appendChild(fill);
    var val=document.createElement("span");
    val.className="breakdown-val";
    val.textContent=progress+"%";
    row.appendChild(lab); row.appendChild(bar); row.appendChild(val);
    progDiv.appendChild(row);
    host.appendChild(progDiv);

    // By category — built-ins now count (fix #4)
    var catCounts={};
    PROMPTS_DATA.forEach(function(p){ catCounts[p.cat]=(catCounts[p.cat]||0)+1; });
    state.customs.forEach(function(c){ catCounts[c.cat]=(catCounts[c.cat]||0)+1; });
    var completedCat={};
    Object.keys(state.completed||{}).forEach(function(id){
      var p=promptById(id);
      if(p) completedCat[p.cat]=(completedCat[p.cat]||0)+1;
    });

    var byCat=document.createElement("div");
    byCat.className="stats-breakdown";
    var bcTitle=document.createElement("div");
    bcTitle.className="breakdown-title";
    bcTitle.textContent=t("by.cat");
    byCat.appendChild(bcTitle);

    CATEGORIES.slice(1).forEach(function(cat){
      var total=catCounts[cat.id]||0;
      var comp=completedCat[cat.id]||0;
      if(total===0) return;
      var r=document.createElement("div");
      r.className="breakdown-row";
      var l=document.createElement("span");
      l.className="breakdown-lab";
      l.textContent=catLabel(cat.id);
      var br=document.createElement("div");
      br.className="breakdown-bar";
      var f=document.createElement("div");
      f.className="breakdown-fill";
      f.style.width=Math.max(4, Math.round(comp/total*100))+"%";
      br.appendChild(f);
      var v=document.createElement("span");
      v.className="breakdown-val";
      v.textContent=comp+"/"+total;
      r.appendChild(l); r.appendChild(br); r.appendChild(v);
      byCat.appendChild(r);
    });
    host.appendChild(byCat);

  }

  function renderAll(){
    if(viewMode==="stats") renderStats(); else renderBrowse();
  }

  // ---------- 4. Settings modal ----------
  var settingsModal=null;
  function openSettings(){
    if(settingsModal) return;
    settingsModal=document.createElement("dialog");
    settingsModal.className="settings-dlg";
    settingsModal.innerHTML="<h3>"+esc(t("settings.title"))+"</h3><p style='margin:12px 0'>"+esc(t("rst.body"))+"</p>";
    var c=document.createElement("button");
    c.type="button"; c.className="ghost"; c.textContent=t("rst.cancel");
    c.addEventListener("click", function(){ settingsModal.close(); settingsModal.remove(); settingsModal=null; });
    var y=document.createElement("button");
    y.type="button"; y.className="prim danger"; y.textContent=t("rst.btn");
    y.addEventListener("click", function(){ factoryReset(); });
    settingsModal.appendChild(c); settingsModal.appendChild(y);
    settingsModal.addEventListener("close", function(){ if(settingsModal){ settingsModal.remove(); settingsModal=null; } });   // Esc too (async event — buttons null it first)
    document.body.appendChild(settingsModal);
    settingsModal.showModal();
  }

  function factoryReset(){
    var now=Date.now();
    var tomb={};
    Object.keys(state.deleted||{}).forEach(function(id){ tomb[id]=state.deleted[id]; });
    // tombstone EVERYTHING user-owned → merge-proof wipe on all devices
    Object.keys(state.favorites).forEach(function(id){ tomb[id]=now; });
    Object.keys(state.completed).forEach(function(id){ tomb[id]=now; });
    (state.customs||[]).forEach(function(c){ tomb[c.id]=now; });
    var fresh=newState();
    fresh.deleted=tomb; fresh.sm=now; fresh.om=now;
    state=fresh; save();
    activeCategory="all";
    activeTag=null;
    searchQuery="";
    searchRaw="";
    varShown={};
    showMineOnly=false;
    renderAll();
    if(settingsModal){ settingsModal.close(); settingsModal.remove(); settingsModal=null; }
    showToast(t("rst.done"));
  }

  // ---------- 5. Wiring & boot ----------
  function paintStaticAria(){
    var bb=$("browse-btn"); if(bb){ bb.setAttribute("aria-label",t("browse")); bb.setAttribute("title",t("browse")); bb.innerHTML='<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/></svg>'; }
    var sb=$("stats-btn"); if(sb){ sb.setAttribute("aria-label",t("stats")); sb.setAttribute("title",t("stats")); sb.innerHTML='<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/></svg>'; }
    var sb2=$("settings-btn"); if(sb2){ sb2.setAttribute("aria-label",t("settings")); sb2.setAttribute("title",t("settings")); sb2.innerHTML='<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>'; }
  }

  function wire(){
    $("browse-btn").addEventListener("click", function(){ showTab("browse"); });
    $("stats-btn").addEventListener("click", function(){ showTab("stats"); });
    $("settings-btn").addEventListener("click", function(){ openSettings(); });
  }

  function applyI18n(){
    document.querySelectorAll("[data-i18n]").forEach(function(el){ el.textContent=t(el.getAttribute("data-i18n")); });
  }

  function inheritPalette(){
    try {
      var pRoot=window.parent.document.documentElement;
      document.documentElement.setAttribute("data-theme", pRoot.getAttribute("data-theme")||"dark");
      var cs=window.parent.getComputedStyle(pRoot);
      ["--bg","--bar-bg","--text","--text-dim","--accent","--accent-soft","--panel-bg","--border"].forEach(function(v){
        document.documentElement.style.setProperty(v, cs.getPropertyValue(v).trim());
      });
    } catch(e){}
  }

  // watchPalette — keeps the iframe palette glued to the parent shell:
  // theme flips (data-theme) react instantly via MutationObserver; skin
  // or accent swaps that only change CSS variables fall back to a
  // lightweight poll. Zero dependencies on shell internals.
  function watchPalette(){
    try {
      var pRoot=window.parent.document.documentElement;
      if(window.MutationObserver){
        new MutationObserver(function(){ inheritPalette(); })
          .observe(pRoot, { attributes:true, attributeFilter:["data-theme","class","style"] });
      }
    } catch(e){}
    setInterval(inheritPalette, 3000);
  }

  var SCRIPT_V="";
  (function(){
    var m=(document.currentScript && document.currentScript.src || "").match(/[?&]v=([^&#]+)/);
    SCRIPT_V=m?m[1]:"";
    document.documentElement.lang=LANG;
    console.log("prompter.js v"+(SCRIPT_V||"?")+" boot");
  })();

  // ---------- Boot ----------
  // Order matters: state first, then UI wiring, then sync registration
  // (sliceSet may fire immediately with merged remote data), then the
  // daily-fresh check — exactly ONCE, before first render (fix #6b).
  load();
  applyI18n();
  paintStaticAria();
  wire();
  registerSync();
  inheritPalette();
  watchPalette();
  dailyFresh=isNewDaily();
  renderBrowse();

  // boot: paint the DEFAULT tab's active state (applyView only
  // fires on tab clicks — without this, no button looks "on")
  var b0=$("browse-btn");
  if(b0){ b0.classList.add("on"); b0.setAttribute("aria-pressed","true"); }

})();