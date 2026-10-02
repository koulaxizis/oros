// ============================================================
// orOS Maps — App logic (Wave 2: Search · Routes · Layers ·
// Saved Places)
//
// Online services (external, disclosed):
//   - Tiles:      OpenStreetMap / HOT / Esri (cross-origin)
//   - Geocoding:  Nominatim (nominatim.openstreetmap.org)
//   - Routing:    OSRM demo server (router.project-osrm.org)
// All app logic + saved places are local-only (localStorage).
// Tile caching + sync slice arrive in Wave 5 (per roadmap).
//
// Sections:
//   1. Constants, i18n, helpers, boot marker
//   2. Saved-places state + storage (merge-ready, no slice yet)
//   3. Map init + tile layers + layer control
//   4. Geolocation + markers (divIcon SVG — zero PNG assets)
//  10. Search autocomplete (Nominatim)
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
      "route.tooFar":    "No route available for this mode",
      "places.title":    "Saved places",
      "places.close":    "Close",
      "places.empty":    "No saved places yet",
      "places.empty.hint":"Star a search result to save it.",
      "places.saved":    "Place saved",
      "places.removed":  "Place removed",
      "places.fly":      "Show on map",
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
      "route.cancel":    "Cancelled",
      "mvn.depart":      "Head out",
      "mvn.arrive":      "Arrive at destination",
      "mvn.turn":        "Turn {dir}",
      "mvn.continue":    "Continue {dir}",
      "mvn.continue.straight": "Continue straight",
      "mvn.merge":       "Merge {dir}",
      "mvn.fork":        "Keep {dir} at the fork",
      "mvn.endofroad":   "At the end of the road, turn {dir}",
      "mvn.roundabout":  "At the roundabout, take exit {n}",
      "mvn.ramp":        "Take the ramp {dir}",
      "mvn.exitramp":    "Take the exit {dir}",
      "mvn.uturn":       "Make a U-turn",
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
      "route.restored":     "Last known route restored"
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
      "route.tooFar":     "Δεν υπάρχει διαθέσιμη διαδρομή για αυτόν τον τρόπο",
      "places.title":     "Αποθηκευμένες τοποθεσίες",
      "places.close":     "Κλείσιμο",
      "places.empty":     "Δεν υπάρχουν αποθηκευμένες τοποθεσίες",
      "places.empty.hint":"Αστέρισε ένα αποτέλεσμα αναζήτησης για αποθήκευση.",
      "places.saved":     "Η τοποθεσία αποθηκεύτηκε",
      "places.removed":   "Η τοποθεσία αφαιρέθηκε",
      "places.fly":       "Εμφάνιση στον χάρτη",
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
      "route.pick.end":   "Πάτησε στον χάρτη για να ορίσεις τον προορισμό",
      "route.cancel":     "Ακυρώθηκε",
      "mvn.depart":       "Ξεκίνα",
      "mvn.arrive":       "Άφιξη στον προορισμό",
      "mvn.turn":         "Στρίψε {dir}",
      "mvn.continue":     "Συνέχισε {dir}",
      "mvn.continue.straight": "Συνέχισε ίσια",
      "mvn.merge":        "Ενσωματώσου {dir}",
      "mvn.fork":         "Μείνε {dir} στο διχάλι",
      "mvn.endofroad":    "Στο τέλος του δρόμου στρίψε {dir}",
      "mvn.roundabout":   "Στον κυκλικό κόμβο πάρε την έξοδο {n}",
      "mvn.ramp":         "Πάρε τη ράμπα {dir}",
      "mvn.exitramp":     "Πάρε την έξοδο {dir}",
      "mvn.uturn":        "Κάνε αναστροφή",
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
      "route.restored":      "Επαναφορά τελευταίας γνωστής διαδρομής"
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
  var toastTimer = null;
  function showToast(text) {
    var el = $("toast");
    el.textContent = text;
    el.classList.remove("show");
    void el.offsetWidth;               // restart transition
    el.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.classList.remove("show"); }, 4000);
  }

  // ---------- 2. Saved-places state + storage ----------
  // oros-maps-data — merge-ready shape (same envelope style as
  // todo/kanban: mtime per entity). registerSlice arrives in
  // Wave 5 together with the merge function — until then the
  // state is device-local ONLY (Wave 1/2 scope, by design).
  var STORAGE_KEY = "oros-maps-data";
  var DATA_VER = 1;

  // state = { ver: 1, places: [{ id, name, sub, lat, lon, mtime }] }
  var state = { ver: DATA_VER, places: [] };

  function load() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        var data = JSON.parse(raw);
        if (data && Array.isArray(data.places)) {
          state = {
            ver: DATA_VER,
            places: data.places.filter(function (p) {
              return typeof p.lat === "number" && typeof p.lon === "number";
            })
          };
          return;
        }
      }
    } catch (e) { /* corrupted → fresh start */ }
    save();
  }

  function save() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }
    catch (e) { /* quota — local-only app, nothing sensible to do */ }
    // NOTE: no __orosSyncApi.dirty() in Wave 2 — no slice yet.
    renderSavedLayer();
    renderPlacesList();
  }

  function placeById(id) {
    for (var i = 0; i < state.places.length; i++) {
      if (state.places[i].id === id) return state.places[i];
    }
    return null;
  }

  function isSaved(lat, lon) {
    return state.places.some(function (p) {
      return Math.abs(p.lat - lat) < 1e-9 && Math.abs(p.lon - lon) < 1e-9;
    });
  }

  // ---------- 3. Map init + tile layers ----------
  var map = null;
  var layerStandard, layerHumanitarian, layerSatellite;
  var savedLayer = null;        // layerGroup for saved-place pins

  function initMap() {
    map = L.map("map", {
      zoomControl: false,
      attributionControl: true
    }).setView(DEFAULT_CENTER, DEFAULT_ZOOM);

    L.control.zoom({ position: "topright" }).addTo(map);

    layerStandard = L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
    });
    layerHumanitarian = L.tileLayer("https://{s}.tile.openstreetmap.fr/hot/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors, <a href="https://www.hotosm.org/">HOT</a>'
    });
    layerSatellite = L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", {
      maxZoom: 19,
      attribution: "Tiles &copy; Esri — Source: Esri, Maxar, Earthstar Geographics"
    });

    layerStandard.addTo(map);   // default

    var layers = {};
    layers[t("layers.standard") || "Standard"] = layerStandard;
    layers[t("layers.humanitarian") || "Humanitarian"] = layerHumanitarian;
    layers[t("layers.satellite") || "Satellite"] = layerSatellite;
    L.control.layers(layers, null, { position: "topright", collapsed: true }).addTo(map);

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
  var ROUTE_PATH = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="6" cy="19" r="2"/><circle cx="18" cy="5" r="2"/><path d="M8 19h5a4 4 0 0 0 0-8H9a4 4 0 0 1 0-8h5" opacity="0"/></svg>';

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

  function getUserLocation(cb) {
    // cb(latLon | null) — cached-first (maximumAge does the caching)
    if (!("geolocation" in navigator)) { showToast(t("geo.unavailable")); cb(null); return; }
    setGeoLoading(true);
    navigator.geolocation.getCurrentPosition(
      function (pos) {
        setGeoLoading(false);
        placeUser(pos.coords.latitude, pos.coords.longitude, pos.coords.accuracy);
        showToast(t("geo.found"));
        cb(userPos);
      },
      function (err) {
        setGeoLoading(false);
        if (err.code === 1) showToast(t("geo.permission"));
        else showToast(t("geo.unavailable"));
        cb(null);
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 30 * 60 * 1000 }
    );
  }

  function placeUser(lat, lon, accuracy) {
    userPos = [lat, lon];
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
    b.textContent = t("geo.title");
    userMarker.bindPopup(b).openPopup();
  }

  function setGeoLoading(loading) {
    var btn = $("geo-btn");
    if (!btn) return;
    if (loading) { btn.classList.add("loading"); showToast(t("geo.searching")); }
    else btn.classList.remove("loading");
  }
  
    // ---------- 10. Search autocomplete (Nominatim) ----------
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

  function acFetch(query) {
    if (!navigator.onLine) { showToast(t("search.offline")); return; }
    var my = ++acSeq;
    acRenderLoading();

    fetch("https://photon.komoot.io/api/?limit=6&lang=" + LANG + "&q=" +
          encodeURIComponent(query))
      .then(function (r) { if (!r.ok) throw 0; return r.json(); })
      .then(function (json) {
        if (my !== acSeq) return;                 // stale — discard
        var hits = (json.features || []).map(function (f) {
          var p = (f.properties || {});
          var c = f.geometry && f.geometry.coordinates || [];
          var subParts = [p.city || p.town || p.village || p.county,
                          p.state, p.country].filter(Boolean);
          return { name: p.name || subParts[0] || "?",
                   sub: subParts.join(", "),
                   lat: parseFloat(c[1]), lon: parseFloat(c[0]) };
        }).filter(function (h) { return isFinite(h.lat) && isFinite(h.lon); });
        acRender(hits);
      })
      .catch(function () {
        if (my !== acSeq) return;
        acRenderEmpty();
      });
  }

  // Pick a result: drop a marker, popup with star / route actions.
  function pickResult(hit) {
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
      starSpan.textContent = on ? t("places.removed") : t("places.saved");
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
    route.innerHTML = ROUTE_PATH + "<span>" + (LANG === "el" ? "Διαδρομή" : "Route") + "</span>";
    route.addEventListener("click", function () {
      map.closePopup();
      startRouteTo(place);
    });
    actions.appendChild(route);

    wrap.appendChild(actions);
    marker.unbindPopup();
    marker.bindPopup(wrap, { maxWidth: 240 });
  }

  // ---------- 11. Routing (OSRM) ----------
  var PROFILE_OSRM = { car: "driving", bike: "bike", foot: "foot" };
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
  var restoring = false;     // true while restoreRoute() repaints — blocks calcRoute()

  function fmtDist(m) {
    if (m < 1000) return Math.round(m) + " m";
    return (m / 1000).toFixed(m < 10000 ? 1 : 0) + " km";
  }
  function fmtTime(sec) {
    var min = Math.round(sec / 60);
    if (min < 60) return min + " min";
    return Math.floor(min / 60) + " h " + (min % 60) + " min";
  }

  function setRouteProfile(p) {
    routeProfile = p;
    ["car", "bike", "foot"].forEach(function (k) {
      $("rp-" + k).classList.toggle("active", k === p);
    });
    if (routeFrom && routeTo && !restoring) calcRoute();   // re-route under new mode
  }

  function clearRoute() {
    if (routeLine) { map.removeLayer(routeLine); routeLine = null; }
    if (routeStartMarker) { map.removeLayer(routeStartMarker); routeStartMarker = null; }
    if (routeEndMarker) { map.removeLayer(routeEndMarker); routeEndMarker = null; }
    routeFrom = routeTo = null;
    lastSteps = []; lastDist = 0; lastDur = 0;
    routeCoords = [];
    cancelPick();
    if (navActive) stopNavigation();
    $("route-bar").hidden = true;
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
    function go(origin) {
      routeFrom = origin;
      routeTo = dest;
      calcRoute();
    }
    if (userPos) { go({ lat: userPos[0], lon: userPos[1], name: t("geo.title") }); return; }
    getUserLocation(function (pos) {
      if (pos) {
        showToast(t("route.fromUser"));
        go({ lat: pos[0], lon: pos[1], name: t("geo.title") });
      } else {
        var c = map.getCenter();
        showToast(t("route.fromCenter"));
        go({ lat: c.lat, lon: c.lng, name: "·" });
      }
    });
  }

  function calcRoute() {
    if (!routeFrom || !routeTo) return;
    if (!navigator.onLine) { showToast(t("route.err")); return; }

    var url = "https://router.project-osrm.org/route/v1/" + PROFILE_OSRM[routeProfile] + "/" +
      routeFrom.lon + "," + routeFrom.lat + ";" + routeTo.lon + "," + routeTo.lat +
      "?overview=full&geometries=geojson&steps=true";

    fetch(url)
      .then(function (r) { if (!r.ok) throw 0; return r.json(); })
      .then(function (json) {
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
          if (routeTo.name) bindPlacePopup(routeEndMarker, routeTo);
        } else {
          routeEndMarker.setLatLng([routeTo.lat, routeTo.lon]);
        }

        map.fitBounds(routeLine.getBounds(), { padding: [48, 48] });

        $("route-dist").textContent = fmtDist(r0.distance);
        $("route-time").textContent = fmtTime(r0.duration);
        $("route-bar").hidden = false;

        // Save steps for turn-by-turn panel
        lastSteps = (r0.legs && r0.legs[0] && r0.legs[0].steps) || [];
        lastDist = r0.distance;
        lastDur = r0.duration;
        routeCoords = (r0.geometry && r0.geometry.coordinates) || [];

        // Render maneuvers if panel is open or route just started
        renderManeuvers();

        // Fresh route during live nav → restart step tracking
        if (navActive) resetNavProgress();

        saveRoute();
      })
      .catch(function () {
        clearRoute();
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

  function getManeuverIcon(type, modifier) {
    // Simplified icon set based on maneuver type
    var base = 'width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"';
    if (type === "depart") {
      return '<svg '+base+'><path d="M4 12h8"/><path d="M12 16V8"/><path d="M12 8l-4 4M12 8l4 4"/></svg>';
    } else if (type === "arrive") {
      return '<svg '+base+'><circle cx="12" cy="12" r="3"/><circle cx="12" cy="12" r="7" opacity="0.3"/></svg>';
    } else if (type === "turn") {
      if (modifier === "left" || modifier === "slight left") {
        return '<svg '+base+'><path d="M7 18V6"/><path d="M7 6L4 9M7 6l3 3"/></svg>';
      } else {
        return '<svg '+base+'><path d="M17 18V6"/><path d="M17 6l3 3M17 6l-3 3"/></svg>';
      }
    } else if (type === "continue") {
      return '<svg '+base+'><path d="M3 12h18"/><path d="M3 12l4-4M3 12l4 4"/></svg>';
    } else if (type === "uturn") {
      return '<svg '+base+'><path d="M4 12a8 8 0 1 1 16 0v6"/><path d="M4 12l3-3M4 12l3 3"/></svg>';
    } else if (type === "roundabout") {
      return '<svg '+base+'><circle cx="12" cy="12" r="7"/><path d="M12 5v14M5 12h14"/></svg>';
    } else {
      // Default: straight arrow
      return '<svg '+base+'><path d="M12 5v14M12 19l-4-4M12 19l4-4"/></svg>';
    }
  }

  function formatManeuverText(step) {
    var type = step.maneuver.type || "depart";
    var modifier = step.maneuver.modifier || "";
    var name = step.name || step.ref || "";
    var dirKey = modifier ? "mvn.dir." + modifier : "mvn.dir.straight";

    if (type === "depart") return t("mvn.depart") + " " + t(dirKey);
    if (type === "arrive") return t("mvn.arrive") + (name ? " " + name : "");
    if (type === "turn") return t("mvn.turn").replace("{dir}", t(dirKey)) + (name ? t("mvn.on") : "").replace("{name}", name);
    if (type === "continue") return t("mvn.continue").replace("{dir}", t(dirKey)) + (name ? t("mvn.on") : "").replace("{name}", name);
    if (type === "uturn") return t("mvn.uturn");
    if (type === "roundabout") {
      var exit = step.maneuver.exit || 1;
      return t("mvn.roundabout").replace("{n}", exit);
    }
    if (type === "fork") {
      var d = t(modifier === "left" ? "mvn.dir.left" : "mvn.dir.right");
      return t("mvn.fork").replace("{dir}", d);
    }
    if (type === "merge") {
      var d = t(modifier ? "mvn.dir." + modifier : "mvn.dir.straight");
      return t("mvn.merge").replace("{dir}", d) + (name ? t("mvn.on") : "").replace("{name}", name);
    }
    if (type === "endofroad") {
      var d = t(modifier ? "mvn.dir." + modifier : "mvn.dir.straight");
      return t("mvn.endofroad").replace("{dir}", d);
    }
    if (type === "ramp" || type === "on ramp" || type === "off ramp") {
      var d = modifier ? t("mvn.dir." + modifier) : t("mvn.dir.straight");
      return (type === "off ramp" ? t("mvn.exitramp") : t("mvn.ramp")).replace("{dir}", d);
    }
    // Fallback: show street name if available
    return name || "?";
  }

  function cancelPick() {
    pickMode = null;
    document.body.classList.remove("pick");
    ["plan-btn", "route-setstart", "route-setend"].forEach(function (id) {
      var btn = $(id);
      if (btn) btn.classList.remove("on");
    });
  }

  // Click on map to set start/end point (manual override)
  function handleMapClick(e) {
    if (!pickMode) return;
    if (!navigator.onLine) { showToast(t("route.err")); cancelPick(); return; }

    var lat = e.latlng.lat;
    var lon = e.latlng.lng;
    var place = { lat: lat, lon: lon, name: "Point on map", sub: "" };

    if (pickMode === "start") {
      if (!routeTo) { showToast(t("route.nosteps")); cancelPick(); return; }
      routeFrom = place;
      showToast(t("route.fromCenter"));
    } else if (pickMode === "end") {
      if (!routeFrom) { showToast(t("route.nosteps")); cancelPick(); return; }
      routeTo = place;
      placeResult(lat, lon, place.name, place.sub);
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

  // Min distance from a point to the route vertices (m).
  // Vertex-based is good enough for a 55m deviation threshold.
  function distToRoute(lat, lon) {
    var best = Infinity;
    for (var i = 0; i < routeCoords.length; i++) {
      var c = routeCoords[i];
      var d = hav(lat, lon, c[1], c[0]);
      if (d < best) best = d;
    }
    return best;
  }

  // ---------- Voice (Web Speech API, browser-native) ----------
  function speak(text) {
    if (navMuted) return;
    if (!("speechSynthesis" in window)) return;   // HUD still works
    try {
      var u = new SpeechSynthesisUtterance(text);
      u.lang = LANG === "el" ? "el-GR" : "en-US"; // follows UI setting
      u.rate = 1;
      window.speechSynthesis.cancel();            // never queue behind
      window.speechSynthesis.speak(u);
    } catch (e) { /* speech unavailable — HUD carries the info */ }
  }

  // ---------- HUD painting ----------
  function navPaintHUD(nxt, dn, speedMs) {
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
        ? Math.round(speedMs * 3.6) + " km/h" : "—";
    var rem = 0;
    for (var i = navCurStepIdx; i < lastSteps.length; i++) rem += lastSteps[i].duration || 0;
    $("nav-eta").textContent = fmtTime(rem);
  }

  function resetNavProgress() {
    navCurStepIdx = 0;
    navSpokenFar = false;
    navPaintHUD(lastSteps[1] || null, null, null);
  }

  // ---------- Position tick: follow, announce, advance, re-route ----------
  function navTick(pos) {
    if (!navActive) return;
    var lat = pos.coords.latitude, lon = pos.coords.longitude;
    userPos = [lat, lon];
    map.setView([lat, lon], 17, { animate: true });

    // Deviation → re-route (12s debounce so OSRM isn't hammered)
    if (routeCoords.length && Date.now() - navRerouteAt > 12000) {
      if (distToRoute(lat, lon) > 55) {
        navRerouteAt = Date.now();
        routeFrom = { lat: lat, lon: lon, name: t("geo.title") };
        showToast(t("nav.rerouting"));
        calcRoute();          // PATCH-21 restarts step tracking on success
        return;
      }
    }

    var nxt = lastSteps[navCurStepIdx + 1];

    if (!nxt) {
      // Traversing the final step → watch for arrival
      if (routeTo && hav(lat, lon, routeTo.lat, routeTo.lon) < 35) { navFinish(); return; }
      navPaintHUD(null, routeTo ? hav(lat, lon, routeTo.lat, routeTo.lon) : null, pos.coords.speed);
      return;
    }

    var loc = nxt.maneuver && nxt.maneuver.location;
    var dn = loc ? hav(lat, lon, loc[1], loc[0]) : null;

    // Pre-announcement (~350m before the maneuver)
    if (dn !== null && !navSpokenFar && dn < 350) {
      navSpokenFar = true;
      speak(fmtDist(dn) + " — " + formatManeuverText(nxt));
    }
    // Crossing the maneuver point → advance + speak the step we now enter
    if (dn !== null && dn < 40) {
      navCurStepIdx++;
      navSpokenFar = false;
      speak(formatManeuverText(lastSteps[navCurStepIdx]));
      return;
    }
    navPaintHUD(nxt, dn, pos.coords.speed);
  }

  function navFinish() {
    speak(t("mvn.arrive"));
    showToast(t("nav.arrived"));
    stopNavigation();
  }

  // ---------- Start / stop ----------
  function startNavigation() {
    if (!lastSteps.length) { showToast(t("route.nosteps")); return; }
    if (userPos) { beginNav(); return; }
    getUserLocation(function (pos) {
      if (pos) beginNav();
      else showToast(t("toast.noLocYet"));
    });
  }

  function beginNav() {
    navActive = true;
    navRerouteAt = Date.now();
    document.body.classList.add("nav");
    $("nav-hud").hidden = false;
    resetExitConfirm();
    map.closePopup();
    map.setView(userPos, 17, { animate: true });
    resetNavProgress();
    speak(formatManeuverText(lastSteps[0]));    // "Head out …"
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

  // ========== OFFLINE LAYER (Wave 5) ==========
  // Last-known-route persistence: full route snapshot so the app
  // is useful in degraded (offline) mode — polyline, steps, bar.
  function saveRoute() {
    if (!routeFrom || !routeTo || !routeCoords.length) return;
    try {
      localStorage.setItem(ROUTE_STORAGE_KEY, JSON.stringify({
        ver: 1,
        from: routeFrom, to: routeTo,
        profile: routeProfile,
        geometry: { type: "LineString", coordinates: routeCoords },
        steps: lastSteps, distance: lastDist, duration: lastDur
      }));
    } catch (e) { /* quota — degraded: next successful route retries */ }
    updateRouteSavedInfo();
  }

  function restoreRoute() {
    var data;
    try { data = JSON.parse(localStorage.getItem(ROUTE_STORAGE_KEY) || "null"); }
    catch (e) { return false; }
    if (!data || !data.from || !data.to ||
        !Array.isArray(data.geometry.coordinates)) return false;

    routeFrom = data.from; routeTo = data.to;
    routeProfile = PROFILE_OSRM[data.profile] ? data.profile : "car";
    lastSteps = Array.isArray(data.steps) ? data.steps : [];
    lastDist = data.distance || 0;
    lastDur = data.duration || 0;
    routeCoords = data.geometry.coordinates;

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
      if (routeTo.name) bindPlacePopup(routeEndMarker, routeTo);
    } else { routeEndMarker.setLatLng([routeTo.lat, routeTo.lon]); }

    restoring = true;
    setRouteProfile(routeProfile);        // paints profile buttons only — no OSRM call
    restoring = false;
    $("route-dist").textContent = fmtDist(lastDist);
    $("route-time").textContent = fmtTime(lastDur);
    $("route-bar").hidden = false;

    map.fitBounds(routeLine.getBounds(), { padding: [48, 48] });
    showToast(t("route.restored"));
    return true;
  }

  // ---------- Settings drawer: tile stats / clear / route forget ----------
  function updateTileStats() {
    var host = $("tile-stats");
    if (!("caches" in window)) { host.textContent = t("settings.tiles.none"); return; }
    caches.open(TILE_CACHE_NAME).then(function (cache) {
      return cache.keys().then(function (keys) {
        if (!keys.length) { host.textContent = t("settings.tiles.none"); return; }
        var base = keys.length + " ";
        if (navigator.storage && navigator.storage.estimate) {
          navigator.storage.estimate().then(function (est) {
            host.textContent = base + "· ~" + (est.usage / 1048576).toFixed(1) + " MB";
          }).catch(function () {
            host.textContent = base;
          });
        } else {
          host.textContent = base;
        }
      });
    }).catch(function () { host.textContent = t("settings.tiles.none"); });
  }

  function clearTileCache() {
    if (!("caches" in window)) return;
    caches.delete(TILE_CACHE_NAME).then(function () {
      updateTileStats();
      showToast(t("settings.tiles.clear"));
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
  function addPlace(place) {
    state.places.push({
      id: uid(), name: place.name || "?", sub: place.sub || "",
      lat: place.lat, lon: place.lon, mtime: Date.now()
    });
    save();
    showToast(t("places.saved"));
  }

  function removePlace(lat, lon) {
    state.places = state.places.filter(function (p) {
      return !(Math.abs(p.lat - lat) < 1e-9 && Math.abs(p.lon - lon) < 1e-9);
    });
    save();
    showToast(t("places.removed"));
  }

  function removePlaceById(id) {
    state.places = state.places.filter(function (p) { return p.id !== id; });
    save();
    showToast(t("places.removed"));
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

    state.places.forEach(function (p) {
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
    fetch("https://photon.komoot.io/api/?limit=1&lang=" + LANG + "&q=" +
          encodeURIComponent(query))
      .then(function (r) { if (!r.ok) throw 0; return r.json(); })
      .then(function (json) {
        var f = json.features && json.features[0];
        if (!f || !f.geometry) { showToast(t("search.empty")); return; }
        var c = f.geometry.coordinates;
        var p = f.properties || {};
        var subParts = [p.city || p.town || p.village || p.county,
                        p.state, p.country].filter(Boolean);
        placeResult(parseFloat(c[1]), parseFloat(c[0]),
                    label || p.name || query, subParts.join(", "));
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
      if (q.length < AC_MIN) { acClose(); return; }
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
        if (acIndex >= 0 && acResults[acIndex]) pickResult(acResults[acIndex]);
      } else if (e.key === "Escape") {
        acClose();
      }
    });
    $("search-clear").addEventListener("click", function () {
      $("search").value = "";
      $("search-clear").hidden = true;
      acClose();
      acResults = [];
      $("search").focus();
    });

    // Geolocation button
    $("geo-btn").addEventListener("click", function () {
      getUserLocation(function () {});
    });

    // Plan a route button — enters pick mode
    $("plan-btn").addEventListener("click", function () {
      var btn = $("plan-btn");
      if (pickMode === "start") { cancelPick(); return; }
      pickMode = "start";
      document.body.classList.add("pick");
      btn.classList.add("on");
      showToast(t("route.pick.start"));
    });

    // Set start / end buttons
    $("route-setstart").addEventListener("click", function () {
      var btn = $("route-setstart");
      if (pickMode === "start") { cancelPick(); return; }
      pickMode = "start";
      document.body.classList.add("pick");
      btn.classList.add("on");
      showToast(t("route.pick.start"));
    });
    $("route-setend").addEventListener("click", function () {
      var btn = $("route-setend");
      if (pickMode === "end") { cancelPick(); return; }
      pickMode = "end";
      document.body.classList.add("pick");
      btn.classList.add("on");
      showToast(t("route.pick.end"));
    });

    // Route profiles + clear
    $("rp-car").addEventListener("click", function () { setRouteProfile("car"); });
    $("rp-bike").addEventListener("click", function () { setRouteProfile("bike"); });
    $("rp-foot").addEventListener("click", function () { setRouteProfile("foot"); });
    $("route-clear").addEventListener("click", clearRoute);

    // Steps button — toggle maneuvers panel
    $("steps-btn").addEventListener("click", function () {
      if (!lastSteps.length) { showToast(t("route.nosteps")); return; }
      var panel = $("maneuvers");
      panel.hidden = !panel.hidden;
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
      if (!$("places").hidden) $("places").hidden = true;
      if (!$("maneuvers").hidden) {
        $("maneuvers").hidden = true;
        $("steps-btn").classList.remove("on");
      }
      if (pickMode) cancelPick();
    });

    // Map click handler (pick mode)
    map.on("click", handleMapClick);

    // Settings drawer (Wave 5)
    $("mapsettings-btn").addEventListener("click", function () {
      var panel = $("mapsettings");
      panel.hidden = !panel.hidden;
      if (!panel.hidden) {
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
  var bootedViaBridge = false;
  try { bootedViaBridge = !!sessionStorage.getItem("oros-maps-open"); }
  catch (e) { bootedViaBridge = false; }

  /* Wave 6: standalone deep-link (?q=…) — bookmark/contact cards
     opening Maps in a new tab land here. Geocode + marker, and
     suppress the welcome toast (it's a bridge boot). */
  try {
    var urlQ = new URLSearchParams(location.search).get("q");
    if (urlQ && urlQ.trim()) {
      bootedViaBridge = true;
      geocodeAndShow(urlQ.trim(), "");
    }
  } catch (e) {}

  consumePending();
  restoreRoute();
  initOfflineChip();

  setTimeout(function () {
    if (!bootedViaBridge && !localStorage.getItem(ROUTE_STORAGE_KEY)) {
      showToast(t("toast.welcome"));
    }
  }, 800);
})();