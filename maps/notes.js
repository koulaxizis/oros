// ============================================================
// orOS Maps — notes.js (OpenStreetMap notes, Maps wave 1 of the OSM
// upgrade, v1.0.0)
// "Mapping" mode: the OSM notes around you on the map and in a panel;
// a new note (long-press › Report to OpenStreetMap, or the panel's
// button), comments, close and reopen. Needs an OSM account to write
// (owner's choice 2026-10-13); reading works without one.
//
// Offline / failed sends become drafts in the synced slice "mapsosm"
// (osm.js) and are sent by the device that made them as soon as it is
// online and signed in. Another device may take a draft over ("Send
// from here"). A sent draft leaves a tombstone, so it is never sent
// twice.
//
// Safety: everything from OSM (note text, user names) is put on the
// page with textContent; links are built from http(s) URLs found in
// the plain text (OrosMapsOSM.splitLinks). The API's "html" field is
// never used. Leaflet popups are not used for OSM text at all.
//
// Host hooks (maps.js): window.__orosMapsHost = { map, lang, toast,
// localToast, ctxItems[] }. Everything else is built here.
// ============================================================
(function () {
  "use strict";
  var O = window.OrosMapsOSM;
  var A = window.OrosMapsApi;
  var H = window.__orosMapsHost;
  if (!O || !A || !H || !H.map) return;
  var map = H.map;
  var LANG = H.lang === "el" ? "el" : "en";

  var STR = {
    en: {
      "btn": "Mapping (OpenStreetMap notes)",
      "title": "OpenStreetMap notes",
      "tab.near": "Nearby", "tab.mine": "Mine", "tab.wait": "Waiting",
      "zoomin": "Zoom in to see the notes of this area.",
      "loading": "Loading notes…",
      "none": "No notes here. Long-press the map (right-click on a computer) to report something.",
      "loadfail": "Couldn't load notes. Check your connection.",
      "new": "New note at the map centre",
      "ctx": "Report to OpenStreetMap",
      "signin": "Sign in with OpenStreetMap",
      "signout": "Sign out",
      "signedas": "Signed in as {u}",
      "signedout": "Not signed in. You can read notes; to write you need a free OpenStreetMap account.",
      "notcfg": "OpenStreetMap sign-in is not set up in this version yet. Notes you write are kept and sent once it is.",
      "signin.ok": "Signed in to OpenStreetMap",
      "signin.fail": "OpenStreetMap sign-in failed",
      "signin.denied": "Sign-in cancelled",
      "server": "Server",
      "server.live": "OpenStreetMap",
      "server.dev": "Test server (changes are not on the real map)",
      "upload": "Upload comment",
      "upload.hint": "Added to everything you send to OpenStreetMap (map edits, and at the end of new notes). Empty = default.",
      "status.open": "Open", "status.closed": "Resolved", "status.hidden": "Hidden",
      "act.opened": "created", "act.commented": "commented", "act.closed": "resolved",
      "act.reopened": "reopened", "act.hidden": "hid",
      "anon": "anonymous",
      "back": "Back", "close": "Close",
      "comment.ph": "Write a comment…",
      "do.comment": "Comment", "do.close": "Resolve", "do.reopen": "Reopen",
      "onosm": "Open on openstreetmap.org",
      "new.title": "New OpenStreetMap note",
      "new.ph": "What is wrong or missing on the map here? Be specific: other mappers will read it.",
      "new.sig": "Ending line",
      "new.near": "There is already an open note nearby:",
      "new.view": "View",
      "send": "Send", "cancel": "Cancel", "signsend": "Sign in and send",
      "sent": "Sent to OpenStreetMap",
      "queued": "Saved. It will be sent when you are online and signed in.",
      "conflict": "This note changed meanwhile. Here is its latest state.",
      "ratelimit": "OpenStreetMap asks to slow down. Try again in a few minutes.",
      "wait.none": "Nothing waiting to be sent.",
      "wait.send": "Send now",
      "wait.here": "Send from here",
      "wait.other": "From another device",
      "wait.del": "Delete",
      "wait.note": "New note", "wait.comment": "Comment on note #{n}",
      "wait.close": "Resolve note #{n}", "wait.reopen": "Reopen note #{n}",
      "mine.none": "Notes you create or comment on appear here.",
      "mine.signin": "Sign in to see your notes.",
      "replies": "{n} of your OpenStreetMap notes have new replies",
      "reply1": "One of your OpenStreetMap notes has a new reply",
      "osm.section": "OpenStreetMap",
      "dist.m": "{n} m", "dist.km": "{n} km"
    },
    el: {
      "btn": "Χαρτογράφηση (σημειώσεις OpenStreetMap)",
      "title": "Σημειώσεις OpenStreetMap",
      "tab.near": "Κοντά", "tab.mine": "Δικές μου", "tab.wait": "Σε αναμονή",
      "zoomin": "Κάνε zoom για να δεις τις σημειώσεις της περιοχής.",
      "loading": "Φόρτωση σημειώσεων…",
      "none": "Καμία σημείωση εδώ. Πάτα παρατεταμένα στον χάρτη (δεξί κλικ σε υπολογιστή) για να αναφέρεις κάτι.",
      "loadfail": "Οι σημειώσεις δεν φόρτωσαν. Έλεγξε τη σύνδεση.",
      "new": "Νέα σημείωση στο κέντρο του χάρτη",
      "ctx": "Αναφορά στο OpenStreetMap",
      "signin": "Σύνδεση με OpenStreetMap",
      "signout": "Αποσύνδεση",
      "signedas": "Συνδεδεμένος ως {u}",
      "signedout": "Δεν έχεις συνδεθεί. Διαβάζεις σημειώσεις· για να γράψεις χρειάζεσαι δωρεάν λογαριασμό OpenStreetMap.",
      "notcfg": "Η σύνδεση με OpenStreetMap δεν έχει ρυθμιστεί ακόμα σε αυτή την έκδοση. Ό,τι γράψεις κρατιέται και στέλνεται μόλις ρυθμιστεί.",
      "signin.ok": "Συνδέθηκες στο OpenStreetMap",
      "signin.fail": "Η σύνδεση με OpenStreetMap απέτυχε",
      "signin.denied": "Η σύνδεση ακυρώθηκε",
      "server": "Διακομιστής",
      "server.live": "OpenStreetMap",
      "server.dev": "Δοκιμαστικός (οι αλλαγές δεν μπαίνουν στον πραγματικό χάρτη)",
      "upload": "Σχόλιο καταχώρησης",
      "upload.hint": "Μπαίνει σε ό,τι στέλνεις στο OpenStreetMap (αλλαγές χάρτη, και στο τέλος νέων σημειώσεων). Κενό = προεπιλογή.",
      "status.open": "Ανοιχτή", "status.closed": "Λύθηκε", "status.hidden": "Κρυμμένη",
      "act.opened": "δημιούργησε", "act.commented": "σχολίασε", "act.closed": "έλυσε",
      "act.reopened": "άνοιξε ξανά", "act.hidden": "έκρυψε",
      "anon": "ανώνυμος",
      "back": "Πίσω", "close": "Κλείσιμο",
      "comment.ph": "Γράψε ένα σχόλιο…",
      "do.comment": "Σχόλιο", "do.close": "Λύθηκε", "do.reopen": "Άνοιγμα ξανά",
      "onosm": "Άνοιγμα στο openstreetmap.org",
      "new.title": "Νέα σημείωση OpenStreetMap",
      "new.ph": "Τι λείπει ή τι είναι λάθος στον χάρτη εδώ; Γράψε συγκεκριμένα: θα το διαβάσουν άλλοι χαρτογράφοι.",
      "new.sig": "Τελευταία γραμμή",
      "new.near": "Υπάρχει ήδη ανοιχτή σημείωση κοντά:",
      "new.view": "Προβολή",
      "send": "Αποστολή", "cancel": "Άκυρο", "signsend": "Σύνδεση και αποστολή",
      "sent": "Στάλθηκε στο OpenStreetMap",
      "queued": "Αποθηκεύτηκε. Θα σταλεί όταν έχεις σύνδεση και είσαι συνδεδεμένος.",
      "conflict": "Η σημείωση άλλαξε στο μεταξύ. Δες την τελευταία της μορφή.",
      "ratelimit": "Το OpenStreetMap ζητά να πας πιο αργά. Δοκίμασε ξανά σε λίγα λεπτά.",
      "wait.none": "Τίποτα δεν περιμένει αποστολή.",
      "wait.send": "Αποστολή τώρα",
      "wait.here": "Αποστολή από εδώ",
      "wait.other": "Από άλλη συσκευή",
      "wait.del": "Διαγραφή",
      "wait.note": "Νέα σημείωση", "wait.comment": "Σχόλιο στη σημείωση #{n}",
      "wait.close": "Λύση σημείωσης #{n}", "wait.reopen": "Άνοιγμα σημείωσης #{n}",
      "mine.none": "Εδώ εμφανίζονται οι σημειώσεις που δημιουργείς ή σχολιάζεις.",
      "mine.signin": "Συνδέσου για να δεις τις σημειώσεις σου.",
      "replies": "{n} σημειώσεις σου στο OpenStreetMap έχουν νέες απαντήσεις",
      "reply1": "Μια σημείωσή σου στο OpenStreetMap έχει νέα απάντηση",
      "osm.section": "OpenStreetMap",
      "dist.m": "{n} μ.", "dist.km": "{n} χλμ."
    }
  };
  function t(k, vars) {
    var s = (STR[LANG][k] !== undefined ? STR[LANG][k] : STR.en[k]) || k;
    if (vars) Object.keys(vars).forEach(function (v) { s = s.split("{" + v + "}").join(String(vars[v])); });
    return s;
  }
  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined && text !== null) e.textContent = text;
    return e;
  }
  function toast(s) { (H.toast || H.localToast)(s); }
  function online() { return navigator.onLine !== false; }

  // ---------- synced slice "mapsosm" ----------
  var DATA_KEY = "oros-maps-osm-data";
  var data = O.normalize(null);
  var suppress = false;

  function syncApi() {
    try { return (window.parent && window.parent.orosSync) || window.orosSync || null; }
    catch (e) { return window.orosSync || null; }
  }
  function loadData() {
    var raw = null;
    try { raw = localStorage.getItem(DATA_KEY); } catch (e) {}
    if (!raw) return;
    try { data = O.normalize(JSON.parse(raw)); }
    catch (e) {
      try { localStorage.setItem("oros-maps-osm-rescue", raw); } catch (e2) {}
    }
  }
  function saveData() {
    data = O.normalize(data);
    try { localStorage.setItem(DATA_KEY, JSON.stringify(data)); }
    catch (e) { toast(H.storeFull || "Storage is full"); return false; }
    if (!suppress) {
      var api = syncApi();
      if (api && typeof api.markDirty === "function") api.markDirty();
    }
    return true;
  }
  function sliceGet() { return O.normalize(data); }
  function sliceSet(d) {
    if (!d || typeof d !== "object") return;
    data = O.normalize(JSON.parse(JSON.stringify(d)));
    suppress = true;
    try { localStorage.setItem(DATA_KEY, JSON.stringify(data)); } catch (e) {}
    suppress = false;
    paintDraftMarkers();
    if (panelOpen()) renderPanel();
  }

  // ---------- drafts ----------
  function draftList() {
    return Object.keys(data.drafts).map(function (k) { return data.drafts[k]; })
      .sort(function (a, b) { return a.m - b.m || (a.id < b.id ? -1 : 1); });
  }
  function newId() { return O.randomString(14).toLowerCase().replace(/[^a-z0-9]/g, "0"); }
  function addDraft(d) {
    d.id = newId();
    d.m = Date.now();
    d.dev = A.deviceId();
    d.srv = A.server();
    var n = O.normDraft(d);
    if (!n) return null;
    data.drafts[n.id] = n;
    saveData();
    paintDraftMarkers();
    return n;
  }
  function dropDraft(id) {
    var d = data.drafts[id];
    if (!d) return;
    delete data.drafts[id];
    data.tombs[id] = Math.max(Date.now(), d.m + 1);
    saveData();
    paintDraftMarkers();
  }
  function setDraftErr(id, err) {
    var d = data.drafts[id];
    if (!d) return;
    d.err = err;
    d.m = Math.max(Date.now(), d.m + 1);
    saveData();
  }

  var flushing = false;
  function flushDrafts() {
    if (flushing || !online() || !A.account()) return Promise.resolve();
    var me = A.deviceId(), srv = A.server();
    var list = draftList().filter(function (d) { return d.dev === me && d.srv === srv && !d.err; });
    if (!list.length) return Promise.resolve();
    flushing = true;
    var sent = 0;
    function next(i) {
      if (i >= list.length) return Promise.resolve();
      var d = data.drafts[list[i].id];
      if (!d) return next(i + 1);
      return sendDraft(d).then(function (note) {
        sent++;
        dropDraft(d.id);
        if (note) upsertNote(note);
        return next(i + 1);
      }, function (e) {
        if (e && e.offline) return;                       // stop, try later
        if (e && e.status === 429) { toast(t("ratelimit")); return; }
        if (e && e.status === 401) return;
        setDraftErr(d.id, (e && e.status ? e.status + " " : "") + (e && e.text || ""));
        return next(i + 1);
      });
    }
    return next(0).then(function () {
      flushing = false;
      if (sent) { toast(t("sent")); paintNotes(); if (panelOpen()) renderPanel(); }
    }, function () { flushing = false; });
  }

  function sendDraft(d) {
    var path, params = {};
    if (d.kind === "note") {
      path = "/api/0.6/notes.json";
      params = { lat: d.lat, lon: d.lon, text: d.text };
    } else {
      path = "/api/0.6/notes/" + d.note + "/" + d.kind + ".json";
      if (d.text) params.text = d.text;
    }
    return A.request("POST", path, params, d.srv).then(function (j) {
      var n = O.parseNote(j);
      if (n) rememberMine(n.id);
      return n;
    });
  }

  // ---------- notes cache + layer ----------
  var notes = {};                 // id → note
  var notesBox = null, notesAt = 0, notesBusy = false, notesErr = false;
  var layer = L.layerGroup();
  var draftLayer = L.layerGroup();
  var MIN_ZOOM = 12;
  var FRESH_MS = 5 * 60 * 1000;

  function noteIcon(status, draft) {
    var cls = "osm-note-ico " + (draft ? "draft" : status);
    var glyph = status === "closed"
      ? '<path d="M7 12.5l3.2 3.2L17 9" stroke="#fff" stroke-width="2.6" fill="none" stroke-linecap="round" stroke-linejoin="round"/>'
      : '<path d="M12 7v6" stroke="#fff" stroke-width="2.6" stroke-linecap="round"/><circle cx="12" cy="17" r="1.6" fill="#fff"/>';
    return L.divIcon({
      className: cls,
      html: '<svg width="26" height="26" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10.5"/>' + glyph + '</svg>',
      iconSize: [34, 34], iconAnchor: [17, 17]      // 34px hit area around the 26px dot
    });
  }

  function upsertNote(n) {
    notes[n.id] = n;
    paintNotes();
  }

  function paintNotes() {
    layer.clearLayers();
    if (!modeOn) return;
    Object.keys(notes).forEach(function (id) {
      var n = notes[id];
      if (n.status === "hidden") return;
      var mk = L.marker([n.lat, n.lon], { icon: noteIcon(n.status), keyboard: true, title: "#" + n.id });
      mk.on("click", function () { openPanel(); showNote(n.id); });
      layer.addLayer(mk);
    });
  }

  function paintDraftMarkers() {
    draftLayer.clearLayers();
    if (!modeOn) return;
    draftList().forEach(function (d) {
      if (d.kind !== "note") return;
      var mk = L.marker([d.lat, d.lon], { icon: noteIcon("open", true), title: t("wait.note") });
      mk.on("click", function () { openPanel(); tab = "wait"; view = "list"; renderPanel(); });
      draftLayer.addLayer(mk);
    });
  }

  function loadNotes(force) {
    if (!modeOn) return;
    if (map.getZoom() < MIN_ZOOM) { renderPanel(); return; }
    var view = map.getBounds();
    if (!force && notesBox && notesBox.contains(view) && Date.now() - notesAt < FRESH_MS) return;
    if (notesBusy || !online()) { renderPanel(); return; }
    var box = view.pad(0.25);
    notesBusy = true; notesErr = false;
    renderPanel();
    var bbox = [box.getWest(), box.getSouth(), box.getEast(), box.getNorth()]
      .map(function (v) { return v.toFixed(5); }).join(",");
    A.request("GET", "/api/0.6/notes.json", { bbox: bbox, limit: 200, closed: 7 }).then(function (j) {
      notesBusy = false;
      notesBox = box; notesAt = Date.now();
      var keep = {};
      O.parseNotes(j).forEach(function (n) { keep[n.id] = n; });
      notes = keep;
      paintNotes();
      renderPanel();
    }, function () {
      notesBusy = false; notesErr = true;
      renderPanel();
    });
  }

  // ---------- my notes + reply check ----------
  var MINE_KEY = "oros-maps-osm-mine";     // device-local: { srv: { id: lastSeenOtherMs } }
  var mine = null;                         // fetched list (this session)
  function mineStore() {
    var s = null;
    try { s = JSON.parse(localStorage.getItem(MINE_KEY) || "null"); } catch (e) {}
    return s && typeof s === "object" ? s : {};
  }
  function mineSave(s) { try { localStorage.setItem(MINE_KEY, JSON.stringify(s)); } catch (e) {} }
  function rememberMine(id) {
    var s = mineStore(), srv = A.server();
    s[srv] = s[srv] && typeof s[srv] === "object" ? s[srv] : {};
    if (s[srv][id] === undefined) s[srv][id] = Date.now();
    mineSave(s);
  }

  function fetchMine(notify) {
    var a = A.account();
    if (!a || !a.user || !online()) return Promise.resolve();
    return A.request("GET", "/api/0.6/notes/search.json",
      { display_name: a.user, closed: 30, limit: 100, sort: "updated_at" }).then(function (j) {
      mine = O.parseNotes(j);
      var s = mineStore(), srv = A.server();
      var first = !s[srv] || typeof s[srv] !== "object";
      s[srv] = first ? {} : s[srv];
      var fresh = 0;
      mine.forEach(function (n) {
        var last = O.lastOtherDate(n, a.uid);
        var seen = s[srv][n.id];
        if (!first && seen !== undefined && last > seen) fresh++;
        if (!first && seen === undefined && last > Date.now() - 86400000 && n.comments.length > 1 &&
            n.comments[0].uid === a.uid) fresh++;
        s[srv][n.id] = Math.max(seen || 0, last);
      });
      mineSave(s);
      if (notify && fresh) toast(fresh === 1 ? t("reply1") : t("replies", { n: fresh }));
      if (panelOpen()) renderPanel();
    }, function () {});
  }

  // ---------- panel ----------
  var panel = null, modeOn = false, tab = "near", view = "list";

  function panelOpen() { return !!panel && !panel.hidden; }

  function buildPanel() {
    panel = el("aside", "");
    panel.id = "osm-panel";
    panel.hidden = true;
    panel.setAttribute("aria-label", t("title"));
    document.body.appendChild(panel);
    // Phones: the floating controls sit just above the bottom sheet.
    var setH = function () {
      document.body.style.setProperty("--osm-h", (panel.hidden ? 0 : panel.offsetHeight) + "px");
    };
    try { new ResizeObserver(setH).observe(panel); } catch (e) {}
    panel.addEventListener("transitionend", setH);
    window.addEventListener("resize", setH);
  }

  function openPanel() {
    if (!modeOn) setMode(true);
    panel.hidden = false;
  }

  function header(titleText, backFn) {
    var h = el("header", "");
    if (backFn) {
      var b = el("button", "osm-iconbtn");
      b.type = "button";
      b.setAttribute("aria-label", t("back"));
      b.title = t("back");
      b.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg>';
      b.addEventListener("click", backFn);
      h.appendChild(b);
    }
    h.appendChild(el("h3", "", titleText));
    var c = el("button", "osm-iconbtn osm-close");
    c.type = "button";
    c.setAttribute("aria-label", t("close"));
    c.title = t("close");
    c.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>';
    c.addEventListener("click", function () { setMode(false); });
    h.appendChild(c);
    return h;
  }

  function accountBox() {
    var box = el("div", "osm-acc");
    var a = A.account();
    if (a) {
      box.appendChild(el("span", "osm-acc-txt", t("signedas", { u: a.user || "…" })));
    } else if (!A.configured()) {
      box.appendChild(el("span", "osm-acc-txt", t("notcfg")));
    } else {
      box.appendChild(el("span", "osm-acc-txt", t("signedout")));
      var b = el("button", "osm-btn primary", t("signin"));
      b.type = "button";
      b.addEventListener("click", doSignIn);
      box.appendChild(b);
    }
    return box;
  }

  function fmtDist(m) {
    return m < 1000 ? t("dist.m", { n: Math.round(m) })
                    : t("dist.km", { n: (m / 1000).toFixed(m < 10000 ? 1 : 0) });
  }
  function fmtDate(s) {
    var ms = O.osmDate(s);
    if (!ms) return s || "";
    try {
      return new Intl.DateTimeFormat(LANG === "el" ? "el-GR" : "en-GB",
        { day: "numeric", month: "short", year: "numeric" }).format(new Date(ms));
    } catch (e) { return new Date(ms).toISOString().slice(0, 10); }
  }
  function snippet(n) {
    var c = n.comments[0];
    var s = c ? c.text.replace(/\s+/g, " ") : "";
    return s.length > 110 ? s.slice(0, 108) + "…" : s || ("#" + n.id);
  }

  function noteRow(n, center) {
    var li = el("li", "osm-row");
    li.tabIndex = 0;
    var ico = el("span", "osm-row-ico " + n.status);
    ico.innerHTML = n.status === "closed"
      ? '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>'
      : '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"><path d="M12 5v9"/><circle cx="12" cy="19" r="1.4" fill="currentColor"/></svg>';
    li.appendChild(ico);
    var body = el("div", "osm-row-body");
    body.appendChild(el("div", "osm-row-t", snippet(n)));
    var meta = [fmtDate(n.created), t("status." + n.status)];
    if (center) meta.unshift(fmtDist(O.distM(center.lat, center.lng, n.lat, n.lon)));
    if (n.comments.length > 1) meta.push("💬 " + (n.comments.length - 1));
    body.appendChild(el("div", "osm-row-s", meta.join(" · ")));
    li.appendChild(body);
    function go() { notes[n.id] = notes[n.id] || n; showNote(n.id); }
    li.addEventListener("click", go);
    li.addEventListener("keydown", function (e) { if (e.key === "Enter") go(); });
    return li;
  }

  function renderPanel() {
    if (!panel) return;
    if (view.indexOf("note:") === 0) { renderNote(+view.slice(5)); return; }
    panel.textContent = "";
    panel.appendChild(header(t("title")));
    var body = el("div", "osm-body");
    body.appendChild(accountBox());

    var tabs = el("div", "osm-tabs");
    tabs.setAttribute("role", "tablist");
    var waitN = draftList().length;
    [["near", t("tab.near")], ["mine", t("tab.mine")], ["wait", t("tab.wait") + (waitN ? " (" + waitN + ")" : "")]]
      .forEach(function (x) {
        var b = el("button", "osm-tab" + (tab === x[0] ? " on" : ""), x[1]);
        b.type = "button";
        b.setAttribute("role", "tab");
        b.setAttribute("aria-selected", tab === x[0] ? "true" : "false");
        b.addEventListener("click", function () {
          tab = x[0];
          if (tab === "mine" && !mine) fetchMine(false);
          renderPanel();
        });
        tabs.appendChild(b);
      });
    body.appendChild(tabs);

    if (tab === "near") renderNear(body);
    else if (tab === "mine") renderMine(body);
    else renderWait(body);
    panel.appendChild(body);
  }

  function renderNear(body) {
    var nb = el("button", "osm-btn", t("new"));
    nb.type = "button";
    nb.addEventListener("click", function () {
      var c = map.getCenter();
      newNote(c.lat, c.lng);
    });
    body.appendChild(nb);
    if (map.getZoom() < MIN_ZOOM) { body.appendChild(el("p", "osm-hint", t("zoomin"))); return; }
    if (notesBusy) body.appendChild(el("p", "osm-hint", t("loading")));
    else if (notesErr) body.appendChild(el("p", "osm-hint", t("loadfail")));
    var c = map.getCenter();
    var list = Object.keys(notes).map(function (k) { return notes[k]; })
      .filter(function (n) { return n.status !== "hidden"; })
      .sort(function (a, b) {
        if (a.status !== b.status) return a.status === "open" ? -1 : 1;
        return O.distM(c.lat, c.lng, a.lat, a.lon) - O.distM(c.lat, c.lng, b.lat, b.lon);
      });
    if (!list.length && !notesBusy && !notesErr) { body.appendChild(el("p", "osm-hint", t("none"))); return; }
    var ul = el("ul", "osm-list");
    list.slice(0, 100).forEach(function (n) { ul.appendChild(noteRow(n, c)); });
    body.appendChild(ul);
  }

  function renderMine(body) {
    if (!A.account()) { body.appendChild(el("p", "osm-hint", t("mine.signin"))); return; }
    if (!mine) { body.appendChild(el("p", "osm-hint", t("loading"))); return; }
    if (!mine.length) { body.appendChild(el("p", "osm-hint", t("mine.none"))); return; }
    var ul = el("ul", "osm-list");
    mine.forEach(function (n) { ul.appendChild(noteRow(n, null)); });
    body.appendChild(ul);
  }

  function renderWait(body) {
    var list = draftList();
    if (!list.length) { body.appendChild(el("p", "osm-hint", t("wait.none"))); return; }
    var me = A.deviceId();
    var mineHere = list.some(function (d) { return d.dev === me && d.srv === A.server(); });
    if (A.account() && online() && mineHere) {
      var sb = el("button", "osm-btn primary", t("wait.send"));
      sb.type = "button";
      sb.addEventListener("click", function () {
        draftList().forEach(function (d) { if (d.dev === me && d.err) { delete d.err; } });
        saveData();
        flushDrafts().then(renderPanel);
      });
      body.appendChild(sb);
    }
    var ul = el("ul", "osm-list");
    list.forEach(function (d) {
      var li = el("li", "osm-row draft");
      var b = el("div", "osm-row-body");
      var label = d.kind === "note" ? t("wait.note") : t("wait." + d.kind, { n: d.note });
      b.appendChild(el("div", "osm-row-t", label + (d.text ? ": " + d.text.replace(/\s+/g, " ").slice(0, 90) : "")));
      var meta = [];
      if (d.srv === "dev") meta.push(t("server.dev").split(" (")[0]);
      if (d.dev !== me) meta.push(t("wait.other"));
      if (d.err) meta.push("⚠ " + d.err);
      if (meta.length) b.appendChild(el("div", "osm-row-s", meta.join(" · ")));
      li.appendChild(b);
      if (d.kind === "note") {
        li.addEventListener("click", function (e) {
          if (e.target.closest("button")) return;
          map.setView([d.lat, d.lon], Math.max(map.getZoom(), 17));
        });
      }
      if (d.dev !== me) {
        var hb = el("button", "osm-mini", t("wait.here"));
        hb.type = "button";
        hb.addEventListener("click", function () {
          var x = data.drafts[d.id];
          if (!x) return;
          x.dev = me; delete x.err; x.m = Math.max(Date.now(), x.m + 1);
          saveData();
          flushDrafts().then(renderPanel);
          renderPanel();
        });
        li.appendChild(hb);
      }
      var del = el("button", "osm-mini danger", t("wait.del"));
      del.type = "button";
      del.addEventListener("click", function () { dropDraft(d.id); renderPanel(); });
      li.appendChild(del);
      ul.appendChild(li);
    });
    body.appendChild(ul);
  }

  function showNote(id) {
    view = "note:" + id;
    renderPanel();
    var n = notes[id];
    if (n) map.panTo([n.lat, n.lon]);
    if (!online()) return;
    A.request("GET", "/api/0.6/notes/" + id + ".json").then(function (j) {
      var fresh = O.parseNote(j);
      if (fresh) { notes[fresh.id] = fresh; paintNotes(); if (view === "note:" + id) renderPanel(); }
    }, function () {});
  }

  function textWithLinks(parent, text) {
    O.splitLinks(text).forEach(function (part) {
      if (part.t === "link") {
        var a = el("a", "", part.v);
        a.href = part.v;
        a.target = "_blank";
        a.rel = "noopener noreferrer";
        parent.appendChild(a);
      } else parent.appendChild(document.createTextNode(part.v));
    });
  }

  function renderNote(id) {
    var n = notes[id] || (mine || []).filter(function (x) { return x.id === id; })[0];
    panel.textContent = "";
    panel.appendChild(header("#" + id, function () { view = "list"; renderPanel(); }));
    var body = el("div", "osm-body");
    if (!n) { body.appendChild(el("p", "osm-hint", t("loading"))); panel.appendChild(body); return; }
    body.appendChild(el("span", "osm-badge " + n.status, t("status." + n.status)));
    var ol = el("ol", "osm-thread");
    n.comments.forEach(function (c) {
      var li = el("li", "");
      var who = el("div", "osm-who");
      who.appendChild(el("b", "", c.user || t("anon")));
      who.appendChild(document.createTextNode(" " + t("act." + c.action) + " · " + fmtDate(c.date)));
      li.appendChild(who);
      if (c.text) {
        var p = el("p", "osm-text");
        textWithLinks(p, c.text);
        li.appendChild(p);
      }
      ol.appendChild(li);
    });
    body.appendChild(ol);

    var pend = draftList().filter(function (d) { return d.note === id; });
    pend.forEach(function (d) {
      body.appendChild(el("p", "osm-hint", "⏳ " + t("wait." + d.kind, { n: id }) + (d.text ? ": " + d.text : "")));
    });

    if (n.status !== "hidden") {
      var ta = el("textarea", "osm-ta");
      ta.placeholder = t("comment.ph");
      ta.maxLength = O.LIM.commentText;
      ta.rows = 3;
      ta.setAttribute("aria-label", t("comment.ph"));
      body.appendChild(ta);
      var row = el("div", "osm-actions");
      function btn(label, cls, fn) {
        var b = el("button", "osm-btn " + cls, label);
        b.type = "button";
        b.addEventListener("click", fn);
        row.appendChild(b);
        return b;
      }
      btn(t("do.comment"), "primary", function () {
        if (!ta.value.trim()) { ta.focus(); return; }
        noteAction("comment", n, ta.value);
      });
      if (n.status === "open") btn(t("do.close"), "", function () { noteAction("close", n, ta.value); });
      else btn(t("do.reopen"), "", function () { noteAction("reopen", n, ta.value); });
      body.appendChild(row);
    }
    var link = el("a", "osm-ext", t("onosm"));
    link.href = O.SERVERS[A.server()].web + "/note/" + id;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    body.appendChild(link);
    panel.appendChild(body);
  }

  // ---------- writing ----------
  function ensureAccount() {
    if (A.account()) return Promise.resolve(true);
    if (!A.configured() || !online()) return Promise.resolve(false);
    return doSignIn().then(function () { return !!A.account(); }, function () { return false; });
  }

  function queue(d) {
    if (addDraft(d)) toast(t("queued"));
    if (panelOpen()) renderPanel();
  }

  function noteAction(kind, n, text) {
    text = O.cleanText(text, O.LIM.commentText);
    var draft = { kind: kind, note: n.id, text: text };
    if (!online()) { queue(draft); return; }
    ensureAccount().then(function (ok) {
      if (!ok) { queue(draft); return; }
      var params = text ? { text: text } : {};
      A.request("POST", "/api/0.6/notes/" + n.id + "/" + kind + ".json", params).then(function (j) {
        var fresh = O.parseNote(j);
        rememberMine(n.id);
        if (fresh) upsertNote(fresh);
        toast(t("sent"));
        renderPanel();
      }, function (e) {
        if (e && (e.offline || e.status >= 500)) { queue(draft); return; }
        if (e && e.status === 429) { toast(t("ratelimit")); return; }
        if (e && e.status === 409) { toast(t("conflict")); showNote(n.id); return; }
        toast((e && e.text) || t("signin.fail"));
      });
    });
  }

  function dialogBase(titleText) {
    var dlg = el("dialog", "osm-dlg");
    dlg.appendChild(el("h3", "", titleText));
    dlg.addEventListener("cancel", function (e) { e.preventDefault(); closeDlg(dlg); });
    return dlg;
  }
  function closeDlg(dlg) { if (dlg.open) dlg.close(); dlg.remove(); }

  function newNote(lat, lon) {
    if (!modeOn) setMode(true);
    var dlg = dialogBase(t("new.title"));
    var near = O.nearNotes(Object.keys(notes).map(function (k) { return notes[k]; }), lat, lon, 50);
    if (near.length) {
      var w = el("div", "osm-warn");
      w.appendChild(el("p", "", t("new.near")));
      near.slice(0, 3).forEach(function (n) {
        var r = el("div", "osm-warn-row");
        r.appendChild(el("span", "", snippet(n)));
        var v = el("button", "osm-mini", t("new.view"));
        v.type = "button";
        v.addEventListener("click", function () { closeDlg(dlg); openPanel(); showNote(n.id); });
        r.appendChild(v);
        w.appendChild(r);
      });
      dlg.appendChild(w);
    }
    var ta = el("textarea", "osm-ta");
    ta.placeholder = t("new.ph");
    ta.rows = 5;
    ta.maxLength = O.LIM.noteText - 120;
    ta.setAttribute("aria-label", t("new.title"));
    dlg.appendChild(ta);
    var lab = el("label", "osm-lab", t("new.sig"));
    var sig = el("input", "osm-in");
    sig.type = "text";
    sig.maxLength = 100;
    sig.value = O.uploadComment(data);
    lab.appendChild(sig);
    dlg.appendChild(lab);
    var row = el("div", "osm-actions");
    var needSign = !A.account() && A.configured() && online();
    var ok = el("button", "osm-btn primary", needSign ? t("signsend") : t("send"));
    ok.type = "button";
    var no = el("button", "osm-btn", t("cancel"));
    no.type = "button";
    no.addEventListener("click", function () { closeDlg(dlg); });
    ok.addEventListener("click", function () {
      var body = O.cleanText(ta.value, O.LIM.noteText - 120);
      if (!body) { ta.focus(); return; }
      var s = O.cleanText(sig.value, 100).replace(/\s+/g, " ");
      var text = s ? body + "\n\n" + s : body;
      closeDlg(dlg);
      sendNewNote(lat, lon, text);
    });
    row.appendChild(ok);
    row.appendChild(no);
    dlg.appendChild(row);
    document.body.appendChild(dlg);
    dlg.showModal();
    ta.focus();
  }

  function sendNewNote(lat, lon, text) {
    var draft = { kind: "note", lat: lat, lon: lon, text: text };
    if (!online()) { queue(draft); return; }
    ensureAccount().then(function (ok) {
      if (!ok) { queue(draft); return; }
      A.request("POST", "/api/0.6/notes.json", { lat: lat.toFixed(7), lon: lon.toFixed(7), text: text }).then(function (j) {
        var n = O.parseNote(j);
        toast(t("sent"));
        if (n) { rememberMine(n.id); upsertNote(n); openPanel(); showNote(n.id); }
        mine = null;
      }, function (e) {
        if (e && (e.offline || e.status >= 500)) { queue(draft); return; }
        if (e && e.status === 429) { toast(t("ratelimit")); queue(draft); return; }
        toast((e && e.text) || t("signin.fail"));
      });
    });
  }

  // ---------- sign-in ----------
  function doSignIn() {
    if (!A.configured()) { toast(t("notcfg")); return Promise.reject(); }
    return A.signIn().then(function () {
      toast(t("signin.ok"));
    }, function (e) {
      toast(e && e.text === "denied" ? t("signin.denied") : t("signin.fail"));
      throw e;
    });
  }

  A.onChange(function () {
    mine = null;
    paintSettings();
    if (panelOpen()) renderPanel();
    if (A.account()) { flushDrafts(); }
  });

  // ---------- mode ----------
  var modeBtn = null;
  function setMode(on) {
    modeOn = !!on;
    document.body.classList.toggle("osm-mode", modeOn);
    if (modeBtn) {
      modeBtn.classList.toggle("on", modeOn);
      modeBtn.setAttribute("aria-pressed", modeOn ? "true" : "false");
    }
    if (modeOn) {
      layer.addTo(map); draftLayer.addTo(map);
      panel.hidden = false;
      view = "list";
      paintNotes(); paintDraftMarkers();
      loadNotes(false);
      renderPanel();
      flushDrafts();
    } else {
      map.removeLayer(layer); map.removeLayer(draftLayer);
      panel.hidden = true;
    }
  }

  var moveTimer = null;
  map.on("moveend", function () {
    if (!modeOn) return;
    clearTimeout(moveTimer);
    moveTimer = setTimeout(function () {
      loadNotes(false);
      if (view === "list" && tab === "near") renderPanel();
    }, 600);
  });

  // ---------- settings drawer section ----------
  var setBox = null;
  function paintSettings() {
    if (!setBox) return;
    setBox.textContent = "";
    setBox.appendChild(el("h4", "", t("osm.section")));
    var a = A.account();
    setBox.appendChild(el("p", "", a ? t("signedas", { u: a.user || "…" }) : (A.configured() ? t("signedout") : t("notcfg"))));
    if (a) {
      var so = el("button", "ms-btn danger", t("signout"));
      so.type = "button";
      so.addEventListener("click", function () { A.signOut(); });
      setBox.appendChild(so);
    } else if (A.configured()) {
      var si = el("button", "ms-btn", t("signin"));
      si.type = "button";
      si.addEventListener("click", function () { doSignIn().catch(function () {}); });
      setBox.appendChild(si);
    }
    var l1 = el("label", "osm-lab", t("server"));
    var sel = el("select", "osm-in");
    [["live", t("server.live")], ["dev", t("server.dev")]].forEach(function (x) {
      var o = el("option", "", x[1]);
      o.value = x[0];
      if (A.server() === x[0]) o.selected = true;
      sel.appendChild(o);
    });
    sel.addEventListener("change", function () {
      A.setServer(sel.value);
      notes = {}; notesBox = null;
      paintNotes(); loadNotes(true);
    });
    l1.appendChild(sel);
    setBox.appendChild(l1);
    var l2 = el("label", "osm-lab", t("upload"));
    var inp = el("input", "osm-in");
    inp.type = "text";
    inp.maxLength = O.LIM.setComment;
    inp.placeholder = O.DEFAULT_COMMENT;
    inp.value = data.set.comment || "";
    inp.addEventListener("change", function () {
      var v = O.cleanText(inp.value, O.LIM.setComment).replace(/\s+/g, " ");
      if (v === O.DEFAULT_COMMENT) v = "";
      if (v === data.set.comment) return;
      data.set = { m: Math.max(Date.now(), data.set.m + 1), comment: v };
      saveData();
      inp.value = v;
    });
    l2.appendChild(inp);
    setBox.appendChild(l2);
    setBox.appendChild(el("p", "osm-small", t("upload.hint")));
  }

  // ---------- boot ----------
  var ICON_MODE = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 21V4"/><path d="M4 4h12l-2 4 2 4H4"/></svg>';
  function boot() {
    loadData();
    buildPanel();
    var controls = document.getElementById("controls");
    if (controls) {
      modeBtn = el("button", "");
      modeBtn.id = "osm-btn";
      modeBtn.type = "button";
      modeBtn.title = t("btn");
      modeBtn.setAttribute("aria-label", t("btn"));
      modeBtn.setAttribute("aria-pressed", "false");
      modeBtn.innerHTML = ICON_MODE;
      modeBtn.addEventListener("click", function () { setMode(!modeOn); });
      var before = document.getElementById("geo-btn");
      controls.insertBefore(modeBtn, before || null);
    }
    var sbody = document.getElementById("mapsettings-body");
    if (sbody) {
      setBox = el("div", "osm-settings");
      sbody.insertBefore(setBox, sbody.firstChild);
      paintSettings();
    }
    if (Array.isArray(H.ctxItems)) {
      H.ctxItems.push(function (place) {
        return { icon: ICON_MODE.replace(/18/g, "14"), label: t("ctx"), run: function () { newNote(place.lat, place.lon); } };
      });
    }
    var api = syncApi();
    if (api && typeof api.registerSlice === "function") {
      api.registerSlice("mapsosm", sliceGet, sliceSet, DATA_KEY, O.merge);
    }
    window.addEventListener("online", function () { flushDrafts(); if (modeOn) loadNotes(true); });
    A.finishPending().catch(function () {});
    if (A.account() && online()) {
      setTimeout(function () { flushDrafts(); fetchMine(true); }, 3000);
    }
  }

  // test hook (harness): read-only views of the state
  window.__orosMapsNotes = {
    data: function () { return O.normalize(data); },
    notes: function () { return notes; },
    setMode: setMode, newNote: newNote, flush: flushDrafts, fetchMine: fetchMine
  };

  boot();
})();
