// ============================================================
// orOS Time v0.1.0 — Astronomy module (Sun & Moon)
// Pure math, fully offline: NOAA solar equations + synodic
// moon phase. Coordinates (priority): manual override in
// oros-time-data → shell weather pref ("oros-weather").
// Self-bootstrapping — does not touch time.js.
// ============================================================
(function () {
  "use strict";

  var LANG = "en";
  try {
    if (window.parent && window.parent.orosLang) LANG = window.parent.orosLang;
    else if (localStorage.getItem("oros-lang")) LANG = localStorage.getItem("oros-lang");
  } catch (e) {}

  var STR = {
    en: {
      "astro.title": "Sun & Moon",
      "astro.none": "No location set",
      "astro.none.hint": "Uses the Weather app location automatically, or set one manually.",
      "astro.manual": "Set location",
      "astro.uses": "Using weather location",
      "astro.using": "Manual location",
      "astro.dlg": "Location",
      "astro.lat": "Latitude",
      "astro.lon": "Longitude",
      "astro.save": "Save",
      "astro.cancel": "Cancel",
      "astro.clear": "Use weather location",
      "astro.sunrise": "Sunrise",
      "astro.sunset": "Sunset",
      "astro.noon": "Solar noon",
      "astro.len": "Day length",
      "astro.polar.day": "Sun never sets today",
      "astro.polar.night": "Sun never rises today",
      "astro.sunpos": "Sun now",
      "astro.moonage": "Moon age",
      "astro.illum": "Illumination",
      "ph.0": "New moon", "ph.1": "Waxing crescent", "ph.2": "First quarter",
      "ph.3": "Waxing gibbous", "ph.4": "Full moon", "ph.5": "Waning gibbous",
      "ph.6": "Last quarter", "ph.7": "Waning crescent",
      "u.days": "d"
    },
    el: {
      "astro.title": "Ήλιος & Σελήνη",
      "astro.none": "Δεν έχει οριστεί τοποθεσία",
      "astro.none.hint": "Χρησιμοποιεί αυτόματα την τοποθεσία της εφαρμογής Καιρού, ή όρισέ μια χειροκίνητα.",
      "astro.manual": "Ορισμός τοποθεσίας",
      "astro.uses": "Από την τοποθεσία του Καιρού",
      "astro.using": "Χειροκίνητη τοποθεσία",
      "astro.dlg": "Τοποθεσία",
      "astro.lat": "Γεωγραφικό πλάτος",
      "astro.lon": "Γεωγραφικό μήκος",
      "astro.save": "Αποθήκευση",
      "astro.cancel": "Άκυρο",
      "astro.clear": "Χρήση τοποθεσίας Καιρού",
      "astro.sunrise": "Ανατολή",
      "astro.sunset": "Δύση",
      "astro.noon": "Μεσημέρι ηλίου",
      "astro.len": "Διάρκεια ημέρας",
      "astro.polar.day": "Ο ήλιος δεν δύει σήμερα",
      "astro.polar.night": "Ο ήλιος δεν ανατέλλει σήμερα",
      "astro.sunpos": "Ήλιος τώρα",
      "astro.moonage": "Ηλικία σελήνης",
      "astro.illum": "Φωτεινότητα",
      "ph.0": "Νέα σελήνη", "ph.1": "Αύξουσα ημισέληνος", "ph.2": "Πρώτο τέταρτο",
      "ph.3": "Αύξουσα αμφίκυρτη", "ph.4": "Πανσέληνος", "ph.5": "Φθίνουσα αμφίκυρτη",
      "ph.6": "Τελευταίο τέταρτο", "ph.7": "Φθίνουσα ημισέληνος",
      "u.days": "ημ."
    }
  };
  function t(k) {
    return (STR[LANG] && STR[LANG][k] !== undefined) ? STR[LANG][k]
         : (STR.en[k] !== undefined ? STR.en[k] : k);
  }
  function $(id) { return document.getElementById(id); }
  function rad(d) { return d * Math.PI / 180; }
  function deg(r) { return r * 180 / Math.PI; }
  function pad(n) { return (n < 10 ? "0" : "") + n; }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) {
    return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }

  /* ---------- Coordinates ---------- */
  var DATA_KEY = "oros-time-data";
  function readData() {
    try { var d = JSON.parse(localStorage.getItem(DATA_KEY)); return d && typeof d === "object" ? d : {}; }
    catch (e) { return {}; }
  }
  function writeData(d) { try { localStorage.setItem(DATA_KEY, JSON.stringify(d)); } catch (e) {} }
  // oros-time-data is a SYNCED slice — user edits must reach the engine.
  function markDirty() {
    try {
      if (window.parent && window.parent.orosSync && window.parent.orosSync.markDirty) {
        window.parent.orosSync.markDirty();
      }
    } catch (e) {}
  }

  function getCoords() {
    var d = readData();
    if (d.astro && typeof d.astro.lat === "number" && typeof d.astro.lon === "number") {
      return { lat: d.astro.lat, lon: d.astro.lon, manual: true };
    }
    try {
      var w = JSON.parse(localStorage.getItem("oros-weather"));
      if (w && typeof w.lat === "number" && typeof w.lon === "number") {
        return { lat: w.lat, lon: w.lon, manual: false };
      }
    } catch (e) {}
    return null;
  }

  /* ---------- NOAA solar equations ---------- */
  // Fractional year, equation of time (minutes), declination (rad).
  function sunEphem(nowMs) {
    var d = new Date(nowMs);
    var y = d.getUTCFullYear();
    var start = Date.UTC(y, 0, 0);
    var doy = (Date.UTC(y, d.getUTCMonth(), d.getUTCDate()) - start) / 86400000;
    var g = 2 * Math.PI / 365 * (doy - 1 + (d.getUTCHours() - 12) / 24);
    var cg = Math.cos(g), sg = Math.sin(g), c2 = Math.cos(2 * g), s2 = Math.sin(2 * g);
    var eq = 229.18 * (0.000075 + 0.001868 * cg - 0.032077 * sg -
                       0.014615 * c2 - 0.040849 * s2);
    var dec = 0.006918 - 0.399912 * cg + 0.070257 * sg - 0.006758 * c2 +
              0.000907 * s2 - 0.002697 * Math.cos(3 * g) + 0.00148 * Math.sin(3 * g);
    return { eq: eq, decl: dec };
  }

  // Sunrise/sunset/solar-noon in UTC MINUTES. Polar → {polar:"day"|"night"}.
  function sunTimes(coords, nowMs) {
    var e = sunEphem(nowMs);
    var phi = rad(coords.lat);
    var cosHA = Math.cos(rad(90.833)) / (Math.cos(phi) * Math.cos(e.decl)) -
                Math.tan(phi) * Math.tan(e.decl);
    if (cosHA > 1)  return { polar: "night" };
    if (cosHA < -1) return { polar: "day" };
    var ha = deg(Math.acos(cosHA));                 // half day-length, degrees
    var noon = 720 - 4 * coords.lon - e.eq;         // lon EAST-positive
    return {
      rise: noon - 4 * ha,
      set:  noon + 4 * ha,
      noon: noon,
      ha: ha
    };
  }

  // Sun altitude/azimuth right now (azimuth from north, clockwise).
  function sunPosition(coords, nowMs) {
    var e = sunEphem(nowMs);
    var d = new Date(nowMs);
    var utcMin = d.getUTCHours() * 60 + d.getUTCMinutes() + d.getUTCSeconds() / 60;
    var tst = utcMin + e.eq + 4 * coords.lon;       // true solar time, minutes
    var H = tst / 4 - 180;                          // hour angle, degrees
    var phi = rad(coords.lat);
    var alt = Math.asin(Math.sin(phi) * Math.sin(e.decl) +
                        Math.cos(phi) * Math.cos(e.decl) * Math.cos(rad(H)));
    var cosAz = (Math.sin(e.decl) - Math.sin(alt) * Math.sin(phi)) /
                (Math.cos(alt) * Math.cos(phi));
    var az = deg(Math.acos(Math.max(-1, Math.min(1, cosAz))));
    if (H > 0) az = 360 - az;
    return { alt: deg(alt), az: az };
  }

  // UTC minutes → local device time "HH:MM".
  function utcMinToLocal(min) {
    var d = new Date();
    d.setUTCHours(0, 0, 0, 0);
    d.setUTCMinutes(Math.round(min));
    return d.toLocaleTimeString(LANG === "el" ? "el-GR" : "en-GB",
      { hour: "2-digit", minute: "2-digit" });
  }

  /* ---------- Moon (synodic) ---------- */
  function moonInfo() {
    var SYNODIC = 29.530588853;
    var jd = Date.now() / 86400000 + 2440587.5;
    var age = ((jd - 2451550.1) % SYNODIC + SYNODIC) % SYNODIC;  // days
    var p = age / SYNODIC;                                       // 0..1
    var k = (1 - Math.cos(2 * Math.PI * p)) / 2;                  // illumination
    var phaseIdx = Math.floor((p * 8 + 0.5)) % 8;
    return { age: age, p: p, k: k, phaseIdx: phaseIdx };
  }

  // Waxing → lit right (northern hemisphere). Outer limb arc +
  // terminator semi-ellipse whose rx shrinks/grows with phase.
  function moonSvg(k, p) {
    var R = 13, CX = 16, CY = 16;
    var lit = "";
    if (k > 0.985) {
      lit = '<circle cx="' + CX + '" cy="' + CY + '" r="' + R + '" fill="var(--accent)"/>';
    } else if (k >= 0.015) {
      var rx = (R * Math.abs(Math.cos(2 * Math.PI * p))).toFixed(2);
      var sweep;
      if (p <= 0.5) {                       // waxing — right limb
        // terminator bottom→top: crescent bulges right (sweep 0),
        // gibbous bulges left (sweep 1)
        sweep = p < 0.25 ? 0 : 1;
        lit = '<path d="M ' + CX + ' ' + (CY - R) +
              ' A ' + R + ' ' + R + ' 0 0 1 ' + CX + ' ' + (CY + R) +
              ' A ' + rx + ' ' + R + ' 0 0 ' + sweep + ' ' + CX + ' ' + (CY - R) +
              ' Z" fill="var(--accent)"/>';
      } else {                               // waning — left limb
        sweep = p < 0.75 ? 0 : 1;
        lit = '<path d="M ' + CX + ' ' + (CY - R) +
              ' A ' + R + ' ' + R + ' 0 0 0 ' + CX + ' ' + (CY + R) +
              ' A ' + rx + ' ' + R + ' 0 0 ' + sweep + ' ' + CX + ' ' + (CY - R) +
              ' Z" fill="var(--accent)"/>';
      }
    }
    return '<svg width="32" height="32" viewBox="0 0 32 32" aria-hidden="true">' +
      '<circle cx="' + CX + '" cy="' + CY + '" r="' + R +
      '" fill="var(--panel-bg)" stroke="var(--border)" stroke-width="1.5"/>' + lit + '</svg>';
  }

  /* ---------- Rendering ---------- */
  function row(label, value, svg) {
    return '<div class="ast-row">' + (svg || "") +
      '<span class="ast-lbl">' + esc(label) + '</span>' +
      '<span class="ast-val">' + esc(value) + '</span></div>';
  }

  function render() {
    var head = document.querySelector('[data-i18n-a="astro.title"]');
    if (head) head.textContent = t("astro.title");

    var body = $("ast-body");
    var coords = getCoords();
    if (!coords) {
      body.innerHTML =
        '<div class="empty">' + esc(t("astro.none")) +
        '<div class="ast-hint">' + esc(t("astro.none.hint")) + '</div></div>' +
        '<button id="ast-set" type="button" class="btn">' + esc(t("astro.manual")) + '</button>';
      wireSetBtn();
      return;
    }

    var now = Date.now();
    var html = "";

    // Source caption
    var src = coords.manual ? t("astro.using") : t("astro.uses");
    html += '<div class="ast-src"><span>' + esc(src) + '</span>' +
      '<button id="ast-set" type="button" class="mini">' + esc(t("astro.manual")) + '</button></div>';

    // Sun
    var st = sunTimes(coords, now);
    if (st.polar) {
      html += row(t("astro.sunrise"), t(st.polar === "day" ? "astro.polar.day" : "astro.polar.night"));
    } else {
      html += row(t("astro.sunrise"), utcMinToLocal(st.rise));
      html += row(t("astro.sunset"), utcMinToLocal(st.set));
      html += row(t("astro.noon"), utcMinToLocal(st.noon));
      var lenMin = Math.round(st.ha * 8);
      html += row(t("astro.len"),
        Math.floor(lenMin / 60) + "h " + pad(lenMin % 60) + "m");
    }
    var sp = sunPosition(coords, now);
    html += row(t("astro.sunpos"),
      sp.alt.toFixed(0) + "° / " + sp.az.toFixed(0) + "°");

    // Moon
    var mi = moonInfo();
    html += '<div class="ast-row ast-moon">' + moonSvg(mi.k, mi.p) +
      '<div class="ast-moon-txt"><div class="ast-mphase">' +
      esc(t("ph." + mi.phaseIdx)) + '</div>' +
      '<div class="ast-mmeta">' + esc(t("astro.moonage")) + ": " +
      mi.age.toFixed(1) + " " + esc(t("u.days")) + " · " +
      esc(t("astro.illum")) + ": " + Math.round(mi.k * 100) + "%</div></div></div>";

    body.innerHTML = html;
    var setBtn = $("ast-set");
    if (setBtn) setBtn.addEventListener("click", openDlg);
  }

  function wireSetBtn() {
    var b = $("ast-set");
    if (b) b.addEventListener("click", openDlg);
  }

  /* ---------- Location dialog ---------- */
  function openDlg() {
    var d = readData();
    $("as-lat").value = (d.astro && typeof d.astro.lat === "number")
      ? d.astro.lat : (getCoords() ? getCoords().lat : "");
    $("as-lon").value = (d.astro && typeof d.astro.lon === "number")
      ? d.astro.lon : (getCoords() ? getCoords().lon : "");
    $("astro-dlg").showModal();
  }

  $("as-save").addEventListener("click", function () {
    var lat = parseFloat($("as-lat").value);
    var lon = parseFloat($("as-lon").value);
    $("astro-dlg").close();
    if (isFinite(lat) && isFinite(lon) &&
        Math.abs(lat) <= 90 && Math.abs(lon) <= 180) {
      var d = readData();
      d.astro = { lat: lat, lon: lon, mtime: Date.now() };
      writeData(d);
      markDirty();
      render();
    }
  });
  $("as-cancel").addEventListener("click", function () { $("astro-dlg").close(); });
  // Outside-click close: a click whose target IS the dialog hit the backdrop.
  $("astro-dlg").addEventListener("click", function (ev) {
    if (ev.target === this) this.close();
  });
  $("as-clear").addEventListener("click", function () {
    var d = readData();
    delete d.astro;
    writeData(d);
    markDirty();
    $("astro-dlg").close();
    render();
  });

  // App-scoped i18n: the dialog labels live OUTSIDE render() redraws.
  (function applyI18nA() {
    var els = document.querySelectorAll("[data-i18n-a]");
    for (var i = 0; i < els.length; i++) els[i].textContent = t(els[i].getAttribute("data-i18n-a"));
  })();

  // Boot + periodic refresh (positions drift, moon barely moves)
  render();
  setInterval(render, 30000);
  document.addEventListener("visibilitychange", function () {
    if (document.visibilityState === "visible") render();
  });
})();