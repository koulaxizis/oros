// ============================================================
// orOS Weather — App logic
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
//   4b. Wave 38: official warnings (MeteoAlarm), rain in the next
//       2 hours (minutely_15), air & pollen, forecast model + compare
//       (pure logic in core.js → window.OrosWeatherCore)
//   5. Sync slice + palette
//   6. Wiring & boot
// Data:
//   slice "oros-weatherapp-data"  → travels (cities + units)
//   cache "oros-weatherapp-cache" → device-local, NEVER in slice
//   prefs "oros-weatherapp-prefs" / warnings "oros-weatherapp-warn"
//         → device-local (wave 38), NEVER in slice
// Offline: render from cache + badge — never fake numbers.
// Cache/slice ALWAYS metric — units decorate at render time.
// ============================================================
(function () {
  "use strict";

	var STORAGE_KEY  = "oros-weatherapp-data";
	var CACHE_KEY    = "oros-weatherapp-cache";
	var DATA_VER     = 1;
	var FETCH_GAP_MS = 30 * 60 * 1000;
	var CACHE_MAX    = 6;
	var WX_CACHE_KEY = "oros-wx-cache";
	var TOMB_LIFETIME_MS = 30 * 24 * 60 * 60 * 1000;   // todo parity: 30 days

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
      "attrib":        "Weather data by",
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
      "tray.title":    "Taskbar",
      "tray.show":     "Show the weather in the taskbar",
      "tray.hint":     "On this device only. The pin picks the city it shows.",
      "tray.pin":      "Show this city in the taskbar",
      "tray.pinned":   "Shown in the taskbar",
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
      "aqi.legend":    "European AQI: ≤20 Good · ≤40 Fair · ≤60 Moderate · ≤80 Poor · ≤100 Very poor · >100 Extremely poor",
      "toast.merged":  "Synced changes from another device"
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
      "attrib":        "Δεδομένα καιρού από",
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
      "tray.title":    "Γραμμή εργασιών",
      "tray.show":     "Ο καιρός στη γραμμή εργασιών",
      "tray.hint":     "Μόνο σε αυτή τη συσκευή. Η πινέζα διαλέγει ποια πόλη δείχνει.",
      "tray.pin":      "Αυτή η πόλη στη γραμμή εργασιών",
      "tray.pinned":   "Εμφανίζεται στη γραμμή εργασιών",
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
      "aqi.legend":    "Ευρωπαϊκός AQI: ≤20 Καλή · ≤40 Αρκετή · ≤60 Μέτρια · ≤80 Κακή · ≤100 Πολύ κακή · >100 Εξαιρετικά κακή",
      "toast.merged":  "Συγχρονίστηκαν αλλαγές από άλλη συσκευή"
    }
  };

  // Wave 38: warnings, rain in the next 2 hours, air & pollen, models
  var STRINGS2 = {
    en: {
      "warn.mine":      "Official warnings",
      "warn.area":      "Area: {a}",
      "warn.guess":     "Area: {a} (guessed from the city)",
      "warn.change":    "Change area",
      "warn.forget":    "Forget area",
      "warn.others":    "Warnings elsewhere in {c} ({n})",
      "warn.pick":      "Warnings in {c} ({n}) · pick your area",
      "warn.myarea":    "My area",
      "warn.myarea.tip":"Show this area's warnings for {city}",
      "warn.until":     "until {t}",
      "warn.from":      "{a} → {b}",
      "warn.more":      "Details",
      "warn.loading":   "Loading details…",
      "warn.nodetail":  "Details could not be loaded.",
      "warn.instr":     "What to do",
      "warn.source":    "Source",
      "warn.open":      "Open on MeteoAlarm",
      "warn.set.title": "Official warnings",
      "warn.set.show":  "Show MeteoAlarm warnings",
      "warn.set.notify":"Notify me",
      "warn.n.off":     "Off",
      "warn.n.severe":  "Orange and red",
      "warn.n.all":     "All warnings",
      "warn.set.hint":  "On this device only. Europe only (MeteoAlarm). The notice is for the taskbar city.",
      "warn.st.none":   "No country found for {city}: warnings cover Europe only.",
      "warn.st.ok":     "{c}: {n} warnings in force, checked {t}.",
      "warn.st.err":    "MeteoAlarm could not be reached.",
      "warn.st.cors":   "The browser can't read MeteoAlarm directly. Set up the relay in Mail to get warnings.",
      "warn.st.wait":   "Not checked yet.",
      "warn.attrib":    "Warnings: MeteoAlarm (EUMETNET) and the national weather services. Their own pages are the official source.",
      "now.title":      "Next 2 hours",
      "now.tip":        "Precipitation every 15 minutes",
      "air.title":      "Air & pollen",
      "air.main":       "mostly {p}",
      "air.at":         "worst at {t}",
      "air.pollen":     "Pollen",
      "air.nopollen":   "No pollen data",
      "air.tip":        "Tap an hour to see its values",
      "air.unit":       "µg/m³",
      "pol.alder":      "Alder",
      "pol.birch":      "Birch",
      "pol.grass":      "Grass",
      "pol.mugwort":    "Mugwort",
      "pol.olive":      "Olive",
      "pol.ragweed":    "Ragweed",
      "pol.l0":         "none",
      "pol.l1":         "low",
      "pol.l2":         "moderate",
      "pol.l3":         "high",
      "pol.l4":         "very high",
      "model.title":    "Forecast model",
      "model.best":     "Automatic (best match)",
      "model.hint":     "On this device only. Rain in the next 2 hours needs a model with 15-minute data; the automatic choice has it.",
      "cmp.btn":        "Compare models",
      "cmp.hide":       "Hide comparison",
      "cmp.none":       "—",
      "cmp.loading":    "Loading…",
      "cmp.err":        "Comparison could not be loaded.",
      "cmp.max":        "solid line: highs · dashed: lows",
      "cmp.rain":       "Rain",
      "cmp.model":      "Model {n}",
      "attrib.air":     "Air quality: Copernicus Atmosphere Monitoring Service (CAMS) via Open-Meteo."
    },
    el: {
      "warn.mine":      "Επίσημες προειδοποιήσεις",
      "warn.area":      "Περιοχή: {a}",
      "warn.guess":     "Περιοχή: {a} (εκτίμηση από την πόλη)",
      "warn.change":    "Αλλαγή περιοχής",
      "warn.forget":    "Ξέχνα την περιοχή",
      "warn.others":    "Προειδοποιήσεις αλλού: {c} ({n})",
      "warn.pick":      "Προειδοποιήσεις: {c} ({n}) · διάλεξε την περιοχή σου",
      "warn.myarea":    "Η περιοχή μου",
      "warn.myarea.tip":"Οι προειδοποιήσεις αυτής της περιοχής για: {city}",
      "warn.until":     "έως {t}",
      "warn.from":      "{a} → {b}",
      "warn.more":      "Λεπτομέρειες",
      "warn.loading":   "Φόρτωση λεπτομερειών…",
      "warn.nodetail":  "Δεν φορτώθηκαν οι λεπτομέρειες.",
      "warn.instr":     "Τι να κάνεις",
      "warn.source":    "Πηγή",
      "warn.open":      "Άνοιγμα στο MeteoAlarm",
      "warn.set.title": "Επίσημες προειδοποιήσεις",
      "warn.set.show":  "Εμφάνιση προειδοποιήσεων MeteoAlarm",
      "warn.set.notify":"Ειδοποίηση",
      "warn.n.off":     "Όχι",
      "warn.n.severe":  "Πορτοκαλί και κόκκινες",
      "warn.n.all":     "Όλες οι προειδοποιήσεις",
      "warn.set.hint":  "Μόνο σε αυτή τη συσκευή. Μόνο για την Ευρώπη (MeteoAlarm). Η ειδοποίηση αφορά την πόλη της γραμμής εργασιών.",
      "warn.st.none":   "Δεν βρέθηκε χώρα για: {city}. Οι προειδοποιήσεις καλύπτουν μόνο την Ευρώπη.",
      "warn.st.ok":     "{c}: {n} ενεργές προειδοποιήσεις, έλεγχος {t}.",
      "warn.st.err":    "Δεν ήταν δυνατή η σύνδεση με το MeteoAlarm.",
      "warn.st.cors":   "Ο φυλλομετρητής δεν μπορεί να διαβάσει απευθείας το MeteoAlarm. Ρύθμισε το relay στο Ταχυδρομείο για να έρχονται οι προειδοποιήσεις.",
      "warn.st.wait":   "Δεν έγινε έλεγχος ακόμα.",
      "warn.attrib":    "Προειδοποιήσεις: MeteoAlarm (EUMETNET) και οι εθνικές μετεωρολογικές υπηρεσίες. Επίσημη πηγή είναι οι δικές τους σελίδες.",
      "now.title":      "Επόμενες 2 ώρες",
      "now.tip":        "Υετός ανά 15 λεπτά",
      "air.title":      "Αέρας & γύρη",
      "air.main":       "κυρίως {p}",
      "air.at":         "χειρότερα στις {t}",
      "air.pollen":     "Γύρη",
      "air.nopollen":   "Δεν υπάρχουν δεδομένα γύρης",
      "air.tip":        "Πάτησε μια ώρα για να δεις τις τιμές της",
      "air.unit":       "µg/m³",
      "pol.alder":      "Σκλήθρα",
      "pol.birch":      "Σημύδα",
      "pol.grass":      "Αγρωστώδη",
      "pol.mugwort":    "Αρτεμισία",
      "pol.olive":      "Ελιά",
      "pol.ragweed":    "Αμβροσία",
      "pol.l0":         "καθόλου",
      "pol.l1":         "χαμηλή",
      "pol.l2":         "μέτρια",
      "pol.l3":         "υψηλή",
      "pol.l4":         "πολύ υψηλή",
      "model.title":    "Μοντέλο πρόγνωσης",
      "model.best":     "Αυτόματο",
      "model.hint":     "Μόνο σε αυτή τη συσκευή. Η βροχή των επόμενων 2 ωρών θέλει μοντέλο με δεδομένα ανά 15 λεπτά· η αυτόματη επιλογή τα έχει.",
      "cmp.btn":        "Σύγκριση μοντέλων",
      "cmp.hide":       "Απόκρυψη σύγκρισης",
      "cmp.none":       "—",
      "cmp.loading":    "Φόρτωση…",
      "cmp.err":        "Δεν φορτώθηκε η σύγκριση.",
      "cmp.max":        "συνεχής γραμμή: μέγιστες · διακεκομμένη: ελάχιστες",
      "cmp.rain":       "Βροχή",
      "cmp.model":      "Μοντέλο {n}",
      "attrib.air":     "Ποιότητα αέρα: Copernicus Atmosphere Monitoring Service (CAMS) μέσω Open-Meteo."
    }
  };
  Object.keys(STRINGS2.en).forEach(function (k) { STRINGS.en[k] = STRINGS2.en[k]; });
  Object.keys(STRINGS2.el).forEach(function (k) { STRINGS.el[k] = STRINGS2.el[k]; });

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

  // ---- Unified notifications (migration wave) ----
  // The module lives in the SHELL (parent) — dynamic resolution,
  // same doctrine as orosSync in registerSync().
  function notifMod() {
    try {
      return (window.parent && window.parent.orosNotifs) ||
             window.orosNotifs || null;
    } catch (e) { return null; }
  }

  function ymdLocal() {
    var d = new Date();
    return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
  }

  // Immediate feedback (toast, no inbox) — the module's transient.
  // Module absent (stale bundle / standalone) → legacy showToast
  // stands alone as fallback.
  function notifyTransient(text) {
    var N = notifMod();
    if (N && typeof N.transient === "function") {
      N.transient({ ns: "weather", title: text, body: "" });
      return;
    }
    showToast(text);
  }

  // History-worthy failure (background fetch died): once per day,
  // inbox + badge — an invisible API outage must never evaporate.
  function notifyFetchFail() {
    var N = notifMod();
    if (N && typeof N.emit === "function") {
      var c = activeCity();
      N.emit({
        ns: "weather",
        key: "fetchfail-" + ymdLocal(),
        type: "sys",
        title: t("err.fetch"),
        body: c ? c.label : "",
        deepLink: "weather:open"
      });
      return;
    }
    showToast(t("err.fetch"));
  }

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
      // WE-2: a brand-new state carries stamp 0 — it must never
      // outrank the user's synced choices (units, order, active)
      ver: DATA_VER, sm: 0, om: 0,
      active: null, deleted: {}, cities: [],
      shellWx: null,      // last shell-menu location we applied (fingerprint)
      units: "metric"     // "metric" | "imperial" — RENDER ONLY, cache stays °C/km/h
    };
  }

  function migrate(data) {
    if (!data || !Array.isArray(data.cities)) return null;
    if (typeof data.sm !== "number") data.sm = 0;
    if (typeof data.om !== "number") data.om = 0;
    if (data.um !== undefined && typeof data.um !== "number") delete data.um;   // WE-3
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

  // Tombstone pruning (todo parity, W2): a deleted city rides the
  // slice for at most 30 days, then the tombstone expires and the
  // entry stops travelling to every device forever. Convergence-
  // safe: pruning is ALSO applied inside the merge, so both
  // replicas compute from the same trimmed tombstone set.
  // Accepted trade-off (identical to todo): a remote state older
  // than 30 days may resurrect an ancient deletion — the next
  // delete re-buries it; bounded blast radius, zero data loss.
  function pruneTombstones(deleted) {
    if (!deleted) return {};
    var cut = Date.now() - TOMB_LIFETIME_MS;
    var out = {};
    Object.keys(deleted).forEach(function (id) {
      if (deleted[id] > cut) out[id] = deleted[id];
    });
    return out;
  }

  function load() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        var data = migrate(JSON.parse(raw));
        if (data) {
          state = data;
          state.deleted = pruneTombstones(state.deleted);
          return;
        }
      }
    } catch (e) { /* corrupted → fresh */ }
    // WE-8: unreadable data is kept aside before the fresh state
    // overwrites it (R-rescue: never overwrite without a copy)
    try {
      var bad = localStorage.getItem(STORAGE_KEY);
      if (bad) localStorage.setItem(STORAGE_KEY + "-broken", bad);
    } catch (e2) {}
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

  // --- Device-local preferences (wave 38): never in the slice ---
  //   { model: Open-Meteo model id, cmp: [up to 3 ids, "" = none],
  //     warnOn: bool (default true), notify: "off" | "severe" | "all",
  //     bf: { cityId: ts } (place details looked up once) }
  // The shell reads `notify` for the warnings notice (wxWarnTick).
  var PREFS_KEY = "oros-weatherapp-prefs";
  var WARN_KEY  = "oros-weatherapp-warn";     // device-local warnings cache
  var C = window.OrosWeatherCore || null;     // weather/core.js (stale bundle → features hide)
  function readPrefs() {
    var p = null;
    try { p = JSON.parse(localStorage.getItem(PREFS_KEY)); } catch (e) {}
    if (!p || typeof p !== "object") p = {};
    var out = {
      model: (C && C.okModel(p.model)) ? p.model : "best_match",
      cmp: Array.isArray(p.cmp) ? p.cmp.slice(0, 3) : ["ecmwf_ifs025", "icon_seamless", "gfs_seamless"],
      warnOn: p.warnOn !== false,
      notify: (p.notify === "severe" || p.notify === "all") ? p.notify : "off",
      bf: (p.bf && typeof p.bf === "object") ? p.bf : {}
    };
    out.cmp = out.cmp.map(function (m) { return (C && C.okModel(m)) ? m : ""; });
    while (out.cmp.length < 3) out.cmp.push("");
    return out;
  }
  function writePrefs(p) {
    try { localStorage.setItem(PREFS_KEY, JSON.stringify(p)); } catch (e) {}
  }

  // ---------- 2b. Merge engine lite (todo-contract, compact) ----------
  // Deterministic + symmetric: merge(A,B) === merge(B,A).
  //   · active + units + shellWx — LWW by root sm; ties by
  //     lexicographic JSON of the FULL scalar triple (symmetric:
  //     a partial tie-break on `active` alone let two replicas
  //     keep different units on an sm tie and ping-pong forever)
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

  // fixed key order (canonical bytes); unknown keys kept, sorted, after
  var CITY_KEYS = ["id", "label", "lat", "lon", "mtime", "pos"];
  function cloneCity(c) {
    var o = {}, k, i;
    for (i = 0; i < CITY_KEYS.length; i++) if (c[CITY_KEYS[i]] !== undefined) o[CITY_KEYS[i]] = c[CITY_KEYS[i]];
    var extra = Object.keys(c).filter(function (x) { return CITY_KEYS.indexOf(x) < 0; }).sort();
    for (i = 0; i < extra.length; i++) { k = extra[i]; o[k] = JSON.parse(JSON.stringify(c[k])); }
    return o;
  }

  // WE-1: the merge works on COPIES (it used to rewrite `pos` on the
  // caller's live rows) and emits ONE canonical key order, tombstones
  // sorted by id. The getter returns merge(state, state), so an idle
  // device compares equal bytes and uploads nothing.
  function mergeWeatherStates(A, B) {
    var a = A || {}, b = B || {};

    // tombstones: union, max ts — then prune to 30d (todo parity,
    // W2): unbounded tombstone growth bloated every slice forever.
    var tomb = {};
    Object.keys(a.deleted || {}).forEach(function (id) { tomb[id] = a.deleted[id]; });
    Object.keys(b.deleted || {}).forEach(function (id) {
      tomb[id] = Math.max(tomb[id] || 0, b.deleted[id]);
    });
    tomb = pruneTombstones(tomb);
    var tombOut = {};
    Object.keys(tomb).sort().forEach(function (id) { tombOut[id] = tomb[id]; });

    // scalars: active + shellWx — LWW by root sm; ties by the full
    // scalar triple (same rule old builds use).
    var sa = JSON.stringify([a.active || null, a.units || "metric", a.shellWx || null]);
    var sb = JSON.stringify([b.active || null, b.units || "metric", b.shellWx || null]);
    var scalars = (a.sm || 0) !== (b.sm || 0)
      ? ((a.sm || 0) > (b.sm || 0) ? a : b)
      : (sa >= sb ? a : b);

    // WE-3: units have their OWN stamp `um` — switching the shown
    // city (sm) on one device no longer reverts a units toggle made
    // on another. A state without `um` (old build, or never toggled)
    // speaks with its sm, exactly as before.
    var hasUm = typeof a.um === "number" || typeof b.um === "number";
    var ua = typeof a.um === "number" ? a.um : (a.sm || 0);
    var ub = typeof b.um === "number" ? b.um : (b.sm || 0);
    var unitsA = a.units === "imperial" ? "imperial" : "metric";
    var unitsB = b.units === "imperial" ? "imperial" : "metric";
    var units = ua !== ub ? (ua > ub ? unitsA : unitsB)
                          : (unitsA >= unitsB ? unitsA : unitsB);

    // cities: union by id, LWW content, tombstone-aware
    var map = {};
    (a.cities || []).forEach(function (c) { map[c.id] = c; });
    (b.cities || []).forEach(function (c) {
      map[c.id] = map[c.id] ? newerCity(map[c.id], c) : c;
    });
    var alive = [];
    Object.keys(map).forEach(function (id) {
      var ts = tomb[id];
      if (ts === undefined || (map[id].mtime || 0) > ts) alive.push(cloneCity(map[id]));
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
      active: scalars.active || null,
      units: units,
      shellWx: scalars.shellWx || null,
      deleted: tombOut,
      cities: alive
    };
    if (hasUm) out.um = Math.max(ua, ub);
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
        return { lat: g.latitude, lon: g.longitude, label: g.name,
                 cc: g.country_code, adm: g.admin1 };
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
    addCity({ lat: g.latitude, lon: g.longitude, label: g.name,
              cc: g.country_code, adm: g.admin1 });
  }

  // European AQI (0..100+) — SEPARATE Open-Meteo endpoint, fired
  // SERIALLY after the forecast lands. Failure = null → the cell
  // shows a dim "—" — never blocks, never badges, never fakes.
  // v0.3.0: nowKey comes IN (computed by the caller from the
  // forecast response's utc_offset_seconds) — this endpoint also
  // returns timezone=auto times, so the SAME city-local key aligns
  // both arrays. The device clock is never consulted.
  // Wave 38: the same request also brings the hourly pollutants
  // (European sub-indices + µg/m³) and the pollen counts (Europe, in
  // season) for 3 days → { val: AQI now | null, hours: [...] | null }.
  function fetchAqi(lat, lon, nowKey) {
    if (!navigator.onLine) return Promise.resolve(null);
    var vars = C ? C.AIR_VARS.join(",") : "european_aqi";
    var url = "https://air-quality-api.open-meteo.com/v1/air-quality" +
      "?latitude=" + lat + "&longitude=" + lon +
      "&hourly=" + vars + "&timezone=auto&forecast_days=4";
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
        return { val: (typeof v === "number") ? v : null,
                 hours: C ? C.airHours(d, nowKey, 72) : null };
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
    var model = readPrefs().model;
    var url = "https://api.open-meteo.com/v1/forecast" +
      "?latitude=" + city.lat + "&longitude=" + city.lon +
      "&current_weather=true" +
      (model !== "best_match" ? "&models=" + encodeURIComponent(model) : "") +
      "&minutely_15=precipitation,snowfall&past_minutely_15=1&forecast_minutely_15=10" +
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
          tzn: typeof d.timezone === "string" ? d.timezone.slice(0, 64) : "",   // wave 38: country of the warnings
          model: model,                           // wave 38: the model this payload came from
          min15: C ? C.minutelySlots(d, C.nowKey(Date.now(), offSec), 10) : null,   // rain, next 2 h
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
        return fetchAqi(city.lat, city.lon, nowKey).then(function (air) {
          if (air && air.val !== null) payload.aqi = { at: Date.now(), val: air.val };
          payload.air = (air && air.hours) || null;
          writeCityCache(city.id, payload);

                    // Mirror into the shell tray cache when this city IS the
          // shell's location — one fetch, two consumers, same numbers.
          // C1: increased tolerance to 0.15° (~15km) to match nearest-city
          // adoption in shell.js — GPS vs geocoded center routinely diverge.
          // 2026-10-09: the tray's place comes from the shell API (a
          // pin, or the first city when nothing is pinned); the entry
          // is tagged with that place so the shell can tell it apart.
          try {
            var tapi = trayApi();
            var sh = tapi ? tapi.location()
                          : JSON.parse(localStorage.getItem("oros-weather"));
            if (sh && (tapi || sh.on) && typeof sh.lat === "number" &&
                Math.abs(sh.lat - city.lat) < 0.15 &&
                Math.abs(sh.lon - city.lon) < 0.15) {
              localStorage.setItem(WX_CACHE_KEY, JSON.stringify({
                at:   payload.at,
                temp: payload.current.temp,
                code: payload.current.code,
                lat:  sh.lat,
                lon:  sh.lon
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
  // W2: a fresh cache must NOT veto the retry when the offline
  // badge is lit by a FAILED attempt while online — the badge
  // stays honest ("last attempt failed") only until ONE good
  // fetch lands. Online + netDown → retry every refresh path
  // (visibility/boot/button); a success clears both in one shot.
  function maybeFetch(force) {
    var city = activeCity();
    if (!city) return Promise.resolve(null);
    var c = readCityCache(city.id);
    // wave 38: a payload of another forecast model is not fresh
    var sameModel = !c || (c.model || "best_match") === readPrefs().model;
    if (!force && c && c.at && sameModel && (Date.now() - c.at) < FETCH_GAP_MS) {
      if (!netDown || !navigator.onLine) return Promise.resolve(c);
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
      toastEl.className = "oro-toast";
      document.body.appendChild(toastEl);
    }
    if (toastAction) { toastAction.remove(); toastAction = null; }
    // W1: the element is REUSED — old text nodes survived the fade
    // and concatenated with the next toast (back-to-back deletes
    // printed both labels in one line). Fresh text, always.
    toastEl.textContent = "";

    toastEl.appendChild(document.createTextNode(text));   // text FIRST

    if (actionLabel && typeof actionFn === "function") {
      toastAction = document.createElement("button");
      toastAction.type = "button";
      toastAction.textContent = actionLabel;
      toastAction.className = "sn-btn";
      toastAction.addEventListener("click", function () {
        actionFn();
        hideToast();
      });
      toastEl.appendChild(toastAction);                  // action SECOND
    }
    void toastEl.offsetWidth;
    toastEl.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(hideToast, actionLabel ? 8000 : 5000);   // WE-4: Undo ≥ 8 s
  }
  function hideToast() {
    if (!toastEl) return;
    toastEl.classList.remove("show");
    if (toastAction) { toastAction.remove(); toastAction = null; }
    // text survives the 0.3s fade-out (no empty-box flash),
    // cleared after — visibility gate already blocked clicks
    setTimeout(function () {
      if (toastEl && !toastEl.classList.contains("show")) toastEl.textContent = "";
    }, 350);
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
        refresh(false, true);
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
    renderExtras(city, p);   // wave 38
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
                            { hour: "2-digit", minute: "2-digit", hourCycle: "h23" });   // WE-6

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

  // ---------- 4b. Wave 38: warnings, rain now, air & pollen, models ----------
  // Pure logic lives in weather/core.js (C); this block fetches,
  // caches (device-local) and paints. Every text from a feed goes in
  // through textContent; links are http(s) only.
  var WARN_GAP = 30 * 60 * 1000;     // feed refresh, like the forecast
  var CMP_GAP  = 30 * 60 * 1000;

  function mk(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined && text !== null) e.textContent = text;
    return e;
  }
  function fill(key, vars) {
    var s = t(key);
    Object.keys(vars || {}).forEach(function (k) { s = s.split("{" + k + "}").join(vars[k]); });
    return s;
  }
  function payloadTz(p) {
    return (p && typeof p.tz === "number") ? p.tz : -new Date().getTimezoneOffset() * 60;
  }
  // A moment in the city's clock: "14:00" today, "Thu 14:00" another day.
  function fmtCityTime(ms, tz) {
    var d = new Date(ms + tz * 1000), now = new Date(Date.now() + tz * 1000);
    var hm = pad(d.getUTCHours()) + ":" + pad(d.getUTCMinutes());
    if (d.toISOString().slice(0, 10) === now.toISOString().slice(0, 10)) return hm;
    var wd = d.toLocaleDateString(LANG === "el" ? "el-GR" : "en-GB", { weekday: "short", timeZone: "UTC" });
    return wd + " " + hm;
  }
  function fmtRain(mm) {
    if (typeof mm !== "number" || isNaN(mm)) return "—";
    return state.units === "imperial" ? (mm / 25.4).toFixed(2) + " in" : mm.toFixed(1) + " mm";
  }
  function toUnit(c) { return state.units === "imperial" ? c * 9 / 5 + 32 : c; }
  function dayName(date, tz) {
    if (date === cityTodayStr(tz)) return t("today");
    return new Date(date + "T12:00:00").toLocaleDateString(LANG === "el" ? "el-GR" : "en-GB", { weekday: "short" });
  }

  // City place details: country + region (from the geocoder).
  function placeInfo(city, g) {
    if (!city || !g) return;
    if (typeof g.cc === "string" && /^[A-Za-z]{2}$/.test(g.cc)) city.cc = g.cc.toUpperCase();
    if (typeof g.adm === "string" && g.adm.trim()) city.adm = g.adm.trim().slice(0, 80);
  }
  // Older cities have neither: one geocoder look-up per city and device.
  function backfillPlace(city) {
    if (!city || city.cc || !navigator.onLine) return Promise.resolve(false);
    var pr = readPrefs();
    if (pr.bf[city.id]) return Promise.resolve(false);
    pr.bf[city.id] = Date.now();
    writePrefs(pr);
    return fetch("https://geocoding-api.open-meteo.com/v1/search?count=10&language=" +
                 (LANG === "el" ? "el" : "en") + "&name=" + encodeURIComponent(city.label))
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) {
        var best = null, bd = Infinity;
        ((d && d.results) || []).forEach(function (g) {
          var dist = Math.abs(g.latitude - city.lat) + Math.abs(g.longitude - city.lon);
          if (dist < bd) { bd = dist; best = g; }
        });
        if (!best || bd > 0.3) return false;
        var live = cityById(city.id);
        if (!live || live.cc) return false;
        placeInfo(live, { cc: best.country_code, adm: best.admin1 });
        if (!live.cc) return false;
        live.mtime = Date.now();      // a tie would keep the copy without them
        save();
        return true;
      })
      .catch(function () { return false; });
  }

  // --- Official warnings (MeteoAlarm) ---
  // Cache "oros-weatherapp-warn" (device-local, also read by the shell):
  //   { feeds: { <slug>: { at: last try, ok: last success, list, err, via } },
  //     sent: { <notice key>: expiry } }   (sent: the shell's notices)
  function readWarn() {
    var w = null;
    try { w = JSON.parse(localStorage.getItem(WARN_KEY)); } catch (e) {}
    if (!w || typeof w !== "object") w = {};
    if (!w.feeds || typeof w.feeds !== "object") w.feeds = {};
    if (!w.sent || typeof w.sent !== "object") w.sent = {};
    return w;
  }
  function writeWarnFeed(slug, entry) {
    var w = readWarn();
    w.feeds[slug] = entry;
    var keys = Object.keys(w.feeds);
    if (keys.length > 4) {
      keys.sort(function (a, b) { return (w.feeds[a].at || 0) - (w.feeds[b].at || 0); });
      while (keys.length > 4) delete w.feeds[keys.shift()];
    }
    try { localStorage.setItem(WARN_KEY, JSON.stringify(w)); } catch (e) {}
  }
  function citySlug(city, p) {
    return (C && city) ? C.slugFor(city.cc, p && p.tzn) : "";
  }
  function countryName(city, p) {
    var cc = C ? C.countryOf(city.cc, p && p.tzn) : "";
    try {
      var dn = new Intl.DisplayNames([LANG === "el" ? "el" : "en"], { type: "region" });
      var n = cc && dn.of(cc);
      if (n) return n;
    } catch (e) {}
    return cc;
  }
  // One GET: the Reader's shared network layer when loaded (direct,
  // then the Mail relay's "web" op when the site sends no CORS
  // headers), else a plain fetch.
  function getText(url) {
    var F = window.orosFeedsFetch;
    if (F && typeof F.fetchOne === "function") {
      return F.fetchOne(url, { accept: "application/atom+xml, application/cap+xml, application/xml;q=0.9, text/xml;q=0.9, */*;q=0.5" })
        .then(function (r) { return { status: r.status, text: r.text || "", via: r.via }; });
    }
    return fetch(url, { credentials: "omit", referrerPolicy: "no-referrer" })
      .then(function (r) { return r.text().then(function (x) { return { status: r.status, text: x, via: "direct" }; }); },
            function () { throw { code: "cors" }; });
  }
  var warnBusy = {};
  function maybeFetchWarnings(city, p, force) {
    if (!C || !city) return Promise.resolve(false);
    var pr = readPrefs();
    if (!pr.warnOn) return Promise.resolve(false);
    var slug = citySlug(city, p), url = C.feedUrl(slug);
    if (!url || !navigator.onLine || warnBusy[slug]) return Promise.resolve(false);
    var cur = readWarn().feeds[slug];
    if (!force && cur && Date.now() - (cur.at || 0) < WARN_GAP) return Promise.resolve(false);
    warnBusy[slug] = true;
    return getText(url).then(function (r) {
      var list = (r.status >= 200 && r.status < 300) ? C.parseAtom(r.text) : null;
      if (!list) throw { code: r.status === 404 ? "notfound" : ((r.status >= 200 && r.status < 300) ? "parse" : "http") };
      var now = Date.now();
      writeWarnFeed(slug, { at: now, ok: now, list: C.activeList(list, now).slice(0, 300), err: "", via: r.via || "" });
      return true;
    }).catch(function (e) {
      var old = readWarn().feeds[slug];
      writeWarnFeed(slug, { at: Date.now(), ok: (old && old.ok) || 0, list: (old && old.list) || [],
                            err: String((e && e.code) || "err"), via: "" });
      return true;
    }).then(function (v) { warnBusy[slug] = false; return v; });
  }

  var capMem = {};                  // CAP details by warning id (session)
  var warnOthersOpen = false;       // "elsewhere" list open (session)
  function loadCap(w, body) {
    var m = capMem[w.id];
    if (m && m.state !== "err") { paintCap(w, body); return; }
    if (!w.cap) { capMem[w.id] = { state: "err" }; paintCap(w, body); return; }
    capMem[w.id] = { state: "loading" };
    paintCap(w, body);
    getText(w.cap).then(function (r) {
      var d = (r.status >= 200 && r.status < 300) ? C.parseCap(r.text, LANG) : null;
      capMem[w.id] = d ? { state: "ok", d: d } : { state: "err" };
    }, function () { capMem[w.id] = { state: "err" }; })
      .then(function () { if (body.isConnected) paintCap(w, body); });
  }
  function paintCap(w, body) {
    body.textContent = "";
    var m = capMem[w.id] || { state: "err" };
    if (m.state === "loading") { body.appendChild(mk("p", "dim", t("warn.loading"))); return; }
    var d = m.d, web = w.web || "https://meteoalarm.org/";
    if (m.state !== "ok" || !d) {
      body.appendChild(mk("p", "dim", t("warn.nodetail")));
    } else {
      if (d.headline) body.appendChild(mk("p", "warn-hl", d.headline));
      if (d.desc) body.appendChild(mk("p", "warn-desc", d.desc));
      if (d.instr) {
        var ins = mk("p", "warn-desc");
        ins.appendChild(mk("strong", "", t("warn.instr") + ": "));
        ins.appendChild(document.createTextNode(d.instr));
        body.appendChild(ins);
      }
      if (d.sender) body.appendChild(mk("p", "dim", t("warn.source") + ": " + d.sender));
      if (d.web) web = d.web;
    }
    if (/^https?:\/\//i.test(web)) {
      var a = mk("a", "warn-link", t("warn.open"));
      a.href = web; a.target = "_blank"; a.rel = "noopener noreferrer";
      body.appendChild(a);
    }
  }
  function warnWhen(w, tz) {
    var now = Date.now();
    if (typeof w.onset === "number" && w.onset > now) {
      return fill("warn.from", { a: fmtCityTime(w.onset, tz), b: typeof w.exp === "number" ? fmtCityTime(w.exp, tz) : "…" });
    }
    return typeof w.exp === "number" ? fill("warn.until", { t: fmtCityTime(w.exp, tz) }) : "";
  }
  function warnCard(w, tz, city, other) {
    var card = mk("div", "warn-card");
    card.setAttribute("data-level", String(w.level));
    var row = mk("div", "warn-row");
    var head = mk("button", "warn-head");
    head.type = "button";
    head.setAttribute("aria-expanded", "false");
    head.appendChild(mk("span", "warn-dot"));
    var txt = mk("span", "warn-txt");
    txt.appendChild(mk("span", "warn-title", C.warnTitle(w, LANG)));
    var sub = [w.area, warnWhen(w, tz)].filter(Boolean).join(" · ");
    txt.appendChild(mk("span", "warn-sub", sub));
    head.appendChild(txt);
    row.appendChild(head);
    var body = mk("div", "warn-body");
    body.hidden = true;
    head.addEventListener("click", function () {
      body.hidden = !body.hidden;
      head.setAttribute("aria-expanded", body.hidden ? "false" : "true");
      if (!body.hidden) loadCap(w, body);
    });
    if (other) {
      var mine = mk("button", "btn-secondary warn-mine", t("warn.myarea"));
      mine.type = "button";
      mine.title = fill("warn.myarea.tip", { city: city.label });
      mine.addEventListener("click", function () {
        var live = cityById(city.id);
        if (!live) return;
        live.wa = { n: String(w.area || "").slice(0, 160), g: String((w.geo && w.geo[0]) || "").slice(0, 40) };
        live.mtime = Date.now();
        save();
        warnOthersOpen = false;
        scheduleRender();
      });
      row.appendChild(mine);
    }
    card.appendChild(row);
    card.appendChild(body);
    return card;
  }
  function renderWarnings(city, p) {
    var host = $("warn-host");
    if (!host) return;
    host.textContent = "";
    host.hidden = true;
    if (!C || !city || !readPrefs().warnOn) return;
    var slug = citySlug(city, p);
    var feed = slug ? readWarn().feeds[slug] : null;
    if (!feed || !Array.isArray(feed.list)) return;
    var list = C.activeList(feed.list, Date.now());
    if (!list.length) return;
    var res = C.forCity(list, city);
    var tz = payloadTz(p);
    if (res.mine.length) {
      var box = mk("div", "warn-box");
      box.setAttribute("role", "region");
      box.setAttribute("aria-label", t("warn.mine"));
      res.mine.forEach(function (w) { box.appendChild(warnCard(w, tz, city, false)); });
      host.appendChild(box);
    }
    if (res.others.length) {
      var det = mk("details", "warn-others");
      det.open = warnOthersOpen;
      det.addEventListener("toggle", function () { warnOthersOpen = det.open; });
      det.appendChild(mk("summary", "", fill(res.how ? "warn.others" : "warn.pick",
        { c: countryName(city, p), n: String(res.others.length) })));
      res.others.forEach(function (w) { det.appendChild(warnCard(w, tz, city, true)); });
      host.appendChild(det);
    }
    if (res.how) {
      var foot = mk("div", "warn-foot");
      foot.appendChild(mk("span", "dim", fill(res.how === "saved" ? "warn.area" : "warn.guess", { a: res.area })));
      if (res.others.length) {
        var ch = mk("button", "link-btn", t("warn.change"));
        ch.type = "button";
        ch.addEventListener("click", function () { warnOthersOpen = true; scheduleRender(); });
        foot.appendChild(ch);
      }
      if (res.how === "saved") {
        var fg = mk("button", "link-btn", t("warn.forget"));
        fg.type = "button";
        fg.addEventListener("click", function () {
          var live = cityById(city.id);
          if (!live) return;
          delete live.wa;
          live.mtime = Date.now();
          save();
          scheduleRender();
        });
        foot.appendChild(fg);
      }
      host.appendChild(foot);
    }
    var at = mk("p", "warn-attrib dim");
    at.appendChild(document.createTextNode(t("warn.attrib") + " "));
    var a = mk("a", "", "meteoalarm.org");
    a.href = "https://meteoalarm.org/"; a.target = "_blank"; a.rel = "noopener noreferrer";
    at.appendChild(a);
    host.appendChild(at);
    host.hidden = false;
  }

  // Dialog section: show / notify (device-local) + this city's status.
  function renderWarnSettings() {
    var host = $("warn-set-host");
    if (!host) return;
    host.textContent = "";
    host.hidden = !C;
    if (!C) return;
    var pr = readPrefs();
    host.appendChild(mk("h4", "", t("warn.set.title")));
    var lab = mk("label", "tray-toggle");
    var cb = document.createElement("input");
    cb.type = "checkbox";
    cb.id = "warn-on";
    cb.checked = pr.warnOn;
    cb.addEventListener("change", function () {
      var q = readPrefs();
      q.warnOn = cb.checked;
      writePrefs(q);
      var c = activeCity();
      if (cb.checked && c) maybeFetchWarnings(c, readPayload(), false).then(function () { renderWarnSettings(); scheduleRender(); });
      renderWarnSettings();
      scheduleRender();
    });
    lab.appendChild(cb);
    lab.appendChild(mk("span", "", t("warn.set.show")));
    host.appendChild(lab);

    var row = mk("label", "warn-notify");
    row.appendChild(mk("span", "", t("warn.set.notify")));
    var sel = document.createElement("select");
    sel.id = "warn-notify";
    ["off", "severe", "all"].forEach(function (v) {
      var o = mk("option", "", t("warn.n." + v));
      o.value = v;
      sel.appendChild(o);
    });
    sel.value = pr.notify;
    sel.addEventListener("change", function () {
      var q = readPrefs();
      q.notify = sel.value;
      writePrefs(q);
    });
    row.appendChild(sel);
    host.appendChild(row);
    host.appendChild(mk("p", "hint", t("warn.set.hint")));

    var city = activeCity();
    if (!city || !pr.warnOn) return;
    var p = readPayload(), slug = citySlug(city, p), msg;
    if (!slug) msg = fill("warn.st.none", { city: city.label });
    else {
      var f = readWarn().feeds[slug];
      if (!f) msg = t("warn.st.wait");
      else if (f.err === "norelay" || f.err === "cors") msg = t("warn.st.cors");
      else if (f.err) msg = t("warn.st.err");
      else msg = fill("warn.st.ok", { c: countryName(city, p), n: String(C.activeList(f.list, Date.now()).length),
        t: new Date(f.ok).toLocaleTimeString(LANG === "el" ? "el-GR" : "en-GB", { hour: "2-digit", minute: "2-digit", hourCycle: "h23" }) });
    }
    host.appendChild(mk("p", "hint", msg));
  }

  // --- Rain in the next 2 hours ---
  function renderNowcast(p) {
    var sec = $("nowcast"), title = $("now-title");
    if (!sec) return;
    sec.hidden = true;
    if (title) title.hidden = true;
    if (!C || !p || !Array.isArray(p.min15)) return;
    var tz = payloadTz(p), nk = C.nowKey(Date.now(), tz), nc = C.nowcast(p.min15, nk, 120);
    if (!nc) return;
    $("now-text").textContent = C.nowcastText(nc, LANG, 120);
    $("now-text").setAttribute("data-state", nc.state);
    var now = C.keyMin(nk);
    var slots = p.min15.filter(function (x) {
      var m = C.keyMin(x.t);
      return m !== null && m + 15 > now && m < now + 120;
    }).slice(0, 8);
    var max = 1;
    slots.forEach(function (x) { if (x.p > max) max = x.p; });
    var bars = $("now-bars");
    bars.textContent = "";
    slots.forEach(function (x, i) {
      var col = mk("div", "nc-col");
      col.title = x.t.slice(11, 16) + " · " + fmtRain(x.p);
      var bw = mk("div", "nc-barwrap");
      var b = mk("div", "nc-bar" + (x.p >= C.WET ? "" : " dry") + (x.s > 0 ? " snow" : ""));
      b.style.height = (x.p >= C.WET ? Math.max(8, Math.round(100 * x.p / max)) : 3) + "%";
      bw.appendChild(b);
      col.appendChild(bw);
      col.appendChild(mk("span", "nc-lbl", i === 0 ? t("now") : (i % 2 === 0 ? x.t.slice(11, 16) : "")));
      bars.appendChild(col);
    });
    sec.title = t("now.tip");
    sec.hidden = false;
    if (title) title.hidden = false;
  }

  // --- Air quality + pollen ---
  var airSel = 0;
  var POLL_NAME = { pm25: "PM2.5", pm10: "PM10", o3: "O₃", no2: "NO₂" };
  function renderAir(p) {
    var sec = $("air"), title = $("air-title");
    if (!sec) return;
    sec.hidden = true;
    if (title) title.hidden = true;
    if (!C || !p || !Array.isArray(p.air) || !p.air.length) return;
    var tz = payloadTz(p), hk = C.nowKey(Date.now(), tz).slice(0, 13) + ":00";
    var hours = p.air.filter(function (h) { return h && typeof h.t === "string" && h.t >= hk; });
    if (!hours.length) return;
    var days = C.airDays(hours).slice(0, 3);

    var dh = $("air-days");
    dh.textContent = "";
    days.forEach(function (d) {
      var c = mk("div", "air-day");
      c.appendChild(mk("span", "air-dname", dayName(d.date, tz)));
      var v = mk("span", "air-dval meta-v");
      if (d.max !== null) {
        v.textContent = Math.round(d.max) + " · " + t("aqi." + d.level);
        v.setAttribute("data-level", d.level);
      } else v.textContent = "—";
      c.appendChild(v);
      if (d.main) c.appendChild(mk("span", "air-dsub dim",
        fill("air.main", { p: POLL_NAME[d.main] || d.main }) + " · " + fill("air.at", { t: d.at })));
      var pol;
      if (!Object.keys(d.pol).length) pol = t("air.nopollen");
      else if (!d.pollen.length) pol = t("air.pollen") + ": " + t("pol.l0");
      else pol = t("air.pollen") + ": " + d.pollen.slice(0, 2).map(function (x) {
        return t("pol." + x.type) + " " + t("pol.l" + x.lvl);
      }).join(" · ");
      c.appendChild(mk("span", "air-dsub dim", pol));
      dh.appendChild(c);
    });

    var strip = $("air-strip");
    strip.textContent = "";
    var hs = hours.slice(0, 24), top = 100;
    hs.forEach(function (h) { if (h.a !== null && h.a > top) top = h.a; });
    if (airSel >= hs.length) airSel = 0;
    hs.forEach(function (h, i) {
      var b = mk("button", "air-col" + (i === airSel ? " sel" : ""));
      b.type = "button";
      var lvl = h.a !== null ? C.aqiLevel(h.a) : "";
      b.setAttribute("aria-label", h.t.slice(11, 16) + " · AQI " + (h.a !== null ? Math.round(h.a) + " " + t("aqi." + lvl) : "—"));
      b.setAttribute("aria-pressed", i === airSel ? "true" : "false");
      var bw = mk("span", "air-barwrap");
      var bar = mk("span", "air-bar");
      if (lvl) bar.setAttribute("data-level", lvl);
      bar.style.height = (h.a !== null ? Math.max(4, Math.round(100 * h.a / top)) : 0) + "%";
      bw.appendChild(bar);
      b.appendChild(bw);
      b.appendChild(mk("span", "air-lbl", i % 3 === 0 ? h.t.slice(11, 13) : ""));
      b.addEventListener("click", function () { airSel = i; renderAir(readPayload()); });
      strip.appendChild(b);
    });
    strip.title = t("air.tip");

    var h = hs[airSel], det = $("air-detail");
    det.textContent = "";
    var head = mk("div", "air-dhead");
    head.appendChild(mk("strong", "", dayName(h.t.slice(0, 10), tz) + " " + h.t.slice(11, 16)));
    var av = mk("span", "meta-v", h.a !== null ? "AQI " + Math.round(h.a) + " · " + t("aqi." + C.aqiLevel(h.a)) : "AQI —");
    if (h.a !== null) av.setAttribute("data-level", C.aqiLevel(h.a));
    head.appendChild(av);
    det.appendChild(head);
    var grid = mk("div", "air-grid");
    ["pm25", "pm10", "o3", "no2"].forEach(function (k) {
      var cell = mk("div", "air-cell");
      cell.appendChild(mk("span", "meta-k", POLL_NAME[k]));
      var cv = h.c && typeof h.c[k] === "number" ? Math.round(h.c[k]) + " " + t("air.unit") : "—";
      var vv = mk("span", "air-cv meta-v", cv);
      var si = h.s && typeof h.s[k] === "number" ? h.s[k] : null;
      if (si !== null) vv.setAttribute("data-level", C.aqiLevel(si));
      cell.appendChild(vv);
      grid.appendChild(cell);
    });
    det.appendChild(grid);
    var pk = Object.keys(h.pol || {});
    if (pk.length) {
      var pl = mk("p", "air-pol dim");
      pl.textContent = t("air.pollen") + ": " + C.POLLEN.filter(function (x) { return pk.indexOf(x) >= 0; }).map(function (x) {
        var lv = C.pollenLevel(x, h.pol[x]);
        return t("pol." + x) + " " + Math.round(h.pol[x]) + " (" + t("pol.l" + lv) + ")";
      }).join(" · ");
      det.appendChild(pl);
    }
    sec.hidden = false;
    if (title) title.hidden = false;
  }

  // --- Forecast model + comparison ---
  function modelName(id) {
    for (var i = 0; C && i < C.MODELS.length; i++) if (C.MODELS[i].id === id) return C.MODELS[i].n || t("model.best");
    return id;
  }
  function fillModelSelect(sel, value, withNone) {
    sel.textContent = "";
    if (withNone) { var o0 = mk("option", "", t("cmp.none")); o0.value = ""; sel.appendChild(o0); }
    C.MODELS.forEach(function (m) {
      var o = mk("option", "", m.n || t("model.best"));
      o.value = m.id;
      sel.appendChild(o);
    });
    sel.value = value;
  }
  var cmpOpen = false, cmpMem = {};
  function renderModelSec(city) {
    var sec = $("model-sec"), title = $("model-title");
    if (!sec) return;
    var show = !!(C && city);
    sec.hidden = !show;
    if (title) title.hidden = !show;
    if (!show) return;
    $("cmp-btn").textContent = t(cmpOpen ? "cmp.hide" : "cmp.btn");
    $("cmp-btn").setAttribute("aria-expanded", cmpOpen ? "true" : "false");
    $("cmp-panel").hidden = !cmpOpen;
    if (cmpOpen) renderCompare();
  }
  function cmpModels() {
    var out = [];
    readPrefs().cmp.forEach(function (m) { if (m && out.indexOf(m) < 0) out.push(m); });
    return out;
  }
  function loadCompare() {
    var city = activeCity(), models = cmpModels();
    if (!C || !city || !models.length) { renderCompare(); return; }
    var key = city.id + "|" + models.join(",");
    var m = cmpMem[key];
    if (m && (m.state === "loading" || (m.state === "ok" && Date.now() - m.at < CMP_GAP))) { renderCompare(); return; }
    if (!navigator.onLine) { if (!m) cmpMem[key] = { state: "err", at: Date.now() }; renderCompare(); return; }
    cmpMem[key] = { state: "loading", at: Date.now(), d: m && m.d };
    renderCompare();
    var url = "https://api.open-meteo.com/v1/forecast?latitude=" + city.lat + "&longitude=" + city.lon +
      "&daily=temperature_2m_max,temperature_2m_min,precipitation_sum&models=" +
      encodeURIComponent(models.join(",")) + "&timezone=auto&forecast_days=7";
    fetch(url).then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) { return d ? C.parseCompare(d, models) : null; })
      .catch(function () { return null; })
      .then(function (res) {
        cmpMem[key] = res ? { state: "ok", at: Date.now(), d: res } : { state: "err", at: Date.now() };
        renderCompare();
      });
  }
  var SVGNS = "http://www.w3.org/2000/svg";
  function sv(tag, attrs) {
    var e = document.createElementNS(SVGNS, tag);
    Object.keys(attrs || {}).forEach(function (k) { e.setAttribute(k, String(attrs[k])); });
    return e;
  }
  function renderCompare() {
    var out = $("cmp-out");
    if (!out || !cmpOpen) return;
    out.textContent = "";
    var city = activeCity(), models = cmpModels();
    if (!city || !models.length) return;
    var m = cmpMem[city.id + "|" + models.join(",")];
    if (!m || (m.state === "loading" && !m.d)) { out.appendChild(mk("p", "hint", t("cmp.loading"))); return; }
    if (m.state === "err" || !m.d) { out.appendChild(mk("p", "hint err", t("cmp.err"))); return; }
    var d = m.d, n = d.dates.length, tz = payloadTz(readPayload());
    var lo = Infinity, hi = -Infinity;
    d.series.forEach(function (s) {
      s.max.concat(s.min).forEach(function (v) { if (typeof v === "number") { v = toUnit(v); if (v < lo) lo = v; if (v > hi) hi = v; } });
    });
    if (!isFinite(lo)) { out.appendChild(mk("p", "hint err", t("cmp.err"))); return; }
    lo = Math.floor(lo - 1); hi = Math.ceil(hi + 1);
    var W = 320, H = 150, L = 30, R = 8, T = 10, B = 22;
    var svg = sv("svg", { viewBox: "0 0 " + W + " " + H, "class": "cmp-chart", role: "img",
                          "aria-label": t("cmp.btn") + ": " + d.series.map(function (s) { return modelName(s.model); }).join(", ") });
    function x(i) { return L + (n > 1 ? i * (W - L - R) / (n - 1) : 0); }
    function y(v) { return T + (hi - v) * (H - T - B) / (hi - lo); }
    [lo, Math.round((lo + hi) / 2), hi].forEach(function (v) {
      svg.appendChild(sv("line", { x1: L, x2: W - R, y1: y(v), y2: y(v), "class": "cmp-grid" }));
      var tx = sv("text", { x: L - 4, y: y(v) + 3, "text-anchor": "end", "class": "cmp-ax" });
      tx.textContent = Math.round(v) + "°";
      svg.appendChild(tx);
    });
    d.dates.forEach(function (dt, i) {
      var tx = sv("text", { x: x(i), y: H - 6, "text-anchor": "middle", "class": "cmp-ax" });
      tx.textContent = dayName(dt, tz);
      svg.appendChild(tx);
    });
    d.series.forEach(function (s, k) {
      [["max", ""], ["min", "4 3"]].forEach(function (pair) {
        var pts = [];
        s[pair[0]].forEach(function (v, i) { if (typeof v === "number") pts.push(x(i).toFixed(1) + "," + y(toUnit(v)).toFixed(1)); });
        if (pts.length < 2) return;
        var a = { points: pts.join(" "), "class": "cmp-line cmp-s" + k };
        if (pair[1]) a["stroke-dasharray"] = pair[1];
        svg.appendChild(sv("polyline", a));
      });
    });
    out.appendChild(svg);
    var leg = mk("div", "cmp-legend");
    d.series.forEach(function (s, k) {
      var it = mk("span", "cmp-key");
      it.appendChild(mk("span", "cmp-sw cmp-b" + k));
      it.appendChild(document.createTextNode(modelName(s.model)));
      leg.appendChild(it);
    });
    out.appendChild(leg);
    out.appendChild(mk("p", "hint", t("cmp.max")));
    var tb = mk("table", "cmp-rain"), tr = mk("tr");
    tr.appendChild(mk("th", "", t("cmp.rain") + " (" + (state.units === "imperial" ? "in" : "mm") + ")"));
    d.dates.forEach(function (dt) { tr.appendChild(mk("th", "", dayName(dt, tz))); });
    var th = mk("thead"); th.appendChild(tr); tb.appendChild(th);
    var tbody = mk("tbody");
    d.series.forEach(function (s, k) {
      var r = mk("tr"), nm = mk("th", "");
      nm.appendChild(mk("span", "cmp-sw cmp-b" + k));
      nm.appendChild(document.createTextNode(modelName(s.model)));
      nm.title = modelName(s.model);
      r.appendChild(nm);
      d.dates.forEach(function (dt, i) {
        var v = s.rain[i];
        r.appendChild(mk("td", typeof v === "number" && v >= 0.1 ? "" : "dim",
          typeof v === "number" ? (state.units === "imperial" ? (v / 25.4).toFixed(2) : (v < 10 ? v.toFixed(1) : String(Math.round(v)))) : "—"));
      });
      tbody.appendChild(r);
    });
    tb.appendChild(tbody);
    var wrap = mk("div", "cmp-tablewrap");
    wrap.appendChild(tb);
    out.appendChild(wrap);
  }
  function wireExtras() {
    if (!C || !$("model-sel")) return;
    var pr = readPrefs();
    fillModelSelect($("model-sel"), pr.model, false);
    $("model-sel").setAttribute("aria-label", t("model.title"));
    $("model-hint").textContent = t("model.hint");
    $("model-sel").addEventListener("change", function () {
      var q = readPrefs();
      q.model = $("model-sel").value;
      writePrefs(q);
      refresh(true, true);
    });
    var pick = $("cmp-pickers");
    pick.textContent = "";
    pr.cmp.forEach(function (m, i) {
      var s = document.createElement("select");
      s.setAttribute("aria-label", fill("cmp.model", { n: String(i + 1) }));
      s.className = "cmp-sel cmp-bd" + i;
      fillModelSelect(s, m, i > 0);
      if (i === 0 && !m) s.value = "best_match";
      s.addEventListener("change", function () {
        var q = readPrefs();
        q.cmp[i] = s.value;
        writePrefs(q);
        loadCompare();
      });
      pick.appendChild(s);
    });
    $("cmp-btn").addEventListener("click", function () {
      cmpOpen = !cmpOpen;
      renderModelSec(activeCity());
      if (cmpOpen) loadCompare();
    });
  }

  function renderExtras(city, p) {
    renderWarnings(city, p);
    renderNowcast(city ? p : null);
    renderAir(city ? p : null);
    renderModelSec(city);
    // Wave 52: rain map (rainmap.js; loads nothing until opened)
    if (window.OrosRainMap) window.OrosRainMap.update(city, p ? payloadTz(p) : null);
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

  // ---------- Taskbar (tray) settings ----------
  // 2026-10-09: the shell menu no longer carries the weather tray
  // settings; they live here. The shell owns the tray (parent API
  // orosWeatherTray, typeof-guarded: a stale shell hides the section).
  function trayApi() {
    try {
      var api = window.parent && window.parent !== window && window.parent.orosWeatherTray;
      if (api && typeof api.isOn === "function" && typeof api.pin === "function" &&
          typeof api.location === "function" && typeof api.setOn === "function") return api;
    } catch (e) {}
    return null;
  }

  // The city the tray shows: nearest to the tray location (0.15°,
  // the shell's WX_NEAR_DEG). The shell's fallback IS the first city.
  function trayCityId() {
    var api = trayApi();
    var loc = api ? api.location() : null;
    if (!loc) return null;
    var best = null, bestD = Infinity;
    state.cities.forEach(function (c) {
      var d = Math.abs(c.lat - loc.lat) + Math.abs(c.lon - loc.lon);
      if (d < bestD) { bestD = d; best = c; }
    });
    return (best && bestD < 0.15) ? best.id : null;
  }

  function pinTrayCity(c) {
    var api = trayApi();
    if (!api) return;
    if (!api.pin({ lat: c.lat, lon: c.lon, label: c.label })) return;
    // Record it as the shell location we already applied, so the
    // boot reconciliation (syncShellLocation) never fights it.
    var fp = wxPrefFingerprint(c);
    if (state.shellWx !== fp) { state.shellWx = fp; state.sm = Date.now(); save(); }
  }

  function renderTraySection() {
    var host = $("tray-host");
    if (!host) return;
    var api = trayApi();
    host.hidden = !api;
    if (!api) return;
    host.innerHTML = "";

    var h = document.createElement("h4");
    h.textContent = t("tray.title");
    host.appendChild(h);

    var lab = document.createElement("label");
    lab.className = "tray-toggle";
    var cb = document.createElement("input");
    cb.type = "checkbox";
    cb.id = "tray-on";
    cb.checked = api.isOn();
    cb.addEventListener("change", function () {
      api.setOn(cb.checked);
      renderCityList();
    });
    var span = document.createElement("span");
    span.textContent = t("tray.show");
    lab.appendChild(cb);
    lab.appendChild(span);
    host.appendChild(lab);

    var hint = document.createElement("p");
    hint.className = "hint";
    hint.textContent = t("tray.hint");
    host.appendChild(hint);
  }

  function renderCityList() {
    var host = $("city-list");
    host.innerHTML = "";
    renderTraySection();
    renderWarnSettings();   // wave 38
    var api = trayApi();
    var trayId = (api && api.isOn()) ? trayCityId() : null;

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

      if (api && api.isOn()) {
        var on = (c.id === trayId);
        var pin = document.createElement("button");
        pin.type = "button";
        pin.className = "city-pin" + (on ? " on" : "");
        pin.setAttribute("aria-pressed", on ? "true" : "false");
        pin.setAttribute("aria-label", t(on ? "tray.pinned" : "tray.pin"));
        pin.title = t(on ? "tray.pinned" : "tray.pin");
        pin.innerHTML =
          '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 8h18"/></svg>';
        pin.addEventListener("click", function (ev) {
          ev.stopPropagation();
          pinTrayCity(c);
          renderCityList();
        });
        row.appendChild(pin);
      }

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
        refresh(false, true);
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
    placeInfo(city, g);   // wave 38: country + region (official warnings)
    city.pos = state.cities.length;
    state.cities.push(city);
    state.active = city.id;
    // WE-3: appending changes no relative order — no `om` stamp
    // (a stamp here let a fresh device's order replace the user's)
    state.sm = Date.now();
    save();
    $("city-input").value = "";
    renderCityList();
    $("dlg-city").close();
    refresh(true, true);      // brand new city → force fetch (user action)
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
    // Deleting the PINNED tray city unpins it: the tray falls back to
    // the first city instead of showing a place that left the list.
    var api = trayApi();
    var loc = api ? api.location() : null;
    var unpin = !!(loc && loc.pinned && trayCityId() === id);
    state.cities = state.cities.filter(function (c) { return c.id !== id; });
    if (!state.deleted) state.deleted = {};
    state.deleted[id] = Date.now();              // tombstone — merge-safe
    if (!state.cities.some(function (c) { return c.id === state.active; })) {
      state.active = state.cities.length ? state.cities[0].id : null;
    }
    state.sm = Date.now();
    // purge this city's device-local cache entry too
    var m = readCacheMap();
    delete m[id];
    try { localStorage.setItem(CACHE_KEY, JSON.stringify(m)); } catch (e) {}
    save();
    if (unpin) api.pin(null);
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
          state.sm = Date.now();
          save();
          scheduleRender();
          refresh(true, true);            // cache was purged — force (user action)
        }
      });
  }
  
    // ---------- 5. Sync slice + palette ----------
  var PAL_VARS = ["--bg", "--bg-desktop", "--bar-bg", "--text", "--text-dim",
                  "--accent", "--accent-hover", "--accent-soft",
                  "--panel-bg", "--border", "--shadow",
                  "--danger", "--ok", "--warn"];

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
    // WE-1: same canonical form as the merge output (fresh copy)
    return mergeWeatherStates(state, state);
  }

  // data — merged result (or plain remote on legacy LWW paths)
  // info — { merged: true } via mergeWeatherStates; else wholesale
  function sliceSet(data, info) {
    data = migrate(JSON.parse(JSON.stringify(data || null)));
    if (!data || !Array.isArray(data.cities)) return;

    window.__orosSyncApi._suppress = true;
    try {
      data.deleted = pruneTombstones(data.deleted);
      state = data;
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } finally {
      window.__orosSyncApi._suppress = false;
    }

    var ok = state.cities.some(function (c) { return c.id === state.active; });
    if (!ok) state.active = state.cities.length ? state.cities[0].id : null;

    scheduleRender();    // remote change landed (units/cities) — repaint live
    if (info && info.merged) notifyTransient(t("toast.merged"));   // light ack — no noise, no inbox line
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

  function refresh(force, userInit) {
    var btn = $("refresh-btn");
    var hadCity = !!activeCity();
    btn.classList.add("loading");
    maybeFetch(force)
      .then(function (res) {
        // Silent failures were invisible — a dead fetch looked
        // like "offline". Now it SPEAKS (online + no result).
        // userInit → transient (answer to the user's own click);
        // background (boot/visibility) → emit: one inbox line per
        // day, so a persistent outage surfaces instead of dying
        // with an invisible 5s toast nobody saw.
        if (!res && hadCity && navigator.onLine) {
          if (userInit) notifyTransient(t("err.fetch"));
          else notifyFetchFail();
        }
        scheduleRender();
        // wave 38: country/region for old cities, then the warnings
        // (a refresh button press re-reads the feed too)
        var city = activeCity();
        if (!city) return;
        return backfillPlace(city).then(function (changed) {
          if (changed) scheduleRender();
          return maybeFetchWarnings(activeCity(), readPayload(), !!force);
        }).then(function (changed) {
          if (changed) {
            scheduleRender();
            if ($("dlg-city").open) renderWarnSettings();
          }
        });
      })
      .catch(function () { /* fetchForecast never throws */ })
      .finally(function () { btn.classList.remove("loading"); });
  }

  function wire() {
    $("city-btn").addEventListener("click", openCityDialog);
    $("refresh-btn").addEventListener("click", function () { refresh(true, true); });

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
      state.um = Date.now();     // WE-3: own stamp for units
      state.sm = state.um;       // old builds read units by sm
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
      if (e.target.closest("#hourly, #air-strip, .cmp-tablewrap, select, #rain-map-wrap")) { tracking = false; return; }
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
      refresh(false, true);
    });
    $("wxmain").addEventListener("pointercancel", function () {
      tracking = false;    // interrupted gesture — clean slate, no false swipes
    });
  }

  // Shell pref fingerprint — ONE construction, used by BOTH the
  // live bridge and the boot reconciliation, so they can never
  // disagree about what "the shell last asked for" means.
  function wxPrefFingerprint(w) {
    return [w.lat.toFixed(3), w.lon.toFixed(3), w.label || ""].join("|");
  }

  // Shell→app bridge: the menu's weather settings push location
  // changes straight into the RUNNING app. Upsert by coords, set
  // active, stamp (stamps stay owned by this app), refresh.
  window.__orosWeatherUpdate = function (w) {
    // typeof-guard: undefined slips through a `=== null` check —
    // a partial/label-only push created a NEW "My location" city
    // (NaN coord-compare never matched a dup) on every push.
    if (!w || typeof w.lat !== "number" ||
        typeof w.lon !== "number" || isNaN(w.lat) || isNaN(w.lon)) return;
    // Shell-vs-GPS discriminator (verified in shell.js): every
    // shell push carries wxRead()'s boolean `on` (guard rejects
    // !w.on upstream); GPS pushes ({lat, lon, label}) carry none.
    // A shell push must STAMP state.shellWx NOW — otherwise the
    // next boot's syncShellLocation() still holds the OLD
    // fingerprint, sees fp_new !== fp_old and re-forces the shell
    // city active, overriding the user's in-app choice meanwhile.
    var fromShell = (w.on === true);
    if (fromShell) state.shellWx = wxPrefFingerprint(w);
    var dup = null;
    state.cities.forEach(function (c) {
      if (Math.abs(c.lat - w.lat) < 0.15 && Math.abs(c.lon - w.lon) < 0.15) dup = c;
    });
    // 2026-10-09: a shell push now comes from a tray pin made in this
    // app (on any device): the city is already in the list, and the
    // pin must not switch the city the user is looking at.
    if (dup && fromShell) { save(); return; }
    if (dup) {
      if (w.label && w.label !== dup.label) { dup.label = w.label; dup.mtime = Date.now(); }
      if (state.active !== dup.id) { state.active = dup.id; state.sm = Date.now(); }
    } else {
      var c = newCityObj(w.label || (LANG === "el" ? "Η τοποθεσία μου" : "My location"),
                         w.lat, w.lon);
      c.pos = state.cities.length;
      state.cities.push(c);
      state.active = c.id;
      state.sm = Date.now();
    }
    save();
    scheduleRender();
    refresh(true, true);  // a location change deserves fresh data (user action)
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

    var fp = wxPrefFingerprint(w);
    // Skip only when nothing changed AND the list isn't empty.
    // An EMPTY list re-adopts the shell location on boot — deleting
    // everything resets to the tray's truth instead of stranding
    // the user with no city at all. Deleting it while OTHER cities
    // exist stays respected (no fighting the user).
    if (fp === state.shellWx && state.cities.length > 0) return;
    // An empty list on a SYNCED device is usually a first open whose
    // cities have not been pulled yet: adopting the tray place now
    // created a second copy of a city already in the cloud (new id,
    // same place). The tray keeps showing it either way.
    if (state.cities.length === 0) {
      try {
        var eng = window.parent && window.parent.orosSync;
        if (eng && typeof eng.isConnected === "function" && eng.isConnected()) return;
      } catch (e) {}
    }
    state.shellWx = fp;

    var dup = null;
    state.cities.forEach(function (c) {
      if (Math.abs(c.lat - w.lat) < 0.15 && Math.abs(c.lon - w.lon) < 0.15) dup = c;
    });
    if (dup) {
      // tray pin of a listed city: remember it, never switch the view
      state.sm = Date.now();
    } else {
      var c = newCityObj(w.label || (LANG === "el" ? "Η τοποθεσία μου" : "My location"),
                         w.lat, w.lon);
      c.pos = state.cities.length;
      state.cities.push(c);
      state.active = c.id;
      state.sm = Date.now();
    }
    save();
  }

  // ---------- Boot ----------
  var SCRIPT_V = "0.3.0";
  try {
    var vm = document.currentScript && String(document.currentScript.src).match(/[?&]v=([^&]+)/);
    if (vm) SCRIPT_V = decodeURIComponent(vm[1]);
  } catch (e) {}
  console.log("[orOS] weather.js v" + SCRIPT_V + " boot");
  // WA2 fix: the api stub must exist BEFORE the first save() —
  // load()/syncShellLocation() mutate state at boot (fresh state,
  // shell-pref city upsert) and their dirty flag was silently
  // dropped: __orosSyncApi was only defined in registerSync(),
  // several statements later. Dynamic engine resolution (the
  // parent's orosSync is loaded with the shell — always present).
  window.__orosSyncApi = {
    _suppress: false,
    dirty: function () {
      if (this._suppress) return;
      var api = (window.parent && window.parent.orosSync) || window.orosSync;
      if (api && typeof api.markDirty === "function") api.markDirty();
    }
  };
  load();
  syncShellLocation();
  applyI18n();
  paintStaticAria();
  wire();
  wireExtras();               // wave 38: model select + comparison
  registerSync();
  inheritPalette();
  watchPalette();
  renderAll(readPayload());   // instant paint from cache (if any)…
  refresh(false);             // …then fetch if the cache is >30min old
})();