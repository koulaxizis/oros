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
  if (!O || !P || !Q || !A || !H || !H.map) return;
  var map = H.map;
  var LANG = H.lang === "el" ? "el" : "en";
  var OVERPASS = "https://overpass-api.de/api/interpreter";

  var STR = {
    en: {
      "btn": "Quests", "title": "Quests",
      "zoomin": "Zoom in closer to see the quests around you.",
      "zoomgo": "Zoom in",
      "loading": "Looking for quests…", "loadfail": "Could not load the area. Try again later.",
      "none": "No quests here. Move the map or turn more quests on in Settings.",
      "count": "{n} quests here",
      "stats": "Your answers: {a} · today {b} · {c} days in a row",
      "pending": "{n} answers waiting to be uploaded",
      "other": "From another device (it uploads them)",
      "upload": "Upload {n}",
      "settings": "Settings",
      "set.title": "Which quests to show",
      "set.all": "All on",
      "skip": "Can't say", "hide": "Hide here", "gone": "It's not there any more",
      "same": "Still the same",
      "recheck": "Last checked {d}: {v}. Is it still right?",
      "hours.ph": "e.g. Mo-Fr 09:00-17:00; Sa 10:00-14:00",
      "hours.247": "Open 24/7", "hours.none": "No hours posted", "hours.none.ct": "No times posted", "hours.save": "Save",
      "hours.hint": "Days Mo Tu We Th Fr Sa Su, times 24-hour, groups separated by ;",
      "number.save": "Save", "text.save": "Save", "multi.save": "Save",
      "bad": "That answer doesn't look right. Check it and try again.",
      "saved": "Saved. Upload when you're done.",
      "unnamed": "this place", "unnamed.way": "this street", "unnamed.b": "this building",
      "back": "Back", "close": "Close", "cancel": "Cancel", "del": "Remove",
      "note.text": "{q}: it is not there any more.",
      "up.title": "Upload to OpenStreetMap",
      "up.comment": "Comment",
      "up.count": "{n} answers from this device will be published under your OpenStreetMap name.",
      "up.go": "Upload",
      "up.ok": "Uploaded {n} answers to OpenStreetMap",
      "up.conflict": "Someone else changed these meanwhile, their value was kept: {k}",
      "up.fail": "Upload failed: {e}",
      "up.gone": "It no longer exists on OpenStreetMap",
      "up.signin": "Sign in with OpenStreetMap to upload",
      "up.offline": "You are offline. Your answers are kept.",
      "leave": "{n} answers are waiting to be uploaded",
      "name.save": "Save", "name.ph": "As written on the sign",
      "badges": "Achievements", "badges.title": "Your achievements",
      "badge.lv": "Level {l} · {n} answers", "badge.next": "{n} more for the next level", "badge.max": "Top level reached",
      "badge.none": "Answer quests and upload them to earn achievements. Each level unlocks a page to learn more.",
      "badge.new": "New achievement: {c}, level {l}",
      "badge.links": "Unlocked reading",
      "team": "Team mapping",
      "team.hint": "Map an area with friends without answering the same things: everyone picks the same team size and a different letter. Each of you then sees only your share of the quests.",
      "team.size": "People in the team", "team.solo": "Just me", "team.me": "My letter",
      "team.on": "Team of {n}, you are {l}: you see your share of the quests"
    },
    el: {
      "btn": "Ερωτήσεις", "title": "Ερωτήσεις",
      "zoomin": "Πλησίασε περισσότερο για να δεις τις ερωτήσεις γύρω σου.",
      "zoomgo": "Μεγέθυνση",
      "loading": "Ψάχνω ερωτήσεις…", "loadfail": "Η περιοχή δεν φόρτωσε. Δοκίμασε αργότερα.",
      "none": "Καμία ερώτηση εδώ. Μετακίνησε τον χάρτη ή άνοιξε κι άλλες στις Ρυθμίσεις.",
      "count": "{n} ερωτήσεις εδώ",
      "stats": "Οι απαντήσεις σου: {a} · σήμερα {b} · {c} μέρες στη σειρά",
      "pending": "{n} απαντήσεις περιμένουν αποστολή",
      "other": "Από άλλη συσκευή (εκείνη τις στέλνει)",
      "upload": "Αποστολή {n}",
      "settings": "Ρυθμίσεις",
      "set.title": "Ποιες ερωτήσεις να φαίνονται",
      "set.all": "Όλες ανοιχτές",
      "skip": "Δεν ξέρω", "hide": "Κρύψε εδώ", "gone": "Δεν υπάρχει πια",
      "same": "Ισχύει ακόμα",
      "recheck": "Ελέγχθηκε {d}: {v}. Ισχύει ακόμα;",
      "hours.ph": "π.χ. Mo-Fr 09:00-17:00; Sa 10:00-14:00",
      "hours.247": "Ανοιχτό 24/7", "hours.none": "Δεν αναγράφεται ωράριο", "hours.none.ct": "Δεν αναγράφονται ώρες", "hours.save": "Αποθήκευση",
      "hours.hint": "Μέρες Mo Tu We Th Fr Sa Su (Δευ–Κυρ), ώρες 24ωρες, ομάδες χωρισμένες με ;",
      "number.save": "Αποθήκευση", "text.save": "Αποθήκευση", "multi.save": "Αποθήκευση",
      "bad": "Η απάντηση δεν φαίνεται σωστή. Έλεγξέ τη και δοκίμασε ξανά.",
      "saved": "Αποθηκεύτηκε. Στείλε όταν τελειώσεις.",
      "unnamed": "αυτό το μέρος", "unnamed.way": "αυτός ο δρόμος", "unnamed.b": "αυτό το κτίριο",
      "back": "Πίσω", "close": "Κλείσιμο", "cancel": "Άκυρο", "del": "Αφαίρεση",
      "note.text": "{q}: δεν υπάρχει πια.",
      "up.title": "Αποστολή στο OpenStreetMap",
      "up.comment": "Σχόλιο",
      "up.count": "{n} απαντήσεις από αυτή τη συσκευή θα δημοσιευτούν με το όνομά σου στο OpenStreetMap.",
      "up.go": "Αποστολή",
      "up.ok": "Στάλθηκαν {n} απαντήσεις στο OpenStreetMap",
      "up.conflict": "Κάποιος άλλος τα άλλαξε στο μεταξύ και κρατήθηκε η δική του τιμή: {k}",
      "up.fail": "Η αποστολή απέτυχε: {e}",
      "up.gone": "Δεν υπάρχει πια στο OpenStreetMap",
      "up.signin": "Συνδέσου με OpenStreetMap για αποστολή",
      "up.offline": "Δεν έχεις σύνδεση. Οι απαντήσεις σου κρατιούνται.",
      "leave": "{n} απαντήσεις περιμένουν αποστολή",
      "name.save": "Αποθήκευση", "name.ph": "Όπως γράφει η πινακίδα",
      "badges": "Επιτεύγματα", "badges.title": "Τα επιτεύγματά σου",
      "badge.lv": "Επίπεδο {l} · {n} απαντήσεις", "badge.next": "Ακόμα {n} για το επόμενο επίπεδο", "badge.max": "Έφτασες στο ανώτερο επίπεδο",
      "badge.none": "Απάντησε σε ερωτήσεις και στείλ' τες για να κερδίσεις επιτεύγματα. Κάθε επίπεδο ξεκλειδώνει μια σελίδα για να μάθεις περισσότερα.",
      "badge.new": "Νέο επίτευγμα: {c}, επίπεδο {l}",
      "badge.links": "Ξεκλείδωτο διάβασμα",
      "team": "Ομαδική χαρτογράφηση",
      "team.hint": "Χαρτογραφήστε μια περιοχή με φίλους χωρίς να απαντάτε στα ίδια: όλοι διαλέγετε το ίδιο μέγεθος ομάδας και διαφορετικό γράμμα. Ο καθένας βλέπει μόνο το δικό του μερίδιο ερωτήσεων.",
      "team.size": "Άτομα στην ομάδα", "team.solo": "Μόνο εγώ", "team.me": "Το γράμμα μου",
      "team.on": "Ομάδα {n} ατόμων, είσαι το {l}: βλέπεις το δικό σου μερίδιο"
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
    if (!modeOn) return;
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
      var d = last ? new Date(last).toLocaleDateString(LANG === "el" ? "el-GR" : "en-GB", { year: "numeric", month: "short" }) : "?";
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
      b.appendChild(el("div", "osm-row-t", LANG === "el" ? c.el : c.en));
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
        setTimeout(function () { toast(t("badge.new", { c: LANG === "el" ? c.el : c.en, l: c.level })); }, 3000 + i * 1500);
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
      panel.hidden = false;
      route = { v: "list" };
      paint();
      loadEls(false);
      render();
    } else {
      map.removeLayer(layer);
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
    setMode: setMode, show: show, upload: upload
  };
  boot();
})();
