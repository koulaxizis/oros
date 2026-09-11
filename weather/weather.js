// ============================================================
// orOS Weather — App logic (v0.3.0)
// Provider: Open-Meteo (no key, no cookies). One forecast
// request per refresh: current + hourly 48h + daily 7d,
// timezone=auto. Feels-like/humidity/UV derive from the hourly
// array at the current hour (current_weather carries neither).
// Wave 2: units toggle (render-only), UV, sun times, AQI
// (serial second request, optional), smart hints, city pager.
// v0.3.0 — audit fixes: timezone-correct "now" (utc_offset_seconds
// from the RESPONSE, not the device clock — Tokyo ≠ Serres),
// undo-toast deletion (native confirm() retired), no-data state,
// NaN guards, pointercancel cleanup, UV/AQI band words + legend
// tooltips with extended data-levels (WHO UV / European AQI).
// Sections:
//   1. Constants, i18n, helpers, icons
//   2. Data model + storage (cities, tombstones, cache)
//   2b. Merge engine lite (todo-contract, compact)
//   3. API: geocoding + forecast + AQI + throttle
//   4. Render
//   5. Sync slice + palette
//   6. Wiring & boot
// Data:
//   slice "oros-weatherapp-data"  → travels (cities + units)
//   cache "oros-weatherapp-cache" → device-local, NEVER in slice
// Offline: render from cache + badge — never fake numbers.
// Cache/slice ALWAYS metric — units decorate at render time.
// ============================================================
(function () {
  "use strict";

  var STORAGE_KEY  = "oros-weatherapp-data";
  var CACHE_KEY    = "oros-weatherapp-cache";
  var DATA_VER     = 1;
  var FETCH_GAP_MS = 30 * 60 * 1000;   // min gap between forecast fetches
  var CACHE_MAX    = 6;                // cities kept in device cache

  var netDown = false;   // last fetch attempt FAILED while online
                         // (truth from the network, not navigator.onLine)

  // ---------- 1. Constants, i18n, helpers, icons ----------
  var LANG = localStorage.getItem("oros-lang") === "el" ? "el" : "en";

  var STRINGS = {
    en: {
      "refresh":       "Refresh",
      "offline":       "Offline — showing last known",
      "empty.title":   "No city yet",
      "empty.hint":    "Tap the city button above to add one.",
      "meta.feels":    "Feels like",
      "meta.humidity": "Humidity",
      "meta.wind":     "Wind",
      "meta.uv":       "UV index",
      "meta.sun":      "Sun",
      "meta.aqi":      "Air quality",
      "units.tip":     "Switch °C / °F",
      "hourly.title":  "Next 48 hours",
      "daily.title":   "7-day forecast",
      "dlg.title":     "Cities",
      "dlg.input":     "City name…",
      "dlg.add":       "Add",
      "dlg.del":       "Delete city",
      "dlg.del.done":  "Deleted",
      "dlg.del.undo":  "Undo",
      "updated.at":    "Updated",
      "err.fetch":     "Could not fetch weather — check connection",
      "err.notfound":  "City not found",
      "err.exists":    "Already in the list",
      "err.gps":       "Location unavailable",
      "err.nodata":    "No saved data for this city yet",
      "gps.use":       "Use my location",
      "now":           "Now",
      "hint.storm":    "Storms around — take cover",
      "hint.rain":     "Umbrella day",
      "hint.fog":      "Fog patches — slow down",
      "hint.uv":       "High UV — wear sunscreen",
      "hint.hot":      "Hot one — stay hydrated",
      "hint.cold":     "Freezing temperatures",
      "hint.swing":    "Layer up — big day-night swing",
      "hint.mild":     "A pleasant day",
      "uv.low":        "Low",
      "uv.mod":        "Moderate",
      "uv.high":       "High",
      "uv.vhigh":      "Very high",
      "uv.ext":        "Extreme",
      "uv.legend":     "WHO scale: 0–2 Low · 3–5 Moderate · 6–7 High · 8–10 Very high · 11+ Extreme",
      "aqi.good":      "Good",
      "aqi.fair":      "Fair",
      "aqi.moderate":  "Moderate",
      "aqi.poor":      "Poor",
      "aqi.vpoor":     "Very poor",
      "aqi.epoor":     "Extremely poor",
      "aqi.legend":    "European AQI: ≤20 Good · ≤40 Fair · ≤60 Moderate · ≤80 Poor · ≤100 Very poor · >100 Extremely poor"
    },
    el: {
      "refresh":       "Ανανέωση",
      "offline":       "Εκτός σύνδεσης — εμφανίζονται τα τελευταία δεδομένα",
      "empty.title":   "Καμία πόλη ακόμα",
      "empty.hint":    "Πάτησε το κουμπί πόλης παραπάνω για προσθήκη.",
      "meta.feels":    "Αίσθηση",
      "meta.humidity": "Υγρασία",
      "meta.wind":     "Άνεμος",
      "meta.uv":       "Δείκτης UV",
      "meta.sun":      "Ήλιος",
      "meta.aqi":      "Ποιότητα αέρα",
      "units.tip":     "Αλλαγή °C / °F",
      "hourly.title":  "Επόμενες 48 ώρες",
      "daily.title":   "Πρόγνωση 7 ημερών",
      "dlg.title":     "Πόλεις",
      "dlg.input":     "Όνομα πόλης…",
      "dlg.add":       "Προσθήκη",
      "dlg.del":       "Διαγραφή πόλης",
      "dlg.del.done":  "Διαγράφηκε",
      "dlg.del.undo":  "Αναίρεση",
      "updated.at":    "Ενημερώθηκε",
      "err.fetch":     "Δεν έγινε λήψη — έλεγξε τη σύνδεση",
      "err.notfound":  "Δεν βρέθηκε η πόλη",
      "err.exists":    "Υπάρχει ήδη στη λίστα",
      "err.gps":       "Η τοποθεσία δεν είναι διαθέσιμη",
      "err.nodata":    "Δεν υπάρχουν αποθηκευμένα δεδομένα ακόμα",
      "gps.use":       "Χρήση τοποθεσίας",
      "now":           "Τώρα",
      "hint.storm":    "Καταιγίδες — απόφυγε την έκθεση",
      "hint.rain":     "Μέρα για ομπρέλα",
      "hint.fog":      "Ομίχλη — προσοχή στην οδήγηση",
      "hint.uv":       "Υψηλή UV — αντηλιακό",
      "hint.hot":      "Ζέστη — πίνε νερό",
      "hint.cold":     "Παγωμένες θερμοκρασίες",
      "hint.swing":    "Πάρε ζακέτα — μεγάλη διακύμανση",
      "hint.mild":     "Ωραία μέρα",
      "uv.low":        "Χαμηλό",
      "uv.mod":        "Μέτριο",
      "uv.high":       "Υψηλό",
      "uv.vhigh":      "Πολύ υψηλό",
      "uv.ext":        "Ακραίο",
      "uv.legend":     "Κλίμακα WHO: 0–2 Χαμηλό · 3–5 Μέτριο · 6–7 Υψηλό · 8–10 Πολύ υψηλό · 11+ Ακραίο",
      "aqi.good":      "Καλή",
      "aqi.fair":      "Αρκετή",
      "aqi.moderate":  "Μέτρια",
      "aqi.poor":      "Κακή",
      "aqi.vpoor":     "Πολύ κακή",
      "aqi.epoor":     "Εξαιρετικά κακή",
      "aqi.legend":    "Ευρωπαϊκός AQI: ≤20 Καλή · ≤40 Αρκετή · ≤60 Μέτρια · ≤80 Κακή · ≤100 Πολύ κακή · >100 Εξαιρετικά κακή"
    }
  };

  function t(key) {
    var p = STRINGS[LANG] || STRINGS.en;
    return p[key] !== undefined ? p[key]
         : (STRINGS.en[key] !== undefined ? STRINGS.en[key] : key);
  }

  // WMO codes → condition text (same grouping as the shell chip)
  function condText(code) {
    var c = Number(code) || 0;
    var en, el;
    if (c === 0)                 { en = "Clear sky";     el = "Καθαρός ουρανός"; }
    else if (c === 1 || c === 2) { en = "Partly cloudy"; el = "Λίγες νεφώσεις"; }
    else if (c === 3)            { en = "Overcast";      el = "Συννεφιά"; }
    else if (c === 45 || c === 48) { en = "Fog";         el = "Ομίχλη"; }
    else if (c >= 51 && c <= 57) { en = "Drizzle";       el = "Ψιλή βροχή"; }
    else if (c >= 58 && c <= 67) { en = "Rain";         el = "Βροχή"; }
    else if (c >= 71 && c <= 77) { en = "Snow";         el = "Χιόνι"; }
    else if (c >= 80 && c <= 82) { en = "Showers";       el = "Μπόρες"; }
    else if (c === 85 || c === 86) { en = "Snow showers"; el = "Χιονοπτώσεις"; }
    else if (c >= 95)            { en = "Thunderstorm"; el = "Καταιγίδα"; }
    else                         { en = "Cloudy";        el = "Νεφελώδης"; }
    return LANG === "el" ? el : en;
  }

  // One-line smart hint for the day — replaces the plain condition
  // text under the temperature (cur-cond). Priority: storm > fog >
  // rain > UV > heat > cold > swing > mild default.
  function pickHint(p) {
    if (!p || !p.current) return null;
    var code = Number(p.current.code) || 0;
    var maxPop = 0, dmax = null, dmin = null;
    (p.daily || []).forEach(function (d) {
      if (d.pop > maxPop) maxPop = d.pop;
      if (d.max !== null && (dmax === null || d.max > dmax)) dmax = d.max;
      if (d.min !== null && (dmin === null || d.min < dmin)) dmin = d.min;
    });
    if (code >= 95) return t("hint.storm");
    if (code === 45 || code === 48) return t("hint.fog");
    if (maxPop >= 60 || (code >= 51 && code <= 67) || (code >= 80 && code <= 82)) return t("hint.rain");
    if (p.current.uv !== null && p.current.uv >= 6) return t("hint.uv");
    if (dmax !== null && dmax >= 33) return t("hint.hot");
    if (dmin !== null && dmin <= 0) return t("hint.cold");
    if (dmax !== null && dmin !== null && (dmax - dmin) > 12) return t("hint.swing");
    return t("hint.mild");
  }

  // WHO UV bands: 0–2 low · 3–5 moderate · 6–7 high · 8–10 very
  // high · 11+ extreme. Measured in erythemal (skin-reddening)
  // solar radiation — the number tells you HOW fast unprotected
  // skin burns; the band word tells the user what to DO.
  function uvBand(v) {
    if (v <= 2)  return t("uv.low");
    if (v <= 5)  return t("uv.mod");
    if (v <= 7)  return t("uv.high");
    if (v <= 10) return t("uv.vhigh");
    return t("uv.ext");
  }

  // European AQI levels: 0–100+ (NOT a percentage — it CAN exceed
  // 100 in extreme pollution). Composite index: the WORST of the
  // pollutants (PM2.5, PM10, ozone, NO2, SO2) picks the zone.
  function aqiLevel(v) {
    if (v <= 20)  return "good";
    if (v <= 40)  return "fair";
    if (v <= 60)  return "moderate";
    if (v <= 80)  return "poor";
    if (v <= 100) return "vpoor";
    return "epoor";
  }

  // Same WMO SVG set as the shell chip — one visual language.
  var SA = 'width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"';
  var WX_SUN   = '<svg ' + SA + ' stroke-width="1.8" stroke-linecap="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"/></svg>';
  var WX_MOON  = '<svg ' + SA + ' stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>';
  var WX_PART  = '<svg ' + SA + ' stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="7" cy="7" r="3"/><path d="M7 1v1M7 12v1M1 7h1M11 7h1"/><path d="M12 19a4 4 0 0 1 0-8 5 5 0 0 1 9.6 1.5A3.5 3.5 0 0 1 20 19z"/></svg>';
  var WX_CLOUD = '<svg ' + SA + ' stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z"/></svg>';
  var WX_FOG   = '<svg ' + SA + ' stroke-width="1.8" stroke-linecap="round"><path d="M4 13h16M6 16.5h12M8 19h8"/></svg>';
  var WX_RAIN  = '<svg ' + SA + ' stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z" opacity="0.55"/><path d="M8 19l-1 2M12 19l-1 2M16 19l-1 2"/></svg>';
  var WX_SNOW  = '<svg ' + SA + ' stroke-width="1.8" stroke-linecap="round"><path d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z" opacity="0.45"/><path d="M8 20h.01M12 20h.01M16 20h.01"/></svg>';
  var WX_STORM = '<svg ' + SA + ' stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M18 9h-1.26A8 8 0 1 0 9 19h9a5 5 0 0 0 0-10z" opacity="0.55"/><polyline points="13 11 9 15 13 15 11 19 17 12 13.5 12 15 9"/></svg>';

  // Night judgment: KNOWN city-local hour (caller passes it) or
  // device clock as legacy fallback. Hour param is local wall
  // time (0–23) — hourly/daily rows carry it in their ISO time.
  function isNightHour(h) {
    return h < 6 || h >= 21;
  }
  function iconFor(code, hour) {
    var c = Number(code) || 0;
    var night = (typeof hour === "number")
      ? isNightHour(hour)
      : (new Date().getHours() < 6 || new Date().getHours() >= 21);
    if (c === 0)                    return night ? WX_MOON : WX_SUN;
    if (c === 1 || c === 2)          return night ? WX_MOON : WX_PART;
    if (c === 3)                    return WX_CLOUD;
    if (c === 45 || c === 48)       return WX_FOG;
    if (c >= 51 && c <= 67)         return WX_RAIN;
    if (c >= 71 && c <= 77)         return WX_SNOW;
    if (c >= 80 && c <= 82)         return WX_RAIN;
    if (c === 85 || c === 86)       return WX_SNOW;
    if (c >= 95)                    return WX_STORM;
    return WX_CLOUD;
  }

  function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }
  function $(id) { return document.getElementById(id); }
  function pad(n) { return (n < 10 ? "0" : "") + n; }
  function idOf(c) { return c.id; }

  // "YYYY-MM-DDTHH:00" for NOW, expressed in the timezone given by
  // offSec (seconds east of UTC). Open-Meteo (timezone=auto)
  // returns hourly/daily/AQI times in the CITY's local wall clock —
  // the DEVICE's own hour is wrong by hours for distant cities
  // (Serres vs Tokyo sliced the old way at ±6 rows). Shift the
  // epoch by the offset, read UTC fields: local-city "now".
  function nowKeyAt(offSec) {
    var d = new Date(Date.now() + offSec * 1000);
    return d.getUTCFullYear() + "-" + pad(d.getUTCMonth() + 1) + "-" +
           pad(d.getUTCDate()) + "T" + pad(d.getUTCHours()) + ":00";
  }

  // Unit conversions — display ONLY. Cache + slice always stay
  // metric (portable); these decorate at render time.
  function fmtTemp(c) {
    if (c === null || c === undefined || isNaN(Number(c))) return "—";
    return Math.round(state.units === "imperial"
      ? (c * 9 / 5 + 32) : c) + "°";
  }
    function fmtSpeed(kmh) {
    if (kmh === null || kmh === undefined || isNaN(Number(kmh))) return "—";
    var v = state.units === "imperial" ? kmh * 0.621371 : kmh;
    return Math.round(v) + (state.units === "imperial" ? " mph" : " km/h");
  }

  // ---------- 2. Data model + storage ----------
  // state = {
  //   ver: 1, sm, om,
  //   active: <cityId> | null,
  //   deleted: { <cityId>: <tombstone ts> },
  //   cities: [{ id, label, lat, lon, mtime, pos }],
  //   shellWx: <fingerprint|null>,  units: "metric"|"imperial"
  // }
  var state = null;

  function newCityObj(label, lat, lon) {
    return { id: uid(), label: label, lat: lat, lon: lon,
             mtime: Date.now(), pos: 0 };
  }

  function defaultState() {
    return {
      ver: DATA_VER, sm: Date.now(), om: Date.now(),
      active: null, deleted: {}, cities: [],
      shellWx: null,      // last shell-menu location we applied (fingerprint)
      units: "metric"     // "metric" | "imperial" — RENDER ONLY, cache stays °C/km/h
    };
  }

  function migrate(data) {
    if (!data || !Array.isArray(data.cities)) return null;
    if (typeof data.sm !== "number") data.sm = 0;
    if (typeof data.om !== "number") data.om = 0;
    if (!data.deleted || typeof data.deleted !== "object") data.deleted = {};
    data.cities.forEach(function (c) {
      if (typeof c.mtime !== "number") c.mtime = 0;
      if (typeof c.pos !== "number") c.pos = 0;
    });
    if (data.shellWx === undefined) data.shellWx = null;   // pre-0.19.3 data
    if (data.units !== "metric" && data.units !== "imperial") data.units = "metric";
    data.ver = DATA_VER;
    return data;
  }

  function load() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        var data = migrate(JSON.parse(raw));
        if (data) { state = data; return; }
      }
    } catch (e) { /* corrupted → fresh */ }
    state = defaultState();
    save();
  }

  function save() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }
    catch (e) { /* quota */ }
    if (window.__orosSyncApi) window.__orosSyncApi.dirty();
  }

  function cityById(id) {
    for (var i = 0; i < state.cities.length; i++) {
      if (state.cities[i].id === id) return state.cities[i];
    }
    return null;
  }
  function activeCity() {
    return cityById(state.active) || state.cities[0] || null;
  }

  // --- Device-local forecast cache (map cityId → payload) ---
  function readCacheMap() {
    try {
      var m = JSON.parse(localStorage.getItem(CACHE_KEY));
      if (m && typeof m === "object") return m;
    } catch (e) {}
    return {};
  }
  function readCityCache(cityId) {
    return readCacheMap()[cityId] || null;
  }
  function writeCityCache(cityId, payload) {
    var m = readCacheMap();
    m[cityId] = payload;
    var keys = Object.keys(m);
    if (keys.length > CACHE_MAX) {
      keys.sort(function (x, y) { return (m[x].at || 0) - (m[y].at || 0); });
      while (keys.length > CACHE_MAX) delete m[keys.shift()];
    }
    try { localStorage.setItem(CACHE_KEY, JSON.stringify(m)); } catch (e) {}
  }

  // ---------- 2b. Merge engine lite (todo-contract, compact) ----------
  // Deterministic + symmetric: merge(A,B) === merge(B,A).
  //   · active — LWW by root sm; ties by lexicographic JSON
  //   · units + shellWx — same scalars side as active (LWW by sm)
  //   · cities — union by id, content LWW by mtime
  //     (ties by lexicographic JSON — identical both sides)
  //   · ordering — the side with larger om donates positions;
  //     unknown cities append at the end (older mtime first)
  //   · tombstones — union with max ts; deletion beats older
  //     edits, an edit newer than its tombstone resurrects.
  //     (The undo-delete toast RELIES on this: the resurrected
  //     city re-enters with same id + fresh mtime > tombstone.)

  function newerCity(a, b) {
    if ((a.mtime || 0) !== (b.mtime || 0)) {
      return (a.mtime || 0) > (b.mtime || 0) ? a : b;
    }
    return JSON.stringify(a) >= JSON.stringify(b) ? a : b;
  }

  function mergeWeatherStates(A, B) {
    var a = A || {}, b = B || {};

    // tombstones: union, max ts
    var tomb = {};
    Object.keys(a.deleted || {}).forEach(function (id) { tomb[id] = a.deleted[id]; });
    Object.keys(b.deleted || {}).forEach(function (id) {
      tomb[id] = Math.max(tomb[id] || 0, b.deleted[id]);
    });

    // scalars: the winning side donates active AND units AND
    // shellWx — losing them on merge wiped the units toggle and
    // resurrected deleted shell cities (fingerprint reset).
    var sa = JSON.stringify([a.active || null]);
    var sb = JSON.stringify([b.active || null]);
    var scalars = (a.sm || 0) !== (b.sm || 0)
      ? ((a.sm || 0) > (b.sm || 0) ? a : b)
      : (sa >= sb ? a : b);

    // cities: union by id, LWW content, tombstone-aware
    var map = {};
    (a.cities || []).forEach(function (c) { map[c.id] = c; });
    (b.cities || []).forEach(function (c) {
      map[c.id] = map[c.id] ? newerCity(map[c.id], c) : c;
    });
    var alive = [];
    Object.keys(map).forEach(function (id) {
      var ts = tomb[id];
      if (ts === undefined || (map[id].mtime || 0) > ts) alive.push(map[id]);
    });

    // ordering reference: larger om wins; ties by id-sequence JSON
    var ref;
    if ((a.om || 0) !== (b.om || 0)) {
      ref = (a.om || 0) > (b.om || 0) ? (a.cities || []) : (b.cities || []);
    } else {
      var ka = JSON.stringify((a.cities || []).map(idOf));
      var kb = JSON.stringify((b.cities || []).map(idOf));
      ref = ka >= kb ? (a.cities || []) : (b.cities || []);
    }
    var idx = {};
    ref.forEach(function (c, i) { idx[c.id] = i; });
    alive.sort(function (x, y) {
      var ix = idx[x.id] !== undefined ? idx[x.id] : Infinity;
      var iy = idx[y.id] !== undefined ? idx[y.id] : Infinity;
      if (ix !== iy) return ix - iy;
      if ((x.mtime || 0) !== (y.mtime || 0)) return (x.mtime || 0) - (y.mtime || 0);
      return x.id < y.id ? -1 : (x.id > y.id ? 1 : 0);
    });
    alive.forEach(function (c, i) { c.pos = i; });

    var out = {
      ver: DATA_VER,
      sm: Math.max(a.sm || 0, b.sm || 0),
      om: Math.max(a.om || 0, b.om || 0),
      active: scalars.active,
      units: (scalars.units === "imperial") ? "imperial" : "metric",
      shellWx: scalars.shellWx || null,
      deleted: tomb,
      cities: alive
    };
    // post-condition: active must point at a living city
    var ok = out.cities.some(function (c) { return c.id === out.active; });
    if (!ok) out.active = out.cities.length ? out.cities[0].id : null;
    return out;
  }

  // ---------- 3. API: geocoding + forecast + AQI + throttle ----------
  function geocodeCity(name) {
    return fetch("https://geocoding-api.open-meteo.com/v1/search?count=1&language=" +
                 (LANG === "el" ? "el" : "en") +
                 "&name=" + encodeURIComponent(name))
      .then(function (r) { return r.json(); })
      .then(function (d) {
        var g = d && d.results && d.results[0];
        if (!g) throw new Error("notfound");
        return { lat: g.latitude, lon: g.longitude, label: g.name };
      });
  }

  // Autocomplete — geocoding suggestions from the 3rd character.
  // Debounced (network-friendly), tokened (stale responses die),
  // offline-aware (never suggests while offline).
  var AC_MIN = 3, AC_DELAY = 250;
  var acTimer = null, acToken = 0, acSel = -1, acList = [];

  function geocodeSuggest(q) {
    var tok = ++acToken;
    return fetch("https://geocoding-api.open-meteo.com/v1/search?count=5&language=" +
                 (LANG === "el" ? "el" : "en") +
                 "&name=" + encodeURIComponent(q))
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (tok !== acToken) return [];   // stale response — discard
        return (d && d.results) || [];
      })
      .catch(function () { return []; });
  }

  function hideAc() {
    acSel = -1; acList = [];
    var h = $("ac-host");
    if (h) h.hidden = true;
  }

  function renderAc(list) {
    acList = list; acSel = -1;
    var h = $("ac-host");
    if (!h) return;
    h.innerHTML = "";
    if (list.length === 0) {
      var none = document.createElement("div");
      none.className = "ac-none";
      none.textContent = t("err.notfound");
      h.appendChild(none);
    } else {
      list.forEach(function (g, i) {
        var it = document.createElement("button");
        it.type = "button";
        it.className = "ac-item";
        var nm = document.createElement("span");
        nm.className = "ac-name";
        nm.textContent = g.name;
        var rg = document.createElement("span");
        rg.className = "ac-sub";
        rg.textContent = [g.admin1, g.country].filter(Boolean).join(", ");
        it.appendChild(nm); it.appendChild(rg);
        it.addEventListener("mousedown", function (ev) {
          ev.preventDefault();            // mousedown beats blur-hide
          pickAc(acList[i]);
        });
        h.appendChild(it);
      });
    }
    h.hidden = false;
  }

  function paintAcSel() {
    var items = document.querySelectorAll(".ac-item");
    for (var i = 0; i < items.length; i++) {
      items[i].classList.toggle("sel", i === acSel);
    }
  }

  function pickAc(g) {
    hideAc();
    addCity({ lat: g.latitude, lon: g.longitude, label: g.name });
  }

  // European AQI (0..100+) — SEPARATE Open-Meteo endpoint, fired
  // SERIALLY after the forecast lands. Failure = null → the cell
  // shows a dim "—" — never blocks, never badges, never fakes.
  // v0.3.0: nowKey comes IN (computed by the caller from the
  // forecast response's utc_offset_seconds) — this endpoint also
  // returns timezone=auto times, so the SAME city-local key aligns
  // both arrays. The device clock is never consulted.
  function fetchAqi(lat, lon, nowKey) {
    if (!navigator.onLine) return Promise.resolve(null);
    var url = "https://air-quality-api.open-meteo.com/v1/air-quality" +
      "?latitude=" + lat + "&longitude=" + lon +
      "&hourly=european_aqi&timezone=auto&forecast_days=1";
    return fetch(url)
      .then(function (r) {
        if (!r.ok) { console.warn("aqi fetch HTTP " + r.status); return null; }
        return r.json();
      })
      .then(function (d) {
        if (!d || !d.hourly || !d.hourly.time) return null;
        var idx = 0;
        while (idx < d.hourly.time.length && d.hourly.time[idx] < nowKey) idx++;
        var v = d.hourly.european_aqi && d.hourly.european_aqi[idx];
        return (typeof v === "number") ? v : null;
      })
      .catch(function () { return null; });   // silent — optional data
  }

  // One request: current + hourly + daily. Feels-like/humidity/UV are
  // taken from the hourly array AT the current hour (the
  // current_weather block carries neither). Writes the cache.
  // v0.3.0 TIMEZONE FIX: Open-Meteo (timezone=auto) stamps every
  // hourly/daily/AQI time in the CITY's local wall clock. "Now" is
  // therefore computed from the RESPONSE's utc_offset_seconds
  // (carried into payload.tz for render passes) — the device's own
  // hour skews distant cities by hours and mis-sliced the strip.
  function fetchForecast(city) {
    if (!city || !navigator.onLine) return Promise.resolve(null);
    var url = "https://api.open-meteo.com/v1/forecast" +
      "?latitude=" + city.lat + "&longitude=" + city.lon +
      "&current_weather=true" +
      "&hourly=temperature_2m,apparent_temperature,relative_humidity_2m,precipitation_probability,weathercode,uv_index" +
      "&daily=weathercode,temperature_2m_max,temperature_2m_min,precipitation_probability_max,sunrise,sunset" +
      "&timezone=auto&forecast_days=7";
    return fetch(url)
      .then(function (r) {
        if (!r.ok) {   // silent 4xx was undiagnosable — speak up
          console.warn("weather fetch HTTP " + r.status + " " + url);
          throw new Error("http " + r.status);
        }
        return r.json();
      })
      .then(function (d) {
        if (!d || !d.current_weather || !d.hourly || !d.daily) return null;

        // city-local "now" key — from the response, never the device
        var offSec = (typeof d.utc_offset_seconds === "number")
          ? d.utc_offset_seconds
          : -new Date().getTimezoneOffset() * 60;   // legacy fallback
        var nowKey = nowKeyAt(offSec);

        var payload = {
          at: Date.now(),
          tz: offSec,                             // render passes reuse it
          current: {
            temp:  d.current_weather.temperature,
            code:  d.current_weather.weathercode,
            wind:  d.current_weather.windspeed,   // km/h (API default)
            feels: null,
            hum:   null,
            uv:    null                           // from hourly at the current hour
          },
          sun: null,                               // {rise, set} ISO strings — today
          aqi: null,                               // {at, val} — filled by fetchAqi
          hourly: [],
          daily: []
        };

        // today's sunrise/sunset (daily row 0 = today by API contract)
        if (d.daily && d.daily.time && d.daily.time.length) {
          payload.sun = {
            rise: (d.daily.sunrise && d.daily.sunrise[0]) || null,
            set:  (d.daily.sunset  && d.daily.sunset[0])  || null
          };
        }

        // hourly: slice from the current hour (city-local), 48 slots
        var times = d.hourly.time || [];
        var start = 0;
        while (start < times.length && times[start] < nowKey) start++;
        for (var j = start; j < times.length && payload.hourly.length < 48; j++) {
          if (j === start) {
            payload.current.feels = (d.hourly.apparent_temperature &&
                typeof d.hourly.apparent_temperature[j] === "number")
              ? d.hourly.apparent_temperature[j] : payload.current.temp;
            payload.current.hum = (d.hourly.relative_humidity_2m &&
                typeof d.hourly.relative_humidity_2m[j] === "number")
              ? d.hourly.relative_humidity_2m[j] : null;
            payload.current.uv = (d.hourly.uv_index &&
                typeof d.hourly.uv_index[j] === "number")
              ? d.hourly.uv_index[j] : null;
          }
          payload.hourly.push({
            time: times[j],
            temp: d.hourly.temperature_2m[j],
            pop:  (d.hourly.precipitation_probability &&
                   typeof d.hourly.precipitation_probability[j] === "number")
                  ? d.hourly.precipitation_probability[j] : null,
            code: (d.hourly.weathercode && d.hourly.weathercode[j] !== undefined)
                  ? d.hourly.weathercode[j] : 0
          });
        }

        // daily: 7 rows
        (d.daily.time || []).forEach(function (day, k) {
          payload.daily.push({
            date: day,
            code: (d.daily.weathercode && d.daily.weathercode[k] !== undefined)
                  ? d.daily.weathercode[k] : 0,
            min:  (d.daily.temperature_2m_min && d.daily.temperature_2m_min[k] !== undefined)
                  ? d.daily.temperature_2m_min[k] : null,
            max:  (d.daily.temperature_2m_max && d.daily.temperature_2m_max[k] !== undefined)
                  ? d.daily.temperature_2m_max[k] : null,
            pop:  (d.daily.precipitation_probability_max &&
                   d.daily.precipitation_probability_max[k] !== undefined)
                  ? d.daily.precipitation_probability_max[k] : null
          });
        });

        // AQI rides AFTER the forecast, keyed on the SAME city-local
        // now — a dead AQI endpoint costs nothing visually.
        return fetchAqi(city.lat, city.lon, nowKey).then(function (aqiVal) {
          if (aqiVal !== null) payload.aqi = { at: Date.now(), val: aqiVal };
          writeCityCache(city.id, payload);

          // Mirror into the shell tray cache when this city IS the
          // shell's location — one fetch, two consumers, same numbers.
          try {
            var sh = JSON.parse(localStorage.getItem("oros-weather"));
            if (sh && typeof sh.lat === "number" &&
                Math.abs(sh.lat - city.lat) < 0.02 &&
                Math.abs(sh.lon - city.lon) < 0.02) {
              localStorage.setItem("oros-wx-cache", JSON.stringify({
                at:   payload.at,
                temp: payload.current.temp,
                code: payload.current.code
              }));
            }
          } catch (e) {}

          return payload;
        });
      })
      .then(function (payload) {
        if (payload) netDown = false;         // good fetch — badge can rest
        return payload;
      })
      .catch(function (e) {
        if (navigator.onLine) {
          netDown = true;                     // online but the call died
          console.warn("weather fetch failed:", e);
        }
        return null;
      });
  }

  // Throttled entry point: fresh within 30 min → cache, else fetch.
  function maybeFetch(force) {
    var city = activeCity();
    if (!city) return Promise.resolve(null);
    var c = readCityCache(city.id);
    if (!force && c && c.at && (Date.now() - c.at) < FETCH_GAP_MS) {
      return Promise.resolve(c);
    }
    return fetchForecast(city);
  }
  
      // ---------- 4. Render ----------
  // Micro-scoped additions (kept out of STRINGS in 3a for size —
  // same table shape, safe to extend):
  STRINGS.en["today"] = "Today";
  STRINGS.el["today"] = "Σήμερα";

  function fmtHour(tIso) { return tIso.substring(11, 16); }
  function todayLabel() { return t("today"); }

  // "Today" must be judged on the CITY's calendar, not ours: a
  // Tokyo Tuesday is still Monday evening in Serres. The daily
  // dates arrive in city-local terms (timezone=auto), so the
  // comparison key is derived from the payload's stored offset.
  function cityTodayStr(offSec) {
    var d = new Date(Date.now() + offSec * 1000);
    return d.getUTCFullYear() + "-" + pad(d.getUTCMonth() + 1) + "-" + pad(d.getUTCDate());
  }
  
  // City-local hour of "right now" (0–23), derived from the stored
  // UTC offset — same source of truth as the slice/labels. Used to
  // pick sun vs moon icons without consulting the device clock.
  function cityHour(offSec) {
    return new Date(Date.now() + offSec * 1000).getUTCHours();
  }

  // Lazy toast (index.html ships no toast node — the Weather app
  // rarely speaks; JS materializes one when needed, styled inline).
  // v0.3.0: optional ACTION button (used by the undo-delete flow).
  var toastEl = null, toastTimer = null, toastAction = null;
  function showToast(text, actionLabel, actionFn) {
    if (!toastEl) {
      toastEl = document.createElement("div");
      toastEl.style.cssText =
        "position:fixed;bottom:20px;left:50%;transform:translateX(-50%) translateY(8px);" +
        "z-index:1200;background:var(--panel-bg);border:1px solid var(--border);" +
        "border-radius:8px;box-shadow:0 4px 16px var(--shadow);padding:9px 14px;" +
        "font-size:13px;color:var(--text);opacity:0;transition:opacity .3s,transform .3s;" +
        "max-width:calc(100vw - 32px);";
      document.body.appendChild(toastEl);
    }
    if (toastAction) { toastAction.remove(); toastAction = null; }

    toastEl.appendChild(document.createTextNode(text));   // text FIRST

    if (actionLabel && typeof actionFn === "function") {
      toastAction = document.createElement("button");
      toastAction.type = "button";
      toastAction.textContent = actionLabel;
      toastAction.style.cssText =
        "margin-left:10px;background:transparent;color:var(--accent);" +
        "border:none;border-left:1px solid var(--border);padding:0 0 0 10px;" +
        "font-size:13px;font-weight:700;cursor:pointer;";
      toastAction.addEventListener("click", function () {
        actionFn();
        hideToast();
      });
      toastEl.appendChild(toastAction);                  // action SECOND
    }
    void toastEl.offsetWidth;
    toastEl.style.opacity = "1";
    toastEl.style.transform = "translateX(-50%) translateY(0)";
    clearTimeout(toastTimer);
    toastTimer = setTimeout(hideToast, 5000);
  }
  function hideToast() {
    if (!toastEl) return;
    toastEl.style.opacity = "0";
    toastEl.style.transform = "translateX(-50%) translateY(8px)";
    if (toastAction) { toastAction.remove(); toastAction = null; }
    toastEl.textContent = "";
  }

  // No-data state (finding 4): city EXISTS but no cached payload
  // (first-ever offline open, evicted cache). Materialized lazily,
  // inserted right after the offline badge — index.html untouched.
  function ensureNoData() {
    var el = $("no-data");
    if (!el) {
      el = document.createElement("div");
      el.id = "no-data";
      el.hidden = true;
      var s = document.createElement("span");
      s.textContent = t("err.nodata");
      el.appendChild(s);
      var main = $("wxmain");
      main.insertBefore(el, $("empty"));   // sits between badge & empty
    }
    return el;
  }

  var renderQueued = false;
  function scheduleRender() {
    if (renderQueued) return;
    renderQueued = true;
    requestAnimationFrame(function () {
      renderQueued = false;
      renderAll(readPayload());
    });
  }

  // Best available payload for the ACTIVE city: memory → cache → null.
  // Fetching happens only in boot/refresh/visibility paths — the
  // renderer itself is pure and never hits the network.
  function readPayload() {
    var city = activeCity();
    if (!city) return null;
    return readCityCache(city.id);
  }

  function renderTop(payload) {
    var city = activeCity();
    $("city-name").textContent = city ? city.label : t("dlg.title");
    renderDots();
    var empty = !city;
    $("empty").hidden = !empty;
    $("current").hidden = empty || !payload;
    var secs = document.querySelectorAll(".sec-title");
    for (var i = 0; i < secs.length; i++) secs[i].hidden = empty || !payload;

    // no-data: city without a payload — distinct from "no city"
    var nd = ensureNoData();
    nd.hidden = empty || !!payload;
    if (!empty) nd.firstChild.textContent = t("err.nodata");

    $("offline-badge").hidden = true;    // decided below, once
    return { city: city, payload: payload };
  }

  // Pager dots: one per city (sorted by pos), active = accent,
  // click jumps. Invisible with ≤1 city — zero clutter single-city.
  function renderDots() {
    var host = $("wx-dots");
    if (!host) return;
    host.innerHTML = "";
    if (state.cities.length < 2) { host.hidden = true; return; }
    host.hidden = false;
    var sorted = state.cities.slice().sort(function (a, b) { return a.pos - b.pos; });
    sorted.forEach(function (c) {
      var d = document.createElement("button");
      d.type = "button";
      d.className = "wx-dot" + (c.id === state.active ? " active" : "");
      d.setAttribute("aria-label", c.label);
      d.addEventListener("click", function () {
        if (state.active === c.id) return;
        state.active = c.id;
        state.sm = Date.now();
        save();
        refresh(false);
      });
      host.appendChild(d);
    });
  }

  function renderAll(payload) {
    var ctx = renderTop(payload);
    var city = ctx.city, p = ctx.payload;

    // Offline badge: true offline OR last fetch failed while online.
    // Inline style: any CSS display rule on #offline-badge would beat
    // the [hidden] attribute — inline style beats them ALL.
    var ob = $("offline-badge");
    var obShow = !(navigator.onLine && !netDown);
    ob.hidden = !obShow;                     // was flipped — badge never showed
    ob.style.display = obShow ? "" : "none";
    if (!city || !p) return;

    // --- current ---
    var tz = (typeof p.tz === "number") ? p.tz
      : -new Date().getTimezoneOffset() * 60;   // legacy cache rows (no tz)
    $("cur-icon").innerHTML = iconFor(p.current.code, cityHour(tz));
    $("cur-icon").title = condText(p.current.code);   // hint replaced the label — condition lives on the icon
    $("cur-temp").textContent  = fmtTemp(p.current.temp);
    $("cur-temp").title        = t("units.tip");
    $("cur-cond").textContent  = pickHint(p) || condText(p.current.code);
    $("cur-feels").textContent = (p.current.feels !== null)
      ? fmtTemp(p.current.feels) : "—";
    $("cur-hum").textContent   = (p.current.hum !== null)
      ? p.current.hum + "%" : "—";
    $("cur-wind").textContent  = fmtSpeed(p.current.wind);

    // --- second meta row: UV / Sun / AQI ---
    // UV: value + WHO band word; hover reveals the full legend —
    // the number alone tells users nothing actionable.
    var uvCell = $("cur-uv");
    if (p.current.uv !== null && !isNaN(Number(p.current.uv))) {
      uvCell.textContent = p.current.uv.toFixed(1) + " · " + uvBand(p.current.uv);
      uvCell.title = t("uv.legend");
    } else {
      uvCell.textContent = "—";
      uvCell.removeAttribute("title");
    }

    if (p.sun && p.sun.rise && p.sun.set) {
      $("cur-sun").textContent =
        p.sun.rise.substring(11, 16) + " → " + p.sun.set.substring(11, 16);
    } else { $("cur-sun").textContent = "—"; }

    // AQI: value + band word + level color + legend on hover.
    // European AQI is 0–100+ (NOT a percentage) — the band word
    // carries the meaning, the legend explains the scale.
    var aqiCell = $("cur-aqi");
    if (p.aqi && typeof p.aqi.val === "number" && !isNaN(p.aqi.val)) {
      var lvl = aqiLevel(p.aqi.val);
      aqiCell.textContent = String(Math.round(p.aqi.val)) + " · " + t("aqi." + lvl);
      aqiCell.setAttribute("data-level", lvl);
      aqiCell.title = t("aqi.legend");
    } else {
      aqiCell.textContent = "—";
      aqiCell.removeAttribute("data-level");
      aqiCell.removeAttribute("title");
    }
    var up = new Date(p.at);
    $("cur-updated").textContent = t("updated.at") + " " +
      up.toLocaleTimeString(LANG === "el" ? "el-GR" : "en-GB",
                            { hour: "2-digit", minute: "2-digit" });

    // --- hourly strip ---
    var host = $("hourly");
    host.innerHTML = "";
    var maxPop = 0;
    p.hourly.forEach(function (h) { if (h.pop > maxPop) maxPop = h.pop; });
    p.hourly.forEach(function (h, i) {
      var cell = document.createElement("div");
      cell.className = "hcell" + (i === 0 ? " now" : "");

      var hour = document.createElement("span");
      hour.className = "h-hour";
      hour.textContent = fmtHour(h.time);
      cell.appendChild(hour);

      if (i === 0) {
        var nowBadge = document.createElement("span");
        nowBadge.className = "h-now";
        nowBadge.textContent = t("now");
        cell.appendChild(nowBadge);
      }

      var ico = document.createElement("span");
      ico.className = "h-ico";
      ico.innerHTML = iconFor(h.code, Number(h.time.substring(11, 13)));
      cell.appendChild(ico);

      var tmp = document.createElement("span");
      tmp.className = "h-temp";
      tmp.textContent = fmtTemp(h.temp);
      cell.appendChild(tmp);

      var bar = document.createElement("span");
      bar.className = "h-bar";
      var fill = document.createElement("span");
      fill.className = "h-fill" + (h.pop ? "" : " h-zero");
      fill.style.width = maxPop ? Math.round(100 * h.pop / maxPop) + "%" : "0%";
      bar.appendChild(fill);
      cell.appendChild(bar);

      host.appendChild(cell);
    });

    // --- daily list ---
    // "Today" judged on the CITY's calendar (payload tz).
    var todayStr = cityTodayStr(tz);
    var dl = $("daily");
    dl.innerHTML = "";
    var tMin = null, tMax = null;
    p.daily.forEach(function (d) {
      if (d.min !== null && (tMin === null || d.min < tMin)) tMin = d.min;
      if (d.max !== null && (tMax === null || d.max > tMax)) tMax = d.max;
    });
    p.daily.forEach(function (d) {
      var row = document.createElement("li");
      row.className = "drow";

      var day = document.createElement("span");
      day.className = "d-day";
      if (d.date === todayStr) {
        day.textContent = todayLabel();
      } else {
        var dd = new Date(d.date + "T12:00:00");
        day.textContent = dd.toLocaleDateString(
          LANG === "el" ? "el-GR" : "en-GB", { weekday: "long" });
      }
      var sub = document.createElement("span");
      sub.className = "dd-sub";
      var dd2 = new Date(d.date + "T12:00:00");
      sub.textContent = dd2.toLocaleDateString(
        LANG === "el" ? "el-GR" : "en-GB", { day: "numeric", month: "short" });
      day.appendChild(sub);
      row.appendChild(day);

      var ico = document.createElement("span");
      ico.className = "d-ico";
      ico.innerHTML = iconFor(d.code, 12);   // daily = day symbols by convention
      ico.title = condText(d.code);
      row.appendChild(ico);

      var pop = document.createElement("span");
      pop.className = "d-pop" + (d.pop ? "" : " zero");
      pop.textContent = (d.pop !== null ? Math.round(d.pop) : 0) + "%";
      row.appendChild(pop);

      var range = document.createElement("span");
      range.className = "d-range";
      var mn = document.createElement("span");
      mn.className = "d-min";
      mn.textContent = (d.min !== null ? fmtTemp(d.min) : "—");
      var track = document.createElement("span");
      track.className = "d-track";
      var fillD = document.createElement("span");
      fillD.className = "d-fill";
      // position the fill within the WEEK's overall min..max span
      if (tMin !== null && tMax !== null && tMax > tMin &&
          d.min !== null && d.max !== null) {
        var lo = 100 * (d.min - tMin) / (tMax - tMin);
        var wi = 100 * (d.max - d.min) / (tMax - tMin);
        fillD.style.left  = Math.round(lo) + "%";
        fillD.style.width = Math.max(4, Math.round(wi)) + "%";
      } else {
        fillD.style.left = "0%"; fillD.style.width = "100%";
      }
      track.appendChild(fillD);
      var mx = document.createElement("span");
      mx.className = "d-max";
      mx.textContent = (d.max !== null ? fmtTemp(d.max) : "—");
      range.appendChild(mn); range.appendChild(track); range.appendChild(mx);
      row.appendChild(range);

      dl.appendChild(row);
    });
  }

  // --- City dialog ---
  var cityDlgBusy = false;   // geocode in flight → ignore double submits

  function openCityDialog() {
    renderCityList();
    $("city-hint").hidden = true;
    $("city-hint").className = "hint";
    $("dlg-city").showModal();
    setTimeout(function () { $("city-input").focus(); }, 50);
  }

  function renderCityList() {
    var host = $("city-list");
    host.innerHTML = "";

    if (state.cities.length === 0) {
      var none = document.createElement("p");
      none.className = "hint";
      none.textContent = t("empty.hint");
      host.appendChild(none);
      return;
    }

    state.cities.forEach(function (c) {
      var row = document.createElement("div");
      row.className = "city-row" + (c.id === state.active ? " active" : "");

      var name = document.createElement("span");
      name.className = "d-name";
      name.textContent = c.label;
      row.appendChild(name);

      var del = document.createElement("button");
      del.type = "button";
      del.className = "city-del";
      del.setAttribute("aria-label", t("dlg.del"));
      del.title = t("dlg.del");
      del.innerHTML =
        '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>';
      del.addEventListener("click", function (ev) {
        ev.stopPropagation();
        deleteCity(c.id);
        renderCityList();
      });
      row.appendChild(del);

      row.addEventListener("click", function () {
        if (state.active !== c.id) {
          state.active = c.id;
          state.sm = Date.now();
          save();
        }
        $("dlg-city").close();
        refresh(false);
      });
      host.appendChild(row);
    });
  }

  function dlgHint(key, isErr) {
    var h = $("city-hint");
    h.textContent = t(key);
    h.className = "hint" + (isErr ? " err" : "");
    h.hidden = false;
  }

  function commitCity(g) {
    // duplicate guard: same rounded coordinates = same city
    var dup = state.cities.some(function (c) {
      return Math.abs(c.lat - g.lat) < 0.02 && Math.abs(c.lon - g.lon) < 0.02;
    });
    if (dup) { dlgHint("err.exists", true); return; }
    var city = newCityObj(g.label, g.lat, g.lon);
    city.pos = state.cities.length;
    state.cities.push(city);
    state.active = city.id;
    state.om = Date.now();     // ordering decision — merge reference
    state.sm = Date.now();
    save();
    $("city-input").value = "";
    renderCityList();
    $("dlg-city").close();
    refresh(true);            // brand new city → force fetch
  }

  function addCity(geo) {
    if (cityDlgBusy) return;
    if (geo) {                       // picked from suggestions — coords in hand
      commitCity(geo);
      return;
    }
    var input = $("city-input");
    var name = input.value.trim();
    if (!name) return;

    cityDlgBusy = true;
    input.disabled = true;
    $("city-add-btn").disabled = true;

    geocodeCity(name)
      .then(function (g) { commitCity(g); })
      .catch(function (e) {
        dlgHint(e && e.message === "notfound" ? "err.notfound" : "err.fetch", true);
      })
      .finally(function () {
        cityDlgBusy = false;
        input.disabled = false;
        $("city-add-btn").disabled = false;
        input.focus();
      });
  }

  // Delete — NO native confirm() (it breaks the visual language and
  // is hostile in some mobile WebViews). The delete is immediate;
  // an undo toast keeps the door open for 5 seconds. Undo
  // resurrects the city with the SAME id and a FRESH mtime —
  // merge-wise the resurrection legitimately beats the tombstone
  // (an edit newer than its tombstone resurrects: by design).
  function deleteCity(id) {
    var city = cityById(id);
    if (!city) return;
    state.cities = state.cities.filter(function (c) { return c.id !== id; });
    if (!state.deleted) state.deleted = {};
    state.deleted[id] = Date.now();              // tombstone — merge-safe
    if (!state.cities.some(function (c) { return c.id === state.active; })) {
      state.active = state.cities.length ? state.cities[0].id : null;
    }
    state.om = Date.now();
    state.sm = Date.now();
    // purge this city's device-local cache entry too
    var m = readCacheMap();
    delete m[id];
    try { localStorage.setItem(CACHE_KEY, JSON.stringify(m)); } catch (e) {}
    save();
    scheduleRender();
    showToast(t("dlg.del.done") + " — " + city.label, t("dlg.del.undo"),
      function () {
        var back = cityById(id);
        if (!back) {
          back = city;                    // same object, same id
          back.mtime = Date.now();        // fresh mtime > tombstone
          back.pos = state.cities.length;
          state.cities.push(back);
          state.active = id;
          state.om = Date.now();
          state.sm = Date.now();
          save();
          scheduleRender();
          refresh(true);                  // cache was purged — force
        }
      });
  }
  
    // ---------- 5. Sync slice + palette ----------
  var PAL_VARS = ["--bg", "--bg-desktop", "--bar-bg", "--text", "--text-dim",
                  "--accent", "--accent-hover", "--accent-soft",
                  "--panel-bg", "--border", "--shadow"];

  function inheritPalette() {
    try {
      var pRoot = window.parent.document.documentElement;
      document.documentElement.setAttribute("data-theme",
        pRoot.getAttribute("data-theme") || "dark");
      var cs = window.parent.getComputedStyle(pRoot);
      PAL_VARS.forEach(function (v) {
        document.documentElement.style.setProperty(v, cs.getPropertyValue(v).trim());
      });
    } catch (e) { /* standalone — fallback palette stands */ }
  }

  function watchPalette() {
    try {
      new MutationObserver(inheritPalette).observe(
        window.parent.document.documentElement,
        { attributes: true, attributeFilter: ["data-skin", "data-theme"] }
      );
    } catch (e) { /* standalone */ }
  }

  function registerSync() {
    var api = (window.parent && window.parent.orosSync) || window.orosSync;

    window.__orosSyncApi = {
      _suppress: false,
      dirty: function () {
        if (this._suppress) return;
        if (api && typeof api.markDirty === "function") api.markDirty();
      }
    };

    if (!api || typeof api.registerSlice !== "function") return;
    api.registerSlice("weatherapp", sliceGet, sliceSet,
                      STORAGE_KEY, mergeWeatherStates);
  }

  function sliceGet() {
    return JSON.parse(JSON.stringify(state));
  }

  // data — merged result (or plain remote on legacy LWW paths)
  // info — { merged: true } via mergeWeatherStates; else wholesale
  function sliceSet(data, info) {
    data = migrate(JSON.parse(JSON.stringify(data || null)));
    if (!data || !Array.isArray(data.cities)) return;

    window.__orosSyncApi._suppress = true;
    try {
      state = data;
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } finally {
      window.__orosSyncApi._suppress = false;
    }

    var ok = state.cities.some(function (c) { return c.id === state.active; });
    if (!ok) state.active = state.cities.length ? state.cities[0].id : null;

    scheduleRender();    // remote change landed (units/cities) — repaint live
    if (info && info.merged) showToast(t("updated.at"));   // light ack — no noise
  }

  // Contract Β: shell-owned combos (Ctrl+Alt+Shift+*) forward FIRST.
  document.addEventListener("keydown", function (e) {
    if (!(e.ctrlKey || e.metaKey) || !e.altKey || !e.shiftKey) return;
    var p = window.parent;
    if (!(p && p.orosShortcuts && typeof p.orosShortcuts.handle === "function")) return;
    if (p.orosShortcuts.handle(e)) e.stopPropagation();
  }, true);   // capture phase

  // ---------- 6. Wiring & boot ----------
  function applyI18n() {
    var n = document.querySelectorAll("[data-i18n]");
    for (var i = 0; i < n.length; i++) {
      n[i].textContent = t(n[i].getAttribute("data-i18n"));
    }
    var p = document.querySelectorAll("[data-i18n-ph]");
    for (var k = 0; k < p.length; k++) {
      p[k].setAttribute("placeholder", t(p[k].getAttribute("data-i18n-ph")));
    }
  }

  // R9 parity: static buttons ship EMPTY in the HTML, JS paints
  // localized aria-labels/titles at boot.
  function paintStaticAria() {
    var pairs = [
      ["refresh-btn", "refresh"],
      ["city-btn",    "dlg.title"]
    ];
    pairs.forEach(function (pair) {
      var el = $(pair[0]);
      if (!el) return;
      el.setAttribute("aria-label", t(pair[1]));
      el.setAttribute("title", t(pair[1]));
    });
  }

  function refresh(force) {
    var btn = $("refresh-btn");
    var hadCity = !!activeCity();
    btn.classList.add("loading");
    maybeFetch(force)
      .then(function (res) {
        // Silent failures were invisible — a dead fetch looked
        // like "offline". Now it SPEAKS (online + no result).
        if (!res && hadCity && navigator.onLine) showToast(t("err.fetch"));
        scheduleRender();
      })
      .catch(function () { /* fetchForecast never throws */ })
      .finally(function () { btn.classList.remove("loading"); });
  }

  function wire() {
    $("city-btn").addEventListener("click", openCityDialog);
    $("refresh-btn").addEventListener("click", function () { refresh(true); });

    $("city-add-btn").addEventListener("click", function () { addCity(); });

    // Autocomplete: live suggestions from the 3rd character.
    var cInput = $("city-input");
    cInput.addEventListener("input", function () {
      clearTimeout(acTimer);
      var q = cInput.value.trim();
      if (q.length < AC_MIN || !navigator.onLine) { hideAc(); return; }
      acTimer = setTimeout(function () {
        geocodeSuggest(q).then(renderAc);
      }, AC_DELAY);
    });
    cInput.addEventListener("keydown", function (e) {
      var h = $("ac-host");
      var open = h && !h.hidden;
      var nItems = open ? document.querySelectorAll(".ac-item").length : 0;
      if (e.key === "ArrowDown" && nItems) {
        e.preventDefault();
        acSel = (acSel + 1) % nItems;
        paintAcSel();
      } else if (e.key === "ArrowUp" && nItems) {
        e.preventDefault();
        acSel = (acSel - 1 + nItems) % nItems;
        paintAcSel();
      } else if (e.key === "Enter") {
        e.preventDefault();
        if (open && acSel >= 0 && acList[acSel]) {
          pickAc(acList[acSel]);       // highlighted suggestion wins
        } else {
          addCity();                   // plain typed text — legacy path
        }
      } else if (e.key === "Escape" && open) {
        e.preventDefault();
        hideAc();
      }
    });
    cInput.addEventListener("blur", function () {
      setTimeout(hideAc, 150);         // mousedown fires first — safe
    });

    $("dlg-city").addEventListener("close", function () {
      $("city-hint").hidden = true;   // hint dies with the dialog
      hideAc();                       // so do the suggestions
    });

    // Native dialogs ignore backdrop clicks by default — click ON
    // the dialog element itself (i.e. outside the content box,
    // target === the dialog) closes it. Esc already works natively.
    var cityDlg = $("dlg-city");
    cityDlg.addEventListener("click", function (e) {
      if (e.target === cityDlg) cityDlg.close();
    });

    // GPS: geolocation is legal exactly HERE — inside the user's
    // click. Null-guarded: if the served index.html is a stale bundle
    // (no #dlg-gps), the app must NOT die at boot — the button
    // simply won't work until the cache refreshes.
    var gpsBtn = $("dlg-gps");
    if (gpsBtn) gpsBtn.addEventListener("click", function () {
      if (!navigator.geolocation) { dlgHint("err.gps", true); return; }
      var btn = this;
      btn.disabled = true;
      navigator.geolocation.getCurrentPosition(function (pos) {
        btn.disabled = false;
        $("dlg-city").close();
        window.__orosWeatherUpdate({
          lat: pos.coords.latitude,
          lon: pos.coords.longitude,
          label: LANG === "el" ? "Η τοποθεσία μου" : "My location"
        });
      }, function () {
        btn.disabled = false;
        dlgHint("err.gps", true);   // declined or unavailable — hint, no toast spam
      }, { timeout: 10000, maximumAge: 30 * 60 * 1000 });
    });

    // Fresh data when returning to a visible tab (throttled inside)
    document.addEventListener("visibilitychange", function () {
      if (!document.hidden) refresh(false);
    });

    // Units toggle: tap the BIG temperature — metric ⇄ imperial.
    // Render-only conversion (cache stays metric), travels in the
    // slice so every device agrees.
    $("cur-temp").addEventListener("click", function () {
      state.units = state.units === "metric" ? "imperial" : "metric";
      state.sm = Date.now();
      save();
      var el = $("cur-temp");
      el.classList.add("flick");
      setTimeout(function () { el.classList.remove("flick"); }, 200);
      renderAll(readPayload());
    });

    // City swipe (pager): horizontal drag ≥45px on the main area
    // switches city — EXCEPT inside #hourly (its own scroll turf).
    // v0.3.0: pointercancel releases the tracking flag (drag killed
    // by a notification/scroll-interrupt left it dangling before).
    var sx = 0, sy = 0, tracking = false;
    $("wxmain").addEventListener("pointerdown", function (e) {
      if (e.target.closest("#hourly")) { tracking = false; return; }
      tracking = true; sx = e.clientX; sy = e.clientY;
    });
    $("wxmain").addEventListener("pointerup", function (e) {
      if (!tracking) return;
      tracking = false;
      var dx = e.clientX - sx, dy = e.clientY - sy;
      if (Math.abs(dx) < 45 || Math.abs(dx) < Math.abs(dy)) return;
      var sorted = state.cities.slice().sort(function (a, b) { return a.pos - b.pos; });
      if (sorted.length < 2) return;
      var i = 0;
      for (var k = 0; k < sorted.length; k++) {
        if (sorted[k].id === state.active) { i = k; break; }
      }
      var nxt = (dx < 0 ? i + 1 : i - 1 + sorted.length) % sorted.length;
      state.active = sorted[nxt].id;
      state.sm = Date.now();
      save();
      refresh(false);
    });
    $("wxmain").addEventListener("pointercancel", function () {
      tracking = false;    // interrupted gesture — clean slate, no false swipes
    });
  }

  // Shell→app bridge: the menu's weather settings push location
  // changes straight into the RUNNING app. Upsert by coords, set
  // active, stamp (stamps stay owned by this app), refresh.
  window.__orosWeatherUpdate = function (w) {
    if (!w || w.lat === null || w.lon === null) return;
    var dup = null;
    state.cities.forEach(function (c) {
      if (Math.abs(c.lat - w.lat) < 0.02 && Math.abs(c.lon - w.lon) < 0.02) dup = c;
    });
    if (dup) {
      if (w.label && w.label !== dup.label) { dup.label = w.label; dup.mtime = Date.now(); }
      if (state.active !== dup.id) { state.active = dup.id; state.sm = Date.now(); }
    } else {
      var c = newCityObj(w.label || (LANG === "el" ? "Η τοποθεσία μου" : "My location"),
                         w.lat, w.lon);
      c.pos = state.cities.length;
      state.cities.push(c);
      state.active = c.id;
      state.om = Date.now();
      state.sm = Date.now();
    }
    save();
    scheduleRender();
    refresh(true);        // a location change deserves fresh data
  };

  // Boot-time reconciliation with the shell's weather preference.
  // The menu is desktop-only → settings change while this app is NOT
  // running, so the live bridge (wxPushToApp → __orosWeatherUpdate)
  // can't fire. Compare the shell pref against the LAST one we
  // applied (fingerprint): changed → upsert city + activate.
  // Unchanged → hands off: a user who deliberately deleted the city
  // in-app is never fought on the next open. w.on === false → the
  // chip is off and the shell isn't asking for anything.
  function syncShellLocation() {
    var w = null;
    try { w = JSON.parse(localStorage.getItem("oros-weather")); } catch (e) {}
    if (!w || !w.on || typeof w.lat !== "number" || typeof w.lon !== "number") return;

    var fp = [w.lat.toFixed(3), w.lon.toFixed(3), w.label || ""].join("|");
    // Skip only when nothing changed AND the list isn't empty.
    // An EMPTY list re-adopts the shell location on boot — deleting
    // everything resets to the tray's truth instead of stranding
    // the user with no city at all. Deleting it while OTHER cities
    // exist stays respected (no fighting the user).
    if (fp === state.shellWx && state.cities.length > 0) return;
    state.shellWx = fp;

    var dup = null;
    state.cities.forEach(function (c) {
      if (Math.abs(c.lat - w.lat) < 0.02 && Math.abs(c.lon - w.lon) < 0.02) dup = c;
    });
    if (dup) {
      if (w.label && w.label !== dup.label) { dup.label = w.label; dup.mtime = Date.now(); }
      if (state.active !== dup.id) { state.active = dup.id; state.sm = Date.now(); }
    } else {
      var c = newCityObj(w.label || (LANG === "el" ? "Η τοποθεσία μου" : "My location"),
                         w.lat, w.lon);
      c.pos = state.cities.length;
      state.cities.push(c);
      state.active = c.id;
      state.om = Date.now();
      state.sm = Date.now();
    }
    save();
  }

  // ---------- Boot ----------
  console.log("weather.js v0.3.0 boot");
  load();
  syncShellLocation();
  applyI18n();
  paintStaticAria();
  wire();
  registerSync();
  inheritPalette();
  watchPalette();
  renderAll(readPayload());   // instant paint from cache (if any)…
  refresh(false);             // …then fetch if the cache is >30min old
})();