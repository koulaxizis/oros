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
//   - Daily battle (W2): the same board, decks and shuffle for everyone
//     each day (gamekit/daily.js) against Medium, one try; result,
//     streak and a spoiler-free share line
//   - March (W3): a run of 8 battles against a stronger computer each
//     time; after each win add 1 of 3 cards to your deck or remove
//     one; one loss ends it. Last battles: the last 10, with Replay
// Data:
//   - synced slice "banner" (oros-banner-data): battles and wins per
//     computer level and two-player battles, as per-device counter rows
//     (each device only grows its own row; merge = per-row max, a join)
//     + reset stamp br (the Realm and Crypt pattern) + one Daily
//     battle result per day (newer epoch wins, equal epochs the better)
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
  var MARCH_KEY   = "oros-banner-march";
  var DATA_VER    = 1;
  var ROW_KEYS = ["e", "m", "h", "p", "a"];   // computer Easy, Medium, Hard; p two players; a March [marches, best]
  var MARCH_N = 8;                       // battles in a March
  var LAST_N = 10;                       // Last battles kept
  var AI_MS = 420;                       // one computer action
  var HOLD_MS = 450;                     // a hold opens the info
  var UNDO_MAX = 60;
  var DK = window.orosDaily || null;     // gamekit/daily.js (Daily battle)
  var DAILY_LV = "m";                    // the Daily battle is against Medium
  var MAX_DAY = 100000;
  var MAX_TURNS = 999;

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
      "btn.march": "March", "march.title": "March", "march.intro": "Eight battles in a row, each against a stronger computer: Easy, then Medium, then Hard. After each win add 1 of 3 cards to your deck, or remove one. One loss ends the march.",
      "march.deck": "Starting deck", "march.start": "Start a march", "march.next": "Battle {n} of {m}", "march.go": "Fight",
      "march.resume": "Back to the battle", "march.giveUp": "End this march", "march.giveUpAsk": "End this march? It counts with the battles you have won so far.",
      "march.cards": "Your deck: {n} cards", "march.best": "Best march: {n} of {m}", "march.none": "No march yet",
      "march.won": "March won: all {m} battles!", "march.lost": "The march ends: {n} of {m} won",
      "march.pick": "Battle won! Add a card", "march.pickNote": "Or remove one card from your deck ({n} cards now).",
      "march.remove": "Remove a card instead", "march.removeTitle": "Remove one card", "march.skip": "Keep the deck as it is",
      "march.foe": "Against: {d} · {lv}", "march.leave": "Leave this march battle? The march ends here.",
      "march.leaveYes": "Leave it", "march.leaveNo": "Keep playing", "march.tag": "March {n}/{m}",
      "march.add": "Add {k}", "march.drop": "Remove {k} ({n} in the deck)",
      "stats.march": "March", "stats.marchRow": "Marches · best",
      "last.title": "Last battles", "last.won": "Won", "last.lost": "Lost", "last.hot": "{s} won",
      "last.replay": "Replay", "last.replayLabel": "Replay battle {seed}", "last.turn": "turn {n}",
      "btn.puzzles": "Puzzles", "btn.decks": "My decks",
      "pz.title": "Puzzles", "pz.intro": "Twenty battles to win in one turn: break the red Keep before you end your turn. Undo takes back a step, and ending the turn starts the puzzle again.",
      "pz.solved": "Solved: {n} of {m}", "pz.label": "Puzzle {n}", "pz.labelDone": "Puzzle {n}, solved", "pz.tag": "Puzzle {n}",
      "pz.goal": "Break the red Keep this turn.", "pz.won": "Puzzle {n} solved!", "pz.fail": "The Keep still stands",
      "pz.failNote": "Look again at what each card and tile does: the way through is there.", "pz.retry": "Try again",
      "pz.back": "Look at the board", "pz.next": "Puzzle {n}", "pz.all": "All puzzles",
      "dk.title": "My decks", "dk.none": "No decks of your own yet. Make one from a ready-made deck or from nothing, or add one from a code.",
      "dk.new": "New deck", "dk.add": "Add from a code", "dk.addGo": "Add", "dk.edit": "Edit", "dk.editLabel": "Edit {n}",
      "dk.share": "Share", "dk.shareLabel": "Share the code of {n}", "dk.copied": "Deck code copied",
      "dk.editTitle": "Edit deck", "dk.name": "Name", "dk.from": "Start from", "dk.empty": "Nothing",
      "dk.count": "{n} of {m} cards", "dk.need": "A deck has exactly {m} cards, at most {c} of each.",
      "dk.plus": "One more {k}", "dk.minus": "One less {k}", "dk.save": "Save", "dk.saved": "Deck saved",
      "dk.del": "Delete", "dk.delAsk": "Delete the deck \u201c{n}\u201d? Its code still works for anyone who has it.", "dk.deleted": "Deck deleted",
      "dk.codeAsk": "Deck code", "dk.bad": "This is not a deck code. A code starts with b and has 17 letters and digits.",
      "dk.added": "Deck added", "dk.have": "You have this deck already: {n}", "dk.max": "You can keep {n} decks.",
      "dk.defName": "My deck {n}", "dk.pick": "{s}: one of your decks", "dk.pickNone": "Or one of my decks…",
      "dk.cardsOwn": "Your own deck of 20 cards.", "deck.own": "Own deck",
      "btn.daily": "Daily battle", "daily.label": "Daily",
      "daily.title": "Daily battle #{n}", "daily.tag": "Daily #{n}",
      "daily.won": "Won on turn {t}", "daily.lost": "Lost on turn {t}",
      "daily.turns": "Turns", "daily.keep": "Your Keep", "daily.streak": "Streak", "daily.best": "Best streak",
      "daily.oneTry": "The Daily battle has one try.", "daily.next": "A new battle tomorrow.",
      "daily.free": "Free battle", "daily.share": "Share", "daily.games": "All games",
      "daily.rules": "Today's battle: the same board and decks for everyone, against Medium, one try.",
      "daily.leave": "Leave today's battle? It counts as your one try, lost.",
      "daily.leaveYes": "Leave it", "daily.leaveNo": "Keep playing",
      "stats.daily": "Daily battle", "stats.dailyRow": "Played · won · streak · best",
      "share.won": "Won on turn {t}", "share.lost": "Lost on turn {t}",
      "toast.dailyGone": "The Daily battle needs the gamekit file: reload orOS",
      "toast.copied": "Copied: paste it into a chat", "toast.shared": "Shared",
      "toast.copyFail": "Could not copy",
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
      "btn.march": "Πορεία", "march.title": "Πορεία", "march.intro": "Οκτώ μάχες στη σειρά, κάθε φορά με πιο δυνατό υπολογιστή: Εύκολο, μετά Μέτριο, μετά Δύσκολο. Μετά από κάθε νίκη πρόσθεσε 1 από 3 κάρτες στην τράπουλά σου ή βγάλε μία. Μία ήττα τελειώνει την πορεία.",
      "march.deck": "Τράπουλα εκκίνησης", "march.start": "Ξεκίνα πορεία", "march.next": "Μάχη {n} από {m}", "march.go": "Στη μάχη",
      "march.resume": "Πίσω στη μάχη", "march.giveUp": "Τέλος της πορείας", "march.giveUpAsk": "Να τελειώσει η πορεία; Μετρά με όσες μάχες έχεις κερδίσει ως τώρα.",
      "march.cards": "Η τράπουλά σου: {n} κάρτες", "march.best": "Καλύτερη πορεία: {n} από {m}", "march.none": "Καμία πορεία ακόμα",
      "march.won": "Νίκη στην πορεία: και οι {m} μάχες!", "march.lost": "Η πορεία τελείωσε: {n} από {m} νίκες",
      "march.pick": "Νίκη! Πρόσθεσε μια κάρτα", "march.pickNote": "Ή βγάλε μία κάρτα από την τράπουλά σου (τώρα έχει {n}).",
      "march.remove": "Βγάλε καλύτερα μια κάρτα", "march.removeTitle": "Βγάλε μία κάρτα", "march.skip": "Άφησε την τράπουλα όπως είναι",
      "march.foe": "Αντίπαλος: {d} · {lv}", "march.leave": "Να αφήσεις αυτή τη μάχη της πορείας; Η πορεία τελειώνει εδώ.",
      "march.leaveYes": "Άφησέ την", "march.leaveNo": "Συνέχισε", "march.tag": "Πορεία {n}/{m}",
      "march.add": "Πρόσθεσε: {k}", "march.drop": "Βγάλε: {k} ({n} στην τράπουλα)",
      "stats.march": "Πορεία", "stats.marchRow": "Πορείες · καλύτερη",
      "last.title": "Τελευταίες μάχες", "last.won": "Νίκη", "last.lost": "Ήττα", "last.hot": "Κέρδισε ο {s}",
      "last.replay": "Ξανά", "last.replayLabel": "Ξανά η μάχη {seed}", "last.turn": "γύρος {n}",
      "btn.puzzles": "Γρίφοι", "btn.decks": "Οι τράπουλές μου",
      "pz.title": "Γρίφοι", "pz.intro": "Είκοσι μάχες για να τις κερδίσεις σε έναν γύρο: σπάσε το κόκκινο Κάστρο πριν τελειώσεις τον γύρο σου. Η Αναίρεση παίρνει πίσω ένα βήμα, και το τέλος του γύρου ξεκινά τον γρίφο από την αρχή.",
      "pz.solved": "Λύθηκαν: {n} από {m}", "pz.label": "Γρίφος {n}", "pz.labelDone": "Γρίφος {n}, λύθηκε", "pz.tag": "Γρίφος {n}",
      "pz.goal": "Σπάσε το κόκκινο Κάστρο σε αυτόν τον γύρο.", "pz.won": "Ο γρίφος {n} λύθηκε!", "pz.fail": "Το Κάστρο στέκεται ακόμα",
      "pz.failNote": "Δες ξανά τι κάνει κάθε κάρτα και κάθε πλακίδιο: ο δρόμος υπάρχει.", "pz.retry": "Ξανά από την αρχή",
      "pz.back": "Δες το πεδίο", "pz.next": "Γρίφος {n}", "pz.all": "Όλοι οι γρίφοι",
      "dk.title": "Οι τράπουλές μου", "dk.none": "Δεν έχεις ακόμα δικές σου τράπουλες. Φτιάξε μία από μια έτοιμη τράπουλα ή από το μηδέν, ή πρόσθεσε μία από έναν κωδικό.",
      "dk.new": "Νέα τράπουλα", "dk.add": "Προσθήκη από κωδικό", "dk.addGo": "Προσθήκη", "dk.edit": "Αλλαγή", "dk.editLabel": "Αλλαγή: {n}",
      "dk.share": "Κοινοποίηση", "dk.shareLabel": "Κοινοποίηση του κωδικού: {n}", "dk.copied": "Ο κωδικός της τράπουλας αντιγράφηκε",
      "dk.editTitle": "Αλλαγή τράπουλας", "dk.name": "Όνομα", "dk.from": "Ξεκίνα από", "dk.empty": "Τίποτα",
      "dk.count": "{n} από {m} κάρτες", "dk.need": "Μια τράπουλα έχει ακριβώς {m} κάρτες, ως {c} από την καθεμία.",
      "dk.plus": "Μία ακόμα: {k}", "dk.minus": "Μία λιγότερη: {k}", "dk.save": "Αποθήκευση", "dk.saved": "Η τράπουλα αποθηκεύτηκε",
      "dk.del": "Διαγραφή", "dk.delAsk": "Να διαγραφεί η τράπουλα «{n}»; Ο κωδικός της δουλεύει ακόμα για όποιον τον έχει.", "dk.deleted": "Η τράπουλα διαγράφηκε",
      "dk.codeAsk": "Κωδικός τράπουλας", "dk.bad": "Αυτός δεν είναι κωδικός τράπουλας. Ένας κωδικός αρχίζει από b και έχει 17 γράμματα και ψηφία.",
      "dk.added": "Η τράπουλα προστέθηκε", "dk.have": "Την έχεις ήδη αυτή την τράπουλα: {n}", "dk.max": "Μπορείς να κρατάς ως {n} τράπουλες.",
      "dk.defName": "Τράπουλα {n}", "dk.pick": "{s}: μία από τις τράπουλές σου", "dk.pickNone": "Ή μία από τις τράπουλές μου…",
      "dk.cardsOwn": "Η δική σου τράπουλα των 20 καρτών.", "deck.own": "Δική μου τράπουλα",
      "btn.daily": "Μάχη της ημέρας", "daily.label": "Ημέρας",
      "daily.title": "Μάχη της ημέρας #{n}", "daily.tag": "Ημέρας #{n}",
      "daily.won": "Νίκη στον γύρο {t}", "daily.lost": "Ήττα στον γύρο {t}",
      "daily.turns": "Γύροι", "daily.keep": "Το Κάστρο σου", "daily.streak": "Σερί", "daily.best": "Καλύτερο σερί",
      "daily.oneTry": "Η μάχη της ημέρας παίζεται μία φορά.", "daily.next": "Νέα μάχη αύριο.",
      "daily.free": "Ελεύθερη μάχη", "daily.share": "Κοινοποίηση", "daily.games": "Όλα τα παιχνίδια",
      "daily.rules": "Η σημερινή μάχη: ίδιο πεδίο και ίδιες τράπουλες για όλους, απέναντι στο Μέτριο, μία προσπάθεια.",
      "daily.leave": "Να αφήσεις τη σημερινή μάχη; Μετρά ως η μία σου προσπάθεια, χαμένη.",
      "daily.leaveYes": "Άφησέ την", "daily.leaveNo": "Συνέχισε",
      "stats.daily": "Μάχη της ημέρας", "stats.dailyRow": "Μάχες · νίκες · σερί · καλύτερο",
      "share.won": "Νίκη στον γύρο {t}", "share.lost": "Ήττα στον γύρο {t}",
      "toast.dailyGone": "Η μάχη της ημέρας θέλει το αρχείο gamekit: φόρτωσε ξανά το orOS",
      "toast.copied": "Αντιγράφηκε: επικόλλησέ το σε μια συνομιλία", "toast.shared": "Κοινοποιήθηκε",
      "toast.copyFail": "Δεν αντιγράφηκε",
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

  // days (5.64.00, older data has none): one Daily battle per calendar
  // day (day 0 = 1 Jan 2026, gamekit/daily.js), one try:
  // { "<day>": { b, w: 1 won | 0 lost, t: own turns, k: own Keep left } }.
  // The newer epoch wins; equal epochs keep the better result (won,
  // then fewer turns, then more Keep: a total order, so a join).
  // last (5.66.00): the last LAST_N battles on all devices, newest first:
  // [{ a: end time (ms), m: e|m|h computer, p two players, d Daily,
  //    r March, w: 1 Blue won | 0, t: turn, s: battle code, k: [deck, deck] }]
  // A union by (a, s), newest LAST_N kept, from br on. c (5.67.00,
  // optional): [code | "", code | ""], a side's own deck by its share code.
  // pz (5.67.00): solved puzzles { "<1…PUZZLE_N>": b }, a per-key max
  // epoch, from br on.
  // decks (5.67.00): own decks { "<id>": { n: name, c: share code, m: changed (ms) }
  // | { m, x: 1 } removed }; the later m wins (equal: the larger JSON),
  // the newest DECKS_KEEP entries kept. Records' reset leaves decks.
  function defaultData() { return { ver: DATA_VER, br: 0, rows: {}, days: {}, last: [], pz: {}, decks: {} }; }
  var PUZZLE_N = 20, DECKS_MAX = 12, DECKS_KEEP = 60, NAME_MAX = 24;
  function cleanName(n) {
    return typeof n === "string" ? n.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, NAME_MAX) : "";
  }
  function deckIdOk(id) { return /^[a-z0-9]{4,24}$/.test(id); }
  function normDeck(v) {
    if (!v || typeof v !== "object" || !isInt(v.m) || v.m <= 0 || v.m > 1e13) return null;
    if (v.x === 1) return { m: v.m, x: 1 };
    var n = cleanName(v.n);
    if (!n || typeof v.c !== "string" || !E.deckFromCode(v.c)) return null;
    return { n: n, c: E.deckCode(E.deckFromCode(v.c)), m: v.m };
  }
  function codeOk(c) { return c === "" || (typeof c === "string" && !!E.deckFromCode(c) && E.deckCode(E.deckFromCode(c)) === c); }
  function normLast(v) {
    if (!v || typeof v !== "object" || !isInt(v.a) || v.a <= 0 || v.a > 1e13 || ["e", "m", "h", "p", "d", "r"].indexOf(v.m) < 0 ||
        (v.w !== 0 && v.w !== 1) || !isInt(v.t) || v.t < 1 || v.t > MAX_TURNS || typeof v.s !== "string" || !/^[a-z0-9]{1,16}$/.test(v.s) ||
        !Array.isArray(v.k) || v.k.length !== 2 || v.k.some(function (d) { return E.DECK_IDS.indexOf(d) < 0; })) return null;
    var out = { a: v.a, m: v.m, w: v.w, t: v.t, s: v.s, k: [v.k[0], v.k[1]] };
    if (v.c !== undefined) {
      if (!Array.isArray(v.c) || v.c.length !== 2 || !v.c.every(codeOk)) return null;
      if (v.c[0] || v.c[1]) out.c = [v.c[0], v.c[1]];
    }
    return out;
  }
  function normDay(v) {
    if (!v || typeof v !== "object" || !isInt(v.b) || v.b < 0 || (v.w !== 0 && v.w !== 1) ||
        !isInt(v.t) || v.t < 1 || v.t > MAX_TURNS || !isInt(v.k) || v.k < 0 || v.k > E.KEEP_HP || (v.w === 1 && v.k < 1)) return null;
    return { b: v.b, w: v.w, t: v.t, k: v.k };
  }
  function dayKeyOk(k) { return /^\d{1,6}$/.test(k) && +k <= MAX_DAY; }
  function dayBetter(a, c) {
    if (a.w !== c.w) return a.w > c.w;
    if (a.t !== c.t) return a.t < c.t;
    return a.k > c.k;
  }
  function normRow(row) {
    if (!row || typeof row !== "object" || !isInt(row.b) || row.b < 0) return null;
    var s = {}, any = false;
    ROW_KEYS.forEach(function (k) {
      var v = row.s && row.s[k];
      if (Array.isArray(v) && v.length === 2 && v.every(function (x) { return isInt(x) && x >= 0; }) &&
          (k === "a" ? v[0] >= 1 && v[1] <= MARCH_N : v[1] <= v[0]) && (k !== "p" || v[1] === 0)) {
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
        // the same battle twice: keep one, by a fixed order
        if (!seen[key] || cmpStr(JSON.stringify(v), JSON.stringify(seen[key])) > 0) seen[key] = v;
      });
    });
    Object.keys(seen).forEach(function (k) { last.push(seen[k]); });
    last.sort(function (x, y) { return (y.a - x.a) || cmpStr(x.s, y.s) || cmpStr(JSON.stringify(x), JSON.stringify(y)); });
    var pz = {};
    [a.pz, b.pz].forEach(function (m) {
      if (!m || typeof m !== "object" || Array.isArray(m)) return;
      Object.keys(m).forEach(function (k) {
        if (!/^\d{1,2}$/.test(k) || +k < 1 || +k > PUZZLE_N || !isInt(m[k]) || m[k] < br) return;
        if (pz[+k] === undefined || m[k] > pz[+k]) pz[+k] = m[k];
      });
    });
    var spz = {};
    Object.keys(pz).map(Number).sort(function (x, y) { return x - y; }).forEach(function (k) { spz[k] = pz[k]; });
    var dk = {};
    [a.decks, b.decks].forEach(function (m) {
      if (!m || typeof m !== "object" || Array.isArray(m)) return;
      Object.keys(m).forEach(function (id) {
        if (!deckIdOk(id)) return;
        var v = normDeck(m[id]);
        if (!v) return;
        var cur = dk[id];
        if (!cur || v.m > cur.m || (v.m === cur.m && cmpStr(JSON.stringify(v), JSON.stringify(cur)) > 0)) dk[id] = v;
      });
    });
    var ids = Object.keys(dk).sort(function (x, y) { return (dk[y].m - dk[x].m) || cmpStr(x, y); }).slice(0, DECKS_KEEP).sort(cmpStr);
    var sdk = {};
    ids.forEach(function (id) { sdk[id] = dk[id]; });
    return { ver: DATA_VER, br: br, rows: sorted, days: sd, last: last.slice(0, LAST_N), pz: spz, decks: sdk };
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
    if (game && (game.opts.day !== undefined || game.opts.march !== undefined || game.opts.puzzle !== undefined)) return;   // Daily: days; March: its own row; puzzles: pz
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
        if (DECK_CHOICES.indexOf(p.d0) >= 0 || ownChoice(p.d0)) prefs.d0 = p.d0;
        if (DECK_CHOICES.indexOf(p.d1) >= 0 || ownChoice(p.d1)) prefs.d1 = p.d1;
        prefs.tour = p.tour === true;
      }
    } catch (e) {}
  }
  function savePrefs() {
    try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch (e) {}
  }

  // game = {
  //   g: engine state,
  //   opts: { mode: "ai" | "hot", lv: e|m|h (computer), seed, d: [deck choice, deck choice] (r = random),
  //           day: the Daily battle's day (absent in a free battle),
  //           march: the March battle's number 0…7 (its deck is in oros-banner-march),
  //           own: [code | "", code | ""] a side's own deck by its share code (5.67.00),
  //           puzzle: the puzzle's number 1…PUZZLE_N, seed "pz<n>" (5.67.00) },
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
    if (o.day !== undefined && (!isInt(o.day) || o.day < 0 || o.day > MAX_DAY || o.mode !== "ai" || o.lv !== DAILY_LV)) return false;
    if (o.march !== undefined && (!isInt(o.march) || o.march < 0 || o.march >= MARCH_N || o.mode !== "ai" || o.day !== undefined)) return false;
    if (o.own !== undefined && (!Array.isArray(o.own) || o.own.length !== 2 || !o.own.every(codeOk) || o.day !== undefined || o.march !== undefined)) return false;
    if (o.puzzle !== undefined && (!isInt(o.puzzle) || o.puzzle < 1 || o.puzzle > PUZ.length || o.mode !== "ai" ||
        o.seed !== "pz" + o.puzzle || o.day !== undefined || o.march !== undefined || o.own !== undefined || s.g.side !== 0)) return false;
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
  // Under way once the person made a move (the computer's opening
  // moves alone do not count), like gamekit/resume.js.
  function inProgressOf(g) {
    return !!(g && !g.done && g.g.over < 0 && g.opts.puzzle === undefined && (g.me === undefined ? g.g.n > 0 : g.me === true));
  }
  function deckOf(choice, seed, side) {
    if (E.DECK_IDS.indexOf(choice) >= 0) return choice;
    return E.DECK_IDS[E.hashStr("banner:" + seed + ":deckpick:" + side) % E.DECK_IDS.length];
  }
  function makeGame(opts) {
    var o = { mode: opts.mode === "hot" ? "hot" : "ai", seed: opts.seed, d: [opts.d[0], opts.d[1]] };
    if (o.mode === "ai") o.lv = E.LEVELS.indexOf(opts.lv) >= 0 ? opts.lv : "m";
    if (opts.day !== undefined) o.day = opts.day;
    if (opts.march !== undefined) o.march = opts.march;
    if (opts.puzzle !== undefined) {
      o.puzzle = opts.puzzle;
      return { g: E.puzzleBattle(PUZ[o.puzzle - 1], o.puzzle), opts: o, counted: false, done: false, pass: false, me: false };
    }
    var lists = opts.list ? [opts.list, null] : null;
    if (opts.own && (opts.own[0] || opts.own[1])) {
      o.own = [opts.own[0] || "", opts.own[1] || ""];
      lists = [E.deckFromCode(o.own[0]), E.deckFromCode(o.own[1])];
    }
    var g = E.newBattle(o.seed, [deckOf(o.d[0], o.seed, 0), deckOf(o.d[1], o.seed, 1)], undefined, lists);
    return { g: g, opts: o, counted: false, done: false, pass: o.mode === "hot", me: false };
  }
  function aiSide() { return game && game.opts.mode === "ai" ? 1 : -1; }
  function humanTurn() { return !!(game && !game.done && st.over < 0 && st.side !== aiSide() && !game.pass); }
  // The hand on screen: the person's (Blue) against the computer, the
  // side to play with two players.
  function shownSide() { return game.opts.mode === "ai" ? 0 : st.side; }

  function startGame(opts) {
    stopAI();
    leaveDaily();
    leaveMarch();
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
    if (a.t === "end" && game.opts.puzzle !== undefined) { puzzleFail(); return true; }
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
    if (!game.counted && game.opts.puzzle !== undefined) {
      game.counted = true;
      if (st.over === 0) solvePuzzle(game.opts.puzzle);
    } else if (!game.counted) {
      game.counted = true;
      count(rowKey(), game.opts.mode === "ai" && st.over === 0);
      if (game.opts.day !== undefined) countDaily(game.opts.day, st.over === 0, st.rt[0], st.keep[0]);
      logBattle();
      if (game.opts.march !== undefined) marchResult(st.over === 0);
    }
    game.done = true;
    saveSession();
    sfx(game.opts.mode === "ai" && st.over !== 0 ? "end" : "win");
    renderAll();
    setTimeout(endDialog, 500);
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
    var dly = game.opts.day !== undefined;
    var db = $("daily-btn");
    db.hidden = !DK;
    db.classList.toggle("due", !!DK && !data.days[today()]);
    db.classList.toggle("on", dly && !game.done);
    var mch = game.opts.march !== undefined, pzl = game.opts.puzzle !== undefined;
    $("tag").hidden = !dly && !mch && !pzl;
    $("tag").textContent = dly ? t("daily.tag", { n: game.opts.day + 1 }) : (mch ? t("march.tag", { n: game.opts.march + 1, m: MARCH_N }) :
      (pzl ? t("pz.tag", { n: game.opts.puzzle }) : ""));
    $("puzzle-btn").classList.toggle("on", pzl && !game.done);
    $("march-btn").classList.toggle("on", !!(march && !march.over));
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
  // A side's deck: a ready-made one, Random, or one of the own decks
  // (the list under it, when there are any).
  function deckField(label, cur, onPick) {
    var own = ownChoice(cur);
    function noteOf(v) { return ownChoice(v) ? t("dk.cardsOwn") : t("deck." + deckKey(v) + ".note"); }
    var note = el("div", "dlg-note", noteOf(cur));
    var f = segField(label, DECK_CHOICES, own ? "" : cur, "", function (v) {
      if (sel) sel.value = "";
      onPick(v);
      note.textContent = noteOf(v);
    });
    [].forEach.call(f.querySelectorAll(".seg-btn"), function (b, n) { b.textContent = t("deck." + deckKey(DECK_CHOICES[n])); });
    var ids = ownIds(), sel = null;
    if (ids.length) {
      sel = el("select", "dlg-select");
      sel.setAttribute("aria-label", t("dk.pick", { s: label }));
      sel.appendChild(el("option", "", t("dk.pickNone")));
      sel.lastChild.value = "";
      ids.forEach(function (id) { var o = el("option", "", data.decks[id].n); o.value = "o:" + id; sel.appendChild(o); });
      sel.value = own ? cur : "";
      sel.addEventListener("change", function () {
        var v = sel.value || "r";
        [].forEach.call(f.querySelectorAll(".seg-btn"), function (b, n) {
          var on = !sel.value && DECK_CHOICES[n] === "r";
          b.classList.toggle("active", on);
          b.setAttribute("aria-pressed", on ? "true" : "false");
        });
        onPick(v);
        note.textContent = noteOf(v);
      });
      f.appendChild(sel);
    }
    f.appendChild(note);
    return f;
  }
  // [deck choices for the engine, own codes] from two picks.
  function pickDecks(d0, d1) {
    var d = [d0, d1], own = ["", ""];
    [0, 1].forEach(function (s) { var o = ownChoice(d[s]); if (o) { own[s] = o.c; d[s] = "r"; } else if (DECK_CHOICES.indexOf(d[s]) < 0) d[s] = "r"; });
    return { d: d, own: own[0] || own[1] ? own : null };
  }

  function newDialog() {
    cancelTourWait();
    if (guardLeave(newDialog)) return;
    var o = { mode: prefs.mode, lv: prefs.lv, d0: ownChoice(prefs.d0) || DECK_CHOICES.indexOf(prefs.d0) >= 0 ? prefs.d0 : "r",
      d1: ownChoice(prefs.d1) || DECK_CHOICES.indexOf(prefs.d1) >= 0 ? prefs.d1 : "r" };
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
      var pk = pickDecks(o.d0, o.d1);
      startGame({ mode: o.mode, lv: o.lv, seed: cleanSeed(seed.value) || newSeed(), d: pk.d, own: pk.own });
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
      startGame({ mode: game.opts.mode, lv: game.opts.lv, seed: game.opts.seed, d: game.opts.d, own: game.opts.own });
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
    var ds = dailyStats(today());
    if (ds.n) empty = false;
    dlg.appendChild(el("div", "dlg-sub", t("stats.daily") + " · " + t("stats.dailyRow")));
    dlg.appendChild(row(t("daily.label"), ds.n ? ds.n + " · " + ds.w + " · " + ds.cur + " · " + ds.best : "–"));
    var mt = totals("a");
    if (mt[0]) empty = false;
    dlg.appendChild(el("div", "dlg-sub", t("stats.march") + " · " + t("stats.marchRow")));
    dlg.appendChild(row(t("march.title"), mt[0] ? mt[0] + " · " + bestMarch() + "/" + MARCH_N : "–"));
    if ((data.last || []).length) empty = false;
    lastBattles(dlg);
    var solved = Object.keys(data.pz).length;
    if (solved) empty = false;
    dlg.appendChild(el("div", "dlg-sub", t("pz.title")));
    dlg.appendChild(row(t("pz.title"), solved + " / " + PUZ.length));
    if (game && game.opts.day === undefined && game.opts.puzzle === undefined) dlg.appendChild(el("div", "dlg-note", t("stats.code", { seed: game.opts.seed })));
    var acts = el("div", "dlg-actions wrap");
    hubLink(acts, dlg);
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
  // ---------- Daily battle ----------
  function today() { return DK ? DK.today() : 0; }
  function dailyOpts(day) { return { mode: "ai", lv: DAILY_LV, seed: cleanSeed(DK.seedOf("banner", day)), d: ["r", "r"], day: day }; }
  // Daily results: battles played and won, the current and best streak
  // of won days.
  function dailyStats(todayIdx) {
    var on = {}, n = 0, w = 0;
    Object.keys(data.days).forEach(function (k) {
      n++;
      if (data.days[k].w) { on[k] = true; w++; }
    });
    var s2 = DK ? DK.streaks(on, todayIdx) : { cur: 0, best: 0 };
    return { n: n, w: w, cur: s2.cur, best: s2.best };
  }
  function clampInt(v, lo, hi) { return Math.max(lo, Math.min(hi, Math.round(v) || lo)); }
  // One try a day: the first result counts.
  function countDaily(day, won, turns, keep) {
    if (data.days[day] && data.days[day].b >= data.br) return;
    data.days[day] = { b: data.br, w: won ? 1 : 0, t: clampInt(turns, 1, MAX_TURNS), k: won ? clampInt(keep, 1, E.KEEP_HP) : clampInt(keep, 0, E.KEEP_HP) };
    data = mergeBanner(data, data);
    save();
  }
  // A Daily battle left before its end counts as lost where it was.
  function leaveDaily() {
    if (game && game.opts.day !== undefined && st && inProgressOf(game)) {
      countDaily(game.opts.day, false, st.rt[0], st.keep[0]);
      game.done = true;
      game.counted = true;
      stopAI();
    }
  }
  // The Daily button: today's result when it is played (here or on
  // another device), else today's battle (resumed when it is open).
  function openDaily() {
    if (!DK) { showToast(t("toast.dailyGone")); return; }
    var d = today();
    if (data.days[d]) { dailyDialog(d); return; }
    if (game && game.opts.day === d && !game.done) return;
    if (guardLeave(openDaily)) return;
    startGame(dailyOpts(d));
    showToast(t("daily.rules"));
    live(t("daily.rules"));
  }
  function dailyDialog(day) {
    var r = data.days[day];
    if (!r || !DK || document.querySelector("dialog[open]")) return;
    var s2 = dailyStats(today());
    var dlg = makeDialog("bn-daily");
    dlg.appendChild(el("div", "dlg-title", t("daily.title", { n: day + 1 }) + " · " + DK.dateLabel(day, LANG)));
    dlg.appendChild(el("div", "dlg-hero" + (r.w ? "" : " lost"), r.w ? t("daily.won", { t: r.t }) : t("daily.lost", { t: r.t })));
    dlg.appendChild(row(t("daily.keep"), r.k + " / " + E.KEEP_HP));
    dlg.appendChild(row(t("daily.streak"), String(s2.cur)));
    dlg.appendChild(row(t("daily.best"), String(s2.best)));
    if (day === today()) dlg.appendChild(el("div", "dlg-note", t("daily.oneTry") + " " + t("daily.next")));
    var acts = el("div", "dlg-actions wrap");
    hubLink(acts, dlg);
    acts.appendChild(button(t("daily.share"), "", function () { shareDaily(day); }));
    var free = button(t("daily.free"), "primary", function () { dlg.close(); newDialog(); });
    acts.appendChild(free);
    dlg.appendChild(acts);
    document.body.appendChild(dlg);
    dlg.showModal();
    free.focus();
  }
  // Spoiler-free: won or not, the own Keep as five squares (3 Health
  // each) and the turns. Never the board, the decks or the plays.
  function shareDaily(day) {
    var r = data.days[day];
    if (!r || !DK) return;
    var sq = "", full = Math.ceil(r.k / 3);
    for (var k = 0; k < 5; k++) sq += k < full ? "🟦" : "⬜";
    var text = DK.shareText({ game: t("app.name"), label: t("daily.label"), day: day, grid: [sq],
      line: (r.w ? "🏰 " + t("share.won", { t: r.t }) : "💥 " + t("share.lost", { t: r.t })) });
    DK.share(text, "orOS " + t("app.name")).then(function (how) {
      if (how === "copied") showToast(t("toast.copied"));
      else if (how === "shared") live(t("toast.shared"));
      else if (how === "failed") showToast(t("toast.copyFail"));
    });
  }
  // "All games" (the Game Center), only when it is installed.
  function hubLink(acts, dlg) {
    if (!DK || !DK.hasHub()) return;
    acts.appendChild(button(t("daily.games"), "", function () { dlg.close(); DK.openHub("banner"); }));
  }

  // A battle of the Daily or of a March under way: leaving it asks
  // first (it ends that try). Returns true when it asked.
  function guardLeave(then) {
    if (!game || !inProgressOf(game)) return false;
    if (game.opts.day !== undefined) {
      confirmDialog(t("daily.leave"), function () { leaveDaily(); saveSession(); renderAll(); then(); }, t("daily.leaveYes"), t("daily.leaveNo"));
      return true;
    }
    if (game.opts.march !== undefined) {
      confirmDialog(t("march.leave"), function () { leaveMarch(); saveSession(); renderAll(); then(); }, t("march.leaveYes"), t("march.leaveNo"));
      return true;
    }
    return false;
  }
  // The end of a battle: the Daily result, the March step, or the result.
  function endDialog() {
    if (!game) return;
    if (game.opts.day !== undefined) dailyDialog(game.opts.day);
    else if (game.opts.march !== undefined) marchDialog();
    else if (game.opts.puzzle !== undefined) puzzleDone();
    else resultDialog();
  }

  // ---------- Last battles ----------
  // A battle ended: into Last battles (once per battle).
  function logBattle() {
    var m = game.opts.day !== undefined ? "d" : (game.opts.march !== undefined ? "r" : (game.opts.mode === "hot" ? "p" : game.opts.lv));
    var v = normLast({ a: Date.now(), m: m, w: st.over === 0 ? 1 : 0, t: Math.max(1, st.rt[0]), s: game.opts.seed, k: st.decks.slice(),
      c: game.opts.own ? game.opts.own.slice() : undefined });
    if (!v) return;
    data.last = [v].concat(data.last || []);
    data = mergeBanner(data, data);
    save();
  }
  // A side's deck in Last battles: its ready-made deck, or the name of
  // the own deck with that code (else "Own deck").
  function deckLabel(v, s) {
    var c = v.c && v.c[s];
    if (!c) return t("deck." + v.k[s]);
    var id = ownByCode(c);
    return id ? data.decks[id].n : t("deck.own");
  }
  // Records › Last battles: how each ended, with its code to replay (a
  // March battle replays with the starting deck, as a free battle).
  function lastBattles(dlg) {
    var list = data.last || [];
    if (!list.length) return;
    dlg.appendChild(el("div", "dlg-sub", t("last.title")));
    var box = el("div", "lr-list");
    list.forEach(function (v) {
      var r = el("div", "lr-row");
      var tx = el("div", "lr-tx");
      var kind = v.m === "p" ? t("mode.hot") : v.m === "d" ? t("daily.label") : v.m === "r" ? t("march.title") : t("lv." + v.m);
      var what = v.m === "p" ? t("last.hot", { s: sideName(v.w ? 0 : 1) }) : t(v.w ? "last.won" : "last.lost");
      tx.appendChild(el("div", "nm", kind + " · " + what + " · " + t("last.turn", { n: v.t })));
      tx.appendChild(el("div", "fx", (DK ? DK.dateLabel(DK.dayIndex(new Date(v.a)), LANG) + " · " : "") +
        deckLabel(v, 0) + " · " + deckLabel(v, 1) + " · " + v.s));
      r.appendChild(tx);
      var b = button(t("last.replay"), "", function () {
        dlg.close();
        var go = function () {
          startGame({ mode: v.m === "p" ? "hot" : "ai", lv: E.LEVELS.indexOf(v.m) >= 0 ? v.m : "m", seed: v.s, d: v.k.slice(), own: v.c ? v.c.slice() : null });
        };
        if (!guardLeave(go)) go();
      });
      b.setAttribute("aria-label", t("last.replayLabel", { seed: v.s }));
      r.appendChild(b);
      box.appendChild(r);
    });
    dlg.appendChild(box);
  }

  // ---------- Puzzles ----------
  // banner/puzzles.js: PUZZLE_N "win this turn" positions. Ending the
  // turn is a failed try (nothing is counted); breaking the Keep marks
  // the puzzle solved in pz (synced).
  var PUZ = (window.BannerPuzzles && window.BannerPuzzles.LIST) || [];
  function solvePuzzle(n) {
    if (data.pz[n] !== undefined && data.pz[n] >= data.br) return;
    data.pz[n] = data.br;
    data = mergeBanner(data, data);
    save();
  }
  function startPuzzle(n) {
    if (n < 1 || n > PUZ.length) return;
    startGame({ mode: "ai", lv: "m", seed: "pz" + n, d: ["iron", "iron"], puzzle: n });
    setMsg(t("pz.goal"));
  }
  function puzzlesDialog() {
    if (document.querySelector("dialog[open]")) return;
    var dlg = makeDialog("bn-puzzles");
    dlg.appendChild(el("div", "dlg-title", t("pz.title")));
    dlg.appendChild(el("div", "dlg-msg", t("pz.intro")));
    dlg.appendChild(el("div", "dlg-note", t("pz.solved", { n: Object.keys(data.pz).length, m: PUZ.length })));
    var grid = el("div", "pz-grid"), first = null;
    PUZ.forEach(function (p, j) {
      var n = j + 1, done = data.pz[n] !== undefined;
      var b = el("button", "pz-btn" + (done ? " done" : "") + (game && game.opts.puzzle === n && !game.done ? " now" : ""), String(n));
      b.type = "button";
      b.setAttribute("aria-label", t(done ? "pz.labelDone" : "pz.label", { n: n }));
      b.addEventListener("click", function () {
        dlg.close();
        var go = function () { startPuzzle(n); };
        if (!guardLeave(go)) go();
      });
      if (!first && !done) first = b;
      grid.appendChild(b);
    });
    dlg.appendChild(grid);
    var acts = el("div", "dlg-actions");
    var close = button(t("stats.close"), "", function () { dlg.close(); });
    acts.appendChild(close);
    dlg.appendChild(acts);
    document.body.appendChild(dlg);
    dlg.showModal();
    (first || close).focus();
  }
  function puzzleFail() {
    var n = game.opts.puzzle;
    sfx("end");
    var dlg = makeDialog("bn-pzfail");
    dlg.appendChild(el("div", "dlg-hero lost", t("pz.fail")));
    dlg.appendChild(el("div", "dlg-msg", t("pz.failNote")));
    var acts = el("div", "dlg-actions wrap");
    acts.appendChild(button(t("pz.all"), "", function () { dlg.close(); setTimeout(puzzlesDialog, 0); }));
    acts.appendChild(button(t("pz.back"), "", function () { dlg.close(); }));
    var again = button(t("pz.retry"), "primary", function () { dlg.close(); startPuzzle(n); });
    acts.appendChild(again);
    dlg.appendChild(acts);
    document.body.appendChild(dlg);
    dlg.showModal();
    again.focus();
  }
  function puzzleDone() {
    var n = game.opts.puzzle;
    var dlg = makeDialog("bn-pzdone");
    dlg.appendChild(el("div", "dlg-hero", t("pz.won", { n: n })));
    dlg.appendChild(el("div", "dlg-note", t("pz.solved", { n: Object.keys(data.pz).length, m: PUZ.length })));
    var acts = el("div", "dlg-actions wrap");
    acts.appendChild(button(t("pz.all"), "", function () { dlg.close(); setTimeout(puzzlesDialog, 0); }));
    var next = null;
    for (var k = 1; k <= PUZ.length && !next; k++) { var c = (n + k - 1) % PUZ.length + 1; if (data.pz[c] === undefined) next = c; }
    var go = button(next ? t("pz.next", { n: next }) : t("stats.close"), "primary", function () { dlg.close(); if (next) startPuzzle(next); });
    acts.appendChild(go);
    dlg.appendChild(acts);
    document.body.appendChild(dlg);
    dlg.showModal();
    go.focus();
  }

  // ---------- Own decks ----------
  // An own deck is chosen as "o:<id>" (prefs); a battle keeps its share
  // code (opts.own), so it plays the same even if the deck changes later.
  function ownIds() {
    return Object.keys(data.decks).filter(function (id) { return !data.decks[id].x; })
      .sort(function (x, y) { return cmpStr(data.decks[x].n.toLowerCase(), data.decks[y].n.toLowerCase()) || cmpStr(x, y); });
  }
  function ownChoice(v) {
    if (typeof v !== "string" || v.slice(0, 2) !== "o:") return null;
    var d = data && data.decks[v.slice(2)];
    return d && !d.x ? d : null;
  }
  function ownByCode(c) {
    var ids = ownIds();
    for (var k = 0; k < ids.length; k++) if (data.decks[ids[k]].c === c) return ids[k];
    return null;
  }
  function newDeckId() {
    var id;
    do { id = Date.now().toString(36) + Math.random().toString(36).slice(2, 8); } while (data.decks[id]);
    return id;
  }
  function putDeck(id, n, c) {
    data.decks[id] = { n: cleanName(n) || t("dk.defName", { n: ownIds().length + 1 }), c: c, m: Math.max(Date.now(), data.decks[id] ? data.decks[id].m + 1 : 0) };
    data = mergeBanner(data, data);
    save();
  }
  function dropDeck(id) {
    if (!data.decks[id]) return;
    data.decks[id] = { m: Math.max(Date.now(), data.decks[id].m + 1), x: 1 };
    data = mergeBanner(data, data);
    save();
  }
  function shareCode(code, name) {
    var text = name + ": " + code;
    if (DK && DK.share) {
      DK.share(text, "orOS " + t("app.name")).then(function (how) {
        if (how === "copied") showToast(t("dk.copied"));
        else if (how === "shared") live(t("toast.shared"));
        else if (how === "failed") showToast(t("toast.copyFail"));
      });
    } else if (navigator.clipboard) {
      navigator.clipboard.writeText(text).then(function () { showToast(t("dk.copied")); }, function () { showToast(t("toast.copyFail")); });
    } else showToast(t("toast.copyFail"));
  }
  function decksDialog() {
    if (document.querySelector("dialog[open]")) return;
    var dlg = makeDialog("bn-decks");
    dlg.appendChild(el("div", "dlg-title", t("dk.title")));
    var ids = ownIds();
    if (!ids.length) dlg.appendChild(el("div", "dlg-msg", t("dk.none")));
    var box = el("div", "lr-list");
    ids.forEach(function (id) {
      var d = data.decks[id];
      var r = el("div", "lr-row");
      var tx = el("div", "lr-tx");
      tx.appendChild(el("div", "nm", d.n));
      tx.appendChild(el("div", "fx", d.c));
      r.appendChild(tx);
      var cp = button(t("dk.share"), "", function () { shareCode(d.c, d.n); });
      cp.setAttribute("aria-label", t("dk.shareLabel", { n: d.n }));
      r.appendChild(cp);
      var ed = button(t("dk.edit"), "", function () { dlg.close(); deckEditor(id); });
      ed.setAttribute("aria-label", t("dk.editLabel", { n: d.n }));
      r.appendChild(ed);
      box.appendChild(r);
    });
    if (ids.length) dlg.appendChild(box);
    if (ids.length >= DECKS_MAX) dlg.appendChild(el("div", "dlg-note", t("dk.max", { n: DECKS_MAX })));
    var acts = el("div", "dlg-actions wrap");
    acts.appendChild(button(t("stats.close"), "", function () { dlg.close(); }));
    var add = button(t("dk.add"), "", function () { dlg.close(); importDialog(); });
    add.disabled = ids.length >= DECKS_MAX;
    acts.appendChild(add);
    var mk = button(t("dk.new"), "primary", function () { dlg.close(); deckEditor(null); });
    mk.disabled = ids.length >= DECKS_MAX;
    acts.appendChild(mk);
    dlg.appendChild(acts);
    document.body.appendChild(dlg);
    dlg.showModal();
    (mk.disabled ? acts.firstChild : mk).focus();
  }
  function nameField(cur) {
    var wrap = el("label", "dlg-field");
    wrap.appendChild(el("span", "dlg-label", t("dk.name")));
    var inp = el("input", "dlg-input");
    inp.type = "text";
    inp.maxLength = NAME_MAX;
    inp.autocomplete = "off";
    inp.value = cur || "";
    wrap.appendChild(inp);
    return { wrap: wrap, inp: inp };
  }
  function importDialog() {
    var dlg = makeDialog("bn-import");
    dlg.appendChild(el("div", "dlg-title", t("dk.add")));
    var wrap = el("label", "dlg-field");
    wrap.appendChild(el("span", "dlg-label", t("dk.codeAsk")));
    var inp = el("input", "dlg-input");
    inp.type = "text";
    inp.maxLength = 40;
    inp.autocomplete = "off";
    inp.spellcheck = false;
    wrap.appendChild(inp);
    dlg.appendChild(wrap);
    var nf = nameField("");
    dlg.appendChild(nf.wrap);
    var msg = el("div", "dlg-note", "");
    dlg.appendChild(msg);
    var acts = el("div", "dlg-actions");
    acts.appendChild(button(t("new.cancel"), "", function () { dlg.close(); decksDialog(); }));
    acts.appendChild(button(t("dk.addGo"), "primary", function () {
      // a shared line is "name: code"; the name is taken when none is typed
      var colon = inp.value.lastIndexOf(":");
      var list = E.deckFromCode(colon >= 0 ? inp.value.slice(colon + 1) : inp.value);
      var name = nf.inp.value.trim() || (colon > 0 ? inp.value.slice(0, colon) : "");
      if (!list) { msg.textContent = t("dk.bad"); inp.focus(); return; }
      var code = E.deckCode(list), have = ownByCode(code);
      dlg.close();
      if (have) { showToast(t("dk.have", { n: data.decks[have].n })); decksDialog(); return; }
      putDeck(newDeckId(), name, code);
      showToast(t("dk.added"));
      decksDialog();
    }));
    dlg.appendChild(acts);
    document.body.appendChild(dlg);
    dlg.showModal();
    inp.focus();
  }
  // The deck editor: every card with − and +; Save when the deck has
  // DECK_SIZE cards (at most COPY_MAX of each).
  function deckEditor(id) {
    var old = id ? data.decks[id] : null;
    var list = old ? E.deckFromCode(old.c) : E.deckList("iron");
    var dlg = makeDialog("bn-deck");
    dlg.setAttribute("data-modal", "1");
    dlg.appendChild(el("div", "dlg-title", old ? t("dk.editTitle") : t("dk.new")));
    var nf = nameField(old ? old.n : "");
    dlg.appendChild(nf.wrap);
    var head = el("div", "dk-head");
    var cnt = el("strong", "dk-count", "");
    head.appendChild(cnt);
    dlg.appendChild(head);
    var counts = {};
    function setList(l) { counts = {}; l.forEach(function (k) { counts[k] = (counts[k] || 0) + 1; }); }
    setList(list);
    if (!old) {
      var f = segField(t("dk.from"), E.DECK_IDS.concat(["0"]), "iron", "", function (v) { setList(v === "0" ? [] : E.deckList(v)); paint(); });
      [].forEach.call(f.querySelectorAll(".seg-btn"), function (b, n) { b.textContent = n < E.DECK_IDS.length ? t("deck." + E.DECK_IDS[n]) : t("dk.empty"); });
      dlg.appendChild(f);
    }
    var box = el("div", "dk-list"), rows = {};
    E.CODE_ORDER.forEach(function (k) {
      var c = E.card(k);
      var r = el("div", "dk-row");
      r.appendChild(el("span", "cost", String(c.c)));
      var tx = el("div", "lr-tx");
      tx.appendChild(el("div", "nm", cardName(k)));
      tx.appendChild(el("div", "fx", c.t === "u" ? t("unit.line", { c: c.c, a: c.atk, h: c.hp, m: c.mv }) + (c.kw ? " · " + t("kw." + c.kw).split(":")[0] : "") : t("tx." + k)));
      r.appendChild(tx);
      var minus = button("−", "dk-step", function () { if (counts[k]) { counts[k]--; paint(); } });
      minus.setAttribute("aria-label", t("dk.minus", { k: cardName(k) }));
      var n = el("span", "dk-n", "0");
      var plus = button("+", "dk-step", function () { counts[k] = (counts[k] || 0) + 1; paint(); });
      plus.setAttribute("aria-label", t("dk.plus", { k: cardName(k) }));
      r.appendChild(minus);
      r.appendChild(n);
      r.appendChild(plus);
      rows[k] = { r: r, n: n, minus: minus, plus: plus };
      box.appendChild(r);
    });
    dlg.appendChild(box);
    var note = el("div", "dlg-note", t("dk.need", { m: E.DECK_SIZE, c: E.COPY_MAX }));
    dlg.appendChild(note);
    var acts = el("div", "dlg-actions wrap");
    if (old) acts.appendChild(button(t("dk.del"), "danger", function () {
      dlg.close();
      confirmDialog(t("dk.delAsk", { n: old.n }), function () { dropDeck(id); showToast(t("dk.deleted")); decksDialog(); }, t("dk.del"));
    }));
    acts.appendChild(button(t("new.cancel"), "", function () { dlg.close(); decksDialog(); }));
    var saveB = button(t("dk.save"), "primary", function () {
      var l = cur();
      if (!E.deckOk(l)) return;
      dlg.close();
      putDeck(id || newDeckId(), nf.inp.value, E.deckCode(l));
      showToast(t("dk.saved"));
      decksDialog();
    });
    acts.appendChild(saveB);
    dlg.appendChild(acts);
    function cur() {
      var l = [];
      E.CODE_ORDER.forEach(function (k) { for (var j = 0; j < (counts[k] || 0); j++) l.push(k); });
      return l;
    }
    function paint() {
      var total = cur().length;
      cnt.textContent = t("dk.count", { n: total, m: E.DECK_SIZE });
      cnt.classList.toggle("ok", total === E.DECK_SIZE);
      E.CODE_ORDER.forEach(function (k) {
        var v = counts[k] || 0, x = rows[k];
        x.n.textContent = String(v);
        x.r.classList.toggle("in", v > 0);
        x.minus.disabled = !v;
        x.plus.disabled = v >= E.COPY_MAX || total >= E.DECK_SIZE;
      });
      saveB.disabled = !E.deckOk(cur());
    }
    paint();
    document.body.appendChild(dlg);
    dlg.showModal();
    nf.inp.focus();
  }

  // ---------- March ----------
  // march = { v: 1, seed, d: starting deck, list: [cards], n: battles won,
  //           over: bool, pick: [3 cards] | null (the choice after a win) }
  // Device-local (oros-banner-march, like the session); its end goes
  // into the "a" row: [marches, best].
  var march = null;
  function validMarch(m) {
    return !!(m && typeof m === "object" && m.v === 1 && typeof m.seed === "string" && /^[a-z0-9]{1,16}$/.test(m.seed) &&
      E.DECK_IDS.indexOf(m.d) >= 0 && E.listOk(m.list) && isInt(m.n) && m.n >= 0 && m.n <= MARCH_N && typeof m.over === "boolean" &&
      (m.pick === null || (Array.isArray(m.pick) && m.pick.length === 3 && m.pick.every(function (k) { return !!E.card(k); }))) &&
      (m.n < MARCH_N || m.over));
  }
  function loadMarch() {
    try { var m = JSON.parse(localStorage.getItem(MARCH_KEY) || "null"); march = validMarch(m) ? m : null; } catch (e) { march = null; }
  }
  function saveMarch() {
    try {
      if (march) localStorage.setItem(MARCH_KEY, JSON.stringify(march));
      else localStorage.removeItem(MARCH_KEY);
    } catch (e) { showToast(t("toast.save")); }
  }
  function bestMarch() {
    var best = 0;
    Object.keys(data.rows).forEach(function (id) { var v = data.rows[id].s.a; if (v && v[1] > best) best = v[1]; });
    return best;
  }
  // Battle n of the march: its code, the computer's deck and level.
  function marchLevel(n) { return n < 3 ? "e" : (n < 6 ? "m" : "h"); }
  function marchOpts(n) {
    var seed = cleanSeed(march.seed + "m" + n);
    var foe = E.DECK_IDS[E.hashStr("banner:" + seed + ":foe") % E.DECK_IDS.length];
    return { mode: "ai", lv: marchLevel(n), seed: seed, d: [march.d, foe], march: n, list: march.list };
  }
  // Three cards to choose from after a win, from the battle's code.
  var DRAFT = Object.keys(E.CARDS);
  function draftOf(n) {
    var h = E.hashStr("banner:" + march.seed + ":draft:" + n), out = [];
    for (var k = 0; out.length < 3 && k < 50; k++) {
      h = (Math.imul(h, 1103515245) + 12345) >>> 0;
      var c = DRAFT[h % DRAFT.length];
      if (out.indexOf(c) < 0) out.push(c);
    }
    return out;
  }
  function endMarch() {
    if (!march || march.over) return;
    march.over = true;
    march.pick = null;
    var row = data.rows[deviceId];
    if (!row || row.b < data.br) row = { b: data.br, s: {} };
    row = { b: row.b, s: JSON.parse(JSON.stringify(row.s)) };
    var v = row.s.a ? row.s.a.slice() : [0, 0];
    v[0]++;
    v[1] = Math.max(v[1], march.n);
    row.s.a = v;
    data.rows[deviceId] = row;
    data = mergeBanner(data, data);
    save();
    saveMarch();
  }
  function marchResult(won) {
    if (!march || march.over || game.opts.march !== march.n) return;
    if (won) {
      march.n++;
      if (march.n >= MARCH_N) endMarch();
      else { march.pick = draftOf(march.n); saveMarch(); }
    } else endMarch();
  }
  // A March battle left before its end counts as lost: the march ends.
  function leaveMarch() {
    if (game && game.opts.march !== undefined && st && inProgressOf(game)) {
      game.done = true;
      game.counted = true;
      stopAI();
      logBattle();
      marchResult(false);
    }
  }
  function startMarch(d) {
    march = { v: 1, seed: newSeed(), d: d, list: E.deckList(d), n: 0, over: false, pick: null };
    saveMarch();
    startGame(marchOpts(0));
  }
  function marchPath() {
    var path = el("div", "mp-path");
    for (var k = 0; k < MARCH_N; k++) {
      var cls = k < march.n ? "done" : (k === march.n && !march.over ? "now" : (march.over && k === march.n ? "lost" : ""));
      var dot = el("span", "mp-dot " + cls + " lv-" + marchLevel(k), String(k + 1));
      path.appendChild(dot);
    }
    return path;
  }
  function marchDialog() {
    if (document.querySelector("dialog[open]")) return;
    var dlg = makeDialog("bn-march");
    dlg.appendChild(el("div", "dlg-title", t("march.title")));
    var acts = el("div", "dlg-actions wrap");
    if (march && !march.over && march.pick) {
      // the choice after a win
      dlg.appendChild(el("div", "dlg-hero", t("march.pick")));
      dlg.appendChild(marchPath());
      var picks = el("div", "mp-picks");
      march.pick.forEach(function (k) {
        var c = E.card(k);
        var b = el("button", "mp-card");
        b.type = "button";
        b.appendChild(el("span", "cost", String(c.c)));
        b.appendChild(el("span", "nm", cardName(k)));
        b.appendChild(el("span", "tx", c.t === "u" ? t("unit.line", { c: c.c, a: c.atk, h: c.hp, m: c.mv }) + (c.kw ? " · " + t("kw." + c.kw) : "") : t("tx." + k)));
        b.setAttribute("aria-label", t("march.add", { k: cardName(k) }));
        b.addEventListener("click", function () {
          if (march.list.length < E.MARCH_MAX) march.list.push(k);
          march.pick = null; saveMarch(); dlg.close(); marchDialog();
        });
        picks.appendChild(b);
      });
      dlg.appendChild(picks);
      dlg.appendChild(el("div", "dlg-note", t("march.pickNote", { n: march.list.length })));
      if (march.list.length > E.MARCH_MIN) acts.appendChild(button(t("march.remove"), "", function () { dlg.close(); removeDialog(); }));
      acts.appendChild(button(t("march.skip"), "", function () { march.pick = null; saveMarch(); dlg.close(); marchDialog(); }));
    } else if (march && !march.over) {
      var n = march.n, o = marchOpts(n);
      dlg.appendChild(el("div", "dlg-sub", t("march.next", { n: n + 1, m: MARCH_N })));
      dlg.appendChild(marchPath());
      dlg.appendChild(row(t("deck." + march.d), t("march.cards", { n: march.list.length })));
      dlg.appendChild(el("div", "dlg-note", t("march.foe", { d: t("deck." + o.d[1]), lv: t("lv." + o.lv) })));
      acts.appendChild(button(t("march.giveUp"), "danger", function () {
        dlg.close();
        confirmDialog(t("march.giveUpAsk"), function () { leaveMarch(); endMarch(); saveSession(); renderAll(); marchDialog(); });
      }));
      var here = game && game.opts.march === n && !game.done;
      var go = button(here ? t("march.resume") : t("march.go"), "primary", function () {
        dlg.close();
        if (here) return;
        var fight = function () { startGame(marchOpts(march.n)); };
        if (!guardLeave(fight)) fight();
      });
      acts.appendChild(go);
    } else {
      if (march && march.over) {
        dlg.appendChild(el("div", "dlg-hero" + (march.n >= MARCH_N ? "" : " lost"), march.n >= MARCH_N ? t("march.won", { m: MARCH_N }) : t("march.lost", { n: march.n, m: MARCH_N })));
        dlg.appendChild(marchPath());
      }
      dlg.appendChild(el("div", "dlg-msg", t("march.intro")));
      var b0 = bestMarch();
      dlg.appendChild(row(t("stats.march"), totals("a")[0] ? t("march.best", { n: b0, m: MARCH_N }) : t("march.none")));
      var pickD = { d: E.DECK_IDS.indexOf(prefs.d0) >= 0 ? prefs.d0 : "iron" };
      var f = segField(t("march.deck"), E.DECK_IDS, pickD.d, "", function (v) { pickD.d = v; note.textContent = t("deck." + v + ".note"); });
      [].forEach.call(f.querySelectorAll(".seg-btn"), function (b, i) { b.textContent = t("deck." + E.DECK_IDS[i]); });
      var note = el("div", "dlg-note", t("deck." + pickD.d + ".note"));
      f.appendChild(note);
      dlg.appendChild(f);
      acts.appendChild(button(t("stats.close"), "", function () { dlg.close(); }));
      acts.appendChild(button(t("march.start"), "primary", function () {
        dlg.close();
        var begin = function () { startMarch(pickD.d); };
        if (!guardLeave(begin)) begin();
      }));
    }
    dlg.appendChild(acts);
    document.body.appendChild(dlg);
    dlg.showModal();
    var p = dlg.querySelector(".mp-card, .dlg-btn.primary");
    if (p) p.focus();
  }
  function removeDialog() {
    var dlg = makeDialog("bn-remove");
    dlg.appendChild(el("div", "dlg-title", t("march.removeTitle")));
    dlg.appendChild(el("div", "dlg-note", t("march.cards", { n: march.list.length })));
    var counts = {};
    march.list.forEach(function (k) { counts[k] = (counts[k] || 0) + 1; });
    var box = el("div", "lr-list");
    Object.keys(counts).sort(function (x, y) { return (E.card(x).c - E.card(y).c) || cmpStr(cardName(x), cardName(y)); }).forEach(function (k) {
      var r = el("div", "lr-row");
      var tx = el("div", "lr-tx");
      tx.appendChild(el("div", "nm", cardName(k) + " × " + counts[k]));
      r.appendChild(tx);
      var b = button("−", "", function () {
        march.list.splice(march.list.indexOf(k), 1);
        march.pick = null; saveMarch(); dlg.close(); marchDialog();
      });
      b.setAttribute("aria-label", t("march.drop", { k: cardName(k), n: counts[k] }));
      r.appendChild(b);
      box.appendChild(r);
    });
    dlg.appendChild(box);
    var acts = el("div", "dlg-actions");
    acts.appendChild(button(t("new.cancel"), "", function () { dlg.close(); marchDialog(); }));
    dlg.appendChild(acts);
    document.body.appendChild(dlg);
    dlg.showModal();
  }

  function confirmDialog(msg, onYes, yesLabel, noLabel) {
    var dlg = makeDialog("bn-confirm");
    dlg.appendChild(el("div", "dlg-msg", msg));
    var acts = el("div", "dlg-actions");
    var no = button(noLabel || t("confirm.no"), "", function () { dlg.close(); });
    acts.appendChild(no);
    acts.appendChild(button(yesLabel || t("confirm.yes"), "danger", function () { dlg.close(); onYes(); }));
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
    daily:  SVG + '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 10h18"/><path d="M9 20v-6l3 1.5L9 17"/></svg>',
    march:  SVG + '<path d="M4 21V4"/><path d="M4 4h9l-1.5 3L13 10H4"/><path d="M14 21l3-6 3 6M15 19h4"/></svg>',
    puzzle: SVG + '<path d="M10 3h4v3a2 2 0 1 0 4 0V3h3v7h-3a2 2 0 1 0 0 4h3v7h-7v-3a2 2 0 1 0-4 0v3H3v-7h3a2 2 0 1 0 0-4H3V3z"/></svg>',
    decks:  SVG + '<rect x="7" y="3" width="13" height="16" rx="2"/><path d="M4 7v12a2 2 0 0 0 2 2h10"/><path d="M11 9h5M11 13h5"/></svg>',
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
    [["new-btn", "new", "btn.new"], ["undo-btn", "undo", "btn.undo"], ["daily-btn", "daily", "btn.daily"], ["march-btn", "march", "btn.march"],
     ["puzzle-btn", "puzzle", "btn.puzzles"], ["decks-btn", "decks", "btn.decks"], ["stats-btn", "stats", "btn.stats"]].forEach(function (x) {
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
    $("daily-btn").addEventListener("click", openDaily);
    $("march-btn").addEventListener("click", marchDialog);
    $("puzzle-btn").addEventListener("click", puzzlesDialog);
    $("decks-btn").addEventListener("click", decksDialog);
    // Deep link from the Game Center: { daily: true } opens today's battle.
    window.__orosOpenAt = function (tg) { if (tg && tg.daily) openDaily(); };
    $("sfx-btn").addEventListener("click", function () {
      try { localStorage.setItem(SFX_KEY, sfxOn() ? "0" : "1"); } catch (e) {}
      paintSfxBtn();
      sfx("play");
    });
    wireInput();
    wireKeyboard();
    window.addEventListener("resize", resize);
    // Save on the way out (R10 session).
    document.addEventListener("visibilitychange", function () {
      if (document.hidden && game) saveSession();
      if (!document.hidden && game) renderStatus();   // the Daily dot after midnight
    });
    window.addEventListener("pagehide", function () { if (game) saveSession(); });
  }

  function boot() {
    canvas = $("board");
    ctx = canvas.getContext("2d");
    load();
    ensureDeviceId();
    loadPrefs();
    loadMarch();
    applyI18n();
    paintStatic();
    wire();
    registerSync();
    inheritPalette();
    watchPalette();
    game = loadSession();
    var tg = DK ? DK.takeTarget("banner") : null;
    var daily = !!(tg && tg.daily && DK);
    if (daily && !data.days[today()] && !(game && game.opts.day === today() && !game.done)) {
      if (!game || !inProgressOf(game)) { game = makeGame(dailyOpts(today())); daily = false; }
    }
    if (!game) game = makeGame({ mode: prefs.mode, lv: prefs.lv, seed: newSeed(), d: [prefs.d0, prefs.d1] });
    st = game.g;
    saveSession();
    resize();
    renderAll();
    if (daily) setTimeout(openDaily, 300);
    else if (st.over >= 0) setTimeout(endDialog, 300);
    else {
      maybeTour();
      if (st.side === aiSide()) runAI();
      else if (game.pass && prefs.tour) setTimeout(passDialog, 300);
    }
  }

  boot();
})();
