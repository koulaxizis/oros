// ============================================================
// orOS Wayfarers — App logic (v1.0.0)
// A turn-based party RPG: pick three of six classes, walk a branching
// path map (fights, camps, markets, events) to the region's guardian,
// and win fights by making the heroes work together. Every foe shows
// its next move. The rules live in wayfarers/engine.js
// (WayfarersEngine, tested headless), the tables in wayfarers/data.js;
// this file is the screen.
//   - Gentle (20 % more Health, fallen heroes stand up after each
//     fight, a phoenix feather to start) or Hardy (fallen heroes stand
//     up only at a camp)
//   - every journey has a code; the same code is the same land
//   - map: tap a lit stop (or arrow keys + Enter)
//   - fight: tap an action, then a lit target; skills with no target
//     (and a second tap) act at once; a long press shows a unit's text
//   - a short "How to play" on the first journey
// Data:
//   - synced slice "wayfarers" (oros-wayfarers-data): journeys, wins
//     and the best region cleared per difficulty, and wins per class,
//     as per-device counter rows (each device only grows its own row;
//     merge = per-row max, a join) + reset stamp br (as Realm, Crypt
//     and Banner)
//   - device-local (R10): oros-wayfarers-prefs (difficulty, party,
//     tour seen, fast), oros-wayfarers-session (the journey in
//     progress), oros-wayfarers-device (counter row id),
//     oros-wayfarers-sfx (sound)
// Sections:
//   1. Constants, i18n, helpers
//   2. Synced records: load / save / normalize / merge (R5, R26)
//   3. Device-local prefs + session
//   4. Journey flow (new, act, events, end)
//   5. Scene (layout, drawing: the map and the fights)
//   6. Input (tap, long press, keyboard)
//   7. Panels (status, action bar)
//   8. Dialogs (new journey, party, stops, level up, result, records, tour)
//   9. Toasts
//  10. Sound
//  11. Sync slice + palette
//  12. Wiring & boot
// ============================================================
(function () {
  "use strict";

  var E = window.WayfarersEngine;

  var STORAGE_KEY = "oros-wayfarers-data";
  var PREFS_KEY   = "oros-wayfarers-prefs";
  var SESSION_KEY = "oros-wayfarers-session";
  var DEVICE_KEY  = "oros-wayfarers-device";
  var SFX_KEY     = "oros-wayfarers-sfx";
  var DATA_VER    = 1;
  var DIFFS = E.DIFFS;                 // g Gentle, h Hardy
  var CLASS_IDS = E.CLASS_IDS;
  var DK = window.orosDaily || null;  // gamekit/daily.js (the Game Center link)
  var REGIONS_N = E.REGIONS.length;
  var BIG = 1e9;

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
      "app.name": "Wayfarers",
      "btn.new": "New journey (N)", "btn.party": "Party", "btn.partyKey": "Party (P)", "btn.stats": "Records",
      "btn.sfxOn": "Sound on", "btn.sfxOff": "Sound off", "btn.fastOn": "Quick moves on", "btn.fastOff": "Quick moves off",
      "view.label": "The journey. On the map the arrow keys choose a stop and Enter goes there. In a fight 1 to 6 choose an action, the arrow keys a target, Enter acts, Escape goes back.",
      "st.lvl": "Level {n}", "st.xp": "{n} of {m} XP", "st.gold": "{n} gold",
      "st.p": "Potions {n}", "st.t": "Tonics {n}", "st.f": "Phoenix feathers {n}",
      "diff.g": "Gentle", "diff.h": "Hardy",
      "diff.g.note": "20 % more Health, fallen heroes stand up after each fight, and a phoenix feather to start.",
      "diff.h.note": "Fallen heroes stand up only at a camp. If all three fall, the journey ends.",
      "cls.knight": "Knight", "cls.ranger": "Ranger", "cls.mage": "Mage", "cls.cleric": "Cleric", "cls.rogue": "Rogue", "cls.bard": "Bard",
      "cls.knight.note": "Front row. Shield bash stuns, Cover shields an ally, Taunt draws every hit.",
      "cls.ranger.note": "Back row. Mark makes a foe take more, Pierce goes through Guard, Volley hits every foe.",
      "cls.mage.note": "Back row. Fire burns, Frost chills, Storm hits Wet or Chilled foes twice as hard.",
      "cls.cleric.note": "Back row. Heals, cleanses Burn and Stun, and raises a fallen hero once a fight.",
      "cls.rogue.note": "Front row. Twin strike hits twice, double damage to Marked or Stunned foes, and Hide.",
      "cls.bard.note": "Back row. Songs give the party Power or Speed, and Gift gives an ally Focus.",
      "row.f": "front row", "row.b": "back row",
      "sk.atk": "Attack", "sk.atk.d": "Hit one foe: Power × 1.",
      "sk.guard": "Guard", "sk.guard.d": "Half damage until your next turn, and 1 more Focus.",
      "sk.item": "Item", "sk.item.d": "Use a potion, a tonic or a phoenix feather. It takes the turn.",
      "sk.bash": "Shield bash", "sk.bash.d": "Power × 1 and Stun: the foe loses its next turn and its shown move.",
      "sk.cover": "Cover", "sk.cover.d": "Until your next turn, hits on that hero land on you.",
      "sk.taunt": "Taunt", "sk.taunt.d": "Until your next turn, every foe that hits one hero hits you.",
      "sk.mark": "Mark", "sk.mark.d": "Power × 0.6 and Mark for 2 turns: the party hits it 1.5 × (the Rogue 2 ×).",
      "sk.pierce": "Pierce", "sk.pierce.d": "Power × 1.5, through Guard.",
      "sk.volley": "Volley", "sk.volley.d": "Power × 0.7 to every foe.",
      "sk.fire": "Fire", "sk.fire.d": "Power × 0.9 and Burn for 3 turns.",
      "sk.frost": "Frost", "sk.frost.d": "Power × 0.9 and Chill for 2 turns: 3 less Speed.",
      "sk.storm": "Storm", "sk.storm.d": "Power × 1.3, twice as hard on a Wet or Chilled foe.",
      "sk.heal": "Heal", "sk.heal.d": "Heals Power × 2 + 4.",
      "sk.cleanse": "Cleanse", "sk.cleanse.d": "Ends Burn, Stun and Chill, and heals 4.",
      "sk.raise": "Raise", "sk.raise.d": "A fallen hero stands with 30 % Health. Once a fight.",
      "sk.twin": "Twin strike", "sk.twin.d": "Two hits of Power × 0.7.",
      "sk.hide": "Hide", "sk.hide.d": "No foe can hit you until your next turn, and your next hit is 1.5 ×.",
      "sk.anthem": "Anthem", "sk.anthem.d": "The party gets 2 more Power for 2 turns.",
      "sk.tempo": "Tempo", "sk.tempo.d": "The party gets 3 more Speed for 2 turns.",
      "sk.gift": "Gift", "sk.gift.d": "An ally gets 3 Focus.",
      "sk.back": "Backstab", "sk.back.d": "Always: double damage to a Marked or Stunned foe.",
      "sk.cost": "{n} Focus", "sk.again": "Tap {k} again to use it", "sk.pick": "{k}: choose a target", "sk.noFo": "Not enough Focus",
      "up.hp": "+6 most Health", "up.pw": "+1 Power", "up.gd": "+1 Guard", "up.sp": "+1 Speed", "up.fo": "+1 most Focus",
      "up.bashUp": "Shield bash hits 1.5 ×", "up.coverUp": "Cover also Guards you", "up.tauntUp": "Taunt also heals you 8",
      "up.markUp": "Mark lasts 3 turns", "up.pierceUp": "Pierce hits 2 ×", "up.volleyUp": "Volley hits 1 ×",
      "up.fireUp": "Burn lasts 4 turns", "up.frostUp": "Chill lasts 3 turns", "up.stormUp": "Storm hits 2.5 × on Wet or Chilled",
      "up.healUp": "Heal heals 6 more", "up.cleanseUp": "Cleanse heals 10", "up.raiseUp": "Raise to 60 % Health",
      "up.twinUp": "Twin strike hits 3 times", "up.hideUp": "Hide also gives 2 Focus", "up.backUp": "Backstab 2.5 ×",
      "up.anthemUp": "Anthem gives 3 Power", "up.tempoUp": "Tempo also gives everyone 1 Focus", "up.giftUp": "Gift gives 5 Focus",
      "gear.iron": "Iron sword", "gear.ash": "Ash staff", "gear.steel": "Steel blade", "gear.swift": "Swift blade",
      "gear.heavy": "War hammer", "gear.star": "Star blade", "gear.oak": "Oak charm", "gear.plume": "Swallow pin",
      "gear.shell": "Shell charm", "gear.lamp": "Little lamp", "gear.heart": "Heart stone", "gear.owl": "Owl feather",
      "gear.stone": "Guard stone", "gear.sun": "Sun disc",
      "gear.w": "Weapon", "gear.c": "Charm", "gear.none": "none",
      "fx.pw": "Power {n}", "fx.hp": "Health {n}", "fx.gd": "Guard {n}", "fx.sp": "Speed {n}", "fx.fo": "Focus {n}", "fx.sf": "+{n} Focus to start a fight",
      "item.p": "Potion", "item.t": "Tonic", "item.f": "Phoenix feather",
      "item.p.d": "Heals 40 % of a hero's Health.", "item.t.d": "3 Focus for a hero, in a fight.", "item.f.d": "A fallen hero stands with half Health.",
      "foe.sprout": "Thornling", "foe.wolf": "Grey wolf", "foe.boar": "Boar", "foe.sprite": "River sprite", "foe.archer": "Bandit archer",
      "foe.moss": "Mossback", "foe.witch": "Thorn witch", "foe.captain": "Bandit captain", "foe.king": "Briar King",
      "hab.sprout": "Hits the weakest hero.", "hab.wolf": "Fast. Bites the weakest, then howls: every foe gets 1 more Power.",
      "hab.boar": "Slow. Every second turn it charges the front row for 1.8 ×.", "hab.sprite": "Always Wet. Mends a hurt foe, else hits.",
      "hab.archer": "Shoots the back row.", "hab.moss": "Always Wet. Its shell halves the damage until its next turn.",
      "hab.witch": "Briar: a hit that Burns. Then it mends a foe.", "hab.captain": "Hits, rallies the band (+2 Power), then sweeps every hero.",
      "hab.king": "The guardian of the Greenway. At two thirds of its Health it calls thornlings; at one third it rages.",
      "mv.hit": "Hit", "mv.bite": "Bite", "mv.shot": "Shot", "mv.charge": "Charge", "mv.briar": "Briar", "mv.sweep": "Sweep",
      "mv.mend": "Mend", "mv.shell": "Shell", "mv.howl": "Howl", "mv.rally": "Rally",
      "sts.bu": "Burn", "sts.ch": "Chill", "sts.sn": "Stun", "sts.mk": "Marked", "sts.gu": "Guard", "sts.hi": "Hidden",
      "sts.pb": "Anthem", "sts.sb": "Tempo", "sts.ta": "Taunting", "sts.cv": "Covered", "sts.sh": "Shell", "sts.rv": "Rallied", "sts.wet": "Wet",
      "info.foe": "{name} · Health {hp} of {mh} · Power {pw} · Guard {gd} · Speed {sp}",
      "info.hero": "{name} · Health {hp} of {mh} · Power {pw} · Guard {gd} · Speed {sp} · Focus {fo} of {mf}",
      "info.next": "Next: {m}", "info.on": "{m} on {k}", "info.all": "{m} on every hero", "info.sts": "Now: {s}",
      "stop.s": "Start", "stop.f": "Fight", "stop.h": "Hard fight", "stop.c": "Camp", "stop.m": "Market", "stop.e": "Event", "stop.g": "Guardian",
      "region.green": "The Greenway",
      "map.go": "Choose the next stop", "map.at": "{r} · stop {n} of {m}",
      "ev.hit": "{a} hits {b} for {n}", "ev.burn": "{b} burns for {n}", "ev.heal": "{b} heals {n}", "ev.fall": "{b} falls",
      "ev.stun": "{b} is stunned and loses the turn", "ev.sweep": "{a} sweeps the party", "ev.rally": "The foes rally: +{n} Power",
      "ev.shell": "{b} pulls into its shell", "ev.summon": "{b} joins the fight", "ev.phase": "{b} grows fierce!",
      "ev.stand": "{b} stands up", "ev.cover": "{b} takes the hit", "ev.wait": "{a} finds no one to hit",
      "ev.focus": "{b} gets {n} Focus", "ev.song": "{a} sings: {k}",
      "ev.win": "Victory! +{gold} gold, +{xp} XP", "ev.lvl": "Level {n}!", "ev.gear": "Into the bag: {g}", "ev.buy": "Bought: {g}",
      "ev.item": "+1 {i}", "ev.xp": "+{n} XP", "ev.goldUp": "+{n} gold", "ev.mhp": "Every hero gets 6 more most Health",
      "ev.hurt": "{b} loses {n} Health", "ev.train": "{b} trains: +1 Power", "ev.equip": "{b} changes gear",
      "combo.mark": "Mark!", "combo.back": "Backstab!", "combo.storm": "Storm on the wet!",
      "fight.f": "A fight", "fight.h": "A hard fight", "fight.g": "The guardian", "fight.e": "A fight",
      "fight.your": "{k}: choose an action",
      "camp.title": "Camp", "camp.text": "A quiet clearing for the night. Fallen heroes are on their feet again.",
      "camp.rest": "Rest: every hero heals 50 %", "camp.train": "Train {k}: +1 Power for good",
      "mk.title": "Market", "mk.gold": "Your gold: {n}", "mk.buy": "Buy", "mk.sold": "Sold", "mk.full": "The bag is full",
      "mk.most": "You carry the most", "mk.poor": "Not enough gold", "mk.leave": "Leave", "mk.price": "{n} gold",
      "loot.title": "Spoils", "loot.text": "Choose one to take.", "loot.skip": "Leave both",
      "up.title": "{k} reaches level {n}", "up.text": "Choose one.",
      "evt.title.shrine": "Wayside shrine", "evt.shrine": "A stone shrine with fresh flowers. The air is very still.",
      "evt.shrine.0": "Pray (every hero heals 30 %)", "evt.shrine.1": "Leave 15 gold (every hero +6 most Health, for good)",
      "evt.title.tinker": "The tinker's wagon", "evt.tinker": "A tinker's wagon has lost a wheel on the muddy road.",
      "evt.tinker.0": "Help mend it (+25 XP)", "evt.tinker.1": "Help for pay (+20 gold)",
      "evt.title.berry": "Berry bushes", "evt.berry": "The bushes hang heavy with dark berries.",
      "evt.berry.0": "Eat your fill (every hero heals 20 %)", "evt.berry.1": "Fill a basket (+1 potion)",
      "evt.title.cart": "A merchant in trouble", "evt.cart": "Bandits have stopped a merchant's cart at the bend.",
      "evt.cart.0": "Drive them off (a fight, then +30 gold)", "evt.cart.1": "Buy a tonic and slip past (12 gold, +1 tonic)", "evt.cart.2": "Walk on",
      "evt.title.stump": "The blade in the stump", "evt.stump": "Something is stuck deep in an old stump.",
      "evt.stump.0": "Pull it out (a piece of gear, every hero loses 5 Health)", "evt.stump.1": "Leave it",
      "evt.title.hermit": "The hermit", "evt.hermit": "A hermit offers tea and very long stories.",
      "evt.hermit.0": "Listen (+15 XP)", "evt.hermit.1": "Trade for a phoenix feather (20 gold)",
      "evt.title.well": "The old well", "evt.well": "A deep well. Coins glint at the bottom.",
      "evt.well.0": "Drop a coin and drink (5 gold, every hero heals 35 %)", "evt.well.1": "Fish out the coins (+8 gold)",
      "evt.title.spar": "Soldiers' camp", "evt.spar": "Soldiers by a fire offer a friendly sparring match.",
      "evt.spar.0": "Spar (+35 XP, every hero loses 6 Health)", "evt.spar.1": "Share their fire (every hero heals 15 %)",
      "evt.title.fox": "The red fox", "evt.fox": "A red fox trots by with a golden feather in its mouth.",
      "evt.fox.0": "Follow it (+1 phoenix feather)", "evt.fox.1": "Look where it came from (+12 gold)",
      "evt.title.bridge": "The toll bridge", "evt.bridge": "A toll bridge with no keeper. The toll box fell in the stream.",
      "evt.bridge.0": "Climb down for it (+25 gold, every hero loses 4 Health)", "evt.bridge.1": "Cross and go on",
      "party.title": "Party", "party.bag": "Bag", "party.empty": "Empty", "party.equip": "Give to {k}", "party.off": "Take off",
      "party.use": "Use", "party.fallen": "fallen", "party.level": "Level {n} · {x} XP", "party.inFight": "Gear can change only between fights.",
      "party.ups": "Upgrades",
      "new.title": "New journey", "new.diff": "Difficulty", "new.party": "Party: choose three", "new.count": "{n} of 3 chosen",
      "new.seed": "Journey code (empty = new land)", "new.start": "Set out", "new.cancel": "Cancel", "new.giveUp": "The journey in progress counts as lost.",
      "res.won": "The Greenway is safe!", "res.fell": "The party fell", "res.at": "At: {k}",
      "res.stops": "Stops", "res.kills": "Foes", "res.lvl": "Level", "res.gold": "Gold", "res.code": "Journey code: {seed}",
      "res.same": "Same journey again", "res.new": "New journey",
      "stats.title": "Records", "stats.head": "Journeys · won · regions cleared", "stats.reset": "Reset records",
      "stats.close": "Close", "stats.code": "This journey: {seed}", "stats.classes": "Wins by class", "daily.games": "All games",
      "confirm.reset": "Reset your Wayfarers records on all your devices?", "confirm.yes": "Reset", "confirm.no": "Cancel",
      "toast.reset": "Records reset", "toast.save": "Could not save: storage is full",
      "tour.title": "How to play", "tour.next": "Next", "tour.skip": "Skip", "tour.done": "Play",
      "tour.1": "Lead three heroes across the land. Tap a lit stop on the map to go there; the guardian waits at the end.",
      "tour.2": "In a fight everyone acts in Speed order, shown at the top. Each foe shows its next move and whom it will hit.",
      "tour.3": "On a hero's turn tap an action, then a lit target. Skills cost Focus; a hero gets 1 Focus each turn.",
      "tour.4": "Work together: Mark or Stun a foe for the Rogue, Chill it for the Storm, and keep the Cleric standing."
    },
    el: {
      "app.name": "Οδοιπόροι",
      "btn.new": "Νέο ταξίδι (N)", "btn.party": "Ομάδα", "btn.partyKey": "Ομάδα (P)", "btn.stats": "Ρεκόρ",
      "btn.sfxOn": "Ήχος ανοιχτός", "btn.sfxOff": "Ήχος κλειστός", "btn.fastOn": "Γρήγορες κινήσεις: ναι", "btn.fastOff": "Γρήγορες κινήσεις: όχι",
      "view.label": "Το ταξίδι. Στον χάρτη τα βελάκια διαλέγουν στάση και το Enter σε πάει εκεί. Στη μάχη το 1 έως 6 διαλέγει ενέργεια, τα βελάκια στόχο, το Enter τη δίνει και το Escape γυρνά πίσω.",
      "st.lvl": "Επίπεδο {n}", "st.xp": "{n} από {m} XP", "st.gold": "{n} χρυσά",
      "st.p": "Φίλτρα {n}", "st.t": "Τονωτικά {n}", "st.f": "Φτερά του φοίνικα {n}",
      "diff.g": "Ήπιο", "diff.h": "Σκληρό",
      "diff.g.note": "20 % περισσότερη ζωή, όσοι πέσουν σηκώνονται μετά από κάθε μάχη, και ένα φτερό του φοίνικα για αρχή.",
      "diff.h.note": "Όσοι πέσουν σηκώνονται μόνο σε κατασκήνωση. Αν πέσουν και οι τρεις, το ταξίδι τελειώνει.",
      "cls.knight": "Ιππότης", "cls.ranger": "Ιχνηλάτης", "cls.mage": "Μάγος", "cls.cleric": "Ιερέας", "cls.rogue": "Κλέφτης", "cls.bard": "Βάρδος",
      "cls.knight.note": "Μπροστινή γραμμή. Το χτύπημα ασπίδας ζαλίζει, η Κάλυψη προστατεύει έναν σύμμαχο, η Πρόκληση τραβά πάνω του κάθε χτύπημα.",
      "cls.ranger.note": "Πίσω γραμμή. Το Σημάδι κάνει έναν εχθρό να τρώει περισσότερη ζημιά, το Διαπεραστικό περνά την Άμυνα, η Βροχή βελών χτυπά όλους.",
      "cls.mage.note": "Πίσω γραμμή. Η Φωτιά καίει, η Παγωνιά παγώνει, η Καταιγίδα χτυπά διπλά τους βρεγμένους ή παγωμένους.",
      "cls.cleric.note": "Πίσω γραμμή. Θεραπεύει, σβήνει Κάψιμο και Ζάλη, και σηκώνει όποιον έπεσε μία φορά σε κάθε μάχη.",
      "cls.rogue.note": "Μπροστινή γραμμή. Το Διπλό χτύπημα χτυπά δύο φορές, διπλή ζημιά σε σημαδεμένους ή ζαλισμένους, και Κρυψώνα.",
      "cls.bard.note": "Πίσω γραμμή. Τα τραγούδια δίνουν στην ομάδα Δύναμη ή Ταχύτητα, και το Δώρο δίνει Συγκέντρωση σε έναν σύμμαχο.",
      "row.f": "μπροστινή γραμμή", "row.b": "πίσω γραμμή",
      "sk.atk": "Επίθεση", "sk.atk.d": "Χτυπά έναν εχθρό: Δύναμη × 1.",
      "sk.guard": "Φύλαξη", "sk.guard.d": "Μισή ζημιά ως τον επόμενο γύρο σου, και 1 Συγκέντρωση παραπάνω.",
      "sk.item": "Αντικείμενο", "sk.item.d": "Φίλτρο, τονωτικό ή φτερό του φοίνικα. Παίρνει τον γύρο.",
      "sk.bash": "Χτύπημα ασπίδας", "sk.bash.d": "Δύναμη × 1 και Ζάλη: ο εχθρός χάνει τον επόμενο γύρο του και την κίνηση που έδειχνε.",
      "sk.cover": "Κάλυψη", "sk.cover.d": "Ως τον επόμενο γύρο σου, τα χτυπήματα σε αυτόν τον ήρωα πέφτουν σε σένα.",
      "sk.taunt": "Πρόκληση", "sk.taunt.d": "Ως τον επόμενο γύρο σου, κάθε εχθρός που χτυπά έναν ήρωα χτυπά εσένα.",
      "sk.mark": "Σημάδι", "sk.mark.d": "Δύναμη × 0,6 και Σημάδι για 2 γύρους: η ομάδα τον χτυπά 1,5 × (ο Κλέφτης 2 ×).",
      "sk.pierce": "Διαπεραστικό", "sk.pierce.d": "Δύναμη × 1,5, περνά την Άμυνα.",
      "sk.volley": "Βροχή βελών", "sk.volley.d": "Δύναμη × 0,7 σε κάθε εχθρό.",
      "sk.fire": "Φωτιά", "sk.fire.d": "Δύναμη × 0,9 και Κάψιμο για 3 γύρους.",
      "sk.frost": "Παγωνιά", "sk.frost.d": "Δύναμη × 0,9 και Πάγωμα για 2 γύρους: 3 λιγότερη Ταχύτητα.",
      "sk.storm": "Καταιγίδα", "sk.storm.d": "Δύναμη × 1,3, διπλή ζημιά σε βρεγμένο ή παγωμένο εχθρό.",
      "sk.heal": "Ίαση", "sk.heal.d": "Θεραπεύει Δύναμη × 2 + 4.",
      "sk.cleanse": "Κάθαρση", "sk.cleanse.d": "Σβήνει Κάψιμο, Ζάλη και Πάγωμα, και θεραπεύει 4.",
      "sk.raise": "Ανάσταση", "sk.raise.d": "Όποιος έπεσε σηκώνεται με 30 % ζωή. Μία φορά σε κάθε μάχη.",
      "sk.twin": "Διπλό χτύπημα", "sk.twin.d": "Δύο χτυπήματα με Δύναμη × 0,7.",
      "sk.hide": "Κρυψώνα", "sk.hide.d": "Κανείς δεν σε χτυπά ως τον επόμενο γύρο σου, και το επόμενο χτύπημά σου είναι 1,5 ×.",
      "sk.anthem": "Ύμνος", "sk.anthem.d": "Η ομάδα παίρνει 2 Δύναμη παραπάνω για 2 γύρους.",
      "sk.tempo": "Ρυθμός", "sk.tempo.d": "Η ομάδα παίρνει 3 Ταχύτητα παραπάνω για 2 γύρους.",
      "sk.gift": "Δώρο", "sk.gift.d": "Ένας σύμμαχος παίρνει 3 Συγκέντρωση.",
      "sk.back": "Πισώπλατο", "sk.back.d": "Πάντα: διπλή ζημιά σε σημαδεμένο ή ζαλισμένο εχθρό.",
      "sk.cost": "{n} Συγκ.", "sk.again": "Πάτα ξανά: {k}", "sk.pick": "{k}: διάλεξε στόχο", "sk.noFo": "Δεν φτάνει η Συγκέντρωση",
      "up.hp": "+6 ζωή", "up.pw": "+1 Δύναμη", "up.gd": "+1 Άμυνα", "up.sp": "+1 Ταχύτητα", "up.fo": "+1 μέγιστη Συγκέντρωση",
      "up.bashUp": "Το χτύπημα ασπίδας χτυπά 1,5 ×", "up.coverUp": "Η Κάλυψη σού δίνει και Φύλαξη", "up.tauntUp": "Η Πρόκληση σε θεραπεύει και 8",
      "up.markUp": "Το Σημάδι κρατά 3 γύρους", "up.pierceUp": "Το Διαπεραστικό χτυπά 2 ×", "up.volleyUp": "Η Βροχή βελών χτυπά 1 ×",
      "up.fireUp": "Το Κάψιμο κρατά 4 γύρους", "up.frostUp": "Το Πάγωμα κρατά 3 γύρους", "up.stormUp": "Η Καταιγίδα χτυπά 2,5 × βρεγμένους ή παγωμένους",
      "up.healUp": "Η Ίαση θεραπεύει 6 παραπάνω", "up.cleanseUp": "Η Κάθαρση θεραπεύει 10", "up.raiseUp": "Η Ανάσταση δίνει 60 % ζωή",
      "up.twinUp": "Το Διπλό χτύπημα χτυπά 3 φορές", "up.hideUp": "Η Κρυψώνα δίνει και 2 Συγκέντρωση", "up.backUp": "Πισώπλατο 2,5 ×",
      "up.anthemUp": "Ο Ύμνος δίνει 3 Δύναμη", "up.tempoUp": "Ο Ρυθμός δίνει και σε όλους 1 Συγκέντρωση", "up.giftUp": "Το Δώρο δίνει 5 Συγκέντρωση",
      "gear.iron": "Σιδερένιο σπαθί", "gear.ash": "Ραβδί από μελιό", "gear.steel": "Ατσάλινη λεπίδα", "gear.swift": "Γρήγορη λεπίδα",
      "gear.heavy": "Πολεμικό σφυρί", "gear.star": "Λεπίδα των άστρων", "gear.oak": "Φυλαχτό βελανιδιάς", "gear.plume": "Καρφίτσα χελιδονιού",
      "gear.shell": "Φυλαχτό από όστρακο", "gear.lamp": "Λυχναράκι", "gear.heart": "Πέτρα της καρδιάς", "gear.owl": "Φτερό κουκουβάγιας",
      "gear.stone": "Πέτρα φρουράς", "gear.sun": "Δίσκος του ήλιου",
      "gear.w": "Όπλο", "gear.c": "Φυλαχτό", "gear.none": "κανένα",
      "fx.pw": "Δύναμη {n}", "fx.hp": "Ζωή {n}", "fx.gd": "Άμυνα {n}", "fx.sp": "Ταχύτητα {n}", "fx.fo": "Συγκέντρωση {n}", "fx.sf": "+{n} Συγκέντρωση στην αρχή της μάχης",
      "item.p": "Φίλτρο", "item.t": "Τονωτικό", "item.f": "Φτερό του φοίνικα",
      "item.p.d": "Θεραπεύει το 40 % της ζωής ενός ήρωα.", "item.t.d": "3 Συγκέντρωση σε έναν ήρωα, μέσα στη μάχη.", "item.f.d": "Όποιος έπεσε σηκώνεται με μισή ζωή.",
      "foe.sprout": "Αγκαθάκι", "foe.wolf": "Γκρίζος λύκος", "foe.boar": "Αγριογούρουνο", "foe.sprite": "Νεράιδα του ποταμού", "foe.archer": "Ληστής τοξότης",
      "foe.moss": "Βρυοχελώνα", "foe.witch": "Μάγισσα των αγκαθιών", "foe.captain": "Αρχιληστής", "foe.king": "Βασιλιάς των Βάτων",
      "hab.sprout": "Χτυπά τον πιο αδύναμο ήρωα.", "hab.wolf": "Γρήγορος. Δαγκώνει τον πιο αδύναμο και μετά ουρλιάζει: κάθε εχθρός παίρνει 1 Δύναμη.",
      "hab.boar": "Αργό. Κάθε δεύτερο γύρο ορμά στην μπροστινή γραμμή με 1,8 ×.", "hab.sprite": "Πάντα βρεγμένη. Γιατρεύει έναν πληγωμένο εχθρό, αλλιώς χτυπά.",
      "hab.archer": "Ρίχνει στην πίσω γραμμή.", "hab.moss": "Πάντα βρεγμένη. Το καβούκι της κόβει τη ζημιά στη μέση ως τον επόμενο γύρο της.",
      "hab.witch": "Βάτα: χτύπημα που καίει. Μετά γιατρεύει έναν εχθρό.", "hab.captain": "Χτυπά, συσπειρώνει τη συμμορία (+2 Δύναμη), μετά σαρώνει όλους.",
      "hab.king": "Ο φύλακας του Πράσινου Δρόμου. Στα δύο τρίτα της ζωής του καλεί αγκαθάκια· στο ένα τρίτο λυσσάει.",
      "mv.hit": "Χτύπημα", "mv.bite": "Δάγκωμα", "mv.shot": "Βολή", "mv.charge": "Επέλαση", "mv.briar": "Βάτα", "mv.sweep": "Σάρωμα",
      "mv.mend": "Γιατρειά", "mv.shell": "Καβούκι", "mv.howl": "Ουρλιαχτό", "mv.rally": "Συσπείρωση",
      "sts.bu": "Κάψιμο", "sts.ch": "Πάγωμα", "sts.sn": "Ζάλη", "sts.mk": "Σημάδι", "sts.gu": "Φύλαξη", "sts.hi": "Κρυμμένος",
      "sts.pb": "Ύμνος", "sts.sb": "Ρυθμός", "sts.ta": "Πρόκληση", "sts.cv": "Κάλυψη", "sts.sh": "Καβούκι", "sts.rv": "Συσπείρωση", "sts.wet": "Βρεγμένο",
      "info.foe": "{name} · Ζωή {hp} από {mh} · Δύναμη {pw} · Άμυνα {gd} · Ταχύτητα {sp}",
      "info.hero": "{name} · Ζωή {hp} από {mh} · Δύναμη {pw} · Άμυνα {gd} · Ταχύτητα {sp} · Συγκέντρωση {fo} από {mf}",
      "info.next": "Επόμενη κίνηση: {m}", "info.on": "{m} σε: {k}", "info.all": "{m} σε όλους τους ήρωες", "info.sts": "Τώρα: {s}",
      "stop.s": "Αφετηρία", "stop.f": "Μάχη", "stop.h": "Δύσκολη μάχη", "stop.c": "Κατασκήνωση", "stop.m": "Αγορά", "stop.e": "Συνάντηση", "stop.g": "Φύλακας",
      "region.green": "Ο Πράσινος Δρόμος",
      "map.go": "Διάλεξε την επόμενη στάση", "map.at": "{r} · στάση {n} από {m}",
      "ev.hit": "{a} χτυπά: {b}, {n}", "ev.burn": "Καίγεται: {b}, {n}", "ev.heal": "Γιατρεύεται: {b}, {n}", "ev.fall": "Έπεσε: {b}",
      "ev.stun": "Ζαλισμένος: {b}, χάνει τον γύρο", "ev.sweep": "Σαρώνει την ομάδα: {a}", "ev.rally": "Οι εχθροί συσπειρώνονται: +{n} Δύναμη",
      "ev.shell": "Κλείνεται στο καβούκι: {b}", "ev.summon": "Μπαίνει στη μάχη: {b}", "ev.phase": "Αγριεύει: {b}!",
      "ev.stand": "Σηκώνεται: {b}", "ev.cover": "Δέχεται το χτύπημα: {b}", "ev.wait": "Δεν βρίσκει ποιον να χτυπήσει: {a}",
      "ev.focus": "{n} Συγκέντρωση: {b}", "ev.song": "Τραγουδά: {a}, {k}",
      "ev.win": "Νίκη! +{gold} χρυσά, +{xp} XP", "ev.lvl": "Επίπεδο {n}!", "ev.gear": "Στο σακίδιο: {g}", "ev.buy": "Αγόρασες: {g}",
      "ev.item": "+1 {i}", "ev.xp": "+{n} XP", "ev.goldUp": "+{n} χρυσά", "ev.mhp": "Κάθε ήρωας παίρνει 6 ζωή παραπάνω",
      "ev.hurt": "Χάνει {n} ζωή: {b}", "ev.train": "Προπονείται: {b}, +1 Δύναμη", "ev.equip": "Αλλάζει εξοπλισμό: {b}",
      "combo.mark": "Σημάδι!", "combo.back": "Πισώπλατο!", "combo.storm": "Καταιγίδα στα βρεγμένα!",
      "fight.f": "Μάχη", "fight.h": "Δύσκολη μάχη", "fight.g": "Ο φύλακας", "fight.e": "Μάχη",
      "fight.your": "{k}: διάλεξε ενέργεια",
      "camp.title": "Κατασκήνωση", "camp.text": "Ένα ήσυχο ξέφωτο για τη νύχτα. Όσοι είχαν πέσει στέκονται ξανά στα πόδια τους.",
      "camp.rest": "Ξεκούραση: κάθε ήρωας θεραπεύεται 50 %", "camp.train": "Προπόνηση: {k}, +1 Δύναμη για πάντα",
      "mk.title": "Αγορά", "mk.gold": "Ο χρυσός σου: {n}", "mk.buy": "Αγορά", "mk.sold": "Πουλήθηκε", "mk.full": "Το σακίδιο είναι γεμάτο",
      "mk.most": "Κουβαλάς τα περισσότερα που χωρούν", "mk.poor": "Δεν φτάνει ο χρυσός", "mk.leave": "Φύγε", "mk.price": "{n} χρυσά",
      "loot.title": "Λάφυρα", "loot.text": "Διάλεξε ένα να πάρεις.", "loot.skip": "Άφησέ τα",
      "up.title": "{k}: επίπεδο {n}", "up.text": "Διάλεξε ένα.",
      "evt.title.shrine": "Εικόνισμα στον δρόμο", "evt.shrine": "Ένα πέτρινο εικόνισμα με φρέσκα λουλούδια. Ο αέρας είναι πολύ ακίνητος.",
      "evt.shrine.0": "Προσευχή (κάθε ήρωας θεραπεύεται 30 %)", "evt.shrine.1": "Άφησε 15 χρυσά (κάθε ήρωας +6 ζωή, για πάντα)",
      "evt.title.tinker": "Η άμαξα του γανωματή", "evt.tinker": "Η άμαξα ενός γανωματή έχασε μια ρόδα στον λασπωμένο δρόμο.",
      "evt.tinker.0": "Βοήθησε να τη φτιάξει (+25 XP)", "evt.tinker.1": "Βοήθησε με πληρωμή (+20 χρυσά)",
      "evt.title.berry": "Βατομουριές", "evt.berry": "Οι θάμνοι γέρνουν από τα σκούρα μούρα.",
      "evt.berry.0": "Φάε όσο θες (κάθε ήρωας θεραπεύεται 20 %)", "evt.berry.1": "Γέμισε ένα καλάθι (+1 φίλτρο)",
      "evt.title.cart": "Έμπορος σε μπελά", "evt.cart": "Ληστές σταμάτησαν το κάρο ενός εμπόρου στη στροφή.",
      "evt.cart.0": "Διώξ' τους (μάχη, μετά +30 χρυσά)", "evt.cart.1": "Αγόρασε ένα τονωτικό και πέρνα (12 χρυσά, +1 τονωτικό)", "evt.cart.2": "Συνέχισε τον δρόμο",
      "evt.title.stump": "Η λεπίδα στο κούτσουρο", "evt.stump": "Κάτι έχει σφηνώσει βαθιά σε ένα παλιό κούτσουρο.",
      "evt.stump.0": "Τράβηξέ το (ένας εξοπλισμός, κάθε ήρωας χάνει 5 ζωή)", "evt.stump.1": "Άφησέ το",
      "evt.title.hermit": "Ο ερημίτης", "evt.hermit": "Ένας ερημίτης προσφέρει τσάι και πολύ μεγάλες ιστορίες.",
      "evt.hermit.0": "Άκου (+15 XP)", "evt.hermit.1": "Αντάλλαξε για φτερό του φοίνικα (20 χρυσά)",
      "evt.title.well": "Το παλιό πηγάδι", "evt.well": "Ένα βαθύ πηγάδι. Στον πάτο γυαλίζουν νομίσματα.",
      "evt.well.0": "Ρίξε ένα νόμισμα και πιες (5 χρυσά, κάθε ήρωας θεραπεύεται 35 %)", "evt.well.1": "Ψάρεψε τα νομίσματα (+8 χρυσά)",
      "evt.title.spar": "Στρατόπεδο", "evt.spar": "Στρατιώτες γύρω από μια φωτιά προτείνουν μια φιλική αναμέτρηση.",
      "evt.spar.0": "Αναμετρηθείτε (+35 XP, κάθε ήρωας χάνει 6 ζωή)", "evt.spar.1": "Μοιραστείτε τη φωτιά τους (κάθε ήρωας θεραπεύεται 15 %)",
      "evt.title.fox": "Η κόκκινη αλεπού", "evt.fox": "Μια κόκκινη αλεπού περνά με ένα χρυσό φτερό στο στόμα.",
      "evt.fox.0": "Ακολούθησέ την (+1 φτερό του φοίνικα)", "evt.fox.1": "Ψάξε από πού ήρθε (+12 χρυσά)",
      "evt.title.bridge": "Η γέφυρα με τα διόδια", "evt.bridge": "Μια γέφυρα με διόδια χωρίς φύλακα. Το κουτί των διοδίων έπεσε στο ρέμα.",
      "evt.bridge.0": "Κατέβα να το βρεις (+25 χρυσά, κάθε ήρωας χάνει 4 ζωή)", "evt.bridge.1": "Πέρνα απέναντι και συνέχισε",
      "party.title": "Ομάδα", "party.bag": "Σακίδιο", "party.empty": "Άδειο", "party.equip": "Δώσ' το: {k}", "party.off": "Βγάλ' το",
      "party.use": "Χρήση", "party.fallen": "έπεσε", "party.level": "Επίπεδο {n} · {x} XP", "party.inFight": "Ο εξοπλισμός αλλάζει μόνο ανάμεσα στις μάχες.",
      "party.ups": "Βελτιώσεις",
      "new.title": "Νέο ταξίδι", "new.diff": "Δυσκολία", "new.party": "Ομάδα: διάλεξε τρεις", "new.count": "{n} από 3",
      "new.seed": "Κωδικός ταξιδιού (κενό = νέος τόπος)", "new.start": "Ξεκίνα", "new.cancel": "Άκυρο", "new.giveUp": "Το ταξίδι που παίζεις μετρά ως χαμένο.",
      "res.won": "Ο Πράσινος Δρόμος είναι ασφαλής!", "res.fell": "Η ομάδα έπεσε", "res.at": "Στο: {k}",
      "res.stops": "Στάσεις", "res.kills": "Εχθροί", "res.lvl": "Επίπεδο", "res.gold": "Χρυσός", "res.code": "Κωδικός ταξιδιού: {seed}",
      "res.same": "Ίδιο ταξίδι ξανά", "res.new": "Νέο ταξίδι",
      "stats.title": "Ρεκόρ", "stats.head": "Ταξίδια · νίκες · περιοχές", "stats.reset": "Μηδενισμός ρεκόρ",
      "stats.close": "Κλείσιμο", "stats.code": "Αυτό το ταξίδι: {seed}", "stats.classes": "Νίκες ανά τάξη", "daily.games": "Όλα τα παιχνίδια",
      "confirm.reset": "Να μηδενιστούν τα ρεκόρ των Οδοιπόρων σε όλες τις συσκευές σου;", "confirm.yes": "Μηδενισμός", "confirm.no": "Άκυρο",
      "toast.reset": "Τα ρεκόρ μηδενίστηκαν", "toast.save": "Δεν αποθηκεύτηκε: ο χώρος είναι γεμάτος",
      "tour.title": "Πώς παίζεται", "tour.next": "Επόμενο", "tour.skip": "Παράλειψη", "tour.done": "Παίξε",
      "tour.1": "Οδήγησε τρεις ήρωες μέσα από τον τόπο. Πάτα μια φωτισμένη στάση στον χάρτη για να πας εκεί· στο τέλος περιμένει ο φύλακας.",
      "tour.2": "Στη μάχη ο καθένας παίζει με σειρά Ταχύτητας, που φαίνεται πάνω. Κάθε εχθρός δείχνει την επόμενη κίνησή του και ποιον θα χτυπήσει.",
      "tour.3": "Στη σειρά ενός ήρωα πάτα μια ενέργεια και μετά έναν φωτισμένο στόχο. Οι ικανότητες θέλουν Συγκέντρωση· ο ήρωας παίρνει 1 σε κάθε γύρο του.",
      "tour.4": "Παίξτε μαζί: σημάδεψε ή ζάλισε έναν εχθρό για τον Κλέφτη, πάγωσέ τον για την Καταιγίδα, και κράτα όρθιο τον Ιερέα."
    }
  };
  if (window.orosI18n) window.orosI18n.table(STRINGS, "wayfarers", LANG);

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

  // A new journey code: 6 letters and digits, easy to read aloud.
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
    console.log("wayfarers.js v" + (SCRIPT_V || "?") + " boot");
  })();

  // ---------- 2. Synced records ----------
  // data = { ver, br, rows: { <device id>: { b, s: { "<diff>": [journeys, won, regions cleared] },
  //                                           c: { <class>: wins } } } }
  // Each device only grows its own row, so a per-row max is a join and
  // nothing is double-counted however the devices meet.
  var data = null;
  var deviceId = null;

  function defaultData() { return { ver: DATA_VER, br: 0, rows: {} }; }
  function normRow(row) {
    if (!row || typeof row !== "object" || !isInt(row.b) || row.b < 0) return null;
    var s = {}, c = {}, any = false;
    DIFFS.forEach(function (k) {
      var v = row.s && row.s[k];
      if (Array.isArray(v) && v.length === 3 && v.every(function (x) { return isInt(x) && x >= 0 && x < BIG; }) && v[2] <= REGIONS_N && v[1] <= v[0]) {
        s[k] = [v[0], v[1], v[2]];
        any = true;
      }
    });
    CLASS_IDS.forEach(function (k) {
      var v = row.c && row.c[k];
      if (isInt(v) && v > 0 && v < BIG) c[k] = v;
    });
    return any ? { b: row.b, s: s, c: c } : null;
  }
  function joinRows(x, y) {
    if (x.b !== y.b) return x.b > y.b ? x : y;
    var s = {}, c = {};
    DIFFS.forEach(function (k) {
      var a = x.s[k], b = y.s[k];
      if (!a && !b) return;
      if (!a) { s[k] = b.slice(); return; }
      if (!b) { s[k] = a.slice(); return; }
      s[k] = [Math.max(a[0], b[0]), Math.max(a[1], b[1]), Math.max(a[2], b[2])];
    });
    CLASS_IDS.forEach(function (k) {
      var v = Math.max(x.c[k] || 0, y.c[k] || 0);
      if (v) c[k] = v;
    });
    return { b: x.b, s: s, c: c };
  }
  function mergeWayfarers(A, B) {
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
      var r = rows[id], s = {}, c = {};
      DIFFS.forEach(function (k) { if (r.s[k]) s[k] = r.s[k].slice(); });
      CLASS_IDS.forEach(function (k) { if (r.c[k]) c[k] = r.c[k]; });
      sorted[id] = { b: r.b, s: s, c: c };
    });
    return { ver: DATA_VER, br: br, rows: sorted };
  }
  // [journeys, won, regions cleared] for a difficulty, all devices.
  function totals(diff) {
    var out = [0, 0, 0];
    Object.keys(data.rows).forEach(function (id) {
      var v = data.rows[id].s[diff];
      if (v) { out[0] += v[0]; out[1] += v[1]; out[2] = Math.max(out[2], v[2]); }
    });
    return out;
  }
  function classWins(k) {
    var n = 0;
    Object.keys(data.rows).forEach(function (id) { n += data.rows[id].c[k] || 0; });
    return n;
  }
  function load() {
    var raw = null;
    try { raw = localStorage.getItem(STORAGE_KEY); } catch (e) {}
    if (raw) {
      try {
        var parsed = JSON.parse(raw);
        if (parsed && typeof parsed === "object" && parsed.rows && typeof parsed.rows === "object") {
          data = mergeWayfarers(parsed, parsed);
          return;
        }
      } catch (e) {}
      try { localStorage.setItem(STORAGE_KEY + "-broken", raw); } catch (e) {}
      try { console.warn("[orOS] wayfarers: unreadable data copied to " + STORAGE_KEY + "-broken"); } catch (e) {}
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
  // A journey ended: won (all regions) or not; cleared = regions cleared.
  function count(diff, won, cleared, party) {
    var row = data.rows[deviceId];
    if (!row || row.b < data.br) row = { b: data.br, s: {}, c: {} };
    row = { b: row.b, s: JSON.parse(JSON.stringify(row.s)), c: JSON.parse(JSON.stringify(row.c || {})) };
    var v = row.s[diff] ? row.s[diff].slice() : [0, 0, 0];
    v[0]++;
    if (won) v[1]++;
    v[2] = Math.max(v[2], clamp(cleared, 0, REGIONS_N));
    row.s[diff] = v;
    if (won) party.forEach(function (k) { row.c[k] = (row.c[k] || 0) + 1; });
    data.rows[deviceId] = row;
    data = mergeWayfarers(data, data);
    save();
  }

  // ---------- 3. Device-local prefs + session ----------
  var prefs = { diff: "g", party: ["knight", "mage", "cleric"], tour: false, fast: false };
  function loadPrefs() {
    try {
      var p = JSON.parse(localStorage.getItem(PREFS_KEY) || "null");
      if (p && typeof p === "object") {
        if (DIFFS.indexOf(p.diff) >= 0) prefs.diff = p.diff;
        if (E.partyOk(p.party)) prefs.party = p.party.slice();
        prefs.tour = p.tour === true;
        prefs.fast = p.fast === true;
      }
    } catch (e) {}
  }
  function savePrefs() {
    try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch (e) {}
  }

  // game = {
  //   g: engine state,
  //   opts: { diff, seed, party: [3 classes] },
  //   counted: bool   the journey's end is in the records
  // }
  var game = null;

  function validSession(s) {
    if (!s || typeof s !== "object" || !E.valid(s.g)) return false;
    var o = s.opts;
    if (!o || DIFFS.indexOf(o.diff) < 0 || o.diff !== s.g.diff || typeof o.seed !== "string" || o.seed !== s.g.seed) return false;
    if (!E.partyOk(o.party) || o.party.join() !== s.g.party.map(function (h) { return h.c; }).join()) return false;
    return true;
  }
  function loadSession() {
    try {
      var s = JSON.parse(localStorage.getItem(SESSION_KEY) || "null");
      if (validSession(s)) {
        s.counted = s.counted === true;
        return { g: s.g, opts: s.opts, counted: s.counted };
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

  // ---------- 4. Journey flow ----------
  var st = null;          // = game.g
  var sel = null;         // { a: "atk" | skill id | "item", i: item id, armed: 1 } the action being aimed
  var cursor = 0;         // keyboard: index into the lit targets or the reachable stops
  var busyUntil = 0;      // input waits while the foes' moves play

  function inProgressOf(g) { return !!(g && !g.counted && g.g.over < 0 && g.g.acts > 0); }
  function makeGame(opts) {
    return { g: E.newJourney(opts.seed, opts.diff, opts.party), opts: { diff: opts.diff, seed: opts.seed, party: opts.party.slice() }, counted: false };
  }
  // Regions cleared so far (the guardian of the region in play not yet).
  function cleared(g) { return g.over === 1 ? REGIONS_N : g.region - 1; }
  function finishIfOver() {
    if (!game || st.over < 0 || game.counted) return;
    game.counted = true;
    count(game.opts.diff, st.over === 1, cleared(st), game.opts.party);
    saveSession();
  }
  function startGame(opts) {
    // a journey under way and left counts as lost
    if (game && inProgressOf(game)) { game.counted = true; count(game.opts.diff, false, cleared(st), game.opts.party); }
    game = makeGame(opts);
    st = game.g;
    sel = null;
    cursor = 0;
    saveSession();
    setMsg(t("map.go"));
    renderAll();
    live(t("region." + E.REGIONS[st.region - 1].id));
    maybeTour();
  }
  function setMsg(text) { $("msg").textContent = text || ""; }
  function heroName(i) { return t("cls." + st.party[i].c); }
  function unitName(r) {
    if (!r) return "";
    if (r.charAt(0) === "h") return heroName(+r.slice(1));
    var f = foeById(+r.slice(1));
    return f ? t("foe." + f.k) : "";
  }
  function foeById(id) {
    if (!st.fight) return null;
    for (var k = 0; k < st.fight.foes.length; k++) if (st.fight.foes[k].id === id) return st.fight.foes[k];
    return null;
  }
  function curHero() {
    var fi = st.fight;
    return fi && fi.cur && fi.cur.charAt(0) === "h" ? +fi.cur.slice(1) : -1;
  }

  // One action through the engine; false when it was not allowed.
  function doAct(a) {
    if (!game || st.over >= 0) return false;
    var wasFight = !!st.fight;
    var ev = E.act(st, a);
    if (!ev) return false;
    sel = null;
    cursor = 0;
    saveSession();
    handleEvents(ev, wasFight);
    finishIfOver();
    renderAll();
    if (st.over >= 0) setTimeout(resultDialog, prefs.fast ? 300 : 900);
    else if (!st.fight && st.pend.length) setTimeout(pendDialog, wasFight ? (prefs.fast ? 250 : 700) : 150);
    return true;
  }
  function evText(e) {
    var p = { a: unitName(e.s), b: unitName(e.d), n: e.n };
    switch (e.e) {
      case "hit": return t("ev.hit", p) + (e.c ? " · " + t("combo." + e.c) : "");
      case "burn": case "heal": case "fall": case "stun": case "sweep": case "shell": case "summon": case "phase":
      case "stand": case "cover": case "wait": case "focus": case "hurt": case "train": case "equip": return t("ev." + e.e, p);
      case "rally": return t("ev.rally", p);
      case "song": return t("ev.song", { a: p.a, k: t("sk." + e.k) });
      case "win": return t("ev.win", { gold: e.gold, xp: e.xp });
      case "lvl": return t("ev.lvl", { n: e.n });
      case "gear": return t("ev.gear", { g: t("gear." + e.g) });
      case "buy": return t("ev.buy", { g: itemOrGear(e.g) });
      case "item": return t("ev.item", { i: t("item." + e.i) });
      case "xp": return t("ev.xp", p);
      case "goldUp": return t("ev.goldUp", p);
      case "mhp": return t("ev.mhp");
    }
    return "";
  }
  function itemOrGear(g) { return E.GEAR[g] ? t("gear." + g) : t("item." + g); }
  // Floating numbers and the message line, one event after another.
  function handleEvents(ev, wasFight) {
    var delay = 0, step = prefs.fast ? 60 : 260, lines = [];
    var sounds = {};
    ev.forEach(function (e) {
      var text = evText(e);
      if (text) lines.push(text);
      if (e.e === "hit" || e.e === "burn") {
        addFx(e.d, "−" + e.n, e.e === "burn" ? "burn" : (e.d.charAt(0) === "h" ? "hurt" : "hit"), delay);
        if (e.c) addFx(e.d, t("combo." + e.c), "combo", delay);
        sounds[e.d.charAt(0) === "h" ? "hurt" : "hit"] = 1;
        if (e.s && e.s.charAt(0) === "f") delay += step;
      } else if (e.e === "heal" && e.n > 0) { addFx(e.d, "+" + e.n, "heal", delay); sounds.heal = 1; }
      else if (e.e === "focus") addFx(e.d, "+" + e.n, "focus", delay);
      else if (e.e === "fall") { addFx(e.d, "✕", "hurt", delay); sounds.fall = 1; }
      else if (e.e === "stun" || e.e === "status" || e.e === "song") sounds.use = 1;
      else if (e.e === "win") sounds.win = 1;
      else if (e.e === "lose") sounds.end = 1;
      else if (e.e === "fight") { sounds.fight = 1; delay = 0; }
      else if (e.e === "lvl") sounds.lvl = 1;
      else if (e.e === "phase") { shake(); sounds.hurt = 1; }
    });
    busyUntil = Date.now() + Math.min(delay, 1600);
    ["fight", "hit", "hurt", "heal", "use", "fall", "lvl", "win", "end"].forEach(function (k) { if (sounds[k]) sfx(k); });
    // the message line walks through what happened
    if (!wasFight && st.fight) lines.push(t("fight." + st.fight.kind));
    if (st.fight && curHero() >= 0) lines.push(t("fight.your", { k: heroName(curHero()) }));
    var shown = lines.filter(function (x) { return x; });
    if (!shown.length) return;
    if (prefs.fast || shown.length === 1) { setMsg(shown[shown.length - 1]); live(shown.slice(-3).join(". ")); }
    else {
      var k = 0, gap = Math.max(160, Math.min(step, 1600 / shown.length));
      (function next() {
        setMsg(shown[k]);
        k++;
        if (k < shown.length) msgTimer = setTimeout(next, gap);
      })();
      live(shown.slice(-4).join(". "));
    }
  }
  var msgTimer = null;

  // ---------- 5. Scene ----------
  var canvas, ctx, W = 0, H = 0, DPR = 1;
  var hits = [];          // [{ x, y, w, h, r: unit ref | n: node index }]
  var fx = [];            // floating texts
  var colors = {};

  function resize() {
    var main = $("scene"), r = main.getBoundingClientRect();
    DPR = Math.min(2, window.devicePixelRatio || 1);
    W = Math.max(200, Math.floor(r.width));
    H = Math.max(160, Math.floor(r.height));
    canvas.width = Math.round(W * DPR);
    canvas.height = Math.round(H * DPR);
    canvas.style.width = W + "px";
    canvas.style.height = H + "px";
    draw();
  }
  function readColors() {
    var cs = getComputedStyle(document.documentElement);
    ["--bg", "--text", "--text-dim", "--accent", "--panel-bg", "--border", "--danger",
     "--wf-ground", "--wf-ground2", "--wf-road", "--wf-hero", "--wf-foe", "--wf-hp", "--wf-fo",
     "--wf-fire", "--wf-ice", "--wf-mark", "--wf-song"].forEach(function (v) {
      colors[v.replace(/^--/, "")] = cs.getPropertyValue(v).trim() || "#888";
    });
  }
  function addFx(r, text, kind, delay) {
    fx.push({ r: r, text: text, kind: kind, t0: Date.now() + (delay || 0) });
    if (!fxRunning) { fxRunning = true; requestAnimationFrame(fxLoop); }
  }
  var fxRunning = false;
  function fxLoop() {
    var now = Date.now();
    fx = fx.filter(function (f) { return now - f.t0 < 1100; });
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
    knight: "M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6z",
    ranger: "M6 3a16 16 0 0 1 15 15M6 3l15 15M3 21l6-6M6 3h4M6 3v4",
    mage: "M12 3l2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5z",
    cleric: "M12 4v16M6 9h12M8 21h8",
    rogue: "M19 5l-9 9M15 3l6 6M8 12l4 4M5 19l3-3",
    bard: "M9 18V5l11-2v13M9 18a3 3 0 1 1-6 0 3 3 0 0 1 6 0zM20 16a3 3 0 1 1-6 0 3 3 0 0 1 6 0z",
    sprout: "M5 19c0-8 6-14 14-14 0 8-6 14-14 14zM5 19l7-7",
    wolf: "M4 20l2-15 4 5h4l4-5 2 15-8 2zM9 14h.01M15 14h.01",
    boar: "M4 14c0-5 4-8 8-8s8 3 8 8-4 6-8 6-8-1-8-6zM8 16l-2 4M16 16l2 4",
    sprite: "M12 3s7 7 7 12a7 7 0 0 1-14 0c0-5 7-12 7-12z",
    archer: "M6 3a16 16 0 0 1 15 15M6 3l15 15M3 21l6-6",
    moss: "M3 16a9 8 0 0 1 18 0zM3 16h18M7 16v3M17 16v3M9 10l3 3 3-3",
    witch: "M3 20h18M7 20l5-17 5 17M9 14h6",
    captain: "M5 18v-6a7 7 0 0 1 14 0v6zM5 13h14M12 5v8",
    king: "M3 18l2-11 5 5 2-7 2 7 5-5 2 11z",
    s: "M6 22V3M6 4h12l-3 4.5 3 4.5H6",
    f: "M14.5 17.5 3 6V3h3l11.5 11.5M13 19l6-6M16 16l4 4M19 21l2-2",
    h: "M14.5 17.5 3 6V3h3l11.5 11.5M13 19l6-6M16 16l4 4M19 21l2-2M14.5 6.5 18 3h3v3l-3.5 3.5M5 14l4 4M7 17l-3 3M3 19l2 2",
    c: "M12 3c3 4-2 5 0 9 3-1 3-4 3-4 2 3 2 9-3 9s-6-4-4-8c1 2 2 2 2 2-1-4 2-6 2-8zM5 21h14",
    m: "M6 8h12l-1 12H7zM9 8a3 3 0 0 1 6 0",
    e: "M9 9a3 3 0 1 1 4 2.8c-.8.4-1 1-1 1.7V15M12 19h.01",
    g: "M3 18l2-11 5 5 2-7 2 7 5-5 2 11z",
    mvhit: "M14.5 4H20v5.5L9 20.5 3.5 15z",
    mvall: "M3 9c3-4 6-4 9 0s6 4 9 0M3 16c3-4 6-4 9 0s6 4 9 0",
    mvheal: "M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z",
    mvshell: "M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6z",
    mvrally: "M6 22V3M6 4h12l-3 4.5 3 4.5H6",
    bu: "M12 3c3 4-2 5 0 9 3-1 3-4 3-4 2 3 2 9-3 9s-6-4-4-8c1 2 2 2 2 2-1-4 2-6 2-8z",
    ch: "M12 2v20M3 7l18 10M3 17l18-10",
    sn: "M12 3l2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5z",
    mk: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z",
    gu: "M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6z",
    hi: "M3 12s3-6 9-6 9 6 9 6-3 6-9 6-9-6-9-6zM4 4l16 16",
    pb: "M9 18V5l11-2v13M9 18a3 3 0 1 1-6 0 3 3 0 0 1 6 0z",
    sb: "M13 2 3 14h9l-1 8 10-12h-9z",
    ta: "M12 3v11M12 19h.01",
    cv: "M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6z",
    sh: "M3 16a9 8 0 0 1 18 0z",
    rv: "M6 22V3M6 4h12l-3 4.5 3 4.5H6",
    wet: "M12 3s7 7 7 12a7 7 0 0 1-14 0c0-5 7-12 7-12z"
  };
  var pathCache = {};
  function icon(name, x, y, size, color, width) {
    if (!P[name] || typeof Path2D === "undefined") return;
    var p = pathCache[name] || (pathCache[name] = new Path2D(P[name]));
    ctx.save();
    ctx.translate(x - size / 2, y - size / 2);
    ctx.scale(size / 24, size / 24);
    ctx.strokeStyle = color;
    ctx.lineWidth = (width || 2) * 24 / size;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.stroke(p);
    ctx.restore();
  }
  function paint() {
    if (!ctx) return;
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    ctx.fillStyle = colors["wf-ground"];
    ctx.fillRect(0, 0, W, H);
    hits = [];
    if (!st) return;
    if (st.fight) paintFight(); else paintMap();
    paintFx();
  }
  function fxPos(r) {
    for (var k = 0; k < hits.length; k++) if (hits[k].r === r) return { x: hits[k].x + hits[k].w / 2, y: hits[k].y + hits[k].h * 0.35 };
    return null;
  }
  function paintFx() {
    var now = Date.now();
    var stack = {};
    fx.forEach(function (f) {
      var age = now - f.t0;
      if (age < 0) return;
      var p = fxPos(f.r);
      if (!p) return;
      var n = stack[f.r] = (stack[f.r] || 0) + 1;
      var k = age / 1100;
      ctx.globalAlpha = Math.max(0, 1 - k * k);
      ctx.font = "800 " + (f.kind === "combo" ? 13 : 17) + "px Nunito, system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.lineWidth = 3;
      ctx.strokeStyle = "rgba(0,0,0,0.6)";
      ctx.fillStyle = f.kind === "heal" ? colors["wf-hp"] : f.kind === "focus" ? colors["wf-fo"] : f.kind === "burn" ? colors["wf-fire"] :
        f.kind === "combo" ? colors.accent : f.kind === "hurt" ? colors.danger : colors.text;
      var y = p.y - 18 * k - (n - 1) * 16;
      ctx.strokeText(f.text, p.x, y);
      ctx.fillText(f.text, p.x, y);
      ctx.globalAlpha = 1;
    });
  }

  // The path map: columns left to right, the party strip below.
  function mapLayout() {
    var stripH = Math.min(92, Math.max(64, H * 0.24));
    var top = 30, bottom = H - stripH - 10, left = 22, right = W - 22;
    var nodes = st.map.map(function (n) {
      var colSize = st.map.filter(function (m) { return m.c === n.c; }).length;
      var x = left + (right - left) * n.c / (E.COLS - 1);
      var y = top + (bottom - top) * (n.r + 1) / (colSize + 1);
      return { x: x, y: y };
    });
    return { nodes: nodes, stripH: stripH, r: Math.max(13, Math.min(22, (right - left) / (E.COLS - 1) * 0.36)) };
  }
  function paintMap() {
    var L = mapLayout(), reachable = E.reach(st), walked = {};
    for (var k = 1; k < st.path.length; k++) walked[st.path[k - 1] + ">" + st.path[k]] = 1;
    ctx.font = "800 13px Nunito, system-ui, sans-serif";
    ctx.fillStyle = colors["text-dim"];
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillText(t("map.at", { r: t("region." + E.REGIONS[st.region - 1].id), n: st.map[st.at].c + 1, m: E.COLS }), 12, 15);
    // roads
    st.map.forEach(function (n, i) {
      n.e.forEach(function (j) {
        var a = L.nodes[i], b = L.nodes[j], on = walked[i + ">" + j];
        ctx.strokeStyle = on ? colors.accent : colors["wf-road"];
        ctx.lineWidth = on ? 3 : 2;
        ctx.setLineDash(on ? [] : [4, 5]);
        ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
      });
    });
    ctx.setLineDash([]);
    // stops
    st.map.forEach(function (n, i) {
      var p = L.nodes[i], r = n.k === "g" ? L.r * 1.25 : L.r, can = reachable.indexOf(i) >= 0;
      var past = st.path.indexOf(i) >= 0;
      ctx.beginPath();
      ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
      ctx.fillStyle = colors["panel-bg"];
      ctx.fill();
      ctx.lineWidth = can ? 3 : 1.5;
      ctx.strokeStyle = can ? colors.accent : past ? colors["text-dim"] : colors.border;
      ctx.stroke();
      if (can && reachable[cursor % reachable.length] === i && kbUsed) {
        ctx.beginPath(); ctx.arc(p.x, p.y, r + 5, 0, Math.PI * 2);
        ctx.strokeStyle = colors.text; ctx.lineWidth = 2; ctx.stroke();
      }
      var col = n.k === "h" || n.k === "g" ? colors["wf-foe"] : n.k === "c" ? colors["wf-fire"] : n.k === "m" ? colors.accent :
        n.k === "e" ? colors["wf-song"] : n.k === "s" ? colors["wf-hp"] : colors.text;
      icon(n.k, p.x, p.y, r * 1.15, past && !can && i !== st.at ? colors["text-dim"] : col, 2);
      if (can) hits.push({ x: p.x - r - 4, y: p.y - r - 4, w: 2 * r + 8, h: 2 * r + 8, n: i });
    });
    // the party marker
    var at = L.nodes[st.at];
    ctx.fillStyle = colors["wf-hero"];
    ctx.beginPath();
    ctx.moveTo(at.x, at.y - L.r - 4);
    ctx.lineTo(at.x - 6, at.y - L.r - 14);
    ctx.lineTo(at.x + 6, at.y - L.r - 14);
    ctx.closePath();
    ctx.fill();
    // party strip
    var y0 = H - L.stripH, w = Math.min(240, (W - 16) / 3), x1 = (W - 3 * w) / 2 + 3;
    for (var i = 0; i < 3; i++) heroCard(i, x1 + i * w, y0, w - 6, L.stripH - 8, false);
  }
  function bar(x, y, w, h, frac, col) {
    rr(x, y, w, h, h / 2);
    ctx.fillStyle = colors.border;
    ctx.fill();
    if (frac > 0) {
      rr(x, y, Math.max(h, w * clamp(frac, 0, 1)), h, h / 2);
      ctx.fillStyle = col;
      ctx.fill();
    }
  }
  function heroCard(i, x, y, w, h, inFight) {
    var hs = E.heroStats(st, i), hero = st.party[i], fallen = hero.hp <= 0, r = "h" + i;
    var cur = inFight && st.fight.cur === r, lit = inFight && litTargets().indexOf(i) >= 0 && sel && sel.tgKind === "hero";
    rr(x, y, w, h, 10);
    ctx.fillStyle = colors["panel-bg"];
    ctx.fill();
    ctx.lineWidth = cur || lit ? 3 : 1;
    ctx.strokeStyle = lit ? colors.accent : cur ? colors["wf-hero"] : colors.border;
    ctx.stroke();
    if (lit && kbUsed && litTargets()[cursor % litTargets().length] === i) {
      rr(x - 3, y - 3, w + 6, h + 6, 12); ctx.strokeStyle = colors.text; ctx.lineWidth = 2; ctx.stroke();
    }
    ctx.globalAlpha = fallen ? 0.4 : 1;
    var is = Math.min(h * 0.42, 30);
    icon(hero.c, x + 6 + is / 2, y + 6 + is / 2, is, colors["wf-hero"], 2.2);
    ctx.font = "800 12px Nunito, system-ui, sans-serif";
    ctx.fillStyle = colors.text;
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    var nm = t("cls." + hero.c);
    ctx.fillText(fitText(nm, w - is - 16), x + is + 12, y + 6 + is * 0.3);
    ctx.font = "700 11px Nunito, system-ui, sans-serif";
    ctx.fillStyle = colors["text-dim"];
    ctx.fillText(fallen ? t("party.fallen") : hero.hp + "/" + hs.mh, x + is + 12, y + 6 + is * 0.8);
    bar(x + 6, y + h - (inFight ? 20 : 12), w - 12, 6, hero.hp / hs.mh, colors["wf-hp"]);
    if (inFight) {
      var fo = st.fight.hs[i].fo;
      for (var k = 0; k < hs.fo; k++) {
        ctx.beginPath();
        ctx.arc(x + 9 + k * 9, y + h - 8, 3, 0, Math.PI * 2);
        ctx.fillStyle = k < fo ? colors["wf-fo"] : colors.border;
        ctx.fill();
      }
      statusIcons(st.fight.hs[i].st, false, x + w - 8, y + h - 8);
    }
    ctx.globalAlpha = 1;
    hits.push({ x: x, y: y, w: w, h: h, r: r, hero: i });
  }
  function fitText(s, w) {
    if (ctx.measureText(s).width <= w) return s;
    while (s.length > 1 && ctx.measureText(s + "…").width > w) s = s.slice(0, -1);
    return s + "…";
  }
  var STS = ["bu", "ch", "sn", "mk", "gu", "hi", "pb", "sb", "ta", "cv", "sh", "rv"];
  var STS_COL = { bu: "wf-fire", ch: "wf-ice", sn: "accent", mk: "wf-mark", gu: "wf-fo", hi: "text-dim", pb: "wf-song", sb: "wf-song",
    ta: "wf-foe", cv: "wf-fo", sh: "wf-fo", rv: "wf-foe", wet: "wf-ice" };
  function stsList(s, isWet) {
    var out = STS.filter(function (k) { return s[k] > 0; });
    if (isWet) out.push("wet");
    return out;
  }
  // Status icons right-aligned ending at x.
  function statusIcons(s, isWet, x, y) {
    stsList(s, isWet).slice(0, 5).forEach(function (k, n) {
      icon(k, x - n * 13, y, 11, colors[STS_COL[k]], 2.4);
    });
  }

  // A fight: the turn order on top, the foes with their next moves, the heroes below.
  function paintFight() {
    var fi = st.fight, qv = E.queueView(st);
    // turn order
    var order = qv.now.concat(["|"]).concat(qv.next).slice(0, 12), x = 8;
    order.forEach(function (r) {
      if (x > W - 22) return;
      if (r === "|") {
        ctx.strokeStyle = colors.border; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(x + 2, 6); ctx.lineTo(x + 2, 26); ctx.stroke();
        x += 8;
        return;
      }
      var isHero = r.charAt(0) === "h";
      var k = isHero ? st.party[+r.slice(1)].c : (foeById(+r.slice(1)) || {}).k;
      ctx.beginPath(); ctx.arc(x + 10, 16, 10, 0, Math.PI * 2);
      ctx.fillStyle = colors["panel-bg"]; ctx.fill();
      ctx.lineWidth = r === fi.cur ? 2.5 : 1;
      ctx.strokeStyle = r === fi.cur ? colors.accent : isHero ? colors["wf-hero"] : colors["wf-foe"];
      ctx.stroke();
      icon(k, x + 10, 16, 12, isHero ? colors["wf-hero"] : colors["wf-foe"], 2.4);
      x += 24;
    });
    var heroH = Math.min(96, Math.max(70, H * 0.26));
    var foeTop = 40, foeBottom = H - heroH - 14;
    var live = fi.foes.filter(function (f) { return f.hp > 0; });
    var n = live.length, perRow = n > 3 && W < 520 ? 3 : n;
    var rows = Math.ceil(n / perRow) || 1;
    var cellW = Math.min(150, (W - 16) / perRow), cellH = Math.min(170, (foeBottom - foeTop) / rows);
    foeTop += Math.max(0, (foeBottom - foeTop - rows * cellH) * 0.45);
    var tg = sel && sel.tgKind === "foe" ? litTargets() : [];
    live.forEach(function (f, k) {
      var row = Math.floor(k / perRow), col = k % perRow, inRow = Math.min(perRow, n - row * perRow);
      var x0 = (W - inRow * cellW) / 2 + col * cellW + 4, y0 = Math.round(foeTop + row * cellH);
      foeCard(f, x0, y0, cellW - 8, cellH - 8, tg.indexOf(f.id) >= 0, kbUsed && tg[cursor % (tg.length || 1)] === f.id);
    });
    var w = Math.min(240, (W - 16) / 3), y0 = H - heroH - 4, x1 = (W - 3 * w) / 2 + 3;
    for (var i = 0; i < 3; i++) heroCard(i, x1 + i * w, y0, w - 6, heroH, true);
  }
  function foeCard(f, x, y, w, h, lit, cur) {
    var F = E.FOES[f.k], r = "f" + f.id;
    // the shown move, on top
    var bh = 22;
    if (f.n) {
      var M = E.MOVES[f.n.m], k = M.k;
      rr(x + 2, y, w - 4, bh, 8);
      ctx.fillStyle = k === "hit" || k === "all" ? "rgba(224,108,117,0.18)" : "rgba(111,155,209,0.18)";
      ctx.fill();
      var ic = k === "hit" ? "mvhit" : k === "all" ? "mvall" : k === "heal" ? "mvheal" : k === "shell" ? "mvshell" : "mvrally";
      icon(ic, x + 14, y + bh / 2, 13, k === "hit" || k === "all" ? colors["wf-foe"] : colors["wf-fo"], 2.4);
      ctx.font = "800 12px Nunito, system-ui, sans-serif";
      ctx.textAlign = "left";
      ctx.textBaseline = "middle";
      ctx.fillStyle = colors.text;
      var est = estimate(f);
      var label = est !== null ? String(est) : "";
      ctx.fillText(label, x + 24, y + bh / 2 + 1);
      if (k === "hit" && f.n.tg >= 0) icon(st.party[f.n.tg].c, x + w - 14, y + bh / 2, 13, colors["wf-hero"], 2.4);
      if (k === "all") { ctx.textAlign = "right"; ctx.fillStyle = colors["text-dim"]; ctx.fillText("×3", x + w - 8, y + bh / 2 + 1); }
    }
    var cy = y + bh + 4, ch = h - bh - 4;
    rr(x, cy, w, ch, 10);
    ctx.fillStyle = colors["panel-bg"];
    ctx.fill();
    ctx.lineWidth = lit ? 3 : 1;
    ctx.strokeStyle = lit ? colors.accent : st.fight.cur === r ? colors["wf-foe"] : colors.border;
    ctx.stroke();
    if (cur) { rr(x - 3, cy - 3, w + 6, ch + 6, 12); ctx.strokeStyle = colors.text; ctx.lineWidth = 2; ctx.stroke(); }
    var named = w >= 96 && ch >= 96;
    var is = Math.min(ch - (named ? 44 : 28), w * 0.55, F.boss ? 72 : 56);
    icon(f.k, x + w / 2, cy + 6 + is / 2, is, colors["wf-foe"], 2.2);
    if (named) {
      ctx.font = "700 11px Nunito, system-ui, sans-serif";
      ctx.fillStyle = colors.text;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(fitText(t("foe." + f.k), w - 10), x + w / 2, cy + ch - 30);
    }
    bar(x + 6, cy + ch - 18, w - 12, 6, f.hp / f.mh, colors["wf-foe"]);
    ctx.font = "700 10px Nunito, system-ui, sans-serif";
    ctx.fillStyle = colors["text-dim"];
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillText(String(f.hp), x + 6, cy + ch - 6);
    statusIcons(f.st, !!F.wet, x + w - 8, cy + ch - 6);
    hits.push({ x: x, y: cy, w: w, h: ch, r: r, foe: f.id });
  }
  // Damage the shown move would do to its target now (null for no damage).
  function estimate(f) {
    var M = E.MOVES[f.n.m];
    if (M.k !== "hit" && M.k !== "all") return M.k === "heal" ? M.n : null;
    var pw = E.foeStats(f).pw, n = Math.round(pw * M.f);
    if (M.k === "hit" && f.n.tg >= 0) {
      var tgt = f.n.tg;
      for (var k = 0; k < 3; k++) if (k !== tgt && st.party[k].hp > 0 && st.fight.hs[k].st.cv === tgt + 1) tgt = k;
      n -= E.heroStats(st, tgt).gd;
      if (st.fight.hs[tgt].st.gu) n = Math.floor(n / 2);
    }
    return Math.max(1, n);
  }
  function reducedMotion() {
    try { return window.matchMedia("(prefers-reduced-motion: reduce)").matches; } catch (e) { return false; }
  }
  function shake() {
    if (reducedMotion()) return;
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
  // Targets lit for the chosen action: foe ids or hero indexes.
  function litTargets() {
    var i = curHero();
    if (!sel || i < 0) return [];
    if (sel.a === "item") {
      var out = [];
      for (var k = 0; k < 3; k++) if (sel.i === "f" ? st.party[k].hp <= 0 : st.party[k].hp > 0) out.push(k);
      return out;
    }
    var list = E.targets(st, i, sel.a);
    return list[0] === -1 ? [] : list;
  }
  function tgKindOf(a) {
    if (a === "item") return "hero";
    if (a === "atk") return "foe";
    var tg = E.SKILLS[a].tg;
    return tg === "foe" ? "foe" : (tg === "ally" || tg === "other" || tg === "fallen") ? "hero" : "none";
  }
  function hitAt(x, y) {
    for (var k = hits.length - 1; k >= 0; k--) {
      var h = hits[k];
      if (x >= h.x && x <= h.x + h.w && y >= h.y && y <= h.y + h.h) return h;
    }
    return null;
  }
  function tap(x, y) {
    if (!st || st.over >= 0 || Date.now() < busyUntil) return;
    var h = hitAt(x, y);
    if (!h) return;
    if (!st.fight) {
      if (h.n !== undefined) { doAct({ t: "go", n: h.n }); return; }
      if (h.hero !== undefined) partyDialog();
      return;
    }
    if (!sel) { if (h.r) infoDialog(h.r); return; }
    var lit = litTargets();
    if (sel.tgKind === "foe" && h.foe !== undefined && lit.indexOf(h.foe) >= 0) aimAt(h.foe);
    else if (sel.tgKind === "hero" && h.hero !== undefined && lit.indexOf(h.hero) >= 0) aimAt(h.hero);
    else if (h.r) infoDialog(h.r);
  }
  function aimAt(x) {
    if (sel.a === "atk") doAct({ t: "atk", x: x });
    else if (sel.a === "item") doAct({ t: "item", i: sel.i, x: x });
    else doAct({ t: "sk", s: sel.a, x: x });
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
      press = { x: p.x, y: p.y, t: Date.now(), long: false };
      press.timer = setTimeout(function () {
        if (!press) return;
        press.long = true;
        var h = hitAt(press.x, press.y);
        if (h && h.r) infoDialog(h.r);
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
      if (!p.long) tap(p.x, p.y);
    });
    canvas.addEventListener("pointercancel", function () { if (press) clearTimeout(press.timer); press = null; });
    canvas.addEventListener("contextmenu", function (e) { e.preventDefault(); });
  }
  function wireKeyboard() {
    document.addEventListener("keydown", function (e) {
      if (document.querySelector("dialog[open]") || e.ctrlKey || e.metaKey || e.altKey) return;
      var k = e.key;
      if (k === "n" || k === "N") { e.preventDefault(); newDialog(); return; }
      if (k === "p" || k === "P") { e.preventDefault(); partyDialog(); return; }
      if (!st || st.over >= 0 || Date.now() < busyUntil) return;
      var list = st.fight ? litTargets() : E.reach(st);
      if (k === "ArrowRight" || k === "ArrowDown" || k === "ArrowLeft" || k === "ArrowUp") {
        e.preventDefault();
        kbUsed = true;
        if (list.length) cursor = (cursor + (k === "ArrowRight" || k === "ArrowDown" ? 1 : list.length - 1)) % list.length;
        draw();
        return;
      }
      if (k === "Enter" || k === " ") {
        if (document.activeElement && document.activeElement.tagName === "BUTTON") return;
        e.preventDefault();
        if (!st.fight) { if (list.length) doAct({ t: "go", n: list[cursor % list.length] }); return; }
        if (sel && list.length) aimAt(list[cursor % list.length]);
        else if (sel && sel.tgKind === "none") pickAction(sel.a);
        return;
      }
      if (k === "Escape" && sel) { e.preventDefault(); sel = null; renderActs(); draw(); return; }
      if (st.fight && /^[1-9]$/.test(k)) {
        var btns = $("acts").querySelectorAll("button.act");
        var b = btns[+k - 1];
        if (b && !b.disabled) { e.preventDefault(); b.click(); }
      }
    });
  }
  // Tap on an action: aim it, or (no target) arm it and act on the second tap.
  function pickAction(a, item) {
    if (Date.now() < busyUntil) return;
    var i = curHero();
    if (i < 0) return;
    if (a === "guard") { doAct({ t: "guard" }); return; }
    if (a === "item" && !item) { itemDialog(); return; }
    var kind = tgKindOf(a);
    if (kind === "none") {
      if (sel && sel.a === a && sel.armed) { doAct({ t: "sk", s: a }); return; }
      sel = { a: a, tgKind: "none", armed: 1 };
      setMsg(t("sk.again", { k: t("sk." + a) }) + " · " + t("sk." + a + ".d"));
    } else {
      if (sel && sel.a === a && sel.i === item) { sel = null; setMsg(t("fight.your", { k: heroName(i) })); }
      else {
        sel = { a: a, i: item, tgKind: kind };
        cursor = 0;
        setMsg(t("sk.pick", { k: a === "item" ? t("item." + item) : t("sk." + a) }) + " · " + (a === "item" ? t("item." + item + ".d") : t("sk." + a + ".d")));
      }
    }
    renderActs();
    draw();
  }

  // ---------- 7. Panels ----------
  function renderAll() {
    renderStatus();
    renderActs();
    draw();
  }
  function renderStatus() {
    if (!st) return;
    var next = E.LEVELS[st.lvl] || E.LEVELS[E.LEVELS.length - 1], prev = E.LEVELS[st.lvl - 1] || 0;
    var lv = $("s-lvl");
    lv.querySelector(".v").textContent = t("st.lvl", { n: st.lvl });
    lv.querySelector(".fill").style.width = (st.lvl >= E.MAX_LVL ? 100 : clamp((st.xp - prev) / (next - prev), 0, 1) * 100) + "%";
    lv.title = st.lvl >= E.MAX_LVL ? t("st.lvl", { n: st.lvl }) : t("st.xp", { n: st.xp, m: next });
    $("s-gold").querySelector(".v").textContent = String(st.gold);
    $("s-gold").title = t("st.gold", { n: st.gold });
    ["p", "t", "f"].forEach(function (k) {
      var n = $("s-" + k);
      n.querySelector(".v").textContent = String(st.inv[k]);
      n.title = t("st." + k, { n: st.inv[k] });
      n.setAttribute("aria-label", n.title);
    });
  }
  function actBtn(label, cost, on, pressed, fn, title) {
    var b = el("button", "act");
    b.type = "button";
    b.appendChild(el("span", "nm", label));
    if (cost) b.appendChild(el("span", "cost", cost));
    b.disabled = !on;
    b.setAttribute("aria-pressed", pressed ? "true" : "false");
    b.title = title || label;
    b.addEventListener("click", fn);
    return b;
  }
  function renderActs() {
    var bar = $("acts");
    bar.innerHTML = "";
    if (!st) return;
    var i = curHero();
    if (!st.fight || i < 0 || st.over >= 0) {
      var note = st.over >= 0 ? "" : st.fight ? "" : st.pend.length ? "" : t("map.go");
      bar.appendChild(el("div", "acts-note", note));
      return;
    }
    var hero = st.party[i], fo = st.fight.hs[i].fo;
    bar.appendChild(actBtn(t("sk.atk"), "", true, sel && sel.a === "atk", function () { pickAction("atk"); }, t("sk.atk.d")));
    E.CLASSES[hero.c].sk.forEach(function (s) {
      var on = E.usable(st, i, s);
      bar.appendChild(actBtn(t("sk." + s), t("sk.cost", { n: E.SKILLS[s].cost }), on, sel && sel.a === s, function () { pickAction(s); },
        t("sk." + s + ".d") + (fo < E.SKILLS[s].cost ? " · " + t("sk.noFo") : "")));
    });
    bar.appendChild(actBtn(t("sk.guard"), "", true, false, function () { pickAction("guard"); }, t("sk.guard.d")));
    var anyItem = st.inv.p > 0 || st.inv.t > 0 || st.inv.f > 0;
    bar.appendChild(actBtn(t("sk.item"), "", anyItem, sel && sel.a === "item", function () { pickAction("item"); }, t("sk.item.d")));
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
  function show(dlg, focus) {
    document.body.appendChild(dlg);
    dlg.showModal();
    if (focus) focus.focus();
  }

  function newDialog() {
    cancelTourWait();
    var o = { diff: prefs.diff, party: prefs.party.slice() };
    var dlg = makeDialog("wf-new");
    dlg.appendChild(el("div", "dlg-title", t("new.title")));
    var note = el("div", "dlg-note", t("diff." + o.diff + ".note"));
    dlg.appendChild(segField(t("new.diff"), DIFFS, o.diff, "diff.", function (v) { o.diff = v; note.textContent = t("diff." + v + ".note"); }));
    dlg.appendChild(note);
    var f = el("div", "dlg-field");
    var lab = el("div", "dlg-label", t("new.party"));
    f.appendChild(lab);
    var grid = el("div", "pc-grid");
    grid.setAttribute("role", "group");
    grid.setAttribute("aria-label", t("new.party"));
    var countNote = el("div", "dlg-note");
    var go;
    function refresh() {
      [].forEach.call(grid.children, function (b) {
        b.setAttribute("aria-pressed", o.party.indexOf(b.getAttribute("data-c")) >= 0 ? "true" : "false");
      });
      countNote.textContent = t("new.count", { n: o.party.length });
      if (go) go.disabled = o.party.length !== 3;
    }
    CLASS_IDS.forEach(function (c) {
      var b = el("button", "pc-btn");
      b.type = "button";
      b.setAttribute("data-c", c);
      b.appendChild(el("span", "nm", t("cls." + c)));
      b.appendChild(el("span", "fx", t("cls." + c + ".note")));
      b.addEventListener("click", function () {
        var k = o.party.indexOf(c);
        if (k >= 0) o.party.splice(k, 1);
        else if (o.party.length < 3) o.party.push(c);
        else { o.party.shift(); o.party.push(c); }
        refresh();
      });
      grid.appendChild(b);
    });
    f.appendChild(grid);
    f.appendChild(countNote);
    dlg.appendChild(f);
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
    go = button(t("new.start"), "primary", function () {
      if (o.party.length !== 3) return;
      // keep the party in the order of the class list: front row first
      var party = CLASS_IDS.filter(function (c) { return o.party.indexOf(c) >= 0; });
      party.sort(function (a, b) { return (E.CLASSES[a].row === "f" ? 0 : 1) - (E.CLASSES[b].row === "f" ? 0 : 1); });
      prefs.diff = o.diff;
      prefs.party = party;
      savePrefs();
      dlg.close();
      startGame({ diff: o.diff, seed: cleanSeed(seed.value) || newSeed(), party: party });
    });
    acts.appendChild(go);
    dlg.appendChild(acts);
    refresh();
    show(dlg, go);
  }

  // What a piece of gear does, in words.
  function gearText(g) {
    var G = E.GEAR[g], out = [];
    ["pw", "hp", "gd", "sp"].forEach(function (k) {
      if (G[k]) out.push(t("fx." + k, { n: (G[k] > 0 ? "+" : "") + G[k] }));
    });
    if (G.sf) out.push(t("fx.sf", { n: G.sf }));
    return t("gear." + G.s) + " · " + out.join(", ");
  }
  function skillLine(s) {
    var d = el("div", "sk");
    d.appendChild(el("b", "", t("sk." + s)));
    d.appendChild(document.createTextNode(" (" + t("sk.cost", { n: E.SKILLS[s].cost }) + "): " + t("sk." + s + ".d")));
    return d;
  }
  function partyDialog() {
    if (!game) return;
    var dlg = makeDialog("wf-party");
    var inFight = !!st.fight || st.over >= 0;
    dlg.appendChild(el("div", "dlg-title", t("party.title") + " · " + t("party.level", { n: st.lvl, x: st.xp })));
    var box = el("div", "dlg-scroll");
    for (var i = 0; i < 3; i++) (function (i) {
      var h = st.party[i], hs = E.heroStats(st, i), card = el("div", "hero-card");
      var hd = el("div", "hd");
      hd.appendChild(document.createTextNode(t("cls." + h.c)));
      hd.appendChild(el("span", "", h.hp > 0 ? h.hp + " / " + hs.mh : t("party.fallen")));
      card.appendChild(hd);
      var sts = el("div", "sts");
      [["fx.pw", hs.pw], ["fx.gd", hs.gd], ["fx.sp", hs.sp], ["fx.fo", hs.fo]].forEach(function (x) {
        sts.appendChild(el("span", "", t(x[0], { n: x[1] })));
      });
      sts.appendChild(el("span", "", t("row." + E.CLASSES[h.c].row)));
      card.appendChild(sts);
      E.CLASSES[h.c].sk.forEach(function (s) { card.appendChild(skillLine(s)); });
      if (h.c === "rogue") {
        var bk = el("div", "sk");
        bk.appendChild(el("b", "", t("sk.back")));
        bk.appendChild(document.createTextNode(": " + t("sk.back.d")));
        card.appendChild(bk);
      }
      if (h.up.length) {
        var ups = {};
        h.up.forEach(function (u) { ups[u] = (ups[u] || 0) + 1; });
        card.appendChild(el("div", "sk", t("party.ups") + ": " + Object.keys(ups).map(function (u) { return t("up." + u) + (ups[u] > 1 ? " × " + ups[u] : ""); }).join(" · ")));
      }
      [["w", "w"], ["ch", "c"]].forEach(function (x) {
        var g = h[x[0]], eq = el("div", "eq");
        eq.appendChild(el("div", "tx", t("gear." + x[1]) + ": " + (g ? t("gear." + g) + " (" + gearText(g).split(" · ")[1] + ")" : t("gear.none"))));
        if (g && !inFight) {
          var off = button(t("party.off"), "", function () { doAct({ t: "unequip", h: i, s: x[1] }); dlg.close(); partyDialog(); });
          off.disabled = st.bag.length >= E.BAG_MAX;
          eq.appendChild(off);
        }
        card.appendChild(eq);
      });
      if (!inFight) {
        if (h.hp > 0 && h.hp < hs.mh && st.inv.p > 0) {
          var eqp = el("div", "eq");
          eqp.appendChild(el("div", "tx", t("item.p") + " · " + t("item.p.d")));
          eqp.appendChild(button(t("party.use"), "", function () { doAct({ t: "use", i: "p", h: i }); dlg.close(); partyDialog(); }));
          card.appendChild(eqp);
        }
        if (h.hp <= 0 && st.inv.f > 0) {
          var eqf = el("div", "eq");
          eqf.appendChild(el("div", "tx", t("item.f") + " · " + t("item.f.d")));
          eqf.appendChild(button(t("party.use"), "", function () { doAct({ t: "use", i: "f", h: i }); dlg.close(); partyDialog(); }));
          card.appendChild(eqf);
        }
      }
      box.appendChild(card);
    })(i);
    box.appendChild(el("div", "dlg-sub", t("party.bag")));
    if (!st.bag.length) box.appendChild(el("div", "dlg-note", t("party.empty")));
    st.bag.forEach(function (g, b) {
      var r = el("div", "sh-row"), tx = el("div", "sh-tx");
      tx.appendChild(el("div", "nm", t("gear." + g)));
      tx.appendChild(el("div", "fx", gearText(g)));
      r.appendChild(tx);
      box.appendChild(r);
      if (inFight) return;
      var acts = el("div", "dlg-actions wrap");
      acts.style.marginTop = "4px";
      for (var i = 0; i < 3; i++) (function (i) {
        acts.appendChild(button(t("party.equip", { k: heroName(i) }), "", function () { doAct({ t: "equip", h: i, b: b }); dlg.close(); partyDialog(); }));
      })(i);
      box.appendChild(acts);
    });
    if (inFight && st.over < 0) box.appendChild(el("div", "dlg-note", t("party.inFight")));
    dlg.appendChild(box);
    var acts2 = el("div", "dlg-actions");
    var close = button(t("stats.close"), "primary", function () { dlg.close(); });
    acts2.appendChild(close);
    dlg.appendChild(acts2);
    show(dlg, close);
  }

  // A unit's text: stats, statuses and (a foe) its next move.
  function infoDialog(r) {
    if (!st.fight) return;
    var dlg = makeDialog("wf-info"), lines = [];
    var isHero = r.charAt(0) === "h";
    if (isHero) {
      var i = +r.slice(1), hs = E.heroStats(st, i), h = st.party[i];
      dlg.appendChild(el("div", "dlg-title", heroName(i)));
      lines.push(t("info.hero", { name: heroName(i), hp: h.hp, mh: hs.mh, pw: hs.pw, gd: hs.gd, sp: E.speedOf(st, r), fo: st.fight.hs[i].fo, mf: hs.fo }));
      var s = stsList(st.fight.hs[i].st, false);
      if (s.length) lines.push(t("info.sts", { s: s.map(function (k) { return t("sts." + k); }).join(", ") }));
      lines.push(t("cls." + h.c + ".note"));
    } else {
      var f = foeById(+r.slice(1));
      if (!f) return;
      var fs = E.foeStats(f);
      dlg.appendChild(el("div", "dlg-title", t("foe." + f.k)));
      lines.push(t("info.foe", { name: t("foe." + f.k), hp: f.hp, mh: f.mh, pw: fs.pw, gd: fs.gd, sp: E.speedOf(st, r) }));
      var s2 = stsList(f.st, !!E.FOES[f.k].wet);
      if (s2.length) lines.push(t("info.sts", { s: s2.map(function (k) { return t("sts." + k); }).join(", ") }));
      if (f.n) {
        var M = E.MOVES[f.n.m], mv = t("mv." + f.n.m);
        lines.push(t("info.next", { m: M.k === "hit" && f.n.tg >= 0 ? t("info.on", { m: mv, k: heroName(f.n.tg) }) : M.k === "all" ? t("info.all", { m: mv }) : mv }));
      }
      lines.push(t("hab." + f.k));
    }
    lines.forEach(function (x) { dlg.appendChild(el("div", "dlg-msg", x)); });
    var acts = el("div", "dlg-actions");
    var close = button(t("stats.close"), "primary", function () { dlg.close(); });
    acts.appendChild(close);
    dlg.appendChild(acts);
    show(dlg, close);
  }
  function itemDialog() {
    var dlg = makeDialog("wf-item");
    dlg.appendChild(el("div", "dlg-title", t("sk.item")));
    var first = null;
    ["p", "t", "f"].forEach(function (k) {
      var r = el("div", "sh-row"), tx = el("div", "sh-tx");
      tx.appendChild(el("div", "nm", t("item." + k) + " × " + st.inv[k]));
      tx.appendChild(el("div", "fx", t("item." + k + ".d")));
      r.appendChild(tx);
      var b = button(t("party.use"), "", function () { dlg.close(); pickAction("item", k); });
      var any = false;
      for (var i = 0; i < 3; i++) if (k === "f" ? st.party[i].hp <= 0 : st.party[i].hp > 0) any = true;
      b.disabled = !(st.inv[k] > 0) || !any;
      if (!b.disabled && !first) first = b;
      r.appendChild(b);
      dlg.appendChild(r);
    });
    var acts = el("div", "dlg-actions");
    var close = button(t("new.cancel"), "", function () { dlg.close(); });
    acts.appendChild(close);
    dlg.appendChild(acts);
    show(dlg, first || close);
  }

  // The stop or choice waiting: camp, market, event, spoils, level up.
  function pendDialog() {
    if (!game || st.over >= 0 || st.fight || !st.pend.length || document.querySelector("dialog[open]")) return;
    var p = st.pend[0];
    var dlg = makeDialog("wf-pend");
    dlg.setAttribute("data-modal", "1");
    dlg.addEventListener("cancel", function (e) { e.preventDefault(); });
    var acts = el("div", "dlg-actions wrap"), first = null;
    function choice(label, fn, on) {
      var b = button(label, "", function () { dlg.close(); fn(); });
      b.disabled = on === false;
      b.style.flex = "1 1 100%";
      if (!b.disabled && !first) first = b;
      acts.appendChild(b);
      return b;
    }
    if (p.k === "up") {
      dlg.appendChild(el("div", "dlg-title", t("up.title", { k: heroName(p.h), n: st.lvl })));
      dlg.appendChild(el("div", "dlg-msg", t("up.text")));
      p.o.forEach(function (u, k) { choice(t("up." + u), function () { doAct({ t: "up", o: k }); }); });
    } else if (p.k === "loot") {
      dlg.appendChild(el("div", "dlg-title", t("loot.title")));
      dlg.appendChild(el("div", "dlg-msg", t("loot.text")));
      p.o.forEach(function (g, k) {
        choice(t("gear." + g) + " · " + gearText(g), function () { doAct({ t: "loot", o: k }); }, st.bag.length < E.BAG_MAX);
      });
      if (st.bag.length >= E.BAG_MAX) dlg.appendChild(el("div", "dlg-note bad", t("mk.full")));
      choice(t("loot.skip"), function () { doAct({ t: "loot", o: -1 }); });
    } else if (p.k === "camp") {
      dlg.appendChild(el("div", "dlg-title", t("camp.title")));
      dlg.appendChild(el("div", "ev-text", t("camp.text")));
      choice(t("camp.rest"), function () { doAct({ t: "rest" }); });
      for (var i = 0; i < 3; i++) (function (i) { choice(t("camp.train", { k: heroName(i) }), function () { doAct({ t: "train", h: i }); }); })(i);
    } else if (p.k === "mk") {
      marketDialog();
      return;
    } else if (p.k === "ev") {
      var ev = E.eventOf(p.id);
      dlg.appendChild(el("div", "dlg-title", t("evt.title." + p.id)));
      dlg.appendChild(el("div", "ev-text", t("evt." + p.id)));
      ev.o.forEach(function (o, k) {
        choice(t("evt." + p.id + "." + k), function () { doAct({ t: "ev", o: k }); }, E.choiceOk(st, o));
      });
      dlg.appendChild(el("div", "dlg-note", t("mk.gold", { n: st.gold })));
    }
    dlg.appendChild(acts);
    show(dlg, first);
  }
  function marketDialog() {
    var p = st.pend[0];
    var dlg = makeDialog("wf-pend");
    dlg.setAttribute("data-modal", "1");
    dlg.addEventListener("cancel", function (e) { e.preventDefault(); });
    dlg.appendChild(el("div", "dlg-title", t("mk.title")));
    dlg.appendChild(el("div", "dlg-sub", t("mk.gold", { n: st.gold })));
    var box = el("div", "dlg-scroll");
    p.s.forEach(function (s, k) {
      var r = el("div", "sh-row"), tx = el("div", "sh-tx");
      var isGear = !!E.GEAR[s.g];
      tx.appendChild(el("div", "nm", itemOrGear(s.g) + (isGear ? "" : " × " + st.inv[s.g])));
      tx.appendChild(el("div", "fx", (isGear ? gearText(s.g) : t("item." + s.g + ".d")) + " · " + t("mk.price", { n: s.p })));
      r.appendChild(tx);
      var why = isGear && s.n ? "mk.sold" : isGear && st.bag.length >= E.BAG_MAX ? "mk.full" : !isGear && st.inv[s.g] >= E.ITEMS[s.g].most ? "mk.most" : st.gold < s.p ? "mk.poor" : "";
      var b = button(why === "mk.sold" ? t("mk.sold") : t("mk.buy"), "", function () {
        if (doAct({ t: "buy", i: k })) { sfx("buy"); dlg.close(); setTimeout(marketDialog, 0); }
      });
      b.disabled = !!why;
      if (why && why !== "mk.sold") b.title = t(why);
      r.appendChild(b);
      box.appendChild(r);
    });
    dlg.appendChild(box);
    var acts = el("div", "dlg-actions");
    var leave = button(t("mk.leave"), "primary", function () { dlg.close(); doAct({ t: "leave" }); });
    acts.appendChild(leave);
    dlg.appendChild(acts);
    show(dlg, leave);
  }

  function resultDialog() {
    if (!game || st.over < 0 || document.querySelector("dialog[open]")) return;
    var dlg = makeDialog("wf-result");
    var won = st.over === 1;
    dlg.appendChild(el("div", "dlg-title", t("app.name") + " · " + t("diff." + game.opts.diff)));
    dlg.appendChild(el("div", "dlg-hero" + (won ? "" : " lost"), won ? t("res.won") : t("res.fell")));
    if (!won) dlg.appendChild(el("div", "dlg-msg", t("res.at", { k: t("stop." + st.map[st.at].k) + " · " + t("region." + E.REGIONS[st.region - 1].id) })));
    dlg.appendChild(row(t("res.lvl"), String(st.lvl)));
    dlg.appendChild(row(t("res.stops"), String(st.stops)));
    dlg.appendChild(row(t("res.kills"), String(st.kills)));
    dlg.appendChild(row(t("res.gold"), String(st.gold)));
    dlg.appendChild(el("div", "dlg-note", t("res.code", { seed: game.opts.seed })));
    var acts = el("div", "dlg-actions wrap");
    acts.appendChild(button(t("res.same"), "", function () { dlg.close(); startGame({ diff: game.opts.diff, seed: game.opts.seed, party: game.opts.party }); }));
    var again = button(t("res.new"), "primary", function () { dlg.close(); newDialog(); });
    acts.appendChild(again);
    dlg.appendChild(acts);
    show(dlg, again);
  }

  function statsDialog() {
    var dlg = makeDialog("wf-stats");
    dlg.appendChild(el("div", "dlg-title", t("stats.title")));
    dlg.appendChild(el("div", "dlg-sub", t("stats.head")));
    var empty = true;
    DIFFS.forEach(function (m) {
      var v = totals(m);
      if (v[0]) empty = false;
      dlg.appendChild(row(t("diff." + m), v[0] + " · " + v[1] + " · " + v[2]));
    });
    dlg.appendChild(el("div", "dlg-sub", t("stats.classes")));
    CLASS_IDS.forEach(function (k) { dlg.appendChild(row(t("cls." + k), String(classWins(k)))); });
    if (game) dlg.appendChild(el("div", "dlg-note", t("stats.code", { seed: game.opts.seed })));
    var acts = el("div", "dlg-actions wrap");
    if (DK && DK.hasHub()) acts.appendChild(button(t("daily.games"), "", function () { dlg.close(); DK.openHub("wayfarers"); }));
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
    var dlg = makeDialog("wf-confirm");
    dlg.appendChild(el("div", "dlg-msg", msg));
    var acts = el("div", "dlg-actions");
    var no = button(noLabel || t("confirm.no"), "", function () { dlg.close(); });
    acts.appendChild(no);
    acts.appendChild(button(yesLabel || t("confirm.yes"), "danger", function () { dlg.close(); onYes(); }));
    dlg.appendChild(acts);
    show(dlg, no);
  }
  // Reset = a new epoch: every device drops rows older than br.
  function resetRecords() {
    data.br = Math.max(Date.now(), data.br + 1);
    data = mergeWayfarers(data, data);
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
    var dlg = makeDialog("wf-tour");
    dlg.appendChild(el("div", "dlg-title", t("tour.title") + " · " + n + "/4"));
    dlg.appendChild(el("div", "dlg-msg", t("tour." + n)));
    var acts = el("div", "dlg-actions");
    function seen() { prefs.tour = true; savePrefs(); }
    if (n < 4) acts.appendChild(button(t("tour.skip"), "", function () { seen(); dlg.close(); }));
    var next = button(t(n < 4 ? "tour.next" : "tour.done"), "primary", function () {
      dlg.close();
      if (n < 4) setTimeout(function () { tourDialog(n + 1); }, 0);
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
          n.transient({ ns: "wayfarers", title: String(text) })) return;
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
  var HAPTIC = { hit: "tick", hurt: "bad", fall: "bad", heal: "tick", use: "tick", fight: "tick", buy: "tick", lvl: "good", win: "good", end: "bad" };
  function sfx(kind) {
    if (window.orosHaptics && HAPTIC[kind]) window.orosHaptics.cue(HAPTIC[kind]);
    if (!sfxOn()) return;
    try {
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      if (!audio) audio = new AC();
      if (audio.state === "suspended") audio.resume();
      if (kind === "hit") { tone(220, 0, 0.06, "square", 0.08); tone(165, 0.05, 0.08, "triangle", 0.1); }
      else if (kind === "hurt") tone(140, 0, 0.14, "sawtooth", 0.08);
      else if (kind === "fall") { tone(196, 0, 0.12, "triangle", 0.1); tone(131, 0.1, 0.22, "triangle", 0.1); }
      else if (kind === "heal") { tone(659, 0, 0.08, "sine", 0.1); tone(880, 0.07, 0.12, "sine", 0.08); }
      else if (kind === "use") { tone(523, 0, 0.1, "sine", 0.1); tone(784, 0.08, 0.14, "sine", 0.08); }
      else if (kind === "buy") { tone(1047, 0, 0.05, "sine", 0.08); tone(1319, 0.04, 0.07, "sine", 0.07); }
      else if (kind === "fight") [196, 262].forEach(function (f, k) { tone(f, k * 0.09, 0.16, "square", 0.06); });
      else if (kind === "lvl") [523, 659, 784].forEach(function (f, k) { tone(f, k * 0.09, 0.18, "triangle", 0.1); });
      else if (kind === "win") [523, 659, 784, 1047].forEach(function (f, k) { tone(f, k * 0.11, 0.22, "triangle"); });
      else if (kind === "end") { tone(392, 0, 0.18, "sine"); tone(262, 0.16, 0.34, "sine"); }
    } catch (e) { /* no audio → silent */ }
  }

  // ---------- Icons (R9: icon buttons ship empty, filled here) ----------
  var SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">';
  var UI_ICONS = {
    new:    SVG + '<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/></svg>',
    fast:   SVG + '<path d="M4 6l7 6-7 6zM13 6l7 6-7 6z"/></svg>',
    stats:  SVG + '<path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0z"/><path d="M17 5h3v2a3 3 0 0 1-3 3M7 5H4v2a3 3 0 0 0 3 3"/></svg>',
    sfxOn:  SVG + '<path d="M11 5 6 9H2v6h4l5 4z"/><path d="M15.5 8.5a5 5 0 0 1 0 7M19 5a10 10 0 0 1 0 14"/></svg>',
    sfxOff: SVG + '<path d="M11 5 6 9H2v6h4l5 4z"/><path d="M22 9l-6 6M16 9l6 6"/></svg>',
    gold:   SVG + '<circle cx="12" cy="12" r="8"/><path d="M12 8v8M9.5 10.5h4a1.5 1.5 0 0 1 0 3h-3"/></svg>',
    p:      SVG + '<path d="M9 3h6M10 3v5l-4 7a4 4 0 0 0 3.5 6h5A4 4 0 0 0 18 15l-4-7V3"/></svg>',
    t:      SVG + '<path d="M12 3l2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5z"/></svg>',
    f:      SVG + '<path d="M20 4C10 4 5 10 4 20M20 4c0 6-4 11-12 12M9 15c2-2 5-6 7-8"/></svg>'
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
    api.registerSlice("wayfarers", sliceGet, sliceSet, STORAGE_KEY, mergeWayfarers);
  }
  function sliceGet() { return mergeWayfarers(data, data); }   // canonical copy (R26)
  function sliceSet(incoming) {
    if (!incoming || typeof incoming !== "object" || !incoming.rows) return;
    window.__orosSyncApi._suppress = true;   // R6: a pull never marks dirty
    try {
      data = mergeWayfarers(incoming, incoming);
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
    $("party-btn").title = t("btn.partyKey");
  }
  function paintStatic() {
    [["new-btn", "new", "btn.new"], ["stats-btn", "stats", "btn.stats"]].forEach(function (x) {
      var b = $(x[0]);
      b.innerHTML = UI_ICONS[x[1]];
      b.setAttribute("aria-label", t(x[2]));
      b.title = t(x[2]);
    });
    [["s-gold", "gold"], ["s-p", "p"], ["s-t", "t"], ["s-f", "f"]].forEach(function (x) {
      $(x[0]).querySelector(".ic").innerHTML = UI_ICONS[x[1]];
    });
    paintSfxBtn();
    paintFastBtn();
  }
  function wire() {
    $("new-btn").addEventListener("click", function () { newDialog(); });
    $("party-btn").addEventListener("click", partyDialog);
    $("stats-btn").addEventListener("click", statsDialog);
    $("fast-btn").addEventListener("click", function () { prefs.fast = !prefs.fast; savePrefs(); paintFastBtn(); });
    $("sfx-btn").addEventListener("click", function () {
      try { localStorage.setItem(SFX_KEY, sfxOn() ? "0" : "1"); } catch (e) {}
      paintSfxBtn();
      sfx("buy");
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
    if (!game) game = makeGame({ diff: prefs.diff, seed: newSeed(), party: prefs.party });
    st = game.g;
    saveSession();
    setMsg(st.fight ? t("fight." + st.fight.kind) : t("map.go"));
    resize();
    renderAll();
    if (st.over >= 0) setTimeout(resultDialog, 300);
    else if (!st.fight && st.pend.length) setTimeout(pendDialog, 300);
    else maybeTour();
  }

  boot();
})();
