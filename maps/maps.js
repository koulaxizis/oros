// ============================================================
// orOS Maps — App logic (Wave 2: Search · Routes · Layers ·
// Saved Places)
//
// Online services (external, disclosed):
//   - Tiles:      OpenStreetMap / HOT / Esri (cross-origin)
//   - Geocoding:  Photon (photon.komoot.io)
//   - Routing:    OSRM — car: demo server (router.project-osrm.org);
//                 bike / walk: FOSSGIS (routing.openstreetmap.de)
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
      "search.ph":        "Search a place…",
      "search.clear":     "Clear search",
      "search.empty":     "No results",
      "search.offline":   "You are offline — search needs a connection",
      "search.err":       "Search failed — try again",
      "route.car":        "Car",
      "route.bike":      "Bike",
      "route.foot":      "Walk",
      "route.clear":     "Clear route",
      "route.fromUser":  "Route from your location",
      "route.fromCenter":"No location yet — routing from map view",
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
      "toast.welcome":   "Maps loaded",
      "toast.noLocYet":  "Tap the location button first",
      "route.steps":     "Directions",
      "route.nosteps":   "No active route",
      "route.plan":      "Plan a route",
      "route.setstart":  "Set start on map",
      "route.setend":    "Set destination on map",
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
      "u.kmh":              "km/h"
    },
    el: {
      "search.ph":        "Αναζήτηση τοποθεσίας…",
      "search.clear":     "Καθαρισμός αναζήτησης",
      "search.empty":     "Κανένα αποτέλεσμα",
      "search.offline":   "Είσαι offline — η αναζήτηση χρειάζεται σύνδεση",
      "search.err":       "Η αναζήτηση απέτυχε — δοκίμασε ξανά",
      "route.car":        "Αυτοκίνητο",
      "route.bike":       "Ποδήλατο",
      "route.foot":       "Πεζός",
      "route.clear":      "Καθαρισμός διαδρομής",
      "route.fromUser":   "Διαδρομή από την τοποθεσία σου",
      "route.fromCenter": "Καμία τοποθεσία ακόμα — διαδρομή από την προβολή",
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
      "toast.welcome":    "Ο χάρτης φορτώθηκε",
      "toast.noLocYet":   "Πάτησε πρώτα το κουμπί τοποθεσίας",
      "route.steps":      "Οδηγίες",
      "route.nosteps":    "Δεν υπάρχει ενεργή διαδρομή",
      "route.plan":       "Σχεδιασμός διαδρομής",
      "route.setstart":   "Ορισμός αφετηρίας στον χάρτη",
      "route.setend":     "Ορισμός προορισμού στον χάρτη",
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
      "u.kmh":              "χλμ/ώ"
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
  var layerStandard, layerHumanitarian, layerSatellite;

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

    L.control.zoom({ position: "topright" }).addTo(map);

    layerStandard = L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
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

    var byId = { standard: layerStandard, humanitarian: layerHumanitarian,
                 satellite: layerSatellite };
    (byId[prefs.layer] || layerStandard).addTo(map);   // last used, else default

    var layers = {};
    layers[t("layers.standard") || "Standard"] = layerStandard;
    layers[t("layers.humanitarian") || "Humanitarian"] = layerHumanitarian;
    layers[t("layers.satellite") || "Satellite"] = layerSatellite;
    L.control.layers(layers, null, { position: "topright", collapsed: true }).addTo(map);

    map.on("baselayerchange", function (e) {
      var id = e.layer === layerHumanitarian ? "humanitarian"
             : e.layer === layerSatellite ? "satellite" : "standard";
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
        { icon: makeMarkerIcon(COLOR_USER), zIndexOffset: 1000 }).addTo(map);
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

  function acRender(list) {
    acResults = list;
    acIndex = -1;
    var host = $("search-results");
    host.innerHTML = "";

    list.forEach(function (hit) {
      var row = document.createElement("div");
      row.className = "sr-item";

      var icon = document.createElement("span");
      icon.className = "sr-icon";
      icon.innerHTML =
        '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 10c0 7-9 13-9 13S3 17 3 10a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>';
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
    function url(withLang) {
      return "https://photon.komoot.io/api/?limit=" + limit +
        (withLang ? "&lang=" + LANG : "") + near + "&q=" + encodeURIComponent(query);
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
  var routeSeq = 0;             // token — stale / cancelled responses are dropped
  var routeProfile = "car";
  var routeLine = null;
  var routeFrom = null;         // { lat, lon, name }
  var routeTo = null;           // { lat, lon, name }
  var routeStartMarker = null;
  var routeEndMarker = null;
  var lastSteps = [];          // OSRM steps for the active route
  var lastDist = 0;            // total distance (m)
  var lastDur = 0;             // total duration (s)
  var pickMode = null;         // null | "start" | "end" (manual pick)
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
    if (routeStartMarker) { map.removeLayer(routeStartMarker); routeStartMarker = null; }
    if (routeEndMarker) { map.removeLayer(routeEndMarker); routeEndMarker = null; }
    routeFrom = routeTo = null;
    lastSteps = []; lastDist = 0; lastDur = 0;
    routeCoords = [];
    buildRouteIndex();
    cancelPick();
    if (navActive) stopNavigation();
    showRouteBar(false);
    $("maneuvers").hidden = true;
    $("steps-btn").classList.remove("on");
    $("maneuvers-list").innerHTML = "";
    try { localStorage.removeItem(ROUTE_STORAGE_KEY); } catch (e) { /* noop */ }
  }

  // Entry: user asked for a route TO `place`. Origin = last known
  // user location; if none yet, fetch it once; if that fails,
  // fall back to the current map view center (with a toast —
  // honest, never a fake route).
  function startRouteTo(dest) {
    function go(origin, told) {
      routeFrom = origin;
      routeTo = dest;
      calcRoute(told);
    }
    if (userPosFresh()) { go({ lat: userPos[0], lon: userPos[1], name: t("geo.me") }); return; }
    getUserLocation(function (pos) {
      if (pos) {
        showToast(t("route.fromUser"));
        go({ lat: pos[0], lon: pos[1], name: t("geo.me") }, true);
      } else if (userPos) {
        // No fresh fix, but an older one exists — better than the map
        // centre, and said out loud.
        showToast(t("route.fromLast"));
        go({ lat: userPos[0], lon: userPos[1], name: t("geo.me") }, true);
      } else {
        var c = map.getCenter();
        showToast(t("route.fromCenter"));
        go({ lat: c.lat, lon: c.lng, name: "·" }, true);
      }
    }, true);
  }

  // Start marker follows routeFrom — also BEFORE a route exists, so a
  // picked / chosen start is visible while the destination is chosen.
  function setStartMarker() {
    if (!routeFrom) return;
    if (!routeStartMarker) {
      routeStartMarker = L.marker([routeFrom.lat, routeFrom.lon],
        { icon: makeMarkerIcon(COLOR_ROUTE_START) }).addTo(map);
    } else {
      routeStartMarker.setLatLng([routeFrom.lat, routeFrom.lon]);
    }
  }

  // Entry: route FROM `place` (popup "From here"). With a destination
  // already set the route is recalculated; otherwise the next map tap
  // sets the destination.
  function startRouteFrom(place) {
    routeFrom = { lat: place.lat, lon: place.lon, name: place.name || t("route.ptmap"), sub: place.sub || "" };
    setStartMarker();
    if (routeTo) { cancelPick(); calcRoute(); return; }
    enterPick("end");
    showToast(t("route.pick.end"));
  }

  //   silent = true → the caller has just shown its own toast (where
  //   the route starts from); do not replace it with "Calculating…".
  function calcRoute(silent) {
    if (!routeFrom || !routeTo) return;
    if (!navigator.onLine) { showToast(t("route.offline")); return; }
    // Feedback while the server works (a re-route has its own toast)
    if (!navActive && !silent) showToast(t("route.calculating"));

    var url = ROUTER_BASE[routeProfile] +
      routeFrom.lon + "," + routeFrom.lat + ";" + routeTo.lon + "," + routeTo.lat +
      "?overview=full&geometries=geojson&steps=true";
    var my = ++routeSeq;

    fetch(url)
      .then(function (r) { if (!r.ok) throw 0; return r.json(); })
      .then(function (json) {
        // Stale (a newer request started) or cancelled (route cleared)
        if (my !== routeSeq || !routeFrom || !routeTo) return;
        if (!json || !json.routes || !json.routes.length) throw 0;
        var r0 = json.routes[0];

        if (routeLine) map.removeLayer(routeLine);
        routeLine = L.geoJSON(r0.geometry, {
          style: { color: "#6d4aff", weight: 5, opacity: 0.9, lineCap: "round" }
        }).addTo(map);
        routeLine.getLayers()[0].getElement && routeLine.getLayers()[0].getElement().classList.add("route-line");

        if (!routeStartMarker) {
          routeStartMarker = L.marker([routeFrom.lat, routeFrom.lon],
            { icon: makeMarkerIcon(COLOR_ROUTE_START) }).addTo(map);
        } else {
          routeStartMarker.setLatLng([routeFrom.lat, routeFrom.lon]);
        }
        if (!routeEndMarker) {
          routeEndMarker = L.marker([routeTo.lat, routeTo.lon],
            { icon: makeMarkerIcon(COLOR_RESULT) }).addTo(map);
        } else {
          routeEndMarker.setLatLng([routeTo.lat, routeTo.lon]);
        }
        // Re-bound on EVERY route: the marker is reused, the popup
        // (title + star target) must follow the current destination.
        if (routeTo.name) bindPlacePopup(routeEndMarker, routeTo);
        else routeEndMarker.unbindPopup();

        // A re-route during live navigation must not zoom out to the
        // whole route — the next GPS tick owns the view.
        if (!navActive) map.fitBounds(routeLine.getBounds(), { padding: [48, 48] });

        $("route-dist").textContent = fmtDist(r0.distance);
        $("route-time").textContent = fmtTime(r0.duration);
        showRouteBar(true);

        // Save steps for turn-by-turn panel
        lastSteps = (r0.legs && r0.legs[0] && r0.legs[0].steps) || [];
        lastDist = r0.distance;
        lastDur = r0.duration;
        routeCoords = (r0.geometry && r0.geometry.coordinates) || [];
        buildRouteIndex();

        // Render maneuvers if panel is open or route just started
        renderManeuvers();

        // Fresh route during live nav → restart step tracking
        if (navActive) resetNavProgress();

        saveRoute();
      })
      .catch(function () {
        if (my !== routeSeq) return;      // superseded or cancelled — stay quiet
        // Transient OSRM failure: keep the last GOOD route painted and
        // the offline snapshot intact — never wipe data on a fetch error.
        showToast(t("route.err"));
      });
  }

  // ========== TURN-BY-TURN PANEL (Wave 3) ==========
  function renderManeuvers() {
    var host = $("maneuvers-list");
    if (!host || !lastSteps.length) return;

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

    if (type === "arrive") return t("mvn.arrive");
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
    ["plan-btn", "route-setstart", "route-setend"].forEach(function (id) {
      var btn = $(id);
      if (btn) btn.classList.remove("on");
    });
  }

  // Arm a pick mode and paint the matching control(s).
  function enterPick(mode) {
    pickMode = mode;
    document.body.classList.add("pick");
    ["plan-btn", "route-setstart", "route-setend"].forEach(function (id) {
      var btn = $(id);
      if (!btn) return;
      btn.classList.toggle("on",
        (mode === "start" && (id === "plan-btn" || id === "route-setstart")) ||
        (mode === "end" && id === "route-setend"));
    });
  }

  // The user backed out of a pick (Esc / toggled the button). With
  // no route painted there is nothing to keep: the half-made plan
  // (and its start marker) goes away.
  function abortPick() {
    cancelPick();
    if (!routeLine) {
      routeFrom = routeTo = null;
      if (routeStartMarker) { map.removeLayer(routeStartMarker); routeStartMarker = null; }
    }
  }

  // Toggle a pick mode from a button.
  function togglePick(mode) {
    if (pickMode === mode) { abortPick(); return; }
    enterPick(mode);
    showToast(t(mode === "start" ? "route.pick.start" : "route.pick.end"));
  }

  // Click on map to set start/end point (manual override)
  function handleMapClick(e) {
    if (!pickMode) return;
    if (!navigator.onLine) { showToast(t("route.offline")); abortPick(); return; }

    var lat = e.latlng.lat;
    var lon = e.latlng.lng;
    var place = { lat: lat, lon: lon, name: t("route.ptmap"), sub: "" };

    if (pickMode === "start") {
      routeFrom = place;
      setStartMarker();
      if (!routeTo) {
        // No destination yet — chain straight into end-pick
        enterPick("end");
        showToast(t("route.pick.end"));
        return;
      }
    } else if (pickMode === "end") {
      routeTo = place;
      placeResult(lat, lon, place.name, place.sub);
      if (!routeFrom) {
        // No origin yet — chain straight into start-pick
        enterPick("start");
        showToast(t("route.pick.start"));
        return;
      }
    }

    calcRoute();
    cancelPick();
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
    } else {
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
    $("nav-eta").textContent = fmtTime(rem) + " · " + fmtDist(remDist);
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
    map.setView([lat, lon], 17, { animate: true });
    if (Date.now() - navMarkAt > 30000) markNavSession();

    if (routeCoords.length < 2 || lastSteps.length < 2) return;

    // 30 m of backward slack absorbs GPS jitter while standing still
    var m = matchRoute(lat, lon, Math.max(0, navAlong - 30));
    var near = m.near;

    // Deviation → re-route (12s debounce so OSRM isn't hammered)
    // (offline there is nothing to ask — keep guiding on the old route)
    if (near.dist > 55 && navigator.onLine && Date.now() - navRerouteAt > 12000) {
      navRerouteAt = Date.now();
      routeFrom = { lat: lat, lon: lon, name: t("geo.me") };
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
    if (idx !== navCurStepIdx) {
      navCurStepIdx = idx;
      navSpokenFar = false;
      // Crossing a maneuver point → speak the step we now enter.
      // Only while it is still fresh: after a GPS gap the maneuver
      // may be far behind, and announcing it would mislead.
      if (advanced && p.along - stepAlong[idx] < 60) {
        speak(formatManeuverText(lastSteps[idx]), true);
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
  }

  function navFinish() {
    speak(t("mvn.arrive"), true);
    showToast(t("nav.arrived"));
    stopNavigation();
  }

  // ---------- Start / stop ----------
  function startNavigation() {
    if (!lastSteps.length) { showToast(t("route.nosteps")); return; }
    if (userPosFresh()) { beginNav(false); return; }
    getUserLocation(function (pos) {
      // A stale fix is still a usable starting view — the position
      // watch replaces it within seconds.
      if (pos || userPos) beginNav(false);
      else showToast(t("toast.noLocYet"));
    }, true);
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
    navRerouteAt = Date.now();
    document.body.classList.add("nav");
    $("nav-hud").hidden = false;
    resetExitConfirm();
    map.closePopup();
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
    document.body.classList.remove("nav");
    $("nav-hud").hidden = true;
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
      return out;
    });
  }

  function saveRoute() {
    if (!routeFrom || !routeTo || !routeCoords.length) return;
    var json = JSON.stringify({
      ver: 1,
      from: routeFrom, to: routeTo,
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

    if (!routeStartMarker) {
      routeStartMarker = L.marker([routeFrom.lat, routeFrom.lon],
        { icon: makeMarkerIcon(COLOR_ROUTE_START) }).addTo(map);
    } else { routeStartMarker.setLatLng([routeFrom.lat, routeFrom.lon]); }
    if (!routeEndMarker) {
      routeEndMarker = L.marker([routeTo.lat, routeTo.lon],
        { icon: makeMarkerIcon(COLOR_RESULT) }).addTo(map);
    } else { routeEndMarker.setLatLng([routeTo.lat, routeTo.lon]); }
    if (routeTo.name) bindPlacePopup(routeEndMarker, routeTo);
    else routeEndMarker.unbindPopup();

    restoring = true;
    setRouteProfile(routeProfile);        // paints profile buttons only — no OSRM call
    restoring = false;
    $("route-dist").textContent = fmtDist(lastDist);
    $("route-time").textContent = fmtTime(lastDur);
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
      addPlace({ lat: gone.lat, lon: gone.lon, name: gone.name, sub: gone.sub });
    });
  }

  function renamePlace(id, name) {
    var p = placeById(id);
    name = String(name || "").trim().slice(0, 120);
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
  function renderSavedLayer() {
    if (!savedLayer) return;
    savedLayer.clearLayers();
    state.places.forEach(function (p) {
      var m = L.marker([p.lat, p.lon], { icon: makeMarkerIcon(COLOR_SAVED) });
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
    // order — oldest first.
    state.places.slice().sort(function (x, y) {
      return (x.mtime - y.mtime) || (x.id < y.id ? -1 : x.id > y.id ? 1 : 0);
    }).forEach(function (p) {
      var li = document.createElement("li");
      li.className = "place";

      var pin = document.createElement("span");
      pin.className = "p-pin";
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

      var ren = document.createElement("button");
      ren.type = "button";
      ren.className = "p-ren";
      ren.title = t("places.rename");
      ren.setAttribute("aria-label", t("places.rename"));
      ren.innerHTML =
        '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z"/></svg>';
      ren.addEventListener("click", function (e) {
        e.stopPropagation();
        askText(t("places.rename"), p.name, function (v) { renamePlace(p.id, v); });
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

      ul.appendChild(li);
    });
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

    // Plan a route / set start / set end — one pick mode at a time
    $("plan-btn").addEventListener("click", function () { togglePick("start"); });
    $("route-setstart").addEventListener("click", function () { togglePick("start"); });
    $("route-setend").addEventListener("click", function () { togglePick("end"); });

    // Route profiles + clear
    $("rp-car").addEventListener("click", function () { setRouteProfile("car"); });
    $("rp-bike").addEventListener("click", function () { setRouteProfile("bike"); });
    $("rp-foot").addEventListener("click", function () { setRouteProfile("foot"); });
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
      if (pickMode) abortPick();
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

  // ---------- Boot ----------
  load();
  inheritPalette();
  watchPalette();
  initMap();
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
  consumePending();
  initOfflineChip();

  // A navigation that was running when this page was replaced
  // resumes — unless the user came back through a deep link.
  if (restoredRoute && !bootedViaBridge && navSessionFresh()) resumeNavigation();
  else clearNavSession();

  setTimeout(function () {
    if (!bootedViaBridge && !localStorage.getItem(ROUTE_STORAGE_KEY)) {
      showToast(t("toast.welcome"));
    }
  }, 800);
})();