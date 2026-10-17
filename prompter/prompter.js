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
//   4b. The .orosscript file (save / open / unzipped folder / Open with)
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
  var TOMB_PRUNE_DAYS = 30;   // PR-2: payload-only tombstone cutoff
  var DAY_MS          = 24 * 60 * 60 * 1000;

  // ---------- 1. Constants, i18n ----------
  // orosI18n (../i18n.js): the full language code, a pack language included.
  var LANG = window.orosI18n ? window.orosI18n.lang() : (localStorage.getItem("oros-lang") === "el" ? "el" : "en");

  var STRINGS = {
    en: {
      "app.title":           "Prompter",
      "loading":             "Loading...",
      "browse":              "Browse",
      "stats":               "Statistics",
      "settings":            "Settings",
      "search.placeholder":  "Search prompts...",
      "tag.clear":           "Clear tag filter",
      "cat.all":             "All",
      "cat.micro":           "Micro-fiction",
      "cat.haiku":           "Haiku",
      "cat.poetry_free":     "Free poetry",
      "cat.poetry_metred":   "Metered poetry",
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
      "btn.copy":            "Copy",
      "btn.useTitle":        "Open this prompt in Writer as a new document",
      "btn.toggle":          "Variation",
      "btn.favorite":        "Star",
      "btn.unfavorite":      "Unstar",
      "btn.complete":        "Mark done",
      "btn.uncComplete":     "Undo",
      "daily.pulse":         "New today!",
      "streak.val":          "{n} days in a row",
      "streak.zero":         "No streak yet",
      "stats.total":         "Total prompts",
      "stats.completed":     "Completed",
      "stats.favorites":     "Favorites",
      "stats.customs":       "Customs",
      "daily.badge":         "Today",
      "stats.progress":      "Progress",
      "by.cat":              "By category",
      "empty.browse":        "No prompts found — adjust your filters.",
      "saved.toast":         "Copied to clipboard",
      "rst.btn":             "Factory reset",
      "rst.body":            "This permanently erases ALL custom prompts, favorites, and completed marks on every synced device. There is no undo.",
      "rst.cancel":          "Cancel",
      "rst.done":            "Fresh start — everything erased",
      "settings.title":      "Settings",
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
      "editor.errEmpty":      "Both language fields are required",
      "io.save":              "orOS file (.orosscript)",
      "io.files":             "Files",
      "io.open":              "Open an orOS file (.orosscript)…",
      "io.folder":            "Unzipped orOS folder…",
      "io.opened":            "Opened as a new prompt",
      "io.bad":               "Could not read this file",
      "io.newer":             "This file was made by a newer orOS. Update orOS to open it.",
      "io.saved":             "Saved",
      "io.saveFail":          "Could not save the file"
    },
    el: {
      "app.title":           "Γεννήτρια θεμάτων",
      "loading":             "Φόρτωση...",
      "browse":              "Αναζήτηση",
      "stats":               "Στατιστικά",
      "settings":            "Ρυθμίσεις",
      "search.placeholder":  "Αναζήτηση θεμάτων...",
      "tag.clear":           "Καθαρισμός φίλτρου",
      "cat.all":             "Όλα",
      "cat.micro":           "Μικροϊστορίες",
      "cat.haiku":           "Χάικου",
      "cat.poetry_free":     "Ελεύθερο ποίημα",
      "cat.poetry_metred":   "Μετρική ποίηση",
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
      "btn.copy":            "Αντιγραφή",
      "btn.useTitle":        "Άνοιγμα του θέματος στον Κειμενογράφο ως νέο έγγραφο",
      "btn.toggle":          "Παραλλαγή",
      "btn.favorite":         "Αγαπημένο",
      "btn.unfavorite":      "Αφαίρεση",
      "btn.complete":        "Ολοκλήρωσα",
      "btn.uncComplete":     "Αναίρεση",
      "daily.pulse":         "Καινούργιο σήμερα!",
      "streak.val":          "{n} συνεχόμενες ημέρες",
      "streak.zero":         "Δεν έχει ακόμα σειρά",
      "stats.total":         "Σύνολο θεμάτων",
      "stats.completed":     "Ολοκληρωμένα",
      "stats.favorites":     "Αγαπημένα",
      "stats.customs":       "Δικά μου",
      "daily.badge":         "Σήμερα",
      "stats.progress":      "Πρόοδος",
      "by.cat":              "Ανά κατηγορία",
      "empty.browse":        "Δεν βρέθηκαν θέματα — προσαρμόστε τα φίλτρα.",
      "saved.toast":         "Αντιγράφηκε στο πρόχειρο",
      "rst.btn":             "Επαναφορά εργοστασιακών",
      "rst.body":            "Θα διαγραφούν ΟΛΑ τα custom θέματα, αγαπημένα και σημεία ολοκλήρωσης από κάθε συγχρονισμένη συσκευή. Χωρίς αναίρεση.",
      "rst.cancel":          "Ακύρωση",
      "rst.done":            "Καθαρή αρχή — όλα διαγράφτηκαν",
      "settings.title":      "Ρυθμίσεις",
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
      "editor.errEmpty":      "Χρειάζονται και οι δύο γλώσσες",
      "io.save":              "Αρχείο orOS (.orosscript)",
      "io.files":             "Αρχεία",
      "io.open":              "Άνοιγμα αρχείου orOS (.orosscript)…",
      "io.folder":            "Αποσυμπιεσμένος φάκελος orOS…",
      "io.opened":            "Άνοιξε ως νέο θέμα",
      "io.bad":               "Δεν ήταν δυνατή η ανάγνωση του αρχείου",
      "io.newer":             "Το αρχείο φτιάχτηκε από νεότερο orOS. Ενημέρωσε το orOS για να το ανοίξεις.",
      "io.saved":             "Αποθηκεύτηκε",
      "io.saveFail":          "Δεν σώθηκε το αρχείο"
    }
  };

  if (window.orosI18n) window.orosI18n.table(STRINGS, "prompter", LANG);

  function t(key) {
    var p = STRINGS[LANG] || STRINGS.en;
    return p[key] !== undefined ? p[key]
         : (STRINGS.en[key] !== undefined ? STRINGS.en[key] : key);
  }

  // Category map — 10 categories; display names are STRINGS "cat.<id>"
  var CATEGORIES = [
    { id: "all" },
    { id: "micro" },
    { id: "haiku" },
    { id: "poetry_free" },
    { id: "poetry_metred" },
    { id: "song" },
    { id: "aphorism" },
    { id: "theatrical" },
    { id: "novel" },
    { id: "monologue" },
    { id: "letter" }
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
    {id: "p001", cat: "micro"},
    {id: "p002", cat: "micro"},
    {id: "p003", cat: "micro"},
    {id: "p004", cat: "micro"},
    {id: "p005", cat: "haiku"},
    {id: "p006", cat: "haiku"},
    {id: "p007", cat: "haiku"},
    {id: "p008", cat: "poetry_free"},
    {id: "p009", cat: "poetry_free"},
    {id: "p010", cat: "poetry_free"},
    {id: "p011", cat: "poetry_metred"},
    {id: "p012", cat: "poetry_metred"},
    {id: "p013", cat: "poetry_metred"},
    {id: "p014", cat: "song"},
    {id: "p015", cat: "song"},
    {id: "p016", cat: "song"},
    {id: "p017", cat: "aphorism"},
    {id: "p018", cat: "aphorism"},
    {id: "p019", cat: "aphorism"},
    {id: "p020", cat: "theatrical"},
    {id: "p021", cat: "theatrical"},
    {id: "p022", cat: "theatrical"},
    {id: "p023", cat: "novel"},
    {id: "p024", cat: "novel"},
    {id: "p025", cat: "novel"},
    {id: "p026", cat: "monologue"},
    {id: "p027", cat: "monologue"},
    {id: "p028", cat: "monologue"},
    {id: "p029", cat: "letter"},
    {id: "p030", cat: "letter"},
    {id: "p031", cat: "micro"},
    {id: "p032", cat: "micro"},
    {id: "p033", cat: "micro"},
    {id: "p034", cat: "haiku"},
    {id: "p035", cat: "haiku"},
    {id: "p036", cat: "haiku"},
    {id: "p037", cat: "poetry_free"},
    {id: "p038", cat: "poetry_free"},
    {id: "p039", cat: "poetry_free"},
    {id: "p040", cat: "poetry_metred"},
    {id: "p041", cat: "poetry_metred"},
    {id: "p042", cat: "poetry_metred"},
    {id: "p043", cat: "song"},
    {id: "p044", cat: "song"},
    {id: "p045", cat: "song"},
    {id: "p046", cat: "aphorism"},
    {id: "p047", cat: "aphorism"},
    {id: "p048", cat: "aphorism"},
    {id: "p049", cat: "theatrical"},
    {id: "p050", cat: "theatrical"},
    {id: "p051", cat: "theatrical"},
    {id: "p052", cat: "novel"},
    {id: "p053", cat: "novel"},
    {id: "p054", cat: "novel"},
    {id: "p055", cat: "monologue"},
    {id: "p056", cat: "monologue"},
    {id: "p057", cat: "monologue"},
    {id: "p058", cat: "letter"},
    {id: "p059", cat: "letter"},
    {id: "p060", cat: "letter"},
    {id: "p061", cat: "micro"},
    {id: "p062", cat: "micro"},
    {id: "p063", cat: "micro"},
    {id: "p064", cat: "haiku"},
    {id: "p065", cat: "haiku"},
    {id: "p066", cat: "haiku"},
    {id: "p067", cat: "poetry_free"},
    {id: "p068", cat: "poetry_free"},
    {id: "p069", cat: "poetry_free"},
    {id: "p070", cat: "poetry_metred"},
    {id: "p071", cat: "poetry_metred"},
    {id: "p072", cat: "poetry_metred"},
    {id: "p073", cat: "song"},
    {id: "p074", cat: "song"},
    {id: "p075", cat: "song"},
    {id: "p076", cat: "aphorism"},
    {id: "p077", cat: "aphorism"},
    {id: "p078", cat: "aphorism"},
    {id: "p079", cat: "theatrical"},
    {id: "p080", cat: "theatrical"},
    {id: "p081", cat: "theatrical"},
    {id: "p082", cat: "novel"},
    {id: "p083", cat: "novel"},
    {id: "p084", cat: "novel"},
    {id: "p085", cat: "monologue"},
    {id: "p086", cat: "monologue"},
    {id: "p087", cat: "monologue"},
    {id: "p088", cat: "letter"},
    {id: "p089", cat: "letter"},
    {id: "p090", cat: "letter"},
    {id: "p091", cat: "micro"},
    {id: "p092", cat: "micro"},
    {id: "p093", cat: "micro"},
    {id: "p094", cat: "haiku"},
    {id: "p095", cat: "haiku"},
    {id: "p096", cat: "haiku"},
    {id: "p097", cat: "poetry_free"},
    {id: "p098", cat: "poetry_free"},
    {id: "p099", cat: "poetry_free"},
    {id: "p100", cat: "poetry_free"}
  ];

  // Prompt texts by id ("<id>.var" = the variation), a language pack
  // brings its own. Each built-in gets en / el / var_en / var_el (the
  // custom prompts' shape) and, for a pack language, loc / var_loc.
  var PROMPT_TEXT = {
    en: {
      "p001": "Write a story in exactly 50 words about a door that shouldn't be opened.",
      "p001.var": "Without ever using the word 'door'",
      "p002": "A child finds a key in their lunchbox. What happens next?",
      "p002.var": "Make it exactly 75 words",
      "p003": "Two strangers meet on a train platform. They recognize each other from a dream.",
      "p003.var": "No dialogue allowed",
      "p004": "Describe a sunset from the perspective of someone who has never seen one.",
      "p004.var": "Without naming any colours",
      "p005": "Write a haiku about the silence between two people.",
      "p005.var": "No verbs",
      "p006": "Capture the moment when rain stops and birds resume singing.",
      "p006.var": "Never mention the rain itself",
      "p007": "Three lines about an empty chair at dinner.",
      "p007.var": "Each line anchored in one single sense",
      "p008": "Free verse about a letter you'll never send.",
      "p008.var": "Written entirely in second person",
      "p009": "Write about memory fading like old photographs.",
      "p009.var": "One phrase returns three times, slightly changed",
      "p010": "Poem about returning to a childhood home that no longer exists.",
      "p010.var": "The house itself speaks",
      "p011": "Write a sonnet about loss in iambic pentameter.",
      "p011.var": "The final line ends on a dash —",
      "p012": "Ten lines of rhyming couplets about hope.",
      "p012.var": "The final couplet reverses everything before it",
      "p013": "A villanelle about waiting.",
      "p013.var": "It must open and close on the same word",
      "p014": "Lyrics for a song about leaving your hometown.",
      "p014.var": "The chorus means something different each time it returns",
      "p015": "Write a bridge section that reveals a secret.",
      "p015.var": "Six lines maximum",
      "p016": "A ballad about a sailor who lost his way.",
      "p016.var": "The sailor never appears — only traces of him",
      "p017": "Compose an aphorism about truth and lies.",
      "p017.var": "Under 15 words",
      "p018": "Write something that sounds wise but isn't.",
      "p018.var": "Sign it as your own",
      "p019": "An aphorism about forgiveness that forgives nothing.",
      "p019.var": "Spoken in second person singular",
      "p020": "Monologue where a character confesses their greatest mistake.",
      "p020.var": "We never learn what it was",
      "p021": "Scene where two actors forget their lines mid-performance.",
      "p021.var": "They try to improvise through silence",
      "p022": "Dialogue between someone arriving and someone leaving.",
      "p022.var": "Neither speaks more than six words",
      "p023": "Opening paragraph of a mystery novel set in a small town.",
      "p023.var": "The narrator is unreliable from the first sentence",
      "p024": "Describe a protagonist who lies about their past.",
      "p024.var": "Only show us the truth indirectly",
      "p025": "Write a chapter about discovering a family secret.",
      "p025.var": "The discovery changes nothing immediately",
      "p026": "Address the audience directly about betrayal.",
      "p026.var": "You never explain what was betrayed",
      "p027": "A soliloquy about being trapped in your own mind.",
      "p027.var": "Three voices speak — one is yours",
      "p028": "Speak to your younger self about mistakes.",
      "p028.var": "Never say sorry",
      "p029": "Write a letter to your future self ten years from now.",
      "p029.var": "Include something you hope is no longer true",
      "p030": "Diary entry on the day everything changed.",
      "p030.var": "Nothing dramatic happens in the entry itself",
      "p031": "Someone wakes up and realizes they're living in a story they wrote.",
      "p031.var": "They try to edit reality",
      "p032": "A photograph develops backwards in a darkroom.",
      "p032.var": "What appears first is what disappears last",
      "p033": "You find your own name carved on a tree you've never visited.",
      "p033.var": "The carving looks ancient",
      "p034": "Snow falling on a sleeping dog.",
      "p034.var": "Never mention the cold",
      "p035": "Coffee cup cooling on a desk.",
      "p035.var": "The steam is the main character",
      "p036": "The sound of pages turning at night.",
      "p036.var": "No human presence ever stated",
      "p037": "About a voice that stopped answering.",
      "p037.var": "Written as a voicemail transcript",
      "p038": "What remains after a fire burns through memory.",
      "p038.var": "Three repeated fragments throughout",
      "p039": "Grief expressed as a physical object.",
      "p039.var": "The object weighs more than it should",
      "p040": "Elegy in blank verse for someone who never knew your name.",
      "p040.var": "Eleven syllables per line exactly",
      "p041": "Ballad meter about a journey that went wrong.",
      "p041.var": "Each stanza ends on an unresolved note",
      "p042": "Ode to something ordinary made extraordinary.",
      "p042.var": "The subject must be something mundane",
      "p043": "Chorus about coming home to a place that's forgotten you.",
      "p043.var": "The chorus repeats three times with different meanings",
      "p044": "Verse describing a crime without revealing who did it.",
      "p044.var": "Only witnesses speak",
      "p045": "Anthem for the quietly defeated.",
      "p045.var": "Everyone sings except the singer",
      "p046": "About wisdom gained through suffering.",
      "p046.var": "Sounds comforting but isn't",
      "p047": "A paradox about freedom and chains.",
      "p047.var": "Shorter than five words",
      "p048": "Something true spoken as a lie.",
      "p048.var": "The listener believes it anyway",
      "p049": "Two characters arguing over something that doesn't matter.",
      "p049.var": "Both are right and both are wrong",
      "p050": "A play within a play scene where reality blurs.",
      "p050.var": "The actors break character halfway",
      "p051": "Final curtain line that changes everything.",
      "p051.var": "It undermines the entire performance",
      "p052": "Flashback that contradicts what we thought was true.",
      "p052.var": "No one acknowledges the contradiction",
      "p053": "A character discovers they're a minor in someone else's story.",
      "p053.var": "They try to escape the narrative",
      "p054": "Setting described through sensory deprivation.",
      "p054.var": "Never describe what IS present",
      "p055": "Confronting a ghost from your past.",
      "p055.var": "The ghost never speaks",
      "p056": "Explaining why you can't forgive someone.",
      "p056.var": "The reason is selfish",
      "p057": "Talking to the mirror about who you've become.",
      "p057.var": "The reflection lies back",
      "p058": "Apology letter sent too late.",
      "p058.var": "The recipient is already dead",
      "p059": "Love letter you'll bury with you.",
      "p059.var": "Never addressed to anyone",
      "p060": "Journal entry before making an irreversible choice.",
      "p060.var": "You don't know what choice it is",
      "p061": "Your shadow detaches and walks away.",
      "p061.var": "You can't catch it",
      "p062": "A clock that counts backwards.",
      "p062.var": "It's counting down to nothing",
      "p063": "Meeting yourself from parallel universe.",
      "p063.var": "Neither is surprised",
      "p064": "Footsteps fading down a hallway.",
      "p064.var": "The source is never shown",
      "p065": "Window fogged by winter breath.",
      "p065.var": "Condensation draws a face",
      "p066": "First light touching empty room.",
      "p066.var": "Dust particles become stars",
      "p067": "Language breaking down at the edge of meaning.",
      "p067.var": "Words dissolve mid-sentence",
      "p068": "Body as landscape of memory.",
      "p068.var": "Scars are geographical features",
      "p069": "Silence louder than any scream.",
      "p069.var": "No description of the silence itself",
      "p070": "Limerick series about absurd fears.",
      "p070.var": "All five limericks rhyme the same",
      "p071": "Pantoum about repeating patterns.",
      "p071.var": "Meaning reverses each repetition",
      "p072": "Sestina about six lost things.",
      "p072.var": "The six words spiral toward nothing",
      "p073": "Love song from the wrong person's perspective.",
      "p073.var": "The beloved never knew",
      "p074": "Work song for people who dig holes.",
      "p074.var": "The rhythm matches digging strokes",
      "p075": "Lullaby for grown children who left.",
      "p075.var": "Sung backwards",
      "p076": "On beauty and its cruelty.",
      "p076.var": "Beauty wins at the end",
      "p077": "What we owe to those who can't thank us.",
      "p077.var": "The debt grows",
      "p078": "The cost of staying silent.",
      "p078.var": "Calculate it in years",
      "p079": "Trial scene where guilt is assumed.",
      "p079.var": "The defense is not for innocence",
      "p080": "Comedy of misunderstandings ending badly.",
      "p080.var": "Nobody learns anything",
      "p081": "Horror revealed through absence, not presence.",
      "p081.var": "The missing thing is never named",
      "p082": "Narrator unreliable from the first sentence.",
      "p082.var": "The truth emerges in contradictions",
      "p083": "World rebuilt after everyone forgot.",
      "p083.var": "Old ruins remain unexplained",
      "p084": "Time travel consequences discovered generations later.",
      "p084.var": "No one connects them to the past",
      "p085": "Prayer said without belief.",
      "p085.var": "Answered anyway",
      "p086": "Threat disguised as a compliment.",
      "p086.var": "Delivered with a smile",
      "p087": "Last words before jumping.",
      "p087.var": "They're an apology to someone else",
      "p088": "Resignation letter with no reason given.",
      "p088.var": "The employer already knows why",
      "p089": "Proposal written to someone who can't read.",
      "p089.var": "Written in Braille",
      "p090": "Receipt of something priceless mailed by accident.",
      "p090.var": "The sender wants it back",
      "p091": "Plant growing inside a locked safe.",
      "p091.var": "No light enters",
      "p092": "Mirror reflecting something that isn't there.",
      "p092.var": "The reflection moves independently",
      "p093": "Whisper heard in an empty building.",
      "p093.var": "Multiple voices overlap",
      "p094": "Dust motes dancing in sunlight.",
      "p094.var": "Time stands still",
      "p095": "Door slowly closing on its own.",
      "p095.var": "Nobody touched it",
      "p096": "Tea gone cold on the table.",
      "p096.var": "The cup is half-full",
      "p097": "Bodies remembered in scars.",
      "p097.var": "Each scar tells a different story",
      "p098": "Names erased from headstones.",
      "p098.var": "Wind remembers them",
      "p099": "Hunger disguised as appetite.",
      "p099.var": "Food goes untouched",
      "p100": "Everything you wanted to say in one breath.",
      "p100.var": "Cut off before completion"
    },
    el: {
      "p001": "Γράψε μια ιστορία σε ακριβώς 50 λέξεις για μια πόρτα που δεν έπρεπε να ανοίξει.",
      "p001.var": "Να μη χρησιμοποιήσεις ούτε μία φορά τη λέξη «πόρτα»",
      "p002": "Ένα παιδί βρίσκει ένα κλειδί στο κουτί του γεύματός του. Τι συμβαίνει μετά;",
      "p002.var": "Σε ακριβώς 75 λέξεις",
      "p003": "Δύο άγνωστοι συναντιούνται σε μια αποβάθρα. Αναγνωρίζουν ο ένας τον άλλον από ένα όνειρο.",
      "p003.var": "Χωρίς κανέναν διάλογο",
      "p004": "Περιγράψε ένα ηλιοβασίλεμα με τα μάτια κάποιου που το βλέπει για πρώτη φορά.",
      "p004.var": "Χωρίς να αναφέρεις ούτε ένα χρώμα",
      "p005": "Γράψε ένα χαϊκού για τη σιωπή ανάμεσα σε δύο ανθρώπους.",
      "p005.var": "Χωρίς ρήματα",
      "p006": "Σύλλαβε τη στιγμή που κόβει η βροχή και τα πουλιά ξαναρχίζουν το τραγούδι τους.",
      "p006.var": "Η βροχή να μη μπαίνει ποτέ στο ποίημα",
      "p007": "Τρεις στίχοι για μια άδεια καρέκλα στο τραπέζι του δείπνου.",
      "p007.var": "Κάθε στίχος βασισμένος σε μία μόνο αίσθηση",
      "p008": "Ελεύθερος στίχος για μια επιστολή που δεν θα σταλεί ποτέ.",
      "p008.var": "Ολόκληρο σε δεύτερο πρόσωπο",
      "p009": "Γράψε για τη μνήμη που ξεθωριάζει, σαν παλιές φωτογραφίες.",
      "p009.var": "Μία φράση να επανέρχεται τρεις φορές, αλλάζοντας λίγο κάθε φορά",
      "p010": "Ποίημα για την επιστροφή σε ένα παιδικό σπίτι που δεν υπάρχει πια.",
      "p010.var": "Το ποίημα να το λέει το ίδιο το σπίτι",
      "p011": "Γράψε ένα σονέτο για την απώλεια σε ιαμβικό πεντάμετρο.",
      "p011.var": "Ο τελευταίος στίχος να τελειώνει με παύλα —",
      "p012": "Δέκα στίχοι σε ομοιοκατάληκτα δίστιχα για την ελπίδα.",
      "p012.var": "Το τελευταίο δίστιχο να ανατρέπει όσα προηγήθηκαν",
      "p013": "Μια βιλανέλ για την αναμονή.",
      "p013.var": "Να ξεκινά και να τελειώνει με την ίδια λέξη",
      "p014": "Στίχοι για ένα τραγούδι για την ώρα που φεύγεις από την πατρίδα.",
      "p014.var": "Το ρεφρέν να σημαίνει κάτι διαφορετικό κάθε φορά που επανέρχεται",
      "p015": "Γράψε ένα bridge που αποκαλύπτει ένα μυστικό.",
      "p015.var": "Έξι γραμμές το πολύ",
      "p016": "Μια μπαλάντα για έναν ναύτη που έχασε τον δρόμο του γυρισμού.",
      "p016.var": "Ο ναύτης να μην εμφανίζεται ποτέ — μόνο τα ίχνη του",
      "p017": "Γράψε έναν αφορισμό για την αλήθεια και το ψέμα.",
      "p017.var": "Το πολύ 15 λέξεις",
      "p018": "Γράψε κάτι που ακούγεται σοφό — αλλά δεν είναι.",
      "p018.var": "Να το υπογράψεις σαν δικό σου",
      "p019": "Αφορισμός για μια συγχώρεση που δεν συγχωρεί τίποτα.",
      "p019.var": "Σε δεύτερο ενικό",
      "p020": "Μονόλογος όπου ένας χαρακτήρας εξομολογείται το μεγαλύτερό του λάθος.",
      "p020.var": "Να μη μάθουμε ποτέ τι ήταν",
      "p021": "Σκηνή όπου δύο ηθοποιοί ξεχνούν τους στίχους τους στη μέση μιας παράστασης.",
      "p021.var": "Προσπαθούν να προχωρήσουν μέσω της σιωπής",
      "p022": "Διάλογος ανάμεσα σε κάποιον που μόλις έφτασε και κάποιον που φεύγει.",
      "p022.var": "Κανείς δεν μιλάει πάνω από έξι λέξεις",
      "p023": "Εναρκτήρια παράγραφος αστυνομικού μυθιστορήματος σε μια μικρή πόλη.",
      "p023.var": "Ο αφηγητής είναι αναξιόπιστος από την πρώτη πρόταση",
      "p024": "Περιγραφή ενός πρωταγωνιστή που λέει ψέματα για το παρελθόν του.",
      "p024.var": "Να βλέπουμε την αλήθεια μόνο έμμεσα",
      "p025": "Γράψε ένα κεφάλαιο για την ανακάλυψη ενός οικογενειακού μυστικού.",
      "p025.var": "Η ανακάλυψη δεν αλλάζει τίποτα αμέσως",
      "p026": "Μίλα απευθείας στο κοινό για μια προδοσία.",
      "p026.var": "Να μην εξηγήσεις ποτέ τι προδώθηκε",
      "p027": "Εσωτερικός μονόλογος για την παγίδα μέσα στον ίδιο σου τον νου.",
      "p027.var": "Τρεις φωνές μιλάνε — μία από αυτές είναι η δική σου",
      "p028": "Μίλα στον νεαρότερο εαυτό σου για λάθη.",
      "p028.var": "Να μην πεις ποτέ «συγγνώμη»",
      "p029": "Γράψε μια επιστολή στον εαυτό σου σε δέκα χρόνια.",
      "p029.var": "Να περιλαμβάνει κάτι που ελπίζεις πως δεν θα ισχύει πια",
      "p030": "Ημερολογιακή εγγραφή της ημέρας που όλα άλλαξαν.",
      "p030.var": "Τίποτα δραματικό να μην συμβεί στην ίδια την εγγραφή",
      "p031": "Κάποιος ξυπνά και συνειδητοποιεί ότι ζει μέσα σε μια ιστορία που έγραψε ο ίδιος.",
      "p031.var": "Προσπαθεί να επεξεργαστεί την πραγματικότητα",
      "p032": "Μια φωτογραφία εμφανίζεται ανάποδα στο σκοτεινό δωμάτιο.",
      "p032.var": "Τι φαίνεται πρώτο — είναι αυτό που χάνεται τελευταίο",
      "p033": "Βρίσκεις το όνομά σου χαραγμένο σε ένα δέντρο που ποτέ δεν είχες δει.",
      "p033.var": "Το χάραγμα να μοιάζει πανάρχαιο",
      "p034": "Χιόνι πέφτει πάνω σε ένα κοιμισμένο σκυλί.",
      "p034.var": "Καμία αναφορά στο κρύο",
      "p035": "Φλιτζάνι καφέ να κρυώνει σε ένα γραφείο.",
      "p035.var": "Ο ατμός να είναι ο κύριος χαρακτήρας",
      "p036": "Ο ήχος από σελίδες που γυρίζουν τη νύχτα.",
      "p036.var": "Καμία ανθρώπινη παρουσία να μην αναφερθεί",
      "p037": "Για μια φωνή που σταμάτησε να απαντά.",
      "p037.var": "Σαν απομαγνητοφώνηση τηλεφωνητή",
      "p038": "Τι μένει όταν μια φωτιά έχει καεί μέσα στη μνήμη.",
      "p038.var": "Τρία επαναλαμβανόμενα αποσπάσματα σε όλο το ποίημα",
      "p039": "Πένθος εκφρασμένο ως υλικό αντικείμενο.",
      "p039.var": "Το αντικείμενο ζυγίζει περισσότερο από όσο θα έπρεπε",
      "p040": "Επιτάφιο σε λευκό στίχο για κάποιον που ποτέ δεν έμαθε το όνομά σου.",
      "p040.var": "Ακριβώς ένδεκα συλλαβές ανά στίχο",
      "p041": "Μπαλάντα για ένα ταξίδι που πήγε στραβά.",
      "p041.var": "Κάθε στροφή να τελειώνει σε ανολοκλήρωτο τόνο",
      "p042": "Ωδή σε κάτι συνηθισμένο που έγινε εξαιρετικό.",
      "p042.var": "Θέμα να είναι κάτι καθημερινό",
      "p043": "Ρεφρέν για την επιστροφή σε μέρος που σε έχει ξεχάσει.",
      "p043.var": "Το ρεφρέν να επαναληφθεί τρεις φορές με διαφορετική σημασία",
      "p044": "Στίχος που περιγράφει έγκλημα χωρίς να αποκαλύπτει τον δράστη.",
      "p044.var": "Μιλάει μόνο ο μάρτυρας",
      "p045": "Ύμνος για τους ήσυχα ηττημένους.",
      "p045.var": "Όλοι τραγουδούν — εκτός από τον τραγουδιστή",
      "p046": "Για τη σοφία που κερδίζεται μέσω του πόνου.",
      "p046.var": "Ακούγεται παρηγορητικό — αλλά δεν είναι",
      "p047": "Ένα παράδοξο για ελευθερία και αλυσίδες.",
      "p047.var": "Λιγότερο από πέντε λέξεις",
      "p048": "Κάτι αληθινό ειπωμένο ως ψέμα.",
      "p048.var": "Ο ακροατής το πιστεύει παρ' όλα αυτά",
      "p049": "Δύο χαρακτήρες μαλώνουν για κάτι που δεν έχει καμία σημασία.",
      "p049.var": "Και οι δύο έχουν δίκιο και άδικο ταυτόχρονα",
      "p050": "Σκηνή «παιχνίδι μέσα στο παιχνίδι» όπου θολώνει η πραγματικότητα.",
      "p050.var": "Οι ηθοποιοί διακόπτουν τον χαρακτήρα τους στη μέση",
      "p051": "Η τελευταία φράση της αυλαίας αλλάζει τα πάντα.",
      "p051.var": "Να ανατρέπει ολόκληρη την παράσταση",
      "p052": "Αναδρομή που αντιφάσκει με ό,τι νομίζαμε ότι ήταν αλήθεια.",
      "p052.var": "Κανείς να μην αναγνωρίσει την αντίφαση",
      "p053": "Ένας χαρακτήρας ανακαλύπτει ότι είναι δευτερεύων στην ιστορία κάποιου άλλου.",
      "p053.var": "Προσπατεί να δραπετεύσει από την αφήγηση",
      "p054": "Περιβάλλον περιγραφόμενο μέσω στέρησης αισθήσεων.",
      "p054.var": "Να μην περιγράψεις ποτέ τι υπάρχει",
      "p055": "Σύγκρουση με ένα φάντασμα από το παρελθόν σου.",
      "p055.var": "Το φάντασμα να μην μιλήσει ποτέ",
      "p056": "Εξήγηση γιατί δεν μπορείς να συγχωρέσεις κάποιον.",
      "p056.var": "Ο λόγος να είναι εγωιστικός",
      "p057": "Μιλώντας στον καθρέφτη για το ποιος έγινες.",
      "p057.var": "Η αντανάκλαση να ψεύδεται πίσω",
      "p058": "Επιστολή συγγνώμης που στάλθηκε πολύ αργά.",
      "p058.var": "Ο παραλήπτης είναι ήδη νεκρός",
      "p059": "Ερωτική επιστολή που θα θαφτεί μαζί σου.",
      "p059.var": "Να μην απευθύνεται σε κανέναν",
      "p060": "Ημερολογιακή εγγραφή πριν πάρεις μια μη αναστρέψιμη απόφαση.",
      "p060.var": "Δεν ξέρεις ποια είναι η επιλογή",
      "p061": "Η σκιά σου ξεκολλάει και φεύγει περπατώντας.",
      "p061.var": "Δεν μπορείς να την πιάσεις",
      "p062": "Ένα ρολόι που μετράει προς τα πίσω.",
      "p062.var": "Μετράει προς το τίποτα",
      "p063": "Συνάντηση με τον εαυτό σου από παράλληλο σύμπαν.",
      "p063.var": "Κανείς δεν εκπλήσσεται",
      "p064": "Βήματα που εξασθενούν μέσα σε διάδρομο.",
      "p064.var": "Η πηγή να μην φαίνεται ποτέ",
      "p065": "Παράθυρο θολό από χειμωνιάτικη ανάσα.",
      "p065.var": "Ο ατμός να ζωγραφίζει πρόσωπο",
      "p066": "Πρώτο φως που ακουμπά άδειο δωμάτιο.",
      "p066.var": "Τα σωματίδια σκόνης να γίνουν άστρα",
      "p067": "Γλώσσα που διαλύεται στο χείλος της σημασίας.",
      "p067.var": "Λέξεις να διαλύονται στη μέση του στίχου",
      "p068": "Σώμα ως τοπίο μνήμης.",
      "p068.var": "Τα σημάδια να είναι γεωγραφικά χαρακτηριστικά",
      "p069": "Σιωπή πιο δυνατή από κάθε κραυγή.",
      "p069.var": "Καμία περιγραφή της ίδιας της σιωπής",
      "p070": "Σειρά λίμερικ για παράλογους φόβους.",
      "p070.var": "Και τα πέντε λίμερικ να ομοιοκαταληκτούν με τον ίδιο τρόπο",
      "p071": "Παντούμ για επαναλαμβανόμενα μοτίβα.",
      "p071.var": "Η σημασία να αντιστρέφεται σε κάθε επανάληψη",
      "p072": "Σεστίνα για έξι χαμένα αντικείμενα.",
      "p072.var": "Οι έξι λέξεις να περιστρέφουν προς το τίποτα",
      "p073": "Τραγούδι αγάπης από τη λάθος οπτική.",
      "p073.var": "Ο/η αγαπημένος/η δεν το έμαθε ποτέ",
      "p074": "Τραγούδι εργασίας για ανθρώπους που σκάβουν τρύπες.",
      "p074.var": "Ο ρυθμός να ακολουθεί τους χτύπους του φτυαριού",
      "p075": "Νανούρισμα για ενήλικα παιδιά που έφυγαν.",
      "p075.var": "Τραγουδημένο ανάποδα",
      "p076": "Για την ομορφιά και την ωμότητά της.",
      "p076.var": "Η ομορφιά να κερδίζει στο τέλος",
      "p077": "Τι οφείλουμε σε όσους δεν μπορούν να μας ευχαριστήσουν.",
      "p077.var": "Το χρέος να μεγαλώνει",
      "p078": "Το κόστος της σιωπής.",
      "p078.var": "Υπολόγισέ το σε χρόνια",
      "p079": "Σκηνή δίκης όπου η ενοχή υποτίθεται.",
      "p079.var": "Η άμυνα να μην είναι για αθωότητα",
      "p080": "Κωμωδία παρεξηγήσεων που καταλήγει άσχημα.",
      "p080.var": "Κανείς να μην μάθει τίποτα",
      "p081": "Τρόμος αποκαλύπτεται μέσω απουσίας, όχι παρουσίας.",
      "p081.var": "Το χαμένο αντικείμενο να μην ονομαστεί ποτέ",
      "p082": "Αφηγητής αναξιόπιστος από την πρώτη πρόταση.",
      "p082.var": "Η αλήθεια να αναδυθεί μέσα στις αντιφάσεις",
      "p083": "Κόσμος ανοικοδομημένος αφού όλοι ξέχασαν.",
      "p083.var": "Τα παλιά ερείπια να παραμένουν ανεξήγητα",
      "p084": "Συνέπειες ταξιδιού χρόνου που ανακαλύπτονται γενιές μετά.",
      "p084.var": "Κανείς να μην τις συνδέσει με το παρελθόν",
      "p085": "Προσευχή ειπωμένη χωρίς πίστη.",
      "p085.var": "Απαντημένη παρ' όλα αυτά",
      "p086": "Απειλή μεταμφιεσμένη ως έπαινος.",
      "p086.var": "Ειπωμένη με ένα χαμόγελο",
      "p087": "Τελευταία λόγια πριν πηδήξει.",
      "p087.var": "Να είναι συγγνώμη προς κάποιον άλλο",
      "p088": "Επιστολή παραίτησης χωρίς να δίνεται λόγος.",
      "p088.var": "Ο εργοδότης έχει ήδη καταλάβει",
      "p089": "Πρόταση γραμμένη σε κάποιον που δεν διαβάζει.",
      "p089.var": "Γραμμένη σε μπραϊγ",
      "p090": "Απόδειξη για κάτι ανεκτίμητο που στάλθηκε κατά λάθος.",
      "p090.var": "Ο αποστολέας το θέλει πίσω",
      "p091": "Φυτό που φυτρώνει μέσα σε κλειστό θησαυροφυλάκιο.",
      "p091.var": "Καμία φάση φωτός να μην μπαίνει",
      "p092": "Καθρέφτης που αντανακλά κάτι που δεν υπάρχει.",
      "p092.var": "Η αντανάκλαση να κινείται ανεξάρτητα",
      "p093": "Ψιθυριστό που ακούγεται σε άδειο κτίριο.",
      "p093.var": "Πολλές φωνές να επικαλύπτονται",
      "p094": "Σκόνη που χορεύει στο ηλιακό φως.",
      "p094.var": "Ο χρόνος να σταματήσει",
      "p095": "Πόρτα που κλείνει αργά από μόνη της.",
      "p095.var": "Κανείς να μην την ακούμπησε",
      "p096": "Τσάι κρύο στο τραπέζι.",
      "p096.var": "Το φλιτζάνι να είναι μισογεμάτο",
      "p097": "Σώματα θυμόμαστε στα σημάδια.",
      "p097.var": "Κάθε σημάδι να λέει άλλη ιστορία",
      "p098": "Ονόματα σβησμένα από ταφικά μνημεία.",
      "p098.var": "Ο άνεμος να τα θυμάται",
      "p099": "Πείνα μεταμφιεσμένη ως όρεξη.",
      "p099.var": "Το φαγητό να μένει ανέγγιχτο",
      "p100": "Όλα όσα ήθελες να πεις σε μια ανάσα.",
      "p100.var": "Να διακοπεί πριν ολοκληρωθεί"
    }
  };
  if (window.orosI18n) window.orosI18n.table(PROMPT_TEXT, "prompter", LANG);
  PROMPTS_DATA.forEach(function (p) {
    p.en = PROMPT_TEXT.en[p.id]; p.el = PROMPT_TEXT.el[p.id];
    p.var_en = PROMPT_TEXT.en[p.id + ".var"] || ""; p.var_el = PROMPT_TEXT.el[p.id + ".var"] || "";
    if (LANG !== "en" && LANG !== "el" && PROMPT_TEXT[LANG]) {
      p.loc = PROMPT_TEXT[LANG][p.id]; p.var_loc = PROMPT_TEXT[LANG][p.id + ".var"] || "";
    }
  });
  // The text shown for a prompt: a pack language's for built-ins, else
  // Greek in Greek and English otherwise (custom prompts have en / el).
  function pText(p) { return p.loc !== undefined ? p.loc : (LANG === "el" ? p.el : p.en); }
  function pVar(p) { return (p.var_loc !== undefined ? p.var_loc : (LANG === "el" ? p.var_el : p.var_en)) || ""; }
  
    // ---------- 1b. Tag system ----------
  // Controlled vocabulary (57 tags). Every tag below exists in TAG_LABELS
  // and every PROMPT_TAGS id references a valid key — zero orphans by design.
  var TAG_TEXT = {
    en: {
      "tags.absence": "Absence",
      "tags.betrayal": "Betrayal",
      "tags.body": "Body",
      "tags.childhood": "Childhood",
      "tags.comedy": "Comedy",
      "tags.confession": "Confession",
      "tags.crime": "Crime",
      "tags.death": "Death",
      "tags.doubt": "Doubt",
      "tags.dream": "Dream",
      "tags.everyday": "Everyday",
      "tags.faith": "Faith",
      "tags.family": "Family",
      "tags.farewell": "Farewell",
      "tags.fear": "Fear",
      "tags.fire": "Fire",
      "tags.gratitude": "Gratitude",
      "tags.grief": "Grief",
      "tags.hope": "Hope",
      "tags.horror": "Horror",
      "tags.hunger": "Hunger",
      "tags.identity": "Identity",
      "tags.illusion": "Illusion",
      "tags.journey": "Journey",
      "tags.justice": "Justice",
      "tags.key": "Key",
      "tags.language": "Language",
      "tags.light": "Light",
      "tags.loss": "Loss",
      "tags.love": "Love",
      "tags.memory": "Memory",
      "tags.mirror": "Mirror",
      "tags.mystery": "Mystery",
      "tags.nature": "Nature",
      "tags.night": "Night",
      "tags.rain": "Rain",
      "tags.regret": "Regret",
      "tags.sea": "Sea",
      "tags.secret": "Secret",
      "tags.shadow": "Shadow",
      "tags.silence": "Silence",
      "tags.snow": "Snow",
      "tags.solitude": "Solitude",
      "tags.sound": "Sound",
      "tags.stranger": "Stranger",
      "tags.theatre": "Theatre",
      "tags.time": "Time",
      "tags.truth": "Truth",
      "tags.waiting": "Waiting",
      "tags.wisdom": "Wisdom",
      "tags.winter": "Winter",
      "tags.work": "Work",
      "tags.door": "Door",
      "tags.forgiveness": "Forgiveness",
      "tags.home": "Home",
      "tags.longing": "Longing"
    },
    el: {
      "tags.absence": "Απουσία",
      "tags.betrayal": "Προδοσία",
      "tags.body": "Σώμα",
      "tags.childhood": "Παιδικά χρόνια",
      "tags.comedy": "Κωμωδία",
      "tags.confession": "Εξομολόγηση",
      "tags.crime": "Έγκλημα",
      "tags.death": "Θάνατος",
      "tags.doubt": "Αμφιβολία",
      "tags.dream": "Όνειρο",
      "tags.everyday": "Καθημερινότητα",
      "tags.faith": "Πίστη",
      "tags.family": "Οικογένεια",
      "tags.farewell": "Αποχαιρετισμός",
      "tags.fear": "Φόβος",
      "tags.fire": "Φωτιά",
      "tags.gratitude": "Ευγνωμοσύνη",
      "tags.grief": "Πένθος",
      "tags.hope": "Ελπίδα",
      "tags.horror": "Τρόμος",
      "tags.hunger": "Πείνα",
      "tags.identity": "Ταυτότητα",
      "tags.illusion": "Ψευδαίσθηση",
      "tags.journey": "Ταξίδι",
      "tags.justice": "Δικαιοσύνη",
      "tags.key": "Κλειδί",
      "tags.language": "Γλώσσα",
      "tags.light": "Φως",
      "tags.loss": "Απώλεια",
      "tags.love": "Αγάπη",
      "tags.memory": "Μνήμη",
      "tags.mirror": "Καθρέφτης",
      "tags.mystery": "Μυστήριο",
      "tags.nature": "Φύση",
      "tags.night": "Νύχτα",
      "tags.rain": "Βροχή",
      "tags.regret": "Μεταμέλεια",
      "tags.sea": "Θάλασσα",
      "tags.secret": "Μυστικό",
      "tags.shadow": "Σκιά",
      "tags.silence": "Σιωπή",
      "tags.snow": "Χιόνι",
      "tags.solitude": "Ερημιά",
      "tags.sound": "Ήχος",
      "tags.stranger": "Άγνωστος",
      "tags.theatre": "Θέατρο",
      "tags.time": "Χρόνος",
      "tags.truth": "Αλήθεια",
      "tags.waiting": "Αναμονή",
      "tags.wisdom": "Σοφία",
      "tags.winter": "Χειμώνας",
      "tags.work": "Εργασία",
      "tags.door": "Πόρτα",
      "tags.forgiveness": "Συγχώρεση",
      "tags.home": "Σπίτι",
      "tags.longing": "Λαχτάρα"
    }
  };
  if (window.orosI18n) window.orosI18n.table(TAG_TEXT, "prompter", LANG);
  // TAG_LABELS[id] = { en, el, loc }: both languages for search, loc shown.
  var TAG_LABELS = {};
  Object.keys(TAG_TEXT.en).forEach(function (k) {
    var id = k.slice(5);
    TAG_LABELS[id] = { en: TAG_TEXT.en[k], el: TAG_TEXT.el[k], loc: (TAG_TEXT[LANG] || TAG_TEXT.en)[k] };
  });

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
      sm: 0,           // PM-6: no "now" in a fresh state (Q3)
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
    var raw = null;
    try {
      raw = localStorage.getItem(STORAGE_KEY);
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
    // PM-5: unreadable data is copied aside before the fresh state is
    // written over it (rescue backup before any reseed).
    if (raw) {
      try { localStorage.setItem(STORAGE_KEY + "-broken", raw); } catch (e2) { /* quota */ }
    }
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

  // PM-2: tombstone namespaces inside the ONE `deleted` map.
  //   deleted[id]          → the custom prompt `id` was deleted (and, from
  //                          devices on the previous version, ANY removal
  //                          of id: unstar, un-done, delete — legacy)
  //   deleted["fav:"+id]   → id was unstarred        (written since PM-2)
  //   deleted["done:"+id]  → id was marked not done  (written since PM-2)
  // Before PM-2 an unstar wrote deleted[id], and the merge used that one
  // stamp for favorites, completions AND customs: unstarring a custom
  // prompt deleted the prompt itself on the next sync, and unstarring a
  // completed prompt erased its completion. Prefixed keys ride through
  // the previous version untouched (it unions `deleted` by max and only
  // ever looks up plain ids), so the change is additive both ways.
  var TOMB_FAV = "fav:", TOMB_DONE = "done:";

  function mergePrompterStates(A, B) {
    var a = A || {}, b = B || {};
    var tomb = {};
    var tombIn = function(side){
      var d = side.deleted;
      if (!d || typeof d !== "object") return;
      Object.keys(d).forEach(function(id){
        if (typeof d[id] !== "number" || !isFinite(d[id])) return;
        tomb[id] = Math.max(tomb[id] || 0, d[id]);
      });
    };
    tombIn(a); tombIn(b);

    // alive = no tombstone, or content newer than the tombstone
    // (resurrection contract — same as mood/weather). `ns` selects the
    // namespaced tombstone (PM-2); a plain legacy tombstone still counts
    // for favorites and completions (an older device's unstar / un-done
    // must keep working), but only a plain one deletes a custom.
    var alive = function(id, mtime, ns){
      var t = tomb[id] || 0;
      if (ns) t = Math.max(t, tomb[ns + id] || 0);
      return !t || ((mtime || 0) > t);
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
      if (!alive(id, favorites[id], TOMB_FAV)) delete favorites[id];
    });

    var completed = {};
    [a.completed, b.completed].forEach(function(cm){
      if (!cm || typeof cm !== "object") return;
      Object.keys(cm).forEach(function(id){
        if (typeof cm[id] !== "number" || !alive(id, cm[id], TOMB_DONE)) return;
        completed[id] = Math.max(completed[id] || 0, cm[id]);
      });
    });

    // PM-1: a custom present on ONE side only used to reach
    // newerTs(undefined, c) and throw — the whole prompter slice
    // stopped syncing (since SY-D6; before it, the cloud copy replaced
    // this device's data). Rows without a string id are dropped.
    var customsMap = {};
    [a.customs, b.customs].forEach(function(list){
      if (!Array.isArray(list)) return;
      list.forEach(function(c){
        if (!c || typeof c !== "object" || typeof c.id !== "string" || !c.id) return;
        customsMap[c.id] = customsMap[c.id] ? newerTs(customsMap[c.id], c) : c;
      });
    });
    var customs = [];
    Object.keys(customsMap).forEach(function(id){
      if (alive(id, customsMap[id].mtime)) customs.push(customsMap[id]);
    });

    return canonState({
      ver: DATA_VER,
      sm: Math.max(a.sm||0, b.sm||0),
      favorites: favorites,
      completed: completed,
      customs: customs,
      deleted: tomb
    });
  }

  // PM-3: ONE canonical form for the getter and the merge (R26). Map
  // keys sorted (key order used to follow the argument order, so
  // merge(A,B) and merge(B,A) differed in bytes); customs by pos, then
  // id; tombstones pruned by DATA time with the same rule in both
  // places (only the getter pruned before, so getter ≠ merge).
  function sortedMap(m){
    var out = {};
    if (!m || typeof m !== "object") return out;
    Object.keys(m).sort().forEach(function(k){ out[k] = m[k]; });
    return out;
  }
  function canonState(st){
    var out = {
      ver: DATA_VER,
      sm: (typeof st.sm === "number" && isFinite(st.sm)) ? st.sm : 0,
      favorites: sortedMap(st.favorites),
      completed: sortedMap(st.completed),
      customs: (st.customs || []).slice().sort(function(x,y){ return (x.pos||0)-(y.pos||0) || (x.id<y.id?-1:x.id>y.id?1:0); }),   // pos, then id — deterministic across devices
      deleted: sortedMap(st.deleted)
    };
    // Deterministic tombstone pruning (HB-3 / MD-4 / NT-2 pattern): the
    // cutoff derives from the dataset's newest timestamp, never the wall
    // clock — same data yields the same payload on every device.
    var maxTs = 0, id;
    for (id in out.favorites) if ((out.favorites[id] || 0) > maxTs) maxTs = out.favorites[id];
    for (id in out.completed) if ((out.completed[id] || 0) > maxTs) maxTs = out.completed[id];
    for (id in out.deleted) if ((out.deleted[id] || 0) > maxTs) maxTs = out.deleted[id];
    out.customs.forEach(function (c) { if ((c.mtime || 0) > maxTs) maxTs = c.mtime; });
    var cutoff = maxTs - TOMB_PRUNE_DAYS * DAY_MS;
    for (id in out.deleted) if ((out.deleted[id] || 0) < cutoff) delete out.deleted[id];
    return out;
  }

  // ---------- 5. Sync slice + wiring ----------
  function registerSync() {
    var api = (window.parent && window.parent.orosSync) || window.orosSync;
    window.__orosSyncApi = { _suppress:false, dirty:function(){ if(this._suppress)return; if(api&&api.markDirty) api.markDirty(); }};
    if (!api || typeof api.registerSlice !== "function") return;
    api.registerSlice("prompter", sliceGet, sliceSet, STORAGE_KEY, mergePrompterStates);
  }

  function sliceGet() {
    // PR-2: deep-copy (the engine JSON-stringifies for comparison).
    // PM-3: canonical form shared with the merge (pruning included).
    // Payload-only: local state keeps everything.
    return canonState(JSON.parse(JSON.stringify(state)));
  }
  function sliceSet(data, info) {
    data = JSON.parse(JSON.stringify(data||null));
    if (!data || data.favorites === undefined) return;
    normalizeFavs(data);
    // PR-4: defensive guards — same contract as load(). A crafted or
    // partial payload must never null-ify completed/customs/deleted
    // (isCompleted/deletion paths would throw on undefined maps).
    if (typeof data.completed !== "object" || data.completed === null) data.completed = {};
    if (!Array.isArray(data.customs)) data.customs = [];
    if (typeof data.deleted !== "object" || data.deleted === null) data.deleted = {};
    // PM-3: an echo of what we already hold changes nothing — no
    // rebuild of the open view (search caret) and no storage write.
    if (JSON.stringify(canonState(data)) === JSON.stringify(canonState(state))) return;
    window.__orosSyncApi._suppress = true;
    try { state = data; localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }
    catch (e) { /* quota — state is live in memory, next save retries */ }
    finally { window.__orosSyncApi._suppress = false; }
    // Keep the caret in the search field across the re-render.
    var ae = document.activeElement;
    if (ae && ae.classList && ae.classList.contains("search-input")) searchFocus = true;
    renderAll();
    // PR-1a-6: sync.pull toast removed (Notes Wave 11 doctrine) —
    // info.merged means "the merge engine ran", not "data changed".
    // Sync feedback = the taskbar sync dot, never a per-sync toast.
  }

  // Toast (lazy, top-right)
  var toastEl=null, toastTimer=null, toastAction=null;
  function showToast(text, actionLabel, actionFn) {
    if(!toastEl){
      toastEl=document.createElement("div");
      toastEl.style.cssText="position:fixed;top:calc(12px + env(safe-area-inset-top, 0px));right:12px;z-index:1200;background:var(--panel-bg);border:1px solid var(--border);border-radius:8px;box-shadow:0 4px 16px var(--shadow);padding:9px 14px;font-size:13px;color:var(--text);opacity:0;transition:opacity .3s,transform .3s;max-width:calc(100vw - 32px);";
      document.body.appendChild(toastEl);
    }
    // A modal <dialog> makes the rest of the page inert and covers it:
    // host the toast inside the top-most open dialog (Part VI).
    var dlgs=document.querySelectorAll("dialog[open]");
    var host=dlgs.length? dlgs[dlgs.length-1] : document.body;
    if(toastEl.parentNode!==host) host.appendChild(toastEl);
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

  // PR-1: unified notifications doctrine (kanban/notes pattern). The
  // module lives in the shell (parent), dynamic resolution; the local
  // showToast stays as stale-bundle fallback.
  function notifyTransient(text){
    try {
      var N=(window.parent && window.parent.orosNotifs) || window.orosNotifs || null;
      if(N && typeof N.transient==="function"){ N.transient({ ns:"prompter", title:text, body:"" }); return; }
    } catch(e){ /* cross-origin guard */ }
    showToast(text);
  }

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
    return l? l.loc : id;
  }
  // Text search also matches tag labels (both languages) —
  // typing "μυστ" finds mystery prompts even without clicking a suggestion.
  function promptMatchesQuery(p){
    if(p.en.toLowerCase().indexOf(searchQuery)>=0) return true;
    if(p.el.toLowerCase().indexOf(searchQuery)>=0) return true;
    if(p.loc && p.loc.toLowerCase().indexOf(searchQuery)>=0) return true;
    var tg=tagsFor(p);
    for(var i=0;i<tg.length;i++){
      var l=TAG_LABELS[tg[i]];
      if(!l) continue;
      if(l.en.toLowerCase().indexOf(searchQuery)>=0 ||
         l.el.toLowerCase().indexOf(searchQuery)>=0 ||
         l.loc.toLowerCase().indexOf(searchQuery)>=0) return true;
    }
    return false;
  }
  function tagSuggestions(query){
    var out=[];
    Object.keys(TAG_LABELS).forEach(function(id){
      var l=TAG_LABELS[id];
      if(id.indexOf(query)===0 ||
         l.en.toLowerCase().indexOf(query)>=0 ||
         l.el.toLowerCase().indexOf(query)>=0 ||
         l.loc.toLowerCase().indexOf(query)>=0) out.push(id);
    });
    return out.slice(0,6);
  }

  function isInFavs(id){ return Object.prototype.hasOwnProperty.call(state.favorites, id); }
  function isCompleted(id){ return state.completed.hasOwnProperty(id); }
  function isCustom(id){ return id.indexOf("c")===0; }
  // PM-2: each toggle writes its OWN tombstone ("fav:" / "done:"); the
  // plain deleted[id] belongs to custom-prompt deletion only. A fresh
  // stamp beats any tombstone, so turning a flag back on needs no
  // tombstone removal (removing the plain one could even undo another
  // device's delete of a custom prompt).
  // Strictly newer than any tombstone that applies (same millisecond or
  // a skewed clock on another device would otherwise leave it dead).
  function freshStamp(now, id, ns){
    var t=Math.max(state.deleted[id]||0, state.deleted[ns+id]||0);
    return now>t ? now : t+1;
  }
  function toggleFav(id){
    var now=Date.now();
    if(isInFavs(id)){ delete state.favorites[id]; state.deleted[TOMB_FAV+id]=now; }   // tombstone — survives merge
    else { state.favorites[id]=freshStamp(now, id, TOMB_FAV); }   // fresh ts beats tombstone
    state.sm=now; save(); renderAll();
  }
  function toggleComplete(id){
    var now=Date.now();
    if(state.completed[id]) { delete state.completed[id]; state.deleted[TOMB_DONE+id]=now; }   // tombstone — survives merge
    else { state.completed[id]=freshStamp(now, id, TOMB_DONE); }   // fresh ts beats tombstone
    state.sm=now; save(); renderAll();
  }
  // "Use": open the prompt in Writer as a new document (Writer's
  // deep link { newDoc }, same as Typewriter's "Send to Writer").
  // Outside the shell (standalone tab) there is no Writer to open,
  // so it falls back to the clipboard.
  function useInWriter(p, text){
    var sh=null;
    try{ if(window.parent!==window && typeof window.parent.__orosOpenAt==="function") sh=window.parent; }catch(e){}
    if(!sh){ copyText(text); return; }
    try{ sh.__orosOpenAt("writer", { newDoc: { title: catLabel(p.cat), text: text } }); }
    catch(e){ copyText(text); }
  }
  function copyText(text){
    if(navigator.clipboard){ navigator.clipboard.writeText(text).then(function(){ notifyTransient(t("saved.toast")); }); }
    else { var ta=document.createElement("textarea"); ta.value=text; document.body.appendChild(ta); ta.select(); try{ document.execCommand("copy"); notifyTransient(t("saved.toast")); }catch(e){} document.body.removeChild(ta);}
  }

  // ---------- Wave 4: Custom prompt CRUD ----------
  var editorModal=null;
  var showMineOnly=false;   // "✦ Mine" browse toggle
  function closeEditor(){
    if(editorModal){ editorModal.close(); editorModal.remove(); editorModal=null; }
  }
  // prefill (optional, new prompt only): { text } from "Send to an app"
  // (BR-SEND) — the same text in both language fields, to be edited.
  function openCustomEditor(existing, prefill){
    if(editorModal) return;
    var editing=!!existing;
    var p=existing||{cat:"micro", en:"", el:"", var_en:"", var_el:"", tags:[]};
    if(!editing && prefill && typeof prefill.text==="string"){ p.en=prefill.text; p.el=prefill.text; }
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
          parts.pop();                       // replaces the unfinished fragment
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
    // PM-4: read the form the same way at open and at save, so the save
    // can tell which fields the user actually changed.
    var readVals=function(){
      return {
        cat:sel.value, en:enIn.value.trim(), el:elIn.value.trim(),
        var_en:vEn.value.trim(), var_el:vEl.value.trim(),
        tags:tgIn.value.split(",").map(function(s){ return s.trim().toLowerCase(); }).filter(Boolean)
      };
    };
    var baseVals=readVals();
    sv.addEventListener("click", function(){
      var vals=readVals();
      var enVal=vals.en, elVal=vals.el;
      if(!enVal || !elVal){ showToast(t("editor.errEmpty")); return; }
      var tagList=vals.tags;
      var now=Date.now();
      if(editing){
        // PM-4: `p` is the object as it was when the editor opened; a
        // sync pull since then replaces state.customs, and writing into
        // `p` saved nothing (or, without a pull, wrote back every field,
        // undoing another device's change to the fields not touched
        // here). Write only the changed fields into the CURRENT object.
        var cur=null;
        for(var ci=0;ci<state.customs.length;ci++){ if(state.customs[ci].id===p.id){ cur=state.customs[ci]; break; } }
        var changed=Object.keys(vals).filter(function(k){ return JSON.stringify(vals[k])!==JSON.stringify(baseVals[k]); });
        if(!changed.length){ closeEditor(); return; }   // zero-edit save stamps nothing
        if(!cur){   // deleted elsewhere meanwhile: the edit brings it back (R17)
          cur=JSON.parse(JSON.stringify(p));
          state.customs.push(cur);
        }
        changed.forEach(function(k){ cur[k]=vals[k]; });
        cur.mtime=now;
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
      notifyTransient(t("custom.saved"));
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
    notifyTransient(t("custom.deleted"));
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
    var row=document.createElement("div");
    row.className="dlg-actions";
    row.appendChild(c); row.appendChild(y);
    dlg.appendChild(row);
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
loader.textContent=t("loading");
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
    if(searchQuery.length>=2){
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
    // PM-8: customs come first and never count against the 50-card cap.
    // They used to be appended after the 100 built-ins, so with no
    // filter a newly saved prompt was never shown ("saved", then gone).
    var allPrompts=(state.customs||[]).concat(PROMPTS_DATA);
    allPrompts.forEach(function(p){
      if(showMineOnly && !isCustom(p.id)) return;
      if(activeCategory!=="all" && p.cat!==activeCategory) return;
      if(activeTag && tagsFor(p).indexOf(activeTag)<0) return;
      if(searchQuery && !promptMatchesQuery(p)) return;
      if(!activeTag && !searchQuery && !isCustom(p.id) && shown>=50 && p.id!==dailyId) return;

      var card=document.createElement("div");
      card.className="prompt-card"+(isCustom(p.id)? " custom":"");
      card.setAttribute("data-id", p.id);   // universal search deep link
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
      body.textContent=pText(p);
      var varText=pVar(p);
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
      useBtn.title=t("btn.useTitle");
      useBtn.addEventListener("click", function(){
        useInWriter(p, pText(p)+(showVar? "\n\n"+varText : ""));
      });
      acts.appendChild(useBtn);

      var copyBtn=document.createElement("button");
      copyBtn.type="button";
      copyBtn.textContent=t("btn.copy");
      copyBtn.addEventListener("click", function(){
        copyText(pText(p)+(showVar? "\n+ "+varText : ""));
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
        if(window.OrosBundle && window.PrompterIO){
          var fiBtn=document.createElement("button");
          fiBtn.type="button";
          fiBtn.className="file-btn";
          fiBtn.textContent=t("io.save");
          fiBtn.addEventListener("click", function(){ saveScript(p.id); });
          acts.appendChild(fiBtn);
        }
      }

      card.appendChild(acts);
      grid.appendChild(card);
      if(!isCustom(p.id)) shown++;   // PM-8: the cap counts built-ins only
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
    settingsModal.innerHTML="<h3>"+esc(t("settings.title"))+"</h3>";
    if(window.OrosBundle && window.PrompterIO){
      // Files: open a .orosscript (or an unzipped one) as a new prompt
      var fs=document.createElement("div");
      fs.className="file-sec";
      var fh=document.createElement("h4");
      fh.textContent=t("io.files");
      fs.appendChild(fh);
      var ob=document.createElement("button");
      ob.type="button"; ob.id="io-open"; ob.textContent=t("io.open");
      ob.addEventListener("click", pickScript);
      var fb=document.createElement("button");
      fb.type="button"; fb.id="io-folder"; fb.textContent=t("io.folder");
      fb.addEventListener("click", pickScriptFolder);
      fs.appendChild(ob); fs.appendChild(fb);
      settingsModal.appendChild(fs);
    }
    var rp=document.createElement("p");
    rp.style.margin="12px 0";
    rp.textContent=t("rst.body");
    settingsModal.appendChild(rp);
    var c=document.createElement("button");
    c.type="button"; c.className="ghost"; c.textContent=t("rst.cancel");
    c.addEventListener("click", function(){ settingsModal.close(); settingsModal.remove(); settingsModal=null; });
    var y=document.createElement("button");
    y.type="button"; y.className="prim danger"; y.textContent=t("rst.btn");
    y.addEventListener("click", function(){ factoryReset(); });
    var row=document.createElement("div");
    row.className="dlg-actions";
    row.appendChild(c); row.appendChild(y);
    settingsModal.appendChild(row);
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
    fresh.deleted=tomb; fresh.sm=now;
    state=fresh; save();
    activeCategory="all";
    activeTag=null;
    searchQuery="";
    searchRaw="";
    varShown={};
    showMineOnly=false;
    renderAll();
    if(settingsModal){ settingsModal.close(); settingsModal.remove(); settingsModal=null; }
    notifyTransient(t("rst.done"));
  }

  // ---------- 4b. The .orosscript file (io.js + bundle.js) ----------
  // One custom prompt per file. Saving keeps its text, variations,
  // tags and its star / done marks; opening always adds a NEW custom
  // prompt (fresh id, the editor's rules in PrompterIO.fromContent),
  // never touching an existing one.
  function dialogHost(){
    try { return window.orosDialog || (window.parent && window.parent.orosDialog) || null; }
    catch(e){ return window.orosDialog || null; }
  }
  function saveBlob(blob, name, mime, desc, ext){
    var dlg=dialogHost();
    if(dlg && typeof dlg.saveFile==="function"){
      var acc={}; acc[mime]=[ext];
      dlg.saveFile({ blob:blob, filename:name, mime:mime, types:[{ description:desc, accept:acc }] })
        .then(function(r){ if(r && r.ok) notifyTransient(t("io.saved")); });
      return;                       // cancel (ok=false) = silent exit
    }
    var url=URL.createObjectURL(blob), a=document.createElement("a");
    a.href=url; a.download=name;
    document.body.appendChild(a); a.click();
    setTimeout(function(){ URL.revokeObjectURL(url); a.remove(); }, 1000);
    notifyTransient(t("io.saved"));
  }
  function saveScript(id){
    var p=promptById(id), IO=window.PrompterIO;
    if(!p || !isCustom(id) || !IO || !window.OrosBundle) return;
    var opts=IO.bundleOpts(p, state, { lang:LANG, date:new Date() });
    window.OrosBundle.write(opts).then(function(bytes){
      saveBlob(new Blob([bytes], { type:IO.MIME }), IO.fileName(opts.meta.title, "orosscript"), IO.MIME, t("io.save"), ".orosscript");
    }, function(){ showToast(t("io.saveFail")); });
  }
  // A bundle result → a new custom prompt, shown under "Mine"
  function scriptFromBundle(r){
    var maxPos=-1;
    state.customs.forEach(function(c){ if((c.pos||0)>maxPos) maxPos=c.pos||0; });
    var now=Date.now();
    var got=window.PrompterIO.fromContent(r && r.content, { id:"c"+uid(), now:now, pos:maxPos+1 });
    if(!got){ showToast(t("io.bad")); return; }
    var id=got.prompt.id;
    state.customs.push(got.prompt);
    if(got.favorite) state.favorites[id]=now;
    if(got.completed) state.completed[id]=got.completed;
    state.sm=now; save();
    if(settingsModal){ settingsModal.close(); settingsModal.remove(); settingsModal=null; }
    renderAll();
    openSearchTarget({ prompt:id });
    notifyTransient(t("io.opened"));
  }
  function scriptFail(e){
    if(!(e && e.code==="notbundle")){ try{ console.error("[orOS] prompter: .orosscript not read:", e && (e.code || e.message)); }catch(er){} }
    showToast(e && e.code==="newer"? t("io.newer") : t("io.bad"));
  }
  // A picked or handed-over file: only an orOS bundle is a script file
  function readScriptFile(f){
    var B=window.OrosBundle;
    if(!f || !B || !window.PrompterIO) return;
    if(f.size>32*1024*1024){ showToast(t("io.bad")); return; }
    f.slice(0, 128).arrayBuffer().then(function(head){
      if(B.sniff(new Uint8Array(head))===null){ var e=new Error("notbundle"); e.code="notbundle"; throw e; }
      return f.arrayBuffer();
    }).then(function(ab){ return B.read(new Uint8Array(ab), { mime:window.PrompterIO.MIME }); })
      .then(scriptFromBundle, scriptFail);
  }
  function pickScript(){
    var inp=document.createElement("input");
    inp.type="file";
    inp.accept=".orosscript,application/x-oros-script";
    inp.style.display="none";
    inp.addEventListener("change", function(){ var f=inp.files && inp.files[0]; inp.remove(); readScriptFile(f); });
    (settingsModal || document.body).appendChild(inp);
    inp.click();
  }
  // An unzipped .orosscript folder (maybe changed by hand)
  function pickScriptFolder(){
    var B=window.OrosBundle;
    if(!B || !window.PrompterIO) return;
    B.pickFolder().then(function(files){
      if(!files) return;
      return B.readFolder(files, { mime:window.PrompterIO.MIME }).then(scriptFromBundle, scriptFail);
    });
  }
  // "Open with" (shell fileopen.js): { openFile: { token } }, the File
  // taken once with window.parent.__orosTakeFile(token).
  function openFileTarget(tg){
    var f=null;
    try{
      var pw=window.parent;
      if(pw && pw!==window && typeof pw.__orosTakeFile==="function") f=pw.__orosTakeFile(tg.openFile.token);
    }catch(e){ f=null; }
    if(f) readScriptFile(f);
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

    // PR-3: Contract B — shell-owned combos (Ctrl+Alt+Shift+*) get
    // canonical capture-phase forwarding (parity with todo/kanban/
    // writer/notes). Without this, shell shortcuts die inside the
    // prompter's inputs.
    document.addEventListener("keydown", function (e) {
      if (!(e.ctrlKey || e.metaKey) || !e.altKey || !e.shiftKey) return;
      var p = window.parent;
      if (!(p && p.orosShortcuts &&
            typeof p.orosShortcuts.handle === "function")) return;
      if (p.orosShortcuts.handle(e)) e.stopPropagation();
    }, true);
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

  // Universal search deep link (shell __orosOpenAt / __orosTakeTarget): target { prompt }.
  // A custom prompt: Browse with "Mine" on and no other filter, the
  // card scrolled into view and focused. Unknown id → no-op; nothing
  // happens while the editor or the settings dialog is open.
  function openSearchTarget(tg){
    var id=tg && typeof tg.prompt==="string"? tg.prompt : null;
    if(!id || !isCustom(id) || !promptById(id)) return;
    if(editorModal || settingsModal || document.querySelector("dialog[open]")) return;
    showMineOnly=true; activeCategory="all"; activeTag=null;
    searchRaw=""; searchQuery="";
    showTab("browse");
    var cards=document.querySelectorAll("#browse .prompt-card"), card=null;
    for(var i=0;i<cards.length;i++){ if(cards[i].getAttribute("data-id")===id){ card=cards[i]; break; } }
    if(!card) return;
    card.tabIndex=-1;
    try{ card.scrollIntoView({ block:"center" }); }catch(e){}
    try{ card.focus({ preventScroll:true }); }catch(e){}
  }
  // One receiver for both deep links: { prompt } (search) and
  // { openFile: { token } } (the system's "Open with").
  // { newPrompt: { text } }: "Send to an app" (BR-SEND) — the New
  // prompt editor filled with that text; nothing is saved until Save.
  var NEWPROMPT_MAX=8000;
  function openTarget(tg){
    if(tg && typeof tg==="object" && tg.openFile && typeof tg.openFile.token==="string"){ openFileTarget(tg); return; }
    if(tg && typeof tg==="object" && tg.newPrompt && typeof tg.newPrompt.text==="string"){
      var txt=tg.newPrompt.text.replace(/\r\n?/g,"\n").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g," ").trim().slice(0,NEWPROMPT_MAX);
      if(!txt || editorModal || settingsModal || document.querySelector("dialog[open]")) return;
      openCustomEditor(null, { text: txt });
      return;
    }
    openSearchTarget(tg);
  }
  window.__orosOpenAt=openTarget;
  try{
    if(window.parent && window.parent!==window && typeof window.parent.__orosTakeTarget==="function"){
      var pendingTarget=window.parent.__orosTakeTarget("prompter");
      if(pendingTarget) openTarget(pendingTarget);
    }
  }catch(e){}

})();