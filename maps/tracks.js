// ============================================================
// orOS Maps — tracks.js (GPX tracks, OsmAnd style; OSM upgrade wave 3,
// v1.0.0)
// "My tracks" panel (route button):
//   - Record: Start / Pause / Stop with live distance, time, speed and
//     elevation. Fixes worse than 50 m and tiny moves are dropped
//     (tracks-core.js accept). While recording the screen is kept on
//     (Wake Lock); the browser stops GPS when the screen goes off or
//     orOS goes to the background, so the track then has a gap.
//     Points are saved to IndexedDB "oros-maps-rec" every 10 s, so a
//     closed tab or a crash loses nothing: next time Maps offers
//     Continue / Save / Discard. Recording goes on with the panel
//     closed (a chip on the map shows it).
//   - Library: every track is a GPX file /internal/Maps/Tracks/<id>.gpx
//     on the orOS disk (Files, Vault Drive) plus an index entry in the
//     synced slice "mapstracks" with its statistics and a small preview
//     line, so another device draws it before the file arrives.
//     Colour, folder, show / hide on the map, search.
//   - A track: statistics, elevation or speed chart, Fit, Follow (the
//     line + your distance from it and the distance left), export GPX,
//     rename / colour / folder, delete.
//   - Import GPX, KML or GeoJSON (Import button, or "Open with" orOS).
//
// Safety: names from files go on the page with textContent only;
// files are read by the strict scanner in tracks-core.js (no DOM, no
// scripts, 20 MB / 500,000 points).
// ============================================================
(function () {
  "use strict";
  var T = window.OrosMapsTracks;
  var H = window.__orosMapsHost;
  if (!T || !H || !H.map) return;
  var map = H.map;
  var LANG = H.lang === "el" ? "el" : "en";

  var STR = {
    en: {
      "btn": "My tracks (GPX)",
      "title": "My tracks",
      "rec.start": "Start recording",
      "rec.pause": "Pause", "rec.resume": "Resume", "rec.stop": "Stop",
      "rec.on": "Recording", "rec.paused": "Paused",
      "rec.wait": "Waiting for GPS…",
      "rec.nogps": "Location is not available on this device.",
      "rec.denied": "Maps may not use your location. Allow it in the browser to record.",
      "rec.save.title": "Save the track",
      "rec.name": "Name",
      "rec.save": "Save", "rec.discard": "Discard", "rec.keep": "Keep recording",
      "rec.discard.ask": "Throw this recording away?",
      "rec.short": "Too short to save: nothing was recorded yet.",
      "rec.saved": "Track saved",
      "rec.resume.title": "Unfinished recording",
      "rec.resume.text": "A recording from {when} was not finished ({d}).",
      "rec.continue": "Continue",
      "rec.screen": "Keep the screen on: with the screen off the browser stops GPS and the track gets a gap.",
      "rec.chip": "REC {d}",
      "follow.chip": "Following · {d}",
      "import": "Import file",
      "import.bad": "That file has no track Maps can read (GPX, KML, GeoJSON).",
      "import.big": "That file is too big (20 MB at most).",
      "import.ok": "Imported: {n}",
      "search.ph": "Search tracks",
      "folder.all": "All folders",
      "none": "No tracks yet. Record one or import a GPX file.",
      "nomatch": "No track matches.",
      "show": "Show on the map", "hide": "Hide from the map",
      "unnamed": "Track",
      "st.dist": "Distance", "st.time": "Time", "st.moving": "Moving", "st.avg": "Average",
      "st.top": "Top speed", "st.up": "Climb", "st.down": "Descent", "st.pts": "Points",
      "chart.ele": "Elevation", "chart.speed": "Speed", "chart.none": "No elevation or time in this track.",
      "fit": "Show all", "follow": "Follow", "follow.stop": "Stop following",
      "follow.off": "Off the track by {d}", "follow.on": "On the track", "follow.left": "{d} to the end",
      "export": "Export GPX", "details": "Name, colour, folder",
      "folder": "Folder", "color": "Colour",
      "del": "Delete", "del.ask": "Delete “{n}”? Its GPX file leaves the orOS disk too.",
      "deleted": "Track deleted",
      "missing": "This track's GPX file is not on this device yet. It arrives with Vault Drive; until then you see a simplified line.",
      "nofs": "The orOS disk is not available.",
      "savefail": "Could not save the GPX file.",
      "nodlg": "Saving files is not available here.",
      "save": "Save", "cancel": "Cancel", "back": "Back", "close": "Close", "yes": "Yes",
      "km": "{n} km", "m": "{n} m", "kmh": "{n} km/h",
      "heat": "Heatmap and statistics",
      "edit": "Edit",
      "ed.title": "Edit: {n}",
      "ed.sel": "Selected: points {a}–{b} of {n} · {d}",
      "ed.from": "Start of selection", "ed.to": "End of selection",
      "ed.keep": "Keep only the selection", "ed.cut": "Remove the selection",
      "ed.split": "Split at the start",
      "ed.split.ask": "Split “{n}” into two tracks at the start of the selection? Both are saved now.",
      "ed.split.name": "{n} (2)",
      "ed.split.ok": "Split into two tracks",
      "ed.simp": "Simplify", "ed.simp.tol": "Tolerance", "ed.simp.res": "{a} → {b} points",
      "ed.join": "Join with", "ed.join.pick": "Choose a track", "ed.join.btn": "Join",
      "ed.join.big": "Together they have too many points (500,000 at most).",
      "ed.undo": "Undo", "ed.save": "Save changes", "ed.cancel": "Cancel",
      "ed.drop": "Throw the unsaved changes away?",
      "ed.saved": "Changes saved",
      "ed.hint": "Move the two sliders to select part of the track. Nothing is saved until you tap Save changes.",
      "up": "Upload to OSM",
      "up.title": "Upload to OpenStreetMap GPS traces",
      "up.desc": "Description", "up.tags": "Tags (comma separated)",
      "up.vis": "Visibility",
      "up.v.private": "Private", "up.v.trackable": "Trackable", "up.v.public": "Public", "up.v.identifiable": "Identifiable",
      "up.vis.private": "Private: only you see the trace; its points appear anonymously in the GPS layer",
      "up.vis.trackable": "Trackable: anonymous, but with times, so others can see how fast you went",
      "up.vis.public": "Public: listed under your name, points without times",
      "up.vis.identifiable": "Identifiable: listed under your name with the full track and times",
      "up.again": "This track is already on OpenStreetMap. Uploading again makes a second copy.",
      "up.notime": "OpenStreetMap needs a time on the points. This track has none (often a planned route or an export without times).",
      "up.go": "Upload", "up.busy": "Uploading…",
      "up.ok": "Uploaded to OpenStreetMap",
      "up.fail": "The upload failed: {e}",
      "up.offline": "You are offline. Upload when you are online.",
      "up.signin": "OpenStreetMap sign-in is not set up yet.",
      "up.denied": "OpenStreetMap signed you out. Sign in again and retry.",
      "up.view": "View on OpenStreetMap"
    },
    el: {
      "btn": "Οι διαδρομές μου (GPX)",
      "title": "Οι διαδρομές μου",
      "rec.start": "Έναρξη καταγραφής",
      "rec.pause": "Παύση", "rec.resume": "Συνέχεια", "rec.stop": "Τέλος",
      "rec.on": "Καταγραφή", "rec.paused": "Σε παύση",
      "rec.wait": "Αναμονή για GPS…",
      "rec.nogps": "Η τοποθεσία δεν είναι διαθέσιμη σε αυτή τη συσκευή.",
      "rec.denied": "Οι Χάρτες δεν έχουν άδεια για την τοποθεσία σου. Επίτρεψέ τη στον browser για να καταγράψεις.",
      "rec.save.title": "Αποθήκευση διαδρομής",
      "rec.name": "Όνομα",
      "rec.save": "Αποθήκευση", "rec.discard": "Απόρριψη", "rec.keep": "Συνέχεια καταγραφής",
      "rec.discard.ask": "Να πεταχτεί αυτή η καταγραφή;",
      "rec.short": "Πολύ μικρή για αποθήκευση: δεν καταγράφηκε τίποτα ακόμα.",
      "rec.saved": "Η διαδρομή αποθηκεύτηκε",
      "rec.resume.title": "Καταγραφή που δεν τελείωσε",
      "rec.resume.text": "Μια καταγραφή από {when} δεν ολοκληρώθηκε ({d}).",
      "rec.continue": "Συνέχεια",
      "rec.screen": "Κράτα την οθόνη αναμμένη: με σβηστή οθόνη ο browser σταματά το GPS και η διαδρομή έχει κενό.",
      "rec.chip": "REC {d}",
      "follow.chip": "Ακολουθείς · {d}",
      "import": "Εισαγωγή αρχείου",
      "import.bad": "Το αρχείο δεν έχει διαδρομή που διαβάζουν οι Χάρτες (GPX, KML, GeoJSON).",
      "import.big": "Το αρχείο είναι πολύ μεγάλο (έως 20 MB).",
      "import.ok": "Εισήχθη: {n}",
      "search.ph": "Αναζήτηση διαδρομών",
      "folder.all": "Όλοι οι φάκελοι",
      "none": "Καμία διαδρομή ακόμα. Κατέγραψε μία ή φέρε ένα αρχείο GPX.",
      "nomatch": "Καμία διαδρομή δεν ταιριάζει.",
      "show": "Εμφάνιση στον χάρτη", "hide": "Απόκρυψη από τον χάρτη",
      "unnamed": "Διαδρομή",
      "st.dist": "Απόσταση", "st.time": "Χρόνος", "st.moving": "Σε κίνηση", "st.avg": "Μέση ταχύτητα",
      "st.top": "Μέγιστη ταχύτητα", "st.up": "Ανάβαση", "st.down": "Κατάβαση", "st.pts": "Σημεία",
      "chart.ele": "Υψόμετρο", "chart.speed": "Ταχύτητα", "chart.none": "Η διαδρομή δεν έχει υψόμετρο ή χρόνο.",
      "fit": "Όλη η διαδρομή", "follow": "Ακολούθησε", "follow.stop": "Τέλος ακολούθησης",
      "follow.off": "Εκτός διαδρομής κατά {d}", "follow.on": "Πάνω στη διαδρομή", "follow.left": "{d} ως το τέλος",
      "export": "Εξαγωγή GPX", "details": "Όνομα, χρώμα, φάκελος",
      "folder": "Φάκελος", "color": "Χρώμα",
      "del": "Διαγραφή", "del.ask": "Να διαγραφεί η «{n}»; Φεύγει και το αρχείο GPX από τον δίσκο του orOS.",
      "deleted": "Η διαδρομή διαγράφηκε",
      "missing": "Το αρχείο GPX αυτής της διαδρομής δεν έχει έρθει ακόμα σε αυτή τη συσκευή. Έρχεται με το Vault Drive· ως τότε βλέπεις μια απλοποιημένη γραμμή.",
      "nofs": "Ο δίσκος του orOS δεν είναι διαθέσιμος.",
      "savefail": "Το αρχείο GPX δεν αποθηκεύτηκε.",
      "nodlg": "Η αποθήκευση αρχείων δεν είναι διαθέσιμη εδώ.",
      "save": "Αποθήκευση", "cancel": "Άκυρο", "back": "Πίσω", "close": "Κλείσιμο", "yes": "Ναι",
      "km": "{n} χλμ.", "m": "{n} μ.", "kmh": "{n} χλμ./ώ",
      "heat": "Heatmap και στατιστικά",
      "edit": "Επεξεργασία",
      "ed.title": "Επεξεργασία: {n}",
      "ed.sel": "Επιλογή: σημεία {a}–{b} από {n} · {d}",
      "ed.from": "Αρχή επιλογής", "ed.to": "Τέλος επιλογής",
      "ed.keep": "Κράτα μόνο την επιλογή", "ed.cut": "Αφαίρεσε την επιλογή",
      "ed.split": "Χώρισε στην αρχή",
      "ed.split.ask": "Να χωριστεί η «{n}» σε δύο διαδρομές στην αρχή της επιλογής; Αποθηκεύονται και οι δύο τώρα.",
      "ed.split.name": "{n} (2)",
      "ed.split.ok": "Χωρίστηκε σε δύο διαδρομές",
      "ed.simp": "Απλοποίηση", "ed.simp.tol": "Ανοχή", "ed.simp.res": "{a} → {b} σημεία",
      "ed.join": "Ένωση με", "ed.join.pick": "Διάλεξε διαδρομή", "ed.join.btn": "Ένωση",
      "ed.join.big": "Μαζί έχουν πάρα πολλά σημεία (έως 500.000).",
      "ed.undo": "Αναίρεση", "ed.save": "Αποθήκευση αλλαγών", "ed.cancel": "Άκυρο",
      "ed.drop": "Να πεταχτούν οι αλλαγές που δεν αποθηκεύτηκαν;",
      "ed.saved": "Οι αλλαγές αποθηκεύτηκαν",
      "ed.hint": "Μετακίνησε τους δύο δρομείς για να επιλέξεις κομμάτι της διαδρομής. Τίποτα δεν αποθηκεύεται πριν πατήσεις Αποθήκευση αλλαγών.",
      "up": "Ανέβασμα στο OSM",
      "up.title": "Ανέβασμα στα GPS traces του OpenStreetMap",
      "up.desc": "Περιγραφή", "up.tags": "Ετικέτες (με κόμμα)",
      "up.vis": "Ορατότητα",
      "up.v.private": "Ιδιωτική", "up.v.trackable": "Ανιχνεύσιμη", "up.v.public": "Δημόσια", "up.v.identifiable": "Αναγνωρίσιμη",
      "up.vis.private": "Ιδιωτική: μόνο εσύ βλέπεις τη διαδρομή· τα σημεία της φαίνονται ανώνυμα στο επίπεδο GPS",
      "up.vis.trackable": "Ανιχνεύσιμη: ανώνυμη, αλλά με ώρες, ώστε να φαίνεται πόσο γρήγορα κινήθηκες",
      "up.vis.public": "Δημόσια: με το όνομά σου, σημεία χωρίς ώρες",
      "up.vis.identifiable": "Αναγνωρίσιμη: με το όνομά σου, όλη η διαδρομή και οι ώρες",
      "up.again": "Αυτή η διαδρομή υπάρχει ήδη στο OpenStreetMap. Ένα νέο ανέβασμα φτιάχνει δεύτερο αντίγραφο.",
      "up.notime": "Το OpenStreetMap θέλει ώρα στα σημεία. Αυτή η διαδρομή δεν έχει (συνήθως σχεδιασμένη διαδρομή ή εξαγωγή χωρίς ώρες).",
      "up.go": "Ανέβασμα", "up.busy": "Ανεβαίνει…",
      "up.ok": "Ανέβηκε στο OpenStreetMap",
      "up.fail": "Το ανέβασμα απέτυχε: {e}",
      "up.offline": "Είσαι εκτός σύνδεσης. Ανέβασέ τη όταν έχεις σύνδεση.",
      "up.signin": "Η σύνδεση στο OpenStreetMap δεν έχει ρυθμιστεί ακόμα.",
      "up.denied": "Το OpenStreetMap σε αποσύνδεσε. Συνδέσου ξανά και δοκίμασε πάλι.",
      "up.view": "Προβολή στο OpenStreetMap"
    }
  };
  function t(k, vars) {
    var s = STR[LANG][k] !== undefined ? STR[LANG][k] : STR.en[k];
    if (s === undefined) s = k;
    if (vars) Object.keys(vars).forEach(function (v) { s = s.split("{" + v + "}").join(String(vars[v])); });
    return s;
  }
  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined && text !== null) e.textContent = text;
    return e;
  }
  function button(label, cls, fn) {
    var b = el("button", cls, label);
    b.type = "button";
    if (fn) b.addEventListener("click", fn);
    return b;
  }
  function toast(s) { (H.toast || H.localToast)(s); }
  function fmtNum(v, d) {
    try { return v.toLocaleString(LANG === "el" ? "el-GR" : "en-GB", { minimumFractionDigits: d, maximumFractionDigits: d }); }
    catch (e) { return v.toFixed(d); }
  }
  function fmtDist(m) {
    if (!(m >= 0)) m = 0;
    return m < 1000 ? t("m", { n: Math.round(m) }) : t("km", { n: fmtNum(m / 1000, m < 10000 ? 2 : 1) });
  }
  function fmtTime(ms) {
    var s = Math.max(0, Math.round((ms || 0) / 1000));
    var h = Math.floor(s / 3600), mi = Math.floor(s % 3600 / 60), se = s % 60;
    return (h ? h + ":" + (mi < 10 ? "0" : "") : "") + mi + ":" + (se < 10 ? "0" : "") + se;
  }
  function fmtSpeed(mps) { return t("kmh", { n: fmtNum((mps || 0) * 3.6, 1) }); }
  function fmtDate(ms) {
    if (!ms) return "";
    try {
      return new Date(ms).toLocaleString(LANG === "el" ? "el-GR" : "en-GB",
        { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
    } catch (e) { return new Date(ms).toISOString().slice(0, 16).replace("T", " "); }
  }
  function newId() {
    var a = new Uint8Array(10), s = "";
    try { crypto.getRandomValues(a); } catch (e) { for (var i = 0; i < a.length; i++) a[i] = Math.floor(Math.random() * 256); }
    for (var j = 0; j < a.length; j++) s += (a[j] % 36).toString(36);
    return s + Date.now().toString(36).slice(-4);
  }
  function fsApi() {
    try {
      var f = window.parent && window.parent !== window ? window.parent.orosFS : window.orosFS;
      return f && typeof f.writeText === "function" && typeof f.readText === "function" ? f : null;
    } catch (e) { return null; }
  }
  function dialogHost() {
    try { return window.orosDialog || (window.parent && window.parent.orosDialog) || null; }
    catch (e) { return window.orosDialog || null; }
  }

  // ---------- synced slice "mapstracks" ----------
  var DATA_KEY = "oros-maps-tracks-data";
  var data = T.normalizeTracks(null);
  var suppress = false;
  function syncApi() {
    try { return (window.parent && window.parent.orosSync) || window.orosSync || null; }
    catch (e) { return window.orosSync || null; }
  }
  function loadData() {
    var raw = null;
    try { raw = localStorage.getItem(DATA_KEY); } catch (e) {}
    if (!raw) return;
    try { data = T.normalizeTracks(JSON.parse(raw)); }
    catch (e) { try { localStorage.setItem("oros-maps-tracks-rescue", raw); } catch (e2) {} }
  }
  function saveData() {
    data = T.normalizeTracks(data);
    try { localStorage.setItem(DATA_KEY, JSON.stringify(data)); }
    catch (e) { toast(H.storeFull || "Storage is full"); return false; }
    if (!suppress) { var api = syncApi(); if (api && api.markDirty) api.markDirty(); }
    changed();
    return true;
  }
  // Tells the heatmap (heat.js) that the track list changed.
  function changed() {
    try { window.dispatchEvent(new CustomEvent("oros-maps-tracks-changed")); } catch (e) {}
  }
  function sliceGet() { return T.normalizeTracks(data); }
  function sliceSet(d) {
    if (!d || typeof d !== "object") return;
    data = T.normalizeTracks(JSON.parse(JSON.stringify(d)));
    suppress = true;
    try { localStorage.setItem(DATA_KEY, JSON.stringify(data)); } catch (e) {}
    suppress = false;
    full = {};
    paint();
    if (panelOpen()) render();
    changed();
  }
  function stamp(e) { e.m = Math.max(Date.now(), (e.m || 0) + 1); }
  function list() {
    return Object.keys(data.tracks).map(function (k) { return data.tracks[k]; })
      .sort(function (a, b) { return (b.start || b.m) - (a.start || a.m) || (a.id < b.id ? -1 : 1); });
  }
  function nameOf(e) { return e.name || t("unnamed") + " " + fmtDate(e.start || e.m); }

  // ---------- GPX files ----------
  var full = {};                 // id → parsed track (this session)
  function readTrack(id) {
    if (full[id]) return Promise.resolve(full[id]);
    var fs = fsApi(), path = T.pathOf(id);
    if (!fs || !path) return Promise.reject(new Error("nofs"));
    return fs.readText(path).then(function (txt) {
      var tr = T.parseAny(txt, "x.gpx");
      if (!tr) throw new Error("bad");
      full[id] = tr;
      return tr;
    });
  }
  function writeTrack(id, tr) {
    var fs = fsApi(), path = T.pathOf(id);
    if (!fs || !path) return Promise.reject(new Error("nofs"));
    return Promise.resolve(fs.writeText(path, T.writeGpx(tr))).then(function () { full[id] = tr; });
  }
  function addTrack(tr, extra) {
    var id = newId();
    var base = Object.assign({ color: T.COLORS[Object.keys(data.tracks).length % T.COLORS.length] }, extra || {});
    return writeTrack(id, tr).then(function () {
      var e = T.entryFor(id, tr, base, Date.now());
      if (!e) throw new Error("entry");
      data.tracks[id] = e;
      saveData();
      paint();
      return e;
    });
  }

  // ---------- map layers ----------
  var layer = L.layerGroup().addTo(map);
  var recLine = null, selLine = null, followLine = null;
  function runs(points) {
    var out = [], cur = [];
    points.forEach(function (p, i) {
      if (i && T.distM(points[i - 1][0], points[i - 1][1], p[0], p[1]) > 2000) { if (cur.length > 1) out.push(cur); cur = []; }
      cur.push([p[0], p[1]]);
    });
    if (cur.length > 1) out.push(cur);
    return out;
  }
  function paint() {
    layer.clearLayers();
    list().forEach(function (e) {
      if (e.hidden && (!route || route.id !== e.id)) return;
      if (route && route.v === "edit" && route.id === e.id) return;
      var tr = full[e.id];
      var lines = tr ? tr.segs.map(function (s) { return s.map(function (p) { return [p[0], p[1]]; }); }) : runs(T.decode(e.prev));
      lines.forEach(function (ll) {
        if (ll.length < 2) return;
        var pl = L.polyline(ll, { color: e.color, weight: route && route.id === e.id ? 6 : 4, opacity: 0.85, interactive: true });
        pl.on("click", function () { if (route.v !== "edit") open(e.id); });
        layer.addLayer(pl);
      });
    });
    editPaint();
  }

  // ---------- recording ----------
  var REC_DB = "oros-maps-rec";
  function idb(fn) {
    return new Promise(function (resolve, reject) {
      var req;
      try { req = indexedDB.open(REC_DB, 1); } catch (e) { reject(e); return; }
      req.onupgradeneeded = function () { req.result.createObjectStore("rec"); };
      req.onerror = function () { reject(req.error); };
      req.onsuccess = function () {
        var db = req.result;
        try {
          var tx = db.transaction("rec", "readwrite");
          var r = fn(tx.objectStore("rec"));
          tx.oncomplete = function () { db.close(); resolve(r && r.result); };
          tx.onerror = function () { db.close(); reject(tx.error); };
        } catch (e) { db.close(); reject(e); }
      };
    });
  }
  function recSave() {
    if (!rec) return Promise.resolve();
    var copy = { id: rec.id, started: rec.started, segs: rec.segs, paused: rec.paused };
    return idb(function (s) { return s.put(copy, "cur"); }).catch(function () {});
  }
  function recLoad() { return idb(function (s) { return s.get("cur"); }).catch(function () { return null; }); }
  function recClear() { return idb(function (s) { return s.delete("cur"); }).catch(function () {}); }

  var rec = null;                // { id, started, segs, paused, last }
  var watchId = null, saveTimer = null, tickTimer = null, lastFix = null, gpsState = "";
  var wake = null;
  function wakeOn() {
    try {
      if (!("wakeLock" in navigator) || wake) return;
      navigator.wakeLock.request("screen").then(function (w) {
        wake = w;
        w.addEventListener("release", function () { if (wake === w) wake = null; });
      }, function () {});
    } catch (e) {}
  }
  function wakeOff() { try { if (wake) wake.release(); } catch (e) {} wake = null; }
  document.addEventListener("visibilitychange", function () {
    if (document.visibilityState === "visible") { if ((rec && !rec.paused) || following) wakeOn(); }
    else if (rec) recSave();
  });
  window.addEventListener("pagehide", function () { if (rec) recSave(); });

  function recTrack() { return { name: "", segs: rec ? rec.segs.filter(function (s) { return s.length; }) : [], wpts: [] }; }
  function lastPoint() {
    if (!rec) return null;
    for (var i = rec.segs.length - 1; i >= 0; i--) if (rec.segs[i].length) return rec.segs[i][rec.segs[i].length - 1];
    return null;
  }
  function onFix(fix) {
    lastFix = fix;
    gpsState = "ok";
    if (rec && !rec.paused) {
      var seg = rec.segs[rec.segs.length - 1];
      var p = T.accept(seg.length ? seg[seg.length - 1] : null, fix);
      if (p) {
        seg.push(p);
        drawRec();
      }
    }
    if (following) followUpdate(fix);
    if (panelOpen() && (route.v === "list" || (route.v === "track" && following))) liveUpdate();
    chip();
  }
  function startWatch() {
    if (watchId !== null || window.__orosMapsTracksNoGps) return;
    if (!("geolocation" in navigator)) { toast(t("rec.nogps")); return; }
    gpsState = "wait";
    watchId = navigator.geolocation.watchPosition(function (pos) {
      var c = pos.coords;
      onFix({ lat: c.latitude, lon: c.longitude, acc: c.accuracy, ele: c.altitude, spd: c.speed, t: pos.timestamp || Date.now() });
    }, function (err) {
      if (err && err.code === 1) { gpsState = "denied"; toast(t("rec.denied")); if (rec) recPause(); }
      else gpsState = "wait";
      if (panelOpen()) render();
    }, { enableHighAccuracy: true, maximumAge: 2000, timeout: 30000 });
  }
  function stopWatch() {
    if ((rec && !rec.paused) || following) return;
    if (watchId !== null) { try { navigator.geolocation.clearWatch(watchId); } catch (e) {} }
    watchId = null;
  }
  function drawRec() {
    var pts = [];
    if (rec) rec.segs.forEach(function (s) { s.forEach(function (p) { pts.push([p[0], p[1]]); }); });
    if (!recLine) recLine = L.polyline([], { color: "#e06c75", weight: 5, opacity: 0.9, dashArray: "1 8", lineCap: "round", interactive: false });
    if (pts.length > 1) { recLine.setLatLngs(pts); if (!map.hasLayer(recLine)) recLine.addTo(map); }
    else if (map.hasLayer(recLine)) map.removeLayer(recLine);
  }
  function recStart(resume) {
    if (!rec) rec = { id: newId(), started: Date.now(), segs: [[]], paused: false };
    else if (resume) { rec.paused = false; rec.segs.push([]); }
    rec.paused = false;
    startWatch();
    wakeOn();
    clearInterval(saveTimer);
    saveTimer = setInterval(recSave, 10000);
    clearInterval(tickTimer);
    tickTimer = setInterval(function () { if (panelOpen() && route.v === "list") liveUpdate(); chip(); }, 1000);
    recSave();
    drawRec();
    chip();
    if (panelOpen()) render();
  }
  function recPause() {
    if (!rec) return;
    rec.paused = true;
    recSave();
    wakeOff();
    stopWatch();
    chip();
    if (panelOpen()) render();
  }
  function recEnd() {
    rec = null;
    clearInterval(saveTimer); clearInterval(tickTimer);
    saveTimer = tickTimer = null;
    recClear();
    wakeOff();
    stopWatch();
    drawRec();
    chip();
  }
  function recStats() { return T.stats(recTrack()); }
  function defaultName(ms) {
    return t("unnamed") + " " + fmtDate(ms || Date.now());
  }
  function recFinish(name) {
    var tr = recTrack();
    tr.name = (name || "").trim() || defaultName(rec.started);
    if (T.flatLen(tr) < 2) { toast(t("rec.short")); return Promise.resolve(null); }
    return addTrack(tr, { name: tr.name, src: "rec" }).then(function (e) {
      recEnd();
      toast(t("rec.saved"));
      go({ v: "track", id: e.id });
      return e;
    }, function () { toast(t("savefail")); return null; });
  }
  function stopDialog() {
    var was = rec.paused;
    if (!was) recPause();
    var dlg = el("dialog", "osm-dlg");
    dlg.appendChild(el("h3", "", t("rec.save.title")));
    var st = recStats();
    dlg.appendChild(el("p", "osm-hint", fmtDist(st.dist) + " · " + fmtTime(st.dur)));
    var lab = el("label", "osm-lab", t("rec.name"));
    var inp = el("input", "osm-in");
    inp.maxLength = T.LIM.name;
    inp.value = defaultName(rec.started);
    lab.appendChild(inp);
    dlg.appendChild(lab);
    var row = el("div", "osm-actions");
    row.appendChild(button(t("rec.save"), "osm-btn primary", function () { close(); recFinish(inp.value); }));
    row.appendChild(button(t("rec.keep"), "osm-btn", function () { close(); if (!was) recStart(true); }));
    dlg.appendChild(row);
    var row2 = el("div", "osm-actions");
    row2.appendChild(button(t("rec.discard"), "osm-btn danger", function () {
      close();
      confirmDlg(t("rec.discard.ask"), function () { recEnd(); render(); }, function () { if (!was) recStart(true); });
    }));
    dlg.appendChild(row2);
    function close() { if (dlg.open) dlg.close(); dlg.remove(); }
    dlg.addEventListener("cancel", function (e) { e.preventDefault(); close(); if (!was) recStart(true); });
    document.body.appendChild(dlg);
    dlg.showModal();
  }
  function confirmDlg(text, onOk, onNo) {
    var dlg = el("dialog", "osm-dlg");
    dlg.appendChild(el("p", "poi-q", text));
    var row = el("div", "osm-actions");
    row.appendChild(button(t("yes"), "osm-btn primary", function () { close(); onOk(); }));
    row.appendChild(button(t("cancel"), "osm-btn", function () { close(); if (onNo) onNo(); }));
    dlg.appendChild(row);
    function close() { if (dlg.open) dlg.close(); dlg.remove(); }
    dlg.addEventListener("cancel", function (e) { e.preventDefault(); close(); if (onNo) onNo(); });
    document.body.appendChild(dlg);
    dlg.showModal();
  }
  // An unfinished recording from an earlier visit.
  function offerResume(saved) {
    var tr = { segs: (saved.segs || []).filter(function (s) { return Array.isArray(s) && s.length; }), wpts: [] };
    tr.segs = tr.segs.map(function (s) {
      return s.filter(function (p) { return Array.isArray(p) && isFinite(p[0]) && isFinite(p[1]); });
    }).filter(function (s) { return s.length; });
    if (T.flatLen(tr) < 2) { recClear(); return; }
    rec = { id: saved.id || newId(), started: saved.started || Date.now(), segs: tr.segs, paused: true };
    drawRec();
    var dlg = el("dialog", "osm-dlg");
    dlg.appendChild(el("h3", "", t("rec.resume.title")));
    dlg.appendChild(el("p", "poi-q", t("rec.resume.text", { when: fmtDate(rec.started), d: fmtDist(T.stats(tr).dist) })));
    var row = el("div", "osm-actions");
    row.appendChild(button(t("rec.continue"), "osm-btn primary", function () { close(); setMode(true); recStart(true); }));
    row.appendChild(button(t("rec.save"), "osm-btn", function () { close(); setMode(true); stopDialog(); }));
    row.appendChild(button(t("rec.discard"), "osm-btn", function () { close(); recEnd(); }));
    dlg.appendChild(row);
    function close() { if (dlg.open) dlg.close(); dlg.remove(); }
    dlg.addEventListener("cancel", function (e) { e.preventDefault(); close(); chip(); });
    document.body.appendChild(dlg);
    dlg.showModal();
    chip();
  }

  // ---------- follow a track ----------
  var following = null;          // { id, pts: [[lat, lon, cumDist]...], total }
  function followStart(id) {
    readTrack(id).catch(function () { return null; }).then(function (tr) {
      var e = data.tracks[id];
      if (!e) return;
      var pts = [];
      if (tr) tr.segs.forEach(function (s) { s.forEach(function (p) { pts.push([p[0], p[1]]); }); });
      else pts = T.decode(e.prev);
      if (pts.length < 2) return;
      var d = 0;
      pts = pts.map(function (p, i) { if (i) d += T.distM(pts[i - 1][0], pts[i - 1][1], p[0], p[1]); return [p[0], p[1], d]; });
      following = { id: id, pts: pts, total: d, off: null, left: null };
      if (followLine) map.removeLayer(followLine);
      followLine = L.polyline(pts.map(function (p) { return [p[0], p[1]]; }), { color: e.color, weight: 8, opacity: 0.5, interactive: false }).addTo(map);
      startWatch();
      wakeOn();
      if (lastFix) followUpdate(lastFix);
      chip();
      render();
    });
  }
  function followStop() {
    following = null;
    if (followLine) { map.removeLayer(followLine); followLine = null; }
    if (!rec || rec.paused) wakeOff();
    stopWatch();
    chip();
    if (panelOpen()) render();
  }
  function followUpdate(fix) {
    var f = following;
    if (!f) return;
    // Nearest point on the line (segment projection, local metres).
    var kx = 111320 * Math.cos(fix.lat * Math.PI / 180), ky = 110540;
    var best = Infinity, along = 0;
    for (var i = 1; i < f.pts.length; i++) {
      var a = f.pts[i - 1], b = f.pts[i];
      var ax = (a[1] - fix.lon) * kx, ay = (a[0] - fix.lat) * ky, bx = (b[1] - fix.lon) * kx, by = (b[0] - fix.lat) * ky;
      var dx = bx - ax, dy = by - ay, len2 = dx * dx + dy * dy;
      var u = len2 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len2)) : 0;
      var ex = ax + u * dx, ey = ay + u * dy, dd = Math.sqrt(ex * ex + ey * ey);
      if (dd < best) { best = dd; along = a[2] + u * (b[2] - a[2]); }
    }
    f.off = best;
    f.left = Math.max(0, f.total - along);
  }

  // ---------- chip on the map ----------
  var chipEl = null;
  function chip() {
    if (!chipEl) {
      chipEl = el("button", "trk-chip");
      chipEl.type = "button";
      chipEl.addEventListener("click", function () { setMode(true); if (following && !rec) go({ v: "track", id: following.id }); });
      document.body.appendChild(chipEl);
    }
    var txt = "";
    if (rec) txt = (rec.paused ? "❚❚ " : "● ") + t("rec.chip", { d: fmtDist(recStats().dist) });
    else if (following) txt = t("follow.chip", { d: following.off === null ? "…" : fmtDist(following.left) });
    chipEl.textContent = txt;
    chipEl.classList.toggle("paused", !!(rec && rec.paused));
    chipEl.hidden = !txt || modeOn;
  }

  // ---------- panel ----------
  var panel = null, modeBtn = null, modeOn = false, route = { v: "list" };
  var filter = { q: "", folder: "" };
  function panelOpen() { return modeOn && panel && !panel.hidden; }
  function setH() {
    var h = 0;
    document.querySelectorAll(".osm-sheet").forEach(function (s) {
      if (!s.hidden) h = Math.max(h, s.getBoundingClientRect().height);
    });
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
  function go(r) { route = r; paint(); render(); }
  function render() {
    if (!panel || !modeOn) return;
    if (route.v === "edit" && edit && edit.id === route.id && data.tracks[route.id]) renderEdit(route.id);
    else if (route.v === "track" && data.tracks[route.id]) renderTrack(route.id);
    else { route = { v: "list" }; renderList(); }
    setH();
  }

  var live = null;
  function liveUpdate() {
    if (!live || !document.body.contains(live)) return;
    if (route.v === "track") return renderFollowBox();
    var st = recStats();
    var speed = lastFix && lastPoint() && rec && !rec.paused && isFinite(lastFix.spd) ? lastFix.spd : null;
    var last = lastPoint();
    var vals = [
      [t("st.dist"), fmtDist(st.dist)],
      [t("st.time"), fmtTime(rec ? Date.now() - (rec.segs[0].length && rec.segs[0][0][3] ? rec.segs[0][0][3] : rec.started) : 0)],
      [t("st.avg"), fmtSpeed(st.moving ? st.dist / (st.moving / 1000) : 0)],
      [t("chart.ele"), last && last[2] !== null ? t("m", { n: Math.round(last[2]) }) : "–"]
    ];
    if (speed !== null) vals[2] = [t("chart.speed"), fmtSpeed(speed)];
    live.textContent = "";
    vals.forEach(function (v) {
      var c = el("div", "trk-stat");
      c.appendChild(el("b", "", v[1]));
      c.appendChild(el("span", "", v[0]));
      live.appendChild(c);
    });
  }

  function renderList() {
    panel.textContent = "";
    panel.appendChild(header(t("title")));
    var body = el("div", "osm-body");
    // Recording card
    var card = el("div", "trk-rec" + (rec ? (rec.paused ? " paused" : " on") : ""));
    if (rec) {
      card.appendChild(el("div", "trk-rec-state", rec.paused ? t("rec.paused") : (gpsState === "wait" && !lastPoint() ? t("rec.wait") : "● " + t("rec.on"))));
      live = el("div", "trk-stats");
      card.appendChild(live);
      var r = el("div", "osm-actions");
      r.appendChild(button(rec.paused ? t("rec.resume") : t("rec.pause"), "osm-btn", function () { if (rec.paused) recStart(true); else recPause(); }));
      r.appendChild(button(t("rec.stop"), "osm-btn primary", stopDialog));
      card.appendChild(r);
      if (!rec.paused) card.appendChild(el("p", "osm-small", t("rec.screen")));
    } else {
      live = null;
      var r0 = el("div", "osm-actions");
      r0.appendChild(button(t("rec.start"), "osm-btn primary", function () { recStart(false); }));
      var imp = button(t("import"), "osm-btn", function () { fileIn.click(); });
      r0.appendChild(imp);
      // Wave 10B: "Plan a track" (planner.js loads after this file).
      var PL = window.__orosMapsPlanner;
      if (PL) r0.appendChild(button(PL.label(), "osm-btn trk-plan", function () { PL.setMode(true); }));
      card.appendChild(r0);
    }
    body.appendChild(card);
    if (rec) liveUpdate();

    var all = list();
    if (!all.length) {
      body.appendChild(el("p", "osm-hint", t("none")));
      panel.appendChild(body);
      return;
    }
    if (window.__orosMapsHeat) {
      var rh = el("div", "osm-actions");
      rh.appendChild(button(t("heat"), "osm-btn", function () { window.__orosMapsHeat.open(); }));
      body.appendChild(rh);
    }
    var bar = el("div", "trk-bar");
    var q = el("input", "osm-in");
    q.type = "search";
    q.placeholder = t("search.ph");
    q.setAttribute("aria-label", t("search.ph"));
    q.value = filter.q;
    bar.appendChild(q);
    var folders = [];
    all.forEach(function (e) { if (e.folder && folders.indexOf(e.folder) < 0) folders.push(e.folder); });
    folders.sort();
    var fsel = null;
    if (folders.length) {
      fsel = el("select", "osm-in");
      fsel.setAttribute("aria-label", t("folder"));
      var o0 = el("option", "", t("folder.all")); o0.value = ""; fsel.appendChild(o0);
      folders.forEach(function (f) { var o = el("option", "", f); o.value = f; fsel.appendChild(o); });
      if (folders.indexOf(filter.folder) < 0) filter.folder = "";
      fsel.value = filter.folder;
      bar.appendChild(fsel);
    }
    body.appendChild(bar);
    var ul = el("ul", "osm-list");
    function fill() {
      ul.textContent = "";
      var qq = filter.q.trim().toLowerCase();
      var shown = all.filter(function (e) {
        if (filter.folder && e.folder !== filter.folder) return false;
        return !qq || nameOf(e).toLowerCase().indexOf(qq) >= 0 || (e.folder || "").toLowerCase().indexOf(qq) >= 0;
      });
      if (!shown.length) { ul.appendChild(el("li", "osm-hint", t("nomatch"))); return; }
      shown.slice(0, 200).forEach(function (e) {
        var li = el("li", "osm-row trk-row");
        li.tabIndex = 0;
        var dot = el("span", "poi-row-dot");
        dot.style.background = e.color;
        li.appendChild(dot);
        var b = el("div", "osm-row-body");
        b.appendChild(el("div", "osm-row-t", nameOf(e)));
        var meta = [fmtDate(e.start || e.m), fmtDist(e.dist)];
        if (e.dur) meta.push(fmtTime(e.dur));
        if (e.folder) meta.push(e.folder);
        b.appendChild(el("div", "osm-row-s", meta.join(" · ")));
        li.appendChild(b);
        var eye = button(e.hidden ? "◌" : "◉", "osm-mini trk-eye" + (e.hidden ? "" : " on"), function (ev) {
          ev.stopPropagation();
          var x = data.tracks[e.id];
          if (!x) return;
          x.hidden = x.hidden ? 0 : 1; stamp(x); saveData(); paint(); fill();
        });
        eye.setAttribute("aria-label", e.hidden ? t("show") : t("hide"));
        eye.title = eye.getAttribute("aria-label");
        eye.setAttribute("aria-pressed", e.hidden ? "false" : "true");
        li.appendChild(eye);
        li.addEventListener("click", function () { open(e.id); });
        li.addEventListener("keydown", function (ev) { if (ev.key === "Enter") open(e.id); });
        ul.appendChild(li);
      });
    }
    q.addEventListener("input", function () { filter.q = q.value; fill(); });
    if (fsel) fsel.addEventListener("change", function () { filter.folder = fsel.value; fill(); });
    fill();
    body.appendChild(ul);
    if (rec) {
      var r2 = el("div", "osm-actions");
      r2.appendChild(button(t("import"), "osm-btn", function () { fileIn.click(); }));
      body.appendChild(r2);
    }
    panel.appendChild(body);
  }

  function open(id) {
    if (!data.tracks[id]) return;
    if (!modeOn) setMode(true);
    go({ v: "track", id: id });
    readTrack(id).then(function () {
      if (route.v === "track" && route.id === id) { paint(); render(); }
    }, function () {
      if (route.v === "track" && route.id === id) { route.missing = true; render(); }
    });
    fit(id);
  }
  function fit(id) {
    var e = data.tracks[id];
    if (!e || !e.bbox) return;
    try { map.fitBounds([[e.bbox[0], e.bbox[1]], [e.bbox[2], e.bbox[3]]], { padding: [30, 30], maxZoom: 17 }); } catch (x) {}
  }

  var followBox = null;
  function renderFollowBox() {
    if (!followBox) return;
    followBox.textContent = "";
    if (!following || following.id !== route.id) return;
    if (following.off === null) { followBox.appendChild(el("p", "osm-hint", t("rec.wait"))); return; }
    followBox.appendChild(el("b", "", following.off > 30 ? t("follow.off", { d: fmtDist(following.off) }) : t("follow.on")));
    followBox.appendChild(el("span", "", t("follow.left", { d: fmtDist(following.left) })));
  }

  function renderTrack(id) {
    var e = data.tracks[id];
    var tr = full[id];
    panel.textContent = "";
    panel.appendChild(header(nameOf(e), function () { go({ v: "list" }); }));
    var body = el("div", "osm-body");
    var meta = [fmtDate(e.start || e.m)];
    if (e.folder) meta.push(e.folder);
    body.appendChild(el("p", "osm-small", meta.join(" · ")));
    if (route.missing && !tr) body.appendChild(el("p", "osm-warn", t("missing")));
    var st = tr ? T.stats(tr) : e;
    var grid = el("div", "trk-stats");
    var avg = st.moving ? st.dist / (st.moving / 1000) : 0;
    [[t("st.dist"), fmtDist(st.dist)], [t("st.time"), st.dur ? fmtTime(st.dur) : "–"],
     [t("st.moving"), st.moving ? fmtTime(st.moving) : "–"], [t("st.avg"), avg ? fmtSpeed(avg) : "–"],
     [t("st.up"), t("m", { n: st.up || 0 })], [t("st.down"), t("m", { n: st.down || 0 })]]
      .concat(tr && st.top ? [[t("st.top"), fmtSpeed(st.top)]] : [])
      .concat([[t("st.pts"), String(st.n || 0)]])
      .forEach(function (v) {
        var c = el("div", "trk-stat");
        c.appendChild(el("b", "", v[1]));
        c.appendChild(el("span", "", v[0]));
        grid.appendChild(c);
      });
    body.appendChild(grid);
    if (tr) body.appendChild(chartBox(tr));

    followBox = el("div", "trk-follow");
    body.appendChild(followBox);
    renderFollowBox();
    live = followBox;

    var r1 = el("div", "osm-actions");
    r1.appendChild(button(t("fit"), "osm-btn", function () { fit(id); }));
    if (following && following.id === id) r1.appendChild(button(t("follow.stop"), "osm-btn primary", followStop));
    else r1.appendChild(button(t("follow"), "osm-btn primary", function () { followStart(id); }));
    body.appendChild(r1);
    var r2 = el("div", "osm-actions");
    var exp = button(t("export"), "osm-btn", function () { exportGpx(id); });
    exp.disabled = !tr;
    r2.appendChild(exp);
    r2.appendChild(button(t("details"), "osm-btn", function () { detailsDlg(id); }));
    body.appendChild(r2);
    var r4 = el("div", "osm-actions");
    var ed = button(t("edit"), "osm-btn", function () { editStart(id); });
    ed.disabled = !tr;
    r4.appendChild(ed);
    var up = button(t("up"), "osm-btn", function () { uploadDlg(id); });
    up.disabled = !tr;
    r4.appendChild(up);
    body.appendChild(r4);
    if (tr && tr.trace && T.TRACE_RE.test(tr.trace)) {
      var lp = el("p", "osm-small trk-trace");
      var a = el("a", "", t("up.view") + " ↗");
      a.href = tr.trace; a.target = "_blank"; a.rel = "noopener noreferrer";
      lp.appendChild(a);
      body.appendChild(lp);
    }
    var r3 = el("div", "osm-actions");
    var vis = button(e.hidden ? t("show") : t("hide"), "osm-btn", function () {
      var x = data.tracks[id]; x.hidden = x.hidden ? 0 : 1; stamp(x); saveData(); paint(); render();
    });
    r3.appendChild(vis);
    r3.appendChild(button(t("del"), "osm-btn danger", function () {
      confirmDlg(t("del.ask", { n: nameOf(e) }), function () { removeTrack(id); });
    }));
    body.appendChild(r3);
    panel.appendChild(body);
  }

  // Elevation (or speed when there is no elevation) over distance.
  var chartMode = "ele";
  function chartBox(tr) {
    var box = el("div", "trk-chart");
    var prof = T.profile(tr, 360);
    var hasEle = prof.some(function (p) { return p.ele !== null; });
    var hasV = prof.some(function (p) { return p.v !== null; });
    if (!hasEle && !hasV) { box.appendChild(el("p", "osm-small", t("chart.none"))); return box; }
    if (!hasEle) chartMode = "speed";
    if (!hasV) chartMode = "ele";
    if (hasEle && hasV) {
      var tabs = el("div", "osm-tabs");
      [["ele", t("chart.ele")], ["speed", t("chart.speed")]].forEach(function (x) {
        var b = button(x[1], "osm-tab" + (chartMode === x[0] ? " on" : ""), function () { chartMode = x[0]; render(); });
        b.setAttribute("aria-pressed", chartMode === x[0] ? "true" : "false");
        tabs.appendChild(b);
      });
      box.appendChild(tabs);
    }
    var cv = el("canvas", "");
    cv.setAttribute("role", "img");
    box.appendChild(cv);
    var lab = el("div", "trk-chart-lab");
    box.appendChild(lab);
    requestAnimationFrame(function () {
      var w = Math.max(200, Math.round(box.clientWidth || 300)), h = 120, dpr = window.devicePixelRatio || 1;
      cv.width = w * dpr; cv.height = h * dpr;
      cv.style.width = w + "px"; cv.style.height = h + "px";
      var g = cv.getContext("2d");
      if (!g) return;
      g.scale(dpr, dpr);
      var vals = prof.map(function (p) { return chartMode === "ele" ? p.ele : (p.v === null ? null : p.v * 3.6); });
      // Light smoothing for speed (GPS noise).
      if (chartMode === "speed") {
        vals = vals.map(function (v, i) {
          var s = 0, n = 0;
          for (var k = Math.max(0, i - 2); k <= Math.min(vals.length - 1, i + 2); k++) if (vals[k] !== null) { s += vals[k]; n++; }
          return n ? s / n : null;
        });
      }
      var lo = Infinity, hi = -Infinity;
      vals.forEach(function (v) { if (v !== null) { lo = Math.min(lo, v); hi = Math.max(hi, v); } });
      if (chartMode === "speed") lo = 0;
      if (hi - lo < 10) hi = lo + 10;
      var dmax = prof[prof.length - 1].d || 1;
      var css = getComputedStyle(document.body);
      var acc = (css.getPropertyValue("--accent") || "#d4af37").trim() || "#d4af37";
      g.beginPath();
      var started = false, lastX = 0;
      prof.forEach(function (p, i) {
        var v = vals[i];
        if (v === null) return;
        var x = 2 + (p.d / dmax) * (w - 4), y = h - 4 - (v - lo) / (hi - lo) * (h - 12);
        if (!started) { g.moveTo(x, h); g.lineTo(x, y); started = true; } else g.lineTo(x, y);
        lastX = x;
      });
      g.lineTo(lastX, h);
      g.closePath();
      g.globalAlpha = 0.25; g.fillStyle = acc; g.fill();
      g.globalAlpha = 1; g.strokeStyle = acc; g.lineWidth = 2;
      g.beginPath(); started = false;
      prof.forEach(function (p, i) {
        var v = vals[i];
        if (v === null) return;
        var x = 2 + (p.d / dmax) * (w - 4), y = h - 4 - (v - lo) / (hi - lo) * (h - 12);
        if (!started) { g.moveTo(x, y); started = true; } else g.lineTo(x, y);
      });
      g.stroke();
      var fmt = chartMode === "ele" ? function (v) { return t("m", { n: Math.round(v) }); } : function (v) { return t("kmh", { n: fmtNum(v, 0) }); };
      lab.textContent = (chartMode === "ele" ? t("chart.ele") : t("chart.speed")) + ": " + fmt(lo) + " – " + fmt(hi) + " · " + fmtDist(dmax);
      cv.setAttribute("aria-label", lab.textContent);
    });
    return box;
  }

  function fileName(e) {
    return (nameOf(e).replace(/[\\/:*?"<>|\u0000-\u001f]+/g, " ").trim().slice(0, 80) || "track") + ".gpx";
  }
  function exportGpx(id) {
    var e = data.tracks[id];
    readTrack(id).then(function (tr) {
      var dlg = dialogHost();
      if (!dlg || typeof dlg.saveFile !== "function") { toast(t("nodlg")); return; }
      var copy = T.clone(tr);
      copy.name = nameOf(e);
      var blob = new Blob([T.writeGpx(copy)], { type: "application/gpx+xml" });
      return dlg.saveFile({ blob: blob, filename: fileName(e), mime: "application/gpx+xml",
        types: [{ description: "GPX", accept: { "application/gpx+xml": [".gpx"] } }] });
    }, function () { toast(t("missing")); });
  }

  function detailsDlg(id) {
    var e = data.tracks[id];
    var dlg = el("dialog", "osm-dlg");
    dlg.appendChild(el("h3", "", t("details")));
    var l1 = el("label", "osm-lab", t("rec.name"));
    var name = el("input", "osm-in"); name.maxLength = T.LIM.name; name.value = nameOf(e);
    l1.appendChild(name); dlg.appendChild(l1);
    var l2 = el("label", "osm-lab", t("folder"));
    var folder = el("input", "osm-in"); folder.maxLength = T.LIM.folder; folder.value = e.folder || "";
    var dl = el("datalist", ""); dl.id = "trk-folders";
    list().forEach(function (x) {
      if (x.folder && !dl.querySelector('option[value="' + CSS.escape(x.folder) + '"]')) { var o = el("option", ""); o.value = x.folder; dl.appendChild(o); }
    });
    folder.setAttribute("list", "trk-folders");
    l2.appendChild(folder); l2.appendChild(dl); dlg.appendChild(l2);
    dlg.appendChild(el("span", "osm-lab", t("color")));
    var sw = el("div", "trk-colors"), color = e.color;
    T.COLORS.forEach(function (c) {
      var b = button("", "trk-color" + (c === color ? " on" : ""), function () {
        color = c;
        sw.querySelectorAll(".trk-color").forEach(function (x) { x.classList.toggle("on", x === b); x.setAttribute("aria-pressed", x === b ? "true" : "false"); });
      });
      b.style.background = c;
      b.setAttribute("aria-label", c);
      b.setAttribute("aria-pressed", c === color ? "true" : "false");
      sw.appendChild(b);
    });
    dlg.appendChild(sw);
    var row = el("div", "osm-actions");
    row.appendChild(button(t("save"), "osm-btn primary", function () {
      var x = data.tracks[id];
      if (x) {
        x.name = name.value.trim().slice(0, T.LIM.name);
        x.folder = folder.value.trim().slice(0, T.LIM.folder);
        x.color = color;
        stamp(x); saveData(); paint();
      }
      close(); render();
    }));
    row.appendChild(button(t("cancel"), "osm-btn", close));
    dlg.appendChild(row);
    function close() { if (dlg.open) dlg.close(); dlg.remove(); }
    dlg.addEventListener("cancel", function (ev) { ev.preventDefault(); close(); });
    document.body.appendChild(dlg);
    dlg.showModal();
  }

  function removeTrack(id) {
    var e = data.tracks[id];
    if (!e) return;
    if (following && following.id === id) followStop();
    if (edit && edit.id === id) edit = null;
    delete data.tracks[id];
    data.tombs[id] = Math.max(Date.now(), e.m + 1);
    delete full[id];
    saveData();
    var fs = fsApi(), path = T.pathOf(id);
    if (fs && path && typeof fs.rm === "function") Promise.resolve(fs.rm(path)).catch(function () {});
    paint();
    toast(t("deleted"));
    go({ v: "list" });
  }

  // ---------- editing (wave 3B): trim, cut, split, simplify, join ----------
  // Works on a copy; nothing touches the file until Save changes (Split
  // saves both halves at once, after a confirm). Undo walks back the
  // copies of this session.
  var edit = null;               // { id, cur, undo[], from, to, dirty, flat, cum }
  var editLayer = L.layerGroup().addTo(map);
  function editIndex() {
    if (edit.flat) return;
    var f = [], cum = [], d = 0;
    edit.cur.segs.forEach(function (s) {
      s.forEach(function (p, i) {
        if (i) d += T.distM(s[i - 1][0], s[i - 1][1], p[0], p[1]);
        f.push(p); cum.push(d);
      });
    });
    edit.flat = f; edit.cum = cum;
  }
  function editStart(id) {
    readTrack(id).then(function (tr) {
      var n = T.flatLen(tr);
      if (!n) return;
      edit = { id: id, cur: T.clone(tr), undo: [], from: 0, to: n - 1, dirty: false, flat: null, cum: null };
      go({ v: "edit", id: id });
    }, function () { toast(t("missing")); });
  }
  function editApply(next) {
    if (!edit || !next || !T.flatLen(next)) return;
    edit.undo.push({ cur: edit.cur, from: edit.from, to: edit.to });
    var keep = T.flatLen(next) > 100000 ? 3 : 20;   // big tracks: fewer copies in memory
    while (edit.undo.length > keep) edit.undo.shift();
    edit.cur = next; edit.flat = null; edit.dirty = true;
    edit.from = 0; edit.to = T.flatLen(next) - 1;
    paint(); render();
  }
  function editUndo() {
    var u = edit && edit.undo.pop();
    if (!u) return;
    edit.cur = u.cur; edit.from = u.from; edit.to = u.to; edit.flat = null;
    edit.dirty = edit.undo.length > 0;
    paint(); render();
  }
  function editLeave(then) {
    if (!edit || !edit.dirty) { edit = null; then(); return; }
    confirmDlg(t("ed.drop"), function () { edit = null; then(); });
  }
  var editRaf = 0;
  function editPaintSoon() {
    if (editRaf) return;
    editRaf = requestAnimationFrame(function () { editRaf = 0; editPaint(); });
  }
  function editPaint() {
    editLayer.clearLayers();
    if (!edit || route.v !== "edit" || route.id !== edit.id) return;
    var e = data.tracks[edit.id];
    if (!e) return;
    editIndex();
    var k = 0, sel = [], cur = [];
    edit.cur.segs.forEach(function (s) {
      editLayer.addLayer(L.polyline(s.map(function (p) { return [p[0], p[1]]; }), { color: e.color, weight: 4, opacity: 0.55, dashArray: "6 6", interactive: false }));
      cur = [];
      s.forEach(function (p) {
        if (k >= edit.from && k <= edit.to) cur.push([p[0], p[1]]);
        k++;
      });
      if (cur.length > 1) sel.push(cur);
    });
    sel.forEach(function (ll) { editLayer.addLayer(L.polyline(ll, { color: e.color, weight: 7, opacity: 0.95, interactive: false })); });
    var a = edit.flat[edit.from], b = edit.flat[edit.to];
    if (a) editLayer.addLayer(L.circleMarker([a[0], a[1]], { radius: 8, color: "#fff", weight: 2, fillColor: "#2e9d4f", fillOpacity: 1, interactive: false }));
    if (b) editLayer.addLayer(L.circleMarker([b[0], b[1]], { radius: 8, color: "#fff", weight: 2, fillColor: "#d64545", fillOpacity: 1, interactive: false }));
  }

  function renderEdit(id) {
    var e = data.tracks[id];
    editIndex();
    var n = edit.flat.length;
    if (edit.to > n - 1) edit.to = n - 1;
    if (edit.from > edit.to) edit.from = edit.to;
    panel.textContent = "";
    panel.appendChild(header(t("ed.title", { n: nameOf(e) }), function () { editLeave(function () { go({ v: "track", id: id }); }); }));
    var body = el("div", "osm-body trk-edit");
    var st = T.stats(edit.cur);
    body.appendChild(el("p", "osm-small", fmtDist(st.dist) + " · " + t("st.pts").toLowerCase() + ": " + st.n));
    body.appendChild(el("p", "osm-hint", t("ed.hint")));
    var info = el("p", "osm-small trk-edinfo");
    info.setAttribute("aria-live", "polite");
    function rng(label, val) {
      var lab = el("label", "osm-lab trk-range", label);
      var r = el("input", "");
      r.type = "range"; r.min = "0"; r.max = String(n - 1); r.step = "1"; r.value = String(val);
      lab.appendChild(r);
      body.appendChild(lab);
      return r;
    }
    var rf = rng(t("ed.from"), edit.from), rt = rng(t("ed.to"), edit.to);
    body.appendChild(info);
    var r1 = el("div", "osm-actions");
    var bKeep = button(t("ed.keep"), "osm-btn", function () { editApply(T.trim(edit.cur, edit.from, edit.to)); });
    var bCut = button(t("ed.cut"), "osm-btn", function () { editApply(T.cut(edit.cur, edit.from, edit.to)); });
    r1.appendChild(bKeep); r1.appendChild(bCut);
    body.appendChild(r1);
    var r2 = el("div", "osm-actions");
    var bSplit = button(t("ed.split"), "osm-btn", function () { editSplit(id, edit.from); });
    r2.appendChild(bSplit);
    body.appendChild(r2);
    function upd(src) {
      var a = +rf.value, b = +rt.value;
      if (a > b) { if (src === rf) { b = a; rt.value = String(b); } else { a = b; rf.value = String(a); } }
      edit.from = a; edit.to = b;
      info.textContent = t("ed.sel", { a: a + 1, b: b + 1, n: n, d: fmtDist(edit.cum[b] - edit.cum[a]) });
      var all = a === 0 && b === n - 1;
      bKeep.disabled = all;
      bCut.disabled = all;
      bSplit.disabled = a <= 0 || a >= n - 1;
      editPaintSoon();
    }
    rf.addEventListener("input", function () { upd(rf); });
    rt.addEventListener("input", function () { upd(rt); });
    upd(null);

    // Simplify
    var sb = el("div", "trk-edrow");
    var sl = el("label", "osm-lab", t("ed.simp.tol"));
    var tol = el("select", "osm-in");
    [2, 5, 10, 20, 50].forEach(function (v) { var o = el("option", "", t("m", { n: v })); o.value = String(v); tol.appendChild(o); });
    tol.value = "5";
    sl.appendChild(tol);
    sb.appendChild(sl);
    var sres = el("p", "osm-small");
    var simp = null;
    function calc() {
      simp = T.simplify(edit.cur, +tol.value);
      var after = T.flatLen(simp);
      sres.textContent = t("ed.simp.res", { a: n, b: after });
      bSimp.disabled = after >= n;
    }
    var bSimp = button(t("ed.simp"), "osm-btn", function () { if (simp) editApply(simp); });
    sb.appendChild(bSimp);
    body.appendChild(sb);
    body.appendChild(sres);
    tol.addEventListener("change", calc);
    calc();

    // Join
    var others = list().filter(function (x) { return x.id !== id; });
    if (others.length) {
      var jb = el("div", "trk-edrow");
      var jl = el("label", "osm-lab", t("ed.join"));
      var js = el("select", "osm-in");
      var o0 = el("option", "", t("ed.join.pick")); o0.value = ""; js.appendChild(o0);
      others.slice(0, 300).forEach(function (x) { var o = el("option", "", nameOf(x)); o.value = x.id; js.appendChild(o); });
      jl.appendChild(js);
      jb.appendChild(jl);
      var bJoin = button(t("ed.join.btn"), "osm-btn", function () {
        var oid = js.value;
        if (!oid || !data.tracks[oid]) return;
        readTrack(oid).then(function (tr2) {
          if (!edit || edit.id !== id) return;
          if (T.flatLen(edit.cur) + T.flatLen(tr2) > T.LIM.points) { toast(t("ed.join.big")); return; }
          editApply(T.join(edit.cur, tr2));
        }, function () { toast(t("missing")); });
      });
      bJoin.disabled = true;
      js.addEventListener("change", function () { bJoin.disabled = !js.value; });
      jb.appendChild(bJoin);
      body.appendChild(jb);
    }

    var r3 = el("div", "osm-actions");
    var bUndo = button(t("ed.undo"), "osm-btn", editUndo);
    bUndo.disabled = !edit.undo.length;
    r3.appendChild(bUndo);
    body.appendChild(r3);
    var r4 = el("div", "osm-actions");
    var bSave = button(t("ed.save"), "osm-btn primary", editSave);
    bSave.disabled = !edit.dirty;
    r4.appendChild(bSave);
    r4.appendChild(button(t("ed.cancel"), "osm-btn", function () { editLeave(function () { go({ v: "track", id: id }); }); }));
    body.appendChild(r4);
    panel.appendChild(body);
  }

  function editSave() {
    if (!edit) return;
    var id = edit.id, cur = edit.cur;
    if (!data.tracks[id]) { edit = null; go({ v: "list" }); return; }
    writeTrack(id, cur).then(function () {
      var base = data.tracks[id];
      if (base) {
        var x = T.entryFor(id, cur, base, Math.max(Date.now(), base.m + 1));
        if (x) { data.tracks[id] = x; saveData(); }
      }
      edit = null;
      toast(t("ed.saved"));
      go({ v: "track", id: id });
    }, function () { toast(t("savefail")); });
  }

  function editSplit(id, idx) {
    var e = data.tracks[id];
    if (!edit || !e) return;
    confirmDlg(t("ed.split.ask", { n: nameOf(e) }), function () {
      var parts = edit && T.split(edit.cur, idx);
      if (!parts) return;
      writeTrack(id, parts[0]).then(function () {
        var base = data.tracks[id] || e;
        var x = T.entryFor(id, parts[0], base, Math.max(Date.now(), base.m + 1));
        if (x) { data.tracks[id] = x; saveData(); }
        parts[1].name = t("ed.split.name", { n: nameOf(base) }).slice(0, T.LIM.name);
        return addTrack(parts[1], { name: parts[1].name, folder: base.folder, color: base.color, hidden: base.hidden, src: base.src });
      }).then(function () {
        edit = null;
        toast(t("ed.split.ok"));
        go({ v: "track", id: id });
      }, function () { toast(t("savefail")); });
    });
  }

  // ---------- upload to OpenStreetMap GPS traces ----------
  function osmComment(O) {
    try {
      var d = window.__orosMapsNotes && window.__orosMapsNotes.data();
      return O.uploadComment(d);
    } catch (x) { return O.DEFAULT_COMMENT; }
  }
  function uploadDlg(id) {
    var A = window.OrosMapsApi, O = window.OrosMapsOSM;
    var e = data.tracks[id];
    if (!e) return;
    if (!A || !O) { toast(t("up.signin")); return; }
    if (navigator.onLine === false) { toast(t("up.offline")); return; }
    if (!A.account()) {
      if (!A.configured()) { toast(t("up.signin")); return; }
      A.signIn().then(function () { if (A.account()) uploadDlg(id); }, function () {});
      return;
    }
    readTrack(id).then(function (tr) {
      if (!T.timedPoints(tr)) { infoDlg(t("up.notime")); return; }
      var dlg = el("dialog", "osm-dlg");
      dlg.appendChild(el("h3", "", t("up.title")));
      dlg.appendChild(el("p", "osm-small", nameOf(e) + " · " + fmtDist(e.dist)));
      if (tr.trace) dlg.appendChild(el("p", "osm-warn", t("up.again")));
      var l1 = el("label", "osm-lab", t("up.desc"));
      var desc = el("input", "osm-in"); desc.maxLength = 255; desc.value = osmComment(O);
      l1.appendChild(desc); dlg.appendChild(l1);
      var l2 = el("label", "osm-lab", t("up.tags"));
      var tags = el("input", "osm-in"); tags.maxLength = 255;
      l2.appendChild(tags); dlg.appendChild(l2);
      var l3 = el("label", "osm-lab", t("up.vis"));
      var vis = el("select", "osm-in");
      ["private", "trackable", "public", "identifiable"].forEach(function (v) {
        var o = el("option", "", t("up.v." + v)); o.value = v; vis.appendChild(o);
      });
      vis.value = "private";
      l3.appendChild(vis); dlg.appendChild(l3);
      var vh = el("p", "osm-hint", t("up.vis.private"));
      vis.addEventListener("change", function () { vh.textContent = t("up.vis." + vis.value); });
      dlg.appendChild(vh);
      var row = el("div", "osm-actions");
      var goBtn = button(t("up.go"), "osm-btn primary", function () {
        goBtn.disabled = true; goBtn.textContent = t("up.busy");
        var copy = T.clone(tr);
        delete copy.trace;
        copy.name = nameOf(e);
        var fd = new FormData();
        fd.append("file", new Blob([T.writeGpx(copy)], { type: "application/gpx+xml" }), fileName(e));
        fd.append("description", desc.value.replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, 255) || O.DEFAULT_COMMENT);
        fd.append("tags", tags.value.replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, 255));
        fd.append("visibility", vis.value);
        var srv = A.server(), acc = A.account();
        A.request("POST", "/api/0.6/gpx/create", null, srv, { body: fd, text: true }).then(function (txt) {
          var tid = String(txt || "").trim();
          if (!/^[1-9][0-9]{0,14}$/.test(tid)) throw { status: 200, text: "?" };
          close();
          toast(t("up.ok"));
          var url = T.traceUrl(O.SERVERS[srv].web, acc && acc.user, tid);
          if (!url) return;
          readTrack(id).then(function (cur) {
            var c2 = T.clone(cur);
            c2.trace = url;
            return writeTrack(id, c2);
          }).then(function () {
            if (modeOn && route.v === "track" && route.id === id) render();
          }, function () {});
        }, function (err) {
          goBtn.disabled = false; goBtn.textContent = t("up.go");
          if (err && err.offline) toast(t("up.offline"));
          else if (err && err.status === 401) toast(t("up.denied"));
          else toast(t("up.fail", { e: (err && (err.text || err.status)) || "?" }));
        });
      });
      row.appendChild(goBtn);
      row.appendChild(button(t("cancel"), "osm-btn", close));
      dlg.appendChild(row);
      function close() { if (dlg.open) dlg.close(); dlg.remove(); }
      dlg.addEventListener("cancel", function (ev) { ev.preventDefault(); close(); });
      document.body.appendChild(dlg);
      dlg.showModal();
    }, function () { toast(t("missing")); });
  }
  function infoDlg(text) {
    var dlg = el("dialog", "osm-dlg");
    dlg.appendChild(el("p", "", text));
    var row = el("div", "osm-actions");
    row.appendChild(button(t("close"), "osm-btn primary", close));
    dlg.appendChild(row);
    function close() { if (dlg.open) dlg.close(); dlg.remove(); }
    dlg.addEventListener("cancel", function (ev) { ev.preventDefault(); close(); });
    document.body.appendChild(dlg);
    dlg.showModal();
  }

  // ---------- import ----------
  var fileIn = el("input", "");
  fileIn.type = "file";
  fileIn.accept = ".gpx,.kml,.geojson,.json,application/gpx+xml,application/vnd.google-earth.kml+xml,application/geo+json";
  fileIn.multiple = true;
  fileIn.hidden = true;
  fileIn.addEventListener("change", function () {
    var files = Array.prototype.slice.call(fileIn.files || []);
    fileIn.value = "";
    importFiles(files);
  });
  function importFiles(files) {
    if (!fsApi()) { toast(t("nofs")); return Promise.resolve(); }
    var done = [], lastId = null;
    return files.reduce(function (p, f) {
      return p.then(function () {
        if (!f) return;
        if (f.size > T.LIM.chars) { toast(t("import.big")); return; }
        return f.text().then(function (txt) { return importText(txt, f.name); }).then(function (e) {
          if (e) { done.push(nameOf(e)); lastId = e.id; }
        });
      });
    }, Promise.resolve()).then(function () {
      if (done.length) {
        toast(t("import.ok", { n: done.length === 1 ? done[0] : done.length }));
        if (lastId) open(lastId);
      }
    });
  }
  function importText(txt, fileName) {
    var tr = T.parseAny(txt, fileName);
    // Only waypoints (e.g. OsmAnd favourites): saved places, wave 10C.
    if (tr && !tr.segs.length && tr.wpts.length && window.__orosMapsFav) {
      window.__orosMapsFav.importWpts(tr, fileName);
      return Promise.resolve(null);
    }
    if (!tr || !tr.segs.length) { toast(t("import.bad")); return Promise.resolve(null); }
    if (!tr.name) tr.name = String(fileName || "").replace(/\.[a-z0-9]+$/i, "").slice(0, T.LIM.name);
    return addTrack(tr, { name: tr.name, src: "import" }).catch(function () { toast(t("savefail")); return null; });
  }

  // ---------- deep link: { openFile: { token } } from "Open with" ----------
  function openTarget(target) {
    if (!target || typeof target !== "object") return;
    var f = target.openFile;
    if (f && typeof f === "object" && typeof f.token === "string") {
      var file = null;
      try { file = window.parent.__orosTakeFile(f.token); } catch (e) {}
      if (file) { setMode(true); importFiles([file]); }
      else toast(t("import.bad"));
      return;
    }
    if (typeof target.track === "string" && data.tracks[target.track]) open(target.track);
  }
  var prevOpenAt = window.__orosOpenAt;
  window.__orosOpenAt = function (target) {
    if (target && (target.openFile || target.track)) return openTarget(target);
    if (typeof prevOpenAt === "function") return prevOpenAt(target);
  };

  // ---------- mode ----------
  window.addEventListener("oros-maps-mode", function (e) {
    if (modeOn && e.detail !== "tracks") setMode(false);
  });
  function setMode(on) {
    if (on && !modeOn) {
      try { window.dispatchEvent(new CustomEvent("oros-maps-mode", { detail: "tracks" })); } catch (e) {}
    }
    modeOn = !!on;
    if (modeBtn) { modeBtn.classList.toggle("on", modeOn); modeBtn.setAttribute("aria-pressed", modeOn ? "true" : "false"); }
    document.body.classList.toggle("osm-mode", modeOn || document.querySelectorAll(".osm-sheet:not([hidden])").length > 1);
    panel.hidden = !modeOn;
    // Unsaved edits survive closing the panel (or another mode opening):
    // the editor comes back the next time the panel opens.
    if (modeOn) {
      if (edit && data.tracks[edit.id]) route = { v: "edit", id: edit.id };
      else if (route.v !== "track") route = { v: "list" };
      render();
    } else {
      if (edit && !edit.dirty) edit = null;
      route = { v: "list" }; live = null; followBox = null; paint();
    }
    chip();
    setH();
  }

  var ICON = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="6" cy="19" r="2"/><circle cx="18" cy="5" r="2"/><path d="M8 19h8.5a3.5 3.5 0 0 0 0-7h-9a3.5 3.5 0 0 1 0-7H16"/></svg>';
  function boot() {
    loadData();
    panel = el("aside", "osm-sheet");
    panel.id = "trk-panel";
    panel.hidden = true;
    panel.setAttribute("aria-label", t("title"));
    document.body.appendChild(panel);
    document.body.appendChild(fileIn);
    try { new ResizeObserver(setH).observe(panel); } catch (e) {}
    var controls = document.getElementById("controls");
    if (controls) {
      modeBtn = el("button", "");
      modeBtn.id = "trk-btn";
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
      api.registerSlice("mapstracks", sliceGet, sliceSet, DATA_KEY, T.mergeTracks);
    }
    paint();
    recLoad().then(function (saved) { if (saved && !rec) offerResume(saved); });
    var pending = null;
    try { pending = window.parent && window.parent.__orosTakeTarget ? window.parent.__orosTakeTarget("maps") : null; } catch (e) {}
    // Not a track or file (e.g. the parking reminder's { park }):
    // left for the module that knows it (tools.js loads later).
    if (pending && (pending.openFile || pending.track)) openTarget(pending);
    else if (pending) H.pendingTarget = pending;
  }

  window.__orosMapsTracks = {
    data: function () { return T.normalizeTracks(data); },
    setMode: setMode, open: open, importText: importText,
    feed: onFix,
    rec: { start: recStart, pause: recPause, finish: recFinish, end: recEnd, state: function () { return rec; } },
    follow: function () { return following; },
    edit: function () { return edit; },
    full: function (id) { return full[id] || null; }
  };
  boot();
})();
