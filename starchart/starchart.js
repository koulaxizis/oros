// ============================================================
// orOS Star Chart — App logic (v1.0.0)
// An idle game: a small hilltop observatory. The telescopes gather
// starlight every minute, open or closed; the starlight buys
// telescopes and draws constellations: tap a star, then another, to
// join them. Each constellation gives a lasting bonus by the kinds of
// its stars and its shape, and lines never cross. The rules live in
// starchart/engine.js (StarChartEngine, tested headless); this file is
// the screen, the saves and the clock.
//   - the moon is the real moon; clouds are seeded per 3 hours
//   - away: full pace for 7 days, then half pace (never stops)
//   - a calm "While you were away" card, no notifications, no streaks
//   - Undo after every action, Start over with Undo
// Data:
//   - synced slice "starchart" (oros-starchart-data): the sky, as the
//     engine keeps it. Written only after a person's own action (a few
//     seconds later, so Undo stays local), or as a checkpoint when the
//     game opens after more than a day; idle minutes never write.
//     markDirty at most once every 5 minutes, and on the way out.
//     Merge: StarChartEngine.merge (the further-ahead sky wins).
//   - device-local (R10): oros-starchart-prefs (last seen, the tour),
//     oros-starchart-session (actions so far, for gamekit/resume.js),
//     oros-starchart-sfx (sound), oros-starchart-night (night sound).
//     The drawing not yet named stays in memory only.
// Names the person gives are shown only as text (textContent,
// canvas fillText), never as markup.
// Sections:
//   1. Constants, i18n, helpers
//   2. Saves: load / commit / checkpoint / dirty throttle
//   3. Clock + tick
//   4. Actions (buy, draw, name, erase, season, undo, start over)
//   5. Scene (the sky on one canvas)
//   6. Input (tap, keyboard)
//   7. Panels (status, sky strip, panel)
//   8. Dialogs (observatory, name, atlas, records, season, away, tour)
//   9. Toasts
//  10. Sound
//  11. Sync slice + palette
//  12. Test hooks, wiring & boot
// ============================================================
(function () {
  "use strict";

  var E = window.StarChartEngine;

  var STORAGE_KEY = "oros-starchart-data";
  var PREFS_KEY   = "oros-starchart-prefs";
  var SESSION_KEY = "oros-starchart-session";
  var SFX_KEY     = "oros-starchart-sfx";
  var NIGHT_KEY   = "oros-starchart-night";
  var UNDO_MS     = 6000;              // Undo stays on screen this long
  var COMMIT_MS   = 7000;              // an action is saved after this
  var DIRTY_GAP   = 5 * 60000;         // markDirty at most this often
  var CHECKPOINT  = 86400000;          // open after a day away: save once
  var AWAY_MS     = 2 * 3600000;       // the away card from 2 hours away

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
      "app.name": "Star Chart",
      "btn.obs": "Observatory", "btn.obsKey": "Observatory (T)", "btn.atlas": "Star atlas (A)",
      "btn.stats": "Records (S)", "btn.sfxOn": "Sound on (M)", "btn.sfxOff": "Sound off (M)",
      "btn.close": "Close", "btn.ok": "Good", "btn.undo": "Undo", "btn.cancel": "Cancel",
      "btn.start": "Start over", "btn.startYes": "Start over", "btn.season": "New season", "btn.seasonKey": "New season (E)",
      "btn.name": "Name it (N)", "btn.back": "Undo line", "btn.clear": "Clear", "btn.rename": "Rename", "btn.erase": "Erase",
      "btn.eraseYes": "Erase", "btn.save": "Save", "btn.fc": "The sky of the next hours (F)",
      "view.label": "The night sky over the observatory. Tap a star, then another, to join them with a line. Arrow keys move between the stars, Enter joins.",
      "num.dec": ".", "num.k": "K", "num.m": "M", "num.b": "B", "num.t": "T",
      "st.sl": "Starlight", "st.rate": "+{n}/min", "st.cs": "Constellations this season: {n} of {k}",
      "st.moon": "The moon tonight (the real moon): {p}, starlight ×{f}", "st.sky": "The sky now: {w}, starlight ×{f}",
      "sky.clear": "clear", "sky.haze": "haze", "sky.cloud": "clouds",
      "skyn.clear": "Clear sky: the telescopes gather in full.",
      "skyn.haze": "Haze: the telescopes gather 75%.",
      "skyn.cloud": "Clouds: the telescopes gather 40%.",
      "moon.0": "new moon", "moon.1": "waxing crescent", "moon.2": "first quarter", "moon.3": "waxing gibbous",
      "moon.4": "full moon", "moon.5": "waning gibbous", "moon.6": "last quarter", "moon.7": "waning crescent",
      "fc.title": "The sky of the next hours", "fc.cell": "{h}: {w}",
      "fc.note": "The clouds are the same on every device and change every 3 hours. The moon is the real moon: a new moon gives up to 20% more starlight, a full moon up to 20% less.",
      "kind.blue": "blue", "kind.gold": "gold", "kind.red": "red", "kind.white": "white",
      "kind.blue.fx": "telescopes +3% per point of brightness", "kind.gold.fx": "telescopes 2% cheaper per point",
      "kind.red.fx": "lines 3% cheaper per point", "kind.white.fx": "more for the atlas at the season's end",
      "shape.chain": "chain", "shape.branch": "branched", "shape.loop": "ring", "shape.both": "ring with a branch",
      "tel.spy": "Spyglass", "tel.refr": "Refractor", "tel.refl": "Reflector", "tel.great": "Great reflector", "tel.dish": "Radio dish",
      "tel.fx": "{r} starlight a minute each.",
      "up.dark": "Dark sky", "up.dark.fx": "Shades over the village lamps: +25% to all the starlight.",
      "up.comp": "Star compass", "up.comp.fx": "Lines reach one cell farther.",
      "up.mirror": "Polished mirror: {t}", "up.mirror.fx": "Every {t} gathers twice as much.", "up.need": "Needs a {t}",
      "ob.title": "Observatory", "ob.tels": "Telescopes", "ob.ups": "Upgrades", "ob.lv": "{l}", "ob.lvMax": "{l}/{max}",
      "ob.max": "Done", "ob.cost": "{c} ✦",
      "ob.note": "Starlight a minute now: {r} (before the sky and the moon: {b}). Lines reach {d} cells.",
      "pn.hint": "Tap a star, then another, to join them with a line. Join 3 to 8 stars into one shape and name it: its stars and its shape give a bonus for the whole season.",
      "pn.next": "Constellations: {n} of {k}. With {k} and a radio dish a new season can begin.",
      "pn.nextDish": "Constellations: {n} of {k}. A radio dish is built: {k} constellations begin a new season.",
      "pn.ready": "Six constellations and a radio dish: a new season can begin. Open New season to see the choice. There is no hurry.",
      "pn.draw": "Drawing: {n} stars, {m} lines", "pn.drawShape": "Drawing: {n} stars, {m} lines · {s}",
      "pn.cost": "Lines: {c} ✦", "pn.gives": "Gives: {fx}", "pn.anchor": "Tap the next star in reach, or the same star again to let go.",
      "pn.few": "Join at least 3 stars.", "pn.many": "At most 8 stars.", "pn.shape": "Join the stars into one piece, with at most one ring.",
      "pn.cons": "{s} · {n} stars", "pn.atlas": "At the season's end: +{p}% for good in the atlas.",
      "fx.blue": "telescopes +{p}%", "fx.gold": "telescopes −{p}% price", "fx.red": "lines −{p}% price", "fx.white": "atlas +{p}%",
      "fx.none": "a place in the atlas",
      "nm.title": "Name the constellation", "nm.msg": "Its seeded name is {n}. Keep it, or type your own (up to 24 characters).",
      "nm.rename": "Rename the constellation", "nm.cost": "The lines cost {c} ✦.",
      "er.ask": "Erase «{n}»? Its stars are free again; the starlight for its lines is not returned.",
      "ax.title": "Star atlas", "ax.none": "The atlas fills when a new season begins: every constellation of the season goes in.",
      "ax.bonus": "The atlas adds {p}% to all the starlight, for good.", "ax.item": "+{p}%", "ax.season": "This season",
      "rec.title": "Records", "rec.life": "Starlight gathered in all", "rec.season": "Season", "rec.cs": "Constellations this season",
      "rec.ax": "Constellations in the atlas", "rec.traits": "Traits", "rec.none": "none yet", "rec.hours": "Hours of clear sky, haze and clouds",
      "rec.acts": "Things you did", "rec.sfx": "Sound effects", "rec.night": "The sound of the night (wind and far crickets)",
      "rec.miles": "Milestones",
      "rec.note": "The sky lives on every device you use orOS on. If two devices play at the same time, the one further ahead is kept.",
      "rec.startAsk": "Start a new sky? The sky you have now goes, on every device.",
      "mi.first": "The first constellation", "mi.loop": "A ring", "mi.eight": "A constellation of 8 stars",
      "mi.four": "All four kinds in one", "mi.million": "A million starlight", "mi.season": "The first new season", "mi.ten": "Ten seasons",
      "away.title": "While you were away", "away.hero": "+{n} ✦",
      "away.time": "You were away", "away.clear": "Clear sky", "away.haze": "Haze", "away.cloud": "Clouds", "away.moons": "Moons that came and went",
      "away.sl": "Starlight now",
      "away.slow": "After 7 days away the observatory works at half pace: it never stops, it only slows.",
      "dur.d": "{n} d", "dur.h": "{n} h", "dur.m": "{n} min",
      "tour.title": "How it works",
      "tour.1": "Your telescopes gather starlight every minute, even while orOS is closed. Starlight buys more telescopes in the Observatory.",
      "tour.2": "Tap a star, then another, to join them with a line. Join 3 to 8 stars into one shape and name it. Lines may not cross, and a star belongs to one constellation, so plan the sky.",
      "tour.3": "Every kind of star gives something: blue lifts the telescopes, gold makes them cheaper, red makes lines cheaper, white is kept for the atlas. A branch or a ring makes the whole constellation worth more.",
      "tour.4": "The moon is the real moon: a new moon gives a little more, a full moon a little less. There is nothing to miss and nothing to collect: come back when you like.",
      "toast.buy": "Built: {u}", "toast.named": "A new constellation: {n}", "toast.erased": "Erased: {n}", "toast.renamed": "Renamed: {n}",
      "toast.start": "A new sky", "toast.sl": "Not enough starlight yet", "toast.max": "Already done", "toast.need": "Build a {x} first",
      "toast.far": "Too far: lines reach {r} cells (the star compass reaches farther)",
      "toast.through": "The line would pass through another star", "toast.cross": "Lines may not cross",
      "toast.dup": "That line is already drawn", "toast.used": "That star is already in «{n}»",
      "toast.few": "A constellation needs at least 3 stars", "toast.many": "A constellation has at most 8 stars",
      "toast.shape": "Join the stars into one piece, with at most one ring", "toast.bad": "That cannot be done",
      "toast.save": "Not saved: the browser's storage is full",
      "toast.season": "Season {n} begins: a new sky", "toast.noseason": "A new season needs 6 constellations and a radio dish",
      "tr.keen": "Keen-eyed", "tr.keen.fx": "Lines reach one cell farther.",
      "tr.steady": "Steady hand", "tr.steady.fx": "Lines cost 15% less.",
      "tr.moon": "Moon-watcher", "tr.moon.fx": "The full moon takes half as much.",
      "tr.carto": "Cartographer", "tr.carto.fx": "Every shape is worth a quarter more.",
      "tr.grinder": "Lens grinder", "tr.grinder.fx": "Telescopes cost 10% less.",
      "tr.early": "Early riser", "tr.early.fx": "Every new season starts with 2 refractors.",
      "sn.title": "A new sky season",
      "sn.msg": "Six constellations are named and the radio dish listens. You can begin a new season: a new field of stars, and the observatory back to one spyglass and a little starlight. Every constellation of this season goes into the star atlas and adds to all the starlight for good, and you keep one new trait.",
      "sn.trait": "One trait for good", "sn.go": "Begin the new season", "sn.later": "Not now",
      "sn.note": "There is no hurry: a new season can begin any time from now on. Undo takes it back for a few seconds.",
      "season": "Season {n}",
      "names": "the Little Boat|the Kettle|the Lantern|the Olive Branch|the Goat|the Fishing Net|the Swallow|the Key|the Spindle|the Anchor|the Oar|the Bell|the Ladder|the Owl|the Fig Tree|the Cat|the Kite|the Wheel|the Pomegranate|the Bridge|the Comb|the Sandal|the Jug|the Hedgehog|the Fern|the Windmill|the Seashell|the Loom|the Sparrow|the Hearth",
      "live.star": "Star {n}: {k}, brightness {b}{u}", "live.inC": ", in «{c}»", "live.line": "Line drawn: {n} stars"
    },
    el: {
      "app.name": "Χάρτης των άστρων",
      "btn.obs": "Αστεροσκοπείο", "btn.obsKey": "Αστεροσκοπείο (T)", "btn.atlas": "Άτλαντας των άστρων (A)",
      "btn.stats": "Αρχείο (S)", "btn.sfxOn": "Ήχος ανοιχτός (M)", "btn.sfxOff": "Ήχος κλειστός (M)",
      "btn.close": "Κλείσιμο", "btn.ok": "Ωραία", "btn.undo": "Αναίρεση", "btn.cancel": "Άκυρο",
      "btn.start": "Από την αρχή", "btn.startYes": "Νέος ουρανός", "btn.season": "Νέα εποχή", "btn.seasonKey": "Νέα εποχή (E)",
      "btn.name": "Δώσε όνομα (N)", "btn.back": "Πίσω μία γραμμή", "btn.clear": "Καθάρισμα", "btn.rename": "Μετονομασία", "btn.erase": "Σβήσιμο",
      "btn.eraseYes": "Σβήσ' τον", "btn.save": "Αποθήκευση", "btn.fc": "Ο ουρανός των επόμενων ωρών (F)",
      "view.label": "Ο νυχτερινός ουρανός πάνω από το αστεροσκοπείο. Πάτα ένα αστέρι και μετά ένα άλλο για να τα ενώσεις με μια γραμμή. Με τα βελάκια πας από αστέρι σε αστέρι, με το Enter ενώνεις.",
      "num.dec": ",", "num.k": " χιλ.", "num.m": " εκ.", "num.b": " δισ.", "num.t": " τρισ.",
      "st.sl": "Αστρόφως", "st.rate": "+{n}/λεπτό", "st.cs": "Αστερισμοί αυτής της εποχής: {n} από {k}",
      "st.moon": "Η σελήνη απόψε (η πραγματική): {p}, αστρόφως ×{f}", "st.sky": "Ο ουρανός τώρα: {w}, αστρόφως ×{f}",
      "sky.clear": "καθαρός", "sky.haze": "θολός", "sky.cloud": "συννεφιά",
      "skyn.clear": "Καθαρός ουρανός: τα τηλεσκόπια μαζεύουν στο ακέραιο.",
      "skyn.haze": "Θολούρα: τα τηλεσκόπια μαζεύουν το 75%.",
      "skyn.cloud": "Συννεφιά: τα τηλεσκόπια μαζεύουν το 40%.",
      "moon.0": "νέα σελήνη", "moon.1": "αύξων μηνίσκος", "moon.2": "πρώτο τέταρτο", "moon.3": "αύξουσα σελήνη",
      "moon.4": "πανσέληνος", "moon.5": "φθίνουσα σελήνη", "moon.6": "τελευταίο τέταρτο", "moon.7": "φθίνων μηνίσκος",
      "fc.title": "Ο ουρανός των επόμενων ωρών", "fc.cell": "{h}: {w}",
      "fc.note": "Τα σύννεφα είναι ίδια σε κάθε συσκευή και αλλάζουν κάθε 3 ώρες. Η σελήνη είναι η πραγματική: η νέα σελήνη δίνει ως 20% περισσότερο αστρόφως, η πανσέληνος ως 20% λιγότερο.",
      "kind.blue": "μπλε", "kind.gold": "χρυσό", "kind.red": "κόκκινο", "kind.white": "λευκό",
      "kind.blue.fx": "τηλεσκόπια +3% ανά βαθμό λάμψης", "kind.gold.fx": "τηλεσκόπια 2% φθηνότερα ανά βαθμό",
      "kind.red.fx": "γραμμές 3% φθηνότερες ανά βαθμό", "kind.white.fx": "περισσότερα στον άτλαντα στο τέλος της εποχής",
      "shape.chain": "αλυσίδα", "shape.branch": "με διακλάδωση", "shape.loop": "κύκλος", "shape.both": "κύκλος με διακλάδωση",
      "tel.spy": "Κιάλι", "tel.refr": "Διοπτρικό", "tel.refl": "Κατοπτρικό", "tel.great": "Μεγάλο κατοπτρικό", "tel.dish": "Ραδιοτηλεσκόπιο",
      "tel.fx": "{r} αστρόφως το λεπτό το καθένα.",
      "up.dark": "Σκοτεινός ουρανός", "up.dark.fx": "Καπέλα στα φώτα του χωριού: +25% σε όλο το αστρόφως.",
      "up.comp": "Αστρική πυξίδα", "up.comp.fx": "Οι γραμμές φτάνουν ένα τετράγωνο πιο μακριά.",
      "up.mirror": "Γυαλισμένος καθρέφτης: {t}", "up.mirror.fx": "Κάθε {t} μαζεύει τα διπλά.", "up.need": "Θέλει {t}",
      "ob.title": "Αστεροσκοπείο", "ob.tels": "Τηλεσκόπια", "ob.ups": "Βελτιώσεις", "ob.lv": "{l}", "ob.lvMax": "{l}/{max}",
      "ob.max": "Έγινε", "ob.cost": "{c} ✦",
      "ob.note": "Αστρόφως το λεπτό τώρα: {r} (πριν από τον ουρανό και τη σελήνη: {b}). Οι γραμμές φτάνουν {d} τετράγωνα.",
      "pn.hint": "Πάτα ένα αστέρι και μετά ένα άλλο για να τα ενώσεις με μια γραμμή. Ένωσε 3 ως 8 αστέρια σε ένα σχήμα και δώσ' του όνομα: τα αστέρια και το σχήμα του δίνουν μπόνους για όλη την εποχή.",
      "pn.next": "Αστερισμοί: {n} από {k}. Με {k} και ένα ραδιοτηλεσκόπιο αρχίζει νέα εποχή.",
      "pn.nextDish": "Αστερισμοί: {n} από {k}. Το ραδιοτηλεσκόπιο υπάρχει: {k} αστερισμοί αρχίζουν νέα εποχή.",
      "pn.ready": "Έξι αστερισμοί και ένα ραδιοτηλεσκόπιο: μπορεί να αρχίσει νέα εποχή. Άνοιξε τη Νέα εποχή για να δεις την επιλογή. Δεν βιάζεσαι.",
      "pn.draw": "Σχέδιο: {n} αστέρια, {m} γραμμές", "pn.drawShape": "Σχέδιο: {n} αστέρια, {m} γραμμές · {s}",
      "pn.cost": "Γραμμές: {c} ✦", "pn.gives": "Δίνει: {fx}", "pn.anchor": "Πάτα το επόμενο αστέρι που φτάνει η γραμμή, ή το ίδιο αστέρι για να το αφήσεις.",
      "pn.few": "Ένωσε τουλάχιστον 3 αστέρια.", "pn.many": "Το πολύ 8 αστέρια.", "pn.shape": "Ένωσε τα αστέρια σε ένα κομμάτι, με έναν κύκλο το πολύ.",
      "pn.cons": "{s} · {n} αστέρια", "pn.atlas": "Στο τέλος της εποχής: +{p}% για πάντα στον άτλαντα.",
      "fx.blue": "τηλεσκόπια +{p}%", "fx.gold": "τηλεσκόπια −{p}% στην τιμή", "fx.red": "γραμμές −{p}% στην τιμή", "fx.white": "άτλαντας +{p}%",
      "fx.none": "μια θέση στον άτλαντα",
      "nm.title": "Όνομα για τον αστερισμό", "nm.msg": "Το έτοιμο όνομά του είναι {n}. Κράτησέ το ή γράψε δικό σου (ως 24 χαρακτήρες).",
      "nm.rename": "Μετονομασία αστερισμού", "nm.cost": "Οι γραμμές κοστίζουν {c} ✦.",
      "er.ask": "Να σβηστεί ο αστερισμός «{n}»; Τα αστέρια του ελευθερώνονται· το αστρόφως των γραμμών του δεν επιστρέφεται.",
      "ax.title": "Άτλαντας των άστρων", "ax.none": "Ο άτλαντας γεμίζει όταν αρχίζει νέα εποχή: μπαίνει μέσα κάθε αστερισμός της εποχής.",
      "ax.bonus": "Ο άτλαντας προσθέτει {p}% σε όλο το αστρόφως, για πάντα.", "ax.item": "+{p}%", "ax.season": "Αυτή η εποχή",
      "rec.title": "Αρχείο", "rec.life": "Αστρόφως συνολικά", "rec.season": "Εποχή", "rec.cs": "Αστερισμοί αυτής της εποχής",
      "rec.ax": "Αστερισμοί στον άτλαντα", "rec.traits": "Χαρακτηριστικά", "rec.none": "κανένα ακόμα", "rec.hours": "Ώρες με καθαρό ουρανό, θολούρα και συννεφιά",
      "rec.acts": "Κινήσεις σου", "rec.sfx": "Ήχοι", "rec.night": "Ο ήχος της νύχτας (αέρας και τριζόνια από μακριά)",
      "rec.miles": "Ορόσημα",
      "rec.note": "Ο ουρανός είναι ίδιος σε κάθε συσκευή όπου χρησιμοποιείς το orOS. Αν παίξουν δύο συσκευές ταυτόχρονα, κρατιέται αυτή που έχει προχωρήσει περισσότερο.",
      "rec.startAsk": "Να ξεκινήσει νέος ουρανός; Ο τωρινός χάνεται σε όλες τις συσκευές.",
      "mi.first": "Ο πρώτος αστερισμός", "mi.loop": "Ένας κύκλος", "mi.eight": "Αστερισμός με 8 αστέρια",
      "mi.four": "Και τα τέσσερα είδη σε έναν", "mi.million": "Ένα εκατομμύριο αστρόφως", "mi.season": "Η πρώτη νέα εποχή", "mi.ten": "Δέκα εποχές",
      "away.title": "Όσο έλειπες", "away.hero": "+{n} ✦",
      "away.time": "Έλειπες", "away.clear": "Καθαρός ουρανός", "away.haze": "Θολούρα", "away.cloud": "Συννεφιά", "away.moons": "Σελήνες που ήρθαν και πέρασαν",
      "away.sl": "Αστρόφως τώρα",
      "away.slow": "Μετά από 7 μέρες απουσίας το αστεροσκοπείο δουλεύει με μισή ταχύτητα: δεν σταματά ποτέ, απλώς πάει πιο αργά.",
      "dur.d": "{n} μ.", "dur.h": "{n} ώ.", "dur.m": "{n} λεπ.",
      "tour.title": "Πώς παίζεται",
      "tour.1": "Τα τηλεσκόπιά σου μαζεύουν αστρόφως κάθε λεπτό, ακόμα και όταν το orOS είναι κλειστό. Με το αστρόφως αγοράζεις κι άλλα τηλεσκόπια στο Αστεροσκοπείο.",
      "tour.2": "Πάτα ένα αστέρι και μετά ένα άλλο για να τα ενώσεις με μια γραμμή. Ένωσε 3 ως 8 αστέρια σε ένα σχήμα και δώσ' του όνομα. Οι γραμμές δεν διασταυρώνονται και κάθε αστέρι ανήκει σε έναν αστερισμό, οπότε σχεδίασε τον ουρανό με το μυαλό.",
      "tour.3": "Κάθε είδος αστεριού δίνει κάτι: το μπλε ανεβάζει τα τηλεσκόπια, το χρυσό τα κάνει φθηνότερα, το κόκκινο κάνει φθηνότερες τις γραμμές, το λευκό φυλάγεται για τον άτλαντα. Μια διακλάδωση ή ένας κύκλος κάνει όλον τον αστερισμό πιο πολύτιμο.",
      "tour.4": "Η σελήνη είναι η πραγματική: η νέα σελήνη δίνει λίγο περισσότερο, η πανσέληνος λίγο λιγότερο. Δεν χάνεις τίποτα και δεν έχεις τίποτα να μαζέψεις: έλα όποτε θέλεις.",
      "toast.buy": "Έγινε: {u}", "toast.named": "Νέος αστερισμός: {n}", "toast.erased": "Σβήστηκε: {n}", "toast.renamed": "Νέο όνομα: {n}",
      "toast.start": "Νέος ουρανός", "toast.sl": "Δεν φτάνει ακόμα το αστρόφως", "toast.max": "Έχει ήδη γίνει", "toast.need": "Χρειάζεται πρώτα {x}",
      "toast.far": "Πολύ μακριά: οι γραμμές φτάνουν {r} τετράγωνα (η αστρική πυξίδα φτάνει πιο μακριά)",
      "toast.through": "Η γραμμή θα περνούσε από άλλο αστέρι", "toast.cross": "Οι γραμμές δεν διασταυρώνονται",
      "toast.dup": "Αυτή η γραμμή υπάρχει ήδη", "toast.used": "Αυτό το αστέρι ανήκει ήδη στον αστερισμό «{n}»",
      "toast.few": "Ένας αστερισμός θέλει τουλάχιστον 3 αστέρια", "toast.many": "Ένας αστερισμός έχει το πολύ 8 αστέρια",
      "toast.shape": "Ένωσε τα αστέρια σε ένα κομμάτι, με έναν κύκλο το πολύ", "toast.bad": "Αυτό δεν γίνεται",
      "toast.save": "Δεν αποθηκεύτηκε: ο χώρος του προγράμματος περιήγησης γέμισε",
      "toast.season": "Αρχίζει η εποχή {n}: νέος ουρανός", "toast.noseason": "Νέα εποχή θέλει 6 αστερισμούς και ένα ραδιοτηλεσκόπιο",
      "tr.keen": "Κοφτερό μάτι", "tr.keen.fx": "Οι γραμμές φτάνουν ένα τετράγωνο πιο μακριά.",
      "tr.steady": "Σταθερό χέρι", "tr.steady.fx": "Οι γραμμές κοστίζουν 15% λιγότερο.",
      "tr.moon": "Φίλος της σελήνης", "tr.moon.fx": "Η πανσέληνος παίρνει τα μισά.",
      "tr.carto": "Χαρτογράφος", "tr.carto.fx": "Κάθε σχήμα αξίζει ένα τέταρτο περισσότερο.",
      "tr.grinder": "Λειαντής φακών", "tr.grinder.fx": "Τα τηλεσκόπια κοστίζουν 10% λιγότερο.",
      "tr.early": "Πρωινός", "tr.early.fx": "Κάθε νέα εποχή αρχίζει με 2 διοπτρικά.",
      "sn.title": "Νέα εποχή του ουρανού",
      "sn.msg": "Έξι αστερισμοί έχουν όνομα και το ραδιοτηλεσκόπιο ακούει. Μπορείς να αρχίσεις νέα εποχή: ένα νέο πεδίο με αστέρια, και το αστεροσκοπείο πίσω σε ένα κιάλι και λίγο αστρόφως. Κάθε αστερισμός αυτής της εποχής μπαίνει στον άτλαντα των άστρων και προσθέτει για πάντα σε όλο το αστρόφως, και κρατάς ένα νέο χαρακτηριστικό.",
      "sn.trait": "Ένα χαρακτηριστικό για πάντα", "sn.go": "Άρχισε τη νέα εποχή", "sn.later": "Όχι τώρα",
      "sn.note": "Δεν βιάζεσαι: η νέα εποχή μπορεί να αρχίσει όποτε θέλεις από εδώ και πέρα. Η Αναίρεση την παίρνει πίσω για λίγα δευτερόλεπτα.",
      "season": "Εποχή {n}",
      "names": "η Βαρκούλα|το Μπρίκι|το Φανάρι|το Κλαδί ελιάς|η Κατσίκα|το Δίχτυ|το Χελιδόνι|το Κλειδί|η Ρόκα|η Άγκυρα|το Κουπί|η Καμπάνα|η Σκάλα|η Κουκουβάγια|η Συκιά|η Γάτα|ο Χαρταετός|ο Τροχός|το Ρόδι|το Γεφύρι|η Χτένα|το Σανδάλι|η Στάμνα|ο Σκαντζόχοιρος|η Φτέρη|ο Ανεμόμυλος|το Κοχύλι|ο Αργαλειός|το Σπουργίτι|η Γωνιά",
      "live.star": "Αστέρι {n}: {k}, λάμψη {b}{u}", "live.inC": ", στον αστερισμό «{c}»", "live.line": "Νέα γραμμή: {n} αστέρια"
    }
  };
  if (window.orosI18n) window.orosI18n.table(STRINGS, "starchart", LANG);

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

  // Short numbers: 950, 1.2K, 3.4M (1,2 χιλ. in Greek).
  function fmt(n) {
    if (!isFinite(n) || n < 0) n = 0;
    if (n < 1000) return String(Math.floor(n));
    var units = [["num.t", 1e12], ["num.b", 1e9], ["num.m", 1e6], ["num.k", 1e3]];
    for (var i = 0; i < units.length; i++) {
      if (n >= units[i][1]) {
        var v = n / units[i][1];
        if (v >= 1000 && i === 0) return n.toExponential(2).replace(".", t("num.dec"));
        var s = v >= 100 ? String(Math.floor(v)) : (Math.floor(v * 10) / 10).toFixed(1);
        return s.replace(".", t("num.dec")) + t(units[i][0]);
      }
    }
    return String(Math.floor(n));
  }
  function fmtRate(n) {
    if (!isFinite(n) || n <= 0) return "0";
    if (n < 10) return (Math.round(n * 10) / 10).toFixed(1).replace(".", t("num.dec"));
    return fmt(n);
  }
  function fmtF(f) { return (Math.round(f * 100) / 100).toFixed(2).replace(".", t("num.dec")); }
  function pct(x) { var p = Math.round(x * 1000) / 10; return String(p).replace(".", t("num.dec")); }
  function fmtDur(ms) {
    var m = Math.floor(ms / 60000), d = Math.floor(m / 1440), h = Math.floor((m % 1440) / 60);
    if (d > 0) return t("dur.d", { n: d }) + (h ? " " + t("dur.h", { n: h }) : "");
    if (h > 0) return t("dur.h", { n: h }) + (m % 60 ? " " + t("dur.m", { n: m % 60 }) : "");
    return t("dur.m", { n: m });
  }
  function hh(ms) { var d = new Date(ms), h = d.getHours(); return (h < 10 ? "0" : "") + h + ":00"; }
  function moonName(p) { return t("moon." + (Math.round(p * 8) % 8)); }
  function seededName(k) { var l = t("names").split("|"); return l[k % l.length] || ""; }
  function consName(c) { return c.n || seededName(c.k); }
  function upName(id) {
    if (E.TEL[id]) return t("tel." + id);
    if (id.charAt(0) === "m" && E.TEL[id.slice(1)]) return t("up.mirror", { t: t("tel." + id.slice(1)) });
    return t("up." + id);
  }
  function upFx(id) {
    if (E.TEL[id]) return t("tel.fx", { r: fmt(E.TEL[id].r) });
    if (id.charAt(0) === "m" && E.TEL[id.slice(1)]) return t("up.mirror.fx", { t: t("tel." + id.slice(1)) });
    return t("up." + id + ".fx");
  }

  function newSeed() {
    var abc = "abcdefghjkmnpqrstuvwxyz23456789", buf = new Uint32Array(8), s = "";
    try { crypto.getRandomValues(buf); } catch (e) { for (var j = 0; j < 8; j++) buf[j] = Math.floor(Math.random() * 1e9); }
    for (var i = 0; i < 8; i++) s += abc.charAt(buf[i] % abc.length);
    return s;
  }

  // BOOT MARKER
  var SCRIPT_V = "";
  (function () {
    var m = ((document.currentScript && document.currentScript.src) || "")
      .match(/[?&]v=([^&#]+)/);
    SCRIPT_V = m ? m[1] : "";
    document.documentElement.lang = LANG;
    console.log("starchart.js v" + (SCRIPT_V || "?") + " boot");
  })();

  // ---------- 2. Saves ----------
  // saved = the sky as last written (what syncs); live = the same sky
  // brought to the clock now (saved stepped by the time since saved.at).
  var saved = null, stored = false, live = null;
  var prefs = { seen: 0, seenLife: 0, seenHc0: 0, seenHc1: 0, seenHc2: 0, tour: 0 };
  var pending = null;                  // { timer } an action not yet written
  var undo = null;                     // { snap, kind } the state before the last action
  var lastDirty = 0, dirtyTimer = null, dirtyWaiting = false;
  var saveFailShown = false;

  function load() {
    var x = null;
    try { x = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null"); } catch (e) { x = null; }
    saved = E.normalize(x);
    stored = !!saved;
    if (!saved) saved = E.newGame(newSeed(), nowMs(), 0);
    try {
      var p = JSON.parse(localStorage.getItem(PREFS_KEY) || "null");
      if (p && typeof p === "object") {
        Object.keys(prefs).forEach(function (k) {
          if (typeof p[k] === "number" && isFinite(p[k])) prefs[k] = p[k];
        });
      }
    } catch (e) {}
  }
  function writeSaved() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(saved));
      localStorage.setItem(SESSION_KEY, JSON.stringify({ acts: saved.acts }));
      stored = true;
      return true;
    } catch (e) {
      if (!saveFailShown) { saveFailShown = true; showToast(t("toast.save")); }   // R30
      return false;
    }
  }
  function savePrefs() {
    try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch (e) {}
  }
  function seenNow() {
    prefs.seen = nowMs(); prefs.seenLife = live.life;
    prefs.seenHc0 = live.hc[0]; prefs.seenHc1 = live.hc[1]; prefs.seenHc2 = live.hc[2];
  }
  function commitSoon() {
    if (pending) clearTimeout(pending.timer);
    pending = { timer: setTimeout(commitNow, COMMIT_MS) };
  }
  function commitNow() {
    if (!pending) return;
    clearTimeout(pending.timer);
    pending = null;
    undo = null;
    E.catchUp(live, nowMs());
    saved = E.normalize(live);
    if (writeSaved()) dirtySoon();
  }
  function checkpoint() {
    saved = E.normalize(live);
    writeSaved();
  }
  function dirtySoon() {
    var now = Date.now();
    if (now - lastDirty >= DIRTY_GAP) { markDirty(); return; }
    dirtyWaiting = true;
    if (!dirtyTimer) dirtyTimer = setTimeout(function () { dirtyTimer = null; if (dirtyWaiting) markDirty(); }, DIRTY_GAP - (now - lastDirty));
  }
  function markDirty() {
    dirtyWaiting = false;
    lastDirty = Date.now();
    if (window.__orosSyncApi) window.__orosSyncApi.dirty();
  }
  function flushOut() {
    if (pending) commitNow();
    if (dirtyWaiting) markDirty();
    undo = null;
    hideToast();
    if (live) {
      E.catchUp(live, nowMs());
      seenNow();
      savePrefs();
    }
  }

  // ---------- 3. Clock + tick ----------
  var clockOff = 0;                     // advanceTime() moves the clock (tests)
  function nowMs() { return Date.now() + clockOff; }
  function tick() {
    if (!live) return;
    E.catchUp(live, nowMs());
    renderStatus();
    renderFc();
    refreshPanel();
    refreshDialog();
    updateNight();
    if (reduced || document.hidden) draw();
  }

  // ---------- 4. Actions ----------
  // The drawing not yet named: lines between free stars, and the star
  // the next line starts from (-1 none). selC = the chosen constellation.
  var draft = { l: [], a: -1 };
  var selC = -1, cur = -1;
  function draftErr() { return E.drawErr(live, draft.l); }
  function draftStars() { return E.starsOfLines(draft.l); }
  // After a sync or an undo the drawing may not fit the sky any more.
  function checkDraft() {
    var keep = [], used = E.usedStars(live, -1), others = E.allLines(live, -1);
    draft.l.forEach(function (l) {
      if (used[l[0]] === undefined && used[l[1]] === undefined && !E.lineErr(live, l[0], l[1], others.concat(keep))) keep.push(l);
    });
    draft.l = keep;
    var f = E.fieldOf(live);
    if (draft.a >= f.length || (draft.a >= 0 && used[draft.a] !== undefined)) draft.a = -1;
    if (selC >= live.cs.length) selC = -1;
    if (cur >= f.length) cur = -1;
  }
  function errText(err, extra) {
    return t("toast." + err, { r: E.reach(live), n: extra || "", x: extra || "" });
  }
  function doAct(a, okToast, kind) {
    E.catchUp(live, nowMs());
    if (pending) commitNow();          // the previous action is written first
    var snap = E.clone(live), snapDraft = JSON.parse(JSON.stringify(draft));
    var err = E.act(live, a);
    if (err) {
      var x = a.u && E.UP[a.u] && E.UP[a.u].need ? t("tel." + E.UP[a.u].need) : "";
      showToast(errText(err === "bad" ? "bad" : err, x));
      sfx("no");
      return false;
    }
    undo = { snap: snap, kind: kind || a.t, draft: snapDraft };
    commitSoon();
    sfx(a.t === "draw" ? "name" : a.t === "season" ? "season" : "up");
    showToast(okToast, true);
    checkDraft();
    renderAll(true);
    return true;
  }
  function buy(id) { return doAct({ t: "buy", u: id }, t("toast.buy", { u: upName(id) })); }
  function undoLast() {
    if (!undo) return;
    var u = undo;
    undo = null;
    if (pending) { clearTimeout(pending.timer); pending = null; }
    live = u.snap;
    if (u.draft) draft = u.draft;
    E.catchUp(live, nowMs());
    if (u.kind === "start") { saved = E.normalize(live); if (writeSaved()) dirtySoon(); }
    checkDraft();
    hideToast();
    sfx("undo");
    renderAll(true);
  }
  function startOver() {
    if (pending) commitNow();
    E.catchUp(live, nowMs());
    var br = Math.max(nowMs(), saved.br + 1);
    var old = E.clone(live);
    old.br = br;
    live = E.newGame(newSeed(), nowMs(), br);
    undo = { snap: old, kind: "start", draft: JSON.parse(JSON.stringify(draft)) };
    draft = { l: [], a: -1 }; selC = -1; cur = -1;
    saved = E.normalize(live);
    if (writeSaved()) dirtySoon();
    closeDialog();
    showToast(t("toast.start"), true);
    renderAll(true);
  }
  // A tap on star i (the screen and the keyboard both come here).
  function tapStar(i) {
    var f = E.fieldOf(live);
    if (i < 0 || i >= f.length) return;
    cur = i;
    var used = E.usedStars(live, -1);
    if (used[i] !== undefined) {
      if (draft.l.length || draft.a >= 0) {
        showToast(t("toast.used", { n: consName(live.cs[used[i]]) }));
        sfx("no");
      } else {
        selC = selC === used[i] ? -1 : used[i];
        renderPanel();
      }
      draw();
      return;
    }
    selC = -1;
    if (draft.a < 0) { draft.a = i; sfx("pick"); renderPanel(); draw(); return; }
    if (draft.a === i) { draft.a = -1; renderPanel(); draw(); return; }
    var stars = draftStars(), add = 0;
    if (stars.indexOf(draft.a) < 0) add++;
    if (stars.indexOf(i) < 0) add++;
    if (stars.length + add > E.MAX_C) { showToast(t("toast.many")); sfx("no"); return; }
    var err = E.lineErr(live, draft.a, i, E.allLines(live, -1).concat(draft.l));
    if (err) { showToast(errText(err)); sfx("no"); return; }
    draft.l.push(draft.a < i ? [draft.a, i] : [i, draft.a]);
    draft.a = i;
    sfx("line");
    live_(t("live.line", { n: draftStars().length }));
    renderPanel();
    draw();
  }
  function removeLine(k) {
    draft.l.splice(k, 1);
    renderPanel();
    draw();
  }
  function backLine() {
    if (draft.l.length) {
      var l = draft.l.pop();
      draft.a = draft.l.length ? (draft.a === l[1] ? l[0] : draft.a === l[0] ? l[1] : draft.a) : l[0];
    } else draft.a = -1;
    renderPanel();
    draw();
  }
  function clearDraft() { draft = { l: [], a: -1 }; renderPanel(); draw(); }
  function nameDraft() {
    E.catchUp(live, nowMs());
    var err = draftErr();
    if (err) { showToast(errText(err)); sfx("no"); return; }
    var c = E.linesCost(live, draft.l.length);
    if (live.sl < c) { showToast(t("toast.sl")); sfx("no"); return; }
    nameDialog(-1);
  }

  // ---------- 5. Scene ----------
  var canvas, ctx, dpr = 1, W = 0, H = 0;
  var reduced = false;
  var C = {};
  var G = {};                           // the grid: { ox, oy, cell, hill }
  var KIND_COL = { blue: "#8fb8ff", gold: "#ffd166", red: "#ff8a7a", white: "#f4f6ff" };
  var LINE_COL = "#cfd6e4";

  function readColors() {
    var cs = getComputedStyle(document.documentElement);
    ["--text", "--text-dim", "--accent", "--border", "--panel-bg", "--danger", "--bg"].forEach(function (v) {
      C[v.replace(/^--/, "")] = cs.getPropertyValue(v).trim() || "#888";
    });
  }
  function resize() {
    if (!canvas) return;
    var box = $("scene").getBoundingClientRect();
    dpr = window.devicePixelRatio || 1;
    W = Math.max(1, Math.floor(box.width)); H = Math.max(1, Math.floor(box.height));
    canvas.width = Math.floor(W * dpr); canvas.height = Math.floor(H * dpr);
    canvas.style.width = W + "px"; canvas.style.height = H + "px";
    layout();
    draw();
  }
  function layout() {
    var hill = Math.max(34, Math.min(H * 0.16, 90));
    var padX = 22, padTop = 26, padBot = 12;
    var cell = Math.min((W - 2 * padX) / (E.GW - 1), (H - hill - padTop - padBot) / (E.GH - 1));
    cell = Math.max(12, cell);
    G.cell = cell;
    G.ox = (W - cell * (E.GW - 1)) / 2;
    G.oy = padTop + Math.max(0, (H - hill - padTop - padBot - cell * (E.GH - 1)) / 2);
    G.hill = hill;
  }
  function px(st) { return { x: G.ox + st.x * G.cell, y: G.oy + st.y * G.cell }; }
  function starR(b) { return Math.max(4, G.cell * (0.09 + 0.045 * b)); }

  function draw(time) {
    if (!ctx || !live) return;
    time = time || 0;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    var now = nowMs(), sky = E.skyAt(live.seed, now), ph = E.moonPhase(now);
    var lit = (1 - Math.cos(2 * Math.PI * ph)) / 2;   // 0 new, 1 full
    var grd = ctx.createLinearGradient(0, 0, 0, H);
    grd.addColorStop(0, mixc("#03050f", "#0d1838", lit * 0.6));
    grd.addColorStop(1, mixc("#0b1430", "#1a2850", lit * 0.6));
    ctx.fillStyle = grd;
    ctx.fillRect(0, 0, W, H);
    drawDust(time, sky);
    drawMoon(ph, lit);
    drawGrid();
    drawLines();
    drawStars(time);
    drawClouds(time, sky);
    drawHill(sky);
  }
  function hex2rgb(h) { var n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
  function mixc(a, b, k) {
    var x = hex2rgb(a), y = hex2rgb(b);
    return "rgb(" + Math.round(x[0] + (y[0] - x[0]) * k) + "," + Math.round(x[1] + (y[1] - x[1]) * k) + "," + Math.round(x[2] + (y[2] - x[2]) * k) + ")";
  }
  // Faint far stars: only for the look, never joined.
  function drawDust(time, sky) {
    var a = sky === "cloud" ? 0.25 : sky === "haze" ? 0.45 : 0.7;
    for (var i = 0; i < 70; i++) {
      var x = E.rand01("dx" + i) * W, y = E.rand01("dy" + i) * (H - G.hill);
      var tw = reduced ? 1 : 0.6 + 0.4 * Math.sin(time / 900 + i * 2.1);
      ctx.fillStyle = "rgba(230,236,255," + (a * 0.55 * tw) + ")";
      ctx.fillRect(x, y, 1.2, 1.2);
    }
  }
  // The moon as it is tonight: the lit part from the phase.
  function drawMoon(ph, lit) {
    var r = Math.max(9, Math.min(18, W * 0.03)), x = W - r - 12, y = r + 8;
    ctx.save();
    ctx.fillStyle = "rgba(40,48,70,0.9)";
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "#f3eed8";
    var waxing = ph < 0.5, k = Math.cos(2 * Math.PI * ph);   // 1 new, -1 full
    ctx.beginPath();
    // the lit half
    ctx.arc(x, y, r, -Math.PI / 2, Math.PI / 2, !waxing);
    // the terminator: an ellipse from bottom back to top
    ctx.ellipse(x, y, Math.abs(k) * r, r, 0, Math.PI / 2, -Math.PI / 2, waxing ? k > 0 : k < 0);
    ctx.fill();
    if (lit > 0.4) {
      var gl = ctx.createRadialGradient(x, y, r, x, y, r * 3);
      gl.addColorStop(0, "rgba(243,238,216," + (0.18 * lit) + ")"); gl.addColorStop(1, "rgba(243,238,216,0)");
      ctx.fillStyle = gl;
      ctx.beginPath(); ctx.arc(x, y, r * 3, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();
  }
  // The reach of the star a line starts from, and the stars it can join.
  function drawGrid() {
    if (draft.a < 0) return;
    var f = E.fieldOf(live), a = px(f[draft.a]), r = E.reach(live) * G.cell;
    ctx.strokeStyle = "rgba(201,211,227,0.25)";
    ctx.setLineDash([3, 5]);
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(a.x, a.y, r, 0, Math.PI * 2); ctx.stroke();
    ctx.setLineDash([]);
    var used = E.usedStars(live, -1), others = E.allLines(live, -1).concat(draft.l);
    f.forEach(function (st, j) {
      if (j === draft.a || used[j] !== undefined || E.lineErr(live, draft.a, j, others)) return;
      var p = px(st);
      ctx.strokeStyle = "rgba(201,211,227,0.55)";
      ctx.beginPath(); ctx.arc(p.x, p.y, starR(st.b) + 5, 0, Math.PI * 2); ctx.stroke();
    });
  }
  function drawLines() {
    var f = E.fieldOf(live);
    ctx.lineCap = "round";
    live.cs.forEach(function (c, n) {
      ctx.strokeStyle = n === selC ? (C.accent || LINE_COL) : "rgba(207,214,228,0.75)";
      ctx.lineWidth = n === selC ? 3 : 2;
      ctx.beginPath();
      c.l.forEach(function (l) { var a = px(f[l[0]]), b = px(f[l[1]]); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); });
      ctx.stroke();
      // the name, small, under the lowest star
      var low = null;
      c.s.forEach(function (i) { var p = px(f[i]); if (!low || p.y > low.y) low = p; });
      var cx = 0;
      c.s.forEach(function (i) { cx += px(f[i]).x; });
      cx /= c.s.length;
      ctx.font = "600 " + Math.max(9, Math.min(12, G.cell * 0.32)) + "px Nunito, system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.fillStyle = n === selC ? "#ffffff" : "rgba(207,214,228,0.7)";
      ctx.fillText(consName(c), Math.max(40, Math.min(W - 40, cx)), Math.min(H - G.hill - 2, low.y + G.cell * 0.55));
    });
    if (draft.l.length) {
      ctx.strokeStyle = C.accent || "#e2e8f2";
      ctx.lineWidth = 2.5;
      ctx.setLineDash([6, 5]);
      ctx.beginPath();
      draft.l.forEach(function (l) { var a = px(f[l[0]]), b = px(f[l[1]]); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); });
      ctx.stroke();
      ctx.setLineDash([]);
    }
    ctx.lineCap = "butt";
  }
  // A star: its kind by its shape (diamond, disc, triangle, cross) and
  // colour, its brightness by its size.
  function glyph(kind, x, y, r) {
    ctx.beginPath();
    if (kind === "blue") { ctx.moveTo(x, y - r); ctx.lineTo(x + r * 0.8, y); ctx.lineTo(x, y + r); ctx.lineTo(x - r * 0.8, y); ctx.closePath(); }
    else if (kind === "gold") { ctx.arc(x, y, r * 0.8, 0, Math.PI * 2); }
    else if (kind === "red") { ctx.moveTo(x, y - r); ctx.lineTo(x + r * 0.9, y + r * 0.7); ctx.lineTo(x - r * 0.9, y + r * 0.7); ctx.closePath(); }
    else {
      var w = r * 0.34;
      ctx.moveTo(x - w, y - r); ctx.lineTo(x + w, y - r); ctx.lineTo(x + w, y - w); ctx.lineTo(x + r, y - w); ctx.lineTo(x + r, y + w);
      ctx.lineTo(x + w, y + w); ctx.lineTo(x + w, y + r); ctx.lineTo(x - w, y + r); ctx.lineTo(x - w, y + w); ctx.lineTo(x - r, y + w);
      ctx.lineTo(x - r, y - w); ctx.lineTo(x - w, y - w); ctx.closePath();
    }
    ctx.fill();
  }
  function drawStars(time) {
    var f = E.fieldOf(live);
    f.forEach(function (st, i) {
      var p = px(st), r = starR(st.b);
      var tw = reduced ? 1 : 0.85 + 0.15 * Math.sin(time / 700 + i * 1.7);
      var gl = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, r * 2.4);
      gl.addColorStop(0, hexA(KIND_COL[st.k], 0.35 * tw)); gl.addColorStop(1, hexA(KIND_COL[st.k], 0));
      ctx.fillStyle = gl;
      ctx.beginPath(); ctx.arc(p.x, p.y, r * 2.4, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = KIND_COL[st.k];
      glyph(st.k, p.x, p.y, r);
      if (i === draft.a) {
        ctx.strokeStyle = C.accent || "#e2e8f2"; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(p.x, p.y, r + 7, 0, Math.PI * 2); ctx.stroke();
      }
      if (i === cur && document.activeElement === canvas) {
        ctx.strokeStyle = "#ffffff"; ctx.lineWidth = 1.5;
        ctx.setLineDash([2, 3]);
        ctx.beginPath(); ctx.arc(p.x, p.y, r + 11, 0, Math.PI * 2); ctx.stroke();
        ctx.setLineDash([]);
      }
    });
  }
  function hexA(h, a) { var c = hex2rgb(h); return "rgba(" + c[0] + "," + c[1] + "," + c[2] + "," + a + ")"; }
  function drawClouds(time, sky) {
    if (sky === "clear") return;
    var n = sky === "cloud" ? 7 : 4, a = sky === "cloud" ? 0.32 : 0.16;
    for (var i = 0; i < n; i++) {
      var w = W * (0.25 + 0.2 * E.rand01("cw" + i)), y = (H - G.hill) * (0.1 + 0.75 * E.rand01("cy" + i));
      var x = ((E.rand01("cx" + i) * (W + w) + (reduced ? 0 : time / (120 + 40 * i))) % (W + w)) - w / 2;
      var g = ctx.createRadialGradient(x, y, 0, x, y, w / 2);
      g.addColorStop(0, "rgba(120,130,150," + a + ")"); g.addColorStop(1, "rgba(120,130,150,0)");
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.ellipse(x, y, w / 2, w / 5, 0, 0, Math.PI * 2); ctx.fill();
    }
  }
  // The hill with the observatory: the dome, with its slit open when the
  // sky is clear, and one small telescope for every kind built.
  function drawHill(sky) {
    var top = H - G.hill;
    ctx.fillStyle = "#05070d";
    ctx.beginPath();
    ctx.moveTo(0, H); ctx.lineTo(0, top + G.hill * 0.45);
    ctx.bezierCurveTo(W * 0.25, top + G.hill * 0.1, W * 0.55, top - G.hill * 0.05, W, top + G.hill * 0.35);
    ctx.lineTo(W, H); ctx.closePath(); ctx.fill();
    var dx = W * 0.5, dy = top + G.hill * 0.2, dr = Math.min(G.hill * 0.42, 30);
    ctx.fillStyle = "#1c2233";
    ctx.fillRect(dx - dr, dy, dr * 2, dr * 0.7);
    ctx.beginPath(); ctx.arc(dx, dy, dr, Math.PI, 0); ctx.fill();
    if (sky === "clear") { ctx.fillStyle = "#ffd98a"; ctx.fillRect(dx - dr * 0.12, dy - dr * 0.95, dr * 0.24, dr * 0.85); }
    var x = dx + dr * 1.6;
    E.TELS.forEach(function (tel, k) {
      if (!live.lv[tel.id]) return;
      var s = 5 + k * 2.2, bx = (k % 2 ? dx - dr * 1.6 - (k >> 1) * 22 : x + (k >> 1) * 22), by = top + G.hill * (0.3 + 0.04 * k);
      ctx.strokeStyle = "#3a4256"; ctx.lineWidth = Math.max(2, s * 0.5);
      ctx.beginPath(); ctx.moveTo(bx, by + s); ctx.lineTo(bx + s * 0.9, by - s * 0.6); ctx.stroke();
      ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(bx - s * 0.5, by + s * 1.4); ctx.lineTo(bx, by + s); ctx.lineTo(bx + s * 0.5, by + s * 1.4); ctx.stroke();
    });
  }
  var rafOn = false, lastFrame = 0;
  function frame(ts) {
    if (!rafOn) return;
    if (ts - lastFrame >= 50) { lastFrame = ts; draw(ts); }
    requestAnimationFrame(frame);
  }
  function startAnim() {
    if (reduced || rafOn || document.hidden) { draw(); return; }
    rafOn = true;
    requestAnimationFrame(frame);
  }
  function stopAnim() { rafOn = false; }

  // ---------- 6. Input ----------
  function starAt(x, y) {
    var f = E.fieldOf(live), best = -1, bd = Math.max(22, G.cell * 0.55);
    f.forEach(function (st, i) {
      var p = px(st), d = Math.sqrt((p.x - x) * (p.x - x) + (p.y - y) * (p.y - y));
      if (d < bd) { bd = d; best = i; }
    });
    return best;
  }
  function draftLineAt(x, y) {
    var f = E.fieldOf(live);
    for (var k = 0; k < draft.l.length; k++) {
      var a = px(f[draft.l[k][0]]), b = px(f[draft.l[k][1]]);
      var dx = b.x - a.x, dy = b.y - a.y, L = dx * dx + dy * dy;
      var u = L ? Math.max(0, Math.min(1, ((x - a.x) * dx + (y - a.y) * dy) / L)) : 0;
      var qx = a.x + u * dx - x, qy = a.y + u * dy - y;
      if (u > 0.15 && u < 0.85 && qx * qx + qy * qy < 144) return k;
    }
    return -1;
  }
  function wireInput() {
    canvas.addEventListener("pointerdown", function (ev) {
      var r = canvas.getBoundingClientRect(), x = ev.clientX - r.left, y = ev.clientY - r.top;
      var i = starAt(x, y);
      if (i >= 0) { tapStar(i); return; }
      var k = draftLineAt(x, y);
      if (k >= 0) { removeLine(k); return; }
      if (draft.a >= 0 || selC >= 0) { draft.a = -1; selC = -1; renderPanel(); draw(); }
    });
    canvas.addEventListener("focus", function () { if (cur < 0) cur = 0; draw(); });
    canvas.addEventListener("blur", function () { draw(); });
    canvas.addEventListener("keydown", function (ev) {
      var f = E.fieldOf(live);
      var dirs = { ArrowRight: [1, 0], ArrowLeft: [-1, 0], ArrowDown: [0, 1], ArrowUp: [0, -1] };
      if (dirs[ev.key]) {
        cur = nextStar(cur < 0 ? 0 : cur, dirs[ev.key]);
        var st = f[cur], used = E.usedStars(live, -1);
        live_(t("live.star", { n: cur + 1, k: t("kind." + st.k), b: st.b, u: used[cur] !== undefined ? t("live.inC", { c: consName(live.cs[used[cur]]) }) : "" }));
        draw();
        ev.preventDefault();
      } else if ((ev.key === "Enter" || ev.key === " ") && cur >= 0) { tapStar(cur); ev.preventDefault(); }
      else if (ev.key === "Backspace") { backLine(); ev.preventDefault(); }
      else if (ev.key === "Escape" && (draft.a >= 0 || selC >= 0)) { draft.a = -1; selC = -1; renderPanel(); draw(); ev.preventDefault(); }
    });
  }
  // The nearest star in a direction (within a 45° cone, by distance).
  function nextStar(from, d) {
    var f = E.fieldOf(live), a = f[from], best = from, bd = 1e9;
    f.forEach(function (st, i) {
      if (i === from) return;
      var dx = st.x - a.x, dy = st.y - a.y, along = dx * d[0] + dy * d[1], side = Math.abs(dx * d[1] - dy * d[0]);
      if (along <= 0 || side > along) return;
      var score = along + 2 * side;
      if (score < bd) { bd = score; best = i; }
    });
    return best;
  }
  function wireKeyboard() {
    document.addEventListener("keydown", function (ev) {
      if (ev.ctrlKey || ev.altKey || ev.metaKey) return;
      if ($("dlg").open) return;
      var k = ev.key.toLowerCase();
      if (k === "n" && draft.l.length) { nameDraft(); ev.preventDefault(); }
      else if (k === "t") { obsDialog(); ev.preventDefault(); }
      else if (k === "a") { atlasDialog(); ev.preventDefault(); }
      else if (k === "e") { seasonDialog(); ev.preventDefault(); }
      else if (k === "f") { fcDialog(); ev.preventDefault(); }
      else if (k === "s") { recDialog(); ev.preventDefault(); }
      else if (k === "m") { toggleSfx(); ev.preventDefault(); }
      else if (k === "z" && undo) { undoLast(); ev.preventDefault(); }
    });
  }

  // ---------- 7. Panels ----------
  function renderAll(full) {
    renderStatus();
    renderFc();
    if (full) renderPanel(); else refreshPanel();
    refreshDialog(full);
    draw();
  }
  function renderStatus() {
    var r = E.rates(live, nowMs());
    var c = $("s-sl");
    c.querySelector(".v").textContent = fmt(live.sl);
    c.querySelector(".r").textContent = t("st.rate", { n: fmtRate(r.now) });
    c.title = t("st.sl");
    var cs = $("s-cs");
    cs.querySelector(".v").textContent = live.cs.length + "/" + E.SEASON_N;
    cs.title = t("st.cs", { n: live.cs.length, k: E.SEASON_N });
    var m = $("s-moon");
    m.querySelector(".v").textContent = moonName(r.moon);
    m.title = t("st.moon", { p: moonName(r.moon), f: fmtF(r.mf) });
    var sk = $("s-sky");
    sk.querySelector(".ic").innerHTML = ICONS[r.sky];
    sk.querySelector(".v").textContent = t("sky." + r.sky);
    sk.title = t("st.sky", { w: t("sky." + r.sky), f: fmtF(E.SKYF[r.sky]) });
    var can = E.canSeason(live), sb = $("season-btn");
    if (sb.hidden === can) sb.hidden = !can;
    $("tb-season").textContent = t("season", { n: live.sn + 1 });
  }
  var fcKey = "";
  function renderFc() {
    var list = E.forecast(live, nowMs(), 8);
    var key = [list[0].t, LANG].join("|");
    if (key === fcKey) return;
    fcKey = key;
    var box = $("fc");
    box.textContent = "";
    box.title = t("btn.fc");
    list.forEach(function (f, i) {
      var cell = el("div", "fq" + (i === 0 ? " now" : ""));
      cell.setAttribute("role", "listitem");
      var wx = el("span", "wx " + f.sky);
      wx.innerHTML = ICONS[f.sky];
      cell.appendChild(wx);
      cell.appendChild(el("span", "dl", hh(f.t)));
      var label = t("fc.cell", { h: hh(f.t), w: t("sky." + f.sky) });
      cell.setAttribute("aria-label", label);
      cell.title = label;
      box.appendChild(cell);
    });
  }
  // What the totals of a worth give, as words.
  function fxText(w) {
    var out = [];
    if (w.blue) out.push(t("fx.blue", { p: pct(E.BLUE_F * w.blue) }));
    if (w.gold) out.push(t("fx.gold", { p: pct(E.GOLD_F * w.gold) }));
    if (w.red) out.push(t("fx.red", { p: pct(E.RED_F * w.red) }));
    if (w.white) out.push(t("fx.white", { p: pct(E.WHITE_F * w.white) }));
    return out.length ? out.join(", ") : t("fx.none");
  }
  var lastPanelKey = "";
  function panelKey() {
    return [selC, draft.l.length, draft.a, live.cs.length, E.canSeason(live), live.lv.dish > 0, LANG].join("|");
  }
  function renderPanel() {
    var box = $("panel");
    box.textContent = "";
    lastPanelKey = panelKey();
    if (selC >= 0 && live.cs[selC]) {
      var c = live.cs[selC], w = E.worth(live, c.l);
      box.appendChild(el("div", "pn-title", consName(c)));
      box.appendChild(el("p", "pn-sub", t("pn.cons", { s: t("shape." + w.shape), n: w.n })));
      box.appendChild(el("p", "pn-fx", t("pn.gives", { fx: fxText(w) })));
      box.appendChild(el("p", "pn-sub", t("pn.atlas", { p: pct(E.ATLAS_F + E.WHITE_F * w.white) })));
      var row = el("div", "pn-row");
      [["btn.rename", function () { nameDialog(selC); }], ["btn.erase", function () { askErase(selC); }], ["btn.close", function () { selC = -1; renderPanel(); draw(); }]].forEach(function (x, k) {
        var b = el("button", "dlg-btn" + (k === 1 ? " danger" : ""), t(x[0]));
        b.type = "button"; b.addEventListener("click", x[1]); row.appendChild(b);
      });
      box.appendChild(row);
      return;
    }
    if (draft.l.length || draft.a >= 0) {
      box.appendChild(el("p", "pn-title pn-draw"));
      box.appendChild(el("p", "pn-sub pn-cost"));
      box.appendChild(el("p", "pn-fx pn-gives"));
      box.appendChild(el("p", "pn-err"));
      var r2 = el("div", "pn-row");
      [["btn.name", nameDraft, "primary pn-name"], ["btn.back", backLine, ""], ["btn.clear", clearDraft, ""]].forEach(function (x) {
        var b = el("button", "dlg-btn " + x[2], t(x[0]));
        b.type = "button"; b.addEventListener("click", x[1]); r2.appendChild(b);
      });
      box.appendChild(r2);
      refreshPanel(true);
      return;
    }
    box.appendChild(el("p", "pn-hint", t("pn.hint")));
    var note = el("p", "pn-hint pn-next");
    box.appendChild(note);
    if (E.canSeason(live)) {
      var hb = el("button", "opt wide pn-hand");
      hb.type = "button";
      hb.appendChild(el("span", "tx")).appendChild(el("span", "nm", t("btn.season")));
      hb.addEventListener("click", seasonDialog);
      box.appendChild(hb);
    }
    refreshPanel(true);
  }
  function refreshPanel(force) {
    if (!force && panelKey() !== lastPanelKey) { renderPanel(); return; }
    var box = $("panel");
    var next = box.querySelector(".pn-next");
    if (next) next.textContent = E.canSeason(live) ? t("pn.ready") : t(live.lv.dish ? "pn.nextDish" : "pn.next", { n: live.cs.length, k: E.SEASON_N });
    var d = box.querySelector(".pn-draw");
    if (d) {
      var st = draftStars(), sh = E.shapeOf(draft.l), err = draftErr();
      d.textContent = sh ? t("pn.drawShape", { n: st.length, m: draft.l.length, s: t("shape." + sh) }) : t("pn.draw", { n: st.length, m: draft.l.length });
      var c = E.linesCost(live, draft.l.length);
      box.querySelector(".pn-cost").textContent = draft.l.length ? t("pn.cost", { c: fmt(Math.ceil(c)) }) : t("pn.anchor");
      box.querySelector(".pn-gives").textContent = sh ? t("pn.gives", { fx: fxText(E.worth(live, draft.l)) }) : "";
      var msg = "";
      if (draft.l.length && err) msg = err === "few" ? t("pn.few") : err === "many" ? t("pn.many") : err === "shape" ? t("pn.shape") : errText(err);
      else if (draft.l.length && live.sl < c) msg = t("toast.sl");
      box.querySelector(".pn-err").textContent = msg;
      box.querySelector(".pn-name").disabled = !draft.l.length || !!err || live.sl < c;
    }
  }

  // ---------- 8. Dialogs ----------
  var dlgKind = "";
  function openDialog(kind, buildFn) {
    var d = $("dlg");
    d.textContent = "";
    dlgKind = kind;
    buildFn(d);
    if (!d.open) { try { d.showModal(); } catch (e) { d.setAttribute("open", ""); } }
  }
  function closeDialog() {
    var d = $("dlg");
    dlgKind = "";
    if (d.open) { try { d.close(); } catch (e) { d.removeAttribute("open"); } }
    canvas.focus();
  }
  function actions(d, list) {
    var row = el("div", "dlg-actions");
    list.forEach(function (x) {
      var b = el("button", "dlg-btn" + (x.cls ? " " + x.cls : ""), x.label);
      b.type = "button";
      b.addEventListener("click", x.fn);
      row.appendChild(b);
    });
    d.appendChild(row);
    return row;
  }
  function rowKV(d, k, v) {
    var r = el("div", "dlg-row");
    r.appendChild(el("span", "", k));
    r.appendChild(el("strong", "", v));
    d.appendChild(r);
    return r;
  }
  function obsDialog() {
    E.catchUp(live, nowMs());
    openDialog("obs", function (d) {
      d.setAttribute("aria-label", t("ob.title"));
      d.appendChild(el("div", "dlg-title", t("ob.title")));
      [["ob.tels", E.TELS.map(function (x) { return x.id; })], ["ob.ups", E.UPS.map(function (u) { return u.id; })]].forEach(function (g) {
        d.appendChild(el("div", "up-group", t(g[0])));
        var list = el("div", "up-list");
        g[1].forEach(function (id) {
          var row = el("div", "up-row");
          row.setAttribute("data-u", id);
          var tx = el("div", "tx");
          var nm = el("div", "nm");
          nm.appendChild(document.createTextNode(upName(id)));
          nm.appendChild(el("span", "lv"));
          tx.appendChild(nm);
          tx.appendChild(el("div", "fx", upFx(id)));
          row.appendChild(tx);
          var b = el("button", "dlg-btn primary");
          b.type = "button";
          b.addEventListener("click", function () { buy(id); });
          row.appendChild(b);
          list.appendChild(row);
        });
        d.appendChild(list);
      });
      d.appendChild(el("p", "dlg-note ob-note"));
      actions(d, [{ label: t("btn.close"), fn: closeDialog }]);
    });
    refreshDialog(true);
  }
  function refreshDialog() {
    if (dlgKind !== "obs") return;
    var d = $("dlg"), tot = E.totals(live);
    E.TELS.concat(E.UPS).forEach(function (u) {
      var row = d.querySelector('[data-u="' + u.id + '"]');
      if (!row) return;
      var inf = E.upInfo(live, u.id), b = row.querySelector("button");
      row.querySelector(".lv").textContent = " " + (inf.tel ? t("ob.lv", { l: inf.lv }) : t("ob.lvMax", { l: inf.lv, max: inf.max }));
      b.textContent = inf.done ? t("ob.max") : !inf.need ? t("up.need", { t: t("tel." + E.UP[u.id].need) }) : t("ob.cost", { c: fmt(Math.ceil(inf.c)) });
      b.disabled = !inf.ok;
    });
    var r = E.rates(live, nowMs());
    var note = d.querySelector(".ob-note");
    if (note) note.textContent = t("ob.note", { r: fmtRate(r.now), b: fmtRate(E.baseRate(live, tot)), d: E.reach(live) });
  }
  function fcDialog() {
    E.catchUp(live, nowMs());
    openDialog("fc", function (d) {
      d.setAttribute("aria-label", t("fc.title"));
      d.appendChild(el("div", "dlg-title", t("fc.title")));
      var ul = el("ul", "fc-list"), seen = {};
      E.forecast(live, nowMs(), 8).forEach(function (f) {
        var li = el("li");
        var wx = el("span", "wx " + f.sky);
        wx.innerHTML = ICONS[f.sky];
        wx.setAttribute("aria-hidden", "true");
        li.appendChild(wx);
        li.appendChild(el("span", "", t("fc.cell", { h: hh(f.t), w: t("sky." + f.sky) })));
        ul.appendChild(li);
        seen[f.sky] = true;
      });
      d.appendChild(ul);
      E.SKY.forEach(function (w) { if (seen[w]) d.appendChild(el("p", "dlg-note", t("skyn." + w))); });
      var leg = el("div", "legend");
      E.KINDS.forEach(function (k) {
        var s = el("span");
        s.appendChild(el("b", "", t("kind." + k) + ": "));
        s.appendChild(document.createTextNode(t("kind." + k + ".fx")));
        leg.appendChild(s);
      });
      d.appendChild(leg);
      d.appendChild(el("p", "dlg-note", t("fc.note")));
      actions(d, [{ label: t("btn.close"), fn: closeDialog }]);
    });
  }
  // Name a new constellation (c = -1, the drawing) or rename one.
  function nameDialog(c) {
    var isNew = c < 0, k = isNew ? -1 : c;
    var seed = isNew ? null : live.cs[c];
    var seededK = isNew ? previewK() : seed.k;
    openDialog("name", function (d) {
      d.setAttribute("aria-label", t(isNew ? "nm.title" : "nm.rename"));
      d.appendChild(el("div", "dlg-title", t(isNew ? "nm.title" : "nm.rename")));
      d.appendChild(el("p", "dlg-msg", t("nm.msg", { n: "«" + seededName(seededK) + "»" })));
      var inp = el("input", "nm-input");
      inp.type = "text";
      inp.maxLength = E.NAME_MAX;
      inp.placeholder = seededName(seededK);
      inp.value = isNew ? "" : seed.n;
      inp.setAttribute("aria-label", t(isNew ? "nm.title" : "nm.rename"));
      inp.autocomplete = "off";
      d.appendChild(inp);
      if (isNew) d.appendChild(el("p", "dlg-note", t("nm.cost", { c: fmt(Math.ceil(E.linesCost(live, draft.l.length))) })));
      function go() {
        var n = E.cleanName(inp.value);
        closeDialog();
        if (isNew) {
          var lines = draft.l.slice();
          if (doAct({ t: "draw", l: lines, n: n }, t("toast.named", { n: n || seededName(seededK) }))) {
            draft = { l: [], a: -1 };
            selC = live.cs.length - 1;
            renderAll(true);
          }
        } else doAct({ t: "rename", c: k, n: n }, t("toast.renamed", { n: n || seededName(seededK) }));
      }
      inp.addEventListener("keydown", function (ev) { if (ev.key === "Enter") { ev.preventDefault(); go(); } });
      actions(d, [{ label: t("btn.cancel"), fn: closeDialog }, { label: t("btn.save"), cls: "primary", fn: go }]);
      setTimeout(function () { try { inp.focus(); } catch (e) {} }, 30);
    });
  }
  // The seeded name the drawing will get (the engine picks it the same way).
  function previewK() {
    var s = E.clone(live), l = draft.l.slice();
    s.sl = 1e300;
    if (E.act(s, { t: "draw", l: l, n: "" })) return 0;
    return s.cs[s.cs.length - 1].k;
  }
  function askErase(c) {
    var n = consName(live.cs[c]);
    openDialog("confirm", function (d) {
      d.setAttribute("aria-label", t("btn.erase"));
      d.appendChild(el("p", "dlg-msg", t("er.ask", { n: n })));
      actions(d, [
        { label: t("btn.cancel"), fn: closeDialog },
        { label: t("btn.eraseYes"), cls: "danger", fn: function () {
          closeDialog();
          selC = -1;
          doAct({ t: "erase", c: c }, t("toast.erased", { n: n }));
        } }
      ]);
    });
  }
  // A small drawing of a constellation, built as SVG nodes (no markup
  // from data): points on the grid, lines by index.
  var SVGNS = "http://www.w3.org/2000/svg";
  function miniSvg(p, l) {
    var svg = document.createElementNS(SVGNS, "svg");
    var xs = [], ys = [];
    for (var i = 0; i < p.length; i += 2) { xs.push(p[i]); ys.push(p[i + 1]); }
    var x0 = Math.min.apply(null, xs), x1 = Math.max.apply(null, xs), y0 = Math.min.apply(null, ys), y1 = Math.max.apply(null, ys);
    var w = Math.max(1, x1 - x0), h = Math.max(1, y1 - y0), sc = Math.min(70 / w, 49 / h);
    var ox = (84 - w * sc) / 2 - x0 * sc, oy = (63 - h * sc) / 2 - y0 * sc;
    svg.setAttribute("viewBox", "0 0 84 63");
    svg.setAttribute("aria-hidden", "true");
    for (var k = 0; k < l.length; k += 2) {
      var ln = document.createElementNS(SVGNS, "line");
      ln.setAttribute("x1", ox + xs[l[k]] * sc); ln.setAttribute("y1", oy + ys[l[k]] * sc);
      ln.setAttribute("x2", ox + xs[l[k + 1]] * sc); ln.setAttribute("y2", oy + ys[l[k + 1]] * sc);
      ln.setAttribute("stroke", "#cfd6e4"); ln.setAttribute("stroke-width", "1.6"); ln.setAttribute("stroke-linecap", "round");
      svg.appendChild(ln);
    }
    for (var j = 0; j < xs.length; j++) {
      var c = document.createElementNS(SVGNS, "circle");
      c.setAttribute("cx", ox + xs[j] * sc); c.setAttribute("cy", oy + ys[j] * sc); c.setAttribute("r", "2.6");
      c.setAttribute("fill", "#f4f6ff");
      svg.appendChild(c);
    }
    return svg;
  }
  function atlasDialog() {
    E.catchUp(live, nowMs());
    openDialog("atlas", function (d) {
      d.setAttribute("aria-label", t("ax.title"));
      d.appendChild(el("div", "dlg-title", t("ax.title")));
      var f = E.fieldOf(live);
      if (live.cs.length) {
        d.appendChild(el("div", "dlg-sub", t("ax.season")));
        var g0 = el("div", "ax-grid");
        live.cs.forEach(function (c) {
          var p = [], l = [];
          c.s.forEach(function (i) { p.push(f[i].x, f[i].y); });
          c.l.forEach(function (x) { l.push(c.s.indexOf(x[0]), c.s.indexOf(x[1])); });
          var it = el("div", "ax-item");
          it.appendChild(miniSvg(p, l));
          it.appendChild(el("span", "nm", consName(c)));
          g0.appendChild(it);
        });
        d.appendChild(g0);
      }
      d.appendChild(el("div", "dlg-sub", t("ax.title")));
      if (!live.ax.length) d.appendChild(el("p", "dlg-note", t("ax.none")));
      else {
        var g = el("div", "ax-grid");
        live.ax.slice().reverse().forEach(function (a) {
          var it = el("div", "ax-item");
          it.appendChild(miniSvg(a.p, a.l));
          it.appendChild(el("span", "nm", a.n || seededName(a.k)));
          it.appendChild(el("span", "fx", t("ax.item", { p: pct(a.b) })));
          g.appendChild(it);
        });
        d.appendChild(g);
        d.appendChild(el("p", "dlg-note", t("ax.bonus", { p: pct(E.atlasBonus(live)) })));
      }
      actions(d, [{ label: t("btn.close"), fn: closeDialog }]);
    });
  }
  function recDialog() {
    E.catchUp(live, nowMs());
    openDialog("rec", function (d) {
      d.setAttribute("aria-label", t("rec.title"));
      d.appendChild(el("div", "dlg-title", t("rec.title")));
      rowKV(d, t("rec.life"), fmt(live.life));
      rowKV(d, t("rec.season"), String(live.sn + 1));
      rowKV(d, t("rec.cs"), live.cs.length + " / " + E.SEASON_N);
      rowKV(d, t("rec.ax"), fmt(live.ax.length));
      var cnt = {};
      live.tr.forEach(function (x) { cnt[x] = (cnt[x] || 0) + 1; });
      rowKV(d, t("rec.traits"), Object.keys(cnt).map(function (x) { return t("tr." + x) + (cnt[x] > 1 ? " ×" + cnt[x] : ""); }).join(", ") || t("rec.none"));
      rowKV(d, t("rec.hours"), live.hc.map(function (h) { return fmt(h); }).join(" · "));
      rowKV(d, t("rec.acts"), fmt(live.acts));
      d.appendChild(el("div", "dlg-sub", t("rec.miles")));
      var ul = el("ul", "mi-list");
      E.MILES.forEach(function (m) {
        var on = E.bit(live, m), li = el("li", on ? "on" : "");
        li.appendChild(el("span", "mk", on ? "✓" : "·"));
        li.appendChild(document.createTextNode(t("mi." + m)));
        ul.appendChild(li);
      });
      d.appendChild(ul);
      [["rec.sfx", sfxOn, function (v) { if (v !== sfxOn()) toggleSfx(); }], ["rec.night", nightOn, setNight]].forEach(function (x) {
        var fl = el("label", "dlg-check");
        var cb = el("input");
        cb.type = "checkbox";
        cb.checked = x[1]();
        cb.addEventListener("change", function () { x[2](cb.checked); });
        fl.appendChild(cb);
        fl.appendChild(el("span", "", t(x[0])));
        d.appendChild(fl);
      });
      d.appendChild(el("p", "dlg-note", t("rec.note")));
      actions(d, [
        { label: t("btn.start"), cls: "danger", fn: askStart },
        { label: t("btn.close"), fn: closeDialog }
      ]);
    });
  }
  function askStart() {
    openDialog("confirm", function (d) {
      d.setAttribute("aria-label", t("btn.start"));
      d.appendChild(el("p", "dlg-msg", t("rec.startAsk")));
      actions(d, [
        { label: t("btn.cancel"), fn: closeDialog },
        { label: t("btn.startYes"), cls: "danger", fn: startOver }
      ]);
    });
  }
  function seasonDialog() {
    E.catchUp(live, nowMs());
    if (!E.canSeason(live)) { showToast(t("toast.noseason")); sfx("no"); return; }
    var off = E.offer(live), pickTr = off[0];
    openDialog("season", function (d) {
      d.setAttribute("aria-label", t("sn.title"));
      d.appendChild(el("div", "dlg-title", t("sn.title")));
      d.appendChild(el("p", "dlg-msg", t("sn.msg")));
      var fs = el("fieldset", "sw-group");
      fs.appendChild(el("legend", "", t("sn.trait")));
      off.forEach(function (id) {
        var lb = el("label", "sw-opt");
        var r = el("input");
        r.type = "radio"; r.name = "sn-tr"; r.value = id;
        r.checked = pickTr === id;
        r.addEventListener("change", function () { if (r.checked) pickTr = id; });
        lb.appendChild(r);
        var tx = el("span", "tx");
        tx.appendChild(el("span", "nm", t("tr." + id)));
        tx.appendChild(el("span", "fx", t("tr." + id + ".fx")));
        lb.appendChild(tx);
        fs.appendChild(lb);
      });
      d.appendChild(fs);
      d.appendChild(el("p", "dlg-note", t("sn.note")));
      actions(d, [
        { label: t("sn.later"), fn: closeDialog },
        { label: t("sn.go"), cls: "primary", fn: function () {
          var tr = pickTr;
          closeDialog();
          draft = { l: [], a: -1 }; selC = -1;
          doAct({ t: "season", tr: tr }, t("toast.season", { n: live.sn + 2 }));
        } }
      ]);
    });
  }
  function awayDialog(info) {
    openDialog("away", function (d) {
      d.setAttribute("aria-label", t("away.title"));
      d.appendChild(el("div", "dlg-title", t("away.title")));
      d.appendChild(el("div", "dlg-hero", t("away.hero", { n: fmt(info.made) })));
      rowKV(d, t("away.time"), fmtDur(info.ms));
      ["clear", "haze", "cloud"].forEach(function (w, i) {
        if (info.hc[i] >= 1) rowKV(d, t("away." + w), t("dur.h", { n: Math.round(info.hc[i]) }));
      });
      if (info.moons > 0) rowKV(d, t("away.moons"), String(info.moons));
      rowKV(d, t("away.sl"), fmt(live.sl));
      if (info.slowed) d.appendChild(el("p", "dlg-note", t("away.slow")));
      actions(d, [{ label: t("btn.ok"), cls: "primary", fn: closeDialog }]);
    });
    live_(t("away.title") + ": " + t("away.hero", { n: fmt(info.made) }));
  }
  function tourDialog() {
    openDialog("tour", function (d) {
      d.setAttribute("aria-label", t("tour.title"));
      d.appendChild(el("div", "dlg-title", t("tour.title")));
      ["tour.1", "tour.2", "tour.3", "tour.4"].forEach(function (k) { d.appendChild(el("p", "dlg-msg", t(k))); });
      actions(d, [{ label: t("btn.ok"), cls: "primary", fn: function () { prefs.tour = 1; savePrefs(); closeDialog(); } }]);
    });
  }

  // ---------- 9. Toasts ----------
  var toastTimer = null;
  function showToast(text, withUndo) {
    if (!withUndo) {
      try {
        var n = (window.parent && window.parent.orosNotifs) || window.orosNotifs;
        if (n && typeof n.transient === "function" && n.transient({ ns: "starchart", title: String(text) })) return;
      } catch (e) {}
    }
    var box = $("toast");
    box.textContent = "";
    box.appendChild(el("span", "", text));
    if (withUndo && undo) {
      var b = el("button", "", t("btn.undo"));
      b.type = "button";
      b.addEventListener("click", undoLast);
      box.appendChild(b);
    }
    box.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(hideToast, withUndo ? UNDO_MS : 3000);
    live_(text);
  }
  function hideToast() {
    clearTimeout(toastTimer);
    var box = $("toast");
    if (box) box.classList.remove("show");
    undo = null;
  }
  function live_(text) { var l = $("live"); if (l) l.textContent = text; }

  // ---------- 10. Sound ----------
  var audio = null;
  function sfxOn() {
    try { return localStorage.getItem(SFX_KEY) === "1"; } catch (e) { return false; }
  }
  function ac() {
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    if (!audio) audio = new AC();
    if (audio.state === "suspended") audio.resume();
    return audio;
  }
  function tone(freq, start, dur, type, vol) {
    var t0 = audio.currentTime + start;
    var o = audio.createOscillator(), g = audio.createGain();
    o.type = type || "sine";
    o.frequency.setValueAtTime(freq, t0);
    g.gain.setValueAtTime(vol || 0.12, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g); g.connect(audio.destination);
    o.start(t0); o.stop(t0 + dur + 0.02);
  }
  var HAPTIC = { up: "good", name: "good", season: "good", no: "bad", line: "tap" };
  function sfx(kind) {
    if (window.orosHaptics && HAPTIC[kind]) window.orosHaptics.cue(HAPTIC[kind]);
    if (!sfxOn()) return;
    try {
      if (!ac()) return;
      if (kind === "up") { tone(523, 0, 0.1, "triangle", 0.07); tone(659, 0.07, 0.12, "triangle", 0.06); }
      else if (kind === "line") { tone(1568, 0, 0.25, "sine", 0.05); tone(2093, 0.02, 0.3, "sine", 0.03); }
      else if (kind === "pick") tone(1175, 0, 0.12, "sine", 0.04);
      else if (kind === "name") [523, 659, 784, 1047].forEach(function (f, k) { tone(f, k * 0.05, 0.6, "sine", 0.05); });
      else if (kind === "season") [392, 523, 659, 784, 1047].forEach(function (f, k) { tone(f, k * 0.1, 0.5, "triangle", 0.06); });
      else if (kind === "undo") { tone(659, 0, 0.08, "sine", 0.06); tone(523, 0.06, 0.1, "sine", 0.05); }
      else if (kind === "no") tone(180, 0, 0.14, "sawtooth", 0.04);
      else if (kind === "toggle") { tone(1047, 0, 0.05, "sine", 0.08); tone(1319, 0.04, 0.07, "sine", 0.07); }
    } catch (e) { /* no audio → silent */ }
  }
  // The night: off by default; soft wind (filtered noise) and a far
  // cricket now and then.
  var night = null, chirpAt = 0;
  function nightOn() {
    try { return localStorage.getItem(NIGHT_KEY) === "1"; } catch (e) { return false; }
  }
  function setNight(on) {
    try { localStorage.setItem(NIGHT_KEY, on ? "1" : "0"); } catch (e) {}
    updateNight();
  }
  function updateNight() {
    var want = nightOn() && live && !document.hidden ? 0.02 : 0;
    if (!want && !night) return;
    try {
      if (!ac()) return;
      if (!night) {
        var len = audio.sampleRate * 2, buf = audio.createBuffer(1, len, audio.sampleRate), data = buf.getChannelData(0);
        var last = 0;
        for (var i = 0; i < len; i++) { last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02; data[i] = last * 3.5; }
        var src = audio.createBufferSource();
        src.buffer = buf; src.loop = true;
        var lp = audio.createBiquadFilter(), g = audio.createGain();
        lp.type = "lowpass"; lp.frequency.value = 420;
        g.gain.value = 0;
        src.connect(lp); lp.connect(g); g.connect(audio.destination);
        src.start();
        night = { g: g, src: src };
      }
      night.g.gain.setTargetAtTime(want, audio.currentTime, 1.5);
      if (want && Date.now() - chirpAt > 9000 + Math.random() * 9000) {
        chirpAt = Date.now();
        for (var k = 0; k < 3; k++) tone(4200, k * 0.09, 0.05, "sine", 0.006);
      }
      if (!want) {
        var s = night;
        night = null;
        setTimeout(function () { try { s.src.stop(); } catch (e) {} }, 5000);
      }
    } catch (e) { /* no audio → silent */ }
  }
  function toggleSfx() {
    try { localStorage.setItem(SFX_KEY, sfxOn() ? "0" : "1"); } catch (e) {}
    paintSfxBtn();
    sfx("toggle");
  }

  // ---------- Icons (R9: icon buttons ship empty, filled here) ----------
  var SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">';
  var ICONS = {
    scope:  SVG + '<path d="M4 15l12-7 2 3.5-12 7z"/><path d="M16 8l2-1 2 3.5-2 1"/><path d="M9 17l-3 5M11 16l3 6"/></svg>',
    atlas:  SVG + '<path d="M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2z"/><path d="M4 19V5"/><path d="M9 8l3 3 3-2"/><circle cx="9" cy="8" r="0.6"/><circle cx="12" cy="11" r="0.6"/><circle cx="15" cy="9" r="0.6"/></svg>',
    stats:  SVG + '<path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0z"/><path d="M17 5h3v2a3 3 0 0 1-3 3M7 5H4v2a3 3 0 0 0 3 3"/></svg>',
    sfxOn:  SVG + '<path d="M11 5 6 9H2v6h4l5 4z"/><path d="M15.5 8.5a5 5 0 0 1 0 7M19 5a10 10 0 0 1 0 14"/></svg>',
    sfxOff: SVG + '<path d="M11 5 6 9H2v6h4l5 4z"/><path d="M22 9l-6 6M16 9l6 6"/></svg>',
    sl:     SVG + '<path d="M12 3l1.8 5.4L19 10l-5.2 1.6L12 17l-1.8-5.4L5 10l5.2-1.6z"/></svg>',
    cs:     SVG + '<circle cx="5" cy="17" r="1.5"/><circle cx="10" cy="8" r="1.5"/><circle cx="17" cy="12" r="1.5"/><circle cx="19" cy="4" r="1.5"/><path d="M6 15.7 9.3 9.4M11.4 8.7l4.3 2.6M17.6 10.6l1-5"/></svg>',
    moon:   SVG + '<path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"/></svg>',
    season: SVG + '<path d="M12 3v3M12 18v3M3 12h3M18 12h3"/><circle cx="12" cy="12" r="4"/><path d="M5.6 5.6l2 2M16.4 16.4l2 2M5.6 18.4l2-2M16.4 7.6l2-2"/></svg>',
    clear:  SVG + '<path d="M12 4l1.4 4.2L18 10l-4.6 1.4L12 16l-1.4-4.6L6 10l4.6-1.8z"/><path d="M19 17l.6 1.4L21 19l-1.4.6L19 21l-.6-1.4L17 19l1.4-.6z"/></svg>',
    haze:   SVG + '<path d="M4 10h16M3 14h18M6 18h12"/><path d="M12 3l.8 2.2L15 6l-2.2.8L12 9l-.8-2.2L9 6l2.2-.8z"/></svg>',
    cloud:  SVG + '<path d="M7 18a4 4 0 0 1 0-8 5 5 0 0 1 9.5-1.5A3.5 3.5 0 1 1 17 18z"/></svg>'
  };
  function paintSfxBtn() {
    var b = $("sfx-btn"), on = sfxOn();
    b.innerHTML = on ? ICONS.sfxOn : ICONS.sfxOff;
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
    fcKey = "";
    if (live) { renderFc(); draw(); }
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
    api.registerSlice("starchart", sliceGet, sliceSet, STORAGE_KEY, mergeSky);
  }
  function mergeSky(a, b) { return E.merge(a, b); }
  // The sky as written, never the ticking one (R26).
  function sliceGet() { return stored ? E.normalize(saved) : null; }
  function sliceSet(incoming) {
    var inc = E.normalize(incoming);
    if (!inc) return;
    window.__orosSyncApi._suppress = true;   // R6: a pull never marks dirty
    try {
      if (pending) { clearTimeout(pending.timer); pending = null; E.catchUp(live, nowMs()); saved = E.normalize(live); stored = true; setTimeout(dirtySoon, 0); }
      var m = E.merge(stored ? saved : null, inc);
      if (stored && JSON.stringify(m) === JSON.stringify(saved)) return;
      saved = m;
      writeSaved();
      live = E.clone(m);
      E.catchUp(live, nowMs());
      undo = null;
      hideToast();
      checkDraft();
      renderAll(true);
    } catch (e) {
    } finally {
      window.__orosSyncApi._suppress = false;
    }
  }

  // ---------- 12. Test hooks, wiring & boot ----------
  // render_game_to_text: the visible state as JSON. The sky is a grid
  // of 12 × 9 points; stars carry their canvas centre (x, y in CSS px).
  window.render_game_to_text = function () {
    if (!live) return "{}";
    var r = E.rates(live, nowMs()), f = E.fieldOf(live), used = E.usedStars(live, -1);
    return JSON.stringify({
      mode: dlgKind || "play", season: live.sn + 1, sl: Math.floor(live.sl), perMin: Math.round(r.now * 100) / 100,
      sky: r.sky, moon: Math.round(r.moon * 100) / 100, reach: E.reach(live), canSeason: E.canSeason(live), offer: E.offer(live),
      traits: live.tr, atlas: live.ax.length, lv: live.lv, sel: selC, anchor: draft.a, draft: draft.l,
      draftErr: draft.l.length ? E.drawErr(live, draft.l) : "", lineCost: Math.ceil(E.linesCost(live, Math.max(1, draft.l.length))),
      cs: live.cs.map(function (c) { var w = E.worth(live, c.l); return { name: consName(c), shape: w.shape, stars: c.s }; }),
      stars: f.map(function (st, i) { var p = px(st); return { i: i, gx: st.x, gy: st.y, x: Math.round(p.x), y: Math.round(p.y), k: st.k, b: st.b, c: used[i] === undefined ? -1 : used[i] }; }),
      note: "tap a star (x, y) then another to draw a line; N names the drawing"
    });
  };
  window.advanceTime = function (ms) {
    clockOff += Math.max(0, +ms || 0);
    tick();
  };

  function applyI18n() {
    [].forEach.call(document.querySelectorAll("[data-i18n]"), function (n) {
      n.textContent = t(n.getAttribute("data-i18n"));
    });
    canvas.setAttribute("aria-label", t("view.label"));
    var sb = $("season-btn");
    sb.querySelector(".ic").innerHTML = ICONS.season;
    sb.title = t("btn.seasonKey");
    var ob = $("obs-btn");
    ob.querySelector(".ic").innerHTML = ICONS.scope;
    ob.title = t("btn.obsKey");
    [["atlas-btn", "atlas", "btn.atlas"], ["stats-btn", "stats", "btn.stats"]].forEach(function (x) {
      var b = $(x[0]);
      b.innerHTML = ICONS[x[1]];
      b.setAttribute("aria-label", t(x[2]));
      b.title = t(x[2]);
    });
    [["s-sl", "sl"], ["s-cs", "cs"], ["s-moon", "moon"], ["s-sky", "clear"]].forEach(function (x) {
      $(x[0]).querySelector(".ic").innerHTML = ICONS[x[1]];
    });
    paintSfxBtn();
  }
  function wire() {
    $("obs-btn").addEventListener("click", obsDialog);
    $("season-btn").addEventListener("click", seasonDialog);
    $("atlas-btn").addEventListener("click", atlasDialog);
    $("stats-btn").addEventListener("click", recDialog);
    $("sfx-btn").addEventListener("click", toggleSfx);
    $("fc").addEventListener("click", fcDialog);
    document.addEventListener("pointerdown", function () { if (nightOn()) updateNight(); }, { once: true });
    $("dlg").addEventListener("close", function () { dlgKind = ""; });
    $("dlg").addEventListener("cancel", function () {
      if (dlgKind === "tour") { prefs.tour = 1; savePrefs(); }
    });
    wireInput();
    wireKeyboard();
    window.addEventListener("resize", resize);
    if (window.ResizeObserver) new ResizeObserver(resize).observe($("scene"));
    document.addEventListener("visibilitychange", function () {
      if (document.hidden) { flushOut(); stopAnim(); updateNight(); }
      else { onReturn(); startAnim(); }
    });
    window.addEventListener("pagehide", flushOut);
    try {
      var mq = window.matchMedia("(prefers-reduced-motion: reduce)");
      reduced = mq.matches;
      var onMq = function () { reduced = mq.matches; if (reduced) stopAnim(); else startAnim(); };
      if (mq.addEventListener) mq.addEventListener("change", onMq); else if (mq.addListener) mq.addListener(onMq);
    } catch (e) {}
  }
  // Coming back to the page: the away card when the sky moved on.
  function onReturn() {
    if (!live) return;
    var before = { life: prefs.seenLife, seen: prefs.seen, hc: [prefs.seenHc0, prefs.seenHc1, prefs.seenHc2] };
    var out = E.catchUp(live, nowMs());
    if (out.dt > CHECKPOINT || out.slowed) checkpoint();
    var away = nowMs() - before.seen;
    if (before.seen && away >= AWAY_MS && !$("dlg").open) {
      awayDialog({ made: Math.max(0, live.life - before.life), ms: away, slowed: away > E.FULL_MS,
                   hc: live.hc.map(function (h, i) { return Math.max(0, h - before.hc[i]); }),
                   moons: Math.max(0, Math.floor((nowMs() - E.NEW_MOON) / E.SYNODIC) - Math.floor((before.seen - E.NEW_MOON) / E.SYNODIC)) });
    }
    seenNow();
    savePrefs();
    renderAll(true);
  }

  function boot() {
    canvas = $("view");
    ctx = canvas.getContext("2d");
    load();
    applyI18n();
    wire();
    registerSync();
    inheritPalette();
    watchPalette();
    live = E.clone(saved);
    resize();
    onReturn();
    if (!prefs.tour && !$("dlg").open) tourDialog();
    setInterval(tick, 1000);
    setInterval(function () {
      if (document.hidden || !live) return;
      seenNow();
      savePrefs();
    }, 60000);
    startAnim();
  }

  boot();
})();
