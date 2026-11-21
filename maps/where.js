// ============================================================
// orOS Maps — where.js (hiking and cycling, wave H6, v1.0.0)
//
// "Where am I" (from the "You are here" popup, or long-press › "Where
// am I") and "Coordinates of this point" (long-press): one sheet with
//   - the position as decimal degrees, degrees-minutes-seconds,
//     degrees + decimal minutes and UTM (where-core.js), each with Copy;
//   - the accuracy and the elevation (GPS, or the terrain model the
//     planner uses when the device gives none), the nearest address;
//   - a compass (DeviceOrientation; on iOS it asks for the sensor on a
//     tap) with the heading and the direction in words;
//   - sunrise, sunset and the daylight left for that spot today
//     (follow-core.js sunTimes, on the device);
//   - for your own position: "Call 112" (a tel: link the phone dials)
//     and "Text my position" (an sms: link with the text filled in;
//     the person sends it, Maps sends nothing), plus Share.
// Nothing is stored or synced; the position never leaves the device
// unless the person shares, texts or calls.
//
// Safety: text goes on the page with textContent only.
// ============================================================
(function () {
  "use strict";
  var W = window.OrosMapsWhere, FC = window.OrosMapsFollow;
  var H = window.__orosMapsHost;
  if (!W || !H || !H.map || !window.L) return;
  var map = H.map;
  var LANG = window.orosI18n ? window.orosI18n.lang() : (H.lang === "el" ? "el" : "en");

  var STR = {
    en: {
      "wh.ctx.me": "Where am I", "wh.ctx.pt": "Coordinates of this point",
      "wh.title.me": "Where am I", "wh.title.pt": "This point",
      "wh.wait": "Finding your position…", "wh.nogps": "Your position is not available. Allow location for Maps, or try again outside.",
      "wh.dd": "Decimal degrees", "wh.dms": "Degrees, minutes, seconds", "wh.ddm": "Degrees and minutes (GPS)", "wh.utm": "UTM",
      "wh.copy": "Copy", "wh.copied": "Copied",
      "wh.acc": "Accuracy ±{n} m", "wh.ele": "Elevation {n} m", "wh.ele.dem": "Elevation about {n} m (terrain model)",
      "wh.age": "Measured at {t}", "wh.again": "Update",
      "wh.compass": "Compass", "wh.compass.on": "Turn on the compass", "wh.compass.none": "This device has no compass Maps can read.",
      "wh.compass.wait": "Turn the phone flat and move it in a figure eight if the arrow does not settle.",
      "wh.facing": "Facing {d} ({n}°)",
      "wh.sun": "Sunrise {r} · sunset {s}", "wh.sun.left": "{h} of daylight left", "wh.sun.gone": "The sun has set",
      "wh.sun.before": "Sunrise in {h}", "wh.sun.polar.day": "The sun does not set today", "wh.sun.polar.night": "The sun does not rise today",
      "wh.call": "Call 112", "wh.sms": "Text my position", "wh.share": "Share",
      "wh.help": "112 works in every EU country, also without a SIM card or credit. Give them the coordinates above.",
      "wh.sms.at": "My position", "wh.sms.acc": "accuracy", "wh.sms.ele": "elevation", "wh.sms.time": "time",
      "wh.d.0": "north", "wh.d.1": "north-east", "wh.d.2": "east", "wh.d.3": "south-east",
      "wh.d.4": "south", "wh.d.5": "south-west", "wh.d.6": "west", "wh.d.7": "north-west",
      "wh.hm": "{h} h {m} min", "wh.min": "{m} min",
      "wh.close": "Close"
    },
    el: {
      "wh.ctx.me": "Πού είμαι", "wh.ctx.pt": "Συντεταγμένες του σημείου",
      "wh.title.me": "Πού είμαι", "wh.title.pt": "Αυτό το σημείο",
      "wh.wait": "Αναζήτηση της θέσης σου…", "wh.nogps": "Η θέση σου δεν είναι διαθέσιμη. Επίτρεψε την τοποθεσία στους Χάρτες ή δοκίμασε ξανά σε ανοιχτό χώρο.",
      "wh.dd": "Δεκαδικές μοίρες", "wh.dms": "Μοίρες, λεπτά, δευτερόλεπτα", "wh.ddm": "Μοίρες και λεπτά (GPS)", "wh.utm": "UTM",
      "wh.copy": "Αντιγραφή", "wh.copied": "Αντιγράφηκε",
      "wh.acc": "Ακρίβεια ±{n} μ.", "wh.ele": "Υψόμετρο {n} μ.", "wh.ele.dem": "Υψόμετρο περίπου {n} μ. (μοντέλο εδάφους)",
      "wh.age": "Μετρήθηκε στις {t}", "wh.again": "Ανανέωση",
      "wh.compass": "Πυξίδα", "wh.compass.on": "Άνοιξε την πυξίδα", "wh.compass.none": "Αυτή η συσκευή δεν έχει πυξίδα που μπορούν να διαβάσουν οι Χάρτες.",
      "wh.compass.wait": "Κράτα το κινητό οριζόντια και κούνησέ το σε σχήμα οκτώ αν το βέλος δεν σταθεροποιείται.",
      "wh.facing": "Κοιτάς {d} ({n}°)",
      "wh.sun": "Ανατολή {r} · δύση {s}", "wh.sun.left": "Μένουν {h} φως ημέρας", "wh.sun.gone": "Ο ήλιος έχει δύσει",
      "wh.sun.before": "Ανατολή σε {h}", "wh.sun.polar.day": "Ο ήλιος δεν δύει σήμερα", "wh.sun.polar.night": "Ο ήλιος δεν ανατέλλει σήμερα",
      "wh.call": "Κλήση στο 112", "wh.sms": "Στείλε τη θέση μου με SMS", "wh.share": "Κοινοποίηση",
      "wh.help": "Το 112 λειτουργεί σε κάθε χώρα της ΕΕ, και χωρίς κάρτα SIM ή υπόλοιπο. Δώσε τους τις συντεταγμένες από πάνω.",
      "wh.sms.at": "Η θέση μου", "wh.sms.acc": "ακρίβεια", "wh.sms.ele": "υψόμετρο", "wh.sms.time": "ώρα",
      "wh.d.0": "βόρεια", "wh.d.1": "βορειοανατολικά", "wh.d.2": "ανατολικά", "wh.d.3": "νοτιοανατολικά",
      "wh.d.4": "νότια", "wh.d.5": "νοτιοδυτικά", "wh.d.6": "δυτικά", "wh.d.7": "βορειοδυτικά",
      "wh.hm": "{h} ώ. {m} λ.", "wh.min": "{m} λ.",
      "wh.close": "Κλείσιμο"
    }
  };
  if (window.orosI18n) window.orosI18n.table(STR, "maps", LANG);
  function t(k, vars) {
    k = "wh." + k;
    var s = (STR[LANG] && STR[LANG][k]) || STR.en[k] || k;
    if (vars) Object.keys(vars).forEach(function (v) { s = s.split("{" + v + "}").join(String(vars[v])); });
    return s;
  }
  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  }
  function button(label, cls, fn) {
    var b = el("button", cls, label);
    b.type = "button";
    b.addEventListener("click", fn);
    return b;
  }
  function toast(s) { (H.toast || H.localToast)(s); }
  function pad(n) { return (n < 10 ? "0" : "") + n; }
  function hm(d) { return pad(d.getHours()) + ":" + pad(d.getMinutes()); }
  function dur(ms) {
    var m = Math.max(0, Math.round(ms / 60000));
    return m >= 60 ? t("hm", { h: Math.floor(m / 60), m: m % 60 }) : t("min", { m: m });
  }
  var ICON_PIN = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M12 2v4M12 18v4M2 12h4M18 12h4"/></svg>';

  // ---------- the sheet ----------
  var sheet = null, open = false, cur = null, comp = null, compOn = false, sunTimer = null, smsA = null;
  function setH() {
    var h = 0;
    document.querySelectorAll(".osm-sheet").forEach(function (s) { if (!s.hidden) h = Math.max(h, s.offsetHeight); });
    document.body.style.setProperty("--osm-h", h + "px");
  }
  window.addEventListener("oros-maps-mode", function (e) { if (open && e.detail !== "where") closeSheet(); });
  function closeSheet() {
    open = false;
    cur = null;
    compassOff();
    clearInterval(sunTimer); sunTimer = null;
    if (!sheet) return;
    sheet.hidden = true;
    sheet.textContent = "";
    document.body.classList.remove("osm-mode");
    if (mark) { map.removeLayer(mark); mark = null; }
    setH();
  }
  var mark = null;
  function openSheet() {
    if (!open) { try { window.dispatchEvent(new CustomEvent("oros-maps-mode", { detail: "where" })); } catch (e) {} }
    open = true;
    sheet.hidden = false;
    document.body.classList.add("osm-mode");
  }
  function header(title) {
    var h = el("header", "");
    h.appendChild(el("h3", "", title));
    var c = button("", "osm-iconbtn osm-close", closeSheet);
    c.setAttribute("aria-label", t("close")); c.title = t("close");
    c.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>';
    h.appendChild(c);
    return h;
  }

  // The device position with accuracy and altitude.
  function measure(cb) {
    if (window.__orosMapsWhereFix) { cb(window.__orosMapsWhereFix()); return; }
    if (!("geolocation" in navigator)) { cb(null); return; }
    navigator.geolocation.getCurrentPosition(function (p) {
      var c = p.coords;
      cb({ lat: c.latitude, lon: c.longitude, acc: c.accuracy, ele: typeof c.altitude === "number" ? c.altitude : null, t: p.timestamp || Date.now() });
    }, function () { cb(null); }, { enableHighAccuracy: true, timeout: 20000, maximumAge: 15000 });
  }

  // me: your own position; else place { lat, lon, name? }
  function show(me, place) {
    if (!sheet) return;
    openSheet();
    sheet.textContent = "";
    sheet.appendChild(header(me ? t("title.me") : t("title.pt")));
    var body = el("div", "osm-body");
    sheet.appendChild(body);
    if (me && !place) {
      body.appendChild(el("p", "osm-hint wh-wait", t("wait")));
      setH();
      measure(function (fix) {
        if (!open) return;
        if (!fix) { body.textContent = ""; body.appendChild(el("p", "osm-warn", t("nogps"))); var r = el("div", "osm-actions"); r.appendChild(button(t("again"), "osm-btn", function () { show(true); })); body.appendChild(r); setH(); return; }
        show(true, fix);
      });
      return;
    }
    smsA = null;
    cur = { me: !!me, lat: place.lat, lon: place.lon, acc: place.acc, ele: typeof place.ele === "number" && isFinite(place.ele) ? place.ele : null, t: place.t || null, name: "", dem: null };
    if (mark) map.removeLayer(mark);
    mark = L.circleMarker([cur.lat, cur.lon], { radius: 7, color: "#fff", weight: 3, fillColor: "#6d4aff", fillOpacity: 1, interactive: false }).addTo(map);
    try { map.setView([cur.lat, cur.lon], Math.max(map.getZoom(), 15)); } catch (e) {}
    // for your own position the help buttons come first
    var r1 = el("div", "osm-actions wh-acts");
    body.appendChild(r1);
    // formats
    var u = W.utm(cur.lat, cur.lon);
    [["dd", W.dd(cur.lat, cur.lon)], ["dms", W.dms(cur.lat, cur.lon)], ["ddm", W.ddm(cur.lat, cur.lon)], ["utm", u ? u.text : ""]].forEach(function (f) {
      if (!f[1]) return;
      var row = el("div", "wh-row wh-" + f[0]);
      var txt = el("div", "wh-txt");
      txt.appendChild(el("span", "wh-lab", t(f[0])));
      txt.appendChild(el("b", "wh-val", f[1]));
      row.appendChild(txt);
      var cp = button(t("copy"), "osm-mini wh-copy", function () { copy(f[1]); });
      cp.setAttribute("aria-label", t("copy") + ": " + t(f[0]));
      row.appendChild(cp);
      body.appendChild(row);
    });
    var facts = el("p", "osm-small wh-facts");
    body.appendChild(facts);
    function fillFacts() {
      var a = [];
      if (cur.name) a.push(cur.name);
      if (typeof cur.acc === "number" && isFinite(cur.acc)) a.push(t("acc", { n: Math.round(cur.acc) }));
      if (cur.ele !== null) a.push(t("ele", { n: Math.round(cur.ele) }));
      else if (cur.dem !== null) a.push(t("ele.dem", { n: Math.round(cur.dem) }));
      if (cur.t) a.push(t("age", { t: hm(new Date(cur.t)) }));
      facts.textContent = a.join(" · ");
      if (smsA && cur.me) smsA.href = W.smsHref(smsText());
    }
    fillFacts();
    if (H.reverseName) {
      var pl = { lat: cur.lat, lon: cur.lon, name: "", sub: "" }, mine = cur;
      try { H.reverseName(pl, function () { if (cur !== mine) return; cur.name = [pl.name, pl.sub].filter(Boolean).join(", ").slice(0, 160); fillFacts(); }); } catch (e) {}
    }
    if (cur.ele === null && H.elevationOf) {
      var mine2 = cur;
      Promise.resolve(H.elevationOf([[cur.lat, cur.lon], [cur.lat, cur.lon + 0.00001]])).then(function (r) {
        if (cur !== mine2 || !r || !r.vals || typeof r.vals[0] !== "number") return;
        cur.dem = r.vals[0]; fillFacts();
      }, function () {});
    }

    // compass
    var cb = el("div", "wh-compass");
    cb.setAttribute("aria-live", "polite");
    var dial = el("div", "wh-dial");
    dial.setAttribute("aria-hidden", "true");
    dial.appendChild(el("span", "wh-n", "N"));
    var needle = el("span", "wh-needle");
    dial.appendChild(needle);
    cb.appendChild(dial);
    var ctext = el("div", "wh-ctext");
    cb.appendChild(ctext);
    body.appendChild(cb);
    comp = { needle: needle, text: ctext };
    if (compOn) compassText(lastHead);
    else {
      ctext.appendChild(el("span", "wh-lab", t("compass")));
      ctext.appendChild(button(t("compass.on"), "osm-btn wh-compass-on", compassStart));
    }

    // sun
    var sun = el("p", "osm-small wh-sun");
    body.appendChild(sun);
    function fillSun() {
      if (!FC || !cur) return;
      var s = FC.sunTimes(new Date(), cur.lat, cur.lon);
      if (!s) { sun.textContent = ""; return; }
      if (s.polar) { sun.textContent = t(s.polar === "day" ? "sun.polar.day" : "sun.polar.night"); return; }
      var now = Date.now(), line = t("sun", { r: hm(s.rise), s: hm(s.set) });
      if (now < s.rise.getTime()) line += " · " + t("sun.before", { h: dur(s.rise.getTime() - now) });
      else if (now < s.set.getTime()) line += " · " + t("sun.left", { h: dur(s.set.getTime() - now) });
      else line += " · " + t("sun.gone");
      sun.textContent = line;
    }
    fillSun();
    clearInterval(sunTimer);
    sunTimer = setInterval(fillSun, 60000);

    // actions
    if (cur.me) {
      var call = el("a", "osm-btn danger wh-call", t("call"));
      call.href = "tel:112";
      r1.appendChild(call);
      var sms = smsA = el("a", "osm-btn wh-sms", t("sms"));
      sms.href = W.smsHref(smsText());      // again when the address or the terrain height arrives
      r1.appendChild(sms);
    }
    var r2 = el("div", "osm-actions");
    if (H.share) r2.appendChild(button(t("share"), "osm-btn wh-share", function () { H.share({ lat: cur.lat, lon: cur.lon, name: cur.name || "" }); }));
    if (cur.me) r2.appendChild(button(t("again"), "osm-btn wh-again", function () { show(true); }));
    body.appendChild(r2);
    if (cur.me) r1.parentNode.insertBefore(el("p", "osm-small wh-help", t("help")), r1.nextSibling);
    else r1.remove();
    setH();
  }
  function smsText() {
    return W.smsText({ lat: cur.lat, lon: cur.lon, acc: cur.acc, ele: cur.ele !== null ? cur.ele : cur.dem, t: cur.t, place: cur.name,
      words: { at: t("sms.at"), acc: t("sms.acc"), ele: t("sms.ele"), time: t("sms.time") } });
  }
  function copy(s) {
    function done() { toast(t("copied")); }
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) { navigator.clipboard.writeText(s).then(done, fallback); return; }
    } catch (e) {}
    fallback();
    function fallback() {
      var ta = el("textarea", "");
      ta.value = s; ta.setAttribute("readonly", ""); ta.style.position = "fixed"; ta.style.opacity = "0";
      document.body.appendChild(ta); ta.select();
      try { document.execCommand("copy"); done(); } catch (e) {}
      ta.remove();
    }
  }

  // ---------- compass ----------
  var lastHead = null, gotAny = false, noneTimer = null;
  function onOrient(ev) {
    var ang = 0;
    try { ang = (screen.orientation && screen.orientation.angle) || window.orientation || 0; } catch (e) {}
    var h = W.heading(ev, ang);
    if (h === null) return;
    gotAny = true;
    lastHead = h;
    compassText(h);
  }
  function compassText(h) {
    if (!comp) return;
    comp.text.textContent = "";
    comp.text.appendChild(el("span", "wh-lab", t("compass")));
    if (h === null) { comp.text.appendChild(el("span", "osm-small", gotAny || !compOn ? "" : t("compass.wait"))); return; }
    comp.needle.style.transform = "rotate(" + (-h) + "deg)";
    comp.text.appendChild(el("b", "wh-facing", t("facing", { d: t("d." + W.cardinal(h)), n: Math.round(h) })));
  }
  function listen() {
    compOn = true;
    gotAny = false;
    if ("ondeviceorientationabsolute" in window) window.addEventListener("deviceorientationabsolute", onOrient);
    else window.addEventListener("deviceorientation", onOrient);
    compassText(lastHead);
    clearTimeout(noneTimer);
    noneTimer = setTimeout(function () {
      if (!gotAny && open) noCompass();
    }, 3000);
  }
  function compassStart() {
    var DOE = window.DeviceOrientationEvent;
    if (!DOE) { noCompass(); return; }
    if (typeof DOE.requestPermission === "function") {
      DOE.requestPermission().then(function (s) { if (s === "granted") listen(); else noCompass(); }, noCompass);
    } else listen();
  }
  function noCompass() {
    if (!comp) return;
    comp.text.textContent = "";
    comp.text.appendChild(el("span", "wh-lab", t("compass")));
    comp.text.appendChild(el("span", "osm-small wh-none", t("compass.none")));
    setH();
  }
  function compassOff() {
    window.removeEventListener("deviceorientationabsolute", onOrient);
    window.removeEventListener("deviceorientation", onOrient);
    clearTimeout(noneTimer);
    compOn = false;
    comp = null;
  }

  // ---------- boot ----------
  function boot() {
    sheet = el("aside", "osm-sheet wh-sheet");
    sheet.id = "where-panel";
    sheet.setAttribute("aria-label", t("title.me"));
    sheet.hidden = true;
    document.body.appendChild(sheet);
    try { new ResizeObserver(setH).observe(sheet); } catch (e) {}
    if (Array.isArray(H.ctxItems)) {
      H.ctxItems.push(function () { return { icon: ICON_PIN, label: t("ctx.me"), run: function () { show(true); } }; });
      H.ctxItems.push(function (place) { return { icon: ICON_PIN, label: t("ctx.pt"), run: function () { show(false, place); } }; });
    }
    if (Array.isArray(H.meItems)) H.meItems.push(function (pos) { return { label: t("ctx.me"), run: function () { show(true); } }; });
  }
  boot();
  window.__orosMapsWhere = { show: show, close: closeSheet, cur: function () { return cur; }, orient: onOrient, smsText: function () { return cur ? smsText() : ""; } };
})();
