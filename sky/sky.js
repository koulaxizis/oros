// ============================================================
// orOS Moon & Sky — App logic (v1.0.0)
// What the sky holds tonight from your place, computed offline:
//   - Tonight: the Moon as it looks (phase, tilt), moonrise and
//     moonset, the Sun, twilights, golden and blue hour, the
//     planets you can see, and what is coming up
//   - Sky map: the dome above you with the Moon, planets, about
//     290 bright stars and 34 constellations; a time slider
//   - Month: the Moon for every day, equinoxes and solstices,
//     meteor shower peaks, supermoons and eclipses
//   - time travel to any date; red night view
// Location is the one in Time (its Sun & Moon card): Time's own
// setting → Weather → this device's position, for this visit only.
// "Change location" opens Time, so there is one place to set it.
// Data: nothing synced; device-local prefs (R10) oros-sky-prefs
// (tab, red night view, constellation lines).
// Sections:
//   1. Constants, i18n, helpers
//   2. Prefs + location
//   3. Date + tabs
//   4. Moon drawing
//   5. Tonight
//   6. Sky map
//   7. Month
//   8. Toasts
//   9. Deep links + keyboard (Contract Β)
//  10. Palette
//  11. Wiring & boot
// ============================================================
(function () {
  "use strict";

  var C = window.OrosSkyCore;
  var CAT = window.OrosSkyStars;
  var PREFS_KEY = "oros-sky-prefs";
  var TIME_KEY = "oros-time-data";
  var MIN = 60000, HOUR = 3600000, DAY = 86400000;
  var TABS = ["tonight", "map", "month"];

  // ---------- 1. Constants, i18n, helpers ----------
  function appLang() {
    try {
      var l = localStorage.getItem("oros-lang") ||
              (window.parent && window.parent.orosLang) || "en";
      return l === "el" ? "el" : "en";
    } catch (e) { return "en"; }
  }
  var LANG = appLang();
  var LOCALE = LANG === "el" ? "el-GR" : "en-GB";

  var STRINGS = {
    en: {
      "app.name": "Moon & Sky",
      "tab.tonight": "Tonight", "tab.map": "Sky map", "tab.month": "Month",
      "btn.today": "Today", "f.date": "Date", "btn.now": "Now", "btn.lines": "Constellations",
      "night.on": "Red night view: on", "night.off": "Red night view: off",
      "loc.btn": "Change location (opens Time)",
      "sub.time": "{place} · location from Time", "sub.weather": "{place} · location from Weather",
      "sub.geo": "{place} · this device, for this visit",
      "noloc.title": "Where are you?",
      "noloc.hint": "Moon & Sky uses the location of the Sun & Moon card in Time, or the Weather app's. Set it once there and both apps use it.",
      "noloc.time": "Set location in Time", "noloc.geo": "Use device location (this time only)",
      "geo.wait": "Finding your location…", "geo.fail": "Location is not available",
      "notime": "Time is not available here",
      "ph.0": "New moon", "ph.1": "Waxing crescent", "ph.2": "First quarter", "ph.3": "Waxing gibbous",
      "ph.4": "Full moon", "ph.5": "Waning gibbous", "ph.6": "Last quarter", "ph.7": "Waning crescent",
      "moon.meta": "{p}% lit · {age} days old · {km} km away",
      "moon.img": "The Moon: {phase}, {p}% lit",
      "next.new": "Next new moon", "next.full": "Next full moon", "supermoon": "Supermoon",
      "sec.moon": "Moon", "sec.sun": "Sun", "sec.dark": "When it gets dark", "sec.photo": "Light for photos",
      "sec.planets": "Planets tonight", "sec.soon": "Coming up", "sec.events": "This month",
      "moonrise": "Moonrise", "moonset": "Moonset", "none.day": "Not on this day",
      "moon.now": "Now", "moon.up": "{alt}° high, {dir}", "moon.down": "Below the horizon",
      "sunrise": "Sunrise", "sunset": "Sunset", "noon": "Highest", "daylen": "Day length",
      "polar.day": "The Sun does not set", "polar.night": "The Sun does not rise",
      "civil": "Twilight ends", "naut": "Horizon fades", "astro": "Fully dark",
      "astro.end": "Darkness ends", "civil.dawn": "Morning twilight",
      "never.dark": "Never fully dark tonight",
      "gold.am": "Golden hour (morning)", "blue.am": "Blue hour (morning)",
      "gold.pm": "Golden hour (evening)", "blue.pm": "Blue hour (evening)",
      "p.mercury": "Mercury", "p.venus": "Venus", "p.mars": "Mars", "p.jupiter": "Jupiter", "p.saturn": "Saturn",
      "p.sun": "Sun", "p.moon": "Moon",
      "pl.line": "{when}, {dir}, {height}",
      "pl.evening": "In the evening", "pl.morning": "Before dawn", "pl.night": "Most of the night",
      "pl.window": "from {a} to {b}", "pl.best": "best around {t}",
      "h.low": "low", "h.mid": "halfway up", "h.high": "high",
      "b.vbright": "very bright", "b.bright": "bright", "b.easy": "easy to see", "b.faint": "faint",
      "pl.none": "No planets to see tonight.", "pl.hidden": "Not visible tonight: {list}",
      "dir.0": "North", "dir.1": "Northeast", "dir.2": "East", "dir.3": "Southeast",
      "dir.4": "South", "dir.5": "Southwest", "dir.6": "West", "dir.7": "Northwest",
      "card.N": "N", "card.E": "E", "card.S": "S", "card.W": "W",
      "map.time": "Sky at {t}", "map.list": "What is up (list)",
      "map.img": "Sky map for {t}: {n} bright objects above the horizon. The list below names them.",
      "map.empty": "Nothing bright is above the horizon right now.",
      "info.alt": "{alt}° above the horizon, {dir} ({az}°)", "info.below": "Below the horizon",
      "info.mag": "Brightness (magnitude) {m}", "info.star": "Star in {con}", "info.planet": "Planet, {d} AU away",
      "info.moon": "{phase}, {p}% lit",
      "ev.lunar.vis": "Visible from your place", "ev.lunar.part": "Partly visible from your place: the Moon rises or sets during it", "ev.lunar.no": "Not visible from your place: the Moon is below the horizon",
      "ev.solar.vis": "Visible from your place: {p}% of the Sun covered", "ev.solar.no": "Not visible from your place", "ev.solar.total": "Total from your place",
      "ev.shower": "Up to {n} meteors an hour under a dark sky", "ev.low": "the radiant stays low from your place",
      "ev.moon": "a bright Moon that night", "ev.none": "Nothing special this month.",
      "ev.soon.none": "Nothing special in the next two months.",
      "prev": "Previous month", "next": "Next month",
      "day.label": "{date}: {phase}, {p}% lit",
      "km": "km"
    },
    el: {
      "app.name": "Σελήνη & Ουρανός",
      "tab.tonight": "Απόψε", "tab.map": "Χάρτης ουρανού", "tab.month": "Μήνας",
      "btn.today": "Σήμερα", "f.date": "Ημερομηνία", "btn.now": "Τώρα", "btn.lines": "Αστερισμοί",
      "night.on": "Κόκκινη νυχτερινή όψη: ανοιχτή", "night.off": "Κόκκινη νυχτερινή όψη: κλειστή",
      "loc.btn": "Αλλαγή τοποθεσίας (ανοίγει την Ώρα)",
      "sub.time": "{place} · τοποθεσία από την Ώρα", "sub.weather": "{place} · τοποθεσία από τον Καιρό",
      "sub.geo": "{place} · αυτή η συσκευή, μόνο αυτή τη φορά",
      "noloc.title": "Πού βρίσκεσαι;",
      "noloc.hint": "Το Σελήνη & Ουρανός χρησιμοποιεί την τοποθεσία της κάρτας «Ήλιος & Σελήνη» της Ώρας ή του Καιρού. Όρισέ την μία φορά εκεί και τη χρησιμοποιούν και οι δύο εφαρμογές.",
      "noloc.time": "Ορισμός τοποθεσίας στην Ώρα", "noloc.geo": "Τοποθεσία συσκευής (μόνο αυτή τη φορά)",
      "geo.wait": "Εντοπισμός…", "geo.fail": "Η τοποθεσία δεν είναι διαθέσιμη",
      "notime": "Το Time δεν είναι διαθέσιμο εδώ",
      "ph.0": "Νέα Σελήνη", "ph.1": "Αύξουσα μηνίσκος", "ph.2": "Πρώτο τέταρτο", "ph.3": "Αύξουσα αμφίκυρτη",
      "ph.4": "Πανσέληνος", "ph.5": "Φθίνουσα αμφίκυρτη", "ph.6": "Τελευταίο τέταρτο", "ph.7": "Φθίνουσα μηνίσκος",
      "moon.meta": "Φωτίζεται {p}% · {age} ημερών · σε απόσταση {km} χλμ.",
      "moon.img": "Η Σελήνη: {phase}, φωτίζεται {p}%",
      "next.new": "Επόμενη Νέα Σελήνη", "next.full": "Επόμενη Πανσέληνος", "supermoon": "Υπερπανσέληνος",
      "sec.moon": "Σελήνη", "sec.sun": "Ήλιος", "sec.dark": "Πότε σκοτεινιάζει", "sec.photo": "Φως για φωτογραφίες",
      "sec.planets": "Πλανήτες απόψε", "sec.soon": "Έρχονται", "sec.events": "Αυτόν τον μήνα",
      "moonrise": "Ανατολή Σελήνης", "moonset": "Δύση Σελήνης", "none.day": "Όχι αυτή τη μέρα",
      "moon.now": "Τώρα", "moon.up": "{alt}° ψηλά, {dir}", "moon.down": "Κάτω από τον ορίζοντα",
      "sunrise": "Ανατολή", "sunset": "Δύση", "noon": "Πιο ψηλά", "daylen": "Διάρκεια ημέρας",
      "polar.day": "Ο Ήλιος δεν δύει", "polar.night": "Ο Ήλιος δεν ανατέλλει",
      "civil": "Τέλος λυκόφωτος", "naut": "Σβήνει ο ορίζοντας", "astro": "Πλήρες σκοτάδι",
      "astro.end": "Τέλος σκοταδιού", "civil.dawn": "Πρωινό λυκαυγές",
      "never.dark": "Δεν σκοτεινιάζει πλήρως απόψε",
      "gold.am": "Χρυσή ώρα (πρωί)", "blue.am": "Μπλε ώρα (πρωί)",
      "gold.pm": "Χρυσή ώρα (βράδυ)", "blue.pm": "Μπλε ώρα (βράδυ)",
      "p.mercury": "Ερμής", "p.venus": "Αφροδίτη", "p.mars": "Άρης", "p.jupiter": "Δίας", "p.saturn": "Κρόνος",
      "p.sun": "Ήλιος", "p.moon": "Σελήνη",
      "pl.line": "{when}, {dir}, {height}",
      "pl.evening": "Το βράδυ", "pl.morning": "Πριν ξημερώσει", "pl.night": "Το μεγαλύτερο μέρος της νύχτας",
      "pl.window": "από {a} έως {b}", "pl.best": "καλύτερα γύρω στις {t}",
      "h.low": "χαμηλά", "h.mid": "στη μέση του ουρανού", "h.high": "ψηλά",
      "b.vbright": "πολύ λαμπρός", "b.bright": "λαμπρός", "b.easy": "φαίνεται εύκολα", "b.faint": "αμυδρός",
      "pl.none": "Δεν φαίνονται πλανήτες απόψε.", "pl.hidden": "Δεν φαίνονται απόψε: {list}",
      "dir.0": "Βόρεια", "dir.1": "Βορειοανατολικά", "dir.2": "Ανατολικά", "dir.3": "Νοτιοανατολικά",
      "dir.4": "Νότια", "dir.5": "Νοτιοδυτικά", "dir.6": "Δυτικά", "dir.7": "Βορειοδυτικά",
      "card.N": "Β", "card.E": "Α", "card.S": "Ν", "card.W": "Δ",
      "map.time": "Ο ουρανός στις {t}", "map.list": "Τι είναι πάνω από τον ορίζοντα (λίστα)",
      "map.img": "Χάρτης ουρανού για {t}: {n} λαμπρά σώματα πάνω από τον ορίζοντα. Η λίστα από κάτω τα ονομάζει.",
      "map.empty": "Τίποτα λαμπρό δεν είναι πάνω από τον ορίζοντα αυτή την ώρα.",
      "info.alt": "{alt}° πάνω από τον ορίζοντα, {dir} ({az}°)", "info.below": "Κάτω από τον ορίζοντα",
      "info.mag": "Λαμπρότητα (μέγεθος) {m}", "info.star": "Αστέρι στον αστερισμό {con}", "info.planet": "Πλανήτης, σε απόσταση {d} ΑΜ",
      "info.moon": "{phase}, φωτίζεται {p}%",
      "ev.lunar.vis": "Φαίνεται από το μέρος σου", "ev.lunar.part": "Φαίνεται εν μέρει από το μέρος σου: η Σελήνη ανατέλλει ή δύει στη διάρκειά της", "ev.lunar.no": "Δεν φαίνεται από το μέρος σου: η Σελήνη είναι κάτω από τον ορίζοντα",
      "ev.solar.vis": "Φαίνεται από το μέρος σου: καλύπτεται το {p}% του Ήλιου", "ev.solar.no": "Δεν φαίνεται από το μέρος σου", "ev.solar.total": "Ολική από το μέρος σου",
      "ev.shower": "Έως {n} διάττοντες την ώρα σε σκοτεινό ουρανό", "ev.low": "το σημείο εκκίνησης μένει χαμηλά από το μέρος σου",
      "ev.moon": "λαμπρή Σελήνη εκείνη τη νύχτα", "ev.none": "Τίποτα ιδιαίτερο αυτόν τον μήνα.",
      "ev.soon.none": "Τίποτα ιδιαίτερο τους επόμενους δύο μήνες.",
      "prev": "Προηγούμενος μήνας", "next": "Επόμενος μήνας",
      "day.label": "{date}: {phase}, φωτίζεται {p}%",
      "km": "χλμ."
    }
  };

  function t(key, params) {
    var p = STRINGS[LANG] || STRINGS.en;
    var s = p[key] !== undefined ? p[key] : (STRINGS.en[key] !== undefined ? STRINGS.en[key] : key);
    if (params) {
      Object.keys(params).forEach(function (k) {
        s = s.split("{" + k + "}").join(String(params[k]));
      });
    }
    return s;
  }
  function $(id) { return document.getElementById(id); }
  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  }
  function setLabel(b, label) { b.setAttribute("aria-label", label); b.title = label; }
  function hm(ms) {
    if (ms == null) return "—";
    return new Date(ms).toLocaleTimeString(LOCALE, { hour: "2-digit", minute: "2-digit", hour12: false });
  }
  function dayLabel(ms, opts) {
    return new Date(ms).toLocaleDateString(LOCALE, opts || { weekday: "short", day: "numeric", month: "short" });
  }
  function dur(ms) {
    var m = Math.round(ms / MIN);
    return Math.floor(m / 60) + (LANG === "el" ? " ώ " : " h ") + (m % 60 < 10 ? "0" : "") + (m % 60) + (LANG === "el" ? " λ" : " min");
  }
  function num(n, d) { return Number(n).toLocaleString(LOCALE, { maximumFractionDigits: d || 0, minimumFractionDigits: d || 0 }); }
  function kv(dl, rows) {
    dl.innerHTML = "";
    rows.forEach(function (r) {
      dl.appendChild(el("dt", "", r[0]));
      dl.appendChild(el("dd", r[2] ? "soft" : "", r[1]));
    });
  }

  // BOOT MARKER
  (function () {
    var m = ((document.currentScript && document.currentScript.src) || "")
      .match(/[?&]v=([^&#]+)/);
    document.documentElement.lang = LANG;
    console.log("sky.js v" + (m ? m[1] : "?") + " boot");
  })();

  // ---------- 2. Prefs + location ----------
  var prefs = { tab: "tonight", night: false, lines: true };
  function loadPrefs() {
    try {
      var p = JSON.parse(localStorage.getItem(PREFS_KEY) || "null");
      if (p && typeof p === "object") {
        if (TABS.indexOf(p.tab) !== -1) prefs.tab = p.tab;
        prefs.night = p.night === true;
        prefs.lines = p.lines !== false;
      }
    } catch (e) {}
  }
  function savePrefs() {
    try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch (e) {}
  }

  // Same order as Time's Sun & Moon card (time/astro.js getCoords).
  // A device fix is kept in memory only, never stored.
  var geoFix = null;
  function getCoords() {
    try {
      var d = JSON.parse(localStorage.getItem(TIME_KEY) || "null");
      if (d && d.astro && typeof d.astro.lat === "number" && typeof d.astro.lon === "number") {
        return { lat: d.astro.lat, lon: d.astro.lon, src: "time" };
      }
    } catch (e) {}
    try {
      var w = JSON.parse(localStorage.getItem("oros-weather") || "null");
      if (w && typeof w.lat === "number" && typeof w.lon === "number") {
        return { lat: w.lat, lon: w.lon, src: "weather", name: typeof w.name === "string" ? w.name : "" };
      }
      var tray = window.parent && window.parent !== window && window.parent.orosWeatherTray;
      var tl = (tray && typeof tray.location === "function") ? tray.location() : null;
      if (tl && typeof tl.lat === "number" && typeof tl.lon === "number") {
        return { lat: tl.lat, lon: tl.lon, src: "weather", name: typeof tl.name === "string" ? tl.name : "" };
      }
    } catch (e) {}
    if (geoFix) return { lat: geoFix.lat, lon: geoFix.lon, src: "geo" };
    return null;
  }
  var coords = null;
  function placeText(c) {
    var ll = Math.abs(c.lat).toFixed(2) + "°" + (c.lat >= 0 ? (LANG === "el" ? "Β" : "N") : (LANG === "el" ? "Ν" : "S")) + " " +
             Math.abs(c.lon).toFixed(2) + "°" + (c.lon >= 0 ? (LANG === "el" ? "Α" : "E") : (LANG === "el" ? "Δ" : "W"));
    return c.name ? c.name : ll;
  }

  function openTimeLocation() {
    var p = null;
    try { p = window.parent; } catch (e) {}
    if (p && p !== window && typeof p.__orosOpenAt === "function") {
      p.__orosOpenAt("time", { astro: "location" });
    } else {
      showToast(t("notime"));
    }
  }
  function detectGeo() {
    if (!navigator.geolocation) { showToast(t("geo.fail")); return; }
    showToast(t("geo.wait"));
    navigator.geolocation.getCurrentPosition(function (pos) {
      geoFix = { lat: pos.coords.latitude, lon: pos.coords.longitude };
      refresh();
    }, function () { showToast(t("geo.fail")); },
    { enableHighAccuracy: false, timeout: 8000, maximumAge: 600000 });
  }

  // ---------- 3. Date + tabs ----------
  var sel = C.dayStartOf(Date.now());     // local midnight of the chosen day
  var monthView = null;                   // { y, m }
  var mapOffset = 0;                      // minutes from the base time
  var followToday = true;                 // today rolls over at midnight
  function isToday() { return sel === C.dayStartOf(Date.now()); }
  // The moment "tonight" means: now for today, 22:00 for another day.
  function baseTime() { return isToday() ? Date.now() : sel + 22 * HOUR; }

  function setDate(ms, keepMonth) {
    sel = C.dayStartOf(ms);
    followToday = isToday();
    mapOffset = 0;
    var d = new Date(sel);
    if (!keepMonth) monthView = { y: d.getFullYear(), m: d.getMonth() };
    render();
  }
  function setTab(tab, focus) {
    if (TABS.indexOf(tab) === -1) tab = "tonight";
    prefs.tab = tab;
    savePrefs();
    TABS.forEach(function (k) {
      var b = $("tab-" + k), on = k === tab;
      b.setAttribute("aria-selected", on ? "true" : "false");
      b.tabIndex = on ? 0 : -1;
      $("pane-" + k).hidden = !on || !coords;
    });
    if (focus) $("tab-" + tab).focus();
    renderPane();
  }

  // ---------- 4. Moon drawing ----------
  // illum 0..1; angle = direction of the bright limb, degrees
  // counter-clockwise from "up" on the screen.
  function moonSvg(illum, angle, opts) {
    opts = opts || {};
    var R = 46, rx = Math.abs(2 * illum - 1) * R;
    var lit = "";
    if (illum >= 0.995) {
      lit = '<circle cx="0" cy="0" r="' + R + '" fill="var(--moon-lit)"/>';
    } else if (illum > 0.005) {
      lit = '<path d="M0 ' + (-R) + ' A' + R + ' ' + R + ' 0 0 1 0 ' + R +
            ' A' + rx.toFixed(2) + ' ' + R + ' 0 0 ' + (illum > 0.5 ? 1 : 0) + ' 0 ' + (-R) +
            ' Z" fill="var(--moon-lit)" transform="rotate(' + (-angle - 90).toFixed(1) + ')"/>';
    }
    var label = opts.label ? ' role="img" aria-label="' + opts.label.replace(/"/g, "&quot;") + '"' : ' aria-hidden="true"';
    return '<svg viewBox="-50 -50 100 100"' + label + '>' +
      '<circle cx="0" cy="0" r="' + R + '" fill="var(--moon-dark)"' +
      (opts.ring ? ' stroke="var(--border)" stroke-width="1.5"' : '') + '/>' + lit + '</svg>';
  }
  // Bright-limb angle as the observer sees it (zenith up).
  function limbAngle(ms, ph) {
    var m = C.moonTopo(ms, coords.lat, coords.lon);
    var aa = C.altAz(m.ra, m.dec, ms, coords.lat, coords.lon);
    var H = aa.ha * Math.PI / 180, phi = coords.lat * Math.PI / 180, dec = m.dec * Math.PI / 180;
    var q = Math.atan2(Math.sin(H), Math.tan(phi) * Math.cos(dec) - Math.sin(dec) * Math.cos(H)) * 180 / Math.PI;
    return ph.chi - q;
  }
  // Simple tilt for small icons: lit on the right while waxing
  // (northern hemisphere), mirrored south of the equator.
  function iconAngle(ph) {
    var right = ph.waxing === (coords.lat >= 0);
    return right ? -90 : 90;
  }

  // ---------- 5. Tonight ----------
  function phaseName(ph) { return t("ph." + ph.idx); }

  function renderTonight() {
    var bt = baseTime();
    var ph = C.moonPhase(bt);
    var name = phaseName(ph);
    var isSuper = (ph.idx === 4 && ph.dist < 360000);
    $("moon-name").textContent = name + (isSuper ? " · " + t("supermoon") : "");
    var pct = Math.round(ph.illum * 100);
    $("moon-meta").textContent = t("moon.meta", { p: pct, age: num(ph.age, 1), km: num(Math.round(ph.dist / 100) * 100) });
    $("moon-big").innerHTML = moonSvg(ph.illum, limbAngle(bt, ph), { ring: true });
    $("moon-big").setAttribute("aria-label", t("moon.img", { phase: name, p: pct }));
    var nn = C.nextPhase(bt, 0), nf = C.nextPhase(bt, 2);
    kv($("moon-next"), [
      [t("next.full"), nf ? dayLabel(nf) + " " + hm(nf) : "—"],
      [t("next.new"), nn ? dayLabel(nn) + " " + hm(nn) : "—"]
    ]);

    var md = C.moonDay(sel, coords.lat, coords.lon);
    var rows = [
      [t("moonrise"), md.rise ? hm(md.rise) : t("none.day"), !md.rise],
      [t("moonset"), md.set ? hm(md.set) : t("none.day"), !md.set]
    ];
    if (isToday()) {
      var mt = C.moonTopo(bt, coords.lat, coords.lon);
      var aa = C.altAz(mt.ra, mt.dec, bt, coords.lat, coords.lon);
      var alt = C.refract(aa.alt);
      rows.push([t("moon.now"), alt > 0 ? t("moon.up", { alt: Math.round(alt), dir: t("dir." + C.compass8(aa.az)) }) : t("moon.down")]);
    }
    kv($("moon-times"), rows);

    var sd = C.sunDay(sel, coords.lat, coords.lon);
    var srows = [];
    if (sd.polar) srows.push([t(sd.polar === "day" ? "polar.day" : "polar.night"), ""]);
    else {
      srows.push([t("sunrise"), hm(sd.rise)], [t("sunset"), hm(sd.set)]);
    }
    if (sd.polar !== "night") srows.push([t("noon"), hm(sd.noon) + " · " + Math.round(sd.maxAlt) + "°"]);
    if (sd.dayLength != null) srows.push([t("daylen"), dur(sd.dayLength)]);
    kv($("sun-times"), srows);

    var nx = C.sunDay(C.nextDayStart(sel), coords.lat, coords.lon);
    var trows = [];
    if (sd.civilDusk) trows.push([t("civil"), hm(sd.civilDusk)]);
    if (sd.nautDusk) trows.push([t("naut"), hm(sd.nautDusk)]);
    if (sd.astroDusk && nx.astroDawn) {
      trows.push([t("astro"), hm(sd.astroDusk)]);
      trows.push([t("astro.end"), hm(nx.astroDawn)]);
    } else {
      trows.push([t("never.dark"), "", true]);
    }
    if (nx.civilDawn) trows.push([t("civil.dawn"), hm(nx.civilDawn)]);
    kv($("twilight"), trows);

    var prow = [];
    function span(a) { return a ? hm(a[0]) + "–" + hm(a[1]) : null; }
    if (span(sd.blueAm)) prow.push([t("blue.am"), span(sd.blueAm)]);
    if (span(sd.goldenAm)) prow.push([t("gold.am"), span(sd.goldenAm)]);
    if (span(sd.goldenPm)) prow.push([t("gold.pm"), span(sd.goldenPm)]);
    if (span(sd.bluePm)) prow.push([t("blue.pm"), span(sd.bluePm)]);
    if (!prow.length) prow.push(["—", ""]);
    kv($("photo"), prow);

    renderPlanets(sd, nx);
    renderSoon();
  }

  // The night: from the end of evening twilight to morning twilight
  // (18:00–06:00 where the Sun does not set or rise).
  function nightWindow(sd, nx) {
    var a = sd.civilDusk || sel + 18 * HOUR, b = nx.civilDawn || sel + 30 * HOUR;
    if (b <= a) b = a + 12 * HOUR;
    return [a, b];
  }
  function heightWord(alt) { return alt < 20 ? t("h.low") : (alt < 50 ? t("h.mid") : t("h.high")); }
  function brightWord(m) { return m < -2 ? t("b.vbright") : (m < 0 ? t("b.bright") : (m < 1.5 ? t("b.easy") : t("b.faint"))); }
  var PLANET_COLOR = { mercury: "#b5aea4", venus: "#f3e7b0", mars: "#e2774b", jupiter: "#e6d3b0", saturn: "#e3c16f" };

  function planetsTonight(sd, nx) {
    var w = nightWindow(sd, nx), out = [];
    C.PLANETS.forEach(function (name) {
      var first = null, last = null, best = -90, bestT = null, bestAz = 0, mag = 0;
      for (var tt = w[0]; tt <= w[1]; tt += 10 * MIN) {
        var p = C.planetPos(name, tt);
        var aa = C.altAz(p.ra, p.dec, tt, coords.lat, coords.lon);
        if (aa.alt >= 8 && p.elong >= 12) {
          if (first == null) first = tt;
          last = tt;
          if (aa.alt > best) { best = aa.alt; bestT = tt; bestAz = aa.az; mag = p.mag; }
        }
      }
      out.push({ name: name, visible: first != null, first: first, last: last,
                 best: best, bestT: bestT, az: bestAz, mag: mag,
                 most: first != null && (last - first) >= 0.6 * (w[1] - w[0]),
                 evening: first != null && first - w[0] < 30 * MIN,
                 morning: last != null && w[1] - last < 30 * MIN });
    });
    return out;
  }

  function renderPlanets(sd, nx) {
    var ul = $("planets");
    ul.innerHTML = "";
    var list = planetsTonight(sd, nx), hidden = [];
    list.forEach(function (p) {
      if (!p.visible) { hidden.push(t("p." + p.name)); return; }
      var when = p.most || (p.evening && p.morning) ? t("pl.night") : (p.evening ? t("pl.evening") : (p.morning ? t("pl.morning") : t("pl.best", { t: hm(p.bestT) })));
      var li = el("li");
      var dot = el("span", "dot");
      dot.style.background = prefs.night ? "var(--accent)" : PLANET_COLOR[p.name];
      li.appendChild(dot);
      var box = el("div");
      var head = el("div");
      head.appendChild(el("b", "", t("p." + p.name)));
      head.appendChild(document.createTextNode(" · " + brightWord(p.mag)));
      box.appendChild(head);
      box.appendChild(el("div", "", t("pl.line", { when: when, dir: t("dir." + C.compass8(p.az)).toLowerCase(), height: heightWord(p.best) })));
      box.appendChild(el("div", "sub", t("pl.window", { a: hm(p.first), b: hm(p.last) }) + " · " + t("pl.best", { t: hm(p.bestT) })));
      li.appendChild(box);
      ul.appendChild(li);
    });
    if (!ul.children.length) ul.appendChild(el("li", "hint", t("pl.none")));
    if (hidden.length && hidden.length < list.length) ul.appendChild(el("li", "hint small", t("pl.hidden", { list: hidden.join(", ") })));
  }

  function eventNote(e) {
    if (e.kind === "eclipse" && e.local) {
      if (e.ekind === "l") return e.local.atMax ? t("ev.lunar.vis") : (e.local.visible ? t("ev.lunar.part") : t("ev.lunar.no"));
      if (e.local.visible && e.local.mag >= 1 && (e.type === "total" || e.type === "hybrid")) return t("ev.solar.total");
      return e.local.visible ? t("ev.solar.vis", { p: Math.max(1, Math.min(99, Math.round(e.local.mag * 100))) }) : t("ev.solar.no");
    }
    if (e.kind === "shower") {
      var s = t("ev.shower", { n: e.zhr }), extra = [];
      if (e.visible === false) extra.push(t("ev.low"));
      if (e.moon > 0.6) extra.push(t("ev.moon"));
      return extra.length ? s + " · " + extra.join(" · ") : s;
    }
    return "";
  }
  function eventRow(e, withDay) {
    var li = el("li");
    var day = withDay ? dayLabel(e.t) : dayLabel(e.t, { day: "numeric", month: "short" });
    var b = el("button", "ev-row");
    b.type = "button";
    b.appendChild(el("span", "when", e.allDay ? day : day + " " + hm(e.t)));
    var box = el("span", "what");
    box.appendChild(el("span", "ev-title", C.eventTitle(e, LANG)));
    var note = eventNote(e);
    if (note) box.appendChild(el("span", "sub", note));
    b.appendChild(box);
    b.addEventListener("click", function () { setDate(e.t); setTab("tonight"); });
    li.appendChild(b);
    return li;
  }
  function renderSoon() {
    var ul = $("soon"), from = isToday() ? Date.now() : sel;
    ul.innerHTML = "";
    var list = C.eventsBetween(from, from + 62 * DAY, { lat: coords.lat, lon: coords.lon }).filter(function (e) {
      return e.kind !== "phase" || e.q === 0 || e.q === 2;
    }).slice(0, 6);
    if (!list.length) ul.appendChild(el("li", "hint", t("ev.soon.none")));
    list.forEach(function (e) { ul.appendChild(eventRow(e, true)); });
  }

  // ---------- 6. Sky map ----------
  var hits = [];
  var precessed = null;    // { year, stars: [{ ra, dec }] }
  function starsOfDate(ms) {
    var y = new Date(ms).getFullYear();
    if (precessed && precessed.year === y) return precessed.stars;
    var T = C.tOf(ms);
    precessed = { year: y, stars: CAT.stars.map(function (s) { return C.precess(s[0], s[1], T); }) };
    return precessed.stars;
  }
  function mapTime() { return baseTime() + mapOffset * MIN; }
  function cssVar(name) { return getComputedStyle(document.documentElement).getPropertyValue(name).trim(); }

  function objectsAt(ms) {
    var objs = [], lat = coords.lat, lon = coords.lon;
    var s = C.sunPos(ms), sa = C.altAz(s.ra, s.dec, ms, lat, lon);
    objs.push({ kind: "sun", name: t("p.sun"), alt: C.refract(sa.alt), az: sa.az, mag: -26.7 });
    var m = C.moonTopo(ms, lat, lon), ma = C.altAz(m.ra, m.dec, ms, lat, lon);
    var ph = C.moonPhase(ms);
    objs.push({ kind: "moon", name: t("p.moon"), alt: C.refract(ma.alt), az: ma.az, mag: -12, ph: ph });
    C.PLANETS.forEach(function (p) {
      var pp = C.planetPos(p, ms), pa = C.altAz(pp.ra, pp.dec, ms, lat, lon);
      objs.push({ kind: "planet", id: p, name: t("p." + p), alt: C.refract(pa.alt), az: pa.az, mag: pp.mag, dist: pp.dist });
    });
    return objs;
  }

  function project(alt, az, R) {
    var r = (90 - alt) / 90 * R, a = az * Math.PI / 180;
    return { x: -r * Math.sin(a), y: -r * Math.cos(a) };
  }

  function drawMap() {
    var cv = $("map"), box = cv.parentNode;
    var size = Math.max(200, Math.floor(box.clientWidth));
    var dpr = window.devicePixelRatio || 1;
    if (cv.width !== Math.round(size * dpr)) { cv.width = Math.round(size * dpr); cv.height = Math.round(size * dpr); }
    var g = cv.getContext("2d");
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, size, size);
    var ms = mapTime(), lat = coords.lat, lon = coords.lon;
    var cx = size / 2, cy = size / 2, R = size / 2 - 22, sc = size / 600;
    hits = [];
    var objs = objectsAt(ms), sun = objs[0];
    var night = prefs.night;
    var skyCol = cssVar("--sky") || "#0b1020";
    if (!night && sun.alt > -6) skyCol = sun.alt > 0 ? "#2f5486" : (sun.alt > -3 ? "#22375e" : "#18264a");
    var textCol = cssVar("--text") || "#ddd", dimCol = cssVar("--text-dim") || "#999";
    var lineCol = cssVar("--sky-line") || "rgba(140,170,220,.35)", starCol = cssVar("--star") || "#fff";
    var accent = cssVar("--accent") || "#d4af37";

    g.fillStyle = skyCol;
    g.beginPath(); g.arc(cx, cy, R, 0, Math.PI * 2); g.fill();
    g.strokeStyle = lineCol; g.lineWidth = 1;
    [30, 60].forEach(function (a) {
      g.beginPath(); g.arc(cx, cy, (90 - a) / 90 * R, 0, Math.PI * 2);
      g.setLineDash([2, 5]); g.stroke(); g.setLineDash([]);
    });
    g.beginPath(); g.arc(cx, cy, R, 0, Math.PI * 2); g.strokeStyle = dimCol; g.stroke();

    // cardinal points (looking up: north at the top, east on the left)
    g.fillStyle = textCol;
    g.font = "800 " + Math.round(13 * Math.max(0.9, sc)) + "px Nunito, system-ui, sans-serif";
    g.textAlign = "center"; g.textBaseline = "middle";
    [["card.N", 0], ["card.E", 90], ["card.S", 180], ["card.W", 270]].forEach(function (c) {
      var p = project(-12 * 90 / R, c[1], R);
      g.fillText(t(c[0]), cx + p.x, cy + p.y);
    });

    g.save();
    g.beginPath(); g.arc(cx, cy, R, 0, Math.PI * 2); g.clip();

    var stars = starsOfDate(ms), pos = [];
    for (var i = 0; i < stars.length; i++) {
      var aa = C.altAz(stars[i].ra, stars[i].dec, ms, lat, lon);
      pos.push({ alt: aa.alt, az: aa.az });
    }
    if (prefs.lines) {
      g.strokeStyle = lineCol; g.lineWidth = 1;
      CAT.constellations.forEach(function (c) {
        c[3].forEach(function (seg) {
          for (var k = 0; k < seg.length - 1; k++) {
            var a = pos[seg[k]], b = pos[seg[k + 1]];
            if (a.alt < -3 && b.alt < -3) continue;
            var pa = project(a.alt, a.az, R), pb = project(b.alt, b.az, R);
            g.beginPath(); g.moveTo(cx + pa.x, cy + pa.y); g.lineTo(cx + pb.x, cy + pb.y); g.stroke();
          }
        });
      });
    }
    var dayDim = !night && sun.alt > 0;
    g.fillStyle = starCol;
    g.font = "600 " + Math.round(11 * Math.max(0.9, sc)) + "px Nunito, system-ui, sans-serif";
    g.textAlign = "left"; g.textBaseline = "middle";
    for (i = 0; i < stars.length; i++) {
      if (pos[i].alt < 0) continue;
      var st = CAT.stars[i], pp = project(pos[i].alt, pos[i].az, R);
      var rr = Math.max(0.7, (3.4 - 0.62 * st[2]) * Math.max(0.8, sc));
      g.globalAlpha = dayDim ? 0.35 : 1;
      g.beginPath(); g.arc(cx + pp.x, cy + pp.y, rr, 0, Math.PI * 2); g.fill();
      if (st[2] < 1.3 && st[3]) {
        g.globalAlpha = dayDim ? 0.35 : 0.8;
        g.fillStyle = dimCol;
        g.fillText(LANG === "el" ? st[4] : st[3], cx + pp.x + rr + 3, cy + pp.y);
        g.fillStyle = starCol;
      }
      hits.push({ x: cx + pp.x, y: cy + pp.y, kind: "star", i: i, alt: pos[i].alt, az: pos[i].az });
    }
    g.globalAlpha = 1;

    // planets, Moon, Sun
    objs.forEach(function (o) {
      if (o.alt < -0.5) return;
      var p = project(Math.max(0, o.alt), o.az, R), x = cx + p.x, y = cy + p.y;
      if (o.kind === "planet") {
        g.fillStyle = night ? accent : PLANET_COLOR[o.id];
        g.beginPath(); g.arc(x, y, Math.max(3, (4.2 - 0.5 * o.mag) * Math.max(0.8, sc)), 0, Math.PI * 2); g.fill();
        g.fillStyle = textCol;
        g.font = "800 " + Math.round(12 * Math.max(0.9, sc)) + "px Nunito, system-ui, sans-serif";
        g.fillText(o.name, x + 8, y - 8);
      } else if (o.kind === "moon") {
        var r = 9 * Math.max(0.9, sc);
        drawMoonDot(g, x, y, r, o.ph, limbAngle(ms, o.ph), cssVar("--moon-lit"), cssVar("--moon-dark"));
        g.fillStyle = textCol;
        g.font = "800 " + Math.round(12 * Math.max(0.9, sc)) + "px Nunito, system-ui, sans-serif";
        g.fillText(o.name, x + r + 4, y - r);
      } else if (o.kind === "sun") {
        g.fillStyle = night ? accent : "#ffd75e";
        g.beginPath(); g.arc(x, y, 10 * Math.max(0.9, sc), 0, Math.PI * 2); g.fill();
        g.fillStyle = textCol;
        g.font = "800 " + Math.round(12 * Math.max(0.9, sc)) + "px Nunito, system-ui, sans-serif";
        g.fillText(o.name, x + 14, y - 10);
      }
      hits.push({ x: x, y: y, kind: o.kind, o: o, alt: o.alt, az: o.az, pri: true });
    });
    g.restore();

    $("time-lbl").textContent = t("map.time", { t: dayLabel(ms) + " " + hm(ms) });
    var up = upList(ms, objs, pos);
    cv.setAttribute("aria-label", t("map.img", { t: hm(ms), n: up.length }));
    renderUpList(up);
  }

  function drawMoonDot(g, x, y, r, ph, angle, litCol, darkCol) {
    g.save();
    g.translate(x, y);
    g.fillStyle = darkCol || "#333";
    g.beginPath(); g.arc(0, 0, r, 0, Math.PI * 2); g.fill();
    g.rotate((-angle - 90) * Math.PI / 180);
    g.fillStyle = litCol || "#eee";
    var k = ph.illum, rx = Math.abs(2 * k - 1) * r;
    if (k > 0.005) {
      g.beginPath();
      g.arc(0, 0, r, -Math.PI / 2, Math.PI / 2, false);      // right limb, top → bottom
      g.ellipse(0, 0, Math.max(0.01, rx), r, 0, Math.PI / 2, -Math.PI / 2, k <= 0.5);
      g.closePath();
      g.fill();
    }
    g.restore();
  }

  function upList(ms, objs, pos) {
    var out = [];
    objs.forEach(function (o) { if (o.alt > 0) out.push({ name: o.name, alt: o.alt, az: o.az, mag: o.mag }); });
    for (var i = 0; i < CAT.stars.length; i++) {
      var s = CAT.stars[i];
      if (s[2] < 1.5 && s[3] && pos[i].alt > 0) out.push({ name: LANG === "el" ? s[4] : s[3], alt: pos[i].alt, az: pos[i].az, mag: s[2] });
    }
    return out.sort(function (a, b) { return a.mag - b.mag; });
  }
  function renderUpList(up) {
    var ul = $("up-list");
    ul.innerHTML = "";
    if (!up.length) { ul.appendChild(el("li", "hint", t("map.empty"))); return; }
    up.forEach(function (u) {
      var li = el("li");
      li.appendChild(el("b", "", u.name));
      li.appendChild(document.createTextNode(" · " + t("moon.up", { alt: Math.round(u.alt), dir: t("dir." + C.compass8(u.az)).toLowerCase() })));
      ul.appendChild(li);
    });
  }

  function conName(id) {
    for (var i = 0; i < CAT.constellations.length; i++) {
      var c = CAT.constellations[i];
      if (c[0] === id) return LANG === "el" ? c[2] : c[1];
    }
    return id;
  }
  function showInfo(h) {
    var box = $("map-info");
    if (!h) { box.hidden = true; return; }
    box.innerHTML = "";
    var name, lines = [];
    if (h.kind === "star") {
      var s = CAT.stars[h.i];
      name = (LANG === "el" ? s[4] : s[3]) || t("info.star", { con: conName(s[5]) });
      if (s[3]) lines.push(t("info.star", { con: conName(s[5]) }));
      lines.push(t("info.mag", { m: num(s[2], 1) }));
    } else {
      name = h.o.name;
      if (h.kind === "moon") lines.push(t("info.moon", { phase: phaseName(h.o.ph), p: Math.round(h.o.ph.illum * 100) }));
      if (h.kind === "planet") {
        lines.push(t("info.planet", { d: num(h.o.dist, 2) }));
        lines.push(t("info.mag", { m: num(h.o.mag, 1) }));
      }
    }
    lines.unshift(h.alt > 0 ? t("info.alt", { alt: Math.round(h.alt), dir: t("dir." + C.compass8(h.az)).toLowerCase(), az: Math.round(h.az) }) : t("info.below"));
    box.appendChild(el("b", "", name));
    lines.forEach(function (l) { box.appendChild(el("div", "", l)); });
    box.hidden = false;
  }
  function onMapTap(ev) {
    var r = $("map").getBoundingClientRect();
    var x = ev.clientX - r.left, y = ev.clientY - r.top, best = null, bd = 24 * 24;
    hits.forEach(function (h) {
      var d = (h.x - x) * (h.x - x) + (h.y - y) * (h.y - y);
      if (h.pri) d *= 0.5;                 // the Moon and planets win close calls
      if (d < bd) { bd = d; best = h; }
    });
    showInfo(best);
  }

  function renderMapCtl() {
    $("time-in").value = String(mapOffset);
    $("lines-btn").setAttribute("aria-pressed", prefs.lines ? "true" : "false");
  }

  // ---------- 7. Month ----------
  function renderMonth() {
    if (!monthView) { var d0 = new Date(sel); monthView = { y: d0.getFullYear(), m: d0.getMonth() }; }
    var y = monthView.y, m = monthView.m;
    var from = C.localMidnight(y, m, 1), to = C.localMidnight(y, m + 1, 1);
    $("month-title").textContent = new Date(from).toLocaleDateString(LOCALE, { month: "long", year: "numeric" });
    var events = C.eventsBetween(from, to, { lat: coords.lat, lon: coords.lon });
    var grid = $("month-grid");
    grid.innerHTML = "";
    // weekday heads, Monday first
    for (var w = 0; w < 7; w++) {
      var wd = new Date(2024, 0, 1 + w);      // 2024-01-01 was a Monday
      grid.appendChild(el("div", "dow", wd.toLocaleDateString(LOCALE, { weekday: "short" })));
    }
    var lead = (new Date(from).getDay() + 6) % 7;
    for (var p = 0; p < lead; p++) grid.appendChild(el("div", "mpad"));
    var today = C.dayStartOf(Date.now());
    for (var day = C.localMidnight(y, m, 1); day < to; day = C.nextDayStart(day)) {
      var ph = C.moonPhase(day + 22 * HOUR);
      var b = el("button", "mday" + (day === today ? " today" : "") + (day === sel ? " sel" : ""));
      b.type = "button";
      b.appendChild(el("span", "", String(new Date(day).getDate())));
      var holder = el("span");
      holder.innerHTML = moonSvg(ph.illum, iconAngle(ph));
      b.appendChild(holder.firstChild);
      var marks = el("span", "marks"), names = [];
      var dayEnd = C.nextDayStart(day);
      events.forEach(function (e) {
        if (e.t < day || e.t >= dayEnd) return;
        marks.appendChild(el("span", "mark " + e.kind));
        names.push(C.eventTitle(e, LANG));
      });
      b.appendChild(marks);
      var label = t("day.label", { date: dayLabel(day, { weekday: "long", day: "numeric", month: "long" }), phase: phaseName(ph), p: Math.round(ph.illum * 100) });
      b.setAttribute("aria-label", names.length ? label + ". " + names.join(". ") : label);
      (function (d) { b.addEventListener("click", function () { setDate(d, true); setTab("tonight"); }); })(day);
      grid.appendChild(b);
    }
    var ul = $("month-events");
    ul.innerHTML = "";
    if (!events.length) ul.appendChild(el("li", "hint", t("ev.none")));
    events.forEach(function (e) { ul.appendChild(eventRow(e, false)); });
  }
  function shiftMonth(n) {
    if (!monthView) { var d0 = new Date(sel); monthView = { y: d0.getFullYear(), m: d0.getMonth() }; }
    var d = new Date(monthView.y, monthView.m + n, 1);
    if (d.getFullYear() < 1900 || d.getFullYear() > 2099) return;
    monthView = { y: d.getFullYear(), m: d.getMonth() };
    renderMonth();
  }

  // ---------- 8. Toasts ----------
  var toastTimer = null;
  function showToast(text) {
    try {
      var n = (window.parent && window.parent !== window && window.parent.orosNotifs) || null;
      if (n && typeof n.transient === "function" &&
          n.transient({ ns: "sky", title: String(text) })) return;
    } catch (e) {}
    var box = $("toast");
    if (!box) return;
    box.textContent = text;
    box.classList.remove("show");
    void box.offsetWidth;
    box.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { box.classList.remove("show"); }, 4000);
  }

  // ---------- 9. Deep links + keyboard ----------
  // __orosOpenAt("sky", { date: "YYYY-MM-DD", tab: "tonight"|"map"|"month" })
  // — used by the Calendar feed and by Time's Sun & Moon card.
  function openAt(target) {
    if (!target || typeof target !== "object") return;
    var d = typeof target.date === "string" ? C.parseDate(target.date) : null;
    if (d != null) setDate(d);
    if (typeof target.tab === "string" && TABS.indexOf(target.tab) !== -1) setTab(target.tab);
    else if (d != null) setTab("tonight");
  }
  window.__orosOpenAt = openAt;

  function wireKeyboard() {
    // Contract Β: forward Ctrl+Alt+Shift shortcuts to the shell (capture)
    document.addEventListener("keydown", function (e) {
      if (!(e.ctrlKey || e.metaKey) || !e.altKey || !e.shiftKey) return;
      var p = null;
      try { p = window.parent; } catch (err) { return; }
      if (!(p && p !== window && p.orosShortcuts &&
            typeof p.orosShortcuts.handle === "function")) return;
      if (p.orosShortcuts.handle(e)) e.stopPropagation();
    }, true);
    // tab list: arrow keys move between tabs (ARIA pattern)
    $("tabs").addEventListener("keydown", function (e) {
      var i = TABS.indexOf(prefs.tab);
      if (e.key === "ArrowRight") i = (i + 1) % TABS.length;
      else if (e.key === "ArrowLeft") i = (i + TABS.length - 1) % TABS.length;
      else if (e.key === "Home") i = 0;
      else if (e.key === "End") i = TABS.length - 1;
      else return;
      e.preventDefault();
      setTab(TABS[i], true);
    });
  }

  // ---------- 10. Palette ----------
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
        var val = cs.getPropertyValue(v).trim();
        if (val) document.documentElement.style.setProperty(v, val);
        else document.documentElement.style.removeProperty(v);
      });
    } catch (e) { /* standalone */ }
    applyNight();
  }
  function watchPalette() {
    try {
      new MutationObserver(inheritPalette).observe(
        window.parent.document.documentElement,
        { attributes: true, attributeFilter: ["data-skin", "data-theme"] }
      );
    } catch (e) { /* standalone */ }
  }
  // The red view must beat the inherited palette, which sits in
  // inline styles: while it is on, those inline values step aside.
  function applyNight() {
    var root = document.documentElement;
    root.classList.toggle("night", !!prefs.night);
    if (prefs.night) PAL_VARS.forEach(function (v) { root.style.removeProperty(v); });
    var b = $("night-btn");
    if (b) {
      setLabel(b, prefs.night ? t("night.on") : t("night.off"));
      b.setAttribute("aria-pressed", prefs.night ? "true" : "false");
    }
  }

  // ---------- 11. Wiring & boot ----------
  var ICON = {
    night: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z"/><circle cx="17" cy="5" r="1.2" fill="currentColor"/></svg>',
    loc: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 21s-7-6.2-7-11.5a7 7 0 0 1 14 0C19 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/></svg>',
    prev: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 6l-6 6 6 6"/></svg>',
    next: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg>'
  };

  function applyI18n() {
    [].forEach.call(document.querySelectorAll("[data-i18n]"), function (n) {
      n.textContent = t(n.getAttribute("data-i18n"));
    });
    document.title = t("app.name") + " · orOS";
    $("title-view").textContent = t("app.name");
    $("night-btn").innerHTML = ICON.night;
    $("loc-btn").innerHTML = ICON.loc; setLabel($("loc-btn"), t("loc.btn"));
    $("prev-m").innerHTML = ICON.prev; setLabel($("prev-m"), t("prev"));
    $("next-m").innerHTML = ICON.next; setLabel($("next-m"), t("next"));
  }

  function renderHeader() {
    $("date-in").value = C.dateStr(sel);
    $("today-btn").hidden = isToday();
    $("title-sub").textContent = coords ? t("sub." + coords.src, { place: placeText(coords) }) : "";
  }
  function renderPane() {
    if (!coords) return;
    if (prefs.tab === "tonight") renderTonight();
    else if (prefs.tab === "map") { renderMapCtl(); drawMap(); }
    else renderMonth();
  }
  function render() {
    renderHeader();
    $("noloc").hidden = !!coords;
    $("tabs").hidden = !coords;
    setTab(prefs.tab);
  }
  function refresh() {
    coords = getCoords();
    render();
  }

  function wire() {
    TABS.forEach(function (k) { $("tab-" + k).addEventListener("click", function () { setTab(k); }); });
    $("date-in").addEventListener("change", function () {
      var d = C.parseDate(this.value);
      if (d != null) setDate(d);
    });
    $("today-btn").addEventListener("click", function () { setDate(Date.now()); });
    $("night-btn").addEventListener("click", function () {
      prefs.night = !prefs.night; savePrefs();
      inheritPalette();
      renderPane();
    });
    $("loc-btn").addEventListener("click", openTimeLocation);
    $("noloc-time").addEventListener("click", openTimeLocation);
    $("noloc-geo").addEventListener("click", detectGeo);
    $("time-in").addEventListener("input", function () {
      mapOffset = parseInt(this.value, 10) || 0;
      showInfo(null);
      drawMap();
    });
    $("now-btn").addEventListener("click", function () {
      if (!isToday()) { setDate(Date.now()); return; }
      mapOffset = 0; renderMapCtl(); drawMap();
    });
    $("lines-btn").addEventListener("click", function () {
      prefs.lines = !prefs.lines; savePrefs(); renderMapCtl(); drawMap();
    });
    $("map").addEventListener("click", onMapTap);
    $("prev-m").addEventListener("click", function () { shiftMonth(-1); });
    $("next-m").addEventListener("click", function () { shiftMonth(1); });
    var rt = null;
    window.addEventListener("resize", function () {
      clearTimeout(rt);
      rt = setTimeout(function () { if (coords && prefs.tab === "map") drawMap(); }, 120);
    });
    document.addEventListener("visibilitychange", function () {
      if (document.visibilityState === "visible") refresh();
    });
    window.addEventListener("focus", function () {
      var c = getCoords();
      if (JSON.stringify(c) !== JSON.stringify(coords)) refresh();
    });
    // Today follows the clock: once a minute while open.
    setInterval(function () {
      if (!coords || document.visibilityState !== "visible") return;
      if (followToday && !isToday()) { setDate(Date.now()); return; }
      if (!isToday()) return;
      if (prefs.tab === "map") drawMap();
      else if (prefs.tab === "tonight") renderTonight();
    }, 60000);
  }

  function boot() {
    loadPrefs();
    applyI18n();
    inheritPalette();
    coords = getCoords();
    var d = new Date(sel);
    monthView = { y: d.getFullYear(), m: d.getMonth() };
    wire();
    wireKeyboard();
    watchPalette();
    render();
    var target = null;
    try {
      if (window.parent && window.parent !== window && typeof window.parent.__orosTakeTarget === "function") {
        target = window.parent.__orosTakeTarget("sky");
      }
    } catch (e) {}
    if (target) openAt(target);
  }

  boot();
})();
