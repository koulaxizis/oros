// ============================================================
// orOS Banner — App logic (v1.0.0)
// A turn-based card battler on a small tile board: each side plays
// cards from its deck to put units, tiles and spells on a 5 × 7 board,
// and wins by breaking the other Keep or holding the three shrines.
// The rules and the computer players live in banner/engine.js
// (BannerEngine, tested headless), the cards in banner/cards.js; this
// file is the screen.
//   - against the computer (Easy, Medium, Hard) or two players on one
//     device (the hand stays hidden until the device is passed)
//   - four starter decks; every battle has a code (the same board and
//     the same shuffle again)
//   - tap a card, then a lit tile; tap a unit to move or attack; hold
//     a tile or a card to read it; undo within your turn
//   - a short "How to play" on the first battle
// Data:
//   - synced slice "banner" (oros-banner-data): battles and wins per
//     computer level and two-player battles, as per-device counter rows
//     (each device only grows its own row; merge = per-row max, a join)
//     + reset stamp br (the Realm and Crypt pattern)
//   - device-local (R10): oros-banner-prefs (mode, level, decks, tour
//     seen), oros-banner-session (the battle in progress),
//     oros-banner-device (counter row id), oros-banner-sfx (sound)
// Sections:
//   1. Constants, i18n, helpers
//   2. Synced records: load / save / normalize / merge (R5, R26)
//   3. Device-local prefs + session
//   4. Battle flow (new, act, undo, end turn, computer, result)
//   5. Board view (geometry, drawing)
//   6. Input (tap, hold, keyboard)
//   7. Panels (toolbar, status, hand)
//   8. Dialogs (new battle, info, pass, result, records, tour)
//   9. Toasts
//  10. Sound
//  11. Sync slice + palette
//  12. Wiring & boot
// ============================================================
(function () {
  "use strict";

  var E = window.BannerEngine;

  var STORAGE_KEY = "oros-banner-data";
  var PREFS_KEY   = "oros-banner-prefs";
  var SESSION_KEY = "oros-banner-session";
  var DEVICE_KEY  = "oros-banner-device";
  var SFX_KEY     = "oros-banner-sfx";
  var DATA_VER    = 1;
  var ROW_KEYS = ["e", "m", "h", "p"];   // computer Easy, Medium, Hard; p two players
  var AI_MS = 420;                       // one computer action
  var HOLD_MS = 450;                     // a hold opens the info
  var UNDO_MAX = 60;

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
      "app.name": "Banner",
      "btn.new": "New battle (N)", "btn.undo": "Undo (Z)", "btn.end": "End turn", "btn.endKey": "End turn (E)",
      "btn.stats": "Records", "btn.sfxOn": "Sound on", "btn.sfxOff": "Sound off",
      "side.0": "Blue", "side.1": "Red",
      "st.keep": "{s} Keep: {n} Health", "st.energy": "Energy {n} of {m}",
      "st.yours": "Your turn", "st.ai": "The computer plays…", "st.whose": "{s} plays",
      "st.turn": "Turn {n}", "st.deck": "Deck {n}",
      "board.label": "Battle board, 5 by 7 tiles", "hand.label": "Cards in hand", "hand.none": "No cards in hand",
      "hand.hidden": "Hidden until the device is passed",
      "card.aria": "{k}, cost {c}",
      "msg.pick": "{k}: tap a lit tile", "msg.cast": "{k}: tap it again to cast it", "msg.none": "{k}: nowhere to play it now",
      "msg.unit": "{k}: tap a lit tile to move or attack", "msg.spent": "{k} has done all it can this turn",
      "msg.fresh": "{k} is new: it can act next turn", "msg.energy": "Not enough energy for {k}",
      "msg.theirs": "Not your turn", "msg.hold": "Hold a tile or a card to read it",
      "kw.reach": "Reach: attacks 2 tiles away in a line, not past a rock.",
      "kw.guard": "Guard: your units next to it take 1 less damage.",
      "kw.charge": "Charge: can move and attack on the turn it is played.",
      "kw.climb": "Climb: passes rock and water.",
      "kw.heal": "Heal: at the end of your turn, heals 1 to each of your units next to it.",
      "unit.line": "Cost {c} · Attack {a} · Health {h} · Move {m}",
      "unit.hp": "Health {n} of {m}", "unit.fresh": "New this turn: it waits a turn.",
      "unit.spent": "It has moved and attacked this turn.", "unit.stuck": "Stuck in the mire: it cannot move this turn.",
      "unit.side": "{s} unit",
      "c.militia": "Militia", "c.scout": "Scout", "c.archer": "Archer", "c.spear": "Spearman", "c.shield": "Shieldbearer",
      "c.wolf": "Wolf", "c.healer": "Healer", "c.climber": "Mountaineer", "c.knight": "Knight", "c.xbow": "Crossbow",
      "c.raider": "Raider", "c.sentinel": "Sentinel", "c.druid": "Druid", "c.eagle": "Eagle", "c.giant": "Giant",
      "c.lancer": "Lancer", "c.mage": "Spark mage", "c.troll": "Troll", "c.golem": "Golem", "c.dragon": "Drake",
      "c.spark": "Spark", "c.rally": "Rally", "c.recall": "Recall", "c.mend": "Mend", "c.haste": "Haste",
      "c.quake": "Quake", "c.storm": "Storm", "c.fortify": "Fortify",
      "c.wood": "Wood", "c.rock": "Rock", "c.bridge": "Bridge", "c.tower": "Tower", "c.mire": "Mire",
      "c.spring": "Spring", "c.road": "Road", "c.pond": "Pond",
      "tx.spark": "Spell: 2 damage to an enemy unit.", "tx.rally": "Spell: your units get +1 Attack this turn.",
      "tx.recall": "Spell: one of your units goes back to your hand.", "tx.mend": "Spell: heals one of your units by 3.",
      "tx.haste": "Spell: one of your units may move and attack again this turn.",
      "tx.quake": "Spell: turns a tile back to plain ground.", "tx.storm": "Spell: 1 damage to every enemy unit.",
      "tx.fortify": "Spell: your Keep gets 3 Health back (at most 15).",
      "tx.wood": "Tile: a unit in the wood takes 1 less damage.", "tx.rock": "Tile: blocks the way (Climb passes).",
      "tx.bridge": "Tile: put it on water to cross it.", "tx.tower": "Tile: +1 Attack for the unit on it.",
      "tx.mire": "Tile: a unit that walks in stops, and cannot move on its next turn.",
      "tx.spring": "Tile: heals 1 to the unit on it at the end of its turn.",
      "tx.road": "Tile: +1 Move for a unit that starts its move on it.", "tx.pond": "Tile: water (Climb passes).",
      "tx.plain": "Plain ground.", "tx.water": "Water: only Climb passes.",
      "tx.keep": "{s} Keep: {n} Health. Break the other Keep to win.",
      "tx.shrine": "Shrine: a unit on it gives its side +1 energy. Hold all three at the start of three of your turns in a row to win.",
      "t.plain": "Plain", "t.water": "Water", "t.shrine": "Shrine", "t.keep": "Keep",
      "ev.play": "{s}: {k}", "ev.die": "{k} falls", "ev.keep": "{s} Keep −{n}", "ev.reshuffle": "{s} shuffles the discard pile into the deck",
      "ev.burn": "Hand full: {k} is lost", "ev.tired": "A long battle: {s} Keep −{n}", "ev.hold": "{s} holds every shrine ({n} of 3)",
      "ev.stuck": "Stuck in the mire", "ev.back": "It hits back",
      "res.won": "You win!", "res.lost": "The computer wins", "res.side": "{s} wins!",
      "res.keep": "The Keep fell.", "res.shrines": "All three shrines held for three turns.",
      "res.turns": "Turns", "res.code": "Battle code: {seed}", "res.same": "Same battle again", "res.new": "New battle",
      "new.title": "New battle", "new.mode": "Play against", "mode.ai": "Computer", "mode.hot": "Two players",
      "mode.ai.note": "You are Blue. The side that starts comes from the battle code.",
      "mode.hot.note": "Blue and Red on this device. Each hand stays hidden until the device is passed.",
      "new.level": "Level", "lv.e": "Easy", "lv.m": "Medium", "lv.h": "Hard",
      "new.deck0": "Blue deck", "new.deck1": "Red deck", "new.deckAi": "Computer's deck",
      "deck.random": "Random", "deck.iron": "Iron", "deck.thorn": "Thorn", "deck.tide": "Tide", "deck.ember": "Ember",
      "deck.iron.note": "Iron: guards, towers and tough units.", "deck.thorn.note": "Thorn: woods, healers and big beasts.",
      "deck.tide.note": "Tide: fast units, water and haste.", "deck.ember.note": "Ember: spells, charges and a drake.",
      "deck.random.note": "A deck chosen by the battle code.",
      "new.seed": "Battle code (empty = new battle)", "new.start": "Start", "new.cancel": "Cancel",
      "new.giveUp": "The battle in progress counts as a loss.",
      "pass.title": "{s} to play", "pass.msg": "Pass the device to {s}. The hand stays hidden until then.", "pass.go": "Show my hand",
      "stats.title": "Records", "stats.head": "Battles · won", "stats.hot": "Two players", "stats.hotRow": "Battles",
      "stats.reset": "Reset records", "stats.close": "Close", "stats.code": "This battle: {seed}",
      "info.close": "Close",
      "confirm.yes": "Yes", "confirm.no": "Cancel", "reset.ask": "Reset the records on every device?",
      "toast.reset": "Records reset", "toast.save": "Could not save: the storage is full",
      "tour.title": "How to play", "tour.next": "Next", "tour.skip": "Skip", "tour.done": "Play",
      "tour.1": "Break the other side's Keep, or hold all three shrines (the flags on the middle row) at the start of three of your turns in a row.",
      "tour.2": "Each turn you draw 2 cards and get energy: 1 on your first turn, one more each turn up to 6, and 1 more for each shrine you hold.",
      "tour.3": "Tap a card, then a lit tile. A unit goes on your home row or next to one of your units; a tile changes the ground; a spell acts at once.",
      "tour.4": "Tap one of your units: the light tiles are where it can go, the red ones what it can hit. A new unit waits a turn, unless it has Charge. A unit that survives a hit from next to it hits back.",
      "tour.5": "Hold a tile or a card to read it. Undo takes back what you did this turn. End your turn when you are done."
    },
    el: {
      "app.name": "Λάβαρο",
      "btn.new": "Νέα μάχη (N)", "btn.undo": "Αναίρεση (Z)", "btn.end": "Τέλος γύρου", "btn.endKey": "Τέλος γύρου (E)",
      "btn.stats": "Ρεκόρ", "btn.sfxOn": "Ήχος ανοιχτός", "btn.sfxOff": "Ήχος κλειστός",
      "side.0": "Μπλε", "side.1": "Κόκκινος",
      "st.keep": "{s}: Κάστρο με {n} Ζωή", "st.energy": "Ενέργεια {n} από {m}",
      "st.yours": "Σειρά σου", "st.ai": "Παίζει ο υπολογιστής…", "st.whose": "Παίζει: {s}",
      "st.turn": "Γύρος {n}", "st.deck": "Τράπουλα {n}",
      "board.label": "Πεδίο μάχης, 5 επί 7 πλακίδια", "hand.label": "Κάρτες στο χέρι", "hand.none": "Καμία κάρτα στο χέρι",
      "hand.hidden": "Κρυμμένο μέχρι να δοθεί η συσκευή",
      "card.aria": "{k}, κόστος {c}",
      "msg.pick": "{k}: πάτα ένα φωτισμένο πλακίδιο", "msg.cast": "{k}: πάτα την ξανά για να τη ρίξεις", "msg.none": "{k}: δεν παίζεται πουθενά τώρα",
      "msg.unit": "{k}: πάτα ένα φωτισμένο πλακίδιο για κίνηση ή επίθεση", "msg.spent": "{k}: έκανε ό,τι μπορούσε σε αυτόν τον γύρο",
      "msg.fresh": "{k}: μόλις ήρθε, δρα από τον επόμενο γύρο", "msg.energy": "Δεν φτάνει η ενέργεια για: {k}",
      "msg.theirs": "Δεν είναι η σειρά σου", "msg.hold": "Κράτα πατημένο ένα πλακίδιο ή μια κάρτα για να τη διαβάσεις",
      "kw.reach": "Βεληνεκές: χτυπά 2 πλακίδια μακριά σε ευθεία, όχι πίσω από βράχο.",
      "kw.guard": "Φρουρά: οι δικές σου μονάδες δίπλα της παθαίνουν 1 λιγότερη ζημιά.",
      "kw.charge": "Έφοδος: κινείται και επιτίθεται από τον γύρο που μπαίνει.",
      "kw.climb": "Αναρρίχηση: περνά βράχους και νερό.",
      "kw.heal": "Γιατρειά: στο τέλος του γύρου σου γιατρεύει 1 σε κάθε δική σου μονάδα δίπλα της.",
      "unit.line": "Κόστος {c} · Επίθεση {a} · Ζωή {h} · Κίνηση {m}",
      "unit.hp": "Ζωή {n} από {m}", "unit.fresh": "Μόλις ήρθε: περιμένει έναν γύρο.",
      "unit.spent": "Κινήθηκε και επιτέθηκε σε αυτόν τον γύρο.", "unit.stuck": "Κόλλησε στον βάλτο: δεν κινείται σε αυτόν τον γύρο.",
      "unit.side": "Μονάδα: {s}",
      "c.militia": "Πολιτοφύλακας", "c.scout": "Ανιχνευτής", "c.archer": "Τοξότης", "c.spear": "Λογχοφόρος", "c.shield": "Ασπιδοφόρος",
      "c.wolf": "Λύκος", "c.healer": "Θεραπευτής", "c.climber": "Ορειβάτης", "c.knight": "Ιππότης", "c.xbow": "Βαλλιστροφόρος",
      "c.raider": "Επιδρομέας", "c.sentinel": "Φρουρός", "c.druid": "Δρυΐδης", "c.eagle": "Αετός", "c.giant": "Γίγαντας",
      "c.lancer": "Ιππέας", "c.mage": "Μάγος της σπίθας", "c.troll": "Τρολ", "c.golem": "Γκόλεμ", "c.dragon": "Δράκος",
      "c.spark": "Σπίθα", "c.rally": "Συσπείρωση", "c.recall": "Ανάκληση", "c.mend": "Επούλωση", "c.haste": "Βιασύνη",
      "c.quake": "Σεισμός", "c.storm": "Καταιγίδα", "c.fortify": "Οχύρωση",
      "c.wood": "Δάσος", "c.rock": "Βράχος", "c.bridge": "Γέφυρα", "c.tower": "Πύργος", "c.mire": "Βάλτος",
      "c.spring": "Πηγή", "c.road": "Δρόμος", "c.pond": "Λιμνούλα",
      "tx.spark": "Ξόρκι: 2 ζημιά σε μια εχθρική μονάδα.", "tx.rally": "Ξόρκι: οι μονάδες σου έχουν +1 Επίθεση σε αυτόν τον γύρο.",
      "tx.recall": "Ξόρκι: μια μονάδα σου γυρίζει στο χέρι σου.", "tx.mend": "Ξόρκι: γιατρεύει 3 σε μια μονάδα σου.",
      "tx.haste": "Ξόρκι: μια μονάδα σου κινείται και επιτίθεται ξανά σε αυτόν τον γύρο.",
      "tx.quake": "Ξόρκι: ένα πλακίδιο γίνεται ξανά απλό έδαφος.", "tx.storm": "Ξόρκι: 1 ζημιά σε κάθε εχθρική μονάδα.",
      "tx.fortify": "Ξόρκι: το Κάστρο σου παίρνει πίσω 3 Ζωή (ως 15).",
      "tx.wood": "Πλακίδιο: μια μονάδα μέσα στο δάσος παθαίνει 1 λιγότερη ζημιά.", "tx.rock": "Πλακίδιο: κλείνει τον δρόμο (η Αναρρίχηση περνά).",
      "tx.bridge": "Πλακίδιο: μπαίνει πάνω σε νερό για να περάσεις.", "tx.tower": "Πλακίδιο: +1 Επίθεση για τη μονάδα πάνω του.",
      "tx.mire": "Πλακίδιο: μια μονάδα που μπαίνει σταματά και δεν κινείται στον επόμενο γύρο της.",
      "tx.spring": "Πλακίδιο: γιατρεύει 1 τη μονάδα πάνω της στο τέλος του γύρου της.",
      "tx.road": "Πλακίδιο: +1 Κίνηση για μονάδα που ξεκινά από εκεί.", "tx.pond": "Πλακίδιο: νερό (η Αναρρίχηση περνά).",
      "tx.plain": "Απλό έδαφος.", "tx.water": "Νερό: περνά μόνο η Αναρρίχηση.",
      "tx.keep": "{s}: Κάστρο με {n} Ζωή. Σπάσε το άλλο Κάστρο για να κερδίσεις.",
      "tx.shrine": "Ιερό: μια μονάδα πάνω του δίνει +1 ενέργεια στην πλευρά της. Κράτα και τα τρία στην αρχή τριών γύρων σου στη σειρά για να κερδίσεις.",
      "t.plain": "Απλό έδαφος", "t.water": "Νερό", "t.shrine": "Ιερό", "t.keep": "Κάστρο",
      "ev.play": "{s}: {k}", "ev.die": "Έπεσε: {k}", "ev.keep": "{s}: Κάστρο −{n}", "ev.reshuffle": "{s}: τα πεταμένα ανακατεύονται ξανά στην τράπουλα",
      "ev.burn": "Γεμάτο χέρι: χάθηκε η κάρτα {k}", "ev.tired": "Μακριά μάχη: {s}, Κάστρο −{n}", "ev.hold": "{s}: κρατά όλα τα ιερά ({n} από 3)",
      "ev.stuck": "Κόλλησε στον βάλτο", "ev.back": "Ανταποδίδει το χτύπημα",
      "res.won": "Κέρδισες!", "res.lost": "Κέρδισε ο υπολογιστής", "res.side": "Κέρδισε ο {s}!",
      "res.keep": "Το Κάστρο έπεσε.", "res.shrines": "Κράτησε και τα τρία ιερά για τρεις γύρους.",
      "res.turns": "Γύροι", "res.code": "Κωδικός μάχης: {seed}", "res.same": "Ίδια μάχη ξανά", "res.new": "Νέα μάχη",
      "new.title": "Νέα μάχη", "new.mode": "Αντίπαλος", "mode.ai": "Υπολογιστής", "mode.hot": "Δύο παίκτες",
      "mode.ai.note": "Είσαι ο Μπλε. Το ποιος ξεκινά το ορίζει ο κωδικός της μάχης.",
      "mode.hot.note": "Μπλε και Κόκκινος στην ίδια συσκευή. Κάθε χέρι μένει κρυμμένο μέχρι να δοθεί η συσκευή.",
      "new.level": "Επίπεδο", "lv.e": "Εύκολο", "lv.m": "Μέτριο", "lv.h": "Δύσκολο",
      "new.deck0": "Τράπουλα του Μπλε", "new.deck1": "Τράπουλα του Κόκκινου", "new.deckAi": "Τράπουλα του υπολογιστή",
      "deck.random": "Τυχαία", "deck.iron": "Σίδερο", "deck.thorn": "Αγκάθι", "deck.tide": "Παλίρροια", "deck.ember": "Θράκα",
      "deck.iron.note": "Σίδερο: φρουροί, πύργοι και ανθεκτικές μονάδες.", "deck.thorn.note": "Αγκάθι: δάση, θεραπευτές και μεγάλα θηρία.",
      "deck.tide.note": "Παλίρροια: γρήγορες μονάδες, νερό και βιασύνη.", "deck.ember.note": "Θράκα: ξόρκια, έφοδοι και ένας δράκος.",
      "deck.random.note": "Την τράπουλα τη διαλέγει ο κωδικός της μάχης.",
      "new.seed": "Κωδικός μάχης (κενό = νέα μάχη)", "new.start": "Έναρξη", "new.cancel": "Άκυρο",
      "new.giveUp": "Η μάχη που παίζεται μετρά ως ήττα.",
      "pass.title": "Παίζει: {s}", "pass.msg": "Δώσε τη συσκευή στον {s}. Το χέρι μένει κρυμμένο ως τότε.", "pass.go": "Δείξε το χέρι μου",
      "stats.title": "Ρεκόρ", "stats.head": "Μάχες · νίκες", "stats.hot": "Δύο παίκτες", "stats.hotRow": "Μάχες",
      "stats.reset": "Μηδενισμός ρεκόρ", "stats.close": "Κλείσιμο", "stats.code": "Αυτή η μάχη: {seed}",
      "info.close": "Κλείσιμο",
      "confirm.yes": "Ναι", "confirm.no": "Άκυρο", "reset.ask": "Να μηδενιστούν τα ρεκόρ σε όλες τις συσκευές;",
      "toast.reset": "Τα ρεκόρ μηδενίστηκαν", "toast.save": "Δεν αποθηκεύτηκε: ο χώρος είναι γεμάτος",
      "tour.title": "Πώς παίζεται", "tour.next": "Επόμενο", "tour.skip": "Παράλειψη", "tour.done": "Παίξε",
      "tour.1": "Σπάσε το Κάστρο του αντιπάλου ή κράτα και τα τρία ιερά (τις σημαίες στη μεσαία σειρά) στην αρχή τριών γύρων σου στη σειρά.",
      "tour.2": "Σε κάθε γύρο τραβάς 2 κάρτες και παίρνεις ενέργεια: 1 στον πρώτο σου γύρο, μία παραπάνω σε κάθε γύρο ως 6, και 1 ακόμα για κάθε ιερό που κρατάς.",
      "tour.3": "Πάτα μια κάρτα και μετά ένα φωτισμένο πλακίδιο. Μια μονάδα μπαίνει στη σειρά του κάστρου σου ή δίπλα σε μονάδα σου· ένα πλακίδιο αλλάζει το έδαφος· ένα ξόρκι δρα αμέσως.",
      "tour.4": "Πάτα μια μονάδα σου: τα ανοιχτά πλακίδια δείχνουν πού πηγαίνει και τα κόκκινα τι χτυπά. Μια νέα μονάδα περιμένει έναν γύρο, εκτός αν έχει Έφοδο. Όποια μονάδα αντέξει ένα χτύπημα από δίπλα, ανταποδίδει.",
      "tour.5": "Κράτα πατημένο ένα πλακίδιο ή μια κάρτα για να τη διαβάσεις. Η Αναίρεση παίρνει πίσω ό,τι έκανες σε αυτόν τον γύρο. Πάτα «Τέλος γύρου» όταν τελειώσεις."
    }
  };
  if (window.orosI18n) window.orosI18n.table(STRINGS, "banner", LANG);

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

  // A new battle code: 6 letters and digits, easy to read aloud.
  function newSeed() {
    var abc = "abcdefghjkmnpqrstuvwxyz23456789", buf = new Uint32Array(6), s = "";
    crypto.getRandomValues(buf);
    for (var i = 0; i < 6; i++) s += abc.charAt(buf[i] % abc.length);
    return s;
  }
  function cleanSeed(s) {
    return String(s || "").toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 16);
  }
  function cardName(k) { return t("c." + k); }
  function sideName(s) { return t("side." + s); }

  // BOOT MARKER
  var SCRIPT_V = "";
  (function () {
    var m = ((document.currentScript && document.currentScript.src) || "")
      .match(/[?&]v=([^&#]+)/);
    SCRIPT_V = m ? m[1] : "";
    document.documentElement.lang = LANG;
    console.log("banner.js v" + (SCRIPT_V || "?") + " boot");
  })();

  // ---------- 2. Synced records ----------
  // data = { ver, br, rows: { <device id>: { b, s: { "<e|m|h|p>": [battles, won] } } } }
  // e, m, h: against the computer at that level (won = Blue won);
  // p: two-player battles (won stays 0). Each device only grows its own
  // row, so a per-row max is a join and nothing is double-counted.
  var data = null;
  var deviceId = null;

  function defaultData() { return { ver: DATA_VER, br: 0, rows: {} }; }
  function normRow(row) {
    if (!row || typeof row !== "object" || !isInt(row.b) || row.b < 0) return null;
    var s = {}, any = false;
    ROW_KEYS.forEach(function (k) {
      var v = row.s && row.s[k];
      if (Array.isArray(v) && v.length === 2 && v.every(function (x) { return isInt(x) && x >= 0; }) && v[1] <= v[0] && (k !== "p" || v[1] === 0)) {
        s[k] = [v[0], v[1]];
        any = true;
      }
    });
    return any ? { b: row.b, s: s } : null;
  }
  function joinRows(x, y) {
    if (x.b !== y.b) return x.b > y.b ? x : y;
    var s = {};
    ROW_KEYS.forEach(function (k) {
      var a = x.s[k], c = y.s[k];
      if (!a && !c) return;
      if (!a) { s[k] = c.slice(); return; }
      if (!c) { s[k] = a.slice(); return; }
      s[k] = [Math.max(a[0], c[0]), Math.max(a[1], c[1])];
    });
    return { b: x.b, s: s };
  }
  function mergeBanner(A, B) {
    var a = A || {}, b = B || {};
    var br = Math.max(isInt(a.br) ? a.br : 0, isInt(b.br) ? b.br : 0);
    var rows = {};
    [a.rows || {}, b.rows || {}].forEach(function (m) {
      if (!m || typeof m !== "object") return;
      Object.keys(m).forEach(function (id) {
        var r = normRow(m[id]);
        if (!r || r.b < br) return;
        rows[id] = rows[id] ? joinRows(rows[id], r) : r;
      });
    });
    var sorted = {};
    Object.keys(rows).sort(cmpStr).forEach(function (id) {
      var r = rows[id], s = {};
      ROW_KEYS.forEach(function (k) { if (r.s[k]) s[k] = r.s[k].slice(); });
      sorted[id] = { b: r.b, s: s };
    });
    return { ver: DATA_VER, br: br, rows: sorted };
  }
  // [battles, won] for a key, all devices.
  function totals(key) {
    var out = [0, 0];
    Object.keys(data.rows).forEach(function (id) {
      var v = data.rows[id].s[key];
      if (v) { out[0] += v[0]; out[1] += v[1]; }
    });
    return out;
  }
  function load() {
    var raw = null;
    try { raw = localStorage.getItem(STORAGE_KEY); } catch (e) {}
    if (raw) {
      try {
        var parsed = JSON.parse(raw);
        if (parsed && typeof parsed === "object" && parsed.rows && typeof parsed.rows === "object") {
          data = mergeBanner(parsed, parsed);
          return;
        }
      } catch (e) {}
      try { localStorage.setItem(STORAGE_KEY + "-broken", raw); } catch (e) {}
      try { console.warn("[orOS] banner: unreadable data copied to " + STORAGE_KEY + "-broken"); } catch (e) {}
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
  // One battle ended (or was left): +1 battle, +1 won when Blue won
  // against the computer.
  function count(key, won) {
    var row = data.rows[deviceId];
    if (!row || row.b < data.br) row = { b: data.br, s: {} };
    row = { b: row.b, s: JSON.parse(JSON.stringify(row.s)) };
    var v = row.s[key] ? row.s[key].slice() : [0, 0];
    v[0]++;
    if (won && key !== "p") v[1]++;
    row.s[key] = v;
    data.rows[deviceId] = row;
    data = mergeBanner(data, data);
    save();
  }

  // ---------- 3. Device-local prefs + session ----------
  var prefs = { mode: "ai", lv: "m", d0: "r", d1: "r", tour: false };
  var DECK_CHOICES = E.DECK_IDS.concat(["r"]);   // r random
  function loadPrefs() {
    try {
      var p = JSON.parse(localStorage.getItem(PREFS_KEY) || "null");
      if (p && typeof p === "object") {
        if (p.mode === "ai" || p.mode === "hot") prefs.mode = p.mode;
        if (E.LEVELS.indexOf(p.lv) >= 0) prefs.lv = p.lv;
        if (DECK_CHOICES.indexOf(p.d0) >= 0) prefs.d0 = p.d0;
        if (DECK_CHOICES.indexOf(p.d1) >= 0) prefs.d1 = p.d1;
        prefs.tour = p.tour === true;
      }
    } catch (e) {}
  }
  function savePrefs() {
    try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch (e) {}
  }

  // game = {
  //   g: engine state,
  //   opts: { mode: "ai" | "hot", lv: e|m|h (computer), seed, d: [deck choice, deck choice] (r = random) },
  //   counted: bool   the battle is in the records
  //   done: bool      the battle is over
  //   pass: bool      two players: the hand stays hidden until the device is passed
  //   me: bool        a person has made a move (a battle where only the
  //                   computer has moved, as Red starting, is not under way)
  // }
  // Against the computer the person plays Blue (side 0).
  var game = null;

  function validSession(s) {
    if (!s || typeof s !== "object" || !E.valid(s.g)) return false;
    var o = s.opts;
    if (!o || (o.mode !== "ai" && o.mode !== "hot") || typeof o.seed !== "string" || s.g.seed !== o.seed) return false;
    if (o.mode === "ai" && E.LEVELS.indexOf(o.lv) < 0) return false;
    if (!Array.isArray(o.d) || o.d.length !== 2 || o.d.some(function (d) { return DECK_CHOICES.indexOf(d) < 0; })) return false;
    return true;
  }
  function loadSession() {
    try {
      var s = JSON.parse(localStorage.getItem(SESSION_KEY) || "null");
      if (validSession(s)) {
        s.counted = s.counted === true;
        s.done = s.done === true;
        s.pass = s.pass === true && s.opts.mode === "hot";
        if (s.me !== undefined) s.me = s.me === true;
        return s;
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

  // ---------- 4. Battle flow ----------
  var st = null;              // = game.g
  var sel = null;             // { h: hand index } | { u: unit id }
  var undo = [];              // states before each action of this turn
  var aiTimer = null;
  var cursor = -1;            // keyboard cursor cell
  var lastMsg = "";

  function rowKey() { return game.opts.mode === "hot" ? "p" : game.opts.lv; }
  function inProgressOf(g) { return !!(g && !g.done && g.g.over < 0 && g.g.n > 0); }
  function deckOf(choice, seed, side) {
    if (E.DECK_IDS.indexOf(choice) >= 0) return choice;
    return E.DECK_IDS[E.hashStr("banner:" + seed + ":deckpick:" + side) % E.DECK_IDS.length];
  }
  function makeGame(opts) {
    var o = { mode: opts.mode === "hot" ? "hot" : "ai", seed: opts.seed, d: [opts.d[0], opts.d[1]] };
    if (o.mode === "ai") o.lv = E.LEVELS.indexOf(opts.lv) >= 0 ? opts.lv : "m";
    var g = E.newBattle(o.seed, [deckOf(o.d[0], o.seed, 0), deckOf(o.d[1], o.seed, 1)]);
    return { g: g, opts: o, counted: false, done: false, pass: o.mode === "hot", me: false };
  }
  function aiSide() { return game && game.opts.mode === "ai" ? 1 : -1; }
  function humanTurn() { return !!(game && !game.done && st.over < 0 && st.side !== aiSide() && !game.pass); }
  // The hand on screen: the person's (Blue) against the computer, the
  // side to play with two players.
  function shownSide() { return game.opts.mode === "ai" ? 0 : st.side; }

  function startGame(opts) {
    stopAI();
    if (game && inProgressOf(game) && !game.counted) count(rowKey(), false);
    game = makeGame(opts);
    st = game.g;
    sel = null;
    undo = [];
    cursor = -1;
    saveSession();
    setMsg("");
    renderAll();
    afterTurnChange();
    maybeTour();
  }
  function setMsg(text) {
    lastMsg = text || "";
    $("msg").textContent = lastMsg;
  }
  // Do one action of the person; false when it was not allowed.
  function doAct(a) {
    if (!humanTurn()) return false;
    var before = E.clone(st);
    var ev = E.act(st, a);
    if (!ev) return false;
    game.me = true;
    if (a.t === "end") undo = [];
    else { undo.push(before); if (undo.length > UNDO_MAX) undo.shift(); }
    sel = null;
    handleEvents(ev);
    saveSession();
    renderAll();
    if (st.over >= 0) { finish(); return true; }
    if (a.t === "end") { hideForPass(); afterTurnChange(); }
    return true;
  }
  function undoLast() {
    if (!humanTurn() || !undo.length) return;
    game.g = st = undo.pop();
    sel = null;
    saveSession();
    renderAll();
    sfx("tick");
  }
  function endTurn() {
    if (!humanTurn()) return;
    doAct({ t: "end" });
  }
  // A new turn began: the computer plays, or the device is passed.
  function afterTurnChange() {
    if (!game || game.done || st.over >= 0) return;
    if (st.side === aiSide()) { runAI(); return; }
    if (game.opts.mode === "hot" && game.pass) { renderAll(); setTimeout(passDialog, 60); return; }
    live(t("st.yours"));
  }
  function runAI() {
    stopAI();
    renderAll();
    aiTimer = setTimeout(stepAI, AI_MS);
  }
  function stopAI() { if (aiTimer) { clearTimeout(aiTimer); aiTimer = null; } }
  function stepAI() {
    aiTimer = null;
    if (!game || game.done || st.over >= 0 || st.side !== aiSide()) return;
    var a = E.aiAction(st, game.opts.lv);
    var ev = a && E.act(st, a);
    if (!ev) ev = E.act(st, { t: "end" }) || [];
    handleEvents(ev);
    saveSession();
    renderAll();
    if (st.over >= 0) { finish(); return; }
    if (st.side === aiSide()) aiTimer = setTimeout(stepAI, AI_MS);
    else { undo = []; afterTurnChange(); }
  }

  var EV_SHOW = { play: 1, die: 1, keep: 1, reshuffle: 1, burn: 1, tired: 1, hold: 1, stuck: 1, back: 1 };
  function evText(e) {
    var p = { s: sideName(e.s), n: e.n, k: e.k ? cardName(e.k) : "" };
    return t("ev." + e.e, p);
  }
  function handleEvents(ev) {
    var text = "";
    ev.forEach(function (e) {
      if (e.e === "draw" && e.s !== shownSide()) return;
      if (e.e === "burn" && e.s !== shownSide()) return;
      if (EV_SHOW[e.e]) text = evText(e);
      if (e.e === "hit") { sfx("hit"); addFx(e.c, "−" + e.n, "bad"); }
      else if (e.e === "die") sfx("die");
      else if (e.e === "keep") { sfx("keep"); addFx(E.KEEPS[e.s], "−" + e.n, "bad"); if (e.s === shownSide()) shake(); }
      else if (e.e === "heal") { addFx(e.c, "+" + e.n, "good"); }
      else if (e.e === "fortify") { addFx(E.KEEPS[e.s], "+" + e.n, "good"); }
      else if (e.e === "play") sfx("play");
      else if (e.e === "move") sfx("step");
    });
    if (text) { setMsg(text); live(text); }
  }
  function finish() {
    stopAI();
    if (!game.counted) {
      game.counted = true;
      count(rowKey(), game.opts.mode === "ai" && st.over === 0);
    }
    game.done = true;
    saveSession();
    sfx(game.opts.mode === "ai" && st.over !== 0 ? "end" : "win");
    renderAll();
    setTimeout(resultDialog, 500);
  }

  // ---------- 5. Board view ----------
  var canvas, ctx, view = { cs: 40, ox: 0, oy: 0, w: 0, h: 0 };
  var COL = {};
  var fx = [];               // floating numbers { i, text, kind, t0 }

  function resize() {
    var wrap = $("board-wrap"), dpr = window.devicePixelRatio || 1;
    view.w = wrap.clientWidth;
    view.h = wrap.clientHeight;
    canvas.width = Math.round(view.w * dpr);
    canvas.height = Math.round(view.h * dpr);
    canvas.style.width = view.w + "px";
    canvas.style.height = view.h + "px";
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    var pad = 8;
    view.cs = Math.max(20, Math.floor(Math.min((view.w - pad * 2) / E.W, (view.h - pad * 2) / E.H)));
    view.ox = Math.floor((view.w - view.cs * E.W) / 2);
    view.oy = Math.floor((view.h - view.cs * E.H) / 2);
    draw();
  }
  function cellAt(sx, sy) {
    var x = Math.floor((sx - view.ox) / view.cs), y = Math.floor((sy - view.oy) / view.cs);
    return x < 0 || y < 0 || x >= E.W || y >= E.H ? -1 : E.idx(x, y);
  }
  function readColors() {
    var cs = getComputedStyle(document.documentElement);
    ["--bn-0", "--bn-1", "--bn-void", "--bn-plain", "--bn-plain2", "--bn-wood", "--bn-rock", "--bn-water", "--bn-mire",
     "--bn-road", "--bn-line", "--accent", "--accent-soft", "--danger", "--text", "--bg", "--panel-bg"].forEach(function (v) {
      COL[v.replace(/^--/, "")] = cs.getPropertyValue(v).trim();
    });
  }
  function addFx(i, text, kind) {
    if (i < 0 || reducedMotion()) return;
    fx.push({ i: i, text: text, kind: kind, t0: Date.now() });
    if (fx.length === 1) requestAnimationFrame(fxLoop);
  }
  function fxLoop() {
    var now = Date.now();
    fx = fx.filter(function (f) { return now - f.t0 < 900; });
    draw();
    if (fx.length) requestAnimationFrame(fxLoop);
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
  function cellXY(i) { var p = E.xy(i); return { x: view.ox + p.x * view.cs, y: view.oy + p.y * view.cs, s: view.cs }; }
  // What the selection lights up: { cells: {i: "go" | "hit" | "put"} }
  function marks() {
    var m = {};
    if (!sel || !humanTurn()) return m;
    if (sel.h !== undefined) E.targets(st, sel.h).forEach(function (c) { if (c >= 0) m[c] = "put"; });
    else {
      var u = E.unitById(st, sel.u);
      if (u) {
        E.moves(st, u).forEach(function (c) { m[c] = "go"; });
        E.attacks(st, u).forEach(function (c) { m[c] = "hit"; });
      }
    }
    return m;
  }
  function draw() {
    if (!ctx || !st) return;
    ctx.fillStyle = COL["bn-void"] || "#0d0c09";
    ctx.fillRect(0, 0, view.w, view.h);
    var mk = marks();
    for (var i = 0; i < E.N; i++) drawTile(i);
    E.SHRINES.forEach(drawShrine);
    drawKeep(0); drawKeep(1);
    Object.keys(mk).forEach(function (k) { drawMark(+k, mk[k]); });
    st.units.forEach(drawUnit);
    if (sel && sel.u !== undefined) { var su = E.unitById(st, sel.u); if (su) ring(su.i, COL.accent, 3); }
    if (cursor >= 0) ring(cursor, COL.text, 2);
    var now = Date.now();
    fx.forEach(function (f) {
      var c = cellXY(f.i), k = (now - f.t0) / 900;
      ctx.globalAlpha = 1 - k;
      ctx.fillStyle = f.kind === "bad" ? COL.danger : COL.accent;
      ctx.font = "800 " + Math.round(c.s * 0.34) + "px Nunito, system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(f.text, c.x + c.s / 2, c.y + c.s * 0.3 - k * c.s * 0.4);
      ctx.globalAlpha = 1;
    });
  }
  function ring(i, color, w) {
    var c = cellXY(i);
    ctx.strokeStyle = color;
    ctx.lineWidth = w;
    rr(c.x + 2, c.y + 2, c.s - 4, c.s - 4, c.s * 0.14);
    ctx.stroke();
  }
  function drawTile(i) {
    var c = cellXY(i), t = st.map.charAt(i), s = c.s, p = E.xy(i);
    ctx.fillStyle = (p.x + p.y) % 2 ? COL["bn-plain2"] : COL["bn-plain"];
    if (t === "~" || t === "b") ctx.fillStyle = COL["bn-water"];
    else if (t === "m") ctx.fillStyle = COL["bn-mire"];
    ctx.fillRect(c.x, c.y, s, s);
    ctx.strokeStyle = COL["bn-line"];
    ctx.lineWidth = 1;
    ctx.strokeRect(c.x + 0.5, c.y + 0.5, s - 1, s - 1);
    var cx = c.x + s / 2, cy = c.y + s / 2;
    if (t === "w") {
      ctx.fillStyle = COL["bn-wood"];
      [[-0.22, 0.1], [0.2, 0.05], [0, -0.18]].forEach(function (o) {
        var x = cx + o[0] * s, y = cy + o[1] * s;
        ctx.beginPath(); ctx.moveTo(x, y - s * 0.2); ctx.lineTo(x + s * 0.15, y + s * 0.12); ctx.lineTo(x - s * 0.15, y + s * 0.12); ctx.closePath(); ctx.fill();
      });
    } else if (t === "r") {
      ctx.fillStyle = COL["bn-rock"];
      ctx.beginPath();
      ctx.moveTo(c.x + s * 0.18, c.y + s * 0.78); ctx.lineTo(c.x + s * 0.32, c.y + s * 0.34); ctx.lineTo(c.x + s * 0.52, c.y + s * 0.22);
      ctx.lineTo(c.x + s * 0.76, c.y + s * 0.4); ctx.lineTo(c.x + s * 0.84, c.y + s * 0.78); ctx.closePath(); ctx.fill();
    } else if (t === "~" || t === "b") {
      ctx.strokeStyle = "rgba(255,255,255,0.35)";
      ctx.lineWidth = Math.max(1, s * 0.04);
      [0.35, 0.62].forEach(function (k) {
        ctx.beginPath();
        for (var x = 0; x <= 1.001; x += 0.1) { var yy = c.y + s * k + Math.sin(x * Math.PI * 3) * s * 0.04; if (x === 0) ctx.moveTo(c.x + x * s, yy); else ctx.lineTo(c.x + x * s, yy); }
        ctx.stroke();
      });
      if (t === "b") {
        ctx.fillStyle = COL["bn-road"];
        ctx.fillRect(c.x + s * 0.28, c.y, s * 0.44, s);
        ctx.strokeStyle = COL["bn-line"];
        for (var k = 1; k < 5; k++) { ctx.beginPath(); ctx.moveTo(c.x + s * 0.28, c.y + k * s / 5); ctx.lineTo(c.x + s * 0.72, c.y + k * s / 5); ctx.stroke(); }
      }
    } else if (t === "t") {
      ctx.fillStyle = COL["bn-rock"];
      ctx.fillRect(cx - s * 0.16, cy - s * 0.18, s * 0.32, s * 0.4);
      for (var b = 0; b < 3; b++) ctx.fillRect(cx - s * 0.16 + b * s * 0.12, cy - s * 0.28, s * 0.08, s * 0.1);
    } else if (t === "m") {
      ctx.fillStyle = "rgba(0,0,0,0.25)";
      [[0.3, 0.35], [0.65, 0.3], [0.45, 0.65], [0.75, 0.7]].forEach(function (o) { ctx.beginPath(); ctx.arc(c.x + o[0] * s, c.y + o[1] * s, s * 0.06, 0, 7); ctx.fill(); });
    } else if (t === "s") {
      ctx.fillStyle = COL["bn-water"];
      ctx.beginPath(); ctx.arc(cx, cy + s * 0.06, s * 0.16, 0, Math.PI); ctx.lineTo(cx, cy - s * 0.22); ctx.closePath(); ctx.fill();
    } else if (t === "d") {
      ctx.fillStyle = COL["bn-road"];
      ctx.fillRect(c.x, cy - s * 0.14, s, s * 0.28);
    }
  }
  function drawShrine(i) {
    var c = cellXY(i), s = c.s, u = E.unitAt(st, i);
    var x = c.x + s * 0.2, y = c.y + s * 0.14;
    ctx.strokeStyle = COL.text;
    ctx.lineWidth = Math.max(1.5, s * 0.04);
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x, y + s * 0.4); ctx.stroke();
    ctx.fillStyle = u ? COL["bn-" + u.s] : COL.accent;
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + s * 0.24, y + s * 0.08); ctx.lineTo(x, y + s * 0.16); ctx.closePath(); ctx.fill();
  }
  function drawKeep(side) {
    var i = E.KEEPS[side], c = cellXY(i), s = c.s;
    ctx.fillStyle = COL["bn-" + side];
    rr(c.x + s * 0.12, c.y + s * 0.3, s * 0.76, s * 0.58, s * 0.06);
    ctx.fill();
    for (var b = 0; b < 4; b++) ctx.fillRect(c.x + s * 0.12 + b * s * 0.2, c.y + s * 0.18, s * 0.16, s * 0.14);
    ctx.fillStyle = COL.bg;
    ctx.font = "800 " + Math.round(s * 0.3) + "px Nunito, system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(String(st.keep[side]), c.x + s / 2, c.y + s * 0.62);
    ctx.textBaseline = "alphabetic";
  }
  function drawMark(i, kind) {
    var c = cellXY(i);
    if (kind === "hit") {
      ctx.strokeStyle = COL.danger;
      ctx.lineWidth = 3;
      rr(c.x + 3, c.y + 3, c.s - 6, c.s - 6, c.s * 0.14);
      ctx.stroke();
      ctx.fillStyle = "rgba(224, 108, 117, 0.22)";
      ctx.fill();
    } else {
      ctx.fillStyle = kind === "go" ? "rgba(255, 255, 255, 0.22)" : COL["accent-soft"];
      rr(c.x + 3, c.y + 3, c.s - 6, c.s - 6, c.s * 0.14);
      ctx.fill();
      ctx.strokeStyle = kind === "go" ? "rgba(255, 255, 255, 0.55)" : COL.accent;
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
  }
  function drawUnit(u) {
    var c = cellXY(u.i), s = c.s, cx = c.x + s / 2, cy = c.y + s / 2, k = E.card(u.k);
    var spent = u.s === st.side && (!E.moves(st, u).length && !E.attacks(st, u).length);
    ctx.globalAlpha = spent ? 0.6 : 1;
    ctx.fillStyle = COL["bn-" + u.s];
    ctx.beginPath(); ctx.arc(cx, cy - s * 0.04, s * 0.34, 0, 7); ctx.fill();
    ctx.strokeStyle = "rgba(0, 0, 0, 0.45)";
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.fillStyle = "#fff";
    ctx.font = "800 " + Math.round(s * 0.32) + "px Nunito, system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(cardName(u.k).charAt(0).toUpperCase(), cx, cy - s * 0.05);
    // Attack (left) and Health (right) badges
    var bs = Math.round(s * 0.24);
    ctx.font = "800 " + Math.round(s * 0.2) + "px Nunito, system-ui, sans-serif";
    if (k.atk > 0) {
      ctx.fillStyle = COL.bg; ctx.beginPath(); ctx.arc(c.x + s * 0.2, c.y + s * 0.8, bs / 2, 0, 7); ctx.fill();
      ctx.fillStyle = COL.text; ctx.fillText(String(E.atkOf(st, u, u.s === st.side)), c.x + s * 0.2, c.y + s * 0.81);
    }
    ctx.fillStyle = u.hp < k.hp ? COL.danger : COL.bg; ctx.beginPath(); ctx.arc(c.x + s * 0.8, c.y + s * 0.8, bs / 2, 0, 7); ctx.fill();
    ctx.fillStyle = u.hp < k.hp ? "#fff" : COL.text; ctx.fillText(String(u.hp), c.x + s * 0.8, c.y + s * 0.81);
    if (k.kw) {
      ctx.fillStyle = COL.accent;
      ctx.beginPath(); ctx.arc(c.x + s * 0.8, c.y + s * 0.2, s * 0.07, 0, 7); ctx.fill();
    }
    ctx.textBaseline = "alphabetic";
    ctx.globalAlpha = 1;
  }
  function reducedMotion() {
    try { return window.matchMedia("(prefers-reduced-motion: reduce)").matches; } catch (e) { return false; }
  }
  function shake() {
    if (reducedMotion()) return;
    var w = $("board-wrap");
    w.classList.remove("shake");
    void w.offsetWidth;
    w.classList.add("shake");
  }
  function live(msg) {
    var n = $("live");
    n.textContent = "";
    setTimeout(function () { n.textContent = msg; }, 30);
  }

  // ---------- 6. Input ----------
  function localXY(e) {
    var r = canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }
  function tapCell(i) {
    if (i < 0 || !game) return;
    cursor = -1;
    if (!humanTurn()) {
      if (st.over < 0 && !game.done) setMsg(t("msg.theirs"));
      return;
    }
    var mk = marks();
    if (sel && sel.h !== undefined) {
      if (mk[i] === "put") { doAct({ t: "play", h: sel.h, c: i }); return; }
    } else if (sel && sel.u !== undefined && mk[i]) {
      var id = sel.u;
      if (doAct({ t: mk[i] === "hit" ? "atk" : "move", u: id, c: i })) {
        var u = E.unitById(st, id);
        if (u && (E.moves(st, u).length || E.attacks(st, u).length)) { sel = { u: id }; draw(); }
      }
      return;
    }
    var w = E.unitAt(st, i);
    if (w && w.s === st.side) {
      sel = { u: w.id };
      var k = cardName(w.k);
      if (!E.moves(st, w).length && !E.attacks(st, w).length) setMsg(t(w.f && E.card(w.k).kw !== "charge" ? "msg.fresh" : "msg.spent", { k: k }));
      else setMsg(t("msg.unit", { k: k }));
      renderAll();
      return;
    }
    sel = null;
    setMsg(cellTitle(i));
    renderAll();
  }
  function pickCard(h) {
    if (!humanTurn() || h >= st.hand[st.side].length) return;
    var k = st.hand[st.side][h], c = E.card(k), name = cardName(k);
    if (sel && sel.h === h) {
      var tg = E.targets(st, h);
      if (tg.length === 1 && tg[0] === -1) { doAct({ t: "play", h: h, c: -1 }); return; }
      sel = null;
      setMsg("");
      renderAll();
      return;
    }
    sel = { h: h };
    if (c.c > st.en[st.side]) setMsg(t("msg.energy", { k: name }));
    else {
      var tgs = E.targets(st, h);
      if (!tgs.length) setMsg(t("msg.none", { k: name }));
      else if (tgs[0] === -1) setMsg(t("msg.cast", { k: name }));
      else setMsg(t("msg.pick", { k: name }));
    }
    renderAll();
  }
  var press = null;          // { x, y, i, timer, held }
  function wireInput() {
    canvas.addEventListener("pointerdown", function (e) {
      var p = localXY(e), i = cellAt(p.x, p.y);
      press = { x: p.x, y: p.y, i: i, held: false, timer: null };
      press.timer = setTimeout(function () {
        if (press && press.i >= 0) { press.held = true; infoCell(press.i); }
      }, HOLD_MS);
    });
    canvas.addEventListener("pointermove", function (e) {
      if (!press) return;
      var p = localXY(e);
      if (Math.abs(p.x - press.x) + Math.abs(p.y - press.y) > 12) { clearTimeout(press.timer); press.timer = null; }
    });
    canvas.addEventListener("pointerup", function () {
      if (!press) return;
      clearTimeout(press.timer);
      var pr = press;
      press = null;
      if (!pr.held && pr.timer !== null) tapCell(pr.i);
    });
    canvas.addEventListener("pointercancel", function () { if (press) clearTimeout(press.timer); press = null; });
    canvas.addEventListener("contextmenu", function (e) { e.preventDefault(); });
    canvas.addEventListener("focus", function () { if (cursor < 0) { cursor = E.KEEPS[shownSide()] + (shownSide() === 0 ? -E.W : E.W); draw(); } });
    canvas.addEventListener("blur", function () { cursor = -1; draw(); });
  }
  function wireKeyboard() {
    document.addEventListener("keydown", function (e) {
      if (document.querySelector("dialog[open]") || e.ctrlKey || e.metaKey || e.altKey) return;
      var k = e.key, used = true;
      if (k === "n" || k === "N") newDialog();
      else if (k === "z" || k === "Z") undoLast();
      else if (k === "e" || k === "E") endTurn();
      else if (/^[1-6]$/.test(k)) pickCard(+k - 1);
      else if (k === "Escape") { sel = null; setMsg(""); renderAll(); }
      else if (document.activeElement === canvas && (k === "ArrowUp" || k === "ArrowDown" || k === "ArrowLeft" || k === "ArrowRight")) {
        var d = { ArrowUp: 0, ArrowRight: 1, ArrowDown: 2, ArrowLeft: 3 }[k];
        var n = E.step(cursor < 0 ? 17 : cursor, d);
        if (n >= 0) cursor = n;
        setMsg(cellTitle(cursor));
        draw();
      } else if (document.activeElement === canvas && (k === "Enter" || k === " ")) { var c = cursor; tapCell(c); cursor = c; draw(); }
      else if (document.activeElement === canvas && (k === "i" || k === "I") && cursor >= 0) infoCell(cursor);
      else used = false;
      if (used) e.preventDefault();
    });
  }

  // ---------- 7. Panels ----------
  function renderAll() {
    renderStatus();
    renderHand();
    draw();
  }
  function renderStatus() {
    [0, 1].forEach(function (s) {
      var box = $("k" + s), hp = st.keep[s];
      box.querySelector(".fill").style.width = Math.round(100 * hp / E.KEEP_HP) + "%";
      box.querySelector(".v").textContent = String(hp);
      box.classList.toggle("low", hp <= 5);
      box.title = t("st.keep", { s: sideName(s), n: hp });
      box.setAttribute("aria-label", box.title);
    });
    var en = $("energy"), side = st.side, cap = Math.min(E.EN_MAX, st.rt[side]) + E.shrinesHeld(st, side);
    en.innerHTML = "";
    for (var k = 0; k < cap; k++) en.appendChild(el("i", k < st.en[side] ? "on" : ""));
    en.title = t("st.energy", { n: st.en[side], m: cap });
    en.setAttribute("aria-label", en.title);
    var who = $("who");
    who.textContent = st.over >= 0 ? "" : (st.side === aiSide() ? t("st.ai") :
      (game.opts.mode === "hot" ? t("st.whose", { s: sideName(st.side) }) : t("st.yours")));
    who.className = humanTurn() ? "mine" : "";
    $("end-btn").disabled = !humanTurn();
    $("undo-btn").disabled = !humanTurn() || !undo.length;
  }
  var GS = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">';
  var KIND_ICON = {
    s: GS + '<path d="M12 3l2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5z"/></svg>',
    t: GS + '<path d="M3 20h18M6 20l4-9 3 5 2-3 3 7"/></svg>'
  };
  function renderHand() {
    var box = $("hand"), side = shownSide();
    box.innerHTML = "";
    box.setAttribute("aria-label", t("hand.label"));
    if (game.opts.mode === "hot" && game.pass) { box.appendChild(el("span", "none", t("hand.hidden"))); return; }
    var hand = st.hand[side];
    if (!hand.length) { box.appendChild(el("span", "none", t("hand.none"))); return; }
    var mine = humanTurn() && st.side === side;
    hand.forEach(function (k, h) {
      var c = E.card(k), b = el("button", "card k-" + c.t);
      b.type = "button";
      b.appendChild(el("span", "cost", String(c.c)));
      if (c.t !== "u") { var ic = el("span", "ic"); ic.innerHTML = KIND_ICON[c.t]; b.appendChild(ic); }
      b.appendChild(el("span", "nm", cardName(k)));
      if (c.t === "u") {
        var ah = el("span", "ah");
        ah.appendChild(el("b", "", String(c.atk)));
        ah.appendChild(document.createTextNode(" / "));
        ah.appendChild(el("b", "", String(c.hp)));
        b.appendChild(ah);
      }
      if (!mine || c.c > st.en[side]) b.classList.add("poor");
      b.setAttribute("aria-pressed", sel && sel.h === h ? "true" : "false");
      b.setAttribute("aria-label", t("card.aria", { k: cardName(k), c: c.c }) + ". " + cardText(k));
      b.title = cardName(k) + " · " + cardText(k);
      var hold = null, held = false;
      b.addEventListener("pointerdown", function () { held = false; hold = setTimeout(function () { held = true; infoCard(k); }, HOLD_MS); });
      b.addEventListener("pointerup", function () { clearTimeout(hold); });
      b.addEventListener("pointerleave", function () { clearTimeout(hold); });
      b.addEventListener("contextmenu", function (e) { e.preventDefault(); });
      b.addEventListener("click", function () { if (held) { held = false; return; } pickCard(h); });
      box.appendChild(b);
    });
  }
  function cardText(k) {
    var c = E.card(k);
    if (c.t !== "u") return t("tx." + k);
    var s = t("unit.line", { c: c.c, a: c.atk, h: c.hp, m: c.mv });
    return c.kw ? s + ". " + t("kw." + c.kw) : s + ".";
  }
  function cellTitle(i) {
    if (i < 0) return "";
    var u = E.unitAt(st, i);
    if (u) return t("unit.side", { s: sideName(u.s) }) + " · " + cardName(u.k) + " · " + t("unit.hp", { n: u.hp, m: E.card(u.k).hp });
    if (E.isKeep(i)) { var s = i === E.KEEPS[0] ? 0 : 1; return t("tx.keep", { s: sideName(s), n: st.keep[s] }); }
    if (E.isShrine(i)) return t("t.shrine");
    return terrainName(st.map.charAt(i));
  }
  var TER = { ".": "plain", "w": "wood", "r": "rock", "~": "water", "b": "bridge", "t": "tower", "m": "mire", "s": "spring", "d": "road" };
  function terrainName(ch) {
    var k = TER[ch];
    return k === "plain" ? t("t.plain") : (k === "water" ? t("t.water") : cardName(k));
  }
  function terrainText(ch) {
    var k = TER[ch];
    return k === "plain" ? t("tx.plain") : (k === "water" ? t("tx.water") : t("tx." + k));
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
  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
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
  function deckKey(d) { return d === "r" ? "random" : d; }
  function deckField(label, cur, onPick) {
    var note = el("div", "dlg-note", t("deck." + deckKey(cur) + ".note"));
    var f = segField(label, DECK_CHOICES, cur, "", function (v) { onPick(v); note.textContent = t("deck." + deckKey(v) + ".note"); });
    [].forEach.call(f.querySelectorAll(".seg-btn"), function (b, n) { b.textContent = t("deck." + deckKey(DECK_CHOICES[n])); });
    f.appendChild(note);
    return f;
  }

  function newDialog() {
    cancelTourWait();
    var o = { mode: prefs.mode, lv: prefs.lv, d0: prefs.d0, d1: prefs.d1 };
    var dlg = makeDialog("bn-new");
    dlg.appendChild(el("div", "dlg-title", t("new.title")));
    var note = el("div", "dlg-note", t("mode." + o.mode + ".note"));
    var lvWrap = el("div", "");
    function sync() {
      note.textContent = t("mode." + o.mode + ".note");
      lvWrap.hidden = o.mode !== "ai";
      d1.querySelector(".dlg-label").textContent = t(o.mode === "ai" ? "new.deckAi" : "new.deck1");
    }
    dlg.appendChild(segField(t("new.mode"), ["ai", "hot"], o.mode, "mode.", function (v) { o.mode = v; sync(); }));
    dlg.appendChild(note);
    lvWrap.appendChild(segField(t("new.level"), E.LEVELS, o.lv, "lv.", function (v) { o.lv = v; }));
    dlg.appendChild(lvWrap);
    dlg.appendChild(deckField(t("new.deck0"), o.d0, function (v) { o.d0 = v; }));
    var d1 = deckField(t("new.deck1"), o.d1, function (v) { o.d1 = v; });
    dlg.appendChild(d1);
    var seedWrap = el("label", "dlg-field");
    seedWrap.appendChild(el("span", "dlg-label", t("new.seed")));
    var seed = el("input", "dlg-input");
    seed.type = "text";
    seed.maxLength = 16;
    seed.autocomplete = "off";
    seed.spellcheck = false;
    seedWrap.appendChild(seed);
    dlg.appendChild(seedWrap);
    if (game && inProgressOf(game)) dlg.appendChild(el("div", "dlg-note", t("new.giveUp")));
    var acts = el("div", "dlg-actions");
    acts.appendChild(button(t("new.cancel"), "", function () { dlg.close(); }));
    var go = button(t("new.start"), "primary", function () {
      prefs.mode = o.mode; prefs.lv = o.lv; prefs.d0 = o.d0; prefs.d1 = o.d1;
      savePrefs();
      dlg.close();
      startGame({ mode: o.mode, lv: o.lv, seed: cleanSeed(seed.value) || newSeed(), d: [o.d0, o.d1] });
    });
    acts.appendChild(go);
    dlg.appendChild(acts);
    sync();
    document.body.appendChild(dlg);
    dlg.showModal();
    go.focus();
  }

  function infoDialog(title, lines) {
    var dlg = makeDialog("bn-info");
    dlg.appendChild(el("div", "dlg-title", title));
    lines.forEach(function (l) { if (l) dlg.appendChild(el("div", l.cls || "dlg-msg", l.text)); });
    var acts = el("div", "dlg-actions");
    var close = button(t("info.close"), "primary", function () { dlg.close(); });
    acts.appendChild(close);
    dlg.appendChild(acts);
    document.body.appendChild(dlg);
    dlg.showModal();
    close.focus();
  }
  function infoCard(k) {
    var c = E.card(k);
    infoDialog(cardName(k), c.t === "u"
      ? [{ text: t("unit.line", { c: c.c, a: c.atk, h: c.hp, m: c.mv }), cls: "info-line" }, c.kw ? { text: t("kw." + c.kw) } : null]
      : [{ text: t("tx." + k) }]);
  }
  function infoCell(i) {
    if (!st || i < 0) return;
    var lines = [], u = E.unitAt(st, i), title;
    if (u) {
      var c = E.card(u.k);
      title = cardName(u.k);
      lines.push({ text: t("unit.side", { s: sideName(u.s) }) + " · " + t("unit.hp", { n: u.hp, m: c.hp }), cls: "info-line" });
      lines.push({ text: t("unit.line", { c: c.c, a: c.atk, h: c.hp, m: c.mv }), cls: "info-line" });
      if (c.kw) lines.push({ text: t("kw." + c.kw) });
      if (u.s === st.side && st.over < 0) {
        if (u.st) lines.push({ text: t("unit.stuck"), cls: "dlg-note" });
        else if (u.f && c.kw !== "charge") lines.push({ text: t("unit.fresh"), cls: "dlg-note" });
        else if (u.mv && u.at) lines.push({ text: t("unit.spent"), cls: "dlg-note" });
      }
      lines.push({ text: terrainName(st.map.charAt(i)) + ": " + terrainText(st.map.charAt(i)), cls: "dlg-note" });
    } else if (E.isKeep(i)) {
      var s = i === E.KEEPS[0] ? 0 : 1;
      title = t("t.keep");
      lines.push({ text: t("tx.keep", { s: sideName(s), n: st.keep[s] }) });
    } else if (E.isShrine(i)) {
      title = t("t.shrine");
      lines.push({ text: t("tx.shrine") });
    } else {
      title = terrainName(st.map.charAt(i));
      lines.push({ text: terrainText(st.map.charAt(i)) });
    }
    if (E.isShrine(i) && u) lines.push({ text: t("tx.shrine"), cls: "dlg-note" });
    infoDialog(title, lines);
  }

  // Two players: the hand stays hidden until the next player is ready.
  function passDialog() {
    if (!game || !game.pass || game.done || document.getElementById("bn-pass")) return;
    var dlg = makeDialog("bn-pass", "pass");
    dlg.setAttribute("data-modal", "1");
    var s = st.side;
    dlg.appendChild(el("span", "pass-sw s" + s));
    dlg.appendChild(el("div", "dlg-hero", t("pass.title", { s: sideName(s) })));
    dlg.appendChild(el("div", "dlg-msg", t("pass.msg", { s: sideName(s) })));
    var acts = el("div", "dlg-actions");
    var go = button(t("pass.go"), "primary", function () {
      game.pass = false;
      saveSession();
      dlg.close();
      renderAll();
      live(t("st.whose", { s: sideName(s) }));
    });
    acts.appendChild(go);
    dlg.appendChild(acts);
    dlg.addEventListener("cancel", function (e) { e.preventDefault(); });
    document.body.appendChild(dlg);
    dlg.showModal();
    go.focus();
  }
  // In two-player battles every end of turn hides the hand again.
  function hideForPass() { if (game && game.opts.mode === "hot" && !game.done && st.over < 0) game.pass = true; }

  function resultDialog() {
    if (!game || st.over < 0 || document.querySelector("dialog[open]")) return;
    var dlg = makeDialog("bn-result");
    var ai = game.opts.mode === "ai", won = st.over === 0;
    dlg.appendChild(el("div", "dlg-title", t("app.name") + (ai ? " · " + t("lv." + game.opts.lv) : " · " + t("mode.hot"))));
    dlg.appendChild(el("div", "dlg-hero" + (ai && !won ? " lost" : ""), ai ? t(won ? "res.won" : "res.lost") : t("res.side", { s: sideName(st.over) })));
    dlg.appendChild(el("div", "dlg-msg", t(st.why === "shrines" ? "res.shrines" : "res.keep")));
    dlg.appendChild(row(t("res.turns"), String(Math.ceil(st.turn / 2))));
    dlg.appendChild(row(t("deck." + st.decks[0]) + " · " + t("deck." + st.decks[1]), st.keep[0] + " · " + st.keep[1]));
    dlg.appendChild(el("div", "dlg-note", t("res.code", { seed: game.opts.seed })));
    var acts = el("div", "dlg-actions wrap");
    acts.appendChild(button(t("res.same"), "", function () {
      dlg.close();
      startGame({ mode: game.opts.mode, lv: game.opts.lv, seed: game.opts.seed, d: game.opts.d });
    }));
    var nb = button(t("res.new"), "primary", function () { dlg.close(); newDialog(); });
    acts.appendChild(nb);
    dlg.appendChild(acts);
    document.body.appendChild(dlg);
    dlg.showModal();
    nb.focus();
  }

  function statsDialog() {
    var dlg = makeDialog("bn-stats");
    dlg.appendChild(el("div", "dlg-title", t("stats.title")));
    dlg.appendChild(el("div", "dlg-sub", t("mode.ai") + " · " + t("stats.head")));
    var empty = true;
    E.LEVELS.forEach(function (k) {
      var v = totals(k);
      if (v[0]) empty = false;
      dlg.appendChild(row(t("lv." + k), v[0] + " · " + v[1]));
    });
    var p = totals("p");
    if (p[0]) empty = false;
    dlg.appendChild(el("div", "dlg-sub", t("stats.hot")));
    dlg.appendChild(row(t("stats.hotRow"), String(p[0])));
    if (game) dlg.appendChild(el("div", "dlg-note", t("stats.code", { seed: game.opts.seed })));
    var acts = el("div", "dlg-actions");
    var reset = button(t("stats.reset"), "danger", function () {
      dlg.close();
      confirmDialog(t("reset.ask"), resetRecords);
    });
    reset.disabled = empty;
    acts.appendChild(reset);
    var close = button(t("stats.close"), "primary", function () { dlg.close(); });
    acts.appendChild(close);
    dlg.appendChild(acts);
    document.body.appendChild(dlg);
    dlg.showModal();
    close.focus();
  }
  function confirmDialog(msg, onYes) {
    var dlg = makeDialog("bn-confirm");
    dlg.appendChild(el("div", "dlg-msg", msg));
    var acts = el("div", "dlg-actions");
    var no = button(t("confirm.no"), "", function () { dlg.close(); });
    acts.appendChild(no);
    acts.appendChild(button(t("confirm.yes"), "danger", function () { dlg.close(); onYes(); }));
    dlg.appendChild(acts);
    document.body.appendChild(dlg);
    dlg.showModal();
    no.focus();
  }
  // Reset = a new epoch: every device drops rows older than br.
  function resetRecords() {
    data.br = Math.max(Date.now(), data.br + 1);
    data = mergeBanner(data, data);
    save();
    showToast(t("toast.reset"));
  }

  var tourTimer = null;
  function cancelTourWait() { if (tourTimer) { clearTimeout(tourTimer); tourTimer = null; } }
  function maybeTour() {
    if (prefs.tour || tourTimer || document.querySelector("dialog[open]")) return;
    tourTimer = setTimeout(function () { tourTimer = null; tourDialog(1); }, 400);
  }
  function tourDialog(n) {
    if (document.querySelector("dialog[open]")) return;
    var dlg = makeDialog("bn-tour");
    dlg.appendChild(el("div", "dlg-title", t("tour.title") + " · " + n + "/5"));
    dlg.appendChild(el("div", "dlg-msg", t("tour." + n)));
    var acts = el("div", "dlg-actions");
    function seen() { prefs.tour = true; savePrefs(); }
    if (n < 5) acts.appendChild(button(t("tour.skip"), "", function () { seen(); dlg.close(); }));
    var next = button(t(n < 5 ? "tour.next" : "tour.done"), "primary", function () {
      dlg.close();
      if (n < 5) setTimeout(function () { tourDialog(n + 1); }, 0);
      else { seen(); afterTour(); }
    });
    acts.appendChild(next);
    dlg.appendChild(acts);
    dlg.addEventListener("cancel", function () { seen(); setTimeout(afterTour, 0); });
    document.body.appendChild(dlg);
    dlg.showModal();
    next.focus();
  }
  // A pass screen waits behind the tour.
  function afterTour() { if (game && game.pass) passDialog(); }

  // ---------- 9. Toasts ----------
  function showToast(text) {
    try {
      var n = (window.parent && window.parent.orosNotifs) || window.orosNotifs;
      if (n && typeof n.transient === "function" &&
          n.transient({ ns: "banner", title: String(text) })) return;
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
  var HAPTIC = { hit: "tick", die: "good", keep: "bad", play: "tick", win: "win", end: "bad" };
  function sfx(kind) {
    if (window.orosHaptics && HAPTIC[kind]) window.orosHaptics.cue(HAPTIC[kind]);
    if (!sfxOn()) return;
    try {
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      if (!audio) audio = new AC();
      if (audio.state === "suspended") audio.resume();
      if (kind === "step" || kind === "tick") tone(196, 0, 0.04, "triangle", 0.05);
      else if (kind === "play") { tone(523, 0, 0.07, "sine", 0.1); tone(659, 0.06, 0.1, "sine", 0.08); }
      else if (kind === "hit") { tone(220, 0, 0.06, "square", 0.08); tone(165, 0.05, 0.08, "triangle", 0.1); }
      else if (kind === "die") { tone(330, 0, 0.08, "triangle", 0.1); tone(196, 0.07, 0.16, "triangle", 0.1); }
      else if (kind === "keep") { tone(130, 0, 0.18, "sawtooth", 0.08); tone(98, 0.12, 0.22, "triangle", 0.1); }
      else if (kind === "win") [523, 659, 784, 1047].forEach(function (f, k) { tone(f, k * 0.11, 0.22, "triangle"); });
      else if (kind === "end") { tone(392, 0, 0.18, "sine"); tone(262, 0.16, 0.34, "sine"); }
    } catch (e) { /* no audio → silent */ }
  }

  // ---------- Icons (R9: icon buttons ship empty, filled here) ----------
  var SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">';
  var UI_ICONS = {
    new:    SVG + '<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/></svg>',
    undo:   SVG + '<path d="M9 14 4 9l5-5"/><path d="M4 9h11a5 5 0 0 1 0 10h-3"/></svg>',
    stats:  SVG + '<path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0z"/><path d="M17 5h3v2a3 3 0 0 1-3 3M7 5H4v2a3 3 0 0 0 3 3"/></svg>',
    sfxOn:  SVG + '<path d="M11 5 6 9H2v6h4l5 4z"/><path d="M15.5 8.5a5 5 0 0 1 0 7M19 5a10 10 0 0 1 0 14"/></svg>',
    sfxOff: SVG + '<path d="M11 5 6 9H2v6h4l5 4z"/><path d="M22 9l-6 6M16 9l6 6"/></svg>'
  };
  function paintSfxBtn() {
    var b = $("sfx-btn"), on = sfxOn();
    b.innerHTML = on ? UI_ICONS.sfxOn : UI_ICONS.sfxOff;
    b.setAttribute("aria-pressed", on ? "true" : "false");
    b.setAttribute("aria-label", t(on ? "btn.sfxOn" : "btn.sfxOff"));
    b.title = t(on ? "btn.sfxOn" : "btn.sfxOff");
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
    api.registerSlice("banner", sliceGet, sliceSet, STORAGE_KEY, mergeBanner);
  }
  function sliceGet() { return mergeBanner(data, data); }   // canonical copy (R26)
  function sliceSet(incoming) {
    if (!incoming || typeof incoming !== "object" || !incoming.rows) return;
    window.__orosSyncApi._suppress = true;   // R6: a pull never marks dirty
    try {
      data = mergeBanner(incoming, incoming);
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
    canvas.setAttribute("aria-label", t("board.label"));
    $("end-btn").title = t("btn.endKey");
  }
  function paintStatic() {
    [["new-btn", "new", "btn.new"], ["undo-btn", "undo", "btn.undo"], ["stats-btn", "stats", "btn.stats"]].forEach(function (x) {
      var b = $(x[0]);
      b.innerHTML = UI_ICONS[x[1]];
      b.setAttribute("aria-label", t(x[2]));
      b.title = t(x[2]);
    });
    paintSfxBtn();
  }
  function wire() {
    $("new-btn").addEventListener("click", function () { newDialog(); });
    $("undo-btn").addEventListener("click", undoLast);
    $("end-btn").addEventListener("click", endTurn);
    $("stats-btn").addEventListener("click", statsDialog);
    $("sfx-btn").addEventListener("click", function () {
      try { localStorage.setItem(SFX_KEY, sfxOn() ? "0" : "1"); } catch (e) {}
      paintSfxBtn();
      sfx("play");
    });
    wireInput();
    wireKeyboard();
    window.addEventListener("resize", resize);
    // Save on the way out (R10 session).
    document.addEventListener("visibilitychange", function () { if (document.hidden && game) saveSession(); });
    window.addEventListener("pagehide", function () { if (game) saveSession(); });
  }

  function boot() {
    canvas = $("board");
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
    if (!game) game = makeGame({ mode: prefs.mode, lv: prefs.lv, seed: newSeed(), d: [prefs.d0, prefs.d1] });
    st = game.g;
    saveSession();
    resize();
    renderAll();
    if (st.over >= 0) setTimeout(resultDialog, 300);
    else {
      maybeTour();
      if (st.side === aiSide()) runAI();
      else if (game.pass && prefs.tour) setTimeout(passDialog, 300);
    }
  }

  boot();
})();
