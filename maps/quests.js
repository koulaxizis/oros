// ============================================================
// orOS Maps — quests.js (StreetComplete-style quests, OSM upgrade
// wave 5, v1.0.0)
// "Quests" mode: at zoom ≥ 17 small questions about the things
// around you appear as pins (Overpass, quests-core.js): is this bench
// backed, is the street lit, when is this shop open… One tap answers;
// no tags to know. Answers wait in the synced slice "mapsquests" and
// go up only with Upload: one changeset per quest type, with the
// upload comment (default "Uploaded using orOS Maps"), source=survey
// and orOS:quest_type=<quest>. Each element is fetched again and the
// answer is rebased on its current tags first (poi-core.js).
//
// "Can't say" skips a quest for this session, "Hide here" hides it for
// that element on every device, "It's not there any more" opens a new
// OSM note at the spot. Settings turn quest types on or off. A counter
// shows your answers (total, today, days in a row).
//
// Safety: OSM tags go on the page with textContent only.
// ============================================================
(function () {
  "use strict";
  var O = window.OrosMapsOSM;
  var P = window.OrosMapsPoi;
  var Q = window.OrosMapsQuests;
  var A = window.OrosMapsApi;
  var H = window.__orosMapsHost;
  var V = window.OrosMapsOverlays;      // maps wave 8B (may be missing: overlays off)
  if (!O || !P || !Q || !A || !H || !H.map) return;
  var map = H.map;
  var LANG = window.orosI18n ? window.orosI18n.lang() : (H.lang === "el" ? "el" : "en");
  var OVERPASS = "https://overpass-api.de/api/interpreter";

  var STR = {
    en: {
      "qst.btn": "Quests", "qst.title": "Quests",
      "qst.zoomin": "Zoom in closer to see the quests around you.",
      "qst.zoomgo": "Zoom in",
      "qst.loading": "Looking for quests…", "qst.loadfail": "Could not load the area. Try again later.",
      "qst.none": "No quests here. Move the map or turn more quests on in Settings.",
      "qst.count": "{n} quests here",
      "qst.stats": "Your answers: {a} · today {b} · {c} days in a row",
      "qst.pending": "{n} answers waiting to be uploaded",
      "qst.other": "From another device (it uploads them)",
      "qst.upload": "Upload {n}",
      "qst.settings": "Settings",
      "qst.set.title": "Which quests to show",
      "qst.set.all": "All on",
      "qst.skip": "Can't say", "qst.hide": "Hide here", "qst.gone": "It's not there any more",
      "qst.same": "Still the same",
      "qst.recheck": "Last checked {d}: {v}. Is it still right?",
      "qst.hours.ph": "e.g. Mo-Fr 09:00-17:00; Sa 10:00-14:00",
      "qst.hours.247": "Open 24/7", "qst.hours.none": "No hours posted", "qst.hours.none.ct": "No times posted", "qst.hours.save": "Save",
      "qst.hours.hint": "Days Mo Tu We Th Fr Sa Su, times 24-hour, groups separated by ;",
      "qst.number.save": "Save", "qst.text.save": "Save", "qst.multi.save": "Save",
      "qst.bad": "That answer doesn't look right. Check it and try again.",
      "qst.saved": "Saved. Upload when you're done.",
      "qst.unnamed": "this place", "qst.unnamed.way": "this street", "qst.unnamed.b": "this building",
      "qst.back": "Back", "qst.close": "Close", "qst.cancel": "Cancel", "qst.del": "Remove",
      "qst.note.text": "{q}: it is not there any more.",
      "qst.up.title": "Upload to OpenStreetMap",
      "qst.up.comment": "Comment",
      "qst.up.count": "{n} answers from this device will be published under your OpenStreetMap name.",
      "qst.up.go": "Upload",
      "qst.up.ok": "Uploaded {n} answers to OpenStreetMap",
      "qst.up.conflict": "Someone else changed these meanwhile, their value was kept: {k}",
      "qst.up.fail": "Upload failed: {e}",
      "qst.up.gone": "It no longer exists on OpenStreetMap",
      "qst.up.signin": "Sign in with OpenStreetMap to upload",
      "qst.up.offline": "You are offline. Your answers are kept.",
      "qst.leave": "{n} answers are waiting to be uploaded",
      "qst.name.save": "Save", "qst.name.ph": "As written on the sign",
      "qst.ovl": "Overlay", "qst.ovl.off": "None (show quests)",
      "qst.ovl.hint.line": "Tap a street to change it.", "qst.ovl.hint.area": "Tap a building to change it.",
      "qst.ovl.zoom": "Zoom in closer to see the overlay.",
      "qst.ovl.loading": "Loading the overlay…",
      "qst.ovl.count": "{n} here, {m} not known yet",
      "qst.ovl.pins": "Quest pins are hidden while an overlay is on.",
      "qst.ovl.now": "Now: {v}", "qst.ovl.unknown": "not known yet",
      "qst.ovl.arrows": "Left and right are seen walking in the direction of the arrows on the map.",
      "qst.ovl.same": "That is already on the map.",
      "qst.ovl.levels": "Floors above ground", "qst.ovl.kind": "Kind of building", "qst.ovl.kind.keep": "Keep as it is",
      "qst.badges": "Achievements", "qst.badges.title": "Your achievements",
      "qst.badge.lv": "Level {l} · {n} answers", "qst.badge.next": "{n} more for the next level", "qst.badge.max": "Top level reached",
      "qst.badge.none": "Answer quests and upload them to earn achievements. Each level unlocks a page to learn more.",
      "qst.badge.new": "New achievement: {c}, level {l}",
      "qst.badge.links": "Unlocked reading",
      "qst.team": "Team mapping",
      "qst.team.hint": "Map an area with friends without answering the same things: everyone picks the same team size and a different letter. Each of you then sees only your share of the quests.",
      "qst.team.size": "People in the team", "qst.team.solo": "Just me", "qst.team.me": "My letter",
      "qst.team.on": "Team of {n}, you are {l}: you see your share of the quests"
    },
    el: {
      "qst.btn": "Ερωτήσεις", "qst.title": "Ερωτήσεις",
      "qst.zoomin": "Πλησίασε περισσότερο για να δεις τις ερωτήσεις γύρω σου.",
      "qst.zoomgo": "Μεγέθυνση",
      "qst.loading": "Ψάχνω ερωτήσεις…", "qst.loadfail": "Η περιοχή δεν φόρτωσε. Δοκίμασε αργότερα.",
      "qst.none": "Καμία ερώτηση εδώ. Μετακίνησε τον χάρτη ή άνοιξε κι άλλες στις Ρυθμίσεις.",
      "qst.count": "{n} ερωτήσεις εδώ",
      "qst.stats": "Οι απαντήσεις σου: {a} · σήμερα {b} · {c} μέρες στη σειρά",
      "qst.pending": "{n} απαντήσεις περιμένουν αποστολή",
      "qst.other": "Από άλλη συσκευή (εκείνη τις στέλνει)",
      "qst.upload": "Αποστολή {n}",
      "qst.settings": "Ρυθμίσεις",
      "qst.set.title": "Ποιες ερωτήσεις να φαίνονται",
      "qst.set.all": "Όλες ανοιχτές",
      "qst.skip": "Δεν ξέρω", "qst.hide": "Κρύψε εδώ", "qst.gone": "Δεν υπάρχει πια",
      "qst.same": "Ισχύει ακόμα",
      "qst.recheck": "Ελέγχθηκε {d}: {v}. Ισχύει ακόμα;",
      "qst.hours.ph": "π.χ. Mo-Fr 09:00-17:00; Sa 10:00-14:00",
      "qst.hours.247": "Ανοιχτό 24/7", "qst.hours.none": "Δεν αναγράφεται ωράριο", "qst.hours.none.ct": "Δεν αναγράφονται ώρες", "qst.hours.save": "Αποθήκευση",
      "qst.hours.hint": "Μέρες Mo Tu We Th Fr Sa Su (Δευ–Κυρ), ώρες 24ωρες, ομάδες χωρισμένες με ;",
      "qst.number.save": "Αποθήκευση", "qst.text.save": "Αποθήκευση", "qst.multi.save": "Αποθήκευση",
      "qst.bad": "Η απάντηση δεν φαίνεται σωστή. Έλεγξέ τη και δοκίμασε ξανά.",
      "qst.saved": "Αποθηκεύτηκε. Στείλε όταν τελειώσεις.",
      "qst.unnamed": "αυτό το μέρος", "qst.unnamed.way": "αυτός ο δρόμος", "qst.unnamed.b": "αυτό το κτίριο",
      "qst.back": "Πίσω", "qst.close": "Κλείσιμο", "qst.cancel": "Άκυρο", "qst.del": "Αφαίρεση",
      "qst.note.text": "{q}: δεν υπάρχει πια.",
      "qst.up.title": "Αποστολή στο OpenStreetMap",
      "qst.up.comment": "Σχόλιο",
      "qst.up.count": "{n} απαντήσεις από αυτή τη συσκευή θα δημοσιευτούν με το όνομά σου στο OpenStreetMap.",
      "qst.up.go": "Αποστολή",
      "qst.up.ok": "Στάλθηκαν {n} απαντήσεις στο OpenStreetMap",
      "qst.up.conflict": "Κάποιος άλλος τα άλλαξε στο μεταξύ και κρατήθηκε η δική του τιμή: {k}",
      "qst.up.fail": "Η αποστολή απέτυχε: {e}",
      "qst.up.gone": "Δεν υπάρχει πια στο OpenStreetMap",
      "qst.up.signin": "Συνδέσου με OpenStreetMap για αποστολή",
      "qst.up.offline": "Δεν έχεις σύνδεση. Οι απαντήσεις σου κρατιούνται.",
      "qst.leave": "{n} απαντήσεις περιμένουν αποστολή",
      "qst.name.save": "Αποθήκευση", "qst.name.ph": "Όπως γράφει η πινακίδα",
      "qst.ovl": "Επικάλυψη", "qst.ovl.off": "Καμία (δείξε τις ερωτήσεις)",
      "qst.ovl.hint.line": "Πάτα έναν δρόμο για να τον αλλάξεις.", "qst.ovl.hint.area": "Πάτα ένα κτίριο για να το αλλάξεις.",
      "qst.ovl.zoom": "Πλησίασε περισσότερο για να δεις την επικάλυψη.",
      "qst.ovl.loading": "Φόρτωση της επικάλυψης…",
      "qst.ovl.count": "{n} εδώ, {m} άγνωστα ακόμα",
      "qst.ovl.pins": "Οι καρφίτσες των ερωτήσεων κρύβονται όσο είναι ανοιχτή μια επικάλυψη.",
      "qst.ovl.now": "Τώρα: {v}", "qst.ovl.unknown": "άγνωστο ακόμα",
      "qst.ovl.arrows": "Αριστερά και δεξιά όπως τα βλέπεις περπατώντας προς την κατεύθυνση των βελών στον χάρτη.",
      "qst.ovl.same": "Αυτό υπάρχει ήδη στον χάρτη.",
      "qst.ovl.levels": "Όροφοι πάνω από το έδαφος", "qst.ovl.kind": "Είδος κτιρίου", "qst.ovl.kind.keep": "Να μείνει όπως είναι",
      "qst.badges": "Επιτεύγματα", "qst.badges.title": "Τα επιτεύγματά σου",
      "qst.badge.lv": "Επίπεδο {l} · {n} απαντήσεις", "qst.badge.next": "Ακόμα {n} για το επόμενο επίπεδο", "qst.badge.max": "Έφτασες στο ανώτερο επίπεδο",
      "qst.badge.none": "Απάντησε σε ερωτήσεις και στείλ' τες για να κερδίσεις επιτεύγματα. Κάθε επίπεδο ξεκλειδώνει μια σελίδα για να μάθεις περισσότερα.",
      "qst.badge.new": "Νέο επίτευγμα: {c}, επίπεδο {l}",
      "qst.badge.links": "Ξεκλείδωτο διάβασμα",
      "qst.team": "Ομαδική χαρτογράφηση",
      "qst.team.hint": "Χαρτογραφήστε μια περιοχή με φίλους χωρίς να απαντάτε στα ίδια: όλοι διαλέγετε το ίδιο μέγεθος ομάδας και διαφορετικό γράμμα. Ο καθένας βλέπει μόνο το δικό του μερίδιο ερωτήσεων.",
      "qst.team.size": "Άτομα στην ομάδα", "qst.team.solo": "Μόνο εγώ", "qst.team.me": "Το γράμμα μου",
      "qst.team.on": "Ομάδα {n} ατόμων, είσαι το {l}: βλέπεις το δικό σου μερίδιο"
    }
  };
  if (window.orosI18n) window.orosI18n.table(STR, "maps", LANG);
  function loc() { return window.orosI18n ? window.orosI18n.locale(LANG) : (loc()); }
  function t(k, vars) {
    k = "qst." + k;
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

  // ---------- synced slice "mapsquests" ----------
  var DATA_KEY = "oros-maps-quests-data";
  var data = Q.normalize(null);
  var suppress = false;
  function syncApi() {
    try { return (window.parent && window.parent.orosSync) || window.orosSync || null; }
    catch (e) { return window.orosSync || null; }
  }
  function loadData() {
    var raw = null;
    try { raw = localStorage.getItem(DATA_KEY); } catch (e) {}
    if (!raw) return;
    try { data = Q.normalize(JSON.parse(raw)); }
    catch (e) { try { localStorage.setItem("oros-maps-quests-rescue", raw); } catch (e2) {} }
  }
  function saveData() {
    data = Q.normalize(data);
    try { localStorage.setItem(DATA_KEY, JSON.stringify(data)); }
    catch (e) { toast(H.storeFull || "Storage is full"); return false; }
    if (!suppress) { var api = syncApi(); if (api && api.markDirty) api.markDirty(); }
    return true;
  }
  // ---------- synced slice "mapsqstats" (maps wave 8) ----------
  var STATS_KEY = "oros-maps-qstats-data";
  var stats = Q.normStats(null);
  function loadStats() {
    var raw = null;
    try { raw = localStorage.getItem(STATS_KEY); } catch (e) {}
    if (!raw) return;
    try { stats = Q.normStats(JSON.parse(raw)); }
    catch (e) { try { localStorage.setItem("oros-maps-qstats-rescue", raw); } catch (e2) {} }
  }
  function saveStats() {
    stats = Q.normStats(stats);
    try { localStorage.setItem(STATS_KEY, JSON.stringify(stats)); }
    catch (e) { toast(H.storeFull || "Storage is full"); return false; }
    if (!suppress) { var api = syncApi(); if (api && api.markDirty) api.markDirty(); }
    return true;
  }
  function statsGet() { return Q.normStats(stats); }
  function statsSet(d) {
    if (!d || typeof d !== "object") return;
    stats = Q.normStats(JSON.parse(JSON.stringify(d)));
    suppress = true;
    try { localStorage.setItem(STATS_KEY, JSON.stringify(stats)); } catch (e) {}
    suppress = false;
    paint();
    if (panelOpen()) render();
  }
  function letter(i) { return String.fromCharCode(65 + i); }

  function sliceGet() { return Q.normalize(data); }
  function sliceSet(d) {
    if (!d || typeof d !== "object") return;
    data = Q.normalize(JSON.parse(JSON.stringify(d)));
    suppress = true;
    try { localStorage.setItem(DATA_KEY, JSON.stringify(data)); } catch (e) {}
    suppress = false;
    paint();
    if (panelOpen()) render();
  }
  function newId() { return O.randomString(14).toLowerCase().replace(/[^a-z0-9]/g, "0"); }
  function stamp(x) { x.m = Math.max(Date.now(), (x.m || 0) + 1); }
  function answers() {
    return Object.keys(data.answers).map(function (k) { return data.answers[k]; })
      .sort(function (a, b) { return a.m - b.m || (a.id < b.id ? -1 : 1); });
  }
  function mine() {
    var me = A.deviceId(), srv = A.server();
    return answers().filter(function (a) { return a.dev === me && a.srv === srv && !a.err; });
  }
  function dropAnswer(id) {
    var a = data.answers[id];
    if (!a) return;
    delete data.answers[id];
    data.tombs[id] = Math.max(Date.now(), a.m + 1);
    saveData();
  }

  // ---------- elements (Overpass cache, device memory) ----------
  var els = {};                  // "n123" → { t, id, lat, lon, tags, ts }
  var box = null, boxAt = 0, busy = false, failed = false, boxOff = "";
  var MIN_ZOOM = 17, FRESH_MS = 30 * 60 * 1000;
  var skipped = {};              // "n123:qid" → 1 (this session)

  // Elements as the user sees them: server tags + pending answers.
  function viewEls() {
    var out = {}, srv = A.server();
    Object.keys(els).forEach(function (k) { out[k] = els[k]; });
    answers().forEach(function (a) {
      if (a.srv !== srv) return;
      var k = a.t + a.oid, e = out[k];
      if (!e) return;
      out[k] = { t: e.t, id: e.id, lat: e.lat, lon: e.lon, ts: Date.now(), tags: P.applySet(e.tags, a.set) };
    });
    return out;
  }
  function open() {
    var v = viewEls(), list = Object.keys(v).map(function (k) { return v[k]; });
    var c = map.getCenter();
    var all = Q.openQuests(list, { off: data.set.off, hide: data.hide });
    var pend = {};
    answers().forEach(function (a) { pend[a.t + a.oid + ":" + a.q] = 1; });
    return all.filter(function (x) {
      var k = x.el.t + x.el.id + ":" + x.q.id;
      return !skipped[k] && !pend[k] && Q.teamKeeps(x.el, stats.team);
    }).map(function (x) {
      x.d = map.distance(c, [x.el.lat, x.el.lon]);
      return x;
    }).sort(function (a, b) { return a.d - b.d || (a.q.id < b.q.id ? -1 : 1); });
  }

  function loadEls(force) {
    if (!modeOn) return;
    if (ovId) { loadOv(force); return; }
    if (map.getZoom() < MIN_ZOOM) { render(); return; }
    var b = map.getBounds(), off = data.set.off.join(",");
    if (!force && box && box.contains(b) && Date.now() - boxAt < FRESH_MS && boxOff === off) return;
    if (busy || !online()) { render(); return; }
    var bb = b.pad(0.2);
    busy = true; failed = false;
    render();
    var q = Q.overpassQuery(bb.getSouth(), bb.getWest(), bb.getNorth(), bb.getEast(), data.set.off);
    fetch(OVERPASS, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: "data=" + encodeURIComponent(q)
    }).then(function (r) {
      if (!r.ok) throw new Error(r.status);
      return r.json();
    }).then(function (j) {
      busy = false;
      box = bb; boxAt = Date.now(); boxOff = off;
      var next = {};
      Q.parseOverpass(j).forEach(function (x) { next[x.t + x.id] = x; });
      els = next;
      paint();
      render();
    }, function () {
      busy = false; failed = true;
      render();
    });
  }

  // ---------- layer ----------
  var layer = L.layerGroup();
  function pinIcon(q, n) {
    var h = el("span", "");
    h.textContent = q.icon;
    if (n > 1) { var b = el("i", "", String(n)); h.appendChild(b); }
    return L.divIcon({ className: "qst-pin", html: h, iconSize: [34, 34], iconAnchor: [17, 17] });
  }
  function paint() {
    layer.clearLayers();
    paintOv();
    if (!modeOn || ovId) return;
    var by = {};
    open().forEach(function (x) {
      var k = x.el.t + x.el.id;
      (by[k] = by[k] || []).push(x);
    });
    Object.keys(by).forEach(function (k) {
      var list = by[k], x = list[0];
      var mk = L.marker([x.el.lat, x.el.lon], { icon: pinIcon(x.q, list.length), keyboard: true, title: Q.text(x.q, "title", LANG) });
      mk.on("click", function () { show(k, x.q.id); });
      layer.addLayer(mk);
    });
  }
  function nameOf(e) {
    var tg = e.tags || {};
    return tg.name || tg.brand || (tg["addr:street"] && tg["addr:housenumber"] ? tg["addr:street"] + " " + tg["addr:housenumber"] : "") || "";
  }

  // ---------- overlays (maps wave 8B, overlays-core.js) ----------
  // Device-local choice; changes are quest answers (way_lit, way_surface,
  // housenumber, sidewalk) and upload with them.
  var OV_KEY = "oros-maps-overlay";
  var ovId = "", ovEls = {}, ovBox = null, ovAt = 0, ovFor = "", ovBusy = false, ovFailed = false;
  var ovLayer = L.layerGroup();
  var ovRenderer = null;
  function ovRend() {
    if (!ovRenderer) { try { ovRenderer = L.canvas({ padding: 0.3, tolerance: 8 }); } catch (e) { ovRenderer = null; } }
    return ovRenderer;
  }
  function setOverlay(id) {
    id = V && V.BY_ID[id] ? id : "";
    if (id === ovId) return;
    ovId = id;
    ovEls = {}; ovBox = null; ovFor = "";
    try { if (id) localStorage.setItem(OV_KEY, id); else localStorage.removeItem(OV_KEY); } catch (e) {}
    if (route.v === "ovl") route = { v: "list" };
    paint();
    loadEls(false);
    render();
  }
  // Overlay ways as the user sees them: server tags + pending answers.
  function viewOv() {
    var out = {}, srv = A.server();
    Object.keys(ovEls).forEach(function (k) { out[k] = ovEls[k]; });
    answers().forEach(function (a) {
      if (a.srv !== srv) return;
      var k = a.t + a.oid, e = out[k];
      if (!e) return;
      out[k] = { t: e.t, id: e.id, lat: e.lat, lon: e.lon, ts: e.ts, geom: e.geom, tags: P.applySet(e.tags, a.set) };
    });
    return out;
  }
  function loadOv(force) {
    var ov = V && V.BY_ID[ovId];
    if (!ov) return;
    if (map.getZoom() < ov.zoom) { render(); return; }
    var b = map.getBounds();
    if (!force && ovFor === ovId && ovBox && ovBox.contains(b) && Date.now() - ovAt < FRESH_MS) return;
    if (ovBusy || !online()) { render(); return; }
    var bb = b.pad(0.2), want = ovId;
    ovBusy = true; ovFailed = false;
    render();
    fetch(OVERPASS, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: "data=" + encodeURIComponent(V.query(want, bb.getSouth(), bb.getWest(), bb.getNorth(), bb.getEast()))
    }).then(function (r) {
      if (!r.ok) throw new Error(r.status);
      return r.json();
    }).then(function (j) {
      ovBusy = false;
      if (want !== ovId) { loadOv(false); return; }
      ovBox = bb; ovAt = Date.now(); ovFor = want;
      var next = {};
      V.parse(j, want).forEach(function (x) { next[x.t + x.id] = x; });
      ovEls = next;
      paint();
      render();
    }, function () {
      ovBusy = false; ovFailed = true;
      render();
    });
  }
  function paintOv() {
    ovLayer.clearLayers();
    var ov = V && V.BY_ID[ovId];
    if (!modeOn || !ov || map.getZoom() < ov.zoom) return;
    var v = viewOv(), sel = route.v === "ovl" ? route.key : "", rend = ovRend();
    Object.keys(v).forEach(function (k) {
      var e = v[k], st = ov.style(e.tags || {}), on = k === sel;
      var opt = { color: st.c, weight: on ? 9 : (ov.kind === "area" ? 2 : 6), opacity: on ? 1 : 0.9,
        dashArray: st.dash ? "8 7" : null, lineCap: st.dash ? "butt" : "round", renderer: rend || undefined, interactive: true };
      var shape;
      if (ov.kind === "area") {
        opt.fillColor = st.c; opt.fillOpacity = on ? 0.6 : 0.35;
        shape = L.polygon(e.geom, opt);
      } else shape = L.polyline(e.geom, opt);
      shape.on("click", function (ev) { if (ev && ev.originalEvent) L.DomEvent.stop(ev.originalEvent); showOv(k); });
      ovLayer.addLayer(shape);
    });
    if (sel && v[sel] && ov.arrows) {
      V.arrows(v[sel].geom, 40).forEach(function (a) {
        var h = el("span", "", "➤");
        h.style.transform = "rotate(" + (a.deg - 90) + "deg)";
        ovLayer.addLayer(L.marker([a.lat, a.lon], { icon: L.divIcon({ className: "ovl-arrow", html: h, iconSize: [22, 22], iconAnchor: [11, 11] }), interactive: false, keyboard: false }));
      });
    }
  }
  function ovPicker() {
    var lab = el("label", "qst-ovl");
    lab.appendChild(el("span", "", t("ovl")));
    var s = el("select", "osm-in qst-ovl-sel");
    s.setAttribute("aria-label", t("ovl"));
    var o0 = el("option", "", t("ovl.off")); o0.value = ""; s.appendChild(o0);
    V.OVERLAYS.forEach(function (ov) {
      var op = el("option", "", ov.icon + " " + V.text(ov, "title", LANG)); op.value = ov.id; op.selected = ov.id === ovId; s.appendChild(op);
    });
    s.addEventListener("change", function () { setOverlay(s.value); });
    lab.appendChild(s);
    return lab;
  }
  function ovListBody(body) {
    var ov = V.BY_ID[ovId];
    var lg = el("ul", "ovl-legend");
    ov.legend.forEach(function (x) {
      var li = el("li", "");
      var sw = el("i", x[0] === "miss" ? "dash" : "");
      sw.style.background = V.legendColor(x[0]);
      if (x[0] === "miss") sw.style.borderColor = V.legendColor(x[0]);
      sw.setAttribute("aria-hidden", "true");
      li.appendChild(sw);
      li.appendChild(el("span", "", V.legendText(ov, x, LANG)));
      lg.appendChild(li);
    });
    body.appendChild(lg);
    if (map.getZoom() < ov.zoom) {
      body.appendChild(el("p", "osm-hint", t("ovl.zoom")));
      var zr = el("div", "osm-actions");
      zr.appendChild(button(t("zoomgo"), "osm-btn", function () { map.setZoom(ov.zoom); }));
      body.appendChild(zr);
      return;
    }
    if (ovBusy) body.appendChild(el("p", "osm-hint", t("ovl.loading")));
    else if (ovFailed) body.appendChild(el("p", "osm-hint", t("loadfail")));
    else {
      var v = viewOv(), ks = Object.keys(v), miss = 0;
      ks.forEach(function (k) { if (!ov.value(v[k].tags || {})) miss++; });
      body.appendChild(el("p", "osm-hint", t("ovl.count", { n: ks.length, m: miss })));
    }
    body.appendChild(el("p", "osm-small", t(ov.kind === "area" ? "ovl.hint.area" : "ovl.hint.line") + " " + t("ovl.pins")));
  }
  function showOv(key) {
    if (!modeOn) setMode(true);
    go({ v: "ovl", key: key });
    paintOv();
  }
  function renderOvl() {
    var ov = V && V.BY_ID[ovId], e = viewOv()[route.key];
    if (!ov || !e) return false;
    var tg = e.tags || {};
    panel.textContent = "";
    panel.appendChild(header(ov.icon + " " + V.text(ov, "title", LANG), function () { go({ v: "list" }); paintOv(); }));
    var body = el("div", "osm-body qst-body");
    var nm = nameOf(e);
    body.appendChild(el("p", "qst-q", V.text(ov, "q", LANG).split("{name}").join(nm || t(ov.kind === "area" ? "unnamed.b" : "unnamed.way"))));
    var cur = ov.value(tg);
    // the current value in words when one of the choices matches it
    var curOp = cur && !ov.text ? ov.options(tg).filter(function (op) { return !V.answer(ov.id, e, op.v); })[0] : null;
    body.appendChild(el("p", "osm-small ovl-now", t("ovl.now", { v: curOp ? Q.optText(curOp, LANG) : cur || t("ovl.unknown") })));
    if (ov.form) {
      var fl = el("label", "osm-lab", t("ovl.levels"));
      var lv = el("input", "osm-in ovl-levels");
      lv.type = "number"; lv.inputMode = "numeric"; lv.min = "1"; lv.max = "200"; lv.step = "1"; lv.value = tg["building:levels"] || "";
      fl.appendChild(lv);
      body.appendChild(fl);
      var kl = el("label", "osm-lab", t("ovl.kind"));
      var kd = el("select", "osm-in ovl-kind");
      var k0 = el("option", "", t("ovl.kind.keep")); k0.value = ""; kd.appendChild(k0);
      V.buildingKinds().forEach(function (op) {
        var o2 = el("option", "", Q.optText(op, LANG)); o2.value = op.v; o2.selected = tg.building === op.set.building; kd.appendChild(o2);
      });
      kl.appendChild(kd);
      body.appendChild(kl);
      var fr = el("div", "osm-actions");
      fr.appendChild(button(t("text.save"), "osm-btn primary", function () { ovAnswer(e, ov, { levels: lv.value, type: kd.value }); }));
      body.appendChild(fr);
    } else if (ov.text) {
      var inp = el("input", "osm-in");
      inp.setAttribute("aria-label", V.text(ov, "title", LANG));
      inp.maxLength = 20; inp.value = tg["addr:housenumber"] || ""; inp.autocapitalize = "off";
      body.appendChild(inp);
      var ri = el("div", "osm-actions");
      ri.appendChild(button(t("text.save"), "osm-btn primary", function () { ovAnswer(e, ov, inp.value); }));
      var none = Q.BY_ID[ov.qid] && Q.BY_ID[ov.qid].none;
      if (none) ri.appendChild(button(Q.optText(none, LANG), "osm-btn", function () { ovAnswer(e, ov, "none"); }));
      body.appendChild(ri);
      inp.addEventListener("keydown", function (ev) { if (ev.key === "Enter") ovAnswer(e, ov, inp.value); });
    } else {
      if (ov.arrows) body.appendChild(el("p", "osm-hint", t("ovl.arrows")));
      var grid = el("div", "qst-opts");
      ov.options(tg).forEach(function (op) {
        var on = !!cur && !V.answer(ov.id, e, op.v);
        grid.appendChild(button(Q.optText(op, LANG), "osm-btn qst-opt" + (on ? " on" : ""), function () { ovAnswer(e, ov, op.v); }));
      });
      body.appendChild(grid);
    }
    var rf = el("div", "osm-actions qst-foot");
    rf.appendChild(button(t("back"), "osm-btn", function () { go({ v: "list" }); paintOv(); }));
    body.appendChild(rf);
    panel.appendChild(body);
    return true;
  }
  function ovAnswer(e, ov, value) {
    var r = V.answer(ov.id, e, value);
    if (!r) {
      // the same value again is fine, anything else is a bad answer
      var ok = ov.form ? !!V.buildingSet({}, value)
        : ov.text ? String(value || "").trim() !== "" && String(value).trim() === ((e.tags || {})["addr:housenumber"] || "")
        : ov.options(e.tags || {}).some(function (op) { return op.v === value; });
      toast(t(ok ? "ovl.same" : "bad"));
      if (ok) { go({ v: "list" }); paintOv(); }
      return;
    }
    var k = e.t + e.id, base = ovEls[k] || e, was = {};
    Object.keys(r.set).forEach(function (x) { was[x] = base.tags[x] === undefined ? "" : base.tags[x]; });
    var a = { id: newId(), m: 0, dev: A.deviceId(), srv: A.server(), q: ov.qid, t: e.t, oid: e.id,
      lat: e.lat, lon: e.lon, set: r.set, was: was, name: nameOf(e) };
    stamp(a);
    data.answers[a.id] = a;
    if (!saveData()) return;
    toast(t("saved"));
    go({ v: "list" });
    paint();
  }

  // ---------- panel ----------
  var panel = null, modeBtn = null, modeOn = false, route = { v: "list" };
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
  function go(r) { route = r; render(); }
  function render() {
    if (!panelOpen()) return;
    if (route.v === "quest" && renderQuest()) { setH(); return; }
    if (route.v === "ovl" && renderOvl()) { setH(); return; }
    if (route.v === "settings") renderSettings();
    else if (route.v === "badges") renderBadges();
    else { route = { v: "list" }; renderList(); }
    setH();
  }

  function renderList() {
    panel.textContent = "";
    panel.appendChild(header(t("title")));
    var body = el("div", "osm-body");
    var st = Q.doneStats(data);
    body.appendChild(el("p", "osm-small qst-stats", t("stats", { a: st.total, b: st.today, c: st.streak })));
    var my = mine();
    var row = el("div", "osm-actions");
    if (my.length) row.appendChild(button(t("upload", { n: my.length }), "osm-btn primary", openUpload));
    row.appendChild(button(t("badges"), "osm-btn qst-badges-btn", function () { go({ v: "badges" }); }));
    row.appendChild(button(t("settings"), "osm-btn", function () { go({ v: "settings" }); }));
    body.appendChild(row);
    if (stats.team.size > 1) body.appendChild(el("p", "osm-small qst-team-on", t("team.on", { n: stats.team.size, l: letter(stats.team.idx) })));
    if (V) body.appendChild(ovPicker());
    if (ovId) ovListBody(body);
    var pend = answers();
    if (pend.length) {
      body.appendChild(el("p", "osm-hint", t("pending", { n: pend.length })));
      var ul = el("ul", "osm-list");
      var me = A.deviceId();
      pend.slice(0, 50).forEach(function (a) {
        var q = Q.BY_ID[a.q];
        var li = el("li", "osm-row draft");
        var b = el("div", "osm-row-body");
        b.appendChild(el("div", "osm-row-t", q.icon + " " + Q.text(q, "title", LANG) + (a.name ? ": " + a.name : "")));
        var meta = Object.keys(a.set).map(function (k) { return k + "=" + a.set[k]; });
        if (a.dev !== me) meta.push(t("other"));
        if (a.err) meta.push(a.err);
        b.appendChild(el("div", "osm-row-s", meta.join(" · ")));
        li.appendChild(b);
        li.appendChild(button(t("del"), "osm-mini danger", function () { dropAnswer(a.id); paint(); render(); }));
        ul.appendChild(li);
      });
      body.appendChild(ul);
    }
    if (ovId) { panel.appendChild(body); return; }
    if (map.getZoom() < MIN_ZOOM) {
      body.appendChild(el("p", "osm-hint", t("zoomin")));
      var zr = el("div", "osm-actions");
      zr.appendChild(button(t("zoomgo"), "osm-btn", function () { map.setZoom(MIN_ZOOM); }));
      body.appendChild(zr);
      panel.appendChild(body);
      return;
    }
    if (busy) body.appendChild(el("p", "osm-hint", t("loading")));
    else if (failed) body.appendChild(el("p", "osm-hint", t("loadfail")));
    var list = open();
    if (!busy && !failed) body.appendChild(el("p", "osm-hint", list.length ? t("count", { n: list.length }) : t("none")));
    var ul2 = el("ul", "osm-list qst-list");
    list.slice(0, 60).forEach(function (x) {
      var li = el("li", "osm-row");
      li.tabIndex = 0;
      li.setAttribute("role", "button");
      var ic = el("span", "qst-ic", x.q.icon);
      ic.setAttribute("aria-hidden", "true");
      li.appendChild(ic);
      var b = el("div", "osm-row-body");
      b.appendChild(el("div", "osm-row-t", Q.text(x.q, "title", LANG)));
      var nm = nameOf(x.el);
      b.appendChild(el("div", "osm-row-s", (nm ? nm + " · " : "") + Math.round(x.d) + " m"));
      li.appendChild(b);
      li.addEventListener("click", function () { show(x.el.t + x.el.id, x.q.id); });
      li.addEventListener("keydown", function (ev) { if (ev.key === "Enter") show(x.el.t + x.el.id, x.q.id); });
      ul2.appendChild(li);
    });
    body.appendChild(ul2);
    panel.appendChild(body);
  }

  function show(key, qid) {
    if (!modeOn) setMode(true);
    go({ v: "quest", key: key, q: qid });
    var e = viewEls()[key];
    if (e) map.panTo([e.lat, e.lon]);
  }
  function nextQuest(key) {
    var list = open();
    var same = list.filter(function (x) { return x.el.t + x.el.id === key; })[0];
    var nx = same || list[0];
    if (nx) go({ v: "quest", key: nx.el.t + nx.el.id, q: nx.q.id });
    else go({ v: "list" });
  }

  function renderQuest() {
    var e = viewEls()[route.key], q = Q.BY_ID[route.q];
    if (!e || !q) return false;
    var mode = Q.state(q, e);
    if (!mode) return false;
    panel.textContent = "";
    panel.appendChild(header(q.icon + " " + Q.text(q, "title", LANG), function () { go({ v: "list" }); }));
    var body = el("div", "osm-body qst-body");
    var nm = nameOf(e);
    body.appendChild(el("p", "qst-q", Q.text(q, "q", LANG).split("{name}").join(nm || t(e.tags.highway ? "unnamed.way" : e.tags.building ? "unnamed.b" : "unnamed"))));
    if (mode === "recheck") {
      var last = Q.lastCheck(e, q.key);
      var d = last ? new Date(last).toLocaleDateString(loc(), { year: "numeric", month: "short" }) : "?";
      body.appendChild(el("p", "osm-hint", t("recheck", { d: d, v: e.tags[q.key] || "" })));
      var sr = el("div", "osm-actions");
      sr.appendChild(button(t("same"), "osm-btn primary", function () { answer(e, q, "same"); }));
      body.appendChild(sr);
    }
    var cur = e.tags[q.key];
    if (q.kind === "choice") {
      var grid = el("div", "qst-opts");
      q.options.forEach(function (op) {
        var b = button(Q.optText(op, LANG), "osm-btn qst-opt" + (cur !== undefined && op.set[q.key] === cur ? " on" : ""), function () { answer(e, q, op.v); });
        grid.appendChild(b);
      });
      body.appendChild(grid);
    } else if (q.kind === "multi") {
      var box2 = el("div", "qst-multi"), picks = [];
      q.options.forEach(function (op) {
        var lab = el("label", "heat-check");
        var cb = el("input", "");
        cb.type = "checkbox";
        cb.addEventListener("change", function () {
          var i = picks.indexOf(op.v);
          if (cb.checked && i < 0) picks.push(op.v); else if (!cb.checked && i >= 0) picks.splice(i, 1);
          sv.disabled = !picks.length;
        });
        lab.appendChild(cb);
        lab.appendChild(el("span", "", Q.optText(op, LANG)));
        box2.appendChild(lab);
      });
      body.appendChild(box2);
      var rm = el("div", "osm-actions");
      var sv = button(t("multi.save"), "osm-btn primary", function () { answer(e, q, picks.slice()); });
      sv.disabled = true;
      rm.appendChild(sv);
      body.appendChild(rm);
    } else {
      var inp = el("input", "osm-in");
      inp.setAttribute("aria-label", Q.text(q, "title", LANG));
      if (q.kind === "hours") { inp.placeholder = t("hours.ph"); inp.maxLength = 255; inp.value = cur || ""; inp.spellcheck = false; inp.autocapitalize = "off"; }
      if (q.kind === "number") { inp.type = "number"; inp.inputMode = "numeric"; inp.min = String(q.min); inp.max = String(q.max); inp.step = "1"; inp.value = cur || ""; }
      if (q.kind === "text") { inp.maxLength = q.maxLen || 20; inp.value = cur || ""; inp.autocapitalize = "off"; }
      if (q.kind === "name") { inp.maxLength = q.maxLen || 80; inp.value = cur || ""; inp.placeholder = t("name.ph"); inp.autocomplete = "off"; }
      body.appendChild(inp);
      if (q.kind === "hours") body.appendChild(el("p", "osm-small", t("hours.hint")));
      var ri = el("div", "osm-actions");
      ri.appendChild(button(t(q.kind + ".save"), "osm-btn primary", function () { answer(e, q, inp.value); }));
      if (q.kind === "hours") {
        if (q.key === "opening_hours") ri.appendChild(button(t("hours.247"), "osm-btn", function () { answer(e, q, "24/7"); }));
        ri.appendChild(button(t(q.key === "opening_hours" ? "hours.none" : "hours.none.ct"), "osm-btn", function () { answer(e, q, "unsigned"); }));
      }
      if ((q.kind === "text" || q.kind === "name") && q.none) ri.appendChild(button(Q.optText(q.none, LANG), "osm-btn", function () { answer(e, q, "none"); }));
      body.appendChild(ri);
      inp.addEventListener("keydown", function (ev) { if (ev.key === "Enter") answer(e, q, inp.value); });
    }
    var key = e.t + e.id;
    var rf = el("div", "osm-actions qst-foot");
    rf.appendChild(button(t("skip"), "osm-btn", function () { skipped[key + ":" + q.id] = 1; paint(); nextQuest(key); }));
    rf.appendChild(button(t("hide"), "osm-btn", function () {
      data.hide[key + ":" + q.id] = Date.now(); saveData(); paint(); nextQuest(key);
    }));
    rf.appendChild(button(t("gone"), "osm-btn", function () {
      var N = window.__orosMapsNotes;
      skipped[key + ":" + q.id] = 1;
      paint();
      if (N && N.newNote) N.newNote(e.lat, e.lon, t("note.text", { q: (nm ? nm + " · " : "") + Q.text(q, "title", LANG) }));
    }));
    body.appendChild(rf);
    panel.appendChild(body);
    return true;
  }

  function answer(e, q, value) {
    var r = Q.answerSet(q, e, value);
    if (!r) { toast(t("bad")); return; }
    var base = els[e.t + e.id] || e;
    var was = {};
    Object.keys(r.set).forEach(function (k) { was[k] = base.tags[k] === undefined ? "" : base.tags[k]; });
    var a = { id: newId(), m: 0, dev: A.deviceId(), srv: A.server(), q: q.id, t: e.t, oid: e.id,
      lat: e.lat, lon: e.lon, set: r.set, was: was, name: nameOf(e) };
    stamp(a);
    data.answers[a.id] = a;
    if (!saveData()) return;
    toast(t("saved"));
    paint();
    nextQuest(e.t + e.id);
  }

  function renderBadges() {
    panel.textContent = "";
    panel.appendChild(header(t("badges.title"), function () { go({ v: "list" }); }));
    var body = el("div", "osm-body");
    var list = Q.achievements(stats);
    if (!list.some(function (c) { return c.n > 0; })) body.appendChild(el("p", "osm-hint", t("badge.none")));
    var ul = el("ul", "qst-badges");
    list.forEach(function (c) {
      var li = el("li", "qst-badge lv" + c.level);
      var ic = el("span", "qst-badge-ic", c.icon);
      ic.setAttribute("aria-hidden", "true");
      li.appendChild(ic);
      var b = el("div", "qst-badge-b");
      b.appendChild(el("div", "osm-row-t", c[LANG] || c.en));
      b.appendChild(el("div", "osm-row-s", t("badge.lv", { l: c.level, n: c.n }) + " · " + (c.next ? t("badge.next", { n: c.next }) : t("badge.max"))));
      var bar = el("div", "qst-bar");
      var fill = el("i", "");
      var lo = c.level ? Q.LEVELS[c.level - 1] : 0, hi = c.next ? c.n + c.next : c.n || 1;
      fill.style.width = Math.round(100 * (c.next ? (c.n - lo) / Math.max(1, hi - lo) : 1)) + "%";
      bar.appendChild(fill);
      b.appendChild(bar);
      if (c.links.length) {
        var lk = el("div", "qst-badge-links");
        lk.appendChild(el("span", "osm-small", t("badge.links") + ": "));
        c.links.forEach(function (u) {
          var a = el("a", "", u.replace(/^https:\/\/(www\.)?/, "").replace(/\/$/, ""));
          a.href = u; a.target = "_blank"; a.rel = "noopener noreferrer";
          lk.appendChild(a);
        });
        b.appendChild(lk);
      }
      li.appendChild(b);
      ul.appendChild(li);
    });
    body.appendChild(ul);
    panel.appendChild(body);
  }

  function renderSettings() {
    panel.textContent = "";
    panel.appendChild(header(t("settings"), function () { go({ v: "list" }); }));
    var body = el("div", "osm-body");
    var tb = el("div", "qst-team");
    tb.appendChild(el("h4", "", t("team")));
    tb.appendChild(el("p", "osm-small", t("team.hint")));
    var row = el("div", "qst-team-row");
    var size = el("select", "osm-in qst-team-size");
    size.setAttribute("aria-label", t("team.size"));
    for (var n = 1; n <= 12; n++) {
      var op = el("option", "", n === 1 ? t("team.solo") : String(n)); op.value = String(n); op.selected = n === stats.team.size; size.appendChild(op);
    }
    var me = el("select", "osm-in qst-team-me");
    me.setAttribute("aria-label", t("team.me"));
    function fillMe() {
      me.textContent = "";
      var sz = parseInt(size.value, 10) || 1;
      for (var i = 0; i < sz; i++) { var o2 = el("option", "", letter(i)); o2.value = String(i); o2.selected = i === stats.team.idx; me.appendChild(o2); }
      me.disabled = sz < 2;
    }
    fillMe();
    function saveTeam() {
      var sz = parseInt(size.value, 10) || 1, ix = Math.min(parseInt(me.value, 10) || 0, sz - 1);
      stats.team = { m: Math.max(Date.now(), (stats.team.m || 0) + 1), size: sz, idx: sz > 1 ? ix : 0 };
      saveStats(); paint();
    }
    size.addEventListener("change", function () { fillMe(); saveTeam(); });
    me.addEventListener("change", saveTeam);
    var l1 = el("label", "qst-team-l"); l1.appendChild(el("span", "", t("team.size"))); l1.appendChild(size);
    var l2 = el("label", "qst-team-l"); l2.appendChild(el("span", "", t("team.me"))); l2.appendChild(me);
    row.appendChild(l1); row.appendChild(l2);
    tb.appendChild(row);
    body.appendChild(tb);
    body.appendChild(el("h4", "qst-set-h", t("set.title")));
    Q.QUESTS.forEach(function (q) {
      var lab = el("label", "heat-check qst-set");
      var cb = el("input", "");
      cb.type = "checkbox";
      cb.checked = data.set.off.indexOf(q.id) < 0;
      cb.addEventListener("change", function () {
        var off = data.set.off.filter(function (x) { return x !== q.id; });
        if (!cb.checked) off.push(q.id);
        data.set = { m: 0, off: off };
        stamp(data.set);
        saveData();
        paint();
      });
      lab.appendChild(cb);
      lab.appendChild(el("span", "", q.icon + " " + Q.text(q, "title", LANG)));
      body.appendChild(lab);
    });
    var r = el("div", "osm-actions");
    r.appendChild(button(t("set.all"), "osm-btn", function () {
      data.set = { m: 0, off: [] }; stamp(data.set); saveData(); paint(); render();
    }));
    body.appendChild(r);
    panel.appendChild(body);
  }

  // ---------- upload ----------
  function osmComment() {
    try {
      var d = window.__orosMapsNotes && window.__orosMapsNotes.data();
      return O.uploadComment(d);
    } catch (e) { return O.DEFAULT_COMMENT; }
  }
  function apiErr(e) {
    if (e && e.offline) return t("up.offline");
    return (e && e.status ? e.status + " " : "") + (e && e.text || "");
  }
  function openUpload() {
    if (!online()) { toast(t("up.offline")); return; }
    if (!A.account()) {
      if (!A.configured()) { toast(t("up.signin")); return; }
      A.signIn().then(openUpload, function () {});
      return;
    }
    var list = mine();
    if (!list.length) return;
    var dlg = el("dialog", "osm-dlg");
    dlg.appendChild(el("h3", "", t("up.title")));
    dlg.appendChild(el("p", "osm-hint", t("up.count", { n: list.length })));
    var lab = el("label", "osm-lab", t("up.comment"));
    var inp = el("input", "osm-in");
    inp.value = osmComment();
    inp.maxLength = 255;
    lab.appendChild(inp);
    dlg.appendChild(lab);
    var row = el("div", "osm-actions");
    var goBtn = button(t("up.go"), "osm-btn primary", function () {
      var c = P.cleanVal(inp.value) || O.DEFAULT_COMMENT;
      goBtn.disabled = true;
      close();
      upload(c);
    });
    row.appendChild(goBtn);
    row.appendChild(button(t("cancel"), "osm-btn", close));
    dlg.appendChild(row);
    function close() { if (dlg.open) dlg.close(); dlg.remove(); }
    dlg.addEventListener("cancel", function (ev) { ev.preventDefault(); close(); });
    document.body.appendChild(dlg);
    dlg.showModal();
  }

  var uploading = false;
  function markErr(a, msg) {
    var x = data.answers[a.id];
    if (!x) return;
    x.err = msg;
    stamp(x);
    saveData();
  }
  // One changeset per quest type (orOS:quest_type), one element at a time.
  function upload(comment) {
    if (uploading) return Promise.resolve();
    var list = mine();
    if (!list.length) return Promise.resolve();
    uploading = true;
    var srv = A.server(), groups = {}, order = [], sent = 0, conflicts = [];
    list.forEach(function (a) { if (!groups[a.q]) { groups[a.q] = []; order.push(a.q); } groups[a.q].push(a); });
    function el0(j) { return j && Array.isArray(j.elements) ? j.elements[0] : null; }
    function one(qid) {
      var items = [], used = [], seen = {};
      return groups[qid].reduce(function (pr, a) {
        return pr.then(function () {
          var type = P.TYPES[a.t], k = a.t + a.oid;
          if (seen[k]) {           // two answers for one element: merge them
            var it0 = items[seen[k] - 1];
            var rb0 = P.rebase(it0.tags, a.set, a.was);
            it0.tags = P.cleanTags(rb0.tags); used.push(a); return;
          }
          return A.request("GET", "/api/0.6/" + type + "/" + a.oid + ".json", null, srv).then(function (j) {
            var cur = el0(j);
            if (!cur || cur.visible === false) throw { status: 410 };
            var rb = P.rebase(cur.tags || {}, a.set, a.was);
            rb.conflicts.forEach(function (c) { conflicts.push(c); });
            var tags = P.cleanTags(rb.tags);
            if (P.canon(tags) === P.canon(P.cleanTags(cur.tags || {}))) { dropAnswer(a.id); return; }
            items.push({ op: "modify", type: type, id: a.oid, version: cur.version, tags: tags,
              lat: cur.lat, lon: cur.lon, nodes: cur.nodes, members: cur.members });
            seen[k] = items.length;
            used.push(a);
          }, function (err) {
            if (err && (err.status === 410 || err.status === 404)) { markErr(a, t("up.gone")); return; }
            throw err;
          });
        });
      }, Promise.resolve()).then(function () {
        if (!items.length) return;
        var csId = 0;
        var tags = { comment: comment, created_by: "orOS Maps " + (H.ver || ""), locale: LANG, source: "survey", "orOS:quest_type": qid };
        return A.request("PUT", "/api/0.6/changeset/create", null, srv, { body: P.changesetXml(tags), text: true })
          .then(function (id) {
            csId = parseInt(String(id).trim(), 10);
            if (!(csId > 0)) throw { status: 0, text: "changeset" };
            return A.request("POST", "/api/0.6/changeset/" + csId + "/upload", null, srv, { body: P.osmChangeXml(csId, items), text: true });
          }).then(function () {
            return A.request("PUT", "/api/0.6/changeset/" + csId + "/close", null, srv, { text: true, body: "" }).catch(function () {});
          }, function (err) {
            if (csId) A.request("PUT", "/api/0.6/changeset/" + csId + "/close", null, srv, { text: true, body: "" }).catch(function () {});
            if (err && err.status === 409) used.forEach(function (a) { markErr(a, "409"); });
            throw err;
          }).then(function () {
            items.forEach(function (it) {
              var k = it.type.charAt(0) + it.id;
              if (els[k]) els[k] = { t: els[k].t, id: els[k].id, lat: els[k].lat, lon: els[k].lon, ts: Date.now(), tags: it.tags };
              if (ovEls[k]) ovEls[k] = { t: "w", id: ovEls[k].id, lat: ovEls[k].lat, lon: ovEls[k].lon, ts: 0, tags: it.tags, geom: ovEls[k].geom };
            });
            used.forEach(function (a) { dropAnswer(a.id); });
            sent += used.length;
            countDone(used.length, qid);
          });
      });
    }
    return order.reduce(function (pr, qid) { return pr.then(function () { return one(qid); }); }, Promise.resolve()).then(function () {
      uploading = false;
      if (sent) toast(t("up.ok", { n: sent }));
      if (conflicts.length) setTimeout(function () { toast(t("up.conflict", { k: conflicts.join(", ") })); }, 1500);
      paint(); render();
    }, function (err) {
      uploading = false;
      toast(t("up.fail", { e: apiErr(err) }));
      paint(); render();
    });
  }
  function countDone(n, qid) {
    if (!n) return;
    if (qid) {
      var before = stats;
      stats = Q.addCount(stats, A.deviceId(), qid, n);
      saveStats();
      Q.levelUps(before, stats).forEach(function (c, i) {
        setTimeout(function () { toast(t("badge.new", { c: c[LANG] || c.en, l: c.level })); }, 3000 + i * 1500);
      });
    }
    var me = A.deviceId(), day = Q.today();
    var d = data.done[me] || (data.done[me] = {});
    d[day] = (d[day] || 0) + n;
    saveData();
  }

  // ---------- mode ----------
  window.addEventListener("oros-maps-mode", function (e) {
    if (modeOn && e.detail !== "quests") setMode(false);
  });
  function setMode(on) {
    if (on && !modeOn) {
      try { window.dispatchEvent(new CustomEvent("oros-maps-mode", { detail: "quests" })); } catch (e) {}
    }
    var was = modeOn;
    modeOn = !!on;
    document.body.classList.toggle("osm-mode", modeOn);
    if (modeBtn) { modeBtn.classList.toggle("on", modeOn); modeBtn.setAttribute("aria-pressed", modeOn ? "true" : "false"); }
    if (modeOn) {
      layer.addTo(map);
      ovLayer.addTo(map);
      panel.hidden = false;
      route = { v: "list" };
      paint();
      loadEls(false);
      render();
    } else {
      map.removeLayer(layer);
      map.removeLayer(ovLayer);
      panel.hidden = true;
      var n = mine().length;
      if (was && n) toast(t("leave", { n: n }));
    }
    setH();
  }
  var moveTimer = null;
  map.on("moveend", function () {
    if (!modeOn) return;
    clearTimeout(moveTimer);
    moveTimer = setTimeout(function () { loadEls(false); paint(); if (route.v === "list") render(); }, 350);
  });

  var ICON = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s7-6.2 7-12a7 7 0 0 0-14 0c0 5.8 7 12 7 12z"/><path d="M10 8.2a2.2 2.2 0 1 1 3 2c-.7.3-1 .8-1 1.5"/><path d="M12 14.5h.01"/></svg>';
  function boot() {
    loadData();
    loadStats();
    try { var ov0 = localStorage.getItem(OV_KEY) || ""; if (V && V.BY_ID[ov0]) ovId = ov0; } catch (e) {}
    panel = el("aside", "osm-sheet");
    panel.id = "qst-panel";
    panel.hidden = true;
    panel.setAttribute("aria-label", t("title"));
    document.body.appendChild(panel);
    try { new ResizeObserver(setH).observe(panel); } catch (e) {}
    var controls = document.getElementById("controls");
    if (controls) {
      modeBtn = el("button", "");
      modeBtn.id = "qst-btn";
      modeBtn.type = "button";
      modeBtn.title = t("btn");
      modeBtn.setAttribute("aria-label", t("btn"));
      modeBtn.setAttribute("aria-pressed", "false");
      modeBtn.innerHTML = ICON;
      modeBtn.addEventListener("click", function () { setMode(!modeOn); });
      controls.insertBefore(modeBtn, document.getElementById("geo-btn") || null);
    }
    var api = syncApi();
    if (api && typeof api.registerSlice === "function") {
      api.registerSlice("mapsquests", sliceGet, sliceSet, DATA_KEY, Q.merge);
      api.registerSlice("mapsqstats", statsGet, statsSet, STATS_KEY, Q.mergeStats);
    }
    A.onChange(function () { if (panelOpen()) render(); });
  }

  window.__orosMapsQuests = {
    data: function () { return Q.normalize(data); },
    stats: function () { return Q.normStats(stats); },
    els: function () { return els; },
    open: function () { return open().map(function (x) { return { key: x.el.t + x.el.id, q: x.q.id, mode: x.mode }; }); },
    setMode: setMode, show: show, upload: upload,
    overlay: function (id) { if (id !== undefined) setOverlay(id); return ovId; },
    ovEls: function () { return ovEls; },
    showOv: showOv
  };
  boot();
})();
