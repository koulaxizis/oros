// ============================================================
// orOS Clockwork Workshop — App logic (v1.0.0)
// An idle game: a watchmaker's bench. A water wheel turns the gears,
// the gears drive small machines, belts carry the goods and the crate
// sells them, every minute, open or closed. Tap a cell to put a part
// there; tap a part to turn it or take it back. The rules live in
// clockwork/engine.js (ClockworkEngine, tested headless); this file is
// the screen, the saves and the clock.
//   - gears mesh on all eight sides; three that all touch jam the train
//   - away: full pace for 7 days, then half pace (never stops)
//   - a calm "While you were away" card, no notifications, no streaks
//   - Undo after every action, Start over with Undo
// Data:
//   - synced slice "clockwork" (oros-clockwork-data): the workshop, as
//     the engine keeps it. Written only after a person's own action (a
//     few seconds later, so Undo stays local), or as a checkpoint when
//     the game opens after more than a day; idle minutes never write.
//     markDirty at most once every 5 minutes, and on the way out.
//     Merge: ClockworkEngine.merge (the further-ahead workshop wins).
//   - device-local (R10): oros-clockwork-prefs (last seen, the tour),
//     oros-clockwork-session (actions so far, for gamekit/resume.js),
//     oros-clockwork-sfx (sound), oros-clockwork-shop (workshop sound).
// Everything shown is text (textContent, canvas fillText), never markup.
// Sections:
//   1. Constants, i18n, helpers
//   2. Saves: load / commit / checkpoint / dirty throttle
//   3. Clock + tick
//   4. Actions (put, turn, take, buy, pattern, new workshop, undo, start over)
//   5. Scene (the bench on one canvas)
//   6. Input (tap, keyboard)
//   7. Panels (status, panel)
//   8. Dialogs (upgrades, pattern book, records, new workshop, away, tour)
//   9. Toasts
//  10. Sound
//  11. Sync slice + palette
//  12. Test hooks, wiring & boot
// ============================================================
(function () {
  "use strict";

  var E = window.ClockworkEngine;

  var STORAGE_KEY = "oros-clockwork-data";
  var PREFS_KEY   = "oros-clockwork-prefs";
  var SESSION_KEY = "oros-clockwork-session";
  var SFX_KEY     = "oros-clockwork-sfx";
  var SHOP_KEY    = "oros-clockwork-shop";
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
      "app.name": "Clockwork Workshop",
      "btn.up": "Upgrades", "btn.upKey": "Upgrades (U)", "btn.pb": "Pattern book (P)",
      "btn.stats": "Records (S)", "btn.help": "How to play (H)", "btn.sfxOn": "Sound on (M)", "btn.sfxOff": "Sound off (M)",
      "btn.close": "Close", "btn.ok": "Good", "btn.undo": "Undo", "btn.cancel": "Cancel",
      "btn.start": "Start over", "btn.startYes": "Start over", "btn.new": "New workshop", "btn.newKey": "New workshop (E)",
      "btn.turn": "Turn (R)", "btn.take": "Take back (Del)", "btn.lay": "Lay it",
      "view.label": "The workbench, a grid of cells. Tap a cell to put a part there, or a part to turn it or take it back. Arrow keys move between the cells, Enter chooses, R turns, Delete takes a part back, 1 to 7 put a part.",
      "num.dec": ".", "num.k": "K", "num.m": "M", "num.b": "B", "num.t": "T",
      "st.co": "Coins", "st.rate": "+{n}/min",
      "st.pw": "Power: {n} of {p} used by running machines",
      "st.turn": "turning", "st.jam": "jammed", "st.still": "still",
      "st.trTurn": "The train turns: {n} gears", "st.trJam": "Jammed: three gears that all touch cannot turn. Take one away.",
      "st.trStill": "No gear turns yet: put a gear next to the water wheel.",
      "part.g": "Gear", "part.b": "Belt", "part.f": "Furnace", "part.p": "Gear press", "part.c": "Spring coiler",
      "part.k": "Clock bench", "part.a": "Automaton loft", "part.W": "Water wheel", "part.X": "Shipping crate",
      "fx.g": "Meshes with the gears on all eight sides and passes the turn on. Three that all touch jam.",
      "fx.b": "Carries goods one cell the way it points.",
      "fx.f": "Makes brass from nothing: {r} a minute.",
      "fx.p": "Makes a gear from 1 brass: {r} a minute.",
      "fx.c": "Makes a spring from 1 brass: {r} a minute.",
      "fx.k": "Makes a clock from 2 gears and 1 spring: {r} a minute.",
      "fx.a": "Makes an automaton from 3 clocks: {r} a minute.",
      "fx.W": "The water wheel turns the gears and machines around it. Power {p}: that many machines run at full speed.",
      "fx.X": "Sells everything that reaches it, at once.",
      "good.0": "brass", "good.1": "gears", "good.2": "springs", "good.3": "clocks", "good.4": "automatons",
      "good1.0": "brass", "good1.1": "gear", "good1.2": "spring", "good1.3": "clock", "good1.4": "automaton",
      "price": "{g}: {c} ◎",
      "dir.0": "east", "dir.1": "south", "dir.2": "west", "dir.3": "north",
      "ms.run": "Running: {r} {g} a minute", "ms.wait": "Waiting for what it needs: {r} {g} a minute",
      "ms.idle": "Still: no turning gear or wheel beside it", "ms.full": "Stopped: nowhere to put its {g}",
      "ms.loop": "Stopped: its belts go round in a circle", "ms.jam": "Stopped: the train is jammed",
      "ms.to": "Goes to: {t}", "ms.toX": "the crate", "ms.slow": "The wheel gives {p} power for {n} machines: all at {s}%.",
      "gear.cw": "Turning clockwise", "gear.ccw": "Turning anticlockwise", "gear.still": "Not turning: it touches no turning gear",
      "gear.jam": "Jammed: it is in a ring of an odd number of gears",
      "cell.at": "Row {r}, column {c}", "cell.empty": "Empty", "cell.pick": "Put a part here:",
      "cell.refund": "Takes back {c} ◎",
      "pn.hint": "Tap a cell to put a part there. A furnace next to the water wheel, belts to the crate: that is the first coin.",
      "pn.next": "This workshop: {n} ◎ earned. With {k} ◎ earned and an automaton sold, a bigger workshop can open.",
      "pn.ready": "An automaton is sold and {k} ◎ earned: a new, bigger workshop can open. There is no hurry.",
      "pn.jam": "The train is jammed: three gears that all touch cannot turn. The gears marked ✕ are in the ring.",
      "up.title": "Upgrades", "up.lv": "{l}/{max}", "up.max": "Done", "up.cost": "{c} ◎",
      "up.wheel": "Bigger wheel", "up.wheel.fx": "+2 power: two more machines at full speed.",
      "up.oil": "Oiled bearings", "up.oil.fx": "Every machine works 20% faster.",
      "up.door": "Back door", "up.door.fx": "A second crate in the top right corner.",
      "up.doorBusy": "Clear the top right cell first",
      "up.polish": "Polish: {t}", "up.polish.fx": "Every {t} works twice as fast.", "up.need": "Needs a {t}",
      "up.note": "Coins a minute now: {r}. Power: {n} of {p}.",
      "pb.title": "Pattern book", "pb.none": "The book fills when a new workshop opens: the bench of every workshop goes in, and each one adds 2% to every price for good.",
      "pb.item": "Workshop {n} · {z}×{z}", "pb.earned": "{e} ◎ earned", "pb.bonus": "The book adds {p}% to every price, for good.",
      "pb.cost": "Lay it: {c} ◎", "pb.note": "Laying a pattern takes back every part on the bench (half its price returns) and puts the pattern's parts in their place, for their price. A bigger bench moves the crate: a belt may be missing.",
      "rec.title": "Records", "rec.life": "Coins earned in all", "rec.ws": "Workshop", "rec.we": "Earned in this workshop",
      "rec.ship": "Goods shipped in all", "rec.marks": "Guild marks", "rec.none": "none yet",
      "rec.acts": "Things you did", "rec.sfx": "Sound effects", "rec.shop": "The sound of the workshop (ticking and a far water wheel)",
      "rec.miles": "Milestones",
      "rec.note": "The workshop lives on every device you use orOS on. If two devices play at the same time, the one further ahead is kept.",
      "rec.startAsk": "Start a new workshop from nothing? The one you have now goes, on every device.",
      "mi.clock": "The first clock", "mi.auto": "The first automaton sold", "mi.train": "A train of 12 gears",
      "mi.tidy": "20 parts and every machine running", "mi.million": "A million coins", "mi.first": "The first new workshop",
      "mi.big": "A 7 × 7 bench", "mi.ten": "Ten workshops",
      "away.title": "While you were away", "away.hero": "+{n} ◎",
      "away.time": "You were away", "away.co": "Coins now",
      "away.slow": "After 7 days away the workshop works at half pace: it never stops, it only slows.",
      "dur.d": "{n} d", "dur.h": "{n} h", "dur.m": "{n} min",
      "tour.title": "How it works",
      "tour.1": "The water wheel on the left turns the gears and machines next to it. Gears mesh on all eight sides, so a line of gears carries the turn across the bench.",
      "tour.2": "Neighbouring gears turn opposite ways, so three gears that all touch jam: nothing turns until you take one away.",
      "tour.3": "A machine puts what it makes on the cell it faces. Belts carry it on, and the crate on the right sells it. Brass becomes gears and springs, they become clocks, clocks become automatons.",
      "tour.4": "The workshop goes on while orOS is closed. There is nothing to miss and nothing to collect: come back when you like.",
      "toast.put": "Placed: {p}", "toast.turn": "Turned: {p} faces {d}", "toast.take": "Taken back: {p}", "toast.buy": "Done: {u}",
      "toast.lay": "Pattern laid", "toast.start": "A new workshop from nothing",
      "toast.co": "Not enough coins yet", "toast.max": "Already done", "toast.need": "Put a {x} on the bench first",
      "toast.full": "That cell is taken", "toast.door": "Clear the top right cell first", "toast.bad": "That cannot be done",
      "toast.save": "Not saved: the browser's storage is full",
      "toast.new": "Workshop {n} opens: a bigger bench", "toast.nonew": "A new workshop needs an automaton sold and {k} ◎ earned here",
      "tr.quick": "Quick hands", "tr.quick.fx": "Every machine works 15% faster.",
      "tr.thrifty": "Thrifty", "tr.thrifty.fx": "Parts cost 15% less.",
      "tr.river": "Strong river", "tr.river.fx": "The wheel gives 2 more power.",
      "tr.fine": "Fine tools", "tr.fine.fx": "Everything sells for 10% more.",
      "tr.keen": "Keen apprentice", "tr.keen.fx": "The first gear press and the first spring coiler of every workshop cost nothing.",
      "tr.patient": "Patient", "tr.patient.fx": "Away, the workshop keeps its full pace 7 days longer.",
      "nw.title": "A new workshop",
      "nw.msg": "An automaton is sold and the workshop is known in town. You can move to a new workshop: a bench one row and one column bigger (up to 7 × 7), and the coins, parts and upgrades back to the start. This bench goes into the pattern book, where you can lay it again, and adds 2% to every price for good. You keep one guild mark.",
      "nw.trait": "One guild mark for good", "nw.go": "Open the new workshop", "nw.later": "Not now",
      "nw.note": "There is no hurry: a new workshop can open any time from now on. Undo takes it back for a few seconds.",
      "ws": "Workshop {n} · {z}×{z}",
      "live.cell": "Row {r}, column {c}: {w}", "live.empty": "empty"
    },
    el: {
      "app.name": "Εργαστήρι μηχανισμών",
      "btn.up": "Βελτιώσεις", "btn.upKey": "Βελτιώσεις (U)", "btn.pb": "Βιβλίο σχεδίων (P)",
      "btn.stats": "Αρχείο (S)", "btn.help": "Πώς παίζεται (H)", "btn.sfxOn": "Ήχος ανοιχτός (M)", "btn.sfxOff": "Ήχος κλειστός (M)",
      "btn.close": "Κλείσιμο", "btn.ok": "Ωραία", "btn.undo": "Αναίρεση", "btn.cancel": "Άκυρο",
      "btn.start": "Από την αρχή", "btn.startYes": "Από την αρχή", "btn.new": "Νέο εργαστήρι", "btn.newKey": "Νέο εργαστήρι (E)",
      "btn.turn": "Γύρνα το (R)", "btn.take": "Πάρ' το πίσω (Del)", "btn.lay": "Στήσ' το",
      "view.label": "Ο πάγκος, ένα πλέγμα με κελιά. Πάτα ένα κελί για να βάλεις εκεί ένα κομμάτι, ή ένα κομμάτι για να το γυρίσεις ή να το πάρεις πίσω. Με τα βελάκια πας από κελί σε κελί, με το Enter διαλέγεις, με το R γυρίζεις, με το Delete παίρνεις πίσω ένα κομμάτι, με το 1 ως 7 βάζεις κομμάτι.",
      "num.dec": ",", "num.k": " χιλ.", "num.m": " εκ.", "num.b": " δισ.", "num.t": " τρισ.",
      "st.co": "Νομίσματα", "st.rate": "+{n}/λεπτό",
      "st.pw": "Ισχύς: {n} από {p} για τις μηχανές που δουλεύουν",
      "st.turn": "γυρίζει", "st.jam": "κόλλησε", "st.still": "ακίνητο",
      "st.trTurn": "Το σύστημα γυρίζει: {n} γρανάζια", "st.trJam": "Κόλλησε: τρία γρανάζια που ακουμπούν όλα μεταξύ τους δεν γυρίζουν. Βγάλε ένα.",
      "st.trStill": "Δεν γυρίζει ακόμα κανένα γρανάζι: βάλε ένα γρανάζι δίπλα στον νερόμυλο.",
      "part.g": "Γρανάζι", "part.b": "Ιμάντας", "part.f": "Καμίνι", "part.p": "Πρέσα γραναζιών", "part.c": "Τυλιχτήρι ελατηρίων",
      "part.k": "Πάγκος ρολογιών", "part.a": "Σοφίτα αυτομάτων", "part.W": "Νερόμυλος", "part.X": "Κιβώτιο αποστολής",
      "fx.g": "Εμπλέκεται με τα γρανάζια και στις οκτώ πλευρές και περνά την κίνηση. Τρία που ακουμπούν όλα μεταξύ τους κολλάνε.",
      "fx.b": "Μεταφέρει πράγματα ένα κελί προς τα εκεί που δείχνει.",
      "fx.f": "Φτιάχνει ορείχαλκο από το τίποτα: {r} το λεπτό.",
      "fx.p": "Φτιάχνει ένα γρανάζι από 1 ορείχαλκο: {r} το λεπτό.",
      "fx.c": "Φτιάχνει ένα ελατήριο από 1 ορείχαλκο: {r} το λεπτό.",
      "fx.k": "Φτιάχνει ένα ρολόι από 2 γρανάζια και 1 ελατήριο: {r} το λεπτό.",
      "fx.a": "Φτιάχνει ένα αυτόματο από 3 ρολόγια: {r} το λεπτό.",
      "fx.W": "Ο νερόμυλος γυρίζει τα γρανάζια και τις μηχανές γύρω του. Ισχύς {p}: τόσες μηχανές δουλεύουν με όλη τους την ταχύτητα.",
      "fx.X": "Πουλά αμέσως ό,τι φτάνει σε αυτό.",
      "good.0": "ορείχαλκος", "good.1": "γρανάζια", "good.2": "ελατήρια", "good.3": "ρολόγια", "good.4": "αυτόματα",
      "good1.0": "ορείχαλκος", "good1.1": "γρανάζι", "good1.2": "ελατήριο", "good1.3": "ρολόι", "good1.4": "αυτόματο",
      "price": "{g}: {c} ◎",
      "dir.0": "ανατολικά", "dir.1": "νότια", "dir.2": "δυτικά", "dir.3": "βόρεια",
      "ms.run": "Δουλεύει: {r} το λεπτό ({g})", "ms.wait": "Περιμένει ό,τι χρειάζεται: {r} το λεπτό ({g})",
      "ms.idle": "Ακίνητη: δεν έχει δίπλα της γρανάζι που γυρίζει ή τον νερόμυλο", "ms.full": "Σταμάτησε: δεν έχει πού να βάλει ό,τι φτιάχνει",
      "ms.loop": "Σταμάτησε: οι ιμάντες της κάνουν κύκλο", "ms.jam": "Σταμάτησε: το σύστημα κόλλησε",
      "ms.to": "Πηγαίνουν: {t}", "ms.toX": "στο κιβώτιο", "ms.slow": "Ο νερόμυλος δίνει ισχύ {p} για {n} μηχανές: όλες στο {s}%.",
      "gear.cw": "Γυρίζει δεξιόστροφα", "gear.ccw": "Γυρίζει αριστερόστροφα", "gear.still": "Δεν γυρίζει: δεν ακουμπά γρανάζι που γυρίζει",
      "gear.jam": "Κόλλησε: είναι σε κύκλο με μονό αριθμό γραναζιών",
      "cell.at": "Σειρά {r}, στήλη {c}", "cell.empty": "Άδειο", "cell.pick": "Βάλε εδώ ένα κομμάτι:",
      "cell.refund": "Επιστρέφει {c} ◎",
      "pn.hint": "Πάτα ένα κελί για να βάλεις εκεί ένα κομμάτι. Ένα καμίνι δίπλα στον νερόμυλο και ιμάντες ως το κιβώτιο: αυτό είναι το πρώτο νόμισμα.",
      "pn.next": "Αυτό το εργαστήρι: {n} ◎. Με {k} ◎ και ένα αυτόματο πουλημένο ανοίγει μεγαλύτερο εργαστήρι.",
      "pn.ready": "Ένα αυτόματο πουλήθηκε και μαζεύτηκαν {k} ◎: μπορεί να ανοίξει νέο, μεγαλύτερο εργαστήρι. Δεν βιάζεσαι.",
      "pn.jam": "Το σύστημα κόλλησε: τρία γρανάζια που ακουμπούν όλα μεταξύ τους δεν γυρίζουν. Τα γρανάζια με το ✕ είναι στον κύκλο.",
      "up.title": "Βελτιώσεις", "up.lv": "{l}/{max}", "up.max": "Έγινε", "up.cost": "{c} ◎",
      "up.wheel": "Μεγαλύτερος νερόμυλος", "up.wheel.fx": "+2 ισχύς: δύο μηχανές ακόμα με όλη τους την ταχύτητα.",
      "up.oil": "Λαδωμένα ρουλεμάν", "up.oil.fx": "Κάθε μηχανή δουλεύει 20% πιο γρήγορα.",
      "up.door": "Πίσω πόρτα", "up.door.fx": "Δεύτερο κιβώτιο στην πάνω δεξιά γωνία.",
      "up.doorBusy": "Άδειασε πρώτα το πάνω δεξιά κελί",
      "up.polish": "Γυάλισμα: {t}", "up.polish.fx": "Κάθε {t} δουλεύει διπλάσια.", "up.need": "Θέλει {t}",
      "up.note": "Νομίσματα το λεπτό τώρα: {r}. Ισχύς: {n} από {p}.",
      "pb.title": "Βιβλίο σχεδίων", "pb.none": "Το βιβλίο γεμίζει όταν ανοίγει νέο εργαστήρι: μπαίνει μέσα ο πάγκος κάθε εργαστηρίου, και ο καθένας προσθέτει για πάντα 2% σε κάθε τιμή.",
      "pb.item": "Εργαστήρι {n} · {z}×{z}", "pb.earned": "{e} ◎ συνολικά", "pb.bonus": "Το βιβλίο προσθέτει {p}% σε κάθε τιμή, για πάντα.",
      "pb.cost": "Στήσ' το: {c} ◎", "pb.note": "Όταν στήνεις ένα σχέδιο, κάθε κομμάτι του πάγκου επιστρέφει (με τη μισή τιμή του) και τα κομμάτια του σχεδίου μπαίνουν στη θέση τους, με την τιμή τους. Σε μεγαλύτερο πάγκο το κιβώτιο μετακινείται: ίσως λείπει ένας ιμάντας.",
      "rec.title": "Αρχείο", "rec.life": "Νομίσματα συνολικά", "rec.ws": "Εργαστήρι", "rec.we": "Σε αυτό το εργαστήρι",
      "rec.ship": "Πράγματα που στάλθηκαν συνολικά", "rec.marks": "Σήματα συντεχνίας", "rec.none": "κανένα ακόμα",
      "rec.acts": "Κινήσεις σου", "rec.sfx": "Ήχοι", "rec.shop": "Ο ήχος του εργαστηρίου (τικ-τακ και ένας νερόμυλος από μακριά)",
      "rec.miles": "Ορόσημα",
      "rec.note": "Το εργαστήρι είναι ίδιο σε κάθε συσκευή όπου χρησιμοποιείς το orOS. Αν παίξουν δύο συσκευές ταυτόχρονα, κρατιέται αυτή που έχει προχωρήσει περισσότερο.",
      "rec.startAsk": "Να ξεκινήσει νέο εργαστήρι από το μηδέν; Το τωρινό χάνεται σε όλες τις συσκευές.",
      "mi.clock": "Το πρώτο ρολόι", "mi.auto": "Το πρώτο αυτόματο που πουλήθηκε", "mi.train": "Σύστημα με 12 γρανάζια",
      "mi.tidy": "20 κομμάτια και κάθε μηχανή δουλεύει", "mi.million": "Ένα εκατομμύριο νομίσματα", "mi.first": "Το πρώτο νέο εργαστήρι",
      "mi.big": "Πάγκος 7 × 7", "mi.ten": "Δέκα εργαστήρια",
      "away.title": "Όσο έλειπες", "away.hero": "+{n} ◎",
      "away.time": "Έλειπες", "away.co": "Νομίσματα τώρα",
      "away.slow": "Μετά από 7 μέρες απουσίας το εργαστήρι δουλεύει με μισή ταχύτητα: δεν σταματά ποτέ, απλώς πάει πιο αργά.",
      "dur.d": "{n} μ.", "dur.h": "{n} ώ.", "dur.m": "{n} λεπ.",
      "tour.title": "Πώς παίζεται",
      "tour.1": "Ο νερόμυλος αριστερά γυρίζει τα γρανάζια και τις μηχανές δίπλα του. Τα γρανάζια εμπλέκονται και στις οκτώ πλευρές, οπότε μια σειρά γρανάζια φέρνει την κίνηση σε όλο τον πάγκο.",
      "tour.2": "Γειτονικά γρανάζια γυρίζουν αντίθετα, οπότε τρία γρανάζια που ακουμπούν όλα μεταξύ τους κολλάνε: τίποτα δεν γυρίζει ώσπου να βγάλεις ένα.",
      "tour.3": "Μια μηχανή βάζει ό,τι φτιάχνει στο κελί που κοιτάζει. Οι ιμάντες το πάνε παρακάτω και το κιβώτιο δεξιά το πουλά. Ο ορείχαλκος γίνεται γρανάζια και ελατήρια, αυτά γίνονται ρολόγια, τα ρολόγια γίνονται αυτόματα.",
      "tour.4": "Το εργαστήρι συνεχίζει και όταν το orOS είναι κλειστό. Δεν χάνεις τίποτα και δεν έχεις τίποτα να μαζέψεις: έλα όποτε θέλεις.",
      "toast.put": "Μπήκε: {p}", "toast.turn": "Γύρισε: {p} προς τα {d}", "toast.take": "Επέστρεψε: {p}", "toast.buy": "Έγινε: {u}",
      "toast.lay": "Το σχέδιο στήθηκε", "toast.start": "Νέο εργαστήρι από το μηδέν",
      "toast.co": "Δεν φτάνουν ακόμα τα νομίσματα", "toast.max": "Έχει ήδη γίνει", "toast.need": "Βάλε πρώτα στον πάγκο {x}",
      "toast.full": "Αυτό το κελί είναι πιασμένο", "toast.door": "Άδειασε πρώτα το πάνω δεξιά κελί", "toast.bad": "Αυτό δεν γίνεται",
      "toast.save": "Δεν αποθηκεύτηκε: ο χώρος του προγράμματος περιήγησης γέμισε",
      "toast.new": "Ανοίγει το εργαστήρι {n}: μεγαλύτερος πάγκος", "toast.nonew": "Νέο εργαστήρι θέλει ένα αυτόματο πουλημένο και {k} ◎ από εδώ",
      "tr.quick": "Γρήγορα χέρια", "tr.quick.fx": "Κάθε μηχανή δουλεύει 15% πιο γρήγορα.",
      "tr.thrifty": "Οικονόμος", "tr.thrifty.fx": "Τα κομμάτια κοστίζουν 15% λιγότερο.",
      "tr.river": "Δυνατό ποτάμι", "tr.river.fx": "Ο νερόμυλος δίνει 2 ισχύ παραπάνω.",
      "tr.fine": "Καλά εργαλεία", "tr.fine.fx": "Όλα πουλιούνται 10% ακριβότερα.",
      "tr.keen": "Πρόθυμος μαθητευόμενος", "tr.keen.fx": "Η πρώτη πρέσα γραναζιών και το πρώτο τυλιχτήρι ελατηρίων κάθε εργαστηρίου δεν κοστίζουν τίποτα.",
      "tr.patient": "Υπομονετικός", "tr.patient.fx": "Όσο λείπεις, το εργαστήρι κρατά όλη του την ταχύτητα 7 μέρες ακόμα.",
      "nw.title": "Νέο εργαστήρι",
      "nw.msg": "Ένα αυτόματο πουλήθηκε και το εργαστήρι έγινε γνωστό στην πόλη. Μπορείς να πας σε νέο εργαστήρι: ένας πάγκος με μία σειρά και μία στήλη παραπάνω (ως 7 × 7), και τα νομίσματα, τα κομμάτια και οι βελτιώσεις πίσω στην αρχή. Αυτός ο πάγκος μπαίνει στο βιβλίο σχεδίων, όπου μπορείς να τον ξαναστήσεις, και προσθέτει για πάντα 2% σε κάθε τιμή. Κρατάς ένα σήμα συντεχνίας.",
      "nw.trait": "Ένα σήμα συντεχνίας για πάντα", "nw.go": "Άνοιξε το νέο εργαστήρι", "nw.later": "Όχι τώρα",
      "nw.note": "Δεν βιάζεσαι: το νέο εργαστήρι μπορεί να ανοίξει όποτε θέλεις από εδώ και πέρα. Η Αναίρεση το παίρνει πίσω για λίγα δευτερόλεπτα.",
      "ws": "Εργαστήρι {n} · {z}×{z}",
      "live.cell": "Σειρά {r}, στήλη {c}: {w}", "live.empty": "άδειο"
    }
  };
  if (window.orosI18n) window.orosI18n.table(STRINGS, "clockwork", LANG);

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
    if (n < 10) return (Math.round(n * 100) / 100).toString().replace(".", t("num.dec"));
    return fmt(n);
  }
  function fmtDur(ms) {
    var m = Math.floor(ms / 60000), d = Math.floor(m / 1440), h = Math.floor((m % 1440) / 60);
    if (d > 0) return t("dur.d", { n: d }) + (h ? " " + t("dur.h", { n: h }) : "");
    if (h > 0) return t("dur.h", { n: h }) + (m % 60 ? " " + t("dur.m", { n: m % 60 }) : "");
    return t("dur.m", { n: m });
  }
  function partName(code) { return t("part." + (code.length > 1 ? code.charAt(0) : code)); }
  function upName(id) {
    if (id.charAt(0) === "p" && E.MACH[id.slice(1)]) return t("up.polish", { t: t("part." + id.slice(1)) });
    return t("up." + id);
  }
  function upFx(id) {
    if (id.charAt(0) === "p" && E.MACH[id.slice(1)]) return t("up.polish.fx", { t: t("part." + id.slice(1)) });
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
    console.log("clockwork.js v" + (SCRIPT_V || "?") + " boot");
  })();

  // ---------- 2. Saves ----------
  // saved = the workshop as last written (what syncs); live = the same
  // workshop brought to the clock now (saved stepped by the time since saved.at).
  var saved = null, stored = false, live = null;
  var prefs = { seen: 0, seenLife: 0, tour: 0 };
  var pending = null;                  // { timer } an action not yet written
  var undo = null;                     // { snap, kind } the state before the last action
  var lastDirty = 0, dirtyTimer = null, dirtyWaiting = false;
  var saveFailShown = false;
  var sol = null;                      // the solved bench (E.solve(live)), redone after every change

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
  function seenNow() { prefs.seen = nowMs(); prefs.seenLife = live.life; }
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
  function resolve() { sol = E.solve(live); }

  // ---------- 3. Clock + tick ----------
  var clockOff = 0;                     // advanceTime() moves the clock (tests)
  function nowMs() { return Date.now() + clockOff; }
  function tick() {
    if (!live) return;
    E.catchUp(live, nowMs());
    renderStatus();
    refreshPanel();
    refreshDialog();
    updateShop();
    if (reduced || document.hidden) draw();
  }

  // ---------- 4. Actions ----------
  // sel = the chosen cell (-1 none); cur = the keyboard cursor.
  var sel = -1, cur = -1;
  var lastDir = { b: 0, f: 0, p: 0, c: 0, k: 0, a: 0 };
  function checkSel() {
    var n = live.bd.length;
    if (sel >= n) sel = -1;
    if (cur >= n) cur = -1;
  }
  function errText(err, extra) {
    return t("toast." + err, { x: extra || "", k: fmt(E.NEW_E) });
  }
  function doAct(a, okToast, kind) {
    E.catchUp(live, nowMs());
    if (pending) commitNow();          // the previous action is written first
    var snap = E.clone(live);
    var err = E.act(live, a);
    if (err) {
      var x = a.u && E.UP[a.u] && E.UP[a.u].need ? t("part." + E.UP[a.u].need) : "";
      showToast(errText(err, x));
      sfx("no");
      return false;
    }
    undo = { snap: snap, kind: kind || a.t };
    commitSoon();
    resolve();
    sfx(a.t === "new" ? "new" : a.t === "put" ? (a.p === "g" ? "mesh" : "put") : a.t === "take" ? "take" : a.t === "turn" ? "turn" : "up");
    showToast(typeof okToast === "function" ? okToast() : okToast, true);
    checkSel();
    renderAll(true);
    return true;
  }
  function putPart(i, k) {
    var code = k === "g" ? "g" : k + lastDir[k];
    return doAct({ t: "put", i: i, p: code }, t("toast.put", { p: t("part." + k) }));
  }
  function turnPart(i, back) {
    var code = live.bd[i];
    if (!code || code === "g") return false;
    return doAct({ t: "turn", i: i, back: !!back }, function () {
      var c = live.bd[i];
      lastDir[E.kindOf(c)] = E.dirOf(c);
      return t("toast.turn", { p: partName(c), d: t("dir." + E.dirOf(c)) });
    });
  }
  function takePart(i) {
    var code = live.bd[i];
    if (!code) return false;
    return doAct({ t: "take", i: i }, t("toast.take", { p: partName(code) }));
  }
  function buy(id) { return doAct({ t: "buy", u: id }, t("toast.buy", { u: upName(id) })); }
  function undoLast() {
    if (!undo) return;
    var u = undo;
    undo = null;
    if (pending) { clearTimeout(pending.timer); pending = null; }
    live = u.snap;
    E.catchUp(live, nowMs());
    if (u.kind === "start") { saved = E.normalize(live); if (writeSaved()) dirtySoon(); }
    resolve();
    checkSel();
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
    // No Undo here: the confirm dialog is enough, and an Undo toast over the
    // toolbar brought the old workshop back on the next tap there.
    undo = null;
    prefs.seen = nowMs(); prefs.seenLife = live.life; savePrefs();
    sel = -1; cur = -1;
    saved = E.normalize(live);
    if (writeSaved()) dirtySoon();
    resolve();
    closeDialog();
    showToast(t("toast.start"));
    renderAll(true);
  }
  // A tap on cell i (the screen and the keyboard both come here).
  function tapCell(i) {
    if (i < 0 || i >= live.bd.length) return;
    cur = i;
    sel = sel === i ? -1 : i;
    sfx("pick");
    renderPanel();
    draw();
  }

  // ---------- 5. Scene ----------
  var canvas, ctx, dpr = 1, W = 0, H = 0;
  var reduced = false;
  var C = {};
  var G = {};                           // the grid: { ox, oy, cell }
  var GOOD_COL = ["#d9a441", "#c8ccd2", "#7fc6c9", "#f2d39a", "#e8a3b5"];
  var GOOD_GL = ["▬", "⚙︎", "∿", "◷", "☺︎"];
  var MACH_COL = { f: "#8c3b22", p: "#4f5d6b", c: "#335f63", k: "#6b5130", a: "#5b3f62" };

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
    var z = live ? E.size(live) : 5;
    var cell = Math.floor(Math.min((W - 16) / z, (H - 16) / z));
    cell = Math.max(20, Math.min(cell, 96));
    G.cell = cell;
    G.ox = Math.floor((W - cell * z) / 2);
    G.oy = Math.floor((H - cell * z) / 2);
    G.z = z;
  }
  function cellXY(i) { var z = G.z; return { x: G.ox + (i % z) * G.cell, y: G.oy + Math.floor(i / z) * G.cell }; }
  function centre(i) { var p = cellXY(i); return { x: p.x + G.cell / 2, y: p.y + G.cell / 2 }; }

  function draw(time) {
    if (!ctx || !live) return;
    if (G.z !== E.size(live)) layout();
    time = time || 0;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    // the wooden bench
    var grd = ctx.createLinearGradient(0, 0, 0, H);
    grd.addColorStop(0, "#3a2817"); grd.addColorStop(1, "#24180d");
    ctx.fillStyle = grd;
    ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = "rgba(255,230,190,0.05)";
    ctx.lineWidth = 1;
    for (var y = 6; y < H; y += 11) { ctx.beginPath(); ctx.moveTo(0, y); ctx.bezierCurveTo(W * 0.3, y + 3, W * 0.6, y - 3, W, y + 1); ctx.stroke(); }
    var z = G.z, n = z * z, c = G.cell;
    // the cells
    for (var i = 0; i < n; i++) {
      var p = cellXY(i);
      ctx.fillStyle = (i % z + Math.floor(i / z)) % 2 ? "rgba(255,240,215,0.05)" : "rgba(255,240,215,0.08)";
      ctx.fillRect(p.x + 1, p.y + 1, c - 2, c - 2);
    }
    // belts first, then the goods on them, then gears and machines
    for (i = 0; i < n; i++) if (E.kindOf(live.bd[i]) === "b") drawBelt(i, E.dirOf(live.bd[i]), time);
    drawGoods(time);
    for (i = 0; i < n; i++) {
      var code = live.bd[i], fx = E.fixedAt(live, i);
      if (fx === "W") drawWheel(i, time);
      else if (fx === "X") drawCrate(i);
      else if (code === "g") drawGear(i, time);
      else if (E.isMach(code)) drawMachine(i, code);
    }
    // the chosen cell and the keyboard cursor
    if (sel >= 0) {
      var q = cellXY(sel);
      ctx.strokeStyle = C.accent || "#e2e8f2"; ctx.lineWidth = 3;
      ctx.strokeRect(q.x + 2, q.y + 2, c - 4, c - 4);
    }
    if (cur >= 0 && document.activeElement === canvas && cur !== sel) {
      var r = cellXY(cur);
      ctx.strokeStyle = "#ffffff"; ctx.lineWidth = 1.5;
      ctx.setLineDash([3, 3]);
      ctx.strokeRect(r.x + 3, r.y + 3, c - 6, c - 6);
      ctx.setLineDash([]);
    }
  }
  function arrow(cx, cy, d, len, col, w) {
    var dx = E.DX[d], dy = E.DY[d];
    ctx.strokeStyle = col; ctx.lineWidth = w || 2; ctx.lineCap = "round";
    var tx = cx + dx * len, ty = cy + dy * len;
    ctx.beginPath();
    ctx.moveTo(cx - dx * len * 0.2, cy - dy * len * 0.2); ctx.lineTo(tx, ty);
    ctx.moveTo(tx, ty); ctx.lineTo(tx - dx * len * 0.45 - dy * len * 0.4, ty - dy * len * 0.45 + dx * len * 0.4);
    ctx.moveTo(tx, ty); ctx.lineTo(tx - dx * len * 0.45 + dy * len * 0.4, ty - dy * len * 0.45 - dx * len * 0.4);
    ctx.stroke();
    ctx.lineCap = "butt";
  }
  function drawBelt(i, d, time) {
    var p = cellXY(i), c = G.cell, m = c * 0.18;
    ctx.fillStyle = "#1d1a17";
    if (d % 2 === 0) ctx.fillRect(p.x + 1, p.y + m, c - 2, c - 2 * m);
    else ctx.fillRect(p.x + m, p.y + 1, c - 2 * m, c - 2);
    // chevrons, moving the way the belt points
    var off = reduced ? 0.5 : (time / 900) % 1;
    var ce = centre(i);
    ctx.save();
    ctx.beginPath();
    if (d % 2 === 0) ctx.rect(p.x + 1, p.y + m, c - 2, c - 2 * m); else ctx.rect(p.x + m, p.y + 1, c - 2 * m, c - 2);
    ctx.clip();
    for (var k = -1; k < 2; k++) {
      var s = (k + off) * c / 2;
      arrow(ce.x + E.DX[d] * s, ce.y + E.DY[d] * s, d, c * 0.12, "rgba(242,211,154,0.55)", 2);
    }
    ctx.restore();
  }
  function gearPath(cx, cy, r, teeth, rot) {
    ctx.beginPath();
    for (var k = 0; k < teeth * 2; k++) {
      var a0 = rot + (k / (teeth * 2)) * Math.PI * 2, a1 = rot + ((k + 1) / (teeth * 2)) * Math.PI * 2;
      var rr = k % 2 ? r * 0.8 : r;
      ctx.lineTo(cx + Math.cos(a0) * rr, cy + Math.sin(a0) * rr);
      ctx.lineTo(cx + Math.cos(a1) * rr, cy + Math.sin(a1) * rr);
    }
    ctx.closePath();
  }
  function spinOf(i) { return sol && !sol.jam && sol.spin[i] !== undefined ? sol.spin[i] : 0; }
  function drawGear(i, time) {
    var ce = centre(i), r = G.cell * 0.42, s = spinOf(i);
    var rot = reduced ? 0 : s * time / 1400 + (s < 0 ? Math.PI / 10 : 0);
    var jam = sol && sol.jam && sol.bad[i];
    ctx.fillStyle = jam ? "#8c4a42" : s ? "#c79a4b" : "#7a6a52";
    gearPath(ce.x, ce.y, r, 10, rot);
    ctx.fill();
    ctx.fillStyle = "#3a2817";
    ctx.beginPath(); ctx.arc(ce.x, ce.y, r * 0.28, 0, Math.PI * 2); ctx.fill();
    if (jam) {
      ctx.strokeStyle = "#ffffff"; ctx.lineWidth = 3;
      var k = r * 0.35;
      ctx.beginPath(); ctx.moveTo(ce.x - k, ce.y - k); ctx.lineTo(ce.x + k, ce.y + k); ctx.moveTo(ce.x + k, ce.y - k); ctx.lineTo(ce.x - k, ce.y + k); ctx.stroke();
    } else if (s) spinMark(ce.x, ce.y, r * 0.55, s);
  }
  // A small curved arrow: the way a gear turns, so it never rests on motion alone.
  function spinMark(cx, cy, r, s) {
    ctx.strokeStyle = "rgba(36,24,13,0.85)"; ctx.lineWidth = 2;
    var a0 = -Math.PI * 0.8, a1 = Math.PI * 0.1;
    ctx.beginPath(); ctx.arc(cx, cy, r, a0, a1, s < 0); ctx.stroke();
    var ea = s > 0 ? a1 : a0, ex = cx + Math.cos(ea) * r, ey = cy + Math.sin(ea) * r;
    var tg = ea + (s > 0 ? Math.PI / 2 : -Math.PI / 2);
    ctx.beginPath();
    ctx.moveTo(ex, ey); ctx.lineTo(ex - Math.cos(tg - 0.5) * 5, ey - Math.sin(tg - 0.5) * 5);
    ctx.moveTo(ex, ey); ctx.lineTo(ex - Math.cos(tg + 0.5) * 5, ey - Math.sin(tg + 0.5) * 5);
    ctx.stroke();
  }
  function drawWheel(i, time) {
    var ce = centre(i), r = G.cell * 0.44, rot = reduced || (sol && sol.jam) ? 0 : time / 1400;
    ctx.fillStyle = "#24435c";
    ctx.beginPath(); ctx.arc(ce.x, ce.y, r, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = "#9cc6e0"; ctx.lineWidth = 2;
    for (var k = 0; k < 8; k++) {
      var a = rot + k * Math.PI / 4;
      ctx.beginPath(); ctx.moveTo(ce.x, ce.y); ctx.lineTo(ce.x + Math.cos(a) * r, ce.y + Math.sin(a) * r); ctx.stroke();
      ctx.fillStyle = "#9cc6e0";
      ctx.fillRect(ce.x + Math.cos(a) * r * 0.85 - 2, ce.y + Math.sin(a) * r * 0.85 - 2, 4, 4);
    }
    ctx.beginPath(); ctx.arc(ce.x, ce.y, r, 0, Math.PI * 2); ctx.stroke();
    // water from the left
    ctx.fillStyle = "rgba(120,180,220,0.35)";
    var p = cellXY(i);
    ctx.fillRect(p.x, p.y + G.cell * 0.78, G.cell, G.cell * 0.18);
  }
  function drawCrate(i) {
    var p = cellXY(i), c = G.cell, m = c * 0.12;
    ctx.fillStyle = "#8a6233";
    ctx.fillRect(p.x + m, p.y + m, c - 2 * m, c - 2 * m);
    ctx.strokeStyle = "#5a3d1c"; ctx.lineWidth = 2;
    ctx.strokeRect(p.x + m, p.y + m, c - 2 * m, c - 2 * m);
    ctx.beginPath(); ctx.moveTo(p.x + m, p.y + m); ctx.lineTo(p.x + c - m, p.y + c - m); ctx.moveTo(p.x + c - m, p.y + m); ctx.lineTo(p.x + m, p.y + c - m); ctx.stroke();
    ctx.fillStyle = "#f2d39a";
    ctx.font = "800 " + Math.round(c * 0.3) + "px Nunito, system-ui, sans-serif";
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText("◎", p.x + c / 2, p.y + c / 2);
  }
  function drawMachine(i, code) {
    var p = cellXY(i), c = G.cell, m = c * 0.1, k = E.kindOf(code), d = E.dirOf(code);
    var st = sol && sol.ms[i] ? sol.ms[i].st : "idle";
    ctx.fillStyle = MACH_COL[k];
    roundRect(p.x + m, p.y + m, c - 2 * m, c - 2 * m, c * 0.14);
    ctx.fill();
    ctx.strokeStyle = st === "run" ? "#f2d39a" : st === "wait" ? "#c9b27a" : "rgba(255,255,255,0.25)";
    ctx.lineWidth = st === "run" ? 2 : 1.5;
    ctx.stroke();
    // what it makes
    var out = E.MACH[k].out;
    ctx.fillStyle = GOOD_COL[out];
    ctx.font = "800 " + Math.round(c * 0.34) + "px Nunito, system-ui, sans-serif";
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText(GOOD_GL[out], p.x + c / 2, p.y + c / 2 - c * 0.04);
    ctx.font = "800 " + Math.round(c * 0.2) + "px Nunito, system-ui, sans-serif";
    ctx.fillStyle = "rgba(255,255,255,0.75)";
    ctx.fillText(k.toUpperCase(), p.x + c * 0.25, p.y + c * 0.25);
    // the way it faces
    var ce = centre(i);
    arrow(ce.x + E.DX[d] * c * 0.26, ce.y + E.DY[d] * c * 0.26, d, c * 0.13, "#ffffff", 2.5);
    // a mark when it does not run
    if (st !== "run") {
      var mark = st === "wait" ? "…" : st === "idle" ? "◦" : "■";
      ctx.fillStyle = st === "wait" ? "#f2d39a" : "#ff9b8f";
      ctx.font = "800 " + Math.round(c * 0.22) + "px Nunito, system-ui, sans-serif";
      ctx.fillText(mark, p.x + c * 0.76, p.y + c * 0.76);
    }
  }
  function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y); ctx.lineTo(x + w - r, y); ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r); ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h); ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r); ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
  }
  // Small goods moving from each running machine along its path (look
  // only: the coins come from the solved rates).
  function drawGoods(time) {
    if (!sol || reduced) return;
    Object.keys(sol.ms).forEach(function (key) {
      var m = sol.ms[key];
      if (m.rate <= 0 || m.path.length < 2) return;
      var out = E.MACH[m.k].out, steps = m.path.length - 1;
      var speed = 0.0006, gap = Math.max(0.35, 1.2 / Math.max(0.3, Math.min(6, m.rate)));
      var total = steps;
      for (var u = ((time * speed) % gap) - gap; u < total; u += gap) {
        if (u < 0.5) continue;
        var seg = Math.floor(u), f = u - seg;
        if (seg >= steps) break;
        var a = centre(m.path[seg]), b = centre(m.path[seg + 1]);
        var x = a.x + (b.x - a.x) * f, y = a.y + (b.y - a.y) * f;
        ctx.fillStyle = GOOD_COL[out];
        ctx.beginPath(); ctx.arc(x, y, Math.max(2.5, G.cell * 0.07), 0, Math.PI * 2); ctx.fill();
      }
    });
  }
  var rafOn = false, lastFrame = 0;
  function frame(ts) {
    if (!rafOn) return;
    if (ts - lastFrame >= 40) { lastFrame = ts; draw(ts); }
    requestAnimationFrame(frame);
  }
  function startAnim() {
    if (reduced || rafOn || document.hidden) { draw(); return; }
    rafOn = true;
    requestAnimationFrame(frame);
  }
  function stopAnim() { rafOn = false; }

  // ---------- 6. Input ----------
  function cellAt(x, y) {
    var z = G.z, cx = Math.floor((x - G.ox) / G.cell), cy = Math.floor((y - G.oy) / G.cell);
    if (cx < 0 || cy < 0 || cx >= z || cy >= z) return -1;
    return cy * z + cx;
  }
  function cellWords(i) {
    var fx = E.fixedAt(live, i), code = live.bd[i];
    if (fx) return t("part." + fx);
    if (!code) return t("live.empty");
    if (code === "g") return t("part.g");
    return partName(code) + " → " + t("dir." + E.dirOf(code));
  }
  function announce(i) {
    var z = G.z;
    live_(t("live.cell", { r: Math.floor(i / z) + 1, c: i % z + 1, w: cellWords(i) }));
  }
  function wireInput() {
    canvas.addEventListener("pointerdown", function (ev) {
      var r = canvas.getBoundingClientRect(), i = cellAt(ev.clientX - r.left, ev.clientY - r.top);
      if (i >= 0) tapCell(i);
      else if (sel >= 0) { sel = -1; renderPanel(); draw(); }
    });
    canvas.addEventListener("focus", function () { if (cur < 0) cur = E.wheelCell(G.z) + 1; draw(); });
    canvas.addEventListener("blur", function () { draw(); });
    canvas.addEventListener("keydown", function (ev) {
      var z = G.z, dirs = { ArrowRight: [1, 0], ArrowLeft: [-1, 0], ArrowDown: [0, 1], ArrowUp: [0, -1] };
      if (cur < 0) cur = 0;
      if (dirs[ev.key]) {
        var x = Math.max(0, Math.min(z - 1, cur % z + dirs[ev.key][0])), y = Math.max(0, Math.min(z - 1, Math.floor(cur / z) + dirs[ev.key][1]));
        cur = y * z + x;
        if (sel >= 0) { sel = cur; renderPanel(); }
        announce(cur);
        draw();
        ev.preventDefault();
      } else if (ev.key === "Enter" || ev.key === " ") { tapCell(cur); ev.preventDefault(); }
      else if (ev.key === "Delete" || ev.key === "Backspace") { if (live.bd[cur]) takePart(cur); ev.preventDefault(); }
      else if (ev.key === "r" || ev.key === "R") { turnPart(cur, ev.shiftKey); ev.preventDefault(); }
      else if (/^[1-7]$/.test(ev.key)) {
        if (!live.bd[cur] && !E.fixedAt(live, cur)) putPart(cur, E.PARTS[+ev.key - 1]);
        ev.preventDefault();
      }
      else if (ev.key === "Escape" && sel >= 0) { sel = -1; renderPanel(); draw(); ev.preventDefault(); }
    });
  }
  function wireKeyboard() {
    document.addEventListener("keydown", function (ev) {
      if (ev.ctrlKey || ev.altKey || ev.metaKey) return;
      if ($("dlg").open) return;
      if (ev.target === canvas && /^(r|[1-7])$/i.test(ev.key)) return;
      var k = ev.key.toLowerCase();
      if (k === "u") { upDialog(); ev.preventDefault(); }
      else if (k === "p") { pbDialog(); ev.preventDefault(); }
      else if (k === "e") { newDialog(); ev.preventDefault(); }
      else if (k === "s") { recDialog(); ev.preventDefault(); }
      else if (k === "h" || ev.key === "?") { tourDialog(); ev.preventDefault(); }
      else if (k === "m") { toggleSfx(); ev.preventDefault(); }
      else if (k === "r" && sel >= 0) { turnPart(sel, ev.shiftKey); ev.preventDefault(); }
      else if (k === "z" && undo) { undoLast(); ev.preventDefault(); }
    });
  }

  // ---------- 7. Panels ----------
  function renderAll(full) {
    if (!sol) resolve();
    if (G.z !== E.size(live)) layout();
    renderStatus();
    if (full) renderPanel(); else refreshPanel();
    refreshDialog(full);
    draw();
  }
  function renderStatus() {
    var c = $("s-co");
    c.querySelector(".v").textContent = fmt(live.co);
    c.querySelector(".r").textContent = t("st.rate", { n: fmtRate(sol.inc) });
    c.title = t("st.co");
    var pw = $("s-pw");
    pw.querySelector(".v").textContent = sol.need + "/" + sol.P;
    pw.title = t("st.pw", { n: sol.need, p: sol.P });
    pw.classList.toggle("low", sol.need > sol.P);
    var tr = $("s-tr"), w = sol.jam ? "jam" : sol.train || sol.need ? "turn" : "still";
    tr.querySelector(".v").textContent = t("st." + w);
    tr.title = sol.jam ? t("st.trJam") : sol.train || sol.need ? t("st.trTurn", { n: sol.train }) : t("st.trStill");
    tr.classList.toggle("jam", sol.jam);
    var can = E.canNew(live), nb = $("new-btn");
    if (nb.hidden === can) nb.hidden = !can;
    $("tb-ws").textContent = t("ws", { n: live.wn + 1, z: E.size(live) });
  }
  var lastPanelKey = "";
  function panelKey() {
    return [sel, sel >= 0 ? live.bd[sel] : "", E.canNew(live), sol && sol.jam, live.bd.length, LANG].join("|");
  }
  function machWords(i) {
    var m = sol.ms[i], out = E.MACH[m.k].out, g = t("good." + out);
    if (m.st === "run" || m.st === "wait") return t("ms." + m.st, { r: fmtRate(m.rate), g: g });
    return t("ms." + m.st, { g: g });
  }
  function renderPanel() {
    var box = $("panel");
    box.textContent = "";
    lastPanelKey = panelKey();
    if (sel >= 0) {
      var z = E.size(live), code = live.bd[sel], fx = E.fixedAt(live, sel);
      var head = el("div", "pn-head");
      head.appendChild(el("span", "pn-title", fx ? t("part." + fx) : code ? partName(code) : t("cell.empty")));
      head.appendChild(el("span", "pn-sub", t("cell.at", { r: Math.floor(sel / z) + 1, c: sel % z + 1 })));
      box.appendChild(head);
      if (fx) {
        box.appendChild(el("p", "pn-fx", fx === "W" ? t("fx.W", { p: sol.P }) : t("fx.X")));
        if (fx === "X") {
          var pr = [];
          for (var g = 0; g < 5; g++) pr.push(t("price", { g: t("good1." + g), c: fmtRate(E.PRICE[g] * E.priceF(live)) }));
          box.appendChild(el("p", "pn-sub", pr.join(" · ")));
        }
      } else if (!code) {
        box.appendChild(el("p", "pn-sub", t("cell.pick")));
        var tray = el("div", "tray");
        E.PARTS.forEach(function (k, n) {
          var b = el("button", "opt");
          b.type = "button";
          b.setAttribute("data-p", k);
          var gl = el("span", "gl", k === "g" ? "⚙︎" : k === "b" ? "➜" : GOOD_GL[E.MACH[k].out]);
          gl.setAttribute("aria-hidden", "true");
          b.appendChild(gl);
          var tx = el("span", "tx");
          tx.appendChild(el("span", "nm", (n + 1) + " · " + t("part." + k)));
          tx.appendChild(el("span", "fx"));
          b.appendChild(tx);
          b.addEventListener("click", function () { putPart(sel, k); });
          tray.appendChild(b);
        });
        box.appendChild(tray);
      } else {
        var k = E.kindOf(code);
        if (code === "g") {
          var s = sol.jam && sol.bad[sel] ? "gear.jam" : sol.spin[sel] === 1 ? "gear.cw" : sol.spin[sel] === -1 ? (sol.jam ? "gear.jam" : "gear.ccw") : "gear.still";
          if (sol.jam && sol.spin[sel] !== undefined && !sol.bad[sel]) s = "ms.jam";
          box.appendChild(el("p", "pn-fx pn-st", t(s)));
          box.appendChild(el("p", "pn-sub", t("fx.g")));
        } else if (k === "b") {
          box.appendChild(el("p", "pn-fx", t("fx.b") + " → " + t("dir." + E.dirOf(code))));
        } else {
          var mm = sol.ms[sel];
          box.appendChild(el("p", "pn-fx pn-st " + (mm.st === "run" ? "" : "pn-err"), machWords(sel)));
          var spd = E.MACH[k].sp * E.speedF(live, k);
          box.appendChild(el("p", "pn-sub", t("fx." + k, { r: fmtRate(spd) })));
          if (mm.tgt !== -1) box.appendChild(el("p", "pn-sub", t("ms.to", { g: t("good." + E.MACH[k].out), t: mm.tgt === "X" ? t("ms.toX") : t("part." + sol.ms[mm.tgt].k) })));
          if (sol.share < 1 && mm.on) box.appendChild(el("p", "pn-sub", t("ms.slow", { p: sol.P, n: sol.need, s: Math.round(sol.share * 100) })));
        }
        var row = el("div", "pn-row");
        var acts = [];
        if (code !== "g") acts.push(["btn.turn", function () { turnPart(sel); }, "primary"]);
        acts.push(["btn.take", function () { takePart(sel); }, "danger"]);
        acts.push(["btn.close", function () { sel = -1; renderPanel(); draw(); }, ""]);
        acts.forEach(function (x) {
          var b = el("button", "dlg-btn " + x[2], t(x[0]));
          b.type = "button"; b.addEventListener("click", x[1]); row.appendChild(b);
        });
        box.appendChild(row);
        box.appendChild(el("p", "pn-sub", t("cell.refund", { c: fmt(E.refundOf(live, k)) })));
      }
      refreshPanel(true);
      return;
    }
    if (sol.jam) box.appendChild(el("p", "pn-hint warn", t("pn.jam")));
    else box.appendChild(el("p", "pn-hint", t("pn.hint")));
    box.appendChild(el("p", "pn-hint pn-next"));
    if (E.canNew(live)) {
      var hb = el("button", "opt wide pn-hand");
      hb.type = "button";
      hb.appendChild(el("span", "tx")).appendChild(el("span", "nm", t("btn.new")));
      hb.addEventListener("click", newDialog);
      box.appendChild(hb);
    }
    refreshPanel(true);
  }
  function refreshPanel(force) {
    if (!force && panelKey() !== lastPanelKey) { renderPanel(); return; }
    var box = $("panel");
    var next = box.querySelector(".pn-next");
    if (next) next.textContent = E.canNew(live) ? t("pn.ready", { k: fmt(E.NEW_E) }) : t("pn.next", { n: fmt(live.we), k: fmt(E.NEW_E) });
    [].forEach.call(box.querySelectorAll(".tray .opt"), function (b) {
      var k = b.getAttribute("data-p"), c = E.partCost(live, k);
      b.querySelector(".fx").textContent = c ? t("up.cost", { c: fmt(Math.ceil(c)) }) : "0 ◎";
      b.disabled = live.co < c;
    });
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
  function upDialog() {
    E.catchUp(live, nowMs());
    openDialog("up", function (d) {
      d.setAttribute("aria-label", t("up.title"));
      d.appendChild(el("div", "dlg-title", t("up.title")));
      var list = el("div", "up-list");
      E.UPS.forEach(function (u) {
        var row = el("div", "up-row");
        row.setAttribute("data-u", u.id);
        var tx = el("div", "tx");
        var nm = el("div", "nm");
        nm.appendChild(document.createTextNode(upName(u.id)));
        nm.appendChild(el("span", "lv"));
        tx.appendChild(nm);
        tx.appendChild(el("div", "fx", upFx(u.id)));
        row.appendChild(tx);
        var b = el("button", "dlg-btn primary");
        b.type = "button";
        b.addEventListener("click", function () { buy(u.id); });
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
    if (dlgKind === "pb") { refreshPb(); return; }
    if (dlgKind !== "up") return;
    var d = $("dlg");
    E.UPS.forEach(function (u) {
      var row = d.querySelector('[data-u="' + u.id + '"]');
      if (!row) return;
      var inf = E.upInfo(live, u.id), b = row.querySelector("button");
      row.querySelector(".lv").textContent = " " + t("up.lv", { l: inf.lv, max: inf.max });
      b.textContent = inf.done ? t("up.max") : !inf.need ? t("up.need", { t: t("part." + E.UP[u.id].need) }) : inf.blocked ? t("up.doorBusy") : t("up.cost", { c: fmt(Math.ceil(inf.c)) });
      b.disabled = !inf.ok;
    });
    var note = d.querySelector(".up-note");
    if (note) note.textContent = t("up.note", { r: fmtRate(sol.inc), n: sol.need, p: sol.P });
  }
  // A small drawing of a bench, built as SVG nodes (no markup from data).
  var SVGNS = "http://www.w3.org/2000/svg";
  function miniBench(z, bd) {
    var svg = document.createElementNS(SVGNS, "svg"), c = 70 / z;
    svg.setAttribute("viewBox", "0 0 70 70");
    svg.setAttribute("aria-hidden", "true");
    function rect(i, col, inset, round) {
      var r = document.createElementNS(SVGNS, round ? "circle" : "rect"), x = (i % z) * c, y = Math.floor(i / z) * c;
      if (round) { r.setAttribute("cx", x + c / 2); r.setAttribute("cy", y + c / 2); r.setAttribute("r", c * 0.4); }
      else { r.setAttribute("x", x + inset); r.setAttribute("y", y + inset); r.setAttribute("width", c - 2 * inset); r.setAttribute("height", c - 2 * inset); }
      r.setAttribute("fill", col);
      svg.appendChild(r);
    }
    rect(E.wheelCell(z), "#9cc6e0", 1, true);
    rect(E.crateCell(z), "#8a6233", 1);
    bd.forEach(function (code, i) {
      if (!code) return;
      var k = E.kindOf(code);
      if (k === "g") rect(i, "#c79a4b", 0, true);
      else if (k === "b") rect(i, "#5a4a3a", c * 0.3);
      else rect(i, MACH_COL[k], 1);
    });
    return svg;
  }
  function pbDialog() {
    E.catchUp(live, nowMs());
    openDialog("pb", function (d) {
      d.setAttribute("aria-label", t("pb.title"));
      d.appendChild(el("div", "dlg-title", t("pb.title")));
      if (!live.pb.length) d.appendChild(el("p", "dlg-note", t("pb.none")));
      else {
        var list = el("div", "pb-list");
        for (var k = live.pb.length - 1; k >= 0; k--) (function (k) {
          var p = live.pb[k], it = el("div", "pb-item");
          it.setAttribute("data-k", k);
          it.appendChild(miniBench(p.z, p.bd));
          var tx = el("div", "tx");
          tx.appendChild(el("span", "nm", t("pb.item", { n: p.n, z: p.z })));
          tx.appendChild(el("span", "fx", t("pb.earned", { e: fmt(p.e) })));
          it.appendChild(tx);
          var b = el("button", "dlg-btn primary");
          b.type = "button";
          b.addEventListener("click", function () {
            if (doAct({ t: "pattern", k: k }, t("toast.lay"))) closeDialog();
          });
          it.appendChild(b);
          list.appendChild(it);
        })(k);
        d.appendChild(list);
        d.appendChild(el("p", "dlg-note", t("pb.bonus", { p: Math.round(E.PB_F * live.wn * 100) })));
        d.appendChild(el("p", "dlg-note", t("pb.note")));
      }
      actions(d, [{ label: t("btn.close"), fn: closeDialog }]);
    });
    refreshPb();
  }
  function refreshPb() {
    [].forEach.call($("dlg").querySelectorAll(".pb-item"), function (it) {
      var k = +it.getAttribute("data-k"), pc = E.patternCost(live, k), b = it.querySelector("button");
      if (!pc) return;
      b.textContent = t("pb.cost", { c: fmt(Math.ceil(pc.cost)) });
      b.disabled = live.co + pc.back < pc.cost || !pc.cells;
      b.title = t("cell.refund", { c: fmt(pc.back) });
    });
  }
  function recDialog() {
    E.catchUp(live, nowMs());
    openDialog("rec", function (d) {
      d.setAttribute("aria-label", t("rec.title"));
      d.appendChild(el("div", "dlg-title", t("rec.title")));
      rowKV(d, t("rec.life"), fmt(live.life));
      rowKV(d, t("rec.ws"), t("ws", { n: live.wn + 1, z: E.size(live) }));
      rowKV(d, t("rec.we"), fmt(live.we));
      rowKV(d, t("rec.ship"), live.sh.map(function (n, g) { return fmt(n) + " " + GOOD_GL[g]; }).join(" · "));
      var cnt = {};
      live.tr.forEach(function (x) { cnt[x] = (cnt[x] || 0) + 1; });
      rowKV(d, t("rec.marks"), Object.keys(cnt).map(function (x) { return t("tr." + x) + (cnt[x] > 1 ? " ×" + cnt[x] : ""); }).join(", ") || t("rec.none"));
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
      [["rec.sfx", sfxOn, function (v) { if (v !== sfxOn()) toggleSfx(); }], ["rec.shop", shopOn, setShop]].forEach(function (x) {
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
  function newDialog() {
    E.catchUp(live, nowMs());
    if (!E.canNew(live)) { showToast(t("toast.nonew", { k: fmt(E.NEW_E) })); sfx("no"); return; }
    var off = E.offer(live), pickTr = off[0];
    openDialog("new", function (d) {
      d.setAttribute("aria-label", t("nw.title"));
      d.appendChild(el("div", "dlg-title", t("nw.title")));
      d.appendChild(el("p", "dlg-msg", t("nw.msg")));
      var fs = el("fieldset", "sw-group");
      fs.appendChild(el("legend", "", t("nw.trait")));
      off.forEach(function (id) {
        var lb = el("label", "sw-opt");
        var r = el("input");
        r.type = "radio"; r.name = "nw-tr"; r.value = id;
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
      d.appendChild(el("p", "dlg-note", t("nw.note")));
      actions(d, [
        { label: t("nw.later"), fn: closeDialog },
        { label: t("nw.go"), cls: "primary", fn: function () {
          var tr = pickTr;
          closeDialog();
          sel = -1; cur = -1;
          doAct({ t: "new", tr: tr }, t("toast.new", { n: live.wn + 2 }));
          layout();
          draw();
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
      for (var g = 0; g < 5; g++) if (info.ship[g] >= 1) rowKV(d, t("good." + g), fmt(info.ship[g]));
      rowKV(d, t("away.co"), fmt(live.co));
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
        if (n && typeof n.transient === "function" && n.transient({ ns: "clockwork", title: String(text) })) return;
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
  var HAPTIC = { up: "good", put: "tap", mesh: "tap", new: "good", no: "bad", turn: "tap" };
  function sfx(kind) {
    if (window.orosHaptics && HAPTIC[kind]) window.orosHaptics.cue(HAPTIC[kind]);
    if (!sfxOn()) return;
    try {
      if (!ac()) return;
      if (kind === "up") { tone(523, 0, 0.1, "triangle", 0.07); tone(659, 0.07, 0.12, "triangle", 0.06); }
      else if (kind === "mesh") { tone(2400, 0, 0.03, "square", 0.025); tone(1800, 0.04, 0.03, "square", 0.02); }
      else if (kind === "put") tone(330, 0, 0.09, "triangle", 0.08);
      else if (kind === "take") tone(220, 0, 0.09, "triangle", 0.06);
      else if (kind === "turn") tone(1600, 0, 0.035, "square", 0.02);
      else if (kind === "pick") tone(1175, 0, 0.05, "sine", 0.03);
      else if (kind === "new") [392, 523, 659, 784, 1047].forEach(function (f, k) { tone(f, k * 0.1, 0.5, "triangle", 0.06); });
      else if (kind === "undo") { tone(659, 0, 0.08, "sine", 0.06); tone(523, 0.06, 0.1, "sine", 0.05); }
      else if (kind === "no") tone(180, 0, 0.14, "sawtooth", 0.04);
      else if (kind === "toggle") { tone(1047, 0, 0.05, "sine", 0.08); tone(1319, 0.04, 0.07, "sine", 0.07); }
    } catch (e) { /* no audio → silent */ }
  }
  // The workshop: off by default; a far water wheel (filtered noise),
  // a soft tick every second while the train turns, and a small bell
  // now and then when goods reach the crate.
  var shop = null, bellAt = 0;
  function shopOn() {
    try { return localStorage.getItem(SHOP_KEY) === "1"; } catch (e) { return false; }
  }
  function setShop(on) {
    try { localStorage.setItem(SHOP_KEY, on ? "1" : "0"); } catch (e) {}
    updateShop();
  }
  function updateShop() {
    var want = shopOn() && live && !document.hidden ? 0.018 : 0;
    if (!want && !shop) return;
    try {
      if (!ac()) return;
      if (!shop) {
        var len = audio.sampleRate * 2, buf = audio.createBuffer(1, len, audio.sampleRate), data = buf.getChannelData(0);
        var last = 0;
        for (var i = 0; i < len; i++) { last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02; data[i] = last * 3.5; }
        var src = audio.createBufferSource();
        src.buffer = buf; src.loop = true;
        var lp = audio.createBiquadFilter(), g = audio.createGain();
        lp.type = "lowpass"; lp.frequency.value = 520;
        g.gain.value = 0;
        src.connect(lp); lp.connect(g); g.connect(audio.destination);
        src.start();
        shop = { g: g, src: src };
      }
      shop.g.gain.setTargetAtTime(want, audio.currentTime, 1.5);
      if (want && sol && sol.train && !sol.jam) tone(3200, 0, 0.02, "square", 0.004);
      if (want && sol && sol.inc > 0 && Date.now() - bellAt > 12000 + Math.random() * 12000) {
        bellAt = Date.now();
        tone(1760, 0, 0.5, "sine", 0.008);
      }
      if (!want) {
        var s = shop;
        shop = null;
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
    up:     SVG + '<path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 0 0 5.4-5.4l-2.6 2.6-2.4-.6-.6-2.4z"/></svg>',
    pb:     SVG + '<path d="M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2z"/><path d="M4 19V5"/><path d="M9 7h6v6H9z"/><path d="M12 7v6M9 10h6"/></svg>',
    help:   SVG + '<circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6v.6"/><path d="M12 17.2v.1"/></svg>',
    stats:  SVG + '<path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0z"/><path d="M17 5h3v2a3 3 0 0 1-3 3M7 5H4v2a3 3 0 0 0 3 3"/></svg>',
    sfxOn:  SVG + '<path d="M11 5 6 9H2v6h4l5 4z"/><path d="M15.5 8.5a5 5 0 0 1 0 7M19 5a10 10 0 0 1 0 14"/></svg>',
    sfxOff: SVG + '<path d="M11 5 6 9H2v6h4l5 4z"/><path d="M22 9l-6 6M16 9l6 6"/></svg>',
    co:     SVG + '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="4"/></svg>',
    pw:     SVG + '<path d="M13 2 4 14h7l-1 8 9-12h-7z"/></svg>',
    gear:   SVG + '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9 7 7M17 17l2.1 2.1M4.9 19.1 7 17M17 7l2.1-2.1"/></svg>',
    newws:  SVG + '<path d="M3 21V9l9-6 9 6v12z"/><path d="M9 21v-6h6v6"/><path d="M12 7v4M10 9h4"/></svg>'
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
    if (live) draw();
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
    api.registerSlice("clockwork", sliceGet, sliceSet, STORAGE_KEY, mergeShop);
  }
  function mergeShop(a, b) { return E.merge(a, b); }
  // The workshop as written, never the ticking one (R26).
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
      resolve();
      checkSel();
      layout();
      renderAll(true);
    } catch (e) {
    } finally {
      window.__orosSyncApi._suppress = false;
    }
  }

  // ---------- 12. Test hooks, wiring & boot ----------
  // render_game_to_text: the visible state as JSON. The bench is a grid
  // of z × z cells; every cell carries its canvas centre (x, y in CSS px).
  window.render_game_to_text = function () {
    if (!live) return "{}";
    var z = E.size(live), cells = [];
    for (var i = 0; i < live.bd.length; i++) {
      var ce = centre(i), m = sol.ms[i];
      cells.push({ i: i, x: Math.round(ce.x), y: Math.round(ce.y), part: E.fixedAt(live, i) || live.bd[i],
                   st: m ? m.st : live.bd[i] === "g" ? (sol.jam && sol.bad[i] ? "jam" : sol.spin[i] ? (sol.spin[i] > 0 ? "cw" : "ccw") : "still") : "" });
    }
    return JSON.stringify({
      mode: dlgKind || "play", workshop: live.wn + 1, size: z, co: Math.floor(live.co), perMin: Math.round(sol.inc * 100) / 100,
      power: sol.P, need: sol.need, jam: sol.jam, train: sol.train, canNew: E.canNew(live), offer: E.offer(live),
      marks: live.tr, book: live.pb.length, lv: live.lv, sel: sel, cur: cur, shipped: live.ws.map(function (n) { return Math.round(n * 100) / 100; }),
      cells: cells,
      note: "tap a cell (x, y); an empty cell shows the parts tray (keys 1-7), a part can be turned (R) or taken back (Delete)"
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
    var nb = $("new-btn");
    nb.querySelector(".ic").innerHTML = ICONS.newws;
    nb.title = t("btn.newKey");
    var ub = $("up-btn");
    ub.querySelector(".ic").innerHTML = ICONS.up;
    ub.title = t("btn.upKey");
    [["pb-btn", "pb", "btn.pb"], ["stats-btn", "stats", "btn.stats"], ["help-btn", "help", "btn.help"]].forEach(function (x) {
      var b = $(x[0]);
      b.innerHTML = ICONS[x[1]];
      b.setAttribute("aria-label", t(x[2]));
      b.title = t(x[2]);
    });
    [["s-co", "co"], ["s-pw", "pw"], ["s-tr", "gear"]].forEach(function (x) {
      $(x[0]).querySelector(".ic").innerHTML = ICONS[x[1]];
    });
    paintSfxBtn();
  }
  function wire() {
    $("up-btn").addEventListener("click", upDialog);
    $("new-btn").addEventListener("click", newDialog);
    $("pb-btn").addEventListener("click", pbDialog);
    $("stats-btn").addEventListener("click", recDialog);
    $("help-btn").addEventListener("click", tourDialog);
    $("sfx-btn").addEventListener("click", toggleSfx);
    document.addEventListener("pointerdown", function () { if (shopOn()) updateShop(); }, { once: true });
    $("dlg").addEventListener("close", function () { dlgKind = ""; });
    $("dlg").addEventListener("cancel", function () {
      if (dlgKind === "tour") { prefs.tour = 1; savePrefs(); }
    });
    wireInput();
    wireKeyboard();
    window.addEventListener("resize", resize);
    if (window.ResizeObserver) new ResizeObserver(resize).observe($("scene"));
    document.addEventListener("visibilitychange", function () {
      if (document.hidden) { flushOut(); stopAnim(); updateShop(); }
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
  // Coming back to the page: the away card when the workshop moved on.
  function onReturn() {
    if (!live) return;
    var before = { life: prefs.seenLife, seen: prefs.seen };
    var out = E.catchUp(live, nowMs());
    if (out.dt > CHECKPOINT || out.slowed) checkpoint();
    var away = nowMs() - before.seen;
    if (before.seen && away >= AWAY_MS && !$("dlg").open) {
      awayDialog({ made: Math.max(0, live.life - before.life), ms: away, slowed: away > E.fullMs(live),
                   ship: out.ship });
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
    live = E.clone(saved);
    resolve();
    inheritPalette();
    watchPalette();
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
