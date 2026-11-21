// ============================================================
// orOS Lighthouse Island — App logic (v1.0.0)
// An idle game: keep the light burning on a small island. The lamp
// guides the ships at night (and in fog) and each one pays its dues;
// by day the harbour, the boats and the tavern work. The forecast at
// the top shows the weather ahead, so you choose which defence to build
// first. The rules live in lighthouse/engine.js (LighthouseEngine,
// tested headless); this file is the screen, the saves and the clock.
//   - one game hour = 1 minute; the island goes on while orOS is closed
//   - away: full pace for 7 days, then half pace (never stops)
//   - a calm "While you were away" card, no notifications, no streaks
//   - Undo after every purchase, Start over with Undo
// Data:
//   - synced slice "lighthouse" (oros-lighthouse-data): the island, as
//     the engine keeps it. Written only after a person's own action (a
//     few seconds later, so Undo stays local), or as a checkpoint when
//     the game opens after more than a day; idle hours never write.
//     markDirty at most once every 5 minutes, and on the way out.
//     Merge: LighthouseEngine.merge (the further-ahead island wins).
//   - device-local (R10): oros-lighthouse-prefs (last seen, the tour),
//     oros-lighthouse-session (actions so far, for gamekit/resume.js),
//     oros-lighthouse-sfx (sound), oros-lighthouse-sea (sea sound)
// Sections:
//   1. Constants, i18n, helpers
//   2. Saves: load / commit / checkpoint / dirty throttle
//   3. Clock + tick
//   4. Actions (build, hand over, undo, start over)
//   5. Scene (the island on one canvas)
//   6. Input (tap, keyboard)
//   7. Panels (status, forecast, place panel)
//   8. Dialogs (buildings, forecast, log, records, hand over, away, tour)
//   9. Toasts
//  10. Sound
//  11. Sync slice + palette
//  12. Test hooks, wiring & boot
// ============================================================
(function () {
  "use strict";

  var E = window.LighthouseEngine;

  var STORAGE_KEY = "oros-lighthouse-data";
  var PREFS_KEY   = "oros-lighthouse-prefs";
  var SESSION_KEY = "oros-lighthouse-session";
  var SFX_KEY     = "oros-lighthouse-sfx";
  var SEA_KEY     = "oros-lighthouse-sea";
  var UNDO_MS     = 6000;              // Undo stays on screen this long
  var COMMIT_MS   = 7000;              // a purchase is saved after this
  var DIRTY_GAP   = 5 * 60000;         // markDirty at most this often
  var CHECKPOINT  = 86400000;          // open after a day away: save once
  var AWAY_HR     = 12;                // the away card from 12 game hours

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
      "app.name": "Lighthouse Island",
      "btn.up": "Buildings", "btn.upKey": "Buildings (U)", "btn.log": "Keeper's log (L)",
      "btn.help": "How to play (?)", "btn.stats": "Records (S)", "btn.sfxOn": "Sound on (M)", "btn.sfxOff": "Sound off (M)",
      "btn.close": "Close", "btn.ok": "Good", "btn.undo": "Undo", "btn.cancel": "Cancel",
      "btn.start": "Start over", "btn.startYes": "Start over", "btn.hand": "Hand over", "btn.handKey": "Hand over (H)",
      "btn.fc": "Forecast (F)",
      "view.label": "The island: the lighthouse, the keeper's house, the harbour, the boats and the tavern. Arrow keys choose a place.",
      "num.dec": ".", "num.k": "K", "num.m": "M", "num.b": "B", "num.t": "T",
      "st.coins": "Coins", "st.sup": "Supplies (timber and stone)", "st.fish": "Fish", "st.ships": "Ships guided on this island",
      "st.rate": "+{n}/min", "st.clock": "Day {d} · {h}", "st.night": "night: the light is on", "st.day": "day: the harbour works",
      "st.fog": "fog: the light is on by day too",
      "wx.calm": "calm", "wx.wind": "wind", "wx.rain": "rain", "wx.fog": "fog", "wx.storm": "storm",
      "wxn.calm": "Calm: everything works in full.",
      "wxn.wind": "Wind: the boats catch 40% less, unless there is a breakwater.",
      "wxn.rain": "Rain: the light reaches 30% fewer ships without a rain hood; the harbour works 20% less.",
      "wxn.fog": "Fog: the light is on by day too, but only 40% of the ships find their way (80% with the fog horn).",
      "wxn.storm": "Storm: the light reaches 30% of the ships (70% with storm shutters), the harbour works at half and the boats stay in (half with a breakwater).",
      "q.0": "night", "q.1": "morning", "q.2": "afternoon", "q.3": "evening",
      "fc.day": "Day {d}", "fc.cell": "Day {d}, {q}: {w}", "fc.title": "Forecast",
      "fc.note": "The weather is the same on every device. A defence in Buildings softens one kind of weather.",
      "pl.light": "Lighthouse", "pl.house": "Keeper's house", "pl.harbour": "Harbour", "pl.boats": "Fishing boats", "pl.tavern": "Tavern",
      "pl.light.fx": "The lamp, its lens and the weather defences. Sea routes: {r}.",
      "pl.house.fx": "Oil for the lamp and a workshop for the builders.",
      "pl.harbour.fx": "Docked ships pay by day; cargo ships bring supplies.",
      "pl.boats.fx": "They fish by day; the tavern sells the catch. Fish waiting: {f}.",
      "pl.tavern.fx": "Sells up to {n} fish an hour, {c} coins each.",
      "lamp.0": "Wick", "lamp.1": "Oil lamp", "lamp.2": "Mantle", "lamp.3": "Lens", "lamp.4": "Great lens",
      "up.lamp": "Lamp", "up.lamp.fx": "{next}: the light reaches one more sea route.", "up.lamp.top": "The great lens reaches every route.",
      "up.polish": "Lens polish", "up.polish.fx": "The light is 15% stronger: every ship pays more.",
      "up.rot": "Clockwork rotation", "up.rot.fx": "The beam turns: 10% more from every ship.", "up.rot.need": "the mantle",
      "up.hood": "Rain hood", "up.hood.fx": "Rain no longer dims the light.",
      "up.horn": "Fog horn", "up.horn.fx": "In fog 80% of the ships find their way, not 40%.",
      "up.shut": "Storm shutters", "up.shut.fx": "In a storm the light reaches 70% of the ships, not 30%.",
      "up.store": "Oil store", "up.store.fx": "Oil for the lamp costs 20% less.",
      "up.shop": "Workshop", "up.shop.fx": "Buildings need 10% fewer supplies.",
      "up.pier": "Pier", "up.pier.fx": "Room for docked ships: 3 coins every day hour.",
      "up.ferry": "Ferry pier", "up.ferry.fx": "The ferry calls by day: 8 coins every day hour.", "up.ferry.need": "the mantle and a pier",
      "up.ware": "Warehouse", "up.ware.fx": "25% more supplies from every ship.",
      "up.brk": "Breakwater", "up.brk.fx": "The boats keep working in wind, and at half in a storm.",
      "up.boat": "Fishing boat", "up.boat.fx": "Another boat: 2 fish every day hour.",
      "up.nets": "Nets", "up.nets.fx": "The boats catch 20% more.",
      "up.tables": "Tavern table", "up.tables.fx": "The tavern sells 3 more fish an hour.",
      "up.rooms": "Rooms", "up.rooms.fx": "Sailors stay the night: harbour fees +15%.",
      "up.title": "Buildings", "up.lv": "{l}/{max}", "up.max": "Done", "up.cost": "{c} coins", "up.costS": "{c} coins · {s} supplies",
      "up.need": "Needs {x}",
      "up.note": "Coins per minute now: {r}. Sea routes the light reaches: {n} of 5 (+{p}%). Oil: {o} coins a night hour.",
      "rt.lanes": "fishing lanes", "rt.caique": "caique route", "rt.ferry": "island ferry", "rt.cargo": "cargo route", "rt.merchant": "far merchant route",
      "rts.lanes": "The fishing boat", "rts.caique": "The caique", "rts.ferry": "The ferry", "rts.cargo": "The cargo ship", "rts.merchant": "The merchant ship",
      "pn.hint": "Tap a place on the island to build there: the lighthouse, the keeper's house, the harbour, the boats or the tavern. The forecast at the top shows the weather ahead.",
      "pn.ships": "Ships guided here: {n} of {k}. The lens and {k} ships open the handover.",
      "pn.shipsLens": "Ships guided here: {n} of {k}. Build the lens to open the handover.",
      "pn.low": "The coins for oil ran out, so the lamp burns low until there are coins again. No ship is lost.",
      "pn.adv": "{w} {when}. {fx}",
      "pn.when.now": "now", "pn.when.h": "in {n} hours",
      "pn.adv.fog": "The fog horn would keep 80% of the ships guided.",
      "pn.adv.storm": "Storm shutters would keep 70% of the ships guided.",
      "pn.adv.rain": "A rain hood would keep the light clear.",
      "pn.adv.wind": "A breakwater would keep the boats working.",
      "pn.hand": "The light is ready to hand over: open Hand over to see the choice. There is no hurry.",
      "rec.title": "Records", "rec.day": "Day", "rec.life": "Coins earned in all", "rec.ships": "Ships guided in all",
      "rec.here": "Ships guided on this island", "rec.isle": "Island", "rec.lights": "Lighthouses kept", "rec.traits": "Traits",
      "rec.chart": "Sea chart", "rec.lhItem": "Lighthouse {n} · {is} · {d} days · {sh} ships",
      "rec.lhNone": "No old lighthouses yet: the first handover starts the sea chart.",
      "rec.lhBonus": "+{p}% coins from the sea chart", "rec.none": "none yet", "rec.low": "Night hours the lamp burned low",
      "rec.acts": "Things you did", "rec.sfx": "Sound effects", "rec.sea": "The sound of the sea and the wind",
      "rec.note": "The island lives on every device you use orOS on. If two devices play at the same time, the one further ahead is kept.",
      "rec.startAsk": "Start a new island? The island you have now goes, on every device.",
      "away.title": "While you were away", "away.hero": "+{n} coins",
      "away.time": "You were away", "away.days": "Days and nights on the island", "away.ships": "Ships guided",
      "away.coins": "Coins now", "away.wx": "Weather", "away.log": "From the keeper's log",
      "away.slow": "After 7 days away the island works at half pace: it never stops, it only slows.",
      "away.low": "For {n} night hours the coins for oil ran out and the lamp burned low. No ship was lost.",
      "dur.d": "{n} d", "dur.h": "{n} h", "dur.m": "{n} min",
      "tour.title": "How to play",
      "tour.1": "At night your lamp guides the ships on the sea routes it reaches, and each one pays its dues. By day the harbour, the fishing boats and the tavern earn. One hour on the island is one minute.",
      "tour.2": "The forecast at the top shows the weather of the next days. Fog, rain and storms dim the light: each defence in Buildings softens one of them, so the forecast tells you what to build first.",
      "tour.3": "The lamp burns oil, paid from your coins. If the coins run out it burns low until there are coins again. The light never goes out and no ship is ever wrecked.",
      "tour.4": "The island goes on while orOS is closed. There is nothing to miss and nothing to collect: come back when you like.",
      "tour.again": "The ? button at the top opens this again at any time.",
      "toast.up": "Built: {u}", "toast.start": "A new island", "toast.coins": "Not enough coins yet",
      "toast.sup": "Not enough supplies yet", "toast.max": "Already done", "toast.need": "Build {x} first",
      "toast.save": "Not saved: the browser's storage is full",
      "toast.hand": "The light is in good hands. A new island: {is}",
      "toast.nohand": "The light can be handed over once the lens is built and {n} ships were guided here",
      "is.home": "Home island", "is.rock": "The rock", "is.cape": "The cape", "is.outer": "The outer isle", "is.windy": "The windy isle",
      "is.home.fx": "Calm most days; some wind, rain, fog and storms.",
      "is.rock.fx": "Foggy: fog on one day in three. The fishing lanes and the caiques carry more ships.",
      "is.cape.fx": "Stormy and windy. Cargo and merchant ships pass more often.",
      "is.outer.fx": "Rainy. Merchant ships pass half again as often, the fishing lanes less.",
      "is.windy.fx": "Wind on almost half the days. Caiques and the ferry pass more often.",
      "tr.weatherwise": "Weatherwise", "tr.weatherwise.fx": "The forecast shows 5 days, and 10% more ships find their way in fog.",
      "tr.thrifty": "Thrifty", "tr.thrifty.fx": "Oil costs 20% less.",
      "tr.fisher": "Fisher's friend", "tr.fisher.fx": "The boats catch 25% more.",
      "tr.host": "Host", "tr.host.fx": "The tavern gets 20% more for its fish.",
      "tr.builder": "Builder", "tr.builder.fx": "Buildings need 10% fewer supplies.",
      "tr.owl": "Night owl", "tr.owl.fx": "15% more from every ship at night.",
      "hd.title": "Time to hand over the light",
      "hd.msg": "The lens is built and the light has guided its ships. You can hand it to your apprentice and sail to a farther island. The new light starts small: a wick, one boat, one tavern table and a few coins. This lighthouse stays on the sea chart and gives +2% coins for good, and you keep one new trait.",
      "hd.isle": "Where to", "hd.trait": "One trait for good", "hd.go": "Hand over the light", "hd.later": "Not now",
      "hd.note": "There is no hurry: the light can be handed over any time from now on. Undo takes it back for a few seconds.",
      "log.title": "Keeper's log", "log.none": "Nothing yet: the log fills when the light is on.", "log.when": "Day {d} · {h}",
      "log.calm": "{ship} «{name}» passed in calm water.",
      "log.wind": "{ship} «{name}» passed in the wind.",
      "log.rain": "{ship} «{name}» passed in the rain.",
      "log.fog": "{ship} «{name}» found its way in the fog.",
      "log.storm": "{ship} «{name}» came through the storm.",
      "ships": "Galini|Thalassa|Agia Eleni|Faneromeni|Meltemi|Glaros|Delfini|Pelagia|Kalypso|Marina|Anemoni|Aspasia|Evangelistria|Kymothoi|Nefeli|Arethousa|Agios Nikolaos|Panormitis|Elpida|Asteria|Argo|Thetis|Fotini|Ourania",
      "live.sel": "{p}. {s}"
    },
    el: {
      "app.name": "Νησί του φάρου",
      "btn.up": "Κτίρια", "btn.upKey": "Κτίρια (U)", "btn.log": "Ημερολόγιο φαροφύλακα (L)",
      "btn.help": "Πώς παίζεται (?)", "btn.stats": "Αρχείο (S)", "btn.sfxOn": "Ήχος ανοιχτός (M)", "btn.sfxOff": "Ήχος κλειστός (M)",
      "btn.close": "Κλείσιμο", "btn.ok": "Ωραία", "btn.undo": "Αναίρεση", "btn.cancel": "Άκυρο",
      "btn.start": "Από την αρχή", "btn.startYes": "Νέο νησί", "btn.hand": "Παράδοση", "btn.handKey": "Παράδοση (H)",
      "btn.fc": "Πρόγνωση (F)",
      "view.label": "Το νησί: ο φάρος, το σπίτι του φαροφύλακα, το λιμάνι, οι βάρκες και η ταβέρνα. Με τα βελάκια διαλέγεις μέρος.",
      "num.dec": ",", "num.k": " χιλ.", "num.m": " εκ.", "num.b": " δισ.", "num.t": " τρισ.",
      "st.coins": "Νομίσματα", "st.sup": "Υλικά (ξυλεία και πέτρα)", "st.fish": "Ψάρια", "st.ships": "Πλοία που καθοδηγήθηκαν σε αυτό το νησί",
      "st.rate": "+{n}/λεπτό", "st.clock": "Μέρα {d} · {h}", "st.night": "νύχτα: το φως είναι αναμμένο", "st.day": "μέρα: το λιμάνι δουλεύει",
      "st.fog": "ομίχλη: το φως ανάβει και τη μέρα",
      "wx.calm": "νηνεμία", "wx.wind": "αέρας", "wx.rain": "βροχή", "wx.fog": "ομίχλη", "wx.storm": "καταιγίδα",
      "wxn.calm": "Νηνεμία: όλα δουλεύουν κανονικά.",
      "wxn.wind": "Αέρας: οι βάρκες πιάνουν 40% λιγότερο, εκτός αν υπάρχει κυματοθραύστης.",
      "wxn.rain": "Βροχή: χωρίς προστασία από τη βροχή το φως φτάνει σε 30% λιγότερα πλοία· το λιμάνι δουλεύει 20% λιγότερο.",
      "wxn.fog": "Ομίχλη: το φως ανάβει και τη μέρα, αλλά μόνο το 40% των πλοίων βρίσκει τον δρόμο του (80% με τη σειρήνα ομίχλης).",
      "wxn.storm": "Καταιγίδα: το φως φτάνει στο 30% των πλοίων (70% με τα παντζούρια καταιγίδας), το λιμάνι δουλεύει στο μισό και οι βάρκες μένουν μέσα (στο μισό με κυματοθραύστη).",
      "q.0": "νύχτα", "q.1": "πρωί", "q.2": "απόγευμα", "q.3": "βράδυ",
      "fc.day": "Μέρα {d}", "fc.cell": "Μέρα {d}, {q}: {w}", "fc.title": "Πρόγνωση",
      "fc.note": "Ο καιρός είναι ίδιος σε κάθε συσκευή. Κάθε προστασία στα Κτίρια μαλακώνει ένα είδος καιρού.",
      "pl.light": "Φάρος", "pl.house": "Σπίτι του φαροφύλακα", "pl.harbour": "Λιμάνι", "pl.boats": "Ψαρόβαρκες", "pl.tavern": "Ταβέρνα",
      "pl.light.fx": "Η λάμπα, ο φακός και οι προστασίες από τον καιρό. Θαλάσσιοι δρόμοι: {r}.",
      "pl.house.fx": "Λάδι για τη λάμπα και ένα εργαστήρι για τους μάστορες.",
      "pl.harbour.fx": "Τα δεμένα πλοία πληρώνουν τη μέρα· τα φορτηγά φέρνουν υλικά.",
      "pl.boats.fx": "Ψαρεύουν τη μέρα· η ταβέρνα πουλά την ψαριά. Ψάρια σε αναμονή: {f}.",
      "pl.tavern.fx": "Πουλά ως {n} ψάρια την ώρα, {c} νομίσματα το καθένα.",
      "lamp.0": "Φιτίλι", "lamp.1": "Λάμπα λαδιού", "lamp.2": "Αμίαντο πλέγμα", "lamp.3": "Φακός", "lamp.4": "Μεγάλος φακός",
      "up.lamp": "Λάμπα", "up.lamp.fx": "{next}: το φως φτάνει σε έναν θαλάσσιο δρόμο ακόμα.", "up.lamp.top": "Ο μεγάλος φακός φτάνει σε όλους τους δρόμους.",
      "up.polish": "Γυάλισμα φακού", "up.polish.fx": "Το φως γίνεται 15% πιο δυνατό: κάθε πλοίο πληρώνει περισσότερα.",
      "up.rot": "Περιστροφικός μηχανισμός", "up.rot.fx": "Η δέσμη γυρίζει: 10% περισσότερα από κάθε πλοίο.", "up.rot.need": "το αμίαντο πλέγμα",
      "up.hood": "Προστασία από τη βροχή", "up.hood.fx": "Η βροχή δεν θαμπώνει πια το φως.",
      "up.horn": "Σειρήνα ομίχλης", "up.horn.fx": "Στην ομίχλη το 80% των πλοίων βρίσκει τον δρόμο του, όχι το 40%.",
      "up.shut": "Παντζούρια καταιγίδας", "up.shut.fx": "Στην καταιγίδα το φως φτάνει στο 70% των πλοίων, όχι στο 30%.",
      "up.store": "Αποθήκη λαδιού", "up.store.fx": "Το λάδι της λάμπας κοστίζει 20% λιγότερο.",
      "up.shop": "Εργαστήρι", "up.shop.fx": "Τα κτίρια θέλουν 10% λιγότερα υλικά.",
      "up.pier": "Προβλήτα", "up.pier.fx": "Χώρος για δεμένα πλοία: 3 νομίσματα κάθε ώρα της μέρας.",
      "up.ferry": "Προβλήτα του φέρι", "up.ferry.fx": "Το φέρι πιάνει λιμάνι τη μέρα: 8 νομίσματα κάθε ώρα της μέρας.", "up.ferry.need": "το αμίαντο πλέγμα και μια προβλήτα",
      "up.ware": "Αποθήκη", "up.ware.fx": "25% περισσότερα υλικά από κάθε πλοίο.",
      "up.brk": "Κυματοθραύστης", "up.brk.fx": "Οι βάρκες δουλεύουν και με αέρα, και στο μισό με καταιγίδα.",
      "up.boat": "Ψαρόβαρκα", "up.boat.fx": "Μία βάρκα ακόμα: 2 ψάρια κάθε ώρα της μέρας.",
      "up.nets": "Δίχτυα", "up.nets.fx": "Οι βάρκες πιάνουν 20% περισσότερα.",
      "up.tables": "Τραπέζι ταβέρνας", "up.tables.fx": "Η ταβέρνα πουλά 3 ψάρια ακόμα την ώρα.",
      "up.rooms": "Δωμάτια", "up.rooms.fx": "Οι ναυτικοί μένουν το βράδυ: +15% στα τέλη του λιμανιού.",
      "up.title": "Κτίρια", "up.lv": "{l}/{max}", "up.max": "Έγινε", "up.cost": "{c} νομίσματα", "up.costS": "{c} νομίσματα · {s} υλικά",
      "up.need": "Θέλει {x}",
      "up.note": "Νομίσματα ανά λεπτό τώρα: {r}. Θαλάσσιοι δρόμοι που φτάνει το φως: {n} από 5 (+{p}%). Λάδι: {o} νομίσματα την ώρα της νύχτας.",
      "rt.lanes": "ψαρότοποι", "rt.caique": "δρόμος των καϊκιών", "rt.ferry": "φέρι των νησιών", "rt.cargo": "δρόμος των φορτηγών", "rt.merchant": "μακρινός εμπορικός δρόμος",
      "rts.lanes": "Η ψαρόβαρκα", "rts.caique": "Το καΐκι", "rts.ferry": "Το φέρι", "rts.cargo": "Το φορτηγό", "rts.merchant": "Το εμπορικό",
      "pn.hint": "Πάτα ένα μέρος του νησιού για να χτίσεις εκεί: τον φάρο, το σπίτι του φαροφύλακα, το λιμάνι, τις βάρκες ή την ταβέρνα. Η πρόγνωση επάνω δείχνει τον καιρό που έρχεται.",
      "pn.ships": "Πλοία εδώ: {n} από {k}. Ο φακός και {k} πλοία ανοίγουν την παράδοση.",
      "pn.shipsLens": "Πλοία εδώ: {n} από {k}. Χτίσε τον φακό για να ανοίξει η παράδοση.",
      "pn.low": "Τα νομίσματα για το λάδι τελείωσαν, οπότε η λάμπα καίει χαμηλά ώσπου να υπάρξουν πάλι. Δεν χάνεται κανένα πλοίο.",
      "pn.adv": "{w} {when}. {fx}",
      "pn.when.now": "τώρα", "pn.when.h": "σε {n} ώρες",
      "pn.adv.fog": "Η σειρήνα ομίχλης θα κρατούσε το 80% των πλοίων στον δρόμο τους.",
      "pn.adv.storm": "Τα παντζούρια καταιγίδας θα κρατούσαν το 70% των πλοίων στον δρόμο τους.",
      "pn.adv.rain": "Η προστασία από τη βροχή θα κρατούσε το φως καθαρό.",
      "pn.adv.wind": "Ένας κυματοθραύστης θα κρατούσε τις βάρκες στη δουλειά.",
      "pn.hand": "Ο φάρος είναι έτοιμος για παράδοση: άνοιξε την Παράδοση για να δεις την επιλογή. Δεν βιάζεσαι.",
      "rec.title": "Αρχείο", "rec.day": "Μέρα", "rec.life": "Νομίσματα συνολικά", "rec.ships": "Πλοία συνολικά",
      "rec.here": "Πλοία σε αυτό το νησί", "rec.isle": "Νησί", "rec.lights": "Φάροι που κράτησες", "rec.traits": "Χαρακτηριστικά",
      "rec.chart": "Ναυτικός χάρτης", "rec.lhItem": "Φάρος {n} · {is} · {d} μέρες · {sh} πλοία",
      "rec.lhNone": "Δεν υπάρχουν ακόμα παλιοί φάροι: η πρώτη παράδοση ξεκινά τον ναυτικό χάρτη.",
      "rec.lhBonus": "+{p}% νομίσματα από τον ναυτικό χάρτη", "rec.none": "κανένα ακόμα", "rec.low": "Ώρες νύχτας με τη λάμπα χαμηλά",
      "rec.acts": "Κινήσεις σου", "rec.sfx": "Ήχοι", "rec.sea": "Ο ήχος της θάλασσας και του αέρα",
      "rec.note": "Το νησί είναι ίδιο σε κάθε συσκευή όπου χρησιμοποιείς το orOS. Αν παίξουν δύο συσκευές ταυτόχρονα, κρατιέται αυτή που έχει προχωρήσει περισσότερο.",
      "rec.startAsk": "Να ξεκινήσει νέο νησί; Το τωρινό χάνεται σε όλες τις συσκευές.",
      "away.title": "Όσο έλειπες", "away.hero": "+{n} νομίσματα",
      "away.time": "Έλειπες", "away.days": "Μέρες και νύχτες στο νησί", "away.ships": "Πλοία που καθοδηγήθηκαν",
      "away.coins": "Νομίσματα τώρα", "away.wx": "Καιρός", "away.log": "Από το ημερολόγιο του φαροφύλακα",
      "away.slow": "Μετά από 7 μέρες απουσίας το νησί δουλεύει με μισή ταχύτητα: δεν σταματά ποτέ, απλώς πάει πιο αργά.",
      "away.low": "Για {n} ώρες της νύχτας τα νομίσματα για το λάδι τελείωσαν και η λάμπα έκαιγε χαμηλά. Δεν χάθηκε κανένα πλοίο.",
      "dur.d": "{n} μ.", "dur.h": "{n} ώ.", "dur.m": "{n} λεπ.",
      "tour.title": "Πώς παίζεται",
      "tour.1": "Τη νύχτα η λάμπα σου καθοδηγεί τα πλοία στους θαλάσσιους δρόμους που φτάνει, και καθένα πληρώνει τα τέλη του. Τη μέρα κερδίζουν το λιμάνι, οι ψαρόβαρκες και η ταβέρνα. Μία ώρα στο νησί κρατά ένα λεπτό.",
      "tour.2": "Η πρόγνωση επάνω δείχνει τον καιρό των επόμενων ημερών. Η ομίχλη, η βροχή και οι καταιγίδες θαμπώνουν το φως: κάθε προστασία στα Κτίρια μαλακώνει μία από αυτές, οπότε η πρόγνωση σου λέει τι να χτίσεις πρώτα.",
      "tour.3": "Η λάμπα καίει λάδι, που πληρώνεται από τα νομίσματά σου. Αν τελειώσουν, καίει χαμηλά ώσπου να υπάρξουν πάλι. Το φως δεν σβήνει ποτέ και κανένα πλοίο δεν ναυαγεί.",
      "tour.4": "Το νησί συνεχίζει και όταν το orOS είναι κλειστό. Δεν χάνεις τίποτα και δεν έχεις τίποτα να μαζέψεις: έλα όποτε θέλεις.",
      "tour.again": "Το κουμπί ? πάνω το ξανανοίγει όποτε θέλεις.",
      "toast.up": "Χτίστηκε: {u}", "toast.start": "Νέο νησί", "toast.coins": "Δεν φτάνουν ακόμα τα νομίσματα",
      "toast.sup": "Δεν φτάνουν ακόμα τα υλικά", "toast.max": "Έχει ήδη γίνει", "toast.need": "Χρειάζεται πρώτα {x}",
      "toast.save": "Δεν αποθηκεύτηκε: ο χώρος του προγράμματος περιήγησης γέμισε",
      "toast.hand": "Ο φάρος είναι σε καλά χέρια. Νέο νησί: {is}",
      "toast.nohand": "Ο φάρος παραδίδεται όταν χτιστεί ο φακός και καθοδηγηθούν εδώ {n} πλοία",
      "is.home": "Το νησί του σπιτιού", "is.rock": "Ο βράχος", "is.cape": "Ο κάβος", "is.outer": "Το ανοιχτό νησί", "is.windy": "Το ανεμόνησο",
      "is.home.fx": "Ήρεμο τις περισσότερες μέρες· λίγος αέρας, βροχή, ομίχλη και καταιγίδες.",
      "is.rock.fx": "Ομιχλώδες: ομίχλη μία μέρα στις τρεις. Οι ψαρότοποι και τα καΐκια φέρνουν περισσότερα πλοία.",
      "is.cape.fx": "Με καταιγίδες και αέρα. Φορτηγά και εμπορικά περνούν πιο συχνά.",
      "is.outer.fx": "Βροχερό. Τα εμπορικά περνούν μιάμιση φορά πιο συχνά, οι ψαρότοποι λιγότερο.",
      "is.windy.fx": "Αέρας σχεδόν τις μισές μέρες. Τα καΐκια και το φέρι περνούν πιο συχνά.",
      "tr.weatherwise": "Καιρογνώστης", "tr.weatherwise.fx": "Η πρόγνωση δείχνει 5 μέρες, και 10% περισσότερα πλοία βρίσκουν τον δρόμο τους στην ομίχλη.",
      "tr.thrifty": "Οικονόμος", "tr.thrifty.fx": "Το λάδι κοστίζει 20% λιγότερο.",
      "tr.fisher": "Φίλος των ψαράδων", "tr.fisher.fx": "Οι βάρκες πιάνουν 25% περισσότερα.",
      "tr.host": "Καλός οικοδεσπότης", "tr.host.fx": "Η ταβέρνα παίρνει 20% περισσότερα για τα ψάρια της.",
      "tr.builder": "Μάστορας", "tr.builder.fx": "Τα κτίρια θέλουν 10% λιγότερα υλικά.",
      "tr.owl": "Νυχτοπούλι", "tr.owl.fx": "15% περισσότερα από κάθε πλοίο τη νύχτα.",
      "hd.title": "Ώρα να παραδώσεις τον φάρο",
      "hd.msg": "Ο φακός χτίστηκε και το φως καθοδήγησε τα πλοία του. Μπορείς να τον παραδώσεις στον μαθητευόμενό σου και να ταξιδέψεις σε ένα πιο μακρινό νησί. Ο νέος φάρος ξεκινά μικρός: ένα φιτίλι, μία βάρκα, ένα τραπέζι στην ταβέρνα και λίγα νομίσματα. Αυτός ο φάρος μένει στον ναυτικό χάρτη και δίνει για πάντα +2% νομίσματα, και κρατάς ένα νέο χαρακτηριστικό.",
      "hd.isle": "Πού θα πας", "hd.trait": "Ένα χαρακτηριστικό για πάντα", "hd.go": "Παράδωσε τον φάρο", "hd.later": "Όχι τώρα",
      "hd.note": "Δεν βιάζεσαι: ο φάρος μπορεί να παραδοθεί όποτε θέλεις από εδώ και πέρα. Η Αναίρεση την παίρνει πίσω για λίγα δευτερόλεπτα.",
      "log.title": "Ημερολόγιο φαροφύλακα", "log.none": "Τίποτα ακόμα: το ημερολόγιο γεμίζει όταν ανάβει το φως.", "log.when": "Μέρα {d} · {h}",
      "log.calm": "{ship} «{name}» πέρασε με ήσυχη θάλασσα.",
      "log.wind": "{ship} «{name}» πέρασε μέσα στον αέρα.",
      "log.rain": "{ship} «{name}» πέρασε μέσα στη βροχή.",
      "log.fog": "{ship} «{name}» βρήκε τον δρόμο μέσα στην ομίχλη.",
      "log.storm": "{ship} «{name}» πέρασε μέσα από την καταιγίδα.",
      "ships": "Γαλήνη|Θάλασσα|Αγία Ελένη|Φανερωμένη|Μελτέμι|Γλάρος|Δελφίνι|Πελαγία|Καλυψώ|Μαρίνα|Ανεμώνη|Ασπασία|Ευαγγελίστρια|Κυμοθόη|Νεφέλη|Αρέθουσα|Άγιος Νικόλαος|Πανορμίτης|Ελπίδα|Αστερία|Αργώ|Θέτις|Φωτεινή|Ουρανία",
      "live.sel": "{p}. {s}"
    }
  };
  if (window.orosI18n) window.orosI18n.table(STRINGS, "lighthouse", LANG);

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
  function fmtDur(ms) {
    var m = Math.floor(ms / 60000), d = Math.floor(m / 1440), h = Math.floor((m % 1440) / 60);
    if (d > 0) return t("dur.d", { n: d }) + (h ? " " + t("dur.h", { n: h }) : "");
    if (h > 0) return t("dur.h", { n: h }) + (m % 60 ? " " + t("dur.m", { n: m % 60 }) : "");
    return t("dur.m", { n: m });
  }
  function hh(h) { return (h < 10 ? "0" : "") + h + ":00"; }
  function shipName(i) { var l = t("ships").split("|"); return l[i % l.length] || ""; }
  function upName(uid) { return t("up." + uid); }
  function upsOf(place) { return E.UPGRADES.filter(function (u) { return u.at === place; }); }

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
    console.log("lighthouse.js v" + (SCRIPT_V || "?") + " boot");
  })();

  // ---------- 2. Saves ----------
  // saved = the island as last written (what syncs); live = the same
  // island brought to the clock now. live = saved stepped by the time
  // since saved.at, so nothing is lost when only saved is kept.
  var saved = null, stored = false, live = null;
  var prefs = { seen: 0, seenLife: 0, seenHr: 0, seenShips: 0, seenLow: 0, tour: 0 };
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
    prefs.seen = nowMs(); prefs.seenLife = live.life; prefs.seenHr = live.hr;
    prefs.seenShips = live.ships; prefs.seenLow = live.low;
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
      seenNow();
      savePrefs();
    }
  }

  // ---------- 3. Clock + tick ----------
  var clockOff = 0;                     // advanceTime() moves the clock (tests)
  function nowMs() { return Date.now() + clockOff; }
  var lastPanelKey = "";
  function tick() {
    if (!live) return;
    E.catchUp(live, nowMs());
    renderStatus();
    renderFc();
    refreshPanel();
    refreshDialog();
    updateSea();
    if (reduced || document.hidden) draw();
  }

  // ---------- 4. Actions ----------
  function doAct(a, okToast) {
    E.catchUp(live, nowMs());
    if (pending) commitNow();          // the previous purchase is written first
    var snap = E.clone(live);
    var err = E.act(live, a);
    if (err) {
      var x = a.u && E.UP[a.u] && E.UP[a.u].need ? t("up." + a.u + ".need") : "";
      showToast(t("toast." + (err === "bad" ? "coins" : err), { n: fmt(E.handShips(live)), x: x }));
      sfx("no");
      return false;
    }
    undo = { snap: snap, kind: a.t };
    commitSoon();
    sfx(a.t === "up" ? "up" : "hand");
    showToast(okToast, true);
    renderAll(true);
    return true;
  }
  function build(uid) { return doAct({ t: "up", u: uid }, t("toast.up", { u: upName(uid) })); }
  function undoLast() {
    if (!undo) return;
    var u = undo;
    undo = null;
    // a purchase is not written yet: dropping it is enough
    if (pending) { clearTimeout(pending.timer); pending = null; }
    live = u.snap;
    E.catchUp(live, nowMs());
    hideToast();
    sfx("undo");
    renderAll(true);
  }
  // Start over: a new island with a new reset stamp (it wins on every
  // device, so the old island cannot come back from the cloud). No Undo:
  // the question before it is the safeguard, and an Undo in the toast
  // sat over the toolbar, where the next tap brought the old island back.
  function startOver() {
    if (pending) commitNow();
    E.catchUp(live, nowMs());
    var br = Math.max(nowMs(), saved.br + 1);
    live = E.newGame(newSeed(), nowMs(), br);
    undo = null;
    hideToast();
    saved = E.normalize(live);
    if (writeSaved()) dirtySoon();
    seenNow();
    savePrefs();
    sel = "";
    closeDialog();
    showToast(t("toast.start"));
    renderAll(true);
  }

  // ---------- 5. Scene ----------
  var canvas, ctx, dpr = 1, W = 0, H = 0;
  var sel = "";                         // the chosen place, "" none
  var reduced = false;
  var C = {};
  var BOX = {};                         // place → { x, y, w, h } hit boxes
  var shipHits = [];                    // [{ x, y, route, name }] the ships drawn last
  // Island colours by island: sand, rock, grass.
  var ISLE_COL = {
    home:  ["#c9b48a", "#8c7a5c", "#6f8f4e"], rock:  ["#9c978c", "#6d6a63", "#6a7f58"],
    cape:  ["#b9a27a", "#7f6a4f", "#7d8f4a"], outer: ["#cdbb94", "#8a7d63", "#5f8c5a"],
    windy: ["#c2b089", "#857456", "#8f9a5a"]
  };
  // Sky colour by the hour of day (fractional): [hour, top, bottom].
  var SKY = [
    [0, "#060b1a", "#101a33"], [5, "#0b1430", "#1c2547"], [6.2, "#40508a", "#e7a77a"],
    [8, "#5f9ed6", "#a9d0ec"], [17, "#6aa6d9", "#b5d6ee"], [19.2, "#3e4f8f", "#e58b5e"],
    [20.5, "#0f1838", "#24305a"], [24, "#060b1a", "#101a33"]
  ];
  function hex2rgb(h) { var n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
  function mix(a, b, k) {
    var x = hex2rgb(a), y = hex2rgb(b);
    return "rgb(" + Math.round(x[0] + (y[0] - x[0]) * k) + "," + Math.round(x[1] + (y[1] - x[1]) * k) + "," + Math.round(x[2] + (y[2] - x[2]) * k) + ")";
  }
  function skyAt(h) {
    for (var i = 1; i < SKY.length; i++) {
      if (h <= SKY[i][0]) {
        var a = SKY[i - 1], b = SKY[i], k = (h - a[0]) / (b[0] - a[0]);
        return [mix(a[1], b[1], k), mix(a[2], b[2], k)];
      }
    }
    return [SKY[0][1], SKY[0][2]];
  }
  // How dark it is (0 day, 1 night) at a fractional hour.
  function darkAt(h) {
    if (h >= 7.5 && h <= 18) return 0;
    if (h >= 20.5 || h <= 5) return 1;
    if (h < 7.5) return 1 - (h - 5) / 2.5;
    return (h - 18) / 2.5;
  }

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
  // The island and its places, sized to the canvas.
  var G = {};
  function layout() {
    var u = Math.min(W / 10, H / 6.2);           // one unit of the island
    G.u = u;
    G.hz = H * 0.42;                               // the horizon
    G.ix = W * 0.36; G.iy = H * 0.86;              // the island's middle, at the waterline
    G.iw = Math.min(W * 0.34, u * 3.6);            // half its width
    G.ih = u * 0.95;                               // its height
    var top = G.iy - G.ih;
    G.tx = G.ix - G.iw * 0.45;                     // the tower
    G.tw = u * 0.34;
    BOX.light = { x: G.tx - u * 0.45, y: top - u * 3.1, w: u * 0.9, h: u * 3.4 };
    BOX.house = { x: G.ix - u * 0.25, y: top - u * 0.15, w: u * 0.95, h: u * 0.85 };
    BOX.tavern = { x: G.ix + G.iw * 0.42 - u * 0.35, y: G.iy - G.ih * 0.55 - u * 0.55, w: u * 1.05, h: u * 0.95 };
    BOX.harbour = { x: G.ix + G.iw * 0.85, y: G.iy - u * 0.5, w: Math.min(W - (G.ix + G.iw * 0.85) - 4, u * 2.6), h: u * 0.9 };
    BOX.boats = { x: G.ix + G.iw * 0.9, y: G.iy + u * 0.1, w: Math.min(W - (G.ix + G.iw * 0.9) - 4, u * 3.2), h: Math.max(u * 0.75, H - G.iy - u * 0.15) };
  }
  function draw(time) {
    if (!ctx || !live) return;
    time = time || 0;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    var h = E.hourOf(live.hr) + live.ms / E.STEP_MS;
    var w = E.weather(live), dark = darkAt(h);
    var sky = skyAt(h);
    var grd = ctx.createLinearGradient(0, 0, 0, G.hz);
    grd.addColorStop(0, sky[0]); grd.addColorStop(1, sky[1]);
    ctx.fillStyle = grd;
    ctx.fillRect(0, 0, W, G.hz + 1);
    if (dark > 0.3 && w !== "fog" && w !== "storm") drawStars(dark);
    if (dark < 0.7 && (w === "calm" || w === "wind")) drawSun(h, 1 - dark);
    // the sea
    var sea = ctx.createLinearGradient(0, G.hz, 0, H);
    sea.addColorStop(0, mix("#3a7fae", "#10263f", dark));
    sea.addColorStop(1, mix("#1d5579", "#071423", dark));
    ctx.fillStyle = sea;
    ctx.fillRect(0, G.hz, W, H - G.hz);
    drawLanes(time, dark, w);
    drawIsland(dark);
    drawTower(time, dark, w);
    drawHouse(dark); drawTavern(dark); drawHarbour(dark); drawBoats(time, dark, w, h);
    drawWeather(time, w);
    if (sel && BOX[sel]) {
      var b = BOX[sel];
      ctx.lineWidth = 2.5; ctx.strokeStyle = C.accent || "#e2b54a";
      ctx.setLineDash([5, 4]);
      roundRect(b.x - 3, b.y - 3, b.w + 6, b.h + 6, 8); ctx.stroke();
      ctx.setLineDash([]);
    }
  }
  function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y); ctx.lineTo(x + w - r, y); ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r); ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h); ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r); ctx.quadraticCurveTo(x, y, x + r, y); ctx.closePath();
  }
  function drawStars(dark) {
    ctx.fillStyle = "rgba(255,255,240," + (0.75 * dark) + ")";
    for (var i = 0; i < 40; i++) {
      var x = E.rand01("sx" + i) * W, y = E.rand01("sy" + i) * G.hz * 0.92;
      ctx.fillRect(x, y, 1.4, 1.4);
    }
  }
  function drawSun(h, a) {
    var k = Math.max(0, Math.min(1, (h - 6) / 13));
    var x = W * (0.1 + 0.8 * k), y = G.hz - Math.sin(k * Math.PI) * G.hz * 0.75 + 6;
    ctx.globalAlpha = a;
    ctx.fillStyle = "#ffe59a";
    ctx.beginPath(); ctx.arc(x, y, Math.max(6, G.u * 0.28), 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha = 1;
  }
  // Sea lanes: the routes the light reaches, the farthest at the horizon.
  // Ships cross on them; at night they carry a small light.
  function laneY(i) { var span = H - G.hz; return G.hz + span * (0.06 + 0.11 * (4 - i)); }
  function drawLanes(time, dark, w) {
    shipHits = [];
    var r = E.range(live);
    E.ROUTES.forEach(function (rt, i) {
      if (rt.r > r) return;
      var y = laneY(i), scale = 0.55 + 0.12 * (4 - i);
      var n = Math.max(1, Math.min(4, Math.round(rt.n * 1.2)));
      for (var k = 0; k < n; k++) {
        var period = 90000 + i * 25000, ph = reduced ? (k + 0.5) / n : ((time / period) + k / n + i * 0.37) % 1;
        var dir = i % 2 ? -1 : 1;
        var x = dir > 0 ? -30 + ph * (W + 60) : W + 30 - ph * (W + 60);
        if (x > G.ix - G.iw * 1.05 && x < G.ix + G.iw * 1.05 && y > G.iy - G.ih * 1.4) continue;   // behind the island
        drawShip(x, y, scale * G.u, dir, rt.id, dark);
        var idx = Math.floor(E.rand01(live.seed + "|ship|" + i + "|" + k) * E.SHIP_NAMES);
        shipHits.push({ x: x, y: y - scale * G.u * 0.3, r: Math.max(16, scale * G.u * 0.7), route: rt.id, name: idx });
      }
    });
  }
  function drawShip(x, y, s, dir, kind, dark) {
    var len = s * (kind === "merchant" || kind === "cargo" ? 1.3 : kind === "ferry" ? 1.1 : 0.7);
    ctx.fillStyle = mix("#2b2f38", "#0a0d14", dark);
    ctx.beginPath();
    ctx.moveTo(x - len / 2, y - s * 0.12); ctx.lineTo(x + len / 2, y - s * 0.12);
    ctx.lineTo(x + len / 2 - s * 0.12 * dir, y + s * 0.08); ctx.lineTo(x - len / 2 + s * 0.08 * dir, y + s * 0.08);
    ctx.closePath(); ctx.fill();
    if (kind === "lanes" || kind === "caique") {
      ctx.strokeStyle = ctx.fillStyle; ctx.lineWidth = Math.max(1, s * 0.05);
      ctx.beginPath(); ctx.moveTo(x, y - s * 0.12); ctx.lineTo(x, y - s * 0.6); ctx.stroke();
      ctx.fillStyle = mix("#f4efe2", "#5d6170", dark);
      ctx.beginPath(); ctx.moveTo(x, y - s * 0.58); ctx.lineTo(x + s * 0.3 * dir, y - s * 0.18); ctx.lineTo(x, y - s * 0.18); ctx.closePath(); ctx.fill();
    } else {
      ctx.fillStyle = mix("#e9e4d6", "#3c4150", dark);
      ctx.fillRect(x - len * 0.2, y - s * 0.36, len * 0.4, s * 0.24);
    }
    if (dark > 0.4) {
      ctx.fillStyle = "rgba(255,226,140," + dark + ")";
      ctx.fillRect(x + len * 0.35 * dir - 1, y - s * 0.3, 2.5, 2.5);
    }
  }
  function drawIsland(dark) {
    var col = ISLE_COL[live.is] || ISLE_COL.home;
    ctx.fillStyle = mix(col[1], "#1b1d22", dark * 0.75);
    ctx.beginPath();
    ctx.moveTo(G.ix - G.iw * 1.05, G.iy + 2);
    ctx.bezierCurveTo(G.ix - G.iw * 0.85, G.iy - G.ih * 1.15, G.ix + G.iw * 0.5, G.iy - G.ih * 1.05, G.ix + G.iw, G.iy + 2);
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = mix(col[2], "#14201a", dark * 0.75);
    ctx.beginPath();
    ctx.moveTo(G.ix - G.iw * 0.8, G.iy - G.ih * 0.55);
    ctx.bezierCurveTo(G.ix - G.iw * 0.6, G.iy - G.ih * 1.05, G.ix + G.iw * 0.3, G.iy - G.ih * 1.0, G.ix + G.iw * 0.7, G.iy - G.ih * 0.4);
    ctx.lineTo(G.ix + G.iw * 0.6, G.iy - G.ih * 0.3);
    ctx.bezierCurveTo(G.ix + G.iw * 0.2, G.iy - G.ih * 0.75, G.ix - G.iw * 0.5, G.iy - G.ih * 0.8, G.ix - G.iw * 0.7, G.iy - G.ih * 0.4);
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = mix(col[0], "#2a2720", dark * 0.75);
    ctx.fillRect(G.ix - G.iw * 1.05, G.iy - 2, G.iw * 2.05, 5);
  }
  // The tower: taller with every lamp; the beam sweeps when the light is on.
  function drawTower(time, dark, w) {
    var u = G.u, lv = live.lv.lamp;
    var base = G.iy - G.ih * 0.82, top = base - u * (2.0 + 0.2 * lv);
    var bw = G.tw * 1.25, tw = G.tw * 0.85;
    ctx.fillStyle = mix("#f2efe6", "#6f7380", dark * 0.8);
    ctx.beginPath(); ctx.moveTo(G.tx - bw / 2, base); ctx.lineTo(G.tx + bw / 2, base); ctx.lineTo(G.tx + tw / 2, top); ctx.lineTo(G.tx - tw / 2, top); ctx.closePath(); ctx.fill();
    // bands (one more for each lamp)
    ctx.fillStyle = mix("#b8433b", "#4a2324", dark * 0.8);
    for (var b = 0; b < 2; b++) {
      var y0 = base - (base - top) * (0.25 + 0.35 * b), y1 = y0 - (base - top) * 0.12;
      var k0 = (base - y0) / (base - top), k1 = (base - y1) / (base - top);
      var w0 = bw + (tw - bw) * k0, w1 = bw + (tw - bw) * k1;
      ctx.beginPath(); ctx.moveTo(G.tx - w0 / 2, y0); ctx.lineTo(G.tx + w0 / 2, y0); ctx.lineTo(G.tx + w1 / 2, y1); ctx.lineTo(G.tx - w1 / 2, y1); ctx.closePath(); ctx.fill();
    }
    // the lamp room
    var lr = u * 0.28;
    ctx.fillStyle = mix("#30343d", "#14161b", dark);
    ctx.fillRect(G.tx - tw * 0.7, top - lr * 1.5, tw * 1.4, lr * 1.5);
    ctx.beginPath(); ctx.moveTo(G.tx - tw * 0.8, top - lr * 1.5); ctx.lineTo(G.tx, top - lr * 2.3); ctx.lineTo(G.tx + tw * 0.8, top - lr * 1.5); ctx.closePath(); ctx.fill();
    var on = E.lightWorks(live, live.hr, w), low = on && live.coins < E.oilCost(live);
    var lx = G.tx, ly = top - lr * 0.75;
    if (on) {
      var glow = ctx.createRadialGradient(lx, ly, 0, lx, ly, u * (0.9 + 0.15 * lv) * (low ? 0.5 : 1));
      glow.addColorStop(0, "rgba(255,236,160,0.95)"); glow.addColorStop(1, "rgba(255,236,160,0)");
      ctx.fillStyle = glow;
      ctx.beginPath(); ctx.arc(lx, ly, u * (0.9 + 0.15 * lv), 0, Math.PI * 2); ctx.fill();
      // the beam: a wedge whose length follows the sweep (seen from the side)
      var ang = reduced ? 0.6 : (time / (live.lv.rot ? 3200 : 4800)) % (Math.PI * 2);
      var reach = W * (0.35 + 0.1 * lv) * (low ? 0.5 : 1);
      var c = Math.cos(ang), len = reach * Math.abs(c), dir = c >= 0 ? 1 : -1, spread = u * (0.12 + 0.18 * (1 - Math.abs(c)));
      var bg = ctx.createLinearGradient(lx, ly, lx + dir * len, ly);
      bg.addColorStop(0, "rgba(255,240,180," + (0.55 * Math.max(dark, w === "fog" ? 0.6 : 0)) + ")");
      bg.addColorStop(1, "rgba(255,240,180,0)");
      ctx.fillStyle = bg;
      ctx.beginPath(); ctx.moveTo(lx, ly - 2); ctx.lineTo(lx + dir * len, ly - spread); ctx.lineTo(lx + dir * len, ly + spread); ctx.lineTo(lx, ly + 2); ctx.closePath(); ctx.fill();
    }
    ctx.fillStyle = on ? "#fff2b8" : mix("#c9c3a8", "#555", dark);
    ctx.beginPath(); ctx.arc(lx, ly, lr * 0.45, 0, Math.PI * 2); ctx.fill();
  }
  function house(x, y, w, h, roof, wall, lit) {
    ctx.fillStyle = wall;
    ctx.fillRect(x, y - h, w, h);
    ctx.fillStyle = roof;
    ctx.beginPath(); ctx.moveTo(x - w * 0.08, y - h); ctx.lineTo(x + w / 2, y - h * 1.55); ctx.lineTo(x + w * 1.08, y - h); ctx.closePath(); ctx.fill();
    ctx.fillStyle = lit ? "#ffd970" : "rgba(40,50,70,0.8)";
    ctx.fillRect(x + w * 0.2, y - h * 0.65, w * 0.2, h * 0.3);
    ctx.fillRect(x + w * 0.6, y - h * 0.65, w * 0.2, h * 0.3);
  }
  function drawHouse(dark) {
    var b = BOX.house, u = G.u, lit = dark > 0.4;
    house(b.x + u * 0.1, b.y + b.h, u * 0.7, u * 0.45, mix("#9a5a3a", "#3b2a22", dark), mix("#f1ece0", "#5c5f68", dark), lit);
    if (live.lv.store) { ctx.fillStyle = mix("#8f8a7c", "#3a3a3a", dark); ctx.fillRect(b.x - u * 0.1, b.y + b.h - u * 0.3, u * 0.22, u * 0.3); }
    if (live.lv.shop) { ctx.fillStyle = mix("#a9876a", "#3a3028", dark); ctx.fillRect(b.x + u * 0.82, b.y + b.h - u * 0.28, u * 0.3, u * 0.28); }
  }
  function drawTavern(dark) {
    var b = BOX.tavern, u = G.u, lit = dark > 0.3;
    house(b.x + u * 0.1, b.y + b.h, u * 0.85, u * 0.5 + u * 0.04 * live.lv.rooms, mix("#3d6fa0", "#1c2a3a", dark), mix("#f6f1e4", "#5d6069", dark), lit);
    ctx.fillStyle = mix("#7a5a3a", "#2a2018", dark);
    var n = Math.min(6, live.lv.tables);
    for (var i = 0; i < n; i++) ctx.fillRect(b.x + u * 0.05 + i * u * 0.16, b.y + b.h + 1, u * 0.1, u * 0.08);
  }
  function drawHarbour(dark) {
    var u = G.u, x0 = G.ix + G.iw * 0.82, y = G.iy - u * 0.05;
    var len = Math.min(BOX.harbour.w, u * (0.5 + 0.2 * live.lv.pier));
    ctx.fillStyle = mix("#8a6a48", "#2c241c", dark);
    if (live.lv.pier) {
      ctx.fillRect(x0, y - u * 0.08, len, u * 0.1);
      for (var p = 0; p < live.lv.pier && p < 10; p++) ctx.fillRect(x0 + (p + 0.5) * len / Math.max(1, live.lv.pier), y, 2, u * 0.25);
    }
    if (live.lv.ferry) { ctx.fillRect(x0 + len * 0.2, y - u * 0.42, len * 0.8, u * 0.08); }
    if (live.lv.ware) {
      ctx.fillStyle = mix("#c0a070", "#3a3226", dark);
      ctx.fillRect(x0 - u * 0.15, y - u * 0.42 - u * 0.04 * live.lv.ware, u * 0.36, u * 0.34 + u * 0.04 * live.lv.ware);
    }
    if (live.lv.brk) {
      ctx.strokeStyle = mix("#9a958a", "#3a3a3a", dark); ctx.lineWidth = Math.max(3, u * 0.12);
      ctx.lineCap = "round";
      ctx.beginPath(); ctx.moveTo(x0 + len + u * 0.2, y - u * 0.05);
      ctx.quadraticCurveTo(x0 + len + u * 0.45, y + u * 0.45, x0 + len * 0.55, y + u * 0.62); ctx.stroke();
      ctx.lineCap = "butt";
    }
  }
  // Boats: out at sea by day (when the weather lets them), home at night.
  function drawBoats(time, dark, w, h) {
    var u = G.u, n = Math.min(8, live.lv.boat), out = !E.isNight(live.hr) && E.boatF(live, w) > 0;
    var b = BOX.boats;
    for (var i = 0; i < n; i++) {
      var x, y;
      if (out) {
        var ph = reduced ? 0 : Math.sin(time / 1800 + i * 1.7) * 0.03;
        x = b.x + b.w * (0.15 + 0.8 * ((i * 0.37 + 0.1) % 1)) + ph * b.w;
        y = b.y + b.h * (0.3 + 0.6 * ((i * 0.61) % 1));
      } else {
        x = G.ix + G.iw * 0.9 + (i % 4) * u * 0.32;
        y = G.iy + u * 0.12 + Math.floor(i / 4) * u * 0.18;
      }
      ctx.fillStyle = mix(i % 2 ? "#2f6fa8" : "#c8463e", "#20242c", dark * 0.8);
      ctx.beginPath();
      ctx.moveTo(x - u * 0.14, y - u * 0.04); ctx.lineTo(x + u * 0.14, y - u * 0.04); ctx.lineTo(x + u * 0.1, y + u * 0.04); ctx.lineTo(x - u * 0.1, y + u * 0.04);
      ctx.closePath(); ctx.fill();
    }
  }
  function drawWeather(time, w) {
    if (w === "fog") {
      ctx.fillStyle = "rgba(200,205,210,0.42)";
      ctx.fillRect(0, 0, W, H);
    } else if (w === "rain" || w === "storm") {
      if (w === "storm") { ctx.fillStyle = "rgba(10,12,20,0.30)"; ctx.fillRect(0, 0, W, H); }
      ctx.strokeStyle = "rgba(190,210,235,0.45)"; ctx.lineWidth = 1;
      var n = w === "storm" ? 90 : 50, off = reduced ? 0 : (time / 6) % 40;
      ctx.beginPath();
      for (var i = 0; i < n; i++) {
        var x = (E.rand01("rx" + i) * (W + 40) + off * 0.4) % (W + 40) - 20, y = (E.rand01("ry" + i) * H + off * 3) % H;
        ctx.moveTo(x, y); ctx.lineTo(x - 4, y + 10);
      }
      ctx.stroke();
    }
    if (w === "wind" || w === "storm") {
      ctx.strokeStyle = "rgba(240,248,255,0.55)"; ctx.lineWidth = 1.2;
      ctx.beginPath();
      for (var k = 0; k < 18; k++) {
        var cx = (E.rand01("wx" + k) * W + (reduced ? 0 : time / 40)) % W, cy = G.hz + E.rand01("wy" + k) * (H - G.hz);
        ctx.moveTo(cx, cy); ctx.lineTo(cx + 7, cy - 2);
      }
      ctx.stroke();
    }
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
  function placeAt(x, y) {
    for (var i = 0; i < E.PLACES.length; i++) {
      var b = BOX[E.PLACES[i]];
      if (b && x >= b.x - 6 && x <= b.x + b.w + 6 && y >= b.y - 6 && y <= b.y + b.h + 6) return E.PLACES[i];
    }
    return "";
  }
  function shipAt(x, y) {
    for (var i = 0; i < shipHits.length; i++) {
      var s = shipHits[i];
      if (Math.abs(x - s.x) < s.r && Math.abs(y - s.y) < s.r * 0.8) return s;
    }
    return null;
  }
  function choose(p) {
    sel = p;
    renderPanel();
    draw();
    if (p) live_(t("live.sel", { p: t("pl." + p), s: placeFx(p) }));
  }
  function wireInput() {
    canvas.addEventListener("pointerdown", function (ev) {
      var r = canvas.getBoundingClientRect(), x = ev.clientX - r.left, y = ev.clientY - r.top;
      var p = placeAt(x, y);
      if (p) { choose(p === sel ? "" : p); return; }
      var s = shipAt(x, y);
      if (s) { showToast(t("rts." + s.route) + " «" + shipName(s.name) + "»"); return; }
      choose("");
    });
    canvas.addEventListener("keydown", function (ev) {
      var n = E.PLACES.length, i = E.PLACES.indexOf(sel);
      if (ev.key === "ArrowRight" || ev.key === "ArrowDown") { choose(E.PLACES[(i + 1) % n]); ev.preventDefault(); }
      else if (ev.key === "ArrowLeft" || ev.key === "ArrowUp") { choose(E.PLACES[i < 0 ? n - 1 : (i - 1 + n) % n]); ev.preventDefault(); }
      else if (ev.key === "Enter" && sel) {
        var b = $("panel").querySelector("button:not([disabled])");
        if (b) b.focus();
        ev.preventDefault();
      } else if (ev.key === "Escape" && sel) { choose(""); ev.preventDefault(); }
    });
  }
  function wireKeyboard() {
    document.addEventListener("keydown", function (ev) {
      if (ev.ctrlKey || ev.altKey || ev.metaKey) return;
      if ($("dlg").open) return;
      var k = ev.key.toLowerCase();
      var list = sel ? upsOf(sel) : [];
      if (/^[1-9]$/.test(k) && +k <= list.length) { build(list[+k - 1].id); ev.preventDefault(); }
      else if (k === "h") { handDialog(); ev.preventDefault(); }
      else if (k === "u") { upDialog(); ev.preventDefault(); }
      else if (k === "f") { fcDialog(); ev.preventDefault(); }
      else if (k === "l") { logDialog(); ev.preventDefault(); }
      else if (k === "s") { recDialog(); ev.preventDefault(); }
      else if (k === "m") { toggleSfx(); ev.preventDefault(); }
      else if (ev.key === "?") { tourDialog(); ev.preventDefault(); }
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
    var r = E.rates(live), d = E.dayOf(live.hr) + 1, h = E.hourOf(live.hr);
    var c = $("s-coins");
    c.querySelector(".v").textContent = fmt(live.coins);
    c.querySelector(".r").textContent = r.coins > 0 ? t("st.rate", { n: fmtRate(r.coins) }) : "";
    c.title = t("st.coins");
    c.classList.toggle("low", r.low);
    $("s-sup").querySelector(".v").textContent = fmt(live.sup);
    $("s-sup").title = t("st.sup");
    $("s-fish").querySelector(".v").textContent = fmt(live.fish);
    $("s-fish").title = t("st.fish");
    $("s-ships").querySelector(".v").textContent = fmt(E.shipsHere(live));
    $("s-ships").title = t("st.ships");
    var ck = $("s-clock");
    ck.querySelector(".v").textContent = t("st.clock", { d: d, h: hh(h) });
    ck.querySelector(".ic").innerHTML = E.isNight(live.hr) ? ICONS.moon : ICONS.sun;
    ck.title = (E.isNight(live.hr) ? t("st.night") : r.light ? t("st.fog") : t("st.day")) + "; " + t("wx." + r.w);
    var can = E.canHand(live), hb = $("hand-btn");
    if (hb.hidden === can) hb.hidden = !can;
    $("tb-isle").textContent = t("is." + live.is);
  }
  var fcKey = "";
  function renderFc() {
    var list = E.forecast(live), ah = E.absH(live.hr);
    var key = [list[0].ah, list.length, live.is, LANG].join("|");
    if (key === fcKey) return;
    fcKey = key;
    var box = $("fc");
    box.textContent = "";
    box.title = t("btn.fc");
    list.forEach(function (f, i) {
      var cell = el("div", "fq" + (ah >= f.ah && ah < f.ah + 6 ? " now" : "") + (f.q === 1 && i ? " dawn" : ""));
      cell.setAttribute("role", "listitem");
      var wx = el("span", "wx " + f.w);
      wx.innerHTML = ICONS[f.w];
      cell.appendChild(wx);
      cell.appendChild(el("span", "dl", f.q === 0 || i === 0 ? t("fc.day", { d: f.day + 1 }) : hh(f.q * 6)));
      var label = t("fc.cell", { d: f.day + 1, q: t("q." + f.q), w: t("wx." + f.w) });
      cell.setAttribute("aria-label", label);
      cell.title = label;
      box.appendChild(cell);
    });
  }
  function placeFx(p) {
    if (p === "light") {
      var names = E.ROUTES.filter(function (rt) { return rt.r <= E.range(live); }).map(function (rt) { return t("rt." + rt.id); });
      return t("pl.light.fx", { r: names.join(", ") });
    }
    if (p === "boats") return t("pl.boats.fx", { f: fmt(live.fish) });
    if (p === "tavern") return t("pl.tavern.fx", { n: E.SELL * live.lv.tables, c: String(Math.round(E.tavernPrice(live) * 100) / 100).replace(".", t("num.dec")) });
    return t("pl." + p + ".fx");
  }
  function costText(c, s) {
    return s > 0 ? t("up.costS", { c: fmt(Math.ceil(c)), s: fmt(Math.ceil(s)) }) : t("up.cost", { c: fmt(Math.ceil(c)) });
  }
  function upFx(uid) {
    if (uid === "lamp") return live.lv.lamp >= 4 ? t("up.lamp.top") : t("up.lamp.fx", { next: t("lamp." + (live.lv.lamp + 1)) });
    return t("up." + uid + ".fx");
  }
  function upLabel(uid) { return uid === "lamp" ? upName("lamp") + ": " + t("lamp." + live.lv.lamp) : upName(uid); }

  function renderPanel() {
    var box = $("panel");
    box.textContent = "";
    lastPanelKey = "";
    if (!sel) {
      box.appendChild(el("p", "pn-hint", t("pn.hint")));
      var note = seaNote();
      if (note) box.appendChild(el("p", "pn-hint" + (note.warn ? " warn" : ""), note.text));
      if (note && note.hand) {
        var hb = el("button", "opt wide pn-hand");
        hb.type = "button";
        hb.appendChild(el("span", "tx")).appendChild(el("span", "nm", t("btn.hand")));
        hb.addEventListener("click", handDialog);
        box.appendChild(hb);
      }
      return;
    }
    var head = el("div", "pn-head");
    head.appendChild(el("span", "pn-title", t("pl." + sel)));
    box.appendChild(head);
    box.appendChild(el("p", "pn-sub", placeFx(sel)));
    var grid = el("div", "pn-grid");
    grid.style.marginTop = "6px";
    upsOf(sel).forEach(function (u, n) {
      var b = el("button", "opt");
      b.type = "button";
      b.setAttribute("data-k", u.id);
      var tx = el("span", "tx");
      var nm = el("span", "nm");
      nm.appendChild(document.createTextNode(""));
      nm.appendChild(el("span", "lvl"));
      tx.appendChild(nm);
      tx.appendChild(el("span", "fx"));
      b.appendChild(tx);
      b.appendChild(el("span", "cost"));
      b.addEventListener("click", function () { build(u.id); });
      b.title = upName(u.id) + " (" + (n + 1) + ")";
      grid.appendChild(b);
    });
    box.appendChild(grid);
    refreshPanel(true);
  }
  // Prices and what can be bought, in place (focus stays).
  function refreshPanel(force) {
    var box = $("panel");
    if (!sel) {
      var note = seaNote(), key = note ? note.text : "";
      if (force || key !== lastPanelKey) {
        lastPanelKey = key;
        var ps = box.querySelectorAll(".pn-hint");
        if (ps.length !== (note ? 2 : 1) || !box.querySelector(".pn-hand") !== !(note && note.hand)) { renderPanel(); return; }
        if (note) { ps[1].textContent = note.text; ps[1].classList.toggle("warn", !!note.warn); }
      }
      return;
    }
    var sub = box.querySelector("p.pn-sub");
    if (sub) sub.textContent = placeFx(sel);
    [].forEach.call(box.querySelectorAll("button[data-k]"), function (b) {
      var k = b.getAttribute("data-k"), inf = E.upInfo(live, k);
      var nm = b.querySelector(".nm");
      nm.firstChild.nodeValue = upLabel(k);
      nm.querySelector(".lvl").textContent = k === "lamp" ? "" : " " + t("up.lv", { l: inf.lv, max: inf.max });
      b.querySelector(".fx").textContent = upFx(k);
      b.querySelector(".cost").textContent = inf.done ? t("up.max") : !inf.need ? t("up.need", { x: t("up." + k + ".need") }) : costText(inf.c, inf.s);
      b.disabled = !inf.ok;
    });
  }
  // The line under the hint: the handover, a burning-low lamp, the
  // weather ahead that a defence would soften, or how far the light is.
  function seaNote() {
    if (E.canHand(live)) return { text: t("pn.hand"), hand: true };
    if (E.rates(live).low) return { text: t("pn.low"), warn: true };
    var ah = E.absH(live.hr), list = E.forecast(live).slice(0, 8);
    for (var i = 0; i < list.length; i++) {
      var f = list[i], adv = "";
      if (f.w === "fog" && !live.lv.horn) adv = "fog";
      else if (f.w === "storm" && !live.lv.shut) adv = "storm";
      else if (f.w === "rain" && !live.lv.hood) adv = "rain";
      else if ((f.w === "wind" || f.w === "storm") && !live.lv.brk && live.lv.boat > 2) adv = "wind";
      if (!adv) continue;
      var dh = Math.max(0, f.ah - ah);
      var when = dh <= 0 ? t("pn.when.now") : t("pn.when.h", { n: dh });
      var w = t("wx." + f.w);
      return { text: t("pn.adv", { w: w.charAt(0).toUpperCase() + w.slice(1), when: when, fx: t("pn.adv." + adv) }) };
    }
    var k = fmt(E.handShips(live));
    return { text: t(live.lv.lamp >= E.HANDOVER_LAMP ? "pn.ships" : "pn.shipsLens", { n: fmt(E.shipsHere(live)), k: k }) };
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
      E.PLACES.forEach(function (p) {
        d.appendChild(el("div", "up-group", t("pl." + p)));
        var list = el("div", "up-list");
        upsOf(p).forEach(function (u) {
          var row = el("div", "up-row");
          row.setAttribute("data-u", u.id);
          var tx = el("div", "tx");
          var nm = el("div", "nm");
          nm.appendChild(document.createTextNode(""));
          nm.appendChild(el("span", "lv"));
          tx.appendChild(nm);
          tx.appendChild(el("div", "fx"));
          row.appendChild(tx);
          var b = el("button", "dlg-btn primary");
          b.type = "button";
          b.addEventListener("click", function () { build(u.id); });
          row.appendChild(b);
          list.appendChild(row);
        });
        d.appendChild(list);
      });
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
      var inf = E.upInfo(live, u.id), b = row.querySelector("button"), nm = row.querySelector(".nm");
      nm.firstChild.nodeValue = upLabel(u.id);
      nm.querySelector(".lv").textContent = u.id === "lamp" ? "" : " " + t("up.lv", { l: inf.lv, max: inf.max });
      row.querySelector(".fx").textContent = upFx(u.id);
      b.textContent = inf.done ? t("up.max") : !inf.need ? t("up.need", { x: t("up." + u.id + ".need") }) : costText(inf.c, inf.s);
      b.disabled = !inf.ok;
    });
    var r = E.rates(live), n = E.range(live);
    var note = d.querySelector(".up-note");
    if (note) note.textContent = t("up.note", { r: fmtRate(r.coins), n: n, p: n * 5, o: fmtRate(E.oilCost(live)) });
  }
  function fcDialog() {
    E.catchUp(live, nowMs());
    openDialog("fc", function (d) {
      d.setAttribute("aria-label", t("fc.title"));
      d.appendChild(el("div", "dlg-title", t("fc.title")));
      var ul = el("ul", "fc-list");
      var seen = {};
      E.forecast(live).forEach(function (f) {
        var li = el("li");
        var wx = el("span", "wx " + f.w);
        wx.innerHTML = ICONS[f.w];
        wx.setAttribute("aria-hidden", "true");
        li.appendChild(wx);
        li.appendChild(el("span", "", t("fc.cell", { d: f.day + 1, q: t("q." + f.q), w: t("wx." + f.w) })));
        ul.appendChild(li);
        seen[f.w] = true;
      });
      d.appendChild(ul);
      E.WX.forEach(function (w) { if (seen[w] && w !== "calm") d.appendChild(el("p", "dlg-note", t("wxn." + w))); });
      d.appendChild(el("p", "dlg-note", t("fc.note")));
      actions(d, [{ label: t("btn.close"), fn: closeDialog }]);
    });
  }
  function logLine(e) {
    return t("log." + e.w, { ship: t("rts." + e.route), name: shipName(e.name) });
  }
  function logWhen(e) { return t("log.when", { d: E.dayOf(e.hr) + 1, h: hh(E.hourOf(e.hr)) }); }
  function logDialog() {
    E.catchUp(live, nowMs());
    openDialog("log", function (d) {
      d.setAttribute("aria-label", t("log.title"));
      d.appendChild(el("div", "dlg-title", t("log.title")));
      var list = E.log(live, 12);
      if (!list.length) d.appendChild(el("p", "dlg-msg", t("log.none")));
      else {
        var ul = el("ul", "log-list");
        list.forEach(function (e) {
          var li = el("li");
          li.appendChild(el("span", "when", logWhen(e)));
          li.appendChild(document.createTextNode(logLine(e)));
          ul.appendChild(li);
        });
        d.appendChild(ul);
      }
      actions(d, [{ label: t("btn.close"), fn: closeDialog }]);
    });
  }
  function recDialog() {
    E.catchUp(live, nowMs());
    openDialog("rec", function (d) {
      d.setAttribute("aria-label", t("rec.title"));
      d.appendChild(el("div", "dlg-title", t("rec.title")));
      rowKV(d, t("rec.day"), String(E.dayOf(live.hr) + 1));
      rowKV(d, t("rec.life"), fmt(live.life));
      rowKV(d, t("rec.ships"), fmt(live.ships));
      rowKV(d, t("rec.here"), fmt(E.shipsHere(live)) + " / " + fmt(E.handShips(live)));
      rowKV(d, t("rec.isle"), t("is." + live.is));
      rowKV(d, t("rec.lights"), fmt(live.hv + 1));
      var cnt = {};
      live.tr.forEach(function (x) { cnt[x] = (cnt[x] || 0) + 1; });
      rowKV(d, t("rec.traits"), Object.keys(cnt).map(function (x) { return t("tr." + x) + (cnt[x] > 1 ? " ×" + cnt[x] : ""); }).join(", ") || t("rec.none"));
      rowKV(d, t("rec.low"), fmt(live.low));
      rowKV(d, t("rec.acts"), fmt(live.acts));
      d.appendChild(el("div", "dlg-sub", t("rec.chart")));
      if (live.lh.length) {
        var ul = el("ul", "ap-list");
        live.lh.forEach(function (h, n) {
          ul.appendChild(el("li", "", t("rec.lhItem", { n: n + 1, is: t("is." + h.is), d: h.d, sh: fmt(h.sh) })));
        });
        d.appendChild(ul);
        d.appendChild(el("p", "dlg-note", t("rec.lhBonus", { p: Math.round(Math.min(E.LH_MAX, live.hv) * E.CHART_F * 100) })));
      } else d.appendChild(el("p", "dlg-note", t("rec.lhNone")));
      var fl = el("label", "dlg-check");
      var fc = el("input");
      fc.type = "checkbox";
      fc.checked = sfxOn();
      fc.addEventListener("change", function () { if (fc.checked !== sfxOn()) toggleSfx(); });
      fl.appendChild(fc);
      fl.appendChild(el("span", "", t("rec.sfx")));
      d.appendChild(fl);
      var sl = el("label", "dlg-check");
      var sc = el("input");
      sc.type = "checkbox";
      sc.checked = seaOn();
      sc.addEventListener("change", function () { setSea(sc.checked); });
      sl.appendChild(sc);
      sl.appendChild(el("span", "", t("rec.sea")));
      d.appendChild(sl);
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
  // The handover: one island and one trait, both chosen here.
  function handDialog() {
    E.catchUp(live, nowMs());
    if (!E.canHand(live)) { showToast(t("toast.nohand", { n: fmt(E.handShips(live)) })); sfx("no"); return; }
    var isles = E.ISLE_IDS.filter(function (x) { return x !== live.is; });
    var pick = { is: isles[0], tr: E.offer(live)[0] };
    openDialog("hand", function (d) {
      d.setAttribute("aria-label", t("hd.title"));
      d.appendChild(el("div", "dlg-title", t("hd.title")));
      d.appendChild(el("p", "dlg-msg", t("hd.msg")));
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
          tx.appendChild(el("span", "nm", t(prefix + id)));
          tx.appendChild(el("span", "fx", t(prefix + id + ".fx")));
          lb.appendChild(tx);
          fs.appendChild(lb);
        });
        d.appendChild(fs);
      }
      group(t("hd.isle"), "hd-is", isles, "is.", "is");
      group(t("hd.trait"), "hd-tr", E.offer(live), "tr.", "tr");
      d.appendChild(el("p", "dlg-note", t("hd.note")));
      actions(d, [
        { label: t("hd.later"), fn: closeDialog },
        { label: t("hd.go"), cls: "primary", fn: function () {
          var is = pick.is, tr = pick.tr;
          closeDialog();
          sel = "";
          doAct({ t: "hand", is: is, tr: tr }, t("toast.hand", { is: t("is." + is) }));
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
      rowKV(d, t("away.days"), String(Math.floor(info.hours / 24)));
      rowKV(d, t("away.ships"), fmt(info.ships));
      rowKV(d, t("away.coins"), fmt(live.coins));
      if (info.wx.length) rowKV(d, t("away.wx"), info.wx.join(", "));
      var lines = E.log(live, 3);
      if (lines.length) {
        d.appendChild(el("div", "dlg-sub", t("away.log")));
        var ul = el("ul", "log-list");
        lines.forEach(function (e) {
          var li = el("li");
          li.appendChild(el("span", "when", logWhen(e)));
          li.appendChild(document.createTextNode(logLine(e)));
          ul.appendChild(li);
        });
        d.appendChild(ul);
      }
      if (info.low > 0) d.appendChild(el("p", "dlg-note", t("away.low", { n: fmt(info.low) })));
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
      d.appendChild(el("p", "dlg-note", t("tour.again")));
      actions(d, [{ label: t("btn.ok"), cls: "primary", fn: function () { prefs.tour = 1; savePrefs(); closeDialog(); } }]);
    });
    $("dlg").scrollTop = 0;   // open at the top, not at the focused Good button
  }

  // ---------- 9. Toasts ----------
  var toastTimer = null;
  // withUndo: the local toast with Undo (the shell's toast has no button).
  function showToast(text, withUndo) {
    if (!withUndo) {
      try {
        var n = (window.parent && window.parent.orosNotifs) || window.orosNotifs;
        if (n && typeof n.transient === "function" && n.transient({ ns: "lighthouse", title: String(text) })) return;
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
  var HAPTIC = { up: "good", hand: "good", no: "bad" };
  function sfx(kind) {
    if (window.orosHaptics && HAPTIC[kind]) window.orosHaptics.cue(HAPTIC[kind]);
    if (!sfxOn()) return;
    try {
      if (!ac()) return;
      if (kind === "up") { tone(392, 0, 0.1, "triangle", 0.08); tone(523, 0.07, 0.12, "triangle", 0.07); }
      else if (kind === "hand") [392, 494, 587, 784].forEach(function (f, k) { tone(f, k * 0.09, 0.18, "triangle", 0.08); });
      else if (kind === "undo") { tone(392, 0, 0.08, "sine", 0.07); tone(330, 0.06, 0.1, "sine", 0.06); }
      else if (kind === "no") tone(170, 0, 0.14, "sawtooth", 0.05);
      else if (kind === "toggle") { tone(1047, 0, 0.05, "sine", 0.08); tone(1319, 0.04, 0.07, "sine", 0.07); }
    } catch (e) { /* no audio → silent */ }
  }
  // The sea: off by default; soft filtered noise that rises with the
  // wind, and a low horn now and then in fog once the horn is built.
  var sea = null, hornAt = 0;
  function seaOn() {
    try { return localStorage.getItem(SEA_KEY) === "1"; } catch (e) { return false; }
  }
  function setSea(on) {
    try { localStorage.setItem(SEA_KEY, on ? "1" : "0"); } catch (e) {}
    updateSea();
  }
  function updateSea() {
    var w = live ? E.weather(live) : "calm";
    var want = seaOn() && live && !document.hidden ? (w === "storm" ? 0.06 : w === "wind" ? 0.045 : 0.025) : 0;
    if (!want && !sea) return;
    try {
      if (!ac()) return;
      if (!sea) {
        var len = audio.sampleRate * 2, buf = audio.createBuffer(1, len, audio.sampleRate), data = buf.getChannelData(0);
        var last = 0;
        for (var i = 0; i < len; i++) { last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02; data[i] = last * 3.5; }
        var src = audio.createBufferSource();
        src.buffer = buf; src.loop = true;
        var lp = audio.createBiquadFilter(), g = audio.createGain();
        lp.type = "lowpass"; lp.frequency.value = 700;
        g.gain.value = 0;
        src.connect(lp); lp.connect(g); g.connect(audio.destination);
        src.start();
        sea = { g: g, src: src, lp: lp };
      }
      sea.g.gain.setTargetAtTime(want, audio.currentTime, 1.2);
      sea.lp.frequency.setTargetAtTime(w === "storm" || w === "wind" ? 1100 : 650, audio.currentTime, 2);
      if (want && w === "fog" && live.lv.horn && Date.now() - hornAt > 30000) {
        hornAt = Date.now();
        tone(98, 0, 2.2, "sawtooth", 0.025); tone(147, 0, 2.2, "sine", 0.02);
      }
      if (!want) {
        var s = sea;
        sea = null;
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
    tower:  SVG + '<path d="M9 22l1.5-14h3L15 22z"/><path d="M8 22h8"/><path d="M10 8V5h4v3"/><path d="M12 2v3"/><path d="M4 6l4 1M20 6l-4 1"/></svg>',
    log:    SVG + '<path d="M5 3h11l3 3v15H5z"/><path d="M9 8h6M9 12h6M9 16h4"/></svg>',
    help:   SVG + '<circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 0 1 4.9.8c0 1.7-2.4 2.2-2.4 3.7"/><path d="M12 17h.01"/></svg>',
    stats:  SVG + '<path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0z"/><path d="M17 5h3v2a3 3 0 0 1-3 3M7 5H4v2a3 3 0 0 0 3 3"/></svg>',
    sfxOn:  SVG + '<path d="M11 5 6 9H2v6h4l5 4z"/><path d="M15.5 8.5a5 5 0 0 1 0 7M19 5a10 10 0 0 1 0 14"/></svg>',
    sfxOff: SVG + '<path d="M11 5 6 9H2v6h4l5 4z"/><path d="M22 9l-6 6M16 9l6 6"/></svg>',
    coins:  SVG + '<circle cx="9" cy="9" r="6"/><path d="M15.5 9.5A6 6 0 1 1 9.5 15.5"/></svg>',
    sup:    SVG + '<rect x="3" y="13" width="8" height="7" rx="1"/><rect x="13" y="13" width="8" height="7" rx="1"/><rect x="8" y="5" width="8" height="7" rx="1"/></svg>',
    fish:   SVG + '<path d="M3 12c3-5 10-6 14-2l4-3v10l-4-3c-4 4-11 3-14-2z"/><circle cx="8" cy="11" r="0.8"/></svg>',
    ships:  SVG + '<path d="M3 17h18l-2 4H5z"/><path d="M12 3v12M12 4l6 9h-6"/></svg>',
    sun:    SVG + '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>',
    moon:   SVG + '<path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"/></svg>',
    calm:   SVG + '<circle cx="12" cy="12" r="4"/><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M5.6 18.4 7 17M17 7l1.4-1.4"/></svg>',
    wind:   SVG + '<path d="M3 8h10a3 3 0 1 0-3-3"/><path d="M3 12h15a3 3 0 1 1-3 3"/><path d="M3 16h7"/></svg>',
    rain:   SVG + '<path d="M7 15a4 4 0 0 1 0-8 5 5 0 0 1 9.5-1.5A3.5 3.5 0 1 1 17 15z"/><path d="M8 18l-1 3M12 18l-1 3M16 18l-1 3"/></svg>',
    fog:    SVG + '<path d="M4 9h16M3 13h18M5 17h14"/><path d="M8 5h8"/></svg>',
    storm:  SVG + '<path d="M7 14a4 4 0 0 1 0-8 5 5 0 0 1 9.5-1.5A3.5 3.5 0 1 1 17 14"/><path d="M12 12l-2 5h4l-2 5"/></svg>'
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
    api.registerSlice("lighthouse", sliceGet, sliceSet, STORAGE_KEY, mergeIsland);
  }
  function mergeIsland(a, b) { return E.merge(a, b); }
  // The island as written, never the ticking one (R26: the same JSON
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
      renderAll(true);
    } catch (e) {
    } finally {
      window.__orosSyncApi._suppress = false;
    }
  }

  // ---------- 12. Test hooks, wiring & boot ----------
  // render_game_to_text: the visible state as JSON. The scene is a side
  // view: the island at the bottom left, the sea lanes above the horizon
  // line, the farthest route nearest the horizon.
  window.render_game_to_text = function () {
    if (!live) return "{}";
    var r = E.rates(live);
    return JSON.stringify({
      mode: dlgKind || "play", day: E.dayOf(live.hr) + 1, hour: E.hourOf(live.hr), night: E.isNight(live.hr),
      weather: r.w, lightOn: r.light, low: r.low, isle: live.is, lights: live.hv + 1, traits: live.tr,
      canHand: E.canHand(live), offer: E.offer(live), coins: Math.floor(live.coins), sup: Math.floor(live.sup),
      fish: Math.floor(live.fish), shipsHere: Math.floor(E.shipsHere(live)), handShips: E.handShips(live),
      perMin: Math.round(r.coins * 100) / 100, range: E.range(live), lv: live.lv, sel: sel,
      forecast: E.forecast(live).map(function (f) { return f.w; }),
      places: E.PLACES.map(function (p) { var b = BOX[p] || {}; return { id: p, x: Math.round(b.x + b.w / 2), y: Math.round(b.y + b.h / 2) }; }),
      note: "one game hour = 1 min; places: canvas centres of the hit boxes"
    });
  };
  window.advanceTime = function (ms) {
    clockOff += Math.max(0, +ms || 0);
    tick();
  };

  function applyI18n() {
    var hb = $("help-btn");
    hb.innerHTML = ICONS.help;
    hb.setAttribute("aria-label", t("btn.help"));
    hb.title = t("btn.help");
    [].forEach.call(document.querySelectorAll("[data-i18n]"), function (n) {
      n.textContent = t(n.getAttribute("data-i18n"));
    });
    canvas.setAttribute("aria-label", t("view.label"));
    var hb = $("hand-btn");
    hb.querySelector(".ic").innerHTML = ICONS.ships;
    hb.title = t("btn.handKey");
    var ub = $("up-btn");
    ub.querySelector(".ic").innerHTML = ICONS.tower;
    ub.title = t("btn.upKey");
    [["log-btn", "log", "btn.log"], ["stats-btn", "stats", "btn.stats"]].forEach(function (x) {
      var b = $(x[0]);
      b.innerHTML = ICONS[x[1]];
      b.setAttribute("aria-label", t(x[2]));
      b.title = t(x[2]);
    });
    [["s-coins", "coins"], ["s-sup", "sup"], ["s-fish", "fish"], ["s-ships", "ships"], ["s-clock", "sun"]].forEach(function (x) {
      $(x[0]).querySelector(".ic").innerHTML = ICONS[x[1]];
    });
    paintSfxBtn();
  }
  function wire() {
    $("up-btn").addEventListener("click", upDialog);
    $("hand-btn").addEventListener("click", handDialog);
    $("log-btn").addEventListener("click", logDialog);
    $("stats-btn").addEventListener("click", recDialog);
    $("help-btn").addEventListener("click", tourDialog);
    $("sfx-btn").addEventListener("click", toggleSfx);
    $("fc").addEventListener("click", fcDialog);
    document.addEventListener("pointerdown", function () { if (seaOn()) updateSea(); }, { once: true });
    $("dlg").addEventListener("close", function () { dlgKind = ""; });
    $("dlg").addEventListener("cancel", function () {
      if (dlgKind === "tour") { prefs.tour = 1; savePrefs(); }
    });
    wireInput();
    wireKeyboard();
    window.addEventListener("resize", resize);
    if (window.ResizeObserver) new ResizeObserver(resize).observe($("scene"));
    document.addEventListener("visibilitychange", function () {
      if (document.hidden) { flushOut(); stopAnim(); updateSea(); }
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
  // Coming back to the page: the away card when the island moved on.
  function onReturn() {
    if (!live) return;
    var before = { life: prefs.seenLife, hr: prefs.seenHr, ships: prefs.seenShips, low: prefs.seenLow, seen: prefs.seen };
    var out = E.catchUp(live, nowMs());
    if (out.dt > CHECKPOINT || out.slowed) checkpoint();
    if (before.seen && live.hr - before.hr >= AWAY_HR && !$("dlg").open) {
      var wx = Object.keys(out.wx).filter(function (w) { return w !== "calm"; })
        .sort(function (a, b) { return out.wx[b] - out.wx[a]; })
        .map(function (w) { return t("wx." + w) + " " + t("dur.h", { n: out.wx[w] }); });
      awayDialog({ made: Math.max(0, live.life - before.life), hours: live.hr - before.hr,
                   ships: Math.max(0, live.ships - before.ships), low: Math.max(0, live.low - before.low),
                   ms: Math.max(0, nowMs() - before.seen), slowed: nowMs() - before.seen > E.FULL_MS, wx: wx });
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
    // every minute while open: remember where the island was (the away card)
    setInterval(function () {
      if (document.hidden || !live) return;
      seenNow();
      savePrefs();
    }, 60000);
    startAnim();
  }

  boot();
})();
