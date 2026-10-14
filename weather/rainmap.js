// ============================================================
// orOS Weather — Rain map (wave 52)
// Global precipitation from NASA GIBS (IMERG half-hourly, a
// satellite ESTIMATE a few hours old — not live radar) over an
// OpenStreetMap base, centred on the city on screen.
// - Nothing loads until the person taps "Show rain map": then the
//   vendored Leaflet (../vendor/leaflet.*), one DescribeDomains
//   request (newest time GIBS has; falls back to probing one z0
//   tile per half hour) and the tiles of what is on screen.
// - Time slider over the newest 12 half hours, play button,
//   legend in mm/h, EN + EL label, attribution.
// - Offline: a friendly message, no requests.
// - Session-only state (open/closed); nothing synced or stored.
// Pure logic: rainmap-core.js (window.OrosRainMapCore).
// weather.js calls window.OrosRainMap.update(city, tzOffsetSec).
// ============================================================
(function () {
  "use strict";

  var R = window.OrosRainMapCore || null;
  var LANG = "en";
  try { LANG = localStorage.getItem("oros-lang") === "el" ? "el" : "en"; } catch (e) {}
  var APP_V = (function () {
    var m = ((document.currentScript && document.currentScript.src) || "").match(/[?&]v=([^&#]+)/);
    return m ? m[1] : "1";
  })();

  var STR = {
    en: {
      "title": "Rain map",
      "open": "Show rain map",
      "close": "Hide rain map",
      "note": "Satellite estimate of rain (NASA IMERG), a few hours old — not live radar.",
      "loading": "Loading the rain map…",
      "finding": "Looking for the newest satellite picture…",
      "offline": "You're offline. The rain map needs a connection; open it again when you're back online.",
      "fail": "The rain map could not be loaded. Check your connection and try again.",
      "nodata": "NASA GIBS has no recent rain picture right now. Try again later.",
      "tiles": "Some parts of the map could not be loaded.",
      "retry": "Try again",
      "play": "Play",
      "pause": "Pause",
      "slider": "Time of the rain picture",
      "ago": "{h} h ago",
      "ago1": "1 h ago",
      "ago0": "less than 1 h ago",
      "legend": "Rain (mm/h)",
      "snow": "Snow",
      "light": "light",
      "heavy": "heavy",
      "imagery": "Imagery: NASA GIBS / IMERG",
      "here": "Your city"
    },
    el: {
      "title": "Χάρτης βροχής",
      "open": "Εμφάνιση χάρτη βροχής",
      "close": "Απόκρυψη χάρτη βροχής",
      "note": "Δορυφορική εκτίμηση της βροχής (NASA IMERG), λίγων ωρών — όχι ζωντανό ραντάρ.",
      "loading": "Φόρτωση του χάρτη βροχής…",
      "finding": "Αναζήτηση της πιο πρόσφατης δορυφορικής εικόνας…",
      "offline": "Είσαι εκτός σύνδεσης. Ο χάρτης βροχής θέλει σύνδεση· άνοιξέ τον ξανά όταν επανέλθει.",
      "fail": "Δεν φορτώθηκε ο χάρτης βροχής. Έλεγξε τη σύνδεση και δοκίμασε ξανά.",
      "nodata": "Η NASA GIBS δεν έχει πρόσφατη εικόνα βροχής αυτή τη στιγμή. Δοκίμασε αργότερα.",
      "tiles": "Κάποια σημεία του χάρτη δεν φορτώθηκαν.",
      "retry": "Δοκίμασε ξανά",
      "play": "Αναπαραγωγή",
      "pause": "Παύση",
      "slider": "Ώρα της εικόνας βροχής",
      "ago": "πριν από {h} ώρες",
      "ago1": "πριν από 1 ώρα",
      "ago0": "πριν από λιγότερο από 1 ώρα",
      "legend": "Βροχή (mm/h)",
      "snow": "Χιόνι",
      "light": "ασθενής",
      "heavy": "έντονη",
      "imagery": "Εικόνες: NASA GIBS / IMERG",
      "here": "Η πόλη σου"
    }
  };
  function t(k) { var p = STR[LANG] || STR.en; return p[k] !== undefined ? p[k] : (STR.en[k] || k); }
  function $(id) { return document.getElementById(id); }
  function mk(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined && text !== null) e.textContent = text;
    return e;
  }
  function pad(n) { return (n < 10 ? "0" : "") + n; }

  // ----- state (session only) -----
  var city = null, tz = null;
  var open = false, built = false;
  var lmap = null, rainLayer = null, cityMark = null;
  var frames = [], idx = 0, playTimer = null;
  var latestAt = 0, latestMs = null;          // newest time + when found
  var busy = false, tileErr = false;
  var LATEST_TTL = 15 * 60 * 1000;

  // ----- Leaflet (vendored, lazy) -----
  var leafletP = null;
  function loadScript(src) {
    return new Promise(function (resolve, reject) {
      var s = document.createElement("script");
      s.src = src;
      s.onload = function () { resolve(); };
      s.onerror = function () { reject(new Error("load")); };
      document.head.appendChild(s);
    });
  }
  function ensureLeaflet() {
    if (window.L && window.L.map) return Promise.resolve(window.L);
    if (leafletP) return leafletP;
    var css = document.createElement("link");
    css.rel = "stylesheet";
    css.href = "../vendor/leaflet.css?v=" + APP_V;
    document.head.appendChild(css);
    leafletP = loadScript("../vendor/leaflet.js?v=" + APP_V).then(function () {
      if (!window.L || !window.L.map) throw new Error("leaflet");
      return window.L;
    }, function (e) { leafletP = null; throw e; });
    return leafletP;
  }

  // ----- the newest time GIBS has -----
  function withTimeout(p, ms) {
    return new Promise(function (resolve, reject) {
      var done = false;
      var tm = setTimeout(function () { if (!done) { done = true; reject(new Error("timeout")); } }, ms);
      p.then(function (v) { if (!done) { done = true; clearTimeout(tm); resolve(v); } },
             function (e) { if (!done) { done = true; clearTimeout(tm); reject(e); } });
    });
  }
  function probe(ms) {           // one z0 tile: loads only when GIBS has that time
    return new Promise(function (resolve) {
      var img = new Image(), done = false;
      var tm = setTimeout(function () { finish(false); }, 8000);
      function finish(ok) { if (done) return; done = true; clearTimeout(tm); img.onload = img.onerror = null; resolve(ok); }
      img.onload = function () { finish(img.naturalWidth > 0); };
      img.onerror = function () { finish(false); };
      img.src = R.tileUrl(ms, 0, 0, 0);
    });
  }
  function probeLatest() {       // newest first, 4 at a time
    var list = R.probeTimes(Date.now());
    function batch(i) {
      if (i >= list.length) return Promise.resolve(null);
      var part = list.slice(i, i + 4);
      return Promise.all(part.map(probe)).then(function (oks) {
        for (var k = 0; k < oks.length; k++) if (oks[k]) return part[k];
        return batch(i + 4);
      });
    }
    return batch(0);
  }
  function findLatest() {
    if (latestMs !== null && Date.now() - latestAt < LATEST_TTL) return Promise.resolve(latestMs);
    var now = Date.now();
    var ask = typeof fetch === "function"
      ? withTimeout(fetch(R.domainsUrl(now - 24 * 3600 * 1000, now), { credentials: "omit" }), 10000)
          .then(function (r) { if (!r.ok) throw new Error("http " + r.status); return r.text(); })
          .then(function (xml) { return R.parseDomains(xml, now); })
      : Promise.reject(new Error("nofetch"));
    return ask.then(function (ms) { return ms !== null ? ms : probeLatest(); },
                    function () { return probeLatest(); })
      .then(function (ms) {
        if (ms !== null) { latestMs = ms; latestAt = Date.now(); }
        return ms;
      });
  }

  // ----- labels -----
  function fmtFrame(ms) {
    var off = typeof tz === "number" ? tz : -new Date().getTimezoneOffset() * 60;
    // The start of the half hour, in the city's clock (as Worldview).
    var d = new Date(ms + off * 1000);
    var wd = d.toLocaleDateString(LANG === "el" ? "el-GR" : "en-GB", { weekday: "short", timeZone: "UTC" });
    var h = R.hoursAgo(ms, Date.now());
    return wd + " " + pad(d.getUTCHours()) + ":" + pad(d.getUTCMinutes()) + " · " +
      (h < 1 ? t("ago0") : h === 1 ? t("ago1") : t("ago").replace("{h}", String(h)));
  }

  // ----- DOM -----
  function msg(key, withRetry) {
    var m = $("rain-msg");
    if (!m) return;
    m.textContent = "";
    if (!key) { m.hidden = true; return; }
    m.appendChild(mk("span", "", t(key)));
    if (withRetry) {
      var b = mk("button", "btn-secondary rain-retry", t("retry"));
      b.type = "button";
      b.addEventListener("click", function () { latestMs = null; show(); });
      m.appendChild(b);
    }
    m.hidden = false;
  }
  function buildLegend() {
    var host = $("rain-legend");
    if (!host || host.firstChild) return;
    function bar(label, stops, ticks) {
      var row = mk("div", "rain-lrow");
      row.appendChild(mk("span", "rain-lname", label));
      var wrap = mk("div", "rain-lwrap");
      var b = mk("div", "rain-lbar");
      b.style.background = R.legendGradient(stops);
      wrap.appendChild(b);
      if (ticks) {
        var tk = mk("div", "rain-ticks");
        ticks.forEach(function (v) {
          var s = mk("span", "rain-tick", String(v));
          s.style.left = R.legendPos(v, stops) + "%";
          tk.appendChild(s);
        });
        wrap.appendChild(tk);
      }
      row.appendChild(wrap);
      host.appendChild(row);
    }
    bar(t("legend"), R.LEGEND, [0.1, 0.5, 1, 2.5, 5, 10, 25, 50]);
    bar(t("snow"), R.LEGEND_SNOW, null);
  }
  function buildStatic() {
    if (built) return;
    built = true;
    $("rain-title").textContent = t("title");
    $("rain-note").textContent = t("note");
    var sl = $("rain-slider");
    sl.setAttribute("aria-label", t("slider"));
    sl.addEventListener("input", function () { stopPlay(); setFrame(+sl.value); });
    $("rain-play").addEventListener("click", function () { if (playTimer) stopPlay(); else startPlay(); });
    $("rain-toggle").addEventListener("click", function () { if (open) hide(); else show(); });
    $("rain-attrib").textContent = t("imagery") + " · © OpenStreetMap contributors";
    buildLegend();
    paintPlay();
    window.addEventListener("offline", function () { if (open) { stopPlay(); msg("offline"); } });
    window.addEventListener("online", function () { if (open && !rainLayer) show(); else if (open) msg(tileErr ? "tiles" : ""); });
  }
  function paintToggle() {
    var b = $("rain-toggle");
    b.textContent = t(open ? "close" : "open");
    b.setAttribute("aria-expanded", open ? "true" : "false");
  }
  function paintPlay() {
    var b = $("rain-play");
    var label = t(playTimer ? "pause" : "play");
    b.setAttribute("aria-label", label);
    b.title = label;
    b.innerHTML = playTimer
      ? '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/></svg>'
      : '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><polygon points="6 4 20 12 6 20 6 4"/></svg>';
  }

  // ----- frames + playback -----
  function setFrame(i) {
    if (!frames.length) return;
    idx = Math.max(0, Math.min(frames.length - 1, i));
    $("rain-slider").value = String(idx);
    $("rain-time").textContent = fmtFrame(frames[idx]);
    if (rainLayer) { tileErr = false; rainLayer.setUrl(R.tileTemplate(frames[idx])); }
  }
  function startPlay() {
    if (!frames.length || !navigator.onLine) return;
    if (idx >= frames.length - 1) setFrame(0);
    playTimer = setInterval(function () {
      if (idx >= frames.length - 1) { stopPlay(); return; }
      setFrame(idx + 1);
    }, 1200);
    paintPlay();
  }
  function stopPlay() {
    if (playTimer) clearInterval(playTimer);
    playTimer = null;
    paintPlay();
  }

  // ----- open / close -----
  function show() {
    if (!R || busy) return;
    open = true;
    paintToggle();
    $("rain-body").hidden = false;
    if (!navigator.onLine) { $("rain-map-wrap").hidden = true; msg("offline", true); return; }
    busy = true;
    msg("loading");
    ensureLeaflet().then(function (L) {
      msg("finding");
      return findLatest().then(function (ms) { return { L: L, ms: ms }; });
    }).then(function (r) {
      busy = false;
      if (!open) return;
      if (r.ms === null) {
        msg(navigator.onLine ? "nodata" : "offline", true);
        $("rain-map-wrap").hidden = true;
        return;
      }
      frames = R.frames(r.ms);
      $("rain-slider").max = String(frames.length - 1);
      $("rain-map-wrap").hidden = false;
      drawMap(r.L);
      setFrame(frames.length - 1);
      msg("");
    }, function () {
      busy = false;
      if (!open) return;
      $("rain-map-wrap").hidden = true;
      msg(navigator.onLine ? "fail" : "offline", true);
    });
  }
  function hide() {
    open = false;
    stopPlay();
    paintToggle();
    $("rain-body").hidden = true;
  }
  function drawMap(L) {
    var center = city ? [city.lat, city.lon] : [20, 0];
    if (!lmap) {
      lmap = L.map($("rain-box"), {
        zoomControl: true, attributionControl: true, worldCopyJump: true,
        minZoom: 1, maxZoom: 9, scrollWheelZoom: false
      });
      L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19,
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a>'
      }).addTo(lmap);
      rainLayer = L.tileLayer(R.tileTemplate(frames[frames.length - 1]), {
        maxNativeZoom: R.MAX_NATIVE_ZOOM, maxZoom: 9, opacity: 0.75,
        attribution: '<a href="https://nasa-gibs.github.io/gibs-api-docs/" target="_blank" rel="noopener noreferrer">' +
          (LANG === "el" ? "Εικόνες: NASA GIBS / IMERG" : "Imagery: NASA GIBS / IMERG") + "</a>"
      }).addTo(lmap);
      rainLayer.on("tileerror", function () {
        if (!tileErr) { tileErr = true; if (navigator.onLine) msg("tiles"); else msg("offline"); }
      });
      rainLayer.on("load", function () { if (!tileErr) msg(""); });
      lmap.setView(center, city ? 5 : 2);
    } else {
      lmap.invalidateSize();
      lmap.setView(center, lmap.getZoom());
    }
    placeCity(L);
  }
  function placeCity(L) {
    if (!lmap) return;
    if (cityMark) { lmap.removeLayer(cityMark); cityMark = null; }
    if (!city) return;
    cityMark = L.circleMarker([city.lat, city.lon], {
      radius: 6, weight: 2, color: "#ffffff", fillColor: "#6d4aff", fillOpacity: 1
    }).addTo(lmap);
    cityMark.bindTooltip(mk("span", "", String(city.label || t("here"))));   // text node: never HTML
  }

  // ----- called by weather.js on every render -----
  function update(c, tzSec) {
    var sec = $("rainmap"), title = $("rain-title");
    if (!sec || !R) return;
    buildStatic();
    var has = !!(c && typeof c.lat === "number" && typeof c.lon === "number" && isFinite(c.lat) && isFinite(c.lon));
    sec.hidden = !has;
    title.hidden = !has;
    if (!has) { if (open) hide(); city = null; return; }
    var moved = !city || city.id !== c.id || city.lat !== c.lat || city.lon !== c.lon;
    city = { id: c.id, lat: c.lat, lon: c.lon, label: c.label };
    tz = typeof tzSec === "number" ? tzSec : null;
    paintToggle();
    if (open && frames.length) $("rain-time").textContent = fmtFrame(frames[idx]);
    if (open && lmap && moved && window.L) {
      lmap.setView([city.lat, city.lon], Math.max(lmap.getZoom(), 4));
      placeCity(window.L);
    }
  }

  window.OrosRainMap = { update: update };
})();
