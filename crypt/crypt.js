// ============================================================
// orOS Crypt — App logic (v1.0.0)
// A turn-based dungeon crawler with a backpack puzzle: ten floors of
// rooms and corridors, monsters that show their next move, and a
// grid backpack where items of different shapes link through their
// ports. The rules live in crypt/engine.js (CryptEngine, tested
// headless), the tables in crypt/items.js; this file is the screen.
//   - Gentle (more Health, a potion to start, a save point on
//     floors 4, 7 and 10) or Grim (one life)
//   - every run has a code; the same code is the same crypt
//   - tap to walk (stops when a monster comes into view), swipe or
//     arrow keys for one step, tap a monster next to you to attack
//   - the backpack: drag or tap to place, rotate, take out, use
//   - quick slots for the first four runes, potions and scrolls
//   - a short "How to play" on the first run
//   - Daily crypt (W2): the same five floors for everyone each day
//     (gamekit/daily.js), Gentle, one life, one try; result, streak
//     and a spoiler-free share line
// Data:
//   - synced slice "crypt" (oros-crypt-data): runs, wins and the
//     deepest floor per mode as per-device counter rows (each device
//     only grows its own row; merge = per-row max, a join) + reset
//     stamp br (same pattern as Realm) + one Daily crypt result per
//     day (newer epoch wins, equal epochs the better one)
//   - device-local (R10): oros-crypt-prefs (mode, tour seen),
//     oros-crypt-session (the run in progress, its save point),
//     oros-crypt-device (counter row id), oros-crypt-sfx (sound)
// Sections:
//   1. Constants, i18n, helpers
//   2. Synced records: load / save / normalize / merge (R5, R26)
//   3. Device-local prefs + session
//   4. Run flow (new, act, walk, events, fall, win)
//   5. Map view (geometry, camera, drawing)
//   6. Input (tap, swipe, keyboard)
//   7. Panels (toolbar, status, quick slots)
//   8. Dialogs (new run, backpack, result, records, tour)
//   9. Toasts
//  10. Sound
//  11. Sync slice + palette
//  12. Wiring & boot
// ============================================================
(function () {
  "use strict";

  var E = window.CryptEngine;

  var STORAGE_KEY = "oros-crypt-data";
  var PREFS_KEY   = "oros-crypt-prefs";
  var SESSION_KEY = "oros-crypt-session";
  var DEVICE_KEY  = "oros-crypt-device";
  var SFX_KEY     = "oros-crypt-sfx";
  var DATA_VER    = 1;
  var MODES = E.MODES;                 // g Gentle, r Grim
  var DK = window.orosDaily || null;  // gamekit/daily.js (Daily crypt)
  var DAILY_END = 5;                   // the Daily crypt: floors 1–5, Gentle, one life
  var MAX_DAY = 100000;
  var MAX_TURNS = 99999;
  var STEP_MS = 70;                    // one step of a walk
  var PACK_UNDO = 40;

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
      "app.name": "Crypt",
      "btn.new": "New run (N)", "btn.wait": "Wait a turn (Space)", "btn.pack": "Backpack",
      "btn.packKey": "Backpack (I)", "btn.stats": "Records", "btn.sfxOn": "Sound on", "btn.sfxOff": "Sound off",
      "btn.zoomIn": "Zoom in (+)", "btn.zoomOut": "Zoom out (−)",
      "map.label": "The crypt. Arrow keys step, Enter acts on the cursor cell, Space waits, I opens the backpack.",
      "st.hp": "Health {n} of {m}", "st.atk": "Attack {n}", "st.def": "Defence {n}", "st.fo": "Focus {n} of {m}",
      "st.floor": "Floor {n}", "st.floorShort": "F{n}", "st.gold": "{n} gold", "st.warded": "Warded",
      "mode.g": "Gentle", "mode.r": "Grim",
      "mode.g.note": "More Health, a potion to start, and a save point on floors 4, 7 and 10.",
      "mode.r.note": "One life: a fall ends the run.",
      "t.b": "Blade", "t.w": "Ward", "t.r": "Rune", "t.c": "Charm", "t.p": "Potion", "t.s": "Scroll",
      "it.dagger": "Dagger", "it.sword": "Short sword", "it.hatchet": "Hatchet", "it.spear": "Spear",
      "it.mace": "Mace", "it.sabre": "Sabre", "it.pick": "War pick", "it.great": "Greatsword",
      "it.cleaver": "Bone cleaver", "it.glass": "Glass blade", "it.buckler": "Buckler", "it.cap": "Leather cap",
      "it.greaves": "Greaves", "it.amulet": "Ward amulet", "it.tower": "Tower shield", "it.mail": "Mail shirt",
      "it.plate": "Plate armour", "it.thorns": "Crown of thorns", "it.bolt": "Bolt rune", "it.push": "Push rune",
      "it.shield": "Ward rune", "it.blink": "Blink rune", "it.mend": "Mend rune", "it.storm": "Storm rune",
      "it.lantern": "Lantern", "it.owl": "Owl eye", "it.purse": "Coin purse", "it.stone": "Focus stone",
      "it.heart": "Heart stone", "it.moss": "Healing moss", "it.ring": "Thief's ring", "it.crown": "Sage's crown",
      "it.vial": "Small potion", "it.flask": "Healing potion", "it.focus": "Focus potion", "it.elixir": "Elixir",
      "it.cleanse": "Cleansing scroll", "it.chart": "Map scroll", "it.escape": "Escape scroll", "it.fire": "Fire scroll",
      "fx.atk": "Attack {n}", "fx.def": "Defence {n}", "fx.hp": "Health {n}", "fx.fo": "Focus {n}",
      "fx.light": "Light {n}", "fx.trap": "shows traps near you", "fx.gold": "{n} % more gold",
      "fx.regen": "1 Health every {n} turns", "fx.frg": "1 Focus every {n} turns",
      "use.bolt": "Hits the nearest monster in sight for 4 + your Attack",
      "use.push": "Pushes every monster next to you 2 cells away",
      "use.ward": "Stops the next hit",
      "use.blink": "Jumps up to 4 cells, away from the monsters",
      "use.mend": "Heals 6",
      "use.storm": "Hits every monster in sight for 5",
      "use.heal": "Heals {n}", "use.focus": "Fills your Focus", "use.elixir": "Fills your Health and Focus",
      "use.cleanse": "Lifts every curse in the backpack", "use.chart": "Shows the whole floor and its traps",
      "use.escape": "Takes you next to the stairs", "use.fire": "Hits everything around you for 6",
      "use.cost": "{n} Focus", "it.cursed": "Cursed: it cannot leave the backpack until a Cleansing scroll",
      "mon.rat": "Rat", "mon.swarm": "Rat swarm", "mon.bat": "Bat", "mon.bones": "Skeleton", "mon.archer": "Archer",
      "mon.slime": "Slime", "mon.ghoul": "Bell ghoul", "mon.mimic": "Mimic", "mon.spider": "Spider", "mon.wisp": "Wisp",
      "mon.guard": "Stone guard", "mon.knight": "Knight", "mon.brute": "Brute", "mon.warden": "Warden",
      "hab.rat": "Plain and quick to anger.", "hab.swarm": "Splits off a rat when hit.",
      "hab.bat": "Takes two steps a turn.", "hab.bones": "Plain, but sturdier.",
      "hab.archer": "Shoots along a row or column and keeps its distance.",
      "hab.slime": "Acts every other turn.", "hab.ghoul": "Rings its bell when it wakes: everyone near wakes too.",
      "hab.mimic": "Looks like a chest until you are next to it.", "hab.spider": "Leaps next to you along a straight line.",
      "hab.wisp": "Its hit also drains 1 Focus.", "hab.guard": "Only moves while you are not in its row or column.",
      "hab.knight": "Plain, armoured.", "hab.brute": "Acts every other turn and hits very hard.",
      "hab.warden": "Calls skeletons every 6 turns and holds the key out.",
      "foe.info": "{name} · Health {hp} · Attack {atk} · Defence {def}. {hab}",
      "foe.sleep": "asleep",
      "ev.hit": "You hit the {k} for {n}", "ev.kill": "The {k} falls", "ev.hurt": "The {k} hits you for {n}",
      "ev.warded": "Your ward stops the hit", "ev.miss": "A miss", "ev.chest": "The chest holds a {k}",
      "ev.pick": "{k} into the backpack", "ev.full": "No room for the {k}: open the Backpack",
      "ev.cursedHere": "A {k} lies here. It is cursed: place it by hand",
      "ev.gold": "+{n} gold", "ev.trap": "A trap! {n} damage", "ev.floor": "Floor {n}",
      "ev.key": "The Warden drops the key: find the stairs", "ev.locked": "The way out is locked: the Warden holds the key",
      "ev.wake": "A {k} sees you", "ev.bell": "A bell rings!", "ev.mimic": "The chest is a mimic!",
      "ev.split": "The swarm splits", "ev.call": "The Warden calls a skeleton", "ev.drain": "The wisp drains your Focus",
      "ev.ward": "A ward surrounds you", "ev.heal": "+{n} Health", "ev.focus": "Focus full", "ev.cleanse": "The curses lift",
      "ev.chart": "The whole floor shows", "ev.blink": "You blink away", "ev.push": "Pushed back",
      "ev.save": "Save point: floor {n}", "ev.packTurn": "Packing in sight of a monster took a turn",
      "ev.cant": "That does nothing now", "ev.noFocus": "Not enough Focus",
      "cause.trap": "a trap",
      "new.title": "New run", "new.mode": "Mode", "new.seed": "Crypt code (empty = new crypt)",
      "new.start": "Start", "new.cancel": "Cancel", "new.giveUp": "The run in progress counts as a fall.",
      "pack.title": "Backpack", "pack.floor": "On the floor here", "pack.none": "Nothing here",
      "pack.pick": "Tap an item, then a free cell. Or drag it.", "pack.rotate": "Rotate (R)", "pack.out": "Take out",
      "pack.in": "Pack it", "pack.use": "Use", "pack.undo": "Undo (Z)", "pack.done": "Done",
      "pack.noFit": "It does not fit there", "pack.noRoom": "No room for it",
      "pack.cursed": "Cursed: it stays in the backpack", "pack.links": "Links: {n}",
      "pack.cell": "Cell {x}, {y}", "pack.cellOf": "{item}, cell {x}, {y}", "pack.light": "Light {n}",
      "pack.gold": "Gold +{n} %",
      "slot.empty": "Empty slot",
      "res.won": "You escaped the crypt!", "res.fell": "You fell on floor {n}", "res.by": "Felled by: {k}",
      "res.turns": "Turns", "res.gold": "Gold", "res.kills": "Monsters", "res.code": "Crypt code: {seed}",
      "res.back": "Back to floor {n}", "res.same": "Same crypt again", "res.new": "New run",
      "stats.title": "Records", "stats.head": "Runs · won · deepest floor", "stats.reset": "Reset records",
      "stats.close": "Close", "stats.code": "This crypt: {seed}",
      "btn.daily": "Daily crypt", "daily.label": "Daily",
      "daily.title": "Daily crypt #{n}", "daily.floor": "Daily #{n} · floor {f}/{e}",
      "daily.won": "Out in {t} turns", "daily.lost": "Fell on floor {f}",
      "daily.turns": "Turns", "daily.streak": "Streak", "daily.best": "Best streak",
      "daily.oneTry": "The daily crypt has one try.", "daily.next": "A new crypt tomorrow.",
      "daily.free": "Free run", "daily.share": "Share", "daily.games": "All games",
      "daily.rules": "Five floors, Gentle, one life: reach the stairs on floor 5.",
      "daily.leave": "Leave today's crypt? It counts as your one try.",
      "daily.leaveYes": "Leave it", "daily.leaveNo": "Keep playing",
      "stats.daily": "Daily crypt", "stats.dailyRow": "Played · out · streak · best",
      "share.won": "Out in {t} turns", "share.lost": "Fell on floor {f}",
      "toast.dailyGone": "The daily crypt needs the gamekit file: reload orOS",
      "toast.copied": "Copied: paste it into a chat", "toast.shared": "Shared",
      "toast.copyFail": "Could not copy",
      "confirm.reset": "Reset your Crypt records on all your devices?", "confirm.yes": "Reset", "confirm.no": "Cancel",
      "toast.reset": "Records reset", "toast.save": "Could not save: storage is full",
      "tour.title": "How to play", "tour.next": "Next", "tour.skip": "Skip", "tour.done": "Play",
      "tour.1": "Go down ten floors. On floor 10 the Warden holds the key; take it back to the stairs to escape.",
      "tour.2": "Every action is one turn: a step, an attack, a chest, an item. Monsters move only when you do.",
      "tour.3": "Each monster shows its next move: red marks the cells it will hit. Step out of them, or hit first.",
      "tour.4": "What you carry works only in the Backpack. Items touch through their ports: facing ports link and give a bonus.",
      "tour.5": "Tap to walk, tap a monster next to you to attack. The quick slots at the bottom use your runes and potions."
    },
    el: {
      "app.name": "Κρύπτη",
      "btn.new": "Νέα κάθοδος (N)", "btn.wait": "Περίμενε έναν γύρο (Space)", "btn.pack": "Σακίδιο",
      "btn.packKey": "Σακίδιο (I)", "btn.stats": "Ρεκόρ", "btn.sfxOn": "Ήχος ανοιχτός", "btn.sfxOff": "Ήχος κλειστός",
      "btn.zoomIn": "Μεγέθυνση (+)", "btn.zoomOut": "Σμίκρυνση (−)",
      "map.label": "Η κρύπτη. Τα βελάκια κάνουν ένα βήμα, το Enter δρα στο κελί του δείκτη, το Space περιμένει, το I ανοίγει το σακίδιο.",
      "st.hp": "Ζωή {n} από {m}", "st.atk": "Επίθεση {n}", "st.def": "Άμυνα {n}", "st.fo": "Συγκέντρωση {n} από {m}",
      "st.floor": "Όροφος {n}", "st.floorShort": "Ο{n}", "st.gold": "{n} χρυσά", "st.warded": "Με προστασία",
      "mode.g": "Ήπιο", "mode.r": "Σκληρό",
      "mode.g.note": "Περισσότερη ζωή, ένα φίλτρο για αρχή και σημείο αποθήκευσης στους ορόφους 4, 7 και 10.",
      "mode.r.note": "Μία ζωή: αν πέσεις, η κάθοδος τελειώνει.",
      "t.b": "Λεπίδα", "t.w": "Προστασία", "t.r": "Ρούνος", "t.c": "Φυλαχτό", "t.p": "Φίλτρο", "t.s": "Πάπυρος",
      "it.dagger": "Στιλέτο", "it.sword": "Κοντό σπαθί", "it.hatchet": "Τσεκουράκι", "it.spear": "Δόρυ",
      "it.mace": "Κορύνη", "it.sabre": "Σπάθα", "it.pick": "Πολεμικός κασμάς", "it.great": "Μεγάλο σπαθί",
      "it.cleaver": "Μπαλτάς", "it.glass": "Γυάλινη λεπίδα", "it.buckler": "Μικρή ασπίδα", "it.cap": "Δερμάτινο κράνος",
      "it.greaves": "Περικνημίδες", "it.amulet": "Φυλαχτό προστασίας", "it.tower": "Μεγάλη ασπίδα", "it.mail": "Αλυσιδωτός θώρακας",
      "it.plate": "Πανοπλία", "it.thorns": "Αγκάθινο στέμμα", "it.bolt": "Ρούνος κεραυνού", "it.push": "Ρούνος ώθησης",
      "it.shield": "Ρούνος προστασίας", "it.blink": "Ρούνος άλματος", "it.mend": "Ρούνος ίασης", "it.storm": "Ρούνος καταιγίδας",
      "it.lantern": "Φανάρι", "it.owl": "Μάτι κουκουβάγιας", "it.purse": "Πουγκί", "it.stone": "Πέτρα συγκέντρωσης",
      "it.heart": "Πέτρα της καρδιάς", "it.moss": "Βρύο ίασης", "it.ring": "Δαχτυλίδι του κλέφτη", "it.crown": "Στέμμα του σοφού",
      "it.vial": "Μικρό φίλτρο", "it.flask": "Φίλτρο ίασης", "it.focus": "Φίλτρο συγκέντρωσης", "it.elixir": "Ελιξήριο",
      "it.cleanse": "Πάπυρος εξαγνισμού", "it.chart": "Πάπυρος χάρτη", "it.escape": "Πάπυρος διαφυγής", "it.fire": "Πάπυρος φωτιάς",
      "fx.atk": "Επίθεση {n}", "fx.def": "Άμυνα {n}", "fx.hp": "Ζωή {n}", "fx.fo": "Συγκέντρωση {n}",
      "fx.light": "Φως {n}", "fx.trap": "δείχνει τις παγίδες κοντά σου", "fx.gold": "{n} % περισσότερος χρυσός",
      "fx.regen": "1 ζωή κάθε {n} γύρους", "fx.frg": "1 συγκέντρωση κάθε {n} γύρους",
      "use.bolt": "Χτυπά το κοντινότερο τέρας που βλέπεις με 4 + την Επίθεσή σου",
      "use.push": "Σπρώχνει κάθε τέρας δίπλα σου 2 κελιά μακριά",
      "use.ward": "Σταματά το επόμενο χτύπημα",
      "use.blink": "Πηδά έως 4 κελιά, μακριά από τα τέρατα",
      "use.mend": "Θεραπεύει 6",
      "use.storm": "Χτυπά κάθε τέρας που βλέπεις με 5",
      "use.heal": "Θεραπεύει {n}", "use.focus": "Γεμίζει τη Συγκέντρωσή σου", "use.elixir": "Γεμίζει Ζωή και Συγκέντρωση",
      "use.cleanse": "Λύνει κάθε κατάρα στο σακίδιο", "use.chart": "Δείχνει όλο τον όροφο και τις παγίδες του",
      "use.escape": "Σε πάει δίπλα στη σκάλα", "use.fire": "Χτυπά ό,τι είναι γύρω σου με 6",
      "use.cost": "{n} Συγκέντρωση", "it.cursed": "Καταραμένο: δεν βγαίνει από το σακίδιο χωρίς Πάπυρο εξαγνισμού",
      "mon.rat": "Αρουραίος", "mon.swarm": "Σμήνος αρουραίων", "mon.bat": "Νυχτερίδα", "mon.bones": "Σκελετός", "mon.archer": "Τοξότης",
      "mon.slime": "Γλίτσα", "mon.ghoul": "Βρικόλακας με καμπάνα", "mon.mimic": "Μιμητής", "mon.spider": "Αράχνη", "mon.wisp": "Αερικό",
      "mon.guard": "Πέτρινος φρουρός", "mon.knight": "Ιππότης", "mon.brute": "Θηρίο", "mon.warden": "Φύλακας",
      "hab.rat": "Απλός και ευέξαπτος.", "hab.swarm": "Όταν το χτυπάς, βγάζει έναν αρουραίο.",
      "hab.bat": "Κάνει δύο βήματα τον γύρο.", "hab.bones": "Απλός, αλλά πιο γερός.",
      "hab.archer": "Ρίχνει σε ευθεία γραμμή ή στήλη και κρατά απόσταση.",
      "hab.slime": "Παίζει κάθε δεύτερο γύρο.", "hab.ghoul": "Όταν ξυπνά χτυπά την καμπάνα: ξυπνούν όλοι γύρω.",
      "hab.mimic": "Μοιάζει με σεντούκι ώσπου να βρεθείς δίπλα του.", "hab.spider": "Πηδά δίπλα σου σε ευθεία γραμμή.",
      "hab.wisp": "Το χτύπημά του σου παίρνει και 1 Συγκέντρωση.", "hab.guard": "Κινείται μόνο όταν δεν είσαι στη γραμμή ή στη στήλη του.",
      "hab.knight": "Απλός, με πανοπλία.", "hab.brute": "Παίζει κάθε δεύτερο γύρο και χτυπά πολύ δυνατά.",
      "hab.warden": "Καλεί σκελετούς κάθε 6 γύρους και κρατά το κλειδί της εξόδου.",
      "foe.info": "{name} · Ζωή {hp} · Επίθεση {atk} · Άμυνα {def}. {hab}",
      "foe.sleep": "κοιμάται",
      "ev.hit": "Χτυπάς: {k}, {n}", "ev.kill": "Έπεσε: {k}", "ev.hurt": "Σε χτυπά: {k}, {n}",
      "ev.warded": "Η προστασία σταματά το χτύπημα", "ev.miss": "Αστόχησε", "ev.chest": "Στο σεντούκι: {k}",
      "ev.pick": "Στο σακίδιο: {k}", "ev.full": "Δεν χωράει: {k}. Άνοιξε το Σακίδιο",
      "ev.cursedHere": "Εδώ υπάρχει: {k}. Είναι καταραμένο: βάλ' το με το χέρι",
      "ev.gold": "+{n} χρυσά", "ev.trap": "Παγίδα! {n} ζημιά", "ev.floor": "Όροφος {n}",
      "ev.key": "Ο Φύλακας άφησε το κλειδί: βρες τη σκάλα", "ev.locked": "Η έξοδος είναι κλειδωμένη: το κλειδί το έχει ο Φύλακας",
      "ev.wake": "Σε είδε: {k}", "ev.bell": "Χτυπά μια καμπάνα!", "ev.mimic": "Το σεντούκι είναι μιμητής!",
      "ev.split": "Το σμήνος χωρίζεται", "ev.call": "Ο Φύλακας καλεί έναν σκελετό", "ev.drain": "Το αερικό σου παίρνει Συγκέντρωση",
      "ev.ward": "Σε τυλίγει προστασία", "ev.heal": "+{n} ζωή", "ev.focus": "Γεμάτη συγκέντρωση", "ev.cleanse": "Οι κατάρες λύθηκαν",
      "ev.chart": "Φαίνεται όλος ο όροφος", "ev.blink": "Πηδάς μακριά", "ev.push": "Σπρώχτηκε πίσω",
      "ev.save": "Σημείο αποθήκευσης: όροφος {n}", "ev.packTurn": "Το πακετάρισμα μπροστά σε τέρας πήρε έναν γύρο",
      "ev.cant": "Δεν κάνει τίποτα τώρα", "ev.noFocus": "Δεν φτάνει η Συγκέντρωση",
      "cause.trap": "μια παγίδα",
      "new.title": "Νέα κάθοδος", "new.mode": "Τρόπος", "new.seed": "Κωδικός κρύπτης (κενό = νέα κρύπτη)",
      "new.start": "Έναρξη", "new.cancel": "Άκυρο", "new.giveUp": "Η κάθοδος που παίζεις μετρά ως πτώση.",
      "pack.title": "Σακίδιο", "pack.floor": "Στο πάτωμα εδώ", "pack.none": "Τίποτα εδώ",
      "pack.pick": "Πάτα ένα αντικείμενο και μετά ένα ελεύθερο κελί. Ή σύρ' το.", "pack.rotate": "Περιστροφή (R)", "pack.out": "Βγάλ' το",
      "pack.in": "Βάλ' το μέσα", "pack.use": "Χρήση", "pack.undo": "Αναίρεση (Z)", "pack.done": "Τέλος",
      "pack.noFit": "Δεν χωράει εκεί", "pack.noRoom": "Δεν υπάρχει χώρος",
      "pack.cursed": "Καταραμένο: μένει στο σακίδιο", "pack.links": "Συνδέσεις: {n}",
      "pack.cell": "Κελί {x}, {y}", "pack.cellOf": "{item}, κελί {x}, {y}", "pack.light": "Φως {n}",
      "pack.gold": "Χρυσός +{n} %",
      "slot.empty": "Κενή θέση",
      "res.won": "Βγήκες από την κρύπτη!", "res.fell": "Έπεσες στον όροφο {n}", "res.by": "Σε έριξε: {k}",
      "res.turns": "Γύροι", "res.gold": "Χρυσός", "res.kills": "Τέρατα", "res.code": "Κωδικός κρύπτης: {seed}",
      "res.back": "Πίσω στον όροφο {n}", "res.same": "Ίδια κρύπτη ξανά", "res.new": "Νέα κάθοδος",
      "stats.title": "Ρεκόρ", "stats.head": "Κάθοδοι · νίκες · βαθύτερος όροφος", "stats.reset": "Μηδενισμός ρεκόρ",
      "stats.close": "Κλείσιμο", "stats.code": "Αυτή η κρύπτη: {seed}",
      "btn.daily": "Κρύπτη της ημέρας", "daily.label": "Ημέρας",
      "daily.title": "Κρύπτη της ημέρας #{n}", "daily.floor": "Ημέρας #{n} · όροφος {f}/{e}",
      "daily.won": "Βγήκες σε {t} γύρους", "daily.lost": "Έπεσες στον όροφο {f}",
      "daily.turns": "Γύροι", "daily.streak": "Σερί", "daily.best": "Καλύτερο σερί",
      "daily.oneTry": "Η κρύπτη της ημέρας παίζεται μία φορά.", "daily.next": "Νέα κρύπτη αύριο.",
      "daily.free": "Ελεύθερη κάθοδος", "daily.share": "Κοινοποίηση", "daily.games": "Όλα τα παιχνίδια",
      "daily.rules": "Πέντε όροφοι, Ήπιο, μία ζωή: φτάσε στη σκάλα του ορόφου 5.",
      "daily.leave": "Να αφήσεις τη σημερινή κρύπτη; Μετρά ως η μία σου προσπάθεια.",
      "daily.leaveYes": "Άφησέ την", "daily.leaveNo": "Συνέχισε",
      "stats.daily": "Κρύπτη της ημέρας", "stats.dailyRow": "Κάθοδοι · έξοδοι · σερί · καλύτερο",
      "share.won": "Βγήκα σε {t} γύρους", "share.lost": "Έπεσα στον όροφο {f}",
      "toast.dailyGone": "Η κρύπτη της ημέρας θέλει το αρχείο gamekit: φόρτωσε ξανά το orOS",
      "toast.copied": "Αντιγράφηκε: επικόλλησέ το σε μια συνομιλία", "toast.shared": "Κοινοποιήθηκε",
      "toast.copyFail": "Δεν αντιγράφηκε",
      "confirm.reset": "Να μηδενιστούν τα ρεκόρ της Κρύπτης σε όλες τις συσκευές σου;", "confirm.yes": "Μηδενισμός", "confirm.no": "Άκυρο",
      "toast.reset": "Τα ρεκόρ μηδενίστηκαν", "toast.save": "Δεν αποθηκεύτηκε: ο χώρος είναι γεμάτος",
      "tour.title": "Πώς παίζεται", "tour.next": "Επόμενο", "tour.skip": "Παράλειψη", "tour.done": "Παίξε",
      "tour.1": "Κατέβα δέκα ορόφους. Στον όροφο 10 ο Φύλακας κρατά το κλειδί· πάρ' το και γύρνα στη σκάλα για να βγεις.",
      "tour.2": "Κάθε κίνηση είναι ένας γύρος: ένα βήμα, μια επίθεση, ένα σεντούκι, ένα αντικείμενο. Τα τέρατα κινούνται μόνο όταν κινείσαι εσύ.",
      "tour.3": "Κάθε τέρας δείχνει την επόμενη κίνησή του: το κόκκινο σημαδεύει τα κελιά που θα χτυπήσει. Φύγε από εκεί ή χτύπα πρώτος.",
      "tour.4": "Ό,τι κουβαλάς δουλεύει μόνο μέσα στο Σακίδιο. Τα αντικείμενα ακουμπούν με σημεία σύνδεσης: όσα κοιτάζονται συνδέονται και δίνουν μπόνους.",
      "tour.5": "Πάτα για να περπατήσεις, πάτα ένα τέρας δίπλα σου για να επιτεθείς. Οι γρήγορες θέσεις κάτω χρησιμοποιούν τους ρούνους και τα φίλτρα σου."
    }
  };
  if (window.orosI18n) window.orosI18n.table(STRINGS, "crypt", LANG);

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

  // A new crypt code: 6 letters and digits, easy to read aloud.
  function newSeed() {
    var abc = "abcdefghjkmnpqrstuvwxyz23456789", buf = new Uint32Array(6), s = "";
    crypto.getRandomValues(buf);
    for (var i = 0; i < 6; i++) s += abc.charAt(buf[i] % abc.length);
    return s;
  }
  function cleanSeed(s) {
    return String(s || "").toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 16);
  }
  function itemName(k) { return t("it." + k); }
  function monName(k) { return t("mon." + k); }

  // BOOT MARKER
  var SCRIPT_V = "";
  (function () {
    var m = ((document.currentScript && document.currentScript.src) || "")
      .match(/[?&]v=([^&#]+)/);
    SCRIPT_V = m ? m[1] : "";
    document.documentElement.lang = LANG;
    console.log("crypt.js v" + (SCRIPT_V || "?") + " boot");
  })();

  // ---------- 2. Synced records ----------
  // data = { ver, br, rows: { <device id>: { b, s: { "<mode>": [runs, won, deepest floor] } } } }
  // Each device only grows its own row, so a per-row max is a join and
  // nothing is double-counted however the devices meet.
  var data = null;
  var deviceId = null;

  // days (5.55.00, older data has none): one Daily crypt per calendar
  // day (day 0 = 1 Jan 2026, gamekit/daily.js), one try:
  // { "<day>": { b, w: 1 out | 0 fell, f: floor reached, t: turns } }.
  // The newer epoch wins; equal epochs keep the better result (out,
  // then deeper, then fewer turns: a total order, so a join).
  function defaultData() { return { ver: DATA_VER, br: 0, rows: {}, days: {} }; }
  function normDay(v) {
    if (!v || typeof v !== "object" || !isInt(v.b) || v.b < 0 || (v.w !== 0 && v.w !== 1) ||
        !isInt(v.f) || v.f < 1 || v.f > E.FLOORS || !isInt(v.t) || v.t < 1 || v.t > MAX_TURNS) return null;
    return { b: v.b, w: v.w, f: v.f, t: v.t };
  }
  function dayKeyOk(k) { return /^\d{1,6}$/.test(k) && +k <= MAX_DAY; }
  function dayBetter(a, c) {
    if (a.w !== c.w) return a.w > c.w;
    if (a.f !== c.f) return a.f > c.f;
    return a.t < c.t;
  }
  function normRow(row) {
    if (!row || typeof row !== "object" || !isInt(row.b) || row.b < 0) return null;
    var s = {}, any = false;
    MODES.forEach(function (k) {
      var v = row.s && row.s[k];
      if (Array.isArray(v) && v.length === 3 && v.every(function (x) { return isInt(x) && x >= 0; }) && v[2] <= E.FLOORS) {
        s[k] = [v[0], v[1], v[2]];
        any = true;
      }
    });
    return any ? { b: row.b, s: s } : null;
  }
  function joinRows(x, y) {
    if (x.b !== y.b) return x.b > y.b ? x : y;
    var s = {};
    MODES.forEach(function (k) {
      var a = x.s[k], c = y.s[k];
      if (!a && !c) return;
      if (!a) { s[k] = c.slice(); return; }
      if (!c) { s[k] = a.slice(); return; }
      s[k] = [Math.max(a[0], c[0]), Math.max(a[1], c[1]), Math.max(a[2], c[2])];
    });
    return { b: x.b, s: s };
  }
  function mergeCrypt(A, B) {
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
      MODES.forEach(function (k) { if (r.s[k]) s[k] = r.s[k].slice(); });
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
    return { ver: DATA_VER, br: br, rows: sorted, days: sd };
  }
  // [runs, won, deepest] for a mode, all devices.
  function totals(mode) {
    var out = [0, 0, 0];
    Object.keys(data.rows).forEach(function (id) {
      var v = data.rows[id].s[mode];
      if (v) { out[0] += v[0]; out[1] += v[1]; out[2] = Math.max(out[2], v[2]); }
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
          data = mergeCrypt(parsed, parsed);
          return;
        }
      } catch (e) {}
      try { localStorage.setItem(STORAGE_KEY + "-broken", raw); } catch (e) {}
      try { console.warn("[orOS] crypt: unreadable data copied to " + STORAGE_KEY + "-broken"); } catch (e) {}
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
  // what: "run" (a run ended), "win" (a run won), "deep" (reached floor n)
  // A Daily crypt run counts only in days, never in the mode rows.
  function count(mode, what, n) {
    if (game && game.opts.day !== undefined) return;
    var row = data.rows[deviceId];
    if (!row || row.b < data.br) row = { b: data.br, s: {} };
    row = { b: row.b, s: JSON.parse(JSON.stringify(row.s)) };
    var v = row.s[mode] ? row.s[mode].slice() : [0, 0, 0];
    if (what === "run") v[0]++;
    else if (what === "win") { v[0]++; v[1]++; v[2] = E.FLOORS; }
    else if (what === "deep") { if (n <= v[2]) return; v[2] = n; }
    row.s[mode] = v;
    data.rows[deviceId] = row;
    data = mergeCrypt(data, data);
    save();
  }

  // Daily results: crypts played and escaped, the current and best
  // streak of escaped days.
  function dailyStats(todayIdx) {
    var on = {}, n = 0, w = 0;
    Object.keys(data.days).forEach(function (k) {
      n++;
      if (data.days[k].w) { on[k] = true; w++; }
    });
    var s2 = DK ? DK.streaks(on, todayIdx) : { cur: 0, best: 0 };
    return { n: n, w: w, cur: s2.cur, best: s2.best };
  }
  // One try a day: the first result counts.
  function countDaily(day, won, floor, turns) {
    if (data.days[day] && data.days[day].b >= data.br) return;
    data.days[day] = { b: data.br, w: won ? 1 : 0, f: clamp(floor, 1, E.FLOORS), t: clamp(turns, 1, MAX_TURNS) };
    data = mergeCrypt(data, data);
    save();
  }

  // ---------- 3. Device-local prefs + session ----------
  var prefs = { mode: "g", tour: false };
  function loadPrefs() {
    try {
      var p = JSON.parse(localStorage.getItem(PREFS_KEY) || "null");
      if (p && typeof p === "object") {
        if (MODES.indexOf(p.mode) >= 0) prefs.mode = p.mode;
        prefs.tour = p.tour === true;
      }
    } catch (e) {}
  }
  function savePrefs() {
    try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch (e) {}
  }

  // game = {
  //   g: engine state,
  //   opts: { mode, seed },
  //   cp: engine state at the last save point (Gentle) | null,
  //   counted: bool   the run's end is in the records
  //   done: bool      the run is over (won, or fallen with no way back)
  // }
  var game = null;

  function validSession(s) {
    if (!s || typeof s !== "object" || !E.valid(s.g)) return false;
    var o = s.opts;
    if (!o || MODES.indexOf(o.mode) < 0 || typeof o.seed !== "string" || o.mode !== s.g.mode) return false;
    if (o.day !== undefined && (!isInt(o.day) || o.day < 0 || o.day > MAX_DAY || s.g.end !== DAILY_END || o.mode !== "g" || s.cp)) return false;
    if (o.day === undefined && s.g.end !== undefined) return false;
    if (s.cp !== null && s.cp !== undefined && (!E.valid(s.cp) || s.cp.seed !== s.g.seed || s.cp.over >= 0)) return false;
    return true;
  }
  function loadSession() {
    try {
      var s = JSON.parse(localStorage.getItem(SESSION_KEY) || "null");
      if (validSession(s)) {
        s.cp = s.cp || null;
        s.counted = s.counted === true;
        s.done = s.done === true;
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

  // ---------- 4. Run flow ----------
  var st = null;              // = game.g
  var walk = null;            // { path: [cells], timer }
  var cursor = -1;            // keyboard cursor cell
  var lastMsg = "";

  function inProgressOf(g) { return !!(g && !g.done && g.g.over < 0 && g.g.turn > 0); }
  function makeGame(opts) {
    var daily = opts.day !== undefined;
    var o = { mode: opts.mode, seed: opts.seed };
    if (daily) o.day = opts.day;
    return { g: E.newRun(opts.seed, opts.mode, daily ? DAILY_END : undefined), opts: o, cp: null, counted: false, done: false };
  }
  // A Daily crypt left before its end counts as a fall where it was.
  function leaveDaily() {
    if (game && game.opts.day !== undefined && !game.done && st.over < 0 && st.turn > 0) {
      countDaily(game.opts.day, false, st.floor, st.turn);
      game.done = true;
      game.counted = true;
    }
  }
  function startGame(opts) {
    stopWalk();
    leaveDaily();
    if (game && inProgressOf(game) && !game.counted) count(game.opts.mode, "run");
    game = makeGame(opts);
    st = game.g;
    cursor = -1;
    saveSession();
    setMsg("");
    renderAll();
    live(t("st.floor", { n: st.floor }));
    maybeTour();
  }
  function setMsg(text) {
    lastMsg = text || "";
    $("msg").textContent = lastMsg;
  }
  // Do one action; false when it was not allowed (no turn passed).
  function doAct(a) {
    if (!game || game.done || st.over >= 0) return false;
    var before = st.floor;
    var ev = E.act(st, a);
    if (!ev) return false;
    handleEvents(ev);
    if (st.floor !== before) {
      count(game.opts.mode, "deep", st.floor);
      if (game.opts.mode === "g" && game.opts.day === undefined && E.CHECKPOINTS.indexOf(st.floor) >= 0) {
        game.cp = E.clone(st);
        toastLine(t("ev.save", { n: st.floor }));
      }
      fitView();
    }
    if (st.over >= 0) finish();
    saveSession();
    renderAll();
    return true;
  }
  var EV_SHOW = { hit: 1, kill: 1, hurt: 1, warded: 1, chest: 1, pick: 1, full: 1, cursedHere: 1, gold: 1, trap: 1,
    floor: 1, key: 1, locked: 1, wake: 1, bell: 1, mimic: 1, split: 1, call: 1, drain: 1, ward: 1, heal: 1,
    focus: 1, cleanse: 1, chart: 1, blink: 1, push: 1, miss: 1 };
  function evText(e) {
    var p = {};
    if (e.n !== undefined) p.n = e.n;
    if (e.k !== undefined) p.k = /^(hit|kill|hurt|wake)$/.test(e.e) ? monName(e.k) : itemName(e.k);
    return t("ev." + e.e, p);
  }
  function handleEvents(ev) {
    var lines = [], hurt = false;
    ev.forEach(function (e) {
      if (EV_SHOW[e.e]) lines.push(evText(e));
      if (e.e === "hit") { addFx(e.i, "−" + e.n, "hit"); sfx("hit"); }
      else if (e.e === "hurt") { addFx(e.i, "−" + e.n, "hurt"); hurt = true; }
      else if (e.e === "trap") { addFx(e.i, "−" + e.n, "hurt"); hurt = true; }
      else if (e.e === "heal") addFx(st.hero.i, "+" + e.n, "heal");
      else if (e.e === "gold") { addFx(st.hero.i, "+" + e.n, "gold"); sfx("gold"); }
      else if (e.e === "kill") sfx("kill");
      else if (e.e === "pick" || e.e === "chest") sfx("pick");
      else if (e.e === "floor") sfx("floor");
      else if (e.e === "miss") addFx(e.i, "·", "miss");
      else if (e.e === "fall") game.cause = e.k === "trap" ? t("cause.trap") : monName(e.k);
      if (e.e === "full" || e.e === "cursedHere" || e.e === "locked" || e.e === "key" || e.e === "bell" || e.e === "mimic") toastLine(evText(e));
    });
    if (hurt) { sfx("hurt"); shake(); }
    if (lines.length) { setMsg(lines.join(" · ")); live(lines.join(". ")); }
  }
  function finish() {
    stopWalk();
    if (game.opts.day !== undefined) countDaily(game.opts.day, st.over === 1, st.floor, st.turn);
    if (st.over === 1) {
      if (!game.counted) { count(game.opts.mode, "win"); game.counted = true; }
      game.done = true;
      sfx("win");
    } else {
      // Gentle with a save point: the run waits for the choice.
      if (!game.cp) {
        if (!game.counted) { count(game.opts.mode, "run"); game.counted = true; }
        game.done = true;
      }
      sfx("end");
    }
    saveSession();
    setTimeout(resultDialog, 500);
  }
  function backToSave() {
    if (!game.cp) return;
    game.g = E.clone(game.cp);
    st = game.g;
    game.done = false;
    saveSession();
    fitView();
    renderAll();
    toastLine(t("ev.floor", { n: st.floor }));
  }

  // Walking to a tapped cell over seen floor, one step at a time.
  function stopWalk() { if (walk) { clearTimeout(walk.timer); walk = null; } }
  function seenOpen(i) { return st.seen.charAt(i) === "1" && E.open(st, i); }
  function pathTo(goal) {
    var d = E.bfs(st, goal, function (c) { return !seenOpen(c) || (c !== goal && (E.monAt(st, c) || E.chestAt(st, c) >= 0)); });
    if (d[st.hero.i] < 0) return null;
    var path = [], cur = st.hero.i;
    while (cur !== goal) {
      var next = -1;
      for (var k = 0; k < 4; k++) {
        var n = E.step(cur, k);
        if (n >= 0 && d[n] >= 0 && d[n] === d[cur] - 1) { next = n; break; }
      }
      if (next < 0) return null;
      path.push(next);
      cur = next;
    }
    return path;
  }
  function seenFoes() {
    var vis = E.visible(st), n = 0;
    st.mons.forEach(function (m) { if (!m.m && vis.indexOf(m.i) >= 0) n++; });
    return n;
  }
  function dirTo(a, b) {
    for (var k = 0; k < 4; k++) if (E.step(a, k) === b) return k;
    return -1;
  }
  function walkTo(goal) {
    stopWalk();
    var path = pathTo(goal);
    if (!path || !path.length) { shake(); return; }
    walk = { path: path, foes: seenFoes(), timer: null };
    stepWalk();
  }
  function stepWalk() {
    if (!walk) return;
    var next = walk.path.shift();
    var d = dirTo(st.hero.i, next), hp = st.hero.hp, fl = st.floor, items = st.pack.it.length;
    if (d < 0 || E.monAt(st, next) || !doAct({ t: "move", d: d })) { stopWalk(); return; }
    sfx("step");
    var stop = !walk || !walk.path.length || st.hero.hp < hp || st.floor !== fl || st.pack.it.length !== items ||
      seenFoes() > walk.foes || E.groundAt(st).length > 0 || st.over >= 0;
    if (stop) { stopWalk(); return; }
    walk.timer = setTimeout(stepWalk, STEP_MS);
  }

  // ---------- 5. Map view ----------
  var canvas = null, ctx = null, cw = 0, ch = 0, dpr = 1;
  var view = { cs: 34, zoom: 1, ox: 0, oy: 0 };
  var COL = {};
  var fx = [], fxRaf = 0;

  function resize() {
    var wrap = $("map-wrap"), r = wrap.getBoundingClientRect();
    dpr = Math.min(window.devicePixelRatio || 1, 3);
    cw = Math.max(1, Math.floor(r.width));
    ch = Math.max(1, Math.floor(r.height));
    canvas.width = Math.floor(cw * dpr);
    canvas.height = Math.floor(ch * dpr);
    canvas.style.width = cw + "px";
    canvas.style.height = ch + "px";
  }
  // The cell size: the whole floor when it fits with cells of 34 px or
  // more, else 34 px and the view follows the hero.
  function cellSize() {
    var fit = Math.floor(Math.min(cw / E.W, ch / E.H));
    return clamp(Math.round(Math.max(fit, 34) * view.zoom), 24, 80);
  }
  function fitView() {
    if (!canvas || !st) return;
    resize();
    follow();
    draw();
  }
  function follow() {
    var cs = view.cs = cellSize();
    var p = E.xy(st.hero.i), mw = E.W * cs, mh = E.H * cs;
    view.ox = mw <= cw ? Math.floor((cw - mw) / 2) : clamp(Math.round(cw / 2 - (p.x + 0.5) * cs), cw - mw, 0);
    view.oy = mh <= ch ? Math.floor((ch - mh) / 2) : clamp(Math.round(ch / 2 - (p.y + 0.5) * cs), ch - mh, 0);
  }
  function zoomBy(f) {
    view.zoom = clamp(view.zoom * f, 0.7, 2);
    fitView();
  }
  function cellAt(sx, sy) {
    var x = Math.floor((sx - view.ox) / view.cs), y = Math.floor((sy - view.oy) / view.cs);
    return x >= 0 && y >= 0 && x < E.W && y < E.H ? E.idx(x, y) : -1;
  }
  function readColors() {
    var cs = getComputedStyle(document.documentElement);
    ["void", "wall", "wall2", "floor", "floor2", "mem", "hero", "foe", "gold", "b", "w", "r", "c", "p", "s"].forEach(function (k) {
      COL[k] = cs.getPropertyValue("--cr-" + k).trim() || "#888";
    });
    COL.text = cs.getPropertyValue("--text").trim() || "#eee";
    COL.accent = cs.getPropertyValue("--accent").trim() || "#d4af37";
    COL.danger = cs.getPropertyValue("--danger").trim() || "#e06c75";
  }
  function addFx(i, text, kind) {
    if (reducedMotion()) return;
    fx.push({ i: i, text: text, kind: kind, t0: Date.now() });
    if (!fxRaf) fxRaf = requestAnimationFrame(fxLoop);
  }
  function fxLoop() {
    fxRaf = 0;
    var now = Date.now();
    fx = fx.filter(function (f) { return now - f.t0 < 700; });
    draw();
    if (fx.length) fxRaf = requestAnimationFrame(fxLoop);
  }
  function draw() {
    if (!ctx || !st) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    paint();
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
  function paint() {
    var cs = view.cs, vis = E.visible(st), on = {};
    vis.forEach(function (i) { on[i] = 1; });
    ctx.fillStyle = COL.void;
    ctx.fillRect(0, 0, cw, ch);
    for (var i = 0; i < E.W * E.H; i++) {
      if (st.seen.charAt(i) !== "1") continue;
      var p = E.xy(i), x = view.ox + p.x * cs, y = view.oy + p.y * cs;
      if (x > cw || y > ch || x + cs < 0 || y + cs < 0) continue;
      var c = st.map.charAt(i);
      if (c === "#") {
        ctx.fillStyle = COL.wall;
        ctx.fillRect(x, y, cs, cs);
        ctx.fillStyle = COL.wall2;
        ctx.fillRect(x, y + cs * 0.72, cs, cs * 0.28);
      } else {
        ctx.fillStyle = (p.x + p.y) % 2 ? COL.floor : COL.floor2;
        ctx.fillRect(x, y, cs, cs);
        if (c === ">") drawStairs(x, y, cs);
      }
    }
    // things on the floor (seen cells keep what was there)
    st.traps.forEach(function (tr) { if (tr.k && st.seen.charAt(tr.i) === "1") drawTrap(tr.i); });
    st.gold.forEach(function (g) { if (on[g.i]) drawGold(g.i); });
    st.loot.forEach(function (l) { if (on[l.i]) drawLoot(l.i, l.it); });
    st.chests.forEach(function (ci) { if (st.seen.charAt(ci) === "1") drawChest(ci); });
    st.mons.forEach(function (m) { if (m.m && on[m.i]) drawChest(m.i); });
    // what monsters will do next
    st.mons.forEach(function (m) { if (!m.m && on[m.i] && m.n) drawIntent(m); });
    st.mons.forEach(function (m) { if (!m.m && on[m.i]) drawMon(m); });
    drawHero();
    // memory: seen cells out of sight are dimmed
    ctx.fillStyle = COL.mem;
    for (var j = 0; j < E.W * E.H; j++) {
      if (st.seen.charAt(j) !== "1" || on[j]) continue;
      var q = E.xy(j);
      ctx.fillRect(view.ox + q.x * cs, view.oy + q.y * cs, cs, cs);
    }
    if (cursor >= 0) {
      var cp = E.xy(cursor);
      ctx.strokeStyle = COL.accent;
      ctx.lineWidth = 2;
      ctx.strokeRect(view.ox + cp.x * cs + 1.5, view.oy + cp.y * cs + 1.5, cs - 3, cs - 3);
    }
    var now = Date.now();
    fx.forEach(function (f) {
      var a = (now - f.t0) / 700, pp = E.xy(f.i);
      ctx.globalAlpha = 1 - a;
      ctx.fillStyle = f.kind === "hurt" ? COL.danger : f.kind === "heal" ? COL.c : f.kind === "gold" ? COL.gold : COL.text;
      ctx.font = "800 " + Math.round(cs * 0.42) + "px Nunito, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(f.text, view.ox + (pp.x + 0.5) * cs, view.oy + (pp.y + 0.3) * cs - a * cs * 0.5);
      ctx.globalAlpha = 1;
    });
  }
  function cellXY(i) { var p = E.xy(i); return { x: view.ox + p.x * view.cs, y: view.oy + p.y * view.cs, s: view.cs }; }
  function drawStairs(x, y, s) {
    ctx.fillStyle = "rgba(0,0,0,0.55)";
    for (var k = 0; k < 4; k++) ctx.fillRect(x + s * (0.18 + k * 0.08), y + s * (0.22 + k * 0.15), s * (0.64 - k * 0.16), s * 0.1);
    if (st.floor === E.FLOORS) {
      ctx.strokeStyle = st.hero.key ? COL.accent : "rgba(0,0,0,0.6)";
      ctx.lineWidth = 2;
      ctx.strokeRect(x + 3, y + 3, s - 6, s - 6);
    }
  }
  function drawTrap(i) {
    var c = cellXY(i), s = c.s;
    ctx.fillStyle = "rgba(0,0,0,0.5)";
    for (var k = 0; k < 3; k++) {
      ctx.beginPath();
      var bx = c.x + s * (0.2 + k * 0.22);
      ctx.moveTo(bx, c.y + s * 0.75);
      ctx.lineTo(bx + s * 0.1, c.y + s * 0.35);
      ctx.lineTo(bx + s * 0.2, c.y + s * 0.75);
      ctx.fill();
    }
  }
  function drawGold(i) {
    var c = cellXY(i), s = c.s;
    ctx.fillStyle = COL.gold;
    ctx.strokeStyle = "rgba(0,0,0,0.45)";
    ctx.lineWidth = 1.5;
    [[0.4, 0.6], [0.6, 0.62], [0.5, 0.45]].forEach(function (o) {
      ctx.beginPath();
      ctx.arc(c.x + s * o[0], c.y + s * o[1], s * 0.13, 0, Math.PI * 2);
      ctx.fill(); ctx.stroke();
    });
  }
  function drawLoot(i, it) {
    var c = cellXY(i), s = c.s, ty = E.item(it.k).t;
    ctx.fillStyle = COL[ty];
    rr(c.x + s * 0.25, c.y + s * 0.25, s * 0.5, s * 0.5, s * 0.1);
    ctx.fill();
    ctx.strokeStyle = it.c ? COL.danger : "rgba(0,0,0,0.5)";
    ctx.lineWidth = 2;
    ctx.stroke();
  }
  function drawChest(i) {
    var c = cellXY(i), s = c.s;
    ctx.fillStyle = "#8a5a2b";
    rr(c.x + s * 0.16, c.y + s * 0.3, s * 0.68, s * 0.48, s * 0.08);
    ctx.fill();
    ctx.fillStyle = "#6b4320";
    ctx.fillRect(c.x + s * 0.16, c.y + s * 0.44, s * 0.68, s * 0.06);
    ctx.fillStyle = COL.gold;
    ctx.fillRect(c.x + s * 0.45, c.y + s * 0.42, s * 0.1, s * 0.14);
  }
  function drawIntent(m) {
    var n = m.n;
    if (n.a === "a" || n.a === "s") {
      ctx.strokeStyle = COL.danger;
      ctx.lineWidth = 2.5;
      n.c.forEach(function (ci) {
        var c = cellXY(ci), s = c.s;
        ctx.fillStyle = "rgba(224,108,117,0.22)";
        ctx.fillRect(c.x + 1, c.y + 1, s - 2, s - 2);
        if (ci === n.c[n.c.length - 1] || n.a === "a") {
          ctx.beginPath();
          ctx.moveTo(c.x + s * 0.3, c.y + s * 0.3); ctx.lineTo(c.x + s * 0.7, c.y + s * 0.7);
          ctx.moveTo(c.x + s * 0.7, c.y + s * 0.3); ctx.lineTo(c.x + s * 0.3, c.y + s * 0.7);
          ctx.stroke();
        }
      });
    } else if (n.a === "m" && n.c.length) {
      var a = cellXY(m.i), b = cellXY(n.c[n.c.length - 1]), s2 = a.s;
      var ax = a.x + s2 / 2, ay = a.y + s2 / 2, bx = b.x + s2 / 2, by = b.y + s2 / 2;
      var ang = Math.atan2(by - ay, bx - ax), tipx = ax + Math.cos(ang) * s2 * 0.62, tipy = ay + Math.sin(ang) * s2 * 0.62;
      ctx.fillStyle = "rgba(255,255,255,0.55)";
      ctx.beginPath();
      ctx.moveTo(tipx, tipy);
      ctx.lineTo(tipx - Math.cos(ang - 0.6) * s2 * 0.18, tipy - Math.sin(ang - 0.6) * s2 * 0.18);
      ctx.lineTo(tipx - Math.cos(ang + 0.6) * s2 * 0.18, tipy - Math.sin(ang + 0.6) * s2 * 0.18);
      ctx.fill();
    }
  }
  var MON_COL = { rat: "#9b8f80", swarm: "#7d7266", bat: "#5e5470", bones: "#e6dfcf", archer: "#7fa36b",
    slime: "#6bbf73", ghoul: "#8fa0a8", mimic: "#8a5a2b", spider: "#3c3436", wisp: "#9fd3ef",
    guard: "#8d8a84", knight: "#9aa5b8", brute: "#a8654a", warden: "#5b3f7a" };
  function drawMon(m) {
    var c = cellXY(m.i), s = c.s, cx = c.x + s / 2, cy = c.y + s / 2, k = m.k;
    var body = MON_COL[k] || "#999";
    var r = s * (k === "brute" || k === "warden" ? 0.42 : k === "rat" || k === "bat" ? 0.28 : 0.34);
    ctx.lineWidth = 2;
    ctx.strokeStyle = "rgba(0,0,0,0.6)";
    ctx.fillStyle = body;
    if (k === "guard" || k === "knight") { rr(cx - r, cy - r, r * 2, r * 2, r * 0.3); ctx.fill(); ctx.stroke(); }
    else if (k === "slime") { ctx.beginPath(); ctx.ellipse(cx, cy + r * 0.25, r * 1.1, r * 0.8, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke(); }
    else if (k === "wisp") {
      ctx.globalAlpha = 0.85;
      ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha = 1;
    } else { ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill(); ctx.stroke(); }
    // features
    ctx.fillStyle = "rgba(0,0,0,0.75)";
    if (k === "rat" || k === "swarm") {
      [[-0.6, -0.8], [0.6, -0.8]].forEach(function (o) { ctx.beginPath(); ctx.arc(cx + o[0] * r, cy + o[1] * r, r * 0.32, 0, Math.PI * 2); ctx.fillStyle = body; ctx.fill(); ctx.stroke(); });
      ctx.fillStyle = "rgba(0,0,0,0.75)";
      if (k === "swarm") { ctx.beginPath(); ctx.arc(cx + r * 0.9, cy + r * 0.7, r * 0.45, 0, Math.PI * 2); ctx.fillStyle = body; ctx.fill(); ctx.stroke(); ctx.fillStyle = "rgba(0,0,0,0.75)"; }
    }
    if (k === "bat") {
      ctx.fillStyle = body;
      ctx.beginPath(); ctx.moveTo(cx - r, cy); ctx.lineTo(cx - r * 2, cy - r * 0.8); ctx.lineTo(cx - r * 1.6, cy + r * 0.4); ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(cx + r, cy); ctx.lineTo(cx + r * 2, cy - r * 0.8); ctx.lineTo(cx + r * 1.6, cy + r * 0.4); ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.fillStyle = "rgba(0,0,0,0.75)";
    }
    if (k === "spider") {
      ctx.strokeStyle = body;
      for (var l = 0; l < 4; l++) {
        var yy = cy - r * 0.6 + l * r * 0.4;
        ctx.beginPath(); ctx.moveTo(cx - r, yy); ctx.lineTo(cx - r * 1.5, yy + r * 0.3); ctx.moveTo(cx + r, yy); ctx.lineTo(cx + r * 1.5, yy + r * 0.3); ctx.stroke();
      }
      ctx.strokeStyle = "rgba(0,0,0,0.6)";
    }
    if (k === "archer") {
      ctx.strokeStyle = "#4b3a22"; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(cx + r * 0.9, cy, r * 0.9, -1.2, 1.2); ctx.stroke();
      ctx.strokeStyle = "rgba(0,0,0,0.6)";
    }
    if (k === "ghoul") {
      ctx.fillStyle = COL.gold;
      ctx.beginPath(); ctx.moveTo(cx + r * 0.6, cy + r * 0.2); ctx.lineTo(cx + r * 1.3, cy + r * 0.2); ctx.lineTo(cx + r * 1.1, cy - r * 0.5); ctx.lineTo(cx + r * 0.8, cy - r * 0.5); ctx.closePath(); ctx.fill();
      ctx.fillStyle = "rgba(0,0,0,0.75)";
    }
    if (k === "knight" || k === "guard") { ctx.fillRect(cx - r * 0.6, cy - r * 0.15, r * 1.2, r * 0.18); }
    if (k === "brute") { ctx.fillStyle = "#e6dfcf"; ctx.beginPath(); ctx.moveTo(cx - r * 0.5, cy + r * 0.3); ctx.lineTo(cx - r * 0.35, cy + r * 0.65); ctx.lineTo(cx - r * 0.2, cy + r * 0.3); ctx.moveTo(cx + r * 0.2, cy + r * 0.3); ctx.lineTo(cx + r * 0.35, cy + r * 0.65); ctx.lineTo(cx + r * 0.5, cy + r * 0.3); ctx.fill(); ctx.fillStyle = "rgba(0,0,0,0.75)"; }
    if (k === "warden") {
      ctx.fillStyle = COL.gold;
      ctx.beginPath(); ctx.moveTo(cx - r * 0.6, cy - r * 0.6); ctx.lineTo(cx - r * 0.6, cy - r * 1.05); ctx.lineTo(cx - r * 0.3, cy - r * 0.8); ctx.lineTo(cx, cy - r * 1.1); ctx.lineTo(cx + r * 0.3, cy - r * 0.8); ctx.lineTo(cx + r * 0.6, cy - r * 1.05); ctx.lineTo(cx + r * 0.6, cy - r * 0.6); ctx.closePath(); ctx.fill();
      ctx.fillStyle = "rgba(0,0,0,0.75)";
    }
    // eyes (asleep: closed)
    var ey = k === "slime" ? cy + r * 0.1 : cy - r * 0.25;
    if (m.aw) {
      ctx.fillStyle = k === "bones" || k === "ghoul" || k === "warden" ? COL.danger : "rgba(0,0,0,0.8)";
      ctx.beginPath(); ctx.arc(cx - r * 0.35, ey, Math.max(1.5, r * 0.14), 0, Math.PI * 2); ctx.arc(cx + r * 0.35, ey, Math.max(1.5, r * 0.14), 0, Math.PI * 2); ctx.fill();
    } else {
      ctx.strokeStyle = "rgba(0,0,0,0.7)"; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(cx - r * 0.5, ey); ctx.lineTo(cx - r * 0.2, ey); ctx.moveTo(cx + r * 0.2, ey); ctx.lineTo(cx + r * 0.5, ey); ctx.stroke();
    }
    // health bar when hurt
    var full = E.monStats(m.k, st.floor).hp;
    if (m.hp < full) {
      ctx.fillStyle = "rgba(0,0,0,0.6)";
      ctx.fillRect(c.x + s * 0.15, c.y + s * 0.06, s * 0.7, 4);
      ctx.fillStyle = COL.danger;
      ctx.fillRect(c.x + s * 0.15, c.y + s * 0.06, s * 0.7 * Math.max(0, m.hp) / full, 4);
    }
  }
  function drawHero() {
    var c = cellXY(st.hero.i), s = c.s, cx = c.x + s / 2, cy = c.y + s / 2, r = s * 0.32;
    if (st.hero.wd) {
      ctx.strokeStyle = COL.w; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(cx, cy, r + 4, 0, Math.PI * 2); ctx.stroke();
    }
    ctx.fillStyle = COL.hero;
    ctx.strokeStyle = "rgba(0,0,0,0.65)";
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    // hood
    ctx.fillStyle = "rgba(0,0,0,0.35)";
    ctx.beginPath(); ctx.arc(cx, cy - r * 0.1, r * 0.62, Math.PI, 0); ctx.fill();
    ctx.fillStyle = COL.text;
    ctx.beginPath(); ctx.arc(cx - r * 0.25, cy - r * 0.05, r * 0.1, 0, Math.PI * 2); ctx.arc(cx + r * 0.25, cy - r * 0.05, r * 0.1, 0, Math.PI * 2); ctx.fill();
    if (st.hero.key) {
      ctx.fillStyle = COL.gold;
      ctx.beginPath(); ctx.arc(cx + r * 0.95, cy + r * 0.7, r * 0.28, 0, Math.PI * 2); ctx.fill();
    }
  }
  function reducedMotion() {
    try { return window.matchMedia("(prefers-reduced-motion: reduce)").matches; } catch (e) { return false; }
  }
  function shake() {
    if (reducedMotion()) return;
    var w = $("map-wrap");
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
    if (game.done || st.over >= 0) { resultDialog(); return; }
    stopWalk();
    var h = st.hero.i;
    if (i === h) { if (E.groundAt(st).length) packDialog(); return; }
    var m = E.monAt(st, i);
    var vis = E.visible(st).indexOf(i) >= 0;
    if (E.dist(i, h) === 1) {
      if (!doAct({ t: "move", d: dirTo(h, i) })) shake();
      else sfx("step");
      return;
    }
    if (m && vis && !m.m) { foeInfo(m); return; }
    if (st.seen.charAt(i) !== "1" || !E.open(st, i)) { shake(); return; }
    walkTo(i);
  }
  function foeInfo(m) {
    var s = E.monStats(m.k, st.floor);
    var text = t("foe.info", { name: monName(m.k) + (m.aw ? "" : " (" + t("foe.sleep") + ")"), hp: m.hp, atk: s.atk, def: s.def, hab: t("hab." + m.k) });
    setMsg(text);
    live(text);
  }
  function wireInput() {
    var down = null;
    canvas.addEventListener("pointerdown", function (e) {
      down = { x: e.clientX, y: e.clientY, id: e.pointerId };
      try { canvas.setPointerCapture(e.pointerId); } catch (er) {}
    });
    canvas.addEventListener("pointerup", function (e) {
      if (!down || down.id !== e.pointerId) return;
      var dx = e.clientX - down.x, dy = e.clientY - down.y;
      down = null;
      if (Math.abs(dx) > 24 || Math.abs(dy) > 24) {   // a swipe: one step
        var d = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 1 : 3) : (dy > 0 ? 2 : 0);
        stepDir(d);
        return;
      }
      var p = localXY(e);
      tapCell(cellAt(p.x, p.y));
    });
    canvas.addEventListener("pointercancel", function () { down = null; });
    window.addEventListener("resize", function () { fitView(); });
  }
  function stepDir(d) {
    if (!game || game.done || st.over >= 0) return;
    stopWalk();
    cursor = -1;
    if (doAct({ t: "move", d: d })) sfx("step");
    else shake();
  }
  function useSlot(n) {
    var list = E.usable(st);
    if (n >= list.length || !game || game.done) return;
    var p = st.pack.it[list[n]], it = E.item(p.k);
    if (it.t === "r" && st.hero.fo < it.cost) { toastLine(t("ev.noFocus")); shake(); return; }
    stopWalk();
    if (!doAct({ t: "use", n: list[n] })) { toastLine(t("ev.cant")); shake(); }
    else sfx("use");
  }
  function wireKeyboard() {
    document.addEventListener("keydown", function (e) {
      if (document.querySelector("dialog[open]")) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      var k = e.key, map = { ArrowUp: 0, ArrowRight: 1, ArrowDown: 2, ArrowLeft: 3, w: 0, d: 1, s: 2, a: 3, W: 0, D: 1, S: 2, A: 3 };
      if (map[k] !== undefined) { e.preventDefault(); stepDir(map[k]); }
      else if (k === " " || k === ".") { e.preventDefault(); waitTurn(); }
      else if (k === "i" || k === "I") { e.preventDefault(); packDialog(); }
      else if (k === "n" || k === "N") { e.preventDefault(); newDialog(); }
      else if (k >= "1" && k <= "4") { e.preventDefault(); useSlot(+k - 1); }
      else if (k === "+" || k === "=") { e.preventDefault(); zoomBy(1.2); }
      else if (k === "-" || k === "_") { e.preventDefault(); zoomBy(1 / 1.2); }
      else if (k === "Escape") { stopWalk(); cursor = -1; draw(); }
    });
  }
  function waitTurn() {
    stopWalk();
    if (game && !game.done && doAct({ t: "wait" })) sfx("step");
  }

  // ---------- 7. Panels ----------
  function renderAll() {
    if (!st) return;
    follow();
    renderStatus();
    renderQuick();
    draw();
  }
  function renderStatus() {
    var s = E.stats(st), h = st.hero;
    var hp = $("s-hp");
    hp.querySelector(".fill").style.width = Math.round(100 * h.hp / s.mhp) + "%";
    hp.querySelector(".v").textContent = h.hp + "/" + s.mhp;
    hp.classList.toggle("low", h.hp <= s.mhp * 0.3);
    hp.setAttribute("aria-label", t("st.hp", { n: h.hp, m: s.mhp }));
    hp.title = hp.getAttribute("aria-label");
    $("s-atk").querySelector(".v").textContent = s.atk;
    $("s-atk").title = t("st.atk", { n: s.atk });
    $("s-def").querySelector(".v").textContent = s.def;
    $("s-def").title = t("st.def", { n: s.def }) + (h.wd ? " · " + t("st.warded") : "");
    $("s-def").classList.toggle("warded", !!h.wd);
    $("s-fo").querySelector(".v").textContent = h.fo + "/" + s.mfo;
    $("s-fo").title = t("st.fo", { n: h.fo, m: s.mfo });
    var dly = game && game.opts.day !== undefined;
    $("s-floor").querySelector(".v").textContent = dly ? st.floor + "/" + DAILY_END :
      (cw < 400 ? t("st.floorShort", { n: st.floor }) : t("st.floor", { n: st.floor }));
    $("s-floor").title = dly ? t("daily.floor", { n: game.opts.day + 1, f: st.floor, e: DAILY_END }) : t("st.floor", { n: st.floor });
    $("s-gold").querySelector(".v").textContent = h.gold;
    $("s-gold").title = t("st.gold", { n: h.gold });
    ["s-atk", "s-def", "s-fo", "s-floor", "s-gold"].forEach(function (id) { $(id).setAttribute("aria-label", $(id).title); });
    $("wait-btn").disabled = !game || game.done || st.over >= 0;
    var db = $("daily-btn");
    db.hidden = !DK;
    db.classList.toggle("due", !!DK && !data.days[today()]);
    db.classList.toggle("on", dly && !game.done);
  }
  function slotIcon(span, ty) {
    span.innerHTML = "";
    var g = document.createElement("span");
    g.className = "gl";
    g.style.background = COL[ty] || "#888";
    g.innerHTML = TYPE_ICON[ty] || "";
    span.appendChild(g);
  }
  function renderQuick() {
    var list = E.usable(st);
    for (var n = 0; n < 4; n++) {
      var b = $("q-" + n), ic = b.querySelector(".ic");
      if (n < list.length) {
        var p = st.pack.it[list[n]], it = E.item(p.k);
        slotIcon(ic, it.t);
        b.querySelector(".nm").textContent = itemName(p.k);
        b.querySelector(".cost").textContent = it.t === "r" ? String(it.cost) : "";
        b.classList.remove("empty");
        b.classList.toggle("poor", it.t === "r" && st.hero.fo < it.cost);
        b.disabled = !!game.done;
        var lbl = itemName(p.k) + (it.t === "r" ? ", " + t("use.cost", { n: it.cost }) : "") + " (" + (n + 1) + ")";
        b.setAttribute("aria-label", lbl);
        b.title = lbl + ": " + useText(it);
      } else {
        ic.innerHTML = "";
        b.querySelector(".nm").textContent = "";
        b.querySelector(".cost").textContent = "";
        b.classList.add("empty");
        b.classList.remove("poor");
        b.disabled = true;
        b.setAttribute("aria-label", t("slot.empty"));
        b.title = t("slot.empty");
      }
    }
  }
  function useText(it) {
    if (!it.use) return "";
    return t("use." + it.use, { n: it.n || 0 });
  }
  function effectText(it) {
    var out = [];
    ["atk", "def", "hp", "fo", "light"].forEach(function (k) {
      if (it[k]) out.push(t("fx." + k, { n: (it[k] > 0 ? "+" : "") + it[k] }));
    });
    if (it.trap) out.push(t("fx.trap"));
    if (it.gold) out.push(t("fx.gold", { n: it.gold }));
    if (it.regen) out.push(t("fx.regen", { n: it.regen }));
    if (it.frg) out.push(t("fx.frg", { n: it.frg }));
    if (it.use) out.push(useText(it) + (it.t === "r" ? " (" + t("use.cost", { n: it.cost }) + ")" : ""));
    return out.join(" · ");
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

  function newDialog() {
    cancelTourWait();
    stopWalk();
    // Today's crypt under way: leaving it uses the one try.
    if (game && game.opts.day !== undefined && inProgressOf(game)) {
      confirmDialog(t("daily.leave"), function () { leaveDaily(); saveSession(); renderAll(); newDialog(); },
        t("daily.leaveYes"), t("daily.leaveNo"));
      return;
    }
    var o = { mode: prefs.mode };
    var dlg = makeDialog("cr-new");
    dlg.appendChild(el("div", "dlg-title", t("new.title")));
    var note = el("div", "dlg-note", t("mode." + o.mode + ".note"));
    dlg.appendChild(segField(t("new.mode"), MODES, o.mode, "mode.", function (v) { o.mode = v; note.textContent = t("mode." + v + ".note"); }));
    dlg.appendChild(note);
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
      prefs.mode = o.mode;
      savePrefs();
      dlg.close();
      startGame({ mode: o.mode, seed: cleanSeed(seed.value) || newSeed() });
    });
    acts.appendChild(go);
    dlg.appendChild(acts);
    document.body.appendChild(dlg);
    dlg.showModal();
    go.focus();
  }

  // The backpack: a grid with the items on it, the floor under you and
  // the chosen item. Packing takes no turn, unless an awake monster
  // can see you (then closing takes one).
  function packDialog() {
    if (!game || st.over >= 0) return;
    stopWalk();
    var dlg = makeDialog("cr-pack", "pack");
    var selP = -1, selL = -1, rot = 0, undoStack = [], changed = false, drag = null;
    var startSnap = JSON.stringify({ p: st.pack, l: st.loot });
    dlg.appendChild(el("div", "dlg-title", t("pack.title")));
    var statsBox = el("div", "pk-stats");
    dlg.appendChild(statsBox);
    var wrap = el("div", "pk-wrap"), grid = el("div", "pk-grid");
    wrap.appendChild(grid);
    dlg.appendChild(wrap);
    dlg.appendChild(el("div", "dlg-sub", t("pack.floor")));
    var floorBox = el("div", "pk-floor");
    dlg.appendChild(floorBox);
    var info = el("div", "pk-info");
    info.setAttribute("aria-live", "polite");
    dlg.appendChild(info);
    var acts1 = el("div", "dlg-actions wrap");
    var bRot = button(t("pack.rotate"), "", function () { rotate(); });
    var bUse = button(t("pack.use"), "", function () { useSel(); });
    var bOut = button(t("pack.out"), "", function () { takeOut(); });
    var bIn = button(t("pack.in"), "", function () { packIn(); });
    [bRot, bUse, bOut, bIn].forEach(function (b) { acts1.appendChild(b); });
    dlg.appendChild(acts1);
    var acts2 = el("div", "dlg-actions");
    var bUndo = button(t("pack.undo"), "", function () { undoPack(); });
    var bDone = button(t("pack.done"), "primary", function () { dlg.close(); });
    acts2.appendChild(bUndo);
    acts2.appendChild(bDone);
    dlg.appendChild(acts2);

    function pc() {
      var w = Math.min(dlg.clientWidth || 340, window.innerWidth - 16) - 28;
      return clamp(Math.floor(w / st.pack.w), 34, 52);
    }
    function snap() {
      undoStack.push(JSON.stringify({ p: st.pack, l: st.loot }));
      if (undoStack.length > PACK_UNDO) undoStack.shift();
    }
    function undoPack() {
      if (!undoStack.length) return;
      var s = JSON.parse(undoStack.pop());
      st.pack = s.p; st.loot = s.l;
      selP = -1; selL = -1;
      after();
    }
    function after() {
      changed = JSON.stringify({ p: st.pack, l: st.loot }) !== startSnap;
      saveSession();
      render();
      renderAll();
    }
    function selItem() {
      if (selP >= 0) return { k: st.pack.it[selP].k, c: st.pack.it[selP].c, r: st.pack.it[selP].r, inPack: true };
      if (selL >= 0) return { k: st.loot[selL].it.k, c: st.loot[selL].it.c, r: rot, inPack: false };
      return null;
    }
    function place(x, y, r) {
      var ok;
      snap();
      if (selP >= 0) ok = E.packMove(st, selP, x, y, r);
      else if (selL >= 0) {
        ok = E.packAdd(st, selL, x, y, r);
        if (ok) { selP = st.pack.it.length - 1; selL = -1; sfx("pick"); }
      }
      if (!ok) { undoStack.pop(); toastLine(t("pack.noFit")); return false; }
      after();
      return true;
    }
    function rotate() {
      var s = selItem();
      if (!s) return;
      if (s.inPack) {
        var p = st.pack.it[selP], r = (p.r + 1) % 4;
        // turn in place, or at the nearest spot that fits
        var spots = [[0, 0], [-1, 0], [0, -1], [-1, -1], [1, 0], [0, 1], [-2, 0], [0, -2]];
        for (var k = 0; k < spots.length; k++) {
          if (E.fits(st.pack, p.k, p.x + spots[k][0], p.y + spots[k][1], r, selP)) { place(p.x + spots[k][0], p.y + spots[k][1], r); return; }
        }
        toastLine(t("pack.noFit"));
      } else { rot = (rot + 1) % 4; render(); }
    }
    function takeOut() {
      if (selP < 0) return;
      if (st.pack.it[selP].c) { toastLine(t("pack.cursed")); return; }
      snap();
      E.packDrop(st, selP);
      selP = -1;
      selL = st.loot.length - 1;
      rot = st.loot[selL].it.r;
      after();
    }
    function packIn() {
      if (selL < 0) return;
      var sp = E.findSpot(st.pack, st.loot[selL].it.k);
      if (!sp) { toastLine(t("pack.noRoom")); return; }
      place(sp.x, sp.y, sp.r);
    }
    function useSel() {
      if (selP < 0) return;
      dlg.close();
      if (!doAct({ t: "use", n: selP })) toastLine(t("ev.cant"));
      else sfx("use");
    }
    function render() {
      var s = E.stats(st), size = pc(), links = s.links, def = null;
      wrap.style.setProperty("--pc", size + "px");
      wrap.style.width = (size * st.pack.w) + "px";
      statsBox.innerHTML = "";
      [[t("st.atk", { n: "" }), s.atk], [t("st.def", { n: "" }), s.def], [t("fx.hp", { n: "" }), s.mhp],
       [t("fx.fo", { n: "" }), s.mfo], [t("pack.light", { n: "" }), s.light], [t("pack.links", { n: "" }), links.length]].forEach(function (x) {
        var sp = el("span", "", String(x[0]).trim() + " ");
        sp.appendChild(el("b", "", String(x[1])));
        statsBox.appendChild(sp);
      });
      if (s.gold) { var gs = el("span", "", t("pack.gold", { n: "" }).replace(/\s*%$/, "").trim() + " "); gs.appendChild(el("b", "", s.gold + " %")); statsBox.appendChild(gs); }
      // cells
      grid.innerHTML = "";
      grid.style.gridTemplateColumns = "repeat(" + st.pack.w + ", " + size + "px)";
      var g = E.packGrid(st.pack, -1);
      for (var y = 0; y < st.pack.h; y++) for (var x = 0; x < st.pack.w; x++) {
        var b = el("button", "pk-cell");
        b.type = "button";
        b.dataset.x = x; b.dataset.y = y;
        var who = g[y * st.pack.w + x];
        b.setAttribute("aria-label", who >= 0 ? t("pack.cellOf", { item: itemName(st.pack.it[who].k), x: x + 1, y: y + 1 }) : t("pack.cell", { x: x + 1, y: y + 1 }));
        grid.appendChild(b);
      }
      // items
      [].slice.call(wrap.querySelectorAll(".pk-item")).forEach(function (n) { n.remove(); });
      var lit = {};
      links.forEach(function (l) { lit[l.a + ":" + l.x + ":" + l.y + ":" + l.d] = 1; lit[l.b + ":" + (l.x + E.DX[l.d]) + ":" + (l.y + E.DY[l.d]) + ":" + ((l.d + 2) % 4)] = 1; });
      st.pack.it.forEach(function (p, n) { wrap.appendChild(itemNode(p.k, p.r, p.x, p.y, size, n === selP, p.c, n, lit)); });
      // floor
      floorBox.innerHTML = "";
      var here = E.groundAt(st);
      if (!here.length) floorBox.appendChild(el("span", "dlg-empty", t("pack.none")));
      here.forEach(function (n) {
        var l = st.loot[n], it = E.item(l.it.k);
        var chip = el("button", "pk-chip" + (n === selL ? " sel" : "") + (l.it.c ? " cur" : ""));
        chip.type = "button";
        var sw = el("span", "sw");
        sw.style.background = COL[it.t];
        chip.appendChild(sw);
        chip.appendChild(el("span", "", itemName(l.it.k)));
        chip.addEventListener("pointerdown", function (e) { startDrag(e, -1, n, 0, 0); });
        chip.addEventListener("click", function () { if (drag && drag.moved) return; selL = n; selP = -1; rot = l.it.r; render(); });
        floorBox.appendChild(chip);
      });
      // chosen item
      info.innerHTML = "";
      var si = selItem();
      if (si) {
        def = E.item(si.k);
        info.appendChild(el("div", "nm", itemName(si.k) + " · " + t("t." + def.t)));
        info.appendChild(el("div", "fx", effectText(def)));
        if (si.c) info.appendChild(el("div", "bad", t("it.cursed")));
      } else info.appendChild(el("div", "fx", t("pack.pick")));
      bRot.disabled = !si;
      bUse.disabled = !(si && si.inPack && def.use);
      bOut.disabled = !(si && si.inPack) || !!(si && si.c);
      bIn.disabled = !(si && !si.inPack);
      bUndo.disabled = !undoStack.length;
    }
    function itemNode(k, r, x, y, size, sel, cur, n, lit) {
      var sh = E.shapeOf(k, r), ty = E.item(k).t;
      var node = el("div", "pk-item" + (sel ? " sel" : "") + (cur ? " cur" : ""));
      node.style.transform = "translate(" + (x * size) + "px," + (y * size) + "px)";
      sh.cells.forEach(function (c, ci) {
        var sq = el("div", "pk-sq");
        sq.style.left = (c[0] * size) + "px";
        sq.style.top = (c[1] * size) + "px";
        sq.style.background = COL[ty];
        if (ci === 0) { var gl = el("span", "gl"); gl.innerHTML = TYPE_ICON[ty]; sq.appendChild(gl); }
        if (n >= 0) {
          sq.addEventListener("pointerdown", function (e) { startDrag(e, n, -1, c[0], c[1]); });
        }
        node.appendChild(sq);
      });
      sh.ports.forEach(function (pt) {
        var c = sh.cells[pt[0]], dot = el("span", "pk-port");
        var on = lit && lit[n + ":" + (x + c[0]) + ":" + (y + c[1]) + ":" + pt[1]];
        if (on) dot.classList.add("on");
        var cx = (c[0] + 0.5) * size + E.DX[pt[1]] * size * 0.5 - 5, cy = (c[1] + 0.5) * size + E.DY[pt[1]] * size * 0.5 - 5;
        dot.style.left = cx + "px";
        dot.style.top = cy + "px";
        node.appendChild(dot);
      });
      return node;
    }
    // Drag an item (pack index p or floor index l), grabbed at its cell gx, gy.
    function startDrag(e, p, l, gx, gy) {
      e.preventDefault();
      var k = p >= 0 ? st.pack.it[p].k : st.loot[l].it.k;
      var r = p >= 0 ? st.pack.it[p].r : (l === selL ? rot : st.loot[l].it.r);
      drag = { p: p, l: l, k: k, r: r, gx: gx, gy: gy, x0: e.clientX, y0: e.clientY, moved: false, ghost: null, id: e.pointerId };
      document.addEventListener("pointermove", onMove);
      document.addEventListener("pointerup", onUp);
      document.addEventListener("pointercancel", onCancel);
    }
    function cellUnder(e) {
      var rc = grid.getBoundingClientRect(), size = pc();
      return { x: Math.floor((e.clientX - rc.left) / size) - drag.gx, y: Math.floor((e.clientY - rc.top) / size) - drag.gy };
    }
    function onMove(e) {
      if (!drag || e.pointerId !== drag.id) return;
      if (!drag.moved && Math.abs(e.clientX - drag.x0) + Math.abs(e.clientY - drag.y0) < 8) return;
      drag.moved = true;
      var size = pc(), rc = wrap.getBoundingClientRect();
      if (!drag.ghost) { drag.ghost = itemNode(drag.k, drag.r, 0, 0, size, false, 0, -1, null); drag.ghost.classList.add("ghost"); wrap.appendChild(drag.ghost); }
      drag.ghost.style.transform = "translate(" + (e.clientX - rc.left - (drag.gx + 0.5) * size) + "px," + (e.clientY - rc.top - (drag.gy + 0.5) * size) + "px)";
      var at = cellUnder(e), ok = E.fits(st.pack, drag.k, at.x, at.y, drag.r, drag.p);
      [].forEach.call(grid.children, function (b) { b.classList.remove("ok", "no"); });
      E.shapeOf(drag.k, drag.r).cells.forEach(function (c) {
        var x = at.x + c[0], y = at.y + c[1];
        if (x < 0 || y < 0 || x >= st.pack.w || y >= st.pack.h) return;
        grid.children[y * st.pack.w + x].classList.add(ok ? "ok" : "no");
      });
    }
    function endDrag() {
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerup", onUp);
      document.removeEventListener("pointercancel", onCancel);
      if (drag && drag.ghost) drag.ghost.remove();
    }
    function onCancel() { endDrag(); drag = null; render(); }
    function onUp(e) {
      if (!drag || e.pointerId !== drag.id) return;
      endDrag();
      var d = drag;
      setTimeout(function () { drag = null; }, 0);
      if (!d.moved) {
        // a tap: choose it; a second tap on the chosen item turns it
        if (d.p >= 0) {
          if (selP === d.p) rotate();
          else { selP = d.p; selL = -1; render(); }
        }
        return;
      }
      var at = cellUnder(e);
      if (d.p >= 0) { selP = d.p; selL = -1; }
      else { selL = d.l; selP = -1; rot = d.r; }
      if (!place(at.x, at.y, d.r)) render();
    }
    grid.addEventListener("click", function (e) {
      var b = e.target.closest(".pk-cell");
      if (!b || (drag && drag.moved)) return;
      var si = selItem();
      if (!si) return;
      place(+b.dataset.x, +b.dataset.y, si.inPack ? st.pack.it[selP].r : rot);
    });
    dlg.addEventListener("keydown", function (e) {
      if (e.key === "r" || e.key === "R") { e.preventDefault(); rotate(); }
      else if (e.key === "z" || e.key === "Z") { e.preventDefault(); undoPack(); }
    });
    dlg.addEventListener("close", function () {
      endDrag();
      renderAll();
      // packing in sight of a monster takes a turn
      if (changed && st.over < 0 && st.mons.some(function (m) { return m.aw && !m.m && E.los(st, m.i, st.hero.i) && E.cheb(m.i, st.hero.i) <= 7; })) {
        doAct({ t: "wait" });
        toastLine(t("ev.packTurn"));
      }
    });
    document.body.appendChild(dlg);
    dlg.showModal();
    render();
    bDone.focus();
  }

  function resultDialog() {
    if (!game || st.over < 0) return;
    if (game.opts.day !== undefined && data.days[game.opts.day]) { dailyDialog(game.opts.day); return; }
    var dlg = makeDialog("cr-result");
    var won = st.over === 1;
    dlg.appendChild(el("div", "dlg-title", t("app.name") + " · " + t("mode." + game.opts.mode)));
    dlg.appendChild(el("div", "dlg-hero" + (won ? "" : " lost"), won ? t("res.won") : t("res.fell", { n: st.floor })));
    if (!won && game.cause) dlg.appendChild(el("div", "dlg-msg", t("res.by", { k: game.cause })));
    dlg.appendChild(row(t("res.turns"), String(st.turn)));
    dlg.appendChild(row(t("res.gold"), String(st.hero.gold)));
    dlg.appendChild(row(t("res.kills"), String(st.hero.kills)));
    dlg.appendChild(el("div", "dlg-note", t("res.code", { seed: game.opts.seed })));
    var acts = el("div", "dlg-actions wrap");
    var first;
    if (!won && game.cp && !game.done) {
      first = button(t("res.back", { n: game.cp.floor }), "primary", function () { dlg.close(); backToSave(); });
      acts.appendChild(first);
    }
    acts.appendChild(button(t("res.same"), "", function () { dlg.close(); endIfWaiting(); startGame({ mode: game.opts.mode, seed: game.opts.seed }); }));
    var again = button(t("res.new"), first ? "" : "primary", function () { dlg.close(); endIfWaiting(); newDialog(); });
    acts.appendChild(again);
    dlg.appendChild(acts);
    document.body.appendChild(dlg);
    dlg.showModal();
    (first || again).focus();
  }
  // A fall in Gentle waits for "back to the save point"; anything else ends the run.
  function endIfWaiting() {
    if (game && st.over === 0 && !game.done) {
      if (!game.counted) { count(game.opts.mode, "run"); game.counted = true; }
      game.done = true;
      saveSession();
    }
  }

  function statsDialog() {
    var dlg = makeDialog("cr-stats");
    dlg.appendChild(el("div", "dlg-title", t("stats.title")));
    dlg.appendChild(el("div", "dlg-sub", t("stats.head")));
    var empty = true;
    MODES.forEach(function (m) {
      var v = totals(m);
      if (v[0] + v[2]) empty = false;
      dlg.appendChild(row(t("mode." + m), v[0] + " · " + v[1] + " · " + (v[2] || "–")));
    });
    var ds = dailyStats(today());
    if (ds.n) empty = false;
    dlg.appendChild(el("div", "dlg-sub", t("stats.daily") + " · " + t("stats.dailyRow")));
    dlg.appendChild(row(t("daily.label"), ds.n ? ds.n + " · " + ds.w + " · " + ds.cur + " · " + ds.best : "–"));
    if (game && game.opts.day === undefined) dlg.appendChild(el("div", "dlg-note", t("stats.code", { seed: game.opts.seed })));
    var acts = el("div", "dlg-actions wrap");
    hubLink(acts, dlg);
    var reset = button(t("stats.reset"), "danger", function () {
      dlg.close();
      confirmDialog(t("confirm.reset"), resetRecords);
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
  // ---------- Daily crypt ----------
  function today() { return DK ? DK.today() : 0; }
  function dailyOpts(day) { return { mode: "g", seed: cleanSeed(DK.seedOf("crypt", day)), day: day }; }
  // The Daily button: today's result when it is played (here or on
  // another device), else today's crypt (resumed when it is open).
  function openDaily() {
    if (!DK) { showToast(t("toast.dailyGone")); return; }
    var d = today();
    if (data.days[d]) { dailyDialog(d); return; }
    if (game && game.opts.day === d && !game.done) return;
    startGame(dailyOpts(d));
    toastLine(t("daily.rules"));
    live(t("daily.rules"));
  }
  function dailyDialog(day) {
    var r = data.days[day];
    if (!r || !DK) return;
    var s2 = dailyStats(today());
    var dlg = makeDialog("cr-daily");
    dlg.appendChild(el("div", "dlg-title", t("daily.title", { n: day + 1 }) + " · " + DK.dateLabel(day, LANG)));
    dlg.appendChild(el("div", "dlg-hero" + (r.w ? "" : " lost"), r.w ? t("daily.won", { t: r.t }) : t("daily.lost", { f: r.f })));
    dlg.appendChild(row(t("daily.turns"), String(r.t)));
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
  // Spoiler-free: out or not, the floors reached as five squares and
  // the turns. Never what was where.
  function shareDaily(day) {
    var r = data.days[day];
    if (!r || !DK) return;
    var sq = "";
    for (var k = 1; k <= DAILY_END; k++) sq += k < r.f || (k === r.f && r.w) ? "🟪" : (k === r.f ? "🟥" : "⬜");
    var text = DK.shareText({ game: t("app.name"), label: t("daily.label"), day: day, grid: [sq],
      line: r.w ? "🗝 " + t("share.won", { t: r.t }) : "💀 " + t("share.lost", { f: r.f }) });
    DK.share(text, "orOS " + t("app.name")).then(function (how) {
      if (how === "copied") showToast(t("toast.copied"));
      else if (how === "shared") live(t("toast.shared"));
      else if (how === "failed") showToast(t("toast.copyFail"));
    });
  }
  // "All games" (the Game Center), only when it is installed.
  function hubLink(acts, dlg) {
    if (!DK || !DK.hasHub()) return;
    acts.appendChild(button(t("daily.games"), "", function () { dlg.close(); DK.openHub("crypt"); }));
  }

  function confirmDialog(msg, onYes, yesLabel, noLabel) {
    var dlg = makeDialog("cr-confirm");
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
    data = mergeCrypt(data, data);
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
    var dlg = makeDialog("cr-tour");
    dlg.appendChild(el("div", "dlg-title", t("tour.title") + " · " + n + "/5"));
    dlg.appendChild(el("div", "dlg-msg", t("tour." + n)));
    var acts = el("div", "dlg-actions");
    function seen() { prefs.tour = true; savePrefs(); }
    if (n < 5) acts.appendChild(button(t("tour.skip"), "", function () { seen(); dlg.close(); }));
    var next = button(t(n < 5 ? "tour.next" : "tour.done"), "primary", function () {
      dlg.close();
      if (n < 5) setTimeout(function () { tourDialog(n + 1); }, 0);
      else seen();
    });
    acts.appendChild(next);
    dlg.appendChild(acts);
    dlg.addEventListener("cancel", seen);
    document.body.appendChild(dlg);
    dlg.showModal();
    next.focus();
  }

  // ---------- 9. Toasts ----------
  function showToast(text) {
    try {
      var n = (window.parent && window.parent.orosNotifs) || window.orosNotifs;
      if (n && typeof n.transient === "function" &&
          n.transient({ ns: "crypt", title: String(text) })) return;
    } catch (e) {}
    localToast(text);
  }
  // In-game lines stay inside the game (not the shell's notices).
  function toastLine(text) { localToast(text); }
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
  var HAPTIC = { step: "tick", hit: "tick", hurt: "bad", kill: "good", pick: "tick", gold: "tick", use: "tick", floor: "good", win: "win", end: "bad" };
  function sfx(kind) {
    if (window.orosHaptics && HAPTIC[kind] && kind !== "step") window.orosHaptics.cue(HAPTIC[kind]);
    if (!sfxOn()) return;
    try {
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      if (!audio) audio = new AC();
      if (audio.state === "suspended") audio.resume();
      if (kind === "step") tone(196, 0, 0.04, "triangle", 0.05);
      else if (kind === "hit") { tone(220, 0, 0.06, "square", 0.08); tone(165, 0.05, 0.08, "triangle", 0.1); }
      else if (kind === "hurt") { tone(140, 0, 0.14, "sawtooth", 0.08); }
      else if (kind === "kill") { tone(330, 0, 0.08, "triangle", 0.1); tone(247, 0.07, 0.14, "triangle", 0.1); }
      else if (kind === "pick") { tone(659, 0, 0.06, "sine", 0.1); tone(880, 0.05, 0.08, "sine", 0.08); }
      else if (kind === "gold") { tone(1047, 0, 0.05, "sine", 0.08); tone(1319, 0.04, 0.07, "sine", 0.07); }
      else if (kind === "use") { tone(523, 0, 0.1, "sine", 0.1); tone(784, 0.08, 0.14, "sine", 0.08); }
      else if (kind === "floor") [262, 220, 175].forEach(function (f, k) { tone(f, k * 0.1, 0.2, "triangle", 0.1); });
      else if (kind === "win") [523, 659, 784, 1047].forEach(function (f, k) { tone(f, k * 0.11, 0.22, "triangle"); });
      else if (kind === "end") { tone(392, 0, 0.18, "sine"); tone(262, 0.16, 0.34, "sine"); }
    } catch (e) { /* no audio → silent */ }
  }

  // ---------- Icons (R9: icon buttons ship empty, filled here) ----------
  var SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">';
  var UI_ICONS = {
    new:    SVG + '<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/></svg>',
    wait:   SVG + '<path d="M6 3h12M6 21h12M7 3c0 5 10 5 10 9s-10 4-10 9M17 3c0 5-10 5-10 9"/></svg>',
    daily:  SVG + '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 10h18"/><path d="M9 20v-4a3 3 0 0 1 6 0v4"/></svg>',
    stats:  SVG + '<path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0z"/><path d="M17 5h3v2a3 3 0 0 1-3 3M7 5H4v2a3 3 0 0 0 3 3"/></svg>',
    sfxOn:  SVG + '<path d="M11 5 6 9H2v6h4l5 4z"/><path d="M15.5 8.5a5 5 0 0 1 0 7M19 5a10 10 0 0 1 0 14"/></svg>',
    sfxOff: SVG + '<path d="M11 5 6 9H2v6h4l5 4z"/><path d="M22 9l-6 6M16 9l6 6"/></svg>',
    zin:    SVG + '<circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3M11 8v6M8 11h6"/></svg>',
    zout:   SVG + '<circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3M8 11h6"/></svg>',
    hp:     SVG + '<path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z"/></svg>',
    atk:    SVG + '<path d="M14.5 4H20v5.5L9 20.5 3.5 15z"/><path d="M5 13l6 6"/></svg>',
    def:    SVG + '<path d="M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6z"/></svg>',
    fo:     SVG + '<path d="M12 3l2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5z"/></svg>',
    gold:   SVG + '<circle cx="12" cy="12" r="8"/><path d="M12 8v8M9.5 10.5h4a1.5 1.5 0 0 1 0 3h-3"/></svg>'
  };
  var GS = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round">';
  var TYPE_ICON = {
    b: GS + '<path d="M14.5 4H20v5.5L9 20.5 3.5 15z"/></svg>',
    w: GS + '<path d="M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6z"/></svg>',
    r: GS + '<path d="M12 3l2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5z"/></svg>',
    c: GS + '<circle cx="12" cy="12" r="6"/><path d="M12 2v4M12 18v4"/></svg>',
    p: GS + '<path d="M9 3h6M10 3v5l-4 7a4 4 0 0 0 3.5 6h5A4 4 0 0 0 18 15l-4-7V3"/></svg>',
    s: GS + '<path d="M6 4h11a2 2 0 0 1 0 4H8M6 4a2 2 0 0 0 0 4h2v10a2 2 0 0 0 4 0V8"/></svg>'
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
    if (st) renderQuick();
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
    api.registerSlice("crypt", sliceGet, sliceSet, STORAGE_KEY, mergeCrypt);
  }
  function sliceGet() { return mergeCrypt(data, data); }   // canonical copy (R26)
  function sliceSet(incoming) {
    if (!incoming || typeof incoming !== "object" || !incoming.rows) return;
    window.__orosSyncApi._suppress = true;   // R6: a pull never marks dirty
    try {
      data = mergeCrypt(incoming, incoming);
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
    canvas.setAttribute("aria-label", t("map.label"));
    $("pack-btn").title = t("btn.packKey");
  }
  function paintStatic() {
    [["new-btn", "new", "btn.new"], ["wait-btn", "wait", "btn.wait"], ["stats-btn", "stats", "btn.stats"],
     ["daily-btn", "daily", "btn.daily"], ["zin-btn", "zin", "btn.zoomIn"], ["zout-btn", "zout", "btn.zoomOut"]
    ].forEach(function (x) {
      var b = $(x[0]);
      b.innerHTML = UI_ICONS[x[1]];
      b.setAttribute("aria-label", t(x[2]));
      b.title = t(x[2]);
    });
    [["s-hp", "hp"], ["s-atk", "atk"], ["s-def", "def"], ["s-fo", "fo"], ["s-gold", "gold"]].forEach(function (x) {
      $(x[0]).querySelector(".ic").innerHTML = UI_ICONS[x[1]];
    });
    paintSfxBtn();
  }
  function wire() {
    $("new-btn").addEventListener("click", function () { newDialog(); });
    $("wait-btn").addEventListener("click", waitTurn);
    $("pack-btn").addEventListener("click", packDialog);
    $("stats-btn").addEventListener("click", statsDialog);
    $("daily-btn").addEventListener("click", openDaily);
    // Deep link from the Game Center: { daily: true } opens today's crypt.
    window.__orosOpenAt = function (tg) { if (tg && tg.daily) openDaily(); };
    $("zin-btn").addEventListener("click", function () { zoomBy(1.2); });
    $("zout-btn").addEventListener("click", function () { zoomBy(1 / 1.2); });
    $("sfx-btn").addEventListener("click", function () {
      try { localStorage.setItem(SFX_KEY, sfxOn() ? "0" : "1"); } catch (e) {}
      paintSfxBtn();
      sfx("pick");
    });
    for (var n = 0; n < 4; n++) (function (k) { $("q-" + k).addEventListener("click", function () { useSlot(k); }); })(n);
    wireInput();
    wireKeyboard();
    // Save on the way out (R10 session).
    document.addEventListener("visibilitychange", function () {
      if (document.hidden && game) { stopWalk(); saveSession(); }
      if (!document.hidden && game) renderStatus();   // the Daily dot after midnight
    });
    window.addEventListener("pagehide", function () { if (game) saveSession(); });
  }

  function boot() {
    canvas = $("map");
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
    var tg = DK ? DK.takeTarget("crypt") : null;
    var daily = !!(tg && tg.daily && DK);
    if (daily && !data.days[today()] && !(game && game.opts.day === today() && !game.done)) {
      if (!game || !inProgressOf(game)) { game = makeGame(dailyOpts(today())); daily = false; }
    }
    if (!game) game = makeGame({ mode: prefs.mode, seed: newSeed() });
    st = game.g;
    saveSession();
    fitView();
    renderAll();
    if (daily) setTimeout(openDaily, 300);
    else if (st.over >= 0) setTimeout(resultDialog, 300);
    else maybeTour();
  }

  boot();
})();
