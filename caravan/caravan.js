// ============================================================
// orOS Caravan — App logic (v1.0.0)
// A reverse tower defense game: old clockwork toll machines guard the
// road to the market and the player leads a caravan of carts through
// them. Before every trip: hire and upgrade carts, put them in order,
// set the fork signs. On the road the carts roll by themselves; the
// player flips signs (each cart follows the sign as it is when it gets
// there) and uses the tricks: smoke, a shield, the goat track. Real
// time with pause (1x / 2x / 3x). The rules live in caravan/engine.js
// (CaravanEngine, tested headless); this file is the screen, the saves
// and the clock.
// Data:
//   - synced slice "caravan" (oros-caravan-data): best stars per route
//     and per-device counter rows (CaravanEngine.merge, a join).
//     Written only when a route ends or progress is reset.
//   - device-local (R10): oros-caravan-session ({g: the route in
//     progress, ck: the route before its last departure, counted},
//     saved at every departure, after every change and on the way out;
//     read by gamekit/resume.js), oros-caravan-prefs (difficulty, tour,
//     last route), oros-caravan-device, oros-caravan-sfx.
// Sections:
//   1. Constants, i18n, helpers
//   2. Saves (progress, prefs, session)
//   3. The route: start, plan, road, ending
//   4. Loop (real time, speed, pause)
//   5. Scene (the road on one canvas)
//   6. Input (taps, keyboard)
//   7. Toolbar + bottom bar
//   8. Road map
//   9. Dialogs (end of route, tricks, how to play, confirm)
//  10. Toasts + live region
//  11. Sound
//  12. Sync slice + palette
//  13. Test hooks, wiring & boot
// ============================================================
(function () {
  "use strict";

  var E = window.CaravanEngine;

  var STORAGE_KEY = "oros-caravan-data";
  var PREFS_KEY   = "oros-caravan-prefs";
  var SESSION_KEY = "oros-caravan-session";
  var DEVICE_KEY  = "oros-caravan-device";
  var SFX_KEY     = "oros-caravan-sfx";
  var SAVE_MS     = 600;                 // a plan change is saved this long after
  var RUN_SAVE_MS = 5000;                // and on the road, this often
  var SPEEDS      = [1, 2, 3];
  var TRICKS      = ["s", "w", "c"];     // smoke, shield, shortcut

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
      "app.name": "Caravan",
      "btn.map": "Road map (L)", "btn.help": "How to play (?)",
      "btn.sfxOn": "Sound on (M)", "btn.sfxOff": "Sound off (M)",
      "btn.pause": "Pause (Space)", "btn.play": "Play (Space)", "btn.speed": "Speed {n}x (F)",
      "btn.go": "Set off", "btn.goKey": "Set off on trip {n} (N)", "btn.road": "On the road",
      "btn.over": "The route is over", "btn.ok": "Good", "btn.cancel": "Cancel", "btn.close": "Close",
      "btn.again": "Try again from trip {n}", "btn.restart": "Play the route again", "btn.nextRt": "Next route",
      "btn.toMap": "Road map", "btn.reset": "Reset progress", "btn.resetYes": "Reset",
      "view.label": "The road from the village gate to the market, the toll machines beside it and the fork signs. Tap a sign to turn it.",
      "st.goods": "Crates at the market", "st.goodsOf": "Crates at the market: {n} of {m}", "st.coins": "Coins",
      "st.trip": "Trip {n} of {m}", "st.tripShort": "{n}/{m}",
      "diff.m": "Mild", "diff.n": "Normal", "diff.h": "Hard",
      "ct.mule": "Mule cart", "ct.pony": "Pony cart", "ct.mender": "Mender's cart", "ct.straw": "Straw cart",
      "ct.mule.a": "Ox wagon", "ct.mule.b": "Iron rims", "ct.pony.a": "Courier", "ct.pony.b": "Saddlebags",
      "ct.mender.a": "Wide reach", "ct.mender.b": "Quick hands", "ct.straw.a": "Wet straw", "ct.straw.b": "Scarecrow",
      "ct.smith": "Smith's cart", "ct.smith.a": "Long jam", "ct.smith.b": "Quick hammer",
      "fx.smith": "Jams the nearest machine it passes for a few seconds, then rests.",
      "fx.smith.a": "Jams twice as long.", "fx.smith.b": "Reaches farther and rests half as long.",
      "fx.mule": "Sturdy and slow: every knock takes a quarter less.",
      "fx.pony": "Fast and small: through the machines before they swing twice.",
      "fx.mender": "Ties fallen crates back on the carts close to it.",
      "fx.straw": "A decoy with no goods: every machine aims at it first. Burnt through, it is gone.",
      "fx.mule.a": "A big wagon: many more crates, even slower.", "fx.mule.b": "Knocks take half.",
      "fx.pony.a": "Even faster.", "fx.pony.b": "Carries almost twice as much.",
      "fx.mender.a": "Mends carts much farther off.", "fx.mender.b": "Mends twice as fast.",
      "fx.straw.a": "Twice the straw: lasts much longer.", "fx.straw.b": "A machine that hits it stops for two seconds.",
      "mc.arm": "Toll arm", "mc.bellows": "Dust bellows", "mc.mud": "Mud wheel", "mc.look": "Lookout",
      "mfx.arm": "Swings now and then and knocks a crate off the first cart in reach.",
      "mfx.bellows": "Every three seconds a cloud of dust: a crate off every cart close together.",
      "mfx.mud": "Does not knock: carts in reach go at half speed.",
      "mfx.look": "Machines near it work half as fast again and see through smoke.",
      "tk.s": "Smoke", "tk.w": "Shield", "tk.c": "Shortcut",
      "tkfx.s": "A cloud for five seconds: machines in it cannot work, carts in it cannot be aimed at.",
      "tkfx.w": "The cart you tap takes nothing for six seconds.",
      "tkfx.c": "Opens the goat track for this trip; the signs turn to it.",
      "tk.armS": "Tap the spot for the smoke.", "tk.armW": "Tap a cart on the road (or its button below) for the shield.",
      "tk.none": "None left", "tk.buy": "One more {t}", "tk.title": "Tricks", "tk.left": "{n} left",
      "tk.note": "One of each comes back on every trip. Extra ones cost {c} coins and keep until used.",
      "tk.open": "Open the goat track now", "tk.isOpen": "The goat track is open on this trip.",
      "act.hire": "Hire", "act.up": "Upgrade", "act.sell": "Sell", "act.fwd": "Forward", "act.back": "Back",
      "act.locked": "Route {n}", "act.max": "Top level", "act.full": "The caravan is full ({n} carts)",
      "act.tricks": "Tricks",
      "cart.info": "<strong>{t}</strong> · level {l} · {cap} · {fx}", "cart.crates": "{n} crates", "cart.straw": "{n} straw",
      "cart.sell": "Sell for {n}", "cart.pos": "Place {n} of {m}",
      "cart.st.q": "waiting", "cart.st.r": "on the road", "cart.st.d": "at the market", "cart.st.h": "walked home", "cart.st.x": "burnt",
      "why.coins": "Not enough coins", "why.locked": "{t} can be hired from route {n}", "why.empty": "Hire at least one cart first.",
      "ctx.plan": "Hire carts, put them in order and set the signs, then set off.",
      "ctx.two": "Two markets: the spice market (right) pays {n} coins a crate, the market (left) {m}.",
      "ctx.new": "Trip {n}: the toll keepers wound up {m} more machines (ringed).",
      "ctx.road": "Tap a sign to turn it for the carts still to come.",
      "map.intro": "Lead the caravan from the village to the market, three trips a route. The machines beside the road knock crates off; bring enough crates through to clear the route and open the next.",
      "map.diff": "Difficulty", "map.road": "The Salt road", "map.road2": "The Spice road",
      "map.two": "the spice market pays {n} a crate", "map.lock": "Clear the route before it to open",
      "map.goal": "Goal {n} crates in {m} trips", "map.carts": "Carts: {list}",
      "map.cont": "Continue: {r}, trip {n}",
      "map.replace": "A route is still under way: {r}. Start {s} instead? The route under way is given up.",
      "map.resetAsk": "Reset the stars and records on every device?",
      "rt.r1": "Olive hills", "rt.r2": "Dry riverbed", "rt.r3": "Windy pass", "rt.r4": "Old customs house",
      "rt.r5": "Cedar ford", "rt.r6": "Date palms", "rt.r7": "Saffron hills", "rt.r8": "The silk gate",
      "end.won": "The market is stocked", "end.lost": "Not enough crates reached the market",
      "end.goods": "Crates at the market", "end.share": "Of the crates loaded", "end.trips": "Trips",
      "end.wonNote": "Three stars when nearly nine in ten of the crates you loaded reach the market.",
      "end.lostNote": "Try the last trip again, with the caravan and coins you had before it.",
      "end.unlock": "{t} can now be hired.",
      "tour.title": "How to play",
      "tour.1": "Carts roll from the village gate (top) to the market (bottom). Toll machines beside the road knock crates off the carts in their reach (the red rings).",
      "tour.2": "Before each trip hire carts in the bar below and put them in order. Tap a cart to move it, upgrade it or sell it. Carts never overtake, so a fast pony behind a mule waits.",
      "tour.3": "At every fork a sign shows the way. Tap it to turn it, also on the road: each cart follows the sign as it is when it gets there, so you can split the caravan.",
      "tour.4": "On the road use the tricks: smoke stops the machines in it, the shield keeps one cart safe for a while, the shortcut opens the goat track.",
      "tour.5": "Three trips a route. Bring the goal in crates to the market over the three trips; every crate pays two coins for the next trip.",
      "toast.save": "Not saved: the browser's storage is full",
      "toast.reset": "Progress reset",
      "live.off": "Trip {n} of {m}: the caravan sets off.", "live.trip": "Trip {n}: {g} crates reached the market, +{c} coins.",
      "live.back": "{t} lost all its crates and walks home.", "live.burnt": "The straw cart burnt through.",
      "live.jam": "{t} jammed the {m}.",
      "live.sign": "The sign at the fork points {d}.", "live.dir.l": "left", "live.dir.r": "right", "live.dir.s": "straight on",
      "live.dir.g": "to the goat track",
      "live.sel": "{t}, place {n} of {m}, {s}.",
      "live.status": "{g} of {m} crates at the market, {c} coins, trip {n} of {k}."
    },
    el: {
      "app.name": "Καραβάνι",
      "btn.map": "Χάρτης των δρόμων (L)", "btn.help": "Πώς παίζεται (?)",
      "btn.sfxOn": "Ήχος ανοιχτός (M)", "btn.sfxOff": "Ήχος κλειστός (M)",
      "btn.pause": "Παύση (Space)", "btn.play": "Συνέχεια (Space)", "btn.speed": "Ταχύτητα {n}x (F)",
      "btn.go": "Ξεκίνα", "btn.goKey": "Ξεκίνα το ταξίδι {n} (N)", "btn.road": "Στον δρόμο",
      "btn.over": "Η διαδρομή τελείωσε", "btn.ok": "Ωραία", "btn.cancel": "Άκυρο", "btn.close": "Κλείσιμο",
      "btn.again": "Ξανά από το ταξίδι {n}", "btn.restart": "Ξανά όλη η διαδρομή", "btn.nextRt": "Επόμενη διαδρομή",
      "btn.toMap": "Χάρτης των δρόμων", "btn.reset": "Μηδενισμός προόδου", "btn.resetYes": "Μηδενισμός",
      "view.label": "Ο δρόμος από την πύλη του χωριού ως την αγορά, οι μηχανές των διοδίων δίπλα του και οι πινακίδες στις διχάλες. Πάτα μια πινακίδα για να τη γυρίσεις.",
      "st.goods": "Κιβώτια στην αγορά", "st.goodsOf": "Κιβώτια στην αγορά: {n} από {m}", "st.coins": "Νομίσματα",
      "st.trip": "Ταξίδι {n} από {m}", "st.tripShort": "{n}/{m}",
      "diff.m": "Ήπιο", "diff.n": "Κανονικό", "diff.h": "Δύσκολο",
      "ct.mule": "Κάρο με μουλάρι", "ct.pony": "Κάρο με αλογάκι", "ct.mender": "Κάρο του μάστορα", "ct.straw": "Κάρο με άχυρα",
      "ct.mule.a": "Βοϊδάμαξα", "ct.mule.b": "Σιδερένιες ρόδες", "ct.pony.a": "Ταχυδρόμος", "ct.pony.b": "Δισάκια",
      "ct.mender.a": "Μακρύ χέρι", "ct.mender.b": "Γρήγορα χέρια", "ct.straw.a": "Βρεγμένα άχυρα", "ct.straw.b": "Σκιάχτρο",
      "ct.smith": "Κάρο του σιδερά", "ct.smith.a": "Γερή σφήνα", "ct.smith.b": "Γρήγορο σφυρί",
      "fx.smith": "Σφηνώνει για λίγα δευτερόλεπτα την πιο κοντινή μηχανή που προσπερνά και μετά ξαποσταίνει.",
      "fx.smith.a": "Σφηνώνει για διπλάσια ώρα.", "fx.smith.b": "Φτάνει πιο μακριά και ξαποσταίνει τη μισή ώρα.",
      "fx.mule": "Γερό και αργό: κάθε χτύπημα παίρνει ένα τέταρτο λιγότερο.",
      "fx.pony": "Γρήγορο και μικρό: περνά τις μηχανές πριν χτυπήσουν δεύτερη φορά.",
      "fx.mender": "Ξαναδένει πάνω στα κοντινά κάρα τα κιβώτια που έπεσαν.",
      "fx.straw": "Δόλωμα χωρίς πραμάτεια: κάθε μηχανή σημαδεύει πρώτα αυτό. Όταν καεί, χάνεται.",
      "fx.mule.a": "Μεγάλη άμαξα: πολύ περισσότερα κιβώτια, ακόμα πιο αργή.", "fx.mule.b": "Τα χτυπήματα παίρνουν τα μισά.",
      "fx.pony.a": "Ακόμα πιο γρήγορο.", "fx.pony.b": "Κουβαλά σχεδόν τα διπλά.",
      "fx.mender.a": "Μαστορεύει κάρα πολύ πιο μακριά.", "fx.mender.b": "Μαστορεύει δύο φορές πιο γρήγορα.",
      "fx.straw.a": "Διπλά άχυρα: αντέχει πολύ περισσότερο.", "fx.straw.b": "Η μηχανή που το χτυπά σταματά για δύο δευτερόλεπτα.",
      "mc.arm": "Μπάρα των διοδίων", "mc.bellows": "Φυσερό της σκόνης", "mc.mud": "Τροχός της λάσπης", "mc.look": "Βίγλα",
      "mfx.arm": "Χτυπά κάθε τόσο και ρίχνει ένα κιβώτιο από το πρώτο κάρο κοντά της.",
      "mfx.bellows": "Κάθε τρία δευτερόλεπτα ένα σύννεφο σκόνης: ένα κιβώτιο από κάθε κάρο που είναι κοντά-κοντά.",
      "mfx.mud": "Δεν χτυπά: τα κάρα κοντά του πάνε με τη μισή ταχύτητα.",
      "mfx.look": "Οι μηχανές κοντά της δουλεύουν μιάμιση φορά πιο γρήγορα και βλέπουν μέσα από τον καπνό.",
      "tk.s": "Καπνός", "tk.w": "Ασπίδα", "tk.c": "Μονοπάτι",
      "tkfx.s": "Ένα σύννεφο για πέντε δευτερόλεπτα: οι μηχανές μέσα του δεν δουλεύουν και δεν σημαδεύουν τα κάρα μέσα του.",
      "tkfx.w": "Το κάρο που θα πατήσεις δεν παθαίνει τίποτα για έξι δευτερόλεπτα.",
      "tkfx.c": "Ανοίγει το κατσικομονοπάτι γι' αυτό το ταξίδι· οι πινακίδες γυρίζουν προς τα εκεί.",
      "tk.armS": "Πάτα το σημείο για τον καπνό.", "tk.armW": "Πάτα ένα κάρο στον δρόμο (ή το κουμπί του από κάτω) για την ασπίδα.",
      "tk.none": "Δεν έμεινε κανένα", "tk.buy": "Ακόμα ένα: {t}", "tk.title": "Κόλπα", "tk.left": "Έμειναν {n}",
      "tk.note": "Ένα από το καθένα ξαναγυρίζει σε κάθε ταξίδι. Τα επιπλέον κοστίζουν {c} νομίσματα και μένουν ώσπου να τα χρησιμοποιήσεις.",
      "tk.open": "Άνοιξε τώρα το κατσικομονοπάτι", "tk.isOpen": "Το κατσικομονοπάτι είναι ανοιχτό σ' αυτό το ταξίδι.",
      "act.hire": "Νοίκιασε", "act.up": "Αναβάθμιση", "act.sell": "Πούλα", "act.fwd": "Μπροστά", "act.back": "Πίσω",
      "act.locked": "Διαδρομή {n}", "act.max": "Τελευταίο επίπεδο", "act.full": "Το καραβάνι γέμισε ({n} κάρα)",
      "act.tricks": "Κόλπα",
      "cart.info": "<strong>{t}</strong> · επίπεδο {l} · {cap} · {fx}", "cart.crates": "{n} κιβώτια", "cart.straw": "{n} άχυρα",
      "cart.sell": "Πούλα για {n}", "cart.pos": "Θέση {n} από {m}",
      "cart.st.q": "περιμένει", "cart.st.r": "στον δρόμο", "cart.st.d": "στην αγορά", "cart.st.h": "γύρισε πίσω", "cart.st.x": "κάηκε",
      "why.coins": "Δεν φτάνουν τα νομίσματα", "why.locked": "{t}: το νοικιάζεις από τη διαδρομή {n}", "why.empty": "Νοίκιασε πρώτα τουλάχιστον ένα κάρο.",
      "ctx.plan": "Νοίκιασε κάρα, βάλ' τα σε σειρά και γύρνα τις πινακίδες, μετά ξεκίνα.",
      "ctx.two": "Δύο αγορές: η αγορά των μπαχαρικών (δεξιά) πληρώνει {n} νομίσματα το κιβώτιο, η αγορά (αριστερά) {m}.",
      "ctx.new": "Ταξίδι {n}: οι διοδιάρηδες κούρδισαν ακόμα {m} μηχανές (με κύκλο).",
      "ctx.road": "Πάτα μια πινακίδα για να τη γυρίσεις για τα κάρα που έρχονται.",
      "map.intro": "Οδήγησε το καραβάνι από το χωριό ως την αγορά, τρία ταξίδια σε κάθε διαδρομή. Οι μηχανές δίπλα στον δρόμο ρίχνουν κιβώτια· φέρε αρκετά κιβώτια για να περάσεις τη διαδρομή και να ανοίξει η επόμενη.",
      "map.diff": "Δυσκολία", "map.road": "Ο δρόμος του αλατιού", "map.road2": "Ο δρόμος των μπαχαρικών",
      "map.two": "η αγορά των μπαχαρικών πληρώνει {n} το κιβώτιο", "map.lock": "Πέρασε πρώτα την προηγούμενη διαδρομή",
      "map.goal": "Στόχος {n} κιβώτια σε {m} ταξίδια", "map.carts": "Κάρα: {list}",
      "map.cont": "Συνέχεια: {r}, ταξίδι {n}",
      "map.replace": "Μια διαδρομή είναι ακόμα σε εξέλιξη: «{r}». Να ξεκινήσει η «{s}»; Η διαδρομή σε εξέλιξη χάνεται.",
      "map.resetAsk": "Να μηδενιστούν τα αστέρια και το αρχείο σε όλες τις συσκευές;",
      "rt.r1": "Οι λόφοι με τις ελιές", "rt.r2": "Η ξερή κοίτη", "rt.r3": "Το φαράγγι του αέρα", "rt.r4": "Το παλιό τελωνείο",
      "rt.r5": "Το πέρασμα με τους κέδρους", "rt.r6": "Οι χουρμαδιές", "rt.r7": "Οι λόφοι του κρόκου", "rt.r8": "Η πύλη του μεταξιού",
      "end.won": "Η αγορά γέμισε πραμάτεια", "end.lost": "Δεν έφτασαν αρκετά κιβώτια στην αγορά",
      "end.goods": "Κιβώτια στην αγορά", "end.share": "Από όσα φορτώθηκαν", "end.trips": "Ταξίδια",
      "end.wonNote": "Τρία αστέρια όταν φτάνουν στην αγορά σχεδόν τα εννιά στα δέκα κιβώτια που φόρτωσες.",
      "end.lostNote": "Δοκίμασε ξανά το τελευταίο ταξίδι, με το καραβάνι και τα νομίσματα που είχες πριν από αυτό.",
      "end.unlock": "Τώρα μπορείς να νοικιάσεις: {t}.",
      "tour.title": "Πώς παίζεται",
      "tour.1": "Τα κάρα κατεβαίνουν από την πύλη του χωριού (πάνω) ως την αγορά (κάτω). Οι μηχανές των διοδίων δίπλα στον δρόμο ρίχνουν κιβώτια από τα κάρα που φτάνουν (οι κόκκινοι κύκλοι).",
      "tour.2": "Πριν από κάθε ταξίδι νοίκιασε κάρα στη μπάρα από κάτω και βάλ' τα σε σειρά. Πάτα ένα κάρο για να το μετακινήσεις, να το αναβαθμίσεις ή να το πουλήσεις. Τα κάρα δεν προσπερνούν ποτέ, οπότε ένα γρήγορο αλογάκι πίσω από μουλάρι περιμένει.",
      "tour.3": "Σε κάθε διχάλα μια πινακίδα δείχνει τον δρόμο. Πάτα την για να τη γυρίσεις, και πάνω στο ταξίδι: κάθε κάρο ακολουθεί την πινακίδα όπως είναι τη στιγμή που φτάνει, οπότε μπορείς να χωρίσεις το καραβάνι.",
      "tour.4": "Στον δρόμο χρησιμοποίησε τα κόλπα: ο καπνός σταματά τις μηχανές μέσα του, η ασπίδα φυλάει ένα κάρο για λίγο, το μονοπάτι ανοίγει το κατσικομονοπάτι.",
      "tour.5": "Τρία ταξίδια σε κάθε διαδρομή. Φέρε στην αγορά τα κιβώτια του στόχου μέσα στα τρία ταξίδια· κάθε κιβώτιο πληρώνει δύο νομίσματα για το επόμενο ταξίδι.",
      "toast.save": "Δεν αποθηκεύτηκε: ο χώρος του προγράμματος περιήγησης γέμισε",
      "toast.reset": "Η πρόοδος μηδενίστηκε",
      "live.off": "Ταξίδι {n} από {m}: το καραβάνι ξεκινά.", "live.trip": "Ταξίδι {n}: έφτασαν {g} κιβώτια στην αγορά, +{c} νομίσματα.",
      "live.back": "{t}: έχασε όλα τα κιβώτια και γυρίζει πίσω.", "live.burnt": "Το κάρο με τα άχυρα κάηκε.",
      "live.jam": "{t}: σφήνωσε τη μηχανή «{m}».",
      "live.sign": "Η πινακίδα στη διχάλα δείχνει {d}.", "live.dir.l": "αριστερά", "live.dir.r": "δεξιά", "live.dir.s": "ευθεία",
      "live.dir.g": "το κατσικομονοπάτι",
      "live.sel": "{t}, θέση {n} από {m}, {s}.",
      "live.status": "{g} από {m} κιβώτια στην αγορά, {c} νομίσματα, ταξίδι {n} από {k}."
    }
  };
  if (window.orosI18n) window.orosI18n.table(STRINGS, "caravan", LANG);

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
  function ctName(c) { return t("ct." + c.k + (c.l === 3 ? "." + c.b : "")); }
  function ctFx(c) { return t("fx." + c.k + (c.l === 3 ? "." + c.b : "")); }
  function rtName(id) { return t("rt." + id); }
  function capText(c) {
    var n = Math.floor(c.hp + 1e-6);
    return t(E.isGoods(c) ? "cart.crates" : "cart.straw", { n: n });
  }

  // BOOT MARKER
  var SCRIPT_V = "";
  (function () {
    var m = ((document.currentScript && document.currentScript.src) || "")
      .match(/[?&]v=([^&#]+)/);
    SCRIPT_V = m ? m[1] : "";
    document.documentElement.lang = LANG;
    console.log("caravan.js v" + (SCRIPT_V || "?") + " boot");
  })();

  // ---------- 2. Saves ----------
  var data = null, deviceId = null;
  var prefs = { diff: "n", tour: 0, last: "r1" };
  var sess = null;                     // { g, ck, counted }
  var game = null;                     // sess.g, the route on screen
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
      try { console.warn("[orOS] caravan: unreadable data copied to " + STORAGE_KEY + "-broken"); } catch (e) {}
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
        if (E.ROUTE[p.last]) prefs.last = p.last;
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

  // ---------- 3. The route ----------
  var selId = 0;                       // the chosen cart (id), 0 none
  var armed = "";                      // "s" smoke or "w" shield waiting for a tap
  var forkSel = -1;                    // keyboard: the chosen fork (index in rt.forks)
  var paused = false, speed = 1;
  var view = "map";                    // "map" | "play"

  function rtOf() { return E.ROUTE[game.rt]; }
  function startRoute(rtId, diff) {
    var g = E.newRun(rtId, diff);
    if (!g) return;
    sess = { g: g, ck: null, counted: false };
    game = g;
    prefs.last = rtId; prefs.diff = diff;
    savePrefs();
    selId = 0; armed = ""; forkSel = -1; paused = false;
    fx = [];
    saveSession();
    showPlay();
    announce(status());
  }
  function status() {
    return t("live.status", { g: game.got, m: game.goal, c: Math.floor(game.coins), n: game.trip, k: game.nt });
  }
  function retryTrip() {
    if (!sess || !sess.ck) return;
    sess.g = E.clone(sess.ck); sess.g.ev = [];
    sess.counted = false;
    game = sess.g;
    selId = 0; armed = ""; paused = false; fx = [];
    saveSession();
    closeDialog();
    showPlay();
  }
  function done(ok) {
    if (!ok) { sfx("no"); return false; }
    sfx("build");
    saveSoon();
    renderAll();
    return true;
  }
  // Hire a cart; a refusal always says why (R28).
  function hire(k) {
    if (!game) return;
    var why = E.whyNot(game, k);
    if (why) {
      if (why === "locked") showToast(t("why.locked", { t: t("ct." + k), n: E.CARTS[k].u }));
      else if (why === "coins") showToast(t("why.coins"));
      else if (why === "full") showToast(t("act.full", { n: E.MAX_CARTS }));
      done(false);
      return;
    }
    var c = E.hire(game, k);
    if (c) selId = 0;
    done(!!c);
  }
  function selCart() { return selId && game ? E.cartById(game, selId) : null; }
  function upgrade(branch) {
    var c = selCart();
    if (!c || c.l >= 3 || game.ph !== "plan") return;
    if (game.coins < E.upCost(c)) { showToast(t("why.coins")); done(false); return; }
    done(E.upgrade(game, c.id, branch));
  }
  function sellSel() {
    var c = selCart();
    if (!c || game.ph !== "plan") return;
    var ok = E.sell(game, c.id);
    if (ok) selId = 0;
    done(ok);
  }
  function moveSel(dir) {
    var c = selCart();
    if (!c || game.ph !== "plan") return;
    done(E.moveCart(game, c.id, dir));
  }
  function flipFork(n) {
    if (!game || game.over >= 0) return;
    if (!E.flip(game, n)) { sfx("no"); return; }
    sfx("sign");
    saveSoon();
    announce(t("live.sign", { d: dirWord(n) }));
    renderAll();
  }
  // Which way the sign at n points, in words: left, right, straight on.
  function dirWord(n) {
    var rt = rtOf(), e = rt.E[rt.out[n][game.sg[n]]];
    if (e.goat) return t("live.dir.g");
    var a = e.pts[0], b = e.pts[1], dx = b.x - a.x, dy = b.y - a.y;
    if (Math.abs(dx) < 0.3 * Math.abs(dy)) return t("live.dir.s");
    // as seen on the screen
    return t(dx < 0 ? "live.dir.l" : "live.dir.r");
  }
  function setOff() {
    if (!game || game.over >= 0 || game.ph !== "plan") return;
    if (!E.canSetOff(game)) { showToast(t("why.empty")); sfx("no"); return; }
    sess.ck = E.saveable(game);
    sess.ck.ev = [];
    E.setOff(game);
    paused = false; armed = ""; selId = 0;
    sfx("go");
    announce(t("live.off", { n: game.trip, m: game.nt }));
    handleEvents();
    saveSession();
    renderAll();
  }
  function arm(k) {
    if (!game || game.over >= 0) return;
    if (k === "c") {
      if (E.shortcut(game)) { sfx("sign"); saveSoon(); renderAll(); } else done(false);
      return;
    }
    if (game.ph !== "go" || game.tk[k] < 1) { sfx("no"); return; }
    armed = armed === k ? "" : k;
    // the shield goes straight onto the chosen cart
    if (armed === "w" && selCart() && useShield(selId)) return;
    renderAll();
  }
  function useSmoke(x, y) {
    armed = "";
    if (E.smoke(game, x, y)) { sfx("smoke"); saveSoon(); handleEvents(); }
    renderAll();
  }
  function useShield(id) {
    armed = "";
    var ok = E.shield(game, id);
    if (ok) { sfx("shield"); saveSoon(); handleEvents(); }
    renderAll();
    return ok;
  }
  // Keyboard smoke: on the working machine nearest to the leading cart.
  function smokeAhead() {
    var rt = rtOf(), lead = null;
    game.cv.forEach(function (c) { if (c.st === "r" && (!lead || c.tr > lead.tr)) lead = c; });
    var from = lead || rt.P.S, best = null, bd = Infinity;
    E.activeMachines(game).forEach(function (i) {
      var m = rt.M[i];
      if (!E.MACHINES[m.k].dmg) return;
      var d = (m.x - from.x) * (m.x - from.x) + (m.y - from.y) * (m.y - from.y);
      if (m.y >= from.y - 1 && d < bd) { bd = d; best = m; }
    });
    if (best) useSmoke(best.x, best.y);
  }
  function buyTrick(k) {
    if (!game) return;
    if (game.coins < E.TRICK_COST) { showToast(t("why.coins")); done(false); return; }
    done(E.buyTrick(game, k));
  }
  // The route is over: count it once, then the end card.
  function endRoute() {
    if (!sess || sess.counted) return;
    var nx = nextRtId(game.rt);
    var before = nx ? E.isOpen(data, nx) : true;
    data = E.record(data, deviceId, game, Date.now());
    sess.counted = true;
    saveData();
    saveSession();
    var opened = nx && !before && E.isOpen(data, nx) ? nx : null;
    sfx(game.over === 1 ? "won" : "lost");
    endDialog(opened);
  }
  function nextRtId(id) {
    var rt = E.ROUTE[id];
    return rt && E.ROUTES[rt.idx + 1] ? E.ROUTES[rt.idx + 1].id : null;
  }

  // ---------- 4. Loop ----------
  var raf = 0, lastT = 0, acc = 0, sinceSave = 0;
  var FRAME = 1000 / E.TPS;
  function running() { return view === "play" && game && !paused && game.over < 0 && game.ph === "go" && !dlgOpen(); }
  function frame(now) {
    raf = 0;
    var dt = lastT ? Math.min(250, now - lastT) : 0;
    lastT = now;
    if (running()) {
      advance(dt * speed);
      sinceSave += dt;
      if (sinceSave >= RUN_SAVE_MS) { sinceSave = 0; saveSession(); }
    }
    ageFx(dt);
    draw();
    if (!document.hidden) raf = requestAnimationFrame(frame);
  }
  function advance(ms) {
    acc += ms;
    var n = 0;
    while (acc >= FRAME && game.over < 0 && game.ph === "go" && n < 600) { E.step(game); acc -= FRAME; n++; }
    if (game.ph !== "go") acc = 0;
    if (n) handleEvents();
  }
  function startLoop() { if (!raf && !document.hidden) { lastT = 0; raf = requestAnimationFrame(frame); } }

  // What the engine reported: sounds, effects, the live region.
  var fx = [], lastSnd = {};
  function soundOnce(kind, ms) {
    var now = Date.now();
    if (lastSnd[kind] && now - lastSnd[kind] < ms) return;
    lastSnd[kind] = now;
    sfx(kind);
  }
  function handleEvents() {
    if (!game || !game.ev.length) return;
    var ev = game.ev; game.ev = [];
    var hits = 0, tripEnd = null;
    ev.forEach(function (x) {
      var rt = rtOf();
      if (x.e === "swing") { fx.push({ k: "swing", m: x.m, life: 300 }); soundOnce("arm", 90); }
      else if (x.e === "puff") { fx.push({ k: "puff", at: { x: x.x, y: x.y }, life: 500 }); soundOnce("puff", 120); }
      else if (x.e === "hit") { hits++; fx.push({ k: "hit", at: { x: x.x, y: x.y }, life: 380 }); }
      else if (x.e === "block") fx.push({ k: "block", c: x.c, life: 260 });
      else if (x.e === "back" || x.e === "burnt") {
        fx.push({ k: "gone", at: { x: x.x, y: x.y }, life: 600 });
        var c = E.cartById(game, x.c);
        announce(x.e === "back" ? t("live.back", { t: c ? ctName(c) : "" }) : t("live.burnt"));
        if (window.orosHaptics) window.orosHaptics.cue("bad");
      } else if (x.e === "home") { if (x.n) soundOnce(x.at === "N" ? "spice" : "market", 160); fx.push({ k: "home", at: rt.P[x.at || "M"], life: 500 }); }
      else if (x.e === "jam") {
        fx.push({ k: "jam", m: x.m, at: { x: x.x, y: x.y }, life: 600 });
        soundOnce("jam", 200);
        var jc = E.cartById(game, x.c);
        announce(t("live.jam", { t: jc ? ctName(jc) : "", m: t("mc." + rt.M[x.m].k) }));
      }
      else if (x.e === "trip") tripEnd = x;
      else if (x.e === "smoke") fx.push({ k: "smokeIn", at: { x: x.x, y: x.y }, life: 400 });
    });
    if (hits) soundOnce("hit", 70);
    if (tripEnd) {
      announce(t("live.trip", { n: tripEnd.n, g: tripEnd.got, c: tripEnd.c }));
      if (game.over < 0) { sfx("clear"); saveSession(); }
      selId = 0; armed = "";
    }
    renderStatus();
    renderBar();
    if (game.over >= 0) endRoute();
  }
  function ageFx(dt) {
    fx = fx.filter(function (f) { f.life -= dt; return f.life > 0; });
  }

  // ---------- 5. Scene ----------
  var canvas, ctx, dpr = 1, W = 0, H = 0, tile = 30, ox = 0, oy = 0;
  var reduced = false;
  var C = {};
  function readColors() {
    var cs = getComputedStyle(document.documentElement);
    ["--bg", "--text", "--text-dim", "--accent", "--border", "--danger", "--panel-bg",
     "--cv-hill", "--cv-hill2", "--cv-tree", "--cv-road", "--cv-edge", "--cv-goat", "--cv-way", "--cv-brass",
     "--cv-iron", "--cv-mud", "--cv-reach", "--cv-cart", "--cv-crate", "--cv-straw", "--cv-mend",
     "--cv-smoke", "--cv-stone", "--cv-awning"].forEach(function (v) {
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
    tile = Math.max(8, Math.min(W / E.COLS, H / E.ROWS));
    ox = (W - tile * E.COLS) / 2; oy = (H - tile * E.ROWS) / 2;
    draw();
  }
  function px(p) { return { x: ox + p.x * tile, y: oy + p.y * tile }; }

  // Tiles the road runs over (for the trees: never on or next to it).
  var nearRoad = null, nearFor = "";
  function roadTiles(rt) {
    if (nearFor === rt.id) return nearRoad;
    var s = {};
    rt.E.forEach(function (e) {
      for (var d = 0; d <= e.len; d += 0.25) {
        var p = E.pointAt(e, d);
        for (var dc = -1; dc <= 1; dc++) for (var dr = -1; dr <= 1; dr++) s[(Math.floor(p.x) + dc) + "," + (Math.floor(p.y) + dr)] = 1;
      }
    });
    rt.M.forEach(function (m) { s[Math.floor(m.x) + "," + Math.floor(m.y)] = 1; });
    nearRoad = s; nearFor = rt.id;
    return s;
  }
  function draw() {
    if (!ctx || view !== "play" || !game) return;
    var rt = rtOf();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = C["cv-hill"]; ctx.fillRect(0, 0, W, H);
    drawGround(rt);
    drawRoad(rt);
    drawMachines(rt);
    drawSmoke();
    drawEnds(rt);
    drawSigns(rt);
    game.cv.forEach(function (c) { if (c.st === "r") drawCart(c); });
    drawFx(rt);
  }
  function drawGround(rt) {
    var near = roadTiles(rt);
    for (var r = 0; r < E.ROWS; r++) {
      for (var c = 0; c < E.COLS; c++) {
        var h = (c * 73 + r * 151 + rt.idx * 17) % 11;
        var x = ox + c * tile, y = oy + r * tile;
        if (h < 3) { ctx.fillStyle = C["cv-hill2"]; ctx.fillRect(x, y, tile + 0.5, tile + 0.5); }
        if (!near[c + "," + r] && h === 5) {
          // an olive tree: a trunk and a round crown
          ctx.fillStyle = C["cv-edge"]; ctx.fillRect(x + tile * 0.45, y + tile * 0.55, tile * 0.1, tile * 0.3);
          ctx.beginPath(); ctx.arc(x + tile * 0.5, y + tile * 0.45, tile * 0.28, 0, Math.PI * 2);
          ctx.fillStyle = C["cv-tree"]; ctx.fill();
        } else if (!near[c + "," + r] && h === 8) {
          ctx.beginPath(); ctx.arc(x + tile * 0.35, y + tile * 0.6, tile * 0.12, 0, Math.PI * 2);
          ctx.arc(x + tile * 0.62, y + tile * 0.4, tile * 0.08, 0, Math.PI * 2);
          ctx.fillStyle = C["cv-stone"]; ctx.fill();
        }
      }
    }
  }
  function polyline(e) {
    ctx.beginPath();
    e.pts.forEach(function (p, k) { var q = px(p); if (k) ctx.lineTo(q.x, q.y); else ctx.moveTo(q.x, q.y); });
  }
  function drawRoad(rt) {
    ctx.lineCap = "round"; ctx.lineJoin = "round";
    rt.E.forEach(function (e) {
      if (e.goat) return;
      polyline(e); ctx.strokeStyle = C["cv-edge"]; ctx.lineWidth = tile * 0.72; ctx.stroke();
    });
    rt.E.forEach(function (e) {
      ctx.save();
      polyline(e);
      if (e.goat) {
        ctx.setLineDash(game.goat ? [] : [tile * 0.25, tile * 0.25]);
        ctx.strokeStyle = C["cv-goat"]; ctx.lineWidth = tile * (game.goat ? 0.4 : 0.22);
      } else { ctx.strokeStyle = C["cv-road"]; ctx.lineWidth = tile * 0.56; }
      ctx.stroke();
      ctx.restore();
    });
    // the way the next cart will take (dots)
    var dot = Math.max(2, tile * 0.1);
    ctx.save();
    ctx.setLineDash([dot, dot * 2.2]);
    ctx.strokeStyle = C["cv-way"]; ctx.lineWidth = dot;
    E.wayNow(game).forEach(function (i) { polyline(rt.E[i]); ctx.stroke(); });
    ctx.restore();
  }
  function drawMachines(rt) {
    var fresh = game.ph === "plan" && game.trip > 1 ? E.newMachines(game) : [];
    E.activeMachines(game).forEach(function (i) {
      var m = rt.M[i], M = E.MACHINES[m.k], q = px(m);
      // the reach
      ctx.beginPath(); ctx.arc(q.x, q.y, M.r * tile, 0, Math.PI * 2);
      ctx.globalAlpha = 0.1; ctx.fillStyle = m.k === "mud" ? C["cv-mud"] : C["cv-reach"]; ctx.fill();
      ctx.globalAlpha = 0.55; ctx.strokeStyle = m.k === "mud" ? C["cv-mud"] : C["cv-reach"]; ctx.lineWidth = 1.2;
      if (m.k === "look") ctx.setLineDash([3, 3]);
      ctx.stroke(); ctx.setLineDash([]);
      ctx.globalAlpha = 1;
      if (fresh.indexOf(i) >= 0) {
        ctx.beginPath(); ctx.arc(q.x, q.y, tile * 0.55, 0, Math.PI * 2);
        ctx.strokeStyle = C.accent; ctx.lineWidth = Math.max(2, tile * 0.1); ctx.stroke();
      }
      drawMachine(m, q, game.mc[i], i);
    });
  }
  // Each machine has its own outline (never only a colour).
  function drawMachine(m, q, ms, i) {
    var r = tile * 0.34;
    ctx.lineWidth = Math.max(1.5, tile * 0.07); ctx.lineCap = "round"; ctx.lineJoin = "round";
    ctx.strokeStyle = C["cv-iron"]; ctx.fillStyle = C["cv-brass"];
    var stopped = ms && ms.st > 0;
    if (stopped) ctx.globalAlpha = 0.5;
    if (m.k === "arm") {
      // a post with a swinging bar
      ctx.fillRect(q.x - r * 0.35, q.y - r * 0.35, r * 0.7, r * 0.7);
      ctx.strokeRect(q.x - r * 0.35, q.y - r * 0.35, r * 0.7, r * 0.7);
      var sw = fx.some(function (f) { return f.k === "swing" && f.m === i; });
      var a = sw && !reduced ? -0.9 : 0;
      ctx.beginPath(); ctx.moveTo(q.x, q.y);
      ctx.lineTo(q.x + Math.cos(a) * r * 1.3, q.y + Math.sin(a) * r * 1.3);
      ctx.strokeStyle = C["cv-brass"]; ctx.lineWidth = Math.max(2, tile * 0.12); ctx.stroke();
    } else if (m.k === "bellows") {
      // a fan of leather with a nozzle
      ctx.beginPath(); ctx.moveTo(q.x - r, q.y - r * 0.7); ctx.lineTo(q.x + r * 0.3, q.y - r * 0.25);
      ctx.lineTo(q.x + r * 0.3, q.y + r * 0.25); ctx.lineTo(q.x - r, q.y + r * 0.7); ctx.closePath();
      ctx.fill(); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(q.x + r * 0.3, q.y); ctx.lineTo(q.x + r, q.y); ctx.stroke();
    } else if (m.k === "mud") {
      // a wheel with spokes
      ctx.beginPath(); ctx.arc(q.x, q.y, r * 0.85, 0, Math.PI * 2); ctx.fillStyle = C["cv-mud"]; ctx.fill(); ctx.stroke();
      ctx.beginPath();
      for (var k = 0; k < 4; k++) {
        var b = k * Math.PI / 4;
        ctx.moveTo(q.x - Math.cos(b) * r * 0.85, q.y - Math.sin(b) * r * 0.85);
        ctx.lineTo(q.x + Math.cos(b) * r * 0.85, q.y + Math.sin(b) * r * 0.85);
      }
      ctx.strokeStyle = C["cv-brass"]; ctx.lineWidth = Math.max(1, tile * 0.05); ctx.stroke();
    } else {
      // a lookout: a tall triangle with an eye
      ctx.beginPath(); ctx.moveTo(q.x, q.y - r * 1.1); ctx.lineTo(q.x + r * 0.8, q.y + r * 0.8); ctx.lineTo(q.x - r * 0.8, q.y + r * 0.8); ctx.closePath();
      ctx.fill(); ctx.stroke();
      ctx.beginPath(); ctx.arc(q.x, q.y + r * 0.1, r * 0.22, 0, Math.PI * 2); ctx.fillStyle = C["cv-iron"]; ctx.fill();
    }
    ctx.globalAlpha = 1;
    if (stopped) {
      // stopped (jammed or scared): a wedge stuck in it
      ctx.beginPath(); ctx.moveTo(q.x + r * 0.2, q.y + r * 0.9); ctx.lineTo(q.x + r * 1.1, q.y + r * 0.5); ctx.lineTo(q.x + r * 1.1, q.y + r * 1.1); ctx.closePath();
      ctx.fillStyle = C["cv-iron"]; ctx.fill();
    }
  }
  function drawSmoke() {
    game.sm.forEach(function (s) {
      var q = px(s), a = Math.min(1, s.t / 60);
      ctx.globalAlpha = 0.45 * a;
      ctx.fillStyle = C["cv-smoke"];
      [[0, 0, 1], [-0.45, 0.2, 0.7], [0.5, 0.15, 0.65], [0.1, -0.45, 0.6]].forEach(function (b) {
        ctx.beginPath(); ctx.arc(q.x + b[0] * E.SMOKE_R * tile * 0.6, q.y + b[1] * E.SMOKE_R * tile * 0.6, b[2] * E.SMOKE_R * tile * 0.6, 0, Math.PI * 2); ctx.fill();
      });
      ctx.globalAlpha = 1;
    });
  }
  function drawEnds(rt) {
    // the village gate: an arch
    var g = px(rt.P.S), r = tile * 0.45;
    ctx.strokeStyle = C["cv-stone"]; ctx.lineWidth = Math.max(2, tile * 0.14); ctx.lineCap = "round";
    ctx.beginPath(); ctx.moveTo(g.x - r, g.y + r * 0.8); ctx.lineTo(g.x - r, g.y); ctx.arc(g.x, g.y, r, Math.PI, 0); ctx.lineTo(g.x + r, g.y + r * 0.8); ctx.stroke();
    stall(rt.P.M, false);
    if (rt.P.N) stall(rt.P.N, true);
  }
  // A market: a stall with a striped awning; the spice market has a
  // pointed roof with five stripes and a jar on the counter.
  function stall(p, spice) {
    var m = px(p), w = tile * 1.2, h = tile * 0.5, n = spice ? 5 : 4;
    ctx.fillStyle = C["cv-cart"]; ctx.fillRect(m.x - w / 2, m.y - h * 0.1, w, h * 0.7);
    for (var k = 0; k < n; k++) {
      ctx.fillStyle = k % 2 ? C["cv-crate"] : (spice ? C["cv-brass"] : C["cv-awning"]);
      ctx.fillRect(m.x - w / 2 + k * w / n, m.y - h * 0.8, w / n + 0.5, h * 0.7);
    }
    if (spice) {
      ctx.beginPath(); ctx.moveTo(m.x - w / 2, m.y - h * 0.8); ctx.lineTo(m.x, m.y - h * 1.4); ctx.lineTo(m.x + w / 2, m.y - h * 0.8); ctx.closePath();
      ctx.fillStyle = C["cv-awning"]; ctx.fill();
      ctx.beginPath(); ctx.arc(m.x, m.y + h * 0.25, h * 0.22, 0, Math.PI * 2);
      ctx.fillStyle = C["cv-brass"]; ctx.fill(); ctx.strokeStyle = C["cv-edge"]; ctx.lineWidth = 1; ctx.stroke();
    }
    var hm = fx.some(function (f) { return f.k === "home" && f.at === p; });
    if (hm && !reduced) { ctx.globalAlpha = 0.35; ctx.fillStyle = C.accent; ctx.beginPath(); ctx.arc(m.x, m.y, tile * 0.9, 0, Math.PI * 2); ctx.fill(); ctx.globalAlpha = 1; }
  }
  // A sign: a round board on the fork with an arrow along the way it sends carts.
  function drawSigns(rt) {
    rt.forks.forEach(function (n, k) {
      var e = rt.E[rt.out[n][game.sg[n]]], a = e.pts[0], b = e.pts[1];
      var q = px(a), ang = Math.atan2(b.y - a.y, b.x - a.x), r = tile * 0.42;
      ctx.beginPath(); ctx.arc(q.x, q.y, r, 0, Math.PI * 2);
      ctx.fillStyle = C["panel-bg"]; ctx.fill();
      ctx.strokeStyle = forkSel === k ? C.accent : C["cv-brass"]; ctx.lineWidth = Math.max(2, tile * (forkSel === k ? 0.12 : 0.08)); ctx.stroke();
      ctx.save(); ctx.translate(q.x, q.y); ctx.rotate(ang);
      ctx.beginPath(); ctx.moveTo(-r * 0.55, 0); ctx.lineTo(r * 0.5, 0);
      ctx.moveTo(r * 0.15, -r * 0.35); ctx.lineTo(r * 0.55, 0); ctx.lineTo(r * 0.15, r * 0.35);
      ctx.strokeStyle = C.text; ctx.lineWidth = Math.max(1.5, tile * 0.08); ctx.lineCap = "round"; ctx.lineJoin = "round"; ctx.stroke();
      ctx.restore();
    });
  }
  function rr(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y); ctx.lineTo(x + w - r, y); ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r); ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h); ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r); ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
  }
  // Each cart kind has its own outline; crates on top show its load.
  function drawCart(c) {
    var q = px(c), st = E.stats(c);
    var w = tile * (c.k === "mule" ? (c.b === "a" ? 0.9 : 0.78) : c.k === "pony" ? 0.56 : 0.66), h = tile * 0.5;
    if (c.sh > 0) {
      ctx.beginPath(); ctx.arc(q.x, q.y, tile * 0.55, 0, Math.PI * 2);
      ctx.globalAlpha = 0.3; ctx.fillStyle = C["cv-mend"]; ctx.fill(); ctx.globalAlpha = 1;
      ctx.strokeStyle = C["cv-mend"]; ctx.lineWidth = 2; ctx.stroke();
    }
    // wheels
    ctx.fillStyle = C["cv-iron"];
    ctx.beginPath(); ctx.arc(q.x - w * 0.32, q.y + h * 0.42, h * 0.2, 0, Math.PI * 2); ctx.arc(q.x + w * 0.32, q.y + h * 0.42, h * 0.2, 0, Math.PI * 2); ctx.fill();
    if (c.k === "straw") {
      ctx.beginPath(); ctx.ellipse(q.x, q.y - h * 0.05, w * 0.55, h * 0.5, 0, 0, Math.PI * 2);
      ctx.fillStyle = C["cv-straw"]; ctx.fill();
      ctx.strokeStyle = C["cv-edge"]; ctx.lineWidth = 1; ctx.stroke();
      ctx.beginPath(); ctx.moveTo(q.x - w * 0.3, q.y - h * 0.2); ctx.lineTo(q.x + w * 0.3, q.y - h * 0.2);
      ctx.moveTo(q.x - w * 0.35, q.y + h * 0.1); ctx.lineTo(q.x + w * 0.35, q.y + h * 0.1); ctx.stroke();
    } else {
      rr(q.x - w / 2, q.y - h * 0.15, w, h * 0.5, h * 0.12);
      ctx.fillStyle = C["cv-cart"]; ctx.fill();
      ctx.strokeStyle = C["cv-edge"]; ctx.lineWidth = 1; ctx.stroke();
      // crates: up to four, by the share of the load still on
      var n = Math.ceil(4 * Math.max(0, c.hp) / st.cap - 1e-6), cw = w * 0.22;
      for (var k = 0; k < n; k++) {
        var cx = q.x - w / 2 + w * 0.06 + (k % 2) * (cw + w * 0.04) + (c.k === "pony" ? 0 : Math.floor(k / 2) * 0);
        var row = Math.floor(k / 2);
        ctx.fillStyle = C["cv-crate"];
        ctx.fillRect(cx + (row ? cw * 0.5 : 0) + (c.k === "pony" ? 0 : w * 0.25), q.y - h * 0.15 - cw * (row + 1), cw, cw);
      }
      if (c.k === "smith") {
        // an anvil on the side
        ctx.fillStyle = C["cv-iron"];
        ctx.fillRect(q.x - h * 0.3, q.y + h * 0.02, h * 0.6, h * 0.12);
        ctx.fillRect(q.x - h * 0.12, q.y + h * 0.14, h * 0.24, h * 0.14);
        if (c.j > 0) {
          ctx.globalAlpha = 0.5; ctx.fillStyle = C.border;
          ctx.fillRect(q.x - w / 2, q.y + h * 0.42, w * (1 - c.j / st.rest), 2); ctx.globalAlpha = 1;
        }
      }
      if (c.k === "mender") {
        // a mender's cross on the side
        ctx.strokeStyle = C["cv-mend"]; ctx.lineWidth = Math.max(1.5, tile * 0.07);
        ctx.beginPath(); ctx.moveTo(q.x - h * 0.2, q.y + h * 0.1); ctx.lineTo(q.x + h * 0.2, q.y + h * 0.1);
        ctx.moveTo(q.x, q.y - h * 0.1); ctx.lineTo(q.x, q.y + h * 0.3); ctx.stroke();
        ctx.beginPath(); ctx.arc(q.x, q.y, st.mr * tile, 0, Math.PI * 2);
        ctx.globalAlpha = 0.35; ctx.strokeStyle = C["cv-mend"]; ctx.lineWidth = 1; ctx.setLineDash([2, 3]); ctx.stroke(); ctx.setLineDash([]); ctx.globalAlpha = 1;
      }
    }
    // the load as a bar
    var fr = Math.max(0, c.hp / st.cap), bw = Math.max(tile * 0.6, w);
    ctx.fillStyle = C.border; ctx.fillRect(q.x - bw / 2, q.y - h - 4, bw, 3);
    ctx.fillStyle = E.isGoods(c) ? C.accent : C["cv-straw"]; ctx.fillRect(q.x - bw / 2, q.y - h - 4, bw * fr, 3);
    if (c.id === selId) {
      ctx.strokeStyle = C.accent; ctx.lineWidth = 2;
      ctx.strokeRect(q.x - w / 2 - 3, q.y - h - 6, w + 6, h * 1.6 + 6);
    }
  }
  function drawFx(rt) {
    fx.forEach(function (f) {
      if (!f.at) return;
      var c = px(f.at);
      if (f.k === "hit") {
        ctx.globalAlpha = 0.8 * f.life / 380;
        ctx.fillStyle = C["cv-crate"];
        var dy = reduced ? 0 : (1 - f.life / 380) * tile * 0.6;
        ctx.fillRect(c.x + tile * 0.2, c.y - tile * 0.1 + dy, tile * 0.16, tile * 0.16);
      } else if (f.k === "puff") {
        var k = reduced ? 1 : 1 - f.life / 500;
        ctx.globalAlpha = 0.45 * f.life / 500;
        ctx.fillStyle = C["cv-smoke"];
        ctx.beginPath(); ctx.arc(c.x, c.y, Math.max(3, tile * (0.4 + 0.6 * k)), 0, Math.PI * 2); ctx.fill();
      } else if (f.k === "gone") {
        ctx.globalAlpha = 0.6 * f.life / 600;
        ctx.strokeStyle = C.danger; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(c.x, c.y, tile * 0.4, 0, Math.PI * 2); ctx.stroke();
      } else if (f.k === "smokeIn") {
        ctx.globalAlpha = 0.5 * f.life / 400;
        ctx.strokeStyle = C["cv-smoke"]; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(c.x, c.y, E.SMOKE_R * tile * (reduced ? 1 : 1.2 - 0.2 * f.life / 400), 0, Math.PI * 2); ctx.stroke();
      }
      ctx.globalAlpha = 1;
    });
  }

  // ---------- 6. Input ----------
  function pointAt(clientX, clientY) {
    var r = canvas.getBoundingClientRect();
    return { x: (clientX - r.left - ox) / tile, y: (clientY - r.top - oy) / tile };
  }
  function forkAt(p) {
    var rt = rtOf(), best = null, bd = 0.85 * 0.85;
    rt.forks.forEach(function (n) {
      var q = rt.P[n], d = (q.x - p.x) * (q.x - p.x) + (q.y - p.y) * (q.y - p.y);
      if (d <= bd) { bd = d; best = n; }
    });
    return best;
  }
  function cartAt(p) {
    var best = null, bd = 0.8 * 0.8;
    game.cv.forEach(function (c) {
      if (c.st !== "r") return;
      var d = (c.x - p.x) * (c.x - p.x) + (c.y - p.y) * (c.y - p.y);
      if (d <= bd) { bd = d; best = c; }
    });
    return best;
  }
  function onTap(p) {
    if (!game || game.over >= 0) return;
    if (armed === "s") { if (p.x >= 0 && p.x <= E.COLS && p.y >= 0 && p.y <= E.ROWS) useSmoke(p.x, p.y); return; }
    if (armed === "w") { var c0 = cartAt(p); if (c0) useShield(c0.id); else sfx("no"); return; }
    var n = forkAt(p);
    if (n) { forkSel = rtOf().forks.indexOf(n); flipFork(n); return; }
    var c = cartAt(p);
    if (c) { selectCart(c.id === selId ? 0 : c.id); return; }
    if (selId) selectCart(0);
  }
  function selectCart(id, quiet) {
    selId = id;
    renderAll();
    var c = selCart();
    if (c && !quiet) announce(t("live.sel", { t: ctName(c), n: game.cv.indexOf(c) + 1, m: game.cv.length, s: capText(c) }));
  }
  function wireInput() {
    canvas.addEventListener("pointerdown", function (e) {
      if (view !== "play" || !game) return;
      e.preventDefault();
      canvas.focus({ preventScroll: true });
      onTap(pointAt(e.clientX, e.clientY));
    });
  }
  function moveSelection(dir) {
    if (!game.cv.length) return;
    var i = selId ? game.cv.indexOf(selCart()) : -1;
    i = i < 0 ? (dir > 0 ? 0 : game.cv.length - 1) : Math.max(0, Math.min(game.cv.length - 1, i + dir));
    selectCart(game.cv[i].id);
  }
  function nextFork() {
    var rt = rtOf();
    if (!rt.forks.length) return;
    forkSel = (forkSel + 1) % rt.forks.length;
    announce(t("live.sign", { d: dirWord(rt.forks[forkSel]) }));
    draw();
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
      if ((k === " " || k === "Enter") && tag === "BUTTON") return;
      var plan = game.ph === "plan", c = selCart();
      var handled = true;
      if (k === "ArrowLeft" || k === "ArrowUp") moveSelection(-1);
      else if (k === "ArrowRight" || k === "ArrowDown") moveSelection(1);
      else if (k === " ") togglePause();
      else if (k === "f" || k === "F") cycleSpeed();
      else if (k === "n" || k === "N") setOff();
      else if (k === "g" || k === "G") nextFork();
      else if (k === "Enter" && forkSel >= 0) flipFork(rtOf().forks[forkSel]);
      else if (k === "Escape") { armed = ""; forkSel = -1; selectCart(0, true); }
      else if (/^[1-5]$/.test(k) && plan) hire(E.KINDS[+k - 1]);
      else if (k === "[" && c) moveSel(-1);
      else if (k === "]" && c) moveSel(1);
      else if ((k === "u" || k === "U") && c && c.l === 1 && plan) upgrade("");
      else if ((k === "a" || k === "A" || k === "b" || k === "B") && c && c.l === 2 && plan) upgrade(k.toLowerCase());
      else if ((k === "s" || k === "S") && c && plan) sellSel();
      else if ((k === "q" || k === "Q") && !plan && game.tk.s > 0) smokeAhead();
      else if ((k === "w" || k === "W") && !plan) {
        var target = c && c.st === "r" ? c : null;
        if (!target) game.cv.forEach(function (o) { if (o.st === "r" && E.isGoods(o) && (!target || o.tr > target.tr)) target = o; });
        if (target) useShield(target.id); else sfx("no");
      }
      else if (k === "e" || k === "E") arm("c");
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
    setStat("s-goods", ICONS.crate, game.got + "/" + game.goal, t("st.goodsOf", { n: game.got, m: game.goal }));
    $("s-goods").classList.toggle("ok", game.got >= game.goal);
    setStat("s-coins", ICONS.coin, Math.floor(game.coins), t("st.coins") + ": " + Math.floor(game.coins));
    setStat("s-trip", ICONS.trip, t("st.tripShort", { n: game.trip, m: game.nt }), t("st.trip", { n: game.trip, m: game.nt }));
  }
  function actBtn(icon, name, cost, title, fn, disabled, cls) {
    var b = el("button", "act" + (cls ? " " + cls : ""));
    b.type = "button";
    b.innerHTML = icon;
    b.appendChild(el("span", "nm", name));
    if (cost !== "") b.appendChild(el("span", "cost", cost));
    b.title = title; b.setAttribute("aria-label", title);
    b.disabled = !!disabled;
    b.addEventListener("click", fn);
    return b;
  }
  function hireBtn(k) {
    var on = E.unlocked(game, k), c = E.hireCost(k);
    var b = actBtn(ICONS[k], t("ct." + k), on ? String(c) : t("act.locked", { n: E.CARTS[k].u }),
      t("act.hire") + ": " + t("ct." + k) + ". " + t("fx." + k) + " (" + (E.KINDS.indexOf(k) + 1) + ")" + (on ? ", " + c : ""),
      function () { hire(k); }, on && (game.coins < c || game.cv.length >= E.MAX_CARTS), on ? "" : "locked");
    return b;
  }
  function chip(c) {
    var b = el("button", "chip" + (c.st === "h" || c.st === "x" || c.st === "d" ? " gone" : "") + (c.sh > 0 ? " shield" : ""));
    b.type = "button";
    b.innerHTML = ICONS[c.k];
    b.appendChild(el("span", "", String(Math.floor(c.hp + 1e-6))));
    b.setAttribute("aria-pressed", c.id === selId ? "true" : "false");
    var label = ctName(c) + ", " + t("cart.pos", { n: game.cv.indexOf(c) + 1, m: game.cv.length }) + ", " + capText(c) +
      (game.ph === "go" ? ", " + t("cart.st." + c.st) : "");
    b.title = label; b.setAttribute("aria-label", label);
    b.addEventListener("click", function () {
      if (armed === "w") { if (c.st === "r" || c.st === "q") useShield(c.id); else sfx("no"); return; }
      selectCart(c.id === selId ? 0 : c.id);
    });
    return b;
  }
  var barKey = "";
  function renderBar() {
    if (!game) return;
    var plan = game.ph === "plan", over = game.over >= 0;
    var pb = $("pause-btn");
    pb.innerHTML = paused ? ICONS.play : ICONS.pause;
    pb.title = t(paused ? "btn.play" : "btn.pause");
    pb.setAttribute("aria-label", pb.title);
    pb.setAttribute("aria-pressed", paused ? "true" : "false");
    pb.disabled = over || plan;
    var sb = $("speed-btn");
    sb.textContent = speed + "x";
    sb.title = t("btn.speed", { n: speed }); sb.setAttribute("aria-label", sb.title);
    var gb = $("go-btn");
    gb.querySelector(".ic").innerHTML = plan ? ICONS.go : ICONS.trip;
    gb.querySelector(".lb").textContent = over ? t("btn.over") : plan ? t("btn.go") : t("btn.road");
    gb.disabled = over || !plan || !game.cv.length;
    gb.title = t("btn.goKey", { n: game.trip });
    // the caravan row and the context row, rebuilt only when they change
    var key = [game.ph, selId, armed, Math.floor(game.coins), game.trip, game.over, JSON.stringify(game.tk), game.goat, LANG,
      game.cv.map(function (c) { return [c.id, c.k, c.l, c.b, c.st, Math.floor(c.hp + 1e-6), c.sh > 0 ? 1 : 0].join(","); }).join(";")].join("|");
    if (key === barKey) return;
    barKey = key;
    var cv = $("bar-cv");
    cv.textContent = "";
    cv.setAttribute("aria-label", t("app.name"));
    if (!game.cv.length) cv.appendChild(el("div", "cv-empty", t("ctx.plan")));
    game.cv.forEach(function (c) { cv.appendChild(chip(c)); });
    var row = $("bar-ctx"), tip = $("tip");
    row.textContent = "";
    var c = selCart();
    tip.classList.remove("warn");
    if (armed) { tip.hidden = false; tip.textContent = t(armed === "s" ? "tk.armS" : "tk.armW"); tip.classList.add("warn"); }
    else if (c) { tip.hidden = false; tip.innerHTML = t("cart.info", { t: esc(ctName(c)), l: c.l, cap: esc(capText(c)), fx: esc(ctFx(c)) }); }
    else if (plan && !over) {
      var nm = E.newMachines(game).length;
      tip.hidden = false;
      tip.textContent = game.trip > 1 && nm ? t("ctx.new", { n: game.trip, m: nm }) :
        rtOf().two && game.trip === 1 ? t("ctx.two", { n: E.PAY_N, m: E.PAY }) : t("ctx.plan");
    } else if (!over && game.t < E.TPS * 6 && rtOf().forks.length) { tip.hidden = false; tip.textContent = t("ctx.road"); }
    else tip.hidden = true;
    if (over) return;
    if (plan && c) {
      row.appendChild(actBtn(ICONS.left, t("act.fwd"), "", t("act.fwd") + " ([)", function () { moveSel(-1); }, game.cv.indexOf(c) === 0));
      row.appendChild(actBtn(ICONS.right, t("act.back"), "", t("act.back") + " (])", function () { moveSel(1); }, game.cv.indexOf(c) === game.cv.length - 1));
      var uc = E.upCost(c);
      if (c.l === 1) row.appendChild(actBtn(ICONS.up, t("act.up"), String(uc), t("act.up") + " (U): " + t("ct." + c.k) + " 2, " + uc, function () { upgrade(""); }, game.coins < uc));
      else if (c.l === 2) ["a", "b"].forEach(function (br) {
        var nm2 = t("ct." + c.k + "." + br);
        row.appendChild(actBtn(ICONS.up, nm2, String(uc), nm2 + " (" + br.toUpperCase() + "): " + t("fx." + c.k + "." + br) + " " + uc, function () { upgrade(br); }, game.coins < uc));
      });
      else row.appendChild(actBtn(ICONS.star, t("act.max"), "", t("act.max"), function () {}, true));
      var sv = E.sellValue(c);
      row.appendChild(actBtn(ICONS.sell, t("act.sell"), "+" + sv, t("cart.sell", { n: sv }) + " (S)", sellSel));
      return;
    }
    if (plan) {
      E.KINDS.forEach(function (k) { row.appendChild(hireBtn(k)); });
      row.appendChild(actBtn(ICONS.trick, t("act.tricks"), "", t("tk.title"), tricksDialog));
      return;
    }
    // on the road: the tricks
    var rt = rtOf();
    TRICKS.forEach(function (k) {
      if (k === "c" && !rt.hasGoat) return;
      var n = game.tk[k], dis = n < 1 || (k === "c" && game.goat);
      var keyName = k === "s" ? "Q" : k === "w" ? "W" : "E";
      row.appendChild(actBtn(ICONS["tk_" + k], t("tk." + k), dis && k === "c" && game.goat ? "✓" : String(n),
        t("tk." + k) + " (" + keyName + "): " + t("tkfx." + k) + " " + t("tk.left", { n: n }), function () { arm(k); }, dis, armed === k ? "armed" : ""));
    });
  }
  function togglePause() {
    if (!game || game.over >= 0 || game.ph !== "go") return;
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
    resize();
    renderAll();
    canvas.focus({ preventScroll: true });
  }

  // ---------- 8. Road map ----------
  function showMap() {
    if (view === "play" && game && underWay()) { if (game.ph === "go") paused = true; saveSession(); }
    view = "map";
    selId = 0; armed = "";
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
      var cont = el("button", "mp-cont", t("map.cont", { r: rtName(game.rt), n: game.trip }));
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
    E.ROUTES.forEach(function (rt) {
      if (rt.idx === 0 || rt.idx === 4) wrap.appendChild(el("div", "mp-head", t(rt.idx ? "map.road2" : "map.road")));
      var open = E.isOpen(data, rt.id);
      var b = el("button", "sq-card" + (underWay() && game.rt === rt.id ? " cur" : ""));
      b.type = "button";
      b.disabled = !open;
      b.appendChild(el("span", "no", String(rt.idx + 1)));
      var tx2 = el("span", "tx");
      tx2.appendChild(el("span", "nm", rtName(rt.id)));
      var kinds = E.KINDS.filter(function (k) { return E.CARTS[k].u <= Math.min(E.MAX_U, rt.idx + 1); }).map(function (k) { return t("ct." + k); });
      tx2.appendChild(el("span", "fx", open ? t("map.goal", { n: rt.goal, m: E.TRIPS }) + (rt.two ? " · " + t("map.two", { n: E.PAY_N }) : "") + " · " + t("map.carts", { list: kinds.join(", ") }) : t("map.lock")));
      b.appendChild(tx2);
      b.appendChild(starIcons(E.starsOf(data, rt.id)));
      b.setAttribute("aria-label", rtName(rt.id) + ", " + E.starsOf(data, rt.id) + "/3");
      b.addEventListener("click", function () { pickRoute(rt.id); });
      wrap.appendChild(b);
    });
    var rs = el("button", "dlg-btn danger mp-reset", t("btn.reset"));
    rs.type = "button";
    rs.addEventListener("click", function () {
      confirmDialog(t("map.resetAsk"), t("btn.resetYes"), resetProgress);
    });
    wrap.appendChild(rs);
    box.appendChild(wrap);
  }
  function pickRoute(id) {
    if (underWay() && game.acts > 0 && (game.rt !== id || game.diff !== prefs.diff)) {
      confirmDialog(t("map.replace", { r: rtName(game.rt), s: rtName(id) }), t("btn.ok"), function () { startRoute(id, prefs.diff); });
      return;
    }
    if (underWay() && game.rt === id && game.diff === prefs.diff) { showPlay(); return; }
    startRoute(id, prefs.diff);
  }
  // Reset progress: a new reset stamp, so older rows drop on every device.
  function resetProgress() {
    data = E.merge({ ver: 1, br: Math.max(Date.now(), data.br + 1), maps: {}, rows: {} }, data);
    saveData();
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
    openDialog("end", function (d) {
      d.appendChild(el("div", "dlg-title", rtName(g.rt) + " · " + t("diff." + g.diff)));
      d.appendChild(el("div", "dlg-hero", t(won ? "end.won" : "end.lost")));
      var st = el("div", "dlg-stars");
      for (var i = 0; i < 3; i++) { var s = el("span", i < E.stars(g) ? "" : "off"); s.innerHTML = ICONS.star; st.appendChild(s); }
      if (won) d.appendChild(st);
      d.appendChild(row(t("end.goods"), g.got + " / " + g.goal));
      d.appendChild(row(t("end.share"), (g.load ? Math.round(100 * g.got / g.load) : 0) + "%"));
      d.appendChild(row(t("end.trips"), g.trip + " / " + g.nt));
      d.appendChild(el("p", "dlg-note", t(won ? "end.wonNote" : "end.lostNote")));
      if (opened) {
        var nk = E.KINDS.filter(function (k) { return E.CARTS[k].u === E.ROUTE[opened].idx + 1; });
        if (nk.length) d.appendChild(el("p", "dlg-note", t("end.unlock", { t: t("ct." + nk[0]) })));
      }
      var a = el("div", "dlg-actions");
      if (!won && sess.ck) a.appendChild(dlgBtn(t("btn.again", { n: sess.ck.trip }), "primary", retryTrip));
      var nx = nextRtId(g.rt);
      if (won && nx) a.appendChild(dlgBtn(t("btn.nextRt"), "primary", function () { closeDialog(); startRoute(nx, g.diff); }));
      a.appendChild(dlgBtn(t("btn.restart"), "", function () { closeDialog(); startRoute(g.rt, g.diff); }));
      a.appendChild(dlgBtn(t("btn.toMap"), "", function () { closeDialog(); showMap(); }));
      d.appendChild(a);
    });
  }
  // Tricks in the plan: what each does, how many are left, buy one more.
  function tricksDialog() {
    if (!game || game.ph !== "plan") return;
    openDialog("tricks", function (d) {
      var rt = rtOf();
      d.appendChild(el("div", "dlg-title", t("tk.title")));
      TRICKS.forEach(function (k) {
        if (k === "c" && !rt.hasGoat) return;
        d.appendChild(row(t("tk." + k), t("tk.left", { n: game.tk[k] })));
        d.appendChild(el("p", "dlg-note", t("tkfx." + k)));
      });
      d.appendChild(el("p", "dlg-note", t("tk.note", { c: E.TRICK_COST })));
      if (rt.hasGoat) d.appendChild(el("p", "dlg-note", game.goat ? t("tk.isOpen") : ""));
      var a = el("div", "dlg-actions");
      TRICKS.forEach(function (k) {
        if (k === "c" && !rt.hasGoat) return;
        var b = dlgBtn(t("tk.buy", { t: t("tk." + k) }) + " · " + E.TRICK_COST, "", function () { buyTrick(k); tricksDialog(); });
        b.disabled = game.coins < E.TRICK_COST;
        a.appendChild(b);
      });
      if (rt.hasGoat && !game.goat && game.tk.c > 0) a.appendChild(dlgBtn(t("tk.open"), "", function () { closeDialog(); arm("c"); }));
      a.appendChild(dlgBtn(t("btn.close"), "primary", closeDialog));
      d.appendChild(a);
    });
  }
  function tourDialog() {
    if (view === "play" && game && game.ph === "go" && !paused) { paused = true; renderBar(); saveSession(); }
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
  var HAPTIC = { build: "tick", no: "bad", won: "good", go: "tick", sign: "tick" };
  function sfx(kind) {
    if (window.orosHaptics && HAPTIC[kind]) window.orosHaptics.cue(HAPTIC[kind]);
    if (!sfxOn()) return;
    try {
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      if (!audio) audio = new AC();
      if (audio.state === "suspended") audio.resume();
      if (kind === "arm") tone(240, 0, 0.07, "square", 0.025, 160);
      else if (kind === "puff") tone(300, 0, 0.25, "sawtooth", 0.02, 90);
      else if (kind === "hit") tone(150, 0, 0.1, "triangle", 0.05, 90);
      else if (kind === "spice") { tone(988, 0, 0.25, "sine", 0.04); tone(1480, 0.05, 0.25, "sine", 0.025); tone(1976, 0.1, 0.2, "sine", 0.015); }
      else if (kind === "jam") { tone(330, 0, 0.06, "square", 0.04); tone(220, 0.07, 0.12, "triangle", 0.05, 110); }
      else if (kind === "market") { tone(880, 0, 0.25, "sine", 0.04); tone(1320, 0.05, 0.2, "sine", 0.02); }
      else if (kind === "build") { tone(180, 0, 0.08, "triangle", 0.08, 120); tone(520, 0.04, 0.08, "sine", 0.05); }
      else if (kind === "sign") tone(700, 0, 0.06, "square", 0.03, 900);
      else if (kind === "go") { tone(196, 0, 0.3, "triangle", 0.06); tone(262, 0.12, 0.3, "triangle", 0.05); }
      else if (kind === "smoke") tone(500, 0, 0.4, "sawtooth", 0.015, 120);
      else if (kind === "shield") { tone(660, 0, 0.2, "sine", 0.05, 990); }
      else if (kind === "clear") [523, 659, 784].forEach(function (f, k) { tone(f, k * 0.08, 0.16, "sine", 0.05); });
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
    map:    SVG + '<path d="M3 6l6-3 6 3 6-3v15l-6 3-6-3-6 3z"/><path d="M9 3v15M15 6v15"/></svg>',
    help:   SVG + '<circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 0 1 4.9.8c0 1.7-2.4 2.2-2.4 3.7"/><path d="M12 17h.01"/></svg>',
    sfxOn:  SVG + '<path d="M11 5 6 9H2v6h4l5 4z"/><path d="M15.5 8.5a5 5 0 0 1 0 7M19 5a10 10 0 0 1 0 14"/></svg>',
    sfxOff: SVG + '<path d="M11 5 6 9H2v6h4l5 4z"/><path d="M22 9l-6 6M16 9l6 6"/></svg>',
    crate:  SVG + '<rect x="4" y="5" width="16" height="14" rx="1.5"/><path d="M4 10h16M10 5v5M14 5v5"/></svg>',
    coin:   SVG + '<circle cx="12" cy="12" r="8"/><path d="M12 8v8M9.5 10h5M9.5 14h5"/></svg>',
    trip:   SVG + '<path d="M5 20c0-6 14-6 14-12"/><circle cx="5" cy="20" r="1.5"/><circle cx="19" cy="6" r="2"/></svg>',
    go:     SVG + '<path d="M5 12h13M13 6l6 6-6 6"/></svg>',
    play:   SVG + '<path d="M7 4l13 8-13 8z"/></svg>',
    pause:  SVG + '<path d="M8 4v16M16 4v16"/></svg>',
    up:     SVG + '<path d="M12 20V5M5 12l7-7 7 7"/></svg>',
    sell:   SVG + '<circle cx="12" cy="12" r="8"/><path d="M8 12h8"/></svg>',
    left:   SVG + '<path d="M15 5l-7 7 7 7"/></svg>',
    right:  SVG + '<path d="M9 5l7 7-7 7"/></svg>',
    star:   SVG + '<path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z" fill="currentColor"/></svg>',
    trick:  SVG + '<path d="M12 3l1.8 4.2L18 9l-4.2 1.8L12 15l-1.8-4.2L6 9l4.2-1.8z"/><path d="M18 15l.9 2.1L21 18l-2.1.9L18 21l-.9-2.1L15 18l2.1-.9z"/></svg>',
    mule:   SVG + '<rect x="3" y="9" width="15" height="6" rx="1"/><path d="M6 9V6h7v3"/><circle cx="7" cy="17" r="2"/><circle cx="15" cy="17" r="2"/><path d="M18 12h3"/></svg>',
    pony:   SVG + '<rect x="6" y="10" width="10" height="5" rx="1"/><path d="M9 10V8h4v2"/><circle cx="9" cy="17" r="2"/><circle cx="14" cy="17" r="2"/><path d="M16 12l4-3"/></svg>',
    mender: SVG + '<rect x="3" y="9" width="14" height="6" rx="1"/><path d="M10 10v4M8 12h4"/><circle cx="7" cy="17" r="2"/><circle cx="13" cy="17" r="2"/><path d="M17 12h3"/></svg>',
    straw:  SVG + '<ellipse cx="11" cy="11" rx="8" ry="4.5"/><path d="M5 10h12M6 13h10"/><circle cx="7" cy="18" r="1.8"/><circle cx="15" cy="18" r="1.8"/></svg>',
    smith:  SVG + '<rect x="3" y="11" width="14" height="5" rx="1"/><path d="M6 11V9h8v2M8 9V7h5"/><circle cx="7" cy="18" r="1.8"/><circle cx="14" cy="18" r="1.8"/><path d="M17 13h3"/></svg>',
    tk_s:   SVG + '<path d="M6 16a4 4 0 0 1 0-8 5 5 0 0 1 9.5-1.5A4 4 0 1 1 18 16z"/><path d="M8 20h8"/></svg>',
    tk_w:   SVG + '<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/></svg>',
    tk_c:   SVG + '<path d="M4 20c4-2 4-6 8-8s4-6 8-8" stroke-dasharray="2 3"/><circle cx="4" cy="20" r="1.5"/><circle cx="20" cy="4" r="1.5"/></svg>'
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
    api.registerSlice("caravan", sliceGet, sliceSet, STORAGE_KEY, mergeCaravan);
  }
  function mergeCaravan(a, b) { return E.merge(a, b); }
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
  // tiles of the 12 × 18 map, origin top left (x, y the centre of a
  // cart or machine, in tiles).
  window.render_game_to_text = function () {
    if (view !== "play" || !game) {
      return JSON.stringify({ mode: dlgKind || "map", diff: prefs.diff,
        routes: E.ROUTES.map(function (rt) { return { id: rt.id, open: E.isOpen(data, rt.id), stars: E.starsOf(data, rt.id) }; }) });
    }
    var rt = rtOf();
    function r1(v) { return Math.round(v * 10) / 10; }
    return JSON.stringify({
      mode: dlgKind || (game.over === 1 ? "won" : game.over === 0 ? "lost" : game.ph === "plan" ? "plan" : paused ? "paused" : "road"),
      route: game.rt, diff: game.diff, speed: speed, trip: game.trip, trips: game.nt, coins: Math.floor(game.coins),
      got: game.got, goal: game.goal, tricks: game.tk, goat: game.goat, armed: armed,
      signs: rt.forks.map(function (n) { return { node: n, x: rt.P[n].x, y: rt.P[n].y, way: game.sg[n], dir: dirWord(n) }; }),
      way: E.wayNow(game).map(function (i) { return [rt.E[i].a, rt.E[i].b]; }),
      machines: E.activeMachines(game).map(function (i) { var m = rt.M[i]; return { k: m.k, x: m.x, y: m.y, r: E.MACHINES[m.k].r, stopped: game.mc[i].st > 0 }; }),
      carts: game.cv.map(function (c) {
        return { id: c.id, k: c.k, l: c.l, b: c.b, st: c.st, hp: r1(c.hp), x: c.st === "r" ? r1(c.x) : null, y: c.st === "r" ? r1(c.y) : null, sel: c.id === selId };
      }),
      smoke: game.sm.map(function (s) { return { x: r1(s.x), y: r1(s.y) }; }),
      markets: Object.keys(rt.P).filter(E.isEnd).map(function (n) { return { node: n, x: rt.P[n].x, y: rt.P[n].y, pay: n === "N" ? E.PAY_N : E.PAY }; }),
      note: "tiles 12x18, origin top left; the gate is at the top, the markets at the bottom (N the spice market)"
    });
  };
  // advanceTime(ms): steps the road deterministically at the current
  // speed, as if that much real time passed while playing.
  window.advanceTime = function (ms) {
    if (!running()) { draw(); return; }
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
    $("go-btn").addEventListener("click", setOff);
    $("dlg").addEventListener("close", function () { dlgKind = ""; });
    $("dlg").addEventListener("cancel", function () {
      if (dlgKind === "tour") { prefs.tour = 1; savePrefs(); }
    });
    wireInput();
    wireKeyboard();
    window.addEventListener("resize", resize);
    if (window.ResizeObserver) new ResizeObserver(resize).observe($("scene"));
    document.addEventListener("visibilitychange", function () {
      if (document.hidden) { if (underWay() && game.ph === "go") paused = true; saveSession(); renderBar(); }
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
    applyI18n();
    wire();
    registerSync();
    inheritPalette();
    watchPalette();
    // a route under way reopens (paused on the road); otherwise the road map
    if (underWay()) { if (game.ph === "go") paused = true; showPlay(); } else showMap();
    if (!prefs.tour) tourDialog();
    startLoop();
  }

  boot();
})();
