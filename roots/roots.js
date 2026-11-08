// ============================================================
// orOS Roots — App logic (v1.1.0)
// A turn-based growing game: an old tree grows roots under a 7 × 9 glade
// to reach springs and minerals, and buds on the surface that open into
// leaves and flowers. Pests show what they will do before they act;
// whatever is cut off from the trunk withers after 2 turns unless it is
// joined again. Each of the 3 seasons needs its bloom quota. The rules
// live in roots/engine.js (RootsEngine, tested headless); this file is
// the screen.
//   - Mild (a lower quota, one Rewind a season) or Hardy
//   - every year has a code; the same code is the same glade and pests
//   - choose a growth in the bar (root, thicken, thorn, leaf bud, flower
//     bud), then tap a lit tile; Undo and Reset turn are free
//   - a long press on any tile shows its text
//   - a short "How to play" on the first year
//   - the Daily glade (5.91.00): one season on Hardy, the same for
//     everyone that day, one try; in the Game Center's Today
//   - Last years with Replay (5.91.00)
// Data:
//   - synced slice "roots" (oros-roots-data): years, years finished and
//     the best year score per difficulty, and the longest root, as
//     per-device counter rows (each device only grows its own row;
//     merge = per-row max, a join) + reset stamp br (as Fieldwarden),
//     days (the Daily glade) and last (Last years), 5.91.00
//   - device-local (R10): oros-roots-prefs (difficulty, tour seen,
//     quick, threats), oros-roots-session (the year in progress),
//     oros-roots-device (counter row id), oros-roots-sfx (sound)
// Sections:
//   1. Constants, i18n, helpers
//   2. Synced records: load / save / normalize / merge (R5, R26)
//   3. Device-local prefs + session
//   4. Year flow (new, act, undo, end of turn, bloom)
//   5. Scene (layout, drawing the glade)
//   6. Input (tap, long press, keyboard)
//   7. Panels (status, growth bar)
//   8. Dialogs (new year, info, bloom, result, records, Last years,
//      Daily glade, tour)
//   9. Toasts
//  10. Sound
//  11. Sync slice + palette
//  12. Wiring & boot
// ============================================================
(function () {
  "use strict";

  var E = window.RootsEngine;
  var DK = window.orosDaily || null;   // gamekit/daily.js (the Daily glade, the Game Center link)

  var STORAGE_KEY = "oros-roots-data";
  var PREFS_KEY   = "oros-roots-prefs";
  var SESSION_KEY = "oros-roots-session";
  var DEVICE_KEY  = "oros-roots-device";
  var SFX_KEY     = "oros-roots-sfx";
  var DATA_VER    = 1;
  var DIFFS = E.DIFFS;                 // m Mild, h Hardy
  var BW = E.W, BH = E.H, SIZE = E.SIZE;
  var BIG = 1e9;
  var MAX_SCORE = 999;
  var MAX_DAY = 99999;
  var LAST_N = 10;
  var GROW = ["root", "thick", "thorn", "leaf", "flower"];

  // ---------- 1. Constants, i18n, helpers ----------
  function appLang() {
    try {
      var l = localStorage.getItem("oros-lang") ||
              (window.parent && window.parent.orosLang) || "en";
      return l === "el" ? "el" : "en";
    } catch (e) { return "en"; }
  }
  var LANG = window.orosI18n ? window.orosI18n.lang() : appLang();

  var STRINGS = {
    en: {
      "app.name": "Roots",
      "btn.new": "New year (N)", "btn.end": "End turn", "btn.endKey": "End turn (E)", "btn.stats": "Records",
      "btn.undo": "Undo (Z)", "btn.reset": "Reset turn (R)", "btn.rewind": "Rewind the last turn",
      "btn.sfxOn": "Sound on", "btn.sfxOff": "Sound off", "btn.fastOn": "Quick pests: on", "btn.fastOff": "Quick pests: off",
      "btn.threatOn": "Show every threat", "btn.threatOff": "Show the pests' moves",
      "view.label": "The glade: the surface on top, the soil below",
      "diff.m": "Mild", "diff.h": "Hardy",
      "diff.m.note": "A lower quota, and once a season Rewind takes back the whole last turn.",
      "diff.h.note": "More pests and a higher quota. No rewinds.",
      "sea.1": "Spring", "sea.2": "Summer", "sea.3": "Autumn",
      "st.turn": "Turn {n} of {m}", "st.sap": "Sap {n}, +{g} next turn", "st.bloom": "Bloom {n}, quota {q}",
      "grow.root": "Root", "grow.thick": "Thicken", "grow.thorn": "Thorn", "grow.leaf": "Leaf bud", "grow.flower": "Flower bud",
      "grow.root.note": "A thin root next to your network. Clay costs 2.",
      "grow.thick.note": "A thick root takes a bite and stays; a thin one breaks.",
      "grow.thorn.note": "At the end of the turn it hurts every pest on it or next to it (2 near a mineral).",
      "grow.leaf.note": "Opens after 2 turns above a joined root: +1 sap a turn, and it shelters the buds beside it from frost.",
      "grow.flower.note": "Opens after 2 turns above a joined root: 1 bloom at the end of the season.",
      "grow.short.root": "Root", "grow.short.thick": "Thicken", "grow.short.thorn": "Thorn", "grow.short.leaf": "Leaf", "grow.short.flower": "Flower",
      "grow.cost": "{n} sap",
      "tile.T": "The trunk", "tile.a": "The surface", "tile..": "Soil", "tile.#": "Stone (no root passes)", "tile.w": "Spring", "tile.m": "Mineral", "tile.c": "Clay",
      "tile.w.note": "A joined root here gives 2 sap a turn and counts 1 bloom at the end of each season.",
      "tile.m.note": "A joined root here gives 1 sap a turn; a thorn on it or next to it hurts 2.",
      "tile.c.note": "Hard ground: a root here costs 2.",
      "tile.base": "The base root (never breaks)",
      "root.1": "thin root", "root.2": "thick root", "root.thorn": "thorn", "root.cut": "cut off: withers in {n}",
      "bud.1": "leaf bud ({n} to open)", "bud.2": "flower bud ({n} to open)", "bud.3": "leaf", "bud.4": "flower", "bud.wait": "waits for a joined root below",
      "pest.beetle": "Beetle", "pest.mole": "Mole", "pest.aphid": "Aphid", "pest.blight": "Blight",
      "pest.beetle.note": "Walks up to 2 tiles through the soil to the nearest root and chews it: a thin root breaks, a thick one turns thin. Leaves after 3 turns.",
      "pest.mole.note": "Digs a straight line of up to 3 tiles, harming every root in it. Leaves after 2 turns.",
      "pest.aphid.note": "Walks along the surface to the nearest bud and eats it. Open leaves and flowers are safe. Leaves after 3 turns.",
      "pest.blight.note": "Autumn. Spreads to a thin root next to it every turn and stays; thick roots and thorns stop it, a thorn kills it.",
      "it.chew": "will chew this root", "it.walk": "walks on", "it.dig": "digs {d}", "it.eat": "will eat this bud", "it.spread": "spreads here", "it.idle": "waits",
      "it.hp": "Health {n}", "it.left": "leaves in {n}",
      "dir.0": "up", "dir.1": "right", "dir.2": "down", "dir.3": "left",
      "info.comes": "{k} comes in here at the end of the turn",
      "info.close": "Close",
      "msg.season": "{s} · season {n} of 3. Bloom quota: {q}.", "msg.daily": "{s} · Daily glade. Bloom quota: {q}.", "msg.turn": "Turn {n}.", "msg.pick": "{g}: tap a lit tile.",
      "msg.frost": "Frost tonight: buds with no leaf beside them freeze.",
      "msg.none": "Nothing to grow there.", "msg.sap": "Not enough sap.",
      "live.end": "Turn {n}. Sap {s}. Bloom {b} of {q}.",
      "ev.lost": "root lost", "ev.thin": "bitten", "ev.cut": "cut off", "ev.wither": "withered", "ev.open": "opened", "ev.eaten": "eaten",
      "ev.frost": "frozen", "ev.thorn": "-{n}", "ev.gone": "gone", "ev.spread": "blight",
      "res.bloom": "Bloom", "res.flowers": "Flowers", "res.springs": "Springs reached", "res.quota": "Quota",
      "res.met": "Quota met: on to the next season.", "res.miss": "The quota was missed: the year ends.",
      "res.next": "Next season", "res.won": "The year is done!", "res.lost": "A dry year",
      "res.score": "Year score", "res.scoreNote": "Bloom of every season, springs reached and the longest root.",
      "res.longest": "Longest root", "res.code": "Year code: {seed}", "res.same": "The same year", "res.new": "New year",
      "new.title": "New year", "new.diff": "Difficulty", "new.seed": "Year code",
      "new.seedHint": "Empty for a new year", "new.start": "Start", "new.cancel": "Cancel",
      "stats.title": "Records", "stats.head": "Years · finished · best score", "stats.long": "Longest root",
      "stats.reset": "Reset records", "stats.close": "Close", "stats.code": "This year's code: {seed}",
      "confirm.reset": "Reset the records on all devices? The year in progress stays.", "confirm.yes": "Reset", "confirm.no": "Cancel",
      "confirm.new": "Start a new year? The year in progress counts as not finished.", "confirm.newYes": "New year",
      "toast.save": "Not saved: the browser's storage is full", "toast.reset": "Records reset",
      "toast.rewind": "The last turn is rewound ({n} left)",
      "btn.daily": "Daily glade", "daily.label": "Daily",
      "daily.title": "Daily glade #{n}", "daily.won": "Score {n}, quota met", "daily.lost": "Score {n}, quota missed",
      "daily.season": "Season", "daily.bloom": "Bloom · quota", "daily.score": "Score", "daily.scoreNote": "The bloom, the springs reached and the longest root.",
      "daily.streak": "Streak", "daily.best": "Best streak",
      "daily.oneTry": "The Daily glade has one try.", "daily.next": "A new one tomorrow.",
      "daily.free": "New year", "daily.share": "Share", "daily.games": "All games",
      "daily.rules": "Daily glade: one season on Hardy from a bare tree, the same for everyone today. Meet the bloom quota; the score is the bloom, the springs and the longest root.",
      "daily.leave": "Leave today's glade? It counts as your one try.", "daily.leaveYes": "Leave it", "daily.leaveNo": "Keep playing",
      "daily.giveUp": "Start today's glade? The year in progress counts as not finished.", "daily.go": "Start the glade",
      "stats.daily": "Daily glade", "stats.dailyRow": "Played · quota met · streak · best score",
      "last.title": "Last years", "last.won": "Year done", "last.met": "Quota met", "last.missed": "Quota missed",
      "last.seasons": "{n} of {m} seasons", "last.score": "score {n}",
      "last.replay": "Replay", "last.replayLabel": "Replay year {seed}",
      "share.won": "Score {n}, quota met", "share.lost": "Score {n}, quota missed",
      "toast.copied": "Copied: paste it into a chat", "toast.shared": "Shared", "toast.copyFail": "Could not copy",
      "toast.dailyGone": "The Daily glade needs the gamekit file: reload orOS",
      "tour.title": "How to play", "tour.next": "Next", "tour.skip": "Skip", "tour.done": "Play",
      "tour.1": "You are an old tree. Grow roots through the soil from the trunk to reach springs and minerals: every joined one gives sap each turn.",
      "tour.2": "On the surface, buds open into leaves (more sap) and flowers. At the end of each season, flowers and springs reached must meet the bloom quota.",
      "tour.3": "Every pest shows what it will do. A root cut off from the trunk gives nothing and withers in 2 turns: join it again, grow a second way round, thicken the roots in danger or grow thorns.",
      "tour.4": "Choose a growth in the bar, then tap a lit tile. Undo and Reset turn are free. End turn: thorns strike, the pests act, buds grow and new pests come in at the edges."
    },
    el: {
      "app.name": "Ρίζες",
      "btn.new": "Νέα χρονιά (N)", "btn.end": "Τέλος γύρου", "btn.endKey": "Τέλος γύρου (E)", "btn.stats": "Αρχείο",
      "btn.undo": "Αναίρεση (Z)", "btn.reset": "Ο γύρος από την αρχή (R)", "btn.rewind": "Γύρνα πίσω τον τελευταίο γύρο",
      "btn.sfxOn": "Ήχος ανοιχτός", "btn.sfxOff": "Ήχος κλειστός", "btn.fastOn": "Γρήγορα ζωύφια: ναι", "btn.fastOff": "Γρήγορα ζωύφια: όχι",
      "btn.threatOn": "Δείξε κάθε κίνδυνο", "btn.threatOff": "Δείξε τις κινήσεις των ζωυφίων",
      "view.label": "Το ξέφωτο: η επιφάνεια πάνω, το χώμα από κάτω",
      "diff.m": "Ήπια", "diff.h": "Σκληρή",
      "diff.m.note": "Χαμηλότερος στόχος, και μία φορά σε κάθε εποχή το Γύρνα πίσω παίρνει πίσω όλο τον τελευταίο γύρο.",
      "diff.h.note": "Περισσότερα ζωύφια και ψηλότερος στόχος. Χωρίς γυρίσματα.",
      "sea.1": "Άνοιξη", "sea.2": "Καλοκαίρι", "sea.3": "Φθινόπωρο",
      "st.turn": "Γύρος {n} από {m}", "st.sap": "Χυμός {n}, +{g} τον επόμενο γύρο", "st.bloom": "Άνθιση {n}, στόχος {q}",
      "grow.root": "Ρίζα", "grow.thick": "Χόντρεμα", "grow.thorn": "Αγκάθι", "grow.leaf": "Μπουμπούκι φύλλου", "grow.flower": "Μπουμπούκι λουλουδιού",
      "grow.root.note": "Μια λεπτή ρίζα δίπλα στο δίκτυό σου. Στον πηλό κοστίζει 2.",
      "grow.thick.note": "Μια χοντρή ρίζα αντέχει μια δαγκωνιά και μένει· μια λεπτή σπάει.",
      "grow.thorn.note": "Στο τέλος του γύρου χτυπά κάθε ζωύφιο πάνω του ή δίπλα του (2 κοντά σε μετάλλευμα).",
      "grow.leaf.note": "Ανοίγει σε 2 γύρους πάνω από ενωμένη ρίζα: +1 χυμός τον γύρο, και προστατεύει τα μπουμπούκια δίπλα του από την παγωνιά.",
      "grow.flower.note": "Ανοίγει σε 2 γύρους πάνω από ενωμένη ρίζα: 1 άνθιση στο τέλος της εποχής.",
      "grow.short.root": "Ρίζα", "grow.short.thick": "Χόντρεμα", "grow.short.thorn": "Αγκάθι", "grow.short.leaf": "Φύλλο", "grow.short.flower": "Λουλούδι",
      "grow.cost": "{n} χυμός",
      "tile.T": "Ο κορμός", "tile.a": "Η επιφάνεια", "tile..": "Χώμα", "tile.#": "Πέτρα (καμία ρίζα δεν περνά)", "tile.w": "Πηγή", "tile.m": "Μετάλλευμα", "tile.c": "Πηλός",
      "tile.w.note": "Μια ενωμένη ρίζα εδώ δίνει 2 χυμό τον γύρο και μετρά 1 άνθιση στο τέλος κάθε εποχής.",
      "tile.m.note": "Μια ενωμένη ρίζα εδώ δίνει 1 χυμό τον γύρο· ένα αγκάθι πάνω του ή δίπλα του χτυπά 2.",
      "tile.c.note": "Σκληρό έδαφος: μια ρίζα εδώ κοστίζει 2.",
      "tile.base": "Η ρίζα του κορμού (δεν σπάει ποτέ)",
      "root.1": "λεπτή ρίζα", "root.2": "χοντρή ρίζα", "root.thorn": "αγκάθι", "root.cut": "κομμένη: μαραίνεται σε {n}",
      "bud.1": "μπουμπούκι φύλλου (ανοίγει σε {n})", "bud.2": "μπουμπούκι λουλουδιού (ανοίγει σε {n})", "bud.3": "φύλλο", "bud.4": "λουλούδι", "bud.wait": "περιμένει ενωμένη ρίζα από κάτω",
      "pest.beetle": "Σκαθάρι", "pest.mole": "Τυφλοπόντικας", "pest.aphid": "Αφίδα", "pest.blight": "Σήψη",
      "pest.beetle.note": "Περπατά ως 2 τετράγωνα μέσα στο χώμα ως την πιο κοντινή ρίζα και τη ροκανίζει: η λεπτή σπάει, η χοντρή γίνεται λεπτή. Φεύγει σε 3 γύρους.",
      "pest.mole.note": "Σκάβει μια ευθεία ως 3 τετράγωνα και χτυπά κάθε ρίζα πάνω της. Φεύγει σε 2 γύρους.",
      "pest.aphid.note": "Περπατά στην επιφάνεια ως το πιο κοντινό μπουμπούκι και το τρώει. Τα ανοιχτά φύλλα και λουλούδια είναι ασφαλή. Φεύγει σε 3 γύρους.",
      "pest.blight.note": "Φθινόπωρο. Κάθε γύρο απλώνεται σε μια λεπτή ρίζα δίπλα της και μένει· οι χοντρές ρίζες και τα αγκάθια τη σταματούν, ένα αγκάθι τη σκοτώνει.",
      "it.chew": "θα ροκανίσει αυτή τη ρίζα", "it.walk": "προχωρά", "it.dig": "σκάβει προς τα {d}", "it.eat": "θα φάει αυτό το μπουμπούκι", "it.spread": "απλώνεται εδώ", "it.idle": "περιμένει",
      "it.hp": "Ζωή {n}", "it.left": "φεύγει σε {n}",
      "dir.0": "πάνω", "dir.1": "δεξιά", "dir.2": "κάτω", "dir.3": "αριστερά",
      "info.comes": "{k}: μπαίνει εδώ στο τέλος του γύρου",
      "info.close": "Κλείσιμο",
      "msg.season": "{s} · εποχή {n} από 3. Στόχος άνθισης: {q}.", "msg.daily": "{s} · Ξέφωτο της ημέρας. Στόχος άνθισης: {q}.", "msg.turn": "Γύρος {n}.", "msg.pick": "{g}: πάτα ένα φωτισμένο τετράγωνο.",
      "msg.frost": "Παγωνιά απόψε: τα μπουμπούκια χωρίς φύλλο δίπλα τους παγώνουν.",
      "msg.none": "Δεν φυτρώνει τίποτα εκεί.", "msg.sap": "Δεν φτάνει ο χυμός.",
      "live.end": "Γύρος {n}. Χυμός {s}. Άνθιση {b} από {q}.",
      "ev.lost": "χάθηκε", "ev.thin": "δαγκωνιά", "ev.cut": "κόπηκε", "ev.wither": "μαράθηκε", "ev.open": "άνοιξε", "ev.eaten": "φαγώθηκε",
      "ev.frost": "πάγωσε", "ev.thorn": "-{n}", "ev.gone": "έφυγε", "ev.spread": "σήψη",
      "res.bloom": "Άνθιση", "res.flowers": "Λουλούδια", "res.springs": "Πηγές που έφτασες", "res.quota": "Στόχος",
      "res.met": "Ο στόχος πιάστηκε: πάμε στην επόμενη εποχή.", "res.miss": "Ο στόχος δεν πιάστηκε: η χρονιά τελειώνει.",
      "res.next": "Επόμενη εποχή", "res.won": "Η χρονιά ολοκληρώθηκε!", "res.lost": "Μια ξερή χρονιά",
      "res.score": "Πόντοι της χρονιάς", "res.scoreNote": "Η άνθιση κάθε εποχής, οι πηγές που έφτασες και η πιο μακριά ρίζα.",
      "res.longest": "Η πιο μακριά ρίζα", "res.code": "Κωδικός χρονιάς: {seed}", "res.same": "Η ίδια χρονιά", "res.new": "Νέα χρονιά",
      "new.title": "Νέα χρονιά", "new.diff": "Δυσκολία", "new.seed": "Κωδικός χρονιάς",
      "new.seedHint": "Κενό για νέα χρονιά", "new.start": "Ξεκίνα", "new.cancel": "Άκυρο",
      "stats.title": "Αρχείο", "stats.head": "Χρονιές · ολοκληρωμένες · καλύτεροι πόντοι", "stats.long": "Η πιο μακριά ρίζα",
      "stats.reset": "Μηδένισε το αρχείο", "stats.close": "Κλείσιμο", "stats.code": "Ο κωδικός αυτής της χρονιάς: {seed}",
      "confirm.reset": "Να μηδενιστεί το αρχείο σε όλες τις συσκευές; Η χρονιά που παίζεις μένει.", "confirm.yes": "Μηδένισε", "confirm.no": "Άκυρο",
      "confirm.new": "Να ξεκινήσει νέα χρονιά; Αυτή που παίζεις μετρά ως μη ολοκληρωμένη.", "confirm.newYes": "Νέα χρονιά",
      "toast.save": "Δεν αποθηκεύτηκε: ο χώρος του προγράμματος περιήγησης γέμισε", "toast.reset": "Το αρχείο μηδενίστηκε",
      "toast.rewind": "Ο τελευταίος γύρος αναιρέθηκε (μένουν {n})",
      "btn.daily": "Ξέφωτο της ημέρας", "daily.label": "Ημέρας",
      "daily.title": "Ξέφωτο της ημέρας #{n}", "daily.won": "{n} πόντοι, ο στόχος πιάστηκε", "daily.lost": "{n} πόντοι, ο στόχος δεν πιάστηκε",
      "daily.season": "Εποχή", "daily.bloom": "Άνθιση · στόχος", "daily.score": "Πόντοι", "daily.scoreNote": "Η άνθιση, οι πηγές που έφτασες και η πιο μακριά ρίζα.",
      "daily.streak": "Σερί", "daily.best": "Καλύτερο σερί",
      "daily.oneTry": "Το ξέφωτο της ημέρας παίζεται μία φορά.", "daily.next": "Νέο αύριο.",
      "daily.free": "Νέα χρονιά", "daily.share": "Κοινοποίηση", "daily.games": "Όλα τα παιχνίδια",
      "daily.rules": "Ξέφωτο της ημέρας: μία εποχή στη Σκληρή από γυμνό δέντρο, ίδια για όλους σήμερα. Πιάσε τον στόχο άνθισης· οι πόντοι είναι η άνθιση, οι πηγές και η πιο μακριά ρίζα.",
      "daily.leave": "Να αφήσεις το σημερινό ξέφωτο; Μετρά ως η μία σου προσπάθεια.", "daily.leaveYes": "Άφησέ το", "daily.leaveNo": "Συνέχισε",
      "daily.giveUp": "Να ξεκινήσει το σημερινό ξέφωτο; Η χρονιά που παίζεις μετρά ως μη ολοκληρωμένη.", "daily.go": "Ξεκίνα το ξέφωτο",
      "stats.daily": "Ξέφωτο της ημέρας", "stats.dailyRow": "Παιγμένα · στόχοι · σερί · καλύτεροι πόντοι",
      "last.title": "Τελευταίες χρονιές", "last.won": "Ολοκληρώθηκε", "last.met": "Στόχος", "last.missed": "Χωρίς στόχο",
      "last.seasons": "{n} από {m} εποχές", "last.score": "{n} πόντοι",
      "last.replay": "Ξανά", "last.replayLabel": "Ξανά η χρονιά {seed}",
      "share.won": "{n} πόντοι, ο στόχος πιάστηκε", "share.lost": "{n} πόντοι, ο στόχος δεν πιάστηκε",
      "toast.copied": "Αντιγράφηκε: επικόλλησέ το σε μια συνομιλία", "toast.shared": "Κοινοποιήθηκε", "toast.copyFail": "Δεν αντιγράφηκε",
      "toast.dailyGone": "Το ξέφωτο της ημέρας θέλει το αρχείο gamekit: φόρτωσε ξανά το orOS",
      "tour.title": "Πώς παίζεται", "tour.next": "Επόμενο", "tour.skip": "Παράλειψη", "tour.done": "Παίξε",
      "tour.1": "Είσαι ένα γέρικο δέντρο. Άπλωσε ρίζες στο χώμα από τον κορμό ως τις πηγές και τα μεταλλεύματα: καθένα που ενώνεται δίνει χυμό κάθε γύρο.",
      "tour.2": "Στην επιφάνεια τα μπουμπούκια ανοίγουν σε φύλλα (περισσότερος χυμός) και λουλούδια. Στο τέλος κάθε εποχής τα λουλούδια και οι πηγές που έφτασες πρέπει να πιάσουν τον στόχο άνθισης.",
      "tour.3": "Κάθε ζωύφιο δείχνει τι θα κάνει. Μια ρίζα κομμένη από τον κορμό δεν δίνει τίποτα και μαραίνεται σε 2 γύρους: ένωσέ την ξανά, άπλωσε δεύτερο δρόμο, χόντρυνε τις ρίζες σε κίνδυνο ή βγάλε αγκάθια.",
      "tour.4": "Διάλεξε μια ανάπτυξη στη μπάρα και πάτα ένα φωτισμένο τετράγωνο. Η αναίρεση και ο γύρος από την αρχή είναι δωρεάν. Τέλος γύρου: τα αγκάθια χτυπούν, τα ζωύφια παίζουν, τα μπουμπούκια μεγαλώνουν και νέα ζωύφια μπαίνουν από τις άκρες."
    }
  };
  if (window.orosI18n) window.orosI18n.table(STRINGS, "roots", LANG);

  function t(key, params) {
    var p = STRINGS[LANG] || STRINGS.en;
    var str = p[key] !== undefined ? p[key] : (STRINGS.en[key] !== undefined ? STRINGS.en[key] : key);
    if (params) {
      Object.keys(params).forEach(function (k) {
        str = str.split("{" + k + "}").join(String(params[k]));
      });
    }
    return str;
  }

  function $(id) { return document.getElementById(id); }
  function cmpStr(x, y) { return x < y ? -1 : (x > y ? 1 : 0); }
  function isInt(v) { return typeof v === "number" && isFinite(v) && Math.floor(v) === v; }
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

  // A new year code: 6 letters and digits, easy to read aloud.
  function newSeed() {
    var abc = "abcdefghjkmnpqrstuvwxyz23456789", buf = new Uint32Array(6), s = "";
    crypto.getRandomValues(buf);
    for (var i = 0; i < 6; i++) s += abc.charAt(buf[i] % abc.length);
    return s;
  }
  function cleanSeed(s) {
    return String(s || "").toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 16);
  }

  // BOOT MARKER
  var SCRIPT_V = "";
  (function () {
    var m = ((document.currentScript && document.currentScript.src) || "")
      .match(/[?&]v=([^&#]+)/);
    SCRIPT_V = m ? m[1] : "";
    document.documentElement.lang = LANG;
    console.log("roots.js v" + (SCRIPT_V || "?") + " boot");
  })();

  // ---------- 2. Synced records ----------
  // data = { ver, br, rows: { <device id>: { b, s: { "<diff>": [years, finished, best score] },
  //                                           lr: the longest root } } }
  // Each device only grows its own row, so a per-row max is a join and
  // nothing is double-counted however the devices meet.
  // days (5.91.00, older data has none): one Daily glade per calendar
  // day (day 0 = 1 Jan 2026, gamekit/daily.js), one try:
  // { "<day>": { b, w: 1 quota met | 0, h: score, t: actions, n: bloom,
  //   q: quota } }. The newer epoch wins; equal epochs keep the better
  // result (quota met, then the higher score, then fewer actions, then
  // the larger JSON: a total order, so a join). Never counted in rows.
  // last (5.91.00): the last 10 years of every device,
  // [{ a: end time ms, d: m|h|d (d = Daily), n: seasons met, w: 1
  //    finished (Daily: quota met) | 0, h: score, s: year code }].
  // Union by a + s, newest first, the first 10: a join; entries older
  // than the reset stamp br drop.
  var data = null;
  var deviceId = null;

  function defaultData() { return { ver: DATA_VER, br: 0, rows: {}, days: {}, last: [] }; }
  function normDay(v) {
    if (!v || typeof v !== "object" || !isInt(v.b) || v.b < 0 || (v.w !== 0 && v.w !== 1) ||
        !isInt(v.h) || v.h < 0 || v.h > MAX_SCORE || !isInt(v.t) || v.t < 1 || v.t >= BIG ||
        !isInt(v.n) || v.n < 0 || v.n > 99 || !isInt(v.q) || v.q < 1 || v.q > 99 || (v.w === 1) !== (v.n >= v.q)) return null;
    return { b: v.b, w: v.w, h: v.h, t: v.t, n: v.n, q: v.q };
  }
  function dayKeyOk(k) { return /^\d{1,6}$/.test(k) && +k <= MAX_DAY; }
  function dayBetter(x, y) {
    if (x.w !== y.w) return x.w > y.w;
    if (x.h !== y.h) return x.h > y.h;
    if (x.t !== y.t) return x.t < y.t;
    return cmpStr(JSON.stringify(x), JSON.stringify(y)) > 0;
  }
  function normLast(v) {
    if (!v || typeof v !== "object" || !isInt(v.a) || v.a < 0 || ["m", "h", "d"].indexOf(v.d) < 0 ||
        !isInt(v.n) || v.n < 0 || v.n > (v.d === "d" ? 1 : E.SEASONS) || (v.w !== 0 && v.w !== 1) ||
        !isInt(v.h) || v.h < 0 || v.h > MAX_SCORE || typeof v.s !== "string" || !/^[a-z0-9]{1,16}$/.test(v.s)) return null;
    return { a: v.a, d: v.d, n: v.n, w: v.w, h: v.h, s: v.s };
  }
  function normRow(row) {
    if (!row || typeof row !== "object" || !isInt(row.b) || row.b < 0) return null;
    var s = {}, any = false;
    DIFFS.forEach(function (k) {
      var v = row.s && row.s[k];
      if (Array.isArray(v) && v.length === 3 && v.every(function (x) { return isInt(x) && x >= 0 && x < BIG; }) && v[1] <= v[0] && v[2] <= MAX_SCORE) {
        s[k] = [v[0], v[1], v[2]];
        any = true;
      }
    });
    var lr = isInt(row.lr) && row.lr > 0 && row.lr <= SIZE ? row.lr : 0;
    return any ? { b: row.b, s: s, lr: lr } : null;
  }
  function joinRows(x, y) {
    if (x.b !== y.b) return x.b > y.b ? x : y;
    var s = {};
    DIFFS.forEach(function (k) {
      var a = x.s[k], b = y.s[k];
      if (!a && !b) return;
      if (!a) { s[k] = b.slice(); return; }
      if (!b) { s[k] = a.slice(); return; }
      s[k] = [Math.max(a[0], b[0]), Math.max(a[1], b[1]), Math.max(a[2], b[2])];
    });
    return { b: x.b, s: s, lr: Math.max(x.lr, y.lr) };
  }
  function mergeRoots(A, B) {
    var a = A || {}, b = B || {};
    var br = Math.max(isInt(a.br) ? a.br : 0, isInt(b.br) ? b.br : 0);
    var rows = {};
    [a.rows || {}, b.rows || {}].forEach(function (m) {
      if (!m || typeof m !== "object") return;
      Object.keys(m).forEach(function (id) {
        if (!/^[a-z0-9]{6,32}$/.test(id)) return;
        var r = normRow(m[id]);
        if (!r || r.b < br) return;
        rows[id] = rows[id] ? joinRows(rows[id], r) : r;
      });
    });
    var sorted = {};
    Object.keys(rows).sort(cmpStr).forEach(function (id) {
      var r = rows[id], s = {};
      DIFFS.forEach(function (k) { if (r.s[k]) s[k] = r.s[k].slice(); });
      sorted[id] = { b: r.b, s: s, lr: r.lr };
    });
    var days = {};
    [a.days, b.days].forEach(function (m) {
      if (!m || typeof m !== "object" || Array.isArray(m)) return;
      Object.keys(m).forEach(function (k) {
        if (!dayKeyOk(k)) return;
        var v = normDay(m[k]);
        if (!v || v.b < br) return;
        var cur = days[+k];
        if (!cur || v.b > cur.b || (v.b === cur.b && dayBetter(v, cur))) days[+k] = v;
      });
    });
    var sd = {};
    Object.keys(days).map(Number).sort(function (x, y) { return x - y; }).forEach(function (k) { sd[k] = days[k]; });
    var seen = {}, last = [];
    [a.last, b.last].forEach(function (list) {
      if (!Array.isArray(list)) return;
      list.forEach(function (x) {
        var v = normLast(x);
        if (!v || v.a < br) return;
        var key = v.a + ":" + v.s;
        // the same year twice: keep one, by a fixed order
        if (!seen[key] || cmpStr(JSON.stringify(v), JSON.stringify(seen[key])) > 0) seen[key] = v;
      });
    });
    Object.keys(seen).forEach(function (k) { last.push(seen[k]); });
    last.sort(function (x, y) { return y.a - x.a || cmpStr(x.s, y.s); });
    return { ver: DATA_VER, br: br, rows: sorted, days: sd, last: last.slice(0, LAST_N) };
  }
  // [years, finished, best score] for a difficulty, all devices.
  function totals(diff) {
    var out = [0, 0, 0];
    Object.keys(data.rows).forEach(function (id) {
      var v = data.rows[id].s[diff];
      if (v) { out[0] += v[0]; out[1] += v[1]; out[2] = Math.max(out[2], v[2]); }
    });
    return out;
  }
  function longestEver() {
    var n = 0;
    Object.keys(data.rows).forEach(function (id) { n = Math.max(n, data.rows[id].lr); });
    return n;
  }
  function load() {
    var raw = null;
    try { raw = localStorage.getItem(STORAGE_KEY); } catch (e) {}
    if (raw) {
      try {
        var parsed = JSON.parse(raw);
        if (parsed && typeof parsed === "object" && parsed.rows && typeof parsed.rows === "object") {
          data = mergeRoots(parsed, parsed);
          return;
        }
      } catch (e) {}
      try { localStorage.setItem(STORAGE_KEY + "-broken", raw); } catch (e) {}
      try { console.warn("[orOS] roots: unreadable data copied to " + STORAGE_KEY + "-broken"); } catch (e) {}
    }
    data = defaultData();
  }
  var saveFailShown = false;
  function save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
      saveFailShown = false;
    } catch (e) {
      if (!saveFailShown) { saveFailShown = true; showToast(t("toast.save")); }   // R30
    }
    if (window.__orosSyncApi) window.__orosSyncApi.dirty();
  }
  function ensureDeviceId() {
    try { deviceId = localStorage.getItem(DEVICE_KEY); } catch (e) {}
    if (!deviceId || !/^[a-z0-9]{6,32}$/.test(deviceId)) {
      deviceId = Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
      try { localStorage.setItem(DEVICE_KEY, deviceId); } catch (e) {}
    }
  }
  // A year ended: finished (every season's quota met) or not.
  function count(diff, won, score, longest) {
    var row = data.rows[deviceId];
    if (!row || row.b < data.br) row = { b: data.br, s: {}, lr: 0 };
    row = { b: row.b, s: JSON.parse(JSON.stringify(row.s)), lr: row.lr || 0 };
    var v = row.s[diff] ? row.s[diff].slice() : [0, 0, 0];
    v[0]++;
    if (won) v[1]++;
    v[2] = Math.max(v[2], clamp(score, 0, MAX_SCORE));
    row.s[diff] = v;
    row.lr = Math.max(row.lr, clamp(longest, 0, SIZE));
    data.rows[deviceId] = row;
    data = mergeRoots(data, data);
    save();
  }
  // Daily results: glades played, quota met, the current and best
  // streak of days with the quota met, the best score.
  function dailyStats(todayIdx) {
    var on = {}, n = 0, w = 0, best = 0;
    Object.keys(data.days).forEach(function (k) {
      var v = data.days[k];
      n++;
      best = Math.max(best, v.h);
      if (v.w) { on[k] = true; w++; }
    });
    var s2 = DK ? DK.streaks(on, todayIdx) : { cur: 0, best: 0 };
    return { n: n, w: w, cur: s2.cur, best: s2.best, top: best };
  }
  // One try a day: the first result counts.
  function countDaily(day, won, score, acts, bloom, quota) {
    if (data.days[day] && data.days[day].b >= data.br) return;
    var q = clamp(quota, 1, 99), n = clamp(bloom, 0, 99);
    data.days[day] = { b: data.br, w: n >= q ? 1 : 0, h: clamp(score, 0, MAX_SCORE), t: clamp(acts, 1, BIG - 1), n: n, q: q };
    data = mergeRoots(data, data);
    save();
  }
  // A year (or a Daily glade) ended: into Last years.
  function logYear(won) {
    var daily = game.opts.day !== undefined;
    // every season in bloom[] met its quota but a missed last one
    var met = st.bloom.length - (st.over === 0 ? 1 : 0);
    var v = normLast({ a: Date.now(), d: daily ? "d" : game.opts.diff, n: clamp(met, 0, daily ? 1 : E.SEASONS),
      w: won ? 1 : 0, h: clamp(E.score(st), 0, MAX_SCORE), s: game.opts.seed });
    if (!v) return;
    data.last = [v].concat(data.last || []);
    data = mergeRoots(data, data);
    save();
  }

  // ---------- 3. Device-local prefs + session ----------
  var prefs = { diff: "m", tour: false, fast: false, threat: false };
  function loadPrefs() {
    try {
      var p = JSON.parse(localStorage.getItem(PREFS_KEY) || "null");
      if (p && typeof p === "object") {
        if (DIFFS.indexOf(p.diff) >= 0) prefs.diff = p.diff;
        prefs.tour = p.tour === true;
        prefs.fast = p.fast === true;
        prefs.threat = p.threat === true;
      }
    } catch (e) {}
  }
  function savePrefs() {
    try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch (e) {}
  }

  // game = {
  //   g: engine state,
  //   opts: { diff, seed, day (the Daily glade only) },
  //   ts: the state at the start of this turn (Reset turn),
  //   pt: the state at the start of the turn before (Rewind, Mild) | null,
  //   counted: bool   the year's end is in the records
  // }
  var game = null;
  var undo = [];          // states before each action of this turn (JSON), not kept on close

  function validSession(s) {
    if (!s || typeof s !== "object" || !E.valid(s.g)) return false;
    var o = s.opts;
    if (!o || DIFFS.indexOf(o.diff) < 0 || o.diff !== s.g.diff || typeof o.seed !== "string" || o.seed !== s.g.seed) return false;
    if (o.day !== undefined && (!isInt(o.day) || o.day < 0 || o.day > MAX_DAY || s.g.one !== 1)) return false;
    if (o.day === undefined && s.g.one !== undefined) return false;
    if (!E.valid(s.ts) || s.ts.seed !== s.g.seed) return false;
    if (s.pt !== null && !(E.valid(s.pt) && s.pt.seed === s.g.seed)) return false;
    return true;
  }
  function loadSession() {
    try {
      var s = JSON.parse(localStorage.getItem(SESSION_KEY) || "null");
      if (validSession(s)) {
        var o = { diff: s.opts.diff, seed: s.opts.seed };
        if (s.opts.day !== undefined) o.day = s.opts.day;
        return { g: s.g, opts: o, ts: s.ts, pt: s.pt, counted: s.counted === true };
      }
    } catch (e) {}
    return null;
  }
  var sessionFailShown = false;
  function saveSession() {
    try {
      localStorage.setItem(SESSION_KEY, JSON.stringify(game));
      sessionFailShown = false;
    } catch (e) {
      if (!sessionFailShown) { sessionFailShown = true; showToast(t("toast.save")); }
    }
  }

  // ---------- 4. Year flow ----------
  var st = null;          // = game.g
  var pick = "root";      // the growth chosen in the bar
  var cursor = 17;        // keyboard cursor tile
  var busyUntil = 0;      // input waits while the end of a turn plays

  function inProgressOf(g) { return !!(g && !g.counted && g.g.over < 0 && g.g.acts > 0); }
  function makeGame(opts) {
    var daily = opts.day !== undefined;
    var g = daily ? E.newDaily(opts.seed) : E.newYear(opts.seed, opts.diff);
    var o = { diff: g.diff, seed: g.seed };
    if (daily) o.day = opts.day;
    return { g: g, opts: o, ts: E.clone(g), pt: null, counted: false };
  }
  function setState(g) {
    game.g = g;
    st = g;
  }
  function endYear(won) {
    game.counted = true;
    if (game.opts.day !== undefined) countDaily(game.opts.day, won, E.score(st), Math.max(1, st.acts), st.res ? st.res.b : 0, st.s.q);
    else count(game.opts.diff, won, E.score(st), Math.max(st.best, E.longest(st)));
    logYear(won);
  }
  function startGame(opts) {
    // a year under way and left counts as not finished
    if (game && inProgressOf(game)) endYear(false);
    game = makeGame(opts);
    st = game.g;
    undo = [];
    saveSession();
    seasonMsg();
    if (game.opts.day !== undefined) setMsg(t("daily.rules"));
    renderAll();
    live($("msg").textContent);
    maybeTour();
  }
  function setMsg(text) { $("msg").textContent = text || ""; }
  function seasonMsg() {
    if (st.phase === "rest") { setMsg(t("res.met")); return; }
    var m = st.one ? t("msg.daily", { s: t("sea." + st.sea), q: st.s.q }) : t("msg.season", { s: t("sea." + st.sea), n: st.sea, q: st.s.q });
    if (E.frost(st, st.s)) m += " " + t("msg.frost");
    setMsg(m);
  }
  function playable() { return game && st.over < 0 && st.phase === "play" && !st.s.done && Date.now() >= busyUntil; }
  // The action a tap on tile i makes with the chosen growth (or null).
  function actionAt(i) {
    if (pick === "leaf" || pick === "flower") return { t: "bud", at: i, k: pick === "leaf" ? "l" : "f" };
    return { t: pick, at: i };
  }
  function litTiles() {
    if (!playable()) return [];
    return E.options(st).filter(function (o) {
      return o.t === "bud" ? (pick === "leaf" && o.k === "l") || (pick === "flower" && o.k === "f") : o.t === pick;
    }).map(function (o) { return o.at; });
  }
  function costOf(g, i) {
    if (g === "root") return i >= 0 ? E.rootCost(st, i) : E.COST.root;
    if (g === "leaf" || g === "flower") return E.COST.bud;
    return E.COST[g];
  }
  function grow(i) {
    if (!playable()) return false;
    var a = actionAt(i);
    if (!E.legal(st, a)) {
      setMsg(st.sap < costOf(pick, i) ? t("msg.sap") : t("msg.none"));
      describeAfter(i);
      return false;
    }
    var before = JSON.stringify(st), ev = E.act(st, a);
    if (!ev) return false;
    undo.push(before);
    if (undo.length > 40) undo.shift();
    saveSession();
    sfx("grow");
    setMsg(t("msg.pick", { g: t("grow." + pick) }));
    renderAll();
    return true;
  }
  function describeAfter(i) { var m = $("msg").textContent; describe(i); setMsg(m + " " + $("msg").textContent); }
  function undoAct() {
    if (!playable() || !undo.length) return;
    setState(JSON.parse(undo.pop()));
    saveSession();
    seasonMsg();
    renderAll();
  }
  function resetTurn() {
    if (!playable() || !undo.length) return;
    setState(E.clone(game.ts));
    undo = [];
    saveSession();
    seasonMsg();
    renderAll();
  }
  function canRewind() { return !!(game && game.pt && playable() && st.s.rw > 0 && game.pt.sea === st.sea); }
  function rewind() {
    if (!canRewind()) return;
    var left = st.s.rw - 1, g = E.clone(game.pt);
    g.s.rw = left;
    setState(g);
    game.ts = E.clone(g);
    game.pt = null;
    undo = [];
    saveSession();
    showToast(t("toast.rewind", { n: left }));
    seasonMsg();
    renderAll();
  }
  function endTurn() {
    if (!playable()) return;
    var start = game.ts, ev = E.act(st, { t: "end" });
    if (!ev) return;
    undo = [];
    game.pt = st.s.done ? null : start;
    game.ts = E.clone(st);
    var step = prefs.fast ? 0 : 110;
    ev.forEach(function (e, k) { eventFx(e, k * step); });
    busyUntil = Date.now() + Math.min(1400, ev.length * step);
    var bad = ev.some(function (e) { return e.k === "lost" || e.k === "wither" || e.k === "eaten" || e.k === "frost"; });
    sfx(bad ? "hurt" : "end");
    if (bad) shake();
    if (st.over >= 0 && !game.counted) endYear(st.over === 1);
    saveSession();
    if (st.s.done) {
      setMsg(st.one ? t(st.over === 1 ? "daily.won" : "daily.lost", { n: E.score(st) }) : st.over === 0 ? t("res.miss") : st.over === 1 ? t("res.won") : t("res.met"));
      setTimeout(bloomDialog, Math.max(300, busyUntil - Date.now() + 200));
    }
    else {
      seasonMsg();
      setMsg(t("msg.turn", { n: st.s.turn }) + " " + $("msg").textContent);
      live(t("live.end", { n: st.s.turn, s: st.sap, b: E.bloomOf(st), q: st.s.q }));
    }
    renderAll();
  }
  function nextSeason() {
    var ev = E.act(st, { t: "next" });
    if (!ev) return false;
    game.ts = E.clone(st);
    game.pt = null;
    undo = [];
    seasonMsg();
    sfx("season");
    saveSession();
    renderAll();
    return true;
  }
  // Floating texts for the events.
  function eventFx(e, delay) {
    var good = { open: 1, thorn: 1, gone: 1 };
    var text = e.k === "thorn" ? t("ev.thorn", { n: e.n }) : STRINGS.en["ev." + e.k] !== undefined ? t("ev." + e.k) : "";
    if (text) addFx(e.at, text, good[e.k] ? "good" : "bad", delay);
  }

  // ---------- 5. Scene ----------
  var canvas, ctx, CW = 0, CH = 0, DPR = 1;
  var BX = 0, BY = 0, TS = 40;   // board origin and tile size
  var fx = [];
  var colors = {};

  function resize() {
    var main = $("scene"), r = main.getBoundingClientRect();
    DPR = Math.min(2, window.devicePixelRatio || 1);
    CW = Math.max(200, Math.floor(r.width));
    CH = Math.max(160, Math.floor(r.height));
    canvas.width = Math.round(CW * DPR);
    canvas.height = Math.round(CH * DPR);
    canvas.style.width = CW + "px";
    canvas.style.height = CH + "px";
    TS = Math.max(22, Math.floor(Math.min((CW - 12) / BW, (CH - 12) / BH)));
    BX = Math.floor((CW - TS * BW) / 2);
    BY = Math.floor((CH - TS * BH) / 2);
    draw();
  }
  function readColors() {
    var cs = getComputedStyle(document.documentElement);
    ["--bg", "--text", "--text-dim", "--accent", "--panel-bg", "--border", "--danger",
     "--rt-ground", "--rt-sky", "--rt-grass", "--rt-soil", "--rt-soil2", "--rt-stone", "--rt-spring", "--rt-mineral",
     "--rt-clay", "--rt-root", "--rt-cut", "--rt-bark", "--rt-leaf", "--rt-flower", "--rt-foe", "--rt-lit",
     "--rt-threat", "--rt-frost"].forEach(function (v) {
      colors[v.replace(/^--/, "")] = cs.getPropertyValue(v).trim() || "#888";
    });
  }
  function tileXY(i) { return { x: BX + (i % BW) * TS, y: BY + Math.floor(i / BW) * TS }; }
  function center(i) { var p = tileXY(i); return { x: p.x + TS / 2, y: p.y + TS / 2 }; }
  function tileAt(x, y) {
    var cx = Math.floor((x - BX) / TS), cy = Math.floor((y - BY) / TS);
    return cx < 0 || cy < 0 || cx >= BW || cy >= BH ? -1 : cy * BW + cx;
  }
  function addFx(at, text, kind, delay) {
    if (!isInt(at)) return;
    fx.push({ at: at, text: text, kind: kind, t0: Date.now() + (delay || 0) });
    if (!fxRunning) { fxRunning = true; requestAnimationFrame(fxLoop); }
  }
  var fxRunning = false;
  function fxLoop() {
    var now = Date.now();
    fx = fx.filter(function (f) { return now - f.t0 < 1000; });
    draw();
    if (fx.length) requestAnimationFrame(fxLoop);
    else fxRunning = false;
  }
  var drawPending = false;
  function draw() {
    if (drawPending || !ctx) return;
    drawPending = true;
    requestAnimationFrame(function () { drawPending = false; paint(); });
  }
  function rr(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }
  // Icons are 24 × 24 SVG paths, drawn with Path2D.
  var P = {
    beetle: "M12 6a5 6 0 0 1 5 6v3a5 5 0 0 1-10 0v-3a5 6 0 0 1 5-6zM12 6v14M9 3.5l1.5 2.5M15 3.5l-1.5 2.5M7 11H4M20 11h-3M7 15H4M20 15h-3",
    mole: "M4 16c0-5 4-8 8-8s8 3 8 8zM10 12h.01M14 12h.01M12 16v-2",
    aphid: "M8 14a4 3 0 1 0 8 0 4 3 0 1 0-8 0M16 13l3-3M12 11V7M8 13l-3-3M9 17l-2 3M15 17l2 3",
    blight: "M12 4c3 3 6 5 6 9a6 6 0 0 1-12 0c0-4 3-6 6-9zM9.5 13h.01M14.5 13h.01M12 16.5h.01",
    chew: "M5 9l2.3 4 2.3-4 2.4 4 2.3-4 2.4 4L19 9M5 15h14",
    eat: "M4 12l9-4v8zM13 10l6-2M13 14l6 2",
    dig: "M12 3v10M8 13h8l-1 6H9zM12 3l-2 2M12 3l2 2",
    spread: "M9 12a3 3 0 1 0 6 0 3 3 0 1 0-6 0M12 3v4M12 17v4M3 12h4M17 12h4",
    snow: "M12 3v18M4.2 7.5l15.6 9M4.2 16.5l15.6-9"
  };
  var PATHS = {};
  function path(name) {
    if (!PATHS[name]) PATHS[name] = new Path2D(P[name]);
    return PATHS[name];
  }
  function icon(name, x, y, size, color, width) {
    ctx.save();
    ctx.translate(x - size / 2, y - size / 2);
    ctx.scale(size / 24, size / 24);
    ctx.strokeStyle = color;
    ctx.lineWidth = width || 2;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.stroke(path(name));
    ctx.restore();
  }
  function arrow(x0, y0, x1, y1, color, w) {
    var a = Math.atan2(y1 - y0, x1 - x0), h = Math.max(6, TS * 0.16);
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = w || 2.5;
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1 - Math.cos(a) * h * 0.6, y1 - Math.sin(a) * h * 0.6);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x1 - Math.cos(a - 0.45) * h, y1 - Math.sin(a - 0.45) * h);
    ctx.lineTo(x1 - Math.cos(a + 0.45) * h, y1 - Math.sin(a + 0.45) * h);
    ctx.closePath();
    ctx.fill();
  }
  function badge(x, y, text, bg, fg) {
    var r = Math.max(7, TS * 0.14);
    ctx.fillStyle = bg;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = fg;
    ctx.font = "800 " + Math.round(r * 1.25) + "px Nunito, system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(String(text), x, y + 0.5);
  }

  function paint() {
    if (!ctx || !st) return;
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    ctx.clearRect(0, 0, CW, CH);
    ctx.fillStyle = colors["rt-ground"];
    ctx.fillRect(0, 0, CW, CH);
    var s = st.s, on = E.joined(st), i;
    for (i = 0; i < SIZE; i++) paintTile(i);
    paintThreats(s);
    litTiles().forEach(function (k) { tint(k, colors["rt-lit"], 0.42); });
    paintRoots(on);
    for (i = 0; i < BW; i++) paintBud(i, on);
    if (!s.done) paintNext(s);
    if (!s.done && !prefs.threat) paintIntents(s);
    s.u.forEach(function (u) { paintPest(u); });
    if (kbUsed && cursor >= 0) {
      var p = tileXY(cursor);
      ctx.strokeStyle = colors.text;
      ctx.lineWidth = 2;
      ctx.setLineDash([4, 3]);
      rr(p.x + 2, p.y + 2, TS - 4, TS - 4, 6);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    paintFx();
  }
  function paintTile(i) {
    var p = tileXY(i), c = st.t[i], g = 1, x0 = p.x + g, y0 = p.y + g, w = TS - 2 * g;
    var cx = p.x + TS / 2, cy = p.y + TS / 2;
    if (i < BW) {
      ctx.fillStyle = colors["rt-sky"];
      ctx.fillRect(p.x, p.y, TS, TS);
      ctx.fillStyle = colors["rt-grass"];
      ctx.fillRect(p.x, p.y + TS * 0.84, TS, TS * 0.16);
      if (E.frost(st, st.s) && !st.s.done) {
        ctx.globalAlpha = 0.25;
        ctx.fillStyle = colors["rt-frost"];
        ctx.fillRect(p.x, p.y, TS, TS);
        ctx.globalAlpha = 1;
      }
      if (c === "T") {
        ctx.fillStyle = colors["rt-bark"];
        ctx.beginPath();
        ctx.moveTo(x0 + w * 0.3, y0 + w);
        ctx.lineTo(x0 + w * 0.38, y0 + w * 0.3);
        ctx.lineTo(x0 + w * 0.62, y0 + w * 0.3);
        ctx.lineTo(x0 + w * 0.7, y0 + w);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = colors["rt-leaf"];
        [[-0.2, 0.2], [0.2, 0.2], [0, 0.08]].forEach(function (o) {
          ctx.beginPath();
          ctx.arc(cx + o[0] * w, y0 + o[1] * w + w * 0.06, w * 0.2, 0, Math.PI * 2);
          ctx.fill();
        });
      }
      return;
    }
    ctx.fillStyle = (i + Math.floor(i / BW)) % 2 ? colors["rt-soil"] : colors["rt-soil2"];
    rr(x0, y0, w, w, 4);
    ctx.fill();
    if (c === "#") {
      ctx.fillStyle = colors["rt-stone"];
      ctx.beginPath();
      ctx.moveTo(x0 + w * 0.14, y0 + w * 0.72);
      ctx.lineTo(x0 + w * 0.24, y0 + w * 0.3);
      ctx.lineTo(x0 + w * 0.56, y0 + w * 0.16);
      ctx.lineTo(x0 + w * 0.86, y0 + w * 0.42);
      ctx.lineTo(x0 + w * 0.8, y0 + w * 0.84);
      ctx.lineTo(x0 + w * 0.34, y0 + w * 0.88);
      ctx.closePath();
      ctx.fill();
    } else if (c === "w") {
      ctx.fillStyle = colors["rt-spring"];
      rr(x0 + w * 0.12, y0 + w * 0.18, w * 0.76, w * 0.64, w * 0.3);
      ctx.fill();
      ctx.strokeStyle = "rgba(255,255,255,0.4)";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(x0 + w * 0.3, cy);
      ctx.quadraticCurveTo(x0 + w * 0.4, cy - w * 0.06, x0 + w * 0.5, cy);
      ctx.quadraticCurveTo(x0 + w * 0.6, cy + w * 0.06, x0 + w * 0.7, cy);
      ctx.stroke();
    } else if (c === "m") {
      ctx.fillStyle = colors["rt-mineral"];
      [[0.3, 0.62, 0.12], [0.55, 0.5, 0.16], [0.72, 0.68, 0.1]].forEach(function (o) {
        var mx = x0 + o[0] * w, my = y0 + o[1] * w, h = o[2] * w;
        ctx.beginPath();
        ctx.moveTo(mx, my - h * 1.6);
        ctx.lineTo(mx + h * 0.7, my);
        ctx.lineTo(mx, my + h * 0.7);
        ctx.lineTo(mx - h * 0.7, my);
        ctx.closePath();
        ctx.fill();
      });
    } else if (c === "c") {
      ctx.fillStyle = colors["rt-clay"];
      rr(x0 + 2, y0 + 2, w - 4, w - 4, 4);
      ctx.fill();
      ctx.fillStyle = "rgba(0,0,0,0.18)";
      [[0.25, 0.3], [0.65, 0.25], [0.45, 0.6], [0.75, 0.72], [0.22, 0.75]].forEach(function (o) {
        ctx.beginPath();
        ctx.arc(x0 + o[0] * w, y0 + o[1] * w, Math.max(1.2, w * 0.035), 0, Math.PI * 2);
        ctx.fill();
      });
    }
  }
  function rootWidth(i) { return st.r[i] === 2 ? TS * 0.22 : TS * 0.12; }
  // Each root is drawn as half-links to its neighbours, at its own width.
  function paintRoots(on) {
    var i, d, n;
    ctx.lineCap = "round";
    for (i = BW; i < SIZE; i++) {
      if (!st.r[i]) continue;
      var c = center(i), cut = !on[i];
      ctx.strokeStyle = cut ? colors["rt-cut"] : colors["rt-root"];
      ctx.fillStyle = ctx.strokeStyle;
      ctx.lineWidth = rootWidth(i);
      if (cut) ctx.setLineDash([TS * 0.08, TS * 0.08]);
      for (d = 0; d < 4; d++) {
        n = E.step(i, d);
        if (n < 0 || !(st.r[n] || (i === E.BASE && n === E.TRUNK))) continue;
        var m = center(n);
        ctx.beginPath();
        ctx.moveTo(c.x, c.y);
        ctx.lineTo((c.x + m.x) / 2, (c.y + m.y) / 2 + (n === E.TRUNK ? -TS * 0.1 : 0));
        ctx.stroke();
      }
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.arc(c.x, c.y, rootWidth(i) * 0.75, 0, Math.PI * 2);
      ctx.fill();
      if (st.th[i]) {
        ctx.lineWidth = Math.max(1.5, TS * 0.05);
        for (d = 0; d < 4; d++) {
          var a = Math.PI / 4 + d * Math.PI / 2, r0 = rootWidth(i) * 0.6, r1 = TS * 0.3;
          ctx.beginPath();
          ctx.moveTo(c.x + Math.cos(a) * r0, c.y + Math.sin(a) * r0);
          ctx.lineTo(c.x + Math.cos(a) * r1, c.y + Math.sin(a) * r1);
          ctx.stroke();
        }
      }
      if (cut && st.cut[i]) badge(c.x + TS * 0.3, c.y - TS * 0.3, st.cut[i], colors.danger, "#fff");
    }
  }
  function paintBud(i, on) {
    var k = st.bk[i];
    if (!k) return;
    var p = tileXY(i), cx = p.x + TS / 2, base = p.y + TS * 0.86, top = p.y + TS * (k >= 3 ? 0.36 : 0.5);
    ctx.strokeStyle = colors["rt-leaf"];
    ctx.lineWidth = Math.max(1.5, TS * 0.05);
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(cx, base);
    ctx.lineTo(cx, top);
    ctx.stroke();
    if (k === 1 || k === 2) {
      ctx.fillStyle = k === 1 ? colors["rt-leaf"] : colors["rt-flower"];
      ctx.beginPath();
      ctx.ellipse(cx, top, TS * 0.08, TS * 0.13, 0, 0, Math.PI * 2);
      ctx.fill();
      var waiting = !on[i + BW];
      badge(p.x + TS * 0.78, p.y + TS * 0.24, waiting ? "…" : st.ba[i], waiting ? colors.border : colors["rt-lit"], waiting ? colors.text : "#fff");
    } else if (k === 3) {
      ctx.fillStyle = colors["rt-leaf"];
      [-1, 1].forEach(function (sx) {
        ctx.beginPath();
        ctx.ellipse(cx + sx * TS * 0.14, top + TS * 0.12, TS * 0.16, TS * 0.08, sx * -0.5, 0, Math.PI * 2);
        ctx.fill();
      });
    } else {
      ctx.fillStyle = colors["rt-flower"];
      for (var j = 0; j < 5; j++) {
        var a = j * Math.PI * 2 / 5 - Math.PI / 2;
        ctx.beginPath();
        ctx.arc(cx + Math.cos(a) * TS * 0.11, top + Math.sin(a) * TS * 0.11, TS * 0.08, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.fillStyle = colors.accent;
      ctx.beginPath();
      ctx.arc(cx, top, TS * 0.06, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  function tint(i, col, a) {
    var p = tileXY(i);
    ctx.globalAlpha = a;
    ctx.fillStyle = col;
    rr(p.x + 1, p.y + 1, TS - 2, TS - 2, 4);
    ctx.fill();
    ctx.globalAlpha = 1;
  }
  // The tiles a pest will harm this turn: the root it chews, the line it digs, the bud it eats.
  function harmed(s, u) {
    var it = u.it, out = [];
    if (!it) return out;
    if (it.a === "chew" && it.b >= 0) out.push(it.b);
    else if (it.a === "eat" && it.e >= 0) out.push(it.e);
    else if (it.a === "spread" && it.to >= 0) out.push(it.to);
    else if (it.a === "dig") {
      var x = u.at;
      for (var k = 0; k < E.PESTS.mole.mv; k++) {
        x = E.step(x, it.d);
        if (x < 0 || !E.soil(st.t, x)) break;
        out.push(x);
      }
    }
    return out;
  }
  function paintThreats(s) {
    if (s.done) return;
    s.u.forEach(function (u) {
      harmed(s, u).forEach(function (k) { tint(k, colors["rt-threat"], prefs.threat ? 0.45 : 0.22); });
    });
  }
  function paintNext(s) {
    s.next.forEach(function (e) {
      if (E.pestAt(s, e.at)) return;
      var c = center(e.at);
      ctx.setLineDash([3, 3]);
      ctx.strokeStyle = colors["rt-foe"];
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(c.x, c.y, TS * 0.32, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.globalAlpha = 0.6;
      icon(e.k, c.x, c.y, TS * 0.42, colors["rt-foe"], 1.8);
      ctx.globalAlpha = 1;
    });
  }
  function paintIntents(s) {
    s.u.slice().sort(function (a, b) { return a.id - b.id; }).forEach(function (u, n) {
      var it = u.it;
      if (!it) return;
      var a = center(u.at), hit = harmed(s, u), goal = it.a === "dig" ? (hit.length ? hit[hit.length - 1] : -1) : it.to;
      if (goal >= 0 && goal !== u.at) {
        var b = center(goal);
        arrow(a.x + (b.x - a.x) * 0.3, a.y + (b.y - a.y) * 0.3, b.x - (b.x - a.x) * 0.15, b.y - (b.y - a.y) * 0.15, colors["rt-threat"], 3);
      }
      hit.forEach(function (k) {
        var c = center(k);
        icon(it.a === "chew" ? "chew" : it.a === "eat" ? "eat" : it.a === "dig" ? "dig" : "spread", c.x, c.y, TS * 0.34, colors["rt-threat"], 2.4);
      });
      badge(a.x - TS * 0.32, a.y - TS * 0.32, n + 1, colors["rt-threat"], "#fff");
    });
  }
  function paintPest(u) {
    var c = center(u.at), r = TS * 0.3;
    ctx.fillStyle = colors["rt-foe"];
    ctx.beginPath();
    ctx.arc(c.x, c.y, r, 0, Math.PI * 2);
    ctx.fill();
    icon(u.k, c.x, c.y, r * 1.35, colors.bg, 2.2);
    var m = E.PESTS[u.k].hp, rd = Math.max(2, TS / 24), gap = rd * 2.6, x = c.x - (m - 1) * gap / 2;
    for (var k = 0; k < m; k++) {
      ctx.fillStyle = k < u.hp ? colors["rt-foe"] : colors.border;
      ctx.beginPath();
      ctx.arc(x + k * gap, c.y + TS * 0.4, rd, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  function paintFx() {
    var now = Date.now();
    fx.forEach(function (f) {
      var age = now - f.t0;
      if (age < 0) return;
      var c = center(f.at), k = age / 1000;
      ctx.globalAlpha = Math.max(0, 1 - k);
      ctx.fillStyle = f.kind === "good" ? colors["rt-lit"] : colors.danger;
      ctx.font = "800 " + Math.round(TS * 0.26) + "px Nunito, system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(f.text, c.x, c.y - TS * 0.3 - k * TS * 0.4);
      ctx.globalAlpha = 1;
    });
  }
  function reducedMotion() {
    try { return window.matchMedia("(prefers-reduced-motion: reduce)").matches; } catch (e) { return false; }
  }
  function shake() {
    if (reducedMotion() || prefs.fast) return;
    var m = $("scene");
    m.classList.remove("shake");
    void m.offsetWidth;
    m.classList.add("shake");
  }
  function live(msg) {
    var n = $("live");
    n.textContent = "";
    setTimeout(function () { n.textContent = msg; }, 30);
  }

  // ---------- 6. Input ----------
  var kbUsed = false;
  function tap(i) {
    if (i < 0 || !st) return;
    if (playable() && litTiles().indexOf(i) >= 0) { grow(i); return; }
    describe(i);
  }
  // A short line about a tile (the full text is a long press away).
  function describe(i) {
    var s = st.s, u = E.pestAt(s, i);
    if (u) { setMsg(t("pest." + u.k) + " · " + intentText(u)); draw(); return; }
    var e = s.next.filter(function (x) { return x.at === i; })[0];
    setMsg(e ? t("info.comes", { k: t("pest." + e.k) }) : tileName(i));
    draw();
  }
  function tileName(i) {
    var c = st.t[i], parts = [i === E.BASE ? t("tile.base") : t("tile." + c)];
    if (i < BW) {
      var k = st.bk[i];
      if (k) parts.push(t("bud." + k, { n: st.ba[i] }));
      if ((k === 1 || k === 2) && !E.joined(st)[i + BW]) parts.push(t("bud.wait"));
      return parts.join(" · ");
    }
    if (st.r[i] && i !== E.BASE) {
      parts.push(t("root." + st.r[i]));
      if (st.th[i]) parts.push(t("root.thorn"));
      if (st.cut[i]) parts.push(t("root.cut", { n: st.cut[i] }));
    }
    return parts.join(" · ");
  }
  function intentText(u) {
    var it = u.it;
    if (!it) return t("it.idle");
    if (it.a === "chew") return it.b >= 0 ? t("it.chew") : t("it.walk");
    if (it.a === "eat") return it.e >= 0 ? t("it.eat") : t("it.walk");
    if (it.a === "dig") return t("it.dig", { d: t("dir." + it.d) });
    if (it.a === "spread") return t("it.spread");
    return t("it.walk");
  }
  function localXY(e) {
    var r = canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }
  function wireInput() {
    var press = null;
    canvas.addEventListener("pointerdown", function (e) {
      var p = localXY(e);
      kbUsed = false;
      press = { x: p.x, y: p.y, long: false };
      press.timer = setTimeout(function () {
        if (!press) return;
        press.long = true;
        var i = tileAt(press.x, press.y);
        if (i >= 0) infoDialog(i);
      }, 520);
    });
    canvas.addEventListener("pointermove", function (e) {
      if (!press) return;
      var p = localXY(e);
      if (Math.abs(p.x - press.x) + Math.abs(p.y - press.y) > 14) { clearTimeout(press.timer); press = null; }
    });
    canvas.addEventListener("pointerup", function () {
      if (!press) return;
      clearTimeout(press.timer);
      var p = press;
      press = null;
      if (!p.long) tap(tileAt(p.x, p.y));
    });
    canvas.addEventListener("pointercancel", function () { if (press) clearTimeout(press.timer); press = null; });
    canvas.addEventListener("contextmenu", function (e) { e.preventDefault(); });
  }
  function choose(g) {
    pick = g;
    if (playable()) setMsg(t("msg.pick", { g: t("grow." + g) }));
    renderActs();
    draw();
  }
  function wireKeyboard() {
    document.addEventListener("keydown", function (e) {
      if (document.querySelector("dialog[open]") || e.ctrlKey || e.metaKey || e.altKey) return;
      var k = e.key;
      if (k === "n" || k === "N") { e.preventDefault(); askNew(); return; }
      if (!st) return;
      if (k === "t" || k === "T") { e.preventDefault(); toggleThreat(); return; }
      if (k === "z" || k === "Z") { e.preventDefault(); undoAct(); return; }
      if (k === "r" || k === "R") { e.preventDefault(); resetTurn(); return; }
      if (k === "e" || k === "E") {
        e.preventDefault();
        if (st.phase === "rest") nextSeason(); else endTurn();
        return;
      }
      var gi = "12345".indexOf(k);
      if (gi >= 0) { e.preventDefault(); choose(GROW[gi]); return; }
      var d = { ArrowUp: 0, ArrowRight: 1, ArrowDown: 2, ArrowLeft: 3 }[k];
      if (d !== undefined) {
        e.preventDefault();
        kbUsed = true;
        var nx = E.step(cursor, d);
        if (nx >= 0) cursor = nx;
        describe(cursor);
        return;
      }
      if (k === "Enter" || k === " ") {
        if (document.activeElement && document.activeElement.tagName === "BUTTON") return;
        e.preventDefault();
        kbUsed = true;
        tap(cursor);
      }
    });
  }
  function toggleThreat() {
    prefs.threat = !prefs.threat;
    savePrefs();
    paintThreatBtn();
    draw();
  }

  // ---------- 7. Panels ----------
  function renderAll() {
    renderStatus();
    renderActs();
    renderTools();
    draw();
  }
  function stat(id, value, title, cls) {
    var n = $(id), v = n.querySelector(".v");
    v.textContent = value;
    v.className = "v" + (cls ? " " + cls : "");
    n.title = title;
    n.setAttribute("aria-label", title);
  }
  function renderStatus() {
    if (!st) return;
    var s = st.s, inc = E.income(st), b = s.done && st.res ? st.res.b : E.bloomOf(st);
    stat("s-sea", t("sea." + st.sea), t("sea." + st.sea) + " · " + st.sea + "/" + E.SEASONS);
    stat("s-turn", s.turn + "/" + E.T, t("st.turn", { n: s.turn, m: E.T }));
    stat("s-sap", st.sap + " +" + inc, t("st.sap", { n: st.sap, g: inc }));
    stat("s-bloom", b + "/" + s.q, t("st.bloom", { n: b, q: s.q }), b >= s.q ? "ok" : "low");
  }
  function renderTools() {
    var play = !!(st && st.phase === "play" && st.over < 0 && !st.s.done);
    $("end-btn").disabled = !play;
    $("undo-btn").disabled = !play || !undo.length;
    $("reset-btn").disabled = !play || !undo.length;
    var rw = $("rewind-btn");
    rw.hidden = !(st && st.diff === "m");
    rw.disabled = !canRewind();
    var db = $("daily-btn");
    db.hidden = !DK;
    db.classList.toggle("due", !!DK && !data.days[today()]);
    db.classList.toggle("on", !!(game && game.opts.day !== undefined && !game.counted));
  }
  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  }
  function renderActs() {
    var bar = $("acts");
    bar.innerHTML = "";
    if (!st) return;
    if (st.phase === "rest" && st.over < 0) {
      var nx = el("button", "act wide");
      nx.type = "button";
      nx.appendChild(el("span", "nm", t("res.next")));
      nx.appendChild(el("span", "cost", t("sea." + (st.sea + 1))));
      nx.addEventListener("click", nextSeason);
      bar.appendChild(nx);
      return;
    }
    if (st.over >= 0) {
      var nw = el("button", "act wide");
      nw.type = "button";
      nw.appendChild(el("span", "nm", t("res.new")));
      nw.addEventListener("click", newDialog);
      bar.appendChild(nw);
      return;
    }
    var opts = playable() ? E.options(st) : [];
    GROW.forEach(function (g, gi) {
      var b = el("button", "act");
      b.type = "button";
      b.appendChild(el("span", "nm", t("grow.short." + g)));
      b.appendChild(el("span", "cost", t("grow.cost", { n: costOf(g, -1) })));
      var any = opts.some(function (o) { return o.t === "bud" ? (g === "leaf" && o.k === "l") || (g === "flower" && o.k === "f") : o.t === g; });
      if (!any) b.classList.add("none");
      b.disabled = st.s.done;
      b.setAttribute("aria-pressed", pick === g ? "true" : "false");
      b.title = t("grow." + g) + " (" + (gi + 1) + ") · " + t("grow.cost", { n: costOf(g, -1) }) + " · " + t("grow." + g + ".note");
      b.addEventListener("click", function () { choose(g); });
      bar.appendChild(b);
    });
  }

  // ---------- 8. Dialogs ----------
  function makeDialog(id, cls) {
    var stale = document.getElementById(id);
    if (stale) stale.remove();
    var dlg = document.createElement("dialog");
    dlg.id = id;
    dlg.className = "mm-dlg" + (cls ? " " + cls : "");
    dlg.addEventListener("click", function (e) { if (e.target === dlg && !dlg.hasAttribute("data-modal")) dlg.close(); });
    dlg.addEventListener("close", function () {
      parkToast();
      setTimeout(function () { dlg.remove(); }, 0);
    });
    return dlg;
  }
  function row(k, v) {
    var r = el("div", "dlg-row");
    r.appendChild(el("span", "", k));
    r.appendChild(el("strong", "", v));
    return r;
  }
  function button(label, cls, fn) {
    var b = el("button", "dlg-btn" + (cls ? " " + cls : ""), label);
    b.type = "button";
    b.addEventListener("click", fn);
    return b;
  }
  function segField(label, values, cur, nameKey, onPick) {
    var wrap = el("div", "dlg-field");
    wrap.appendChild(el("div", "dlg-label", label));
    var seg = el("div", "seg");
    seg.setAttribute("role", "group");
    seg.setAttribute("aria-label", label);
    values.forEach(function (v) {
      var b = el("button", "seg-btn" + (v === cur ? " active" : ""), t(nameKey + v));
      b.type = "button";
      b.setAttribute("aria-pressed", v === cur ? "true" : "false");
      b.addEventListener("click", function () {
        [].forEach.call(seg.children, function (x) { x.classList.remove("active"); x.setAttribute("aria-pressed", "false"); });
        b.classList.add("active");
        b.setAttribute("aria-pressed", "true");
        onPick(v);
      });
      seg.appendChild(b);
    });
    wrap.appendChild(seg);
    return wrap;
  }
  function show(dlg, focus) {
    document.body.appendChild(dlg);
    dlg.showModal();
    if (focus) focus.focus();
  }

  function askNew() {
    cancelTourWait();
    if (game && game.opts.day !== undefined && inProgressOf(game)) confirmDialog(t("daily.leave"), function () { leaveDaily(); newDialog(); }, t("daily.leaveYes"), t("daily.leaveNo"));
    else if (game && inProgressOf(game)) confirmDialog(t("confirm.new"), newDialog, t("confirm.newYes"));
    else newDialog();
  }
  function newDialog() {
    var o = { diff: prefs.diff };
    var dlg = makeDialog("rt-new");
    dlg.appendChild(el("div", "dlg-title", t("new.title")));
    var dnote = el("div", "dlg-note", t("diff." + o.diff + ".note"));
    dlg.appendChild(segField(t("new.diff"), DIFFS, o.diff, "diff.", function (v) { o.diff = v; dnote.textContent = t("diff." + v + ".note"); }));
    dlg.appendChild(dnote);
    var f = el("div", "dlg-field");
    f.appendChild(el("label", "dlg-label", t("new.seed")));
    var inp = el("input", "dlg-input");
    inp.type = "text";
    inp.maxLength = 16;
    inp.placeholder = t("new.seedHint");
    inp.setAttribute("aria-label", t("new.seed"));
    inp.autocomplete = "off";
    inp.spellcheck = false;
    f.appendChild(inp);
    dlg.appendChild(f);
    var acts = el("div", "dlg-actions");
    acts.appendChild(button(t("new.cancel"), "", function () { dlg.close(); }));
    var start = button(t("new.start"), "primary", function () {
      prefs.diff = o.diff;
      savePrefs();
      dlg.close();
      startGame({ diff: o.diff, seed: cleanSeed(inp.value) || newSeed() });
    });
    acts.appendChild(start);
    dlg.appendChild(acts);
    show(dlg, start);
  }
  function infoDialog(i) {
    if (!st) return;
    var s = st.s, u = E.pestAt(s, i), dlg = makeDialog("rt-info");
    if (u) {
      dlg.appendChild(el("div", "dlg-title", t("pest." + u.k)));
      dlg.appendChild(row(t("it.hp", { n: u.hp }), u.k === "blight" ? "" : t("it.left", { n: u.lt })));
      dlg.appendChild(el("div", "dlg-msg", t("pest." + u.k + ".note")));
      dlg.appendChild(el("div", "dlg-note", intentText(u)));
    }
    dlg.appendChild(el("div", u ? "dlg-sub" : "dlg-title", tileName(i)));
    var c = st.t[i];
    if (c === "w" || c === "m" || c === "c") dlg.appendChild(el("div", "dlg-note", t("tile." + c + ".note")));
    var e = s.next.filter(function (x) { return x.at === i; })[0];
    if (e) {
      dlg.appendChild(el("div", "dlg-note", t("info.comes", { k: t("pest." + e.k) })));
      dlg.appendChild(el("div", "dlg-note", t("pest." + e.k + ".note")));
    }
    var acts = el("div", "dlg-actions");
    var close = button(t("info.close"), "primary", function () { dlg.close(); });
    acts.appendChild(close);
    dlg.appendChild(acts);
    show(dlg, close);
  }
  function bloomDialog() {
    if (!st || !st.res || document.querySelector("dialog[open]")) return;
    var r = st.res, met = r.b >= r.q, on = E.joined(st);
    var dlg = makeDialog("rt-bloom");
    dlg.setAttribute("data-modal", "1");
    dlg.appendChild(el("div", "dlg-title", t("res.bloom") + " · " + t("sea." + st.sea)));
    dlg.appendChild(el("div", "dlg-hero" + (met ? "" : " lost"), t("res.bloom") + " " + r.b));
    dlg.appendChild(row(t("res.flowers"), String(E.flowers(st))));
    dlg.appendChild(row(t("res.springs"), String(E.springs(st, on))));
    dlg.appendChild(row(t("res.quota"), String(r.q)));
    dlg.appendChild(el("div", "dlg-msg", st.one ? t(met ? "daily.won" : "daily.lost", { n: E.score(st) }) : met ? (st.over === 1 ? t("res.won") : t("res.met")) : t("res.miss")));
    var acts = el("div", "dlg-actions");
    var go = button(st.over >= 0 ? t("info.close") : t("res.next"), "primary", function () {
      dlg.close();
      if (st.over >= 0) setTimeout(resultDialog, 0);
      else nextSeason();
    });
    acts.appendChild(go);
    dlg.appendChild(acts);
    dlg.addEventListener("cancel", function (e) { e.preventDefault(); });
    sfx(met ? "win" : "end");
    show(dlg, go);
  }
  function resultDialog() {
    if (!game || st.over < 0 || document.querySelector("dialog[open]")) return;
    if (game.opts.day !== undefined) { dailyDialog(game.opts.day); return; }
    var dlg = makeDialog("rt-result"), won = st.over === 1;
    dlg.appendChild(el("div", "dlg-title", t("app.name") + " · " + t("diff." + game.opts.diff)));
    dlg.appendChild(el("div", "dlg-hero" + (won ? "" : " lost"), won ? t("res.won") : t("res.lost")));
    st.bloom.forEach(function (b, k) { dlg.appendChild(row(t("sea." + (k + 1)), String(b))); });
    dlg.appendChild(row(t("res.springs"), String(E.springs(st))));
    dlg.appendChild(row(t("res.longest"), String(E.longest(st))));
    dlg.appendChild(row(t("res.score"), String(E.score(st))));
    dlg.appendChild(el("div", "dlg-note", t("res.scoreNote")));
    dlg.appendChild(el("div", "dlg-note", t("res.code", { seed: game.opts.seed })));
    var acts = el("div", "dlg-actions wrap");
    acts.appendChild(button(t("res.same"), "", function () { dlg.close(); startGame({ diff: game.opts.diff, seed: game.opts.seed }); }));
    var again = button(t("res.new"), "primary", function () { dlg.close(); newDialog(); });
    acts.appendChild(again);
    dlg.appendChild(acts);
    show(dlg, again);
  }
  function statsDialog() {
    var dlg = makeDialog("rt-stats");
    dlg.appendChild(el("div", "dlg-title", t("stats.title")));
    dlg.appendChild(el("div", "dlg-sub", t("stats.head")));
    var empty = true;
    DIFFS.forEach(function (m) {
      var v = totals(m);
      if (v[0]) empty = false;
      dlg.appendChild(row(t("diff." + m), v[0] + " · " + v[1] + " · " + v[2]));
    });
    dlg.appendChild(row(t("stats.long"), String(longestEver())));
    if (DK) {
      var ds = dailyStats(today());
      if (ds.n) empty = false;
      dlg.appendChild(el("div", "dlg-sub", t("stats.daily") + " · " + t("stats.dailyRow")));
      dlg.appendChild(row(t("daily.label"), ds.n ? ds.n + " · " + ds.w + " · " + ds.cur + " · " + ds.top : "–"));
    }
    if ((data.last || []).length) empty = false;
    lastYears(dlg);
    if (game) dlg.appendChild(el("div", "dlg-note", t("stats.code", { seed: game.opts.seed })));
    var acts = el("div", "dlg-actions");
    var reset = button(t("stats.reset"), "danger", function () {
      dlg.close();
      confirmDialog(t("confirm.reset"), resetRecords);
    });
    reset.disabled = empty;
    acts.appendChild(reset);
    var close = button(t("stats.close"), "primary", function () { dlg.close(); });
    acts.appendChild(close);
    dlg.appendChild(acts);
    show(dlg, close);
  }
  function confirmDialog(msg, onYes, yesLabel, noLabel) {
    var dlg = makeDialog("rt-confirm");
    dlg.appendChild(el("div", "dlg-msg", msg));
    var acts = el("div", "dlg-actions");
    var no = button(noLabel || t("confirm.no"), "", function () { dlg.close(); });
    acts.appendChild(no);
    acts.appendChild(button(yesLabel || t("confirm.yes"), "danger", function () { dlg.close(); setTimeout(onYes, 0); }));
    dlg.appendChild(acts);
    show(dlg, no);
  }
  function lastYears(dlg) {
    var list = data.last || [];
    if (!list.length) return;
    dlg.appendChild(el("div", "dlg-sub", t("last.title")));
    var box = el("div", "lr-list");
    list.forEach(function (v) {
      var r = el("div", "lr-row");
      var what = v.d === "d" ? t(v.w ? "last.met" : "last.missed") : (v.w ? t("last.won") : t("last.seasons", { n: v.n, m: E.SEASONS }));
      var tx = el("div", "lr-tx");
      tx.appendChild(el("div", "nm", (v.d === "d" ? t("daily.label") : t("diff." + v.d)) + " · " + what));
      tx.appendChild(el("div", "fx", t("last.score", { n: v.h }) + " · " +
        (DK ? DK.dateLabel(DK.dayIndex(new Date(v.a)), LANG) + " · " : "") + v.s));
      r.appendChild(tx);
      // a Daily glade replays as a whole year on Hardy on its glade
      var b = button(t("last.replay"), "", function () {
        dlg.close();
        var go = function () { startGame({ diff: v.d === "d" ? "h" : v.d, seed: v.s }); };
        if (game && game.opts.day !== undefined && inProgressOf(game)) confirmDialog(t("daily.leave"), function () { leaveDaily(); go(); }, t("daily.leaveYes"), t("daily.leaveNo"));
        else if (game && inProgressOf(game)) confirmDialog(t("confirm.new"), go, t("confirm.newYes"));
        else go();
      });
      b.setAttribute("aria-label", t("last.replayLabel", { seed: v.s }));
      r.appendChild(b);
      box.appendChild(r);
    });
    dlg.appendChild(box);
  }

  // ---------- Daily glade ----------
  // One season on Hardy from a bare tree: the glade and the season come
  // from the seed "rt" + the date, the same for everyone that day; one try.
  function today() { return DK ? DK.today() : 0; }
  function dailyOpts(day) {
    return { diff: "h", seed: cleanSeed(DK.seedOf("rt", day)), day: day };
  }
  // A Daily glade left before its end counts as a missed quota.
  function leaveDaily() {
    if (game && game.opts.day !== undefined && inProgressOf(game)) {
      endYear(false);
      saveSession();
      renderAll();
    }
  }
  // The Daily button: today's result when it is played (here or on
  // another device), else today's glade (resumed when it is open).
  function openDaily() {
    cancelTourWait();
    if (!DK) { showToast(t("toast.dailyGone")); return; }
    var d = today();
    if (data.days[d]) { dailyDialog(d); return; }
    if (game && game.opts.day === d && !game.counted) return;
    var go = function () { startGame(dailyOpts(d)); };
    if (game && inProgressOf(game)) confirmDialog(t("daily.giveUp"), go, t("daily.go"), t("daily.leaveNo"));
    else go();
  }
  function dailyDialog(day) {
    var r = data.days[day];
    if (!r || !DK || document.querySelector("dialog[open]")) return;
    var s2 = dailyStats(today()), info = E.dailyOf(cleanSeed(DK.seedOf("rt", day)));
    var dlg = makeDialog("rt-daily");
    dlg.appendChild(el("div", "dlg-title", t("daily.title", { n: day + 1 }) + " · " + DK.dateLabel(day, LANG)));
    dlg.appendChild(el("div", "dlg-hero" + (r.w ? "" : " lost"), t(r.w ? "daily.won" : "daily.lost", { n: r.h })));
    dlg.appendChild(el("div", "dlg-note", t("daily.scoreNote")));
    dlg.appendChild(row(t("daily.season"), t("sea." + info.sea)));
    dlg.appendChild(row(t("daily.bloom"), r.n + " · " + r.q));
    dlg.appendChild(row(t("daily.streak"), String(s2.cur)));
    dlg.appendChild(row(t("daily.best"), String(s2.best)));
    if (day === today()) dlg.appendChild(el("div", "dlg-note", t("daily.oneTry") + " " + t("daily.next")));
    var acts = el("div", "dlg-actions wrap");
    hubLink(acts, dlg);
    acts.appendChild(button(t("daily.share"), "", function () { shareDaily(day); }));
    var free = button(t("daily.free"), "primary", function () { dlg.close(); newDialog(); });
    acts.appendChild(free);
    dlg.appendChild(acts);
    show(dlg, free);
  }
  // Spoiler-free: a flower for every bloom up to the quota (a bare
  // square for each one missing), the score and whether it was met.
  function shareDaily(day) {
    var r = data.days[day];
    if (!r || !DK) return;
    var sq = "", k;
    for (k = 0; k < Math.min(r.n, r.q); k++) sq += "🌸";
    for (k = r.n; k < r.q; k++) sq += "🟫";
    if (r.n > r.q) sq += " +" + (r.n - r.q);
    var text = DK.shareText({ game: t("app.name"), label: t("daily.label"), day: day, grid: [sq],
      line: (r.w ? "🌳 " : "🍂 ") + t(r.w ? "share.won" : "share.lost", { n: r.h }) });
    DK.share(text, "orOS " + t("app.name")).then(function (how) {
      if (how === "copied") showToast(t("toast.copied"));
      else if (how === "shared") live(t("toast.shared"));
      else if (how === "failed") showToast(t("toast.copyFail"));
    });
  }
  // "All games" (the Game Center), only when it is installed.
  function hubLink(acts, dlg) {
    if (!DK || !DK.hasHub()) return;
    acts.appendChild(button(t("daily.games"), "", function () { dlg.close(); DK.openHub("roots"); }));
  }

  function resetRecords() {
    data.br = Math.max(Date.now(), data.br + 1);
    data = mergeRoots(data, data);
    save();
    showToast(t("toast.reset"));
  }

  var TOUR_N = 4;
  var tourTimer = null;
  function cancelTourWait() { if (tourTimer) { clearTimeout(tourTimer); tourTimer = null; } }
  function maybeTour() {
    if (prefs.tour || tourTimer || document.querySelector("dialog[open]")) return;
    tourTimer = setTimeout(function () { tourTimer = null; tourDialog(1); }, 400);
  }
  function tourDialog(n) {
    if (document.querySelector("dialog[open]")) return;
    var dlg = makeDialog("rt-tour");
    dlg.appendChild(el("div", "dlg-title", t("tour.title") + " · " + n + "/" + TOUR_N));
    dlg.appendChild(el("div", "dlg-msg", t("tour." + n)));
    var acts = el("div", "dlg-actions");
    function seen() { prefs.tour = true; savePrefs(); }
    if (n < TOUR_N) acts.appendChild(button(t("tour.skip"), "", function () { seen(); dlg.close(); }));
    var next = button(t(n < TOUR_N ? "tour.next" : "tour.done"), "primary", function () {
      dlg.close();
      if (n < TOUR_N) setTimeout(function () { tourDialog(n + 1); }, 0);
      else seen();
    });
    acts.appendChild(next);
    dlg.appendChild(acts);
    dlg.addEventListener("cancel", seen);
    show(dlg, next);
  }

  // ---------- 9. Toasts ----------
  function showToast(text) {
    try {
      var n = (window.parent && window.parent.orosNotifs) || window.orosNotifs;
      if (n && typeof n.transient === "function" &&
          n.transient({ ns: "roots", title: String(text) })) return;
    } catch (e) {}
    localToast(text);
  }
  var toastTimer = null;
  function localToast(text) {
    var box = $("toast");
    if (!box) return;
    hostToast();
    box.innerHTML = "";
    box.classList.remove("show");
    box.appendChild(el("span", "", text));
    void box.offsetWidth;
    box.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { box.classList.remove("show"); }, 3500);
  }
  function hostToast() {
    var box = $("toast"), d = document.querySelector("dialog[open]");
    if (box && d && box.parentNode !== d) d.appendChild(box);
  }
  function parkToast() {
    var box = $("toast");
    if (box && box.parentNode !== document.body) document.body.appendChild(box);
  }

  // ---------- 10. Sound ----------
  var audio = null;
  function sfxOn() {
    try { return localStorage.getItem(SFX_KEY) === "1"; } catch (e) { return false; }
  }
  function tone(freq, start, dur, type, vol) {
    var o = audio.createOscillator(), g = audio.createGain();
    o.type = type || "sine";
    o.frequency.value = freq;
    var t0 = audio.currentTime + start;
    g.gain.setValueAtTime(vol || 0.16, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g); g.connect(audio.destination);
    o.start(t0); o.stop(t0 + dur + 0.02);
  }
  var HAPTIC = { grow: "tick", hurt: "bad", end: "tick", season: "good", win: "good" };
  function sfx(kind) {
    if (window.orosHaptics && HAPTIC[kind]) window.orosHaptics.cue(HAPTIC[kind]);
    if (!sfxOn()) return;
    try {
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      if (!audio) audio = new AC();
      if (audio.state === "suspended") audio.resume();
      if (kind === "grow") { tone(392, 0, 0.06, "triangle", 0.08); tone(494, 0.05, 0.08, "sine", 0.07); }
      else if (kind === "hurt") tone(140, 0, 0.16, "sawtooth", 0.08);
      else if (kind === "end") { tone(262, 0, 0.1, "triangle", 0.08); tone(196, 0.08, 0.14, "triangle", 0.08); }
      else if (kind === "toggle") { tone(1047, 0, 0.05, "sine", 0.08); tone(1319, 0.04, 0.07, "sine", 0.07); }
      else if (kind === "season") [392, 523, 659].forEach(function (f, k) { tone(f, k * 0.09, 0.16, "triangle", 0.09); });
      else if (kind === "win") [523, 659, 784, 1047].forEach(function (f, k) { tone(f, k * 0.11, 0.22, "triangle"); });
    } catch (e) { /* no audio → silent */ }
  }

  // ---------- Icons (R9: icon buttons ship empty, filled here) ----------
  var SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">';
  var UI_ICONS = {
    new:    SVG + '<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/></svg>',
    fast:   SVG + '<path d="M4 6l7 6-7 6zM13 6l7 6-7 6z"/></svg>',
    threat: SVG + '<path d="M12 3 2 20h20z"/><path d="M12 10v4M12 17h.01"/></svg>',
    undo:   SVG + '<path d="M9 14 4 9l5-5"/><path d="M4 9h11a5 5 0 0 1 0 10h-3"/></svg>',
    reset:  SVG + '<path d="M3 12a9 9 0 1 0 9-9"/><path d="M3 4v5h5"/><path d="M12 8v4l3 2"/></svg>',
    rewind: SVG + '<path d="M11 6 4 12l7 6zM20 6l-7 6 7 6z"/></svg>',
    daily:  SVG + '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 10h18"/><path d="M12 20v-5M12 15c0-2-1.5-3-3.5-3M12 17c0-2 1.5-3 3.5-3"/></svg>',
    stats:  SVG + '<path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0z"/><path d="M17 5h3v2a3 3 0 0 1-3 3M7 5H4v2a3 3 0 0 0 3 3"/></svg>',
    sfxOn:  SVG + '<path d="M11 5 6 9H2v6h4l5 4z"/><path d="M15.5 8.5a5 5 0 0 1 0 7M19 5a10 10 0 0 1 0 14"/></svg>',
    sfxOff: SVG + '<path d="M11 5 6 9H2v6h4l5 4z"/><path d="M22 9l-6 6M16 9l6 6"/></svg>',
    sea:    SVG + '<path d="M5 19c0-8 6-14 14-14 0 8-6 14-14 14zM5 19l7-7"/></svg>',
    turn:   SVG + '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
    sap:    SVG + '<path d="M12 3c3 4 6 7 6 11a6 6 0 0 1-12 0c0-4 3-7 6-11z"/></svg>',
    bloom:  SVG + '<circle cx="12" cy="10" r="2.5"/><path d="M12 7.5a2.5 2.5 0 1 1 2.4-3.2M14.4 9.2a2.5 2.5 0 1 1 1.2 4M12 12.5a2.5 2.5 0 1 1-2.4 3.2M9.6 10.8a2.5 2.5 0 1 1-1.2-4M12 13v8"/></svg>'
  };
  function paintSfxBtn() {
    var b = $("sfx-btn"), on = sfxOn();
    b.innerHTML = on ? UI_ICONS.sfxOn : UI_ICONS.sfxOff;
    b.setAttribute("aria-pressed", on ? "true" : "false");
    b.setAttribute("aria-label", t(on ? "btn.sfxOn" : "btn.sfxOff"));
    b.title = t(on ? "btn.sfxOn" : "btn.sfxOff");
  }
  function paintFastBtn() {
    var b = $("fast-btn");
    b.innerHTML = UI_ICONS.fast;
    b.setAttribute("aria-pressed", prefs.fast ? "true" : "false");
    b.setAttribute("aria-label", t(prefs.fast ? "btn.fastOn" : "btn.fastOff"));
    b.title = t(prefs.fast ? "btn.fastOn" : "btn.fastOff");
  }
  function paintThreatBtn() {
    var b = $("threat-btn");
    b.innerHTML = UI_ICONS.threat;
    b.setAttribute("aria-pressed", prefs.threat ? "true" : "false");
    b.setAttribute("aria-label", t(prefs.threat ? "btn.threatOff" : "btn.threatOn"));
    b.title = t(prefs.threat ? "btn.threatOff" : "btn.threatOn");
  }

  // ---------- 11. Sync slice + palette ----------
  var PAL_VARS = ["--bg", "--bg-desktop", "--bar-bg", "--text", "--text-dim",
                  "--accent", "--accent-hover", "--accent-soft", "--accent-ink",
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
    readColors();
    draw();
  }
  function watchPalette() {
    try {
      new MutationObserver(inheritPalette).observe(
        window.parent.document.documentElement,
        { attributes: true, attributeFilter: ["data-theme", "style", "class"] });
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
    api.registerSlice("roots", sliceGet, sliceSet, STORAGE_KEY, mergeRoots);
  }
  function sliceGet() { return mergeRoots(data, data); }   // canonical copy (R26)
  function sliceSet(incoming) {
    if (!incoming || typeof incoming !== "object" || !incoming.rows) return;
    window.__orosSyncApi._suppress = true;   // R6: a pull never marks dirty
    try {
      data = mergeRoots(incoming, incoming);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch (e) {
    } finally {
      window.__orosSyncApi._suppress = false;
    }
  }

  // ---------- 12. Wiring & boot ----------
  function applyI18n() {
    [].forEach.call(document.querySelectorAll("[data-i18n]"), function (n) {
      n.textContent = t(n.getAttribute("data-i18n"));
    });
    canvas.setAttribute("aria-label", t("view.label"));
    $("end-btn").title = t("btn.endKey");
  }
  function paintStatic() {
    [["new-btn", "new", "btn.new"], ["stats-btn", "stats", "btn.stats"], ["daily-btn", "daily", "btn.daily"], ["undo-btn", "undo", "btn.undo"],
     ["reset-btn", "reset", "btn.reset"], ["rewind-btn", "rewind", "btn.rewind"]].forEach(function (x) {
      var b = $(x[0]);
      b.innerHTML = UI_ICONS[x[1]];
      b.setAttribute("aria-label", t(x[2]));
      b.title = t(x[2]);
    });
    [["s-sea", "sea"], ["s-turn", "turn"], ["s-sap", "sap"], ["s-bloom", "bloom"]].forEach(function (x) {
      $(x[0]).querySelector(".ic").innerHTML = UI_ICONS[x[1]];
    });
    paintSfxBtn();
    paintFastBtn();
    paintThreatBtn();
  }
  function wire() {
    $("new-btn").addEventListener("click", askNew);
    $("end-btn").addEventListener("click", endTurn);
    $("undo-btn").addEventListener("click", undoAct);
    $("reset-btn").addEventListener("click", resetTurn);
    $("rewind-btn").addEventListener("click", rewind);
    $("stats-btn").addEventListener("click", statsDialog);
    $("daily-btn").addEventListener("click", openDaily);
    // Deep link from the Game Center: { daily: true } opens today's glade.
    window.__orosOpenAt = function (tg) { if (tg && tg.daily) openDaily(); };
    $("threat-btn").addEventListener("click", toggleThreat);
    $("fast-btn").addEventListener("click", function () { prefs.fast = !prefs.fast; savePrefs(); paintFastBtn(); });
    $("sfx-btn").addEventListener("click", function () {
      try { localStorage.setItem(SFX_KEY, sfxOn() ? "0" : "1"); } catch (e) {}
      paintSfxBtn();
      sfx("toggle");
    });
    wireInput();
    wireKeyboard();
    window.addEventListener("resize", resize);
    if (window.ResizeObserver) new ResizeObserver(resize).observe($("scene"));
    // Save on the way out (R10 session).
    document.addEventListener("visibilitychange", function () { if (document.hidden && game) saveSession(); });
    window.addEventListener("pagehide", function () { if (game) saveSession(); });
  }

  function boot() {
    canvas = $("view");
    ctx = canvas.getContext("2d");
    load();
    ensureDeviceId();
    loadPrefs();
    applyI18n();
    paintStatic();
    wire();
    registerSync();
    inheritPalette();
    watchPalette();
    game = loadSession();
    var tg = DK ? DK.takeTarget("roots") : null;
    var daily = !!(tg && tg.daily && DK);
    if (daily && !data.days[today()] && !(game && game.opts.day === today() && !game.counted)) {
      // today's glade straight away, unless a year under way would count as not finished
      if (!game || !inProgressOf(game)) { game = makeGame(dailyOpts(today())); daily = false; }
    }
    if (!game) game = makeGame({ diff: prefs.diff, seed: newSeed() });
    st = game.g;
    saveSession();
    seasonMsg();
    if (game.opts.day !== undefined && !st.acts) setMsg(t("daily.rules"));
    resize();
    renderAll();
    if (daily) setTimeout(openDaily, 300);
    else if (st.res && (st.phase === "rest" || st.over >= 0)) setTimeout(bloomDialog, 300);
    else maybeTour();
  }

  boot();
})();
