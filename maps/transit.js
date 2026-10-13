// ============================================================
// orOS Maps — transit.js (public transport, maps wave 7, v1.0.0).
// OsmAnd / Transitous style.
//
//   - "Public transport" sheet: from / to (my location, a point
//     picked on the map, or the route planner's points), leave now /
//     depart at / arrive by, connections with lines, transfers,
//     walking and live delays; earlier / later.
//   - A connection opens step by step and is drawn on the map in
//     the lines' colours (walking dotted). Share it as text, save it
//     to My tracks.
//   - Departures board for a stop (live times where the operator
//     publishes them), refreshed every minute while it is open.
//   - Stops on the map (zoom 15+) and live vehicles: where each
//     train, metro or bus is now, from its timetable and live data.
//
// Data: Transitous (transitous.org), free and community-run, over
// open timetables and OpenStreetMap; the sources are credited under
// the results. Nothing is sent but the two points and the time.
//
// Device-local preferences (not synced): oros-maps-transit
//   { stops: 0|1, live: 0|1 }
// Test hook: window.__orosMapsTransit { open, close, plan, stop, state }
// ============================================================
(function () {
  "use strict";
  var X = window.OrosMapsTransit;
  var H = window.__orosMapsHost;
  if (!X || !H || !H.map || !window.L) return;
  var map = H.map;
  var LANG = H.lang === "el" ? "el" : "en";
  // One place to repoint the API (e.g. through the orOS relay).
  var BASE = X.BASE;
  var PREFS_KEY = "oros-maps-transit";
  var STOPS_ZOOM = 15, LIVE_ZOOM = 9, LIVE_MS = 30000, BOARD_MS = 60000;

  var STR = {
    en: {
      "btn": "Public transport",
      "title": "Public transport",
      "from": "From", "to": "To",
      "me": "My location", "pick": "Pick on map", "picking": "Tap the map…",
      "plan.pts": "Use the route's points",
      "swap": "Swap",
      "unset": "Not chosen",
      "when.now": "Leave now", "when.depart": "Depart at", "when.arrive": "Arrive by",
      "when.label": "When",
      "find": "Find connections",
      "finding": "Looking for connections…",
      "need": "Choose where you start and where you go.",
      "pick.hint": "Tap the map to choose the point.",
      "noloc": "Your location is not available. Pick the start on the map.",
      "none": "No connection found for this time. Try a later time or nearby points.",
      "err": "The public transport service did not answer. Try again in a while.",
      "err.net": "Public transport could not be reached from here. Check your connection.",
      "offline": "You are offline. Public transport needs a connection.",
      "earlier": "Earlier", "later": "Later",
      "min": "min", "h": "h",
      "transfers0": "Direct", "transfers1": "1 change", "transfersN": "{n} changes",
      "walk.only": "On foot",
      "walk": "Walk", "walkm": "Walk {m}", "to.word": "to",
      "live": "live", "late": "+{n} min", "early": "−{n} min", "ontime": "on time",
      "cancelled": "Cancelled",
      "stops.n": "{n} stops", "stops.1": "1 stop",
      "track": "Platform {t}",
      "towards": "towards {h}",
      "arrive": "Arrive",
      "share": "Share", "save": "Save to My tracks",
      "saved": "Saved to My tracks", "save.no": "Could not save the trip",
      "copied": "Trip copied",
      "board": "Departures",
      "board.empty": "No departures in the next hours.",
      "board.refresh": "Refresh",
      "board.updated": "Updated {t}",
      "show.stops": "Show stops on the map (zoom in)",
      "show.live": "Show live vehicles",
      "live.hint": "Vehicles move by their timetable and live data where the operator publishes it.",
      "zoom.stops": "Zoom in to see stops.",
      "zoom.live": "Zoom out a little to see vehicles.",
      "credit": "Timetables: Transitous and its open data sources",
      "credit.osm": "Map data © OpenStreetMap contributors",
      "beta": "Coverage depends on open timetables: city buses, metro, tram and trains in Athens and Thessaloniki, Hellenic Train, and much of Europe.",
      "ctx.to": "Public transport to here",
      "ctx.board": "Departures nearby",
      "near.none": "No stop found close to this point.",
      "back": "Back", "close": "Close"
    },
    el: {
      "btn": "ΜΜΜ",
      "title": "Μέσα μαζικής μεταφοράς",
      "from": "Από", "to": "Προς",
      "me": "Η θέση μου", "pick": "Επιλογή στον χάρτη", "picking": "Πάτησε στον χάρτη…",
      "plan.pts": "Τα σημεία της διαδρομής",
      "swap": "Αντιστροφή",
      "unset": "Δεν έχει επιλεγεί",
      "when.now": "Αναχώρηση τώρα", "when.depart": "Αναχώρηση στις", "when.arrive": "Άφιξη έως",
      "when.label": "Πότε",
      "find": "Εύρεση δρομολογίων",
      "finding": "Αναζήτηση δρομολογίων…",
      "need": "Διάλεξε από πού ξεκινάς και πού πας.",
      "pick.hint": "Πάτησε στον χάρτη για να διαλέξεις το σημείο.",
      "noloc": "Η θέση σου δεν είναι διαθέσιμη. Διάλεξε την αφετηρία στον χάρτη.",
      "none": "Δεν βρέθηκε δρομολόγιο για αυτή την ώρα. Δοκίμασε αργότερα ή κοντινά σημεία.",
      "err": "Η υπηρεσία ΜΜΜ δεν απάντησε. Δοκίμασε ξανά σε λίγο.",
      "err.net": "Η υπηρεσία ΜΜΜ δεν είναι προσβάσιμη από εδώ. Έλεγξε τη σύνδεσή σου.",
      "offline": "Δεν έχεις σύνδεση. Τα ΜΜΜ χρειάζονται σύνδεση.",
      "earlier": "Νωρίτερα", "later": "Αργότερα",
      "min": "λεπ.", "h": "ώ.",
      "transfers0": "Απευθείας", "transfers1": "1 μετεπιβίβαση", "transfersN": "{n} μετεπιβιβάσεις",
      "walk.only": "Με τα πόδια",
      "walk": "Περπάτημα", "walkm": "Περπάτημα {m}", "to.word": "έως",
      "live": "ζωντανά", "late": "+{n} λεπ.", "early": "−{n} λεπ.", "ontime": "στην ώρα του",
      "cancelled": "Ακυρώθηκε",
      "stops.n": "{n} στάσεις", "stops.1": "1 στάση",
      "track": "Αποβάθρα {t}",
      "towards": "προς {h}",
      "arrive": "Άφιξη",
      "share": "Κοινοποίηση", "save": "Αποθήκευση στις Διαδρομές μου",
      "saved": "Αποθηκεύτηκε στις Διαδρομές μου", "save.no": "Δεν ήταν δυνατή η αποθήκευση",
      "copied": "Το δρομολόγιο αντιγράφηκε",
      "board": "Αναχωρήσεις",
      "board.empty": "Καμία αναχώρηση τις επόμενες ώρες.",
      "board.refresh": "Ανανέωση",
      "board.updated": "Ενημέρωση {t}",
      "show.stops": "Στάσεις στον χάρτη (με ζουμ)",
      "show.live": "Οχήματα σε πραγματικό χρόνο",
      "live.hint": "Τα οχήματα κινούνται με βάση τα δρομολόγια και τα ζωντανά δεδομένα, όπου ο φορέας τα δημοσιεύει.",
      "zoom.stops": "Κάνε ζουμ για να δεις στάσεις.",
      "zoom.live": "Απομάκρυνε λίγο τον χάρτη για να δεις οχήματα.",
      "credit": "Δρομολόγια: Transitous και οι ανοιχτές πηγές του",
      "credit.osm": "Δεδομένα χάρτη © OpenStreetMap contributors",
      "beta": "Η κάλυψη εξαρτάται από ανοιχτά δρομολόγια: λεωφορεία, μετρό, τραμ και τρένα σε Αθήνα και Θεσσαλονίκη, Hellenic Train και μεγάλο μέρος της Ευρώπης.",
      "ctx.to": "Με ΜΜΜ ως εδώ",
      "ctx.board": "Αναχωρήσεις κοντά",
      "near.none": "Δεν βρέθηκε στάση κοντά σε αυτό το σημείο.",
      "back": "Πίσω", "close": "Κλείσιμο"
    }
  };
  function t(k, vars) {
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
  function online() { return navigator.onLine !== false; }
  function fmtDur(sec) {
    var m = Math.max(1, Math.round(sec / 60));
    if (m < 60) return m + " " + t("min");
    return Math.floor(m / 60) + " " + t("h") + " " + (m % 60) + " " + t("min");
  }
  function fmtM(m) {
    if (m < 1000) return Math.round(m / 10) * 10 + " m";
    var v = (m / 1000).toFixed(1);
    return (LANG === "el" ? v.replace(".", ",") : v) + " km";
  }
  function transfersText(n) { return n === 0 ? t("transfers0") : n === 1 ? t("transfers1") : t("transfersN", { n: n }); }
  function delayText(d) {
    if (d == null) return "";
    if (d === 0) return t("ontime");
    return d > 0 ? t("late", { n: d }) : t("early", { n: -d });
  }

  // ---------- prefs (device-local) ----------
  function readPrefs() {
    try { return X.normPrefs(JSON.parse(localStorage.getItem(PREFS_KEY) || "null")); }
    catch (e) { return X.normPrefs(null); }
  }
  function writePrefs() {
    try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch (e) { /* a preference */ }
  }
  var prefs = readPrefs();

  // ---------- network (v6, v5 for an older server) ----------
  var verIdx = 0;
  function api(build) {
    var url = build(X.API_VERSIONS[verIdx]);
    if (!url) return Promise.reject(new Error("bad"));
    return fetch(url, { headers: { Accept: "application/json" } }).then(function (r) {
      if (r.status === 404 && verIdx < X.API_VERSIONS.length - 1) { verIdx++; return api(build); }
      if (!r.ok) { var e = new Error("http"); e.status = r.status; throw e; }
      return r.json();
    });
  }
  function errText(e) {
    if (!online()) return t("offline");
    return e && e.status ? t("err") : t("err.net");
  }

  // ---------- state ----------
  var modeOn = false, panel = null, modeBtn = null;
  var view = { v: "plan" };
  var from = null, to = null;      // { lat, lon, name, me? }
  var when = "now", whenAt = null;
  var picking = "";                // "" | "from" | "to"
  var plan = { its: [], prev: "", next: "", busy: false, err: "", asked: false, at: null };
  var planSeq = 0;
  var board = { id: "", name: "", rows: [], busy: false, err: "", next: "", at: 0 };
  var boardSeq = 0, boardTimer = null;

  // ---------- layers ----------
  var itinLayer = L.layerGroup(), stopsLayer = L.layerGroup(), liveLayer = L.layerGroup();
  function lineColor(l) { return "#" + (l.color || X.GROUP_COLOR[l.g] || "6d4aff"); }
  function paintItin(it, fit) {
    itinLayer.clearLayers();
    if (!it) { document.body.classList.remove("trn-itin"); return; }
    document.body.classList.add("trn-itin");
    var bounds = null;
    it.legs.forEach(function (l) {
      var walk = !l.transit;
      if (walk) {
        itinLayer.addLayer(L.polyline(l.pts, { color: "#8a8fa0", weight: 5, opacity: 0.9, dashArray: "2 8", lineCap: "round", className: "trn-leg walk" }));
      } else {
        itinLayer.addLayer(L.polyline(l.pts, { color: "#ffffff", weight: 9, opacity: 0.9, lineCap: "round" }));
        itinLayer.addLayer(L.polyline(l.pts, { color: lineColor(l), weight: 6, opacity: 1, lineCap: "round", className: "trn-leg" }));
        [l.from, l.to].forEach(function (p) {
          itinLayer.addLayer(L.circleMarker([p.lat, p.lon], { radius: 6, color: lineColor(l), weight: 3, fillColor: "#fff", fillOpacity: 1, className: "trn-stop-dot" })
            .bindTooltip(p.name || "", { direction: "top" }));
        });
      }
      var b = L.latLngBounds(l.pts);
      bounds = bounds ? bounds.extend(b) : b;
    });
    var end = it.legs[it.legs.length - 1].to;
    itinLayer.addLayer(L.circleMarker([end.lat, end.lon], { radius: 8, color: "#ffffff", weight: 3, fillColor: "#d9534f", fillOpacity: 1, className: "trn-end" }));
    if (fit && bounds) fitTo(bounds);
  }

  // Zoom to a part of the trip, clear of the sheet (bottom on a
  // phone, right on a wide screen).
  function fitTo(b, maxZoom) {
    var h = panel && !panel.hidden ? panel.offsetHeight : 0, w = panel && !panel.hidden ? panel.offsetWidth : 0;
    var phone = window.innerWidth <= 480;
    map.fitBounds(b, { paddingTopLeft: [40, 70], paddingBottomRight: phone ? [40, h + 30] : [w + 30, 40], maxZoom: maxZoom || 18 });
  }

  // Stops (zoom 15+), refreshed when the map moves.
  var stopsBox = null, stopsSeq = 0;
  function loadStops() {
    if (!modeOn || !prefs.stops) { stopsLayer.clearLayers(); stopsBox = null; return; }
    if (map.getZoom() < STOPS_ZOOM) { stopsLayer.clearLayers(); stopsBox = null; return; }
    var b = map.getBounds();
    if (stopsBox && stopsBox.contains(b)) return;
    if (!online()) return;
    var bb = b.pad(0.25), my = ++stopsSeq;
    var box = { s: bb.getSouth(), w: bb.getWest(), n: bb.getNorth(), e: bb.getEast() };
    api(function (v) { return X.stopsUrl(BASE, v, box, LANG); }).then(function (j) {
      if (my !== stopsSeq || !modeOn) return;
      stopsBox = bb;
      stopsLayer.clearLayers();
      X.normStops(j).forEach(function (s) {
        var mk = L.circleMarker([s.lat, s.lon], { radius: 5, color: "#2c6fbb", weight: 2, fillColor: "#fff", fillOpacity: 1, className: "trn-map-stop" });
        mk.bindTooltip(s.name || "", { direction: "top" });
        mk.on("click", function () { openBoard(s.id, s.name); });
        stopsLayer.addLayer(mk);
      });
    }, function () { /* stops are an extra: stay quiet */ });
  }

  // Live vehicles: segments for the next minutes, moved every 2 s.
  var liveSegs = [], liveSeq = 0, liveAt = 0, liveTick = null, liveFetch = null, liveMarkers = {};
  function loadLive(force) {
    if (!modeOn || !prefs.live || map.getZoom() < LIVE_ZOOM) { clearLive(); return; }
    if (!online()) return;
    if (!force && Date.now() - liveAt < LIVE_MS - 1000) return;
    var b = map.getBounds().pad(0.1), z = map.getZoom(), now = Date.now(), my = ++liveSeq;
    var box = { s: b.getSouth(), w: b.getWest(), n: b.getNorth(), e: b.getEast() };
    var prec = X.tripsPrecision(Math.round(z));
    api(function (v) { return X.tripsUrl(BASE, v, box, z, now, now + LIVE_MS + 60000); }).then(function (j) {
      if (my !== liveSeq || !modeOn || !prefs.live) return;
      liveAt = Date.now();
      liveSegs = X.normTrips(X.withPrecision(j, prec));
      moveLive();
    }, function () { /* an extra: the next tick tries again */ });
  }
  function vehicleIcon(s) {
    var h = el("span", "trn-veh-in");
    h.style.background = "#" + (s.color || X.GROUP_COLOR[s.g] || "4a5a6a");
    h.style.color = "#" + (s.textColor || "ffffff");
    h.textContent = s.name || X.emojiOf(s.mode);
    return L.divIcon({ className: "trn-veh" + (s.rt ? " rt" : ""), html: h, iconSize: null, iconAnchor: [14, 11] });
  }
  function moveLive() {
    if (!modeOn || !prefs.live) return;
    var now = Date.now(), seen = {};
    liveSegs.forEach(function (s, i) {
      var p = X.vehiclePos(s, now);
      if (!p) return;
      var k = s.id || ("s" + i);
      if (seen[k]) return;
      seen[k] = 1;
      var mk = liveMarkers[k];
      if (!mk) {
        mk = liveMarkers[k] = L.marker([p.lat, p.lon], { icon: vehicleIcon(s), keyboard: false, interactive: true });
        mk.bindTooltip((s.name ? s.name + " " : "") + (s.to ? "→ " + s.to : ""), { direction: "top" });
        liveLayer.addLayer(mk);
      } else mk.setLatLng([p.lat, p.lon]);
    });
    Object.keys(liveMarkers).forEach(function (k) {
      if (!seen[k]) { liveLayer.removeLayer(liveMarkers[k]); delete liveMarkers[k]; }
    });
  }
  function clearLive() {
    liveSeq++;
    liveSegs = [];
    liveLayer.clearLayers();
    liveMarkers = {};
  }
  function liveTimers(on) {
    clearInterval(liveTick); clearInterval(liveFetch);
    liveTick = liveFetch = null;
    if (!on) return;
    liveTick = setInterval(moveLive, 2000);
    liveFetch = setInterval(function () { loadLive(true); }, LIVE_MS);
  }

  // ---------- planning ----------
  function placeName(p) { return p ? (p.me ? t("me") : (p.name || (p.lat.toFixed(5) + ", " + p.lon.toFixed(5)))) : t("unset"); }
  function resolveMe(p, cb) {
    if (!p || !p.me) { cb(p); return; }
    H.locate(function (pos) {
      if (!pos) { cb(null); return; }
      cb({ me: true, lat: pos[0], lon: pos[1], name: t("me") });
    });
  }
  function search(cursor) {
    if (!from || !to) { plan.err = t("need"); render(); return; }
    if (!online()) { plan.err = t("offline"); render(); return; }
    var my = ++planSeq;
    plan.busy = true; plan.err = ""; plan.asked = true;
    if (!cursor) { plan.its = []; paintItin(null); }
    render();
    resolveMe(from, function (f) {
      if (my !== planSeq) return;
      if (!f) { plan.busy = false; plan.err = t("noloc"); render(); return; }
      resolveMe(to, function (tt) {
        if (my !== planSeq) return;
        if (!tt) { plan.busy = false; plan.err = t("noloc"); render(); return; }
        var time = when === "now" ? null : whenAt;
        api(function (v) {
          return X.planUrl(BASE, v, { from: f, to: tt, time: time, arriveBy: when === "arrive", cursor: cursor || "", lang: LANG });
        }).then(function (j) {
          if (my !== planSeq) return;
          var p = X.normPlan(j);
          plan.busy = false;
          plan.at = { from: f, to: tt };         // resolved points (share link)
          plan.its = p.its;
          plan.prev = p.prev; plan.next = p.next;
          if (!p.its.length) plan.err = t("none");
          render();
        }, function (e) {
          if (my !== planSeq) return;
          plan.busy = false;
          plan.err = errText(e);
          render();
        });
      });
    });
  }

  // ---------- departures ----------
  function openBoard(id, name) {
    if (!modeOn) setMode(true);
    board = { id: id, name: name || "", rows: [], busy: false, err: "", next: "", at: 0 };
    go({ v: "stop" });
    loadBoard(false);
  }
  function loadBoard(more) {
    if (!board.id) return;
    if (!online()) { board.err = t("offline"); render(); return; }
    var my = ++boardSeq;
    board.busy = true; board.err = "";
    render();
    api(function (v) { return X.stoptimesUrl(BASE, v, { stopId: board.id, n: 20, cursor: more ? board.next : "", lang: LANG }); })
      .then(function (j) {
        if (my !== boardSeq) return;
        var s = X.normStopTimes(j);
        board.busy = false;
        if (s.place && s.place.name) board.name = s.place.name;
        board.rows = more ? board.rows.concat(s.rows) : s.rows;
        board.next = s.next;
        board.at = Date.now();
        render();
      }, function (e) {
        if (my !== boardSeq) return;
        board.busy = false;
        board.err = errText(e);
        render();
      });
  }
  function boardTimerOn(on) {
    clearInterval(boardTimer);
    boardTimer = on ? setInterval(function () { if (view.v === "stop" && panelOpen()) loadBoard(false); }, BOARD_MS) : null;
  }
  // The nearest stop to a point (map/stops around it), then its board.
  function boardNear(lat, lon) {
    if (!online()) { toast(t("offline")); return; }
    var d = 0.004;
    api(function (v) { return X.stopsUrl(BASE, v, { s: lat - d, w: lon - d * 1.3, n: lat + d, e: lon + d * 1.3 }, LANG); })
      .then(function (j) {
        var best = null, bd = Infinity;
        X.normStops(j).forEach(function (s) {
          var dd = map.distance([lat, lon], [s.lat, s.lon]);
          if (dd < bd) { bd = dd; best = s; }
        });
        if (!best) { toast(t("near.none")); return; }
        openBoard(best.id, best.name);
      }, function (e) { toast(errText(e)); });
  }

  // ---------- panel ----------
  function panelOpen() { return modeOn && panel && !panel.hidden; }
  function setH() {
    var h = 0;
    document.querySelectorAll(".osm-sheet").forEach(function (s) { if (!s.hidden) h = Math.max(h, s.offsetHeight); });
    document.body.style.setProperty("--osm-h", h + "px");
  }
  function header(title, back) {
    var h = el("header", "");
    if (back) {
      var b = button("", "osm-iconbtn", back);
      b.setAttribute("aria-label", t("back")); b.title = t("back");
      b.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg>';
      h.appendChild(b);
    }
    h.appendChild(el("h3", "", title));
    var c = button("", "osm-iconbtn osm-close", function () { setMode(false); });
    c.setAttribute("aria-label", t("close")); c.title = t("close");
    c.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>';
    h.appendChild(c);
    return h;
  }
  function go(r) {
    view = r;
    boardTimerOn(r.v === "stop");
    if (r.v !== "itin") paintItin(null);
    render();
  }
  function render() {
    if (!panelOpen()) return;
    panel.textContent = "";
    if (view.v === "itin" && plan.its[view.i]) renderItin(plan.its[view.i]);
    else if (view.v === "stop") renderBoard();
    else { view = { v: "plan" }; renderPlan(); }
    setH();
  }
  function credit(body) {
    var c = el("p", "osm-small trn-credit");
    var a = el("a", "", t("credit"));
    a.href = X.SOURCES_URL; a.target = "_blank"; a.rel = "noopener noreferrer";
    c.appendChild(a);
    c.appendChild(document.createTextNode(" · " + t("credit.osm")));
    body.appendChild(c);
  }
  function badge(l) {
    var b = el("span", "trn-badge g-" + l.g, (X.emojiOf(l.mode) + " " + (l.line || "")).trim());
    if (l.color) { b.style.background = "#" + l.color; b.style.color = "#" + l.textColor; b.classList.add("colored"); }
    return b;
  }

  var ICON_ME = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/></svg>';
  var ICON_PICK = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 21s-6-5.5-6-11a6 6 0 0 1 12 0c0 5.5-6 11-6 11z"/><circle cx="12" cy="10" r="2"/></svg>';
  var ICON_SWAP = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 4v16"/><path d="M3 8l4-4 4 4"/><path d="M17 20V4"/><path d="M13 16l4 4 4-4"/></svg>';
  function iconBtn(svg, label, cls, fn) {
    var b = button("", "osm-iconbtn trn-ib" + (cls ? " " + cls : ""), fn);
    b.innerHTML = svg;
    b.title = label;
    b.setAttribute("aria-label", label);
    return b;
  }
  function pointRow(which) {
    var p = which === "from" ? from : to;
    var row = el("div", "trn-pt");
    row.appendChild(el("span", "trn-pt-l", t(which)));
    var val = el("span", "trn-pt-v" + (p ? "" : " unset"), picking === which ? t("picking") : placeName(p));
    val.id = "trn-" + which;
    row.appendChild(val);
    row.appendChild(iconBtn(ICON_ME, t("me"), "trn-me", function () {
      if (which === "from") from = { me: true, name: t("me") }; else to = { me: true, name: t("me") };
      picking = ""; changed();
    }));
    var pk = iconBtn(ICON_PICK, t("pick"), picking === which ? "on" : "", function () {
      picking = picking === which ? "" : which;
      if (picking) toast(t("pick.hint"));
      render();
    });
    pk.setAttribute("data-pick", which);
    pk.setAttribute("aria-pressed", picking === which ? "true" : "false");
    row.appendChild(pk);
    return row;
  }
  // Points without a name (shared link, map pick) get one from the
  // geocoder when it answers; the coordinates show until then.
  function nameLater(p) {
    if (p && !p.me && !p.name && H.reverseName) H.reverseName(p, function () { render(); });
  }
  function changed() {
    plan.its = []; plan.err = ""; plan.asked = false; plan.prev = plan.next = "";
    paintItin(null);
    render();
    if (from && to) search("");
  }

  function renderPlan() {
    panel.appendChild(header(t("title")));
    var body = el("div", "osm-body trn-body");
    body.appendChild(pointRow("from"));
    body.appendChild(pointRow("to"));
    var w = el("div", "trn-when");
    w.appendChild(iconBtn(ICON_SWAP, t("swap"), "trn-swap", function () { var x = from; from = to; to = x; changed(); }));
    var sel = el("select", "osm-in trn-when-sel");
    sel.setAttribute("aria-label", t("when.label"));
    X.TIME_MODES.forEach(function (m) {
      var o = el("option", "", t("when." + m)); o.value = m; o.selected = m === when; sel.appendChild(o);
    });
    var inp = el("input", "osm-in trn-when-at");
    inp.type = "datetime-local";
    inp.setAttribute("aria-label", t("when.label"));
    inp.hidden = when === "now";
    inp.value = X.toLocalInput(whenAt || Date.now());
    sel.addEventListener("change", function () {
      when = X.TIME_MODES.indexOf(sel.value) >= 0 ? sel.value : "now";
      if (when !== "now" && whenAt == null) whenAt = X.fromLocalInput(inp.value);
      inp.hidden = when === "now";
      setH();
    });
    inp.addEventListener("change", function () { var v = X.fromLocalInput(inp.value); if (v != null) whenAt = v; });
    w.appendChild(sel); w.appendChild(inp);
    body.appendChild(w);
    var ends = H.routeEnds ? H.routeEnds() : null;
    if (ends && ends.to) body.appendChild(button(t("plan.pts"), "osm-mini trn-ends", function () { useEnds(ends); }));
    var find = button(plan.busy ? t("finding") : t("find"), "osm-btn primary trn-find", function () { search(""); });
    find.disabled = plan.busy;
    body.appendChild(find);

    if (plan.err) body.appendChild(el("p", "osm-hint trn-msg", plan.err));
    else if (!from || !to) body.appendChild(el("p", "osm-hint trn-msg", t("need")));

    if (plan.its.length) {
      if (plan.prev) body.appendChild(button(t("earlier"), "osm-mini trn-more", function () { search(plan.prev); }));
      var ul = el("ul", "osm-list trn-its");
      plan.its.forEach(function (it, i) {
        var li = el("li", "osm-row trn-it" + (it.cancelled ? " cancelled" : ""));
        li.tabIndex = 0;
        li.setAttribute("role", "button");
        var top = el("div", "trn-it-top");
        top.appendChild(el("b", "", X.hhmm(it.t0) + " → " + X.hhmm(it.t1)));
        top.appendChild(el("span", "trn-it-dur", fmtDur(it.dur)));
        li.appendChild(top);
        var chips = el("div", "trn-chips");
        it.legs.forEach(function (l) {
          if (l.transit) chips.appendChild(badge(l));
          else if (l.dur >= 60 || it.direct) chips.appendChild(el("span", "trn-walk", X.emojiOf(l.mode) + " " + Math.round(l.dur / 60)));
        });
        li.appendChild(chips);
        var first = it.legs.filter(function (l) { return l.transit; })[0];
        var meta = [it.direct ? t("walk.only") : transfersText(it.transfers)];
        if (it.walk) meta.push(t("walkm", { m: fmtM(it.walk) }));
        if (first) {
          meta.push(X.hhmm(first.t0) + " " + first.from.name);
          var dl = first.rt ? X.delayMin(first.t0, first.s0) : null;
          if (dl != null) meta.push(delayText(dl));
        }
        if (it.cancelled) meta.push(t("cancelled"));
        li.appendChild(el("div", "osm-row-s", meta.join(" · ")));
        function openIt() { go({ v: "itin", i: i }); paintItin(it, true); }
        li.addEventListener("click", openIt);
        li.addEventListener("keydown", function (e) { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openIt(); } });
        ul.appendChild(li);
      });
      body.appendChild(ul);
      if (plan.next) body.appendChild(button(t("later"), "osm-mini trn-more", function () { search(plan.next); }));
    }

    var tg = el("div", "trn-toggles");
    tg.appendChild(check(t("show.stops"), prefs.stops, function (on) { prefs.stops = on ? 1 : 0; writePrefs(); loadStops(); }, "trn-stops-cb"));
    tg.appendChild(check(t("show.live"), prefs.live, function (on) {
      prefs.live = on ? 1 : 0; writePrefs();
      liveTimers(!!on && modeOn);
      if (on) loadLive(true); else clearLive();
      render();
    }, "trn-live-cb"));
    if (prefs.live) tg.appendChild(el("p", "osm-small", map.getZoom() < LIVE_ZOOM ? t("zoom.live") : t("live.hint")));
    body.appendChild(tg);
    body.appendChild(el("p", "osm-small", t("beta")));
    credit(body);
    panel.appendChild(body);
  }
  function check(label, on, fn, id) {
    var lab = el("label", "trn-check");
    var cb = el("input", "");
    cb.type = "checkbox"; cb.checked = !!on; cb.id = id;
    cb.addEventListener("change", function () { fn(cb.checked); });
    lab.appendChild(cb);
    lab.appendChild(el("span", "", label));
    return lab;
  }

  function renderItin(it) {
    panel.appendChild(header(X.hhmm(it.t0) + " → " + X.hhmm(it.t1) + " · " + fmtDur(it.dur), function () { go({ v: "plan" }); }));
    var body = el("div", "osm-body trn-body");
    body.appendChild(el("p", "osm-small", (it.direct ? t("walk.only") : transfersText(it.transfers)) +
      (it.walk ? " · " + t("walkm", { m: fmtM(it.walk) }) : "")));
    var ol = el("ol", "trn-legs");
    it.legs.forEach(function (l) {
      var li = el("li", "trn-leg-row" + (l.transit ? " transit" : " walk") + (l.cancelled ? " cancelled" : ""));
      li.style.setProperty("--leg", lineColor(l));
      var time = el("div", "trn-leg-time");
      time.appendChild(el("b", "", X.hhmm(l.t0)));
      if (l.rt && l.transit) {
        var d = X.delayMin(l.t0, l.s0);
        var s = el("span", "trn-rt" + (d > 0 ? " late" : ""), delayText(d) || t("live"));
        time.appendChild(s);
      }
      li.appendChild(time);
      var main = el("div", "trn-leg-main");
      if (l.transit) {
        var hd = el("div", "trn-leg-head");
        hd.appendChild(badge(l));
        if (l.headsign) hd.appendChild(el("span", "trn-leg-hs", t("towards", { h: l.headsign })));
        main.appendChild(hd);
        var st = button(l.from.name + (l.from.track ? " · " + t("track", { t: l.from.track }) : ""), "trn-stopbtn", function () {
          if (l.from.stopId) openBoard(l.from.stopId, l.from.name);
        });
        st.disabled = !l.from.stopId;
        main.appendChild(st);
        var n = l.stops.length;
        main.appendChild(el("div", "osm-row-s", (n ? (n === 1 ? t("stops.1") : t("stops.n", { n: n })) + " · " : "") + fmtDur(l.dur) +
          (l.agency ? " · " + l.agency : "")));
        main.appendChild(el("div", "trn-leg-to", X.hhmm(l.t1) + " " + l.to.name + (l.to.track ? " · " + t("track", { t: l.to.track }) : "")));
        if (l.cancelled) main.appendChild(el("div", "trn-cancel", t("cancelled")));
      } else {
        main.appendChild(el("div", "trn-leg-head", X.emojiOf(l.mode) + " " + t("walk") + " " + fmtDur(l.dur) +
          (l.dist ? " · " + fmtM(l.dist) : "")));
        if (l.to.name) main.appendChild(el("div", "osm-row-s", t("to.word") + " " + l.to.name));
      }
      li.appendChild(main);
      li.addEventListener("click", function (e) {
        if (e.target.closest && e.target.closest("button")) return;
        fitTo(L.latLngBounds(l.pts), 17);
      });
      ol.appendChild(li);
    });
    var end = el("li", "trn-leg-row end");
    var et = el("div", "trn-leg-time");
    et.appendChild(el("b", "", X.hhmm(it.t1)));
    end.appendChild(et);
    end.appendChild(el("div", "trn-leg-main", t("arrive") + (to ? " · " + placeName(to) : "")));
    ol.appendChild(end);
    body.appendChild(ol);

    var row = el("div", "osm-actions");
    row.appendChild(button(t("share"), "osm-btn trn-share", function () { shareItin(it); }));
    row.appendChild(button(t("save"), "osm-btn trn-save", function () { saveItin(it); }));
    body.appendChild(row);
    credit(body);
    panel.appendChild(body);
  }
  function itinName(it) {
    return (from ? placeName(from) : "") + " → " + (to ? placeName(to) : "") + " " + X.hhmm(it.t0);
  }
  function shareItin(it) {
    var txt = X.itinText(it, { walk: t("walk"), min: t("min"), to: t("to.word") });
    var link = H.transitLink && plan.at ? H.transitLink(plan.at.from, { lat: plan.at.to.lat, lon: plan.at.to.lon, name: to && to.name || "" }) : "";
    var all = itinName(it) + "\n" + txt + (link ? "\n" + link : "");
    if (navigator.share) {
      navigator.share({ title: itinName(it), text: all }).catch(function () {});
      return;
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(all).then(function () { toast(t("copied")); }, function () { toast(t("save.no")); });
    }
  }
  function saveItin(it) {
    var apiT = window.__orosMapsTracks, T = window.OrosMapsTracks;
    var tr = X.itinTrack(it, itinName(it));
    if (!apiT || !T || typeof apiT.importText !== "function" || !tr) { toast(t("save.no")); return; }
    Promise.resolve(apiT.importText(T.writeGpx(tr), "transit.gpx")).then(function (e) {
      toast(t(e ? "saved" : "save.no"));
    }, function () { toast(t("save.no")); });
  }

  function renderBoard() {
    panel.appendChild(header(board.name || t("board"), function () { go({ v: "plan" }); }));
    var body = el("div", "osm-body trn-body");
    var top = el("div", "trn-row");
    top.appendChild(el("span", "osm-small", board.at ? t("board.updated", { t: X.hhmm(board.at) }) : ""));
    top.appendChild(button(t("board.refresh"), "osm-mini trn-refresh", function () { loadBoard(false); }));
    body.appendChild(top);
    if (board.err) body.appendChild(el("p", "osm-hint trn-msg", board.err));
    else if (board.busy && !board.rows.length) body.appendChild(el("p", "osm-hint trn-msg", t("finding")));
    else if (!board.rows.length) body.appendChild(el("p", "osm-hint trn-msg", t("board.empty")));
    var ul = el("ul", "osm-list trn-board");
    board.rows.forEach(function (r) {
      var li = el("li", "trn-dep" + (r.cancelled ? " cancelled" : ""));
      var tm = el("span", "trn-dep-t");
      tm.appendChild(el("b", "", X.hhmm(r.t)));
      if (r.rt) {
        var d = X.delayMin(r.t, r.sched);
        tm.appendChild(el("span", "trn-rt" + (d > 0 ? " late" : ""), d ? delayText(d) : t("live")));
      }
      li.appendChild(tm);
      li.appendChild(badge(r));
      var hs = el("span", "trn-dep-h", r.headsign || "");
      li.appendChild(hs);
      if (r.track) li.appendChild(el("span", "trn-dep-tr", r.track));
      if (r.cancelled) li.appendChild(el("span", "trn-cancel", t("cancelled")));
      ul.appendChild(li);
    });
    body.appendChild(ul);
    if (board.next && board.rows.length) body.appendChild(button(t("later"), "osm-mini trn-more", function () { loadBoard(true); }));
    credit(body);
    panel.appendChild(body);
  }

  // ---------- map picks ----------
  map.on("click", function (e) {
    if (!modeOn || !picking || !e || !e.latlng) return;
    var p = { lat: e.latlng.lat, lon: e.latlng.lng, name: "" };
    if (picking === "from") from = p; else to = p;
    picking = "";
    nameLater(p);
    changed();
  });
  function useEnds(ends) {
    function copy(p) {
      if (!p) return null;
      if (p.me) return { me: true, name: t("me") };
      return isFinite(p.lat) && isFinite(p.lon) ? { lat: p.lat, lon: p.lon, name: p.name || "" } : null;
    }
    from = copy(ends.from) || { me: true, name: t("me") };
    to = copy(ends.to);
    changed();
  }

  // ---------- mode ----------
  window.addEventListener("oros-maps-mode", function (e) {
    if (modeOn && e.detail !== "transit") setMode(false);
  });
  function setMode(on) {
    if (on && !modeOn) {
      try { window.dispatchEvent(new CustomEvent("oros-maps-mode", { detail: "transit" })); } catch (e) {}
    }
    modeOn = !!on;
    document.body.classList.toggle("osm-mode", modeOn);
    if (modeBtn) { modeBtn.classList.toggle("on", modeOn); modeBtn.setAttribute("aria-pressed", modeOn ? "true" : "false"); }
    if (modeOn) {
      itinLayer.addTo(map); stopsLayer.addTo(map); liveLayer.addTo(map);
      panel.hidden = false;
      if (!from) from = { me: true, name: t("me") };
      loadStops();
      liveTimers(!!prefs.live);
      if (prefs.live) loadLive(true);
      render();
    } else {
      picking = "";
      paintItin(null);
      map.removeLayer(itinLayer); map.removeLayer(stopsLayer); map.removeLayer(liveLayer);
      stopsLayer.clearLayers(); stopsBox = null; clearLive();
      liveTimers(false); boardTimerOn(false);
      planSeq++; boardSeq++;
      plan.busy = false; board.busy = false;
      view = { v: "plan" };
      panel.hidden = true;
      document.body.classList.toggle("osm-mode", document.querySelectorAll(".osm-sheet:not([hidden])").length > 0);
    }
    setH();
  }
  // From the route bar, a shared link or the long-press menu.
  function openWith(f, tt) {
    from = f && (f.me || (isFinite(f.lat) && isFinite(f.lon))) ? (f.me ? { me: true, name: t("me") } : { lat: f.lat, lon: f.lon, name: f.name || "" }) : { me: true, name: t("me") };
    to = tt && isFinite(tt.lat) && isFinite(tt.lon) ? { lat: tt.lat, lon: tt.lon, name: tt.name || "" } : null;
    nameLater(from); nameLater(to);
    if (!modeOn) setMode(true);
    view = { v: "plan" };
    changed();
  }

  var moveTimer = null;
  map.on("moveend", function () {
    if (!modeOn) return;
    clearTimeout(moveTimer);
    moveTimer = setTimeout(function () {
      loadStops();
      if (prefs.live) { loadLive(true); if (view.v === "plan") render(); }
    }, 400);
  });

  var ICON = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="3" width="14" height="14" rx="3"/><path d="M5 11h14"/><path d="M8 21l2-4"/><path d="M16 21l-2-4"/><circle cx="8.5" cy="14" r="0.6" fill="currentColor"/><circle cx="15.5" cy="14" r="0.6" fill="currentColor"/></svg>';
  function boot() {
    panel = el("aside", "osm-sheet trn-sheet");
    panel.id = "trn-panel";
    panel.hidden = true;
    panel.setAttribute("aria-label", t("title"));
    document.body.appendChild(panel);
    try { new ResizeObserver(setH).observe(panel); } catch (e) {}
    var controls = document.getElementById("controls");
    if (controls) {
      modeBtn = el("button", "");
      modeBtn.id = "trn-btn";
      modeBtn.type = "button";
      modeBtn.title = t("btn");
      modeBtn.setAttribute("aria-label", t("btn"));
      modeBtn.setAttribute("aria-pressed", "false");
      modeBtn.innerHTML = ICON;
      modeBtn.addEventListener("click", function () { setMode(!modeOn); });
      controls.insertBefore(modeBtn, document.getElementById("plan-btn") ? document.getElementById("plan-btn").nextSibling : null);
    }
    if (Array.isArray(H.ctxItems)) {
      H.ctxItems.push(function (place) {
        return { icon: ICON.replace(/18/g, "14"), label: t("ctx.to"), run: function () { openWith({ me: true }, place); } };
      });
      H.ctxItems.push(function (place) {
        return { icon: ICON.replace(/18/g, "14"), label: t("ctx.board"), run: function () { boardNear(place.lat, place.lon); } };
      });
    }
    H.openTransit = openWith;
    if (H.pendingTransit) { var p = H.pendingTransit; H.pendingTransit = null; openWith(p.from, p.to); }
  }

  window.__orosMapsTransit = {
    open: openWith, close: function () { setMode(false); }, setMode: setMode,
    board: openBoard, boardNear: boardNear, search: search,
    state: function () {
      return { on: modeOn, view: view.v, from: from, to: to, its: plan.its.length, err: plan.err,
        board: board.rows.length, stops: stopsLayer.getLayers().length, live: liveLayer.getLayers().length, ver: X.API_VERSIONS[verIdx] };
    }
  };
  boot();
})();
