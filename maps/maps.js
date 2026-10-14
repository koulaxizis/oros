// ============================================================
// orOS Maps — App logic (Wave 2: Search · Routes · Layers ·
// Saved Places)
//
// Online services (external, disclosed):
//   - Tiles:      OpenStreetMap / HOT / Esri (cross-origin)
//   - Geocoding:  Photon (photon.komoot.io)
//   - Routing:    OSRM — car: demo server (router.project-osrm.org);
//                 bike / walk: FOSSGIS (routing.openstreetmap.de)
//   - OSM API:    notes (api.openstreetmap.org, OAuth 2.0 sign-in),
//                 in osm.js / osm-api.js / notes.js
// Saved places sync through the "maps" slice (oros-maps-data,
// symmetric merge + tombstones). The last-known route and the
// tile cache are device-local (never synced).
//
// Sections:
//   1. Constants, i18n, helpers, boot marker
//   2. Saved-places state + storage + merge engine (maps slice)
//   3. Map init + tile layers + layer control
//   4. Geolocation + markers (divIcon SVG — zero PNG assets)
//      (sections 5–9 never existed — numbering kept for history)
//  10. Search autocomplete (Photon)
//  11. Routing (OSRM — car / bike / foot)
//  12. Saved places drawer + map markers
//  13. Palette inheritance + shell shortcut contract
//  14. Deep-link receiver
//  15. Wiring & boot
// ============================================================
(function () {
  "use strict";

  // ---------- 1. Constants, i18n, helpers ----------
  var LANG = localStorage.getItem("oros-lang") === "el" ? "el" : "en";

  var STRINGS = {
    en: {
      "aria.mode": "Travel mode",
      "zoom.in": "Zoom in",
      "zoom.out": "Zoom out",
      "layers.title": "Map layers",
      "search.ph":        "Search a place…",
      "search.clear":     "Clear search",
      "search.empty":     "No results",
      "search.offline":   "You are offline — search needs a connection",
      "search.err":       "Search failed — try again",
      "route.car":        "Car",
      "route.bike":      "Bike",
      "route.foot":      "Walk",
      "route.transit":   "Public transport",
      "route.clear":     "Clear route",
      "route.err":       "Could not calculate a route",
      "places.title":    "Saved places",
      "places.close":    "Close",
      "places.empty":    "No saved places yet",
      "places.empty.hint":"Star a search result to save it.",
      "places.saved":    "Place saved",
      "places.removed":  "Place removed",
      "places.del":      "Delete place",
      "geo.title":       "Use my location",
      "geo.permission":  "Location permission denied",
      "geo.unavailable": "Location unavailable",
      "geo.searching":   "Getting your location…",
      "geo.found":       "Location found",
      "toast.noLocYet":  "Tap the location button first",
      "route.steps":     "Directions",
      "route.nosteps":   "No active route",
      "route.plan":      "Plan a route",
      "route.pick.start":"Tap the map to set the start",
      "route.pick.end":  "Tap the map to set the destination",
      "route.ptmap":     "Point on map",
      "mvn.depart":      "Head out",
      "mvn.arrive":      "Arrive at destination",
      "mvn.turn":        "Turn {dir}",
      "mvn.continue":    "Continue {dir}",
      "mvn.continue.straight": "Continue straight",
      "mvn.merge":       "Merge {dir}",
      "mvn.merge.plain": "Merge",
      "mvn.fork":        "Keep {dir} at the fork",
      "mvn.endofroad":   "At the end of the road, turn {dir}",
      "mvn.roundabout":  "At the roundabout, take exit {n}",
      "mvn.ramp":        "Take the ramp {dir}",
      "mvn.exitramp":    "Take the exit {dir}",
      "mvn.uturn":       "Make a U-turn",
      "mvn.exitroundabout": "Exit the roundabout",
      "mvn.on":          "onto {name}",
      "mvn.dir.left":    "left",
      "mvn.dir.right":   "right",
      "mvn.dir.slightleft":  "slightly left",
      "mvn.dir.slightright": "slightly right",
      "mvn.dir.sharpleft":   "sharp left",
      "mvn.dir.sharpright":  "sharp right",
      "mvn.dir.straight":    "straight",
      "nav.start":           "Start navigation",
      "nav.exit":            "Exit navigation",
      "nav.exitconfirm":     "Tap again to exit navigation",
      "nav.mute":            "Mute voice",
      "nav.muted":           "Voice muted",
      "nav.unmute":          "Unmute voice",
      "nav.rerouting":      "Recalculating route…",
      "nav.arrived":         "You have arrived",
      "nav.gpslost":         "Waiting for GPS signal…",
      "settings.title":     "Maps settings",
      "settings.tiles":     "Offline tiles",
      "settings.tiles.clear":"Clear tile cache",
      "settings.tiles.none":"Cache is empty",
      "settings.route":     "Last known route",
      "settings.route.forget":"Forget saved route",
      "settings.route.none":"No route saved yet",
      "offline.chip":       "Offline",
      "offline.enter":       "You are offline — cached areas still work",
      "offline.leave":       "Back online",
      "route.restored":     "Last known route restored",
      "cal.send":           "Send to Calendar",
      "cal.sent":           "Sent to Calendar",
      "cal.date":           "Day",
      "cal.confirm":        "Send",
      "cal.cancel":         "Cancel",
      "store.full":         "Storage is full — the change was not saved",
      "places.save":        "Save",
      "places.remove":      "Remove",
      "route.fromLast":     "No fresh location — routing from your last known position",
      "route.toobig":       "This route is too long to keep for offline use",
      "nav.resumed":        "Navigation resumed",
      "geo.me":             "My location",
      "pop.route":          "Route",
      "pop.from":           "From here",
      "route.calculating":  "Calculating route…",
      "route.offline":      "You are offline — a route needs a connection",
      "places.rename":      "Rename place",
      "places.undo":        "Undo",
      "dlg.ok":             "OK",
      "settings.tiles.count":   "{n} tiles stored",
      "settings.tiles.cleared": "Tile cache cleared",
      "nav.novoice":        "No voice for this language on this device — follow the screen",
      "nav.in":             "In {d}, {text}",
      "say.m":              "metres",
      "say.km":             "kilometres",
      "u.m":                "m",
      "u.km":               "km",
      "u.min":              "min",
      "u.h":                "h",
      "u.kmh":              "km/h",
      "route.edit":         "Edit route",
      "route.notraffic":    "Estimate without live traffic",
      "route.pick.via":     "Tap the map to set the stop",
      "plan.from":          "From",
      "plan.to":            "To",
      "plan.via":           "Stop {n}",
      "plan.from.ph":       "Choose a start…",
      "plan.to.ph":         "Choose a destination…",
      "plan.via.ph":        "Choose a stop…",
      "plan.addstop":       "Add stop",
      "plan.rmstop":        "Remove stop",
      "plan.maxstops":      "Up to 3 stops",
      "plan.swap":          "Swap start and destination",
      "plan.swap.short":    "Swap",
      "plan.pickmap":       "Choose on map",
      "plan.saved":         "Saved places",
      "plan.recent":        "Recent",
      "plan.needstart":     "No location yet — choose a start",
      "coords":             "Coordinates",
      "ctx.start":          "Start here",
      "ctx.via":            "Add as stop",
      "ctx.end":            "Go here",
      "mvn.via":            "Arrive at stop {n}",
      "nav.fromhere":       "Starting from your location — route recalculated",
      "nav.recenter":       "Recenter",
      // OSM upgrade wave 6: alternatives, arrival, lanes, avoid, sharing
      "route.arrive":       "Arrive {t}",
      "route.alts":         "Routes",
      "route.alt.best":     "Fastest",
      "route.alts.hint":    "{n} other routes: tap a grey line to switch",
      "route.avoid":        "Avoid",
      "route.avoid.none":   "Nothing",
      "route.avoid.toll":   "Tolls",
      "route.avoid.motorway":"Motorways",
      "route.avoid.ferry":  "Ferries",
      "route.avoid.nosrv":  "The route server could not avoid that, so this is the normal route",
      "nav.lanes":          "Lanes",
      "share":              "Share",
      "share.point":        "Share this place",
      "share.route":        "Share this route",
      "share.routeto":      "Route to {n}",
      "share.send":         "Send…",
      "share.copy":         "Copy link",
      "share.copied":       "Link copied",
      "share.nocopy":       "Could not copy. Select the link and copy it.",
      "share.coords":       "Copy coordinates",
      "share.coords.ok":    "Coordinates copied",
      "share.geo":          "Open in another app",
      "share.osm":          "Open on OpenStreetMap",
      "share.track":        "Save to My tracks",
      "share.track.ok":     "Saved to My tracks",
      "share.track.no":     "Could not save the track",
      "share.close":        "Close"
    },
    el: {
      "aria.mode": "Τρόπος μετακίνησης",
      "zoom.in": "Μεγέθυνση",
      "zoom.out": "Σμίκρυνση",
      "layers.title": "Είδος χάρτη",
      "search.ph":        "Αναζήτηση τοποθεσίας…",
      "search.clear":     "Καθαρισμός αναζήτησης",
      "search.empty":     "Κανένα αποτέλεσμα",
      "search.offline":   "Είσαι offline — η αναζήτηση χρειάζεται σύνδεση",
      "search.err":       "Η αναζήτηση απέτυχε — δοκίμασε ξανά",
      "route.car":        "Αυτοκίνητο",
      "route.bike":       "Ποδήλατο",
      "route.foot":       "Πεζός",
      "route.transit":    "ΜΜΜ",
      "route.clear":      "Καθαρισμός διαδρομής",
      "route.err":        "Δεν ήταν δυνατός ο υπολογισμός διαδρομής",
      "places.title":     "Αποθηκευμένες τοποθεσίες",
      "places.close":     "Κλείσιμο",
      "places.empty":     "Δεν υπάρχουν αποθηκευμένες τοποθεσίες",
      "places.empty.hint":"Αστέρισε ένα αποτέλεσμα αναζήτησης για αποθήκευση.",
      "places.saved":     "Η τοποθεσία αποθηκεύτηκε",
      "places.removed":   "Η τοποθεσία αφαιρέθηκε",
      "places.del":       "Διαγραφή τοποθεσίας",
      "geo.title":        "Χρησιμοποίησε την τοποθεσία μου",
      "geo.permission":   "Αρνηση δικαιώματος τοποθεσίας",
      "geo.unavailable":  "Η τοποθεσία δεν είναι διαθέσιμη",
      "geo.searching":    "Λήψη τοποθεσίας…",
      "geo.found":        "Βρέθηκε τοποθεσία",
      "toast.noLocYet":   "Πάτησε πρώτα το κουμπί τοποθεσίας",
      "route.steps":      "Οδηγίες",
      "route.nosteps":    "Δεν υπάρχει ενεργή διαδρομή",
      "route.plan":       "Σχεδιασμός διαδρομής",
      "route.pick.start": "Πάτησε στον χάρτη για να ορίσεις την αφετηρία",
      "route.pick.end":  "Πάτησε στον χάρτη για να ορίσεις τον προορισμό",
      "route.ptmap":     "Σημείο στον χάρτη",
      "mvn.depart":       "Ξεκίνα",
      "mvn.arrive":       "Άφιξη στον προορισμό",
      "mvn.turn":         "Στρίψε {dir}",
      "mvn.continue":     "Συνέχισε {dir}",
      "mvn.continue.straight": "Συνέχισε ίσια",
      "mvn.merge":        "Ενσωματώσου {dir}",
      "mvn.merge.plain":  "Ενσωματώσου στην κυκλοφορία",
      "mvn.fork":         "Μείνε {dir} στο διχάλι",
      "mvn.endofroad":    "Στο τέλος του δρόμου στρίψε {dir}",
      "mvn.roundabout":   "Στον κυκλικό κόμβο πάρε την έξοδο {n}",
      "mvn.ramp":         "Πάρε τη ράμπα {dir}",
      "mvn.exitramp":     "Πάρε την έξοδο {dir}",
      "mvn.uturn":        "Κάνε αναστροφή",
      "mvn.exitroundabout": "Βγες από τον κυκλικό κόμβο",
      "mvn.on":           "στην οδό {name}",
      "mvn.dir.left":     "αριστερά",
      "mvn.dir.right":    "δεξιά",
      "mvn.dir.slightleft":  "ελαφρώς αριστερά",
      "mvn.dir.slightright": "ελαφρώς δεξιά",
      "mvn.dir.sharpleft":   "απότομα αριστερά",
      "mvn.dir.sharpright":  "απότομα δεξιά",
      "mvn.dir.straight":    "ίσια",
      "nav.start":           "Έναρξη πλοήγησης",
      "nav.exit":            "Έξοδος από την πλοήγηση",
      "nav.exitconfirm":     "Πάτησε ξανά για έξοδο από την πλοήγηση",
      "nav.mute":            "Σίγαση φωνής",
      "nav.muted":           "Η φωνή σιώπασε",
      "nav.unmute":          "Ενεργοποίηση φωνής",
      "nav.rerouting":       "Επανυπολογισμός διαδρομής…",
      "nav.arrived":         "Έφτασες στον προορισμό",
      "nav.gpslost":         "Αναμονή σήματος GPS…",
      "settings.title":      "Ρυθμίσεις Χαρτών",
      "settings.tiles":      "Offline χάρτης",
      "settings.tiles.clear":"Καθαρισμός cache πλακιδίων",
      "settings.tiles.none": "Η cache είναι κενή",
      "settings.route":      "Τελευταία γνωστή διαδρομή",
      "settings.route.forget":"Διαγραφή αποθηκευμένης διαδρομής",
      "settings.route.none": "Δεν έχει αποθηκευτεί διαδρομή ακόμα",
      "offline.chip":        "Εκτός σύνδεσης",
      "offline.enter":       "Είσαι offline — οι αποθηκευμένες περιοχές λειτουργούν",
      "offline.leave":       "Επανήλθε η σύνδεση",
      "route.restored":      "Επαναφορά τελευταίας γνωστής διαδρομής",
      "cal.send":           "Αποστολή στο Ημερολόγιο",
      "cal.sent":           "Στάλθηκε στο Ημερολόγιο",
      "cal.date":           "Ημέρα",
      "cal.confirm":        "Αποστολή",
      "cal.cancel":         "Άκυρο",
      "store.full":         "Ο χώρος αποθήκευσης γέμισε — η αλλαγή δεν αποθηκεύτηκε",
      "places.save":        "Αποθήκευση",
      "places.remove":      "Αφαίρεση",
      "route.fromLast":     "Δεν βρέθηκε νέα τοποθεσία — διαδρομή από την τελευταία γνωστή θέση",
      "route.toobig":       "Η διαδρομή είναι πολύ μεγάλη για να κρατηθεί εκτός σύνδεσης",
      "nav.resumed":        "Η πλοήγηση συνεχίζεται",
      "geo.me":             "Η τοποθεσία μου",
      "pop.route":          "Διαδρομή",
      "pop.from":           "Από εδώ",
      "route.calculating":  "Υπολογισμός διαδρομής…",
      "route.offline":      "Είσαι offline — η διαδρομή χρειάζεται σύνδεση",
      "places.rename":      "Μετονομασία τοποθεσίας",
      "places.undo":        "Αναίρεση",
      "dlg.ok":             "OK",
      "settings.tiles.count":   "{n} αποθηκευμένα πλακίδια",
      "settings.tiles.cleared": "Η cache πλακιδίων καθαρίστηκε",
      "nav.novoice":        "Δεν υπάρχει φωνή για αυτή τη γλώσσα στη συσκευή — ακολούθησε την οθόνη",
      "nav.in":             "Σε {d}, {text}",
      "say.m":              "μέτρα",
      "say.km":             "χιλιόμετρα",
      "u.m":                "μ.",
      "u.km":               "χλμ.",
      "u.min":              "λεπ.",
      "u.h":                "ώρ.",
      "u.kmh":              "χλμ/ώ",
      "route.edit":         "Επεξεργασία διαδρομής",
      "route.notraffic":    "Εκτίμηση χωρίς ζωντανή κίνηση",
      "route.pick.via":     "Πάτησε στον χάρτη για να ορίσεις τη στάση",
      "plan.from":          "Από",
      "plan.to":            "Προς",
      "plan.via":           "Στάση {n}",
      "plan.from.ph":       "Διάλεξε αφετηρία…",
      "plan.to.ph":         "Διάλεξε προορισμό…",
      "plan.via.ph":        "Διάλεξε στάση…",
      "plan.addstop":       "Στάση",
      "plan.rmstop":        "Αφαίρεση στάσης",
      "plan.maxstops":      "Έως 3 στάσεις",
      "plan.swap":          "Αντιστροφή αφετηρίας και προορισμού",
      "plan.swap.short":    "Αντιστροφή",
      "plan.pickmap":       "Επιλογή στον χάρτη",
      "plan.saved":         "Αποθηκευμένες τοποθεσίες",
      "plan.recent":        "Πρόσφατα",
      "plan.needstart":     "Δεν βρέθηκε η τοποθεσία σου — διάλεξε αφετηρία",
      "coords":             "Συντεταγμένες",
      "ctx.start":          "Αφετηρία εδώ",
      "ctx.via":            "Προσθήκη ως στάση",
      "ctx.end":            "Πήγαινε εδώ",
      "mvn.via":            "Άφιξη στη στάση {n}",
      "nav.fromhere":       "Ξεκινάς από την τοποθεσία σου — η διαδρομή υπολογίστηκε ξανά",
      "nav.recenter":       "Επανακέντρωση",
      "route.arrive":       "Άφιξη {t}",
      "route.alts":         "Διαδρομές",
      "route.alt.best":     "Ταχύτερη",
      "route.alts.hint":    "{n} ακόμη διαδρομές: πάτησε μια γκρι γραμμή για αλλαγή",
      "route.avoid":        "Αποφυγή",
      "route.avoid.none":   "Τίποτα",
      "route.avoid.toll":   "Διόδια",
      "route.avoid.motorway":"Αυτοκινητόδρομοι",
      "route.avoid.ferry":  "Πλοία",
      "route.avoid.nosrv":  "Ο διακομιστής διαδρομών δεν μπόρεσε να το αποφύγει, οπότε αυτή είναι η κανονική διαδρομή",
      "nav.lanes":          "Λωρίδες",
      "share":              "Μοίρασμα",
      "share.point":        "Μοίρασμα τοποθεσίας",
      "share.route":        "Μοίρασμα διαδρομής",
      "share.routeto":      "Διαδρομή προς {n}",
      "share.send":         "Αποστολή…",
      "share.copy":         "Αντιγραφή συνδέσμου",
      "share.copied":       "Ο σύνδεσμος αντιγράφηκε",
      "share.nocopy":       "Η αντιγραφή απέτυχε. Επίλεξε τον σύνδεσμο και αντίγραψέ τον.",
      "share.coords":       "Αντιγραφή συντεταγμένων",
      "share.coords.ok":    "Οι συντεταγμένες αντιγράφηκαν",
      "share.geo":          "Άνοιγμα σε άλλη εφαρμογή",
      "share.osm":          "Άνοιγμα στο OpenStreetMap",
      "share.track":        "Αποθήκευση στις διαδρομές μου",
      "share.track.ok":     "Αποθηκεύτηκε στις διαδρομές μου",
      "share.track.no":     "Η αποθήκευση της διαδρομής απέτυχε",
      "share.close":        "Κλείσιμο"
    }
  };

  function t(key) {
    var p = STRINGS[LANG] || STRINGS.en;
    return p[key] !== undefined ? p[key] : (STRINGS.en[key] !== undefined ? STRINGS.en[key] : key);
  }

  function $(id) { return document.getElementById(id); }
  function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }

  // BOOT MARKER (Part VII §16 — stale-bundle detection)
  var SCRIPT_V = "";
  (function () {
    var m = ((document.currentScript && document.currentScript.src) || "")
      .match(/[?&]v=([^&#]+)/);
    SCRIPT_V = m ? m[1] : "";
    document.documentElement.lang = LANG;
    console.log("[orOS] maps.js v" + (SCRIPT_V || "?") + " boot");
  })();

  var DEFAULT_CENTER = [39.0742, 21.8243];   // Greece
  var DEFAULT_ZOOM = 6;

  // ---------- Toast (app-level; visual identical to todo.js) ----------
  // Local toast (the #toast node of this page). Used standalone, as
  // the fallback for a stale shell, and ALWAYS for Undo toasts — the
  // action closure never leaves this frame.
  var toastTimer = null;
  function localToast(text, actionLabel, actionFn) {
    var el = $("toast");
    el.textContent = "";
    el.appendChild(document.createTextNode(text));          // text FIRST
    var hasAction = !!actionLabel && typeof actionFn === "function";
    if (hasAction) {
      var btn = document.createElement("button");
      btn.type = "button";
      btn.textContent = actionLabel;
      btn.addEventListener("click", function () {
        el.classList.remove("show");
        actionFn();
      });
      el.appendChild(btn);                                  // action SECOND
    }
    el.classList.remove("show");
    void el.offsetWidth;               // restart transition
    el.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.classList.remove("show"); },
                            hasAction ? 8000 : 4000);
  }

  // Informational feedback → shell transient (unified notifications:
  // the user's toast position / style / duration apply, and the toast
  // lives OUTSIDE this frame — it survives the frame being replaced
  // and never covers the map controls). Falls back to the local toast.
  function showToast(text) {
    try {
      var n = (window.parent && window.parent.orosNotifs) || window.orosNotifs;
      if (n && typeof n.transient === "function" &&
          n.transient({ ns: "maps", title: String(text) })) return;
    } catch (e) { /* cross-origin / standalone */ }
    localToast(text);
  }

  // ---------- 2. Saved-places state + storage + merge ----------
  // oros-maps-data — synced through the "maps" slice.
  //   state = { ver, places: [{ id, name, sub, lat, lon, mtime }],
  //             deleted: { <id>: <tombstone ts> } }
  // Ids are DETERMINISTIC (derived from the coordinates): the same
  // place starred on two devices is ONE entity, never a duplicate.
  // Canonical shape (R26): places sorted by id, tombstone keys
  // sorted, fixed field order — normalize() is the single funnel
  // for load, save, merge results and slice get/set.
  var STORAGE_KEY = "oros-maps-data";
  var RESCUE_KEY = "oros-maps-rescue";     // device-local copy of unreadable data
  var DATA_VER = 1;

  var state = { ver: DATA_VER, places: [], deleted: {} };

  function placeId(lat, lon) {
    return "p" + lat.toFixed(6) + "," + lon.toFixed(6);
  }

  // LWW by mtime; ties by lexicographic JSON (identical on both sides).
  function newerObj(x, y) {
    if ((x.mtime || 0) !== (y.mtime || 0)) {
      return (x.mtime || 0) > (y.mtime || 0) ? x : y;
    }
    return JSON.stringify(x) >= JSON.stringify(y) ? x : y;
  }

  // Idempotent + canonical. Drops malformed rows, re-derives ids,
  // dedupes by id (newer wins), applies tombstones (delete wins
  // ties; a newer edit resurrects — R17).
  function normalize(data) {
    var out = { ver: DATA_VER, places: [], deleted: {} };
    if (!data || typeof data !== "object") return out;

    var tomb = (data.deleted && typeof data.deleted === "object") ? data.deleted : {};
    Object.keys(tomb).sort().forEach(function (id) {
      if (typeof tomb[id] === "number" && isFinite(tomb[id])) out.deleted[id] = tomb[id];
    });

    var byId = {};
    (Array.isArray(data.places) ? data.places : []).forEach(function (p) {
      if (!p || typeof p.lat !== "number" || typeof p.lon !== "number" ||
          !isFinite(p.lat) || !isFinite(p.lon)) return;
      var q = {
        id: placeId(p.lat, p.lon),
        name: (typeof p.name === "string" && p.name) ? p.name : "?",
        sub: (typeof p.sub === "string") ? p.sub : "",
        lat: p.lat, lon: p.lon,
        mtime: (typeof p.mtime === "number" && isFinite(p.mtime)) ? p.mtime : 0
      };
      byId[q.id] = byId[q.id] ? newerObj(byId[q.id], q) : q;
    });
    Object.keys(byId).sort().forEach(function (id) {
      var ts = out.deleted[id];
      if (ts === undefined || byId[id].mtime > ts) out.places.push(byId[id]);
    });
    return out;
  }

  // Symmetric merge: merge(A,B) === merge(B,A) (R5). Places union by
  // id with LWW; tombstones union with max ts.
  function mergeMapsStates(A, B) {
    var x = A || {}, y = B || {};
    var tomb = {};
    [x.deleted, y.deleted].forEach(function (d) {
      if (!d || typeof d !== "object") return;
      Object.keys(d).forEach(function (id) {
        if (typeof d[id] !== "number") return;
        tomb[id] = Math.max(tomb[id] || 0, d[id]);
      });
    });
    return normalize({
      places: (Array.isArray(x.places) ? x.places : [])
        .concat(Array.isArray(y.places) ? y.places : []),
      deleted: tomb
    });
  }

  // Local-first. A fresh install persists NOTHING until the first
  // real change (lazy). Unreadable data is copied to a rescue key
  // before the app starts clean — never silently overwritten.
  function load() {
    var raw = null;
    try { raw = localStorage.getItem(STORAGE_KEY); } catch (e) { raw = null; }
    if (!raw) return;
    var data = null;
    try { data = JSON.parse(raw); } catch (e) { data = null; }
    if (!data || typeof data !== "object" || !Array.isArray(data.places)) {
      try { localStorage.setItem(RESCUE_KEY, raw); } catch (e2) { /* quota */ }
      return;
    }
    state = normalize(data);
  }

  // Returns true when the change reached storage. A failed write is
  // surfaced once (R30) and is NOT announced to the sync engine.
  function save() {
    state = normalize(state);
    var ok = true;
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }
    catch (e) { ok = false; showToast(t("store.full")); }
    if (ok && window.__orosSyncApi) window.__orosSyncApi.dirty();
    renderSavedLayer();
    renderPlacesList();
    return ok;
  }

  function placeById(id) {
    for (var i = 0; i < state.places.length; i++) {
      if (state.places[i].id === id) return state.places[i];
    }
    return null;
  }

  function isSaved(lat, lon) {
    return !!placeById(placeId(lat, lon));
  }

  // ---------- 3. Map init + tile layers ----------
  var map = null;
  var layerStandard, layerHumanitarian, layerSatellite, layerTopo;

  // Device-local view state (R10: *-prefs, never synced): where the
  // map was last left and which base layer was on.
  var PREFS_KEY = "oros-maps-prefs";
  var prefsTimer = null;
  function readPrefs() {
    try {
      var p = JSON.parse(localStorage.getItem(PREFS_KEY) || "null");
      return (p && typeof p === "object") ? p : {};
    } catch (e) { return {}; }
  }
  function writePrefs(patch) {
    var p = readPrefs();
    Object.keys(patch).forEach(function (k) { p[k] = patch[k]; });
    try { localStorage.setItem(PREFS_KEY, JSON.stringify(p)); } catch (e) { /* view state only */ }
  }
  var savedLayer = null;        // layerGroup for saved-place pins

  function initMap() {
    map = L.map("map", {
      zoomControl: false,
      attributionControl: true
    });
    var prefs = readPrefs();
    var okView = typeof prefs.lat === "number" && typeof prefs.lon === "number" &&
                 typeof prefs.zoom === "number" && isFinite(prefs.lat) &&
                 isFinite(prefs.lon) && isFinite(prefs.zoom) &&
                 Math.abs(prefs.lat) <= 90 && Math.abs(prefs.lon) <= 180;
    if (okView) map.setView([prefs.lat, prefs.lon], Math.max(2, Math.min(19, prefs.zoom)));
    else map.setView(DEFAULT_CENTER, DEFAULT_ZOOM);

    L.control.zoom({ position: "topright", zoomInTitle: t("zoom.in"), zoomOutTitle: t("zoom.out") }).addTo(map);

    // No {s}. subdomains: the OSMF retired a/b/c (tile usage policy).
    layerStandard = L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      crossOrigin: "anonymous",     // CORS tiles: the SW caches only real 200s
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
    });
    layerHumanitarian = L.tileLayer("https://{s}.tile.openstreetmap.fr/hot/{z}/{x}/{y}.png", {
      maxZoom: 19,
      crossOrigin: "anonymous",
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors, <a href="https://www.hotosm.org/">HOT</a>'
    });
    layerSatellite = L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", {
      maxZoom: 19,
      crossOrigin: "anonymous",
      attribution: "Tiles &copy; Esri — Source: Esri, Maxar, Earthstar Geographics"
    });

    // Wave 10A: OpenTopoMap (contour lines, hill shading; OsmAnd's
    // "Topo" style). Its servers stop at zoom 17; Leaflet scales the
    // last tiles up beyond that.
    layerTopo = L.tileLayer("https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      maxNativeZoom: 17,
      crossOrigin: "anonymous",
      attribution: 'Map data &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors, SRTM | Style &copy; <a href="https://opentopomap.org">OpenTopoMap</a> (CC-BY-SA)'
    });

    var byId = { standard: layerStandard, humanitarian: layerHumanitarian,
                 satellite: layerSatellite, topo: layerTopo };
    (byId[prefs.layer] || layerStandard).addTo(map);   // last used, else default

    var layers = {};
    layers[t("layers.standard") || "Standard"] = layerStandard;
    layers[t("layers.humanitarian") || "Humanitarian"] = layerHumanitarian;
    layers[t("layers.satellite") || "Satellite"] = layerSatellite;
    layers[t("layers.topo") || "Topo"] = layerTopo;
    var lc = L.control.layers(layers, null, { position: "topright", collapsed: true }).addTo(map);
    var lt = lc.getContainer().querySelector(".leaflet-control-layers-toggle");
    if (lt) { lt.title = t("layers.title"); lt.setAttribute("aria-label", t("layers.title")); }

    map.on("baselayerchange", function (e) {
      var id = e.layer === layerHumanitarian ? "humanitarian"
             : e.layer === layerSatellite ? "satellite"
             : e.layer === layerTopo ? "topo" : "standard";
      writePrefs({ layer: id });
    });
    map.on("moveend", function () {
      if (navActive) return;            // the follow-camera is not "where I left the map"
      clearTimeout(prefsTimer);
      prefsTimer = setTimeout(function () {
        var c = map.getCenter();
        writePrefs({ lat: +c.lat.toFixed(5), lon: +c.lng.toFixed(5), zoom: map.getZoom() });
      }, 500);
    });

    savedLayer = L.layerGroup().addTo(map);
  }

  // Extra layer labels (added to STRINGS at runtime to keep the
  // table above tidy — same lookup path)
  STRINGS.en["layers.standard"] = "Standard";
  STRINGS.en["layers.humanitarian"] = "Humanitarian";
  STRINGS.en["layers.satellite"] = "Satellite";
  STRINGS.el["layers.standard"] = "Τυπικός";
  STRINGS.el["layers.humanitarian"] = "Ανθρωπιστικός";
  STRINGS.el["layers.satellite"] = "Δορυφορικός";
  STRINGS.en["layers.topo"] = "Topo (contour lines)";
  STRINGS.el["layers.topo"] = "Τοπογραφικός (ισοϋψείς)";
  STRINGS.en["nav.limit"] = "Speed limit {v}";
  STRINGS.el["nav.limit"] = "Όριο ταχύτητας {v}";
  STRINGS.en["nav.nolimit"] = "No speed limit here";
  STRINGS.el["nav.nolimit"] = "Χωρίς όριο ταχύτητας εδώ";
  STRINGS.en["nav.over"] = "Over the speed limit";
  STRINGS.el["nav.over"] = "Πάνω από το όριο ταχύτητας";

  // ---------- 4. Markers + geolocation ----------
  // All icons are inline SVG divIcons — zero PNG assets, so the
  // Leaflet marker-image package is never needed (vendored
  // leaflet.js + leaflet.css only).
  var ICON_PATH = '<svg width="28" height="36" viewBox="0 0 28 36" fill="none" xmlns="http://www.w3.org/2000/svg">' +
    '<path d="M14 0C6.268 0 0 6.268 0 14c0 7.732 14 22 14 22s14-14.268 14-22C28 6.268 21.732 0 14 0z" ' +
    'fill="__COLOR__" stroke="#fff" stroke-width="2"/>' +
    '<circle cx="14" cy="14" r="5" fill="#fff"/></svg>';

  var STAR_PATH = '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2l2.9 6.3 6.9.8-5.1 4.7 1.4 6.8L12 17.2l-6.1 3.4 1.4-6.8L2.2 9.1l6.9-.8L12 2z"/></svg>';
  var ROUTE_PATH = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="6" cy="19" r="2"/><circle cx="18" cy="5" r="2"/><path d="M8 19h5a4 4 0 0 0 0-8H9a4 4 0 0 1 0-8h5"/></svg>';
  var PLUS_PATH = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>';
  var SHARE_PATH = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="18" cy="5" r="2.5"/><circle cx="6" cy="12" r="2.5"/><circle cx="18" cy="19" r="2.5"/><path d="M8.2 10.8l7.6-4.4M8.2 13.2l7.6 4.4"/></svg>';
  var FROM_PATH = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="6" cy="12" r="2.5"/><path d="M10 12h10"/><path d="M16 8l4 4-4 4"/></svg>';

  function makeMarkerIcon(color) {
    return L.divIcon({
      className: "custom-marker",
      html: ICON_PATH.replace("__COLOR__", color),
      iconSize: [28, 36],
      iconAnchor: [14, 36],
      popupAnchor: [0, -18]
    });
  }

  var COLOR_USER = "#6d4aff";
  var COLOR_RESULT = "#d4af37";
  var COLOR_SAVED = "#87cf3e";
  var COLOR_ROUTE_START = "#ecc75f";
  var COLOR_VIA = "#5aa9e6";

  var userMarker = null;
  var userCircle = null;        // accuracy circle (tracked — W1 bugfix)
  var resultMarker = null;
  var userPos = null;           // [lat, lon] once known
  var userPosAt = 0;            // when userPos was last confirmed (ms)
  var POS_FRESH_MS = 2 * 60 * 1000;

  // A position is trusted as a route origin / navigation start only
  // while it is fresh. Older than that → ask the device again.
  function userPosFresh() {
    return !!userPos && Date.now() - userPosAt < POS_FRESH_MS;
  }

  // cb(latLon | null). maximumAge 60s: a fix the device took within
  // the last minute is fine, anything older is re-measured.
  //   quiet = true  → routing / navigation asked: the marker moves,
  //                   but the view, the popup and the result toasts
  //                   are left to the caller.
  function getUserLocation(cb, quiet) {
    if (!("geolocation" in navigator)) {
      if (!quiet) showToast(t("geo.unavailable"));
      cb(null);
      return;
    }
    setGeoLoading(true);
    navigator.geolocation.getCurrentPosition(
      function (pos) {
        setGeoLoading(false);
        if (quiet) {
          userPos = [pos.coords.latitude, pos.coords.longitude];
          userPosAt = Date.now();
          moveUser(pos.coords.latitude, pos.coords.longitude, pos.coords.accuracy);
        } else {
          placeUser(pos.coords.latitude, pos.coords.longitude, pos.coords.accuracy);
          showToast(t("geo.found"));
        }
        cb(userPos);
      },
      function (err) {
        setGeoLoading(false);
        if (!quiet) {
          if (err.code === 1) showToast(t("geo.permission"));
          else showToast(t("geo.unavailable"));
        }
        cb(null);
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 60 * 1000 }
    );
  }

  function placeUser(lat, lon, accuracy) {
    userPos = [lat, lon];
    userPosAt = Date.now();
    map.setView([lat, lon], 14);
    if (userMarker) map.removeLayer(userMarker);
    if (userCircle) map.removeLayer(userCircle);      // W1 bugfix: track the circle
    userMarker = L.marker([lat, lon], { icon: makeMarkerIcon(COLOR_USER) }).addTo(map);
    if (typeof accuracy === "number" && isFinite(accuracy)) {
      userCircle = L.circle([lat, lon], {
        radius: accuracy,
        color: COLOR_USER, fillColor: COLOR_USER,
        fillOpacity: 0.12, weight: 2
      }).addTo(map);
    }
    var b = document.createElement("b");
    b.textContent = t("geo.me");
    userMarker.bindPopup(b).openPopup();
  }

  // Move (or lazily create) the user marker + accuracy circle WITHOUT
  // touching the view or the popup — live navigation calls this on
  // every GPS tick.
  function moveUser(lat, lon, accuracy) {
    if (!userMarker) {
      userMarker = L.marker([lat, lon],
        { icon: navActive ? navArrowIcon() : makeMarkerIcon(COLOR_USER),
          zIndexOffset: 1000 }).addTo(map);
    } else {
      userMarker.setLatLng([lat, lon]);
    }
    var hasAcc = (typeof accuracy === "number" && isFinite(accuracy));
    if (userCircle && hasAcc) {
      userCircle.setLatLng([lat, lon]);
      userCircle.setRadius(accuracy);
    } else if (userCircle) {
      userCircle.setLatLng([lat, lon]);
    } else if (hasAcc) {
      userCircle = L.circle([lat, lon], {
        radius: accuracy,
        color: COLOR_USER, fillColor: COLOR_USER,
        fillOpacity: 0.12, weight: 2
      }).addTo(map);
    }
  }

  function setGeoLoading(loading) {
    var btn = $("geo-btn");
    if (!btn) return;
    if (loading) { btn.classList.add("loading"); showToast(t("geo.searching")); }
    else btn.classList.remove("loading");
  }
  
    // ---------- 10. Search autocomplete (Photon) ----------
  // weather.js pattern: tokened stale-response discard, 300ms
  // debounce, AC_MIN = 3 characters, keyboard navigation.
  var AC_MIN = 3;
  var AC_DEBOUNCE_MS = 300;
  var acSeq = 0;                // token — stale responses are dropped
  var acTimer = null;
  var acResults = [];           // current dataset
  var acIndex = -1;             // keyboard-selected row

  function acRenderLoading() {
    var host = $("search-results");
    host.innerHTML = "";
    var d = document.createElement("div");
    d.className = "sr-loading";
    d.textContent = "…";
    host.appendChild(d);
    host.hidden = false;
    // The rows are gone: a keyboard selection must not keep pointing
    // at the PREVIOUS query's results.
    acResults = [];
    acIndex = -1;
  }

  // A failed request is not "no results" — say what happened.
  function acRenderError() {
    var host = $("search-results");
    host.innerHTML = "";
    var d = document.createElement("div");
    d.className = "sr-empty";
    d.textContent = t("search.err");
    host.appendChild(d);
    host.hidden = false;
    acResults = [];
    acIndex = -1;
  }

  function acRenderEmpty() {
    var host = $("search-results");
    host.innerHTML = "";
    var d = document.createElement("div");
    d.className = "sr-empty";
    d.textContent = t("search.empty");
    host.appendChild(d);
    host.hidden = false;
  }

  function acClose() {
    $("search-results").hidden = true;
    acIndex = -1;
  }

  function acSelClass() {
    var rows = $("search-results").querySelectorAll(".sr-item");
    for (var i = 0; i < rows.length; i++) {
      rows[i].classList.toggle("sel", i === acIndex);
    }
    if (acIndex >= 0 && rows[acIndex]) rows[acIndex].scrollIntoView({ block: "nearest" });
  }

  // One result row (search bar and planner). The icon says what the
  // row is: a place, "My location", a saved place, a recent one or
  // typed coordinates.
  var HIT_ICON = {
    place:  '<path d="M21 10c0 7-9 13-9 13S3 17 3 10a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/>',
    me:     '<circle cx="12" cy="12" r="4"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/>',
    saved:  '<path d="M12 2l2.9 6.3 6.9.8-5.1 4.7 1.4 6.8L12 17.2l-6.1 3.4 1.4-6.8L2.2 9.1l6.9-.8L12 2z"/>',
    recent: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    coords: '<path d="M4 9h16M4 15h16M10 3L8 21M16 3l-2 18"/>'
  };
  function buildHitRow(hit) {
    var row = document.createElement("div");
    row.className = "sr-item";

    var icon = document.createElement("span");
    icon.className = "sr-icon";
    icon.innerHTML =
      '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
      (HIT_ICON[hit.kind] || HIT_ICON.place) + '</svg>';
    row.appendChild(icon);

    var body = document.createElement("div");
    body.className = "sr-body";
    var name = document.createElement("div");
    name.className = "sr-name";
    name.textContent = hit.name;
    body.appendChild(name);
    if (hit.sub) {
      var sub = document.createElement("div");
      sub.className = "sr-sub";
      sub.textContent = hit.sub;
      body.appendChild(sub);
    }
    row.appendChild(body);
    return row;
  }

  function acRender(list) {
    acResults = list;
    acIndex = -1;
    var host = $("search-results");
    host.innerHTML = "";

    list.forEach(function (hit) {
      var row = buildHitRow(hit);
      row.addEventListener("mousedown", function (e) {
        // mousedown (not click): fires before the input blurs
        e.preventDefault();
        pickResult(hit);
      });
      host.appendChild(row);
    });
    host.hidden = list.length === 0;
    if (list.length === 0) acRenderEmpty();
  }

  // Photon request. The UI language is sent as `lang`; if the
  // server rejects it (HTTP 400 — language not offered by this
  // instance) the SAME query is retried once without it (local
  // names) and the session stops sending it.
  var photonLangOk = true;
  //   bias = true → prefer results near the current map view
  //   (interactive search). Deep-link geocoding passes false: an
  //   address from another app has nothing to do with the view.
  function photonGet(query, limit, bias) {
    var near = "";
    if (bias && map) {
      var c = map.getCenter();
      near = "&lat=" + c.lat.toFixed(4) + "&lon=" + c.lng.toFixed(4);
    }
    return photonFetch("api/?limit=" + limit + near + "&q=" + encodeURIComponent(query));
  }

  // path = "api/?…" (search) or "reverse?…" (address of a point).
  function photonFetch(path) {
    function url(withLang) {
      return "https://photon.komoot.io/" + path + (withLang ? "&lang=" + LANG : "");
    }
    return fetch(url(photonLangOk))
      .then(function (r) {
        if (r.status === 400 && photonLangOk) {
          photonLangOk = false;
          return fetch(url(false));
        }
        return r;
      })
      .then(function (r) { if (!r.ok) throw 0; return r.json(); });
  }

  // MX-4: a point picked on the map gets the address under it. Until
  // it arrives (or if it never does) it keeps "Point on map".
  // `place` is updated IN PLACE: it is the object the plan holds.
  function nameByReverse(place, after) {
    if (!navigator.onLine || !place) return;
    photonFetch("reverse?lat=" + place.lat.toFixed(6) + "&lon=" + place.lon.toFixed(6) + "&limit=1")
      .then(function (json) {
        var f = json && json.features && json.features[0];
        if (!f) return;
        var h = photonHit(f);
        if (!h.name || h.name === "?") return;
        place.name = h.name;
        place.sub = h.sub;
        refreshRouteLabels();
        if (after) after();
      })
      .catch(function () { /* keeps "Point on map" */ });
  }

  // Coordinates typed into a search field: "37.9755, 23.7348",
  // "37.9755 23.7348" or "37°58'32"N 23°44'05"E". Decimals are
  // required in the plain form, so "38 23" stays a text search.
  var DMS_RE = /^\s*(\d{1,2})\s*[°\s]\s*(?:(\d{1,2})\s*['′\s]\s*)?(?:(\d{1,2}(?:\.\d+)?)\s*["″]?\s*)?([NS])[,;\s]+(\d{1,3})\s*[°\s]\s*(?:(\d{1,2})\s*['′\s]\s*)?(?:(\d{1,2}(?:\.\d+)?)\s*["″]?\s*)?([EW])\s*$/i;
  function parseCoords(str) {
    var lat, lon;
    var m = /^\s*(-?\d{1,2}\.\d+)\s*[,;\s]\s*(-?\d{1,3}\.\d+)\s*$/.exec(str || "");
    if (m) {
      lat = parseFloat(m[1]); lon = parseFloat(m[2]);
    } else {
      var d = DMS_RE.exec(str || "");
      if (!d) return null;
      lat = (+d[1] + (+d[2] || 0) / 60 + (+d[3] || 0) / 3600) * (/s/i.test(d[4]) ? -1 : 1);
      lon = (+d[5] + (+d[6] || 0) / 60 + (+d[7] || 0) / 3600) * (/w/i.test(d[8]) ? -1 : 1);
    }
    if (!isFinite(lat) || !isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
    return { lat: lat, lon: lon, name: lat.toFixed(5) + ", " + lon.toFixed(5),
             sub: t("coords"), kind: "coords" };
  }

  // Photon feature → { name, sub, lat, lon }. An address has no
  // `name`: its title is "street number", not the city.
  function photonHit(f) {
    var p = (f && f.properties) || {};
    var c = (f && f.geometry && f.geometry.coordinates) || [];
    var addr = [p.street, p.housenumber].filter(Boolean).join(" ");
    var subParts = [p.city || p.town || p.village || p.county,
                    p.state, p.country].filter(Boolean);
    var name = p.name || addr || subParts[0] || "?";
    if (p.name && addr && addr !== p.name) subParts.unshift(addr);
    if (!p.name && !addr) subParts.shift();        // the city became the title
    return { name: name, sub: subParts.join(", "),
             lat: parseFloat(c[1]), lon: parseFloat(c[0]) };
  }

  //   pickFirst = true → Enter was pressed before any list existed:
  //   the first result is opened as soon as it arrives.
  function acFetch(query, pickFirst) {
    if (!navigator.onLine) { showToast(t("search.offline")); return; }
    var my = ++acSeq;
    acRenderLoading();

    photonGet(query, 6, true)
      .then(function (json) {
        if (my !== acSeq) return;                 // stale — discard
        var hits = (json.features || []).map(photonHit)
          .filter(function (h) { return isFinite(h.lat) && isFinite(h.lon); });
        if (pickFirst && hits.length) { acResults = hits; pickResult(hits[0]); return; }
        acRender(hits);
      })
      .catch(function () {
        if (my !== acSeq) return;
        acRenderError();
      });
  }

  // Pick a result: drop a marker, popup with star / route actions.
  function pickResult(hit) {
    clearTimeout(acTimer);      // a pending debounce must not reopen the list
    acSeq++;                    // …nor an in-flight response
    acClose();
    $("search").value = hit.name;
    $("search-clear").hidden = false;
    pushRecent(hit);
    placeResult(hit.lat, hit.lon, hit.name, hit.sub);
  }

  function placeResult(lat, lon, name, sub) {
    if (resultMarker) map.removeLayer(resultMarker);
    resultMarker = L.marker([lat, lon], { icon: makeMarkerIcon(COLOR_RESULT) }).addTo(map);
    map.flyTo([lat, lon], Math.max(map.getZoom(), 15));
    bindPlacePopup(resultMarker, { lat: lat, lon: lon, name: name, sub: sub });
    resultMarker.openPopup();
  }

  // Shared popup builder — DOM-built (user text never touches HTML).
  function bindPlacePopup(marker, place) {
    var wrap = document.createElement("div");

    var title = document.createElement("b");
    title.textContent = place.name;
    wrap.appendChild(title);
    if (place.sub) {
      var subEl = document.createElement("div");
      subEl.style.cssText = "font-size:11.5px;color:var(--text-dim);margin-top:2px;";
      subEl.textContent = place.sub;
      wrap.appendChild(subEl);
    }

    var actions = document.createElement("div");
    actions.className = "pop-actions";

    var star = document.createElement("button");
    star.type = "button";
    star.innerHTML = STAR_PATH + "<span></span>";
    var starSpan = star.querySelector("span");
    function paintStar() {
      var on = isSaved(place.lat, place.lon);
      star.classList.toggle("starred", on);
      starSpan.textContent = on ? t("places.remove") : t("places.save");
    }
    paintStar();
    star.addEventListener("click", function () {
      if (isSaved(place.lat, place.lon)) removePlace(place.lat, place.lon);
      else addPlace(place);
      paintStar();
    });
    actions.appendChild(star);

    var route = document.createElement("button");
    route.type = "button";
    route.innerHTML = ROUTE_PATH + "<span></span>";
    route.querySelector("span").textContent = t("pop.route");
    route.addEventListener("click", function () {
      map.closePopup();
      startRouteTo(place);
    });
    actions.appendChild(route);

    var from = document.createElement("button");
    from.type = "button";
    from.innerHTML = FROM_PATH + "<span></span>";
    from.querySelector("span").textContent = t("pop.from");
    from.addEventListener("click", function () {
      map.closePopup();
      startRouteFrom(place);
    });
    actions.appendChild(from);

    var share = document.createElement("button");
    share.type = "button";
    share.innerHTML = SHARE_PATH + "<span></span>";
    share.querySelector("span").textContent = t("share");
    share.addEventListener("click", function () {
      map.closePopup();
      sharePoint(place);
    });
    actions.appendChild(share);

    // Wave 10C: put a saved place in a favourite group.
    var F = favApi();
    if (F) {
      var grp = document.createElement("button");
      grp.type = "button";
      grp.className = "pop-grp";
      grp.innerHTML = F.ICON + "<span></span>";
      grp.querySelector("span").textContent = F.label;
      grp.hidden = !isSaved(place.lat, place.lon);
      star.addEventListener("click", function () { grp.hidden = !isSaved(place.lat, place.lon); });
      grp.addEventListener("click", function () {
        map.closePopup();
        F.pick({ id: placeId(place.lat, place.lon), name: place.name });
      });
      actions.appendChild(grp);
    }

    wrap.appendChild(actions);
    marker.unbindPopup();
    marker.bindPopup(wrap, { maxWidth: 280 });
  }

  // ---------- 11. Routing (OSRM) ----------
  var PROFILE_OSRM = { car: "driving", bike: "bike", foot: "foot" };
  // One endpoint per profile — the single place to repoint a
  // profile to a different routing server. The OSRM demo server
  // only routes cars (it ignores the profile segment), so Bike and
  // Walk use the FOSSGIS OSRM instances, which keep one graph per
  // profile behind a path prefix. Same OSRM API, same response.
  var ROUTER_BASE = {
    car:  "https://router.project-osrm.org/route/v1/driving/",
    bike: "https://routing.openstreetmap.de/routed-bike/route/v1/driving/",
    foot: "https://routing.openstreetmap.de/routed-foot/route/v1/driving/"
  };
  var RC = window.OrosMapsRoute;     // route-core.js (wave 6)
  var TC = window.OrosMapsTools;     // tools-core.js (wave 10A)
  var ROUTE_PREFS_KEY = "oros-maps-route-prefs";   // device-local { avoid }
  var routeAlts = [];           // OSRM routes of the last request (alternatives)
  var routeAltIdx = 0;          // the one in use
  var altLines = [];            // grey lines of the others (tap = switch)
  var altsToldOnce = false;
  var routeSeq = 0;             // token — stale / cancelled responses are dropped
  var routeProfile = "car";
  var routeLine = null;
  var routeFrom = null;         // { lat, lon, name, sub } | { me:true, … } | null
  var routeTo = null;           // { lat, lon, name, sub } | null
  var routeVias = [];           // stops in between (≤ MAX_VIAS; null = row not chosen yet)
  var routeStartMarker = null;
  var routeEndMarker = null;
  var routeViaMarkers = [];
  var lastSteps = [];          // OSRM steps for the active route
  var lastDist = 0;            // total distance (m)
  var lastDur = 0;             // total duration (s)
  var pickMode = null;         // null | planner slot index (map pick)
  var routeCoords = [];        // route geometry [[lon, lat], …] (deviation check)
  var routeCum = [];           // cumulative metres along routeCoords, per vertex
  var stepAlong = [];          // along-route metres of each step's maneuver
  var navAlong = 0;            // metres of route already covered (live nav)
  var navActive = false;       // live navigation on/off
  var navWatchId = null;       // geolocation.watchPosition handle
  var navCurStepIdx = 0;       // step currently traversed
  var navSpokenFar = false;    // 350m pre-announcement flag (per step)
  var navRerouteAt = 0;        // last re-route timestamp (debounce)
  var navMuted = false;         // voice guidance muted

  // Wave 5: last-known-route persistence + tile cache bookkeeping
  var ROUTE_STORAGE_KEY = "oros-maps-route";
  var TILE_CACHE_NAME = "oros-map-tiles";   // MUST match sw.js
  var restoring = false;     // true while restoreRoute() repaints — blocks calcRoute()

  // Localized number / units (EL: decimal comma, Greek unit labels).
  function fmtNum(x, dec) {
    var v = x.toFixed(dec);
    return LANG === "el" ? v.replace(".", ",") : v;
  }
  function fmtDist(m) {
    if (m < 1000) return Math.round(m) + " " + t("u.m");
    return fmtNum(m / 1000, m < 10000 ? 1 : 0) + " " + t("u.km");
  }
  function fmtTime(sec) {
    var min = Math.round(sec / 60);
    if (min < 60) return min + " " + t("u.min");
    return Math.floor(min / 60) + " " + t("u.h") + " " + (min % 60) + " " + t("u.min");
  }
  // Distance as it should be SPOKEN: rounded, with a unit word.
  function spokenDist(m) {
    if (m >= 1000) return fmtNum(m / 1000, m < 10000 ? 1 : 0) + " " + t("say.km");
    var r = m >= 100 ? Math.round(m / 50) * 50 : Math.max(10, Math.round(m / 10) * 10);
    return r + " " + t("say.m");
  }

  function setRouteProfile(p) {
    routeProfile = p;
    ["car", "bike", "foot"].forEach(function (k) {
      $("rp-" + k).classList.toggle("active", k === p);
    });
    if (routeFrom && routeTo && !restoring) calcRoute();   // re-route under new mode
  }

  // The route bar is visible exactly when a route is painted; the
  // body class lets the stylesheet lift the controls above it.
  function showRouteBar(on) {
    $("route-bar").hidden = !on;
    document.body.classList.toggle("has-route", !!on);
  }

  function clearRoute() {
    routeSeq++;                 // an in-flight response must not repaint
    if (routeLine) { map.removeLayer(routeLine); routeLine = null; }
    routeAlts = []; routeAltIdx = 0; paintAltLines();
    routeFrom = routeTo = null;
    routeVias = [];
    paintRouteMarkers();
    lastSteps = []; lastDist = 0; lastDur = 0;
    routeCoords = [];
    buildRouteIndex();
    cancelPick();
    if (navActive) stopNavigation();
    showRouteBar(false);
    $("maneuvers").hidden = true;
    $("steps-btn").classList.remove("on");
    $("maneuvers-list").innerHTML = "";
    if (planOpen) closePlanner();
    try { localStorage.removeItem(ROUTE_STORAGE_KEY); } catch (e) { /* noop */ }
  }

  // "My location" as a plan slot. Its lat/lon are filled when a
  // route is asked for (resolveMe) — never a stale copy from earlier.
  function meSlot(pos) {
    var sl = { me: true, name: t("geo.me"), sub: "" };
    if (pos) { sl.lat = pos[0]; sl.lon = pos[1]; }
    return sl;
  }

  // Every point of the trip, in order: start, chosen stops, end.
  function routePoints() {
    return [routeFrom].concat(routeVias.filter(Boolean), [routeTo]);
  }

  // Entry: route TO `dest` (popup "Route", "Go here"). From the
  // user's location, unless the planner is open: then the start and
  // stops the user is editing stay as they are.
  function startRouteTo(dest) {
    routeTo = dest;
    if (!planOpen || !routeFrom) { routeFrom = meSlot(null); }
    if (!planOpen) routeVias = [];
    planChanged();
  }

  // Entry: route FROM `place` (popup "From here", "Start here"). With
  // a destination already set the route is recalculated; otherwise
  // the planner opens on "To".
  function startRouteFrom(place) {
    routeFrom = place;
    if (routeTo) { planChanged(); return; }
    openPlanner(slotCount() - 1);
  }

  // Markers follow the plan, also BEFORE a route exists, so every
  // chosen point is visible while the rest is chosen.
  function paintRouteMarkers() {
    if (!map) return;
    if (routeFrom && isFinite(routeFrom.lat)) {
      if (!routeStartMarker) {
        routeStartMarker = L.marker([routeFrom.lat, routeFrom.lon],
          { icon: makeMarkerIcon(COLOR_ROUTE_START) }).addTo(map);
      } else {
        routeStartMarker.setLatLng([routeFrom.lat, routeFrom.lon]);
      }
    } else if (routeStartMarker) {
      map.removeLayer(routeStartMarker); routeStartMarker = null;
    }
    routeViaMarkers.forEach(function (mk) { map.removeLayer(mk); });
    routeViaMarkers = [];
    routeVias.forEach(function (v) {
      if (!v || !isFinite(v.lat)) return;
      routeViaMarkers.push(L.marker([v.lat, v.lon],
        { icon: makeMarkerIcon(COLOR_VIA) }).addTo(map));
    });
    if (routeTo && isFinite(routeTo.lat)) {
      if (!routeEndMarker) {
        routeEndMarker = L.marker([routeTo.lat, routeTo.lon],
          { icon: makeMarkerIcon(COLOR_RESULT) }).addTo(map);
      } else {
        routeEndMarker.setLatLng([routeTo.lat, routeTo.lon]);
      }
      // Re-bound on every change: the marker is reused, the popup
      // (title + star target) must follow the current destination.
      if (routeTo.name) bindPlacePopup(routeEndMarker, routeTo);
      else routeEndMarker.unbindPopup();
    } else if (routeEndMarker) {
      map.removeLayer(routeEndMarker); routeEndMarker = null;
    }
  }

  // A place name arrived later (reverse geocoding): repaint where it
  // shows, and keep the offline snapshot in step.
  function refreshRouteLabels() {
    paintPlanValues();
    if (routeTo && routeEndMarker) {
      if (routeTo.name) bindPlacePopup(routeEndMarker, routeTo);
    }
    if (routeLine) saveRoute();
  }

  // Fill every "My location" slot with a position: a fresh fix, else
  // a new one, else the last known one (said out loud). No location
  // at all → those slots are emptied and the planner opens on the
  // first empty one: a route never starts from a made-up point
  // (MX-3, it used to start from the map centre, named "·").
  // During live navigation the slots already carry the GPS position.
  function resolveMe(cb) {
    var pts = routePoints();
    var needs = pts.some(function (p) { return p && p.me; });
    if (!needs || navActive) { cb(true); return; }
    function use(pos) {
      if (routeFrom && routeFrom.me) routeFrom = meSlot(pos);
      if (routeTo && routeTo.me) routeTo = meSlot(pos);
      routeVias = routeVias.map(function (v) { return v && v.me ? meSlot(pos) : v; });
      cb(true);
    }
    if (userPosFresh()) { use(userPos); return; }
    getUserLocation(function (pos) {
      if (pos) { use(pos); return; }
      if (userPos) { showToast(t("route.fromLast")); use(userPos); return; }
      if (routeFrom && routeFrom.me) routeFrom = null;
      if (routeTo && routeTo.me) routeTo = null;
      routeVias = routeVias.map(function (v) { return v && v.me ? null : v; });
      paintRouteMarkers();
      openPlanner(firstEmptySlot());
      showToast(t("plan.needstart"));
      cb(false);
    }, true);
  }

  // One step list for the whole trip. Every leg but the last ends
  // with an "arrive" step: it is marked with the stop's number, so
  // the panel, the HUD and the voice say "Arrive at stop 2", and a
  // re-route knows which stops are already behind.
  function joinLegs(legs) {
    var out = [];
    (legs || []).forEach(function (leg, i) {
      (leg.steps || []).forEach(function (st) {
        if (i < legs.length - 1 && st.maneuver && st.maneuver.type === "arrive") st.via = i + 1;
        out.push(st);
      });
    });
    return out;
  }

  //   silent = true → the caller has just shown its own toast; do not
  //   replace it with "Calculating…".
  //   onDone(ok) → called once the route is painted (true) or failed
  //   (false). Not called for a request that a newer one replaced.
  function calcRoute(silent, onDone) {
    function done(ok) { if (typeof onDone === "function") onDone(ok); }
    if (!routeFrom || !routeTo) { done(false); return; }
    if (!navigator.onLine) { showToast(t("route.offline")); done(false); return; }
    var my = ++routeSeq;
    resolveMe(function (ok) {
      if (my !== routeSeq) return;          // cleared or replaced meanwhile
      if (!ok || !routeFrom || !routeTo) { done(false); return; }
      fetchRoute(my, silent, done);
    });
  }

  // The "avoid" choice is the device's own (never synced): what one
  // phone avoids says nothing about another trip.
  function readAvoid() {
    try {
      var p = JSON.parse(localStorage.getItem(ROUTE_PREFS_KEY) || "{}");
      return p && RC.AVOID.indexOf(p.avoid) >= 0 ? p.avoid : "";
    } catch (e) { return ""; }
  }
  function writeAvoid(v) {
    try { localStorage.setItem(ROUTE_PREFS_KEY, JSON.stringify({ avoid: RC.AVOID.indexOf(v) >= 0 ? v : "" })); }
    catch (e) { /* full storage: a preference, not data */ }
  }

  //   plain = true → no "avoid" (the server refused it once)
  function fetchRoute(my, silent, done, plain) {
    // Feedback while the server works (a re-route has its own toast)
    if (!navActive && !silent && !plain) showToast(t("route.calculating"));
    paintRouteMarkers();

    var avoid = plain ? "" : RC.avoidFor(routeProfile, readAvoid());
    var url = RC.routeUrl(ROUTER_BASE[routeProfile], routePoints(),
      { alternatives: !navActive, avoid: avoid, profile: routeProfile });

    fetch(url)
      .then(function (r) {
        if (!r.ok) { var er = new Error("http"); er.status = r.status; throw er; }
        return r.json();
      })
      .then(function (json) {
        // Stale (a newer request started) or cancelled (route cleared)
        if (my !== routeSeq || !routeFrom || !routeTo) return;
        if (!json || !json.routes || !json.routes.length) throw 0;
        routeAlts = navActive ? [json.routes[0]] :
          RC.alternatives(json.routes).map(function (a) { return json.routes[a.i]; });
        if (!routeAlts.length) throw 0;
        routeAltIdx = 0;
        applyRoute(routeAlts[0], !navActive);

        // Fresh route during live nav → restart step tracking
        if (navActive) resetNavProgress();
        else rememberRoute();
        if (plain) showToast(t("route.avoid.nosrv"));
        else if (routeAlts.length > 1 && !altsToldOnce && !navActive) {
          altsToldOnce = true;
          showToast(t("route.alts.hint").replace("{n}", routeAlts.length - 1));
        }
        done(true);
      })
      .catch(function (err) {
        if (my !== routeSeq) return;      // superseded or cancelled — stay quiet
        // A server that does not know the "avoid" class answers 400:
        // ask once more without it, and say so.
        if (avoid && err && err.status >= 400 && err.status < 500) {
          fetchRoute(my, true, done, true);
          return;
        }
        // Transient OSRM failure: keep the last GOOD route painted and
        // the offline snapshot intact — never wipe data on a fetch error.
        showToast(t("route.err"));
        done(false);
      });
  }

  // Paint one OSRM route as THE route: line, bar, steps, snapshot.
  // fit = zoom to it (never during live navigation: the next GPS
  // tick owns the view).
  function applyRoute(r0, fit) {
    if (routeLine) map.removeLayer(routeLine);
    routeLine = L.geoJSON(r0.geometry, {
      style: { color: "#6d4aff", weight: 5, opacity: 0.9, lineCap: "round" }
    }).addTo(map);
    routeLine.getLayers()[0].getElement && routeLine.getLayers()[0].getElement().classList.add("route-line");
    paintAltLines();
    paintRouteMarkers();

    if (fit) {
      var b = routeLine.getBounds();
      altLines.forEach(function (l) { b.extend(l.getBounds()); });
      map.fitBounds(b, { padding: [48, 48] });
    }

    lastSteps = joinLegs(r0.legs);
    lastDist = r0.distance;
    lastDur = r0.duration;
    paintRouteSummary();
    showRouteBar(true);

    routeCoords = (r0.geometry && r0.geometry.coordinates) || [];
    buildRouteIndex();
    limitReset();

    // Render maneuvers if panel is open or route just started
    renderManeuvers();
    saveRoute();
  }

  // The other routes in grey, under the chosen one; a tap switches.
  function paintAltLines() {
    altLines.forEach(function (l) { map.removeLayer(l); });
    altLines = [];
    if (navActive) return;
    routeAlts.forEach(function (r, i) {
      if (i === routeAltIdx) return;
      var l = L.geoJSON(r.geometry, {
        style: { color: "#8a8fa0", weight: 6, opacity: 0.75, dashArray: "1 9", lineCap: "round" }
      }).addTo(map);
      l.on("click", function (e) {
        if (e && e.originalEvent) L.DomEvent.stop(e.originalEvent);
        selectAlt(i);
      });
      var el = l.getLayers()[0].getElement && l.getLayers()[0].getElement();
      if (el) { el.classList.add("route-alt"); el.setAttribute("data-alt", String(i)); }
      l.bringToBack();
      altLines.push(l);
    });
  }

  function selectAlt(i) {
    if (!routeAlts[i] || i === routeAltIdx || navActive) return;
    routeAltIdx = i;
    applyRoute(routeAlts[i], false);
  }

  // "1 h 5 min · 14:32": the arrival time moves with the clock, so
  // the bar is repainted every half minute while a route is shown.
  function paintRouteSummary() {
    $("route-dist").textContent = fmtDist(lastDist);
    var at = RC.clock(Date.now(), lastDur);
    $("route-time").textContent = fmtTime(lastDur) + " · " + at;
    $("route-time").title = t("route.arrive").replace("{t}", at);
    var ex = $("route-extras-eta");
    if (ex) ex.textContent = t("route.arrive").replace("{t}", at) + " · " + fmtTime(lastDur) + " · " + fmtDist(lastDist);
  }

  // ---------- 11b. Recent places (device-local, never synced) ----------
  var RECENT_KEY = "oros-maps-recent";
  var RECENT_MAX = 10;

  function readRecent() {
    try {
      var a = JSON.parse(localStorage.getItem(RECENT_KEY) || "[]");
      if (!Array.isArray(a)) return [];
      return a.filter(function (p) {
        return p && typeof p.name === "string" &&
          typeof p.lat === "number" && typeof p.lon === "number" &&
          isFinite(p.lat) && isFinite(p.lon);
      });
    } catch (e) { return []; }
  }
  function pushRecent(p) {
    if (!p || p.me || !isFinite(p.lat) || !isFinite(p.lon)) return;
    var id = placeId(p.lat, p.lon);
    var list = readRecent().filter(function (q) { return placeId(q.lat, q.lon) !== id; });
    list.unshift({ name: String(p.name || t("route.ptmap")).slice(0, 120),
                   sub: String(p.sub || "").slice(0, 200), lat: p.lat, lon: p.lon });
    try { localStorage.setItem(RECENT_KEY, JSON.stringify(list.slice(0, RECENT_MAX))); }
    catch (e) { /* full storage: recents are a convenience, not data */ }
  }
  // Destination last, so it ends up first in the list.
  function rememberRoute() {
    if (routeFrom && !routeFrom.me) pushRecent(routeFrom);
    routeVias.forEach(function (v) { if (v) pushRecent(v); });
    pushRecent(routeTo);
  }

  // ---------- 11c. Route planner (From / stops / To) ----------
  // Slots: 0 = routeFrom, 1…n = routeVias, last = routeTo. Each row
  // has a search field (Photon + saved + recent + "My location" +
  // coordinates) and a "choose on map" button.
  var MAX_VIAS = 3;
  var planOpen = false;
  var planField = -1;           // slot whose field has the focus
  var planSeq = 0;              // token — stale responses are dropped
  var planTimer = null;
  var planResults = [];
  var planIndex = -1;

  function slotCount() { return routeVias.length + 2; }
  function slotGet(i) {
    if (i === 0) return routeFrom;
    if (i === slotCount() - 1) return routeTo;
    return routeVias[i - 1] || null;
  }
  function slotSet(i, v) {
    if (i === 0) routeFrom = v;
    else if (i === slotCount() - 1) routeTo = v;
    else routeVias[i - 1] = v;
  }
  function slotKind(i) {
    return i === 0 ? "from" : i === slotCount() - 1 ? "to" : "via";
  }
  function slotLabel(i) {
    return slotKind(i) === "via" ? t("plan.via").replace("{n}", i) : t("plan." + slotKind(i));
  }
  function firstEmptySlot() {
    for (var i = 0; i < slotCount(); i++) if (!slotGet(i)) return i;
    return -1;
  }
  function slotInput(i) {
    return document.querySelector('#plan-rows [data-slot="' + i + '"] input');
  }

  function openPlanner(focusSlot) {
    if (navActive) return;
    // A fresh plan starts from the user's location.
    if (!routeFrom && !routeTo && !routeLine) routeFrom = meSlot(null);
    planOpen = true;
    $("planner").hidden = false;
    document.body.classList.add("planning");
    $("plan-btn").classList.add("on");
    acClose();
    renderPlanner();
    paintRouteMarkers();
    var f = typeof focusSlot === "number" && focusSlot >= 0 ? focusSlot : firstEmptySlot();
    if (f >= 0 && slotInput(f)) slotInput(f).focus();
  }

  function closePlanner() {
    planOpen = false;
    planField = -1;
    planSeq++;
    clearTimeout(planTimer);
    cancelPick();
    $("planner").hidden = true;
    $("plan-results").hidden = true;
    document.body.classList.remove("planning");
    $("plan-btn").classList.remove("on");
    // Nothing routed yet: the half-made plan goes with the panel.
    if (!routeLine) { routeFrom = routeTo = null; routeVias = []; }
    else routeVias = routeVias.filter(Boolean);       // empty stop rows go
    paintRouteMarkers();
  }

  // A slot changed: repaint, then route as soon as start and
  // destination are both known; else move on to the next empty slot.
  function planChanged() {
    paintRouteMarkers();
    if (planOpen) renderPlanner();
    if (routeFrom && routeTo) { calcRoute(); return; }
    var f = firstEmptySlot();
    if (planOpen && f >= 0 && slotInput(f)) slotInput(f).focus();
  }

  // The panel's height decides where the route bar sits (desktop).
  function updatePlanHeight() {
    var el = $("planner");
    if (!el || el.hidden) return;
    document.documentElement.style.setProperty("--plan-h", el.offsetHeight + "px");
  }

  function renderPlanner() {
    var host = $("plan-rows");
    if (!host) return;
    host.innerHTML = "";
    for (var i = 0; i < slotCount(); i++) host.appendChild(buildPlanRow(i));
    var full = routeVias.length >= MAX_VIAS;
    $("plan-addstop").disabled = full;
    $("plan-addstop").title = t(full ? "plan.maxstops" : "plan.addstop");
    updatePlanHeight();
  }

  // Field text = the slot's name, except in the field being typed in.
  function paintPlanValues() {
    if (!planOpen) return;
    for (var i = 0; i < slotCount(); i++) {
      var inp = slotInput(i);
      if (inp && inp !== document.activeElement) {
        inp.value = slotGet(i) ? slotGet(i).name : "";
      }
    }
  }

  var PICK_ICON = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="2" fill="currentColor"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/></svg>';
  var REMOVE_ICON = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>';

  function buildPlanRow(i) {
    var kind = slotKind(i), sl = slotGet(i);
    var row = document.createElement("div");
    row.className = "plan-row";
    row.setAttribute("data-slot", String(i));

    var dot = document.createElement("span");
    dot.className = "plan-dot " + kind;
    row.appendChild(dot);

    var inp = document.createElement("input");
    inp.type = "search";
    inp.className = "plan-in";
    inp.autocomplete = "off";
    inp.spellcheck = false;
    inp.maxLength = 120;
    inp.placeholder = t("plan." + kind + ".ph");
    inp.setAttribute("aria-label", slotLabel(i));
    inp.value = sl ? sl.name : "";
    inp.addEventListener("focus", function () {
      planField = i;
      inp.select();
      planQuery(i, "");
    });
    inp.addEventListener("input", function () { planQuery(i, inp.value); });
    inp.addEventListener("keydown", function (e) { planKey(e, i, inp); });
    inp.addEventListener("blur", function () {
      // let mousedown on a result run first (preventDefault keeps focus)
      setTimeout(function () {
        if (inp === document.activeElement) return;
        var s2 = slotGet(i);
        if (inp.isConnected) inp.value = s2 ? s2.name : "";   // typed, not chosen → back
        var pl = $("planner");
        if (!pl.contains(document.activeElement)) {
          $("plan-results").hidden = true;
          updatePlanHeight();
        }
      }, 150);
    });
    row.appendChild(inp);

    var pick = document.createElement("button");
    pick.type = "button";
    pick.className = "plan-pick" + (pickMode === i ? " on" : "");
    pick.title = t("plan.pickmap");
    pick.setAttribute("aria-label", t("plan.pickmap") + " · " + slotLabel(i));
    pick.innerHTML = PICK_ICON;
    pick.addEventListener("click", function () { togglePick(i); });
    row.appendChild(pick);

    if (kind === "via") {
      var rm = document.createElement("button");
      rm.type = "button";
      rm.className = "plan-rm";
      rm.title = t("plan.rmstop");
      rm.setAttribute("aria-label", t("plan.rmstop") + " · " + slotLabel(i));
      rm.innerHTML = REMOVE_ICON;
      rm.addEventListener("click", function () {
        cancelPick();
        routeVias.splice(i - 1, 1);
        planChanged();
      });
      row.appendChild(rm);
    } else if (routeVias.length) {
      // keeps every field the same width as the stop rows'
      var gap = document.createElement("span");
      gap.className = "plan-gap";
      row.appendChild(gap);
    }
    return row;
  }

  function addStop() {
    if (routeVias.length >= MAX_VIAS) { showToast(t("plan.maxstops")); return; }
    cancelPick();
    routeVias.push(null);
    renderPlanner();
    var inp = slotInput(routeVias.length);       // the new row (slot n)
    if (inp) inp.focus();
  }

  // Reverse the whole trip: start ⇄ destination, stops in reverse.
  function swapPlan() {
    cancelPick();
    var pts = [routeFrom].concat(routeVias, [routeTo]).reverse();
    routeFrom = pts[0];
    routeTo = pts[pts.length - 1];
    routeVias = pts.slice(1, -1);
    planChanged();
  }

  // Suggestions for an empty or short query: "My location", saved
  // places, recent places. For a longer one, the matching saved and
  // recent places come first, then Photon.
  function localHits(q, slot) {
    var ql = q.toLowerCase();
    function match(p) {
      return !ql || String(p.name).toLowerCase().indexOf(ql) >= 0 ||
        String(p.sub || "").toLowerCase().indexOf(ql) >= 0;
    }
    var out = [];
    var me = { kind: "me", me: true, name: t("geo.me"), sub: "" };
    if ((!ql && slot === 0) || (ql && match(me))) out.push(me);
    var seen = {};
    state.places.filter(match).slice(0, 5).forEach(function (p) {
      seen[p.id] = true;
      out.push({ kind: "saved", group: "plan.saved", name: p.name, sub: p.sub, lat: p.lat, lon: p.lon });
    });
    readRecent().filter(function (p) { return !seen[placeId(p.lat, p.lon)] && match(p); })
      .slice(0, 5).forEach(function (p) {
        out.push({ kind: "recent", group: "plan.recent", name: p.name, sub: p.sub, lat: p.lat, lon: p.lon });
      });
    return out;
  }

  function planQuery(i, raw) {
    planField = i;
    clearTimeout(planTimer);
    var q = raw.trim();
    var c = parseCoords(q);
    if (c) { planSeq++; planRender([c]); return; }
    if (q.length < AC_MIN) { planSeq++; planRender(localHits(q, i)); return; }
    planRender(localHits(q, i), "…", true);
    planTimer = setTimeout(function () { planFetch(i, q, false); }, AC_DEBOUNCE_MS);
  }

  //   pickFirst = true → Enter was pressed before any list existed.
  function planFetch(i, q, pickFirst) {
    var local = localHits(q, i);
    if (!navigator.onLine) { planRender(local, t("search.offline")); return; }
    var my = ++planSeq;
    photonGet(q, 6, true)
      .then(function (json) {
        if (my !== planSeq || planField !== i) return;
        var hits = (json.features || []).map(photonHit)
          .filter(function (h) { return isFinite(h.lat) && isFinite(h.lon); });
        var all = local.concat(hits);
        if (pickFirst && all.length) { planPick(all[0]); return; }
        planRender(all, all.length ? "" : t("search.empty"));
      })
      .catch(function () {
        if (my !== planSeq) return;
        planRender(local, t("search.err"));
      });
  }

  function planRender(list, note, busy) {
    planResults = list;
    planIndex = -1;
    var host = $("plan-results");
    host.innerHTML = "";
    var lastGroup = null;
    list.forEach(function (hit) {
      if (hit.group && hit.group !== lastGroup) {
        var h = document.createElement("div");
        h.className = "plan-group";
        h.textContent = t(hit.group);
        host.appendChild(h);
      }
      lastGroup = hit.group || null;
      var row = buildHitRow(hit);
      row.addEventListener("mousedown", function (e) {
        e.preventDefault();               // keeps the field focused
        planPick(hit);
      });
      host.appendChild(row);
    });
    if (note) {
      var n = document.createElement("div");
      n.className = busy ? "sr-loading" : "sr-empty";
      n.textContent = note;
      host.appendChild(n);
    }
    host.hidden = !host.childNodes.length;
    updatePlanHeight();
  }

  function planPick(hit) {
    var i = planField;
    if (i < 0 || i >= slotCount()) return;
    planSeq++;
    clearTimeout(planTimer);
    $("plan-results").hidden = true;
    var v = hit.me ? meSlot(null)
      : { lat: hit.lat, lon: hit.lon, name: hit.name, sub: hit.sub || "" };
    slotSet(i, v);
    if (!hit.me && hit.kind !== "recent") pushRecent(v);
    var inp = slotInput(i);
    if (inp) inp.blur();
    planChanged();
  }

  function planKey(e, i, inp) {
    var rows = $("plan-results").querySelectorAll(".sr-item");
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (!rows.length || $("plan-results").hidden) return;
      planIndex = e.key === "ArrowDown"
        ? (planIndex + 1) % rows.length
        : (planIndex - 1 + rows.length) % rows.length;
      for (var k = 0; k < rows.length; k++) rows[k].classList.toggle("sel", k === planIndex);
      rows[planIndex].scrollIntoView({ block: "nearest" });
    } else if (e.key === "Enter") {
      e.preventDefault();
      // Enter always does something (R28): the selected row, else the
      // first row, else search NOW and take the first result.
      var q = inp.value.trim();
      if (planIndex >= 0 && planResults[planIndex]) planPick(planResults[planIndex]);
      else if (q && planResults.length && !$("plan-results").hidden) planPick(planResults[0]);
      else if (q.length >= AC_MIN) { clearTimeout(planTimer); planFetch(i, q, true); }
    } else if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();                 // the document handler would close the panel
      if (!$("plan-results").hidden) { $("plan-results").hidden = true; updatePlanHeight(); }
      else closePlanner();
    }
  }

  // ---------- 11d. Long-press / right-click menu on the map ----------
  // MX-5: on a phone the only way to use a point used to be a button
  // first. Long-press (right-click on desktop) now offers the point
  // directly, named by its address as soon as Photon answers.
  function openContextMenu(e) {
    if (navActive || !e || !e.latlng) return;
    cancelPick();
    var place = { lat: e.latlng.lat, lon: e.latlng.lng, name: t("route.ptmap"), sub: "" };
    var coordsTxt = place.lat.toFixed(5) + ", " + place.lon.toFixed(5);

    var wrap = document.createElement("div");
    var title = document.createElement("b");
    title.textContent = place.name;
    wrap.appendChild(title);
    var subEl = document.createElement("div");
    subEl.className = "pop-sub";
    subEl.textContent = coordsTxt;
    wrap.appendChild(subEl);

    var actions = document.createElement("div");
    actions.className = "pop-actions";
    function act(icon, label, fn) {
      var b = document.createElement("button");
      b.type = "button";
      b.innerHTML = icon + "<span></span>";
      b.querySelector("span").textContent = label;
      b.addEventListener("click", function () { map.closePopup(); fn(); });
      actions.appendChild(b);
    }
    act(ROUTE_PATH, t("ctx.end"), function () { startRouteTo(place); });
    act(FROM_PATH, t("ctx.start"), function () { startRouteFrom(place); });
    if (routeFrom && routeTo && routeVias.filter(Boolean).length < MAX_VIAS) {
      act(PLUS_PATH, t("ctx.via"), function () {
        routeVias = routeVias.filter(Boolean);
        routeVias.push(place);
        planChanged();
      });
    }
    act(STAR_PATH, t("places.save"), function () { addPlace(place); renderSavedLayer(); });
    act(SHARE_PATH, t("share"), function () { sharePoint(place); });
    // Extra items from the OSM modules (notes.js: Report to OSM).
    mapsHost.ctxItems.forEach(function (fn) {
      var it = null;
      try { it = fn(place); } catch (e2) { it = null; }
      if (it) act(it.icon, it.label, it.run);
    });
    wrap.appendChild(actions);

    L.popup({ maxWidth: 300 }).setLatLng(e.latlng).setContent(wrap).openOn(map);
    nameByReverse(place, function () {
      title.textContent = place.name;
      subEl.textContent = place.sub || coordsTxt;
    });
  }

  // ========== ROUTE EXTRAS + SHARING (OSM upgrade wave 6) ==========
  // Top of the Directions panel: arrival, the alternatives OSRM gave,
  // "avoid" (car only), share. All DOM-built, text via textContent.
  function renderRouteExtras() {
    var host = $("route-extras");
    if (!host) return;
    host.textContent = "";
    var eta = document.createElement("div");
    eta.id = "route-extras-eta";
    host.appendChild(eta);

    if (routeAlts.length > 1) {
      var h = document.createElement("div");
      h.className = "rx-h";
      h.textContent = t("route.alts");
      host.appendChild(h);
      var list = document.createElement("div");
      list.className = "rx-alts";
      RC.alternatives(routeAlts).forEach(function (a) {
        var b = document.createElement("button");
        b.type = "button";
        b.className = "rx-alt" + (a.i === routeAltIdx ? " on" : "");
        b.setAttribute("aria-pressed", a.i === routeAltIdx ? "true" : "false");
        b.setAttribute("data-alt", String(a.i));
        var top = document.createElement("b");
        top.textContent = a.i === 0 ? t("route.alt.best") :
          (a.dDur >= 60 ? "+" + fmtTime(a.dDur) : fmtTime(a.dur));
        var sub = document.createElement("span");
        sub.textContent = fmtTime(a.dur) + " · " + fmtDist(a.dist);
        b.appendChild(top); b.appendChild(sub);
        b.addEventListener("click", function () { selectAlt(a.i); });
        list.appendChild(b);
      });
      host.appendChild(list);
    }

    var row = document.createElement("div");
    row.className = "rx-row";
    if (routeProfile === "car") {
      var lb = document.createElement("label");
      lb.className = "rx-avoid";
      var lt = document.createElement("span");
      lt.textContent = t("route.avoid");
      var sel = document.createElement("select");
      sel.id = "route-avoid";
      [""].concat(RC.AVOID).forEach(function (v) {
        var o = document.createElement("option");
        o.value = v;
        o.textContent = t("route.avoid." + (v || "none"));
        sel.appendChild(o);
      });
      sel.value = readAvoid();
      sel.addEventListener("change", function () {
        writeAvoid(sel.value);
        if (routeFrom && routeTo && !navActive) calcRoute();
      });
      lb.appendChild(lt); lb.appendChild(sel);
      row.appendChild(lb);
    }
    var sh = document.createElement("button");
    sh.type = "button";
    sh.className = "rx-share";
    sh.innerHTML = SHARE_PATH + "<span></span>";
    sh.querySelector("span").textContent = t("share");
    sh.addEventListener("click", shareRoute);
    row.appendChild(sh);
    host.appendChild(row);
    paintRouteSummary();
  }

  // Links are made from this page's own folder, so a link copied on
  // useoros.online opens orOS Maps there (DL-1 direct links).
  function mapsBase() {
    try { return new URL("./", location.href).href; } catch (e) { return ""; }
  }

  function sharePoint(place) {
    if (!place || !isFinite(place.lat) || !isFinite(place.lon)) return;
    var name = place.name && place.name !== t("route.ptmap") ? place.name : "";
    var coords = place.lat.toFixed(5) + ", " + place.lon.toFixed(5);
    openShare({
      title: t("share.point"),
      name: name || coords,
      link: RC.orosPointLink(mapsBase(), place.lat, place.lon, name),
      geo: RC.geoUri(place.lat, place.lon, name),
      osm: RC.osmPointUrl(place.lat, place.lon, Math.max(map.getZoom(), 16)),
      coords: coords
    });
  }

  function shareRoute() {
    if (!routeFrom || !routeTo || !routeCoords.length) { showToast(t("route.nosteps")); return; }
    var pts = routePoints().filter(function (p) { return p && isFinite(p.lat) && isFinite(p.lon); });
    var toName = routeTo.name && !routeTo.me && routeTo.name !== t("route.ptmap") ? routeTo.name : "";
    var title = t("share.routeto").replace("{n}", toName || t("route.ptmap"));
    openShare({
      title: t("share.route"),
      name: title + " · " + fmtDist(lastDist) + " · " + fmtTime(lastDur),
      link: RC.orosRouteLink(mapsBase(), pts, routeProfile, toName),
      geo: RC.geoUri(routeTo.lat, routeTo.lon, toName),
      osm: RC.osmDirUrl(pts[0], pts[pts.length - 1], routeProfile),
      track: function () { saveRouteAsTrack(title, pts); }
    });
  }

  // "Save to My tracks": the route goes through the tracks module's
  // own GPX import, so it is stored and synced like any import.
  function saveRouteAsTrack(name, pts) {
    var api = window.__orosMapsTracks, T = window.OrosMapsTracks;
    var tr = RC.routeTrack(routeCoords, name, pts);
    if (!api || !T || typeof api.importText !== "function" || !tr) { showToast(t("share.track.no")); return; }
    Promise.resolve(api.importText(T.writeGpx(tr), tr.name + ".gpx")).then(function (e) {
      showToast(t(e ? "share.track.ok" : "share.track.no"));
    }, function () { showToast(t("share.track.no")); });
  }

  function copyText(text, okKey, input) {
    function fallback() {
      if (input) { input.focus(); input.select(); }
      var ok = false;
      try { ok = document.execCommand("copy"); } catch (e) { ok = false; }
      showToast(t(ok ? okKey : "share.nocopy"));
    }
    if (navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
      navigator.clipboard.writeText(text).then(function () { showToast(t(okKey)); }, fallback);
    } else fallback();
  }

  var shareDlg = null;
  //   o: { title, name, link, geo, osm, coords?, track? }
  function openShare(o) {
    if (shareDlg) { try { shareDlg.close(); } catch (e) {} shareDlg.remove(); }
    var d = document.createElement("dialog");
    d.className = "share-dlg";
    d.id = "share-dlg";
    var h = document.createElement("h3");
    h.textContent = o.title;
    d.appendChild(h);
    var nm = document.createElement("div");
    nm.className = "share-name";
    nm.textContent = o.name;
    d.appendChild(nm);
    var inp = document.createElement("input");
    inp.type = "text";
    inp.readOnly = true;
    inp.className = "share-link";
    inp.value = o.link;
    inp.setAttribute("aria-label", t("share.copy"));
    d.appendChild(inp);

    var list = document.createElement("div");
    list.className = "share-acts";
    function btn(id, label, fn) {
      var b = document.createElement("button");
      b.type = "button";
      b.id = id;
      b.textContent = label;
      b.addEventListener("click", fn);
      list.appendChild(b);
    }
    function link(id, label, href, target) {
      var a = document.createElement("a");
      a.id = id;
      a.href = href;
      a.target = target;
      a.rel = "noopener noreferrer";
      a.textContent = label;
      a.addEventListener("click", function () { setTimeout(function () { d.close(); }, 0); });
      list.appendChild(a);
    }
    if (navigator.share) {
      btn("share-send", t("share.send"), function () {
        navigator.share({ title: o.name, text: o.name, url: o.link }).then(function () { d.close(); }, function () {});
      });
    }
    btn("share-copy", t("share.copy"), function () { copyText(o.link, "share.copied", inp); });
    if (o.coords) btn("share-coords", t("share.coords"), function () { copyText(o.coords, "share.coords.ok", null); });
    // geo: is handed to the system (Android offers OsmAnd, Organic
    // Maps, …); the top window navigates, so the shell frame is not
    // asked to load it.
    if (o.geo) link("share-geo", t("share.geo"), o.geo, "_top");
    if (o.osm) link("share-osm", t("share.osm"), o.osm, "_blank");
    if (o.track) btn("share-track", t("share.track"), function () { d.close(); o.track(); });
    d.appendChild(list);

    var close = document.createElement("button");
    close.type = "button";
    close.className = "share-close";
    close.textContent = t("share.close");
    close.addEventListener("click", function () { d.close(); });
    d.appendChild(close);
    // outside-click close (orOS dialog pattern)
    d.addEventListener("click", function (e) {
      if (e.target !== d) return;
      var r = d.getBoundingClientRect();
      if (e.clientX < r.left || e.clientX > r.right ||
          e.clientY < r.top || e.clientY > r.bottom) d.close();
    });
    d.addEventListener("close", function () { if (shareDlg === d) shareDlg = null; d.remove(); });
    document.body.appendChild(d);
    shareDlg = d;
    d.showModal();
    // Show the start of the link (the focused field would scroll to its end).
    try { inp.setSelectionRange(0, 0); inp.scrollLeft = 0; } catch (e) { /* noop */ }
  }

  // ========== TURN-BY-TURN PANEL (Wave 3) ==========
  function renderManeuvers() {
    var host = $("maneuvers-list");
    if (!host || !lastSteps.length) return;
    renderRouteExtras();

    host.innerHTML = "";

    lastSteps.forEach(function (step, idx) {
      var li = document.createElement("li");
      li.className = "mvn";

      // Maneuver icon (generic directional arrow)
      var ico = document.createElement("span");
      ico.className = "m-ico";
      var maneuverType = step.maneuver.type || "depart";
      var direction = step.maneuver.modifier || "";
      var iconSvg = getManeuverIcon(maneuverType, direction);
      ico.innerHTML = iconSvg;
      li.appendChild(ico);

      // Text
      var txt = document.createElement("div");
      txt.className = "m-txt";
      txt.textContent = formatManeuverText(step);
      li.appendChild(txt);

      // Distance
      var dist = document.createElement("div");
      dist.className = "m-dist";
      dist.textContent = fmtDist(step.distance);
      li.appendChild(dist);

      host.appendChild(li);
    });

    // Total line
    if (lastDist > 0) {
      var total = document.createElement("li");
      total.className = "mvn total";
      var totalTxt = document.createElement("span");
      totalTxt.textContent = t("mvn.arrive");
      total.appendChild(totalTxt);
      var totalDist = document.createElement("span");
      totalDist.textContent = " · " + fmtDist(lastDist);
      totalDist.style.marginLeft = "auto";
      total.appendChild(totalDist);
      host.appendChild(total);
    }

    // Scroll to first
    host.scrollTop = 0;
  }

  // Icon follows the DIRECTION of the maneuver (the glanceable cue
  // in the HUD), not just its type. All arrows start at the bottom
  // ("you are here, heading up") and end with a head that points
  // where to go.
  var MVN_ICON = {
    "straight":     '<path d="M12 20V5"/><path d="M6 11l6-6 6 6"/>',
    "left":         '<path d="M16 20v-7a4 4 0 0 0-4-4H5"/><path d="M9 5L5 9l4 4"/>',
    "right":        '<path d="M8 20v-7a4 4 0 0 1 4-4h7"/><path d="M15 5l4 4-4 4"/>',
    "slight left":  '<path d="M15 20v-6L7 6"/><path d="M7 12V6h6"/>',
    "slight right": '<path d="M9 20v-6l8-8"/><path d="M11 6h6v6"/>',
    "sharp left":   '<path d="M16 20V8l-9 9"/><path d="M7 11v6h6"/>',
    "sharp right":  '<path d="M8 20V8l9 9"/><path d="M17 11v6h-6"/>',
    "uturn":        '<path d="M17 20V9a4.5 4.5 0 0 0-9 0v8"/><path d="M4 13l4 4 4-4"/>',
    "roundabout":   '<circle cx="12" cy="14" r="4"/><path d="M12 10V3"/><path d="M9 6l3-3 3 3"/>',
    "depart":       '<circle cx="12" cy="20" r="1.5" fill="currentColor"/><path d="M12 16V4"/><path d="M6 10l6-6 6 6"/>',
    "arrive":       '<circle cx="12" cy="12" r="3"/><circle cx="12" cy="12" r="7" opacity="0.3"/>'
  };

  function getManeuverIcon(type, modifier) {
    var key;
    if (type === "arrive") key = "arrive";
    else if (type === "depart") key = "depart";
    else if (modifier === "uturn") key = "uturn";
    else if (type === "roundabout" || type === "rotary" ||
             type === "exit roundabout" || type === "exit rotary") key = "roundabout";
    else key = MVN_ICON[modifier] ? modifier : "straight";
    return '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
      'stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' + MVN_ICON[key] + '</svg>';
  }

  // OSRM modifier → localized direction word ("" when there is none).
  // OSRM spells modifiers with a space ("slight left"); the i18n keys
  // have none ("mvn.dir.slightleft").
  function dirWord(modifier) {
    if (!modifier || modifier === "uturn") return "";
    var key = "mvn.dir." + String(modifier).replace(/\s+/g, "");
    var w = t(key);
    return w === key ? "" : w;
  }

  // "<text> onto <street>" — with the separating space, and immune to
  // "$" sequences in street names (function replacer).
  function withName(text, name) {
    if (!name) return text;
    return text + " " + t("mvn.on").replace("{name}", function () { return name; });
  }

  function withDir(key, modifier) {
    return t(key).replace("{dir}", dirWord(modifier)).replace(/\s+/g, " ").trim();
  }

  function formatManeuverText(step) {
    var mv = step.maneuver || {};
    var type = mv.type || "depart";
    var modifier = mv.modifier || "";
    var name = step.name || step.ref || "";
    var straight = (!modifier || modifier === "straight");
    var side = modifier.indexOf("left") >= 0 ? "left"
             : modifier.indexOf("right") >= 0 ? "right" : "";

    if (type === "arrive") {
      return step.via ? t("mvn.via").replace("{n}", step.via) : t("mvn.arrive");
    }
    if (type === "depart") return withName(t("mvn.depart"), name);
    if (modifier === "uturn") return t("mvn.uturn");

    if (type === "roundabout" || type === "rotary") {
      return t("mvn.roundabout").replace("{n}", mv.exit || 1);
    }
    if (type === "exit roundabout" || type === "exit rotary") {
      return withName(t("mvn.exitroundabout"), name);
    }
    if (type === "fork") {
      // Forks carry "slight left/right" far more often than plain
      // "left/right" — any left-ish modifier keeps LEFT.
      if (!side) return withName(t("mvn.continue.straight"), name);
      return t("mvn.fork").replace("{dir}", t("mvn.dir." + side));
    }
    if (type === "end of road") {
      if (straight) return withName(t("mvn.continue.straight"), name);
      return withName(withDir("mvn.endofroad", modifier), name);
    }
    if (type === "merge") {
      return withName(straight ? t("mvn.merge.plain") : withDir("mvn.merge", modifier), name);
    }
    if (type === "on ramp" || type === "ramp") return withName(withDir("mvn.ramp", modifier), name);
    if (type === "off ramp") return withName(withDir("mvn.exitramp", modifier), name);
    if (type === "turn" || type === "roundabout turn") {
      if (straight) return withName(t("mvn.continue.straight"), name);
      return withName(withDir("mvn.turn", modifier), name);
    }
    // "continue", "new name", "notification" and anything OSRM adds later
    if (straight) return withName(t("mvn.continue.straight"), name);
    return withName(withDir("mvn.continue", modifier), name);
  }

  function cancelPick() {
    pickMode = null;
    document.body.classList.remove("pick");
    var on = document.querySelectorAll("#plan-rows .plan-pick.on");
    for (var i = 0; i < on.length; i++) on[i].classList.remove("on");
  }

  // Arm a map pick for one planner slot.
  function enterPick(slot) {
    cancelPick();
    pickMode = slot;
    document.body.classList.add("pick");
    var b = document.querySelector('#plan-rows [data-slot="' + slot + '"] .plan-pick');
    if (b) b.classList.add("on");
    var kind = slotKind(slot);
    showToast(t(kind === "from" ? "route.pick.start" : kind === "to" ? "route.pick.end" : "route.pick.via"));
  }

  function togglePick(slot) {
    if (pickMode === slot) cancelPick();
    else enterPick(slot);
  }

  // Click on the map while a pick is armed: that slot becomes the
  // point, named by its address once Photon answers (MX-4).
  function handleMapClick(e) {
    if (pickMode === null) return;
    var slot = pickMode;
    cancelPick();
    if (slot >= slotCount()) return;
    var place = { lat: e.latlng.lat, lon: e.latlng.lng, name: t("route.ptmap"), sub: "" };
    slotSet(slot, place);
    nameByReverse(place);
    planChanged();
  }

  // ========== END TURN-BY-TURN PANEL ==========

  // ========== LIVE NAVIGATION (Wave 4) ==========
  var HAV_R = 6371000;                      // Earth radius (m)

  function hav(lat1, lon1, lat2, lon2) {
    function rad(x) { return x * Math.PI / 180; }
    var dLat = rad(lat2 - lat1), dLon = rad(lon2 - lon1);
    var a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(rad(lat1)) * Math.cos(rad(lat2)) *
            Math.sin(dLon / 2) * Math.sin(dLon / 2);
    return 2 * HAV_R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  // Route index: cumulative length per vertex + the along-route
  // position of every step's maneuver. OSRM step distances are
  // scaled onto our own (haversine) geometry length so both rulers
  // agree. Rebuilt whenever routeCoords / lastSteps change.
  function buildRouteIndex() {
    routeCum = [];
    stepAlong = [];
    navAlong = 0;
    if (!routeCoords.length) return;
    routeCum.push(0);
    for (var i = 1; i < routeCoords.length; i++) {
      routeCum.push(routeCum[i - 1] +
        hav(routeCoords[i - 1][1], routeCoords[i - 1][0],
            routeCoords[i][1], routeCoords[i][0]));
    }
    var total = routeCum[routeCum.length - 1];
    var sum = 0, j;
    for (j = 0; j < lastSteps.length; j++) sum += lastSteps[j].distance || 0;
    var k = (sum > 0 && total > 0) ? total / sum : 1;
    var acc = 0;
    for (j = 0; j < lastSteps.length; j++) {
      stepAlong.push(acc * k);
      acc += lastSteps[j].distance || 0;
    }
  }

  // Match a position to the route POLYLINE (point-to-segment, not
  // point-to-vertex: straight roads have vertices hundreds of metres
  // apart). Returns { near, fwd }, each { dist, along } in metres:
  //   near — the plain nearest point of the whole route (deviation);
  //   fwd  — the EARLIEST point at or after `minAlong` that is about
  //          as close as `near` (within 15 m). Progress only moves
  //          forward, so an out-and-back route (or the two sides of
  //          a divided road) cannot snap to the wrong leg. null when
  //          nothing ahead is close — the user doubled back.
  function matchRoute(lat, lon, minAlong) {
    var n = routeCoords.length;
    var near = { dist: Infinity, along: 0 };
    if (!n) return { near: near, fwd: null };
    if (n === 1) {
      near.dist = hav(lat, lon, routeCoords[0][1], routeCoords[0][0]);
      return { near: near, fwd: near };
    }
    var kx = 111320 * Math.cos(lat * Math.PI / 180), ky = 110540;
    var ds = [], als = [], i;
    for (i = 0; i < n - 1; i++) {
      var ax = (routeCoords[i][0] - lon) * kx, ay = (routeCoords[i][1] - lat) * ky;
      var bx = (routeCoords[i + 1][0] - lon) * kx, by = (routeCoords[i + 1][1] - lat) * ky;
      var dx = bx - ax, dy = by - ay;
      var len2 = dx * dx + dy * dy;
      var tt = len2 > 0 ? -(ax * dx + ay * dy) / len2 : 0;
      if (tt < 0) tt = 0; else if (tt > 1) tt = 1;
      var px = ax + tt * dx, py = ay + tt * dy;
      var d = Math.sqrt(px * px + py * py);
      var al = routeCum[i] + tt * (routeCum[i + 1] - routeCum[i]);
      ds.push(d); als.push(al);
      if (d < near.dist) near = { dist: d, along: al };
    }
    var fwd = null;
    for (i = 0; i < ds.length; i++) {
      if (ds[i] <= near.dist + 15 && als[i] >= minAlong) {
        fwd = { dist: ds[i], along: als[i] };
        break;                 // segments are in route order → earliest wins
      }
    }
    return { near: near, fwd: fwd };
  }

  // Step being traversed at a given along-route position: the last
  // step whose maneuver lies behind us (15 m of GPS slack).
  function stepIndexAt(along) {
    var idx = 0;
    for (var i = 0; i < stepAlong.length; i++) {
      if (stepAlong[i] <= along + 15) idx = i; else break;
    }
    return idx;
  }

  // ---------- Voice (Web Speech API, browser-native) ----------
  // false ONLY when the device lists its voices and none speaks the
  // UI language (a foreign voice reading Greek is noise, not help).
  // An empty list means "not loaded yet / unknown" → try anyway.
  function voiceUsable() {
    try {
      var vs = window.speechSynthesis.getVoices() || [];
      if (!vs.length) return true;
      var want = LANG === "el" ? "el" : "en";
      for (var i = 0; i < vs.length; i++) {
        if (String(vs[i].lang || "").toLowerCase().indexOf(want) === 0) return true;
      }
      return false;
    } catch (e) { return true; }
  }
  var voiceToldOnce = false;

  // Returns true when the text was handed to the synthesizer.
  //   urgent = false → never cut a sentence that is being spoken;
  //                    the caller retries on the next GPS tick.
  function speak(text, urgent) {
    if (navMuted) return false;
    if (!("speechSynthesis" in window)) return false;   // HUD still works
    try {
      if (!voiceUsable()) {
        if (!voiceToldOnce) { voiceToldOnce = true; showToast(t("nav.novoice")); }
        return false;
      }
      if (!urgent && window.speechSynthesis.speaking) return false;
      var u = new SpeechSynthesisUtterance(text);
      u.lang = LANG === "el" ? "el-GR" : "en-US"; // follows UI setting
      u.rate = 1;
      window.speechSynthesis.cancel();            // never queue behind
      window.speechSynthesis.speak(u);
      return true;
    } catch (e) { return false; }                 // HUD carries the info
  }

  // ---------- HUD painting ----------
  //   along = metres of route already covered (null = unknown yet)
  function navPaintHUD(nxt, dn, speedMs, along) {
    if (nxt) {
      $("nav-icon").innerHTML = getManeuverIcon(nxt.maneuver.type || "continue",
                                                 nxt.maneuver.modifier || "");
      $("nav-dist").textContent = dn !== null ? fmtDist(dn) : "…";
      $("nav-instr").textContent = formatManeuverText(nxt);
      paintLanes(nxt, dn);
    } else {
      paintLanes(null, null);
      // Last step: watching for arrival
      $("nav-icon").innerHTML = getManeuverIcon("arrive", "");
      $("nav-dist").textContent = dn !== null ? fmtDist(dn) : "";
      $("nav-instr").textContent = t("mvn.arrive");
    }
    $("nav-speed").textContent =
      (typeof speedMs === "number" && speedMs >= 0)
        ? Math.round(speedMs * 3.6) + " " + t("u.kmh") : "—";
    // Remaining time: the steps ahead + the UNFINISHED share of the
    // current step (so the figure moves on a 40-minute motorway step
    // too). Remaining distance: along the route.
    var rem = 0;
    for (var i = navCurStepIdx + 1; i < lastSteps.length; i++) rem += lastSteps[i].duration || 0;
    var cur = lastSteps[navCurStepIdx];
    var span = (stepAlong[navCurStepIdx + 1] || 0) - (stepAlong[navCurStepIdx] || 0);
    var frac = (dn !== null && span > 0) ? Math.min(1, dn / span) : 1;
    if (cur) rem += (cur.duration || 0) * frac;
    var total = routeCum.length ? routeCum[routeCum.length - 1] : lastDist;
    var remDist = (typeof along === "number") ? Math.max(0, total - along) : lastDist;
    $("nav-eta").textContent = RC.clock(Date.now(), rem) + " · " + fmtTime(rem) + " · " + fmtDist(remDist);
    $("nav-eta").title = t("route.arrive").replace("{t}", RC.clock(Date.now(), rem));
  }

  // Turn lanes of the next maneuver (OSRM intersection lanes), shown
  // in the last 2 km before it. The arrows come from a fixed set
  // keyed by checked indications (route-core.js): no server text
  // reaches the HTML.
  function paintLanes(step, dn) {
    var host = $("nav-lanes");
    if (!host) return;
    var lanes = step ? RC.lanesOf(step) : null;
    if (!lanes || (dn !== null && dn > 2000)) { host.hidden = true; host.textContent = ""; return; }
    host.textContent = "";
    var mod = (step.maneuver && step.maneuver.modifier) || "";
    lanes.forEach(function (ln) {
      var sp = document.createElement("span");
      sp.className = "lane" + (ln.v ? " on" : "");
      var shape = RC.laneShape(ln, mod);
      sp.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
        'stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">' + (MVN_ICON[shape] || MVN_ICON.straight) + "</svg>";
      sp.setAttribute("data-shape", shape);
      host.appendChild(sp);
    });
    host.hidden = false;
  }

  // ---------- Speed limit (wave 10A, OsmAnd style) ----------
  // The car's road ahead: one Overpass request for the roads with a
  // maxspeed tag along the next 4 km of the route, again when fewer
  // than 1.5 km of it are left. The sign shows the limit of the way
  // the user is on, as written on the road (km/h or mph); red when
  // more than 5 km/h faster. No tag known → no sign. Ways stay in
  // memory only.
  var LIM_OVERPASS = "https://overpass-api.de/api/interpreter";
  var limWays = [], limUpTo = -1, limBusy = false, limTryAt = 0;
  function limitReset() { limUpTo = -1; }
  function limitFetch(along) {
    if (!TC || limBusy || !navigator.onLine || Date.now() - limTryAt < 20000) return;
    var pts = TC.corridor(routeCoords, routeCum, along - 100, along + 4000, 150);
    if (pts.length < 2) return;
    limBusy = true; limTryAt = Date.now();
    var upTo = along + 4000;
    fetch(LIM_OVERPASS, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: "data=" + encodeURIComponent(TC.limitQuery(pts, 20))
    }).then(function (r) {
      if (!r.ok) throw new Error(r.status);
      return r.json();
    }).then(function (j) {
      limBusy = false;
      limWays = TC.mergeLimits(limWays, TC.parseLimits(j));
      limUpTo = upTo;
    }, function () { limBusy = false; });
  }
  function limitTick(lat, lon, along, speedMs) {
    var sign = $("nav-limit");
    if (!sign) return;
    if (!TC || routeProfile !== "car" || typeof along !== "number") { sign.hidden = true; return; }
    var total = routeCum.length ? routeCum[routeCum.length - 1] : 0;
    if (along + 1500 > limUpTo && limUpTo < total) limitFetch(along);
    // The route's direction here, from 20 m behind to 20 m ahead.
    var a = TC.corridor(routeCoords, routeCum, along - 20, along + 20, 40);
    var brg = a.length > 1 ? TC.bearing(a[0], a[a.length - 1]) : null;
    var w = TC.limitAt(limWays, lat, lon, brg, 25);
    if (!w) { sign.hidden = true; return; }
    var ms = w.ms;
    sign.hidden = false;
    if (ms.none) {
      sign.textContent = "";
      sign.className = "none";
      sign.title = t("nav.nolimit");
    } else {
      var kmh = typeof speedMs === "number" && speedMs >= 0 ? speedMs * 3.6 : -1;
      var isOver = TC.over(kmh, ms, 5);
      sign.textContent = String(ms.v);
      sign.className = (ms.mph ? "mph" : "") + (isOver ? " over" : "");
      sign.title = t("nav.limit").replace("{v}", ms.v + " " + (ms.mph ? "mph" : t("u.kmh"))) +
        (isOver ? " · " + t("nav.over") : "");
    }
    sign.setAttribute("aria-label", sign.title);
  }

  function resetNavProgress() {
    navCurStepIdx = 0;
    navAlong = 0;
    navSpokenFar = false;
    navPaintHUD(lastSteps[1] || null, null, null);
  }

  // ---------- Position tick: follow, announce, advance, re-route ----------
  // Progress is measured ALONG the route (matchRoute), so a
  // missed GPS fix near a maneuver can no longer strand the step
  // counter, and arrival is judged on the road the route ends on —
  // not on a requested point that may lie inside a block.
  function navTick(pos) {
    if (!navActive) return;
    var lat = pos.coords.latitude, lon = pos.coords.longitude;
    userPos = [lat, lon];
    userPosAt = Date.now();
    moveUser(lat, lon, pos.coords.accuracy);
    navSetHeading(lat, lon, pos.coords);
    navSpeed = pos.coords.speed;
    // MX-1: the camera follows only until the user moves the map
    // (then "Recenter" brings it back).
    if (navFollow) map.setView([lat, lon], navZoom(navSpeed), { animate: true });
    if (Date.now() - navMarkAt > 30000) markNavSession();

    if (routeCoords.length < 2 || lastSteps.length < 2) return;

    // 30 m of backward slack absorbs GPS jitter while standing still
    var m = matchRoute(lat, lon, Math.max(0, navAlong - 30));
    var near = m.near;

    // Deviation → re-route (12s debounce so OSRM isn't hammered)
    // (offline there is nothing to ask — keep guiding on the old route)
    if (near.dist > 55 && navigator.onLine && Date.now() - navRerouteAt > 12000) {
      navRerouteAt = Date.now();
      // Stops already reached stay behind: the new route goes from
      // here through the stops still ahead.
      var passed = 0;
      for (var sv = 0; sv < lastSteps.length; sv++) {
        if (lastSteps[sv].via && stepAlong[sv] <= navAlong + 30) passed++;
      }
      routeVias = routeVias.filter(Boolean).slice(passed);
      routeFrom = meSlot([lat, lon]);
      showToast(t("nav.rerouting"));
      calcRoute();          // restarts step tracking on success
      return;
    }

    // Forward match; the plain nearest point when nothing ahead is
    // close (the user doubled back onto an earlier part of the route).
    var p = m.fwd || near;
    navAlong = p.along;

    var last = lastSteps.length - 1;                    // the "arrive" step
    var total = routeCum[routeCum.length - 1];
    var idx = stepIndexAt(p.along);

    // Arrival: the end of the ROUTE (within 25 m along it), or — on
    // the final stretch — within 35 m of the requested point itself.
    if (p.dist <= 55 &&
        (idx >= last || total - p.along < 25 ||
         (idx >= last - 1 && routeTo && hav(lat, lon, routeTo.lat, routeTo.lon) < 35))) {
      navFinish();
      return;
    }
    if (idx >= last) idx = last - 1;

    var advanced = idx > navCurStepIdx;
    var navPrevIdx = navCurStepIdx;
    if (idx !== navCurStepIdx) {
      navCurStepIdx = idx;
      navSpokenFar = false;
      // Crossing a maneuver point → speak the step we now enter.
      // Only while it is still fresh: after a GPS gap the maneuver
      // may be far behind, and announcing it would mislead.
      if (advanced && p.along - stepAlong[idx] < 60) {
        // A stop reached on the way is said first ("Arrive at stop 1"),
        // not the "Head out" that follows it at the same point.
        var said0 = null;
        for (var sa = navPrevIdx + 1; sa <= idx; sa++) {
          if (lastSteps[sa] && lastSteps[sa].via) said0 = lastSteps[sa];
        }
        speak(formatManeuverText(said0 || lastSteps[idx]), true);
      }
    }

    var nxt = lastSteps[idx + 1];
    var dn = Math.max(0, stepAlong[idx + 1] - p.along);

    // Pre-announcement (~350m before the maneuver). It waits for a
    // sentence in progress (the "now" announcement of the previous
    // maneuver) unless the maneuver is already close.
    if (!advanced && !navSpokenFar && dn < 350) {
      var said = speak(t("nav.in").replace("{d}", spokenDist(dn))
        .replace("{text}", function () { return formatManeuverText(nxt); }), dn < 120);
      if (said || navMuted) navSpokenFar = true;
    }
    navPaintHUD(nxt, dn, pos.coords.speed, p.along);
    limitTick(lat, lon, p.along, pos.coords.speed);
  }

  function navFinish() {
    speak(t("mvn.arrive"), true);
    showToast(t("nav.arrived"));
    stopNavigation();
  }

  // ---------- Start / stop ----------
  // MX-2: a route planned from somewhere else cannot be followed from
  // here. The first GPS tick used to replace the start without a word;
  // now the route is recalculated from the user's position first
  // (stops and destination kept) and that is said.
  var NAV_FAR_M = 150;
  function startNavigation() {
    if (!lastSteps.length) { showToast(t("route.nosteps")); return; }
    function go() {
      var far = routeFrom && isFinite(routeFrom.lat) &&
        hav(userPos[0], userPos[1], routeFrom.lat, routeFrom.lon) > NAV_FAR_M;
      if (!far || !navigator.onLine) { beginNav(false); return; }   // offline: the old route still guides
      routeFrom = meSlot(userPos);
      showToast(t("nav.fromhere"));
      calcRoute(true, function (ok) { if (ok) beginNav(false); });
    }
    if (userPosFresh()) { go(); return; }
    getUserLocation(function (pos) {
      // A stale fix is still a usable starting view — the position
      // watch replaces it within seconds.
      if (pos || userPos) go();
      else showToast(t("toast.noLocYet"));
    }, true);
  }

  // Camera: follow the user, zoomed out a little at speed; any pan,
  // pinch, wheel or zoom button by the user stops following.
  var navFollow = true;
  var navSpeed = null;
  function navZoom(speedMs) {
    if (typeof speedMs !== "number" || !isFinite(speedMs)) return 17;
    return speedMs > 22 ? 15 : speedMs > 11 ? 16 : 17;
  }
  function setNavFollow(on) {
    navFollow = on;
    $("nav-recenter").hidden = on || !navActive;
  }
  function navRecenter() {
    setNavFollow(true);
    if (userPos) map.setView(userPos, navZoom(navSpeed), { animate: true });
  }

  // MX-6: while navigating the user is an arrow that turns with the
  // direction of travel (GPS heading when moving, else the bearing
  // between the last two fixes at least 5 m apart).
  var NAV_ARROW = '<div class="nav-arrow nohead"><svg width="34" height="34" viewBox="0 0 34 34">' +
    '<circle cx="17" cy="17" r="14" fill="#6d4aff" stroke="#fff" stroke-width="2.5"/>' +
    '<path class="nav-arrow-head" d="M17 8l7 16-7-4-7 4z" fill="#fff"/>' +
    '<circle class="nav-arrow-dot" cx="17" cy="17" r="4.5" fill="#fff"/></svg></div>';
  function navArrowIcon() {
    return L.divIcon({ className: "custom-marker", html: NAV_ARROW,
                       iconSize: [34, 34], iconAnchor: [17, 17], popupAnchor: [0, -14] });
  }
  var navHeading = null, navPrevFix = null;
  function bearingDeg(lat1, lon1, lat2, lon2) {
    var r = Math.PI / 180;
    var y = Math.sin((lon2 - lon1) * r) * Math.cos(lat2 * r);
    var x = Math.cos(lat1 * r) * Math.sin(lat2 * r) -
            Math.sin(lat1 * r) * Math.cos(lat2 * r) * Math.cos((lon2 - lon1) * r);
    return (Math.atan2(y, x) / r + 360) % 360;
  }
  function navSetHeading(lat, lon, coords) {
    var h = coords && coords.heading;
    var moved = navPrevFix ? hav(navPrevFix[0], navPrevFix[1], lat, lon) : 0;
    if (typeof h === "number" && isFinite(h) && (coords.speed || 0) > 0.7) navHeading = h;
    else if (navPrevFix && moved >= 5) navHeading = bearingDeg(navPrevFix[0], navPrevFix[1], lat, lon);
    if (!navPrevFix || moved >= 5) navPrevFix = [lat, lon];
    var el = userMarker && userMarker.getElement && userMarker.getElement();
    var a = el && el.querySelector(".nav-arrow");
    if (!a) return;
    a.classList.toggle("nohead", navHeading === null);
    if (navHeading !== null) a.style.transform = "rotate(" + Math.round(navHeading) + "deg)";
  }

  // Screen Wake Lock: without it the phone dims and locks mid-route,
  // and a hidden page stops receiving positions. Browsers drop the
  // lock whenever the page is hidden — re-acquired on return.
  var wakeLock = null, wakeLockPending = false;
  function acquireWakeLock() {
    try {
      if (!("wakeLock" in navigator) || wakeLock || wakeLockPending) return;
      wakeLockPending = true;
      navigator.wakeLock.request("screen").then(function (lock) {
        wakeLockPending = false;
        if (!navActive) { lock.release(); return; }
        wakeLock = lock;
        lock.addEventListener("release", function () {
          if (wakeLock === lock) wakeLock = null;
        });
      }).catch(function () { wakeLockPending = false; });
    } catch (e) { wakeLockPending = false; }
  }
  function releaseWakeLock() {
    if (!wakeLock) return;
    try { wakeLock.release(); } catch (e) { /* noop */ }
    wakeLock = null;
  }
  document.addEventListener("visibilitychange", function () {
    if (navActive && document.visibilityState === "visible") acquireWakeLock();
  });

  // Navigation session marker (sessionStorage, device-local). The
  // shell runs ONE app frame: sending the route to Calendar, the
  // taskbar clock or a language toggle replace this page and kill a
  // running navigation without a word. The marker survives that;
  // the next boot of Maps in the same tab resumes (see boot). Only
  // an explicit stop (exit / arrival / clear route) removes it.
  var NAV_SESSION_KEY = "oros-maps-nav";
  var NAV_SESSION_MS = 30 * 60 * 1000;
  var navMarkAt = 0;
  function markNavSession() {
    navMarkAt = Date.now();
    try { sessionStorage.setItem(NAV_SESSION_KEY, String(navMarkAt)); } catch (e) { /* noop */ }
  }
  function clearNavSession() {
    try { sessionStorage.removeItem(NAV_SESSION_KEY); } catch (e) { /* noop */ }
  }
  function navSessionFresh() {
    try {
      var ts = parseInt(sessionStorage.getItem(NAV_SESSION_KEY) || "0", 10);
      return ts > 0 && Date.now() - ts < NAV_SESSION_MS;
    } catch (e) { return false; }
  }
  function resumeNavigation() {
    if (!lastSteps.length) { clearNavSession(); return; }
    getUserLocation(function (pos) {
      if (!pos) { clearNavSession(); return; }
      beginNav(true);
      showToast(t("nav.resumed"));
    }, true);
  }

  // resumed = true → picked up after the page was replaced: no
  // "Head out" announcement, the route matcher finds where we are.
  function beginNav(resumed) {
    navActive = true;
    paintAltLines();                       // one route on screen while driving
    navRerouteAt = Date.now();
    document.body.classList.add("nav");
    $("nav-hud").hidden = false;
    resetExitConfirm();
    map.closePopup();
    if (planOpen) closePlanner();
    navHeading = null; navPrevFix = null; navSpeed = null;
    if (userMarker) userMarker.setIcon(navArrowIcon());
    setNavFollow(true);
    map.setView(userPos, 17, { animate: true });
    resetNavProgress();
    if (!resumed) speak(formatManeuverText(lastSteps[0]), true);    // "Head out …"
    acquireWakeLock();
    markNavSession();
    if (navWatchId === null && "geolocation" in navigator) {
      navWatchId = navigator.geolocation.watchPosition(navTick, function () {
        showToast(t("nav.gpslost"));
      }, { enableHighAccuracy: true, maximumAge: 2000, timeout: 15000 });
    }
  }

  function stopNavigation() {
    navActive = false;
    paintAltLines();
    document.body.classList.remove("nav");
    $("nav-hud").hidden = true;
    $("nav-recenter").hidden = true;
    $("nav-limit").hidden = true;
    if (userMarker) userMarker.setIcon(makeMarkerIcon(COLOR_USER));
    if (navWatchId !== null) {
      navigator.geolocation.clearWatch(navWatchId);
      navWatchId = null;
    }
    releaseWakeLock();
    clearNavSession();
    try { if ("speechSynthesis" in window) window.speechSynthesis.cancel(); }
    catch (e) { /* noop */ }
  }

  // Exit: double-tap confirmation (orOS factory-reset pattern — no
  // native confirm dialogs anywhere)
  var exitArm = 0;
  var exitTimer = null;
  function resetExitConfirm() {
    exitArm = 0;
    if (exitTimer) { clearTimeout(exitTimer); exitTimer = null; }
    var b = $("nav-exit");
    if (b) {
      b.classList.remove("armed");
      b.setAttribute("title", t("nav.exit"));
    }
  }

  // ========== END LIVE NAVIGATION ==========

  // ========== MAPS → CALENDAR (Wave 8) ==========
  // Sends the active route as a Calendar event DRAFT: date picker
  // (native date input, today default), prefilled title/location/
  // start time, distance + duration + profile in the note. Shell
  // mode calls the __orosOpenCalendarNew bridge; standalone opens
  // /calendar/?new={json} in a new tab (the URL param carries the
  // payload — no shared storage needed across tabs).
  var calDlg = null, calDateIn = null;

  function routeCalPayload(dateYmd) {
    var now = new Date();
    var hh = ("0" + now.getHours()).slice(-2);
    var mm = ("0" + now.getMinutes()).slice(-2);
    return {
      date: dateYmd,
      title: (LANG === "el" ? "Διαδρομή προς " : "Route to ") +
             (routeTo && routeTo.name ? routeTo.name : "?"),
      location: (routeTo && routeTo.name) ? routeTo.name : "",
      start: hh + ":" + mm,
      note: fmtDist(lastDist) + " · " + fmtTime(lastDur) + " · " +
            t("route." + routeProfile)
    };
  }

  function sendRouteToCalendar() {
    if (!routeTo || !lastSteps.length) { showToast(t("route.nosteps")); return; }
    if (!calDlg) buildCalDialog();
    var today = new Date();
    calDateIn.value = today.getFullYear() + "-" +
      ("0" + (today.getMonth() + 1)).slice(-2) + "-" +
      ("0" + today.getDate()).slice(-2);
    calDlg.showModal();
  }

  function buildCalDialog() {
    calDlg = document.createElement("dialog");
    calDlg.style.cssText =
      "background:var(--panel-bg);color:var(--text);border:1px solid var(--border);" +
      "border-radius:12px;padding:16px;width:min(300px,calc(100vw - 32px));" +
      "box-shadow:0 12px 40px var(--shadow);";

    var h = document.createElement("h3");
    h.textContent = t("cal.send");
    h.style.cssText = "font-size:14px;color:var(--accent);margin-bottom:10px;";
    calDlg.appendChild(h);

    var lb = document.createElement("label");
    lb.textContent = t("cal.date");
    lb.style.cssText = "display:block;font-size:11px;text-transform:uppercase;" +
      "letter-spacing:1px;color:var(--text-dim);margin-bottom:6px;";
    calDlg.appendChild(lb);

    calDateIn = document.createElement("input");
    calDateIn.type = "date";
    calDateIn.style.cssText = "background:var(--bg);color:var(--text);" +
      "border:1px solid var(--border);border-radius:7px;padding:8px 10px;" +
      "font:inherit;min-height:38px;width:100%;outline:none;";
    calDlg.appendChild(calDateIn);

    var row = document.createElement("div");
    row.style.cssText = "display:flex;gap:8px;margin-top:14px;";

    var ok = document.createElement("button");
    ok.type = "button";
    ok.textContent = t("cal.confirm");
    ok.style.cssText = "flex:1;border:1px solid var(--accent);background:var(--accent-soft);" +
      "color:var(--accent);font:inherit;font-size:13px;font-weight:800;" +
      "padding:8px 16px;border-radius:7px;cursor:pointer;min-height:44px;";
    ok.addEventListener("click", function () {
      var v = calDateIn.value;
      calDlg.close();
      if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return;
      var p = routeCalPayload(v);
      var sent = false;
      try {
        if (window.parent &&
            typeof window.parent.__orosOpenCalendarNew === "function") {
          window.parent.__orosOpenCalendarNew(p);
          sent = true;
        }
      } catch (e) {}
      if (!sent) {
        window.open("/calendar/?new=" + encodeURIComponent(JSON.stringify(p)),
          "_blank", "noopener,noreferrer");
      }
      showToast(t("cal.sent"));
    });
    row.appendChild(ok);

    var no = document.createElement("button");
    no.type = "button";
    no.textContent = t("cal.cancel");
    no.style.cssText = "flex:1;border:1px solid var(--border);background:transparent;" +
      "color:var(--text);font:inherit;font-size:13px;font-weight:700;" +
      "padding:8px 16px;border-radius:7px;cursor:pointer;min-height:44px;";
    no.addEventListener("click", function () { calDlg.close(); });
    row.appendChild(no);

    calDlg.appendChild(row);
    // outside-click close (orOS dialog pattern)
    // (geometry test: the dialog's own PADDING also reports the
    // dialog as the click target — only a click outside the box closes)
    calDlg.addEventListener("click", function (e) {
      if (e.target !== calDlg) return;
      var r = calDlg.getBoundingClientRect();
      if (e.clientX < r.left || e.clientX > r.right ||
          e.clientY < r.top || e.clientY > r.bottom) calDlg.close();
    });
    document.body.appendChild(calDlg);
  }

  // ========== OFFLINE LAYER (Wave 5) ==========
  // Last-known-route persistence: full route snapshot so the app
  // is useful in degraded (offline) mode — polyline, steps, bar.
  // Snapshot = what the offline app needs, nothing more. OSRM steps
  // arrive with their own geometry + intersections (a second copy of
  // the route, and then some) — dropped here. Every app shares ONE
  // ~5 MB localStorage (R30), so the snapshot is also capped.
  var ROUTE_SNAPSHOT_MAX = 600000;      // characters
  var routeQuotaToldOnce = false;

  function slimSteps(steps) {
    return (steps || []).map(function (st) {
      var mv = st.maneuver || {};
      var out = {
        maneuver: { type: mv.type || "", modifier: mv.modifier || "" },
        name: st.name || "",
        distance: st.distance || 0,
        duration: st.duration || 0
      };
      if (mv.exit !== undefined) out.maneuver.exit = mv.exit;
      if (mv.location) out.maneuver.location = mv.location;
      if (st.ref) out.ref = st.ref;
      if (st.via) out.via = st.via;
      var lanes = RC.lanesOf(st);
      if (lanes) out.lanes = lanes;
      return out;
    });
  }

  function saveRoute() {
    if (!routeFrom || !routeTo || !routeCoords.length) return;
    var json = JSON.stringify({
      ver: 1,
      from: routeFrom, to: routeTo,
      vias: routeVias.filter(Boolean),
      profile: routeProfile,
      geometry: { type: "LineString", coordinates: routeCoords },
      steps: slimSteps(lastSteps), distance: lastDist, duration: lastDur
    });
    var ok = json.length <= ROUTE_SNAPSHOT_MAX;
    var why = "route.toobig";
    if (ok) {
      try { localStorage.setItem(ROUTE_STORAGE_KEY, json); }
      catch (e) { ok = false; why = "store.full"; }
    }
    if (!ok) {
      // Never leave an OLDER route behind as "the last known route":
      // the next boot would restore a route the user did not ask for.
      try { localStorage.removeItem(ROUTE_STORAGE_KEY); } catch (e2) { /* noop */ }
      if (!routeQuotaToldOnce) { routeQuotaToldOnce = true; showToast(t(why)); }
    }
    updateRouteSavedInfo();
  }

  // quiet = true → a deep link is about to place the view: paint
  // the route, but leave the view and the toast alone.
  function restoreRoute(quiet) {
    var data;
    try { data = JSON.parse(localStorage.getItem(ROUTE_STORAGE_KEY) || "null"); }
    catch (e) { return false; }
    if (!data || !data.from || !data.to || !data.geometry ||
        !Array.isArray(data.geometry.coordinates)) return false;

    routeFrom = data.from; routeTo = data.to;
    // Snapshots written before stops existed have no `vias`.
    routeVias = (Array.isArray(data.vias) ? data.vias : []).filter(function (v) {
      return v && typeof v.lat === "number" && typeof v.lon === "number" &&
        isFinite(v.lat) && isFinite(v.lon);
    }).slice(0, MAX_VIAS);
    routeProfile = PROFILE_OSRM[data.profile] ? data.profile : "car";
    lastSteps = Array.isArray(data.steps) ? data.steps : [];
    lastDist = data.distance || 0;
    lastDur = data.duration || 0;
    routeCoords = data.geometry.coordinates;
    buildRouteIndex();

    if (routeLine) map.removeLayer(routeLine);
    routeLine = L.geoJSON(data.geometry, {
      style: { color: "#6d4aff", weight: 5, opacity: 0.9, lineCap: "round" }
    }).addTo(map);
    paintRouteMarkers();

    restoring = true;
    setRouteProfile(routeProfile);        // paints profile buttons only — no OSRM call
    restoring = false;
    routeAlts = []; routeAltIdx = 0; paintAltLines();
    paintRouteSummary();
    showRouteBar(true);

    if (!quiet) {
      map.fitBounds(routeLine.getBounds(), { padding: [48, 48] });
      showToast(t("route.restored"));
    }
    return true;
  }

  // ---------- Settings drawer: tile stats / clear / route forget ----------
  function updateTileStats() {
    var host = $("tile-stats");
    if (!("caches" in window)) { host.textContent = t("settings.tiles.none"); return; }
    caches.open(TILE_CACHE_NAME).then(function (cache) {
      return cache.keys().then(function (keys) {
        if (!keys.length) { host.textContent = t("settings.tiles.none"); return; }
        // Count only: storage.estimate() reports the WHOLE origin (every
        // app, the Files disk), never this cache alone.
        host.textContent = t("settings.tiles.count").replace("{n}", keys.length);
      });
    }).catch(function () { host.textContent = t("settings.tiles.none"); });
  }

  function clearTileCache() {
    if (!("caches" in window)) return;
    caches.delete(TILE_CACHE_NAME).then(function () {
      updateTileStats();
      showToast(t("settings.tiles.cleared"));
    });
  }

  function updateRouteSavedInfo() {
    var host = $("route-saved-info");
    var raw = null;
    try { raw = localStorage.getItem(ROUTE_STORAGE_KEY); } catch (e) { /* noop */ }
    if (!raw || !routeFrom) { host.textContent = t("settings.route.none"); return; }
    host.textContent = (routeFrom.name || "·") + " → " + (routeTo && routeTo.name || "·");
  }

  function forgetSavedRoute() {
    try { localStorage.removeItem(ROUTE_STORAGE_KEY); } catch (e) { /* noop */ }
    updateRouteSavedInfo();
  }

  // ---------- Offline indicator (chip + toasts, Weather pattern) ----------
  function paintOffline(on) { $("offline-chip").hidden = !on; }
  function initOfflineChip() {
    paintOffline(!navigator.onLine);
    window.addEventListener("offline", function () {
      paintOffline(true);
      showToast(t("offline.enter"));
    });
    window.addEventListener("online", function () {
      paintOffline(false);
      showToast(t("offline.leave"));
    });
  }
  // ========== END OFFLINE LAYER ==========

  // ---------- 12. Saved places: storage ops + drawer + markers ----------
  // mtime is stamped HERE, at the mutation site (R27) — never in
  // save(). Re-starring a deleted place gets a fresh mtime that
  // beats its tombstone (resurrection, R17).
  function addPlace(place) {
    var id = placeId(place.lat, place.lon);
    state.places = state.places.filter(function (p) { return p.id !== id; });
    state.places.push({
      id: id, name: place.name || "?", sub: place.sub || "",
      lat: place.lat, lon: place.lon, mtime: Date.now()
    });
    if (save()) showToast(t("places.saved"));
  }

  function removePlaceById(id) {
    var gone = placeById(id);
    if (!gone) return;
    state.places = state.places.filter(function (p) { return p.id !== id; });
    state.deleted[id] = Date.now();        // tombstone — merge-safe
    if (!save()) return;
    // Undo toast (LOCAL — the closure stays in this frame). Undo
    // re-adds with a fresh mtime, which beats the tombstone (R17).
    localToast(t("places.removed"), t("places.undo"), function () {
      // MP-2 (A67 Q5): a pull may have brought the place back already
      // (another device edited it after this delete). Re-adding the
      // snapshot with a fresh mtime would revert that newer edit.
      if (placeById(id)) return;
      addPlace({ lat: gone.lat, lon: gone.lon, name: gone.name, sub: gone.sub });
    });
  }

  // `orig` = the name shown when the rename dialog opened. MP-1 (A67
  // Q1): an OK without typing compared the old text with the CURRENT
  // name, which a pull may have changed meanwhile, and wrote the old
  // text back with a fresh mtime (the other device's rename was lost).
  function renamePlace(id, name, orig) {
    var p = placeById(id);
    name = String(name || "").trim().slice(0, 120);
    if (typeof orig === "string" && name === orig.trim().slice(0, 120)) return;
    if (!p || !name || name === p.name) return;      // zero-edit: no mtime stamp
    p.name = name;
    p.mtime = Date.now();
    save();
  }

  // Themed single-field prompt (no native prompt — R14). Node is
  // removed on close; Enter confirms, Esc / outside click cancels.
  function askText(title, value, onOk) {
    var dlg = document.createElement("dialog");
    dlg.style.cssText =
      "background:var(--panel-bg);color:var(--text);border:1px solid var(--border);" +
      "border-radius:12px;padding:16px;width:min(320px,calc(100vw - 32px));" +
      "box-shadow:0 12px 40px var(--shadow);";
    var h = document.createElement("h3");
    h.textContent = title;
    h.style.cssText = "font-size:14px;color:var(--accent);margin-bottom:10px;";
    dlg.appendChild(h);
    var inp = document.createElement("input");
    inp.type = "text";
    inp.value = value || "";
    inp.maxLength = 120;
    inp.setAttribute("aria-label", title);
    inp.style.cssText = "background:var(--bg);color:var(--text);" +
      "border:1px solid var(--border);border-radius:7px;padding:8px 10px;" +
      "font:inherit;font-size:16px;min-height:44px;width:100%;outline:none;";
    dlg.appendChild(inp);
    var row = document.createElement("div");
    row.style.cssText = "display:flex;gap:8px;margin-top:14px;";
    function done(ok) {
      var v = inp.value;
      if (dlg.open) dlg.close();
      dlg.remove();
      if (ok) onOk(v);
    }
    var okBtn = document.createElement("button");
    okBtn.type = "button";
    okBtn.textContent = t("dlg.ok");
    okBtn.style.cssText = "flex:1;border:1px solid var(--accent);background:var(--accent-soft);" +
      "color:var(--accent);font:inherit;font-size:13px;font-weight:800;" +
      "padding:8px 16px;border-radius:7px;cursor:pointer;min-height:44px;";
    okBtn.addEventListener("click", function () { done(true); });
    var noBtn = document.createElement("button");
    noBtn.type = "button";
    noBtn.textContent = t("cal.cancel");
    noBtn.style.cssText = "flex:1;border:1px solid var(--border);background:transparent;" +
      "color:var(--text);font:inherit;font-size:13px;font-weight:700;" +
      "padding:8px 16px;border-radius:7px;cursor:pointer;min-height:44px;";
    noBtn.addEventListener("click", function () { done(false); });
    row.appendChild(okBtn);
    row.appendChild(noBtn);
    dlg.appendChild(row);
    inp.addEventListener("keydown", function (e) {
      if (e.key === "Enter") { e.preventDefault(); done(true); }
    });
    dlg.addEventListener("cancel", function (e) { e.preventDefault(); done(false); });
    dlg.addEventListener("click", function (e) {
      if (e.target !== dlg) return;
      var r = dlg.getBoundingClientRect();
      if (e.clientX < r.left || e.clientX > r.right ||
          e.clientY < r.top || e.clientY > r.bottom) done(false);
    });
    document.body.appendChild(dlg);
    dlg.showModal();
    inp.select();
  }

  function removePlace(lat, lon) {
    removePlaceById(placeId(lat, lon));
  }

  // Saved pins live on their own layerGroup — rebuilt on every
  // save() (cheap: handful of markers).
  // Wave 10C (fav.js): favourite groups colour the pins, hide a group
  // from the map and group the list. Without fav.js nothing changes.
  function favApi() { return window.__orosMapsFav || null; }

  function renderSavedLayer() {
    if (!savedLayer) return;
    savedLayer.clearLayers();
    var F = favApi();
    state.places.forEach(function (p) {
      if (F && F.hidden(p.id)) return;
      var m = L.marker([p.lat, p.lon], { icon: makeMarkerIcon((F && F.colorOf(p.id)) || COLOR_SAVED) });
      bindPlacePopup(m, p);
      savedLayer.addLayer(m);
    });
  }

  function renderPlacesList() {
    var ul = $("places-list");
    if (!ul) return;
    ul.innerHTML = "";
    var hasAny = state.places.length > 0;
    $("places-empty").hidden = hasAny;
    ul.hidden = !hasAny;

    // Storage order is canonical (by id); the LIST keeps the familiar
    // order — oldest first (inside each favourite group, wave 10C).
    var F = favApi();
    var sections = F ? F.sections(state.places) : [{ g: null, places: state.places.slice().sort(function (x, y) {
      return (x.mtime - y.mtime) || (x.id < y.id ? -1 : x.id > y.id ? 1 : 0);
    }) }];
    sections.forEach(function (sec) {
      if (F && sec.g !== null) {
        var head = F.header(sec.g, sec.places);
        if (head) ul.appendChild(head);
        if (F.collapsed(sec.g)) return;
      }
      sec.places.forEach(function (p) { ul.appendChild(placeRow(p, F)); });
    });
  }

  function placeRow(p, F) {
    var li = document.createElement("li");
    li.className = "place";

    var pin = document.createElement("span");
    pin.className = "p-pin";
    var pinColor = F && F.colorOf(p.id);
    if (pinColor) pin.style.color = pinColor;
    pin.innerHTML =
      '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 10c0 7-9 13-9 13S3 17 3 10a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>';
    li.appendChild(pin);

    var body = document.createElement("div");
    body.className = "p-body";
    var name = document.createElement("div");
    name.className = "p-name";
    name.textContent = p.name;
    body.appendChild(name);
    if (p.sub) {
      var sub = document.createElement("div");
      sub.className = "p-sub";
      sub.textContent = p.sub;
      body.appendChild(sub);
    }
    li.appendChild(body);

    li.addEventListener("click", function () {
      $("places").hidden = true;
      map.flyTo([p.lat, p.lon], 15);
      // open the saved pin's popup for star/route actions
      savedLayer.eachLayer(function (mk) {
        if (mk.getLatLng().lat === p.lat && mk.getLatLng().lng === p.lon) {
          mk.openPopup();
        }
      });
    });

    if (F) li.appendChild(F.groupButton(p));

    var ren = document.createElement("button");
    ren.type = "button";
    ren.className = "p-ren";
    ren.title = t("places.rename");
    ren.setAttribute("aria-label", t("places.rename"));
    ren.innerHTML =
      '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z"/></svg>';
    ren.addEventListener("click", function (e) {
      e.stopPropagation();
      var orig = p.name;
      askText(t("places.rename"), orig, function (v) { renamePlace(p.id, v, orig); });
    });
    li.appendChild(ren);

    var del = document.createElement("button");
    del.type = "button";
    del.className = "p-del";
    del.title = t("places.del");
    del.setAttribute("aria-label", t("places.del"));
    del.innerHTML =
      '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>';
    del.addEventListener("click", function (e) {
      e.stopPropagation();
      removePlaceById(p.id);
    });
    li.appendChild(del);

    return li;
  }

  // ---------- 13. Palette + shell shortcut contract ----------
  var PAL_VARS = ["--bg", "--bg-desktop", "--bar-bg", "--text", "--text-dim",
                  "--accent", "--accent-hover", "--accent-soft",
                  "--panel-bg", "--border", "--shadow", "--danger"];

  function inheritPalette() {
    try {
      var pRoot = window.parent.document.documentElement;
      document.documentElement.setAttribute("data-theme",
        pRoot.getAttribute("data-theme") || "dark");
      var cs = window.parent.getComputedStyle(pRoot);
      PAL_VARS.forEach(function (v) {
        document.documentElement.style.setProperty(v, cs.getPropertyValue(v).trim());
      });
    } catch (e) { /* standalone (direct) open — fallback palette stands */ }
  }

  function watchPalette() {
    try {
      new MutationObserver(inheritPalette).observe(
        window.parent.document.documentElement,
        { attributes: true, attributeFilter: ["data-skin", "data-theme"] }
      );
    } catch (e) { /* standalone */ }
  }

  // ---------- 13b. Sync (maps slice — saved places only) ----------
  function syncApi() {
    try { return (window.parent && window.parent.orosSync) || window.orosSync || null; }
    catch (e) { return window.orosSync || null; }
  }

  // Dirty hook exists BEFORE load() (mood MO2 lesson); the slice
  // itself registers after load(), so state is hydrated by then.
  window.__orosSyncApi = {
    _suppress: false,
    dirty: function () {
      if (this._suppress) return;
      var api = syncApi();
      if (api && typeof api.markDirty === "function") api.markDirty();
    }
  };

  function sliceGet() { return normalize(state); }      // canonical (R26)

  // Pull-fed: persist + repaint, NEVER markDirty (R6), no toast.
  function sliceSet(data) {
    if (!data || typeof data !== "object" || !Array.isArray(data.places)) return;
    state = normalize(JSON.parse(JSON.stringify(data)));
    window.__orosSyncApi._suppress = true;
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }
    finally { window.__orosSyncApi._suppress = false; }
    renderSavedLayer();
    renderPlacesList();
  }

  function registerSync() {
    var api = syncApi();
    if (!api || typeof api.registerSlice !== "function") return;
    api.registerSlice("maps", sliceGet, sliceSet, STORAGE_KEY, mergeMapsStates);
  }

  // Contract Β: shell-owned combos (Ctrl+Alt+Shift+*) forward FIRST.
  document.addEventListener("keydown", function (e) {
    if (!(e.ctrlKey || e.metaKey) || !e.altKey || !e.shiftKey) return;
    var p = window.parent;
    if (!(p && p.orosShortcuts && typeof p.orosShortcuts.handle === "function")) return;
    if (window.parent.orosShortcuts.handle(e)) e.stopPropagation();
  }, true);

  // ---------- 14. Deep-link receiver ----------
  // shell.js stages __orosOpenMaps(lat, lon, label) into
  // sessionStorage["oros-maps-open"]; we consume it here (one-shot).
  function openAtLocation(params) {
    if (!map) return;
    var lat = parseFloat(params.lat);
    var lon = parseFloat(params.lon);
    if (!isNaN(lat) && !isNaN(lon)) {
      placeResult(lat, lon, params.label || "", "");
      return;
    }
    // q-mode (Wave 6): free-text address from another app —
    // geocode via Photon, then drop the result marker.
    if (typeof params.q === "string" && params.q.trim()) {
      geocodeAndShow(params.q.trim(), params.label);
    }
  }

  function geocodeAndShow(query, label) {
    if (!navigator.onLine) { showToast(t("search.offline")); return; }
    photonGet(query, 1, false)
      .then(function (json) {
        var f = json.features && json.features[0];
        if (!f || !f.geometry) { showToast(t("search.empty")); return; }
        var h = photonHit(f);
        if (!isFinite(h.lat) || !isFinite(h.lon)) { showToast(t("search.empty")); return; }
        placeResult(h.lat, h.lon, label || (h.name !== "?" ? h.name : query), h.sub);
      })
      .catch(function () { showToast(t("search.err")); });
  }

  window.__orosMapsOpen = function (params) {
    if (typeof params !== "object" || !params) return;
    openAtLocation(params);
  };

  function openSharedLink(sh) {
    if (sh.point) {
      var p = sh.point;
      var place = { lat: p.lat, lon: p.lon, name: p.label || t("route.ptmap"), sub: "" };
      placeResult(p.lat, p.lon, place.name, "");
      if (!p.label) nameByReverse(place, function () { bindPlacePopup(resultMarker, place); });
      return;
    }
    if (!sh.route) return;
    // Wave 7: a public transport link opens the Public transport
    // sheet (transit.js loads after this file: it picks the request
    // up from mapsHost.pendingTransit at its boot).
    if (sh.mode === "transit") {
      var tTo = sh.route[sh.route.length - 1];
      var req = { from: { lat: sh.route[0].lat, lon: sh.route[0].lon, name: "" },
        to: { lat: tTo.lat, lon: tTo.lon, name: sh.to || "" } };
      if (mapsHost.openTransit) mapsHost.openTransit(req.from, req.to);
      else mapsHost.pendingTransit = req;
      return;
    }
    var pts = sh.route.map(function (q, i) {
      var last = i === sh.route.length - 1;
      return { lat: q.lat, lon: q.lon, name: last && sh.to ? sh.to : t("route.ptmap"), sub: "" };
    });
    routeFrom = pts[0];
    routeTo = pts[pts.length - 1];
    routeVias = pts.slice(1, -1).slice(0, MAX_VIAS);
    restoring = true;
    setRouteProfile(sh.mode);              // buttons only; calcRoute below
    restoring = false;
    paintRouteMarkers();
    calcRoute();
    pts.forEach(function (q, i) {
      if (i === pts.length - 1 && sh.to) return;
      nameByReverse(q);
    });
  }

  function consumePending() {
    try {
      var pending = sessionStorage.getItem("oros-maps-open");
      if (pending) {
        sessionStorage.removeItem("oros-maps-open");
        var data = JSON.parse(pending);
        if (data && typeof data === "object") openAtLocation(data);
      }
    } catch (e) { /* storage blocked — navigation no-ops, nothing breaks */ }
  }

  // ---------- 15. i18n painting + wiring + boot ----------
  function applyI18n() {
    [].forEach.call(document.querySelectorAll("[data-i18n-aria]"), function (n) { n.setAttribute("aria-label", t(n.getAttribute("data-i18n-aria"))); });
    var n = document.querySelectorAll("[data-i18n]");
    for (var i = 0; i < n.length; i++) {
      n[i].textContent = t(n[i].getAttribute("data-i18n"));
    }
    var ti = document.querySelectorAll("[data-i18n-title]");
    for (var j = 0; j < ti.length; j++) {
      ti[j].setAttribute("title", t(ti[j].getAttribute("data-i18n-title")));
      ti[j].setAttribute("aria-label", ti[j].getAttribute("title"));
    }
    var p = document.querySelectorAll("[data-i18n-ph]");
    for (var k = 0; k < p.length; k++) {
      p[k].setAttribute("placeholder", t(p[k].getAttribute("data-i18n-ph")));
    }
  }

  function wire() {
    // Search input: debounced autocomplete + keyboard navigation
    var search = $("search");
    search.addEventListener("input", function () {
      $("search-clear").hidden = !this.value;
      clearTimeout(acTimer);
      var q = this.value.trim();
      // Typed coordinates need no server (they work offline too)
      var c = parseCoords(q);
      if (c) { acSeq++; acRender([c]); return; }
      // Too short / emptied: also invalidate any response in flight —
      // it must not reopen a list for text that is no longer there.
      if (q.length < AC_MIN) { acSeq++; acResults = []; acClose(); return; }
      acTimer = setTimeout(function () { acFetch(q); }, AC_DEBOUNCE_MS);
    });
    search.addEventListener("focus", function () {
      if (this.value.trim().length >= AC_MIN &&
          $("search-results").hidden && acResults.length > 0) {
        $("search-results").hidden = false;
      }
    });
    search.addEventListener("blur", function () {
      // let mousedown on a row run first (preventDefault keeps focus)
      setTimeout(acClose, 150);
    });
    search.addEventListener("keydown", function (e) {
      var rows = $("search-results").querySelectorAll(".sr-item");
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        if (!rows.length) return;
        acIndex = e.key === "ArrowDown"
          ? (acIndex + 1) % rows.length
          : (acIndex - 1 + rows.length) % rows.length;
        acSelClass();
      } else if (e.key === "Enter") {
        e.preventDefault();
        // Enter always does something (R28): the selected row, else the
        // first row, else search NOW and open the first result.
        if (acIndex >= 0 && acResults[acIndex]) pickResult(acResults[acIndex]);
        else if (acResults.length) pickResult(acResults[0]);
        else if (this.value.trim()) { clearTimeout(acTimer); acFetch(this.value.trim(), true); }
      } else if (e.key === "Escape") {
        acClose();
      }
    });
    $("search-clear").addEventListener("click", function () {
      $("search").value = "";
      $("search-clear").hidden = true;
      clearTimeout(acTimer);
      acSeq++;
      acClose();
      acResults = [];
      // Clearing the search also dismisses its result pin
      if (resultMarker) { map.removeLayer(resultMarker); resultMarker = null; }
      $("search").focus();
    });

    // Geolocation button
    $("geo-btn").addEventListener("click", function () {
      getUserLocation(function () {});
    });

    // Route planner (From / stops / To)
    $("plan-btn").addEventListener("click", function () {
      if (planOpen) closePlanner(); else openPlanner();
    });
    $("route-edit").addEventListener("click", function () { openPlanner(); });
    $("plan-close").addEventListener("click", closePlanner);
    $("plan-addstop").addEventListener("click", addStop);
    $("plan-swap").addEventListener("click", swapPlan);
    $("planner").setAttribute("aria-label", t("route.plan"));
    window.addEventListener("resize", updatePlanHeight);
    // MX-8: car / bike / walk times are the router's estimate
    $("route-time").title = t("route.notraffic");

    // Long-press (touch) / right-click (desktop) on the map
    map.on("contextmenu", openContextMenu);

    // Live navigation: the user taking the map stops the follow-camera
    map.on("dragstart", function () { if (navActive && navFollow) setNavFollow(false); });
    var mc = map.getContainer();
    mc.addEventListener("wheel", function () {
      if (navActive && navFollow) setNavFollow(false);
    }, { passive: true });
    mc.addEventListener("touchstart", function (e) {
      if (navActive && navFollow && e.touches && e.touches.length > 1) setNavFollow(false);
    }, { passive: true });
    mc.addEventListener("click", function (e) {
      if (navActive && navFollow && e.target.closest && e.target.closest(".leaflet-control-zoom")) {
        setNavFollow(false);
      }
    });
    map.on("dblclick", function () { if (navActive && navFollow) setNavFollow(false); });
    $("nav-recenter").addEventListener("click", navRecenter);

    // Route profiles + clear
    $("rp-car").addEventListener("click", function () { setRouteProfile("car"); });
    $("rp-bike").addEventListener("click", function () { setRouteProfile("bike"); });
    $("rp-foot").addEventListener("click", function () { setRouteProfile("foot"); });
    // Public transport is its own sheet (transit.js): same two points.
    $("rp-transit").addEventListener("click", function () {
      if (mapsHost.openTransit) mapsHost.openTransit(routeFrom, routeTo);
    });
    $("route-clear").addEventListener("click", clearRoute);

    // Wave 8: Send to Calendar — appended to the route bar at wire
    // time (JS-built so maps/index.html stays untouched; the bar
    // itself exists in the DOM from boot, hidden until a route).
    var calBtn = document.createElement("button");
    calBtn.type = "button";
    calBtn.id = "route-cal";
    calBtn.title = t("cal.send");
    calBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>';
    calBtn.setAttribute("aria-label", t("cal.send"));
    calBtn.addEventListener("click", sendRouteToCalendar);
    // Sits with the other route actions, before Start / Clear
    // (styled by maps.css together with its siblings).
    $("route-bar").insertBefore(calBtn, $("nav-start"));

    // OSM upgrade wave 6: share, the Directions panel extras, lanes.
    var shareBtn = document.createElement("button");
    shareBtn.type = "button";
    shareBtn.id = "route-share";
    shareBtn.title = t("share.route");
    shareBtn.setAttribute("aria-label", t("share.route"));
    shareBtn.innerHTML = SHARE_PATH;
    shareBtn.addEventListener("click", shareRoute);
    $("route-bar").insertBefore(shareBtn, $("nav-start"));
    var extras = document.createElement("div");
    extras.id = "route-extras";
    $("maneuvers").insertBefore(extras, $("maneuvers-list"));
    var lanesRow = document.createElement("div");
    lanesRow.id = "nav-lanes";
    lanesRow.hidden = true;
    lanesRow.setAttribute("aria-label", t("nav.lanes"));
    $("nav-top").parentNode.insertBefore(lanesRow, $("nav-top").nextSibling);
    setInterval(function () {
      if (!$("route-bar").hidden && lastDur > 0) paintRouteSummary();
    }, 30000);

    // Steps button — toggle maneuvers panel
    $("steps-btn").addEventListener("click", function () {
      if (!lastSteps.length) { showToast(t("route.nosteps")); return; }
      var panel = $("maneuvers");
      panel.hidden = !panel.hidden;
      if (!panel.hidden) $("mapsettings").hidden = true;   // one right drawer at a time
      var btn = $("steps-btn");
      btn.classList.toggle("on", !panel.hidden);
      if (!panel.hidden) renderManeuvers();
    });

    // Maneuvers close
    $("maneuvers-close").addEventListener("click", function () {
      $("maneuvers").hidden = true;
      $("steps-btn").classList.remove("on");
    });

    // Navigation (Wave 4)
    $("nav-start").addEventListener("click", startNavigation);
    $("nav-mute").addEventListener("click", function () {
      navMuted = !navMuted;
      this.classList.toggle("muted", navMuted);
      this.setAttribute("title", t(navMuted ? "nav.unmute" : "nav.mute"));
      if (navMuted) {
        try { if ("speechSynthesis" in window) window.speechSynthesis.cancel(); }
        catch (e) { /* noop */ }
        showToast(t("nav.muted"));
      }
    });
    $("nav-exit").addEventListener("click", function () {
      if (Date.now() - exitArm < 3000) {
        resetExitConfirm();
        stopNavigation();
        return;
      }
      exitArm = Date.now();
      this.classList.add("armed");
      this.setAttribute("title", t("nav.exitconfirm"));
      showToast(t("nav.exitconfirm"));      // touch has no tooltip
      exitTimer = setTimeout(resetExitConfirm, 3000);
    });

    // Saved places drawer
    $("places-btn").addEventListener("click", function () {
      var panel = $("places");
      panel.hidden = !panel.hidden;
      if (!panel.hidden) renderPlacesList();
    });
    $("places-close").addEventListener("click", function () {
      $("places").hidden = true;
    });

    // Esc closes the drawer / route bar as well
    document.addEventListener("keydown", function (e) {
      if (e.key !== "Escape") return;
      // An open dialog owns Escape (it closes itself) — the drawers
      // behind it stay as they are.
      if (document.querySelector("dialog[open]")) return;
      if (!$("places").hidden) $("places").hidden = true;
      if (!$("maneuvers").hidden) {
        $("maneuvers").hidden = true;
        $("steps-btn").classList.remove("on");
      }
      if (!$("mapsettings").hidden) $("mapsettings").hidden = true;
      if (pickMode !== null) cancelPick();
      else if (planOpen) closePlanner();
    });

    // Map click handler (pick mode)
    map.on("click", handleMapClick);

    // Settings drawer (Wave 5)
    $("mapsettings-btn").addEventListener("click", function () {
      var panel = $("mapsettings");
      panel.hidden = !panel.hidden;
      if (!panel.hidden) {
        $("maneuvers").hidden = true;                    // one right drawer at a time
        $("steps-btn").classList.remove("on");
        updateTileStats();
        updateRouteSavedInfo();
      }
    });
    $("mapsettings-close").addEventListener("click", function () {
      $("mapsettings").hidden = true;
    });
    $("tiles-clear").addEventListener("click", clearTileCache);
    $("route-forget").addEventListener("click", forgetSavedRoute);
  }

  // ---------- Host hooks for the OSM modules (osm-api.js, notes.js) ----------
  // They load after this file and plug into the map, the toasts, the
  // long-press menu and the settings drawer through this object only.
  var mapsHost = window.__orosMapsHost = {
    map: null,
    lang: LANG,
    ver: SCRIPT_V,
    toast: showToast,
    localToast: localToast,
    storeFull: t("store.full"),
    ctxItems: [],
    // Wave 7 (transit.js): the planner's points, a location fix, a
    // place name, and a link that reopens a public transport search.
    routeEnds: function () { return { from: routeFrom, to: routeTo }; },
    locate: function (cb) {
      if (userPosFresh()) { cb(userPos); return; }
      getUserLocation(function (pos) { cb(pos || userPos || null); }, true);
    },
    reverseName: function (place, after) { nameByReverse(place, after); },
    transitLink: function (f, to) {
      if (!f || !to || !isFinite(f.lat) || !isFinite(to.lat)) return "";
      return RC.orosRouteLink(mapsBase(), [f, to], "transit", to.name || "");
    },
    openTransit: null,
    pendingTransit: null,
    // Wave 10B (planner.js): the OSRM servers per mode.
    routerBase: ROUTER_BASE,
    // Wave 10C (fav.js): saved places, adding many (GPX import), and
    // repainting the pins and the list after a group change.
    places: function () { return normalize(state).places; },
    placeId: placeId,
    addPlaces: function (list) {
      var now = Date.now(), n = 0;
      (list || []).forEach(function (pl) {
        if (!pl || !isFinite(pl.lat) || !isFinite(pl.lon)) return;
        var id = placeId(pl.lat, pl.lon);
        state.places = state.places.filter(function (x) { return x.id !== id; });
        state.places.push({ id: id, name: String(pl.name || "?").slice(0, 120), sub: String(pl.sub || "").slice(0, 200),
                            lat: pl.lat, lon: pl.lon, mtime: now + n });
        n++;
      });
      return n && save() ? n : 0;
    },
    refreshPlaces: function () { renderSavedLayer(); renderPlacesList(); },
    // Wave 10A (tools.js): directions to a point (the parked car).
    routeTo: function (place, profile) {
      if (profile && ROUTER_BASE[profile] && profile !== routeProfile) {
        routeProfile = profile;
        ["car", "bike", "foot"].forEach(function (k) {
          $("rp-" + k).classList.toggle("active", k === profile);
        });
      }
      startRouteTo(place);
    }
  };

  // ---------- Boot ----------
  load();
  inheritPalette();
  watchPalette();
  initMap();
  mapsHost.map = map;
  renderSavedLayer();
  applyI18n();
  wire();
  registerSync();      // AFTER load(): the slice must never register an unhydrated state
  var bootedViaBridge = false;
  try { bootedViaBridge = !!sessionStorage.getItem("oros-maps-open"); }
  catch (e) { bootedViaBridge = false; }

  /* Wave 6: standalone deep-link (?q=…) — bookmark/contact cards
     opening Maps in a new tab land here (it's a bridge boot: no
     welcome toast). */
  var urlQ = "";
  try { urlQ = (new URLSearchParams(location.search).get("q") || "").trim(); }
  catch (e) { urlQ = ""; }
  if (urlQ) bootedViaBridge = true;

  // Order matters: the last-known route is painted FIRST; a deep
  // link then owns the view (restore stays quiet for it).
  var restoredRoute = false;
  try { restoredRoute = restoreRoute(bootedViaBridge); }
  catch (e) { restoredRoute = false; }
  if (urlQ) geocodeAndShow(urlQ, "");
  // Wave 6: shared links (?lat&lon&label, ?route&mode&to), checked
  // strictly by route-core.js.
  var shared = null;
  try { shared = urlQ ? null : RC.parseLink(location.search); } catch (e) { shared = null; }
  if (shared) { bootedViaBridge = true; openSharedLink(shared); }
  consumePending();
  initOfflineChip();

  // A navigation that was running when this page was replaced
  // resumes — unless the user came back through a deep link.
  if (restoredRoute && !bootedViaBridge && navSessionFresh()) resumeNavigation();
  else clearNavSession();

})();