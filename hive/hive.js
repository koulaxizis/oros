// ============================================================
// orOS Hive — App logic (v1.0.0)
// An idle game: a beehive on a Greek hillside through the year. The
// bees fly to the flower patches in bloom; honey buys new patches,
// tending and hive improvements; winter eats the stores. The rules
// live in hive/engine.js (HiveEngine, tested headless); this file is
// the screen, the saves and the clock.
//   - one game month = 30 minutes; the year turns while orOS is closed
//   - away: full pace for 7 days, then half pace (never stops)
//   - a calm "While you were away" card, no notifications, no streaks
//   - Undo after every purchase, Start over with Undo
// Data:
//   - synced slice "hive" (oros-hive-data): the hive itself, as the
//     engine keeps it. Written only after a person's own action (a few
//     seconds later, so Undo stays local), or as a checkpoint when the
//     game opens after more than a day; idle minutes never write.
//     markDirty at most once every 5 minutes, and on the way out.
//     Merge: HiveEngine.merge (the further-ahead hive wins).
//   - device-local (R10): oros-hive-prefs (last seen, the tour),
//     oros-hive-session (actions so far, for gamekit/resume.js),
//     oros-hive-sfx (sound)
// Sections:
//   1. Constants, i18n, helpers
//   2. Saves: load / commit / checkpoint / dirty throttle
//   3. Clock + tick
//   4. Actions (plant, tend, improve, undo, start over)
//   5. Scene (the hillside on one canvas)
//   6. Input (tap, keyboard)
//   7. Panels (status, calendar, patch panel)
//   8. Dialogs (improvements, records, away, tour, confirm)
//   9. Toasts
//  10. Sound
//  11. Sync slice + palette
//  12. Test hooks, wiring & boot
// ============================================================
(function () {
  "use strict";

  var E = window.HiveEngine;

  var STORAGE_KEY = "oros-hive-data";
  var PREFS_KEY   = "oros-hive-prefs";
  var SESSION_KEY = "oros-hive-session";
  var SFX_KEY     = "oros-hive-sfx";
  var UNDO_MS     = 6000;              // Undo stays on screen this long
  var COMMIT_MS   = 7000;              // a purchase is saved after this
  var DIRTY_GAP   = 5 * 60000;         // markDirty at most this often
  var CHECKPOINT  = 86400000;          // open after a day away: save once
  var AWAY_MIN    = 10;                // the away card from 10 game minutes
  var FLOWER_IDS  = E.FLOWERS.map(function (f) { return f.id; });

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
      "app.name": "Hive",
      "btn.up": "Improvements", "btn.upKey": "Improvements (U)",
      "btn.stats": "Records (S)", "btn.sfxOn": "Sound on (M)", "btn.sfxOff": "Sound off (M)",
      "btn.close": "Close", "btn.ok": "Good", "btn.undo": "Undo", "btn.cancel": "Cancel",
      "btn.start": "Start over", "btn.startYes": "Start over", "btn.openUp": "Open Improvements",
      "view.label": "The hillside: the hive in the middle and the flower patches around it. Arrow keys choose a patch.",
      "num.dec": ".", "num.k": "K", "num.m": "M", "num.b": "B", "num.t": "T",
      "st.honey": "Honey", "st.wax": "Wax", "st.bees": "Bees", "st.rate": "+{n}/min",
      "st.month": "{m} · year {y}",
      "mon.0": "Jan", "mon.1": "Feb", "mon.2": "Mar", "mon.3": "Apr", "mon.4": "May", "mon.5": "Jun",
      "mon.6": "Jul", "mon.7": "Aug", "mon.8": "Sep", "mon.9": "Oct", "mon.10": "Nov", "mon.11": "Dec",
      "monl.0": "January", "monl.1": "February", "monl.2": "March", "monl.3": "April", "monl.4": "May",
      "monl.5": "June", "monl.6": "July", "monl.7": "August", "monl.8": "September", "monl.9": "October",
      "monl.10": "November", "monl.11": "December",
      "wx.fair": "fair", "wx.rain": "rain: the bees bring 30% less", "wx.heat": "heat: the bees bring 20% less without a water trough",
      "wx.heatOk": "heat: the water trough keeps the bees going",
      "cal.label": "{m}: {list}", "cal.none": "nothing in bloom", "cal.winter": "winter, the hive rests",
      "fl.almond": "Almond", "fl.orange": "Orange blossom", "fl.wild": "Wildflowers", "fl.thyme": "Thyme",
      "fl.chestnut": "Chestnut", "fl.pine": "Pine honeydew", "fl.heather": "Heather",
      "pn.hint": "Tap a patch on the hillside to plant or tend it. Fill the calendar so something is in bloom every month.",
      "pn.patch": "Patch {n}", "pn.near": "next to the hive", "pn.far": "up the hill (a quarter less honey)",
      "pn.locked": "This patch opens with the Terraces in Improvements.",
      "pn.empty": "Empty: choose what to plant.",
      "pn.blooms": "Blooms {r}", "pn.now": "in flower now", "pn.rest": "rests until {m}",
      "pn.est": "taking root: ready in {m}", "pn.tended": "tended {l}/{max}",
      "pn.tend": "Tend the patch", "pn.tendFx": "Feeds {b} more bees, +10% honey", "pn.tendMax": "Fully tended",
      "pn.plant": "Plant", "pn.replace": "Replace with", "pn.fx": "{r} · ×{y}",
      "pn.winterNeed": "Winter needs about {n} honey. The hive has {h}.",
      "pn.winterShort": "Winter needs about {n} honey and the hive has {h}: keep some back.",
      "pn.winter": "Winter: nothing blooms and the bees live on the stores.",
      "pn.cluster": "The stores ran out: the bees huddle together until spring. Nothing is lost.",
      "pn.gap": "{n} months of the year have nothing in bloom.",
      "pn.full": "Every month from February to November has something in bloom.",
      "up.title": "Improvements", "up.lv": "{l}/{max}", "up.max": "Done", "up.cost": "{h} honey", "up.costW": "{h} honey · {w} wax",
      "up.frame": "Frame", "up.frame.fx": "Room for 500 more bees. A box holds 10 frames.",
      "up.box": "Hive box", "up.box.fx": "Another box on top: room for 10 more frames.",
      "up.ent": "Wide entrance", "up.ent.fx": "The bees bring 10% more honey.",
      "up.queen": "Queen care", "up.queen.fx": "The queen lays 25% faster.",
      "up.wind": "Windbreak", "up.wind.fx": "The hive eats 15% less in winter.",
      "up.trough": "Water trough", "up.trough.fx": "Hot months no longer slow the bees.",
      "up.terr": "Terraces", "up.terr.fx": "12 more patches up the hill. They give a quarter less honey.",
      "up.note": "Honey made per minute: {r}. Honey kinds this year: {k} of {n} (+{p}%).",
      "rec.title": "Records", "rec.year": "Year", "rec.life": "Honey made in all", "rec.kinds": "Honey kinds this year",
      "rec.patches": "Patches planted", "rec.bees": "Bees", "rec.acts": "Things you did",
      "rec.note": "The hive lives on every device you use orOS on. If two devices play at the same time, the one further ahead is kept.",
      "rec.startAsk": "Start a new hive? The hive you have now goes, on every device.",
      "away.title": "While you were away", "away.hero": "+{n} honey",
      "away.time": "You were away", "away.months": "Months on the hillside", "away.honey": "Honey now", "away.bees": "Bees",
      "away.slow": "After 7 days away the hive works at half pace: it never stops, it only slows.",
      "away.cluster": "The stores ran out in winter, so the bees huddled until spring. Nothing was lost.",
      "dur.d": "{n} d", "dur.h": "{n} h", "dur.m": "{n} min",
      "tour.title": "How it works",
      "tour.1": "Your bees fly from the hive to the flower patches that are in bloom and bring back honey. One month on the hillside is half an hour.",
      "tour.2": "Every flower blooms in its own months: the calendar at the top shows them. Plant so that something blooms all year. Every different honey kind of the year gives +5%.",
      "tour.3": "Spend honey on new patches, tending and Improvements. In December and January nothing blooms and the bees eat the stores, so keep some back for winter.",
      "tour.4": "The hive goes on while orOS is closed. There is nothing to miss and nothing to collect: come back when you like.",
      "toast.plant": "{f} planted", "toast.tend": "Patch tended", "toast.up": "{u} bought", "toast.start": "A new hive",
      "toast.honey": "Not enough honey yet", "toast.wax": "Not enough wax yet", "toast.max": "Already done",
      "toast.locked": "This patch opens with the Terraces", "toast.same": "Already planted here",
      "toast.save": "Not saved: the browser's storage is full",
      "fl.sage": "Sage",
      "hs.hill": "Hill", "hs.island": "Island", "hs.mountain": "Mountain", "hs.plain": "Plain",
      "hs.hill.fx": "Every flower grows. Rain 15%, summer heat 30%.",
      "hs.island.fx": "No almond or chestnut; orange blossom and thyme give 20% more. Less rain, more heat.",
      "hs.mountain.fx": "No orange blossom; chestnut and pine give 30% more, heather 20%. Much rain, little heat.",
      "hs.plain.fx": "Wildflowers give 30% more. Hot summers.",
      "tr.hardy": "Hardy", "tr.hardy.fx": "The hive eats 20% less in winter.",
      "tr.swift": "Swift foragers", "tr.swift.fx": "15% more honey from every patch.",
      "tr.fertile": "Fertile queens", "tr.fertile.fx": "The queen lays 25% faster.",
      "tr.frugal": "Frugal", "tr.frugal.fx": "Flowers cost 10% less.",
      "tr.sturdy": "Sturdy hives", "tr.sturdy.fx": "Every new hive starts with 2 more frames.",
      "tr.sage": "Sage", "tr.sage.fx": "A new flower: sage, April and May, rich.",
      "btn.swarm": "Swarm", "btn.swarmKey": "Swarm (W)",
      "sw.title": "The colony is ready to swarm",
      "sw.msg": "It is May and the hive is full. Half the colony can leave with the old queen and found a new hive. You follow it: the new hive starts small on a new hillside, with as many bees as its frames hold, a little honey and one meadow patch. The old hive stays in the apiary and gives +2% honey for good, and the colony keeps one new trait.",
      "sw.hill": "Where to", "sw.trait": "One trait for good", "sw.go": "Let it swarm", "sw.later": "Not now",
      "sw.note": "There is no hurry: the colony can swarm every May while the hive has {n} bees. Undo takes it back for a few seconds.",
      "pn.swarm": "The colony is ready to swarm: open Swarm to see the choice. There is no hurry.",
      "rec.hives": "Hives founded", "rec.hill": "Hillside", "rec.traits": "Traits", "rec.apiary": "Apiary",
      "rec.apItem": "Hive {n} · {hs} · {y} years · {h} honey", "rec.apNone": "No old hives yet: the first swarm starts the apiary.",
      "rec.apBonus": "+{p}% honey from the apiary", "rec.none": "none yet", "rec.hum": "The hum of the hive",
      "toast.swarm": "The swarm found a new home: {hs}", "toast.nogrow": "That flower does not grow on this hillside",
      "toast.noswarm": "The colony swarms only in May, with {n} bees",
      "live.sel": "{p}. {s}"
    },
    el: {
      "app.name": "Κυψέλη",
      "btn.up": "Βελτιώσεις", "btn.upKey": "Βελτιώσεις (U)",
      "btn.stats": "Αρχείο (S)", "btn.sfxOn": "Ήχος ανοιχτός (M)", "btn.sfxOff": "Ήχος κλειστός (M)",
      "btn.close": "Κλείσιμο", "btn.ok": "Ωραία", "btn.undo": "Αναίρεση", "btn.cancel": "Άκυρο",
      "btn.start": "Από την αρχή", "btn.startYes": "Νέα κυψέλη", "btn.openUp": "Άνοιξε τις Βελτιώσεις",
      "view.label": "Η πλαγιά: η κυψέλη στη μέση και τα λουλούδια γύρω της. Με τα βελάκια διαλέγεις κομμάτι.",
      "num.dec": ",", "num.k": " χιλ.", "num.m": " εκ.", "num.b": " δισ.", "num.t": " τρισ.",
      "st.honey": "Μέλι", "st.wax": "Κερί", "st.bees": "Μέλισσες", "st.rate": "+{n}/λεπτό",
      "st.month": "{m} · χρονιά {y}",
      "mon.0": "Ιαν", "mon.1": "Φεβ", "mon.2": "Μαρ", "mon.3": "Απρ", "mon.4": "Μάι", "mon.5": "Ιουν",
      "mon.6": "Ιουλ", "mon.7": "Αύγ", "mon.8": "Σεπ", "mon.9": "Οκτ", "mon.10": "Νοε", "mon.11": "Δεκ",
      "monl.0": "Ιανουάριος", "monl.1": "Φεβρουάριος", "monl.2": "Μάρτιος", "monl.3": "Απρίλιος", "monl.4": "Μάιος",
      "monl.5": "Ιούνιος", "monl.6": "Ιούλιος", "monl.7": "Αύγουστος", "monl.8": "Σεπτέμβριος", "monl.9": "Οκτώβριος",
      "monl.10": "Νοέμβριος", "monl.11": "Δεκέμβριος",
      "wx.fair": "καλός καιρός", "wx.rain": "βροχή: οι μέλισσες φέρνουν 30% λιγότερο", "wx.heat": "καύσωνας: χωρίς ποτίστρα οι μέλισσες φέρνουν 20% λιγότερο",
      "wx.heatOk": "καύσωνας: η ποτίστρα κρατά τις μέλισσες σε δουλειά",
      "cal.label": "{m}: {list}", "cal.none": "δεν ανθίζει τίποτα", "cal.winter": "χειμώνας, η κυψέλη ξεκουράζεται",
      "fl.almond": "Αμυγδαλιά", "fl.orange": "Ανθός πορτοκαλιάς", "fl.wild": "Αγριολούλουδα", "fl.thyme": "Θυμάρι",
      "fl.chestnut": "Καστανιά", "fl.pine": "Πεύκο", "fl.heather": "Ρείκι",
      "pn.hint": "Πάτα ένα κομμάτι της πλαγιάς για να φυτέψεις ή να το περιποιηθείς. Γέμισε το ημερολόγιο ώστε κάθε μήνα κάτι να ανθίζει.",
      "pn.patch": "Κομμάτι {n}", "pn.near": "δίπλα στην κυψέλη", "pn.far": "ψηλά στην πλαγιά (ένα τέταρτο λιγότερο μέλι)",
      "pn.locked": "Αυτό το κομμάτι ανοίγει με τις Πεζούλες στις Βελτιώσεις.",
      "pn.empty": "Άδειο: διάλεξε τι θα φυτέψεις.",
      "pn.blooms": "Ανθίζει {r}", "pn.now": "ανθισμένο τώρα", "pn.rest": "ξεκουράζεται ως τον {m}",
      "pn.est": "ριζώνει: έτοιμο τον {m}", "pn.tended": "περιποίηση {l}/{max}",
      "pn.tend": "Περιποίηση", "pn.tendFx": "Τρέφει {b} μέλισσες ακόμα, +10% μέλι", "pn.tendMax": "Πλήρης περιποίηση",
      "pn.plant": "Φύτεψε", "pn.replace": "Αντικατάσταση με", "pn.fx": "{r} · ×{y}",
      "pn.winterNeed": "Ο χειμώνας θέλει περίπου {n} μέλι. Η κυψέλη έχει {h}.",
      "pn.winterShort": "Ο χειμώνας θέλει περίπου {n} μέλι και η κυψέλη έχει {h}: κράτα λίγο στην άκρη.",
      "pn.winter": "Χειμώνας: δεν ανθίζει τίποτα και οι μέλισσες τρώνε από τα αποθέματα.",
      "pn.cluster": "Τα αποθέματα τελείωσαν: οι μέλισσες μαζεύονται ζεστά ως την άνοιξη. Δεν χάνεται τίποτα.",
      "pn.gap": "{n} μήνες της χρονιάς δεν ανθίζει τίποτα.",
      "pn.full": "Κάθε μήνα από τον Φεβρουάριο ως τον Νοέμβριο κάτι ανθίζει.",
      "up.title": "Βελτιώσεις", "up.lv": "{l}/{max}", "up.max": "Έγινε", "up.cost": "{h} μέλι", "up.costW": "{h} μέλι · {w} κερί",
      "up.frame": "Πλαίσιο", "up.frame.fx": "Χώρος για 500 μέλισσες ακόμα. Ένας όροφος χωρά 10 πλαίσια.",
      "up.box": "Όροφος κυψέλης", "up.box.fx": "Ένας ακόμα όροφος από πάνω: χώρος για 10 πλαίσια ακόμα.",
      "up.ent": "Φαρδιά είσοδος", "up.ent.fx": "Οι μέλισσες φέρνουν 10% περισσότερο μέλι.",
      "up.queen": "Φροντίδα βασίλισσας", "up.queen.fx": "Η βασίλισσα γεννά 25% πιο γρήγορα.",
      "up.wind": "Ανεμοφράκτης", "up.wind.fx": "Η κυψέλη τρώει 15% λιγότερο τον χειμώνα.",
      "up.trough": "Ποτίστρα", "up.trough.fx": "Οι ζεστοί μήνες δεν κόβουν πια τη δουλειά.",
      "up.terr": "Πεζούλες", "up.terr.fx": "12 κομμάτια ακόμα ψηλά στην πλαγιά. Δίνουν ένα τέταρτο λιγότερο μέλι.",
      "up.note": "Μέλι ανά λεπτό: {r}. Είδη μελιού φέτος: {k} από {n} (+{p}%).",
      "rec.title": "Αρχείο", "rec.year": "Χρονιά", "rec.life": "Μέλι συνολικά", "rec.kinds": "Είδη μελιού φέτος",
      "rec.patches": "Φυτεμένα κομμάτια", "rec.bees": "Μέλισσες", "rec.acts": "Κινήσεις σου",
      "rec.note": "Η κυψέλη είναι ίδια σε κάθε συσκευή όπου χρησιμοποιείς το orOS. Αν παίξουν δύο συσκευές ταυτόχρονα, κρατιέται αυτή που έχει προχωρήσει περισσότερο.",
      "rec.startAsk": "Να ξεκινήσει νέα κυψέλη; Η τωρινή χάνεται σε όλες τις συσκευές.",
      "away.title": "Όσο έλειπες", "away.hero": "+{n} μέλι",
      "away.time": "Έλειπες", "away.months": "Μήνες στην πλαγιά", "away.honey": "Μέλι τώρα", "away.bees": "Μέλισσες",
      "away.slow": "Μετά από 7 μέρες απουσίας η κυψέλη δουλεύει με μισή ταχύτητα: δεν σταματά ποτέ, απλώς πάει πιο αργά.",
      "away.cluster": "Τα αποθέματα τελείωσαν τον χειμώνα και οι μέλισσες μαζεύτηκαν ζεστά ως την άνοιξη. Δεν χάθηκε τίποτα.",
      "dur.d": "{n} μ.", "dur.h": "{n} ώ.", "dur.m": "{n} λεπ.",
      "tour.title": "Πώς παίζεται",
      "tour.1": "Οι μέλισσές σου πετούν από την κυψέλη στα ανθισμένα λουλούδια και φέρνουν μέλι. Ένας μήνας στην πλαγιά κρατά μισή ώρα.",
      "tour.2": "Κάθε λουλούδι ανθίζει τους δικούς του μήνες: τους δείχνει το ημερολόγιο επάνω. Φύτεψε ώστε κάτι να ανθίζει όλη τη χρονιά. Κάθε διαφορετικό είδος μελιού της χρονιάς δίνει +5%.",
      "tour.3": "Με το μέλι αγοράζεις νέα κομμάτια, περιποίηση και Βελτιώσεις. Τον Δεκέμβριο και τον Ιανουάριο δεν ανθίζει τίποτα και οι μέλισσες τρώνε από τα αποθέματα, οπότε κράτα λίγο για τον χειμώνα.",
      "tour.4": "Η κυψέλη συνεχίζει και όταν το orOS είναι κλειστό. Δεν χάνεις τίποτα και δεν έχεις τίποτα να μαζέψεις: έλα όποτε θέλεις.",
      "toast.plant": "Φυτεύτηκε: {f}", "toast.tend": "Το κομμάτι περιποιήθηκε", "toast.up": "Αγοράστηκε: {u}", "toast.start": "Νέα κυψέλη",
      "toast.honey": "Δεν φτάνει ακόμα το μέλι", "toast.wax": "Δεν φτάνει ακόμα το κερί", "toast.max": "Έχει ήδη γίνει",
      "toast.locked": "Αυτό το κομμάτι ανοίγει με τις Πεζούλες", "toast.same": "Είναι ήδη φυτεμένο εδώ",
      "toast.save": "Δεν αποθηκεύτηκε: ο χώρος του προγράμματος περιήγησης γέμισε",
      "fl.sage": "Φασκόμηλο",
      "hs.hill": "Λόφος", "hs.island": "Νησί", "hs.mountain": "Βουνό", "hs.plain": "Κάμπος",
      "hs.hill.fx": "Φυτρώνουν όλα τα λουλούδια. Βροχή 15%, καύσωνας το καλοκαίρι 30%.",
      "hs.island.fx": "Χωρίς αμυγδαλιά και καστανιά. Ο ανθός πορτοκαλιάς και το θυμάρι δίνουν 20% περισσότερο. Λιγότερη βροχή, περισσότερη ζέστη.",
      "hs.mountain.fx": "Χωρίς ανθό πορτοκαλιάς. Η καστανιά και το πεύκο δίνουν 30% περισσότερο, το ρείκι 20%. Πολλή βροχή, λίγη ζέστη.",
      "hs.plain.fx": "Τα αγριολούλουδα δίνουν 30% περισσότερο. Ζεστά καλοκαίρια.",
      "tr.hardy": "Ανθεκτικές", "tr.hardy.fx": "Η κυψέλη τρώει 20% λιγότερο τον χειμώνα.",
      "tr.swift": "Γρήγορες συλλέκτριες", "tr.swift.fx": "15% περισσότερο μέλι από κάθε κομμάτι.",
      "tr.fertile": "Γόνιμες βασίλισσες", "tr.fertile.fx": "Η βασίλισσα γεννά 25% πιο γρήγορα.",
      "tr.frugal": "Οικονόμες", "tr.frugal.fx": "Τα λουλούδια κοστίζουν 10% λιγότερο.",
      "tr.sturdy": "Γερές κυψέλες", "tr.sturdy.fx": "Κάθε νέα κυψέλη ξεκινά με 2 πλαίσια ακόμα.",
      "tr.sage": "Φασκόμηλο", "tr.sage.fx": "Ένα νέο λουλούδι: το φασκόμηλο, Απρίλιο και Μάιο, πλούσιο.",
      "btn.swarm": "Σμηνουργία", "btn.swarmKey": "Σμηνουργία (W)",
      "sw.title": "Το μελίσσι είναι έτοιμο να σμηνουργήσει",
      "sw.msg": "Είναι Μάιος και η κυψέλη γέμισε. Το μισό μελίσσι μπορεί να φύγει με την παλιά βασίλισσα και να φτιάξει νέα κυψέλη. Το ακολουθείς: η νέα κυψέλη ξεκινά μικρή σε μια νέα πλαγιά, με όσες μέλισσες χωρούν τα πλαίσιά της, λίγο μέλι και ένα κομμάτι με αγριολούλουδα. Η παλιά κυψέλη μένει στο μελισσοκομείο και δίνει για πάντα +2% μέλι, και το μελίσσι κρατά ένα νέο χαρακτηριστικό.",
      "sw.hill": "Πού θα πάει", "sw.trait": "Ένα χαρακτηριστικό για πάντα", "sw.go": "Άφησέ το να σμηνουργήσει", "sw.later": "Όχι τώρα",
      "sw.note": "Δεν βιάζεσαι: το μελίσσι μπορεί να σμηνουργήσει κάθε Μάιο όσο η κυψέλη έχει {n} μέλισσες. Η Αναίρεση την παίρνει πίσω για λίγα δευτερόλεπτα.",
      "pn.swarm": "Το μελίσσι είναι έτοιμο να σμηνουργήσει: άνοιξε τη Σμηνουργία για να δεις την επιλογή. Δεν βιάζεσαι.",
      "rec.hives": "Κυψέλες που ιδρύθηκαν", "rec.hill": "Πλαγιά", "rec.traits": "Χαρακτηριστικά", "rec.apiary": "Μελισσοκομείο",
      "rec.apItem": "Κυψέλη {n} · {hs} · {y} χρονιές · {h} μέλι", "rec.apNone": "Δεν υπάρχουν ακόμα παλιές κυψέλες: η πρώτη σμηνουργία ξεκινά το μελισσοκομείο.",
      "rec.apBonus": "+{p}% μέλι από το μελισσοκομείο", "rec.none": "κανένα ακόμα", "rec.hum": "Το βουητό της κυψέλης",
      "toast.swarm": "Το σμήνος βρήκε νέο σπίτι: {hs}", "toast.nogrow": "Αυτό το λουλούδι δεν φυτρώνει σε αυτή την πλαγιά",
      "toast.noswarm": "Το μελίσσι σμηνουργεί μόνο τον Μάιο, με {n} μέλισσες",
      "live.sel": "{p}. {s}"
    }
  };
  if (window.orosI18n) window.orosI18n.table(STRINGS, "hive", LANG);

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
  function clone(x) { return JSON.parse(JSON.stringify(x)); }

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
  function fmtDur(ms) {
    var m = Math.floor(ms / 60000), d = Math.floor(m / 1440), h = Math.floor((m % 1440) / 60);
    if (d > 0) return t("dur.d", { n: d }) + (h ? " " + t("dur.h", { n: h }) : "");
    if (h > 0) return t("dur.h", { n: h }) + (m % 60 ? " " + t("dur.m", { n: m % 60 }) : "");
    return t("dur.m", { n: m });
  }
  // Months in bloom as a short range: "Jun–Aug", "Feb".
  function monthRange(ms) {
    if (!ms.length) return "";
    if (ms.length === 1) return t("mon." + ms[0]);
    return t("mon." + ms[0]) + "–" + t("mon." + ms[ms.length - 1]);
  }
  function flName(id) { return t("fl." + id); }
  // The flowers that grow on this hive's hillside, in the fixed order.
  function avail() { return FLOWER_IDS.filter(function (f) { return E.flowerOk(live, f); }); }

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
    console.log("hive.js v" + (SCRIPT_V || "?") + " boot");
  })();

  // ---------- 2. Saves ----------
  // saved = the hive as last written (what syncs); live = the same hive
  // brought to the clock now. live = saved stepped by the time since
  // saved.at, so nothing is lost when only saved is kept.
  var saved = null, stored = false, live = null;
  var prefs = { seen: 0, seenLife: 0, seenMin: 0, tour: 0 };
  var pending = null;                  // { timer } a purchase not yet written
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
        ["seen", "seenLife", "seenMin", "tour"].forEach(function (k) {
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
  // The person's own change: written COMMIT_MS later (Undo stays local
  // until then), then marked dirty through the throttle.
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
  // A checkpoint (opened after a day away): written, never marked dirty.
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
  // On the way out: write what is waiting, send it, remember when.
  function flushOut() {
    if (pending) commitNow();
    if (dirtyWaiting) markDirty();
    undo = null;
    hideToast();
    if (live) {
      E.catchUp(live, nowMs());
      prefs.seen = nowMs(); prefs.seenLife = live.life; prefs.seenMin = live.min;
      savePrefs();
    }
  }

  // ---------- 3. Clock + tick ----------
  var clockOff = 0;                     // advanceTime() moves the clock (tests)
  function nowMs() { return Date.now() + clockOff; }
  var tickTimer = null, lastPanelKey = "";
  function tick() {
    if (!live) return;
    E.catchUp(live, nowMs());
    renderStatus();
    renderCal();
    refreshPanel();
    refreshDialog();
    if (hum || humOn()) updateHum();
    if (reduced || document.hidden) draw();
  }

  // ---------- 4. Actions ----------
  function doAct(a, okToast) {
    E.catchUp(live, nowMs());
    if (pending) commitNow();          // the previous purchase is written first
    var snap = E.clone(live);
    var err = E.act(live, a);
    if (err) {
      showToast(t("toast." + (err === "bad" ? "honey" : err), { n: fmt(E.SWARM_BEES) }));
      sfx("no");
      return false;
    }
    undo = { snap: snap, kind: a.t };
    commitSoon();
    sfx(a.t === "up" ? "up" : "plant");
    showToast(okToast, true);
    renderAll(true);
    return true;
  }
  function plant(slot, fid) {
    return doAct({ t: "plant", slot: slot, f: fid }, t("toast.plant", { f: flName(fid) }));
  }
  function tend(slot) { return doAct({ t: "tend", slot: slot }, t("toast.tend")); }
  function improve(uid) { return doAct({ t: "up", u: uid }, t("toast.up", { u: t("up." + uid) })); }
  function undoLast() {
    if (!undo) return;
    var u = undo;
    undo = null;
    // a purchase is not written yet: dropping it is enough
    if (pending) { clearTimeout(pending.timer); pending = null; }
    live = u.snap;
    E.catchUp(live, nowMs());
    // Start over was written at once: the old hive is written back
    if (u.kind === "start") { saved = E.normalize(live); if (writeSaved()) dirtySoon(); }
    hideToast();
    sfx("undo");
    renderAll(true);
  }
  // Start over: a new hive with a new reset stamp (it wins on every
  // device). Undo brings the old hive back with the NEW stamp, so the
  // reset cannot come back from the cloud either.
  function startOver() {
    if (pending) commitNow();
    E.catchUp(live, nowMs());
    var br = Math.max(nowMs(), saved.br + 1);
    var old = E.clone(live);
    old.br = br;
    live = E.newGame(newSeed(), nowMs(), br);
    undo = { snap: old, kind: "start" };
    saved = E.normalize(live);
    if (writeSaved()) dirtySoon();
    sel = -1;
    closeDialog();
    showToast(t("toast.start"), true);
    renderAll(true);
  }

  // ---------- 5. Scene ----------
  var canvas, ctx, dpr = 1, W = 0, H = 0, size = 20, cx = 0, cy = 0;
  var sel = -1;                         // the chosen patch, -1 none
  var reduced = false;
  var C = {};
  // The hillside shows in the grass: sand on the island, stone on the
  // mountain, sun on the plain.
  var HILL_TINT = { island: "rgba(232,205,140,0.22)", mountain: "rgba(120,135,160,0.25)", plain: "rgba(235,225,110,0.16)" };
  var FCOL = { sage: "#7fc4b0", almond: "#f4b6c8", orange: "#ffb347", wild: "#e06c9f", thyme: "#9b7fe0",
               chestnut: "#d9c27a", pine: "#5fae6b", heather: "#c77dd6" };

  function readColors() {
    var cs = getComputedStyle(document.documentElement);
    ["--text", "--text-dim", "--accent", "--border", "--panel-bg", "--danger", "--bg",
     "--hv-ground", "--hv-grass", "--hv-grass2", "--hv-lock", "--hv-comb", "--hv-honey",
     "--hv-wax", "--hv-bee", "--hv-winter"].forEach(function (v) {
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
    // The hillside is 5 hexes wide and 8 sizes high (rings 1 and 2).
    size = Math.max(8, Math.min(W / (5 * Math.sqrt(3) + 0.6), H / 8.4));
    cx = W / 2; cy = H / 2;
    draw();
  }
  function hexXY(q, r) { return [cx + size * Math.sqrt(3) * (q + r / 2), cy + size * 1.5 * r]; }
  function slotXY(i) { var s = E.SLOTS[i]; return hexXY(s.q, s.r); }
  function hexPath(x, y, r) {
    ctx.beginPath();
    for (var k = 0; k < 6; k++) {
      var a = Math.PI / 180 * (60 * k - 30);
      var px = x + r * Math.cos(a), py = y + r * Math.sin(a);
      if (k) ctx.lineTo(px, py); else ctx.moveTo(px, py);
    }
    ctx.closePath();
  }
  // One shape per flower, so colour is never the only sign.
  function shapePath(c, f, x, y, r) {
    c.beginPath();
    if (f === "almond") c.arc(x, y, r, 0, Math.PI * 2);
    else if (f === "orange") c.rect(x - r * 0.85, y - r * 0.85, r * 1.7, r * 1.7);
    else if (f === "wild") { c.moveTo(x, y - r); c.lineTo(x + r, y + r * 0.8); c.lineTo(x - r, y + r * 0.8); c.closePath(); }
    else if (f === "sage") { c.arc(x, y, r, 0, Math.PI * 2); c.moveTo(x + r * 0.45, y); c.arc(x, y, r * 0.45, 0, Math.PI * 2, true); }
    else if (f === "thyme") { c.moveTo(x, y - r); c.lineTo(x + r, y); c.lineTo(x, y + r); c.lineTo(x - r, y); c.closePath(); }
    else if (f === "chestnut") {
      for (var k = 0; k < 10; k++) {
        var a = -Math.PI / 2 + k * Math.PI / 5, rr = k % 2 ? r * 0.45 : r;
        if (k) c.lineTo(x + rr * Math.cos(a), y + rr * Math.sin(a)); else c.moveTo(x + rr * Math.cos(a), y + rr * Math.sin(a));
      }
      c.closePath();
    } else if (f === "pine") { c.moveTo(x, y - r); c.lineTo(x + r * 0.8, y + r * 0.2); c.lineTo(x + r * 0.35, y + r * 0.2); c.lineTo(x + r * 0.9, y + r); c.lineTo(x - r * 0.9, y + r); c.lineTo(x - r * 0.35, y + r * 0.2); c.lineTo(x - r * 0.8, y + r * 0.2); c.closePath(); }
    else { var w = r * 0.38; c.moveTo(x - w, y - r); c.lineTo(x + w, y - r); c.lineTo(x + w, y - w); c.lineTo(x + r, y - w); c.lineTo(x + r, y + w); c.lineTo(x + w, y + w); c.lineTo(x + w, y + r); c.lineTo(x - w, y + r); c.lineTo(x - w, y + w); c.lineTo(x - r, y + w); c.lineTo(x - r, y - w); c.lineTo(x - w, y - w); c.closePath(); }
  }
  function draw(time) {
    if (!ctx || !live) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = C["hv-ground"];
    ctx.fillRect(0, 0, W, H);
    var m = E.monthOf(live.min), winter = E.isWinter(m), open = E.slotsOpen(live);
    var fed = {};
    if (!winter) E.forage(live, m).forEach(function (p) { fed[p.i] = p.bees; });
    // patches
    for (var i = 0; i < E.SLOTS.length; i++) {
      var xy = slotXY(i), sl = live.slots[i], locked = i >= open;
      hexPath(xy[0], xy[1], size * 0.94);
      ctx.fillStyle = locked ? C["hv-lock"] : (E.SLOTS[i].ring === 1 ? C["hv-grass2"] : C["hv-grass"]);
      ctx.fill();
      if (!locked && HILL_TINT[live.hs]) { ctx.fillStyle = HILL_TINT[live.hs]; ctx.fill(); }
      if (winter && !locked) { ctx.fillStyle = "rgba(200,220,235,0.18)"; ctx.fill(); }
      ctx.lineWidth = 1; ctx.strokeStyle = C.border; ctx.stroke();
      if (locked) {
        drawLock(xy[0], xy[1], size * 0.28);
      } else if (sl) {
        var ready = E.established(live, sl), bloom = ready && E.blooms(sl.f, m) && !winter;
        ctx.globalAlpha = bloom ? 1 : (ready ? 0.45 : 0.3);
        var r = size * (bloom ? 0.42 : 0.32);
        // a few small flowers around the main one when in bloom
        if (bloom) {
          for (var k = 0; k < 6; k++) {
            var a = k * Math.PI / 3 + 0.4;
            shapePath(ctx, sl.f, xy[0] + Math.cos(a) * size * 0.6, xy[1] + Math.sin(a) * size * 0.6, size * 0.11);
            ctx.fillStyle = FCOL[sl.f]; ctx.fill();
          }
        }
        shapePath(ctx, sl.f, xy[0], xy[1], r);
        ctx.fillStyle = FCOL[sl.f]; ctx.fill();
        ctx.lineWidth = 1.5; ctx.strokeStyle = "rgba(0,0,0,0.35)"; ctx.stroke();
        if (!ready) { ctx.setLineDash([3, 3]); hexPath(xy[0], xy[1], size * 0.7); ctx.strokeStyle = C.text; ctx.stroke(); ctx.setLineDash([]); }
        ctx.globalAlpha = 1;
        if (sl.l > 0) {
          ctx.font = "800 " + Math.max(9, Math.round(size * 0.26)) + "px Nunito, sans-serif";
          ctx.textAlign = "center"; ctx.textBaseline = "middle";
          ctx.fillStyle = C.text;
          ctx.fillText("+" + sl.l, xy[0], xy[1] + size * 0.66);
        }
      } else {
        ctx.fillStyle = C["text-dim"];
        ctx.globalAlpha = 0.6;
        ctx.font = "700 " + Math.round(size * 0.5) + "px Nunito, sans-serif";
        ctx.textAlign = "center"; ctx.textBaseline = "middle";
        ctx.fillText("+", xy[0], xy[1]);
        ctx.globalAlpha = 1;
      }
      if (i === sel) {
        hexPath(xy[0], xy[1], size * 0.9);
        ctx.lineWidth = 3; ctx.strokeStyle = C.accent; ctx.stroke();
      }
    }
    drawHive(winter);
    if (!winter) drawBees(fed, time || 0);
  }
  function drawLock(x, y, r) {
    ctx.strokeStyle = C["text-dim"]; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(x, y - r * 0.3, r * 0.6, Math.PI, 0); ctx.stroke();
    ctx.fillStyle = C["text-dim"];
    ctx.fillRect(x - r * 0.85, y - r * 0.3, r * 1.7, r * 1.3);
  }
  // The hive: a comb of 19 small cells that fill with honey kinds.
  function drawHive(winter) {
    hexPath(cx, cy, size * 0.98);
    ctx.fillStyle = C["hv-comb"]; ctx.fill();
    ctx.lineWidth = 2; ctx.strokeStyle = C.accent; ctx.stroke();
    var kinds = live.kinds, ids = Object.keys(kinds), total = 0;
    ids.forEach(function (k) { total += kinds[k]; });
    // how full: honey against two winters' need, at least a little
    var need = Math.max(1, E.winterNeed(live) * 2);
    var full = Math.max(0, Math.min(1, live.honey / need));
    var cells = [[0, 0]], dirs = [[1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1]];
    for (var ring = 1; ring <= 2; ring++) {
      var q = -ring, r = ring;
      for (var side = 0; side < 6; side++) for (var k = 0; k < ring; k++) { cells.push([q, r]); q += dirs[side][0]; r += dirs[side][1]; }
    }
    var cs = size * 0.19, nFull = Math.round(full * cells.length);
    // order cells by kind share: the kinds made this year, largest first
    ids.sort(function (a, b) { return kinds[b] - kinds[a] || (a < b ? -1 : 1); });
    var share = [], acc = 0;
    ids.forEach(function (k) { acc += kinds[k] / (total || 1); share.push([k, acc]); });
    for (var i = 0; i < cells.length; i++) {
      var x = cx + cs * Math.sqrt(3) * (cells[i][0] + cells[i][1] / 2), y = cy + cs * 1.5 * cells[i][1];
      hexPath(x, y, cs * 0.92);
      if (i < nFull) {
        var f = null, pos = (i + 0.5) / Math.max(1, nFull);
        for (var j = 0; j < share.length; j++) if (pos <= share[j][1] + 1e-9) { f = share[j][0]; break; }
        ctx.fillStyle = C["hv-honey"]; ctx.fill();
        if (f) { ctx.globalAlpha = 0.35; ctx.fillStyle = FCOL[f]; ctx.fill(); ctx.globalAlpha = 1; }
      } else {
        ctx.fillStyle = "rgba(0,0,0,0.25)"; ctx.fill();
      }
      ctx.lineWidth = 1; ctx.strokeStyle = C["hv-wax"]; ctx.stroke();
    }
    if (winter) {
      ctx.fillStyle = C["hv-winter"];
      ctx.font = "800 " + Math.round(size * 0.3) + "px Nunito, sans-serif";
      ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillText("❄", cx, cy - size * 0.62);
    }
  }
  // Bees: dots going out to the patches that feed them and back.
  function drawBees(fed, time) {
    var ids = Object.keys(fed);
    if (!ids.length) return;
    var total = 0;
    ids.forEach(function (i) { total += fed[i]; });
    var dots = Math.min(48, Math.max(3 * ids.length, Math.round(total / 60)));
    ctx.fillStyle = C["hv-bee"];
    var k = 0;
    ids.forEach(function (i) {
      var n = Math.max(1, Math.round(dots * fed[i] / total)), xy = slotXY(+i);
      for (var j = 0; j < n; j++, k++) {
        var ph = reduced ? (j + 0.5) / n : ((time / 2600) + j / n + (+i) * 0.13) % 1;
        var tri = ph < 0.5 ? ph * 2 : 2 - ph * 2;
        var side = Math.sin((j * 2.3 + (+i)) * 1.7) * size * 0.25;
        var dx = xy[0] - cx, dy = xy[1] - cy, len = Math.sqrt(dx * dx + dy * dy) || 1;
        var x = cx + dx * (0.2 + 0.7 * tri) - dy / len * side * Math.sin(tri * Math.PI);
        var y = cy + dy * (0.2 + 0.7 * tri) + dx / len * side * Math.sin(tri * Math.PI);
        ctx.beginPath(); ctx.arc(x, y, Math.max(1.8, size * 0.06), 0, Math.PI * 2); ctx.fill();
      }
    });
  }
  var rafOn = false, lastFrame = 0;
  function frame(ts) {
    if (!rafOn) return;
    if (ts - lastFrame >= 33) { lastFrame = ts; draw(ts); }
    requestAnimationFrame(frame);
  }
  function startAnim() {
    if (reduced || rafOn || document.hidden) { draw(); return; }
    rafOn = true;
    requestAnimationFrame(frame);
  }
  function stopAnim() { rafOn = false; }

  // ---------- 6. Input ----------
  function slotAt(x, y) {
    var best = -2, bd = size * 0.92;
    var dh = Math.sqrt((x - cx) * (x - cx) + (y - cy) * (y - cy));
    if (dh < bd) return -1;       // the hive itself
    for (var i = 0; i < E.SLOTS.length; i++) {
      var xy = slotXY(i), d = Math.sqrt((x - xy[0]) * (x - xy[0]) + (y - xy[1]) * (y - xy[1]));
      if (d < bd) { bd = d; best = i; }
    }
    return best;
  }
  function choose(i) {
    sel = i;
    renderPanel();
    draw();
    if (i >= 0) live_(t("live.sel", { p: t("pn.patch", { n: i + 1 }), s: patchState(i) }));
  }
  function wireInput() {
    canvas.addEventListener("pointerdown", function (ev) {
      var r = canvas.getBoundingClientRect();
      var hit = slotAt(ev.clientX - r.left, ev.clientY - r.top);
      if (hit === -1) { upDialog(); return; }
      if (hit < 0) { choose(-1); return; }
      choose(hit === sel ? -1 : hit);
    });
    canvas.addEventListener("keydown", function (ev) {
      var n = E.SLOTS.length;
      if (ev.key === "ArrowRight" || ev.key === "ArrowDown") { choose(sel < 0 ? 0 : (sel + (ev.key === "ArrowDown" ? 6 : 1)) % n); ev.preventDefault(); }
      else if (ev.key === "ArrowLeft" || ev.key === "ArrowUp") { choose(sel < 0 ? n - 1 : (sel - (ev.key === "ArrowUp" ? 6 : 1) + n) % n); ev.preventDefault(); }
      else if (ev.key === "Enter" && sel >= 0) {
        var b = $("panel").querySelector("button:not([disabled])");
        if (b) b.focus();
        ev.preventDefault();
      } else if (ev.key === "Escape" && sel >= 0) { choose(-1); ev.preventDefault(); }
    });
  }
  function wireKeyboard() {
    document.addEventListener("keydown", function (ev) {
      if (ev.ctrlKey || ev.altKey || ev.metaKey) return;
      if ($("dlg").open) return;
      var k = ev.key.toLowerCase();
      var av = avail();
      if (/^[1-9]$/.test(k) && +k <= av.length && sel >= 0 && sel < E.slotsOpen(live)) { plant(sel, av[+k - 1]); ev.preventDefault(); }
      else if (k === "w") { swarmDialog(); ev.preventDefault(); }
      else if (k === "t" && sel >= 0 && live.slots[sel]) { tend(sel); ev.preventDefault(); }
      else if (k === "u") { upDialog(); ev.preventDefault(); }
      else if (k === "s") { recDialog(); ev.preventDefault(); }
      else if (k === "m") { toggleSfx(); ev.preventDefault(); }
      else if (k === "z" && undo) { undoLast(); ev.preventDefault(); }
    });
  }

  // ---------- 7. Panels ----------
  function renderAll(full) {
    renderStatus();
    renderCal();
    if (full) renderPanel(); else refreshPanel();
    refreshDialog(full);
    draw();
  }
  function renderStatus() {
    var r = E.rates(live), y = E.yearOf(live.min) + 1, m = E.monthOf(live.min);
    var h = $("s-honey");
    h.querySelector(".v").textContent = fmt(live.honey);
    h.querySelector(".r").textContent = r.honey > 0 ? t("st.rate", { n: fmtRate(r.honey) }) : "";
    h.title = t("st.honey");
    $("s-wax").querySelector(".v").textContent = fmt(live.wax);
    $("s-wax").title = t("st.wax");
    $("s-bees").querySelector(".v").textContent = fmt(live.bees) + "/" + fmt(E.capacity(live));
    $("s-bees").title = t("st.bees");
    $("s-month").querySelector(".v").textContent = t("st.month", { m: t("mon." + m), y: y });
    var w = E.weather(live.seed, y - 1, m, live.hs);
    $("s-month").title = t("monl." + m) + ": " + wxText(w);
    var low = E.monthOf(live.min) >= 8 && E.monthOf(live.min) <= 10 && live.honey < E.winterNeed(live);
    h.classList.toggle("low", low || !!live.cl);
    var can = E.canSwarm(live), swb = $("sw-btn");
    if (swb.hidden === can) swb.hidden = !can;
    $("tb-hill").textContent = t("hs." + live.hs);
  }
  function wxText(w) { return t(w === "heat" && live.lv.trough ? "wx.heatOk" : "wx." + w); }
  var calKey = "";
  function renderCal() {
    var y = E.yearOf(live.min), m = E.monthOf(live.min), open = E.slotsOpen(live);
    var planted = {};
    for (var i = 0; i < open; i++) if (live.slots[i]) planted[live.slots[i].f] = true;
    var key = [y, m, Object.keys(planted).sort().join(","), live.lv.trough, LANG].join("|");
    if (key === calKey) return;
    calKey = key;
    var box = $("cal");
    box.textContent = "";
    for (var mo = 0; mo < 12; mo++) {
      // the months gone this year show next year's weather
      var yy = mo < m ? y + 1 : y;
      var w = E.weather(live.seed, yy, mo, live.hs);
      var cell = el("div", "cm" + (mo === m ? " now" : "") + (E.isWinter(mo) ? " winter" : ""));
      cell.setAttribute("role", "listitem");
      cell.appendChild(el("span", "", t("mon." + mo)));
      var wx = el("span", "wx " + w);
      if (w === "rain") wx.innerHTML = ICONS.rain;
      else if (w === "heat") wx.innerHTML = ICONS.heat;
      cell.appendChild(wx);
      var bl = el("span", "bl"), names = [];
      FLOWER_IDS.forEach(function (f) {
        if (planted[f] && E.blooms(f, mo)) { bl.appendChild(swatch(f, 8)); names.push(flName(f)); }
      });
      if (!names.length && !E.isWinter(mo)) cell.classList.add("gap");
      cell.appendChild(bl);
      var label = E.isWinter(mo) ? t("cal.winter") : (names.length ? names.join(", ") : t("cal.none"));
      if (w !== "fair") label += "; " + wxText(w);
      cell.setAttribute("aria-label", t("cal.label", { m: t("monl." + mo), list: label }));
      cell.title = t("cal.label", { m: t("monl." + mo), list: label });
      box.appendChild(cell);
    }
  }
  function swatch(f, px) {
    var c = document.createElement("canvas");
    var d = window.devicePixelRatio || 1;
    c.width = Math.ceil(px * d); c.height = Math.ceil(px * d);
    c.style.width = px + "px"; c.style.height = px + "px";
    c.className = "swc";
    var g = c.getContext("2d");
    if (g) {
      g.scale(d, d);
      shapePath(g, f, px / 2, px / 2, px / 2 - 0.5);
      g.fillStyle = FCOL[f]; g.fill();
    }
    var i = el("i");
    i.appendChild(c);
    i.setAttribute("aria-hidden", "true");
    return i;
  }
  function nextBloom(f, m) {
    for (var k = 1; k <= 12; k++) { var mm = (m + k) % 12; if (E.blooms(f, mm) && !E.isWinter(mm)) return mm; }
    return m;
  }
  function patchState(i) {
    if (i >= E.slotsOpen(live)) return t("pn.locked");
    var sl = live.slots[i];
    if (!sl) return t("pn.empty");
    var m = E.monthOf(live.min), parts = [flName(sl.f), t("pn.blooms", { r: monthRange(E.FL[sl.f].m) })];
    if (!E.established(live, sl)) {
      var readyMin = sl.p + E.FL[sl.f].est * E.MONTH_MIN;
      parts.push(t("pn.est", { m: t("monl." + E.monthOf(readyMin)) }));
    } else if (E.blooms(sl.f, m) && !E.isWinter(m)) parts.push(t("pn.now"));
    else parts.push(t("pn.rest", { m: t("monl." + nextBloom(sl.f, m)) }));
    if (sl.l > 0) parts.push(t("pn.tended", { l: sl.l, max: E.TEND_MAX }));
    return parts.join(", ");
  }
  function costText(h, w) { return w > 0 ? t("up.costW", { h: fmt(Math.ceil(h)), w: fmt(Math.ceil(w)) }) : t("up.cost", { h: fmt(Math.ceil(h)) }); }

  function renderPanel() {
    var box = $("panel");
    box.textContent = "";
    lastPanelKey = "";
    if (sel < 0) {
      box.appendChild(el("p", "pn-hint", t("pn.hint")));
      var note = seasonNote();
      if (note) box.appendChild(el("p", "pn-hint" + (note.warn ? " warn" : ""), note.text));
      if (note && note.swarm) {
        var swb = el("button", "opt wide pn-swarm");
        swb.type = "button";
        swb.appendChild(el("span", "tx")).appendChild(el("span", "nm", t("btn.swarm")));
        swb.addEventListener("click", swarmDialog);
        box.appendChild(swb);
      }
      return;
    }
    var head = el("div", "pn-head");
    head.appendChild(el("span", "pn-title", t("pn.patch", { n: sel + 1 })));
    head.appendChild(el("span", "pn-sub", E.SLOTS[sel].ring === 1 ? t("pn.near") : t("pn.far")));
    box.appendChild(head);
    if (sel >= E.slotsOpen(live)) {
      box.appendChild(el("p", "pn-hint", t("pn.locked")));
      var ob = el("button", "opt wide");
      ob.type = "button";
      ob.appendChild(el("span", "tx")).appendChild(el("span", "nm", t("btn.openUp")));
      ob.addEventListener("click", upDialog);
      box.appendChild(ob);
      return;
    }
    var sl = live.slots[sel];
    box.appendChild(el("p", "pn-sub", patchState(sel)));
    var grid = el("div", "pn-grid");
    grid.style.marginTop = "6px";
    if (sl) {
      var tb = el("button", "opt wide");
      tb.type = "button";
      tb.setAttribute("data-k", "tend");
      var tx = el("span", "tx");
      tx.appendChild(el("span", "nm", t("pn.tend")));
      tx.appendChild(el("span", "fx", t("pn.tendFx", { b: fmt(E.PATCH_BEES) })));
      tb.appendChild(tx);
      tb.appendChild(el("span", "cost"));
      tb.addEventListener("click", function () { tend(sel); });
      grid.appendChild(tb);
    }
    avail().forEach(function (f, n) {
      var b = el("button", "opt" + (sl && sl.f === f ? " cur" : ""));
      b.type = "button";
      b.setAttribute("data-k", f);
      var sw = el("span", "sw");
      sw.appendChild(swatch(f, 22).firstChild);
      b.appendChild(sw);
      var tx2 = el("span", "tx");
      tx2.appendChild(el("span", "nm", flName(f)));
      tx2.appendChild(el("span", "fx", t("pn.fx", { r: monthRange(E.FL[f].m), y: String(Math.round(E.flowerY(live, f) * 100) / 100).replace(".", t("num.dec")) })));
      b.appendChild(tx2);
      b.appendChild(el("span", "cost"));
      b.title = (sl ? t("pn.replace") : t("pn.plant")) + ": " + flName(f) + " (" + (n + 1) + ")";
      b.addEventListener("click", function () { plant(sel, f); });
      grid.appendChild(b);
    });
    box.appendChild(grid);
    refreshPanel(true);
  }
  // Prices and what can be bought, in place (focus stays).
  function refreshPanel(force) {
    var box = $("panel");
    if (sel < 0) {
      var note = seasonNote(), key = note ? note.text : "";
      if (force || key !== lastPanelKey) {
        lastPanelKey = key;
        var ps = box.querySelectorAll(".pn-hint");
        if (ps.length !== (note ? 2 : 1) || !box.querySelector(".pn-swarm") !== !(note && note.swarm)) { renderPanel(); return; }
        if (note) { ps[1].textContent = note.text; ps[1].classList.toggle("warn", !!note.warn); }
      }
      return;
    }
    if (sel >= E.slotsOpen(live)) return;
    var sl = live.slots[sel];
    var sub = box.querySelector("p.pn-sub");
    if (sub) sub.textContent = patchState(sel);
    [].forEach.call(box.querySelectorAll("button[data-k]"), function (b) {
      var k = b.getAttribute("data-k"), cost = b.querySelector(".cost");
      if (k === "tend") {
        var ti = E.tendInfo(live, sel);
        cost.textContent = ti.done ? t("pn.tendMax") : costText(ti.h, 0);
        b.disabled = !ti.ok;
      } else {
        var cur = sl && sl.f === k, c = E.plantCost(live, k);
        cost.textContent = cur ? "✓" : costText(c, 0);
        b.disabled = cur || live.honey < c;
        b.setAttribute("aria-pressed", cur ? "true" : "false");
      }
    });
  }
  function seasonNote() {
    var m = E.monthOf(live.min);
    if (E.canSwarm(live)) return { text: t("pn.swarm"), swarm: true };
    if (live.cl) return { text: t("pn.cluster") };
    if (E.isWinter(m)) return { text: t("pn.winter") };
    var need = E.winterNeed(live);
    if (m >= 8 && m <= 10) {
      return live.honey < need ? { text: t("pn.winterShort", { n: fmt(need), h: fmt(live.honey) }), warn: true }
                               : { text: t("pn.winterNeed", { n: fmt(need), h: fmt(live.honey) }) };
    }
    var gaps = 0, open = E.slotsOpen(live);
    for (var mo = 0; mo < 12; mo++) {
      if (E.isWinter(mo)) continue;
      var any = false;
      for (var i = 0; i < open && !any; i++) if (live.slots[i] && E.blooms(live.slots[i].f, mo)) any = true;
      if (!any) gaps++;
    }
    return gaps ? { text: t("pn.gap", { n: gaps }) } : { text: t("pn.full") };
  }

  // ---------- 8. Dialogs ----------
  var dlgKind = "";
  function openDialog(kind, build) {
    var d = $("dlg");
    d.textContent = "";
    dlgKind = kind;
    build(d);
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
  function upDialog() {
    E.catchUp(live, nowMs());
    openDialog("up", function (d) {
      d.setAttribute("aria-label", t("up.title"));
      d.appendChild(el("div", "dlg-title", t("up.title")));
      var list = el("div", "up-list");
      E.UPGRADES.forEach(function (u) {
        var row = el("div", "up-row");
        row.setAttribute("data-u", u.id);
        var tx = el("div", "tx");
        var nm = el("div", "nm", t("up." + u.id));
        nm.appendChild(el("span", "lv"));
        tx.appendChild(nm);
        tx.appendChild(el("div", "fx", t("up." + u.id + ".fx")));
        row.appendChild(tx);
        var b = el("button", "dlg-btn primary");
        b.type = "button";
        b.addEventListener("click", function () { improve(u.id); });
        row.appendChild(b);
        list.appendChild(row);
      });
      d.appendChild(list);
      d.appendChild(el("p", "dlg-note up-note"));
      actions(d, [{ label: t("btn.close"), fn: closeDialog }]);
    });
    refreshDialog(true);
  }
  function refreshDialog() {
    if (dlgKind !== "up") return;
    var d = $("dlg");
    E.UPGRADES.forEach(function (u) {
      var row = d.querySelector('[data-u="' + u.id + '"]');
      if (!row) return;
      var inf = E.upInfo(live, u.id), b = row.querySelector("button");
      row.querySelector(".lv").textContent = " " + t("up.lv", { l: inf.lv, max: inf.max });
      b.textContent = inf.done ? t("up.max") : costText(inf.h, inf.w);
      b.disabled = !inf.ok;
    });
    var r = E.rates(live), k = Object.keys(live.kinds).length;
    var note = d.querySelector(".up-note");
    if (note) note.textContent = t("up.note", { r: fmtRate(r.honey), k: k, n: avail().length, p: Math.round(k * 5) });
  }
  function recDialog() {
    E.catchUp(live, nowMs());
    var planted = live.slots.filter(Boolean).length;
    openDialog("rec", function (d) {
      d.setAttribute("aria-label", t("rec.title"));
      d.appendChild(el("div", "dlg-title", t("rec.title")));
      rowKV(d, t("rec.year"), String(E.yearOf(live.min) + 1));
      rowKV(d, t("rec.life"), fmt(live.life));
      rowKV(d, t("rec.kinds"), Object.keys(live.kinds).length + " / " + avail().length);
      rowKV(d, t("rec.patches"), planted + " / " + E.slotsOpen(live));
      rowKV(d, t("rec.bees"), fmt(live.bees));
      rowKV(d, t("rec.acts"), fmt(live.acts));
      rowKV(d, t("rec.hill"), t("hs." + live.hs));
      rowKV(d, t("rec.hives"), fmt(live.hv + 1));
      var cnt = {};
      live.tr.forEach(function (x) { cnt[x] = (cnt[x] || 0) + 1; });
      rowKV(d, t("rec.traits"), Object.keys(cnt).map(function (x) { return t("tr." + x) + (cnt[x] > 1 ? " ×" + cnt[x] : ""); }).join(", ") || t("rec.none"));
      d.appendChild(el("div", "dlg-sub", t("rec.apiary")));
      if (live.ap.length) {
        var ul = el("ul", "ap-list");
        live.ap.forEach(function (h, n) {
          ul.appendChild(el("li", "", t("rec.apItem", { n: n + 1, hs: t("hs." + h.hs), y: h.y, h: fmt(h.h) })));
        });
        d.appendChild(ul);
        d.appendChild(el("p", "dlg-note", t("rec.apBonus", { p: Math.round(Math.min(E.AP_MAX, live.hv) * E.APIARY_F * 100) })));
      } else d.appendChild(el("p", "dlg-note", t("rec.apNone")));
      var hl = el("label", "dlg-check");
      var hc = el("input");
      hc.type = "checkbox";
      hc.checked = humOn();
      hc.addEventListener("change", function () { setHum(hc.checked); });
      hl.appendChild(hc);
      hl.appendChild(el("span", "", t("rec.hum")));
      d.appendChild(hl);
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
  // The swarm: one hillside and one trait, both chosen here.
  function swarmDialog() {
    E.catchUp(live, nowMs());
    if (!E.canSwarm(live)) { showToast(t("toast.noswarm", { n: fmt(E.SWARM_BEES) })); sfx("no"); return; }
    var pick = { hs: E.HILL_IDS.filter(function (h) { return h !== live.hs; })[0], tr: E.offer(live)[0] };
    openDialog("swarm", function (d) {
      d.setAttribute("aria-label", t("sw.title"));
      d.appendChild(el("div", "dlg-title", t("sw.title")));
      d.appendChild(el("p", "dlg-msg", t("sw.msg")));
      function group(title, name, ids, prefix, key) {
        var fs = el("fieldset", "sw-group");
        fs.appendChild(el("legend", "", title));
        ids.forEach(function (id) {
          var lb = el("label", "sw-opt");
          var r = el("input");
          r.type = "radio"; r.name = name; r.value = id;
          r.checked = pick[key] === id;
          r.addEventListener("change", function () { if (r.checked) pick[key] = id; });
          lb.appendChild(r);
          var tx = el("span", "tx");
          tx.appendChild(el("span", "nm", t(prefix + id) + (key === "hs" && id === live.hs ? " ✓" : "")));
          tx.appendChild(el("span", "fx", t(prefix + id + ".fx")));
          lb.appendChild(tx);
          fs.appendChild(lb);
        });
        d.appendChild(fs);
      }
      group(t("sw.hill"), "sw-hs", E.HILL_IDS, "hs.", "hs");
      group(t("sw.trait"), "sw-tr", E.offer(live), "tr.", "tr");
      d.appendChild(el("p", "dlg-note", t("sw.note", { n: fmt(E.SWARM_BEES) })));
      actions(d, [
        { label: t("sw.later"), fn: closeDialog },
        { label: t("sw.go"), cls: "primary", fn: function () {
          var hs = pick.hs, tr = pick.tr;
          closeDialog();
          sel = -1;
          doAct({ t: "swarm", hs: hs, tr: tr }, t("toast.swarm", { hs: t("hs." + hs) }));
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
      rowKV(d, t("away.months"), String(Math.floor(info.minutes / E.MONTH_MIN)));
      rowKV(d, t("away.honey"), fmt(live.honey));
      rowKV(d, t("away.bees"), fmt(live.bees));
      if (info.slowed) d.appendChild(el("p", "dlg-note", t("away.slow")));
      if (info.clustered) d.appendChild(el("p", "dlg-note", t("away.cluster")));
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
  // withUndo: the local toast with Undo (the shell's toast has no button).
  function showToast(text, withUndo) {
    if (!withUndo) {
      try {
        var n = (window.parent && window.parent.orosNotifs) || window.orosNotifs;
        if (n && typeof n.transient === "function" && n.transient({ ns: "hive", title: String(text) })) return;
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
  var HAPTIC = { plant: "tick", up: "good", no: "bad" };
  function sfx(kind) {
    if (window.orosHaptics && HAPTIC[kind]) window.orosHaptics.cue(HAPTIC[kind]);
    if (!sfxOn()) return;
    try {
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      if (!audio) audio = new AC();
      if (audio.state === "suspended") audio.resume();
      if (kind === "plant") { tone(523, 0, 0.08, "triangle", 0.08); tone(659, 0.06, 0.1, "sine", 0.07); }
      else if (kind === "up") [440, 554, 659, 880].forEach(function (f, k) { tone(f, k * 0.07, 0.14, "triangle", 0.08); });
      else if (kind === "undo") { tone(392, 0, 0.08, "sine", 0.07); tone(330, 0.06, 0.1, "sine", 0.06); }
      else if (kind === "no") tone(170, 0, 0.14, "sawtooth", 0.05);
      else if (kind === "toggle") { tone(1047, 0, 0.05, "sine", 0.08); tone(1319, 0.04, 0.07, "sine", 0.07); }
    } catch (e) { /* no audio → silent */ }
  }
  // The hum: off by default, a soft drone that follows the fed bees.
  var HUM_KEY = "oros-hive-hum", hum = null;
  function humOn() {
    try { return localStorage.getItem(HUM_KEY) === "1"; } catch (e) { return false; }
  }
  function setHum(on) {
    try { localStorage.setItem(HUM_KEY, on ? "1" : "0"); } catch (e) {}
    updateHum();
  }
  function humLevel() {
    if (!live || document.hidden || E.isWinter(E.monthOf(live.min)) || live.cl) return 0;
    var fed = 0;
    E.forage(live, E.monthOf(live.min)).forEach(function (p) { fed += p.bees; });
    return fed > 0 ? Math.min(0.05, 0.012 + fed / 400000) : 0;
  }
  function updateHum() {
    var want = humOn() ? humLevel() : 0;
    if (!want && !hum) return;
    try {
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      if (!audio) audio = new AC();
      if (audio.state === "suspended") audio.resume();
      if (!hum) {
        var lp = audio.createBiquadFilter(), g = audio.createGain();
        lp.type = "lowpass"; lp.frequency.value = 420;
        g.gain.value = 0;
        lp.connect(g); g.connect(audio.destination);
        var os = [118, 121.5, 236.8].map(function (f) {
          var o = audio.createOscillator();
          o.type = "sawtooth"; o.frequency.value = f;
          o.connect(lp); o.start();
          return o;
        });
        hum = { g: g, os: os };
      }
      hum.g.gain.setTargetAtTime(want, audio.currentTime, 0.8);
      if (!want) {
        var h = hum;
        hum = null;
        setTimeout(function () { h.os.forEach(function (o) { try { o.stop(); } catch (e) {} }); }, 4000);
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
    hive:   SVG + '<path d="M12 2 20 6.5v9L12 20l-8-4.5v-9z"/><path d="M8 9.5h8M7 13h10"/><path d="M12 20v2"/></svg>',
    stats:  SVG + '<path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0z"/><path d="M17 5h3v2a3 3 0 0 1-3 3M7 5H4v2a3 3 0 0 0 3 3"/></svg>',
    sfxOn:  SVG + '<path d="M11 5 6 9H2v6h4l5 4z"/><path d="M15.5 8.5a5 5 0 0 1 0 7M19 5a10 10 0 0 1 0 14"/></svg>',
    sfxOff: SVG + '<path d="M11 5 6 9H2v6h4l5 4z"/><path d="M22 9l-6 6M16 9l6 6"/></svg>',
    honey:  SVG + '<path d="M12 3c3 4 6 7 6 11a6 6 0 0 1-12 0c0-4 3-7 6-11z"/></svg>',
    wax:    SVG + '<path d="M12 3 19 7v10l-7 4-7-4V7z"/></svg>',
    bees:   SVG + '<ellipse cx="12" cy="14" rx="4" ry="5.5"/><path d="M8.3 12h7.4M8.3 15.5h7.4"/><path d="M10 8.5C8 5 5 5 4 7s1 4 5 3.5M14 8.5c2-3.5 5-3.5 6-1.5s-1 4-5 3.5"/></svg>',
    month:  SVG + '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 10h18"/></svg>',
    rain:   SVG + '<path d="M7 15a4 4 0 0 1 0-8 5 5 0 0 1 9.5-1.5A3.5 3.5 0 1 1 17 15z"/><path d="M8 18l-1 3M12 18l-1 3M16 18l-1 3"/></svg>',
    heat:   SVG + '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>'
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
    calKey = "";
    if (live) { renderCal(); draw(); }
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
    api.registerSlice("hive", sliceGet, sliceSet, STORAGE_KEY, mergeHive);
  }
  function mergeHive(a, b) { return E.merge(a, b); }
  // The hive as written, never the ticking one (R26: the same JSON
  // until the person does something).
  function sliceGet() { return stored ? E.normalize(saved) : null; }
  function sliceSet(incoming) {
    var inc = E.normalize(incoming);
    if (!inc) return;
    window.__orosSyncApi._suppress = true;   // R6: a pull never marks dirty
    try {
      // a purchase still waiting is the person's own edit: written now,
      // sent through the normal path afterwards
      if (pending) { clearTimeout(pending.timer); pending = null; E.catchUp(live, nowMs()); saved = E.normalize(live); stored = true; setTimeout(dirtySoon, 0); }
      var m = E.merge(stored ? saved : null, inc);
      if (stored && JSON.stringify(m) === JSON.stringify(saved)) return;
      saved = m;
      writeSaved();
      live = E.clone(m);
      E.catchUp(live, nowMs());
      undo = null;
      hideToast();
      if (sel >= E.slotsOpen(live)) sel = -1;
      renderAll(true);
    } catch (e) {
    } finally {
      window.__orosSyncApi._suppress = false;
    }
  }

  // ---------- 12. Test hooks, wiring & boot ----------
  // render_game_to_text: the visible state as JSON. Patches are hex
  // cells in axial coordinates (q, r) around the hive at (0, 0); ring 1
  // is next to it, ring 2 up the hill (open with the Terraces).
  window.render_game_to_text = function () {
    if (!live) return "{}";
    var m = E.monthOf(live.min), y = E.yearOf(live.min), r = E.rates(live), open = E.slotsOpen(live);
    return JSON.stringify({
      mode: dlgKind || "play", year: y + 1, month: m, weather: E.weather(live.seed, y, m, live.hs),
      hill: live.hs, hives: live.hv, traits: live.tr, canSwarm: E.canSwarm(live), offer: E.offer(live),
      winter: E.isWinter(m), honey: Math.floor(live.honey), wax: Math.floor(live.wax),
      bees: Math.floor(live.bees), room: E.capacity(live), perMin: Math.round(r.honey * 100) / 100,
      kinds: Object.keys(live.kinds), clustered: !!live.cl, sel: sel, lv: live.lv, frames: live.frames,
      slots: E.SLOTS.map(function (s, i) {
        var sl = live.slots[i];
        return { i: i, q: s.q, r: s.r, ring: s.ring, open: i < open, f: sl ? sl.f : null, l: sl ? sl.l : 0,
                 ready: sl ? E.established(live, sl) : false, bloom: sl ? E.established(live, sl) && E.blooms(sl.f, m) && !E.isWinter(m) : false };
      }),
      note: "slots: axial hex (q, r) around the hive at (0, 0); one game month = 30 min"
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
    var wb = $("sw-btn");
    wb.querySelector(".ic").innerHTML = ICONS.bees;
    wb.title = t("btn.swarmKey");
    var ub = $("up-btn");
    ub.querySelector(".ic").innerHTML = ICONS.hive;
    ub.title = t("btn.upKey");
    var sb = $("stats-btn");
    sb.innerHTML = ICONS.stats;
    sb.setAttribute("aria-label", t("btn.stats"));
    sb.title = t("btn.stats");
    [["s-honey", "honey"], ["s-wax", "wax"], ["s-bees", "bees"], ["s-month", "month"]].forEach(function (x) {
      $(x[0]).querySelector(".ic").innerHTML = ICONS[x[1]];
    });
    paintSfxBtn();
  }
  function wire() {
    $("up-btn").addEventListener("click", upDialog);
    $("sw-btn").addEventListener("click", swarmDialog);
    document.addEventListener("pointerdown", function () { if (humOn()) updateHum(); }, { once: true });
    $("stats-btn").addEventListener("click", recDialog);
    $("sfx-btn").addEventListener("click", toggleSfx);
    $("dlg").addEventListener("close", function () { dlgKind = ""; });
    $("dlg").addEventListener("cancel", function () {
      if (dlgKind === "tour") { prefs.tour = 1; savePrefs(); }
    });
    wireInput();
    wireKeyboard();
    window.addEventListener("resize", resize);
    if (window.ResizeObserver) new ResizeObserver(resize).observe($("scene"));
    document.addEventListener("visibilitychange", function () {
      if (document.hidden) { flushOut(); stopAnim(); }
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
  // Coming back to the page: the away card when the hive moved on.
  function onReturn() {
    if (!live) return;
    var before = { life: prefs.seenLife, min: prefs.seenMin, seen: prefs.seen };
    var out = E.catchUp(live, nowMs());
    if (out.dt > CHECKPOINT || out.slowed) checkpoint();
    if (before.seen && live.min - before.min >= AWAY_MIN && !$("dlg").open) {
      awayDialog({ made: Math.max(0, live.life - before.life), minutes: live.min - before.min,
                   ms: Math.max(0, nowMs() - before.seen), slowed: nowMs() - before.seen > E.FULL_MS,
                   clustered: out.clustered > 0 || !!live.cl });
    }
    prefs.seen = nowMs(); prefs.seenLife = live.life; prefs.seenMin = live.min;
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
    tickTimer = setInterval(tick, 1000);
    // every minute while open: remember where the hive was (the away card)
    setInterval(function () {
      if (document.hidden || !live) return;
      prefs.seen = nowMs(); prefs.seenLife = live.life; prefs.seenMin = live.min;
      savePrefs();
    }, 60000);
    startAnim();
  }

  boot();
})();
