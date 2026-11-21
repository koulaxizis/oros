// ============================================================
// orOS Orbit garden — App logic (v1.0.0)
// A tower defense game on a round map: a little garden on a small
// moon. At night falling sparks come in at a gate on the rim and
// spiral in towards the moonflower. Plants grow on three stone rings;
// every ring has one gap, and between waves the rings turn a step at a
// time, which moves the plants and changes how far the sparks walk
// round before they find the gap. Real time with pause (1x / 2x / 3x),
// a wave starts only when the player calls it. The rules live in
// orbit/engine.js (OrbitEngine, tested headless); this file is the
// screen, the saves and the clock.
// Data:
//   - synced slice "orbit" (oros-orbit-data): best stars per garden
//     and per-device counter rows (OrbitEngine.merge, a join). Written
//     only when a night ends or progress is reset; never during play.
//   - device-local (R10): oros-orbit-session ({g: the night in
//     progress, ck: the night at the start of its last wave, counted},
//     saved at every wave start, after every change and on the way
//     out; read by gamekit/resume.js), oros-orbit-prefs (difficulty,
//     tour, last garden), oros-orbit-device, oros-orbit-sfx.
// Sections:
//   1. Constants, i18n, helpers
//   2. Saves (progress, prefs, session)
//   3. The night: start, actions, ending
//   4. Loop (real time, speed, pause)
//   5. Scene (the garden on one canvas)
//   6. Input (tap, keyboard)
//   7. Toolbar + bottom bar
//   8. Garden list
//   9. Dialogs (end of night, how to play, confirm)
//  10. Toasts + live region
//  11. Sound
//  12. Sync slice + palette
//  13. Test hooks, wiring & boot
// ============================================================
(function () {
  "use strict";

  var E = window.OrbitEngine;

  var STORAGE_KEY = "oros-orbit-data";
  var PREFS_KEY   = "oros-orbit-prefs";
  var SESSION_KEY = "oros-orbit-session";
  var DEVICE_KEY  = "oros-orbit-device";
  var SFX_KEY     = "oros-orbit-sfx";
  var SAVE_MS     = 600;                 // a change is saved this long after
  var RUN_SAVE_MS = 5000;                // and while the night runs, this often
  var SPEEDS      = [1, 2, 3];
  var VIEW_UNITS  = 12.6;                // the garden (12 units) and a little room

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
      "app.name": "Orbit garden",
      "btn.map": "Gardens (L)", "btn.help": "How to play (?)",
      "btn.sfxOn": "Sound on (M)", "btn.sfxOff": "Sound off (M)",
      "btn.pause": "Pause (Space)", "btn.play": "Play (Space)", "btn.speed": "Speed {n}x (F)",
      "btn.next": "Next wave", "btn.nextEarly": "Wave now (+{n})", "btn.nextKey": "Call the next wave (N)",
      "btn.first": "First wave", "btn.lastOut": "Last wave is out", "btn.ok": "Good", "btn.cancel": "Cancel",
      "btn.again": "Try again from wave {n}", "btn.restart": "Play the night again", "btn.nextGd": "Next garden",
      "btn.toMap": "Gardens",
      "btn.reset": "Reset progress", "btn.resetYes": "Reset",
      "view.label": "The garden: three stone rings with slots for plants, a gap in each ring, the gates on the rim and the moonflower in the middle. Arrow keys move the cursor: left and right along a ring, up and down between rings.",
      "st.hearts": "Hearts", "st.coins": "Coins", "st.wave": "Wave {n} of {m}", "st.waveShort": "{n}/{m}",
      "diff.m": "Mild", "diff.n": "Normal", "diff.h": "Hard",
      "pl.thorn": "Thorn bush", "pl.dew": "Dew sprinkler", "pl.sun": "Sunflower", "pl.vine": "Snare vine",
      "pl.thorn.a": "Briar", "pl.thorn.b": "Bramble", "pl.dew.a": "Mist", "pl.dew.b": "Cold dew",
      "pl.sun.a": "Big head", "pl.sun.b": "Noon burst", "pl.vine.a": "Long tendril", "pl.vine.b": "Twin vine",
      "fx.thorn": "Shoots thorns at one spark at a time.",
      "fx.dew": "Every two seconds a spray that slows every spark in reach.",
      "fx.sun": "A warm pulse that hurts every spark in reach and cracks meteor shells.",
      "fx.vine": "Now and then holds one spark still for a moment.",
      "fx.thorn.a": "Long reach and heavy thorns, a little slower.", "fx.thorn.b": "Shoots twice as fast.",
      "fx.dew.a": "Sprays wider and slows more.", "fx.dew.b": "The spray also hurts.",
      "fx.sun.a": "A much wider pulse.", "fx.sun.b": "A much stronger pulse.",
      "fx.vine.a": "Reaches farther and holds longer.", "fx.vine.b": "Holds two sparks at once.",
      "sk.s": "spark", "sk.c": "comet", "sk.m": "meteor", "sk.n": "nebula", "sk.b": "bit", "sk.e": "eclipse",
      "sks.s": "sparks", "sks.c": "comets", "sks.m": "meteors", "sks.n": "nebulae", "sks.b": "bits", "sks.e": "eclipses",
      "tm.first": "Aim: first", "tm.strong": "Aim: strongest", "tm.close": "Aim: closest",
      "act.up": "Upgrade", "act.sell": "Sell", "act.aim": "Aim", "act.locked": "Garden {n}",
      "act.lv": "{t} · level {l}", "act.max": "Top level",
      "act.left": "Turn ◀", "act.right": "Turn ▶", "act.free": "free", "act.back": "back {n}",
      "act.turnL": "Turn the {ring} back a step ([)", "act.turnR": "Turn the {ring} on a step (])",
      "ring.0": "outer ring", "ring.1": "middle ring", "ring.2": "inner ring",
      "slot.free": "A free bed on the {ring}: plant here.",
      "slot.gap": "The gap in the {ring}: the sparks slip through here.",
      "slot.stone": "An old stone on the {ring}: nothing grows here.",
      "slot.plant": "<strong>{t}</strong> · level {l} · {fx}",
      "slot.sell": "Sell for {n}",
      "turn.free": "{n} free steps left on this ring before the wave.",
      "turn.one": "1 free step left on this ring before the wave.",
      "turn.none": "No free steps left on this ring: a step costs {c}.",
      "turn.out": "The rings turn only when no spark is in the garden.",
      "why.coins": "Not enough coins", "why.locked": "{t} opens in garden {n}",
      "why.gap": "The gap must stay open: nothing grows here.", "why.stone": "Nothing grows on an old stone.",
      "ctx.next": "Next:", "ctx.done": "All waves are out. Clear the garden!", "ctx.from": "from gate {n}",
      "ctx.pick": "Tap a bed on a ring to plant or to turn that ring. The dotted line is the way the next sparks will take.",
      "map.o1": "The Quiet orbit",
      "map.intro": "Every night falling sparks spiral in from the rim towards the moonflower. Turn the rings so they walk the long way round past your plants. Clear a garden to open the next one.",
      "map.diff": "Difficulty", "map.lock": "Clear the garden before it to open", "map.waves": "{n} waves",
      "map.plants": "Plants: {list}", "map.cont": "Continue: {r}, wave {n}",
      "map.gates": "{n} gates",
      "map.replace": "A night is still under way in {r}. Start {s} instead? The night under way is given up.",
      "map.resetAsk": "Reset the stars and records on every device? The night in progress ends too.",
      "gd.g1": "Seedling ring", "gd.g2": "Dew terrace", "gd.g3": "Stone circle", "gd.g4": "Night bloom",
      "end.won": "The moonflower is safe", "end.lost": "The sparks reached the moonflower",
      "end.hearts": "Hearts left", "end.faded": "Sparks gone out", "end.waves": "Waves",
      "end.wonNote": "Three stars with nine tenths of the hearts left.",
      "end.lostNote": "Try again from the start of the wave you lost, with the garden you had then.",
      "end.unlock": "{t} is now ready to plant.",
      "tour.title": "How to play",
      "tour.1": "Sparks come in at a gate on the rim and walk clockwise round the lanes between the rings until they find a ring's gap, then go in to the next lane, and at last to the moonflower. Each one that reaches it costs a heart (an eclipse three).",
      "tour.2": "Tap a bed on a ring, then plant in the bar below. Tap a plant to upgrade it, set its aim or sell it. Tap the chosen bed again to let go.",
      "tour.3": "The twist: turn the rings with Turn ◀ and Turn ▶. A gap just behind where the sparks come in makes them walk almost all the way round, but your plants turn with their ring. The dotted line shows the way at once.",
      "tour.4": "Rings turn only while no spark is in the garden. Before the first wave each ring has two free steps, after every wave one; more steps cost 5 coins each, and turning back gives a step back.",
      "tour.5": "A wave starts only when you press Next wave; pause at any time and plant while paused. Anything planted since the last wave started sells back in full.",
      "toast.save": "Not saved: the browser's storage is full",
      "toast.reset": "Progress reset", "toast.early": "+{n} for calling the wave early",
      "live.wave": "Wave {n} of {m}: {w}.", "live.clear": "Wave {n} cleared, +{c} coins.", "live.heart": "A spark reached the moonflower. {h} hearts left.",
      "live.sel": "{ring}, slot {j}. {s}", "live.turn": "The {ring} turned. The way is now {n} long.",
      "live.status": "{h} hearts, {c} coins, wave {n} of {m}.",
      "map.o2": "The far orbit", "map.gaps": "two gaps", "map.auto": "a ring turns by itself",
      "map.endless": "Endless: as many waves as you can hold", "map.best": "Endless: best wave {n}",
      "map.contEn": "Continue: {r}, Endless, wave {n}",
      "gd.g5": "Two passages", "gd.g6": "Drifting ring", "gd.g7": "Old wall", "gd.g8": "Full eclipse",
      "st.waveEn": "Wave {n}, Endless", "en.name": "Endless",
      "end.endless": "The night ended at wave {n}", "end.cleared": "Waves cleared", "end.best": "Best in Endless",
      "end.endlessNote": "Endless never ends: every round of ten waves brings more and stronger sparks.",
      "btn.endless": "Endless again",
      "live.auto": "The {ring} turned one step by itself.", "live.waveEn": "Wave {n}: {w}.",
      "live.statusEn": "{h} hearts, {c} coins, wave {n}.",
      "ctx.auto": "After each wave the {ring} turns one step by itself."
    },
    el: {
      "app.name": "Κήπος σε τροχιά",
      "btn.map": "Κήποι (L)", "btn.help": "Πώς παίζεται (?)",
      "btn.sfxOn": "Ήχος ανοιχτός (M)", "btn.sfxOff": "Ήχος κλειστός (M)",
      "btn.pause": "Παύση (Space)", "btn.play": "Συνέχεια (Space)", "btn.speed": "Ταχύτητα {n}x (F)",
      "btn.next": "Επόμενο κύμα", "btn.nextEarly": "Κύμα τώρα (+{n})", "btn.nextKey": "Κάλεσε το επόμενο κύμα (N)",
      "btn.first": "Πρώτο κύμα", "btn.lastOut": "Βγήκε το τελευταίο κύμα", "btn.ok": "Ωραία", "btn.cancel": "Άκυρο",
      "btn.again": "Ξανά από το κύμα {n}", "btn.restart": "Ξανά όλη η νύχτα", "btn.nextGd": "Επόμενος κήπος",
      "btn.toMap": "Κήποι",
      "btn.reset": "Μηδενισμός προόδου", "btn.resetYes": "Μηδενισμός",
      "view.label": "Ο κήπος: τρία πέτρινα δαχτυλίδια με θέσεις για φυτά, ένα άνοιγμα σε κάθε δαχτυλίδι, οι πύλες στην άκρη και το φεγγαρολούλουδο στη μέση. Με τα βελάκια μετακινείς τον δείκτη: αριστερά και δεξιά πάνω στο δαχτυλίδι, πάνω και κάτω από δαχτυλίδι σε δαχτυλίδι.",
      "st.hearts": "Καρδιές", "st.coins": "Νομίσματα", "st.wave": "Κύμα {n} από {m}", "st.waveShort": "{n}/{m}",
      "diff.m": "Ήπιο", "diff.n": "Κανονικό", "diff.h": "Δύσκολο",
      "pl.thorn": "Αγκαθιά", "pl.dew": "Ποτιστήρι δροσιάς", "pl.sun": "Ηλίανθος", "pl.vine": "Παγιδόκλημα",
      "pl.thorn.a": "Βάτος", "pl.thorn.b": "Αγριοτριανταφυλλιά", "pl.dew.a": "Ομίχλη", "pl.dew.b": "Παγωμένη δροσιά",
      "pl.sun.a": "Μεγάλο κεφάλι", "pl.sun.b": "Μεσημεριανή λάμψη", "pl.vine.a": "Μακριά έλικα", "pl.vine.b": "Δίδυμο κλήμα",
      "fx.thorn": "Ρίχνει αγκάθια σε μία σπίθα κάθε φορά.",
      "fx.dew": "Κάθε δύο δευτερόλεπτα ένας ψεκασμός που επιβραδύνει κάθε σπίθα κοντά του.",
      "fx.sun": "Ένας ζεστός παλμός που πληγώνει κάθε σπίθα κοντά του και σπάει το κέλυφος των μετεωριτών.",
      "fx.vine": "Πού και πού κρατά μια σπίθα ακίνητη για λίγο.",
      "fx.thorn.a": "Μακριά βολή και βαριά αγκάθια, λίγο πιο αργά.", "fx.thorn.b": "Ρίχνει δύο φορές πιο γρήγορα.",
      "fx.dew.a": "Ψεκάζει πιο πλατιά και επιβραδύνει περισσότερο.", "fx.dew.b": "Ο ψεκασμός και πληγώνει.",
      "fx.sun.a": "Πολύ πιο πλατύς παλμός.", "fx.sun.b": "Πολύ πιο δυνατός παλμός.",
      "fx.vine.a": "Φτάνει πιο μακριά και κρατά περισσότερο.", "fx.vine.b": "Κρατά δύο σπίθες μαζί.",
      "sk.s": "σπίθα", "sk.c": "κομήτης", "sk.m": "μετεωρίτης", "sk.n": "νεφέλωμα", "sk.b": "σπιθίτσα", "sk.e": "έκλειψη",
      "sks.s": "σπίθες", "sks.c": "κομήτες", "sks.m": "μετεωρίτες", "sks.n": "νεφελώματα", "sks.b": "σπιθίτσες", "sks.e": "εκλείψεις",
      "tm.first": "Στόχος: η πρώτη", "tm.strong": "Στόχος: η πιο δυνατή", "tm.close": "Στόχος: η πιο κοντινή",
      "act.up": "Αναβάθμιση", "act.sell": "Πούλα", "act.aim": "Στόχος", "act.locked": "Κήπος {n}",
      "act.lv": "{t} · επίπεδο {l}", "act.max": "Τελευταίο επίπεδο",
      "act.left": "Γύρνα ◀", "act.right": "Γύρνα ▶", "act.free": "δωρεάν", "act.back": "πίσω {n}",
      "act.turnL": "Γύρνα το {ring} ένα βήμα πίσω ([)", "act.turnR": "Γύρνα το {ring} ένα βήμα μπροστά (])",
      "ring.0": "εξωτερικό δαχτυλίδι", "ring.1": "μεσαίο δαχτυλίδι", "ring.2": "εσωτερικό δαχτυλίδι",
      "slot.free": "Ελεύθερη θέση στο {ring}: φύτεψε εδώ.",
      "slot.gap": "Το άνοιγμα στο {ring}: από εδώ περνούν οι σπίθες.",
      "slot.stone": "Μια παλιά πέτρα στο {ring}: εδώ δεν φυτρώνει τίποτα.",
      "slot.plant": "<strong>{t}</strong> · επίπεδο {l} · {fx}",
      "slot.sell": "Πούλα για {n}",
      "turn.free": "Μένουν {n} δωρεάν βήματα σε αυτό το δαχτυλίδι πριν από το κύμα.",
      "turn.one": "Μένει 1 δωρεάν βήμα σε αυτό το δαχτυλίδι πριν από το κύμα.",
      "turn.none": "Δεν μένουν δωρεάν βήματα σε αυτό το δαχτυλίδι: κάθε βήμα κοστίζει {c}.",
      "turn.out": "Τα δαχτυλίδια γυρίζουν μόνο όταν δεν υπάρχει σπίθα στον κήπο.",
      "why.coins": "Δεν φτάνουν τα νομίσματα", "why.locked": "{t}: ανοίγει στον κήπο {n}",
      "why.gap": "Το άνοιγμα πρέπει να μείνει ανοιχτό: εδώ δεν φυτρώνει τίποτα.", "why.stone": "Σε παλιά πέτρα δεν φυτρώνει τίποτα.",
      "ctx.next": "Έρχονται:", "ctx.done": "Βγήκαν όλα τα κύματα. Καθάρισε τον κήπο!", "ctx.from": "από την πύλη {n}",
      "ctx.pick": "Πάτα μια θέση σε ένα δαχτυλίδι για να φυτέψεις ή να γυρίσεις το δαχτυλίδι. Η διακεκομμένη γραμμή δείχνει από πού θα περάσουν οι επόμενες σπίθες.",
      "map.o1": "Η ήσυχη τροχιά",
      "map.intro": "Κάθε νύχτα σπίθες που πέφτουν γυρίζουν σπειροειδώς από την άκρη προς το φεγγαρολούλουδο. Γύρνα τα δαχτυλίδια ώστε να κάνουν τον μακρύ δρόμο μπροστά από τα φυτά σου. Πέρασε έναν κήπο για να ανοίξει ο επόμενος.",
      "map.diff": "Δυσκολία", "map.lock": "Πέρασε πρώτα τον προηγούμενο κήπο", "map.waves": "{n} κύματα",
      "map.plants": "Φυτά: {list}", "map.cont": "Συνέχεια: {r}, κύμα {n}",
      "map.gates": "{n} πύλες",
      "map.replace": "Μια νύχτα είναι ακόμα σε εξέλιξη στον κήπο «{r}». Να ξεκινήσει ο «{s}»; Η νύχτα σε εξέλιξη χάνεται.",
      "map.resetAsk": "Να μηδενιστούν τα αστέρια και το αρχείο σε όλες τις συσκευές; Τελειώνει και η νύχτα που παίζεται.",
      "gd.g1": "Το δαχτυλίδι με τα σπορόφυτα", "gd.g2": "Η ταράτσα της δροσιάς", "gd.g3": "Ο πέτρινος κύκλος", "gd.g4": "Το νυχτολούλουδο",
      "end.won": "Το φεγγαρολούλουδο σώθηκε", "end.lost": "Οι σπίθες έφτασαν στο φεγγαρολούλουδο",
      "end.hearts": "Καρδιές που έμειναν", "end.faded": "Σπίθες που έσβησαν", "end.waves": "Κύματα",
      "end.wonNote": "Τρία αστέρια με τα εννιά δέκατα των καρδιών.",
      "end.lostNote": "Ξαναπροσπάθησε από την αρχή του κύματος που έχασες, με τον κήπο που είχες τότε.",
      "end.unlock": "Τώρα μπορείς να φυτέψεις: {t}.",
      "tour.title": "Πώς παίζεται",
      "tour.1": "Οι σπίθες μπαίνουν από μια πύλη στην άκρη και γυρίζουν δεξιόστροφα στους διαδρόμους ανάμεσα στα δαχτυλίδια, ώσπου να βρουν το άνοιγμα ενός δαχτυλιδιού· τότε περνούν στον επόμενο διάδρομο και στο τέλος στο φεγγαρολούλουδο. Κάθε σπίθα που φτάνει εκεί κοστίζει μία καρδιά (η έκλειψη τρεις).",
      "tour.2": "Πάτα μια θέση σε ένα δαχτυλίδι και φύτεψε από τη μπάρα από κάτω. Πάτα ένα φυτό για να το αναβαθμίσεις, να διαλέξεις τον στόχο του ή να το πουλήσεις. Πάτα ξανά τη θέση που διάλεξες για να την αφήσεις.",
      "tour.3": "Το κόλπο: γύρνα τα δαχτυλίδια με το «Γύρνα ◀» και το «Γύρνα ▶». Ένα άνοιγμα λίγο πίσω από εκεί που μπαίνουν οι σπίθες τις βάζει να κάνουν σχεδόν όλο τον γύρο, αλλά τα φυτά σου γυρίζουν μαζί με το δαχτυλίδι τους. Η διακεκομμένη γραμμή δείχνει αμέσως τον νέο δρόμο.",
      "tour.4": "Τα δαχτυλίδια γυρίζουν μόνο όταν δεν υπάρχει σπίθα στον κήπο. Πριν από το πρώτο κύμα κάθε δαχτυλίδι έχει δύο δωρεάν βήματα, μετά από κάθε κύμα ένα· κάθε επιπλέον βήμα κοστίζει 5 νομίσματα, και αν γυρίσεις πίσω το βήμα σού επιστρέφεται.",
      "tour.5": "Ένα κύμα ξεκινά μόνο όταν πατήσεις «Επόμενο κύμα»· κάνε παύση όποτε θέλεις και φύτευε στην παύση. Ό,τι φύτεψες από την αρχή του τελευταίου κύματος σού επιστρέφει όλα τα νομίσματα αν το πουλήσεις.",
      "toast.save": "Δεν αποθηκεύτηκε: ο χώρος του προγράμματος περιήγησης γέμισε",
      "toast.reset": "Η πρόοδος μηδενίστηκε", "toast.early": "+{n} επειδή κάλεσες νωρίς το κύμα",
      "live.wave": "Κύμα {n} από {m}: {w}.", "live.clear": "Το κύμα {n} καθάρισε, +{c} νομίσματα.", "live.heart": "Μια σπίθα έφτασε στο φεγγαρολούλουδο. Έμειναν {h} καρδιές.",
      "live.sel": "{ring}, θέση {j}. {s}", "live.turn": "Το {ring} γύρισε. Ο δρόμος είναι τώρα {n}.",
      "live.status": "{h} καρδιές, {c} νομίσματα, κύμα {n} από {m}.",
      "map.o2": "Η μακρινή τροχιά", "map.gaps": "δύο ανοίγματα", "map.auto": "ένα δαχτυλίδι γυρίζει μόνο του",
      "map.endless": "Ατελείωτο: όσα κύματα αντέξεις", "map.best": "Ατελείωτο: καλύτερο κύμα {n}",
      "map.contEn": "Συνέχεια: {r}, Ατελείωτο, κύμα {n}",
      "gd.g5": "Τα δύο περάσματα", "gd.g6": "Το δαχτυλίδι που γλιστρά", "gd.g7": "Ο παλιός τοίχος", "gd.g8": "Η ολική έκλειψη",
      "st.waveEn": "Κύμα {n}, Ατελείωτο", "en.name": "Ατελείωτο",
      "end.endless": "Η νύχτα τελείωσε στο κύμα {n}", "end.cleared": "Κύματα που καθάρισαν", "end.best": "Καλύτερο στο Ατελείωτο",
      "end.endlessNote": "Το Ατελείωτο δεν τελειώνει: κάθε γύρος δέκα κυμάτων φέρνει περισσότερες και πιο δυνατές σπίθες.",
      "btn.endless": "Ξανά Ατελείωτο",
      "live.auto": "Το {ring} γύρισε μόνο του ένα βήμα.", "live.waveEn": "Κύμα {n}: {w}.",
      "live.statusEn": "{h} καρδιές, {c} νομίσματα, κύμα {n}.",
      "ctx.auto": "Μετά από κάθε κύμα το {ring} γυρίζει μόνο του ένα βήμα."
    }
  };
  if (window.orosI18n) window.orosI18n.table(STRINGS, "orbit", LANG);

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
  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  }
  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function plName(p) { return t("pl." + p.k + (p.l === 3 ? "." + p.b : "")); }
  function plFx(p) { return t("fx." + p.k + (p.l === 3 ? "." + p.b : "")); }
  function gdName(id) { return t("gd." + id); }
  function ringName(k) { return t("ring." + k); }
  function sparkList(list) {
    return list.map(function (x) { return x.n + " " + t((x.n === 1 ? "sk." : "sks.") + x.k); }).join(", ");
  }

  // BOOT MARKER
  var SCRIPT_V = "";
  (function () {
    var m = ((document.currentScript && document.currentScript.src) || "")
      .match(/[?&]v=([^&#]+)/);
    SCRIPT_V = m ? m[1] : "";
    document.documentElement.lang = LANG;
    console.log("orbit.js v" + (SCRIPT_V || "?") + " boot");
  })();

  // ---------- 2. Saves ----------
  var data = null, deviceId = null;
  var prefs = { diff: "n", tour: 0, last: "g1" };
  var sess = null;                     // { g, ck, counted }
  var game = null;                     // sess.g, the night on screen
  var saveFailShown = false;

  function loadData() {
    var raw = null;
    try { raw = localStorage.getItem(STORAGE_KEY); } catch (e) {}
    if (raw) {
      try {
        var parsed = JSON.parse(raw);
        if (parsed && typeof parsed === "object" && parsed.maps && typeof parsed.maps === "object") {
          data = E.merge(parsed, parsed);
          return;
        }
      } catch (e) {}
      try { localStorage.setItem(STORAGE_KEY + "-broken", raw); } catch (e) {}
      try { console.warn("[orOS] orbit: unreadable data copied to " + STORAGE_KEY + "-broken"); } catch (e) {}
    }
    data = E.defaultData();
  }
  function saveData() {
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
  function loadPrefs() {
    try {
      var p = JSON.parse(localStorage.getItem(PREFS_KEY) || "null");
      if (p && typeof p === "object") {
        if (E.DIFF[p.diff]) prefs.diff = p.diff;
        if (p.tour === 1) prefs.tour = 1;
        if (E.GARDEN[p.last]) prefs.last = p.last;
      }
    } catch (e) {}
  }
  function savePrefs() {
    try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch (e) {}
  }
  function loadSession() {
    var x = null;
    try { x = JSON.parse(localStorage.getItem(SESSION_KEY) || "null"); } catch (e) {}
    if (!x || typeof x !== "object") return null;
    var g = E.normalizeRun(x.g);
    if (!g) return null;
    var ck = x.ck ? E.normalizeRun(x.ck) : null;
    return { g: g, ck: ck, counted: x.counted === true };
  }
  var saveTimer = null;
  function saveSession() {
    if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
    if (!sess) return;
    try {
      localStorage.setItem(SESSION_KEY, JSON.stringify({
        g: E.saveable(sess.g), ck: sess.ck ? E.saveable(sess.ck) : null, counted: !!sess.counted }));
      saveFailShown = false;
    } catch (e) {
      if (!saveFailShown) { saveFailShown = true; showToast(t("toast.save")); }
    }
  }
  function saveSoon() {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(saveSession, SAVE_MS);
  }
  function underWay() { return !!(sess && !sess.counted && game.over < 0); }

  // ---------- 3. The night ----------
  var sel = "";                        // the chosen slot ("<ring>:<slot>"), "" none
  var paused = true, speed = 1;
  var view = "map";                    // "map" | "play"

  function startNight(gdId, diff, en) {
    var g = E.newRun(gdId, diff, !!en);
    if (!g) return;
    sess = { g: g, ck: null, counted: false };
    game = g;
    prefs.last = gdId; prefs.diff = diff;
    savePrefs();
    sel = ""; paused = true;
    fx = []; disp = g.rot.slice();
    saveSession();
    showPlay();
    announce(g.en ? t("live.statusEn", { h: g.hearts, c: g.coins, n: g.wave }) : t("live.status", { h: g.hearts, c: g.coins, n: g.wave, m: g.nw }));
  }
  function retryWave() {
    if (!sess || !sess.ck) return;
    sess.g = E.clone(sess.ck); sess.g.ev = [];
    sess.counted = false;
    game = sess.g;
    sel = ""; paused = true; fx = []; disp = game.rot.slice();
    saveSession();
    closeDialog();
    showPlay();
  }
  function done(ok, kind) {
    if (!ok) { sfx("no"); return false; }
    sfx(kind || "plant");
    saveSoon();
    barKey = "";
    renderBar(); renderStatus(); draw();
    return true;
  }
  // Plant on the chosen slot; a refusal always says why (R28).
  function plantSel(k) {
    if (!sel || !game) return;
    var why = E.whyNot(game, sel, k);
    if (why) {
      if (why === "locked") showToast(t("why.locked", { t: t("pl." + k), n: E.PLANTS[k].u }));
      else if (why === "coins") showToast(t("why.coins"));
      else if (why === "gap" || why === "stone") { showToast(t("why." + why)); announce(t("why." + why)); refused = { at: sel, life: 600 }; }
      done(false);
      return;
    }
    done(E.plant(game, sel, k));
  }
  function upgrade(branch) {
    if (!sel || !game || !game.pl[sel]) return;
    var p = game.pl[sel];
    if (p.l >= 3) return;
    if (game.coins < E.upCost(p)) { showToast(t("why.coins")); done(false); return; }
    done(E.upgrade(game, sel, branch));
  }
  function sellSel() {
    if (!sel || !game || !game.pl[sel]) return;
    done(E.sell(game, sel));
  }
  function aimSel() {
    if (!sel || !game || !game.pl[sel] || !E.PLANTS[game.pl[sel].k].tm) return;
    done(E.target(game, sel), "toggle");
  }
  function selRing() { var p = sel ? E.parseKey(sel) : null; return p ? p.k : 0; }
  function turnRing(k, dir) {
    if (!game) return;
    var why = E.whyNoTurn(game, k, dir);
    if (why) {
      if (why === "out") showToast(t("turn.out"));
      else if (why === "coins") showToast(t("why.coins"));
      done(false);
      return;
    }
    if (!done(E.turn(game, k, dir), "turn")) return;
    var w = E.ways(game), gs = E.nextGates(game);
    var len = Math.round(Math.min.apply(null, gs.map(function (gi) { return w[gi].len; })) * 10) / 10;
    announce(t("live.turn", { ring: ringName(k), n: len }));
  }
  function nextWave() {
    if (!game || game.over >= 0 || game.wave >= game.nw) return;
    var list = E.preview(game);
    sess.ck = E.saveable(game);
    sess.ck.ev = [];
    E.callWave(game);
    paused = false;
    sfx("wave");
    announce(game.en ? t("live.waveEn", { n: game.wave, w: sparkList(list) }) : t("live.wave", { n: game.wave, m: game.nw, w: sparkList(list) }));
    handleEvents();
    saveSession();
    renderAll();
  }
  // The night is over: count it once, then the end card.
  function endNight() {
    if (!sess || sess.counted) return;
    var nx = game.en ? null : nextGdId(game.gd);
    var before = nx ? E.isOpen(data, nx) : true;
    data = E.record(data, deviceId, game, Date.now());
    sess.counted = true;
    saveData();
    saveSession();
    paused = true;
    var opened = nx && !before && E.isOpen(data, nx) ? nx : null;
    sfx(game.over === 1 ? "won" : "lost");
    endDialog(opened);
  }
  function nextGdId(id) {
    var gd = E.GARDEN[id];
    return gd && E.GARDENS[gd.idx + 1] ? E.GARDENS[gd.idx + 1].id : null;
  }

  // ---------- 4. Loop ----------
  var raf = 0, lastT = 0, acc = 0, sinceSave = 0;
  var FRAME = 1000 / E.TPS;
  var disp = [0, 0, 0];                // the rings as drawn (steps), easing to game.rot
  function frame(now) {
    raf = 0;
    var dt = lastT ? Math.min(250, now - lastT) : 0;
    lastT = now;
    clock += dt;
    if (view === "play" && game && !paused && game.over < 0 && !dlgOpen()) {
      advance(dt * speed);
      sinceSave += dt;
      if (sinceSave >= RUN_SAVE_MS) { sinceSave = 0; saveSession(); }
    }
    ageFx(dt);
    easeRings(dt);
    draw();
    if (!document.hidden) raf = requestAnimationFrame(frame);
  }
  function easeRings(dt) {
    if (!game) return;
    for (var k = 0; k < 3; k++) {
      var n = E.RINGS[k].n, d = game.rot[k] - disp[k];
      d = ((d % n) + n * 1.5) % n - n / 2;    // the short way round
      if (reduced || Math.abs(d) < 0.01) disp[k] = game.rot[k];
      else disp[k] += d * Math.min(1, dt / 90);
    }
  }
  function advance(ms) {
    acc += ms;
    var n = 0;
    while (acc >= FRAME && game.over < 0 && n < 600) { E.step(game); acc -= FRAME; n++; }
    if (n) handleEvents();
  }
  function startLoop() { if (!raf && !document.hidden) { lastT = 0; raf = requestAnimationFrame(frame); } }

  // What the engine reported: sounds, effects, the live region.
  var fx = [], refused = null, lastSnd = {};
  function soundOnce(kind, ms) {
    var now = Date.now();
    if (lastSnd[kind] && now - lastSnd[kind] < ms) return;
    lastSnd[kind] = now;
    sfx(kind);
  }
  function sparkById(id) {
    for (var i = 0; i < game.sk.length; i++) if (game.sk[i].id === id) return game.sk[i];
    return null;
  }
  function handleEvents() {
    if (!game || !game.ev.length) return;
    var ev = game.ev; game.ev = [];
    var hurt = false, out = 0;
    ev.forEach(function (x) {
      if (x.e === "thorn" || x.e === "vine") {
        var from = E.slotPos(game, x.p);
        (Array.isArray(x.f) ? x.f : [x.f]).forEach(function (id) {
          var s = sparkById(id);
          if (s) fx.push({ k: x.e, at: from, to: E.sparkPos(game, s), life: x.e === "vine" ? 400 : 160 });
        });
        soundOnce(x.e, 90);
      } else if (x.e === "dew" || x.e === "sun") {
        var p = game.pl[x.p];
        fx.push({ k: x.e, at: E.slotPos(game, x.p), r: p ? E.stats(p).r : 2, life: x.e === "sun" ? 380 : 500 });
        soundOnce(x.e, 150);
      } else if (x.e === "out") { out++; fx.push({ k: "out", at: { x: x.x, y: x.y }, life: 450 }); }
      else if (x.e === "leak") hurt = true;
      else if (x.e === "clear") { announce(t("live.clear", { n: x.w + 1, c: x.n })); sfx("clear"); }
      else if (x.e === "early") showToast(t("toast.early", { n: x.n }));
      else if (x.e === "auto") { announce(t("live.auto", { ring: ringName(x.k) })); showToast(t("live.auto", { ring: ringName(x.k) })); sfx("auto"); }
    });
    if (out) soundOnce("out", 80);
    if (hurt) {
      sfx("heart");
      announce(t("live.heart", { h: game.hearts }));
      if (window.orosHaptics) window.orosHaptics.cue("bad");
    }
    renderStatus();
    renderBar();
    if (game.over >= 0) endNight();
  }
  function ageFx(dt) {
    fx = fx.filter(function (f) { f.life -= dt; return f.life > 0; });
    if (refused) { refused.life -= dt; if (refused.life <= 0) refused = null; }
  }

  // ---------- 5. Scene ----------
  var canvas, ctx, dpr = 1, W = 0, H = 0, S = 30, CX = 0, CY = 0;
  var reduced = false;
  var C = {};
  function readColors() {
    var cs = getComputedStyle(document.documentElement);
    ["--bg", "--text", "--text-dim", "--accent", "--border", "--danger", "--panel-bg",
     "--og-ground", "--og-soil", "--og-lane", "--og-stone", "--og-gap", "--og-bed", "--og-plant",
     "--og-leaf", "--og-dew", "--og-sun", "--og-spark", "--og-rim", "--og-shell", "--og-flower",
     "--og-way", "--og-ghost", "--og-star"].forEach(function (v) {
      C[v.slice(2)] = cs.getPropertyValue(v).trim() || "#888";
    });
  }
  function resize() {
    if (!canvas) return;
    var box = $("scene").getBoundingClientRect();
    dpr = window.devicePixelRatio || 1;
    W = Math.max(1, Math.floor(box.width)); H = Math.max(1, Math.floor(box.height));
    canvas.width = Math.floor(W * dpr); canvas.height = Math.floor(H * dpr);
    canvas.style.width = W + "px"; canvas.style.height = H + "px";
    S = Math.max(6, Math.min(W, H) / VIEW_UNITS);
    CX = W / 2; CY = H / 2;
    draw();
  }
  function px(p) { return { x: CX + p.x * S, y: CY + p.y * S }; }
  // A slot as drawn (with the ring's turn easing in).
  function slotAt(k, j) {
    var n = E.RINGS[k].n, a = (j + disp[k]) * E.TAU / n;
    return E.point(E.RINGS[k].r, a);
  }
  function slotAtKey(s) { var p = E.parseKey(s); return slotAt(p.k, p.j); }

  // A few fixed stars round the garden (always the same ones).
  var STARS = (function () {
    var r = E.mulberry32(E.hash("orbit-stars")), out = [];
    for (var i = 0; i < 70; i++) out.push({ x: r() * 2 - 1, y: r() * 2 - 1, s: 0.4 + r() * 1.1, ph: r() * 6.3 });
    return out;
  })();
  // Old craters on the little moon (garden units), always the same ones.
  var CRATERS = (function () {
    var r = E.mulberry32(E.hash("orbit-craters")), out = [];
    for (var i = 0; i < 14; i++) {
      var a = r() * E.TAU, d = 1.2 + r() * 4.4;
      out.push({ x: Math.sin(a) * d, y: -Math.cos(a) * d, r: 0.12 + r() * 0.3 });
    }
    return out;
  })();
  var clock = 0;                       // ms, for the twinkle and the moonflower's glow

  function draw() {
    if (!ctx || view !== "play" || !game) return;
    var gd = E.GARDEN[game.gd];
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = C["og-ground"]; ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = C["og-star"];
    STARS.forEach(function (s) {
      var x = CX + s.x * W / 2, y = CY + s.y * H / 2;
      if ((x - CX) * (x - CX) + (y - CY) * (y - CY) < (E.RIM + 0.2) * S * (E.RIM + 0.2) * S) return;
      ctx.globalAlpha = reduced ? 0.8 : 0.55 + 0.45 * Math.sin(clock / 900 + s.ph);
      ctx.fillRect(x, y, s.s, s.s);
    });
    ctx.globalAlpha = 1;
    // the soil disc with its rim and old craters, and the three lanes
    circle(0, 0, E.RIM + 0.12, C["og-stone"]);
    circle(0, 0, E.RIM, C["og-soil"]);
    ctx.save();
    ctx.globalAlpha = 0.35;
    CRATERS.forEach(function (c) {
      var q = px(c);
      ctx.beginPath(); ctx.arc(q.x, q.y, c.r * S, 0, Math.PI * 2);
      ctx.fillStyle = C["og-ground"]; ctx.fill();
      ctx.beginPath(); ctx.arc(q.x + c.r * S * 0.18, q.y + c.r * S * 0.18, c.r * S * 0.8, 0, Math.PI * 2);
      ctx.fillStyle = C["og-soil"]; ctx.fill();
    });
    ctx.restore();
    E.LANES.forEach(function (r, i) {
      ctx.beginPath(); ctx.arc(CX, CY, r * S, 0, Math.PI * 2);
      ctx.strokeStyle = C["og-lane"]; ctx.lineWidth = (i ? 1.0 : 1.05) * S; ctx.stroke();
    });
    drawWays();
    for (var k = 0; k < 3; k++) drawRing(gd, k);
    drawGates(gd);
    drawFlower();
    Object.keys(game.pl).forEach(function (s) { drawPlant(game.pl[s], s); });
    drawCursor();
    game.sk.forEach(drawSpark);
    drawFx();
  }
  function circle(x, y, r, fill) {
    var q = px({ x: x, y: y });
    ctx.beginPath(); ctx.arc(q.x, q.y, r * S, 0, Math.PI * 2);
    ctx.fillStyle = fill; ctx.fill();
  }
  // A stone band with its gaps cut out; beds and old stones on it; a
  // ring that turns by itself has small arrows along it.
  function drawRing(gd, k) {
    var R = E.RINGS[k], step = E.TAU / R.n, half = step / 2 * 0.62;
    var gaps = gd.gaps[k].map(function (j) { return (j + disp[k]) * step; }).sort(function (a, b) { return a - b; });
    ctx.strokeStyle = C["og-stone"]; ctx.lineWidth = 0.5 * S; ctx.lineCap = "butt";
    // canvas angles start at 3 o'clock; ours at 12
    gaps.forEach(function (ga, i) {
      var to = i + 1 < gaps.length ? gaps[i + 1] : gaps[0] + E.TAU;
      ctx.beginPath();
      ctx.arc(CX, CY, R.r * S, ga + half - Math.PI / 2, to - half - Math.PI / 2);
      ctx.stroke();
    });
    // the stone's grain: a fine line along the band
    ctx.save();
    ctx.globalAlpha = 0.25; ctx.strokeStyle = C["og-ground"]; ctx.lineWidth = Math.max(1, 0.04 * S);
    gaps.forEach(function (ga, i) {
      var to = i + 1 < gaps.length ? gaps[i + 1] : gaps[0] + E.TAU;
      ctx.beginPath();
      ctx.arc(CX, CY, (R.r + 0.12) * S, ga + half - Math.PI / 2, to - half - Math.PI / 2);
      ctx.stroke();
    });
    ctx.restore();
    var auto = gd.auto[k];
    if (auto) {
      // chevrons between the beds, pointing the way the ring turns
      ctx.save();
      ctx.strokeStyle = C["og-rim"]; ctx.lineWidth = Math.max(1.5, 0.06 * S); ctx.lineCap = "round"; ctx.lineJoin = "round";
      ctx.globalAlpha = 0.85;
      for (var c = 0; c < R.n; c += 2) {
        var am = (c + 0.5 + disp[k]) * step, m = px(E.point(R.r, am));
        var tx = Math.cos(am) * auto, ty = Math.sin(am) * auto;   // the clockwise tangent, times the direction
        var nx = Math.sin(am), ny = -Math.cos(am), h = 0.11 * S;
        ctx.beginPath();
        ctx.moveTo(m.x - tx * h + nx * h, m.y - ty * h + ny * h);
        ctx.lineTo(m.x + tx * h * 0.6, m.y + ty * h * 0.6);
        ctx.lineTo(m.x - tx * h - nx * h, m.y - ty * h - ny * h);
        ctx.stroke();
      }
      ctx.restore();
    }
    for (var j = 0; j < R.n; j++) {
      if (E.isGap(gd, k, j)) continue;
      var q = px(slotAt(k, j));
      if (E.isStone(gd, k, j)) {
        ctx.beginPath();
        for (var i = 0; i < 6; i++) {
          var a = i * Math.PI / 3 + j, rr = 0.26 * S * (i % 2 ? 0.8 : 1);
          if (i) ctx.lineTo(q.x + Math.cos(a) * rr, q.y + Math.sin(a) * rr); else ctx.moveTo(q.x + Math.cos(a) * rr, q.y + Math.sin(a) * rr);
        }
        ctx.closePath(); ctx.fillStyle = C["og-shell"]; ctx.fill();
        ctx.strokeStyle = C["og-ground"]; ctx.lineWidth = 1; ctx.stroke();
      } else if (!game.pl[E.key(k, j)]) {
        ctx.beginPath(); ctx.arc(q.x, q.y, 0.22 * S, 0, Math.PI * 2);
        ctx.fillStyle = C["og-bed"]; ctx.fill();
      }
    }
    // two small posts mark each gap
    gaps.forEach(function (ga) {
      [ga + half, ga - half].forEach(function (a) {
        var p = px(E.point(R.r, a));
        ctx.beginPath(); ctx.arc(p.x, p.y, 0.12 * S, 0, Math.PI * 2);
        ctx.fillStyle = C["og-rim"]; ctx.fill();
      });
    });
  }
  function drawGates(gd) {
    var next = E.nextGates(game);
    gd.gates.forEach(function (x, i) {
      var a = E.gateAngle(gd, i), on = next.indexOf(i) >= 0 && game.wave < game.nw;
      var p = px(E.point(E.RIM + 0.05, a)), q = px(E.point(E.RIM - 0.55, a));
      ctx.strokeStyle = on ? C.accent : C["og-stone"];
      ctx.lineWidth = Math.max(2, 0.14 * S); ctx.lineCap = "round";
      ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(q.x, q.y); ctx.stroke();
      // the arch: a short arc across the way in
      ctx.beginPath(); ctx.arc(CX, CY, (E.RIM + 0.05) * S, a - 0.12 - Math.PI / 2, a + 0.12 - Math.PI / 2);
      ctx.lineWidth = Math.max(3, 0.22 * S); ctx.stroke();
      if (gd.gates.length > 1) {
        var lp = px(E.point(E.RIM + 0.35, a));
        if (lp.y > 8 && lp.y < H - 8 && lp.x > 8 && lp.x < W - 8) {
          ctx.fillStyle = on ? C.accent : C["text-dim"];
          ctx.font = "800 " + Math.max(10, Math.round(0.32 * S)) + "px Nunito, system-ui, sans-serif";
          ctx.textAlign = "center"; ctx.textBaseline = "middle";
          ctx.fillText(String(i + 1), lp.x, lp.y);
        }
      }
    });
  }
  function drawFlower() {
    var c = px({ x: 0, y: 0 }), r = E.HEART * S;
    // a soft glow round the moonflower, breathing slowly
    var gl = reduced ? 1 : 1 + 0.08 * Math.sin(clock / 700);
    var grad = ctx.createRadialGradient(c.x, c.y, r * 0.2, c.x, c.y, r * 1.6 * gl);
    grad.addColorStop(0, C["og-flower"]); grad.addColorStop(1, "rgba(0,0,0,0)");
    ctx.save(); ctx.globalAlpha = 0.35; ctx.fillStyle = grad;
    ctx.beginPath(); ctx.arc(c.x, c.y, r * 1.6 * gl, 0, Math.PI * 2); ctx.fill(); ctx.restore();
    ctx.fillStyle = C["og-flower"];
    for (var i = 0; i < 6; i++) {
      var a = i * Math.PI / 3;
      ctx.beginPath(); ctx.ellipse(c.x + Math.cos(a) * r * 0.45, c.y + Math.sin(a) * r * 0.45, r * 0.42, r * 0.22, a, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.beginPath(); ctx.arc(c.x, c.y, r * 0.26, 0, Math.PI * 2);
    ctx.fillStyle = C["og-sun"]; ctx.fill();
  }
  // The way of the next wave (dots) from each of its gates.
  function drawWays() {
    var dot = Math.max(2, S * 0.1);
    E.nextGates(game).forEach(function (gi) {
      var pts = E.wayPoints(game, gi);
      ctx.save();
      ctx.setLineDash([dot, dot * 2.2]);
      ctx.strokeStyle = C["og-way"]; ctx.lineWidth = dot; ctx.lineCap = "round"; ctx.lineJoin = "round";
      ctx.globalAlpha = game.sk.length ? 0.45 : 0.85;
      ctx.beginPath();
      pts.forEach(function (p, i) { var q = px(p); if (i) ctx.lineTo(q.x, q.y); else ctx.moveTo(q.x, q.y); });
      ctx.stroke();
      ctx.restore();
    });
  }
  // Each plant has its own outline (never only a colour).
  function drawPlant(p, s) {
    var q = px(slotAtKey(s)), r = 0.34 * S;
    ctx.lineWidth = Math.max(1.5, r * 0.16); ctx.lineCap = "round"; ctx.lineJoin = "round";
    ctx.beginPath(); ctx.arc(q.x, q.y, r * 0.95, 0, Math.PI * 2);
    ctx.fillStyle = C["og-bed"]; ctx.fill();
    if (p.k === "thorn") {
      // a round bush with spikes
      ctx.beginPath();
      for (var i = 0; i < 12; i++) {
        var a = i * Math.PI / 6, rr = i % 2 ? r * 0.45 : r * 0.85;
        if (i) ctx.lineTo(q.x + Math.cos(a) * rr, q.y + Math.sin(a) * rr); else ctx.moveTo(q.x + rr, q.y);
      }
      ctx.closePath(); ctx.fillStyle = C["og-plant"]; ctx.fill();
      ctx.strokeStyle = C["og-leaf"]; ctx.stroke();
    } else if (p.k === "dew") {
      // a drop
      ctx.beginPath(); ctx.moveTo(q.x, q.y - r * 0.8);
      ctx.quadraticCurveTo(q.x + r * 0.7, q.y, q.x, q.y + r * 0.7);
      ctx.quadraticCurveTo(q.x - r * 0.7, q.y, q.x, q.y - r * 0.8);
      ctx.fillStyle = C["og-dew"]; ctx.fill();
      ctx.strokeStyle = C["og-leaf"]; ctx.stroke();
    } else if (p.k === "sun") {
      // a flower head with rays
      ctx.strokeStyle = C["og-sun"];
      ctx.beginPath();
      for (var k = 0; k < 8; k++) {
        var b = k * Math.PI / 4;
        ctx.moveTo(q.x + Math.cos(b) * r * 0.45, q.y + Math.sin(b) * r * 0.45);
        ctx.lineTo(q.x + Math.cos(b) * r * 0.85, q.y + Math.sin(b) * r * 0.85);
      }
      ctx.stroke();
      ctx.beginPath(); ctx.arc(q.x, q.y, r * 0.38, 0, Math.PI * 2);
      ctx.fillStyle = C["og-shell"]; ctx.fill();
    } else {
      // a curl
      ctx.strokeStyle = C["og-plant"];
      ctx.beginPath();
      for (var s2 = 0; s2 <= 24; s2++) {
        var a2 = s2 * 0.42, rr2 = r * 0.08 + r * 0.03 * s2;
        var x = q.x + Math.cos(a2) * rr2, y = q.y + Math.sin(a2) * rr2;
        if (s2) ctx.lineTo(x, y); else ctx.moveTo(x, y);
      }
      ctx.stroke();
    }
    // level: one, two or three dots under the plant
    ctx.fillStyle = C.accent;
    for (var j = 0; j < p.l; j++) {
      ctx.beginPath(); ctx.arc(q.x + (j - (p.l - 1) / 2) * r * 0.5, q.y + r * 1.05, Math.max(1.3, r * 0.11), 0, Math.PI * 2); ctx.fill();
    }
  }
  function drawCursor() {
    if (refused) {
      var rq = px(slotAtKey(refused.at));
      ctx.globalAlpha = Math.min(1, refused.life / 300) * 0.7;
      ctx.beginPath(); ctx.arc(rq.x, rq.y, 0.42 * S, 0, Math.PI * 2);
      ctx.fillStyle = C.danger; ctx.fill();
      ctx.globalAlpha = 1;
    }
    if (!sel) return;
    var p = E.parseKey(sel), q = px(slotAtKey(sel));
    // the whole ring, lightly: it is what the turn buttons turn
    ctx.beginPath(); ctx.arc(CX, CY, E.RINGS[p.k].r * S, 0, Math.PI * 2);
    ctx.globalAlpha = 0.35; ctx.strokeStyle = C.accent; ctx.lineWidth = Math.max(2, 0.08 * S); ctx.stroke();
    ctx.globalAlpha = 1;
    var pl = game.pl[sel];
    if (pl) {
      var st = E.stats(pl);
      ctx.beginPath(); ctx.arc(q.x, q.y, st.r * S, 0, Math.PI * 2);
      ctx.globalAlpha = 0.12; ctx.fillStyle = C.accent; ctx.fill();
      ctx.globalAlpha = 1; ctx.strokeStyle = C.accent; ctx.lineWidth = 1.5; ctx.stroke();
    }
    ctx.beginPath(); ctx.arc(q.x, q.y, 0.45 * S, 0, Math.PI * 2);
    ctx.strokeStyle = C.accent; ctx.lineWidth = Math.max(2, 0.09 * S); ctx.stroke();
  }
  // Each kind has its own outline; a health bar; rings for slowed and held.
  function drawSpark(s) {
    var q = px(E.sparkPos(game, s));
    var r = S * (s.k === "e" ? 0.4 : s.k === "b" ? 0.14 : s.k === "c" ? 0.17 : 0.22);
    if (s.k !== "e") {
      // a faint halo, so a spark reads as light
      ctx.save(); ctx.globalAlpha = 0.22; ctx.fillStyle = C["og-spark"];
      ctx.beginPath(); ctx.arc(q.x, q.y, r * 1.9, 0, Math.PI * 2); ctx.fill(); ctx.restore();
    }
    ctx.fillStyle = C["og-spark"];
    ctx.strokeStyle = C["og-rim"];
    ctx.lineWidth = Math.max(1, S * 0.04);
    ctx.beginPath();
    if (s.k === "c") {
      ctx.moveTo(q.x, q.y - r * 1.5); ctx.quadraticCurveTo(q.x + r * 1.1, q.y, q.x, q.y + r);
      ctx.quadraticCurveTo(q.x - r * 1.1, q.y, q.x, q.y - r * 1.5);
    } else if (s.k === "m") {
      ctx.rect(q.x - r, q.y - r, r * 2, r * 2);
    } else if (s.k === "n") {
      ctx.arc(q.x - r * 0.55, q.y + r * 0.1, r * 0.65, 0, Math.PI * 2);
      ctx.moveTo(q.x + r * 1.2, q.y + r * 0.1);
      ctx.arc(q.x + r * 0.55, q.y + r * 0.1, r * 0.65, 0, Math.PI * 2);
      ctx.moveTo(q.x + r * 0.7, q.y - r * 0.4);
      ctx.arc(q.x, q.y - r * 0.4, r * 0.7, 0, Math.PI * 2);
    } else if (s.k === "e") {
      ctx.ellipse(q.x, q.y, r * 1.35, r * 0.85, 0, 0, Math.PI * 2);
    } else ctx.arc(q.x, q.y, r, 0, Math.PI * 2);
    ctx.fill(); ctx.stroke();
    if (s.k === "e") { ctx.beginPath(); ctx.arc(q.x + r * 0.35, q.y, r * 0.6, 0, Math.PI * 2); ctx.fillStyle = C["og-ground"]; ctx.fill(); }
    if (s.ar) { ctx.lineWidth = Math.max(1.5, r * 0.35); ctx.strokeStyle = C["og-shell"]; ctx.strokeRect(q.x - r, q.y - r, r * 2, r * 2); }
    if (s.hp < s.mx) {
      var bw = Math.max(S * 0.5, r * 2), fr = Math.max(0, s.hp / s.mx);
      ctx.fillStyle = C.border; ctx.fillRect(q.x - bw / 2, q.y - r - 6, bw, 3);
      ctx.fillStyle = C.accent; ctx.fillRect(q.x - bw / 2, q.y - r - 6, bw * fr, 3);
    }
    if (s.st > 0 && s.sl > 0) {
      ctx.strokeStyle = C["og-dew"]; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(q.x, q.y, r + 3, 0, Math.PI * 2); ctx.stroke();
    }
    if (s.hd > 0) {
      ctx.strokeStyle = C["og-plant"]; ctx.lineWidth = 1.5;
      ctx.setLineDash([2, 2]);
      ctx.beginPath(); ctx.arc(q.x, q.y, r + 5, 0, Math.PI * 2); ctx.stroke();
      ctx.setLineDash([]);
    }
  }
  function drawFx() {
    fx.forEach(function (f) {
      var c = px(f.at);
      if (f.k === "thorn" || f.k === "vine") {
        var d = px(f.to);
        ctx.globalAlpha = 0.8 * f.life / (f.k === "vine" ? 400 : 160);
        ctx.strokeStyle = f.k === "vine" ? C["og-plant"] : C["og-rim"];
        ctx.lineWidth = f.k === "vine" ? 2 : 1.5;
        ctx.beginPath(); ctx.moveTo(c.x, c.y); ctx.lineTo(d.x, d.y); ctx.stroke();
      } else if (f.k === "dew") {
        var k = reduced ? 1 : 1 - f.life / 500;
        ctx.globalAlpha = (reduced ? 0.3 : 0.5) * f.life / 500;
        ctx.strokeStyle = C["og-dew"]; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(c.x, c.y, Math.max(2, f.r * S * k), 0, Math.PI * 2); ctx.stroke();
      } else if (f.k === "sun") {
        ctx.globalAlpha = (reduced ? 0.2 : 0.4) * f.life / 380;
        ctx.fillStyle = C["og-sun"];
        ctx.beginPath(); ctx.arc(c.x, c.y, f.r * S, 0, Math.PI * 2); ctx.fill();
      } else if (f.k === "out") {
        ctx.globalAlpha = 0.6 * f.life / 450;
        ctx.fillStyle = C["og-rim"];
        var up = reduced ? 0 : (1 - f.life / 450) * S * 0.4;
        ctx.beginPath(); ctx.arc(c.x, c.y - up, S * 0.18, 0, Math.PI * 2); ctx.fill();
      }
      ctx.globalAlpha = 1;
    });
  }

  // ---------- 6. Input ----------
  // The slot under a point of the canvas ("" none).
  function slotAtPoint(clientX, clientY) {
    var r = canvas.getBoundingClientRect();
    var x = (clientX - r.left - CX) / S, y = (clientY - r.top - CY) / S;
    var d = Math.sqrt(x * x + y * y), best = "", bd = 0.75;
    for (var k = 0; k < 3; k++) {
      if (Math.abs(d - E.RINGS[k].r) > 0.7) continue;
      for (var j = 0; j < E.RINGS[k].n; j++) {
        var q = E.slotPos(game, E.key(k, j)), dd = Math.sqrt((q.x - x) * (q.x - x) + (q.y - y) * (q.y - y));
        if (dd < bd) { bd = dd; best = E.key(k, j); }
      }
    }
    return best;
  }
  function slotText(s) {
    var p = E.parseKey(s), gd = E.GARDEN[game.gd], pl = game.pl[s];
    if (pl) return t("act.lv", { t: plName(pl), l: pl.l });
    if (E.isGap(gd, p.k, p.j)) return t("slot.gap", { ring: ringName(p.k) });
    if (E.isStone(gd, p.k, p.j)) return t("slot.stone", { ring: ringName(p.k) });
    return t("slot.free", { ring: ringName(p.k) });
  }
  function slotNo(s) {
    // slots counted clockwise from the top of the screen, 1 first
    var p = E.parseKey(s), n = E.RINGS[p.k].n;
    return ((p.j + game.rot[p.k]) % n) + 1;
  }
  function select(s, quiet) {
    sel = s;
    barKey = "";
    renderBar(); draw();
    if (s && !quiet) announce(t("live.sel", { ring: ringName(E.parseKey(s).k), j: slotNo(s), s: slotText(s) }));
  }
  function wireInput() {
    canvas.addEventListener("pointerdown", function (e) {
      if (view !== "play" || !game) return;
      e.preventDefault();
      canvas.focus({ preventScroll: true });
      var s = slotAtPoint(e.clientX, e.clientY);
      if (!s || s === sel) { select(""); return; }   // tap the chosen slot again, or empty ground: let go
      select(s);
    });
  }
  // Arrow keys: left/right along the ring (by screen angle), up/down
  // to the ring outside or inside (the slot nearest in angle).
  function moveCursor(dRing, dSlot) {
    if (!sel) {
      // the slot of the outer ring at the top of the screen (beside it when that is the gap)
      var n0 = E.RINGS[0].n, top = (n0 - game.rot[0]) % n0;
      select(E.key(0, E.isGap(E.GARDEN[game.gd], 0, top) ? (top + 1) % n0 : top));
      return;
    }
    var p = E.parseKey(sel);
    if (dSlot) { select(E.key(p.k, (p.j + dSlot + E.RINGS[p.k].n) % E.RINGS[p.k].n)); return; }
    var k = Math.max(0, Math.min(2, p.k + dRing));
    if (k === p.k) return;
    var a = E.slotAngle(game.rot, p.k, p.j), n = E.RINGS[k].n;
    var j = (((Math.round(a / (E.TAU / n)) - game.rot[k]) % n) + n) % n;
    select(E.key(k, j));
  }
  function wireKeyboard() {
    document.addEventListener("keydown", function (e) {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (dlgOpen()) return;
      var k = e.key;
      if (k === "m" || k === "M") { toggleSfx(); e.preventDefault(); return; }
      if (k === "?") { tourDialog(); e.preventDefault(); return; }
      if (k === "l" || k === "L") { showMap(); e.preventDefault(); return; }
      if (view !== "play" || !game) return;
      var tag = (e.target && e.target.tagName) || "";
      if (k === " " && tag === "BUTTON") return;
      var pl = sel ? game.pl[sel] : null;
      var handled = true;
      if (k === "ArrowLeft") moveCursor(0, -1);
      else if (k === "ArrowRight") moveCursor(0, 1);
      else if (k === "ArrowUp") moveCursor(-1, 0);
      else if (k === "ArrowDown") moveCursor(1, 0);
      else if (k === " ") togglePause();
      else if (k === "f" || k === "F") cycleSpeed();
      else if (k === "n" || k === "N") nextWave();
      else if (k === "Escape") select("");
      else if (k === "[") turnRing(selRing(), -1);
      else if (k === "]") turnRing(selRing(), 1);
      else if (/^[1-4]$/.test(k) && sel && !pl) plantSel(E.KINDS[+k - 1]);
      else if ((k === "u" || k === "U") && pl && pl.l === 1) upgrade("");
      else if ((k === "a" || k === "A" || k === "b" || k === "B") && pl && pl.l === 2) upgrade(k.toLowerCase());
      else if ((k === "t" || k === "T") && pl) aimSel();
      else if ((k === "s" || k === "S") && pl) sellSel();
      else handled = false;
      if (handled) e.preventDefault();
    });
  }

  // ---------- 7. Toolbar + bottom bar ----------
  function setStat(id, icon, v, label) {
    var n = $(id);
    n.querySelector(".ic").innerHTML = icon;
    n.querySelector(".v").textContent = v;
    n.title = label;
    n.setAttribute("aria-label", label);
  }
  function renderStatus() {
    if (!game) return;
    setStat("s-hearts", ICONS.heart, game.hearts, t("st.hearts") + ": " + game.hearts);
    $("s-hearts").classList.toggle("low", game.hearts <= Math.ceil(game.hmax / 4));
    setStat("s-coins", ICONS.coin, Math.floor(game.coins), t("st.coins") + ": " + Math.floor(game.coins));
    if (game.en) setStat("s-wave", ICONS.wave, String(game.wave), t("st.waveEn", { n: game.wave }));
    else setStat("s-wave", ICONS.wave, t("st.waveShort", { n: game.wave, m: game.nw }), t("st.wave", { n: game.wave, m: game.nw }));
  }
  function plantBtn(k) {
    var b = el("button", "act");
    b.type = "button";
    var on = E.unlocked(game, k), c = E.plantCost(k);
    if (!on) b.classList.add("locked");
    b.innerHTML = ICONS[k];
    b.appendChild(el("span", "nm", t("pl." + k)));
    b.appendChild(el("span", "cost", on ? String(c) : t("act.locked", { n: E.PLANTS[k].u })));
    var key = String(E.KINDS.indexOf(k) + 1);
    b.disabled = on && game.coins < c;
    b.title = t("pl." + k) + ": " + t("fx." + k) + " (" + key + ")";
    b.setAttribute("aria-label", b.title + (on ? ", " + c : ""));
    b.addEventListener("click", function () { plantSel(k); });
    return b;
  }
  function actBtn(icon, name, cost, title, fn, disabled) {
    var b = el("button", "act");
    b.type = "button";
    b.innerHTML = icon;
    b.appendChild(el("span", "nm", name));
    if (cost !== "") b.appendChild(el("span", "cost", cost));
    b.title = title; b.setAttribute("aria-label", title);
    b.disabled = !!disabled;
    b.addEventListener("click", fn);
    return b;
  }
  function turnLabel(k, dir) {
    var c = E.turnCost(game, k, dir);
    return c > 0 ? String(c) : c < 0 ? t("act.back", { n: -c }) : t("act.free");
  }
  function turnBtns(row, k) {
    var can = E.canTurn(game);
    [-1, 1].forEach(function (dir) {
      var why = E.whyNoTurn(game, k, dir);
      var title = t(dir < 0 ? "act.turnL" : "act.turnR", { ring: ringName(k) });
      row.appendChild(actBtn(dir < 0 ? ICONS.turnL : ICONS.turnR, t(dir < 0 ? "act.left" : "act.right"),
        can ? turnLabel(k, dir) : "", title + (why === "out" ? ". " + t("turn.out") : ""),
        function () { turnRing(k, dir); }, !!why));
    });
  }
  function turnNote(k) {
    if (!E.canTurn(game)) return t("turn.out");
    var left = E.free(game) - Math.abs(game.tn[k]);
    if (left > 1) return t("turn.free", { n: left });
    if (left === 1) return t("turn.one");
    return t("turn.none", { c: E.STEP_COST });
  }
  var barKey = "";
  function renderBar() {
    if (!game) return;
    var pb = $("pause-btn");
    pb.innerHTML = paused ? ICONS.play : ICONS.pause;
    pb.title = t(paused ? "btn.play" : "btn.pause");
    pb.setAttribute("aria-label", pb.title);
    pb.setAttribute("aria-pressed", paused ? "true" : "false");
    pb.disabled = game.over >= 0;
    var sb = $("speed-btn");
    sb.textContent = speed + "x";
    sb.title = t("btn.speed", { n: speed }); sb.setAttribute("aria-label", sb.title);
    var nb = $("next-btn"), left = E.sparksLeft(game);
    nb.querySelector(".ic").innerHTML = ICONS.wave;
    nb.querySelector(".lb").textContent = game.wave >= game.nw ? t("btn.lastOut") : game.wave === 0 ? t("btn.first") :
      left ? t("btn.nextEarly", { n: left }) : t("btn.next");
    nb.disabled = game.over >= 0 || game.wave >= game.nw;
    nb.title = t("btn.nextKey");
    // the context row: the chosen slot, or what comes next
    var pl = sel ? game.pl[sel] : null;
    var key = [sel, pl ? JSON.stringify(pl) : "", Math.floor(game.coins), game.wave, game.over, E.canTurn(game),
               game.tn.join(","), game.rot.join(","), LANG].join("|");
    if (key === barKey) return;
    barKey = key;
    var row = $("bar-ctx"), tip = $("tip");
    row.textContent = "";
    if (!sel) {
      tip.hidden = true;
      var tx2 = el("div", "ctx-text");
      if (game.wave >= game.nw) tx2.appendChild(el("span", "", t("ctx.done")));
      else {
        var s1 = el("span", "");
        s1.appendChild(el("strong", "", t("ctx.next")));
        tx2.appendChild(s1);
        var gates = E.GARDEN[game.gd].gates.length;
        E.preview(game).forEach(function (x) {
          var g = el("span", "fg");
          g.innerHTML = ICONS["sk_" + x.k] || "";
          g.appendChild(document.createTextNode(x.n + " " + t((x.n === 1 ? "sk." : "sks.") + x.k) +
            (gates > 1 ? " " + t("ctx.from", { n: x.gt + 1 }) : "")));
          tx2.appendChild(g);
        });
        var gda = E.GARDEN[game.gd];
        gda.auto.forEach(function (d, k) { if (d) tx2.appendChild(el("span", "", t("ctx.auto", { ring: ringName(k) }))); });
        if (game.wave === 0 && !Object.keys(game.pl).length) tx2.appendChild(el("span", "", t("ctx.pick")));
      }
      row.appendChild(tx2);
      return;
    }
    tip.hidden = false;
    // the tip covers the half of the garden the chosen slot is not in
    tip.classList.toggle("low", E.slotPos(game, sel).y < 0);
    tip.classList.remove("warn");
    var p = E.parseKey(sel), gd = E.GARDEN[game.gd];
    if (!pl) {
      var bed = E.isBed(gd, p.k, p.j);
      tip.textContent = slotText(sel) + " " + turnNote(p.k);
      if (bed) E.KINDS.forEach(function (k) { row.appendChild(plantBtn(k)); });
      else row.appendChild(el("div", "ctx-text", slotText(sel)));
      turnBtns(row, p.k);
      return;
    }
    tip.innerHTML = t("slot.plant", { t: esc(plName(pl)), l: pl.l, fx: esc(plFx(pl)) }) +
      (E.PLANTS[pl.k].tm ? " · " + esc(t("tm." + E.TARGETS[pl.tm])) : "");
    var uc = E.upCost(pl);
    if (pl.l === 1) {
      row.appendChild(actBtn(ICONS.up, t("act.up"), String(uc), t("act.up") + " (U): " + t("pl." + pl.k) + " 2, " + uc, function () { upgrade(""); }, game.coins < uc));
    } else if (pl.l === 2) {
      ["a", "b"].forEach(function (br) {
        var nm = t("pl." + pl.k + "." + br);
        row.appendChild(actBtn(ICONS.up, nm, String(uc), nm + " (" + br.toUpperCase() + "): " + t("fx." + pl.k + "." + br) + " " + uc, function () { upgrade(br); }, game.coins < uc));
      });
    } else {
      row.appendChild(actBtn(ICONS.star, t("act.max"), "", t("act.max"), function () {}, true));
    }
    if (E.PLANTS[pl.k].tm) row.appendChild(actBtn(ICONS.aim, t("act.aim"), "", t("tm." + E.TARGETS[pl.tm]) + " (T)", aimSel));
    var sv = E.sellValue(pl);
    row.appendChild(actBtn(ICONS.sell, t("act.sell"), "+" + sv, t("slot.sell", { n: sv }) + " (S)", sellSel));
    turnBtns(row, p.k);
  }
  function togglePause() {
    if (!game || game.over >= 0) return;
    paused = !paused;
    if (paused) saveSession();
    renderBar();
  }
  function cycleSpeed() {
    speed = SPEEDS[(SPEEDS.indexOf(speed) + 1) % SPEEDS.length];
    renderBar();
  }
  function renderAll() { renderStatus(); barKey = ""; renderBar(); draw(); }

  function showPlay() {
    view = "play";
    document.body.classList.add("playing");
    $("map").hidden = true;
    disp = game.rot.slice();
    resize();
    renderAll();
    canvas.focus({ preventScroll: true });
  }

  // ---------- 8. Garden list ----------
  function showMap() {
    if (view === "play" && game && underWay()) { paused = true; saveSession(); }
    view = "map";
    sel = "";
    document.body.classList.remove("playing");
    $("tip").hidden = true;
    renderMap();
    $("map").hidden = false;
  }
  function starIcons(n) {
    var s = el("span", "st");
    for (var i = 0; i < 3; i++) {
      var x = el("span", i < n ? "" : "off");
      x.innerHTML = ICONS.star;
      s.appendChild(x);
    }
    return s;
  }
  function renderMap() {
    var box = $("map");
    box.textContent = "";
    var wrap = el("div", "mp-wrap");
    wrap.appendChild(el("p", "mp-intro", t("map.intro")));
    if (underWay()) {
      var cont = el("button", "mp-cont", t(game.en ? "map.contEn" : "map.cont", { r: gdName(game.gd), n: Math.max(1, game.wave) }));
      cont.type = "button";
      cont.addEventListener("click", showPlay);
      wrap.appendChild(cont);
    }
    wrap.appendChild(el("div", "mp-head", t("map.diff")));
    var seg = el("div", "seg");
    seg.setAttribute("role", "group");
    seg.setAttribute("aria-label", t("map.diff"));
    E.DIFFS.forEach(function (d) {
      var b = el("button", "", t("diff." + d));
      b.type = "button";
      b.setAttribute("aria-pressed", prefs.diff === d ? "true" : "false");
      b.addEventListener("click", function () { prefs.diff = d; savePrefs(); renderMap(); });
      seg.appendChild(b);
    });
    wrap.appendChild(seg);
    var orbit = 0;
    E.GARDENS.forEach(function (gd) {
      if (gd.o !== orbit) { orbit = gd.o; wrap.appendChild(el("div", "mp-head", t("map.o" + orbit))); }
      var open = E.isOpen(data, gd.id);
      var b = el("button", "sq-card" + (underWay() && game.gd === gd.id && !game.en ? " cur" : ""));
      b.type = "button";
      b.disabled = !open;
      b.appendChild(el("span", "no", String(gd.idx + 1)));
      var tx2 = el("span", "tx");
      tx2.appendChild(el("span", "nm", gdName(gd.id)));
      var kinds = E.KINDS.filter(function (k) { return E.PLANTS[k].u <= Math.min(4, gd.idx + 1); }).map(function (k) { return t("pl." + k); });
      var info = t("map.waves", { n: gd.waves.length }) + (gd.gates.length > 1 ? " · " + t("map.gates", { n: gd.gates.length }) : "") +
        (gd.gaps.some(function (x) { return x.length > 1; }) ? " · " + t("map.gaps") : "") +
        (gd.auto.some(function (x) { return x; }) ? " · " + t("map.auto") : "") +
        " · " + t("map.plants", { list: kinds.join(", ") });
      tx2.appendChild(el("span", "fx", open ? info : t("map.lock")));
      b.appendChild(tx2);
      b.appendChild(starIcons(E.starsOf(data, gd.id)));
      b.setAttribute("aria-label", gdName(gd.id) + ", " + E.starsOf(data, gd.id) + "/3");
      b.addEventListener("click", function () { pickGarden(gd.id, false); });
      wrap.appendChild(b);
      if (E.endlessOpen(data, gd.id)) {
        var best = E.endlessOf(data, gd.id);
        var en = el("button", "mp-endless" + (underWay() && game.gd === gd.id && game.en ? " cur" : ""));
        en.type = "button";
        en.innerHTML = ICONS.wave;
        en.appendChild(el("span", "", best ? t("map.best", { n: best }) : t("map.endless")));
        en.setAttribute("aria-label", gdName(gd.id) + ", " + (best ? t("map.best", { n: best }) : t("map.endless")));
        en.addEventListener("click", function () { pickGarden(gd.id, true); });
        wrap.appendChild(en);
      }
    });
    var rs = el("button", "dlg-btn danger mp-reset", t("btn.reset"));
    rs.type = "button";
    rs.addEventListener("click", function () {
      confirmDialog(t("map.resetAsk"), t("btn.resetYes"), resetProgress);
    });
    wrap.appendChild(rs);
    box.appendChild(wrap);
  }
  function nightName(id, en) { return gdName(id) + (en ? " · " + t("en.name") : ""); }
  function pickGarden(id, en) {
    var same = underWay() && game.gd === id && game.diff === prefs.diff && !!game.en === !!en;
    if (underWay() && game.acts > 0 && !same) {
      confirmDialog(t("map.replace", { r: nightName(game.gd, game.en), s: nightName(id, en) }), t("btn.ok"), function () { startNight(id, prefs.diff, en); });
      return;
    }
    if (same) { showPlay(); return; }
    startNight(id, prefs.diff, en);
  }
  // Reset progress: a new reset stamp, so older rows drop on every device.
  // The night in progress ends too (not counted): a reset that left it on
  // screen, with Continue, read as "nothing was reset".
  function resetProgress() {
    data = E.merge({ ver: 1, br: Math.max(Date.now(), data.br + 1), maps: {}, rows: {} }, data);
    saveData();
    if (sess && !sess.counted) { sess.counted = true; paused = true; saveSession(); }
    showToast(t("toast.reset"));
    renderMap();
  }

  // ---------- 9. Dialogs ----------
  var dlgKind = "";
  function dlgOpen() { return $("dlg").open; }
  function openDialog(kind, fill) {
    var d = $("dlg");
    if (d.open) d.close();
    d.textContent = "";
    dlgKind = kind;
    fill(d);
    try { d.showModal(); } catch (e) { d.setAttribute("open", ""); }
    var f = d.querySelector(".primary") || d.querySelector("button");
    if (f) f.focus();
  }
  function closeDialog() { var d = $("dlg"); if (d.open) d.close(); dlgKind = ""; }
  function dlgBtn(text, cls, fn) {
    var b = el("button", "dlg-btn" + (cls ? " " + cls : ""), text);
    b.type = "button";
    b.addEventListener("click", fn);
    return b;
  }
  function row(label, value) {
    var r = el("div", "dlg-row");
    r.appendChild(el("span", "", label));
    r.appendChild(el("strong", "", String(value)));
    return r;
  }
  function endDialog(opened) {
    var g = game, won = g.over === 1;
    if (g.en) { endlessDialog(); return; }
    openDialog("end", function (d) {
      d.appendChild(el("div", "dlg-title", gdName(g.gd) + " · " + t("diff." + g.diff)));
      d.appendChild(el("div", "dlg-hero", t(won ? "end.won" : "end.lost")));
      var st = el("div", "dlg-stars");
      for (var i = 0; i < 3; i++) { var s = el("span", i < E.stars(g) ? "" : "off"); s.innerHTML = ICONS.star; st.appendChild(s); }
      if (won) d.appendChild(st);
      d.appendChild(row(t("end.hearts"), g.hearts + " / " + g.hmax));
      d.appendChild(row(t("end.waves"), g.wave + " / " + g.nw));
      d.appendChild(row(t("end.faded"), g.faded));
      d.appendChild(el("p", "dlg-note", t(won ? "end.wonNote" : "end.lostNote")));
      if (opened) {
        var nk = E.KINDS.filter(function (k) { return E.PLANTS[k].u === E.GARDEN[opened].idx + 1; });
        if (nk.length) d.appendChild(el("p", "dlg-note", t("end.unlock", { t: t("pl." + nk[0]) })));
      }
      var a = el("div", "dlg-actions");
      if (!won && sess.ck) a.appendChild(dlgBtn(t("btn.again", { n: sess.ck.wave + 1 }), "primary", retryWave));
      var nx = nextGdId(g.gd);
      if (won && nx) a.appendChild(dlgBtn(t("btn.nextGd"), "primary", function () { closeDialog(); startNight(nx, g.diff); }));
      a.appendChild(dlgBtn(t("btn.restart"), "", function () { closeDialog(); startNight(g.gd, g.diff); }));
      a.appendChild(dlgBtn(t("btn.toMap"), "", function () { closeDialog(); showMap(); }));
      d.appendChild(a);
    });
  }
  function endlessDialog() {
    var g = game, n = E.cleared(g);
    openDialog("end", function (d) {
      d.appendChild(el("div", "dlg-title", nightName(g.gd, true) + " · " + t("diff." + g.diff)));
      d.appendChild(el("div", "dlg-hero", t("end.endless", { n: g.wave })));
      d.appendChild(row(t("end.cleared"), n));
      d.appendChild(row(t("end.best"), E.endlessOf(data, g.gd)));
      d.appendChild(row(t("end.faded"), g.faded));
      d.appendChild(el("p", "dlg-note", t("end.endlessNote")));
      var a = el("div", "dlg-actions");
      if (sess.ck) a.appendChild(dlgBtn(t("btn.again", { n: sess.ck.wave + 1 }), "primary", retryWave));
      a.appendChild(dlgBtn(t("btn.endless"), sess.ck ? "" : "primary", function () { closeDialog(); startNight(g.gd, g.diff, true); }));
      a.appendChild(dlgBtn(t("btn.toMap"), "", function () { closeDialog(); showMap(); }));
      d.appendChild(a);
    });
  }
  function tourDialog() {
    if (view === "play" && game && !paused) { paused = true; renderBar(); saveSession(); }
    openDialog("tour", function (d) {
      d.appendChild(el("div", "dlg-title", t("tour.title")));
      var ul = el("ul", "dlg-list");
      for (var i = 1; i <= 5; i++) ul.appendChild(el("li", "", t("tour." + i)));
      d.appendChild(ul);
      var a = el("div", "dlg-actions");
      a.appendChild(dlgBtn(t("btn.ok"), "primary", function () { prefs.tour = 1; savePrefs(); closeDialog(); }));
      d.appendChild(a);
    });
  }
  function confirmDialog(msg, yes, fn) {
    openDialog("confirm", function (d) {
      d.appendChild(el("p", "dlg-msg", msg));
      var a = el("div", "dlg-actions");
      a.appendChild(dlgBtn(t("btn.cancel"), "", closeDialog));
      a.appendChild(dlgBtn(yes, "primary danger", function () { closeDialog(); fn(); }));
      d.appendChild(a);
    });
  }

  // ---------- 10. Toasts + live region ----------
  var toastTimer = null;
  function showToast(msg) {
    var n = $("toast");
    n.textContent = msg;
    n.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { n.classList.remove("show"); }, 2600);
  }
  function announce(msg) { $("live").textContent = msg; }

  // ---------- 11. Sound ----------
  var audio = null;
  function sfxOn() {
    try { return localStorage.getItem(SFX_KEY) === "1"; } catch (e) { return false; }
  }
  function tone(freq, start, dur, type, vol, to) {
    var t0 = audio.currentTime + start;
    var o = audio.createOscillator(), g = audio.createGain();
    o.type = type || "sine";
    o.frequency.setValueAtTime(freq, t0);
    if (to) o.frequency.exponentialRampToValueAtTime(to, t0 + dur);
    g.gain.setValueAtTime(vol || 0.1, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g); g.connect(audio.destination);
    o.start(t0); o.stop(t0 + dur + 0.02);
  }
  // A short burst of filtered noise (the spray's hiss, the stone's grind).
  var noiseBuf = null;
  function noise(start, dur, freq, q, vol) {
    if (!noiseBuf) {
      noiseBuf = audio.createBuffer(1, Math.floor(audio.sampleRate * 0.5), audio.sampleRate);
      var d = noiseBuf.getChannelData(0), seed = 1;
      for (var i = 0; i < d.length; i++) { seed = (seed * 16807) % 2147483647; d[i] = seed / 1073741823.5 - 1; }
    }
    var t0 = audio.currentTime + start;
    var src = audio.createBufferSource(), f = audio.createBiquadFilter(), g = audio.createGain();
    src.buffer = noiseBuf;
    f.type = "bandpass"; f.frequency.setValueAtTime(freq, t0); f.Q.setValueAtTime(q, t0);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(vol, t0 + Math.min(0.03, dur / 3));
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(f); f.connect(g); g.connect(audio.destination);
    src.start(t0); src.stop(t0 + dur + 0.02);
  }
  var HAPTIC = { plant: "tick", turn: "tick", auto: "tick", no: "bad", won: "good", wave: "tick" };
  function sfx(kind) {
    if (window.orosHaptics && HAPTIC[kind]) window.orosHaptics.cue(HAPTIC[kind]);
    if (!sfxOn()) return;
    try {
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      if (!audio) audio = new AC();
      if (audio.state === "suspended") audio.resume();
      if (kind === "thorn") tone(1800, 0, 0.04, "square", 0.015, 1200);
      else if (kind === "vine") tone(240, 0, 0.18, "triangle", 0.04, 180);
      else if (kind === "dew") noise(0, 0.28, 5200, 0.9, 0.05);
      else if (kind === "sun") { tone(330, 0, 0.4, "sine", 0.04); tone(495, 0, 0.3, "sine", 0.02); }
      else if (kind === "out") tone(1200, 0, 0.12, "sine", 0.025, 1700);
      else if (kind === "heart") { tone(880, 0, 0.5, "sine", 0.04, 660); tone(1320, 0.05, 0.4, "sine", 0.02); }
      else if (kind === "plant") { tone(260, 0, 0.08, "triangle", 0.07, 180); tone(620, 0.04, 0.08, "sine", 0.05); }
      else if (kind === "turn") { noise(0, 0.22, 320, 2.5, 0.12); tone(90, 0, 0.18, "triangle", 0.03, 70); }
      else if (kind === "auto") { noise(0, 0.5, 260, 2, 0.1); tone(110, 0, 0.5, "triangle", 0.03, 82); tone(660, 0.25, 0.4, "sine", 0.025); }
      else if (kind === "wave") { tone(220, 0, 0.3, "triangle", 0.06); tone(330, 0.12, 0.3, "triangle", 0.05); }
      // the moonflower's chime: a soft bell (two partials) per note
      else if (kind === "clear") [784, 988, 1175].forEach(function (f, k) { tone(f, k * 0.11, 0.6, "sine", 0.04); tone(f * 2.76, k * 0.11, 0.25, "sine", 0.008); });
      else if (kind === "won") [523, 659, 784, 1047].forEach(function (f, k) { tone(f, k * 0.1, 0.22, "triangle", 0.07); });
      else if (kind === "lost") [392, 330, 262].forEach(function (f, k) { tone(f, k * 0.14, 0.3, "sine", 0.06); });
      else if (kind === "no") tone(170, 0, 0.14, "sawtooth", 0.04);
      else if (kind === "toggle") { tone(1047, 0, 0.05, "sine", 0.06); tone(1319, 0.04, 0.07, "sine", 0.05); }
    } catch (e) { /* no audio → silent */ }
  }
  function toggleSfx() {
    try { localStorage.setItem(SFX_KEY, sfxOn() ? "0" : "1"); } catch (e) {}
    paintSfxBtn();
    sfx("toggle");
  }

  // ---------- Icons (R9: icon buttons ship empty, filled here) ----------
  var SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">';
  var ICONS = {
    map:    SVG + '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.5"/></svg>',
    help:   SVG + '<circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 0 1 4.9.8c0 1.7-2.4 2.2-2.4 3.7"/><path d="M12 17h.01"/></svg>',
    sfxOn:  SVG + '<path d="M11 5 6 9H2v6h4l5 4z"/><path d="M15.5 8.5a5 5 0 0 1 0 7M19 5a10 10 0 0 1 0 14"/></svg>',
    sfxOff: SVG + '<path d="M11 5 6 9H2v6h4l5 4z"/><path d="M22 9l-6 6M16 9l6 6"/></svg>',
    heart:  SVG + '<path d="M12 20s-7-4.5-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.5-7 10-7 10z"/></svg>',
    coin:   SVG + '<circle cx="12" cy="12" r="8"/><path d="M12 8v8M9.5 10h5M9.5 14h5"/></svg>',
    wave:   SVG + '<path d="M12 12a3 3 0 1 1 3-3 6 6 0 1 1-6 6 9 9 0 1 1 9-9"/></svg>',
    play:   SVG + '<path d="M7 4l13 8-13 8z"/></svg>',
    pause:  SVG + '<path d="M8 4v16M16 4v16"/></svg>',
    up:     SVG + '<path d="M12 20V5M5 12l7-7 7 7"/></svg>',
    sell:   SVG + '<circle cx="12" cy="12" r="8"/><path d="M8 12h8"/></svg>',
    aim:    SVG + '<circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="2"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/></svg>',
    turnL:  SVG + '<path d="M4 12a8 8 0 1 0 2.3-5.6"/><path d="M4 4v5h5"/></svg>',
    turnR:  SVG + '<path d="M20 12a8 8 0 1 1-2.3-5.6"/><path d="M20 4v5h-5"/></svg>',
    star:   SVG + '<path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z" fill="currentColor"/></svg>',
    thorn:  SVG + '<path d="M12 3l2 5 5-2-2 5 5 2-5 2 2 5-5-2-2 5-2-5-5 2 2-5-5-2 5-2-2-5 5 2z"/></svg>',
    dew:    SVG + '<path d="M12 3c4 5 6 8 6 11a6 6 0 0 1-12 0c0-3 2-6 6-11z"/></svg>',
    sun:    SVG + '<circle cx="12" cy="12" r="4"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M19 5l-2 2M7 17l-2 2"/></svg>',
    vine:   SVG + '<path d="M12 21c0-6 0-9 3-11a3 3 0 1 0-3-3"/><path d="M12 15c-3 0-5-2-5-5"/></svg>',
    sk_s:   SVG + '<circle cx="12" cy="12" r="6"/></svg>',
    sk_c:   SVG + '<path d="M12 4c4 5 5 8 5 10a5 5 0 0 1-10 0c0-2 1-5 5-10z"/></svg>',
    sk_m:   SVG + '<rect x="6" y="6" width="12" height="12"/></svg>',
    sk_n:   SVG + '<path d="M7 17a4 4 0 0 1 0-8 5 5 0 0 1 10 0 4 4 0 0 1 0 8z"/></svg>',
    sk_b:   SVG + '<circle cx="12" cy="12" r="3"/></svg>',
    sk_e:   SVG + '<ellipse cx="12" cy="12" rx="9" ry="6"/><circle cx="14" cy="12" r="4"/></svg>'
  };
  function paintSfxBtn() {
    var b = $("sfx-btn"), on = sfxOn();
    b.innerHTML = on ? ICONS.sfxOn : ICONS.sfxOff;
    b.setAttribute("aria-pressed", on ? "true" : "false");
    b.setAttribute("aria-label", t(on ? "btn.sfxOn" : "btn.sfxOff"));
    b.title = t(on ? "btn.sfxOn" : "btn.sfxOff");
  }

  // ---------- 12. Sync slice + palette ----------
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
    // standalone (no shell): the page itself would be watched, and every
    // inheritPalette would trigger it again
    try { if (window.parent === window) return; } catch (e) { return; }
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
    // LOCAL FIRST: loadData() has already run (boot order).
    var api = syncApi();
    window.__orosSyncApi = {
      _suppress: false,
      dirty: function () {
        if (this._suppress) return;
        if (api && typeof api.markDirty === "function") api.markDirty();
      }
    };
    if (!api || typeof api.registerSlice !== "function") return;
    api.registerSlice("orbit", sliceGet, sliceSet, STORAGE_KEY, mergeOrbit);
  }
  function mergeOrbit(a, b) { return E.merge(a, b); }
  function sliceGet() { return data; }
  function sliceSet(incoming) {
    if (!incoming || typeof incoming !== "object" || !incoming.maps) return;
    window.__orosSyncApi._suppress = true;   // R6: a pull never marks dirty
    try {
      var m = E.merge(data, incoming);
      if (JSON.stringify(m) === JSON.stringify(data)) return;
      data = m;
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(data)); } catch (e) {}
      if (view === "map") renderMap();
    } finally {
      window.__orosSyncApi._suppress = false;
    }
  }

  // ---------- 13. Test hooks, wiring & boot ----------
  // render_game_to_text: the visible state as JSON. Coordinates are
  // garden units, the moonflower at (0, 0), x right, y down, the rim at
  // radius 6. A slot is [ring 0 outer .. 2 inner, slot in the ring's own
  // frame, 0 = the gap].
  window.render_game_to_text = function () {
    if (view !== "play" || !game) {
      return JSON.stringify({ mode: dlgKind || "map", diff: prefs.diff,
        gardens: E.GARDENS.map(function (gd) { return { id: gd.id, orbit: gd.o, open: E.isOpen(data, gd.id), stars: E.starsOf(data, gd.id), endless: E.endlessOpen(data, gd.id) ? E.endlessOf(data, gd.id) : null }; }) });
    }
    function r1(v) { return Math.round(v * 10) / 10; }
    var w = E.ways(game);
    return JSON.stringify({
      mode: dlgKind || (game.over === 1 ? "won" : game.over === 0 ? "lost" : paused ? "paused" : "running"),
      garden: game.gd, diff: game.diff, endless: !!game.en, speed: speed, hearts: game.hearts, coins: Math.floor(game.coins),
      wave: game.wave, waves: game.nw, next: E.preview(game), rot: game.rot, turned: game.tn,
      canTurn: E.canTurn(game), auto: E.GARDEN[game.gd].auto, sel: sel ? [E.parseKey(sel).k, E.parseKey(sel).j] : null,
      plants: Object.keys(game.pl).map(function (s) {
        var p = game.pl[s], k = E.parseKey(s), q = E.slotPos(game, s);
        return { ring: k.k, slot: k.j, k: p.k, l: p.l, b: p.b, aim: E.PLANTS[p.k].tm ? E.TARGETS[p.tm] : undefined, x: r1(q.x), y: r1(q.y) };
      }),
      way: w.map(function (x) { return r1(x.len); }),
      sparks: game.sk.map(function (s) {
        var q = E.sparkPos(game, s);
        return { k: s.k, x: r1(q.x), y: r1(q.y), hp: Math.ceil(s.hp) };
      }),
      note: "garden units, centre (0,0), rim radius 6; way = length per gate"
    });
  };
  // advanceTime(ms): steps the night deterministically at the current
  // speed, as if that much real time passed while playing.
  window.advanceTime = function (ms) {
    if (view !== "play" || !game || paused) { draw(); return; }
    advance(Math.max(0, +ms || 0) * speed);
    draw();
  };

  function applyI18n() {
    [].forEach.call(document.querySelectorAll("[data-i18n]"), function (n) {
      n.textContent = t(n.getAttribute("data-i18n"));
    });
    document.title = t("app.name") + " · orOS";
    canvas.setAttribute("aria-label", t("view.label"));
    [["map-btn", "map", "btn.map"], ["help-btn", "help", "btn.help"]].forEach(function (x) {
      var b = $(x[0]);
      b.innerHTML = ICONS[x[1]];
      b.title = t(x[2]); b.setAttribute("aria-label", t(x[2]));
    });
    paintSfxBtn();
  }
  function wire() {
    $("map-btn").addEventListener("click", function () { if (view === "map" && underWay()) showPlay(); else showMap(); });
    $("help-btn").addEventListener("click", tourDialog);
    $("sfx-btn").addEventListener("click", toggleSfx);
    $("pause-btn").addEventListener("click", togglePause);
    $("speed-btn").addEventListener("click", cycleSpeed);
    $("next-btn").addEventListener("click", nextWave);
    $("dlg").addEventListener("close", function () { dlgKind = ""; });
    $("dlg").addEventListener("cancel", function () {
      if (dlgKind === "tour") { prefs.tour = 1; savePrefs(); }
    });
    wireInput();
    wireKeyboard();
    window.addEventListener("resize", resize);
    if (window.ResizeObserver) new ResizeObserver(resize).observe($("scene"));
    document.addEventListener("visibilitychange", function () {
      if (document.hidden) { if (underWay()) paused = true; saveSession(); renderBar(); }
      else startLoop();
    });
    window.addEventListener("pagehide", saveSession);
    try {
      var mq = window.matchMedia("(prefers-reduced-motion: reduce)");
      reduced = mq.matches;
      var onMq = function () { reduced = mq.matches; };
      if (mq.addEventListener) mq.addEventListener("change", onMq); else if (mq.addListener) mq.addListener(onMq);
    } catch (e) {}
  }

  function boot() {
    canvas = $("view");
    ctx = canvas.getContext("2d");
    ensureDeviceId();
    loadData();
    loadPrefs();
    sess = loadSession();
    game = sess ? sess.g : null;
    if (game) disp = game.rot.slice();
    applyI18n();
    wire();
    registerSync();
    inheritPalette();
    watchPalette();
    // a night under way reopens paused; otherwise the garden list
    if (underWay()) showPlay(); else showMap();
    if (!prefs.tour) tourDialog();
    startLoop();
  }

  boot();
})();
